"""Live admission and reductions dispatch through the pinned native engine.

Only read-only account I/O is delayed by a fixture. Orders, positions, risk,
cache, source loading, admission and deferred submission remain product/native.
The streaming backtest clock is controlled; this is not live-socket evidence.
"""

import copy
from decimal import Decimal
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
    AccountType, BookType, CryptoPerpetual, Currency, InstrumentId, Money,
    OmsType, OrderSide, OrderStatus, OrderType, PositionId, PositionSide, Price, Quantity, QuoteTick,
    StrategyId, Symbol, TimeInForce, Venue,
)
from nautilus_trader.risk import RiskEngineConfig
from nautilus_trader.trading import Strategy, StrategyConfig

from engine import live
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
    original = live.LiveRiskEngineConfig
    captured = []

    class CapturedConfig(Exception):
        pass

    def capture(*args, **kwargs):
        captured.append(original(*args, **kwargs))
        raise CapturedConfig

    with patch.object(live, "LiveRiskEngineConfig", side_effect=capture):
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
        live.run.clear_failures()
        self.addCleanup(live.run.clear_failures)
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
        self.session.verify_connected_account(self.snapshot)
        self.live_risk, risk = configured_risk(self.session)
        self.source = live.live_source(live.source_for_run(self.manifest), self.session)
        self.session.source = self.source
        self.session.node = Mock()  # Records stop request; does not replace native execution.
        self.engine = BacktestEngine(BacktestEngineConfig(risk_engine=risk,
            logging=LoggerConfig(stdout_level=LogLevel.ERROR, print_config=False)))
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
        self.session.dispatch_entry()
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
        self.check(start + live.PROTECTION_SECONDS - 1)
        self.assertFalse(self.session.stopping)
        self.check(start + live.PROTECTION_SECONDS)
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
            with patch.object(live.time, "monotonic", return_value=now):
                live.Observer.observe(observer)

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
        live.Observer.observe(SimpleNamespace(session=self.session, cache=self.engine.cache, last_query=0,
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
        self.session.dispatch_entry()
        self.advance()
        self.assert_no_orders()
        self.finish_read(observation)
        # Completing I/O never dispatches from the worker thread.
        self.assert_no_orders()
        self.session.dispatch_entry()
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
        self.session.dispatch_entry()
        self.advance()
        self.assert_no_orders()
        self.assertTrue(self.session.stopping)

    def test_native_source_stop_prevents_pending_entry_dispatch(self):
        _, observation = self.submit_pending()
        self.source.stop()
        self.assertFalse(self.source.is_running())
        self.finish_read(observation)
        self.assert_refused_unchanged("LIVE_ENTRY_STOPPED", self.session.dispatch_entry)
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

    def test_entry_cannot_repeat_after_native_cancel(self):
        order = self.admit()
        self.source.cancel_order(order.client_order_id)
        self.advance()
        self.assertEqual(self.engine.cache.order(order.client_order_id).status, OrderStatus.CANCELED)
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
        self.session.dispatch_entry()
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
            self.assert_refused_unchanged("LIVE_ENTRY_STOPPED", self.session.dispatch_entry)
        self.assert_no_orders()

    def test_stop_file_during_observation_never_dispatches(self):
        _, observation = self.submit_pending()
        (self.root / "STOP").write_text("")
        self.finish_read(observation)
        self.assert_refused_unchanged("LIVE_ENTRY_STOPPED", self.session.dispatch_entry)
        self.assert_no_orders()

    def test_storage_failure_during_observation_never_dispatches_entry(self):
        _, observation = self.submit_pending()
        self.session.persistence_failed = True
        self.finish_read(observation)
        self.assert_refused_unchanged("LIVE_ENTRY_STOPPED", self.session.dispatch_entry)
        self.assert_no_orders()

    def test_stale_snapshot_cannot_dispatch(self):
        self.reader.snapshot_value["observed_ns"] -= 60_000_000_000
        _, observation = self.submit_pending()
        self.finish_read(observation)
        with self.assertRaises(LiveRefusal):
            self.session.dispatch_entry()
        self.advance()
        self.assert_no_orders()

    def test_observation_deadline_expiry_discards_even_completed_result(self):
        _, observation = self.submit_pending()
        self.finish_read(observation)
        with patch.object(live.time, "monotonic", return_value=observation.deadline + 1):
            self.assert_refused_unchanged("LIVE_OBSERVATION_STALE", self.session.dispatch_entry)
        self.assert_no_orders()
        self.assertIsNone(self.session.pending_entry)

    def test_account_io_failure_never_dispatches(self):
        self.reader.failure = OSError("fixture account response unavailable")
        _, observation = self.submit_pending()
        self.reader.release.set()
        with self.assertRaises(OSError):
            observation.result.result(timeout=2)
        with self.assertRaises(OSError):
            self.session.dispatch_entry()
        self.advance()
        self.assert_no_orders()
        self.assertTrue(self.session.stopping)

    def test_changed_account_mode_in_fresh_snapshot_never_dispatches(self):
        self.reader.snapshot_value["config"]["dualSidePosition"] = False
        _, observation = self.submit_pending()
        self.finish_read(observation)
        self.assert_refused_unchanged("LIVE_ACCOUNT_MODE", self.session.dispatch_entry)
        self.assert_no_orders()

    def test_foreign_exposure_discovered_by_fresh_read_cannot_dispatch(self):
        self.reader.snapshot_value["orders"] = [{"symbol": "ETHUSDT"}]
        _, observation = self.submit_pending()
        self.finish_read(observation)
        with self.assertRaises(LiveRefusal):
            self.session.dispatch_entry()
        self.advance()
        self.assert_no_orders()

    def test_disconnect_discards_late_future_and_never_rearms(self):
        _, observation = self.submit_pending()
        self.session.lose_connection("fixture_disconnect")
        self.assertFalse(self.source.is_running())
        self.assertTrue(self.session.node.handle().stop.called)
        self.finish_read(observation)
        self.session.dispatch_entry()
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
