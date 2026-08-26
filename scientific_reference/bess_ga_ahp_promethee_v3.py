# ============================================================
# Two-Stage BESS Sizing and Battery-Type Selection
# ============================================================
#
# STAGE 1 - Fixed-type Genetic Algorithm sizing
# ---------------------------------------------
# The GA is run once for each battery type. For a fixed type, the candidate is:
#
#     X_i = [E_BESS, theta_peak]
#
# The GA minimizes annualized lifecycle cost and determines that type's:
# - optimal BESS energy capacity
# - optimal peak-shaving share
# - annual rainflow cycles and cycle-based life
# - lifecycle cost and technical performance
#
# STAGE 2A - AHP criteria weighting
# ----------------------------------
# AHP calculates consistent criteria weights from a Saaty pairwise matrix.
#
# STAGE 2B - PROMETHEE II multicriteria ranking
# ---------------------------------------------
# PROMETHEE II ranks the four independently optimized alternatives using:
# - annualized total cost                         (minimize)
# - cycle-based life                              (maximize)
# - round-trip efficiency                         (maximize)
# - weight density                                (minimize)
# - warranty length                               (maximize)
#
# The final recommendation is the battery type with the highest PROMETHEE II
# net flow, together with the size and peak-share already found by its fixed-type
# GA run. No mixed [E_BESS, theta_peak, B_type] GA is used.
# ============================================================
# ============================================================

import os
import random
import math
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt

try:
    import rainflow
except ImportError:
    # Self-contained fallback implementing the standard four-point rainflow
    # counting algorithm. Installing the external package is still recommended:
    #     pip install rainflow
    from collections import deque

    class _RainflowFallback:
        @staticmethod
        def _reversals(series):
            values = np.asarray(series, dtype=float).ravel()
            if len(values) == 0:
                return

            # Remove consecutive duplicates while retaining original indices.
            points = [(0, float(values[0]))]
            for index in range(1, len(values)):
                value = float(values[index])
                if value != points[-1][1]:
                    points.append((index, value))

            if len(points) == 1:
                yield points[0]
                return

            yield points[0]
            for k in range(1, len(points) - 1):
                previous_value = points[k - 1][1]
                current_value = points[k][1]
                next_value = points[k + 1][1]

                previous_slope = current_value - previous_value
                next_slope = next_value - current_value

                if previous_slope * next_slope < 0.0:
                    yield points[k]

            yield points[-1]

        @classmethod
        def extract_cycles(cls, series):
            points = deque()

            for point in cls._reversals(series):
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

    rainflow = _RainflowFallback()


# ============================================================
# USER SETTINGS
# ============================================================

CSV_FILE_NAME = "pv_ev_data_15min.csv"

PV_COL_CANDIDATES = [
    "P_PV_kW",
    "PV_kW",
    "PV_Generation",
    "PV_generation",
    "P_pv",
    "pv"
]

EV_COL_CANDIDATES = [
    "P_EV_kW",
    "EV_kW",
    "EV_Demand",
    "EV_demand",
    "P_ev",
    "ev"
]

TARIFF_COL_CANDIDATES = [
    "tariff",
    "Tariff",
    "price",
    "Price",
    "tariff_Rs_per_kWh",
    "price_Rs_per_kWh",
    "Price_Rs_per_kWh"
]

DT_HOURS = 0.25

# SOC limits
SOC_MIN = 0.10
SOC_MAX = 0.90
SOC_INIT = 0.50

# BESS power relation
C_RATE = 1.0

# GA variable limits
BESS_MIN_KWH = 0
BESS_MAX_KWH = 10000

PEAK_SHARE_MIN = 0.20
PEAK_SHARE_MAX = 0.50

BATTERY_TYPE_MIN = 1
BATTERY_TYPE_MAX = 4

# Technical constraints
SUPPORT_THRESHOLD_PERCENT = 95.0
PV_SELF_CONSUMPTION_THRESHOLD_PERCENT = 40.0

# GA settings
POPULATION_SIZE = 100
GENERATIONS = 50
MUTATION_RATE = 0.15
ELITE_COUNT = 5
TOURNAMENT_SIZE = 3
PENALTY_COST = 1e9

# Random seed
#NOTE: seeding now happens per battery-type run_ga() call, not globally,
# so each fixed-type GA run is independently reproducible.
RANDOM_SEED = 42

# ============================================================
# ECONOMIC SETTINGS
# ============================================================

TARIFF_OFFPEAK_RS_PER_KWH = 31
TARIFF_DAY_RS_PER_KWH = 15
TARIFF_PEAK_RS_PER_KWH = 75

EXPORT_PRICE_RS_PER_KWH = 21

DISCOUNT_RATE = 0.10
PROJECT_LIFE_YEARS = 25

BESS_OM_PERCENT_OF_CAPEX = 0.01

# Base case replacement cost factor
# C_rep = f_rep * C_BESS^0
REPLACEMENT_COST_FACTOR = 0.80


# ============================================================
# RAINFLOW SETTINGS
# ============================================================

# SOC binning and hysteresis are used only for cycle extraction.
# This reduces small numerical SOC oscillations.
RFC_BIN_SIZE_PERCENT = 2.0
RFC_HYSTERESIS_PERCENT = 2.0
RFC_MIN_DOD_PERCENT = 2.0

# The rated cycle-life values in BATTERY_TYPES are assumed to be specified
# for cycling across the usable SOC window (10% to 90% = 80% DoD).
# Therefore, one 10% -> 90% -> 10% cycle is counted as one rated cycle.
RATED_CYCLE_DOD_PERCENT = (SOC_MAX - SOC_MIN) * 100.0


# ============================================================
# BATTERY TYPE CATALOGUE
# ============================================================
# Important:
# No predefined service years here.
#
# Battery service life is calculated from:
# L_cycle = N_cycle / N_RF^annual
#
# These values are example scenario values.
# For final report, update them using manufacturer datasheets or research papers.

BATTERY_TYPES = {
    1: {
        "name": "Low-cost",
        "price_rs_per_kwh": 45000,
        "rated_cycle_life": 5000,
        "eta_ch": 0.92,
        "eta_dis": 0.92
    },
    2: {
        "name": "Medium-low",
        "price_rs_per_kwh": 55000,
        "rated_cycle_life": 6500,
        "eta_ch": 0.935,
        "eta_dis": 0.935
    },
    3: {
        "name": "Medium",
        "price_rs_per_kwh": 65000,
        "rated_cycle_life": 8000,
        "eta_ch": 0.95,
        "eta_dis": 0.95
    },
    4: {
        "name": "High",
        "price_rs_per_kwh": 75000,
        "rated_cycle_life": 9500,
        "eta_ch": 0.96,
        "eta_dis": 0.96
    },
    
}


# ============================================================
# STAGE 2A: AHP SETTINGS
# ============================================================
# AHP is used only to calculate the relative importance of the five criteria.
# PROMETHEE II then uses the calculated AHP weights to rank the four optimized
# battery alternatives.

AHP_CRITERIA = [
    "total_annual_cost_Rs",
    "cycle_based_life_years",
    "round_trip_efficiency",
    "weight_density_kg_per_kwh",
    "warranty_years",
]

AHP_CRITERIA_LABELS = {
    "total_annual_cost_Rs": "Annualized total cost",
    "cycle_based_life_years": "Cycle-based life",
    "round_trip_efficiency": "Round-trip efficiency",
    "weight_density_kg_per_kwh": "Weight density (kg/kWh)",
    "warranty_years": "Warranty period",
}

# PROMETHEE II uses the weights calculated from the pairwise-comparison
# matrix below.

# Saaty pairwise-comparison matrix.
# Criterion order is exactly the order in AHP_CRITERIA.
# Values above 1 mean the row criterion is more important than the column
# criterion. Reciprocal values are placed automatically in the reverse direction.
# The judgments among the five retained criteria are preserved after removing
# annual O&M cost as a separate ranking criterion.
AHP_PAIRWISE_MATRIX = np.array([
    [1,     1,     4,     3,     5],
    [1,     1,     4,     2,     3],
    [1/4,   1/4,   1,     1,     1],
    [1/3,   1/2,   1,     1,     2],
    [1/5,   1/3,   1,     1/2,   1],
], dtype=float)

AHP_RANDOM_INDEX = {
    1: 0.00,
    2: 0.00,
    3: 0.58,
    4: 0.90,
    5: 1.12,
    6: 1.24,
    7: 1.32,
    8: 1.41,
    9: 1.45,
    10: 1.49,
}

AHP_MAX_ACCEPTABLE_CR = 0.10


# ============================================================
# STAGE 2B: PROMETHEE II SETTINGS
# ============================================================
# IMPORTANT:
# The weight-density and warranty values below are placeholders. Replace them
# with values obtained from the actual battery manufacturer datasheets or the
# literature used in your report.

PROMETHEE_EXTRA_CRITERIA = {
    1: {"weight_density_kg_per_kwh": 10.0, "warranty_years": 10.0},
    2: {"weight_density_kg_per_kwh": 8.5, "warranty_years": 10.0},
    3: {"weight_density_kg_per_kwh": 8.0, "warranty_years": 12.0},
    4: {"weight_density_kg_per_kwh": 8.0, "warranty_years": 15.0},
}

CRITERIA_TYPES = {
    "total_annual_cost_Rs": "min",
    "cycle_based_life_years": "max",
    "round_trip_efficiency": "max",
    "weight_density_kg_per_kwh": "min",
    "warranty_years": "max",
}

# Data-driven PROMETHEE preference thresholds:
# q = fraction of observed criterion range treated as indifference
# p = fraction of observed criterion range treated as strict preference
PROMETHEE_Q_RANGE_FRACTION = 0.0
PROMETHEE_P_RANGE_FRACTION = 0.1

# Table-image settings. Every AHP and PROMETHEE step is saved as CSV and PNG.
TABLE_IMAGE_DPI = 220
TABLE_IMAGE_FONT_SIZE = 8
TABLE_IMAGE_MAX_ROWS_PER_PAGE = 18

# Set True to open each plot window while the script is running.
# Figures are saved to disk regardless of this setting.
SHOW_PLOTS = True


# ============================================================
# GENERAL FUNCTIONS
# ============================================================

def find_column(df, candidates, label):
    for col in candidates:
        if col in df.columns:
            return col

    raise ValueError(
        f"Could not find {label} column.\n"
        f"Available columns: {list(df.columns)}\n"
        f"Expected one of: {candidates}"
    )


def get_period(hour_decimal):
    """
    Day      : 05:30 to 18:30
    Peak     : 18:30 to 22:30
    Off-peak : otherwise
    """
    if 5.5 <= hour_decimal < 18.5:
        return "day"
    elif 18.5 <= hour_decimal < 22.5:
        return "peak"
    else:
        return "offpeak"


def create_default_tariff_array(n):
    tariffs = np.zeros(n)

    for t in range(n):
        hour_decimal = (t % 96) * DT_HOURS
        period = get_period(hour_decimal)

        if period == "offpeak":
            tariffs[t] = TARIFF_OFFPEAK_RS_PER_KWH
        elif period == "day":
            tariffs[t] = TARIFF_DAY_RS_PER_KWH
        else:
            tariffs[t] = TARIFF_PEAK_RS_PER_KWH

    return tariffs


def load_tariff_array(df):
    for col in TARIFF_COL_CANDIDATES:
        if col in df.columns:
            print(f"Tariff column used: {col}")
            return df[col].values.astype(float)

    print("No tariff column found. Default TOU tariff is used.")
    return create_default_tariff_array(len(df))


def calculate_crf(discount_rate, years):
    d = discount_rate
    n = years

    if n <= 0:
        raise ValueError("years must be positive.")

    if abs(d) < 1e-12:
        return 1.0 / n

    return (d * (1 + d) ** n) / ((1 + d) ** n - 1)


