import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  parseApplicationRoute,
  projectOptimizationPath,
} from "../src/lib/appRouting.ts";
import {
  PROMETHEE_CRITERIA_ORDER,
  buildPrometheeWorkflowHeaders,
  canEnterComparisonResults,
  comparisonRankingEligibility,
  findRecommendedStageOneResult,
  hasPrometheePrerequisites,
  isAHPCurrent,
  isComparisonCurrent,
  isPrometheeResultStale,
  mapComparisonToPrometheeRequest,
} from "../src/lib/comparisonResults.ts";
import { canContinueWithAHP, resetAHPMatrix } from "../src/lib/comparisonAhp.ts";
import type {
  ComparisonAHPWorkspaceState,
  ComparisonBatteryResult,
  ComparisonOptimizationWorkspaceState,
  PrometheeWorkspaceState,
} from "../src/types/workspace.ts";

const pageSource = readFileSync(
  new URL("../src/pages/ComparisonOptimizationPage.tsx", import.meta.url),
  "utf8",
);
const ahpSource = readFileSync(
  new URL("../src/pages/ComparisonAHPConfiguration.tsx", import.meta.url),
  "utf8",
);
const resultsSource = readFileSync(
  new URL("../src/pages/ComparisonResultsPage.tsx", import.meta.url),
  "utf8",
);
const recommendationSource = readFileSync(
  new URL("../src/pages/ComparisonRecommendationPage.tsx", import.meta.url),
  "utf8",
);

function battery(name: string, capacity: number, feasible = true): ComparisonBatteryResult {
  return {
    battery_name: name,
    input_battery_configuration: {
      name,
      price_rs_per_kwh: 44_000,
      rated_cycle_life: 3_000,
      eta_ch: 0.92,
      eta_dis: 0.92,
      weight_density_kg_per_kwh: 8.5,
      warranty_years: 5,
    },
    best_bess_capacity_kwh: capacity,
    best_peak_support_pct: 32,
    best_total_annual_cost_rs: 150_000_000 + capacity,
    best_fitness_rs: feasible ? 150_000_000 + capacity : 950_000_000,
    solution_status: feasible ? "feasible_solution" : "no_feasible_candidate",
    solution_message: feasible ? "Feasible" : "No feasible candidate",
    ga_generations_completed: 3,
    total_fitness_evaluations: 18,
    runtime_seconds: 1,
    cycle_based_life_years: 8.4,
    equivalent_cycles_per_year: 357.2,
    round_trip_efficiency: 0.8464,
    weight_density_kg_per_kwh: 8.5,
    warranty_years: 5,
    annual_om_cost_rs: 1_500_000,
    failed_constraints: feasible ? [] : ["peak_support"],
    total_penalty_rs: feasible ? 0 : 800_000_000,
    is_feasible: feasible,
    peak_support_success_pct: feasible ? 96 : 52,
    pv_self_consumption_pct: feasible ? 44 : 35,
    replacement_years: [9, 18],
  };
}

function comparison(results = [
  battery("Low-cost", 3_100),
  battery("Medium-low", 3_400),
  battery("Medium", 3_700),
  battery("High", 4_000, false),
]): ComparisonOptimizationWorkspaceState {
  return {
    jobId: "comparison-job",
    status: "completed",
    revision: "comparison-revision-7",
    batteryConfigurationSignature: "battery-signature",
    inputSignature: "comparison-input",
    submittedConfigurationRevision: 7,
    submittedBatteryConfigurationRevision: 4,
    stale: false,
    finalResult: {
      battery_results: results,
      comparison_solution_status: results.every((entry) => entry.is_feasible)
        ? "completed_all_batteries"
        : "completed_with_infeasible_alternatives",
      feasible_battery_count: results.filter((entry) => entry.is_feasible).length,
      infeasible_battery_count: results.filter((entry) => !entry.is_feasible).length,
    },
    completedAt: "2026-07-30T10:00:00.000Z",
    projectId: "project-a",
    datasetId: "dataset-a",
  };
}

function ahp(accepted = true): ComparisonAHPWorkspaceState {
  return {
    matrix: resetAHPMatrix(),
    calculation: {
      columnSums: [1, 1, 1, 1, 1],
      normalizedMatrix: Array.from({ length: 5 }, () => Array(5).fill(1 / 5)),
      weights: [0.37278176, 0.31278176, 0.09569544, 0.13456635, 0.08417470],
      lambdaMax: 5.069277703,
      consistencyIndex: 0.017319426,
      randomIndex: 1.12,
      consistencyRatio: 0.015463773,
      status: "ACCEPTABLE",
    },
    accepted,
    revision: 5,
    calculatedAt: "2026-07-30T10:05:00.000Z",
    projectId: "project-a",
    linkedDatasetId: "dataset-a",
    linkedComparisonRevision: "comparison-revision-7",
  };
}

