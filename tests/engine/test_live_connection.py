"""Disconnected Live withdraws its entry and stops native command producers before node shutdown."""

from concurrent.futures import Future
from decimal import Decimal
import hashlib
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock

from nautilus_trader.backtest import BacktestEngine, BacktestEngineConfig
from nautilus_trader.common import LoggerConfig, LogLevel
from nautilus_trader.execution import MakerTakerFeeModel
from nautilus_trader.model import AccountType, BookType, Currency, Money, OmsType, OrderSide, OrderStatus, Price, Quantity, QuoteTick, Venue

from engine import live
from engine.live_errors import LiveRefusal
from engine.live_venue import Credentials
from tests.engine.test_live import SOURCE
from tests.engine.test_partial_entry_protection import INSTRUMENT


class FixtureReader:
    """Supply account IO only; actual Session admission and dispatch stay unchanged."""

    def __init__(self, credential_binding):
        self.credential_binding = credential_binding
        self.calls = []

    def snapshot(self, symbols):
        self.calls.append(tuple(symbols))
        return {
            "observed_ns": live.time.time_ns(), "credential_binding": self.credential_binding,
            "config": {"canTrade": True, "dualSidePosition": True, "multiAssetsMargin": True},
            "account": {"multiAssetsMargin": True, "assets": [
                {"asset": "USDT", "walletBalance": "100", "availableBalance": "199.93889229",
                 "marginAvailable": True},
                {"asset": "USDC", "walletBalance": "100", "availableBalance": "199.93889229",
                 "marginAvailable": True},
            ]},
            "positions": [], "orders": [], "algo_orders": [],
            "symbols": {"AAAUSDT": {
                "instrument": {"status": "TRADING", "contractType": "PERPETUAL", "marginAsset": "USDT",
                               "filters": [{"filterType": "MIN_NOTIONAL", "notional": "0.1"},
                                           {"filterType": "LOT_SIZE", "minQty": "0.001"}]},
                "config": [{"symbol": "AAAUSDT", "marginType": "CROSSED", "leverage": 50,
                            "isAutoAddMargin": False}],
                "mark": {"markPrice": "90"},
            }},
        }


