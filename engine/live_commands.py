"""Existing account observation and command admission; native dispatch remains native."""
from __future__ import annotations
from concurrent.futures import Future
from dataclasses import dataclass
from decimal import Decimal
import threading
import time
from typing import Any, Callable, TYPE_CHECKING
from nautilus_trader.model import AccountId, OrderStatus, TimeInForce
from nautilus_trader.trading import Strategy
from engine import live_connection
from engine.live_errors import LiveRefusal as Refusal
from engine.live_venue import require_admission, require_account_mode, require_clock
from engine.order_rules import ENTRY_EQUITY_MULTIPLE, exposure, native_cache
from engine.config import symbol_of
from engine.live_records import keep, strategy_ids
if TYPE_CHECKING:
    from engine.live_session import Session

@dataclass(frozen=True)
class AccountObservation:
    purpose: str
    deadline: float
    result: Future


CLOCKED = frozenset({"entry", "compare"})


def observe_account(session: Session, purpose: str) -> AccountObservation:
    """Read-only I/O must not block native socket, protection or expiry dispatch."""
    reader, symbols = session.account_reader, list(session.manifest["symbols"])
    future: Future = Future()

    def read():
        if not future.set_running_or_notify_cancel():
            return
        try:
            # An entry's read and the connection's comparison also bound the clock (design §3.9, require_clock).
            clock = reader.clock() if purpose in CLOCKED else None
            snapshot = reader.snapshot(symbols)
            if clock is not None:
                snapshot["clock"] = clock
        except BaseException as exc:
            future.set_exception(exc)
        else:
            future.set_result(snapshot)

    observation = AccountObservation(purpose, time.monotonic() + 30, future)
    # The worker holds no Session, strategy, order or native object: only the reader and the symbols. A late HTTP
    # response cannot re-arm the run, and shutdown never joins this read-only task.
    threading.Thread(target=read, name="live-account-observation", daemon=True).start()
    return observation


@dataclass
class PendingEntry:
    order: Any
    submit: Callable
    client_id: Any
    bar_type: Any = None  # the bar the source was handling when it decided, if any
    deadline_ns: int | None = None  # set when the entry is held at a closed gate (engine.live_connection.hold)

    def held_ns(self) -> int | None:
        """How long a held entry has waited since its decision; None for one never held."""
        return time.time_ns() - self.order.ts_init if self.deadline_ns is not None else None


def pending_orders(cache, strategy_id=None) -> list:
    """Python rc7 exposes orders(), including initialized local orders, not orders_active_local()."""
    return [order for order in cache.orders(strategy_id=strategy_id) if not order.is_closed]


def require_connection(session: Session) -> None:
    """Reductions, cancels and closes travel over REST: only a run whose start was never verified refuses them
    (engine.live_connection gates entries alone)."""
    if not session.account_verified or session.connection_failed:
        raise Refusal("LIVE_CONNECTION_UNVERIFIED", "order commands require a run whose connected start was verified")


def start_observation(session: Session, purpose: str) -> None:
    if session.account_observation is not None:
        raise Refusal("LIVE_ENTRY_STOPPED", "only one account observation may be outstanding")
    session.account_observation = observe_account(session, purpose)
    source = session.any_source()
    if purpose == "entry" and source is not None:
        # Nautilus's risk engine checks the entry's margin against the native free balance, which a canceled or expired
        # order leaves reduced until the next REST refresh (Binance's stream sends no account update for it). The entry
        # is dispatched on a later Observer tick, after its own read: refresh the native account with that read.
        try:
            Strategy.query_account(source, AccountId(session.manifest["account_id"]))
        except Exception as exc:  # the periodic refresh (engine.live_lifecycle) still follows
            session.event("account_refresh_failed", strict=False, failure_type=type(exc).__name__)


def discard_observation(session: Session, code: str = "LIVE_ENTRY_STOPPED", detail: str | None = None) -> None:
    """Drop the outstanding observation and every entry still waiting to be sent; each is journaled as refused."""
    observation, session.account_observation = session.account_observation, None
    for pending in session.pending_entries:
        live_connection.refused(session, pending, code, detail)
    session.pending_entries.clear()
    if observation is not None:
        observation.result.cancel()  # Does not cancel an already running HTTP request.


def observed_account(session: Session, purpose: str, observation: AccountObservation | None = None) -> dict | None:
    observation = session.account_observation if observation is None else observation
    if observation is None or observation.purpose != purpose:
        raise Refusal("LIVE_CONNECTION_UNVERIFIED", "the account observation does not match this operation")
    if time.monotonic() > observation.deadline:
        raise Refusal("LIVE_OBSERVATION_STALE", "the account observation did not complete within 30 seconds")
    if not observation.result.done():
        return None
    return observation.result.result()


def verify_connected_account(session: Session, snapshot: dict) -> None:
    if session.connection_failed or session.observe_stop_intent():
        raise Refusal("LIVE_CONNECTION_UNVERIFIED", "a stopped connection cannot accept an account observation")
    observation = keep(session.output, "connected-account", snapshot)
    if session.mode == "run":
        # A contract not TRADING closes entries on it alone (engine.live_connection.contract); the others are admitted.
        live_connection.contract(session, snapshot)
        require_admission(snapshot, session.manifest, session.brake.budget,
                          symbols=[symbol for symbol in session.manifest["symbols"]
                                   if symbol not in session.connection.halted])
    else:
        require_account_mode(snapshot, session.manifest)
    session.event({"run": "started", "reconcile": "reconciled", "held": "held"}[session.mode], mode=session.mode,
                  source_callbacks=session.mode == "run", observation=observation)
    session.account_verified = True
    session.account_observation = None


