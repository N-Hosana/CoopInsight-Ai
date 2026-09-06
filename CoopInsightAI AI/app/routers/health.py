"""Health probe. The Node backend calls this to decide if the service is up."""

from fastapi import APIRouter

from .. import db, registry
from ..config import get_settings
from ..schemas import HealthResponse

router = APIRouter()


@router.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    settings = get_settings()
    database_ok = db.ping()
    return HealthResponse(
        status="ok" if database_ok else "degraded",
        version=settings.version,
        service=settings.service_name,
        database=database_ok,
        models_loaded=registry.count_fitted(),
        detail=None if database_ok else "Database unreachable; analytics will return empty results.",
    )
