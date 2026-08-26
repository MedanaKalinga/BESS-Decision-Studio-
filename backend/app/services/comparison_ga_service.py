"""Comparison-mode orchestration helpers for fixed-battery GA runs."""

from __future__ import annotations

import logging
from collections.abc import Mapping, Sequence
from typing import Callable

from app.schemas.comparison_optimization_jobs import (
    ComparisonOptimizationBatteryResult,
    ComparisonOptimizationFinalResult,
    ComparisonOptimizationRunRequest,
)
from app.services.comparison_job_store import ComparisonOptimizationJobStore
from app.services.single_ga_service import OptimizationCancelled, run_single_ga

logger = logging.getLogger(__name__)
GARunner = Callable[..., dict[str, object]]
CheckpointCallback = Callable[[dict[str, object]], None]


def run_comparison_job(
    *,
    store: ComparisonOptimizationJobStore,
    job_id: str,
    request: ComparisonOptimizationRunRequest,
    records: Sequence[object],
    enabled_batteries: Sequence[object],
    runner: GARunner = run_single_ga,
    checkpoint_callback: CheckpointCallback | None = None,
    resume_state: Mapping[str, object] | None = None,
) -> None:
    if not store.claim(job_id):
        return

    ga = request.ga_settings
    if resume_state is None:
        battery_results: list[dict[str, object]] = []
        cumulative_evaluations = 0
        starting_battery_index = 0
        current_ga_resume_state: Mapping[str, object] | None = None
    else:
        stored_results = resume_state.get("completed_battery_results", [])
        if not isinstance(stored_results, Sequence) or isinstance(stored_results, (str, bytes)):
            raise ValueError("The comparison resume results are invalid.")
        battery_results = [dict(item) for item in stored_results if isinstance(item, Mapping)]
        if len(battery_results) != len(stored_results):
            raise ValueError("The comparison resume results are invalid.")
        starting_battery_index = int(resume_state.get("current_battery_index", 0))
        cumulative_evaluations = int(resume_state.get("total_evaluations_completed", 0))
        ga_state_value = resume_state.get("ga_state")
        current_ga_resume_state = ga_state_value if isinstance(ga_state_value, Mapping) else None
        if (
            starting_battery_index < 0
            or starting_battery_index > len(enabled_batteries)
            or len(battery_results) != starting_battery_index
        ):
            raise ValueError("The comparison resume checkpoint is inconsistent.")
    estimated_total_evaluations = (
        ga.population_size * ga.generations * len(enabled_batteries)
    )
    current_battery_index = starting_battery_index
    current_battery_name: str | None = None
    current_battery_id: str | None = None
    current_battery_evaluations_completed = 0
    current_battery_evaluation_offset = 0
    current_battery_estimated_evaluations = (
        ga.population_size * ga.generations
    )

    def publish_progress(
        generation: int,
        evaluations_completed: int,
        best_result: dict[str, object],
    ) -> None:
        nonlocal current_battery_evaluations_completed
        current_battery_evaluations_completed = evaluations_completed
        absolute_evaluations_completed = (
            current_battery_evaluation_offset + evaluations_completed
        )
        store.update_progress(
            job_id,
            current_generation=generation,
            evaluations_completed=absolute_evaluations_completed,
            completed_battery_count=len(battery_results),
            current_battery_index=current_battery_index,
            current_battery_id=current_battery_id,
            current_battery_name=current_battery_name,
            current_battery_evaluations_completed=evaluations_completed,
            current_battery_estimated_evaluations=current_battery_estimated_evaluations,
            total_evaluations_completed=absolute_evaluations_completed,
            total_estimated_evaluations=estimated_total_evaluations,
            current_best_capacity_kwh=float(best_result["bess_capacity_kwh"]),
            current_best_peak_support_pct=float(best_result["peak_support_pct"]),
            current_best_total_annual_cost_rs=float(
                best_result["total_annual_cost_rs"]
            ),
            current_best_raw_cost_rs=float(best_result["total_annual_cost_rs"]),
            current_best_fitness_rs=float(best_result["fitness_rs"]),
            current_best_is_feasible=bool(best_result["is_feasible"]),
        )

    def publish_generation_checkpoint(ga_state: dict[str, object]) -> None:
        if checkpoint_callback is None:
            return
        checkpoint_callback(
            {
                "current_battery_index": current_battery_index,
                "current_battery_name": current_battery_name,
                "current_battery_id": current_battery_id,
                "total_battery_count": len(enabled_batteries),
                "completed_battery_results": battery_results,
                "total_evaluations_completed": (
                    current_battery_evaluation_offset
                    + int(ga_state.get("evaluations_completed", 0))
                ),
                "ga_state": ga_state,
            }
        )
    try:
        for index in range(starting_battery_index, len(enabled_batteries)):
            option = enabled_batteries[index]
            if store.is_cancel_requested(job_id):
                raise OptimizationCancelled(0, 0)

            current_battery_index = index
            battery_payload = _plain_battery_payload(option.battery)
            current_battery_name = str(battery_payload.get("name", ""))
            current_battery_id = f"battery-{index + 1}"
            battery_resume_state = (
                current_ga_resume_state
                if index == starting_battery_index
                else None
            )
            current_battery_evaluations_completed = (
                int(battery_resume_state.get("evaluations_completed", 0))
                if battery_resume_state is not None
                else 0
            )
            current_battery_evaluation_offset = sum(
                int(item.get("total_fitness_evaluations", 0))
                for item in battery_results
            )
            cumulative_evaluations = (
                current_battery_evaluation_offset
                + current_battery_evaluations_completed
            )
            store.update_progress(
                job_id,
                current_generation=(
                    int(battery_resume_state.get("last_completed_generation", 0))
                    if battery_resume_state is not None
                    else 0
                ),
                evaluations_completed=cumulative_evaluations,
                completed_battery_count=len(battery_results),
                current_battery_index=current_battery_index,
                current_battery_id=current_battery_id,
                current_battery_name=current_battery_name,
                current_battery_evaluations_completed=current_battery_evaluations_completed,
                current_battery_estimated_evaluations=current_battery_estimated_evaluations,
                total_evaluations_completed=cumulative_evaluations,
                total_estimated_evaluations=estimated_total_evaluations,
                current_best_capacity_kwh=None,
                current_best_peak_support_pct=None,
                current_best_total_annual_cost_rs=None,
                current_best_raw_cost_rs=None,
                current_best_fitness_rs=None,
                current_best_is_feasible=None,
            )

            runner_arguments: dict[str, object] = dict(
                records=records,
                battery=battery_payload,
                economic_settings=request.economic_settings,
                dispatch_strategy_status=request.dispatch_strategy_status,
                minimum_bess_capacity_kwh=request.minimum_bess_capacity_kwh,
                maximum_bess_capacity_kwh=request.maximum_bess_capacity_kwh,
                minimum_peak_support_pct=request.minimum_peak_support_pct,
                maximum_peak_support_pct=request.maximum_peak_support_pct,
                population_size=ga.population_size,
                generations=ga.generations,
                mutation_probability=ga.mutation_probability,
                elite_count=ga.elite_count,
                random_seed=ga.random_seed,
                progress_callback=publish_progress,
                cancellation_requested=lambda: store.is_cancel_requested(job_id),
            )
            if checkpoint_callback is not None:
                runner_arguments["checkpoint_callback"] = publish_generation_checkpoint
            if battery_resume_state is not None:
                runner_arguments["resume_state"] = battery_resume_state
            result = runner(**runner_arguments)
            if store.is_cancel_requested(job_id):
                raise OptimizationCancelled(0, 0)

            battery_evaluations_completed = int(
                result.get("total_fitness_evaluations", current_battery_evaluations_completed)
            )
            cumulative_evaluations = (
                current_battery_evaluation_offset + battery_evaluations_completed
            )
            current_battery_evaluations_completed = battery_evaluations_completed
            current_battery_estimated_evaluations = battery_evaluations_completed
            battery_result = _build_battery_result(result, battery_payload)
            battery_results.append(battery_result)
            store.add_battery_result(job_id, battery_result)
            store.update_progress(
                job_id,
                current_generation=ga.generations,
                evaluations_completed=cumulative_evaluations,
                completed_battery_count=len(battery_results),
                current_battery_index=current_battery_index,
                current_battery_id=current_battery_id,
                current_battery_name=current_battery_name,
                current_battery_evaluations_completed=current_battery_evaluations_completed,
                current_battery_estimated_evaluations=current_battery_estimated_evaluations,
                total_evaluations_completed=cumulative_evaluations,
                total_estimated_evaluations=estimated_total_evaluations,
                current_best_capacity_kwh=float(
                    battery_result["best_bess_capacity_kwh"]
                ),
                current_best_peak_support_pct=float(
                    battery_result["best_peak_support_pct"]
                ),
                current_best_total_annual_cost_rs=float(
                    battery_result["best_total_annual_cost_rs"]
                ),
                current_best_raw_cost_rs=float(
                    battery_result["best_total_annual_cost_rs"]
                ),
                current_best_fitness_rs=float(battery_result["best_fitness_rs"]),
                current_best_is_feasible=bool(battery_result["is_feasible"]),
            )
            current_ga_resume_state = None
            if checkpoint_callback is not None:
                checkpoint_callback(
                    {
                        "current_battery_index": index + 1,
                        "current_battery_name": None,
                        "current_battery_id": None,
                        "total_battery_count": len(enabled_batteries),
                        "completed_battery_results": battery_results,
                        "total_evaluations_completed": cumulative_evaluations,
                        "ga_state": None,
                    }
                )

        validated_results = [
            ComparisonOptimizationBatteryResult(**item)
            for item in battery_results
        ]
        feasible_battery_count = sum(
            result.solution_status == "feasible_solution" and result.is_feasible
            for result in validated_results
        )
        infeasible_battery_count = len(validated_results) - feasible_battery_count
        final_result = ComparisonOptimizationFinalResult(
            battery_results=validated_results,
            comparison_solution_status=(
                "completed_all_batteries"
                if infeasible_battery_count == 0
                else "completed_with_infeasible_alternatives"
            ),
            feasible_battery_count=feasible_battery_count,
            infeasible_battery_count=infeasible_battery_count,
        )
        store.complete_or_cancel(job_id, final_result.model_dump())
    except OptimizationCancelled:
        store.mark_cancelled(job_id)
    except Exception as exc:  # worker boundary must preserve failure state
        logger.exception("Comparison optimization job %s failed", job_id)
        store.mark_failed(job_id, f"{type(exc).__name__}: {exc}")