def get_battery_params(battery_type):
    battery_type = int(round(battery_type))
    battery_type = min(max(battery_type, BATTERY_TYPE_MIN), BATTERY_TYPE_MAX)

    params = BATTERY_TYPES[battery_type].copy()
    params["battery_type"] = battery_type
    params["round_trip_efficiency"] = params["eta_ch"] * params["eta_dis"]

    return params


def format_years(years):
    if not years:
        return "None"
    return ", ".join([f"{y:.2f}" for y in years])


# ============================================================
# RAINFLOW CYCLE COUNTING FUNCTIONS
# ============================================================

def hysteresis_filter(signal, threshold):
    """
    Removes very small SOC changes before rainflow counting.
    """
    signal = np.asarray(signal, dtype=float)
    filtered = np.zeros_like(signal)
    filtered[0] = signal[0]

    for k in range(1, len(signal)):
        if abs(signal[k] - filtered[k - 1]) < threshold:
            filtered[k] = filtered[k - 1]
        else:
            filtered[k] = signal[k]

    return filtered


def soc_binning(signal, bin_size):
    """
    Bins SOC to reduce numerical noise.
    Example: bin size 2% -> SOC values grouped to 0,2,4,...
    """
    binned = np.round(signal / bin_size) * bin_size
    binned = np.clip(binned, SOC_MIN * 100, SOC_MAX * 100)
    return binned


def extract_turning_points(signal):
    """
    Extracts local maxima and minima for rainflow counting.
    """
    signal = np.asarray(signal, dtype=float)

    if len(signal) == 0:
        return np.array([])

    points = [signal[0]]

    for i in range(1, len(signal) - 1):
        is_peak = signal[i] >= signal[i - 1] and signal[i] > signal[i + 1]
        is_valley = signal[i] <= signal[i - 1] and signal[i] < signal[i + 1]

        if is_peak or is_valley:
            if signal[i] != points[-1]:
                points.append(signal[i])

    if signal[-1] != points[-1]:
        points.append(signal[-1])

    return np.array(points)


def calculate_rainflow_annual_cycles(soc_pu, detailed=False):
    """
    Input:
        soc_pu = yearly SOC profile in per-unit.

    Output:
        N_RF^annual = sum(DOD_pu * count)

    This is equivalent full cycles per year based on rainflow cycle counting.
    No degradation damage equation is used.
    """
    soc_percent = np.asarray(soc_pu, dtype=float) * 100.0
    soc_percent = np.clip(soc_percent, SOC_MIN * 100, SOC_MAX * 100)

    soc_hyst = hysteresis_filter(
        soc_percent,
        threshold=RFC_HYSTERESIS_PERCENT
    )

    soc_bin = soc_binning(
        soc_hyst,
        bin_size=RFC_BIN_SIZE_PERCENT
    )

    soc_peaks = extract_turning_points(soc_bin)

    if len(soc_peaks) < 2:
        if detailed:
            return 0.0, pd.DataFrame(), pd.DataFrame(), soc_bin, soc_peaks
        return 0.0

    cycles = list(rainflow.extract_cycles(soc_peaks))

    rfc_dict = {}
    rows = []
    equivalent_cycles = 0.0

    for rng, mean, count, i_start, i_end in cycles:
        soc_i = float(
            np.clip(
                round(soc_peaks[i_start] / RFC_BIN_SIZE_PERCENT) * RFC_BIN_SIZE_PERCENT,
                SOC_MIN * 100,
                SOC_MAX * 100
            )
        )

        soc_j = float(
            np.clip(
                round(soc_peaks[i_end] / RFC_BIN_SIZE_PERCENT) * RFC_BIN_SIZE_PERCENT,
                SOC_MIN * 100,
                SOC_MAX * 100
            )
        )

        dod_percent = abs(soc_j - soc_i)

        if dod_percent < RFC_MIN_DOD_PERCENT:
            continue

        dod_pu = dod_percent / 100.0

        # Convert the rainflow DoD into cycles relative to the battery's
        # rated 80% DoD operating window, not relative to 100% DoD.
        rated_cycle_fraction = dod_percent / RATED_CYCLE_DOD_PERCENT
        contribution = rated_cycle_fraction * count

        equivalent_cycles += contribution

        key = (soc_i, soc_j)
        rfc_dict[key] = rfc_dict.get(key, 0.0) + count

        rows.append({
            "SOC_i_percent": soc_i,
            "SOC_j_percent": soc_j,
            "DOD_percent": dod_percent,
            "DOD_pu": dod_pu,
            "rated_cycle_fraction": rated_cycle_fraction,
            "SOC_avg_percent": (soc_i + soc_j) / 2.0,
            "count": count,
            "equivalent_cycle_contribution": contribution
        })

    if not detailed:
        return equivalent_cycles

    rfc_df = pd.DataFrame(rows)

    soc_levels = np.arange(0, 100 + RFC_BIN_SIZE_PERCENT, RFC_BIN_SIZE_PERCENT)

    rfc_matrix = pd.DataFrame(
        0.0,
        index=soc_levels,
        columns=soc_levels
    )

    for (soc_i, soc_j), count in rfc_dict.items():
        if soc_i in rfc_matrix.index and soc_j in rfc_matrix.columns:
            rfc_matrix.loc[soc_i, soc_j] += count

    return equivalent_cycles, rfc_df, rfc_matrix, soc_bin, soc_peaks


# ============================================================
# LIFECYCLE COST FUNCTIONS
# ============================================================

def calculate_cycle_based_life_years(annual_rainflow_cycles, battery_params):
    """
    L_cycle = N_cycle / N_RF^annual
    """
    rated_cycle_life = battery_params["rated_cycle_life"]

    if annual_rainflow_cycles <= 1e-9:
        return float("inf")

    return rated_cycle_life / annual_rainflow_cycles


def calculate_replacement_years(service_life_years):
    """
    Replacement years:
    R = {L, 2L, 3L, ...}, y < PROJECT_LIFE_YEARS
    """
    if service_life_years <= 0 or math.isinf(service_life_years):
        return []

    years = []
    y = service_life_years

    while y < PROJECT_LIFE_YEARS - 1e-9:
        years.append(y)
        y += service_life_years

    return years


def calculate_replacement_present_value(initial_capex, replacement_years):
    """
    C_rep^PV = sum_y [0.8*C_BESS^0 / (1+d)^y]
    """
    replacement_pv = 0.0

    for y in replacement_years:
        replacement_nominal = REPLACEMENT_COST_FACTOR * initial_capex
        replacement_pv += replacement_nominal / ((1 + DISCOUNT_RATE) ** y)

    return replacement_pv


def calculate_bess_lifecycle_costs(initial_capex, replacement_pv):
    """
    C_BESS,life^annual =
        (C_BESS^0 + C_rep^PV) * CRF(d, project_life)

    Also returns initial annualized and replacement annualized separately.
    """
    crf_project = calculate_crf(DISCOUNT_RATE, PROJECT_LIFE_YEARS)

    initial_annualized = initial_capex * crf_project
    replacement_annualized = replacement_pv * crf_project
    lifecycle_annualized = initial_annualized + replacement_annualized

    return initial_annualized, replacement_annualized, lifecycle_annualized


# ============================================================
# BESS DISPATCH SIMULATION
# ============================================================

