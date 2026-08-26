"""Background-job API for comparison-mode battery optimization."""

from __future__ import annotations

import logging
import time
from collections.abc import Sequence
from concurrent.futures import Executor, Future, ThreadPoolExecutor
from json import JSONDecodeError
from threading import RLock
from typing import Callable
from uuid import uuid4

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
from app.services.optimization_checkpoint_service import (
    CheckpointRepository,
    LeaseHeartbeat,
    configuration_hash,
    dataset_fingerprint,
    scientific_version_hash,
    validate_recovery_document,
)
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
        checkpoint_repository: CheckpointRepository | None = None,
        fingerprint_factory: Callable[[str], str] = dataset_fingerprint,
        scientific_hash_factory: Callable[[], str] = scientific_version_hash,
        dataset_loader: Callable[..., object] = load_dataset_records,
    ) -> None:
        self.store = store or ComparisonOptimizationJobStore()
        self.executor = executor or ThreadPoolExecutor(
            max_workers=1,
            thread_name_prefix="comparison-bess-ga",
        )
        self.runner = runner
        self.checkpoint_repository = checkpoint_repository
        self.fingerprint_factory = fingerprint_factory
        self.scientific_hash_factory = scientific_hash_factory
        self.dataset_loader = dataset_loader
        self.worker_id = str(uuid4())
        self._persistence_context: dict[str, dict[str, object]] = {}
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
            self._register_persistent_run(job_id, request_copy)
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
        resume_state: dict[str, object] | None = None,
    ) -> None:
        repository = (
            self.checkpoint_repository
            if job_id in self._persistence_context
            else None
        )
        lease_heartbeat: LeaseHeartbeat | None = None
        if repository is not None:
            try:
                if not repository.acquire_lease(job_id, self.worker_id):
                    return
                repository.update_run_status(job_id, "running")
                lease_heartbeat = LeaseHeartbeat(repository, job_id, self.worker_id)
                lease_heartbeat.start()
            except Exception:
                logger.warning("Comparison checkpoint lease is unavailable for job %s", job_id)

        def save_comparison_checkpoint(state: dict[str, object]) -> None:
            if repository is None:
                return
            context = self._persistence_context.get(job_id)
            if context is None:
                return
            try:
                repository.save_checkpoint(
                    **context,
                    ga_state=state.get("ga_state"),
                    comparison_state=state,
                    current_battery_index=state.get("current_battery_index", 0),
                    current_battery_name=state.get("current_battery_name"),
                    total_battery_count=state.get("total_battery_count", len(enabled_batteries)),
                    completed_battery_results=state.get("completed_battery_results", []),
                    total_evaluations_completed=state.get("total_evaluations_completed", 0),
                    lifecycle_status="running",
                    cancellation_requested=self.store.is_cancel_requested(job_id),
                )
                repository.heartbeat(job_id, self.worker_id)
            except Exception:
                logger.warning("Comparison checkpoint could not be saved for job %s", job_id)

        try:
            run_comparison_job(
                store=self.store,
                job_id=job_id,
                request=request,
                records=records,
                enabled_batteries=enabled_batteries,
                runner=self.runner,
                checkpoint_callback=(save_comparison_checkpoint if repository is not None else None),
                resume_state=resume_state,
            )
            if repository is not None:
                snapshot = self.store.snapshot(job_id)
                status = str(snapshot["status"])
                try:
                    repository.update_run_status(
                        job_id,
                        status,
                        final_result=snapshot.get("final_result"),
                        partial_results=snapshot.get("partial_results", []),
                        scientific_status=(snapshot.get("final_result") or {}).get("comparison_solution_status") if isinstance(snapshot.get("final_result"), dict) else None,
                        error=snapshot.get("error"),
                        completed_at=time.time() if status == "completed" else None,
                    )
                except Exception:
                    logger.warning("Comparison terminal checkpoint could not be saved for job %s", job_id)
        finally:
            if lease_heartbeat is not None:
                lease_heartbeat.stop()

    def snapshot(self, job_id: str) -> dict[str, object]:
        return self.store.snapshot(job_id)

    def cancel(self, job_id: str) -> dict[str, object]:
        snapshot = self.store.request_cancel(job_id)
        if self.checkpoint_repository is not None:
            try:
                self.checkpoint_repository.request_cancellation(job_id)
                if snapshot["status"] == "cancelled":
                    self.checkpoint_repository.update_run_status(job_id, "cancelled", cancellation_requested=True)
            except Exception:
                logger.warning("Comparison cancellation checkpoint could not be saved for job %s", job_id)
        if snapshot["status"] == "cancelled":
            with self._futures_lock:
                future = self._futures.get(job_id)
            if future is not None:
                future.cancel()
        return snapshot

    def configure_checkpoint_repository(self, repository: CheckpointRepository) -> None:
        self.checkpoint_repository = repository

    def _register_persistent_run(
        self, job_id: str, request: ComparisonOptimizationRunRequest
    ) -> None:
        repository = self.checkpoint_repository
        if repository is None:
            return
        configuration = request.model_dump()
        try:
            resolve_project_id = getattr(repository, "resolve_project_id", None)
            project_id = resolve_project_id(request.dataset_id) if callable(resolve_project_id) else None
            context = {
                "job_id": job_id,
                "workspace_id": repository.resolve_workspace_id(request.dataset_id),
                "mode": "comparison",
                "checkpoint_version": 1,
                "submitted_configuration": configuration,
                "dataset_id": request.dataset_id,
                "configuration_hash": configuration_hash(configuration),
                "dataset_fingerprint": self.fingerprint_factory(request.dataset_id),
                "scientific_version_hash": self.scientific_hash_factory(),
            }
            if project_id is not None:
                context["project_id"] = project_id
            self._persistence_context[job_id] = context
            repository.register_run(
                **context,
                lifecycle_status="queued",
                cancellation_requested=False,
            )
        except Exception:
            logger.warning("Comparison run metadata could not be persisted for job %s", job_id)

    def recover_active_jobs(self) -> dict[str, int]:
        repository = self.checkpoint_repository
        summary = {"recovered": 0, "cancelled": 0, "blocked": 0}
        if repository is None:
            return summary
        for run in repository.list_recoverable_runs("comparison"):
            job_id = str(run.get("job_id", ""))
            configuration = run.get("submitted_configuration")
            if not job_id or not isinstance(configuration, dict):
                continue
            checkpoint = repository.load_checkpoint(job_id)
            if run.get("cancellation_requested") or run.get("lifecycle_status") == "cancelling":
                repository.update_run_status(job_id, "cancelled", recovery_reason="cancellation_requested")
                summary["cancelled"] += 1
                continue
            try:
                request = ComparisonOptimizationRunRequest(**configuration)
                current_fingerprint = self.fingerprint_factory(request.dataset_id)
            except FileNotFoundError:
                self._block_recovery(job_id, configuration, checkpoint, "dataset_missing")
                summary["blocked"] += 1
                continue
            except Exception:
                self._block_recovery(job_id, configuration, checkpoint, "checkpoint_invalid")
                summary["blocked"] += 1
                continue
            reason = validate_recovery_document(
                run,
                checkpoint,
                current_dataset_fingerprint=current_fingerprint,
                current_scientific_hash=self.scientific_hash_factory(),
            )
            project_id = run.get("project_id")
            validate_project_dataset = getattr(repository, "validate_project_dataset", None)
            if reason is None and isinstance(project_id, str) and callable(validate_project_dataset):
                reason = validate_project_dataset(project_id, request.dataset_id)
            if reason is not None:
                self._block_recovery(job_id, configuration, checkpoint, reason)
                summary["blocked"] += 1
                continue
            if not repository.acquire_lease(job_id, self.worker_id):
                continue
            try:
                _, records, _ = self.dataset_loader(request.dataset_id)  # type: ignore[misc]
                comparison_state = checkpoint.get("comparison_state") if checkpoint else None
                enabled = [option for option in request.batteries if option.enabled]
                completed_results = comparison_state.get("completed_battery_results", []) if isinstance(comparison_state, dict) else []
                ga_state = comparison_state.get("ga_state") if isinstance(comparison_state, dict) else None
                current_index = int(comparison_state.get("current_battery_index", 0)) if isinstance(comparison_state, dict) else 0
                total_evaluations = int(comparison_state.get("total_evaluations_completed", 0)) if isinstance(comparison_state, dict) else 0
                current_generation = int(ga_state.get("last_completed_generation", 0)) if isinstance(ga_state, dict) else 0
                current_battery_evaluations = int(ga_state.get("evaluations_completed", 0)) if isinstance(ga_state, dict) else 0
                best = (ga_state.get("best_feasible_result") or ga_state.get("best_penalized_result")) if isinstance(ga_state, dict) else None
                ga = request.ga_settings
                estimated = ga.population_size * ga.generations * len(enabled)
                self.store.restore(
                    job_id=job_id,
                    request_snapshot=configuration,
                    total_generations=ga.generations,
                    estimated_total_evaluations=estimated,
                    total_batteries=len(enabled),
                    current_generation=current_generation,
                    current_battery_index=current_index,
                    current_battery_evaluations_completed=current_battery_evaluations,
                    total_evaluations_completed=total_evaluations,
                    battery_results=list(completed_results) if isinstance(completed_results, list) else [],
                    current_best_result=best,
                )
                self._persistence_context[job_id] = {
                    key: run[key]
                    for key in (
                        "job_id", "workspace_id", "project_id", "mode", "checkpoint_version",
                        "submitted_configuration", "dataset_id", "configuration_hash",
                        "dataset_fingerprint", "scientific_version_hash",
                    )
                    if key in run
                }
                future = self.executor.submit(
                    self._execute,
                    job_id,
                    request,
                    tuple(records),
                    enabled,
                    comparison_state if isinstance(comparison_state, dict) else None,
                )
                with self._futures_lock:
                    self._futures[job_id] = future
                future.add_done_callback(
                    lambda completed, recovered_job_id=job_id: self._forget_future(recovered_job_id, completed)
                )
                summary["recovered"] += 1
            except Exception:
                self._block_recovery(job_id, configuration, checkpoint, "checkpoint_invalid")
                summary["blocked"] += 1
        return summary

    def _block_recovery(
        self,
        job_id: str,
        configuration: dict[str, object],
        checkpoint: dict[str, object] | None,
        reason: str,
    ) -> None:
        assert self.checkpoint_repository is not None
        self.checkpoint_repository.update_run_status(job_id, "resume_blocked", recovery_reason=reason)
        ga_settings = configuration.get("ga_settings", {})
        batteries = configuration.get("batteries", [])
        total_generations = int(ga_settings.get("generations", 1)) if isinstance(ga_settings, dict) else 1
        population_size = int(ga_settings.get("population_size", 4)) if isinstance(ga_settings, dict) else 4
        total_batteries = sum(bool(item.get("enabled")) for item in batteries if isinstance(item, dict)) if isinstance(batteries, list) else 2
        comparison_state = checkpoint.get("comparison_state") if checkpoint else None
        completed_results = comparison_state.get("completed_battery_results", []) if isinstance(comparison_state, dict) else []
        ga_state = comparison_state.get("ga_state") if isinstance(comparison_state, dict) else None
        current_index = int(comparison_state.get("current_battery_index", 0)) if isinstance(comparison_state, dict) else 0
        current_generation = int(ga_state.get("last_completed_generation", 0)) if isinstance(ga_state, dict) else 0
        current_evaluations = int(ga_state.get("evaluations_completed", 0)) if isinstance(ga_state, dict) else 0
        total_evaluations = int(comparison_state.get("total_evaluations_completed", 0)) if isinstance(comparison_state, dict) else 0
        self.store.restore(
            job_id=job_id,
            request_snapshot=configuration,
            total_generations=total_generations,
            estimated_total_evaluations=population_size * total_generations * max(total_batteries, 1),
            total_batteries=max(total_batteries, 1),
            current_generation=current_generation,
            current_battery_index=current_index,
            current_battery_evaluations_completed=current_evaluations,
            total_evaluations_completed=total_evaluations,
            battery_results=list(completed_results) if isinstance(completed_results, list) else [],
            status="failed",
            error=f"RECOVERY_BLOCKED: {reason}",
        )

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


