"""
Model registry.

Fitted parameters and their evaluation metrics are written to disk as JSON, so
that `/model-performance` reports what was genuinely fitted and when, and a
restart does not silently lose the fit. JSON rather than pickle is deliberate:
the artefacts are small, inspectable by hand, and safe to load.

When a real learned model arrives (a scikit-learn estimator, say), add a
`joblib` artefact alongside the JSON and record its path in `artifact`. The
registry interface does not need to change.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .config import get_settings

logger = logging.getLogger(__name__)

# The models this service knows about. The names match what the Node backend
# lists in its offline fallback, so the UI shows a consistent set either way.
KNOWN_MODELS = (
    "anomaly_detector",
    "savings_forecaster",
    "member_engagement_scorer",
    "peer_benchmarker",
    "district_league",
    "cooperative_functionality_auditor",
)


def _store() -> Path:
    path = get_settings().model_store
    path.mkdir(parents=True, exist_ok=True)
    return path


def _path(name: str) -> Path:
    return _store() / f"{name}.json"


def save(name: str, *, method: str, params: dict[str, Any],
         metrics: dict[str, Any], observations: int,
         status: str = "fitted", note: str | None = None) -> dict[str, Any]:
    """Persist a fit. Returns the record that was written."""
    record = {
        "name": name,
        "status": status,
        "method": method,
        "params": params,
        "metrics": metrics,
        "observations": observations,
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "note": note,
    }
    _path(name).write_text(json.dumps(record, indent=2, default=str), encoding="utf-8")
    logger.info("model '%s' saved (%s, n=%d)", name, status, observations)
    return record


def load(name: str) -> dict[str, Any] | None:
    path = _path(name)
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as exc:
        logger.warning("could not read model '%s': %s", name, exc)
        return None


def load_all() -> list[dict[str, Any]]:
    """Every known model, with a not_trained placeholder for ones never fitted."""
    out: list[dict[str, Any]] = []
    for name in KNOWN_MODELS:
        record = load(name)
        if record is None:
            record = {
                "name": name,
                "status": "not_trained",
                "method": None,
                "params": {},
                "metrics": {},
                "observations": None,
                "trained_at": None,
                "note": "Never fitted. POST /retrain to fit against current data.",
            }
        out.append(record)
    return out


def count_fitted() -> int:
    return sum(1 for r in load_all() if r["status"] == "fitted")


def headline_metric(record: dict[str, Any]) -> tuple[float | None, str | None]:
    """
    Pick the single number the UI shows in its 'accuracy' column.

    Different model families are scored differently — a forecaster has no
    'accuracy' — so each fit declares which of its metrics is the headline, and
    this returns it together with the metric's real name so the UI is not
    claiming an accuracy that was never measured.
    """
    metrics = record.get("metrics") or {}
    preferred = metrics.get("headline")
    if preferred and preferred in metrics:
        return _as_float(metrics[preferred]), preferred
    for key in ("accuracy", "coverage", "r2", "precision", "silhouette"):
        if key in metrics:
            return _as_float(metrics[key]), key
    return None, None


def _as_float(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None
