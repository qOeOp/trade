"""The entry gate's scheduling and judgments (engine.live_connection), without a venue or a native node."""

from decimal import Decimal
import json
from pathlib import Path
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest import mock

from nautilus_trader.common import SocketState
from nautilus_trader.model import BarType, OrderSide, OrderStatus, OrderType, PositionSide, TimeInForce

from engine import live, live_commands as commands, live_connection, live_source
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

    def pending(self, ts_init, gtd_seconds=None, bar_type=None):
        tif = TimeInForce.GTD if gtd_seconds is not None else TimeInForce.GTC
        entry = SimpleNamespace(client_order_id="O-1", ts_init=ts_init, side=OrderSide.BUY, order_type=OrderType.LIMIT,
                                has_price=True, price="90.00", has_trigger_price=False, quantity="0.003",
                                time_in_force=tif, expire_time_ns=ts_init + (gtd_seconds or 0) * 10**9)
        return commands.PendingEntry(entry, mock.Mock(), None, bar_type)

    def test_a_closed_gate_holds_entries_only_for_recoverable_reasons(self):
        self.socket(SocketState.DISCONNECTED)
        self.assertFalse(live_connection.entries_open(self.session))
        self.assertTrue(live_connection.holdable(self.session))
        self.assertFalse(self.session.stopping)
        # An entry waiting for its account check when the gate closes is held: its check is dropped, it stays queued.
        session = live.Session(manifest(self.binding), self.session.output, "run", account_verified=True)
        session.node = mock.Mock()
        now = time.time_ns()
        queued = self.pending(now, gtd_seconds=660)
        session.pending_entries.append(queued)
        session.account_observation = observation = mock.Mock()
        live_connection.close_entries(session, "disconnected")
        observation.result.cancel.assert_called_once()
        self.assertIsNone(session.account_observation)
        self.assertEqual(session.pending_entries, [queued])
        self.assertEqual(queued.deadline_ns, now + 55 * 10**9)  # GTD 660 s: sent with 605 s left at the latest
        self.assertFalse(session.stopping)
        commands.dispatch_entry(session)  # nothing is sent and nothing ends while the gate is closed
        queued.submit.assert_not_called()
        self.assertFalse(session.stopping)
        held = [row for row in self.events() if row["event"] == "entry_held"]
        self.assertEqual((held[0]["client_order_id"], held[0]["reasons"], held[0]["side"], held[0]["type"]),
                         ("O-1", ["disconnected"], "BUY", "LIMIT"))
        # A reason no check clears refuses the held entries: the run ends, and the refusal is journaled.
        live_connection.close_entries(session, "unknown_orders")
        self.assertEqual(session.pending_entries, [])
        self.assertTrue(session.failed and session.stopping)
        refused = [row for row in self.events() if row["event"] == "entry_refused"][-1]
        self.assertEqual((refused["code"], refused["detail"]), ("LIVE_CONNECTION_UNVERIFIED", "unknown_orders"))
        self.assertIsNotNone(refused["held_ns"])
        # A new entry at a gate closed for such a reason is refused at once (engine.live_source).
        self.assertFalse(live_connection.holdable(session))
        with self.assertRaisesRegex(LiveRefusal, "LIVE_CONNECTION_UNVERIFIED"):
            live_connection.refuse(session, live_connection.gate_reason(session))

    def test_a_held_entry_ends_the_run_at_its_deadline_or_at_the_next_bar_of_its_type(self):
        self.socket(SocketState.DISCONNECTED)
        now = time.time_ns()
        entry = self.pending(now, bar_type=BAR)
        live_connection.hold(self.session, entry)
        self.assertEqual(entry.deadline_ns, now + 60 * 10**9)
        self.assertIsNone(self.session.account_observation)  # no observation while the gate is closed
        other = BarType.from_str(f"{SYMBOL}-PERP.BINANCE-1-HOUR-LAST-EXTERNAL")
        self.assertFalse(live_connection.held_bar(self.session, SimpleNamespace(bar_type=other)))
        self.assertTrue(live_connection.held_bar(self.session, SimpleNamespace(bar_type=BAR)))
        self.assertTrue(self.session.stopping and self.session.failed)
        self.assertEqual([row["detail"] for row in self.events() if row["event"] == "entry_refused"], ["entry_hold_bar"])

        session = live.Session(manifest(self.binding), self.session.output, "run", account_verified=True)
        session.node = mock.Mock()
        session.connection.closed["disconnected"] = 0.0
        live_connection.hold(session, self.pending(now))
        observer = SimpleNamespace(cache=Cache())
        with mock.patch("engine.live_connection.time.time_ns", return_value=now + 60 * 10**9):
            live_connection.tick(session, observer, 1.0)
        self.assertFalse(session.stopping)
        with mock.patch("engine.live_connection.time.time_ns", return_value=now + 60 * 10**9 + 1):
            live_connection.tick(session, observer, 2.0)
        self.assertTrue(session.stopping and session.failed)
        self.assertEqual([row["detail"] for row in self.events() if row["event"] == "entry_refused"][-1],
                         "entry_hold_expired")

    def test_the_bar_bound_ends_the_run_before_the_source_sees_the_bar(self):
        seen = []
        on_bar = live_source._gated("on_bar", lambda source, bar: seen.append((bar, self.session.deciding)))
        source = SimpleNamespace(_live=self.session)
        self.session.evidence = mock.Mock()
        bar = SimpleNamespace(bar_type=BAR)
        with mock.patch.object(live_connection, "bar"):
            on_bar(source, bar)  # the source decides on this bar: an entry it submits now carries its type
            self.assertEqual(seen, [(bar, BAR)])
            self.assertIsNone(self.session.deciding)
            self.socket(SocketState.DISCONNECTED)
            live_connection.hold(self.session, self.pending(time.time_ns(), bar_type=BAR))
            on_bar(source, bar)
        self.assertEqual(len(seen), 1)
        self.assertTrue(self.session.stopping and self.session.failed)

    def test_reopening_checks_held_entries_in_order_and_sends_by_the_deadline(self):
        session = self.session
        now = time.time_ns()
        session.connection.closed["unverified"] = 0.0
        first, second = self.pending(now), self.pending(now)
        live_connection.hold(session, first)
        live_connection.hold(session, second)
        with mock.patch.object(commands, "start_observation") as start:
            live_connection.open_entries(session)
        start.assert_called_once_with(session, "entry")  # one at a time, the head first
        live_connection.require_send_time(first)
        with mock.patch("engine.live_connection.time.time_ns", return_value=first.deadline_ns + 1):
            with self.assertRaisesRegex(LiveRefusal, "LIVE_CONNECTION_UNVERIFIED.*entry_hold_expired"):
                live_connection.require_send_time(first)
        # Every GTD entry, held or not, leaves with at least 605 s before it expires.
        with self.assertRaisesRegex(LiveRefusal, "LIVE_ORDER_UNSUPPORTED"):
            live_connection.require_send_time(self.pending(now - 56 * 10**9, gtd_seconds=660))
        live_connection.require_send_time(self.pending(now - 54 * 10**9, gtd_seconds=660))

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

    def test_a_held_start_reads_the_account_every_30_seconds_and_ends_once_it_is_flat(self):
        self.session.mode = "held"
        flat = [LiveRefusal("LIVE_ACCOUNT_NOT_FLAT", "open"), None]
        with mock.patch.object(commands, "observe_account", return_value=object()) as observe, \
                mock.patch.object(commands, "observed_account", return_value=dict(self.snapshot)), \
                mock.patch("engine.live_venue.require_flat", side_effect=flat):
            for now in (0, 1, 10, 30, 31):
                live_connection.held_tick(self.session, now)
        self.assertEqual(observe.call_count, 2)  # at 0 and at 30; each read is judged on the next tick
        self.assertTrue(self.session.held_flat)
        self.assertTrue(self.session.stopping)
        self.assertEqual([row["reason"] for row in self.events() if row["event"] == "stopping"], ["held_flat"])
        flat_event = next(row for row in self.events() if row["event"] == "venue_flat_while_held")
        self.assertTrue((self.session.output / flat_event["observation"]).exists())

    def test_a_resumed_run_counts_its_duration_from_its_first_arming(self):
        import time
        self.session.started = time.monotonic()  # this start began just now
        self.session.armed_ns = time.time_ns() - 3599 * 10**9
        self.assertFalse(self.session.observe_stop_intent())
        self.session.armed_ns -= 2 * 10**9
        self.assertTrue(self.session.observe_stop_intent())
        self.assertEqual([row["reason"] for row in self.events() if row["event"] == "stopping"], ["duration"])
        self.session.manifest["config"]["duration_seconds"] = None  # until stopped
        fresh = live.Session(self.session.manifest, self.session.output, "run", account_verified=True)
        fresh.armed_ns = 0
        self.assertFalse(fresh.observe_stop_intent())

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
