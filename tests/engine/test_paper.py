"""engine.paper without a network: the credential refusal, the replay cadence of the live feed, the strategy's
data callbacks held until the next data dispatch, when the fills their data caused are applied, the instances a run plans and the event fields
the live view draws from."""

import functools
import hashlib
import tempfile
import threading
import time
import unittest
from contextlib import nullcontext
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from nautilus_trader.model import (BarType, FundingRateUpdate, InstrumentId, MarkPriceUpdate, OrderSide, OrderStatus, OrderType, Price,
                                   TriggerType)

from engine import klines, membership as membership_months, paper, paper_session, realtime
from engine.cadence import Cadence
from engine.config import MINUTE_NS, Refusal
from engine.load import DAY_NS
from ledger import run_journal
from tests.helpers import refused

DAYS = 200  # a declared WARMUP 1-DAY

IID = InstrumentId.from_str("BTCUSDT-PERP.BINANCE")
DAY = int(datetime(2026, 10, 25, tzinfo=UTC).timestamp() * 1e9)


def mark(ts: int) -> MarkPriceUpdate:
    return MarkPriceUpdate(IID, Price.from_str("100.0"), ts, ts)


def estimate(ts: int, next_funding_ns: int, rate: str = "0.0001") -> FundingRateUpdate:
    return FundingRateUpdate(IID, Decimal(rate), ts, ts, None, next_funding_ns)


class HoldTests(unittest.TestCase):
    def setUp(self):
        self.now = [DAY]
        clock = SimpleNamespace(timestamp_ns=lambda: self.now[0])
        for patch in (mock.patch.object(paper.Strategy, "clock", SimpleNamespace(__get__=lambda *_: clock)),
                      mock.patch.object(paper.strategy_runtime, "execution_failure"),
                      mock.patch.dict(paper.strategy_runtime.STRATEGIES, clear=True)):
            patch.start()
            self.addCleanup(patch.stop)

    def source(self, seen: list, name: str = "BTC"):
        class Source:
            def on_bar(self, bar):
                seen.append((name, "bar", bar.ts_init))
                if bar.ts_init == 2:
                    raise ValueError("recorded by its guard")

            def on_mark_price(self, update):
                seen.append((name, "mark", update.ts_init))

        instance = type("Held", (), {**paper.paper_callbacks(Source), "clock": None})()
        instance._paper_held, instance._paper_released_ns = [], 0
        instance._paper_cadence = mock.Mock(**{"setdefault.return_value.mark.return_value": True})
        paper.strategy_runtime.STRATEGIES[name] = instance
        return instance

    @staticmethod
    def bar(at: int, kind: str = "BTCUSDT-PERP.BINANCE-1-MINUTE-LAST-EXTERNAL"):
        return SimpleNamespace(bar_type=kind, ts_init=at)

    def test_data_callbacks_run_at_the_next_dispatch_in_their_order_and_one_that_raises_stops_none(self):
        seen: list = []
        btc, eth = self.source(seen), self.source(seen, "ETH")
        btc.on_bar(self.bar(1))
        self.assertEqual(seen, [], "held until another data event is dispatched")
        paper.release_before(self.bar(1))  # the same dispatch, as another subscriber gets it
        self.assertEqual(seen, [])
        eth.on_bar(self.bar(1, "ETHUSDT-PERP.BINANCE-1-MINUTE-LAST-EXTERNAL"))
        btc.on_mark_price(SimpleNamespace(instrument_id="BTCUSDT-PERP.BINANCE", ts_init=1))
        btc.on_bar(self.bar(2))
        self.assertEqual(seen, [("BTC", "bar", 1), ("ETH", "bar", 1), ("BTC", "mark", 1)])
        recorder = paper.Recorder.__new__(paper.Recorder)
        with mock.patch.object(paper.Recorder, "marks", {}, create=True), \
                mock.patch.object(paper.Recorder, "minute", None, create=True):
            paper.Recorder.on_mark_price(recorder, SimpleNamespace(instrument_id="X", ts_init=3, ts_event=3,
                                                                   value=None))
        btc.on_bar(self.bar(4))
        self.assertEqual(seen[3:], [("BTC", "bar", 2)], "the recorder's dispatch releases them too; one that raised "
                                                       "stops none")
        btc.on_bar(self.bar(5))
        self.assertEqual(seen[4:], [("BTC", "bar", 4)])
        btc._paper_held.clear()
        self.assertEqual((btc._paper_held, eth._paper_held), ([], []))

    def test_a_repeated_or_revised_bar_never_reaches_the_source_twice(self):
        # Binance may push a closed kline again (audit loopback s10_dup_live): the source would decide twice on one bar.
        seen: list = []
        btc = self.source(seen)
        kind = BarType.from_str("BTCUSDT-PERP.BINANCE-1-MINUTE-LAST-EXTERNAL")
        with mock.patch.object(paper, "journal") as journal:
            for at, stamp in ((10, MINUTE_NS), (11, MINUTE_NS), (12, 0), (13, 2 * MINUTE_NS), (14, 3 * MINUTE_NS)):
                btc.on_bar(SimpleNamespace(bar_type=kind, ts_event=stamp, ts_init=at))
        self.assertEqual(seen, [("BTC", "bar", 10), ("BTC", "bar", 13)])  # the last still held for its dispatch
        self.assertEqual([call.kwargs for call in journal.call_args_list if call.args[0] == "bar_repeated"],
                         [{"bar_type": str(kind), "after_ns": MINUTE_NS, "received_ns": MINUTE_NS},
                          {"bar_type": str(kind), "after_ns": MINUTE_NS, "received_ns": 0}])

    def test_an_aggregated_bar_the_source_receives_late_is_journalled(self):
        # Re-judge C-142 (user 2026-11-21, 「批准」): after a host sleep rc7's aggregation timer leaves every aggregated
        # bar late; the journal's late_aggregate row lets `paper compare` attribute what the source decided on it.
        btc, written = self.source([]), []
        kind = BarType.from_str("BTCUSDT-PERP.BINANCE-15-MINUTE-LAST-INTERNAL")
        end = DAY + 15 * MINUTE_NS
        stamped = end + paper.history.BUILD_DELAY_US * 1000
        late = end + paper.history.AGGREGATE_LATE_NS
        minute = BarType.from_str("BTCUSDT-PERP.BINANCE-1-MINUTE-LAST-EXTERNAL")
        rows = realtime.MarketRows(lambda kind, **fields: written.append((kind, fields)))
        with mock.patch.object(paper, "MARKET", rows):
            with mock.patch.object(realtime.time, "time_ns", return_value=late):
                btc.on_bar(SimpleNamespace(bar_type=kind, ts_event=stamped, ts_init=1))  # not yet late
            with mock.patch.object(realtime.time, "time_ns", return_value=late + 1):
                btc.on_bar(SimpleNamespace(bar_type=kind, ts_event=stamped, ts_init=2))
                btc.on_bar(SimpleNamespace(bar_type=minute, ts_event=end, ts_init=3))  # the Recorder's: a bar row
        self.assertEqual(written, [("late_aggregate", {"bar_type": str(kind), "ts_event": stamped})])

    def test_a_fill_stamped_before_released_callbacks_is_recorded_late(self):
        btc = self.source([])
        btc.on_bar(self.bar(1))
        self.now[0] = DAY + 5
        btc.on_bar(self.bar(2))  # releases the first bar, held at DAY
        filled = type("OrderFilled", (), {"strategy_id": "R1-BTCUSDT", "client_order_id": "O-1", "ts_event": DAY})()
        with mock.patch.object(paper, "journal") as journal, mock.patch.object(paper, "_event_fields", return_value={}):
            btc.on_order_event(filled)
            filled.ts_event = DAY + 1  # matched by the second bar, whose callbacks still wait
            btc.on_order_event(filled)
        late = [call for call in journal.call_args_list if call.args[0] == "release_late"]
        self.assertEqual(len(late), 1)
        self.assertEqual((late[0].kwargs["code"], late[0].kwargs["released_ns"]), ("PAPER_RELEASE_LATE", DAY))