class NativeConnectionTests(unittest.TestCase):
    def test_disconnect_withdraws_the_entry_and_stops_native_gtd(self):
        # cancel_reaches_venue=False: the withdrawal is lost, so a residual fill can still arrive.
        for disconnected, gtd, cancel_reaches_venue in (
                (False, True, True), (True, True, True), (True, False, True), (True, True, False), (True, False, False)):
            with self.subTest(disconnected=disconnected, gtd=gtd, cancel_reaches_venue=cancel_reaches_venue), \
                    tempfile.TemporaryDirectory() as directory:
                live.strategy_runtime.clear_failures()
                root = Path(directory)
                text = SOURCE.replace("from nautilus_trader.model import OmsType",
                    "from nautilus_trader.model import OmsType, OrderSide, Price, Quantity, TimeInForce")
                text = text.replace("use_uuid_client_order_ids=True)",
                                    "use_uuid_client_order_ids=True, manage_gtd_expiry=True)")
                text = text.replace("self.observed = []", "self.observed = []\n        self.iid = instrument_id\n        self.sent = False")
                text += '''
    def on_start(self):
        self.subscribe_quotes(self.iid)
    def on_quote(self, quote):
        if self.sent:
            return
        self.sent = True
        self.pending = self.order_factory.limit(self.iid, OrderSide.BUY, Quantity.from_str('0.003'),
            Price.from_str('90.00'), time_in_force=TimeInForce.GTD, expire_time=quote.ts_event + 75_000_000)
        self.submit_order(self.pending)
'''
                if not gtd:
                    text = text.replace("time_in_force=TimeInForce.GTD, expire_time=quote.ts_event + 75_000_000",
                                        "time_in_force=TimeInForce.GTC")
                path, universe = root / "source.py", root / "universe.json"
                path.write_text(text)
                universe.write_text('{"membership":{"AAAUSDT":[[0,9999999999999999999]]}}')
                credentials = Credentials("offline-connection-key", "offline-connection-secret")
                manifest = dict(run_id="native-window", symbols=["AAAUSDT"], strategy_file=str(path),
                    account_id="BINANCE-001", credential_binding=credentials.binding,
                    universe_file=str(universe), universe_sha256=hashlib.sha256(universe.read_bytes()).hexdigest(),
                    source=dict(entry_class="Source", source_sha256=hashlib.sha256(text.encode()).hexdigest()),
                    config=dict(single_order_source_reviewed=True, duration_seconds=60,
                                budget_usdt="100", max_notional_per_order="90", max_loss_usdt="10"))
                # Startup is covered separately. The new entry still performs the real
                # require_entry -> asynchronous observation -> require_admission -> dispatch.
                reader = FixtureReader(credentials.binding)
                session = live.Session(manifest, root, "run", account_verified=True, account_reader=reader)
                session.node = Mock()  # Record asynchronous stop without advancing native time.
                source = live.live_source(live.source_for_run(manifest), session)
                session.source = source
                engine = BacktestEngine(BacktestEngineConfig(
                    logging=LoggerConfig(stdout_level=LogLevel.ERROR, print_config=False)))
                try:
                    usdt = Currency.from_str("USDT")
                    engine.add_venue(Venue("BINANCE"), OmsType.HEDGING, AccountType.MARGIN,
                        [Money(100, usdt)], base_currency=usdt, default_leverage=Decimal(1), book_type=BookType.L1_MBP,
                        fee_model=MakerTakerFeeModel(Decimal(0), Decimal(0)), support_gtd_orders=False,
                        liquidity_consumption=True)
                    engine.add_instrument(INSTRUMENT)
                    engine.add_strategy(source)
                    start = live.time.time_ns() + 1_000_000_000

                    def advance(ts, bid="100.00", ask="101.00", size="0.001"):
                        quote = QuoteTick(INSTRUMENT.id, Price.from_str(bid), Price.from_str(ask),
                                          Quantity.from_str(size), Quantity.from_str(size), ts, ts)
                        engine.add_data([quote], None, False, True)
                        engine.run(None, ts, None, True)
                        engine.clear_data()

                    advance(start)  # A non-crossing quote creates one unsubmitted LIMIT intent.
                    self.assertIsNotNone(session.pending_entry)
                    self.assertEqual(len(engine.cache.orders()), 0)
                    self.assertIsInstance(session.account_observation.result, Future)
                    session.account_observation.result.result(timeout=2)
                    session.dispatch_entry()
                    self.assertIsNone(session.pending_entry)
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
                    if disconnected:
                        if not cancel_reaches_venue:
                            session.cancel_entries = Mock()
                        session.lose_connection("test_disconnect")
                        callbacks = list(source.observed)  # The stopped source hears nothing further.
                        self.assertFalse(source.is_running())
                        session.node.handle().stop.assert_called_once_with()
                        with self.assertRaisesRegex(LiveRefusal, "LIVE_CONNECTION_UNVERIFIED"):
                            source.market_exit()
                    advance(start + 75_000_000)
                    withdrawn = not disconnected or cancel_reaches_venue
                    self.assertEqual(engine.cache.order(source.pending.client_order_id).status,
                                     OrderStatus.CANCELED if withdrawn else OrderStatus.PARTIALLY_FILLED)
                    self.assertEqual(engine.cache.positions_open()[0].quantity, Quantity.from_str("0.001"))
                    self.assertEqual(engine.cache.order(protection.client_order_id).status, OrderStatus.ACCEPTED)
                    if disconnected:
                        self.assertEqual(len(engine.cache.orders()), 2)
                        self.assertEqual(source.observed, callbacks)
                        if not gtd:
                            advance(start + 80_000_000, bid="88.00", ask="89.00", size="0.002")
                            self.assertEqual(engine.cache.order(source.pending.client_order_id).status,
                                             OrderStatus.CANCELED if withdrawn else OrderStatus.FILLED)
                            self.assertEqual(engine.cache.positions_open()[0].quantity,
                                             Quantity.from_str("0.001" if withdrawn else "0.003"))
                            self.assertEqual(source.observed, callbacks)
                        live.Observer.on_socket_state(SimpleNamespace(session=session), SimpleNamespace(
                            client_id="BINANCE", endpoint="binance-futures-user-streams", state=live.SocketState.CONNECTED))
                        self.assertFalse(session.account_verified)
                        self.assertTrue(session.connection_failed)
                    self.assertEqual(live.strategy_runtime.FAILURES, [])
                finally:
                    engine.end()
                    engine.dispose()
                    live.strategy_runtime.clear_failures()

    def test_a_source_that_stops_itself_enters_the_stop_path_and_is_closed(self):
        for action in ("stop", "fault", "degrade"):
            with self.subTest(action=action), tempfile.TemporaryDirectory() as directory:
                live.strategy_runtime.clear_failures()
                root = Path(directory)
                text = SOURCE.replace("from nautilus_trader.model import OmsType",
                                      "from nautilus_trader.model import OmsType, OrderSide, Price, Quantity")
                text = text.replace("self.observed = []", "self.observed = []\n        self.iid = instrument_id\n        self.sent = False")
                text += '''
    def on_start(self):
        self.subscribe_quotes(self.iid)
    def on_quote(self, quote):
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
                    config=dict(single_order_source_reviewed=True, duration_seconds=3600,
                                budget_usdt="100", max_notional_per_order="90", max_loss_usdt="10"))
                session = live.Session(manifest, root, "run", account_verified=True,
                                       account_reader=FixtureReader(credentials.binding))
                session.node = Mock()
                source = live.live_source(live.source_for_run(manifest), session)
                session.source = source
                engine = BacktestEngine(BacktestEngineConfig(
                    logging=LoggerConfig(stdout_level=LogLevel.ERROR, print_config=False)))
                try:
                    usdt = Currency.from_str("USDT")
                    engine.add_venue(Venue("BINANCE"), OmsType.HEDGING, AccountType.MARGIN,
                        [Money(100, usdt)], base_currency=usdt, default_leverage=Decimal(1), book_type=BookType.L1_MBP,
                        fee_model=MakerTakerFeeModel(Decimal(0), Decimal(0)), liquidity_consumption=False)
                    engine.add_instrument(INSTRUMENT)
                    engine.add_strategy(source)
                    start = live.time.time_ns() + 1_000_000_000

                    def advance(ts, bid, ask):
                        size = Quantity.from_str("1.000")
                        engine.add_data([QuoteTick(INSTRUMENT.id, Price.from_str(bid), Price.from_str(ask), size, size, ts, ts)],
                                        None, False, True)
                        engine.run(None, ts, None, True)
                        engine.clear_data()

                    advance(start, "100.00", "101.00")
                    session.account_observation.result.result(timeout=2)
                    session.dispatch_entry()
                    advance(start + 1_000_000, "89.00", "90.00")
                    self.assertEqual(len(engine.cache.positions_open()), 1)
                    observer = SimpleNamespace(session=session, last_query=live.time.monotonic(), cache=engine.cache)
                    live.Observer.observe(observer)
                    self.assertFalse(session.stopping)  # A running source is left alone.

                    getattr(source, action)()
                    self.assertFalse(source.is_running())
                    live.Observer.observe(observer)
                    self.assertTrue(session.stopping)
                    self.assertTrue(session.failed)
                    advance(start + 2_000_000, "95.00", "96.00")
                    self.assertEqual(engine.cache.positions_open(), [])
                    reasons = [row.get("reason") for row in map(json.loads, (root / "events.jsonl").read_text().splitlines())
                               if row["event"] == "stopping"]
                    self.assertEqual(reasons, ["source_not_running"])
                finally:
                    engine.end()
                    engine.dispose()
                    live.strategy_runtime.clear_failures()
