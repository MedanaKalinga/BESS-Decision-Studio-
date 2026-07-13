"""Background-job API for the single-battery Genetic Algorithm."""

from __future__ import annotations

import logging
from concurrent.futures import Executor, Future, ThreadPoolExecutor
from json import JSONDecodeError
from threading import RLock
from typing import Callable, Sequence

from fastapi import APIRouter, HTTPException, Query

from app.schemas.single_optimization_jobs import (
    SingleOptimizationCancelResponse,
    SingleOptimizationFinalResult,
    SingleOptimizationJobResponse,
    SingleOptimizationRunAccepted,
    SingleOptimizationRunRequest,
)
from app.schemas.single_optimization_profiles import (
    SingleOptimizationOperationalProfileResponse,
)
from app.services.dataset_service import (
    DatasetNotFoundError,
    DatasetRecord,
    DatasetValidationError,
    load_dataset_records,
)
from app.services.optimization_job_store import (
    JobNotFoundError,
    OptimizationJobStore,
)
from app.services.single_ga_service import OptimizationCancelled, run_single_ga
from app.services.single_simulation_service import (
    ModifiedDispatchStrategyError,
    REFERENCE_DISPATCH_STATUS,
)
from app.services.single_profile_service import (
    OperationalProfileDateError,
    OperationalProfileDateNotFoundError,
    OperationalProfileIncompleteDayError,
    generate_operational_profile,
)


logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/single-optimization", tags=["single-optimization"])
GARunner = Callable[..., dict[str, object]]


class SingleOptimizationJobManager:
    """Submit GA work to an executor while the store owns public state."""

    def __init__(
        self,
        *,
        store: OptimizationJobStore | None = None,
        executor: Executor | None = None,
        runner: GARunner = run_single_ga,
    ) -> None:
        self.store = store or OptimizationJobStore()
        self.executor = executor or ThreadPoolExecutor(
            max_workers=1,
            thread_name_prefix="single-bess-ga",
        )
        self.runner = runner
        self._futures: dict[str, Future[object]] = {}
        self._futures_lock = RLock()
        self._lifecycle_lock = RLock()
        self._accepting_submissions = True

    def submit(
        self,
        request: SingleOptimizationRunRequest,
        records: Sequence[DatasetRecord],
    ) -> str:
        with self._lifecycle_lock:
            if not self._accepting_submissions:
                raise RuntimeError(
                    "The optimization job manager is shutting down and "
                    "cannot accept new jobs."
                )

            request_copy = request.model_copy(deep=True)
            ga_settings = request_copy.ga_settings
            job_id = self.store.create(
                request_snapshot=request_copy.model_dump(),
                total_generations=ga_settings.generations,
                estimated_total_evaluations=(
                    ga_settings.population_size * ga_settings.generations
                ),
            )
            try:
                future = self.executor.submit(
                    self._execute,
                    job_id,
                    request_copy,
                    tuple(records),
                )
            except Exception as exc:
                self.store.mark_failed(
                    job_id,
                    f"{type(exc).__name__}: Background execution could not be started: {exc}",
                )
                raise
            with self._futures_lock:
                self._futures[job_id] = future
            future.add_done_callback(
                lambda completed, submitted_job_id=job_id: self._forget_future(
                    submitted_job_id,
                    completed,
                )
            )
        return job_id

    def _forget_future(self, job_id: str, completed: Future[object]) -> None:
        with self._futures_lock:
            if self._futures.get(job_id) is completed:
                self._futures.pop(job_id, None)

    def _execute(
        self,
        job_id: str,
        request: SingleOptimizationRunRequest,
        records: Sequence[DatasetRecord],
    ) -> None:
        if not self.store.claim(job_id):
            return

        def publish_progress(
            generation: int,
            evaluations_completed: int,
            best_result: dict[str, object],
        ) -> None:
            self.store.update_progress(
                job_id,
                current_generation=generation,
                evaluations_completed=evaluations_completed,
                current_best_capacity_kwh=float(
                    best_result["bess_capacity_kwh"]
                ),
                current_best_peak_support_pct=float(
                    best_result["peak_support_pct"]
                ),
                current_best_total_annual_cost_rs=float(
                    best_result["total_annual_cost_rs"]
                ),
                current_best_fitness_rs=float(best_result["fitness_rs"]),
                current_best_is_feasible=bool(best_result["is_feasible"]),
            )

        ga = request.ga_settings
        try:
            result = self.runner(
                records=records,
                battery=request.battery,
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
                cancellation_requested=lambda: self.store.is_cancel_requested(
                    job_id
                ),
            )
            self.store.complete_or_cancel(job_id, result)
        except OptimizationCancelled:
            self.store.mark_cancelled(job_id)
        except Exception as exc:  # worker boundary must preserve failure state
            logger.exception("Single-optimization job %s failed", job_id)
            self.store.mark_failed(job_id, f"{type(exc).__name__}: {exc}")

    def snapshot(self, job_id: str) -> dict[str, object]:
        return self.store.snapshot(job_id)

    def profile_context(self, job_id: str) -> dict[str, object]:
        return self.store.profile_context(job_id)

    def cancel(self, job_id: str) -> dict[str, object]:
        snapshot = self.store.request_cancel(job_id)
        if snapshot["status"] == "cancelled":
            with self._futures_lock:
                future = self._futures.get(job_id)
            if future is not None:
                future.cancel()
        return snapshot

    def shutdown(self, *, wait: bool = True) -> None:
        with self._lifecycle_lock:
            self._accepting_submissions = False
            with self._futures_lock:
                active_job_ids = list(self._futures)
        for job_id in active_job_ids:
            try:
                self.cancel(job_id)
            except JobNotFoundError:  # pragma: no cover - store/future invariant
                continue
        shutdown = getattr(self.executor, "shutdown", None)
        if callable(shutdown):
            shutdown(wait=wait, cancel_futures=True)


