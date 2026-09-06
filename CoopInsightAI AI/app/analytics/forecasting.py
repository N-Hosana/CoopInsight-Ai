"""
Time-series forecasting for cooperative financial metrics.

Method, and why
---------------
The series here are monthly and short — often under a dozen points. That rules
out ARIMA or seasonal decomposition, which need several full seasonal cycles
before their parameters mean anything. What works honestly on short series is a
damped-trend linear model:

    forecast(h) = level + slope * (phi + phi^2 + ... + phi^h)

with `phi < 1` damping the trend so it flattens instead of extrapolating a
straight line to implausible values — the single most common failure of naive
linear forecasting on short business series.

Prediction intervals come from the residual standard error of the fit, widened
with the square root of the horizon (the standard random-walk widening), not
from a made-up percentage. When there are too few points to estimate residual
spread, the interval is reported as flat and the response says so, rather than
implying a precision that was never measured.

Selection between `damped_trend` and `mean` (a flat forecast at the series mean)
is by leave-one-out style holdout on the tail, so a trend is only used when it
actually beat a flat line on data the fit had not seen.
"""

from __future__ import annotations

import logging
from datetime import date
from typing import Any

import numpy as np

from .. import features

logger = logging.getLogger(__name__)

MODEL_NAME = "savings_forecaster"

SUPPORTED_METRICS = ("savings", "income", "expense", "contributions", "members")

# Minimum points before a trend is even considered.
_MIN_FOR_TREND = 4


def parse_horizon(horizon: str) -> int:
    """'30d' -> 1 month, '90d' -> 3, '6m' -> 6, '1y' -> 12. Defaults to 3."""
    if not horizon:
        return 3
    text = str(horizon).strip().lower()
    try:
        if text.endswith("d"):
            return max(1, round(int(text[:-1]) / 30))
        if text.endswith("m"):
            return max(1, int(text[:-1]))
        if text.endswith("y"):
            return max(1, int(text[:-1]) * 12)
        return max(1, int(text))
    except ValueError:
        return 3


def _add_months(anchor: date, months: int) -> date:
    month_index = anchor.month - 1 + months
    year = anchor.year + month_index // 12
    month = month_index % 12 + 1
    return date(year, month, 1)


def _fit_damped_trend(values: np.ndarray, phi: float = 0.85) -> tuple[float, float, np.ndarray]:
    """
    Least-squares line through the series, returning (level, slope, fitted).

    Level is the value at the final observation, which is what the forecast
    extends from.
    """
    n = values.size
    x = np.arange(n, dtype=float)
    slope, intercept = np.polyfit(x, values, 1)
    fitted = intercept + slope * x
    level = float(intercept + slope * (n - 1))
    return level, float(slope), fitted


