"""Native observer callbacks and final source outcome; no duplicate execution state."""
from __future__ import annotations
from collections import Counter
from decimal import Decimal
from datetime import timedelta
import sys
import time
from nautilus_trader.common import SocketState
from nautilus_trader.model import (AccountId, BarType, ClientId, OrderSide, OrderStatus, OrderType, PositionSide, Quantity,
                                   StrategyId)
from nautilus_trader.trading import Strategy, StrategyConfig
from engine import live_brake, live_commands as commands, live_connection
from engine.live_commands import pending_orders
from engine.config import MINUTE_NS, symbol_of
from engine.live_errors import LiveRefusal as Refusal
from engine.live_records import contract, owned
from engine.live_session import CANCEL_RETRY_SECONDS, MARK_SECONDS, Session, STOP_GRACE_SECONDS
from engine.live_source import native_event, resend_close

# The periodic native account refresh. rc7's Redis cache appends every account state (about 0.85 KB) to a list it never
# trims and reads whole at each start: every 10 s that is about 2.6 GB a year, every 60 s about 0.45 GB. Each entry's
# own account read refreshes it too (engine.live_commands.start_observation), so the native risk engine checks an entry's
# margin against a fresh free balance; the run's own checks read Binance over REST.
ACCOUNT_QUERY_SECONDS = 60
# The closes the STOP path submits on one tick: half the native submit rate (engine.live_node: 10 a second), since two
# timer ticks can fall within one second. An order over the rate is denied locally and never sent; a close denied so
# is submitted again (engine.live_source).
CLOSES_PER_TICK = 5
# The connected read failed or did not end in time: it says nothing about the account.
UNREAD = frozenset({"LIVE_ACCOUNT_UNAVAILABLE", "LIVE_OBSERVATION_STALE"})

def source_outcome(session: Session, cache) -> None:
    """Keep native failures authoritative and label the source's own declared findings. A finding an instance added
    while it handled the entry gate's own denial (engine.live_source) is journalled with the rest and does not fail
    the start: the denial was the product's, and the run goes on after it."""
    if session.mode not in ("run", "finish"):
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


class Closer(Strategy):
    """An instance's identity in a start that finishes an earlier start's stop: no source, only the STOP path's closes,
    followed as an instance's orders are (engine.live_source)."""

    def __new__(cls, session: Session, config: StrategyConfig):
        return super().__new__(cls, config)  # type: ignore[call-arg]  # native: (cls, config)

    def __init__(self, session: Session, config: StrategyConfig):
        super().__init__(config)
        self.session = session

    def on_order_event(self, event):
        if type(event).__name__ in {"OrderDenied", "OrderRejected"}:
            self.session.native_order_failure = self.session.failed = True
            resend_close(self.session, self.cache, event)
        self.record("order", event)

    def on_position_event(self, event):
        self.record("position", event)

    def record(self, kind: str, event) -> None:
        try:
            payload = native_event(event)
        except Exception:
            self.session.failed = self.session.journal_failed = True
        else:
            self.session.event(kind, native=payload, strict=False)


class Observer(Strategy):
    """Observe native state; only a start with sources (a run's first, or a resumed one on a flat account), or one that
    finishes an earlier start's stop, may exit owned positions."""

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
        session = self.session
        session.event("socket_state", strict=False, client_id=str(event.client_id),
                      endpoint=str(event.endpoint), state=str(event.state))
        if session.connection_failed:
            return
        if event.state == SocketState.DISCONNECTED and not session.account_verified:
            # The start was not verified: nothing was admitted. A start again ends as an interruption (the owner,
            # 2026-11-25), or goes on ending as one; a stop or failure that came first keeps ending the run.
            if session.armed_ns is not None and session.check_storage():
                if not session.observe_stop_intent():
                    session.give_back("venue_disconnected")
                if session.interrupting:
                    return
            session.lose_connection("venue_disconnected")
        else:
            live_connection.on_socket_state(session, event)

    def on_mark_price(self, update):
        symbol = symbol_of(update.instrument_id)
        minute = update.ts_event // MINUTE_NS
        if self.minute is None or minute > self.minute:
            # The run's result once a minute: a minute's first mark ends the minute before it, valued at the marks it
            # ended with (this contract's own when it had none), as a replay values a minute after its close.
            prices = {name: value for name, (_, value) in self.session.marks.items()}
            prices.setdefault(symbol, update.value)
            self.minute = minute
            self.session.record_minute(self.cache, (minute - 1) * MINUTE_NS, prices)
        self.session.marks[symbol] = (time.monotonic(), update.value)

    def tick(self, _event):
        try:
            self.session.record_kline_events()
            self.observe()
        except Exception as exc:
            self.session.failed = True
            # It closes nothing: the ending event first, as in Session.lose_connection.
            self.session.event("unresolved", failure_type=type(exc).__name__, reason="observer_failure", strict=False)
            self.session.begin_stop("observer_failure")
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
                try:
                    snapshot = commands.observed_account(session, "connected")
                except Refusal as exc:
                    if session.armed_ns is None or exc.code not in UNREAD:
                        raise
                    # A start again whose connected read failed or is overdue (the owner, 2026-11-24). `live logs`
                    # shows the line.
                    print(str(exc), file=sys.stderr)
                    session.give_back("connected_account_unverified")
                    return
                if snapshot is None:
                    return
                commands.verify_connected_account(session, snapshot)
                if session.mode in ("run", "finish") and live_connection.phantom(session, self.cache, snapshot):
                    # A start again on a flat account whose reloaded cache still holds a position: its close came
                    # while no process heard it (finding 20261114-25). Nothing of this start is in flight.
                    live_connection.venue_flat_exit(session, snapshot)
                session.finish_stop()
            except Exception:
                session.lose_connection("connected_account_unverified")
                return
        if healthy and now - self.last_query >= ACCOUNT_QUERY_SECONDS:
            self.query_account(AccountId(session.manifest["account_id"]))
            self.last_query = now
        if session.mode in ("run", "finish"):
            session.follow_submissions(self.cache, now)
        if not session.observe_stop_intent():
            commands.end_canceled(session, self)
        if not session.observe_stop_intent():  # its source callbacks may stop the run
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
        if getattr(session.account_observation, "purpose", None) != "stop":
            commands.discard_observation(session)
        if (session.mode not in ("run", "finish") or not (session.sources or session.keepers) or session.venue_flat
                or session.stop_venue_flat):
            # Nothing (more) to close: no source, Binance holds nothing (venue_flat_exit), or the closes are done.
            session.node.handle().stop()
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
        # Read once no entry can fill any more: what one adds after the read would count as not held at Binance.
        held = venue_held(session, positions) if positions and not entries else {}
        if not entries and not closing and held is not None:
            for position in [found for found in positions if str(found.id) not in session.exits and (
                    session.mode != "finish" or priced(self, found.instrument_id, now))][:CLOSES_PER_TICK]:
                close_held(session, position, held)
                closing.append(position)
        # What Binance no longer holds of a position (closed outside the run: by hand, a liquidation) is not closed again;
        # what it still held is waited for, and so is a close in flight or sent in this tick.
        if not (closing and positions) and not [found for found in positions if str(found.id) not in session.phantoms
                or found.quantity.as_decimal() > session.phantoms[str(found.id)]] and not entries:
            session.cancel_open(self.cache, pending, now)
            if not pending and positions:
                session.stop_venue_flat = True  # engine.live.start reads Binance again once the node stops (#3727)
                session.node.handle().stop()
            elif not pending:
                session.native_flat = not (session.persistence_failed or session.journal_failed)
                session.node.handle().stop()
        if session.stop_at is not None and now - session.stop_at > STOP_GRACE_SECONDS:
            session.failed = True
            session.event("unresolved", reason="native_exit_timeout", strict=False)
            session.node.handle().stop()