class MetricsJournalTests(unittest.TestCase):
    """engine.paper journals each metrics row the Feed hands a source and each unsubscribe of metrics it followed,
    which `paper compare` checks against the archive (replay.comparison.compare_metrics)."""

    setUp = HoldTests.setUp

    def row(self, ts_event: int = DAY):
        from nautilus_trader.model import CustomData
        from engine.strategy import Metrics, metrics_data_type
        found = Metrics(IID, Decimal("97897.565").quantize(Decimal("1e-16")), Decimal("3.6904"), None,
                        Decimal("2.0001"), ts_event, ts_event + 5 * MINUTE_NS)
        return CustomData(metrics_data_type(str(IID)), found)

    def instance(self, seen: list | None):
        class Reads:
            def on_data(self, data):
                seen.append(data.data.ts_event)

        class Ignores:
            pass
        instance = type("Metered", (), {**paper.paper_callbacks(Ignores if seen is None else Reads), "clock": None})()
        instance._paper_held, instance._paper_released_ns = [], 0
        paper.strategy_runtime.STRATEGIES["BTC"] = instance
        return instance

    def test_each_row_handed_over_is_journalled_before_it_is_held_whether_or_not_the_source_reads_it(self):
        for seen in ([], None):
            with self.subTest(reads=seen is not None), mock.patch.object(paper, "JOURNAL") as journal:
                self.instance(seen).on_data(self.row())
                self.assertEqual(journal.write.call_args_list, [mock.call(
                    "metrics", instrument_id=str(IID), ts_event=DAY, sum_open_interest="97897.5650000000000000",
                    count_toptrader_long_short_ratio="3.6904", sum_toptrader_long_short_ratio=None,
                    count_long_short_ratio="2.0001")])
                if seen is not None:
                    self.assertEqual(seen, [], "held until the next data dispatch, as every data callback")
                    paper.release_before(HoldTests.bar(DAY + 1))
                    self.assertEqual(seen, [DAY])

    def test_the_feeds_hand_over_reaches_the_journal_through_the_paper_class(self):
        """The class paper_class builds: engine.metrics.Feed's own step hands the row to the journalling on_data."""
        from engine import metrics

        class Ignores:
            pass
        cls = type("PaperMetered", (paper._PaperConfigured, Ignores), {**paper.paper_callbacks(Ignores), "clock": None})
        source = object.__new__(cls)
        source._metrics_setup(None)
        found = {name: Decimal("1.5").quantize(metrics.EXACT) for name in metrics.ENDPOINTS}
        state = {"instrument_id": str(IID), "ts_event": DAY, "found": found, "thread": None, "retry_ns": 0}
        with mock.patch.object(paper, "JOURNAL") as journal:
            self.assertTrue(source._metrics_step(state, DAY + metrics.VISIBLE_NS))
        self.assertEqual(journal.write.call_args_list, [mock.call("metrics", instrument_id=str(IID), ts_event=DAY,
                                                            **{name: "1.5000000000000000" for name in metrics.ENDPOINTS})])

    def test_the_feeds_hand_over_releases_no_held_callback_before_its_fills(self):
        """The Feed hands a row over from its timer, which rc7's live runner takes before the execution events queued
        with it: a bar's held on_bar still waits for its fills, and both run at the next data dispatch in the order
        they came (2026-11-15 Paper trial: a BNB on_bar saw its entry ACCEPTED with 0 filled, then release_late)."""
        from engine import metrics
        seen: list = []

        class Source:
            def on_bar(self, bar):
                seen.append(("bar", bar.ts_init))

            def on_data(self, data):
                seen.append(("metrics", data.data.ts_event))
        cls = type("PaperHeld", (paper._PaperConfigured, Source), {**paper.paper_callbacks(Source), "clock": None})
        source = object.__new__(cls)
        source._paper_held, source._paper_released_ns = [], 0
        source._paper_cadence = {str(IID): mock.Mock(**{"mark.return_value": False})}
        source._metrics_setup(None)
        paper.strategy_runtime.STRATEGIES["BTC"] = source
        due = DAY + metrics.VISIBLE_NS
        self.now[0] = due
        source.on_bar(HoldTests.bar(due))  # held for the fills the Sandbox matched on it
        found = {name: Decimal("1.5").quantize(metrics.EXACT) for name in metrics.ENDPOINTS}
        state = {"instrument_id": str(IID), "ts_event": DAY, "found": found, "thread": None, "retry_ns": 0}
        filled = type("OrderFilled", (), {"strategy_id": "R1-BTCUSDT", "client_order_id": "O-1", "ts_event": due})()
        with mock.patch.object(paper, "JOURNAL") as journal, mock.patch.object(paper, "_event_fields", return_value={}):
            self.assertTrue(source._metrics_step(state, due))  # the Feed's tick
            self.assertEqual(seen, [], "the bar's on_bar waits for its fills, the row with it")
            source.on_order_event(filled)  # the execution channel, after the timer
            source.on_mark_price(mark(due + 1))  # the next data dispatch
        self.assertEqual(seen, [("bar", due), ("metrics", DAY)])
        self.assertEqual([call.args[0] for call in journal.write.call_args_list], ["metrics", "order"],
                         "no release_late: the fill reached the cache before the on_bar of its bar ran")
        self.assertEqual(source._paper_held, [])

    def test_metrics_followed_in_on_start_are_fixed_and_a_recovery_follows_from_its_cut(self):
        """#3783: following metrics in on_start no longer defers every checkpoint; following or unfollowing once the run
        is ready (or on a back-filled bar) is a change a recovery's on_start would not repeat."""
        from engine import metrics
        cut = DAY + 7 * MINUTE_NS
        clock = mock.Mock(**{"timer_names.return_value": [], "timestamp_ns.return_value": DAY + 20 * MINUTE_NS})
        cases = {  # (ready, handing, metrics_after): (changed, the first row's stamp)
            "a first start": ((False, None, None), (False, DAY + 20 * MINUTE_NS)),
            "a recovery's start": ((False, None, cut), (False, DAY + 5 * MINUTE_NS)),
            "on a back-filled bar": ((False, ("bar",), None), (True, DAY + 20 * MINUTE_NS)),
            "a ready run": ((True, None, None), (True, DAY + 20 * MINUTE_NS)),
        }
        for name, ((ready, handing, after), expected) in cases.items():
            with self.subTest(name):
                source = object.__new__(paper._PaperConfigured)
                source._metrics_setup(None)
                source._paper_subscription_changes = False
                session = SimpleNamespace(ready=ready, handing=handing, metrics_after=lambda after=after: after)
                with mock.patch.object(paper._PaperConfigured, "_metrics_clock", return_value=clock), \
                        mock.patch.object(paper, "SESSION", session):
                    source._metrics_follow(str(IID))
                self.assertEqual((source._paper_subscription_changes, source._metrics_followed[str(IID)]["ts_event"]),
                                 expected)
        source._paper_subscription_changes = False
        clock.timer_names.return_value = [metrics.TIMER]
        with mock.patch.object(paper._PaperConfigured, "_metrics_clock", return_value=clock), \
                mock.patch.object(paper, "JOURNAL"):
            source._metrics_unfollow(str(IID))
        self.assertTrue(source._paper_subscription_changes, "a recovery's on_start would follow it again")

    def test_an_unsubscribe_of_metrics_the_source_followed_is_journalled(self):
        source = object.__new__(paper._PaperConfigured)
        source._metrics_followed = {str(IID): {}}
        clock = mock.Mock(**{"timer_names.return_value": ["runner-metrics"]})
        with mock.patch.object(paper._PaperConfigured, "_metrics_clock", return_value=clock), \
                mock.patch.object(paper, "JOURNAL") as journal:
            source._metrics_unfollow(str(IID))
            source._metrics_unfollow(str(IID))  # no longer followed: nothing to record
        self.assertEqual(journal.write.call_args_list, [mock.call("metrics_unsubscribed", instrument_id=str(IID))])
        self.assertEqual(source._metrics_followed, {})
        clock.cancel_timer.assert_called_with("runner-metrics")


class TradeSubscriptionTests(unittest.TestCase):
    def test_a_trade_or_unserved_metrics_subscription_stops_the_run(self):
        self.assertTrue(issubclass(paper._PaperConfigured, paper.strategy_runtime.Subscriptions))
        held = (paper.STOP, paper.STOP_REASON, paper.strategy_runtime.BREACHES)
        for value in held:
            self.addCleanup(value.clear)
        for code, subscription in (
                ("TRADES_NOT_SERVED", "R1-BTCUSDT: subscribe_trades BTCUSDT-PERP.BINANCE"),
                ("METRICS_NOT_SERVED",
                 "R1-BTCUSDT: subscribe_data Metrics for ETHUSDT-PERP.BINANCE, which this run does not stream")):
            for value in held:
                value.clear()
            recorder = paper.Recorder(paper.RecorderConfig([str(IID)], {}))
            with self.subTest(code=code), mock.patch.object(paper, "journal") as journal, \
                    mock.patch.object(recorder, "_protection"):
                recorder.on_stop_timer(None)
                self.assertFalse(paper.STOP.is_set())
                paper.strategy_runtime.BREACHES.append((code, subscription))
                recorder.on_stop_timer(None)
                self.assertEqual(paper.STOP_REASON, [code])
                journal.assert_called_once_with("refusal", code=code, subscriptions=[subscription])


class JournalFailureTests(unittest.TestCase):
    """A write the disk refuses stops the run without raising into a callback: the source still gets the event."""

    FULL = OSError(28, "No space left on device")

    def setUp(self):
        shown = mock.patch("builtins.print")
        self.shown = shown.start()
        self.addCleanup(shown.stop)

    @staticmethod
    def refusing(journal, **calls):
        """The journal's stream replaced by one whose given calls raise (the real one closed first)."""
        journal._stream.close()
        journal._stream = mock.Mock(close=mock.Mock(), **{name: mock.Mock(side_effect=error) for name, error in calls.items()})

    def journal(self, stops: list):
        import tempfile
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        journal = paper.Journal(Path(directory.name), on_failure=lambda: stops.append("stop"))
        self.addCleanup(journal.close)
        return journal

    def test_the_first_refused_line_latches_the_failure_stops_the_run_once_and_nothing_follows_it(self):
        stops: list = []
        journal = self.journal(stops)
        journal.write("bar")
        self.refusing(journal, write=self.FULL)
        journal.write("order")
        journal.write("position")
        self.assertEqual((stops, journal.failure), (["stop"], "OSError: [Errno 28] No space left on device"))
        journal._stream.write.assert_called_once()  # nothing is written after the gap
        self.shown.assert_called_once()
        with self.assertRaises(OSError):
            journal.sync()
        journal.state({"positions": []})  # skipped, not raised
        self.assertFalse((journal.output / "state.json").exists())

    def test_a_refused_flush_or_state_file_is_the_same_failure(self):
        for name in ("sync", "state"):
            with self.subTest(name):
                stops: list = []
                journal = self.journal(stops)
                if name == "sync":
                    self.refusing(journal, flush=self.FULL)
                    with self.assertRaises(OSError):
                        journal.sync()
                else:
                    with mock.patch.object(paper, "atomic", side_effect=self.FULL):
                        journal.state({})
                self.assertEqual((stops, journal.failure is not None), (["stop"], True))

    def test_a_source_still_gets_the_order_event_its_journal_line_could_not_be_written_for(self):
        stops: list = []
        journal = self.journal(stops)
        self.refusing(journal, write=self.FULL)
        seen: list = []

        class Source:
            def on_order_event(self, event):
                seen.append(event)

            def on_position_event(self, event):
                seen.append(event)

        instance = type("Journaled", (), {**paper.paper_callbacks(Source), "clock": None})()
        instance._paper_released_ns = 0
        event = type("OrderFilled", (), {"strategy_id": "R1-BTCUSDT", "client_order_id": "O-1", "ts_event": DAY})()
        with mock.patch.object(paper, "JOURNAL", journal), mock.patch.object(paper, "_event_fields", return_value={}):
            instance.on_order_event(event)
            instance.on_position_event(event)
        self.assertEqual(seen, [event, event])
        self.assertEqual(stops, ["stop"])

    def test_the_runs_own_disk_operations_latch_instead_of_raising_and_without_a_journal_they_raise(self):
        stops: list = []
        journal = self.journal(stops)

        def full():
            raise self.FULL
        with mock.patch.object(paper, "JOURNAL", journal):
            paper.disk(full)
        self.assertEqual(stops, ["stop"])
        with mock.patch.object(paper, "JOURNAL", None), self.assertRaises(OSError):
            paper.disk(full)

    def test_a_runner_whose_journal_failed_exits_with_the_status_the_seal_reads(self):
        args = SimpleNamespace(symbols=[], strategy_file=Path("s.py"), strategy_class="C", strategy_sha256="x")
        with mock.patch.dict("os.environ", {}, clear=True), mock.patch.object(paper, "parse", return_value=args), \
                mock.patch.object(paper, "_main", return_value=True), mock.patch.object(paper, "Signals"):
            raised = refused(paper.main, [], error=SystemExit)
        self.assertEqual(raised.code, paper.JOURNAL_FAILED_EXIT)
        with mock.patch.dict("os.environ", {}, clear=True), mock.patch.object(paper, "parse", return_value=args), \
                mock.patch.object(paper, "_main", return_value=False), mock.patch.object(paper, "Signals"):
            paper.main([])


