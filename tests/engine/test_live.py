"""Offline Live assembly and ownership boundaries; no authenticated venue calls."""

from argparse import Namespace
from decimal import Decimal
import fcntl
import hashlib
import gc
import json
from pathlib import Path
import tempfile
import threading
from types import SimpleNamespace
import unittest
from unittest import mock

from nautilus_trader.common import SocketState
from nautilus_trader.infrastructure import RedisCacheConfig
from nautilus_trader.model import AccountId, InstrumentId, OrderSide, OrderStatus, OrderType, Price, Quantity

from engine import live
from engine import live_commands as commands, live_lifecycle, live_node, live_session, live_source as live_source_runtime
from engine.config import RUNTIME_CONTRACT, Refusal
from engine.live_errors import LiveRefusal
from engine.live_records import strategy_ids
from engine.live_venue import Credentials, require_account_mode
from tests.engine.test_live_venue import MARKET_DAY
from tests.helpers import refused


SOURCE = '''from nautilus_trader.trading import Strategy
class Source(Strategy):
    def __init__(self, instrument_id, bar_type, **kwargs):
        super().__init__()
        self.observed = []
        self.findings = []
    def on_bar(self, event):
        self.observed.append("bar")
    def on_order_event(self, event):
        self.observed.append("order")
    def on_order_denied(self, event):
        self.findings.append(f"order denied {event.client_order_id}: {event.reason}")
    def replay_diagnostics(self):
        return {}
    def replay_integrity_findings(self, orders_denied_or_rejected=False):
        return list(self.findings)
'''


