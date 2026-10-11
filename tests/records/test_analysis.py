"""Reconciled native economics and paired analysis over small synthetic native seals."""

import copy
import csv
import gzip
import io
import json
import math
import os
import tempfile
import unittest
from collections import Counter
from contextlib import redirect_stderr, redirect_stdout
from decimal import Decimal
from pathlib import Path
from unittest.mock import patch

import pandas as pd

from research.records import analysis
from research.records.common import RecordError


AAA, BBB = "AAAUSDT-PERP.BINANCE", "BBBUSDT-PERP.BINANCE"
DAY = 86_400_000_000_000
START_NS = 1_767_225_600_000_000_000  # 2026-01-01T00:00:00Z
WINDOW_RETURNS = [0.01, -0.02, 0.005, 0.0, 0.003, 0.004]
POSITION_COLUMNS = ["position_id", "instrument_id", "entry", "multiplier", "is_inverse", "ts_closed",
                    "realized_pnl", "commissions", "adjustments", "events", "ts_last", "closing_order_id"]
CLOSE_NS = 1_767_571_200_000_000_000  # 2026-01-05T00:00:00Z


def _event(event_id, side, qty, px, commission):
    return {"event_id": event_id, "order_side": side, "last_qty": qty, "last_px": px,
            "commission": f"{commission} USDT"}


def _funding(amount):
    return {"adjustment_type": "FUNDING", "quantity_change": None, "pnl_change": f"{amount} USDT"}


# Closed long AAA: two entries and one exit, funding received. Closed long BBB: funding paid.
# Open long BBB: realized PnL is only its entry commission and funding.
CYCLES = [
    {"position_id": "AAA-1", "instrument_id": AAA, "closed": True, "realized": "12.38900000", "funding": ["0.50000000"],
     "events": [_event("e1", "BUY", "1", "100", "0.02000000"), _event("e2", "BUY", "1", "98", "0.04900000"),
                _event("e3", "SELL", "2", "105", "0.04200000")]},
    {"position_id": "BBB-1", "instrument_id": BBB, "closed": True, "realized": "-5.14750000", "funding": ["-0.10000000"],
     "events": [_event("e4", "BUY", "1", "50", "0.02500000"), _event("e5", "SELL", "1", "45", "0.02250000")]},
    {"position_id": "BBB-2", "instrument_id": BBB, "closed": False, "realized": "0.04080000", "funding": ["0.05000000"],
     "events": [_event("e6", "BUY", "1", "46", "0.00920000")]},
]


def _csv(columns, rows):
    stream = io.StringIO()
    writer = csv.writer(stream, lineterminator="\n")
    writer.writerow(columns)
    writer.writerows(rows)
    return stream.getvalue()


