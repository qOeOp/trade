"""A checkpoint cannot turn pending callbacks, hooks or native orders into an empty account."""
from concurrent.futures import ThreadPoolExecutor
import gc
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock

from nautilus_trader.common import Cache
from nautilus_trader.trading import Strategy

from engine import strategy as strategy_runtime
from engine import paper_checkpoint as checkpoint
from engine.cadence import Cadence
from engine.paper_session import Session


class Hooks(Strategy):
    PAPER_RECOVERY = 1

    def on_save(self):
        return {"phase": b"1"}

    def on_load(self, state):
        pass


class Empty(Strategy):
    PAPER_RECOVERY = 1


class SessionTests(unittest.TestCase):
    def session(self, cls=Hooks, saved=None):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        backend = SimpleNamespace(output=root, root=root / "recovery", snapshot=mock.Mock(return_value={}))
        (root / "events.jsonl").write_bytes(b"")
        backend.root.mkdir()
        loaded = SimpleNamespace(strategy_class=cls, warmup=())
        result = Session(backend, mock.Mock(), loaded, saved, 1, 2, 2)
        result.ready = True
        self.addCleanup(strategy_runtime.clear_failures)
        return result

    def strategy(self):
        return SimpleNamespace(_paper_held=[], _paper_subscription_changes=False, _paper_user_timers=False,
                               _paper_subscriptions={"BTC-1-MINUTE-LAST-EXTERNAL"}, clock=SimpleNamespace(timer_names=lambda: []),
                               save=lambda: {"phase": b"1"},
                               _paper_cadence=mock.Mock())

    def test_native_default_hooks_are_not_an_explicit_recovery_protocol(self):
        self.assertFalse(self.session(Empty).supported)
        self.assertTrue(self.session().supported)

    def test_an_error_from_the_native_cache_defers_the_cut_and_never_escapes_the_timer(self):
        """A killed cache child gives RuntimeError: broken pipe. Out of the timer callback it stopped rc7's dispatch for
        good (finding 20261114-34); it is a deferred cut, reported once per message."""
        session = self.session()
        (session.backend.root / "dirty").write_bytes(b"")
        session.backend.snapshot.side_effect = RuntimeError("broken pipe")
        with mock.patch("builtins.print") as shown:
            session.try_cut(None)
            session.try_cut(None)
        self.assertEqual(session.error, "PAPER_RECOVERY_UNAVAILABLE: the native checkpoint failed: "
                                        "RuntimeError: broken pipe")
        shown.assert_called_once()
        session.backend.snapshot.side_effect = None
        session.try_cut(None)
        self.assertIsNone(session.error, "a cut that succeeds again clears the deferral")

    def test_a_deferred_cut_leaves_no_cycle_holding_the_owners_cache(self):
        """rc7's PyCache may only be freed on the thread that made it. A deferred cut that kept its exception left a
        cycle holding `cache`, and a collection on the native cache's I/O thread printed one "PyCache is unsendable"
        traceback per deferred cut (finding 20261115-03)."""
        session = self.session()
        (session.backend.root / "dirty").write_bytes(b"")
        io = ThreadPoolExecutor(max_workers=1)
        self.addCleanup(io.shutdown)

        def refuse():
            raise checkpoint.fail("native cache readback differs from the owner; the checkpoint stays dirty")
        # A plain function: a Mock would keep every `cache` alive in its call list.
        session.backend.snapshot = lambda cache, state: io.submit(refuse).result()
        dropped: list = []
        gc.disable()
        self.addCleanup(gc.enable)
        gc.collect()
        with mock.patch.object(sys, "unraisablehook", dropped.append), mock.patch("builtins.print"), \
                mock.patch.dict(strategy_runtime.STRATEGIES, clear=True):
            for _ in range(3):
                session.try_cut(Cache())  # a new PyCache per call, as an actor's `self.cache` gives
            io.submit(gc.collect).result()
        self.assertEqual([str(item.exc_value) for item in dropped], [])
        self.assertIn("readback differs", session.error)

    def test_a_marker_the_disk_refuses_is_the_journals_failure_and_the_callback_still_runs(self):
        session = self.session()
        ran = []
        with mock.patch.object(checkpoint, "dirty", side_effect=OSError(28, "No space left on device")):
            with session.callback():
                ran.append(session.depth)
        self.assertEqual(ran, [1])
        session.journal.fail.assert_called_once()
        self.assertEqual(session.depth, 0)

    def test_a_callback_or_runtime_failure_refuses_without_publishing(self):
        session = self.session()
        with session.callback():
            with self.assertRaises(checkpoint.Refusal):
                session.cut()
        strategy_runtime.FAILURES.append({"stage": "on_bar"})
        with self.assertRaises(checkpoint.Refusal):
            session.cut()
        session.backend.snapshot.assert_not_called()
        self.assertTrue((session.backend.root / "dirty").is_file())

    def test_initialized_and_working_orders_refuse_even_if_not_in_open_orders(self):
        session = self.session()
        for status in ("INITIALIZED", "SUBMITTED", "ACCEPTED", "PARTIALLY_FILLED"):
            with self.subTest(status=status):
                cache = SimpleNamespace(orders=lambda: [SimpleNamespace(status=status, is_closed=False)])
                with self.assertRaises(checkpoint.Refusal):
                    session.cut(cache)
        session.backend.snapshot.assert_not_called()

    def test_pending_held_callback_or_source_timer_refuses(self):
        session = self.session()
        for held, timers in (([object()], []), ([], ["a-user-timer"])):
            strategy = SimpleNamespace(_paper_held=held, _paper_subscription_changes=False, _paper_user_timers=False,
                                       _paper_subscriptions={"BTC-1-MINUTE-LAST-EXTERNAL"}, clock=SimpleNamespace(timer_names=lambda: timers))
            with mock.patch.dict(strategy_runtime.STRATEGIES, {"BTC": strategy}, clear=True):
                with self.assertRaises(checkpoint.Refusal):
                    session.cut(SimpleNamespace(orders=lambda: []))
        session.backend.snapshot.assert_not_called()

    def test_both_id_counters_and_cadence_share_the_native_marker(self):
        session = self.session()
        strategy = self.strategy()
        strategy._paper_cadence = Cadence(mark_minute=12, next_funding_ns=30)
        cache = SimpleNamespace(orders=lambda: [SimpleNamespace(is_closed=True)])
        with mock.patch.dict(strategy_runtime.STRATEGIES, {"BTC": strategy}, clear=True):
            session.cut(cache)
        session.journal.sync.assert_called_once()
        source = session.backend.snapshot.call_args.args[1]["sources"]["BTC"]
        self.assertEqual(source, {"state": {"phase": "MQ=="},
                                  "cadence": {"mark_minute": 12, "next_funding_ns": 30}})

    def test_a_user_timer_that_already_fired_cannot_be_recreated_by_restore_start(self):
        session = self.session()
        strategy = self.strategy()
        strategy._paper_user_timers = True
        with mock.patch.dict(strategy_runtime.STRATEGIES, {"BTC": strategy}, clear=True):
            with self.assertRaises(checkpoint.Refusal):
                session.cut(SimpleNamespace(orders=lambda: []))
        session.backend.snapshot.assert_not_called()

    def test_native_stop_cannot_hide_a_source_timer_or_cancelled_order(self):
        for orders, timers in (([SimpleNamespace(is_closed=False)], []), ([], ["source-timer"])):
            session = self.session()
            strategy = self.strategy()
            strategy.clock.timer_names = lambda: timers
            with mock.patch.dict(strategy_runtime.STRATEGIES, {"BTC": strategy}, clear=True):
                session.before_stop(SimpleNamespace(orders=lambda: orders))
                # Native component shutdown removes timers and may complete cancellation.
                strategy.clock.timer_names = lambda: []
                with self.assertRaises(checkpoint.Refusal):
                    session.cut(SimpleNamespace(orders=lambda: []))
            session.backend.snapshot.assert_not_called()

    def test_sources_and_recorder_start_together_once_every_source_has_warmed(self):
        session = self.session()
        session.ready, session.expected_starts = False, 3
        session.cache = SimpleNamespace(account_for_venue=lambda _: SimpleNamespace(
            to_dict=lambda: {"calculate_account_state": True}))
        seen = []
        session.start(lambda: seen.append("recorder"))
        session.start(lambda: seen.append("BTC"))
        self.assertEqual(seen, [])
        session.start(lambda: seen.append("ETH"))
        self.assertEqual(seen, ["recorder", "BTC", "ETH"])

    def test_a_recovery_crossing_a_declared_aggregations_boundary_is_refused(self):
        from engine.load import DAY_NS
        from engine.cadence import Cadence
        quarter = DAY_NS // 96
        for warmup, cut, resumed, refused in (((("1-DAY", 200),), DAY_NS - 1, DAY_NS + 1, True),
                                              ((("15-MINUTE", 0),), DAY_NS + 1, DAY_NS + quarter - 1, False),
                                              ((("15-MINUTE", 0),), DAY_NS + 1, DAY_NS + quarter + 1, True)):
            with self.subTest(warmup=warmup, resumed=resumed):
                session = self.session()
                session.loaded.warmup = warmup
                strategy = self.strategy()
                strategy._paper_cadence = Cadence()
                strategy._paper_subscriptions.add(f"BTC-{warmup[0][0]}-LAST-INTERNAL@1-MINUTE-EXTERNAL")
                with mock.patch.dict(strategy_runtime.STRATEGIES, {"BTC": strategy}, clear=True), \
                        mock.patch("engine.paper_session.time.time_ns", return_value=cut):
                    session.cut(SimpleNamespace(orders=lambda: []))
                session.saved = session.backend.snapshot.call_args.args[1]
                with mock.patch("engine.paper_session.time.time_ns", return_value=resumed):
                    if refused:
                        with self.assertRaises(checkpoint.Refusal):
                            session._same_bucket()
                    else:
                        session._same_bucket()

    def test_waiting_point_can_cross_midnight_but_an_active_aggregation_cannot(self):
        from engine.load import DAY_NS
        session = self.session(saved={"sources": {}, "cut_ns": 0})
        session.loaded.warmup = (("1-DAY", 200),)
        with mock.patch("engine.paper_session.time.time_ns", return_value=DAY_NS):
            session._same_bucket()
            session.saved["sources"] = {"BTC": {"cadence": {}}}
            with self.assertRaises(checkpoint.Refusal):
                session._same_bucket()

    def test_missed_funding_is_not_filled_with_a_later_estimate(self):
        session = self.session()
        session.saved = {"sources": {"BTC": {"cadence": {"next_funding_ns": 100}}}, "cut_ns": 1}
        with mock.patch("engine.paper_session.time.time_ns", return_value=101):
            with self.assertRaises(checkpoint.Refusal):
                session._same_bucket()
