"""Reviewed source construction and Live-specific native command/callback boundaries."""
from __future__ import annotations
from collections import Counter
import functools
import hashlib
from pathlib import Path
import time
from datetime import UTC, datetime
from typing import Any
from nautilus_trader.model import BarType
from nautilus_trader.trading import Strategy
from engine import history, metrics, strategy as strategy_runtime, unsent
from engine.live_venue import VENUES
from engine.cadence import Cadence
from engine.config import EXECUTION_BAR_MINUTES, Refusal as ContractRefusal, read_regular_file
from engine.live_errors import LiveRefusal as Refusal
from engine import live_commands as commands, live_connection
from engine.live_commands import PendingEntry
from engine.live_records import contract, owned, strategy_ids
from engine.live_session import Session
from engine.order_rules import CODE, MARKET_EXIT_DENIAL, OrderRules, denied_exiting, native_cache
from engine.load import LoadedStrategy, load_strategy, read_universe
from engine.membership import MONTHS, Membership, month_end_ns, opening


def source_for_run(manifest: dict) -> LoadedStrategy:
    identity = manifest["source"]
    path = Path(manifest["strategy_file"])
    return load_strategy(path, identity["entry_class"], identity["source_sha256"])


class LiveClock(strategy_runtime.GuardedClock):
    def _guard(self, api, callback):
        guarded = super()._guard(api, callback)
        return lambda *args, **kwargs: None if self._instance._live.observe_stop_intent() else guarded(*args, **kwargs)


