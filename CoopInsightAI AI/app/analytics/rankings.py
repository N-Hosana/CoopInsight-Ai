"""
District league table — monthly comparison of cooperatives.

What this is for
----------------
An RCA or district cooperative officer needs to answer one question quickly:
*which cooperatives are doing well this month, which are slipping, and why?*
A single overall number alone would not survive being challenged by a
cooperative that disagrees with it, so every rank here decomposes into five
dimensions, and every dimension decomposes into the raw figures behind it.

How a cooperative is scored
---------------------------
For a given month, five dimensions are computed from the operational data:

  finance     net surplus that month, per member
  growth      change in savings against the previous month, per member
  engagement  share of members who contributed, and attendance at activities
  governance  share of scheduled activities actually completed
  scale       savings and share capital per member (accumulated strength)

Each dimension is converted to a **percentile within the month's cohort**, not
to an absolute target. This is the important choice: it makes a 30-member
carpentry workshop comparable with a 92-member farming cooperative, and it means
the table always separates the field instead of bunching everyone at 90%+
because the thresholds were set generously.

The composite is a weighted mean of the five, with weights stated in `WEIGHTS`
so a cooperative can argue with them.

Fairness caveats, deliberately surfaced in the response
------------------------------------------------------
* Percentile ranking is zero-sum: somebody is always last, even in a month where
  every cooperative improved. `districtAverage` on each dimension is returned so
  absolute movement is visible alongside relative position.
* A cooperative with no recorded activity in a month cannot be scored on
  governance. It is marked as having incomplete data for that month rather than
  being scored zero, which would punish poor record-keeping as if it were poor
  performance.
"""

from __future__ import annotations

import logging
from collections import defaultdict
from datetime import date
from typing import Any

import numpy as np

from .. import db, features

logger = logging.getLogger(__name__)

MODEL_NAME = "district_league"

# Stated openly so they can be challenged and changed.
WEIGHTS = {
    "finance": 0.30,
    "growth": 0.20,
    "engagement": 0.25,
    "governance": 0.15,
    "scale": 0.10,
}

DIMENSION_LABELS = {
    "finance": "Financial performance",
    "growth": "Growth",
    "engagement": "Member engagement",
    "governance": "Governance & delivery",
    "scale": "Financial strength",
}

DIMENSION_DESCRIPTIONS = {
    "finance": "Net surplus earned that month, per member.",
    "growth": "Change in accumulated savings against the previous month, per member.",
    "engagement": "Share of members contributing, and attendance at activities held.",
    "governance": "Share of activities scheduled that month that were actually completed.",
    "scale": "Accumulated savings and share capital per member.",
}


def _month_key(value: date) -> str:
    return f"{value.year:04d}-{value.month:02d}"


def available_periods(limit: int = 24) -> list[str]:
    """Months that actually have transaction activity, newest first."""
    rows = db.fetch_all(
        """
        SELECT DISTINCT DATE_TRUNC('month', date)::date AS period
          FROM transactions
         WHERE status = 'completed'
         ORDER BY period DESC
         LIMIT %s
        """,
        (limit,),
    )
    return [_month_key(r["period"]) for r in rows]


def _monthly_facts() -> dict[str, dict[str, dict[str, float]]]:
    """
    Per cooperative, per month, the raw figures every dimension is built from.
    One pass over each table rather than a query per cooperative per month.
    """
    facts: dict[str, dict[str, dict[str, float]]] = defaultdict(lambda: defaultdict(dict))

    def bump(coop: str, period: str, key: str, value: float) -> None:
        facts[coop][period][key] = facts[coop][period].get(key, 0.0) + value

    for row in db.fetch_all(
        """
        SELECT cooperative_id, DATE_TRUNC('month', date)::date AS period, type,
               SUM(amount) AS total
          FROM transactions
         WHERE status = 'completed'
         GROUP BY 1, 2, 3
        """
    ):
        bump(str(row["cooperative_id"]), _month_key(row["period"]),
             "income" if row["type"] == "income" else "expense", float(row["total"]))

    for row in db.fetch_all(
        """
        SELECT m.cooperative_id, DATE_TRUNC('month', mc.date)::date AS period,
               SUM(mc.amount) AS total, COUNT(DISTINCT mc.member_id) AS contributors
          FROM member_contributions mc
          JOIN members m ON m.id = mc.member_id
         WHERE m.deleted_at IS NULL
         GROUP BY 1, 2
        """
    ):
        period = _month_key(row["period"])
        coop = str(row["cooperative_id"])
        bump(coop, period, "contributions", float(row["total"]))
        bump(coop, period, "contributors", float(row["contributors"]))

    for row in db.fetch_all(
        """
        SELECT cooperative_id, DATE_TRUNC('month', date)::date AS period,
               COUNT(*) AS scheduled,
               COUNT(*) FILTER (WHERE status = 'completed') AS completed
          FROM activities
         WHERE deleted_at IS NULL
         GROUP BY 1, 2
        """
    ):
        period = _month_key(row["period"])
        coop = str(row["cooperative_id"])
        bump(coop, period, "activities_scheduled", float(row["scheduled"]))
        bump(coop, period, "activities_completed", float(row["completed"]))

    for row in db.fetch_all(
        """
        SELECT a.cooperative_id, DATE_TRUNC('month', a.date)::date AS period,
               COUNT(*) AS invited,
               COUNT(*) FILTER (WHERE ap.attended) AS attended
          FROM activity_participants ap
          JOIN activities a ON a.id = ap.activity_id
         WHERE a.deleted_at IS NULL
         GROUP BY 1, 2
        """
    ):
        period = _month_key(row["period"])
        coop = str(row["cooperative_id"])
        bump(coop, period, "invited", float(row["invited"]))
        bump(coop, period, "attended", float(row["attended"]))

    return facts


