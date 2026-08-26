import assert from "node:assert/strict";
import test from "node:test";

import {
  DASHBOARD_ACTION_TARGETS,
  buildDashboardModel,
  type DashboardWorkspaceInput,
} from "../src/lib/dashboardState.ts";
import type {
  ComparisonAHPWorkspaceState,
  ComparisonBatteryResult,
  ComparisonOptimizationWorkspaceState,
  ComparisonRunWorkspaceState,
  PrometheeWorkspaceState,
  SingleOptimizationFinalResult,
  SingleOptimizationRunWorkspaceState,
  WorkspaceDatasetSummary,
} from "../src/types/workspace.ts";

const dataset: WorkspaceDatasetSummary = {
  datasetId: "dataset-1",
  filename: "annual-profile.csv",
  rowCount: 35_040,
  datasetType: "normal_year",
  status: "ready",
  startDate: "2025-01-01",
  endDate: "2025-12-31",
  annualPvEnergyKwh: 8_400_000,
  annualEvEnergyKwh: 7_100_000,
  pvPeakKw: 2_430,
  evPeakKw: 1_880,
  intervalMinutes: 15,
  durationDays: 365,
  timestampsGenerated: false,
  notice: null,
  detectedColumns: { timestamp: "timestamp", pv: "pv", ev: "ev", tariff: null },
};

function batteryResult(name: string, capacity = 3_400): ComparisonBatteryResult {
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
    best_total_annual_cost_rs: 150_000_000,
    best_fitness_rs: 150_000_000,
    solution_status: "feasible_solution",
    solution_message: "Feasible",
    ga_generations_completed: 3,
    total_fitness_evaluations: 18,
    runtime_seconds: 2,
    cycle_based_life_years: 8.3,
    round_trip_efficiency: 0.8464,
    weight_density_kg_per_kwh: 8.5,
    warranty_years: 5,
    annual_om_cost_rs: 1_496_000,
    failed_constraints: [],
    total_penalty_rs: 0,
    is_feasible: true,
    peak_support_success_pct: 96,
    pv_self_consumption_pct: 45,
    replacement_years: [8, 16, 24],
  };
}

const comparison: ComparisonOptimizationWorkspaceState = {
  jobId: "comparison-job",
  status: "completed",
  revision: "comparison-revision-1",
  batteryConfigurationSignature: "battery-signature-1",
  inputSignature: "input-signature-1",
  submittedConfigurationRevision: 1,
  submittedBatteryConfigurationRevision: 1,
  stale: false,
  finalResult: {
    battery_results: [batteryResult("Battery A"), batteryResult("Battery B", 3_800)],
    comparison_solution_status: "completed_all_batteries",
    feasible_battery_count: 2,
    infeasible_battery_count: 0,
  },
  completedAt: "2026-07-20T08:30:00.000Z",
};

const ahp: ComparisonAHPWorkspaceState = {
  matrix: Array.from({ length: 5 }, (_, row) =>
    Array.from({ length: 5 }, (_, column) => (row === column ? 1 : 1)),
  ),
  calculation: {
    columnSums: [5, 5, 5, 5, 5],
    normalizedMatrix: Array.from({ length: 5 }, () => Array(5).fill(1 / 5)),
    weights: [0.37278176, 0.31278176, 0.09569544, 0.13456635, 0.08417470],
    lambdaMax: 5.069277703,
    consistencyIndex: 0.017319426,
    randomIndex: 1.12,
    consistencyRatio: 0.015463773,
    status: "ACCEPTABLE",
  },
  accepted: true,
  revision: 1,
  calculatedAt: "2026-07-20T08:35:00.000Z",
};

