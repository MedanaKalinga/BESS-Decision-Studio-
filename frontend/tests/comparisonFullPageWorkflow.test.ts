import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import {
  createDefaultComparisonConfiguration,
  reviseComparisonConfiguration,
} from "../src/lib/comparisonOptimization.ts";
import {
  canStartComparison,
  canVisitComparisonStep,
  comparisonErrorsForStep,
  comparisonStepAfterSave,
  initialComparisonStep,
  nextComparisonStep,
  previousComparisonStep,
} from "../src/lib/optimizationWorkflow.ts";
import {
  parseApplicationRoute,
  projectOptimizationPath,
} from "../src/lib/appRouting.ts";
import { getProjectWorkspaceStorageKey } from "../src/lib/workspacePersistence.ts";

const catalogue = ["Low-cost", "Medium-low", "Medium", "High"].map((name, index) => ({
  name,
  price_rs_per_kwh: 44_000 + index * 2_000,
  rated_cycle_life: 3_000 + index * 500,
  eta_ch: 0.92,
  eta_dis: 0.92,
  weight_density_kg_per_kwh: 8 - index * 0.4,
  warranty_years: 5 + index,
}));

const pageSource = readFileSync(
  new URL("../src/pages/ComparisonOptimizationPage.tsx", import.meta.url),
  "utf8",
);

test("Configure Battery Comparison maps to the dedicated project route", () => {
  const path = projectOptimizationPath("project-a", "comparison");
  assert.equal(path, "/projects/project-a/optimization/comparison");
  assert.deepEqual(parseApplicationRoute(path), {
    kind: "project",
    projectId: "project-a",
    surface: "comparison",
  });
});

test("the full-page workflow replaces the old Comparison dialog", () => {
  assert.equal(
    existsSync(new URL("../src/pages/ComparisonOptimizationDialog.tsx", import.meta.url)),
    false,
  );
  assert.match(pageSource, /Battery Comparison/);
  assert.match(pageSource, /Back to Optimization Modes/);
  assert.doesNotMatch(pageSource, /<Dialog[\s>]/);
});

test("Save and Back advance or return exactly one setup step", () => {
  assert.equal(nextComparisonStep(0), 1);
  assert.equal(nextComparisonStep(4), 5);
  assert.equal(previousComparisonStep(5), 4);
  assert.equal(previousComparisonStep(1), 0);
});

test("completed steps can be reopened while future steps remain gated", () => {
  const completed = new Set([0, 1, 2]);
  assert.equal(canVisitComparisonStep(1, 3, completed), true);
  assert.equal(canVisitComparisonStep(2, 1, completed), true);
  assert.equal(canVisitComparisonStep(4, 1, completed), false);
});

test("editing a section preserves all unrelated comparison values", () => {
  const initial = createDefaultComparisonConfiguration(catalogue);
  const edited = reviseComparisonConfiguration(initial, {
    maximumBessCapacityKwh: 7_000,
  });
  assert.equal(edited.maximumBessCapacityKwh, 7_000);
  assert.deepEqual(edited.batteries, initial.batteries);
  assert.deepEqual(edited.gaSettings, initial.gaSettings);
  assert.deepEqual(edited.economicSettings, initial.economicSettings);
});

test("step validation blocks invalid values without erasing the draft", () => {
  const errors = [
    "Maximum BESS capacity must be greater than the minimum and no more than 10,000 kWh.",
    "Population size must be a whole number of at least 4.",
  ];
  assert.deepEqual(comparisonErrorsForStep(errors, 1), [errors[0]]);
  assert.deepEqual(comparisonErrorsForStep(errors, 2), [errors[1]]);
  assert.equal(canStartComparison(5, false, errors), false);
});

test("opening the page cannot submit and duplicate active submission is blocked", () => {
  assert.equal(canStartComparison(0, false, []), false);
  assert.equal(canStartComparison(5, true, []), false);
  assert.equal(canStartComparison(5, false, []), true);
});

test("Review Edit returns to the selected section and saves back to Review", () => {
  assert.equal(comparisonStepAfterSave(0, true), 5);
  assert.equal(comparisonStepAfterSave(2, true), 5);
  for (const title of [
    "Battery Alternatives",
    "Search Bounds",
    "GA Settings",
    "Economic Settings",
    "Dispatch and Constraints",
    "Dataset and Project",
  ]) {
    assert.match(pageSource, new RegExp(title));
  }
});

test("active runs and refreshed drafts restore the correct workflow step", () => {
  assert.equal(initialComparisonStep("running", 2), 6);
  assert.equal(initialComparisonStep("queued", 0), 6);
  assert.equal(initialComparisonStep("ready", 4), 4);
  assert.equal(initialComparisonStep("ready", 99), 0);
});

test("project-scoped draft storage cannot collide across projects", () => {
  assert.notEqual(
    getProjectWorkspaceStorageKey("project-a"),
    getProjectWorkspaceStorageKey("project-b"),
  );
});

test("navigation away is separate from cancellation and mobile actions remain reachable", () => {
  assert.match(pageSource, /Leave Page \/ View Dashboard/);
  assert.match(pageSource, /Cancel Run/);
  assert.match(pageSource, /position: "sticky"/);
  assert.match(pageSource, /direction=\{\{ xs: "column", sm: "row" \}\}/);
});