def simulate_bess(
    pv,
    ev,
    tariffs,
    bess_kwh,
    peak_battery_share,
    battery_type,
    detailed_rainflow=False
):
    """
    One-year BESS dispatch.

    The dispatch logic follows the existing report/code idea:
    - Day: PV -> EV, excess PV -> BESS, remaining excess -> export
    - Peak: BESS supplies theta_peak of EV load if energy available
    - Off-peak: BESS can support EV if energy available
    """
    n = len(pv)

    battery_params = get_battery_params(battery_type)

    eta_ch = battery_params["eta_ch"]
    eta_dis = battery_params["eta_dis"]
    price_rs_per_kwh = battery_params["price_rs_per_kwh"]

    # Round BESS size to nearest 100 kWh for practical sizing
    bess_kwh = round(bess_kwh / 100.0) * 100.0
    bess_kwh = min(max(bess_kwh, BESS_MIN_KWH), BESS_MAX_KWH)

    grid_import = np.zeros(n)
    grid_export = np.zeros(n)
    batt_charge = np.zeros(n)
    batt_discharge = np.zeros(n)
    soc = np.zeros(n)

    peak_required_batt_energy = 0.0
    peak_actual_batt_energy = 0.0

    if bess_kwh <= 0:
        for t in range(n):
            hour_decimal = (t % 96) * DT_HOURS
            period = get_period(hour_decimal)

            pv_power = max(pv[t], 0.0)
            ev_power = max(ev[t], 0.0)

            grid_import[t] = max(ev_power - pv_power, 0.0)
            grid_export[t] = max(pv_power - ev_power, 0.0)

            if period == "peak":
                peak_required_batt_energy += (
                    peak_battery_share * ev_power * DT_HOURS
                )

        if peak_required_batt_energy > 1e-9:
            peak_support_success = 0.0
        else:
            peak_support_success = 100.0

        grid_import_energy = np.sum(grid_import) * DT_HOURS
        grid_export_energy = np.sum(grid_export) * DT_HOURS
        total_pv_energy = np.sum(pv) * DT_HOURS

        grid_import_cost_annual = np.sum(grid_import * DT_HOURS * tariffs)
        grid_export_income_annual = np.sum(
            grid_export * DT_HOURS * EXPORT_PRICE_RS_PER_KWH
        )

        pv_self_consumption = 100.0
        if total_pv_energy > 1e-9:
            pv_self_consumption = (
                (total_pv_energy - grid_export_energy) / total_pv_energy
            ) * 100.0

        result = {
            "bess_kWh": 0.0,
            "peak_shave_percent": peak_battery_share * 100,
            "battery_type": battery_params["battery_type"],
            "battery_name": battery_params["name"],
            "battery_price_rs_per_kwh": price_rs_per_kwh,
            "rated_cycle_life": battery_params["rated_cycle_life"],
            "eta_ch": eta_ch,
            "eta_dis": eta_dis,
            "round_trip_efficiency": battery_params["round_trip_efficiency"],
            "p_bess_max_kW": 0.0,

            "grid_import_energy_kWh": grid_import_energy,
            "grid_export_energy_kWh": grid_export_energy,
            "bess_charge_energy_kWh": 0.0,
            "bess_discharge_energy_kWh": 0.0,

            "original_peak_ev_kW": np.max(ev),
            "new_peak_grid_import_kW": np.max(grid_import),
            "peak_reduction_kW": np.max(ev) - np.max(grid_import),

            "peak_required_battery_energy_kWh": peak_required_batt_energy,
            "peak_actual_battery_energy_kWh": 0.0,
            "peak_support_success_percent": peak_support_success,
            "pv_self_consumption_percent": pv_self_consumption,

            "rainflow_equivalent_cycles_per_year": 0.0,
            "cycle_based_life_years": float("inf"),
            "replacement_years": [],
            "number_of_replacements": 0,

            "grid_import_cost_annual_Rs": grid_import_cost_annual,
            "grid_export_income_annual_Rs": grid_export_income_annual,
            "bess_capex_Rs": 0.0,
            "replacement_pv_cost_Rs": 0.0,
            "initial_bess_annualized_cost_Rs": 0.0,
            "replacement_annualized_cost_Rs": 0.0,
            "annualized_bess_lifecycle_cost_Rs": 0.0,
            "bess_om_cost_annual_Rs": 0.0,
            "total_annual_cost_Rs": (
                grid_import_cost_annual - grid_export_income_annual
            ),

            "minimum_SOC_percent": 0.0,
            "maximum_SOC_percent": 0.0,
            "final_SOC_percent": 0.0
        }

        timeseries = pd.DataFrame({
            "pv_kW": pv,
            "ev_kW": ev,
            "tariff_Rs_per_kWh": tariffs,
            "grid_import_kW": grid_import,
            "grid_export_kW": grid_export,
            "bess_charge_kW": batt_charge,
            "bess_discharge_kW": batt_discharge,
            "soc_pu": soc
        })

        if detailed_rainflow:
            return result, timeseries, pd.DataFrame(), pd.DataFrame()

        return result, timeseries

    e_min = SOC_MIN * bess_kwh
    e_max = SOC_MAX * bess_kwh
    e_batt = SOC_INIT * bess_kwh

    p_bess_max = C_RATE * bess_kwh

    for t in range(n):
        hour_decimal = (t % 96) * DT_HOURS
        period = get_period(hour_decimal)

        pv_power = max(pv[t], 0.0)
        ev_power = max(ev[t], 0.0)

        # ----------------------------------------------------
        # OFF-PEAK
        # ----------------------------------------------------
        if period == "offpeak":
            required_power = ev_power

            available_energy = max(e_batt - e_min, 0.0)
            max_discharge_by_energy = available_energy * eta_dis / DT_HOURS

            discharge_power = min(
                required_power,
                p_bess_max,
                max_discharge_by_energy
            )

            batt_discharge[t] = discharge_power
            e_batt -= (discharge_power * DT_HOURS) / eta_dis

            grid_import[t] = max(required_power - discharge_power, 0.0)

        # ----------------------------------------------------
        # DAY
        # ----------------------------------------------------
        elif period == "day":
            pv_to_ev = min(pv_power, ev_power)

            remaining_ev = max(ev_power - pv_to_ev, 0.0)
            excess_pv = max(pv_power - pv_to_ev, 0.0)

            grid_import[t] = remaining_ev

            available_capacity = max(e_max - e_batt, 0.0)
            max_charge_by_capacity = available_capacity / (eta_ch * DT_HOURS)

            charge_power = min(
                excess_pv,
                p_bess_max,
                max_charge_by_capacity
            )

            batt_charge[t] = charge_power
            e_batt += charge_power * DT_HOURS * eta_ch

            grid_export[t] = max(excess_pv - charge_power, 0.0)

        # ----------------------------------------------------
        # PEAK
        # ----------------------------------------------------
        else:
            target_batt_power = peak_battery_share * ev_power
            peak_required_batt_energy += target_batt_power * DT_HOURS

            available_energy = max(e_batt - e_min, 0.0)
            max_discharge_by_energy = available_energy * eta_dis / DT_HOURS

            discharge_power = min(
                target_batt_power,
                p_bess_max,
                max_discharge_by_energy
            )

            batt_discharge[t] = discharge_power
            e_batt -= (discharge_power * DT_HOURS) / eta_dis

            grid_import[t] = max(ev_power - discharge_power, 0.0)
            peak_actual_batt_energy += discharge_power * DT_HOURS

        e_batt = min(max(e_batt, e_min), e_max)
        soc[t] = e_batt / bess_kwh

    # ========================================================
    # Technical metrics
    # ========================================================

    grid_import_energy = np.sum(grid_import) * DT_HOURS
    grid_export_energy = np.sum(grid_export) * DT_HOURS
    bess_charge_energy = np.sum(batt_charge) * DT_HOURS
    bess_discharge_energy = np.sum(batt_discharge) * DT_HOURS

    original_peak_ev = np.max(ev)
    new_peak_grid_import = np.max(grid_import)
    peak_reduction = original_peak_ev - new_peak_grid_import

    if peak_required_batt_energy > 1e-9:
        peak_support_success = (
            peak_actual_batt_energy / peak_required_batt_energy
        ) * 100.0
    else:
        peak_support_success = 100.0

    total_pv_energy = np.sum(pv) * DT_HOURS

    if total_pv_energy > 1e-9:
        pv_self_consumption = (
            (total_pv_energy - grid_export_energy) / total_pv_energy
        ) * 100.0
    else:
        pv_self_consumption = 100.0

    # ========================================================
    # Rainflow annual cycle counting
    # ========================================================

    # Include the initial SOC before the first simulated interval so the
    # first SOC movement is included in the rainflow cycle calculation.
    soc_for_rainflow = np.concatenate(([SOC_INIT], soc))

    if detailed_rainflow:
        (
            annual_rf_cycles,
            rfc_df,
            rfc_matrix,
            soc_binned,
            soc_peaks
        ) = calculate_rainflow_annual_cycles(soc_for_rainflow, detailed=True)
    else:
        annual_rf_cycles = calculate_rainflow_annual_cycles(soc_for_rainflow, detailed=False)
        rfc_df = None
        rfc_matrix = None

    cycle_based_life_years = calculate_cycle_based_life_years(
        annual_rf_cycles,
        battery_params
    )

    replacement_years = calculate_replacement_years(cycle_based_life_years)

    # ========================================================
    # Economic metrics
    # ========================================================

    grid_import_cost_annual = np.sum(grid_import * DT_HOURS * tariffs)

    grid_export_income_annual = np.sum(
        grid_export * DT_HOURS * EXPORT_PRICE_RS_PER_KWH
    )

    bess_capex = bess_kwh * price_rs_per_kwh

    replacement_pv_cost = calculate_replacement_present_value(
        initial_capex=bess_capex,
        replacement_years=replacement_years
    )

    (
        initial_bess_annualized,
        replacement_annualized,
        bess_lifecycle_annualized
    ) = calculate_bess_lifecycle_costs(
        initial_capex=bess_capex,
        replacement_pv=replacement_pv_cost
    )

    bess_om_cost_annual = bess_capex * BESS_OM_PERCENT_OF_CAPEX

    total_annual_cost = (
        grid_import_cost_annual
        - grid_export_income_annual
        + bess_lifecycle_annualized
        + bess_om_cost_annual
    )

    result = {
        "bess_kWh": bess_kwh,
        "peak_shave_percent": peak_battery_share * 100,
        "battery_type": battery_params["battery_type"],
        "battery_name": battery_params["name"],

        "battery_price_rs_per_kwh": price_rs_per_kwh,
        "rated_cycle_life": battery_params["rated_cycle_life"],
        "eta_ch": eta_ch,
        "eta_dis": eta_dis,
        "round_trip_efficiency": battery_params["round_trip_efficiency"],

        "p_bess_max_kW": p_bess_max,

        "grid_import_energy_kWh": grid_import_energy,
        "grid_export_energy_kWh": grid_export_energy,
        "bess_charge_energy_kWh": bess_charge_energy,
        "bess_discharge_energy_kWh": bess_discharge_energy,

        "original_peak_ev_kW": original_peak_ev,
        "new_peak_grid_import_kW": new_peak_grid_import,
        "peak_reduction_kW": peak_reduction,

        "peak_required_battery_energy_kWh": peak_required_batt_energy,
        "peak_actual_battery_energy_kWh": peak_actual_batt_energy,
        "peak_support_success_percent": peak_support_success,
        "pv_self_consumption_percent": pv_self_consumption,

        "rainflow_equivalent_cycles_per_year": annual_rf_cycles,
        "cycle_based_life_years": cycle_based_life_years,
        "replacement_years": replacement_years,
        "number_of_replacements": len(replacement_years),

        "grid_import_cost_annual_Rs": grid_import_cost_annual,
        "grid_export_income_annual_Rs": grid_export_income_annual,
        "bess_capex_Rs": bess_capex,
        "replacement_pv_cost_Rs": replacement_pv_cost,
        "initial_bess_annualized_cost_Rs": initial_bess_annualized,
        "replacement_annualized_cost_Rs": replacement_annualized,
        "annualized_bess_lifecycle_cost_Rs": bess_lifecycle_annualized,
        "bess_om_cost_annual_Rs": bess_om_cost_annual,
        "total_annual_cost_Rs": total_annual_cost,

        "minimum_SOC_percent": np.min(soc) * 100,
        "maximum_SOC_percent": np.max(soc) * 100,
        "final_SOC_percent": soc[-1] * 100
    }

    timeseries = pd.DataFrame({
        "pv_kW": pv,
        "ev_kW": ev,
        "tariff_Rs_per_kWh": tariffs,
        "grid_import_kW": grid_import,
        "grid_export_kW": grid_export,
        "bess_charge_kW": batt_charge,
        "bess_discharge_kW": batt_discharge,
        "soc_pu": soc
    })

    if detailed_rainflow:
        return result, timeseries, rfc_df, rfc_matrix

    return result, timeseries


# ============================================================
# FITNESS FUNCTION
# ============================================================

def evaluate_solution(pv, ev, tariffs, individual):
    result, _ = simulate_bess(
        pv=pv,
        ev=ev,
        tariffs=tariffs,
        bess_kwh=individual[0],
        peak_battery_share=individual[1],
        battery_type=individual[2],
        detailed_rainflow=False
    )

    cost = result["total_annual_cost_Rs"]
    penalty = 0.0

    if result["peak_support_success_percent"] < SUPPORT_THRESHOLD_PERCENT:
        missing = SUPPORT_THRESHOLD_PERCENT - result["peak_support_success_percent"]
        penalty += PENALTY_COST * (missing / SUPPORT_THRESHOLD_PERCENT)

    if result["pv_self_consumption_percent"] < PV_SELF_CONSUMPTION_THRESHOLD_PERCENT:
        missing = (
            PV_SELF_CONSUMPTION_THRESHOLD_PERCENT
            - result["pv_self_consumption_percent"]
        )
        penalty += PENALTY_COST * (
            missing / PV_SELF_CONSUMPTION_THRESHOLD_PERCENT
        )

    fitness = cost + penalty

    result["penalty_Rs"] = penalty
    result["fitness_Rs"] = fitness

    return fitness, result


# ============================================================
# GA OPERATORS
# ============================================================

def create_individual(fixed_battery_type=None):
    bess_kwh = random.uniform(BESS_MIN_KWH, BESS_MAX_KWH)
    peak_share = random.uniform(PEAK_SHARE_MIN, PEAK_SHARE_MAX)

    if fixed_battery_type is None:
        battery_type = random.randint(BATTERY_TYPE_MIN, BATTERY_TYPE_MAX)
    else:
        battery_type = fixed_battery_type

    return [bess_kwh, peak_share, battery_type]


def repair_individual(individual, fixed_battery_type=None):
    individual[0] = min(max(individual[0], BESS_MIN_KWH), BESS_MAX_KWH)
    individual[1] = min(max(individual[1], PEAK_SHARE_MIN), PEAK_SHARE_MAX)

    if fixed_battery_type is None:
        individual[2] = int(round(individual[2]))
        individual[2] = min(max(individual[2], BATTERY_TYPE_MIN), BATTERY_TYPE_MAX)
    else:
        individual[2] = fixed_battery_type

    return individual


def crossover(parent1, parent2, fixed_battery_type=None):
    alpha = random.random()

    child1 = [
        alpha * parent1[0] + (1 - alpha) * parent2[0],
        alpha * parent1[1] + (1 - alpha) * parent2[1],
        parent1[2]
    ]

    child2 = [
        alpha * parent2[0] + (1 - alpha) * parent1[0],
        alpha * parent2[1] + (1 - alpha) * parent1[1],
        parent2[2]
    ]

    if fixed_battery_type is None:
        child1[2] = random.choice([parent1[2], parent2[2]])
        child2[2] = random.choice([parent1[2], parent2[2]])
    else:
        child1[2] = fixed_battery_type
        child2[2] = fixed_battery_type

    child1 = repair_individual(child1, fixed_battery_type)
    child2 = repair_individual(child2, fixed_battery_type)

    return child1, child2


def mutate(individual, fixed_battery_type=None):
    if random.random() < MUTATION_RATE:
        individual[0] += random.uniform(-1000, 1000)

    if random.random() < MUTATION_RATE:
        individual[1] += random.uniform(-0.05, 0.05)

    if fixed_battery_type is None:
        if random.random() < MUTATION_RATE:
            if random.random() < 0.7:
                individual[2] += random.choice([-1, 1])
            else:
                individual[2] = random.randint(BATTERY_TYPE_MIN, BATTERY_TYPE_MAX)

    return repair_individual(individual, fixed_battery_type)


def tournament_selection(population, fitness_values):
    selected_indices = random.sample(range(len(population)), TOURNAMENT_SIZE)
    best_index = selected_indices[0]

    for idx in selected_indices:
        if fitness_values[idx] < fitness_values[best_index]:
            best_index = idx

    return population[best_index].copy()


