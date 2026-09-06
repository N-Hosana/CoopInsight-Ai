"""Anomaly detection endpoint."""

from fastapi import APIRouter

from ..analytics import anomalies as engine
from ..schemas import AnomalyDetectRequest, AnomalyDetectResponse

router = APIRouter()


@router.post("/anomalies/detect", response_model=AnomalyDetectResponse)
def detect(payload: AnomalyDetectRequest) -> AnomalyDetectResponse:
    """
    The backend inserts every returned anomaly straight into `ai_insights`, so
    the field names in `Anomaly` must stay aligned with those columns.
    """
    return AnomalyDetectResponse(**engine.detect(payload.cooperativeId))
