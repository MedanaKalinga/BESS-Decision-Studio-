from typing import Literal

from pydantic import BaseModel, Field


class AHPCalculationRequest(BaseModel):
    matrix: list[list[float]] = Field(
        description="Five-by-five AHP pairwise-comparison matrix."
    )


class AHPCalculationResponse(BaseModel):
    column_sums: list[float]
    normalized_matrix: list[list[float]]
    weights: list[float]
    lambda_max: float
    consistency_index: float
    random_index: float
    consistency_ratio: float
    status: Literal["ACCEPTABLE", "REVIEW REQUIRED"]
