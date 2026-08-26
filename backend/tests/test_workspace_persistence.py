from __future__ import annotations

import os
import unittest
from copy import deepcopy
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
from uuid import UUID, uuid4

from pydantic import TypeAdapter, ValidationError
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from app.config.mongodb import MongoSettings, PersistenceUnavailableError
from app.main import app
from app.services.workspace_persistence_service import (
    MongoWorkspaceRepository,
    WorkspaceRevisionConflictError,
)


class FakeCollection:
    def __init__(self) -> None:
        self.documents: list[dict[str, object]] = []

    def create_index(self, *_args: object, **_kwargs: object) -> None:
        return None

    @staticmethod
    def _matches(document: dict[str, object], query: dict[str, object]) -> bool:
        return all(document.get(key) == value for key, value in query.items())

    def insert_one(self, document: dict[str, object]) -> object:
        if any(item.get("workspace_id") == document.get("workspace_id") for item in self.documents):
            raise DuplicateKeyError("duplicate")
        self.documents.append(deepcopy(document))
        return object()

    def find_one(self, query: dict[str, object]) -> dict[str, object] | None:
        for document in self.documents:
            if self._matches(document, query):
                return deepcopy(document)
        return None

    def find_one_and_update(
        self,
        query: dict[str, object],
        update: dict[str, dict[str, object]],
        *,
        return_document: ReturnDocument,
    ) -> dict[str, object] | None:
        del return_document
        for index, document in enumerate(self.documents):
            if not self._matches(document, query):
                continue
            updated = deepcopy(document)
            updated.update(deepcopy(update.get("$set", {})))
            for key, increment in update.get("$inc", {}).items():
                updated[key] = int(updated.get(key, 0)) + int(increment)
            self.documents[index] = updated
            return deepcopy(updated)
        return None

    def update_one(
        self,
        query: dict[str, object],
        update: dict[str, dict[str, object]],
        *,
        upsert: bool = False,
    ) -> object:
        for index, document in enumerate(self.documents):
            if self._matches(document, query):
                updated = deepcopy(document)
                updated.update(deepcopy(update.get("$set", {})))
                self.documents[index] = updated
                return object()
        if upsert:
            self.documents.append({**deepcopy(query), **deepcopy(update.get("$set", {}))})
        return object()


class FakeDatabase:
    def __init__(self) -> None:
        self.collections: dict[str, FakeCollection] = {}

    def __getitem__(self, name: str) -> FakeCollection:
        return self.collections.setdefault(name, FakeCollection())


def base_state() -> dict[str, object]:
    return {
        "version": 1,
        "activePage": "Data Upload",
        "dataset": None,
        "dispatchStrategy": {"status": "Reference Strategy", "periods": []},
        "battery": None,
        "setup": None,
        "runState": {
            "phase": "ready", "jobId": None, "latestJob": None, "error": None,
            "startedAt": None, "finishedAt": None, "reconnecting": False,
        },
        "selectedBatteryId": None,
        "selectedMode": None,
        "activeOptimizationStep": None,
        "operationalProfileDate": None,
        "datasetExplorerDate": None,
        "comparisonAhp": None,
        "comparisonConfiguration": None,
        "comparisonRunState": {
            "phase": "ready", "jobId": None, "latestJob": None,
        },
        "comparisonOptimization": None,
        "promethee": None,
    }


