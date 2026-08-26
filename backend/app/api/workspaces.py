"""Minimal anonymous-workspace persistence endpoints."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status

from app.config.mongodb import (
    PersistenceUnavailableError,
    mongo_persistence,
)
from app.schemas.workspaces import (
    WorkspaceCreateRequest,
    WorkspaceSnapshotResponse,
    WorkspaceUpdateRequest,
)
from app.services.workspace_persistence_service import (
    MongoWorkspaceRepository,
    WorkspaceNotFoundError,
    WorkspacePayloadError,
    WorkspaceRevisionConflictError,
)


router = APIRouter(prefix="/api/workspaces", tags=["workspaces"])


def get_workspace_repository() -> MongoWorkspaceRepository:
    try:
        return mongo_persistence.repository()
    except PersistenceUnavailableError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Workspace persistence is temporarily unavailable.",
        ) from exc


@router.post("", response_model=WorkspaceSnapshotResponse, status_code=status.HTTP_201_CREATED)
def create_workspace(
    request: WorkspaceCreateRequest | None = None,
    repository: MongoWorkspaceRepository = Depends(get_workspace_repository),
) -> dict[str, object]:
    return repository.create_workspace(request.workspace_id if request else None)


@router.get("/{workspace_id}", response_model=WorkspaceSnapshotResponse)
def get_workspace(
    workspace_id: UUID,
    repository: MongoWorkspaceRepository = Depends(get_workspace_repository),
) -> dict[str, object]:
    try:
        return repository.get_workspace(workspace_id)
    except WorkspaceNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Workspace was not found.") from exc


@router.put("/{workspace_id}", response_model=WorkspaceSnapshotResponse)
def update_workspace(
    workspace_id: UUID,
    request: WorkspaceUpdateRequest,
    repository: MongoWorkspaceRepository = Depends(get_workspace_repository),
) -> dict[str, object]:
    try:
        return repository.update_workspace(
            workspace_id,
            request.state,
            schema_version=request.schema_version,
            expected_revision=request.expected_revision,
        )
    except WorkspaceNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Workspace was not found.") from exc
    except WorkspaceRevisionConflictError as exc:
        raise HTTPException(status_code=409, detail="Workspace revision conflict.") from exc
    except WorkspacePayloadError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
