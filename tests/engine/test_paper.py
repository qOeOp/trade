"""engine.paper without a network: the credential refusal, the replay cadence of the live feed, the strategy's
data callbacks held until the next data dispatch, when the fills their data caused are applied, the instances a run plans and the event fields
the live view draws from."""

import unittest
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from nautilus_trader.model import FundingRateUpdate, InstrumentId, MarkPriceUpdate, Price

from engine import membership as membership_months, paper
from engine.cadence import Cadence
from engine.config import MINUTE_NS, Refusal
from engine.load import DAY_NS

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
        instance._paper_cadence = mock.Mock(**{"mark.return_value": True})
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
                    with mock.patch.object(Path, "write_text", side_effect=self.FULL):
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
            with self.assertRaises(SystemExit) as raised:
                paper.main([])
        self.assertEqual(raised.exception.code, paper.JOURNAL_FAILED_EXIT)
        with mock.patch.dict("os.environ", {}, clear=True), mock.patch.object(paper, "parse", return_value=args), \
                mock.patch.object(paper, "_main", return_value=False), mock.patch.object(paper, "Signals"):
            paper.main([])


class CacheLivenessTests(unittest.TestCase):
    """The native cache child is watched every second: a dead one ends the run with a reason, as a refused one."""

    def test_a_dead_cache_stops_the_run_with_its_own_reason_and_a_live_one_does_not(self):
        held = (paper.STOP, paper.STOP_REASON)
        for value in held:
            self.addCleanup(value.clear)
        recorder = paper.Recorder(paper.RecorderConfig([str(IID)], {}))
        health = mock.Mock()
        session = SimpleNamespace(backend=SimpleNamespace(health=health), ready=True, try_cut=mock.Mock())
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
        session = SimpleNamespace(backend=SimpleNamespace(health=health), ready=True, supported=False)
        with mock.patch.object(paper, "SESSION", session), mock.patch.object(paper, "journal") as journal, \
                mock.patch.object(recorder, "_protection"), \
                mock.patch.object(paper.Recorder, "cache", new_callable=mock.PropertyMock,
                                  return_value=SimpleNamespace(orders_open=lambda: [])):
            recorder.on_stop_timer(None)
        health.assert_not_called()
        self.assertEqual(paper.STOP_REASON, ["STOP_FILE"])
        self.assertEqual([call.args[0] for call in journal.call_args_list], ["stop_requested"])


class CredentialTests(unittest.TestCase):
    def test_credential_names_are_found_by_name(self):
        environ = {"BINANCE_API_KEY": "x", "OKX_SECRET": "x", "MY_API_SECRET": "x", "PATH": "/bin", "HOME": "/h"}
        self.assertEqual(paper.credential_names(environ), ["BINANCE_API_KEY", "MY_API_SECRET", "OKX_SECRET"])

    def test_the_runner_refuses_to_start_with_a_credential_in_its_environment(self):
        with mock.patch.dict("os.environ", {"BINANCE_API_SECRET": "never-read"}), \
                mock.patch.object(paper, "parse", side_effect=AssertionError("parsed")):
            with self.assertRaises(Refusal) as raised:
                paper.main([])
        self.assertEqual(raised.exception.code, "PAPER_CREDENTIALS_PRESENT")
        self.assertNotIn("never-read", str(raised.exception))


class CadenceTests(unittest.TestCase):
    def test_the_strategy_gets_the_first_mark_of_each_minute(self):
        cadence = Cadence()
        stamps = [DAY + 1_000_000, DAY + 2_000_000_000, DAY + MINUTE_NS, DAY + MINUTE_NS + 5, DAY + 3 * MINUTE_NS]
        self.assertEqual([cadence.mark(mark(ts)) for ts in stamps], [True, False, True, False, True])

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
            with self.assertRaises(Refusal) as raised:
                paper.plan(["ETHUSDT"], membership, DAY, DAY)
        self.assertEqual(raised.exception.code, "PAPER_NOT_IN_UNIVERSE")


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


class SandboxConfigTests(unittest.TestCase):
    def test_the_sandbox_leaves_position_ids_to_the_execution_engine(self):
        """A recovery restarts the matching engine's own position counter and contract order, so a resting
        limit entry's ID from it would collide with a cached position (20261114-33); the execution engine's
        IDs live in the cache."""
        builder = mock.MagicMock()
        with mock.patch.object(paper.LiveNode, "builder", return_value=builder), \
                mock.patch.object(paper.history, "ACTORS", []):  # the warm-up actor registers itself here
            paper.build_node([], SimpleNamespace(warmup=()), None, (Decimal("0.0002"), Decimal("0.0005")),
                             Path("/nonexistent"), "3", {})
        configs = [call.args[2] for call in builder.mock_calls if call[0].endswith("add_simulated_exec_client")]
        self.assertEqual(len(configs), 1)
        self.assertFalse(configs[0].use_position_ids)


    def test_the_sandbox_takes_the_contracts_matching_terms_a_replay_venue_takes(self):
        """liquidity_consumption and queue_position come from the account contract, as in engine.run.add_venue, so
        changing the contract changes Paper's Sandbox too (20261114-39); the contract's current values are the native
        defaults, which a paired in-process replay confirmed give identical orders, fills, positions and account."""
        def configured() -> SimpleNamespace:
            builder = mock.MagicMock()
            with mock.patch.object(paper.LiveNode, "builder", return_value=builder), \
                    mock.patch.object(paper.history, "ACTORS", []):
                paper.build_node([], SimpleNamespace(warmup=()), None, (Decimal("0.0002"), Decimal("0.0005")),
                                 Path("/nonexistent"), "3", {})
            return [call.args[2] for call in builder.mock_calls if call[0].endswith("add_simulated_exec_client")][0]

        config = configured()
        self.assertEqual((config.liquidity_consumption, config.queue_position),
                         (paper.ACCOUNT_CONTRACT["liquidity_consumption"], paper.ACCOUNT_CONTRACT["queue_position"]))
        with mock.patch.dict(paper.ACCOUNT_CONTRACT, {"liquidity_consumption": True, "queue_position": True}):
            changed = configured()
        self.assertEqual((changed.liquidity_consumption, changed.queue_position), (True, True))
