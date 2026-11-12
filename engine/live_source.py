"""Reviewed source construction and Live-specific native command/callback boundaries."""
from __future__ import annotations
import functools
import hashlib
from pathlib import Path
import time
from typing import Any
from nautilus_trader.model import BarType, InstrumentId
from nautilus_trader.trading import Strategy
from engine import history, strategy as strategy_runtime
from engine.cadence import Cadence
from engine.config import EXECUTION_BAR_MINUTES, Refusal as ContractRefusal
from engine.live_errors import LiveRefusal as Refusal
from engine import live_commands as commands
from engine.live_commands import PendingEntry
from engine.live_records import source_strategy_id
from engine.live_session import Session
from engine.order_rules import OrderRules
from engine.load import LoadedStrategy, load_strategy, read_regular_file, read_universe


def source_for_run(manifest: dict) -> LoadedStrategy:
    identity = manifest["source"]
    path = Path(manifest["strategy_file"])
    return load_strategy(path, identity["entry_class"], identity["source_sha256"])


class LiveClock(strategy_runtime.GuardedClock):
    def _guard(self, api, callback):
        guarded = super()._guard(api, callback)
        return lambda *args, **kwargs: None if self._instance._live.observe_stop_intent() else guarded(*args, **kwargs)


class _LiveConfigured(history.Warming):
    config: Any
    _orders_allowed: Any  # engine.order_rules.OrderRules, after this class in the source's bases
    _source_constructor_args: tuple[tuple, dict]

    def __new__(cls, session, loaded):
        symbol = session.manifest["symbols"][0]
        iid = InstrumentId.from_str(f"{symbol}-PERP.BINANCE")
        # T: the source is warmed then (engine.history), and its input starts with the minute after it.
        start = history.start_at(time.time_ns())
        universe = Path(session.manifest["universe_file"])
        if hashlib.sha256(read_regular_file(universe)).hexdigest() != session.manifest["universe_sha256"]:
            raise Refusal("LIVE_IDENTITY_CHANGED", "the captured universe does not match the manifest")
        membership = read_universe(universe, [symbol])[symbol]
        args = (iid, BarType.from_str(f"{iid}-1-MINUTE-LAST-EXTERNAL"))
        kwargs = dict(
            trade_start_ns=start, execution_bar_minutes=EXECUTION_BAR_MINUTES,
            strategy_id=source_strategy_id(session.manifest),
            universe_membership=membership)
        return strategy_runtime.allocate_strategy(cls, kwargs["strategy_id"], args, kwargs)

    def __init__(self, session: Session, loaded: LoadedStrategy):
        self._live = session
        args, kwargs = self._source_constructor_args
        del self._source_constructor_args
        strategy_runtime.declare(self, loaded.warmup)
        self._warming_setup(kwargs["strategy_id"], args[0], kwargs["trade_start_ns"], loaded.warmup, functools.partial(
            history.fetch, catalog=session.catalog(), proxy_url=session.manifest["config"].get("proxy_url")))
        super().__init__(*args, **kwargs)
        self._replay_input_start_ns = kwargs["trade_start_ns"]
        self._live_cadence = Cadence()
        strategy_runtime.require_source_config(self, kwargs["strategy_id"])

    def submit_order(self, order, position_id=None, client_id=None, params=None):
        commands.require_connection(self._live)
        if not order.is_reduce_only and not self._live.check_storage():
            raise Refusal("LIVE_ENTRY_STOPPED", "new entries require healthy private persistence")
        if self._live.observe_stop_intent() and not order.is_reduce_only:
            raise Refusal("LIVE_ENTRY_STOPPED", "new entries are disabled while Live is stopping")
        if str(order.instrument_id) != f"{self._live.manifest['symbols'][0]}-PERP.BINANCE":
            raise Refusal("LIVE_INSTRUMENT_SCOPE", "an order must use the manifest instrument")
        # Live custody first; engine.order_rules follows (OrderRules comes after this class).
        if order.is_reduce_only:
            commands.require_order_identity(self._live, order)
            position = self.owned_position(position_id)
            return super().submit_order(order, position_id=position.id, client_id=client_id)
        try:
            commands.require_entry(self._live, order)
            self._orders_allowed(order, position_id, client_id, params)  # raises on a breach (_live_breach)
            commands.queue_entry(self._live, PendingEntry(order, super().submit_order, client_id))
        except Exception:
            commands.discard_observation(self._live)
            self._live.failed = True
            self._live.begin_stop("entry_admission_failed")
            raise

    def owned_position(self, position_id):
        cache = Strategy.cache.__get__(self, type(self))
        position = cache.position(position_id) if position_id is not None else None
        if (position is None or not position.is_open or position.strategy_id != source_strategy_id(self._live.manifest)
                or str(position.account_id) != self._live.manifest["account_id"]
                or str(position.instrument_id) != f"{self._live.manifest['symbols'][0]}-PERP.BINANCE"):
            raise Refusal("LIVE_ORDER_OWNERSHIP", "a reduction needs this strategy's current native account position")
        return position

    def cancel_order(self, client_order_id, client_id=None, params=None):
        commands.require_connection(self._live)
        if any(pending.order.client_order_id == client_order_id for pending in self._live.pending_entries):
            self._live.begin_stop("unsubmitted_entry_canceled")
            commands.discard_observation(self._live)
            return
        return super().cancel_order(client_order_id, client_id, params)

    def cancel_orders(self, client_order_ids, client_id=None, params=None):
        commands.require_connection(self._live)
        ids = list(client_order_ids)
        queued = {pending.order.client_order_id for pending in self._live.pending_entries}
        if queued & set(ids):
            self.cancel_order(next(cid for cid in ids if cid in queued))
            ids = [cid for cid in ids if cid not in queued]
        if ids:
            return super().cancel_orders(ids, client_id, params)

    def close_position(self, position, client_id=None, tags=None, time_in_force=None,
                       reduce_only=None, quote_quantity=None, params=None):
        commands.require_connection(self._live)
        current = self.owned_position(position.id if position is not None else None)
        return super().close_position(current, client_id, tags, time_in_force, reduce_only, quote_quantity, params)

    def market_exit(self):
        commands.require_connection(self._live)
        if self._live.pending_entries:
            self._live.begin_stop("unsubmitted_entry_exit")
            commands.discard_observation(self._live)
        return super().market_exit()

    def cancel_all_orders(self, instrument_id, order_side=None, client_id=None, strategy_only=True, params=None):
        commands.require_connection(self._live)
        found = next((pending for pending in self._live.pending_entries if pending.order.instrument_id == instrument_id
                      and (order_side is None or pending.order.side == order_side)), None)
        if found is not None:
            self.cancel_order(found.order.client_order_id)
        return super().cancel_all_orders(instrument_id, order_side, client_id, strategy_only, params)

    def shutdown_system(self, reason=None):
        self._live.begin_stop("source_shutdown", source_reason=str(reason)[:1000] if reason is not None else None)

    def _warming_failed(self, code: str, text: str) -> None:
        """No order went out before the warm-up (engine.order_rules.WARMING): the run stops."""
        self._live.failed = True
        self._live.event("warmup_refused", strict=False, code=code, detail=text[:1000])
        self._live.begin_stop("warmup_failed")

    def _warming_begin(self) -> None:
        state = self._warming_state()
        # The bars themselves went to the evidence pack as the source received them (historical_bar).
        self._live.event("warmup", strict=False, at_ns=state["at"], fetched_ns=state["fetched_ns"],
                         bars={period: len(bars) for period, bars in state["delivered"].items()})
        history.Warming._warming_begin(self)


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


