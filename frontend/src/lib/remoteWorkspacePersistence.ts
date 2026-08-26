import type {
  PersistedWorkspaceState,
  SingleOptimizationRunWorkspaceState,
  ComparisonRunWorkspaceState,
} from "../types/workspace.ts";

const WORKSPACE_ID_STORAGE_KEY = "bess-studio-anonymous-workspace-id";
const WORKSPACE_ENDPOINT = "/api/workspaces";
const TERMINAL_PHASES = new Set(["completed", "failed", "cancelled"]);

export type PersistenceStatus = "idle" | "saving" | "saved" | "failed";

export interface RemoteWorkspaceSnapshot {
  workspace_id: string;
  schema_version: number;
  revision: number;
  created_at: string;
  updated_at: string;
  state: PersistedWorkspaceState | Record<string, unknown>;
  persistence_status: "available";
}

export interface WorkspaceIdentity {
  workspaceId: string;
  connected: boolean;
}

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

function isUuid(value: string | null): value is string {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value));
}

function cloneWithoutRawData<T>(value: T): T {
  const forbidden = new Set([
    "rawCsv",
    "raw_csv",
    "csvContent",
    "csv_content",
    "fileContent",
    "file_content",
    "dayData",
    "day_data",
    "profilePoints",
    "profile_points",
    "points",
  ]);
  const visit = (candidate: unknown): unknown => {
    if (Array.isArray(candidate)) return candidate.map(visit);
    if (candidate && typeof candidate === "object") {
      return Object.fromEntries(
        Object.entries(candidate)
          .filter(([key]) => !forbidden.has(key))
          .map(([key, nested]) => [key, visit(nested)]),
      );
    }
    return candidate;
  };
  return visit(value) as T;
}

function terminalSingleRun(
  runState: SingleOptimizationRunWorkspaceState,
): SingleOptimizationRunWorkspaceState {
  if (TERMINAL_PHASES.has(runState.phase)) return cloneWithoutRawData(runState);
  return {
    phase: runState.phase,
    jobId: runState.jobId,
    latestJob: null,
    error: null,
    startedAt: runState.startedAt,
    finishedAt: null,
    reconnecting: false,
  };
}

function terminalComparisonRun(
  runState: ComparisonRunWorkspaceState,
): ComparisonRunWorkspaceState {
  if (TERMINAL_PHASES.has(runState.phase)) return cloneWithoutRawData(runState);
  return {
    ...runState,
    latestJob: null,
    error: null,
    reconnecting: false,
    maximumObservedProgressPercent: 0,
  };
}

export function getWorkspaceIdStorageKey(): string {
  return WORKSPACE_ID_STORAGE_KEY;
}

export async function ensureAnonymousWorkspaceId(
  storage: Storage | null,
  fetchImpl: FetchLike = fetch,
  createUuid: () => string = () => crypto.randomUUID(),
): Promise<WorkspaceIdentity> {
  const stored = storage?.getItem(WORKSPACE_ID_STORAGE_KEY) ?? null;
  if (isUuid(stored)) return { workspaceId: stored, connected: true };

  const candidate = createUuid();
  if (!isUuid(candidate)) throw new Error("Unable to create a valid workspace identifier.");
  storage?.setItem(WORKSPACE_ID_STORAGE_KEY, candidate);
  try {
    const response = await fetchImpl(WORKSPACE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ workspace_id: candidate }),
    });
    if (!response.ok) return { workspaceId: candidate, connected: false };
    const snapshot = await parseSnapshot(response);
    storage?.setItem(WORKSPACE_ID_STORAGE_KEY, snapshot.workspace_id);
    return { workspaceId: snapshot.workspace_id, connected: true };
  } catch {
    return { workspaceId: candidate, connected: false };
  }
}