const promethee: PrometheeWorkspaceState = {
  result: {
    scientific_status: "ranking_completed",
    accepted_ahp_revision: 1,
    criteria_order: [
      "total_annual_cost_Rs",
      "cycle_based_life_years",
      "round_trip_efficiency",
      "weight_density_kg_per_kwh",
      "warranty_years",
    ],
    criterion_directions: ["minimize", "maximize", "maximize", "minimize", "maximize"],
    normalized_weights: ahp.calculation!.weights,
    raw_decision_matrix: [[1, 2, 3, 4, 5], [2, 3, 4, 5, 6]],
    observed_ranges: [1, 1, 1, 1, 1],
    q_thresholds: [0, 0, 0, 0, 0],
    p_thresholds: [0.1, 0.1, 0.1, 0.1, 0.1],
    feasible_alternative_names: ["Battery A", "Battery B"],
    excluded_alternatives: [],
    criterion_preference_matrices: {},
    aggregated_preference_matrix: [[0, 0.7], [0.3, 0]],
    positive_flows: [0.7, 0.3],
    negative_flows: [0.3, 0.7],
    net_flows: [0.4, -0.4],
    ordered_ranking: [
      { battery_name: "Battery A", rank: 1, positive_flow: 0.7, negative_flow: 0.3, net_flow: 0.4 },
      { battery_name: "Battery B", rank: 2, positive_flow: 0.3, negative_flow: 0.7, net_flow: -0.4 },
    ],
    recommended_battery: "Battery A",
  },
  comparisonRevision: comparison.revision,
  batteryConfigurationSignature: comparison.batteryConfigurationSignature,
  ahpRevision: ahp.revision,
  calculatedAt: "2026-07-20T08:40:00.000Z",
};

function singleResult(): SingleOptimizationFinalResult {
  return {
    solution_status: "feasible_solution",
    solution_message: "Feasible",
    best_bess_capacity_kwh: 3_250,
    best_peak_support_pct: 28,
    best_total_annual_cost_rs: 140_000_000,
    best_fitness_rs: 140_000_000,
    bess_capacity_kwh: 3_250,
    peak_support_pct: 28,
    battery_name: "Battery A",
    round_trip_efficiency: 0.8464,
    annual_grid_import_kwh: 100,
    annual_pv_export_kwh: 20,
    annual_bess_charge_kwh: 30,
    annual_bess_discharge_kwh: 25,
    equivalent_cycles_per_year: 350,
    cycle_based_life_years: 8.3,
    replacement_years: [8, 16, 24],
    annualized_bess_lifecycle_cost_rs: 80_000_000,
    annual_om_cost_rs: 1_430_000,
    annual_grid_cost_rs: 60_000_000,
    annual_export_revenue_rs: 1_430_000,
    total_annual_cost_rs: 140_000_000,
    peak_support_success_pct: 96,
    pv_self_consumption_pct: 45,
    peak_support_threshold_pct: 95,
    pv_self_consumption_threshold_pct: 40,
    peak_support_constraint_passed: true,
    pv_self_consumption_constraint_passed: true,
    is_feasible: true,
    peak_support_penalty_rs: 0,
    pv_self_consumption_penalty_rs: 0,
    total_penalty_rs: 0,
    fitness_rs: 140_000_000,
    minimum_soc_pct: 20,
    maximum_soc_pct: 90,
    validation_warnings: [],
    ga_generations_completed: 3,
    total_fitness_evaluations: 18,
    convergence_history: [],
    runtime_seconds: 1.5,
    input_battery_configuration: batteryResult("Battery A").input_battery_configuration,
    input_economic_configuration: {
      project_life_years: 25,
      discount_rate: 0.1,
      export_tariff_rs_per_kwh: 21,
      annual_om_fraction: 0.01,
      replacement_cost_fraction: 0.8,
      residual_value_enabled: true,
    },
    warnings: [],
  };
}

function completedSingle(): SingleOptimizationRunWorkspaceState {
  return {
    phase: "completed",
    jobId: "single-job",
    latestJob: {
      job_id: "single-job",
      status: "completed",
      progress_percent: 100,
      current_generation: 3,
      total_generations: 3,
      evaluations_completed: 18,
      estimated_total_evaluations: 18,
      current_best_capacity_kwh: 3_250,
      current_best_peak_support_pct: 28,
      current_best_total_annual_cost_rs: 140_000_000,
      current_best_fitness_rs: 140_000_000,
      current_best_is_feasible: true,
      error: null,
      final_result: singleResult(),
    },
    error: null,
    startedAt: Date.parse("2026-07-20T08:00:00.000Z"),
    finishedAt: Date.parse("2026-07-20T08:10:00.000Z"),
    reconnecting: false,
  };
}

