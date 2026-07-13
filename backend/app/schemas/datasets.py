from pydantic import BaseModel


class ValidationIssue(BaseModel):
    code: str
    message: str
    row: int | None = None
    column: str | None = None


class DetectedColumns(BaseModel):
    timestamp: str | None
    pv: str
    ev: str
    tariff: str | None


class DatasetValidationSummary(BaseModel):
    valid: bool
    row_count: int
    interval_minutes: int
    dataset_type: str
    duration_days: int
    timestamps_generated: bool
    timestamp_source: str
    notice: str | None
    available_columns: list[str]
    detected_columns: DetectedColumns | None
    missing_values: int
    duplicate_timestamps: int
    negative_pv_values: int
    negative_ev_values: int
    errors: list[ValidationIssue]
    warnings: list[ValidationIssue]


class DatasetSummary(BaseModel):
    annual_pv_energy_kwh: float
    annual_ev_energy_kwh: float
    pv_peak_kw: float
    ev_peak_kw: float
    start_date: str
    end_date: str


class DatasetUploadResponse(BaseModel):
    dataset_id: str
    filename: str
    validation_summary: DatasetValidationSummary
    summary: DatasetSummary


class DatasetDayPoint(BaseModel):
    timestamp: str
    pv_kw: float
    ev_kw: float
    tariff_rs_per_kwh: float | None


class DatasetDaySummary(BaseModel):
    pv_energy_kwh: float
    ev_energy_kwh: float
    surplus_energy_kwh: float
    deficit_energy_kwh: float
    pv_peak_kw: float
    ev_peak_kw: float


class DatasetDayResponse(BaseModel):
    dataset_id: str
    date: str
    interval_minutes: int
    points: list[DatasetDayPoint]
    summary: DatasetDaySummary
