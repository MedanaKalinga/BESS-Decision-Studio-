"""Thread-safe in-memory state for comparison-optimization jobs."""

from __future__ import annotations

import math
from copy import deepcopy
from dataclasses import dataclass, field
from threading import Event, RLock
from typing import Literal
from uuid import uuid4


JobStatus = Literal[
    "queued", "running", "cancelling", "completed", "failed", "cancelled"
]
TERMINAL_STATUSES: frozenset[JobStatus] = frozenset(
    {"completed", "failed", "cancelled"}
)


class JobNotFoundError(LookupError):
    """Raised when a requested comparison job is not in this process."""

    def __init__(self) -> None:
        super().__init__("Comparison optimization job was not found.")


@dataclass
class _JobRecord:
    job_id: str
    request_snapshot: object
    total_generations: int
    estimated_total_evaluations: int
    total_batteries: int
    status: JobStatus = "queued"
    progress_percent: float = 0.0
    current_generation: int = 0
    evaluations_completed: int = 0
    completed_battery_count: int = 0
    current_battery_index: int = 0
    current_battery_id: str | None = None
    current_battery_name: str | None = None
    current_battery_evaluations_completed: int = 0
    current_battery_estimated_evaluations: int = 0
    total_evaluations_completed: int = 0
    total_estimated_evaluations: int = 0
    current_best_capacity_kwh: float | None = None
    current_best_peak_support_pct: float | None = None
    current_best_total_annual_cost_rs: float | None = None
    current_best_raw_cost_rs: float | None = None
    current_best_fitness_rs: float | None = None
    current_best_is_feasible: bool | None = None
    battery_results: list[object] = field(default_factory=list)
    error: str | None = None
    final_result: object | None = None
    cancel_event: Event = field(default_factory=Event, repr=False)


