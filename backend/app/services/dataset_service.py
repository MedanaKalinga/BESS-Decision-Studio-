import csv
import json
import math
import re
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from io import StringIO
from pathlib import Path
from uuid import UUID, uuid4


INTERVAL_MINUTES = 15
DT_HOURS = INTERVAL_MINUTES / 60.0
ROWS_PER_DAY = 96
NORMAL_YEAR_ROWS = 35040
LEAP_YEAR_ROWS = 35136
ANNUAL_ROW_COUNTS = {NORMAL_YEAR_ROWS, LEAP_YEAR_ROWS}
MAX_UPLOAD_BYTES = 25 * 1024 * 1024
MAX_DETAILED_ISSUES = 50
STORAGE_DIR = Path(__file__).resolve().parents[2] / "storage"
NO_TIMESTAMP_NOTICE = (
    "No timestamp column detected. Timestamps will be generated from the selected "
    "start date using 15-minute intervals."
)

TIMESTAMP_COLUMN_CANDIDATES = [
    "timestamp",
    "datetime",
    "date_time",
    "time_stamp",
    "time",
]
PV_COLUMN_CANDIDATES = [
    "P_PV_kW",
    "PV_kW",
    "PV_Generation",
    "PV_generation",
    "P_pv",
    "pv",
]
EV_COLUMN_CANDIDATES = [
    "P_EV_kW",
    "EV_kW",
    "EV_Demand",
    "EV_demand",
    "P_ev",
    "ev",
]
TARIFF_COLUMN_CANDIDATES = [
    "tariff",
    "Tariff",
    "price",
    "Price",
    "tariff_Rs_per_kWh",
    "price_Rs_per_kWh",
    "Price_Rs_per_kWh",
]


@dataclass(frozen=True)
class DatasetRecord:
    timestamp: datetime
    pv_kw: float
    ev_kw: float
    tariff_rs_per_kwh: float | None


class DatasetValidationError(ValueError):
    def __init__(self, validation_summary: dict[str, object]):
        super().__init__("Dataset validation failed")
        self.validation_summary = validation_summary


class DatasetFileError(ValueError):
    pass


class DatasetUploadTooLargeError(ValueError):
    pass


class DatasetNotFoundError(LookupError):
    pass


class DatasetDateNotFoundError(LookupError):
    pass


class DatasetDateError(ValueError):
    pass


