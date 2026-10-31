"""A native bracket keeps its entry protected on the two paths earlier Nautilus releases broke.

A native BacktestEngine replays on one-minute bars, with the pinned Nautilus:
- the D25 case (0.25 of 16.339 filled, then the GTD expiry 72 bars later): the bracket keeps its stop and
  target, resized to the filled quantity, and the audit passes the bare bracket (before 2.0.0rc7 the venue
  canceled them and left the filled quantity unprotected);
- an entry whose fill bar also reaches the stop: the stop fills and the target is canceled (before 2.0.0rc7
  the target was rejected, which fails a run);
- an OTO child smaller than its entry is resized to the entry's fill (before 2.0.0rc5 it kept its own
  quantity), so a partial target is its own reduce-only order after the fill.
"""

import contextlib
import csv
import io
import json
import tempfile
import unittest
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace

from nautilus_trader.backtest import BacktestEngine, BacktestEngineConfig
from nautilus_trader.common import LoggerConfig, LogLevel
from nautilus_trader.model import (
    Bar, BarType, CryptoPerpetual, Currency, InstrumentId, MarkPriceUpdate, OrderSide, OrderType, Price,
    Quantity, StrategyId, Symbol, TimeInForce, TraderId, Venue,
)
from nautilus_trader.trading import Strategy, StrategyConfig

from engine import report
from engine.audit import audit
from engine.config import parse_window, utc_text
from engine.run import ACCOUNT_CONTRACT, add_venue
from tests.engine.test_fill_model import fees


BAR_NS = 60_000_000_000
INSTRUMENT_ID = InstrumentId(Symbol("AAAUSDT-PERP"), Venue("BINANCE"))
INSTRUMENT = CryptoPerpetual(
    INSTRUMENT_ID, Symbol("AAAUSDT"), Currency.from_str("BTC"), Currency.from_str("USDT"),
    Currency.from_str("USDT"), False, 2, 3, Price.from_str("0.01"), Quantity.from_str("0.001"), 0, 0,
    margin_init=Decimal(0), margin_maint=Decimal(0),
)
BAR_TYPE = BarType.from_str(f"{INSTRUMENT_ID}-1-MINUTE-LAST-EXTERNAL")
START = datetime(2026, 1, 1, tzinfo=UTC)
ENTRY_BAR, EXPIRY_BAR, STOP_BAR, CLOSE_BAR, BARS = 3, 73, 78, 90, 96


class TieredEntry(Strategy):
    """Bracket tiers whose entries are GTD six hours."""

    def __init__(self):
        super().__init__(StrategyConfig(strategy_id=StrategyId("R1-AAA")))
        self.tiers, self.bars = (), 0

    def on_start(self):
        self.subscribe_bars(BAR_TYPE)

    def on_bar(self, bar):
        self.bars += 1
        if self.bars == 2:
            tags = ["plan:AAA-1"]
            for price, quantity in self.tiers:
                self.submit_order_list(self.order_factory.bracket(
                    INSTRUMENT_ID, OrderSide.BUY, Quantity.from_str(quantity), entry_order_type=OrderType.LIMIT,
                    entry_price=Price.from_str(price), time_in_force=TimeInForce.GTD,
                    expire_time=bar.ts_event + 72 * BAR_NS, sl_trigger_price=Price.from_str("98.90"),
                    tp_price=Price.from_str("110.00"), entry_tags=tags, sl_tags=tags, tp_tags=tags))
        elif self.bars == CLOSE_BAR:
            for position in self.cache.positions_open(instrument_id=INSTRUMENT_ID, strategy_id=self.strategy_id):
                self.submit_order(self.order_factory.market(
                    INSTRUMENT_ID, OrderSide.SELL, position.quantity, reduce_only=True, tags=["plan:AAA-1"]))

    def on_position_closed(self, event):
        self.cancel_all_orders(INSTRUMENT_ID)

    def replay_diagnostics(self):
        return {}

    def replay_integrity_findings(self, orders_denied_or_rejected):
        return []


def bars():
    """Flat warm-up, one volume-limited entry bar, flat past the expiry, a stop bar, then flat."""
    data = []
    for index in range(BARS):
        o, h, l, c, v = ((105, 105, 102.9, 104, 1) if index == ENTRY_BAR
                         else (104, 104, 98.8, 99, 1000) if index == STOP_BAR
                         else (99, 100, 98.95, 99, 1000) if index > STOP_BAR else (104, 105, 104, 104, 1000))
        ts = int(START.timestamp() * 1e9) + (index + 1) * BAR_NS - 1_000_000
        prices = [Price.from_str(f"{value:.2f}") for value in (o, h, l, c)]
        data += [Bar(BAR_TYPE, *prices, Quantity.from_str(f"{v:.3f}"), ts, ts),
                 MarkPriceUpdate(INSTRUMENT_ID, prices[3], ts, ts)]
    return data


