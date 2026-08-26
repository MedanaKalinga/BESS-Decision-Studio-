from __future__ import annotations

import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from threading import RLock

from app.api.single_optimization_jobs import SingleOptimizationJobManager
from app.schemas.comparison_optimization_jobs import ComparisonOptimizationRunRequest
from app.schemas.single_optimization_jobs import SingleOptimizationRunRequest
from app.services.comparison_ga_service import run_comparison_job
from app.services.comparison_job_store import ComparisonOptimizationJobStore
from app.services.mongo_index_service import ensure_compatible_index
from app.services.optimization_checkpoint_service import (
    CHECKPOINT_VERSION,
    LeaseHeartbeat,
    MongoOptimizationCheckpointRepository,
    configuration_hash,
    decode_random_state,
    encode_random_state,
    validate_recovery_document,
)
from app.services.optimization_job_store import OptimizationJobStore
from app.services.single_ga_service import OptimizationCancelled, run_single_ga


def battery(name: str = "Test battery") -> dict[str, object]:
    return {
        "name": name,
        "price_rs_per_kwh": 44_000.0,
        "rated_cycle_life": 3_000.0,
        "eta_ch": 0.92,
        "eta_dis": 0.92,
        "weight_density_kg_per_kwh": 8.5,
        "warranty_years": 5.0,
    }


def economics() -> dict[str, object]:
    return {
        "project_life_years": 25,
        "discount_rate": 0.10,
        "export_tariff_rs_per_kwh": 21.0,
        "annual_om_fraction": 0.01,
        "replacement_cost_fraction": 0.80,
        "residual_value_enabled": False,
    }


def records() -> list[dict[str, object]]:
    return [
        {"pv_kw": 2.0, "ev_kw": 3.0, "tariff_rs_per_kwh": 25.0},
        {"pv_kw": 4.0, "ev_kw": 1.0, "tariff_rs_per_kwh": 25.0},
    ]


def evaluator_calls(log: list[tuple[str, float, float]]):
    def evaluate(**values: object) -> dict[str, object]:
        selected_battery = values["battery"]
        if hasattr(selected_battery, "model_dump"):
            selected_battery = selected_battery.model_dump()
        assert isinstance(selected_battery, dict)
        capacity = float(values["bess_capacity_kwh"])
        peak = float(values["peak_support_pct"])
        name = str(selected_battery["name"])
        log.append((name, capacity, peak))
        raw_cost = capacity * 100.0 + peak * 10.0 + float(selected_battery["price_rs_per_kwh"])
        return {
            "bess_capacity_kwh": capacity,
            "peak_support_pct": peak,
            "battery_name": name,
            "round_trip_efficiency": float(selected_battery["eta_ch"]) * float(selected_battery["eta_dis"]),
            "annual_grid_import_kwh": capacity / 10.0,
            "annual_pv_export_kwh": peak,
            "annual_bess_charge_kwh": capacity / 20.0,
            "annual_bess_discharge_kwh": capacity / 25.0,
            "equivalent_cycles_per_year": 100.0,
            "cycle_based_life_years": float(selected_battery["rated_cycle_life"]) / 100.0,
            "replacement_years": [],
            "annualized_bess_lifecycle_cost_rs": raw_cost / 2.0,
            "annual_om_cost_rs": raw_cost * 0.01,
            "annual_grid_cost_rs": raw_cost,
            "annual_export_revenue_rs": peak,
            "total_annual_cost_rs": raw_cost,
            "peak_support_success_pct": 100.0,
            "pv_self_consumption_pct": 100.0,
            "peak_support_threshold_pct": 95.0,
            "pv_self_consumption_threshold_pct": 40.0,
            "peak_support_constraint_passed": True,
            "pv_self_consumption_constraint_passed": True,
            "is_feasible": True,
            "peak_support_penalty_rs": 0.0,
            "pv_self_consumption_penalty_rs": 0.0,
            "total_penalty_rs": 0.0,
            "fitness_rs": raw_cost,
            "minimum_soc_pct": 20.0,
            "maximum_soc_pct": 90.0,
            "validation_warnings": [],
        }
    return evaluate


