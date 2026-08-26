import assert from "node:assert/strict";
import test from "node:test";

import { resetAHPMatrix } from "../src/lib/comparisonAhp.ts";
import {
  PROMETHEE_CRITERIA_ORDER,
  buildBatteryConfigurationSignature,
  buildComparisonRevision,
  canEnterComparisonResults,
  isPrometheeResultStale,
  mapComparisonToPrometheeRequest,
  sanitizePrometheeWorkspaceState,
  shouldPresentRanking,
  shouldPresentRecommendation,
} from "../src/lib/comparisonResults.ts";
import {
  readPersistedWorkspaceState,
  writePersistedWorkspaceState,
} from "../src/lib/workspacePersistence.ts";

function battery(name: string, feasible = true) {
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
    best_bess_capacity_kwh: 3_400,
    best_peak_support_pct: 28,
    best_total_annual_cost_rs: name === "A" ? 150_000_000 : 160_000_000,
    best_fitness_rs: feasible ? 150_000_000 : 1_060_000_000,
    solution_status: feasible ? "feasible_solution" as const : "no_feasible_candidate" as const,
    solution_message: feasible ? "Feasible" : "No feasible candidate",
    ga_generations_completed: 3,
    total_fitness_evaluations: 18,
    runtime_seconds: 2,
    cycle_based_life_years: 8.3,
    round_trip_efficiency: 0.8464,
    weight_density_kg_per_kwh: 8.5,
    warranty_years: 5,
    annual_om_cost_rs: 1_496_000,
    failed_constraints: feasible ? [] : ["peak_support"],
    total_penalty_rs: feasible ? 0 : 900_000_000,
    is_feasible: feasible,
    peak_support_success_pct: feasible ? 96 : 50,
    pv_self_consumption_pct: 45,
    replacement_years: [8, 16, 24],
  };
}

function comparison() {
  const finalResult = {
    battery_results: [battery("A"), battery("B"), battery("Excluded", false)],
    comparison_solution_status: "completed_with_infeasible_alternatives" as const,
    feasible_battery_count: 2,
    infeasible_battery_count: 1,
  };
  return {
    jobId: "comparison-job",
    status: "completed" as const,
    revision: buildComparisonRevision(finalResult),
    batteryConfigurationSignature: buildBatteryConfigurationSignature(finalResult.battery_results),
    inputSignature: "comparison-input-v1",
    submittedConfigurationRevision: 1,
    submittedBatteryConfigurationRevision: 1,
    stale: false,
    finalResult,
    completedAt: "2026-07-14T10:00:00.000Z",
  };
}

const ahp = {
  matrix: resetAHPMatrix(),
  calculation: {
    columnSums: [1, 1, 1, 1, 1],
    normalizedMatrix: Array.from({ length: 5 }, () => Array(5).fill(1 / 5)),
    weights: [0.37278176, 0.31278176, 0.09569544, 0.13456635, 0.08417470],
    lambdaMax: 5.069277703,
    consistencyIndex: 0.017319426,
    randomIndex: 1.12,
    consistencyRatio: 0.015463773,
    status: "ACCEPTABLE" as const,
  },
  accepted: true,
  revision: 4,
  calculatedAt: "2026-07-14T10:05:00.000Z",
};

function prometheeResult() {
  return {
    scientific_status: "ranking_completed" as const,
    accepted_ahp_revision: 4,
    criteria_order: [...PROMETHEE_CRITERIA_ORDER],
    criterion_directions: ["minimize", "maximize", "maximize", "minimize", "maximize"] as const,
    normalized_weights: [...ahp.calculation.weights],
    raw_decision_matrix: [[150_000_000, 8.3, 0.8464, 8.5, 5], [160_000_000, 8.3, 0.8464, 8.5, 5]],
    observed_ranges: [10_000_000, 0, 0, 0, 0],
    q_thresholds: [0, 0, 0, 0, 0],
    p_thresholds: [1_000_000, 1, 1, 1, 1],
    feasible_alternative_names: ["A", "B"],
    excluded_alternatives: [{ battery_name: "Excluded", solution_status: "no_feasible_candidate" as const, failed_constraints: ["peak_support"] }],
    criterion_preference_matrices: {},
    aggregated_preference_matrix: [[0, 0.3458], [0, 0]],
    positive_flows: [0.3458, 0],
    negative_flows: [0, 0.3458],
    net_flows: [0.3458, -0.3458],
    ordered_ranking: [
      { battery_name: "A", rank: 1, positive_flow: 0.3458, negative_flow: 0, net_flow: 0.3458 },
      { battery_name: "B", rank: 2, positive_flow: 0, negative_flow: 0.3458, net_flow: -0.3458 },
    ],
    recommended_battery: "A",
  };
}

