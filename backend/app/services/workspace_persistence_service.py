"""Sanitized, lightweight MongoDB persistence for anonymous workspaces."""

from __future__ import annotations

import json
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping
from uuid import UUID, uuid4

from pymongo import ASCENDING, DESCENDING, ReturnDocument
from pymongo.errors import DuplicateKeyError

from app.services.dataset_service import STORAGE_DIR
from app.services.mongo_index_service import ensure_compatible_index
from app.config.scientific_compatibility import (
    mark_projected_scientific_state_compatibility,
    mark_scientific_state_compatibility,
)


SCHEMA_VERSION = 1
MAX_SNAPSHOT_BYTES = 5 * 1024 * 1024
ROOT_STATE_KEYS = {
    "version",
    "projectId",
    "activeDatasetId",
    "activePage",
    "dataset",
    "dispatchStrategy",
    "battery",
    "setup",
    "runState",
    "selectedBatteryId",
    "selectedMode",
    "activeOptimizationStep",
    "operationalProfileDate",
    "datasetExplorerDate",
    "comparisonAhp",
    "comparisonConfiguration",
    "comparisonRunState",
    "comparisonOptimization",
    "promethee",
    "persistenceRevision",
    "updatedAt",
}
DATASET_KEYS = {
    "datasetId",
    "filename",
    "rowCount",
    "datasetType",
    "status",
    "startDate",
    "endDate",
    "annualPvEnergyKwh",
    "annualEvEnergyKwh",
    "pvPeakKw",
    "evPeakKw",
    "intervalMinutes",
    "durationDays",
    "timestampsGenerated",
    "notice",
    "detectedColumns",
}
FORBIDDEN_KEYS = {
    "rawcsv",
    "raw_csv",
    "csvcontent",
    "csv_content",
    "filecontent",
    "file_content",
    "daydata",
    "day_data",
    "profilepoints",
    "profile_points",
    "points",
}


class WorkspaceNotFoundError(LookupError):
    pass


class WorkspaceRevisionConflictError(RuntimeError):
    pass


class WorkspacePayloadError(ValueError):
    pass


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _safe_value(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, Mapping):
        cleaned: dict[str, Any] = {}
        for raw_key, nested in value.items():
            key = str(raw_key)
            normalized = key.replace("-", "_").lower()
            if normalized in FORBIDDEN_KEYS:
                continue
            cleaned[key] = _safe_value(nested)
        return cleaned
    if isinstance(value, (list, tuple)):
        return [_safe_value(item) for item in value]
    raise WorkspacePayloadError("Workspace state contains an unsupported value.")


def sanitize_workspace_state(state: Mapping[str, Any]) -> dict[str, Any]:
    cleaned = {
        key: _safe_value(value)
        for key, value in state.items()
        if key in ROOT_STATE_KEYS
    }
    dataset = cleaned.get("dataset")
    if isinstance(dataset, dict):
        cleaned["dataset"] = {
            key: value for key, value in dataset.items() if key in DATASET_KEYS
        }
    cleaned["version"] = SCHEMA_VERSION
    try:
        encoded = json.dumps(cleaned, allow_nan=False, separators=(",", ":"))
    except (TypeError, ValueError) as exc:
        raise WorkspacePayloadError("Workspace state must contain finite JSON values.") from exc
    if len(encoded.encode("utf-8")) > MAX_SNAPSHOT_BYTES:
        raise WorkspacePayloadError("Workspace snapshot exceeds the persistence size limit.")
    return cleaned


