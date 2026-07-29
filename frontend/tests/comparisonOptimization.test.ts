import assert from "node:assert/strict";
import test from "node:test";

import {
  INITIAL_COMPARISON_RUN_STATE,
  buildCompletedComparisonSnapshot,
  buildComparisonInputSignature,
  createDefaultComparisonConfiguration,
  enabledBatteryCount,
  estimatedComparisonEvaluations,
  expireComparisonRun,
  isActiveComparisonRun,
  mapComparisonRunRequest,
  mergeComparisonJobProgress,
  reviseComparisonConfiguration,
  synchronizeComparisonSnapshot,
  transitionFromComparisonRunner,
} from "../src/lib/comparisonOptimization.ts";
import { hasPrometheePrerequisites, isPrometheeResultStale } from "../src/lib/comparisonResults.ts";
import { readPersistedWorkspaceState, writePersistedWorkspaceState } from "../src/lib/workspacePersistence.ts";

const catalogue = ["Low-cost", "Medium-low", "Medium", "Medium-high"].map((name, index) => ({
  name,
  price_rs_per_kwh: 44_000 + index * 5_000,
  rated_cycle_life: 3_000 + index * 500,
  eta_ch: 0.92,
  eta_dis: 0.92,
  weight_density_kg_per_kwh: 8.5 - index * 0.5,
  warranty_years: 5 + index,
}));

const dataset = {
  datasetId: "dataset-1",
  filename: "annual.csv",
  rowCount: 35_040,
  datasetType: "normal_year",
  startDate: "2025-01-01",
  endDate: "2025-12-31",
  annualPvEnergyKwh: 1,
  annualEvEnergyKwh: 1,
};
const dispatch = { status: "Reference Strategy" as const, periods: [] };

function batteryResult(name: string, feasible = true) {
  const battery = catalogue.find((entry) => entry.name === name) ?? catalogue[0];
  return {
    battery_name: name,
    input_battery_configuration: { ...battery, name },
    best_bess_capacity_kwh: 3_500,
    best_peak_support_pct: 30,
    best_total_annual_cost_rs: 150_000_000,
    best_fitness_rs: feasible ? 150_000_000 : 900_000_000,
    solution_status: feasible ? "feasible_solution" as const : "no_feasible_candidate" as const,
    solution_message: feasible ? "Feasible" : "No feasible candidate",
    ga_generations_completed: 3,
    total_fitness_evaluations: 18,
    runtime_seconds: 2,
    cycle_based_life_years: 8,
    round_trip_efficiency: battery.eta_ch * battery.eta_dis,
    weight_density_kg_per_kwh: battery.weight_density_kg_per_kwh,
    warranty_years: battery.warranty_years,
    annual_om_cost_rs: 1_500_000,
    failed_constraints: feasible ? [] : ["peak_support"],
    total_penalty_rs: feasible ? 0 : 750_000_000,
    is_feasible: feasible,
    peak_support_success_pct: feasible ? 96 : 50,
    pv_self_consumption_pct: 45,
    replacement_years: [8, 16, 24],
  };
}

function finalResult(feasibleCount = 2) {
  const results = [batteryResult("Low-cost", feasibleCount >= 1), batteryResult("Medium-low", feasibleCount >= 2), batteryResult("Medium", feasibleCount >= 3)];
  return {
    battery_results: results,
    comparison_solution_status: feasibleCount === results.length ? "completed_all_batteries" as const : "completed_with_infeasible_alternatives" as const,
    feasible_battery_count: feasibleCount,
    infeasible_battery_count: results.length - feasibleCount,
  };
}

function job(overrides: Record<string, unknown> = {}) {
  return {
    job_id: "job-1",
    status: "running" as const,
    progress_percent: 25,
    overall_progress_percent: 25,
    current_generation: 1,
    total_generations: 3,
    evaluations_completed: 6,
    estimated_total_evaluations: 54,
    current_battery_index: 1,
    current_battery_id: "medium-low-2",
    current_battery_name: "Medium-low",
    current_battery_evaluations_completed: 2,
    current_battery_estimated_evaluations: 18,
    total_evaluations_completed: 20,
    total_estimated_evaluations: 54,
    completed_battery_count: 1,
    total_batteries: 3,
    current_best_capacity_kwh: 3_500,
    current_best_peak_support_pct: 30,
    current_best_total_annual_cost_rs: 150_000_000,
    current_best_raw_cost_rs: 150_000_000,
    current_best_fitness_rs: 150_000_000,
    current_best_is_feasible: true,
    battery_results: [batteryResult("Low-cost")],
    partial_results: [batteryResult("Low-cost")],
    error: null,
    final_result: null,
    ...overrides,
  };
}

