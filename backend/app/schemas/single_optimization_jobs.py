from math import ceil, floor
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.schemas.single_optimization import (
    SelectedBatteryParameters,
    SingleOptimizationEconomicSettings,
    SingleOptimizationEvaluationResponse,
    SingleOptimizationValidationWarning,
    StrictRequestModel,
)


JobStatus = Literal["queued", "running", "completed", "failed", "cancelled"]


class SingleOptimizationGASettings(StrictRequestModel):
    population_size: int = Field(ge=4)
    generations: int = Field(ge=1)
    mutation_probability: float = Field(ge=0, le=1)
    elite_count: int = Field(ge=1)
    random_seed: int

    @model_validator(mode="after")
    def validate_elite_count(self) -> "SingleOptimizationGASettings":
        if self.elite_count >= self.population_size:
            raise ValueError("elite_count must be less than population_size.")
        return self


class SingleOptimizationRunRequest(StrictRequestModel):
    dataset_id: str = Field(min_length=1, max_length=100)
    battery: SelectedBatteryParameters
    economic_settings: SingleOptimizationEconomicSettings
    dispatch_strategy_status: Literal["Reference Strategy", "Modified Strategy"]
    minimum_bess_capacity_kwh: float = Field(ge=0, le=10_000)
    maximum_bess_capacity_kwh: float = Field(gt=0, le=10_000)
    minimum_peak_support_pct: float = Field(ge=0, le=100)
    maximum_peak_support_pct: float = Field(ge=0, le=100)
    ga_settings: SingleOptimizationGASettings

    @model_validator(mode="after")
    def validate_search_bounds(self) -> "SingleOptimizationRunRequest":
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

        first_effective_capacity = (
            ceil(self.minimum_bess_capacity_kwh / 100.0) * 100.0
        )
        last_effective_capacity = (
            floor(self.maximum_bess_capacity_kwh / 100.0) * 100.0
        )
        if first_effective_capacity > last_effective_capacity:
            raise ValueError(
                "The capacity bounds must contain at least one 100 kWh capacity "
                "supported by the reference evaluator."
            )
        return self


class SingleOptimizationRunAccepted(BaseModel):
    model_config = ConfigDict(extra="forbid")

    job_id: str
    status: Literal["queued"]


class SingleOptimizationConvergencePoint(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    generation: int = Field(ge=1)
    best_fitness_rs: float
    best_total_annual_cost_rs: float
    average_fitness_rs: float
    feasible_candidate_count: int = Field(ge=0)
    best_is_feasible: bool
    best_capacity_kwh: float
    best_peak_support_pct: float


class SingleOptimizationFinalResult(SingleOptimizationEvaluationResponse):
    solution_status: Literal[
        "feasible_solution",
        "no_feasible_candidate",
    ]
    solution_message: str
    best_bess_capacity_kwh: float
    best_peak_support_pct: float
    best_total_annual_cost_rs: float
    best_fitness_rs: float
    ga_generations_completed: int = Field(ge=0)
    total_fitness_evaluations: int = Field(ge=0)
    convergence_history: list[SingleOptimizationConvergencePoint]
    runtime_seconds: float = Field(ge=0)
    input_battery_configuration: SelectedBatteryParameters
    input_economic_configuration: SingleOptimizationEconomicSettings
    warnings: list[SingleOptimizationValidationWarning]


class SingleOptimizationJobResponse(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    job_id: str
    status: JobStatus
    progress_percent: float = Field(ge=0, le=100)
    current_generation: int = Field(ge=0)
    total_generations: int = Field(ge=1)
    evaluations_completed: int = Field(ge=0)
    estimated_total_evaluations: int = Field(ge=1)
    current_best_capacity_kwh: float | None
    current_best_peak_support_pct: float | None
    current_best_total_annual_cost_rs: float | None
    current_best_fitness_rs: float | None
    current_best_is_feasible: bool | None
    error: str | None
    final_result: SingleOptimizationFinalResult | None


class SingleOptimizationCancelResponse(SingleOptimizationJobResponse):
    cancellation_requested: bool