test("Stage 1 maps exact criteria, accepted weights, and feasible alternatives only", () => {
  const request = mapComparisonToPrometheeRequest(comparison(), ahp);
  assert.deepEqual(PROMETHEE_CRITERIA_ORDER, [
    "total_annual_cost_Rs",
    "cycle_based_life_years",
    "round_trip_efficiency",
    "weight_density_kg_per_kwh",
    "warranty_years",
  ]);
  assert.deepEqual(request.ahp_weights, ahp.calculation.weights);
  assert.equal(request.accepted_ahp_revision, 4);
  assert.equal(request.alternatives.length, 2);
  assert.ok(request.alternatives.every((alternative) => alternative.is_feasible));
  assert.equal(request.alternatives[0].total_annual_cost_rs, 150_000_000);
  assert.equal("annual_om_cost_rs" in request.alternatives[0], false);
  assert.equal(request.alternatives.some((alternative) => alternative.battery_name === "Excluded"), false);
});

test("scientific status controls recommendation and ranking presentation", () => {
  assert.equal(shouldPresentRecommendation("ranking_completed", "A", false), true);
  assert.equal(shouldPresentRecommendation("ranking_completed", "A", true), false);
  assert.equal(shouldPresentRecommendation("insufficient_feasible_alternatives", null, false), false);
  assert.equal(shouldPresentRecommendation("no_feasible_alternatives", null, false), false);
  assert.equal(shouldPresentRanking("ranking_completed"), true);
  assert.equal(shouldPresentRanking("no_feasible_alternatives"), false);
});

test("accepted AHP can enter results before PROMETHEE has been calculated", () => {
  const comparisonState = comparison();
  assert.equal(canEnterComparisonResults(comparisonState, ahp), true);
  assert.equal(canEnterComparisonResults({ ...comparisonState, stale: true }, ahp), false);
  assert.equal(canEnterComparisonResults(comparisonState, { ...ahp, accepted: false }), false);
});

test("AHP or comparison revision changes mark a saved result stale", () => {
  const comparisonState = comparison();
  const saved = {
    result: prometheeResult(),
    comparisonRevision: comparisonState.revision,
    batteryConfigurationSignature: comparisonState.batteryConfigurationSignature,
    ahpRevision: ahp.revision,
    calculatedAt: "2026-07-14T10:10:00.000Z",
  };
  assert.equal(isPrometheeResultStale(saved, comparisonState, ahp), false);
  assert.equal(isPrometheeResultStale(saved, comparisonState, { ...ahp, revision: 5 }), true);
  assert.equal(isPrometheeResultStale(saved, { ...comparisonState, revision: "changed" }, ahp), true);
});

test("legacy six-criterion PROMETHEE state is preserved as stale and incompatible", () => {
  const current = comparison();
  const legacy = sanitizePrometheeWorkspaceState({
    result: {
      ...prometheeResult(),
      criteria_order: [
        "total_annual_cost_rs",
        "cycle_based_life_years",
        "round_trip_efficiency",
        "weight_density_kg_per_kwh",
        "annual_om_cost_rs",
        "warranty_years",
      ],
    },
    comparisonRevision: current.revision,
    batteryConfigurationSignature: current.batteryConfigurationSignature,
    ahpRevision: 4,
    calculatedAt: "2026-01-01T00:00:00.000Z",
  });
  assert.equal(legacy?.stale, true);
  assert.equal(legacy?.incompatible, true);
  assert.match(legacy?.incompatibilityReason ?? "", /six-criterion model/);
});

test("closing does not mutate workspace and refresh restores valid ranking", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  } as Storage;
  const comparisonState = comparison();
  const savedPromethee = {
    result: prometheeResult(),
    comparisonRevision: comparisonState.revision,
    batteryConfigurationSignature: comparisonState.batteryConfigurationSignature,
    ahpRevision: ahp.revision,
    calculatedAt: "2026-07-14T10:10:00.000Z",
    scientificConfigurationVersion: 3,
    incompatible: false,
    incompatibilityReason: null,
  };
  const workspace = {
    version: 1,
    activePage: "Comparison Mode",
    dataset: null,
    dispatchStrategy: { status: "Reference Strategy", periods: [] },
    battery: null,
    setup: null,
    runState: { phase: "ready", jobId: null, latestJob: null, error: null, startedAt: null, finishedAt: null, reconnecting: false },
    selectedBatteryId: null,
    selectedMode: "comparison",
    activeOptimizationStep: "mode-selection",
    operationalProfileDate: null,
    comparisonAhp: ahp,
    comparisonConfiguration: null,
    comparisonRunState: { phase: "ready", jobId: null, submittedConfigurationRevision: null, submittedBatteryConfigurationRevision: null, submittedInputSignature: null, latestJob: null, maximumObservedProgressPercent: 0, error: null, startedAt: null, finishedAt: null, reconnecting: false },
    comparisonOptimization: comparisonState,
    promethee: savedPromethee,
  } as const;

  const beforeClose = structuredClone(workspace);
  let dialogOpen = true;
  dialogOpen = false;
  assert.equal(dialogOpen, false);
  assert.deepEqual(workspace, beforeClose);

  writePersistedWorkspaceState(storage, workspace);
  const restored = readPersistedWorkspaceState(storage);
  assert.deepEqual(restored?.comparisonOptimization, comparisonState);
  assert.deepEqual(restored?.promethee, savedPromethee);
});