def ga_arguments(log: list[tuple[str, float, float]], **overrides: object) -> dict[str, object]:
    arguments: dict[str, object] = {
        "records": records(),
        "battery": battery(),
        "economic_settings": economics(),
        "dispatch_strategy_status": "Reference Strategy",
        "minimum_bess_capacity_kwh": 100.0,
        "maximum_bess_capacity_kwh": 500.0,
        "minimum_peak_support_pct": 20.0,
        "maximum_peak_support_pct": 50.0,
        "population_size": 4,
        "generations": 4,
        "mutation_probability": 0.15,
        "elite_count": 1,
        "random_seed": 123,
        "evaluator": evaluator_calls(log),
        "clock": lambda: 0.0,
    }
    arguments.update(overrides)
    return arguments


def single_request() -> SingleOptimizationRunRequest:
    return SingleOptimizationRunRequest(**{
        "dataset_id": "00000000-0000-0000-0000-000000000001",
        "battery": battery(),
        "economic_settings": economics(),
        "dispatch_strategy_status": "Reference Strategy",
        "minimum_bess_capacity_kwh": 100.0,
        "maximum_bess_capacity_kwh": 500.0,
        "minimum_peak_support_pct": 20.0,
        "maximum_peak_support_pct": 50.0,
        "ga_settings": {"population_size": 4, "generations": 4, "mutation_probability": 0.15, "elite_count": 1, "random_seed": 123},
    })


class MemoryCheckpointRepository:
    def __init__(self) -> None:
        self.runs: dict[str, dict[str, object]] = {}
        self.checkpoints: dict[str, dict[str, object]] = {}
        self.leases: dict[str, str] = {}
        self.lock = RLock()

    def resolve_workspace_id(self, _dataset_id: str) -> str:
        return "00000000-0000-0000-0000-000000000002"

    def register_run(self, **values: object) -> None:
        self.runs[str(values["job_id"])] = deepcopy(dict(values))

    def save_checkpoint(self, **values: object) -> dict[str, object]:
        document = deepcopy(dict(values))
        document["checkpoint_version"] = CHECKPOINT_VERSION
        self.checkpoints[str(values["job_id"])] = document
        return deepcopy(document)

    def load_checkpoint(self, job_id: str) -> dict[str, object] | None:
        value = self.checkpoints.get(job_id)
        return deepcopy(value) if value else None

    def list_recoverable_runs(self, mode: str) -> list[dict[str, object]]:
        return [deepcopy(run) for run in self.runs.values() if run.get("mode") == mode and run.get("lifecycle_status") in {"queued", "running", "cancelling"}]

    def acquire_lease(self, job_id: str, worker_id: str) -> bool:
        with self.lock:
            owner = self.leases.get(job_id)
            if owner not in {None, worker_id}:
                return False
            self.leases[job_id] = worker_id
            return True

    def heartbeat(self, job_id: str, worker_id: str) -> bool:
        return self.leases.get(job_id) == worker_id

    def update_run_status(self, job_id: str, status: str, **values: object) -> None:
        run = self.runs.setdefault(job_id, {"job_id": job_id})
        run.update(deepcopy(values))
        run["lifecycle_status"] = status
        if status not in {"queued", "running", "cancelling"}:
            self.leases.pop(job_id, None)
        if job_id in self.checkpoints:
            self.checkpoints[job_id]["lifecycle_status"] = status

    def request_cancellation(self, job_id: str) -> None:
        self.runs[job_id]["cancellation_requested"] = True
        self.runs[job_id]["lifecycle_status"] = "cancelling"


