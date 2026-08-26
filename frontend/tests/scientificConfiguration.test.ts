import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  batteryDisplayName,
  currentBatterySelectionId,
} from "../src/lib/batteryCatalogue.ts";
import {
  AHP_CRITERIA,
  DEFAULT_AHP_MATRIX,
  SCIENTIFIC_CONFIGURATION_VERSION,
} from "../src/lib/comparisonAhp.ts";

const optimizationSource = readFileSync(
  new URL("../src/pages/OptimizationPage.tsx", import.meta.url),
  "utf8",
);
const ahpSource = readFileSync(
  new URL("../src/pages/ComparisonAHPConfiguration.tsx", import.meta.url),
  "utf8",
);

test("current battery label is High while historical Medium-high renders compatibly", () => {
  assert.match(optimizationSource, /name: "High"/);
  assert.doesNotMatch(optimizationSource, /name: "Medium-high"/);
  assert.equal(batteryDisplayName("Medium-high"), "High");
  assert.equal(currentBatterySelectionId("medium-high"), "high");
});

test("five-criterion editor exposes ten upper-triangle judgments", () => {
  assert.equal(SCIENTIFIC_CONFIGURATION_VERSION, 3);
  assert.equal(AHP_CRITERIA.length, 5);
  assert.equal(DEFAULT_AHP_MATRIX.length, 5);
  assert.match(ahpSource, /10 pairwise judgments/);
  assert.doesNotMatch(ahpSource, /15 pairwise judgments/);
  assert.equal(AHP_CRITERIA.some((criterion) => criterion.id === "annual_om_cost_rs"), false);
});
