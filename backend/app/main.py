from fastapi import FastAPI

from app.api.ahp import router as ahp_router
from app.api.configuration import router as configuration_router
from app.api.datasets import router as datasets_router
from app.api.single_optimization import router as single_optimization_router
from app.api.single_optimization_jobs import router as single_optimization_jobs_router


app = FastAPI()
app.include_router(ahp_router)
app.include_router(configuration_router)
app.include_router(datasets_router)
app.include_router(single_optimization_router)
app.include_router(single_optimization_jobs_router)


@app.get("/api/health")
def health_check() -> dict[str, str]:
    return {
        "status": "ok",
        "message": "BESS web backend is running",
    }
