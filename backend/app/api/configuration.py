from fastapi import APIRouter

from app.config.defaults import (
    DEFAULT_AHP_MATRIX,
    DEFAULT_BATTERY_TYPES,
    DEFAULT_CRITERIA,
    DEFAULT_DISPATCH_PERIODS,
    SCIENTIFIC_CONFIGURATION_VERSION,
)


router = APIRouter(prefix="/api/config", tags=["configuration"])


@router.get("/defaults")
def get_default_configuration() -> dict[str, object]:
    return {
        "scientific_configuration_version": SCIENTIFIC_CONFIGURATION_VERSION,
        "battery_types": DEFAULT_BATTERY_TYPES,
        "criteria": DEFAULT_CRITERIA,
        "ahp_matrix": DEFAULT_AHP_MATRIX,
        "dispatch_periods": DEFAULT_DISPATCH_PERIODS,
    }