def _cumulative_savings(facts: dict[str, dict[str, float]], periods: list[str]) -> dict[str, float]:
    """Running savings position at the end of each month, from net cash flow."""
    running = 0.0
    out: dict[str, float] = {}
    for period in periods:
        month = facts.get(period, {})
        running += month.get("income", 0.0) - month.get("expense", 0.0)
        out[period] = running
    return out


def _percentile(value: float, population: list[float]) -> float:
    """Position within the cohort, 0-100. Ties share the same percentile."""
    if not population:
        return 50.0
    below = sum(1 for v in population if v < value)
    equal = sum(1 for v in population if v == value)
    return round((below + 0.5 * equal) / len(population) * 100.0, 1)


def league_table(period: str | None = None) -> dict[str, Any]:
    coops = features.list_cooperatives()
    if len(coops) < 2:
        return {
            "period": period,
            "availablePeriods": available_periods(),
            "standings": [],
            "weights": WEIGHTS,
            "dimensions": DIMENSION_LABELS,
            "model_name": MODEL_NAME,
            "note": "At least two active cooperatives are needed to produce a league table.",
        }

    periods = list(reversed(available_periods(36)))
    if not periods:
        return {
            "period": None,
            "availablePeriods": [],
            "standings": [],
            "weights": WEIGHTS,
            "dimensions": DIMENSION_LABELS,
            "model_name": MODEL_NAME,
            "note": "No completed transactions on record, so no month can be scored.",
        }

    target = period if period in periods else periods[-1]
    index = periods.index(target)
    previous = periods[index - 1] if index > 0 else None

    facts = _monthly_facts()

    # ── Raw per-cooperative measures for the target month ────────────────────
    raw: list[dict[str, Any]] = []
    for coop in coops:
        coop_id = str(coop["id"])
        members = max(int(coop.get("member_count") or 0), 1)
        coop_facts = facts.get(coop_id, {})
        month = coop_facts.get(target, {})

        income = month.get("income", 0.0)
        expense = month.get("expense", 0.0)
        surplus_per_member = (income - expense) / members

        cumulative = _cumulative_savings(coop_facts, periods)
        growth_per_member = (
            (cumulative.get(target, 0.0) - cumulative.get(previous, 0.0)) / members
            if previous
            else 0.0
        )

        contributors = month.get("contributors", 0.0)
        contributor_share = min(contributors / members, 1.0) * 100.0

        invited = month.get("invited", 0.0)
        attended = month.get("attended", 0.0)
        attendance_rate = (attended / invited * 100.0) if invited else None

        # Engagement blends who paid in with who turned up. When no activity was
        # held that month, contribution share carries it alone rather than the
        # cooperative being scored down for a month with nothing scheduled.
        engagement = (
            contributor_share * 0.6 + attendance_rate * 0.4
            if attendance_rate is not None
            else contributor_share
        )

        scheduled = month.get("activities_scheduled", 0.0)
        completed = month.get("activities_completed", 0.0)
        governance = (completed / scheduled * 100.0) if scheduled else None

        scale = (
            float(coop.get("total_savings") or 0) + float(coop.get("share_capital") or 0)
        ) / members

        raw.append(
            {
                "cooperativeId": coop_id,
                "name": coop["name"],
                "sector": coop["sector"],
                "type": coop["type"],
                "memberCount": members,
                "measures": {
                    "finance": surplus_per_member,
                    "growth": growth_per_member,
                    "engagement": engagement,
                    "governance": governance,
                    "scale": scale,
                },
                "evidence": {
                    "income": round(income, 2),
                    "expense": round(expense, 2),
                    "surplus": round(income - expense, 2),
                    "surplusPerMember": round(surplus_per_member, 2),
                    "savingsGrowthPerMember": round(growth_per_member, 2),
                    "contributors": int(contributors),
                    "contributorShare": round(contributor_share, 1),
                    "activitiesScheduled": int(scheduled),
                    "activitiesCompleted": int(completed),
                    "attendanceRate": round(attendance_rate, 1) if attendance_rate is not None else None,
                    "savingsPerMember": round(scale, 2),
                },
            }
        )

    # ── Percentile within the cohort, per dimension ──────────────────────────
    populations = {
        key: [r["measures"][key] for r in raw if r["measures"][key] is not None]
        for key in WEIGHTS
    }

    for entry in raw:
        scores: dict[str, float | None] = {}
        missing: list[str] = []
        for key in WEIGHTS:
            value = entry["measures"][key]
            if value is None:
                scores[key] = None
                missing.append(DIMENSION_LABELS[key])
                continue
            scores[key] = _percentile(value, populations[key])

        # Weight only over the dimensions that could actually be measured.
        active = {k: w for k, w in WEIGHTS.items() if scores[k] is not None}
        total_weight = sum(active.values())
        composite = (
            sum(scores[k] * w for k, w in active.items()) / total_weight
            if total_weight
            else 0.0
        )

        entry["scores"] = {k: (round(v, 1) if v is not None else None) for k, v in scores.items()}
        entry["compositeScore"] = round(composite, 1)
        entry["unmeasured"] = missing

    # ── Previous month, to show movement ─────────────────────────────────────
    previous_ranks: dict[str, int] = {}
    if previous:
        prior = league_table_scores_only(previous, coops, facts, periods)
        previous_ranks = {c: r for c, r in prior.items()}

    raw.sort(key=lambda e: e["compositeScore"], reverse=True)

    standings: list[dict[str, Any]] = []
    for position, entry in enumerate(raw, start=1):
        was = previous_ranks.get(entry["cooperativeId"])
        standings.append(
            {
                **entry,
                "rank": position,
                "previousRank": was,
                "rankChange": (was - position) if was else None,
                "band": _band(entry["compositeScore"]),
            }
        )

    district_average = {
        key: round(float(np.mean(populations[key])), 2) if populations[key] else 0.0
        for key in WEIGHTS
    }

    incomplete = [s["name"] for s in standings if s["unmeasured"]]
    note = (
        f"Scored on {target}. Each dimension is a percentile within the {len(standings)} "
        "cooperatives compared, so positions are relative — a cooperative can fall a place "
        "in a month where it improved, if others improved more. District averages are "
        "given for absolute movement."
    )
    if incomplete:
        note += (
            f" Incomplete data this month for: {', '.join(incomplete)} — the affected "
            "dimensions were excluded from their composite rather than scored zero."
        )

    return {
        "period": target,
        "previousPeriod": previous,
        "availablePeriods": list(reversed(periods)),
        "standings": standings,
        "districtAverage": district_average,
        "weights": WEIGHTS,
        "dimensions": DIMENSION_LABELS,
        "dimensionDescriptions": DIMENSION_DESCRIPTIONS,
        "model_name": MODEL_NAME,
        "note": note,
    }


