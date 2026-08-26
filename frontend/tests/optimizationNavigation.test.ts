import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  parseApplicationRoute,
  projectOptimizationPath,
} from "../src/lib/appRouting.ts";
import {
  activeOptimizationMessage,
  activeOptimizationMode,
  comparisonDisabledReason,
  initialComparisonStep,
  nextComparisonStep,
  optimizationStepForSurface,
  previousComparisonStep,
} from "../src/lib/optimizationWorkflow.ts";

const availableDataset = {
  datasetId: "dataset-a",
  filename: "annual.csv",
  rowCount: 35_040,
  datasetType: "normal_year",
  status: "ready" as const,
  startDate: "2025-01-01",
  endDate: "2025-12-31",
  annualPvEnergyKwh: 1,
  annualEvEnergyKwh: 1,
  pvPeakKw: 1,
  evPeakKw: 1,
  intervalMinutes: 15,
  durationDays: 365,
  timestampsGenerated: false,
  notice: null,
  detectedColumns: { timestamp: "timestamp", pv: "pv", ev: "ev", tariff: null },
};

test("optimization routes restore modes and each Single workflow step", () => {
  assert.deepEqual(parseApplicationRoute("/projects/project-a/optimization"), {
    kind: "project",
    projectId: "project-a",
    surface: "optimization",
  });
  assert.equal(
    optimizationStepForSurface(
      parseApplicationRoute("/projects/project-a/optimization/single/configuration").kind === "project"
        ? "single-configuration"
        : "",
    ),
    "single-configuration",
  );
  assert.equal(projectOptimizationPath("project-a", "single-setup"), "/projects/project-a/optimization/single/setup");
  assert.equal(projectOptimizationPath("project-a", "comparison"), "/projects/project-a/optimization/comparison");
});

test("Comparison remains visible with exact disabled reasons", () => {
  assert.equal(comparisonDisabledReason({ projectId: null, projectLoading: false, dataset: null, runPhase: "ready" }), "Open a project first.");
  assert.equal(comparisonDisabledReason({ projectId: "p", projectLoading: true, dataset: null, runPhase: "ready" }), "Loading project data…");
  assert.equal(comparisonDisabledReason({ projectId: "p", projectLoading: false, dataset: null, runPhase: "ready" }), "Select or upload an active dataset first.");
  assert.equal(comparisonDisabledReason({ projectId: "p", projectLoading: false, dataset: { ...availableDataset, status: "expired" }, runPhase: "ready" }), "The active dataset is unavailable.");
  assert.equal(comparisonDisabledReason({ projectId: "p", projectLoading: false, dataset: availableDataset, runPhase: "running" }), "Comparison is already running.");
  assert.equal(comparisonDisabledReason({ projectId: "p", projectLoading: false, dataset: availableDataset, runPhase: "ready" }), null);
});

test("Comparison opens on step one and Back/Next move exactly one step", () => {
  assert.equal(initialComparisonStep("ready"), 0);
  assert.equal(initialComparisonStep("running"), 6);
  assert.equal(nextComparisonStep(0), 1);
  assert.equal(nextComparisonStep(3), 4);
  assert.equal(previousComparisonStep(4), 3);
  assert.equal(previousComparisonStep(1), 0);
});

test("mode cards and final review expose explicit non-submitting actions", () => {
  const optimizationSource = readFileSync(new URL("../src/pages/OptimizationPage.tsx", import.meta.url), "utf8");
  const comparisonSource = readFileSync(new URL("../src/pages/ComparisonOptimizationPage.tsx", import.meta.url), "utf8");
  assert.match(optimizationSource, /Configure Single Optimization/);
  assert.match(optimizationSource, /Configure Battery Comparison/);
  assert.match(comparisonSource, /Save & Continue/);
  assert.match(comparisonSource, />Back</);
  assert.match(comparisonSource, />Start Comparison</);
  assert.match(comparisonSource, /step === 5/);
  assert.doesNotMatch(comparisonSource, /<Dialog[\s>]/);
});

test("Single workflow exposes backward actions and restores saved setup values", () => {
  const configurationSource = readFileSync(new URL("../src/pages/SingleBatteryConfiguration.tsx", import.meta.url), "utf8");
  const setupSource = readFileSync(new URL("../src/pages/SingleOptimizationSetup.tsx", import.meta.url), "utf8");
  assert.match(configurationSource, /Back to mode selection/);
  assert.match(configurationSource, /initialConfiguration/);
  assert.match(setupSource, /initialSetup/);
  assert.match(setupSource, />Back</);
  assert.match(setupSource, />Start Optimization</);
});

test("one active optimization blocks a second run with a concise message", () => {
  assert.equal(activeOptimizationMode("running", "ready"), "single");
  assert.equal(activeOptimizationMessage("single"), "Single optimization is already running.");
  assert.equal(activeOptimizationMode("ready", "queued"), "comparison");
  assert.equal(activeOptimizationMessage("comparison"), "Battery comparison is already running.");
  assert.equal(activeOptimizationMode("completed", "completed"), null);
});

test("running-job navigation and submission guards remain connected", () => {
  const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  const optimizationSource = readFileSync(new URL("../src/pages/OptimizationPage.tsx", import.meta.url), "utf8");
  const singleRunSource = readFileSync(new URL("../src/pages/SingleOptimizationRun.tsx", import.meta.url), "utf8");
  const comparisonSource = readFileSync(new URL("../src/pages/ComparisonOptimizationPage.tsx", import.meta.url), "utf8");

  assert.match(appSource, /activeRunMode === "single" \? "single-run" : "comparison"/);
  assert.match(appSource, /title="View running optimization"/);
  assert.match(optimizationSource, /View Running Optimization/);
  assert.match(optimizationSource, /disabled=\{Boolean\(activeRunReason\)/);
  assert.match(singleRunSource, /if \(startBlockedReason\) return/);
  assert.match(comparisonSource, /startBlockedReason \|\| !canStartComparison/);
});
