"""Disconnected Live withdraws its entry and stops native command producers before node shutdown."""

from concurrent.futures import Future
from decimal import Decimal
import gc
import hashlib
import json
from pathlib import Path
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from nautilus_trader.backtest import BacktestEngine, BacktestEngineConfig
from nautilus_trader.common import LoggerConfig, LogLevel
from nautilus_trader.execution import MakerTakerFeeModel
from nautilus_trader.model import (
    AccountType, BookType, Currency, MarkPriceUpdate, Money, OmsType, OrderSide, OrderStatus, Price, Quantity, QuoteTick, Venue,
)

from nautilus_trader.common import SocketState
from engine import history, live
from engine import live_commands as commands, live_connection, live_lifecycle, live_source as live_source_runtime
from engine.live_venue import Credentials
from tests.engine.test_live import SOURCE
from tests.engine.test_live_venue import MARKET_DAY, venue_clock
from tests.engine.test_fill_model import INSTRUMENT


class FixtureReader:
    """Supply account IO only; actual Session admission and dispatch stay unchanged."""

    def __init__(self, credential_binding):
        self.credential_binding = credential_binding
        self.calls = []

    def clock(self):
        return venue_clock()

    def snapshot(self, symbols):
        self.calls.append(tuple(symbols))
        return {
            "observed_ns": live.time.time_ns(), "credential_binding": self.credential_binding,
            "config": {"canTrade": True, "dualSidePosition": True, "multiAssetsMargin": True},
            "account": {"multiAssetsMargin": True, "assets": [
                {"asset": "USDT", "walletBalance": "100", "availableBalance": "199.93889229",
                 "unrealizedProfit": "0", "marginAvailable": True},
                {"asset": "USDC", "walletBalance": "100", "availableBalance": "199.93889229",
                 "unrealizedProfit": "0", "marginAvailable": True},
            ]},
            "positions": [], "orders": [], "algo_orders": [],
            "symbols": {"AAAUSDT": {
                "instrument": {"status": "TRADING", "contractType": "PERPETUAL", "marginAsset": "USDT",
                               "filters": [{"filterType": "MIN_NOTIONAL", "notional": "0.1"},
                                           {"filterType": "PRICE_FILTER", "tickSize": "0.01"},
                                           {"filterType": "LOT_SIZE", "minQty": "0.001", "stepSize": "0.001"}]},
                "config": [{"symbol": "AAAUSDT", "marginType": "CROSSED", "leverage": 50,
                            "isAutoAddMargin": False}],
                "mark": {"markPrice": "90"},
            }},
        }


def venue_snapshot(base: dict, cache, *, unknown: bool = False, observed_ns: int) -> dict:
    """The REST read the native cache agrees with: the open position per side and each open order's venue ID."""
    positions = [{"symbol": "AAAUSDT", "positionSide": side, "positionAmt": str(sum(
        (position.quantity.as_decimal() for position in cache.positions_open()
         if position.side.name == side), Decimal(0)) * (1 if side == "LONG" else -1))} for side in ("LONG", "SHORT")]
    orders = [{"symbol": "AAAUSDT", "orderId": str(order.venue_order_id)} for order in cache.orders_open()]
    if unknown:
        orders.append({"symbol": "AAAUSDT", "orderId": "999999"})
    return {**base, "observed_ns": observed_ns, "positions": positions, "orders": orders, "algo_orders": [],
            "clock": venue_clock()}