# ============================================================
# GA RUNNER
# ============================================================

def run_ga(pv, ev, tariffs, fixed_battery_type=None, label="Full GA", seed=None):
    if seed is not None:
        random.seed(seed)
        np.random.seed(seed)

    population = [
        create_individual(fixed_battery_type=fixed_battery_type)
        for _ in range(POPULATION_SIZE)
    ]

    best_history = []
    generation_rows = []

    best_solution = None
    best_result = None
    best_fitness = float("inf")

    for gen in range(GENERATIONS):
        fitness_values = []
        results = []

        for individual in population:
            individual = repair_individual(individual, fixed_battery_type)

            fitness, result = evaluate_solution(
                pv=pv,
                ev=ev,
                tariffs=tariffs,
                individual=individual
            )

            fitness_values.append(fitness)
            results.append(result)

            if fitness < best_fitness:
                best_fitness = fitness
                best_solution = individual.copy()
                best_result = result.copy()

        best_history.append(best_fitness)

        print(
            f"{label} | Gen {gen + 1:02d} | "
            f"Fitness = {best_fitness:,.2f} Rs/year | "
            f"Cost = {best_result['total_annual_cost_Rs']:,.2f} Rs/year | "
            f"BESS = {best_result['bess_kWh']:,.0f} kWh | "
            f"Peak = {best_result['peak_shave_percent']:.2f}% | "
            f"Type = {best_result['battery_type']} ({best_result['battery_name']}) | "
            f"RF cycles = {best_result['rainflow_equivalent_cycles_per_year']:.2f}/yr | "
            f"Life = {best_result['cycle_based_life_years']:.2f} yr | "
            f"Support = {best_result['peak_support_success_percent']:.2f}% | "
            f"PV SC = {best_result['pv_self_consumption_percent']:.2f}%"
        )

        generation_rows.append({
            "generation": gen + 1,
            "best_fitness_Rs": best_fitness,
            "best_cost_Rs": best_result["total_annual_cost_Rs"],
            "best_bess_kWh": best_result["bess_kWh"],
            "best_peak_shave_percent": best_result["peak_shave_percent"],
            "best_battery_type": best_result["battery_type"],
            "best_battery_name": best_result["battery_name"],
            "best_rf_cycles_per_year": best_result["rainflow_equivalent_cycles_per_year"],
            "best_cycle_based_life_years": best_result["cycle_based_life_years"],
            "best_peak_support_percent": best_result["peak_support_success_percent"],
            "best_pv_self_consumption_percent": best_result["pv_self_consumption_percent"]
        })

        sorted_indices = np.argsort(fitness_values)
        new_population = []

        for i in range(ELITE_COUNT):
            elite_idx = sorted_indices[i]
            new_population.append(population[elite_idx].copy())

        while len(new_population) < POPULATION_SIZE:
            parent1 = tournament_selection(population, fitness_values)
            parent2 = tournament_selection(population, fitness_values)

            child1, child2 = crossover(
                parent1,
                parent2,
                fixed_battery_type=fixed_battery_type
            )

            child1 = mutate(child1, fixed_battery_type)
            child2 = mutate(child2, fixed_battery_type)

            new_population.append(child1)

            if len(new_population) < POPULATION_SIZE:
                new_population.append(child2)

        population = new_population

    generation_df = pd.DataFrame(generation_rows)

    return best_solution, best_result, best_history, generation_df


# ============================================================
# PLOTTING FUNCTIONS
# ============================================================

def plot_ga_convergence(best_history, output_folder, filename):
    plt.figure(figsize=(10, 5))
    plt.plot(best_history, marker="o")
    plt.xlabel("Generation")
    plt.ylabel("Best fitness (Rs/year)")
    plt.title("GA Convergence")
    plt.grid(True)
    plt.tight_layout()
    plt.savefig(os.path.join(output_folder, filename), dpi=300)
    if SHOW_PLOTS:
        plt.show()
    else:
        plt.close()


def plot_dispatch_first_day(timeseries, output_folder):
    n_plot = min(96, len(timeseries))
    x = np.arange(n_plot) * DT_HOURS

    plt.figure(figsize=(13, 6))
    plt.step(x, timeseries["pv_kW"].iloc[:n_plot], where="post", label="PV")
    plt.step(x, timeseries["ev_kW"].iloc[:n_plot], where="post", label="EV Load")
    plt.step(x, timeseries["grid_import_kW"].iloc[:n_plot], where="post", label="Grid Import")
    plt.step(x, timeseries["grid_export_kW"].iloc[:n_plot], where="post", label="Grid Export")
    plt.step(x, timeseries["bess_charge_kW"].iloc[:n_plot], where="post", label="BESS Charge")
    plt.step(x, timeseries["bess_discharge_kW"].iloc[:n_plot], where="post", label="BESS Discharge")
    plt.xlabel("Hour")
    plt.ylabel("Power (kW)")
    plt.title("First-Day Dispatch Profile - 15-Minute Step Plot")
    plt.legend()
    plt.grid(True)
    plt.tight_layout()
    plt.savefig(os.path.join(output_folder, "dispatch_first_day_step.png"), dpi=300)
    if SHOW_PLOTS:
        plt.show()
    else:
        plt.close()

    plt.figure(figsize=(13, 4))
    plt.step(x, timeseries["soc_pu"].iloc[:n_plot] * 100, where="post")
    plt.axhline(SOC_MIN * 100, linestyle="--", label="SOC min")
    plt.axhline(SOC_MAX * 100, linestyle="--", label="SOC max")
    plt.xlabel("Hour")
    plt.ylabel("SOC (%)")
    plt.title("First-Day BESS SOC - 15-Minute Step Plot")
    plt.legend()
    plt.grid(True)
    plt.tight_layout()
    plt.savefig(os.path.join(output_folder, "soc_first_day_step.png"), dpi=300)
    if SHOW_PLOTS:
        plt.show()
    else:
        plt.close()


def plot_cost_components(best_result, baseline_result, output_folder):
    labels = [
        "Grid Import\nCost",
        "Export\nIncome",
        "Initial BESS\nAnnualized",
        "Replacement\nAnnualized",
        "BESS O&M\nAnnual",
        "Total Annual\nCost"
    ]

    values = [
        best_result["grid_import_cost_annual_Rs"],
        best_result["grid_export_income_annual_Rs"],
        best_result["initial_bess_annualized_cost_Rs"],
        best_result["replacement_annualized_cost_Rs"],
        best_result["bess_om_cost_annual_Rs"],
        best_result["total_annual_cost_Rs"]
    ]

    plt.figure(figsize=(12, 5))
    plt.bar(labels, values)
    plt.ylabel("Rs/year")
    plt.title("Annual Lifecycle Cost Components")
    plt.grid(axis="y")
    plt.tight_layout()
    plt.savefig(os.path.join(output_folder, "cost_components_detailed.png"), dpi=300)
    if SHOW_PLOTS:
        plt.show()
    else:
        plt.close()

    labels2 = ["No Battery", "Optimized BESS"]
    values2 = [
        baseline_result["total_annual_cost_Rs"],
        best_result["total_annual_cost_Rs"]
    ]

    plt.figure(figsize=(8, 5))
    plt.bar(labels2, values2)
    plt.ylabel("Rs/year")
    plt.title("No-Battery vs Optimized BESS Annual Cost")
    plt.grid(axis="y")
    plt.tight_layout()
    plt.savefig(os.path.join(output_folder, "no_battery_vs_optimized_bess.png"), dpi=300)
    if SHOW_PLOTS:
        plt.show()
    else:
        plt.close()


def plot_replacement_timeline(best_result, output_folder):
    years = [0.0]
    pv_costs = [best_result["bess_capex_Rs"]]
    labels = ["Initial"]

    initial_capex = best_result["bess_capex_Rs"]
    replacement_nominal = REPLACEMENT_COST_FACTOR * initial_capex

    for y in best_result["replacement_years"]:
        years.append(y)
        pv_costs.append(replacement_nominal / ((1 + DISCOUNT_RATE) ** y))
        labels.append("Replacement")

    plt.figure(figsize=(10, 5))
    plt.scatter(years, pv_costs)
    plt.plot(years, pv_costs, linestyle="--")
    for x, y, txt in zip(years, pv_costs, labels):
        plt.annotate(txt, (x, y), textcoords="offset points", xytext=(0, 8), ha="center")
    plt.xlabel("Project year")
    plt.ylabel("Present value cost (Rs)")
    plt.title("Initial and Replacement Cost Timeline")
    plt.grid(True)
    plt.tight_layout()
    plt.savefig(os.path.join(output_folder, "replacement_timeline_best.png"), dpi=300)
    if SHOW_PLOTS:
        plt.show()
    else:
        plt.close()


def plot_fixed_tier_results(summary_df, output_folder):
    summary_df = summary_df.sort_values("battery_type")

    plt.figure(figsize=(9, 5))
    plt.bar(summary_df["battery_type"].astype(str), summary_df["total_annual_cost_Rs"])
    plt.xlabel("Battery type")
    plt.ylabel("Total annual cost (Rs/year)")
    plt.title("Fixed-Tier GA: Battery Type vs Total Annual Cost")
    plt.grid(axis="y")
    plt.tight_layout()
    plt.savefig(os.path.join(output_folder, "fixed_tier_total_cost.png"), dpi=300)
    if SHOW_PLOTS:
        plt.show()
    else:
        plt.close()

    plt.figure(figsize=(9, 5))
    plt.bar(summary_df["battery_type"].astype(str), summary_df["bess_kWh"])
    plt.xlabel("Battery type")
    plt.ylabel("Selected BESS size (kWh)")
    plt.title("Fixed-Tier GA: Battery Type vs Selected BESS Size")
    plt.grid(axis="y")
    plt.tight_layout()
    plt.savefig(os.path.join(output_folder, "fixed_tier_bess_size.png"), dpi=300)
    if SHOW_PLOTS:
        plt.show()
    else:
        plt.close()

    x = np.arange(len(summary_df))
    initial = summary_df["initial_bess_annualized_cost_Rs"].values
    replacement = summary_df["replacement_annualized_cost_Rs"].values

    plt.figure(figsize=(10, 5))
    plt.bar(x, initial, label="Initial BESS annualized")
    plt.bar(x, replacement, bottom=initial, label="Replacement annualized")
    plt.xticks(x, summary_df["battery_type"].astype(str))
    plt.xlabel("Battery type")
    plt.ylabel("Rs/year")
    plt.title("Fixed-Tier GA: Initial and Replacement Annualized Cost")
    plt.legend()
    plt.grid(axis="y")
    plt.tight_layout()
    plt.savefig(os.path.join(output_folder, "fixed_tier_initial_replacement_split.png"), dpi=300)
    if SHOW_PLOTS:
        plt.show()
    else:
        plt.close()

    plt.figure(figsize=(9, 5))
    plt.bar(summary_df["battery_type"].astype(str), summary_df["rainflow_equivalent_cycles_per_year"])
    plt.xlabel("Battery type")
    plt.ylabel("Rainflow equivalent cycles/year")
    plt.title("Fixed-Tier GA: Rainflow Equivalent Cycles per Year")
    plt.grid(axis="y")
    plt.tight_layout()
    plt.savefig(os.path.join(output_folder, "fixed_tier_rainflow_cycles.png"), dpi=300)
    if SHOW_PLOTS:
        plt.show()
    else:
        plt.close()


def plot_rfc_heatmap(rfc_matrix, output_folder):
    if rfc_matrix is None or rfc_matrix.empty:
        return

    plt.figure(figsize=(8, 6))
    plt.imshow(rfc_matrix.values, origin="lower", aspect="auto")
    plt.colorbar(label="Rainflow cycle count")
    plt.xticks(range(len(rfc_matrix.columns)), rfc_matrix.columns, rotation=90)
    plt.yticks(range(len(rfc_matrix.index)), rfc_matrix.index)
    plt.xlabel("SOC_j (%)")
    plt.ylabel("SOC_i (%)")
    plt.title("Annual RFC Matrix for Selected BESS")
    plt.tight_layout()
    plt.savefig(os.path.join(output_folder, "annual_rfc_matrix_heatmap.png"), dpi=300)
    if SHOW_PLOTS:
        plt.show()
    else:
        plt.close()


