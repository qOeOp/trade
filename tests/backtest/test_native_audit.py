"""Corruption rejection for native report reconciliation, without a replay."""

import copy
import ast
import csv
import json
from pathlib import Path
import tempfile
import unittest

import pandas as pd

from backtest.r1.checks.audit_tiered_native import audit


START = "2026-01-01 00:00:00+00:00"
ENTRY = "2026-01-01 00:05:00+00:00"
FUNDING = "2026-01-01 00:07:00+00:00"
EXIT = "2026-01-01 00:10:00+00:00"
SCOPE = {"strategy_id": "R1-BTC", "instrument_id": "BTCUSDT-PERP.BINANCE", "account_id": "BINANCE-001"}


def order(identity, side, kind="LIMIT", quantity="1", status="FILLED", **changes):
    return {**SCOPE, "client_order_id": identity, "side": side, "type": kind,
            "quantity": quantity, "filled_qty": quantity if status == "FILLED" else "0",
            "status": status, "ts_init": str(pd.Timestamp(START).value),
            "commissions": "['1 USDT']" if status == "FILLED" else "",
            "linked_order_ids": "[]", "parent_order_id": "", "tags": "",
            "is_reduce_only": "False", **changes}


def fill(identity, side, timestamp, price):
    return {**SCOPE, "client_order_id": identity, "event_id": "event-" + identity,
            "trade_id": "trade-" + identity, "order_side": side, "order_type": "LIMIT",
            "last_qty": "1", "last_px": price, "commission": "1 USDT", "ts_event": timestamp}


def reports(open_position=False, short=False):
    entry = fill("entry", "SELL" if short else "BUY", ENTRY, "100")
    close = fill("close", "BUY" if short else "SELL", EXIT, "110")
    fills = [entry] if open_position else [entry, close]
    events = [{**value, "type": "OrderFilled", "ts_event": pd.Timestamp(value["ts_event"]).value}
              for value in fills]
    adjustment = {**SCOPE, "type": "PositionAdjusted", "event_id": "funding-1",
                  "adjustment_type": "FUNDING", "quantity_change": None, "pnl_change": "1 USDT",
                  "ts_event": pd.Timestamp(FUNDING).value}
    position = {**SCOPE, "position_id": "position-1", "events": repr(events),
                "adjustments": repr([adjustment]), "commissions": "['1 USDT']" if open_position else "['2 USDT']",
                "opening_order_id": "entry", "closing_order_id": "" if open_position else "close",
                "side": ("SHORT" if short else "LONG") if open_position else "FLAT",
                "quantity": "1" if open_position else "0",
                "buy_qty": "0" if open_position and short else "1",
                "sell_qty": "0" if open_position and not short else "1",
                "ts_closed": "" if open_position else EXIT, "realized_pnl": "0 USDT" if open_position else "9 USDT"}
    orders = [order("entry", entry["order_side"])]
    if open_position:
        side = "BUY" if short else "SELL"
        orders[0]["linked_order_ids"] = "['stop']"
        orders += [order("stop", side, "STOP_MARKET", status="ACCEPTED", parent_order_id="entry", is_reduce_only="True"),
                   order("first", side, quantity="0.5", status="ACCEPTED", is_reduce_only="True"),
                   order("last", side, quantity="0.5", status="ACCEPTED", is_reduce_only="True")]
    else:
        orders.append(order("close", close["order_side"]))
    accounts = [{"ts_event": START, "total": "100000", "locked": "0", "free": "100000",
                 "currency": "USDT", "base_currency": "USDT", "account_id": "BINANCE-001"},
                {"ts_event": ENTRY, "total": "99999", "locked": "0", "free": "99999",
                 "currency": "USDT", "base_currency": "USDT", "account_id": "BINANCE-001"},
                {"ts_event": FUNDING, "total": "100000", "locked": "0", "free": "100000",
                 "currency": "USDT", "base_currency": "USDT", "account_id": "BINANCE-001"},
                {"ts_event": EXIT, "total": "100000" if open_position else "100009", "locked": "0",
                 "free": "100000" if open_position else "100009", "currency": "USDT",
                 "base_currency": "USDT", "account_id": "BINANCE-001"}]
    summary = {"signal_variant": "daily-pivot", "integrity_passed": True, "denied_orders": 0,
               "rejected_orders": 0, "closed_trades": 0 if open_position else 1,
               "winning_trades": 0 if open_position else 1, "starting_balance_usdt": "100000",
               "final_equity_usdt": "100010" if open_position else "100009"}
    return {"orders": orders, "fills": fills, "positions": [position], "account": accounts, "summary": summary}


class NativeAuditTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)

    def check(self, values):
        for name in ("orders", "fills", "positions", "account"):
            with (self.root / f"{name}.csv").open("w", newline="") as stream:
                writer = csv.DictWriter(stream, fieldnames=list(values[name][0]))
                writer.writeheader()
                writer.writerows(values[name])
        (self.root / "summary.json").write_text(json.dumps(values["summary"]))
        (self.root / "returns_series.csv").write_text("ts_event_ns,native_return\n")
        return audit(self.root)

    def test_closed_native_economics_and_short_links_pass(self):
        for short in (False, True):
            value = self.check(reports(short=short))
            self.assertTrue(value["passed"], value["findings"])
            self.assertEqual(value["native_economics"]["reported_funding_usdt"], "1")
            self.assertEqual(value["native_economics"]["fill_commissions_usdt"], "2")
            self.assertIn("native report identity", value["scope"])

    def test_staged_open_protection_uses_two_targets_without_tags(self):
        for short in (False, True):
            value = self.check(reports(open_position=True, short=short))
            self.assertTrue(value["passed"], value["findings"])
            self.assertIn("no position remains open", value["coverage_limits"][-1])

    def test_corrupt_order_fill_position_and_account_reports_are_rejected(self):
        changes = [
            lambda x: x["orders"].append(copy.deepcopy(x["orders"][0])),
            lambda x: x["orders"][0].update(status="UNRECOGNIZED"),
            lambda x: x["orders"][0].update(linked_order_ids="['missing']"),
            lambda x: x["fills"][0].update(client_order_id="missing"),
            lambda x: x["fills"][0].update(last_qty="2"),
            lambda x: x["orders"][0].update(commissions="['2 USDT']"),
            lambda x: x["positions"][0].update(events="[]"),
            lambda x: x["positions"][0].update(closing_order_id="missing"),
            lambda x: x["positions"][0].update(position_id=""),
            lambda x: x["positions"][0].update(buy_qty="2"),
            lambda x: x["positions"][0].update(commissions="['3 USDT']"),
            lambda x: x["positions"][0].update(adjustments=x["positions"][0]["adjustments"].replace("'R1-BTC'", "'R1-ETH'")),
            lambda x: x["positions"][0].update(adjustments=x["positions"][0]["adjustments"].replace("1 USDT", "2 USDT")),
            lambda x: x["positions"][0].update(adjustments="[]"),
            lambda x: x["account"][-1].update(total="100010", free="100010"),
            lambda x: x["account"][-1].update(locked="1"),
            lambda x: x["summary"].update(final_equity_usdt="100010"),
        ]
        for index, change in enumerate(changes):
            with self.subTest(index=index):
                values = reports()
                change(values)
                self.assertFalse(self.check(values)["passed"])

    def test_missing_report_fields_are_an_audit_failure(self):
        values = reports()
        for row in values["fills"]:
            row.pop("event_id")
        value = self.check(values)
        self.assertFalse(value["passed"])
        self.assertEqual(value["findings"], ["native fills report fields missing"])

    def test_filled_status_requires_complete_quantity_but_canceled_partial_is_valid(self):
        values = reports()
        values["orders"][0]["quantity"] = "2"
        value = self.check(values)
        self.assertFalse(value["passed"])
        self.assertTrue(any("not fully filled" in finding for finding in value["findings"]))
        values["orders"][0]["status"] = "CANCELED"
        value = self.check(values)
        self.assertTrue(value["passed"], value["findings"])

    def test_position_opening_and_closing_links_follow_first_and_last_fill(self):
        for opening, closing in (("close", "close"), ("entry", "entry"), ("close", "entry")):
            with self.subTest(opening=opening, closing=closing):
                values = reports()
                values["positions"][0].update(opening_order_id=opening, closing_order_id=closing)
                self.assertFalse(self.check(values)["passed"])
        values = reports()
        position = values["positions"][0]
        position["opening_order_id"], position["closing_order_id"] = "close", "entry"
        position["events"] = repr(list(reversed(ast.literal_eval(position["events"]))))
        value = self.check(values)
        self.assertFalse(value["passed"])
        self.assertTrue(any("out of time order" in finding for finding in value["findings"]))

    def test_multiple_staged_exit_fills_keep_last_closing_link(self):
        values = reports()
        first = values["fills"][-1]
        first.update(last_qty="0.4", commission="0.4 USDT")
        final_time = "2026-01-01 00:15:00+00:00"
        last = {**first, "client_order_id": "last", "last_qty": "0.6", "commission": "0.6 USDT",
                "event_id": "event-last", "trade_id": "trade-last", "ts_event": final_time}
        values["fills"].append(last)
        values["orders"][-1].update(quantity="0.4", filled_qty="0.4", commissions="['0.4 USDT']")
        values["orders"].append(order("last", "SELL", quantity="0.6", commissions="['0.6 USDT']"))
        events = [{**value, "type": "OrderFilled", "ts_event": pd.Timestamp(value["ts_event"]).value}
                  for value in values["fills"]]
        values["positions"][0].update(events=repr(events), closing_order_id="last", ts_closed=final_time)
        values["account"][-1]["ts_event"] = final_time
        value = self.check(values)
        self.assertTrue(value["passed"], value["findings"])

    def test_known_denial_or_runner_failure_remains_a_failure(self):
        for change in (lambda x: x["summary"].update(integrity_passed=False),
                       lambda x: x["orders"][0].update(status="DENIED")):
            values = reports()
            change(values)
            self.assertFalse(self.check(values)["passed"])

    def test_missing_open_stop_or_target_is_rejected(self):
        for identity in ("stop", "first"):
            values = reports(open_position=True)
            values["orders"] = [row for row in values["orders"] if row["client_order_id"] != identity]
            self.assertFalse(self.check(values)["passed"])

    def test_former_tier_variant_gets_the_same_generic_reconciliation(self):
        values = reports()
        values["summary"]["signal_variant"] = "support-broad-two-tier-4h"  # No sizing block.
        value = self.check(values)
        self.assertTrue(value["passed"], value["findings"])
        self.assertEqual(value["native_economics"]["fill_commissions_usdt"], "2")
        self.assertNotIn("native_bundles", value)

if __name__ == "__main__":
    unittest.main()
