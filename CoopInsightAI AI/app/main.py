"""
CoopInsight AI Service.

A FastAPI application that the Node backend proxies to. Every route here matches
a call in `CoopInsightAI Backend/src/routes/ai.ts`; the backend degrades
gracefully when this service is down, so the contract must be kept exactly.

Run:  uvicorn app.main:app --reload --port 8000
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import db, registry
from .config import get_settings
from .routers import (
    admin,
    anomalies,
    benchmarks,
    engagement,
    forecasts,
    health,
    monthly_audit,
    rankings,
)

settings = get_settings()

logging.basicConfig(
    level=getattr(logging, settings.log_level.upper(), logging.INFO),
    format="%(asctime)s %(levelname)-8s %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # The pool is opened lazily rather than eagerly: if Postgres is unavailable
    # the service should still start and report the problem through /health,
    # because the Node backend treats a hard connection failure and a degraded
    # service very differently.
    logger.info("%s v%s starting", settings.service_name, settings.version)
    if db.ping():
        logger.info("database reachable")
    else:
        logger.warning("database unreachable at startup — /health will report degraded")
    logger.info("%d model(s) fitted in the registry", registry.count_fitted())
    yield
    db.close_pool()
    logger.info("shutdown complete")


app = FastAPI(
    title=settings.service_name,
    version=settings.version,
    description=(
        "Analytics and prediction service for CoopInsight AI. Consumed by the Node "
        "backend at /api/ai/*. Reads the backend's PostgreSQL database directly."
    ),
    lifespan=lifespan,
)

# The Node backend is the only intended caller, but allowing the Vite dev server
# makes the interactive docs usable from a browser during development.
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1):\d+$",
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router, tags=["health"])
app.include_router(anomalies.router, tags=["anomalies"])
app.include_router(forecasts.router, tags=["forecasts"])
app.include_router(engagement.router, tags=["engagement"])
app.include_router(benchmarks.router, tags=["benchmarks"])
app.include_router(rankings.router, tags=["rankings"])
app.include_router(monthly_audit.router, tags=["monthly audit"])
app.include_router(admin.router, tags=["models"])
