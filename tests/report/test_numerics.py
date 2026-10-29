"""The report's numerical functions on hand-checkable fixtures: the paired and single bootstraps,
Holm's correction, the regressions, the read-time measures and the one trade pairing algorithm."""

from __future__ import annotations

from decimal import Decimal
from datetime import date, timedelta
import math
import unittest

import numpy as np

from ledger.errors import Refusal
from report import attribution, comparison, measures


DESIGN = {"method": "paired-circular-log-mean-v1", "block_days": 2, "resamples": 999, "inner_resamples": 99,
          "seed": 11, "alpha": 0.05, "minimum_effect": 0.0, "design_reason": "fixture"}
DAY = 86_400 * 10**9
JAN = 1_767_225_600 * 10**9  # 2026-01-01T00:00:00Z
MINUTE = 60 * 10**9


def refused(function, *args, **kwargs) -> str:
    try:
        function(*args, **kwargs)
    except Refusal as exc:
        return exc.code
    raise AssertionError("no refusal")


class PairedTests(unittest.TestCase):
    def test_the_effect_and_annual_difference_are_the_registered_formulas(self):
        left = [0.01, -0.02, 0.005, 0.0, 0.015, -0.01]
        right = [0.012, -0.01, 0.0, 0.004, 0.02, -0.012]
        found = comparison.paired(left, right, DESIGN, 1)
        logs = [math.log1p(r) - math.log1p(l) for l, r in zip(left, right, strict=True)]
        self.assertAlmostEqual(found["mean_daily_log_difference"], sum(logs) / 6, places=15)
        annual = (math.exp(365 * sum(map(math.log1p, right)) / 6) - math.exp(365 * sum(map(math.log1p, left)) / 6))
        self.assertAlmostEqual(found["annual_return_difference"], annual, places=12)
        absolute = sorted(map(abs, logs), reverse=True)
        self.assertAlmostEqual(found["top_five_absolute_difference_share"], sum(absolute[:5]) / sum(absolute))
        swapped = comparison.paired(right, left, DESIGN, 1)
        self.assertAlmostEqual(swapped["mean_daily_log_difference"], -found["mean_daily_log_difference"], places=15)
        low, high = found["mean_log_basic_interval"]
        self.assertAlmostEqual(swapped["mean_log_basic_interval"][0], -high, places=12, msg="shared block starts")
        self.assertAlmostEqual(swapped["mean_log_basic_interval"][1], -low, places=12)

    def test_the_one_sided_p_counts_centered_resamples_with_plus_one_smoothing(self):
        # One-day blocks of a two-day series: every resampled mean is 0.01, 0.02 or 0.03.
        found = comparison.paired([0.0, 0.0], [math.expm1(0.01), math.expm1(0.03)], {**DESIGN, "block_days": 1}, 1)
        self.assertAlmostEqual(found["mean_daily_log_difference"], 0.02, places=12)
        self.assertEqual(found["p_one_sided"], 1 / 1000, "no centered mean reaches 0.02")
        found = comparison.paired([0.0, 0.0], [math.expm1(-0.01), math.expm1(0.03)], {**DESIGN, "block_days": 1}, 1)
        self.assertLess(abs(found["p_one_sided"] - 0.25), 0.05, "only the mean 0.03 centers at or above 0.01")

    def test_the_grid_corrects_p_and_the_interval_coverage(self):
        left, right = [0.01, -0.02, 0.005, 0.0, 0.015, -0.01], [0.0, 0.01, -0.01, 0.02, 0.0, 0.01]
        one, four = comparison.paired(left, right, DESIGN, 1), comparison.paired(left, right, DESIGN, 4)
        self.assertEqual(four["p_one_sided"], one["p_one_sided"])
        self.assertEqual(four["p_bonferroni"], min(1.0, 4 * one["p_one_sided"]))
        self.assertEqual((one["interval_coverage_grid_adjusted"], four["interval_coverage_grid_adjusted"]),
                         (0.95, 1 - 0.05 / 4))
        self.assertLessEqual(four["mean_log_basic_interval"][0], one["mean_log_basic_interval"][0])
        self.assertEqual([item["available"] for item in one["block_sensitivity"]], [True, True, False],
                         "six days hold fewer than two blocks of four")
        self.assertEqual([item["block_days"] for item in one["block_sensitivity"]], [1, 2, 4])
        self.assertEqual([item["block_days"] for item in comparison.paired(left, right, {**DESIGN, "block_days": 3}, 1)[
            "block_sensitivity"]], [1, 3, 6])

    def test_a_constant_difference_leaves_p_and_the_studentized_interval_empty(self):
        found = comparison.paired([0.0] * 6, [0.01] * 6, DESIGN, 1)
        self.assertIsNone(found["p_one_sided"])
        self.assertIsNone(found["p_bonferroni"])
        self.assertIsNone(found["mean_log_studentized_interval"])
        self.assertTrue(any(item.startswith("DEGENERATE_SE") for item in found["limitations"]))

    def test_a_weighted_contrast_tests_the_weighted_sum_of_log_series(self):
        series = [[0.01, 0.0, -0.01, 0.02], [0.0, 0.01, 0.0, 0.0], [0.02, -0.01, 0.0, 0.01], [0.0, 0.0, 0.01, -0.02]]
        found = comparison.paired(series[:2], series[2:], DESIGN, 1, weights=(1, -1, -1, 1))
        manual = [math.log1p(a) - math.log1p(b) - math.log1p(c) + math.log1p(d)
                  for a, b, c, d in zip(*series, strict=True)]
        self.assertAlmostEqual(found["mean_daily_log_difference"], sum(manual) / 4, places=15)
        self.assertIsNone(found["annual_return_difference"])

    def test_malformed_inputs_are_refused_before_any_number(self):
        self.assertEqual(refused(comparison.paired, [0.0] * 3, [0.0] * 3, DESIGN, 1), "COMPARISON_UNAVAILABLE")
        self.assertEqual(refused(comparison.paired, [0.0] * 4, [0.0] * 5, DESIGN, 1), "COMPARISON_UNAVAILABLE")
        self.assertEqual(refused(comparison.paired, [0.0, -1.0, 0.0, 0.0], [0.0] * 4, DESIGN, 1),
                         "COMPARISON_UNAVAILABLE")
        self.assertEqual(refused(comparison.paired, [0.0, float("nan"), 0.0, 0.0], [0.0] * 4, DESIGN, 1),
                         "COMPARISON_UNAVAILABLE")
        self.assertEqual(refused(comparison.paired, [0.0] * 4, [0.0] * 4, {**DESIGN, "resamples": 10}, 1),
                         "REGISTRATION_INVALID")
        self.assertEqual(refused(comparison.paired, [0.0] * 4, [0.0] * 4, DESIGN, 0), "REGISTRATION_INVALID")


