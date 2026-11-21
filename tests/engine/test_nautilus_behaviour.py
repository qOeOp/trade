"""Behaviours of the pinned Nautilus that the product relies on and does not implement itself, each locked by a minimal
native case on the replay's own venue (engine.run.add_venue) so that an upgrade which changes one fails here first.

- Bar execution splits a bar's volume over its four prices (a quarter each, rounded to the size step): a limit larger
  than a quarter fills in quarters, a market order's remainder fills one tick worse, and a bar whose quarter rounds to
  nothing fills nothing (engine/README.md, fills).
- A reduce-only order is resized to what is left of its position and cancelled when the position closes
  (`sync_reduce_only_orders`); Binance does neither, which the strategy-authoring rules tell sources.
- `time_bars_build_delay` delays an aggregated bar's `ts_event` by the delay, not only its delivery (Paper and Live
  build their aggregations with history.BUILD_DELAY_US).
- The risk engine denies an entry whose initial margin exceeds the free balance (order_rules' three-times-equity cap
  relies on it below a leverage of 3).
"""

from decimal import Decimal
import unittest

from nautilus_trader.backtest import BacktestEngine, BacktestEngineConfig
from nautilus_trader.common import LoggerConfig, LogLevel
from nautilus_trader.data import DataEngineConfig
from nautilus_trader.model import Bar, BarType, OrderSide, Price, Quantity, StrategyId, TraderId
from nautilus_trader.trading import Strategy, StrategyConfig

from engine import history
from engine.run import ACCOUNT_CONTRACT, add_venue, with_margins
from tests.engine.test_fill_model import BAR_NS, BAR_TYPE, FLAT, INSTRUMENT, INSTRUMENT_ID, START, fees

AGGREGATED = BarType.from_str(f"{INSTRUMENT_ID}-5-MINUTE-LAST-INTERNAL@1-MINUTE-EXTERNAL")


class Script(Strategy):
    """Calls `act(self, n)` on the n-th one-minute bar; keeps the aggregated bars' stamps and the denials."""

    def __init__(self, act):
        super().__init__(StrategyConfig(strategy_id=StrategyId("P-1")))
        self.act, self.count, self.aggregated, self.denied = act, 0, [], []

    def on_start(self):
        self.subscribe_bars(BAR_TYPE)
        self.subscribe_bars(AGGREGATED)

    def on_bar(self, bar):
        if str(bar.bar_type).startswith(f"{INSTRUMENT_ID}-5-MINUTE"):
            self.aggregated.append(bar.ts_event - START)
            return
        self.count += 1
        self.act(self, self.count)

    def on_order_denied(self, event):
        self.denied.append(str(event.reason))

    def open_position(self):
        return self.cache.positions_open()[0]


def replay(act=lambda source, count: None, *, volume="40.000", bars=6, instrument=INSTRUMENT, build_delay=0):
    """(fills as (side, quantity, price), orders as (type, status, quantity), the source) of a replay of `bars` flat
    one-minute bars of `volume`."""
    account = ACCOUNT_CONTRACT
    engine = BacktestEngine(BacktestEngineConfig(
        trader_id=TraderId(account["trader_id"]), logging=LoggerConfig(stdout_level=LogLevel.ERROR),
        data_engine=DataEngineConfig(time_bars_timestamp_on_close=account["time_bars_timestamp_on_close"],
                                     time_bars_skip_first_non_full_bar=account["time_bars_skip_first_non_full_bar"],
                                     validate_data_sequence=account["validate_data_sequence"],
                                     time_bars_build_delay=build_delay)))
    try:
        add_venue(engine, fees())
        engine.add_instrument(instrument)
        source = Script(act)
        engine.add_strategy(source)
        prices = [Price.from_str(value) for value in FLAT]
        engine.add_data([Bar(BAR_TYPE, *prices, Quantity.from_str(volume), START + index * BAR_NS,
                             START + index * BAR_NS) for index in range(1, bars + 1)])
        engine.run()
        fills = [(str(row["order_side"]).rsplit(".", 1)[-1], row["last_qty"], row["last_px"])
                 for row in engine.generate_fills_report().reset_index().to_dict("records")]
        orders = [(order.order_type.name, order.status.name, str(order.quantity)) for order in engine.cache.orders()]
        return fills, orders, source
    finally:
        engine.dispose()


def on_second_bar(make):
    def act(source, count):
        if count == 2:
            source.submit_order(make(source.order_factory))
    return act