def replay(output: Path, tiers=(("103.00", "16.339"),)) -> dict:
    account = ACCOUNT_CONTRACT
    engine = BacktestEngine(BacktestEngineConfig(
        trader_id=TraderId(account["trader_id"]), logging=LoggerConfig(stdout_level=LogLevel.ERROR)))
    try:
        add_venue(engine, fees())
        engine.add_instrument(INSTRUMENT)
        strategy = TieredEntry()
        strategy.tiers = tiers
        engine.add_strategy(strategy)
        engine.add_data(bars())
        engine.run()
        start_ns = int(START.timestamp() * 1e9)
        venue = Venue(account["venue"])
        finished = SimpleNamespace(
            trade_start_by_strategy={str(strategy.strategy_id): start_ns},
            cache=engine.cache, portfolio=engine.portfolio, result=SimpleNamespace(returns_series={}),
            observer=SimpleNamespace(timestamps=BARS, findings=[], lifecycle={}),
            orders=engine.generate_orders_report, fills=engine.generate_fills_report,
            positions=engine.generate_positions_report, account=lambda _: engine.generate_account_report(venue))
        window = parse_window(utc_text(start_ns), None, utc_text(start_ns + BARS * BAR_NS))
        rows = [{"coin": "AAA", "instrument_id": INSTRUMENT_ID, "quantity": "16.339", "counts": {}, "catalog_path": output}]
        with contextlib.redirect_stdout(io.StringIO()):
            report.write_native_reports(output, finished, {"AAA": strategy}, rows,
                                        {"strategy_uses_stop_loss": True, "market_commit": "c" * 32},
                                        window, account, [], BARS)
        (output.parent / "input-coverage.json").write_text(json.dumps({
            "format": "execution-input-coverage-v1", "input_identity": {"market_commit": "c" * 32},
            "effective_config": {"start": window.start, "trade_start": window.trade_start, "end": window.end},
            "membership": {"commit": "c" * 32, "membership": {"AAAUSDT": [[window.start_ns, window.end_ns]]}},
            "export_receipts": {"AAAUSDT": {"pieces": [{"index": None, "instrument_id": str(INSTRUMENT_ID),
                                                        "last_bar_ns": window.end_ns - 1_000_000}]}}}))
    finally:
        engine.dispose()
    return audit(output)


class SameBarStop(Strategy):
    """One limit bracket entry at 99.50 with its stop at 99.00, submitted on the second bar."""

    def __init__(self):
        super().__init__(StrategyConfig(strategy_id=StrategyId("R1-AAA")))
        self.bars = 0

    def on_start(self):
        self.subscribe_bars(BAR_TYPE)

    def on_bar(self, bar):
        self.bars += 1
        if self.bars == 2:
            self.submit_order_list(self.order_factory.bracket(
                INSTRUMENT_ID, OrderSide.BUY, Quantity.from_str("1.000"), entry_order_type=OrderType.LIMIT,
                entry_price=Price.from_str("99.50"), sl_trigger_price=Price.from_str("99.00"),
                tp_price=Price.from_str("101.50")))


class HalfTarget(Strategy):
    """A market entry of 1.000 with a stop and a 0.500 target: an OTO child, or its own order after the fill."""

    def __init__(self, as_child):
        super().__init__(StrategyConfig(strategy_id=StrategyId("R1-AAA")))
        self.as_child, self.bars, self.entry_id = as_child, 0, None

    def on_start(self):
        self.subscribe_bars(BAR_TYPE)

    def target(self):
        return self.order_factory.limit(INSTRUMENT_ID, OrderSide.SELL, Quantity.from_str("0.500"),
                                        Price.from_str("100.40"), reduce_only=True)

    def on_bar(self, bar):
        self.bars += 1
        if self.bars != 2:
            return
        factory = self.order_factory
        entry = factory.market(INSTRUMENT_ID, OrderSide.BUY, Quantity.from_str("1.000"))
        children = [factory.stop_market(INSTRUMENT_ID, OrderSide.SELL, Quantity.from_str("1.000"),
                                        Price.from_str("97.00"), reduce_only=True)]
        if self.as_child:
            children.append(self.target())
        list_id = str(factory.generate_order_list_id())
        data = entry.to_dict()
        data.update(contingency_type="OTO", order_list_id=list_id,
                    linked_order_ids=[str(child.client_order_id) for child in children])
        entry = type(entry).from_dict(data)
        self.entry_id = entry.client_order_id
        linked = []
        for child in children:
            data = child.to_dict()
            data.update(order_list_id=list_id, parent_order_id=str(entry.client_order_id))
            linked.append(type(child).from_dict(data))
        self.submit_order_list([entry, *linked])

    def on_order_filled(self, event):
        if not self.as_child and event.client_order_id == self.entry_id:
            self.submit_order(self.target())


