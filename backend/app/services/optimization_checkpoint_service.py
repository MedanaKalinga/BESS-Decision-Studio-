"""BSON-safe GA checkpoints, recovery validation, and MongoDB worker leases."""

from __future__ import annotations

import hashlib
import json
import random
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from pathlib import Path
from threading import Event, Thread
from typing import Any, Mapping, Protocol
from uuid import UUID

from pymongo import ASCENDING, DESCENDING, ReturnDocument

from app.services.dataset_service import STORAGE_DIR
from app.services.mongo_index_service import ensure_compatible_index


CHECKPOINT_VERSION = 1
LEASE_SECONDS = 45
UNLINKED_WORKSPACE_ID = "00000000-0000-0000-0000-000000000000"
RECOVERABLE_STATUSES = ("queued", "running", "cancelling")
SCIENTIFIC_SOURCE_FILES = (
    Path(__file__).with_name("single_ga_service.py"),
    Path(__file__).with_name("comparison_ga_service.py"),
    Path(__file__).with_name("single_simulation_service.py"),
)


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def configuration_hash(configuration: Mapping[str, object]) -> str:
    encoded = json.dumps(
        configuration,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def scientific_version_hash() -> str:
    digest = hashlib.sha256()
    for path in SCIENTIFIC_SOURCE_FILES:
        digest.update(path.name.encode("utf-8"))
        digest.update(path.read_bytes())
    return digest.hexdigest()


def dataset_fingerprint(dataset_id: str, storage_dir: Path = STORAGE_DIR) -> str:
    try:
        canonical_id = str(UUID(dataset_id))
    except ValueError as exc:
        raise FileNotFoundError("The checkpoint dataset identifier is invalid.") from exc
    csv_path = storage_dir / f"{canonical_id}.csv"
    metadata_path = storage_dir / f"{canonical_id}.json"
    if not csv_path.is_file() or not metadata_path.is_file():
        raise FileNotFoundError("The checkpoint dataset file is missing.")
    digest = hashlib.sha256()
    for path in (csv_path, metadata_path):
        with path.open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(chunk)
    return digest.hexdigest()


def encode_random_state(state: tuple[object, ...]) -> list[object]:
    """Convert Random.getstate() tuples to JSON/BSON-safe nested lists."""

    def convert(value: object) -> object:
        if isinstance(value, tuple):
            return [convert(item) for item in value]
        if value is None or isinstance(value, (int, float, str, bool)):
            return value
        raise ValueError("The Python RNG state contains an unsupported value.")

    converted = convert(state)
    if not isinstance(converted, list):  # pragma: no cover - getstate invariant
        raise ValueError("The Python RNG state is invalid.")
    return converted


def decode_random_state(value: object) -> tuple[object, ...]:
    """Restore a trusted shape without using pickle or executable data."""

    def convert(item: object) -> object:
        if isinstance(item, list):
            return tuple(convert(nested) for nested in item)
        if item is None or isinstance(item, (int, float, str, bool)):
            return item
        raise ValueError("The stored Python RNG state is invalid.")

    converted = convert(value)
    if not isinstance(converted, tuple) or len(converted) != 3:
        raise ValueError("The stored Python RNG state is invalid.")
    probe = random.Random()
    try:
        probe.setstate(converted)
    except (TypeError, ValueError) as exc:
        raise ValueError("The stored Python RNG state is invalid.") from exc
    return converted


def json_safe_checkpoint(state: Mapping[str, object]) -> dict[str, object]:
    try:
        encoded = json.dumps(state, allow_nan=False, separators=(",", ":"))
        decoded = json.loads(encoded)
    except (TypeError, ValueError) as exc:
        raise ValueError("Checkpoint state must be finite and JSON safe.") from exc
    if not isinstance(decoded, dict):  # pragma: no cover - mapping invariant
        raise ValueError("Checkpoint state must be an object.")
    return decoded


class CheckpointRepository(Protocol):
    def resolve_workspace_id(self, dataset_id: str) -> str: ...
    def resolve_project_id(self, dataset_id: str) -> str | None: ...
    def register_run(self, **values: object) -> None: ...
    def save_checkpoint(self, **values: object) -> dict[str, object]: ...
    def load_checkpoint(self, job_id: str) -> dict[str, object] | None: ...
    def list_recoverable_runs(self, mode: str) -> list[dict[str, object]]: ...
    def acquire_lease(self, job_id: str, worker_id: str) -> bool: ...
    def heartbeat(self, job_id: str, worker_id: str) -> bool: ...
    def update_run_status(self, job_id: str, status: str, **values: object) -> None: ...
    def request_cancellation(self, job_id: str) -> None: ...


class LeaseHeartbeat:
    """Renew an owned lease on a timer, independently of GA evaluations."""

    def __init__(
        self,
        repository: CheckpointRepository,
        job_id: str,
        worker_id: str,
        *,
        interval_seconds: float = LEASE_SECONDS / 3,
    ) -> None:
        self.repository = repository
        self.job_id = job_id
        self.worker_id = worker_id
        self.interval_seconds = interval_seconds
        self._stop = Event()
        self._thread = Thread(
            target=self._run,
            name=f"ga-lease-{job_id[:8]}",
            daemon=True,
        )

    def start(self) -> None:
        # Renew once synchronously so a newly acquired lease is protected even
        # when the heartbeat thread is briefly delayed by process startup load.
        try:
            self.repository.heartbeat(self.job_id, self.worker_id)
        except Exception:
            # The background loop retains the existing transient-outage policy.
            pass
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread.is_alive():
            self._thread.join(timeout=max(self.interval_seconds * 2, 0.1))

    def _run(self) -> None:
        while not self._stop.wait(self.interval_seconds):
            try:
                if not self.repository.heartbeat(self.job_id, self.worker_id):
                    return
            except Exception:
                # A transient persistence outage must not terminate scientific work.
                continue


class MongoOptimizationCheckpointRepository:
    """Persist only the latest completed-generation state per GA job."""

    def __init__(self, database: Any) -> None:
        self.datasets = database["datasets"]
        self.projects = database["projects"]
        self.runs = database["optimization_runs"]
        self.checkpoints = database["optimization_checkpoints"]

    def ensure_indexes(self) -> None:
        self.checkpoints.create_index("job_id", unique=True)
        self.checkpoints.create_index([("workspace_id", ASCENDING), ("updated_at", DESCENDING)])
        ensure_compatible_index(
            self.checkpoints,
            [("project_id", ASCENDING), ("job_id", ASCENDING)],
            sparse=True,
        )
        self.runs.create_index("job_id", unique=True, sparse=True)
        self.runs.create_index([("lifecycle_status", ASCENDING), ("lease_expires_at", ASCENDING)])
        ensure_compatible_index(
            self.runs,
            [("project_id", ASCENDING), ("job_id", ASCENDING)],
            sparse=True,
        )

    def resolve_workspace_id(self, dataset_id: str) -> str:
        document = self.datasets.find_one(
            {"dataset_id": dataset_id},
            sort=[("updated_at", DESCENDING)],
        )
        workspace_id = document.get("workspace_id") if document else None
        return str(workspace_id) if workspace_id else UNLINKED_WORKSPACE_ID

    def resolve_project_id(self, dataset_id: str) -> str | None:
        document = self.datasets.find_one(
            {"dataset_id": dataset_id}, sort=[("updated_at", DESCENDING)]
        )
        project_id = document.get("project_id") if document else None
        return str(project_id) if project_id else None

    def validate_project_dataset(self, project_id: str, dataset_id: str) -> str | None:
        project = self.projects.find_one({"project_id": project_id})
        if project is None:
            return "project_missing"
        dataset = self.datasets.find_one(
            {"project_id": project_id, "dataset_id": dataset_id, "status": {"$ne": "removed"}}
        )
        return None if dataset is not None else "dataset_project_mismatch"

    def is_project_scoped_job(self, job_id: str) -> bool:
        return self.runs.find_one({"job_id": job_id, "project_id": {"$exists": True}}) is not None

    def register_run(self, **values: object) -> None:
        job_id = str(values["job_id"])
        now = utc_now()
        document = json_safe_checkpoint(values)
        self.runs.update_one(
            {"job_id": job_id},
            {
                "$set": {
                    **document,
                    "job_id": job_id,
                    "run_id": job_id,
                    "updated_at": now,
                },
                "$setOnInsert": {"created_at": now},
            },
            upsert=True,
        )

    def save_checkpoint(self, **values: object) -> dict[str, object]:
        job_id = str(values["job_id"])
        now = utc_now()
        document = json_safe_checkpoint(values)
        updated = self.checkpoints.find_one_and_update(
            {"job_id": job_id},
            {
                "$set": {
                    **document,
                    "job_id": job_id,
                    "checkpoint_version": CHECKPOINT_VERSION,
                    "updated_at": now,
                },
                "$setOnInsert": {"created_at": now, "checkpoint_sequence": 0},
                "$inc": {"checkpoint_sequence": 1},
            },
            upsert=True,
            return_document=ReturnDocument.AFTER,
        )
        return deepcopy(updated or {})

    def load_checkpoint(self, job_id: str) -> dict[str, object] | None:
        document = self.checkpoints.find_one({"job_id": job_id})
        return deepcopy(document) if document else None

    def list_recoverable_runs(self, mode: str) -> list[dict[str, object]]:
        return [
            deepcopy(document)
            for document in self.runs.find(
                {"mode": mode, "lifecycle_status": {"$in": list(RECOVERABLE_STATUSES)}}
            )
        ]

    def acquire_lease(self, job_id: str, worker_id: str) -> bool:
        now = utc_now()
        leased = self.runs.find_one_and_update(
            {
                "job_id": job_id,
                "lifecycle_status": {"$in": list(RECOVERABLE_STATUSES)},
                "$or": [
                    {"worker_id": worker_id},
                    {"lease_expires_at": {"$exists": False}},
                    {"lease_expires_at": None},
                    {"lease_expires_at": {"$lte": now}},
                ],
            },
            {"$set": {
                "worker_id": worker_id,
                "heartbeat_at": now,
                "lease_expires_at": now + timedelta(seconds=LEASE_SECONDS),
                "updated_at": now,
            }},
            return_document=ReturnDocument.AFTER,
        )
        return leased is not None

    def heartbeat(self, job_id: str, worker_id: str) -> bool:
        now = utc_now()
        result = self.runs.update_one(
            {"job_id": job_id, "worker_id": worker_id},
            {"$set": {
                "heartbeat_at": now,
                "lease_expires_at": now + timedelta(seconds=LEASE_SECONDS),
                "updated_at": now,
            }},
        )
        return bool(result.modified_count or result.matched_count)

    def update_run_status(self, job_id: str, status: str, **values: object) -> None:
        now = utc_now()
        safe_values = json_safe_checkpoint(values)
        status_values: dict[str, object] = {
            **safe_values,
            "lifecycle_status": status,
            "updated_at": now,
        }
        if status not in RECOVERABLE_STATUSES:
            status_values["lease_expires_at"] = None
        self.runs.update_one(
            {"job_id": job_id},
            {"$set": status_values},
        )
        run = self.runs.find_one({"job_id": job_id}) or {"job_id": job_id}
        checkpoint_context = {
            key: run[key]
            for key in (
                "job_id",
                "workspace_id",
                "project_id",
                "mode",
                "submitted_configuration",
                "dataset_id",
                "configuration_hash",
                "dataset_fingerprint",
                "scientific_version_hash",
            )
            if key in run
        }
        self.checkpoints.update_one(
            {"job_id": job_id},
            {
                "$set": {
                    **checkpoint_context,
                    **safe_values,
                    "lifecycle_status": status,
                    "updated_at": now,
                },
                "$setOnInsert": {
                    "created_at": now,
                    "checkpoint_version": CHECKPOINT_VERSION,
                    "checkpoint_sequence": 0,
                },
            },
            upsert=True,
        )

    def request_cancellation(self, job_id: str) -> None:
        now = utc_now()
        self.runs.update_one(
            {"job_id": job_id},
            {"$set": {
                "cancellation_requested": True,
                "lifecycle_status": "cancelling",
                "updated_at": now,
            }},
        )
        run = self.runs.find_one({"job_id": job_id}) or {"job_id": job_id}
        checkpoint_context = {
            key: run[key]
            for key in (
                "job_id",
                "workspace_id",
                "mode",
                "submitted_configuration",
                "dataset_id",
                "configuration_hash",
                "dataset_fingerprint",
                "scientific_version_hash",
            )
            if key in run
        }
        self.checkpoints.update_one(
            {"job_id": job_id},
            {
                "$set": {
                    **checkpoint_context,
                    "cancellation_requested": True,
                    "lifecycle_status": "cancelling",
                    "updated_at": now,
                },
                "$setOnInsert": {
                    "created_at": now,
                    "checkpoint_version": CHECKPOINT_VERSION,
                    "checkpoint_sequence": 0,
                },
            },
            upsert=True,
        )


def validate_recovery_document(
    run: Mapping[str, object],
    checkpoint: Mapping[str, object] | None,
    *,
    current_dataset_fingerprint: str,
    current_scientific_hash: str,
) -> str | None:
    configuration = run.get("submitted_configuration")
    if not isinstance(configuration, Mapping):
        return "checkpoint_invalid"
    try:
        expected_configuration_hash = configuration_hash(configuration)
    except (TypeError, ValueError):
        return "checkpoint_invalid"
    if run.get("configuration_hash") != expected_configuration_hash:
        return "configuration_changed"
    if run.get("dataset_fingerprint") != current_dataset_fingerprint:
        return "dataset_changed"
    if run.get("scientific_version_hash") != current_scientific_hash:
        return "scientific_version_changed"
    project_id = run.get("project_id")
    if project_id is not None and checkpoint is not None and checkpoint.get("project_id") != project_id:
        return "project_changed"
    if checkpoint is None:
        return None
    if checkpoint.get("checkpoint_version") != CHECKPOINT_VERSION:
        return "checkpoint_invalid"
    if checkpoint.get("configuration_hash") != expected_configuration_hash:
        return "configuration_changed"
    if checkpoint.get("dataset_fingerprint") != current_dataset_fingerprint:
        return "dataset_changed"
    if checkpoint.get("scientific_version_hash") != current_scientific_hash:
        return "scientific_version_changed"
    mode = run.get("mode")
    ga_state = checkpoint.get("ga_state")
    if mode == "single" and not isinstance(ga_state, Mapping):
        return "checkpoint_invalid"
    if ga_state is not None:
        if not isinstance(ga_state, Mapping):
            return "checkpoint_invalid"
        required_ga_fields = {
            "last_completed_generation",
            "next_generation",
            "population",
            "python_rng_state",
            "best_penalized_result",
            "convergence_history",
            "evaluations_completed",
        }
        if not required_ga_fields.issubset(ga_state):
            return "checkpoint_invalid"
        try:
            decode_random_state(ga_state["python_rng_state"])
        except (KeyError, TypeError, ValueError):
            return "checkpoint_invalid"
    if mode == "comparison":
        comparison_state = checkpoint.get("comparison_state")
        if not isinstance(comparison_state, Mapping):
            return "checkpoint_invalid"
        if not {
            "current_battery_index",
            "total_battery_count",
            "completed_battery_results",
            "total_evaluations_completed",
            "ga_state",
        }.issubset(comparison_state):
            return "checkpoint_invalid"
    return None
