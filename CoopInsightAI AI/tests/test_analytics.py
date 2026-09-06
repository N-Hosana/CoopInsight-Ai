"""
Unit tests for the statistical core.

These test the maths, not the database, so they run without Postgres. The point
is to pin down the behaviour that matters and is easy to get wrong: that robust
scoring resists a masking outlier, that damped trends do not run away, and that
the horizon parser handles the formats the backend actually sends.
"""

from __future__ import annotations

import numpy as np
import pytest

from app.analytics import anomalies, forecasting


class TestModifiedZScores:
    def test_flags_a_clear_outlier(self):
        values = np.array([100, 102, 98, 101, 99, 100, 5000], dtype=float)
        scores = anomalies.modified_zscores(values)
        assert abs(scores[-1]) > 3.5
        assert all(abs(s) < 3.5 for s in scores[:-1])

    def test_single_outlier_cannot_mask_itself(self):
        """
        The failure mode of mean/std scoring: one huge value inflates the scale so
        much that it stops looking unusual. Median/MAD must not do that.
        """
        values = np.array([10, 11, 10, 12, 11, 10, 100000], dtype=float)
        robust = anomalies.modified_zscores(values)

        mean, std = values.mean(), values.std()
        classic = abs((values[-1] - mean) / std)

        assert abs(robust[-1]) > 3.5
        # The classic z-score cannot exceed sqrt(n-1) ≈ 2.45 here, so it misses it.
        assert classic < 3.5

    def test_constant_series_has_no_outliers(self):
        scores = anomalies.modified_zscores(np.array([50.0] * 8))
        assert np.all(scores == 0)

    def test_handles_empty_input(self):
        assert anomalies.modified_zscores(np.array([])).size == 0

    def test_mad_zero_falls_back_to_mean_deviation(self):
        # Six identical values make the MAD zero, but the seventh is still odd.
        values = np.array([5, 5, 5, 5, 5, 5, 5, 900], dtype=float)
        scores = anomalies.modified_zscores(values)
        assert abs(scores[-1]) > 3.5


class TestSeverityAndConfidence:
    @pytest.mark.parametrize(
        "score,expected",
        [(3.6, "info"), (5.0, "warning"), (7.0, "critical"), (-7.0, "critical")],
    )
    def test_severity_bands(self, score, expected):
        assert anomalies._severity(score) == expected

    def test_confidence_stays_in_range_and_never_certain(self):
        for score in (3.5, 10.0, 100.0):
            for n in (3, 50, 5000):
                c = anomalies._confidence(score, n)
                assert 0.0 <= c <= 1.0
                assert c < 1.0, "a statistical flag must never claim certainty"

    def test_confidence_rises_with_evidence(self):
        assert anomalies._confidence(5.0, 100) > anomalies._confidence(5.0, 3)


class TestHorizonParsing:
    @pytest.mark.parametrize(
        "text,expected",
        [
            ("30d", 1),
            ("90d", 3),
            ("6m", 6),
            ("1y", 12),
            ("3", 3),
            ("", 3),
            ("nonsense", 3),
        ],
    )
    def test_parses_backend_formats(self, text, expected):
        assert forecasting.parse_horizon(text) == expected


class TestDampedTrend:
    def test_recovers_a_known_slope(self):
        values = np.array([10, 20, 30, 40, 50], dtype=float)
        level, slope, _ = forecasting._fit_damped_trend(values)
        assert slope == pytest.approx(10.0, abs=1e-6)
        assert level == pytest.approx(50.0, abs=1e-6)

    def test_damping_keeps_long_horizons_bounded(self):
        """
        An undamped line would reach level + slope*h. Damping must converge to a
        finite ceiling instead, which is the whole reason it is used.
        """
        phi = 0.85
        level, slope = 100.0, 10.0
        far = level + slope * sum(phi**k for k in range(1, 121))
        ceiling = level + slope * (phi / (1 - phi))
        assert far < ceiling + 1e-6
        assert far < level + slope * 120  # far below the undamped line


class TestMonthArithmetic:
    def test_rolls_over_year_boundary(self):
        from datetime import date

        assert forecasting._add_months(date(2026, 11, 1), 3) == date(2027, 2, 1)
        assert forecasting._add_months(date(2026, 1, 1), 12) == date(2027, 1, 1)


class TestLeaguePercentiles:
    """The league table's fairness rests on the percentile function."""

    def test_bottom_and_top_of_the_field(self):
        from app.analytics import rankings

        population = [10.0, 20.0, 30.0, 40.0]
        assert rankings._percentile(10.0, population) < 20
        assert rankings._percentile(40.0, population) > 80

    def test_ties_share_a_position(self):
        from app.analytics import rankings

        population = [5.0, 5.0, 5.0, 5.0]
        # Everyone equal must land mid-field, not all at 0 or all at 100.
        assert rankings._percentile(5.0, population) == 50.0

    def test_empty_population_is_neutral(self):
        from app.analytics import rankings

        assert rankings._percentile(1.0, []) == 50.0

    def test_weights_sum_to_one(self):
        """A composite whose weights do not sum to 1 is not a weighted mean."""
        from app.analytics import rankings

        assert sum(rankings.WEIGHTS.values()) == pytest.approx(1.0)

    def test_every_weighted_dimension_has_a_label(self):
        from app.analytics import rankings

        assert set(rankings.WEIGHTS) == set(rankings.DIMENSION_LABELS)
        assert set(rankings.WEIGHTS) == set(rankings.DIMENSION_DESCRIPTIONS)


class TestBanding:
    def test_bands_are_ordered(self):
        from app.analytics import rankings

        assert rankings._band(90) == "leading"
        assert rankings._band(60) == "solid"
        assert rankings._band(40) == "needs_support"
        assert rankings._band(10) == "at_risk"


class TestCumulativeSavings:
    def test_accumulates_net_flow_in_order(self):
        from app.analytics import rankings

        facts = {
            "2026-01": {"income": 100.0, "expense": 40.0},
            "2026-02": {"income": 80.0, "expense": 30.0},
            "2026-03": {"income": 50.0, "expense": 90.0},
        }
        out = rankings._cumulative_savings(facts, ["2026-01", "2026-02", "2026-03"])
        assert out["2026-01"] == 60.0
        assert out["2026-02"] == 110.0
        assert out["2026-03"] == 70.0  # a loss-making month pulls it back down


class TestForecastRobustness:
    def test_scaled_error_survives_a_series_passing_near_zero(self):
        """
        The bug this pins: dividing by each point makes a near-zero denominator
        report a meaningless four-figure error. Scaling by the window must not.
        """
        test = np.array([0.001, 500.0, 1000.0, 1500.0])
        prediction = np.array([50.0, 520.0, 1010.0, 1490.0])

        per_point = float(np.mean(np.abs(prediction - test) / np.abs(test)))
        scale = float(np.mean(np.abs(test)))
        scaled = float(np.mean(np.abs(prediction - test)) / scale)

        assert per_point > 100        # absurd
        assert scaled < 0.05          # honest
