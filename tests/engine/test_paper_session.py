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
from nautilus_trader.model import (ContingencyType, OrderSide, OrderStatus, OrderType, Price, TimeInForce,
                                   TriggerType)
from nautilus_trader.trading import Strategy

from engine import strategy as strategy_runtime
from engine import paper_checkpoint as checkpoint
from engine.cadence import Cadence
from engine.config import MINUTE_NS
from engine import paper_session
from engine.paper_session import Session


class Hooks(Strategy):
    PAPER_RECOVERY = 1

    def on_save(self):
        return {"phase": b"1"}

    def on_load(self, state):
        pass


class Empty(Strategy):
    PAPER_RECOVERY = 1


IID = "BTCUSDT-PERP.BINANCE"
T = 1_767_225_600_000_000_000  # a recovery's T, a whole minute
LAST = T - 4 * MINUTE_NS - 1_000_000  # the journal's last bar closed four minutes before T


def order(kind="STOP_MARKET", status="ACCEPTED", side="SELL", trigger="99000.0", price="99000.0", tif="GTC",
          expire_time=None, trigger_type="DEFAULT", is_closed=False, **fields):
    """A cached order as the checkpoint and the recovery check read it."""
    return SimpleNamespace(**{
        "client_order_id": "O-1", "instrument_id": IID, "order_type": getattr(OrderType, kind),
        "status": getattr(OrderStatus, status), "side": getattr(OrderSide, side), "trigger_price": Price.from_str(trigger),
        "price": Price.from_str(price), "time_in_force": getattr(TimeInForce, tif), "expire_time": expire_time,
        "trigger_type": getattr(TriggerType, trigger_type), "is_closed": is_closed, "is_emulated": False,
        "emulation_trigger": None, "contingency_type": None, "parent_order_id": None, "linked_order_ids": None,
        **fields})


def minutes(*ranges: tuple[str, str]) -> list:
    """The interruption's one-minute bars after LAST, (low, high) each, closing a minute apart up to T."""
    return [SimpleNamespace(ts_event=LAST + (index + 1) * MINUTE_NS, low=Price.from_str(low), high=Price.from_str(high))
            for index, (low, high) in enumerate(ranges)]


QUIET = minutes(*[("99500.0", "100500.0")] * 4)


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

    def test_a_checkpoint_holds_the_working_orders_the_sandbox_restores_and_defers_for_any_other(self):
        """docs/plans/paper-recovery-open-orders-20261117.zh.md: an accepted order (a triggered STOP_LIMIT too) is
        restored by the Sandbox's start as it was; one in flight, emulated, contingent or linked, a trailing stop, a
        partial fill or another triggered order is not, and defers the cut."""
        restorable = (order(), order(kind="LIMIT", price="98000.0"), order(kind="STOP_LIMIT", status="TRIGGERED"),
                      order(kind="LIMIT_IF_TOUCHED"), order(is_closed=True, status="CANCELED"))
        unrestorable = {"INITIALIZED": order(status="INITIALIZED"), "SUBMITTED": order(status="SUBMITTED"),
                        "PENDING_UPDATE": order(status="PENDING_UPDATE"),
                        "PENDING_CANCEL": order(status="PENDING_CANCEL"),
                        "PARTIALLY_FILLED": order(kind="LIMIT", status="PARTIALLY_FILLED"),
                        "triggered LIMIT_IF_TOUCHED": order(kind="LIMIT_IF_TOUCHED", status="TRIGGERED"),
                        "emulated": order(is_emulated=True),
                        "OTO": order(contingency_type=ContingencyType.OTO),
                        "parent": order(parent_order_id="O-0"), "linked": order(linked_order_ids=["O-2"]),
                        "trailing": order(kind="TRAILING_STOP_MARKET"),
                        # What the recovery's check could not decide (touched) defers the cut instead.
                        "MARKET_IF_TOUCHED": order(kind="MARKET_IF_TOUCHED"),
                        "MARK trigger": order(trigger_type="MARK_PRICE")}
        strategy = self.strategy()
        strategy._paper_cadence = Cadence()
        for name, found in (("restorable", restorable), *((key, (value,)) for key, value in unrestorable.items())):
            with self.subTest(name), mock.patch.dict(strategy_runtime.STRATEGIES, {"BTC": strategy}, clear=True):
                session = self.session()
                cache = SimpleNamespace(orders=lambda found=found: list(found))
                if name == "restorable":
                    session.cut(cache)
                    session.backend.snapshot.assert_called_once()
                    session.before_stop(cache)
                    self.assertIsNone(session.pause_error)
                else:
                    with self.assertRaises(checkpoint.Refusal):
                        session.cut(cache)
                    session.backend.snapshot.assert_not_called()
                    session.before_stop(cache)
                    self.assertIn("cannot be restored", session.pause_error)

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
        for orders, timers in (([order(status="PENDING_CANCEL")], []), ([], ["source-timer"])):
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


