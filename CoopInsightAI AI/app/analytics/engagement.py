"""
Member engagement scoring.

Method, and why
---------------
Engagement has no ground-truth label in this system — nobody has ever marked a
member as "engaged" — so there is nothing to train a classifier against. What is
defensible is a **transparent weighted index** over observable behaviour, with
the weights stated openly so a cooperative manager can argue with them.

Three components, each normalised to 0–100:

  * activityFrequency        — attendance at cooperative activities
  * contributionConsistency  — how regularly the member pays in, relative to how
                               long they have been a member
  * trainingParticipation    — attendance at training specifically

Normalisation is **relative to the cooperative's own best performer**, not to an
absolute target. A cooperative that holds two activities a year should not have
every member scored near zero; what matters is who turns up relative to what was
on offer.

Where the cooperative records no participation at all, the component cannot be
measured. It is reported as unmeasured and excluded from the weighting rather
than being scored as zero — scoring absence of data as absence of engagement
would silently defame members whose cooperative simply keeps poor records.
"""

from __future__ import annotations

import logging
from datetime import date, datetime
from typing import Any

import numpy as np

from .. import features

logger = logging.getLogger(__name__)

MODEL_NAME = "member_engagement_scorer"

# Stated openly so they can be challenged and changed.
WEIGHTS = {
    "activityFrequency": 0.40,
    "contributionConsistency": 0.40,
    "trainingParticipation": 0.20,
}


def _months_since(value: Any) -> float:
    if value is None:
        return 1.0
    if isinstance(value, datetime):
        value = value.date()
    if not isinstance(value, date):
        return 1.0
    days = (date.today() - value).days
    return max(days / 30.44, 1.0)


def _band(score: float) -> str:
    if score >= 75:
        return "high"
    if score >= 50:
        return "moderate"
    return "at_risk"


def score(cooperative_id: str) -> dict[str, Any]:
    coop = features.get_cooperative(cooperative_id)
    if coop is None:
        return {
            "cooperativeId": cooperative_id,
            "engagement": [],
            "model_name": MODEL_NAME,
            "note": "Cooperative not found.",
        }

    members = features.get_member_engagement_features(cooperative_id)
    if not members:
        return {
            "cooperativeId": cooperative_id,
            "engagement": [],
            "model_name": MODEL_NAME,
            "note": f"{coop['name']} has no members on the register.",
        }

    activities_held = features.count_cooperative_activities(cooperative_id)
    trainings_held = features.count_cooperative_trainings(cooperative_id)

    # Raw signals first, normalised afterwards against the cohort.
    raw: list[dict[str, Any]] = []
    for m in members:
        tenure_months = _months_since(m.get("membership_date"))
        raw.append(
            {
                "id": str(m["id"]),
                "name": m["full_name"],
                "attended": float(m["activities_attended"] or 0),
                "trainings": float(m["trainings_attended"] or 0),
                # Contributions per month of membership — a long-standing member
                # who paid once is less consistent than a new member who paid once.
                "contribution_rate": float(m["contribution_count"] or 0) / tenure_months,
                "contribution_total": float(m["contribution_total"] or 0),
            }
        )

    def normalise(key: str) -> tuple[list[float], bool]:
        values = np.array([r[key] for r in raw], dtype=float)
        peak = float(values.max()) if values.size else 0.0
        if peak <= 0:
            return [0.0] * len(raw), False  # nothing recorded — unmeasurable
        return [round(float(v / peak * 100.0), 1) for v in values], True

    activity_scores, activity_measured = normalise("attended")
    training_scores, training_measured = normalise("trainings")
    contribution_scores, contribution_measured = normalise("contribution_rate")

    # Fall back to savings held when no contribution ledger exists — it is the
    # only remaining evidence that a member is putting money in.
    if not contribution_measured:
        savings = np.array([float(m["total_savings"] or 0) for m in members], dtype=float)
        peak = float(savings.max()) if savings.size else 0.0
        if peak > 0:
            contribution_scores = [round(float(v / peak * 100.0), 1) for v in savings]
            contribution_measured = True

    measured = {
        "activityFrequency": activity_measured,
        "contributionConsistency": contribution_measured,
        "trainingParticipation": training_measured,
    }
    active_weight = sum(w for k, w in WEIGHTS.items() if measured[k])

    entries: list[dict[str, Any]] = []
    for i, r in enumerate(raw):
        components = {
            "activityFrequency": activity_scores[i],
            "contributionConsistency": contribution_scores[i],
            "trainingParticipation": training_scores[i],
        }
        if active_weight > 0:
            overall = sum(
                components[k] * WEIGHTS[k] for k in WEIGHTS if measured[k]
            ) / active_weight
        else:
            overall = 0.0

        entries.append(
            {
                "memberId": r["id"],
                "memberName": r["name"],
                "activityFrequency": components["activityFrequency"],
                "contributionConsistency": components["contributionConsistency"],
                "trainingParticipation": components["trainingParticipation"],
                "overallScore": round(overall, 1),
                "band": _band(overall),
            }
        )

    entries.sort(key=lambda e: e["overallScore"], reverse=True)

    unmeasured = [k for k, ok in measured.items() if not ok]
    note = None
    if unmeasured:
        note = (
            f"{coop['name']} has no recorded data for: {', '.join(unmeasured)}. "
            f"{'No activity attendance has been logged. ' if not measured['activityFrequency'] else ''}"
            "Those components are shown as 0 but excluded from the overall score, "
            "which is weighted only over what is actually measured. "
            f"Activities held: {activities_held}, trainings held: {trainings_held}."
        )

    return {
        "cooperativeId": cooperative_id,
        "engagement": entries,
        "model_name": MODEL_NAME,
        "note": note,
    }


def fit(_parameters: dict[str, Any] | None = None) -> dict[str, Any]:
    """
    There is nothing to learn here — the index is defined, not estimated. What is
    recorded instead is the coverage: the share of members for whom at least one
    component could actually be measured. That is the number that tells you
    whether the score means anything yet.
    """
    coops = features.list_cooperatives()
    total_members = 0
    measurable_members = 0
    coops_with_participation = 0

    for coop in coops:
        members = features.get_member_engagement_features(str(coop["id"]))
        if not members:
            continue
        total_members += len(members)
        participation = sum(int(m["activities_attended"] or 0) for m in members)
        if participation > 0:
            coops_with_participation += 1
        for m in members:
            if (m["activities_attended"] or 0) > 0 or (m["contribution_count"] or 0) > 0:
                measurable_members += 1

    coverage = measurable_members / total_members if total_members else 0.0

    status = "fitted" if coverage > 0 else "insufficient_data"
    note = (
        "Engagement is a transparent weighted index, not a learned model, so "
        "'coverage' (share of members with at least one measurable component) is "
        "reported instead of accuracy."
    )
    if coverage == 0:
        note = (
            "No member has any recorded activity attendance or contribution, so the "
            "index cannot be computed. Record activity_participants rows to enable it."
        )

    return {
        "name": MODEL_NAME,
        "method": "transparent weighted index, cohort-relative normalisation",
        "params": {"weights": WEIGHTS},
        "metrics": {
            "headline": "coverage",
            "coverage": round(coverage, 4),
            "members": total_members,
            "cooperatives_with_participation": coops_with_participation,
        },
        "observations": total_members,
        "status": status,
        "note": note,
    }
