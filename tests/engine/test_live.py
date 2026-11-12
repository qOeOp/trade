"""Offline Live assembly and ownership boundaries; no authenticated venue calls."""

from argparse import Namespace
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
from nautilus_trader.model import InstrumentId, OrderSide, OrderStatus, OrderType, Quantity

from engine import live
from engine import live_commands as commands, live_lifecycle, live_node, live_session, live_source as live_source_runtime
from engine.config import Refusal
from engine.live_errors import LiveRefusal
from engine.live_venue import Credentials


SOURCE = '''from nautilus_trader.trading import Strategy
class Source(Strategy):
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
                        "image_digest": "sha256:" + "a" * 64, "runtime_contract": "replay-contract@v8"},
            "config": {"budget_usdt": "100", "max_loss_usdt": "10", "duration_seconds": 30,
                       "leverage": "50"},
            "market": {"market_day": "2026-11-09", "terms": {"BTCUSDT": {
                "price_increment": "0.10", "size_increment": "0.001", "min_notional": "50"}}},
            "strategy_file": str(self.strategy), "universe_file": str(self.universe),
            "universe_sha256": hashlib.sha256(self.universe.read_bytes()).hexdigest(),
            "evidence": [{"trial_id": 7, "starting_balance_usdt": "100",
                          "image_ref": "ghcr.io/qoeop/trade-runtime@sha256:" + "c" * 64}],
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
        with self.assertRaises(LiveRefusal) as caught:
            live.read_manifest(path)
        self.assertEqual(caught.exception.code, "LIVE_MANIFEST_INVALID")

    def test_runner_requires_a_loss_limit_within_the_budget(self):
        for limit in (None, "0", "-1", "NaN", "100.01"):
            with self.subTest(limit):
                config = dict(self.manifest["config"], max_loss_usdt=limit)
                if limit is None:
                    del config["max_loss_usdt"]
                path = self.output / "loss-limit.json"
                path.write_text(json.dumps({**self.manifest, "config": config}))
                with self.assertRaises(LiveRefusal) as caught:
                    live.read_manifest(path)
                self.assertEqual(caught.exception.code, "LIVE_MANIFEST_INVALID")

    def test_reconcile_build_has_no_source_constructor_or_source_callbacks(self):
        session = live.Session(self.manifest, self.output, "reconcile", account_verified=True)
        with mock.patch.object(live_node, "live_source") as source:
            node = live.build_node(session, self.credentials, RedisCacheConfig(host="127.0.0.1", port=1))
            source.assert_not_called()
            self.assertIsNone(session.source)
            self.assertEqual(str(node.environment), "LIVE")
            node.dispose()
            session.node = None

    def test_commands_require_post_connect_account_and_disconnect_only_closes_entries(self):
        session = live.Session(self.manifest, self.output, "run")
        node = live.build_node(session, self.credentials, RedisCacheConfig(host="127.0.0.1", port=1),
                               live.source_for_run(self.manifest))
        try:
            source = session.source
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
                session.node = mock.Mock()
                observer = SimpleNamespace(session=session, last_query=live.time.monotonic(), cache=mock.Mock())
                observer.cache.positions.return_value = observer.cache.positions_open.return_value = observer.cache.orders.return_value = []
                commands.start_observation(session, "connected")
                session.account_observation.result.result(timeout=1)
                live_lifecycle.Observer.observe(observer)
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
                        session.stop_requested.set()
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

    def test_native_source_blocks_entries_after_stop_but_receives_fills(self):
        loaded = live.source_for_run(self.manifest)
        session = live.Session(self.manifest, self.output, "run", account_verified=True)
        node = live.build_node(session, self.credentials, RedisCacheConfig(host="127.0.0.1", port=1), loaded)
        def cleanup():
            node.dispose()
            session.node, session.source = None, None
        self.addCleanup(cleanup)
        source = session.source
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
            source.on_bar(SimpleNamespace(ts_event=9999999999999999999, bar_type="BTCUSDT-PERP.BINANCE-1-MINUTE-LAST-EXTERNAL"))
            self.assertEqual(source.observed, [])
        finally:
            node.dispose()
            session.node, session.source = None, None

    def test_the_source_hears_the_minutes_after_its_t(self):
        loaded = live.source_for_run(self.manifest)
        session = live.Session(self.manifest, self.output, "run", account_verified=True)
        start = 1_767_225_600_000_000_000
        with mock.patch.object(live.time, "time_ns", return_value=start):
            node = live.build_node(session, self.credentials, RedisCacheConfig(host="127.0.0.1", port=1), loaded)
        try:
            at = start + 60_000_000_000  # the first whole minute at least 30 s after the start (engine.history)
            self.assertEqual(session.source._replay_input_start_ns, at)
            session.source.on_bar(SimpleNamespace(ts_event=at - 1_000_000, bar_type="BTCUSDT-PERP.BINANCE-1-MINUTE-LAST-EXTERNAL"))
            session.source.on_bar(SimpleNamespace(ts_event=at + 60_000_000_000 - 1_000_000, bar_type="BTCUSDT-PERP.BINANCE-1-MINUTE-LAST-EXTERNAL"))
            self.assertEqual(session.source.observed, ["bar"])
        finally:
            node.dispose()
            session.node, session.source = None, None

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
            live_lifecycle.Observer.observe(observer)
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
                "positions": [], "orders": [], "algo_orders": []}

    def good_clock(self):
        now = live.time.time_ns()
        return [{"sent_ns": now, "server_ms": now // 1_000_000, "received_ns": now}]

    def test_a_clock_outside_the_limits_stops_preflight_and_run_but_is_not_read_on_reconcile(self):
        bad = self.good_clock()
        bad[0]["server_ms"] += 3000
        for mode in ("preflight", "run"):
            with self.subTest(mode), mock.patch.object(live.BinanceReadOnly, "snapshot", return_value=self.flat_snapshot()), \
                    mock.patch.object(live.BinanceReadOnly, "clock", return_value=bad), \
                    mock.patch.object(live, "build_node") as build, self.assertRaises(LiveRefusal) as caught:
                live.execute(self.runner_args(mode))
            self.assertEqual(caught.exception.code, "LIVE_CLOCK")
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
            admission.assert_called_once_with(snapshot, self.manifest)  # its default flat=True checks the account
            source.assert_called_once()
            for check in (admission, source):
                check.side_effect = live.Refusal("LIVE_FUNDS", "not admitted")
                with self.assertRaises(live.Refusal):
                    live.execute(args)
                check.side_effect = None
            build.assert_not_called()
        self.assertFalse((self.output / "armed.json").exists())
        self.assertEqual(json.loads((self.output / "preflight-123.json").read_text()), snapshot)

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
                mock.patch.object(live, "build_node") as build, self.assertRaises(LiveRefusal) as caught:
            live.execute(self.runner_args("reconcile"))
        self.assertEqual(caught.exception.code, "LIVE_ACCOUNT_RESPONSE")
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
                    mock.patch.object(live.signal, "pthread_sigmask"), mock.patch.object(live.threading, "Thread"):
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
                with self.assertRaises(LiveRefusal) as caught:
                    live.execute(args)
            self.assertEqual(caught.exception.code, "LIVE_ALREADY_RUNNING")
            read.assert_not_called()
            self.assertFalse((self.output / "manifest.json").exists())
            self.assertEqual(live.execute(args), 0)  # With the first runner gone the same execution proceeds.
            read.assert_called_once()

    def test_an_interrupted_armed_run_resumes_as_itself_and_an_ended_one_cannot(self):
        class Armed(Exception):
            """Stops a start after it armed (or resumed), before it blocks this process's signals."""

        args = self.runner_args("run")
        held = dict(self.flat_snapshot(), positions=[{"symbol": "BTCUSDT", "positionAmt": "0.001"}])
        with mock.patch.object(live.BinanceReadOnly, "snapshot", return_value=self.flat_snapshot()) as snapshot, \
                mock.patch.object(live, "require_admission"), mock.patch.object(live, "require_account_mode"), \
                mock.patch.object(live, "source_for_run") as source, mock.patch.object(live, "build_node") as build, \
                mock.patch.object(live.strategy_runtime, "clear_failures", side_effect=Armed):
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
            for ending in ("unresolved", "clean_stop"):
                with self.subTest(ending):
                    events = (self.output / "events.jsonl").read_text()
                    with (self.output / "events.jsonl").open("a") as stream:
                        stream.write(json.dumps({"event": ending, "run_id": "r"}) + "\n")
                    with self.assertRaises(LiveRefusal) as caught:
                        live.execute(args)
                    self.assertEqual(caught.exception.code, "LIVE_COLD_RESTART")
                    (self.output / "events.jsonl").write_text(events)
            (self.output / "STOP").write_text("operator stop\n")
            with self.assertRaises(LiveRefusal) as caught:
                live.execute(args)
            self.assertEqual(caught.exception.code, "LIVE_COLD_RESTART")
        self.assertEqual((self.output / "armed.json").read_bytes(), armed)

    def test_stop_exits_before_canceling_protection_and_waits_for_native_events(self):
        session = live.Session(self.manifest, self.output, "run", account_verified=True)
        session.begin_stop("test")
        source = mock.Mock(strategy_id="SOURCE")
        session.source = source
        session.node = mock.Mock()
        protection = SimpleNamespace(is_reduce_only=True, is_closed=False, status=OrderStatus.ACCEPTED,
                                     client_order_id="stop", order_type=OrderType.STOP_MARKET)
        position = SimpleNamespace(id="position")
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
        source = mock.Mock(strategy_id="SOURCE")
        session.source, session.node = source, mock.Mock()
        entry = SimpleNamespace(is_reduce_only=False, is_closed=False, client_order_id="entry", side="BUY",
                                instrument_id="AAA", status=OrderStatus.ACCEPTED, order_type=OrderType.LIMIT)
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
        source = mock.Mock(strategy_id="SOURCE")
        session.source, session.node = source, mock.Mock()
        entry = SimpleNamespace(is_reduce_only=False, is_closed=False, client_order_id="entry", side="BUY",
                                instrument_id="AAA", status=OrderStatus.PENDING_CANCEL, order_type=OrderType.LIMIT)
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


if __name__ == "__main__":
    unittest.main()