class ComparisonOptimizationJobStore:
    """Own comparison job records and enforce their state transitions."""

    def __init__(self) -> None:
        self._jobs: dict[str, _JobRecord] = {}
        self._lock = RLock()

    def create(
        self,
        request_snapshot: object,
        total_generations: int,
        estimated_total_evaluations: int,
        total_batteries: int,
    ) -> str:
        if (
            not isinstance(total_generations, int)
            or isinstance(total_generations, bool)
            or total_generations < 1
        ):
            raise ValueError("total_generations must be a positive integer.")
        if (
            not isinstance(estimated_total_evaluations, int)
            or isinstance(estimated_total_evaluations, bool)
            or estimated_total_evaluations < 1
        ):
            raise ValueError(
                "estimated_total_evaluations must be a positive integer."
            )
        if (
            not isinstance(total_batteries, int)
            or isinstance(total_batteries, bool)
            or total_batteries < 1
        ):
            raise ValueError("total_batteries must be a positive integer.")

        job_id = str(uuid4())
        record = _JobRecord(
            job_id=job_id,
            request_snapshot=deepcopy(request_snapshot),
            total_generations=total_generations,
            estimated_total_evaluations=estimated_total_evaluations,
            total_batteries=total_batteries,
        )
        with self._lock:
            self._jobs[job_id] = record
        return job_id

    def restore(
        self,
        *,
        job_id: str,
        request_snapshot: object,
        total_generations: int,
        estimated_total_evaluations: int,
        total_batteries: int,
        current_generation: int = 0,
        current_battery_index: int = 0,
        current_battery_evaluations_completed: int = 0,
        total_evaluations_completed: int = 0,
        battery_results: list[object] | None = None,
        current_best_result: object | None = None,
        status: JobStatus = "queued",
        error: str | None = None,
    ) -> None:
        """Recreate comparison progress and partial results after validation."""

        if status not in {"queued", "failed", "cancelled"}:
            raise ValueError("A restored comparison job must be queued or terminal.")
        results = deepcopy(battery_results or [])
        record = _JobRecord(
            job_id=job_id,
            request_snapshot=deepcopy(request_snapshot),
            total_generations=total_generations,
            estimated_total_evaluations=estimated_total_evaluations,
            total_batteries=total_batteries,
            status=status,
            current_generation=current_generation,
            evaluations_completed=total_evaluations_completed,
            completed_battery_count=len(results),
            current_battery_index=current_battery_index,
            current_battery_evaluations_completed=current_battery_evaluations_completed,
            current_battery_estimated_evaluations=(
                estimated_total_evaluations // max(total_batteries, 1)
            ),
            total_evaluations_completed=total_evaluations_completed,
            total_estimated_evaluations=estimated_total_evaluations,
            battery_results=results,
            progress_percent=min(
                100.0,
                100.0 * total_evaluations_completed / estimated_total_evaluations,
            ),
            error=error,
        )
        if isinstance(current_best_result, dict):
            record.current_best_capacity_kwh = self._optional_finite(current_best_result.get("bess_capacity_kwh"), "bess_capacity_kwh")
            record.current_best_peak_support_pct = self._optional_finite(current_best_result.get("peak_support_pct"), "peak_support_pct")
            record.current_best_total_annual_cost_rs = self._optional_finite(current_best_result.get("total_annual_cost_rs"), "total_annual_cost_rs")
            record.current_best_raw_cost_rs = record.current_best_total_annual_cost_rs
            record.current_best_fitness_rs = self._optional_finite(current_best_result.get("fitness_rs"), "fitness_rs")
            feasible = current_best_result.get("is_feasible")
            record.current_best_is_feasible = feasible if isinstance(feasible, bool) else None
        with self._lock:
            self._jobs[job_id] = record

    def claim(self, job_id: str) -> bool:
        with self._lock:
            record = self._get(job_id)
            if record.status != "queued":
                return False
            if record.cancel_event.is_set():
                record.status = "cancelled"
                return False
            record.status = "running"
            return True

    def update_progress(
        self,
        job_id: str,
        current_generation: int,
        evaluations_completed: int,
        completed_battery_count: int,
        current_battery_index: int,
        current_battery_id: str | None,
        current_battery_name: str | None,
        current_battery_evaluations_completed: int,
        current_battery_estimated_evaluations: int,
        total_evaluations_completed: int,
        total_estimated_evaluations: int,
        current_best_capacity_kwh: float | None,
        current_best_peak_support_pct: float | None,
        current_best_total_annual_cost_rs: float | None,
        current_best_raw_cost_rs: float | None,
        current_best_fitness_rs: float | None,
        current_best_is_feasible: bool | None,
    ) -> bool:
        if (
            not isinstance(current_generation, int)
            or isinstance(current_generation, bool)
            or current_generation < 0
        ):
            raise ValueError("current_generation must be a non-negative integer.")
        if (
            not isinstance(evaluations_completed, int)
            or isinstance(evaluations_completed, bool)
            or evaluations_completed < 0
        ):
            raise ValueError(
                "evaluations_completed must be a non-negative integer."
            )
        if (
            not isinstance(completed_battery_count, int)
            or isinstance(completed_battery_count, bool)
            or completed_battery_count < 0
        ):
            raise ValueError(
                "completed_battery_count must be a non-negative integer."
            )
        if (
            not isinstance(current_battery_index, int)
            or isinstance(current_battery_index, bool)
            or current_battery_index < 0
        ):
            raise ValueError("current_battery_index must be a non-negative integer.")
        if (
            not isinstance(current_battery_evaluations_completed, int)
            or isinstance(current_battery_evaluations_completed, bool)
            or current_battery_evaluations_completed < 0
        ):
            raise ValueError(
                "current_battery_evaluations_completed must be a non-negative integer."
            )
        if (
            not isinstance(current_battery_estimated_evaluations, int)
            or isinstance(current_battery_estimated_evaluations, bool)
            or current_battery_estimated_evaluations < 0
        ):
            raise ValueError(
                "current_battery_estimated_evaluations must be a non-negative integer."
            )
        if (
            not isinstance(total_evaluations_completed, int)
            or isinstance(total_evaluations_completed, bool)
            or total_evaluations_completed < 0
        ):
            raise ValueError(
                "total_evaluations_completed must be a non-negative integer."
            )
        if (
            not isinstance(total_estimated_evaluations, int)
            or isinstance(total_estimated_evaluations, bool)
            or total_estimated_evaluations < 0
        ):
            raise ValueError(
                "total_estimated_evaluations must be a non-negative integer."
            )
        best_capacity = self._optional_finite(
            current_best_capacity_kwh, "current_best_capacity_kwh"
        )
        best_peak_support = self._optional_finite(
            current_best_peak_support_pct,
            "current_best_peak_support_pct",
        )
        best_cost = self._optional_finite(
            current_best_total_annual_cost_rs,
            "current_best_total_annual_cost_rs",
        )
        best_raw_cost = self._optional_finite(
            current_best_raw_cost_rs,
            "current_best_raw_cost_rs",
        )
        best_fitness = self._optional_finite(
            current_best_fitness_rs,
            "current_best_fitness_rs",
        )
        if (
            current_best_is_feasible is not None
            and not isinstance(current_best_is_feasible, bool)
        ):
            raise ValueError(
                "current_best_is_feasible must be a boolean or null."
            )

        with self._lock:
            record = self._get(job_id)
            if record.status not in {"running", "cancelling"}:
                return False
            if current_generation > record.total_generations:
                raise ValueError(
                    "current_generation cannot exceed total_generations."
                )
            if evaluations_completed > record.estimated_total_evaluations:
                raise ValueError(
                    "evaluations_completed cannot exceed "
                    "estimated_total_evaluations."
                )
            if total_evaluations_completed > record.estimated_total_evaluations:
                raise ValueError(
                    "total_evaluations_completed cannot exceed "
                    "estimated_total_evaluations."
                )
            if total_estimated_evaluations < total_evaluations_completed:
                raise ValueError(
                    "total_estimated_evaluations cannot be less than total_evaluations_completed."
                )
            if completed_battery_count > record.total_batteries:
                raise ValueError(
                    "completed_battery_count cannot exceed total_batteries."
                )

            is_new_battery = current_battery_index > record.current_battery_index
            record.current_generation = (
                current_generation
                if is_new_battery
                else max(record.current_generation, current_generation)
            )
            record.evaluations_completed = max(
                record.evaluations_completed, evaluations_completed
            )
            record.completed_battery_count = max(
                record.completed_battery_count, completed_battery_count
            )
            record.current_battery_index = max(
                record.current_battery_index, current_battery_index
            )
            record.current_battery_id = current_battery_id
            record.current_battery_name = current_battery_name
            record.current_battery_evaluations_completed = (
                current_battery_evaluations_completed
                if is_new_battery
                else max(
                    record.current_battery_evaluations_completed,
                    current_battery_evaluations_completed,
                )
            )
            record.current_battery_estimated_evaluations = (
                current_battery_estimated_evaluations
            )
            record.total_evaluations_completed = max(
                record.total_evaluations_completed,
                total_evaluations_completed,
            )
            record.total_estimated_evaluations = total_estimated_evaluations
            if is_new_battery:
                record.current_best_capacity_kwh = best_capacity
                record.current_best_peak_support_pct = best_peak_support
                record.current_best_total_annual_cost_rs = best_cost
                record.current_best_raw_cost_rs = best_raw_cost
                record.current_best_fitness_rs = best_fitness
                record.current_best_is_feasible = current_best_is_feasible
            elif best_capacity is not None:
                record.current_best_capacity_kwh = best_capacity
            if not is_new_battery and best_peak_support is not None:
                record.current_best_peak_support_pct = best_peak_support
            if not is_new_battery and best_cost is not None:
                record.current_best_total_annual_cost_rs = best_cost
            if not is_new_battery and best_raw_cost is not None:
                record.current_best_raw_cost_rs = best_raw_cost
            if not is_new_battery and best_fitness is not None:
                record.current_best_fitness_rs = best_fitness
            if not is_new_battery and current_best_is_feasible is not None:
                record.current_best_is_feasible = current_best_is_feasible
            if record.estimated_total_evaluations > 0:
                record.progress_percent = min(
                    100.0,
                    100.0
                    * record.total_evaluations_completed
                    / record.estimated_total_evaluations,
                )
            return True

    def add_battery_result(self, job_id: str, result: object) -> bool:
        with self._lock:
            record = self._get(job_id)
            if record.status not in {"running", "completed"}:
                return False
            record.battery_results.append(deepcopy(result))
            record.completed_battery_count = len(record.battery_results)
            return True

    def is_cancel_requested(self, job_id: str) -> bool:
        with self._lock:
            return self._get(job_id).cancel_event.is_set()

    def request_cancel(self, job_id: str) -> dict[str, object]:
        with self._lock:
            record = self._get(job_id)
            if record.status not in TERMINAL_STATUSES:
                record.cancel_event.set()
                if record.status == "queued":
                    record.status = "cancelled"
                elif record.status == "running":
                    record.status = "cancelling"
            result = self._snapshot(record)
            result["cancellation_requested"] = record.cancel_event.is_set()
            return result

    def mark_cancelled(self, job_id: str) -> bool:
        with self._lock:
            record = self._get(job_id)
            if record.status in TERMINAL_STATUSES:
                return record.status == "cancelled"
            record.cancel_event.set()
            record.status = "cancelled"
            record.final_result = None
            record.error = None
            return True

    def complete_or_cancel(
        self,
        job_id: str,
        final_result: object,
    ) -> JobStatus:
        with self._lock:
            record = self._get(job_id)
            if record.status in TERMINAL_STATUSES:
                return record.status
            if record.status not in {"running", "cancelling"}:
                raise RuntimeError("Only a running job can be completed.")
            if record.cancel_event.is_set():
                record.status = "cancelled"
                record.final_result = None
                record.error = None
                return record.status
            record.final_result = deepcopy(final_result)
            record.status = "completed"
            record.progress_percent = 100.0
            record.current_generation = record.total_generations
            record.evaluations_completed = record.estimated_total_evaluations
            record.error = None
            return record.status

    def mark_failed(self, job_id: str, error_message: str) -> bool:
        message = str(error_message).strip()
        if not message:
            message = "The comparison optimization job failed without an error message."
        with self._lock:
            record = self._get(job_id)
            if record.status in TERMINAL_STATUSES:
                return False
            record.status = "failed"
            record.error = message
            record.final_result = None
            return True

    def snapshot(self, job_id: str) -> dict[str, object]:
        with self._lock:
            return self._snapshot(self._get(job_id))

    def _get(self, job_id: str) -> _JobRecord:
        try:
            return self._jobs[job_id]
        except KeyError as exc:
            raise JobNotFoundError() from exc

    def _snapshot(self, record: _JobRecord) -> dict[str, object]:
        return {
            "job_id": record.job_id,
            "status": record.status,
            "progress_percent": record.progress_percent,
            "overall_progress_percent": record.progress_percent,
            "current_generation": record.current_generation,
            "total_generations": record.total_generations,
            "evaluations_completed": record.evaluations_completed,
            "estimated_total_evaluations": record.estimated_total_evaluations,
            "current_battery_index": record.current_battery_index,
            "current_battery_id": record.current_battery_id,
            "current_battery_name": record.current_battery_name,
            "current_battery_evaluations_completed": record.current_battery_evaluations_completed,
            "current_battery_estimated_evaluations": record.current_battery_estimated_evaluations,
            "total_evaluations_completed": record.total_evaluations_completed,
            "total_estimated_evaluations": record.total_estimated_evaluations,
            "completed_battery_count": record.completed_battery_count,
            "total_batteries": record.total_batteries,
            "current_best_capacity_kwh": record.current_best_capacity_kwh,
            "current_best_peak_support_pct": record.current_best_peak_support_pct,
            "current_best_total_annual_cost_rs": record.current_best_total_annual_cost_rs,
            "current_best_raw_cost_rs": record.current_best_raw_cost_rs,
            "current_best_fitness_rs": record.current_best_fitness_rs,
            "current_best_is_feasible": record.current_best_is_feasible,
            "battery_results": deepcopy(record.battery_results),
            "partial_results": deepcopy(record.battery_results),
            "error": record.error,
            "final_result": deepcopy(record.final_result),
        }

    @staticmethod
    def _optional_finite(value: float | None, field_name: str) -> float | None:
        if value is None:
            return None
        if isinstance(value, bool):
            raise ValueError(f"{field_name} must be a finite number or null.")
        converted = float(value)
        if not math.isfinite(converted):
            raise ValueError(f"{field_name} must be a finite number or null.")
        return converted
