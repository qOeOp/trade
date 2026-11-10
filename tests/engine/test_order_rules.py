"""engine.order_rules and engine.strategy.Subscriptions on a native engine: a command outside the contract is not
sent and is recorded as a breach; one inside goes on unchanged."""

import unittest
from decimal import Decimal

from nautilus_trader.backtest import BacktestEngine, BacktestEngineConfig
from nautilus_trader.common import LoggerConfig, LogLevel
from nautilus_trader.model import (
    Bar, BarType, MarkPriceUpdate, OmsType, OrderSide, PositionId, Price, Quantity, StrategyId, TimeInForce, TraderId,
)
from nautilus_trader.trading import Strategy, StrategyConfig

from engine import order_rules, strategy as strategy_runtime
from engine.order_rules import OrderRules
from engine.run import ACCOUNT_CONTRACT, add_venue
from tests.engine.test_fill_model import BAR_NS, BAR_TYPE, FLAT, INSTRUMENT, INSTRUMENT_ID, START, fees


class Probe(OrderRules, strategy_runtime.Subscriptions, Strategy):
    """Runs `steps[n]` on its n-th bar (from 1)."""

    def __init__(self, steps):
        super().__init__(StrategyConfig(strategy_id=StrategyId("P-1"), oms_type=OmsType.NETTING))
        self.steps, self.count, self.seen = steps, 0, {}

    def on_start(self):
        # As a source's WARMUP would, once registration has given the strategy its ID.
        strategy_runtime.declare(self, (("15-MINUTE", 0), ("1-DAY", 0)))
        self.subscribe_bars(BAR_TYPE)
        if "start" in self.steps:
            self.steps["start"](self)

    def on_bar(self, bar):
        self.count += 1
        if self.count in self.steps:
            self.steps[self.count](self)

    @property
    def position_id(self):
        return PositionId(f"{INSTRUMENT_ID}-P-1")

    def limit(self, side=OrderSide.BUY, quantity="0.500", price="100.00", **kwargs):
        return self.order_factory.limit(INSTRUMENT_ID, side, Quantity.from_str(quantity), Price.from_str(price),
                                        **kwargs)

    def stop(self, quantity="0.500"):
        return self.order_factory.stop_market(INSTRUMENT_ID, OrderSide.SELL, Quantity.from_str(quantity),
                                              Price.from_str("90.00"), reduce_only=True)


def replay(steps) -> tuple[list[tuple[str, str]], list[dict]]:
    """The breaches and the orders report of a twelve-bar replay."""
    strategy_runtime.BREACHES.clear()
    engine = BacktestEngine(BacktestEngineConfig(trader_id=TraderId(ACCOUNT_CONTRACT["trader_id"]),
                                                 logging=LoggerConfig(stdout_level=LogLevel.ERROR)))
    try:
        add_venue(engine, fees())
        engine.add_instrument(INSTRUMENT)
        engine.add_strategy(Probe(steps))
        data = []
        for index in range(12):
            ts = START + (index + 1) * BAR_NS - 1_000_000
            prices = [Price.from_str(value) for value in FLAT]
            data += [Bar(BAR_TYPE, *prices, Quantity.from_str("40.000"), ts, ts),
                     MarkPriceUpdate(INSTRUMENT_ID, prices[3], ts, ts)]
        engine.add_data(data)
        engine.run()
        orders = engine.generate_orders_report().reset_index().to_dict("records")
        return list(strategy_runtime.BREACHES), orders
    finally:
        engine.dispose()
        strategy_runtime.BREACHES.clear()


def codes(breaches) -> list[str]:
    return [code for code, _ in breaches]


