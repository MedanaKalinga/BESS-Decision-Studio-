"""PROMETHEE II ranking using the validated Type III V-shape reference."""

from __future__ import annotations

import math
from collections.abc import Sequence

from app.schemas.promethee import PrometheeAlternative


CRITERIA_ORDER: tuple[str, ...] = (
    "total_annual_cost_Rs",
    "cycle_based_life_years",
    "round_trip_efficiency",
    "weight_density_kg_per_kwh",
    "warranty_years",
)
CRITERION_FIELDS: tuple[str, ...] = (
    "total_annual_cost_rs",
    "cycle_based_life_years",
    "round_trip_efficiency",
    "weight_density_kg_per_kwh",
    "warranty_years",
)
CRITERION_DIRECTIONS: tuple[str, ...] = (
    "minimize",
    "maximize",
    "maximize",
    "minimize",
    "maximize",
)
PROMETHEE_Q_RANGE_FRACTION = 0.0
PROMETHEE_P_RANGE_FRACTION = 0.1
PROMETHEE_RANGE_EPSILON = 1e-12


def _clean(value: float) -> float:
    """Normalize tiny signed zeros and reject non-finite output."""
    converted = float(value)
    if not math.isfinite(converted):
        raise ValueError("PROMETHEE calculation produced a non-finite value.")
    return 0.0 if abs(converted) <= 1e-15 else converted


def type_iii_preference(
    difference: float,
    preference_threshold: float,
) -> float:
    """Return the q=0 Type III V-shape preference in the interval [0, 1]."""
    difference = float(difference)
    preference_threshold = float(preference_threshold)
    if not math.isfinite(difference) or not math.isfinite(preference_threshold):
        raise ValueError("Preference inputs must be finite numbers.")
    if preference_threshold <= 0 or difference <= 0:
        return 0.0
    if difference >= preference_threshold:
        return 1.0
    return max(0.0, min(1.0, difference / preference_threshold))


def normalize_weights(weights: Sequence[float]) -> list[float]:
    if len(weights) != len(CRITERIA_ORDER):
        raise ValueError("Exactly five AHP weights are required.")
    converted = [float(weight) for weight in weights]
    if any(not math.isfinite(weight) for weight in converted):
        raise ValueError("AHP weights must be finite numbers.")
    if any(weight < 0 for weight in converted):
        raise ValueError("AHP weights cannot be negative.")
    total = sum(converted)
    if total <= 0:
        raise ValueError("The total AHP weight must be greater than zero.")
    return [_clean(weight / total) for weight in converted]


