import { AHP_CRITERIA, SCIENTIFIC_CONFIGURATION_VERSION } from "./comparisonAhp.ts";
import type {
  ComparisonAHPWorkspaceState,
  ComparisonBatteryResult,
  ComparisonOptimizationFinalResult,
  ComparisonOptimizationWorkspaceState,
  PrometheeCalculationResult,
  PrometheeScientificStatus,
  PrometheeWorkspaceState,
} from "../types/workspace";

export const PROMETHEE_CRITERIA_ORDER = AHP_CRITERIA.map((criterion) => criterion.id);
export const PROMETHEE_CRITERION_DIRECTIONS = AHP_CRITERIA.map((criterion) =>
  criterion.direction.toLowerCase() as "minimize" | "maximize",
);

export interface PrometheeRequestAlternative {
  battery_name: string;
  solution_status: "feasible_solution" | "no_feasible_candidate";
  failed_constraints: string[];
  is_feasible: boolean;
  total_annual_cost_rs: number;
  cycle_based_life_years: number;
  round_trip_efficiency: number;
  weight_density_kg_per_kwh: number;
  warranty_years: number;
}

export interface PrometheeCalculationRequest {
  alternatives: PrometheeRequestAlternative[];
  ahp_weights: number[];
  accepted_ahp_revision: number;
}

export interface ComparisonScientificContext {
  projectId: string;
  datasetId: string | null;
}

export interface PrometheeCalculationOptions {
  comparison: ComparisonOptimizationWorkspaceState;
  ahp: ComparisonAHPWorkspaceState;
  context: ComparisonScientificContext;
  signal?: AbortSignal;
  fetcher?: typeof fetch;
}

