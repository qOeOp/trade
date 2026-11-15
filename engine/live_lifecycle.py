"""Native observer callbacks and final source outcome; no duplicate execution state."""
from __future__ import annotations
from collections import Counter
from datetime import timedelta
import time
from nautilus_trader.common import SocketState
from nautilus_trader.model import AccountId, ClientId, OrderStatus, OrderType, StrategyId
from nautilus_trader.trading import Strategy, StrategyConfig
from engine import live_brake, live_commands as commands, live_connection
from engine.live_commands import pending_orders
from engine.config import MINUTE_NS, symbol_of
from engine.live_records import contract, owned
from engine.live_session import MARK_SECONDS, Session, STOP_GRACE_SECONDS

# The periodic native account refresh. rc7's Redis cache appends every account state (about 0.85 KB) to a list it never
# trims and reads whole at each start: every 10 s that is about 2.6 GB a year, every 60 s about 0.45 GB. Each entry's
# own account read refreshes it too (engine.live_commands.start_observation), so the native risk engine checks an entry's
# margin against a fresh free balance; the run's own checks read Binance over REST.
ACCOUNT_QUERY_SECONDS = 60
# The closes the STOP path submits on one tick: half the native submit rate (engine.live_node: 10 a second), since two
# timer ticks can fall within one second. An order over the rate is denied locally and never sent; a close denied so
# is submitted again (engine.live_source).
CLOSES_PER_TICK = 5

def source_outcome(session: Session, cache) -> None:
    """Keep native failures authoritative and label the source's own declared findings. A finding an instance added
    while it handled the entry gate's own denial (engine.live_source) is journalled with the rest and does not fail
    the start: the denial was the product's, and the run goes on after it."""
    if session.mode != "run":
        return  # Old source failures do not invalidate a later successful flat reconciliation.
    # An entry the entry gate denied in any start (engine.live_connection.deny) is no native failure.
    gated = live_connection.denied_entries(session)
    denied = session.native_order_failure or any(
        order.status == OrderStatus.REJECTED
        or order.status == OrderStatus.DENIED and str(order.client_order_id) not in gated
        for order in cache.orders())
    session.failed = session.failed or denied
    if not session.sources:
        return
    try:
        found, gated_count = [], 0
        for source in session.sources.values():  # each instance's own findings, in the run's contract order
            part = source.replay_integrity_findings(denied)
            if not isinstance(part, list) or any(not isinstance(value, str) for value in part):
                raise ValueError("invalid source finding shape")
            found += part
            # Of this instance's findings, as many of each text as it added while handling the gate's denials.
            gated_count += sum((Counter(part) & session.gate_findings.get(str(source.strategy_id), Counter())).values())
        session.failed = session.failed or len(found) > gated_count
        session.event("source_findings", strict=False, evidence="source_self_report",
                      denied_or_rejected_native_orders=denied, findings=[value[:1000] for value in found[:100]],
                      finding_count=len(found), entry_gate_findings=gated_count)
    except Exception as exc:
        session.failed = True
        session.event("source_findings", strict=False, evidence="source_self_report",
                      denied_or_rejected_native_orders=denied, failure_type=type(exc).__name__)