# ============================================================
# PRINT AND SAVE FUNCTIONS
# ============================================================

def print_battery_catalogue():
    print("\n============================================================")
    print("BATTERY TYPE CATALOGUE")
    print("============================================================")
    for btype, p in BATTERY_TYPES.items():
        print(
            f"Type {btype}: {p['name']:12s} | "
            f"Price = {p['price_rs_per_kwh']:,.0f} Rs/kWh | "
            f"Rated cycles = {p['rated_cycle_life']:,.0f} | "
            f"eta_ch = {p['eta_ch']:.3f} | "
            f"eta_dis = {p['eta_dis']:.3f} | "
            f"RTE = {p['eta_ch'] * p['eta_dis']:.3f}"
        )


def print_final_result(best_result, baseline_result):
    saving = baseline_result["total_annual_cost_Rs"] - best_result["total_annual_cost_Rs"]

    print("\n============================================================")
    print("FINAL OPTIMAL RESULT")
    print("============================================================")
    print(f"Optimal BESS size                         : {best_result['bess_kWh']:,.0f} kWh")
    print(f"Optimal peak shaving target               : {best_result['peak_shave_percent']:.2f}%")
    print(f"Selected battery type                     : {best_result['battery_type']} ({best_result['battery_name']})")
    print(f"BESS max power                            : {best_result['p_bess_max_kW']:,.2f} kW")

    print("\n--- Battery parameters ---")
    print(f"Battery price                             : {best_result['battery_price_rs_per_kwh']:,.2f} Rs/kWh")
    print(f"Rated cycle life                          : {best_result['rated_cycle_life']:,.0f} cycles")
    print(f"Charge efficiency                         : {best_result['eta_ch']:.4f}")
    print(f"Discharge efficiency                      : {best_result['eta_dis']:.4f}")
    print(f"Round-trip efficiency                     : {best_result['round_trip_efficiency']:.4f}")

    print("\n--- Rainflow cycle-life results ---")
    print(f"Rainflow equivalent cycles/year           : {best_result['rainflow_equivalent_cycles_per_year']:.2f}")
    print(f"Cycle-based service life                  : {best_result['cycle_based_life_years']:.2f} years")
    print(f"Replacement years within project life         : {format_years(best_result['replacement_years'])}")
    print(f"Number of replacements                    : {best_result['number_of_replacements']}")

    print("\n--- Technical results ---")
    print(f"Peak support success                      : {best_result['peak_support_success_percent']:.2f}%")
    print(f"PV self-consumption                       : {best_result['pv_self_consumption_percent']:.2f}%")
    print(f"Original EV peak                          : {best_result['original_peak_ev_kW']:,.2f} kW")
    print(f"New peak grid import                      : {best_result['new_peak_grid_import_kW']:,.2f} kW")
    print(f"Peak reduction                            : {best_result['peak_reduction_kW']:,.2f} kW")
    print(f"Minimum SOC                               : {best_result['minimum_SOC_percent']:.2f}%")
    print(f"Maximum SOC                               : {best_result['maximum_SOC_percent']:.2f}%")
    print(f"Final SOC                                 : {best_result['final_SOC_percent']:.2f}%")

    print("\n--- Economic results ---")
    print(f"C_grid^annual                             : {best_result['grid_import_cost_annual_Rs']:,.2f} Rs/year")
    print(f"R_export^annual                           : {best_result['grid_export_income_annual_Rs']:,.2f} Rs/year")
    print(f"C_BESS^0                                  : {best_result['bess_capex_Rs']:,.2f} Rs")
    print(f"C_rep^PV                                  : {best_result['replacement_pv_cost_Rs']:,.2f} Rs")
    print(f"Initial BESS annualized cost              : {best_result['initial_bess_annualized_cost_Rs']:,.2f} Rs/year")
    print(f"Replacement annualized cost               : {best_result['replacement_annualized_cost_Rs']:,.2f} Rs/year")
    print(f"C_BESS,life^annual                        : {best_result['annualized_bess_lifecycle_cost_Rs']:,.2f} Rs/year")
    print(f"C_O&M^annual                              : {best_result['bess_om_cost_annual_Rs']:,.2f} Rs/year")
    print(f"C_total^annual                            : {best_result['total_annual_cost_Rs']:,.2f} Rs/year")
    print(f"No-battery annual cost                    : {baseline_result['total_annual_cost_Rs']:,.2f} Rs/year")
    print(f"Annual saving vs no battery               : {saving:,.2f} Rs/year")
    print(f"Fitness                                   : {best_result['fitness_Rs']:,.2f} Rs/year")


def save_result_csv(path, result):
    row = result.copy()
    row["replacement_years_text"] = format_years(row["replacement_years"])
    row["replacement_years"] = str(row["replacement_years"])
    pd.DataFrame([row]).to_csv(path, index=False)

# ============================================================
# TABLE / CSV IMAGE EXPORT HELPERS
# ============================================================

def _display_value(value):
    """Format values for readable PNG table images."""
    if isinstance(value, (np.floating, float)):
        if not np.isfinite(value):
            return str(value)
        magnitude = abs(float(value))
        if magnitude >= 1_000_000:
            return f"{value:,.2f}"
        if magnitude >= 1000:
            return f"{value:,.3f}"
        return f"{value:.6f}".rstrip("0").rstrip(".")
    if isinstance(value, (np.integer, int)):
        return f"{int(value)}"
    return str(value)


def save_dataframe_table_images(
    dataframe,
    output_folder,
    filename_stem,
    title,
    include_index=True,
    max_rows_per_page=TABLE_IMAGE_MAX_ROWS_PER_PAGE,
):
    """Save a DataFrame as one or more high-resolution PNG table images."""
    df = dataframe.copy()

    if include_index:
        index_name = df.index.name if df.index.name else "index"
        df = df.reset_index().rename(columns={"index": index_name})

    if df.empty:
        df = pd.DataFrame({"message": ["No data"]})

    page_paths = []
    total_rows = len(df)
    pages = max(1, math.ceil(total_rows / max_rows_per_page))

    for page in range(pages):
        start = page * max_rows_per_page
        end = min((page + 1) * max_rows_per_page, total_rows)
        page_df = df.iloc[start:end].copy()
        formatted = page_df.apply(lambda column: column.map(_display_value))

        n_rows, n_cols = formatted.shape
        fig_width = min(max(8.0, 1.5 + 1.45 * n_cols), 22.0)
        fig_height = max(2.8, 1.3 + 0.48 * (n_rows + 1))

        fig, ax = plt.subplots(figsize=(fig_width, fig_height))
        ax.axis("off")

        page_title = title
        if pages > 1:
            page_title += f" (Page {page + 1} of {pages})"
        ax.set_title(page_title, fontsize=12, pad=12)

        table = ax.table(
            cellText=formatted.values,
            colLabels=formatted.columns,
            cellLoc="center",
            colLoc="center",
            loc="center",
        )
        table.auto_set_font_size(False)
        table.set_fontsize(TABLE_IMAGE_FONT_SIZE)
        table.scale(1.0, 1.35)

        for (row, col), cell in table.get_celld().items():
            if row == 0:
                cell.set_text_props(weight="bold")

        plt.tight_layout()

        if pages == 1:
            filename = f"{filename_stem}.png"
        else:
            filename = f"{filename_stem}_page_{page + 1:02d}.png"

        path = os.path.join(output_folder, filename)
        fig.savefig(path, dpi=TABLE_IMAGE_DPI, bbox_inches="tight")
        plt.close(fig)
        page_paths.append(path)

    return page_paths


def save_dataframe_step(
    dataframe,
    output_folder,
    filename_stem,
    title,
    include_index=True,
    max_rows_per_page=TABLE_IMAGE_MAX_ROWS_PER_PAGE,
):
    """Save one method step as both CSV and PNG table image(s)."""
    csv_path = os.path.join(output_folder, f"{filename_stem}.csv")
    dataframe.to_csv(csv_path, index=include_index)
    image_paths = save_dataframe_table_images(
        dataframe=dataframe,
        output_folder=output_folder,
        filename_stem=filename_stem,
        title=title,
        include_index=include_index,
        max_rows_per_page=max_rows_per_page,
    )
    return csv_path, image_paths


# ============================================================
# AHP CALCULATION FUNCTIONS
# ============================================================

def validate_ahp_pairwise_matrix(matrix, tolerance=1e-8):
    matrix = np.asarray(matrix, dtype=float)

    if matrix.ndim != 2 or matrix.shape[0] != matrix.shape[1]:
        raise ValueError("The AHP pairwise-comparison matrix must be square.")
    if np.any(matrix <= 0):
        raise ValueError("Every AHP pairwise-comparison value must be positive.")
    if not np.allclose(np.diag(matrix), 1.0, atol=tolerance):
        raise ValueError("Every diagonal value in the AHP matrix must equal 1.")

    reciprocal_product = matrix * matrix.T
    if not np.allclose(reciprocal_product, 1.0, atol=tolerance):
        raise ValueError(
            "The AHP matrix is not reciprocal. Each a_ij must satisfy "
            "a_ji = 1/a_ij."
        )


def build_ahp_hierarchy_table():
    rows = [{
        "level": "Level 1 - Goal",
        "element": "Select the most suitable BESS battery type",
        "evaluation_method": "Overall decision goal",
    }]

    for criterion in AHP_CRITERIA:
        rows.append({
            "level": "Level 2 - Criterion",
            "element": AHP_CRITERIA_LABELS[criterion],
            "evaluation_method": "AHP pairwise comparison for criterion weight",
        })

    for battery_type in sorted(BATTERY_TYPES):
        rows.append({
            "level": "Level 3 - Alternative",
            "element": f"Type {battery_type}: {BATTERY_TYPES[battery_type]['name']}",
            "evaluation_method": "Ranked by PROMETHEE II after fixed-type GA sizing",
        })

    return pd.DataFrame(rows)


def build_ahp_pairwise_judgment_table(matrix):
    rows = []
    for i in range(len(AHP_CRITERIA)):
        for j in range(i + 1, len(AHP_CRITERIA)):
            value = float(matrix[i, j])
            rows.append({
                "criterion_1": AHP_CRITERIA_LABELS[AHP_CRITERIA[i]],
                "criterion_2": AHP_CRITERIA_LABELS[AHP_CRITERIA[j]],
                "saaty_value_criterion_1_over_criterion_2": value,
                "reciprocal_value": 1.0 / value,
            })
    return pd.DataFrame(rows)