def _require_legacy_job(job_id: str) -> None:
    if not isinstance(job_manager, ComparisonOptimizationJobManager):
        return
    repository = job_manager.checkpoint_repository
    checker = getattr(repository, "is_project_scoped_job", None)
    if callable(checker) and checker(job_id):
        raise HTTPException(status_code=404, detail="Optimization job was not found.")


@router.post("/run", response_model=ComparisonOptimizationRunAccepted)
def run_comparison_optimization(
    request: ComparisonOptimizationRunRequest,
) -> ComparisonOptimizationRunAccepted:
    if request.dispatch_strategy_status != REFERENCE_DISPATCH_STATUS:
        raise _modified_dispatch_error()
    repository = job_manager.checkpoint_repository if isinstance(job_manager, ComparisonOptimizationJobManager) else None
    resolver = getattr(repository, "resolve_project_id", None)
    if callable(resolver) and resolver(request.dataset_id) is not None:
        raise HTTPException(status_code=404, detail="Use the owning project's optimization endpoint.")

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
    _require_legacy_job(job_id)
    try:
        snapshot = job_manager.snapshot(job_id)
    except JobNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return ComparisonOptimizationJobResponse(**snapshot)


@router.post("/jobs/{job_id}/cancel", response_model=ComparisonOptimizationCancelResponse)
def cancel_comparison_optimization_job(job_id: str) -> ComparisonOptimizationCancelResponse:
    _require_legacy_job(job_id)
    try:
        snapshot = job_manager.cancel(job_id)
    except JobNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return ComparisonOptimizationCancelResponse(**snapshot)
