"""Operational profiles derived from the verified fixed-dispatch simulation."""

from __future__ import annotations

from datetime import date
from pathlib import Path
from typing import Mapping

from .dataset_service import STORAGE_DIR, load_dataset_records
from .single_simulation_service import (
    DT_HOURS,
    ROWS_PER_DAY,
    SOC_MAX,
    SOC_MIN,
    simulate_fixed_bess_dispatch,
)


class OperationalProfileDateError(ValueError):
    pass


class OperationalProfileDateNotFoundError(LookupError):
    pass


class OperationalProfileIncompleteDayError(ValueError):
    pass


def _selected_date(value: str) -> date:
    try:
        selected = date.fromisoformat(value)
    except ValueError as exc:
        raise OperationalProfileDateError(
            "Date must use YYYY-MM-DD format."
        ) from exc
    if selected.isoformat() != value:
        raise OperationalProfileDateError("Date must use YYYY-MM-DD format.")
    return selected


def generate_operational_profile(
    *,
    job_id: str,
    dataset_id: str,
    date_value: str,
    battery: Mapping[str, object] | object,
    economic_settings: Mapping[str, object] | object,
    bess_capacity_kwh: float,
    peak_support_pct: float,
    storage_dir: Path = STORAGE_DIR,
) -> dict[str, object]:
    """Simulate the full dataset, then slice one 96-point calendar day."""

    selected_date = _selected_date(date_value)
    canonical_id, records, _ = load_dataset_records(dataset_id, storage_dir)
    simulation = simulate_fixed_bess_dispatch(
        pv_kw=[record.pv_kw for record in records],
        ev_kw=[record.ev_kw for record in records],
        tariff_rs_per_kwh=[record.tariff_rs_per_kwh for record in records],
        battery=battery,
        bess_capacity_kwh=bess_capacity_kwh,
        peak_support_pct=peak_support_pct,
        economic_settings=economic_settings,
    )

    selected_indices = [
        index
        for index, record in enumerate(records)
        if record.timestamp.date() == selected_date
    ]
    if not selected_indices:
        raise OperationalProfileDateNotFoundError(
            "The requested date is not available in this dataset."
        )
    if len(selected_indices) != ROWS_PER_DAY:
        raise OperationalProfileIncompleteDayError(
            "Operational profiles require exactly 96 points for a full day."
        )

    points: list[dict[str, object]] = []
    for index in selected_indices:
        charge = simulation.bess_charge_kw[index]
        discharge = simulation.bess_discharge_kw[index]
        points.append(
            {
                "timestamp": records[index].timestamp.isoformat(),
                "pv_kw": simulation.pv_kw[index],
                "ev_kw": simulation.ev_kw[index],
                "grid_import_kw": simulation.grid_import_kw[index],
                "pv_export_kw": simulation.pv_export_kw[index],
                "bess_charge_kw": charge,
                "bess_discharge_kw": discharge,
                "bess_net_power_kw": discharge - charge,
                "soc_pct": simulation.soc_pu[index] * 100.0,
            }
        )

    def energy(field: str) -> float:
        return sum(float(point[field]) for point in points) * DT_HOURS

    soc_values = [float(point["soc_pct"]) for point in points]
    battery_name = (
        str(battery["name"])
        if isinstance(battery, Mapping)
        else str(getattr(battery, "name"))
    )
    return {
        "job_id": job_id,
        "dataset_id": canonical_id,
        "date": selected_date.isoformat(),
        "battery_name": battery_name,
        "bess_capacity_kwh": simulation.effective_capacity_kwh,
        "peak_support_pct": float(peak_support_pct),
        "soc_min_limit_pct": SOC_MIN * 100.0,
        "soc_max_limit_pct": SOC_MAX * 100.0,
        "points": points,
        "daily_summary": {
            "pv_energy_kwh": energy("pv_kw"),
            "ev_energy_kwh": energy("ev_kw"),
            "grid_import_energy_kwh": energy("grid_import_kw"),
            "pv_export_energy_kwh": energy("pv_export_kw"),
            "bess_charge_energy_kwh": energy("bess_charge_kw"),
            "bess_discharge_energy_kwh": energy("bess_discharge_kw"),
            "minimum_soc_pct": min(soc_values),
            "maximum_soc_pct": max(soc_values),
        },
    }
