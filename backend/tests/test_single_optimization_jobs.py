import unittest
from concurrent.futures import Future, ThreadPoolExecutor
from datetime import datetime
from threading import Event, Thread
from time import monotonic
from unittest.mock import Mock, patch

from fastapi import HTTPException
from pydantic import ValidationError

from app.api.single_optimization_jobs import (
    SingleOptimizationJobManager,
    cancel_single_optimization_job,
    get_single_optimization_job,
    run_single_optimization,
)
from app.main import app
from app.schemas.single_optimization_jobs import SingleOptimizationRunRequest
from app.services.dataset_service import DatasetNotFoundError, DatasetRecord
from app.services.optimization_job_store import (
    JobNotFoundError,
    OptimizationJobStore,
)
from app.services.single_ga_service import OptimizationCancelled, run_single_ga


def battery_parameters() -> dict[str, object]:
    return {
        "name": "Submitted test battery",
        "price_rs_per_kwh": 44_000.0,
        "rated_cycle_life": 3_000.0,
        "eta_ch": 0.92,
        "eta_dis": 0.92,
        "weight_density_kg_per_kwh": 8.5,
        "warranty_years": 5.0,
    }


def economic_settings() -> dict[str, object]:
    return {
        "project_life_years": 25,
        "discount_rate": 0.08,
        "export_tariff_rs_per_kwh": 21.0,
        "annual_om_fraction": 0.01,
        "replacement_cost_fraction": 0.80,
        "residual_value_enabled": False,
    }


def run_payload(**overrides: object) -> dict[str, object]:
    payload: dict[str, object] = {
        "dataset_id": "00000000-0000-0000-0000-000000000001",
        "battery": battery_parameters(),
        "economic_settings": economic_settings(),
        "dispatch_strategy_status": "Reference Strategy",
        "minimum_bess_capacity_kwh": 100.0,
        "maximum_bess_capacity_kwh": 500.0,
        "minimum_peak_support_pct": 20.0,
        "maximum_peak_support_pct": 50.0,
        "ga_settings": {
            "population_size": 4,
            "generations": 2,
            "mutation_probability": 0.15,
            "elite_count": 1,
            "random_seed": 42,
        },
    }
    payload.update(overrides)
    return payload


def request_model(**overrides: object) -> SingleOptimizationRunRequest:
    return SingleOptimizationRunRequest(**run_payload(**overrides))


def sample_records() -> list[DatasetRecord]:
    return [
        DatasetRecord(
            timestamp=datetime(2025, 1, 1),
            pv_kw=10.0,
            ev_kw=8.0,
            tariff_rs_per_kwh=25.0,
        )
    ]


def progress_result(
    *,
    capacity_kwh: float = 200.0,
    peak_support_pct: float = 30.0,
    cost_rs: float = 123_456.0,
) -> dict[str, object]:
    return {
        "bess_capacity_kwh": capacity_kwh,
        "peak_support_pct": peak_support_pct,
        "total_annual_cost_rs": cost_rs,
        "fitness_rs": cost_rs,
        "is_feasible": True,
    }


def wait_for_status(
    manager: SingleOptimizationJobManager,
    job_id: str,
    expected_status: str,
    timeout_seconds: float = 2.0,
) -> dict[str, object]:
    deadline = monotonic() + timeout_seconds
    poll_event = Event()
    while True:
        snapshot = manager.snapshot(job_id)
        if snapshot["status"] == expected_status:
            return snapshot
        remaining = deadline - monotonic()
        if remaining <= 0:
            raise AssertionError(
                f"Job {job_id} did not reach {expected_status}; "
                f"last status was {snapshot['status']}."
            )
        poll_event.wait(min(0.01, remaining))