class RecordingCollection:
    def __init__(self, existing: dict[str, dict[str, object]] | None = None) -> None:
        self.indexes: list[tuple[object, dict[str, object]]] = []
        self.existing = existing or {}

    def create_index(self, keys: object, **options: object) -> None:
        self.indexes.append((keys, options))

    def index_information(self) -> dict[str, dict[str, object]]:
        return self.existing


class RecordingDatabase:
    def __init__(self) -> None:
        self.collections: dict[str, RecordingCollection] = {}

    def __getitem__(self, name: str) -> RecordingCollection:
        return self.collections.setdefault(name, RecordingCollection())


class CheckpointIndexCompatibilityTests(unittest.TestCase):
    def test_project_job_indexes_remain_sparse_for_legacy_documents(self) -> None:
        database = RecordingDatabase()
        MongoOptimizationCheckpointRepository(database).ensure_indexes()

        for collection_name in ("optimization_checkpoints", "optimization_runs"):
            project_job_options = [
                options
                for keys, options in database[collection_name].indexes
                if keys == [("project_id", 1), ("job_id", 1)]
            ]
            self.assertEqual(project_job_options, [{"sparse": True}])

    def test_existing_non_sparse_project_job_index_is_reused(self) -> None:
        collection = RecordingCollection({
            "project_id_1_job_id_1": {
                "key": [("project_id", 1), ("job_id", 1)],
            }
        })

        name = ensure_compatible_index(
            collection,
            [("project_id", 1), ("job_id", 1)],
            sparse=True,
        )

        self.assertEqual(name, "project_id_1_job_id_1")
        self.assertEqual(collection.indexes, [])


class TestGenerationCheckpointing(unittest.TestCase):
    def test_checkpoint_is_saved_after_each_generation(self) -> None:
        checkpoints: list[dict[str, object]] = []
        log: list[tuple[str, float, float]] = []
        result = run_single_ga(**ga_arguments(log, checkpoint_callback=lambda state: checkpoints.append(deepcopy(state))))
        self.assertEqual([item["last_completed_generation"] for item in checkpoints], [1, 2, 3, 4])
        self.assertEqual(result["total_fitness_evaluations"], 16)
        self.assertEqual(checkpoints[-1]["evaluations_completed"], 16)

    def test_interrupted_resume_matches_uninterrupted_rng_sequence_and_result(self) -> None:
        uninterrupted_log: list[tuple[str, float, float]] = []
        uninterrupted = run_single_ga(**ga_arguments(uninterrupted_log))

        interrupted_log: list[tuple[str, float, float]] = []
        saved: dict[str, object] = {}

        def stop_after_two(state: dict[str, object]) -> None:
            saved.clear()
            saved.update(deepcopy(state))
            if state["last_completed_generation"] == 2:
                raise RuntimeError("simulated process interruption")

        with self.assertRaisesRegex(RuntimeError, "simulated process interruption"):
            run_single_ga(**ga_arguments(interrupted_log, checkpoint_callback=stop_after_two))
        resumed_log: list[tuple[str, float, float]] = []
        resumed = run_single_ga(**ga_arguments(resumed_log, resume_state=saved))

        self.assertEqual(len(interrupted_log), 8)
        self.assertEqual(len(resumed_log), 8)
        self.assertEqual(interrupted_log + resumed_log, uninterrupted_log)
        uninterrupted_without_runtime = {key: value for key, value in uninterrupted.items() if key != "runtime_seconds"}
        resumed_without_runtime = {key: value for key, value in resumed.items() if key != "runtime_seconds"}
        self.assertEqual(resumed_without_runtime, uninterrupted_without_runtime)
        self.assertEqual([point["generation"] for point in resumed["convergence_history"]], [1, 2, 3, 4])

    def test_rng_state_round_trip_continues_the_exact_sequence(self) -> None:
        import random
        rng = random.Random(77)
        _ = [rng.random() for _ in range(5)]
        restored = random.Random()
        restored.setstate(decode_random_state(encode_random_state(rng.getstate())))
        self.assertEqual([rng.random() for _ in range(10)], [restored.random() for _ in range(10)])

    def test_cancellation_preserves_last_completed_generation_checkpoint(self) -> None:
        checkpoints: list[dict[str, object]] = []
        cancel = {"requested": False}

        def progress(_generation: int, evaluations: int, _best: dict[str, object]) -> None:
            if evaluations == 1:
                cancel["requested"] = True

        with self.assertRaises(OptimizationCancelled):
            run_single_ga(**ga_arguments([], progress_callback=progress, cancellation_requested=lambda: cancel["requested"], checkpoint_callback=lambda state: checkpoints.append(deepcopy(state))))
        self.assertEqual(checkpoints[-1]["last_completed_generation"], 1)
        self.assertEqual(checkpoints[-1]["evaluations_completed"], 4)


