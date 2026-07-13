"""Scientific evaluation for one fixed BESS size and peak-support share.

The dispatch and rainflow calculations in this module are a standard-library
port of ``original_code/bess_ga_ahp_promethee.py``.  Keeping the calculation in
this service avoids coupling API routing to the protected reference script and,
in particular, ensures that the submitted battery efficiencies are used
directly instead of reloading a catalogue entry.

The reference script has no residual-value model.  When residual value is
enabled here, the unused fraction of the final installed battery's cycle-based
life is valued on a straight-line basis at the project horizon.  That future
value is discounted at the submitted discount rate and subtracted from lifecycle
present value before annualization.  A structured warning always identifies
this deliberate extension.
"""

from __future__ import annotations

import math
from collections import deque
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .dataset_service import (
    LEAP_YEAR_ROWS,
    NORMAL_YEAR_ROWS,
    STORAGE_DIR,
    load_dataset_records,
)


DT_HOURS = 0.25
ROWS_PER_DAY = 96

SOC_MIN = 0.10
SOC_MAX = 0.90
SOC_INIT = 0.50
C_RATE = 1.0

BESS_MIN_KWH = 0.0
BESS_MAX_KWH = 10_000.0
BESS_ROUNDING_KWH = 100.0

SUPPORT_THRESHOLD_PERCENT = 95.0
PV_SELF_CONSUMPTION_THRESHOLD_PERCENT = 40.0
PENALTY_COST_RS = 1_000_000_000.0

DEFAULT_OFFPEAK_TARIFF_RS_PER_KWH = 15.0
DEFAULT_DAY_TARIFF_RS_PER_KWH = 15.0
DEFAULT_PEAK_TARIFF_RS_PER_KWH = 75.0

RFC_BIN_SIZE_PERCENT = 2.0
RFC_HYSTERESIS_PERCENT = 2.0
RFC_MIN_DOD_PERCENT = 2.0
RATED_CYCLE_DOD_PERCENT = (SOC_MAX - SOC_MIN) * 100.0

REFERENCE_DISPATCH_STATUS = "Reference Strategy"
MAX_REPLACEMENTS = 100_000


class ModifiedDispatchStrategyError(ValueError):
    """Raised when an evaluation requests a strategy not scientifically wired."""

    code = "MODIFIED_DISPATCH_NOT_CONNECTED"
    message = (
        "The modified dispatch strategy will be supported after scientific "
        "parity validation."
    )

    def __init__(self) -> None:
        super().__init__(self.message)


def _warning(code: str, message: str) -> dict[str, str]:
    return {"code": code, "message": message}


def _source_value(source: Mapping[str, object] | object, field: str) -> object:
    if isinstance(source, Mapping):
        if field not in source:
            raise ValueError(f"Missing required field: {field}.")
        return source[field]
    try:
        return getattr(source, field)
    except AttributeError as exc:
        raise ValueError(f"Missing required field: {field}.") from exc


def _finite_number(value: object, field: str) -> float:
    if isinstance(value, bool):
        raise ValueError(f"{field} must be a finite number.")
    try:
        converted = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{field} must be a finite number.") from exc
    if not math.isfinite(converted):
        raise ValueError(f"{field} must be a finite number.")
    return converted