test("request submits exactly enabled batteries with the backend field contract", () => {
  const initial = createDefaultComparisonConfiguration(catalogue);
  const configuration = reviseComparisonConfiguration(initial, { batteries: initial.batteries.map((entry, index) => ({ ...entry, enabled: index !== 1 })) }, true);
  const request = mapComparisonRunRequest(configuration, dataset, dispatch);
  assert.deepEqual(request.batteries.map((entry) => entry.battery.name), ["Low-cost", "Medium", "Medium-high"]);
  assert.ok(request.batteries.every((entry) => entry.enabled === true));
  assert.equal(request.dataset_id, "dataset-1");
  assert.equal(request.dispatch_strategy_status, "Reference Strategy");
  assert.equal(request.economic_settings.discount_rate, 0.10);
  assert.deepEqual(Object.keys(request.ga_settings).sort(), ["elite_count", "generations", "mutation_probability", "population_size", "random_seed"]);
});

test("fewer than two enabled alternatives blocks submission", () => {
  const initial = createDefaultComparisonConfiguration(catalogue);
  const configuration = { ...initial, batteries: initial.batteries.map((entry, index) => ({ ...entry, enabled: index === 0 })) };
  assert.equal(enabledBatteryCount(configuration), 1);
  assert.throws(() => mapComparisonRunRequest(configuration, dataset, dispatch), /at least two/i);
});

test("evaluation estimate uses enabled batteries times population times generations", () => {
  const configuration = createDefaultComparisonConfiguration(catalogue);
  assert.equal(estimatedComparisonEvaluations(configuration), 4 * 100 * 50);
});

test("active lifecycle phases prevent duplicate submission", () => {
  for (const phase of ["submitting", "queued", "running", "cancelling"] as const) assert.equal(isActiveComparisonRun({ ...INITIAL_COMPARISON_RUN_STATE, phase }), true);
  assert.equal(isActiveComparisonRun(INITIAL_COMPARISON_RUN_STATE), false);
});

test("runner closes before transitioning to AHP or results", () => {
  const events: string[] = [];
  transitionFromComparisonRunner(() => events.push("closed"), () => events.push("next"));
  assert.deepEqual(events, ["closed", "next"]);
});

test("polling progress is monotonic while per-battery evaluations can reset", () => {
  const previous = job({ overall_progress_percent: 45, progress_percent: 45, current_battery_evaluations_completed: 18, total_evaluations_completed: 24 });
  const next = job({ overall_progress_percent: 34, progress_percent: 10, current_battery_index: 2, current_battery_evaluations_completed: 1, total_evaluations_completed: 22 });
  const merged = mergeComparisonJobProgress(previous, next);
  assert.equal(merged.overall_progress_percent, 45);
  assert.equal(merged.progress_percent, 45);
  assert.equal(merged.total_evaluations_completed, 24);
  assert.equal(merged.current_battery_evaluations_completed, 1);
});

test("cancellation response retains completed partial results", () => {
  const previous = job();
  const cancelled = job({ status: "cancelled", partial_results: [], battery_results: [] });
  const merged = mergeComparisonJobProgress(previous, cancelled);
  assert.equal(merged.status, "cancelled");
  assert.equal(merged.partial_results.length, 1);
});

test("completion creates the canonical unmodified final result snapshot", () => {
  const result = finalResult(2);
  const completedJob = job({ status: "completed", overall_progress_percent: 100, progress_percent: 100, final_result: result, partial_results: result.battery_results, battery_results: result.battery_results });
  const run = { ...INITIAL_COMPARISON_RUN_STATE, phase: "completed" as const, jobId: "job-1", submittedConfigurationRevision: 5, submittedBatteryConfigurationRevision: 3, submittedInputSignature: "input-v5", latestJob: completedJob };
  const snapshot = buildCompletedComparisonSnapshot(completedJob, run);
  assert.equal(snapshot.finalResult, result);
  assert.equal(snapshot.submittedConfigurationRevision, 5);
  assert.equal(snapshot.stale, false);
  assert.equal(snapshot.finalResult.battery_results[2].is_feasible, false);
});

test("expired jobs preserve run metadata and become safely rerunnable", () => {
  const active = { ...INITIAL_COMPARISON_RUN_STATE, phase: "running" as const, jobId: "lost-job", submittedConfigurationRevision: 4 };
  const expired = expireComparisonRun(active);
  assert.equal(expired.phase, "expired");
  assert.equal(expired.jobId, null);
  assert.equal(expired.submittedConfigurationRevision, 4);
  assert.equal(expired.error?.code, "COMPARISON_JOB_EXPIRED");
});

