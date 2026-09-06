"""Forecasting endpoints."""

from fastapi import APIRouter, Query

from ..analytics import forecasting
from ..schemas import ForecastGenerateRequest, ForecastResponse

router = APIRouter()


@router.get("/forecasts", response_model=ForecastResponse)
def get_forecast(
    cooperativeId: str | None = Query(default=None),
    metric: str = Query(default="savings"),
    horizon: str = Query(default="30d"),
) -> ForecastResponse:
    return ForecastResponse(**forecasting.forecast(cooperativeId or None, metric, horizon))


@router.post("/forecasts/generate", response_model=ForecastResponse)
def generate_forecast(payload: ForecastGenerateRequest) -> ForecastResponse:
    """
    Same computation as the GET. The forecast is cheap and deterministic, so it
    is produced synchronously rather than queued — there is no job to poll.
    """
    return ForecastResponse(
        **forecasting.forecast(payload.cooperativeId, payload.metric, payload.horizon)
    )
