"""Corruption rejection for native report reconciliation, without a replay."""

import contextlib
import copy
import ast
import io
import csv
import gzip
import json
from pathlib import Path
import tempfile
import unittest

import pandas as pd

from engine.audit import BAR_NS, audit, audit_main, uncovered_intervals


START = "2026-01-01 00:00:00+00:00"
ENTRY = "2026-01-01 00:05:00+00:00"
FUNDING = "2026-01-01 00:07:00+00:00"
EXIT = "2026-01-01 00:10:00+00:00"
SCOPE = {"strategy_id": "R1-BTC", "instrument_id": "BTCUSDT-PERP.BINANCE", "account_id": "BINANCE-001"}
COMMIT = "c" * 32


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
    side = "BUY" if short else "SELL"
    orders[0]["linked_order_ids"] = "['stop']"
    if open_position:
        orders += [order("stop", side, "STOP_MARKET", status="ACCEPTED", parent_order_id="entry", is_reduce_only="True"),
                   order("first", side, quantity="0.5", status="ACCEPTED", is_reduce_only="True"),
                   order("last", side, quantity="0.5", status="ACCEPTED", is_reduce_only="True")]
    else:
        orders += [order("stop", side, "STOP_MARKET", status="CANCELED", parent_order_id="entry", is_reduce_only="True"),
                   order("close", close["order_side"], is_reduce_only="True")]
    accounts = [{"ts_event": START, "total": "100000", "locked": "0", "free": "100000",
                 "currency": "USDT", "base_currency": "USDT", "account_id": "BINANCE-001"},
                {"ts_event": ENTRY, "total": "99999", "locked": "0", "free": "99999",
                 "currency": "USDT", "base_currency": "USDT", "account_id": "BINANCE-001"},
                {"ts_event": FUNDING, "total": "100000", "locked": "0", "free": "100000",
                 "currency": "USDT", "base_currency": "USDT", "account_id": "BINANCE-001"},
                {"ts_event": EXIT, "total": "100000" if open_position else "100009", "locked": "0",
                 "free": "100000" if open_position else "100009", "currency": "USDT",
                 "base_currency": "USDT", "account_id": "BINANCE-001"}]
    summary = {"signal_variant": "daily-pivot", "integrity_passed": True, "denied_orders": 0, "market_commit": COMMIT,
               "rejected_orders": 0, "closed_trades": 0 if open_position else 1,
               "winning_trades": 0 if open_position else 1, "starting_balance_usdt": "100000",
               "final_equity_usdt": "100010" if open_position else "100009", "period_end_utc": EXIT,
               "input_start_utc": START, "period_start_utc": START,
               "trade_start_by_strategy": {SCOPE["strategy_id"]: pd.Timestamp(START).value}}
    return {"orders": orders, "fills": fills, "positions": [position], "account": accounts, "summary": summary}


def order_events(values):
    """A native event history matching the order and fill reports: accepted at submission, fills
    as reported, and cancellation or expiry at the last fill."""
    events, end = [], max(pd.Timestamp(row["ts_event"]).value for row in values["fills"])
    for row in values["orders"]:
        identity, at = row["client_order_id"], int(row["ts_init"])
        scope = {name: row[name] for name in ("strategy_id", "instrument_id", "client_order_id")}
        events += [{**scope, "type": "OrderInitialized", "event_id": identity + "-0", "ts_event": at,
                    "order_side": row["side"], "order_type": row["type"], "quantity": row["quantity"],
                    "reduce_only": row["is_reduce_only"] == "True"},
                   {**scope, "type": "OrderSubmitted", "event_id": identity + "-1", "ts_event": at}]
        if row["status"] in ("DENIED", "REJECTED"):
            events.append({**scope, "type": "Order" + row["status"].title(), "event_id": identity + "-2",
                           "ts_event": at})
            continue
        events.append({**scope, "type": "OrderAccepted", "event_id": identity + "-2", "ts_event": at})
        events += [{**scope, "type": "OrderFilled", "event_id": value.get("event_id"), "trade_id": value["trade_id"],
                    "order_side": value["order_side"], "last_qty": value["last_qty"],
                    "position_id": "position-1", "ts_event": pd.Timestamp(value["ts_event"]).value}
                   for value in values["fills"] if value["client_order_id"] == identity]
        if row["status"] in ("CANCELED", "EXPIRED"):
            events.append({**scope, "type": "Order" + row["status"].title(), "event_id": identity + "-3",
                           "ts_event": end})
    return events


class NativeAuditTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name) / "reports"  # the auditor reads the receipt from its parent
        self.root.mkdir()

    def check(self, values):
        summary = values["summary"]
        receipt = values.get("coverage", {
            "format": "execution-input-coverage-v1", "input_identity": {"market_commit": summary["market_commit"]},
            "effective_config": {"start": summary["input_start_utc"], "trade_start": summary["period_start_utc"],
                                 "end": summary["period_end_utc"]},
            "membership": {"commit": summary["market_commit"], "membership": {
                "BTCUSDT": [[pd.Timestamp(summary["input_start_utc"]).value, pd.Timestamp(summary["period_end_utc"]).value]]}},
            "export_receipts": {"BTCUSDT": {"pieces": [{"index": None, "instrument_id": SCOPE["instrument_id"],
                "last_bar_ns": pd.Timestamp(summary["period_end_utc"]).value - 1_000_000, "episode": None}]}}})
        coverage_path = self.root.parent / "input-coverage.json"
        if receipt is None:
            coverage_path.unlink(missing_ok=True)
        else:
            coverage_path.write_text(json.dumps(receipt))
        for name in ("orders", "fills", "positions", "account"):
            with (self.root / f"{name}.csv").open("w", newline="") as stream:
                writer = csv.DictWriter(stream, fieldnames=list(values[name][0]))
                writer.writeheader()
                writer.writerows(values[name])
        (self.root / "summary.json").write_text(json.dumps(values["summary"]))
        (self.root / "returns_series.csv").write_text("ts_event_ns,native_return\n")
        events = values["events"] if "events" in values else order_events(values)
        if events is not None:
            with gzip.open(self.root / "order_events.jsonl.gz", "wt", encoding="utf-8") as stream:
                stream.writelines(json.dumps(event) + "\n" for event in events)
        return audit(self.root)

    def test_closed_native_economics_and_short_links_pass(self):
        for short in (False, True):
            value = self.check(reports(short=short))
            self.assertTrue(value["passed"], value["findings"])
            self.assertEqual(value["native_economics"]["reported_funding_usdt"], "1")
            self.assertEqual(value["native_economics"]["fill_commissions_usdt"], "2")
            self.assertIn("native report identity", value["scope"])

    def test_audit_refuses_warmup_submissions_despite_passing_strategy_self_check(self):
        values = reports()
        values["summary"].update(period_start_utc=ENTRY,
                                  trade_start_by_strategy={SCOPE["strategy_id"]: pd.Timestamp(ENTRY).value})
        result = self.check(values)
        self.assertEqual(codes(result), {"ORDER_BEFORE_TRADE_START"})
        self.assertEqual(len(result["findings"]), len(values["orders"]))
        values["events"] = order_events(values)
        for event in values["events"]:
            if event["type"] in {"OrderSubmitted", "OrderAccepted"}:
                event["ts_event"] = pd.Timestamp(ENTRY).value
        self.assertTrue(self.check(values)["passed"])  # initialization still happened in warm-up
        values["summary"].pop("trade_start_by_strategy")
        self.assertEqual(codes(self.check(values)), {"TRADE_START_INVALID"})

    def test_open_position_with_stop_and_staged_targets_passes(self):
        for short in (False, True):
            value = self.check(reports(open_position=True, short=short))
            self.assertTrue(value["passed"], value["findings"])
            self.assertIn("no position remains open", value["coverage_limits"][-1])

    def test_corrupt_order_fill_position_and_account_reports_are_rejected(self):
        changes = [
            (lambda x: x["orders"].append(copy.deepcopy(x["orders"][0])), "IDENTITY_MISSING_OR_DUPLICATED"),
            (lambda x: x["orders"][0].update(status="UNRECOGNIZED"), "ORDER_STATUS_UNKNOWN"),
            (lambda x: x["orders"][0].update(linked_order_ids="['missing']"), "ORDER_LINK_INVALID"),
            (lambda x: x["fills"][0].update(client_order_id="missing"), "ORDER_FILL_MISMATCH"),
            (lambda x: x["fills"][0].update(last_qty="2"), "ORDER_FILL_MISMATCH"),
            (lambda x: x["orders"][0].update(commissions="['2 USDT']"), "ORDER_FILL_MISMATCH"),
            (lambda x: x["positions"][0].update(events="[]"), "POSITION_FILL_COVERAGE_MISMATCH"),
            (lambda x: x["positions"][0].update(closing_order_id="missing"), "POSITION_FILL_COVERAGE_MISMATCH"),
            (lambda x: x["positions"][0].update(position_id=""), "IDENTITY_MISSING_OR_DUPLICATED"),
            (lambda x: x["positions"][0].update(buy_qty="2"), "POSITION_FILL_COVERAGE_MISMATCH"),
            (lambda x: x["positions"][0].update(commissions="['3 USDT']"), "POSITION_FILL_COVERAGE_MISMATCH"),
            (lambda x: x["positions"][0].update(adjustments=x["positions"][0]["adjustments"].replace("'R1-BTC'", "'R1-ETH'")),
             "FUNDING_BALANCE_MISMATCH"),
            (lambda x: x["positions"][0].update(adjustments=x["positions"][0]["adjustments"].replace("1 USDT", "2 USDT")),
             "FUNDING_BALANCE_MISMATCH"),
            (lambda x: x["positions"][0].update(adjustments="[]"), "FUNDING_BALANCE_MISMATCH"),
            (lambda x: x["account"][-1].update(total="100010", free="100010"), "SUMMARY_TOTALS_MISMATCH"),
            (lambda x: x["account"][-1].update(locked="1"), "ACCOUNT_REPORT_INCONSISTENT"),
            (lambda x: x["account"][-1].update(account_id="BINANCE-002"), "ACCOUNT_REPORT_INCONSISTENT"),
            (lambda x: x["summary"].update(final_equity_usdt="100010"), "SUMMARY_TOTALS_MISMATCH"),
            (lambda x: x["summary"].update(closed_trades=2), "SUMMARY_TOTALS_MISMATCH"),
            (lambda x: x["summary"].update(denied_orders=1), "DENIED_REJECTED_COUNT_MISMATCH"),
            (lambda x: x["fills"][0].update(last_px="nan-price"), "REPORT_PAYLOAD_INVALID"),
        ]
        for index, (change, code) in enumerate(changes):
            with self.subTest(index=index, code=code):
                values = reports()
                change(values)
                value = self.check(values)
                self.assertFalse(value["passed"])
                self.assertIn(code, codes(value))

    def test_missing_report_fields_are_an_audit_failure(self):
        values = reports()
        for row in values["fills"]:
            row.pop("event_id")
        value = self.check(values)
        self.assertFalse(value["passed"])
        self.assertEqual(codes(value), {"REPORT_FIELDS_MISSING"})

    def test_filled_status_requires_complete_quantity_but_canceled_partial_is_valid(self):
        values = reports()
        values["orders"][0]["quantity"] = "2"
        value = self.check(values)
        self.assertFalse(value["passed"])
        self.assertTrue(any(finding.startswith("ORDER_FILL_MISMATCH: FILLED order is not fully filled")
                            for finding in value["findings"]))
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
        self.assertTrue(any(finding.startswith("POSITION_FILL_COVERAGE_MISMATCH") and "out of time order" in finding
                            for finding in value["findings"]))

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
            self.assertIn("INTEGRITY_REPORTED_FAILED", codes(self.check(values)))

    def test_open_position_needs_its_stop_but_not_a_target(self):
        values = reports(open_position=True)
        values["summary"]["period_end_utc"] = "2026-01-01 01:00:00+00:00"
        values["orders"] = [row for row in values["orders"] if row["client_order_id"] not in ("first", "last")]
        value = self.check(values)
        self.assertTrue(value["passed"], value["findings"])
        values["orders"] = [row for row in values["orders"] if row["client_order_id"] != "stop"]
        value = self.check(values)
        self.assertFalse(value["passed"])
        interval, = value["uncovered_intervals"]
        self.assertTrue(interval["open_at_end"])

    def test_former_tier_variant_gets_the_same_generic_reconciliation(self):
        values = reports()
        values["summary"]["signal_variant"] = "support-broad-two-tier-4h"  # No sizing block.
        value = self.check(values)
        self.assertTrue(value["passed"], value["findings"])
        self.assertEqual(value["native_economics"]["fill_commissions_usdt"], "2")
        self.assertNotIn("native_bundles", value)

    def unprotected(self, delay="10min"):
        """A long position closed after its stop was canceled ``delay`` after entry."""
        values = reports()
        values["fills"][-1]["ts_event"] = str(pd.Timestamp(ENTRY) + pd.Timedelta("1h"))
        values["account"][-1]["ts_event"] = values["fills"][-1]["ts_event"]
        values["positions"][0]["events"] = repr(
            [{**value, "type": "OrderFilled", "ts_event": pd.Timestamp(value["ts_event"]).value}
             for value in values["fills"]])
        values["positions"][0]["ts_closed"] = values["fills"][-1]["ts_event"]
        values["summary"]["period_end_utc"] = values["fills"][-1]["ts_event"]
        events = order_events(values)
        for event in events:
            if event["client_order_id"] == "stop" and event["type"] == "OrderCanceled":
                event["ts_event"] = pd.Timestamp(ENTRY).value + pd.Timedelta(delay).value
        values["events"] = events
        return values

    def test_position_left_without_stop_longer_than_one_bar_is_refused(self):
        value = self.check(self.unprotected())
        self.assertFalse(value["passed"])
        self.assertEqual(len(value["findings"]), 1, value["findings"])
        finding = value["findings"][0]
        self.assertTrue(finding.startswith("UNPROTECTED_POSITION: "))
        for fact in ("BTCUSDT-PERP.BINANCE", "R1-BTC", "1 held with 0 reduce-only stop",
                     "2026-01-01T00:15:00+00:00", "2026-01-01T01:05:00+00:00", "'entry'", "'stop'"):
            self.assertIn(fact, finding)
        interval, = value["uncovered_intervals"]
        self.assertEqual((interval["position_quantity"], interval["stop_quantity"], interval["position_order_ids"],
                          interval["ended_stop_order_ids"], interval["open_at_end"]),
                         ("1", "0", ["entry"], ["stop"], False))

    def test_declared_stopless_source_reports_without_refusal(self):
        values = self.unprotected()
        values["summary"]["strategy_uses_stop_loss"] = False
        value = self.check(values)
        self.assertTrue(value["passed"], value["findings"])
        self.assertFalse(value["strategy_uses_stop_loss"])
        self.assertEqual(len(value["uncovered_intervals"]), 1)
        values["summary"]["strategy_uses_stop_loss"] = 0
        self.assertEqual(codes(self.check(values)), {"STOP_LOSS_DECLARATION_INVALID", "UNPROTECTED_POSITION"})

    def test_one_bar_without_stop_is_allowed(self):
        value = self.check(self.unprotected(delay="59min"))  # one one-minute bar before the exit fill
        self.assertTrue(value["passed"], value["findings"])
        self.assertEqual(value["uncovered_intervals"], [])
        self.assertEqual(codes(self.check(self.unprotected(delay="58min"))), {"UNPROTECTED_POSITION"})

    def test_missing_or_inconsistent_event_history_is_refused(self):
        values = reports()
        values["events"] = None
        self.assertEqual(codes(self.check(values)), {"ORDER_EVENT_HISTORY_MISSING"})
        for change, expected in (
                (lambda events: events.pop(), {"EVENT_ORDER_STATE_MISMATCH", "EVENT_FILL_MISMATCH"}),
                (lambda events: events[3].update(last_qty="0.5"), {"EVENT_ORDER_STATE_MISMATCH", "EVENT_FILL_MISMATCH"}),
                (lambda events: events.append({**events[-1], "type": "OrderExpired", "event_id": "late"}),
                 {"EVENT_ORDER_STATE_MISMATCH"}),
                (lambda events: events.append({**events[0], "client_order_id": "ghost"}), {"EVENT_ORDER_SET_MISMATCH"}),
                (lambda events: events.insert(1, dict(events[0])), {"EVENT_NOT_INITIALIZED"}),
                (lambda events: events[1].update(ts_event=events[1]["ts_event"] - 1), {"EVENT_OUT_OF_ORDER"}),
                (lambda events: events[1].update(strategy_id="R1-ETH"), {"EVENT_SCOPE_CHANGED"}),
                (lambda events: events.append({**events[-1], "type": "OrderMystery", "event_id": "odd"}),
                 {"REPORT_PAYLOAD_INVALID"})):
            with self.subTest(expected=expected):
                values = reports()
                values["events"] = order_events(values)
                change(values["events"])
                found = self.check(values)
                self.assertLessEqual(expected, codes(found))
                if expected == {"REPORT_PAYLOAD_INVALID"}:
                    self.assertTrue(any("EVENT_PAYLOAD_INVALID: unknown native order event type OrderMystery" in item
                                        for item in found["findings"]), found["findings"])

    def test_the_auditor_runs_only_on_complete_reports_and_lifecycle_counts_need_the_coverage_receipt(self):
        output = Path(self.directory.name) / "audit" / "audit.json"
        self.check(reports())
        self.assertIsNone(audit_main(self.root, output))
        values = reports()
        values["summary"]["per_coin"] = [{"instrument": SCOPE["instrument_id"], "counts": {"instrument_close": 1}}]
        values["coverage"] = None
        self.check(values)
        self.assertEqual(self.exit_code(output), 1)
        self.assertTrue(json.loads(output.read_text())["findings"][0].startswith("LIFECYCLE_COVERAGE_MISSING"))
        output.unlink()
        (self.root / "order_events.jsonl.gz").unlink()
        self.assertEqual(self.exit_code(output), 2)
        self.assertFalse(output.exists())

    def exit_code(self, output: Path) -> int:
        with self.assertRaises(SystemExit) as caught, contextlib.redirect_stderr(io.StringIO()):
            audit_main(self.root, output)
        return caught.exception.code


