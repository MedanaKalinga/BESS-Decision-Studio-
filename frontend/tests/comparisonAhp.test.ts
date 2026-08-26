import assert from "node:assert/strict";
import test from "node:test";

import {
  AHP_CRITERIA,
  DEFAULT_AHP_MATRIX,
  SCIENTIFIC_CONFIGURATION_VERSION,
  canContinueWithAHP,
  linkAHPStateToComparison,
  resetAHPMatrix,
  sanitizeComparisonAHPState,
  updatePairwiseJudgment,
} from "../src/lib/comparisonAhp.ts";
import { readFileSync } from "node:fs";
import {
  getProjectWorkspaceStorageKey,
  readPersistedWorkspaceState,
  writePersistedWorkspaceState,
} from "../src/lib/workspacePersistence.ts";

const acceptableCalculation = {
  columnSums: [2.783333333333333, 3.0833333333333335, 11, 7.5, 12],
  normalizedMatrix: Array.from({ length: 5 }, () => Array(5).fill(1 / 5)),
  weights: [0.37278175835062066, 0.3127817583506206, 0.09569543958765515, 0.13456634642263382, 0.08417469728846974],
  lambdaMax: 5.069277703367374,
  consistencyIndex: 0.017319425841843428,
  randomIndex: 1.12,
  consistencyRatio: 0.015463773073074488,
  status: "ACCEPTABLE" as const,
};

test("changing an upper-triangle judgment updates its reciprocal", () => {
  const updated = updatePairwiseJudgment(resetAHPMatrix(), 0, 2, 4);
  assert.equal(updated[0][2], 4);
  assert.equal(updated[2][0], 0.25);
  assert.equal(updated[2][2], 1);
  const reciprocal = updatePairwiseJudgment(updated, 1, 4, 1 / 3);
  assert.equal(reciprocal[1][4], 1 / 3);
  assert.equal(reciprocal[4][1], 3);
  assert.ok(reciprocal.every((row, index) => row[index] === 1));
});

test("v3 exposes five criteria, ten unique judgments, and the exact default matrix", () => {
  assert.equal(AHP_CRITERIA.length, 5);
  assert.equal(AHP_CRITERIA.length * (AHP_CRITERIA.length - 1) / 2, 10);
  assert.deepEqual(DEFAULT_AHP_MATRIX, [
    [1, 1, 4, 3, 5],
    [1, 1, 4, 2, 3],
    [1 / 4, 1 / 4, 1, 1, 1],
    [1 / 3, 1 / 2, 1, 1, 2],
    [1 / 5, 1 / 3, 1, 1 / 2, 1],
  ]);
  assert.equal(AHP_CRITERIA.some((criterion) => criterion.id === "annual_om_cost_rs"), false);
});

test("reset returns a fresh copy of the default matrix", () => {
  const first = resetAHPMatrix();
  const second = resetAHPMatrix();
  first[0][1] = 9;
  assert.equal(second[0][1], 1);
});

test("consistency and request state govern Continue", () => {
  assert.equal(canContinueWithAHP(acceptableCalculation, false, null), true);
  assert.equal(canContinueWithAHP({ ...acceptableCalculation, status: "REVIEW REQUIRED", consistencyRatio: 0.2 }, false, null), false);
  assert.equal(canContinueWithAHP(acceptableCalculation, true, null), false);
  assert.equal(canContinueWithAHP(acceptableCalculation, false, "offline"), false);
});

test("accepted AHP state survives workspace persistence and invalid state is discarded", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  } as Storage;
  const ahp = linkAHPStateToComparison({
    matrix: resetAHPMatrix(),
    calculation: acceptableCalculation,
    accepted: true,
    revision: 3,
    calculatedAt: "2026-07-14T00:00:00.000Z",
    acceptedAt: "2026-07-14T00:01:00.000Z",
    scientificConfigurationVersion: SCIENTIFIC_CONFIGURATION_VERSION,
  }, {
    projectId: "project-a",
    datasetId: "dataset-a",
    comparisonRevision: "comparison-7",
  });
  const workspace = {
    version: 1,
    activePage: "Optimization",
    dataset: null,
    dispatchStrategy: { status: "Reference Strategy", periods: [] },
    battery: null,
    setup: null,
    runState: { phase: "ready", jobId: null, latestJob: null, error: null, startedAt: null, finishedAt: null, reconnecting: false },
    selectedBatteryId: null,
    selectedMode: "comparison",
    activeOptimizationStep: "comparison-ahp",
    operationalProfileDate: null,
    comparisonAhp: ahp,
  } as const;

  const projectKey = getProjectWorkspaceStorageKey("project-a");
  writePersistedWorkspaceState(storage, workspace, projectKey);
  const restored = readPersistedWorkspaceState(storage, projectKey);
  assert.deepEqual(restored?.comparisonAhp, ahp);
  assert.equal(restored?.comparisonAhp?.accepted, true);
  assert.equal(restored?.comparisonAhp?.acceptedAt, "2026-07-14T00:01:00.000Z");
  assert.equal(restored?.comparisonAhp?.projectId, "project-a");
  assert.equal(restored?.comparisonAhp?.linkedDatasetId, "dataset-a");
  assert.equal(restored?.comparisonAhp?.linkedComparisonRevision, "comparison-7");
  assert.equal(readPersistedWorkspaceState(storage, getProjectWorkspaceStorageKey("project-b"))?.comparisonAhp, undefined);
  assert.equal(sanitizeComparisonAHPState({ ...ahp, matrix: [[1]] }), null);
});

test("legacy six-criterion AHP remains preserved but is incompatible and unaccepted", () => {
  const legacy = sanitizeComparisonAHPState({
    matrix: Array.from({ length: 6 }, () => Array(6).fill(1)),
    calculation: {
      columnSums: Array(6).fill(6),
      normalizedMatrix: Array.from({ length: 6 }, () => Array(6).fill(1 / 6)),
      weights: Array(6).fill(1 / 6),
      lambdaMax: 6,
      consistencyIndex: 0,
      randomIndex: 1.24,
      consistencyRatio: 0,
      status: "ACCEPTABLE",
    },
    accepted: true,
    revision: 2,
    calculatedAt: "2026-01-01T00:00:00.000Z",
  });
  assert.equal(legacy?.matrix.length, 6);
  assert.equal(legacy?.accepted, false);
  assert.equal(legacy?.incompatible, true);
  assert.match(legacy?.incompatibilityReason ?? "", /five-criterion model/);
});

test("AHP page does not let Strict Mode cleanup overwrite accepted state", () => {
  const source = readFileSync(
    new URL("../src/pages/ComparisonAHPConfiguration.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /calculatedInputKey/);
  assert.match(source, /controller\.signal\.aborted && !timedOut/);
  assert.doesNotMatch(source, /skipInitialCalculation/);
});
