"""Peer benchmarking endpoint."""

from fastapi import APIRouter, Query

from ..analytics import benchmarks as engine
from ..schemas import BenchmarkResponse

router = APIRouter()


@router.get("/benchmarks", response_model=BenchmarkResponse)
def benchmarks(cooperativeId: str = Query(...)) -> BenchmarkResponse:
    return BenchmarkResponse(**engine.compare(cooperativeId))