class KlineEventTests(unittest.TestCase):
    """Binance's time for each closed kline (engine.kline_events) is journalled on the node's thread, each second
    before the checkpoint cut, so a cut's journal bytes hold every line written before it."""

    def test_the_timer_journals_the_closed_klines_before_it_cuts(self):
        self.addCleanup(paper.STOP.clear)
        recorder = paper.Recorder(paper.RecorderConfig([str(IID)], {}))
        calls = mock.Mock()
        klines = SimpleNamespace(drain=lambda: [(str(IID), 59_999_000_000, 60_005_000_000)],
                                 drain_states=lambda: [("up", 58_000_000_000, None),
                                                       ("down", 61_000_000_000, "silent")])
        session = SimpleNamespace(backend=SimpleNamespace(health=mock.Mock()), ready=True, held=False,
                                  try_cut=calls.try_cut)
        with mock.patch.object(paper, "KLINES", klines), mock.patch.object(paper, "SESSION", session), \
                mock.patch.object(paper, "JOURNAL", SimpleNamespace(write=calls.journal)), mock.patch.object(recorder, "_protection"), \
                mock.patch.object(paper.Recorder, "cache", new_callable=mock.PropertyMock):
            recorder.on_stop_timer(None)
        self.assertEqual(calls.mock_calls[:4], [
            mock.call.journal("kline_socket", state="up", at_ns=58_000_000_000),
            mock.call.journal("kline_socket", state="down", at_ns=61_000_000_000, reason="silent"),
            mock.call.journal("kline_event", instrument_id=str(IID), ts_event=59_999_000_000, event_ns=60_005_000_000),
            mock.call.try_cut(mock.ANY)])


class CacheLivenessTests(unittest.TestCase):
    """The native cache child is watched every second: a dead one ends the run with a reason, as a refused one."""

    def test_a_dead_cache_stops_the_run_with_its_own_reason_and_a_live_one_does_not(self):
        held = (paper.STOP, paper.STOP_REASON)
        for value in held:
            self.addCleanup(value.clear)
        recorder = paper.Recorder(paper.RecorderConfig([str(IID)], {}))
        health = mock.Mock()
        session = SimpleNamespace(backend=SimpleNamespace(health=health), ready=True, held=False, try_cut=mock.Mock())
        with mock.patch.object(paper, "SESSION", session), mock.patch.object(paper, "journal") as journal, \
                mock.patch.object(recorder, "_protection"), \
                mock.patch.object(paper.Recorder, "cache", new_callable=mock.PropertyMock):
            recorder.on_stop_timer(None)
            self.assertFalse(paper.STOP.is_set())
            session.try_cut.assert_called_once()
            health.side_effect = paper.CacheUnavailable("OSError: the native cache process exited with -9")
            recorder.on_stop_timer(None)
        self.assertEqual(paper.STOP_REASON, ["PAPER_CACHE_UNAVAILABLE"])
        journal.assert_called_once_with("refusal", code="PAPER_CACHE_UNAVAILABLE",
                                        reason="OSError: the native cache process exited with -9")

    def test_a_run_already_stopping_is_not_probed(self):
        self.addCleanup(paper.STOP.clear)
        self.addCleanup(paper.STOP_REASON.clear)
        paper.STOP.set()
        paper.STOP_REASON.append("STOP_FILE")
        recorder = paper.Recorder(paper.RecorderConfig([str(IID)], {}))
        health = mock.Mock(side_effect=paper.CacheUnavailable("gone"))
        session = SimpleNamespace(backend=SimpleNamespace(health=health), ready=True, supported=False, saved=None,
                                  held=False, holding=False)
        with mock.patch.object(paper, "SESSION", session), mock.patch.object(paper, "journal") as journal, \
                mock.patch.object(recorder, "_protection"), \
                mock.patch.object(paper.Recorder, "cache", new_callable=mock.PropertyMock,
                                  return_value=SimpleNamespace(orders_open=list, positions_open=list)):
            recorder.on_stop_timer(None)
        health.assert_not_called()
        self.assertEqual(paper.STOP_REASON, ["STOP_FILE"])
        self.assertEqual([call.args[0] for call in journal.call_args_list], ["stop_requested"])