const context = { projectId: "project-a", datasetId: "dataset-a" };

test("AHP and Results use reliable project routes", () => {
  assert.equal(
    projectOptimizationPath("project-a", "comparison-ahp"),
    "/projects/project-a/optimization/comparison/ahp",
  );
  assert.equal(
    projectOptimizationPath("project-a", "comparison-recommendation"),
    "/projects/project-a/optimization/comparison/recommendation",
  );
  assert.equal(
    projectOptimizationPath("project-a", "comparison-results"),
    "/projects/project-a/optimization/comparison/results",
  );
  assert.equal(
    parseApplicationRoute("/projects/project-a/optimization/comparison/ahp").kind,
    "project",
  );
  assert.deepEqual(
    parseApplicationRoute("/projects/project-a/optimization/comparison/recommendation"),
    { kind: "project", projectId: "project-a", surface: "comparison-recommendation" },
  );
  assert.deepEqual(
    parseApplicationRoute("/projects/project-a/optimization/comparison/results"),
    { kind: "project", projectId: "project-a", surface: "comparison-results" },
  );
});

test("completed Comparison exposes every canonical optimized capacity", () => {
  const completed = comparison();
  assert.deepEqual(
    completed.finalResult.battery_results.map((entry) => entry.best_bess_capacity_kwh),
    [3_100, 3_400, 3_700, 4_000],
  );
  assert.match(pageSource, /Comparison Summary/);
  assert.match(pageSource, /Optimized Capacity/);
  assert.match(pageSource, /equivalent_cycles_per_year/);
  assert.match(pageSource, /pv_self_consumption_pct/);
  assert.match(pageSource, /peak_support_success_pct/);
});

test("completed current Comparison exposes Configure AHP and first PROMETHEE actions", () => {
  assert.match(pageSource, /Continue to AHP/);
  assert.match(pageSource, /Continue Final Ranking/);
  assert.equal(isComparisonCurrent(comparison(), context), true);
  assert.equal(canEnterComparisonResults(comparison(), ahp(), context), true);
});

test("accepted AHP is current only for its linked project, dataset, and comparison", () => {
  const completed = comparison();
  assert.equal(isAHPCurrent(ahp(), completed, context), true);
  assert.equal(isAHPCurrent({ ...ahp(), linkedDatasetId: "dataset-b" }, completed, context), false);
  assert.equal(isAHPCurrent({ ...ahp(), linkedComparisonRevision: "old" }, completed, context), false);
  assert.equal(isAHPCurrent({ ...ahp(), projectId: "project-b" }, completed, context), false);
});

test("CR above 0.10 blocks AHP acceptance and continuation", () => {
  const inconsistent = { ...ahp().calculation!, consistencyRatio: 0.11, status: "REVIEW REQUIRED" as const };
  assert.equal(canContinueWithAHP(inconsistent, false, null), false);
  assert.equal(canContinueWithAHP(ahp().calculation, false, null), true);
  assert.match(ahpSource, /Accept AHP and Calculate Final Ranking/);
  assert.match(ahpSource, /Calculate Final Ranking/);
  assert.match(ahpSource, /Back to Comparison Summary/);
});

test("first PROMETHEE calculation needs current Comparison and AHP, not an existing ranking", () => {
  const completed = comparison();
  const accepted = ahp();
  assert.equal(canEnterComparisonResults(completed, accepted, context), true);
  assert.equal(hasPrometheePrerequisites(completed, accepted, context), true);
  assert.match(recommendationSource, /stage !== "ahp_accepted"/);
  assert.match(recommendationSource, /window\.setTimeout\(\(\) => void calculate\(\), 0\)/);
});

test("PROMETHEE request preserves exact criteria, accepted weights, and feasible alternatives only", () => {
  const request = mapComparisonToPrometheeRequest(comparison(), ahp());
  assert.deepEqual(PROMETHEE_CRITERIA_ORDER, [
    "total_annual_cost_Rs",
    "cycle_based_life_years",
    "round_trip_efficiency",
    "weight_density_kg_per_kwh",
    "warranty_years",
  ]);
  assert.deepEqual(request.ahp_weights, ahp().calculation?.weights);
  assert.equal(request.alternatives.length, 3);
  assert.ok(request.alternatives.every((entry) => entry.is_feasible));
  assert.deepEqual(
    buildPrometheeWorkflowHeaders(context, "comparison-revision-7", 5),
    {
      "X-Project-ID": "project-a",
      "X-Dataset-ID": "dataset-a",
      "X-Comparison-Revision": "comparison-revision-7",
      "X-AHP-Revision": "5",
    },
  );
});