class _LiveConfigured(history.Warming, metrics.Feed, unsent.Waiting):
    config: Any
    _runner_orders_allowed: Any  # engine.order_rules.OrderRules, after this class in the source's bases
    _source_constructor_args: tuple[tuple, dict]
    _runner_reads_funding: bool

    def __new__(cls, session, loaded, symbol, start, membership):
        iid = contract(symbol)
        args = (iid, BarType.from_str(f"{iid}-1-MINUTE-LAST-EXTERNAL"))
        kwargs = dict(
            trade_start_ns=start, execution_bar_minutes=EXECUTION_BAR_MINUTES,
            strategy_id=strategy_ids(session.manifest)[symbol],
            universe_membership=membership)
        return strategy_runtime.allocate_strategy(cls, kwargs["strategy_id"], args, kwargs)

    def __init__(self, session: Session, loaded: LoadedStrategy, symbol: str, start: int, membership: Membership):
        self._live = session
        self._live_symbol = symbol  # the instance's own contract: it orders on nothing else (engine.order_rules)
        args, kwargs = self._source_constructor_args
        del self._source_constructor_args
        self._live_membership = kwargs["universe_membership"]
        strategy_runtime.declare(self, loaded.warmup)
        self._warming_setup(kwargs["strategy_id"], args[0], kwargs["trade_start_ns"], loaded.warmup, loaded.funding,
                            functools.partial(history.fetch, catalog=session.catalog(),
                                              proxy_url=session.manifest["config"].get("proxy_url"),
                                              base=VENUES[session.manifest["config"]["environment"]]["rest"]),
                            follows=self._runner_reads_funding)
        self._metrics_setup(functools.partial(metrics.read, proxy_url=session.manifest["config"].get("proxy_url")))
        super().__init__(*args, **kwargs)
        self._replay_input_start_ns = kwargs["trade_start_ns"]
        self._live_cadence: dict[str, Cadence] = {}  # instrument ID -> its updates'
        strategy_runtime.require_source_config(self, kwargs["strategy_id"])
        strategy_runtime.STRATEGIES[str(args[0])] = self  # type: ignore[assignment]  # self is a combined Strategy subclass

    def _metrics_unfollow(self, instrument_id: str) -> None:
        """An unsubscribe of metrics the source followed goes to the evidence pack: `live compare` expects no row after
        it (replay.comparison.compare_metrics)."""
        if instrument_id in self._metrics_followed:
            self._live.evidence.market("metrics_unsubscribed", instrument_id)
        super()._metrics_unfollow(instrument_id)

    def submit_order(self, order, position_id=None, client_id=None, params=None):
        commands.require_connection(self._live)
        if not order.is_reduce_only and not self._live.check_storage():
            raise Refusal("LIVE_ENTRY_STOPPED", "new entries require healthy private persistence")
        if self._live.observe_stop_intent() and not order.is_reduce_only:
            raise Refusal("LIVE_ENTRY_STOPPED", "new entries are disabled while Live is stopping")
        symbol = self._live_symbol
        # Live custody first; engine.order_rules follows (OrderRules comes after this class) and checks the order's
        # shape and contract, as in replay and Paper.
        if order.is_reduce_only:
            commands.require_order_identity(self._live, order, strategy_ids(self._live.manifest)[symbol])
            position = self._live_owned_position(position_id)
            return super().submit_order(order, position_id=position.id, client_id=client_id, params=params)
        pending = PendingEntry(order, super().submit_order, client_id, self._live.deciding)
        try:
            if self._live.denying:  # not a new decision, even with entries open (engine.live_connection.deny)
                raise Refusal("LIVE_CONNECTION_UNVERIFIED", "an entry submitted from within a denial's callbacks is refused")
            closed = self._live.account_verified and not live_connection.entries_open(self._live, symbol)
            halted = symbol in self._live.connection.halted
            # Denied natively: with a position of the run held after a missing bar, or while this contract is not
            # TRADING (the user, 2026-11-13).
            holdable = live_connection.holdable(self._live, symbol)
            denied = closed and not holdable and live_connection.deniable(self._live, symbol) and (halted or bool(
                owned(native_cache(self).positions_open, self._live.manifest)))
            if closed and not holdable and not denied:
                raise Refusal("LIVE_CONNECTION_UNVERIFIED", f"entries are closed "
                              f"({live_connection.gate_reason(self._live, symbol)}) until the venue and the native "
                              "cache agree again")
            self._runner_orders_allowed(order, position_id, client_id, params)  # raises on a breach (_live_breach)
            commands.require_entry(self._live, order)
            if not self._live_membership.member_at(self._warming_clock().timestamp_ns()):
                # Outside its contract's membership at the native clock, where Paper does not send it: denied
                # natively, the run goes on and the contract only reduces (engine.membership).
                live_connection.deny(self._live, order, "entry_outside_membership", reason="not_a_member")
                return None
            if denied:
                # Only this entry, which passed every entry check, is denied, natively.
                live_connection.deny(self._live, order, "entry_while_contract_not_trading" if halted
                                     else "entry_while_bars_missing")
                return None
            if denied_exiting(self, order):
                # A replay denies it too; queued, its read's timing would decide whether a real order is sent.
                live_connection.deny(self._live, order, "entry_during_market_exit", reason=MARKET_EXIT_DENIAL)
                return None
            if closed:
                live_connection.hold(self._live, pending)
            else:
                commands.queue_entry(self._live, pending)
        except Exception as exc:
            if pending not in self._live.pending_entries:
                live_connection.refused(self._live, pending, getattr(exc, "code", type(exc).__name__), str(exc))
            commands.refuse_entries(self._live, getattr(exc, "code", type(exc).__name__), str(exc))
            raise

    def _live_owned_position(self, position_id):
        cache = native_cache(self)
        position = cache.position(position_id) if position_id is not None else None
        if (position is None or not position.is_open
                or position.strategy_id != strategy_ids(self._live.manifest)[self._live_symbol]
                or str(position.account_id) != self._live.manifest["account_id"]
                or position.instrument_id != contract(self._live_symbol)):
            raise Refusal("LIVE_ORDER_OWNERSHIP", "a reduction needs this strategy's current native account position")
        return position

    def _unsent_held(self) -> list[tuple[Any, bool]]:
        own = strategy_ids(self._live.manifest)[self._live_symbol]
        return [(pending.order, pending.order.strategy_id == own)
                for pending in [*self._live.pending_entries, *self._live.source_canceled]]

    def _unsent_cancel(self, match) -> set:
        own = strategy_ids(self._live.manifest)[self._live_symbol]
        return commands.cancel_unsent(self._live, lambda order: order.strategy_id == own and match(order))

    def _unsent_holds(self, instrument_id) -> bool:
        return instrument_id == contract(self._live_symbol)

    def _unsent_check(self) -> None:
        commands.require_connection(self._live)

    def _unsent_refuse(self) -> None:
        """A cancel the order rules refuse, of an entry that waits unsent, ends the run: none may be sent after it."""
        commands.refuse_entries(self._live, CODE, "a strategy cancels only its own orders, without parameters")

    def close_position(self, position, client_id=None, tags=None, time_in_force=None,
                       reduce_only=None, quote_quantity=None, params=None):
        commands.require_connection(self._live)
        current = self._live_owned_position(position.id if position is not None else None)
        return super().close_position(current, client_id, tags, time_in_force, reduce_only, quote_quantity, params)

    def shutdown_system(self, reason=None):
        self._live.begin_stop("source_shutdown", source_reason=str(reason)[:1000] if reason is not None else None)

    def _warming_failed(self, code: str, text: str) -> None:
        """No order went out before the warm-up (engine.order_rules.WARMING): the run stops. The first failure after a
        start to warm up again after a missing bar starts the run once more (the user, 2026-11-13)."""
        live = self._live
        retry = live.warmup_retry and not live.stopping
        live.event("warmup_refused", strict=False, code=code, detail=text[:1000], retry=retry)
        if retry:
            live.warmup_retry, live.warmup_retried, live.rewarming = False, True, True
            live.begin_stop("rewarming")
            return
        live.failed = True
        live.begin_stop("warmup_failed")

    def _warming_begin(self) -> None:
        state = self._warming_state()
        self._live.evidence.market("warmup", state["instrument_id"], state["delivered"])
        self._live.event("warmup", strict=False, at_ns=state["at"])
        history.Warming._warming_begin(self)


