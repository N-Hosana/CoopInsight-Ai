"""
Monthly functionality and engagement audit.

What this is for
----------------
Cooperatives very rarely announce that they have stopped working. They go quiet:
the meetings stop, the contributions stop, nobody files anything, and eighteen
months later a sector officer discovers that a cooperative on the register has
not traded since the year before last. By then the members have lost their
savings and the only thing left to do is dissolve it.

This audit runs over every cooperative in the district once a month and answers
two questions from the operational data:

  * **Functionality** — is this cooperative actually operating? Is it trading,
    meeting, keeping books, and does it still have a licence?
  * **Engagement**    — are its members still taking part, or has it become a
    committee of three?

The two combine into a band, and the bottom of the district turns into a
**visit list**: the cooperatives a sector officer should physically go and see
this month, ranked, each with the reason it was flagged. The point of the audit
is not the score. The point is the visit.

Why silence counts against a cooperative here, when it does not elsewhere
------------------------------------------------------------------------
Everywhere else in this system, missing data is excluded from a score rather
than counted as zero — punishing a cooperative for poor record-keeping as if it
were poor performance would make the number indefensible.

This audit deliberately breaks that rule, and it is important to be clear why.
A cooperative that has recorded nothing for six months is the exact case this is
built to catch, so silence has to be a signal or the audit detects nothing. What
keeps it honest is the *output*: a flagged cooperative is not marked failing, it
is put on a list for somebody to go and check. `evidence_quality` on every row
says how much of the band rests on real records versus on absence of them, and a
cooperative flagged purely on silence is labelled as such, so an officer knows
they may be visiting a cooperative that simply is not using the system.

Method
------
A transparent weighted index, not a learned model. There are no labelled
"this cooperative had failed by March" examples anywhere in the schema to train
against, and a band that decides whether somebody drives out to a village has to
be explainable to that village. The components, weights and thresholds are all
stated below and returned with every result.
"""

from __future__ import annotations

import logging
from datetime import date, datetime, timedelta
from typing import Any

from .. import features

logger = logging.getLogger(__name__)

MODEL_NAME = "cooperative_functionality_auditor"
MODEL_VERSION = "1.0"

# ── Component weights, stated openly so they can be argued with ──────────────

FUNCTIONALITY_WEIGHTS = {
    "trading": 0.35,       # is money still moving through it
    "meeting": 0.25,       # is it governing itself
    "record_keeping": 0.20,  # are the books and documents being kept
    "membership": 0.20,    # is the register stable or emptying
}

ENGAGEMENT_WEIGHTS = {
    "contribution_breadth": 0.45,  # share of members still paying in
    "attendance_breadth": 0.35,    # share of members still turning up
    "activity_supply": 0.20,       # was there anything to turn up to
}

# Functionality carries more weight: a cooperative can have engaged members and
# still be finished, but one that has stopped operating is finished regardless.
COMPOSITE_WEIGHTS = {"functionality": 0.6, "engagement": 0.4}

# Band thresholds on the 0–100 composite.
BAND_THRESHOLDS = {"healthy": 70.0, "monitor": 50.0, "at_risk": 30.0}

# Months of silence after which a cooperative is treated as dormant regardless of
# what its other scores say.
DORMANCY_MONTHS = 6
# Months of silence that put it on the watch list.
QUIET_MONTHS = 3


def _months_between(earlier: date | None, later: date) -> float | None:
    """Whole-ish months from `earlier` to `later`; None when never recorded."""
    if earlier is None:
        return None
    if isinstance(earlier, datetime):
        earlier = earlier.date()
    return max(0.0, (later - earlier).days / 30.44)


def _clamp(value: float, low: float = 0.0, high: float = 1.0) -> float:
    return max(low, min(high, value))


def _month_start(value: date) -> date:
    return date(value.year, value.month, 1)


def _previous_month_start(value: date) -> date:
    first = _month_start(value)
    return _month_start(first - timedelta(days=1))


