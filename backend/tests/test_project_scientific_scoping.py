from __future__ import annotations

import unittest
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import patch
from uuid import UUID, uuid4

from fastapi import HTTPException

from app.api.project_scientific import (
    authorize_project,
    get_project_ahp_state,
    get_project_comparison_job,
    get_project_dataset,
    get_project_promethee_state,
    get_project_single_job,
    get_project_workspace,
    list_project_optimization_runs,
    project_dataset_day,
    run_project_comparison,
    run_project_single_optimization,
)
from app.services.auth_project_service import ProjectNotFoundError
from app.services.workspace_persistence_service import WorkspaceNotFoundError


class OwnerRepository:
    def __init__(self, projects: dict[str, str]) -> None:
        self.projects = projects

    def get_project(self, project_id: UUID, owner_user_id: str, *, touch: bool = True) -> dict[str, object]:
        del touch
        if self.projects.get(str(project_id)) != owner_user_id:
            raise ProjectNotFoundError("Project was not found.")
        now = datetime.now(timezone.utc)
        return {
            "project_id": str(project_id), "owner_user_id": owner_user_id,
            "name": "Project", "description": None, "status": "active",
            "created_at": now, "updated_at": now, "last_opened_at": None,
            "schema_version": 1, "active_dataset_id": None,
        }


class ScientificRepository:
    def __init__(self, project_a: str, project_b: str, dataset_a: str, job_a: str) -> None:
        self.project_a = project_a
        self.project_b = project_b
        self.dataset_a = dataset_a
        self.job_a = job_a
        self.bound_jobs: list[tuple[str, str, str, str]] = []

    def get_project_workspace(self, project_id: UUID) -> dict[str, object]:
        return {"project_id": str(project_id)}

    def get_project_dataset(self, project_id: UUID, dataset_id: str) -> dict[str, object]:
        if str(project_id) != self.project_a or dataset_id != self.dataset_a:
            raise WorkspaceNotFoundError("Dataset was not found in this project.")
        return {"project_id": self.project_a, "dataset_id": self.dataset_a}

    def assert_project_job(self, project_id: UUID, job_id: str) -> dict[str, object]:
        if str(project_id) != self.project_a or job_id != self.job_a:
            raise WorkspaceNotFoundError("Optimization job was not found in this project.")
        return {"project_id": self.project_a, "job_id": self.job_a}

    def get_project_ahp_state(self, project_id: UUID) -> dict[str, object] | None:
        return {"project_id": self.project_a} if str(project_id) == self.project_a else None

    def get_project_promethee_state(self, project_id: UUID) -> dict[str, object] | None:
        return {"project_id": self.project_a} if str(project_id) == self.project_a else None

    def bind_project_job(self, project_id: UUID, dataset_id: str, job_id: str, mode: str) -> None:
        self.bound_jobs.append((str(project_id), dataset_id, job_id, mode))

    def list_project_optimization_runs(self, project_id: UUID, *, mode: str | None = None, limit: int = 20) -> list[dict[str, object]]:
        if str(project_id) != self.project_a:
            return []
        return [{
            "run_id": self.job_a,
            "job_id": self.job_a,
            "project_id": self.project_a,
            "dataset_id": self.dataset_a,
            "mode": mode or "single",
            "lifecycle_status": "completed",
            "scientific_status": "feasible_solution",
            "result": {"battery_name": "Low-cost"},
        }][:limit]


