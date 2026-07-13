"""Genetic Algorithm orchestration for one fixed battery configuration.

This module intentionally contains no dispatch, rainflow, or lifecycle-cost
calculation.  Every chromosome is evaluated by ``evaluate_fixed_bess`` from
``single_simulation_service`` so the verified fixed-candidate calculation
remains the single source of scientific truth.
"""

from __future__ import annotations

import math
import random
import time
from collections.abc import Callable, Mapping, Sequence
from typing import Protocol

from .single_simulation_service import (
    BESS_MAX_KWH,
    BESS_MIN_KWH,
    BESS_ROUNDING_KWH,
    REFERENCE_DISPATCH_STATUS,
    ModifiedDispatchStrategyError,
    evaluate_fixed_bess,
)


TOURNAMENT_SIZE = 3
CAPACITY_MUTATION_RANGE_KWH = 1_000.0
PEAK_SUPPORT_MUTATION_RANGE_PCT = 5.0

BATTERY_CONFIGURATION_FIELDS = (
    "name",
    "price_rs_per_kwh",
    "rated_cycle_life",
    "eta_ch",
    "eta_dis",
    "weight_density_kg_per_kwh",
    "warranty_years",
)
ECONOMIC_CONFIGURATION_FIELDS = (
    "project_life_years",
    "discount_rate",
    "export_tariff_rs_per_kwh",
    "annual_om_fraction",
    "replacement_cost_fraction",
    "residual_value_enabled",
)


class DatasetRecordLike(Protocol):
    pv_kw: float
    ev_kw: float
    tariff_rs_per_kwh: float | None


ProgressCallback = Callable[[int, int, dict[str, object]], None]
CancellationCheck = Callable[[], bool]
FixedEvaluator = Callable[..., dict[str, object]]
Clock = Callable[[], float]


class OptimizationCancelled(RuntimeError):
    """Raised after a completed generation when cancellation was requested."""

    def __init__(
        self,
        generations_completed: int,
        evaluations_completed: int,
    ) -> None:
        self.generations_completed = generations_completed
        self.evaluations_completed = evaluations_completed
        super().__init__(
            "Single-battery optimization was cancelled after "
            f"{generations_completed} completed generation(s) and "
            f"{evaluations_completed} fitness evaluation(s)."
        )


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