def _default_period(today: date | None = None) -> date:
    """
    Which month to audit when the caller does not say.

    The last **completed** month, not the current one. Run on the 8th, an audit
    of the month in progress would report that every cooperative had stopped
    trading, because most of them trade later in the month — the audit would
    manufacture a district-wide crisis every time somebody opened it early.

    Where the data itself stops earlier than that (a demo database, or a district
    that has not filed in a while), the last month that actually holds anything
    is used instead, so the audit shows a real month rather than an empty one.
    """
    today = today or date.today()
    last_complete = _previous_month_start(today)
    latest = features.latest_period_with_data()
    if latest is None:
        return last_complete
    return min(_month_start(latest), last_complete)


def _period_bounds(period: str | None) -> tuple[date, date]:
    """Resolve a YYYY-MM string to (period_start, period_end)."""
    if period:
        year, month = (int(p) for p in period.split("-")[:2])
        start = date(year, month, 1)
    else:
        start = _default_period()
    nxt = date(start.year + 1, 1, 1) if start.month == 12 else date(start.year, start.month + 1, 1)
    return start, nxt - timedelta(days=1)


def _score_trading(row: dict[str, Any], period_end: date) -> tuple[float, list[str], bool]:
    """Is money still moving? Returns (0–1, reasons, measured-from-records)."""
    reasons: list[str] = []
    months_quiet = _months_between(row.get("last_transaction_on"), period_end)

    if months_quiet is None:
        reasons.append("No transaction has ever been recorded for this cooperative.")
        return 0.0, reasons, False

    # Recency is the dominant term: a cooperative that traded last month is alive.
    recency = _clamp(1.0 - months_quiet / DORMANCY_MONTHS)
    if months_quiet >= DORMANCY_MONTHS:
        reasons.append(
            f"Nothing has been recorded for {months_quiet:.0f} months — the cooperative "
            "looks dormant."
        )
    elif months_quiet >= QUIET_MONTHS:
        reasons.append(f"No transaction in {months_quiet:.0f} months.")

    # Consistency over the last half-year, so one busy month does not mask a stop.
    consistency = _clamp(float(row.get("trading_months_of_6") or 0) / 6.0)
    if consistency < 0.5:
        reasons.append(
            f"Income was recorded in only {int(row.get('trading_months_of_6') or 0)} of the "
            "last 6 months."
        )

    income = float(row.get("income_in_month") or 0)
    if income <= 0 and months_quiet < QUIET_MONTHS:
        reasons.append("No income at all in the audited month.")

    return 0.6 * recency + 0.4 * consistency, reasons, True


def _score_meeting(row: dict[str, Any], period_end: date) -> tuple[float, list[str], bool]:
    """Is the cooperative governing itself?"""
    reasons: list[str] = []
    meetings = int(row.get("meetings_last_6_months") or 0)
    months_since_activity = _months_between(row.get("last_activity_on"), period_end)

    if months_since_activity is None and meetings == 0:
        reasons.append("No activity or meeting has ever been recorded.")
        return 0.0, reasons, False

    # Cooperative bylaws in Rwanda generally expect a general assembly at least
    # twice a year; two meetings in six months scores full marks here.
    cadence = _clamp(meetings / 2.0)
    if meetings == 0:
        reasons.append("No meeting has been held in the last 6 months.")
    elif meetings == 1:
        reasons.append("Only one meeting in the last 6 months.")

    recency = _clamp(1.0 - (months_since_activity or DORMANCY_MONTHS) / DORMANCY_MONTHS)

    planned = int(row.get("activities_in_month") or 0)
    completed = int(row.get("activities_completed") or 0)
    if planned > 0:
        delivery = completed / planned
        if delivery < 0.5:
            reasons.append(
                f"Only {completed} of {planned} activities planned this month were completed."
            )
    else:
        delivery = None

    if delivery is None:
        return 0.5 * cadence + 0.5 * recency, reasons, True
    return 0.4 * cadence + 0.3 * recency + 0.3 * delivery, reasons, True


