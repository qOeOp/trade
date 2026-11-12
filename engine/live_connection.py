"""A lost Binance connection closes entries; it no longer ends the run.

docs/plans/live-continuous-operation-design-20261110.zh.md §3.2. While any Binance socket is down, and until the venue
and the native cache agree again, entries are closed: working entries are withdrawn, and an entry the source submits
(or one still waiting for its account check) is refused with LIVE_CONNECTION_UNVERIFIED, which ends the run as any
refused entry does (design §3.5: the source cannot see a product refusal, and rc7's Python Strategy has no native
deny_order). Reductions, cancels and closes travel over REST and stay allowed, so the source keeps protecting and
exiting its positions and the Observer can still stop.

Entries reopen only when every socket is connected again and two comparisons of the venue (REST) with the native cache,
COMPARE_SPACING_SECONDS apart, both agree: the strategy's positions and open orders, the account modes, nothing foreign,
and a live bar received since the reconnect with no bar missing. Native reconciliation (open orders every 10 s,
positions every 30 s) repairs what a reconnect's replay misses; two agreeing reads a cycle apart are the barrier rc7 does
not provide. Orders at the venue the cache does not know are canceled at once with every order on the contract, and
entries stay closed for the rest of the run, as they do after a missing bar: no data is patched, and only a restart's
warm-up (design §3.3, §3.4) rebuilds the source's input. The same comparison runs every PERIODIC_SECONDS while entries are
open, so a feed that looks connected but is dead is found too. While the account is flat, a connection near Binance's
24 h cut is renewed natively between seconds 20 and 40 of a minute, away from the bar boundary.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal
import time
from typing import Any

from nautilus_trader.model import ClientId, InstrumentId, OrderStatus, PositionSide
from nautilus_trader.common import SocketState
from nautilus_trader.trading import Strategy

from engine.live_errors import LiveRefusal as Refusal
from engine.live_records import source_strategy_id, write_json
from engine.live_venue import require_account_mode, require_own_symbol

COMPARE_SPACING_SECONDS = 31  # one native position check (30 s) and open-order check (10 s) between the two reads
COMPARE_RETRY_SECONDS = 10
PERIODIC_SECONDS = 300
LOST_SECONDS = 60  # a socket down this long is a notice (design §3.7)
HELD_SECONDS = 600  # entries held closed this long by a failing check is a notice (design §3.2.4)
RENEW_AFTER_SECONDS = 23 * 3600  # Binance closes a connection after 24 h (design §1)
RENEW_SECONDS = range(20, 41)  # seconds of the minute, away from the bar boundary
# Reasons a check can clear; any other reason holds entries closed until the run ends.
RECOVERABLE = frozenset({"disconnected", "unverified"})
# Native order states whose venue state may still be changing; a comparison seeing one is not yet consistent.
IN_FLIGHT = frozenset({OrderStatus.SUBMITTED, OrderStatus.PENDING_UPDATE, OrderStatus.PENDING_CANCEL})


@dataclass
class Connection:
    disconnected: dict[str, float] = field(default_factory=dict)  # socket -> when it went down
    connected: dict[str, float] = field(default_factory=dict)  # socket -> when it (re)connected
    closed: dict[str, float] = field(default_factory=dict)  # entry gate: reason -> since
    observation: Any = None  # engine.live_commands.AccountObservation for a comparison
    agreed: int | None = None  # the observed_ns of the current check's first agreeing comparison
    suspect: bool = False  # a periodic comparison disagreed; the next one comes soon
    reconnected: float | None = None  # when the last socket came back; a later bar shows the feed continues
    last_compare: float | None = None
    bars: dict[str, int] = field(default_factory=dict)  # external bar type -> the latest bar's ts_event
    bar_since_reconnect: bool = True
    notified: set[str] = field(default_factory=set)


def socket_key(event) -> str:
    return f"{event.client_id} {event.endpoint}"


def entries_open(session) -> bool:
    return not session.connection.closed


def close_entries(session, reason: str, *, withdraw: bool = True, **fields) -> None:
    """Close the gate for `reason`; `withdraw` working entries too when no process is sure to protect a fill."""
    state = session.connection
    if reason in state.closed:
        return
    state.closed[reason] = time.monotonic()
    state.agreed = None
    session.event("entries_closed", reason=reason, strict=False, **fields)
    deny_queued(session, reason)
    if withdraw:
        session.cancel_entries(reason)


def open_entries(session) -> None:
    state = session.connection
    reasons = sorted(state.closed)
    state.closed.clear()
    state.agreed = None
    state.notified -= {"held"}
    session.event("entries_opened", strict=False, reasons=reasons)


def refuse(session, reason: str) -> None:
    """An entry while the gate is closed: refused, and the run ends (engine.live_source's admission path)."""
    raise Refusal("LIVE_CONNECTION_UNVERIFIED", f"entries are closed ({reason}) until the venue and the native cache "
                                                "agree again")


def deny_queued(session, reason: str) -> None:
    """Entries still waiting for their account check never left: refused like a new one, so the run ends."""
    if session.pending_entries:
        from engine import live_commands as commands  # engine.live_commands imports this module
        commands.discard_observation(session)
        session.failed = True
        session.event("entry_refused", strict=False, reason=reason, code="LIVE_CONNECTION_UNVERIFIED")
        session.begin_stop("entry_admission_failed")


def gate_reason(session) -> str:
    return ",".join(sorted(session.connection.closed)) or "open"


def on_socket_state(session, event) -> None:
    state, key, now = session.connection, socket_key(event), time.monotonic()
    if event.state == SocketState.DISCONNECTED:
        state.disconnected.setdefault(key, now)
        state.connected.pop(key, None)
        close_entries(session, "disconnected", socket=key)
    elif event.state == SocketState.CONNECTED:
        state.connected[key] = now
        if state.disconnected.pop(key, None) is not None and not state.disconnected:
            state.reconnected, state.bar_since_reconnect = now, False
            if "disconnected" in state.closed:
                del state.closed["disconnected"]
                state.closed.setdefault("unverified", now)
                state.agreed = None
                session.event("entries_checking", strict=False, reasons=sorted(state.closed))


def bar(session, bar) -> None:
    """Continuity of the external bars the source receives: a missing one holds entries closed for the run."""
    try:
        if not bar.bar_type.is_externally_aggregated():
            return
        kind, step = str(bar.bar_type), bar.bar_type.spec.get_interval_ns()
    except Exception:
        return
    state = session.connection
    previous = state.bars.get(kind)
    state.bars[kind] = bar.ts_event
    if state.reconnected is not None and not state.bar_since_reconnect:
        state.bar_since_reconnect = True
    if previous is not None and bar.ts_event - previous > step:
        close_entries(session, "bars_missing", withdraw=False, bar_type=kind, after_ns=previous, received_ns=bar.ts_event)


def compare(snapshot: dict, cache, manifest: dict) -> dict[str, list]:
    """What the venue's REST read and the native cache disagree on; empty when they agree."""
    found: dict[str, list] = {}
    symbol = manifest["symbols"][0]
    instrument = InstrumentId.from_str(f"{symbol}-PERP.BINANCE")
    strategy = source_strategy_id(manifest)
    for check, name in ((require_account_mode, "account_mode"), (require_own_symbol, "foreign")):
        try:
            check(snapshot, manifest)
        except Refusal as exc:
            # A slow or incomplete read says nothing about the account: the check reads again.
            transient = exc.code in {"LIVE_OBSERVATION_STALE", "LIVE_ACCOUNT_RESPONSE"}
            found.setdefault("observation" if transient else name, []).append(exc.code)
    try:
        venue = {"LONG": Decimal(0), "SHORT": Decimal(0)}
        for row in snapshot["positions"]:
            amount = Decimal(row["positionAmt"])
            if row["symbol"] == symbol and amount:
                venue[row["positionSide"]] += abs(amount)
        rows = [*snapshot["orders"], *snapshot["algo_orders"]]
        at_venue = [{str(row[name]) for name in ("orderId", "algoId", "actualOrderId") if row.get(name) not in (None, "", 0)}
                    for row in rows if row["symbol"] == symbol]
    except (KeyError, TypeError, ValueError, ArithmeticError):
        return {"response": ["LIVE_ACCOUNT_RESPONSE"]}
    native = {"LONG": Decimal(0), "SHORT": Decimal(0)}
    for position in cache.positions_open(instrument_id=instrument):
        if position.strategy_id != strategy:
            found.setdefault("foreign", []).append(str(position.id))
            continue
        native["LONG" if position.side == PositionSide.LONG else "SHORT"] += position.quantity.as_decimal()
    if venue != native:
        found["positions"] = [{"venue": {side: str(value) for side, value in venue.items()},
                               "native": {side: str(value) for side, value in native.items()}}]
    ids: set[str] = set()
    for order in cache.orders(instrument_id=instrument):
        if order.is_closed or order.status == OrderStatus.INITIALIZED:
            continue
        if order.status in IN_FLIGHT or order.venue_order_id is None:
            found.setdefault("in_flight", []).append(str(order.client_order_id))
            continue
        if order.strategy_id != strategy:
            found.setdefault("foreign", []).append(str(order.client_order_id))
        ids.add(str(order.venue_order_id))
    unknown = [sorted(row) for row in at_venue if not row & ids]
    if unknown:
        found["unknown_orders"] = unknown
    missing = sorted(ids - set().union(*at_venue))
    if missing:
        found["native_only"] = missing
    return found


def tick(session, observer, now: float) -> None:
    """Drive the comparisons from the Observer's 1 s timer, after the run's start was verified."""
    from engine import live_commands as commands
    state = session.connection
    for key, since in list(state.disconnected.items()):
        if now - since >= LOST_SECONDS and "lost:" + key not in state.notified:
            state.notified.add("lost:" + key)
            session.event("connection_lost", strict=False, socket=key, seconds=int(now - since))
    held = [since for reason, since in state.closed.items() if reason in RECOVERABLE]
    if held and now - min(held) >= HELD_SECONDS and "held" not in state.notified:
        state.notified.add("held")
        session.event("entries_held", strict=False, reasons=sorted(state.closed), seconds=int(now - min(held)))
    if state.observation is not None:
        try:
            snapshot = commands.observed_account(session, "compare", state.observation)
        except Refusal as exc:
            state.observation, state.agreed = None, None
            session.event("comparison", strict=False, agreed=False, found={"observation": [exc.code]})
            return
        if snapshot is not None:
            state.observation = None
            judge(session, observer.cache, snapshot)
        return
    if state.disconnected:
        return  # the check starts when every socket is back
    if state.last_compare is None:
        state.last_compare = now  # the start's own account check just agreed; the periodic one follows
        return
    checking = bool(state.closed) and set(state.closed) <= RECOVERABLE
    interval = (COMPARE_RETRY_SECONDS if state.agreed is None or not checking else COMPARE_SPACING_SECONDS) \
        if checking or state.suspect else PERIODIC_SECONDS
    if now - state.last_compare >= interval:
        state.last_compare = now
        state.observation = commands.observe_account(session.account_reader, tuple(session.manifest["symbols"]),
                                                     "compare")
    elif not state.closed:
        renew(session, observer, now)


def judge(session, cache, snapshot: dict) -> None:
    state = session.connection
    found = compare(snapshot, cache, session.manifest)
    if state.reconnected is not None and not state.bar_since_reconnect:
        found.setdefault("bars", []).append("no bar since the reconnect")
    checking = bool(state.closed) and set(state.closed) <= RECOVERABLE
    observation = None
    if found or checking:
        # Kept when it disagrees or decides a check; a periodic agreement adds nothing to keep.
        observation = "compare-account-" + str(snapshot["observed_ns"]) + ".json"
        write_json(session.output / observation, snapshot)
    session.event("comparison", strict=False, agreed=not found, found=found, observation=observation,
                  entries=gate_reason(session))
    if not found:
        state.suspect = False
        if not checking:
            return
        if state.agreed is None:
            state.agreed = snapshot["observed_ns"]
        elif snapshot["observed_ns"] - state.agreed >= (COMPARE_SPACING_SECONDS - 1) * 1_000_000_000:
            open_entries(session)
        return
    state.agreed = None
    if "unknown_orders" in found:
        close_entries(session, "unknown_orders", orders=found["unknown_orders"])
        if session.source is not None:
            # Every order on the contract, at the venue (HTTP cancel-all for regular and conditional orders):
            # the cache cannot say which of them protect a position.
            Strategy.cancel_all_orders(session.source, InstrumentId.from_str(
                f"{session.manifest['symbols'][0]}-PERP.BINANCE"), None, None, False)
        return
    for reason in ("account_mode", "foreign"):
        if reason in found:
            close_entries(session, reason)
    if entries_open(session):
        # An order or fill in flight disagrees for a moment: a second disagreeing read, soon after, closes entries.
        if state.suspect:
            close_entries(session, "unverified")
        state.suspect = True


def renew(session, observer, now: float) -> None:
    """Move Binance's 24 h disconnect into a flat moment: renew an old connection natively while nothing is open."""
    state = session.connection
    old = [key for key, since in state.connected.items() if now - since >= RENEW_AFTER_SECONDS]
    if not old or session.pending_entries or time.gmtime().tm_sec not in RENEW_SECONDS:
        return
    cache = observer.cache
    if cache.positions_open() or any(not order.is_closed for order in cache.orders()):
        return
    client, endpoint = old[0].split(" ", 1)
    state.connected[old[0]] = now  # one attempt per day; the socket events that follow drive the check
    session.event("connection_renewed", strict=False, socket=old[0])
    observer.reconnect_socket(ClientId(client), endpoint)