def _plain_battery_payload(battery: object) -> dict[str, object]:
    if hasattr(battery, "model_dump"):
        dumped = battery.model_dump()
        if isinstance(dumped, Mapping):
            return dict(dumped)
    if isinstance(battery, Mapping):
        return dict(battery)
    return {
        field: getattr(battery, field)
        for field in (
            "name",
            "price_rs_per_kwh",
            "rated_cycle_life",
            "eta_ch",
            "eta_dis",
            "weight_density_kg_per_kwh",
            "warranty_years",
        )
    }


def _build_battery_result(
    result: Mapping[str, object],
    battery: object,
) -> dict[str, object]:
    battery_config = _plain_battery_payload(
        result.get("input_battery_configuration", battery)
    )
    return {
        "battery_name": battery_config.get("name", ""),
        "input_battery_configuration": battery_config,
        "input_economic_configuration": result.get(
            "input_economic_configuration", {}
        ),
        "best_bess_capacity_kwh": result.get("best_bess_capacity_kwh", 0.0),
        "best_peak_support_pct": result.get("best_peak_support_pct", 0.0),
        "best_total_annual_cost_rs": result.get("best_total_annual_cost_rs", 0.0),
        "best_fitness_rs": result.get("best_fitness_rs", 0.0),
        "solution_status": result.get("solution_status", "no_feasible_candidate"),
        "solution_message": result.get("solution_message", ""),
        "ga_generations_completed": result.get("ga_generations_completed", 0),
        "total_fitness_evaluations": result.get("total_fitness_evaluations", 0),
        "convergence_history": result.get("convergence_history", []),
        "runtime_seconds": result.get("runtime_seconds", 0.0),
        "total_annual_cost_Rs": result.get(
            "total_annual_cost_rs",
            result.get("best_total_annual_cost_rs", 0.0),
        ),
        "cycle_based_life_years": result.get("cycle_based_life_years", 0.0),
        "round_trip_efficiency": result.get("round_trip_efficiency", 0.0),
        "weight_density_kg_per_kwh": battery_config.get(
            "weight_density_kg_per_kwh",
            getattr(battery, "weight_density_kg_per_kwh", 0.0),
        ),
        "bess_om_cost_annual_Rs": result.get("annual_om_cost_rs", 0.0),
        "warranty_years": battery_config.get(
            "warranty_years",
            getattr(battery, "warranty_years", 0.0),
        ),
        "warnings": result.get("warnings", []),
        "annual_grid_import_kwh": result.get("annual_grid_import_kwh", 0.0),
        "annual_pv_export_kwh": result.get("annual_pv_export_kwh", 0.0),
        "annual_bess_charge_kwh": result.get("annual_bess_charge_kwh", 0.0),
        "annual_bess_discharge_kwh": result.get("annual_bess_discharge_kwh", 0.0),
        "equivalent_cycles_per_year": result.get("equivalent_cycles_per_year", 0.0),
        "replacement_years": result.get("replacement_years", []),
        "annualized_bess_lifecycle_cost_rs": result.get(
            "annualized_bess_lifecycle_cost_rs",
            0.0,
        ),
        "annual_om_cost_rs": result.get("annual_om_cost_rs", 0.0),
        "annual_grid_cost_rs": result.get("annual_grid_cost_rs", 0.0),
        "annual_export_revenue_rs": result.get("annual_export_revenue_rs", 0.0),
        "peak_support_success_pct": result.get("peak_support_success_pct", 0.0),
        "pv_self_consumption_pct": result.get("pv_self_consumption_pct", 0.0),
        "peak_support_threshold_pct": result.get(
            "peak_support_threshold_pct", 95.0
        ),
        "pv_self_consumption_threshold_pct": result.get(
            "pv_self_consumption_threshold_pct", 40.0
        ),
        "peak_support_constraint_passed": result.get(
            "peak_support_constraint_passed", False
        ),
        "pv_self_consumption_constraint_passed": result.get(
            "pv_self_consumption_constraint_passed", False
        ),
        "failed_constraints": [
            constraint
            for constraint, passed in (
                (
                    "peak_support",
                    bool(result.get("peak_support_constraint_passed", False)),
                ),
                (
                    "pv_self_consumption",
                    bool(
                        result.get(
                            "pv_self_consumption_constraint_passed", False
                        )
                    ),
                ),
            )
            if not passed
        ],
        "peak_support_penalty_rs": result.get("peak_support_penalty_rs", 0.0),
        "pv_self_consumption_penalty_rs": result.get(
            "pv_self_consumption_penalty_rs",
            0.0,
        ),
        "total_penalty_rs": result.get("total_penalty_rs", 0.0),
        "is_feasible": result.get("is_feasible", False),
        "minimum_soc_pct": result.get("minimum_soc_pct", 0.0),
        "maximum_soc_pct": result.get("maximum_soc_pct", 0.0),
    }