def _score_records(row: dict[str, Any], period_end: date) -> tuple[float, list[str], bool]:
    """Are the books and the governance file being kept?"""
    reasons: list[str] = []
    months_since_balance = _months_between(row.get("last_balance_sheet_on"), period_end)
    documents = int(row.get("document_count") or 0)
    leaders = int(row.get("leaders_recorded") or 0)

    if months_since_balance is None:
        balance_score = 0.0
        reasons.append("No balance sheet has ever been filed.")
    elif months_since_balance <= 12:
        balance_score = 1.0
    elif months_since_balance <= 24:
        balance_score = 0.5
        reasons.append(f"The last balance sheet is {months_since_balance / 12:.1f} years old.")
    else:
        balance_score = 0.0
        reasons.append(f"The last balance sheet is {months_since_balance / 12:.1f} years old.")

    document_score = _clamp(documents / 3.0)
    if documents < 2:
        reasons.append(f"Only {documents} document(s) on the cooperative's file.")

    leadership_score = _clamp(leaders / 3.0)
    if leaders < 3:
        reasons.append(f"{leaders} of 3 office-bearers are recorded by name.")

    permit_type = row.get("permit_type")
    permit_expires = row.get("permit_expires_on")
    if permit_type is None:
        reasons.append("No operating permit is recorded against this cooperative.")
        permit_score = 0.0
    else:
        days_left = (permit_expires - period_end).days if permit_expires else 0
        if days_left < 0:
            permit_score = 0.0
            reasons.append(f"The {permit_type} operating permit has expired.")
        elif days_left < 60:
            permit_score = 0.5
            reasons.append(
                f"The {permit_type} operating permit expires in {days_left} days."
            )
        else:
            permit_score = 1.0

    score = 0.35 * balance_score + 0.2 * document_score + 0.15 * leadership_score + 0.3 * permit_score
    return score, reasons, months_since_balance is not None or documents > 0


def _score_membership(row: dict[str, Any]) -> tuple[float, list[str], bool]:
    """Is the register stable, growing, or emptying?"""
    reasons: list[str] = []
    total = int(row.get("member_count") or 0)
    active = int(row.get("active_member_count") or 0)
    joined = int(row.get("members_joined_12m") or 0)
    exited = int(row.get("members_exited_12m") or 0)
    open_exits = int(row.get("open_exit_requests") or 0)

    if total == 0:
        reasons.append("The member register is empty.")
        return 0.0, reasons, False

    active_share = active / total
    if active_share < 0.8:
        reasons.append(
            f"{total - active} of {total} members are suspended or inactive."
        )

    # Net movement over the year, scaled by size so a 90-member cooperative losing
    # five is not treated like a 10-member one losing five.
    net = (joined - exited) / total
    churn_score = _clamp(0.5 + net * 2.0)
    if exited > 0:
        reasons.append(
            f"{exited} member(s) left in the last 12 months against {joined} who joined."
        )
    if open_exits > 0:
        reasons.append(
            f"{open_exits} member(s) currently have an open request to leave."
        )

    pressure = _clamp(1.0 - open_exits / max(total * 0.1, 1.0))
    return 0.4 * active_share + 0.4 * churn_score + 0.2 * pressure, reasons, True


def _score_engagement(row: dict[str, Any]) -> tuple[float, dict[str, Any], list[str], bool]:
    """Share of the membership still visibly taking part."""
    reasons: list[str] = []
    total = int(row.get("member_count") or 0)
    if total == 0:
        return 0.0, {}, ["No members on the register."], False

    contributors = int(row.get("contributors_last_quarter") or 0)
    attendees = int(row.get("attendees_last_quarter") or 0)
    slots = int(row.get("participation_slots_last_quarter") or 0)

    contribution_breadth = _clamp(contributors / total)
    attendance_breadth = _clamp(attendees / total)
    # Was there anything to attend? A cooperative that held nothing cannot be
    # blamed for nobody attending, but it can be blamed for holding nothing.
    activity_supply = _clamp(slots / max(total, 1))

    if contributors == 0:
        reasons.append("No member has paid a contribution in the last three months.")
    elif contribution_breadth < 0.3:
        reasons.append(
            f"Only {contributors} of {total} members contributed in the last quarter."
        )
    if attendees == 0 and slots > 0:
        reasons.append("Activities were held but no attendance was recorded.")
    elif attendance_breadth < 0.3 and slots > 0:
        reasons.append(f"Only {attendees} of {total} members attended anything last quarter.")
    if slots == 0:
        reasons.append("No members were invited to any activity in the last three months.")

    score = (
        contribution_breadth * ENGAGEMENT_WEIGHTS["contribution_breadth"]
        + attendance_breadth * ENGAGEMENT_WEIGHTS["attendance_breadth"]
        + activity_supply * ENGAGEMENT_WEIGHTS["activity_supply"]
    )

    detail = {
        "membersOnRegister": total,
        "contributorsLastQuarter": contributors,
        "attendeesLastQuarter": attendees,
        "participationSlotsLastQuarter": slots,
        "contributionBreadth": round(contribution_breadth * 100, 1),
        "attendanceBreadth": round(attendance_breadth * 100, 1),
    }
    measured = contributors > 0 or attendees > 0 or slots > 0
    return score, detail, reasons, measured


