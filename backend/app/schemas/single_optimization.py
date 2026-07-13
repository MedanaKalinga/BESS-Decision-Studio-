from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class StrictRequestModel(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        allow_inf_nan=False,
        str_strip_whitespace=True,
        strict=True,
    )


class SelectedBatteryParameters(StrictRequestModel):
    name: str = Field(min_length=1, max_length=200)
    price_rs_per_kwh: float = Field(gt=0)
    rated_cycle_life: float = Field(gt=0)
    eta_ch: float = Field(gt=0, le=1)
    eta_dis: float = Field(gt=0, le=1)
    weight_density_kg_per_kwh: float = Field(gt=0)
    warranty_years: float = Field(ge=0)


class SingleOptimizationEconomicSettings(StrictRequestModel):
    project_life_years: int = Field(gt=0)
    discount_rate: float = Field(
        ge=0,
        le=1,
        description=(
            "Fractional discount rate used directly for present-value and "
            "annualization calculations; 0.10 means 10%."
        ),
    )
    export_tariff_rs_per_kwh: float = Field(ge=0)
    annual_om_fraction: float = Field(
        ge=0,
        le=1,
        description="Annual O&M as a fraction of initial battery CAPEX.",
    )
    replacement_cost_fraction: float = Field(
        ge=0,
        le=1,
        description="Replacement cost as a fraction of initial battery CAPEX.",
    )
    residual_value_enabled: bool


class SingleOptimizationEvaluationRequest(StrictRequestModel):
    dataset_id: str = Field(min_length=1, max_length=100)
    battery: SelectedBatteryParameters
    bess_capacity_kwh: float = Field(gt=0)
    peak_support_pct: float = Field(ge=0, le=100)
    economic_settings: SingleOptimizationEconomicSettings
    dispatch_strategy_status: Literal["Reference Strategy", "Modified Strategy"]


class SingleOptimizationValidationWarning(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str
    message: str


class SingleOptimizationEvaluationResponse(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    bess_capacity_kwh: float
    peak_support_pct: float
    battery_name: str
    round_trip_efficiency: float
    annual_grid_import_kwh: float
    annual_pv_export_kwh: float
    annual_bess_charge_kwh: float
    annual_bess_discharge_kwh: float
    equivalent_cycles_per_year: float
    cycle_based_life_years: float
    replacement_years: list[float]
    annualized_bess_lifecycle_cost_rs: float
    annual_om_cost_rs: float
    annual_grid_cost_rs: float
    annual_export_revenue_rs: float
    total_annual_cost_rs: float
    peak_support_success_pct: float
    pv_self_consumption_pct: float
    peak_support_threshold_pct: float
    pv_self_consumption_threshold_pct: float
    peak_support_constraint_passed: bool
    pv_self_consumption_constraint_passed: bool
    is_feasible: bool
    peak_support_penalty_rs: float
    pv_self_consumption_penalty_rs: float
    total_penalty_rs: float
    fitness_rs: float
    minimum_soc_pct: float
    maximum_soc_pct: float
    validation_warnings: list[SingleOptimizationValidationWarning]