def _validated_inputs(
    battery: Mapping[str, object] | object,
    economic_settings: Mapping[str, object] | object,
    bess_capacity_kwh: float,
    peak_support_pct: float,
) -> tuple[dict[str, object], dict[str, object], float, float]:
    name = str(_source_value(battery, "name")).strip()
    if not name:
        raise ValueError("Battery name must not be empty.")

    battery_values: dict[str, object] = {
        "name": name,
        "price_rs_per_kwh": _finite_number(
            _source_value(battery, "price_rs_per_kwh"), "price_rs_per_kwh"
        ),
        "rated_cycle_life": _finite_number(
            _source_value(battery, "rated_cycle_life"), "rated_cycle_life"
        ),
        "eta_ch": _finite_number(_source_value(battery, "eta_ch"), "eta_ch"),
        "eta_dis": _finite_number(_source_value(battery, "eta_dis"), "eta_dis"),
        "weight_density_kg_per_kwh": _finite_number(
            _source_value(battery, "weight_density_kg_per_kwh"),
            "weight_density_kg_per_kwh",
        ),
        "warranty_years": _finite_number(
            _source_value(battery, "warranty_years"), "warranty_years"
        ),
    }
    if battery_values["price_rs_per_kwh"] <= 0:
        raise ValueError("price_rs_per_kwh must be greater than zero.")
    if battery_values["rated_cycle_life"] <= 0:
        raise ValueError("rated_cycle_life must be greater than zero.")
    if not 0 < battery_values["eta_ch"] <= 1:
        raise ValueError("eta_ch must be greater than zero and at most one.")
    if not 0 < battery_values["eta_dis"] <= 1:
        raise ValueError("eta_dis must be greater than zero and at most one.")
    if battery_values["weight_density_kg_per_kwh"] <= 0:
        raise ValueError("weight_density_kg_per_kwh must be greater than zero.")
    if battery_values["warranty_years"] < 0:
        raise ValueError("warranty_years must be non-negative.")

    residual_value_enabled = _source_value(
        economic_settings, "residual_value_enabled"
    )
    if not isinstance(residual_value_enabled, bool):
        raise ValueError("residual_value_enabled must be a boolean.")

    economics: dict[str, object] = {
        "project_life_years": _finite_number(
            _source_value(economic_settings, "project_life_years"),
            "project_life_years",
        ),
        "discount_rate": _finite_number(
            _source_value(economic_settings, "discount_rate"),
            "discount_rate",
        ),
        "export_tariff_rs_per_kwh": _finite_number(
            _source_value(economic_settings, "export_tariff_rs_per_kwh"),
            "export_tariff_rs_per_kwh",
        ),
        "annual_om_fraction": _finite_number(
            _source_value(economic_settings, "annual_om_fraction"),
            "annual_om_fraction",
        ),
        "replacement_cost_fraction": _finite_number(
            _source_value(economic_settings, "replacement_cost_fraction"),
            "replacement_cost_fraction",
        ),
        "residual_value_enabled": residual_value_enabled,
    }
    if economics["project_life_years"] <= 0:
        raise ValueError("project_life_years must be greater than zero.")
    if not float(economics["project_life_years"]).is_integer():
        raise ValueError("project_life_years must be a whole number.")
    if not 0 <= economics["discount_rate"] <= 1:
        raise ValueError("discount_rate must be between zero and one.")
    if economics["export_tariff_rs_per_kwh"] < 0:
        raise ValueError("export_tariff_rs_per_kwh must be non-negative.")
    if not 0 <= economics["annual_om_fraction"] <= 1:
        raise ValueError("annual_om_fraction must be between zero and one.")
    if not 0 <= economics["replacement_cost_fraction"] <= 1:
        raise ValueError("replacement_cost_fraction must be between zero and one.")

    capacity = _finite_number(bess_capacity_kwh, "bess_capacity_kwh")
    support_pct = _finite_number(peak_support_pct, "peak_support_pct")
    if capacity < 0:
        raise ValueError("bess_capacity_kwh must be non-negative.")
    if not 0 <= support_pct <= 100:
        raise ValueError("peak_support_pct must be between zero and 100.")

    return battery_values, economics, capacity, support_pct


def _period(index: int) -> str:
    hour_decimal = (index % ROWS_PER_DAY) * DT_HOURS
    if 5.5 <= hour_decimal < 18.5:
        return "day"
    if 18.5 <= hour_decimal < 22.5:
        return "peak"
    return "offpeak"


def _default_tariff(index: int) -> float:
    period = _period(index)
    if period == "peak":
        return DEFAULT_PEAK_TARIFF_RS_PER_KWH
    if period == "day":
        return DEFAULT_DAY_TARIFF_RS_PER_KWH
    return DEFAULT_OFFPEAK_TARIFF_RS_PER_KWH


def _hysteresis_filter(signal: Sequence[float]) -> list[float]:
    filtered = [float(signal[0])]
    for value in signal[1:]:
        value = float(value)
        if abs(value - filtered[-1]) < RFC_HYSTERESIS_PERCENT:
            filtered.append(filtered[-1])
        else:
            filtered.append(value)
    return filtered