class PauseTests(unittest.TestCase):
    """A pause and a refused recovery leave the working orders as they are (docs/plans/
    paper-recovery-open-orders-20261117.zh.md); a pause first waits for the orders in flight."""

    def setUp(self):
        for value in (paper.STOP, paper.STOP_REASON):
            self.addCleanup(value.clear)
        self.recorder = paper.Recorder(paper.RecorderConfig([str(IID)], {}))
        self.recorder.handle = mock.Mock()
        self.source = mock.Mock(_paper_held=[])
        self.orders: list = []
        self.positions: list = []
        self.cancel = mock.Mock()
        for patcher in (mock.patch.object(self.recorder, "_protection"),
                        mock.patch.object(paper.OrderRules, "cancel_all_orders", self.cancel),
                        mock.patch.dict(paper.strategy_runtime.STRATEGIES, {str(IID): self.source}, clear=True),
                        mock.patch.object(paper.Recorder, "cache", new_callable=mock.PropertyMock,
                                          return_value=SimpleNamespace(orders=lambda: list(self.orders),
                                                                       orders_open=lambda: list(self.orders),
                                                                       positions_open=lambda: list(self.positions))),
                        mock.patch.object(paper.checkpoint, "dirty")):
            patcher.start()
            self.addCleanup(patcher.stop)

    @staticmethod
    def working(status: str, kind: str = "STOP_MARKET"):
        return SimpleNamespace(is_closed=False, status=getattr(OrderStatus, status), client_order_id="O-1",
                               order_type=getattr(OrderType, kind), trigger_type=TriggerType.DEFAULT)

    def test_a_refused_recovery_journals_why_and_stops_without_cancelling_the_restored_orders(self):
        self.orders.append(self.working("ACCEPTED"))
        reason = "O-1 (SELL STOP_MARKET at 99000.0) was touched in the interruption"
        session = SimpleNamespace(backend=SimpleNamespace(health=mock.Mock(), output=Path("out")), ready=False,
                                  refused=reason, restore_deadline=float("inf"), supported=True, held=False,
                                  saved={"sources": {}}, before_stop=mock.Mock(), try_cut=mock.Mock())
        handle = self.recorder.handle
        with mock.patch.object(paper, "SESSION", session), mock.patch.object(paper, "journal") as journal:
            self.recorder.on_stop_timer(None)
            self.recorder.on_stop_timer(None)
        self.assertEqual(paper.STOP_REASON, ["PAPER_RECOVERY_UNAVAILABLE"])
        self.assertEqual(journal.call_args_list[0], mock.call("refusal", code="PAPER_RECOVERY_UNAVAILABLE",
                                                              reason=reason))
        self.cancel.assert_not_called()
        handle.stop.assert_called_once()
        session.try_cut.assert_not_called()

    def test_a_recovery_refused_at_its_deadline_stays_refused_for_a_start_that_completes_later(self):
        """A holder's read or a warm-up that ends after the deadline must not start anything: the run is already
        stopping as a pause, and a late start would cancel the restored entries (Session.maybe_begin)."""
        session = SimpleNamespace(backend=SimpleNamespace(health=mock.Mock(), output=Path("out")), ready=False,
                                  refused=None, restore_deadline=0.0, supported=False, held=True,
                                  saved={"sources": {}}, before_stop=mock.Mock(), try_cut=mock.Mock())
        with mock.patch.object(paper, "SESSION", session), mock.patch.object(paper, "journal"):
            self.recorder.on_stop_timer(None)
        self.assertEqual(session.refused, "native initialization did not complete")
        self.assertEqual(paper.STOP_REASON, ["PAPER_RECOVERY_UNAVAILABLE"])

    def test_a_pause_waits_for_the_orders_in_flight_then_stops_without_cancelling(self):
        self.orders.extend([self.working("ACCEPTED"), self.working("SUBMITTED")])
        session = SimpleNamespace(backend=SimpleNamespace(health=mock.Mock()), ready=True, refused=None, held=False,
                                  supported=True, saved=None, before_stop=mock.Mock(), try_cut=mock.Mock(),
                                  due=mock.Mock(return_value=None))
        handle = self.recorder.handle
        with mock.patch.object(paper, "SESSION", session), mock.patch.object(paper, "journal"):
            paper.request_stop("SIGTERM")
            self.recorder.on_stop_timer(None)
            self.recorder.on_stop_timer(None)
            handle.stop.assert_not_called()
            self.orders[1] = self.working("ACCEPTED")  # the venue answered
            self.recorder.on_stop_timer(None)
        session.before_stop.assert_called_once()
        handle.stop.assert_called_once()
        self.cancel.assert_not_called()

    def test_a_pause_waits_for_a_declared_aggregations_bar_due_now(self):
        """The final cut cannot be published while a bucket ended and its bar has not reached the source
        (engine.paper_session.Session.due): the pause waits for it, within STOP_CANCEL_SECONDS."""
        due = mock.Mock(side_effect=["the 15-MINUTE bar of the bucket ending at 12:15 has not reached the source",
                                     None])
        session = SimpleNamespace(backend=SimpleNamespace(health=mock.Mock()), ready=True, refused=None, held=False,
                                  supported=True, saved=None, before_stop=mock.Mock(), try_cut=mock.Mock(), due=due)
        handle = self.recorder.handle
        with mock.patch.object(paper, "SESSION", session), mock.patch.object(paper, "journal"):
            paper.request_stop("SIGTERM")
            self.recorder.on_stop_timer(None)
            self.recorder.on_stop_timer(None)
            handle.stop.assert_not_called()
            self.recorder.on_stop_timer(None)
        handle.stop.assert_called_once()
        self.cancel.assert_not_called()

    def test_an_order_a_back_filled_bar_cannot_wait_for_is_not_sent(self):
        """engine.paper_session.Session.submitted refused the recovery: the order never reaches the venue."""
        source = SimpleNamespace(_paper_membership=SimpleNamespace(member_at=lambda _: True))
        session = SimpleNamespace(submitted=mock.Mock(return_value="O-1 is a MARKET order"))
        found = SimpleNamespace(is_reduce_only=False)
        with mock.patch.object(paper, "SESSION", session):
            self.assertIsNone(paper._PaperConfigured.submit_order(source, found))  # type: ignore[arg-type]
        session.submitted.assert_called_once_with(found)
        # Nor does a cancel or a position close the session refuses.
        session = SimpleNamespace(commanded=mock.Mock(return_value="refused"))
        with mock.patch.object(paper, "SESSION", session):
            for name, args in (("cancel_order", ("O-1",)), ("cancel_orders", (["O-1"],)),
                               ("cancel_all_orders", (IID,)), ("close_position", (object(),))):
                self.assertIsNone(getattr(paper._PaperConfigured, name)(source, *args), name)
        self.assertEqual(session.commanded.call_args_list[-1], mock.call(close=True))
        self.assertEqual(session.commanded.call_count, 4)

    def test_an_entry_waiting_when_the_recovery_is_refused_is_not_sent(self):
        """Once the recovery is refused nothing more is sent (engine.paper_session.Session.submitted): the tick that
        journals the refusal sends no entry whose terms read is done either."""
        for why in ("an order cannot wait for T", None):
            with self.subTest(why):
                paper.STOP.clear()
                session = SimpleNamespace(backend=mock.Mock(), ready=not why, refused=why, held=False,
                                          supported=True, holding=False, saved={"sources": {}}, callback=nullcontext, try_cut=mock.Mock())
                send = mock.Mock()
                entry = paper.paper_terms.Entry(str(IID), SimpleNamespace(client_order_id="O-1"), send, mock.Mock(),
                                                changed=[])
                entry.thread = SimpleNamespace(is_alive=lambda: False)  # type: ignore[assignment]
                with mock.patch.object(paper, "SESSION", session), mock.patch.object(paper, "journal") as journal, \
                        mock.patch.object(paper.paper_terms, "QUEUE", [entry]), \
                        mock.patch.object(paper.checkpoint, "dirty"):
                    self.recorder.on_stop_timer(None)
                kinds = [call.args[0] for call in journal.call_args_list]
                if why:
                    send.assert_not_called()
                    self.assertEqual(kinds, ["entry_not_sent", "refusal", "stop_requested"])
                else:
                    send.assert_called_once_with()
                    self.assertEqual(kinds, [])

    def test_a_stop_cancels_past_the_gate_on_the_sources_commands(self):
        """A STOP that comes before a refused back-fill's refusal is journalled still cancels: the runner's cancel is
        not the source's (engine.paper_session.Session.commanded)."""
        self.orders.append(self.working("ACCEPTED"))
        paper.STOP.set()
        paper.STOP_REASON[:] = ["STOP_FILE"]
        session = SimpleNamespace(ready=True, supported=True, held=False, saved={"sources": {}},
                                  refused="an order cannot wait for T",
                                  commanded=mock.Mock(return_value="an order cannot wait for T"))
        with mock.patch.object(paper, "SESSION", session), mock.patch.object(paper, "journal"):
            self.recorder.on_stop_timer(None)
        self.cancel.assert_called_once_with(self.source, IID)
        session.commanded.assert_not_called()

    def test_a_held_runs_stop_cancels_through_its_holder(self):
        """A holder is the runner's own strategy, not an OrderRules source: the stop cancels through it (the
        unbound OrderRules.cancel_all_orders refuses an instance outside its class)."""
        holder = mock.Mock(spec=paper.Holder)
        self.orders.append(self.working("ACCEPTED"))
        paper.STOP.set()
        paper.STOP_REASON[:] = ["HELD_FLAT"]
        session = SimpleNamespace(ready=True, supported=False, held=True, holding=False, saved={"sources": {}},
                                  refused=None)
        with mock.patch.dict(paper.strategy_runtime.STRATEGIES, {str(IID): holder}, clear=True), \
                mock.patch.object(paper, "SESSION", session), mock.patch.object(paper, "journal"):
            self.recorder.on_stop_timer(None)
        holder.cancel_all_orders.assert_called_once_with(IID)
        self.cancel.assert_not_called()

    def test_an_explicit_stop_of_an_unstarted_recovery_still_cancels(self):
        session = SimpleNamespace(ready=False, supported=True, saved={"sources": {}})
        with mock.patch.object(paper, "SESSION", session):
            for reason, pausing in (("STOP_FILE", False), ("DURATION", False), ("WARMUP_TIMEOUT", True),
                                    ("SIGTERM", True)):
                paper.STOP_REASON[:] = [reason]
                self.assertEqual(paper.pausing(), pausing, reason)

    def stop(self, session, reason: str = "SIGTERM") -> None:
        with mock.patch.object(paper, "SESSION", session), mock.patch.object(paper, "journal"):
            paper.request_stop(reason)
            self.recorder.on_stop_timer(None)
            self.recorder.on_stop_timer(None)

    @staticmethod
    def unprotocolled(**fields):
        return SimpleNamespace(**{"backend": SimpleNamespace(health=mock.Mock()), "ready": True, "refused": None,
                                  "held": False, "holding": False, "supported": False, "saved": None,
                                  "before_stop": mock.Mock(), "try_cut": mock.Mock(),
                                  "due": mock.Mock(return_value=None), **fields})

    def test_a_source_without_the_protocol_pauses_on_sigterm_only_while_it_holds_a_position(self):
        """It is then held after the interruption (engine.paper_session): its stops and targets must not be
        canceled. A flat one cancels its entries and ends as before, so no ACCEPTED entry is left in its seal."""
        # A trailing stop is one a checkpoint cannot hold: that run cancels and ends as before.
        for positions, kind, paused in ((["P-1"], "STOP_MARKET", True), ([], "LIMIT", False),
                                        (["P-1"], "TRAILING_STOP_MARKET", False)):
            with self.subTest(positions=positions, kind=kind):
                paper.STOP.clear()
                paper.STOP_REASON.clear()
                self.recorder.stopping_since, self.recorder.handle = None, mock.Mock()
                self.cancel.reset_mock()
                self.orders[:] = [self.working("ACCEPTED", kind)]
                self.positions[:] = positions
                session, handle = self.unprotocolled(), self.recorder.handle
                self.stop(session)
                self.assertEqual(session.holding, paused)
                self.assertEqual(self.cancel.called, not paused)
                self.assertEqual(session.before_stop.called, paused)
                self.assertEqual(handle.stop.called, paused, "a cancel waits for its answers before the stop")
        for reason in ("STOP_FILE", "DURATION"):
            with self.subTest(reason=reason), mock.patch.object(paper, "SESSION", self.unprotocolled(holding=True)):
                paper.STOP_REASON[:] = [reason]
                self.assertFalse(paper.pausing(), "the user's stop and the duration cancel")

    def test_a_held_pause_whose_last_position_closes_while_it_waits_cancels_what_is_left(self):
        """Its cut needs an open position, so it would end with the entry and the target still working: once flat it
        cancels them and stops as a flat stop does, publishing no checkpoint."""
        self.orders[:] = [self.working("ACCEPTED", "LIMIT"), self.working("SUBMITTED")]
        self.positions[:] = ["P-1"]
        session = self.unprotocolled()
        handle = self.recorder.handle
        self.stop(session)
        self.assertTrue(session.holding)
        self.cancel.assert_not_called()
        self.positions.clear()  # the stop filled while the pause waited for the order in flight
        with mock.patch.object(paper, "SESSION", session), mock.patch.object(paper, "journal"):
            self.recorder.on_stop_timer(None)
            self.assertFalse(session.holding)
            self.assertFalse(paper.pausing())
            self.cancel.assert_called_once_with(self.source, IID)
            self.recorder.on_stop_timer(None)
            handle.stop.assert_not_called()  # the cancels have not been answered
            self.orders.clear()
            self.recorder.on_stop_timer(None)
        handle.stop.assert_called_once()
        session.before_stop.assert_not_called()

    def test_a_held_run_ends_once_flat_and_cancels_what_is_left(self):
        session = self.unprotocolled(held=True, saved={"sources": {}})
        self.positions[:] = ["P-1"]
        with mock.patch.object(paper, "SESSION", session), mock.patch.object(paper, "journal"):
            self.recorder.on_stop_timer(None)
            self.assertFalse(paper.STOP.is_set())
            session.try_cut.assert_called_once()
            self.positions.clear()
            self.recorder.on_stop_timer(None)
            self.assertEqual(paper.STOP_REASON, ["HELD_FLAT"])
            handle = self.recorder.handle
            self.recorder.on_stop_timer(None)
            self.recorder.on_stop_timer(None)
        self.cancel.assert_called_once_with(self.source, IID)
        session.before_stop.assert_not_called()
        handle.stop.assert_called_once()
        # Another SIGTERM while held pauses it again.
        paper.STOP.clear()
        paper.STOP_REASON.clear()
        self.recorder.stopping_since, self.recorder.handle = None, mock.Mock()
        self.cancel.reset_mock()
        self.positions[:] = ["P-1"]
        self.stop(session)
        self.cancel.assert_not_called()
        session.before_stop.assert_called_once()