def calculate_ahp_weights(pairwise_matrix):
    """
    Calculate AHP weights using column normalization and normalized-row averages,
    followed by the standard consistency check.
    """
    matrix = np.asarray(pairwise_matrix, dtype=float)
    validate_ahp_pairwise_matrix(matrix)

    n = matrix.shape[0]
    if n != len(AHP_CRITERIA):
        raise ValueError(
            "AHP matrix size does not match the number of configured criteria."
        )

    labels = [AHP_CRITERIA_LABELS[c] for c in AHP_CRITERIA]
    pairwise_df = pd.DataFrame(matrix, index=labels, columns=labels)

    column_sums = matrix.sum(axis=0)
    column_sums_df = pd.DataFrame({
        "criterion": labels,
        "column_sum": column_sums,
    })

    normalized_matrix = matrix / column_sums
    normalized_df = pd.DataFrame(
        normalized_matrix,
        index=labels,
        columns=labels,
    )

    weights = normalized_matrix.mean(axis=1)
    weights = weights / weights.sum()

    weighted_sum_vector = matrix @ weights
    consistency_vector = weighted_sum_vector / weights
    lambda_max = float(consistency_vector.mean())
    consistency_index = float((lambda_max - n) / (n - 1)) if n > 1 else 0.0

    random_index = AHP_RANDOM_INDEX.get(n)
    if random_index is None:
        raise ValueError(f"No AHP random-index value is configured for n={n}.")

    consistency_ratio = (
        0.0 if random_index == 0.0 else consistency_index / random_index
    )
    is_consistent = consistency_ratio <= AHP_MAX_ACCEPTABLE_CR

    weights_df = pd.DataFrame({
    "criterion_key": AHP_CRITERIA,
    "criterion": labels,
    "calculated_ahp_weight": weights,
    "weight_percent": weights * 100.0,
    })

    consistency_vectors_df = pd.DataFrame({
        "criterion": labels,
        "calculated_weight": weights,
        "weighted_sum_Aw": weighted_sum_vector,
        "consistency_vector_Aw_over_w": consistency_vector,
    })

    consistency_summary_df = pd.DataFrame([{
        "number_of_criteria_n": n,
        "lambda_max": lambda_max,
        "consistency_index_CI": consistency_index,
        "random_index_RI": random_index,
        "consistency_ratio_CR": consistency_ratio,
        "consistency_ratio_percent": consistency_ratio * 100.0,
        "maximum_acceptable_CR": AHP_MAX_ACCEPTABLE_CR,
        "decision": "ACCEPTABLE" if is_consistent else "REVIEW REQUIRED",
    }])

    weights_dict = {
        AHP_CRITERIA[i]: float(weights[i])
        for i in range(n)
    }

    return {
        "weights": weights_dict,
        "pairwise_df": pairwise_df,
        "column_sums_df": column_sums_df,
        "normalized_df": normalized_df,
        "weights_df": weights_df,
        "consistency_vectors_df": consistency_vectors_df,
        "consistency_summary_df": consistency_summary_df,
        "lambda_max": lambda_max,
        "CI": consistency_index,
        "RI": random_index,
        "CR": consistency_ratio,
        "is_consistent": is_consistent,
    }


def plot_ahp_weights(weights_df, output_folder):
    plt.figure(figsize=(11, 5.5))
    plt.bar(weights_df["criterion"], weights_df["calculated_ahp_weight"])
    plt.xticks(rotation=30, ha="right")
    plt.ylabel("AHP weight")
    plt.title("AHP-Derived Criteria Weights")
    plt.grid(axis="y")
    plt.tight_layout()
    plt.savefig(
        os.path.join(output_folder, "ahp_step_06_weights_bar.png"),
        dpi=300,
    )
    if SHOW_PLOTS:
        plt.show()
    else:
        plt.close()


def save_ahp_process_outputs(ahp_results, output_folder):
    hierarchy_df = build_ahp_hierarchy_table()
    pairwise_judgments_df = build_ahp_pairwise_judgment_table(
        AHP_PAIRWISE_MATRIX
    )

    save_dataframe_step(
        hierarchy_df,
        output_folder,
        "ahp_step_01_hierarchy",
        "AHP Step 1 - Decision Hierarchy",
        include_index=False,
    )
    save_dataframe_step(
        pairwise_judgments_df,
        output_folder,
        "ahp_step_02_pairwise_judgments",
        "AHP Step 2 - Saaty Pairwise Judgments",
        include_index=False,
    )
    save_dataframe_step(
        ahp_results["pairwise_df"],
        output_folder,
        "ahp_step_03_pairwise_matrix",
        "AHP Step 3 - Pairwise Comparison Matrix",
        include_index=True,
    )
    save_dataframe_step(
        ahp_results["column_sums_df"],
        output_folder,
        "ahp_step_04_column_sums",
        "AHP Step 4 - Column Sums",
        include_index=False,
    )
    save_dataframe_step(
        ahp_results["normalized_df"],
        output_folder,
        "ahp_step_05_normalized_matrix",
        "AHP Step 5 - Normalized Pairwise Matrix",
        include_index=True,
    )
    save_dataframe_step(
        ahp_results["weights_df"],
        output_folder,
        "ahp_step_06_criteria_weights",
        "AHP Step 6 - Criteria Weights",
        include_index=False,
    )
    save_dataframe_step(
        ahp_results["consistency_vectors_df"],
        output_folder,
        "ahp_step_07_consistency_vectors",
        "AHP Step 7 - Weighted Sum and Consistency Vectors",
        include_index=False,
    )
    save_dataframe_step(
        ahp_results["consistency_summary_df"],
        output_folder,
        "ahp_step_08_consistency_summary",
        "AHP Step 8 - Consistency Check",
        include_index=False,
    )
    plot_ahp_weights(ahp_results["weights_df"], output_folder)


# ============================================================
# PROMETHEE II PREFERENCE FUNCTIONS
# ============================================================

def preference_usual(difference):
    """Type I preference: every strictly positive difference is full preference."""
    return 1.0 if difference > 0.0 else 0.0


def preference_linear(difference, q, p):
    """
    Linear preference implementation.

    When q = 0, this is mathematically equivalent to the
    PROMETHEE Type III V-shape preference function..
    """
    if p <= q:
        raise ValueError(
            f"PROMETHEE threshold p must be greater than q; got q={q}, p={p}."
        )

    if difference <= q:
        return 0.0
    if difference >= p:
        return 1.0
    return (difference - q) / (p - q)


def compute_preference(difference, pref_type, q=0.0, p=None):
    if pref_type == "usual":
        return preference_usual(difference)

    if pref_type == "linear":
        if p is None:
            raise ValueError("A linear PROMETHEE preference function requires p.")
        return preference_linear(difference, q, p)

    raise ValueError(f"Unknown PROMETHEE preference type: {pref_type}")


def validate_promethee_configuration(decision_matrix, weights, criteria_types):
    criteria = list(decision_matrix.columns)

    missing_weights = [c for c in criteria if c not in weights]
    missing_types = [c for c in criteria if c not in criteria_types]

    if missing_weights:
        raise KeyError(f"Missing AHP weights for criteria: {missing_weights}")
    if missing_types:
        raise KeyError(f"Missing min/max directions for criteria: {missing_types}")

    invalid_types = {
        c: criteria_types[c]
        for c in criteria
        if criteria_types[c] not in {"min", "max"}
    }
    if invalid_types:
        raise ValueError(f"Criteria directions must be 'min' or 'max': {invalid_types}")

    negative_weights = {c: weights[c] for c in criteria if weights[c] < 0}
    if negative_weights:
        raise ValueError(f"AHP weights cannot be negative: {negative_weights}")

    if sum(weights[c] for c in criteria) <= 0:
        raise ValueError("At least one AHP weight must be positive.")

    numeric = decision_matrix.apply(pd.to_numeric, errors="coerce")
    if numeric.isnull().any().any():
        bad = numeric.columns[numeric.isnull().any()].tolist()
        raise ValueError(
            f"Decision matrix contains missing/non-numeric values in: {bad}"
        )

    if not np.isfinite(numeric.to_numpy(dtype=float)).all():
        raise ValueError(
            "Decision matrix contains infinite values. Check whether a zero-size "
            "battery or zero annual cycling entered Stage 1."
        )


def build_preference_parameters(decision_matrix):
    """Build q and p from each criterion's observed range."""
    params = {}

    for criterion in decision_matrix.columns:
        values = decision_matrix[criterion].astype(float)
        value_range = float(values.max() - values.min())

        if value_range <= 1e-12:
            q = 0.0
            p = 1.0
        else:
            q = PROMETHEE_Q_RANGE_FRACTION * value_range
            p = PROMETHEE_P_RANGE_FRACTION * value_range

            if p <= q:
                p = q + value_range * 1e-6

        params[criterion] = {
            "type": "linear",
            "q": q,
            "p": p,
            "observed_min": float(values.min()),
            "observed_max": float(values.max()),
            "observed_range": value_range,
        }

    return params


def build_promethee_configuration_df(weights, criteria_types, preference_params):
    rows = []
    for criterion in AHP_CRITERIA:
        params = preference_params[criterion]
        rows.append({
            "criterion_key": criterion,
            "criterion": AHP_CRITERIA_LABELS[criterion],
            "direction": criteria_types[criterion],
            "ahp_weight": weights[criterion],
            "preference_function": params["type"],
            "observed_min": params["observed_min"],
            "observed_max": params["observed_max"],
            "observed_range": params["observed_range"],
            "q_indifference_threshold": params["q"],
            "p_strict_preference_threshold": params["p"],
        })
    return pd.DataFrame(rows)


def promethee_ii(decision_matrix, weights, criteria_types, preference_params):
    """
    Run PROMETHEE II and return all intermediate calculation tables.
    """
    validate_promethee_configuration(decision_matrix, weights, criteria_types)

    alternatives = decision_matrix.index.tolist()
    criteria = decision_matrix.columns.tolist()
    n_alternatives = len(alternatives)

    if n_alternatives < 2:
        raise ValueError("PROMETHEE II requires at least two alternatives.")

    weight_sum = sum(float(weights[c]) for c in criteria)
    normalized_weights = {
        c: float(weights[c]) / weight_sum
        for c in criteria
    }

    pi = np.zeros((n_alternatives, n_alternatives), dtype=float)
    detailed_rows = []
    pair_summary_rows = []

    for i, alternative_a in enumerate(alternatives):
        for j, alternative_b in enumerate(alternatives):
            if i == j:
                continue

            aggregate_preference = 0.0

            for criterion in criteria:
                value_a = float(decision_matrix.loc[alternative_a, criterion])
                value_b = float(decision_matrix.loc[alternative_b, criterion])

                if criteria_types[criterion] == "max":
                    difference = value_a - value_b
                else:
                    difference = value_b - value_a

                params = preference_params[criterion]
                criterion_preference = compute_preference(
                    difference=difference,
                    pref_type=params["type"],
                    q=params.get("q", 0.0),
                    p=params.get("p"),
                )

                weighted_preference = (
                    normalized_weights[criterion] * criterion_preference
                )
                aggregate_preference += weighted_preference

                detailed_rows.append({
                    "alternative_a": f"Type {alternative_a}",
                    "alternative_b": f"Type {alternative_b}",
                    "criterion_key": criterion,
                    "criterion": AHP_CRITERIA_LABELS[criterion],
                    "direction": criteria_types[criterion],
                    "value_a": value_a,
                    "value_b": value_b,
                    "directional_difference_d": difference,
                    "q_indifference": params["q"],
                    "p_strict_preference": params["p"],
                    "preference_value_P": criterion_preference,
                    "ahp_weight": normalized_weights[criterion],
                    "weighted_preference_wP": weighted_preference,
                })

            pi[i, j] = aggregate_preference
            pair_summary_rows.append({
                "alternative_a": f"Type {alternative_a}",
                "alternative_b": f"Type {alternative_b}",
                "aggregate_preference_pi_a_b": aggregate_preference,
            })

    phi_plus = pi.sum(axis=1) / (n_alternatives - 1)
    phi_minus = pi.sum(axis=0) / (n_alternatives - 1)
    phi_net = phi_plus - phi_minus

    flow_df = pd.DataFrame({
        "battery_type": alternatives,
        "row_sum_outgoing_preferences": pi.sum(axis=1),
        "column_sum_incoming_preferences": pi.sum(axis=0),
        "number_of_other_alternatives": n_alternatives - 1,
        "phi_plus_merit": phi_plus,
        "phi_minus_demerit": phi_minus,
        "phi_net": phi_net,
    }).sort_values("battery_type").reset_index(drop=True)

    ranking_df = flow_df[
        ["battery_type", "phi_plus_merit", "phi_minus_demerit", "phi_net"]
    ].copy()
    ranking_df = ranking_df.sort_values(
        ["phi_net", "phi_plus_merit"],
        ascending=[False, False],
    ).reset_index(drop=True)
    ranking_df["rank"] = np.arange(1, len(ranking_df) + 1)

    preference_df = pd.DataFrame(
        pi,
        index=[f"Type_{a}" for a in alternatives],
        columns=[f"Type_{a}" for a in alternatives],
    )

    detailed_df = pd.DataFrame(detailed_rows)
    pair_summary_df = pd.DataFrame(pair_summary_rows)

    return {
        "ranking_df": ranking_df,
        "flow_df": flow_df,
        "preference_df": preference_df,
        "detailed_df": detailed_df,
        "pair_summary_df": pair_summary_df,
        "normalized_weights": normalized_weights,
    }