class HeldTests(unittest.TestCase):
    """A source without the recovery protocol is held after an interruption (docs/plans/
    paper-recovery-open-orders-20261117.zh.md, 保持模式): its checkpoint holds the native cache and the recorder alone,
    and only while a position is open."""

    session = SessionTests.session

    @staticmethod
    def cache(positions=("P-1",), orders=None):
        return SimpleNamespace(orders=lambda: list(orders if orders is not None else [order()]),
                               positions_open=lambda: list(positions))

    def test_a_held_checkpoint_has_no_source_state_and_needs_an_open_position(self):
        source = SimpleNamespace(_paper_held=[], clock=SimpleNamespace(timer_names=lambda: ["a-source-timer"]))
        with mock.patch.dict(strategy_runtime.STRATEGIES, {"BTC": source}, clear=True):
            session = self.session(Empty)
            self.assertFalse(session.held, "a first run is not held")
            session.cut(self.cache())
            self.assertEqual(session.backend.snapshot.call_args.args[1]["sources"], {})
            for name, cache in (("flat", self.cache(positions=())),
                                ("an order in flight", self.cache(orders=[order(status="SUBMITTED")]))):
                with self.subTest(name):
                    session = self.session(Empty)
                    with self.assertRaises(checkpoint.Refusal):
                        session.cut(cache)
                    session.backend.snapshot.assert_not_called()
            source._paper_held = [object()]
            session = self.session(Empty)
            with self.assertRaises(checkpoint.Refusal):
                session.cut(self.cache())
            source._paper_held = []
            # A pause keeps a held checkpoint whatever timers the source had: no source is restored.
            session = self.session(Empty)
            session.before_stop(self.cache())
            self.assertIsNone(session.pause_error)
            session = self.session()
            session.before_stop(self.cache())
            self.assertIn("timer", session.pause_error, "a recovery-capable source's timer still refuses")

    def test_a_recovery_of_a_source_without_the_protocol_is_held_and_refuses_no_funding_crossing(self):
        saved = {"sources": {}, "cut_ns": 0, "recorder": {"funding": {IID: 100}}}
        session = self.session(Empty, saved=saved)
        self.assertTrue(session.held)
        self.assertFalse(self.session(saved=saved).held, "a recovery-capable source is restored, not held")
        account = SimpleNamespace(to_dict=lambda: {"calculate_account_state": True})
        session.ready, session.expected_starts, session.warm_at = False, 2, T
        session.cache = SimpleNamespace(account_for_venue=lambda _: account, orders=lambda: [])
        seen: list = []
        with mock.patch("engine.paper_session.time.time_ns", return_value=101):
            session.start(lambda: seen.append("recorder"))
            session.start(lambda: seen.append("holder"))
        self.assertEqual((seen, session.ready), (["recorder", "holder"], True))


