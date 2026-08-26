import assert from "node:assert/strict";
import test from "node:test";

import {
  DATASET_EXPIRED_MESSAGE,
  fetchDatasetDay,
  resolveDatasetExplorerDate,
} from "../src/lib/datasetWorkspace.ts";
import {
  readPersistedWorkspaceState,
  validatePersistedWorkspaceState,
  writePersistedWorkspaceState,
} from "../src/lib/workspacePersistence.ts";
import type { PersistedWorkspaceState, WorkspaceDatasetSummary } from "../src/types/workspace.ts";

const dataset: WorkspaceDatasetSummary = {
  datasetId: "dataset-1",
  filename: "annual.csv",
  rowCount: 35_040,
  datasetType: "normal_year",
  status: "ready",
  startDate: "2025-01-01",
  endDate: "2025-12-31",
  annualPvEnergyKwh: 7_200_000,
  annualEvEnergyKwh: 8_900_000,
  pvPeakKw: 1_240,
  evPeakKw: 1_510,
  intervalMinutes: 15,
  durationDays: 365,
  timestampsGenerated: false,
  notice: null,
  detectedColumns: { timestamp: "timestamp", pv: "pv_kw", ev: "ev_kw", tariff: null },
};

function workspace(): PersistedWorkspaceState {
  return {
    version: 1,
    activePage: "Data Upload",
    dataset,
    dispatchStrategy: { status: "Reference Strategy", periods: [] },
    battery: null,
    setup: null,
    runState: { phase: "ready", jobId: null, latestJob: null, error: null, startedAt: null, finishedAt: null, reconnecting: false },
    selectedBatteryId: null,
    selectedMode: "comparison",
    activeOptimizationStep: "mode-selection",
    operationalProfileDate: null,
    datasetExplorerDate: "2025-06-12",
    comparisonAhp: { sentinel: "ahp" } as never,
    comparisonConfiguration: null,
    comparisonRunState: { phase: "ready", jobId: null, submittedConfigurationRevision: null, submittedBatteryConfigurationRevision: null, submittedInputSignature: null, latestJob: null, maximumObservedProgressPercent: 0, error: null, startedAt: null, finishedAt: null, reconnecting: false },
    comparisonOptimization: null,
    promethee: { sentinel: "promethee" } as never,
  };
}

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    values,
    storage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    } as Storage,
  };
}

const dayPayload = {
  dataset_id: "dataset-1",
  date: "2025-06-12",
  interval_minutes: 15,
  points: [
    { timestamp: "2025-06-12T00:00:00", pv_kw: 0, ev_kw: 12, tariff_rs_per_kwh: null },
    { timestamp: "2025-06-12T00:15:00", pv_kw: 1.5, ev_kw: 10, tariff_rs_per_kwh: null },
  ],
  summary: { pv_energy_kwh: 0.375, ev_energy_kwh: 5.5, surplus_energy_kwh: 0, deficit_energy_kwh: 5.125, pv_peak_kw: 1.5, ev_peak_kw: 12 },
};

test("dataset metadata survives page unmount and remount through workspace persistence", () => {
  const { storage } = memoryStorage();
  writePersistedWorkspaceState(storage, workspace());
  const restored = readPersistedWorkspaceState(storage);
  assert.deepEqual(restored?.dataset, dataset);
});

test("the selected Day Explorer date survives navigation and remains in range", () => {
  const { storage } = memoryStorage();
  writePersistedWorkspaceState(storage, workspace());
  const restored = readPersistedWorkspaceState(storage);
  assert.equal(restored?.datasetExplorerDate, "2025-06-12");
  assert.equal(resolveDatasetExplorerDate(restored?.dataset ?? null, restored?.datasetExplorerDate ?? null), "2025-06-12");
});

test("a saved dataset ID and date trigger the existing day endpoint", async () => {
  let requestedUrl = "";
  await fetchDatasetDay("dataset-1", "2025-06-12", undefined, async (input) => {
    requestedUrl = String(input);
    return new Response(JSON.stringify(dayPayload), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  assert.equal(requestedUrl, "/api/datasets/dataset-1/day?date=2025-06-12");
});

test("day points restore the graph input after refetch", async () => {
  const restored = await fetchDatasetDay("dataset-1", "2025-06-12", undefined, async () =>
    new Response(JSON.stringify(dayPayload), { status: 200, headers: { "Content-Type": "application/json" } }));
  assert.deepEqual(restored.points, dayPayload.points);
  assert.equal(restored.summary.ev_energy_kwh, 5.5);
});

test("backend 404 marks only the dataset expired", async () => {
  const state = workspace();
  const result = await validatePersistedWorkspaceState(state, {
    datasetExists: async () => false,
    jobExists: async () => true,
  });
  assert.equal(result.error, DATASET_EXPIRED_MESSAGE);
  assert.equal(result.state?.dataset?.status, "expired");
  assert.equal(result.state?.dataset?.filename, "annual.csv");
  assert.equal(result.state?.comparisonAhp, state.comparisonAhp);
  assert.equal(result.state?.promethee, state.promethee);
  assert.equal(result.state?.runState, state.runState);
});

test("raw CSV content is never written to workspace storage", () => {
  const { storage, values } = memoryStorage();
  const state = workspace();
  state.dataset = { ...dataset, rawCsv: "timestamp,pv_kw,ev_kw\nsecret" } as WorkspaceDatasetSummary;
  writePersistedWorkspaceState(storage, state);
  const serialized = [...values.values()][0];
  assert.ok(serialized);
  assert.equal(serialized.includes("rawCsv"), false);
  assert.equal(serialized.includes("secret"), false);
});
