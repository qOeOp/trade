"""Single-run diagnosis and paired analysis over small synthetic native seals."""

import copy
import csv
import io
import json
import math
import os
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from decimal import Decimal
from pathlib import Path
from unittest.mock import patch

from research.records import analysis, artifacts, cli
from research.records.artifacts import _files, _sha
from research.records.cli import _compare
from research.records.common import RecordError
from tests.records.fixtures.contract_repository import ContractRepository


AAA, BBB = "AAAUSDT-PERP.BINANCE", "BBBUSDT-PERP.BINANCE"
DAY = 86_400_000_000_000
START_NS = 1_767_225_600_000_000_000  # 2026-01-01T00:00:00Z
WINDOW_RETURNS = [0.01, -0.02, 0.005, 0.0, 0.003, 0.004]
POSITION_COLUMNS = ["position_id", "instrument_id", "opening_order_id", "entry", "multiplier", "is_inverse",
                    "ts_last", "ts_closed", "duration_ns", "realized_pnl", "commissions", "adjustments", "events"]
ORDER_COLUMNS = ["client_order_id", "instrument_id", "tags", "status", "quantity", "filled_qty"]


def _event(event_id, order, side, qty, px, liquidity, commission):
    return {"event_id": event_id, "client_order_id": order, "order_side": side, "last_qty": qty, "last_px": px,
            "liquidity_side": liquidity, "commission": f"{commission} USDT"}


def _funding(amount):
    return {"adjustment_type": "FUNDING", "quantity_change": None, "pnl_change": f"{amount} USDT"}


# Closed long AAA: two entries (maker + taker), one take-profit exit, funding received.
# Closed long BBB: stop-loss exit, funding paid. Open long BBB: entry only, partial order fill.
CYCLES = [
    {"position_id": "AAA-1", "instrument_id": AAA, "opening_order_id": "O1", "entry": "BUY", "closed": True,
     "ts_last": START_NS + 4 * DAY, "duration_ns": DAY, "realized": "12.38900000", "funding": ["0.50000000"],
     "events": [_event("e1", "O1", "BUY", "1", "100", "MAKER", "0.02000000"),
                _event("e2", "O2", "BUY", "1", "98", "TAKER", "0.04900000"),
                _event("e3", "O3", "SELL", "2", "105", "MAKER", "0.04200000")]},
    {"position_id": "BBB-1", "instrument_id": BBB, "opening_order_id": "O4", "entry": "BUY", "closed": True,
     "ts_last": START_NS + 4 * DAY, "duration_ns": 0, "realized": "-5.14750000", "funding": ["-0.10000000"],
     "events": [_event("e4", "O4", "BUY", "1", "50", "TAKER", "0.02500000"),
                _event("e5", "O5", "SELL", "1", "45", "TAKER", "0.02250000")]},
    {"position_id": "BBB-2", "instrument_id": BBB, "opening_order_id": "O6", "entry": "BUY", "closed": False,
     "ts_last": START_NS + 6 * DAY, "duration_ns": 0, "realized": "0.04080000", "funding": ["0.05000000"],
     "events": [_event("e6", "O6", "BUY", "1", "46", "MAKER", "0.00920000")]},
]
ORDERS = [
    ["O1", AAA, "['ENTRY']", "FILLED", "1", "1"], ["O2", AAA, "['ENTRY']", "FILLED", "1", "1"],
    ["O3", AAA, "['TAKE_PROFIT']", "FILLED", "2", "2"], ["O4", BBB, "['ENTRY']", "FILLED", "1", "1"],
    ["O5", BBB, "['STOP_LOSS']", "FILLED", "1", "1"], ["O6", BBB, "['ENTRY']", "CANCELED", "2", "1"],
    ["O7", BBB, "['STOP_LOSS']", "ACCEPTED", "1", "0"], ["O8", BBB, "[]", "CANCELED", "1", "0"],
]


def _csv(columns, rows):
    stream = io.StringIO()
    writer = csv.writer(stream, lineterminator="\n")
    writer.writerow(columns)
    writer.writerows(rows)
    return stream.getvalue()


def _returns(window):
    rows = [(START_NS + day * DAY, 0.0) for day in range(2)]
    rows += [(START_NS + (day + 2) * DAY, value) for day, value in enumerate(window)]
    return rows