class TestOptimizationJobStore(unittest.TestCase):
    def test_transitions_cancellation_race_and_deep_copies(self) -> None:
        store = OptimizationJobStore()
        request = {"battery": {"name": "Original", "values": [1.0]}}
        job_id = store.create(request, 2, 8)
        request["battery"]["name"] = "Mutated externally"
        request["battery"]["values"].append(2.0)

        # The request is deliberately internal, but this assertion proves that
        # create() takes ownership of a detached snapshot.
        stored_request = store._jobs[job_id].request_snapshot
        self.assertEqual(
            stored_request,
            {"battery": {"name": "Original", "values": [1.0]}},
        )
        self.assertEqual(store.snapshot(job_id)["status"], "queued")
        self.assertTrue(store.claim(job_id))
        self.assertFalse(store.claim(job_id))

        self.assertTrue(
            store.update_progress(
                job_id,
                current_generation=1,
                evaluations_completed=2,
                current_best_capacity_kwh=200.0,
                current_best_peak_support_pct=30.0,
                current_best_total_annual_cost_rs=123_456.0,
                current_best_fitness_rs=123_456.0,
                current_best_is_feasible=True,
            )
        )
        running = store.snapshot(job_id)
        self.assertEqual(running["progress_percent"], 25.0)
        self.assertEqual(running["current_best_capacity_kwh"], 200.0)
        self.assertEqual(running["current_best_fitness_rs"], 123_456.0)
        self.assertTrue(running["current_best_is_feasible"])

        cancellation = store.request_cancel(job_id)
        self.assertEqual(cancellation["status"], "running")
        self.assertTrue(cancellation["cancellation_requested"])
        self.assertEqual(
            store.complete_or_cancel(job_id, {"should_not": "be stored"}),
            "cancelled",
        )
        cancelled = store.snapshot(job_id)
        self.assertEqual(cancelled["status"], "cancelled")
        self.assertIsNone(cancelled["final_result"])

        completed_id = store.create({}, 1, 4)
        self.assertTrue(store.claim(completed_id))
        final_result = {"warnings": [{"code": "ORIGINAL"}]}
        self.assertEqual(
            store.complete_or_cancel(completed_id, final_result),
            "completed",
        )
        final_result["warnings"].append({"code": "EXTERNAL"})
        first_snapshot = store.snapshot(completed_id)
        first_snapshot["final_result"]["warnings"].append(
            {"code": "SNAPSHOT_MUTATION"}
        )
        self.assertEqual(
            store.snapshot(completed_id)["final_result"],
            {"warnings": [{"code": "ORIGINAL"}]},
        )

        with self.assertRaises(JobNotFoundError):
            store.snapshot("unknown-job")


