"""Run-local lifecycle state and evidence; orders and positions stay in native cache."""
from __future__ import annotations
from dataclasses import dataclass, field
from decimal import Decimal
import json
import os
from pathlib import Path
import threading
import time
from typing import Any
from nautilus_trader.model import OrderStatus, PositionSide
from nautilus_trader.trading import Strategy
from engine import protection, strategy as strategy_runtime
from engine.live_errors import LiveRefusal as Refusal
from engine.live_evidence import Evidence
from engine import live_commands as commands
from engine.live_commands import AccountObservation, PendingEntry, pending_orders
from engine.live_records import source_strategy_id

STOP_GRACE_SECONDS = 30
CANCEL_RETRY_SECONDS = 5
# engine.protection's allowance plus its Live detection lag. A false alarm flattens a healthy trade.
PROTECTION_SECONDS = (protection.ALLOWANCE_NS + protection.LIVE_DETECTION_NS) // 1_000_000_000
MARK_SECONDS = 60  # Without a mark for this long the loss limit cannot be applied, so it counts as reached.
MINUTE_NS = 60_000_000_000


@dataclass
class Session:
    manifest: dict
    output: Path
    mode: str
    stop_requested: threading.Event = field(default_factory=threading.Event)
    node: Any = None
    source: Any = None
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
    pending_entries: list[PendingEntry] = field(default_factory=list)  # entries awaiting their account check, in order
    account_verified: bool = False
    connection_failed: bool = False
    cache_guard: Any = None
    canceled: dict[str, float] = field(default_factory=dict)
    exits: set[str] = field(default_factory=set)
    protection_gaps: dict[str, float] = field(default_factory=dict)
    mark: tuple[float, Any] | None = None  # When the latest mark price arrived, and its value.
    exposed_since: float | None = None
    evidence: Evidence = field(init=False)

    def __post_init__(self):
        self.evidence = Evidence(self.output, lambda part, failure: self.event(
            "evidence_unavailable", strict=False, part=part, failure_type=failure))

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
        if strategy_runtime.FAILURES:
            self.failed = True
            self.begin_stop("source_failure")
        elif self.stop_requested.is_set() or (self.output / "STOP").exists():
            self.begin_stop("requested")
        elif self.started is not None and time.monotonic() - self.started >= self.manifest["config"]["duration_seconds"]:
            self.begin_stop("duration")
        return self.stopping

    def check_protection(self, cache, now: float) -> None:
        """engine.protection on the native cache (native orders keep reduce-only; Binance Hedge orders carry none)."""
        try:
            strategy_id = source_strategy_id(self.manifest)
            gaps = {}
            for position in cache.positions_open(strategy_id=strategy_id):
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

    def check_loss(self, cache, now: float) -> None:
        """This run's realized and unrealized result at the venue's mark price, from native fills.

        An exception to leaving risk calculation to Nautilus: the pinned LiveRiskEngineConfig has no loss
        limit. Funding and commissions paid in another asset are not counted.
        """
        try:
            limit = Decimal(self.manifest["config"]["max_loss_usdt"])
            positions = cache.positions(strategy_id=source_strategy_id(self.manifest))
            exposed = any(position.is_open for position in positions)
            since = (now if self.exposed_since is None else self.exposed_since) if exposed else None
            self.exposed_since = since
            price = self.mark[1] if self.mark and now - self.mark[0] < MARK_SECONDS else None
            if since is not None and price is None:
                if now - since >= MARK_SECONDS:
                    raise TimeoutError("no recent mark price")
                return
            result = run_result(cache, positions, price)
        except Exception as exc:
            self.failed = True
            self.event("loss_unverified", strict=False, failure_type=type(exc).__name__)
            self.begin_stop("loss_unverified")
            return
        if result <= -limit:
            self.event("max_loss", strict=False, result=str(result), mark=str(price))
            self.begin_stop("max_loss")

    def record_minute(self, cache, minute_ns: int, price) -> None:
        """The run's result (check_loss's) at a minute's first mark price, or when the run stops, for the
        chart of its account: only read and journalled, no check, stop or order follows from it. Unknown
        while a position is open without a price, or when it cannot be read."""
        result = None
        try:
            positions = cache.positions(strategy_id=source_strategy_id(self.manifest))
            if price is not None or not any(position.is_open for position in positions):
                result = str(run_result(cache, positions, price))
        except Exception:
            pass
        self.event("minute_result", strict=False, minute_ns=minute_ns, result=result)


    def lose_connection(self, reason: str) -> None:
        # There is no public rc7 recovery-complete barrier. Keep existing venue orders
        # and cache custody; a later CONNECTED event cannot re-arm this process.
        self.account_verified, self.connection_failed, self.failed, self.native_flat = False, True, True, False
        commands.discard_observation(self)
        # Stop native command producers before any journal I/O or the node's asynchronous
        # stop-check. The native manage_stop=False check makes this a local lifecycle stop;
        # residual fills still update the execution cache and native logs.
        try:
            self.cancel_entries(reason)
            if self.source is not None and Strategy.is_running(self.source):
                Strategy.stop(self.source)
        finally:
            self.begin_stop(reason)
            self.event("unresolved", reason=reason, strict=False)
            self.node.handle().stop()

    def resend_cancel(self, order) -> None:
        """Native cancel_order sends nothing for an order already PENDING_CANCEL, so after a request
        with an unknown outcome only cancel-all reaches the venue. Each entry starts from an
        empty account, so whatever protects it sits on the other side and keeps working."""
        Strategy.cancel_all_orders(self.source, order.instrument_id, order.side, None, False)

    def cancel_entries(self, reason: str) -> None:
        """Withdraw working entries when no process will protect a later fill.

        Orders travel over REST, so a lost socket does not block this request. It bypasses the
        source's closed command gate and leaves reduce-only protection on the venue. The outcome
        may never be observed: the run stays unresolved, and the next read of the venue decides.
        """
        if self.source is None:
            return
        cache = Strategy.cache.__get__(self.source, type(self.source))
        for order in pending_orders(cache, source_strategy_id(self.manifest)):
            if order.is_reduce_only:
                continue
            cid = str(order.client_order_id)
            try:
                if order.status == OrderStatus.PENDING_CANCEL:
                    self.resend_cancel(order)
                else:
                    Strategy.cancel_order(self.source, order.client_order_id)
            except Exception as exc:
                self.event("entry_cancel_failed", reason=reason, client_order_id=cid,
                           failure_type=type(exc).__name__, strict=False)
            else:
                self.event("entry_cancel_requested", reason=reason, client_order_id=cid, strict=False)

    def cancel_open(self, orders: list, now: float) -> None:
        """Cancelling is idempotent, so a lost or rejected request is repeated while the order is open."""
        for order in orders:
            cid = str(order.client_order_id)
            if cid in self.canceled and now - self.canceled[cid] < CANCEL_RETRY_SECONDS:
                continue
            if order.status != OrderStatus.PENDING_CANCEL:
                self.source.cancel_order(order.client_order_id)
            elif cid in self.canceled:
                self.resend_cancel(order)
            self.canceled[cid] = now

    def observe_source_state(self) -> None:
        """A source that stopped itself receives no fills, so it can neither protect nor exit."""
        if self.source is not None and not self.stopping and not Strategy.is_running(self.source):
            self.failed = True
            self.begin_stop("source_not_running")


def run_result(cache, positions, price) -> Decimal:
    """`positions`' realized result and, at `price`, the open ones' unrealized result, from native fills.
    A position that closes and reopens restarts its realized result; earlier cycles are in snapshots."""
    return sum(((position.total_pnl(price) if position.is_open else position.realized_pnl).as_decimal() + sum(
        (snapshot.realized_pnl.as_decimal() for snapshot in cache.position_snapshots(position_id=position.id)),
        Decimal(0)) for position in positions), Decimal(0))