def _drawdown(window):
    curve, equity = [1.0], 1.0
    for value in window:
        equity *= 1 + value
        curve.append(equity)
    peak, depth = curve[0], 0.0
    for value in curve:
        peak = max(peak, value)
        depth = min(depth, value / peak - 1)
    return depth


def _seal(root: Path, run_id: str, *, cycles=CYCLES, orders=ORDERS, window=WINDOW_RETURNS,
          economics=True, order_columns=ORDER_COLUMNS, economics_override=None, final_equity=None,
          status="passed") -> Path:
    seal = root / run_id
    reports = seal / "reports"
    reports.mkdir(parents=True)
    events = [event for cycle in cycles for event in cycle["events"]]
    positions = [[cycle["position_id"], cycle["instrument_id"], cycle["opening_order_id"], cycle["entry"], "1", "False",
                  cycle["ts_last"], "2026-01-05 00:00:00+00:00" if cycle["closed"] else "", cycle["duration_ns"],
                  f"{cycle['realized']} USDT",
                  repr([event["commission"] for event in cycle["events"]]),
                  repr([_funding(amount) for amount in cycle["funding"]]), repr(cycle["events"])]
                 for cycle in cycles]
    (reports / "positions.csv").write_text(_csv(POSITION_COLUMNS, positions) if cycles
                                           else ",ts_closed,realized_pnl,instrument_id\n")
    (reports / "fills.csv").write_text(
        _csv(["event_id", "commission"], [[event["event_id"], event["commission"]] for event in events])
        if events else ",client_order_id\n")
    index = [ORDER_COLUMNS.index(column) for column in order_columns]
    (reports / "orders.csv").write_text(_csv(order_columns, [[row[i] for i in index] for row in orders]) if orders
                                        else ",status,expire_time_ns\n")
    (reports / "account.csv").write_text("ts_event,total,currency\n2026-01-01,1000,USDT\n")
    returns = _returns(window)
    (reports / "returns_series.csv").write_text(
        _csv(["ts_event_ns", "native_return"], [[ts, repr(value)] for ts, value in returns]))
    realized = sum((Decimal(cycle["realized"]) for cycle in cycles), Decimal(0))
    commissions = sum((Decimal(event["commission"].split()[0]) for event in events), Decimal(0))
    funding = sum((Decimal(amount) for cycle in cycles for amount in cycle["funding"]), Decimal(0))
    growth = math.prod(1 + value for value in window)
    final_equity = final_equity or format((Decimal(1000) * Decimal(repr(growth))).quantize(Decimal("0.00000001")), "f")
    closed = [cycle for cycle in cycles if cycle["closed"]]
    summary = {
        "input_start_utc": "2026-01-01T00:00:00Z", "period_start_utc": "2026-01-03T00:00:00+00:00",
        "period_end_utc": "2026-01-08T12:00:00Z", "data_interval_minutes": 5, "starting_balance_usdt": "1000",
        "final_equity_usdt": final_equity, "net_change_usdt": str(Decimal(final_equity) - 1000),
        "annualized_return_pct": 1.0, "native_sharpe_365": 0.5, "native_max_drawdown_daily_close": _drawdown(window),
        "closed_trades": len(closed), "winning_trades": sum(Decimal(c["realized"]) > 0 for c in closed),
        "closed_trade_win_rate": None, "integrity_passed": True,
        "per_coin": [{"instrument": AAA}, {"instrument": BBB}], "limitations": ["fixture limitation"],
    }
    native = {"starting_balance_usdt": "1000.00000000", "final_balance_usdt": str(1000 + realized),
              "reported_realized_pnl_usdt": str(realized), "fill_commissions_usdt": str(commissions),
              "funding_adjustments": sum(len(cycle["funding"]) for cycle in cycles),
              "reported_funding_usdt": str(funding), "funding_timestamps_with_concurrent_fills": 0,
              **(economics_override or {})}
    audit = {"passed": True, "findings": [], "coverage_limits": ["fixture coverage"],
             **({"native_economics": native} if economics else {})}
    (reports / "summary.json").write_text(json.dumps(summary))
    (reports / "audit.json").write_text(json.dumps(audit))
    manifest = {"schema_version": 1, "run_id": run_id, "status": status, "problems": [],
                "native_exit_code": 0, "audit_exit_code": 0,
                "record_binding": {"id": "attempt:A", "revision": 1, "commit": "c" * 32}, "files": _files(seal)}
    (seal / "manifest.json").write_text(json.dumps(manifest))
    return seal


class SingleRunReportTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)

    def test_closed_open_and_residual_reconcile_to_native_facts(self):
        _seal(self.root, "R1")
        result = analysis.report(self.root, "R1")
        self.assertEqual(result["closed"], {
            "reported_realized_pnl_usdt": "7.24150000", "fill_commissions_usdt": "0.15850000",
            "reported_funding_usdt": "0.40000000", "price_pnl_usdt": "7.00000000",
            "entry_notional_usdt": "248.00000000"})
        self.assertEqual(result["open_positions"], 1)
        self.assertEqual(result["open_entry_notional_usdt"], "46.00000000")
        final_balance = Decimal(result["native_economics"]["final_balance_usdt"])
        self.assertEqual(Decimal(result["unrealized_residual_usdt"]),
                         (Decimal(result["final_equity_usdt"]) - final_balance).quantize(Decimal("0.00000001")))
        bps = result["closed_bps_of_entry_notional"]
        self.assertAlmostEqual(bps["reported_realized"],
                               bps["price_pnl"] - bps["fill_commissions"] + bps["reported_funding"])
        self.assertAlmostEqual(bps["reported_realized"], 7.2415 / 248 * 10_000)
        taker = 98 + 50 + 45
        self.assertAlmostEqual(result["taker_fill_notional_share"], taker / (100 + 98 + 210 + 50 + 45 + 46))
        self.assertEqual(result["orders_by_tag_status"], {
            "ENTRY": {"CANCELED": 1, "FILLED": 3}, "STOP_LOSS": {"ACCEPTED": 1, "FILLED": 1},
            "TAKE_PROFIT": {"FILLED": 1}, "untagged": {"CANCELED": 1}})
        self.assertEqual(result["partially_filled_orders"], 1)
        self.assertEqual(result["by_instrument"]["rows"], [[AAA, 1, "12.38900000"], [BBB, 1, "-5.10670000"]])
        self.assertIsNone(result["by_entry_side"])
        self.assertEqual(result["zero_duration_closed"], 1)
        self.assertEqual(result["closed_realized_pnl_quantiles_usdt"],
                         {"p05": "-5.14750000", "p50": "-5.14750000", "p95": "12.38900000"})
        self.assertEqual(result["worst_day"], {"day": "2026-01-04", "return_pct": -2.0})
        self.assertEqual(result["max_drawdown_daily_close_dates"], {
            "peak_utc": "2026-01-04T00:00:00Z", "trough_utc": "2026-01-05T00:00:00Z", "recovered_utc": None})
        self.assertEqual(list(result["monthly_account_return_pct"]), ["2026-01"])
        self.assertIn("fixture limitation", result["limitations"])
        self.assertIn("fixture coverage", result["limitations"])

    def test_simultaneous_closes_are_ordered_by_instrument_not_position_id(self):
        # NETTING snapshot IDs carry random suffixes; ordering by them would make the streak 2 here.
        earlier_loss = {"position_id": "M-1", "instrument_id": AAA, "opening_order_id": "O9", "entry": "BUY",
                        "closed": True, "ts_last": START_NS + 3 * DAY, "duration_ns": DAY, "realized": "-1.03980000",
                        "funding": ["0"], "events": [_event("e7", "O9", "BUY", "1", "100", "MAKER", "0.02000000"),
                                                     _event("e8", "O10", "SELL", "1", "99", "MAKER", "0.01980000")]}
        win, loss = copy.deepcopy(CYCLES[0]), copy.deepcopy(CYCLES[1])
        win["position_id"], loss["position_id"] = "Z-snapshot", "A-snapshot"
        _seal(self.root, "R1", cycles=[earlier_loss, win, loss], orders=ORDERS[:5])
        self.assertEqual(analysis.report(self.root, "R1")["max_consecutive_losing_closed"], 1)

    def test_order_columns_are_read_by_name(self):
        _seal(self.root / "a", "R1")
        _seal(self.root / "b", "R1", order_columns=list(reversed(ORDER_COLUMNS)))
        first, second = analysis.report(self.root / "a", "R1"), analysis.report(self.root / "b", "R1")
        self.assertEqual(first["orders_by_tag_status"], second["orders_by_tag_status"])
        self.assertEqual(first["partially_filled_orders"], second["partially_filled_orders"])

    def test_zero_trade_reduced_headers_give_nulls_not_zeros(self):
        _seal(self.root, "R0", cycles=[], orders=[], window=[0.0] * 6)
        result = analysis.report(self.root, "R0")
        self.assertEqual(result["closed"], dict.fromkeys(result["closed"]))
        self.assertEqual(result["open_positions"], 0)
        self.assertEqual(result["unrealized_residual_usdt"], "0.00000000")
        for key in ("closed_bps_of_entry_notional", "taker_fill_notional_share", "max_consecutive_losing_closed",
                    "closed_realized_pnl_quantiles_usdt", "max_drawdown_daily_close_dates"):
            self.assertIsNone(result[key], key)
        self.assertEqual(result["orders_by_tag_status"], {})
        self.assertEqual(result["by_instrument"]["rows"], [[AAA, 0, "0.00000000"], [BBB, 0, "0.00000000"]])
        self.assertIn("No position closed: closed-position readings are null.", result["limitations"])

    def test_failed_seal_reports_status_without_economics(self):
        seal = self.root / "F"
        (seal / "reports").mkdir(parents=True)
        (seal / "reports" / "orders.csv").write_text(",expire_time_ns\n")
        manifest = {"schema_version": 1, "run_id": "F", "status": "failed", "problems": ["native summary missing"],
                    "files": _files(seal)}
        (seal / "manifest.json").write_text(json.dumps(manifest))
        result = analysis.report(self.root, "F")
        self.assertEqual((result["status"], result["problems"]), ("failed", ["native summary missing"]))
        self.assertIsNone(result["summary_ref"])
        self.assertIsNone(result["closed"])
        self.assertIsNone(result["final_equity_usdt"])
        self.assertNotIn("native summary missing", result["limitations"])

    def test_failed_seal_with_a_summary_still_reports_no_account_readings(self):
        _seal(self.root, "F2", status="failed")
        result = analysis.report(self.root, "F2")
        self.assertIsNotNone(result["summary_ref"])
        for key in (*analysis.SUMMARY_FIELDS, "native_economics", "closed", "by_instrument"):
            self.assertIsNone(result[key], key)

    def test_orders_without_required_columns_are_null_not_zero(self):
        _seal(self.root, "R1", order_columns=[c for c in ORDER_COLUMNS if c != "tags"])
        result = analysis.report(self.root, "R1")
        self.assertIsNone(result["orders_by_tag_status"])
        self.assertIsNone(result["partially_filled_orders"])
        self.assertIn("Order readings are null: orders.csv lacks tags.", result["limitations"])

    def test_returns_that_do_not_compound_to_final_equity_are_rejected(self):
        _seal(self.root, "R1", final_equity="1500.00000000")
        result = analysis.report(self.root, "R1")
        self.assertIsNone(result["monthly_account_return_pct"])
        self.assertIsNone(result["worst_day"])
        self.assertIn("Daily return readings are null: trade-window returns do not compound to final_equity_usdt.",
                      result["limitations"])

    def test_report_errors_are_structured(self):
        stderr = io.StringIO()
        with patch("sys.argv", ["artifacts", "report", "--root", str(self.root), "--run-id", "MISSING"]), \
                redirect_stderr(stderr), self.assertRaises(SystemExit) as caught:
            artifacts.main()
        self.assertEqual(caught.exception.code, 2)
        error = json.loads(stderr.getvalue())["error"]
        self.assertEqual(error["write_status"], "not_written")
        self.assertIn("sealed report verification failed", error["message"])

    def test_missing_native_economics_nulls_only_the_residual(self):
        _seal(self.root, "R1", economics=False)
        result = analysis.report(self.root, "R1")
        self.assertIsNone(result["unrealized_residual_usdt"])
        self.assertEqual(result["closed"]["price_pnl_usdt"], "7.00000000")

    def test_economics_that_disagree_with_positions_null_position_readings(self):
        _seal(self.root, "R1", economics_override={"reported_funding_usdt": "9.00000000"})
        result = analysis.report(self.root, "R1")
        for key in analysis._POSITION_DERIVED:
            self.assertIsNone(result[key], key)
        self.assertTrue(any("native_economics" in item for item in result["limitations"]))
        self.assertEqual(result["partially_filled_orders"], 1)

    def test_edited_seal_is_refused(self):
        seal = _seal(self.root, "R1")
        (seal / "reports" / "fills.csv").write_text("event_id,commission\n")
        with self.assertRaisesRegex(RecordError, "verification failed"):
            analysis.report(self.root, "R1")

    def test_output_is_deterministic_and_bounded(self):
        _seal(self.root, "R1")
        first = json.dumps(analysis.report(self.root, "R1"), ensure_ascii=False, indent=2)
        self.assertEqual(first, json.dumps(analysis.report(self.root, "R1"), ensure_ascii=False, indent=2))
        self.assertLessEqual(len(first.encode()), analysis.OUTPUT_LIMIT)
        with self.assertRaisesRegex(RecordError, "above the 32768-byte bound"):
            analysis.check_size({"rows": ["x" * 100] * 400})

    def test_difference_is_null_unless_both_sides_are_finite_numbers(self):
        self.assertEqual(analysis.difference("1.5", 0.5), "1.0")
        for left, right in ((None, 1), (True, 1), ("nan", 1), ("x", 1), (1, float("inf"))):
            self.assertIsNone(analysis.difference(left, right), (left, right))


class PairedAnalysisTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.candidate = self.record(_seal(self.root, "CAND"))
        self.control = self.record(_seal(self.root, "CTRL", window=[0.004, -0.01, 0.0, 0.002, 0.001, 0.0]))

    @staticmethod
    def record(seal):
        return {"run_id": seal.name, "strategy_binding": None,
                "artifact_manifest_ref": {"path": f"artifact://{seal.name}/manifest.json",
                                          "sha256": _sha(seal / "manifest.json")}}

    def test_preregistered_final_equity_gets_annualized_relative_growth(self):
        result = analysis.pair(self.root, self.candidate, self.control, {"primary_response": "final_equity_usdt"})
        paired = result["paired_daily_returns"]
        ratio = math.prod(1 + v for v in WINDOW_RETURNS) / math.prod(1 + v for v in [0.004, -0.01, 0, 0.002, 0.001, 0])
        self.assertAlmostEqual(paired["observed_annualized_relative_growth_pct"], (ratio ** (365 / 6) - 1) * 100)
        low, high = paired["bootstrap_95pct_annualized_relative_growth_pct"]
        self.assertLessEqual(low, high)
        # 2026-01-03..04 fall in ISO week 1 and 2026-01-05..08 in week 2.
        self.assertEqual((paired["days"], paired["week_blocks"], paired["seed"]), (6, 2, 20261008))
        self.assertEqual(result["metrics"]["closed_trades"], {"candidate": 2, "control": 2, "difference": "0"})
        self.assertEqual(list(result["monthly_account_return_pct"]["2026-01"]), ["candidate", "control", "difference"])
        self.assertEqual(result["by_instrument"]["rows"][0][-1], "0.00000000")
        self.assertIn(analysis.EX_ANTE_LIMITATION, result["limitations"])
        self.assertIn("backtest/r1/checks/compare_paired_returns.py", result["analysis"]["source_files_sha256"])

    def test_other_primary_response_has_no_interval(self):
        result = analysis.pair(self.root, self.candidate, self.control, {"primary_response": "closed_trade_win_rate"})
        self.assertIsNone(result["paired_daily_returns"])
        self.assertTrue(any("primary_response" in item for item in result["limitations"]))

    def test_seal_must_match_its_dolt_anchor(self):
        self.control["artifact_manifest_ref"]["sha256"] = "0" * 64
        with self.assertRaisesRegex(RecordError, "Dolt anchor"):
            analysis.pair(self.root, self.candidate, self.control, None)
        del self.control["artifact_manifest_ref"]
        with self.assertRaisesRegex(RecordError, "Dolt-anchored sealed manifest"):
            analysis.pair(self.root, self.candidate, self.control, None)

    def test_rejected_or_misaligned_daily_returns_give_no_interval(self):
        selection = {"primary_response": "final_equity_usdt"}
        rejected = self.record(_seal(self.root, "BAD", final_equity="1500.00000000"))
        result = analysis.pair(self.root, rejected, self.control, selection)
        self.assertIsNone(result["paired_daily_returns"])
        self.assertIn("paired_daily_returns is null: a native daily return series is unavailable", result["limitations"])
        shorter = self.record(_seal(self.root, "SHORT", window=WINDOW_RETURNS[:5]))
        result = analysis.pair(self.root, shorter, self.control, selection)
        self.assertIsNone(result["paired_daily_returns"])
        self.assertIn("paired_daily_returns is null: the native daily-return timelines differ", result["limitations"])


class CompareRefusalTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fixture = ContractRepository()
        cls.addClassCleanup(cls.fixture.close)
        cls.context = cls.fixture.patches()
        cls.addClassCleanup(cls.context.close)
        cls.attempts, cls.runs = cls.fixture.snapshot()

    def refusal(self, edit):
        runs = copy.deepcopy(self.runs)
        edit(runs["H19a-2026-10-08"], runs["H18a-paired-2026-10-08"])
        with self.assertRaises(RecordError) as caught:
            _compare("H19a-2026-10-08", "H18a-paired-2026-10-08", runs)
        return caught.exception

    def test_role_checks_refuse_with_the_recorded_roles(self):
        error = self.refusal(lambda candidate, control: candidate.update(role="diagnostic"))
        self.assertEqual(str(error), "incomparable runs: candidate/control roles disagree")
        self.assertEqual((error.code, error.path, error.write_status),
                         ("decision_pair_role_mismatch", "/role", "not_written"))
        self.assertEqual(error.expected, {"/role": {"candidate": "diagnostic", "control": "control"}})
        error = self.refusal(lambda candidate, control: control.update(role="candidate"))
        self.assertEqual(error.expected["/role"]["control"], "candidate")

    def test_unregistered_control_names_the_registered_one(self):
        error = self.refusal(lambda candidate, control: candidate.update(control_run_id="OTHER"))
        self.assertEqual((error.code, error.path, error.expected), ("decision_pair_role_mismatch", "/control_run_id", "OTHER"))

    def test_recorded_contract_mismatch_lists_both_values(self):
        error = self.refusal(lambda candidate, control: candidate.update(cost_model="abbreviated costs"))
        self.assertEqual(str(error), "incomparable runs: cost_model")
        self.assertEqual((error.code, error.path), ("decision_pair_incomparable", "/cost_model"))
        self.assertEqual(error.expected["/cost_model"]["candidate"], "abbreviated costs")

    def test_integrity_refusal_is_structured(self):
        error = self.refusal(lambda candidate, control: control.update(integrity="failed"))
        self.assertEqual((error.code, error.path), ("decision_pair_integrity", "/integrity"))


