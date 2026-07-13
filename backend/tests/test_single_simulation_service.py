import csv
import hashlib
import math
import unittest
from datetime import datetime, timedelta
from io import StringIO
from json import JSONDecodeError
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
from uuid import uuid4

from fastapi import HTTPException
from pydantic import ValidationError

from app.api.single_optimization import evaluate_single_optimization
from app.main import app
from app.schemas.single_optimization import (
    SingleOptimizationEvaluationRequest,
    SingleOptimizationEvaluationResponse,
)
from app.services.dataset_service import (
    DatasetNotFoundError,
    validate_and_store_dataset,
)
from app.services.single_simulation_service import (
    PENALTY_COST_RS,
    PV_SELF_CONSUMPTION_THRESHOLD_PERCENT,
    SUPPORT_THRESHOLD_PERCENT,
    _replacement_present_value,
    calculate_constraint_and_fitness,
    evaluate_uploaded_dataset,
)


REFERENCE_SOURCE_HASH = (
    "349BEE8D0AA70FA0304AA0479CF439B8079E9455B827D232A31C2E8690FC015C"
)


def make_dispatch_csv() -> bytes:
    output = StringIO(newline="")
    writer = csv.writer(output)
    writer.writerow(["timestamp", "PV_kW", "EV_kW", "tariff"])
    start = datetime(2025, 1, 1)
    for index in range(96):
        hour = index * 0.25
        pv_kw = 20.0 if 5.5 <= hour < 18.5 else 0.0
        ev_kw = 20.0 if 18.5 <= hour < 22.5 else 0.0
        writer.writerow(
            [
                (start + timedelta(minutes=15 * index)).isoformat(),
                pv_kw,
                ev_kw,
                25.0,
            ]
        )
    return output.getvalue().encode("utf-8")


def battery_parameters(
    *,
    price: float = 44_000.0,
    rated_cycles: float = 3_000.0,
    efficiency: float = 0.92,
) -> dict[str, object]:
    return {
        "name": "Submitted test battery",
        "price_rs_per_kwh": price,
        "rated_cycle_life": rated_cycles,
        "eta_ch": efficiency,
        "eta_dis": efficiency,
        "weight_density_kg_per_kwh": 8.5,
        "warranty_years": 5.0,
    }


def economic_settings(
    *,
    residual_value_enabled: bool = False,
    discount_rate: float = 0.10,
) -> dict[str, object]:
    return {
        "project_life_years": 25,
        "discount_rate": discount_rate,
        "export_tariff_rs_per_kwh": 21.0,
        "annual_om_fraction": 0.01,
        "replacement_cost_fraction": 0.80,
        "residual_value_enabled": residual_value_enabled,
    }


def request_payload(**overrides: object) -> dict[str, object]:
    payload: dict[str, object] = {
        "dataset_id": str(uuid4()),
        "battery": battery_parameters(),
        "bess_capacity_kwh": 100.0,
        "peak_support_pct": 100.0,
        "economic_settings": economic_settings(),
        "dispatch_strategy_status": "Reference Strategy",
    }
    payload.update(overrides)
    return payload


