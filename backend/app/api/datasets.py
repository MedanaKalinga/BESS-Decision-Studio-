from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile

from app.schemas.datasets import DatasetDayResponse, DatasetUploadResponse
from app.services.dataset_service import (
    MAX_UPLOAD_BYTES,
    DatasetDateError,
    DatasetDateNotFoundError,
    DatasetFileError,
    DatasetNotFoundError,
    DatasetUploadTooLargeError,
    DatasetValidationError,
    get_dataset_day,
    validate_and_store_dataset,
)


router = APIRouter(prefix="/api/datasets", tags=["datasets"])


@router.post("/upload", response_model=DatasetUploadResponse)
async def upload_dataset(
    file: UploadFile = File(...),
    use_manual_mapping: bool = Form(False),
    pv_column: str | None = Form(None),
    ev_column: str | None = Form(None),
    tariff_column: str | None = Form(None),
    timestamp_column: str | None = Form(None),
    start_date: str | None = Form(None),
    generate_timestamps: bool = Form(False),
) -> dict[str, object]:
    filename = file.filename or ""
    try:
        content = await file.read(MAX_UPLOAD_BYTES + 1)
    finally:
        await file.close()

    try:
        return validate_and_store_dataset(
            content,
            filename,
            use_manual_mapping=use_manual_mapping,
            pv_column=pv_column,
            ev_column=ev_column,
            tariff_column=tariff_column,
            timestamp_column=timestamp_column,
            start_date=start_date,
            generate_timestamps=generate_timestamps,
        )
    except DatasetUploadTooLargeError as exc:
        raise HTTPException(status_code=413, detail=str(exc)) from exc
    except DatasetFileError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except DatasetValidationError as exc:
        raise HTTPException(
            status_code=422,
            detail={
                "message": str(exc),
                "validation_summary": exc.validation_summary,
            },
        ) from exc


@router.get("/{dataset_id}/day", response_model=DatasetDayResponse)
def dataset_day(
    dataset_id: str,
    date: str = Query(pattern=r"^\d{4}-\d{2}-\d{2}$"),
) -> dict[str, object]:
    try:
        return get_dataset_day(dataset_id, date)
    except DatasetDateError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except (DatasetNotFoundError, DatasetDateNotFoundError) as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except DatasetValidationError as exc:
        raise HTTPException(
            status_code=500,
            detail="The stored dataset could not be read.",
        ) from exc