class TestProjectScientificScoping(unittest.TestCase):
    def setUp(self) -> None:
        self.user_a = str(uuid4())
        self.user_b = str(uuid4())
        self.project_a = str(uuid4())
        self.project_b = str(uuid4())
        self.dataset_a = str(uuid4())
        self.job_a = str(uuid4())
        self.owners = OwnerRepository({self.project_a: self.user_a, self.project_b: self.user_a})
        self.science = ScientificRepository(self.project_a, self.project_b, self.dataset_a, self.job_a)

    def test_cross_user_cannot_authorize_project_scientific_access(self) -> None:
        with self.assertRaises(HTTPException) as context:
            authorize_project(UUID(self.project_a), {"user_id": self.user_b}, self.owners)  # type: ignore[arg-type]
        self.assertEqual(context.exception.status_code, 404)

    def test_same_owner_projects_cannot_mix_datasets_or_runs(self) -> None:
        authorized_b = authorize_project(UUID(self.project_b), {"user_id": self.user_a}, self.owners)  # type: ignore[arg-type]
        with self.assertRaises(HTTPException):
            get_project_dataset(UUID(self.project_b), UUID(self.dataset_a), authorized_b, self.science)  # type: ignore[arg-type]
        with self.assertRaises(HTTPException):
            get_project_single_job(UUID(self.project_b), self.job_a, authorized_b, self.science)  # type: ignore[arg-type]
        with self.assertRaises(HTTPException):
            get_project_comparison_job(UUID(self.project_b), self.job_a, authorized_b, self.science)  # type: ignore[arg-type]

    def test_foreign_dataset_cannot_start_single_or_comparison_run(self) -> None:
        authorized_b = authorize_project(UUID(self.project_b), {"user_id": self.user_a}, self.owners)  # type: ignore[arg-type]
        request = SimpleNamespace(dataset_id=self.dataset_a)
        with self.assertRaises(HTTPException) as single_error:
            run_project_single_optimization(UUID(self.project_b), request, authorized_b, self.science)  # type: ignore[arg-type]
        with self.assertRaises(HTTPException) as comparison_error:
            run_project_comparison(UUID(self.project_b), request, authorized_b, self.science)  # type: ignore[arg-type]
        self.assertEqual(single_error.exception.status_code, 404)
        self.assertEqual(comparison_error.exception.status_code, 404)

    def test_new_runs_must_use_the_project_active_dataset(self) -> None:
        authorized_a = authorize_project(UUID(self.project_a), {"user_id": self.user_a}, self.owners)  # type: ignore[arg-type]
        authorized_a["active_dataset_id"] = str(uuid4())
        request = SimpleNamespace(dataset_id=self.dataset_a)
        with self.assertRaises(HTTPException) as context:
            run_project_single_optimization(UUID(self.project_a), request, authorized_a, self.science)  # type: ignore[arg-type]
        self.assertEqual(context.exception.status_code, 422)

    def test_ahp_and_promethee_are_project_scoped(self) -> None:
        authorized_b = authorize_project(UUID(self.project_b), {"user_id": self.user_a}, self.owners)  # type: ignore[arg-type]
        with self.assertRaises(HTTPException):
            get_project_ahp_state(UUID(self.project_b), authorized_b, self.science)  # type: ignore[arg-type]
        with self.assertRaises(HTTPException):
            get_project_promethee_state(UUID(self.project_b), authorized_b, self.science)  # type: ignore[arg-type]

    def test_project_workspace_requires_the_authorized_project(self) -> None:
        authorized_a = authorize_project(UUID(self.project_a), {"user_id": self.user_a}, self.owners)  # type: ignore[arg-type]
        snapshot = get_project_workspace(UUID(self.project_a), authorized_a, self.science)  # type: ignore[arg-type]
        self.assertEqual(snapshot["project_id"], self.project_a)

    def test_owned_project_can_list_its_optimization_history(self) -> None:
        authorized_a = authorize_project(UUID(self.project_a), {"user_id": self.user_a}, self.owners)  # type: ignore[arg-type]
        runs = list_project_optimization_runs(UUID(self.project_a), "single", 10, authorized_a, self.science)  # type: ignore[arg-type]
        self.assertEqual(len(runs), 1)
        self.assertEqual(runs[0]["project_id"], self.project_a)
        self.assertEqual(runs[0]["mode"], "single")

    def test_owned_active_dataset_comparison_submission_is_accepted_and_bound(self) -> None:
        authorized_a = authorize_project(UUID(self.project_a), {"user_id": self.user_a}, self.owners)  # type: ignore[arg-type]
        authorized_a["active_dataset_id"] = self.dataset_a
        request = SimpleNamespace(
            dataset_id=self.dataset_a,
            dispatch_strategy_status="Reference Strategy",
        )
        with (
            patch("app.api.project_scientific.load_dataset_records", return_value=({}, [{"pv_kw": 1.0, "ev_kw": 1.0}], {})),
            patch.object(
                __import__(
                    "app.api.project_scientific",
                    fromlist=["comparison_job_manager"],
                ).comparison_job_manager,
                "submit",
                return_value=self.job_a,
            ),
        ):
            accepted = run_project_comparison(
                UUID(self.project_a),
                request,
                authorized_a,
                self.science,
            )  # type: ignore[arg-type]

        self.assertEqual(accepted.status, "queued")
        self.assertEqual(str(accepted.job_id), self.job_a)
        self.assertEqual(
            self.science.bound_jobs,
            [(self.project_a, self.dataset_a, self.job_a, "comparison")],
        )
