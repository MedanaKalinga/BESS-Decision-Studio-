export interface WorkspaceDatasetSummary {
  datasetId: string;
  filename: string;
  rowCount: number;
  datasetType: "normal_year" | "leap_year" | "partial" | string;
  status: "ready" | "expired";
  startDate: string;
  endDate: string;
  annualPvEnergyKwh: number;
  annualEvEnergyKwh: number;
  pvPeakKw: number;
  evPeakKw: number;
  intervalMinutes: number;
  durationDays: number | null;
  timestampsGenerated: boolean;
  notice: string | null;
  detectedColumns: {
    timestamp: string | null;
    pv: string;
    ev: string;
    tariff: string | null;
  };
}

export interface WorkspaceDispatchPeriod {
  name: string;
  start: string;
  end: string;
  evSupplyPriority: string[];
  excessPvPriority: string[];
  bessChargeAllowed: boolean;
  bessDischargeAllowed: boolean;
  exportAllowed: boolean;
  peakShareControlled: boolean;
}

export interface WorkspaceDispatchStrategy {
  status: "Reference Strategy" | "Modified Strategy";
  periods: WorkspaceDispatchPeriod[];
}

export type AHPConsistencyStatus = "ACCEPTABLE" | "REVIEW REQUIRED";

export interface AHPCalculationResult {
  columnSums: number[];
  normalizedMatrix: number[][];
  weights: number[];
  lambdaMax: number;
  consistencyIndex: number;
  randomIndex: number;
  consistencyRatio: number;
  status: AHPConsistencyStatus;
}

export interface ComparisonAHPWorkspaceState {
  matrix: number[][];
  calculation: AHPCalculationResult | null;
  accepted: boolean;
  revision: number;
  calculatedAt: string | null;
  acceptedAt?: string | null;
  projectId?: string;
  linkedDatasetId?: string | null;
  linkedComparisonRevision?: string | null;
  scientificConfigurationVersion?: number;
  incompatible?: boolean;
  incompatibilityReason?: string | null;
}

export interface ComparisonBatteryConfiguration {
  name: string;
  price_rs_per_kwh: number;
  rated_cycle_life: number;
  eta_ch: number;
  eta_dis: number;
  weight_density_kg_per_kwh: number;
  warranty_years: number;
}

export interface ComparisonBatteryOption {
  id: string;
  enabled: boolean;
  battery: ComparisonBatteryConfiguration;
}

export interface ComparisonGASettings {
  populationSize: number;
  generations: number;
  mutationProbability: number;
  eliteCount: number;
  randomSeed: number;
}

export interface ComparisonEconomicSettings {
  projectLifeYears: number;
  discountRate: number;
  exportTariffRsPerKwh: number;
  annualOmFraction: number;
  replacementCostFraction: number;
  residualValueEnabled: boolean;
}

export interface ComparisonOptimizationConfiguration {
  revision: number;
  batteryConfigurationRevision: number;
  batteries: ComparisonBatteryOption[];
  minimumBessCapacityKwh: number;
  maximumBessCapacityKwh: number;
  minimumPeakSupportPct: number;
  maximumPeakSupportPct: number;
  gaSettings: ComparisonGASettings;
  economicSettings: ComparisonEconomicSettings;
  savedAt: string | null;
  workflowStep?: number;
}

export interface ComparisonBatteryResult {
  battery_name: string;
  input_battery_configuration: ComparisonBatteryConfiguration;
  best_bess_capacity_kwh: number;
  best_peak_support_pct: number;
  best_total_annual_cost_rs: number;
  best_fitness_rs: number;
  solution_status: "feasible_solution" | "no_feasible_candidate";
  solution_message: string;
  ga_generations_completed: number;
  total_fitness_evaluations: number;
  runtime_seconds: number;
  cycle_based_life_years: number;
  equivalent_cycles_per_year?: number;
  round_trip_efficiency: number;
  weight_density_kg_per_kwh: number;
  warranty_years: number;
  annual_om_cost_rs: number;
  failed_constraints: string[];
  total_penalty_rs: number;
  is_feasible: boolean;
  peak_support_success_pct: number;
  pv_self_consumption_pct: number;
  replacement_years: number[];
}

export interface ComparisonOptimizationFinalResult {
  battery_results: ComparisonBatteryResult[];
  comparison_solution_status:
    | "completed_all_batteries"
    | "completed_with_infeasible_alternatives";
  feasible_battery_count: number;
  infeasible_battery_count: number;
}

export interface ComparisonOptimizationWorkspaceState {
  jobId: string;
  status: "completed";
  revision: string;
  batteryConfigurationSignature: string;
  inputSignature: string;
  submittedConfigurationRevision: number;
  submittedBatteryConfigurationRevision: number;
  stale: boolean;
  finalResult: ComparisonOptimizationFinalResult;
  completedAt: string;
  projectId?: string;
  datasetId?: string;
}

export type ComparisonJobLifecycleStatus =
  | "queued"
  | "running"
  | "cancelling"
  | "completed"
  | "failed"
  | "cancelled";

