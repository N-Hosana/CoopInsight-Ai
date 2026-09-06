"""
Response shapes.

These mirror exactly what the Node backend (`src/routes/ai.ts`) and the React UI
(`pages/AIInsights.tsx`) already expect. Two naming conventions are in play and
both are deliberate:

  * Anomaly fields use snake_case, because the backend inserts them straight into
    the `ai_insights` columns of the same name.
  * Engagement and benchmark fields use camelCase, because the backend passes
    those through untouched and the UI reads them as-is.

Changing a field name here breaks the contract silently, so don't.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

Severity = Literal["info", "warning", "critical"]
Trend = Literal["up", "down", "stable"]


# ─── Health ──────────────────────────────────────────────────────────────────

class HealthResponse(BaseModel):
    status: Literal["ok", "degraded"]
    version: str
    service: str
    database: bool
    models_loaded: int
    detail: str | None = None


# ─── Anomalies ───────────────────────────────────────────────────────────────

class Anomaly(BaseModel):
    """One detected anomaly. Field names match the `ai_insights` columns."""

    severity: Severity
    title: str
    summary: str
    detail: str | None = None
    affected_metric: str | None = None
    current_value: float | None = None
    expected_value: float | None = None
    deviation: float | None = Field(
        default=None,
        description="Signed proportional deviation from expected, e.g. 0.42 for +42%.",
    )
    model_name: str | None = None
    confidence: float | None = Field(default=None, ge=0, le=1)


class AnomalyDetectRequest(BaseModel):
    cooperativeId: str


class AnomalyDetectResponse(BaseModel):
    anomalies: list[Anomaly]
    cooperativeId: str
    evaluated: int = Field(description="How many observations were examined.")
    method: str
    note: str | None = None


# ─── Forecasts ───────────────────────────────────────────────────────────────

class ForecastPoint(BaseModel):
    date: str
    value: float
    lower: float
    upper: float


class ForecastResponse(BaseModel):
    cooperative_id: str | None = None
    metric: str
    horizon: str
    forecast: list[ForecastPoint]
    history: list[ForecastPoint] = Field(default_factory=list)
    model_name: str
    confidence: float | None = Field(default=None, ge=0, le=1)
    reachable: bool = True
    note: str | None = None


class ForecastGenerateRequest(BaseModel):
    cooperativeId: str
    metric: str
    horizon: str
    parameters: dict[str, Any] | None = None


# ─── Member engagement ───────────────────────────────────────────────────────

class EngagementEntry(BaseModel):
    """camelCase — rendered directly by the UI engagement table."""

    memberId: str
    memberName: str
    activityFrequency: float = Field(ge=0, le=100)
    contributionConsistency: float = Field(ge=0, le=100)
    trainingParticipation: float = Field(ge=0, le=100)
    overallScore: float = Field(ge=0, le=100)
    band: Literal["high", "moderate", "at_risk"]


class EngagementResponse(BaseModel):
    cooperativeId: str | None = None
    engagement: list[EngagementEntry]
    model_name: str
    note: str | None = None


# ─── Benchmarks ──────────────────────────────────────────────────────────────

class BenchmarkEntry(BaseModel):
    """camelCase — rendered directly by the UI benchmarking table."""

    metric: str
    yourValue: float
    averageCooperative: float
    topPerformer: float
    percentile: float = Field(ge=0, le=100)
    trend: Trend
    unit: str = ""


class BenchmarkResponse(BaseModel):
    cooperativeId: str
    benchmarks: list[BenchmarkEntry]
    peerCount: int
    model_name: str
    note: str | None = None


# ─── Model registry ──────────────────────────────────────────────────────────

class ModelInfo(BaseModel):
    name: str
    status: Literal["fitted", "not_trained", "insufficient_data", "stale"]
    accuracy: float | None = None
    metric_name: str | None = None
    observations: int | None = None
    trained_at: str | None = None
    method: str | None = None
    note: str | None = None


class ModelPerformanceResponse(BaseModel):
    models: list[ModelInfo]
    reachable: bool = True


class RetrainRequest(BaseModel):
    modelName: str | None = None
    parameters: dict[str, Any] | None = None


class RetrainResponse(BaseModel):
    status: Literal["completed", "failed", "skipped"]
    trained: list[ModelInfo]
    message: str