def _band(composite: float) -> str:
    if composite >= BAND_THRESHOLDS["healthy"]:
        return "healthy"
    if composite >= BAND_THRESHOLDS["monitor"]:
        return "monitor"
    if composite >= BAND_THRESHOLDS["at_risk"]:
        return "at_risk"
    return "critical"


def _recommended_actions(row: dict[str, Any], band: str, reasons: list[str]) -> list[str]:
    """What the officer should actually do about it, not just how bad it is."""
    actions: list[str] = []
    joined_reasons = " ".join(reasons).lower()

    if "dormant" in joined_reasons:
        actions.append(
            "Visit and establish whether the cooperative still operates at all. If it does not, "
            "advise the president on the dissolution process before members lose their savings."
        )
    elif "no transaction" in joined_reasons or "no income" in joined_reasons:
        actions.append(
            "Ask the treasurer whether trade has genuinely stopped or the books simply are not "
            "being entered on the system."
        )
    if "no meeting" in joined_reasons or "only one meeting" in joined_reasons:
        actions.append(
            "Require a general assembly to be convened and minuted before the next audit."
        )
    if "balance sheet" in joined_reasons:
        actions.append("Help the secretary file a current balance sheet.")
    if "permit" in joined_reasons:
        actions.append("Check the operating permit and open the maturity audit if one is due.")
    if "left in the last 12 months" in joined_reasons or "open request to leave" in joined_reasons:
        actions.append(
            "Sit with the members who are leaving and find out what is driving them out."
        )
    if "contribution" in joined_reasons or "attended" in joined_reasons:
        actions.append(
            "Review whether the cooperative is still offering members anything worth turning up for."
        )
    if band in {"at_risk", "critical"} and int(row.get("open_funding_requests") or 0) == 0:
        actions.append(
            "Check whether an NGO or development partner working in this sector could support it — "
            "run the funding match for this cooperative."
        )
    if not actions:
        actions.append("No action needed. Keep it on the routine monitoring cycle.")
    return actions


