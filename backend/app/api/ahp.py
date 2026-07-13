from fastapi import APIRouter, HTTPException

from app.schemas.ahp import AHPCalculationRequest, AHPCalculationResponse
from app.services.ahp_service import calculate_ahp


router = APIRouter(prefix="/api/ahp", tags=["ahp"])


@router.post("/calculate", response_model=AHPCalculationResponse)
def calculate_ahp_endpoint(
    request: AHPCalculationRequest,
) -> AHPCalculationResponse:
    try:
        result = calculate_ahp(request.matrix)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    return AHPCalculationResponse(**result)