class OrderRuleTests(unittest.TestCase):
    def test_a_limit_entry_within_equity_and_its_stop_are_sent(self):
        breaches, orders = replay({2: lambda s: s.submit_order(s.limit(price="99.50")),
                                   4: lambda s: s.submit_order(s.stop(), position_id=s.position_id)})
        self.assertEqual(breaches, [])
        self.assertEqual(sorted((row["type"], row["status"]) for row in orders),
                         [("LIMIT", "FILLED"), ("STOP_MARKET", "ACCEPTED")])

    def test_a_stop_entry_is_valued_at_its_trigger(self):
        def entry(quantity):  # 2500 at 120.00 is 3 times the 100000 USDT starting equity
            return {2: lambda s: s.submit_order(s.order_factory.stop_market(
                INSTRUMENT_ID, OrderSide.BUY, Quantity.from_str(quantity), Price.from_str("120.00")))}
        breaches, orders = replay(entry("2500.000"))
        self.assertEqual((breaches, [(row["type"], row["status"]) for row in orders]),
                         ([], [("STOP_MARKET", "ACCEPTED")]))
        breaches, orders = replay(entry("2500.001"))
        self.assertEqual((codes(breaches), orders), (["ORDER_RULE"], []))

    def test_entries_outside_the_rules_are_not_sent(self):
        cases = {
            "market": lambda s: s.submit_order(s.order_factory.market(INSTRUMENT_ID, OrderSide.BUY,
                                                                       Quantity.from_str("0.500"))),
            "beyond three times equity": lambda s: s.submit_order(s.limit(quantity="3000.001")),
            "naming a position": lambda s: s.submit_order(s.limit(), position_id=s.position_id),
            "with parameters": lambda s: s.submit_order(s.limit(), params={"x": 1}),
            "short GTD": lambda s: s.submit_order(s.limit(time_in_force=TimeInForce.GTD, expire_time=s.clock.timestamp_ns() + 599_000_000_000)),
            "order list": lambda s: s.submit_order_list(object()),
        }
        for name, step in cases.items():
            with self.subTest(name=name):
                breaches, orders = replay({2: step})
                self.assertEqual(codes(breaches), ["ORDER_RULE"])
                self.assertEqual(orders, [])

    def test_a_long_enough_gtd_entry_is_sent(self):
        breaches, orders = replay({2: lambda s: s.submit_order(s.limit(price="90.00", time_in_force=TimeInForce.GTD,
            expire_time=s.clock.timestamp_ns() + 600_000_000_000))})
        self.assertEqual((breaches, [row["status"] for row in orders]), ([], ["EXPIRED"]))  # sent; expires at bar 12

    def test_one_entry_at_a_time(self):
        breaches, orders = replay({2: lambda s: s.submit_order(s.limit(price="90.00")),
                                   3: lambda s: s.submit_order(s.limit(price="91.00"))})
        self.assertEqual(codes(breaches), ["ORDER_RULE"])
        self.assertEqual(len(orders), 1)

    def test_an_exit_needs_its_position(self):
        cases = {
            "no position": {2: lambda s: s.submit_order(s.stop(), position_id=s.position_id)},
            "unnamed": {2: lambda s: s.submit_order(s.limit(price="99.50")), 4: lambda s: s.submit_order(s.stop())},
            "too large": {2: lambda s: s.submit_order(s.limit(price="99.50")),
                          4: lambda s: s.submit_order(s.stop("0.501"), position_id=s.position_id)},
        }
        for name, steps in cases.items():
            with self.subTest(name=name):
                breaches, orders = replay(steps)
                self.assertEqual(codes(breaches), ["ORDER_RULE"])
                self.assertNotIn("STOP_MARKET", [row["type"] for row in orders])

    def test_no_modification(self):
        def modify(s):
            order, = s.cache.orders_open()
            s.modify_order(order.client_order_id, price=Price.from_str("91.00"))
        breaches, orders = replay({2: lambda s: s.submit_order(s.limit(price="90.00")), 3: modify})
        self.assertEqual(codes(breaches), ["ORDER_RULE"])
        self.assertEqual([row["price"] for row in orders], ["90.00"])

    def test_entry_equity_is_the_native_portfolio_equity(self):
        seen = {}
        replay({2: lambda s: seen.setdefault("equity", order_rules.usdt_equity(s))})
        self.assertEqual(seen["equity"], Decimal(ACCOUNT_CONTRACT["starting_balance_usdt"]))


class SubscriptionTests(unittest.TestCase):
    def test_subscriptions_outside_the_contract_are_refused(self):
        for name, step in {
            "quotes": lambda s: s.subscribe_quotes(INSTRUMENT_ID),
            "index prices": lambda s: s.subscribe_index_prices(INSTRUMENT_ID),
            "book depth": lambda s: s.subscribe_book_depth(INSTRUMENT_ID),
            "weekly bars": lambda s: s.subscribe_bars(BarType.from_str(
                f"{INSTRUMENT_ID}-1-WEEK-LAST-INTERNAL@1-MINUTE-EXTERNAL")),
            "mid bars": lambda s: s.subscribe_bars(BarType.from_str(f"{INSTRUMENT_ID}-1-MINUTE-MID-EXTERNAL")),
            "native trades": lambda s: s.subscribe_trades(INSTRUMENT_ID),
        }.items():
            with self.subTest(name=name):
                breaches, _ = replay({"start": step})
                self.assertEqual(codes(breaches), ["TRADES_NOT_SERVED" if name == "native trades"
                                                   else "SUBSCRIPTION_OUTSIDE_CONTRACT"])

    def test_contract_bars_mark_and_funding_are_served(self):
        def subscribe(s):
            s.subscribe_bars(BarType.from_str(f"{INSTRUMENT_ID}-15-MINUTE-LAST-INTERNAL@1-MINUTE-EXTERNAL"))
            s.subscribe_bars(BarType.from_str(f"{INSTRUMENT_ID}-1-DAY-LAST-INTERNAL@1-MINUTE-EXTERNAL"))
            s.subscribe_mark_prices(INSTRUMENT_ID)
            s.subscribe_funding_rates(INSTRUMENT_ID)
        breaches, _ = replay({"start": subscribe})
        self.assertEqual(breaches, [])


if __name__ == "__main__":
    unittest.main()
