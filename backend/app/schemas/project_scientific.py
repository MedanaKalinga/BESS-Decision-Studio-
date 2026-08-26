"""Contracts for owner-scoped project scientific persistence."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class ProjectWorkspaceUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: int = Field(default=1, ge=1)
    expected_revision: int | None = Field(default=None, ge=0)
    state: dict[str, Any]


class ProjectWorkspaceResponse(BaseModel):
    project_id: UUID
    schema_version: int
    revision: int
    created_at: datetime
    updated_at: datetime
    state: dict[str, Any]
    persistence_status: str
    legacy_import: dict[str, Any] | None = None


class ProjectDatasetResponse(BaseModel):
    dataset_id: UUID
    project_id: UUID
    filename: str
    label: str | None = None
    uploaded_at: datetime
    last_used_at: datetime | None = None
    row_count: int
    start_date: str
    end_date: str
    summary: dict[str, Any]
    detected_columns: dict[str, Any] | None = None
    fingerprint: str | None = None
    status: str


class LegacyWorkspaceImportRequest(BaseModel):
    workspace_id: UUID


class ActiveDatasetResponse(BaseModel):
    active_dataset_id: UUID | None


class ProjectOptimizationRunResponse(BaseModel):
    run_id: str
    job_id: str
    project_id: UUID
    dataset_id: str | None = None
    mode: str
    lifecycle_status: str
    scientific_status: str | None = None
    submitted_configuration: dict[str, Any] | None = None
    result: dict[str, Any] | None = None
    created_at: int | float | datetime | str | None = None
    completed_at: int | float | datetime | str | None = None
    updated_at: int | float | datetime | str | None = None
    error: dict[str, Any] | str | None = None