class SingleAndHolmTests(unittest.TestCase):
    def test_the_single_series_gives_the_mean_sharpe_and_p_of_the_log_returns(self):
        returns = [0.01, -0.005, 0.02, 0.0, -0.01, 0.015]
        found = comparison.single(returns, DESIGN, 3)
        logs = [math.log1p(value) for value in returns]
        mean = sum(logs) / 6
        deviation = math.sqrt(sum((value - mean) ** 2 for value in logs) / 5)
        self.assertAlmostEqual(found["mean_daily_log"], mean, places=15)
        self.assertAlmostEqual(found["sharpe_annualised"], mean / deviation * math.sqrt(365), places=12)
        self.assertEqual(found["interval_coverage"], 1 - 0.05 / 3)
        self.assertTrue(0 < found["p_one_sided"] <= 1)
        flat = comparison.single([0.01] * 6, DESIGN, 1)
        self.assertEqual((flat["p_one_sided"], flat["sharpe_annualised"]), (None, None))
        self.assertEqual(refused(comparison.single, [0.01] * 3, DESIGN, 1), "COMPARISON_UNAVAILABLE")
        self.assertEqual(refused(comparison.single, [0.01] * 6, DESIGN, 0), "COMPARISON_UNAVAILABLE")

    def test_holm_steps_down_keeps_the_order_and_caps_at_one(self):
        self.assertEqual(comparison.holm([0.01, 0.04, 0.03]), [0.03, 0.06, 0.06])
        self.assertEqual(comparison.holm([0.6, 0.2]), [0.6, 0.4])
        self.assertEqual(comparison.holm([0.9, 0.8]), [1.0, 1.0])
        # a registered family larger than the observed p values: each missing p counts as larger than every observed one
        self.assertEqual(comparison.holm([0.02], 3), [0.06])
        self.assertEqual(comparison.holm([0.04, 0.01], 4), [0.12, 0.04])
        self.assertEqual(comparison.holm([0.6, 0.2], 2), comparison.holm([0.6, 0.2]))
        for bad in ([], [1.2], [-0.1], [float("nan")]):
            with self.subTest(bad=bad):
                self.assertEqual(refused(comparison.holm, bad), "COMPARISON_UNAVAILABLE")
        for family_size in (1, 2.0, True):
            with self.subTest(family_size=family_size):
                self.assertEqual(refused(comparison.holm, [0.1, 0.2], family_size), "COMPARISON_UNAVAILABLE")


