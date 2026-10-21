"""Native parity comparison of two replays."""

import json
import tempfile
import unittest
from decimal import Decimal
from pathlib import Path

from engine.compare_reports import compare_reports
from engine.config import Refusal


def _replay(root: Path, sharpe) -> Path:
    root.mkdir()
    for name, header in (("orders", "client_order_id,status"), ("fills", "client_order_id,ts_event,last_qty,last_px"),
                         ("positions", "opening_order_id,closing_order_id,ts_opened,adjustments")):
        (root / f"{name}.csv").write_text(header + "\n")
    (root / "account.csv").write_text("ts_event,total\n2026-01-01,100000\n")
    (root / "returns_series.csv").write_text("ts_event_ns,native_return\n0,0.0\n")
    (root / "summary.json").write_text(json.dumps({
        "engine_version": "2.0.0rc3", "final_equity_usdt": "100000.00000000", "net_change_usdt": "0E-8",
        "period_return": "0E-8", "annual_return": "0E-8", "sharpe_365": sharpe, "closed_trades": 0, "winning_trades": 0}))
    return root


class CompareReportsTests(unittest.TestCase):
    def test_empty_tables_preserve_nonvolatile_schema_differences(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            left, right = _replay(root / "a", None), _replay(root / "b", None)
            (right / "orders.csv").write_text("client_order_id,status,new_column\n")
            found = compare_reports(left, right)
        self.assertFalse(found["passed"])
        table = found["tables"]["orders"]
        self.assertFalse(table["column_match"])
        self.assertEqual(table["compared_columns"], ["client_order_id", "status"])

    def test_missing_nonkey_columns_report_schema_and_compare_shared_values(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            left, right = _replay(root / "a", None), _replay(root / "b", None)
            (right / "account.csv").write_text("ts_event\n2026-01-02\n")
            for reference, candidate in ((left, right), (right, left)):
                with self.subTest(reference=reference.name):
                    found = compare_reports(reference, candidate)
                    self.assertFalse(found["passed"])
                    table = found["tables"]["account"]
                    self.assertFalse(table["column_match"])
                    self.assertEqual(table["compared_columns"], ["ts_event"])
                    self.assertEqual(table["mismatch_count"], 1)

    def test_volatile_columns_do_not_change_schema_parity(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            left, right = _replay(root / "a", None), _replay(root / "b", None)
            (right / "orders.csv").write_text("client_order_id,status,init_id\n")
            found = compare_reports(left, right)
        self.assertTrue(found["passed"])
        self.assertEqual(found["tables"]["orders"]["excluded_columns"], ["init_id"])

    def test_empty_table_missing_business_key_is_unreadable(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            left, right = _replay(root / "a", None), _replay(root / "b", None)
            (right / "orders.csv").write_text("status\n")
            with self.assertRaisesRegex(Refusal, "lacks client_order_id"):
                compare_reports(left, right)

    def test_zero_trade_replays_with_undefined_sharpe_match(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self.assertTrue(compare_reports(_replay(root / "a", None), _replay(root / "b", None))["passed"])
            found = compare_reports(_replay(root / "c", None), _replay(root / "d", 0.5))
        self.assertFalse(found["passed"])
        self.assertEqual(found["metrics"]["sharpe_365"],
                         {"reference": None, "candidate": 0.5, "within_tolerance": False})

    def test_unreadable_directories_and_tolerances_are_refused(self):
        def code(*args):
            with self.assertRaises(Refusal) as caught:
                compare_reports(*args)
            return caught.exception.code
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            left, right = _replay(root / "a", None), _replay(root / "b", None)
            self.assertEqual(code(left, root / "absent"), "REPORT_DIR_MISSING")
            self.assertEqual(code(left, root / "a" / ".." / "a"), "SAME_REPORT_DIRECTORY")
            for tolerance in (Decimal(-1), Decimal("NaN"), "x"):
                with self.subTest(tolerance=tolerance):
                    self.assertEqual(code(left, right, tolerance), "INVALID_TOLERANCE")
            (right / "fills.csv").write_text("client_order_id,ts_event\nO-1,0\n")
            self.assertEqual(code(left, right), "REPORT_TABLE_UNREADABLE")  # no last_qty or last_px to sort by
            (right / "fills.csv").unlink()
            self.assertEqual(code(left, right), "REPORT_DIR_MISSING")


if __name__ == "__main__":
    unittest.main()
