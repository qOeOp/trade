"""A checkpoint cannot turn pending callbacks, hooks or native orders into an empty account."""
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
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
from engine import metrics, paper_session, protection
from engine.paper_session import Session
from tests.helpers import refused


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


def trailing(kind="TRAILING_STOP_MARKET", side="SELL", activation="101000.0", is_activated=False, **fields):
    """A trailing stop as the cut reads it from the native cache: `is_activated` is rc7's matching engine's."""
    return order(kind=kind, side=side, activation_price=None if activation is None else Price.from_str(activation),
                 is_activated=is_activated, **fields)


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
                               _paper_subscriptions={"BTC-1-MINUTE-LAST-EXTERNAL"}, clock=SimpleNamespace(timer_names=list),
                               _metrics_owed=lambda now: [],
                               save=lambda: {"phase": b"1"},
                               _paper_cadence={})

    def test_native_default_hooks_are_not_an_explicit_recovery_protocol(self):
        self.assertFalse(self.session(Empty).supported)
        self.assertTrue(self.session().supported)

    def test_the_protocol_is_what_python_resolves_not_what_the_text_says_first(self):
        """declares_recovery is the runner's verdict the `started` line carries (user 2026-11-18): the last assignment
        wins, a computed value counts, and hooks bound by assignment or from a base count."""
        class Reassigned(Hooks):
            PAPER_RECOVERY = 0
            PAPER_RECOVERY = 1  # noqa: PIE794

        class Computed(Hooks):
            PAPER_RECOVERY = int("1")

        class Bound(Strategy):
            PAPER_RECOVERY = 1
            on_save = Hooks.on_save
            on_load = Hooks.on_load

        class Undone(Hooks):
            PAPER_RECOVERY = 1
            PAPER_RECOVERY = 0  # noqa: PIE794

        for cls, expected in ((Reassigned, True), (Computed, True), (Bound, True), (Undone, False), (Empty, False)):
            with self.subTest(cls=cls.__name__):
                self.assertIs(paper_session.declares_recovery(cls), expected)
                self.assertIs(self.session(cls).declared, expected)

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
        restored by the Sandbox's start as it was, a trailing stop only while it is not activated (user decision
        2026-11-18); one in flight, emulated, contingent or linked, an activated trailing stop, a partial fill or
        another triggered order is not, and defers the cut."""
        restorable = (order(), order(kind="LIMIT", price="98000.0"), order(kind="STOP_LIMIT", status="TRIGGERED"),
                      order(kind="LIMIT_IF_TOUCHED"), order(kind="MARKET_IF_TOUCHED"),
                      order(trigger_type="MARK_PRICE"), order(kind="MARKET_IF_TOUCHED", trigger_type="MARK_PRICE"),
                      trailing(), trailing(kind="TRAILING_STOP_LIMIT", side="BUY", activation="99000.0"),
                      trailing(trigger_type="MARK_PRICE"), order(is_closed=True, status="CANCELED"))
        unrestorable = {"INITIALIZED": order(status="INITIALIZED"), "SUBMITTED": order(status="SUBMITTED"),
                        "PENDING_UPDATE": order(status="PENDING_UPDATE"),
                        "PENDING_CANCEL": order(status="PENDING_CANCEL"),
                        "PARTIALLY_FILLED": order(kind="LIMIT", status="PARTIALLY_FILLED"),
                        "triggered LIMIT_IF_TOUCHED": order(kind="LIMIT_IF_TOUCHED", status="TRIGGERED"),
                        "emulated": order(is_emulated=True),
                        "OTO": order(contingency_type=ContingencyType.OTO),
                        "parent": order(parent_order_id="O-0"), "linked": order(linked_order_ids=["O-2"]),
                        "activated trailing": trailing(is_activated=True),
                        "activated trailing limit": trailing(kind="TRAILING_STOP_LIMIT", is_activated=True),
                        "triggered trailing limit": trailing(kind="TRAILING_STOP_LIMIT", status="TRIGGERED"),
                        # What the recovery's check could not decide (touched) defers the cut instead.
                        "trailing without an activation price": trailing(activation=None),
                        "BID_ASK trigger": order(trigger_type="BID_ASK"),
                        "trailing on BID_ASK": trailing(trigger_type="BID_ASK"),
                        "MARKET_IF_TOUCHED on BID_ASK": order(kind="MARKET_IF_TOUCHED", trigger_type="BID_ASK")}
        strategy = self.strategy()
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
                                       _paper_subscriptions={"BTC-1-MINUTE-LAST-EXTERNAL"}, _metrics_owed=lambda now: [],
                                       clock=SimpleNamespace(timer_names=lambda: timers))
            with mock.patch.dict(strategy_runtime.STRATEGIES, {"BTC": strategy}, clear=True):
                with self.assertRaises(checkpoint.Refusal):
                    session.cut(SimpleNamespace(orders=list))
        session.backend.snapshot.assert_not_called()

    def test_both_id_counters_and_cadence_share_the_native_marker(self):
        session = self.session()
        strategy = self.strategy()
        strategy._paper_cadence = {IID: Cadence(mark_minute=12, next_funding_ns=30), "ETH": Cadence(mark_minute=13)}
        cache = SimpleNamespace(orders=lambda: [SimpleNamespace(is_closed=True)])
        with mock.patch.dict(strategy_runtime.STRATEGIES, {"BTC": strategy}, clear=True):
            session.cut(cache)
        session.journal.sync.assert_called_once()
        source = session.backend.snapshot.call_args.args[1]["sources"]["BTC"]
        self.assertEqual(source, {"state": {"phase": "MQ=="},
                                  "cadence": {IID: {"mark_minute": 12, "next_funding_ns": 30},
                                              "ETH": {"mark_minute": 13, "next_funding_ns": None}}})
        restored, strategy.load = self.session(saved={"cut_ns": 1, "sources": {"BTC": source}}), mock.Mock()
        before, strategy._paper_cadence = strategy._paper_cadence, {}
        restored.restore_source(strategy, "BTC")
        self.assertEqual(strategy._paper_cadence, before)

    def test_a_user_timer_that_already_fired_cannot_be_recreated_by_restore_start(self):
        session = self.session()
        strategy = self.strategy()
        strategy._paper_user_timers = True
        with mock.patch.dict(strategy_runtime.STRATEGIES, {"BTC": strategy}, clear=True):
            with self.assertRaises(checkpoint.Refusal):
                session.cut(SimpleNamespace(orders=list))
        session.backend.snapshot.assert_not_called()

    def test_native_stop_cannot_hide_a_source_timer_or_cancelled_order(self):
        for orders, timers in (([order(status="PENDING_CANCEL")], []), ([], ["source-timer"])):
            session = self.session()
            strategy = self.strategy()
            strategy.clock.timer_names = lambda: timers
            with mock.patch.dict(strategy_runtime.STRATEGIES, {"BTC": strategy}, clear=True):
                session.before_stop(SimpleNamespace(orders=lambda: orders))
                # Native component shutdown removes timers and may complete cancellation.
                strategy.clock.timer_names = list
                with self.assertRaises(checkpoint.Refusal):
                    session.cut(SimpleNamespace(orders=list))
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

    def test_a_recovery_that_crossed_a_funding_settlement_is_held_instead(self):
        """The source would never see the settlement as it happened (user decision 2026-11-17): the run is held, as one
        of a source without the protocol, and no aggregation is back-filled for it."""
        saved = {"sources": {IID: {"cadence": {IID: {"mark_minute": None, "next_funding_ns": T - MINUTE_NS}}}}, "cut_ns": T - 20 * MINUTE_NS,
                 "recorder": {"funding": {}}}
        for now, held in ((T - 2 * MINUTE_NS, False), (T, True)):
            with self.subTest(held=held), mock.patch("engine.paper_session.time.time_ns", return_value=now):
                session = self.session(saved=saved)
                self.assertEqual((session.held, session.supported, session.declared), (held, not held, True))
                self.assertEqual(session.fallen, "the recovery crossed an unobserved funding settlement" if held
                                 else None)
        with mock.patch("engine.paper_session.time.time_ns", return_value=T):
            session = SessionTests.session(self, saved=saved)
            session.loaded = SimpleNamespace(strategy_class=Hooks, warmup=(("15-MINUTE", 3),))
            self.assertEqual(session.crossed(T), (T, {}), "a held recovery back-fills nothing")
            self.assertFalse(session.missed_settlement(), "a held recovery has no source to miss it")
        # One due after the process started, once the node runs the source, still refuses.
        with mock.patch("engine.paper_session.time.time_ns", return_value=T - 2 * MINUTE_NS):
            session = self.session(saved=saved)
        session.ready, session.expected_starts = False, 1
        session.cache = SimpleNamespace(account_for_venue=lambda _: SimpleNamespace(
            to_dict=lambda: {"calculate_account_state": True}))
        with mock.patch("engine.paper_session.time.time_ns", return_value=T), self.assertRaises(checkpoint.Refusal):
            session.start(lambda: None)


QUARTER = 15 * MINUTE_NS
DELAY = 5_000_000_000  # engine.history.BUILD_DELAY_US: rc7 stamps an aggregated bar this long after its bucket's end


def aggregated(end: int, close="100000.0"):
    """A 15-minute bar of the bucket ending at `end`, as the native cache holds one."""
    return SimpleNamespace(ts_event=end + DELAY, close=Price.from_str(close), bar_type="BTCUSDT-15-MINUTE")


def minute(close: int, low="99500.0", high="100500.0", price="100000.0"):
    return SimpleNamespace(ts_event=close - 1_000_000, low=Price.from_str(low), high=Price.from_str(high),
                           close=Price.from_str(price))


class BackfillTests(unittest.TestCase):
    """A recovery that crossed a bucket boundary of a declared aggregation hands the source the aggregated bars it
    missed instead of being refused (docs/plans/paper-recovery-open-orders-20261117.zh.md)."""

    START = T - 4 * QUARTER + 7 * MINUTE_NS  # the cut: seven minutes into a quarter

    def recovery(self, warm_at, warmup=(("15-MINUTE", 3),), sources=True, cut=START):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        backend = SimpleNamespace(output=root, root=root / "recovery", snapshot=mock.Mock(return_value={}))
        (root / "events.jsonl").write_bytes(b"")
        backend.root.mkdir()
        loaded = SimpleNamespace(strategy_class=Hooks, warmup=warmup)
        saved = {"sources": {IID: {"cadence": {}}} if sources else {}, "cut_ns": cut}
        return Session(backend, mock.Mock(), loaded, saved, 1, 2, warm_at, release=mock.Mock())

    def test_the_back_fill_starts_at_the_bucket_of_the_cut_and_t_never_ends_a_crossed_bucket(self):
        first = T - 4 * QUARTER  # the quarter the cut is in
        cases = {
            "the same bucket": (first + 10 * MINUTE_NS, (("15-MINUTE", 3),), True, first + 10 * MINUTE_NS, {}),
            "one boundary": (T - 3 * QUARTER + MINUTE_NS, (("15-MINUTE", 3),), True, T - 3 * QUARTER + MINUTE_NS,
                             {"15-MINUTE": first}),
            "three boundaries": (T - QUARTER + 2 * MINUTE_NS, (("15-MINUTE", 0),), True, T - QUARTER + 2 * MINUTE_NS,
                                 {"15-MINUTE": first}),
            # A request builds the bucket ending at T only once a later minute arrives: T moves on.
            "T at a boundary": (T, (("15-MINUTE", 3),), True, T + MINUTE_NS, {"15-MINUTE": first}),
            # Moved off the 3-minute boundary onto a 5-minute one, and on again.
            "T at two periods' boundaries": (T - 4 * QUARTER + 9 * MINUTE_NS, (("3-MINUTE", 0), ("5-MINUTE", 0)), True,
                                             T - 4 * QUARTER + 11 * MINUTE_NS,
                                             {"3-MINUTE": T - 4 * QUARTER + 6 * MINUTE_NS,
                                              "5-MINUTE": T - 4 * QUARTER + 5 * MINUTE_NS}),
            "a waiting checkpoint": (T, (("15-MINUTE", 3),), False, T, {}),
            "no aggregation": (T, (("1-MINUTE", 3),), True, T, {}),
        }
        for name, (at, warmup, sources, warm_at, since) in cases.items():
            with self.subTest(name), mock.patch("engine.paper_session.time.time_ns", return_value=at - MINUTE_NS):
                session = self.recovery(at, warmup, sources)
                self.assertEqual((session.warm_at, session.since), (warm_at, since))

    def handing(self, built, orders=None, warm_at=T + MINUTE_NS, minutes=None):
        """A recovery at `warm_at` of a cut in the quarter four before T, its cache holding `built`; `orders` maps a
        bar's bucket end to the order its source submits on it."""
        with mock.patch("engine.paper_session.time.time_ns", return_value=warm_at):
            session = self.recovery(warm_at)
        handed: list = []
        strategy = SimpleNamespace(_paper_subscriptions=set(), _metrics_owed=lambda now: [], _warming_state=lambda: {"expected": {
            ("warm", "15-MINUTE"): minutes or [minute(close) for close in range(
                T - 4 * QUARTER + MINUTE_NS, warm_at + 1, MINUTE_NS)]}})

        def on_bar(bar):
            handed.append(("held", bar.ts_event))
            order_ = (orders or {}).get(bar.ts_event - DELAY)
            strategy.pending = order_
        strategy.on_bar = on_bar
        strategy.pending = None

        def release(_):
            handed.append(("released", session.handing[1] + DELAY))
            if strategy.pending is not None:
                handed.append(("submitted", session.submitted(strategy.pending)))
        session.release = release
        session.cache = SimpleNamespace(bars=lambda bar_type: list(built) or None)
        with mock.patch.dict(strategy_runtime.STRATEGIES, {IID: strategy}, clear=True):
            return session, session.backfill(), handed

    def test_the_bars_completed_since_the_cut_reach_on_bar_in_order_one_released_before_the_next(self):
        ends = [T - 3 * QUARTER, T - 2 * QUARTER, T - QUARTER, T]
        # The cache holds them newest first, with a bar the source already had (before the cut) and none after T.
        built = [aggregated(end) for end in reversed(ends)] + [aggregated(T - 4 * QUARTER)]
        session, refused, handed = self.handing(built)
        self.assertIsNone(refused)
        self.assertEqual(handed, [step for end in ends for step in (("held", end + DELAY), ("released", end + DELAY))])
        self.assertIsNone(session.handing)
        _, refused, handed = self.handing([bar for bar in built if bar.ts_event != T - QUARTER + DELAY])
        self.assertIn("built 3 of the 4", refused)
        self.assertEqual(handed, [], "a bar missing hands none")

    def test_an_order_on_a_back_filled_bar_must_wait_untouched_until_t(self):
        bar_end = T - QUARTER
        below, above = ("99500.0", "99900.0"), ("100100.0", "100500.0")  # the minutes after it; its close is 100000
        quiet = order(kind="LIMIT", side="BUY", price="99000.0")
        cases = {
            "an untouched buy limit": (quiet, below, None),
            "an untouched sell stop": (order(side="SELL", trigger="99000.0"), below, None),
            "a buy limit above the close": (order(kind="LIMIT", side="BUY", price="100050.0"), above,
                                            "marketable at the close"),
            "a sell limit below the close": (order(kind="LIMIT", side="SELL", price="99950.0"), below,
                                             "marketable at the close"),
            "a buy stop below the close": (order(side="BUY", trigger="99950.0"), below, "marketable at the close"),
            "a sell stop above the close": (order(side="SELL", trigger="100050.0"), above, "marketable at the close"),
            "a buy stop a minute reached": (order(side="BUY", trigger="99900.0"), below, "touched in the interruption"),
            "a buy limit a minute reached": (order(kind="LIMIT", side="BUY", price="99500.0"), below,
                                             "touched in the interruption"),
            "a MARKET": (order(kind="MARKET"), below, "is a MARKET order"),
            "a GTD expiring by T": (order(kind="LIMIT", side="BUY", price="99000.0", tif="GTD", expire_time=T), below,
                                    "GTD expiry"),
            # Checked as restored ones are (user decision 2026-11-18).
            "an untouched MARK stop": (order(side="SELL", trigger="99000.0", trigger_type="MARK_PRICE"), below, None),
            "an untouched MARKET_IF_TOUCHED": (order(kind="MARKET_IF_TOUCHED", side="SELL", trigger="101000.0"),
                                               below, None),
            "an inactive trailing stop": (trailing(side="SELL", activation="101000.0"), below, None),
            "a trailing limit on MARK": (trailing(kind="TRAILING_STOP_LIMIT", side="SELL", activation="101000.0",
                                                  trigger_type="MARK_PRICE"), below, None),
            "a sell MARKET_IF_TOUCHED below the close": (order(kind="MARKET_IF_TOUCHED", side="SELL",
                                                               trigger="99950.0"), below, "marketable at the close"),
            "a sell MARK stop above the close": (order(side="SELL", trigger="100050.0", trigger_type="MARK_PRICE"),
                                                 above, "marketable at the close"),
            # The close at the activation price would have activated it at once in the uninterrupted run.
            "a sell trailing stop activated by the close": (trailing(side="SELL", activation="99950.0"), below,
                                                            "marketable at the close"),
            "a buy trailing stop activated by the close": (trailing(side="BUY", activation="100050.0"), above,
                                                           "marketable at the close"),
            "a buy MARKET_IF_TOUCHED a minute reached": (order(kind="MARKET_IF_TOUCHED", side="BUY",
                                                               trigger="99900.0"), below, "touched in the interruption"),
            "a buy trailing stop whose activation a minute reached": (trailing(side="BUY", activation="99900.0"),
                                                                     below, "touched in the interruption"),
            "a trailing stop without an activation price": (trailing(activation=None), below,
                                                            "without an activation price"),
            "a BID_ASK trigger": (order(trigger_type="BID_ASK"), below, "cannot be checked"),
        }
        bars = [aggregated(end, close="100000.0") for end in (T - 3 * QUARTER, T - 2 * QUARTER, bar_end, T)]
        for name, (found, (low, high), reason) in cases.items():
            with self.subTest(name):
                session, refused, handed = self.handing(bars, {bar_end: found}, minutes=[
                    minute(close, low=low, high=high) for close in range(
                        T - 4 * QUARTER + MINUTE_NS, T + 2 * MINUTE_NS, MINUTE_NS)])
                submitted = [item[1] for item in handed if item[0] == "submitted"]
                if reason is None:
                    self.assertEqual((refused, submitted), (None, [None]))
                    self.assertIn(("held", T + DELAY), handed)
                else:
                    self.assertIn(reason, submitted[0])
                    self.assertIn(reason, refused)
                    self.assertIn("back-filled 15-MINUTE bar", refused)
                    self.assertNotIn(("held", T + DELAY), handed, "the bar after the refused one is not handed")
        # A minute of the interruption missing after the bar fails as the interruption's check does.
        minutes = [minute(close) for close in range(T - 4 * QUARTER + MINUTE_NS, T + 2 * MINUTE_NS, MINUTE_NS)
                   if close != T - 5 * MINUTE_NS]
        _, refused, _ = self.handing(bars, {bar_end: quiet}, minutes=minutes)
        self.assertIn("could not all be read", refused)
        with mock.patch("engine.paper_session.time.time_ns", return_value=T):
            self.assertIsNone(self.recovery(T + MINUTE_NS).submitted(order(kind="MARKET")),
                              "outside the back-fill nothing is checked")
            session = self.recovery(T + MINUTE_NS)
        session.handing, session.refused = ("back-filled 15-MINUTE bar", bars[2].ts_event - DELAY, [], IID), "an earlier order's refusal"
        self.assertEqual(session.submitted(quiet), "an earlier order's refusal", "after a refusal nothing more is sent")
        session.handing = None
        self.assertEqual((session.submitted(quiet), session.commanded(), session.commanded(close=True)),
                         ("an earlier order's refusal",) * 3, "nor on a live bar, nor a cancel or close")
        # A position close on a back-filled bar is a MARKET order; a cancel there is sent.
        session.handing, session.refused = ("back-filled 15-MINUTE bar", bars[2].ts_event - DELAY, [], IID), None
        self.assertIsNone(session.commanded())
        self.assertIn("a position close is a MARKET order", session.commanded(close=True))
        self.assertIn("back-filled 15-MINUTE bar", session.refused)

    def test_a_source_subscribed_to_another_contracts_aggregation_gets_its_back_filled_bars_too(self):
        """User decision 2026-11-17: such subscriptions are recoverable. Each bar goes, by time and in the run's order
        of contracts, to every subscriber; an order a source submits on one is checked on its own contract's minutes
        and close, and one on another contract, whose minutes it did not read, refuses."""
        other = "ETHUSDT-PERP.BINANCE"
        with mock.patch("engine.paper_session.time.time_ns", return_value=T + MINUTE_NS):
            session = self.recovery(T + MINUTE_NS)
        ends = [T - 3 * QUARTER, T - 2 * QUARTER, T - QUARTER, T]
        # The other contract's bars close far from this one's minutes, and this one's bar at 100000 above its minute
        # closing the bucket: the check reads its own contract's minute.
        built = {IID: [aggregated(end) for end in ends], other: [aggregated(end, close="3000.0") for end in ends]}
        session.cache = SimpleNamespace(bars=lambda bar_type: built[next(i for i in built if str(bar_type).startswith(i))])
        handed: list = []

        def source(iid, subscriptions, orders):
            strategy = SimpleNamespace(_paper_subscriptions=subscriptions, _metrics_owed=lambda now: [],
                                       _warming_state=lambda: {"expected": {
                ("warm", "15-MINUTE"): [minute(close, low="99960.0", high="99990.0",
                                               price="99900.0" if close == T - QUARTER else "99970.0")
                                        for close in range(T - 4 * QUARTER + MINUTE_NS, T + 2 * MINUTE_NS, MINUTE_NS)]}})

            def on_bar(bar):
                handed.append((iid, "ETH" if bar.close.as_decimal() < 10000 else "BTC", bar.ts_event - DELAY))
                found = orders.get((bar.close.as_decimal() < 10000, bar.ts_event - DELAY))
                if found is not None:
                    handed.append(("submitted", session.submitted(found)))
            strategy.on_bar = on_bar
            return strategy

        quiet = order(kind="LIMIT", side="BUY", price="99000.0")
        # Each submitted by the BTC source on the ETH bar of the bucket ending at T - QUARTER.
        cases = {
            "an untouched order on its own contract": ({(True, T - QUARTER): quiet}, None),
            "a buy limit marketable at its contract's close": (
                {(True, T - QUARTER): order(kind="LIMIT", side="BUY", price="99950.0")}, "marketable at the close 99900"),
            "an order on the other contract": (
                {(True, T - QUARTER): order(kind="LIMIT", side="BUY", price="2000.0", instrument_id=other)},
                f"is on {other}"),
        }
        for name, (orders, reason) in cases.items():
            with self.subTest(name):
                handed.clear()
                session.refused = None
                strategies = {IID: source(IID, {Session.subscription(other, "15-MINUTE")}, orders),
                              other: source(other, set(), {})}
                with mock.patch.dict(strategy_runtime.STRATEGIES, strategies, clear=True):
                    refused = session.backfill()
                if reason is None:
                    self.assertIsNone(refused)
                    self.assertEqual([item for item in handed if item[0] != "submitted"], [
                        step for end in ends for step in ((IID, "BTC", end), (IID, "ETH", end), (other, "ETH", end))])
                    self.assertIn(("submitted", None), handed)
                else:
                    self.assertIn(reason, refused)
        with mock.patch.dict(strategy_runtime.STRATEGIES, {IID: object(), other: object()}, clear=True):
            required, allowed = session.subscriptions(IID)
        self.assertEqual(required, {f"{IID}-1-MINUTE-LAST-EXTERNAL", Session.subscription(IID, "15-MINUTE")})
        self.assertEqual(allowed - required, {Session.subscription(other, "15-MINUTE")},
                         "another contract's minutes, or an aggregation it did not declare, stay refused")

    def test_a_refused_back_fill_starts_the_sources_but_leaves_the_recovery_unready(self):
        with mock.patch("engine.paper_session.time.time_ns", return_value=T):
            session = self.recovery(T + MINUTE_NS)
        session.expected_starts, session.warm_at = 1, T + MINUTE_NS
        session.cache = SimpleNamespace(account_for_venue=lambda _: SimpleNamespace(
            to_dict=lambda: {"calculate_account_state": True}), orders=list, bars=lambda _: None)
        seen: list = []
        with mock.patch.dict(strategy_runtime.STRATEGIES, {IID: SimpleNamespace(
                _warming_state=lambda: {"expected": {}}, _metrics_owed=lambda now: [])}, clear=True), \
                mock.patch("engine.paper_session.time.time_ns", return_value=T + MINUTE_NS):
            session.start(lambda: seen.append("started"))
        self.assertEqual((seen, session.ready), (["started"], False))
        self.assertIn("built 0 of the 4", session.refused)

    def test_a_market_exit_begun_before_the_back_fill_ends_refuses_the_recovery(self):
        """The running exit would go on sending after a refusal (#3640)."""
        for since, refuses in (({"15-MINUTE": T - 4 * QUARTER}, True), ({}, False)):  # (no back-fill: the control)
            with self.subTest(refuses=refuses):
                with mock.patch("engine.paper_session.time.time_ns", return_value=T):
                    session = self.recovery(T + MINUTE_NS)
                session.expected_starts, session.since = 1, since
                session.cache = SimpleNamespace(account_for_venue=lambda _: SimpleNamespace(
                    to_dict=lambda: {"calculate_account_state": True}), orders=list)
                found: list = []
                with mock.patch.dict(strategy_runtime.STRATEGIES, {}, clear=True), \
                        mock.patch("engine.paper_session.time.time_ns", return_value=T + MINUTE_NS):
                    session.start(lambda: found.append(session.exiting()))
                self.assertIs(session.ready, not refuses)
                self.assertEqual(session.refused, found[0])
                if refuses:
                    self.assertIn("a market exit begun before the back-fill ended", found[0])
                    self.assertEqual(session.commanded(close=True), found[0], "nothing more is sent")
                else:
                    self.assertIsNone(found[0])
        # Once the back-fill has ended and the recovery is ready, an exit begins.
        session.since, session.ready = {"15-MINUTE": T}, True
        self.assertIsNone(session.exiting())
        session.handing = ("back-filled 15-MINUTE bar", T, [], IID)
        self.assertIn("a position close is a MARKET order", session.exiting())

    def test_a_cut_waits_for_the_bar_of_a_bucket_that_ended(self):
        with mock.patch("engine.paper_session.time.time_ns", return_value=T):
            session = self.recovery(T + MINUTE_NS)
        latest: list = [aggregated(T + QUARTER - QUARTER)]  # the last bar before the bucket ending at T + QUARTER
        cache = SimpleNamespace(bar=lambda _: latest[0])
        with mock.patch.dict(strategy_runtime.STRATEGIES, {IID: SimpleNamespace(_metrics_owed=lambda now: [])},
                             clear=True):
            self.assertIsNone(session.due(cache, T + QUARTER - 1))
            self.assertIn("has not reached the source", session.due(cache, T + QUARTER + 1))
            latest[0] = aggregated(T + QUARTER)
            self.assertIsNone(session.due(cache, T + QUARTER + DELAY))
            # A bucket ending at or before T is the warm-up's: its bar is back-filled or was never the source's.
            latest[0] = None
            self.assertIsNone(session.due(cache, T + 2 * MINUTE_NS))
        strategy = SessionTests.strategy(self)  # type: ignore[arg-type]
        strategy._paper_subscriptions = {f"{IID}-1-MINUTE-LAST-EXTERNAL",
                                         f"{IID}-15-MINUTE-LAST-INTERNAL@1-MINUTE-EXTERNAL"}
        session.ready = True
        cache = SimpleNamespace(bar=lambda _: aggregated(T), orders=list)
        with mock.patch.dict(strategy_runtime.STRATEGIES, {IID: strategy}, clear=True):
            with mock.patch("engine.paper_session.time.time_ns", return_value=T + QUARTER + 1):
                caught = refused(session.cut, cache, error=checkpoint.Refusal)
            self.assertIn("has not reached the source", str(caught))
            session.backend.snapshot.assert_not_called()
            cache.bar = lambda _: aggregated(T + QUARTER)
            with mock.patch("engine.paper_session.time.time_ns", return_value=T + QUARTER + DELAY):
                session.cut(cache)
            session.backend.snapshot.assert_called_once()
            # A paused node's final cut is the instant it stopped: a bucket ending while it shuts down has no bar due.
            with mock.patch("engine.paper_session.time.time_ns", return_value=T + 2 * QUARTER - 1):
                session.before_stop(cache)
            with mock.patch("engine.paper_session.time.time_ns", return_value=T + 2 * QUARTER + 1):
                session.cut(cache)
            self.assertEqual(session.backend.snapshot.call_args.args[1]["cut_ns"], T + 2 * QUARTER - 1)
            # A bar the node still dispatched while it shut down is one the source has had: the cut is not before it.
            cache.bar = lambda _: aggregated(T + 2 * QUARTER)
            with mock.patch("engine.paper_session.time.time_ns", return_value=T + 2 * QUARTER + DELAY):
                session.cut(cache)
            self.assertEqual(session.backend.snapshot.call_args.args[1]["cut_ns"], T + 2 * QUARTER)