def audit(period: str | None = None) -> dict[str, Any]:
    """
    Score every cooperative in the district for one month.

    Returns the full standings plus the derived visit list, ranked by priority.
    """
    period_start, period_end = _period_bounds(period)
    rows = features.get_functionality_features(period_end)

    if not rows:
        return {
            "period": period_start.strftime("%Y-%m"),
            "results": [],
            "visitList": [],
            "model_name": MODEL_NAME,
            "model_version": MODEL_VERSION,
            "note": "No cooperatives are on the register.",
        }

    results: list[dict[str, Any]] = []

    for row in rows:
        trading, trading_reasons, trading_measured = _score_trading(row, period_end)
        meeting, meeting_reasons, meeting_measured = _score_meeting(row, period_end)
        records, record_reasons, records_measured = _score_records(row, period_end)
        membership, membership_reasons, membership_measured = _score_membership(row)
        engagement, engagement_detail, engagement_reasons, engagement_measured = _score_engagement(row)

        functionality = (
            trading * FUNCTIONALITY_WEIGHTS["trading"]
            + meeting * FUNCTIONALITY_WEIGHTS["meeting"]
            + records * FUNCTIONALITY_WEIGHTS["record_keeping"]
            + membership * FUNCTIONALITY_WEIGHTS["membership"]
        )
        composite = (
            functionality * COMPOSITE_WEIGHTS["functionality"]
            + engagement * COMPOSITE_WEIGHTS["engagement"]
        )

        functionality_pct = round(functionality * 100, 1)
        engagement_pct = round(engagement * 100, 1)
        composite_pct = round(composite * 100, 1)
        band = _band(composite_pct)

        reasons = (
            trading_reasons + meeting_reasons + record_reasons
            + membership_reasons + engagement_reasons
        )

        # How much of this band rests on records versus on their absence. A
        # cooperative flagged purely because nothing was ever entered is a very
        # different case from one whose records show it winding down.
        measured = [
            trading_measured, meeting_measured, records_measured,
            membership_measured, engagement_measured,
        ]
        evidence_quality = round(sum(measured) / len(measured), 2)
        unmeasured = [
            name
            for name, ok in zip(
                ["trading", "meeting", "record_keeping", "membership", "engagement"], measured
            )
            if not ok
        ]

        months_quiet = _months_between(row.get("last_transaction_on"), period_end)
        dormant = months_quiet is None or months_quiet >= DORMANCY_MONTHS

        # A cooperative someone is already out visiting is not re-flagged; the
        # officer has it in hand and a second entry only clutters the list.
        already_supported = int(row.get("open_visits") or 0) > 0

        visit_recommended = (
            band in {"at_risk", "critical"} or dormant
        ) and not already_supported

        if band == "critical" or dormant:
            priority = 1
        elif band == "at_risk":
            priority = 2
        else:
            priority = 3

        results.append(
            {
                "cooperativeId": str(row["id"]),
                "cooperativeName": row["name"],
                "type": row["type"],
                "sector": row["sector"],
                "memberCount": int(row.get("member_count") or 0),
                "functionalityScore": functionality_pct,
                "engagementScore": engagement_pct,
                "compositeScore": composite_pct,
                "band": band,
                "dormant": dormant,
                "monthsSinceLastTransaction": (
                    round(months_quiet, 1) if months_quiet is not None else None
                ),
                "components": {
                    "trading": round(trading * 100, 1),
                    "meeting": round(meeting * 100, 1),
                    "recordKeeping": round(records * 100, 1),
                    "membership": round(membership * 100, 1),
                },
                "engagementDetail": engagement_detail,
                "reasons": reasons,
                "recommendedActions": _recommended_actions(row, band, reasons),
                "evidenceQuality": evidence_quality,
                "unmeasured": unmeasured,
                "flaggedOnSilenceAlone": evidence_quality <= 0.4,
                "visitRecommended": visit_recommended,
                "visitPriority": priority,
                "alreadySupported": already_supported,
                "openFundingRequests": int(row.get("open_funding_requests") or 0),
                "permitType": row.get("permit_type"),
                "permitExpiresOn": (
                    features.isoformat(row["permit_expires_on"])
                    if row.get("permit_expires_on")
                    else None
                ),
            }
        )

    results.sort(key=lambda r: r["compositeScore"])

    visit_list = [r for r in results if r["visitRecommended"]]
    visit_list.sort(key=lambda r: (r["visitPriority"], r["compositeScore"]))

    flagged_on_silence = sum(1 for r in visit_list if r["flaggedOnSilenceAlone"])
    note = (
        f"{len(visit_list)} of {len(results)} cooperatives are recommended for a field visit "
        f"in {period_start.strftime('%B %Y')}."
    )
    if flagged_on_silence:
        note += (
            f" {flagged_on_silence} of them were flagged mainly because nothing has been "
            "recorded, which may mean the cooperative is not using the system rather than "
            "that it has stopped working — verify on the visit before drawing a conclusion."
        )

    # An audit of a month still running under-reports everybody, because most
    # cooperatives trade later in the month. Say so rather than let an officer
    # act on it.
    today = date.today()
    incomplete = period_start >= _month_start(today)
    if incomplete:
        note += (
            f" WARNING: {period_start.strftime('%B %Y')} is not over. Scores are computed on a "
            "part-month and will understate every cooperative that trades later in the month. "
            "Audit the last completed month instead."
        )

    return {
        "period": period_start.strftime("%Y-%m"),
        "periodEnd": period_end.isoformat(),
        "periodComplete": not incomplete,
        "results": results,
        "visitList": visit_list,
        "summary": {
            "total": len(results),
            "healthy": sum(1 for r in results if r["band"] == "healthy"),
            "monitor": sum(1 for r in results if r["band"] == "monitor"),
            "atRisk": sum(1 for r in results if r["band"] == "at_risk"),
            "critical": sum(1 for r in results if r["band"] == "critical"),
            "dormant": sum(1 for r in results if r["dormant"]),
            "visitsRecommended": len(visit_list),
        },
        "weights": {
            "functionality": FUNCTIONALITY_WEIGHTS,
            "engagement": ENGAGEMENT_WEIGHTS,
            "composite": COMPOSITE_WEIGHTS,
        },
        "thresholds": BAND_THRESHOLDS,
        "model_name": MODEL_NAME,
        "model_version": MODEL_VERSION,
        "note": note,
    }