test("one and zero feasible alternatives produce diagnostic eligibility states", () => {
  assert.equal(
    comparisonRankingEligibility(comparison([battery("Only", 3_200)])),
    "insufficient_feasible_alternatives",
  );
  assert.equal(
    comparisonRankingEligibility(comparison([battery("None", 500, false)])),
    "no_feasible_alternatives",
  );
  assert.match(recommendationSource, /Only One Feasible Alternative/);
  assert.match(recommendationSource, /No Feasible Alternatives/);
});

test("final recommendation reuses the winning battery's GA-optimized capacity", () => {
  const completed = comparison();
  const result = {
    scientific_status: "ranking_completed" as const,
    accepted_ahp_revision: 5,
    criteria_order: [...PROMETHEE_CRITERIA_ORDER],
    criterion_directions: ["minimize", "maximize", "maximize", "minimize", "maximize"] as const,
    normalized_weights: [...ahp().calculation!.weights],
    raw_decision_matrix: [],
    observed_ranges: [0, 0, 0, 0, 0],
    q_thresholds: [0, 0, 0, 0, 0],
    p_thresholds: [1, 1, 1, 1, 1],
    feasible_alternative_names: ["Low-cost", "Medium-low", "Medium"],
    excluded_alternatives: [],
    criterion_preference_matrices: {},
    aggregated_preference_matrix: [],
    positive_flows: [0.1, 0.5, 0.2],
    negative_flows: [0.2, 0.1, 0.3],
    net_flows: [-0.1, 0.4, -0.1],
    ordered_ranking: [
      { battery_name: "Medium-low", rank: 1, positive_flow: 0.5, negative_flow: 0.1, net_flow: 0.4 },
    ],
    recommended_battery: "Medium-low",
  };
  const winner = findRecommendedStageOneResult(result, completed);
  assert.equal(winner?.best_bess_capacity_kwh, 3_400);
  assert.equal(winner, completed.finalResult.battery_results[1]);
  assert.match(recommendationSource, /Recommended from the GA-optimized feasible alternatives/);
  assert.match(recommendationSource, /best_bess_capacity_kwh/);
});

test("project, dataset, comparison, or AHP mismatch marks a ranking stale", () => {
  const completed = comparison();
  const accepted = ahp();
  const saved = {
    result: null,
    comparisonRevision: completed.revision,
    batteryConfigurationSignature: completed.batteryConfigurationSignature,
    ahpRevision: accepted.revision,
    calculatedAt: "2026-07-30T10:10:00.000Z",
    projectId: "project-a",
    datasetId: "dataset-a",
  } as unknown as PrometheeWorkspaceState;
  assert.equal(isPrometheeResultStale(saved, completed, accepted, context), false);
  assert.equal(isPrometheeResultStale({ ...saved, projectId: "project-b" }, completed, accepted, context), true);
  assert.equal(isPrometheeResultStale({ ...saved, datasetId: "dataset-b" }, completed, accepted, context), true);
  assert.equal(isPrometheeResultStale({ ...saved, comparisonRevision: "old" }, completed, accepted, context), true);
  assert.equal(isPrometheeResultStale({ ...saved, ahpRevision: 9 }, completed, accepted, context), true);
});

test("running and empty states remain actionable instead of blank", () => {
  assert.match(pageSource, /No comparison results yet/);
  assert.match(pageSource, /Battery comparison is running/);
  assert.match(pageSource, /partial_results/);
});

test("results navigation keeps summary and AHP return actions", () => {
  assert.match(resultsSource, /Back to Recommendation/);
  assert.match(resultsSource, /Comparison Summary/);
  assert.match(resultsSource, /Revise AHP/);
  assert.match(resultsSource, /Return to Dashboard/);
});

test("PROMETHEE failure preserves accepted AHP and exposes an explicit retry", () => {
  const accepted = ahp();
  const before = structuredClone(accepted);
  mapComparisonToPrometheeRequest(comparison(), accepted);
  assert.deepEqual(accepted, before);
  assert.match(recommendationSource, /Retry Final Ranking/);
  assert.match(recommendationSource, /Final ranking could not be calculated/);
  assert.match(recommendationSource, /accepted AHP state was preserved/);
});

test("AHP acceptance automatically enters the calculating final-ranking route", () => {
  const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.match(appSource, /onContinue=\{\(state\) =>/);
  assert.match(appSource, /\"comparison-recommendation\"/);
  assert.match(recommendationSource, /Calculating Final Ranking/);
  assert.match(recommendationSource, /void calculate\(\)/);
});
