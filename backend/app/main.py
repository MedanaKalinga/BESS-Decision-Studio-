from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.api.ahp import router as ahp_router
from app.api.auth import router as auth_router
from app.api.comparison_optimization_jobs import (
    job_manager as comparison_job_manager,
    router as comparison_optimization_jobs_router,
)
from app.api.configuration import router as configuration_router
from app.api.datasets import router as datasets_router
from app.api.promethee import router as promethee_router
from app.api.projects import router as projects_router
from app.api.project_scientific import router as project_scientific_router
from app.api.single_optimization import router as single_optimization_router
from app.api.single_optimization_jobs import (
    job_manager as single_job_manager,
    router as single_optimization_jobs_router,
)
from app.api.workspaces import router as workspaces_router
from app.config.mongodb import mongo_persistence
from app.services.optimization_checkpoint_service import (
    MongoOptimizationCheckpointRepository,
)
from app.services.auth_project_service import MongoAuthProjectRepository


@asynccontextmanager
async def lifespan(_: FastAPI):
    if mongo_persistence.connect():
        workspace_repository = mongo_persistence.repository()
        auth_project_repository = MongoAuthProjectRepository(workspace_repository.database)
        auth_project_repository.ensure_indexes()
        checkpoint_repository = MongoOptimizationCheckpointRepository(
            workspace_repository.database
        )
        checkpoint_repository.ensure_indexes()
        single_job_manager.configure_checkpoint_repository(checkpoint_repository)
        comparison_job_manager.configure_checkpoint_repository(checkpoint_repository)
        single_job_manager.recover_active_jobs()
        comparison_job_manager.recover_active_jobs()
    yield
    mongo_persistence.close()


app = FastAPI(lifespan=lifespan)
app.include_router(auth_router)
app.include_router(ahp_router)
app.include_router(configuration_router)
app.include_router(datasets_router)
app.include_router(single_optimization_router)
app.include_router(single_optimization_jobs_router)
app.include_router(comparison_optimization_jobs_router)
app.include_router(promethee_router)
app.include_router(projects_router)
app.include_router(project_scientific_router)
app.include_router(workspaces_router)


@app.get("/api/health")
def health_check() -> dict[str, str]:
    return {
        "status": "ok",
        "message": "BESS web backend is running",
    }