def _soc_binning(signal: Sequence[float]) -> list[float]:
    return [
        min(
            max(
                round(value / RFC_BIN_SIZE_PERCENT) * RFC_BIN_SIZE_PERCENT,
                SOC_MIN * 100.0,
            ),
            SOC_MAX * 100.0,
        )
        for value in signal
    ]


def _turning_points(signal: Sequence[float]) -> list[float]:
    if not signal:
        return []
    points = [float(signal[0])]
    for index in range(1, len(signal) - 1):
        value = float(signal[index])
        is_peak = value >= signal[index - 1] and value > signal[index + 1]
        is_valley = value <= signal[index - 1] and value < signal[index + 1]
        if (is_peak or is_valley) and value != points[-1]:
            points.append(value)
    if float(signal[-1]) != points[-1]:
        points.append(float(signal[-1]))
    return points


def _reversals(series: Sequence[float]):
    points: list[tuple[int, float]] = []
    for index, raw_value in enumerate(series):
        value = float(raw_value)
        if not points or value != points[-1][1]:
            points.append((index, value))
    if not points:
        return
    if len(points) == 1:
        yield points[0]
        return
    yield points[0]
    for index in range(1, len(points) - 1):
        previous_value = points[index - 1][1]
        current_value = points[index][1]
        next_value = points[index + 1][1]
        if (current_value - previous_value) * (next_value - current_value) < 0:
            yield points[index]
    yield points[-1]


def _extract_cycles(series: Sequence[float]):
    """Yield the same four-point rainflow tuples as the reference fallback."""

    points: deque[tuple[int, float]] = deque()
    for point in _reversals(series):
        points.append(point)
        while len(points) >= 3:
            older_range = abs(points[-2][1] - points[-3][1])
            newer_range = abs(points[-1][1] - points[-2][1])
            if older_range > newer_range:
                break
            if len(points) == 3:
                index_start, value_start = points[0]
                index_end, value_end = points[1]
                yield (
                    older_range,
                    0.5 * (value_start + value_end),
                    0.5,
                    index_start,
                    index_end,
                )
                points.popleft()
            else:
                index_start, value_start = points[-3]
                index_end, value_end = points[-2]
                yield (
                    older_range,
                    0.5 * (value_start + value_end),
                    1.0,
                    index_start,
                    index_end,
                )
                last_point = points.pop()
                points.pop()
                points.pop()
                points.append(last_point)

    while len(points) > 1:
        index_start, value_start = points[0]
        index_end, value_end = points[1]
        cycle_range = abs(value_end - value_start)
        yield (
            cycle_range,
            0.5 * (value_start + value_end),
            0.5,
            index_start,
            index_end,
        )
        points.popleft()


def calculate_equivalent_cycles(soc_pu: Sequence[float]) -> float:
    """Return reference-equivalent cycles normalized to the usable 80% DoD."""

    soc_percent = [
        min(max(float(value) * 100.0, SOC_MIN * 100.0), SOC_MAX * 100.0)
        for value in soc_pu
    ]
    if not soc_percent:
        return 0.0
    soc_binned = _soc_binning(_hysteresis_filter(soc_percent))
    peaks = _turning_points(soc_binned)
    if len(peaks) < 2:
        return 0.0

    equivalent_cycles = 0.0
    for _, _, count, index_start, index_end in _extract_cycles(peaks):
        soc_i = min(
            max(
                round(peaks[index_start] / RFC_BIN_SIZE_PERCENT)
                * RFC_BIN_SIZE_PERCENT,
                SOC_MIN * 100.0,
            ),
            SOC_MAX * 100.0,
        )
        soc_j = min(
            max(
                round(peaks[index_end] / RFC_BIN_SIZE_PERCENT)
                * RFC_BIN_SIZE_PERCENT,
                SOC_MIN * 100.0,
            ),
            SOC_MAX * 100.0,
        )
        dod_percent = abs(soc_j - soc_i)
        if dod_percent < RFC_MIN_DOD_PERCENT:
            continue
        equivalent_cycles += (dod_percent / RATED_CYCLE_DOD_PERCENT) * count
    return equivalent_cycles


