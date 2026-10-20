"""The sealed single-run report and its parts, on small native report sets: reconciliations that empty
only their own metric, the bar-close mark-equity path, daily series and the position-cycle rows."""

from __future__ import annotations

from decimal import Decimal
import subprocess
import tempfile
import unittest
from pathlib import Path

from ledger import metrics
from ledger.errors import Refusal


DAY = 86_400 * 10**9
JAN = 1_767_225_600 * 10**9  # 2026-01-01T00:00:00Z
LABEL = DAY - 1_000_000  # bars are stamped 1 ms before each boundary
IID = "AAAUSDT-PERP.BINANCE"


def iso(ns: int) -> str:
    from datetime import UTC, datetime
    return datetime.fromtimestamp(ns // 10**9, UTC).strftime("%Y-%m-%d %H:%M:%S.%f+00:00")


def fill(order: str, side: str, px: str, ts: int, event: str, liquidity: str = "MAKER") -> dict:
    return {"client_order_id": order, "instrument_id": IID, "order_side": side, "last_qty": "1", "last_px": px,
            "liquidity_side": liquidity, "event_id": event, "ts_event": iso(ts), "commission": "0.10000000 USDT"}


def order(order_id: str, side: str, ts_init: int, ts_last: int, plan: str | None, parent: str = "",
          kind: str = "LIMIT", status: str = "FILLED", extra_tags: tuple = ()) -> dict:
    tags = ([plan] if plan else []) + list(extra_tags)
    return {"client_order_id": order_id, "instrument_id": IID, "side": side, "type": kind, "status": status,
            "filled_qty": "1" if status == "FILLED" else "0", "ts_init": str(ts_init), "ts_last": str(ts_last),
            "tags": repr(tags), "parent_order_id": parent, "is_reduce_only": "True" if parent else "False"}


def position(pid: str, fills: list[dict], closed: bool, realized: str, opening: str, closing: str) -> dict:
    events = [{"event_id": f["event_id"], "order_side": f["order_side"], "last_qty": f["last_qty"],
               "last_px": f["last_px"], "ts_event": metrics.utc_ns(f["ts_event"])} for f in fills]
    last = max(event["ts_event"] for event in events)
    return {"position_id": pid, "events": repr(events), "adjustments": "[]", "instrument_id": IID,
            "opening_order_id": opening, "closing_order_id": closing if closed else "", "entry": fills[0]["order_side"],
            "side": "FLAT" if closed else "LONG", "multiplier": "1", "is_inverse": "False",
            "ts_opened": iso(events[0]["ts_event"]), "ts_last": str(last), "ts_closed": iso(last) if closed else "",
            "realized_pnl": f"{realized} USDT", "commissions": repr([f"{Decimal('0.1') * len(fills):.8f} USDT"]),
            "is_snapshot": "True" if closed else "False"}


def native() -> metrics.Reports:
    """Four daily bars from 2026-01-01: a long closed on day 1 (+9.8), then a long opened on day 2 and
    still open at the end, marked +100, -400 and -200 at the day-2, day-3 and day-4 bar closes."""
    hour = 3_600 * 10**9
    fills = [fill("O-1", "BUY", "100", JAN + hour, "E-1"), fill("O-2", "SELL", "110", JAN + 2 * hour, "E-2", "TAKER"),
             fill("O-3", "BUY", "100", JAN + DAY + hour, "E-3")]
    orders = [order("O-1", "BUY", JAN, JAN + hour, "plan:a"),
              order("O-2", "SELL", JAN, JAN + 2 * hour, "plan:a", parent="O-1", extra_tags=("exit:target",)),
              order("O-3", "BUY", JAN + DAY, JAN + DAY + hour, "plan:b"),
              order("O-4", "SELL", JAN + DAY, JAN + DAY + hour, "plan:b", parent="O-3", kind="STOP_MARKET",
                    status="ACCEPTED")]
    positions = [position(f"{IID}-P-1", fills[:2], True, "9.80000000", "O-1", "O-2"),
                 position(f"{IID}-P", fills[2:], False, "-0.10000000", "O-3", "")]
    account = [{"ts_event": iso(JAN), "total": "100000.00000000", "locked": "0"},
               {"ts_event": iso(JAN + 2 * hour), "total": "100009.80000000", "locked": "0"},
               {"ts_event": iso(JAN + DAY + hour), "total": "100009.70000000", "locked": "100.00000000"}]
    exposures = [{"ts_event_ns": str(JAN + day * DAY + LABEL), "position_id": f"{IID}-P", "notional_value": f"{notional} USDT",
                  "unrealized_pnl": f"{unrealized} USDT"}
                 for day, notional, unrealized in ((1, "1100", "100"), (2, "600", "-400"), (3, "800", "-200"))]
    final = Decimal("100009.70000000") - 200
    returns = [(JAN, 0.000098), (JAN + DAY, float(Decimal("100109.7") / Decimal("100009.8") - 1)),
               (JAN + 2 * DAY, float(Decimal("99609.7") / Decimal("100109.7") - 1)),
               (JAN + 3 * DAY, float(final / Decimal("99609.7") - 1))]
    summary = {"starting_balance_usdt": "100000", "final_equity_usdt": str(final), "closed_trades": 1,
               "data_interval_minutes": 1440, "input_start_utc": "2026-01-01T00:00:00Z",
               "period_start_utc": "2026-01-01T00:00:00Z", "period_end_utc": "2026-01-05T00:00:00Z"}
    audit = {"passed": True, "findings": [], "native_economics": {
        "reported_realized_pnl_usdt": "9.70000000", "fill_commissions_usdt": "0.30000000",
        "reported_funding_usdt": "0", "final_balance_usdt": "100009.70000000"}}
    return metrics.Reports(summary=summary, audit=audit, orders=orders, fills=fills, positions=positions,
                           account=account, returns=returns, exposures=exposures, order_events=[])


def report(reports: metrics.Reports) -> dict:
    return metrics.metrics(reports, revision="0" * 40)


class SealedReportTests(unittest.TestCase):
    def test_the_bar_close_mark_path_gives_drawdown_capital_and_the_daily_notional(self):
        sealed = report(native())
        drawdown, capital = sealed["drawdown"], sealed["capital"]
        self.assertAlmostEqual(drawdown["mark_max_drawdown@2"]["value"], float(Decimal(500) / Decimal("100109.7")))
        self.assertEqual((drawdown["peak_utc@2"]["value"], drawdown["trough_utc@2"]["value"]),
                         ("2026-01-02T23:59", "2026-01-03T23:59"))
        self.assertEqual(drawdown["duration_days@2"]["value"], 1.0)
        self.assertEqual((drawdown["top_instrument@2"]["value"], drawdown["top_instrument_share_in_drawdown@2"]["value"]),
                         (IID, 1.0))
        self.assertEqual((capital["peak_gross_notional@1"]["value"], capital["peak_utc@1"]["value"]),
                         ("1100.00000000", "2026-01-02T23:59"))
        self.assertEqual(capital["time_in_market@1"]["value"], 0.75)
        self.assertEqual(capital["peak_locked_margin@1"]["value"], "100.00000000")
        self.assertEqual(sealed["fees_by_liquidity_side@2"]["TAKER"], {"commissions": "0.10000000",
                                                                      "notional": "110.00000000", "fills": 1})
        self.assertEqual(sealed["order_funnel@1"], {"FILLED": 2})
        self.assertEqual(sealed["populations"], {"fills": 3, "cycles": 2, "bars": 4, "days": 4})
        self.assertTrue(all(fact["passed"] for fact in sealed["activity"].values()), sealed["activity"])
        self.assertEqual((sealed["plans_valid@1"]["passed"], sealed["limitations"]), (True, []))
        daily = metrics.daily_rows(native())
        self.assertEqual([mean for _, _, mean in daily], [Decimal(0), Decimal(1100), Decimal(600), Decimal(800)])

    def test_a_failed_reconciliation_empties_only_its_own_metric(self):
        untagged = native()
        untagged.orders[3]["tags"] = "[]"
        sealed = report(untagged)
        self.assertEqual(sealed["plans_valid@1"], {"passed": False, "code": "PLAN_TAG_MISSING", "untagged_orders": 1})
        self.assertIsNotNone(sealed["drawdown"])
        self.assertTrue(any(item.startswith("PLAN_TAG_MISSING") for item in sealed["limitations"]))
        off_grid = native()
        off_grid.exposures[0]["ts_event_ns"] = str(JAN + DAY + 7)
        sealed = report(off_grid)
        self.assertEqual((sealed["drawdown"], sealed["capital"]), (None, None))
        self.assertTrue(any(item.startswith("EXPOSURE_GRID_MISMATCH") for item in sealed["limitations"]))
        self.assertEqual(sealed["plans_valid@1"]["passed"], True)
        broken = native()
        broken.positions[0]["realized_pnl"] = "9.00000000 USDT"
        sealed = report(broken)
        self.assertEqual(sealed["activity"]["cycles_reconcile_audit@1"]["code"], "CYCLE_IDENTITY_FAILED")
        self.assertTrue(sealed["activity"]["cycles_cover_fills@1"]["passed"])
        missing = native()
        missing.exposures = None
        self.assertTrue(any(item.startswith("EXPOSURE_REPORT_MISSING") for item in report(missing)["limitations"]))

    def test_plans_follow_the_plan_contract(self):
        cases = []
        doubled = native()
        doubled.orders[0]["tags"] = repr(["plan:a", "plan:c"])
        cases.append((doubled, "PLAN_TAG_MULTIPLE"))
        shared = native()
        shared.orders[2]["tags"] = shared.orders[3]["tags"] = repr(["plan:a"])
        cases.append((shared, "PLAN_MULTI_CYCLE"))
        overlap = native()
        overlap.orders[2]["ts_init"] = overlap.orders[3]["ts_init"] = str(JAN + 1)
        cases.append((overlap, "PLAN_OVERLAP"))
        mixed = native()
        mixed.orders[1]["tags"] = repr(["plan:z"])
        cases.append((mixed, "CYCLE_MULTI_PLAN"))
        for reports, code in cases:
            with self.subTest(code=code):
                self.assertEqual(report(reports)["plans_valid@1"]["code"], code)
        reports = native()
        found = metrics.cycles(reports.positions, reports.fills)
        self.assertEqual(metrics.plan_metrics(reports.orders, reports.fills, reports.positions, found, [], ()),
                         {"closed": 1, "wins": 1, "open": 1, "win_rate": 0.5})

    def test_cycles_cover_every_fill_once_and_stay_linear_usdt(self):
        uncovered = native()
        uncovered.fills.append(fill("O-9", "BUY", "1", JAN + 5, "E-9"))
        self.assertEqual(report(uncovered)["activity"]["cycles_cover_fills@1"]["code"], "FILL_COVERAGE_MISMATCH")
        for change, code in ((("is_inverse", "True"), "UNSUPPORTED_INSTRUMENT"),
                             (("realized_pnl", "9.8 BTC"), "NON_USDT_MONEY"),
                             (("adjustments", repr([{"adjustment_type": "TRANSFER", "quantity_change": None}])),
                              "UNSUPPORTED_ADJUSTMENT")):
            reports = native()
            reports.positions[0][change[0]] = change[1]
            with self.subTest(code=code), self.assertRaises(metrics.Unreconciled) as caught:
                metrics.cycles(reports.positions, reports.fills)
            self.assertEqual(caught.exception.code, code)

    def test_daily_returns_must_cover_each_day_and_compound_to_final_equity(self):
        reports = native()
        limitations = []
        self.assertEqual(len(metrics.daily_returns(reports.returns, reports.summary, limitations)), 4)
        gap = [item for index, item in enumerate(reports.returns) if index != 2]
        self.assertIsNone(metrics.daily_returns(gap, reports.summary, limitations))
        drift = [(ts, value + 0.001) for ts, value in reports.returns]
        self.assertIsNone(metrics.daily_returns(drift, reports.summary, limitations))
        self.assertEqual([item.split(":")[0] for item in limitations], ["RETURN_CLOCK_GAP", "RETURN_COMPOUNDING_MISMATCH"])
        drift_report = native()
        drift_report.returns = drift
        self.assertEqual(report(drift_report)["activity"]["returns_compound_to_equity@1"]["passed"], False)

    def test_cycle_rows_record_open_marks_and_the_closing_order(self):
        reports = native()
        rows = metrics.cycle_rows(reports, metrics.cycles(reports.positions, reports.fills))
        closed, opened = rows
        self.assertEqual((closed["ts_closed_ns"], closed["realized_pnl"], closed["open_unrealized"],
                          closed["closing_order_type"], closed["closing_order_tag"], closed["plan_tag"]),
                         (JAN + 7_200 * 10**9, Decimal("9.8"), None, "LIMIT", "exit:target", "plan:a"))
        self.assertEqual((opened["ts_closed_ns"], opened["realized_pnl"], opened["open_unrealized"], opened["side"]),
                         (None, None, Decimal(-200), "long"))

    def test_metrics_need_readable_reports(self):
        with tempfile.TemporaryDirectory() as directory:
            reports = Path(directory) / "reports"
            reports.mkdir()
            (reports / "exposures.csv.gz").write_bytes(b"not gzip")
            with self.assertRaises(Refusal) as caught:
                metrics.load_directory(Path(directory))
            self.assertEqual(caught.exception.code, "REPORT_UNREADABLE")

    def test_only_regular_files_and_the_audit_directory_count(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "reports").mkdir()
            (root / "audit").mkdir()
            outside = root / "elsewhere.csv"
            outside.write_text("client_order_id\nO-1\n")
            (root / "reports" / "orders.csv").symlink_to(outside)
            (root / "reports" / "audit.json").write_text('{"passed": true}')
            loaded = metrics.load_directory(root)
            self.assertEqual((loaded.orders, loaded.audit, "orders.csv" in loaded.present), ([], None, False))
            (root / "audit" / "audit.json").write_text('{"passed": false}')
            self.assertEqual(metrics.load_directory(root).audit, {"passed": False})

    def test_the_metrics_revision_is_the_checkout_head_whatever_the_work_tree_holds(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with self.assertRaises(Refusal) as caught:
                metrics.metrics_revision(root)
            self.assertEqual(caught.exception.code, "NOT_A_CHECKOUT")
            env = {"GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@x.invalid", "GIT_COMMITTER_NAME": "t",
                   "GIT_COMMITTER_EMAIL": "t@x.invalid", "GIT_CONFIG_GLOBAL": "/dev/null", "PATH": "/usr/bin:/bin"}
            for argv in (["init", "-q"], ["commit", "-q", "--allow-empty", "-m", "c"]):
                subprocess.run(["git", *argv], cwd=root, env=env, check=True, capture_output=True)
            head = subprocess.run(["git", "rev-parse", "HEAD"], cwd=root, capture_output=True, text=True).stdout.strip()
            self.assertEqual(metrics.metrics_revision(root), head)
            (root / "uncommitted.py").write_text("changed = True\n")
            self.assertEqual(metrics.metrics_revision(root), head)


class MarkEquityTests(unittest.TestCase):
    SUMMARY = {"starting_balance_usdt": "100000", "data_interval_minutes": 1440,
               "period_start_utc": "2026-01-01T00:00:00Z", "period_end_utc": "2026-01-04T00:00:00Z"}

    def test_equity_at_a_label_never_reads_a_later_account_row(self):
        """A long marked +100 at the day-1 close and closed an hour into day 2 for +100: the bar-close
        equity is 100000 -> 100100 -> 100100, never the +200 of pairing the day-1 mark with the day-2 close."""
        account = [{"ts_event": iso(JAN), "total": "100000"},
                   {"ts_event": iso(JAN + DAY + 3_600 * 10**9), "total": "100100"}]
        exposures = [{"ts_event_ns": JAN + LABEL, "position_id": "P", "notional_value": Decimal(1000),
                      "unrealized_pnl": Decimal(100)}]
        path = metrics.equity_path(self.SUMMARY, account, exposures)
        self.assertEqual([point["equity"] for point in path], [Decimal(100100), Decimal(100100), Decimal(100100)])
        self.assertEqual(metrics.mark_drawdown(self.SUMMARY, account, exposures, path)["max_drawdown"], 0.0)

    def test_account_rows_tied_on_time_keep_report_order(self):
        account = [{"ts_event": iso(JAN), "total": "100000", "locked": "0"},
                   {"ts_event": iso(JAN + 3_600 * 10**9), "total": "100050", "locked": "0"},
                   {"ts_event": iso(JAN + 3_600 * 10**9), "total": "99990", "locked": "0"}]
        path = metrics.equity_path(self.SUMMARY, account, [])
        self.assertEqual(path[0]["equity"], Decimal(99990))
        reports = native()
        reports.account = [*reports.account, {**reports.account[-1], "total": "100020.00000000"},
                           {**reports.account[-1]}]
        self.assertTrue(report(reports)["activity"]["account_endpoints_match@2"]["passed"])


class FeeAndPlanTests(unittest.TestCase):
    def test_fee_notional_includes_the_contract_multiplier(self):
        reports = native()
        for row in reports.positions:
            row["multiplier"] = "10"
        self.assertEqual(report(reports)["fees_by_liquidity_side@2"]["TAKER"]["notional"], "1100.00000000")

    def test_a_plan_tag_longer_than_its_column_fails_plan_validity(self):
        reports = native()
        long = "plan:" + "x" * 200
        reports.orders[0]["tags"] = reports.orders[1]["tags"] = repr([long])
        sealed = report(reports)
        self.assertEqual(sealed["plans_valid@1"]["code"], "PLAN_TAG_TOO_LONG")
        self.assertTrue(any(item.startswith("PLAN_TAG_TOO_LONG") for item in sealed["limitations"]))
        rows = metrics.cycle_rows(reports, metrics.cycles(reports.positions, reports.fills))
        self.assertIsNone(rows[0]["plan_tag"])


if __name__ == "__main__":
    unittest.main()