class HolderTests(unittest.TestCase):
    """A held start builds no source: a holder per contract under the source's strategy ID reads the interruption,
    joins the start barrier and withdraws the entries it inherits, leaving every reduce-only order working."""

    def setUp(self):
        self.addCleanup(paper.strategy_runtime.STRATEGIES.clear)
        self.inputs = paper.PaperInputs(str(IID), DAY, DAY, "R1-BTCUSDT", None, DAY)  # type: ignore[arg-type]
        self.orders: list = []
        self.clock = mock.Mock(timestamp_ns=mock.Mock(return_value=DAY))
        instrument = SimpleNamespace(price_precision=1, size_precision=3)
        cache = SimpleNamespace(orders_open=lambda: list(self.orders), instrument=lambda _: instrument)
        for patcher in (mock.patch.object(paper.Holder, "cache", new_callable=mock.PropertyMock, return_value=cache,
                                          create=True),
                        mock.patch.object(paper.Holder, "clock", new_callable=mock.PropertyMock,
                                          return_value=self.clock, create=True),
                        mock.patch.object(paper.checkpoint, "dirty")):
            patcher.start()
            self.addCleanup(patcher.stop)

    def session(self, working: set):
        return SimpleNamespace(working=working, warm_at=DAY, start=mock.Mock(), read_downtime=mock.Mock(),
                               callback=paper.nullcontext, backend=SimpleNamespace(output=Path("out")))

    def test_a_holder_takes_the_sources_identity_and_registers_for_the_stop(self):
        holder = paper.Holder(self.inputs, "http://proxy")
        self.assertEqual(str(holder.strategy_id), "R1-BTCUSDT")
        self.assertEqual(holder.config.oms_type, paper.OmsType.HEDGING)
        self.assertIs(paper.strategy_runtime.STRATEGIES[str(IID)], holder)
        self.assertEqual(holder._paper_held, [])

    def test_a_contract_with_restored_orders_reads_the_interruption_at_t_before_it_joins_the_start(self):
        holder = paper.Holder(self.inputs, "http://proxy")
        session = self.session({str(IID)})
        with mock.patch.object(paper, "SESSION", session):
            holder.on_start()
            self.clock.set_time_alert_ns.assert_called_once_with("held-read", DAY + paper.history.SETTLE_NS,
                                                                 holder._held_read)
            holder._held_read()
            holder._paper_reader.join(5)
            holder._held_wait()
        session.read_downtime.assert_called_once_with(str(IID), DAY, (1, 3), "http://proxy")
        self.clock.cancel_timer.assert_called_once_with("held-read-wait")
        session.start.assert_called_once_with(holder._held_begin)
        other = self.session(set())
        with mock.patch.object(paper, "SESSION", other):
            holder.on_start()
        other.start.assert_called_once_with(holder._held_begin)
        other.read_downtime.assert_not_called()

    def test_the_held_start_withdraws_the_inherited_entries_of_its_contract_only(self):
        holder = paper.Holder(self.inputs)
        holder.cancel_order = mock.Mock()
        self.orders[:] = [SimpleNamespace(instrument_id=IID, is_reduce_only=False, client_order_id="entry"),
                          SimpleNamespace(instrument_id=IID, is_reduce_only=True, client_order_id="stop"),
                          SimpleNamespace(instrument_id="ETHUSDT-PERP.BINANCE", is_reduce_only=False,
                                          client_order_id="other")]
        holder._held_begin()
        holder.cancel_order.assert_called_once_with("entry")


class InterruptionReadTests(unittest.TestCase):
    def test_a_recovery_reads_the_interruption_on_the_warm_up_reader_even_without_a_warm_up_request(self):
        from engine import history, order_rules
        self.addCleanup(history.clear)
        self.addCleanup(order_rules.WARMING.discard, "R1-BTCUSDT")
        self.addCleanup(order_rules.CONTRACTS.pop, "R1-BTCUSDT", None)
        at = DAY + 10 * MINUTE_NS
        fetch = mock.Mock(return_value=([], [], []))
        source = history.Warming()
        history.Warming._warming_setup(source, "R1-BTCUSDT", IID, at, (), 0, fetch, reads=True)
        state = history.STATES["R1-BTCUSDT"]
        clock = mock.Mock(timestamp_ns=mock.Mock(return_value=at - MINUTE_NS))
        source._warming_state, source._warming_clock = (lambda: state), (lambda: clock)  # type: ignore[method-assign]
        source._warming_request = mock.Mock()  # type: ignore[method-assign]
        source.on_start()
        clock.set_time_alert_ns.assert_called_once_with("runner-warmup", at + history.SETTLE_NS, source._warming_go)
        instrument = SimpleNamespace(price_precision=1, size_precision=3)
        cache = SimpleNamespace(__get__=lambda *_: SimpleNamespace(instrument=lambda _: instrument))
        with mock.patch.object(history, "Strategy", SimpleNamespace(cache=cache)):
            source._warming_go()
        state["thread"].join(5)
        fetch.assert_called_once_with(IID, at, (), (1, 3), funding=0, follow=False, since={})

        # Only a contract holding a restored working order reads them (engine.paper.build_node sets `working`).
        for working, reads in ((set(), False), ({str(IID)}, True)):
            session = SimpleNamespace(saved={"sources": {}}, working=working, read_downtime=mock.Mock())
            with mock.patch.object(paper.history, "fetch", return_value=([], [], [])) as read:
                paper.fetch_at(IID, at, (), (1, 3), catalog=Path("c"), proxy_url="http://proxy", session=session,
                               funding=0, follow=False)
            read.assert_called_once_with(IID, at, (), (1, 3), Path("c"), "http://proxy", funding=0, follow=False)
            self.assertEqual(session.read_downtime.call_args_list,
                             [mock.call(IID, at, (1, 3), "http://proxy")] if reads else [])


class CredentialTests(unittest.TestCase):
    def test_credential_names_are_found_by_name(self):
        environ = {"BINANCE_API_KEY": "x", "OKX_SECRET": "x", "MY_API_SECRET": "x", "PATH": "/bin", "HOME": "/h"}
        self.assertEqual(paper.credential_names(environ), ["BINANCE_API_KEY", "MY_API_SECRET", "OKX_SECRET"])

    def test_the_runner_refuses_to_start_with_a_credential_in_its_environment(self):
        with mock.patch.dict("os.environ", {"BINANCE_API_SECRET": "never-read"}), \
                mock.patch.object(paper, "parse", side_effect=AssertionError("parsed")):
            raised = refused(paper.main, [], error=Refusal)
        self.assertEqual(raised.code, "PAPER_CREDENTIALS_PRESENT")
        self.assertNotIn("never-read", str(raised))


class Reassigned(paper.Strategy):
    """Text and runtime disagree: the first assignment is 0, the one Python keeps is 1."""
    PAPER_RECOVERY = 0
    PAPER_RECOVERY = 1  # noqa: PIE794

    def on_save(self):
        return {}

    def on_load(self, state):
        pass


class StartedTests(unittest.TestCase):
    def test_a_new_run_journals_its_runners_protocol_verdict_on_the_started_line(self):
        """The page and paper compare read `recovery_declared` from the `started` line (user 2026-11-18): the runner's
        own verdict (engine.paper_session.declares_recovery), not the source text."""
        for cls, expected in ((Reassigned, True), (paper.Strategy, False)):
            with self.subTest(cls=cls.__name__), tempfile.TemporaryDirectory() as name:
                root = Path(name)
                (root / "terms.json").write_text("{}")
                args = SimpleNamespace(symbols=["BTCUSDT"], output=root, strategy_file=root / "strategy.py",
                                       strategy_class=cls.__name__, strategy_sha256="x", universe=root / "u.json",
                                       terms=root / "terms.json", proxy_url=None)
                written = mock.Mock(failure=None)
                with mock.patch.object(paper, "JOURNAL", None), mock.patch.object(paper, "SESSION", None), \
                        mock.patch.object(paper, "load_strategy", return_value=SimpleNamespace(strategy_class=cls)), \
                        mock.patch.object(paper, "read_universe"), \
                        mock.patch.object(paper, "strategy_metadata", return_value={"strategy_entry_class": "S"}), \
                        mock.patch.object(paper, "Journal", return_value=written), \
                        mock.patch.object(paper, "plan", side_effect=StopIteration), \
                        self.assertRaises(StopIteration):
                    paper._main(args)
                started = next(call for call in written.write.call_args_list if call.args[0] == "started")
                self.assertIs(started.kwargs["recovery_declared"], expected)
                self.assertEqual(started.kwargs["strategy_entry_class"], "S")


class LoadRefusalTests(unittest.TestCase):
    def refused(self, root: Path, declared: bytes = b"import os\n") -> Refusal:
        source = b"import os\n"
        (root / "strategy.py").write_bytes(source)
        args = SimpleNamespace(symbols=["BTCUSDT"], output=root / "out", strategy_file=root / "strategy.py",
                               strategy_class="S", strategy_sha256=hashlib.sha256(declared).hexdigest())
        with mock.patch.object(paper, "JOURNAL", None):
            return refused(paper._main, args, error=Refusal)

    def test_a_source_refused_at_load_is_journaled_and_seals_complete_with_its_code(self):
        with tempfile.TemporaryDirectory() as name:
            root = Path(name)
            self.assertEqual(self.refused(root).code, "SOURCE_REACH")
            journal = root / "out" / "events.jsonl"
            lines, _ = run_journal.journal_lines(journal.read_bytes() if journal.is_file() else b"")
        row = {"paper_id": 1, "source_sha256": "a" * 64, "config": {}}
        found = run_journal.readings(row, lines, 0, None, 2, None)
        self.assertEqual((found["status"], found["reasons"]),
                         ("complete", ["REFUSED:SOURCE_REACH", "RUNNER_EXIT_NONZERO", "SUMMARY_MISSING"]))
        self.assertEqual([line["kind"] for line in lines], ["refusal"])
        self.assertIn("import os", lines[0]["reason"])

    def test_bytes_that_are_not_the_declared_source_leave_no_journal(self):
        with tempfile.TemporaryDirectory() as name:
            self.assertEqual(self.refused(Path(name), declared=b"other").code, "CONTENT_HASH_MISMATCH")
            self.assertFalse((Path(name) / "out" / "events.jsonl").exists())

    def test_a_resumed_runs_journal_stays_as_its_checkpoint_binds_it(self):
        with tempfile.TemporaryDirectory() as name:
            journal = Path(name) / "out" / "events.jsonl"
            journal.parent.mkdir()
            journal.write_bytes(b'{"kind": "started", "wall_ns": 1}\n')
            self.refused(Path(name))
            self.assertEqual(journal.read_bytes(), b'{"kind": "started", "wall_ns": 1}\n')


class SnapshotTests(unittest.TestCase):
    def test_a_minutes_snapshot_values_its_positions_at_that_minutes_last_mark(self):
        """The first mark of the next minute triggers the snapshot; the minute is valued at the mark before it, as a
        replay values the minute at its MARK bar's close (audit runs 52 to 54: 0.004 BTC at 63,813.67, the next
        minute's first mark, instead of 63,819.52, the minute's last)."""
        recorder = paper.Recorder(paper.RecorderConfig([str(IID)], {}))
        position = SimpleNamespace(id="P-1", instrument_id=IID, signed_qty=Decimal(2), avg_px_open=Decimal(100),
                                   realized_pnl="0 USDT",
                                   unrealized_pnl=lambda price: f"{(price.as_decimal() - 100) * 2} USDT")
        cache = SimpleNamespace(account_for_venue=lambda venue: None, positions_open=lambda: [position],
                                orders_open=list)
        with mock.patch.object(paper.Recorder, "cache", new_callable=mock.PropertyMock, return_value=cache), \
                mock.patch.object(paper, "journal") as journal:
            for at, price in ((DAY, "100.0"), (DAY + 59 * 10**9, "101.0"), (DAY + MINUTE_NS, "105.0")):
                recorder.on_mark_price(MarkPriceUpdate(IID, Price.from_str(price), at, at))
        snapshots = [call.kwargs for call in journal.call_args_list if call.args[0] == "snapshot"]
        self.assertEqual([(item["minute_ns"], item["unrealized_pnl"]) for item in snapshots], [(DAY, "2.00000000")])