export interface ComparisonOptimizationJobResponse {
  job_id: string;
  status: ComparisonJobLifecycleStatus;
  progress_percent: number;
  overall_progress_percent: number;
  current_generation: number;
  total_generations: number;
  evaluations_completed: number;
  estimated_total_evaluations: number;
  current_battery_index: number;
  current_battery_id: string | null;
  current_battery_name: string | null;
  current_battery_evaluations_completed: number;
  current_battery_estimated_evaluations: number;
  total_evaluations_completed: number;
  total_estimated_evaluations: number;
  completed_battery_count: number;
  total_batteries: number;
  current_best_capacity_kwh: number | null;
  current_best_peak_support_pct: number | null;
  current_best_total_annual_cost_rs: number | null;
  current_best_raw_cost_rs: number | null;
  current_best_fitness_rs: number | null;
  current_best_is_feasible: boolean | null;
  battery_results: ComparisonBatteryResult[];
  partial_results: ComparisonBatteryResult[];
  error: string | null;
  final_result: ComparisonOptimizationFinalResult | null;
}

export type ComparisonRunPhase =
  | "ready"
  | "submitting"
  | ComparisonJobLifecycleStatus
  | "expired";

export interface ComparisonRunError {
  code?: string;
  message: string;
}

export interface ComparisonRunWorkspaceState {
  phase: ComparisonRunPhase;
  jobId: string | null;
  submittedConfigurationRevision: number | null;
  submittedBatteryConfigurationRevision: number | null;
  submittedInputSignature: string | null;
  latestJob: ComparisonOptimizationJobResponse | null;
  maximumObservedProgressPercent: number;
  error: ComparisonRunError | null;
  startedAt: number | null;
  finishedAt: number | null;
  reconnecting: boolean;
}

export type PrometheeScientificStatus =
  | "ranking_completed"
  | "insufficient_feasible_alternatives"
  | "no_feasible_alternatives";

export interface PrometheeExcludedAlternative {
  battery_name: string;
  solution_status: "feasible_solution" | "no_feasible_candidate";
  failed_constraints: string[];
}

export interface PrometheeRankedAlternative {
  battery_name: string;
  rank: number;
  positive_flow: number;
  negative_flow: number;
  net_flow: number;
}

export interface PrometheeCalculationResult {
  scientific_status: PrometheeScientificStatus;
  accepted_ahp_revision: number | string | null;
  criteria_order: string[];
  criterion_directions: Array<"minimize" | "maximize">;
  normalized_weights: number[];
  raw_decision_matrix: number[][];
  observed_ranges: number[];
  q_thresholds: number[];
  p_thresholds: number[];
  feasible_alternative_names: string[];
  excluded_alternatives: PrometheeExcludedAlternative[];
  criterion_preference_matrices: Record<string, number[][]>;
  aggregated_preference_matrix: number[][];
  positive_flows: number[];
  negative_flows: number[];
  net_flows: number[];
  ordered_ranking: PrometheeRankedAlternative[];
  recommended_battery: string | null;
}

export interface PrometheeWorkspaceState {
  result: PrometheeCalculationResult;
  comparisonRevision: string;
  batteryConfigurationSignature: string;
  ahpRevision: number;
  calculatedAt: string;
  stale?: boolean;
  projectId?: string;
  datasetId?: string | null;
  scientificConfigurationVersion?: number;
  incompatible?: boolean;
  incompatibilityReason?: string | null;
}

export interface SingleBatteryConfigurationSnapshot {
  catalogueName: string;
  batteryName: string;
  priceRsPerKwh: number;
  ratedCycleLife: number;
  etaCh: number;
  etaDis: number;
  weightDensityKgPerKwh: number;
  warrantyYears: number;
  modifiedFromCatalogue: boolean;
}

export interface SingleOptimizationSetupSnapshot {
  minimumBessCapacityKwh: number;
  maximumBessCapacityKwh: number;
  minimumPeakSupportPct: number;
  maximumPeakSupportPct: number;
  populationSize: number;
  generations: number;
  mutationProbability: number;
  eliteCount: number;
  randomSeed: number;
  projectLifeYears: number;
  discountRate: number;
  exportTariffRsPerKwh: number;
  annualOmFraction: number;
  replacementCostFraction: number;
  residualValueEnabled: boolean;
}

export interface SingleOptimizationConvergencePoint {
  generation: number;
  best_fitness_rs: number;
  best_total_annual_cost_rs: number;
  average_fitness_rs: number;
  feasible_candidate_count: number;
  best_is_feasible: boolean;
  best_capacity_kwh: number;
  best_peak_support_pct: number;
}

export interface SingleOptimizationWarning {
  code: string;
  message: string;
}

