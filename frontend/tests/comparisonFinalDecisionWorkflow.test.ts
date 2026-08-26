import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { resetAHPMatrix } from "../src/lib/comparisonAhp.ts";
import {
  decisionStageActionLabel,
  deriveComparisonDecisionStage,
  destinationForComparisonDecisionStage,
  recommendationAnimationEnabled,
} from "../src/lib/comparisonDecisionWorkflow.ts";
import {
  PROMETHEE_CRITERIA_ORDER,
  buildBatteryConfigurationSignature,
  buildComparisonRevision,
  calculatePrometheeRanking,
} from "../src/lib/comparisonResults.ts";
import type {
  ComparisonAHPWorkspaceState,
  ComparisonBatteryResult,
  ComparisonOptimizationWorkspaceState,
  PrometheeCalculationResult,
  PrometheeWorkspaceState,
} from "../src/types/workspace.ts";

const recommendationSource = readFileSync(
  new URL("../src/pages/ComparisonRecommendationPage.tsx", import.meta.url),
  "utf8",
);
const resultsSource = readFileSync(
  new URL("../src/pages/ComparisonResultsPage.tsx", import.meta.url),
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
    best_peak_support_pct: 30,
    best_total_annual_cost_rs: 150_000_000 + capacity,
    best_fitness_rs: feasible ? 150_000_000 + capacity : 900_000_000,
    solution_status: feasible ? "feasible_solution" : "no_feasible_candidate",
    solution_message: feasible ? "Feasible" : "Infeasible",
    ga_generations_completed: 3,
    total_fitness_evaluations: 18,
    runtime_seconds: 1,
    cycle_based_life_years: 8.5,
    equivalent_cycles_per_year: 350,
    round_trip_efficiency: 0.8464,
    weight_density_kg_per_kwh: 8.5,
    warranty_years: 5,
    annual_om_cost_rs: 1_500_000,
    failed_constraints: feasible ? [] : ["peak_support"],
    total_penalty_rs: feasible ? 0 : 750_000_000,
    is_feasible: feasible,
    peak_support_success_pct: feasible ? 96 : 50,
    pv_self_consumption_pct: feasible ? 45 : 30,
    replacement_years: [9, 18],
  };
}

function comparison(results = [battery("A", 3_200), battery("B", 3_600)]): ComparisonOptimizationWorkspaceState {
  const finalResult = {
    battery_results: results,
    comparison_solution_status: results.every((item) => item.is_feasible)
      ? "completed_all_batteries" as const
      : "completed_with_infeasible_alternatives" as const,
    feasible_battery_count: results.filter((item) => item.is_feasible).length,
    infeasible_battery_count: results.filter((item) => !item.is_feasible).length,
  };
  return {
    jobId: "job-a",
    status: "completed",
    revision: buildComparisonRevision(finalResult),
    batteryConfigurationSignature: buildBatteryConfigurationSignature(results),
    inputSignature: "input-a",
    submittedConfigurationRevision: 2,
    submittedBatteryConfigurationRevision: 2,
    stale: false,
    finalResult,
    completedAt: "2026-07-30T10:00:00.000Z",
    projectId: "project-a",
    datasetId: "dataset-a",
  };
}

function ahp(completed = comparison()): ComparisonAHPWorkspaceState {
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
    accepted: true,
    revision: 4,
    calculatedAt: "2026-07-30T10:05:00.000Z",
    acceptedAt: "2026-07-30T10:06:00.000Z",
    projectId: "project-a",
    linkedDatasetId: "dataset-a",
    linkedComparisonRevision: completed.revision,
  };
}

function result(): PrometheeCalculationResult {
  return {
    scientific_status: "ranking_completed",
    accepted_ahp_revision: 4,
    criteria_order: [...PROMETHEE_CRITERIA_ORDER],
    criterion_directions: ["minimize", "maximize", "maximize", "minimize", "maximize"],
    normalized_weights: [...ahp().calculation!.weights],
    raw_decision_matrix: [
      [150_003_200, 8.5, 0.8464, 8.5, 5],
      [150_003_600, 8.5, 0.8464, 8.5, 5],
    ],
    observed_ranges: [400, 0, 0, 0, 0],
    q_thresholds: [0, 0, 0, 0, 0],
    p_thresholds: [40, 1, 1, 1, 1],
    feasible_alternative_names: ["A", "B"],
    excluded_alternatives: [],
    criterion_preference_matrices: {},
    aggregated_preference_matrix: [[0, 1], [0, 0]],
    positive_flows: [1, 0],
    negative_flows: [0, 1],
    net_flows: [1, -1],
    ordered_ranking: [
      { battery_name: "A", rank: 1, positive_flow: 1, negative_flow: 0, net_flow: 1 },
      { battery_name: "B", rank: 2, positive_flow: 0, negative_flow: 1, net_flow: -1 },
    ],
    recommended_battery: "A",
  };
}

const context = { projectId: "project-a", datasetId: "dataset-a" };

function savedPromethee(completed = comparison()): PrometheeWorkspaceState {
  return {
    result: result(),
    comparisonRevision: completed.revision,
    batteryConfigurationSignature: completed.batteryConfigurationSignature,
    ahpRevision: 4,
    calculatedAt: "2026-07-30T10:10:00.000Z",
    projectId: "project-a",
    datasetId: "dataset-a",
  };
}

