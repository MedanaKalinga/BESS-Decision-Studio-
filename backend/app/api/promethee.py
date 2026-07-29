from fastapi import APIRouter, HTTPException

from app.schemas.promethee import (
    PrometheeCalculationRequest,
    PrometheeCalculationResponse,
)
from app.services.promethee_service import calculate_promethee


router = APIRouter(prefix="/api/promethee", tags=["promethee"])


@router.post("/calculate", response_model=PrometheeCalculationResponse)
def calculate_promethee_endpoint(
    request: PrometheeCalculationRequest,
) -> PrometheeCalculationResponse:
    try:
        result = calculate_promethee(
            alternatives=request.alternatives,
            ahp_weights=request.ahp_weights,
            accepted_ahp_revision=request.accepted_ahp_revision,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return PrometheeCalculationResponse(**result)
