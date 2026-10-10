"""A native no-order run must produce readable zero-row reports."""
import io
import unittest

import pandas as pd
from nautilus_trader.backtest import BacktestEngine, BacktestEngineConfig
from nautilus_trader.common import LoggerConfig, LogLevel

from backtest.r1.run_portfolio import _readable_empty_report, _orders_with_native_deadlines


class EmptyNativeReportsTests(unittest.TestCase):
    def test_actual_empty_native_reports_remain_empty_and_readable(self):
        engine = BacktestEngine(BacktestEngineConfig(
            logging=LoggerConfig(stdout_level=LogLevel.OFF),
        ))
        self.addCleanup(engine.dispose)
        orders = _orders_with_native_deadlines(engine, _readable_empty_report(
            engine.generate_orders_report(), ("status",),
        ))
        positions = _readable_empty_report(
            engine.generate_positions_report(), ("ts_closed", "realized_pnl", "instrument_id"),
        )
        fills = _readable_empty_report(engine.generate_fills_report(), ("client_order_id",))
        for report in (orders, positions, fills):
            restored = pd.read_csv(io.StringIO(report.to_csv(index=True)))
            self.assertTrue(restored.empty)
        self.assertFalse(orders["status"].isin(("DENIED", "REJECTED")).any())
        closed = positions[positions["ts_closed"].notna()]
        self.assertEqual(len(closed), 0)
        self.assertEqual(int((closed["realized_pnl"].astype(str).str.extract(r"(-?[0-9.]+)")[0].astype(float) > 0).sum()), 0)

    def test_populated_report_is_never_repaired(self):
        broken = pd.DataFrame([{"unexpected": "record"}])
        result = _readable_empty_report(broken, ("status",))
        self.assertIs(result, broken)
        with self.assertRaises(KeyError):
            result["status"]


if __name__ == "__main__":
    unittest.main()