const base: DashboardWorkspaceInput = {
  dataset: null,
  singleRun: null,
  comparisonRun: null,
  comparison: null,
  ahp: null,
  promethee: null,
  restoredFromMongo: false,
  persistenceStatus: "saved",
};

test("dashboard shows the no-dataset state", () => {
  const model = buildDashboardModel(base);
  assert.equal(model.dataset.status, "Not available");
  assert.equal(model.dataset.summary, null);
});

test("dashboard uses the hydrated dataset summary", () => {
  const model = buildDashboardModel({ ...base, dataset, restoredFromMongo: true });
  assert.equal(model.dataset.status, "Available");
  assert.equal(model.dataset.summary?.rowCount, 35_040);
  assert.equal(model.dataset.summary?.annualPvEnergyKwh, 8_400_000);
});

test("dashboard exposes the completed Single result", () => {
  const model = buildDashboardModel({ ...base, singleRun: completedSingle() });
  assert.equal(model.single.status, "Completed");
  assert.equal(model.single.batteryName, "Battery A");
  assert.equal(model.single.capacityKwh, 3_250);
  assert.equal(model.single.feasible, true);
});

test("dashboard marks a Mongo-restored active job as resuming", () => {
  const active: SingleOptimizationRunWorkspaceState = {
    ...completedSingle(),
    phase: "running",
    finishedAt: null,
    latestJob: { ...completedSingle().latestJob!, status: "running", progress_percent: 42, current_generation: 4, total_generations: 10, final_result: null },
  };
  const model = buildDashboardModel({ ...base, singleRun: active, restoredFromMongo: true });
  assert.equal(model.activeJob?.status, "Resuming");
  assert.equal(model.activeJob?.recovered, true);
  assert.equal(model.activeJob?.progressPercent, 42);
});

test("dashboard summarizes Comparison Stage 1 completion", () => {
  const model = buildDashboardModel({ ...base, comparison });
  assert.equal(model.comparison.status, "Completed");
  assert.equal(model.comparison.completedBatteries, 2);
  assert.equal(model.comparison.feasibleBatteries, 2);
  assert.equal(model.comparison.infeasibleBatteries, 0);
});

test("dashboard reports accepted AHP state", () => {
  const model = buildDashboardModel({ ...base, comparison, ahp });
  assert.equal(model.ahp.status, "Accepted");
  assert.equal(model.ahp.accepted, true);
  assert.equal(model.ahp.consistencyRatio, 0.015463773);
});

test("dashboard presents a current PROMETHEE recommendation", () => {
  const model = buildDashboardModel({ ...base, comparison, ahp, promethee });
  assert.equal(model.promethee.status, "Current");
  assert.equal(model.recommendation?.batteryName, "Battery A");
  assert.equal(model.recommendation?.capacityKwh, 3_400);
});

test("dashboard never presents a stale PROMETHEE result as current", () => {
  const staleComparison = { ...comparison, stale: true };
  const model = buildDashboardModel({ ...base, comparison: staleComparison, ahp, promethee });
  assert.equal(model.promethee.status, "Stale");
  assert.equal(model.recommendation, null);
  assert.equal(model.staleRecommendationBattery, "Battery A");
});

test("dashboard retains metadata while marking an expired dataset", () => {
  const model = buildDashboardModel({ ...base, dataset: { ...dataset, status: "expired" } });
  assert.equal(model.dataset.status, "Expired");
  assert.equal(model.dataset.summary?.filename, "annual-profile.csv");
});

test("dashboard quick actions map to existing workflows", () => {
  assert.deepEqual(DASHBOARD_ACTION_TARGETS, {
    dataset: "Data Upload",
    single: "Optimization",
    comparison: "Comparison Mode",
    ahp: "Optimization",
    results: "Comparison Mode",
  });
});

test("dashboard exposes a comparison recovery block without checkpoint internals", () => {
  const blocked: ComparisonRunWorkspaceState = {
    phase: "failed",
    jobId: "comparison-job",
    submittedConfigurationRevision: 1,
    submittedBatteryConfigurationRevision: 1,
    submittedInputSignature: "input-signature-1",
    latestJob: null,
    maximumObservedProgressPercent: 35,
    error: { code: "RECOVERY_BLOCKED", message: "RECOVERY_BLOCKED: dataset_missing" },
    startedAt: Date.now(),
    finishedAt: null,
    reconnecting: false,
  };
  const model = buildDashboardModel({ ...base, comparisonRun: blocked, restoredFromMongo: true });
  assert.equal(model.activeJob?.status, "Resume blocked");
  assert.equal(model.activeJob?.blockedReason, "dataset_missing");
});

