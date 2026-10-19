"""A partially filled bracket entry that expires keeps its filled quantity protected.

The pinned Nautilus cancels a bracket's stop and target when its entry expires or is canceled, even
after a partial fill. A native BacktestEngine replays the D25 case (0.25 of 16.339 filled, then the
six-hour GTD expiry) twice: with the bare bracket the audit refuses the run, and with the
strategy-authoring reference's handler the same replay passes.
"""

import contextlib
import csv
import io
import tempfile
import unittest
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace

from nautilus_trader.backtest import BacktestEngine, BacktestEngineConfig
from nautilus_trader.common import LoggerConfig, LogLevel
from nautilus_trader.model import (
    AccountType, Bar, BarType, BookType, CryptoPerpetual, Currency, InstrumentId, MarkPriceUpdate, Money,
    OmsType, OrderSide, OrderStatus, OrderType, Price, Quantity, StrategyId, Symbol, TimeInForce, TraderId,
    Venue,
)
from nautilus_trader.trading import Strategy, StrategyConfig

from engine import report
from engine.audit import audit
from engine.run import ACCOUNT_CONTRACT


BAR_NS = 300_000_000_000
INSTRUMENT_ID = InstrumentId(Symbol("AAAUSDT-PERP"), Venue("BINANCE"))
INSTRUMENT = CryptoPerpetual(
    INSTRUMENT_ID, Symbol("AAAUSDT"), Currency.from_str("BTC"), Currency.from_str("USDT"),
    Currency.from_str("USDT"), False, 2, 3, Price.from_str("0.01"), Quantity.from_str("0.001"), 0, 0,
    maker_fee=Decimal("0.0002"), taker_fee=Decimal("0.0005"), margin_init=Decimal(0), margin_maint=Decimal(0),
)
BAR_TYPE = BarType.from_str(f"{INSTRUMENT_ID}-5-MINUTE-LAST-EXTERNAL")
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

    # The strategy-authoring reference's handler, unchanged.
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
        engine.add_venue(
            Venue(account["venue"]), getattr(OmsType, account["oms_type"]),
            getattr(AccountType, account["account_type"]),
            [Money(int(account["starting_balance_usdt"]), Currency.from_str(account["base_currency"]))],
            base_currency=Currency.from_str(account["base_currency"]),
            default_leverage=Decimal(account["default_leverage"]),
            book_type=getattr(BookType, account["book_type"]), reject_stop_orders=account["reject_stop_orders"],
            support_gtd_orders=account["support_gtd_orders"],
            support_contingent_orders=account["support_contingent_orders"],
            bar_execution=account["bar_execution"],
            bar_adaptive_high_low_ordering=account["bar_adaptive_high_low_ordering"])
        engine.add_instrument(INSTRUMENT)
        strategy = TieredEntry(cover)
        strategy.tiers = tiers
        engine.add_strategy(strategy)
        engine.add_data(bars())
        engine.run()
        end = START.timestamp() + BARS * 300
        venue = Venue(account["venue"])
        finished = SimpleNamespace(
            cache=engine.cache, portfolio=engine.portfolio, result=SimpleNamespace(returns_series={}),
            observer=SimpleNamespace(rows=[], timestamps=BARS, findings=[]),
            orders=engine.generate_orders_report, fills=engine.generate_fills_report,
            positions=engine.generate_positions_report, account=lambda _: engine.generate_account_report(venue))
        window = {"start": START.isoformat(), "end": datetime.fromtimestamp(end, UTC).isoformat(),
                  "trade_start_dt": START, "end_dt": datetime.fromtimestamp(end, UTC),
                  "trade_start_ns": int(START.timestamp() * 1e9)}
        rows = [{"coin": "AAA", "instrument_id": INSTRUMENT_ID, "quantity": "16.339", "counts": {}}]
        with contextlib.redirect_stdout(io.StringIO()):
            report.write(output, finished, {"AAA": strategy}, rows, {"strategy_uses_stop_loss": True}, window,
                         account, BARS)
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
        self.assertIn("unprotected position AAAUSDT-PERP.BINANCE (R1-AAA): 0.250 held with 0 reduce-only stop",
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
            orders = list(csv.DictReader((Path(temp) / "covered" / "orders.csv").open()))
        interval, = bare["uncovered_intervals"]
        self.assertEqual((interval["position_quantity"], len(interval["ended_stop_order_ids"])), ("0.500", 2))
        self.assertTrue(covered["passed"], covered["findings"])
        stops = [(row["quantity"], row["filled_qty"]) for row in orders
                 if row["type"] == "STOP_MARKET" and row["status"] != "CANCELED"]
        self.assertEqual(stops, [("0.500", "0.500")])


if __name__ == "__main__":
    unittest.main()