export function buildRemoteWorkspaceState(
  state: PersistedWorkspaceState,
  persistenceRevision: number,
): PersistedWorkspaceState {
  return cloneWithoutRawData({
    ...state,
    persistenceRevision,
    updatedAt: new Date().toISOString(),
    runState: terminalSingleRun(state.runState),
    comparisonConfiguration: state.comparisonConfiguration?.savedAt
      ? state.comparisonConfiguration
      : null,
    comparisonRunState: terminalComparisonRun(state.comparisonRunState),
    comparisonAhp: state.comparisonAhp?.accepted ? state.comparisonAhp : null,
  });
}

export function remoteWorkspaceFingerprint(state: PersistedWorkspaceState): string {
  const meaningful = {
    dataset: state.dataset,
    datasetExplorerDate: state.datasetExplorerDate,
    dispatchStrategy: state.dispatchStrategy,
    battery: state.battery,
    setup: state.setup,
    runState: terminalSingleRun(state.runState),
    selectedBatteryId: state.selectedBatteryId,
    selectedMode: state.selectedMode,
    activeOptimizationStep: state.activeOptimizationStep,
    operationalProfileDate: state.operationalProfileDate,
    comparisonConfiguration: state.comparisonConfiguration?.savedAt
      ? state.comparisonConfiguration
      : null,
    comparisonRunState: terminalComparisonRun(state.comparisonRunState),
    comparisonOptimization: state.comparisonOptimization,
    comparisonAhp: state.comparisonAhp?.accepted ? state.comparisonAhp : null,
    promethee: state.promethee,
  };
  return JSON.stringify(cloneWithoutRawData(meaningful));
}

export function chooseNewerWorkspaceState(
  local: PersistedWorkspaceState | null,
  remote: PersistedWorkspaceState | null,
  remoteRevision: number,
): PersistedWorkspaceState | null {
  if (!local) return remote;
  if (!remote) return local;
  const localRevision = local.persistenceRevision ?? 0;
  return remoteRevision > localRevision ? remote : local;
}

export function isHydratableRemoteState(
  value: PersistedWorkspaceState | Record<string, unknown>,
): value is PersistedWorkspaceState {
  return Boolean(
    value
      && typeof value === "object"
      && value.version === 1
      && typeof value.activePage === "string"
      && value.dispatchStrategy
      && value.runState
      && value.comparisonRunState,
  );
}

export async function getRemoteWorkspace(
  workspaceId: string,
  fetchImpl: FetchLike = fetch,
): Promise<RemoteWorkspaceSnapshot | null> {
  const response = await fetchImpl(`${WORKSPACE_ENDPOINT}/${encodeURIComponent(workspaceId)}`, {
    headers: { Accept: "application/json" },
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("Workspace persistence is unavailable.");
  return parseSnapshot(response);
}

export async function saveRemoteWorkspace(
  workspaceId: string,
  state: PersistedWorkspaceState,
  expectedRevision: number,
  fetchImpl: FetchLike = fetch,
): Promise<RemoteWorkspaceSnapshot> {
  const send = () => fetchImpl(`${WORKSPACE_ENDPOINT}/${encodeURIComponent(workspaceId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      schema_version: 1,
      expected_revision: expectedRevision,
      state,
    }),
  });
  let response = await send();
  if (response.status === 404) {
    const createResponse = await fetchImpl(WORKSPACE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ workspace_id: workspaceId }),
    });
    if (!createResponse.ok) throw new Error("Workspace persistence is unavailable.");
    response = await send();
  }
  if (response.status === 409) throw new Error("Workspace revision conflict. Reload before retrying.");
  if (!response.ok) throw new Error("Workspace could not be saved.");
  return parseSnapshot(response);
}

async function parseSnapshot(response: Response): Promise<RemoteWorkspaceSnapshot> {
  const value: unknown = await response.json();
  if (!value || typeof value !== "object") throw new Error("Workspace response is invalid.");
  const candidate = value as Partial<RemoteWorkspaceSnapshot>;
  if (!isUuid(candidate.workspace_id ?? null) || typeof candidate.revision !== "number" || !candidate.state) {
    throw new Error("Workspace response is invalid.");
  }
  return candidate as RemoteWorkspaceSnapshot;
}