class LiveTests(unittest.TestCase):
    def setUp(self):
        live.strategy_runtime.STRATEGIES.clear()
        gc.collect()  # Release native nodes retained by previous mock-exception tracebacks.
        live.strategy_runtime.clear_failures()
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        clock = mock.patch.object(live.BinanceReadOnly, "clock", side_effect=self.good_clock)  # Never the venue.
        clock.start()
        self.addCleanup(clock.stop)
        # The wallet comparison is tests/live/test_replay_evidence.py's; here every run is backed.
        evidence = mock.patch.object(live, "require_evidence", side_effect=lambda _, manifest: manifest["evidence"][0])
        evidence.start()
        self.addCleanup(evidence.stop)
        self.output = Path(self.temp.name)
        self.strategy = self.output / "source.py"
        self.strategy.write_text(SOURCE)
        self.universe = self.output / "universe.json"
        self.universe.write_text('{"membership":{"BTCUSDT":[[0,9999999999999999999]]}}')
        self.credentials = Credentials("offline-placeholder", "offline-placeholder")
        self.manifest = {
            "format": live.MANIFEST_FORMAT, "run_id": "native-test", "trader_id": "LIVE-001",
            "account_id": "BINANCE-LIVE-001", "credential_binding": self.credentials.binding,
            "symbols": ["BTCUSDT"], "candidate": {"strategy_id": "example", "revision": 1}, "source": {
                "entry_class": "Source",
                "source_sha256": hashlib.sha256(SOURCE.encode()).hexdigest()},
            "runtime": {"image_ref": "ghcr.io/qoeop/trade-runtime@sha256:" + "a" * 64,
                        "image_digest": "sha256:" + "a" * 64, "runtime_contract": RUNTIME_CONTRACT},
            "config": {"environment": "live", "drawdown_brake": "0.15", "duration_seconds": 30, "leverage": "50"},
            "market": {"market_day": MARKET_DAY, "terms": {"BTCUSDT": {
                "price_increment": "0.10", "size_increment": "0.001", "min_notional": "50"}}},
            "strategy_file": str(self.strategy), "universe_file": str(self.universe),
            "universe_sha256": hashlib.sha256(self.universe.read_bytes()).hexdigest(),
            "evidence": [{"trial_id": 7, "starting_balance_usdt": "100",
                          "image_ref": "ghcr.io/qoeop/trade-runtime@sha256:" + "c" * 64}],
        }
        self.instance = strategy_ids(self.manifest)["BTCUSDT"]  # the BTCUSDT instance's native identity

    def test_manifest_cannot_rebind_account_source_or_runtime(self):
        live.bind_manifest(self.output, self.manifest)
        live.bind_manifest(self.output, self.manifest)
        changed = {**self.manifest, "account_id": "BINANCE-ANOTHER"}
        with self.assertRaisesRegex(LiveRefusal, "LIVE_IDENTITY_CHANGED"):
            live.bind_manifest(self.output, changed)
        self.assertEqual(json.loads((self.output / "manifest.json").read_text()), self.manifest)

    def test_invalid_manifest_no_nan_and_distinct_symbols_with_terms(self):
        path = self.output / "input.json"
        terms = {**self.manifest["market"]["terms"], "ETHUSDT": self.manifest["market"]["terms"]["BTCUSDT"]}
        path.write_text(json.dumps({**self.manifest, "symbols": ["BTCUSDT", "ETHUSDT"],
                                    "market": {**self.manifest["market"], "terms": terms}}))
        self.assertEqual(live.read_manifest(path)["symbols"], ["BTCUSDT", "ETHUSDT"])  # one instance each
        # A non-ASCII coin is a contract as live.configuration and the market take it (market.sources.SYMBOL).
        terms = {"币安人生USDT": self.manifest["market"]["terms"]["BTCUSDT"]}
        path.write_text(json.dumps({**self.manifest, "symbols": ["币安人生USDT"],
                                    "market": {**self.manifest["market"], "terms": terms}}))
        self.assertEqual(live.read_manifest(path)["symbols"], ["币安人生USDT"])
        for change in ({"symbols": ["BTCUSDT", "ETHUSDT"]}, {"symbols": ["BTCUSDT", "BTCUSDT"]}, {"symbols": []},
                       {"symbols": ["USDT"]}, {"symbols": ["BTC_USDT"]}, {"symbols": ["BTCUSDC"]},
                       {"config": {**self.manifest["config"], "drawdown_brake": "NaN"}},
                       {"config": {**self.manifest["config"], "duration_seconds": True}}):
            with self.subTest(change=change):
                path.write_text(json.dumps({**self.manifest, **change}))
                with self.assertRaisesRegex(LiveRefusal, "LIVE_MANIFEST_INVALID"):
                    live.read_manifest(path)

    def test_the_manifest_takes_binances_leverage_range_from_engine_config(self):
        path = self.output / "input.json"
        for leverage in ("1", "125", "0", "126", "03", "2.5", 3, None):
            path.write_text(json.dumps({**self.manifest, "config": {**self.manifest["config"], "leverage": leverage}}))
            with self.subTest(leverage=leverage):
                if leverage in ("1", "125"):
                    live.read_manifest(path)
                else:
                    with self.assertRaisesRegex(LiveRefusal, "LIVE_MANIFEST_INVALID"):
                        live.read_manifest(path)

    def test_linked_source_is_rejected_before_executing_or_connecting(self):
        source = SOURCE + "\n# native execution unsupported\nvalue = item.submit_order_list\n"
        self.strategy.write_text(source)
        self.manifest["source"]["source_sha256"] = hashlib.sha256(source.encode()).hexdigest()
        with self.assertRaisesRegex(Refusal, "ORDER_RULE"):  # engine.load, before the file runs
            live.source_for_run(self.manifest)

    def test_runner_refuses_any_other_manifest_format(self):
        path = self.output / "other-format.json"
        path.write_text(json.dumps({**self.manifest, "format": "live-run-v1"}))
        self.assertEqual(refused(live.read_manifest, path, error=LiveRefusal).code, "LIVE_MANIFEST_INVALID")

    def test_runner_requires_a_drawdown_brake_no_looser_than_the_target(self):
        for limit in (None, "0", "-0.1", "NaN", "0.1501"):
            with self.subTest(limit):
                config = dict(self.manifest["config"], drawdown_brake=limit)
                if limit is None:
                    del config["drawdown_brake"]
                path = self.output / "brake.json"
                path.write_text(json.dumps({**self.manifest, "config": config}))
                self.assertEqual(refused(live.read_manifest, path, error=LiveRefusal).code, "LIVE_MANIFEST_INVALID")

    def test_reconcile_build_has_no_source_constructor_or_source_callbacks(self):
        session = live.Session(self.manifest, self.output, "reconcile", account_verified=True)
        with mock.patch.object(live_node, "live_source") as source:
            node = live.build_node(session, self.credentials, RedisCacheConfig(host="127.0.0.1", port=1))
            source.assert_not_called()
            self.assertEqual(session.sources, {})
            self.assertIsNone(session.entry_gate)  # nothing to deny without a source
            self.assertEqual(str(node.environment), "LIVE")
            node.dispose()
            session.node = None

    def test_commands_require_post_connect_account_and_disconnect_only_closes_entries(self):
        session = live.Session(self.manifest, self.output, "run")
        node = live.build_node(session, self.credentials, RedisCacheConfig(host="127.0.0.1", port=1),
                               live.source_for_run(self.manifest))
        try:
            source = session.sources["BTCUSDT"]
            iid = InstrumentId.from_str("BTCUSDT-PERP.BINANCE")
            order = source.order_factory.market(iid, OrderSide.BUY, Quantity.from_str("0.001"))
            commands = (
                lambda: source.submit_order(order), lambda: source.cancel_order(order.client_order_id),
                lambda: source.cancel_orders([order.client_order_id]), lambda: source.cancel_all_orders(iid),
                lambda: source.close_position(None), lambda: source.market_exit(),
            )
            for command in commands:
                with self.assertRaisesRegex(LiveRefusal, "LIVE_CONNECTION_UNVERIFIED"):
                    command()
            self.assertIsNone(node.cache.order(order.client_order_id))
            session.account_verified = True  # Model completed account admission for this unit boundary.
            session.node = mock.Mock()
            observer = SimpleNamespace(session=session)
            event = SimpleNamespace(client_id="BINANCE", endpoint="binance-futures-market-streams-1",
                                    state=SocketState.DISCONNECTED)
            live_lifecycle.Observer.on_socket_state(observer, event)
            # A disconnect after the verified start closes entries; it no longer ends the run.
            self.assertTrue(session.account_verified)
            self.assertFalse(session.connection_failed or session.failed or session.stopping)
            session.node.handle.return_value.stop.assert_not_called()
            self.assertEqual(set(session.connection.closed), {"disconnected"})
            event.state = SocketState.CONNECTED
            live_lifecycle.Observer.on_socket_state(observer, event)
            self.assertEqual(set(session.connection.closed), {"unverified"})  # reopened only by agreeing comparisons
            source.on_order_event(SimpleNamespace(to_dict=lambda: {"type": "OrderFilled"}))
            self.assertEqual(source.observed, ["order"])
            session.event("clean_stop")  # a disconnect no longer taints a flat end
        finally:
            node.dispose()
            session.node, session.sources = None, {}

    def test_post_connect_admission_rechecks_account_and_failure_preserves_custody(self):
        from tests.engine.test_live_venue import fixture

        for changed_mode in (False, True):
            with self.subTest(changed_mode=changed_mode):
                snapshot, _ = fixture()
                snapshot["credential_binding"] = self.credentials.binding
                snapshot["config"]["dualSidePosition"] = not changed_mode
                session = live.Session(self.manifest, self.output, "run")
                session.brake.budget = Decimal("85")
                session.account_reader = mock.Mock()
                session.account_reader.snapshot.return_value = snapshot
                session.node = mock.Mock()
                observer = SimpleNamespace(session=session, last_query=live.time.monotonic(), cache=mock.Mock())
                observer.cache.positions.return_value = observer.cache.positions_open.return_value = observer.cache.orders.return_value = []
                commands.start_observation(session, "connected")
                session.account_observation.result.result(timeout=1)
                live_lifecycle.Observer.observe(observer)
                # The connected check's read; a run's brake then reads the account too (engine.live_brake).
                self.assertEqual(session.account_reader.snapshot.call_args_list[0], mock.call(["BTCUSDT"]))
                self.assertEqual(session.account_verified, not changed_mode)
                self.assertEqual(session.connection_failed, changed_mode)
                if changed_mode:
                    session.node.handle.return_value.stop.assert_called_once()
                    observer.cache.positions_open.assert_not_called()
                else:
                    session.node.handle.return_value.stop.assert_not_called()

    def test_pending_account_read_does_not_block_stop_or_rearm_after_late_result(self):
        from tests.engine.test_live_venue import fixture

        for disconnect in (False, True):
            with self.subTest(disconnect=disconnect):
                snapshot, _ = fixture()
                snapshot["credential_binding"] = self.credentials.binding
                entered, release = threading.Event(), threading.Event()

                def read(_symbols):
                    entered.set()
                    if not release.wait(2):
                        raise TimeoutError("fixture read was not released")
                    return snapshot

                session = live.Session(self.manifest, self.output, "run")
                session.account_reader = mock.Mock()
                session.account_reader.snapshot.side_effect = read
                session.node = mock.Mock()
                observer = SimpleNamespace(session=session, last_query=live.time.monotonic(), cache=mock.Mock())
                try:
                    live_lifecycle.Observer.observe(observer)
                    self.assertTrue(entered.wait(1))
                    future = session.account_observation.result
                    self.assertFalse(future.done())
                    self.assertFalse(session.account_verified)
                    with self.assertRaisesRegex(LiveRefusal, "LIVE_CONNECTION_UNVERIFIED"):
                        commands.require_connection(session)
                    if disconnect:
                        live_lifecycle.Observer.on_socket_state(observer, SimpleNamespace(client_id="BINANCE",
                            endpoint="user-stream", state=SocketState.DISCONNECTED))
                    else:
                        (self.output / "STOP").touch()
                        live_lifecycle.Observer.observe(observer)
                    self.assertIsNone(session.account_observation)
                    session.node.handle.return_value.stop.assert_called_once()
                    release.set()
                    future.result(timeout=1)
                    live_lifecycle.Observer.observe(observer)
                    self.assertFalse(session.account_verified)
                    with self.assertRaisesRegex(LiveRefusal, "LIVE_CONNECTION_UNVERIFIED"):
                        commands.verify_connected_account(session, snapshot)
                    session.account_reader.snapshot.assert_called_once()
                finally:
                    release.set()
                    (self.output / "STOP").unlink(missing_ok=True)

    def test_native_source_blocks_entries_after_stop_but_receives_fills(self):
        loaded = live.source_for_run(self.manifest)
        session = live.Session(self.manifest, self.output, "run", account_verified=True)
        node = live.build_node(session, self.credentials, RedisCacheConfig(host="127.0.0.1", port=1), loaded)
        def cleanup():
            node.dispose()
            session.node, session.sources = None, {}
        self.addCleanup(cleanup)
        source = session.sources["BTCUSDT"]
        source.on_bar(SimpleNamespace(ts_event=9999999999999999999, bar_type="BTCUSDT-PERP.BINANCE-1-MINUTE-LAST-EXTERNAL"))
        session.begin_stop("test")
        source.on_bar(SimpleNamespace(ts_event=9999999999999999999, bar_type="BTCUSDT-PERP.BINANCE-1-MINUTE-LAST-EXTERNAL"))
        source.on_order_event(SimpleNamespace(to_dict=lambda: {"type": "OrderFilled"}))
        self.assertEqual(source.observed, ["bar", "order"])
        order = source.order_factory.market(InstrumentId.from_str("BTCUSDT-PERP.BINANCE"),
                                            OrderSide.BUY, Quantity.from_str("0.001"))
        with self.assertRaisesRegex(LiveRefusal, "LIVE_ENTRY_STOPPED"):
            source.submit_order(order)
        with self.assertRaisesRegex(Refusal, "ORDER_RULE"):
            source.cancel_all_orders(order.instrument_id, strategy_only=False)

    def test_a_run_node_registers_the_native_entry_gate(self):
        loaded = live.source_for_run(self.manifest)
        session = live.Session(self.manifest, self.output, "run", account_verified=True)
        node = live.build_node(session, self.credentials, RedisCacheConfig(host="127.0.0.1", port=1), loaded)
        try:
            self.assertEqual(session.entry_gate.exec_algorithm_id, live_node.ENTRY_GATE)
            self.assertTrue(session.entry_gate.is_registered())
            order = session.sources["BTCUSDT"].order_factory.limit(InstrumentId.from_str("BTCUSDT-PERP.BINANCE"), OrderSide.BUY,
                                                       Quantity.from_str("0.001"), Price.from_str("90.00"))
            # Denied in the node's own cache; a started source also hears it (tests/engine/test_live_entry.py).
            session.entry_gate.deny_order(order, "bars_missing")
            self.assertEqual(node.cache.order(order.client_order_id).status, OrderStatus.DENIED)
        finally:
            node.dispose()
            session.node, session.sources, session.entry_gate = None, {}, None

    def test_a_run_node_purges_account_states_in_memory_and_keeps_orders_and_positions(self):
        loaded = live.source_for_run(self.manifest)
        session = live.Session(self.manifest, self.output, "run", account_verified=True)
        configs, native_config = [], live_node.LiveExecutionEngineConfig
        def config(**fields):
            configs.append(native_config(**fields))
            return configs[-1]
        with mock.patch.object(live_node, "LiveExecutionEngineConfig", side_effect=config):
            node = live.build_node(session, self.credentials, RedisCacheConfig(host="127.0.0.1", port=1), loaded)
        try:
            [native] = configs
            self.assertEqual(native.purge_account_events_interval_mins, 60)
            self.assertEqual(native.purge_account_events_lookback_mins, 24 * 60)
            # Every start's reports read the whole run's orders and positions from the cache (live compare).
            self.assertIsNone(native.purge_closed_orders_interval_mins)
            self.assertIsNone(native.purge_closed_positions_interval_mins)
        finally:
            node.dispose()
            session.node, session.sources, session.entry_gate = None, {}, None

    def test_the_native_account_is_refreshed_every_minute(self):
        session = live.Session(self.manifest, self.output, "reconcile", account_verified=True)
        session.node = mock.Mock()
        observer = SimpleNamespace(session=session, last_query=0.0, cache=mock.Mock(), query_account=mock.Mock())
        for now, calls in ((100.0, 1), (159.0, 1), (160.0, 2)):
            with mock.patch.object(live.time, "monotonic", return_value=now):
                live_lifecycle.Observer.observe(observer)
            self.assertEqual(observer.query_account.call_count, calls, now)

    def test_an_entrys_own_account_read_also_refreshes_the_native_account(self):
        session = live.Session(self.manifest, self.output, "run", account_verified=True)
        session.sources = {"BTCUSDT": object()}
        with mock.patch.object(commands, "Strategy") as native, mock.patch.object(commands, "observe_account"):
            commands.start_observation(session, "connected")  # the start's own check: no entry to admit
            native.query_account.assert_not_called()
            session.account_observation = None
            commands.start_observation(session, "entry")
            native.query_account.assert_called_once_with(session.sources["BTCUSDT"], AccountId(self.manifest["account_id"]))
            session.account_observation, native.query_account.side_effect = None, RuntimeError("closed")
            commands.start_observation(session, "entry")  # a failed refresh never refuses the entry
        self.assertIsNotNone(session.account_observation)
        rows = [json.loads(line) for line in (self.output / "events.jsonl").read_text().splitlines()]
        self.assertEqual([row["failure_type"] for row in rows if row["event"] == "account_refresh_failed"],
                         ["RuntimeError"])

    def test_pending_stop_is_applied_before_next_observer_tick(self):
        loaded = live.source_for_run(self.manifest)
        session = live.Session(self.manifest, self.output, "run", account_verified=True)
        node = live.build_node(session, self.credentials, RedisCacheConfig(host="127.0.0.1", port=1), loaded)
        try:
            source = session.sources["BTCUSDT"]
            (self.output / "STOP").touch()
            order = source.order_factory.market(InstrumentId.from_str("BTCUSDT-PERP.BINANCE"),
                                                OrderSide.BUY, Quantity.from_str("0.001"))
            with self.assertRaisesRegex(LiveRefusal, "LIVE_ENTRY_STOPPED"):
                source.submit_order(order)
            self.assertTrue(session.stopping)
            source.on_bar(SimpleNamespace(ts_event=9999999999999999999, bar_type="BTCUSDT-PERP.BINANCE-1-MINUTE-LAST-EXTERNAL"))
            self.assertEqual(source.observed, [])
        finally:
            node.dispose()
            session.node, session.sources = None, {}

    def test_the_source_hears_the_minutes_after_its_t(self):
        loaded = live.source_for_run(self.manifest)
        session = live.Session(self.manifest, self.output, "run", account_verified=True)
        start = 1_767_225_600_000_000_000
        with mock.patch.object(live.time, "time_ns", return_value=start):
            node = live.build_node(session, self.credentials, RedisCacheConfig(host="127.0.0.1", port=1), loaded)
        try:
            at = start + 60_000_000_000  # the first whole minute at least 30 s after the start (engine.history)
            self.assertEqual(session.sources["BTCUSDT"]._replay_input_start_ns, at)
            session.sources["BTCUSDT"].on_bar(SimpleNamespace(ts_event=at - 1_000_000, bar_type="BTCUSDT-PERP.BINANCE-1-MINUTE-LAST-EXTERNAL"))
            session.sources["BTCUSDT"].on_bar(SimpleNamespace(ts_event=at + 60_000_000_000 - 1_000_000, bar_type="BTCUSDT-PERP.BINANCE-1-MINUTE-LAST-EXTERNAL"))
            self.assertEqual(session.sources["BTCUSDT"].observed, ["bar"])
        finally:
            node.dispose()
            session.node, session.sources = None, {}

    def test_existing_stop_never_initializes_source(self):
        loaded = live.source_for_run(self.manifest)
        session = live.Session(self.manifest, self.output, "run", account_verified=True)
        (self.output / "STOP").write_text("stop")
        with mock.patch.object(live_node, "live_source") as source:
            with self.assertRaisesRegex(LiveRefusal, "LIVE_ENTRY_STOPPED"):
                live.build_node(session, self.credentials, RedisCacheConfig(host="127.0.0.1", port=1), loaded)
            source.assert_not_called()

    def test_failed_persistence_blocks_entry_and_unowned_reduction_is_still_refused(self):
        loaded = live.source_for_run(self.manifest)
        session = live.Session(self.manifest, self.output, "run", account_verified=True)
        node = live.build_node(session, self.credentials, RedisCacheConfig(host="127.0.0.1", port=1), loaded)
        try:
            session.cache_guard = mock.Mock()
            session.cache_guard.health.side_effect = LiveRefusal("LIVE_CACHE_HEALTH", "unavailable")
            source = session.sources["BTCUSDT"]
            iid = InstrumentId.from_str("BTCUSDT-PERP.BINANCE")
            entry = source.order_factory.market(iid, OrderSide.BUY, Quantity.from_str("0.001"))
            with self.assertRaisesRegex(LiveRefusal, "LIVE_ENTRY_STOPPED"):
                source.submit_order(entry)
            self.assertIsNone(node.cache.order(entry.client_order_id))
            close = source.order_factory.market(iid, OrderSide.SELL, Quantity.from_str("0.001"), reduce_only=True)
            with self.assertRaisesRegex(LiveRefusal, "LIVE_ORDER_OWNERSHIP"):
                source.submit_order(close)
            self.assertIsNone(node.cache.order(close.client_order_id))
            self.assertEqual(live.pending_orders(node.cache), [])
            self.assertTrue(session.persistence_failed)
            with self.assertRaisesRegex(LiveRefusal, "LIVE_JOURNAL_UNAVAILABLE"):
                session.event("clean_stop")
        finally:
            node.dispose()
            session.node, session.sources = None, {}

    def test_journal_failure_keeps_fill_callback_and_prevents_clean_claim(self):
        loaded = live.source_for_run(self.manifest)
        session = live.Session(self.manifest, self.output, "run", account_verified=True)
        node = live.build_node(session, self.credentials, RedisCacheConfig(host="127.0.0.1", port=1), loaded)
        try:
            with mock.patch.object(live.os, "fsync", side_effect=OSError("disk full")):
                session.sources["BTCUSDT"].on_order_event(SimpleNamespace(to_dict=lambda: {"type": "OrderFilled"}))
            self.assertEqual(session.sources["BTCUSDT"].observed, ["order"])
            self.assertTrue(session.stopping)
            self.assertTrue(session.journal_failed)
            with self.assertRaisesRegex(LiveRefusal, "LIVE_JOURNAL_UNAVAILABLE"):
                session.event("reconciled_flat")
        finally:
            node.dispose()
            session.node, session.sources = None, {}

    def test_storage_and_journal_failure_still_attempt_owned_exit_before_protection_cancel(self):
        session = live.Session(self.manifest, self.output, "run", account_verified=True)
        source = mock.Mock()
        session.sources, session.node, session.cache_guard = {"BTCUSDT": source}, mock.Mock(), mock.Mock()
        session.cache_guard.health.side_effect = LiveRefusal("LIVE_CACHE_HEALTH", "unavailable")
        protection = SimpleNamespace(is_reduce_only=True, is_closed=False, status=OrderStatus.ACCEPTED,
                                     client_order_id="stop", order_type=OrderType.STOP_MARKET,
                                     strategy_id=self.instance)
        position = SimpleNamespace(id="position", strategy_id=self.instance)
        cache = mock.Mock()
        cache.positions_open.return_value = [position]
        cache.orders.return_value = [protection]
        cache.orders_inflight.return_value = []
        cache.orders_active_local.return_value = []
        observer = SimpleNamespace(session=session, last_query=0, cache=cache)
        with mock.patch.object(live.os, "fsync", side_effect=OSError("disk full")):
            live_lifecycle.Observer.observe(observer)
        source.close_position.assert_called_once_with(position, reduce_only=True)
        source.cancel_order.assert_not_called()
        self.assertTrue(session.persistence_failed and session.journal_failed and session.stopping)
        self.assertFalse(session.native_flat)

    def test_connecting_journal_failure_is_not_swallowed(self):
        session = live.Session(self.manifest, self.output, "run", account_verified=True)
        with mock.patch.object(live.os, "fsync", side_effect=OSError("disk full")):
            with self.assertRaisesRegex(LiveRefusal, "LIVE_JOURNAL_UNAVAILABLE"):
                session.event("connecting")
        self.assertTrue(session.stopping)

    def test_source_report_cannot_clear_native_stop_rejection(self):
        session = live.Session(self.manifest, self.output, "run", account_verified=True)
        source = mock.Mock()
        session.sources = {"BTCUSDT": source}
        source.replay_integrity_findings.return_value = []
        cache = mock.Mock()
        cache.orders.return_value = [SimpleNamespace(status=OrderStatus.REJECTED)]
        live.source_outcome(session, cache)
        source.replay_integrity_findings.assert_called_once_with(True)
        self.assertTrue(session.failed)
        row = json.loads((self.output / "events.jsonl").read_text())
        self.assertEqual(row["evidence"], "source_self_report")
        self.assertTrue(row["denied_or_rejected_native_orders"])

    def test_nonempty_source_findings_preserve_failure_when_native_account_is_flat(self):
        session = live.Session(self.manifest, self.output, "run", account_verified=True)
        session.sources = {"BTCUSDT": mock.Mock()}
        session.sources["BTCUSDT"].replay_integrity_findings.return_value = ["protective stop acknowledgement deadline"]
        cache = mock.Mock()
        cache.orders.return_value = []
        live.source_outcome(session, cache)
        self.assertTrue(session.failed)

    def test_findings_made_while_handling_the_gates_own_denial_do_not_fail_the_start(self):
        """20261114-28: only as many of each text as the instance added during the gate's denials are set aside."""
        from collections import Counter
        session = live.Session(self.manifest, self.output, "run", account_verified=True)
        source = mock.Mock(strategy_id="LIVE-A")
        session.sources = {"BTCUSDT": source}
        cache = mock.Mock()
        cache.orders.return_value = []
        session.gate_findings = {"LIVE-A": Counter({"order denied O-1: bars_missing": 1})}
        source.replay_integrity_findings.return_value = ["order denied O-1: bars_missing"]
        live.source_outcome(session, cache)
        self.assertFalse(session.failed)
        row = json.loads((self.output / "events.jsonl").read_text().splitlines()[-1])
        self.assertEqual((row["findings"], row["finding_count"], row["entry_gate_findings"]),
                         (["order denied O-1: bars_missing"], 1, 1))  # journalled as the source reported it
        for found in (["order denied O-1: bars_missing", "stop not acknowledged"],  # another finding
                      ["order denied O-1: bars_missing"] * 2):  # the same text once more than the gate caused
            with self.subTest(found):
                session.failed = False
                source.replay_integrity_findings.return_value = found
                live.source_outcome(session, cache)
                self.assertTrue(session.failed)
        session.failed, session.gate_findings = False, {"LIVE-OTHER": Counter({"order denied O-1: bars_missing": 1})}
        source.replay_integrity_findings.return_value = ["order denied O-1: bars_missing"]
        live.source_outcome(session, cache)
        self.assertTrue(session.failed)  # another instance's denial sets nothing aside for this one

    def test_old_source_rejection_does_not_fail_a_new_observation_only_reconciliation(self):
        session = live.Session(self.manifest, self.output, "reconcile", account_verified=True)
        cache = mock.Mock()
        cache.orders.return_value = [SimpleNamespace(status=OrderStatus.REJECTED)]
        live.source_outcome(session, cache)
        self.assertFalse(session.failed)
        cache.orders.assert_not_called()

    def test_source_shutdown_retains_bounded_reason_without_interpreting_it(self):
        session = live.Session(self.manifest, self.output, "run", account_verified=True)
        live_source_runtime._LiveConfigured.shutdown_system(SimpleNamespace(_live=session), "reason" * 300)
        row = json.loads((self.output / "events.jsonl").read_text())
        self.assertEqual(row["source_reason"], ("reason" * 300)[:1000])
        self.assertFalse(session.failed)

    def runner_args(self, mode):
        manifest_path = self.output / "input.json"
        manifest_path.write_text(json.dumps(self.manifest))
        credential_path = self.output / "key.json"
        credential_path.write_text(json.dumps({"api_key": "offline-placeholder", "api_secret": "offline-placeholder"}))
        credential_path.chmod(0o600)
        return Namespace(manifest=manifest_path, credentials_file=credential_path, output=self.output, mode=mode)

    def flat_snapshot(self):
        return {"observed_ns": 123, "credential_binding": self.credentials.binding,
                "account": {"assets": [{"asset": "USDT", "walletBalance": "100", "unrealizedProfit": "0"}]},
                "positions": [], "orders": [], "algo_orders": []}

    def good_clock(self):
        now = live.time.time_ns()
        return [{"sent_ns": now, "server_ms": now // 1_000_000, "received_ns": now}]

    def test_another_credential_or_nautilus_version_is_refused_before_any_venue_read_or_write(self):
        cases = {"LIVE_ACCOUNT_BINDING": ({**self.manifest, "credential_binding": "b" * 64}, "2.0.0rc7"),
                 "LIVE_RUNTIME_VERSION": (self.manifest, "2.0.0rc8")}
        for code, (manifest, version) in cases.items():
            with self.subTest(code):
                self.manifest = manifest
                args = self.runner_args("run")
                with mock.patch.object(live.importlib.metadata, "version", return_value=version), \
                        mock.patch.object(live.BinanceReadOnly, "snapshot") as snapshot:
                    self.assertEqual(refused(live.execute, args, error=LiveRefusal).code, code)
                snapshot.assert_not_called()
                self.assertFalse((self.output / "runner.lock").exists())

    def test_a_clock_outside_the_limits_stops_preflight_and_run_but_is_not_read_on_reconcile(self):
        bad = self.good_clock()
        bad[0]["server_ms"] += 3000
        for mode in ("preflight", "run"):
            with self.subTest(mode), mock.patch.object(live.BinanceReadOnly, "snapshot", return_value=self.flat_snapshot()), \
                    mock.patch.object(live.BinanceReadOnly, "clock", return_value=bad), \
                    mock.patch.object(live, "build_node") as build:
                caught = refused(live.execute, self.runner_args(mode), error=LiveRefusal)
            self.assertEqual(caught.code, "LIVE_CLOCK")
            build.assert_not_called()
        (self.output / "armed.json").write_text("{}")
        with mock.patch.object(live.BinanceReadOnly, "snapshot", return_value=self.held_snapshot()), \
                mock.patch.object(live.BinanceReadOnly, "clock") as clock, \
                mock.patch.object(live, "require_account_mode", side_effect=RuntimeError("reached")), \
                self.assertRaisesRegex(RuntimeError, "reached"):
            live.execute(self.runner_args("reconcile"))
        clock.assert_not_called()

    def test_the_clock_reading_is_kept_in_the_private_preflight_result(self):
        reading = self.good_clock()
        with mock.patch.object(live.BinanceReadOnly, "snapshot", return_value=self.flat_snapshot()), \
                mock.patch.object(live.BinanceReadOnly, "clock", return_value=reading), \
                mock.patch.object(live, "require_admission"), mock.patch.object(live, "require_flat"), \
                mock.patch.object(live, "source_for_run"):
            self.assertEqual(live.execute(self.runner_args("preflight")), 0)
        self.assertEqual(json.loads((self.output / "preflight-123.json").read_text())["clock"], reading)

    def test_preflight_records_private_snapshot_without_native_node(self):
        snapshot = self.flat_snapshot()
        args = self.runner_args("preflight")
        with mock.patch.object(live.BinanceReadOnly, "snapshot", return_value=snapshot), \
                mock.patch.object(live, "build_node") as build, \
                mock.patch.object(live, "require_admission") as admission, \
                mock.patch.object(live, "source_for_run") as source:
            self.assertEqual(live.execute(args), 0)
            # The cash floor is 85% of the wallet; the default flat=True checks the account.
            admission.assert_called_once_with(snapshot, self.manifest, Decimal("85.00"))
            source.assert_called_once()
            for check in (admission, source):
                check.side_effect = live.Refusal("LIVE_FUNDS", "not admitted")
                with self.assertRaises(live.Refusal):
                    live.execute(args)
                check.side_effect = None
            build.assert_not_called()
        self.assertFalse((self.output / "armed.json").exists())
        self.assertEqual(json.loads((self.output / "preflight-123.json").read_text()), snapshot)

    def test_a_run_prepared_without_evidence_reads_the_account_then_is_refused(self):
        """G-69 (2026-11-21): the account check of a run with no replay recorded keeps its wallet observation, then
        refuses LIVE_EVIDENCE_MISSING after every other check; a start is refused the same way and never arms."""
        from engine import live_venue
        self.manifest["evidence"] = []
        snapshot = self.flat_snapshot()
        for mode in ("preflight", "run"):
            with self.subTest(mode=mode), mock.patch.object(live, "require_evidence", live_venue.require_evidence), \
                    mock.patch.object(live.BinanceReadOnly, "snapshot", return_value=snapshot), \
                    mock.patch.object(live, "build_node") as build, \
                    mock.patch.object(live, "require_admission") as admission, \
                    mock.patch.object(live, "source_for_run") as source:
                self.assertEqual(refused(live.execute, self.runner_args(mode), error=LiveRefusal).code, "LIVE_EVIDENCE_MISSING")
                admission.assert_called_once()
                source.assert_not_called()
                build.assert_not_called()
            self.assertEqual(json.loads((self.output / "preflight-123.json").read_text()), snapshot)
            self.assertFalse((self.output / "armed.json").exists())

    def held_snapshot(self):
        return {**self.flat_snapshot(), "observed_ns": 124, "positions": [{"symbol": "ETHUSDT", "positionAmt": "-0.01"}]}

    def test_reconcile_of_a_flat_account_releases_without_a_native_node(self):
        (self.output / "armed.json").write_text("{}")
        with mock.patch.object(live.BinanceReadOnly, "snapshot", return_value=self.flat_snapshot()), \
                mock.patch.object(live, "require_account_mode"), mock.patch.object(live, "build_node") as build:
            self.assertEqual(live.execute(self.runner_args("reconcile")), 0)
        build.assert_not_called()
        rows = [json.loads(line) for line in (self.output / "events.jsonl").read_text().splitlines()]
        self.assertEqual((rows[-1]["event"], rows[-1]["observation"]), ("venue_flat", "preflight-123.json"))

    def test_reconcile_releases_a_flat_account_whose_settings_changed_but_not_an_unreadable_one(self):
        (self.output / "armed.json").write_text("{}")
        changed = live.Refusal("LIVE_MARGIN_MODE", "settings changed")
        with mock.patch.object(live.BinanceReadOnly, "snapshot", return_value=self.flat_snapshot()), \
                mock.patch.object(live, "require_account_mode", side_effect=changed):
            self.assertEqual(live.execute(self.runner_args("reconcile")), 0)
        (self.output / "runner.lock").unlink()
        with mock.patch.object(live.BinanceReadOnly, "snapshot", return_value={**self.flat_snapshot(), "orders": None}), \
                mock.patch.object(live, "build_node") as build:
            caught = refused(live.execute, self.runner_args("reconcile"), error=LiveRefusal)
        self.assertEqual(caught.code, "LIVE_ACCOUNT_RESPONSE")
        build.assert_not_called()
        events = [json.loads(line)["event"] for line in (self.output / "events.jsonl").read_text().splitlines()]
        self.assertEqual(events.count("venue_flat"), 1)

    def test_a_snapshot_reads_positions_after_every_kind_of_order(self):
        reader = live.BinanceReadOnly(self.credentials)
        paths = []
        with mock.patch.object(reader, "get", side_effect=lambda path, **_: paths.append(path) or {"symbols": []}):
            reader.snapshot([])
        self.assertGreater(paths.index("/fapi/v3/positionRisk"), paths.index("/fapi/v1/openOrders"))
        self.assertGreater(paths.index("/fapi/v1/openOrders"), paths.index("/fapi/v1/openAlgoOrders"))

    def test_reconcile_checks_the_whole_account_again_when_native_reconciliation_ends_unmatched(self):
        (self.output / "armed.json").write_text("{}")
        node = mock.Mock()
        node.cache.orders.return_value = []
        node.cache.positions_open.return_value = [object()]  # An EXTERNAL position from an unmatched venue close.
        for final, expected in ((self.flat_snapshot(), "venue_flat"), (self.held_snapshot(), "reconcile_stopped")):
            with self.subTest(expected), \
                    mock.patch.object(live.BinanceReadOnly, "snapshot", side_effect=[self.held_snapshot(), final]), \
                    mock.patch.object(live, "require_account_mode"), mock.patch.object(live, "LiveCache"), \
                    mock.patch.object(live, "build_node", return_value=node) as build, \
                    mock.patch.object(live, "Signals"):
                (self.output / "runner.lock").unlink(missing_ok=True)
                self.assertEqual(live.execute(self.runner_args("reconcile")), 0)
                self.assertEqual(build.call_args.kwargs["source_module"], "engine.live")
            row = json.loads((self.output / "events.jsonl").read_text().splitlines()[-1])
            self.assertEqual(row["event"], expected)

    def test_a_second_runner_of_an_execution_is_refused_before_any_account_read(self):
        args = self.runner_args("preflight")
        with mock.patch.object(live.BinanceReadOnly, "snapshot", return_value=self.flat_snapshot()) as read, \
                mock.patch.object(live, "require_admission"), mock.patch.object(live, "require_flat"):
            with (self.output / "runner.lock").open("a") as held:
                fcntl.flock(held, fcntl.LOCK_EX)
                caught = refused(live.execute, args, error=LiveRefusal)
            self.assertEqual(caught.code, "LIVE_ALREADY_RUNNING")
            read.assert_not_called()
            self.assertFalse((self.output / "manifest.json").exists())
            self.assertEqual(live.execute(args), 0)  # With the first runner gone the same execution proceeds.
            read.assert_called_once()

    def test_an_interrupted_armed_run_resumes_as_itself_and_an_ended_one_cannot(self):
        class Armed(BaseException):
            """Stops a start after it armed (or resumed), before it blocks this process's signals: a kill, which no
            failure handler sees."""

        args = self.runner_args("run")
        held = dict(self.flat_snapshot(), positions=[{"symbol": "BTCUSDT", "positionSide": "LONG",
                                                     "positionAmt": "0.001"}])
        with mock.patch.object(live.BinanceReadOnly, "snapshot", return_value=self.flat_snapshot()) as snapshot, \
                mock.patch.object(live, "require_admission"), mock.patch.object(live, "require_account_mode"), \
                mock.patch.object(live, "source_for_run") as source, mock.patch.object(live, "build_node") as build, \
                mock.patch.object(live.strategy_runtime, "begin_run", side_effect=Armed):
            with self.assertRaises(Armed):
                live.execute(args)
            armed = (self.output / "armed.json").read_bytes()
            with self.assertRaises(Armed):  # killed without a word: the same run starts again on a flat account
                live.execute(args)
            snapshot.return_value = held
            with self.assertRaises(Armed):  # around an open position it only observes until the account is flat
                live.execute(args)
            self.assertEqual(source.call_count, 2)  # a held start constructs no source
            build.assert_not_called()
            resumes = [row for row in map(json.loads, (self.output / "events.jsonl").read_text().splitlines())
                       if row["event"] == "resuming"]
            self.assertEqual([row["held"] for row in resumes], [False, True])
            # The hold begins with a verdict on the same read: this position has no stop at Binance (20261114-24).
            verdict = json.loads((self.output / "events.jsonl").read_text().splitlines()[-1])
            self.assertEqual((verdict["event"], verdict["positions"], verdict["observation"]), (
                "held_uncovered", [{"symbol": "BTCUSDT", "side": "LONG", "position": "0.001", "stops": "0"}],
                resumes[-1]["observation"]))
            for ending in ("unresolved", "clean_stop"):
                with self.subTest(ending):
                    events = (self.output / "events.jsonl").read_text()
                    with (self.output / "events.jsonl").open("a") as stream:
                        stream.write(json.dumps({"event": ending, "run_id": "r"}) + "\n")
                    self.assertEqual(refused(live.execute, args, error=LiveRefusal).code, "LIVE_COLD_RESTART")
                    (self.output / "events.jsonl").write_text(events)
            (self.output / "STOP").write_text("operator stop\n")
            self.assertEqual(refused(live.execute, args, error=LiveRefusal).code, "LIVE_COLD_RESTART")
        self.assertEqual((self.output / "armed.json").read_bytes(), armed)

    def armed_run(self):
        """A run armed by a first start that was then killed; the patches every later start of it needs."""
        class Killed(BaseException):
            """A kill, which no failure handler sees."""

        args = self.runner_args("run")
        for patch in (mock.patch.object(live, "require_admission"), mock.patch.object(live, "require_account_mode"),
                      mock.patch.object(live, "source_for_run"),
                      mock.patch.object(live, "Signals")):
            patch.start()
            self.addCleanup(patch.stop)
        with mock.patch.object(live.BinanceReadOnly, "snapshot", return_value=self.flat_snapshot()), \
                mock.patch.object(live.strategy_runtime, "begin_run", side_effect=Killed):
            with self.assertRaises(Killed):
                live.execute(args)
        return args

    def events(self):
        return [json.loads(line) for line in (self.output / "events.jsonl").read_text().splitlines()]

    def test_an_armed_run_that_ends_by_its_own_refusal_or_failure_is_over(self):
        """20261114-23: every exit after the stop path, or after the start judged a failure, leaves an ending event,
        so neither the control nor the next start takes it for an interruption."""
        args = self.armed_run()
        journal = (self.output / "events.jsonl").read_text()

        def exits_flat(session, *_, **__):
            node = mock.Mock()
            node.cache.orders.return_value = node.cache.positions_open.return_value = []
            node.cache.orders_open.return_value = node.cache.orders_inflight.return_value = []
            node.run.side_effect = lambda: setattr(session, "native_flat", True)  # the STOP path closed everything
            return node

        unavailable = LiveRefusal("LIVE_ACCOUNT_UNAVAILABLE", "Binance GET /fapi/v3/account returned HTTP 503")
        cases = {
            # The native exit is complete, and the final account read fails or shows the account is not flat.
            "final read failed": ([self.flat_snapshot(), unavailable], {}, "LIVE_ACCOUNT_UNAVAILABLE"),
            "final read not flat": ([self.flat_snapshot(), self.held_snapshot()], {}, "LIVE_ACCOUNT_NOT_FLAT"),
            # Permanent causes before the node is built.
            "cache missing": ([self.flat_snapshot()], {"LiveCache": live.LiveCache}, "LIVE_CACHE_MISSING"),
            "account mode changed": ([self.flat_snapshot()], {"require_account_mode": mock.Mock(
                side_effect=LiveRefusal("LIVE_ACCOUNT_MODE", "the trial requires hedge and multi-assets mode"))},
                                     "LIVE_ACCOUNT_MODE"),
            "a failure that is no refusal": ([self.flat_snapshot()], {"LiveCache": mock.Mock(side_effect=KeyError("x"))},
                                             None),
        }
        for name, (reads, replaced, code) in cases.items():
            with self.subTest(name):
                (self.output / "events.jsonl").write_text(journal)
                self.assertTrue(live.resumable(self.output))
                with mock.patch.object(live.BinanceReadOnly, "snapshot", side_effect=reads), \
                        mock.patch.object(live, "source_outcome"), \
                        mock.patch.object(live, "build_node", side_effect=exits_flat), \
                        mock.patch.multiple(live, **{"LiveCache": mock.Mock(), **replaced}):
                    self.assertEqual(live.main(["--manifest", str(args.manifest), "--credentials-file",
                                                str(args.credentials_file), "--output", str(args.output),
                                                "--mode", "run"]), 2 if code else 1)
                    last = self.events()[-1]
                    self.assertEqual((last["event"], last["code"]), ("unresolved", code))
                    self.assertFalse(live.resumable(self.output))
                    self.assertEqual(refused(live.execute, args, error=LiveRefusal).code, "LIVE_COLD_RESTART")

    def test_a_start_again_on_a_flat_account_whose_cache_holds_a_position_ends_venue_flat(self):
        """20261114-25: the stop triggered while the runner was down. The connected start finds Binance flat and
        the reloaded cache holding the position; it sends nothing and the run ends with its venue_flat event."""
        from tests.engine.test_live_venue import fixture
        snapshot, _ = fixture()
        snapshot["credential_binding"] = self.credentials.binding
        session = live.Session(self.manifest, self.output, "run")
        session.brake.budget = Decimal("85")
        session.account_reader = mock.Mock()
        session.account_reader.snapshot.return_value = snapshot
        session.node, session.sources = mock.Mock(), {"BTCUSDT": mock.Mock()}
        phantom = SimpleNamespace(strategy_id=self.instance, id="P-1", is_open=True)
        observer = SimpleNamespace(session=session, last_query=live.time.monotonic(), cache=mock.Mock())
        observer.cache.positions.return_value = observer.cache.orders.return_value = []
        observer.cache.positions_open.return_value = [phantom]
        commands.start_observation(session, "connected")
        session.account_observation.result.result(timeout=1)
        with mock.patch.object(live_lifecycle.live_brake, "tick"), mock.patch.object(session, "check_protection"), \
                mock.patch.object(session, "check_mark"), mock.patch.object(live_lifecycle.live_connection, "tick"), \
                mock.patch.object(session, "observe_source_state"):
            live_lifecycle.Observer.observe(observer)
        self.assertTrue(session.account_verified and session.venue_flat and session.stopping)
        session.node.handle.return_value.stop.assert_called_once()  # the STOP path stops the node at once
        session.sources["BTCUSDT"].close_position.assert_not_called()
        rows = self.events()
        self.assertEqual([row["event"] for row in rows][-3:], ["started", "venue_flat", "stopping"])
        self.assertFalse(session.failed)
        self.assertFalse(live.resumable(self.output))  # venue_flat ends the run

    def finishing(self, args, reads, *, orders=(), venue_flat=False, **stopping):
        """A start again after a start that traded was killed with `stopping` journalled: (status, session, built)."""
        session = live.Session(self.manifest, self.output, "run")
        session.event("stopping", **stopping)
        found = []

        def node(session, *_, **__):
            found.append(session)
            node = mock.Mock()
            node.cache.orders.return_value, node.cache.positions_open.return_value = list(orders), []

            def run():
                if venue_flat:
                    live.live_connection.venue_flat_exit(session, self.flat_snapshot())
                session.finish_stop()
                session.native_flat = session.stopping and not session.interrupting
            node.run.side_effect = run
            return node

        with mock.patch.object(live.BinanceReadOnly, "snapshot", side_effect=reads), \
                mock.patch.object(live, "LiveCache"), mock.patch.object(live, "source_for_run") as source, \
                mock.patch.object(live, "KlineEvents"), mock.patch.object(live, "build_node", side_effect=node):
            status = live.execute(args)
        return status, found[0], source

    def test_a_start_killed_in_a_stop_that_ends_the_run_is_only_finished(self):
        """#3521: no source, on a flat account too; the begun stop's reason, and its failure, are carried on."""
        args = self.armed_run()
        journal = (self.output / "events.jsonl").read_text()
        for reason, failed in (("drawdown", 0), ("duration", 0), ("protection_missing", 1), ("source_failure", 1)):
            for first in (self.flat_snapshot(), self.held_snapshot()):
                with self.subTest(reason=reason, positions=first["positions"]):
                    (self.output / "events.jsonl").write_text(journal)
                    status, session, source = self.finishing(args, [first, self.flat_snapshot()], reason=reason)
                    source.assert_not_called()
                    self.assertEqual((status, session.mode, session.failed), (failed, "finish", bool(failed)))
                    stops = [row["reason"] for row in self.events() if row["event"] == "stopping"]
                    self.assertEqual(stops, [reason, reason])
                    self.assertEqual((self.events()[-1]["event"], self.events()[-1]["source_failed"]),
                                     ("clean_stop", bool(failed)))
                    self.assertEqual(refused(live.execute, args, error=LiveRefusal).code, "LIVE_COLD_RESTART")

    def test_a_failed_stop_whose_position_was_closed_at_binance_ends_venue_flat_and_failed(self):
        args = self.armed_run()
        journal = (self.output / "events.jsonl").read_text()
        for reason, failed in (("drawdown", 0), ("protection_missing", 1)):
            with self.subTest(reason):
                (self.output / "events.jsonl").write_text(journal)
                status, session, _ = self.finishing(args, [self.flat_snapshot()] * 2, venue_flat=True, reason=reason)
                self.assertEqual((status, session.venue_flat), (failed, True))

    def test_an_interruption_or_a_rewarming_is_no_stop_to_finish(self):
        args = self.armed_run()
        journal = (self.output / "events.jsonl").read_text()
        for reason in ("interrupted", "rewarming"):
            with self.subTest(reason):
                (self.output / "events.jsonl").write_text(journal)
                _, session, source = self.finishing(args, [self.flat_snapshot()] * 2, reason=reason)
                source.assert_called_once()
                self.assertEqual(session.mode, "run")

    def test_a_held_starts_stop_is_none_to_finish_and_a_begun_one_stays_begun(self):
        rows = [{"event": "preflight", "mode": "run"}, {"event": "resuming", "held": True},
                {"event": "stopping", "reason": "duration"}]
        self.assertIsNone(live.begun_stop(rows))
        begun = [{"event": "preflight", "mode": "run"}, {"event": "stopping", "reason": "interrupted"},
                 {"event": "stopping", "reason": "drawdown"}]
        self.assertEqual(live.begun_stop(begun + rows), "drawdown")

    def test_an_interrupted_finish_is_finished_by_the_next_start(self):
        args = self.armed_run()
        with mock.patch.object(live.Session, "finish_stop", autospec=True, side_effect=lambda session: (
                session.interrupt_requested.set(), session.observe_stop_intent())):
            # The begun stop's own refused order is reloaded with the cache: it does not end the interrupted start.
            refused_order = SimpleNamespace(status=live_lifecycle.OrderStatus.REJECTED, client_order_id="O-1", is_closed=True)
            status, _, _ = self.finishing(args, [self.flat_snapshot()] * 2, orders=[refused_order],
                                          reason="protection_missing")
        self.assertEqual((status, self.events()[-1]["event"]), (live.INTERRUPTED, "interrupted"))
        self.assertEqual(live.begun_stop(self.events()), "protection_missing")
        self.assertTrue(live.resumable(self.output))

    def test_a_finishing_start_closes_the_inherited_position_through_its_registered_identity(self):
        from tests.engine.test_live_venue import fixture
        snapshot, _ = fixture()
        snapshot["credential_binding"] = self.credentials.binding
        snapshot["positions"] = [{"symbol": "BTCUSDT", "positionSide": "LONG", "positionAmt": "0.002"}]
        session = live.Session(self.manifest, self.output, "finish", begun_stop="drawdown")
        session.account_reader = mock.Mock()
        session.account_reader.snapshot.return_value = snapshot
        session.node, keeper = mock.Mock(), mock.Mock()
        session.keepers = {"BTCUSDT": keeper}
        (self.output / "STOP").touch()  # the operator's stop adds nothing to one already begun
        position = SimpleNamespace(strategy_id=self.instance, id="P-1", is_open=True, side=live_lifecycle.PositionSide.LONG,
                                   instrument_id=live.contract("BTCUSDT"),
                                   quantity=SimpleNamespace(as_decimal=lambda: Decimal("0.002")))
        observer = SimpleNamespace(session=session, last_query=live.time.monotonic(), cache=mock.Mock())
        observer.request_bars = mock.Mock()
        observer.cache.bar.return_value = None
        observer.cache.orders.return_value = []
        observer.cache.positions_open.return_value = [position]
        for _ in range(4):
            live_lifecycle.Observer.observe(observer)
            keeper.close_position.assert_not_called()  # the native risk engine has no price of its contract yet
            if session.account_observation is not None:
                session.account_observation.result.result(timeout=1)
        observer.request_bars.assert_called_once()
        observer.cache.bar.return_value = object()
        live_lifecycle.Observer.observe(observer)
        keeper.close_position.assert_called_once_with(position, reduce_only=True)
        self.assertEqual([row["event"] for row in self.events()], ["held", "stopping"])
        session.node.handle.return_value.stop.assert_not_called()

    def test_a_stop_that_closes_nothing_is_journalled_after_the_runs_ending_event(self):
        session = live.Session(self.manifest, self.output, "run")
        session.node = mock.Mock()
        session.lose_connection("venue_disconnected")
        self.assertEqual([row["event"] for row in self.events()], ["unresolved", "stopping"])

    def test_a_held_start_that_failed_exits_as_a_failed_run_and_a_stopped_one_as_reconcile_does(self):
        args = self.armed_run()

        def ends(act):
            def build(session, *_, **__):
                node = session.node = mock.Mock()
                node.cache.orders.return_value = node.cache.orders_open.return_value = []
                node.cache.positions_open.return_value = [object()]
                node.run.side_effect = lambda: act(session)
                return node
            return build

        for act, expected in ((lambda session: session.lose_connection("connected_account_unverified"), (1, "unresolved")),
                              (lambda session: session.begin_stop("requested"), (0, "reconcile_stopped"))):
            with self.subTest(expected):
                events = (self.output / "events.jsonl").read_text()
                with mock.patch.object(live.BinanceReadOnly, "snapshot", return_value=self.held_snapshot()), \
                        mock.patch.object(live, "LiveCache"), mock.patch.object(live, "source_outcome"), \
                        mock.patch.object(live, "build_node", side_effect=ends(act)):
                    status = live.execute(args)
                self.assertEqual((status, self.events()[-1]["event"]), expected)
                (self.output / "events.jsonl").write_text(events)

    def test_a_run_that_ended_venue_flat_exits_zero_unless_it_failed(self):
        args = self.armed_run()

        def ends_flat_at_binance(session, *_, **__):
            node = mock.Mock()
            node.cache.orders.return_value = node.cache.orders_open.return_value = []
            node.cache.positions_open.return_value = [object()]  # the cache still holds the position
            node.run.side_effect = lambda: live.live_connection.venue_flat_exit(session, self.flat_snapshot())
            return node

        for failed, expected in ((False, 0), (True, 1)):
            with self.subTest(failed=failed):
                events = (self.output / "events.jsonl").read_text()
                with mock.patch.object(live.BinanceReadOnly, "snapshot", return_value=self.flat_snapshot()), \
                        mock.patch.object(live, "LiveCache"), \
                        mock.patch.object(live, "source_outcome", side_effect=lambda session, _: setattr(
                            session, "failed", failed)), \
                        mock.patch.object(live, "build_node", side_effect=ends_flat_at_binance):
                    self.assertEqual(live.execute(args), expected)
                ending = [row["event"] for row in self.events() if row["event"] in live.ENDED_EVENTS]
                self.assertEqual(ending, ["venue_flat"])  # no unresolved beside it
                (self.output / "events.jsonl").write_text(events)

    def test_a_stop_venue_flat_takes_a_final_read_and_refuses_when_binance_is_not_flat(self):
        """#3727: a STOP ending with phantoms must take a post-close final read and require_flat, never keep stop_read."""
        from nautilus_trader.model import PositionSide, Quantity
        args = self.armed_run()
        events_before = (self.output / "events.jsonl").read_text()

        def run_stop_case(final_snapshot, *, failed: bool = False):
            (self.output / "events.jsonl").write_text(events_before)
            for path in self.output.glob("final-account-*.json"):
                path.unlink()
            seen = []

            def build(session, *_, **__):
                seen.append(session)
                owner = mock.Mock()
                position = SimpleNamespace(id="P-1", strategy_id=self.instance, side=PositionSide.LONG,
                                           instrument_id=live.contract("BTCUSDT"),
                                           quantity=Quantity.from_str("0.003"))
                node = session.node = mock.Mock()
                node.cache.positions_open.side_effect = lambda **_: [position]
                node.cache.orders.side_effect = lambda **_: []
                node.cache.orders_open.side_effect = lambda **_: []
                node.cache.orders_inflight.side_effect = lambda **_: []
                node.cache.orders_active_local.side_effect = lambda **_: []

                def run():
                    session.account_verified = True
                    session.sources = {"BTCUSDT": owner}
                    session.failed = failed
                    session.begin_stop("requested")
                    # Pre-close stop_read sees 0.001 open at Binance (0.002 exchange stop fill not in cache yet).
                    stop_read = {**self.flat_snapshot(), "observed_ns": 100,
                                 "positions": [{"symbol": "BTCUSDT", "positionSide": "LONG", "positionAmt": "0.001"}]}
                    session.account_observation = SimpleNamespace(
                        purpose="stop", deadline=live.time.monotonic() + 30,
                        result=SimpleNamespace(done=lambda: True, result=lambda: stop_read, cancel=lambda: None))
                    observer = SimpleNamespace(session=session, last_query=live.time.monotonic(), cache=node.cache)
                    live_lifecycle.Observer.observe(observer)  # submits close of 0.001, phantoms["P-1"] = 0.002
                    # Close expires (not in pending) while late stop fill drops native to 0.001 <= phantoms (0.002).
                    position.quantity = Quantity.from_str("0.001")
                    live_lifecycle.Observer.observe(observer)
                node.run.side_effect = run
                return node

            with mock.patch.object(live.BinanceReadOnly, "snapshot",
                                   side_effect=[self.flat_snapshot(), final_snapshot]), \
                    mock.patch.object(live, "LiveCache"), mock.patch.object(live, "KlineEvents"), \
                    mock.patch.object(live, "source_outcome"), mock.patch.object(live, "build_node", side_effect=build):
                return live.execute(args), seen[0]

        # Binance still holds 0.001 (or a resting algo order): must refuse LIVE_ACCOUNT_NOT_FLAT, never venue_flat.
        still_open = {**self.flat_snapshot(), "observed_ns": 200,
                      "positions": [{"symbol": "BTCUSDT", "positionSide": "LONG", "positionAmt": "0.001"}]}
        still_ordered = {**self.flat_snapshot(), "observed_ns": 201,
                         "algo_orders": [{"symbol": "BTCUSDT", "algoId": 9}]}
        for label, non_flat in (("open_position", still_open), ("resting_algo_order", still_ordered)):
            with self.subTest(non_flat=label):
                exc = refused(run_stop_case, non_flat, error=LiveRefusal)
                self.assertEqual(exc.code, "LIVE_ACCOUNT_NOT_FLAT")
                rows = self.events()
                self.assertNotIn("venue_flat", [row["event"] for row in rows])
                self.assertEqual((rows[-1]["event"], rows[-1]["code"]), ("unresolved", "LIVE_ACCOUNT_NOT_FLAT"))
                finals = list(self.output.glob("final-account-*.json"))
                self.assertEqual(len(finals), 1)
                self.assertEqual(json.loads(finals[0].read_text())["observed_ns"], non_flat["observed_ns"])

        # Binance IS flat at the final read: ends venue_flat with the fresh flat final-account snapshot (not stop_read).
        for failed, expected in ((False, 0), (True, 1)):
            with self.subTest(flat_failed=failed):
                fresh_flat = {**self.flat_snapshot(), "observed_ns": 300}
                status, _session = run_stop_case(fresh_flat, failed=failed)
                self.assertEqual(status, expected)
                rows = self.events()
                self.assertEqual(rows[-1]["event"], "venue_flat")
                kept = json.loads((self.output / rows[-1]["observation"]).read_text())
                self.assertEqual((kept["observed_ns"], kept["positions"]), (300, []))

    def test_a_source_failure_names_its_contract(self):
        """A Live instance's failure record names its contract, as replay's and Paper's do."""
        session = live.Session(self.manifest, self.output, "run")
        session.node = mock.Mock()
        live.strategy_runtime.begin_run(self.output, {"Metrics": {"BTCUSDT-PERP.BINANCE"}})
        source = live_source_runtime.live_source(live.source_for_run(self.manifest), session)["BTCUSDT"]
        live.strategy_runtime.execution_failure("on_bar", ValueError("boom"), source)
        self.assertEqual(live.strategy_runtime.FAILURES[0]["instrument_id"], "BTCUSDT-PERP.BINANCE")

    def test_a_run_writes_its_final_failure_counts(self):
        """The receipt is rewritten only at powers of two while the run goes on; the end writes the true counts."""
        args = self.armed_run()

        def fails_three_times(session, *_, **__):
            node = mock.Mock()
            node.cache.orders.return_value = node.cache.positions_open.return_value = []
            node.cache.orders_open.return_value = node.cache.orders_inflight.return_value = []

            def run():
                for _ in range(3):
                    live.strategy_runtime.execution_failure("on_bar", ValueError("boom"), None)
                session.native_flat = True
            node.run.side_effect = run
            return node

        with mock.patch.object(live.BinanceReadOnly, "snapshot", return_value=self.flat_snapshot()), \
                mock.patch.object(live, "LiveCache"), mock.patch.object(live, "source_outcome"), \
                mock.patch.object(live, "build_node", side_effect=fails_three_times):
            live.execute(args)
        [receipt] = map(json.loads, (self.output / "runtime_failures.jsonl").read_text().splitlines())
        self.assertEqual(receipt["count"], 3)

    def test_a_start_again_that_cannot_read_binance_gives_the_start_back(self):
        """Only the account read before anything is built is retried: the start ends as an interruption does (exit
        status 3, no ending event) and the control starts the run again within its hourly limit."""
        unavailable = LiveRefusal("LIVE_ACCOUNT_UNAVAILABLE", "Binance GET /fapi/v3/account failed (TimeoutError)")
        with mock.patch.object(live.BinanceReadOnly, "snapshot", side_effect=unavailable):
            # A first start is not armed: the refusal stands, and nothing is journalled.
            self.assertEqual(refused(live.execute, self.runner_args("run"), error=LiveRefusal).code,
                             "LIVE_ACCOUNT_UNAVAILABLE")
        self.assertFalse((self.output / "events.jsonl").exists())
        (self.output / "runner.lock").unlink()
        args = self.armed_run()
        before = self.events()
        with mock.patch.object(live.BinanceReadOnly, "snapshot", side_effect=unavailable), \
                mock.patch.object(live, "build_node") as build:
            self.assertEqual(live.execute(args), live.INTERRUPTED)
            with mock.patch.object(live.BinanceReadOnly, "clock", side_effect=unavailable):
                self.assertEqual(live.execute(args), live.INTERRUPTED)
        build.assert_not_called()
        self.assertEqual(self.events(), before)
        self.assertTrue(live.resumable(self.output))

    def test_a_start_again_whose_connected_read_fails_or_is_overdue_is_interrupted(self):
        args = self.armed_run()
        journal = (self.output / "events.jsonl").read_text()
        unavailable = LiveRefusal("LIVE_ACCOUNT_UNAVAILABLE", "Binance GET /fapi/v2/account failed (TimeoutError)")
        overdue = threading.Event()
        self.addCleanup(overdue.set)

        def start_again(snapshot, read, *, verify=None):
            (self.output / "events.jsonl").write_text(journal)
            sessions = []

            def connects(session, *_, **__):
                sessions.append(session)
                node = session.node = mock.Mock()
                node.cache.orders.return_value = node.cache.positions_open.return_value = []
                observer = SimpleNamespace(session=session, last_query=0, cache=node.cache, query_account=mock.Mock())

                def run():
                    session.account_reader = mock.Mock()
                    if read is overdue:
                        session.account_reader.snapshot.side_effect = lambda _: overdue.wait(5)
                    else:
                        session.account_reader.snapshot.side_effect = [read]
                    commands.start_observation(session, "connected")
                    if read is overdue:
                        with mock.patch.object(commands, "time", SimpleNamespace(
                                monotonic=lambda: live.time.monotonic() + 31, time_ns=live.time.time_ns)):
                            live_lifecycle.Observer.observe(observer)
                    else:
                        session.account_observation.result.exception(timeout=2)
                        live_lifecycle.Observer.observe(observer)
                    node.handle().stop.assert_called_once()
                node.run.side_effect = run
                return node

            with mock.patch.object(live.BinanceReadOnly, "snapshot", return_value=snapshot), \
                    mock.patch.object(live, "LiveCache"), mock.patch.object(live, "KlineEvents"), \
                    mock.patch.object(live, "build_node", side_effect=connects), \
                    mock.patch.object(commands, "verify_connected_account", side_effect=verify):
                status = live.execute(args)
            return status, sessions[0]

        for snapshot in (self.flat_snapshot(), self.held_snapshot()):
            for read in (unavailable, overdue):
                with self.subTest(read=read, positions=snapshot["positions"]):
                    status, session = start_again(snapshot, read)
                    self.assertEqual((status, self.events()[-1]["event"]), (live.INTERRUPTED, "interrupted"))
                    self.assertFalse(session.failed or session.account_verified)
                    self.assertTrue(live.resumable(self.output))
                    self.assertIsNone(live.begun_stop(self.events()))
            # A read that succeeds and contradicts, or whose answer is unusable, still ends the run.
            contradiction = LiveRefusal("LIVE_ACCOUNT_MODE", "the trial requires hedge and multi-assets mode")
            aged = LiveRefusal("LIVE_OBSERVATION_STALE", "account checks require a fresh account observation")
            incomplete = LiveRefusal("LIVE_ACCOUNT_RESPONSE", "no usable server time")
            for read, verify in ((snapshot, contradiction), (snapshot, aged), (incomplete, None), (KeyError("x"), None)):
                with self.subTest(read=read, verify=verify):
                    status, session = start_again(snapshot, read, verify=verify)
                    self.assertNotEqual(status, live.INTERRUPTED)
                    self.assertTrue(session.connection_failed)
                    self.assertFalse(live.resumable(self.output))
        # A start that finishes an earlier start's stop still withdraws the working entry it inherited.
        journal += json.dumps({"event": "preflight", "run_id": "native-test", "mode": "run", "observed_ns": 1}) + "\n" \
            + json.dumps({"event": "stopping", "run_id": "native-test", "reason": "drawdown", "observed_ns": 1}) + "\n"
        with mock.patch.object(live.Session, "cancel_entries") as cancel:
            status, session = start_again(self.flat_snapshot(), unavailable)
        cancel.assert_called_once()
        self.assertEqual((status, session.mode, live.begun_stop(self.events())), (live.INTERRUPTED, "finish", "drawdown"))

    def test_a_start_again_whose_socket_disconnects_before_verification_is_interrupted(self):
        args = self.armed_run()
        journal = (self.output / "events.jsonl").read_text()
        disconnected = SimpleNamespace(client_id="BINANCE", endpoint="user-stream", state=SocketState.DISCONNECTED)

        def start_again(before=lambda session: None, snapshot=None):
            (self.output / "events.jsonl").write_text(journal)
            (self.output / "STOP").unlink(missing_ok=True)
            sessions = []

            def connects(session, *_, **__):
                sessions.append(session)
                node = session.node = mock.Mock()
                node.cache.orders.return_value = node.cache.positions_open.return_value = []
                observer = SimpleNamespace(session=session, last_query=0, cache=node.cache, query_account=mock.Mock())

                def run():
                    before(session)
                    live_lifecycle.Observer.on_socket_state(observer, disconnected)
                    live_lifecycle.Observer.on_socket_state(observer, disconnected)  # each socket has its own event
                    live_lifecycle.Observer.observe(observer)
                    node.handle().stop.assert_called()
                node.run.side_effect = run
                return node

            with mock.patch.object(live.BinanceReadOnly, "snapshot", return_value=snapshot or self.flat_snapshot()), \
                    mock.patch.object(live, "LiveCache"), mock.patch.object(live, "KlineEvents"), \
                    mock.patch.object(live, "build_node", side_effect=connects), \
                    mock.patch.object(live.strategy_runtime, "FAILURES", []):
                return live.execute(args), sessions[0]

        interruptions = {"connected": lambda session: None,
                         "signal not yet seen": lambda session: session.interrupt_requested.set(),
                         "interrupting": lambda session: (session.interrupt_requested.set(),
                                                          session.observe_stop_intent())}
        for snapshot in (self.flat_snapshot(), self.held_snapshot()):
            for name, before in interruptions.items():
                with self.subTest(name, positions=snapshot["positions"]):
                    status, session = start_again(before, snapshot)
                    self.assertEqual((status, self.events()[-1]["event"]), (live.INTERRUPTED, "interrupted"))
                    self.assertFalse(session.failed or session.account_verified)
                    self.assertTrue(live.resumable(self.output))
                    self.assertIsNone(live.begun_stop(self.events()))
        # A stop or failure that came first still ends the run.
        endings = {"stop": lambda session: (self.output / "STOP").touch(),
                   "source failure": lambda session: live.strategy_runtime.FAILURES.append({}),
                   "failure while interrupting": lambda session: (
                       session.interrupt_requested.set(), session.observe_stop_intent(),
                       live.strategy_runtime.FAILURES.append({})),
                   "storage": lambda session: setattr(session, "persistence_failed", True),
                   "failed order": lambda session: setattr(session, "failed", True)}
        for name, before in endings.items():
            with self.subTest(name):
                status, session = start_again(before)
                self.assertNotEqual(status, live.INTERRUPTED)
                self.assertFalse(live.resumable(self.output))
                self.assertEqual([row["event"] for row in self.events() if row["event"] in live.ENDED_EVENTS][:1],
                                 ["unresolved"])
        # A start that finishes an earlier start's stop withdraws the working entry it inherited, and a later start
        # still finishes that stop.
        journal += json.dumps({"event": "preflight", "run_id": "native-test", "mode": "run", "observed_ns": 1}) + "\n" \
            + json.dumps({"event": "stopping", "run_id": "native-test", "reason": "drawdown", "observed_ns": 1}) + "\n"
        with mock.patch.object(live.Session, "cancel_entries") as cancel:
            status, session = start_again()
        cancel.assert_called_once()
        self.assertEqual((status, session.mode, live.begun_stop(self.events())), (live.INTERRUPTED, "finish", "drawdown"))

    def test_a_first_starts_disconnect_before_verification_still_ends_the_run(self):
        for interrupting in (False, True):
            with self.subTest(interrupting=interrupting):
                session = live.Session(self.manifest, self.output, "run")
                session.node = mock.Mock()
                session.interrupting = interrupting
                live_lifecycle.Observer.on_socket_state(SimpleNamespace(session=session), SimpleNamespace(
                    client_id="BINANCE", endpoint="user-stream", state=SocketState.DISCONNECTED))
                self.assertTrue(session.connection_failed)

    def test_a_first_starts_failed_connected_read_still_ends_the_run(self):
        session = live.Session(self.manifest, self.output, "run")
        session.node = mock.Mock()
        session.account_reader = mock.Mock()
        session.account_reader.snapshot.side_effect = LiveRefusal("LIVE_ACCOUNT_UNAVAILABLE", "failed")
        commands.start_observation(session, "connected")
        session.account_observation.result.exception(timeout=2)
        live_lifecycle.Observer.observe(SimpleNamespace(session=session, last_query=0, cache=mock.Mock()))
        self.assertTrue(session.connection_failed)
        self.assertEqual([row["event"] for row in self.events()], ["unresolved", "stopping"])

    def test_a_start_again_with_this_clock_outside_the_limits_gives_the_start_back(self):
        """The user, 2026-11-15: a host clock that steps aside comes back by itself and the account may hold a
        position, so a start again over the clock limit ends as one that could not read Binance does (exit status 3,
        nothing written) and the control starts the run again within its hourly limit."""
        args = self.armed_run()
        before, files = self.events(), sorted(path.name for path in self.output.iterdir())
        skewed = self.good_clock()
        skewed[0]["server_ms"] += 3000  # this clock 3 s behind Binance: over the 2500 ms limit
        with mock.patch.object(live.BinanceReadOnly, "clock", return_value=skewed), \
                mock.patch.object(live, "build_node") as build:
            for snapshot in (self.flat_snapshot(), self.held_snapshot()):  # with a position open as well
                with mock.patch.object(live.BinanceReadOnly, "snapshot", return_value=snapshot):
                    self.assertEqual(live.execute(args), live.INTERRUPTED)
        build.assert_not_called()
        self.assertEqual((self.events(), sorted(path.name for path in self.output.iterdir())), (before, files))
        self.assertTrue(live.resumable(self.output))
        # The limits are unchanged, and a reading with no usable server time is no clock offset: it ends the run.
        with mock.patch.object(live.BinanceReadOnly, "snapshot", return_value=self.flat_snapshot()), \
                mock.patch.object(live.BinanceReadOnly, "clock", return_value=[]):
            self.assertEqual(refused(live.execute, args, error=LiveRefusal).code, "LIVE_ACCOUNT_RESPONSE")
        last = self.events()[-1]
        self.assertEqual((last["event"], last["code"]), ("unresolved", "LIVE_ACCOUNT_RESPONSE"))
        self.assertFalse(live.resumable(self.output))

    def test_a_start_again_whose_first_read_succeeds_after_long_retries_goes_on(self):
        """Only the stamp of the read's first request is old: its retries outlasted the age limit, then it succeeded."""
        args = self.armed_run()
        journal = (self.output / "events.jsonl").read_text()
        for name, wrong, code in (("slow", {}, None), ("wrong mode", {"dualSidePosition": False}, "LIVE_ACCOUNT_MODE")):
            for base in (self.flat_snapshot(), self.held_snapshot()):
                (self.output / "events.jsonl").write_text(journal)
                snapshot = {**base, "observed_ns": live.time.time_ns() - 33 * 10**9,
                            "config": {"dualSidePosition": True, "multiAssetsMargin": True, **wrong},
                            "symbols": {"BTCUSDT": {"config": [{"symbol": "BTCUSDT", "marginType": "CROSSED",
                                                                "leverage": 50, "isAutoAddMargin": False}]}}}
                with self.subTest(name, positions=base["positions"]), \
                        mock.patch.object(live.BinanceReadOnly, "snapshot", return_value=snapshot), \
                        mock.patch.object(live, "require_account_mode", require_account_mode), mock.patch.object(live, "LiveCache"), \
                        mock.patch.object(live, "build_node", side_effect=RuntimeError("built")):
                    if code is None:
                        with self.assertRaisesRegex(RuntimeError, "built"):
                            live.execute(args)
                        [resumed] = [row for row in self.events() if row["event"] == "resuming"]
                        self.assertEqual(resumed["held"], bool(base["positions"]))
                    else:
                        self.assertEqual(refused(live.execute, args, error=LiveRefusal).code, code)

    def test_a_start_after_one_that_ended_to_warm_up_again_may_retry_a_failed_warm_up_once(self):
        class Armed(BaseException):
            """Stops a start after it armed (or resumed), before it blocks this process's signals: a kill, which no
            failure handler sees."""

        args, made = self.runner_args("run"), []

        def session(*items, **fields):
            made.append(live_session.Session(*items, **fields))
            return made[-1]

        def ended(**row):
            with (self.output / "events.jsonl").open("a") as stream:
                stream.write(json.dumps({"run_id": "r", **row}) + "\n")

        with mock.patch.object(live.BinanceReadOnly, "snapshot", return_value=self.flat_snapshot()), \
                mock.patch.object(live, "require_admission"), mock.patch.object(live, "require_account_mode"), \
                mock.patch.object(live, "source_for_run"), mock.patch.object(live, "build_node"), \
                mock.patch.object(live, "Session", side_effect=session), \
                mock.patch.object(live.strategy_runtime, "begin_run", side_effect=Armed):
            for row in (None, {"event": "interrupted", "mode": "run"}, {"event": "rewarming", "mode": "run"},
                        {"event": "rewarming", "mode": "run", "retry": True}):
                if row is not None:
                    ended(**row)
                with self.assertRaises(Armed):
                    live.execute(args)
        self.assertEqual([item.warmup_retry for item in made], [False, False, True, False])

    def test_stop_exits_before_canceling_protection_and_waits_for_native_events(self):
        session = live.Session(self.manifest, self.output, "run", account_verified=True)
        session.begin_stop("test")
        source = mock.Mock()
        session.sources = {"BTCUSDT": source}
        session.node = mock.Mock()
        protection = SimpleNamespace(is_reduce_only=True, is_closed=False, status=OrderStatus.ACCEPTED,
                                     client_order_id="stop", order_type=OrderType.STOP_MARKET,
                                     strategy_id=self.instance)
        position = SimpleNamespace(id="position", strategy_id=self.instance)
        cache = mock.Mock()
        cache.positions_open.return_value = [position]
        cache.orders.return_value = [protection]
        cache.orders_inflight.return_value = []
        cache.orders_active_local.return_value = []
        observer = SimpleNamespace(session=session, last_query=live.time.monotonic(), cache=cache)
        live_lifecycle.Observer.observe(observer)
        source.close_position.assert_called_once_with(position, reduce_only=True)
        source.cancel_order.assert_not_called()
        live_lifecycle.Observer.observe(observer)
        source.close_position.assert_called_once()
        cache.positions_open.return_value = []
        live_lifecycle.Observer.observe(observer)
        source.cancel_order.assert_called_once_with("stop")
        self.assertFalse(session.native_flat)
        cache.orders.return_value = []
        live_lifecycle.Observer.observe(observer)
        self.assertTrue(session.native_flat)
        session.node.handle.return_value.stop.assert_called_once()

    def test_stop_repeats_a_cancel_while_the_order_stays_open(self):
        session = live.Session(self.manifest, self.output, "run", account_verified=True)
        with mock.patch.object(live.time, "monotonic", return_value=100.0):
            session.begin_stop("test")
        source = mock.Mock()
        session.sources, session.node = {"BTCUSDT": source}, mock.Mock()
        entry = SimpleNamespace(is_reduce_only=False, is_closed=False, client_order_id="entry", side="BUY",
                                instrument_id="AAA", status=OrderStatus.ACCEPTED, order_type=OrderType.LIMIT,
                                strategy_id=self.instance)
        cache = mock.Mock()
        cache.positions_open.return_value = []
        cache.orders.return_value = [entry]
        observer = SimpleNamespace(session=session, last_query=session.stop_at, cache=cache,
                                   query_account=mock.Mock())
        with mock.patch.object(live.time, "monotonic", return_value=session.stop_at):
            live_lifecycle.Observer.observe(observer)
            live_lifecycle.Observer.observe(observer)
        self.assertEqual(source.cancel_order.call_count, 1)  # Not repeated within the interval.
        with mock.patch.object(live.time, "monotonic", return_value=session.stop_at + live_session.CANCEL_RETRY_SECONDS):
            live_lifecycle.Observer.observe(observer)
        self.assertEqual(source.cancel_order.call_count, 2)
        # Native cancel_order would send nothing now, so the request goes out as a side-scoped cancel-all.
        entry.status = OrderStatus.PENDING_CANCEL
        with mock.patch.object(live.time, "monotonic", return_value=session.stop_at + 2 * live_session.CANCEL_RETRY_SECONDS), \
                mock.patch.object(live_session, "Strategy") as native:
            live_lifecycle.Observer.observe(observer)
        native.cancel_all_orders.assert_called_once_with(source, "AAA", "BUY", None, False)
        self.assertEqual(source.cancel_order.call_count, 2)
        session.node.handle.return_value.stop.assert_not_called()

    def test_stop_gives_a_cancel_the_source_already_sent_one_interval(self):
        session = live.Session(self.manifest, self.output, "run", account_verified=True)
        session.begin_stop("test")
        source = mock.Mock()
        session.sources, session.node = {"BTCUSDT": source}, mock.Mock()
        entry = SimpleNamespace(is_reduce_only=False, is_closed=False, client_order_id="entry", side="BUY",
                                instrument_id="AAA", status=OrderStatus.PENDING_CANCEL, order_type=OrderType.LIMIT,
                                strategy_id=self.instance)
        cache = mock.Mock()
        cache.positions_open.return_value = []
        cache.orders.return_value = [entry]
        observer = SimpleNamespace(session=session, last_query=live.time.monotonic(), cache=cache)
        with mock.patch.object(live_session, "Strategy") as native:
            live_lifecycle.Observer.observe(observer)
        native.cancel_all_orders.assert_not_called()
        source.cancel_order.assert_not_called()

    def test_stop_waits_for_already_submitted_natural_exit(self):
        session = live.Session(self.manifest, self.output, "run", account_verified=True)
        session.begin_stop("test")
        source = mock.Mock()
        session.sources, session.node = {"BTCUSDT": source}, mock.Mock()
        cache = mock.Mock()
        cache.positions_open.return_value = [SimpleNamespace(id="position", strategy_id=self.instance)]
        cache.orders.return_value = [SimpleNamespace(is_reduce_only=True, is_closed=False, status=OrderStatus.SUBMITTED,
            client_order_id="natural-exit", order_type=OrderType.MARKET)]
        cache.orders_active_local.return_value = []
        cache.orders_inflight.return_value = [SimpleNamespace(is_reduce_only=True, client_order_id="natural-exit",
                                                            order_type=OrderType.MARKET)]
        observer = SimpleNamespace(session=session, last_query=live.time.monotonic(), cache=cache)
        live_lifecycle.Observer.observe(observer)
        source.close_position.assert_not_called()
        cache.orders.return_value = []
        live_lifecycle.Observer.observe(observer)
        source.close_position.assert_called_once()

    def test_reconcile_stop_never_sends_order_commands(self):
        session = live.Session(self.manifest, self.output, "reconcile", account_verified=True)
        session.begin_stop("test")
        session.node = mock.Mock()
        cache = mock.Mock()
        observer = SimpleNamespace(session=session, last_query=live.time.monotonic(), cache=cache)
        live_lifecycle.Observer.observe(observer)
        cache.positions_open.assert_not_called()
        session.node.handle.return_value.stop.assert_called_once()
