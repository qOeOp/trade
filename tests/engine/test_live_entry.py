"""Live admission and reductions dispatch through the pinned native engine.

Only read-only account I/O is delayed by a fixture. Orders, positions, risk,
cache, source loading, admission and deferred submission remain product/native.
The streaming backtest clock is controlled; this is not live-socket evidence.
"""

import copy
from decimal import Decimal
from functools import partial
import gc
import hashlib
import json
from pathlib import Path
import tempfile
import threading
import time
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

from nautilus_trader.backtest import BacktestEngine, BacktestEngineConfig
from nautilus_trader.common import LoggerConfig, LogLevel
from nautilus_trader.execution import MakerTakerFeeModel
from nautilus_trader.infrastructure import RedisCacheConfig
from nautilus_trader.model import (
    AccountType, BookType, CryptoPerpetual, Currency, InstrumentId, MarkPriceUpdate, Money,
    OmsType, OrderSide, OrderStatus, OrderType, PositionId, PositionSide, Price, Quantity, QuoteTick,
    StrategyId, Symbol, TimeInForce, Venue,
)
from nautilus_trader.risk import RiskEngineConfig
from nautilus_trader.trading import Strategy, StrategyConfig

from engine import live
from engine import live_commands as commands, live_lifecycle, live_node, live_session, live_source as live_source_runtime
from engine.live_errors import LiveRefusal
from engine.live_venue import Credentials
from tests.engine.test_live import SOURCE
from tests.engine.test_live_venue import fixture


class DeferredAccount:
    """The real observation worker calls this reader; it owns no native objects."""

    def __init__(self, snapshot):
        self.snapshot_value = copy.deepcopy(snapshot)
        self.started = threading.Event()
        self.release = threading.Event()
        self.calls = []
        self.failure = None

    def snapshot(self, symbols):
        self.calls.append(tuple(symbols))
        self.started.set()
        if not self.release.wait(5):
            raise TimeoutError("test did not release account observation")
        if self.failure is not None:
            raise self.failure
        return copy.deepcopy(self.snapshot_value)


def configured_risk(session):
    """Read build_node's actual config before construction can connect any client."""
    original = live_node.LiveRiskEngineConfig
    captured = []

    class CapturedConfig(Exception):
        pass

    def capture(*args, **kwargs):
        captured.append(original(*args, **kwargs))
        raise CapturedConfig

    with patch.object(live_node, "LiveRiskEngineConfig", side_effect=capture):
        try:
            live.build_node(session, Credentials("offline-placeholder", "offline-placeholder"),
                            RedisCacheConfig(host="127.0.0.1", port=1))
        except CapturedConfig:
            pass
        else:
            raise AssertionError("build_node no longer constructs its native risk config")
    config = captured[0]
    # Live and Backtest expose separate native config types with these same fields.
    fields = ("bypass", "max_order_submit_rate", "max_order_modify_rate",
              "max_notional_per_order", "full_position_exit_venues", "debug")
    return config, RiskEngineConfig(**{name: getattr(config, name) for name in fields})


