"""Background-job API for the single-battery Genetic Algorithm."""

from __future__ import annotations

import logging
import time
from concurrent.futures import Executor, Future, ThreadPoolExecutor
from json import JSONDecodeError
from threading import RLock
from typing import Callable, Sequence
from uuid import uuid4

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
from app.services.optimization_checkpoint_service import (
    CheckpointRepository,
    LeaseHeartbeat,
    configuration_hash,
    dataset_fingerprint,
    scientific_version_hash,
    validate_recovery_document,
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
        checkpoint_repository: CheckpointRepository | None = None,
        fingerprint_factory: Callable[[str], str] = dataset_fingerprint,
        scientific_hash_factory: Callable[[], str] = scientific_version_hash,
        dataset_loader: Callable[..., object] = load_dataset_records,
    ) -> None:
        self.store = store or OptimizationJobStore()
        self.executor = executor or ThreadPoolExecutor(
            max_workers=1,
            thread_name_prefix="single-bess-ga",
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
            self._register_persistent_run(job_id, request_copy)
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
                logger.warning("Single-optimization checkpoint lease is unavailable for job %s", job_id)
        if not self.store.claim(job_id):
            if lease_heartbeat is not None:
                lease_heartbeat.stop()
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

        def save_generation_checkpoint(ga_state: dict[str, object]) -> None:
            if repository is None:
                return
            context = self._persistence_context.get(job_id)
            if context is None:
                return
            try:
                repository.save_checkpoint(
                    **context,
                    ga_state=ga_state,
                    current_battery_index=0,
                    current_battery_name=request.battery.name,
                    total_battery_count=1,
                    completed_battery_results=[],
                    total_evaluations_completed=ga_state["evaluations_completed"],
                    lifecycle_status="running",
                    cancellation_requested=self.store.is_cancel_requested(job_id),
                )
                repository.heartbeat(job_id, self.worker_id)
            except Exception:
                logger.warning("Single-optimization checkpoint could not be saved for job %s", job_id)

        try:
            runner_arguments: dict[str, object] = dict(
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
            if repository is not None:
                runner_arguments["checkpoint_callback"] = save_generation_checkpoint
            if resume_state is not None:
                runner_arguments["resume_state"] = resume_state
            result = self.runner(**runner_arguments)
            final_status = self.store.complete_or_cancel(job_id, result)
            if repository is not None:
                repository.update_run_status(
                    job_id,
                    final_status,
                    final_result=result if final_status == "completed" else None,
                    scientific_status=result.get("solution_status") if final_status == "completed" else None,
                    completed_at=time.time(),
                )
        except OptimizationCancelled:
            self.store.mark_cancelled(job_id)
            if repository is not None:
                repository.update_run_status(job_id, "cancelled", cancelled_at=time.time())
        except Exception as exc:  # worker boundary must preserve failure state
            logger.exception("Single-optimization job %s failed", job_id)
            self.store.mark_failed(job_id, f"{type(exc).__name__}: {exc}")
            if repository is not None:
                try:
                    repository.update_run_status(
                        job_id,
                        "failed",
                        error=f"{type(exc).__name__}: {exc}",
                        failed_at=time.time(),
                    )
                except Exception:
                    logger.warning("Single-optimization failure checkpoint could not be saved for job %s", job_id)
        finally:
            if lease_heartbeat is not None:
                lease_heartbeat.stop()

    def snapshot(self, job_id: str) -> dict[str, object]:
        return self.store.snapshot(job_id)

    def profile_context(self, job_id: str) -> dict[str, object]:
        return self.store.profile_context(job_id)

    def cancel(self, job_id: str) -> dict[str, object]:
        snapshot = self.store.request_cancel(job_id)
        if self.checkpoint_repository is not None:
            try:
                self.checkpoint_repository.request_cancellation(job_id)
                if snapshot["status"] == "cancelled":
                    self.checkpoint_repository.update_run_status(job_id, "cancelled", cancellation_requested=True)
            except Exception:
                logger.warning("Single-optimization cancellation checkpoint could not be saved for job %s", job_id)
        if snapshot["status"] == "cancelled":
            with self._futures_lock:
                future = self._futures.get(job_id)
            if future is not None:
                future.cancel()
        return snapshot

    def configure_checkpoint_repository(self, repository: CheckpointRepository) -> None:
        self.checkpoint_repository = repository

    def _register_persistent_run(
        self, job_id: str, request: SingleOptimizationRunRequest
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
                "mode": "single",
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
            logger.warning("Single-optimization run metadata could not be persisted for job %s", job_id)

    def recover_active_jobs(self) -> dict[str, int]:
        repository = self.checkpoint_repository
        summary = {"recovered": 0, "cancelled": 0, "blocked": 0}
        if repository is None:
            return summary
        for run in repository.list_recoverable_runs("single"):
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
                request = SingleOptimizationRunRequest(**configuration)
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
                ga_state = checkpoint.get("ga_state") if checkpoint else None
                best = None
                generation = 0
                evaluations = 0
                if isinstance(ga_state, dict):
                    best = ga_state.get("best_feasible_result") or ga_state.get("best_penalized_result")
                    generation = int(ga_state.get("last_completed_generation", 0))
                    evaluations = int(ga_state.get("evaluations_completed", 0))
                ga = request.ga_settings
                self.store.restore(
                    job_id=job_id,
                    request_snapshot=configuration,
                    total_generations=ga.generations,
                    estimated_total_evaluations=ga.population_size * ga.generations,
                    current_generation=generation,
                    evaluations_completed=evaluations,
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
                    ga_state if isinstance(ga_state, dict) else None,
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
        self.checkpoint_repository.update_run_status(
            job_id,
            "resume_blocked",
            recovery_reason=reason,
        )
        ga_settings = configuration.get("ga_settings", {})
        total_generations = int(ga_settings.get("generations", 1)) if isinstance(ga_settings, dict) else 1
        population_size = int(ga_settings.get("population_size", 4)) if isinstance(ga_settings, dict) else 4
        ga_state = checkpoint.get("ga_state") if checkpoint else None
        generation = int(ga_state.get("last_completed_generation", 0)) if isinstance(ga_state, dict) else 0
        evaluations = int(ga_state.get("evaluations_completed", 0)) if isinstance(ga_state, dict) else 0
        self.store.restore(
            job_id=job_id,
            request_snapshot=configuration,
            total_generations=total_generations,
            estimated_total_evaluations=population_size * total_generations,
            current_generation=generation,
            evaluations_completed=evaluations,
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


def _require_legacy_job(job_id: str) -> None:
    if not isinstance(job_manager, SingleOptimizationJobManager):
        return
    repository = job_manager.checkpoint_repository
    checker = getattr(repository, "is_project_scoped_job", None)
    if callable(checker) and checker(job_id):
        raise HTTPException(status_code=404, detail="Optimization job was not found.")


@router.post("/run", response_model=SingleOptimizationRunAccepted)
def run_single_optimization(
    request: SingleOptimizationRunRequest,
) -> SingleOptimizationRunAccepted:
    if request.dispatch_strategy_status != REFERENCE_DISPATCH_STATUS:
        raise _modified_dispatch_error()
    repository = job_manager.checkpoint_repository if isinstance(job_manager, SingleOptimizationJobManager) else None
    resolver = getattr(repository, "resolve_project_id", None)
    if callable(resolver) and resolver(request.dataset_id) is not None:
        raise HTTPException(status_code=404, detail="Use the owning project's optimization endpoint.")

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
    _require_legacy_job(job_id)
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
    _require_legacy_job(job_id)
    return _single_optimization_profiles(job_id, date_value)


def _single_optimization_profiles(
    job_id: str,
    date_value: str,
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
    _require_legacy_job(job_id)
    try:
        snapshot = job_manager.cancel(job_id)
    except JobNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return SingleOptimizationCancelResponse(**snapshot)