class RegressionTests(unittest.TestCase):
    def test_the_market_regression_sums_the_same_day_and_lagged_slopes(self):
        market = [0.01, -0.02, 0.015, 0.0, 0.03, -0.01, 0.005, 0.02, -0.015, 0.01]
        y = [0.0] + [0.001 + 0.5 * market[t] + 0.2 * market[t - 1] for t in range(1, 10)]
        found = measures.market_regression(y, market)
        self.assertAlmostEqual(found["beta"], 0.7, places=12)
        self.assertAlmostEqual(found["alpha"], 0.001, places=12)
        self.assertAlmostEqual(found["alpha_se"], 0.0, places=10)
        self.assertEqual((found["days"], found["lag_selection"]), (9, measures.lag_selection(9)))

    def test_the_lag_selection_parameter_is_newey_west_1994s_truncation(self):
        self.assertEqual([measures.lag_selection(n) for n in (81, 100, 365)], [3, 4, 5])

    def test_the_bartlett_bandwidth_is_newey_west_1994s_automatic_rule(self):
        # T = 100, h_t = (-1)^t: sigma_j = (-1)^j (100 - j) / 100 for j = 0..4 (n = 4), so
        # s0 = 1 + 2 (-0.99 + 0.98 - 0.97 + 0.96) = 0.96, s1 = 2 (-0.99 + 1.96 - 2.91 + 3.84) = 3.8,
        # gamma = 1.1447 ((3.8 / 0.96) ** 2) ** (1 / 3) = 2.8649 and m = floor(gamma 100 ** (1 / 3)) = 13.
        self.assertEqual(measures.automatic_bandwidth([(-1) ** t for t in range(100)]), (13, 4))
        self.assertEqual(measures.automatic_bandwidth([0.0] * 100), (0, 4), "no variation, no lag")
        # With a constant only, the weight w_T = (X'X / T)^-1 = 1 and w'h_t is the residual itself.
        y = [0.5 + (-1) ** t for t in range(100)]
        self.assertEqual(measures.coefficient_bandwidth(y, np.ones((100, 1)), 0), (13, 4))

    def test_with_no_lag_the_covariance_is_whites(self):
        x = np.column_stack([np.ones(4), [1.0, 2.0, 3.0, 5.0]])
        y = np.array([1.0, 3.0, 2.0, 6.0])
        beta, covariance = measures.ols_newey_west(y, x, 0)
        residual = y - x @ beta
        bread = np.linalg.inv(x.T @ x)
        white = bread @ (x.T @ np.diag(residual ** 2) @ x) @ bread
        np.testing.assert_allclose(covariance, white, rtol=1e-12)


def cycle(seq, instrument, side, opened, closed, realized, commissions="0", funding="0", unrealized=None,
          plan=None, exit_type="LIMIT") -> dict:
    realized_value = None if realized is None else Decimal(realized)
    return {"seq": seq, "instrument_id": instrument, "side": side, "ts_opened_ns": opened, "ts_closed_ns": closed,
            "realized_pnl": realized_value, "commissions": Decimal(commissions), "funding": Decimal(funding),
            "price_pnl": None if realized_value is None else realized_value + Decimal(commissions) - Decimal(funding),
            "open_unrealized": None if unrealized is None else Decimal(unrealized), "plan_tag": plan,
            "closing_order_type": exit_type if closed is not None else None}


