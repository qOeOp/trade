"""The venue's native fill model on one-minute bars: a touched-only limit does not fill, a traded-through
one fills at its limit, no fill lies beyond its limit or trigger price, and each bar visits the extreme
nearer its open first."""

import unittest
from datetime import UTC, datetime
from decimal import Decimal

from nautilus_trader.backtest import BacktestEngine, BacktestEngineConfig
from nautilus_trader.common import LoggerConfig, LogLevel
from nautilus_trader.model import (
    Bar, BarType, CryptoPerpetual, Currency, InstrumentId, MarkPriceUpdate, OrderSide, Price, Quantity, StrategyId,
    Symbol, TraderId, Venue,
)
from nautilus_trader.trading import Strategy, StrategyConfig

from engine.run import ACCOUNT_CONTRACT, add_venue


BAR_NS = 60_000_000_000
INSTRUMENT_ID = InstrumentId(Symbol("AAAUSDT-PERP"), Venue("BINANCE"))
INSTRUMENT = CryptoPerpetual(
    INSTRUMENT_ID, Symbol("AAAUSDT"), Currency.from_str("BTC"), Currency.from_str("USDT"), Currency.from_str("USDT"),
    False, 2, 3, Price.from_str("0.01"), Quantity.from_str("0.001"), 0, 0, maker_fee=Decimal("0.0002"),
    taker_fee=Decimal("0.0005"), margin_init=Decimal(0), margin_maint=Decimal(0))
BAR_TYPE = BarType.from_str(f"{INSTRUMENT_ID}-1-MINUTE-LAST-EXTERNAL")
START = int(datetime(2026, 1, 1, tzinfo=UTC).timestamp() * 1e9)
FLAT = ("100.00", "101.00", "99.00", "100.00")  # the open is as far from the high as from the low
LOW_NEARER = ("100.00", "101.00", "99.60", "100.20")
HIGH_NEARER = ("100.00", "100.40", "99.00", "99.80")


class Orders(Strategy):
    def __init__(self, case):
        super().__init__(StrategyConfig(strategy_id=StrategyId("P-1")))
        self.case, self.count = case, 0

    def on_start(self):
        self.subscribe_bars(BAR_TYPE)

    def on_bar(self, bar):
        self.count += 1
        if self.count != 2:
            return
        factory, qty = self.order_factory, Quantity.from_str("0.500")
        if self.case in ("touch", "through"):
            price = "99.00" if self.case == "touch" else "99.50"  # every bar's low is 99.00
            self.submit_order(factory.limit(INSTRUMENT_ID, OrderSide.BUY, qty, Price.from_str(price)))
        elif self.case in ("long", "short"):  # market entry; stop and target both inside every later bar
            side = OrderSide.BUY if self.case == "long" else OrderSide.SELL
            stop, target = ("99.80", "100.30") if self.case == "long" else ("100.30", "99.80")
            self.submit_order_list(factory.bracket(INSTRUMENT_ID, side, qty, sl_trigger_price=Price.from_str(stop),
                                                   tp_price=Price.from_str(target)))


def replay(case: str, ohlc=FLAT) -> list[dict]:
    """Every fill with its order's type, side, limit and trigger price."""
    engine = BacktestEngine(BacktestEngineConfig(trader_id=TraderId(ACCOUNT_CONTRACT["trader_id"]),
                                                 logging=LoggerConfig(stdout_level=LogLevel.ERROR)))
    try:
        add_venue(engine)
        engine.add_instrument(INSTRUMENT)
        engine.add_strategy(Orders(case))
        data = []
        for index in range(12):
            ts = START + (index + 1) * BAR_NS - 1_000_000
            prices = [Price.from_str(value) for value in (FLAT if index < 2 else ohlc)]
            data += [Bar(BAR_TYPE, *prices, Quantity.from_str("40.000"), ts, ts),
                     MarkPriceUpdate(INSTRUMENT_ID, prices[3], ts, ts)]
        engine.add_data(data)
        engine.run()
        orders = {row["client_order_id"]: row for row in engine.generate_orders_report().reset_index().to_dict("records")}
        return [{"type": orders[row["client_order_id"]]["type"], "side": str(row["order_side"]),
                 "px": Decimal(str(row["last_px"])), "price": orders[row["client_order_id"]].get("price"),
                 "trigger": orders[row["client_order_id"]].get("trigger_price")}
                for row in engine.generate_fills_report().reset_index().to_dict("records")]
    finally:
        engine.dispose()


class FillModelTests(unittest.TestCase):
    def test_a_touched_only_limit_does_not_fill_and_a_traded_through_one_fills_at_its_limit(self):
        self.assertEqual(replay("touch"), [])
        self.assertEqual([fill["px"] for fill in replay("through")], [Decimal("99.50")])

    def test_no_fill_lies_beyond_its_limit_or_trigger(self):
        fills = [fill for case, ohlc in (("through", FLAT), ("long", LOW_NEARER), ("long", HIGH_NEARER),
                                         ("short", LOW_NEARER), ("short", HIGH_NEARER))
                 for fill in replay(case, ohlc)]
        self.assertEqual({fill["type"] for fill in fills}, {"MARKET", "LIMIT", "STOP_MARKET"})
        for fill in fills:
            buy = fill["side"].endswith("BUY")
            if fill["type"] == "LIMIT":
                bound = Decimal(str(fill["price"]))
                self.assertTrue(fill["px"] <= bound if buy else fill["px"] >= bound, fill)
            elif fill["type"] == "STOP_MARKET":  # triggered inside a bar, not on a gap
                self.assertEqual(fill["px"], Decimal(str(fill["trigger"])), fill)

    def test_the_extreme_nearer_the_open_is_visited_first(self):
        def exit_type(case, ohlc):
            return [fill["type"] for fill in replay(case, ohlc)][1:]
        self.assertEqual(exit_type("long", LOW_NEARER), ["STOP_MARKET"])
        self.assertEqual(exit_type("long", HIGH_NEARER), ["LIMIT"])
        self.assertEqual(exit_type("short", LOW_NEARER), ["LIMIT"])
        self.assertEqual(exit_type("short", HIGH_NEARER), ["STOP_MARKET"])


if __name__ == "__main__":
    unittest.main()
