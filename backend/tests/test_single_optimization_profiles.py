import hashlib
import unittest
from copy import deepcopy
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import Mock, patch

from fastapi import HTTPException

from app.api.single_optimization_jobs import (
    SingleOptimizationJobManager,
    get_single_optimization_profiles,
)
from app.main import app
from app.schemas.single_optimization_jobs import SingleOptimizationRunRequest
from app.services.dataset_service import DatasetRecord
from app.services.optimization_job_store import OptimizationJobStore
from app.services.single_ga_service import run_single_ga
from app.services.single_profile_service import (
    OperationalProfileDateNotFoundError,
    generate_operational_profile,
)


REFERENCE_SOURCE_HASH = (
    "349BEE8D0AA70FA0304AA0479CF439B8079E9455B827D232A31C2E8690FC015C"
)
DATASET_ID = "00000000-0000-0000-0000-000000000001"


def battery(efficiency: float = 0.92) -> dict[str, object]:
    return {
        "name": "Profile battery",
        "price_rs_per_kwh": 44_000.0,
        "rated_cycle_life": 3_000.0,
        "eta_ch": efficiency,
        "eta_dis": efficiency,
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


def records(days: int = 2) -> list[DatasetRecord]:
    start = datetime(2025, 1, 1)
    result: list[DatasetRecord] = []
    for index in range(days * 96):
        time_of_day = index % 96
        if time_of_day < 22:
            pv, ev = 0.0, 30.0
        elif time_of_day < 74:
            pv = 100.0 if 32 <= time_of_day < 64 else 15.0
            ev = 20.0
        elif time_of_day < 90:
            pv, ev = 0.0, 50.0
        else:
            pv, ev = 0.0, 20.0
        result.append(
            DatasetRecord(
                timestamp=start + timedelta(minutes=15 * index),
                pv_kw=pv,
                ev_kw=ev,
                tariff_rs_per_kwh=None,
            )
        )
    return result


def request() -> SingleOptimizationRunRequest:
    return SingleOptimizationRunRequest(
        dataset_id=DATASET_ID,
        battery=battery(),
        economic_settings=economics(),
        dispatch_strategy_status="Reference Strategy",
        minimum_bess_capacity_kwh=300.0,
        maximum_bess_capacity_kwh=399.0,
        minimum_peak_support_pct=30.0,
        maximum_peak_support_pct=31.0,
        ga_settings={
            "population_size": 4,
            "generations": 1,
            "mutation_probability": 0.15,
            "elite_count": 1,
            "random_seed": 42,
        },
    )


def completed_result() -> dict[str, object]:
    submitted = request()
    return run_single_ga(
        records=records(),
        battery=submitted.battery,
        economic_settings=submitted.economic_settings,
        dispatch_strategy_status=submitted.dispatch_strategy_status,
        minimum_bess_capacity_kwh=submitted.minimum_bess_capacity_kwh,
        maximum_bess_capacity_kwh=submitted.maximum_bess_capacity_kwh,
        minimum_peak_support_pct=submitted.minimum_peak_support_pct,
        maximum_peak_support_pct=submitted.maximum_peak_support_pct,
        population_size=submitted.ga_settings.population_size,
        generations=submitted.ga_settings.generations,
        mutation_probability=submitted.ga_settings.mutation_probability,
        elite_count=submitted.ga_settings.elite_count,
        random_seed=submitted.ga_settings.random_seed,
    )


class TestOperationalProfileService(unittest.TestCase):
    def profile(self, **overrides: object) -> dict[str, object]:
        arguments: dict[str, object] = {
            "job_id": "completed-job",
            "dataset_id": DATASET_ID,
            "date_value": "2025-01-02",
            "battery": battery(),
            "economic_settings": economics(),
            "bess_capacity_kwh": 300.0,
            "peak_support_pct": 30.0,
        }
        arguments.update(overrides)
        with patch(
            "app.services.single_profile_service.load_dataset_records",
            return_value=(DATASET_ID, records(), {}),
        ):
            return generate_operational_profile(**arguments)

    def test_profile_uses_optimal_battery_configuration_and_has_96_points(self) -> None:
        lower_efficiency = self.profile(battery=battery(0.80))
        higher_efficiency = self.profile(battery=battery(0.98))

        self.assertEqual(lower_efficiency["battery_name"], "Profile battery")
        self.assertEqual(lower_efficiency["bess_capacity_kwh"], 300.0)
        self.assertEqual(lower_efficiency["peak_support_pct"], 30.0)
        self.assertEqual(len(lower_efficiency["points"]), 96)
        self.assertNotEqual(
            [point["soc_pct"] for point in lower_efficiency["points"]],
            [point["soc_pct"] for point in higher_efficiency["points"]],
        )

    def test_soc_limits_energy_integration_and_net_power_sign(self) -> None:
        profile = self.profile()
        points = profile["points"]
        summary = profile["daily_summary"]

        soc_values = [point["soc_pct"] for point in points]
        self.assertGreaterEqual(min(soc_values), profile["soc_min_limit_pct"])
        self.assertLessEqual(max(soc_values), profile["soc_max_limit_pct"])
        integrations = {
            "pv_energy_kwh": "pv_kw",
            "ev_energy_kwh": "ev_kw",
            "grid_import_energy_kwh": "grid_import_kw",
            "pv_export_energy_kwh": "pv_export_kw",
            "bess_charge_energy_kwh": "bess_charge_kw",
            "bess_discharge_energy_kwh": "bess_discharge_kw",
        }
        for summary_field, point_field in integrations.items():
            with self.subTest(summary_field=summary_field):
                expected = sum(point[point_field] for point in points) * 0.25
                self.assertAlmostEqual(summary[summary_field], expected)

        charging = [point for point in points if point["bess_charge_kw"] > 0]
        discharging = [
            point for point in points if point["bess_discharge_kw"] > 0
        ]
        self.assertTrue(charging)
        self.assertTrue(discharging)
        self.assertTrue(all(point["bess_net_power_kw"] < 0 for point in charging))
        self.assertTrue(
            all(point["bess_net_power_kw"] > 0 for point in discharging)
        )

    def test_invalid_and_missing_dates_are_rejected(self) -> None:
        with self.assertRaises(ValueError):
            self.profile(date_value="02-01-2025")
        with self.assertRaises(OperationalProfileDateNotFoundError):
            self.profile(date_value="2026-01-01")


class TestOperationalProfileApi(unittest.TestCase):
    def test_route_is_registered(self) -> None:
        paths = app.openapi()["paths"]
        self.assertIn(
            "get",
            paths["/api/single-optimization/jobs/{job_id}/profiles"],
        )

    def test_unfinished_jobs_are_rejected_with_http_409(self) -> None:
        for status in (
            "queued",
            "running",
            "cancelling",
            "cancelled",
            "failed",
        ):
            with self.subTest(status=status):
                manager = Mock()
                manager.profile_context.return_value = {
                    "job_id": "job",
                    "status": status,
                    "request_snapshot": None,
                    "final_result": None,
                }
                with (
                    patch(
                        "app.api.single_optimization_jobs.job_manager",
                        manager,
                    ),
                    self.assertRaises(HTTPException) as context,
                ):
                    get_single_optimization_profiles(
                        "job", date_value="2025-01-01"
                    )
                self.assertEqual(context.exception.status_code, 409)
                self.assertEqual(context.exception.detail["status"], status)

    def test_completed_profile_does_not_change_saved_ga_result(self) -> None:
        store = OptimizationJobStore()
        submitted = request()
        job_id = store.create(submitted.model_dump(), 1, 4)
        self.assertTrue(store.claim(job_id))
        final_result = completed_result()
        store.complete_or_cancel(job_id, final_result)
        manager = SingleOptimizationJobManager(store=store)
        before = deepcopy(manager.snapshot(job_id)["final_result"])

        with (
            patch(
                "app.api.single_optimization_jobs.job_manager",
                manager,
            ),
            patch(
                "app.services.single_profile_service.load_dataset_records",
                return_value=(DATASET_ID, records(), {}),
            ),
        ):
            response = get_single_optimization_profiles(
                job_id, date_value="2025-01-02"
            )
        after = manager.snapshot(job_id)["final_result"]
        manager.shutdown(wait=True)

        self.assertEqual(len(response.points), 96)
        self.assertEqual(response.bess_capacity_kwh, 300.0)
        self.assertEqual(before, after)

    def test_original_reference_hash_is_unchanged(self) -> None:
        reference_path = (
            Path(__file__).resolve().parents[2]
            / "original_code"
            / "bess_ga_ahp_promethee.py"
        )
        digest = hashlib.sha256(reference_path.read_bytes()).hexdigest().upper()
        self.assertEqual(digest, REFERENCE_SOURCE_HASH)


if __name__ == "__main__":
    unittest.main()
