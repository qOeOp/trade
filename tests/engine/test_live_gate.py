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
from nautilus_trader.model import BarType, InstrumentId, OrderSide, OrderStatus, OrderType, PositionSide, TimeInForce

from engine import live, live_commands as commands, live_connection, live_source
from engine.live_errors import LiveRefusal
from engine.live_records import strategy_ids
from tests.engine.test_live_venue import fixture, venue_clock

SYMBOL = "BTCUSDT"
BAR = BarType.from_str(f"{SYMBOL}-PERP.BINANCE-1-MINUTE-LAST-EXTERNAL")


def manifest(binding: str) -> dict:
    return {"run_id": "gate", "symbols": [SYMBOL], "account_id": "BINANCE-001", "trader_id": "LIVE-001",
            "credential_binding": binding, "source": {"source_sha256": "0" * 64},
            "config": {"duration_seconds": 3600, "leverage": "50", "drawdown_brake": "0.15"}}


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


def native(cache):
    """Strategy as live_source reads a source's native cache through it."""
    return SimpleNamespace(cache=SimpleNamespace(__get__=lambda *_: cache))


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

    def pending(self, ts_init, gtd_seconds=None, bar_type=None):
        tif = TimeInForce.GTD if gtd_seconds is not None else TimeInForce.GTC
        entry = SimpleNamespace(client_order_id="O-1", ts_init=ts_init, side=OrderSide.BUY, order_type=OrderType.LIMIT,
                                has_price=True, price="90.00", has_trigger_price=False, quantity="0.003",
                                time_in_force=tif, expire_time_ns=ts_init + (gtd_seconds or 0) * 10**9,
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
        with mock.patch.object(live_source, "Strategy", native(Cache())):
            on_bar(source, bar)
        self.assertEqual(seen, [])
        self.session.evidence.bar.assert_called_once_with(bar)  # still in the evidence pack
        held = Cache(positions=[SimpleNamespace(strategy_id=self.strategy, is_open=True)])
        with mock.patch.object(live_source, "Strategy", native(held)):
            on_bar(source, SimpleNamespace(bar_type=BAR, ts_event=6 * 60_000_000_000))
        self.assertEqual(len(seen), 1)  # its exits are managed as before

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
        with mock.patch.object(live_source, "Strategy", native(Cache())):
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

    def test_a_confirmed_runtime_switch_ends_a_warmed_flat_start_after_two_agreeing_comparisons(self):
        # Design §3.8: SWITCH (live.runs) takes the rewarm path; nothing closes and the start says `switch`.
        self.assertFalse(live_connection.rewarm_pending(self.session, Cache()))  # negative control: no SWITCH
        (self.session.output / live_connection.SWITCH).write_text("")
        self.assertTrue(live_connection.rewarm_pending(self.session, Cache()))
        self.assertFalse(live_connection.rewarm_pending(self.session, Cache(orders=[order(1, strategy=self.strategy)])))
        held = SimpleNamespace(strategy_id=self.strategy, is_open=True)
        self.assertFalse(live_connection.rewarm_pending(self.session, Cache(positions=[held])))
        self.session.pending_entries.append(object())
        self.assertFalse(live_connection.rewarm_pending(self.session, Cache()))
        self.session.pending_entries.clear()
        with mock.patch.object(live_connection, "WARMING", {str(self.strategy)}):  # still warming up: not yet
            self.assertFalse(live_connection.rewarm_pending(self.session, Cache()))
        self.session.connection.closed["foreign"] = 0.0  # a reason no restart clears ends the run instead
        self.assertFalse(live_connection.rewarm_pending(self.session, Cache()))
        del self.session.connection.closed["foreign"]
        self.agree_twice(Cache(), found={})
        self.assertTrue(self.session.rewarming and self.session.switching and self.session.stopping)
        self.assertFalse(self.session.failed)
        live.start_ended(self.session)
        self.assertEqual([row.get("switch") for row in self.events_named("rewarming")], [True])
        self.assertEqual([row["reason"] for row in self.events_named("stopping")], ["rewarming"])

    def test_a_disagreeing_comparison_does_not_end_a_start_for_a_switch(self):
        (self.session.output / live_connection.SWITCH).write_text("")
        self.agree_twice(Cache(), found={"orders": ["unknown"]})
        self.assertFalse(self.session.rewarming or self.session.stopping)

    def test_a_flat_source_sees_no_bar_once_a_switch_waits_and_one_with_a_position_does(self):
        seen = []
        on_bar = live_source._gated("on_bar", lambda source, bar: seen.append(bar))
        source = SimpleNamespace(_live=self.session)
        self.session.evidence = mock.Mock()
        with mock.patch.object(live_connection, "bar"):
            with mock.patch.object(live_source, "Strategy", native(Cache())):
                on_bar(source, SimpleNamespace(bar_type=BAR, ts_event=60_000_000_000))  # negative control
                self.assertEqual(len(seen), 1)
                (self.session.output / live_connection.SWITCH).write_text("")
                on_bar(source, SimpleNamespace(bar_type=BAR, ts_event=2 * 60_000_000_000))
            self.assertEqual(len(seen), 1)
            held = Cache(positions=[SimpleNamespace(strategy_id=self.strategy, is_open=True)])
            with mock.patch.object(live_source, "Strategy", native(held)):
                on_bar(source, SimpleNamespace(bar_type=BAR, ts_event=3 * 60_000_000_000))
        self.assertEqual(len(seen), 2)  # with a position the source trades on as before

    def test_a_cancel_after_a_bar_was_withheld_for_a_switch_still_ends_the_start(self):
        # Review: a source that missed a bar must not decide again with the next one; the start ends and warms up.
        seen = []
        on_bar = live_source._gated("on_bar", lambda source, bar: seen.append(bar))
        source = SimpleNamespace(_live=self.session)
        self.session.evidence = mock.Mock()
        with mock.patch.object(live_connection, "bar"), mock.patch.object(live_source, "Strategy", native(Cache())):
            (self.session.output / live_connection.SWITCH).write_text("")
            on_bar(source, SimpleNamespace(bar_type=BAR, ts_event=60_000_000_000))
            (self.session.output / live_connection.SWITCH).unlink()  # the user canceled before the comparisons
            on_bar(source, SimpleNamespace(bar_type=BAR, ts_event=2 * 60_000_000_000))
        self.assertEqual(seen, [])
        self.agree_twice(Cache(), found={})
        self.assertTrue(self.session.rewarming and self.session.switching)

    def test_a_stop_asked_for_while_a_switch_waits_ends_the_run(self):
        (self.session.output / live_connection.SWITCH).write_text("")
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


if __name__ == "__main__":
    unittest.main()
