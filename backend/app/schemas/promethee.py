from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


ScientificStatus = Literal[
    "ranking_completed",
    "insufficient_feasible_alternatives",
    "no_feasible_alternatives",
]
CriterionDirection = Literal["minimize", "maximize"]
SolutionStatus = Literal["feasible_solution", "no_feasible_candidate"]


class PrometheeAlternative(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, allow_inf_nan=False)

    battery_name: str = Field(min_length=1, max_length=200)
    solution_status: SolutionStatus
    failed_constraints: list[str] = Field(default_factory=list)
    is_feasible: bool
    total_annual_cost_rs: float = Field(ge=0)
    cycle_based_life_years: float = Field(ge=0)
    round_trip_efficiency: float = Field(gt=0, le=1)
    weight_density_kg_per_kwh: float = Field(ge=0)
    annual_om_cost_rs: float = Field(ge=0)
    warranty_years: float = Field(ge=0)

    @model_validator(mode="after")
    def validate_feasibility_fields(self) -> "PrometheeAlternative":
        status_is_feasible = self.solution_status == "feasible_solution"
        if self.is_feasible != status_is_feasible:
            raise ValueError(
                "is_feasible must agree with solution_status."
            )
        if self.is_feasible and self.failed_constraints:
            raise ValueError(
                "A feasible alternative cannot contain failed_constraints."
            )
        if not self.is_feasible and not self.failed_constraints:
            raise ValueError(
                "An infeasible alternative must list at least one failed constraint."
            )
        if any(not constraint.strip() for constraint in self.failed_constraints):
            raise ValueError("failed_constraints cannot contain empty names.")
        return self


class PrometheeCalculationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, allow_inf_nan=False)

    alternatives: list[PrometheeAlternative] = Field(min_length=2)
    ahp_weights: list[float] = Field(min_length=6, max_length=6)
    accepted_ahp_revision: int | str | None = None

    @model_validator(mode="after")
    def validate_request(self) -> "PrometheeCalculationRequest":
        normalized_names = [
            alternative.battery_name.strip().casefold()
            for alternative in self.alternatives
        ]
        if len(normalized_names) != len(set(normalized_names)):
            raise ValueError("Battery alternative names must be unique.")
        if any(weight < 0 for weight in self.ahp_weights):
            raise ValueError("AHP weights cannot be negative.")
        if sum(self.ahp_weights) <= 0:
            raise ValueError("The total AHP weight must be greater than zero.")
        return self


class PrometheeExcludedAlternative(BaseModel):
    model_config = ConfigDict(extra="forbid")

    battery_name: str
    solution_status: SolutionStatus
    failed_constraints: list[str]


class PrometheeRankedAlternative(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    battery_name: str
    rank: int = Field(ge=1)
    positive_flow: float = Field(ge=0, le=1)
    negative_flow: float = Field(ge=0, le=1)
    net_flow: float = Field(ge=-1, le=1)


class PrometheeCalculationResponse(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    scientific_status: ScientificStatus
    accepted_ahp_revision: int | str | None
    criteria_order: list[str]
    criterion_directions: list[CriterionDirection]
    normalized_weights: list[float]
    raw_decision_matrix: list[list[float]]
    observed_ranges: list[float]
    q_thresholds: list[float]
    p_thresholds: list[float]
    feasible_alternative_names: list[str]
    excluded_alternatives: list[PrometheeExcludedAlternative]
    criterion_preference_matrices: dict[str, list[list[float]]]
    aggregated_preference_matrix: list[list[float]]
    positive_flows: list[float]
    negative_flows: list[float]
    net_flows: list[float]
    ordered_ranking: list[PrometheeRankedAlternative]
    recommended_battery: str | None
