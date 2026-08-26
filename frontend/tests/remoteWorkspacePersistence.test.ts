import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRemoteWorkspaceState,
  chooseNewerWorkspaceState,
  ensureAnonymousWorkspaceId,
  getWorkspaceIdStorageKey,
  remoteWorkspaceFingerprint,
} from "../src/lib/remoteWorkspacePersistence.ts";
import type { PersistedWorkspaceState } from "../src/types/workspace.ts";

const UUID = "123e4567-e89b-42d3-a456-426614174000";

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

function workspace(revision = 0): PersistedWorkspaceState {
  return {
    version: 1,
    persistenceRevision: revision,
    activePage: "Data Upload",
    dataset: null,
    dispatchStrategy: { status: "Reference Strategy", periods: [] },
    battery: null,
    setup: null,
    runState: { phase: "ready", jobId: null, latestJob: null, error: null, startedAt: null, finishedAt: null, reconnecting: false },
    selectedBatteryId: null,
    selectedMode: null,
    activeOptimizationStep: null,
    operationalProfileDate: null,
    datasetExplorerDate: null,
    comparisonAhp: null,
    comparisonConfiguration: null,
    comparisonRunState: { phase: "ready", jobId: null, submittedConfigurationRevision: null, submittedBatteryConfigurationRevision: null, submittedInputSignature: null, latestJob: null, maximumObservedProgressPercent: 0, error: null, startedAt: null, finishedAt: null, reconnecting: false },
    comparisonOptimization: null,
    promethee: null,
  };
}

function snapshotResponse(revision = 0) {
  return new Response(JSON.stringify({
    workspace_id: UUID,
    schema_version: 1,
    revision,
    created_at: "2026-07-20T00:00:00Z",
    updated_at: "2026-07-20T00:00:00Z",
    state: workspace(revision),
    persistence_status: "available",
  }), { status: 201, headers: { "Content-Type": "application/json" } });
}

test("anonymous workspace ID is created once and reused", async () => {
  const { storage } = memoryStorage();
  let requests = 0;
  const fetchImpl = async () => { requests += 1; return snapshotResponse(); };
  const first = await ensureAnonymousWorkspaceId(storage, fetchImpl, () => UUID);
  const second = await ensureAnonymousWorkspaceId(storage, fetchImpl, () => { throw new Error("must not create twice"); });
  assert.equal(first.workspaceId, UUID);
  assert.equal(second.workspaceId, UUID);
  assert.equal(storage.getItem(getWorkspaceIdStorageKey()), UUID);
  assert.equal(requests, 1);
});

test("newer backend snapshot hydrates while older backend data cannot replace newer local state", () => {
  const local = workspace(2);
  const remote = { ...workspace(4), selectedMode: "comparison" as const };
  assert.equal(chooseNewerWorkspaceState(local, remote, 4)?.selectedMode, "comparison");
  const newerLocal = { ...workspace(6), selectedMode: "single" as const };
  assert.equal(chooseNewerWorkspaceState(newerLocal, remote, 4)?.selectedMode, "single");
});

test("persistence failure retains the locally generated identity and does not erase local state", async () => {
  const { storage } = memoryStorage();
  const local = workspace(3);
  const identity = await ensureAnonymousWorkspaceId(
    storage,
    async () => { throw new Error("offline"); },
    () => UUID,
  );
  assert.equal(identity.connected, false);
  assert.equal(storage.getItem(getWorkspaceIdStorageKey()), UUID);
  assert.equal(chooseNewerWorkspaceState(local, null, 0), local);
});

test("remote snapshot strips raw CSV and day/profile point arrays", () => {
  const state = workspace();
  state.dataset = {
    datasetId: "dataset-id",
    filename: "annual.csv",
    rowCount: 35040,
    datasetType: "normal_year",
    status: "ready",
    startDate: "2025-01-01",
    endDate: "2025-12-31",
    annualPvEnergyKwh: 1,
    annualEvEnergyKwh: 2,
    pvPeakKw: 3,
    evPeakKw: 4,
    intervalMinutes: 15,
    durationDays: 365,
    timestampsGenerated: false,
    notice: null,
    detectedColumns: { timestamp: "timestamp", pv: "pv", ev: "ev", tariff: null },
    rawCsv: "secret",
    points: [{ pv_kw: 1 }],
  } as never;
  const remote = buildRemoteWorkspaceState(state, 0);
  const serialized = JSON.stringify(remote);
  assert.equal(serialized.includes("secret"), false);
  assert.equal(serialized.includes("rawCsv"), false);
  assert.equal(serialized.includes("points"), false);
});

test("polling progress does not change the meaningful remote fingerprint", () => {
  const first = workspace();
  first.runState = { ...first.runState, phase: "running", jobId: "job", latestJob: { sentinel: 1 } as never };
  const second = structuredClone(first);
  second.runState.latestJob = { sentinel: 99 } as never;
  second.runState.reconnecting = true;
  assert.equal(remoteWorkspaceFingerprint(first), remoteWorkspaceFingerprint(second));
});
