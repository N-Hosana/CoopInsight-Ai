"""
Unit tests for the monthly functionality audit.

These test the scoring rules, not the database, so they run without Postgres.
The behaviour worth pinning down is the part an officer would challenge: that a
cooperative which has genuinely gone quiet is caught, that one which is trading
normally is not dragged onto the visit list, and — most importantly — that a
cooperative flagged only because nothing was ever entered is labelled as such
rather than being reported as failing.
"""

from __future__ import annotations

from datetime import date

import pytest

from app.analytics import monthly_audit as audit


PERIOD_END = date(2026, 6, 30)


def coop(**overrides):
    """A cooperative that is operating normally, before overrides."""
    base = {
        "id": "11111111-1111-1111-1111-111111111111",
        "name": "Test Cooperative",
        "type": "Agriculture",
        "sector": "Nduba",
        "status": "active",
        "health_score": 70,
        "registration_date": date(2019, 1, 1),
        "total_savings": 5_000_000,
        "member_count": 40,
        "active_member_count": 40,
        "last_transaction_on": date(2026, 6, 20),
        "transactions_in_month": 8,
        "income_in_month": 900_000,
        "expense_in_month": 400_000,
        "trading_months_of_6": 6,
        "last_activity_on": date(2026, 6, 10),
        "activities_in_month": 2,
        "activities_completed": 2,
        "meetings_last_6_months": 3,
        "contributors_last_quarter": 34,
        "attendees_last_quarter": 30,
        "participation_slots_last_quarter": 60,
        "members_joined_12m": 5,
        "members_exited_12m": 1,
        "open_exit_requests": 0,
        "last_balance_sheet_on": date(2026, 3, 31),
        "document_count": 4,
        "leaders_recorded": 3,
        "permit_type": "permanent",
        "permit_expires_on": date(2050, 1, 1),
        "open_visits": 0,
        "open_funding_requests": 0,
    }
    base.update(overrides)
    return base


class TestTradingScore:
    def test_recent_and_consistent_trading_scores_high(self):
        score, reasons, measured = audit._score_trading(coop(), PERIOD_END)
        assert score > 0.9
        assert measured is True
        assert reasons == []

    def test_six_months_of_silence_is_called_dormant(self):
        score, reasons, measured = audit._score_trading(
            coop(last_transaction_on=date(2025, 11, 1), trading_months_of_6=0), PERIOD_END
        )
        assert score == pytest.approx(0.0, abs=0.05)
        assert any("dormant" in r for r in reasons)
        assert measured is True

    def test_never_traded_is_unmeasured_not_merely_bad(self):
        """
        A cooperative with no transaction at all scores zero, but the component is
        reported as unmeasured so the band can be labelled as resting on silence.
        """
        score, reasons, measured = audit._score_trading(
            coop(last_transaction_on=None, trading_months_of_6=0), PERIOD_END
        )
        assert score == 0.0
        assert measured is False

    def test_a_busy_month_does_not_hide_a_stop(self):
        """Trading in one of six months must not score like trading in six."""
        busy_once = audit._score_trading(coop(trading_months_of_6=1), PERIOD_END)[0]
        every_month = audit._score_trading(coop(trading_months_of_6=6), PERIOD_END)[0]
        assert busy_once < every_month - 0.3


class TestEngagementScore:
    def test_broad_participation_scores_high(self):
        score, detail, reasons, measured = audit._score_engagement(coop())
        assert score > 0.75
        assert detail["contributionBreadth"] == 85.0
        assert measured is True

    def test_committee_of_three_is_caught(self):
        score, _detail, reasons, _measured = audit._score_engagement(
            coop(contributors_last_quarter=3, attendees_last_quarter=3,
                 participation_slots_last_quarter=6)
        )
        assert score < 0.2
        assert any("Only 3 of 40" in r for r in reasons)

    def test_empty_register_is_unmeasured(self):
        score, _detail, _reasons, measured = audit._score_engagement(coop(member_count=0))
        assert score == 0.0
        assert measured is False