export interface SingleOptimizationFinalResult {
  solution_status: "feasible_solution" | "no_feasible_candidate";
  solution_message: string;
  best_bess_capacity_kwh: number;
  best_peak_support_pct: number;
  best_total_annual_cost_rs: number;
  best_fitness_rs: number;
  bess_capacity_kwh: number;
  peak_support_pct: number;
  battery_name: string;
  round_trip_efficiency: number;
  annual_grid_import_kwh: number;
  annual_pv_export_kwh: number;
  annual_bess_charge_kwh: number;
  annual_bess_discharge_kwh: number;
  equivalent_cycles_per_year: number;
  cycle_based_life_years: number;
  replacement_years: number[];
  annualized_bess_lifecycle_cost_rs: number;
  annual_om_cost_rs: number;
  annual_grid_cost_rs: number;
  annual_export_revenue_rs: number;
  total_annual_cost_rs: number;
  peak_support_success_pct: number;
  pv_self_consumption_pct: number;
  peak_support_threshold_pct: number;
  pv_self_consumption_threshold_pct: number;
  peak_support_constraint_passed: boolean;
  pv_self_consumption_constraint_passed: boolean;
  is_feasible: boolean;
  peak_support_penalty_rs: number;
  pv_self_consumption_penalty_rs: number;
  total_penalty_rs: number;
  fitness_rs: number;
  minimum_soc_pct: number;
  maximum_soc_pct: number;
  validation_warnings: SingleOptimizationWarning[];
  ga_generations_completed: number;
  total_fitness_evaluations: number;
  convergence_history: SingleOptimizationConvergencePoint[];
  runtime_seconds: number;
  input_battery_configuration: {
    name: string;
    price_rs_per_kwh: number;
    rated_cycle_life: number;
    eta_ch: number;
    eta_dis: number;
    weight_density_kg_per_kwh: number;
    warranty_years: number;
  };
  input_economic_configuration: {
    project_life_years: number;
    discount_rate: number;
    export_tariff_rs_per_kwh: number;
    annual_om_fraction: number;
    replacement_cost_fraction: number;
    residual_value_enabled: boolean;
  };
  warnings: SingleOptimizationWarning[];
}

export type SingleOptimizationJobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface SingleOptimizationJobResponse {
  job_id: string;
  status: SingleOptimizationJobStatus;
  progress_percent: number;
  current_generation: number;
  total_generations: number;
  evaluations_completed: number;
  estimated_total_evaluations: number;
  current_best_capacity_kwh: number | null;
  current_best_peak_support_pct: number | null;
  current_best_total_annual_cost_rs: number | null;
  current_best_fitness_rs: number | null;
  current_best_is_feasible: boolean | null;
  error: string | null;
  final_result: SingleOptimizationFinalResult | null;
}

export type SingleOptimizationRunPhase =
  | "ready"
  | "submitting"
  | "queued"
  | "running"
  | "cancelling"
  | "completed"
  | "failed"
  | "cancelled";

export interface SingleOptimizationRunError {
  code?: string;
  message: string;
}

export interface SingleOptimizationRunWorkspaceState {
  phase: SingleOptimizationRunPhase;
  jobId: string | null;
  latestJob: SingleOptimizationJobResponse | null;
  error: SingleOptimizationRunError | null;
  startedAt: number | null;
  finishedAt: number | null;
  reconnecting: boolean;
}

export interface OperationalProfilePoint {
  timestamp: string;
  pv_kw: number;
  ev_kw: number;
  grid_import_kw: number;
  pv_export_kw: number;
  bess_charge_kw: number;
  bess_discharge_kw: number;
  bess_net_power_kw: number;
  soc_pct: number;
}

export interface OperationalProfileDailySummary {
  pv_energy_kwh: number;
  ev_energy_kwh: number;
  grid_import_energy_kwh: number;
  pv_export_energy_kwh: number;
  bess_charge_energy_kwh: number;
  bess_discharge_energy_kwh: number;
  minimum_soc_pct: number;
  maximum_soc_pct: number;
}

export interface PersistedWorkspaceState {
  version: 1;
  projectId?: string;
  activeDatasetId?: string | null;
  persistenceRevision?: number;
  updatedAt?: string;
  activePage: string;
  dataset: WorkspaceDatasetSummary | null;
  dispatchStrategy: WorkspaceDispatchStrategy;
  battery: SingleBatteryConfigurationSnapshot | null;
  setup: SingleOptimizationSetupSnapshot | null;
  runState: SingleOptimizationRunWorkspaceState;
  selectedBatteryId: string | null;
  selectedMode: "single" | "comparison" | null;
  activeOptimizationStep: string | null;
  operationalProfileDate: string | null;
  datasetExplorerDate: string | null;
  comparisonAhp: ComparisonAHPWorkspaceState | null;
  comparisonConfiguration: ComparisonOptimizationConfiguration | null;
  comparisonRunState: ComparisonRunWorkspaceState;
  comparisonOptimization: ComparisonOptimizationWorkspaceState | null;
  promethee: PrometheeWorkspaceState | null;
}

export interface SingleOptimizationOperationalProfile {
  job_id: string;
  dataset_id: string;
  date: string;
  battery_name: string;
  bess_capacity_kwh: number;
  peak_support_pct: number;
  soc_min_limit_pct: number;
  soc_max_limit_pct: number;
  points: OperationalProfilePoint[];
  daily_summary: OperationalProfileDailySummary;
}
