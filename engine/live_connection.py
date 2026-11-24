"""A lost Binance connection closes entries; it no longer ends the run.

docs/plans/live-continuous-operation-design-20261110.zh.md §3.2. While any Binance socket is down, and until the venue
and the native cache agree again, entries are closed: working entries are withdrawn. An entry the source submits, or
one still waiting for its account check, is held unsent (docs/plans/live-entry-hold-20261113.zh.md): it is sent once,
unchanged, when the gate reopens within HOLD_NS of its decision and before the source receives another bar of the
type it decided on; otherwise the run ends as for any refused entry (rc7's Python Strategy has no native deny_order,
and the source cannot see a product refusal). A gate closed for a reason a check cannot clear refuses at once, except a
missing bar and a contract not TRADING at Binance (the user, 2026-11-13): an entry staged then, and a new one (after a
missing bar, while a position is held), are denied natively through the run's own ExecutionAlgorithm (OrderDenied, which
the source receives), and the run goes on. So is an entry whose own account read finds the clock over its limit. A run
has one instance per contract: a missing bar on any contract closes entries on all of them, and a contract not TRADING
closes entries on that contract alone.
Reductions, cancels and closes travel over REST and stay allowed, so the source keeps protecting and exiting its
positions and the Observer can still stop.

Entries reopen only when every socket is connected again and two comparisons of the venue (REST) with the native cache,
COMPARE_SPACING_SECONDS apart, both agree: the strategy's positions and open orders, the account modes, nothing foreign,
and a live bar received since the reconnect with no bar missing. Native reconciliation (open orders every 10 s,
positions every 30 s) repairs what a reconnect's replay misses; two agreeing reads a cycle apart are the barrier rc7 does
not provide. Orders at the venue the cache does not know are canceled at once with every order on the contract, and
entries stay closed for the rest of the run, as they do after a missing bar. An order the cache knows may have changed
after the read and is not unknown: one in flight only disagrees until it settles, and one known only as closed, or by a
former ID, is judged unknown when the next read shows it again. No data is patched, and only a restart's
warm-up (design §3.3, §3.4) rebuilds the source's input. The same comparison runs every PERIODIC_SECONDS while entries are
open, so a feed that looks connected but is dead is found too. While the account is flat, a connection near Binance's
24 h cut is renewed natively between seconds 20 and 40 of a minute, away from the bar boundary.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal
import json
import re
import time
from typing import Any

from nautilus_trader.model import ClientId, OrderStatus, PositionSide, TimeInForce
from nautilus_trader.common import SocketState
from nautilus_trader.trading import Strategy

from engine import history, protection
from engine.live_errors import LiveRefusal as Refusal
from engine.config import symbol_of
from engine.live_records import contract as contract_id, keep, owned, strategy_ids
from engine.live_venue import require_account_mode, require_clock, require_flat, require_own_symbol, wire_id
from engine.order_rules import GTD_LEAD_NS, native_cache

COMPARE_SPACING_SECONDS = 31  # one native position check (30 s) and open-order check (10 s) between the two reads
COMPARE_RETRY_SECONDS = 10
PERIODIC_SECONDS = 300
LOST_SECONDS = 60  # a socket down this long is a notice (design §3.7)
HELD_SECONDS = 600  # entries held closed this long by a failing check is a notice (design §3.2.4)
RENEW_AFTER_SECONDS = 23 * 3600  # Binance closes a connection after 24 h (design §1)
RENEW_SECONDS = range(20, 41)  # seconds of the minute, away from the bar boundary
# Reasons a check can clear; any other reason holds entries closed until the run ends.
RECOVERABLE = frozenset({"disconnected", "unverified"})
# Reasons a check cannot clear for which an entry is denied natively and the run goes on (the user, 2026-11-13): a
# missing bar, and the contract not TRADING at Binance, which reopens once it trades again and a check passes.
DENIABLE = frozenset({"bars_missing", "contract_status"})
CONTRACT_SECONDS = 60  # while the contract is not TRADING, its status is read this often
ORPHAN_NS = 600 * 10**9  # flat after a missing bar, reduce-only orders still at Binance this long: a notice
ORPHAN_SLACK_NS = COMPARE_RETRY_SECONDS * 10**9  # reads PERIODIC_SECONDS apart land a little early or late
HOLD_NS = 60_000_000_000  # an entry is held unsent at most this long after its decision
# Native order states whose venue state may still be changing; a comparison seeing one is not yet consistent.
IN_FLIGHT = frozenset({OrderStatus.SUBMITTED, OrderStatus.PENDING_UPDATE, OrderStatus.PENDING_CANCEL})


@dataclass
class Connection:
    disconnected: dict[str, float] = field(default_factory=dict)  # socket -> when it went down
    connected: dict[str, float] = field(default_factory=dict)  # socket -> when it (re)connected
    closed: dict[str, float] = field(default_factory=dict)  # entry gate: reason -> since
    halted: dict[str, float] = field(default_factory=dict)  # contract not TRADING -> since: its entries are denied
    observation: Any = None  # engine.live_commands.AccountObservation for a comparison
    agreed: int | None = None  # the observed_ns of the current check's first agreeing comparison
    suspect: bool = False  # a periodic comparison disagreed; the next one comes soon
    reconnected: float | None = None  # when the last socket came back; a later bar shows the feed continues
    last_compare: float | None = None
    bars: dict[str, int] = field(default_factory=dict)  # external bar type -> the latest bar's ts_event
    bar_since_reconnect: bool = True
    notified: set[str] = field(default_factory=set)
    orphans_since: int | None = None  # observed_ns of the first agreeing read finding only reduce-only orders, flat
    phantom_ns: int | None = None  # observed_ns of the first comparison that found Binance flat, the cache not (phantom)
    held_cover: dict | None = None  # a held start's latest journalled verdict on its positions' stops (held_verdict)
    stale_orders: dict[str, list[list[str]]] = field(default_factory=dict)  # compare's, of the latest complete read
    withdrawn_ns: int | None = None  # when a held start first asked for its inherited entries' cancels (held_withdraw)
    withdraw_failed: set[str] = field(default_factory=set)  # entries whose cancel request raised, journalled once


def socket_key(event) -> str:
    return f"{event.client_id} {event.endpoint}"


def reasons(session, symbol: str | None = None) -> set[str]:
    """Why entries on `symbol` are closed: the run's reasons, and contract_status while that contract is not TRADING
    (None: the run's reasons alone)."""
    found = set(session.connection.closed)
    if symbol is not None and symbol in session.connection.halted:
        found.add("contract_status")
    return found


def entries_open(session, symbol: str | None = None) -> bool:
    return not reasons(session, symbol)


def close_entries(session, reason: str, *, withdraw: bool = True, **fields) -> None:
    """Close the gate for `reason`; `withdraw` working entries too when no process is sure to protect a fill."""
    state = session.connection
    if reason in state.closed:
        return
    state.closed[reason] = time.monotonic()
    state.agreed = None
    session.event("entries_closed", reason=reason, strict=False, **fields)
    try:
        if holdable(session):
            hold_queued(session)
        elif deniable(session):
            deny_staged(session, reason)
        else:
            deny_queued(session, reason)
    finally:
        if withdraw:
            session.cancel_entries(reason)


def open_entries(session) -> None:
    state = session.connection
    reasons = sorted(state.closed)
    state.closed.clear()
    state.agreed = None
    state.notified -= {"held"}
    session.event("entries_opened", strict=False, reasons=reasons)
    if session.pending_entries and session.account_observation is None:
        from engine import live_commands as commands  # engine.live_commands imports this module
        commands.start_observation(session, "entry")  # the held entries, in order, as any queued entry


def holdable(session, symbol: str | None = None) -> bool:
    """The gate is closed only for reasons a check can clear: an entry may wait for it."""
    closed = reasons(session, symbol)
    return bool(closed) and closed <= RECOVERABLE


def deniable(session, symbol: str | None = None) -> bool:
    """The gate is closed for a missing bar or the contract not TRADING and for no other reason a check cannot clear:
    an entry is denied natively and the run goes on (the user, 2026-11-13)."""
    lasting = reasons(session, symbol) - RECOVERABLE
    return bool(lasting) and lasting <= DENIABLE


def deny(session, order, detail: str, held_ns: int | None = None, reason: str | None = None) -> None:
    """Deny an entry natively, never sent: the run's ExecutionAlgorithm gives the source's order OrderDenied in the
    native cache and its callbacks (engine.live_node). That OrderDenied is not a native failure (denied_entries). An
    order the cache already knows, or one submitted from within a denial's callbacks, is refused instead."""
    symbol = symbol_of(order.instrument_id)
    if session.entry_gate is None or session.denying:
        raise Refusal("LIVE_CONNECTION_UNVERIFIED", f"entries are closed ({gate_reason(session, symbol)}) and the "
                                                    "entry cannot be denied natively")
    cid = str(order.client_order_id)
    source = session.any_source()
    if source is not None and native_cache(source).order(order.client_order_id) is not None:
        raise Refusal("LIVE_ORDER_UNSUPPORTED", "an order the native cache already holds is not a new entry")
    session.denied.add(cid)  # before the call: its callbacks run at once
    session.denying = True
    try:
        session.entry_gate.deny_order(order, reason or gate_reason(session, symbol))
    except BaseException:
        session.denied.discard(cid)
        raise
    finally:
        session.denying = False
    session.event("entry_denied", strict=False, detail=detail, reasons=sorted(reasons(session, symbol)),
                  held_ns=held_ns, **entry_fields(order))


def denied_entries(session) -> set[str]:
    """The entries the gate denied in any start of this run: they stay DENIED in the native cache a resumed start
    reloads (engine.live_cache)."""
    found = set(session.denied)
    try:
        lines = (session.output / "events.jsonl").read_text(encoding="utf-8").splitlines()
    except OSError:
        return found
    for line in lines:
        try:
            row = json.loads(line)
        except ValueError:
            continue
        if isinstance(row, dict) and row.get("event") == "entry_denied" and isinstance(row.get("client_order_id"), str):
            found.add(row["client_order_id"])
    return found


def deny_staged(session, reason: str, symbol: str | None = None) -> None:
    """Entries staged when a missing bar closed the gate, or those on `symbol` when that contract stopped TRADING
    (waiting for their account check, or held): each is denied natively, never sent, and the run goes on."""
    if session.entry_gate is None:
        deny_queued(session, reason)
        return
    chosen = [pending for pending in session.pending_entries
              if symbol is None or symbol_of(pending.order.instrument_id) == symbol]
    if not chosen:
        return
    if session.pending_entries[0] is chosen[0]:  # the account check under way is for a denied entry
        observation, session.account_observation = session.account_observation, None
        if observation is not None:
            observation.result.cancel()
    for pending in chosen:
        if pending not in session.pending_entries:
            continue  # gone while its source handled the denial before it: cancelled, or refused with the queue
        session.pending_entries.remove(pending)
        try:
            deny(session, pending.order, reason, pending.held_ns())
        except Exception as exc:
            # Not denied: this one and the rest are refused like any entry, and the run ends.
            refused(session, pending, getattr(exc, "code", type(exc).__name__), str(exc)[:1000])
            from engine import live_commands as commands  # engine.live_commands imports this module
            commands.refuse_entries(session, "LIVE_CONNECTION_UNVERIFIED", reason)
            return
    if session.pending_entries and session.account_observation is None and entries_open(session):
        from engine import live_commands as commands  # engine.live_commands imports this module
        commands.start_observation(session, "entry")  # the entries on other contracts, in order


def deadline(order) -> int:
    """The latest send time of a held entry: HOLD_NS after its decision, and early enough for a GTD order's
    send-time rule."""
    found = order.ts_init + HOLD_NS
    if order.time_in_force == TimeInForce.GTD:
        found = min(found, order.expire_time_ns - GTD_LEAD_NS)
    return found


def entry_fields(order) -> dict:
    return {"client_order_id": str(order.client_order_id), "ts_init": order.ts_init, "side": order.side.name,
            "type": order.order_type.name, "price": str(order.price) if getattr(order, "has_price", False) else None,
            "trigger_price": str(order.trigger_price) if getattr(order, "has_trigger_price", False) else None,
            "quantity": str(order.quantity),
            "expire_time_ns": order.expire_time if order.time_in_force == TimeInForce.GTD else None}


def hold(session, pending) -> None:
    """Hold an admitted entry unsent while the gate is closed for recoverable reasons; no account observation runs."""
    if pending.deadline_ns is None:
        pending.deadline_ns = deadline(pending.order)
        session.event("entry_held", strict=False, reasons=sorted(reasons(session, symbol_of(pending.order.instrument_id))),
                      deadline_ns=pending.deadline_ns, **entry_fields(pending.order))
    if pending not in session.pending_entries:
        session.pending_entries.append(pending)


def hold_queued(session) -> None:
    """The gate closed while entries waited for their account check: drop the check, hold the entries."""
    observation, session.account_observation = session.account_observation, None
    if observation is not None:
        observation.result.cancel()
    for pending in session.pending_entries:
        hold(session, pending)


def require_send_time(pending) -> None:
    """Every entry is sent with time left on a GTD order, and a held one by its deadline."""
    order, now = pending.order, time.time_ns()
    if order.time_in_force == TimeInForce.GTD and order.expire_time_ns - now < GTD_LEAD_NS:
        raise Refusal("LIVE_ORDER_UNSUPPORTED", "a GTD entry is sent with at least 605 seconds left")
    if pending.deadline_ns is not None and now > pending.deadline_ns:
        raise Refusal("LIVE_CONNECTION_UNVERIFIED", "entry_hold_expired: the gate did not reopen in time")


def refused(session, pending, code: str, detail: str | None) -> None:
    session.event("entry_refused", strict=False, code=code, detail=detail,
                  reasons=sorted(reasons(session, symbol_of(pending.order.instrument_id))), held_ns=pending.held_ns(),
                  **entry_fields(pending.order))


def deny_queued(session, reason: str, detail: str | None = None) -> None:
    """Entries still waiting to be sent are refused like a new one, so the run ends."""
    if session.pending_entries:
        from engine import live_commands as commands  # engine.live_commands imports this module
        commands.refuse_entries(session, "LIVE_CONNECTION_UNVERIFIED", detail or reason)


def held_bar(session, bar) -> bool:
    """A bar of the type a held entry was decided on, while it is unsent, ends the run before the source sees it:
    the source never decides again on an entry the native cache does not hold yet."""
    if any(pending.deadline_ns is not None and pending.bar_type in (None, bar.bar_type)
           for pending in session.pending_entries):
        deny_queued(session, gate_reason(session), "entry_hold_bar")
        return True
    return False


def gate_reason(session, symbol: str | None = None) -> str:
    return ",".join(sorted(reasons(session, symbol))) or "open"


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


def bar(session, bar) -> bool:
    """Continuity of the external bars the source receives: a missing one closes entries until a restart warms the
    source up again (rewarm). Whether the bar is a repeat: one stamped no later than the latest of its type (Binance
    pushing a closed kline again, revised or not; rc7's validate_data_sequence passes an equal stamp), which the
    source must not see, or it decides twice on one bar. A replay never repeats a bar, so this keeps parity."""
    try:
        kind, step = str(bar.bar_type), bar.bar_type.spec.get_interval_ns()
        if not bar.bar_type.is_externally_aggregated():
            if history.late_aggregate(bar, time.time_ns()):
                # The source would decide on a stale bucket; only a restart's fresh timers and warm-up (rewarm) put
                # the aggregation back on time. The bar's late_aggregate row (engine.realtime) holds its timing.
                close_entries(session, "bars_missing", bar_type=kind, received_ns=bar.ts_event)
            return False
    except Exception:
        return False
    state = session.connection
    previous = state.bars.get(kind)
    if previous is not None and bar.ts_event <= previous:
        session.event("bar_repeated", strict=False, bar_type=kind, after_ns=previous, received_ns=bar.ts_event)
        return True
    state.bars[kind] = bar.ts_event
    if state.reconnected is not None and not state.bar_since_reconnect:
        state.bar_since_reconnect = True
    if previous is not None and bar.ts_event - previous > step:
        # The source is rebuilt by the next start (rewarm): its working entries go now, while this process still
        # protects a fill; positions keep their exits (design §3.2 item 3).
        close_entries(session, "bars_missing", bar_type=kind, after_ns=previous, received_ns=bar.ts_event)
    return False


def rewarm_due(session) -> bool:
    """rewarm_pending without the cache: a missing bar closed entries, and nothing else holds them closed that a
    restart's own checks would not clear."""
    closed = session.connection.closed
    return (session.mode == "run" and not session.stopping and not session.pending_entries
            and not session.connection.halted and "bars_missing" in closed
            and set(closed) - {"bars_missing"} <= RECOVERABLE)


def rewarm_pending(session, cache) -> bool:
    """rewarm_due, and this strategy holds nothing: no position, no order, no entry waiting to be sent. Its source
    decides on nothing more (it is rebuilt by the next start) and the venue comparison decides the restart (design
    §3.2 item 3)."""
    if not rewarm_due(session):
        return False
    return not owned(cache.positions_open, session.manifest) and not any(
        not order.is_closed for order in owned(cache.orders, session.manifest))


def rewarm(session) -> None:
    """End this start without closing anything; the control starts the run again (engine.live INTERRUPTED) and its
    warm-up reads Binance's complete bars: the data is not patched."""
    session.rewarming = True
    session.begin_stop("rewarming")


def position_differences(snapshot: dict, cache, manifest: dict) -> list[dict]:
    """The contracts of the run on which Binance's positions per side differ from the instance's own in the native
    cache. A read whose position rows cannot be judged raises KeyError, TypeError, ValueError or ArithmeticError."""
    strategies = strategy_ids(manifest)
    venue = {symbol: {"LONG": Decimal(0), "SHORT": Decimal(0)} for symbol in strategies}
    for row in snapshot["positions"]:
        amount = Decimal(row["positionAmt"])
        if row["symbol"] in venue and amount:
            venue[row["symbol"]][row["positionSide"]] += abs(amount)
    found = []
    for symbol, strategy in strategies.items():
        native = {"LONG": Decimal(0), "SHORT": Decimal(0)}
        for position in cache.positions_open(instrument_id=contract_id(symbol)):
            if position.strategy_id == strategy:
                native["LONG" if position.side == PositionSide.LONG else "SHORT"] += position.quantity.as_decimal()
        if venue[symbol] != native:
            found.append({"symbol": symbol, "venue": {side: str(value) for side, value in venue[symbol].items()},
                          "native": {side: str(value) for side, value in native.items()}})
    return found


def entry_positions(session, snapshot: dict) -> list[dict]:
    """position_differences for an entry's own account read (engine.live_commands.dispatch_entry): an entry is not
    sent while Binance's positions and the native cache disagree (finding 20261114-25)."""
    source = session.any_source()
    if source is None:
        return []
    try:
        return position_differences(snapshot, native_cache(source), session.manifest)
    except (KeyError, TypeError, ValueError, ArithmeticError) as exc:
        raise Refusal("LIVE_ACCOUNT_RESPONSE", "the venue did not supply complete position observations") from exc


def phantom(session, cache, snapshot: dict) -> bool:
    """Binance holds nothing at all (no position on any symbol, no open or conditional order) while the native cache
    still holds an open position of the run: a close the cache never received (a stop triggered while no process
    heard it, a liquidation, a close by hand), which native reconciliation does not match."""
    try:
        require_flat(snapshot)
    except Refusal:
        return False
    return bool(owned(cache.positions_open, session.manifest))


def venue_flat_exit(session, snapshot: dict) -> None:
    """End the run as a reconciliation that finds the whole account flat does (engine.live venue_flat): nothing is
    sent, since a close of a position Binance no longer holds can only be rejected; the read is the record, and the
    next run starts from a fresh native identity."""
    observation = keep(session.output, "final-account", snapshot)
    session.venue_flat = True
    session.event("venue_flat", strict=False, observation=observation, native_positions=True)
    session.begin_stop("venue_flat")


def compare(snapshot: dict, cache, manifest: dict) -> dict:
    """What the venue's REST read and the native cache disagree on, contract by contract; empty when they agree.
    `unknown_orders` maps each contract to the venue's orders on it the cache does not know; `stale_orders`, to those
    it knows only as a closed order's or by a former ID (the read may be older than the cache)."""
    found: dict = {}
    strategies = strategy_ids(manifest)
    for check, name in ((require_account_mode, "account_mode"), (require_own_symbol, "foreign"),
                        (lambda read, _: require_clock(read), "clock")):
        try:
            check(snapshot, manifest)
        except Refusal as exc:
            # A slow or incomplete read says nothing about the account: the check reads again.
            transient = exc.code in {"LIVE_OBSERVATION_STALE", "LIVE_ACCOUNT_RESPONSE"}
            found.setdefault("observation" if transient else name, []).append(exc.code)
    try:
        differences = position_differences(snapshot, cache, manifest)
        at_venue: dict[str, list[tuple[set[str], str]]] = {symbol: [] for symbol in strategies}
        for row in (*snapshot["orders"], *snapshot["algo_orders"]):
            if row["symbol"] in at_venue:
                at_venue[row["symbol"]].append((
                    {str(row[name]) for name in ("orderId", "algoId", "actualOrderId")
                     if row.get(name) not in (None, "", 0)},
                    str(row.get("clientOrderId") or row.get("clientAlgoId") or "")))
    except (KeyError, TypeError, ValueError, ArithmeticError):
        return {"response": ["LIVE_ACCOUNT_RESPONSE"]}
    if differences:
        found["positions"] = differences
    for symbol, strategy in strategies.items():
        instrument = contract_id(symbol)
        for position in cache.positions_open(instrument_id=instrument):
            if position.strategy_id != strategy:
                found.setdefault("foreign", []).append(str(position.id))
        ids: set[str] = set()  # of working orders
        in_flight: set[str] = set()  # in-flight orders' venue IDs and client IDs at Binance (one may have no venue ID yet)
        former: set[str] = set()  # closed orders', and every order's former ones
        for order in cache.orders(instrument_id=instrument):
            former.update(map(str, order.venue_order_ids))
            current = None if order.venue_order_id is None else str(order.venue_order_id)
            if order.is_closed:
                if current is not None:
                    former.add(current)
                continue
            if order.status == OrderStatus.INITIALIZED:
                continue
            if order.status in IN_FLIGHT or current is None:
                in_flight.update({wire_id(order.client_order_id), current or ""} - {""})
                found.setdefault("in_flight", []).append(str(order.client_order_id))
                continue
            if order.strategy_id != strategy:
                found.setdefault("foreign", []).append(str(order.client_order_id))
            ids.add(current)
        for row, client in at_venue[symbol]:
            if row & ids or row & in_flight or client in in_flight:
                continue
            found.setdefault("stale_orders" if row & former else "unknown_orders", {}).setdefault(
                symbol, []).append(sorted(row))
        missing = sorted(ids - set().union(*(row for row, _ in at_venue[symbol])))
        if missing:
            found.setdefault("native_only", []).extend(missing)
    return found


def tick(session, observer, now: float) -> None:
    """Drive the comparisons from the Observer's 1 s timer, after the run's start was verified."""
    from engine import live_commands as commands
    state = session.connection
    if any(pending.deadline_ns is not None and time.time_ns() > pending.deadline_ns
           for pending in session.pending_entries):
        deny_queued(session, gate_reason(session), "entry_hold_expired")
        return
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
    checking = bool(state.closed) and set(state.closed) <= RECOVERABLE or rewarm_pending(session, observer.cache)
    interval = (COMPARE_RETRY_SECONDS if state.agreed is None or not checking else COMPARE_SPACING_SECONDS) \
        if checking or state.suspect else CONTRACT_SECONDS if state.halted else PERIODIC_SECONDS
    if now - state.last_compare >= interval:
        state.last_compare = now
        state.observation = commands.observe_account(session, "compare")
    elif not state.closed:
        renew(session, observer, now)


def contract(session, snapshot: dict) -> None:
    """Binance's status of each contract of the run, from a comparison's read or an entry's own (the user,
    2026-11-13): not TRADING closes entries on that contract alone, and an entry on it is then denied natively and the
    run goes on; working entries and positions with their exchange stops stay. Back at TRADING, the run's entries
    reopen once the account check passes; entries waiting to be sent are held until then, and each is read again."""
    for symbol in session.manifest["symbols"]:
        try:
            status = snapshot["symbols"][symbol]["instrument"]["status"]
        except (KeyError, TypeError, IndexError):
            continue  # an incomplete read says nothing about the contract
        if not isinstance(status, str) or not re.fullmatch(r"[A-Z_]{1,40}", status):
            continue
        state = session.connection
        if status != "TRADING" and symbol not in state.halted:
            state.halted[symbol] = time.monotonic()
            session.event("entries_closed", reason="contract_status", strict=False, symbol=symbol, status=status)
            deny_staged(session, "contract_status", symbol)
        elif status == "TRADING" and symbol in state.halted:
            del state.halted[symbol]
            state.closed.setdefault("unverified", time.monotonic())
            state.agreed = None
            session.event("entries_checking", strict=False, reasons=sorted(state.closed), symbol=symbol,
                          status=status)
            if holdable(session):
                hold_queued(session)


def settle_stale(state: Connection, found: dict) -> None:
    """A stale order that the previous complete read already showed was not changing then: it is an unknown one. One read
    runs at a time, so this one began after the previous was judged."""
    if "response" in found:
        return  # says nothing about orders
    previous, state.stale_orders = state.stale_orders, found.pop("stale_orders", {})
    for symbol, rows in state.stale_orders.items():
        before = {identity for row in previous.get(symbol, ()) for identity in row}
        for row in rows:
            name = "unknown_orders" if before.intersection(row) else "stale_orders"
            found.setdefault(name, {}).setdefault(symbol, []).append(row)


def judge(session, cache, snapshot: dict) -> None:
    state = session.connection
    contract(session, snapshot)
    found = compare(snapshot, cache, session.manifest)
    settle_stale(state, found)
    if state.reconnected is not None and not state.bar_since_reconnect:
        found.setdefault("bars", []).append("no bar since the reconnect")
    rewarming = rewarm_pending(session, cache)
    checking = bool(state.closed) and set(state.closed) <= RECOVERABLE or rewarming
    observation = None
    if found or checking:
        # Kept when it disagrees or decides a check; a periodic agreement adds nothing to keep.
        observation = keep(session.output, "compare-account", snapshot)
    session.event("comparison", strict=False, agreed=not found, found=found, observation=observation,
                  entries=gate_reason(session))
    if not found:
        state.suspect, state.phantom_ns = False, None
        orphans(session, cache, snapshot["observed_ns"])
        if not checking:
            return
        if state.agreed is None:
            state.agreed = snapshot["observed_ns"]
        elif snapshot["observed_ns"] - state.agreed >= (COMPARE_SPACING_SECONDS - 1) * 1_000_000_000:
            # Two agreeing reads since the gap: the venue holds nothing the cache does not know.
            rewarm(session) if rewarming else open_entries(session)
        return
    state.agreed = None
    if "positions" in found and phantom(session, cache, snapshot):
        # Two reads a native position check apart both find Binance flat and the cache holding a position: no fill in
        # flight explains that, and native reconciliation had its cycle. The run ends there (venue_flat_exit).
        if state.phantom_ns is not None and \
                snapshot["observed_ns"] - state.phantom_ns >= (COMPARE_SPACING_SECONDS - 1) * 1_000_000_000:
            venue_flat_exit(session, snapshot)
            return
        if state.phantom_ns is None:
            state.phantom_ns = snapshot["observed_ns"]
    else:
        state.phantom_ns = None
    if "unknown_orders" in found:
        state.suspect = state.suspect or "stale_orders" in found  # another contract's: the next read settles it soon
        close_entries(session, "unknown_orders", orders=found["unknown_orders"])
        for symbol in found["unknown_orders"]:
            source = session.sources.get(symbol)
            if source is not None:
                # Every order on the contract, at the venue (HTTP cancel-all for regular and conditional orders):
                # the cache cannot say which of them protect a position.
                Strategy.cancel_all_orders(source, contract_id(symbol), None, None, False)
        return
    for reason in ("account_mode", "foreign"):
        if reason in found:
            close_entries(session, reason)
    if entries_open(session):
        # An order or fill in flight disagrees for a moment: a second disagreeing read, soon after, closes entries.
        if state.suspect:
            close_entries(session, "unverified")
        state.suspect = True
    elif "stale_orders" in found:
        state.suspect = True  # the next read settles it soon, whatever holds entries closed


def orphans(session, cache, observed_ns: int) -> None:
    """Flat after a missing bar, with reduce-only orders that Binance still holds (this read agreed with the cache):
    the run cannot warm up again while they stay. After ORPHAN_NS the user is told once; nothing cancels them and
    entries stay closed (the user, 2026-11-13)."""
    state = session.connection
    left = [order for order in owned(cache.orders, session.manifest) if not order.is_closed]
    if "bars_missing" not in state.closed or owned(cache.positions_open, session.manifest) or not left \
            or not all(order.is_reduce_only for order in left):
        state.orphans_since = None
        state.notified.discard("orphans")
        return
    if state.orphans_since is None:
        state.orphans_since = observed_ns
    elif observed_ns - state.orphans_since >= ORPHAN_NS - ORPHAN_SLACK_NS and "orphans" not in state.notified:
        state.notified.add("orphans")
        session.event("orphan_orders", strict=False, orders=sorted(str(order.client_order_id) for order in left),
                      seconds=(observed_ns - state.orphans_since) // 10**9)


HELD_READ_SECONDS = 30
# Binance's names of the order types engine.protection counts as stops, as its native names.
VENUE_STOPS = {"STOP_MARKET": "STOP_MARKET", "STOP": "STOP_LIMIT", "TRAILING_STOP_MARKET": "TRAILING_STOP_MARKET"}


def held_cover(snapshot: dict) -> dict:
    """What one account read shows a held run to lack. `positions`: each side of a contract that holds more than the
    stops at Binance that close it (engine.protection's judgment on the venue's own rows, conditional and regular
    orders alike; a Hedge order closes the side it names when it sells a LONG or buys a SHORT). `entries`: the
    orders at Binance that would open or add to a position, which no process would protect once filled. Both empty:
    every position has its stops and nothing can add to one. `holding`: how many sides of contracts hold a position
    (none: only orders keep the account from flat)."""
    try:
        held: dict[tuple[str, str], Decimal] = {}
        for row in snapshot["positions"]:
            amount = Decimal(row["positionAmt"])
            if amount:
                side = row["positionSide"] if row["positionSide"] in ("LONG", "SHORT") else \
                    "LONG" if amount > 0 else "SHORT"
                held[row["symbol"], side] = held.get((row["symbol"], side), Decimal(0)) + abs(amount)
        closing: dict[tuple[str, str], list[protection.Order]] = {}
        entries = []
        for row in (*snapshot["orders"], *snapshot["algo_orders"]):
            side = row.get("positionSide", "BOTH")
            if side in ("LONG", "SHORT"):
                closes = row["side"] == ("SELL" if side == "LONG" else "BUY")
            else:  # a one-way row names no side: a reduce-only order closes the side opposite its own
                closes = row.get("reduceOnly") is True or row.get("closePosition") is True
                side = "LONG" if (row["side"] == "SELL") == closes else "SHORT"
            key = (row["symbol"], side)
            if not closes:
                entries.append({"symbol": row["symbol"], "side": side})
                continue
            kind = row["type"] if "type" in row else row["orderType"]  # openAlgoOrders rows say `type` too
            if row.get("closePosition") is True:
                leaves = held.get(key, Decimal(0))  # closes whatever the side holds
            elif "quantity" in row:  # a conditional order
                leaves = Decimal(row["quantity"])
            else:
                leaves = Decimal(row["origQty"]) - Decimal(row.get("executedQty", "0"))
            closing.setdefault(key, []).append(
                protection.Order(row["side"], VENUE_STOPS.get(kind, kind), True, "ACCEPTED", leaves))
        positions = []
        for (symbol, side), quantity in sorted(held.items()):
            stops = protection.stop_quantity(quantity if side == "LONG" else -quantity, closing.get((symbol, side), ()))
            if stops < quantity:
                positions.append({"symbol": symbol, "side": side, "position": str(quantity), "stops": str(stops)})
    except (KeyError, TypeError, ValueError, ArithmeticError) as exc:
        raise Refusal("LIVE_ACCOUNT_RESPONSE", "the venue did not supply complete position/order observations") from exc
    return {"holding": len(held), "positions": positions,
            "entries": sorted(entries, key=lambda row: (row["symbol"], row["side"]))}


def held_verdict(session, snapshot: dict, observation: str | None = None) -> None:
    """Journal what a held run's account read shows, once per change: `held_covered`, or `held_uncovered` with the
    positions short of stops and the entry orders still working. `entries_kept`: the read began after this start
    asked for its inherited entries' cancels (held_withdraw) and still shows entry orders, so they could not be
    withdrawn. `unreadable`: the answer's rows could not be judged, which shows no stop either. (A read that failed
    is not judged at all: held_tick reads again.)"""
    state = session.connection
    try:
        found = held_cover(snapshot)
        kept = bool(found["entries"]) and state.withdrawn_ns is not None and snapshot["observed_ns"] > state.withdrawn_ns
        verdict = {**found, "entries_kept": kept, "unreadable": False}
    except (Refusal, KeyError, TypeError):
        verdict = {"holding": None, "positions": [], "entries": [], "entries_kept": False, "unreadable": True}
    if verdict == state.held_cover:
        return
    state.held_cover = verdict
    observation = observation or keep(session.output, "held-account", snapshot)
    if verdict["positions"] or verdict["entries"] or verdict["unreadable"]:
        session.event("held_uncovered", strict=False, observation=observation, **verdict)
    else:
        session.event("held_covered", strict=False, observation=observation, holding=verdict["holding"])


def held_withdraw(session, cache, now: float) -> None:
    """A held start withdraws the entry orders it inherited: no source will place a stop behind their fills. Each
    gets a native cancel through the run's registered identity, repeated while the order stays open
    (Session.cancel_open). An order at Binance the native cache does not hold cannot be cancelled from here; the
    account reads say whether any entry order is still working (held_verdict)."""
    from engine.live_commands import pending_orders
    state = session.connection
    for order in owned(lambda strategy_id: pending_orders(cache, strategy_id), session.manifest):
        if order.is_reduce_only:
            continue
        cid = str(order.client_order_id)
        first = cid not in session.canceled
        try:
            session.cancel_open(cache, [order], now)
        except Exception as exc:
            session.canceled[cid] = now  # asked again after the usual interval
            if cid not in state.withdraw_failed:
                state.withdraw_failed.add(cid)
                session.event("entry_cancel_failed", reason="held", client_order_id=cid,
                              failure_type=type(exc).__name__, strict=False)
        else:
            if first:
                session.event("entry_cancel_requested", reason="held", client_order_id=cid, strict=False)
    if state.withdrawn_ns is None:
        state.withdrawn_ns = time.time_ns()


def held_tick(session, now: float) -> None:
    """A resumed run holding around an open position reads the account until it is flat (its exchange stops, or the
    user at Binance); then it ends this start so the next one trades again (engine.live, design §3.4). Each read
    that is not flat is judged for stops and working entries (held_verdict)."""
    from engine import live_commands as commands
    state = session.connection
    if state.observation is None:
        if state.last_compare is None or now - state.last_compare >= HELD_READ_SECONDS:
            state.last_compare = now
            state.observation = commands.observe_account(session, "held")
        return
    try:
        snapshot = commands.observed_account(session, "held", state.observation)
    except Refusal:
        state.observation = None
        return
    if snapshot is None:
        return
    state.observation = None
    try:
        require_flat(snapshot)
    except Refusal as exc:
        if exc.code == "LIVE_ACCOUNT_NOT_FLAT":
            held_verdict(session, snapshot)
        return
    observation = keep(session.output, "held-account", snapshot)
    session.held_flat = True
    session.event("venue_flat_while_held", strict=False, observation=observation)
    session.begin_stop("held_flat")


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
