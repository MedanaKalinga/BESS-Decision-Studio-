"""Authenticated, owner-scoped scientific workspace endpoints."""

from __future__ import annotations

from json import JSONDecodeError
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status

from app.api.auth import get_auth_repository, get_current_user
from app.api.comparison_optimization_jobs import (
    job_manager as comparison_job_manager,
)
from app.api.single_optimization_jobs import (
    _single_optimization_profiles,
    job_manager as single_job_manager,
)
from app.config.mongodb import PersistenceUnavailableError, mongo_persistence
from app.schemas.comparison_optimization_jobs import (
    ComparisonOptimizationCancelResponse,
    ComparisonOptimizationJobResponse,
    ComparisonOptimizationRunAccepted,
    ComparisonOptimizationRunRequest,
)
from app.schemas.datasets import DatasetDayResponse, DatasetUploadResponse
from app.schemas.project_scientific import (
    ActiveDatasetResponse,
    LegacyWorkspaceImportRequest,
    ProjectDatasetResponse,
    ProjectOptimizationRunResponse,
    ProjectWorkspaceResponse,
    ProjectWorkspaceUpdateRequest,
)
from app.schemas.single_optimization_jobs import (
    SingleOptimizationCancelResponse,
    SingleOptimizationJobResponse,
    SingleOptimizationRunAccepted,
    SingleOptimizationRunRequest,
)
from app.schemas.single_optimization_profiles import SingleOptimizationOperationalProfileResponse
from app.services.auth_project_service import MongoAuthProjectRepository, ProjectNotFoundError
from app.services.dataset_service import (
    MAX_UPLOAD_BYTES,
    DatasetDateError,
    DatasetDateNotFoundError,
    DatasetFileError,
    DatasetNotFoundError,
    DatasetUploadTooLargeError,
    DatasetValidationError,
    get_dataset_day,
    load_dataset_records,
    validate_and_store_dataset,
)
from app.services.optimization_checkpoint_service import dataset_fingerprint
from app.services.workspace_persistence_service import (
    MongoWorkspaceRepository,
    WorkspaceNotFoundError,
    WorkspacePayloadError,
    WorkspaceRevisionConflictError,
)
from app.services.comparison_job_store import JobNotFoundError as ComparisonJobNotFoundError
from app.services.optimization_job_store import JobNotFoundError as SingleJobNotFoundError
from app.services.single_simulation_service import REFERENCE_DISPATCH_STATUS


router = APIRouter(prefix="/api/projects/{project_id}", tags=["project-scientific"])


def get_scientific_repository() -> MongoWorkspaceRepository:
    try:
        return mongo_persistence.repository()
    except PersistenceUnavailableError as exc:
        raise HTTPException(status_code=503, detail="Project persistence is temporarily unavailable.") from exc


def authorize_project(
    project_id: UUID,
    user: dict[str, object] = Depends(get_current_user),
    repository: MongoAuthProjectRepository = Depends(get_auth_repository),
) -> dict[str, object]:
    try:
        return repository.get_project(project_id, str(user["user_id"]), touch=False)
    except ProjectNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Project was not found.") from exc


@router.get("/workspace", response_model=ProjectWorkspaceResponse)
def get_project_workspace(
    project_id: UUID,
    _: dict[str, object] = Depends(authorize_project),
    repository: MongoWorkspaceRepository = Depends(get_scientific_repository),
) -> dict[str, object]:
    return repository.get_project_workspace(project_id)


@router.get("/optimization-runs", response_model=list[ProjectOptimizationRunResponse])
def list_project_optimization_runs(
    project_id: UUID,
    mode: str | None = Query(default=None, pattern="^(single|comparison)$"),
    limit: int = Query(default=20, ge=1, le=100),
    _: dict[str, object] = Depends(authorize_project),
    repository: MongoWorkspaceRepository = Depends(get_scientific_repository),
) -> list[dict[str, object]]:
    return repository.list_project_optimization_runs(project_id, mode=mode, limit=limit)


@router.put("/workspace", response_model=ProjectWorkspaceResponse)
def update_project_workspace(
    project_id: UUID,
    request: ProjectWorkspaceUpdateRequest,
    _: dict[str, object] = Depends(authorize_project),
    repository: MongoWorkspaceRepository = Depends(get_scientific_repository),
) -> dict[str, object]:
    try:
        return repository.update_project_workspace(
            project_id,
            request.state,
            schema_version=request.schema_version,
            expected_revision=request.expected_revision,
        )
    except WorkspaceRevisionConflictError as exc:
        raise HTTPException(status_code=409, detail="Workspace revision conflict.") from exc
    except WorkspacePayloadError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/workspace/import-legacy", response_model=ProjectWorkspaceResponse)
def import_legacy_workspace(
    project_id: UUID,
    request: LegacyWorkspaceImportRequest,
    _: dict[str, object] = Depends(authorize_project),
    repository: MongoWorkspaceRepository = Depends(get_scientific_repository),
) -> dict[str, object]:
    try:
        return repository.import_legacy_workspace(project_id, request.workspace_id)
    except WorkspaceNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except WorkspacePayloadError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.get("/ahp-state")