class CompareCommandTests(unittest.TestCase):
    def command(self, *args, store=None):
        stdout, stderr = io.StringIO(), io.StringIO()
        with patch("sys.argv", ["records", *args]), patch("research.records.store.open_store", return_value=store), \
                redirect_stdout(stdout), redirect_stderr(stderr):
            try:
                code = cli.main()
            except SystemExit as exc:
                code = exc.code
        return code, stdout.getvalue(), stderr.getvalue()

    def test_analysis_cannot_be_combined_with_engineering_audit(self):
        code, _, stderr = self.command("compare", "A", "B", "--analysis", "--engineering-audit")
        self.assertEqual(code, 2)
        self.assertIn("not allowed with argument", stderr)


@unittest.skipUnless(os.environ.get("TRADE_RESEARCH_ARTIFACT_ROOT"), "real sealed runs are external to Git")
class RealSealTests(unittest.TestCase):
    """Identities against the configured external seals; no seal values are stored in Git."""

    def test_every_seal_reads_and_reconciles_to_its_own_native_facts(self):
        root = Path(os.environ["TRADE_RESEARCH_ARTIFACT_ROOT"])
        runs = sorted(path.name for path in root.iterdir() if (path / "manifest.json").is_file())
        self.assertTrue(runs)
        for run_id in runs:
            with self.subTest(run_id=run_id):
                result = analysis.report(root, run_id)
                self.assertLessEqual(len(json.dumps(result, ensure_ascii=False, indent=2).encode()), analysis.OUTPUT_LIMIT)
                if result["status"] != "passed":
                    self.assertIsNone(result["closed"])
                    continue
                self.assertIsNotNone(result["by_instrument"], result["limitations"])
                self.assertIsNotNone(result["monthly_account_return_pct"], result["limitations"])
                realized = sum((Decimal(row[2]) for row in result["by_instrument"]["rows"] if row[2] is not None), Decimal(0))
                economics = result["native_economics"]
                if economics is None:
                    self.assertIsNone(result["unrealized_residual_usdt"])
                    continue
                self.assertLessEqual(abs(realized - Decimal(economics["reported_realized_pnl_usdt"])), Decimal("0.000001"))
                if result["open_positions"] == 0:
                    self.assertEqual(Decimal(result["unrealized_residual_usdt"]), 0)


if __name__ == "__main__":
    unittest.main()
