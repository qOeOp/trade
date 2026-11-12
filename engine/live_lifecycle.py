"""Native observer callbacks and final source outcome; no duplicate execution state."""
from __future__ import annotations
from datetime import timedelta
import time
from nautilus_trader.common import SocketState
from nautilus_trader.model import AccountId, ClientId, InstrumentId, OrderStatus, OrderType, StrategyId
from nautilus_trader.trading import Strategy, StrategyConfig
from engine import live_commands as commands, live_connection
from engine.cadence import Cadence
from engine.live_commands import pending_orders
from engine.live_session import MARK_SECONDS, MINUTE_NS, Session, STOP_GRACE_SECONDS

def source_outcome(session: Session, cache) -> None:
    """Keep native failures authoritative and label the source's own declared findings."""
    if session.mode != "run":
        return  # Old source failures do not invalidate a later successful flat reconciliation.
    denied = session.native_order_failure or any(
        order.status in {OrderStatus.DENIED, OrderStatus.REJECTED} for order in cache.orders())
    session.failed = session.failed or denied
    if session.source is None:
        return
    try:
        found = session.source.replay_integrity_findings(denied)
        if not isinstance(found, list) or any(not isinstance(value, str) for value in found):
            raise ValueError("invalid source finding shape")
        session.failed = session.failed or bool(found)
        session.event("source_findings", strict=False, evidence="source_self_report",
                      denied_or_rejected_native_orders=denied, findings=[value[:1000] for value in found[:100]],
                      finding_count=len(found))
    except Exception as exc:
        session.failed = True
        session.event("source_findings", strict=False, evidence="source_self_report",
                      denied_or_rejected_native_orders=denied, failure_type=type(exc).__name__)


class Observer(Strategy):
    """Observe native state; only a fresh run may ask its source to exit owned positions."""

    def __init__(self, session: Session):
        super().__init__(StrategyConfig(strategy_id=StrategyId("LIVE-OBSERVER")))
        self.session = session
        self.last_query = 0.0
        self.minute: int | None = None  # the minute of the latest mark price, on the venue's clock
        self.last_mark: tuple[int, object] | None = None  # the latest mark price's time and value
        self.cadence = Cadence()  # finds funding settlements for the evidence pack

    def on_start(self):
        self.session.started = time.monotonic()
        self.subscribe_socket_state(client_id=ClientId("BINANCE"), priority=100)
        # The first tick runs after start_trader and buffered startup socket events.
        # Source on_start may subscribe/request data, but cannot submit before admission.
        self.clock.set_timer("live-observe", timedelta(seconds=1), callback=self.tick)
        if self.session.mode == "run":
            instrument_id = InstrumentId.from_str(f"{self.session.manifest['symbols'][0]}-PERP.BINANCE")
            self.subscribe_mark_prices(instrument_id)
            self.subscribe_funding_rates(instrument_id)
        if not self.session.check_storage():
            self.session.node.handle().stop()
        elif not self.session.account_verified and not self.session.connection_failed and not self.session.stopping:
            commands.start_observation(self.session, "connected")

    def on_stop(self):
        if self.minute is not None:
            # The minute the run stops in, so its chart ends where the run did.
            mark = self.session.mark
            self.session.record_minute(self.cache, self.clock.timestamp_ns() // MINUTE_NS * MINUTE_NS,
                                       mark[1] if mark and time.monotonic() - mark[0] < MARK_SECONDS else None)
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
        self.session.mark = (time.monotonic(), update.value)
        self.last_mark = (update.ts_event, update.value)
        minute = update.ts_event // MINUTE_NS
        if self.minute is None or minute > self.minute:
            self.minute = minute
            self.session.evidence.mark(update)
            self.session.record_minute(self.cache, minute * MINUTE_NS, update.value)

    def on_funding_rate(self, update):
        settled = self.cadence.funding(update)
        if settled is not None:
            self.session.evidence.funding(settled, self.last_mark,
                                          self.cache.positions_open(instrument_id=update.instrument_id))

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
            except Exception:
                session.lose_connection("connected_account_unverified")
                return
        if healthy and now - self.last_query >= 10:
            self.query_account(AccountId(session.manifest["account_id"]))
            self.last_query = now
        if not session.observe_stop_intent():
            commands.dispatch_entry(session)
            if session.mode == "run":
                live_connection.tick(session, self, now)
                session.check_protection(self.cache, now)
                session.check_loss(self.cache, now)
            elif session.mode == "held":
                live_connection.held_tick(session, now)
            if not session.observe_stop_intent():
                return
        commands.discard_observation(session)
        if session.mode in ("reconcile", "held") or session.source is None:
            session.node.handle().stop()
            return
        source = session.source
        positions = self.cache.positions_open(strategy_id=source.strategy_id)
        pending = pending_orders(self.cache, source.strategy_id)
        entries = [order for order in pending if not order.is_reduce_only]
        session.cancel_open(self.cache, entries, now)
        if session.interrupting:
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
            for position in positions:
                pid = str(position.id)
                if pid not in session.exits:
                    # The native execution engine owns the closing order and asynchronous fills.
                    source.close_position(position, reduce_only=True)
                    session.exits.add(pid)
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
