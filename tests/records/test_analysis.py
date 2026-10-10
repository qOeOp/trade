"""Reconciled native economics and paired analysis over small synthetic native seals."""

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

import pandas as pd

from research.records import analysis, artifacts, cli
from research.records.artifacts import _files, _sha
from research.records.cli import _compare
from research.records.common import RecordError
from tests.records.fixtures.contract_repository import ContractRepository


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
          economics_override=None, final_equity=None, status="passed", orders=",status,expire_time_ns\n") -> Path:
    seal = root / run_id
    reports = seal / "reports"
    reports.mkdir(parents=True)
    events = [event for cycle in cycles for event in cycle["events"]]
    positions = [[cycle["position_id"], cycle["instrument_id"], "BUY", "1", "False",
                  "2026-01-05 00:00:00+00:00" if cycle["closed"] else "", f"{cycle['realized']} USDT",
                  repr([event["commission"] for event in cycle["events"]]),
                  repr([_funding(amount) for amount in cycle["funding"]]), repr(cycle["events"]),
                  str(CLOSE_NS), f"{cycle['position_id']}-exit" if cycle["closed"] else ""]
                 for cycle in cycles]
    (reports / "positions.csv").write_text(_csv(POSITION_COLUMNS, positions) if cycles
                                           else ",ts_closed,realized_pnl,instrument_id\n")
    (reports / "fills.csv").write_text(
        _csv(["event_id", "commission"], [[event["event_id"], event["commission"]] for event in events])
        if events else ",client_order_id\n")
    (reports / "orders.csv").write_text(orders)
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
    summary = {"period_start_utc": "2026-01-03T00:00:00+00:00", "starting_balance_usdt": "1000",
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

    def test_closed_decomposition_and_residual_reconcile_to_native_facts(self):
        _seal(self.root, "R1")
        result = analysis.report(self.root, "R1")
        self.assertEqual(result["closed"], {
            "reported_realized_pnl_usdt": "7.24150000", "fill_commissions_usdt": "0.15850000",
            "reported_funding_usdt": "0.40000000", "price_pnl_usdt": "7.00000000"})
        self.assertEqual((result["closed_trades"], result["open_positions"]), (2, 1))
        final_balance = Decimal(result["native_economics"]["final_balance_usdt"])
        self.assertEqual(Decimal(result["unrealized_residual_usdt"]) + final_balance,
                         Decimal(json.loads((self.root / "R1/reports/summary.json").read_text())["final_equity_usdt"]))
        self.assertIn("fixture limitation", result["limitations"])
        self.assertIn("fixture coverage", result["limitations"])

    def test_zero_trade_reduced_headers_give_nulls_not_zeros(self):
        _seal(self.root, "R0", cycles=[], window=[0.0] * 6)
        result = analysis.report(self.root, "R0")
        self.assertEqual(result["closed"], dict.fromkeys(result["closed"]))
        self.assertEqual((result["closed_trades"], result["open_positions"]), (0, 0))
        self.assertEqual(result["unrealized_residual_usdt"], "0.00000000")
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
        self.assertNotIn("native summary missing", result["limitations"])

    def test_failed_seal_with_a_summary_still_reports_no_economics(self):
        _seal(self.root, "F2", status="failed")
        result = analysis.report(self.root, "F2")
        self.assertIsNotNone(result["summary_ref"])
        for key in ("native_economics", *analysis._ECONOMICS):
            self.assertIsNone(result[key], key)

    def test_missing_native_economics_nulls_only_the_residual(self):
        _seal(self.root, "R1", economics=False)
        result = analysis.report(self.root, "R1")
        self.assertIsNone(result["unrealized_residual_usdt"])
        self.assertEqual(result["closed"]["price_pnl_usdt"], "7.00000000")

    def test_economics_that_disagree_with_positions_are_not_reported(self):
        _seal(self.root, "R1", economics_override={"reported_funding_usdt": "9.00000000"})
        result = analysis.report(self.root, "R1")
        for key in analysis._ECONOMICS:
            self.assertIsNone(result[key], key)
        self.assertTrue(any("native_economics" in item for item in result["limitations"]))

    def test_closed_row_that_does_not_reconcile_is_not_reported(self):
        cycles = copy.deepcopy(CYCLES)
        cycles[0]["events"][2]["last_px"] = "104"
        _seal(self.root, "R1", cycles=cycles)
        result = analysis.report(self.root, "R1")
        self.assertIsNone(result["closed"])
        self.assertTrue(any("do not equal its realized PnL" in item for item in result["limitations"]))

    def test_returns_that_do_not_compound_to_final_equity_are_flagged(self):
        _seal(self.root, "R1", final_equity="1500.00000000")
        self.assertIn("Trade-window native daily returns do not compound to final_equity_usdt.",
                      analysis.report(self.root, "R1")["limitations"])

    def test_edited_seal_is_refused(self):
        seal = _seal(self.root, "R1")
        (seal / "reports" / "fills.csv").write_text("event_id,commission\n")
        with self.assertRaisesRegex(RecordError, "verification failed"):
            analysis.report(self.root, "R1")

    def test_report_errors_are_structured(self):
        stderr = io.StringIO()
        with patch("sys.argv", ["artifacts", "report", "--root", str(self.root), "--run-id", "MISSING"]), \
                redirect_stderr(stderr), self.assertRaises(SystemExit) as caught:
            artifacts.main()
        self.assertEqual(caught.exception.code, 2)
        error = json.loads(stderr.getvalue())["error"]
        self.assertEqual(error["write_status"], "not_written")
        self.assertIn("sealed report verification failed", error["message"])

    def test_output_is_deterministic_and_bounded(self):
        _seal(self.root, "R1")
        first = json.dumps(analysis.report(self.root, "R1"), ensure_ascii=False, indent=2)
        self.assertEqual(first, json.dumps(analysis.report(self.root, "R1"), ensure_ascii=False, indent=2))
        with self.assertRaisesRegex(RecordError, "above the 32768-byte bound"):
            analysis.check_size({"rows": ["x" * 100] * 400})

    def test_difference_is_null_unless_both_sides_are_finite_numbers(self):
        self.assertEqual(analysis.difference("1.5", 0.5), "1.0")
        self.assertEqual(analysis.difference("1.00000000", "1.00000000"), "0.00000000")
        for left, right in ((None, 1), (True, 1), ("nan", 1), ("x", 1), (1, float("inf"))):
            self.assertIsNone(analysis.difference(left, right), (left, right))


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
        result = analysis.tables(self.root, "R1", account=True)
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
        self.assertIsNone(analysis.tables(self.root, "R1")["account"])

    def test_seals_that_do_not_reconcile_or_pass_are_refused(self):
        _seal(self.root, "BAD", economics_override={"reported_funding_usdt": "9.00000000"})
        _seal(self.root, "FAILED", status="failed")
        for run_id in ("BAD", "FAILED"):
            with self.assertRaisesRegex(RecordError, "reports reconcile"):
                analysis.tables(self.root, run_id)

    def test_unexpected_cell_format_names_its_column(self):
        _seal(self.root, "R1", orders=_csv(["client_order_id", "tags"], [["O-1", "['ENTRY'"]]))
        with self.assertRaises(RecordError) as caught:
            analysis.tables(self.root, "R1")
        self.assertEqual(caught.exception.path, "/tags")


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
        self.assertEqual(result["metrics"]["closed.price_pnl_usdt"]["difference"], "0.00000000")
        self.assertIn(analysis.EX_ANTE_LIMITATION, result["limitations"])
        self.assertEqual(list(result["analysis"]["source_files_sha256"]), ["research/records/analysis.py"])

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
    def test_analysis_cannot_be_combined_with_engineering_audit(self):
        stdout, stderr = io.StringIO(), io.StringIO()
        with patch("sys.argv", ["records", "compare", "A", "B", "--analysis", "--engineering-audit"]), \
                redirect_stdout(stdout), redirect_stderr(stderr), self.assertRaises(SystemExit) as caught:
            cli.main()
        self.assertEqual(caught.exception.code, 2)
        self.assertIn("not allowed with argument", stderr.getvalue())


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
                if result["status"] != "passed":
                    self.assertIsNone(result["closed"])
                    continue
                self.assertIsNotNone(result["closed"], result["limitations"])
                self.assertNotIn("Trade-window native daily returns do not compound to final_equity_usdt.",
                                 result["limitations"])
                if result["native_economics"] is None:
                    self.assertIsNone(result["unrealized_residual_usdt"])
                elif result["open_positions"] == 0:
                    self.assertEqual(Decimal(result["unrealized_residual_usdt"]), 0)
                rows = analysis.tables(root, run_id)
                self.assertEqual(sum(row["closed"] for row in rows["positions"]), result["closed_trades"])
                for row in rows["positions"]:
                    if row["closed"]:
                        self.assertIsInstance(row["closing_order_tags"], list, row["position_id"])
                        drift = abs(pd.Timestamp(row["ts_closed"]).value - row["ts_closed_ns"])
                        self.assertLess(drift, 1_000, row["position_id"])
                self.assertEqual(sum(row["realized_pnl"] for row in rows["positions"] if row["closed"]),
                                 Decimal(result["closed"]["reported_realized_pnl_usdt"]) if result["closed_trades"]
                                 else 0)


if __name__ == "__main__":
    unittest.main()
