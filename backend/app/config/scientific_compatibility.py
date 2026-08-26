"""Non-destructive compatibility flags for persisted scientific state."""

from __future__ import annotations

from copy import deepcopy
from typing import Any, Mapping

from app.config.defaults import SCIENTIFIC_CONFIGURATION_VERSION


AHP_INCOMPATIBILITY_MESSAGE = (
    "AHP configuration must be recalculated using the current "
    "five-criterion model."
)
PROMETHEE_INCOMPATIBILITY_MESSAGE = (
    "The saved ranking uses the previous six-criterion model and must be "
    "recalculated."
)


def mark_scientific_state_compatibility(
    state: Mapping[str, Any],
) -> dict[str, Any]:
    """Return a presentation copy with legacy AHP/PROMETHEE marked stale."""
    current = deepcopy(dict(state))
    ahp = current.get("comparisonAhp")
    if isinstance(ahp, dict):
        matrix = ahp.get("matrix")
        if isinstance(matrix, list) and len(matrix) == 6:
            ahp["accepted"] = False
            ahp["incompatible"] = True
            ahp["incompatibilityReason"] = AHP_INCOMPATIBILITY_MESSAGE
            ahp.setdefault("scientificConfigurationVersion", 2)
        elif isinstance(matrix, list) and len(matrix) == 5:
            ahp["scientificConfigurationVersion"] = SCIENTIFIC_CONFIGURATION_VERSION
            ahp["incompatible"] = False
            ahp["incompatibilityReason"] = None

    promethee = current.get("promethee")
    if isinstance(promethee, dict):
        result = promethee.get("result")
        criteria = result.get("criteria_order") if isinstance(result, dict) else None
        if (
            isinstance(criteria, list)
            and len(criteria) == 6
            and "annual_om_cost_rs" in criteria
        ):
            promethee["stale"] = True
            promethee["incompatible"] = True
            promethee["incompatibilityReason"] = PROMETHEE_INCOMPATIBILITY_MESSAGE
            promethee.setdefault("scientificConfigurationVersion", 2)
        elif isinstance(criteria, list) and len(criteria) == 5:
            promethee["scientificConfigurationVersion"] = SCIENTIFIC_CONFIGURATION_VERSION
            promethee["incompatible"] = False
            promethee["incompatibilityReason"] = None
    return current


def mark_projected_scientific_state_compatibility(
    state: Mapping[str, Any],
    kind: str,
) -> dict[str, Any]:
    key = "comparisonAhp" if kind == "ahp" else "promethee"
    return mark_scientific_state_compatibility({key: state})[key]