def sealed(drawdown: float = 0.05, plans: bool = True) -> dict:
    facts = {name: {"passed": True, "code": None} for name in (
        "real_fills@1", "fills_match_orders@1", "cycles_cover_fills@1", "returns_compound_to_equity@1",
        "account_endpoints_match@2", "cycles_reconcile_audit@1")}
    return {"activity": facts, "populations": {"bars": 96},
            "drawdown": {"mark_max_drawdown@2": {"value": drawdown}, "duration_days@2": {"value": 1.5},
                         "top_instrument_share_in_drawdown@2": {"value": 0.6}},
            "plans_valid@1": {"passed": plans, "code": None if plans else "PLAN_TAG_MISSING"}}


class MeasureTests(unittest.TestCase):
    """Four days, two closed cycles and one open: every value is checkable by hand."""

    def setUp(self):
        values, notional = [0.01, -0.005, 0.0, 0.02], ["100", "0", "50", "200"]
        self.returns = [(JAN + k * DAY, value, Decimal(mean)) for k, (value, mean) in enumerate(zip(values, notional, strict=True))]
        self.final = Decimal("1000") * Decimal(repr(1.01 * 0.995 * 1.0 * 1.02))
        self.cycles = [cycle(1, "X", "long", JAN, JAN + 6 * 3600 * 10**9, "20", "1", "0.5", plan="p1"),
                       cycle(2, "Y", "short", JAN + DAY, JAN + DAY + 2 * 3600 * 10**9, "-4", "1", "-0.5", plan="p2",
                             exit_type="STOP_MARKET"),
                       cycle(3, "X", "long", JAN + 3 * DAY, None, "-0.5", "0.5", "0", unrealized="9.549", plan="p3")]
        self.facts = {"sealed": sealed(), "returns": self.returns, "cycles": self.cycles,
                      "starting_balance": Decimal("1000"), "final_equity": self.final, "trade_start_ns": JAN,
                      "trade_end_ns": JAN + 4 * DAY, "input_identity": {}}

    def derive(self, **overrides) -> dict:
        found = measures.derive_measures({**self.facts, **overrides},
                                         market={"days": ["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04"],
                                                 "basket": [0.01, 0.01, -0.005, 0.0], "btc": [0.0, 0.01, 0.0, 0.0]})
        return {name: item["value"] for name, item in found.items()} | {"_reasons": {
            name: item["null_reason"] for name, item in found.items()}}

    def test_the_headline_and_profit_bridge(self):
        found = self.derive()
        growth = 1.01 * 0.995 * 1.0 * 1.02
        self.assertAlmostEqual(found["annual_return@1"], growth ** (365 / 4) - 1, places=9)
        values = [0.01, -0.005, 0.0, 0.02]
        mean = sum(values) / 4
        self.assertAlmostEqual(found["sharpe_365@1"], mean / math.sqrt(sum((v - mean) ** 2 for v in values) / 3)
                               * math.sqrt(365), places=12)
        self.assertEqual(found["plan_win_rate@1"], 1 / 3, "the open plan counts and has not won")
        self.assertEqual((found["price@1"], found["fee@1"], found["funding@1"], found["open_mark@1"]),
                         ("18.00000000", "-2.50000000", "0.00000000", "9.54900000"))
        self.assertEqual(Decimal(found["account@1"]), (self.final - 1000).quantize(Decimal("0.00000001")))
        self.assertEqual(found["mark_max_drawdown@2"], 0.05)
        self.assertAlmostEqual(found["return_over_drawdown@1"], found["annual_return@1"] / 0.05)
        self.assertAlmostEqual(found["breakeven_fee_multiple@1"], 1 + float(Decimal(found["account@1"]) / Decimal("2.5")), places=6)

    def test_turnover_is_the_sealed_traded_notional_over_starting_equity_per_day(self):
        fees = {"MAKER": {"commissions": "1", "notional": "300", "fills": 2},
                "TAKER": {"commissions": "1.5", "notional": "500", "fills": 1}}
        found = measures.derive_measures({**self.facts, "sealed": {**sealed(), "fees_by_liquidity_side@2": fees}})
        self.assertEqual((found["daily_turnover@1"]["value"], found["daily_turnover@1"]["sample_size"]),
                         (800 / 1000 / 4, 3))
        self.assertTrue(self.derive()["_reasons"]["daily_turnover@1"].startswith("FEES_UNAVAILABLE"))

    def test_the_lo_sharpe_stands_beside_the_native_sharpe(self):
        found = measures.derive_measures(self.facts, market={"error": "MARKET_RETURNS_UNAVAILABLE: fixture"})
        expected = measures.sharpe_lo([0.01, -0.005, 0.0, 0.02])
        self.assertEqual(found["sharpe_lo@1"]["value"], expected["value"])
        self.assertEqual(found["sharpe_lo@1"]["lags"], 1)
        self.assertIn("sharpe_365@1", found)

    def test_the_days_split_by_the_prior_days_basket_volatility(self):
        # History of |r| = 0.01 from 2025-12-02 on; a 0.05 move on 2026-01-02 makes 2026-01-03 the one high day.
        days = [(date(2025, 12, 2) + timedelta(days=k)).isoformat() for k in range(34)]
        basket = [0.01 if k % 2 else -0.01 for k in range(34)]
        basket[days.index("2026-01-02")] = 0.05
        found = measures.derive_measures(self.facts, market={"days": days, "basket": basket, "btc": [0.0] * 34})
        self.assertEqual((found["high_vol_days@1"]["value"], found["low_vol_days@1"]["value"]), (1, 3))
        self.assertEqual(found["high_vol_days@1"]["unlabelled_days"], 0)
        self.assertEqual(found["high_vol_log_sum@1"]["value"], 0.0, "2026-01-03 returned nothing")
        low = [math.log1p(0.01), math.log1p(-0.005), math.log1p(0.02)]
        self.assertAlmostEqual(found["low_vol_log_sum@1"]["value"], sum(low), places=15)
        self.assertAlmostEqual(found["low_vol_mean_log@1"]["value"], sum(low) / 3, places=15)
        unlabelled = self.derive()
        self.assertEqual((unlabelled["high_vol_days@1"], unlabelled["low_vol_days@1"]), (0, 0))
        self.assertTrue(unlabelled["_reasons"]["low_vol_mean_log@1"].startswith("NO_LOW_VOL_DAY"))

    def test_an_unreconciled_bridge_is_empty_as_a_whole(self):
        found = self.derive(cycles=[*self.cycles[:2], cycle(3, "X", "long", JAN, None, "-0.5", "0.5", unrealized="1")])
        self.assertEqual([found[f"{name}@1"] for name in ("price", "fee", "funding", "open_mark", "account")],
                         [None] * 5)
        self.assertTrue(found["_reasons"]["price@1"].startswith("BRIDGE_UNRECONCILED"))
        plans_invalid = self.derive(sealed=sealed(plans=False))
        self.assertIsNone(plans_invalid["plan_win_rate@1"])
        self.assertTrue(plans_invalid["_reasons"]["plan_win_rate@1"].startswith("PLAN_TAG_MISSING"))

    def test_scale_splits_into_level_and_timing_that_sum_to_the_exposed_pnl(self):
        found = self.derive()
        self.assertEqual(found["mean_notional@1"], 87.5)
        pnl = [10.0, 1010 * -0.005, 0.0, 1010 * 0.995 * 0.02]
        self.assertAlmostEqual(found["level_term@1"] + found["timing_term@1"], pnl[0] + pnl[2] + pnl[3], places=9)
        n, u = [100, 50, 200], [pnl[0] / 100, pnl[2] / 50, pnl[3] / 200]
        self.assertAlmostEqual(found["level_term@1"], 3 * (sum(n) / 3) * (sum(u) / 3), places=9)
        self.assertAlmostEqual(found["unit_return@1"], float(self.final - 1000) / 87.5, places=9)
        self.assertEqual(found["up_month_notional@1"], 87.5, "the basket rose in January")
        self.assertIsNone(found["down_month_notional@1"])
        split = measures.level_timing([1, 2, 3], [1, 4, 9])
        self.assertEqual((split["level"], split["timing"]), (12.0, 2.0))

    def test_the_days_without_exposure_and_their_pnl_are_listed_apart(self):
        found = measures.derive_measures(self.facts, market={"error": "MARKET_RETURNS_UNAVAILABLE: fixture"})
        level, timing = found["level_term@1"], found["timing_term@1"]
        self.assertEqual((level["flat_days"], timing["flat_days"], level["sample_size"]), (1, 1, 3))
        self.assertAlmostEqual(level["flat_pnl"], 1010 * -0.005, places=9, msg="the second day held no exposure")
        self.assertAlmostEqual(level["value"] + timing["value"] + level["flat_pnl"],
                               sum(measures.daily_pnl(self.returns, Decimal("1000"))), places=9)

    def test_passive_marked_exposure_has_a_timing_term_that_scales_with_quantity(self):
        # One fixed unit at prices 100 -> 200 -> 300; no active resizing decision.
        full = measures.level_timing([150, 250], [100, 100])
        half = measures.level_timing([75, 125], [50, 50])
        self.assertAlmostEqual(full["timing"], -40 / 3)
        self.assertAlmostEqual(half["timing"], full["timing"] / 2)
        self.assertAlmostEqual(full["level"] + full["timing"], 200)
        self.assertAlmostEqual(half["level"] + half["timing"], 100)

    def test_trade_structure_instruments_and_periods(self):
        found = self.derive()
        self.assertEqual((found["cycles@1"], found["win_rate@1"], found["avg_win@1"], found["avg_loss@1"],
                          found["expectancy@1"], found["median_holding_hours@1"]),
                         (2, 0.5, "20.00000000", "-4.00000000", "8.00000000", 4.0))
        self.assertEqual(found["top_exit_share@1"], 20 / 24)
        self.assertEqual((found["top5_abs_share@1"], found["long_net@1"], found["short_net@1"]),
                         (1.0, "20.00000000", "-4.00000000"))
        self.assertIsNone(found["one_side_instruments@1"])
        self.assertEqual(found["months_won_share@1"], 1.0)
        self.assertTrue(found["_reasons"]["beta_basket@1"].startswith("REGRESSION_UNAVAILABLE"), "four days are too few")

    def test_a_series_that_does_not_compound_empties_every_series_measure(self):
        broken = sealed()
        broken["activity"]["returns_compound_to_equity@1"] = {"passed": False, "code": "RETURN_SERIES_UNUSABLE"}
        found = self.derive(sealed=broken)
        for name in ("annual_return@1", "sharpe_365@1", "mean_notional@1", "months_won_share@1"):
            self.assertIsNone(found[name])

    def test_the_comparison_helpers(self):
        self.assertEqual(measures.breakeven_multiple(Decimal(1000), Decimal(500)), (3.0, None))
        self.assertIsNone(measures.breakeven_multiple(Decimal(1000), Decimal(-500))[0], "it never reaches zero")
        self.assertEqual(measures.breakeven_multiple(Decimal(-100), Decimal(500)), (0.8, None),
                         "a candidate that pays more and loses breaks even at lower fees")
        split = measures.expectancy_split({"win_rate": 0.4, "avg_win": 200, "avg_loss": -100},
                                          {"win_rate": 0.5, "avg_win": 100, "avg_loss": -100})
        self.assertAlmostEqual(split["win_rate_part"], 25)
        self.assertAlmostEqual(split["payoff_part"], -45)
        self.assertAlmostEqual(split["difference"], -20)
        self.assertEqual(measures.residual_after_top([5, 4, 3, 2, 1, -1, -2]), -3)
        self.assertEqual(measures.residual_after_top([-5, -4, -3, -2, -1, 1, 2]), 3)
        self.assertEqual(measures.top_share([1, -1, 2]), 1.0)


    def test_a_candidate_paying_less_in_fees_that_still_wins_never_breaks_even(self):
        multiple, reason = measures.breakeven_multiple(Decimal(100), Decimal(-500))
        self.assertIsNone(multiple, "raising both fees only widens the lead of the cheaper winner")
        self.assertTrue(reason.startswith("NEVER_ZERO"))