def _seal(root: Path, run_id: str, *, cycles=CYCLES, window=WINDOW_RETURNS, economics=True,
          economics_override=None, final_equity=None, orders=",status,expire_time_ns\n",
          exposures=None, fill_orders=None) -> Path:
    seal = root / run_id
    reports = seal / "reports"
    reports.mkdir(parents=True)
    events = [event for cycle in cycles for event in cycle["events"]]
    positions = [[cycle["position_id"], cycle["instrument_id"], "BUY", "1", "False",
                  "2026-01-05 00:00:00+00:00" if cycle["closed"] else "", f"{cycle['realized']} USDT",
                  repr([event["commission"] for event in cycle["events"]]),
                  repr([_funding(amount) for amount in cycle["funding"]]), repr(cycle["events"]),
                  str(cycle.get("ts_last", CLOSE_NS)), f"{cycle['position_id']}-exit" if cycle["closed"] else ""]
                 for cycle in cycles]
    (reports / "positions.csv").write_text(_csv(POSITION_COLUMNS, positions) if cycles
                                           else ",ts_closed,realized_pnl,instrument_id\n")
    (reports / "fills.csv").write_text(
        _csv(["event_id", "commission", "client_order_id"],
             [[event["event_id"], event["commission"], (fill_orders or {}).get(event["event_id"], "")]
              for event in events])
        if events else ",client_order_id\n")
    (reports / "orders.csv").write_text(orders)
    if exposures is not None:
        (reports / "exposures.csv.gz").write_bytes(gzip.compress(
            _csv(["ts_event_ns", "position_id", "notional_value", "unrealized_pnl"], exposures).encode(), mtime=0))
    (reports / "account.csv").write_text("ts_event,total,currency\n2026-01-01,1000,USDT\n")
    returns = [(START_NS + day * DAY, 0.0) for day in range(2)]
    returns += [(START_NS + (day + 2) * DAY, value) for day, value in enumerate(window)]
    (reports / "returns_series.csv").write_text(
        _csv(["ts_event_ns", "native_return"], [[ts, repr(value)] for ts, value in returns]))
    realized = sum((Decimal(cycle["realized"]) for cycle in cycles), Decimal(0))
    commissions = sum((Decimal(event["commission"].split()[0]) for event in events), Decimal(0))
    funding = sum((Decimal(amount) for cycle in cycles for amount in cycle["funding"]), Decimal(0))
    growth = math.prod(1 + value for value in window)
    final_equity = final_equity or format((1000 * Decimal(repr(growth))).quantize(Decimal("0.00000001")), "f")
    summary = {"input_start_utc": "2026-01-01T00:00:00+00:00", "period_start_utc": "2026-01-03T00:00:00+00:00",
               "period_end_utc": "2026-01-09T00:00:00+00:00", "data_interval_minutes": 1440,
               "starting_balance_usdt": "1000",
               "final_equity_usdt": final_equity, "closed_trades": sum(cycle["closed"] for cycle in cycles),
               "integrity_passed": True, "limitations": ["fixture limitation"]}
    native = {"starting_balance_usdt": "1000.00000000", "final_balance_usdt": str(1000 + realized),
              "reported_realized_pnl_usdt": str(realized), "fill_commissions_usdt": str(commissions),
              "funding_adjustments": sum(len(cycle["funding"]) for cycle in cycles),
              "reported_funding_usdt": str(funding), **(economics_override or {})}
    audit = {"passed": True, "findings": [], "coverage_limits": ["fixture coverage"],
             **({"native_economics": native} if economics else {})}
    (reports / "summary.json").write_text(json.dumps(summary))
    (reports / "audit.json").write_text(json.dumps(audit))
    return seal


def _report(root: Path, run_id: str) -> dict:
    """The readings of one report directory, flattened like the run row's columns."""
    output = analysis.readings(analysis.load_dir(root / run_id / "reports"))
    return {**(output["economics"] or dict.fromkeys(analysis._ECONOMICS)), "plans": output["plans"],
            "max_drawdown": output["max_drawdown"], "limitations": output["limitations"]}


def _tables(root: Path, run_id: str, *, account=False, exposures=False) -> dict:
    return analysis.build_tables(analysis.load_dir(root / run_id / "reports"), run_id=run_id, ledger_commit=None,
                                 account=account, exposures=exposures)


class SingleRunReportTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)

    def test_closed_decomposition_and_residual_reconcile_to_native_facts(self):
        _seal(self.root, "R1")
        result = _report(self.root, "R1")
        self.assertEqual(result["closed"], {
            "reported_realized_pnl_usdt": "7.24150000", "fill_commissions_usdt": "0.15850000",
            "reported_funding_usdt": "0.40000000", "price_pnl_usdt": "7.00000000"})
        self.assertEqual((result["closed_trades"], result["open_positions"]), (2, 1))
        audit = json.loads((self.root / "R1/reports/audit.json").read_text())
        final_balance = Decimal(audit["native_economics"]["final_balance_usdt"])
        self.assertEqual(Decimal(result["unrealized_residual_usdt"]) + final_balance,
                         Decimal(json.loads((self.root / "R1/reports/summary.json").read_text())["final_equity_usdt"]))
        self.assertIn("fixture limitation", result["limitations"])
        self.assertIn("fixture coverage", result["limitations"])

    def test_closed_cycles_split_by_the_utc_year_they_closed_in(self):
        cycles = copy.deepcopy(CYCLES)
        cycles[0]["ts_last"] = START_NS - 1  # closes at the last nanosecond of 2025
        cycles[1]["ts_last"] = START_NS  # closes at 2026-01-01T00:00:00Z
        _seal(self.root, "R1", cycles=cycles)
        result = _report(self.root, "R1")
        self.assertEqual(result["closed_by_year"], {
            "2025": {"closed_trades": 1, "price_pnl_usdt": "12.00000000", "fill_commissions_usdt": "0.11100000",
                     "reported_funding_usdt": "0.50000000"},
            "2026": {"closed_trades": 1, "price_pnl_usdt": "-5.00000000", "fill_commissions_usdt": "0.04750000",
                     "reported_funding_usdt": "-0.10000000"}})

    def test_a_close_without_an_integer_time_nulls_only_the_year_split(self):
        cycles = copy.deepcopy(CYCLES)
        cycles[1]["ts_last"] = ""
        _seal(self.root, "R1", cycles=cycles)
        result = _report(self.root, "R1")
        self.assertIsNone(result["closed_by_year"])
        self.assertEqual(result["closed"]["price_pnl_usdt"], "7.00000000")
        self.assertTrue(any(item.startswith("closed_by_year is null:") for item in result["limitations"]))

    def test_no_closed_cycle_gives_an_empty_year_split(self):
        _seal(self.root, "R1", cycles=[CYCLES[2]])
        self.assertEqual(_report(self.root, "R1")["closed_by_year"], {})

    def test_an_exploration_gets_the_readings_of_a_stored_run(self):
        seal = _seal(self.root, "R1")
        stored = _report(self.root, "R1")
        readings = analysis.explored(seal, "passed")
        self.assertEqual((readings["price_pnl_usdt"], readings["closed_by_year"], readings["closed_positions"]),
                         (stored["closed"]["price_pnl_usdt"], stored["closed_by_year"], stored["closed_trades"]))
        failed = analysis.explored(seal, "failed")
        self.assertIsNone(failed["price_pnl_usdt"])
        self.assertTrue(failed["reading_limitations"][0].startswith("Readings are null:"))

    def test_an_exploration_with_incomplete_reports_gets_null_readings_not_an_error(self):
        seal = _seal(self.root, "R1")
        (seal / "reports" / "returns_series.csv").unlink()
        readings = analysis.explored(seal, "passed")
        self.assertIsNone(readings["price_pnl_usdt"])
        self.assertTrue(readings["reading_limitations"][0].startswith("Readings are null:"))

    def test_zero_trade_reduced_headers_give_nulls_not_zeros(self):
        _seal(self.root, "R0", cycles=[], window=[0.0] * 6)
        result = _report(self.root, "R0")
        self.assertEqual(result["closed"], dict.fromkeys(result["closed"]))
        self.assertEqual((result["closed_trades"], result["open_positions"]), (0, 0))
        self.assertEqual(result["unrealized_residual_usdt"], "0.00000000")
        self.assertIn("No position closed: closed-position readings are null.", result["limitations"])

    def test_missing_native_economics_nulls_only_the_residual(self):
        _seal(self.root, "R1", economics=False)
        result = _report(self.root, "R1")
        self.assertIsNone(result["unrealized_residual_usdt"])
        self.assertEqual(result["closed"]["price_pnl_usdt"], "7.00000000")

    def test_economics_that_disagree_with_positions_are_not_reported(self):
        _seal(self.root, "R1", economics_override={"reported_funding_usdt": "9.00000000"})
        result = _report(self.root, "R1")
        for key in analysis._ECONOMICS:
            self.assertIsNone(result[key], key)
        self.assertTrue(any("native_economics" in item for item in result["limitations"]))

    def test_closed_row_that_does_not_reconcile_is_not_reported(self):
        cycles = copy.deepcopy(CYCLES)
        cycles[0]["events"][2]["last_px"] = "104"
        _seal(self.root, "R1", cycles=cycles)
        result = _report(self.root, "R1")
        self.assertIsNone(result["closed"])
        self.assertTrue(any("do not equal its realized PnL" in item for item in result["limitations"]))

    def test_returns_that_do_not_compound_to_final_equity_are_flagged(self):
        _seal(self.root, "R1", final_equity="1500.00000000")
        self.assertIn("Trade-window native daily returns do not compound to final_equity_usdt.",
                      _report(self.root, "R1")["limitations"])

class TablesTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)

    def test_reconciled_rows_are_typed_and_fills_name_their_cycle(self):
        orders = _csv(["client_order_id", "tags", "parent_order_id", "quantity", "ts_init", "is_reduce_only"],
                      [["O-1", "['ENTRY']", "", "1", "1767225600000000000", "False"],
                       ["O-2", "['STOP_LOSS']", "O-1", "1", "1767225600000000000", "True"],
                       ["AAA-1-exit", "['TAKE_PROFIT']", "O-1", "2", "1767225600000000000", "True"]])
        _seal(self.root, "R1", orders=orders)
        result = _tables(self.root, "R1", account=True)
        self.assertEqual({fill["event_id"]: fill["cycle_position_id"] for fill in result["fills"]},
                         {"e1": "AAA-1", "e2": "AAA-1", "e3": "AAA-1", "e4": "BBB-1", "e5": "BBB-1", "e6": "BBB-2"})
        aaa = result["positions"][0]
        self.assertEqual((aaa["closed"], aaa["price_pnl"], aaa["funding"], aaa["realized_pnl"]),
                         (True, Decimal("12"), Decimal("0.5"), Decimal("12.389")))
        self.assertEqual(aaa["commissions"], [Decimal("0.02"), Decimal("0.049"), Decimal("0.042")])
        self.assertEqual(sum(row["price_pnl"] for row in result["positions"] if row["closed"]),
                         Decimal(result["reconciled"]["closed"]["price_pnl_usdt"]))
        self.assertIsNone(result["positions"][2]["price_pnl"])  # open: fill cash flow is not a PnL yet
        self.assertEqual((aaa["ts_closed_ns"], aaa["closing_order_tags"]), (CLOSE_NS, ["TAKE_PROFIT"]))
        self.assertIsNone(result["positions"][1]["closing_order_tags"])  # its closing order is not in orders.csv
        self.assertEqual((result["positions"][2]["ts_closed_ns"], result["positions"][2]["closing_order_tags"]),
                         (None, None))
        self.assertEqual(sum(row["realized_pnl"] for row in result["positions"]),
                         Decimal(result["reconciled"]["native_economics"]["reported_realized_pnl_usdt"]))
        self.assertEqual(result["orders"][1], {"client_order_id": "O-2", "tags": ["STOP_LOSS"], "parent_order_id": "O-1",
                                               "quantity": Decimal("1"), "ts_init": 1767225600000000000,
                                               "is_reduce_only": True})
        self.assertIsNone(result["orders"][0]["parent_order_id"])
        self.assertEqual(result["account"][0]["total"], Decimal("1000"))
        self.assertEqual([row["native_return"] for row in result["daily_returns"]], WINDOW_RETURNS)
        self.assertEqual(result["reconciled"]["closed_trades"], 2)
        self.assertIsNone(_tables(self.root, "R1")["account"])

    def test_runs_that_do_not_reconcile_are_refused(self):
        _seal(self.root, "BAD", economics_override={"reported_funding_usdt": "9.00000000"})
        with self.assertRaisesRegex(RecordError, "reports that reconcile"):
            _tables(self.root, "BAD")

    def test_unexpected_cell_format_names_its_column(self):
        _seal(self.root, "R1", orders=_csv(["client_order_id", "tags"], [["O-1", "['ENTRY'"]]))
        with self.assertRaises(RecordError) as caught:
            _tables(self.root, "R1")
        self.assertEqual(caught.exception.path, "/tags")