# The bars the source receives go to the evidence pack (engine.live_evidence), whether or not it handles them.
RECORDED_BARS = {"on_bar": "bar", "on_historical_bars": "historical_bar"}


def _gated(name: str, method):
    """The callback, unless a stop was asked for; a bar it receives is recorded first."""
    kind = RECORDED_BARS.get(name)

    def call(self, *args, **kwargs):
        if self._live.observe_stop_intent():
            return None
        if kind == "bar":
            self._live.evidence.bar(args[0])
        elif kind is not None:
            for bar in args[0]:
                self._live.evidence.bar(bar, kind)
        return method(self, *args, **kwargs) if method else None
    return call


def _live_breach(self, code: str, text: str):
    """A subscription or order command outside the contract is refused at once (engine.strategy, engine.order_rules)."""
    raise ContractRefusal(code, text)


def _at_cadence(name: str, method):
    """The source sees MARK and funding as a replay does: the first MARK of each minute, one update per settlement
    (engine.cadence)."""
    if name == "on_mark_price":
        return lambda self, update: method(self, update) if self._live_cadence.mark(update) else None

    def funding(self, update):
        settled = self._live_cadence.funding(update)
        return method(self, settled) if settled is not None else None
    return funding


def live_source(loaded: LoadedStrategy, session: Session, *, source_module: str = "engine.live"):
    history.clear()  # one Live source per process; its node adds the warm-up actor after it
    callbacks = strategy_runtime.guarded_callbacks(loaded.strategy_class)
    for name in ("on_mark_price", "on_funding_rate"):
        if callbacks.get(name):
            callbacks[name] = _at_cadence(name, callbacks[name])
    for name in (*strategy_runtime.DATA_CALLBACKS, "on_start", "on_historical_data", "on_historical_bars"):
        original = callbacks.get(name)
        if original or name in RECORDED_BARS:
            callbacks[name] = _gated(name, original)
    for name in ("on_order_event", "on_position_event"):
        original = callbacks.get(name)
        def wrapped(self, event, _original=original, _name=name):
            if _name == "on_order_event" and type(event).__name__ in {"OrderDenied", "OrderRejected"}:
                self._live.native_order_failure, self._live.failed = True, True
                self._live.begin_stop("native_order_failure")
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
    callbacks["_breach"] = _live_breach
    # The runner warms the source before its on_start (engine.history.Warming).
    callbacks = strategy_runtime.deferred_start(callbacks)
    combined = type("LiveSource_" + loaded.content_hash,
                    (strategy_runtime.Subscriptions, _LiveConfigured, OrderRules, loaded.strategy_class), callbacks)
    return combined(session, loaded)