def priced(observer, instrument_id, now: float) -> bool:
    """Whether the native risk engine can value a market order on the contract: it reads the cached quote, trade or bar
    and denies the order without one. A finishing start follows no market data, so it asks for the latest bars, again
    every CANCEL_RETRY_SECONDS until they are there."""
    bars = BarType.from_str(f"{instrument_id}-1-MINUTE-LAST-EXTERNAL")
    if observer.cache.bar(bars) is not None:
        return True
    if now - observer.session.priced.get(str(instrument_id), float("-inf")) >= CANCEL_RETRY_SECONDS:
        observer.session.priced[str(instrument_id)] = now
        observer.request_bars(bars, limit=2)
    return False


def venue_held(session, positions: list) -> dict | None:
    """How much of each of `positions` Binance still holds, read once before the STOP path's first close (re-judge
    C-140, doctor 20261114-25): a leg closed outside the run (by hand, a liquidation) is still open in the native
    cache, and a close of it from there can only be rejected. The run's positions on a contract and side take
    Binance's quantity there in turn. None while the read is outstanding; {} when it failed or could not be read,
    which leaves every close to the cache, as before. The run is never released on this read (engine.live start)."""
    if session.stop_read is not None:
        return session.stop_held
    try:
        if session.account_observation is None:
            commands.start_observation(session, "stop")
        snapshot = commands.observed_account(session, "stop")
        if snapshot is None:
            return None
        legs: dict[tuple[str, str], Decimal] = {}
        for row in snapshot["positions"]:
            leg = (row["symbol"], row["positionSide"])
            legs[leg] = legs.get(leg, Decimal(0)) + abs(Decimal(row["positionAmt"]))
        held = {}
        for position in positions:
            leg = (symbol_of(position.instrument_id), "LONG" if position.side == PositionSide.LONG else "SHORT")
            held[str(position.id)] = min(position.quantity.as_decimal(), legs.get(leg, Decimal(0)))
            legs[leg] = legs.get(leg, Decimal(0)) - held[str(position.id)]
    except Exception as exc:
        commands.discard_observation(session)
        session.event("stop_read_failed", strict=False, failure_type=type(exc).__name__)
        session.stop_read, session.stop_held = {}, {}
        return {}
    commands.discard_observation(session)
    session.stop_read, session.stop_held = snapshot, held
    return held


def close_held(session, position, held: dict) -> None:
    """Close `position` in full, or only what Binance still held of it (venue_held); what it no longer holds is
    journalled once as `venue_closed` and not closed again. A position venue_held did not see closes in full."""
    owner = session.owner(position.strategy_id)
    session.exits.add(str(position.id))
    key = str(position.id)
    if key not in held or held[key] == position.quantity.as_decimal():
        owner.close_position(position, reduce_only=True)  # the native engine owns the order and its fills
        return
    if key not in session.phantoms:
        session.phantoms[key] = position.quantity.as_decimal() - held[key]
        session.event("venue_closed", strict=False, position_id=key, native=str(position.quantity), venue=str(held[key]))
    if held[key]:
        side = OrderSide.SELL if position.side == PositionSide.LONG else OrderSide.BUY
        owner.submit_order(owner.order_factory.market(position.instrument_id, side,
                                                      Quantity(held[key], position.quantity.precision),
                                                      reduce_only=True), position_id=position.id)


Observer.__module__ = "engine.live"