class SerialCorrelationTests(unittest.TestCase):
    def test_lo_scales_the_daily_sharpe_by_eta_of_the_truncated_autocorrelations(self):
        # Ten days alternating 0.03 and 0.01: mean 0.02, rho_1 = -0.9, rho_2 = 0.8, and
        # lag_selection(10) = floor(4 * 0.1 ** (2 / 9)) = 2; eta = 365 / sqrt(365 + 2 (364 (-0.9) + 363 (0.8))).
        returns = [0.03, 0.01] * 5
        found = measures.sharpe_lo(returns)
        self.assertEqual(found["lags"], 2)
        np.testing.assert_allclose(found["autocorrelations"], [-0.9, 0.8], rtol=1e-12)
        self.assertAlmostEqual(found["eta"], 365 / math.sqrt(290.6), places=12)
        daily = 0.02 / math.sqrt(10 * 0.01 ** 2 / 9)
        self.assertAlmostEqual(found["value"], daily * 365 / math.sqrt(290.6), places=10)
        self.assertAlmostEqual(found["value"] / measures.sharpe_365(returns), 365 / math.sqrt(290.6) / math.sqrt(365),
                               places=12, msg="beside the native Sharpe, only the annualisation differs")
        self.assertIsNone(measures.sharpe_lo([0.01] * 10), "returns that do not vary have no Sharpe ratio")

    def test_a_bracket_that_is_not_positive_leaves_the_ratio_empty(self):
        # Four days alternating: lag_selection(4) = 1 and rho_1 = -0.75, so 365 + 2 (364) (-0.75) = -181.
        self.assertIsNone(measures.sharpe_lo([0.01, 0.03, 0.01, 0.03]))