class TestSingleOptimizationJobManager(unittest.TestCase):
    def setUp(self) -> None:
        self.managers: list[SingleOptimizationJobManager] = []
        self.release_events: list[Event] = []

    def tearDown(self) -> None:
        # Always release controlled runners before waiting for their private
        # executors.  This also keeps failed assertions from leaking threads.
        for event in self.release_events:
            event.set()
        for manager in self.managers:
            manager.shutdown(wait=True)

    def make_manager(self, runner) -> SingleOptimizationJobManager:
        manager = SingleOptimizationJobManager(
            store=OptimizationJobStore(),
            executor=ThreadPoolExecutor(
                max_workers=1,
                thread_name_prefix="single-ga-test",
            ),
            runner=runner,
        )
        self.managers.append(manager)
        return manager

    def controlled_event(self) -> Event:
        event = Event()
        self.release_events.append(event)
        return event

    def test_progress_increases_and_status_read_stays_responsive(self) -> None:
        progress_published = Event()
        release_runner = self.controlled_event()

        def blocked_runner(*, progress_callback, **_kwargs):
            progress_callback(1, 1, progress_result())
            progress_published.set()
            if not release_runner.wait(2.0):
                raise RuntimeError("Test runner was not released.")
            return {"test_result": True}

        manager = self.make_manager(blocked_runner)
        job_id = manager.submit(request_model(), sample_records())
        self.assertTrue(progress_published.wait(1.0))

        read_finished = Event()
        response_holder: list[object] = []

        def read_status() -> None:
            with patch(
                "app.api.single_optimization_jobs.job_manager",
                manager,
            ):
                response_holder.append(get_single_optimization_job(job_id))
            read_finished.set()

        reader = Thread(target=read_status, name="job-status-reader")
        reader.start()
        self.assertTrue(
            read_finished.wait(0.5),
            "Status read blocked while the GA runner was still active.",
        )
        reader.join(timeout=0.5)
        self.assertFalse(release_runner.is_set())

        response = response_holder[0]
        self.assertEqual(response.status, "running")
        self.assertEqual(response.evaluations_completed, 1)
        self.assertEqual(response.progress_percent, 12.5)
        self.assertEqual(response.current_best_capacity_kwh, 200.0)
        self.assertEqual(response.current_best_fitness_rs, 123_456.0)
        self.assertTrue(response.current_best_is_feasible)

        release_runner.set()
        completed = wait_for_status(manager, job_id, "completed")
        self.assertEqual(completed["progress_percent"], 100.0)

    def test_running_cancellation_is_confirmed_at_runner_boundary(self) -> None:
        runner_started = Event()
        release_runner = self.controlled_event()

        def cancellable_runner(*, cancellation_requested, **_kwargs):
            runner_started.set()
            if not release_runner.wait(2.0):
                raise RuntimeError("Test runner was not released.")
            if cancellation_requested():
                raise OptimizationCancelled(0, 0)
            return {"test_result": True}

        manager = self.make_manager(cancellable_runner)
        job_id = manager.submit(request_model(), sample_records())
        self.assertTrue(runner_started.wait(1.0))

        cancellation = manager.cancel(job_id)
        self.assertEqual(cancellation["status"], "running")
        self.assertTrue(cancellation["cancellation_requested"])

        release_runner.set()
        cancelled = wait_for_status(manager, job_id, "cancelled")
        self.assertLess(cancelled["progress_percent"], 100.0)
        self.assertIsNone(cancelled["final_result"])

    def test_queued_cancellation_prevents_runner_execution(self) -> None:
        first_runner_started = Event()
        release_first_runner = self.controlled_event()
        second_runner_executed = Event()
        invocation_count = 0

        def queue_blocking_runner(**_kwargs):
            nonlocal invocation_count
            invocation_count += 1
            if invocation_count == 1:
                first_runner_started.set()
                if not release_first_runner.wait(2.0):
                    raise RuntimeError("Test runner was not released.")
            else:
                second_runner_executed.set()
            return {"test_result": True}

        manager = self.make_manager(queue_blocking_runner)
        first_job_id = manager.submit(request_model(), sample_records())
        self.assertTrue(first_runner_started.wait(1.0))
        queued_job_id = manager.submit(request_model(), sample_records())

        cancellation = manager.cancel(queued_job_id)
        self.assertEqual(cancellation["status"], "cancelled")
        self.assertTrue(cancellation["cancellation_requested"])
        self.assertFalse(second_runner_executed.is_set())

        release_first_runner.set()
        wait_for_status(manager, first_job_id, "completed")
        manager.shutdown(wait=True)
        self.assertFalse(second_runner_executed.is_set())
        self.assertEqual(manager.snapshot(queued_job_id)["status"], "cancelled")

    def test_failed_job_exposes_a_useful_error(self) -> None:
        runner_started = Event()

        def failing_runner(**_kwargs):
            runner_started.set()
            raise RuntimeError("deliberate evaluator failure")

        manager = self.make_manager(failing_runner)
        with self.assertLogs(
            "app.api.single_optimization_jobs",
            level="ERROR",
        ):
            job_id = manager.submit(request_model(), sample_records())
            self.assertTrue(runner_started.wait(1.0))
            failed = wait_for_status(manager, job_id, "failed")

        self.assertEqual(
            failed["error"],
            "RuntimeError: deliberate evaluator failure",
        )
        self.assertIsNone(failed["final_result"])

    def test_executor_submission_failure_does_not_leave_a_queued_job(self) -> None:
        store = OptimizationJobStore()
        executor = ThreadPoolExecutor(max_workers=1)
        executor.shutdown(wait=True)
        manager = SingleOptimizationJobManager(
            store=store,
            executor=executor,
            runner=lambda **_kwargs: {},
        )
        self.managers.append(manager)

        with self.assertRaises(RuntimeError):
            manager.submit(request_model(), sample_records())

        self.assertEqual(len(store._jobs), 1)
        job_id = next(iter(store._jobs))
        snapshot = store.snapshot(job_id)
        self.assertEqual(snapshot["status"], "failed")
        self.assertIn("could not be started", snapshot["error"])

    def test_shutdown_is_serialized_with_future_registration(self) -> None:
        class PausingExecutor:
            def __init__(self) -> None:
                self.submit_entered = Event()
                self.allow_submit_return = Event()
                self.shutdown_called = Event()
                self.future: Future[object] = Future()

            def submit(self, _fn, *_args) -> Future[object]:
                self.submit_entered.set()
                if not self.allow_submit_return.wait(1.0):
                    raise RuntimeError("Test submit was not released.")
                return self.future

            def shutdown(
                self,
                *,
                wait: bool = True,
                cancel_futures: bool = False,
            ) -> None:
                del wait
                if cancel_futures:
                    self.future.cancel()
                self.shutdown_called.set()

        executor = PausingExecutor()
        manager = SingleOptimizationJobManager(
            store=OptimizationJobStore(),
            executor=executor,
            runner=lambda **_kwargs: {},
        )
        self.managers.append(manager)
        submitted_job_ids: list[str] = []

        submitter = Thread(
            target=lambda: submitted_job_ids.append(
                manager.submit(request_model(), sample_records())
            ),
            name="job-submitter",
        )
        submitter.start()
        self.assertTrue(executor.submit_entered.wait(1.0))

        shutdown_started = Event()

        def shut_down_manager() -> None:
            shutdown_started.set()
            manager.shutdown(wait=True)

        shutdown_thread = Thread(
            target=shut_down_manager,
            name="job-manager-shutdown",
        )
        shutdown_thread.start()
        self.assertTrue(shutdown_started.wait(1.0))
        self.assertFalse(executor.shutdown_called.wait(0.05))

        executor.allow_submit_return.set()
        submitter.join(timeout=1.0)
        shutdown_thread.join(timeout=1.0)

        self.assertFalse(submitter.is_alive())
        self.assertFalse(shutdown_thread.is_alive())
        self.assertEqual(len(submitted_job_ids), 1)
        snapshot = manager.snapshot(submitted_job_ids[0])
        self.assertEqual(snapshot["status"], "cancelled")
        self.assertTrue(executor.shutdown_called.is_set())
        with self.assertRaisesRegex(RuntimeError, "shutting down"):
            manager.submit(request_model(), sample_records())

    def test_successful_run_and_get_return_the_completed_result_contract(self) -> None:
        manager = self.make_manager(run_single_ga)
        request = request_model()
        with (
            patch(
                "app.api.single_optimization_jobs.load_dataset_records",
                return_value=(request.dataset_id, sample_records(), {}),
            ),
            patch("app.api.single_optimization_jobs.job_manager", manager),
        ):
            accepted = run_single_optimization(request)
            self.assertEqual(accepted.status, "queued")
            wait_for_status(manager, accepted.job_id, "completed")
            response = get_single_optimization_job(accepted.job_id)

        self.assertEqual(response.status, "completed")
        self.assertEqual(response.progress_percent, 100.0)
        self.assertEqual(response.evaluations_completed, 8)
        self.assertIsNotNone(response.final_result)
        final_result = response.final_result
        assert final_result is not None
        self.assertEqual(final_result.ga_generations_completed, 2)
        self.assertEqual(final_result.total_fitness_evaluations, 8)
        self.assertEqual(len(final_result.convergence_history), 2)
        self.assertEqual(
            final_result.best_total_annual_cost_rs,
            final_result.total_annual_cost_rs,
        )
        self.assertEqual(final_result.best_fitness_rs, final_result.fitness_rs)
        self.assertEqual(final_result.solution_status, "feasible_solution")
        self.assertTrue(final_result.is_feasible)
        self.assertEqual(
            final_result.input_economic_configuration.discount_rate,
            request.economic_settings.discount_rate,
        )

    def test_unknown_job_status_and_cancel_return_http_404(self) -> None:
        manager = self.make_manager(lambda **_kwargs: {})
        with patch("app.api.single_optimization_jobs.job_manager", manager):
            for endpoint in (
                get_single_optimization_job,
                cancel_single_optimization_job,
            ):
                with self.subTest(endpoint=endpoint.__name__):
                    with self.assertRaises(HTTPException) as context:
                        endpoint("unknown-job")
                    self.assertEqual(context.exception.status_code, 404)
                    self.assertEqual(
                        context.exception.detail,
                        "Optimization job was not found.",
                    )


