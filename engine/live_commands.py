"""Existing account observation and command admission; native dispatch remains native."""
from __future__ import annotations
from concurrent.futures import Future
from dataclasses import dataclass
from decimal import Decimal
import threading
import time
from typing import Any, Callable, TYPE_CHECKING
from nautilus_trader.model import OrderStatus, OrderType, TimeInForce
from nautilus_trader.trading import Strategy
from engine.live_errors import LiveRefusal as Refusal
from engine.live_venue import ENTRY_EQUITY_MULTIPLE, require_admission, require_account_mode
from engine.live_records import source_strategy_id, write_json
if TYPE_CHECKING:
    from engine.live_session import Session

@dataclass(frozen=True)
class AccountObservation:
    purpose: str
    deadline: float
    result: Future


def observe_account(reader, symbols: tuple[str, ...], purpose: str) -> AccountObservation:
    """Read-only I/O must not block native socket, protection or expiry dispatch."""
    future: Future = Future()

    def read():
        if not future.set_running_or_notify_cancel():
            return
        try:
            snapshot = reader.snapshot(list(symbols))
        except BaseException as exc:
            future.set_exception(exc)
        else:
            future.set_result(snapshot)

    observation = AccountObservation(purpose, time.monotonic() + 30, future)
    # The worker holds no Session, strategy, order or native object. A late HTTP
    # response cannot re-arm the run, and shutdown never joins this read-only task.
    threading.Thread(target=read, name="live-account-observation", daemon=True).start()
    return observation


@dataclass(frozen=True)
class PendingEntry:
    order: Any
    submit: Callable
    client_id: Any


def pending_orders(cache, strategy_id=None) -> list:
    """Python rc7 exposes orders(), including initialized local orders, not orders_active_local()."""
    return [order for order in cache.orders(strategy_id=strategy_id) if not order.is_closed]


def require_connection(session: Session) -> None:
    if not session.account_verified or session.connection_failed:
        raise Refusal("LIVE_CONNECTION_UNVERIFIED", "order commands require verified uninterrupted venue connectivity")


def start_observation(session: Session, purpose: str) -> None:
    if session.account_observation is not None:
        raise Refusal("LIVE_ENTRY_STOPPED", "only one account observation may be outstanding")
    session.account_observation = observe_account(session.account_reader, tuple(session.manifest["symbols"]), purpose)


def discard_observation(session: Session) -> None:
    observation, session.account_observation = session.account_observation, None
    session.pending_entry = None
    if observation is not None:
        observation.result.cancel()  # Does not cancel an already running HTTP request.


def observed_account(session: Session, purpose: str) -> dict | None:
    observation = session.account_observation
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
    observation = "connected-account-" + str(snapshot["observed_ns"]) + ".json"
    write_json(session.output / observation, snapshot)
    if session.mode == "run":
        require_admission(snapshot, session.manifest)
    else:
        require_account_mode(snapshot, session.manifest)
    session.event("started" if session.mode == "run" else "reconciled", mode=session.mode,
               source_callbacks=session.mode == "run", observation=observation)
    session.account_verified = True
    session.account_observation = None


def require_order_identity(session: Session, order) -> None:
    if (order.strategy_id != source_strategy_id(session.manifest)
            or order.trader_id != Strategy.trader_id.__get__(session.source, type(session.source))):
        raise Refusal("LIVE_ORDER_OWNERSHIP", "the order must use the source's native strategy and trader identity")


def require_entry(session: Session, order) -> None:
    """The entry's shape and the empty account it starts from; its size is checked at dispatch
    (require_entry_size), against the equity of the account observation taken for it."""
    require_connection(session)
    if not Strategy.is_running(session.source):
        raise Refusal("LIVE_ENTRY_STOPPED", "only a running native source may dispatch its entry")
    require_order_identity(session, order)
    if session.observe_stop_intent() or not session.check_storage():
        raise Refusal("LIVE_ENTRY_STOPPED", "new entries require an active run and healthy persistence")
    if (order.order_type != OrderType.LIMIT or order.is_reduce_only or order.is_quote_quantity
            or order.exec_algorithm_id is not None or order.status != OrderStatus.INITIALIZED):
        raise Refusal("LIVE_ORDER_UNSUPPORTED", "the trial accepts one independent base-quantity LIMIT entry")
    if order.time_in_force == TimeInForce.GTD and order.expire_time_ns <= time.time_ns():
        raise Refusal("LIVE_ENTRY_STOPPED", "an expired entry cannot be dispatched after an account observation")
    cache = Strategy.cache.__get__(session.source, type(session.source))
    # One entry at a time: the next may follow once the last one's position and orders are gone, each from an
    # empty account and through the same fresh account check (user, 2026-11-09).
    if cache.positions_open() or pending_orders(cache):
        raise Refusal("LIVE_ENTRY_STOPPED", "an entry starts from an empty native account: no open position or order")
    if cache.instrument(order.instrument_id) is None:
        raise Refusal("LIVE_INSTRUMENT_UNKNOWN", "entry valuation requires the native instrument")


def require_entry_size(session: Session, order, equity: Decimal) -> None:
    """The entry's native valuation at its limit price is positive and at most ENTRY_EQUITY_MULTIPLE times `equity`,
    the USDT equity require_admission read from this entry's own account observation."""
    cache = Strategy.cache.__get__(session.source, type(session.source))
    value = cache.instrument(order.instrument_id).notional_value(order.quantity, order.price)
    if str(value.currency) != "USDT" or not 0 < value.as_decimal() <= ENTRY_EQUITY_MULTIPLE * equity:
        raise Refusal("LIVE_BUDGET", "entry quantity at its limit price exceeds 3 times the account's USDT equity")


def dispatch_entry(session: Session) -> None:
    pending = session.pending_entry
    if pending is None:
        return
    try:
        snapshot = observed_account(session, "entry")
        if snapshot is None:
            return
        observation = "entry-account-" + str(snapshot["observed_ns"]) + ".json"
        write_json(session.output / observation, snapshot)
        equity = require_admission(snapshot, session.manifest)
        require_entry(session, pending.order)
        require_entry_size(session, pending.order, equity)
        session.event("entry_verified", observation=observation)
        # Native submit may synchronously dispatch callbacks. Remove the sole
        # unsubmitted intent first; no retries or fabricated native events.
        session.pending_entry, session.account_observation = None, None
        pending.submit(pending.order, client_id=pending.client_id)
    except Exception:
        discard_observation(session)
        session.failed = True
        session.begin_stop("entry_admission_failed")
        raise
