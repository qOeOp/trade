"""A checkpoint cannot turn pending callbacks, hooks or native orders into an empty account."""
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock

from nautilus_trader.trading import Strategy

from engine import paper_checkpoint as checkpoint, run
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
        loaded = SimpleNamespace(strategy_class=cls, daily_warmup=False)
        result = Session(backend, mock.Mock(), loaded, saved, 1, 2)
        result.ready = True
        self.addCleanup(run.clear_failures)
        return result

    def strategy(self):
        return SimpleNamespace(_paper_held=[], _paper_subscription_changes=False, _paper_user_timers=False,
                               _paper_subscriptions={"BTC-1-MINUTE-LAST-EXTERNAL"}, clock=SimpleNamespace(timer_names=lambda: []),
                               save=lambda: {"phase": b"1"},
                               order_factory=SimpleNamespace(get_client_order_id_count=lambda: 3,
                                                             get_order_list_id_count=lambda: 1),
                               _paper_cadence=mock.Mock())

    def test_native_default_hooks_are_not_an_explicit_recovery_protocol(self):
        self.assertFalse(self.session(Empty).supported)
        self.assertTrue(self.session().supported)

    def test_a_callback_or_runtime_failure_refuses_without_publishing(self):
        session = self.session()
        with session.callback():
            with self.assertRaises(checkpoint.Refusal):
                session.cut()
        run.FAILURES.append({"stage": "on_bar"})
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
            with mock.patch.dict(run.STRATEGIES, {"BTC": strategy}, clear=True):
                with self.assertRaises(checkpoint.Refusal):
                    session.cut(SimpleNamespace(orders=lambda: []))
        session.backend.snapshot.assert_not_called()

    def test_both_id_counters_and_cadence_share_the_native_marker(self):
        from engine.paper import Cadence
        session = self.session()
        strategy = self.strategy()
        strategy._paper_cadence = Cadence(mark_minute=12, next_funding_ns=30)
        cache = SimpleNamespace(orders=lambda: [SimpleNamespace(is_closed=True)])
        with mock.patch.dict(run.STRATEGIES, {"BTC": strategy}, clear=True):
            session.cut(cache)
        session.journal.sync.assert_called_once()
        source = session.backend.snapshot.call_args.args[1]["sources"]["BTC"]
        self.assertEqual(source, {"state": {"phase": "MQ=="}, "factory": [3, 1],
                                  "cadence": {"mark_minute": 12, "next_funding_ns": 30}})

    def test_a_user_timer_that_already_fired_cannot_be_recreated_by_restore_start(self):
        session = self.session()
        strategy = self.strategy()
        strategy._paper_user_timers = True
        with mock.patch.dict(run.STRATEGIES, {"BTC": strategy}, clear=True):
            with self.assertRaises(checkpoint.Refusal):
                session.cut(SimpleNamespace(orders=lambda: []))
        session.backend.snapshot.assert_not_called()

    def test_native_stop_cannot_hide_a_source_timer_or_cancelled_order(self):
        for orders, timers in (([SimpleNamespace(is_closed=False)], []), ([], ["source-timer"])):
            session = self.session()
            strategy = self.strategy()
            strategy.clock.timer_names = lambda: timers
            with mock.patch.dict(run.STRATEGIES, {"BTC": strategy}, clear=True):
                session.before_stop(SimpleNamespace(orders=lambda: orders))
                # Native component shutdown removes timers and may complete cancellation.
                strategy.clock.timer_names = lambda: []
                with self.assertRaises(checkpoint.Refusal):
                    session.cut(SimpleNamespace(orders=lambda: []))
            session.backend.snapshot.assert_not_called()

    def test_live_subscriptions_wait_for_all_native_history_and_source_starts(self):
        session = self.session()
        session.ready, session.expected_starts = False, 2
        session.cache = SimpleNamespace(account_for_venue=lambda _: SimpleNamespace(
            to_dict=lambda: {"calculate_account_state": True}))
        session.pending = {"BTC"}
        seen = []
        session.start(lambda: seen.append("source"))
        session.start(lambda: seen.append("recorder"))
        self.assertEqual(seen, [])
        session.history_complete("BTC")
        self.assertEqual(seen, ["source", "recorder"])
        session.history_complete("BTC")
        self.assertEqual(seen, ["source", "recorder"])

    def test_a_freeze_crossing_midnight_retains_its_original_bucket(self):
        from engine.load import DAY_NS
        from engine.paper import Cadence
        session = self.session()
        session.loaded.daily_warmup = True
        strategy = self.strategy()
        strategy._paper_cadence = Cadence()
        strategy._paper_subscriptions.add("BTC-1-DAY-LAST-INTERNAL@1-MINUTE-EXTERNAL")
        with mock.patch.dict(run.STRATEGIES, {"BTC": strategy}, clear=True), \
                mock.patch("engine.paper_session.time.time_ns", side_effect=[DAY_NS - 1, DAY_NS + 1]):
            session.cut(SimpleNamespace(orders=lambda: []))
        session.saved = session.backend.snapshot.call_args.args[1]
        # A late publication cannot relabel the old bucket as a resumable new-day point.
        with mock.patch("engine.paper_session.time.time_ns", return_value=DAY_NS + 1):
            with self.assertRaises(checkpoint.Refusal):
                session._same_bucket()

    def test_waiting_point_can_cross_midnight_but_an_active_aggregation_cannot(self):
        from engine.load import DAY_NS
        session = self.session(saved={"sources": {}, "cut_ns": 0})
        session.loaded.daily_warmup = True
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

    def test_missing_native_minute_timestamp_is_not_guessed_from_wall_clock(self):
        session = self.session()
        (session.backend.output / "events.jsonl").write_text(json.dumps({"kind": "bar", "instrument_id": "BTC"}))
        with self.assertRaises(checkpoint.Refusal):
            Session(session.backend, session.journal, session.loaded, {"sources": {}}, 1, 2)
