"""engine.order_rules and engine.strategy.Subscriptions on a native engine: a command outside the contract is not
sent and is recorded as a breach; one inside goes on unchanged."""

import random
import unittest
from decimal import Decimal

from nautilus_trader.backtest import BacktestEngine, BacktestEngineConfig
from nautilus_trader.common import LoggerConfig, LogLevel
from nautilus_trader.model import (
    Bar, BarType, InstrumentId, MarkPriceUpdate, OmsType, OrderSide, OrderType, PositionId, Price, Quantity, StrategyId, TimeInForce, TraderId,
    TrailingOffsetType, TriggerType,
)
from nautilus_trader.trading import Strategy, StrategyConfig

from engine import order_rules, strategy as strategy_runtime
from engine.order_rules import OrderRules
from engine.run import ACCOUNT_CONTRACT, add_venue
from tests.engine.test_fill_model import BAR_NS, BAR_TYPE, FLAT, INSTRUMENT, INSTRUMENT_ID, START, fees


class Probe(OrderRules, strategy_runtime.Subscriptions, Strategy):
    """Runs `steps[n]` on its n-th bar (from 1)."""

    def __init__(self, steps):
        super().__init__(StrategyConfig(strategy_id=StrategyId("P-1"), oms_type=OmsType.HEDGING))
        order_rules.CONTRACTS["P-1"] = INSTRUMENT_ID  # as the runner registers it (engine.history.Warming)
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

    def held(self, index=0):
        """The ID of the strategy's index-th position by opening time (an unknown ID when there is none)."""
        found = sorted(self.cache.positions(strategy_id=self.strategy_id), key=lambda position: position.ts_opened)
        return found[index].id if len(found) > index else PositionId("BINANCE-0-0")

    @property
    def position_id(self):
        return self.held()

    def limit(self, side=OrderSide.BUY, quantity="0.500", price="100.00", **kwargs):
        return self.order_factory.limit(INSTRUMENT_ID, side, Quantity.from_str(quantity), Price.from_str(price),
                                        **kwargs)

    def expiry(self, seconds):
        """The whole second `seconds` and 1 ms ahead: a bar's clock reads 1 ms before a whole minute."""
        return self.clock.timestamp_ns() + 1_000_000 + seconds * 1_000_000_000

    def stop(self, quantity="0.500", side=OrderSide.SELL, trigger="90.00"):
        return self.order_factory.stop_market(INSTRUMENT_ID, side, Quantity.from_str(quantity),
                                              Price.from_str(trigger), reduce_only=True)