def _normalize_column_name(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", value.strip().lower()).strip("_")


def _validation_issue(
    code: str,
    message: str,
    row: int | None = None,
    column: str | None = None,
) -> dict[str, object]:
    return {"code": code, "message": message, "row": row, "column": column}


def _append_issue(
    issues: list[dict[str, object]],
    issue: dict[str, object],
) -> None:
    if len(issues) < MAX_DETAILED_ISSUES:
        issues.append(issue)


def _dataset_shape(row_count: int) -> tuple[str, int]:
    if row_count == NORMAL_YEAR_ROWS:
        return "normal_year", 365
    if row_count == LEAP_YEAR_ROWS:
        return "leap_year", 366
    if 0 < row_count <= LEAP_YEAR_ROWS and row_count % ROWS_PER_DAY == 0:
        return "partial", row_count // ROWS_PER_DAY
    return "invalid", 0


def _base_summary(
    *,
    row_count: int = 0,
    headers: list[str] | None = None,
    errors: list[dict[str, object]] | None = None,
) -> dict[str, object]:
    dataset_type, duration_days = _dataset_shape(row_count)
    return {
        "valid": False,
        "row_count": row_count,
        "interval_minutes": INTERVAL_MINUTES,
        "dataset_type": dataset_type,
        "duration_days": duration_days,
        "timestamps_generated": False,
        "timestamp_source": "missing",
        "notice": None,
        "available_columns": headers or [],
        "detected_columns": None,
        "missing_values": 0,
        "duplicate_timestamps": 0,
        "negative_pv_values": 0,
        "negative_ev_values": 0,
        "errors": errors or [],
        "warnings": [],
    }


def _find_column(
    headers: list[str],
    candidates: list[str],
    label: str,
    required: bool,
    errors: list[dict[str, object]],
) -> str | None:
    normalized_headers: dict[str, list[str]] = {}
    for header in headers:
        normalized_headers.setdefault(_normalize_column_name(header), []).append(header)

    matches: list[str] = []
    for candidate in candidates:
        matches.extend(normalized_headers.get(_normalize_column_name(candidate), []))
    matches = list(dict.fromkeys(matches))

    if len(matches) > 1:
        _append_issue(
            errors,
            _validation_issue(
                "AMBIGUOUS_COLUMN",
                f"Multiple columns match {label}: {matches}.",
                column=label,
            ),
        )
        return None
    if not matches:
        if required:
            _append_issue(
                errors,
                _validation_issue(
                    "MISSING_COLUMN", f"A {label} column is required.", column=label
                ),
            )
        return None
    return matches[0]


def _manual_column(
    headers: list[str],
    selected: str | None,
    label: str,
    required: bool,
    errors: list[dict[str, object]],
) -> str | None:
    if selected is None or selected == "":
        if required:
            _append_issue(
                errors,
                _validation_issue(
                    "MISSING_COLUMN_MAPPING",
                    f"Select a {label} column.",
                    column=label,
                ),
            )
        return None
    if selected not in headers:
        _append_issue(
            errors,
            _validation_issue(
                "INVALID_COLUMN_MAPPING",
                f'The selected {label} column "{selected}" does not exist.',
                column=label,
            ),
        )
        return None
    return selected


def _parse_timestamp(value: str) -> datetime:
    normalized = value.strip()
    if normalized.endswith("Z"):
        normalized = f"{normalized[:-1]}+00:00"
    return datetime.fromisoformat(normalized)


def _parse_generation_start(value: str | None) -> datetime:
    if value is None or re.fullmatch(r"\d{4}-\d{2}-\d{2}", value) is None:
        raise ValueError
    parsed_date = date.fromisoformat(value)
    if parsed_date.isoformat() != value:
        raise ValueError
    return datetime.combine(parsed_date, datetime.min.time())


def parse_and_validate_csv(
    content: bytes,
    *,
    use_manual_mapping: bool = False,
    pv_column: str | None = None,
    ev_column: str | None = None,
    tariff_column: str | None = None,
    timestamp_column: str | None = None,
    start_date: str | None = None,
    generate_timestamps: bool = False,
) -> tuple[list[DatasetRecord], dict[str, object], dict[str, object]]:
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        summary = _base_summary(
            errors=[
                _validation_issue(
                    "INVALID_ENCODING", "CSV files must use UTF-8 encoding."
                )
            ]
        )
        raise DatasetValidationError(summary) from exc

    reader = csv.DictReader(StringIO(text, newline=""))
    headers = [header for header in (reader.fieldnames or []) if header.strip()]
    rows = list(reader)
    row_count = len(rows)
    dataset_type, duration_days = _dataset_shape(row_count)
    errors: list[dict[str, object]] = []
    warnings: list[dict[str, object]] = []

    if not headers:
        _append_issue(errors, _validation_issue("MISSING_HEADER", "The CSV header row is missing."))

    normalized_header_groups: dict[str, list[str]] = {}
    for header in headers:
        normalized_header_groups.setdefault(_normalize_column_name(header), []).append(header)
    for duplicate_headers in normalized_header_groups.values():
        if len(duplicate_headers) > 1:
            _append_issue(
                errors,
                _validation_issue(
                    "DUPLICATE_HEADER",
                    f"Duplicate CSV header detected: {duplicate_headers}.",
                ),
            )

    if row_count == 0:
        _append_issue(
            errors,
            _validation_issue("INVALID_ROW_COUNT", "The dataset must contain at least one day of data."),
        )
    if row_count > LEAP_YEAR_ROWS:
        _append_issue(
            errors,
            _validation_issue(
                "INVALID_ROW_COUNT",
                f"The dataset cannot exceed {LEAP_YEAR_ROWS:,} rows.",
            ),
        )
    if row_count % ROWS_PER_DAY != 0:
        _append_issue(
            errors,
            _validation_issue(
                "INVALID_ROW_COUNT",
                f"The row count must be divisible by {ROWS_PER_DAY}; received {row_count} rows.",
            ),
        )

    timestamp_lookup_failed = False
    if use_manual_mapping:
        pv_column = _manual_column(headers, pv_column, "PV", True, errors)
        ev_column = _manual_column(headers, ev_column, "EV", True, errors)
        tariff_column = _manual_column(headers, tariff_column, "tariff", False, errors)
        before_timestamp_mapping = len(errors)
        timestamp_column = _manual_column(
            headers, timestamp_column, "timestamp", False, errors
        )
        timestamp_lookup_failed = len(errors) > before_timestamp_mapping
    else:
        before_timestamp_mapping = len(errors)
        timestamp_column = _find_column(
            headers, TIMESTAMP_COLUMN_CANDIDATES, "timestamp", False, errors
        )
        timestamp_lookup_failed = len(errors) > before_timestamp_mapping
        pv_column = _find_column(headers, PV_COLUMN_CANDIDATES, "PV", True, errors)
        ev_column = _find_column(headers, EV_COLUMN_CANDIDATES, "EV", True, errors)
        tariff_column = _find_column(
            headers, TARIFF_COLUMN_CANDIDATES, "tariff", False, errors
        )

    mapped_roles = {
        "timestamp": timestamp_column,
        "PV": pv_column,
        "EV": ev_column,
        "tariff": tariff_column,
    }
    selected_roles_by_column: dict[str, list[str]] = {}
    for role, selected_column in mapped_roles.items():
        if selected_column is not None:
            selected_roles_by_column.setdefault(selected_column, []).append(role)
    for selected_column, roles in selected_roles_by_column.items():
        if len(roles) > 1:
            _append_issue(
                errors,
                _validation_issue(
                    "DUPLICATE_COLUMN_MAPPING",
                    f'Column "{selected_column}" cannot be mapped to multiple fields: {roles}.',
                    column=selected_column,
                ),
            )

    detected_columns: dict[str, str | None] | None = None
    if pv_column is not None and ev_column is not None:
        detected_columns = {
            "timestamp": timestamp_column,
            "pv": pv_column,
            "ev": ev_column,
            "tariff": tariff_column,
        }

    timestamps_generated = False
    generation_start: datetime | None = None
    notice: str | None = None
    timestamp_source = "uploaded" if timestamp_column is not None else "missing"
    if timestamp_column is None and not timestamp_lookup_failed:
        notice = NO_TIMESTAMP_NOTICE
        if not generate_timestamps:
            _append_issue(
                errors,
                _validation_issue("TIMESTAMP_CONFIRMATION_REQUIRED", NO_TIMESTAMP_NOTICE),
            )
        else:
            try:
                generation_start = _parse_generation_start(start_date)
            except ValueError:
                _append_issue(
                    errors,
                    _validation_issue(
                        "INVALID_START_DATE",
                        "A valid dataset start date in YYYY-MM-DD format is required.",
                        column="start_date",
                    ),
                )
            else:
                timestamps_generated = True
                timestamp_source = "generated"
                _append_issue(
                    warnings,
                    _validation_issue("TIMESTAMPS_GENERATED", NO_TIMESTAMP_NOTICE),
                )

    missing_values = 0
    duplicate_timestamps = 0
    negative_pv_values = 0
    negative_ev_values = 0
    records: list[DatasetRecord] = []
    timestamp_entries: list[tuple[int, datetime]] = []
    seen_timestamps: set[datetime] = set()
    timezone_awareness: bool | None = None

    def parse_numeric(
        row: dict[str | None, str | list[str] | None],
        column: str,
        row_number: int,
    ) -> float | None:
        nonlocal missing_values
        raw_value = row.get(column)
        if raw_value is None or isinstance(raw_value, list) or not raw_value.strip():
            missing_values += 1
            _append_issue(
                errors,
                _validation_issue(
                    "MISSING_VALUE",
                    f"Missing value in {column}.",
                    row=row_number,
                    column=column,
                ),
            )
            return None
        try:
            value = float(raw_value)
        except ValueError:
            _append_issue(
                errors,
                _validation_issue(
                    "NON_NUMERIC_VALUE",
                    f"Value in {column} must be numeric.",
                    row=row_number,
                    column=column,
                ),
            )
            return None
        if not math.isfinite(value):
            _append_issue(
                errors,
                _validation_issue(
                    "NON_NUMERIC_VALUE",
                    f"Value in {column} must be finite.",
                    row=row_number,
                    column=column,
                ),
            )
            return None
        return value

    mapping_error_codes = {
        "MISSING_COLUMN",
        "MISSING_COLUMN_MAPPING",
        "INVALID_COLUMN_MAPPING",
        "DUPLICATE_COLUMN_MAPPING",
        "AMBIGUOUS_COLUMN",
    }
    mapping_ready = (
        detected_columns is not None
        and not any(str(issue["code"]) in mapping_error_codes for issue in errors)
    )
    if mapping_ready:
        for zero_based_index, row in enumerate(rows):
            row_number = zero_based_index + 2
            if None in row:
                _append_issue(
                    errors,
                    _validation_issue(
                        "MALFORMED_CSV",
                        "Row contains more fields than the CSV header.",
                        row=row_number,
                    ),
                )

            timestamp: datetime | None = None
            if timestamps_generated and generation_start is not None:
                timestamp = generation_start + timedelta(
                    minutes=INTERVAL_MINUTES * zero_based_index
                )
            elif timestamp_column is not None:
                raw_timestamp = row.get(timestamp_column)
                if (
                    raw_timestamp is None
                    or isinstance(raw_timestamp, list)
                    or not raw_timestamp.strip()
                ):
                    missing_values += 1
                    _append_issue(
                        errors,
                        _validation_issue(
                            "MISSING_VALUE",
                            "Timestamp value is missing.",
                            row=row_number,
                            column=timestamp_column,
                        ),
                    )
                else:
                    try:
                        timestamp = _parse_timestamp(raw_timestamp)
                    except ValueError:
                        _append_issue(
                            errors,
                            _validation_issue(
                                "INVALID_TIMESTAMP",
                                "Timestamp must be a valid ISO-style date and time.",
                                row=row_number,
                                column=timestamp_column,
                            ),
                        )

                if timestamp is not None:
                    is_aware = timestamp.tzinfo is not None
                    if timezone_awareness is None:
                        timezone_awareness = is_aware
                    elif timezone_awareness != is_aware:
                        _append_issue(
                            errors,
                            _validation_issue(
                                "MIXED_TIMEZONE",
                                "Timestamps must consistently include or omit timezone information.",
                                row=row_number,
                                column=timestamp_column,
                            ),
                        )
                    if timestamp in seen_timestamps:
                        duplicate_timestamps += 1
                        _append_issue(
                            errors,
                            _validation_issue(
                                "DUPLICATE_TIMESTAMP",
                                "Duplicate timestamp found.",
                                row=row_number,
                                column=timestamp_column,
                            ),
                        )
                    seen_timestamps.add(timestamp)
                    timestamp_entries.append((row_number, timestamp))

            pv_value = parse_numeric(row, pv_column, row_number)
            ev_value = parse_numeric(row, ev_column, row_number)
            tariff_value = (
                parse_numeric(row, tariff_column, row_number)
                if tariff_column is not None
                else None
            )

            if pv_value is not None and pv_value < 0:
                negative_pv_values += 1
                _append_issue(
                    errors,
                    _validation_issue(
                        "NEGATIVE_VALUE",
                        "PV values cannot be negative.",
                        row=row_number,
                        column=pv_column,
                    ),
                )
            if ev_value is not None and ev_value < 0:
                negative_ev_values += 1
                _append_issue(
                    errors,
                    _validation_issue(
                        "NEGATIVE_VALUE",
                        "EV values cannot be negative.",
                        row=row_number,
                        column=ev_column,
                    ),
                )

            if timestamp is not None and pv_value is not None and ev_value is not None:
                if tariff_column is None or tariff_value is not None:
                    records.append(
                        DatasetRecord(timestamp, pv_value, ev_value, tariff_value)
                    )

        if timestamp_column is not None:
            for (current_row, current), (_, previous) in zip(
                timestamp_entries[1:], timestamp_entries, strict=False
            ):
                try:
                    interval_seconds = (current - previous).total_seconds()
                except TypeError:
                    continue
                if interval_seconds != INTERVAL_MINUTES * 60:
                    _append_issue(
                        errors,
                        _validation_issue(
                            "INVALID_INTERVAL",
                            "Every timestamp must be exactly 15 minutes after the previous timestamp.",
                            row=current_row,
                            column=timestamp_column,
                        ),
                    )

            if timestamp_entries:
                first_row, first_timestamp = timestamp_entries[0]
                last_row, last_timestamp = timestamp_entries[-1]
                if (
                    first_timestamp.hour,
                    first_timestamp.minute,
                    first_timestamp.second,
                ) != (0, 0, 0):
                    _append_issue(
                        errors,
                        _validation_issue(
                            "INVALID_START_TIME",
                            "The dataset must begin at 00:00.",
                            row=first_row,
                            column=timestamp_column,
                        ),
                    )
                if (
                    last_timestamp.hour,
                    last_timestamp.minute,
                    last_timestamp.second,
                ) != (23, 45, 0):
                    _append_issue(
                        errors,
                        _validation_issue(
                            "INVALID_END_TIME",
                            "The dataset must end at 23:45.",
                            row=last_row,
                            column=timestamp_column,
                        ),
                    )

    validation_summary: dict[str, object] = {
        "valid": not errors,
        "row_count": row_count,
        "interval_minutes": INTERVAL_MINUTES,
        "dataset_type": dataset_type,
        "duration_days": duration_days,
        "timestamps_generated": timestamps_generated,
        "timestamp_source": timestamp_source,
        "notice": notice,
        "available_columns": headers,
        "detected_columns": detected_columns,
        "missing_values": missing_values,
        "duplicate_timestamps": duplicate_timestamps,
        "negative_pv_values": negative_pv_values,
        "negative_ev_values": negative_ev_values,
        "errors": errors,
        "warnings": warnings,
    }
    if errors:
        raise DatasetValidationError(validation_summary)

    pv_values = [record.pv_kw for record in records]
    ev_values = [record.ev_kw for record in records]
    dataset_summary: dict[str, object] = {
        "annual_pv_energy_kwh": sum(pv_values) * DT_HOURS,
        "annual_ev_energy_kwh": sum(ev_values) * DT_HOURS,
        "pv_peak_kw": max(pv_values),
        "ev_peak_kw": max(ev_values),
        "start_date": records[0].timestamp.date().isoformat(),
        "end_date": records[-1].timestamp.date().isoformat(),
    }
    return records, validation_summary, dataset_summary


def validate_and_store_dataset(
    content: bytes,
    filename: str,
    storage_dir: Path = STORAGE_DIR,
    *,
    use_manual_mapping: bool = False,
    pv_column: str | None = None,
    ev_column: str | None = None,
    tariff_column: str | None = None,
    timestamp_column: str | None = None,
    start_date: str | None = None,
    generate_timestamps: bool = False,
) -> dict[str, object]:
    if Path(filename).suffix.lower() != ".csv":
        raise DatasetFileError("Only .csv files are accepted.")
    if not content:
        raise DatasetFileError("The uploaded CSV file is empty.")
    if len(content) > MAX_UPLOAD_BYTES:
        raise DatasetUploadTooLargeError(
            f"CSV files cannot exceed {MAX_UPLOAD_BYTES // (1024 * 1024)} MB."
        )

    _, validation_summary, dataset_summary = parse_and_validate_csv(
        content,
        use_manual_mapping=use_manual_mapping,
        pv_column=pv_column,
        ev_column=ev_column,
        tariff_column=tariff_column,
        timestamp_column=timestamp_column,
        start_date=start_date,
        generate_timestamps=generate_timestamps,
    )
    dataset_id = str(uuid4())
    storage_dir.mkdir(parents=True, exist_ok=True)

    csv_path = storage_dir / f"{dataset_id}.csv"
    metadata_path = storage_dir / f"{dataset_id}.json"
    temporary_csv_path = storage_dir / f".{dataset_id}.csv.tmp"
    temporary_metadata_path = storage_dir / f".{dataset_id}.json.tmp"
    response: dict[str, object] = {
        "dataset_id": dataset_id,
        "filename": Path(filename).name,
        "validation_summary": validation_summary,
        "summary": dataset_summary,
    }
    detected = validation_summary["detected_columns"]
    assert isinstance(detected, dict)
    timestamps_were_generated = bool(validation_summary["timestamps_generated"])
    processing_metadata = {
        "use_manual_mapping": True,
        "pv_column": detected["pv"],
        "ev_column": detected["ev"],
        "tariff_column": detected["tariff"],
        "timestamp_column": detected["timestamp"],
        "start_date": (
            dataset_summary["start_date"] if timestamps_were_generated else None
        ),
        "generate_timestamps": timestamps_were_generated,
    }

    temporary_csv_path.write_bytes(content)
    temporary_metadata_path.write_text(
        json.dumps({**response, "_processing": processing_metadata}, indent=2),
        encoding="utf-8",
    )
    temporary_csv_path.replace(csv_path)
    temporary_metadata_path.replace(metadata_path)
    return response


def _validated_dataset_id(dataset_id: str) -> str:
    try:
        return str(UUID(dataset_id))
    except ValueError as exc:
        raise DatasetNotFoundError("Dataset was not found.") from exc


def load_dataset_records(
    dataset_id: str,
    storage_dir: Path = STORAGE_DIR,
) -> tuple[str, list[DatasetRecord], dict[str, object]]:
    """Reload a validated upload using the column mapping saved at upload time."""
    canonical_id = _validated_dataset_id(dataset_id)
    csv_path = storage_dir / f"{canonical_id}.csv"
    metadata_path = storage_dir / f"{canonical_id}.json"
    if not csv_path.is_file() or not metadata_path.is_file():
        raise DatasetNotFoundError("Dataset was not found.")

    stored_metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    processing = stored_metadata.get("_processing", {})
    records, validation_summary, dataset_summary = parse_and_validate_csv(
        csv_path.read_bytes(),
        **processing,
    )
    stored_metadata["validation_summary"] = validation_summary
    stored_metadata["summary"] = dataset_summary
    return canonical_id, records, stored_metadata


def get_dataset_day(
    dataset_id: str,
    date_value: str,
    storage_dir: Path = STORAGE_DIR,
) -> dict[str, object]:
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", date_value) is None:
        raise DatasetDateError("Date must use YYYY-MM-DD format.")
    try:
        selected_date = date.fromisoformat(date_value)
    except ValueError as exc:
        raise DatasetDateError("Date must use YYYY-MM-DD format.") from exc

    canonical_id, records, _ = load_dataset_records(dataset_id, storage_dir)

    day_records = [
        record for record in records if record.timestamp.date() == selected_date
    ]
    if not day_records:
        raise DatasetDateNotFoundError(
            "The requested date is not available in this dataset."
        )

    pv_energy = sum(record.pv_kw for record in day_records) * DT_HOURS
    ev_energy = sum(record.ev_kw for record in day_records) * DT_HOURS
    surplus_energy = (
        sum(max(record.pv_kw - record.ev_kw, 0.0) for record in day_records)
        * DT_HOURS
    )
    deficit_energy = (
        sum(max(record.ev_kw - record.pv_kw, 0.0) for record in day_records)
        * DT_HOURS
    )
    return {
        "dataset_id": canonical_id,
        "date": selected_date.isoformat(),
        "interval_minutes": INTERVAL_MINUTES,
        "points": [
            {
                "timestamp": record.timestamp.isoformat(timespec="seconds"),
                "pv_kw": record.pv_kw,
                "ev_kw": record.ev_kw,
                "tariff_rs_per_kwh": record.tariff_rs_per_kwh,
            }
            for record in day_records
        ],
        "summary": {
            "pv_energy_kwh": pv_energy,
            "ev_energy_kwh": ev_energy,
            "surplus_energy_kwh": surplus_energy,
            "deficit_energy_kwh": deficit_energy,
            "pv_peak_kw": max(record.pv_kw for record in day_records),
            "ev_peak_kw": max(record.ev_kw for record in day_records),
        },
    }
