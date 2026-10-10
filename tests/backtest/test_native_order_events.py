"""The runtime preserves native histories, including orders without fills."""

import gzip
import json
import tempfile
import unittest
from pathlib import Path

from nautilus_trader.core import UUID4
from nautilus_trader.model import (
    AccountId, ClientOrderId, InstrumentId, LimitOrder, OrderCanceled,
    OrderSide, OrderSubmitted, Price, Quantity, StrategyId, TimeInForce, TraderId,
)

from backtest.r1.run_portfolio import _write_order_events


def canceled_order(order_id):
    order = LimitOrder(
        TraderId("TEST-001"), StrategyId("TEST-001"),
        InstrumentId.from_str("BTCUSDT-PERP.BINANCE"), ClientOrderId(order_id),
        OrderSide.BUY, Quantity.from_str("0.001"), Price.from_str("60000.10"),
        TimeInForce.GTC, False, False, False, UUID4(), 0,
    )
    order.apply(OrderSubmitted(
        order.trader_id, order.strategy_id, order.instrument_id, order.client_order_id,
        AccountId("BINANCE-001"), UUID4(), 1, 1,
    ))
    order.apply(OrderCanceled(
        order.trader_id, order.strategy_id, order.instrument_id, order.client_order_id,
        UUID4(), 2, 2, False,
    ))
    return order


class NativeOrderEventTests(unittest.TestCase):
    def test_native_unfilled_history_is_complete_and_grouping_reproducible(self):
        first, second = canceled_order("TEST-A"), canceled_order("TEST-B")
        expected = [event.to_dict() for order in (first, second) for event in order.events()]
        with tempfile.TemporaryDirectory() as temp:
            left, right = Path(temp) / "left.gz", Path(temp) / "right.gz"
            _write_order_events([second, first], left)
            _write_order_events([first, second], right)
            self.assertEqual(left.read_bytes(), right.read_bytes())
            actual = [json.loads(line) for line in gzip.decompress(left.read_bytes()).splitlines()]
        self.assertEqual(actual, expected)
        self.assertEqual(len(actual), first.event_count + second.event_count)
        self.assertEqual(actual[0]["quantity"], "0.001")
        self.assertEqual(actual[0]["price"], "60000.10")
        self.assertEqual([event["type"] for event in actual[:3]],
                         ["OrderInitialized", "OrderSubmitted", "OrderCanceled"])

    def test_empty_native_cache_exports_empty_jsonl(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "empty.gz"
            _write_order_events([], path)
            self.assertEqual(gzip.decompress(path.read_bytes()), b"")


if __name__ == "__main__":
    unittest.main()