def replay(steps, positions=None) -> tuple[list[tuple[str, str]], list[dict]]:
    """The breaches and the orders report of a twelve-bar replay; `positions`, a list, receives the positions
    report."""
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
        if positions is not None:
            positions += engine.generate_positions_report().reset_index().to_dict("records")
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
            "short GTD": lambda s: s.submit_order(s.limit(time_in_force=TimeInForce.GTD, expire_time=s.expiry(604))),
            "order list": lambda s: s.submit_order_list(object()),
            "on another contract": lambda s: s.submit_order(s.order_factory.limit(
                InstrumentId.from_str("ETHUSDT-PERP.BINANCE"), OrderSide.BUY, Quantity.from_str("0.500"),
                Price.from_str("100.00"))),
        }
        for name, step in cases.items():
            with self.subTest(name=name):
                breaches, orders = replay({2: step})
                self.assertEqual(codes(breaches), ["ORDER_RULE"])
                self.assertEqual(orders, [])

    def test_an_instance_without_its_own_contract_sends_nothing(self):
        def unregistered(s):
            order_rules.CONTRACTS.pop("P-1")
            s.submit_order(s.limit())
        breaches, orders = replay({2: unregistered})
        self.assertEqual(([text.rsplit(": ", 1)[1] for _, text in breaches], orders),
                         (["an order is on its strategy instance's own contract"], []))

    def test_a_long_enough_gtd_entry_is_sent(self):
        breaches, orders = replay({1: lambda s: s.submit_order(s.limit(price="90.00", time_in_force=TimeInForce.GTD,
            expire_time=s.expiry(605)))})
        self.assertEqual((breaches, [row["status"] for row in orders]), ([], ["EXPIRED"]))  # sent; expires at bar 12

    def test_a_gtd_expiry_with_a_fraction_of_a_second_is_refused(self):
        # Binance's client denies it before sending, so no path sends it. `clock + 660 s` is the fixture clock's
        # 59.999 s, as on a replay's bar; in Live it is the wall clock's nanoseconds.
        entry = {2: lambda s: s.submit_order(s.limit(price="99.50"))}
        cases = {
            "clock plus a lifetime": {2: lambda s: s.submit_order(s.limit(
                time_in_force=TimeInForce.GTD, expire_time=s.clock.timestamp_ns() + 660_000_000_000))},
            "one nanosecond late": {2: lambda s: s.submit_order(s.limit(
                time_in_force=TimeInForce.GTD, expire_time=s.expiry(660) + 1))},
            "one nanosecond early": {2: lambda s: s.submit_order(s.limit(
                time_in_force=TimeInForce.GTD, expire_time=s.expiry(660) - 1))},
            "STOP_LIMIT exit": entry | {4: lambda s: s.submit_order(s.order_factory.stop_limit(
                INSTRUMENT_ID, OrderSide.SELL, Quantity.from_str("0.500"), Price.from_str("89.00"),
                Price.from_str("90.00"), reduce_only=True, time_in_force=TimeInForce.GTD,
                expire_time=s.clock.timestamp_ns() + 660_000_000_000), position_id=s.position_id)},
        }
        for name, steps in cases.items():
            with self.subTest(name=name):
                breaches, orders = replay(steps)
                self.assertEqual([text.split(": ", 2)[2] for _, text in breaches],
                                 ["a GTD order expires on a whole second: Live cannot send a fraction of one"])
                self.assertEqual(codes(breaches), ["ORDER_RULE"])
                self.assertEqual([row["type"] for row in orders], ["LIMIT"] * (len(steps) - 1))

    def test_a_gtd_order_of_a_type_live_cannot_send_gtd_is_refused(self):
        # Rule 5: each has expire_time but no expire_time_ns (only LimitOrder has), which once raised AttributeError.
        def gtd(s):
            return {"time_in_force": TimeInForce.GTD, "expire_time": s.expiry(700)}
        quantity, price = Quantity.from_str("0.500"), Price.from_str
        entry = {2: lambda s: s.submit_order(s.limit(price="99.50"))}
        cases = {
            "STOP_MARKET entry": {2: lambda s: s.submit_order(s.order_factory.stop_market(
                INSTRUMENT_ID, OrderSide.BUY, quantity, price("120.00"), **gtd(s)))},
            "STOP_MARKET exit": entry | {4: lambda s: s.submit_order(s.order_factory.stop_market(
                INSTRUMENT_ID, OrderSide.SELL, quantity, price("90.00"), reduce_only=True, **gtd(s)),
                position_id=s.position_id)},
            "MARKET_IF_TOUCHED exit": entry | {4: lambda s: s.submit_order(s.order_factory.market_if_touched(
                INSTRUMENT_ID, OrderSide.SELL, quantity, price("110.00"), reduce_only=True, **gtd(s)),
                position_id=s.position_id)},
            "TRAILING_STOP_MARKET exit": entry | {4: lambda s: s.submit_order(s.order_factory.trailing_stop_market(
                INSTRUMENT_ID, OrderSide.SELL, quantity, Decimal(100), trailing_offset_type=TrailingOffsetType.BASIS_POINTS,
                trigger_price=price("90.00"), reduce_only=True, **gtd(s)), position_id=s.position_id)},
        }
        for name, steps in cases.items():
            with self.subTest(name=name):
                breaches, orders = replay(steps)
                self.assertEqual([text.rsplit(": ", 2)[1:] for _, text in breaches], [[
                    "a GTD order is a LIMIT, STOP_LIMIT or LIMIT_IF_TOUCHED order",
                    f"Live cannot send a GTD {name.rsplit(' ', 1)[0]} order"]])
                self.assertEqual(codes(breaches), ["ORDER_RULE"])
                self.assertEqual([row["type"] for row in orders], ["LIMIT"] * (len(steps) - 1))

    def test_an_order_live_cannot_send_is_refused(self):
        # Rule 5: what the pinned Binance USD-M client denies before sending (C-058), and a trigger other than the
        # default, which replay and Paper match on the bar's price and Binance on another (C-143).
        quantity, price = Quantity.from_str("0.500"), Price.from_str
        entry = {2: lambda s: s.submit_order(s.limit(price="99.50"))}

        def exit_(make):
            return entry | {4: lambda s: s.submit_order(make(s), position_id=s.position_id)}
        cases = {
            "TRAILING_STOP_LIMIT exit": exit_(lambda s: s.order_factory.trailing_stop_limit(
                INSTRUMENT_ID, OrderSide.SELL, quantity, price("89.00"), Decimal(100), Decimal(100),
                trailing_offset_type=TrailingOffsetType.BASIS_POINTS, trigger_price=price("90.00"),
                reduce_only=True)),
            "MARKET_TO_LIMIT exit": exit_(lambda s: s.order_factory.market_to_limit(
                INSTRUMENT_ID, OrderSide.SELL, quantity, reduce_only=True)),
            "trailing offset in price": exit_(lambda s: s.order_factory.trailing_stop_market(
                INSTRUMENT_ID, OrderSide.SELL, quantity, Decimal(1), trailing_offset_type=TrailingOffsetType.PRICE,
                trigger_price=price("90.00"), reduce_only=True)),
            "DAY exit": exit_(lambda s: s.order_factory.stop_market(
                INSTRUMENT_ID, OrderSide.SELL, quantity, price("90.00"), reduce_only=True,
                time_in_force=TimeInForce.DAY)),
            "DAY entry": {2: lambda s: s.submit_order(s.limit(price="99.50", time_in_force=TimeInForce.DAY))},
            "AT_THE_OPEN entry": {2: lambda s: s.submit_order(s.limit(price="99.50",
                                                                       time_in_force=TimeInForce.AT_THE_OPEN))},
            "post-only GTD entry": {2: lambda s: s.submit_order(s.limit(
                price="90.00", post_only=True, time_in_force=TimeInForce.GTD, expire_time=s.expiry(700)))},
            **{f"{trigger.name} stop": exit_(lambda s, trigger=trigger: s.order_factory.stop_market(
                INSTRUMENT_ID, OrderSide.SELL, quantity, price("90.00"), trigger_type=trigger, reduce_only=True))
               for trigger in (TriggerType.MARK_PRICE, TriggerType.LAST_PRICE, TriggerType.INDEX_PRICE,
                               TriggerType.BID_ASK)},
            **{f"{tif.name} close": entry | {4: lambda s, tif=tif: s.close_position(
                s.cache.position(s.position_id), time_in_force=tif)}
               for tif in (TimeInForce.DAY, TimeInForce.GTD)},
            "MARK_PRICE stop entry": {2: lambda s: s.submit_order(s.order_factory.stop_market(
                INSTRUMENT_ID, OrderSide.BUY, quantity, price("120.00"), trigger_type=TriggerType.MARK_PRICE))},
        }
        for name, steps in cases.items():
            with self.subTest(name=name):
                breaches, orders = replay(steps)
                self.assertEqual(codes(breaches), ["ORDER_RULE"])
                self.assertEqual([row["type"] for row in orders], ["LIMIT"] * (len(steps) - 1))

    def test_the_orders_live_sends_go_on(self):
        # Negative control for the test above: the default trigger, basis-point trailing, GTC, IOC and FOK.
        quantity, price = Quantity.from_str("0.250"), Price.from_str

        def exits(s):
            s.submit_order(s.order_factory.trailing_stop_market(
                INSTRUMENT_ID, OrderSide.SELL, quantity, Decimal(100), trailing_offset_type=TrailingOffsetType.BASIS_POINTS,
                trigger_price=price("90.00"), trigger_type=TriggerType.DEFAULT, reduce_only=True),
                position_id=s.position_id)
            s.submit_order(s.order_factory.limit(INSTRUMENT_ID, OrderSide.SELL, quantity, price("150.00"),
                                                 reduce_only=True, time_in_force=TimeInForce.GTC),
                           position_id=s.position_id)
        breaches, orders = replay({2: lambda s: s.submit_order(s.limit(price="101.00", time_in_force=TimeInForce.FOK)),
                                   3: lambda s: s.submit_order(s.limit(price="101.00", time_in_force=TimeInForce.IOC)),
                                   4: exits})
        self.assertEqual(breaches, [])
        self.assertEqual(sorted(row["type"] for row in orders), ["LIMIT", "LIMIT", "LIMIT", "TRAILING_STOP_MARKET"])

    def test_a_gtd_stop_limit_or_limit_if_touched_exit_keeps_the_expiry_rule(self):
        def exits(seconds):
            def step(s):
                gtd = {"time_in_force": TimeInForce.GTD, "reduce_only": True,
                       "expire_time": s.expiry(seconds)}
                quantity, price = Quantity.from_str("0.250"), Price.from_str
                s.submit_order(s.order_factory.stop_limit(INSTRUMENT_ID, OrderSide.SELL, quantity, price("89.00"),
                                                          price("90.00"), **gtd), position_id=s.position_id)
                s.submit_order(s.order_factory.limit_if_touched(INSTRUMENT_ID, OrderSide.SELL, quantity,
                                                                price("110.00"), price("110.00"), **gtd),
                               position_id=s.position_id)
            return {2: lambda s: s.submit_order(s.limit(price="99.50")), 4: step}
        # 605 s: Live sends a GTD order only with Binance's 600 s and its send margin left (C-160).
        breaches, orders = replay(exits(605))
        self.assertEqual((breaches, sorted(row["type"] for row in orders)),
                         ([], ["LIMIT", "LIMIT_IF_TOUCHED", "STOP_LIMIT"]))
        breaches, orders = replay(exits(604))
        self.assertEqual(([text.rsplit(": ", 1)[1] for _, text in breaches], [row["type"] for row in orders]),
                         (["a GTD order expires at least 605 seconds after it is submitted"] * 2, ["LIMIT"]))

    def test_random_entries_are_refused_exactly_by_the_gtd_and_exposure_rules(self):
        # Seeded, bounded property check on one replay's clock: random LIMIT and STOP_MARKET entries, GTC or GTD with
        # an expiry on or off a whole second, below or above 3 x the 100000 USDT starting equity.
        draw, checked = random.Random(20261121), []

        def entries(s):
            for _ in range(300):
                kind = draw.choice((OrderType.LIMIT, OrderType.STOP_MARKET))
                price = draw.choice((Decimal(draw.randint(1, 20_000)).scaleb(-2), Decimal(draw.choice((50, 75, 120)))))
                quantity = draw.choice((Decimal(draw.randint(1, 6_000_000)).scaleb(-3),  # or at the limit's edge
                                        (300_000 / price).quantize(Decimal("0.001")) + Decimal(draw.randint(-1, 1)) / 1000))
                seconds = draw.choice((draw.randint(0, 1_200), draw.randint(603, 606)))
                fraction = draw.choice((0, 0, draw.randint(1, 999_999_999), draw.randint(1, 999) * 1_000_000))
                gtd = draw.random() < 0.5
                terms = {"time_in_force": TimeInForce.GTD, "expire_time": s.expiry(seconds) + fraction} if gtd else {}
                make = s.order_factory.limit if kind == OrderType.LIMIT else s.order_factory.stop_market
                order = make(INSTRUMENT_ID, draw.choice((OrderSide.BUY, OrderSide.SELL)), Quantity(quantity, 3),
                             Price(price, 2), **terms)
                expected = (
                    "a GTD order is a LIMIT, STOP_LIMIT or LIMIT_IF_TOUCHED order: Live cannot send a GTD STOP_MARKET "
                    "order" if gtd and kind == OrderType.STOP_MARKET
                    else "a GTD order expires on a whole second: Live cannot send a fraction of one" if gtd and fraction
                    else "a GTD order expires at least 605 seconds after it is submitted" if gtd and seconds < 605
                    else "the strategy's exposure on the contract with this entry is at most 3 times USDT equity"
                    if quantity * price > 300_000 else None)
                checked.append((order_rules.violation(s, order), expected))

        breaches, orders = replay({1: entries})
        self.assertEqual((breaches, orders, len(checked)), ([], [], 300))
        self.assertEqual([found for found, _ in checked], [expected for _, expected in checked])
        self.assertTrue({None, "a GTD order expires at least 605 seconds after it is submitted"} <=
                        {expected for _, expected in checked})

    def test_several_positions_on_both_sides_each_with_its_stop(self):
        def stops(s):
            for index in (0, 1):
                s.submit_order(s.stop("0.500"), position_id=s.held(index))
            s.submit_order(s.stop("0.500", OrderSide.BUY, "110.00"), position_id=s.held(2))
        positions = []
        breaches, orders = replay({2: lambda s: s.submit_order(s.limit(price="99.50")),
                                   3: lambda s: s.submit_order(s.limit(price="99.50")),
                                   4: lambda s: s.submit_order(s.limit(OrderSide.SELL, price="100.50")),
                                   6: stops}, positions)
        self.assertEqual(breaches, [])
        self.assertEqual(sorted((row["side"], row["quantity"]) for row in positions),
                         [("LONG", "0.500"), ("LONG", "0.500"), ("SHORT", "0.500")])
        self.assertEqual(sorted((row["type"], row["status"]) for row in orders),
                         [("LIMIT", "FILLED")] * 3 + [("STOP_MARKET", "ACCEPTED")] * 3)

    def test_the_exposure_limit_adds_every_open_entry_on_both_sides(self):
        # 2000 at 90.00 and 1090.909 at 110.00 rest unfilled: 299999.99 of the 300000 USDT allowed.
        def second(quantity):
            return {2: lambda s: s.submit_order(s.limit(quantity="2000.000", price="90.00")),
                    3: lambda s: s.submit_order(s.limit(OrderSide.SELL, quantity, price="110.00"))}
        breaches, orders = replay(second("1090.909"))
        self.assertEqual((breaches, len(orders)), ([], 2))
        breaches, orders = replay(second("1090.910"))
        self.assertEqual((codes(breaches), len(orders)), (["ORDER_RULE"], 1))
        # Sent in one callback, the first entry is counted all the same.
        for quantity, expected in (("1090.909", ([], 2)), ("1090.910", (["ORDER_RULE"], 1))):
            breaches, orders = replay({2: lambda s, quantity=quantity: (
                s.submit_order(s.limit(quantity="2000.000", price="90.00")),
                s.submit_order(s.limit(OrderSide.SELL, quantity, price="110.00")))})
            self.assertEqual((codes(breaches), len(orders)), expected)

    def test_the_stops_of_one_position_hold_at_most_its_quantity(self):
        def steps(second):
            return {2: lambda s: s.submit_order(s.limit(price="99.50")),
                    3: lambda s: s.submit_order(s.limit(price="99.50")),
                    5: lambda s: s.submit_order(s.stop("0.300"), position_id=s.held(0)),
                    6: lambda s: s.submit_order(s.stop(second), position_id=s.held(0))}
        breaches, orders = replay(steps("0.200"))
        self.assertEqual((breaches, [row["type"] for row in orders].count("STOP_MARKET")), ([], 2))
        # 0.6 exceeds the first position's 0.5 though the two positions hold 1.0.
        breaches, orders = replay(steps("0.300"))
        self.assertEqual((codes(breaches), [row["type"] for row in orders].count("STOP_MARKET")), (["ORDER_RULE"], 1))

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
