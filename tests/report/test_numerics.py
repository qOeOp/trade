"""The report's numerical functions on hand-checkable fixtures: the paired and single bootstraps,
Holm's correction, the regressions, the read-time measures and the one trade pairing algorithm."""

from __future__ import annotations

from decimal import Decimal
import math
import unittest

import numpy as np

from ledger.errors import Refusal
from report import attribution, comparison, measures, seams


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
        logs = [math.log1p(r) - math.log1p(l) for l, r in zip(left, right)]
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
        self.assertFalse(any(key in found for key in ("passed", "verdict", "improved", "rank")))

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
        manual = [math.log1p(a) - math.log1p(b) - math.log1p(c) + math.log1p(d) for a, b, c, d in zip(*series)]
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

    def test_block_indices_wrap_consecutive_days_from_each_start(self):
        class Fixed:
            def integers(self, low, high, size):
                return np.array([4, 1][:size])
        rows = comparison.block_indices(Fixed(), 5, 3, 1)
        self.assertEqual(rows.tolist(), [[4, 0, 1, 1, 2]])


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
        for bad in ([], [1.2], [-0.1], [float("nan")]):
            with self.subTest(bad=bad):
                self.assertEqual(refused(comparison.holm, bad), "COMPARISON_UNAVAILABLE")


class RegressionTests(unittest.TestCase):
    def test_the_market_regression_sums_the_same_day_and_lagged_slopes(self):
        market = [0.01, -0.02, 0.015, 0.0, 0.03, -0.01, 0.005, 0.02, -0.015, 0.01]
        y = [0.0] + [0.001 + 0.5 * market[t] + 0.2 * market[t - 1] for t in range(1, 10)]
        found = measures.market_regression(y, market)
        self.assertAlmostEqual(found["beta"], 0.7, places=12)
        self.assertAlmostEqual(found["alpha"], 0.001, places=12)
        self.assertAlmostEqual(found["alpha_se"], 0.0, places=10)
        self.assertEqual((found["days"], found["lags"]), (9, measures.newey_west_lags(9)))

    def test_newey_west_lags_follow_the_rule_of_thumb(self):
        self.assertEqual([measures.newey_west_lags(n) for n in (81, 100, 365)], [3, 4, 5])

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
    realized_value = None if closed is None else Decimal(realized)
    return {"seq": seq, "instrument_id": instrument, "side": side, "ts_opened_ns": opened, "ts_closed_ns": closed,
            "realized_pnl": realized_value, "commissions": Decimal(commissions), "funding": Decimal(funding),
            "price_pnl": None if closed is None else realized_value + Decimal(commissions) - Decimal(funding),
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
        self.returns = [(JAN + k * DAY, value, Decimal(mean)) for k, (value, mean) in enumerate(zip(values, notional))]
        self.final = Decimal("1000") * Decimal(repr(1.01 * 0.995 * 1.0 * 1.02))
        self.cycles = [cycle(1, "X", "long", JAN, JAN + 6 * 3600 * 10**9, "20", "1", "0.5", plan="p1"),
                       cycle(2, "Y", "short", JAN + DAY, JAN + DAY + 2 * 3600 * 10**9, "-4", "1", "-0.5", plan="p2",
                             exit_type="STOP_MARKET"),
                       cycle(3, "X", "long", JAN + 3 * DAY, None, None, "0.5", "0", unrealized="9.549", plan="p3")]
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

    def test_an_unreconciled_bridge_is_empty_as_a_whole(self):
        found = self.derive(cycles=[*self.cycles[:2], cycle(3, "X", "long", JAN, None, None, "0.5", unrealized="1")])
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
        split = measures.expectancy_split({"win_rate": 0.4, "avg_win": 200, "avg_loss": -100},
                                          {"win_rate": 0.5, "avg_win": 100, "avg_loss": -100})
        self.assertAlmostEqual(split["win_rate_part"], 25)
        self.assertAlmostEqual(split["payoff_part"], -45)
        self.assertAlmostEqual(split["difference"], -20)
        self.assertEqual(measures.residual_after_top([5, 4, 3, 2, 1, -1, -2]), -3)
        self.assertEqual(measures.residual_after_top([-5, -4, -3, -2, -1, 1, 2]), 3)
        self.assertEqual(measures.top_share([1, -1, 2]), 1.0)


class MarketTests(unittest.TestCase):
    def test_the_basket_weighs_the_month_members_that_have_a_return(self):
        closes = {"BTCUSDT": {"2026-01-31": 100, "2026-02-01": 110, "2026-02-02": 99},
                  "AAA": {"2026-01-31": 10, "2026-02-01": 11},
                  "BBB": {"2026-01-31": 20, "2026-02-01": 18, "2026-02-02": 18}}
        found = seams.daily_returns_from(closes, {"2026-02": {"AAA", "BBB"}}, ["2026-02-01", "2026-02-02"])
        self.assertAlmostEqual(found["btc"][0], 0.1)
        self.assertAlmostEqual(found["btc"][1], -0.1)
        self.assertAlmostEqual(found["basket"][0], (0.1 - 0.1) / 2)
        self.assertEqual((found["basket"][1], found["members_per_day"]), (0.0, [2, 1]),
                         "AAA stopped trading: it drops out after its last return")


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
                          cycle(5, "X", "short", 700 * m, None, None, unrealized="-1")]
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
