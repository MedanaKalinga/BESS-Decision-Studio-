import type { PersistedWorkspaceState } from "../types/workspace.ts";
import { isHydratableRemoteState } from "./remoteWorkspacePersistence.ts";

export interface ProjectWorkspaceSnapshot {
  project_id: string;
  schema_version: number;
  revision: number;
  created_at: string;
  updated_at: string;
  state: PersistedWorkspaceState | Record<string, unknown>;
  persistence_status: "available";
  legacy_import?: { workspace_id: string; imported_at: string } | null;
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export class ProjectWorkspaceRevisionConflictError extends Error {
  constructor() {
    super("Project workspace revision conflict.");
    this.name = "ProjectWorkspaceRevisionConflictError";
  }
}

async function getProjectScientificState(
  projectId: string,
  resource: "ahp-state" | "promethee-state",
  fetchImpl: FetchLike = fetch,
): Promise<Record<string, unknown> | null> {
  const response = await fetchImpl(
    `/api/projects/${encodeURIComponent(projectId)}/${resource}`,
    { credentials: "include", headers: { Accept: "application/json" } },
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Project scientific state request failed with HTTP ${response.status}.`);
  const payload: unknown = await response.json();
  return payload && typeof payload === "object"
    ? payload as Record<string, unknown>
    : null;
}

export function getProjectAHPState(
  projectId: string,
  fetchImpl: FetchLike = fetch,
): Promise<Record<string, unknown> | null> {
  return getProjectScientificState(projectId, "ahp-state", fetchImpl);
}

export function getProjectPrometheeState(
  projectId: string,
  fetchImpl: FetchLike = fetch,
): Promise<Record<string, unknown> | null> {
  return getProjectScientificState(projectId, "promethee-state", fetchImpl);
}

export async function getProjectWorkspace(projectId: string, fetchImpl: FetchLike = fetch): Promise<ProjectWorkspaceSnapshot> {
  const response = await fetchImpl(`/api/projects/${encodeURIComponent(projectId)}/workspace`, {
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    const detail = payload && typeof payload === "object" && "detail" in payload
      ? (payload as { detail: unknown }).detail
      : null;
    throw new Error(typeof detail === "string"
      ? detail
      : `Project workspace request failed with HTTP ${response.status}.`);
  }
  return parseProjectWorkspace(response, projectId);
}

export async function saveProjectWorkspace(
  projectId: string,
  state: PersistedWorkspaceState,
  expectedRevision: number,
  fetchImpl: FetchLike = fetch,
): Promise<ProjectWorkspaceSnapshot> {
  const response = await fetchImpl(`/api/projects/${encodeURIComponent(projectId)}/workspace`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ schema_version: 1, expected_revision: expectedRevision, state }),
  });
  if (response.status === 409) throw new ProjectWorkspaceRevisionConflictError();
  if (!response.ok) throw new Error("Project workspace could not be saved.");
  return parseProjectWorkspace(response, projectId);
}

export async function importLegacyWorkspace(projectId: string, workspaceId: string, fetchImpl: FetchLike = fetch): Promise<ProjectWorkspaceSnapshot> {
  const response = await fetchImpl(`/api/projects/${encodeURIComponent(projectId)}/workspace/import-legacy`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ workspace_id: workspaceId }),
  });
  if (!response.ok) throw new Error("Previous workspace could not be imported.");
  return parseProjectWorkspace(response, projectId);
}

async function parseProjectWorkspace(response: Response, projectId: string): Promise<ProjectWorkspaceSnapshot> {
  const value: unknown = await response.json();
  if (!value || typeof value !== "object") throw new Error("Project workspace response is invalid.");
  const snapshot = value as ProjectWorkspaceSnapshot;
  if (
    snapshot.project_id !== projectId
    || typeof snapshot.revision !== "number"
    || !snapshot.state
    || typeof snapshot.state !== "object"
  ) {
    throw new Error("Project workspace response is invalid.");
  }
  const partialState = snapshot.state as Record<string, unknown>;
  const validMinimalState = partialState.version === 1
    && partialState.projectId === projectId;
  if (!isHydratableRemoteState(snapshot.state) && !validMinimalState) {
    throw new Error("Project workspace state is invalid.");
  }
  return snapshot;
}
