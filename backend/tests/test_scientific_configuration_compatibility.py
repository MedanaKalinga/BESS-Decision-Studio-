import unittest

from app.config.scientific_compatibility import (
    mark_scientific_state_compatibility,
)


class TestScientificConfigurationCompatibility(unittest.TestCase):
    def test_old_six_criterion_states_are_preserved_but_not_current(self) -> None:
        legacy = {
            "comparisonAhp": {
                "matrix": [[1.0] * 6 for _ in range(6)],
                "accepted": True,
            },
            "promethee": {
                "result": {
                    "criteria_order": [
                        "total_annual_cost_rs",
                        "cycle_based_life_years",
                        "round_trip_efficiency",
                        "weight_density_kg_per_kwh",
                        "annual_om_cost_rs",
                        "warranty_years",
                    ]
                },
                "stale": False,
            },
        }

        visible = mark_scientific_state_compatibility(legacy)

        self.assertTrue(legacy["comparisonAhp"]["accepted"])
        self.assertFalse(visible["comparisonAhp"]["accepted"])
        self.assertTrue(visible["comparisonAhp"]["incompatible"])
        self.assertTrue(visible["promethee"]["stale"])
        self.assertTrue(visible["promethee"]["incompatible"])

    def test_five_criterion_states_receive_current_version(self) -> None:
        state = {
            "comparisonAhp": {"matrix": [[1.0] * 5 for _ in range(5)]},
            "promethee": {"result": {"criteria_order": ["a", "b", "c", "d", "e"]}},
        }
        visible = mark_scientific_state_compatibility(state)
        self.assertEqual(visible["comparisonAhp"]["scientificConfigurationVersion"], 3)
        self.assertEqual(visible["promethee"]["scientificConfigurationVersion"], 3)


if __name__ == "__main__":
    unittest.main()