class PartialEntryProtectionTests(unittest.TestCase):
    def stops(self, output: Path) -> list[tuple[str, str, str]]:
        with (output / "orders.csv").open(encoding="utf-8") as stream:
            return [(row["quantity"], row["filled_qty"], row["status"]) for row in csv.DictReader(stream)
                    if row["type"] == "STOP_MARKET"]

    def test_an_expired_partial_entry_keeps_its_stop_for_the_filled_quantity(self):
        with tempfile.TemporaryDirectory() as temp:
            result = replay(Path(temp) / "bare")
            stops = self.stops(Path(temp) / "bare")
        self.assertTrue(result["passed"], result["findings"])
        self.assertEqual(result["uncovered_intervals"], [])
        self.assertEqual(stops, [("0.250", "0.250", "FILLED")])

    def test_tiers_expiring_together_each_keep_their_stop(self):
        with tempfile.TemporaryDirectory() as temp:
            result = replay(Path(temp) / "bare", (("103.00", "8.000"), ("102.95", "8.000")))
            stops = self.stops(Path(temp) / "bare")
        self.assertTrue(result["passed"], result["findings"])
        self.assertEqual(sorted(stops), [("0.250", "0.250", "FILLED")] * 2)

    def test_an_entry_bar_that_reaches_the_stop_cancels_the_target(self):
        engine = BacktestEngine(BacktestEngineConfig(trader_id=TraderId(ACCOUNT_CONTRACT["trader_id"]),
                                                     logging=LoggerConfig(stdout_level=LogLevel.OFF)))
        self.addCleanup(engine.dispose)
        add_venue(engine, fees())
        engine.add_instrument(INSTRUMENT)
        engine.add_strategy(SameBarStop())
        data = []
        for index in range(8):  # the fourth bar fills the entry at 99.50 and reaches the stop
            prices = [Price.from_str(value) for value in (("100.00", "100.50", "98.50", "99.20") if index == 3
                                                           else ("100.00", "100.50", "99.80", "100.00"))]
            ts = int(START.timestamp() * 1e9) + (index + 1) * BAR_NS - 1_000_000
            data += [Bar(BAR_TYPE, *prices, Quantity.from_str("1000.000"), ts, ts),
                     MarkPriceUpdate(INSTRUMENT_ID, prices[3], ts, ts)]
        engine.add_data(data)
        engine.run()
        self.assertEqual(sorted((str(order.order_type), str(order.status)) for order in engine.cache.orders()),
                         [("LIMIT", "CANCELED"), ("LIMIT", "FILLED"), ("STOP_MARKET", "FILLED")])

    def test_an_oto_child_follows_the_entry_fill_and_a_later_target_keeps_its_size(self):
        for as_child, target, position in ((True, "1.000", "0.000"), (False, "0.500", "0.500")):
            with self.subTest(as_child=as_child):
                engine = BacktestEngine(BacktestEngineConfig(trader_id=TraderId(ACCOUNT_CONTRACT["trader_id"]),
                                                             logging=LoggerConfig(stdout_level=LogLevel.OFF)))
                try:
                    add_venue(engine, fees())
                    engine.add_instrument(INSTRUMENT)
                    engine.add_strategy(HalfTarget(as_child))
                    data = []
                    for index in range(8):
                        prices = [Price.from_str(value) for value in ("100.00", "100.50", "99.80", "100.00")]
                        ts = int(START.timestamp() * 1e9) + (index + 1) * BAR_NS - 1_000_000
                        data += [Bar(BAR_TYPE, *prices, Quantity.from_str("1000.000"), ts, ts),
                                 MarkPriceUpdate(INSTRUMENT_ID, prices[3], ts, ts)]
                    engine.add_data(data)
                    engine.run()
                    limits = [(str(order.quantity), str(order.status)) for order in engine.cache.orders()
                              if order.order_type == OrderType.LIMIT]
                    open_quantity = sum((p.quantity.as_decimal() for p in engine.cache.positions_open()), Decimal(0))
                finally:
                    engine.dispose()
                self.assertEqual(limits, [(target, "FILLED")])
                self.assertEqual(open_quantity, Decimal(position))


if __name__ == "__main__":
    unittest.main()