def calculate_promethee(
    alternatives: Sequence[PrometheeAlternative],
    ahp_weights: Sequence[float],
    accepted_ahp_revision: int | str | None = None,
) -> dict[str, object]:
    """Rank technically feasible Stage 1 alternatives without recomputation."""
    if len(alternatives) < 2:
        raise ValueError("At least two battery alternatives are required.")

    names = [alternative.battery_name.strip() for alternative in alternatives]
    if len({name.casefold() for name in names}) != len(names):
        raise ValueError("Battery alternative names must be unique.")

    weights = normalize_weights(ahp_weights)
    feasible = [alternative for alternative in alternatives if alternative.is_feasible]
    excluded = [alternative for alternative in alternatives if not alternative.is_feasible]
    decision_matrix = [
        [float(getattr(alternative, field)) for field in CRITERION_FIELDS]
        for alternative in feasible
    ]

    if decision_matrix:
        observed_ranges = [
            _clean(max(row[index] for row in decision_matrix) - min(
                row[index] for row in decision_matrix
            ))
            for index in range(len(CRITERIA_ORDER))
        ]
    else:
        observed_ranges = [0.0] * len(CRITERIA_ORDER)

    q_thresholds: list[float] = []
    p_thresholds: list[float] = []
    for observed_range in observed_ranges:
        if observed_range <= PROMETHEE_RANGE_EPSILON:
            q_thresholds.append(0.0)
            p_thresholds.append(1.0)
            continue
        q_threshold = PROMETHEE_Q_RANGE_FRACTION * observed_range
        p_threshold = PROMETHEE_P_RANGE_FRACTION * observed_range
        if p_threshold <= q_threshold:
            p_threshold = q_threshold + observed_range * 1e-6
        q_thresholds.append(_clean(q_threshold))
        p_thresholds.append(_clean(p_threshold))
    feasible_names = [alternative.battery_name for alternative in feasible]
    excluded_payload = [
        {
            "battery_name": alternative.battery_name,
            "solution_status": alternative.solution_status,
            "failed_constraints": list(alternative.failed_constraints),
        }
        for alternative in excluded
    ]

    if len(feasible) < 2:
        status = (
            "insufficient_feasible_alternatives"
            if feasible
            else "no_feasible_alternatives"
        )
        return {
            "scientific_status": status,
            "accepted_ahp_revision": accepted_ahp_revision,
            "criteria_order": list(CRITERIA_ORDER),
            "criterion_directions": list(CRITERION_DIRECTIONS),
            "normalized_weights": weights,
            "raw_decision_matrix": decision_matrix,
            "observed_ranges": observed_ranges,
            "q_thresholds": q_thresholds,
            "p_thresholds": p_thresholds,
            "feasible_alternative_names": feasible_names,
            "excluded_alternatives": excluded_payload,
            "criterion_preference_matrices": {
                criterion: [] for criterion in CRITERIA_ORDER
            },
            "aggregated_preference_matrix": [],
            "positive_flows": [],
            "negative_flows": [],
            "net_flows": [],
            "ordered_ranking": [],
            "recommended_battery": None,
        }

    alternative_count = len(feasible)
    criterion_matrices = {
        criterion: [
            [0.0 for _ in range(alternative_count)]
            for _ in range(alternative_count)
        ]
        for criterion in CRITERIA_ORDER
    }
    aggregated = [
        [0.0 for _ in range(alternative_count)]
        for _ in range(alternative_count)
    ]

    for left in range(alternative_count):
        for right in range(alternative_count):
            if left == right:
                continue
            aggregate = 0.0
            for criterion_index, criterion in enumerate(CRITERIA_ORDER):
                left_value = decision_matrix[left][criterion_index]
                right_value = decision_matrix[right][criterion_index]
                difference = (
                    left_value - right_value
                    if CRITERION_DIRECTIONS[criterion_index] == "maximize"
                    else right_value - left_value
                )
                preference = type_iii_preference(
                    difference,
                    p_thresholds[criterion_index],
                )
                criterion_matrices[criterion][left][right] = preference
                aggregate += weights[criterion_index] * preference
            aggregated[left][right] = _clean(max(0.0, min(1.0, aggregate)))

    denominator = alternative_count - 1
    positive_flows = [
        _clean(sum(aggregated[row]) / denominator)
        for row in range(alternative_count)
    ]
    negative_flows = [
        _clean(
            sum(aggregated[row][column] for row in range(alternative_count))
            / denominator
        )
        for column in range(alternative_count)
    ]
    net_flows = [
        _clean(positive_flows[index] - negative_flows[index])
        for index in range(alternative_count)
    ]
    ranking_indices = sorted(
        range(alternative_count),
        key=lambda index: (
            -net_flows[index],
            -positive_flows[index],
            negative_flows[index],
            index,
        ),
    )
    ranking = [
        {
            "battery_name": feasible_names[index],
            "rank": rank,
            "positive_flow": positive_flows[index],
            "negative_flow": negative_flows[index],
            "net_flow": net_flows[index],
        }
        for rank, index in enumerate(ranking_indices, start=1)
    ]

    return {
        "scientific_status": "ranking_completed",
        "accepted_ahp_revision": accepted_ahp_revision,
        "criteria_order": list(CRITERIA_ORDER),
        "criterion_directions": list(CRITERION_DIRECTIONS),
        "normalized_weights": weights,
        "raw_decision_matrix": decision_matrix,
        "observed_ranges": observed_ranges,
        "q_thresholds": q_thresholds,
        "p_thresholds": p_thresholds,
        "feasible_alternative_names": feasible_names,
        "excluded_alternatives": excluded_payload,
        "criterion_preference_matrices": criterion_matrices,
        "aggregated_preference_matrix": aggregated,
        "positive_flows": positive_flows,
        "negative_flows": negative_flows,
        "net_flows": net_flows,
        "ordered_ranking": ranking,
        "recommended_battery": ranking[0]["battery_name"],
    }
