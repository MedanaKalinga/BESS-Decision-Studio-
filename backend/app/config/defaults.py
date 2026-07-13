DEFAULT_BATTERY_TYPES: list[dict[str, str | int | float]] = [
    {
        "name": "Low-cost",
        "price_rs_per_kwh": 44000,
        "rated_cycle_life": 3000,
        "eta_ch": 0.92,
        "eta_dis": 0.92,
        "weight_density_kg_per_kwh": 8.5,
        "warranty_years": 5.0,
    },
    {
        "name": "Medium-low",
        "price_rs_per_kwh": 56000,
        "rated_cycle_life": 5000,
        "eta_ch": 0.935,
        "eta_dis": 0.935,
        "weight_density_kg_per_kwh": 8.0,
        "warranty_years": 7.0,
    },
    {
        "name": "Medium",
        "price_rs_per_kwh": 68000,
        "rated_cycle_life": 7000,
        "eta_ch": 0.95,
        "eta_dis": 0.95,
        "weight_density_kg_per_kwh": 7.5,
        "warranty_years": 10.0,
    },
    {
        "name": "Medium-high",
        "price_rs_per_kwh": 80000,
        "rated_cycle_life": 9000,
        "eta_ch": 0.96,
        "eta_dis": 0.96,
        "weight_density_kg_per_kwh": 7.0,
        "warranty_years": 12.0,
    },
]


DEFAULT_CRITERIA: list[dict[str, str]] = [
    {"name": "total_annual_cost_Rs", "direction": "minimize"},
    {"name": "cycle_based_life_years", "direction": "maximize"},
    {"name": "round_trip_efficiency", "direction": "maximize"},
    {"name": "weight_density_kg_per_kwh", "direction": "minimize"},
    {"name": "bess_om_cost_annual_Rs", "direction": "minimize"},
    {"name": "warranty_years", "direction": "maximize"},
]


DEFAULT_AHP_MATRIX: list[list[float]] = [
    [1.0, 1.0, 4.0, 3.0, 4.0, 5.0],
    [1.0, 1.0, 4.0, 2.0, 2.0, 3.0],
    [1 / 4, 1 / 4, 1.0, 1.0, 1 / 2, 1.0],
    [1 / 3, 1 / 2, 1.0, 1.0, 1.0, 2.0],
    [1 / 4, 1 / 2, 2.0, 1.0, 1.0, 1.0],
    [1 / 5, 1 / 3, 1.0, 1 / 2, 1.0, 1.0],
]


PV_NOT_DISPATCHED_WARNING = (
    "PV is not explicitly dispatched during this period in the current "
    "reference code."
)


DEFAULT_DISPATCH_PERIODS: list[dict[str, object]] = [
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