class RegimeTests(unittest.TestCase):
    def test_a_day_is_high_when_the_prior_days_absolute_basket_return_tops_the_trailing_median(self):
        days = [(date(2026, 1, 1) + timedelta(days=k)).isoformat() for k in range(32)]
        # Thirty history days of |r| = 0.01 except 0.02 on even days, then the two days to label.
        basket = [0.02 if k % 2 == 0 else -0.01 for k in range(30)] + [0.0, 0.0]
        labels, reason = measures.regime_labels({"days": days, "basket": basket}, days[29:])
        self.assertIsNone(reason)
        # Day 29 lacks a full window (the 30 days before it reach 2025-12-31); day 30's prior day is
        # day 29 (|r| = 0.01, median of days 0..29 is 0.015): low; day 31's prior day is day 30
        # (|r| = 0), window days 1..30: low as well. A spike the day before makes the day high.
        self.assertEqual(labels, {days[29]: None, days[30]: "low", days[31]: "low"})
        spiked = basket[:30] + [0.05, 0.0]
        labels, _ = measures.regime_labels({"days": days, "basket": spiked}, days[31:])
        self.assertEqual(labels, {days[31]: "high"})
        self.assertEqual(measures.regime_labels({"error": "MARKET_RETURNS_UNAVAILABLE: fixture"}, days)[1],
                         "MARKET_RETURNS_UNAVAILABLE: fixture")