test("configuration changes mark a completed Stage 1 snapshot stale", () => {
  const configuration = createDefaultComparisonConfiguration(catalogue);
  const signature = buildComparisonInputSignature(configuration, dataset, dispatch);
  const completedJob = job({ status: "completed", final_result: finalResult(2) });
  const snapshot = buildCompletedComparisonSnapshot(completedJob, { ...INITIAL_COMPARISON_RUN_STATE, submittedInputSignature: signature });
  const changed = reviseComparisonConfiguration(configuration, { maximumBessCapacityKwh: 6500 });
  const synchronized = synchronizeComparisonSnapshot(snapshot, buildComparisonInputSignature(changed, dataset, dispatch));
  assert.equal(synchronized?.stale, true);
});

test("a stale Stage 1 snapshot also makes PROMETHEE stale", () => {
  const configuration = createDefaultComparisonConfiguration(catalogue);
  const signature = buildComparisonInputSignature(configuration, dataset, dispatch);
  const completedJob = job({ status: "completed", final_result: finalResult(2) });
  const snapshot = { ...buildCompletedComparisonSnapshot(completedJob, { ...INITIAL_COMPARISON_RUN_STATE, submittedInputSignature: signature }), stale: true };
  const ahp = { matrix: [], calculation: null, accepted: true, revision: 1, calculatedAt: null };
  const promethee = { result: {} as never, comparisonRevision: snapshot.revision, batteryConfigurationSignature: snapshot.batteryConfigurationSignature, ahpRevision: 1, calculatedAt: "now" };
  assert.equal(isPrometheeResultStale(promethee, snapshot, ahp), true);
});

test("workspace refresh restores active run configuration and completed snapshot", () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } } as Storage;
  const configuration = createDefaultComparisonConfiguration(catalogue);
  const signature = buildComparisonInputSignature(configuration, dataset, dispatch);
  const completedJob = job({ status: "completed", final_result: finalResult(2) });
  const comparison = buildCompletedComparisonSnapshot(completedJob, { ...INITIAL_COMPARISON_RUN_STATE, submittedInputSignature: signature });
  const run = { ...INITIAL_COMPARISON_RUN_STATE, phase: "running" as const, jobId: "job-1", latestJob: job(), maximumObservedProgressPercent: 25 };
  const workspace = { version: 1 as const, activePage: "Comparison Mode", dataset, dispatchStrategy: dispatch, battery: null, setup: null, runState: { phase: "ready" as const, jobId: null, latestJob: null, error: null, startedAt: null, finishedAt: null, reconnecting: false }, selectedBatteryId: null, selectedMode: "comparison" as const, activeOptimizationStep: "mode-selection", operationalProfileDate: null, comparisonAhp: null, comparisonConfiguration: configuration, comparisonRunState: run, comparisonOptimization: comparison, promethee: null };
  writePersistedWorkspaceState(storage, workspace);
  const restored = readPersistedWorkspaceState(storage);
  assert.deepEqual(restored?.comparisonConfiguration, configuration);
  assert.deepEqual(restored?.comparisonRunState, run);
  assert.deepEqual(restored?.comparisonOptimization, comparison);
});

test("fewer than two feasible alternatives blocks PROMETHEE while retaining infeasible alternatives", () => {
  const configuration = createDefaultComparisonConfiguration(catalogue);
  const signature = buildComparisonInputSignature(configuration, dataset, dispatch);
  const completedJob = job({ status: "completed", final_result: finalResult(1) });
  const snapshot = buildCompletedComparisonSnapshot(completedJob, { ...INITIAL_COMPARISON_RUN_STATE, submittedInputSignature: signature });
  const ahp = { matrix: Array.from({ length: 6 }, () => Array(6).fill(1)), calculation: { columnSums: [], normalizedMatrix: [], weights: Array(6).fill(1 / 6), lambdaMax: 6, consistencyIndex: 0, randomIndex: 1.24, consistencyRatio: 0, status: "ACCEPTABLE" as const }, accepted: true, revision: 2, calculatedAt: "now" };
  assert.equal(snapshot.finalResult.battery_results.length, 3);
  assert.equal(snapshot.finalResult.battery_results.filter((entry) => !entry.is_feasible).length, 2);
  assert.equal(hasPrometheePrerequisites(snapshot, ahp), false);
});