job_manager = SingleOptimizationJobManager()


def _modified_dispatch_error() -> HTTPException:
    exc = ModifiedDispatchStrategyError()
    return HTTPException(
        status_code=422,
        detail={"code": exc.code, "message": exc.message},
    )


@router.post("/run", response_model=SingleOptimizationRunAccepted)
def run_single_optimization(
    request: SingleOptimizationRunRequest,
) -> SingleOptimizationRunAccepted:
    if request.dispatch_strategy_status != REFERENCE_DISPATCH_STATUS:
        raise _modified_dispatch_error()

    try:
        _, records, _ = load_dataset_records(request.dataset_id)
    except DatasetNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except DatasetValidationError as exc:
        raise HTTPException(
            status_code=500,
            detail="The stored dataset could not be read.",
        ) from exc
    except (JSONDecodeError, OSError, AttributeError, TypeError) as exc:
        raise HTTPException(
            status_code=500,
            detail="The stored dataset could not be read.",
        ) from exc

    job_id = job_manager.submit(request, records)
    return SingleOptimizationRunAccepted(job_id=job_id, status="queued")


@router.get(
    "/jobs/{job_id}",
    response_model=SingleOptimizationJobResponse,
)
def get_single_optimization_job(job_id: str) -> SingleOptimizationJobResponse:
    try:
        snapshot = job_manager.snapshot(job_id)
    except JobNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return SingleOptimizationJobResponse(**snapshot)


@router.get(
    "/jobs/{job_id}/profiles",
    response_model=SingleOptimizationOperationalProfileResponse,
)
def get_single_optimization_profiles(
    job_id: str,
    date_value: str = Query(alias="date"),
) -> SingleOptimizationOperationalProfileResponse:
    try:
        context = job_manager.profile_context(job_id)
    except JobNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    status = str(context["status"])
    if status != "completed":
        raise HTTPException(
            status_code=409,
            detail={
                "code": "JOB_NOT_COMPLETED",
                "message": (
                    "Operational profiles are available only for completed jobs."
                ),
                "status": status,
            },
        )

    request = SingleOptimizationRunRequest(**context["request_snapshot"])
    result = SingleOptimizationFinalResult(**context["final_result"])
    try:
        profile = generate_operational_profile(
            job_id=job_id,
            dataset_id=request.dataset_id,
            date_value=date_value,
            battery=request.battery,
            economic_settings=request.economic_settings,
            bess_capacity_kwh=result.best_bess_capacity_kwh,
            peak_support_pct=result.best_peak_support_pct,
        )
    except OperationalProfileDateError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except OperationalProfileDateNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except OperationalProfileIncompleteDayError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except DatasetNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except DatasetValidationError as exc:
        raise HTTPException(
            status_code=500,
            detail="The stored dataset could not be read.",
        ) from exc
    except (JSONDecodeError, OSError, AttributeError, TypeError) as exc:
        raise HTTPException(
            status_code=500,
            detail="The stored dataset could not be read.",
        ) from exc
    return SingleOptimizationOperationalProfileResponse(**profile)


@router.post(
    "/jobs/{job_id}/cancel",
    response_model=SingleOptimizationCancelResponse,
)
def cancel_single_optimization_job(
    job_id: str,
) -> SingleOptimizationCancelResponse:
    try:
        snapshot = job_manager.cancel(job_id)
    except JobNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return SingleOptimizationCancelResponse(**snapshot)
