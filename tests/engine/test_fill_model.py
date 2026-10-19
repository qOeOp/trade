"""The venue's native fill model on one-minute bars: touched limits do not fill, traded-through limits fill
at their limit or one tick worse, market fills slip by seeded draws that repeat exactly."""

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


class Orders(Strategy):
    def __init__(self, case):
        super().__init__(StrategyConfig(strategy_id=StrategyId("P-1")))
        self.case, self.count = case, 0

    def on_start(self):
        self.subscribe_bars(BAR_TYPE)

    def on_bar(self, bar):
        self.count += 1
        if self.case == "market" and 2 <= self.count <= 21:
            side = OrderSide.BUY if self.count % 2 else OrderSide.SELL
            self.submit_order(self.order_factory.market(INSTRUMENT_ID, side, Quantity.from_str("0.500")))
        elif self.case in ("touch", "through") and self.count == 2:
            price = "99.00" if self.case == "touch" else "99.50"  # every bar's low is 99.00
            self.submit_order(self.order_factory.limit(INSTRUMENT_ID, OrderSide.BUY, Quantity.from_str("0.500"),
                                                       Price.from_str(price)))


def fills(case: str) -> list[tuple[str, str]]:
    engine = BacktestEngine(BacktestEngineConfig(trader_id=TraderId(ACCOUNT_CONTRACT["trader_id"]),
                                                 logging=LoggerConfig(stdout_level=LogLevel.ERROR)))
    try:
        add_venue(engine)
        engine.add_instrument(INSTRUMENT)
        engine.add_strategy(Orders(case))
        data = []
        for index in range(24):
            ts = START + (index + 1) * BAR_NS - 1_000_000
            prices = [Price.from_str(value) for value in ("100.00", "101.00", "99.00", "100.50")]
            data += [Bar(BAR_TYPE, *prices, Quantity.from_str("40.000"), ts, ts),
                     MarkPriceUpdate(INSTRUMENT_ID, prices[3], ts, ts)]
        engine.add_data(data)
        engine.run()
        report = engine.generate_fills_report()
        return [(str(row["order_side"]), str(row["last_px"])) for row in report.to_dict("records")]
    finally:
        engine.dispose()


class FillModelTests(unittest.TestCase):
    def test_a_touched_limit_does_not_fill_and_a_traded_through_one_fills_near_its_limit(self):
        self.assertEqual(fills("touch"), [])
        through = fills("through")
        self.assertEqual(len(through), 1)
        self.assertIn(through[0][1], ("99.50", "99.51"))

    def test_market_fills_slip_by_draws_that_repeat(self):
        first = fills("market")
        self.assertEqual(first, fills("market"))
        prices = {price for _, price in first}
        self.assertTrue(prices <= {"100.50", "100.51", "100.49"}, prices)
        self.assertGreater(len(prices), 1, "some fills slip and some do not")


if __name__ == "__main__":
    unittest.main()