class TestMembershipScore:
    def test_members_leaving_pulls_the_score_down(self):
        stable = audit._score_membership(coop())[0]
        emptying = audit._score_membership(
            coop(members_joined_12m=0, members_exited_12m=12, open_exit_requests=4)
        )[0]
        assert emptying < stable - 0.2

    def test_open_exit_requests_are_surfaced_as_a_reason(self):
        _score, reasons, _measured = audit._score_membership(coop(open_exit_requests=3))
        assert any("open request to leave" in r for r in reasons)


class TestRecordsScore:
    def test_expired_permit_is_flagged(self):
        _score, reasons, _measured = audit._score_records(
            coop(permit_type="temporary", permit_expires_on=date(2026, 1, 1)), PERIOD_END
        )
        assert any("expired" in r for r in reasons)

    def test_permit_expiring_soon_is_flagged_before_it_lapses(self):
        _score, reasons, _measured = audit._score_records(
            coop(permit_type="temporary", permit_expires_on=date(2026, 7, 20)), PERIOD_END
        )
        assert any("expires in" in r for r in reasons)


class TestBanding:
    @pytest.mark.parametrize(
        "composite,expected",
        [(95.0, "healthy"), (70.0, "healthy"), (55.0, "monitor"),
         (35.0, "at_risk"), (10.0, "critical")],
    )
    def test_thresholds(self, composite, expected):
        assert audit._band(composite) == expected


class TestRecommendedActions:
    def test_a_dormant_cooperative_is_told_to_be_visited_before_dissolving(self):
        actions = audit._recommended_actions(
            coop(), "critical", ["Nothing has been recorded for 9 months — the cooperative looks dormant."]
        )
        assert any("dissolution" in a for a in actions)

    def test_a_struggling_cooperative_is_referred_to_funders(self):
        actions = audit._recommended_actions(coop(), "at_risk", ["No transaction in 4 months."])
        assert any("NGO or development partner" in a for a in actions)

    def test_a_healthy_cooperative_gets_no_busywork(self):
        actions = audit._recommended_actions(coop(), "healthy", [])
        assert actions == ["No action needed. Keep it on the routine monitoring cycle."]


class TestPeriodBounds:
    def test_explicit_period_resolves_to_that_calendar_month(self):
        start, end = audit._period_bounds("2026-02")
        assert start == date(2026, 2, 1)
        assert end == date(2026, 2, 28)

    def test_december_rolls_into_the_next_year(self):
        start, end = audit._period_bounds("2025-12")
        assert start == date(2025, 12, 1)
        assert end == date(2025, 12, 31)


class TestDefaultPeriod:
    def test_defaults_to_the_last_completed_month(self, monkeypatch):
        """
        Auditing the month in progress would report that every cooperative had
        stopped trading, because most of them trade later in the month.
        """
        monkeypatch.setattr(audit.features, "latest_period_with_data", lambda: date(2026, 9, 25))
        assert audit._default_period(today=date(2026, 9, 8)) == date(2026, 8, 1)

    def test_never_runs_ahead_of_the_data(self, monkeypatch):
        monkeypatch.setattr(audit.features, "latest_period_with_data", lambda: date(2026, 3, 14))
        assert audit._default_period(today=date(2026, 9, 8)) == date(2026, 3, 1)

    def test_january_falls_back_into_the_previous_year(self, monkeypatch):
        monkeypatch.setattr(audit.features, "latest_period_with_data", lambda: date(2027, 1, 5))
        assert audit._default_period(today=date(2027, 1, 20)) == date(2026, 12, 1)

    def test_no_data_at_all_still_yields_a_month(self, monkeypatch):
        monkeypatch.setattr(audit.features, "latest_period_with_data", lambda: None)
        assert audit._default_period(today=date(2026, 9, 8)) == date(2026, 8, 1)
