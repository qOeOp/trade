"""The entry gate's scheduling and judgments (engine.live_connection), without a venue or a native node."""

from concurrent.futures import Future
from decimal import Decimal
import json
from pathlib import Path
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest import mock

from nautilus_trader.common import SocketState
from nautilus_trader.model import BarType, InstrumentId, OrderSide, OrderStatus, OrderType, PositionSide, TimeInForce

from engine import live, live_commands as commands, live_connection, live_source, live_venue
from engine.live_errors import LiveRefusal
from engine.live_records import strategy_ids
from tests.engine.test_live_venue import ERROR_ANSWER, answering_200, fixture, venue_clock
from tests.helpers import refused

SYMBOL = "BTCUSDT"
BAR = BarType.from_str(f"{SYMBOL}-PERP.BINANCE-1-MINUTE-LAST-EXTERNAL")


def manifest(binding: str) -> dict:
    return {"run_id": "gate", "symbols": [SYMBOL], "account_id": "BINANCE-001", "trader_id": "LIVE-001",
            "credential_binding": binding, "source": {"source_sha256": "0" * 64},
            "config": {"environment": "live", "duration_seconds": 3600, "leverage": "50", "drawdown_brake": "0.15"}}


class Cache:
    def __init__(self, positions=(), orders=()):
        self._positions, self._orders = list(positions), list(orders)

    def positions_open(self, instrument_id=None, **_):
        return list(self._positions)

    def orders(self, instrument_id=None, **_):
        return list(self._orders)


def order(venue_id, status=OrderStatus.ACCEPTED, strategy=None, closed=False, former=()):
    ids = [*former, *([] if venue_id is None else [venue_id])]
    return SimpleNamespace(venue_order_id=venue_id, venue_order_ids=ids, status=status, is_closed=closed, client_order_id="O-" + str(venue_id),
                           strategy_id=strategy)


class GateTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.snapshot, _ = fixture()
        self.snapshot["clock"] = venue_clock()  # a comparison's read bounds the clock too
        self.binding = self.snapshot["credential_binding"]
        self.session = live.Session(manifest(self.binding), Path(self.temp.name), "run", account_verified=True)
        self.session.node = mock.Mock()
        self.strategy = strategy_ids(self.session.manifest)[SYMBOL]

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
        self.assertEqual(found["unknown_orders"], {SYMBOL: [["5"]]})  # by contract: each is canceled on its own
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

    def test_an_order_of_the_run_that_changed_after_the_read_is_not_unknown(self):
        self.session.sources = {SYMBOL: mock.Mock()}
        self.session.cancel_entries = mock.Mock()
        entry = order(None, OrderStatus.SUBMITTED, self.strategy)
        entry.client_order_id = "6ba7b810-9dad-41d1-80b4-00c04fd430c8"
        row = {"symbol": SYMBOL, "orderId": 9}
        flying = {"in_flight": ["O-9"]}
        for name, held, at_venue, found in (
                ("canceled", order("9", OrderStatus.CANCELED, closed=True), row, {"stale_orders": {SYMBOL: [["9"]]}}),
                ("filled", order("9", OrderStatus.FILLED, closed=True), row, {"stale_orders": {SYMBOL: [["9"]]}}),
                ("filled under its triggered ID", order("12", OrderStatus.FILLED, closed=True, former=["9"]),
                 {"symbol": SYMBOL, "algoId": 9}, {"stale_orders": {SYMBOL: [["9"]]}}),
                ("working under a new ID", order("12", former=["9"], strategy=self.strategy), row,
                 {"stale_orders": {SYMBOL: [["9"]]}, "native_only": ["12"]}),
                ("being canceled", order("9", OrderStatus.PENDING_CANCEL), row, flying),
                ("being updated", order("9", OrderStatus.PENDING_UPDATE), row, flying),
                ("submitted, not yet acknowledged", entry,
                 dict(row, clientOrderId=live_venue.wire_id(entry.client_order_id)),
                 {"in_flight": [entry.client_order_id]})):
            with self.subTest(name), mock.patch.object(live_connection.Strategy, "cancel_all_orders") as cancel_all, \
                    mock.patch("engine.live_venue.time.time_ns", return_value=self.snapshot["observed_ns"]):
                self.session.connection = live_connection.Connection()
                snapshot = dict(self.snapshot, orders=[at_venue] if "orderId" in at_venue else [],
                                algo_orders=[] if "orderId" in at_venue else [at_venue])
                self.assertEqual(live_connection.compare(snapshot, Cache([], [held]), self.session.manifest), found)
                live_connection.judge(self.session, Cache([], [held]), snapshot)
                cancel_all.assert_not_called()
                self.assertEqual(self.session.connection.closed, {})
                self.assertTrue(self.session.connection.suspect)
                # Read again, still at Binance: an in-flight one only closes entries until it settles.
                live_connection.judge(self.session, Cache([], [held]), snapshot)
                self.assertEqual(cancel_all.called, "stale_orders" in found)
                self.assertEqual(set(self.session.connection.closed),
                                 {"unknown_orders" if "stale_orders" in found else "unverified"})
                # Control: an order the cache does not hold is canceled at the first read, beside such a one.
                self.session.connection = live_connection.Connection()
                cancel_all.reset_mock()
                live_connection.judge(self.session, Cache([], [held]), dict(
                    snapshot, orders=[*snapshot["orders"], {"symbol": SYMBOL, "orderId": 5, "clientOrderId": "web_5"}]))
                cancel_all.assert_called_once()
                self.assertEqual(self.events()[-1]["orders"], {SYMBOL: [["5"]]})
                self.assertEqual(self.session.connection.suspect, "stale_orders" in found)  # read again soon

    def test_a_stale_order_must_show_in_two_reads_running_and_a_rejected_one_is_unknown_at_once(self):
        self.session.sources = {SYMBOL: mock.Mock()}
        self.session.cancel_entries = mock.Mock()
        closed = [order(number, OrderStatus.CANCELED, closed=True) for number in ("8", "9")]
        with mock.patch.object(live_connection.Strategy, "cancel_all_orders") as cancel_all, \
                mock.patch("engine.live_venue.time.time_ns", return_value=self.snapshot["observed_ns"]):
            for number in ("8", "9", None, "8"):  # another order each time, or gone between
                live_connection.judge(self.session, Cache([], closed), dict(
                    self.snapshot, orders=[{"symbol": SYMBOL, "orderId": number}] if number else []))
            cancel_all.assert_not_called()
            # An incomplete read says nothing: the next complete one still settles it.
            live_connection.judge(self.session, Cache([], closed), dict(self.snapshot, orders=[{}]))
            live_connection.judge(self.session, Cache([], closed), dict(
                self.snapshot, orders=[{"symbol": SYMBOL, "orderId": "8"}]))
            cancel_all.assert_called_once()
            self.session.connection = live_connection.Connection()
            rejected = order(None, OrderStatus.REJECTED, closed=True)  # never acknowledged, judged rejected locally
            rejected.client_order_id = "6ba7b810-9dad-41d1-80b4-00c04fd430c8"
            live_connection.judge(self.session, Cache([], [rejected]), dict(self.snapshot, orders=[
                {"symbol": SYMBOL, "orderId": 9, "clientOrderId": live_venue.wire_id(rejected.client_order_id)}]))
            self.assertEqual(cancel_all.call_count, 2)

    def pending(self, ts_init, gtd_seconds=None, bar_type=None):
        tif = TimeInForce.GTD if gtd_seconds is not None else TimeInForce.GTC
        expires = ts_init + (gtd_seconds or 0) * 10**9  # a LimitOrder has both; every other order type, expire_time only
        entry = SimpleNamespace(client_order_id="O-1", ts_init=ts_init, side=OrderSide.BUY, order_type=OrderType.LIMIT,
                                has_price=True, price="90.00", has_trigger_price=False, quantity="0.003",
                                time_in_force=tif, expire_time_ns=expires, expire_time=expires,
                                instrument_id=BAR.instrument_id)
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
        self.assertFalse(live_connection.holdable(session) or live_connection.deniable(session))

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
        with mock.patch.object(live_connection, "bar", return_value=False):
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
        # A whole number: the check is due exactly COMPARE_RETRY_SECONDS later, and adding and subtracting 10 from an
        # arbitrary float (the host's uptime) can land below 10.
        with mock.patch.object(live_connection.time, "monotonic", return_value=1000.0):
            self.socket(SocketState.CONNECTED, "user")
        self.assertEqual(set(self.session.connection.closed), {"unverified"})
        self.assertFalse(self.session.connection.bar_since_reconnect)
        held = self.session.connection.closed["unverified"]
        self.assertEqual(held, 1000.0)
        with mock.patch.object(commands, "observe_account") as observe:
            self.session.connection.last_compare = held
            live_connection.tick(self.session, observer, held + 5)
            observe.assert_not_called()
            live_connection.tick(self.session, observer, held + 10)
            observe.assert_called_once()
        self.session.connection.observation = None
        live_connection.tick(self.session, observer, held + 601)
        self.assertEqual([row["event"] for row in self.events()].count("entries_held"), 1)

    def test_a_contract_not_trading_is_read_every_minute_and_reopens_after_two_agreeing_reads(self):
        def read(status, observed_ns):
            snapshot = json.loads(json.dumps(self.snapshot))
            snapshot["symbols"][SYMBOL]["instrument"]["status"] = status
            return dict(snapshot, observed_ns=observed_ns)
        state = self.session.connection
        with mock.patch.object(live_connection, "compare", return_value={}):
            for snapshot in (read("not a status", 0), dict(self.snapshot, symbols={}), read("SETTLING", 1),
                             read("SETTLING", 2)):
                live_connection.judge(self.session, Cache(), snapshot)
            self.assertEqual((set(state.closed), set(state.halted)), (set(), {SYMBOL}))
            self.assertFalse(live_connection.entries_open(self.session, SYMBOL))
            self.assertTrue(live_connection.entries_open(self.session, "ETHUSDT"))  # that contract alone
            self.assertEqual([(row["symbol"], row["status"]) for row in self.events() if row["event"] == "entries_closed"],
                             [(SYMBOL, "SETTLING")])
            state.last_compare = 0
            with mock.patch.object(commands, "observe_account") as observe:
                live_connection.tick(self.session, SimpleNamespace(cache=Cache()), 59)
                observe.assert_not_called()
                live_connection.tick(self.session, SimpleNamespace(cache=Cache()), 60)
                observe.assert_called_once()
            state.observation = None
            live_connection.judge(self.session, Cache(), read("TRADING", 10 * 10**9))
            self.assertEqual(set(state.closed), {"unverified"})  # the check that follows a reconnect
            live_connection.judge(self.session, Cache(), read("TRADING", 41 * 10**9))
        self.assertTrue(live_connection.entries_open(self.session))
        self.assertEqual([row["event"] for row in self.events() if row["event"].startswith("entries_")],
                         ["entries_closed", "entries_checking", "entries_opened"])

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
                mock.patch.object(live_connection, "require_flat", side_effect=flat):
            for now in (0, 1, 10, 30, 31):
                live_connection.held_tick(self.session, now)
        self.assertEqual(observe.call_count, 2)  # at 0 and at 30; each read is judged on the next tick
        self.assertTrue(self.session.held_flat)
        self.assertTrue(self.session.stopping)
        self.assertEqual([row["reason"] for row in self.events() if row["event"] == "stopping"], ["held_flat"])
        flat_event = next(row for row in self.events() if row["event"] == "venue_flat_while_held")
        self.assertTrue((self.session.output / flat_event["observation"]).exists())

    def held(self, positions=(("LONG", "0.002"),), orders=(), algos=()):
        """An account read of a held run: Binance's Hedge rows for SYMBOL."""
        return dict(self.snapshot, orders=[{"symbol": SYMBOL, **row} for row in orders],
                    algo_orders=[{"symbol": SYMBOL, **row} for row in algos],
                    positions=[{"symbol": SYMBOL, "positionSide": side, "positionAmt": amount}
                               for side, amount in positions])

    def test_a_held_read_compares_each_side_with_the_stops_that_close_it(self):
        """20261114-24: a position is covered by the stops at Binance that close its side, of at least its size."""
        stop = {"algoId": 7, "type": "STOP_MARKET", "side": "SELL", "positionSide": "LONG", "quantity": "0.002"}
        covered = {"holding": 1, "positions": [], "entries": []}
        self.assertEqual(live_connection.held_cover(self.held(algos=[stop])), covered)
        # Binance's own documents name a conditional order's type `orderType`; rc7's fixture of the same rows, `type`.
        renamed = {key if key != "type" else "orderType": value for key, value in stop.items()}
        self.assertEqual(live_connection.held_cover(self.held(algos=[renamed])), covered)
        # A regular stop-limit counts by what is left of it, and one that closes the whole position by the position.
        limit = {"orderId": 8, "type": "STOP", "side": "SELL", "positionSide": "LONG", "origQty": "0.003",
                 "executedQty": "0.001"}
        self.assertEqual(live_connection.held_cover(self.held(orders=[limit])), covered)
        whole = dict(stop, quantity="0", closePosition=True)
        self.assertEqual(live_connection.held_cover(self.held(algos=[whole])), covered)

        def short(**changed):
            return live_connection.held_cover(self.held(algos=[dict(stop, **changed)]))["positions"]

        bare = [{"symbol": SYMBOL, "side": "LONG", "position": "0.002", "stops": "0"}]
        self.assertEqual(live_connection.held_cover(self.held())["positions"], bare)  # no order at all
        self.assertEqual(short(quantity="0.001"), [dict(bare[0], stops="0.001")])  # less than the position
        self.assertEqual(short(type="TAKE_PROFIT_MARKET"), bare)  # a take-profit protects nothing
        self.assertEqual(short(positionSide="SHORT", side="BUY"), bare)  # the other side's stop
        # Each side by itself: the SHORT's stop buys.
        both = self.held(positions=(("LONG", "0.002"), ("SHORT", "-0.004")), algos=[
            stop, {"algoId": 9, "type": "STOP_MARKET", "side": "BUY", "positionSide": "SHORT", "quantity": "0.003"}])
        self.assertEqual(live_connection.held_cover(both), {"holding": 2, "entries": [], "positions": [
            {"symbol": SYMBOL, "side": "SHORT", "position": "0.004", "stops": "0.003"}]})
        # An order that opens or adds is an entry no stop stands behind; only orders left is no position to cover.
        entry = {"orderId": 5, "type": "LIMIT", "side": "BUY", "positionSide": "LONG", "origQty": "0.001",
                 "executedQty": "0"}
        self.assertEqual(live_connection.held_cover(self.held(orders=[entry], algos=[stop])),
                         {"holding": 1, "positions": [], "entries": [{"symbol": SYMBOL, "side": "LONG"}]})
        self.assertEqual(live_connection.held_cover(self.held(positions=(), algos=[stop])),
                         {"holding": 0, "positions": [], "entries": []})
        caught = refused(live_connection.held_cover, self.held(algos=[{"algoId": 7}]), error=LiveRefusal)
        self.assertEqual(caught.code, "LIVE_ACCOUNT_RESPONSE")

    def test_a_held_start_journals_its_verdict_once_per_change(self):
        self.session.mode = "held"
        stop = {"algoId": 7, "type": "STOP_MARKET", "side": "SELL", "positionSide": "LONG", "quantity": "0.002"}
        entry = {"orderId": 5, "type": "LIMIT", "side": "BUY", "positionSide": "LONG", "origQty": "0.001"}

        def verdicts():
            return [(row["event"], row.get("positions"), row.get("entries"), row.get("entries_kept"),
                     row.get("unreadable")) for row in self.events() if row["event"].startswith("held_")]

        bare = [{"symbol": SYMBOL, "side": "LONG", "position": "0.002", "stops": "0"}]
        live_connection.held_verdict(self.session, self.held(), "preflight-1.json")
        live_connection.held_verdict(self.session, self.held())  # the same verdict again: nothing new
        self.assertEqual(verdicts(), [("held_uncovered", bare, [], False, False)])
        self.assertEqual(self.events()[-1]["observation"], "preflight-1.json")
        live_connection.held_verdict(self.session, self.held(algos=[stop]))
        self.assertEqual(verdicts()[-1], ("held_covered", None, None, None, None))
        self.assertEqual(self.events()[-1]["holding"], 1)
        self.assertTrue((self.session.output / self.events()[-1]["observation"]).exists())  # the read is kept
        # An inherited entry is reported; a read begun after its cancel was asked for that still shows it says so.
        working = self.held(orders=[entry], algos=[stop])
        live_connection.held_verdict(self.session, working)
        self.assertEqual(verdicts()[-1], ("held_uncovered", [], [{"symbol": SYMBOL, "side": "LONG"}], False, False))
        self.session.connection.withdrawn_ns = working["observed_ns"] - 1
        live_connection.held_verdict(self.session, working)
        self.assertEqual(verdicts()[-1], ("held_uncovered", [], [{"symbol": SYMBOL, "side": "LONG"}], True, False))
        # An answer whose rows cannot be judged shows no stop either.
        live_connection.held_verdict(self.session, self.held(algos=[{"algoId": 7}]))
        self.assertEqual(verdicts()[-1], ("held_uncovered", [], [], False, True))
        self.assertEqual(len(verdicts()), 5)

    def test_a_held_start_withdraws_the_entries_it_inherited_and_keeps_the_stops(self):
        self.session.mode = "held"
        keeper = mock.Mock()
        self.session.keepers = {SYMBOL: keeper}
        entry = SimpleNamespace(client_order_id="O-entry", strategy_id=self.strategy, is_closed=False,
                                is_reduce_only=False, status=OrderStatus.ACCEPTED)
        stop = SimpleNamespace(client_order_id="O-stop", strategy_id=self.strategy, is_closed=False,
                               is_reduce_only=True, status=OrderStatus.ACCEPTED)
        cache = Cache(orders=[entry, stop])
        self.assertIsNone(self.session.connection.withdrawn_ns)
        for now in (100.0, 101.0, 104.0):  # asked once; again only after the usual interval
            live_connection.held_withdraw(self.session, cache, now)
        keeper.cancel_order.assert_called_once_with("O-entry")
        self.assertIsNotNone(self.session.connection.withdrawn_ns)
        live_connection.held_withdraw(self.session, cache, 106.0)
        self.assertEqual(keeper.cancel_order.call_count, 2)
        asked = [(row["reason"], row["client_order_id"]) for row in self.events()
                 if row["event"] == "entry_cancel_requested"]
        self.assertEqual(asked, [("held", "O-entry")])
        # A request that raises is journalled once and asked again; the hold goes on.
        other = SimpleNamespace(**{**vars(entry), "client_order_id": "O-other"})
        keeper.cancel_order.side_effect = RuntimeError("no route")
        live_connection.held_withdraw(self.session, Cache(orders=[other]), 200.0)
        live_connection.held_withdraw(self.session, Cache(orders=[other]), 206.0)
        failed = [(row["reason"], row["client_order_id"], row["failure_type"]) for row in self.events()
                  if row["event"] == "entry_cancel_failed"]
        self.assertEqual(failed, [("held", "O-other", "RuntimeError")])
        self.assertFalse(self.session.stopping)

    def test_a_held_read_that_is_not_flat_is_judged_and_a_failed_read_is_not(self):
        self.session.mode = "held"
        reads = [self.held(), LiveRefusal("LIVE_ACCOUNT_UNAVAILABLE", "HTTP 503"), self.held()]
        with mock.patch.object(commands, "observe_account", return_value=object()), \
                mock.patch.object(commands, "observed_account", side_effect=reads):
            for now in (0, 1, 30, 31, 60, 61):
                live_connection.held_tick(self.session, now)
        self.assertEqual([row["event"] for row in self.events() if row["event"].startswith("held_")],
                         ["held_uncovered"])
        self.assertFalse(self.session.held_flat)

    def test_an_answer_of_the_wrong_shape_is_a_read_to_take_again_for_the_comparison_and_the_hold(self):
        """20261114-29: HTTP 200 without the field read raised KeyError past both, into the Observer's own failure
        path, which stops the node and closes nothing."""
        state = self.session.connection
        for wrong in ({"server_time": ERROR_ANSWER}, {"exchange_info": ERROR_ANSWER}):
            with self.subTest(wrong=sorted(wrong)):
                self.session.account_reader = answering_200(**wrong)
                state.last_compare = 0
                live_connection.tick(self.session, SimpleNamespace(cache=Cache()), 1000)
                state.observation.result.exception(timeout=2)
                live_connection.tick(self.session, SimpleNamespace(cache=Cache()), 1001)
                self.assertEqual((self.events()[-1]["event"], self.events()[-1]["found"]),
                                 ("comparison", {"observation": ["LIVE_ACCOUNT_RESPONSE"]}))
                self.assertIsNone(state.observation)
        self.session.mode, state.last_compare = "held", None
        live_connection.held_tick(self.session, 0)  # no clock: the signed requests' own reading of the time
        state.observation.result.exception(timeout=2)
        live_connection.held_tick(self.session, 1)
        self.assertIsNone(state.observation)
        self.assertFalse(self.session.stopping or self.session.failed)

    def phantom_position(self):
        return SimpleNamespace(strategy_id=self.strategy, side=PositionSide.LONG, id="P-1", is_open=True,
                               quantity=SimpleNamespace(as_decimal=lambda: Decimal("0.002")))

    def test_binances_positions_are_compared_with_the_instances_own_in_the_cache(self):
        """20261114-25: the difference an entry's read and the periodic comparison both judge."""
        held = [{"symbol": SYMBOL, "positionSide": "LONG", "positionAmt": "0.002"},
                {"symbol": SYMBOL, "positionSide": "SHORT", "positionAmt": "0"},
                {"symbol": "ETHUSDT", "positionSide": "LONG", "positionAmt": "1"}]  # outside the run: not judged here
        manifest, cache = self.session.manifest, Cache([self.phantom_position()])
        self.assertEqual(live_connection.position_differences(dict(self.snapshot, positions=held), cache, manifest), [])
        gone = live_connection.position_differences(dict(self.snapshot, positions=[]), cache, manifest)
        self.assertEqual(gone, [{"symbol": SYMBOL, "venue": {"LONG": "0", "SHORT": "0"},
                                 "native": {"LONG": "0.002", "SHORT": "0"}}])
        other = SimpleNamespace(**{**vars(self.phantom_position()), "strategy_id": "EXTERNAL"})
        self.assertEqual(live_connection.position_differences(dict(self.snapshot, positions=[]), Cache([other]),
                                                              manifest), [])  # not the instance's own: `foreign`
        with self.assertRaises(KeyError):
            live_connection.position_differences(dict(self.snapshot, positions=[{"symbol": SYMBOL}]), cache, manifest)

    def test_a_phantom_is_a_cache_position_while_binance_holds_nothing_at_all(self):
        cache = Cache([self.phantom_position()])
        self.assertTrue(live_connection.phantom(self.session, cache, dict(self.snapshot)))
        self.assertFalse(live_connection.phantom(self.session, Cache(), dict(self.snapshot)))
        left = dict(self.snapshot, algo_orders=[{"symbol": SYMBOL, "algoId": 7}])  # a stop left behind: not flat
        self.assertFalse(live_connection.phantom(self.session, cache, left))
        elsewhere = dict(self.snapshot, positions=[{"symbol": "ETHUSDT", "positionSide": "LONG", "positionAmt": "1"}])
        self.assertFalse(live_connection.phantom(self.session, cache, elsewhere))

    def test_two_comparisons_a_position_check_apart_end_a_run_on_a_phantom_and_one_does_not(self):
        cache = Cache([self.phantom_position()])
        self.session.connection.last_compare = 0

        def read(seconds):
            return dict(self.snapshot, observed_ns=self.snapshot["observed_ns"] + seconds * 10**9)

        with mock.patch("engine.live_venue.time.time_ns", side_effect=lambda: self.snapshot["observed_ns"]), \
                mock.patch.object(live_connection, "require_clock"):
            live_connection.judge(self.session, cache, read(0))
            self.assertFalse(self.session.venue_flat)
            live_connection.judge(self.session, cache, read(10))  # too soon: a fill in flight could still explain it
            self.assertFalse(self.session.venue_flat or self.session.stopping)
            live_connection.judge(self.session, Cache(), read(20))  # the cache caught up: nothing was wrong
            self.assertIsNone(self.session.connection.phantom_ns)
            live_connection.judge(self.session, cache, read(30))
            live_connection.judge(self.session, cache, read(61))
        self.assertTrue(self.session.venue_flat and self.session.stopping and not self.session.failed)
        ended = [row for row in self.events() if row["event"] in ("venue_flat", "stopping")]
        self.assertEqual([(row["event"], row.get("reason")) for row in ended],
                         [("venue_flat", None), ("stopping", "venue_flat")])
        self.assertTrue((self.session.output / ended[0]["observation"]).name.startswith("final-account-"))

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

    def gap(self):
        self.session.cancel_entries = mock.Mock()
        minute = 60_000_000_000
        for ts in (minute, 2 * minute):
            live_connection.bar(self.session, SimpleNamespace(bar_type=BAR, ts_event=ts))
        self.assertTrue(live_connection.entries_open(self.session))
        live_connection.bar(self.session, SimpleNamespace(bar_type=BAR, ts_event=4 * minute))

    def agree_twice(self, cache, found=None):
        with mock.patch.object(live_connection, "compare", return_value=found or {}):
            for observed in (10**12, 10**12 + 31 * 10**9):
                live_connection.judge(self.session, cache, dict(self.snapshot, observed_ns=observed))

    def test_a_missing_bar_withdraws_working_entries_and_never_reopens_them(self):
        self.gap()
        self.assertEqual(set(self.session.connection.closed), {"bars_missing"})
        self.session.cancel_entries.assert_called_once_with("bars_missing")  # a fill is still protected now
        position = SimpleNamespace(strategy_id=self.strategy, is_open=True)
        self.agree_twice(Cache(positions=[position]))  # agreeing reads with a position open: no restart
        self.assertEqual(set(self.session.connection.closed), {"bars_missing"})
        self.assertFalse(self.session.stopping)

    def test_an_aggregated_bar_delivered_long_after_its_bucket_closes_entries(self):
        # Re-judge C-142 (doctor 20261114-30): rc7 closes a time bar on a monotonic timer, so after a host sleep or VM
        # pause every later bar comes late; the source would decide on stale buckets.
        self.session.cancel_entries = mock.Mock()
        hour = 3_600_000_000_000
        kind = BarType.from_str(f"{SYMBOL}-PERP.BINANCE-1-HOUR-LAST-INTERNAL")
        stamped = 10 * hour + live_connection.history.BUILD_DELAY_US * 1000  # rc7 stamps the build delay after the end
        for now in (stamped + 40_000_000, 10 * hour + live_connection.history.AGGREGATE_LATE_NS):
            with mock.patch.object(live_connection.time, "time_ns", return_value=now):
                live_connection.bar(self.session, SimpleNamespace(bar_type=kind, ts_event=stamped))
            self.assertTrue(live_connection.entries_open(self.session), now)  # on time, or not yet late
        with mock.patch.object(live_connection.time, "time_ns", return_value=10 * hour + live_connection.history.AGGREGATE_LATE_NS + 1):
            live_connection.bar(self.session, SimpleNamespace(bar_type=kind, ts_event=stamped))
        self.assertEqual(set(self.session.connection.closed), {"bars_missing"})
        self.session.cancel_entries.assert_called_once_with("bars_missing")
        late = [row for row in self.events() if row["event"] == "entries_closed"]
        self.assertEqual([(row["bar_type"], row["received_ns"]) for row in late], [(str(kind), stamped)])

    def test_a_drifted_aggregated_bar_is_late_by_its_bucket_not_its_stamp(self):
        # After a pause the timer itself slips: the stamp moves off the bucket end with it.
        self.session.cancel_entries = mock.Mock()
        minute = 60_000_000_000
        kind = BarType.from_str(f"{SYMBOL}-PERP.BINANCE-15-MINUTE-LAST-INTERNAL")
        stamped = 60 * minute + 2 * minute  # 2 minutes past the 01:00 bucket end, delivered as soon as built
        with mock.patch.object(live_connection.time, "time_ns", return_value=stamped):
            live_connection.bar(self.session, SimpleNamespace(bar_type=kind, ts_event=stamped))
        self.assertEqual(set(self.session.connection.closed), {"bars_missing"})

    def test_a_flat_run_starts_again_to_warm_up_after_two_agreeing_reads_since_the_gap(self):
        self.gap()
        cache = Cache()
        self.assertTrue(live_connection.rewarm_pending(self.session, cache))
        with mock.patch.object(commands, "observe_account") as observe:
            self.session.connection.last_compare = 0
            live_connection.tick(self.session, SimpleNamespace(cache=cache), 10)
            observe.assert_called_once()  # flat: the check runs at once, as for a reconnect
        self.session.connection.observation = None
        with mock.patch.object(live_connection, "compare", return_value={}):
            live_connection.judge(self.session, cache, dict(self.snapshot, observed_ns=10**12))
        self.assertFalse(self.session.stopping)  # one read is not enough
        with mock.patch.object(live_connection, "compare", return_value={}):
            live_connection.judge(self.session, cache, dict(self.snapshot, observed_ns=10**12 + 31 * 10**9))
        self.assertTrue(self.session.rewarming and self.session.stopping)
        self.assertFalse(self.session.failed)
        self.assertEqual([row["reason"] for row in self.events() if row["event"] == "stopping"], ["rewarming"])
        self.assertFalse(any(row["event"] == "entries_opened" for row in self.events()))

    def test_an_order_the_cache_does_not_know_keeps_the_run_from_starting_again(self):
        self.gap()
        self.session.sources = {SYMBOL: mock.Mock()}
        with mock.patch.object(live_connection.Strategy, "cancel_all_orders") as cancel_all:
            self.agree_twice(Cache(), {"unknown_orders": {SYMBOL: [["V-9"]]}})
        cancel_all.assert_called()  # the existing path: every order on the contract goes
        self.assertEqual(set(self.session.connection.closed), {"bars_missing", "unknown_orders"})
        self.assertFalse(live_connection.rewarm_pending(self.session, Cache()))
        self.assertFalse(self.session.stopping)

    def test_only_a_flat_strategy_waits_to_warm_up_and_only_for_reasons_a_restart_clears(self):
        self.gap()
        open_order = order(1, strategy=self.strategy)
        self.assertFalse(live_connection.rewarm_pending(self.session, Cache(orders=[open_order])))
        self.assertTrue(live_connection.rewarm_pending(self.session, Cache(orders=[order(2, closed=True)])))
        self.session.connection.closed["unverified"] = 0.0
        self.assertTrue(live_connection.rewarm_pending(self.session, Cache()))
        self.session.connection.closed["foreign"] = 0.0
        self.assertFalse(live_connection.rewarm_pending(self.session, Cache()))

    def test_a_flat_source_sees_no_bar_after_the_gap_and_one_with_a_position_does(self):
        seen = []
        on_bar = live_source._gated("on_bar", lambda source, bar: seen.append(bar))
        source = SimpleNamespace(_live=self.session)
        self.session.evidence = mock.Mock()
        self.gap()
        bar = SimpleNamespace(bar_type=BAR, ts_event=5 * 60_000_000_000)
        with mock.patch.object(live_source, "native_cache", return_value=Cache()):
            on_bar(source, bar)
        self.assertEqual(seen, [])
        self.session.evidence.market.assert_called_once_with("bar", bar)  # still in the evidence pack
        held = Cache(positions=[SimpleNamespace(strategy_id=self.strategy, is_open=True)])
        with mock.patch.object(live_source, "native_cache", return_value=held):
            on_bar(source, SimpleNamespace(bar_type=BAR, ts_event=6 * 60_000_000_000))
        self.assertEqual(len(seen), 1)  # its exits are managed as before

    def test_a_repeated_or_revised_bar_never_reaches_the_source_twice(self):
        # Binance may push a closed kline again (audit loopback s10_dup_live): the source would decide twice on one bar.
        seen = []
        on_bar = live_source._gated("on_bar", lambda source, bar: seen.append(bar))
        source = SimpleNamespace(_live=self.session)
        self.session.evidence = mock.Mock()
        minute = 60_000_000_000
        first = SimpleNamespace(bar_type=BAR, ts_event=minute)
        with mock.patch.object(live_source, "native_cache", return_value=Cache()):
            on_bar(source, first)
            on_bar(source, SimpleNamespace(bar_type=BAR, ts_event=minute))  # the same bar again, revised or not
            on_bar(source, SimpleNamespace(bar_type=BAR, ts_event=0))  # an earlier one
            on_bar(source, SimpleNamespace(bar_type=BAR, ts_event=2 * minute))
        self.assertEqual([bar.ts_event for bar in seen], [minute, 2 * minute])
        self.assertEqual(self.session.evidence.market.call_count, 4)  # every bar Binance sent stays in the evidence pack
        self.assertEqual([(row["received_ns"], row["after_ns"]) for row in self.events() if row["event"] == "bar_repeated"],
                         [(minute, minute), (0, minute)])
        self.assertEqual(self.session.connection.closed, {})  # neither a gap nor a reason to close entries

    def test_a_stop_closes_only_what_binance_still_holds_of_each_leg(self):
        # Re-judge C-140 (doctor 20261114-25): a leg closed outside the run stays open in the native cache; a close of
        # it from there is rejected and the run ended unresolved with the orphan stop left at Binance.
        from nautilus_trader.model import Quantity
        from engine import live_lifecycle
        iid = InstrumentId.from_str(f"{SYMBOL}-PERP.BINANCE")
        owner = mock.Mock()
        self.session.owner = mock.Mock(return_value=owner)

        def position(key, side, quantity):
            return SimpleNamespace(id=key, strategy_id=self.strategy, instrument_id=iid, side=side,
                                   quantity=Quantity.from_str(quantity))
        a, b, c = position("A", PositionSide.LONG, "0.002"), position("B", PositionSide.LONG, "0.003"), \
            position("C", PositionSide.SHORT, "0.001")
        read = {"positions": [{"symbol": SYMBOL, "positionSide": "LONG", "positionAmt": "0.004"},
                              {"symbol": SYMBOL, "positionSide": "SHORT", "positionAmt": "0"}]}
        self.session.account_observation = SimpleNamespace(purpose="stop", deadline=time.monotonic() + 30,
                                                           result=SimpleNamespace(done=lambda: True, result=lambda: read,
                                                                                  cancel=lambda: None))
        held = live_lifecycle.venue_held(self.session, [a, b, c])
        self.assertEqual(held, {"A": Decimal("0.002"), "B": Decimal("0.002"), "C": Decimal(0)})
        for found in (a, b, c):
            live_lifecycle.close_held(self.session, found, held)
        owner.close_position.assert_called_once_with(a, reduce_only=True)  # held in full
        (order,), kwargs = owner.submit_order.call_args  # B: only the 0.002 Binance holds
        self.assertEqual((owner.order_factory.market.call_args.args[1:], kwargs["position_id"]),
                         ((OrderSide.SELL, Quantity.from_str("0.002")), "B"))
        self.assertEqual(self.session.phantoms, {"B": Decimal("0.001"), "C": Decimal("0.001")})  # C: nothing to send
        self.assertEqual([(row["position_id"], row["venue"]) for row in self.events() if row["event"] == "venue_closed"],
                         [("B", "0.002"), ("C", "0")])

    def test_a_stop_waits_for_the_close_of_what_binance_still_held(self):
        # #3653: the position was counted as gone with its close just sent, so the run ended venue_flat at once, or the
        # next tick cancelled that close.
        from nautilus_trader.model import Quantity
        from engine import live_lifecycle
        for resting in (False, True):
            with self.subTest(resting=resting):
                (self.session.output / "events.jsonl").unlink(missing_ok=True)
                session = live.Session(self.session.manifest, self.session.output, "run", account_verified=True)
                session.node, owner = mock.Mock(), mock.Mock()
                session.sources = {SYMBOL: owner}
                session.begin_stop("requested")
                position = SimpleNamespace(id="P", strategy_id=self.strategy, side=PositionSide.LONG,
                                           instrument_id=InstrumentId.from_str(f"{SYMBOL}-PERP.BINANCE"),
                                           quantity=Quantity.from_str("0.003"))

                def working(name, kind):
                    return SimpleNamespace(client_order_id=name, strategy_id=self.strategy, is_reduce_only=True,
                                           is_closed=False, status=OrderStatus.ACCEPTED, order_type=kind)
                stop, close = working("stop", OrderType.STOP_MARKET), working("close", OrderType.MARKET)
                orders = [stop] if resting else []
                cache = mock.Mock(positions_open=lambda **_: [position], orders=lambda **_: orders,
                                  orders_inflight=lambda **_: [], orders_active_local=lambda **_: [])
                read = {"observed_ns": 1, "positions": [
                    {"symbol": SYMBOL, "positionSide": "LONG", "positionAmt": "0.002"}]}
                session.account_observation = SimpleNamespace(
                    purpose="stop", deadline=time.monotonic() + 30,
                    result=SimpleNamespace(done=lambda: True, result=lambda read=read: read, cancel=lambda: None))
                observer = SimpleNamespace(session=session, last_query=time.monotonic(), cache=cache)
                live_lifecycle.Observer.observe(observer)
                orders.append(close)
                for _ in range(2):  # its answer, or its rejection, has not come yet
                    live_lifecycle.Observer.observe(observer)
                owner.submit_order.assert_called_once()
                owner.cancel_order.assert_not_called()
                self.assertFalse(session.venue_flat or session.stop_venue_flat)
                session.node.handle.return_value.stop.assert_not_called()
                whole, position.quantity = position.quantity, Quantity.from_str("0.001")
                live_lifecycle.Observer.observe(observer)  # a stop's late fill of what was already gone: still in flight
                self.assertFalse(session.venue_flat or session.stop_venue_flat)
                owner.cancel_order.assert_not_called()
                position.quantity = whole
                orders.remove(close)
                live_lifecycle.Observer.observe(observer)  # rejected: not flat, left to the timeout
                self.assertFalse(session.venue_flat or session.stop_venue_flat)
                owner.cancel_order.assert_not_called()
                position.quantity = Quantity.from_str("0.001")  # filled: only what Binance never held is left
                live_lifecycle.Observer.observe(observer)
                self.assertEqual(owner.cancel_order.call_count, 1 if resting else 0)
                orders.clear()
                live_lifecycle.Observer.observe(observer)
                self.assertTrue(session.stop_venue_flat)
                self.assertFalse(session.venue_flat)  # engine.live.start takes the final read and require_flat (#3727)
                session.node.handle.return_value.stop.assert_called()
                self.assertFalse(session.failed)

    def test_a_stop_reads_what_binance_holds_only_once_its_entries_are_canceled(self):
        # An entry that fills after the read adds what the read cannot show, which counted as not held at Binance.
        from engine import live_lifecycle
        self.session.begin_stop("requested")
        self.session.sources = {SYMBOL: mock.Mock()}
        entry = SimpleNamespace(client_order_id="entry", strategy_id=self.strategy, is_reduce_only=False, is_closed=False,
                                status=OrderStatus.ACCEPTED, order_type=OrderType.LIMIT)
        orders = [entry]
        cache = mock.Mock(positions_open=lambda **_: [SimpleNamespace(id="P", strategy_id=self.strategy)],
                          orders=lambda **_: orders, orders_inflight=lambda **_: [], orders_active_local=lambda **_: [])
        observer = SimpleNamespace(session=self.session, last_query=time.monotonic(), cache=cache)
        with mock.patch.object(live_lifecycle, "venue_held", return_value=None) as read:
            live_lifecycle.Observer.observe(observer)
            read.assert_not_called()
            orders.clear()
            live_lifecycle.Observer.observe(observer)
            read.assert_called_once()

    def test_a_close_binance_certainly_did_not_take_is_closed_again_a_few_times(self):
        # Re-judge D-155: a rejected close was never sent again; the run ended unresolved with the position open.
        cache = SimpleNamespace(position_id=lambda client_order_id: "P-" + client_order_id)
        self.session.exits = {"P-1", "P-2", "P-3"}

        def answer(name, client_order_id, reason):
            event = type(name, (SimpleNamespace,), {})(client_order_id=client_order_id, reason=reason)
            live_source.resend_close(self.session, cache, event)

        for _ in range(live_source.CLOSE_RESENDS + 1):
            self.session.exits.add("P-1")
            answer("OrderRejected", "1", "submit-order-error: BinanceError code=-4131 PERCENT_PRICE")
        self.assertEqual(self.session.resent["P-1"], live_source.CLOSE_RESENDS)
        self.assertIn("P-1", self.session.exits)  # the same answer would come again: left to the timeout
        answer("OrderRejected", "2", "INFLIGHT_TIMEOUT")  # Binance may have filled it
        answer("OrderRejected", "3", "submit-order-error: x")
        self.assertEqual(self.session.exits, {"P-1", "P-2"})
        answer("OrderDenied", "2", live_source.RATE_LIMITED)  # never sent at all
        self.assertEqual(self.session.exits, {"P-1"})
        answer("OrderRejected", "9", "submit-order-error: x")  # no close of the Observer's: nothing to do
        self.assertEqual([row["position_id"] for row in self.events() if row["event"] == "close_resent"],
                         ["P-1"] * live_source.CLOSE_RESENDS + ["P-3"])

    def test_a_stop_asked_for_while_warming_up_again_ends_the_run(self):
        self.gap()
        live_connection.rewarm(self.session)
        (self.session.output / "STOP").write_text("")
        self.assertTrue(self.session.observe_stop_intent())
        self.assertFalse(self.session.rewarming)  # the observer flattens and the run ends clean, not interrupted
        self.assertEqual([row["reason"] for row in self.events() if row["event"] == "stopping"],
                         ["rewarming", "requested"])

    def test_entries_staged_at_a_missing_bar_are_denied_natively_and_without_a_gate_end_the_run(self):
        queued, held = self.pending(time.time_ns()), self.pending(time.time_ns())
        held.order = SimpleNamespace(**{**vars(held.order), "client_order_id": "O-2"})
        self.session.pending_entries[:] = [queued, held]
        self.session.account_observation = observation = mock.Mock()
        self.session.entry_gate = gate = mock.Mock()
        self.gap()
        observation.result.cancel.assert_called_once()
        self.assertEqual([call.args[0] for call in gate.deny_order.call_args_list], [queued.order, held.order])
        self.assertEqual(self.session.denied, {"O-1", "O-2"})
        self.assertEqual(self.session.pending_entries, [])
        self.assertFalse(self.session.stopping or self.session.failed)
        # Negative control: with nothing to deny natively, a staged entry ends the run as before.
        session = live.Session(manifest(self.binding), self.session.output, "run", account_verified=True)
        session.node, session.cancel_entries = mock.Mock(), mock.Mock()
        session.pending_entries.append(self.pending(time.time_ns()))
        live_connection.close_entries(session, "bars_missing")
        self.assertTrue(session.failed and session.stopping)

    def test_a_contract_not_trading_denies_the_entries_on_it_and_keeps_the_others_check(self):
        # Two contracts, one instance each (the user, 2026-11-13): ETHUSDT stops TRADING while an entry on each waits.
        self.session.manifest["symbols"] = [SYMBOL, "ETHUSDT"]
        btc, eth = self.pending(time.time_ns()), self.pending(time.time_ns())
        eth.order = SimpleNamespace(**{**vars(eth.order), "client_order_id": "O-2",
                                       "instrument_id": InstrumentId.from_str("ETHUSDT-PERP.BINANCE")})
        self.session.pending_entries[:] = [btc, eth]
        self.session.account_observation = observation = mock.Mock()
        self.session.entry_gate = gate = mock.Mock()
        snapshot = json.loads(json.dumps(self.snapshot))
        snapshot["symbols"]["ETHUSDT"] = {"instrument": {"status": "SETTLING"}}
        live_connection.contract(self.session, snapshot)
        self.assertEqual([call.args[0] for call in gate.deny_order.call_args_list], [eth.order])
        observation.result.cancel.assert_not_called()  # the account check under way is the BTCUSDT entry's
        self.assertEqual(self.session.pending_entries, [btc])
        self.assertEqual((live_connection.entries_open(self.session, SYMBOL),
                          live_connection.entries_open(self.session, "ETHUSDT")), (True, False))
        self.assertFalse(live_connection.rewarm_due(self.session))  # a restart could not admit ETHUSDT
        self.assertFalse(self.session.stopping or self.session.failed)
        # With the check under way for the denied entry, the next one gets its own.
        self.session.connection.halted.clear()
        self.session.pending_entries[:] = [eth, btc]
        self.session.account_observation = observation = mock.Mock()
        with mock.patch.object(commands, "start_observation") as start:
            live_connection.contract(self.session, snapshot)
        observation.result.cancel.assert_called_once()
        start.assert_called_once_with(self.session, "entry")
        self.assertEqual(self.session.pending_entries, [btc])

    def test_another_contract_back_at_trading_holds_the_waiting_entries_until_the_check_passes(self):
        self.session.manifest["symbols"] = [SYMBOL, "ETHUSDT"]
        snapshot = json.loads(json.dumps(self.snapshot))
        snapshot["symbols"]["ETHUSDT"] = {"instrument": {"status": "TRADING"}}

        def halted():
            session = live.Session(self.session.manifest, self.session.output, "run", account_verified=True)
            session.node = mock.Mock()
            session.connection.halted["ETHUSDT"] = 0.0
            pending = self.pending(time.time_ns())
            session.pending_entries.append(pending)
            read: Future = Future()
            session.account_observation = commands.AccountObservation("entry", time.monotonic() + 30, read)
            return session, pending, read

        # The entry's own read and, with that read still under way, a comparison find ETHUSDT TRADING again.
        own, comparison = halted(), halted()
        own[2].set_result(snapshot)
        commands.dispatch_entry(own[0])
        with mock.patch.object(live_connection, "compare", return_value={}):
            live_connection.judge(comparison[0], Cache(), dict(snapshot))
        self.assertTrue(comparison[2].cancelled())  # dropped: its answer is never used
        for session, pending, _ in (own, comparison):
            self.assertIsNone(session.account_observation)
            self.assertEqual(session.pending_entries, [pending])
            self.assertEqual(pending.deadline_ns, pending.order.ts_init + live_connection.HOLD_NS)
            with mock.patch("engine.live_commands.time.monotonic", return_value=time.monotonic() + 31):
                commands.dispatch_entry(session)  # past the first read's deadline: waits, refuses nothing
            self.assertFalse(session.stopping or session.failed)
            with mock.patch.object(commands, "start_observation") as start:
                live_connection.open_entries(session)
            start.assert_called_once_with(session, "entry")  # a new read of the account
            pending.submit.assert_not_called()

    def test_each_contract_is_compared_with_its_own_instance(self):
        self.session.manifest["symbols"] = [SYMBOL, "ETHUSDT"]
        ids = strategy_ids(self.session.manifest)
        eth = InstrumentId.from_str("ETHUSDT-PERP.BINANCE")

        class Contracts(Cache):
            def positions_open(self, instrument_id=None, **_):
                return [item for item in self._positions if item.instrument_id == instrument_id]

            def orders(self, instrument_id=None, **_):
                return [item for item in self._orders if item.instrument_id == instrument_id]

        def position(strategy, instrument):
            return SimpleNamespace(strategy_id=strategy, side=PositionSide.SHORT, id="P-" + str(instrument),
                                   instrument_id=instrument, quantity=SimpleNamespace(as_decimal=lambda: Decimal("1")))
        snapshot = dict(self.snapshot, positions=[{"symbol": "ETHUSDT", "positionSide": "SHORT", "positionAmt": "-1"}],
                        orders=[], algo_orders=[{"symbol": "ETHUSDT", "algoId": 9}])
        stop = SimpleNamespace(**vars(order("9", strategy=ids["ETHUSDT"])), instrument_id=eth)
        snapshot["symbols"] = {**snapshot["symbols"], "ETHUSDT": {**snapshot["symbols"][SYMBOL], "config": [
            {**snapshot["symbols"][SYMBOL]["config"][0], "symbol": "ETHUSDT"}]}}
        with mock.patch("engine.live_venue.time.time_ns", return_value=snapshot["observed_ns"]):
            agreed = live_connection.compare(snapshot, Contracts([position(ids["ETHUSDT"], eth)], [stop]),
                                             self.session.manifest)
            # The BTCUSDT instance holding the ETHUSDT position is not the run's ETHUSDT position.
            crossed = live_connection.compare(snapshot, Contracts([position(ids[SYMBOL], eth)], [stop]),
                                              self.session.manifest)
            unknown = live_connection.compare(dict(snapshot, orders=[{"symbol": "ETHUSDT", "orderId": 5}]),
                                              Contracts([position(ids["ETHUSDT"], eth)], [stop]), self.session.manifest)
        self.assertEqual(agreed, {})
        self.assertEqual(crossed["foreign"], ["P-ETHUSDT-PERP.BINANCE"])
        self.assertEqual([row["symbol"] for row in crossed["positions"]], ["ETHUSDT"])
        self.assertEqual(unknown, {"unknown_orders": {"ETHUSDT": [["5"]]}})
        self.session.sources = {SYMBOL: mock.Mock(), "ETHUSDT": mock.Mock()}
        self.session.cancel_entries = mock.Mock()
        with mock.patch.object(live_connection, "compare", return_value=unknown), \
                mock.patch.object(live_connection.Strategy, "cancel_all_orders") as cancel_all:
            live_connection.judge(self.session, Cache(), dict(self.snapshot))
        cancel_all.assert_called_once_with(self.session.sources["ETHUSDT"], eth, None, None, False)  # that contract

    def test_an_entry_held_through_a_reconnect_is_denied_by_the_gap_bar_before_the_source_sees_it(self):
        seen = []
        on_bar = live_source._gated("on_bar", lambda source, bar: seen.append(bar))
        source = SimpleNamespace(_live=self.session)
        self.session.evidence, self.session.cancel_entries = mock.Mock(), mock.Mock()
        self.session.entry_gate = gate = mock.Mock()
        minute = 60_000_000_000
        with mock.patch.object(live_source, "native_cache", return_value=Cache()):
            on_bar(source, SimpleNamespace(bar_type=BAR, ts_event=minute))
            self.socket(SocketState.DISCONNECTED)
            self.socket(SocketState.CONNECTED)
            self.assertEqual(set(self.session.connection.closed), {"unverified"})
            held = self.pending(time.time_ns(), bar_type=BAR)
            live_connection.hold(self.session, held)
            on_bar(source, SimpleNamespace(bar_type=BAR, ts_event=3 * minute))  # a gap: 2 minutes
        gate.deny_order.assert_called_once()
        self.assertIs(gate.deny_order.call_args.args[0], held.order)
        self.assertEqual(self.session.pending_entries, [])
        self.assertFalse(self.session.stopping or self.session.failed)  # the bar bound did not end the run
        [denied] = self.events_named("entry_denied")
        self.assertIsNotNone(denied["held_ns"])
        self.assertEqual(denied["reasons"], ["bars_missing", "unverified"])
        self.session.cancel_entries.assert_called_with("bars_missing")
        self.assertEqual(len(seen), 1)  # flat with nothing staged: it waits to warm up again and sees no gap bar

    def test_a_staged_entry_the_gate_cannot_deny_is_refused_and_working_entries_still_go(self):
        self.session.pending_entries[:] = [self.pending(time.time_ns()), self.pending(time.time_ns())]
        self.session.entry_gate = gate = mock.Mock()
        gate.deny_order.side_effect = RuntimeError("Invalid order state transition")
        self.gap()
        self.session.cancel_entries.assert_called_once_with("bars_missing")
        self.assertTrue(self.session.failed and self.session.stopping)
        self.assertEqual(self.session.pending_entries, [])
        self.assertEqual(len(self.events_named("entry_refused")), 2)
        self.assertEqual(self.events_named("entry_denied"), [])
        self.assertEqual(self.session.denied, set())

    def test_working_entries_are_withdrawn_even_if_handling_the_staged_ones_fails(self):
        self.session.cancel_entries = mock.Mock()
        with mock.patch.object(live_connection, "deny_staged", side_effect=RuntimeError("native")):
            self.session.connection.closed["unverified"] = 0.0  # held entries: not holdable once a bar is missing
            with self.assertRaises(RuntimeError):
                live_connection.close_entries(self.session, "bars_missing")
        self.session.cancel_entries.assert_called_once_with("bars_missing")

    def test_an_entry_from_within_a_denial_is_refused_and_denials_of_earlier_starts_are_read_back(self):
        self.session.entry_gate = mock.Mock()
        self.session.denying = True
        with self.assertRaisesRegex(LiveRefusal, "LIVE_CONNECTION_UNVERIFIED"):
            live_connection.deny(self.session, self.pending(time.time_ns()).order, "entry_while_bars_missing")
        self.session.denying = False
        live_connection.deny(self.session, self.pending(time.time_ns()).order, "entry_while_bars_missing")
        later = live.Session(manifest(self.binding), self.session.output, "run")  # the next start
        self.assertEqual(later.denied, set())
        self.assertEqual(live_connection.denied_entries(later), {"O-1"})

    def test_flat_with_reduce_only_orders_left_after_a_missing_bar_the_user_is_told_once_after_ten_minutes(self):
        self.gap()
        stop = SimpleNamespace(**vars(order(7, strategy=self.strategy)), is_reduce_only=True)
        start = 10**12

        def read(cache, seconds):
            with mock.patch.object(live_connection, "compare", return_value={}):
                live_connection.judge(self.session, cache, dict(self.snapshot, observed_ns=start + seconds * 10**9))
            return [row for row in self.events() if row["event"] == "orphan_orders"]

        self.assertEqual(read(Cache(orders=[stop]), 0), [])
        self.assertEqual(read(Cache(orders=[stop]), 589), [])
        [told] = read(Cache(orders=[stop]), 590)  # reads 300 s apart may land a few seconds early
        self.assertEqual((told["orders"], told["seconds"]), (["O-7"], 590))
        self.assertEqual(len(read(Cache(orders=[stop]), 900)), 1)  # once
        self.assertEqual(self.session.connection.closed.keys(), {"bars_missing"})  # entries stay closed
        self.assertFalse(self.session.stopping or self.session.rewarming)  # nothing is canceled, nothing restarts
        # Negative controls: a position, an entry among the orders, or a gate open for another reason says nothing.
        for cache in (Cache(positions=[SimpleNamespace(strategy_id=self.strategy, is_open=True)], orders=[stop]),
                      Cache(orders=[stop, SimpleNamespace(**vars(order(8, strategy=self.strategy)), is_reduce_only=False)])):
            self.session.connection.orphans_since, self.session.connection.notified = None, set()
            read(cache, 0)
            self.assertEqual(len(read(cache, 1200)), 1)
        other = live.Session(manifest(self.binding), self.session.output, "run", account_verified=True)
        other.connection.closed["unknown_orders"] = 0.0
        live_connection.orphans(other, Cache(orders=[stop]), start)
        live_connection.orphans(other, Cache(orders=[stop]), start + 1200 * 10**9)
        self.assertEqual(len(self.events_named("orphan_orders")), 1)

    def events_named(self, name):
        return [row for row in self.events() if row["event"] == name]

    def test_a_failed_warm_up_after_a_start_to_warm_up_again_starts_the_run_once_more(self):
        self.session.warmup_retry = True
        source = SimpleNamespace(_live=self.session)
        live_source._LiveConfigured._warming_failed(source, "WARMUP_NOT_ADJACENT", "the first live minute is late")
        self.assertTrue(self.session.rewarming and self.session.warmup_retried and self.session.stopping)
        self.assertFalse(self.session.failed or self.session.warmup_retry)
        [refused] = self.events_named("warmup_refused")
        self.assertEqual((refused["code"], refused["retry"]), ("WARMUP_NOT_ADJACENT", True))
        self.assertEqual([row["reason"] for row in self.events_named("stopping")], ["rewarming"])
        # A stop asked for meanwhile ends the run, and the warm-up's failure counts.
        (self.session.output / "STOP").write_text("")
        self.assertTrue(self.session.observe_stop_intent())
        self.assertTrue(self.session.failed)
        self.assertFalse(self.session.rewarming)
        # Negative control: the retry's own warm-up failing, or any start not after a rewarm, ends the run as before.
        again = live.Session(manifest(self.binding), self.session.output, "run", account_verified=True)
        live_source._LiveConfigured._warming_failed(SimpleNamespace(_live=again), "WARMUP_TIMEOUT", "late")
        self.assertTrue(again.failed and again.stopping)
        self.assertFalse(again.rewarming)
        self.assertEqual(self.events_named("warmup_refused")[-1]["retry"], False)
        self.assertEqual(self.events_named("stopping")[-1]["reason"], "warmup_failed")

    def test_a_start_that_retries_a_failed_warm_up_says_so_when_it_ends(self):
        self.session.rewarming = True
        live.start_ended(self.session)
        self.session.warmup_retried = True
        live.start_ended(self.session)
        self.assertEqual([row.get("retry") for row in self.events_named("rewarming")], [None, True])

    def test_a_stop_asked_for_while_a_start_rewarms_ends_the_run(self):
        live_connection.rewarm(self.session)
        (self.session.output / "STOP").write_text("")
        self.assertTrue(self.session.observe_stop_intent())
        self.assertFalse(self.session.rewarming)
        self.assertEqual([row["reason"] for row in self.events_named("stopping")], ["rewarming", "requested"])
        live.start_ended(self.session)
        self.assertEqual(self.events_named("rewarming"), [])

    def test_only_a_start_after_a_rewarm_that_was_not_itself_a_retry_may_retry_its_warm_up(self):
        path = self.session.output / "events.jsonl"

        def journal(*rows):
            path.write_text("".join(json.dumps(row) + "\n" for row in rows))
            return live.warmup_retry(self.session.output)

        start = {"event": "preflight", "mode": "run"}
        self.assertTrue(journal(start, {"event": "rewarming", "mode": "run"}))
        self.assertTrue(journal(start, {"event": "rewarming", "retry": True}, start, {"event": "warmup"},
                                {"event": "rewarming", "mode": "run"}))  # a later gap after a good warm-up
        self.assertFalse(journal(start, {"event": "rewarming", "mode": "run"}, start,
                                 {"event": "rewarming", "mode": "run", "retry": True}))
        self.assertFalse(journal(start, {"event": "interrupted", "mode": "run"}))
        self.assertFalse(journal(start, {"event": "rewarming", "mode": "run"}, start, {"event": "interrupted"}))
        path.unlink()
        self.assertFalse(live.warmup_retry(self.session.output))

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