def get_project_ahp_state(project_id: UUID, _: dict[str, object] = Depends(authorize_project), repository: MongoWorkspaceRepository = Depends(get_scientific_repository)) -> dict[str, object]:
    state = repository.get_project_ahp_state(project_id)
    if state is None:
        raise HTTPException(status_code=404, detail="AHP state was not found in this project.")
    return state


@router.get("/promethee-state")
def get_project_promethee_state(project_id: UUID, _: dict[str, object] = Depends(authorize_project), repository: MongoWorkspaceRepository = Depends(get_scientific_repository)) -> dict[str, object]:
    state = repository.get_project_promethee_state(project_id)
    if state is None:
        raise HTTPException(status_code=404, detail="PROMETHEE state was not found in this project.")
    return state


@router.post("/datasets", response_model=DatasetUploadResponse)
async def upload_project_dataset(
    project_id: UUID,
    file: UploadFile = File(...),
    use_manual_mapping: bool = Form(False),
    pv_column: str | None = Form(None),
    ev_column: str | None = Form(None),
    tariff_column: str | None = Form(None),
    timestamp_column: str | None = Form(None),
    start_date: str | None = Form(None),
    generate_timestamps: bool = Form(False),
    _: dict[str, object] = Depends(authorize_project),
    repository: MongoWorkspaceRepository = Depends(get_scientific_repository),
) -> dict[str, object]:
    filename = file.filename or ""
    try:
        content = await file.read(MAX_UPLOAD_BYTES + 1)
    finally:
        await file.close()
    try:
        result = validate_and_store_dataset(
            content,
            filename,
            use_manual_mapping=use_manual_mapping,
            pv_column=pv_column,
            ev_column=ev_column,
            tariff_column=tariff_column,
            timestamp_column=timestamp_column,
            start_date=start_date,
            generate_timestamps=generate_timestamps,
        )
        repository.register_project_dataset(
            project_id, result, fingerprint=dataset_fingerprint(str(result["dataset_id"]))
        )
        return result
    except DatasetUploadTooLargeError as exc:
        raise HTTPException(status_code=413, detail=str(exc)) from exc
    except (DatasetFileError, DatasetValidationError) as exc:
        detail: object = str(exc)
        if isinstance(exc, DatasetValidationError):
            detail = {"message": str(exc), "validation_summary": exc.validation_summary}
        raise HTTPException(status_code=422, detail=detail) from exc


@router.get("/datasets", response_model=list[ProjectDatasetResponse])
def list_project_datasets(
    project_id: UUID,
    _: dict[str, object] = Depends(authorize_project),
    repository: MongoWorkspaceRepository = Depends(get_scientific_repository),
) -> list[dict[str, object]]:
    return repository.list_project_datasets(project_id)


@router.get("/datasets/{dataset_id}", response_model=ProjectDatasetResponse)
def get_project_dataset(
    project_id: UUID,
    dataset_id: UUID,
    _: dict[str, object] = Depends(authorize_project),
    repository: MongoWorkspaceRepository = Depends(get_scientific_repository),
) -> dict[str, object]:
    try:
        return repository.get_project_dataset(project_id, str(dataset_id))
    except WorkspaceNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.put("/datasets/{dataset_id}/active", response_model=ActiveDatasetResponse)
def activate_project_dataset(
    project_id: UUID,
    dataset_id: UUID,
    _: dict[str, object] = Depends(authorize_project),
    repository: MongoWorkspaceRepository = Depends(get_scientific_repository),
) -> dict[str, object]:
    try:
        repository.activate_project_dataset(project_id, str(dataset_id))
        return {"active_dataset_id": str(dataset_id)}
    except WorkspaceNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.delete("/datasets/{dataset_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_project_dataset(
    project_id: UUID,
    dataset_id: UUID,
    _: dict[str, object] = Depends(authorize_project),
    repository: MongoWorkspaceRepository = Depends(get_scientific_repository),
) -> None:
    try:
        repository.remove_project_dataset(project_id, str(dataset_id))
    except WorkspaceNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/datasets/{dataset_id}/day", response_model=DatasetDayResponse)
def project_dataset_day(
    project_id: UUID,
    dataset_id: UUID,
    date: str = Query(pattern=r"^\d{4}-\d{2}-\d{2}$"),
    _: dict[str, object] = Depends(authorize_project),
    repository: MongoWorkspaceRepository = Depends(get_scientific_repository),
) -> dict[str, object]:
    try:
        repository.get_project_dataset(project_id, str(dataset_id))
        return get_dataset_day(str(dataset_id), date)
    except DatasetDateError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except (WorkspaceNotFoundError, DatasetNotFoundError, DatasetDateNotFoundError) as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except (DatasetValidationError, JSONDecodeError, OSError) as exc:
        raise HTTPException(status_code=500, detail="The stored dataset could not be read.") from exc


