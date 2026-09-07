"""
Model registry endpoints: what is fitted, and refitting it.

`/retrain` genuinely refits against the current database and persists the result.
It is synchronous because every fit here is seconds of work on a dataset this
size; when a fit becomes expensive enough to need a queue, this is the place to
introduce one.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter

from .. import features, registry
from ..analytics import anomalies, benchmarks, engagement, forecasting, monthly_audit, rankings
from ..schemas import (
    ModelInfo,
    ModelPerformanceResponse,
    RetrainRequest,
    RetrainResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter()

# Every fittable model, keyed by the name the registry and UI use.
FITTERS = {
    anomalies.MODEL_NAME: anomalies.fit,
    forecasting.MODEL_NAME: forecasting.fit,
    engagement.MODEL_NAME: engagement.fit,
    benchmarks.MODEL_NAME: benchmarks.fit,
    rankings.MODEL_NAME: rankings.fit,
    monthly_audit.MODEL_NAME: monthly_audit.fit,
}


def _to_info(record: dict) -> ModelInfo:
    accuracy, metric_name = registry.headline_metric(record)
    return ModelInfo(
        name=record["name"],
        status=record.get("status", "not_trained"),
        accuracy=accuracy,
        metric_name=metric_name,
        observations=record.get("observations"),
        trained_at=record.get("trained_at"),
        method=record.get("method"),
        note=record.get("note"),
    )


@router.get("/model-performance", response_model=ModelPerformanceResponse)
def model_performance() -> ModelPerformanceResponse:
    return ModelPerformanceResponse(
        models=[_to_info(r) for r in registry.load_all()],
        reachable=True,
    )


@router.post("/retrain", response_model=RetrainResponse)
def retrain(payload: RetrainRequest) -> RetrainResponse:
    """
    Refit one model, or all of them when `modelName` is omitted.

    A fit that cannot honestly be made — too few observations — is saved with
    status `insufficient_data` and an explanation, rather than being recorded as
    a success with a meaningless score.
    """
    requested = payload.modelName
    if requested and requested not in FITTERS:
        return RetrainResponse(
            status="failed",
            trained=[],
            message=f"Unknown model '{requested}'. Known models: {', '.join(FITTERS)}.",
        )

    targets = [requested] if requested else list(FITTERS)
    trained: list[ModelInfo] = []
    failures: list[str] = []

    for name in targets:
        try:
            result = FITTERS[name](payload.parameters)
            record = registry.save(
                name,
                method=result["method"],
                params=result["params"],
                metrics=result["metrics"],
                observations=result["observations"],
                status=result["status"],
                note=result.get("note"),
            )
            trained.append(_to_info(record))
        except Exception as exc:  # noqa: BLE001 - report, do not crash the service
            logger.exception("fit failed for %s", name)
            failures.append(f"{name}: {exc}")

    volume = features.data_volume_summary()
    summary = (
        f"Fitted {len(trained)} model(s) against {volume.get('transactions', 0)} transactions, "
        f"{volume.get('members', 0)} members and {volume.get('cooperatives', 0)} cooperatives."
    )
    if failures:
        return RetrainResponse(
            status="failed",
            trained=trained,
            message=f"{summary} Failures: {'; '.join(failures)}",
        )

    insufficient = [m.name for m in trained if m.status == "insufficient_data"]
    if insufficient:
        summary += (
            f" Not enough data to fit: {', '.join(insufficient)} — see each model's note."
        )

    return RetrainResponse(status="completed", trained=trained, message=summary)


@router.get("/data-volume")
def data_volume() -> dict:
    """
    Row counts behind every fit. Exposed because the honest answer to "why is the
    model not better" is usually visible here.
    """
    return {"counts": features.data_volume_summary()}
