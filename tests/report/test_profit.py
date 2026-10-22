"""Whole-account native totals and open partial realization must survive every consumer."""

from decimal import Decimal
import unittest

from report import attribution, profit
from tests.report.test_numerics import cycle


class CompleteProfitTests(unittest.TestCase):
    def setUp(self):
        self.closed = cycle(1, "X", "long", 0, 10, "8", "2", "1")
        self.open = cycle(2, "X", "long", 11, None, "3", "1", "-1", unrealized="4")
        self.audit = {"reported_realized_pnl_usdt": "11", "fill_commissions_usdt": "3",
                      "reported_funding_usdt": "0"}

    def test_account_bridge_includes_partial_realization_and_each_cost_once(self):
        found = profit.account_bridge([self.closed, self.open], 100, 115, self.audit)
        self.assertIsNone(found["reason"])
        self.assertEqual(found["values"], {"price": Decimal(14), "fee": Decimal(-3), "funding": Decimal(0),
                                           "open_mark": Decimal(4), "account": Decimal(15)})

    def test_original_native_total_restores_historical_account_without_forcing_cycle_allocation(self):
        legacy = {**self.open, "realized_pnl": None, "price_pnl": None}
        found = profit.account_bridge([self.closed, legacy], 100, 115, self.audit)
        self.assertIsNone(found["reason"])
        self.assertFalse(found["cycle_realized_complete"])
        restored = profit.complete_cycles([self.closed, legacy], self.audit)
        self.assertEqual(restored[1]["realized_pnl"], Decimal(3))
        self.assertTrue(restored[1]["realized_pnl_source"].startswith("derived:"))
        self.assertIsNone(legacy["realized_pnl"], "the historic row stays untouched")
        multiple = profit.complete_cycles([legacy, {**legacy, "seq": 3}], self.audit)
        self.assertTrue(all(row["realized_pnl"] is None for row in multiple))

    def test_native_totals_catch_realized_and_cost_tampering_separately_from_equity(self):
        for field, code in (("realized_pnl", "CYCLE_REALIZED_MISMATCH"), ("commissions", "CYCLE_COST_MISMATCH"),
                            ("funding", "CYCLE_COST_MISMATCH")):
            changed = {**self.closed, field: Decimal(self.closed[field]) + 1}
            found = profit.account_bridge([changed, self.open], 100, 115, self.audit)
            self.assertTrue(found["reason"].startswith(code))
        found = profit.account_bridge([self.closed, self.open], 100, 116, self.audit)
        self.assertTrue(found["reason"].startswith("BRIDGE_UNRECONCILED"))

    def test_pairing_uses_open_realized_plus_mark_and_preserves_unknowns(self):
        left = [{**self.open, "realized_pnl": Decimal(-5), "open_unrealized": Decimal(4)}]
        right = [self.open]
        found = attribution.pair_trades(left, right, 100)
        self.assertEqual(found["scalars"]["matched_delta_net"], "8.00000000")
        self.assertEqual(found["scalars"]["loss_to_win"], 1)
        self.assertEqual(found["classes"]["matched"]["net"], "8.00000000")
        for missing in ("realized_pnl", "open_unrealized"):
            found = attribution.pair_trades(left, [{**self.open, missing: None}], 100)
            self.assertIsNone(found["scalars"]["matched_delta_net"])
            self.assertIsNone(found["scalars"]["loss_to_win"])
            self.assertEqual(found["pairs"][0]["null_reason"], "CYCLE_PNL_MISSING")

    def test_missing_capture_or_cycle_mark_is_not_zero(self):
        self.assertIsNone(profit.native_economics({}))
        found = profit.account_bridge([self.closed, {**self.open, "open_unrealized": None}], 100, 115, self.audit)
        self.assertTrue(found["reason"].startswith("OPEN_MARK_MISSING"))
        self.assertTrue(all(value is None for value in found["values"].values()))
