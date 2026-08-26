"""Thread-safe in-memory state for single-optimization jobs.

The store owns job state only.  It deliberately does not start threads or run
optimizations, which keeps execution policy separate and makes transition
races straightforward to test.
"""

from __future__ import annotations

import math
from copy import deepcopy
from dataclasses import dataclass, field
from threading import Event, RLock
from typing import Literal
from uuid import uuid4


JobStatus = Literal["queued", "running", "completed", "failed", "cancelled"]
TERMINAL_STATUSES: frozenset[JobStatus] = frozenset(
    {"completed", "failed", "cancelled"}
)


class JobNotFoundError(LookupError):
    """Raised when a requested optimization job is not in this process."""

    def __init__(self) -> None:
        super().__init__("Optimization job was not found.")


@dataclass
class _JobRecord:
    job_id: str
    request_snapshot: object
    total_generations: int
    estimated_total_evaluations: int
    status: JobStatus = "queued"
    progress_percent: float = 0.0
    current_generation: int = 0
    evaluations_completed: int = 0
    current_best_capacity_kwh: float | None = None
    current_best_peak_support_pct: float | None = None
    current_best_total_annual_cost_rs: float | None = None
    current_best_fitness_rs: float | None = None
    current_best_is_feasible: bool | None = None
    error: str | None = None
    final_result: object | None = None
    cancel_event: Event = field(default_factory=Event, repr=False)