class CadenceTests(unittest.TestCase):
    def test_the_strategy_gets_the_first_mark_of_each_minute(self):
        cadence = Cadence()
        stamps = [DAY + 1_000_000, DAY + 2_000_000_000, DAY + MINUTE_NS, DAY + MINUTE_NS + 5, DAY + 3 * MINUTE_NS]
        self.assertEqual([cadence.mark(mark(ts)) for ts in stamps], [True, False, True, False, True])

    def test_each_contract_an_instance_follows_has_its_own_cadence(self):
        """#3657: one cadence passed the first contract's MARK of a minute and its settlement, and dropped the others'."""
        other = InstrumentId.from_str("ETHUSDT-PERP.BINANCE")
        settlement, following = DAY + 8 * 3600 * 10**9, DAY + 16 * 3600 * 10**9
        instance, passed, skipped = SimpleNamespace(cadences={}), [], []

        def callback(name):
            return Cadence.wrap(name, "cadences", lambda _, update, __: passed.append(update.instrument_id),
                                skipped.append)
        for at in (DAY, DAY + 1):  # both contracts' first MARK of the minute, then a second one
            for iid in (IID, other):
                callback("on_mark_price")(instance, MarkPriceUpdate(iid, Price.from_str("100.0"), at, at))
        self.assertEqual((passed, len(skipped)), ([IID, other], 2))
        passed.clear()
        for at, named in ((DAY + 2, settlement), (settlement + 3, following)):
            for iid in (IID, other):
                callback("on_funding_rate")(instance, FundingRateUpdate(iid, Decimal("0.0001"), at, at, None, named))
        self.assertEqual(passed, [IID, other])

    def test_one_funding_update_per_settlement_stamped_at_the_settlement(self):
        cadence = Cadence()
        settlement, following = DAY + 8 * 3600 * 10**9, DAY + 16 * 3600 * 10**9
        self.assertIsNone(cadence.funding(estimate(DAY + 1, settlement)))
        self.assertIsNone(cadence.funding(estimate(DAY + 2, settlement)))
        settled = cadence.funding(estimate(settlement + 3, following, "0.0002"))
        self.assertIsNone(cadence.funding(estimate(settlement + 4, following)))
        assert settled is not None
        self.assertEqual((settled.ts_event, settled.ts_init, settled.next_funding_ns, settled.rate),
                         (settlement, settlement + 3, settlement, Decimal("0.0002")))

    def test_a_settlement_binance_moves_later_before_it_is_due_is_not_one(self):
        """Binance lengthens a funding interval (1 to 4 hours for HOTUSDT after 2026-11-12 20:00, its funding info
        updated at 20:01): an estimate naming 21:00, the old interval's next, followed before 21:00 by ones naming
        00:00 is no settlement at 21:00, and the replay streams none; the next is 00:00's."""
        hour = 3600 * 10**9
        cadence = Cadence()
        self.assertIsNone(cadence.funding(estimate(DAY + 19 * hour + 5, DAY + 20 * hour)))
        settled = cadence.funding(estimate(DAY + 20 * hour + 3, DAY + 21 * hour))
        assert settled is not None
        self.assertEqual(settled.ts_event, DAY + 20 * hour)
        self.assertIsNone(cadence.funding(estimate(DAY + 20 * hour + MINUTE_NS, DAY + 24 * hour)))
        self.assertIsNone(cadence.funding(estimate(DAY + 23 * hour, DAY + 24 * hour)))
        settled = cadence.funding(estimate(DAY + 24 * hour + 4, DAY + 28 * hour))
        assert settled is not None
        self.assertEqual(settled.ts_event, DAY + 24 * hour)


class PlanTests(unittest.TestCase):
    def test_instances_keep_membership_from_the_input_start_and_a_non_member_is_refused(self):
        membership = {"BTCUSDT": [[DAY - DAY_NS, DAY + 2 * DAY_NS]], "ETHUSDT": [[DAY - 3 * DAY_NS, DAY - DAY_NS]]}
        with mock.patch.object(membership_months, "episode_membership", side_effect=lambda intervals, _: intervals):
            planned = paper.plan(["BTCUSDT"], membership, DAY, DAY)
            self.assertEqual(list(planned[0].universe_membership), [(DAY, DAY + 2 * DAY_NS)])
            self.assertEqual((planned[0].instrument_id, planned[0].trade_start_ns), ("BTCUSDT-PERP.BINANCE", DAY))
            raised = refused(paper.plan, ["ETHUSDT"], membership, DAY, DAY, error=Refusal)
        self.assertEqual(raised.code, "PAPER_NOT_IN_UNIVERSE")


class OrderFilled:
    """The attributes of a Nautilus fill the journal reads (a stand-in: the class name is what it records)."""
    instrument_id = IID
    client_order_id = "O-1"
    order_side = "BUY"
    order_type = "STOP_MARKET"
    last_px = Price.from_str("100.5")
    last_qty = Decimal("0.010")
    reduce_only = True
    linked_order_ids = ("O-2", "O-3")
    trigger_price = None
    ts_event = DAY


class EventFieldTests(unittest.TestCase):
    def test_an_event_keeps_its_side_price_quantity_and_ids_as_fields(self):
        found = paper._event_fields(OrderFilled())
        self.assertEqual({key: found[key] for key in ("type", "instrument_id", "client_order_id", "order_side",
                                                      "order_type", "last_px", "last_qty", "reduce_only",
                                                      "linked_order_ids", "ts_event")},
                         {"type": "OrderFilled", "instrument_id": str(IID), "client_order_id": "O-1",
                          "order_side": "BUY", "order_type": "STOP_MARKET", "last_px": "100.5", "last_qty": "0.010",
                          "reduce_only": True, "linked_order_ids": ["O-2", "O-3"], "ts_event": DAY})
        self.assertNotIn("trigger_price", found)


class TermsTests(unittest.TestCase):
    MARKET = {"price_increment": "0.10", "size_increment": "0.001", "min_notional": "50"}

    def check(self, **changes):
        from nautilus_trader.model import Currency, Money, Quantity
        loaded = {"price_increment": Price.from_str("0.10"), "size_increment": Quantity.from_str("0.001"),
                  "min_notional": Money(50, Currency.from_str("USDT")), "margin_init": Decimal("0.1"),
                  "margin_maint": Decimal("0.1"), **changes}
        recorder = paper.Recorder(paper.RecorderConfig([str(IID)], {str(IID): self.MARKET}))
        self.addCleanup(paper.STOP.clear)
        self.addCleanup(paper.STOP_REASON.clear)
        cache = SimpleNamespace(instrument=lambda iid: SimpleNamespace(**loaded))
        with mock.patch.object(paper.Recorder, "cache", new_callable=mock.PropertyMock, return_value=cache), \
                mock.patch.object(paper, "journal") as journal:
            recorder._check_terms()
        return journal

    def test_the_markets_terms_and_the_loader_rates_pass(self):
        journal = self.check()
        self.assertEqual(paper.STOP_REASON, [])
        journal.assert_not_called()

    def test_another_tick_or_margin_rate_stops_the_run_with_both_values(self):
        for changes, text in (({"price_increment": Price.from_str("0.01")}, "price_increment: market 0.10, exchange 0.01"),
                              ({"margin_init": Decimal("0.05")}, "margin_init: 0.05, leverage set from 0.1")):
            with self.subTest(text=text):
                journal = self.check(**changes)
                self.assertEqual(paper.STOP_REASON, ["TERMS_CHANGED"])
                journal.assert_called_once_with("refusal", code="TERMS_CHANGED", instrument_id=str(IID), changed=[text])
                paper.STOP.clear()
                paper.STOP_REASON.clear()


