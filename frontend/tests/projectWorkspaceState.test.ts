import assert from "node:assert/strict";
import test from "node:test";

import { getProjectWorkspaceStorageKey, readPersistedWorkspaceState, writePersistedWorkspaceState } from "../src/lib/workspacePersistence.ts";
import { belongsToProject, currentRecommendationBelongsToWorkspace, invalidateForActiveDataset } from "../src/lib/projectWorkspaceState.ts";
import type { PersistedWorkspaceState, WorkspaceDatasetSummary } from "../src/types/workspace.ts";

function dataset(id: string): WorkspaceDatasetSummary {
  return {
    datasetId: id, filename: `${id}.csv`, rowCount: 96, datasetType: "partial", status: "ready",
    startDate: "2025-01-01", endDate: "2025-01-01", annualPvEnergyKwh: 10,
    annualEvEnergyKwh: 12, pvPeakKw: 2, evPeakKw: 3, intervalMinutes: 15,
    durationDays: 1, timestampsGenerated: false, notice: null,
    detectedColumns: { timestamp: "timestamp", pv: "pv", ev: "ev", tariff: null },
  };
}

function workspace(projectId: string, datasetId: string): PersistedWorkspaceState {
  return {
    version: 1, projectId, activeDatasetId: datasetId, activePage: "Dashboard", dataset: dataset(datasetId),
    dispatchStrategy: { status: "Reference Strategy", periods: [] }, battery: null, setup: null,
    runState: { phase: "completed", jobId: "job-a", latestJob: null, error: null, startedAt: null, finishedAt: null, reconnecting: false },
    selectedBatteryId: null, selectedMode: null, activeOptimizationStep: null, operationalProfileDate: null,
    datasetExplorerDate: "2025-01-01",
    comparisonAhp: null, comparisonConfiguration: null,
    comparisonRunState: { phase: "ready", jobId: null, submittedConfigurationRevision: null, submittedBatteryConfigurationRevision: null, submittedInputSignature: null, latestJob: null, maximumObservedProgressPercent: 0, error: null, startedAt: null, finishedAt: null, reconnecting: false },
    comparisonOptimization: null, promethee: null,
  };
}

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

test("project workspaces use distinct browser fallback keys", () => {
  const storage = new MemoryStorage();
  writePersistedWorkspaceState(storage, workspace("project-a", "dataset-a"), getProjectWorkspaceStorageKey("project-a"));
  writePersistedWorkspaceState(storage, workspace("project-b", "dataset-b"), getProjectWorkspaceStorageKey("project-b"));
  assert.equal(readPersistedWorkspaceState(storage, getProjectWorkspaceStorageKey("project-a"))?.dataset?.datasetId, "dataset-a");
  assert.equal(readPersistedWorkspaceState(storage, getProjectWorkspaceStorageKey("project-b"))?.dataset?.datasetId, "dataset-b");
});

test("a workspace from another project is rejected", () => {
  assert.equal(belongsToProject(workspace("project-a", "dataset-a"), "project-b"), false);
});

test("switching active dataset invalidates current scientific chain without deleting source history", () => {
  const source = workspace("project-a", "dataset-a");
  source.comparisonOptimization = { jobId: "comparison-a", status: "completed", revision: "rev-a", batteryConfigurationSignature: "b", inputSignature: "i", submittedConfigurationRevision: 1, submittedBatteryConfigurationRevision: 1, stale: false, finalResult: { battery_results: [], comparison_solution_status: "completed_all_batteries", feasible_battery_count: 0, infeasible_battery_count: 0 }, completedAt: "2025-01-01", projectId: "project-a", datasetId: "dataset-a" };
  source.promethee = { result: { scientific_status: "no_feasible_alternatives", accepted_ahp_revision: 1, criteria_order: [], criterion_directions: [], normalized_weights: [], raw_decision_matrix: [], observed_ranges: [], q_thresholds: [], p_thresholds: [], feasible_alternative_names: [], excluded_alternatives: [], criterion_preference_matrices: {}, aggregated_preference_matrix: [], positive_flows: [], negative_flows: [], net_flows: [], ordered_ranking: [], recommended_battery: null }, comparisonRevision: "rev-a", batteryConfigurationSignature: "b", ahpRevision: 1, calculatedAt: "2025-01-01", projectId: "project-a", datasetId: "dataset-a" };
  const next = invalidateForActiveDataset(source, "project-a", dataset("dataset-b"));
  assert.equal(next.activeDatasetId, "dataset-b");
  assert.equal(next.runState.phase, "ready");
  assert.equal(next.comparisonOptimization?.stale, true);
  assert.equal(next.promethee?.stale, true);
  assert.equal(source.comparisonOptimization.stale, false);
});

test("switching back does not revive a stale recommendation", () => {
  const stale = invalidateForActiveDataset(workspace("project-a", "dataset-a"), "project-a", dataset("dataset-b"));
  const switchedBack = invalidateForActiveDataset(stale, "project-a", dataset("dataset-a"));
  assert.equal(currentRecommendationBelongsToWorkspace(switchedBack), false);
});

test("project switching does not mutate an active backend job state", () => {
  const active = workspace("project-a", "dataset-a");
  active.runState = { ...active.runState, phase: "running", jobId: "active-job" };
  assert.equal(belongsToProject(active, "project-b"), false);
  assert.equal(active.runState.phase, "running");
  assert.equal(active.runState.jobId, "active-job");
});
