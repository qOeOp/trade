"""A partially filled bracket entry that expires keeps its filled quantity protected.

The pinned Nautilus cancels a bracket's stop and target when its entry expires or is canceled, even
after a partial fill. A native BacktestEngine replays the D25 case on one-minute bars (0.25 of 16.339
filled, then the GTD expiry 72 bars later) twice: with the bare bracket the audit refuses the run, and with the
handler below, which the research-round strategy-authoring reference points strategies to, the same
replay passes.
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
    Bar, BarType, CryptoPerpetual, Currency, InstrumentId, MarkPriceUpdate, OrderSide, OrderStatus, OrderType, Price,
    Quantity, StrategyId, Symbol, TimeInForce, TraderId, Venue,
)
from nautilus_trader.trading import Strategy, StrategyConfig

from engine import report
from engine.audit import audit
from engine.config import parse_window, utc_text
from engine.run import ACCOUNT_CONTRACT, add_venue


BAR_NS = 60_000_000_000
INSTRUMENT_ID = InstrumentId(Symbol("AAAUSDT-PERP"), Venue("BINANCE"))
INSTRUMENT = CryptoPerpetual(
    INSTRUMENT_ID, Symbol("AAAUSDT"), Currency.from_str("BTC"), Currency.from_str("USDT"),
    Currency.from_str("USDT"), False, 2, 3, Price.from_str("0.01"), Quantity.from_str("0.001"), 0, 0,
    maker_fee=Decimal("0.0002"), taker_fee=Decimal("0.0005"), margin_init=Decimal(0), margin_maint=Decimal(0),
)
BAR_TYPE = BarType.from_str(f"{INSTRUMENT_ID}-1-MINUTE-LAST-EXTERNAL")
START = datetime(2026, 1, 1, tzinfo=UTC)
ENTRY_BAR, EXPIRY_BAR, STOP_BAR, CLOSE_BAR, BARS = 3, 73, 78, 90, 96


class TieredEntry(Strategy):
    """Bracket tiers whose entries are GTD six hours; ``cover`` adds the reference's expiry handler."""

    def __init__(self, cover: bool):
        super().__init__(StrategyConfig(strategy_id=StrategyId("R1-AAA")))
        self.cover, self.tiers, self.bars = cover, (), 0

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

    # The re-protection handler that the strategy-authoring reference points strategies to.
    def on_order_expired(self, event):
        if self.cover:
            self.cover_filled_entry(event.client_order_id)

    def on_order_canceled(self, event):
        if self.cover:
            self.cover_filled_entry(event.client_order_id)

    def cover_filled_entry(self, client_order_id):
        """Re-protect what an ended bracket entry filled; Nautilus canceled its stop and target."""
        entry = self.cache.order(client_order_id)
        if entry.parent_order_id is not None or not entry.linked_order_ids or entry.filled_qty.as_decimal() == 0:
            return
        position = next(iter(self.cache.positions_open(instrument_id=entry.instrument_id, strategy_id=self.strategy_id)), None)
        if position is None:
            return
        closing = OrderSide.SELL if position.is_long else OrderSide.BUY

        def lives(order):  # a child lives while its entry is filled or still working with a fill
            parent = self.cache.order(order.parent_order_id) if order.parent_order_id else None
            return parent is None or (parent.filled_qty.as_decimal() > 0
                                      and (parent.is_open or parent.status == OrderStatus.FILLED))

        covered = sum((order.leaves_qty.as_decimal() for order in self.cache.orders_open(
            instrument_id=entry.instrument_id, strategy_id=self.strategy_id)
            if order.is_reduce_only and order.order_type == OrderType.STOP_MARKET and order.side == closing
            and lives(order)), Decimal(0))
        shortfall = position.quantity.as_decimal() - covered
        if shortfall <= 0:
            return
        children = [self.cache.order(identity) for identity in entry.linked_order_ids]
        stop = next(order for order in children if order.order_type == OrderType.STOP_MARKET)
        target = next(order for order in children if order.order_type == OrderType.LIMIT)
        quantity = self.cache.instrument(entry.instrument_id).make_qty(shortfall)
        self.submit_order(self.order_factory.stop_market(
            entry.instrument_id, closing, quantity, stop.trigger_price, reduce_only=True, tags=list(stop.tags)))
        self.submit_order(self.order_factory.limit(
            entry.instrument_id, closing, quantity, target.price, reduce_only=True, tags=list(target.tags)))

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


def replay(cover: bool, output: Path, tiers=(("103.00", "16.339"),)) -> dict:
    account = ACCOUNT_CONTRACT
    engine = BacktestEngine(BacktestEngineConfig(
        trader_id=TraderId(account["trader_id"]), logging=LoggerConfig(stdout_level=LogLevel.ERROR)))
    try:
        add_venue(engine)
        engine.add_instrument(INSTRUMENT)
        strategy = TieredEntry(cover)
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
        rows = [{"coin": "AAA", "instrument_id": INSTRUMENT_ID, "quantity": "16.339", "counts": {}}]
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


class PartialEntryProtectionTests(unittest.TestCase):
    def test_expired_partial_entry_is_refused_bare_and_passes_with_the_reference_handler(self):
        with tempfile.TemporaryDirectory() as temp:
            bare = replay(False, Path(temp) / "bare")
            covered = replay(True, Path(temp) / "covered")
        self.assertFalse(bare["passed"])
        self.assertEqual(len(bare["findings"]), 1, bare["findings"])
        self.assertIn("UNPROTECTED_POSITION: AAAUSDT-PERP.BINANCE (R1-AAA): 0.250 held with 0 reduce-only stop",
                      bare["findings"][0])
        interval, = bare["uncovered_intervals"]
        expired = int(START.timestamp() * 1e9) + (EXPIRY_BAR + 1) * BAR_NS - 1_000_000
        closed = int(START.timestamp() * 1e9) + CLOSE_BAR * BAR_NS - 1_000_000  # submitted on bar CLOSE_BAR, filled in it
        self.assertEqual((interval["start_ns"], interval["end_ns"], interval["position_quantity"]),
                         (expired, closed, "0.250"))
        self.assertEqual(len(interval["ended_stop_order_ids"]), 1)
        self.assertTrue(covered["passed"], covered["findings"])
        self.assertEqual(covered["uncovered_intervals"], [])

    def test_tiers_expiring_together_are_covered_once(self):
        tiers = (("103.00", "8.000"), ("102.95", "8.000"))
        with tempfile.TemporaryDirectory() as temp:
            bare = replay(False, Path(temp) / "bare", tiers)
            covered = replay(True, Path(temp) / "covered", tiers)
            with (Path(temp) / "covered" / "orders.csv").open(encoding="utf-8") as stream:
                orders = list(csv.DictReader(stream))
        interval, = bare["uncovered_intervals"]
        self.assertEqual((interval["position_quantity"], len(interval["ended_stop_order_ids"])), ("0.500", 2))
        self.assertTrue(covered["passed"], covered["findings"])
        stops = [(row["quantity"], row["filled_qty"]) for row in orders
                 if row["type"] == "STOP_MARKET" and row["status"] != "CANCELED"]
        self.assertEqual(stops, [("0.500", "0.500")])


if __name__ == "__main__":
    unittest.main()
