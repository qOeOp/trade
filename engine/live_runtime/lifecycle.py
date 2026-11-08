"""Native observer callbacks and final source outcome; no duplicate execution state."""
from __future__ import annotations
from datetime import timedelta
import time
from nautilus_trader.common import SocketState
from nautilus_trader.model import AccountId, ClientId, InstrumentId, OrderStatus, OrderType, StrategyId
from nautilus_trader.trading import Strategy, StrategyConfig
from engine.live_runtime import commands
from engine.live_runtime.commands import pending_orders
from engine.live_runtime.session import Session, STOP_GRACE_SECONDS

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

    def on_start(self):
        self.session.started = time.monotonic()
        self.subscribe_socket_state(client_id=ClientId("BINANCE"), priority=100)
        # The first tick runs after start_trader and buffered startup socket events.
        # Source on_start may subscribe/request data, but cannot submit before admission.
        self.clock.set_timer("live-observe", timedelta(seconds=1), callback=self.tick)
        if self.session.mode == "run":
            self.subscribe_mark_prices(InstrumentId.from_str(f"{self.session.manifest['symbols'][0]}-PERP.BINANCE"))
        if not self.session.check_storage():
            self.session.node.handle().stop()
        elif not self.session.account_verified and not self.session.connection_failed and not self.session.stopping:
            commands.start_observation(self.session, "connected")

    def on_stop(self):
        commands.discard_observation(self.session)
        self.clock.cancel_timer("live-observe")
        self.unsubscribe_socket_state(client_id=ClientId("BINANCE"))

    def on_socket_state(self, event):
        self.session.event("socket_state", strict=False, client_id=str(event.client_id),
                           endpoint=str(event.endpoint), state=str(event.state))
        if event.state == SocketState.DISCONNECTED and not self.session.connection_failed:
            self.session.lose_connection("venue_disconnected")

    def on_mark_price(self, update):
        self.session.mark = (time.monotonic(), update.value)

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
                session.check_protection(self.cache, now)
                session.check_loss(self.cache, now)
            if not session.observe_stop_intent():
                return
        commands.discard_observation(session)
        if session.mode == "reconcile":
            session.node.handle().stop()
            return
        source = session.source
        positions = self.cache.positions_open(strategy_id=source.strategy_id)
        pending = pending_orders(self.cache, source.strategy_id)
        entries = [order for order in pending if not order.is_reduce_only]
        session.cancel_open(entries, now)
        closing = [order for order in pending if order.is_reduce_only and order.order_type == OrderType.MARKET]
        if not entries and not closing:
            for position in positions:
                pid = str(position.id)
                if pid not in session.exits:
                    # The native execution engine owns the closing order and asynchronous fills.
                    source.close_position(position, reduce_only=True)
                    session.exits.add(pid)
        if not positions and not entries:
            session.cancel_open(pending, now)
            if not pending:
                session.native_flat = not (session.persistence_failed or session.journal_failed)
                session.node.handle().stop()
        if session.stop_at is not None and now - session.stop_at > STOP_GRACE_SECONDS:
            session.failed = True
            session.event("unresolved", reason="native_exit_timeout", strict=False)
            session.node.handle().stop()


Observer.__module__ = "engine.live"