def _capital_recovery_factor(discount_rate: float, years: float) -> float:
    if years <= 0:
        raise ValueError("project_life_years must be greater than zero.")
    if abs(discount_rate) < 1e-12:
        return 1.0 / years
    growth = (1.0 + discount_rate) ** years
    denominator = growth - 1.0
    if abs(denominator) < 1e-15:
        return 1.0 / years
    result = discount_rate * growth / denominator
    if not math.isfinite(result):
        raise ValueError("Economic settings produced a non-finite capital recovery factor.")
    return result


def _replacement_years(
    service_life_years: float | None,
    project_life_years: float,
) -> list[float]:
    if service_life_years is None or service_life_years <= 0:
        return []
    estimated_count = max(
        math.ceil((project_life_years - 1e-9) / service_life_years) - 1,
        0,
    )
    if estimated_count > MAX_REPLACEMENTS:
        raise ValueError(
            "The battery parameters produce more than 100,000 replacements "
            "within the project life."
        )
    return [
        service_life_years * index
        for index in range(1, estimated_count + 1)
        if service_life_years * index < project_life_years - 1e-9
    ]


def _replacement_present_value(
    *,
    initial_capex: float,
    replacement_cost_fraction: float,
    replacement_years: Sequence[float],
    discount_rate: float,
) -> float:
    """Discount scheduled replacement costs using the submitted rate directly."""

    return sum(
        replacement_cost_fraction
        * initial_capex
        / ((1.0 + discount_rate) ** year)
        for year in replacement_years
    )


def _residual_present_value(
    *,
    initial_capex: float,
    replacement_cost_fraction: float,
    service_life_years: float | None,
    replacement_years: Sequence[float],
    project_life_years: float,
    discount_rate: float,
) -> float:
    last_installation_year = replacement_years[-1] if replacement_years else 0.0
    installed_cost = (
        replacement_cost_fraction * initial_capex
        if replacement_years
        else initial_capex
    )
    if service_life_years is None:
        remaining_fraction = 1.0
    else:
        remaining_life = max(
            last_installation_year + service_life_years - project_life_years,
            0.0,
        )
        remaining_fraction = min(remaining_life / service_life_years, 1.0)
    residual_at_horizon = installed_cost * remaining_fraction
    return residual_at_horizon / ((1.0 + discount_rate) ** project_life_years)


def _finite_result(value: float, field: str) -> float:
    converted = float(value)
    if not math.isfinite(converted):
        raise ValueError(f"Scientific calculation produced non-finite {field}.")
    return converted


def calculate_constraint_and_fitness(
    *,
    total_annual_cost_rs: float,
    peak_support_success_pct: float,
    pv_self_consumption_pct: float,
) -> dict[str, float | bool]:
    """Apply the protected reference constraints and penalty formulas."""

    total_cost = _finite_number(
        total_annual_cost_rs,
        "total_annual_cost_rs",
    )
    peak_support = _finite_number(
        peak_support_success_pct,
        "peak_support_success_pct",
    )
    pv_self_consumption = _finite_number(
        pv_self_consumption_pct,
        "pv_self_consumption_pct",
    )

    peak_support_passed = peak_support >= SUPPORT_THRESHOLD_PERCENT
    pv_self_consumption_passed = (
        pv_self_consumption >= PV_SELF_CONSUMPTION_THRESHOLD_PERCENT
    )
    peak_support_penalty = 0.0
    if not peak_support_passed:
        peak_support_penalty = PENALTY_COST_RS * (
            (SUPPORT_THRESHOLD_PERCENT - peak_support)
            / SUPPORT_THRESHOLD_PERCENT
        )
    pv_self_consumption_penalty = 0.0
    if not pv_self_consumption_passed:
        pv_self_consumption_penalty = PENALTY_COST_RS * (
            (
                PV_SELF_CONSUMPTION_THRESHOLD_PERCENT
                - pv_self_consumption
            )
            / PV_SELF_CONSUMPTION_THRESHOLD_PERCENT
        )
    total_penalty = peak_support_penalty + pv_self_consumption_penalty
    fitness = total_cost + total_penalty

    return {
        "peak_support_threshold_pct": SUPPORT_THRESHOLD_PERCENT,
        "pv_self_consumption_threshold_pct": (
            PV_SELF_CONSUMPTION_THRESHOLD_PERCENT
        ),
        "peak_support_constraint_passed": peak_support_passed,
        "pv_self_consumption_constraint_passed": (
            pv_self_consumption_passed
        ),
        "is_feasible": peak_support_passed and pv_self_consumption_passed,
        "peak_support_penalty_rs": _finite_result(
            peak_support_penalty,
            "peak_support_penalty_rs",
        ),
        "pv_self_consumption_penalty_rs": _finite_result(
            pv_self_consumption_penalty,
            "pv_self_consumption_penalty_rs",
        ),
        "total_penalty_rs": _finite_result(
            total_penalty,
            "total_penalty_rs",
        ),
        "fitness_rs": _finite_result(fitness, "fitness_rs"),
    }