export function buildPrometheeWorkflowHeaders(
  context: ComparisonScientificContext,
  comparisonRevision: string,
  ahpRevision: number,
): Record<string, string> {
  return {
    "X-Project-ID": context.projectId,
    "X-Dataset-ID": context.datasetId ?? "",
    "X-Comparison-Revision": comparisonRevision,
    "X-AHP-Revision": String(ahpRevision),
  };
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function finiteArray(value: unknown, length?: number): value is number[] {
  return Array.isArray(value)
    && (length === undefined || value.length === length)
    && value.every(finite);
}

export function isValidComparisonBatteryResult(value: unknown): value is ComparisonBatteryResult {
  if (!value || typeof value !== "object") return false;
  const result = value as ComparisonBatteryResult;
  const configuration = result.input_battery_configuration;
  const numericValues = [
    result.best_bess_capacity_kwh,
    result.best_peak_support_pct,
    result.best_total_annual_cost_rs,
    result.cycle_based_life_years,
    result.round_trip_efficiency,
    result.weight_density_kg_per_kwh,
    result.annual_om_cost_rs,
    result.warranty_years,
    result.total_penalty_rs,
    result.best_fitness_rs,
    result.ga_generations_completed,
    result.total_fitness_evaluations,
    result.runtime_seconds,
    result.peak_support_success_pct,
    result.pv_self_consumption_pct,
  ];
  return typeof result.battery_name === "string"
    && result.battery_name.trim().length > 0
    && Boolean(configuration)
    && typeof configuration.name === "string"
    && [configuration.price_rs_per_kwh, configuration.rated_cycle_life, configuration.eta_ch,
      configuration.eta_dis, configuration.weight_density_kg_per_kwh, configuration.warranty_years]
      .every(finite)
    && numericValues.every(finite)
    && result.round_trip_efficiency > 0
    && result.round_trip_efficiency <= 1
    && Array.isArray(result.failed_constraints)
    && result.failed_constraints.every((entry) => typeof entry === "string")
    && typeof result.is_feasible === "boolean"
    && typeof result.solution_message === "string"
    && Array.isArray(result.replacement_years)
    && result.replacement_years.every(finite)
    && (result.solution_status === "feasible_solution" || result.solution_status === "no_feasible_candidate")
    && result.is_feasible === (result.solution_status === "feasible_solution");
}

export function buildBatteryConfigurationSignature(results: ComparisonBatteryResult[]): string {
  return results.map((result) => {
    const battery = result.input_battery_configuration;
    return [battery.name, battery.price_rs_per_kwh, battery.rated_cycle_life, battery.eta_ch,
      battery.eta_dis, battery.weight_density_kg_per_kwh, battery.warranty_years].join(":");
  }).join("|");
}

export function buildComparisonRevision(result: ComparisonOptimizationFinalResult): string {
  const source = result.battery_results.map((battery) => [
    battery.battery_name,
    battery.best_bess_capacity_kwh,
    battery.best_peak_support_pct,
    battery.best_total_annual_cost_rs,
    battery.cycle_based_life_years,
    battery.round_trip_efficiency,
    battery.weight_density_kg_per_kwh,
    battery.annual_om_cost_rs,
    battery.warranty_years,
    battery.solution_status,
    battery.failed_constraints.join(","),
  ].join(":" )).join("|");
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `comparison-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function mapComparisonToPrometheeRequest(
  comparison: ComparisonOptimizationWorkspaceState,
  ahp: ComparisonAHPWorkspaceState,
): PrometheeCalculationRequest {
  if (comparison.status !== "completed" || comparison.finalResult.battery_results.length < 2) {
    throw new Error("A completed comparison with at least two alternatives is required.");
  }
  if (!ahp.accepted || ahp.calculation?.status !== "ACCEPTABLE") {
    throw new Error("Accepted, consistent AHP weights are required.");
  }
  if (!finiteArray(ahp.calculation.weights, AHP_CRITERIA.length)) {
    throw new Error("The accepted AHP result does not contain five finite weights.");
  }

  const alternatives = comparison.finalResult.battery_results
    .filter((battery) => battery.is_feasible)
    .map((battery) => {
    if (!isValidComparisonBatteryResult(battery)) {
      throw new Error("A comparison battery result is malformed.");
    }
    return {
      battery_name: battery.battery_name,
      solution_status: battery.solution_status,
      failed_constraints: [...battery.failed_constraints],
      is_feasible: battery.is_feasible,
      total_annual_cost_rs: battery.best_total_annual_cost_rs,
      cycle_based_life_years: battery.cycle_based_life_years,
      round_trip_efficiency: battery.round_trip_efficiency,
      weight_density_kg_per_kwh: battery.weight_density_kg_per_kwh,
      warranty_years: battery.warranty_years,
    } satisfies PrometheeRequestAlternative;
  });
  if (alternatives.length < 2) {
    throw new Error("At least two feasible GA-optimized alternatives are required.");
  }
  return {
    alternatives,
    ahp_weights: [...ahp.calculation.weights],
    accepted_ahp_revision: ahp.revision,
  };
}

export async function calculatePrometheeRanking({
  comparison,
  ahp,
  context,
  signal,
  fetcher = fetch,
}: PrometheeCalculationOptions): Promise<PrometheeWorkspaceState> {
  const response = await fetcher("/api/promethee/calculate", {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...buildPrometheeWorkflowHeaders(context, comparison.revision, ahp.revision),
    },
    body: JSON.stringify(mapComparisonToPrometheeRequest(comparison, ahp)),
    signal,
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = payload && typeof payload === "object" && "detail" in payload
      ? String((payload as { detail: unknown }).detail)
      : `PROMETHEE backend returned HTTP ${response.status}.`;
    throw new Error(`Final ranking failed (HTTP ${response.status}): ${detail}`);
  }
  if (!isValidPrometheeCalculationResult(payload)) {
    throw new Error("The PROMETHEE backend returned an invalid result contract.");
  }
  return {
    result: payload,
    comparisonRevision: comparison.revision,
    batteryConfigurationSignature: comparison.batteryConfigurationSignature,
    ahpRevision: ahp.revision,
    calculatedAt: new Date().toISOString(),
    projectId: context.projectId,
    datasetId: context.datasetId,
    scientificConfigurationVersion: SCIENTIFIC_CONFIGURATION_VERSION,
    incompatible: false,
    incompatibilityReason: null,
  };
}

export function isComparisonCurrent(
  comparison: ComparisonOptimizationWorkspaceState | null,
  context?: ComparisonScientificContext,
): boolean {
  if (comparison?.status !== "completed" || comparison.stale) return false;
  if (!context) return true;
  return comparison.projectId === context.projectId
    && comparison.datasetId === context.datasetId;
}

export function isAHPCurrent(
  ahp: ComparisonAHPWorkspaceState | null,
  comparison: ComparisonOptimizationWorkspaceState | null,
  context?: ComparisonScientificContext,
): boolean {
  if (!ahp?.accepted || ahp.incompatible
    || (ahp.scientificConfigurationVersion !== undefined
      && ahp.scientificConfigurationVersion !== SCIENTIFIC_CONFIGURATION_VERSION)
    || ahp.calculation?.status !== "ACCEPTABLE" || !comparison) return false;
  if (ahp.linkedComparisonRevision !== undefined
    && ahp.linkedComparisonRevision !== comparison.revision) return false;
  if (!context) return true;
  return ahp.projectId === context.projectId
    && ahp.linkedDatasetId === context.datasetId
    && ahp.linkedComparisonRevision === comparison.revision;
}

export function hasPrometheePrerequisites(
  comparison: ComparisonOptimizationWorkspaceState | null,
  ahp: ComparisonAHPWorkspaceState | null,
  context?: ComparisonScientificContext,
): boolean {
  if (!isComparisonCurrent(comparison, context)
    || !comparison
    || !isAHPCurrent(ahp, comparison, context)
    || !ahp?.calculation) return false;
  return comparison.finalResult.battery_results.filter((battery) => battery.is_feasible).length >= 2
    && ahp.calculation.weights.length === AHP_CRITERIA.length;
}

export function canEnterComparisonResults(
  comparison: ComparisonOptimizationWorkspaceState | null,
  ahp: ComparisonAHPWorkspaceState | null,
  context?: ComparisonScientificContext,
): boolean {
  return isComparisonCurrent(comparison, context)
    && isAHPCurrent(ahp, comparison, context);
}

export function comparisonRankingEligibility(
  comparison: ComparisonOptimizationWorkspaceState | null,
): "ranking_ready" | "insufficient_feasible_alternatives" | "no_feasible_alternatives" {
  const feasibleCount = comparison?.finalResult.battery_results.filter(
    (battery) => battery.is_feasible,
  ).length ?? 0;
  if (feasibleCount === 0) return "no_feasible_alternatives";
  if (feasibleCount === 1) return "insufficient_feasible_alternatives";
  return "ranking_ready";
}

export function isPrometheeResultStale(
  state: PrometheeWorkspaceState | null,
  comparison: ComparisonOptimizationWorkspaceState | null,
  ahp: ComparisonAHPWorkspaceState | null,
  context?: ComparisonScientificContext,
): boolean {
  if (!state) return false;
  if (state.incompatible
    || (state.scientificConfigurationVersion !== undefined
      && state.scientificConfigurationVersion !== SCIENTIFIC_CONFIGURATION_VERSION)) return true;
  if (!isComparisonCurrent(comparison, context) || !isAHPCurrent(ahp, comparison, context)) return true;
  if (!comparison || !ahp) return true;
  return Boolean(
    state.comparisonRevision !== comparison.revision
    || state.batteryConfigurationSignature !== comparison.batteryConfigurationSignature
    || state.ahpRevision !== ahp.revision
    || (context && (
      state.projectId !== context.projectId
      || state.datasetId !== context.datasetId
    )),
  );
}

export function findRecommendedStageOneResult(
  result: PrometheeCalculationResult | null,
  comparison: ComparisonOptimizationWorkspaceState | null,
): ComparisonBatteryResult | null {
  if (!result?.recommended_battery || !comparison) return null;
  return comparison.finalResult.battery_results.find(
    (battery) => battery.is_feasible && battery.battery_name === result.recommended_battery,
  ) ?? null;
}

export function shouldPresentRecommendation(
  status: PrometheeScientificStatus,
  recommendedBattery: string | null,
  stale: boolean,
): boolean {
  return status === "ranking_completed" && Boolean(recommendedBattery) && !stale;
}

export function shouldPresentRanking(status: PrometheeScientificStatus): boolean {
  return status === "ranking_completed";
}

export function isValidPrometheeCalculationResult(value: unknown): value is PrometheeCalculationResult {
  if (!value || typeof value !== "object") return false;
  const result = value as PrometheeCalculationResult;
  const validStatus = result.scientific_status === "ranking_completed"
    || result.scientific_status === "insufficient_feasible_alternatives"
    || result.scientific_status === "no_feasible_alternatives";
  const matricesValid = Array.isArray(result.raw_decision_matrix)
    && result.raw_decision_matrix.every((row) => finiteArray(row, AHP_CRITERIA.length))
    && Array.isArray(result.aggregated_preference_matrix)
    && result.aggregated_preference_matrix.every((row) => finiteArray(row));
  return validStatus
    && JSON.stringify(result.criteria_order) === JSON.stringify(PROMETHEE_CRITERIA_ORDER)
    && JSON.stringify(result.criterion_directions) === JSON.stringify(PROMETHEE_CRITERION_DIRECTIONS)
    && finiteArray(result.normalized_weights, AHP_CRITERIA.length)
    && finiteArray(result.observed_ranges, AHP_CRITERIA.length)
    && finiteArray(result.q_thresholds, AHP_CRITERIA.length)
    && result.q_thresholds.every((threshold) => threshold === 0)
    && finiteArray(result.p_thresholds, AHP_CRITERIA.length)
    && result.p_thresholds.every((threshold, index) => {
      const observedRange = result.observed_ranges[index];
      const expected = observedRange <= 1e-12 ? 1 : observedRange * 0.1;
      return Math.abs(threshold - expected) <= Math.max(1e-10, Math.abs(expected) * 1e-8);
    })
    && matricesValid
    && finiteArray(result.positive_flows)
    && finiteArray(result.negative_flows)
    && finiteArray(result.net_flows)
    && Array.isArray(result.ordered_ranking)
    && Array.isArray(result.excluded_alternatives);
}

export function sanitizeComparisonOptimizationState(
  value: unknown,
): ComparisonOptimizationWorkspaceState | null {
  if (!value || typeof value !== "object") return null;
  const state = value as ComparisonOptimizationWorkspaceState;
  if (state.status !== "completed" || typeof state.jobId !== "string" || typeof state.completedAt !== "string") return null;
  if (typeof state.inputSignature !== "string" || !Number.isInteger(state.submittedConfigurationRevision)
    || !Number.isInteger(state.submittedBatteryConfigurationRevision) || typeof state.stale !== "boolean") return null;
  if (!state.finalResult || !Array.isArray(state.finalResult.battery_results) || state.finalResult.battery_results.length < 2) return null;
  if (!state.finalResult.battery_results.every(isValidComparisonBatteryResult)) return null;
  const signature = buildBatteryConfigurationSignature(state.finalResult.battery_results);
  const revision = buildComparisonRevision(state.finalResult);
  if (state.batteryConfigurationSignature !== signature || state.revision !== revision) return null;
  return state;
}

export function sanitizePrometheeWorkspaceState(value: unknown): PrometheeWorkspaceState | null {
  if (!value || typeof value !== "object") return null;
  const state = value as PrometheeWorkspaceState;
  const rawResult: unknown = (value as { result?: unknown }).result;
  if (typeof state.comparisonRevision !== "string"
    || typeof state.batteryConfigurationSignature !== "string"
    || !Number.isInteger(state.ahpRevision)
    || typeof state.calculatedAt !== "string") return null;
  if (isValidPrometheeCalculationResult(rawResult)) {
    return {
      ...state,
      scientificConfigurationVersion: SCIENTIFIC_CONFIGURATION_VERSION,
      incompatible: false,
      incompatibilityReason: null,
    };
  }
  const legacyCriteria = rawResult && typeof rawResult === "object"
    ? (rawResult as { criteria_order?: unknown }).criteria_order
    : null;
  if (Array.isArray(legacyCriteria)
    && legacyCriteria.length === 6
    && legacyCriteria.includes("annual_om_cost_rs")) {
    return {
      ...state,
      stale: true,
      scientificConfigurationVersion: state.scientificConfigurationVersion ?? 2,
      incompatible: true,
      incompatibilityReason:
        "The saved ranking uses the previous six-criterion model and must be recalculated.",
    };
  }
  return null;
}
