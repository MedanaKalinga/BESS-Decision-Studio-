"""Background-job API for comparison-mode battery optimization."""

from __future__ import annotations

import logging
from collections.abc import Sequence
from concurrent.futures import Executor, Future, ThreadPoolExecutor
from json import JSONDecodeError
from threading import RLock
from typing import Callable

from fastapi import APIRouter, HTTPException

from app.schemas.comparison_optimization_jobs import (
    ComparisonOptimizationCancelResponse,
    ComparisonOptimizationJobResponse,
    ComparisonOptimizationRunAccepted,
    ComparisonOptimizationRunRequest,
)
from app.services.comparison_ga_service import run_comparison_job
from app.services.comparison_job_store import (
    ComparisonOptimizationJobStore,
    JobNotFoundError,
)
from app.services.dataset_service import (
    DatasetNotFoundError,
    DatasetRecord,
    DatasetValidationError,
    load_dataset_records,
)
from app.services.single_ga_service import run_single_ga
from app.services.single_simulation_service import (
    ModifiedDispatchStrategyError,
    REFERENCE_DISPATCH_STATUS,
)


logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/comparison-optimization", tags=["comparison-optimization"])
GARunner = Callable[..., dict[str, object]]


class ComparisonOptimizationJobManager:
    """Submit comparison-mode GA work to an executor while the store owns state."""

    def __init__(
        self,
        *,
        store: ComparisonOptimizationJobStore | None = None,
        executor: Executor | None = None,
        runner: GARunner = run_single_ga,
    ) -> None:
        self.store = store or ComparisonOptimizationJobStore()
        self.executor = executor or ThreadPoolExecutor(
            max_workers=1,
            thread_name_prefix="comparison-bess-ga",
        )
        self.runner = runner
        self._futures: dict[str, Future[object]] = {}
        self._futures_lock = RLock()
        self._lifecycle_lock = RLock()
        self._accepting_submissions = True

    def submit(
        self,
        request: ComparisonOptimizationRunRequest,
        records: Sequence[DatasetRecord],
    ) -> str:
        with self._lifecycle_lock:
            if not self._accepting_submissions:
                raise RuntimeError(
                    "The comparison optimization job manager is shutting down and cannot accept new jobs."
                )
            request_copy = request.model_copy(deep=True)
            ga_settings = request_copy.ga_settings
            enabled_batteries = [
                option for option in request_copy.batteries if option.enabled
            ]
            total_generations = ga_settings.generations
            estimated_total_evaluations = (
                ga_settings.population_size * ga_settings.generations
            ) * len(enabled_batteries)
            job_id = self.store.create(
                request_snapshot=request_copy.model_dump(),
                total_generations=total_generations,
                estimated_total_evaluations=estimated_total_evaluations,
                total_batteries=len(enabled_batteries),
            )
            try:
                future = self.executor.submit(
                    self._execute,
                    job_id,
                    request_copy,
                    tuple(records),
                    enabled_batteries,
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
        request: ComparisonOptimizationRunRequest,
        records: Sequence[DatasetRecord],
        enabled_batteries: Sequence[object],
    ) -> None:
        run_comparison_job(
            store=self.store,
            job_id=job_id,
            request=request,
            records=records,
            enabled_batteries=enabled_batteries,
            runner=self.runner,
        )

    def snapshot(self, job_id: str) -> dict[str, object]:
        return self.store.snapshot(job_id)

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
            except JobNotFoundError:
                continue
        shutdown = getattr(self.executor, "shutdown", None)
        if callable(shutdown):
            shutdown(wait=wait, cancel_futures=True)


job_manager = ComparisonOptimizationJobManager()


def _modified_dispatch_error() -> HTTPException:
    exc = ModifiedDispatchStrategyError()
    return HTTPException(status_code=422, detail={"code": exc.code, "message": exc.message})


@router.post("/run", response_model=ComparisonOptimizationRunAccepted)
def run_comparison_optimization(
    request: ComparisonOptimizationRunRequest,
) -> ComparisonOptimizationRunAccepted:
    if request.dispatch_strategy_status != REFERENCE_DISPATCH_STATUS:
        raise _modified_dispatch_error()

    try:
        _, records, _ = load_dataset_records(request.dataset_id)
    except DatasetNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except DatasetValidationError as exc:
        raise HTTPException(status_code=500, detail="The stored dataset could not be read.") from exc
    except (JSONDecodeError, OSError, AttributeError, TypeError) as exc:
        raise HTTPException(status_code=500, detail="The stored dataset could not be read.") from exc

    job_id = job_manager.submit(request, records)
    return ComparisonOptimizationRunAccepted(job_id=job_id, status="queued")


@router.get("/jobs/{job_id}", response_model=ComparisonOptimizationJobResponse)
def get_comparison_optimization_job(job_id: str) -> ComparisonOptimizationJobResponse:
    try:
        snapshot = job_manager.snapshot(job_id)
    except JobNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return ComparisonOptimizationJobResponse(**snapshot)


@router.post("/jobs/{job_id}/cancel", response_model=ComparisonOptimizationCancelResponse)
def cancel_comparison_optimization_job(job_id: str) -> ComparisonOptimizationCancelResponse:
    try:
        snapshot = job_manager.cancel(job_id)
    except JobNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return ComparisonOptimizationCancelResponse(**snapshot)