class PairwiseTests(unittest.TestCase):
    """The comparison's own definitions on a pair of runs too short for the market regression."""

    def test_a_short_window_leaves_the_pairwise_regression_empty_with_its_reason(self):
        four = [(JAN + k * DAY, 0.001 * k, None) for k in range(4)]
        facts = {"cycles": [], "returns": four}
        market = {"days": [measures.day_of(ts) for ts, _, _ in four], "basket": [0.01, 0.02, -0.01, 0.0],
                  "btc": [0.0, 0.01, 0.0, 0.02]}
        found = attribution._pairwise(facts, facts, {}, {}, market, {"scalars": {}})
        for name in ("beta_basket", "alpha_basket", "beta_btc", "alpha_btc"):
            with self.subTest(name=name):
                self.assertIsNone(found[name]["value"])
                self.assertTrue(found[name]["null_reason"].startswith("REGRESSION_UNAVAILABLE"))
        self.assertEqual(found["one_side_instruments"]["value"], 0, "the rest of the pair is still given")

    def test_a_singular_market_series_leaves_the_regression_empty(self):
        days = [(JAN + k * DAY, 0.001 * (k % 3), None) for k in range(10)]
        market = {"days": [measures.day_of(ts) for ts, _, _ in days], "basket": [0.0] * 10, "btc": [0.0] * 10}
        found = attribution._pairwise({"cycles": [], "returns": days}, {"cycles": [], "returns": days}, {}, {}, market,
                                      {"scalars": {}})
        self.assertTrue(found["beta_basket"]["null_reason"].startswith("REGRESSION_UNAVAILABLE"))