class OptimizationJobStore:
    """Own optimization job records and enforce their state transitions."""

    def __init__(self) -> None:
        self._jobs: dict[str, _JobRecord] = {}
        self._lock = RLock()

    def create(
        self,
        request_snapshot: object,
        total_generations: int,
        estimated_total_evaluations: int,
    ) -> str:
        """Create a queued job and return its opaque identifier."""

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

        job_id = str(uuid4())
        record = _JobRecord(
            job_id=job_id,
            request_snapshot=deepcopy(request_snapshot),
            total_generations=total_generations,
            estimated_total_evaluations=estimated_total_evaluations,
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
        current_generation: int = 0,
        evaluations_completed: int = 0,
        current_best_result: object | None = None,
        status: JobStatus = "queued",
        error: str | None = None,
    ) -> None:
        """Recreate public state from a validated persisted checkpoint."""

        if status not in {"queued", "failed", "cancelled"}:
            raise ValueError("A restored job must be queued or terminal.")
        record = _JobRecord(
            job_id=job_id,
            request_snapshot=deepcopy(request_snapshot),
            total_generations=total_generations,
            estimated_total_evaluations=estimated_total_evaluations,
            status=status,
            current_generation=current_generation,
            evaluations_completed=evaluations_completed,
            progress_percent=min(
                100.0,
                100.0 * evaluations_completed / estimated_total_evaluations,
            ),
            error=error,
        )
        if isinstance(current_best_result, dict):
            record.current_best_capacity_kwh = self._optional_finite(
                current_best_result.get("bess_capacity_kwh"), "bess_capacity_kwh"
            )
            record.current_best_peak_support_pct = self._optional_finite(
                current_best_result.get("peak_support_pct"), "peak_support_pct"
            )
            record.current_best_total_annual_cost_rs = self._optional_finite(
                current_best_result.get("total_annual_cost_rs"), "total_annual_cost_rs"
            )
            record.current_best_fitness_rs = self._optional_finite(
                current_best_result.get("fitness_rs"), "fitness_rs"
            )
            feasible = current_best_result.get("is_feasible")
            record.current_best_is_feasible = feasible if isinstance(feasible, bool) else None
        with self._lock:
            self._jobs[job_id] = record

    def claim(self, job_id: str) -> bool:
        """Atomically move a queued job to running.

        ``False`` means another actor already claimed or terminally transitioned
        the job.  In particular, a queued cancellation always wins if it takes
        the lock before the worker.
        """

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
        current_best_capacity_kwh: float | None,
        current_best_peak_support_pct: float | None,
        current_best_total_annual_cost_rs: float | None,
        current_best_fitness_rs: float | None,
        current_best_is_feasible: bool | None,
    ) -> bool:
        """Apply a running job's latest monotonic progress snapshot.

        Returns ``False`` when the job is no longer running, allowing a worker
        callback that races with a terminal transition to stop harmlessly.
        """

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
            if record.status != "running":
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

            record.current_generation = max(
                record.current_generation, current_generation
            )
            record.evaluations_completed = max(
                record.evaluations_completed, evaluations_completed
            )
            record.progress_percent = min(
                100.0,
                100.0
                * record.evaluations_completed
                / record.estimated_total_evaluations,
            )
            if best_capacity is not None:
                record.current_best_capacity_kwh = best_capacity
            if best_peak_support is not None:
                record.current_best_peak_support_pct = best_peak_support
            if best_cost is not None:
                record.current_best_total_annual_cost_rs = best_cost
            if best_fitness is not None:
                record.current_best_fitness_rs = best_fitness
            if current_best_is_feasible is not None:
                record.current_best_is_feasible = current_best_is_feasible
            return True

    def is_cancel_requested(self, job_id: str) -> bool:
        """Return whether cancellation has been requested for a job."""

        with self._lock:
            return self._get(job_id).cancel_event.is_set()

    def request_cancel(self, job_id: str) -> dict[str, object]:
        """Request cancellation without misreporting active work as stopped.

        A queued job becomes cancelled immediately.  A running job retains its
        public status until its worker reaches a supported cancellation
        boundary and calls :meth:`mark_cancelled` (or
        :meth:`complete_or_cancel`).
        """

        with self._lock:
            record = self._get(job_id)
            if record.status not in TERMINAL_STATUSES:
                record.cancel_event.set()
                if record.status == "queued":
                    record.status = "cancelled"
            result = self._snapshot(record)
            result["cancellation_requested"] = record.cancel_event.is_set()
            return result

    def mark_cancelled(self, job_id: str) -> bool:
        """Confirm cancellation at a worker-supported boundary."""

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
        """Atomically complete a job unless cancellation won the race."""

        with self._lock:
            record = self._get(job_id)
            if record.status in TERMINAL_STATUSES:
                return record.status
            if record.status != "running":
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
        """Record a useful failure without overwriting an existing terminal state."""

        message = str(error_message).strip()
        if not message:
            message = "The optimization job failed without an error message."

        with self._lock:
            record = self._get(job_id)
            if record.status in TERMINAL_STATUSES:
                return False
            record.status = "failed"
            record.error = message
            record.final_result = None
            return True

    def snapshot(self, job_id: str) -> dict[str, object]:
        """Return a detached public view of the current job state."""

        with self._lock:
            return self._snapshot(self._get(job_id))

    def profile_context(self, job_id: str) -> dict[str, object]:
        """Return detached internal inputs needed for a completed-job profile."""

        with self._lock:
            record = self._get(job_id)
            status: str = record.status
            if status == "running" and record.cancel_event.is_set():
                status = "cancelling"
            return deepcopy(
                {
                    "job_id": record.job_id,
                    "status": status,
                    "request_snapshot": record.request_snapshot,
                    "final_result": record.final_result,
                }
            )

    def _get(self, job_id: str) -> _JobRecord:
        try:
            return self._jobs[job_id]
        except KeyError as exc:
            raise JobNotFoundError() from exc

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

    @staticmethod
    def _snapshot(record: _JobRecord) -> dict[str, object]:
        return deepcopy(
            {
                "job_id": record.job_id,
                "status": record.status,
                "progress_percent": record.progress_percent,
                "current_generation": record.current_generation,
                "total_generations": record.total_generations,
                "evaluations_completed": record.evaluations_completed,
                "estimated_total_evaluations": (
                    record.estimated_total_evaluations
                ),
                "current_best_capacity_kwh": (
                    record.current_best_capacity_kwh
                ),
                "current_best_peak_support_pct": (
                    record.current_best_peak_support_pct
                ),
                "current_best_total_annual_cost_rs": (
                    record.current_best_total_annual_cost_rs
                ),
                "current_best_fitness_rs": record.current_best_fitness_rs,
                "current_best_is_feasible": record.current_best_is_feasible,
                "error": record.error,
                "final_result": record.final_result,
            }
        )
