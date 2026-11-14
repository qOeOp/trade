"""Run-local lifecycle state and evidence; orders and positions stay in native cache."""
from __future__ import annotations
from dataclasses import dataclass, field
from decimal import Decimal
import json
import os
from pathlib import Path
import tempfile
import threading
import time
from typing import Any
from nautilus_trader.model import OrderStatus, PositionSide
from nautilus_trader.trading import Strategy
from engine import protection, strategy as strategy_runtime
from engine.live_errors import LiveRefusal as Refusal
from engine.live_brake import Brake
from engine.live_connection import Connection
from engine.live_evidence import Evidence
from engine import live_commands as commands
from engine.live_commands import AccountObservation, PendingEntry, pending_orders
from engine.config import symbol_of
from engine.live_records import owned, strategy_ids

STOP_GRACE_SECONDS = 30
CANCEL_RETRY_SECONDS = 5
# engine.protection's allowance plus its Live detection lag. A false alarm flattens a healthy trade.
PROTECTION_SECONDS = (protection.ALLOWANCE_NS + protection.LIVE_DETECTION_NS) // 1_000_000_000
MARK_SECONDS = 60  # With a position open and no mark for this long, the run stops (design §3.2.4).


@dataclass
class Session:
    manifest: dict
    output: Path
    mode: str
    stop_requested: threading.Event = field(default_factory=threading.Event)
    # SIGTERM or SIGINT (Docker stop, a host shutdown): entries are withdrawn, positions and their exchange stops stay,
    # and the same run resumes when its runner starts again (design §3.4).
    interrupt_requested: threading.Event = field(default_factory=threading.Event)
    interrupting: bool = False
    held_flat: bool = False  # a held resume saw the venue flat: the next start trades again
    rewarming: bool = False  # a missing bar while flat: the next start warms the source up again
    switching: bool = False  # this rewarming was for the new runtime image the user confirmed (SWITCH)
    switch_withheld: bool = False  # a bar was withheld for SWITCH: this start ends through rewarm, even if canceled
    # This start follows one that ended to warm up again (engine.live warmup_retry): if its warm-up fails, the run
    # starts once more instead of ending (the user, 2026-11-13); warmup_retried says this start does so.
    warmup_retry: bool = False
    warmup_retried: bool = False
    armed_ns: int | None = None  # a resumed run's first arming: its duration counts from there, across starts
    node: Any = None
    sources: dict[str, Any] = field(default_factory=dict)  # the run's instances: contract -> instance (engine.live_source)
    entry_gate: Any = None  # the native ExecutionAlgorithm that denies entries (engine.live_connection.deny)
    denied: set[str] = field(default_factory=set)  # client order IDs of the entries it denied in this start
    denying: bool = False  # inside a denial's native callbacks
    started: float | None = None
    stopping: bool = False
    stop_at: float | None = None
    native_flat: bool = False
    failed: bool = False
    native_order_failure: bool = False
    persistence_failed: bool = False
    journal_failed: bool = False
    account_reader: Any = None
    account_observation: AccountObservation | None = None
    pending_entries: list[PendingEntry] = field(default_factory=list)  # entries not yet sent, in order
    deciding: Any = None  # the bar type of the bar the source is handling (engine.live_source)
    account_verified: bool = False
    connection_failed: bool = False  # the connected start could not be verified; a later disconnect only closes entries
    connection: Connection = field(default_factory=Connection)  # the entry gate (engine.live_connection)
    brake: Brake = field(default_factory=Brake)  # the drawdown brake and cash floor (engine.live_brake)
    cache_guard: Any = None
    canceled: dict[str, float] = field(default_factory=dict)
    exits: set[str] = field(default_factory=set)
    protection_gaps: dict[str, float] = field(default_factory=dict)
    marks: dict[str, tuple[float, Any]] = field(default_factory=dict)  # contract -> when its latest mark arrived, its value
    exposed_since: dict[str, float] = field(default_factory=dict)  # contract -> since when the run holds a position on it
    warmup_catalog: Path | None = None  # the run's temporary Catalog of warm-up bars (engine.history)
    evidence: Evidence = field(init=False)

    def __post_init__(self):
        self.evidence = Evidence(self.output, lambda part, failure: self.event(
            "evidence_unavailable", strict=False, part=part, failure_type=failure))

    def catalog(self) -> Path:
        """The run's temporary Catalog of warm-up bars (engine.history), made once."""
        if self.warmup_catalog is None:
            self.warmup_catalog = Path(tempfile.mkdtemp(prefix="live-warmup-"))
        return self.warmup_catalog

    def event(self, event: str, *, strict: bool = True, **fields) -> bool:
        # venue_flat is not guarded: its evidence is Binance's whole account, not this process's native state.
        if event in {"clean_stop", "reconciled_flat"} and (
                self.persistence_failed or self.journal_failed or self.connection_failed):
            raise Refusal("LIVE_JOURNAL_UNAVAILABLE", "failed persistence cannot publish a clean terminal event")
        try:
            row = {"event": event, "run_id": self.manifest["run_id"], "observed_ns": time.time_ns(), **fields}
            with (self.output / "events.jsonl").open("a", encoding="utf-8") as stream:
                stream.write(json.dumps(row, sort_keys=True, default=str) + "\n")
                stream.flush()
                os.fsync(stream.fileno())
            return True
        except (OSError, ValueError, TypeError):
            self.failed, self.journal_failed, self.native_flat = True, True, False
            if not self.stopping:
                self.stopping, self.stop_at = True, time.monotonic()
            if strict:
                raise Refusal("LIVE_JOURNAL_UNAVAILABLE", "the private journal cannot persist lifecycle evidence") from None
            return False

    def begin_stop(self, reason: str, *, source_reason: str | None = None) -> None:
        if not self.stopping:
            self.stopping, self.stop_at = True, time.monotonic()
            self.event("stopping", reason=reason, source_reason=source_reason, strict=False)
        elif source_reason is not None:
            self.event("source_shutdown", source_reason=source_reason, strict=False)

    def check_storage(self) -> bool:
        if self.persistence_failed or self.journal_failed:
            return False
        try:
            if self.cache_guard is not None:
                self.cache_guard.health()
            return True
        except (Refusal, OSError):
            self.failed, self.persistence_failed, self.native_flat = True, True, False
            self.begin_stop("persistence_failure")
            self.event("unresolved", reason="persistence_failure", strict=False)
            return False

    def observe_stop_intent(self) -> bool:
        """Apply operator intent at dispatch/submission, without waiting for a timer."""
        if self.rewarming and (strategy_runtime.FAILURES or self.stop_requested.is_set()
                               or (self.output / "STOP").exists() or self.duration_reached()):
            self.rewarming = self.stopping = False  # a stop that ends the run supersedes starting it again
            self.failed = self.failed or self.warmup_retried  # a warm-up that failed and is not tried again
        if strategy_runtime.FAILURES:
            self.failed = True
            self.begin_stop("source_failure")
        elif self.stop_requested.is_set() or (self.output / "STOP").exists():
            self.begin_stop("requested")
        elif self.interrupt_requested.is_set() and not self.stopping:
            self.interrupting = True
            self.begin_stop("interrupted")
        elif self.duration_reached():
            self.begin_stop("duration")
        return self.stopping

    def duration_reached(self) -> bool:
        duration = self.manifest["config"]["duration_seconds"]
        return duration is not None and (
            time.time_ns() - self.armed_ns >= duration * 10**9 if self.armed_ns is not None
            else self.started is not None and time.monotonic() - self.started >= duration)

    def owner(self, strategy_id):
        """The instance of `strategy_id`, which sends its orders' commands."""
        return next((self.sources.get(symbol) for symbol, found in strategy_ids(self.manifest).items()
                     if found == strategy_id), None)

    def any_source(self):
        """An instance for native commands that belong to no one strategy (account queries)."""
        return next(iter(self.sources.values()), None)

    def check_protection(self, cache, now: float) -> None:
        """engine.protection on the native cache (native orders keep reduce-only; Binance Hedge orders carry none)."""
        try:
            gaps = {}
            for position in owned(cache.positions_open, self.manifest):
                quantity = position.quantity.as_decimal()
                held = quantity if position.side == PositionSide.LONG else -quantity
                if not protection.covered(held, protection.of_position(cache, position)):
                    gaps[str(position.id)] = self.protection_gaps.get(str(position.id), now)
        except Exception as exc:
            self.failed = True
            self.event("protection_unverified", strict=False, failure_type=type(exc).__name__)
            self.begin_stop("protection_unverified")
            return
        self.protection_gaps = gaps
        late = sorted(key for key, since in gaps.items() if now - since >= PROTECTION_SECONDS)
        if late:
            self.failed = True
            self.event("protection_missing", strict=False, positions=late)
            self.begin_stop("protection_missing")

    def check_mark(self, cache, now: float) -> bool:
        """Whether a position of the run is open; with one open on a contract and no mark price of that contract for
        MARK_SECONDS (a lost market stream) the run takes the STOP path, failed. The drawdown brake reads the venue
        (engine.live_brake)."""
        try:
            exposed = {symbol_of(position.instrument_id) for position in owned(cache.positions_open, self.manifest)}
        except Exception as exc:
            self.failed = True
            self.event("exposure_unverified", strict=False, failure_type=type(exc).__name__)
            self.begin_stop("exposure_unverified")
            return True
        self.exposed_since = {symbol: self.exposed_since.get(symbol, now) for symbol in exposed}
        late = {symbol: since for symbol, since in self.exposed_since.items() if now - since >= MARK_SECONDS
                and not (symbol in self.marks and now - self.marks[symbol][0] < MARK_SECONDS)}
        if late:
            self.failed = True
            self.event("mark_missing", strict=False, seconds=int(now - min(late.values())), symbols=sorted(late))
            self.begin_stop("mark_missing")
        return bool(exposed)

    def record_minute(self, cache, minute_ns: int, prices: dict) -> None:
        """The run's result from native fills at a minute's first mark price (contract -> price), or when the run
        stops, for the chart of its account: only read and journalled, no check, stop or order follows from it.
        Unknown while a position is open without a price of its contract, or when it cannot be read."""
        result = None
        try:
            positions = owned(cache.positions, self.manifest)
            if all(symbol_of(position.instrument_id) in prices for position in positions if position.is_open):
                result = str(run_result(cache, positions, prices))
        except Exception:
            pass
        self.event("minute_result", strict=False, minute_ns=minute_ns, result=result)


    def lose_connection(self, reason: str) -> None:
        # The connected start could not be verified, so nothing was ever admitted: stop. A disconnect after the start
        # only closes entries (engine.live_connection). Keep existing venue orders and cache custody.
        self.account_verified, self.connection_failed, self.failed, self.native_flat = False, True, True, False
        commands.discard_observation(self)
        # Stop native command producers before any journal I/O or the node's asynchronous
        # stop-check. The native manage_stop=False check makes this a local lifecycle stop;
        # residual fills still update the execution cache and native logs.
        try:
            self.cancel_entries(reason)
            for source in self.sources.values():
                if Strategy.is_running(source):
                    Strategy.stop(source)
        finally:
            self.begin_stop(reason)
            self.event("unresolved", reason=reason, strict=False)
            self.node.handle().stop()

    def resend_cancel(self, cache, order) -> bool:
        """Native cancel_order sends nothing for an order already PENDING_CANCEL, so after a request
        with an unknown outcome only cancel-all reaches the venue, and rc7 scopes it by side alone.
        Under HEDGING that side can carry reduce-only orders protecting open positions; while one does,
        the resend is withheld and the order stays unresolved rather than strip their protection."""
        if cache.positions_open(instrument_id=order.instrument_id):
            kept = [str(other.client_order_id) for other in cache.orders_open(instrument_id=order.instrument_id,
                                                                              side=order.side)
                    if other.is_reduce_only and other.client_order_id != order.client_order_id]
            if kept:
                self.event("cancel_resend_withheld", client_order_id=str(order.client_order_id),
                           reduce_only=kept, strict=False)
                return False
        Strategy.cancel_all_orders(self.owner(order.strategy_id), order.instrument_id, order.side, None, False)
        return True

    def cancel_entries(self, reason: str) -> None:
        """Withdraw working entries when no process will protect a later fill.

        Orders travel over REST, so a lost socket does not block this request. It bypasses the
        source's closed command gate and leaves reduce-only protection on the venue. The outcome
        may never be observed: the run stays unresolved, and the next read of the venue decides.
        """
        source = self.any_source()
        if source is None:
            return
        cache = Strategy.cache.__get__(source, type(source))
        for order in owned(lambda strategy_id: pending_orders(cache, strategy_id), self.manifest):
            if order.is_reduce_only:
                continue
            cid = str(order.client_order_id)
            try:
                if order.status != OrderStatus.PENDING_CANCEL:
                    Strategy.cancel_order(self.owner(order.strategy_id), order.client_order_id)
                elif not self.resend_cancel(cache, order):
                    continue
            except Exception as exc:
                self.event("entry_cancel_failed", reason=reason, client_order_id=cid,
                           failure_type=type(exc).__name__, strict=False)
            else:
                self.event("entry_cancel_requested", reason=reason, client_order_id=cid, strict=False)

    def cancel_open(self, cache, orders: list, now: float) -> None:
        """Cancelling is idempotent, so a lost or rejected request is repeated while the order is open."""
        for order in orders:
            cid = str(order.client_order_id)
            if cid in self.canceled and now - self.canceled[cid] < CANCEL_RETRY_SECONDS:
                continue
            if order.status != OrderStatus.PENDING_CANCEL:
                self.owner(order.strategy_id).cancel_order(order.client_order_id)
            elif cid in self.canceled:
                self.resend_cancel(cache, order)
            self.canceled[cid] = now

    def observe_source_state(self) -> None:
        """A source that stopped itself receives no fills, so it can neither protect nor exit."""
        if not self.stopping and any(not Strategy.is_running(source) for source in self.sources.values()):
            self.failed = True
            self.begin_stop("source_not_running")


def run_result(cache, positions, prices: dict) -> Decimal:
    """`positions`' realized result and, at its contract's price in `prices`, the open ones' unrealized result, from
    native fills. A position that closes and reopens restarts its realized result; earlier cycles are in snapshots."""
    return sum(((position.total_pnl(prices[symbol_of(position.instrument_id)]) if position.is_open
                 else position.realized_pnl).as_decimal() + sum(
        (snapshot.realized_pnl.as_decimal() for snapshot in cache.position_snapshots(position_id=position.id)),
        Decimal(0)) for position in positions), Decimal(0))