test("dashboard uses monotonic overall comparison progress instead of per-battery progress", () => {
  const running: ComparisonRunWorkspaceState = {
    phase: "running",
    jobId: "comparison-running",
    submittedConfigurationRevision: 1,
    submittedBatteryConfigurationRevision: 1,
    submittedInputSignature: "input-signature-1",
    latestJob: {
      job_id: "comparison-running",
      status: "running",
      progress_percent: 8,
      overall_progress_percent: 58,
      current_generation: 1,
      total_generations: 3,
      evaluations_completed: 2,
      estimated_total_evaluations: 18,
      current_battery_index: 2,
      current_battery_id: "battery-c",
      current_battery_name: "Battery C",
      current_battery_evaluations_completed: 2,
      current_battery_estimated_evaluations: 18,
      total_evaluations_completed: 38,
      total_estimated_evaluations: 72,
      completed_battery_count: 2,
      total_batteries: 4,
      current_best_capacity_kwh: 3_200,
      current_best_peak_support_pct: 30,
      current_best_total_annual_cost_rs: 150_000_000,
      current_best_raw_cost_rs: 150_000_000,
      current_best_fitness_rs: 150_000_000,
      current_best_is_feasible: true,
      battery_results: [batteryResult("Battery A"), batteryResult("Battery B")],
      partial_results: [batteryResult("Battery A"), batteryResult("Battery B")],
      error: null,
      final_result: null,
    },
    maximumObservedProgressPercent: 58,
    error: null,
    startedAt: Date.now(),
    finishedAt: null,
    reconnecting: false,
  };
  const model = buildDashboardModel({ ...base, comparisonRun: running });
  assert.equal(model.comparison.progressPercent, 58);
  assert.equal(model.activeJob?.progressPercent, 58);
});

test("dashboard status cards consistently derive every lifecycle category", () => {
  const runWithPhase = (
    phase: SingleOptimizationRunWorkspaceState["phase"],
    error: SingleOptimizationRunWorkspaceState["error"] = null,
  ): SingleOptimizationRunWorkspaceState => ({
    ...completedSingle(),
    phase,
    latestJob: phase === "completed" ? completedSingle().latestJob : null,
    error,
  });

  assert.equal(buildDashboardModel(base).single.status, "Not started");
  assert.equal(buildDashboardModel({ ...base, singleRun: runWithPhase("running") }).single.status, "Running");
  assert.equal(buildDashboardModel({ ...base, singleRun: completedSingle() }).single.status, "Completed");
  assert.equal(buildDashboardModel({ ...base, singleRun: runWithPhase("failed") }).single.status, "Failed");
  assert.equal(buildDashboardModel({ ...base, singleRun: runWithPhase("cancelled") }).single.status, "Cancelled");
  assert.equal(
    buildDashboardModel({
      ...base,
      singleRun: runWithPhase("failed", { code: "RECOVERY_BLOCKED", message: "dataset_changed" }),
    }).single.status,
    "Resume blocked",
  );

  assert.equal(buildDashboardModel(base).ahp.status, "Not configured");
  assert.equal(buildDashboardModel({ ...base, ahp: { ...ahp, accepted: false } }).ahp.status, "Ready");
  assert.equal(buildDashboardModel({ ...base, comparison, ahp }).ahp.status, "Accepted");
  assert.equal(
    buildDashboardModel({ ...base, comparison: { ...comparison, stale: true }, ahp }).ahp.status,
    "Stale",
  );

  assert.equal(buildDashboardModel(base).promethee.status, "Not calculated");
  assert.equal(buildDashboardModel({ ...base, comparison, ahp }).promethee.status, "Ready");
  assert.equal(buildDashboardModel({ ...base, comparison, ahp, promethee }).promethee.status, "Current");
  assert.equal(
    buildDashboardModel({ ...base, comparison: { ...comparison, stale: true }, ahp, promethee }).promethee.status,
    "Stale",
  );
});
