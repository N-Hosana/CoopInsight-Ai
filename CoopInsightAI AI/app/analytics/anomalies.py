"""
Anomaly detection over cooperative transactions.

Method, and why
---------------
A single cooperative in this dataset has a handful of completed transactions.
Fitting a per-cooperative detector on that would produce a model that calls
everything normal (or everything anomalous) depending on noise. Two things make
detection honest at this volume:

1. **A district-wide baseline.** Spread is estimated from every cooperative's
   transactions in the same category, so a cooperative with four rows is judged
   against a population, not against itself.

2. **Robust statistics.** The modified z-score uses the median and the median
   absolute deviation, so a single extreme value does not inflate the scale and
   mask itself — which is exactly the failure mode of a mean/standard-deviation
   rule on small samples.

`IsolationForest` is used *in addition* once there are enough observations to
support it (see `settings.min_observations_for_model`). Below that threshold it
is skipped rather than fitted on inadequate data, and the method string in the
response says which path ran, so a reader always knows what produced a finding.

Reference for the 3.5 cut-off: Iglewicz & Hoaglin, *How to Detect and Handle
Outliers* (1993).
"""

from __future__ import annotations

import logging
from collections import defaultdict
from typing import Any

import numpy as np

from ..config import get_settings
from .. import features

logger = logging.getLogger(__name__)

# Imported at module load, not inside the request handler. scikit-learn takes
# several seconds to import the first time, and the Node backend gives up on this
# service after 10 seconds — a lazy import made the very first /anomalies/detect
# call time out and fall back to "AI service unreachable", even though the
# service was healthy. Paying the cost at startup keeps every request fast.
try:
    from sklearn.ensemble import IsolationForest

    SKLEARN_AVAILABLE = True
except ImportError:  # pragma: no cover - dependency is pinned in requirements
    IsolationForest = None  # type: ignore[assignment]
    SKLEARN_AVAILABLE = False
    logger.warning("scikit-learn unavailable; multivariate anomaly pass disabled")

MODEL_NAME = "anomaly_detector"

# 0.6745 is the 0.75 quantile of the standard normal; scaling the MAD by it makes
# the statistic comparable to a standard deviation for normally distributed data.
_MAD_SCALE = 0.6745


def modified_zscores(values: np.ndarray) -> np.ndarray:
    """Robust z-scores. Returns zeros when the sample has no spread."""
    if values.size == 0:
        return np.zeros(0)
    median = float(np.median(values))
    deviations = np.abs(values - median)
    mad = float(np.median(deviations))

    if mad == 0.0:
        # Every value identical, or so tightly clustered the MAD collapses. Fall
        # back to the mean absolute deviation before giving up, otherwise a
        # genuine outlier against a constant series would be invisible.
        mean_ad = float(np.mean(deviations))
        if mean_ad == 0.0:
            return np.zeros(values.size)
        return (values - median) / (1.253314 * mean_ad)

    return _MAD_SCALE * (values - median) / mad


def _severity(score: float) -> str:
    magnitude = abs(score)
    if magnitude >= 6.0:
        return "critical"
    if magnitude >= 4.5:
        return "warning"
    return "info"


def _confidence(score: float, sample_size: int) -> float:
    """
    Confidence rises with how extreme the point is and how much data backed the
    baseline, and is deliberately capped below 1.0 — a statistical flag is a
    prompt to look, never a certainty.
    """
    extremity = min(abs(score) / 8.0, 1.0)
    support = min(sample_size / 60.0, 1.0)
    return round(0.45 + 0.4 * extremity + 0.14 * support, 2)