class TestComparisonCheckpointing(unittest.TestCase):
    def test_completed_battery_is_not_rerun_and_current_battery_resumes(self) -> None:
        request = ComparisonOptimizationRunRequest(**{
            **single_request().model_dump(exclude={"battery"}),
            "batteries": [
                {"enabled": True, "battery": battery("Battery 1")},
                {"enabled": True, "battery": battery("Battery 2")},
                {"enabled": True, "battery": battery("Battery 3")},
            ],
        })
        first_log: list[tuple[str, float, float]] = []
        saved: dict[str, object] = {}

        def runner_one(**values: object) -> dict[str, object]:
            return run_single_ga(**values, evaluator=evaluator_calls(first_log), clock=lambda: 0.0)

        def interrupt(state: dict[str, object]) -> None:
            saved.clear()
            saved.update(deepcopy(state))
            ga_state = state.get("ga_state")
            if state.get("current_battery_index") == 1 and isinstance(ga_state, dict) and ga_state.get("last_completed_generation") == 1:
                raise RuntimeError("comparison interruption")

        store_one = ComparisonOptimizationJobStore()
        job_one = store_one.create(request.model_dump(), 4, 48, 3)
        with self.assertLogs("app.services.comparison_ga_service", level="ERROR"):
            run_comparison_job(store=store_one, job_id=job_one, request=request, records=records(), enabled_batteries=[option for option in request.batteries if option.enabled], runner=runner_one, checkpoint_callback=interrupt)
        self.assertEqual(store_one.snapshot(job_one)["status"], "failed")

        second_log: list[tuple[str, float, float]] = []
        def runner_two(**values: object) -> dict[str, object]:
            return run_single_ga(**values, evaluator=evaluator_calls(second_log), clock=lambda: 0.0)
        store_two = ComparisonOptimizationJobStore()
        store_two.restore(job_id=job_one, request_snapshot=request.model_dump(), total_generations=4, estimated_total_evaluations=48, total_batteries=3, current_generation=1, current_battery_index=1, current_battery_evaluations_completed=4, total_evaluations_completed=20, battery_results=list(saved["completed_battery_results"]))
        run_comparison_job(store=store_two, job_id=job_one, request=request, records=records(), enabled_batteries=[option for option in request.batteries if option.enabled], runner=runner_two, resume_state=saved)
        final = store_two.snapshot(job_one)
        self.assertEqual(final["status"], "completed")
        self.assertEqual(len(final["final_result"]["battery_results"]), 3)
        self.assertEqual(sum(name == "Battery 1" for name, _, _ in first_log), 16)
        self.assertEqual(sum(name == "Battery 1" for name, _, _ in second_log), 0)
        self.assertEqual(sum(name == "Battery 2" for name, _, _ in first_log + second_log), 16)
        self.assertEqual(sum(name == "Battery 3" for name, _, _ in second_log), 16)