class TestSingleOptimizationJobApiContract(unittest.TestCase):
    def test_run_status_and_cancel_routes_are_registered(self) -> None:
        paths = app.openapi()["paths"]
        self.assertIn("post", paths["/api/single-optimization/run"])
        self.assertIn("get", paths["/api/single-optimization/jobs/{job_id}"])
        self.assertIn(
            "post",
            paths["/api/single-optimization/jobs/{job_id}/cancel"],
        )

    def test_modified_dispatch_is_rejected_with_exact_http_422_detail(self) -> None:
        request = request_model(dispatch_strategy_status="Modified Strategy")
        with patch(
            "app.api.single_optimization_jobs.load_dataset_records"
        ) as dataset_loader:
            with self.assertRaises(HTTPException) as context:
                run_single_optimization(request)

        self.assertEqual(context.exception.status_code, 422)
        self.assertEqual(
            context.exception.detail,
            {
                "code": "MODIFIED_DISPATCH_NOT_CONNECTED",
                "message": (
                    "The modified dispatch strategy will be supported after "
                    "scientific parity validation."
                ),
            },
        )
        dataset_loader.assert_not_called()

    def test_run_returns_the_queued_contract_before_background_completion(self) -> None:
        manager = Mock()
        manager.submit.return_value = "queued-job-id"
        request = request_model()
        with (
            patch(
                "app.api.single_optimization_jobs.load_dataset_records",
                return_value=(request.dataset_id, sample_records(), {}),
            ),
            patch("app.api.single_optimization_jobs.job_manager", manager),
        ):
            response = run_single_optimization(request)

        self.assertEqual(
            response.model_dump(),
            {"job_id": "queued-job-id", "status": "queued"},
        )
        manager.submit.assert_called_once()

    def test_run_rejects_an_unknown_dataset_before_queuing(self) -> None:
        with patch(
            "app.api.single_optimization_jobs.load_dataset_records",
            side_effect=DatasetNotFoundError("Dataset was not found."),
        ):
            with self.assertRaises(HTTPException) as context:
                run_single_optimization(request_model())
        self.assertEqual(context.exception.status_code, 404)
        self.assertEqual(context.exception.detail, "Dataset was not found.")

    def test_invalid_ga_settings_and_search_bounds_are_rejected(self) -> None:
        invalid_payloads = [
            run_payload(
                ga_settings={
                    **run_payload()["ga_settings"],
                    "population_size": 3,
                }
            ),
            run_payload(
                ga_settings={
                    **run_payload()["ga_settings"],
                    "generations": 0,
                }
            ),
            run_payload(
                ga_settings={
                    **run_payload()["ga_settings"],
                    "mutation_probability": 1.01,
                }
            ),
            run_payload(
                ga_settings={
                    **run_payload()["ga_settings"],
                    "elite_count": 0,
                }
            ),
            run_payload(
                ga_settings={
                    **run_payload()["ga_settings"],
                    "elite_count": 4,
                }
            ),
            run_payload(
                ga_settings={
                    **run_payload()["ga_settings"],
                    "random_seed": 42.0,
                }
            ),
            run_payload(
                minimum_bess_capacity_kwh=500.0,
                maximum_bess_capacity_kwh=500.0,
            ),
            run_payload(
                minimum_bess_capacity_kwh=1.0,
                maximum_bess_capacity_kwh=99.0,
            ),
            run_payload(
                minimum_peak_support_pct=50.0,
                maximum_peak_support_pct=50.0,
            ),
            run_payload(
                minimum_peak_support_pct=-1.0,
                maximum_peak_support_pct=50.0,
            ),
            run_payload(
                minimum_peak_support_pct=20.0,
                maximum_peak_support_pct=101.0,
            ),
        ]

        for payload in invalid_payloads:
            with self.subTest(payload=payload):
                with self.assertRaises(ValidationError):
                    SingleOptimizationRunRequest(**payload)


if __name__ == "__main__":
    unittest.main()