def detect(cooperative_id: str) -> dict[str, Any]:
    """Detect anomalies for one cooperative. Returns the response payload."""
    settings = get_settings()

    coop = features.get_cooperative(cooperative_id)
    if coop is None:
        return {
            "anomalies": [],
            "cooperativeId": cooperative_id,
            "evaluated": 0,
            "method": "none",
            "note": "Cooperative not found.",
        }

    own = features.get_transactions(cooperative_id)
    if not own:
        return {
            "anomalies": [],
            "cooperativeId": cooperative_id,
            "evaluated": 0,
            "method": "none",
            "note": f"{coop['name']} has no completed transactions to examine.",
        }

    population = features.get_all_transaction_amounts()

    # Baseline per (type, category): a large expense is only unusual relative to
    # other expenses of the same kind.
    baselines: dict[tuple[str, str], list[float]] = defaultdict(list)
    for row in population:
        baselines[(row["type"], row["category"])].append(row["amount"])

    anomalies: list[dict[str, Any]] = []
    used_forest = False

    for (txn_type, category), amounts in _grouped(own).items():
        peer_amounts = baselines.get((txn_type, category), [])
        own_amounts = [a["amount"] for a in amounts]
        # Judge against the population where possible, the cooperative's own rows
        # otherwise. `amounts` holds transaction dicts, so take the values.
        reference = np.array(
            peer_amounts if len(peer_amounts) >= 4 else own_amounts, dtype=float
        )
        if reference.size < 3:
            continue

        # Score the cooperative's rows against the reference distribution by
        # appending them, so each is measured on the same scale.
        scores = modified_zscores(np.append(reference, own_amounts))
        own_scores = scores[reference.size:]
        median = float(np.median(reference))

        for txn, score in zip(amounts, own_scores):
            if abs(score) < settings.outlier_threshold:
                continue

            direction = "above" if score > 0 else "below"
            deviation = (txn["amount"] - median) / median if median else None

            anomalies.append(
                {
                    "severity": _severity(score),
                    "title": f"Unusual {category} {txn_type}",
                    "summary": (
                        f"A {category.lower()} {txn_type} of RWF {txn['amount']:,.0f} on "
                        f"{features.isoformat(txn['date'])} is well {direction} the district norm of "
                        f"RWF {median:,.0f} for this category."
                    ),
                    "detail": (
                        f"Modified z-score {score:+.2f} against {reference.size} comparable "
                        f"transactions (threshold ±{settings.outlier_threshold}). "
                        f"Description: {txn.get('description') or 'n/a'}. "
                        "Robust median/MAD scoring; a single extreme value cannot mask itself."
                    ),
                    "affected_metric": f"{category} ({txn_type})",
                    "current_value": round(txn["amount"], 2),
                    "expected_value": round(median, 2),
                    "deviation": round(deviation, 4) if deviation is not None else None,
                    "model_name": f"{MODEL_NAME}:robust_zscore",
                    "confidence": _confidence(score, reference.size),
                }
            )

    # Multivariate pass — only when the data can support it.
    if len(population) >= settings.min_observations_for_model:
        forest_findings = _isolation_forest_pass(own, population)
        if forest_findings is not None:
            used_forest = True
            anomalies.extend(forest_findings)

    anomalies.extend(_structural_checks(coop, own))

    # De-duplicate: the same transaction flagged by two methods is one finding.
    anomalies = _dedupe(anomalies)

    method = "robust_zscore+isolation_forest" if used_forest else "robust_zscore"
    note = None
    if not used_forest:
        note = (
            f"Multivariate pass skipped: fewer than {settings.min_observations_for_model} "
            "transactions district-wide. Robust statistical scoring was used."
        )

    return {
        "anomalies": anomalies,
        "cooperativeId": cooperative_id,
        "evaluated": len(own),
        "method": method,
        "note": note,
    }


def _grouped(transactions: list[dict[str, Any]]) -> dict[tuple[str, str], list[dict[str, Any]]]:
    grouped: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for t in transactions:
        grouped[(t["type"], t["category"])].append(t)
    return grouped


def _isolation_forest_pass(
    own: list[dict[str, Any]], population: list[dict[str, Any]]
) -> list[dict[str, Any]] | None:
    """
    Isolation Forest over (log amount, day-of-month, type) for the whole district.

    Returns None when the fit is not worth trusting. Amount is log-scaled because
    transaction values span orders of magnitude and the raw scale would let the
    largest cooperative dominate the splits.
    """
    if not SKLEARN_AVAILABLE:
        return None

    def vectorise(rows: list[dict[str, Any]]) -> np.ndarray:
        return np.array(
            [
                [
                    np.log1p(max(r["amount"], 0.0)),
                    float(r["date"].day) if hasattr(r["date"], "day") else 15.0,
                    1.0 if r["type"] == "income" else 0.0,
                ]
                for r in rows
            ],
            dtype=float,
        )

    train = vectorise(population)
    if train.shape[0] < get_settings().min_observations_for_model:
        return None

    forest = IsolationForest(
        n_estimators=200,
        contamination="auto",
        random_state=42,
    )
    forest.fit(train)

    subject = vectorise(own)
    labels = forest.predict(subject)
    scores = forest.decision_function(subject)

    findings: list[dict[str, Any]] = []
    for txn, label, score in zip(own, labels, scores):
        if label != -1:
            continue
        findings.append(
            {
                "severity": "warning" if score < -0.15 else "info",
                "title": f"Transaction pattern outlier — {txn['category']}",
                "summary": (
                    f"A {txn['type']} of RWF {txn['amount']:,.0f} on "
                    f"{features.isoformat(txn['date'])} sits apart from the district's "
                    "usual pattern of amount, timing and direction taken together."
                ),
                "detail": (
                    f"Isolation Forest score {score:.3f} (negative is more isolated), "
                    f"fitted on {train.shape[0]} district transactions over log-amount, "
                    "day-of-month and income/expense direction."
                ),
                "affected_metric": f"{txn['category']} ({txn['type']})",
                "current_value": round(txn["amount"], 2),
                "expected_value": None,
                "deviation": None,
                "model_name": f"{MODEL_NAME}:isolation_forest",
                "confidence": round(min(0.5 + abs(float(score)) * 1.2, 0.9), 2),
            }
        )
    return findings