class TestWorkspacePersistence(unittest.TestCase):
    def setUp(self) -> None:
        self.database = FakeDatabase()
        self.temporary_directory = TemporaryDirectory()
        self.repository = MongoWorkspaceRepository(
            self.database,
            Path(self.temporary_directory.name),
        )
        self.repository.ensure_indexes()

    def tearDown(self) -> None:
        app.dependency_overrides.clear()
        self.temporary_directory.cleanup()

    def test_connection_configuration_does_not_expose_uri(self) -> None:
        secret_uri = "sensitive-connection-value-that-must-not-appear"
        settings = MongoSettings(uri=secret_uri, database_name="bess_optimization")
        self.assertNotIn(secret_uri, repr(settings))
        self.assertNotIn("sensitive-connection-value", str(PersistenceUnavailableError()))
        with patch.dict(os.environ, {"MONGODB_URI": secret_uri, "MONGODB_DATABASE": "configured", "MONGODB_TIMEOUT_MS": "25000"}, clear=False):
            loaded = MongoSettings.from_environment(Path(self.temporary_directory.name) / "missing.env")
        self.assertEqual(loaded.database_name, "configured")
        self.assertEqual(loaded.connection_timeout_ms, 25_000)
        self.assertNotIn(secret_uri, repr(loaded))

    def test_workspace_creation_retrieval_and_update(self) -> None:
        workspace_id = uuid4()
        created = self.repository.create_workspace(workspace_id)
        self.assertEqual(created["revision"], 0)
        updated = self.repository.update_workspace(
            workspace_id, base_state(), expected_revision=0
        )
        self.assertEqual(updated["revision"], 1)
        restored = self.repository.get_workspace(workspace_id)
        self.assertEqual(restored["state"]["activePage"], "Data Upload")
        with self.assertRaises(WorkspaceRevisionConflictError):
            self.repository.update_workspace(workspace_id, base_state(), expected_revision=0)

    def test_persistence_survives_repository_recreation(self) -> None:
        workspace_id = uuid4()
        self.repository.create_workspace(workspace_id)
        self.repository.update_workspace(workspace_id, base_state(), expected_revision=0)
        recreated = MongoWorkspaceRepository(self.database, Path(self.temporary_directory.name))
        self.assertEqual(recreated.get_workspace(workspace_id)["revision"], 1)

    def test_dataset_metadata_persists_without_raw_csv(self) -> None:
        workspace_id = uuid4()
        dataset_id = str(uuid4())
        state = base_state()
        state["datasetExplorerDate"] = "2025-06-12"
        state["dataset"] = {
            "datasetId": dataset_id,
            "filename": "annual.csv",
            "rowCount": 35040,
            "startDate": "2025-01-01",
            "endDate": "2025-12-31",
            "annualPvEnergyKwh": 100.0,
            "annualEvEnergyKwh": 120.0,
            "detectedColumns": {"timestamp": "timestamp", "pv": "pv", "ev": "ev", "tariff": None},
            "status": "ready",
            "rawCsv": "secret-row-data",
            "points": [{"pv_kw": 1}],
        }
        self.repository.create_workspace(workspace_id)
        self.repository.update_workspace(workspace_id, state, expected_revision=0)
        dataset_document = self.database["datasets"].documents[0]
        serialized = repr(dataset_document)
        self.assertIn("annual.csv", serialized)
        self.assertNotIn("secret-row-data", serialized)
        self.assertNotIn("points", serialized)
        self.assertEqual(dataset_document["stored_file_id"], dataset_id)

    def test_completed_single_result_persists_as_run_metadata(self) -> None:
        workspace_id = uuid4()
        state = base_state()
        state["battery"] = {"batteryName": "Edited battery", "priceRsPerKwh": 45000}
        state["setup"] = {"discountRate": 0.10}
        state["runState"] = {
            "phase": "completed", "jobId": "single-job", "startedAt": 1,
            "finishedAt": 2, "error": None,
            "latestJob": {"final_result": {"solution_status": "feasible_solution", "fitness_rs": 123.0}},
        }
        self.repository.create_workspace(workspace_id)
        self.repository.update_workspace(workspace_id, state, expected_revision=0)
        run = self.database["optimization_runs"].documents[0]
        self.assertEqual(run["mode"], "single")
        self.assertEqual(run["scientific_status"], "feasible_solution")
        self.assertEqual(run["result"]["fitness_rs"], 123.0)

    def test_completed_comparison_result_and_configuration_persist(self) -> None:
        workspace_id = uuid4()
        state = base_state()
        state["comparisonConfiguration"] = {"revision": 3, "savedAt": "2026-07-20T00:00:00Z", "batteries": [{"id": "a"}]}
        state["comparisonOptimization"] = {
            "jobId": "comparison-job", "status": "completed", "revision": "result-r3",
            "completedAt": "2026-07-20T00:01:00Z",
            "finalResult": {"comparison_solution_status": "completed_all_batteries", "feasible_battery_count": 4},
        }
        self.repository.create_workspace(workspace_id)
        self.repository.update_workspace(workspace_id, state, expected_revision=0)
        run = self.database["optimization_runs"].documents[0]
        self.assertEqual(run["mode"], "comparison")
        self.assertEqual(run["scientific_status"], "completed_all_batteries")
        self.assertEqual(run["submitted_configuration"]["revision"], 3)

    def test_ahp_and_promethee_states_persist_with_revisions_and_stale_status(self) -> None:
        workspace_id = uuid4()
        state = base_state()
        state["comparisonOptimization"] = {"jobId": "job", "status": "completed", "revision": "comparison-r4", "finalResult": {}}
        state["comparisonAhp"] = {"matrix": [[1]], "calculation": {"weights": [1]}, "accepted": True, "revision": 7}
        state["promethee"] = {"result": {"scientific_status": "ranking_completed"}, "comparisonRevision": "comparison-r4", "ahpRevision": 7, "stale": True}
        self.repository.create_workspace(workspace_id)
        self.repository.update_workspace(workspace_id, state, expected_revision=0)
        ahp = self.database["ahp_states"].documents[0]
        promethee = self.database["promethee_states"].documents[0]
        self.assertEqual(ahp["linked_comparison_revision"], "comparison-r4")
        self.assertEqual(promethee["ahp_revision"], 7)
        self.assertTrue(promethee["state"]["stale"])

    def test_missing_dataset_file_restores_metadata_as_expired(self) -> None:
        workspace_id = uuid4()
        dataset_id = str(uuid4())
        state = base_state()
        state["dataset"] = {"datasetId": dataset_id, "filename": "missing.csv", "status": "ready"}
        self.repository.create_workspace(workspace_id)
        self.repository.update_workspace(workspace_id, state, expected_revision=0)
        restored = self.repository.get_workspace(workspace_id)
        self.assertEqual(restored["state"]["dataset"]["status"], "expired")
        self.assertEqual(restored["state"]["dataset"]["filename"], "missing.csv")

    def test_workspace_api_declares_uuid_path_validation(self) -> None:
        parameter = app.openapi()["paths"]["/api/workspaces/{workspace_id}"]["get"]["parameters"][0]
        self.assertEqual(parameter["schema"]["format"], "uuid")
        with self.assertRaises(ValidationError):
            TypeAdapter(UUID).validate_python("not-a-uuid")

    def test_project_dataset_metadata_is_expired_only_when_storage_is_missing(self) -> None:
        dataset_id = str(uuid4())
        document = {
            "dataset_id": dataset_id,
            "project_id": str(uuid4()),
            "filename": "annual.csv",
            "uploaded_at": "2026-07-20T00:00:00Z",
            "row_count": 35_040,
            "start_date": "2025-01-01",
            "end_date": "2025-12-31",
            "summary": {},
            "status": "ready",
        }
        self.assertEqual(
            self.repository._public_dataset_with_storage_status(document)["status"],
            "expired",
        )
        (Path(self.temporary_directory.name) / f"{dataset_id}.csv").write_text("data")
        (Path(self.temporary_directory.name) / f"{dataset_id}.json").write_text("{}")
        self.assertEqual(
            self.repository._public_dataset_with_storage_status(document)["status"],
            "ready",
        )


if __name__ == "__main__":
    unittest.main()
