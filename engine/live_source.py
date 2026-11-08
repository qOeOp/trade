"""Reviewed source construction and Live-specific native command/callback boundaries."""
from __future__ import annotations
import ast
import hashlib
from pathlib import Path
import time
from typing import Any
from nautilus_trader.model import BarType, ClientId, InstrumentId, OmsType, StrategyId
from nautilus_trader.trading import Strategy, StrategyConfig
from engine import strategy as strategy_runtime
from engine.config import EXECUTION_BAR_MINUTES
from engine.live_errors import LiveRefusal as Refusal
from engine import live_commands as commands
from engine.live_commands import PendingEntry
from engine.live_records import source_strategy_id
from engine.live_session import Session
from engine.load import LoadedStrategy, load_strategy, read_regular_file, read_universe


def source_for_run(manifest: dict) -> LoadedStrategy:
    if manifest["config"].get("single_order_source_reviewed") is not True:
        raise Refusal("LIVE_SOURCE_REVIEW", "Live requires an explicitly reviewed single-order source")
    identity = manifest["source"]
    path = Path(manifest["strategy_file"])
    source = read_regular_file(path)
    # Do not reinterpret a backtest bracket as a different real execution mechanism.
    tree = ast.parse(source)
    forbidden = {"submit_order_list", "bracket", "add_exec_algorithm", "close_all_positions"}
    if any(isinstance(node, ast.Attribute) and node.attr in forbidden for node in ast.walk(tree)):
        raise Refusal("LIVE_SOURCE_UNSUPPORTED", "linked/batch orders and broad position actions need a separate native review")
    loaded = load_strategy(path, identity["entry_class"], identity["source_sha256"])
    if not loaded.uses_stop_loss:
        raise Refusal("LIVE_SOURCE_UNSUPPORTED", "Live requires a source with a stop loss; it declares USES_STOP_LOSS = False")
    if loaded.daily_warmup:
        raise Refusal("LIVE_WARMUP_UNSUPPORTED", "daily warm-up has not been validated for this Live source")
    return loaded


class LiveClock(strategy_runtime.GuardedClock):
    def _guard(self, api, callback):
        guarded = super()._guard(api, callback)
        return lambda *args, **kwargs: None if self._instance._live.observe_stop_intent() else guarded(*args, **kwargs)


def require_source_config(source, strategy_id: StrategyId) -> None:
    # Inspect the object retained by native allocation, including before source __init__.
    # __init__(config) alone can change Python .config without configuring the native core.
    config = Strategy.config.__get__(source, type(source))
    if (not isinstance(config, StrategyConfig) or source.config is not config
            or Strategy.strategy_id.__get__(source, type(source)) != strategy_id
            or config.strategy_id != strategy_id or config.oms_type != OmsType.NETTING
            or StrategyConfig.strategy_id.__get__(config, type(config)) != strategy_id
            or config.use_uuid_client_order_ids is not True
            or StrategyConfig.oms_type.__get__(config, type(config)) != OmsType.NETTING
            or StrategyConfig.use_uuid_client_order_ids.__get__(config, type(config)) is not True):
        raise Refusal("LIVE_SOURCE_CONFIG", "Live requires native allocation with its assigned identity, NETTING and UUID order IDs")
    if config.manage_stop or StrategyConfig.manage_stop.__get__(config, type(config)):
        raise Refusal("LIVE_SOURCE_STOP", "source-managed stop conflicts with the Live owned-position exit")
    if (config.market_exit_reduce_only is not True
            or StrategyConfig.market_exit_reduce_only.__get__(config, type(config)) is not True):
        raise Refusal("LIVE_SOURCE_CONFIG", "native market_exit must only reduce strategy-owned positions")


