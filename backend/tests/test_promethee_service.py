import math
import unittest

from pydantic import ValidationError

from app.api.promethee import calculate_promethee_endpoint
from app.main import app
from app.schemas.promethee import (
    PrometheeAlternative,
    PrometheeCalculationRequest,
)
from app.services.promethee_service import (
    CRITERIA_ORDER,
    CRITERION_DIRECTIONS,
    calculate_promethee,
    type_iii_preference,
)


def alternative(
    name: str,
    *,
    feasible: bool = True,
    **overrides: float,
) -> PrometheeAlternative:
    values: dict[str, object] = {
        "battery_name": name,
        "solution_status": (
            "feasible_solution" if feasible else "no_feasible_candidate"
        ),
        "failed_constraints": [] if feasible else ["peak_support"],
        "is_feasible": feasible,
        "total_annual_cost_rs": 100.0,
        "cycle_based_life_years": 10.0,
        "round_trip_efficiency": 0.9,
        "weight_density_kg_per_kwh": 8.0,
        "annual_om_cost_rs": 5.0,
        "warranty_years": 7.0,
    }
    values.update(overrides)
    return PrometheeAlternative(**values)


class TestTypeThreePreference(unittest.TestCase):
    def test_type_three_boundaries(self) -> None:
        p = 20.0
        expected = [
            (-1.0, 0.0),
            (0.0, 0.0),
            (0.25 * p, 0.25),
            (0.50 * p, 0.50),
            (p, 1.0),
            (2.0 * p, 1.0),
        ]
        for difference, preference in expected:
            with self.subTest(difference=difference):
                self.assertEqual(
                    type_iii_preference(difference, p),
                    preference,
                )
        self.assertEqual(type_iii_preference(10.0, 0.0), 0.0)


class TestPrometheeCriterionOrientation(unittest.TestCase):
    def test_every_criterion_uses_the_required_orientation(self) -> None:
        cases = {
            "total_annual_cost_rs": (50.0, 150.0),
            "cycle_based_life_years": (20.0, 10.0),
            "round_trip_efficiency": (0.95, 0.80),
            "weight_density_kg_per_kwh": (5.0, 10.0),
            "annual_om_cost_rs": (2.0, 8.0),
            "warranty_years": (12.0, 5.0),
        }
        self.assertEqual(
            dict(zip(CRITERIA_ORDER, CRITERION_DIRECTIONS, strict=True)),
            {
                "total_annual_cost_rs": "minimize",
                "cycle_based_life_years": "maximize",
                "round_trip_efficiency": "maximize",
                "weight_density_kg_per_kwh": "minimize",
                "annual_om_cost_rs": "minimize",
                "warranty_years": "maximize",
            },
        )

        for criterion_index, criterion in enumerate(CRITERIA_ORDER):
            with self.subTest(criterion=criterion):
                better, worse = cases[criterion]
                weights = [0.0] * 6
                weights[criterion_index] = 1.0
                result = calculate_promethee(
                    [
                        alternative("Better", **{criterion: better}),
                        alternative("Worse", **{criterion: worse}),
                    ],
                    weights,
                )
                self.assertEqual(
                    result["criterion_preference_matrices"][criterion],
                    [[0.0, 1.0], [0.0, 0.0]],
                )
                self.assertEqual(result["recommended_battery"], "Better")