class TestSingleSimulationService(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = TemporaryDirectory()
        self.storage_dir = Path(self.temporary_directory.name)
        upload = validate_and_store_dataset(
            make_dispatch_csv(),
            "dispatch-profile.csv",
            self.storage_dir,
        )
        self.dataset_id = str(upload["dataset_id"])

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def evaluate(
        self,
        *,
        battery: dict[str, object] | None = None,
        economics: dict[str, object] | None = None,
        status: str = "Reference Strategy",
        capacity_kwh: float = 100.0,
    ) -> dict[str, object]:
        return evaluate_uploaded_dataset(
            dataset_id=self.dataset_id,
            battery=battery or battery_parameters(),
            bess_capacity_kwh=capacity_kwh,
            peak_support_pct=100.0,
            economic_settings=economics or economic_settings(),
            dispatch_strategy_status=status,
            storage_dir=self.storage_dir,
        )

    def test_submitted_efficiency_changes_energy_results(self) -> None:
        low_efficiency = self.evaluate(
            battery=battery_parameters(efficiency=0.80)
        )
        high_efficiency = self.evaluate(
            battery=battery_parameters(efficiency=0.98)
        )

        self.assertNotAlmostEqual(
            float(low_efficiency["annual_bess_charge_kwh"]),
            float(high_efficiency["annual_bess_charge_kwh"]),
        )
        self.assertNotAlmostEqual(
            float(low_efficiency["annual_bess_discharge_kwh"]),
            float(high_efficiency["annual_bess_discharge_kwh"]),
        )
        self.assertAlmostEqual(
            float(high_efficiency["round_trip_efficiency"]),
            0.98 * 0.98,
        )

    def test_reference_constraint_thresholds_and_penalties_are_exact(self) -> None:
        below_support = calculate_constraint_and_fitness(
            total_annual_cost_rs=123.0,
            peak_support_success_pct=94.0,
            pv_self_consumption_pct=50.0,
        )
        expected_peak_penalty = PENALTY_COST_RS * (1.0 / 95.0)
        self.assertEqual(
            below_support["peak_support_threshold_pct"],
            SUPPORT_THRESHOLD_PERCENT,
        )
        self.assertFalse(below_support["peak_support_constraint_passed"])
        self.assertTrue(
            below_support["pv_self_consumption_constraint_passed"]
        )
        self.assertFalse(below_support["is_feasible"])
        self.assertAlmostEqual(
            float(below_support["peak_support_penalty_rs"]),
            expected_peak_penalty,
        )
        self.assertEqual(below_support["pv_self_consumption_penalty_rs"], 0.0)
        self.assertAlmostEqual(
            float(below_support["fitness_rs"]),
            123.0 + expected_peak_penalty,
        )

        below_pv_self_consumption = calculate_constraint_and_fitness(
            total_annual_cost_rs=456.0,
            peak_support_success_pct=95.0,
            pv_self_consumption_pct=39.0,
        )
        expected_pv_penalty = PENALTY_COST_RS * (1.0 / 40.0)
        self.assertEqual(
            below_pv_self_consumption[
                "pv_self_consumption_threshold_pct"
            ],
            PV_SELF_CONSUMPTION_THRESHOLD_PERCENT,
        )
        self.assertTrue(
            below_pv_self_consumption["peak_support_constraint_passed"]
        )
        self.assertFalse(
            below_pv_self_consumption[
                "pv_self_consumption_constraint_passed"
            ]
        )
        self.assertFalse(below_pv_self_consumption["is_feasible"])
        self.assertEqual(below_pv_self_consumption["peak_support_penalty_rs"], 0.0)
        self.assertAlmostEqual(
            float(
                below_pv_self_consumption[
                    "pv_self_consumption_penalty_rs"
                ]
            ),
            expected_pv_penalty,
        )
        self.assertAlmostEqual(
            float(below_pv_self_consumption["total_penalty_rs"]),
            expected_pv_penalty,
        )
        self.assertAlmostEqual(
            float(below_pv_self_consumption["fitness_rs"]),
            456.0 + expected_pv_penalty,
        )

        exact_thresholds = calculate_constraint_and_fitness(
            total_annual_cost_rs=789.0,
            peak_support_success_pct=95.0,
            pv_self_consumption_pct=40.0,
        )
        self.assertTrue(exact_thresholds["is_feasible"])
        self.assertEqual(exact_thresholds["total_penalty_rs"], 0.0)
        self.assertEqual(exact_thresholds["fitness_rs"], 789.0)

    def test_reference_dispatch_and_rainflow_metrics_match_known_profile(self) -> None:
        result = self.evaluate()

        self.assertAlmostEqual(float(result["annual_grid_import_kwh"]), 6.4)
        self.assertAlmostEqual(
            float(result["annual_pv_export_kwh"]),
            260.0 - (40.0 / 0.92),
        )
        self.assertAlmostEqual(
            float(result["annual_bess_charge_kwh"]),
            40.0 / 0.92,
        )
        self.assertAlmostEqual(
            float(result["annual_bess_discharge_kwh"]),
            80.0 * 0.92,
        )
        self.assertAlmostEqual(float(result["equivalent_cycles_per_year"]), 0.75)
        self.assertAlmostEqual(float(result["cycle_based_life_years"]), 4_000.0)
        self.assertAlmostEqual(float(result["peak_support_success_pct"]), 92.0)
        expected_pv_self_consumption = (
            (260.0 - float(result["annual_pv_export_kwh"])) / 260.0 * 100.0
        )
        self.assertAlmostEqual(
            float(result["pv_self_consumption_pct"]),
            expected_pv_self_consumption,
        )
        self.assertFalse(result["peak_support_constraint_passed"])
        self.assertFalse(result["pv_self_consumption_constraint_passed"])
        self.assertFalse(result["is_feasible"])
        self.assertAlmostEqual(
            float(result["fitness_rs"]),
            float(result["total_annual_cost_rs"])
            + float(result["total_penalty_rs"]),
        )
        self.assertAlmostEqual(float(result["minimum_soc_pct"]), 10.0)
        self.assertAlmostEqual(float(result["maximum_soc_pct"]), 90.0)

        capex = 100.0 * 44_000.0
        discount_rate = 0.10
        growth = (1.0 + discount_rate) ** 25
        capital_recovery_factor = discount_rate * growth / (growth - 1.0)
        expected_lifecycle_cost = capex * capital_recovery_factor
        expected_grid_cost = 6.4 * 25.0
        expected_export_revenue = (260.0 - 40.0 / 0.92) * 21.0
        expected_om_cost = capex * 0.01
        expected_total_cost = (
            expected_grid_cost
            - expected_export_revenue
            + expected_lifecycle_cost
            + expected_om_cost
        )
        self.assertAlmostEqual(
            float(result["annualized_bess_lifecycle_cost_rs"]),
            expected_lifecycle_cost,
        )
        self.assertAlmostEqual(float(result["annual_grid_cost_rs"]), expected_grid_cost)
        self.assertAlmostEqual(
            float(result["annual_export_revenue_rs"]),
            expected_export_revenue,
        )
        self.assertAlmostEqual(float(result["annual_om_cost_rs"]), expected_om_cost)
        self.assertAlmostEqual(
            float(result["total_annual_cost_rs"]),
            expected_total_cost,
        )

    def test_submitted_price_changes_lifecycle_cost(self) -> None:
        lower_price = self.evaluate(battery=battery_parameters(price=44_000.0))
        higher_price = self.evaluate(battery=battery_parameters(price=88_000.0))

        self.assertGreater(
            float(higher_price["annualized_bess_lifecycle_cost_rs"]),
            float(lower_price["annualized_bess_lifecycle_cost_rs"]),
        )

    def test_submitted_rated_cycles_change_life_and_replacements(self) -> None:
        short_life = self.evaluate(
            battery=battery_parameters(rated_cycles=1.0)
        )
        long_life = self.evaluate(
            battery=battery_parameters(rated_cycles=100.0)
        )

        self.assertLess(
            float(short_life["cycle_based_life_years"]),
            float(long_life["cycle_based_life_years"]),
        )
        self.assertGreater(
            len(short_life["replacement_years"]),
            len(long_life["replacement_years"]),
        )
        expected_service_life = 1.0 / 0.75
        expected_replacements = [
            expected_service_life * index for index in range(1, 19)
        ]
        self.assertEqual(len(short_life["replacement_years"]), 18)
        for actual, expected in zip(
            short_life["replacement_years"],
            expected_replacements,
            strict=True,
        ):
            self.assertAlmostEqual(float(actual), expected)

        capex = 100.0 * 44_000.0
        discount_rate = 0.10
        replacement_present_value = sum(
            0.80 * capex / ((1.0 + discount_rate) ** year)
            for year in expected_replacements
        )
        growth = (1.0 + discount_rate) ** 25
        capital_recovery_factor = discount_rate * growth / (growth - 1.0)
        expected_lifecycle_cost = (
            capex + replacement_present_value
        ) * capital_recovery_factor
        self.assertAlmostEqual(
            float(short_life["annualized_bess_lifecycle_cost_rs"]),
            expected_lifecycle_cost,
        )

    def test_discount_rate_is_used_directly_for_replacement_pv_and_annualization(
        self,
    ) -> None:
        capex = 100.0 * 44_000.0
        service_life = 1.0 / 0.75
        replacement_years = [service_life * index for index in range(1, 19)]

        results: dict[float, float] = {}
        replacement_present_values: dict[float, float] = {}
        for discount_rate in (0.05, 0.10):
            result = self.evaluate(
                battery=battery_parameters(rated_cycles=1.0),
                economics=economic_settings(discount_rate=discount_rate),
            )
            expected_replacement_present_value = sum(
                0.80 * capex / ((1.0 + discount_rate) ** year)
                for year in replacement_years
            )
            replacement_present_value = _replacement_present_value(
                initial_capex=capex,
                replacement_cost_fraction=0.80,
                replacement_years=replacement_years,
                discount_rate=discount_rate,
            )
            growth = (1.0 + discount_rate) ** 25
            capital_recovery_factor = (
                discount_rate * growth / (growth - 1.0)
            )
            expected_annualized_cost = (
                capex + replacement_present_value
            ) * capital_recovery_factor

            replacement_present_values[discount_rate] = replacement_present_value
            results[discount_rate] = float(
                result["annualized_bess_lifecycle_cost_rs"]
            )
            self.assertAlmostEqual(
                replacement_present_value,
                expected_replacement_present_value,
            )
            self.assertAlmostEqual(results[discount_rate], expected_annualized_cost)

        self.assertLess(
            replacement_present_values[0.10],
            replacement_present_values[0.05],
        )
        self.assertNotAlmostEqual(results[0.05], results[0.10])

    def test_invalid_dataset_id_is_rejected(self) -> None:
        with self.assertRaises(DatasetNotFoundError):
            evaluate_uploaded_dataset(
                dataset_id="not-a-dataset-id",
                battery=battery_parameters(),
                bess_capacity_kwh=100.0,
                peak_support_pct=50.0,
                economic_settings=economic_settings(),
                dispatch_strategy_status="Reference Strategy",
                storage_dir=self.storage_dir,
            )

    def test_modified_dispatch_returns_required_http_422_detail(self) -> None:
        request = SingleOptimizationEvaluationRequest(
            **request_payload(dispatch_strategy_status="Modified Strategy")
        )

        with self.assertRaises(HTTPException) as context:
            evaluate_single_optimization(request)

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

    def test_response_contains_only_finite_numeric_values(self) -> None:
        response = SingleOptimizationEvaluationResponse(**self.evaluate())
        payload = response.model_dump()
        for key, value in payload.items():
            if isinstance(value, (int, float)) and not isinstance(value, bool):
                self.assertTrue(math.isfinite(value), key)
            if key == "replacement_years":
                self.assertTrue(all(math.isfinite(year) for year in value))
        self.assertIsNotNone(payload["cycle_based_life_years"])

    def test_partial_dataset_returns_annual_profile_warning(self) -> None:
        warnings = self.evaluate()["validation_warnings"]
        codes = {warning["code"] for warning in warnings}
        self.assertIn("PARTIAL_DATASET_AS_ANNUAL_PROFILE", codes)

    def test_reference_capacity_normalization_is_explicit(self) -> None:
        result = self.evaluate(capacity_kwh=155.0)
        self.assertEqual(result["bess_capacity_kwh"], 200.0)
        codes = {
            warning["code"] for warning in result["validation_warnings"]
        }
        self.assertIn("BESS_CAPACITY_ADJUSTED_FOR_REFERENCE_PARITY", codes)

    def test_residual_value_reduces_annualized_lifecycle_cost(self) -> None:
        without_residual = self.evaluate(
            economics=economic_settings(residual_value_enabled=False)
        )
        with_residual = self.evaluate(
            economics=economic_settings(residual_value_enabled=True)
        )
        self.assertLessEqual(
            float(with_residual["annualized_bess_lifecycle_cost_rs"]),
            float(without_residual["annualized_bess_lifecycle_cost_rs"]),
        )

        capex = 100.0 * 44_000.0
        service_life = 3_000.0 / 0.75
        remaining_fraction = (service_life - 25.0) / service_life
        discount_rate = 0.10
        residual_present_value = (
            capex * remaining_fraction / ((1.0 + discount_rate) ** 25)
        )
        growth = (1.0 + discount_rate) ** 25
        capital_recovery_factor = discount_rate * growth / (growth - 1.0)
        expected_with_residual = (
            capex - residual_present_value
        ) * capital_recovery_factor
        self.assertAlmostEqual(
            float(with_residual["annualized_bess_lifecycle_cost_rs"]),
            expected_with_residual,
        )


class TestSingleOptimizationApiContract(unittest.TestCase):
    def test_route_is_registered(self) -> None:
        endpoint = app.openapi()["paths"]["/api/single-optimization/evaluate"]
        self.assertIn("post", endpoint)

    def test_request_rejects_invalid_scientific_inputs(self) -> None:
        invalid_payloads = [
            request_payload(bess_capacity_kwh=0),
            request_payload(peak_support_pct=101),
            request_payload(
                battery={**battery_parameters(), "price_rs_per_kwh": 0}
            ),
            request_payload(battery={**battery_parameters(), "rated_cycle_life": 0}),
            request_payload(battery={**battery_parameters(), "eta_ch": 1.01}),
            request_payload(
                economic_settings={
                    **economic_settings(),
                    "project_life_years": 0,
                }
            ),
            request_payload(
                economic_settings={
                    **economic_settings(),
                    "annual_om_fraction": 1.01,
                }
            ),
            request_payload(
                economic_settings={
                    **economic_settings(),
                    "discount_rate": 1.01,
                }
            ),
            request_payload(
                economic_settings={
                    **economic_settings(),
                    "replacement_cost_fraction": -0.01,
                }
            ),
        ]
        for payload in invalid_payloads:
            with self.subTest(payload=payload):
                with self.assertRaises(ValidationError):
                    SingleOptimizationEvaluationRequest(**payload)

    def test_legacy_inflation_and_nominal_rate_fields_are_rejected(self) -> None:
        valid_economics = economic_settings()
        self.assertNotIn("inflation_rate", valid_economics)
        self.assertNotIn("nominal_discount_rate", valid_economics)

        for legacy_field in ("inflation_rate", "nominal_discount_rate"):
            with self.subTest(legacy_field=legacy_field):
                with self.assertRaises(ValidationError):
                    SingleOptimizationEvaluationRequest(
                        **request_payload(
                            economic_settings={
                                **valid_economics,
                                legacy_field: 0.05,
                            }
                        )
                    )

    def test_service_contains_no_inflation_or_real_rate_calculation(self) -> None:
        service_path = (
            Path(__file__).resolve().parents[1]
            / "app"
            / "services"
            / "single_simulation_service.py"
        )
        source = service_path.read_text(encoding="utf-8")
        self.assertNotIn("inflation_rate", source)
        self.assertNotIn("nominal_discount_rate", source)
        self.assertNotIn("real_discount_rate", source)

    def test_request_does_not_coerce_numeric_or_boolean_strings(self) -> None:
        with self.assertRaises(ValidationError):
            SingleOptimizationEvaluationRequest(
                **request_payload(bess_capacity_kwh="100")
            )
        with self.assertRaises(ValidationError):
            SingleOptimizationEvaluationRequest(
                **request_payload(
                    economic_settings={
                        **economic_settings(),
                        "residual_value_enabled": "false",
                    }
                )
            )

    def test_unknown_dataset_returns_http_404(self) -> None:
        request = SingleOptimizationEvaluationRequest(**request_payload())
        with self.assertRaises(HTTPException) as context:
            evaluate_single_optimization(request)
        self.assertEqual(context.exception.status_code, 404)

    def test_corrupt_stored_dataset_is_reported_as_http_500(self) -> None:
        request = SingleOptimizationEvaluationRequest(**request_payload())
        with patch(
            "app.api.single_optimization.evaluate_uploaded_dataset",
            side_effect=JSONDecodeError("invalid metadata", "", 0),
        ):
            with self.assertRaises(HTTPException) as context:
                evaluate_single_optimization(request)
        self.assertEqual(context.exception.status_code, 500)
        self.assertEqual(
            context.exception.detail,
            "The stored dataset could not be read.",
        )

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
