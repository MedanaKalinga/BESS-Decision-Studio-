import type {
  ComparisonBatteryConfiguration,
  ComparisonBatteryOption,
  ComparisonOptimizationConfiguration,
  ComparisonOptimizationFinalResult,
  ComparisonOptimizationJobResponse,
  ComparisonOptimizationWorkspaceState,
  ComparisonRunWorkspaceState,
  WorkspaceDatasetSummary,
  WorkspaceDispatchStrategy,
} from "../types/workspace";
import {
  buildBatteryConfigurationSignature,
  buildComparisonRevision,
  isValidComparisonBatteryResult,
} from "./comparisonResults.ts";

export const INITIAL_COMPARISON_RUN_STATE: ComparisonRunWorkspaceState = {
  phase: "ready",
  jobId: null,
  submittedConfigurationRevision: null,
  submittedBatteryConfigurationRevision: null,
  submittedInputSignature: null,
  latestJob: null,
  maximumObservedProgressPercent: 0,
  error: null,
  startedAt: null,
  finishedAt: null,
  reconnecting: false,
};

export interface ComparisonOptimizationRunRequest {
  dataset_id: string;
  batteries: Array<{ enabled: true; battery: ComparisonBatteryConfiguration }>;
  economic_settings: {
    project_life_years: number;
    discount_rate: number;
    export_tariff_rs_per_kwh: number;
    annual_om_fraction: number;
    replacement_cost_fraction: number;
    residual_value_enabled: boolean;
  };
  dispatch_strategy_status: "Reference Strategy";
  minimum_bess_capacity_kwh: number;
  maximum_bess_capacity_kwh: number;
  minimum_peak_support_pct: number;
  maximum_peak_support_pct: number;
  ga_settings: {
    population_size: number;
    generations: number;
    mutation_probability: number;
    elite_count: number;
    random_seed: number;
  };
}

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