class TestRecoveryValidationAndStartup(unittest.TestCase):
    def test_validation_blocks_changed_configuration_checkpoint_and_science(self) -> None:
        configuration = single_request().model_dump()
        base_run = {
            "mode": "single",
            "submitted_configuration": configuration,
            "configuration_hash": configuration_hash(configuration),
            "dataset_fingerprint": "dataset-v1",
            "scientific_version_hash": "science-v1",
        }
        checkpoint = {
            "checkpoint_version": CHECKPOINT_VERSION,
            "configuration_hash": base_run["configuration_hash"],
            "dataset_fingerprint": "dataset-v1",
            "scientific_version_hash": "science-v1",
            "ga_state": {
                "last_completed_generation": 1,
                "next_generation": 2,
                "population": [[100.0, 20.0]] * 4,
                "python_rng_state": encode_random_state(__import__("random").Random(1).getstate()),
                "best_penalized_result": {"fitness_rs": 1.0},
                "convergence_history": [{"generation": 1}],
                "evaluations_completed": 4,
            },
        }
        self.assertIsNone(validate_recovery_document(base_run, checkpoint, current_dataset_fingerprint="dataset-v1", current_scientific_hash="science-v1"))
        changed = deepcopy(base_run)
        changed["configuration_hash"] = "changed"
        self.assertEqual(validate_recovery_document(changed, checkpoint, current_dataset_fingerprint="dataset-v1", current_scientific_hash="science-v1"), "configuration_changed")
        corrupt = {**checkpoint, "checkpoint_version": 999}
        self.assertEqual(validate_recovery_document(base_run, corrupt, current_dataset_fingerprint="dataset-v1", current_scientific_hash="science-v1"), "checkpoint_invalid")
        self.assertEqual(validate_recovery_document(base_run, checkpoint, current_dataset_fingerprint="dataset-v1", current_scientific_hash="science-v2"), "scientific_version_changed")
        self.assertEqual(validate_recovery_document(base_run, checkpoint, current_dataset_fingerprint="dataset-v2", current_scientific_hash="science-v1"), "dataset_changed")
        project_run = {**base_run, "project_id": "project-a"}
        project_checkpoint = {**checkpoint, "project_id": "project-b"}
        self.assertEqual(validate_recovery_document(project_run, project_checkpoint, current_dataset_fingerprint="dataset-v1", current_scientific_hash="science-v1"), "project_changed")

    def test_repository_reconstruction_recovers_running_single_job(self) -> None:
        repository = MemoryCheckpointRepository()
        request = single_request()
        config = request.model_dump()
        interrupted_checkpoint: dict[str, object] = {}
        def stop(state: dict[str, object]) -> None:
            interrupted_checkpoint.update(deepcopy(state))
            if state["last_completed_generation"] == 1:
                raise RuntimeError("stop")
        with self.assertRaises(RuntimeError):
            run_single_ga(**ga_arguments([], checkpoint_callback=stop))
        job_id = "recovered-single-job"
        repository.register_run(job_id=job_id, workspace_id="workspace", mode="single", checkpoint_version=1, submitted_configuration=config, dataset_id=request.dataset_id, configuration_hash=configuration_hash(config), dataset_fingerprint="dataset", scientific_version_hash="science", lifecycle_status="running", cancellation_requested=False)
        repository.save_checkpoint(job_id=job_id, workspace_id="workspace", mode="single", submitted_configuration=config, dataset_id=request.dataset_id, configuration_hash=configuration_hash(config), dataset_fingerprint="dataset", scientific_version_hash="science", ga_state=interrupted_checkpoint)
        manager = SingleOptimizationJobManager(store=OptimizationJobStore(), executor=ThreadPoolExecutor(max_workers=1), runner=lambda **values: run_single_ga(**values, evaluator=evaluator_calls([]), clock=lambda: 0.0), checkpoint_repository=repository, fingerprint_factory=lambda _dataset_id: "dataset", scientific_hash_factory=lambda: "science", dataset_loader=lambda _dataset_id: (_dataset_id, records(), {}))
        try:
            summary = manager.recover_active_jobs()
            self.assertEqual(summary["recovered"], 1)
            deadline = time.monotonic() + 2
            while manager.snapshot(job_id)["status"] not in {"completed", "failed", "cancelled"} and time.monotonic() < deadline:
                time.sleep(0.01)
            snapshot = manager.snapshot(job_id)
            self.assertEqual(snapshot["status"], "completed")
            self.assertEqual(snapshot["evaluations_completed"], 16)
        finally:
            manager.shutdown(wait=True)

    def test_missing_dataset_blocks_recovery_and_preserves_checkpoint(self) -> None:
        repository = MemoryCheckpointRepository()
        config = single_request().model_dump()
        repository.register_run(job_id="missing", workspace_id="workspace", mode="single", checkpoint_version=1, submitted_configuration=config, dataset_id=config["dataset_id"], configuration_hash=configuration_hash(config), dataset_fingerprint="dataset", scientific_version_hash="science", lifecycle_status="running")
        repository.save_checkpoint(job_id="missing", workspace_id="workspace", mode="single", configuration_hash=configuration_hash(config), dataset_fingerprint="dataset", scientific_version_hash="science", ga_state={})
        manager = SingleOptimizationJobManager(checkpoint_repository=repository, fingerprint_factory=lambda _dataset_id: (_ for _ in ()).throw(FileNotFoundError()), scientific_hash_factory=lambda: "science")
        try:
            summary = manager.recover_active_jobs()
            self.assertEqual(summary["blocked"], 1)
            self.assertEqual(repository.runs["missing"]["lifecycle_status"], "resume_blocked")
            self.assertEqual(manager.snapshot("missing")["error"], "RECOVERY_BLOCKED: dataset_missing")
            self.assertIn("missing", repository.checkpoints)
        finally:
            manager.shutdown(wait=True)

    def test_cancellation_requested_job_is_finalized_and_never_resumed(self) -> None:
        repository = MemoryCheckpointRepository()
        config = single_request().model_dump()
        repository.register_run(job_id="cancelled", workspace_id="workspace", mode="single", checkpoint_version=1, submitted_configuration=config, dataset_id=config["dataset_id"], configuration_hash=configuration_hash(config), dataset_fingerprint="dataset", scientific_version_hash="science", lifecycle_status="cancelling", cancellation_requested=True)
        manager = SingleOptimizationJobManager(checkpoint_repository=repository, runner=lambda **_values: self.fail("cancelled job was resumed"), fingerprint_factory=lambda _dataset_id: "dataset", scientific_hash_factory=lambda: "science")
        try:
            summary = manager.recover_active_jobs()
            self.assertEqual(summary["cancelled"], 1)
            self.assertEqual(repository.runs["cancelled"]["lifecycle_status"], "cancelled")
        finally:
            manager.shutdown(wait=True)

    def test_only_one_worker_can_hold_the_job_lease(self) -> None:
        repository = MemoryCheckpointRepository()
        repository.runs["job"] = {"job_id": "job", "lifecycle_status": "running"}
        self.assertTrue(repository.acquire_lease("job", "worker-one"))
        self.assertFalse(repository.acquire_lease("job", "worker-two"))
        self.assertTrue(repository.heartbeat("job", "worker-one"))

    def test_lease_heartbeat_is_time_based_not_evaluation_based(self) -> None:
        repository = MemoryCheckpointRepository()
        repository.runs["job"] = {"job_id": "job", "lifecycle_status": "running"}
        self.assertTrue(repository.acquire_lease("job", "worker"))
        heartbeat_calls = 0
        original = repository.heartbeat
        def counted(job_id: str, worker_id: str) -> bool:
            nonlocal heartbeat_calls
            heartbeat_calls += 1
            return original(job_id, worker_id)
        repository.heartbeat = counted  # type: ignore[method-assign]
        heartbeat = LeaseHeartbeat(repository, "job", "worker", interval_seconds=0.01)
        heartbeat.start()
        time.sleep(0.035)
        heartbeat.stop()
        self.assertGreaterEqual(heartbeat_calls, 2)


if __name__ == "__main__":
    unittest.main()