class MongoWorkspaceRepository:
    """Store the current snapshot plus lightweight scientific projections."""

    def __init__(self, database: Any, storage_dir: Path = STORAGE_DIR) -> None:
        self.database = database
        self.storage_dir = storage_dir
        self.workspaces = database["workspaces"]
        self.datasets = database["datasets"]
        self.optimization_runs = database["optimization_runs"]
        self.ahp_states = database["ahp_states"]
        self.promethee_states = database["promethee_states"]

    def ensure_indexes(self) -> None:
        self.workspaces.create_index("workspace_id", unique=True)
        self.workspaces.create_index([("workspace_id", ASCENDING), ("updated_at", DESCENDING)])
        self.datasets.create_index("dataset_id")
        self.datasets.create_index([("workspace_id", ASCENDING), ("updated_at", DESCENDING)])
        self.optimization_runs.create_index("run_id")
        self.optimization_runs.create_index([("workspace_id", ASCENDING), ("updated_at", DESCENDING)])
        self.ahp_states.create_index("workspace_id", unique=True)
        self.promethee_states.create_index("workspace_id", unique=True)
        self.workspaces.create_index("project_id", unique=True, sparse=True)
        self.datasets.create_index([("project_id", ASCENDING), ("dataset_id", ASCENDING)], unique=True, sparse=True)
        ensure_compatible_index(
            self.optimization_runs,
            [("project_id", ASCENDING), ("job_id", ASCENDING)],
            sparse=True,
        )
        self.optimization_runs.create_index([("project_id", ASCENDING), ("run_id", ASCENDING)], sparse=True)
        self.ahp_states.create_index("project_id", unique=True, sparse=True)
        self.promethee_states.create_index("project_id", unique=True, sparse=True)

    def create_workspace(self, workspace_id: UUID | None = None) -> dict[str, Any]:
        canonical_id = str(workspace_id or uuid4())
        now = _now()
        document = {
            "workspace_id": canonical_id,
            "schema_version": SCHEMA_VERSION,
            "revision": 0,
            "created_at": now,
            "updated_at": now,
            "state": {"version": SCHEMA_VERSION},
        }
        try:
            self.workspaces.insert_one(document)
        except DuplicateKeyError:
            existing = self.workspaces.find_one({"workspace_id": canonical_id})
            if existing is not None:
                return self._public_snapshot(existing)
            raise
        return self._public_snapshot(document)

    def get_workspace(self, workspace_id: UUID) -> dict[str, Any]:
        document = self.workspaces.find_one({"workspace_id": str(workspace_id)})
        if document is None:
            raise WorkspaceNotFoundError("Workspace was not found.")
        snapshot = self._public_snapshot(document)
        self._mark_missing_dataset_expired(snapshot)
        return snapshot

    def update_workspace(
        self,
        workspace_id: UUID,
        state: Mapping[str, Any],
        *,
        schema_version: int = SCHEMA_VERSION,
        expected_revision: int | None = None,
    ) -> dict[str, Any]:
        canonical_id = str(workspace_id)
        current = self.workspaces.find_one({"workspace_id": canonical_id})
        if current is None:
            raise WorkspaceNotFoundError("Workspace was not found.")
        current_revision = int(current.get("revision", 0))
        if expected_revision is not None and expected_revision != current_revision:
            raise WorkspaceRevisionConflictError("Workspace revision conflict.")

        cleaned = sanitize_workspace_state(state)
        now = _now()
        query: dict[str, Any] = {
            "workspace_id": canonical_id,
            "revision": current_revision,
        }
        updated = self.workspaces.find_one_and_update(
            query,
            {
                "$set": {
                    "schema_version": schema_version,
                    "state": cleaned,
                    "updated_at": now,
                },
                "$inc": {"revision": 1},
            },
            return_document=ReturnDocument.AFTER,
        )
        if updated is None:
            raise WorkspaceRevisionConflictError("Workspace revision conflict.")
        self._write_projections(canonical_id, cleaned, now)
        return self._public_snapshot(updated)

    def get_project_workspace(self, project_id: UUID) -> dict[str, Any]:
        canonical_id = str(project_id)
        document = self.workspaces.find_one({"project_id": canonical_id})
        if document is None:
            now = _now()
            document = {
                "workspace_id": f"project:{canonical_id}",
                "project_id": canonical_id,
                "schema_version": SCHEMA_VERSION,
                "revision": 0,
                "created_at": now,
                "updated_at": now,
                "state": {
                    "version": SCHEMA_VERSION,
                    "projectId": canonical_id,
                    "activeDatasetId": None,
                },
            }
            try:
                self.workspaces.insert_one(document)
            except DuplicateKeyError:
                document = self.workspaces.find_one({"project_id": canonical_id})
                if document is None:
                    raise
        snapshot = self._public_project_snapshot(document)
        self._mark_missing_dataset_expired(snapshot)
        return snapshot

    def update_project_workspace(
        self,
        project_id: UUID,
        state: Mapping[str, Any],
        *,
        schema_version: int = SCHEMA_VERSION,
        expected_revision: int | None = None,
    ) -> dict[str, Any]:
        canonical_id = str(project_id)
        current = self.workspaces.find_one({"project_id": canonical_id})
        if current is None:
            self.get_project_workspace(project_id)
            current = self.workspaces.find_one({"project_id": canonical_id})
        if current is None:  # pragma: no cover - defensive database boundary
            raise WorkspaceNotFoundError("Project workspace was not found.")
        current_revision = int(current.get("revision", 0))
        if expected_revision is not None and expected_revision != current_revision:
            raise WorkspaceRevisionConflictError("Workspace revision conflict.")
        cleaned = sanitize_workspace_state(state)
        cleaned["projectId"] = canonical_id
        active_dataset_id = cleaned.get("activeDatasetId")
        if active_dataset_id is not None:
            dataset = self.datasets.find_one(
                {"project_id": canonical_id, "dataset_id": str(active_dataset_id), "status": {"$ne": "removed"}}
            )
            if dataset is None:
                raise WorkspacePayloadError("The active dataset does not belong to this project.")
            state_dataset = cleaned.get("dataset")
            if not isinstance(state_dataset, Mapping) or str(state_dataset.get("datasetId")) != str(active_dataset_id):
                raise WorkspacePayloadError("Workspace dataset metadata must match the active dataset.")
        now = _now()
        updated = self.workspaces.find_one_and_update(
            {"project_id": canonical_id, "revision": current_revision},
            {
                "$set": {"schema_version": schema_version, "state": cleaned, "updated_at": now},
                "$inc": {"revision": 1},
            },
            return_document=ReturnDocument.AFTER,
        )
        if updated is None:
            raise WorkspaceRevisionConflictError("Workspace revision conflict.")
        self._write_project_projections(canonical_id, cleaned, now)
        return self._public_project_snapshot(updated)

    def register_project_dataset(
        self,
        project_id: UUID,
        upload: Mapping[str, Any],
        *,
        fingerprint: str,
    ) -> dict[str, Any]:
        canonical_id = str(project_id)
        self.get_project_workspace(project_id)
        dataset_id = str(upload["dataset_id"])
        summary = deepcopy(upload.get("summary", {}))
        validation = deepcopy(upload.get("validation_summary", {}))
        now = _now()
        metadata = {
            "dataset_id": dataset_id,
            "project_id": canonical_id,
            "filename": upload.get("filename"),
            "label": upload.get("filename"),
            "uploaded_at": now,
            "last_used_at": now,
            "row_count": validation.get("row_count"),
            "start_date": summary.get("start_date"),
            "end_date": summary.get("end_date"),
            "summary": summary,
            "detected_columns": validation.get("detected_columns"),
            "fingerprint": fingerprint,
            "stored_file_id": dataset_id,
            "status": "ready",
            "updated_at": now,
            "workspace_dataset": {
                "datasetId": dataset_id,
                "filename": upload.get("filename"),
                "rowCount": validation.get("row_count"),
                "datasetType": validation.get("dataset_type", "partial"),
                "status": "ready",
                "startDate": summary.get("start_date"),
                "endDate": summary.get("end_date"),
                "annualPvEnergyKwh": summary.get("annual_pv_energy_kwh"),
                "annualEvEnergyKwh": summary.get("annual_ev_energy_kwh"),
                "pvPeakKw": summary.get("pv_peak_kw"),
                "evPeakKw": summary.get("ev_peak_kw"),
                "intervalMinutes": validation.get("interval_minutes", 15),
                "durationDays": validation.get("duration_days"),
                "timestampsGenerated": validation.get("timestamps_generated", False),
                "notice": validation.get("notice"),
                "detectedColumns": validation.get("detected_columns"),
            },
        }
        self.datasets.update_one(
            {"project_id": canonical_id, "dataset_id": dataset_id},
            {"$set": metadata},
            upsert=True,
        )
        self._set_project_active_dataset(canonical_id, dataset_id, now, metadata["workspace_dataset"])
        return self._public_dataset(metadata)

    def list_project_datasets(self, project_id: UUID) -> list[dict[str, Any]]:
        documents = self.datasets.find(
            {"project_id": str(project_id), "status": {"$ne": "removed"}}
        ).sort("uploaded_at", DESCENDING)
        return [self._public_dataset_with_storage_status(document) for document in documents]

    def get_project_dataset(self, project_id: UUID, dataset_id: str) -> dict[str, Any]:
        document = self.datasets.find_one(
            {"project_id": str(project_id), "dataset_id": str(dataset_id), "status": {"$ne": "removed"}}
        )
        if document is None:
            raise WorkspaceNotFoundError("Dataset was not found in this project.")
        return self._public_dataset_with_storage_status(document)

    def activate_project_dataset(self, project_id: UUID, dataset_id: str) -> dict[str, Any]:
        canonical_id = str(project_id)
        document = self.datasets.find_one(
            {"project_id": canonical_id, "dataset_id": str(dataset_id), "status": {"$ne": "removed"}}
        )
        if document is None:
            raise WorkspaceNotFoundError("Dataset was not found in this project.")
        now = _now()
        self.datasets.update_one(
            {"project_id": canonical_id, "dataset_id": str(dataset_id)},
            {"$set": {"last_used_at": now}},
        )
        self._set_project_active_dataset(canonical_id, str(dataset_id), now, document.get("workspace_dataset"))
        return self._public_dataset_with_storage_status({**document, "last_used_at": now})

    def remove_project_dataset(self, project_id: UUID, dataset_id: str) -> None:
        canonical_id = str(project_id)
        result = self.datasets.update_one(
            {"project_id": canonical_id, "dataset_id": str(dataset_id), "status": {"$ne": "removed"}},
            {"$set": {"status": "removed", "updated_at": _now()}},
        )
        if not result.matched_count:
            raise WorkspaceNotFoundError("Dataset was not found in this project.")
        project = self.database["projects"].find_one({"project_id": canonical_id})
        if project and project.get("active_dataset_id") == str(dataset_id):
            self._set_project_active_dataset(canonical_id, None, _now())

    def assert_project_job(self, project_id: UUID, job_id: str) -> dict[str, Any]:
        document = self.optimization_runs.find_one(
            {"project_id": str(project_id), "$or": [{"job_id": job_id}, {"run_id": job_id}]}
        )
        if document is None:
            raise WorkspaceNotFoundError("Optimization job was not found in this project.")
        return document

    def list_project_optimization_runs(
        self,
        project_id: UUID,
        *,
        mode: str | None = None,
        limit: int = 20,
    ) -> list[dict[str, Any]]:
        query: dict[str, Any] = {"project_id": str(project_id)}
        if mode is not None:
            query["mode"] = mode
        cursor = self.optimization_runs.find(query).sort("updated_at", DESCENDING).limit(limit)
        return [
            {
                "run_id": str(document.get("run_id") or document.get("job_id") or ""),
                "job_id": str(document.get("job_id") or document.get("run_id") or ""),
                "project_id": str(project_id),
                "dataset_id": str(document["dataset_id"]) if document.get("dataset_id") is not None else None,
                "mode": str(document.get("mode") or "single"),
                "lifecycle_status": str(document.get("lifecycle_status") or "unknown"),
                "scientific_status": document.get("scientific_status"),
                "submitted_configuration": deepcopy(document.get("submitted_configuration")),
                "result": deepcopy(document.get("result")),
                "created_at": document.get("created_at"),
                "completed_at": document.get("completed_at"),
                "updated_at": document.get("updated_at"),
                "error": deepcopy(document.get("error")),
            }
            for document in cursor
            if document.get("run_id") or document.get("job_id")
        ]

    def bind_project_job(self, project_id: UUID, dataset_id: str, job_id: str, mode: str) -> None:
        now = _now()
        self.optimization_runs.update_one(
            {"job_id": job_id},
            {"$set": {
                "project_id": str(project_id),
                "dataset_id": str(dataset_id),
                "run_id": job_id,
                "mode": mode,
                "updated_at": now,
            }},
            upsert=True,
        )
        self.database["optimization_checkpoints"].update_many(
            {"job_id": job_id},
            {"$set": {"project_id": str(project_id), "dataset_id": str(dataset_id), "updated_at": now}},
        )

    def assert_project_checkpoint(self, project_id: UUID, job_id: str) -> dict[str, Any]:
        document = self.database["optimization_checkpoints"].find_one(
            {"project_id": str(project_id), "job_id": job_id}
        )
        if document is None:
            raise WorkspaceNotFoundError("Optimization checkpoint was not found in this project.")
        return document

    def get_project_ahp_state(self, project_id: UUID) -> dict[str, Any] | None:
        document = self.ahp_states.find_one({"project_id": str(project_id)})
        return mark_projected_scientific_state_compatibility(
            document.get("state", {}), "ahp"
        ) if document else None

    def get_project_promethee_state(self, project_id: UUID) -> dict[str, Any] | None:
        document = self.promethee_states.find_one({"project_id": str(project_id)})
        return mark_projected_scientific_state_compatibility(
            document.get("state", {}), "promethee"
        ) if document else None

    def import_legacy_workspace(self, project_id: UUID, legacy_workspace_id: UUID) -> dict[str, Any]:
        canonical_id = str(project_id)
        legacy_id = str(legacy_workspace_id)
        existing = self.workspaces.find_one({"project_id": canonical_id})
        if existing and existing.get("legacy_import", {}).get("workspace_id") == legacy_id:
            return self._public_project_snapshot(existing)
        if existing and int(existing.get("revision", 0)) > 0:
            raise WorkspacePayloadError("Import is allowed only into an empty project workspace.")
        legacy = self.workspaces.find_one({"workspace_id": legacy_id, "project_id": {"$exists": False}})
        if legacy is None:
            raise WorkspaceNotFoundError("Legacy workspace was not found.")
        state = sanitize_workspace_state(deepcopy(legacy.get("state", {})))
        state["projectId"] = canonical_id
        dataset = state.get("dataset")
        active_dataset_id = dataset.get("datasetId") if isinstance(dataset, dict) else None
        state["activeDatasetId"] = active_dataset_id
        now = _now()
        document = {
            "workspace_id": f"project:{canonical_id}",
            "project_id": canonical_id,
            "schema_version": SCHEMA_VERSION,
            "revision": 1,
            "created_at": existing.get("created_at", now) if existing else now,
            "updated_at": now,
            "state": state,
            "legacy_import": {"workspace_id": legacy_id, "imported_at": now},
        }
        self.workspaces.replace_one({"project_id": canonical_id}, document, upsert=True)
        if active_dataset_id:
            self.datasets.update_many(
                {"workspace_id": legacy_id, "dataset_id": active_dataset_id},
                {"$set": {"project_id": canonical_id, "status": "ready", "updated_at": now}},
            )
            self._set_project_active_dataset(canonical_id, str(active_dataset_id), now, dataset)
        self._write_project_projections(canonical_id, state, now)
        return self._public_project_snapshot(document)

    def _set_project_active_dataset(self, project_id: str, dataset_id: str | None, now: datetime, workspace_dataset: Any = None) -> None:
        self.database["projects"].update_one(
            {"project_id": project_id},
            {"$set": {"active_dataset_id": dataset_id, "updated_at": now, "last_opened_at": now}},
        )
        workspace = self.workspaces.find_one({"project_id": project_id})
        if workspace is None:
            return
        state = deepcopy(workspace.get("state", {}))
        previous = state.get("activeDatasetId")
        state["projectId"] = project_id
        state["activeDatasetId"] = dataset_id
        state["dataset"] = deepcopy(workspace_dataset) if dataset_id is not None and isinstance(workspace_dataset, Mapping) else None
        if previous != dataset_id:
            for key in ("runState", "comparisonRunState"):
                value = state.get(key)
                if isinstance(value, dict):
                    value["isCurrent"] = False
            comparison = state.get("comparisonOptimization")
            if isinstance(comparison, dict):
                comparison["stale"] = True
            ahp = state.get("comparisonAhp")
            if isinstance(ahp, dict):
                ahp["accepted"] = False
            promethee = state.get("promethee")
            if isinstance(promethee, dict):
                promethee["stale"] = True
        self.workspaces.update_one(
            {"project_id": project_id},
            {"$set": {"state": state, "updated_at": now}, "$inc": {"revision": 1}},
        )

    def _write_project_projections(self, project_id: str, state: dict[str, Any], updated_at: datetime) -> None:
        active_dataset_id = state.get("activeDatasetId")
        self._write_run_projection(project_id, "single", state.get("runState"), state, updated_at, project_id=project_id, dataset_id=active_dataset_id)
        comparison_run = state.get("comparisonRunState")
        comparison_result = state.get("comparisonOptimization")
        if isinstance(comparison_result, dict):
            run_state = {
                **(comparison_run if isinstance(comparison_run, dict) else {}),
                "jobId": comparison_result.get("jobId"),
                "phase": comparison_result.get("status", "completed"),
                "latestJob": {"final_result": comparison_result.get("finalResult")},
            }
            self._write_run_projection(project_id, "comparison", run_state, state, updated_at, project_id=project_id, dataset_id=comparison_result.get("datasetId", active_dataset_id))
        ahp = state.get("comparisonAhp")
        if isinstance(ahp, dict):
            existing_ahp = self.ahp_states.find_one({"project_id": project_id})
            ahp_history = deepcopy(existing_ahp.get("history", [])) if existing_ahp else []
            if existing_ahp and existing_ahp.get("state") != ahp:
                ahp_history.append({"state": deepcopy(existing_ahp.get("state")), "dataset_id": existing_ahp.get("dataset_id"), "archived_at": updated_at})
            self.ahp_states.update_one(
                {"project_id": project_id},
                {"$set": {"workspace_id": f"project:{project_id}", "project_id": project_id, "dataset_id": ahp.get("linkedDatasetId", active_dataset_id), "state": deepcopy(ahp), "history": ahp_history, "linked_comparison_revision": self._comparison_revision(state), "updated_at": updated_at}},
                upsert=True,
            )
        promethee = state.get("promethee")
        if isinstance(promethee, dict):
            existing_promethee = self.promethee_states.find_one({"project_id": project_id})
            promethee_history = deepcopy(existing_promethee.get("history", [])) if existing_promethee else []
            if existing_promethee and existing_promethee.get("state") != promethee:
                promethee_history.append({"state": deepcopy(existing_promethee.get("state")), "dataset_id": existing_promethee.get("dataset_id"), "archived_at": updated_at})
            self.promethee_states.update_one(
                {"project_id": project_id},
                {"$set": {"workspace_id": f"project:{project_id}", "project_id": project_id, "dataset_id": promethee.get("datasetId", active_dataset_id), "state": deepcopy(promethee), "history": promethee_history, "comparison_revision": promethee.get("comparisonRevision"), "ahp_revision": promethee.get("ahpRevision"), "updated_at": updated_at}},
                upsert=True,
            )

    def _write_projections(
        self, workspace_id: str, state: dict[str, Any], updated_at: datetime
    ) -> None:
        dataset = state.get("dataset")
        if isinstance(dataset, dict) and dataset.get("datasetId"):
            self.datasets.update_one(
                {"workspace_id": workspace_id, "dataset_id": dataset["datasetId"]},
                {
                    "$set": {
                        "workspace_id": workspace_id,
                        "dataset_id": dataset["datasetId"],
                        "stored_file_id": dataset["datasetId"],
                        "metadata": deepcopy(dataset),
                        "selected_day_explorer_date": state.get("datasetExplorerDate"),
                        "updated_at": updated_at,
                    }
                },
                upsert=True,
            )

        self._write_run_projection(workspace_id, "single", state.get("runState"), state, updated_at)
        comparison_run = state.get("comparisonRunState")
        comparison_result = state.get("comparisonOptimization")
        if isinstance(comparison_result, dict):
            run_id = comparison_result.get("jobId")
            run_state = {
                **(comparison_run if isinstance(comparison_run, dict) else {}),
                "jobId": run_id,
                "phase": comparison_result.get("status", "completed"),
                "latestJob": {"final_result": comparison_result.get("finalResult")},
            }
            self._write_run_projection(workspace_id, "comparison", run_state, state, updated_at)

        ahp = state.get("comparisonAhp")
        if isinstance(ahp, dict):
            self.ahp_states.update_one(
                {"workspace_id": workspace_id},
                {"$set": {"workspace_id": workspace_id, "state": deepcopy(ahp), "linked_comparison_revision": self._comparison_revision(state), "updated_at": updated_at}},
                upsert=True,
            )
        promethee = state.get("promethee")
        if isinstance(promethee, dict):
            self.promethee_states.update_one(
                {"workspace_id": workspace_id},
                {"$set": {"workspace_id": workspace_id, "state": deepcopy(promethee), "comparison_revision": promethee.get("comparisonRevision"), "ahp_revision": promethee.get("ahpRevision"), "updated_at": updated_at}},
                upsert=True,
            )

    def _write_run_projection(
        self,
        workspace_id: str,
        mode: str,
        run_state: Any,
        state: dict[str, Any],
        updated_at: datetime,
        *,
        project_id: str | None = None,
        dataset_id: str | None = None,
    ) -> None:
        if not isinstance(run_state, dict):
            return
        run_id = run_state.get("jobId")
        if not run_id:
            return
        latest = run_state.get("latestJob")
        final_result = latest.get("final_result") if isinstance(latest, dict) else None
        scientific_status = final_result.get("solution_status") if isinstance(final_result, dict) else None
        if mode == "comparison" and isinstance(final_result, dict):
            scientific_status = final_result.get("comparison_solution_status")
        submitted_configuration = {
            "battery": state.get("battery"),
            "setup": state.get("setup"),
        } if mode == "single" else state.get("comparisonConfiguration")
        query = (
            {"project_id": project_id, "run_id": run_id}
            if project_id is not None
            else {"workspace_id": workspace_id, "run_id": run_id}
        )
        projection = {
                "workspace_id": workspace_id,
                "run_id": run_id,
                "job_id": run_id,
                "mode": mode,
                "lifecycle_status": run_state.get("phase"),
                "scientific_status": scientific_status,
                "submitted_configuration": deepcopy(submitted_configuration),
                "result": deepcopy(final_result),
                "created_at": run_state.get("startedAt"),
                "completed_at": run_state.get("finishedAt"),
                "error": deepcopy(run_state.get("error")),
                "updated_at": updated_at,
            }
        if project_id is not None:
            projection["project_id"] = project_id
            projection["dataset_id"] = dataset_id
        self.optimization_runs.update_one(
            query,
            {"$set": {
                **projection,
            }},
            upsert=True,
        )

    @staticmethod
    def _comparison_revision(state: dict[str, Any]) -> Any:
        comparison = state.get("comparisonOptimization")
        return comparison.get("revision") if isinstance(comparison, dict) else None

    def _mark_missing_dataset_expired(self, snapshot: dict[str, Any]) -> None:
        state = snapshot.get("state")
        dataset = state.get("dataset") if isinstance(state, dict) else None
        dataset_id = dataset.get("datasetId") if isinstance(dataset, dict) else None
        if not isinstance(dataset_id, str):
            return
        try:
            canonical_id = str(UUID(dataset_id))
        except ValueError:
            dataset["status"] = "expired"
            return
        csv_exists = (self.storage_dir / f"{canonical_id}.csv").is_file()
        metadata_exists = (self.storage_dir / f"{canonical_id}.json").is_file()
        dataset["status"] = "ready" if csv_exists and metadata_exists else "expired"

    @staticmethod
    def _public_snapshot(document: Mapping[str, Any]) -> dict[str, Any]:
        return {
            "workspace_id": document["workspace_id"],
            "schema_version": int(document.get("schema_version", SCHEMA_VERSION)),
            "revision": int(document.get("revision", 0)),
            "created_at": document["created_at"],
            "updated_at": document["updated_at"],
            "state": mark_scientific_state_compatibility(
                document.get("state", {"version": SCHEMA_VERSION})
            ),
            "persistence_status": "available",
        }

    @staticmethod
    def _public_project_snapshot(document: Mapping[str, Any]) -> dict[str, Any]:
        return {
            "project_id": document["project_id"],
            "schema_version": int(document.get("schema_version", SCHEMA_VERSION)),
            "revision": int(document.get("revision", 0)),
            "created_at": document["created_at"],
            "updated_at": document["updated_at"],
            "state": deepcopy(document.get("state", {"version": SCHEMA_VERSION})),
            "persistence_status": "available",
            "legacy_import": deepcopy(document.get("legacy_import")),
        }

    @staticmethod
    def _public_dataset(document: Mapping[str, Any]) -> dict[str, Any]:
        return {
            "dataset_id": str(document["dataset_id"]),
            "project_id": str(document["project_id"]),
            "filename": document.get("filename") or document.get("metadata", {}).get("filename"),
            "label": document.get("label"),
            "uploaded_at": document.get("uploaded_at") or document.get("updated_at"),
            "last_used_at": document.get("last_used_at"),
            "row_count": document.get("row_count") or document.get("metadata", {}).get("rowCount"),
            "start_date": document.get("start_date") or document.get("metadata", {}).get("startDate"),
            "end_date": document.get("end_date") or document.get("metadata", {}).get("endDate"),
            "summary": deepcopy(document.get("summary", {})),
            "detected_columns": deepcopy(document.get("detected_columns")),
            "fingerprint": document.get("fingerprint"),
            "status": document.get("status", "ready"),
        }

    def _public_dataset_with_storage_status(
        self,
        document: Mapping[str, Any],
    ) -> dict[str, Any]:
        result = self._public_dataset(document)
        try:
            dataset_id = str(UUID(result["dataset_id"]))
        except (TypeError, ValueError):
            result["status"] = "expired"
            return result
        csv_exists = (self.storage_dir / f"{dataset_id}.csv").is_file()
        metadata_exists = (self.storage_dir / f"{dataset_id}.json").is_file()
        result["status"] = "ready" if csv_exists and metadata_exists else "expired"
        return result
