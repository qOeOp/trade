"""A lost Binance connection closes entries; it no longer ends the run.

docs/plans/live-continuous-operation-design-20261110.zh.md §3.2. While any Binance socket is down, and until the venue
and the native cache agree again, entries are closed: working entries are withdrawn. An entry the source submits, or
one still waiting for its account check, is held unsent (docs/plans/live-entry-hold-20261113.zh.md): it is sent once,
unchanged, when the gate reopens within HOLD_NS of its decision and before the source receives another bar of the
type it decided on; otherwise the run ends as for any refused entry (rc7's Python Strategy has no native deny_order,
and the source cannot see a product refusal). A gate closed for a reason a check cannot clear refuses at once, except a
missing bar and a contract not TRADING at Binance (the user, 2026-11-13): an entry staged then, and a new one (after a
missing bar, while a position is held), are denied natively through the run's own ExecutionAlgorithm (OrderDenied, which
the source receives), and the run goes on. So is an entry whose own account read finds the clock over its limit.
Reductions, cancels and closes travel over REST and stay allowed, so the source keeps protecting and exiting its
positions and the Observer can still stop.

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
import json
import re
import time
from typing import Any

from nautilus_trader.model import ClientId, InstrumentId, OrderStatus, PositionSide, TimeInForce
from nautilus_trader.common import SocketState
from nautilus_trader.trading import Strategy

from engine.live_errors import LiveRefusal as Refusal
from engine.live_records import source_strategy_id, write_json
from engine.live_venue import require_account_mode, require_clock, require_own_symbol
from engine.order_rules import GTD_MINIMUM_NS, WARMING

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
SEND_MARGIN_NS = 5_000_000_000  # a GTD entry is sent with at least GTD_MINIMUM_NS plus this left
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
    orphans_since: int | None = None  # observed_ns of the first agreeing read finding only reduce-only orders, flat


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


def refuse(session, reason: str) -> None:
    """An entry while the gate is closed: refused, and the run ends (engine.live_source's admission path)."""
    raise Refusal("LIVE_CONNECTION_UNVERIFIED", f"entries are closed ({reason}) until the venue and the native cache "
                                                "agree again")


def holdable(session) -> bool:
    """The gate is closed only for reasons a check can clear: an entry may wait for it."""
    closed = session.connection.closed
    return bool(closed) and set(closed) <= RECOVERABLE


def deniable(session) -> bool:
    """The gate is closed for a missing bar and for no other reason a check cannot clear: an entry is denied natively
    and the run goes on (the user, 2026-11-13)."""
    lasting = set(session.connection.closed) - RECOVERABLE
    return bool(lasting) and lasting <= DENIABLE


def deny(session, order, detail: str, held_ns: int | None = None, reason: str | None = None) -> None:
    """Deny an entry natively, never sent: the run's ExecutionAlgorithm gives the source's order OrderDenied in the
    native cache and its callbacks (engine.live_node). That OrderDenied is not a native failure (denied_entries). An
    order the cache already knows, or one submitted from within a denial's callbacks, is refused instead."""
    if session.entry_gate is None or session.denying:
        raise Refusal("LIVE_CONNECTION_UNVERIFIED", f"entries are closed ({gate_reason(session)}) and the entry "
                                                    "cannot be denied natively")
    cid = str(order.client_order_id)
    if session.source is not None and Strategy.cache.__get__(session.source, type(session.source)).order(
            order.client_order_id) is not None:
        raise Refusal("LIVE_ORDER_UNSUPPORTED", "an order the native cache already holds is not a new entry")
    session.denied.add(cid)  # before the call: its callbacks run at once
    session.denying = True
    try:
        session.entry_gate.deny_order(order, reason or gate_reason(session))
    except BaseException:
        session.denied.discard(cid)
        raise
    finally:
        session.denying = False
    session.event("entry_denied", strict=False, detail=detail, reasons=sorted(session.connection.closed),
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


def deny_staged(session, reason: str) -> None:
    """Entries staged when a missing bar closed the gate (waiting for their account check, or held): each is denied
    natively, never sent, and the run goes on."""
    if session.entry_gate is None:
        deny_queued(session, reason)
        return
    observation, session.account_observation = session.account_observation, None
    if observation is not None:
        observation.result.cancel()
    while session.pending_entries:
        pending = session.pending_entries.pop(0)
        held = time.time_ns() - pending.order.ts_init if pending.deadline_ns is not None else None
        try:
            deny(session, pending.order, reason, held)
        except Exception as exc:
            # Not denied: this one and the rest are refused like any entry, and the run ends.
            refused(session, pending, getattr(exc, "code", type(exc).__name__), str(exc)[:1000])
            from engine import live_commands as commands  # engine.live_commands imports this module
            commands.discard_observation(session, "LIVE_CONNECTION_UNVERIFIED", reason)
            session.failed = True
            session.begin_stop("entry_admission_failed")
            return


def deadline(order) -> int:
    """The latest send time of a held entry: HOLD_NS after its decision, and early enough for a GTD order's
    send-time rule."""
    found = order.ts_init + HOLD_NS
    if order.time_in_force == TimeInForce.GTD:
        found = min(found, order.expire_time_ns - GTD_MINIMUM_NS - SEND_MARGIN_NS)
    return found


def entry_fields(order) -> dict:
    return {"client_order_id": str(order.client_order_id), "ts_init": order.ts_init, "side": order.side.name,
            "type": order.order_type.name, "price": str(order.price) if getattr(order, "has_price", False) else None,
            "trigger_price": str(order.trigger_price) if getattr(order, "has_trigger_price", False) else None,
            "quantity": str(order.quantity),
            "expire_time_ns": order.expire_time_ns if order.time_in_force == TimeInForce.GTD else None}


def hold(session, pending) -> None:
    """Hold an admitted entry unsent while the gate is closed for recoverable reasons; no account observation runs."""
    if pending.deadline_ns is None:
        pending.deadline_ns = deadline(pending.order)
        session.event("entry_held", strict=False, reasons=sorted(session.connection.closed),
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
    if order.time_in_force == TimeInForce.GTD and order.expire_time_ns - now < GTD_MINIMUM_NS + SEND_MARGIN_NS:
        raise Refusal("LIVE_ORDER_UNSUPPORTED", "a GTD entry is sent with at least 605 seconds left")
    if pending.deadline_ns is not None and now > pending.deadline_ns:
        raise Refusal("LIVE_CONNECTION_UNVERIFIED", "entry_hold_expired: the gate did not reopen in time")


def refused(session, pending, code: str, detail: str | None) -> None:
    held = time.time_ns() - pending.order.ts_init if pending.deadline_ns is not None else None
    session.event("entry_refused", strict=False, code=code, detail=detail, reasons=sorted(session.connection.closed),
                  held_ns=held, **entry_fields(pending.order))


def deny_queued(session, reason: str, detail: str | None = None) -> None:
    """Entries still waiting to be sent are refused like a new one, so the run ends."""
    if session.pending_entries:
        from engine import live_commands as commands  # engine.live_commands imports this module
        commands.discard_observation(session, "LIVE_CONNECTION_UNVERIFIED", detail or reason)
        session.failed = True
        session.begin_stop("entry_admission_failed")


def held_bar(session, bar) -> bool:
    """A bar of the type a held entry was decided on, while it is unsent, ends the run before the source sees it:
    the source never decides again on an entry the native cache does not hold yet."""
    if any(pending.deadline_ns is not None and pending.bar_type in (None, bar.bar_type)
           for pending in session.pending_entries):
        deny_queued(session, gate_reason(session), "entry_hold_bar")
        return True
    return False


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
    """Continuity of the external bars the source receives: a missing one closes entries until a restart warms the
    source up again (rewarm)."""
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
        # The source is rebuilt by the next start (rewarm): its working entries go now, while this process still
        # protects a fill; positions keep their exits (design §3.2 item 3).
        close_entries(session, "bars_missing", bar_type=kind, after_ns=previous, received_ns=bar.ts_event)


SWITCH = "SWITCH"  # the control's file for a confirmed new runtime image (engine.live RUNNER_CONTRACT 2)


def switch_requested(session) -> bool:
    """The user confirmed a new runtime image (live.control runtime_switch): the run takes it at its next flat moment
    (design §3.8, the user 2026-11-13). The control writes and removes SWITCH beside STOP."""
    return (session.output / SWITCH).exists()


def rewarm_due(session) -> bool:
    """rewarm_pending without the cache: the reason to end this start once the strategy holds nothing."""
    closed = session.connection.closed
    if session.mode != "run" or session.stopping or session.pending_entries \
            or not set(closed) - {"bars_missing"} <= RECOVERABLE:
        return False
    return "bars_missing" in closed or session.switch_withheld or (
        str(source_strategy_id(session.manifest)) not in WARMING and switch_requested(session))


def rewarm_pending(session, cache) -> bool:
    """A missing bar closed entries, or the user asked for a new runtime image once the warmed-up source holds nothing
    (switch_requested); nothing else holds entries closed that a restart's own checks would not clear, and this
    strategy holds nothing: no position, no order, no entry waiting to be sent. Its source decides on nothing more (it
    is rebuilt by the next start) and the venue comparison decides the restart (design §3.2 item 3, §3.8)."""
    if not rewarm_due(session):
        return False
    strategy = source_strategy_id(session.manifest)
    return not cache.positions_open(strategy_id=strategy) and not any(
        not order.is_closed for order in cache.orders(strategy_id=strategy))


def rewarm(session) -> None:
    """End this start without closing anything; the control starts the run again (engine.live INTERRUPTED), on the new
    runtime image if one was asked for, and its warm-up reads Binance's complete bars: the data is not patched."""
    session.rewarming = True
    session.switching = session.switch_withheld or switch_requested(session)
    session.begin_stop("rewarming")


def compare(snapshot: dict, cache, manifest: dict) -> dict[str, list]:
    """What the venue's REST read and the native cache disagree on; empty when they agree."""
    found: dict[str, list] = {}
    symbol = manifest["symbols"][0]
    instrument = InstrumentId.from_str(f"{symbol}-PERP.BINANCE")
    strategy = source_strategy_id(manifest)
    for check, name in ((require_account_mode, "account_mode"), (require_own_symbol, "foreign"),
                        (lambda read, _: require_clock(read), "clock")):
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
        if checking or state.suspect else CONTRACT_SECONDS if "contract_status" in state.closed else PERIODIC_SECONDS
    if now - state.last_compare >= interval:
        state.last_compare = now
        state.observation = commands.observe_account(session.account_reader, tuple(session.manifest["symbols"]),
                                                     "compare")
    elif not state.closed:
        renew(session, observer, now)


def contract(session, snapshot: dict) -> None:
    """Binance's status of the run's contract, from a comparison's read or an entry's own (the user, 2026-11-13):
    not TRADING closes entries, and an entry is then denied natively and the run goes on; working entries and
    positions with their exchange stops stay. Back at TRADING, entries reopen once the account check passes."""
    try:
        status = snapshot["symbols"][session.manifest["symbols"][0]]["instrument"]["status"]
    except (KeyError, TypeError, IndexError):
        return  # an incomplete read says nothing about the contract
    if not isinstance(status, str) or not re.fullmatch(r"[A-Z_]{1,40}", status):
        return
    state = session.connection
    if status != "TRADING":
        close_entries(session, "contract_status", withdraw=False, status=status)
    elif "contract_status" in state.closed:
        del state.closed["contract_status"]
        state.closed.setdefault("unverified", time.monotonic())
        state.agreed = None
        session.event("entries_checking", strict=False, reasons=sorted(state.closed), status=status)


def judge(session, cache, snapshot: dict) -> None:
    state = session.connection
    contract(session, snapshot)
    found = compare(snapshot, cache, session.manifest)
    if state.reconnected is not None and not state.bar_since_reconnect:
        found.setdefault("bars", []).append("no bar since the reconnect")
    rewarming = rewarm_pending(session, cache)
    checking = bool(state.closed) and set(state.closed) <= RECOVERABLE or rewarming
    observation = None
    if found or checking:
        # Kept when it disagrees or decides a check; a periodic agreement adds nothing to keep.
        observation = "compare-account-" + str(snapshot["observed_ns"]) + ".json"
        write_json(session.output / observation, snapshot)
    session.event("comparison", strict=False, agreed=not found, found=found, observation=observation,
                  entries=gate_reason(session))
    if not found:
        state.suspect = False
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


def orphans(session, cache, observed_ns: int) -> None:
    """Flat after a missing bar, with reduce-only orders that Binance still holds (this read agreed with the cache):
    the run cannot warm up again while they stay. After ORPHAN_NS the user is told once; nothing cancels them and
    entries stay closed (the user, 2026-11-13)."""
    state, strategy = session.connection, source_strategy_id(session.manifest)
    left = [order for order in cache.orders(strategy_id=strategy) if not order.is_closed]
    if "bars_missing" not in state.closed or cache.positions_open(strategy_id=strategy) or not left \
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


def held_tick(session, now: float) -> None:
    """A resumed run holding around an open position reads the account until it is flat (its exchange stops, or the
    user at Binance); then it ends this start so the next one trades again (engine.live, design §3.4)."""
    from engine import live_commands as commands
    from engine.live_venue import require_flat
    state = session.connection
    if state.observation is None:
        if state.last_compare is None or now - state.last_compare >= HELD_READ_SECONDS:
            state.last_compare = now
            state.observation = commands.observe_account(session.account_reader, tuple(session.manifest["symbols"]),
                                                         "held")
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
    except Refusal:
        return
    observation = "held-account-" + str(snapshot["observed_ns"]) + ".json"
    write_json(session.output / observation, snapshot)
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