RATE_LIMITED = "RATE_LIMIT_EXCEEDED"  # Nautilus's reason for an order its risk engine denies over the submit rate


# rc7's Binance futures adapter sends OrderRejected with this reason only when the request certainly left no order at
# Binance: not sent (validation, credentials), or a definite venue answer that is neither retryable nor ambiguous
# (crates/adapters/binance futures/execution.rs and common/failure.rs at v2.0.0rc7). A submit whose outcome it could
# not learn stays in flight for reconciliation and may end INFLIGHT_TIMEOUT, when Binance may still have filled it.
NOT_TAKEN = "submit-order-error: "
CLOSE_RESENDS = 3  # a close rejected this often is left: the same answer would come again


def resend_close(session, cache, event) -> None:
    """The Observer's close of a position (engine.live_lifecycle) that never reached Binance is closed again on a
    later tick: one the native submit rate denied, and up to CLOSE_RESENDS times one Binance certainly did not take
    (NOT_TAKEN; re-judge D-155), so a transient refusal such as a price outside PERCENT_PRICE in a fast market does
    not leave the position open. The denial or rejection itself still fails the run, as any other."""
    name, reason = type(event).__name__, str(event.reason)
    rejected = name == "OrderRejected" and reason.startswith(NOT_TAKEN)
    if not (rejected or name == "OrderDenied" and reason == RATE_LIMITED):
        return
    position = str(cache.position_id(event.client_order_id))
    if position not in session.exits or rejected and session.resent[position] >= CLOSE_RESENDS:
        return
    if rejected:
        session.resent[position] += 1
        session.event("close_resent", strict=False, position_id=position, reason=reason)
    session.exits.discard(position)