def _authorize_run_dataset(repository: MongoWorkspaceRepository, project_id: UUID, dataset_id: str, project: dict[str, object]) -> None:
    try:
        repository.get_project_dataset(project_id, dataset_id)
    except WorkspaceNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Dataset was not found in this project.") from exc
    if str(project.get("active_dataset_id") or "") != str(dataset_id):
        raise HTTPException(status_code=422, detail="New optimization runs must use the project's active dataset.")


@router.post("/single-optimization/run", response_model=SingleOptimizationRunAccepted)
def run_project_single_optimization(
    project_id: UUID,
    request: SingleOptimizationRunRequest,
    project: dict[str, object] = Depends(authorize_project),
    repository: MongoWorkspaceRepository = Depends(get_scientific_repository),
) -> SingleOptimizationRunAccepted:
    _authorize_run_dataset(repository, project_id, request.dataset_id, project)
    if request.dispatch_strategy_status != REFERENCE_DISPATCH_STATUS:
        raise HTTPException(status_code=422, detail={"code": "MODIFIED_DISPATCH_NOT_CONNECTED", "message": "The modified dispatch strategy will be supported after scientific parity validation."})
    try:
        _, records, _ = load_dataset_records(request.dataset_id)
    except DatasetNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    job_id = single_job_manager.submit(request, records)
    accepted = SingleOptimizationRunAccepted(job_id=job_id, status="queued")
    repository.bind_project_job(project_id, request.dataset_id, accepted.job_id, "single")
    return accepted


@router.get("/single-optimization/jobs/{job_id}", response_model=SingleOptimizationJobResponse)
def get_project_single_job(project_id: UUID, job_id: str, _: dict[str, object] = Depends(authorize_project), repository: MongoWorkspaceRepository = Depends(get_scientific_repository)) -> SingleOptimizationJobResponse:
    try:
        repository.assert_project_job(project_id, job_id)
    except WorkspaceNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    try:
        return SingleOptimizationJobResponse(**single_job_manager.snapshot(job_id))
    except SingleJobNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/single-optimization/jobs/{job_id}/profiles", response_model=SingleOptimizationOperationalProfileResponse)
def get_project_single_profiles(project_id: UUID, job_id: str, date: str = Query(), _: dict[str, object] = Depends(authorize_project), repository: MongoWorkspaceRepository = Depends(get_scientific_repository)) -> SingleOptimizationOperationalProfileResponse:
    try:
        repository.assert_project_job(project_id, job_id)
    except WorkspaceNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return _single_optimization_profiles(job_id, date)


@router.post("/single-optimization/jobs/{job_id}/cancel", response_model=SingleOptimizationCancelResponse)
def cancel_project_single_job(project_id: UUID, job_id: str, _: dict[str, object] = Depends(authorize_project), repository: MongoWorkspaceRepository = Depends(get_scientific_repository)) -> SingleOptimizationCancelResponse:
    try:
        repository.assert_project_job(project_id, job_id)
    except WorkspaceNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    try:
        return SingleOptimizationCancelResponse(**single_job_manager.cancel(job_id))
    except SingleJobNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/comparison-optimization/run", response_model=ComparisonOptimizationRunAccepted)
def run_project_comparison(project_id: UUID, request: ComparisonOptimizationRunRequest, project: dict[str, object] = Depends(authorize_project), repository: MongoWorkspaceRepository = Depends(get_scientific_repository)) -> ComparisonOptimizationRunAccepted:
    _authorize_run_dataset(repository, project_id, request.dataset_id, project)
    if request.dispatch_strategy_status != REFERENCE_DISPATCH_STATUS:
        raise HTTPException(status_code=422, detail={"code": "MODIFIED_DISPATCH_NOT_CONNECTED", "message": "The modified dispatch strategy will be supported after scientific parity validation."})
    try:
        _, records, _ = load_dataset_records(request.dataset_id)
    except DatasetNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    job_id = comparison_job_manager.submit(request, records)
    accepted = ComparisonOptimizationRunAccepted(job_id=job_id, status="queued")
    repository.bind_project_job(project_id, request.dataset_id, accepted.job_id, "comparison")
    return accepted


@router.get("/comparison-optimization/jobs/{job_id}", response_model=ComparisonOptimizationJobResponse)
def get_project_comparison_job(project_id: UUID, job_id: str, _: dict[str, object] = Depends(authorize_project), repository: MongoWorkspaceRepository = Depends(get_scientific_repository)) -> ComparisonOptimizationJobResponse:
    try:
        repository.assert_project_job(project_id, job_id)
    except WorkspaceNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    try:
        return ComparisonOptimizationJobResponse(**comparison_job_manager.snapshot(job_id))
    except ComparisonJobNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/comparison-optimization/jobs/{job_id}/cancel", response_model=ComparisonOptimizationCancelResponse)
def cancel_project_comparison_job(project_id: UUID, job_id: str, _: dict[str, object] = Depends(authorize_project), repository: MongoWorkspaceRepository = Depends(get_scientific_repository)) -> ComparisonOptimizationCancelResponse:
    try:
        repository.assert_project_job(project_id, job_id)
    except WorkspaceNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    try:
        return ComparisonOptimizationCancelResponse(**comparison_job_manager.cancel(job_id))
    except ComparisonJobNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