@dataclass(frozen=True)
class FixedDispatchSimulation:
    """Detached interval outputs from the verified reference dispatch loop."""

    pv_kw: list[float]
    ev_kw: list[float]
    tariffs_rs_per_kwh: list[float]
    grid_import_kw: list[float]
    pv_export_kw: list[float]
    bess_charge_kw: list[float]
    bess_discharge_kw: list[float]
    soc_pu: list[float]
    effective_capacity_kwh: float
    required_peak_energy_kwh: float
    actual_peak_energy_kwh: float
    warnings: list[dict[str, str]]


def simulate_fixed_bess_dispatch(
    *,
    pv_kw: Sequence[float],
    ev_kw: Sequence[float],
    tariff_rs_per_kwh: Sequence[float | None] | None,
    battery: Mapping[str, object] | object,
    bess_capacity_kwh: float,
    peak_support_pct: float,
    economic_settings: Mapping[str, object] | object,
) -> FixedDispatchSimulation:
    """Run the single verified dispatch implementation and expose its intervals."""

    battery_values, _, requested_capacity, support_pct = _validated_inputs(
        battery,
        economic_settings,
        bess_capacity_kwh,
        peak_support_pct,
    )
    if len(pv_kw) == 0:
        raise ValueError("The dataset must contain at least one interval.")
    if len(pv_kw) != len(ev_kw):
        raise ValueError("PV and EV arrays must have the same length.")
    if tariff_rs_per_kwh is not None and len(tariff_rs_per_kwh) != len(pv_kw):
        raise ValueError("Tariff, PV, and EV arrays must have the same length.")

    pv = [_finite_number(value, "pv_kw") for value in pv_kw]
    ev = [_finite_number(value, "ev_kw") for value in ev_kw]
    warnings: list[dict[str, str]] = []
    tariffs: list[float] = []
    used_default_tariff = tariff_rs_per_kwh is None
    for index in range(len(pv)):
        raw_tariff = (
            None if tariff_rs_per_kwh is None else tariff_rs_per_kwh[index]
        )
        if raw_tariff is None:
            used_default_tariff = True
            tariffs.append(_default_tariff(index))
        else:
            tariffs.append(_finite_number(raw_tariff, "tariff_rs_per_kwh"))
    if used_default_tariff:
        warnings.append(
            _warning(
                "DEFAULT_TOU_TARIFF_USED",
                "No tariff value was available for one or more intervals; the "
                "reference 15/15/75 LKR per kWh TOU tariff was used by period.",
            )
        )
    if len(pv) not in {NORMAL_YEAR_ROWS, LEAP_YEAR_ROWS}:
        warnings.append(
            _warning(
                "PARTIAL_DATASET_AS_ANNUAL_PROFILE",
                "The supplied profile is treated as the annual operating profile "
                "without scaling, matching the reference code.",
            )
        )

    effective_capacity = round(requested_capacity / BESS_ROUNDING_KWH)
    effective_capacity *= BESS_ROUNDING_KWH
    effective_capacity = min(
        max(effective_capacity, BESS_MIN_KWH), BESS_MAX_KWH
    )
    if not math.isclose(effective_capacity, requested_capacity, abs_tol=1e-12):
        warnings.append(
            _warning(
                "BESS_CAPACITY_ADJUSTED_FOR_REFERENCE_PARITY",
                f"The submitted capacity {requested_capacity:g} kWh was rounded "
                f"and clamped to {effective_capacity:g} kWh using the reference "
                "100 kWh sizing rule and 0-10,000 kWh bounds.",
            )
        )

    eta_ch = float(battery_values["eta_ch"])
    eta_dis = float(battery_values["eta_dis"])
    support_fraction = support_pct / 100.0
    count = len(pv)
    grid_import = [0.0] * count
    grid_export = [0.0] * count
    bess_charge = [0.0] * count
    bess_discharge = [0.0] * count
    soc = [0.0] * count
    required_peak_energy = 0.0
    actual_peak_energy = 0.0

    if effective_capacity <= 0:
        for index in range(count):
            pv_power = max(pv[index], 0.0)
            ev_power = max(ev[index], 0.0)
            grid_import[index] = max(ev_power - pv_power, 0.0)
            grid_export[index] = max(pv_power - ev_power, 0.0)
            if _period(index) == "peak":
                required_peak_energy += support_fraction * ev_power * DT_HOURS
    else:
        e_min = SOC_MIN * effective_capacity
        e_max = SOC_MAX * effective_capacity
        e_batt = SOC_INIT * effective_capacity
        p_bess_max = C_RATE * effective_capacity

        for index in range(count):
            period = _period(index)
            pv_power = max(pv[index], 0.0)
            ev_power = max(ev[index], 0.0)

            if period == "offpeak":
                available_energy = max(e_batt - e_min, 0.0)
                max_discharge_by_energy = available_energy * eta_dis / DT_HOURS
                discharge_power = min(
                    ev_power,
                    p_bess_max,
                    max_discharge_by_energy,
                )
                bess_discharge[index] = discharge_power
                e_batt -= discharge_power * DT_HOURS / eta_dis
                grid_import[index] = max(ev_power - discharge_power, 0.0)
            elif period == "day":
                pv_to_ev = min(pv_power, ev_power)
                remaining_ev = max(ev_power - pv_to_ev, 0.0)
                excess_pv = max(pv_power - pv_to_ev, 0.0)
                grid_import[index] = remaining_ev

                available_capacity = max(e_max - e_batt, 0.0)
                max_charge_by_capacity = available_capacity / (eta_ch * DT_HOURS)
                charge_power = min(
                    excess_pv,
                    p_bess_max,
                    max_charge_by_capacity,
                )
                bess_charge[index] = charge_power
                e_batt += charge_power * DT_HOURS * eta_ch
                grid_export[index] = max(excess_pv - charge_power, 0.0)
            else:
                target_battery_power = support_fraction * ev_power
                required_peak_energy += target_battery_power * DT_HOURS
                available_energy = max(e_batt - e_min, 0.0)
                max_discharge_by_energy = available_energy * eta_dis / DT_HOURS
                discharge_power = min(
                    target_battery_power,
                    p_bess_max,
                    max_discharge_by_energy,
                )
                bess_discharge[index] = discharge_power
                e_batt -= discharge_power * DT_HOURS / eta_dis
                grid_import[index] = max(ev_power - discharge_power, 0.0)
                actual_peak_energy += discharge_power * DT_HOURS

            e_batt = min(max(e_batt, e_min), e_max)
            soc[index] = e_batt / effective_capacity

    return FixedDispatchSimulation(
        pv_kw=pv,
        ev_kw=ev,
        tariffs_rs_per_kwh=tariffs,
        grid_import_kw=grid_import,
        pv_export_kw=grid_export,
        bess_charge_kw=bess_charge,
        bess_discharge_kw=bess_discharge,
        soc_pu=soc,
        effective_capacity_kwh=effective_capacity,
        required_peak_energy_kwh=required_peak_energy,
        actual_peak_energy_kwh=actual_peak_energy,
        warnings=warnings,
    )