def _strict_integer(value: object, field: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError(f"{field} must be an integer.")
    return value


def _record_value(record: DatasetRecordLike | Mapping[str, object], field: str):
    if isinstance(record, Mapping):
        try:
            return record[field]
        except KeyError as exc:
            raise ValueError(f"Dataset record is missing {field}.") from exc
    try:
        return getattr(record, field)
    except AttributeError as exc:
        raise ValueError(f"Dataset record is missing {field}.") from exc


def _configuration_dict(
    configuration: Mapping[str, object] | object,
    fields: Sequence[str],
) -> dict[str, object]:
    """Create a plain copy suitable for the completed-job response."""

    model_dump = getattr(configuration, "model_dump", None)
    if callable(model_dump):
        dumped = model_dump()
        if isinstance(dumped, Mapping):
            return {field: dumped[field] for field in fields}
    if isinstance(configuration, Mapping):
        return {field: configuration[field] for field in fields}
    return {field: getattr(configuration, field) for field in fields}


def _normalize_capacity_bounds(
    minimum_bess_capacity_kwh: object,
    maximum_bess_capacity_kwh: object,
) -> tuple[float, float, float, float]:
    requested_minimum = _finite_number(
        minimum_bess_capacity_kwh,
        "minimum_bess_capacity_kwh",
    )
    requested_maximum = _finite_number(
        maximum_bess_capacity_kwh,
        "maximum_bess_capacity_kwh",
    )
    if requested_minimum < 0:
        raise ValueError("minimum_bess_capacity_kwh must be non-negative.")
    if requested_maximum <= requested_minimum:
        raise ValueError(
            "maximum_bess_capacity_kwh must be greater than "
            "minimum_bess_capacity_kwh."
        )

    # The fixed evaluator reports a capacity on the reference 100 kWh grid.
    # Search only the grid endpoints contained by the requested interval so a
    # completed result can never be rounded outside the user's bounds.
    normalized_minimum = max(
        BESS_MIN_KWH,
        math.ceil(requested_minimum / BESS_ROUNDING_KWH)
        * BESS_ROUNDING_KWH,
    )
    normalized_maximum = min(
        BESS_MAX_KWH,
        math.floor(requested_maximum / BESS_ROUNDING_KWH)
        * BESS_ROUNDING_KWH,
    )
    if normalized_maximum < normalized_minimum:
        raise ValueError(
            "The BESS capacity bounds contain no feasible capacity on the "
            "reference 100 kWh sizing grid within 0 to 10,000 kWh."
        )
    return (
        requested_minimum,
        requested_maximum,
        normalized_minimum,
        normalized_maximum,
    )


def _validate_ga_inputs(
    *,
    minimum_peak_support_pct: object,
    maximum_peak_support_pct: object,
    population_size: object,
    generations: object,
    mutation_probability: object,
    elite_count: object,
    random_seed: object,
) -> tuple[float, float, int, int, float, int, int]:
    minimum_peak = _finite_number(
        minimum_peak_support_pct,
        "minimum_peak_support_pct",
    )
    maximum_peak = _finite_number(
        maximum_peak_support_pct,
        "maximum_peak_support_pct",
    )
    if not 0 <= minimum_peak <= 100:
        raise ValueError(
            "minimum_peak_support_pct must be between zero and 100."
        )
    if not 0 <= maximum_peak <= 100:
        raise ValueError(
            "maximum_peak_support_pct must be between zero and 100."
        )
    if maximum_peak <= minimum_peak:
        raise ValueError(
            "maximum_peak_support_pct must be greater than "
            "minimum_peak_support_pct."
        )

    population = _strict_integer(population_size, "population_size")
    generation_count = _strict_integer(generations, "generations")
    elites = _strict_integer(elite_count, "elite_count")
    seed = _strict_integer(random_seed, "random_seed")
    mutation = _finite_number(mutation_probability, "mutation_probability")

    if population < 4:
        raise ValueError("population_size must be at least four.")
    if generation_count < 1:
        raise ValueError("generations must be at least one.")
    if not 0 <= mutation <= 1:
        raise ValueError("mutation_probability must be between zero and one.")
    if elites < 1:
        raise ValueError("elite_count must be at least one.")
    if elites >= population:
        raise ValueError("elite_count must be less than population_size.")

    return (
        minimum_peak,
        maximum_peak,
        population,
        generation_count,
        mutation,
        elites,
        seed,
    )


def _repair_individual(
    individual: list[float],
    *,
    minimum_capacity: float,
    maximum_capacity: float,
    minimum_peak_support: float,
    maximum_peak_support: float,
) -> list[float]:
    individual[0] = min(max(individual[0], minimum_capacity), maximum_capacity)
    individual[1] = min(
        max(individual[1], minimum_peak_support),
        maximum_peak_support,
    )
    return individual


def _crossover(
    parent_one: Sequence[float],
    parent_two: Sequence[float],
    *,
    rng: random.Random,
    minimum_capacity: float,
    maximum_capacity: float,
    minimum_peak_support: float,
    maximum_peak_support: float,
) -> tuple[list[float], list[float]]:
    alpha = rng.random()
    child_one = [
        alpha * parent_one[0] + (1.0 - alpha) * parent_two[0],
        alpha * parent_one[1] + (1.0 - alpha) * parent_two[1],
    ]
    child_two = [
        alpha * parent_two[0] + (1.0 - alpha) * parent_one[0],
        alpha * parent_two[1] + (1.0 - alpha) * parent_one[1],
    ]
    return (
        _repair_individual(
            child_one,
            minimum_capacity=minimum_capacity,
            maximum_capacity=maximum_capacity,
            minimum_peak_support=minimum_peak_support,
            maximum_peak_support=maximum_peak_support,
        ),
        _repair_individual(
            child_two,
            minimum_capacity=minimum_capacity,
            maximum_capacity=maximum_capacity,
            minimum_peak_support=minimum_peak_support,
            maximum_peak_support=maximum_peak_support,
        ),
    )


def _mutate(
    individual: list[float],
    *,
    rng: random.Random,
    mutation_probability: float,
    minimum_capacity: float,
    maximum_capacity: float,
    minimum_peak_support: float,
    maximum_peak_support: float,
) -> list[float]:
    if rng.random() < mutation_probability:
        individual[0] += rng.uniform(
            -CAPACITY_MUTATION_RANGE_KWH,
            CAPACITY_MUTATION_RANGE_KWH,
        )
    if rng.random() < mutation_probability:
        individual[1] += rng.uniform(
            -PEAK_SUPPORT_MUTATION_RANGE_PCT,
            PEAK_SUPPORT_MUTATION_RANGE_PCT,
        )
    return _repair_individual(
        individual,
        minimum_capacity=minimum_capacity,
        maximum_capacity=maximum_capacity,
        minimum_peak_support=minimum_peak_support,
        maximum_peak_support=maximum_peak_support,
    )


def _tournament_selection(
    population: Sequence[Sequence[float]],
    fitness_values: Sequence[float],
    rng: random.Random,
) -> list[float]:
    selected_indices = rng.sample(range(len(population)), TOURNAMENT_SIZE)
    best_index = selected_indices[0]
    for index in selected_indices:
        if fitness_values[index] < fitness_values[best_index]:
            best_index = index
    return list(population[best_index])


def _rank_indices_by_fitness(
    fitness_values: Sequence[float],
) -> list[int]:
    """Rank population indices using penalized fitness only."""

    return sorted(
        range(len(fitness_values)),
        key=lambda index: fitness_values[index],
    )


def _result_number(result: Mapping[str, object], field: str) -> float:
    if field not in result:
        raise ValueError(f"Fixed evaluator result is missing {field}.")
    return _finite_number(result[field], f"evaluator.{field}")


def _result_bool(result: Mapping[str, object], field: str) -> bool:
    if field not in result or not isinstance(result[field], bool):
        raise ValueError(f"Fixed evaluator result must contain boolean {field}.")
    return bool(result[field])


def _candidate_metrics(
    result: Mapping[str, object],
) -> tuple[float, float, bool]:
    """Validate and return evaluator-owned cost, fitness, and feasibility."""

    total_annual_cost = _result_number(result, "total_annual_cost_rs")
    peak_penalty = _result_number(result, "peak_support_penalty_rs")
    pv_penalty = _result_number(result, "pv_self_consumption_penalty_rs")
    total_penalty = _result_number(result, "total_penalty_rs")
    fitness = _result_number(result, "fitness_rs")
    peak_support_passed = _result_bool(
        result,
        "peak_support_constraint_passed",
    )
    pv_self_consumption_passed = _result_bool(
        result,
        "pv_self_consumption_constraint_passed",
    )
    is_feasible = _result_bool(result, "is_feasible")

    if is_feasible != (
        peak_support_passed and pv_self_consumption_passed
    ):
        raise ValueError(
            "Fixed evaluator is_feasible does not match its technical "
            "constraint flags."
        )

    if not math.isclose(
        total_penalty,
        peak_penalty + pv_penalty,
        rel_tol=1e-12,
        abs_tol=1e-6,
    ):
        raise ValueError(
            "Fixed evaluator total_penalty_rs does not equal its component "
            "penalties."
        )
    if not math.isclose(
        fitness,
        total_annual_cost + total_penalty,
        rel_tol=1e-12,
        abs_tol=1e-6,
    ):
        raise ValueError(
            "Fixed evaluator fitness_rs does not equal total annual cost plus "
            "total penalty."
        )
    return fitness, total_annual_cost, is_feasible


def run_single_ga(
    *,
    records: Sequence[DatasetRecordLike | Mapping[str, object]],
    battery: Mapping[str, object] | object,
    economic_settings: Mapping[str, object] | object,
    dispatch_strategy_status: str,
    minimum_bess_capacity_kwh: float,
    maximum_bess_capacity_kwh: float,
    minimum_peak_support_pct: float,
    maximum_peak_support_pct: float,
    population_size: int,
    generations: int,
    mutation_probability: float,
    elite_count: int,
    random_seed: int,
    progress_callback: ProgressCallback | None = None,
    cancellation_requested: CancellationCheck | None = None,
    evaluator: FixedEvaluator = evaluate_fixed_bess,
    clock: Clock = time.perf_counter,
) -> dict[str, object]:
    """Optimize capacity and peak support for one submitted battery.

    The chromosome contains only the two continuous decision variables.  The
    submitted battery and economic configurations stay fixed for the whole run.
    Cancellation is deliberately observed only before work starts and between
    generations, matching the API's generation-safe cancellation contract.
    """

    if dispatch_strategy_status != REFERENCE_DISPATCH_STATUS:
        raise ModifiedDispatchStrategyError()
    if not records:
        raise ValueError("The dataset must contain at least one interval.")

    (
        requested_capacity_minimum,
        requested_capacity_maximum,
        capacity_minimum,
        capacity_maximum,
    ) = _normalize_capacity_bounds(
        minimum_bess_capacity_kwh,
        maximum_bess_capacity_kwh,
    )
    (
        peak_minimum,
        peak_maximum,
        population_count,
        generation_count,
        mutation_rate,
        elites,
        seed,
    ) = _validate_ga_inputs(
        minimum_peak_support_pct=minimum_peak_support_pct,
        maximum_peak_support_pct=maximum_peak_support_pct,
        population_size=population_size,
        generations=generations,
        mutation_probability=mutation_probability,
        elite_count=elite_count,
        random_seed=random_seed,
    )

    pv_kw = [
        _record_value(record, "pv_kw")
        for record in records
    ]
    ev_kw = [
        _record_value(record, "ev_kw")
        for record in records
    ]
    tariff_rs_per_kwh = [
        _record_value(record, "tariff_rs_per_kwh")
        for record in records
    ]
    should_cancel = cancellation_requested or (lambda: False)
    if should_cancel():
        raise OptimizationCancelled(0, 0)

    rng = random.Random(seed)
    population = [
        [
            rng.uniform(capacity_minimum, capacity_maximum),
            rng.uniform(peak_minimum, peak_maximum),
        ]
        for _ in range(population_count)
    ]

    started_at = _finite_number(clock(), "clock")
    best_penalized_fitness = math.inf
    best_penalized_result: dict[str, object] | None = None
    best_feasible_fitness = math.inf
    best_feasible_result: dict[str, object] | None = None
    evaluations_completed = 0
    generations_completed = 0
    convergence_history: list[dict[str, float | int | bool]] = []

    for generation_index in range(generation_count):
        if should_cancel():
            raise OptimizationCancelled(
                generations_completed,
                evaluations_completed,
            )
        fitness_values: list[float] = []
        feasible_candidate_count = 0

        for individual in population:
            _repair_individual(
                individual,
                minimum_capacity=capacity_minimum,
                maximum_capacity=capacity_maximum,
                minimum_peak_support=peak_minimum,
                maximum_peak_support=peak_maximum,
            )
            candidate_result = evaluator(
                pv_kw=pv_kw,
                ev_kw=ev_kw,
                tariff_rs_per_kwh=tariff_rs_per_kwh,
                battery=battery,
                bess_capacity_kwh=individual[0],
                peak_support_pct=individual[1],
                economic_settings=economic_settings,
            )
            if not isinstance(candidate_result, Mapping):
                raise ValueError("Fixed evaluator must return a mapping.")
            fitness, _total_annual_cost, is_feasible = _candidate_metrics(
                candidate_result
            )
            fitness_values.append(fitness)
            evaluations_completed += 1

            if fitness < best_penalized_fitness:
                best_penalized_fitness = fitness
                best_penalized_result = dict(candidate_result)
            if is_feasible:
                feasible_candidate_count += 1
                if fitness < best_feasible_fitness:
                    best_feasible_fitness = fitness
                    best_feasible_result = dict(candidate_result)

            current_best_result = (
                best_feasible_result or best_penalized_result
            )

            if progress_callback is not None:
                if current_best_result is None:  # pragma: no cover - guarded above
                    raise RuntimeError("GA did not retain its evaluated candidate.")
                progress_callback(
                    generation_index + 1,
                    evaluations_completed,
                    dict(current_best_result),
                )

        current_best_result = best_feasible_result or best_penalized_result
        if current_best_result is None:  # pragma: no cover - population invariant
            raise RuntimeError("GA completed a generation without a best result.")

        generations_completed = generation_index + 1
        convergence_history.append(
            {
                "generation": generations_completed,
                "best_fitness_rs": _result_number(
                    current_best_result,
                    "fitness_rs",
                ),
                "best_total_annual_cost_rs": _result_number(
                    current_best_result,
                    "total_annual_cost_rs",
                ),
                "average_fitness_rs": (
                    sum(fitness_values) / len(fitness_values)
                ),
                "feasible_candidate_count": feasible_candidate_count,
                "best_is_feasible": _result_bool(
                    current_best_result,
                    "is_feasible",
                ),
                "best_capacity_kwh": _result_number(
                    current_best_result,
                    "bess_capacity_kwh",
                ),
                "best_peak_support_pct": _result_number(
                    current_best_result,
                    "peak_support_pct",
                ),
            }
        )

        if generation_index + 1 < generation_count and should_cancel():
            raise OptimizationCancelled(
                generations_completed,
                evaluations_completed,
            )

        # The reference creates another population even after its last
        # evaluation.  Omitting that unused final reproduction changes neither
        # candidate evaluations nor the completed result.
        if generation_index + 1 == generation_count:
            continue

        sorted_indices = _rank_indices_by_fitness(fitness_values)
        new_population = [
            list(population[sorted_indices[index]])
            for index in range(elites)
        ]
        while len(new_population) < population_count:
            parent_one = _tournament_selection(population, fitness_values, rng)
            parent_two = _tournament_selection(population, fitness_values, rng)
            child_one, child_two = _crossover(
                parent_one,
                parent_two,
                rng=rng,
                minimum_capacity=capacity_minimum,
                maximum_capacity=capacity_maximum,
                minimum_peak_support=peak_minimum,
                maximum_peak_support=peak_maximum,
            )
            child_one = _mutate(
                child_one,
                rng=rng,
                mutation_probability=mutation_rate,
                minimum_capacity=capacity_minimum,
                maximum_capacity=capacity_maximum,
                minimum_peak_support=peak_minimum,
                maximum_peak_support=peak_maximum,
            )
            child_two = _mutate(
                child_two,
                rng=rng,
                mutation_probability=mutation_rate,
                minimum_capacity=capacity_minimum,
                maximum_capacity=capacity_maximum,
                minimum_peak_support=peak_minimum,
                maximum_peak_support=peak_maximum,
            )
            new_population.append(child_one)
            if len(new_population) < population_count:
                new_population.append(child_two)
        population = new_population

    finished_at = _finite_number(clock(), "clock")
    runtime_seconds = max(finished_at - started_at, 0.0)
    selected_result = best_feasible_result or best_penalized_result
    if selected_result is None:  # pragma: no cover - validated loop invariants
        raise RuntimeError("GA completed without evaluating a candidate.")

    feasible_solution_found = best_feasible_result is not None
    solution_status = (
        "feasible_solution"
        if feasible_solution_found
        else "no_feasible_candidate"
    )
    solution_message = (
        "A candidate satisfying all technical constraints was found."
        if feasible_solution_found
        else (
            "No candidate within the selected search bounds satisfied all "
            "technical constraints."
        )
    )

    evaluator_warnings = selected_result.get("validation_warnings", [])
    if not isinstance(evaluator_warnings, list):
        raise ValueError("Fixed evaluator validation_warnings must be a list.")
    warnings = [dict(warning) for warning in evaluator_warnings]
    if not feasible_solution_found:
        warnings.append(
            {
                "code": "NO_FEASIBLE_CANDIDATE",
                "message": solution_message,
            }
        )
    if (
        capacity_minimum != requested_capacity_minimum
        or capacity_maximum != requested_capacity_maximum
    ):
        warnings.append(
            {
                "code": "GA_CAPACITY_BOUNDS_NORMALIZED",
                "message": (
                    "The capacity search interval was normalized to "
                    f"{capacity_minimum:g}-{capacity_maximum:g} kWh so every "
                    "reported result remains on the reference 100 kWh sizing "
                    "grid and inside the submitted bounds."
                ),
            }
        )

    final_result = dict(selected_result)
    final_result.update(
        {
            "best_bess_capacity_kwh": _result_number(
                selected_result,
                "bess_capacity_kwh",
            ),
            "best_peak_support_pct": _result_number(
                selected_result,
                "peak_support_pct",
            ),
            "best_total_annual_cost_rs": _result_number(
                selected_result,
                "total_annual_cost_rs",
            ),
            "best_fitness_rs": _result_number(
                selected_result,
                "fitness_rs",
            ),
            "solution_status": solution_status,
            "solution_message": solution_message,
            "ga_generations_completed": generations_completed,
            "total_fitness_evaluations": evaluations_completed,
            "convergence_history": convergence_history,
            "runtime_seconds": runtime_seconds,
            "input_battery_configuration": _configuration_dict(
                battery,
                BATTERY_CONFIGURATION_FIELDS,
            ),
            "input_economic_configuration": _configuration_dict(
                economic_settings,
                ECONOMIC_CONFIGURATION_FIELDS,
            ),
            "warnings": warnings,
        }
    )
    return final_result
