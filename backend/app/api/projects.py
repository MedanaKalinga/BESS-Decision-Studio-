"""Authenticated, owner-scoped project endpoints."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.api.auth import get_auth_repository, get_current_user
from app.schemas.projects import ProjectCreateRequest, ProjectResponse, ProjectUpdateRequest
from app.services.auth_project_service import MongoAuthProjectRepository, ProjectNotFoundError


router = APIRouter(prefix="/api/projects", tags=["projects"])


def _owner_id(user: dict[str, object]) -> str:
    return str(user["user_id"])


@router.post("", response_model=ProjectResponse, status_code=status.HTTP_201_CREATED)
def create_project(
    request: ProjectCreateRequest,
    user: dict[str, object] = Depends(get_current_user),
    repository: MongoAuthProjectRepository = Depends(get_auth_repository),
) -> dict[str, object]:
    return repository.create_project(_owner_id(user), request.name, request.description)


@router.get("", response_model=list[ProjectResponse])
def list_projects(
    user: dict[str, object] = Depends(get_current_user),
    repository: MongoAuthProjectRepository = Depends(get_auth_repository),
    include_archived: bool = Query(False),
) -> list[dict[str, object]]:
    return repository.list_projects(_owner_id(user), include_archived=include_archived)


@router.get("/{project_id}", response_model=ProjectResponse)
def get_project(
    project_id: UUID,
    user: dict[str, object] = Depends(get_current_user),
    repository: MongoAuthProjectRepository = Depends(get_auth_repository),
) -> dict[str, object]:
    try:
        return repository.get_project(project_id, _owner_id(user))
    except ProjectNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.put("/{project_id}", response_model=ProjectResponse)
def update_project(
    project_id: UUID,
    request: ProjectUpdateRequest,
    user: dict[str, object] = Depends(get_current_user),
    repository: MongoAuthProjectRepository = Depends(get_auth_repository),
) -> dict[str, object]:
    try:
        return repository.update_project(
            project_id,
            _owner_id(user),
            request.model_dump(exclude_unset=True),
        )
    except ProjectNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.delete("/{project_id}", response_model=ProjectResponse)
def archive_project(
    project_id: UUID,
    user: dict[str, object] = Depends(get_current_user),
    repository: MongoAuthProjectRepository = Depends(get_auth_repository),
) -> dict[str, object]:
    try:
        return repository.archive_project(project_id, _owner_id(user))
    except ProjectNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
