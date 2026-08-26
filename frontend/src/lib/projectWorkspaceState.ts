import type { PersistedWorkspaceState, WorkspaceDatasetSummary } from "../types/workspace.ts";

export function belongsToProject(state: PersistedWorkspaceState | null, projectId: string): boolean {
  return Boolean(state && (!state.projectId || state.projectId === projectId));
}

export function invalidateForActiveDataset(
  state: PersistedWorkspaceState,
  projectId: string,
  dataset: WorkspaceDatasetSummary,
): PersistedWorkspaceState {
  if (state.projectId && state.projectId !== projectId) {
    throw new Error("Workspace state belongs to another project.");
  }
  if (state.activeDatasetId === dataset.datasetId) {
    return { ...state, projectId, dataset };
  }
  return {
    ...state,
    projectId,
    activeDatasetId: dataset.datasetId,
    dataset,
    datasetExplorerDate: dataset.startDate,
    runState: {
      phase: "ready",
      jobId: null,
      latestJob: null,
      error: null,
      startedAt: null,
      finishedAt: null,
      reconnecting: false,
    },
    comparisonOptimization: state.comparisonOptimization
      ? { ...state.comparisonOptimization, stale: true }
      : null,
    comparisonAhp: state.comparisonAhp
      ? { ...state.comparisonAhp, accepted: false }
      : null,
    promethee: state.promethee ? { ...state.promethee, stale: true } : null,
  };
}

export function currentRecommendationBelongsToWorkspace(state: PersistedWorkspaceState): boolean {
  if (!state.promethee || state.promethee.stale || !state.comparisonOptimization || state.comparisonOptimization.stale) return false;
  return (!state.projectId || !state.promethee.projectId || state.projectId === state.promethee.projectId)
    && (!state.activeDatasetId || !state.promethee.datasetId || state.activeDatasetId === state.promethee.datasetId);
}