class InterruptionTests(unittest.TestCase):
    """A recovery restores the working orders only when the interruption's minutes prove none was touched
    (docs/plans/paper-recovery-open-orders-20261117.zh.md): Nautilus matched nothing while the run was down."""

    session = SessionTests.session

    @staticmethod
    def check(found, bars=QUIET):
        return paper_session.touched([found], {IID: bars}, {IID: LAST}, T)

    def test_an_order_the_interruption_did_not_reach_is_restored(self):
        for found in (order(side="SELL", trigger="99000.0"), order(side="BUY", trigger="101000.0"),
                      order(kind="STOP_LIMIT", side="SELL", trigger="99000.0", price="98900.0"),
                      order(kind="LIMIT", side="BUY", price="99000.0"),
                      order(kind="LIMIT", side="SELL", price="101000.0"),
                      order(kind="STOP_LIMIT", status="TRIGGERED", side="SELL", trigger="99600.0", price="101000.0"),
                      order(kind="LIMIT_IF_TOUCHED", side="BUY", trigger="99000.0"),
                      order(kind="LIMIT_IF_TOUCHED", side="SELL", trigger="101000.0"),
                      order(trigger_type="LAST_PRICE"), order(tif="GTD", expire_time=T + 1),
                      order(status="CANCELED", kind="MARKET_IF_TOUCHED", is_closed=True)):
            with self.subTest(kind=found.order_type, side=found.side, status=found.status):
                self.assertIsNone(self.check(found))
        self.assertIsNone(paper_session.touched([], {}, {}, T), "no restored order needs no minute")

    def test_an_order_the_interruption_touched_refuses_the_recovery_naming_the_order_and_minute(self):
        touching = minutes(("99500.0", "100500.0"), ("99000.0", "101000.0"), ("99500.0", "100500.0"),
                           ("99500.0", "100500.0"))
        for found in (order(side="SELL", trigger="99000.0"), order(side="BUY", trigger="101000.0"),
                      order(kind="STOP_LIMIT", side="BUY", trigger="101000.0", price="101100.0"),
                      order(kind="LIMIT", side="BUY", price="99000.0"),
                      order(kind="LIMIT", side="SELL", price="101000.0"),
                      order(kind="STOP_LIMIT", status="TRIGGERED", side="BUY", trigger="101000.0", price="99000.0"),
                      order(kind="LIMIT_IF_TOUCHED", side="BUY", trigger="99000.0"),
                      order(kind="LIMIT_IF_TOUCHED", side="SELL", trigger="101000.0")):
            with self.subTest(kind=found.order_type, side=found.side, status=found.status):
                reason = self.check(found, touching)
                self.assertIn("O-1", reason)
                self.assertIn("touched in the interruption", reason)
                self.assertIn("2025-12-31 23:58:00", reason)  # the minute closing two minutes after LAST's

    def test_what_the_minutes_cannot_prove_untouched_refuses(self):
        cases = {"a GTD expiring in the interruption": (order(tif="GTD", expire_time=T - MINUTE_NS), QUIET),
                 "a GTD expiring at T": (order(tif="GTD", expire_time=T), QUIET),
                 "a MARK trigger": (order(trigger_type="MARK_PRICE"), QUIET),
                 "a BID_ASK trigger": (order(trigger_type="BID_ASK"), QUIET),
                 "a MARKET_IF_TOUCHED": (order(kind="MARKET_IF_TOUCHED"), QUIET),
                 "a triggered LIMIT_IF_TOUCHED": (order(kind="LIMIT_IF_TOUCHED", status="TRIGGERED", side="BUY"),
                                                  QUIET),
                 "a triggered STOP_MARKET": (order(status="TRIGGERED"), QUIET),
                 "a partly filled LIMIT": (order(kind="LIMIT", status="PARTIALLY_FILLED", side="BUY"), QUIET),
                 "a MARKET": (order(kind="MARKET"), QUIET),
                 "a minute missing": (order(), QUIET[:2] + QUIET[3:]),
                 "the last minute missing": (order(), QUIET[:-1])}
        for name, (found, bars) in cases.items():
            with self.subTest(name):
                self.assertIsNotNone(self.check(found, bars))
        self.assertIsNotNone(paper_session.touched([order()], {}, {IID: LAST}, T), "no minute read")
        self.assertIsNotNone(paper_session.touched([order()], {IID: QUIET}, {}, T), "no journalled bar")

    def test_the_reader_asks_for_the_minutes_from_the_journals_last_bar_up_to_the_one_closing_at_t(self):
        session = self.session(saved={"sources": {}, "cut_ns": 0})
        session.last_bar = {IID: LAST}
        asked = []

        def get(url, proxy_url):
            asked.append((url, proxy_url))
            # Binance's rows: open time, open, high, low, close, volume, close time (ms).
            return [[(LAST + 1_000_000 + index * MINUTE_NS) // 1_000_000, "100000", "100500", "99500", "100000", "1",
                     (LAST + (index + 1) * MINUTE_NS) // 1_000_000] for index in range(4)]
        session.read_downtime(IID, T, (1, 3), "http://proxy", get)
        session.read_downtime("ETHUSDT-PERP.BINANCE", T, (2, 3), "http://proxy", get)
        self.assertEqual(len(asked), 1, "a contract without a journalled bar reads nothing, so its orders refuse")
        self.assertIn(f"startTime={(LAST + 1_000_000) // 1_000_000}", asked[0][0])
        self.assertIn(f"endTime={(T - MINUTE_NS) // 1_000_000}", asked[0][0])
        self.assertEqual(asked[0][1], "http://proxy")
        self.assertEqual([bar.ts_event for bar in session.downtime[IID]],
                         [LAST + index * MINUTE_NS for index in range(1, 5)])

    def test_a_touched_order_starts_no_source_and_leaves_the_refusal_for_the_runner(self):
        account = SimpleNamespace(to_dict=lambda: {"calculate_account_state": True})
        for bars, refused in ((QUIET, False), (minutes(*[("98000.0", "100500.0")] * 4), True)):
            with self.subTest(refused=refused):
                session = self.session(saved={"sources": {}, "cut_ns": 0})
                session.ready, session.expected_starts, session.warm_at = False, 2, T
                session.last_bar, session.downtime = {IID: LAST}, {IID: bars}
                session.cache = SimpleNamespace(account_for_venue=lambda _: account, orders=lambda: [order()])
                seen: list = []
                session.start(lambda: seen.append("recorder"))
                session.start(lambda: seen.append("BTC"))
                self.assertEqual((seen, session.ready, bool(getattr(session, "refused", None))),
                                 ([], False, True) if refused else (["recorder", "BTC"], True, False))