def codes(value) -> set[str]:
    """The finding codes of an audit result (every finding starts with its code)."""
    return {finding.split(":", 1)[0] for finding in value["findings"]}


class LifecycleAuditTests(unittest.TestCase):
    """A contract terminated without a settlement price must be flat with no working order before it."""

    COMMIT = "m" * 32

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name) / "reports"
        self.root.mkdir()

    def status(self, action, at):
        return {"type": "InstrumentStatus", "instrument_id": SCOPE["instrument_id"], "action": action,
                "ts_event": pd.Timestamp(at).value, "ts_init": pd.Timestamp(at).value, "reason": None,
                "trading_event": None, "is_trading": None, "is_quoting": None, "is_short_sell_restricted": None}

    def run_audit(self, events, counts=None, bundle="lifecycle-x", values=None, receipt_counts=None, last_bar=None,
                  **coverage):
        values = values or reports()
        counted = {"instrument_status": sum(item["type"] == "InstrumentStatus" for item in events),
                   "instrument_close": sum(item["type"] == "InstrumentClose" for item in events)}
        values["summary"].update(input_start_utc="2026-01-01T00:00:00Z", period_end_utc="2026-01-02T00:00:00Z",
                                 market_commit=self.COMMIT,
                                 per_coin=[{"instrument": SCOPE["instrument_id"], "counts": counts or counted}])
        ends = [item["ts_event"] for item in events if item.get("action") == "CLOSE" or item["type"] == "InstrumentClose"]
        last = pd.Timestamp(last_bar).value if last_bar else min(ends, default=pd.Timestamp("2026-01-02").value) - 1_000_000
        receipt = {"pieces": [{"index": None, "instrument_id": SCOPE["instrument_id"], "catalog_dir": "",
                               "counts": receipt_counts or counted, "last_bar_ns": last,
                               "episode": ({"symbol": "BTCUSDT", "instrument_id": SCOPE["instrument_id"], "start_ns": 0,
                                            "events": events, "sources": ["notice.txt"]} if bundle or events else None)}]}
        receipt_file = {"format": "execution-input-coverage-v1",
                        "membership": {"commit": self.COMMIT, "membership": {"BTCUSDT": [[0, 10**20]]}},
                        "effective_config": {"start": "2026-01-01T00:00:00Z", "trade_start": "2026-01-01T00:00:00Z",
                                             "end": "2026-01-02T00:00:00Z"},
                        "input_identity": {"market_commit": self.COMMIT, "lifecycle_bundle": bundle},
                        "export_receipts": {"BTCUSDT": receipt}, **coverage}
        values["coverage"] = receipt_file
        return NativeAuditTests.check(self, values)

    def test_flat_before_an_unpriced_termination_passes(self):
        value = self.run_audit([self.status("PRE_CLOSE", "2026-01-01 00:15:00+00:00"),
                                self.status("CLOSE", "2026-01-01 00:20:00+00:00")])
        self.assertTrue(value["passed"], value["findings"])

    def test_a_position_or_order_left_at_termination_and_late_events_are_refused(self):
        value = self.run_audit([self.status("CLOSE", "2026-01-01 00:08:00+00:00")])
        self.assertEqual(codes(value), {"POSITION_OPEN_AT_TERMINATION", "ORDER_OPEN_AT_TERMINATION"})
        self.assertTrue(any("position-1" in item for item in value["findings"]))
        # one finding per order: the stop and the exit were open, and their later events are named there
        opened = [item for item in value["findings"] if item.startswith("ORDER_OPEN_AT_TERMINATION")]
        self.assertEqual(len(opened), 2)
        self.assertTrue(all("at or after it" in item for item in opened))

    def late_order(self, values, identity="late", at="2026-01-01 00:30:00+00:00"):
        """An order placed (and rejected by the closed market) after the termination."""
        values["orders"].append(order(identity, "BUY", "MARKET", status="REJECTED", ts_init=str(pd.Timestamp(at).value)))
        values["summary"]["rejected_orders"] = 1
        values["summary"]["integrity_passed"] = False
        return values

    def test_an_order_created_after_a_termination_is_late_with_or_without_a_price(self):
        close = self.close("2026-01-01 00:20:00+00:00")
        for events in ([self.status("CLOSE", "2026-01-01 00:20:00+00:00")],
                       [self.status("CLOSE", "2026-01-01 00:20:00+00:00"), close]):
            with self.subTest(priced=len(events) == 2):
                value = self.run_audit(events, values=self.late_order(reports()))
                late = [item for item in value["findings"] if item.startswith("LATE_ORDER_EVENT")]
                self.assertEqual(len(late), 1, value["findings"])
                self.assertIn("order late created at 2026-01-01T00:30:00+00:00", late[0])

    def test_the_engines_expiration_order_at_a_settlement_is_not_late(self):
        values = self.late_order(reports(), "EXPIRATION-BINANCE-1", "2026-01-01 00:20:00+00:00")
        values["orders"][-1].update(status="ACCEPTED", is_reduce_only="True")
        values["summary"].update(rejected_orders=0, integrity_passed=True)
        close = self.close("2026-01-01 00:20:00+00:00")
        value = self.run_audit([self.status("CLOSE", "2026-01-01 00:20:00+00:00"), close], values=values)
        self.assertTrue(value["passed"], value["findings"])
        unpriced = self.run_audit([self.status("CLOSE", "2026-01-01 00:20:00+00:00")], values=values)
        self.assertIn("LATE_ORDER_EVENT", codes(unpriced))

    def test_bars_that_stop_before_the_window_end_need_a_termination(self):
        self.assertTrue(self.run_audit([], bundle=None)["passed"])  # bars to the window's end
        early = self.run_audit([], bundle=None, last_bar="2026-01-01 18:00:00+00:00")
        self.assertEqual(codes(early), {"DATA_ENDS_WITHOUT_TERMINATION"})
        self.assertIn("the window end is 2026-01-02T00:00:00+00:00", early["findings"][0])
        # a trailing hole within the MARK carry limit is a hole, not an end
        self.assertTrue(self.run_audit([], bundle=None, last_bar="2026-01-01 23:30:00+00:00")["passed"])
        terminated = [self.status("CLOSE", "2026-01-01 18:20:00+00:00")]
        self.assertTrue(self.run_audit(terminated, last_bar="2026-01-01 18:00:00+00:00")["passed"])
        stopped = self.run_audit(terminated, last_bar="2026-01-01 12:00:00+00:00")
        self.assertEqual(codes(stopped), {"DATA_ENDS_WITHOUT_TERMINATION"})
        self.assertIn("the termination is 2026-01-01T18:20:00+00:00", stopped["findings"][0])

    def close(self, at):
        return {"type": "InstrumentClose", "instrument_id": SCOPE["instrument_id"], "close_price": "105",
                "close_type": "CONTRACT_EXPIRED", "ts_event": pd.Timestamp(at).value, "ts_init": pd.Timestamp(at).value}

    def test_a_settlement_price_leaves_the_termination_to_the_engine(self):
        close = {"type": "InstrumentClose", "instrument_id": SCOPE["instrument_id"], "close_price": "105",
                 "close_type": "CONTRACT_EXPIRED", "ts_event": pd.Timestamp("2026-01-01 00:08:00+00:00").value,
                 "ts_init": pd.Timestamp("2026-01-01 00:08:00+00:00").value}
        value = self.run_audit([self.status("CLOSE", "2026-01-01 00:08:00+00:00"), close])
        self.assertTrue(value["passed"], value["findings"])

    def test_evidence_that_does_not_reconcile_is_not_replayed(self):
        values = reports()
        values["positions"][0]["events"] = "[]"
        value = self.run_audit([self.status("CLOSE", "2026-01-01 00:20:00+00:00")], values=values)
        self.assertIn("LIFECYCLE_EVIDENCE_INCONSISTENT", codes(value))
        self.assertNotIn("POSITION_OPEN_AT_TERMINATION", codes(value))

    def test_the_lifecycle_events_must_agree_with_the_receipt_and_the_summary(self):
        close = self.status("CLOSE", "2026-01-01 00:20:00+00:00")
        cases = [
            ({"counts": {"instrument_status": 2, "instrument_close": 0}}, "LIFECYCLE_COUNT_MISMATCH"),
            ({"receipt_counts": {"instrument_status": 2}, "counts": {"instrument_status": 2}},
             "LIFECYCLE_COUNT_MISMATCH"),
            ({"counts": {"instrument_status": -1}}, "LIFECYCLE_NATIVE_COUNT_INVALID"),
            ({"bundle": None}, "LIFECYCLE_BUNDLE_MISSING"),
            ({"format": "other"}, "LIFECYCLE_COVERAGE_MISMATCH"),
            ({"effective_config": {"start": "2026-01-01T00:00:00Z", "end": "2026-01-03T00:00:00Z"}},
             "LIFECYCLE_COVERAGE_MISMATCH"),
        ]
        for options, code in cases:
            with self.subTest(code=code, options=options):
                expected = {code, "TRADE_START_INVALID"} if "effective_config" in options else {code}
                if any(key in options for key in ("effective_config", "bundle", "format")):
                    expected.add("ENTRY_SCOPE_INVALID")
                self.assertEqual(codes(self.run_audit([close], **options)), expected)
        self.assertEqual(codes(self.run_audit([close, dict(close)])), {"LIFECYCLE_DUPLICATE_EVENT"})
        self.assertEqual(codes(self.run_audit([{**close, "ts_init": close["ts_init"] + 1}])),
                         {"LIFECYCLE_EVENT_INVALID", "ENTRY_SCOPE_INVALID"})
        self.assertEqual(codes(self.run_audit([{**close, "type": "InstrumentHalt"}])),
                         {"LIFECYCLE_EVENT_INVALID", "ENTRY_SCOPE_INVALID"})


