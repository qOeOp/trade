"""Disconnected Live stops native command producers before asynchronous node shutdown."""

from decimal import Decimal
import hashlib
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock

from nautilus_trader.backtest import BacktestEngine, BacktestEngineConfig
from nautilus_trader.common import LoggerConfig, LogLevel
from nautilus_trader.execution import MakerTakerFeeModel
from nautilus_trader.model import AccountType, BookType, Currency, Money, OmsType, OrderStatus, Price, Quantity, QuoteTick, Venue

from engine import live
from engine.live_errors import LiveRefusal
from tests.engine.test_live import SOURCE
from tests.engine.test_partial_entry_protection import INSTRUMENT


class NativeConnectionTests(unittest.TestCase):
    def test_native_gtd_stops_but_residual_fills_still_update_cache(self):
        for disconnected, gtd in ((False, True), (True, True), (True, False)):
            with self.subTest(disconnected=disconnected, gtd=gtd), tempfile.TemporaryDirectory() as directory:
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
        self.submit_order(self.order_factory.market(self.iid, OrderSide.BUY, Quantity.from_str('0.001')))
        self.pending = self.order_factory.limit(self.iid, OrderSide.BUY, Quantity.from_str('0.002'),
            Price.from_str('90.00'), time_in_force=TimeInForce.GTD, expire_time=quote.ts_event + 75_000_000)
        self.submit_order(self.pending)
'''
                if not gtd:
                    text = text.replace("time_in_force=TimeInForce.GTD, expire_time=quote.ts_event + 75_000_000",
                                        "time_in_force=TimeInForce.GTC")
                path, universe = root / "source.py", root / "universe.json"
                path.write_text(text)
                universe.write_text('{"membership":{"AAAUSDT":[[0,9999999999999999999]]}}')
                manifest = dict(run_id="native-window", symbols=["AAAUSDT"], strategy_file=str(path),
                    universe_file=str(universe), universe_sha256=hashlib.sha256(universe.read_bytes()).hexdigest(),
                    source=dict(entry_class="Source", source_sha256=hashlib.sha256(text.encode()).hexdigest()),
                    config=dict(single_order_source_reviewed=True, duration_seconds=60))
                # This boundary models an already admitted session; startup is tested separately.
                session = live.Session(manifest, root, "run", account_verified=True)
                session.node = Mock()  # Record the asynchronous stop request without advancing native time.
                source = live.live_source(live.source_for_run(manifest), session)
                session.source = source
                engine = BacktestEngine(BacktestEngineConfig(
                    logging=LoggerConfig(stdout_level=LogLevel.ERROR, print_config=False)))
                try:
                    usdt = Currency.from_str("USDT")
                    engine.add_venue(Venue("BINANCE"), OmsType.HEDGING, AccountType.MARGIN,
                        [Money(10000, usdt)], base_currency=usdt, default_leverage=Decimal(1), book_type=BookType.L1_MBP,
                        fee_model=MakerTakerFeeModel(Decimal(0), Decimal(0)), support_gtd_orders=False)
                    engine.add_instrument(INSTRUMENT)
                    engine.add_strategy(source)
                    start = live.time.time_ns() + 1_000_000_000

                    def advance(ts, bid="100.00", ask="101.00"):
                        quote = QuoteTick(INSTRUMENT.id, Price.from_str(bid), Price.from_str(ask),
                                          Quantity.from_str("100.000"), Quantity.from_str("100.000"), ts, ts)
                        engine.add_data([quote], None, False, True)
                        engine.run(None, ts, None, True)
                        engine.clear_data()

                    advance(start)
                    advance(start + 1_000_000)
                    advance(start + 50_000_000)
                    self.assertEqual(engine.cache.order(source.pending.client_order_id).status, OrderStatus.ACCEPTED)
                    self.assertEqual(engine.cache.positions_open()[0].quantity, Quantity.from_str("0.001"))
                    callbacks = list(source.observed)
                    if disconnected:
                        session.lose_connection("test_disconnect")
                        self.assertFalse(source.is_running())
                        with self.assertRaisesRegex(LiveRefusal, "LIVE_CONNECTION_UNVERIFIED"):
                            source.market_exit()
                    advance(start + 75_000_000)
                    self.assertEqual(engine.cache.order(source.pending.client_order_id).status,
                                     OrderStatus.ACCEPTED if disconnected else OrderStatus.CANCELED)
                    if disconnected:
                        self.assertEqual(len(engine.cache.orders()), 2)
                        self.assertEqual(source.observed, callbacks)
                        if not gtd:
                            advance(start + 80_000_000, bid="88.00", ask="89.00")
                            self.assertEqual(engine.cache.positions_open()[0].quantity, Quantity.from_str("0.003"))
                            self.assertEqual(source.observed, callbacks)
                        live.Observer.on_socket_state(SimpleNamespace(session=session), SimpleNamespace(
                            client_id="BINANCE", endpoint="binance-futures-user-streams", state=live.SocketState.CONNECTED))
                        self.assertFalse(session.account_verified)
                        self.assertTrue(session.connection_failed)
                finally:
                    engine.end()
                    engine.dispose()
                    live.run.clear_failures()
