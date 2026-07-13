import hashlib
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import Mock, patch

from app.services import single_ga_service
from app.services.dataset_service import DatasetRecord
from app.services.single_ga_service import (
    OptimizationCancelled,
    run_single_ga,
)
from app.services.single_simulation_service import (
    calculate_constraint_and_fitness,
)


REFERENCE_SOURCE_HASH = (
    "349BEE8D0AA70FA0304AA0479CF439B8079E9455B827D232A31C2E8690FC015C"
)


def battery_parameters(
    *,
    price: float = 44_000.0,
    efficiency: float = 0.92,
) -> dict[str, object]:
    return {
        "name": "Submitted GA battery",
        "price_rs_per_kwh": price,
        "rated_cycle_life": 3_000.0,
        "eta_ch": efficiency,
        "eta_dis": efficiency,
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


def simple_records() -> list[DatasetRecord]:
    start = datetime(2025, 1, 1)
    return [
        DatasetRecord(
            timestamp=start + timedelta(minutes=15 * index),
            pv_kw=10.0,
            ev_kw=8.0,
            tariff_rs_per_kwh=15.0,
        )
        for index in range(96)
    ]


def dispatch_records() -> list[DatasetRecord]:
    start = datetime(2025, 1, 1)
    records: list[DatasetRecord] = []
    for index in range(96):
        hour = index * 0.25
        records.append(
            DatasetRecord(
                timestamp=start + timedelta(minutes=15 * index),
                pv_kw=20.0 if 5.5 <= hour < 18.5 else 0.0,
                ev_kw=20.0 if 18.5 <= hour < 22.5 else 0.0,
                tariff_rs_per_kwh=25.0,
            )
        )
    return records


def fake_evaluator(call_log: list[dict[str, object]] | None = None):
    def evaluate(**kwargs: object) -> dict[str, object]:
        if call_log is not None:
            call_log.append(kwargs)
        requested_capacity = float(kwargs["bess_capacity_kwh"])
        capacity = round(requested_capacity / 100.0) * 100.0
        peak_support = float(kwargs["peak_support_pct"])
        battery = kwargs["battery"]
        if not isinstance(battery, dict):
            raise AssertionError("The test evaluator expects a battery mapping.")
        price = float(battery["price_rs_per_kwh"])
        eta_ch = float(battery["eta_ch"])
        eta_dis = float(battery["eta_dis"])
        cost = (
            abs(capacity - 400.0) * 10.0
            + abs(peak_support - 35.0)
            + price * capacity * 0.0001
        )
        warning = {
            "code": "TEST_EVALUATOR_WARNING",
            "message": "The winning evaluator warning must be preserved.",
        }
        result: dict[str, object] = {
            "bess_capacity_kwh": capacity,
            "peak_support_pct": peak_support,
            "battery_name": str(battery["name"]),
            "round_trip_efficiency": eta_ch * eta_dis,
            "annual_grid_import_kwh": 100.0,
            "annual_pv_export_kwh": 0.0,
            "annual_bess_charge_kwh": 50.0 * eta_ch,
            "annual_bess_discharge_kwh": 40.0 * eta_dis,
            "equivalent_cycles_per_year": 1.0,
            "cycle_based_life_years": 3_000.0,
            "replacement_years": [],
            "annualized_bess_lifecycle_cost_rs": cost,
            "annual_om_cost_rs": 0.0,
            "annual_grid_cost_rs": 0.0,
            "annual_export_revenue_rs": 0.0,
            "total_annual_cost_rs": cost,
            "peak_support_success_pct": 100.0,
            "pv_self_consumption_pct": 100.0,
            "minimum_soc_pct": 10.0,
            "maximum_soc_pct": 90.0,
            "validation_warnings": [warning],
        }
        result.update(
            calculate_constraint_and_fitness(
                total_annual_cost_rs=cost,
                peak_support_success_pct=100.0,
                pv_self_consumption_pct=100.0,
            )
        )
        return result

    return evaluate


def ga_arguments(**overrides: object) -> dict[str, object]:
    arguments: dict[str, object] = {
        "records": simple_records(),
        "battery": battery_parameters(),
        "economic_settings": economic_settings(),
        "dispatch_strategy_status": "Reference Strategy",
        "minimum_bess_capacity_kwh": 100.0,
        "maximum_bess_capacity_kwh": 1_000.0,
        "minimum_peak_support_pct": 20.0,
        "maximum_peak_support_pct": 50.0,
        "population_size": 8,
        "generations": 3,
        "mutation_probability": 0.15,
        "elite_count": 2,
        "random_seed": 42,
        "evaluator": fake_evaluator(),
    }
    arguments.update(overrides)
    return arguments


def refresh_constraint_metrics(
    result: dict[str, object],
    *,
    pv_self_consumption_pct: float,
) -> None:
    result["pv_self_consumption_pct"] = pv_self_consumption_pct
    result.update(
        calculate_constraint_and_fitness(
            total_annual_cost_rs=float(result["total_annual_cost_rs"]),
            peak_support_success_pct=float(
                result["peak_support_success_pct"]
            ),
            pv_self_consumption_pct=pv_self_consumption_pct,
        )
    )


class TestSingleGAService(unittest.TestCase):
    def test_same_seed_reproduces_result_and_history(self) -> None:
        first = run_single_ga(**ga_arguments())
        second = run_single_ga(**ga_arguments())

        first_without_runtime = {
            key: value for key, value in first.items() if key != "runtime_seconds"
        }
        second_without_runtime = {
            key: value for key, value in second.items() if key != "runtime_seconds"
        }
        self.assertEqual(first_without_runtime, second_without_runtime)

    def test_evaluates_every_population_member_in_every_generation(self) -> None:
        calls: list[dict[str, object]] = []
        progress: list[tuple[int, int]] = []
        result = run_single_ga(
            **ga_arguments(
                population_size=7,
                generations=4,
                evaluator=fake_evaluator(calls),
                progress_callback=lambda generation, evaluations, _best: (
                    progress.append((generation, evaluations))
                ),
            )
        )

        self.assertEqual(len(calls), 28)
        self.assertEqual(result["total_fitness_evaluations"], 28)
        self.assertEqual(result["ga_generations_completed"], 4)
        self.assertEqual(len(result["convergence_history"]), 4)
        for point in result["convergence_history"]:
            self.assertIn("best_fitness_rs", point)
            self.assertIn("best_total_annual_cost_rs", point)
            self.assertIn("average_fitness_rs", point)
            self.assertIn("feasible_candidate_count", point)
            self.assertIn("best_is_feasible", point)
        self.assertEqual(progress[0], (1, 1))
        self.assertEqual(progress[-1], (4, 28))

    def test_effective_result_stays_inside_submitted_bounds(self) -> None:
        result = run_single_ga(
            **ga_arguments(
                minimum_bess_capacity_kwh=150.0,
                maximum_bess_capacity_kwh=450.0,
                minimum_peak_support_pct=27.0,
                maximum_peak_support_pct=43.0,
            )
        )

        self.assertGreaterEqual(result["best_bess_capacity_kwh"], 150.0)
        self.assertLessEqual(result["best_bess_capacity_kwh"], 450.0)
        self.assertEqual(float(result["best_bess_capacity_kwh"]) % 100.0, 0.0)
        self.assertGreaterEqual(result["best_peak_support_pct"], 27.0)
        self.assertLessEqual(result["best_peak_support_pct"], 43.0)

    def test_submitted_efficiency_and_price_reach_every_evaluation(self) -> None:
        calls: list[dict[str, object]] = []
        submitted_battery = battery_parameters(price=63_210.0, efficiency=0.83)
        result = run_single_ga(
            **ga_arguments(
                battery=submitted_battery,
                population_size=4,
                generations=2,
                elite_count=1,
                evaluator=fake_evaluator(calls),
            )
        )

        self.assertEqual(len(calls), 8)
        for call in calls:
            self.assertIs(call["battery"], submitted_battery)
            battery = call["battery"]
            self.assertEqual(battery["price_rs_per_kwh"], 63_210.0)
            self.assertEqual(battery["eta_ch"], 0.83)
            self.assertEqual(battery["eta_dis"], 0.83)
        self.assertAlmostEqual(result["round_trip_efficiency"], 0.83 * 0.83)
        self.assertEqual(
            result["input_battery_configuration"]["price_rs_per_kwh"],
            63_210.0,
        )

    def test_submitted_discount_rate_reaches_evaluator_and_completed_result(
        self,
    ) -> None:
        calls: list[dict[str, object]] = []
        submitted_economics = {
            **economic_settings(),
            "discount_rate": 0.137,
        }

        result = run_single_ga(
            **ga_arguments(
                economic_settings=submitted_economics,
                population_size=4,
                generations=2,
                elite_count=1,
                evaluator=fake_evaluator(calls),
            )
        )

        self.assertEqual(len(calls), 8)
        for call in calls:
            self.assertIs(call["economic_settings"], submitted_economics)
            settings = call["economic_settings"]
            self.assertEqual(settings["discount_rate"], 0.137)
        self.assertEqual(
            result["input_economic_configuration"],
            submitted_economics,
        )
        self.assertNotIn(
            "nominal_discount_rate",
            result["input_economic_configuration"],
        )
        self.assertNotIn(
            "inflation_rate",
            result["input_economic_configuration"],
        )

    def test_real_evaluator_uses_submitted_efficiency(self) -> None:
        shared = ga_arguments(
            records=dispatch_records(),
            minimum_bess_capacity_kwh=100.0,
            maximum_bess_capacity_kwh=199.0,
            minimum_peak_support_pct=99.0,
            maximum_peak_support_pct=100.0,
            population_size=4,
            generations=1,
            elite_count=1,
        )
        shared.pop("evaluator")

        low_efficiency = run_single_ga(
            **{**shared, "battery": battery_parameters(efficiency=0.80)}
        )
        high_efficiency = run_single_ga(
            **{**shared, "battery": battery_parameters(efficiency=0.98)}
        )

        self.assertNotAlmostEqual(
            low_efficiency["annual_bess_charge_kwh"],
            high_efficiency["annual_bess_charge_kwh"],
        )
        self.assertNotAlmostEqual(
            low_efficiency["annual_bess_discharge_kwh"],
            high_efficiency["annual_bess_discharge_kwh"],
        )

    def test_submitted_price_changes_real_objective(self) -> None:
        shared = ga_arguments(
            records=dispatch_records(),
            minimum_bess_capacity_kwh=100.0,
            maximum_bess_capacity_kwh=199.0,
            minimum_peak_support_pct=99.0,
            maximum_peak_support_pct=100.0,
            population_size=4,
            generations=1,
            elite_count=1,
        )
        shared.pop("evaluator")

        lower_price = run_single_ga(
            **{**shared, "battery": battery_parameters(price=30_000.0)}
        )
        higher_price = run_single_ga(
            **{**shared, "battery": battery_parameters(price=90_000.0)}
        )

        self.assertGreater(
            higher_price["best_total_annual_cost_rs"],
            lower_price["best_total_annual_cost_rs"],
        )

    def test_invalid_ga_settings_and_bounds_are_rejected(self) -> None:
        invalid_overrides = [
            {"population_size": 3},
            {"generations": 0},
            {"mutation_probability": -0.01},
            {"mutation_probability": 1.01},
            {"elite_count": 0},
            {"elite_count": 8},
            {"random_seed": 42.5},
            {
                "minimum_bess_capacity_kwh": 500.0,
                "maximum_bess_capacity_kwh": 500.0,
            },
            {
                "minimum_bess_capacity_kwh": 10.0,
                "maximum_bess_capacity_kwh": 90.0,
            },
            {
                "minimum_peak_support_pct": 50.0,
                "maximum_peak_support_pct": 50.0,
            },
            {"minimum_peak_support_pct": -1.0},
            {"maximum_peak_support_pct": 101.0},
        ]
        for overrides in invalid_overrides:
            with self.subTest(overrides=overrides):
                with self.assertRaises(ValueError):
                    run_single_ga(**ga_arguments(**overrides))

    def test_cancellation_is_observed_after_whole_generation(self) -> None:
        calls: list[dict[str, object]] = []
        cancel_state = {"requested": False}

        def update_progress(
            _generation: int,
            evaluations: int,
            _best: dict[str, object],
        ) -> None:
            if evaluations == 1:
                cancel_state["requested"] = True

        with self.assertRaises(OptimizationCancelled) as context:
            run_single_ga(
                **ga_arguments(
                    population_size=6,
                    generations=3,
                    elite_count=1,
                    evaluator=fake_evaluator(calls),
                    progress_callback=update_progress,
                    cancellation_requested=lambda: cancel_state["requested"],
                )
            )

        self.assertEqual(len(calls), 6)
        self.assertEqual(context.exception.generations_completed, 1)
        self.assertEqual(context.exception.evaluations_completed, 6)

    def test_cancellation_during_reproduction_stops_before_next_generation(self) -> None:
        calls: list[dict[str, object]] = []
        cancel_state = {"requested": False}
        original_crossover = single_ga_service._crossover

        def crossover_then_cancel(*args: object, **kwargs: object):
            children = original_crossover(*args, **kwargs)
            cancel_state["requested"] = True
            return children

        with (
            patch(
                "app.services.single_ga_service._crossover",
                side_effect=crossover_then_cancel,
            ),
            self.assertRaises(OptimizationCancelled) as context,
        ):
            run_single_ga(
                **ga_arguments(
                    population_size=6,
                    generations=3,
                    elite_count=1,
                    evaluator=fake_evaluator(calls),
                    cancellation_requested=lambda: cancel_state["requested"],
                )
            )

        self.assertEqual(len(calls), 6)
        self.assertEqual(context.exception.generations_completed, 1)
        self.assertEqual(context.exception.evaluations_completed, 6)

    def test_winning_evaluator_warnings_are_preserved(self) -> None:
        result = run_single_ga(
            **ga_arguments(
                minimum_bess_capacity_kwh=150.0,
                maximum_bess_capacity_kwh=450.0,
            )
        )

        self.assertEqual(
            result["validation_warnings"][0]["code"],
            "TEST_EVALUATOR_WARNING",
        )
        warning_codes = {warning["code"] for warning in result["warnings"]}
        self.assertIn("TEST_EVALUATOR_WARNING", warning_codes)
        self.assertIn("GA_CAPACITY_BOUNDS_NORMALIZED", warning_codes)

    def test_reference_feasibility_penalties_govern_winner_selection(self) -> None:
        annual_pv_energy = sum(record.pv_kw for record in simple_records()) * 0.25

        for penalty_case in ("peak_support", "pv_self_consumption"):
            with self.subTest(penalty_case=penalty_case):
                base_evaluator = fake_evaluator()

                def penalized_evaluator(**kwargs: object) -> dict[str, object]:
                    result = base_evaluator(**kwargs)
                    capacity = float(result["bess_capacity_kwh"])
                    if capacity == 100.0:
                        result["total_annual_cost_rs"] = 1.0
                        if penalty_case == "peak_support":
                            result["peak_support_success_pct"] = 0.0
                        else:
                            result["annual_pv_export_kwh"] = annual_pv_energy
                    else:
                        result["total_annual_cost_rs"] = 1_000.0
                        result["peak_support_success_pct"] = 100.0
                        result["annual_pv_export_kwh"] = 0.0
                    pv_self_consumption = (
                        (
                            annual_pv_energy
                            - float(result["annual_pv_export_kwh"])
                        )
                        / annual_pv_energy
                        * 100.0
                    )
                    refresh_constraint_metrics(
                        result,
                        pv_self_consumption_pct=pv_self_consumption,
                    )
                    return result

                result = run_single_ga(
                    **ga_arguments(
                        minimum_bess_capacity_kwh=100.0,
                        maximum_bess_capacity_kwh=200.0,
                        population_size=4,
                        generations=1,
                        elite_count=1,
                        random_seed=42,
                        evaluator=penalized_evaluator,
                    )
                )

                self.assertEqual(result["best_bess_capacity_kwh"], 200.0)
                self.assertEqual(result["best_total_annual_cost_rs"], 1_000.0)
                self.assertEqual(result["solution_status"], "feasible_solution")
                self.assertTrue(result["is_feasible"])

    def test_tournament_and_elite_ranking_use_fitness_values(self) -> None:
        population = [[100.0, 20.0], [200.0, 30.0], [300.0, 40.0]]
        fitness_values = [500.0, 10.0, 100.0]
        rng = Mock()
        rng.sample.return_value = [0, 1, 2]

        selected = single_ga_service._tournament_selection(
            population,
            fitness_values,
            rng,
        )
        ranked_indices = single_ga_service._rank_indices_by_fitness(
            fitness_values
        )

        self.assertEqual(selected, population[1])
        self.assertEqual(ranked_indices, [1, 2, 0])

    def test_feasible_candidate_outranks_cheaper_infeasible_diagnostic(self) -> None:
        base_evaluator = fake_evaluator()

        def mixed_evaluator(**kwargs: object) -> dict[str, object]:
            result = base_evaluator(**kwargs)
            if float(result["bess_capacity_kwh"]) == 100.0:
                result["total_annual_cost_rs"] = 1.0
                result["peak_support_success_pct"] = 94.9
            else:
                result["total_annual_cost_rs"] = 2_000_000.0
                result["peak_support_success_pct"] = 100.0
            refresh_constraint_metrics(
                result,
                pv_self_consumption_pct=100.0,
            )
            return result

        result = run_single_ga(
            **ga_arguments(
                minimum_bess_capacity_kwh=100.0,
                maximum_bess_capacity_kwh=200.0,
                population_size=4,
                generations=1,
                elite_count=1,
                random_seed=42,
                evaluator=mixed_evaluator,
            )
        )

        infeasible_fitness = 1.0 + 1_000_000_000.0 * (0.1 / 95.0)
        self.assertLess(infeasible_fitness, 2_000_000.0)
        self.assertEqual(result["solution_status"], "feasible_solution")
        self.assertTrue(result["is_feasible"])
        self.assertEqual(result["best_bess_capacity_kwh"], 200.0)
        self.assertEqual(result["best_total_annual_cost_rs"], 2_000_000.0)
        self.assertEqual(result["best_fitness_rs"], 2_000_000.0)

    def test_narrow_infeasible_bounds_return_diagnostic_status(self) -> None:
        arguments = ga_arguments(
            records=dispatch_records(),
            minimum_bess_capacity_kwh=100.0,
            maximum_bess_capacity_kwh=199.0,
            minimum_peak_support_pct=99.0,
            maximum_peak_support_pct=100.0,
            population_size=4,
            generations=1,
            elite_count=1,
        )
        arguments.pop("evaluator")

        result = run_single_ga(**arguments)

        self.assertEqual(result["solution_status"], "no_feasible_candidate")
        self.assertEqual(
            result["solution_message"],
            "No candidate within the selected search bounds satisfied all "
            "technical constraints.",
        )
        self.assertFalse(result["is_feasible"])
        self.assertGreater(result["total_penalty_rs"], 0.0)
        warning_codes = {warning["code"] for warning in result["warnings"]}
        self.assertIn("NO_FEASIBLE_CANDIDATE", warning_codes)

    def test_known_feasible_search_region_returns_feasible_solution(self) -> None:
        arguments = ga_arguments(
            records=dispatch_records(),
            minimum_bess_capacity_kwh=300.0,
            maximum_bess_capacity_kwh=399.0,
            minimum_peak_support_pct=99.0,
            maximum_peak_support_pct=100.0,
            population_size=4,
            generations=1,
            elite_count=1,
        )
        arguments.pop("evaluator")

        result = run_single_ga(**arguments)

        self.assertEqual(result["solution_status"], "feasible_solution")
        self.assertTrue(result["is_feasible"])
        self.assertGreaterEqual(result["peak_support_success_pct"], 95.0)
        self.assertGreaterEqual(result["pv_self_consumption_pct"], 40.0)
        self.assertEqual(result["total_penalty_rs"], 0.0)
        self.assertEqual(result["fitness_rs"], result["total_annual_cost_rs"])

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
