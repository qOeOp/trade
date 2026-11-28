"""A source's native market exit reaches its entries that wait for their terms read (engine.paper_terms): Paper ends
them CANCELED and never sends them, whether the exit still runs or has ended, as a replay cancels the same entry; the
Paper strategy class in a native engine."""

import hashlib
from contextlib import nullcontext
from types import SimpleNamespace
from unittest import mock

from nautilus_trader.backtest import BacktestEngine, BacktestEngineConfig
from nautilus_trader.common import LoggerConfig, LogLevel
from nautilus_trader.model import Bar, MarkPriceUpdate, OrderSide, Price, Quantity, TraderId
from nautilus_trader.trading import ExecutionAlgorithm, ExecutionAlgorithmConfig, Strategy

from engine import order_rules, paper, paper_terms, run
from engine import strategy as strategy_runtime
from engine.load import load_strategy
from tests.engine import test_fill_model as fixture
from tests.engine.test_paper_membership import FEB, JAN, MINUTE, SOURCE, Clocked

SOURCE += '''
    def on_start(self):
        self.denials, self.cancels, self.act = [], [], None

    def on_order_denied(self, event):
        self.denials.append(str(event.reason))

    def on_order_canceled(self, event):
        self.cancels.append((str(event.client_order_id), self.cache.order(event.client_order_id).status.name))

    def on_bar(self, bar):
        act, self.act = self.act, None
        if act:
            act(self)
'''


