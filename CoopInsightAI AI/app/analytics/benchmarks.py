"""
Peer benchmarking.

Method, and why
---------------
Each cooperative is compared against its peers on a handful of ratios rather than
absolute totals, because absolute totals only say which cooperative is biggest.
Savings per member, surplus margin and activity completion are comparable across
a 30-member carpentry workshop and a 92-member farming cooperative; total savings
is not.

Peers are chosen as same-sector first, falling back to the whole district when a
sector holds too few cooperatives to compare against — and the response says
which peer set was used, because "above average" means something different
against two peers than against twenty.

The reported position is a **percentile**, which is meaningful on small samples,
alongside the peer mean and the best performer. Trend is computed by comparing
the most recent half of the cooperative's transaction history against the earlier
half, and is reported as `stable` when there is not enough history to tell.
"""

from __future__ import annotations

import logging
from typing import Any

import numpy as np

from .. import features

logger = logging.getLogger(__name__)

MODEL_NAME = "peer_benchmarker"

# Fewer peers than this in a sector and the comparison is not worth making.
_MIN_SECTOR_PEERS = 3


def _ratios(coop: dict[str, Any]) -> dict[str, float]:
    members = float(coop.get("member_count") or 0)
    income = float(coop.get("total_income") or 0)
    expense = float(coop.get("total_expense") or 0)
    savings = float(coop.get("total_savings") or 0)
    share_capital = float(coop.get("share_capital") or 0)
    activities = float(coop.get("activity_count") or 0)
    completed = float(coop.get("completed_activities") or 0)

    return {
        "Savings per member": savings / members if members else 0.0,
        "Share capital per member": share_capital / members if members else 0.0,
        "Surplus margin": ((income - expense) / income * 100.0) if income else 0.0,
        "Activity completion rate": (completed / activities * 100.0) if activities else 0.0,
        "Health score": float(coop.get("health_score") or 0),
    }


_UNITS = {
    "Savings per member": "RWF",
    "Share capital per member": "RWF",
    "Surplus margin": "%",
    "Activity completion rate": "%",
    "Health score": "/100",
}


def _percentile(value: float, population: list[float]) -> float:
    """Share of peers at or below this value, as a percentage."""
    if not population:
        return 50.0
    below = sum(1 for v in population if v <= value)
    return round(below / len(population) * 100.0, 1)


def _trend(cooperative_id: str) -> str:
    """
    Compare the recent half of transaction history against the earlier half.
    Returns 'stable' when there is too little to say — which is honest, not lazy.
    """
    transactions = features.get_transactions(cooperative_id)
    if len(transactions) < 4:
        return "stable"

    midpoint = len(transactions) // 2
    early = transactions[:midpoint]
    late = transactions[midpoint:]

    def net(rows: list[dict[str, Any]]) -> float:
        return sum(r["amount"] if r["type"] == "income" else -r["amount"] for r in rows)

    early_net, late_net = net(early), net(late)
    if early_net == 0:
        return "stable"

    change = (late_net - early_net) / abs(early_net)
    if change > 0.10:
        return "up"
    if change < -0.10:
        return "down"
    return "stable"


def compare(cooperative_id: str) -> dict[str, Any]:
    all_coops = features.list_cooperatives()
    subject = next((c for c in all_coops if str(c["id"]) == str(cooperative_id)), None)

    if subject is None:
        return {
            "cooperativeId": cooperative_id,
            "benchmarks": [],
            "peerCount": 0,
            "model_name": MODEL_NAME,
            "note": "Cooperative not found, or it is not active.",
        }

    sector_peers = [c for c in all_coops if c["sector"] == subject["sector"]]
    if len(sector_peers) >= _MIN_SECTOR_PEERS:
        peers, scope = sector_peers, f"{subject['sector']} sector"
    else:
        peers, scope = all_coops, "Gasabo district"

    subject_ratios = _ratios(subject)
    peer_ratios = [_ratios(c) for c in peers]
    trend = _trend(cooperative_id)

    benchmarks: list[dict[str, Any]] = []
    for metric, own_value in subject_ratios.items():
        population = [r[metric] for r in peer_ratios]
        arr = np.array(population, dtype=float)

        benchmarks.append(
            {
                "metric": metric,
                "yourValue": round(own_value, 2),
                "averageCooperative": round(float(np.mean(arr)), 2) if arr.size else 0.0,
                "topPerformer": round(float(np.max(arr)), 2) if arr.size else 0.0,
                "percentile": _percentile(own_value, population),
                "trend": trend,
                "unit": _UNITS.get(metric, ""),
            }
        )

    note = (
        f"Compared against {len(peers)} cooperative(s) in {scope}"
        + (
            f". {subject['sector']} sector holds only {len(sector_peers)} cooperative(s), "
            "so the district was used as the peer group."
            if len(sector_peers) < _MIN_SECTOR_PEERS
            else "."
        )
    )
    if len(peers) < 5:
        note += (
            f" With {len(peers)} peers the percentile is coarse — treat it as a rough "
            "position, not a precise ranking."
        )

    return {
        "cooperativeId": cooperative_id,
        "benchmarks": benchmarks,
        "peerCount": len(peers),
        "model_name": MODEL_NAME,
        "note": note,
    }


def fit(_parameters: dict[str, Any] | None = None) -> dict[str, Any]:
    """
    Record the district-wide distribution of each ratio. Nothing is learned; the
    value is in capturing the reference distribution at a point in time so a
    later comparison can show movement.
    """
    coops = features.list_cooperatives()
    if len(coops) < 2:
        return {
            "name": MODEL_NAME,
            "method": "sector-first peer percentile over ratios",
            "params": {},
            "metrics": {},
            "observations": len(coops),
            "status": "insufficient_data",
            "note": "At least 2 active cooperatives are needed to benchmark.",
        }

    ratios = [_ratios(c) for c in coops]
    distribution: dict[str, Any] = {}
    for metric in ratios[0]:
        arr = np.array([r[metric] for r in ratios], dtype=float)
        distribution[metric] = {
            "mean": round(float(np.mean(arr)), 2),
            "median": round(float(np.median(arr)), 2),
            "p25": round(float(np.percentile(arr, 25)), 2),
            "p75": round(float(np.percentile(arr, 75)), 2),
            "max": round(float(np.max(arr)), 2),
        }

    sectors = {c["sector"] for c in coops}
    return {
        "name": MODEL_NAME,
        "method": "sector-first peer percentile over per-member and margin ratios",
        "params": {"min_sector_peers": _MIN_SECTOR_PEERS, "distribution": distribution},
        "metrics": {
            "headline": "coverage",
            "coverage": 1.0,
            "cooperatives": len(coops),
            "sectors": len(sectors),
            "metrics_tracked": len(distribution),
        },
        "observations": len(coops),
        "status": "fitted",
        "note": (
            f"Reference distribution captured over {len(coops)} active cooperatives in "
            f"{len(sectors)} sectors. Benchmarking is a positional comparison, so "
            "'coverage' is reported rather than accuracy."
        ),
    }
