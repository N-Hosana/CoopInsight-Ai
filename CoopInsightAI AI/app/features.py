"""
Feature extraction.

Everything the analytics operate on is derived here, in one place, so the SQL
that defines a feature lives next to the other features rather than being spread
through the endpoints. Each function returns plain dicts/lists — no numpy — so
the queries stay readable and testable on their own.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any

from . import db


def _f(value: Any) -> float:
    """Postgres NUMERIC arrives as Decimal; normalise to float."""
    return float(value) if value is not None else 0.0


# ─── Cooperative ─────────────────────────────────────────────────────────────

def get_cooperative(cooperative_id: str) -> dict[str, Any] | None:
    return db.fetch_one(
        """
        SELECT c.id, c.name, c.type, c.sector, c.status,
               c.total_savings, c.total_loans, c.health_score, c.registration_date,
               (SELECT COUNT(*) FROM members m
                 WHERE m.cooperative_id = c.id AND m.deleted_at IS NULL) AS member_count
          FROM cooperatives c
         WHERE c.id = %s AND c.deleted_at IS NULL
        """,
        (cooperative_id,),
    )


def list_cooperatives() -> list[dict[str, Any]]:
    """Every active cooperative, with the aggregates benchmarking compares on."""
    return db.fetch_all(
        """
        SELECT c.id, c.name, c.type, c.sector, c.health_score, c.total_savings,
               (SELECT COUNT(*) FROM members m
                 WHERE m.cooperative_id = c.id AND m.deleted_at IS NULL) AS member_count,
               (SELECT COALESCE(SUM(t.amount), 0) FROM transactions t
                 WHERE t.cooperative_id = c.id AND t.type = 'income'
                   AND t.status = 'completed') AS total_income,
               (SELECT COALESCE(SUM(t.amount), 0) FROM transactions t
                 WHERE t.cooperative_id = c.id AND t.type = 'expense'
                   AND t.status = 'completed') AS total_expense,
               (SELECT COUNT(*) FROM activities a
                 WHERE a.cooperative_id = c.id AND a.deleted_at IS NULL) AS activity_count,
               (SELECT COUNT(*) FROM activities a
                 WHERE a.cooperative_id = c.id AND a.deleted_at IS NULL
                   AND a.status = 'completed') AS completed_activities,
               (SELECT COALESCE(SUM(mc.amount), 0)
                  FROM member_contributions mc
                  JOIN members m ON m.id = mc.member_id
                 WHERE m.cooperative_id = c.id AND mc.type = 'share_capital') AS share_capital
          FROM cooperatives c
         WHERE c.deleted_at IS NULL AND c.status = 'active'
         ORDER BY c.name
        """
    )


# ─── Transactions ────────────────────────────────────────────────────────────

def get_transactions(cooperative_id: str) -> list[dict[str, Any]]:
    rows = db.fetch_all(
        """
        SELECT id, type, category, amount, date, description, payment_method
          FROM transactions
         WHERE cooperative_id = %s AND status = 'completed'
         ORDER BY date
        """,
        (cooperative_id,),
    )
    for r in rows:
        r["amount"] = _f(r["amount"])
    return rows


def get_monthly_series(cooperative_id: str, metric: str) -> list[tuple[date, float]]:
    """
    A monthly time series for forecasting.

    `savings` is cumulative member savings, so it is modelled as a running total
    of net cash flow — savings only ever move by what comes in and goes out.
    """
    metric = metric.lower()

    if metric in {"income", "revenue"}:
        sql = """
            SELECT DATE_TRUNC('month', date)::date AS period,
                   COALESCE(SUM(amount), 0) AS value
              FROM transactions
             WHERE cooperative_id = %s AND status = 'completed' AND type = 'income'
             GROUP BY 1 ORDER BY 1
        """
    elif metric in {"expense", "expenses", "cost"}:
        sql = """
            SELECT DATE_TRUNC('month', date)::date AS period,
                   COALESCE(SUM(amount), 0) AS value
              FROM transactions
             WHERE cooperative_id = %s AND status = 'completed' AND type = 'expense'
             GROUP BY 1 ORDER BY 1
        """
    elif metric in {"savings", "net", "net_flow", "cashflow"}:
        sql = """
            SELECT DATE_TRUNC('month', date)::date AS period,
                   COALESCE(SUM(CASE WHEN type = 'income' THEN amount
                                     ELSE -amount END), 0) AS value
              FROM transactions
             WHERE cooperative_id = %s AND status = 'completed'
             GROUP BY 1 ORDER BY 1
        """
    elif metric in {"members", "membership"}:
        sql = """
            SELECT DATE_TRUNC('month', membership_date)::date AS period,
                   COUNT(*) AS value
              FROM members
             WHERE cooperative_id = %s AND deleted_at IS NULL
             GROUP BY 1 ORDER BY 1
        """
    elif metric in {"contributions", "member_contributions"}:
        sql = """
            SELECT DATE_TRUNC('month', mc.date)::date AS period,
                   COALESCE(SUM(mc.amount), 0) AS value
              FROM member_contributions mc
              JOIN members m ON m.id = mc.member_id
             WHERE m.cooperative_id = %s
             GROUP BY 1 ORDER BY 1
        """
    else:
        return []

    rows = db.fetch_all(sql, (cooperative_id,))
    series = [(r["period"], _f(r["value"])) for r in rows]

    # Savings is a stock, not a flow — accumulate it.
    if metric in {"savings"}:
        running = 0.0
        accumulated = []
        for period, value in series:
            running += value
            accumulated.append((period, running))
        return accumulated

    if metric in {"members", "membership"}:
        running = 0.0
        accumulated = []
        for period, value in series:
            running += value
            accumulated.append((period, running))
        return accumulated

    return series


# ─── Members ─────────────────────────────────────────────────────────────────

def get_member_engagement_features(cooperative_id: str) -> list[dict[str, Any]]:
    """
    Per-member raw counts behind the engagement score.

    Deliberately raw: the scoring decides how to weight and normalise, so the
    weighting can change without touching SQL.
    """
    rows = db.fetch_all(
        """
        SELECT m.id,
               m.full_name,
               m.role,
               m.status,
               m.membership_date,
               m.total_savings,
               (SELECT COUNT(*) FROM activity_participants ap
                 WHERE ap.member_id = m.id) AS activities_invited,
               (SELECT COUNT(*) FROM activity_participants ap
                 WHERE ap.member_id = m.id AND ap.attended) AS activities_attended,
               (SELECT COUNT(*) FROM activity_participants ap
                  JOIN activities a ON a.id = ap.activity_id
                 WHERE ap.member_id = m.id AND ap.attended
                   AND a.type = 'training') AS trainings_attended,
               (SELECT COUNT(*) FROM member_contributions mc
                 WHERE mc.member_id = m.id) AS contribution_count,
               (SELECT COALESCE(SUM(mc.amount), 0) FROM member_contributions mc
                 WHERE mc.member_id = m.id) AS contribution_total,
               (SELECT MAX(mc.date) FROM member_contributions mc
                 WHERE mc.member_id = m.id) AS last_contribution
          FROM members m
         WHERE m.cooperative_id = %s AND m.deleted_at IS NULL
         ORDER BY m.membership_number
        """,
        (cooperative_id,),
    )
    for r in rows:
        r["total_savings"] = _f(r["total_savings"])
        r["contribution_total"] = _f(r["contribution_total"])
    return rows


def count_cooperative_trainings(cooperative_id: str) -> int:
    row = db.fetch_one(
        """
        SELECT COUNT(*) AS n FROM activities
         WHERE cooperative_id = %s AND deleted_at IS NULL
           AND type = 'training' AND status = 'completed'
        """,
        (cooperative_id,),
    )
    return int(row["n"]) if row else 0


def count_cooperative_activities(cooperative_id: str) -> int:
    row = db.fetch_one(
        """
        SELECT COUNT(*) AS n FROM activities
         WHERE cooperative_id = %s AND deleted_at IS NULL AND status = 'completed'
        """,
        (cooperative_id,),
    )
    return int(row["n"]) if row else 0


# ─── Training corpus ─────────────────────────────────────────────────────────

def get_all_transaction_amounts() -> list[dict[str, Any]]:
    """
    Every completed transaction across every cooperative, used to fit the
    district-wide anomaly baseline. A single cooperative rarely has enough rows
    to characterise its own spread, so the population baseline is what makes
    detection possible at this data volume.
    """
    rows = db.fetch_all(
        """
        SELECT t.cooperative_id, t.type, t.category, t.amount, t.date
          FROM transactions t
          JOIN cooperatives c ON c.id = t.cooperative_id
         WHERE t.status = 'completed' AND c.deleted_at IS NULL
         ORDER BY t.date
        """
    )
    for r in rows:
        r["amount"] = _f(r["amount"])
    return rows


def get_latest_balance_sheet(cooperative_id: str) -> dict[str, Any] | None:
    row = db.fetch_one(
        """
        SELECT cash, bank_balance, inventory, fixed_assets, loans_outstanding,
               member_savings, external_loans, accounts_payable,
               share_capital, retained_earnings, period_end
          FROM balance_sheets
         WHERE cooperative_id = %s
         ORDER BY period_end DESC LIMIT 1
        """,
        (cooperative_id,),
    )
    if row:
        for key, value in row.items():
            if isinstance(value, (int, float)) or hasattr(value, "quantize"):
                row[key] = _f(value)
    return row


def data_volume_summary() -> dict[str, int]:
    """Row counts used to decide whether a model can honestly be fitted."""
    row = db.fetch_one(
        """
        SELECT
          (SELECT COUNT(*) FROM cooperatives WHERE deleted_at IS NULL) AS cooperatives,
          (SELECT COUNT(*) FROM members WHERE deleted_at IS NULL)      AS members,
          (SELECT COUNT(*) FROM transactions WHERE status='completed') AS transactions,
          (SELECT COUNT(*) FROM activities WHERE deleted_at IS NULL)   AS activities,
          (SELECT COUNT(*) FROM member_contributions)                  AS contributions,
          (SELECT COUNT(*) FROM activity_participants)                 AS participations
        """
    )
    return {k: int(v) for k, v in (row or {}).items()}


def isoformat(value: Any) -> str:
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    return str(value)