def native_event(event) -> dict:
    encoder = getattr(event, "to_dict", None)
    if callable(encoder):
        return encoder()
    # rc7 position events expose native fields but no Python to_dict method.
    fields = ("account_id", "avg_px_close", "avg_px_open", "closing_order_id", "currency", "duration",
        "entry", "event_id", "instrument_id", "last_px", "last_qty", "opening_order_id", "peak_quantity",
        "position_id", "quantity", "realized_pnl", "realized_return", "side", "signed_qty", "strategy_id",
        "trader_id", "ts_closed", "ts_event", "ts_init", "ts_opened", "unrealized_pnl")
    return {"type": type(event).__name__, **{name: value if isinstance(value, (int, float, bool)) else str(value)
        for name in fields if (value := getattr(event, name, None)) is not None}}


# The bars and metrics the source receives go to the evidence pack (engine.live_evidence), whether or not it handles
# them; its warm-up's histories go there as digests when it has warmed (_warming_begin).
RECORDED = {"on_bar": "bar", "on_data": "metrics"}


def _gated(name: str, method):
    """The callback, unless a stop was asked for; a bar or metrics row it receives is recorded first."""
    kind = RECORDED.get(name)

    def call(self, *args, **kwargs):
        if self._live.observe_stop_intent():
            return None
        if kind == "bar":
            self._live.evidence.market("bar", args[0])
            if live_connection.bar(self._live, args[0]):
                return None  # a repeated bar: the source decided on it already
            if live_connection.held_bar(self._live, args[0]):
                return None  # the run ends before the source decides again (engine.live_connection.held_bar)
            if live_connection.rewarm_due(self._live) and live_connection.rewarm_pending(
                    self._live, native_cache(self)):
                return None  # a flat source decides on nothing after a gap: the next start warms it up again
            if method is None:
                return None
            self._live.deciding = args[0].bar_type
            try:
                return method(self, *args, **kwargs)
            finally:
                self._live.deciding = None
        elif kind == "metrics":
            if isinstance(getattr(args[0], "data", None), strategy_runtime.Metrics):
                self._live.evidence.market("metrics", args[0].data)
        return method(self, *args, **kwargs) if method else None
    return call


def _live_breach(self, code: str, text: str):
    """A subscription or order command outside the contract is refused at once (engine.strategy, engine.order_rules)."""
    raise ContractRefusal(code, text)


def _deliver(method):
    return lambda self, passed, _: method(self, passed)


def _reported(source, hook) -> list[str] | None:
    """The source's own findings now, from its unguarded hook; None when it cannot say."""
    try:
        found = hook(source, False)
    except Exception:
        return None
    return found if isinstance(found, list) and all(isinstance(value, str) for value in found) else None


def _own_denial(method, hook):
    """`method`, an order callback of the source, measured around the entry gate's own denials. The gate's OrderDenied
    reaches the source so it can end its plan (engine.live_connection.deny), and a source that reports every denied
    order as a finding reports this one too. The denial is known by its client order ID (Session.denied), and what
    the instance's findings gained while it handled that event is counted for the gate (Session.gate_findings):
    engine.live_lifecycle.source_outcome does not fail the start for those. Any other denial is not measured."""
    def handled(self, event):
        live = self._live
        if hook is None or type(event).__name__ != "OrderDenied" or str(event.client_order_id) not in live.denied:
            return method(self, event)
        before = _reported(self, hook)
        try:
            return method(self, event)
        finally:
            try:
                after = _reported(self, hook)
                if before is not None and after is not None:
                    live.gate_findings.setdefault(str(self.strategy_id), Counter()).update(
                        Counter(after) - Counter(before))
            except Exception:
                pass  # the measurement never fails the source's callback; what it missed counts as before
    return handled


