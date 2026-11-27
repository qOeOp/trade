"""Run-local lifecycle state and evidence; orders and positions stay in native cache."""
from __future__ import annotations
from collections import Counter
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
from engine import live_connection
from engine.live_connection import Connection
from engine.live_stop import UNFAILED
from engine.live_evidence import Evidence
from engine import live_commands as commands
from engine.live_commands import AccountObservation, PendingEntry, pending_orders
from engine.config import symbol_of
from engine.live_records import owned, strategy_ids
from engine.order_rules import native_cache

STOP_GRACE_SECONDS = 30
CANCEL_RETRY_SECONDS = 5
# engine.protection's allowance plus its Live detection lag. A false alarm flattens a healthy trade.
PROTECTION_NS = protection.ALLOWANCE_NS + protection.LIVE_DETECTION_NS
# An order Binance's answer to its submission did not settle stays SUBMITTED (engine.live_node retains it: rc7
# SubmissionRecoveryPolicy.RETAIN_UNRESOLVED, which stops the native per-order queries once its in-flight check of about
# 30 s is spent). From SUBMISSION_QUERY_SECONDS on the run asks the venue for it natively (Strategy.query_order) every
# SUBMISSION_QUERY_SECONDS, which settles an order Binance holds or filled, and entries close until it is settled and
# the venue agrees (engine.live_connection, "unverified"); one still SUBMITTED after
# SUBMISSION_UNRESOLVED_SECONDS takes the STOP path, failed: nothing the run can read says whether it reached Binance.
SUBMISSION_QUERY_SECONDS = 10
SUBMISSION_UNRESOLVED_SECONDS = 120
MARK_SECONDS = 60  # With a position open and no mark for this long, the run stops (design §3.2.4).
# The runner's events after which the run is over; a run whose latest start ended in none of them (interrupted,
# held until flat, or killed without a word) starts again as itself.
ENDED_EVENTS = frozenset({"clean_stop", "reconciled_flat", "venue_flat", "reconcile_stopped", "unresolved"})