# ============================================================
# STAGE 1 -> STAGE 2 INTEGRATION
# ============================================================

def build_decision_matrix(fixed_summary_df):
    """Create the five-criterion PROMETHEE decision matrix."""
    required_stage1_columns = {
        "battery_type",
        "battery_name",
        "total_annual_cost_Rs",
        "cycle_based_life_years",
        "round_trip_efficiency",
    }

    missing = required_stage1_columns.difference(fixed_summary_df.columns)
    if missing:
        raise KeyError(f"Stage 1 summary is missing columns: {sorted(missing)}")

    rows = []

    for _, stage1_row in fixed_summary_df.iterrows():
        battery_type = int(stage1_row["battery_type"])

        if battery_type not in PROMETHEE_EXTRA_CRITERIA:
            raise KeyError(
                f"PROMETHEE_EXTRA_CRITERIA has no entry for battery type {battery_type}."
            )

        extra = PROMETHEE_EXTRA_CRITERIA[battery_type]

        rows.append({
            "battery_type": battery_type,
            "battery_name": stage1_row["battery_name"],
            "total_annual_cost_Rs": float(stage1_row["total_annual_cost_Rs"]),
            "cycle_based_life_years": float(stage1_row["cycle_based_life_years"]),
            "round_trip_efficiency": float(stage1_row["round_trip_efficiency"]),
            "weight_density_kg_per_kwh": float(extra["weight_density_kg_per_kwh"]),
            "warranty_years": float(extra["warranty_years"]),
        })

    decision_df = pd.DataFrame(rows).set_index("battery_type")
    return decision_df.sort_index()


def plot_promethee_flows(ranking_df, output_folder):
    plot_df = ranking_df.sort_values("battery_type")
    x = np.arange(len(plot_df))
    width = 0.25

    plt.figure(figsize=(11, 5.5))
    plt.bar(x - width, plot_df["phi_plus_merit"], width, label="phi+ (merit)")
    plt.bar(x, plot_df["phi_minus_demerit"], width, label="phi- (demerit)")
    plt.bar(x + width, plot_df["phi_net"], width, label="phi (net)")
    plt.xticks(
        x,
        [
            f"Type {t}\n{name}"
            for t, name in zip(plot_df["battery_type"], plot_df["battery_name"])
        ],
    )
    plt.ylabel("PROMETHEE II flow")
    plt.title("PROMETHEE II Merit, Demerit, and Net Flow")
    plt.legend()
    plt.grid(axis="y")
    plt.tight_layout()
    plt.savefig(
        os.path.join(output_folder, "promethee_step_06_flows_chart.png"),
        dpi=300,
    )
    plt.savefig(
        os.path.join(output_folder, "promethee_ii_flows.png"),
        dpi=300,
    )
    if SHOW_PLOTS:
        plt.show()
    else:
        plt.close()


def plot_promethee_preference_matrix(preference_df, output_folder):
    plt.figure(figsize=(7, 6))
    plt.imshow(preference_df.values, origin="upper", aspect="auto")
    plt.colorbar(label="Aggregated preference pi(a,b)")
    plt.xticks(
        np.arange(len(preference_df.columns)),
        preference_df.columns,
        rotation=45,
        ha="right",
    )
    plt.yticks(np.arange(len(preference_df.index)), preference_df.index)
    plt.xlabel("Alternative b")
    plt.ylabel("Alternative a")
    plt.title("PROMETHEE II Pairwise Aggregated Preference Matrix")
    plt.tight_layout()
    plt.savefig(
        os.path.join(output_folder, "promethee_step_04_preference_matrix_heatmap.png"),
        dpi=300,
    )
    plt.savefig(
        os.path.join(output_folder, "promethee_ii_preference_matrix.png"),
        dpi=300,
    )
    if SHOW_PLOTS:
        plt.show()
    else:
        plt.close()


def save_promethee_process_outputs(
    decision_df,
    configuration_df,
    promethee_results,
    output_folder,
):
    save_dataframe_step(
        decision_df,
        output_folder,
        "promethee_step_01_decision_matrix",
        "PROMETHEE II Step 1 - Decision Matrix",
        include_index=True,
    )

    save_dataframe_step(
        configuration_df,
        output_folder,
        "promethee_step_02_criteria_configuration",
        "PROMETHEE II Step 2 - Criteria, AHP Weights, q and p",
        include_index=False,
    )

    detailed_df = promethee_results["detailed_df"]
    save_dataframe_step(
        detailed_df,
        output_folder,
        "promethee_step_03_detailed_pairwise_calculations",
        "PROMETHEE II Step 3 - Detailed Pairwise Criterion Calculations",
        include_index=False,
        max_rows_per_page=12,
    )

    # The complete criterion-level pairwise calculation is saved as a full CSV
    # and paginated PNG tables above.

    save_dataframe_step(
        promethee_results["pair_summary_df"],
        output_folder,
        "promethee_step_03_pairwise_aggregate_summary",
        "PROMETHEE II Step 3B - Aggregate Preference for Each Ordered Pair",
        include_index=False,
    )

    save_dataframe_step(
        promethee_results["preference_df"],
        output_folder,
        "promethee_step_04_aggregate_preference_matrix",
        "PROMETHEE II Step 4 - Aggregate Preference Matrix",
        include_index=True,
    )

    save_dataframe_step(
        promethee_results["flow_df"],
        output_folder,
        "promethee_step_05_flow_calculations",
        "PROMETHEE II Step 5 - Merit, Demerit and Net Flow Calculations",
        include_index=False,
    )

    save_dataframe_step(
        promethee_results["ranking_df"],
        output_folder,
        "promethee_step_06_final_ranking",
        "PROMETHEE II Step 6 - Final Ranking by Net Flow",
        include_index=False,
    )

    plot_promethee_preference_matrix(
        promethee_results["preference_df"], output_folder
    )


# ============================================================
# COMBINED MAIN WORKFLOW
# ============================================================