def league_table_scores_only(
    period: str,
    coops: list[dict[str, Any]],
    facts: dict[str, dict[str, dict[str, float]]],
    periods: list[str],
) -> dict[str, int]:
    """
    Ranks for one month, without the narrative. Used to compute movement without
    recursing into the full builder.
    """
    index = periods.index(period) if period in periods else 0
    previous = periods[index - 1] if index > 0 else None

    measures: list[tuple[str, dict[str, float | None]]] = []
    for coop in coops:
        coop_id = str(coop["id"])
        members = max(int(coop.get("member_count") or 0), 1)
        coop_facts = facts.get(coop_id, {})
        month = coop_facts.get(period, {})

        income = month.get("income", 0.0)
        expense = month.get("expense", 0.0)
        cumulative = _cumulative_savings(coop_facts, periods)

        invited = month.get("invited", 0.0)
        attended = month.get("attended", 0.0)
        attendance = (attended / invited * 100.0) if invited else None
        contributor_share = min(month.get("contributors", 0.0) / members, 1.0) * 100.0
        scheduled = month.get("activities_scheduled", 0.0)

        measures.append(
            (
                coop_id,
                {
                    "finance": (income - expense) / members,
                    "growth": (
                        (cumulative.get(period, 0.0) - cumulative.get(previous, 0.0)) / members
                        if previous
                        else 0.0
                    ),
                    "engagement": (
                        contributor_share * 0.6 + attendance * 0.4
                        if attendance is not None
                        else contributor_share
                    ),
                    "governance": (
                        month.get("activities_completed", 0.0) / scheduled * 100.0
                        if scheduled
                        else None
                    ),
                    "scale": (
                        float(coop.get("total_savings") or 0) + float(coop.get("share_capital") or 0)
                    ) / members,
                },
            )
        )

    populations = {
        key: [m[key] for _, m in measures if m[key] is not None] for key in WEIGHTS
    }

    composites: list[tuple[str, float]] = []
    for coop_id, m in measures:
        active = {k: w for k, w in WEIGHTS.items() if m[k] is not None}
        total_weight = sum(active.values())
        composite = (
            sum(_percentile(m[k], populations[k]) * w for k, w in active.items()) / total_weight
            if total_weight
            else 0.0
        )
        composites.append((coop_id, composite))

    composites.sort(key=lambda x: x[1], reverse=True)
    return {coop_id: position for position, (coop_id, _) in enumerate(composites, start=1)}


