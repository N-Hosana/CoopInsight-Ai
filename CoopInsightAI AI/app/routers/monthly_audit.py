"""
Monthly functionality audit endpoints.

The Node backend calls these once a month (or on demand from the RCA screen),
persists the results, and turns the visit list into assignable field visits. The
AI service itself writes nothing — it reads the operational tables and returns
the assessment, exactly as every other capability here does.
"""

from fastapi import APIRouter, Query

from ..analytics import monthly_audit as engine

router = APIRouter()


@router.get("/monthly-audit")
def monthly_audit(
    period: str | None = Query(
        default=None, description="YYYY-MM; defaults to the latest month with data"
    )
):
    """
    Score every cooperative in the district on whether it is still functioning and
    whether its members are still engaged, and return the ranked visit list.
    """
    return engine.audit(period)


@router.get("/monthly-audit/{cooperative_id}")
def monthly_audit_one(
    cooperative_id: str,
    period: str | None = Query(default=None, description="YYYY-MM; defaults to the latest month"),
):
    """One cooperative's audit row, with the district summary for context."""
    return engine.audit_one(cooperative_id, period)