class TestPrometheeFlows(unittest.TestCase):
    def test_flow_invariants_and_descending_ranking(self) -> None:
        result = calculate_promethee(
            [
                alternative("A", total_annual_cost_rs=80.0, warranty_years=10.0),
                alternative("B", total_annual_cost_rs=100.0, warranty_years=8.0),
                alternative("C", total_annual_cost_rs=140.0, warranty_years=5.0),
            ],
            [2.0, 1.0, 1.0, 1.0, 1.0, 1.0],
        )

        aggregated = result["aggregated_preference_matrix"]
        self.assertTrue(all(aggregated[index][index] == 0.0 for index in range(3)))
        for matrix in result["criterion_preference_matrices"].values():
            self.assertTrue(
                all(0.0 <= value <= 1.0 for row in matrix for value in row)
            )
        self.assertTrue(
            all(0.0 <= value <= 1.0 for row in aggregated for value in row)
        )
        self.assertTrue(all(0.0 <= value <= 1.0 for value in result["positive_flows"]))
        self.assertTrue(all(0.0 <= value <= 1.0 for value in result["negative_flows"]))
        self.assertAlmostEqual(
            sum(result["positive_flows"]),
            sum(result["negative_flows"]),
            places=12,
        )
        self.assertAlmostEqual(sum(result["net_flows"]), 0.0, places=12)
        ranked_flows = [item["net_flow"] for item in result["ordered_ranking"]]
        self.assertEqual(ranked_flows, sorted(ranked_flows, reverse=True))

    def test_constant_ranges_produce_zero_preferences_without_division(self) -> None:
        result = calculate_promethee(
            [alternative("First"), alternative("Second")],
            [1.0] * 6,
        )
        self.assertEqual(result["p_thresholds"], [0.0] * 6)
        self.assertEqual(result["aggregated_preference_matrix"], [[0.0, 0.0], [0.0, 0.0]])
        self.assertEqual(
            [entry["battery_name"] for entry in result["ordered_ranking"]],
            ["First", "Second"],
        )
        self.assertFalse(
            any(math.copysign(1.0, value) < 0 for value in result["net_flows"])
        )


class TestPrometheeFeasibility(unittest.TestCase):
    def test_infeasible_alternative_is_visible_but_never_ranked(self) -> None:
        result = calculate_promethee(
            [
                alternative("Feasible A", total_annual_cost_rs=90.0),
                alternative("Excluded", feasible=False, total_annual_cost_rs=1.0),
                alternative("Feasible B", total_annual_cost_rs=110.0),
            ],
            [1.0, 0.0, 0.0, 0.0, 0.0, 0.0],
        )
        self.assertEqual(result["scientific_status"], "ranking_completed")
        self.assertEqual(result["recommended_battery"], "Feasible A")
        self.assertNotIn(
            "Excluded",
            [entry["battery_name"] for entry in result["ordered_ranking"]],
        )
        self.assertEqual(
            result["excluded_alternatives"],
            [{
                "battery_name": "Excluded",
                "solution_status": "no_feasible_candidate",
                "failed_constraints": ["peak_support"],
            }],
        )

    def test_one_feasible_alternative_does_not_calculate_flows(self) -> None:
        result = calculate_promethee(
            [alternative("Only feasible"), alternative("Excluded", feasible=False)],
            [1.0] * 6,
        )
        self.assertEqual(
            result["scientific_status"],
            "insufficient_feasible_alternatives",
        )
        self.assertEqual(result["aggregated_preference_matrix"], [])
        self.assertEqual(result["ordered_ranking"], [])
        self.assertIsNone(result["recommended_battery"])

    def test_zero_feasible_alternatives_does_not_calculate_flows(self) -> None:
        result = calculate_promethee(
            [alternative("Excluded A", feasible=False), alternative("Excluded B", feasible=False)],
            [1.0] * 6,
        )
        self.assertEqual(result["scientific_status"], "no_feasible_alternatives")
        self.assertEqual(len(result["excluded_alternatives"]), 2)
        self.assertEqual(result["ordered_ranking"], [])
        self.assertIsNone(result["recommended_battery"])