def require_order_identity(session: Session, order, strategy_id) -> None:
    source = session.owner(strategy_id)
    if (source is None or order.strategy_id != strategy_id
            or order.trader_id != Strategy.trader_id.__get__(source, type(source))):
        raise Refusal("LIVE_ORDER_OWNERSHIP", "the order must use its instance's native strategy and trader identity")


def require_entry(session: Session, order) -> None:
    """The entry's custody: its running source and identity, an unsent order, the native instrument. Its shape is
    engine.order_rules' (checked before this at submit, and again when it is sent); its size is checked at dispatch
    (require_entry_size), against the equity of the account observation taken for it. Entries may join the run's open
    positions and orders (user, 2026-11-11). The entry gate (engine.live_connection) is checked before this, by the
    caller."""
    require_connection(session)
    strategy = strategy_ids(session.manifest).get(symbol_of(order.instrument_id))
    source = session.owner(strategy) if strategy is not None else None
    if source is None or not Strategy.is_running(source):
        raise Refusal("LIVE_ENTRY_STOPPED", "only a running native source may dispatch its entry")
    require_order_identity(session, order, strategy)
    if session.observe_stop_intent() or not session.check_storage():
        raise Refusal("LIVE_ENTRY_STOPPED", "new entries require an active run and healthy persistence")
    if order.status != OrderStatus.INITIALIZED:
        raise Refusal("LIVE_ORDER_UNSUPPORTED", "an entry is dispatched once, before the venue has seen it")
    if order.time_in_force == TimeInForce.GTD and order.expire_time_ns <= time.time_ns():
        raise Refusal("LIVE_ENTRY_STOPPED", "an expired entry cannot be dispatched after an account observation")
    cache = native_cache(source)
    if cache.instrument(order.instrument_id) is None:
        raise Refusal("LIVE_INSTRUMENT_UNKNOWN", "entry valuation requires the native instrument")


def require_entry_size(session: Session, order, equity: Decimal) -> None:
    """The strategy's exposure on the contract with this entry (engine.order_rules.exposure: open positions at their
    average open price, open entries and this one at their limit or trigger price) is at most ENTRY_EQUITY_MULTIPLE
    times `equity`, the USDT equity require_admission read from this entry's own account observation."""
    source = session.any_source()
    cache = native_cache(source)
    found = exposure(cache, order)
    if found is None or not 0 < found <= ENTRY_EQUITY_MULTIPLE * equity:
        raise Refusal("LIVE_BUDGET", "the strategy's exposure with this entry exceeds 3 times the account's USDT equity")


def queue_entry(session: Session, entry: PendingEntry) -> None:
    """Queue an admitted entry; each waits for its own account observation, one at a time, in order."""
    session.pending_entries.append(entry)
    if session.account_observation is None:
        start_observation(session, "entry")


def dispatch_entry(session: Session) -> None:
    if not session.pending_entries:
        return
    if not live_connection.entries_open(session):
        if not live_connection.holdable(session):
            live_connection.deny_queued(session, live_connection.gate_reason(session))  # ends the run
        return  # held entries wait for the gate (engine.live_connection.hold)
    pending = session.pending_entries[0]
    symbol = symbol_of(pending.order.instrument_id)
    try:
        snapshot = observed_account(session, "entry")
        if snapshot is None:
            return
        observation = keep(session.output, "entry-account", snapshot)
        live_connection.contract(session, snapshot)
        if not live_connection.entries_open(session, symbol):
            return  # its contract is not TRADING: the entries on it were denied natively, the others wait
        equity = require_admission(snapshot, session.manifest, session.brake.budget, flat=False, symbols=[symbol])
        require_entry(session, pending.order)
        require_entry_size(session, pending.order, equity)
        live_connection.require_send_time(pending)
        try:
            require_clock(snapshot)  # each entry reads the venue's time too (design §3.9)
        except Refusal as exc:
            if getattr(exc, "code", None) != "LIVE_CLOCK" or session.entry_gate is None:
                raise
            # Over the clock limit and nothing else: only this entry is denied, natively, and the run goes on (the
            # user, 2026-11-13). Removed first, as before a submit: its callbacks run at once.
            session.pending_entries.pop(0)
            session.account_observation = None
            try:
                live_connection.deny(session, pending.order, "entry_clock_skew", pending.held_ns(), reason="clock")
            except Exception as failed:
                live_connection.refused(session, pending, getattr(failed, "code", type(failed).__name__), str(failed)[:1000])
                raise
            if session.pending_entries and session.account_observation is None:
                start_observation(session, "entry")
            return
        session.event("entry_verified", observation=observation)
        # Native submit may synchronously dispatch callbacks. Remove this
        # unsubmitted intent first; no retries or fabricated native events.
        session.pending_entries.pop(0)
        session.account_observation = None
        if pending.deadline_ns is not None:
            session.event("entry_released", strict=False, client_order_id=str(pending.order.client_order_id),
                          held_ns=pending.held_ns(), observation=observation)
        pending.submit(pending.order, client_id=pending.client_id)
        if session.pending_entries and session.account_observation is None:
            start_observation(session, "entry")
    except Exception as exc:
        discard_observation(session, getattr(exc, "code", type(exc).__name__), str(exc))
        session.failed = True
        session.begin_stop("entry_admission_failed")
        raise