class InteractionShapeTests(unittest.TestCase):
    BASE = b"a = 1\nb = 2\nc = 3\nd = 4\ne = 5\n"

    def test_two_changes_on_different_lines_merge_into_both(self):
        a = self.BASE.replace(b"b = 2", b"b = 20")
        b = self.BASE.replace(b"e = 5", b"e = 50")
        self.assertEqual(attribution.merge3(self.BASE, a, b), self.BASE.replace(b"b = 2", b"b = 20").replace(
            b"e = 5", b"e = 50"))
        self.assertEqual(attribution.merge3(self.BASE, b, a), attribution.merge3(self.BASE, a, b))
        self.assertEqual(attribution.merge3(self.BASE, a, a), a, "the same change on both sides is taken once")

    def test_two_changes_of_one_line_conflict(self):
        a = self.BASE.replace(b"c = 3", b"c = 30")
        b = self.BASE.replace(b"c = 3", b"c = 31")
        self.assertIsNone(attribution.merge3(self.BASE, a, b))

    def test_insertions_and_deletions_merge_around_the_kept_lines(self):
        a = b"x = 0\n" + self.BASE
        b = self.BASE.replace(b"d = 4\n", b"")
        self.assertEqual(attribution.merge3(self.BASE, a, b), b"x = 0\na = 1\nb = 2\nc = 3\ne = 5\n")

    def test_the_contributions_average_both_orders_and_sum_to_the_corner_difference(self):
        found = attribution.contributions({"base": 0.0, "a": 0.002, "b": 0.001, "ab": 0.005})
        self.assertAlmostEqual(found["a"], (0.002 + 0.004) / 2)
        self.assertAlmostEqual(found["b"], (0.001 + 0.003) / 2)
        self.assertAlmostEqual(found["a"] + found["b"], found["total"])
        self.assertAlmostEqual(found["interaction"], 0.002)


class PairTradeTests(unittest.TestCase):
    """Control and candidate cycles: one kept, one entered later, one split in two, one removed, one
    on the other side, one added and still open."""

    def setUp(self):
        m = MINUTE
        self.control = [cycle(1, "X", "long", 0, 100 * m, "10"), cycle(2, "X", "long", 200 * m, 300 * m, "-5"),
                        cycle(3, "X", "long", 400 * m, 600 * m, "8"), cycle(4, "Y", "long", 0, 50 * m, "-3"),
                        cycle(5, "X", "short", 0, 100 * m, "2")]
        self.candidate = [cycle(1, "X", "long", 0, 100 * m, "10"), cycle(2, "X", "long", 250 * m, 300 * m, "4"),
                          cycle(3, "X", "long", 400 * m, 500 * m, "5"), cycle(4, "X", "long", 500 * m, 600 * m, "5"),
                          cycle(5, "X", "short", 700 * m, None, "0", unrealized="-1")]
        self.found = attribution.pair_trades(self.control, self.candidate, 1000 * m)

    def test_cycles_pair_one_to_one_by_overlap_within_instrument_and_side(self):
        pairs = [(item["control"], item["candidate"], item["overlap"]) for item in self.found["pairs"]]
        self.assertEqual(pairs, [(1, 1, 1.0), (2, 2, 0.5), (3, 3, 0.5)], "ties go to the earlier opening")
        self.assertEqual({name: item["count"] for name, item in self.found["classes"].items()},
                         {"matched": 3, "split_merge": 1, "only_control": 2, "only_candidate": 1})
        self.assertEqual(self.found["open"]["candidate"], 1)

    def test_coverage_comes_with_the_removed_added_and_matched_differences(self):
        scalars = self.found["scalars"]
        self.assertEqual(scalars["matched_share"], 0.6)
        self.assertEqual(scalars["matched_net_share"], 42 / 52, "closed cycles only")
        self.assertEqual((scalars["removed_net"], scalars["added_net"], scalars["matched_delta_net"]),
                         ("-1.00000000", "-1.00000000", "6.00000000"))
        self.assertEqual((scalars["win_to_loss"], scalars["loss_to_win"], scalars["median_entry_shift_minutes"]),
                         (0, 1, 0))
        self.assertEqual(self.found["coverage"]["overlap_quantiles"], {"p10": 0.5, "p50": 0.5, "p90": 0.5})

    def test_a_cycle_pairs_with_itself_completely(self):
        same = attribution.pair_trades(self.control, self.control, 1000 * MINUTE)
        self.assertEqual((same["scalars"]["matched_share"], same["classes"]["matched"]["count"]), (1.0, 5))


if __name__ == "__main__":
    unittest.main()
