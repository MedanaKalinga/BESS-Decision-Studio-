export interface WorkspaceDatasetSummary {
  datasetId: string;
  filename: string;
  rowCount: number;
  datasetType: "normal_year" | "leap_year" | "partial" | string;
  startDate: string;
  endDate: string;
  annualPvEnergyKwh: number;
  annualEvEnergyKwh: number;
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