def _band(score: float) -> str:
    if score >= 75:
        return "leading"
    if score >= 50:
        return "solid"
    if score >= 30:
        return "needs_support"
    return "at_risk"


def trend(months: int = 6) -> dict[str, Any]:
    """Composite score per cooperative over the last N months, for a trend chart."""
    coops = features.list_cooperatives()
    periods = list(reversed(available_periods(36)))
    if not periods or len(coops) < 2:
        return {"periods": [], "series": [], "model_name": MODEL_NAME}

    window = periods[-months:] if len(periods) > months else periods
    facts = _monthly_facts()

    series: dict[str, dict[str, Any]] = {
        str(c["id"]): {"cooperativeId": str(c["id"]), "name": c["name"], "points": []}
        for c in coops
    }

    for period in window:
        ranks = league_table_scores_only(period, coops, facts, periods)
        for coop_id, rank in ranks.items():
            if coop_id in series:
                series[coop_id]["points"].append({"period": period, "rank": rank})

    return {
        "periods": window,
        "series": list(series.values()),
        "model_name": MODEL_NAME,
        "note": (
            f"Rank position per month over the last {len(window)} month(s). "
            "Lower is better; 1 is top of the district."
        ),
    }


def fit(_parameters: dict[str, Any] | None = None) -> dict[str, Any]:
    """
    Nothing is learned — the league table is a defined scoring scheme. What is
    recorded is how many months can actually be scored and how well the composite
    separates the field, since a scheme that scores everyone the same is useless
    even if it runs without error.
    """
    periods = available_periods(36)
    coops = features.list_cooperatives()

    if len(coops) < 2 or not periods:
        return {
            "name": MODEL_NAME,
            "method": "percentile-ranked weighted composite over 5 dimensions",
            "params": {"weights": WEIGHTS},
            "metrics": {},
            "observations": len(periods),
            "status": "insufficient_data",
            "note": "Need at least 2 active cooperatives and 1 month of transactions.",
        }

    latest = league_table(periods[0])
    composites = [s["compositeScore"] for s in latest["standings"]]
    spread = float(np.std(composites)) if composites else 0.0

    return {
        "name": MODEL_NAME,
        "method": "percentile-ranked weighted composite over 5 dimensions",
        "params": {"weights": WEIGHTS, "dimensions": list(DIMENSION_LABELS)},
        "metrics": {
            "headline": "separation",
            # Standard deviation of composite scores, normalised against the ~28.9
            # a perfectly uniform spread over 0-100 would give. Near 1 means the
            # table genuinely distinguishes cooperatives.
            "separation": round(min(spread / 28.9, 1.0), 4),
            "score_spread": round(spread, 2),
            "months_scorable": len(periods),
            "cooperatives_ranked": len(composites),
        },
        "observations": len(periods),
        "status": "fitted",
        "note": (
            f"{len(periods)} month(s) scorable across {len(composites)} cooperatives. "
            "'separation' measures whether the composite actually distinguishes them; "
            "a scheme that scores everyone alike would read near 0."
        ),
    }