# Plan P1 holds AAA-1 (a win), P2 holds BBB-1 (a loss) and P3 holds the open BBB-2; P3 starts
# the nanosecond P2 ends.
PLAN_FILLS = {"e1": "O-1", "e2": "O-2", "e3": "O-3", "e4": "O-4", "e5": "O-5", "e6": "O-6"}
PLAN_ORDERS = [
    ["O-1", AAA, "['plan:P1', 'ENTRY']", "FILLED", START_NS, START_NS],
    ["O-2", AAA, "['plan:P1', 'ENTRY']", "FILLED", START_NS, START_NS + DAY],
    ["O-3", AAA, "['plan:P1', 'TAKE_PROFIT']", "FILLED", START_NS, CLOSE_NS],
    ["O-4", BBB, "['plan:P2', 'ENTRY']", "FILLED", START_NS, START_NS],
    ["O-5", BBB, "['plan:P2', 'STOP_LOSS']", "FILLED", START_NS, CLOSE_NS],
    ["O-6", BBB, "['plan:P3', 'ENTRY']", "FILLED", CLOSE_NS, CLOSE_NS],
]


def _plan_orders(edit=None):
    rows = [list(row) for row in PLAN_ORDERS]
    if edit:
        edit(rows)
    return _csv(["client_order_id", "instrument_id", "tags", "status", "ts_init", "ts_last"], rows)


class PlanReadingTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)

    def report(self, edit=None, cycles=CYCLES, fills=PLAN_FILLS):
        run_id = f"R{len(list(self.root.iterdir()))}"
        _seal(self.root, run_id, cycles=cycles, orders=_plan_orders(edit), fill_orders=fills)
        return _report(self.root, run_id)

    def refusal(self, edit):
        result = self.report(edit)
        self.assertIsNone(result["plans"])
        reasons = [item for item in result["limitations"] if item.startswith("plans is null: ")]
        self.assertEqual(len(reasons), 1, result["limitations"])
        return reasons[0]

    def test_open_plans_count_as_non_wins(self):
        self.assertEqual(self.report()["plans"], {"closed": 2, "wins": 1, "win_rate": 1 / 3, "open": 1})

    def test_breakeven_is_not_a_win(self):
        cycles = [{"position_id": "AAA-1", "instrument_id": AAA, "closed": True, "realized": "0.00000000",
                   "funding": [], "events": [_event("e1", "BUY", "1", "100", "0.00000000"),
                                             _event("e3", "SELL", "1", "100.1", "0.10000000")]}]
        def entry_and_target_only(rows):
            rows[:] = [rows[0], rows[2]]
        result = self.report(entry_and_target_only, cycles=cycles, fills={"e1": "O-1", "e3": "O-3"})
        self.assertEqual(result["plans"], {"closed": 1, "wins": 0, "win_rate": 0.0, "open": 0})

    def test_every_order_needs_exactly_one_plan_tag(self):
        def untagged(rows):
            rows[1][2] = "['ENTRY']"
        def doubled(rows):
            rows[1][2] = "['plan:P1', 'plan:P4']"
        self.assertIn("1 orders carry no plan tag (O-2)", self.refusal(untagged))
        self.assertIn("1 orders carry more than one plan tag (O-2)", self.refusal(doubled))

    def test_plans_on_one_instrument_must_not_overlap(self):
        def early(rows):
            rows[5][4] = CLOSE_NS - 1
        def resting(rows):  # P2 leaves an unfilled order working past its close
            rows.append(["O-7", BBB, "['plan:P2', 'ENTRY']", "ACCEPTED", START_NS, START_NS])
        def after_open(rows):  # P3's position is still open at the end, so it lasts to the end of the run
            rows.append(["O-9", BBB, "['plan:P4', 'ENTRY']", "CANCELED", CLOSE_NS + 10, CLOSE_NS + 20])
        self.assertIn("plans P2 and P3 on BBBUSDT-PERP.BINANCE overlap", self.refusal(early))
        self.assertIn("before P2 ends at the end of the run", self.refusal(resting))
        self.assertIn("plans P3 and P4 on BBBUSDT-PERP.BINANCE overlap", self.refusal(after_open))

    def test_a_plan_that_never_held_anything_overlaps_nothing(self):
        for name in ("P0", "P9"):  # the verdict must not depend on how plans sort by name
            def denied(rows):
                rows.append(["O-9", BBB, f"['plan:{name}', 'ENTRY']", "DENIED", START_NS, START_NS])
            with self.subTest(name=name):
                self.assertEqual(self.report(denied)["plans"], {"closed": 2, "wins": 1, "win_rate": 1 / 3, "open": 1})

    def test_a_fill_needs_its_order(self):
        def lost(rows):
            del rows[5]
        self.assertIn("a fill of position cycle BBB-2 has no order in orders.csv", self.refusal(lost))

    def test_a_cycle_holds_one_plan_and_a_plan_one_cycle(self):
        def shared(rows):
            rows[1][2] = "['plan:P4', 'ENTRY']"
        def reentered(rows):
            rows[5][2] = "['plan:P2', 'ENTRY']"
        self.assertIn("position cycle AAA-1 holds fills of plans P1, P4", self.refusal(shared))
        self.assertIn("plan P2 has fills in more than one position cycle", self.refusal(reentered))