class Metered(metrics.Feed):
    """A source following metrics through the runner's Feed (engine.metrics), its on_data and on_bar recorded."""

    def __init__(self, seen: list, read, minutes: list | None = None, on_row=None):
        self._metrics_setup(read)
        self.seen, self.minutes, self.on_row, self.log = seen, minutes, on_row, mock.Mock()
        self._paper_subscriptions: set[str] = set()

    def _warming_state(self):
        return {"expected": {} if self.minutes is None else {("warm", "15-MINUTE"): self.minutes}}

    def on_data(self, data):
        self.seen.append(("row", data.data.ts_init))
        if self.on_row:
            self.on_row(self, data.data.ts_init)

    def on_bar(self, bar):
        self.seen.append(("bar", bar.ts_event - DELAY))


class MetricsRecoveryTests(unittest.TestCase):
    """#3783: a metrics subscription made in on_start is a fixed one. A recovery's on_start follows the contract from
    the checkpoint's cut, and the back-fill hands over the rows due since, by time with the aggregated bars."""

    CUT = BackfillTests.START  # T - 53 minutes: the first row due after it is due at T - 50 minutes
    ROWS = list(range(T - 50 * MINUTE_NS, T + 1, 5 * MINUTE_NS))  # due after the cut and by T + 1 minute
    ENDS = [T - 3 * QUARTER, T - 2 * QUARTER, T - QUARTER, T]

    def recover(self, warmup=(("15-MINUTE", 3),), read=None, minutes=None, on_row=None, built=True):
        with mock.patch("engine.paper_session.time.time_ns", return_value=T + MINUTE_NS):
            session = BackfillTests.recovery(self, T + MINUTE_NS, warmup)  # type: ignore[arg-type]
        self.assertEqual(session.metrics_after(), self.CUT, "a recovery's on_start follows from the cut")
        seen: list = []
        reads: list = []

        def rest(iid, ts_event, wanted):
            reads.append(ts_event)
            return {name: Decimal("1.5") for name in wanted}
        source = Metered(seen, read or rest, minutes, on_row)
        clock = mock.Mock(**{"timer_names.return_value": []})
        session.release = lambda _: seen.append("released")
        session.cache = SimpleNamespace(bars=lambda _: [aggregated(end) for end in self.ENDS] if built else None)
        with mock.patch.object(Metered, "_metrics_clock", return_value=clock), \
                mock.patch.dict(strategy_runtime.STRATEGIES, {IID: source}, clear=True):
            source._metrics_follow(IID, session.metrics_after())
            return session, source, session.backfill(), seen, reads

    def test_the_rows_due_since_the_cut_reach_the_source_by_time_with_the_bars(self):
        session, source, refused, seen, reads = self.recover()
        self.assertIsNone(refused)
        # A row due at a bucket's end comes before that bucket's bar, stamped BUILD_DELAY_US later.
        expected = sorted([(due, ("row", due)) for due in self.ROWS] + [(end + DELAY, ("bar", end)) for end in self.ENDS])
        self.assertEqual(seen, [step for _, item in expected for step in (item, "released")])
        self.assertEqual(reads, [due - metrics.VISIBLE_NS for due in self.ROWS], "each row read once, by its stamp")
        self.assertEqual(source._metrics_followed[IID]["ts_event"], T, "the Feed goes on with the row due after T")
        self.assertIsNone(session.handing)

    def test_a_row_rest_cannot_give_refuses_before_anything_is_handed(self):
        def failing(iid, ts_event, wanted):
            if ts_event == T - 30 * MINUTE_NS:
                raise OSError("reset")
            return {name: Decimal("1.5") for name in wanted}
        _, _, refused, seen, _ = self.recover(read=failing)
        self.assertIn("metrics row stamped", refused)
        self.assertIn("OSError: reset", refused)
        self.assertEqual(seen, [])

    def test_an_unfollow_on_a_back_filled_row_stops_the_later_rows(self):
        clock = mock.Mock(**{"timer_names.return_value": [metrics.TIMER]})

        def unfollow(source, due):
            if due == T - 40 * MINUTE_NS:
                with mock.patch.object(Metered, "_metrics_clock", return_value=clock):
                    source._metrics_unfollow(IID)
        _, source, refused, seen, _ = self.recover(on_row=unfollow)
        self.assertIsNone(refused)
        self.assertEqual([item for item in seen if item != "released" and item[0] == "row"],
                         [("row", due) for due in self.ROWS if due <= T - 40 * MINUTE_NS])
        self.assertEqual([item[1] for item in seen if item != "released" and item[0] == "bar"], self.ENDS)
        self.assertEqual(source._metrics_followed, {})

    def test_an_order_on_a_back_filled_row_is_checked_as_on_a_bar_ending_at_its_due_time(self):
        quiet = order(kind="LIMIT", side="BUY", price="99000.0")
        warm = [minute(close) for close in range(T - 4 * QUARTER + MINUTE_NS, T + 2 * MINUTE_NS, MINUTE_NS)]
        cases = {
            "an untouched buy limit": ((("15-MINUTE", 3),), warm, quiet, None),
            "a MARKET": ((("15-MINUTE", 3),), warm, order(kind="MARKET"), "is a MARKET order"),
            "a buy stop a minute reached": ((("15-MINUTE", 3),), warm, order(side="BUY", trigger="100400.0"),
                                            "touched in the interruption"),
            # A source declaring no aggregation reads no minutes: its order cannot be proven untouched.
            "no warm-up minutes": ((("1-MINUTE", 3),), None, quiet, "could not all be read"),
        }
        for name, (warmup, minutes, submitted, reason) in cases.items():
            with self.subTest(name):
                found: list = []

                def submit(source, due, submitted=submitted, found=found):
                    if due == T - 20 * MINUTE_NS:
                        found.append(session_[0].submitted(submitted))
                session_: list = []
                original = Session.backfill

                def backfill(self_):
                    session_.append(self_)
                    return original(self_)
                with mock.patch.object(Session, "backfill", backfill):
                    session, _, refused, _, _ = self.recover(warmup, minutes=minutes, on_row=submit,
                                                             built=minutes is not None)
                if reason is None:
                    self.assertEqual((found, refused), ([None], None))
                else:
                    self.assertIn(reason, found[0])
                    self.assertIn(f"back-filled {IID} metrics row due at", refused)

    def test_a_cut_waits_for_a_row_due_and_the_feeds_timer_is_not_a_source_timer(self):
        session = SessionTests.session(self)  # type: ignore[arg-type]
        strategy = SessionTests.strategy(self)  # type: ignore[arg-type]
        due = 10 * metrics.PERIOD_NS
        strategy._metrics_owed = lambda now: [{"instrument_id": IID, "ts_event": due - metrics.VISIBLE_NS}] if (
            now >= due) else []
        timers = [metrics.TIMER]
        strategy.clock = SimpleNamespace(timer_names=lambda: list(timers), cancel_timer=timers.remove)
        cache = SimpleNamespace(orders=list)
        with mock.patch.dict(strategy_runtime.STRATEGIES, {"BTC": strategy}, clear=True):
            with mock.patch("engine.paper_session.time.time_ns", return_value=due):
                caught = refused(session.cut, cache, error=checkpoint.Refusal)
            self.assertIn(f"the {IID} metrics row due at", str(caught))
            session.backend.snapshot.assert_not_called()
            with mock.patch("engine.paper_session.time.time_ns", return_value=due - 1):
                session.cut(cache)
            session.backend.snapshot.assert_called_once()
            # The Feed hands no row after a pause's stop instant; a source's own timer still refuses the pause.
            session.before_stop(cache)
            self.assertEqual((timers, session.pause_error), ([], None))
            timers[:] = [metrics.TIMER, "a-source-timer"]
            session.before_stop(cache)
            self.assertIn("a source timer", session.pause_error)

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
        session.cache = SimpleNamespace(account_for_venue=lambda _: account, orders=list)
        seen: list = []
        with mock.patch("engine.paper_session.time.time_ns", return_value=101):
            session.start(lambda: seen.append("recorder"))
            session.start(lambda: seen.append("holder"))
        self.assertEqual((seen, session.ready), (["recorder", "holder"], True))

    def test_a_held_recovery_journals_a_gap_still_open_again_and_a_restored_one_does_not(self):
        """User 2026-11-17 (keep it held, notify at once): a held position without a working stop is journalled after
        `resumed`, where the Paper page and the release's notice read it; a recovery that restores its source keeps
        the gap it already journalled."""
        saved = {"sources": {}, "cut_ns": 0, "recorder": {
            "minute": 1, "marks": {}, "funding": {}, "protection": {"since": {"P-1": 0}, "reported": ["P-1"]}}}
        for cls, again in ((Empty, ["P-1"]), (Hooks, [])):
            with self.subTest(cls=cls.__name__):
                recorder = SimpleNamespace(gaps=protection.Gaps(), cadence={})
                self.session(cls, saved=saved).restore_recorder(recorder)
                self.assertEqual(recorder.gaps.since, {"P-1": 0})
                self.assertEqual(recorder.gaps.update(T, ["P-1"]), again)
                self.assertEqual(recorder.gaps.update(T + 1, ["P-1"]), [], "once per gap")


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
                      order(kind="MARKET_IF_TOUCHED", side="BUY", trigger="99000.0"),
                      order(kind="MARKET_IF_TOUCHED", side="SELL", trigger="101000.0"),
                      order(side="SELL", trigger="99000.0", trigger_type="MARK_PRICE"),
                      order(side="BUY", trigger="101000.0", trigger_type="MARK_PRICE"),
                      trailing(side="SELL", activation="101000.0"), trailing(side="BUY", activation="99000.0"),
                      trailing(kind="TRAILING_STOP_LIMIT", side="SELL", activation="101000.0", trigger_type="MARK_PRICE"),
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
                      order(kind="LIMIT_IF_TOUCHED", side="SELL", trigger="101000.0"),
                      order(kind="MARKET_IF_TOUCHED", side="BUY", trigger="99000.0"),
                      order(kind="MARKET_IF_TOUCHED", side="SELL", trigger="101000.0"),
                      order(side="SELL", trigger="99000.0", trigger_type="MARK_PRICE"),
                      # A trailing stop the interruption reached the activation price of may have activated.
                      trailing(side="SELL", activation="101000.0"), trailing(side="BUY", activation="99000.0"),
                      trailing(kind="TRAILING_STOP_LIMIT", side="SELL", activation="101000.0")):
            with self.subTest(kind=found.order_type, side=found.side, status=found.status):
                reason = self.check(found, touching)
                self.assertIn("O-1", reason)
                self.assertIn("touched in the interruption", reason)
                self.assertIn("2025-12-31 23:58:00", reason)  # the minute closing two minutes after LAST's

    def test_what_the_minutes_cannot_prove_untouched_refuses(self):
        cases = {"a GTD without its expiry": (order(tif="GTD"), QUIET),
                 "a BID_ASK trigger": (order(trigger_type="BID_ASK"), QUIET),
                 "a trailing stop without an activation price": (trailing(activation=None), QUIET),
                 "an activated trailing stop": (trailing(is_activated=True), QUIET),
                 "a triggered trailing stop limit": (trailing(kind="TRAILING_STOP_LIMIT", status="TRIGGERED"), QUIET),
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

    def test_a_gtd_that_expired_in_the_interruption_needs_only_the_minutes_up_to_its_expiry(self):
        """The uninterrupted run matched each minute that opened before the expiry and then expired the order unfilled
        (rc7 matches a bar before it expires); the Sandbox expires the restored one on the first live bar after it
        matched that bar's open, which follows the last minute's close (native probe 2026-11-17)."""
        buy = dict(kind="LIMIT", side="BUY", price="99000.0", tif="GTD")
        touching = ("98900.0", "100500.0")
        # The minutes close at LAST + 1, 2, 3, 4 minutes (+ 1 ms); the second closes at E.
        expiry = LAST + 2 * MINUTE_NS + 1_000_000
        quiet = ("99500.0", "100500.0")
        cases = {
            "untouched up to its expiry, touched after it": (expiry, minutes(quiet, quiet, touching, quiet), None),
            # The first live bar opens where the last minute closed: the recovery matches it there before it expires.
            "the last minute reaching it": (expiry, minutes(quiet, quiet, quiet, touching), "touched"),
            "an expiry inside a minute that touched it": (expiry - 30 * 10**9, minutes(
                ("99500.0", "100500.0"), touching, ("99500.0", "100500.0"), ("99500.0", "100500.0")), "touched"),
            "the minute it expired at the close of, touched": (expiry, minutes(
                ("99500.0", "100500.0"), touching, ("99500.0", "100500.0"), ("99500.0", "100500.0")), "touched"),
            "an expiry at T": (T, minutes(quiet, quiet, touching, quiet), "touched"),
            "a minute missing after its expiry still fails": (expiry, QUIET[:3], "could not all be read"),
        }
        for name, (expire_time, bars, reason) in cases.items():
            with self.subTest(name):
                found = self.check(order(**buy, expire_time=expire_time), bars)
                if reason is None:
                    self.assertIsNone(found)
                else:
                    self.assertIn(reason, found)

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
        for bars, refuses in ((QUIET, False), (minutes(*[("98000.0", "100500.0")] * 4), True)):
            with self.subTest(refused=refuses):
                session = self.session(saved={"sources": {}, "cut_ns": 0})
                session.ready, session.expected_starts, session.warm_at = False, 2, T
                session.last_bar, session.downtime = {IID: LAST}, {IID: bars}
                session.cache = SimpleNamespace(account_for_venue=lambda _: account, orders=lambda: [order()])
                seen: list = []
                session.start(lambda: seen.append("recorder"))
                session.start(lambda: seen.append("BTC"))
                self.assertEqual((seen, session.ready, bool(getattr(session, "refused", None))),
                                 ([], False, True) if refuses else (["recorder", "BTC"], True, False))