def _structural_checks(coop: dict[str, Any], transactions: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """
    Rule-based checks for conditions that statistics cannot see, such as spending
    exceeding income. These are labelled as rules, not as model output.
    """
    findings: list[dict[str, Any]] = []

    income = sum(t["amount"] for t in transactions if t["type"] == "income")
    expense = sum(t["amount"] for t in transactions if t["type"] == "expense")

    if expense > income and income > 0:
        findings.append(
            {
                "severity": "critical" if expense > income * 1.25 else "warning",
                "title": "Expenditure exceeds income",
                "summary": (
                    f"{coop['name']} has recorded RWF {expense:,.0f} of expenses against "
                    f"RWF {income:,.0f} of income — a deficit of RWF {expense - income:,.0f}."
                ),
                "detail": (
                    "Computed from all completed transactions on record. A sustained deficit "
                    "erodes member savings and share capital."
                ),
                "affected_metric": "Net Surplus (RWF)",
                "current_value": round(income - expense, 2),
                "expected_value": 0.0,
                "deviation": round((income - expense) / income, 4) if income else None,
                "model_name": f"{MODEL_NAME}:rule",
                "confidence": 0.95,
            }
        )

    member_count = int(coop.get("member_count") or 0)
    savings = float(coop.get("total_savings") or 0)
    if member_count > 0:
        per_member = savings / member_count
        if per_member < 5000:
            findings.append(
                {
                    "severity": "warning",
                    "title": "Very low savings per member",
                    "summary": (
                        f"Average savings per member is RWF {per_member:,.0f} across "
                        f"{member_count} members, which is low enough to question whether "
                        "contributions are being recorded."
                    ),
                    "detail": (
                        "Either members are not contributing, or contributions are being "
                        "collected but not entered into the register."
                    ),
                    "affected_metric": "Savings per Member (RWF)",
                    "current_value": round(per_member, 2),
                    "expected_value": 5000.0,
                    "deviation": round((per_member - 5000) / 5000, 4),
                    "model_name": f"{MODEL_NAME}:rule",
                    "confidence": 0.8,
                }
            )

    return findings


def _dedupe(anomalies: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[tuple[Any, Any]] = set()
    unique: list[dict[str, Any]] = []
    for a in anomalies:
        key = (a.get("affected_metric"), a.get("current_value"))
        if key in seen:
            continue
        seen.add(key)
        unique.append(a)
    return unique


def fit(_parameters: dict[str, Any] | None = None) -> dict[str, Any]:
    """
    Fit the district baseline and record how it performs.

    'Accuracy' has no meaning without labelled anomalies, and none exist, so what
    is recorded is the flag rate — the proportion of district transactions the
    detector marks. A rate far above a few percent means the threshold is too
    tight for this data, which is a real, checkable property.
    """
    settings = get_settings()
    population = features.get_all_transaction_amounts()
    n = len(population)

    if n < 3:
        return registry_stub(
            status="insufficient_data",
            observations=n,
            note=f"Only {n} completed transactions district-wide; need at least 3.",
        )

    by_category: dict[tuple[str, str], list[float]] = defaultdict(list)
    for row in population:
        by_category[(row["type"], row["category"])].append(row["amount"])

    params: dict[str, Any] = {}
    flagged = 0
    for (txn_type, category), amounts in by_category.items():
        arr = np.array(amounts, dtype=float)
        scores = modified_zscores(arr)
        flagged += int(np.sum(np.abs(scores) >= settings.outlier_threshold))
        params[f"{txn_type}:{category}"] = {
            "median": round(float(np.median(arr)), 2),
            "mad": round(float(np.median(np.abs(arr - np.median(arr)))), 2),
            "n": int(arr.size),
        }

    flag_rate = flagged / n

    return {
        "name": MODEL_NAME,
        "method": "robust_zscore(median/MAD) per type+category, district baseline",
        "params": {
            "threshold": settings.outlier_threshold,
            "categories": params,
        },
        "metrics": {
            "headline": "flag_rate",
            "flag_rate": round(flag_rate, 4),
            "flagged": flagged,
            "categories_modelled": len(params),
        },
        "observations": n,
        "status": "fitted",
        "note": (
            "No labelled anomalies exist, so flag_rate (share of district transactions "
            "flagged) is reported instead of accuracy."
        ),
    }


def registry_stub(*, status: str, observations: int, note: str) -> dict[str, Any]:
    return {
        "name": MODEL_NAME,
        "method": "robust_zscore(median/MAD)",
        "params": {},
        "metrics": {},
        "observations": observations,
        "status": status,
        "note": note,
    }