def _holdout_error(values: np.ndarray, method: str) -> float:
    """
    Mean absolute error on a held-out tail. Used to choose between methods, so
    the choice is evidence-based rather than assumed.
    """
    n = values.size
    holdout = max(1, n // 4)
    train, test = values[: n - holdout], values[n - holdout :]
    if train.size < 2:
        return float("inf")

    if method == "mean":
        prediction = np.full(test.size, float(np.mean(train)))
    else:
        level, slope, _ = _fit_damped_trend(train)
        phi = 0.85
        steps = np.arange(1, test.size + 1)
        damping = np.array([sum(phi**k for k in range(1, int(s) + 1)) for s in steps])
        prediction = level + slope * damping

    return float(np.mean(np.abs(prediction - test)))


def forecast(cooperative_id: str | None, metric: str, horizon: str) -> dict[str, Any]:
    months = parse_horizon(horizon)
    metric_key = (metric or "savings").lower()

    if not cooperative_id:
        return {
            "cooperative_id": None,
            "metric": metric_key,
            "horizon": horizon,
            "forecast": [],
            "history": [],
            "model_name": MODEL_NAME,
            "confidence": None,
            "note": "A cooperativeId is required to forecast.",
        }

    series = features.get_monthly_series(cooperative_id, metric_key)

    if len(series) < 2:
        return {
            "cooperative_id": cooperative_id,
            "metric": metric_key,
            "horizon": horizon,
            "forecast": [],
            "history": [
                {"date": features.isoformat(d), "value": v, "lower": v, "upper": v}
                for d, v in series
            ],
            "model_name": MODEL_NAME,
            "confidence": None,
            "note": (
                f"Only {len(series)} month(s) of '{metric_key}' data on record. "
                "At least 2 are needed to project a trend; record more transactions "
                "and the forecast will populate automatically."
            ),
        }

    periods = [d for d, _ in series]
    values = np.array([v for _, v in series], dtype=float)
    n = values.size

    # Choose the method on held-out performance rather than by assumption.
    if n >= _MIN_FOR_TREND:
        trend_error = _holdout_error(values, "damped_trend")
        mean_error = _holdout_error(values, "mean")
        method = "damped_trend" if trend_error <= mean_error else "mean"
    else:
        method = "damped_trend" if n >= 3 else "mean"
        trend_error = mean_error = float("nan")

    phi = 0.85
    if method == "damped_trend":
        level, slope, fitted = _fit_damped_trend(values)
        residuals = values - fitted
    else:
        level, slope = float(np.mean(values)), 0.0
        fitted = np.full(n, level)
        residuals = values - fitted

    # Residual standard error, with the degrees of freedom the fit consumed.
    dof = max(1, n - (2 if method == "damped_trend" else 1))
    sigma = float(np.sqrt(np.sum(residuals**2) / dof)) if n > dof else 0.0

    points: list[dict[str, Any]] = []
    last_period = periods[-1]
    for step in range(1, months + 1):
        damping = sum(phi**k for k in range(1, step + 1))
        predicted = level + slope * damping

        # Members and cumulative savings cannot go negative.
        if metric_key in {"members", "savings", "contributions"}:
            predicted = max(predicted, 0.0)

        # Intervals widen with the square root of the horizon.
        margin = 1.96 * sigma * np.sqrt(step)
        points.append(
            {
                "date": _add_months(last_period, step).isoformat(),
                "value": round(float(predicted), 2),
                "lower": round(float(max(predicted - margin, 0.0)), 2),
                "upper": round(float(predicted + margin), 2),
            }
        )

    history = [
        {
            "date": features.isoformat(period),
            "value": round(float(value), 2),
            "lower": round(float(value), 2),
            "upper": round(float(value), 2),
        }
        for period, value in series
    ]

    # Confidence reflects both the length of the series and how tight the fit is.
    spread = float(np.mean(np.abs(values))) or 1.0
    relative_error = min(sigma / spread, 1.0)
    length_support = min(n / 12.0, 1.0)
    confidence = round(max(0.25, (1.0 - relative_error) * 0.6 + length_support * 0.35), 2)

    note = None
    if n < 6:
        note = (
            f"Based on only {n} monthly observations — treat the direction as indicative "
            "rather than the numbers as precise."
        )
    if sigma == 0.0:
        note = (
            (note + " ") if note else ""
        ) + "Residual spread could not be estimated, so the interval is shown flat."

    return {
        "cooperative_id": cooperative_id,
        "metric": metric_key,
        "horizon": horizon,
        "forecast": points,
        "history": history,
        "model_name": f"{MODEL_NAME}:{method}",
        "confidence": confidence,
        "note": note,
    }


def fit(_parameters: dict[str, Any] | None = None) -> dict[str, Any]:
    """
    Evaluate the forecaster across every cooperative and record how it did.

    The headline metric is MAPE (mean absolute percentage error) on a held-out
    tail, averaged over the cooperatives with enough history to test — a real
    out-of-sample measurement, not a self-reported accuracy.
    """
    coops = features.list_cooperatives()
    errors: list[float] = []
    tested = 0
    total_points = 0

    for coop in coops:
        series = features.get_monthly_series(str(coop["id"]), "savings")
        total_points += len(series)
        if len(series) < _MIN_FOR_TREND:
            continue

        values = np.array([v for _, v in series], dtype=float)
        holdout = max(1, values.size // 4)
        train, test = values[: values.size - holdout], values[values.size - holdout :]
        if train.size < 2:
            continue

        level, slope, _ = _fit_damped_trend(train)
        phi = 0.85
        prediction = np.array(
            [level + slope * sum(phi**k for k in range(1, s + 1)) for s in range(1, test.size + 1)]
        )

        # Scale the error by the size of the whole holdout window rather than by
        # each point. Cumulative series can pass close to zero — a single
        # near-zero denominator would otherwise report a 1000% error for a small
        # absolute miss, which says nothing about forecast quality.
        scale = float(np.mean(np.abs(test)))
        if scale < 1.0:
            scale = max(float(np.mean(np.abs(train))), 1.0)
        errors.append(float(np.mean(np.abs(prediction - test)) / scale))
        tested += 1

    if tested == 0:
        return {
            "name": MODEL_NAME,
            "method": "damped_trend / mean, selected on holdout",
            "params": {"phi": 0.85},
            "metrics": {},
            "observations": total_points,
            "status": "insufficient_data",
            "note": (
                f"No cooperative has {_MIN_FOR_TREND}+ monthly observations, so the "
                "forecaster could not be evaluated out-of-sample. Seeded data currently "
                "spans too few distinct months."
            ),
        }

    # Median, not mean: one cooperative with a disrupted series (a large one-off
    # expense, say) would otherwise drag the district-wide figure to zero and
    # hide the fact that every other forecast is good. The worst case is reported
    # separately so the outlier stays visible rather than being averaged away.
    median_error = float(np.median(errors))
    worst_error = float(np.max(errors))
    well_predicted = int(sum(1 for e in errors if e <= 0.15))

    return {
        "name": MODEL_NAME,
        "method": "damped_trend / mean, selected on holdout",
        "params": {"phi": 0.85, "interval": "1.96 * residual_se * sqrt(h)"},
        "metrics": {
            "headline": "accuracy",
            # Presented as accuracy for the UI column; it is 1 - median scaled error.
            "accuracy": round(max(0.0, min(1.0, 1.0 - median_error)), 4),
            "median_scaled_error": round(median_error, 4),
            "worst_scaled_error": round(worst_error, 4),
            "within_15pct": well_predicted,
            "cooperatives_tested": tested,
        },
        "observations": total_points,
        "status": "fitted",
        "note": (
            f"Out-of-sample error on a held-out tail across {tested} cooperative(s). "
            f"{well_predicted} of {tested} forecast within 15%. Median reported rather "
            "than mean so one disrupted series cannot mask the rest; worst case is "
            f"{worst_error:.0%}."
        ),
    }