def event(kind, identity, at, **fields):
    return {"type": kind, "client_order_id": identity, "strategy_id": "S", "instrument_id": "AAA",
            "ts_event": at, **fields}


def placed(identity, at, side, kind, quantity, reduce_only):
    return [event("OrderInitialized", identity, at, order_side=side, order_type=kind, quantity=quantity,
                  reduce_only=reduce_only),
            event("OrderSubmitted", identity, at), event("OrderAccepted", identity, at)]


def filled(identity, at, side, quantity):
    return event("OrderFilled", identity, at, order_side=side, last_qty=quantity, position_id="P")


class UncoveredIntervalTests(unittest.TestCase):
    def test_partial_entry_after_expired_parent_and_canceled_child(self):
        events = [*placed("entry", 0, "BUY", "LIMIT", "16.339", False),
                  event("OrderInitialized", "stop", 0, order_side="SELL", order_type="STOP_MARKET",
                        quantity="16.339", reduce_only=True),
                  event("OrderSubmitted", "stop", 0), filled("entry", 5, "BUY", "0.250"),
                  event("OrderAccepted", "stop", 5), event("OrderExpired", "entry", 100),
                  event("OrderCanceled", "stop", 100)]
        interval, = uncovered_intervals(events, 100 + 2 * BAR_NS)
        self.assertEqual((interval["start_ns"], interval["end_ns"], interval["open_at_end"],
                          interval["position_quantity"], interval["ended_stop_order_ids"]),
                         (100, 100 + 2 * BAR_NS, True, "0.250", ["stop"]))
        protected = events + placed("reprotect", 100, "SELL", "STOP_MARKET", "0.250", True)
        self.assertEqual(uncovered_intervals(protected, 100 + 2 * BAR_NS), [])

    def test_only_working_reduce_only_stops_on_the_closing_side_cover(self):
        entry = [*placed("entry", 0, "SELL", "MARKET", "2", False), filled("entry", 0, "SELL", "2")]
        for name, protection in (("plain stop", placed("x", 0, "BUY", "STOP_MARKET", "2", False)),
                                 ("wrong side", placed("x", 0, "SELL", "STOP_MARKET", "2", True)),
                                 ("target", placed("x", 0, "BUY", "LIMIT", "2", True)),
                                 ("too small", placed("x", 0, "BUY", "STOP_MARKET", "1.5", True)),
                                 ("not accepted", placed("x", 0, "BUY", "STOP_MARKET", "2", True)[:2])):
            with self.subTest(name=name):
                self.assertEqual(len(uncovered_intervals(entry + protection, 2 * BAR_NS)), 1)
        covered = entry + placed("x", 0, "BUY", "TRAILING_STOP_MARKET", "1", True) + placed(
            "y", 0, "BUY", "STOP_LIMIT", "1", True)
        self.assertEqual(uncovered_intervals(covered, 2 * BAR_NS), [])

    def test_growth_beyond_the_stop_and_a_shrunk_stop_are_uncovered(self):
        base = [*placed("entry", 0, "BUY", "LIMIT", "2", False), filled("entry", 0, "BUY", "1"),
                *placed("stop", 0, "SELL", "STOP_MARKET", "1", True)]
        grown = base + [filled("entry", 10, "BUY", "1")]
        interval, = uncovered_intervals(grown, 10 + BAR_NS + 1)
        self.assertEqual((interval["start_ns"], interval["position_quantity"], interval["stop_quantity"],
                          interval["ended_stop_order_ids"]), (10, "2", "1", []))
        self.assertEqual(uncovered_intervals(grown, 10 + BAR_NS), [])
        shrunk = base + [event("OrderUpdated", "stop", 10, quantity="0.5")]
        self.assertEqual(len(uncovered_intervals(shrunk, 10 + BAR_NS + 1)), 1)


if __name__ == "__main__":
    unittest.main()