class MarketExitTests(Clocked):
    def setUp(self):
        super().setUp()
        for registry in (order_rules.WARMING, strategy_runtime.DECLARED, strategy_runtime.BREACHES, paper_terms.QUEUE):
            registry.clear()
            self.addCleanup(registry.clear)
        path = self.root / "source.py"
        path.write_text(SOURCE)
        loaded = load_strategy(path, "Source", hashlib.sha256(SOURCE.encode()).hexdigest())
        self.changed: list[str] = []
        inputs = paper.PaperInputs(str(fixture.INSTRUMENT_ID), JAN, JAN, "SOURCE-001",
                                   paper.Membership("AAAUSDT", [(JAN, FEB)], FEB, self.months), JAN,
                                   entry_terms=lambda _: (None, self.changed))
        self.engine = BacktestEngine(BacktestEngineConfig(trader_id=TraderId(run.ACCOUNT_CONTRACT["trader_id"]),
                                                          logging=LoggerConfig(stdout_level=LogLevel.ERROR)))
        self.addCleanup(self.engine.dispose)
        run.add_venue(self.engine, fixture.fees())
        self.engine.add_instrument(fixture.INSTRUMENT)
        commander = Strategy(strategy_runtime.source_config(paper_terms.CANCELLER_ID))
        self.engine.add_strategy(commander)
        self.engine.add_exec_algorithm(ExecutionAlgorithm(ExecutionAlgorithmConfig(
            exec_algorithm_id=paper_terms.ENTRY_GATE)))
        patcher = mock.patch.object(paper_terms, "CANCELLER", commander)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.source = run.configure_strategy(loaded, inputs, paper.paper_class)
        self.engine.add_strategy(self.source)
        order_rules.WARMING.discard("SOURCE-001")  # the runner's warm-up has ended
        self.now = JAN
        self.feed(self.now + 2 * MINUTE)
        self.source.subscribe_bars(fixture.BAR_TYPE)
        self.feed(self.now + MINUTE)

    def feed(self, until: int) -> None:
        price = Price.from_str("100.00")
        self.engine.add_data([item for ts in range(self.now + MINUTE, until + 1, MINUTE) for item in (
            Bar(fixture.BAR_TYPE, price, Price.from_str("101.00"), Price.from_str("99.00"), price,
                Quantity.from_str("40.000"), ts, ts), MarkPriceUpdate(fixture.INSTRUMENT_ID, price, ts, ts))])
        self.engine.run(None, until, None, True)
        self.engine.clear_data()
        self.now = until

    def on_next_bar(self, act) -> None:
        self.source.act = act
        self.feed(self.now + MINUTE)
        self.assertIsNone(self.source.act)

    @staticmethod
    def release() -> None:
        for item in paper_terms.QUEUE:
            item.thread.join(5)
        paper_terms.release(paper.journal, paper.request_stop, stopping=False)

    def entry(self, kind: str, price: str = "100.50"):  # fills on the fixture's next bar
        arguments = (fixture.INSTRUMENT_ID, OrderSide.BUY, Quantity.from_str("0.010"), Price.from_str(price))
        return getattr(self.source.order_factory, kind)(*arguments)

    def exit_with_entry(self, kind: str, *, after: bool, price: str = "100.50"):
        """The orders' end after a bar on which the source submits an entry and exits; the entry's read is done while
        the exit runs, or `after` it has ended."""
        self.source.submit_order(self.entry("limit"))
        self.release()
        self.feed(self.now + MINUTE)
        [held] = self.engine.cache.positions_open()
        order = self.entry(kind, price)

        def act(source):
            source.submit_order(order)
            source.market_exit()
        self.on_next_bar(act)
        if after:
            self.feed(self.now + MINUTE)
        self.assertIs(self.source.is_exiting(), not after)
        self.release()
        self.feed(self.now + 2 * MINUTE)
        self.assertEqual(self.source.denials, [])
        self.assertEqual(self.source.cancels, [(str(order.client_order_id), "CANCELED")])
        self.assertEqual(self.engine.cache.positions_open(), [])
        self.assertIsNotNone(self.engine.cache.position(held.id))
        self.assertFalse(self.source.is_exiting())
        self.assertEqual(strategy_runtime.BREACHES, [])
        self.assertEqual(paper_terms.QUEUE, [])
        return self.engine.cache.order(order.client_order_id)

    def test_a_limit_read_while_the_exit_runs_is_ended(self):
        self.assertIsNone(self.exit_with_entry("limit", after=False).venue_order_id)

    def test_a_limit_read_after_the_exit_is_not_sent(self):
        self.assertIsNone(self.exit_with_entry("limit", after=True).venue_order_id)

    def test_a_stop_market_read_while_the_exit_runs_is_ended(self):
        self.assertIsNone(self.exit_with_entry("stop_market", after=False).venue_order_id)

    def test_a_stop_market_read_after_the_exit_is_not_sent(self):
        self.assertIsNone(self.exit_with_entry("stop_market", after=True).venue_order_id)

    def test_changed_terms_still_stop_the_run(self):
        self.addCleanup(paper.STOP.clear)
        self.addCleanup(paper.STOP_REASON.clear)
        self.changed = ["price_increment: market 0.10, exchange 0.01"]

        def act(source):
            source.submit_order(self.entry("limit"))
            source.market_exit()
        self.on_next_bar(act)
        self.release()
        self.assertEqual(paper.STOP_REASON, ["TERMS_CHANGED"])
        self.assertEqual([status for _, status in self.source.cancels], ["CANCELED"])

    def test_a_replay_cancels_the_same_entry(self):
        self.source._paper_entry_terms = None  # sent at once, as a replay sends it
        self.exit_with_entry("limit", after=False, price="90.00")  # resting: a marketable one fills before the exit

    def test_a_second_exit_is_ignored_and_hides_no_denial(self):
        order = self.entry("limit")

        def act(source):
            source.market_exit()
            source.submit_order(order)
            source.market_exit()
        self.on_next_bar(act)
        self.release()
        self.assertEqual((self.source.denials, self.source.cancels), (["MARKET_EXIT_IN_PROGRESS"], []))

    def entry_during_exit(self, *, after: bool, waiting: bool = True, tags: list[str] | None = None):
        """The end of an entry the source submits during its exit of a held position; its read, if any, is done while
        the exit runs, or `after` it has ended."""
        self.source.submit_order(self.entry("limit"))
        self.release()
        self.feed(self.now + MINUTE)
        self.assertEqual(len(self.engine.cache.positions_open()), 1)
        if not waiting:
            self.source._paper_entry_terms = None  # sent at once, as a replay sends it
        order = self.source.order_factory.limit(fixture.INSTRUMENT_ID, OrderSide.BUY, Quantity.from_str("0.010"),
                                                Price.from_str("100.50"), tags=tags)

        def act(source):
            source.market_exit()
            source.submit_order(order)
        self.on_next_bar(act)
        if after:
            self.feed(self.now + MINUTE)
        self.assertIs(self.source.is_exiting(), not after)
        self.release()
        self.feed(self.now + 2 * MINUTE)
        self.assertFalse(self.source.is_exiting())
        self.assertEqual((strategy_runtime.BREACHES, paper_terms.QUEUE), ([], []))
        found = self.engine.cache.order(order.client_order_id)
        return found.status.name, self.source.denials

    def test_an_entry_during_the_exit_is_denied_as_a_replay_denies_it(self):
        for after, waiting in ((True, True), (False, True), (False, False)):
            with self.subTest(after=after, waiting=waiting):
                self.assertEqual(self.entry_during_exit(after=after, waiting=waiting),
                                 ("DENIED", ["MARKET_EXIT_IN_PROGRESS"]))
            self.doCleanups()
            self.setUp()

    def test_changed_terms_still_refuse_an_entry_the_exit_does_not_deny(self):
        """Nautilus sends an entry with its exit's tag, so that one still waits for its terms read."""
        self.addCleanup(paper.STOP.clear)
        self.addCleanup(paper.STOP_REASON.clear)
        self.source.submit_order(self.entry("limit"))
        self.release()
        self.feed(self.now + MINUTE)
        self.changed = ["price_increment: market 0.10, exchange 0.01"]
        order = self.source.order_factory.limit(fixture.INSTRUMENT_ID, OrderSide.BUY, Quantity.from_str("0.010"),
                                                Price.from_str("100.50"), tags=[order_rules.MARKET_EXIT_TAG])

        def act(source):
            source.market_exit()
            source.submit_order(order)
        self.on_next_bar(act)
        self.release()
        self.feed(self.now + MINUTE)
        self.assertEqual(paper.STOP_REASON, ["TERMS_CHANGED"])
        self.assertIsNone(self.engine.cache.order(order.client_order_id))

    def test_a_sources_own_is_exiting_is_not_the_native_flag(self):
        for own in (lambda _: True, False):
            with self.subTest(own), mock.patch.object(type(self.source), "is_exiting", own):
                order = self.entry("limit")
                self.on_next_bar(lambda source, order=order: source.submit_order(order))
                self.assertEqual([item.order for item in paper_terms.QUEUE], [order])
                self.release()

    def test_a_cancel_of_another_instances_waiting_entry_breaks_the_order_rules(self):
        """#3659: the native cache does not hold it, so the native cancel raised RuntimeError."""
        other = self.entry("limit")
        for command in (lambda source: source.cancel_order(other.client_order_id),
                        lambda source: source.cancel_orders(iter([other.client_order_id]))):
            paper_terms.queue(lambda _: (None, []), "BBBUSDT-PERP.BINANCE", other, mock.Mock(), mock.Mock())
            self.on_next_bar(command)
            self.assertEqual([code for code, _ in strategy_runtime.BREACHES], [order_rules.CODE])
            self.assertEqual([item.canceled for item in paper_terms.QUEUE], [False])
            self.release()
            strategy_runtime.BREACHES.clear()

    def test_a_replay_sends_an_entry_with_the_exits_tag(self):
        self.assertEqual(self.entry_during_exit(after=False, waiting=False, tags=[order_rules.MARKET_EXIT_TAG]),
                         ("FILLED", []))

    def test_a_refused_recovery_exits_nothing(self):
        self.source.submit_order(self.entry("limit"))
        self.release()
        self.feed(self.now + MINUTE)
        waiting, resting = self.entry("limit"), self.entry("limit", "90.00")
        self.source.submit_order(resting)
        self.release()
        self.feed(self.now + MINUTE)
        self.source.submit_order(waiting)
        session = SimpleNamespace(exiting=mock.Mock(return_value="an order cannot wait for T"), callback=nullcontext)
        with mock.patch.object(paper, "SESSION", session):
            self.on_next_bar(lambda source: source.market_exit())
            self.feed(self.now + 2 * MINUTE)
        session.exiting.assert_called_once_with()
        self.assertFalse(self.source.is_exiting())
        self.assertEqual(len(self.engine.cache.positions_open()), 1)
        self.assertEqual([order.client_order_id for order in self.engine.cache.orders_open()],
                         [resting.client_order_id])
        self.assertEqual([item.canceled for item in paper_terms.QUEUE], [False])
        # The same call without the refusal exits (control).
        session.exiting.return_value = None
        with mock.patch.object(paper, "SESSION", session):
            self.on_next_bar(lambda source: source.market_exit())
            self.release()
            self.feed(self.now + 2 * MINUTE)
        self.assertEqual((self.engine.cache.positions_open(), self.engine.cache.orders_open()), ([], []))

    def test_an_exit_during_the_warm_up_is_refused(self):
        """#3650: a recovering source runs its history callbacks and on_load before the recovery is checked; with no
        back-fill pending (Session.exiting passes it) its market exit then broke rule 8 past submit_order."""
        self.source.submit_order(self.entry("limit"))
        self.release()
        self.feed(self.now + MINUTE)
        resting = self.entry("limit", "90.00")
        self.source.submit_order(resting)
        self.release()
        self.feed(self.now + MINUTE)
        order_rules.WARMING.add("SOURCE-001")
        session = SimpleNamespace(exiting=mock.Mock(return_value=None), callback=nullcontext)
        with mock.patch.object(paper, "SESSION", session):
            self.on_next_bar(lambda source: source.market_exit())
            self.feed(self.now + 2 * MINUTE)
        self.assertEqual([code for code, _ in strategy_runtime.BREACHES], [order_rules.CODE])
        self.assertFalse(self.source.is_exiting())
        self.assertEqual(len(self.engine.cache.positions_open()), 1)
        self.assertEqual([order.client_order_id for order in self.engine.cache.orders_open()],
                         [resting.client_order_id])
