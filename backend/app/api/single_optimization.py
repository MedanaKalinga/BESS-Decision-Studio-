from json import JSONDecodeError

from fastapi import APIRouter, HTTPException

from app.schemas.single_optimization import (
    SingleOptimizationEvaluationRequest,
    SingleOptimizationEvaluationResponse,
)
from app.services.dataset_service import DatasetNotFoundError, DatasetValidationError
from app.services.single_simulation_service import (
    ModifiedDispatchStrategyError,
    evaluate_uploaded_dataset,
)
from app.config.mongodb import PersistenceUnavailableError, mongo_persistence


router = APIRouter(prefix="/api/single-optimization", tags=["single-optimization"])


@router.post("/evaluate", response_model=SingleOptimizationEvaluationResponse)
def evaluate_single_optimization(
    request: SingleOptimizationEvaluationRequest,
) -> SingleOptimizationEvaluationResponse:
    if mongo_persistence.available:
        try:
            repository = mongo_persistence.repository()
            if repository.datasets.find_one({"dataset_id": request.dataset_id, "project_id": {"$exists": True}}):
                raise HTTPException(status_code=404, detail="Dataset was not found.")
        except PersistenceUnavailableError:
            pass
    try:
        result = evaluate_uploaded_dataset(
            dataset_id=request.dataset_id,
            battery=request.battery,
            bess_capacity_kwh=request.bess_capacity_kwh,
            peak_support_pct=request.peak_support_pct,
            economic_settings=request.economic_settings,
            dispatch_strategy_status=request.dispatch_strategy_status,
        )
    except ModifiedDispatchStrategyError as exc:
        raise HTTPException(
            status_code=422,
            detail={"code": exc.code, "message": exc.message},
        ) from exc
    except DatasetNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except DatasetValidationError as exc:
        raise HTTPException(
            status_code=500,
            detail="The stored dataset could not be read.",
        ) from exc
    except (JSONDecodeError, OSError, AttributeError, TypeError) as exc:
        raise HTTPException(
            status_code=500,
            detail="The stored dataset could not be read.",
        ) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    return SingleOptimizationEvaluationResponse(**result)
