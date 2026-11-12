"""The entry gate's scheduling and judgments (engine.live_connection), without a venue or a native node."""

from decimal import Decimal
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock

from nautilus_trader.common import SocketState
from nautilus_trader.model import BarType, OrderStatus, PositionSide

from engine import live, live_commands as commands, live_connection
from engine.live_errors import LiveRefusal
from engine.live_records import source_strategy_id
from tests.engine.test_live_venue import fixture

SYMBOL = "BTCUSDT"
BAR = BarType.from_str(f"{SYMBOL}-PERP.BINANCE-1-MINUTE-LAST-EXTERNAL")


def manifest(binding: str) -> dict:
    return {"run_id": "gate", "symbols": [SYMBOL], "account_id": "BINANCE-001", "trader_id": "LIVE-001",
            "credential_binding": binding, "source": {"source_sha256": "0" * 64},
            "config": {"duration_seconds": 3600, "leverage": "50", "budget_usdt": "10", "max_loss_usdt": "1"}}


class Cache:
    def __init__(self, positions=(), orders=()):
        self._positions, self._orders = list(positions), list(orders)

    def positions_open(self, instrument_id=None, **_):
        return list(self._positions)

    def orders(self, instrument_id=None, **_):
        return list(self._orders)


def order(venue_id, status=OrderStatus.ACCEPTED, strategy=None, closed=False):
    return SimpleNamespace(venue_order_id=venue_id, status=status, is_closed=closed, client_order_id="O-" + str(venue_id),
                           strategy_id=strategy)


class GateTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.snapshot, _ = fixture()
        self.binding = self.snapshot["credential_binding"]
        self.session = live.Session(manifest(self.binding), Path(self.temp.name), "run", account_verified=True)
        self.session.node = mock.Mock()
        self.strategy = source_strategy_id(self.session.manifest)

    def events(self):
        return [json.loads(row) for row in (self.session.output / "events.jsonl").read_text().splitlines()]

    def socket(self, state, endpoint="user-stream"):
        live_connection.on_socket_state(self.session, SimpleNamespace(client_id="BINANCE", endpoint=endpoint,
                                                                     state=state))

    def test_compare_agrees_and_names_each_disagreement(self):
        position = SimpleNamespace(strategy_id=self.strategy, side=PositionSide.LONG, id="P-1",
                                   quantity=SimpleNamespace(as_decimal=lambda: Decimal("0.002")))
        stop = order("71", strategy=self.strategy)
        snapshot = dict(self.snapshot, positions=[{"symbol": SYMBOL, "positionSide": "LONG", "positionAmt": "0.002"},
                                                  {"symbol": SYMBOL, "positionSide": "SHORT", "positionAmt": "0"}],
                        orders=[], algo_orders=[{"symbol": SYMBOL, "algoId": 71, "actualOrderId": None}])
        with mock.patch("engine.live_venue.time.time_ns", return_value=snapshot["observed_ns"]):
            self.assertEqual(live_connection.compare(snapshot, Cache([position], [stop]), self.session.manifest), {})
            # A triggered conditional order lists its actual order: either ID matches.
            triggered = dict(snapshot, algo_orders=[{"symbol": SYMBOL, "algoId": 70, "actualOrderId": 71}])
            self.assertEqual(live_connection.compare(triggered, Cache([position], [stop]), self.session.manifest), {})
            found = live_connection.compare(dict(snapshot, orders=[{"symbol": SYMBOL, "orderId": 5}]),
                                            Cache([], [stop, order(None, OrderStatus.SUBMITTED, self.strategy),
                                                       order("9", OrderStatus.FILLED, self.strategy, closed=True)]),
                                            self.session.manifest)
        self.assertEqual(found["unknown_orders"], [["5"]])
        self.assertIn("positions", found)
        self.assertEqual(found["in_flight"], ["O-None"])
        self.assertNotIn("native_only", found)
        with mock.patch("engine.live_venue.time.time_ns", return_value=snapshot["observed_ns"]):
            gone = live_connection.compare(dict(snapshot, algo_orders=[]), Cache([position], [stop]), self.session.manifest)
            foreign = live_connection.compare(dict(snapshot, positions=[
                *snapshot["positions"], {"symbol": "ETHUSDT", "positionSide": "LONG", "positionAmt": "1"}]),
                Cache([position], [stop]), self.session.manifest)
        self.assertEqual(gone, {"native_only": ["71"]})
        with mock.patch("engine.live_venue.time.time_ns", return_value=snapshot["observed_ns"] + 31 * 10**9):
            slow = live_connection.compare(snapshot, Cache([position], [stop]), self.session.manifest)
        self.assertEqual(slow, {"observation": ["LIVE_OBSERVATION_STALE"]})  # read again; not a held reason
        self.assertEqual(foreign, {"foreign": ["LIVE_ACCOUNT_NOT_FLAT"]})

    def test_disconnect_closes_entries_and_a_new_or_queued_entry_ends_the_run(self):
        self.socket(SocketState.DISCONNECTED)
        self.assertFalse(live_connection.entries_open(self.session))
        self.assertFalse(self.session.stopping)
        with self.assertRaisesRegex(LiveRefusal, "LIVE_CONNECTION_UNVERIFIED"):
            live_connection.refuse(self.session, live_connection.gate_reason(self.session))
        # An entry already waiting for its account check when the gate closes never left: the run ends.
        session = live.Session(manifest(self.binding), self.session.output, "run", account_verified=True)
        session.node = mock.Mock()
        session.pending_entries.append(commands.PendingEntry(SimpleNamespace(), mock.Mock(), None))
        live_connection.close_entries(session, "disconnected")
        self.assertEqual(session.pending_entries, [])
        self.assertTrue(session.failed and session.stopping)

    def test_reconnect_starts_a_check_and_a_long_outage_is_noticed(self):
        self.socket(SocketState.DISCONNECTED, "market")
        self.socket(SocketState.DISCONNECTED, "user")
        self.socket(SocketState.CONNECTED, "market")
        self.assertEqual(set(self.session.connection.closed), {"disconnected"})  # one socket is still down
        observer = SimpleNamespace(cache=Cache())
        since = self.session.connection.disconnected["BINANCE user"]
        live_connection.tick(self.session, observer, since + 61)
        live_connection.tick(self.session, observer, since + 62)
        self.assertEqual([row["socket"] for row in self.events() if row["event"] == "connection_lost"],
                         ["BINANCE user"])  # once, for the socket still down after a minute
        self.assertIsNone(self.session.connection.observation)  # no comparison while a socket is down
        self.socket(SocketState.CONNECTED, "user")
        self.assertEqual(set(self.session.connection.closed), {"unverified"})
        self.assertFalse(self.session.connection.bar_since_reconnect)
        held = self.session.connection.closed["unverified"]
        with mock.patch.object(commands, "observe_account") as observe:
            self.session.connection.last_compare = held
            live_connection.tick(self.session, observer, held + 5)
            observe.assert_not_called()
            live_connection.tick(self.session, observer, held + 10)
            observe.assert_called_once()
        self.session.connection.observation = None
        live_connection.tick(self.session, observer, held + 601)
        self.assertEqual([row["event"] for row in self.events()].count("entries_held"), 1)

    def test_a_periodic_disagreement_closes_entries_only_when_it_repeats(self):
        self.session.connection.last_compare = 0
        with mock.patch.object(live_connection, "compare", return_value={"in_flight": ["O-1"]}):
            live_connection.judge(self.session, Cache(), dict(self.snapshot))
            self.assertTrue(live_connection.entries_open(self.session))
            self.assertTrue(self.session.connection.suspect)
            live_connection.judge(self.session, Cache(), dict(self.snapshot))
        self.assertEqual(set(self.session.connection.closed), {"unverified"})
        with mock.patch.object(commands, "observe_account") as observe:
            live_connection.tick(self.session, SimpleNamespace(cache=Cache()), 9)
            observe.assert_not_called()
            live_connection.tick(self.session, SimpleNamespace(cache=Cache()), 10)
            observe.assert_called_once()

    def test_a_missing_bar_holds_entries_closed_without_withdrawing_working_ones(self):
        self.session.cancel_entries = mock.Mock()
        minute = 60_000_000_000
        for ts in (minute, 2 * minute):
            live_connection.bar(self.session, SimpleNamespace(bar_type=BAR, ts_event=ts))
        self.assertTrue(live_connection.entries_open(self.session))
        live_connection.bar(self.session, SimpleNamespace(bar_type=BAR, ts_event=4 * minute))
        self.assertEqual(set(self.session.connection.closed), {"bars_missing"})
        self.session.cancel_entries.assert_not_called()
        # Held for the run: no comparison reopens it.
        with mock.patch.object(live_connection, "compare", return_value={}):
            self.session.connection.agreed = 1
            live_connection.judge(self.session, Cache(), dict(self.snapshot, observed_ns=10**12))
        self.assertEqual(set(self.session.connection.closed), {"bars_missing"})

    def test_an_old_connection_is_renewed_only_while_flat_and_mid_minute(self):
        observer = mock.Mock()
        observer.cache = Cache()
        self.socket(SocketState.CONNECTED, "user")
        start = self.session.connection.connected["BINANCE user"]
        old = start + live_connection.RENEW_AFTER_SECONDS
        with mock.patch.object(live_connection.time, "gmtime", return_value=SimpleNamespace(tm_sec=5)):
            live_connection.renew(self.session, observer, old)
        observer.reconnect_socket.assert_not_called()
        observer.cache = Cache(orders=[order("1")])
        with mock.patch.object(live_connection.time, "gmtime", return_value=SimpleNamespace(tm_sec=30)):
            live_connection.renew(self.session, observer, old)
            observer.reconnect_socket.assert_not_called()
            observer.cache = Cache()
            live_connection.renew(self.session, observer, old)
            live_connection.renew(self.session, observer, old + 1)  # one attempt
        observer.reconnect_socket.assert_called_once()
        self.assertEqual(observer.reconnect_socket.call_args.args[1], "user")


if __name__ == "__main__":
    unittest.main()
