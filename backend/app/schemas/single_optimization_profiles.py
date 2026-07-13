from pydantic import BaseModel, ConfigDict, Field


class OperationalProfilePoint(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    timestamp: str
    pv_kw: float
    ev_kw: float
    grid_import_kw: float
    pv_export_kw: float
    bess_charge_kw: float
    bess_discharge_kw: float
    bess_net_power_kw: float
    soc_pct: float = Field(ge=0, le=100)


class OperationalProfileDailySummary(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    pv_energy_kwh: float
    ev_energy_kwh: float
    grid_import_energy_kwh: float
    pv_export_energy_kwh: float
    bess_charge_energy_kwh: float
    bess_discharge_energy_kwh: float
    minimum_soc_pct: float = Field(ge=0, le=100)
    maximum_soc_pct: float = Field(ge=0, le=100)


class SingleOptimizationOperationalProfileResponse(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    job_id: str
    dataset_id: str
    date: str
    battery_name: str
    bess_capacity_kwh: float
    peak_support_pct: float
    soc_min_limit_pct: float = Field(ge=0, le=100)
    soc_max_limit_pct: float = Field(ge=0, le=100)
    points: list[OperationalProfilePoint] = Field(min_length=96, max_length=96)
    daily_summary: OperationalProfileDailySummary
