"""District league table endpoints."""

from fastapi import APIRouter, Query

from ..analytics import rankings as engine

router = APIRouter()


@router.get("/rankings")
def rankings(period: str | None = Query(default=None, description="YYYY-MM; defaults to the latest month with data")):
    """
    Monthly standings for every active cooperative, with the dimension scores and
    the raw figures behind each one, so an officer can defend the ranking.
    """
    return engine.league_table(period)


@router.get("/rankings/trend")
def rankings_trend(months: int = Query(default=6, ge=2, le=24)):
    """Rank position per cooperative over recent months."""
    return engine.trend(months)
