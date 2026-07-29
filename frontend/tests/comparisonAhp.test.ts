import assert from "node:assert/strict";
import test from "node:test";

import {
  canContinueWithAHP,
  resetAHPMatrix,
  sanitizeComparisonAHPState,
  updatePairwiseJudgment,
} from "../src/lib/comparisonAhp.ts";
import {
  readPersistedWorkspaceState,
  writePersistedWorkspaceState,
} from "../src/lib/workspacePersistence.ts";

const acceptableCalculation = {
  columnSums: [1, 1, 1, 1, 1, 1],
  normalizedMatrix: Array.from({ length: 6 }, () => Array(6).fill(1 / 6)),
  weights: Array(6).fill(1 / 6),
  lambdaMax: 6,
  consistencyIndex: 0,
  randomIndex: 1.24,
  consistencyRatio: 0,
  status: "ACCEPTABLE" as const,
};

test("changing an upper-triangle judgment updates its reciprocal", () => {
  const updated = updatePairwiseJudgment(resetAHPMatrix(), 0, 2, 7);
  assert.equal(updated[0][2], 7);
  assert.equal(updated[2][0], 1 / 7);
  assert.equal(updated[2][2], 1);
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
  const ahp = {
    matrix: resetAHPMatrix(),
    calculation: acceptableCalculation,
    accepted: true,
    revision: 3,
    calculatedAt: "2026-07-14T00:00:00.000Z",
  };
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

  writePersistedWorkspaceState(storage, workspace);
  assert.deepEqual(readPersistedWorkspaceState(storage)?.comparisonAhp, ahp);
  assert.equal(sanitizeComparisonAHPState({ ...ahp, matrix: [[1]] }), null);
});
