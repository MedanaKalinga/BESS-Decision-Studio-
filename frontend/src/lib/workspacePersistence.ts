import type {
  PersistedWorkspaceState,
  ComparisonRunWorkspaceState,
  SingleOptimizationFinalResult,
  SingleOptimizationRunWorkspaceState,
} from "../types/workspace";
import { sanitizeComparisonAHPState } from "./comparisonAhp.ts";
import {
  sanitizeComparisonOptimizationState,
  sanitizePrometheeWorkspaceState,
} from "./comparisonResults.ts";
import {
  expireComparisonRun,
  sanitizeComparisonConfiguration,
  sanitizeComparisonRunState,
} from "./comparisonOptimization.ts";

const WORKSPACE_STORAGE_KEY = "bess-studio-workspace-v1";

export interface WorkspaceRestoreResult {
  state: PersistedWorkspaceState | null;
  error: string | null;
}

export interface WorkspaceRestoreValidators {
  datasetExists: (datasetId: string, startDate: string) => Promise<boolean>;
  jobExists: (jobId: string) => Promise<boolean>;
  comparisonJobExists?: (jobId: string) => Promise<boolean>;
}

export function getWorkspaceStorageKey(): string {
  return WORKSPACE_STORAGE_KEY;
}

export function readPersistedWorkspaceState(
  storage: Storage | null,
): PersistedWorkspaceState | null {
  if (!storage) {
    return null;
  }

  try {
    const rawValue = storage.getItem(WORKSPACE_STORAGE_KEY);
    if (!rawValue) {
      return null;
    }

    const value = JSON.parse(rawValue) as Partial<PersistedWorkspaceState>;
    if (!value || value.version !== 1 || typeof value !== "object") {
      storage.removeItem(WORKSPACE_STORAGE_KEY);
      return null;
    }

    return {
      ...value,
      comparisonAhp: sanitizeComparisonAHPState(value.comparisonAhp),
      comparisonConfiguration: sanitizeComparisonConfiguration(value.comparisonConfiguration),
      comparisonRunState: sanitizeComparisonRunState(value.comparisonRunState),
      comparisonOptimization: sanitizeComparisonOptimizationState(
        value.comparisonOptimization,
      ),
      promethee: sanitizePrometheeWorkspaceState(value.promethee),
    } as PersistedWorkspaceState;
  } catch {
    storage.removeItem(WORKSPACE_STORAGE_KEY);
    return null;
  }
}

export function writePersistedWorkspaceState(
  storage: Storage | null,
  state: PersistedWorkspaceState,
): void {
  if (!storage) {
    return;
  }

  storage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(state));
}

export function clearPersistedWorkspaceState(storage: Storage | null): void {
  if (!storage) {
    return;
  }

  storage.removeItem(WORKSPACE_STORAGE_KEY);
}

export function buildPersistedWorkspaceState(
  state: Omit<PersistedWorkspaceState, "version">,
): PersistedWorkspaceState {
  return {
    ...state,
    version: 1,
  };
}

export async function validatePersistedWorkspaceState(
  state: PersistedWorkspaceState | null,
  validators: WorkspaceRestoreValidators,
): Promise<WorkspaceRestoreResult> {
  if (!state) {
    return { state: null, error: null };
  }

  if (state.dataset?.datasetId) {
    const datasetExists = await validators.datasetExists(
      state.dataset.datasetId,
      state.dataset.startDate,
    );
    if (!datasetExists) {
      return {
        state: null,
        error:
          "Dataset session is no longer available. Please upload the CSV again.",
      };
    }
  }

  if (state.runState.jobId) {
    const jobExists = await validators.jobExists(state.runState.jobId);
    if (!jobExists) {
      const expiredRunState: SingleOptimizationRunWorkspaceState = {
        phase: "ready",
        jobId: null,
        latestJob: null,
        error: {
          code: "JOB_EXPIRED",
          message:
            "Optimization job session expired because the backend was restarted. Please run the optimization again.",
        },
        startedAt: null,
        finishedAt: null,
        reconnecting: false,
      };

      return {
        state: {
          ...state,
          runState: expiredRunState,
        },
        error:
          "Optimization job session expired because the backend was restarted. Please run the optimization again.",
      };
    }
  }

  const comparisonRun = state.comparisonRunState;
  if (comparisonRun.jobId && ["queued", "running", "cancelling", "submitting"].includes(comparisonRun.phase)) {
    const comparisonJobExists = validators.comparisonJobExists
      ? await validators.comparisonJobExists(comparisonRun.jobId)
      : true;
    if (!comparisonJobExists) {
      const expiredRunState: ComparisonRunWorkspaceState = expireComparisonRun(comparisonRun);
      return {
        state: { ...state, comparisonRunState: expiredRunState },
        error: "Comparison job expired. The saved configuration is still available and can be rerun.",
      };
    }
  }

  return { state, error: null };
}

export function shouldRenderOperationalProfiles(
  result: SingleOptimizationFinalResult | null,
): boolean {
  if (!result) {
    return false;
  }

  const capacity = Number(result.best_bess_capacity_kwh);
  const peakSupport = Number(result.best_peak_support_pct);

  return (
    Number.isFinite(capacity) &&
    Number.isFinite(peakSupport) &&
    capacity > 0 &&
    peakSupport >= 0
  );
}