class EntryTermsTests(unittest.TestCase):
    """Binance changes a contract's tick mid-run (C-172): Live refuses the next entry (tests/live_loopback/test_terms.py),
    and Paper reads Binance's terms for each entry the same way, off the node's thread; reduce-only orders go out
    unread."""

    MARKET = {"price_increment": "0.10", "size_increment": "0.001", "min_notional": "50"}

    def setUp(self):
        for value in (paper.STOP, paper.STOP_REASON, paper.paper_terms.QUEUE):
            self.addCleanup(value.clear)
        self.sent = mock.Mock(return_value=None)
        self.journal = mock.Mock()
        for patcher in (mock.patch.object(paper.OrderRules, "submit_order", self.sent),
                        mock.patch.object(paper, "SESSION", None), mock.patch.object(paper, "journal", self.journal),
                        mock.patch.object(paper, "denied_exiting", lambda *_: False),
                        mock.patch.object(paper.paper_terms, "violation", lambda *_: None),
                        mock.patch("time.sleep")):
            patcher.start()
            self.addCleanup(patcher.stop)

    @staticmethod
    def exchange(tick: str, **contract: str) -> dict:
        """fapi/v1/exchangeInfo as Binance answers it, the contract's filters and `contract` fields among others."""
        return {"symbols": [
            {"symbol": "ETHUSDT", "filters": []},
            {"symbol": "BTCUSDT", "status": "TRADING", "contractType": "PERPETUAL", "marginAsset": "USDT", **contract,
             "filters": [
                {"filterType": "PRICE_FILTER", "tickSize": tick, "minPrice": "556.80", "maxPrice": "4529764"},
                {"filterType": "LOT_SIZE", "stepSize": "0.001", "minQty": "0.001", "maxQty": "1000"},
                {"filterType": "MIN_NOTIONAL", "notional": "50"}]}]}

    def source(self):
        source = object.__new__(paper._PaperConfigured)
        source._paper_membership = SimpleNamespace(member_at=lambda _: True)
        source._paper_instrument_id = str(IID)
        source._paper_entry_terms = functools.partial(paper.paper_terms.entry, {"BTCUSDT": self.MARKET}, proxy_url=None)
        return source

    @staticmethod
    def tick(*, final: bool = False):
        """The recorder's tick (Recorder.on_stop_timer) once every read started has ended, or at the stop."""
        if not final:
            for item in list(paper.paper_terms.QUEUE):
                item.thread.join(5)
        paper.paper_terms.release(paper.journal, paper.request_stop, stopping=paper.STOP.is_set() or final, final=final)

    def submit(self, answer, *, reduce_only: bool = False, name: str = "O-1"):
        order = SimpleNamespace(is_reduce_only=reduce_only, client_order_id=name)
        get = mock.Mock(side_effect=answer if isinstance(answer, Exception) else None, return_value=answer)
        with mock.patch.object(klines, "get_json", get):
            paper._PaperConfigured.submit_order(self.source(), order)  # type: ignore[arg-type]
            self.tick()
        return order, get

    def test_an_entry_after_a_tick_change_is_not_sent_and_stops_the_run(self):
        _, get = self.submit(self.exchange("0.01"))
        self.sent.assert_not_called()
        self.assertEqual(paper.STOP_REASON, ["TERMS_CHANGED"])
        self.journal.assert_called_once_with("refusal", code="TERMS_CHANGED", instrument_id=str(IID),
                                             client_order_id="O-1",
                                             changed=["price_increment: market 0.10, exchange 0.01"])
        self.assertEqual(get.call_args.args, ("https://fapi.binance.com/fapi/v1/exchangeInfo", None))

    def test_an_entry_on_the_markets_terms_is_sent(self):
        order, _ = self.submit(self.exchange("0.10"))
        self.sent.assert_called_once()
        self.assertIs(self.sent.call_args.args[0], order)
        self.journal.assert_not_called()
        self.assertEqual(paper.STOP_REASON, [])

    def test_a_reduce_only_order_is_sent_without_a_read(self):
        order, get = self.submit(self.exchange("0.01"), reduce_only=True)
        get.assert_not_called()
        self.assertIs(self.sent.call_args.args[0], order)
        self.assertEqual(paper.STOP_REASON, [])

    def test_an_entry_on_a_contract_binance_does_not_trade_is_not_sent_and_the_run_goes_on(self):
        """#3674: as Live admits an entry (engine.live_venue.require_admission), only on a TRADING USDT-margined
        perpetual; a SETTLING one keeps sending bars. Reduce-only orders go out unread."""
        for field, value in (("status", "SETTLING"), ("status", "PENDING_TRADING"),
                             ("contractType", "CURRENT_QUARTER"), ("marginAsset", "USDC")):
            with self.subTest(field=field, value=value):
                self.sent.reset_mock()
                self.journal.reset_mock()
                self.submit(self.exchange("0.10", **{field: value}))
                self.sent.assert_not_called()
                self.assertEqual(paper.STOP_REASON, [])
                [call] = self.journal.call_args_list
                self.assertEqual(call.args, ("entry_not_sent",))
                self.assertEqual((call.kwargs["code"], call.kwargs["client_order_id"]), ("PAPER_INSTRUMENT", "O-1"))
                self.assertIn(f"{field} {value}", call.kwargs["reason"])
        order, get = self.submit(self.exchange("0.10", status="SETTLING"), reduce_only=True)
        get.assert_not_called()
        self.assertIs(self.sent.call_args.args[0], order)

    def test_a_contract_answer_without_its_status_refuses_the_entry(self):
        answer = self.exchange("0.10")
        del answer["symbols"][1]["status"]
        self.submit(answer)
        self.sent.assert_not_called()
        self.assertEqual(paper.STOP_REASON, ["TERMS_CHANGED"])

    def test_terms_binance_does_not_give_refuse_the_entry(self):
        for answer in ({"symbols": [{"symbol": "ETHUSDT", "filters": []}]}, OSError("connection reset")):
            with self.subTest(answer=answer):
                self.submit(answer)
                self.sent.assert_not_called()
                self.assertEqual(paper.STOP_REASON, ["TERMS_CHANGED"])
                paper.STOP.clear()
                paper.STOP_REASON.clear()

    def test_a_slow_read_holds_only_its_entry_and_later_ones_not_the_node(self):
        """While Binance is slow to answer, the entry waits unsent and the node goes on: its submit returns at once, a
        reduce-only order is sent, the recorder's tick sends nothing, no checkpoint is cut; the entries go out in order
        once the read ends."""
        answered = threading.Event()

        def slow(url, proxy_url, timeout=10):
            answered.wait(10)
            return self.exchange("0.10")
        with mock.patch.object(klines, "get_json", slow):
            began = time.monotonic()
            source = self.source()
            first, second, stop = (SimpleNamespace(is_reduce_only=reduce_only, client_order_id=name)
                                   for name, reduce_only in (("O-1", False), ("O-2", False), ("O-3", True)))
            for order in (first, second, stop):
                paper._PaperConfigured.submit_order(source, order)  # type: ignore[arg-type]
            self.assertLess(time.monotonic() - began, 1)
            self.assertEqual([call.args[0] for call in self.sent.call_args_list], [stop])
            paper.paper_terms.release(paper.journal, paper.request_stop, stopping=False)
            self.assertEqual(len(paper.paper_terms.QUEUE), 2)
            session = paper_session.Session.__new__(paper_session.Session)
            session.pause_error, session.depth, session.stopped_ns, session.supported, session.ready = (
                None, 0, None, True, True)
            with self.assertRaisesRegex(Exception, "an entry waits for its terms read"):
                session.cut(SimpleNamespace(orders=list))
            answered.set()
            self.tick()
        self.assertEqual([call.args[0] for call in self.sent.call_args_list], [stop, first, second])
        self.assertEqual(paper.paper_terms.QUEUE, [])

    def test_an_entry_still_waiting_at_the_stop_is_not_sent(self):
        answered = threading.Event()
        with mock.patch.object(klines, "get_json", lambda *_, **__: answered.wait(10) and self.exchange("0.10")):
            paper._PaperConfigured.submit_order(self.source(), SimpleNamespace(is_reduce_only=False,  # type: ignore[arg-type]
                                                                               client_order_id="O-1"))
            self.tick(final=True)
            answered.set()
        self.sent.assert_not_called()
        self.journal.assert_called_once_with("entry_not_sent", reason="the run is stopping", instrument_id=str(IID),
                                             client_order_id="O-1")

    def test_a_cancelled_waiting_entry_is_never_sent_and_is_ended_natively(self):
        for sent_on, both, command in ((0, False, lambda source, name: source.cancel_order(name)),
                                       (0, False, lambda source, name: source.cancel_orders(iter([name]))),
                                       (1, False, lambda source, name: source.cancel_all_orders(IID, OrderSide.BUY)),
                                       (1, True, lambda source, name: source.cancel_all_orders(IID, OrderSide.NO_ORDER_SIDE))):
            answered = threading.Event()
            source, order, other = self.source(), *(SimpleNamespace(
                is_reduce_only=False, client_order_id=name, side=side) for name, side in
                (("O-1", OrderSide.BUY), ("O-2", OrderSide.SELL)))
            native = mock.Mock(return_value=None)
            with self.subTest(command=command), \
                    mock.patch.object(klines, "get_json", lambda *_, **__: answered.wait(10) and self.exchange("0.10")), \
                    mock.patch.object(paper.OrderRules, "cancel_order", native), \
                    mock.patch.object(paper.OrderRules, "cancel_orders", native), \
                    mock.patch.object(paper.OrderRules, "cancel_all_orders", native), \
                    mock.patch.object(paper.OrderRules, "_runner_orders_allowed", return_value=True), \
                    mock.patch.object(paper.paper_terms, "native_cache", lambda _: SimpleNamespace(order=lambda _: None)), \
                    mock.patch.object(paper.paper_terms, "CANCELLER", mock.sentinel.canceller), \
                    mock.patch.object(paper.paper_terms.unsent, "cancel") as ended:
                self.sent.reset_mock()
                paper._PaperConfigured.submit_order(source, other)  # type: ignore[arg-type]
                paper._PaperConfigured.submit_order(source, order)  # type: ignore[arg-type]
                command(source, "O-1")
                ended.assert_not_called()  # after the source's callback, not within it
                self.assertEqual(native.call_count, sent_on)  # a cancel of all also cancels the sent orders
                answered.set()
                self.tick()
                self.assertEqual(ended.call_args_list[-1], mock.call(paper.paper_terms.CANCELLER, order, paper.paper_terms.ENTRY_GATE))
                self.assertEqual(ended.call_count, 2 if both else 1)
            self.assertEqual([call.args[0] for call in self.sent.call_args_list], [] if both else [other])
            self.assertEqual(paper.paper_terms.QUEUE, [])
        self.journal.assert_not_called()

    def cancelled(self, answer, known=None):
        order, native = SimpleNamespace(is_reduce_only=False, client_order_id="O-1"), mock.Mock(return_value=None)
        source = self.source()
        with mock.patch.object(klines, "get_json", return_value=answer), \
                mock.patch.object(paper.OrderRules, "cancel_order", native), \
                mock.patch.object(paper.OrderRules, "_runner_orders_allowed", return_value=True), \
                mock.patch.object(paper.paper_terms, "native_cache", lambda _: SimpleNamespace(order=lambda _: known)), \
                mock.patch.object(paper.paper_terms, "CANCELLER", mock.sentinel.canceller), \
                mock.patch.object(paper.paper_terms.unsent, "cancel") as ended:
            paper._PaperConfigured.submit_order(source, order)  # type: ignore[arg-type]
            source.cancel_order("O-1")  # type: ignore[arg-type]
            self.tick()
        self.sent.assert_not_called()
        return ended, native

    def test_a_cancelled_entrys_terms_still_refuse_and_stop_the_run(self):
        ended, _ = self.cancelled(self.exchange("0.01"))
        ended.assert_called_once()
        self.assertEqual(paper.STOP_REASON, ["TERMS_CHANGED"])

    def test_a_cancelled_resubmission_cancels_the_order_the_native_cache_holds(self):
        ended, native = self.cancelled(self.exchange("0.10"), known=object())
        ended.assert_not_called()
        native.assert_called_once_with("O-1", None, None)

    def test_a_cancel_with_parameters_reaches_the_order_rules(self):
        answered = threading.Event()
        order, native = SimpleNamespace(is_reduce_only=False, client_order_id="O-1"), mock.Mock(return_value=None)
        with mock.patch.object(klines, "get_json", lambda *_, **__: answered.wait(10) and self.exchange("0.10")), \
                mock.patch.object(paper.OrderRules, "cancel_order", native):
            source = self.source()
            paper._PaperConfigured.submit_order(source, order)  # type: ignore[arg-type]
            source.cancel_order("O-1", None, {"a": 1})  # type: ignore[arg-type]
            answered.set()
            self.tick()
        native.assert_called_once()
        self.sent.assert_called_once()