@dataclass
class Session:
    manifest: dict
    output: Path
    mode: str
    # SIGTERM or SIGINT (Docker stop, a host shutdown): entries are withdrawn, positions and their exchange stops stay,
    # and the same run resumes when its runner starts again (design §3.4).
    interrupt_requested: threading.Event = field(default_factory=threading.Event)
    interrupting: bool = False
    held_flat: bool = False  # a held resume saw the venue flat: the next start trades again
    # Binance held nothing while the native cache still held a position: the run ended there, nothing sent
    # (engine.live_connection.venue_flat_exit).
    venue_flat: bool = False
    # The STOP path's closes and cancels are done and the native cache holds only what Binance no longer held at the
    # stop's read (engine.live_lifecycle.Observer.observe): engine.live.start ends the run venue_flat on a final read.
    stop_venue_flat: bool = False
    rewarming: bool = False  # a missing bar while flat: the next start warms the source up again
    # This start follows one that ended to warm up again (engine.live warmup_retry): if its warm-up fails, the run
    # starts once more instead of ending (the user, 2026-11-13); warmup_retried says this start does so.
    warmup_retry: bool = False
    warmup_retried: bool = False
    begun_stop: str | None = None  # the terminal stop an earlier start began and this start finishes (mode "finish")
    armed_ns: int | None = None  # a resumed run's first arming: its duration counts from there, across starts
    node: Any = None
    sources: dict[str, Any] = field(default_factory=dict)  # the run's instances: contract -> instance (engine.live_source)
    # A start without sources (held, reconcile) registers each instance's identity as an inert native Strategy
    # (engine.live_node); a held start cancels the entries it inherited through them (engine.live_connection), and a
    # start that finishes a stop closes its positions through them too (engine.live_lifecycle).
    keepers: dict[str, Any] = field(default_factory=dict)
    entry_gate: Any = None  # the native ExecutionAlgorithm that denies entries, or ends cancelled unsent ones (engine.unsent)
    denied: set[str] = field(default_factory=set)  # client order IDs of the entries it denied in this start
    # What each instance added to its own findings while it handled one of those denials (engine.live_source):
    # strategy ID -> finding -> count. The gate's denial is the product's doing, so these do not fail the start.
    gate_findings: dict[str, Counter] = field(default_factory=dict)
    denying: bool = False  # inside a denial's native callbacks
    started: float | None = None
    stopping: bool = False
    stop_at: float | None = None
    native_flat: bool = False
    ended: bool = False  # this start journalled an event that ends the run (ENDED_EVENTS)
    failed: bool = False
    native_order_failure: bool = False
    persistence_failed: bool = False
    journal_failed: bool = False
    account_reader: Any = None
    account_observation: AccountObservation | None = None
    pending_entries: list[PendingEntry] = field(default_factory=list)  # entries not yet sent, in order
    # Entries their source cancelled while they waited, to be ended natively (engine.live_commands.end_canceled).
    source_canceled: list[PendingEntry] = field(default_factory=list)
    deciding: Any = None  # the bar type of the bar the source is handling (engine.live_source)
    account_verified: bool = False
    connection_failed: bool = False  # the connected start could not be verified; a later disconnect only closes entries
    connection: Connection = field(default_factory=Connection)  # the entry gate (engine.live_connection)
    brake: Brake = field(default_factory=Brake)  # the drawdown brake and cash floor (engine.live_brake)
    cache_guard: Any = None
    canceled: dict[str, float] = field(default_factory=dict)
    exits: set[str] = field(default_factory=set)
    # The STOP path's read of Binance before its first close (engine.live_lifecycle.venue_held): the snapshot ({} when
    # it failed), how much of each position Binance held then, and the native quantity of each that it did not hold.
    stop_read: dict | None = None
    stop_held: dict = field(default_factory=dict)
    phantoms: dict[str, Decimal] = field(default_factory=dict)
    priced: dict[str, float] = field(default_factory=dict)  # contract -> when a finishing start last asked for its bars
    resent: Counter = field(default_factory=Counter)  # position ID -> closes sent again after a rejection
    gaps: protection.Gaps = field(default_factory=lambda: protection.Gaps(PROTECTION_NS))  # position ID -> gap start
    submitted: dict[str, list[float]] = field(default_factory=dict)  # SUBMITTED order -> [since, last query]
    marks: dict[str, tuple[float, Any]] = field(default_factory=dict)  # contract -> when its latest mark arrived, its value
    exposed_since: dict[str, float] = field(default_factory=dict)  # contract -> since when the run holds a position on it
    warmup_catalog: Path | None = None  # the run's temporary Catalog of warm-up bars (engine.history)
    kline_events: Any = None  # a run's closed-kline event times (engine.kline_events.KlineEvents)
    evidence: Evidence = field(init=False)

    def __post_init__(self):
        self.evidence = Evidence(self.output, lambda part, failure: self.event(
            "evidence_unavailable", strict=False, part=part, failure_type=failure))

    def record_kline_events(self) -> None:
        """The side connection's state changes and the closed klines' event times read since the last call, into
        the evidence pack."""
        if self.kline_events is not None:
            self.evidence.market("kline_events", self.kline_events)

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
            self.ended = self.ended or event in ENDED_EVENTS
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
        if self.mode == "finish":  # the begun stop is the run's end already; an operator's STOP or the duration adds nothing
            if self.interrupt_requested.is_set() and not self.stopping:
                self.interrupting = True
                self.begin_stop("interrupted")
            return self.stopping
        if self.rewarming and (strategy_runtime.FAILURES or (self.output / "STOP").exists() or self.duration_reached()):
            self.rewarming = self.stopping = False  # a stop that ends the run supersedes starting it again
            self.failed = self.failed or self.warmup_retried  # a warm-up that failed and is not tried again
        if strategy_runtime.FAILURES:
            self.failed = True
            self.begin_stop("source_failure")
        elif (self.output / "STOP").exists():
            self.begin_stop("requested")
        elif self.interrupt_requested.is_set() and not self.stopping:
            self.interrupting = True
            self.begin_stop("interrupted")
        elif self.duration_reached():
            self.begin_stop("duration")
        return self.stopping

    def finish_stop(self) -> None:
        """Once its account is verified, a start that finishes an earlier start's stop takes the STOP path for it."""
        if self.begun_stop is None or self.observe_stop_intent() and self.interrupting:
            return
        self.failed = self.failed or self.begun_stop not in UNFAILED  # also when Binance was found flat (venue_flat_exit)
        self.begin_stop(self.begun_stop)

    def duration_reached(self) -> bool:
        duration = self.manifest["config"]["duration_seconds"]
        return duration is not None and (
            time.time_ns() - self.armed_ns >= duration * 10**9 if self.armed_ns is not None
            else self.started is not None and time.monotonic() - self.started >= duration)

    def owner(self, strategy_id):
        """The instance of `strategy_id`, which sends its orders' commands; in a start without sources, the inert
        Strategy registered with that identity."""
        instances = self.sources or self.keepers
        return next((instances.get(symbol) for symbol, found in strategy_ids(self.manifest).items()
                     if found == strategy_id), None)

    def any_source(self):
        """An instance for native commands that belong to no one strategy (account queries); a start that finishes a stop
        has only its registered identities."""
        instances = self.keepers if self.mode == "finish" else self.sources
        return next(iter(instances.values()), None)

    def check_protection(self, cache, now: float) -> None:
        """engine.protection on the native cache (native orders keep reduce-only; Binance Hedge orders carry none),
        timed by its Gaps as Paper's, on the monotonic clock `now` in seconds."""
        try:
            uncovered = []
            for position in owned(cache.positions_open, self.manifest):
                quantity = position.quantity.as_decimal()
                held = quantity if position.side == PositionSide.LONG else -quantity
                if not protection.covered(held, protection.of_position(cache, position)):
                    uncovered.append(str(position.id))
        except Exception as exc:
            self.failed = True
            self.event("protection_unverified", strict=False, failure_type=type(exc).__name__)
            self.begin_stop("protection_unverified")
            return
        late = self.gaps.update(round(now * 1_000_000_000), uncovered)
        if late:
            self.failed = True
            self.event("protection_missing", strict=False, positions=late)
            self.begin_stop("protection_missing")

    def follow_submissions(self, cache, now: float) -> None:
        """The run's SUBMITTED orders, on the monotonic clock `now` (SUBMISSION_QUERY_SECONDS)."""
        found = {str(order.client_order_id): order for order in owned(lambda strategy_id: pending_orders(
            cache, strategy_id), self.manifest) if order.status == OrderStatus.SUBMITTED}
        self.submitted = {cid: self.submitted.get(cid, [now, now]) for cid in found}
        for cid, times in self.submitted.items():
            since, asked = times
            if now - since >= SUBMISSION_UNRESOLVED_SECONDS and not self.stopping:
                self.failed = True
                self.event("submission_unresolved", strict=False, client_order_id=cid, seconds=int(now - since))
                self.begin_stop("submission_unresolved")
            if now - asked >= SUBMISSION_QUERY_SECONDS:
                times[1] = now
                order = found[cid]
                Strategy.query_order(self.owner(order.strategy_id), order)
                # No further entry while one may be at Binance unknown to the run: the gate reopens as after a
                # reconnect, once the order is settled and two comparisons with the venue agree.
                live_connection.close_entries(self, "unverified", withdraw=False, client_order_id=cid)

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
        """The run's result from native fills at the end of minute `minute_ns` (contract -> its last mark price), or
        when the run stops, for the chart of its account: only read and journalled, no check, stop or order follows from it.
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
            # It closes nothing, so its ending event comes first: no later start may take it for a stop to finish.
            self.event("unresolved", reason=reason, strict=False)
            self.begin_stop(reason)
            self.node.handle().stop()

    def give_back(self, reason: str) -> None:
        """End a start again before its account is verified as an interruption: nothing of it was admitted, so the
        control starts the run again, within its hourly limit."""
        commands.discard_observation(self)
        self.interrupting = True
        self.begin_stop("interrupted")
        self.cancel_entries(reason)  # a begun stop's, inherited by its finish
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
        cache = native_cache(source)
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