class BarExecutionTests(unittest.TestCase):
    def test_a_limit_larger_than_a_quarter_of_the_bar_fills_in_quarters(self):
        fills, _, _ = replay(on_second_bar(lambda factory: factory.limit(
            INSTRUMENT_ID, OrderSide.BUY, Quantity.from_str("25.000"), Price.from_str("99.50"))))
        self.assertEqual(fills, [("BUY", "10.000", "99.50"), ("BUY", "10.000", "99.50"), ("BUY", "5.000", "99.50")])

    def test_a_market_order_fills_a_quarter_at_the_price_and_the_rest_one_tick_worse(self):
        fills, _, _ = replay(on_second_bar(lambda factory: factory.market(
            INSTRUMENT_ID, OrderSide.BUY, Quantity.from_str("25.000"))))
        self.assertEqual(fills, [("BUY", "10.000", "100.00"), ("BUY", "15.000", "100.01")])

    def test_a_bar_whose_quarter_rounds_to_nothing_fills_nothing(self):
        def limit(factory):
            return factory.limit(INSTRUMENT_ID, OrderSide.BUY, Quantity.from_str("0.002"), Price.from_str("99.50"))
        fills, orders, _ = replay(on_second_bar(limit), volume="0.001")  # one size step: a quarter rounds to 0
        self.assertEqual((fills, orders), ([], [("LIMIT", "ACCEPTED", "0.002")]))
        fills, _, _ = replay(on_second_bar(limit), volume="0.004")
        self.assertEqual(fills, [("BUY", "0.001", "99.50"), ("BUY", "0.001", "99.50")])


class ReduceOnlyTests(unittest.TestCase):
    def test_a_reduce_only_stop_follows_its_position_down_and_is_cancelled_when_it_closes(self):
        def act(source, count):
            factory, quantity = source.order_factory, Quantity.from_str
            if count == 2:
                source.submit_order(factory.market(INSTRUMENT_ID, OrderSide.BUY, quantity("0.500")))
            elif count == 3:
                source.held_stop = factory.stop_market(INSTRUMENT_ID, OrderSide.SELL, quantity("0.500"),
                                                  Price.from_str("90.00"), reduce_only=True)
                source.submit_order(source.held_stop, position_id=source.open_position().id)
            elif count == 4:
                source.submit_order(factory.market(INSTRUMENT_ID, OrderSide.SELL, quantity("0.200"), reduce_only=True),
                                    position_id=source.open_position().id)
            elif count == 5:
                source.after_partial = str(source.cache.order(source.held_stop.client_order_id).quantity)
                source.submit_order(factory.market(INSTRUMENT_ID, OrderSide.SELL, quantity("0.300"), reduce_only=True),
                                    position_id=source.open_position().id)
        _, orders, source = replay(act)
        self.assertEqual(source.after_partial, "0.300")
        self.assertEqual(orders[1], ("STOP_MARKET", "CANCELED", "0.300"))


class AggregationTests(unittest.TestCase):
    def test_the_build_delay_moves_an_aggregated_bars_stamp_as_well_as_its_delivery(self):
        minute = BAR_NS
        self.assertEqual(replay(bars=12)[2].aggregated, [5 * minute, 10 * minute])
        delay_ns = history.BUILD_DELAY_US * 1000
        self.assertEqual(replay(bars=12, build_delay=history.BUILD_DELAY_US)[2].aggregated,
                         [5 * minute + delay_ns, 10 * minute + delay_ns])


class MarginTests(unittest.TestCase):
    def test_an_entry_whose_initial_margin_exceeds_the_free_balance_is_denied(self):
        account = ACCOUNT_CONTRACT
        instrument = with_margins(INSTRUMENT, (account["initial_margin_rate"], account["maintenance_margin_rate"]))
        equity, leverage = Decimal(account["starting_balance_usdt"]), Decimal(account["default_leverage"])
        for multiple, filled in (("2.9", True), ("3.1", False)):
            quantity = Quantity.from_str(f"{equity * Decimal(multiple) / 100:.3f}")  # at the bars' price of 100
            with self.subTest(multiple=multiple):
                fills, orders, source = replay(on_second_bar(lambda factory: factory.market(
                    INSTRUMENT_ID, OrderSide.BUY, quantity)), volume="100000.000", instrument=instrument)
                self.assertEqual(bool(fills), filled)
                if not filled:
                    self.assertEqual(orders, [("MARKET", "DENIED", str(quantity))])
                    self.assertRegex(source.denied[0], "^INITIAL_MARGIN_EXCEEDS_FREE_BALANCE")
        self.assertEqual(leverage, 3)  # the multiple above is the replay's default leverage


if __name__ == "__main__":
    unittest.main()