def main():
    script_folder = os.path.dirname(os.path.abspath(__file__))
    csv_path = os.path.join(script_folder, CSV_FILE_NAME)

    output_folder = os.path.join(
        script_folder,
        "results_ga_promethee_bess_selection",
    )
    os.makedirs(output_folder, exist_ok=True)

    if not os.path.exists(csv_path):
        raise FileNotFoundError(
            f"\nRequired CSV file not found:\n{csv_path}\n\n"
            f"Place {CSV_FILE_NAME} in the same folder as this Python script."
        )

    df = pd.read_csv(csv_path)

    pv_col = find_column(df, PV_COL_CANDIDATES, "PV")
    ev_col = find_column(df, EV_COL_CANDIDATES, "EV")

    pv = df[pv_col].values.astype(float)
    ev = df[ev_col].values.astype(float)
    tariffs = load_tariff_array(df)

    if len(pv) != len(ev) or len(pv) != len(tariffs):
        raise ValueError("PV, EV, and tariff arrays must have the same length.")

    if not (
        np.isfinite(pv).all()
        and np.isfinite(ev).all()
        and np.isfinite(tariffs).all()
    ):
        raise ValueError("PV, EV, and tariff inputs must contain only finite values.")

    print("\n============================================================")
    print("INPUT DATA CHECK")
    print("============================================================")
    print(f"CSV path                                  : {csv_path}")
    print(f"PV column                                 : {pv_col}")
    print(f"EV column                                 : {ev_col}")
    print(f"Rows                                      : {len(df)}")
    print(f"Time step                                 : {DT_HOURS:.2f} h")
    print(f"PV supplied-period energy                 : {np.sum(pv) * DT_HOURS:,.2f} kWh")
    print(f"EV supplied-period energy                 : {np.sum(ev) * DT_HOURS:,.2f} kWh")
    print(f"PV peak                                   : {np.max(pv):,.2f} kW")
    print(f"EV peak                                   : {np.max(ev):,.2f} kW")
    print(
        f"Tariff range                              : "
        f"{np.min(tariffs):.2f} to {np.max(tariffs):.2f} Rs/kWh"
    )

    if len(df) < 35040:
        print("\nWARNING: The CSV contains fewer than 35,040 rows.")
        print("A full 365-day year at 15-minute resolution has 35,040 rows.")
        print("The model will treat the supplied profile as the annual operating profile.")

    print("\n============================================================")
    print("TWO-STAGE METHOD SETTINGS")
    print("============================================================")
    print("Stage 1 candidate per type                : [E_BESS, theta_peak]")
    print("Battery type inside GA                    : Fixed, one GA per type")
    print(f"BESS range                                : {BESS_MIN_KWH} to {BESS_MAX_KWH} kWh")
    print(
        f"Peak-shave range                          : "
        f"{PEAK_SHARE_MIN * 100:.0f}% to {PEAK_SHARE_MAX * 100:.0f}%"
    )
    print(f"Project life                              : {PROJECT_LIFE_YEARS} years")
    print(f"Discount rate                             : {DISCOUNT_RATE * 100:.2f}%")
    print(f"Replacement cost factor                   : {REPLACEMENT_COST_FACTOR * 100:.2f}%")
    print(f"O&M cost                                  : {BESS_OM_PERCENT_OF_CAPEX * 100:.2f}% of CAPEX/year")
    print(f"GA population                             : {POPULATION_SIZE}")
    print(f"GA generations                            : {GENERATIONS}")
    print("Stage 2A method                           : AHP criteria weighting")
    print("Stage 2B method                           : PROMETHEE II ranking")
    print("Mixed battery-type GA                     : Not used")

    print_battery_catalogue()

    # ========================================================
    # STAGE 1: FOUR FIXED-TYPE GA RUNS
    # ========================================================

    print("\n============================================================")
    print("STAGE 1: FIXED-TYPE GA SIZING")
    print("============================================================")

    fixed_rows = []
    fixed_histories = {}

    for battery_type in sorted(BATTERY_TYPES):
        print("\n------------------------------------------------------------")
        print(
            f"Running fixed Type {battery_type}: "
            f"{BATTERY_TYPES[battery_type]['name']}"
        )
        print("------------------------------------------------------------")

        _, fixed_result, fixed_history, fixed_generation_df = run_ga(
            pv=pv,
            ev=ev,
            tariffs=tariffs,
            fixed_battery_type=battery_type,
            label=f"Fixed Type {battery_type}",
            seed=RANDOM_SEED + battery_type,
        )

        fixed_result["replacement_years_text"] = format_years(
            fixed_result["replacement_years"]
        )

        fixed_rows.append(fixed_result)
        fixed_histories[battery_type] = fixed_history

        fixed_generation_df.to_csv(
            os.path.join(
                output_folder,
                f"ga_generation_fixed_type_{battery_type}.csv",
            ),
            index=False,
        )

        save_result_csv(
            os.path.join(
                output_folder,
                f"stage1_best_result_type_{battery_type}.csv",
            ),
            fixed_result,
        )

    fixed_summary_df = pd.DataFrame(fixed_rows).sort_values(
        "battery_type"
    ).reset_index(drop=True)

    fixed_summary_df["replacement_years_text"] = fixed_summary_df[
        "replacement_years"
    ].apply(format_years)

    fixed_summary_path = os.path.join(
        output_folder,
        "fixed_tier_ga_summary.csv",
    )
    fixed_summary_df.to_csv(fixed_summary_path, index=False)

    print("\n============================================================")
    print("STAGE 1 OUTPUT: FIXED-TYPE GA SUMMARY")
    print("============================================================")

    stage1_display_columns = [
        "battery_type",
        "battery_name",
        "bess_kWh",
        "peak_shave_percent",
        "rainflow_equivalent_cycles_per_year",
        "cycle_based_life_years",
        "replacement_years_text",
        "round_trip_efficiency",
        "bess_om_cost_annual_Rs",
        "total_annual_cost_Rs",
        "fitness_Rs",
        "peak_support_success_percent",
        "pv_self_consumption_percent",
    ]
    print(fixed_summary_df[stage1_display_columns].to_string(index=False))

    save_dataframe_table_images(
        fixed_summary_df[stage1_display_columns],
        output_folder,
        "stage1_fixed_type_ga_summary_table",
        "Stage 1 - Fixed-Type GA Summary",
        include_index=False,
        max_rows_per_page=10,
    )

    plot_fixed_tier_results(fixed_summary_df, output_folder)

    plt.figure(figsize=(10, 5))
    for battery_type, history in fixed_histories.items():
        plt.plot(history, label=f"Type {battery_type}")
    plt.xlabel("Generation")
    plt.ylabel("Best fitness (Rs/year)")
    plt.title("GA Convergence for Four Fixed Battery Types")
    plt.grid(True)
    plt.legend()
    plt.tight_layout()
    plt.savefig(
        os.path.join(output_folder, "fixed_type_ga_convergence_all.png"),
        dpi=300,
    )
    if SHOW_PLOTS:
        plt.show()
    else:
        plt.close()

    # ========================================================
    # STAGE 2A: AHP CRITERIA WEIGHTING
    # ========================================================

    print("\n============================================================")
    print("STAGE 2A: AHP CRITERIA WEIGHTING")
    print("============================================================")

    ahp_results = calculate_ahp_weights(AHP_PAIRWISE_MATRIX)
    ahp_weights = ahp_results["weights"]
    save_ahp_process_outputs(ahp_results, output_folder)

    print("\nAHP calculated weights:")
    print(
    ahp_results["weights_df"][[
        "criterion",
        "calculated_ahp_weight",
        "weight_percent",
    ]].to_string(index=False)
    )
    print(f"\nAHP lambda_max                            : {ahp_results['lambda_max']:.6f}")
    print(f"AHP consistency index, CI                 : {ahp_results['CI']:.6f}")
    print(f"AHP random index, RI                      : {ahp_results['RI']:.2f}")
    print(f"AHP consistency ratio, CR                 : {ahp_results['CR']:.6f}")
    print(f"AHP consistency ratio                     : {ahp_results['CR'] * 100:.2f}%")
    print(
        "AHP decision                                : "
        + ("ACCEPTABLE" if ahp_results["is_consistent"] else "REVIEW REQUIRED")
    )

    if not ahp_results["is_consistent"]:
        raise ValueError(
            "The AHP pairwise judgments are inconsistent because CR exceeds "
            f"{AHP_MAX_ACCEPTABLE_CR:.2f}. Review AHP_PAIRWISE_MATRIX."
        )

    # ========================================================
    # STAGE 2B: PROMETHEE II RANKING
    # ========================================================

    print("\n============================================================")
    print("STAGE 2B: PROMETHEE II BATTERY-TYPE RANKING")
    print("============================================================")

    decision_df = build_decision_matrix(fixed_summary_df)
    criteria_matrix = decision_df[AHP_CRITERIA].astype(float)
    preference_params = build_preference_parameters(criteria_matrix)
    configuration_df = build_promethee_configuration_df(
        weights=ahp_weights,
        criteria_types=CRITERIA_TYPES,
        preference_params=preference_params,
    )

    promethee_results = promethee_ii(
        decision_matrix=criteria_matrix,
        weights=ahp_weights,
        criteria_types=CRITERIA_TYPES,
        preference_params=preference_params,
    )

    ranking_df = promethee_results["ranking_df"].copy()
    battery_name_lookup = decision_df["battery_name"].to_dict()
    ranking_df["battery_name"] = ranking_df["battery_type"].map(
        battery_name_lookup
    )
    ranking_df = ranking_df[
        [
            "rank",
            "battery_type",
            "battery_name",
            "phi_plus_merit",
            "phi_minus_demerit",
            "phi_net",
        ]
    ]
    promethee_results["ranking_df"] = ranking_df

    flow_df = promethee_results["flow_df"].copy()
    flow_df["battery_name"] = flow_df["battery_type"].map(battery_name_lookup)
    flow_df = flow_df[
        [
            "battery_type",
            "battery_name",
            "row_sum_outgoing_preferences",
            "column_sum_incoming_preferences",
            "number_of_other_alternatives",
            "phi_plus_merit",
            "phi_minus_demerit",
            "phi_net",
        ]
    ]
    promethee_results["flow_df"] = flow_df

    save_promethee_process_outputs(
        decision_df=decision_df,
        configuration_df=configuration_df,
        promethee_results=promethee_results,
        output_folder=output_folder,
    )

    # Keep the original major filenames for compatibility.
    decision_df.to_csv(
        os.path.join(output_folder, "promethee_decision_matrix.csv")
    )
    configuration_df.to_csv(
        os.path.join(output_folder, "promethee_configuration.csv"),
        index=False,
    )
    promethee_results["preference_df"].to_csv(
        os.path.join(output_folder, "promethee_aggregate_preference_matrix.csv")
    )
    ranking_df.to_csv(
        os.path.join(output_folder, "promethee_ii_ranking.csv"),
        index=False,
    )

    print("\nDecision matrix:")
    print(decision_df.to_string())

    print("\nAHP weights used by PROMETHEE II:")
    for criterion, weight in ahp_weights.items():
        print(f"  {criterion:35s}: {weight:.6f}")

    print("\nPROMETHEE II ranking:")
    print(ranking_df.to_string(index=False))

    plot_promethee_flows(ranking_df, output_folder)

    # ========================================================
    # OPTIONAL CLOSING LOOP: WINNER + ITS EXISTING GA SIZE
    # ========================================================

    winner_type = int(ranking_df.iloc[0]["battery_type"])
    winner_stage1 = fixed_summary_df.set_index("battery_type").loc[winner_type]

    winner_result, winner_timeseries, winner_rfc_df, winner_rfc_matrix = simulate_bess(
        pv=pv,
        ev=ev,
        tariffs=tariffs,
        bess_kwh=float(winner_stage1["bess_kWh"]),
        peak_battery_share=float(winner_stage1["peak_shave_percent"]) / 100.0,
        battery_type=winner_type,
        detailed_rainflow=True,
    )

    winner_individual = [
        winner_result["bess_kWh"],
        winner_result["peak_shave_percent"] / 100.0,
        winner_type,
    ]
    winner_fitness, winner_with_penalty = evaluate_solution(
        pv=pv,
        ev=ev,
        tariffs=tariffs,
        individual=winner_individual,
    )
    winner_result["penalty_Rs"] = winner_with_penalty["penalty_Rs"]
    winner_result["fitness_Rs"] = winner_fitness

    baseline_result, _ = simulate_bess(
        pv=pv,
        ev=ev,
        tariffs=tariffs,
        bess_kwh=0.0,
        peak_battery_share=winner_result["peak_shave_percent"] / 100.0,
        battery_type=winner_type,
        detailed_rainflow=False,
    )
    baseline_result["penalty_Rs"] = 0.0
    baseline_result["fitness_Rs"] = baseline_result["total_annual_cost_Rs"]

    winner_promethee = ranking_df.set_index("battery_type").loc[winner_type]

    print("\n============================================================")
    print("FINAL RECOMMENDED BESS SYSTEM")
    print("============================================================")
    print(f"PROMETHEE II rank                         : {int(winner_promethee['rank'])}")
    print(f"PROMETHEE II net flow                     : {winner_promethee['phi_net']:.6f}")
    print(f"Battery type                              : {winner_type}")
    print(f"Battery name                              : {winner_result['battery_name']}")
    print(f"GA-optimized BESS size                    : {winner_result['bess_kWh']:,.0f} kWh")
    print(f"GA-optimized peak-shave share             : {winner_result['peak_shave_percent']:.2f}%")
    print(f"Annualized total cost                     : {winner_result['total_annual_cost_Rs']:,.2f} Rs/year")
    print(f"Cycle-based life                          : {winner_result['cycle_based_life_years']:.2f} years")
    print(f"Round-trip efficiency                     : {winner_result['round_trip_efficiency'] * 100:.2f}%")
    print(f"Peak-support success                      : {winner_result['peak_support_success_percent']:.2f}%")
    print(f"PV self-consumption                       : {winner_result['pv_self_consumption_percent']:.2f}%")

    print_final_result(winner_result, baseline_result)

    save_result_csv(
        os.path.join(output_folder, "final_recommended_system.csv"),
        winner_result,
    )
    winner_timeseries.to_csv(
        os.path.join(output_folder, "final_recommended_dispatch_timeseries.csv"),
        index=False,
    )

    if winner_rfc_df is not None and not winner_rfc_df.empty:
        winner_rfc_df.to_csv(
            os.path.join(output_folder, "final_recommended_rfc_cycle_list.csv"),
            index=False,
        )

    if winner_rfc_matrix is not None and not winner_rfc_matrix.empty:
        winner_rfc_matrix.to_csv(
            os.path.join(output_folder, "final_recommended_rfc_matrix.csv")
        )

    final_recommendation_df = pd.DataFrame([{
        "promethee_rank": int(winner_promethee["rank"]),
        "battery_type": winner_type,
        "battery_name": winner_result["battery_name"],
        "phi_plus_merit": winner_promethee["phi_plus_merit"],
        "phi_minus_demerit": winner_promethee["phi_minus_demerit"],
        "phi_net": winner_promethee["phi_net"],
        "ga_optimized_bess_kWh": winner_result["bess_kWh"],
        "ga_optimized_peak_shave_percent": winner_result["peak_shave_percent"],
        "total_annual_cost_Rs": winner_result["total_annual_cost_Rs"],
        "cycle_based_life_years": winner_result["cycle_based_life_years"],
        "round_trip_efficiency": winner_result["round_trip_efficiency"],
        "weight_density_kg_per_kwh": PROMETHEE_EXTRA_CRITERIA[winner_type]["weight_density_kg_per_kwh"],
        "bess_om_cost_annual_Rs": winner_result["bess_om_cost_annual_Rs"],
        "warranty_years": PROMETHEE_EXTRA_CRITERIA[winner_type]["warranty_years"],
        "ahp_consistency_ratio": ahp_results["CR"],
    }])
    final_recommendation_df.to_csv(
        os.path.join(output_folder, "final_recommendation_summary.csv"),
        index=False,
    )
    save_dataframe_table_images(
        final_recommendation_df,
        output_folder,
        "final_recommendation_summary_table",
        "Final Recommended BESS System",
        include_index=False,
        max_rows_per_page=5,
    )

    plot_dispatch_first_day(winner_timeseries, output_folder)
    plot_cost_components(winner_result, baseline_result, output_folder)
    plot_replacement_timeline(winner_result, output_folder)
    plot_rfc_heatmap(winner_rfc_matrix, output_folder)

    print("\n============================================================")
    print("OUTPUT FILES SAVED")
    print("============================================================")
    print(f"Folder: {output_folder}")
    print("Main outputs:")
    print("1. fixed_tier_ga_summary.csv")
    print("2. ahp_step_01_hierarchy.csv/.png")
    print("3. ahp_step_03_pairwise_matrix.csv/.png")
    print("4. ahp_step_05_normalized_matrix.csv/.png")
    print("5. ahp_step_06_criteria_weights.csv/.png")
    print("6. ahp_step_08_consistency_summary.csv/.png")
    print("7. promethee_step_01_decision_matrix.csv/.png")
    print("8. promethee_step_02_criteria_configuration.csv/.png")
    print("9. promethee_step_03_detailed_pairwise_calculations.csv/.png")
    print("10. promethee_step_04_aggregate_preference_matrix.csv/.png")
    print("11. promethee_step_05_flow_calculations.csv/.png")
    print("12. promethee_step_06_final_ranking.csv/.png")
    print("13. final_recommendation_summary.csv")
    print("14. final_recommended_system.csv")
    print("15. final_recommended_dispatch_timeseries.csv")


if __name__ == "__main__":
    main()