class _LiveConfigured:
    config: Any
    _source_constructor_args: tuple[tuple, dict]

    def __new__(cls, session, loaded):
        symbol = session.manifest["symbols"][0]
        iid = InstrumentId.from_str(f"{symbol}-PERP.BINANCE")
        # Binance minute bars are stamped one millisecond before their close.
        # A next-minute cutoff would discard the first completed live minute.
        # Native aggregation and the reviewed source own complete-bucket admission.
        start = time.time_ns()
        universe = Path(session.manifest["universe_file"])
        if hashlib.sha256(read_regular_file(universe)).hexdigest() != session.manifest["universe_sha256"]:
            raise Refusal("LIVE_IDENTITY_CHANGED", "the captured universe does not match the manifest")
        membership = read_universe(universe, [symbol])[symbol]
        args = (iid, BarType.from_str(f"{iid}-1-DAY-LAST-INTERNAL"))
        kwargs = dict(
            trade_start_ns=start, historical_daily_bars=[], execution_bar_minutes=EXECUTION_BAR_MINUTES,
            strategy_id=source_strategy_id(session.manifest),
            universe_membership=membership)
        instance = strategy_runtime.allocate_strategy(cls, super().__new__, args, kwargs)
        require_source_config(instance, kwargs["strategy_id"])
        return instance

    def __init__(self, session: Session, loaded: LoadedStrategy):
        self._live = session
        args, kwargs = self._source_constructor_args
        del self._source_constructor_args
        super().__init__(*args, **kwargs)
        self._replay_input_start_ns = kwargs["trade_start_ns"]
        require_source_config(self, kwargs["strategy_id"])

    def submit_order(self, order, position_id=None, client_id=None, params=None):
        commands.require_connection(self._live)
        if not order.is_reduce_only and not self._live.check_storage():
            raise Refusal("LIVE_ENTRY_STOPPED", "new entries require healthy private persistence")
        if self._live.observe_stop_intent() and not order.is_reduce_only:
            raise Refusal("LIVE_ENTRY_STOPPED", "new entries are disabled while Live is stopping")
        if str(order.instrument_id) != f"{self._live.manifest['symbols'][0]}-PERP.BINANCE":
            raise Refusal("LIVE_INSTRUMENT_SCOPE", "an order must use the manifest instrument")
        if (order.emulation_trigger is not None or order.contingency_type is not None
                or order.order_list_id is not None or order.parent_order_id is not None or order.linked_order_ids
                or order.exec_algorithm_id is not None or order.is_quote_quantity or params):
            raise Refusal("LIVE_ORDER_UNSUPPORTED", "Live accepts reviewed independent venue orders only")
        if client_id not in (None, ClientId("BINANCE")):
            raise Refusal("LIVE_ORDER_UNSUPPORTED", "orders must use the configured Binance client")
        if order.is_reduce_only:
            commands.require_order_identity(self._live, order)
            position = self.owned_position(position_id)
            if not order.would_reduce_only(position.side, position.quantity):
                raise Refusal("LIVE_ORDER_OWNERSHIP", "a reduction must fit the current native position side and quantity")
            return super().submit_order(order, position_id=position.id, client_id=client_id)
        try:
            if position_id is not None or self._live.pending_entry is not None:
                raise Refusal("LIVE_ENTRY_STOPPED", "an entry cannot add to a position or wait beside another pending attempt")
            commands.require_entry(self._live, order)
            self._live.pending_entry = PendingEntry(order, super().submit_order, client_id)
            commands.start_observation(self._live, "entry")
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

    def submit_order_list(self, *args, **kwargs):
        raise Refusal("LIVE_ORDER_UNSUPPORTED", "Live does not reinterpret native order lists")

    def modify_order(self, *args, **kwargs):
        commands.require_connection(self._live)
        raise Refusal("LIVE_ORDER_UNSUPPORTED", "the initial trial does not amend order price or quantity")

    def modify_orders(self, *args, **kwargs):
        commands.require_connection(self._live)
        raise Refusal("LIVE_ORDER_UNSUPPORTED", "the initial trial does not amend order price or quantity")

    def cancel_order(self, client_order_id, client_id=None, params=None):
        commands.require_connection(self._live)
        pending = self._live.pending_entry
        if pending is not None and pending.order.client_order_id == client_order_id:
            self._live.begin_stop("unsubmitted_entry_canceled")
            commands.discard_observation(self._live)
            return
        return super().cancel_order(client_order_id, client_id, params)

    def cancel_orders(self, client_order_ids, client_id=None, params=None):
        commands.require_connection(self._live)
        pending = self._live.pending_entry
        ids = list(client_order_ids)
        if pending is not None and pending.order.client_order_id in ids:
            self.cancel_order(pending.order.client_order_id)
            ids = [cid for cid in ids if cid != pending.order.client_order_id]
        if ids:
            return super().cancel_orders(ids, client_id, params)

    def close_position(self, position, client_id=None, tags=None, time_in_force=None,
                       reduce_only=None, quote_quantity=None, params=None):
        commands.require_connection(self._live)
        if reduce_only is False or quote_quantity or params or client_id not in (None, ClientId("BINANCE")):
            raise Refusal("LIVE_ORDER_UNSUPPORTED", "closing must use a native base-quantity reduction")
        current = self.owned_position(position.id if position is not None else None)
        return super().close_position(current, client_id, tags, time_in_force, True, False)

    def market_exit(self):
        commands.require_connection(self._live)
        if self._live.pending_entry is not None:
            self._live.begin_stop("unsubmitted_entry_exit")
            commands.discard_observation(self._live)
        return super().market_exit()

    def cancel_all_orders(self, instrument_id, order_side=None, client_id=None, strategy_only=True, params=None):
        if not strategy_only:
            raise Refusal("LIVE_ORDER_OWNERSHIP", "Live cannot cancel another owner's orders")
        commands.require_connection(self._live)
        pending = self._live.pending_entry
        if (pending is not None and pending.order.instrument_id == instrument_id
                and (order_side is None or pending.order.side == order_side)):
            self.cancel_order(pending.order.client_order_id)
        return super().cancel_all_orders(instrument_id, order_side, client_id, True, params)

    def shutdown_system(self, reason=None):
        self._live.begin_stop("source_shutdown", source_reason=str(reason)[:1000] if reason is not None else None)


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


def live_source(loaded: LoadedStrategy, session: Session, *, source_module: str = "engine.live"):
    callbacks = strategy_runtime.guarded_callbacks(loaded.strategy_class)
    for name in (*strategy_runtime.DATA_CALLBACKS, "on_start", "on_historical_data", "on_historical_bars"):
        original = callbacks.get(name)
        if original:
            callbacks[name] = (lambda method: lambda self, *args, **kwargs:
                None if self._live.observe_stop_intent() else method(self, *args, **kwargs))(original)
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
    callbacks["on_stop"] = lambda self: None  # the Observer owns exits; a lost connection leaves positions alone
    callbacks["clock"] = property(lambda self: LiveClock(Strategy.clock.__get__(self, type(self)), self))
    # type() otherwise infers this extracted module. Preserve the entry point's
    # original definition context, including __main__ for python -m engine.live.
    callbacks["__module__"] = source_module
    combined = type("LiveSource_" + loaded.content_hash, (_LiveConfigured, loaded.strategy_class), callbacks)
    return combined(session, loaded)


# Retained class import identity; engine.live re-exports these exact objects.
LiveClock.__module__ = "engine.live"
_LiveConfigured.__module__ = "engine.live"