function batteryId(name: string, index: number): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${slug || "battery"}-${index + 1}`;
}

export function createDefaultComparisonConfiguration(
  batteries: ComparisonBatteryConfiguration[],
): ComparisonOptimizationConfiguration {
  return {
    revision: 1,
    batteryConfigurationRevision: 1,
    batteries: batteries.map((battery, index) => ({
      id: batteryId(battery.name, index),
      enabled: true,
      battery: { ...battery },
    })),
    minimumBessCapacityKwh: 2500,
    maximumBessCapacityKwh: 6000,
    minimumPeakSupportPct: 20,
    maximumPeakSupportPct: 50,
    gaSettings: {
      populationSize: 100,
      generations: 50,
      mutationProbability: 0.15,
      eliteCount: 5,
      randomSeed: 42,
    },
    economicSettings: {
      projectLifeYears: 25,
      discountRate: 0.10,
      exportTariffRsPerKwh: 21,
      annualOmFraction: 0.01,
      replacementCostFraction: 0.80,
      residualValueEnabled: false,
    },
    savedAt: null,
  };
}

export function reviseComparisonConfiguration(
  configuration: ComparisonOptimizationConfiguration,
  update: Partial<Omit<ComparisonOptimizationConfiguration, "revision" | "batteryConfigurationRevision">>,
  batteriesChanged = false,
): ComparisonOptimizationConfiguration {
  return {
    ...configuration,
    ...update,
    revision: configuration.revision + 1,
    batteryConfigurationRevision:
      configuration.batteryConfigurationRevision + (batteriesChanged ? 1 : 0),
    savedAt: null,
  };
}

export function enabledBatteryCount(configuration: ComparisonOptimizationConfiguration): number {
  return configuration.batteries.filter((option) => option.enabled).length;
}

export function estimatedComparisonEvaluations(
  configuration: ComparisonOptimizationConfiguration,
): number {
  return enabledBatteryCount(configuration)
    * configuration.gaSettings.populationSize
    * configuration.gaSettings.generations;
}

function validateBattery(option: ComparisonBatteryOption, index: number): string[] {
  const prefix = `Battery ${index + 1}`;
  const battery = option.battery;
  const errors: string[] = [];
  if (!battery.name.trim()) errors.push(`${prefix} needs a name.`);
  if (!finite(battery.price_rs_per_kwh) || battery.price_rs_per_kwh <= 0) errors.push(`${prefix} price must be greater than zero.`);
  if (!finite(battery.rated_cycle_life) || battery.rated_cycle_life <= 0) errors.push(`${prefix} rated cycle life must be greater than zero.`);
  if (!finite(battery.eta_ch) || battery.eta_ch <= 0 || battery.eta_ch > 1) errors.push(`${prefix} charge efficiency must be within (0, 1].`);
  if (!finite(battery.eta_dis) || battery.eta_dis <= 0 || battery.eta_dis > 1) errors.push(`${prefix} discharge efficiency must be within (0, 1].`);
  if (!finite(battery.weight_density_kg_per_kwh) || battery.weight_density_kg_per_kwh <= 0) errors.push(`${prefix} weight density must be greater than zero.`);
  if (!finite(battery.warranty_years) || battery.warranty_years < 0) errors.push(`${prefix} warranty cannot be negative.`);
  return errors;
}

export function validateComparisonConfiguration(
  configuration: ComparisonOptimizationConfiguration,
  dataset: WorkspaceDatasetSummary | null,
  dispatch: WorkspaceDispatchStrategy,
): string[] {
  const errors = configuration.batteries.flatMap(validateBattery);
  if (enabledBatteryCount(configuration) < 2) errors.push("Enable at least two battery alternatives.");
  if (!dataset?.datasetId) errors.push("Upload a valid dataset before starting the comparison.");
  if (dispatch.status !== "Reference Strategy") errors.push("The modified dispatch strategy is not scientifically connected yet.");
  if (!finite(configuration.minimumBessCapacityKwh) || configuration.minimumBessCapacityKwh <= 0) errors.push("Minimum BESS capacity must be greater than zero.");
  if (!finite(configuration.maximumBessCapacityKwh) || configuration.maximumBessCapacityKwh > 10_000 || configuration.maximumBessCapacityKwh <= configuration.minimumBessCapacityKwh) errors.push("Maximum BESS capacity must be greater than the minimum and no more than 10,000 kWh.");
  if (!finite(configuration.minimumPeakSupportPct) || configuration.minimumPeakSupportPct < 0 || configuration.minimumPeakSupportPct > 100) errors.push("Minimum peak support must be between 0% and 100%.");
  if (!finite(configuration.maximumPeakSupportPct) || configuration.maximumPeakSupportPct > 100 || configuration.maximumPeakSupportPct <= configuration.minimumPeakSupportPct) errors.push("Maximum peak support must be greater than the minimum and no more than 100%.");
  const ga = configuration.gaSettings;
  if (!Number.isInteger(ga.populationSize) || ga.populationSize < 4) errors.push("Population size must be a whole number of at least 4.");
  if (!Number.isInteger(ga.generations) || ga.generations < 1) errors.push("Generations must be a positive whole number.");
  if (!finite(ga.mutationProbability) || ga.mutationProbability < 0 || ga.mutationProbability > 1) errors.push("Mutation probability must be between 0 and 1.");
  if (!Number.isInteger(ga.eliteCount) || ga.eliteCount < 1 || ga.eliteCount >= ga.populationSize) errors.push("Elite count must be at least 1 and below population size.");
  if (!Number.isInteger(ga.randomSeed)) errors.push("Random seed must be a whole number.");
  const economics = configuration.economicSettings;
  if (!Number.isInteger(economics.projectLifeYears) || economics.projectLifeYears <= 0) errors.push("Project life must be a positive whole number.");
  if (!finite(economics.discountRate) || economics.discountRate < 0 || economics.discountRate > 1) errors.push("Discount rate must be between 0% and 100%.");
  if (!finite(economics.exportTariffRsPerKwh) || economics.exportTariffRsPerKwh < 0) errors.push("Export tariff cannot be negative.");
  if (!finite(economics.annualOmFraction) || economics.annualOmFraction < 0 || economics.annualOmFraction > 1) errors.push("Annual O&M must be between 0% and 100%.");
  if (!finite(economics.replacementCostFraction) || economics.replacementCostFraction < 0 || economics.replacementCostFraction > 1) errors.push("Replacement cost must be between 0% and 100%.");
  return [...new Set(errors)];
}

export function buildComparisonInputSignature(
  configuration: ComparisonOptimizationConfiguration,
  dataset: WorkspaceDatasetSummary | null,
  dispatch: WorkspaceDispatchStrategy,
): string {
  return JSON.stringify({
    datasetId: dataset?.datasetId ?? null,
    dispatchStatus: dispatch.status,
    batteries: configuration.batteries,
    bounds: [configuration.minimumBessCapacityKwh, configuration.maximumBessCapacityKwh,
      configuration.minimumPeakSupportPct, configuration.maximumPeakSupportPct],
    ga: configuration.gaSettings,
    economics: configuration.economicSettings,
  });
}

export function mapComparisonRunRequest(
  configuration: ComparisonOptimizationConfiguration,
  dataset: WorkspaceDatasetSummary | null,
  dispatch: WorkspaceDispatchStrategy,
): ComparisonOptimizationRunRequest {
  const errors = validateComparisonConfiguration(configuration, dataset, dispatch);
  if (errors.length) throw new Error(errors[0]);
  return {
    dataset_id: dataset!.datasetId,
    batteries: configuration.batteries
      .filter((option) => option.enabled)
      .map((option) => ({ enabled: true, battery: { ...option.battery } })),
    economic_settings: {
      project_life_years: configuration.economicSettings.projectLifeYears,
      discount_rate: configuration.economicSettings.discountRate,
      export_tariff_rs_per_kwh: configuration.economicSettings.exportTariffRsPerKwh,
      annual_om_fraction: configuration.economicSettings.annualOmFraction,
      replacement_cost_fraction: configuration.economicSettings.replacementCostFraction,
      residual_value_enabled: configuration.economicSettings.residualValueEnabled,
    },
    dispatch_strategy_status: "Reference Strategy",
    minimum_bess_capacity_kwh: configuration.minimumBessCapacityKwh,
    maximum_bess_capacity_kwh: configuration.maximumBessCapacityKwh,
    minimum_peak_support_pct: configuration.minimumPeakSupportPct,
    maximum_peak_support_pct: configuration.maximumPeakSupportPct,
    ga_settings: {
      population_size: configuration.gaSettings.populationSize,
      generations: configuration.gaSettings.generations,
      mutation_probability: configuration.gaSettings.mutationProbability,
      elite_count: configuration.gaSettings.eliteCount,
      random_seed: configuration.gaSettings.randomSeed,
    },
  };
}

export function isActiveComparisonRun(state: ComparisonRunWorkspaceState): boolean {
  return ["submitting", "queued", "running", "cancelling"].includes(state.phase);
}

export function mergeComparisonJobProgress(
  previous: ComparisonOptimizationJobResponse | null,
  next: ComparisonOptimizationJobResponse,
): ComparisonOptimizationJobResponse {
  if (!previous) return next;
  return {
    ...next,
    progress_percent: Math.max(previous.progress_percent, next.progress_percent),
    overall_progress_percent: Math.max(previous.overall_progress_percent, next.overall_progress_percent),
    total_evaluations_completed: Math.max(previous.total_evaluations_completed, next.total_evaluations_completed),
    partial_results: next.partial_results.length >= previous.partial_results.length
      ? next.partial_results
      : previous.partial_results,
  };
}

export function buildCompletedComparisonSnapshot(
  job: ComparisonOptimizationJobResponse,
  run: ComparisonRunWorkspaceState,
): ComparisonOptimizationWorkspaceState {
  if (job.status !== "completed" || !job.final_result) {
    throw new Error("A completed comparison final result is required.");
  }
  return {
    jobId: job.job_id,
    status: "completed",
    revision: buildComparisonRevision(job.final_result),
    batteryConfigurationSignature: buildBatteryConfigurationSignature(job.final_result.battery_results),
    inputSignature: run.submittedInputSignature ?? "",
    submittedConfigurationRevision: run.submittedConfigurationRevision ?? 0,
    submittedBatteryConfigurationRevision: run.submittedBatteryConfigurationRevision ?? 0,
    stale: false,
    finalResult: job.final_result,
    completedAt: new Date().toISOString(),
  };
}

export function expireComparisonRun(state: ComparisonRunWorkspaceState): ComparisonRunWorkspaceState {
  return {
    ...state,
    phase: "expired",
    jobId: null,
    reconnecting: false,
    finishedAt: Date.now(),
    error: { code: "COMPARISON_JOB_EXPIRED", message: "Comparison job expired. The saved configuration is still available and can be rerun." },
  };
}

export function synchronizeComparisonSnapshot(
  snapshot: ComparisonOptimizationWorkspaceState | null,
  currentInputSignature: string,
): ComparisonOptimizationWorkspaceState | null {
  if (!snapshot || snapshot.stale || snapshot.inputSignature === currentInputSignature) return snapshot;
  return { ...snapshot, stale: true };
}

export function transitionFromComparisonRunner(
  closeRunner: () => void,
  nextAction: () => void,
): void {
  closeRunner();
  nextAction();
}

export function isValidComparisonFinalResult(value: unknown): value is ComparisonOptimizationFinalResult {
  if (!value || typeof value !== "object") return false;
  const result = value as ComparisonOptimizationFinalResult;
  return Array.isArray(result.battery_results)
    && result.battery_results.length >= 2
    && result.battery_results.every(isValidComparisonBatteryResult)
    && (result.comparison_solution_status === "completed_all_batteries"
      || result.comparison_solution_status === "completed_with_infeasible_alternatives")
    && Number.isInteger(result.feasible_battery_count)
    && Number.isInteger(result.infeasible_battery_count)
    && result.feasible_battery_count + result.infeasible_battery_count === result.battery_results.length;
}

export function isValidComparisonJobResponse(value: unknown): value is ComparisonOptimizationJobResponse {
  if (!value || typeof value !== "object") return false;
  const job = value as ComparisonOptimizationJobResponse;
  const statuses = ["queued", "running", "cancelling", "completed", "failed", "cancelled"];
  return typeof job.job_id === "string"
    && statuses.includes(job.status)
    && finite(job.overall_progress_percent)
    && finite(job.total_evaluations_completed)
    && Number.isInteger(job.current_battery_index)
    && Number.isInteger(job.completed_battery_count)
    && Number.isInteger(job.total_batteries)
    && Array.isArray(job.partial_results)
    && job.partial_results.every(isValidComparisonBatteryResult)
    && (job.final_result === null || isValidComparisonFinalResult(job.final_result));
}

export function sanitizeComparisonConfiguration(value: unknown): ComparisonOptimizationConfiguration | null {
  if (!value || typeof value !== "object") return null;
  const configuration = value as ComparisonOptimizationConfiguration;
  if (!Number.isInteger(configuration.revision) || !Number.isInteger(configuration.batteryConfigurationRevision)) return null;
  if (!Array.isArray(configuration.batteries) || configuration.batteries.length < 2) return null;
  if (!configuration.batteries.every((option) => typeof option.id === "string" && typeof option.enabled === "boolean" && validateBattery(option, 0).length === 0)) return null;
  if (!configuration.gaSettings || !configuration.economicSettings) return null;
  return configuration;
}

export function sanitizeComparisonRunState(value: unknown): ComparisonRunWorkspaceState {
  if (!value || typeof value !== "object") return { ...INITIAL_COMPARISON_RUN_STATE };
  const state = value as ComparisonRunWorkspaceState;
  const phases = ["ready", "submitting", "queued", "running", "cancelling", "completed", "failed", "cancelled", "expired"];
  if (!phases.includes(state.phase) || (state.latestJob && !isValidComparisonJobResponse(state.latestJob))) return { ...INITIAL_COMPARISON_RUN_STATE };
  if (!finite(state.maximumObservedProgressPercent)) return { ...INITIAL_COMPARISON_RUN_STATE };
  return state;
}
