from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.schemas.single_optimization import (
    SelectedBatteryParameters,
    SingleOptimizationEconomicSettings,
    SingleOptimizationValidationWarning,
    StrictRequestModel,
)
from app.schemas.single_optimization_jobs import (
    SingleOptimizationConvergencePoint,
    SingleOptimizationGASettings,
)


class ComparisonOptimizationBatteryOption(StrictRequestModel):
    enabled: bool = True
    battery: SelectedBatteryParameters


class ComparisonOptimizationRunRequest(StrictRequestModel):
    dataset_id: str = Field(min_length=1, max_length=100)
    batteries: list[ComparisonOptimizationBatteryOption] = Field(min_length=2)
    economic_settings: SingleOptimizationEconomicSettings
    dispatch_strategy_status: Literal["Reference Strategy", "Modified Strategy"]
    minimum_bess_capacity_kwh: float = Field(ge=0, le=10_000)
    maximum_bess_capacity_kwh: float = Field(gt=0, le=10_000)
    minimum_peak_support_pct: float = Field(ge=0, le=100)
    maximum_peak_support_pct: float = Field(ge=0, le=100)
    ga_settings: SingleOptimizationGASettings

    @model_validator(mode="after")
    def validate_search_bounds(self) -> "ComparisonOptimizationRunRequest":
        if self.maximum_bess_capacity_kwh <= self.minimum_bess_capacity_kwh:
            raise ValueError(
                "maximum_bess_capacity_kwh must be greater than "
                "minimum_bess_capacity_kwh."
            )
        if self.maximum_peak_support_pct <= self.minimum_peak_support_pct:
            raise ValueError(
                "maximum_peak_support_pct must be greater than "
                "minimum_peak_support_pct."
            )
        if sum(option.enabled for option in self.batteries) < 2:
            raise ValueError("At least two battery alternatives must be enabled.")
        return self


class ComparisonOptimizationRunAccepted(BaseModel):
    model_config = ConfigDict(extra="forbid")

    job_id: str
    status: Literal["queued"]


class ComparisonOptimizationBatteryResult(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    battery_name: str
    input_battery_configuration: SelectedBatteryParameters
    input_economic_configuration: dict[str, object] = Field(default_factory=dict)
    best_bess_capacity_kwh: float
    best_peak_support_pct: float
    best_total_annual_cost_rs: float
    best_fitness_rs: float
    solution_status: Literal["feasible_solution", "no_feasible_candidate"]
    solution_message: str
    ga_generations_completed: int = Field(ge=0)
    total_fitness_evaluations: int = Field(ge=0)
    convergence_history: list[SingleOptimizationConvergencePoint]
    runtime_seconds: float = Field(ge=0)
    total_annual_cost_Rs: float
    cycle_based_life_years: float
    round_trip_efficiency: float
    weight_density_kg_per_kwh: float
    bess_om_cost_annual_Rs: float
    warranty_years: float
    warnings: list[SingleOptimizationValidationWarning] = Field(default_factory=list)
    annual_grid_import_kwh: float = 0.0
    annual_pv_export_kwh: float = 0.0
    annual_bess_charge_kwh: float = 0.0
    annual_bess_discharge_kwh: float = 0.0
    equivalent_cycles_per_year: float = 0.0
    replacement_years: list[float] = Field(default_factory=list)
    annualized_bess_lifecycle_cost_rs: float = 0.0
    annual_om_cost_rs: float = 0.0
    annual_grid_cost_rs: float = 0.0
    annual_export_revenue_rs: float = 0.0
    peak_support_success_pct: float = 0.0
    pv_self_consumption_pct: float = 0.0
    peak_support_threshold_pct: float = 95.0
    pv_self_consumption_threshold_pct: float = 40.0
    peak_support_constraint_passed: bool = False
    pv_self_consumption_constraint_passed: bool = False
    failed_constraints: list[
        Literal["peak_support", "pv_self_consumption"]
    ] = Field(default_factory=list)
    peak_support_penalty_rs: float = 0.0
    pv_self_consumption_penalty_rs: float = 0.0
    total_penalty_rs: float = 0.0
    is_feasible: bool = False
    minimum_soc_pct: float = 0.0
    maximum_soc_pct: float = 0.0


class ComparisonOptimizationFinalResult(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    battery_results: list[ComparisonOptimizationBatteryResult]
    comparison_solution_status: Literal[
        "completed_all_batteries",
        "completed_with_infeasible_alternatives",
    ]
    feasible_battery_count: int = Field(ge=0)
    infeasible_battery_count: int = Field(ge=0)


class ComparisonOptimizationJobResponse(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    job_id: str
    status: Literal[
        "queued", "running", "cancelling", "completed", "failed", "cancelled"
    ]
    progress_percent: float = Field(ge=0, le=100)
    overall_progress_percent: float = Field(ge=0, le=100)
    current_generation: int = Field(ge=0)
    total_generations: int = Field(ge=1)
    evaluations_completed: int = Field(ge=0)
    estimated_total_evaluations: int = Field(ge=1)
    current_battery_index: int = Field(ge=0)
    current_battery_id: str | None = None
    current_battery_name: str | None = None
    current_battery_evaluations_completed: int = Field(ge=0)
    current_battery_estimated_evaluations: int = Field(ge=0)
    total_evaluations_completed: int = Field(ge=0)
    total_estimated_evaluations: int = Field(ge=1)
    completed_battery_count: int = Field(ge=0)
    total_batteries: int = Field(ge=1)
    current_best_capacity_kwh: float | None = None
    current_best_peak_support_pct: float | None = None
    current_best_total_annual_cost_rs: float | None = None
    current_best_raw_cost_rs: float | None = None
    current_best_fitness_rs: float | None = None
    current_best_is_feasible: bool | None = None
    battery_results: list[ComparisonOptimizationBatteryResult] = Field(default_factory=list)
    partial_results: list[ComparisonOptimizationBatteryResult] = Field(default_factory=list)
    error: str | None = None
    final_result: ComparisonOptimizationFinalResult | None = None


class ComparisonOptimizationCancelResponse(ComparisonOptimizationJobResponse):
    cancellation_requested: bool
