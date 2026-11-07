"""Offline Live assembly and ownership boundaries; no authenticated venue calls."""

from argparse import Namespace
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
from nautilus_trader.model import InstrumentId, OrderSide, OrderStatus, OrderType, Quantity

from engine import live
from engine.live_errors import LiveRefusal
from engine.live_venue import Credentials


SOURCE = '''from nautilus_trader.trading import Strategy, StrategyConfig
from nautilus_trader.model import OmsType
class Source(Strategy):
    def __new__(cls, instrument_id, bar_type, **kwargs):
        return Strategy.__new__(cls, StrategyConfig(strategy_id=kwargs["strategy_id"],
            oms_type=OmsType.NETTING, use_uuid_client_order_ids=True))
    def __init__(self, instrument_id, bar_type, **kwargs):
        super().__init__()
        self.observed = []
    def on_bar(self, event):
        self.observed.append("bar")
    def on_order_event(self, event):
        self.observed.append("order")
    def replay_diagnostics(self):
        return {}
    def replay_integrity_findings(self, orders_denied_or_rejected=False):
        return []
'''


class LiveTests(unittest.TestCase):
    def setUp(self):
        gc.collect()  # Release native nodes retained by previous mock-exception tracebacks.
        live.run.clear_failures()
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.output = Path(self.temp.name)
        self.strategy = self.output / "source.py"
        self.strategy.write_text(SOURCE)
        self.universe = self.output / "universe.json"
        self.universe.write_text('{"membership":{"BTCUSDT":[[0,9999999999999999999]]}}')
        self.credentials = Credentials("offline-placeholder", "offline-placeholder")
        self.manifest = {
            "format": "live-run-v2", "run_id": "native-test", "trader_id": "LIVE-001",
            "account_id": "BINANCE-LIVE-001", "credential_binding": self.credentials.binding,
            "symbols": ["BTCUSDT"], "origin_candidate": {
                "strategy_id": "example", "revision": 1, "source_sha256": "b" * 64}, "source": {
                "entry_class": "Source",
                "source_sha256": hashlib.sha256(SOURCE.encode()).hexdigest()},
            "runtime": {"image_ref": "ghcr.io/qoeop/trade-runtime@sha256:" + "a" * 64,
                        "image_digest": "sha256:" + "a" * 64, "runtime_contract": "replay-contract@v7"},
            "config": {"budget_usdt": "100", "max_notional_per_order": "90", "duration_seconds": 30,
                       "single_order_source_reviewed": True},
            "strategy_file": str(self.strategy), "universe_file": str(self.universe),
            "universe_sha256": hashlib.sha256(self.universe.read_bytes()).hexdigest(),
        }

    def test_manifest_cannot_rebind_account_source_or_runtime(self):
        live.bind_manifest(self.output, self.manifest)
        live.bind_manifest(self.output, self.manifest)
        changed = {**self.manifest, "account_id": "BINANCE-ANOTHER"}
        with self.assertRaisesRegex(LiveRefusal, "LIVE_IDENTITY_CHANGED"):
            live.bind_manifest(self.output, changed)
        self.assertEqual(json.loads((self.output / "manifest.json").read_text()), self.manifest)

    def test_invalid_manifest_no_nan_and_single_symbol(self):
        path = self.output / "input.json"
        for change in ({"symbols": ["BTCUSDT", "ETHUSDT"]},
                       {"config": {**self.manifest["config"], "budget_usdt": "NaN"}},
                       {"config": {**self.manifest["config"], "duration_seconds": True}}):
            with self.subTest(change=change):
                path.write_text(json.dumps({**self.manifest, **change}))
                with self.assertRaisesRegex(LiveRefusal, "LIVE_MANIFEST_INVALID"):
                    live.read_manifest(path)

    def test_linked_source_is_rejected_before_loading_or_connecting(self):
        self.strategy.write_text(SOURCE + "\n# native execution unsupported\nvalue = item.submit_order_list\n")
        with mock.patch.object(live, "load_strategy") as load:
            with self.assertRaisesRegex(LiveRefusal, "LIVE_SOURCE_UNSUPPORTED"):
                live.source_for_run(self.manifest)
            load.assert_not_called()

    def test_source_without_a_stop_loss_is_refused(self):
        source = SOURCE + "\nSource.USES_STOP_LOSS = False\n"
        self.strategy.write_text(source)
        self.manifest["source"]["source_sha256"] = hashlib.sha256(source.encode()).hexdigest()
        with self.assertRaises(LiveRefusal) as caught:
            live.source_for_run(self.manifest)
        self.assertEqual(caught.exception.code, "LIVE_SOURCE_UNSUPPORTED")

    def test_runner_refuses_any_other_manifest_format(self):
        path = self.output / "other-format.json"
        path.write_text(json.dumps({**self.manifest, "format": "live-run-v1"}))
        with self.assertRaises(LiveRefusal) as caught:
            live.read_manifest(path)
        self.assertEqual(caught.exception.code, "LIVE_MANIFEST_INVALID")

    def test_protection_covers_the_research_audits_stop_types(self):
        from engine.audit import STOP_TYPES
        self.assertEqual({order_type.name for order_type in live.STOP_ORDER_TYPES}, STOP_TYPES)

    def test_source_needs_explicit_review(self):
        del self.manifest["config"]["single_order_source_reviewed"]
        with self.assertRaisesRegex(LiveRefusal, "LIVE_SOURCE_REVIEW"):
            live.source_for_run(self.manifest)

    def test_native_source_config_is_checked_before_source_init_and_after_it(self):
        cases = (
            SOURCE.replace("oms_type=OmsType.NETTING,", "oms_type=OmsType.HEDGING,"),
            SOURCE.replace("use_uuid_client_order_ids=True", "use_uuid_client_order_ids=False"),
            SOURCE.replace("kwargs[\"strategy_id\"],", "None,"),
            SOURCE.replace("super().__init__()", "super().__init__(StrategyConfig())"),
            SOURCE.replace("    def __new__(cls, instrument_id, bar_type, **kwargs):\n"
                           "        return Strategy.__new__(cls, StrategyConfig(strategy_id=kwargs[\"strategy_id\"],\n"
                           "            oms_type=OmsType.NETTING, use_uuid_client_order_ids=True))\n", "")
                  .replace("super().__init__()", "super().__init__(StrategyConfig(strategy_id=kwargs['strategy_id'], "
                           "oms_type=OmsType.NETTING, use_uuid_client_order_ids=True))"),
        )
        for source in cases:
            with self.subTest(source=source):
                self.strategy.write_text(source)
                self.manifest["source"]["source_sha256"] = hashlib.sha256(source.encode()).hexdigest()
                loaded = live.source_for_run(self.manifest)
                session = live.Session(self.manifest, self.output, "run", account_verified=True)
                with self.assertRaisesRegex(LiveRefusal, "LIVE_SOURCE_CONFIG"):
                    live.live_source(loaded, session)

    def test_reconcile_build_has_no_source_constructor_or_source_callbacks(self):
        session = live.Session(self.manifest, self.output, "reconcile", account_verified=True)
        with mock.patch.object(live, "live_source") as source:
            node = live.build_node(session, self.credentials, RedisCacheConfig(host="127.0.0.1", port=1))
            source.assert_not_called()
            self.assertIsNone(session.source)
            self.assertEqual(str(node.environment), "LIVE")
            node.dispose()
            session.node = None

    def test_live_checks_native_identity_and_stop_despite_python_config_shadowing(self):
        from tests.engine.test_strategy_construction import SOURCE as CONFIGURED_SOURCE

        cases = (
            (CONFIGURED_SOURCE.replace("oms_type=OmsType.NETTING,", "order_id_tag='custom', oms_type=OmsType.NETTING,"),
             "LIVE_SOURCE_CONFIG"),
            (CONFIGURED_SOURCE.replace("class SourceConfig(StrategyConfig):",
                                      "class SourceConfig(StrategyConfig):\n    order_id_tag = None")
             .replace("oms_type=OmsType.NETTING,", "order_id_tag='custom', oms_type=OmsType.NETTING,"),
             "LIVE_SOURCE_CONFIG"),
            (CONFIGURED_SOURCE.replace("class SourceConfig(StrategyConfig):",
                                      "class SourceConfig(StrategyConfig):\n    manage_stop = False")
             .replace("manage_gtd_expiry=True,", "manage_stop=True, manage_gtd_expiry=True,"), "LIVE_SOURCE_STOP"),
            (CONFIGURED_SOURCE.replace("class SourceConfig(StrategyConfig):",
                                      "class SourceConfig(StrategyConfig):\n    market_exit_reduce_only = True")
             .replace("manage_gtd_expiry=True,", "market_exit_reduce_only=False, manage_gtd_expiry=True,"), "LIVE_SOURCE_CONFIG"),
        )
        for source, code in cases:
            with self.subTest(code=code, source=source):
                self.strategy.write_text(source)
                self.manifest["source"].update(entry_class="ConfiguredSource",
                    source_sha256=hashlib.sha256(source.encode()).hexdigest())
                loaded = live.source_for_run(self.manifest)
                session = live.Session(self.manifest, self.output, "run")
                with self.assertRaisesRegex(LiveRefusal, code):
                    live.live_source(loaded, session)

    def test_registration_cannot_change_the_native_recovery_identity(self):
        from tests.engine.test_strategy_construction import SOURCE as CONFIGURED_SOURCE

        source = CONFIGURED_SOURCE.replace("class SourceConfig(StrategyConfig):",
                                          "class SourceConfig(StrategyConfig):\n    order_id_tag = 'custom'")
        self.strategy.write_text(source)
        self.manifest["source"].update(entry_class="ConfiguredSource",
            source_sha256=hashlib.sha256(source.encode()).hexdigest())
        session = live.Session(self.manifest, self.output, "run")
        loaded = live.source_for_run(self.manifest)
        with self.assertRaisesRegex(LiveRefusal, "LIVE_SOURCE_CONFIG"):
            live.build_node(session, self.credentials, RedisCacheConfig(host="127.0.0.1", port=1), loaded)
        self.assertIsNone(session.node)
        self.assertIsNone(session.source)

    def test_commands_require_post_connect_account_and_disconnect_cannot_rearm(self):
        session = live.Session(self.manifest, self.output, "run")
        node = live.build_node(session, self.credentials, RedisCacheConfig(host="127.0.0.1", port=1),
                               live.source_for_run(self.manifest))
        try:
            source = session.source
            iid = InstrumentId.from_str("BTCUSDT-PERP.BINANCE")
            order = source.order_factory.market(iid, OrderSide.BUY, Quantity.from_str("0.001"))
            commands = (
                lambda: source.submit_order(order), lambda: source.modify_order(order.client_order_id),
                lambda: source.modify_orders([]), lambda: source.cancel_order(order.client_order_id),
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
            live.Observer.on_socket_state(observer, event)
            event.state = SocketState.CONNECTED
            live.Observer.on_socket_state(observer, event)
            self.assertFalse(session.account_verified)
            self.assertTrue(session.connection_failed)
            self.assertTrue(session.failed)
            session.node.handle.return_value.stop.assert_called_once()
            for command in commands:
                with self.assertRaisesRegex(LiveRefusal, "LIVE_CONNECTION_UNVERIFIED"):
                    command()
            source.on_order_event(SimpleNamespace(to_dict=lambda: {"type": "OrderFilled"}))
            self.assertEqual(source.observed, ["order"])
            with self.assertRaises(LiveRefusal):
                session.event("clean_stop")
        finally:
            node.dispose()
            session.node, session.source = None, None

    def test_post_connect_admission_rechecks_account_and_failure_preserves_custody(self):
        from tests.engine.test_live_venue import fixture

        for changed_mode in (False, True):
            with self.subTest(changed_mode=changed_mode):
                snapshot, _ = fixture()
                snapshot["credential_binding"] = self.credentials.binding
                snapshot["config"]["dualSidePosition"] = not changed_mode
                session = live.Session(self.manifest, self.output, "run")
                session.account_reader = mock.Mock()
                session.account_reader.snapshot.return_value = snapshot
                session.node, session.source = mock.Mock(), None if changed_mode else mock.Mock()
                observer = SimpleNamespace(session=session, last_query=live.time.monotonic(), cache=mock.Mock())
                observer.cache.positions_open.return_value = observer.cache.orders.return_value = []
                session.start_observation("connected")
                session.account_observation.result.result(timeout=1)
                live.Observer.observe(observer)
                session.account_reader.snapshot.assert_called_once_with(["BTCUSDT"])
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
                    live.Observer.observe(observer)
                    self.assertTrue(entered.wait(1))
                    future = session.account_observation.result
                    self.assertFalse(future.done())
                    self.assertFalse(session.account_verified)
                    with self.assertRaisesRegex(LiveRefusal, "LIVE_CONNECTION_UNVERIFIED"):
                        session.require_connection()
                    if disconnect:
                        live.Observer.on_socket_state(observer, SimpleNamespace(client_id="BINANCE",
                            endpoint="user-stream", state=SocketState.DISCONNECTED))
                    else:
                        session.stop_requested.set()
                        live.Observer.observe(observer)
                    self.assertIsNone(session.account_observation)
                    session.node.handle.return_value.stop.assert_called_once()
                    release.set()
                    future.result(timeout=1)
                    live.Observer.observe(observer)
                    self.assertFalse(session.account_verified)
                    with self.assertRaisesRegex(LiveRefusal, "LIVE_CONNECTION_UNVERIFIED"):
                        session.verify_connected_account(snapshot)
                    session.account_reader.snapshot.assert_called_once()
                finally:
                    release.set()

    def test_native_source_blocks_entries_after_stop_but_receives_fills(self):
        loaded = live.source_for_run(self.manifest)
        session = live.Session(self.manifest, self.output, "run", account_verified=True)
        node = live.build_node(session, self.credentials, RedisCacheConfig(host="127.0.0.1", port=1), loaded)
        def cleanup():
            node.dispose()
            session.node, session.source = None, None
        self.addCleanup(cleanup)
        source = session.source
        source.on_bar(SimpleNamespace(ts_event=9999999999999999999))
        session.begin_stop("test")
        source.on_bar(SimpleNamespace(ts_event=9999999999999999999))
        source.on_order_event(SimpleNamespace(to_dict=lambda: {"type": "OrderFilled"}))
        self.assertEqual(source.observed, ["bar", "order"])
        order = source.order_factory.market(InstrumentId.from_str("BTCUSDT-PERP.BINANCE"),
                                            OrderSide.BUY, Quantity.from_str("0.001"))
        with self.assertRaisesRegex(LiveRefusal, "LIVE_ENTRY_STOPPED"):
            source.submit_order(order)
        with self.assertRaisesRegex(LiveRefusal, "LIVE_ORDER_OWNERSHIP"):
            source.cancel_all_orders(order.instrument_id, strategy_only=False)

    def test_pending_stop_is_applied_before_next_observer_tick(self):
        loaded = live.source_for_run(self.manifest)
        session = live.Session(self.manifest, self.output, "run", account_verified=True)
        node = live.build_node(session, self.credentials, RedisCacheConfig(host="127.0.0.1", port=1), loaded)
        try:
            source = session.source
            session.stop_requested.set()
            order = source.order_factory.market(InstrumentId.from_str("BTCUSDT-PERP.BINANCE"),
                                                OrderSide.BUY, Quantity.from_str("0.001"))
            with self.assertRaisesRegex(LiveRefusal, "LIVE_ENTRY_STOPPED"):
                source.submit_order(order)
            self.assertTrue(session.stopping)
            source.on_bar(SimpleNamespace(ts_event=9999999999999999999))
            self.assertEqual(source.observed, [])
        finally:
            node.dispose()
            session.node, session.source = None, None

    def test_first_completed_minute_is_not_discarded_at_an_aligned_start(self):
        loaded = live.source_for_run(self.manifest)
        session = live.Session(self.manifest, self.output, "run", account_verified=True)
        start = 1_767_225_600_000_000_000
        with mock.patch.object(live.time, "time_ns", return_value=start):
            node = live.build_node(session, self.credentials, RedisCacheConfig(host="127.0.0.1", port=1), loaded)
        try:
            session.source.on_bar(SimpleNamespace(ts_event=start + 60_000_000_000 - 1_000_000))
            self.assertEqual(session.source.observed, ["bar"])
        finally:
            node.dispose()
            session.node, session.source = None, None

    def test_existing_stop_never_initializes_source(self):
        loaded = live.source_for_run(self.manifest)
        session = live.Session(self.manifest, self.output, "run", account_verified=True)
        (self.output / "STOP").write_text("stop")
        with mock.patch.object(live, "live_source") as source:
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
            source = session.source
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
            session.node, session.source = None, None

    def test_journal_failure_keeps_fill_callback_and_prevents_clean_claim(self):
        loaded = live.source_for_run(self.manifest)
        session = live.Session(self.manifest, self.output, "run", account_verified=True)
        node = live.build_node(session, self.credentials, RedisCacheConfig(host="127.0.0.1", port=1), loaded)
        try:
            with mock.patch.object(live.os, "fsync", side_effect=OSError("disk full")):
                session.source.on_order_event(SimpleNamespace(to_dict=lambda: {"type": "OrderFilled"}))
            self.assertEqual(session.source.observed, ["order"])
            self.assertTrue(session.stopping)
            self.assertTrue(session.journal_failed)
            with self.assertRaisesRegex(LiveRefusal, "LIVE_JOURNAL_UNAVAILABLE"):
                session.event("reconciled_flat")
        finally:
            node.dispose()
            session.node, session.source = None, None

    def test_storage_and_journal_failure_still_attempt_owned_exit_before_protection_cancel(self):
        session = live.Session(self.manifest, self.output, "run", account_verified=True)
        session.source, session.node, session.cache_guard = mock.Mock(strategy_id="SOURCE"), mock.Mock(), mock.Mock()
        session.cache_guard.health.side_effect = LiveRefusal("LIVE_CACHE_HEALTH", "unavailable")
        protection = SimpleNamespace(is_reduce_only=True, is_closed=False,
                                     client_order_id="stop", order_type=OrderType.STOP_MARKET)
        position = SimpleNamespace(id="position")
        cache = mock.Mock()
        cache.positions_open.return_value = [position]
        cache.orders.return_value = [protection]
        cache.orders_inflight.return_value = []
        cache.orders_active_local.return_value = []
        observer = SimpleNamespace(session=session, last_query=0, cache=cache)
        with mock.patch.object(live.os, "fsync", side_effect=OSError("disk full")):
            live.Observer.observe(observer)
        session.source.close_position.assert_called_once_with(position, reduce_only=True)
        session.source.cancel_order.assert_not_called()
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
        session.source = mock.Mock()
        session.source.replay_integrity_findings.return_value = []
        cache = mock.Mock()
        cache.orders.return_value = [SimpleNamespace(status=OrderStatus.REJECTED)]
        live.source_outcome(session, cache)
        session.source.replay_integrity_findings.assert_called_once_with(True)
        self.assertTrue(session.failed)
        row = json.loads((self.output / "events.jsonl").read_text())
        self.assertEqual(row["evidence"], "source_self_report")
        self.assertTrue(row["denied_or_rejected_native_orders"])

    def test_nonempty_source_findings_preserve_failure_when_native_account_is_flat(self):
        session = live.Session(self.manifest, self.output, "run", account_verified=True)
        session.source = mock.Mock()
        session.source.replay_integrity_findings.return_value = ["protective stop acknowledgement deadline"]
        cache = mock.Mock()
        cache.orders.return_value = []
        live.source_outcome(session, cache)
        self.assertTrue(session.failed)

    def test_old_source_rejection_does_not_fail_a_new_observation_only_reconciliation(self):
        session = live.Session(self.manifest, self.output, "reconcile", account_verified=True)
        cache = mock.Mock()
        cache.orders.return_value = [SimpleNamespace(status=OrderStatus.REJECTED)]
        live.source_outcome(session, cache)
        self.assertFalse(session.failed)
        cache.orders.assert_not_called()

    def test_source_shutdown_retains_bounded_reason_without_interpreting_it(self):
        session = live.Session(self.manifest, self.output, "run", account_verified=True)
        live._LiveConfigured.shutdown_system(SimpleNamespace(_live=session), "reason" * 300)
        row = json.loads((self.output / "events.jsonl").read_text())
        self.assertEqual(row["source_reason"], ("reason" * 300)[:1000])
        self.assertFalse(session.failed)

    def test_preflight_records_private_snapshot_without_native_node(self):
        manifest_path = self.output / "input.json"
        manifest_path.write_text(json.dumps(self.manifest))
        credential_path = self.output / "key.json"
        credential_path.write_text(json.dumps({"api_key": "offline-placeholder", "api_secret": "offline-placeholder"}))
        credential_path.chmod(0o600)
        snapshot = {"observed_ns": 123, "credential_binding": self.credentials.binding,
                    "positions": [], "orders": [], "algo_orders": []}
        args = Namespace(manifest=manifest_path, credentials_file=credential_path, output=self.output, mode="preflight")
        with mock.patch.object(live.BinanceReadOnly, "snapshot", return_value=snapshot), \
                mock.patch.object(live, "build_node") as build, \
                mock.patch.object(live, "require_admission") as admission, \
                mock.patch.object(live, "require_flat") as flat, \
                mock.patch.object(live, "source_for_run") as source:
            self.assertEqual(live.execute(args), 0)
            admission.assert_called_once_with(snapshot, self.manifest)
            flat.assert_called_once_with(snapshot)
            source.assert_called_once()
            for check in (admission, flat, source):
                check.side_effect = live.Refusal("LIVE_FUNDS", "not admitted")
                with self.assertRaises(live.Refusal):
                    live.execute(args)
                check.side_effect = None
            build.assert_not_called()
        self.assertFalse((self.output / "armed.json").exists())
        self.assertEqual(json.loads((self.output / "preflight-123.json").read_text()), snapshot)

    def test_stop_exits_before_canceling_protection_and_waits_for_native_events(self):
        session = live.Session(self.manifest, self.output, "run", account_verified=True)
        session.begin_stop("test")
        source = mock.Mock(strategy_id="SOURCE")
        session.source = source
        session.node = mock.Mock()
        protection = SimpleNamespace(is_reduce_only=True, is_closed=False,
                                     client_order_id="stop", order_type=OrderType.STOP_MARKET)
        position = SimpleNamespace(id="position")
        cache = mock.Mock()
        cache.positions_open.return_value = [position]
        cache.orders.return_value = [protection]
        cache.orders_inflight.return_value = []
        cache.orders_active_local.return_value = []
        observer = SimpleNamespace(session=session, last_query=live.time.monotonic(), cache=cache)
        live.Observer.observe(observer)
        source.close_position.assert_called_once_with(position, reduce_only=True)
        source.cancel_order.assert_not_called()
        live.Observer.observe(observer)
        source.close_position.assert_called_once()
        cache.positions_open.return_value = []
        live.Observer.observe(observer)
        source.cancel_order.assert_called_once_with("stop")
        self.assertFalse(session.native_flat)
        cache.orders.return_value = []
        live.Observer.observe(observer)
        self.assertTrue(session.native_flat)
        session.node.handle.return_value.stop.assert_called_once()

    def test_stop_waits_for_already_submitted_natural_exit(self):
        session = live.Session(self.manifest, self.output, "run", account_verified=True)
        session.begin_stop("test")
        source = mock.Mock(strategy_id="SOURCE")
        session.source, session.node = source, mock.Mock()
        cache = mock.Mock()
        cache.positions_open.return_value = [SimpleNamespace(id="position")]
        cache.orders.return_value = [SimpleNamespace(is_reduce_only=True, is_closed=False,
            client_order_id="natural-exit", order_type=OrderType.MARKET)]
        cache.orders_active_local.return_value = []
        cache.orders_inflight.return_value = [SimpleNamespace(is_reduce_only=True, client_order_id="natural-exit",
                                                            order_type=OrderType.MARKET)]
        observer = SimpleNamespace(session=session, last_query=live.time.monotonic(), cache=cache)
        live.Observer.observe(observer)
        source.close_position.assert_not_called()
        cache.orders.return_value = []
        live.Observer.observe(observer)
        source.close_position.assert_called_once()

    def test_reconcile_stop_never_sends_order_commands(self):
        session = live.Session(self.manifest, self.output, "reconcile", account_verified=True)
        session.begin_stop("test")
        session.node = mock.Mock()
        cache = mock.Mock()
        observer = SimpleNamespace(session=session, last_query=live.time.monotonic(), cache=cache)
        live.Observer.observe(observer)
        cache.positions_open.assert_not_called()
        session.node.handle.return_value.stop.assert_called_once()


if __name__ == "__main__":
    unittest.main()