def audit_one(cooperative_id: str, period: str | None = None) -> dict[str, Any]:
    """One cooperative's row from the district audit, with the district context."""
    full = audit(period)
    match = next((r for r in full["results"] if r["cooperativeId"] == cooperative_id), None)
    return {
        "period": full["period"],
        "result": match,
        "summary": full.get("summary"),
        "weights": full.get("weights"),
        "thresholds": full.get("thresholds"),
        "model_name": MODEL_NAME,
        "note": None if match else "That cooperative is not on the active register.",
    }


def fit(_parameters: dict[str, Any] | None = None) -> dict[str, Any]:
    """
    There is nothing to estimate — the index is defined, not learned. What is
    recorded instead is how much of the district the audit can actually see:
    the mean evidence quality, and the share of cooperatives whose band rests on
    real records rather than on their absence. That number, not an accuracy, is
    what tells you whether to trust this month's visit list.
    """
    run = audit(None)
    results = run["results"]

    if not results:
        return {
            "name": MODEL_NAME,
            "method": "transparent weighted index over operating and participation signals",
            "params": {
                "functionality_weights": FUNCTIONALITY_WEIGHTS,
                "engagement_weights": ENGAGEMENT_WEIGHTS,
                "composite_weights": COMPOSITE_WEIGHTS,
                "band_thresholds": BAND_THRESHOLDS,
            },
            "metrics": {"headline": "evidence_quality", "evidence_quality": 0.0},
            "observations": 0,
            "status": "insufficient_data",
            "note": "No cooperatives on the register, so nothing could be audited.",
        }

    evidence = sum(r["evidenceQuality"] for r in results) / len(results)
    on_silence = sum(1 for r in results if r["flaggedOnSilenceAlone"])

    # Separation: how well the index spreads the district. An index that puts
    # every cooperative in one band tells an officer nothing.
    bands = {r["band"] for r in results}
    separation = len(bands) / 4.0

    return {
        "name": MODEL_NAME,
        "method": "transparent weighted index over operating and participation signals",
        "params": {
            "functionality_weights": FUNCTIONALITY_WEIGHTS,
            "engagement_weights": ENGAGEMENT_WEIGHTS,
            "composite_weights": COMPOSITE_WEIGHTS,
            "band_thresholds": BAND_THRESHOLDS,
            "dormancy_months": DORMANCY_MONTHS,
        },
        "metrics": {
            "headline": "evidence_quality",
            "evidence_quality": round(evidence, 4),
            "band_separation": round(separation, 4),
            "cooperatives_flagged_on_silence": on_silence,
            "visits_recommended": run["summary"]["visitsRecommended"],
        },
        "observations": len(results),
        "status": "fitted" if evidence > 0 else "insufficient_data",
        "note": (
            "The monthly audit is a defined index, not a learned model, so evidence quality "
            "(how much of each band rests on real records rather than on their absence) is "
            "reported instead of accuracy."
        ),
    }
