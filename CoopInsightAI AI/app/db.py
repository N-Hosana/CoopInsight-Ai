"""
Database access.

The service is a read-mostly consumer of the backend's PostgreSQL database. It
owns no tables: everything it needs is derived from the rows the Node backend
writes. Keeping it read-only means the AI service can never corrupt operational
data, and it can be pointed at a replica later without any code change.
"""

from __future__ import annotations

import logging
from contextlib import contextmanager
from typing import Any, Iterator, Sequence

from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from .config import get_settings

logger = logging.getLogger(__name__)

_pool: ConnectionPool | None = None


def init_pool() -> ConnectionPool:
    """Open the connection pool. Called once on application startup."""
    global _pool
    if _pool is None:
        settings = get_settings()
        _pool = ConnectionPool(
            conninfo=settings.database_url,
            min_size=1,
            max_size=8,
            # Do not block startup when Postgres is down — the health endpoint
            # should be able to report the outage rather than the process dying.
            open=False,
            kwargs={"row_factory": dict_row},
        )
        _pool.open()
        logger.info("database pool opened")
    return _pool


def close_pool() -> None:
    global _pool
    if _pool is not None:
        _pool.close()
        _pool = None
        logger.info("database pool closed")


@contextmanager
def connection() -> Iterator[Any]:
    pool = init_pool()
    with pool.connection() as conn:
        yield conn


def fetch_all(sql: str, params: Sequence[Any] | None = None) -> list[dict[str, Any]]:
    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params or ())
            return cur.fetchall()


def fetch_one(sql: str, params: Sequence[Any] | None = None) -> dict[str, Any] | None:
    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params or ())
            return cur.fetchone()


def ping() -> bool:
    """True when the database answers. Used by /health."""
    try:
        with connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1 AS ok")
                return cur.fetchone() is not None
    except Exception as exc:  # noqa: BLE001 - health check must never raise
        logger.warning("database ping failed: %s", exc)
        return False