# Daily bar closes of the fixture grid, stamped 1 ms before each boundary.
GRID = [START_NS + day * DAY - 1_000_000 for day in range(1, 9)]


def _timed_cycles():
    cycles = copy.deepcopy(CYCLES)
    times = {"e1": GRID[0], "e2": GRID[1], "e3": GRID[3], "e4": GRID[1], "e5": GRID[2], "e6": GRID[4]}
    for cycle in cycles:
        for event in cycle["events"]:
            event["ts_event"] = times[event["event_id"]]
        cycle["ts_last"] = cycle["events"][-1]["ts_event"]
    return cycles


class ExposureTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        _seal(self.root, "PLAIN", cycles=_timed_cycles())
        self.residual = _report(self.root, "PLAIN")["unrealized_residual_usdt"]

    def rows(self, residual=None):
        rows = [[ts, "AAA-1", "200.00000000 USDT", "1.00000000 USDT"] for ts in GRID[0:3]]
        rows += [[GRID[1], "BBB-1", "50.00000000 USDT", "-1.00000000 USDT"]]
        rows += [[ts, "BBB-2", "46.00000000 USDT", "0.00000000 USDT"] for ts in GRID[4:7]]
        return rows + [[GRID[7], "BBB-2", "47.00000000 USDT", f"{residual or self.residual} USDT"]]

    def test_rows_belong_to_the_cycle_open_at_each_bar_and_reconcile_the_residual(self):
        _seal(self.root, "R1", cycles=_timed_cycles(), exposures=self.rows())
        rows = _tables(self.root, "R1", exposures=True)["exposures"]
        self.assertEqual(Counter(row["cycle_position_id"] for row in rows), {"AAA-1": 3, "BBB-1": 1, "BBB-2": 4})
        self.assertEqual((rows[0]["ts_event_ns"], rows[0]["notional_value"]), (GRID[0], Decimal("200")))

    def test_gaps_extra_rows_and_off_grid_rows_are_refused(self):
        rows = self.rows()
        for name, edited in (("gap", rows[:1] + rows[2:]), ("closed", rows + [[GRID[3], "AAA-1", "1 USDT", "0 USDT"]]),
                             ("grid", [[rows[0][0] + 1, *rows[0][1:]]] + rows[1:])):
            with self.subTest(name):
                _seal(self.root, name, cycles=_timed_cycles(), exposures=edited)
                with self.assertRaises(RecordError) as caught:
                    _tables(self.root, name, exposures=True)
                self.assertEqual(caught.exception.path, "/exposures.csv.gz")

    def test_a_cycle_closed_between_bars_is_held_only_until_the_bar_before(self):
        cycles = _timed_cycles()
        cycles[0]["events"][2]["ts_event"] = cycles[0]["ts_last"] = GRID[2] + 1_000_000  # a boundary between bars
        rows = [row for row in self.rows() if not (row[1] == "AAA-1" and row[0] == GRID[2])]
        _seal(self.root, "R1", cycles=cycles, exposures=rows)
        self.assertEqual(sum(row["cycle_position_id"] == "AAA-1" for row in _tables(self.root, "R1", exposures=True)["exposures"]), 2)
        _seal(self.root, "R2", cycles=cycles, exposures=self.rows())
        with self.assertRaisesRegex(RecordError, "matches 0 position cycles"):
            _tables(self.root, "R2", exposures=True)

    def test_final_unrealized_pnl_must_equal_the_audited_residual(self):
        _seal(self.root, "R1", cycles=_timed_cycles(), exposures=self.rows(residual="999"))
        with self.assertRaisesRegex(RecordError, "audited residual"):
            _tables(self.root, "R1", exposures=True)

    def test_runs_without_the_exposure_report_have_none(self):
        result = _tables(self.root, "PLAIN", exposures=True)
        self.assertIsNone(result["exposures"])
        self.assertIn("No exposure report: open-position valuation over time was not recorded for this run.",
                      result["limitations"])