class NativeConnectionTests(unittest.TestCase):
    def native(self, root: Path, gtd: bool = True):
        """A Live session whose source sends one LIMIT entry (GTD 600.075 s, or GTC) on its first mark price, on the
        native backtest engine; the venue fills it only against a crossing quote. Startup is covered separately: the
        entry still performs the real require_entry -> asynchronous observation -> require_admission -> dispatch."""
        live.strategy_runtime.clear_failures()
        text = SOURCE.replace("from nautilus_trader.trading import Strategy",
            "from nautilus_trader.trading import Strategy\n"
            "from nautilus_trader.model import OrderSide, Price, Quantity, TimeInForce")
        text = text.replace("self.observed = []", "self.observed = []\n        self.iid = instrument_id\n        self.sent = False")
        text += '''
    def on_start(self):
        self.subscribe_mark_prices(self.iid)  # quotes reach the venue's book, not the source
    def on_mark_price(self, quote):
        if self.sent:
            return
        self.sent = True
        self.pending = self.order_factory.limit(self.iid, OrderSide.BUY, Quantity.from_str('0.003'),
            Price.from_str('90.00'), time_in_force=TimeInForce.GTD, expire_time=quote.ts_event + 600_075_000_000)
        self.submit_order(self.pending)
'''
        if not gtd:
            text = text.replace("time_in_force=TimeInForce.GTD, expire_time=quote.ts_event + 600_075_000_000",
                                "time_in_force=TimeInForce.GTC")
        path, universe = root / "source.py", root / "universe.json"
        path.write_text(text)
        universe.write_text('{"membership":{"AAAUSDT":[[0,9999999999999999999]]}}')
        credentials = Credentials("offline-connection-key", "offline-connection-secret")
        manifest = dict(run_id="native-window", symbols=["AAAUSDT"], strategy_file=str(path),
            account_id="BINANCE-001", credential_binding=credentials.binding,
            universe_file=str(universe), universe_sha256=hashlib.sha256(universe.read_bytes()).hexdigest(),
            source=dict(entry_class="Source", source_sha256=hashlib.sha256(text.encode()).hexdigest()),
            config=dict(duration_seconds=60, drawdown_brake="0.15", leverage="50"),
            market=dict(market_day=MARKET_DAY, terms={"AAAUSDT": dict(
                price_increment="0.01", size_increment="0.001", min_notional="0.1")}))
        reader = FixtureReader(credentials.binding)
        session = live.Session(manifest, root, "run", account_verified=True, account_reader=reader)
        session.brake.budget = Decimal("85")
        session.node = Mock()  # Record asynchronous stop without advancing native time.
        session.sources = live_source_runtime.live_source(live.source_for_run(manifest), session)
        [source] = session.sources.values()
        engine = BacktestEngine(BacktestEngineConfig(logging=LoggerConfig(stdout_level=LogLevel.ERROR, print_config=False)))
        usdt = Currency.from_str("USDT")
        engine.add_venue(Venue("BINANCE"), OmsType.HEDGING, AccountType.MARGIN,
            [Money(100, usdt)], base_currency=usdt, default_leverage=Decimal(1), book_type=BookType.L1_MBP,
            fee_model=MakerTakerFeeModel(Decimal(0), Decimal(0)), support_gtd_orders=True, liquidity_consumption=True)
        engine.add_instrument(INSTRUMENT)
        engine.add_strategy(source)
        start = history.STATES[str(source.strategy_id)]["at"] + 1_000_000_000  # after its T

        def advance(ts, bid="100.00", ask="101.00", size="0.001"):
            quote = QuoteTick(INSTRUMENT.id, Price.from_str(bid), Price.from_str(ask),
                              Quantity.from_str(size), Quantity.from_str(size), ts, ts)
            engine.add_data([quote, MarkPriceUpdate(INSTRUMENT.id, Price.from_str(bid), ts, ts)], None, False, True)
            engine.run(None, ts, None, True)
            engine.clear_data()
        return session, source, engine, reader, advance, start

    @staticmethod
    def close_native(session, engine):
        engine.end()
        engine.dispose()
        session.node, session.sources = None, {}
        gc.collect()
        live.strategy_runtime.clear_failures()

    def assert_reopens_and_cancels_unknown(self, session, engine, protection):
        base = session.account_reader.snapshot(["AAAUSDT"])
        now = base["observed_ns"]

        def judge(offset_ns, unknown=False):
            snapshot = venue_snapshot(base, engine.cache, unknown=unknown, observed_ns=now + offset_ns)
            with patch("engine.live_venue.time.time_ns", return_value=now + offset_ns):  # read just now
                live_connection.judge(session, engine.cache, snapshot)

        judge(0)  # no live bar since the reconnect: the feed's continuity is not shown yet
        self.assertEqual(set(session.connection.closed), {"unverified"})
        self.assertIsNone(session.connection.agreed)
        session.connection.bar_since_reconnect = True
        judge(1)
        self.assertEqual(session.connection.agreed, now + 1)
        judge(10**9)
        self.assertTrue(session.connection.closed)  # one second apart is not a native reconciliation cycle
        judge(31 * 10**9)
        self.assertEqual(session.connection.closed, {})
        # An order at the venue the cache does not know: every order on the contract is canceled, entries stay closed.
        judge(32 * 10**9, unknown=True)
        self.assertEqual(set(session.connection.closed), {"unknown_orders"})
        self.assertFalse(session.stopping)
        events = [json.loads(row) for row in (session.output / "events.jsonl").read_text().splitlines()]
        self.assertEqual([row["event"] for row in events if row["event"].startswith("entries_")],
                         ["entries_closed", "entries_checking", "entries_opened", "entries_closed"])

    def test_an_entry_at_a_closed_gate_is_held_unsent_and_sent_once_when_it_reopens(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            session, source, engine, reader, advance, start = self.native(root, gtd=False)
            self.addCleanup(self.close_native, session, engine)
            observer = SimpleNamespace(session=session, cache=engine.cache)
            socket = SimpleNamespace(client_id="BINANCE", endpoint="binance-futures-user-streams",
                                     state=SocketState.DISCONNECTED)
            live_lifecycle.Observer.on_socket_state(observer, socket)
            advance(start)  # the source decides while the gate is closed
            self.assertFalse(session.stopping or session.failed)
            [held] = session.pending_entries
            self.assertEqual(held.deadline_ns, start + 60_000_000_000)
            self.assertIsNone(session.account_observation)
            self.assertEqual(reader.calls, [])
            # Not in the native cache: nothing counts it, nothing can cancel or fill it.
            self.assertEqual((engine.cache.orders(), engine.cache.orders_open()), ([], []))
            commands.dispatch_entry(session)
            self.assertEqual(engine.cache.orders(), [])
            socket.state = SocketState.CONNECTED
            live_lifecycle.Observer.on_socket_state(observer, socket)
            session.connection.bar_since_reconnect = True
            base = reader.snapshot(["AAAUSDT"])
            for offset in (0, 31 * 10**9):
                clock = Mock(wraps=time)  # live_venue's clock only: the observation the reopening starts reads now
                clock.time_ns.return_value = base["observed_ns"] + offset
                with patch("engine.live_venue.time", clock):
                    live_connection.judge(session, engine.cache, venue_snapshot(
                        base, engine.cache, observed_ns=base["observed_ns"] + offset))
            self.assertTrue(live_connection.entries_open(session))
            session.account_observation.result.result(timeout=2)  # the reopened gate checks the held entry
            commands.dispatch_entry(session)
            self.assertEqual(session.pending_entries, [])
            advance(start + 1_000_000)
            self.assertEqual([order.client_order_id for order in engine.cache.orders()], [source.pending.client_order_id])
            self.assertEqual(engine.cache.order(source.pending.client_order_id).status, OrderStatus.ACCEPTED)
            events = [json.loads(row) for row in (root / "events.jsonl").read_text().splitlines()]
            names = [row["event"] for row in events]
            self.assertLess(names.index("entry_held"), names.index("entries_opened"))
            self.assertLess(names.index("entries_opened"), names.index("entry_released"))
            released = next(row for row in events if row["event"] == "entry_released")
            self.assertEqual(released["client_order_id"], str(source.pending.client_order_id))
            self.assertNotIn("entry_refused", names)
            self.assertEqual(live.strategy_runtime.FAILURES, [])

    def test_disconnect_withdraws_the_entry_and_the_venue_expires_gtd(self):
        # cancel_reaches_venue=False: the withdrawal is lost, so only the venue's GTD expiry or a fill ends the entry.
        for disconnected, gtd, cancel_reaches_venue in (
                (False, True, True), (True, True, True), (True, False, True), (True, True, False), (True, False, False)):
            with self.subTest(disconnected=disconnected, gtd=gtd, cancel_reaches_venue=cancel_reaches_venue), \
                    tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                session, source, engine, reader, advance, start = self.native(root, gtd)
                try:
                    advance(start)  # A non-crossing quote creates one unsubmitted LIMIT intent.
                    self.assertNotEqual(session.pending_entries, [])
                    self.assertEqual(len(engine.cache.orders()), 0)
                    self.assertIsInstance(session.account_observation.result, Future)
                    session.account_observation.result.result(timeout=2)
                    commands.dispatch_entry(session)
                    self.assertEqual(session.pending_entries, [])
                    self.assertIsNone(session.account_observation)
                    self.assertEqual(reader.calls, [("AAAUSDT",)])
                    entry_events = [json.loads(row)["event"] for row in (root / "events.jsonl").read_text().splitlines()]
                    self.assertIn("entry_verified", entry_events)
                    self.assertEqual(len(list(root.glob("entry-account-*.json"))), 1)

                    # Only this quote crosses the entry; native L1 liquidity supplies .001.
                    advance(start + 1_000_000, bid="89.00", ask="90.00")
                    advance(start + 50_000_000)  # Non-crossing quotes cannot fill the .002 remainder.
                    order = engine.cache.order(source.pending.client_order_id)
                    self.assertEqual(order.status, OrderStatus.PARTIALLY_FILLED)
                    self.assertEqual(order.quantity, Quantity.from_str("0.003"))
                    self.assertEqual(order.filled_qty, Quantity.from_str("0.001"))
                    self.assertEqual(order.leaves_qty, Quantity.from_str("0.002"))
                    self.assertEqual(len(engine.cache.orders()), 1)
                    position = engine.cache.positions_open()[0]
                    self.assertEqual(position.quantity, Quantity.from_str("0.001"))
                    protection = source.order_factory.stop_market(
                        INSTRUMENT.id, OrderSide.SELL, position.quantity, Price.from_str("80.00"), reduce_only=True)
                    source.submit_order(protection, position_id=position.id)
                    advance(start + 60_000_000)
                    self.assertEqual(engine.cache.order(protection.client_order_id).status, OrderStatus.ACCEPTED)
                    observer = SimpleNamespace(session=session, cache=engine.cache)
                    socket = SimpleNamespace(client_id="BINANCE", endpoint="binance-futures-user-streams",
                                             state=SocketState.DISCONNECTED)
                    if disconnected:
                        if not cancel_reaches_venue:
                            session.cancel_entries = Mock()
                        live_lifecycle.Observer.on_socket_state(observer, socket)
                        # The run goes on: the source keeps running and may still protect and reduce.
                        self.assertTrue(source.is_running())
                        session.node.handle().stop.assert_not_called()
                        self.assertFalse(session.failed or session.stopping)
                        self.assertEqual(set(session.connection.closed), {"disconnected"})
                        advance(start + 70_000_000)  # the venue receives the withdrawal
                    advance(start + 600_075_000_000)  # the GTD expiry, at least 600 s ahead (engine.order_rules)
                    withdrawn = disconnected and cancel_reaches_venue
                    self.assertEqual(engine.cache.order(source.pending.client_order_id).status,
                                     OrderStatus.CANCELED if withdrawn else OrderStatus.EXPIRED if gtd
                                     else OrderStatus.PARTIALLY_FILLED)
                    self.assertEqual(engine.cache.positions_open()[0].quantity, Quantity.from_str("0.001"))
                    self.assertEqual(engine.cache.order(protection.client_order_id).status, OrderStatus.ACCEPTED)
                    if disconnected:
                        if not gtd:
                            advance(start + 600_080_000_000, bid="88.00", ask="89.00", size="0.002")
                            self.assertEqual(engine.cache.order(source.pending.client_order_id).status,
                                             OrderStatus.CANCELED if withdrawn else OrderStatus.FILLED)
                        socket.state = SocketState.CONNECTED
                        live_lifecycle.Observer.on_socket_state(observer, socket)
                        self.assertTrue(session.account_verified)
                        self.assertEqual(set(session.connection.closed), {"unverified"})
                        if withdrawn and gtd:
                            self.assert_reopens_and_cancels_unknown(session, engine, protection)
                            advance(start + 600_090_000_000)  # the venue receives the cancel-all
                            self.assertEqual(engine.cache.order(protection.client_order_id).status,
                                             OrderStatus.CANCELED)
                    self.assertEqual(live.strategy_runtime.FAILURES, [])
                finally:
                    self.close_native(session, engine)

    def test_a_source_that_stops_itself_enters_the_stop_path_and_is_closed(self):
        for action in ("stop", "fault", "degrade"):
            with self.subTest(action=action), tempfile.TemporaryDirectory() as directory:
                live.strategy_runtime.clear_failures()
                root = Path(directory)
                text = SOURCE.replace("from nautilus_trader.trading import Strategy",
                                      "from nautilus_trader.trading import Strategy\n"
                                      "from nautilus_trader.model import OrderSide, Price, Quantity")
                text = text.replace("self.observed = []", "self.observed = []\n        self.iid = instrument_id\n        self.sent = False")
                text += '''
    def on_start(self):
        self.subscribe_mark_prices(self.iid)  # quotes reach the venue's book, not the source
    def on_mark_price(self, quote):
        if self.sent:
            return
        self.sent = True
        self.pending = self.order_factory.limit(self.iid, OrderSide.BUY, Quantity.from_str('0.001'), Price.from_str('90.00'))
        self.submit_order(self.pending)
'''
                path, universe = root / "source.py", root / "universe.json"
                path.write_text(text)
                universe.write_text('{"membership":{"AAAUSDT":[[0,9999999999999999999]]}}')
                credentials = Credentials("offline-connection-key", "offline-connection-secret")
                manifest = dict(run_id="native-window", symbols=["AAAUSDT"], strategy_file=str(path),
                    account_id="BINANCE-001", credential_binding=credentials.binding,
                    universe_file=str(universe), universe_sha256=hashlib.sha256(universe.read_bytes()).hexdigest(),
                    source=dict(entry_class="Source", source_sha256=hashlib.sha256(text.encode()).hexdigest()),
                    config=dict(duration_seconds=3600,
                                drawdown_brake="0.15", leverage="50"),
                    market=dict(market_day=MARKET_DAY, terms={"AAAUSDT": dict(
                        price_increment="0.01", size_increment="0.001", min_notional="0.1")}))
                session = live.Session(manifest, root, "run", account_verified=True,
                                       account_reader=FixtureReader(credentials.binding))
                session.brake.budget = Decimal("85")
                session.node = Mock()
                session.sources = live_source_runtime.live_source(live.source_for_run(manifest), session)
                [source] = session.sources.values()
                engine = BacktestEngine(BacktestEngineConfig(
                    logging=LoggerConfig(stdout_level=LogLevel.ERROR, print_config=False)))
                try:
                    usdt = Currency.from_str("USDT")
                    engine.add_venue(Venue("BINANCE"), OmsType.HEDGING, AccountType.MARGIN,
                        [Money(100, usdt)], base_currency=usdt, default_leverage=Decimal(1), book_type=BookType.L1_MBP,
                        fee_model=MakerTakerFeeModel(Decimal(0), Decimal(0)), liquidity_consumption=False)
                    engine.add_instrument(INSTRUMENT)
                    engine.add_strategy(source)
                    start = history.STATES[str(source.strategy_id)]["at"] + 1_000_000_000  # after its T

                    def advance(ts, bid, ask):
                        size = Quantity.from_str("1.000")
                        engine.add_data([QuoteTick(INSTRUMENT.id, Price.from_str(bid), Price.from_str(ask), size, size, ts, ts),
                                         MarkPriceUpdate(INSTRUMENT.id, Price.from_str(bid), ts, ts)], None, False, True)
                        engine.run(None, ts, None, True)
                        engine.clear_data()

                    advance(start, "100.00", "101.00")
                    session.account_observation.result.result(timeout=2)
                    commands.dispatch_entry(session)
                    advance(start + 1_000_000, "89.00", "90.00")
                    self.assertEqual(len(engine.cache.positions_open()), 1)
                    observer = SimpleNamespace(session=session, last_query=live.time.monotonic(), cache=engine.cache)
                    live_lifecycle.Observer.observe(observer)
                    self.assertFalse(session.stopping)  # A running source is left alone.

                    getattr(source, action)()
                    self.assertFalse(source.is_running())
                    live_lifecycle.Observer.observe(observer)
                    self.assertTrue(session.stopping)
                    self.assertTrue(session.failed)
                    advance(start + 2_000_000, "95.00", "96.00")
                    self.assertEqual(engine.cache.positions_open(), [])
                    reasons = [row.get("reason") for row in map(json.loads, (root / "events.jsonl").read_text().splitlines())
                               if row["event"] == "stopping"]
                    self.assertEqual(reasons, ["source_not_running"])
                finally:
                    self.close_native(session, engine)