class NativeEntryTests(unittest.TestCase):
    def setUp(self):
        live.strategy_runtime.clear_failures()
        self.addCleanup(live.strategy_runtime.clear_failures)
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.snapshot, self.manifest = fixture()
        self.manifest.update(run_id="native-entry", trader_id="LIVE-001", account_id="BINANCE-001")
        self.manifest["config"].update(single_order_source_reviewed=True, duration_seconds=60)
        path, universe = self.root / "source.py", self.root / "universe.json"
        path.write_text(SOURCE)
        universe.write_text('{"membership":{"BTCUSDT":[[0,9999999999999999999]]}}')
        self.manifest.update(strategy_file=str(path), universe_file=str(universe),
            universe_sha256=hashlib.sha256(universe.read_bytes()).hexdigest(),
            source=dict(entry_class="Source", source_sha256=hashlib.sha256(SOURCE.encode()).hexdigest()))
        self.reader = DeferredAccount(self.snapshot)
        self.addCleanup(self.reader.release.set)
        self.session = live.Session(self.manifest, self.root, "run", account_reader=self.reader)
        commands.verify_connected_account(self.session, self.snapshot)
        self.live_risk, risk = configured_risk(self.session)
        self.source = live_source_runtime.live_source(live.source_for_run(self.manifest), self.session)
        self.session.source = self.source
        self.session.node = Mock()  # Records stop request; does not replace native execution.
        self.engine = BacktestEngine(BacktestEngineConfig(risk_engine=risk,
            logging=LoggerConfig(stdout_level=LogLevel.ERROR, print_config=False)))
        self.addCleanup(self.release_native_fixture)
        self.addCleanup(self.engine.dispose)
        self.addCleanup(self.engine.end)
        usdt = Currency.from_str("USDT")
        self.iid = InstrumentId.from_str("BTCUSDT-PERP.BINANCE")
        self.instrument = CryptoPerpetual(self.iid, Symbol("BTCUSDT"), Currency.from_str("BTC"),
            usdt, usdt, False, 2, 3, Price.from_str("0.01"), Quantity.from_str("0.001"), 0, 0,
            margin_init=Decimal(0), margin_maint=Decimal(0))
        self.engine.add_venue(Venue("BINANCE"), OmsType.HEDGING, AccountType.MARGIN,
            [Money(10000, usdt)], base_currency=usdt, default_leverage=Decimal(1),
            book_type=BookType.L1_MBP, fee_model=MakerTakerFeeModel(Decimal(0), Decimal(0)))
        self.engine.add_instrument(self.instrument)
        self.engine.add_strategy(self.source)
        # A distinct real native strategy provides foreign ownership fixture state.
        self.foreign = Strategy(StrategyConfig(strategy_id=StrategyId("FOREIGN-001"), oms_type=OmsType.NETTING))
        self.engine.add_strategy(self.foreign)
        self.ts = time.time_ns() + 1_000_000_000
        self.advance()

    def release_native_fixture(self):
        # After native end/dispose, release Python owners on the creating thread.
        # Mirrors Nautilus's collect_node_cycles fixture; do not defer these
        # unsendable wrappers to a later web request thread's cyclic GC.
        self.session.source = self.session.node = None
        self.source = self.foreign = self.engine = None
        gc.collect()

    def advance(self, bid="100.00", ask="101.00"):
        self.ts += 1_000_000
        quote = QuoteTick(self.iid, Price.from_str(bid), Price.from_str(ask),
            Quantity.from_str("100.000"), Quantity.from_str("100.000"), self.ts, self.ts)
        self.engine.add_data([quote], None, False, True)
        self.engine.run(None, self.ts, None, True)
        self.engine.clear_data()

    def limit(self, quantity="0.500", price="100.00", **kwargs):
        return self.source.order_factory.limit(self.iid, OrderSide.BUY,
            Quantity.from_str(quantity), Price.from_str(price), **kwargs)

    def submit_pending(self, order=None):
        order = order or self.limit()
        self.source.submit_order(order)
        self.assertTrue(self.reader.started.wait(2), "real observation thread did not start")
        self.assertIs(self.session.pending_entry.order, order)
        self.assertEqual(self.reader.calls, [("BTCUSDT",)])
        self.assert_no_orders()
        return order, self.session.account_observation

    def finish_read(self, observation):
        self.reader.release.set()
        observation.result.result(timeout=2)

    def admit(self, order=None):
        order, observation = self.submit_pending(order)
        self.finish_read(observation)
        commands.dispatch_entry(self.session)
        self.advance()
        return self.engine.cache.order(order.client_order_id)

    def owned_position(self):
        order = self.admit()
        self.assertEqual(order.status, OrderStatus.ACCEPTED)
        self.advance("99.00", "100.00")
        positions = self.engine.cache.positions_open(strategy_id=self.source.strategy_id)
        self.assertEqual(len(positions), 1)
        position = positions[0]
        self.assertEqual(str(position.account_id), self.manifest["account_id"])
        self.assertEqual(position.quantity, Quantity.from_str("0.500"))
        return position

    def reduction(self, quantity="0.200", side=OrderSide.SELL):
        return self.source.order_factory.market(self.iid, side, Quantity.from_str(quantity), reduce_only=True)

    def stop(self, quantity="0.500"):
        order = self.source.order_factory.stop_market(self.iid, OrderSide.SELL, Quantity.from_str(quantity),
                                                      Price.from_str("90.00"), reduce_only=True)
        position = self.engine.cache.positions_open(strategy_id=self.source.strategy_id)[0]
        self.source.submit_order(order, position_id=position.id)
        self.advance("99.00", "100.00")
        return self.engine.cache.order(order.client_order_id)

    def check(self, now):
        self.session.check_protection(self.engine.cache, now)

    def assert_late_after(self, start):
        self.check(start + live_session.PROTECTION_SECONDS - 1)
        self.assertFalse(self.session.stopping)
        self.check(start + live_session.PROTECTION_SECONDS)
        self.assertTrue(self.session.stopping)
        self.assertTrue(self.session.failed)

    def read_events(self, name):
        rows = [json.loads(line) for line in (self.root / "events.jsonl").read_text().splitlines()]
        return [row for row in rows if row["event"] == name]

    def assert_no_orders(self):
        self.assertEqual(self.engine.cache.orders(), [])
        self.assertEqual(self.engine.cache.positions(), [])
        self.assertEqual(self.source.observed, [])

    def assert_refused_unchanged(self, code, operation):
        ids = [order.client_order_id for order in self.engine.cache.orders()]
        with self.assertRaises(LiveRefusal) as caught:
            operation()
        self.assertEqual(caught.exception.code, code)
        self.advance()
        self.assertEqual([order.client_order_id for order in self.engine.cache.orders()], ids)

    def loss_at(self, price, now=0.0):
        self.session.mark = (now, Price.from_str(price))
        self.session.check_loss(self.engine.cache, now)

    def test_the_observer_receives_native_mark_prices_on_a_run_only(self):
        for mode, expected in (("run", True), ("reconcile", False)):
            with self.subTest(mode):
                self.session.mode, self.session.mark = mode, None
                rows = len(self.read_events("minute_result"))
                engine = BacktestEngine(BacktestEngineConfig(
                    logging=LoggerConfig(stdout_level=LogLevel.ERROR, print_config=False)))
                self.addCleanup(engine.dispose)
                self.addCleanup(engine.end)
                engine.add_venue(Venue("BINANCE"), OmsType.HEDGING, AccountType.MARGIN,
                    [Money(10000, Currency.from_str("USDT"))], base_currency=Currency.from_str("USDT"),
                    default_leverage=Decimal(1), book_type=BookType.L1_MBP,
                    fee_model=MakerTakerFeeModel(Decimal(0), Decimal(0)))
                engine.add_instrument(self.instrument)
                engine.add_strategy(live_lifecycle.Observer(self.session))
                ts = self.ts + 1_000_000
                engine.add_data([MarkPriceUpdate(self.iid, Price.from_str("95.00"), ts, ts)], None, False, True)
                engine.run(None, ts, None, True)
                self.assertEqual(self.session.mark is not None, expected)
                if expected:
                    self.assertEqual(self.session.mark[1], Price.from_str("95.00"))
                # The minute's first mark journals the run's result for its chart; a reconciliation has none.
                self.assertEqual(len(self.read_events("minute_result")) - rows, int(expected))

    def test_the_runs_result_is_journalled_at_each_minutes_first_mark_and_at_the_stop(self):
        self.owned_position()  # Long 0.500 at 100.
        observer = SimpleNamespace(session=self.session, cache=self.engine.cache, minute=None,
                                   clock=SimpleNamespace(timestamp_ns=lambda: 3 * live_session.MINUTE_NS + 5, cancel_timer=Mock()),
                                   unsubscribe_socket_state=Mock())
        mark = lambda price, ns: live_lifecycle.Observer.on_mark_price(observer, SimpleNamespace(value=Price.from_str(price), ts_event=ns))
        mark("95.00", live_session.MINUTE_NS + 1)
        mark("90.00", live_session.MINUTE_NS + 30_000_000_000)  # the same minute: no second row
        mark("96.00", 2 * live_session.MINUTE_NS)
        live_lifecycle.Observer.on_stop(observer)
        rows = [(row["minute_ns"], row["result"]) for row in self.read_events("minute_result")]
        self.assertEqual(rows, [(live_session.MINUTE_NS, "-2.50000000"), (2 * live_session.MINUTE_NS, "-2.00000000"),
                                (3 * live_session.MINUTE_NS, "-2.00000000")])
        self.assertFalse(self.session.stopping)
        self.assertFalse(self.session.failed)

    def test_an_open_position_without_a_price_has_an_unknown_result(self):
        self.owned_position()
        self.session.record_minute(self.engine.cache, live_session.MINUTE_NS, None)
        self.assertIsNone(self.read_events("minute_result")[0]["result"])
        self.assertFalse(self.session.failed)

    def test_loss_limit_closes_natively_without_failing_the_run(self):
        self.owned_position()  # Long 0.500 at 100; the limit is 10.
        self.loss_at("80.01")
        self.assertFalse(self.session.stopping)
        self.loss_at("80.00")
        self.assertTrue(self.session.stopping)
        self.assertFalse(self.session.failed)
        self.assertEqual(self.read_events("max_loss")[0]["result"], "-10.00000000")
        self.assertEqual(self.read_events("stopping")[0]["reason"], "max_loss")
        observe = SimpleNamespace(session=self.session, cache=self.engine.cache, last_query=0, query_account=Mock())
        live_lifecycle.Observer.observe(observe)
        self.advance("79.00", "80.00")
        self.assertEqual(self.engine.cache.positions_open(strategy_id=self.source.strategy_id), [])
        live_lifecycle.Observer.observe(observe)
        self.assertTrue(self.session.native_flat)
        self.assertFalse(self.session.failed)

    def test_loss_limit_counts_what_a_reduction_realized(self):
        position = self.owned_position()
        self.source.submit_order(self.reduction("0.400"), position_id=position.id)
        self.advance("80.00", "81.00")  # Realized -8.00 selling at the bid.
        self.loss_at("80.01")  # Plus -2.00 on the remaining 0.100 is still short of -10 by 0.001.
        self.assertFalse(self.session.stopping)
        self.loss_at("80.00")
        self.assertTrue(self.session.stopping)

    def test_loss_limit_counts_a_cycle_that_closed_before_the_position_reopened(self):
        position = self.owned_position()
        self.loss_at("99.00")
        self.assertIsNotNone(self.session.exposed_since)
        self.source.submit_order(self.reduction("0.500"), position_id=position.id)
        self.advance("90.00", "91.00")  # Realized -5.00, then flat.
        self.loss_at("90.00")
        self.assertFalse(self.session.stopping)
        self.assertIsNone(self.session.exposed_since)
        # The rest of a partly filled entry after a stop closed the first part.
        Strategy.submit_order(self.source, self.source.order_factory.market(self.iid, OrderSide.BUY, Quantity.from_str("0.100")))
        self.advance("90.00", "90.00")
        reopened = self.engine.cache.position(position.id)
        self.assertTrue(reopened.is_open)
        self.assertEqual(reopened.realized_pnl.as_decimal(), 0)
        self.loss_at("40.01")
        self.assertFalse(self.session.stopping)
        self.loss_at("40.00")
        self.assertTrue(self.session.stopping)

    def test_a_loss_realized_past_the_limit_stops_a_flat_run_and_its_working_entry(self):
        position = self.owned_position()
        self.source.submit_order(self.reduction("0.500"), position_id=position.id)
        self.advance("70.00", "71.00")
        self.assertEqual(self.engine.cache.positions_open(strategy_id=self.source.strategy_id), [])
        self.session.mark = None  # Flat needs no mark.
        self.session.check_loss(self.engine.cache, 0.0)
        self.assertTrue(self.session.stopping)
        self.assertFalse(self.session.failed)
        self.assertEqual(self.read_events("stopping")[0]["reason"], "max_loss")

    def test_loss_limit_applies_to_a_short(self):
        order = self.admit(self.source.order_factory.limit(self.iid, OrderSide.SELL, Quantity.from_str("0.500"),
                                                           Price.from_str("101.00")))
        self.assertEqual(order.status, OrderStatus.ACCEPTED)
        self.advance("101.00", "102.00")
        self.loss_at("120.99")
        self.assertFalse(self.session.stopping)
        self.loss_at("121.00")
        self.assertTrue(self.session.stopping)

    def test_no_recent_mark_counts_as_reaching_the_limit(self):
        self.owned_position()
        self.session.mark = (100.0, Price.from_str("99.00"))
        self.session.check_loss(self.engine.cache, 110.0)  # Exposure is first seen now.
        self.session.check_loss(self.engine.cache, 169.0)
        self.assertFalse(self.session.stopping)
        self.session.mark = (169.0, Price.from_str("99.00"))
        self.session.check_loss(self.engine.cache, 228.0)
        self.assertFalse(self.session.stopping)
        self.session.check_loss(self.engine.cache, 229.0)
        self.assertTrue(self.session.stopping)
        self.assertTrue(self.session.failed)
        self.assertEqual(self.read_events("stopping")[0]["reason"], "loss_unverified")

    def test_no_mark_at_all_counts_from_when_the_position_appeared(self):
        self.owned_position()
        self.session.check_loss(self.engine.cache, 500.0)
        self.session.check_loss(self.engine.cache, 559.0)
        self.assertFalse(self.session.stopping)
        self.session.check_loss(self.engine.cache, 560.0)
        self.assertTrue(self.session.stopping)
        self.assertTrue(self.session.failed)

    def test_a_mark_too_old_to_use_never_prices_a_position(self):
        self.session.mark = (0.0, Price.from_str("70.00"))  # Reading it would be a loss past the limit.
        self.session.check_loss(self.engine.cache, 5000.0)
        self.owned_position()
        self.session.check_loss(self.engine.cache, 5001.0)
        self.assertFalse(self.session.stopping)
        self.session.check_loss(self.engine.cache, 5061.0)
        self.assertTrue(self.session.stopping)
        self.assertTrue(self.session.failed)
        self.assertEqual(self.read_events("stopping")[0]["reason"], "loss_unverified")

    def test_flat_needs_no_mark(self):
        self.session.check_loss(self.engine.cache, 10_000.0)
        self.assertFalse(self.session.stopping)
        self.assertIsNone(self.session.exposed_since)

    def test_a_loss_check_that_cannot_run_takes_the_stop_path(self):
        cache = Mock()
        cache.positions.side_effect = RuntimeError("boom")
        self.session.check_loss(cache, 0.0)
        self.assertTrue(self.session.stopping)
        self.assertTrue(self.session.failed)
        self.assertEqual(self.read_events("loss_unverified")[0]["failure_type"], "RuntimeError")

    def test_the_observer_runs_the_loss_check_on_a_run_only(self):
        position = self.owned_position()
        stop = self.stop()
        self.assertEqual(stop.status, OrderStatus.ACCEPTED)
        self.session.mark = (time.monotonic(), Price.from_str("70.00"))
        observer = SimpleNamespace(session=self.session, cache=self.engine.cache, last_query=0, query_account=Mock())
        self.session.mode = "reconcile"
        live_lifecycle.Observer.observe(observer)
        self.assertFalse(self.session.stopping)
        self.session.mode = "run"
        live_lifecycle.Observer.observe(observer)
        self.assertTrue(self.session.stopping)
        self.assertEqual(self.read_events("stopping")[0]["reason"], "max_loss")
        self.assertEqual(self.engine.cache.position(position.id).side, PositionSide.LONG)

    def test_accepted_stop_for_the_whole_position_keeps_the_run_going(self):
        self.owned_position()
        self.assertEqual(self.stop().status, OrderStatus.ACCEPTED)
        self.check(0)
        self.check(10_000)
        self.assertFalse(self.session.stopping)
        self.assertEqual(self.session.protection_gaps, {})

    def test_position_without_a_stop_is_closed_natively_after_the_allowance(self):
        position = self.owned_position()
        observer = SimpleNamespace(session=self.session, cache=self.engine.cache, last_query=0, query_account=Mock())

        def observe(now):
            self.session.mark = (now, Price.from_str("99.00"))
            with patch.object(live.time, "monotonic", return_value=now):
                live_lifecycle.Observer.observe(observer)

        start = 1000.0  # A whole number: adding and subtracting 90 from an arbitrary float can land below 90.
        observe(start)
        observe(start + 89)
        self.assertFalse(self.session.stopping)
        self.assertEqual(self.engine.cache.positions_open(strategy_id=self.source.strategy_id), [position])
        observe(start + 90)
        self.assertTrue(self.session.stopping)
        self.assertTrue(self.session.failed)
        self.assertEqual(self.read_events("protection_missing")[0]["positions"], [str(position.id)])
        self.advance("99.00", "100.00")
        self.assertEqual(self.engine.cache.positions_open(strategy_id=self.source.strategy_id), [])
        self.session.node.handle.return_value.stop.assert_not_called()
        observe(start + 91)
        self.session.node.handle.return_value.stop.assert_called_once()
        self.assertTrue(self.session.native_flat)
        self.assertTrue(self.session.failed)

    def test_reconciliation_has_no_source_and_runs_no_protection_check(self):
        self.owned_position()
        self.session.mode, self.session.source = "reconcile", None
        live_lifecycle.Observer.observe(SimpleNamespace(session=self.session, cache=self.engine.cache, last_query=0,
                                              query_account=Mock()))
        self.assertFalse(self.session.failed)
        self.assertFalse(self.session.stopping)

    def test_canceling_the_stop_starts_the_allowance_then(self):
        self.owned_position()
        stop = self.stop()
        self.check(0)
        self.source.cancel_order(stop.client_order_id)
        self.advance("99.00", "100.00")
        self.check(500)
        self.assert_late_after(500)

    def test_a_triggered_stop_left_behind_by_the_market_does_not_cover(self):
        position = self.owned_position()
        stop = self.source.order_factory.stop_limit(self.iid, OrderSide.SELL, Quantity.from_str("0.500"),
            Price.from_str("95.00"), Price.from_str("90.00"), reduce_only=True)
        self.source.submit_order(stop, position_id=position.id)
        self.advance("99.00", "100.00")
        self.check(0)
        self.assertEqual(self.session.protection_gaps, {})
        self.advance("50.00", "51.00")
        self.assertEqual(self.engine.cache.order(stop.client_order_id).status, OrderStatus.TRIGGERED)
        self.check(10)
        self.assert_late_after(10)

    def test_a_fill_does_not_extend_the_allowance(self):
        position = self.owned_position()
        self.check(0)
        self.source.submit_order(self.reduction(), position_id=position.id)
        self.advance("99.00", "100.00")
        self.assert_late_after(0)

    def test_a_short_needs_a_stop_on_the_buy_side(self):
        order = self.admit(self.source.order_factory.limit(self.iid, OrderSide.SELL, Quantity.from_str("0.500"),
                                                           Price.from_str("101.00")))
        self.assertEqual(order.status, OrderStatus.ACCEPTED)
        self.advance("101.00", "102.00")
        position = self.engine.cache.positions_open(strategy_id=self.source.strategy_id)[0]
        self.assertEqual(position.side, PositionSide.SHORT)
        self.check(0)
        self.assertEqual(list(self.session.protection_gaps), [str(position.id)])
        stop = self.source.order_factory.stop_market(self.iid, OrderSide.BUY, Quantity.from_str("0.500"),
                                                     Price.from_str("150.00"), reduce_only=True)
        self.source.submit_order(stop, position_id=position.id)
        self.advance("101.00", "102.00")
        self.check(1)
        self.assertEqual(self.session.protection_gaps, {})

    def test_the_check_reads_the_manifests_strategy_not_the_sources_attribute(self):
        position = self.owned_position()
        self.session.source = SimpleNamespace(strategy_id=StrategyId("LIVE-OTHER"))
        self.check(0)
        self.assertEqual(list(self.session.protection_gaps), [str(position.id)])

    def test_a_smaller_stop_is_not_protection(self):
        self.owned_position()
        self.stop("0.200")
        self.check(0)
        self.assert_late_after(0)

    def test_a_check_that_cannot_run_takes_the_stop_path(self):
        cache = Mock()
        cache.positions_open.side_effect = RuntimeError("boom")
        self.session.check_protection(cache, 0)
        self.assertTrue(self.session.stopping)
        self.assertTrue(self.session.failed)
        self.assertEqual(self.read_events("protection_unverified")[0]["failure_type"], "RuntimeError")

    def test_every_condition_of_a_covering_stop_is_required(self):
        position = self.owned_position()
        stop = self.stop()
        fields = dict(instrument_id=stop.instrument_id, is_reduce_only=True, side=stop.side, status=stop.status,
                      order_type=stop.order_type, leaves_qty=stop.leaves_qty)
        changes = [dict(instrument_id=InstrumentId.from_str("ETHUSDT-PERP.BINANCE")), dict(is_reduce_only=False),
                   dict(side=OrderSide.BUY), dict(order_type=OrderType.LIMIT), dict(leaves_qty=Quantity.from_str("0.499")),
                   *(dict(status=status) for status in (OrderStatus.SUBMITTED, OrderStatus.TRIGGERED,
                                                        OrderStatus.PARTIALLY_FILLED, OrderStatus.PENDING_CANCEL,
                                                        OrderStatus.CANCELED, OrderStatus.FILLED))]
        for changed in [{}, *changes]:
            with self.subTest(changed):
                cache = Mock()
                cache.positions_open.return_value = [position]
                cache.orders.return_value = [SimpleNamespace(**{**fields, **changed})]
                self.session.protection_gaps = {}
                self.session.check_protection(cache, 0)
                self.assertEqual(list(self.session.protection_gaps), [str(position.id)] if changed else [])

    def test_first_limit_waits_for_fresh_account_then_native_accepts(self):
        order, observation = self.submit_pending()
        commands.dispatch_entry(self.session)
        self.advance()
        self.assert_no_orders()
        self.finish_read(observation)
        # Completing I/O never dispatches from the worker thread.
        self.assert_no_orders()
        commands.dispatch_entry(self.session)
        self.advance()
        native = self.engine.cache.order(order.client_order_id)
        self.assertEqual(native.status, OrderStatus.ACCEPTED)
        self.assertEqual(native.strategy_id, self.source.strategy_id)
        self.assertIsNone(self.session.pending_entry)
        self.assertIsNone(self.session.account_observation)
        events = [json.loads(line)["event"] for line in (self.root / "events.jsonl").read_text().splitlines()]
        self.assertEqual(events.count("entry_verified"), 1)

    def test_duplicate_pending_entry_discards_both_and_late_result(self):
        _, observation = self.submit_pending()
        self.assert_refused_unchanged("LIVE_ENTRY_STOPPED", lambda: self.source.submit_order(self.limit()))
        self.finish_read(observation)
        commands.dispatch_entry(self.session)
        self.advance()
        self.assert_no_orders()
        self.assertTrue(self.session.stopping)

    def test_native_source_stop_prevents_pending_entry_dispatch(self):
        _, observation = self.submit_pending()
        self.source.stop()
        self.assertFalse(self.source.is_running())
        self.finish_read(observation)
        self.assert_refused_unchanged("LIVE_ENTRY_STOPPED", partial(commands.dispatch_entry, self.session))
        self.assert_no_orders()
        self.assertIsNone(self.session.pending_entry)
        self.assertTrue(self.session.stopping)

    def test_foreign_factory_entry_cannot_escape_source_history(self):
        order = self.foreign.order_factory.limit(self.iid, OrderSide.BUY,
            Quantity.from_str("0.500"), Price.from_str("100.00"))
        self.assert_refused_unchanged("LIVE_ORDER_OWNERSHIP", lambda: self.source.submit_order(order))
        self.assert_no_orders()
        self.assertEqual(self.reader.calls, [])
        self.assertTrue(self.session.stopping)
        self.assert_refused_unchanged("LIVE_ENTRY_STOPPED", lambda: self.source.submit_order(self.limit()))

    def test_foreign_factory_cannot_reduce_an_owned_position(self):
        position = self.owned_position()
        order = self.foreign.order_factory.market(self.iid, OrderSide.SELL,
            position.quantity, reduce_only=True)
        self.assert_refused_unchanged("LIVE_ORDER_OWNERSHIP", lambda:
            self.source.submit_order(order, position_id=position.id))
        self.assertEqual(self.engine.cache.positions_open()[0].quantity, position.quantity)

    def test_entry_for_another_instrument_is_refused_before_account_io(self):
        for name in ("ETHUSDT-PERP.BINANCE", "BTCUSDT-PERP.BYBIT", "BTCUSDT.BINANCE"):
            with self.subTest(name):
                order = self.source.order_factory.limit(InstrumentId.from_str(name), OrderSide.BUY,
                    Quantity.from_str("0.500"), Price.from_str("100.00"))
                self.assert_refused_unchanged("LIVE_INSTRUMENT_SCOPE", lambda: self.source.submit_order(order))
                self.assert_no_orders()
                self.assertEqual(self.reader.calls, [])
                self.assertIsNone(self.session.pending_entry)

    def test_reduction_for_another_instrument_cannot_touch_the_owned_position(self):
        position = self.owned_position()
        order = self.source.order_factory.market(InstrumentId.from_str("ETHUSDT-PERP.BINANCE"), OrderSide.SELL,
            position.quantity, reduce_only=True)
        self.assert_refused_unchanged("LIVE_INSTRUMENT_SCOPE", lambda:
            self.source.submit_order(order, position_id=position.id))
        self.assertEqual(self.engine.cache.positions_open()[0].quantity, position.quantity)

    def admit_next(self):
        """Another entry after the first: its own account read, then dispatch."""
        order = self.limit()
        self.source.submit_order(order)
        self.session.account_observation.result.result(timeout=2)
        commands.dispatch_entry(self.session)
        self.advance()
        return self.engine.cache.order(order.client_order_id)

    def test_a_new_entry_follows_once_the_last_one_is_canceled(self):
        order = self.admit()
        self.source.cancel_order(order.client_order_id)
        self.advance()
        self.assertEqual(self.engine.cache.order(order.client_order_id).status, OrderStatus.CANCELED)
        self.assertEqual(self.admit_next().status, OrderStatus.ACCEPTED)
        self.assertEqual(len(self.reader.calls), 2)  # each entry reads the account afresh
        self.assertFalse(self.session.stopping)

    def test_a_new_entry_follows_once_the_last_position_is_closed(self):
        position = self.owned_position()
        self.source.submit_order(self.reduction("0.500"), position_id=position.id)
        self.advance()
        self.assertEqual(self.engine.cache.positions_open(strategy_id=self.source.strategy_id), [])
        self.assertEqual(self.admit_next().status, OrderStatus.ACCEPTED)
        self.assertEqual(len(self.reader.calls), 2)

    def test_an_entry_waits_for_the_last_position_to_close(self):
        self.owned_position()
        self.assert_refused_unchanged("LIVE_ENTRY_STOPPED", lambda: self.source.submit_order(self.limit()))
        self.assertEqual(len(self.reader.calls), 1)
        self.assertTrue(self.session.stopping)

    def test_an_entry_waits_for_the_last_entry_order(self):
        self.admit()
        self.assert_refused_unchanged("LIVE_ENTRY_STOPPED", lambda: self.source.submit_order(self.limit()))
        self.assertEqual(len(self.reader.calls), 1)

    def assert_pending_cancel(self, method):
        order, observation = self.submit_pending()
        if method == "cancel_order":
            self.source.cancel_order(order.client_order_id)
        elif method == "cancel_orders":
            self.source.cancel_orders([order.client_order_id])
        elif method == "cancel_all_orders":
            self.source.cancel_all_orders(self.iid)
        else:
            self.source.market_exit()
        self.finish_read(observation)
        commands.dispatch_entry(self.session)
        self.advance()
        self.assert_no_orders()
        self.assertTrue(self.session.stopping)
        self.assertIsNone(self.session.pending_entry)
        with self.assertRaisesRegex(LiveRefusal, "LIVE_ENTRY_STOPPED"):
            self.source.submit_order(self.limit())

    def test_cancel_unsubmitted_entry_discards_late_observation(self):
        self.assert_pending_cancel("cancel_order")

    def test_cancel_batch_with_unsubmitted_entry_discards_late_observation(self):
        self.assert_pending_cancel("cancel_orders")

    def test_cancel_all_discards_unsubmitted_entry(self):
        self.assert_pending_cancel("cancel_all_orders")

    def test_native_market_exit_discards_unsubmitted_entry(self):
        self.assert_pending_cancel("market_exit")

    def test_order_modifications_are_not_a_second_entry_budget_path(self):
        order = self.admit()
        self.assert_refused_unchanged("LIVE_ORDER_UNSUPPORTED", lambda:
            self.source.modify_order(order.client_order_id, quantity=Quantity.from_str("1.000")))
        self.assert_refused_unchanged("LIVE_ORDER_UNSUPPORTED", lambda: self.source.modify_orders([]))

    def test_entry_notional_over_cap_never_starts_account_io(self):
        self.assert_refused_unchanged("LIVE_BUDGET", lambda: self.source.submit_order(self.limit(quantity="1.000")))
        self.assertEqual(self.reader.calls, [])
        self.assert_no_orders()

    def test_entry_cap_over_budget_never_dispatches(self):
        self.manifest["config"]["budget_usdt"] = "80"
        self.assert_refused_unchanged("LIVE_BUDGET", lambda: self.source.submit_order(self.limit()))
        self.assert_no_orders()

    def test_market_entry_is_not_a_bounded_limit(self):
        order = self.source.order_factory.market(self.iid, OrderSide.BUY, Quantity.from_str("0.500"))
        self.assert_refused_unchanged("LIVE_ORDER_UNSUPPORTED", lambda: self.source.submit_order(order))
        self.assert_no_orders()

    def test_gtd_expiring_during_observation_never_dispatches(self):
        expiry = self.ts + 2_000_000_000
        _, observation = self.submit_pending(self.limit(time_in_force=TimeInForce.GTD, expire_time=expiry))
        self.finish_read(observation)
        with patch.object(live.time, "time_ns", return_value=expiry + 1):
            self.assert_refused_unchanged("LIVE_ENTRY_STOPPED", partial(commands.dispatch_entry, self.session))
        self.assert_no_orders()

    def test_stop_file_during_observation_never_dispatches(self):
        _, observation = self.submit_pending()
        (self.root / "STOP").write_text("")
        self.finish_read(observation)
        self.assert_refused_unchanged("LIVE_ENTRY_STOPPED", partial(commands.dispatch_entry, self.session))
        self.assert_no_orders()

    def test_storage_failure_during_observation_never_dispatches_entry(self):
        _, observation = self.submit_pending()
        self.session.persistence_failed = True
        self.finish_read(observation)
        self.assert_refused_unchanged("LIVE_ENTRY_STOPPED", partial(commands.dispatch_entry, self.session))
        self.assert_no_orders()

    def test_stale_snapshot_cannot_dispatch(self):
        self.reader.snapshot_value["observed_ns"] -= 60_000_000_000
        _, observation = self.submit_pending()
        self.finish_read(observation)
        with self.assertRaises(LiveRefusal):
            commands.dispatch_entry(self.session)
        self.advance()
        self.assert_no_orders()

    def test_observation_deadline_expiry_discards_even_completed_result(self):
        _, observation = self.submit_pending()
        self.finish_read(observation)
        with patch.object(live.time, "monotonic", return_value=observation.deadline + 1):
            self.assert_refused_unchanged("LIVE_OBSERVATION_STALE", partial(commands.dispatch_entry, self.session))
        self.assert_no_orders()
        self.assertIsNone(self.session.pending_entry)

    def test_account_io_failure_never_dispatches(self):
        self.reader.failure = OSError("fixture account response unavailable")
        _, observation = self.submit_pending()
        self.reader.release.set()
        with self.assertRaises(OSError):
            observation.result.result(timeout=2)
        with self.assertRaises(OSError):
            commands.dispatch_entry(self.session)
        self.advance()
        self.assert_no_orders()
        self.assertTrue(self.session.stopping)

    def test_changed_account_mode_in_fresh_snapshot_never_dispatches(self):
        self.reader.snapshot_value["config"]["dualSidePosition"] = False
        _, observation = self.submit_pending()
        self.finish_read(observation)
        self.assert_refused_unchanged("LIVE_ACCOUNT_MODE", partial(commands.dispatch_entry, self.session))
        self.assert_no_orders()

    def test_foreign_exposure_discovered_by_fresh_read_cannot_dispatch(self):
        self.reader.snapshot_value["orders"] = [{"symbol": "ETHUSDT"}]
        _, observation = self.submit_pending()
        self.finish_read(observation)
        with self.assertRaises(LiveRefusal):
            commands.dispatch_entry(self.session)
        self.advance()
        self.assert_no_orders()

    def test_disconnect_discards_late_future_and_never_rearms(self):
        _, observation = self.submit_pending()
        self.session.lose_connection("fixture_disconnect")
        self.assertFalse(self.source.is_running())
        self.assertTrue(self.session.node.handle().stop.called)
        self.finish_read(observation)
        commands.dispatch_entry(self.session)
        self.advance()
        self.assert_no_orders()
        self.assertIsNone(self.session.account_observation)
        self.assertFalse(self.session.account_verified)
        self.assert_refused_unchanged("LIVE_CONNECTION_UNVERIFIED", lambda: self.source.submit_order(self.limit()))

    def test_owned_native_reduction_is_accepted_and_filled(self):
        position = self.owned_position()
        order = self.reduction()
        self.source.submit_order(order, position_id=position.id)
        self.advance()
        self.assertEqual(self.engine.cache.order(order.client_order_id).status, OrderStatus.FILLED)
        self.assertEqual(self.engine.cache.position(position.id).quantity, Quantity.from_str("0.300"))
        self.assertEqual(len(self.reader.calls), 1, "a reduction must not require fresh-entry flatness")

    def test_reduction_requires_existing_native_position(self):
        for position_id in (None, PositionId("MISSING-001")):
            with self.subTest(position_id=position_id):
                self.assert_refused_unchanged("LIVE_ORDER_OWNERSHIP", lambda: self.source.submit_order(
                    self.reduction(), position_id=position_id))
        self.assert_no_orders()

    def test_foreign_native_position_is_not_adopted(self):
        order = self.foreign.order_factory.market(self.iid, OrderSide.BUY, Quantity.from_str("0.500"))
        self.foreign.submit_order(order)
        self.advance()
        positions = self.engine.cache.positions_open(strategy_id=self.foreign.strategy_id)
        self.assertEqual(len(positions), 1)
        position = positions[0]
        self.assertNotEqual(position.strategy_id, self.source.strategy_id)
        self.assert_refused_unchanged("LIVE_ORDER_OWNERSHIP", lambda: self.source.submit_order(
            self.reduction(), position_id=position.id))
        self.assert_refused_unchanged("LIVE_ORDER_OWNERSHIP", lambda: self.source.close_position(position))
        self.assertEqual(self.engine.cache.position(position.id).quantity, Quantity.from_str("0.500"))

    def test_wrong_side_and_oversize_reductions_never_dispatch(self):
        position = self.owned_position()
        for order in (self.reduction(side=OrderSide.BUY), self.reduction(quantity="0.501")):
            with self.subTest(order=order):
                self.assert_refused_unchanged("LIVE_ORDER_OWNERSHIP", lambda: self.source.submit_order(
                    order, position_id=position.id))
        self.assertEqual(self.engine.cache.position(position.id).quantity, Quantity.from_str("0.500"))

    def test_close_position_cannot_disable_reduce_only(self):
        position = self.owned_position()
        self.assert_refused_unchanged("LIVE_ORDER_UNSUPPORTED", lambda: self.source.close_position(position, reduce_only=False))
        self.assertEqual(self.engine.cache.position(position.id).quantity, Quantity.from_str("0.500"))

    def test_storage_failure_still_allows_owned_reduction_and_close(self):
        position = self.owned_position()
        self.session.persistence_failed = True
        self.session.begin_stop("fixture_persistence_failure")
        reduction = self.reduction()
        self.source.submit_order(reduction, position_id=position.id)
        self.advance()
        self.assertEqual(self.engine.cache.order(reduction.client_order_id).status, OrderStatus.FILLED)
        remaining = self.engine.cache.position(position.id)
        self.assertEqual(remaining.quantity, Quantity.from_str("0.300"))
        self.source.close_position(remaining, reduce_only=True)
        self.advance()
        self.assertTrue(self.engine.cache.position(position.id).is_closed)
        self.assertEqual(self.engine.cache.positions_open(), [])
        self.assertTrue(all(order.status == OrderStatus.FILLED for order in self.engine.cache.orders()))

    def test_unverified_connection_blocks_owned_reduction_and_close(self):
        position = self.owned_position()
        self.session.lose_connection("fixture_disconnect")
        self.assert_refused_unchanged("LIVE_CONNECTION_UNVERIFIED", lambda: self.source.submit_order(
            self.reduction(), position_id=position.id))
        self.assert_refused_unchanged("LIVE_CONNECTION_UNVERIFIED", lambda: self.source.close_position(position))
        self.assertFalse(self.engine.cache.position(position.id).is_closed)

    def test_close_above_entry_cap_fills_with_actual_build_node_risk_config(self):
        self.assertFalse(self.live_risk.bypass)
        self.assertEqual(self.live_risk.max_notional_per_order, {})
        position = self.owned_position()
        self.advance("200.00", "201.00")
        close_notional = self.instrument.notional_value(position.quantity, Price.from_str("200.00"))
        self.assertGreater(close_notional.as_decimal(), Decimal(self.manifest["config"]["max_notional_per_order"]))
        self.source.close_position(position, reduce_only=True)
        self.advance("200.00", "201.00")
        self.assertTrue(self.engine.cache.position(position.id).is_closed)
        exits = [order for order in self.engine.cache.orders() if order.is_reduce_only]
        self.assertEqual(len(exits), 1)
        self.assertEqual(exits[0].status, OrderStatus.FILLED)


if __name__ == "__main__":
    unittest.main()