test("shared decision stage selects AHP, ranking, recommendation, and detailed routes", () => {
  const completed = comparison();
  assert.equal(deriveComparisonDecisionStage({ comparison: completed, ahp: null, promethee: null, context }), "ahp_required");
  assert.equal(deriveComparisonDecisionStage({ comparison: completed, ahp: ahp(completed), promethee: null, context }), "ahp_accepted");
  assert.equal(deriveComparisonDecisionStage({ comparison: completed, ahp: ahp(completed), promethee: savedPromethee(completed), context }), "recommendation_current");
  assert.equal(destinationForComparisonDecisionStage("ahp_required"), "comparison-ahp");
  assert.equal(destinationForComparisonDecisionStage("ahp_accepted"), "comparison-recommendation");
  assert.equal(destinationForComparisonDecisionStage("recommendation_current", true), "comparison-results");
});

test("shared decision stage exposes dataset and inconsistent-AHP recovery actions", () => {
  const completed = comparison();
  const inconsistent = ahp(completed);
  inconsistent.accepted = false;
  inconsistent.calculation = {
    ...inconsistent.calculation!,
    consistencyRatio: 0.18,
    status: "REVIEW REQUIRED",
  };
  assert.equal(deriveComparisonDecisionStage({ comparison: completed, ahp: null, promethee: null, context: { ...context, datasetId: null } }), "dataset_required");
  assert.equal(deriveComparisonDecisionStage({ comparison: completed, ahp: inconsistent, promethee: null, context }), "ahp_inconsistent");
  assert.equal(destinationForComparisonDecisionStage("ahp_inconsistent"), "comparison-ahp");
});

test("stale or cross-project results are never presented as current", () => {
  const completed = comparison();
  assert.equal(deriveComparisonDecisionStage({
    comparison: completed,
    ahp: ahp(completed),
    promethee: { ...savedPromethee(completed), projectId: "project-b" },
    context,
  }), "recommendation_stale");
});

test("PROMETHEE request persists project linkage and uses authentication credentials", async () => {
  const completed = comparison();
  let request: RequestInit | undefined;
  const state = await calculatePrometheeRanking({
    comparison: completed,
    ahp: ahp(completed),
    context,
    fetcher: (async (_input: RequestInfo | URL, init?: RequestInit) => {
      request = init;
      return new Response(JSON.stringify(result()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch,
  });
  assert.equal(request?.credentials, "include");
  assert.equal((request?.headers as Record<string, string>)["X-Project-ID"], "project-a");
  assert.equal(JSON.parse(String(request?.body)).alternatives.length, 2);
  assert.equal(state.projectId, "project-a");
  assert.equal(state.datasetId, "dataset-a");
  assert.equal(state.result.recommended_battery, "A");
});

test("recommendation page automatically calculates once and exposes retry without clearing AHP", () => {
  assert.match(recommendationSource, /stage !== "ahp_accepted"/);
  assert.match(recommendationSource, /calculationKey/);
  assert.match(recommendationSource, /window\.setTimeout\(\(\) => void calculate\(\), 0\)/);
  assert.match(recommendationSource, /controller\.signal\.aborted && !timedOut/);
  assert.match(recommendationSource, /Retry Final Ranking/);
  assert.match(recommendationSource, /accepted AHP state was preserved/);
  assert.equal(decisionStageActionLabel("promethee_retry_required"), "Retry Final Ranking");
});

test("recommendation reveal uses the winning GA capacity and respects reduced motion", () => {
  assert.match(recommendationSource, /Final Recommended BESS/);
  assert.match(recommendationSource, /best_bess_capacity_kwh/);
  assert.match(recommendationSource, /Recommended from the GA-optimized feasible alternatives/);
  assert.equal(recommendationAnimationEnabled(false), true);
  assert.equal(recommendationAnimationEnabled(true), false);
});

test("detailed results is a populated full page rather than a dialog", () => {
  assert.doesNotMatch(resultsSource, /<Dialog/);
  assert.match(resultsSource, /GA Comparison/);
  assert.match(resultsSource, /AHP Analysis/);
  assert.match(resultsSource, /PROMETHEE Analysis/);
  assert.match(resultsSource, /Accepted AHP pairwise matrix/);
  assert.match(resultsSource, /PROMETHEE raw decision matrix/);
  assert.match(resultsSource, /Back to Recommendation/);
});

test("one and zero feasible alternatives derive persistent diagnostic stages", () => {
  const one = comparison([battery("Only", 3_200)]);
  const none = comparison([battery("None", 500, false)]);
  assert.equal(deriveComparisonDecisionStage({ comparison: one, ahp: null, promethee: null, context }), "insufficient_feasible_alternatives");
  assert.equal(deriveComparisonDecisionStage({ comparison: none, ahp: null, promethee: null, context }), "no_feasible_alternatives");
  assert.match(recommendationSource, /Only One Feasible Alternative/);
  assert.match(recommendationSource, /Edit Comparison Configuration/);
});
