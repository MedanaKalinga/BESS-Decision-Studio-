import unittest

from app.api.configuration import get_default_configuration
from app.config.defaults import (
    DEFAULT_AHP_MATRIX,
    DEFAULT_BATTERY_TYPES,
    DEFAULT_CRITERIA,
    DEFAULT_DISPATCH_PERIODS,
    PV_NOT_DISPATCHED_WARNING,
    SCIENTIFIC_CONFIGURATION_VERSION,
)


class TestDefaultConfiguration(unittest.TestCase):
    def test_criteria_use_comparison_mode_contract_order(self) -> None:
        self.assertEqual(
            DEFAULT_CRITERIA,
            [
                {"name": "total_annual_cost_Rs", "direction": "minimize"},
                {"name": "cycle_based_life_years", "direction": "maximize"},
                {"name": "round_trip_efficiency", "direction": "maximize"},
                {"name": "weight_density_kg_per_kwh", "direction": "minimize"},
                {"name": "warranty_years", "direction": "maximize"},
            ],
        )

    def test_battery_catalogue_matches_v3_reference(self) -> None:
        self.assertEqual(
            DEFAULT_BATTERY_TYPES,
            [
                {"name": "Low-cost", "price_rs_per_kwh": 45000, "rated_cycle_life": 5000, "eta_ch": 0.92, "eta_dis": 0.92, "weight_density_kg_per_kwh": 10.0, "warranty_years": 10.0},
                {"name": "Medium-low", "price_rs_per_kwh": 55000, "rated_cycle_life": 6500, "eta_ch": 0.935, "eta_dis": 0.935, "weight_density_kg_per_kwh": 8.5, "warranty_years": 10.0},
                {"name": "Medium", "price_rs_per_kwh": 65000, "rated_cycle_life": 8000, "eta_ch": 0.95, "eta_dis": 0.95, "weight_density_kg_per_kwh": 8.0, "warranty_years": 12.0},
                {"name": "High", "price_rs_per_kwh": 75000, "rated_cycle_life": 9500, "eta_ch": 0.96, "eta_dis": 0.96, "weight_density_kg_per_kwh": 8.0, "warranty_years": 15.0},
            ],
        )
        self.assertNotIn("Medium-high", {item["name"] for item in DEFAULT_BATTERY_TYPES})

    def test_default_ahp_matrix_and_configuration_version_match_v3(self) -> None:
        self.assertEqual(
            DEFAULT_AHP_MATRIX,
            [
                [1.0, 1.0, 4.0, 3.0, 5.0],
                [1.0, 1.0, 4.0, 2.0, 3.0],
                [0.25, 0.25, 1.0, 1.0, 1.0],
                [1 / 3, 0.5, 1.0, 1.0, 2.0],
                [0.2, 1 / 3, 1.0, 0.5, 1.0],
            ],
        )
        self.assertEqual(SCIENTIFIC_CONFIGURATION_VERSION, 3)
        self.assertEqual(
            get_default_configuration()["scientific_configuration_version"],
            3,
        )

    def test_configuration_endpoint_includes_dispatch_periods(self) -> None:
        configuration = get_default_configuration()

        self.assertIn("dispatch_periods", configuration)
        self.assertEqual(
            configuration["dispatch_periods"], DEFAULT_DISPATCH_PERIODS
        )

    def test_dispatch_periods_match_reference_strategy(self) -> None:
        expected_periods = [
            {
                "name": "Off-peak 1",
                "start": "00:00",
                "end": "05:30",
                "ev_supply_priority": ["BESS", "Grid"],
                "bess_discharge_allowed": True,
                "bess_charge_allowed": False,
                "pv_handling": "not_used",
                "source": "reference_code_default",
                "warning": PV_NOT_DISPATCHED_WARNING,
            },
            {
                "name": "Day",
                "start": "05:30",
                "end": "18:30",
                "ev_supply_priority": ["PV", "Grid"],
                "excess_pv_priority": ["BESS", "Export"],
                "bess_charge_allowed": True,
                "bess_discharge_allowed": False,
                "source": "reference_code_default",
            },
            {
                "name": "Peak",
                "start": "18:30",
                "end": "22:30",
                "ev_supply_priority": ["BESS", "Grid"],
                "bess_discharge_allowed": True,
                "bess_discharge_control": "peak_share",
                "bess_charge_allowed": False,
                "pv_handling": "not_used",
                "source": "reference_code_default",
                "warning": PV_NOT_DISPATCHED_WARNING,
            },
            {
                "name": "Off-peak 2",
                "start": "22:30",
                "end": "24:00",
                "ev_supply_priority": ["BESS", "Grid"],
                "bess_discharge_allowed": True,
                "bess_charge_allowed": False,
                "pv_handling": "not_used",
                "source": "reference_code_default",
                "warning": PV_NOT_DISPATCHED_WARNING,
            },
        ]

        self.assertEqual(DEFAULT_DISPATCH_PERIODS, expected_periods)

    def test_periods_cover_the_full_day_in_reference_order(self) -> None:
        boundaries = [
            (period["start"], period["end"])
            for period in DEFAULT_DISPATCH_PERIODS
        ]

        self.assertEqual(
            boundaries,
            [
                ("00:00", "05:30"),
                ("05:30", "18:30"),
                ("18:30", "22:30"),
                ("22:30", "24:00"),
            ],
        )

    def test_warning_is_present_only_when_pv_is_not_dispatched(self) -> None:
        periods_by_name = {
            period["name"]: period for period in DEFAULT_DISPATCH_PERIODS
        }

        for period_name in ("Off-peak 1", "Peak", "Off-peak 2"):
            self.assertEqual(
                periods_by_name[period_name]["warning"],
                PV_NOT_DISPATCHED_WARNING,
            )
        self.assertNotIn("warning", periods_by_name["Day"])

    def test_all_periods_identify_the_reference_source(self) -> None:
        self.assertTrue(
            all(
                period["source"] == "reference_code_default"
                for period in DEFAULT_DISPATCH_PERIODS
            )
        )


if __name__ == "__main__":
    unittest.main()
