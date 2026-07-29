import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from threading import Event
from time import monotonic
import time

from fastapi import HTTPException
from pydantic import ValidationError

from app.api.comparison_optimization_jobs import (
    ComparisonOptimizationJobManager,
    cancel_comparison_optimization_job,
    get_comparison_optimization_job,
    run_comparison_optimization,
)
from app.main import app
from app.schemas.comparison_optimization_jobs import (
    ComparisonOptimizationRunRequest,
)
from app.services.dataset_service import DatasetRecord
from app.services.optimization_job_store import JobNotFoundError
from app.services.single_ga_service import OptimizationCancelled
from app.services.single_simulation_service import REFERENCE_DISPATCH_STATUS


def battery_parameters(name: str) -> dict[str, object]:
    return {
        "name": name,
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
        "batteries": [
            {"enabled": True, "battery": battery_parameters("Battery A")},
            {"enabled": True, "battery": battery_parameters("Battery B")},
        ],
        "economic_settings": economic_settings(),
        "dispatch_strategy_status": REFERENCE_DISPATCH_STATUS,
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


def request_model(**overrides: object) -> ComparisonOptimizationRunRequest:
    return ComparisonOptimizationRunRequest(**run_payload(**overrides))


def sample_records() -> list[DatasetRecord]:
    return [
        DatasetRecord(
            timestamp=datetime(2025, 1, 1),
            pv_kw=10.0,
            ev_kw=8.0,
            tariff_rs_per_kwh=25.0,
        )
    ]


def wait_for_status(
    manager: ComparisonOptimizationJobManager,
    job_id: str,
    expected_status: str,
    timeout_seconds: float = 2.0,
) -> dict[str, object]:
    deadline = monotonic() + timeout_seconds
    while True:
        snapshot = manager.snapshot(job_id)
        if snapshot["status"] == expected_status:
            return snapshot
        if monotonic() >= deadline:
            raise AssertionError(
                f"Job {job_id} did not reach {expected_status}; last status was {snapshot['status']}."
            )


class TestComparisonOptimizationRunRequest(unittest.TestCase):
    def test_requires_at_least_two_enabled_battery_alternatives(self) -> None:
        with self.assertRaises(ValidationError):
            ComparisonOptimizationRunRequest(**run_payload(batteries=[]))

        with self.assertRaises(ValidationError):
            ComparisonOptimizationRunRequest(
                **run_payload(batteries=[{"enabled": False, "battery": battery_parameters("Disabled")}] )
            )

        with self.assertRaises(ValidationError):
            ComparisonOptimizationRunRequest(
                **run_payload(
                    batteries=[
                        {"enabled": True, "battery": battery_parameters("Only enabled")},
                        {"enabled": False, "battery": battery_parameters("Disabled")},
                    ]
                )
            )


class TestComparisonOptimizationJobManager(unittest.TestCase):
    def setUp(self) -> None:
        self.managers: list[ComparisonOptimizationJobManager] = []

    def tearDown(self) -> None:
        for manager in self.managers:
            manager.shutdown(wait=True)

    def make_manager(self, runner) -> ComparisonOptimizationJobManager:
        manager = ComparisonOptimizationJobManager(
            executor=ThreadPoolExecutor(max_workers=1, thread_name_prefix="comparison-test"),
            runner=runner,
        )
        self.managers.append(manager)
        return manager

    def test_enabled_batteries_run_and_partial_results_are_preserved(self) -> None:
        calls: list[dict[str, object]] = []

        def runner(*, battery, **_kwargs: object) -> dict[str, object]:
            calls.append({"battery_name": battery["name"]})
            return {
                "best_bess_capacity_kwh": 200.0,
                "best_peak_support_pct": 30.0,
                "best_total_annual_cost_rs": 1200.0,
                "best_fitness_rs": 1200.0,
                "ga_generations_completed": 2,
                "total_fitness_evaluations": 4,
                "convergence_history": [],
                "runtime_seconds": 0.1,
                "solution_status": "feasible_solution",
                "solution_message": "ok",
                "input_battery_configuration": battery,
                "input_economic_configuration": {"project_life_years": 25},
                "warnings": [],
                "validation_warnings": [],
                "annual_grid_import_kwh": 100.0,
                "annual_pv_export_kwh": 20.0,
                "annual_bess_charge_kwh": 50.0,
                "annual_bess_discharge_kwh": 40.0,
                "equivalent_cycles_per_year": 1.0,
                "cycle_based_life_years": 2000.0,
                "replacement_years": [],
                "annualized_bess_lifecycle_cost_rs": 1200.0,
                "annual_om_cost_rs": 10.0,
                "annual_grid_cost_rs": 100.0,
                "annual_export_revenue_rs": 20.0,
                "total_annual_cost_rs": 1200.0,
                "peak_support_success_pct": 100.0,
                "pv_self_consumption_pct": 100.0,
                "peak_support_threshold_pct": 50.0,
                "pv_self_consumption_threshold_pct": 100.0,
                "peak_support_constraint_passed": True,
                "pv_self_consumption_constraint_passed": True,
                "is_feasible": True,
                "peak_support_penalty_rs": 0.0,
                "pv_self_consumption_penalty_rs": 0.0,
                "total_penalty_rs": 0.0,
                "fitness_rs": 1200.0,
                "minimum_soc_pct": 0.0,
                "maximum_soc_pct": 100.0,
            }

        manager = self.make_manager(runner)
        request = request_model()
        job_id = manager.submit(request, sample_records())
        snapshot = wait_for_status(manager, job_id, "completed")

        self.assertEqual(len(calls), 2)
        self.assertEqual(snapshot["final_result"]["battery_results"][0]["battery_name"], "Battery A")
        self.assertEqual(snapshot["final_result"]["battery_results"][0]["total_annual_cost_Rs"], 1200.0)
        self.assertEqual(snapshot["final_result"]["battery_results"][0]["weight_density_kg_per_kwh"], 8.5)
        self.assertEqual(snapshot["final_result"]["battery_results"][0]["warranty_years"], 5.0)
        self.assertEqual(
            snapshot["final_result"]["battery_results"][0]["input_economic_configuration"],
            {"project_life_years": 25},
        )
        self.assertEqual(
            snapshot["final_result"]["comparison_solution_status"],
            "completed_all_batteries",
        )
        self.assertEqual(snapshot["final_result"]["feasible_battery_count"], 2)
        self.assertEqual(snapshot["final_result"]["infeasible_battery_count"], 0)

    def test_completed_result_reports_infeasible_alternatives(self) -> None:
        def runner(*, battery, **_kwargs: object) -> dict[str, object]:
            feasible = battery["name"] == "Battery A"
            return {
                "best_bess_capacity_kwh": 200.0,
                "best_peak_support_pct": 30.0,
                "best_total_annual_cost_rs": 1200.0,
                "best_fitness_rs": 1200.0 if feasible else 1_001_200.0,
                "ga_generations_completed": 2,
                "total_fitness_evaluations": 4,
                "convergence_history": [],
                "runtime_seconds": 0.1,
                "solution_status": (
                    "feasible_solution" if feasible else "no_feasible_candidate"
                ),
                "solution_message": "ok" if feasible else "diagnostic only",
                "input_battery_configuration": battery,
                "input_economic_configuration": economic_settings(),
                "total_annual_cost_rs": 1200.0,
                "cycle_based_life_years": 12.0,
                "round_trip_efficiency": 0.8464,
                "annual_om_cost_rs": 10.0,
                "peak_support_success_pct": 96.0 if feasible else 50.0,
                "pv_self_consumption_pct": 45.0,
                "peak_support_threshold_pct": 95.0,
                "pv_self_consumption_threshold_pct": 40.0,
                "peak_support_constraint_passed": feasible,
                "pv_self_consumption_constraint_passed": True,
                "peak_support_penalty_rs": 0.0 if feasible else 1_000_000.0,
                "pv_self_consumption_penalty_rs": 0.0,
                "total_penalty_rs": 0.0 if feasible else 1_000_000.0,
                "is_feasible": feasible,
            }

        manager = self.make_manager(runner)
        job_id = manager.submit(request_model(), sample_records())
        snapshot = wait_for_status(manager, job_id, "completed")

        final_result = snapshot["final_result"]
        self.assertEqual(
            final_result["comparison_solution_status"],
            "completed_with_infeasible_alternatives",
        )
        self.assertEqual(final_result["feasible_battery_count"], 1)
        self.assertEqual(final_result["infeasible_battery_count"], 1)
        diagnostic = final_result["battery_results"][1]
        self.assertEqual(diagnostic["solution_status"], "no_feasible_candidate")
        self.assertEqual(diagnostic["failed_constraints"], ["peak_support"])

    def test_total_evaluations_completed_is_cumulative_across_batteries(self) -> None:
        def runner(*, battery, progress_callback, **_kwargs: object) -> dict[str, object]:
            progress_callback(
                1,
                1,
                {
                    "bess_capacity_kwh": 200.0,
                    "peak_support_pct": 30.0,
                    "total_annual_cost_rs": 1000.0,
                    "fitness_rs": 1000.0,
                    "is_feasible": True,
                },
            )
            progress_callback(
                1,
                2,
                {
                    "bess_capacity_kwh": 200.0,
                    "peak_support_pct": 30.0,
                    "total_annual_cost_rs": 1000.0,
                    "fitness_rs": 1000.0,
                    "is_feasible": True,
                },
            )
            return {
                "best_bess_capacity_kwh": 200.0,
                "best_peak_support_pct": 30.0,
                "best_total_annual_cost_rs": 1200.0,
                "best_fitness_rs": 1200.0,
                "ga_generations_completed": 1,
                "total_fitness_evaluations": 2,
                "convergence_history": [],
                "runtime_seconds": 0.1,
                "solution_status": "feasible_solution",
                "solution_message": "ok",
                "input_battery_configuration": battery,
                "input_economic_configuration": {"project_life_years": 25},
                "warnings": [],
                "validation_warnings": [],
                "annual_grid_import_kwh": 100.0,
                "annual_pv_export_kwh": 20.0,
                "annual_bess_charge_kwh": 50.0,
                "annual_bess_discharge_kwh": 40.0,
                "equivalent_cycles_per_year": 1.0,
                "cycle_based_life_years": 2000.0,
                "replacement_years": [],
                "annualized_bess_lifecycle_cost_rs": 1200.0,
                "annual_om_cost_rs": 10.0,
                "annual_grid_cost_rs": 100.0,
                "annual_export_revenue_rs": 20.0,
                "total_annual_cost_rs": 1200.0,
                "peak_support_success_pct": 100.0,
                "pv_self_consumption_pct": 100.0,
                "peak_support_penalty_rs": 0.0,
                "pv_self_consumption_penalty_rs": 0.0,
                "total_penalty_rs": 0.0,
                "is_feasible": True,
                "minimum_soc_pct": 0.0,
                "maximum_soc_pct": 100.0,
            }

        manager = self.make_manager(runner)
        buses = [
            {"enabled": True, "battery": battery_parameters("Battery A")},
            {"enabled": True, "battery": battery_parameters("Battery B")},
        ]
        request = request_model(batteries=buses)
        job_id = manager.submit(request, sample_records())
        snapshot = wait_for_status(manager, job_id, "completed")

        self.assertEqual(snapshot["total_evaluations_completed"], 4)
        self.assertEqual(snapshot["total_estimated_evaluations"], 16)
        self.assertEqual(snapshot["current_battery_evaluations_completed"], 2)
        self.assertEqual(snapshot["completed_battery_count"], 2)

    def test_three_battery_progress_transitions_preserve_full_job_estimates(
        self,
    ) -> None:
        snapshots: list[dict[str, object]] = []
        battery_reset_events = {
            "Battery 1": Event(),
            "Battery 2": Event(),
            "Battery 3": Event(),
        }

        def runner(*, battery, progress_callback, **_kwargs: object) -> dict[str, object]:
            event = battery_reset_events.get(battery["name"], Event())
            event.wait()
            for evaluation in (1, 2):
                progress_callback(
                    1,
                    evaluation,
                    {
                        "bess_capacity_kwh": 200.0,
                        "peak_support_pct": 30.0,
                        "total_annual_cost_rs": 1000.0,
                        "fitness_rs": 1000.0,
                        "is_feasible": False,
                    },
                )
                time.sleep(0.03)
            return {
                "best_bess_capacity_kwh": 200.0,
                "best_peak_support_pct": 30.0,
                "best_total_annual_cost_rs": 1200.0,
                "best_fitness_rs": 1200.0,
                "ga_generations_completed": 1,
                "total_fitness_evaluations": 2,
                "convergence_history": [],
                "runtime_seconds": 0.1,
                "solution_status": "no_feasible_candidate",
                "solution_message": "no feasible candidate",
                "input_battery_configuration": battery,
                "input_economic_configuration": {"project_life_years": 25},
                "warnings": [],
                "validation_warnings": [],
                "annual_grid_import_kwh": 100.0,
                "annual_pv_export_kwh": 20.0,
                "annual_bess_charge_kwh": 50.0,
                "annual_bess_discharge_kwh": 40.0,
                "equivalent_cycles_per_year": 1.0,
                "cycle_based_life_years": 2000.0,
                "replacement_years": [],
                "annualized_bess_lifecycle_cost_rs": 1200.0,
                "annual_om_cost_rs": 10.0,
                "annual_grid_cost_rs": 100.0,
                "annual_export_revenue_rs": 20.0,
                "total_annual_cost_rs": 1200.0,
                "peak_support_success_pct": 100.0,
                "pv_self_consumption_pct": 100.0,
                "peak_support_penalty_rs": 0.0,
                "pv_self_consumption_penalty_rs": 0.0,
                "total_penalty_rs": 0.0,
                "is_feasible": False,
                "minimum_soc_pct": 0.0,
                "maximum_soc_pct": 100.0,
            }

        manager = self.make_manager(runner)
        batteries = [
            {"enabled": True, "battery": battery_parameters("Battery 1")},
            {"enabled": True, "battery": battery_parameters("Battery 2")},
            {"enabled": True, "battery": battery_parameters("Battery 3")},
        ]
        request = request_model(
            batteries=batteries,
            ga_settings={
                "population_size": 4,
                "generations": 1,
                "mutation_probability": 0.15,
                "elite_count": 1,
                "random_seed": 123,
            },
        )
        job_id = manager.submit(request, sample_records())

        last_progress = -1.0
        saw_battery_0_start = False
        saw_battery_1_start = False
        saw_battery_2_start = False
        saw_battery_0_reset = False
        saw_battery_1_reset = False
        saw_battery_2_reset = False
        saw_progress_100_before_complete = False
        while True:
            snapshot = manager.snapshot(job_id)
            snapshots.append(snapshot)
            total_estimated = snapshot["total_estimated_evaluations"]
            self.assertEqual(total_estimated, 12)
            self.assertGreaterEqual(snapshot["overall_progress_percent"], last_progress)
            last_progress = snapshot["overall_progress_percent"]
            if snapshot["current_battery_index"] == 0:
                saw_battery_0_start = True
                if snapshot["current_battery_evaluations_completed"] == 0:
                    saw_battery_0_reset = True
                    battery_reset_events["Battery 1"].set()
            if snapshot["current_battery_index"] == 1:
                saw_battery_1_start = True
                if snapshot["current_battery_evaluations_completed"] == 0:
                    saw_battery_1_reset = True
                    battery_reset_events["Battery 2"].set()
            if snapshot["current_battery_index"] == 2:
                saw_battery_2_start = True
                if snapshot["current_battery_evaluations_completed"] == 0:
                    saw_battery_2_reset = True
                    battery_reset_events["Battery 3"].set()
            if snapshot["current_battery_index"] == 3:
                battery_reset_events["Battery 3"].set()
            if snapshot["overall_progress_percent"] == 100.0 and snapshot["status"] != "completed":
                saw_progress_100_before_complete = True
            if snapshot["status"] in {"completed", "failed", "cancelled"}:
                break
            time.sleep(0.01)

        self.assertFalse(saw_progress_100_before_complete)
        self.assertTrue(saw_battery_0_start)
        self.assertTrue(saw_battery_1_start)
        self.assertTrue(saw_battery_2_start)
        self.assertTrue(saw_battery_0_reset)
        self.assertTrue(saw_battery_1_reset)
        self.assertTrue(saw_battery_2_reset)
        self.assertEqual(snapshot["total_evaluations_completed"], 6)
        self.assertEqual(snapshot["completed_battery_count"], 3)
        self.assertEqual(snapshot["current_battery_evaluations_completed"], 2)
        self.assertEqual(snapshot["current_battery_estimated_evaluations"], 2)
        self.assertEqual(snapshot["overall_progress_percent"], 100.0)

    def test_cancelled_job_keeps_partial_results(self) -> None:
        started = Event()
        release = Event()

        def runner(*, battery, progress_callback, cancellation_requested, **_kwargs: object) -> dict[str, object]:
            started.set()
            progress_callback(1, 1, {"bess_capacity_kwh": 200.0, "peak_support_pct": 30.0, "total_annual_cost_rs": 1000.0, "fitness_rs": 1000.0, "is_feasible": True})
            if cancellation_requested():
                raise OptimizationCancelled(0, 0)
            if not release.wait(2.0):
                raise AssertionError("Runner was not released")
            return {"best_bess_capacity_kwh": 200.0}

        manager = self.make_manager(runner)
        job_id = manager.submit(request_model(), sample_records())
        self.assertTrue(started.wait(1.0))
        manager.cancel(job_id)
        release.set()
        snapshot = wait_for_status(manager, job_id, "cancelled")
        self.assertEqual(snapshot["status"], "cancelled")
        self.assertEqual(snapshot["partial_results"], [])

    def test_job_response_exposes_stage_one_progress_fields(self) -> None:
        def runner(*, battery, **_kwargs: object) -> dict[str, object]:
            return {
                "best_bess_capacity_kwh": 200.0,
                "best_peak_support_pct": 30.0,
                "best_total_annual_cost_rs": 1200.0,
                "best_fitness_rs": 1200.0,
                "ga_generations_completed": 2,
                "total_fitness_evaluations": 4,
                "convergence_history": [],
                "runtime_seconds": 0.1,
                "solution_status": "feasible_solution",
                "solution_message": "ok",
                "input_battery_configuration": battery,
                "input_economic_configuration": {"project_life_years": 25},
                "warnings": [],
                "annual_grid_import_kwh": 100.0,
                "annual_pv_export_kwh": 20.0,
                "annual_bess_charge_kwh": 50.0,
                "annual_bess_discharge_kwh": 40.0,
                "equivalent_cycles_per_year": 1.0,
                "cycle_based_life_years": 2000.0,
                "replacement_years": [],
                "annualized_bess_lifecycle_cost_rs": 1200.0,
                "annual_om_cost_rs": 10.0,
                "annual_grid_cost_rs": 100.0,
                "annual_export_revenue_rs": 20.0,
                "total_annual_cost_rs": 1200.0,
                "peak_support_success_pct": 100.0,
                "pv_self_consumption_pct": 100.0,
                "peak_support_penalty_rs": 0.0,
                "pv_self_consumption_penalty_rs": 0.0,
                "total_penalty_rs": 0.0,
                "is_feasible": True,
                "minimum_soc_pct": 0.0,
                "maximum_soc_pct": 100.0,
            }

        manager = self.make_manager(runner)
        job_id = manager.submit(request_model(), sample_records())
        snapshot = wait_for_status(manager, job_id, "completed")

        self.assertEqual(snapshot["overall_progress_percent"], 100.0)
        self.assertEqual(snapshot["current_battery_index"], 1)
        self.assertEqual(snapshot["total_batteries"], 2)
        self.assertEqual(snapshot["current_battery_id"], "battery-2")
        self.assertEqual(snapshot["current_battery_name"], "Battery B")
        self.assertEqual(snapshot["current_battery_evaluations_completed"], 4)
        self.assertEqual(snapshot["current_battery_estimated_evaluations"], 4)
        self.assertEqual(snapshot["total_evaluations_completed"], 8)
        self.assertEqual(snapshot["total_estimated_evaluations"], 16)
        self.assertEqual(snapshot["completed_battery_count"], 2)
        self.assertEqual(snapshot["partial_results"][0]["battery_name"], "Battery A")
        self.assertEqual(snapshot["current_best_raw_cost_rs"], 1200.0)
        self.assertEqual(snapshot["current_best_fitness_rs"], 1200.0)
        self.assertTrue(snapshot["current_best_is_feasible"])


class TestComparisonOptimizationAPI(unittest.TestCase):
    def test_modified_dispatch_is_rejected(self) -> None:
        with self.assertRaises(HTTPException):
            run_comparison_optimization(
                request_model(dispatch_strategy_status="Modified Strategy")
            )


if __name__ == "__main__":
    unittest.main()
