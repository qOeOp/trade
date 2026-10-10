"""Native parity comparison of two replays."""

import json
import tempfile
import unittest
from pathlib import Path

from backtest.r1.checks.compare_node import compare


def _replay(root: Path, sharpe) -> Path:
    root.mkdir()
    for name, header in (("orders", "client_order_id,status"), ("fills", "client_order_id,ts_event,last_qty,last_px"),
                         ("positions", "opening_order_id,closing_order_id,ts_opened,adjustments")):
        (root / f"{name}.csv").write_text(header + "\n")
    (root / "account.csv").write_text("ts_event,total\n2026-01-01,100000\n")
    (root / "returns_series.csv").write_text("ts_event_ns,native_return\n0,0.0\n")
    (root / "summary.json").write_text(json.dumps({
        "final_equity_usdt": "100000.00000000", "annualized_return_pct": 0.0, "closed_trades": 0,
        "winning_trades": 0, "native_sharpe_365": sharpe, "native_max_drawdown_daily_close": -0.0}))
    return root


class CompareNodeTests(unittest.TestCase):
    def test_zero_trade_replays_with_undefined_sharpe_match(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self.assertTrue(compare(_replay(root / "a", None), _replay(root / "b", None))["passed"])
            self.assertFalse(compare(_replay(root / "c", None), _replay(root / "d", 0.5))["passed"])


if __name__ == "__main__":
    unittest.main()
