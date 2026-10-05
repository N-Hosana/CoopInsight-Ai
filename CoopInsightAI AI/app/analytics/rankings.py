"""
District league table — monthly comparison of cooperatives.

What this is for
----------------
An RCA or district cooperative officer needs to answer one question quickly:
*which cooperatives are doing well this month, which are slipping, and why?*
A single overall number would not survive being challenged by a cooperative that
disagrees with it, so every rank here decomposes into pillars, every pillar into
named measures, and every measure into the raw figures behind it.

The three things a cooperative is judged on
-------------------------------------------
There are exactly three, because these are the three things a cooperative is
*for*, and a parameter an officer cannot explain to a cooperative in one
sentence is a parameter that should not be in the table:

  FINANCES    40%  Is it making money, and are the members' savings growing?
                     · surplus earned this month, per member          (60%)
                     · growth in savings this month, per member       (40%)

  MEMBER
  ENGAGEMENT  35%  Are the members actually taking part, or is it a
                   cooperative on paper with an office and nobody behind it?
                     · share of members who paid in this month        (60%)
                     · share of invited members who attended          (40%)

  ACTIVITIES  25%  Does it do what it said it would do?
                     · share of the month's planned activities completed (70%)
                     · activities actually held, per 10 members          (30%)

Two dimensions were deliberately REMOVED from an earlier version of this table:

  *Growth* was a pillar of its own. It is a financial question, so it is now a
  measure inside Finances, where an officer looking at "why is this cooperative
  ranked on money" finds both halves of the answer in one place.

  *Scale* — accumulated savings and share capital per member — was scored at
  10%. It measured how old and how rich a cooperative already was, not how it
  performed this month, and it systematically flattered established
  cooperatives over new ones doing better work. It is still REPORTED in the
  evidence, because it is useful context, but it no longer moves the rank.

How the scoring works
---------------------
Each measure is converted to a **percentile within the month's cohort**, not to
an absolute target. This is the important choice: it makes a 30-member carpentry
workshop comparable with a 92-member farming cooperative, and it means the table
always separates the field instead of bunching everyone at 90%+ because the
thresholds were set generously.

A pillar's score is the weighted mean of its measures; the composite is the
weighted mean of the pillars. Weights are stated in `WEIGHTS` and
`PILLAR_MEASURES` and returned in the response, so a cooperative can argue with
them.

Fairness caveats, deliberately surfaced in the response
------------------------------------------------------
* Percentile ranking is zero-sum: somebody is always last, even in a month where
  every cooperative improved. `districtAverage` on each pillar is returned so
  absolute movement is visible alongside relative position.
* A measure that cannot be computed for a cooperative in a month is EXCLUDED
  from its composite rather than scored zero — punishing poor record-keeping as
  if it were poor performance would just teach cooperatives not to file.
  Completion rate, for instance, is unmeasurable in a month where nothing was
  scheduled.
* "Held nothing at all" and "filed nothing at all" are different, and are
  treated differently: a cooperative that recorded money moving but held no
  activities scores zero on activity rate, because that is a real finding. One
  that recorded nothing whatsoever that month is left unmeasured.
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

# ─── The three pillars, and what each is worth ───────────────────────────────
# Stated openly so they can be challenged and changed. They sum to 1.
WEIGHTS = {
    "finances": 0.40,
    "engagement": 0.35,
    "activities": 0.25,
}

DIMENSION_LABELS = {
    "finances": "Finances",
    "engagement": "Member engagement",
    "activities": "Activities delivered",
}

DIMENSION_DESCRIPTIONS = {
    "finances": (
        "Money earned and saved this month, per member: the surplus the cooperative "
        "made, and the growth in what its members have saved with it."
    ),
    "engagement": (
        "Whether the members are taking part: the share who paid into the "
        "cooperative this month, and the share of those invited who turned up to "
        "its activities."
    ),
    "activities": (
        "Whether the cooperative does what it plans: the share of the month's "
        "planned activities it completed, and how much it held at all relative to "
        "its size."
    ),
}

# Each pillar's measures, with the weight of each WITHIN the pillar and the
# sentence that explains it. The same list drives the scoring and the response,
# so the table can never display a weighting it did not use.
PILLAR_MEASURES: dict[str, list[dict[str, Any]]] = {
    "finances": [
        {
            "key": "surplus_per_member",
            "label": "Surplus per member",
            "weight": 0.6,
            "description": "Income less expenses this month, divided by the number of members.",
            "unit": "RWF",
        },
        {
            "key": "savings_growth_per_member",
            "label": "Savings growth per member",
            "weight": 0.4,
            "description": (
                "Change in the cooperative's accumulated position against last month, "
                "divided by the number of members."
            ),
            "unit": "RWF",
        },
    ],
    "engagement": [
        {
            "key": "contributing_share",
            "label": "Members who paid in",
            "weight": 0.6,
            "description": "Share of the register that made any contribution this month.",
            "unit": "%",
        },
        {
            "key": "attendance_rate",
            "label": "Attendance at activities",
            "weight": 0.4,
            "description": "Share of invited members who were recorded as attending.",
            "unit": "%",
        },
    ],
    "activities": [
        {
            "key": "completion_rate",
            "label": "Planned activities completed",
            "weight": 0.7,
            "description": "Share of the activities scheduled for the month that were completed.",
            "unit": "%",
        },
        {
            "key": "activity_rate",
            "label": "Activities held per 10 members",
            "weight": 0.3,
            "description": (
                "Activities actually completed, per 10 members. Separates a cooperative "
                "that planned one meeting and held it from one that is genuinely busy."
            ),
            "unit": "count",
        },
    ],
}

MEASURE_LABELS = {
    measure["key"]: measure["label"]
    for measures in PILLAR_MEASURES.values()
    for measure in measures
}

ALL_MEASURE_KEYS = list(MEASURE_LABELS)


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
    Per cooperative, per month, the raw figures every measure is built from.
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


def _measure_values(
    coop: dict[str, Any],
    period: str,
    previous: str | None,
    facts: dict[str, dict[str, dict[str, float]]],
    periods: list[str],
) -> tuple[dict[str, float | None], dict[str, Any]]:
    """
    The six measures for one cooperative in one month, plus the raw evidence.

    A measure is `None` when it genuinely cannot be computed, which excludes it
    from the composite instead of scoring it zero.
    """
    coop_id = str(coop["id"])
    members = max(int(coop.get("member_count") or 0), 1)
    coop_facts = facts.get(coop_id, {})
    month = coop_facts.get(period, {})

    income = month.get("income", 0.0)
    expense = month.get("expense", 0.0)
    surplus_per_member = (income - expense) / members

    cumulative = _cumulative_savings(coop_facts, periods)
    growth_per_member = (
        (cumulative.get(period, 0.0) - cumulative.get(previous, 0.0)) / members
        if previous
        else None
    )

    contributors = month.get("contributors", 0.0)
    contributing_share = min(contributors / members, 1.0) * 100.0

    invited = month.get("invited", 0.0)
    attended = month.get("attended", 0.0)
    attendance_rate = (attended / invited * 100.0) if invited else None

    scheduled = month.get("activities_scheduled", 0.0)
    completed = month.get("activities_completed", 0.0)
    completion_rate = (completed / scheduled * 100.0) if scheduled else None

    # "Held nothing" is a finding; "filed nothing at all" is missing data. A
    # cooperative that recorded money moving or members paying in, but held no
    # activities, is scored zero here on purpose. One with no records of any
    # kind for the month is left unmeasured.
    filed_something = bool(month)
    activity_rate = (completed / members * 10.0) if filed_something else None

    # Accumulated strength. Reported as context; NOT scored — see the module
    # docstring on why `scale` was removed as a dimension.
    savings_per_member = (
        float(coop.get("total_savings") or 0) + float(coop.get("share_capital") or 0)
    ) / members

    values: dict[str, float | None] = {
        "surplus_per_member": surplus_per_member,
        "savings_growth_per_member": growth_per_member,
        "contributing_share": contributing_share,
        "attendance_rate": attendance_rate,
        "completion_rate": completion_rate,
        "activity_rate": activity_rate,
    }

    evidence = {
        "income": round(income, 2),
        "expense": round(expense, 2),
        "surplus": round(income - expense, 2),
        "surplusPerMember": round(surplus_per_member, 2),
        "savingsGrowthPerMember": round(growth_per_member, 2) if growth_per_member is not None else None,
        "contributors": int(contributors),
        "contributorShare": round(contributing_share, 1),
        "activitiesScheduled": int(scheduled),
        "activitiesCompleted": int(completed),
        "activitiesPer10Members": round(activity_rate, 2) if activity_rate is not None else None,
        "attendanceRate": round(attendance_rate, 1) if attendance_rate is not None else None,
        "completionRate": round(completion_rate, 1) if completion_rate is not None else None,
        # Context only — this figure does not affect the rank.
        "savingsPerMember": round(savings_per_member, 2),
    }
    return values, evidence


def _score_pillars(
    values: dict[str, float | None],
    populations: dict[str, list[float]],
) -> tuple[dict[str, float | None], dict[str, float], list[str], float]:
    """
    Percentile each measure within the cohort, roll them into pillar scores, and
    roll the pillars into one composite.

    Weights are renormalised over whatever could actually be measured, at both
    levels, so a missing measure dilutes nothing and a missing pillar does not
    silently drag the composite down.
    """
    measure_scores: dict[str, float] = {}
    unmeasured: list[str] = []
    for key in ALL_MEASURE_KEYS:
        value = values[key]
        if value is None:
            unmeasured.append(MEASURE_LABELS[key])
            continue
        measure_scores[key] = _percentile(value, populations[key])

    pillar_scores: dict[str, float | None] = {}
    for pillar, measures in PILLAR_MEASURES.items():
        active = [m for m in measures if m["key"] in measure_scores]
        total = sum(m["weight"] for m in active)
        pillar_scores[pillar] = (
            sum(measure_scores[m["key"]] * m["weight"] for m in active) / total if total else None
        )

    active_pillars = {p: w for p, w in WEIGHTS.items() if pillar_scores[p] is not None}
    total_weight = sum(active_pillars.values())
    composite = (
        sum(pillar_scores[p] * w for p, w in active_pillars.items()) / total_weight
        if total_weight
        else 0.0
    )

    return pillar_scores, measure_scores, unmeasured, composite


def league_table(period: str | None = None) -> dict[str, Any]:
    coops = features.list_cooperatives()

    empty = {
        "period": period,
        "availablePeriods": available_periods(),
        "standings": [],
        "weights": WEIGHTS,
        "dimensions": DIMENSION_LABELS,
        "dimensionDescriptions": DIMENSION_DESCRIPTIONS,
        "pillarMeasures": PILLAR_MEASURES,
        "model_name": MODEL_NAME,
    }

    if len(coops) < 2:
        return {
            **empty,
            "note": "At least two active cooperatives are needed to produce a league table.",
        }

    periods = list(reversed(available_periods(36)))
    if not periods:
        return {
            **empty,
            "period": None,
            "availablePeriods": [],
            "note": "No completed transactions on record, so no month can be scored.",
        }

    target = period if period in periods else periods[-1]
    index = periods.index(target)
    previous = periods[index - 1] if index > 0 else None

    facts = _monthly_facts()

    # ── Raw per-cooperative measures for the target month ────────────────────
    raw: list[dict[str, Any]] = []
    for coop in coops:
        values, evidence = _measure_values(coop, target, previous, facts, periods)
        raw.append(
            {
                "cooperativeId": str(coop["id"]),
                "name": coop["name"],
                "sector": coop["sector"],
                "type": coop["type"],
                "memberCount": max(int(coop.get("member_count") or 0), 1),
                "measures": values,
                "evidence": evidence,
            }
        )

    # ── Percentile within the cohort, per measure ────────────────────────────
    populations = {
        key: [r["measures"][key] for r in raw if r["measures"][key] is not None]
        for key in ALL_MEASURE_KEYS
    }

    for entry in raw:
        pillar_scores, measure_scores, unmeasured, composite = _score_pillars(
            entry["measures"], populations
        )
        entry["scores"] = {
            k: (round(v, 1) if v is not None else None) for k, v in pillar_scores.items()
        }
        entry["measureScores"] = {k: round(v, 1) for k, v in measure_scores.items()}
        entry["compositeScore"] = round(composite, 1)
        entry["unmeasured"] = unmeasured

    # ── Previous month, to show movement ─────────────────────────────────────
    previous_ranks: dict[str, int] = {}
    if previous:
        previous_ranks = league_table_scores_only(previous, coops, facts, periods)

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

    # District averages on the underlying MEASURES (absolute figures), which is
    # what makes relative movement readable against absolute movement.
    district_average_measures = {
        key: round(float(np.mean(populations[key])), 2) if populations[key] else 0.0
        for key in ALL_MEASURE_KEYS
    }
    # And on the pillar scores, for the header row of the table.
    district_average = {
        pillar: round(
            float(
                np.mean([s["scores"][pillar] for s in standings if s["scores"][pillar] is not None])
            ),
            1,
        )
        if any(s["scores"][pillar] is not None for s in standings)
        else 0.0
        for pillar in WEIGHTS
    }

    incomplete = [s["name"] for s in standings if s["unmeasured"]]
    note = (
        f"Scored on {target} across three pillars — finances ({int(WEIGHTS['finances'] * 100)}%), "
        f"member engagement ({int(WEIGHTS['engagement'] * 100)}%) and activities delivered "
        f"({int(WEIGHTS['activities'] * 100)}%). Each underlying measure is a percentile within "
        f"the {len(standings)} cooperatives compared, so positions are relative — a cooperative "
        "can fall a place in a month where it improved, if others improved more. District "
        "averages are given for absolute movement."
    )
    if incomplete:
        note += (
            f" Incomplete data this month for: {', '.join(incomplete)} — the affected "
            "measures were excluded from their composite rather than scored zero."
        )

    return {
        "period": target,
        "previousPeriod": previous,
        "availablePeriods": list(reversed(periods)),
        "standings": standings,
        "districtAverage": district_average,
        "districtAverageMeasures": district_average_measures,
        "weights": WEIGHTS,
        "dimensions": DIMENSION_LABELS,
        "dimensionDescriptions": DIMENSION_DESCRIPTIONS,
        "pillarMeasures": PILLAR_MEASURES,
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
    recursing into the full builder. Scored by exactly the same code path, so
    last month's rank cannot have been computed on a different scheme.
    """
    index = periods.index(period) if period in periods else 0
    previous = periods[index - 1] if index > 0 else None

    measures: list[tuple[str, dict[str, float | None]]] = []
    for coop in coops:
        values, _ = _measure_values(coop, period, previous, facts, periods)
        measures.append((str(coop["id"]), values))

    populations = {
        key: [m[key] for _, m in measures if m[key] is not None] for key in ALL_MEASURE_KEYS
    }

    composites: list[tuple[str, float]] = []
    for coop_id, values in measures:
        _, _, _, composite = _score_pillars(values, populations)
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

    method = "percentile-ranked weighted composite over 3 pillars / 6 measures"

    if len(coops) < 2 or not periods:
        return {
            "name": MODEL_NAME,
            "method": method,
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
        "method": method,
        "params": {
            "weights": WEIGHTS,
            "pillars": list(DIMENSION_LABELS),
            "measures": {p: [m["key"] for m in ms] for p, ms in PILLAR_MEASURES.items()},
        },
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