class TestPrometheeValidation(unittest.TestCase):
    def test_fewer_than_two_alternatives_are_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "At least two"):
            calculate_promethee([alternative("Only")], [1.0] * 6)

    def test_weights_are_normalized(self) -> None:
        result = calculate_promethee(
            [alternative("A"), alternative("B")],
            [2.0, 2.0, 1.0, 1.0, 1.0, 1.0],
        )
        self.assertAlmostEqual(sum(result["normalized_weights"]), 1.0, places=12)
        self.assertEqual(result["normalized_weights"][:2], [0.25, 0.25])

    def test_duplicate_names_and_invalid_weight_dimensions_are_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "unique"):
            calculate_promethee(
                [alternative("Same"), alternative(" same ")],
                [1.0] * 6,
            )
        with self.assertRaisesRegex(ValueError, "Exactly six"):
            calculate_promethee(
                [alternative("A"), alternative("B")],
                [1.0] * 5,
            )

    def test_non_finite_values_negative_weights_and_zero_total_are_rejected(self) -> None:
        with self.assertRaises(ValidationError):
            alternative("Invalid", total_annual_cost_rs=math.inf)
        with self.assertRaisesRegex(ValueError, "negative"):
            calculate_promethee(
                [alternative("A"), alternative("B")],
                [-1.0, 1.0, 1.0, 1.0, 1.0, 1.0],
            )
        with self.assertRaisesRegex(ValueError, "greater than zero"):
            calculate_promethee(
                [alternative("A"), alternative("B")],
                [0.0] * 6,
            )

    def test_schema_rejects_missing_criteria_and_malformed_feasibility(self) -> None:
        payload = alternative("A").model_dump()
        payload.pop("warranty_years")
        with self.assertRaises(ValidationError):
            PrometheeAlternative(**payload)
        with self.assertRaises(ValidationError):
            PrometheeAlternative(
                **{
                    **alternative("B").model_dump(),
                    "is_feasible": False,
                }
            )

    def test_schema_rejects_negative_criteria_and_efficiency_outside_range(self) -> None:
        for criterion in (
            "total_annual_cost_rs",
            "cycle_based_life_years",
            "weight_density_kg_per_kwh",
            "annual_om_cost_rs",
            "warranty_years",
        ):
            with self.subTest(criterion=criterion), self.assertRaises(ValidationError):
                alternative("Invalid", **{criterion: -0.1})
        for efficiency in (0.0, -0.1, 1.01):
            with self.subTest(efficiency=efficiency), self.assertRaises(ValidationError):
                alternative("Invalid", round_trip_efficiency=efficiency)


class TestPrometheeManualParity(unittest.TestCase):
    def test_manually_calculated_three_alternative_example(self) -> None:
        result = calculate_promethee(
            [
                alternative("A", total_annual_cost_rs=10.0),
                alternative("B", total_annual_cost_rs=20.0),
                alternative("C", total_annual_cost_rs=30.0),
            ],
            [1.0, 0.0, 0.0, 0.0, 0.0, 0.0],
            accepted_ahp_revision=7,
        )

        expected_matrix = [
            [0.0, 0.5, 1.0],
            [0.0, 0.0, 0.5],
            [0.0, 0.0, 0.0],
        ]
        self.assertEqual(result["p_thresholds"], [20.0, 0.0, 0.0, 0.0, 0.0, 0.0])
        self.assertEqual(
            result["criterion_preference_matrices"]["total_annual_cost_rs"],
            expected_matrix,
        )
        self.assertEqual(result["aggregated_preference_matrix"], expected_matrix)
        self.assertEqual(result["positive_flows"], [0.75, 0.25, 0.0])
        self.assertEqual(result["negative_flows"], [0.0, 0.25, 0.75])
        self.assertEqual(result["net_flows"], [0.75, 0.0, -0.75])
        self.assertEqual(
            [entry["battery_name"] for entry in result["ordered_ranking"]],
            ["A", "B", "C"],
        )
        self.assertEqual(result["recommended_battery"], "A")
        self.assertEqual(result["accepted_ahp_revision"], 7)


class TestPrometheeAPI(unittest.TestCase):
    def test_route_is_registered_and_serializes_response(self) -> None:
        operation = app.openapi()["paths"]["/api/promethee/calculate"]
        self.assertIn("post", operation)
        request = PrometheeCalculationRequest(
            alternatives=[alternative("A"), alternative("B")],
            ahp_weights=[1.0] * 6,
            accepted_ahp_revision="revision-4",
        )
        response = calculate_promethee_endpoint(request)
        self.assertEqual(response.scientific_status, "ranking_completed")
        self.assertEqual(response.accepted_ahp_revision, "revision-4")


if __name__ == "__main__":
    unittest.main()