class Observer(Strategy):
    """Observe native state; only a start with sources (a run's first, or a resumed one on a flat account) may ask them
    to exit owned positions."""

    def __init__(self, session: Session):
        super().__init__(StrategyConfig(strategy_id=StrategyId("LIVE-OBSERVER")))
        self.session = session
        self.last_query = 0.0
        self.minute: int | None = None  # the minute of the latest mark price, on the venue's clock

    def on_start(self):
        self.session.started = time.monotonic()
        self.subscribe_socket_state(client_id=ClientId("BINANCE"), priority=100)
        # The first tick runs after start_trader and buffered startup socket events.
        # Source on_start may subscribe/request data, but cannot submit before admission.
        self.clock.set_timer("live-observe", timedelta(seconds=1), callback=self.tick)
        if self.session.mode == "run":
            for symbol in self.session.manifest["symbols"]:
                self.subscribe_mark_prices(contract(symbol))
        if not self.session.check_storage():
            self.session.node.handle().stop()
        elif not self.session.account_verified and not self.session.connection_failed and not self.session.stopping:
            commands.start_observation(self.session, "connected")

    def on_stop(self):
        if self.minute is not None:
            # The minute the run stops in, so its chart ends where the run did.
            now = time.monotonic()
            self.session.record_minute(self.cache, self.clock.timestamp_ns() // MINUTE_NS * MINUTE_NS,
                                       {symbol: value for symbol, (at, value) in self.session.marks.items()
                                        if now - at < MARK_SECONDS})
        commands.discard_observation(self.session)
        self.clock.cancel_timer("live-observe")
        self.unsubscribe_socket_state(client_id=ClientId("BINANCE"))

    def on_socket_state(self, event):
        self.session.event("socket_state", strict=False, client_id=str(event.client_id),
                           endpoint=str(event.endpoint), state=str(event.state))
        if self.session.connection_failed:
            return
        if event.state == SocketState.DISCONNECTED and not self.session.account_verified:
            self.session.lose_connection("venue_disconnected")  # the start was not verified: nothing was admitted
        else:
            live_connection.on_socket_state(self.session, event)

    def on_mark_price(self, update):
        symbol = symbol_of(update.instrument_id)
        self.session.marks[symbol] = (time.monotonic(), update.value)
        minute = update.ts_event // MINUTE_NS
        if self.minute is None or minute > self.minute:
            # The run's result once a minute, at the first mark of the minute and each other contract's latest.
            self.minute = minute
            self.session.record_minute(self.cache, minute * MINUTE_NS,
                                       {name: value for name, (_, value) in self.session.marks.items()})

    def tick(self, _event):
        try:
            self.observe()
        except Exception as exc:
            self.session.failed = True
            self.session.begin_stop("observer_failure")
            self.session.event("unresolved", failure_type=type(exc).__name__, reason="observer_failure", strict=False)
            # No retry of an ambiguous closing request; retain any venue protection and custody.
            try:
                self.session.cancel_entries("observer_failure")
            finally:
                self.session.node.handle().stop()

    def observe(self):
        session = self.session
        now = time.monotonic()
        if session.connection_failed:
            return
        healthy = session.check_storage()
        session.observe_source_state()
        if not session.account_verified:
            if not healthy or session.observe_stop_intent():
                commands.discard_observation(session)
                session.node.handle().stop()
                return
            try:
                if session.account_observation is None:
                    commands.start_observation(session, "connected")
                snapshot = commands.observed_account(session, "connected")
                if snapshot is None:
                    return
                commands.verify_connected_account(session, snapshot)
                if session.mode == "run" and live_connection.phantom(session, self.cache, snapshot):
                    # A start again on a flat account whose reloaded cache still holds a position: its close came
                    # while no process heard it (finding 20261114-25). Nothing of this start is in flight.
                    live_connection.venue_flat_exit(session, snapshot)
            except Exception:
                session.lose_connection("connected_account_unverified")
                return
        if healthy and now - self.last_query >= ACCOUNT_QUERY_SECONDS:
            self.query_account(AccountId(session.manifest["account_id"]))
            self.last_query = now
        if not session.observe_stop_intent():
            commands.dispatch_entry(session)
            if session.mode == "run":
                live_connection.tick(session, self, now)
                session.check_protection(self.cache, now)
                live_brake.tick(session, session.check_mark(self.cache, now), now)
            elif session.mode == "held":
                live_connection.held_withdraw(session, self.cache, now)
                live_connection.held_tick(session, now)
            if not session.observe_stop_intent():
                return
        commands.discard_observation(session)
        if session.mode in ("reconcile", "held") or not session.sources or session.venue_flat:
            session.node.handle().stop()  # nothing to close: no source, or Binance holds nothing (venue_flat_exit)
            return
        positions = owned(self.cache.positions_open, session.manifest)
        pending = owned(lambda strategy_id: pending_orders(self.cache, strategy_id), session.manifest)
        entries = [order for order in pending if not order.is_reduce_only]
        session.cancel_open(self.cache, entries, now)
        if session.interrupting or session.rewarming:
            # Positions and their reduce-only exchange orders stay; only entries, which nothing would protect, go.
            if not entries:
                session.node.handle().stop()
            elif session.stop_at is not None and now - session.stop_at > STOP_GRACE_SECONDS:
                session.failed = True
                session.event("unresolved", reason="interrupt_entry_timeout", strict=False)
                session.node.handle().stop()
            return
        closing = [order for order in pending if order.is_reduce_only and order.order_type == OrderType.MARKET]
        if not entries and not closing:
            for position in [found for found in positions if str(found.id) not in session.exits][:CLOSES_PER_TICK]:
                # The native execution engine owns the closing order and asynchronous fills.
                session.owner(position.strategy_id).close_position(position, reduce_only=True)
                session.exits.add(str(position.id))
        if not positions and not entries:
            session.cancel_open(self.cache, pending, now)
            if not pending:
                session.native_flat = not (session.persistence_failed or session.journal_failed)
                session.node.handle().stop()
        if session.stop_at is not None and now - session.stop_at > STOP_GRACE_SECONDS:
            session.failed = True
            session.event("unresolved", reason="native_exit_timeout", strict=False)
            session.node.handle().stop()


Observer.__module__ = "engine.live"