class SandboxConfigTests(unittest.TestCase):
    def test_the_sandbox_leaves_position_ids_to_the_execution_engine(self):
        """A recovery restarts the matching engine's own position counter and contract order, so a resting
        limit entry's ID from it would collide with a cached position (20261114-33); the execution engine's
        IDs live in the cache."""
        builder = mock.MagicMock()
        with mock.patch.object(realtime.LiveNode, "builder", return_value=builder), mock.patch.object(paper, "Recorder"), \
                mock.patch.object(paper.history, "ACTORS", []):  # the warm-up actor registers itself here
            paper.build_node([], SimpleNamespace(warmup=()), None, (Decimal("0.0002"), Decimal("0.0005")),
                             Path("/nonexistent"), "3", {})
        configs = [call.args[2] for call in builder.mock_calls if call[0].endswith("add_simulated_exec_client")]
        self.assertEqual(len(configs), 1)
        self.assertFalse(configs[0].use_position_ids)

    def test_a_recorder_the_node_did_not_register_is_refused(self):
        with mock.patch.object(realtime.LiveNode, "builder", return_value=mock.MagicMock()), \
                mock.patch.object(paper.history, "ACTORS", []):
            caught = refused(paper.build_node, [], SimpleNamespace(warmup=()), None,
                             (Decimal("0.0002"), Decimal("0.0005")), Path("/nonexistent"), "3", {}, error=Refusal)
        self.assertEqual(caught.code, "NATIVE_EXECUTION_FAILED")


    def test_a_checkpoint_without_source_state_restores_only_a_source_without_the_protocol_as_held(self):
        """`sources` empty is a held checkpoint exactly when the source is not Session.supported; a held start adds a
        holder per contract, never the source."""
        account = SimpleNamespace(id="SANDBOX-001", balance_total=lambda _: paper.Money(Decimal(1000),
                                                                                       paper.Currency.from_str("USDT")))
        planned = [paper.PaperInputs(str(IID), DAY, DAY, "R1-BTCUSDT", None, DAY)]  # type: ignore[arg-type]
        self.addCleanup(paper.strategy_runtime.STRATEGIES.clear)
        # A source with the protocol whose checkpoint has the account and no state was held by an earlier recovery
        # (Session.hold): it is held again.
        for supported, sources, refuses in ((False, {}, False), (True, {}, False), (False, {"BTC": {}}, True),
                                            (True, {"BTC": {}}, False)):
            with self.subTest(supported=supported, sources=sources):
                session = paper.Session.__new__(paper.Session)
                session.saved, session.working, session.declared = {"sources": sources}, set(), supported
                session.supported, session.fallen = supported, None
                session.backend = SimpleNamespace(config=None, accounts=lambda: {"a": account},
                                                  open_contracts=lambda: set())
                builder = mock.MagicMock()
                with mock.patch.object(realtime.LiveNode, "builder", return_value=builder), \
                        mock.patch.object(paper, "Recorder"), mock.patch.object(paper.history, "ACTORS", []), \
                        mock.patch.object(paper.strategy_runtime, "configure_strategy") as configure:
                    if refuses:
                        with self.assertRaises(paper.checkpoint.Refusal):
                            paper.build_node(planned, SimpleNamespace(warmup=()), None,
                                             (Decimal("0.0002"), Decimal("0.0005")), Path("/nonexistent"), "3", {},
                                             session)
                        continue
                    node, _ = paper.build_node(planned, SimpleNamespace(warmup=()), None,
                                            (Decimal("0.0002"), Decimal("0.0005")), Path("/nonexistent"), "3", {},
                                            session)
                added = node.add_strategy.call_args.args[0]
                self.assertEqual(isinstance(added, paper.Holder), not (supported and sources))
                self.assertEqual(configure.called, bool(supported and sources))
                self.assertEqual(session.fallen, "an earlier recovery of this run was held" if supported and not sources
                                 else None)

    def test_the_sandbox_takes_the_contracts_matching_terms_a_replay_venue_takes(self):
        """liquidity_consumption and queue_position come from the account contract, as in engine.run.add_venue, so
        changing the contract changes Paper's Sandbox too (20261114-39); the contract's current values are the native
        defaults, which a paired in-process replay confirmed give identical orders, fills, positions and account."""
        def configured() -> SimpleNamespace:
            builder = mock.MagicMock()
            with mock.patch.object(realtime.LiveNode, "builder", return_value=builder), \
                    mock.patch.object(paper, "Recorder"), mock.patch.object(paper.history, "ACTORS", []):
                paper.build_node([], SimpleNamespace(warmup=()), None, (Decimal("0.0002"), Decimal("0.0005")),
                                 Path("/nonexistent"), "3", {})
            return [call.args[2] for call in builder.mock_calls if call[0].endswith("add_simulated_exec_client")][0]

        config = configured()
        self.assertEqual((config.liquidity_consumption, config.queue_position),
                         (paper.ACCOUNT_CONTRACT["liquidity_consumption"], paper.ACCOUNT_CONTRACT["queue_position"]))
        with mock.patch.dict(paper.ACCOUNT_CONTRACT, {"liquidity_consumption": True, "queue_position": True}):
            changed = configured()
        self.assertEqual((changed.liquidity_consumption, changed.queue_position), (True, True))


class NativeReportTests(unittest.TestCase):
    """The run's reports (engine.paper.write_native_reports) are the same for a run that was paused and resumed as for
    one that was not: rc7 changes the cache a resume restores in ways no trading made."""

    def state(self, total: str, locked: str = "0", margins: tuple = (), ts: int = DAY):
        from nautilus_trader.core import UUID4
        from nautilus_trader.model import (AccountBalance, AccountId, AccountState, AccountType, Currency,
                                           MarginBalance, Money)
        usdt = Currency.from_str("USDT")
        return AccountState(AccountId("BINANCE-SANDBOX-001"), AccountType.MARGIN,
                            [AccountBalance(Money(Decimal(total), usdt), Money(Decimal(locked), usdt),
                                            Money(Decimal(total) - Decimal(locked), usdt))],
                            [MarginBalance(Money(Decimal(initial), usdt), Money(Decimal(maintenance), usdt), IID)
                             for initial, maintenance in margins],
                            False, UUID4(), ts, ts, usdt)

    def write(self, states: list, resumed: tuple = (), orders: list | None = None) -> tuple:
        import pandas as pd
        from nautilus_trader.model import MarginAccount
        account = MarginAccount(states[0], True)
        for state in states[1:]:
            account.apply(state)
        cache = SimpleNamespace(orders=list, positions=list, position_snapshots=list,
                                account_for_venue=lambda venue: account,
                                order=lambda order_id: SimpleNamespace(time_in_force="GTC", expire_time=None))
        output = Path(self.enterContext(tempfile.TemporaryDirectory()))
        (output / "events.jsonl").write_text("".join(
            f'{{"execution": "bars", "kind": "resumed", "wall_ns": {at}}}\n' for at in resumed), encoding="utf-8")
        native = pd.DataFrame(orders or [], columns=["client_order_id", "status", "filled_qty", "liquidity_side"])
        with mock.patch("nautilus_trader.analysis.ReportProvider.generate_orders_report",
                        return_value=native.set_index("client_order_id")):
            paper.write_native_reports(output, cache)
        return (pd.read_csv(output / paper.REPORTS / "account.csv", dtype=str),
                pd.read_csv(output / paper.REPORTS / "orders.csv", dtype=str, keep_default_na=False))

    def test_an_order_without_a_fill_has_no_liquidity_side_and_a_filled_one_keeps_its_own(self):
        """rc7's matching engine marks every order it restores MAKER (restore_open_order) and a resting limit order
        it accepts, but not a stop it accepts: a stop canceled unfilled read MAKER only after a resume."""
        _, orders = self.write([self.state("100000")], orders=[
            ("O-1", "CANCELED", "0.000", "MAKER"), ("O-2", "CANCELED", "0.000", "NO_LIQUIDITY_SIDE"),
            ("O-3", "FILLED", "0.010", "TAKER"), ("O-4", "FILLED", "0.010", "MAKER")])
        self.assertEqual(dict(zip(orders["client_order_id"], orders["liquidity_side"], strict=True)),
                         {"O-1": "NO_LIQUIDITY_SIDE", "O-2": "NO_LIQUIDITY_SIDE", "O-3": "TAKER", "O-4": "MAKER"})

    def test_a_resumed_accounts_repeated_states_and_the_sandboxs_restatement_are_left_out(self):
        """rc7's Redis cache appends the account's last state on every cache update, so the restored account repeats
        states under one event ID; the Sandbox restates the balance with no margin when it connects again."""
        start = self.state("100000")
        opened = self.state("100000", "333", ((333, 0),), ts=DAY + MINUTE_NS)
        paused = DAY + 5 * MINUTE_NS
        restated = self.state("100000", ts=paused + 10**9)
        closed = self.state("99998.5", ts=paused + 3 * MINUTE_NS)
        account, _ = self.write([start, start, opened, opened, opened, restated, closed], resumed=(paused,))
        self.assertEqual(list(zip(account["total"], account["locked"], strict=True)),
                         [("100000.00000000", "0.00000000"), ("100000.00000000", "333.00000000"),
                          ("99998.50000000", "0.00000000")])

    def test_a_state_that_restates_nothing_stays_and_a_run_never_resumed_keeps_its_first(self):
        start = self.state("100000")
        opened = self.state("100000", "333", ((333, 0),), ts=DAY + MINUTE_NS)
        paused = DAY + 5 * MINUTE_NS
        for name, first in (("margins", self.state("100000", "333", ((333, 0),), ts=paused + 10**9)),
                            ("balance", self.state("99999", ts=paused + 10**9))):
            with self.subTest(name):
                account, _ = self.write([start, opened, first], resumed=(paused,))
                self.assertEqual(len(account), 3)
        account, _ = self.write([start, opened])
        self.assertEqual(list(account["locked"]), ["0.00000000", "333.00000000"])
