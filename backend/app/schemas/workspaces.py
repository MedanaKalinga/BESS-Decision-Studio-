"""API contracts for anonymous persisted workspaces."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class WorkspaceCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    workspace_id: UUID | None = None


class WorkspaceUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: int = Field(default=1, ge=1)
    expected_revision: int | None = Field(default=None, ge=0)
    state: dict[str, Any]


class WorkspaceSnapshotResponse(BaseModel):
    workspace_id: UUID
    schema_version: int
    revision: int
    created_at: datetime
    updated_at: datetime
    state: dict[str, Any]
    persistence_status: Literal["available"] = "available"