def evaluate_fixed_bess(
    *,
    pv_kw: Sequence[float],
    ev_kw: Sequence[float],
    tariff_rs_per_kwh: Sequence[float | None] | None,
    battery: Mapping[str, object] | object,
    bess_capacity_kwh: float,
    peak_support_pct: float,
    economic_settings: Mapping[str, object] | object,
) -> dict[str, object]:
    """Evaluate one BESS candidate without running any GA operations."""

    battery_values, economics, requested_capacity, support_pct = _validated_inputs(
        battery,
        economic_settings,
        bess_capacity_kwh,
        peak_support_pct,
    )
    simulation = simulate_fixed_bess_dispatch(
        pv_kw=pv_kw,
        ev_kw=ev_kw,
        tariff_rs_per_kwh=tariff_rs_per_kwh,
        battery=battery,
        bess_capacity_kwh=bess_capacity_kwh,
        peak_support_pct=peak_support_pct,
        economic_settings=economic_settings,
    )
    pv = simulation.pv_kw
    tariffs = simulation.tariffs_rs_per_kwh
    effective_capacity = simulation.effective_capacity_kwh
    grid_import = simulation.grid_import_kw
    grid_export = simulation.pv_export_kw
    bess_charge = simulation.bess_charge_kw
    bess_discharge = simulation.bess_discharge_kw
    soc = simulation.soc_pu
    warnings = list(simulation.warnings)
    eta_ch = float(battery_values["eta_ch"])
    eta_dis = float(battery_values["eta_dis"])

    annual_grid_import = sum(grid_import) * DT_HOURS
    annual_pv_export = sum(grid_export) * DT_HOURS
    annual_bess_charge = sum(bess_charge) * DT_HOURS
    annual_bess_discharge = sum(bess_discharge) * DT_HOURS
    peak_support_success = (
        simulation.actual_peak_energy_kwh
        / simulation.required_peak_energy_kwh
        * 100.0
        if simulation.required_peak_energy_kwh > 1e-9
        else 100.0
    )

    equivalent_cycles = (
        calculate_equivalent_cycles([SOC_INIT, *soc])
        if effective_capacity > 0
        else 0.0
    )
    cycle_based_life: float | None
    if equivalent_cycles <= 1e-9:
        cycle_based_life = None
        warnings.append(
            _warning(
                "NO_QUALIFYING_RAINFLOW_CYCLES",
                "No material rainflow cycling was detected. Cycle-based service "
                "life is infinite in the reference model; the API reports the "
                "project horizon as a finite lower bound and schedules no "
                "replacements.",
            )
        )
    else:
        calculated_life = float(battery_values["rated_cycle_life"]) / equivalent_cycles
        cycle_based_life = calculated_life if math.isfinite(calculated_life) else None
        if cycle_based_life is None:
            warnings.append(
                _warning(
                    "UNBOUNDED_CYCLE_LIFE",
                    "Cycle-based service life exceeded the finite numeric range; "
                    "the API reports the project horizon as a finite lower bound.",
                )
            )

    project_life = float(economics["project_life_years"])
    replacement_years = _replacement_years(cycle_based_life, project_life)
    discount_rate = float(economics["discount_rate"])

    initial_capex = effective_capacity * float(
        battery_values["price_rs_per_kwh"]
    )
    replacement_fraction = float(economics["replacement_cost_fraction"])
    replacement_present_value = _replacement_present_value(
        initial_capex=initial_capex,
        replacement_cost_fraction=replacement_fraction,
        replacement_years=replacement_years,
        discount_rate=discount_rate,
    )
    residual_present_value = 0.0
    if bool(economics["residual_value_enabled"]):
        residual_present_value = _residual_present_value(
            initial_capex=initial_capex,
            replacement_cost_fraction=replacement_fraction,
            service_life_years=cycle_based_life,
            replacement_years=replacement_years,
            project_life_years=project_life,
            discount_rate=discount_rate,
        )
        warnings.append(
            _warning(
                "RESIDUAL_VALUE_EXTENSION_APPLIED",
                "Residual value uses straight-line unused cycle life for the final "
                "installed battery. The protected reference code has no residual-"
                "value calculation.",
            )
        )

    capital_recovery_factor = _capital_recovery_factor(
        discount_rate,
        project_life,
    )
    annualized_lifecycle_cost = (
        initial_capex + replacement_present_value - residual_present_value
    ) * capital_recovery_factor
    annual_om_cost = initial_capex * float(economics["annual_om_fraction"])
    annual_grid_cost = sum(
        power * DT_HOURS * tariff
        for power, tariff in zip(grid_import, tariffs, strict=True)
    )
    annual_export_revenue = annual_pv_export * float(
        economics["export_tariff_rs_per_kwh"]
    )
    total_annual_cost = (
        annual_grid_cost
        - annual_export_revenue
        + annualized_lifecycle_cost
        + annual_om_cost
    )
    total_pv_energy = sum(pv) * DT_HOURS
    pv_self_consumption = 100.0
    if total_pv_energy > 1e-9:
        pv_self_consumption = (
            (total_pv_energy - annual_pv_export)
            / total_pv_energy
            * 100.0
        )
    constraint_and_fitness = calculate_constraint_and_fitness(
        total_annual_cost_rs=total_annual_cost,
        peak_support_success_pct=peak_support_success,
        pv_self_consumption_pct=pv_self_consumption,
    )

    minimum_soc = min(soc) * 100.0 if effective_capacity > 0 else 0.0
    maximum_soc = max(soc) * 100.0 if effective_capacity > 0 else 0.0

    result: dict[str, object] = {
        "bess_capacity_kwh": _finite_result(
            effective_capacity, "bess_capacity_kwh"
        ),
        "peak_support_pct": _finite_result(support_pct, "peak_support_pct"),
        "battery_name": str(battery_values["name"]),
        "round_trip_efficiency": _finite_result(
            eta_ch * eta_dis, "round_trip_efficiency"
        ),
        "annual_grid_import_kwh": _finite_result(
            annual_grid_import, "annual_grid_import_kwh"
        ),
        "annual_pv_export_kwh": _finite_result(
            annual_pv_export, "annual_pv_export_kwh"
        ),
        "annual_bess_charge_kwh": _finite_result(
            annual_bess_charge, "annual_bess_charge_kwh"
        ),
        "annual_bess_discharge_kwh": _finite_result(
            annual_bess_discharge, "annual_bess_discharge_kwh"
        ),
        "equivalent_cycles_per_year": _finite_result(
            equivalent_cycles, "equivalent_cycles_per_year"
        ),
        "cycle_based_life_years": _finite_result(
            cycle_based_life if cycle_based_life is not None else project_life,
            "cycle_based_life_years",
        ),
        "replacement_years": [
            _finite_result(year, "replacement_year") for year in replacement_years
        ],
        "annualized_bess_lifecycle_cost_rs": _finite_result(
            annualized_lifecycle_cost, "annualized_bess_lifecycle_cost_rs"
        ),
        "annual_om_cost_rs": _finite_result(
            annual_om_cost, "annual_om_cost_rs"
        ),
        "annual_grid_cost_rs": _finite_result(
            annual_grid_cost, "annual_grid_cost_rs"
        ),
        "annual_export_revenue_rs": _finite_result(
            annual_export_revenue, "annual_export_revenue_rs"
        ),
        "total_annual_cost_rs": _finite_result(
            total_annual_cost, "total_annual_cost_rs"
        ),
        "peak_support_success_pct": _finite_result(
            peak_support_success, "peak_support_success_pct"
        ),
        "pv_self_consumption_pct": _finite_result(
            pv_self_consumption,
            "pv_self_consumption_pct",
        ),
        **constraint_and_fitness,
        "minimum_soc_pct": _finite_result(minimum_soc, "minimum_soc_pct"),
        "maximum_soc_pct": _finite_result(maximum_soc, "maximum_soc_pct"),
        "validation_warnings": warnings,
    }
    return result


def evaluate_uploaded_dataset(
    *,
    dataset_id: str,
    battery: Mapping[str, object] | object,
    bess_capacity_kwh: float,
    peak_support_pct: float,
    economic_settings: Mapping[str, object] | object,
    dispatch_strategy_status: str,
    storage_dir: Path = STORAGE_DIR,
) -> dict[str, object]:
    """Load a validated upload and evaluate it with reference dispatch only."""

    if dispatch_strategy_status != REFERENCE_DISPATCH_STATUS:
        raise ModifiedDispatchStrategyError()

    _, records, _ = load_dataset_records(dataset_id, storage_dir)
    return evaluate_fixed_bess(
        pv_kw=[record.pv_kw for record in records],
        ev_kw=[record.ev_kw for record in records],
        tariff_rs_per_kwh=[record.tariff_rs_per_kwh for record in records],
        battery=battery,
        bess_capacity_kwh=bess_capacity_kwh,
        peak_support_pct=peak_support_pct,
        economic_settings=economic_settings,
    )