def live_source(loaded: LoadedStrategy, session: Session, *, source_module: str = "engine.live") -> dict:
    """One instance of the source per contract of the run, each trading only its own (the user, 2026-11-13): symbol ->
    instance. Instances coordinate through state the source shares between them, as in a replay."""
    callbacks = strategy_runtime.guarded_callbacks(loaded.strategy_class)
    funding = callbacks.get("on_funding_rate")
    # The settlement of T's hour reaches the source as the stream's would, past the cadence (engine.history, step 6).
    callbacks["_runner_reads_funding"] = funding is not None
    if funding:
        callbacks["_warming_settled"] = _gated("on_funding_rate", funding)
    for name in ("on_mark_price", "on_funding_rate"):  # as a replay gives them (engine.cadence)
        if callbacks.get(name):
            callbacks[name] = Cadence.wrap(name, "_live_cadence", _deliver(callbacks[name]))
    for name in (*strategy_runtime.DATA_CALLBACKS, "on_start", "on_historical_data", "on_historical_bars",
                 "on_historical_funding_rates"):
        original = callbacks.get(name)
        if original or name in RECORDED:
            callbacks[name] = _gated(name, original)
    hook = getattr(loaded.strategy_class, "replay_integrity_findings", None)  # the source's own, unguarded
    for name in ("on_order_denied", "on_order_event"):
        if callbacks.get(name):
            callbacks[name] = _own_denial(callbacks[name], hook)
    for name in ("on_order_event", "on_position_event"):
        original = callbacks.get(name)
        def wrapped(self, event, _original=original, _name=name):
            if _name == "on_order_event" and type(event).__name__ in {"OrderDenied", "OrderRejected"} and not (
                    type(event).__name__ == "OrderDenied" and str(event.client_order_id) in self._live.denied):
                self._live.native_order_failure, self._live.failed = True, True
                self._live.begin_stop("native_order_failure")
                resend_close(self._live, native_cache(self), event)
            try:
                payload = native_event(event)
            except Exception:
                self._live.failed, self._live.journal_failed = True, True
                self._live.begin_stop("native_event_encoding")
            else:
                self._live.event("order" if _name == "on_order_event" else "position", native=payload, strict=False)
            if _original:
                return _original(self, event)
        callbacks[name] = wrapped
    callbacks["clock"] = property(lambda self: LiveClock(Strategy.clock.__get__(self, type(self)), self))
    # type() otherwise infers this extracted module. Preserve the entry point's
    # original definition context, including __main__ for python -m engine.live.
    callbacks["__module__"] = source_module
    callbacks["_runner_breach"] = _live_breach
    # The runner warms the source before its on_start (engine.history.Warming).
    callbacks = strategy_runtime.deferred_start(callbacks)
    combined = type("LiveSource_" + loaded.content_hash,
                    (strategy_runtime.Subscriptions, _LiveConfigured, OrderRules, loaded.strategy_class), callbacks)
    # One T for every instance: each is warmed then (engine.history), and its input starts with the minute after it.
    start = history.start_at(time.time_ns())
    universe = Path(session.manifest["universe_file"])
    if hashlib.sha256(read_regular_file(universe)).hexdigest() != session.manifest["universe_sha256"]:
        raise Refusal("LIVE_IDENTITY_CHANGED", "the captured universe does not match the manifest")
    # The universe file holds the months to the market day's; each later month comes from the control's month files
    # beside it, as Paper's (engine.membership; live.runs.write_months_locked).
    known = month_end_ns(int(datetime.fromisoformat(session.manifest["market"]["market_day"]).replace(
        tzinfo=UTC).timestamp()) * 10**9)
    intervals = read_universe(universe, session.manifest["symbols"])

    def record(kind: str, **fields) -> None:
        session.event(kind, strict=False, **fields)
    return {symbol: combined(session, loaded, symbol, start, Membership(
        symbol, opening(intervals[symbol], start, known), known, universe.parent / MONTHS, now=time.time_ns,
        record=record, stale_code="LIVE_MEMBERSHIP_STALE")) for symbol in session.manifest["symbols"]}