class MarkDrawdownTests(unittest.TestCase):
    """Equity at a bar label is the latest account total before the next label plus that label's unrealized PnL."""

    SUMMARY = {"data_interval_minutes": 5, "period_start_utc": "2026-01-01T00:00:00+00:00",
               "period_end_utc": "2026-01-01T00:30:00+00:00", "starting_balance_usdt": "1000"}
    STEP = 300_000_000_000
    FIRST = 1_767_225_600_000_000_000 + 300_000_000_000 - 1_000_000  # 00:04:59.999

    def exposure(self, index, unrealized):
        return {"ts_event_ns": self.FIRST + index * self.STEP, "unrealized_pnl": Decimal(unrealized)}

    def test_unrealized_loss_from_the_peak_is_the_drawdown(self):
        account = [{"ts_event": "2026-01-01 00:00:00+00:00", "total": "1000"},
                   {"ts_event": "2026-01-01 00:14:59.999000+00:00", "total": "1100"}]
        rows = [self.exposure(0, "50"), self.exposure(1, "-100"), self.exposure(4, "-275")]
        # Labels 0..5: 1050, 900, 1000 (+0, before the 1100 fill), 1100, 825, 1100; peak 1100 then 825.
        self.assertAlmostEqual(analysis._mark_drawdown(self.SUMMARY, account, rows), 0.25)

    def test_an_account_change_at_the_next_label_belongs_to_that_label(self):
        account = [{"ts_event": "2026-01-01 00:00:00+00:00", "total": "1000"},
                   {"ts_event": "2026-01-01 00:09:59.999000+00:00", "total": "900"}]
        rows = [self.exposure(1, "100")]
        # Label 0 still sees 1000; label 1 sees the 900 total with +100 unrealized.
        self.assertEqual(analysis._mark_drawdown(self.SUMMARY, account, rows), 0.1)

    def test_flat_account_without_exposure_has_no_drawdown(self):
        self.assertEqual(analysis._mark_drawdown(self.SUMMARY, [{"ts_event": "2026-01-01 00:00:00+00:00",
                                                                 "total": "1000"}], []), 0.0)
