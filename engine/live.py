"""Separate Binance USD-M native Live entry point with explicit private inputs.

Paper retains its credential-free Sandbox contract. This entry point never
changes account settings and never resumes source callbacks after interruption.
"""

from __future__ import annotations

# Native network/worker threads must inherit the blocked mask. The dedicated
# sigwait thread turns process signals into the same owned-position STOP path.
if __name__ == "__main__":
    import signal
    signal.pthread_sigmask(signal.SIG_BLOCK, {signal.SIGTERM, signal.SIGINT})

import argparse
import ast
from dataclasses import dataclass, field
from datetime import timedelta
from decimal import Decimal
import fcntl
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import re
import signal
import sys
import threading
import time
from typing import Any

from nautilus_trader.adapters.binance import (
    BinanceDataClientConfig, BinanceDataClientFactory, BinanceEnvironment,
    BinanceExecutionClientConfig, BinanceExecutionClientFactory,
    BinanceInstrumentProviderConfig, BinanceProductType,
)
from nautilus_trader.common import CacheConfig, Environment, LoggerConfig, LogLevel, SocketState
from nautilus_trader.live import LiveDataEngineConfig, LiveExecutionEngineConfig, LiveNode, LiveRiskEngineConfig
from nautilus_trader.model import AccountId, BarType, ClientId, InstrumentId, OmsType, OrderStatus, OrderType, StrategyId, TraderId
from nautilus_trader.trading import Strategy, StrategyConfig

from engine import run
from engine.config import EXECUTION_BAR_MINUTES, RUNTIME_CONTRACT
from engine.live_errors import LiveRefusal as Refusal
from engine.live_cache import LiveCache
from engine.live_venue import BinanceReadOnly, Credentials, read_credentials, require_flat
from engine.load import LoadedStrategy, load_strategy, read_regular_file, read_universe


FORMAT = "live-run-v1"
IDENTIFIER = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{0,80}\Z")
HASH = re.compile(r"[0-9a-f]{64}\Z")
STOP_GRACE_SECONDS = 30


def write_json(path: Path, value: dict) -> None:
    temporary = path.with_name("." + path.name + ".partial")
    with temporary.open("w", encoding="utf-8") as stream:
        json.dump(value, stream, sort_keys=True, default=str)
        stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())
    os.chmod(temporary, 0o600)
    os.replace(temporary, path)


def read_manifest(path: Path) -> dict:
    try:
        value = json.loads(read_regular_file(path))
        if value["format"] != FORMAT or any(not IDENTIFIER.fullmatch(value[key])
                for key in ("run_id", "trader_id", "account_id")):
            raise ValueError
        if not HASH.fullmatch(value["credential_binding"]):
            raise ValueError
        symbols = value["symbols"]
        if not isinstance(symbols, list) or len(symbols) != 1 or not re.fullmatch(r"[A-Z0-9]+USDT", symbols[0]):
            raise ValueError
        source, origin, runtime, config = value["source"], value["origin_candidate"], value["runtime"], value["config"]
        if (runtime["runtime_contract"] != RUNTIME_CONTRACT
                or not HASH.fullmatch(source["source_sha256"]) or not HASH.fullmatch(origin["source_sha256"])
                or not HASH.fullmatch(value["universe_sha256"])
                or not re.fullmatch(r".+@sha256:[0-9a-f]{64}", runtime["image_ref"])
                or runtime["image_ref"].rsplit("@", 1)[1] != runtime["image_digest"]):
            raise ValueError
        for name in ("budget_usdt", "max_notional_per_order"):
            amount = Decimal(config[name])
            if not amount.is_finite() or amount <= 0:
                raise ValueError
        if type(config["duration_seconds"]) is not int or not 1 <= config["duration_seconds"] <= 86400:
            raise ValueError
        if not isinstance(value["strategy_file"], str) or not isinstance(value["universe_file"], str):
            raise ValueError
        return value
    except (KeyError, TypeError, ValueError, ArithmeticError) as exc:
        raise Refusal("LIVE_MANIFEST_INVALID", "Live needs a complete immutable single-symbol manifest") from exc


def bind_manifest(output: Path, manifest: dict) -> None:
    """A directory can never be rebound to a different account, source or image."""
    path = output / "manifest.json"
    if path.exists():
        if json.loads(read_regular_file(path)) != manifest:
            raise Refusal("LIVE_IDENTITY_CHANGED", "the retained manifest does not match this execution")
    else:
        write_json(path, manifest)


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
    if loaded.daily_warmup:
        raise Refusal("LIVE_WARMUP_UNSUPPORTED", "daily warm-up has not been validated for this Live source")
    return loaded


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
    account_verified: bool = False
    connection_failed: bool = False
    cache_guard: Any = None
    canceled: set[str] = field(default_factory=set)
    exits: set[str] = field(default_factory=set)

    def event(self, event: str, *, strict: bool = True, **fields) -> bool:
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
        if run.FAILURES:
            self.failed = True
            self.begin_stop("source_failure")
        elif self.stop_requested.is_set() or (self.output / "STOP").exists():
            self.begin_stop("requested")
        elif self.started is not None and time.monotonic() - self.started >= self.manifest["config"]["duration_seconds"]:
            self.begin_stop("duration")
        return self.stopping

    def require_connection(self) -> None:
        if not self.account_verified or self.connection_failed:
            raise Refusal("LIVE_CONNECTION_UNVERIFIED", "order commands require verified uninterrupted venue connectivity")

    def lose_connection(self, reason: str) -> None:
        # There is no public rc7 recovery-complete barrier. Keep existing venue orders
        # and cache custody; a later CONNECTED event cannot re-arm this process.
        self.account_verified, self.connection_failed, self.failed, self.native_flat = False, True, True, False
        # Stop native command producers before any journal I/O or the node's asynchronous
        # stop-check. The native manage_stop=False check makes this a local lifecycle stop;
        # residual fills still update the execution cache and native logs.
        try:
            if self.source is not None and Strategy.is_running(self.source):
                Strategy.stop(self.source)
        finally:
            self.begin_stop(reason)
            self.event("unresolved", reason=reason, strict=False)
            self.node.handle().stop()

    def verify_connected_account(self) -> None:
        snapshot = self.account_reader.snapshot(self.manifest["symbols"])
        observation = "connected-account-" + str(snapshot["observed_ns"]) + ".json"
        write_json(self.output / observation, snapshot)
        if self.mode == "run":
            from engine.live_venue import require_admission
            require_admission(snapshot, self.manifest)
        elif snapshot["config"]["dualSidePosition"] is not True \
                or snapshot["config"]["multiAssetsMargin"] is not False:
            raise Refusal("LIVE_ACCOUNT_MODE", "reconciliation requires the original hedge single-asset mode")
        self.event("started" if self.mode == "run" else "reconciled", mode=self.mode,
                   source_callbacks=self.mode == "run", observation=observation)
        self.account_verified = True


class LiveClock(run.GuardedClock):
    def _guard(self, api, callback):
        guarded = super()._guard(api, callback)
        return lambda *args, **kwargs: None if self._instance._live.observe_stop_intent() else guarded(*args, **kwargs)


def source_strategy_id(manifest: dict) -> StrategyId:
    """Fresh construction and observation-only recovery share the immutable v1 identity."""
    return StrategyId("LIVE-" + hashlib.sha256(manifest["run_id"].encode()).hexdigest()[:12])


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
        instance = run.allocate_strategy(cls, super().__new__, args, kwargs)
        require_source_config(instance, kwargs["strategy_id"])
        return instance

    def __init__(self, session: Session, loaded: LoadedStrategy):
        self._live = session
        args, kwargs = self._source_constructor_args
        del self._source_constructor_args
        super().__init__(*args, **kwargs)
        self._replay_input_start_ns = kwargs["trade_start_ns"]
        require_source_config(self, kwargs["strategy_id"])

    def submit_order(self, order, *args, **kwargs):
        self._live.require_connection()
        if not order.is_reduce_only and not self._live.check_storage():
            raise Refusal("LIVE_ENTRY_STOPPED", "new entries require healthy private persistence")
        if self._live.observe_stop_intent() and not order.is_reduce_only:
            raise Refusal("LIVE_ENTRY_STOPPED", "new entries are disabled while Live is stopping")
        if str(order.instrument_id) != f"{self._live.manifest['symbols'][0]}-PERP.BINANCE":
            raise Refusal("LIVE_INSTRUMENT_SCOPE", "an order must use the manifest instrument")
        if (order.emulation_trigger is not None or order.contingency_type is not None
                or order.order_list_id is not None or order.parent_order_id is not None or order.linked_order_ids):
            raise Refusal("LIVE_ORDER_UNSUPPORTED", "Live accepts reviewed independent venue orders only")
        return super().submit_order(order, *args, **kwargs)

    def submit_order_list(self, *args, **kwargs):
        raise Refusal("LIVE_ORDER_UNSUPPORTED", "Live does not reinterpret native order lists")

    def modify_order(self, *args, **kwargs):
        self._live.require_connection()
        return super().modify_order(*args, **kwargs)

    def modify_orders(self, *args, **kwargs):
        self._live.require_connection()
        return super().modify_orders(*args, **kwargs)

    def cancel_order(self, *args, **kwargs):
        self._live.require_connection()
        return super().cancel_order(*args, **kwargs)

    def cancel_orders(self, *args, **kwargs):
        self._live.require_connection()
        return super().cancel_orders(*args, **kwargs)

    def close_position(self, *args, **kwargs):
        self._live.require_connection()
        return super().close_position(*args, **kwargs)

    def market_exit(self):
        self._live.require_connection()
        return super().market_exit()

    def cancel_all_orders(self, instrument_id, order_side=None, client_id=None, strategy_only=True, params=None):
        if not strategy_only:
            raise Refusal("LIVE_ORDER_OWNERSHIP", "Live cannot cancel another owner's orders")
        self._live.require_connection()
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


def live_source(loaded: LoadedStrategy, session: Session):
    callbacks = run.guarded_callbacks(loaded.strategy_class)
    for name in (*run.DATA_CALLBACKS, "on_start", "on_historical_data", "on_historical_bars"):
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
    callbacks["on_stop"] = lambda self: None  # owned-position exit ran before the native stop
    callbacks["clock"] = property(lambda self: LiveClock(Strategy.clock.__get__(self, type(self)), self))
    combined = type("LiveSource_" + loaded.content_hash, (_LiveConfigured, loaded.strategy_class), callbacks)
    return combined(session, loaded)


def pending_orders(cache, strategy_id=None) -> list:
    """Python rc7 exposes orders(), including initialized local orders, not orders_active_local()."""
    return [order for order in cache.orders(strategy_id=strategy_id) if not order.is_closed]


def source_outcome(session: Session, cache) -> None:
    """Keep native failures authoritative and label the source's own declared findings."""
    if session.mode != "run":
        return  # Old source failures do not invalidate a later successful flat reconciliation.
    denied = session.native_order_failure or any(
        order.status in {OrderStatus.DENIED, OrderStatus.REJECTED} for order in cache.orders())
    session.failed = session.failed or denied
    if session.source is None:
        return
    try:
        found = session.source.replay_integrity_findings(denied)
        if not isinstance(found, list) or any(not isinstance(value, str) for value in found):
            raise ValueError("invalid source finding shape")
        session.failed = session.failed or bool(found)
        session.event("source_findings", strict=False, evidence="source_self_report",
                      denied_or_rejected_native_orders=denied, findings=[value[:1000] for value in found[:100]],
                      finding_count=len(found))
    except Exception as exc:
        session.failed = True
        session.event("source_findings", strict=False, evidence="source_self_report",
                      denied_or_rejected_native_orders=denied, failure_type=type(exc).__name__)


class Observer(Strategy):
    """Observe native state; only a fresh run may ask its source to exit owned positions."""

    def __init__(self, session: Session):
        super().__init__(StrategyConfig(strategy_id=StrategyId("LIVE-OBSERVER")))
        self.session = session
        self.last_query = 0.0

    def on_start(self):
        self.session.started = time.monotonic()
        self.subscribe_socket_state(client_id=ClientId("BINANCE"), priority=100)
        # The first tick runs after start_trader and buffered startup socket events.
        # Source on_start may subscribe/request data, but cannot submit before admission.
        self.clock.set_timer("live-observe", timedelta(seconds=1), callback=self.tick)
        if not self.session.check_storage():
            self.session.node.handle().stop()

    def on_stop(self):
        self.clock.cancel_timer("live-observe")
        self.unsubscribe_socket_state(client_id=ClientId("BINANCE"))

    def on_socket_state(self, event):
        self.session.event("socket_state", strict=False, client_id=str(event.client_id),
                           endpoint=str(event.endpoint), state=str(event.state))
        if event.state == SocketState.DISCONNECTED and not self.session.connection_failed:
            self.session.lose_connection("venue_disconnected")

    def tick(self, _event):
        try:
            self.observe()
        except Exception as exc:
            self.session.failed = True
            self.session.begin_stop("observer_failure")
            self.session.event("unresolved", failure_type=type(exc).__name__, reason="observer_failure", strict=False)
            # No retry of an ambiguous closing request; retain venue protection and custody.
            self.session.node.handle().stop()

    def observe(self):
        session = self.session
        now = time.monotonic()
        if session.connection_failed:
            return
        healthy = session.check_storage()
        if not session.account_verified:
            if not healthy:
                session.node.handle().stop()
                return
            try:
                session.verify_connected_account()
            except Exception:
                session.lose_connection("connected_account_unverified")
                return
        if healthy and now - self.last_query >= 10:
            self.query_account(AccountId(session.manifest["account_id"]))
            self.last_query = now
        if not session.observe_stop_intent():
            return
        if session.mode == "reconcile":
            session.node.handle().stop()
            return
        source = session.source
        positions = self.cache.positions_open(strategy_id=source.strategy_id)
        pending = pending_orders(self.cache, source.strategy_id)
        entries = [order for order in pending if not order.is_reduce_only]
        for order in entries:
            cid = str(order.client_order_id)
            if cid not in session.canceled:
                source.cancel_order(order.client_order_id)
                session.canceled.add(cid)
        closing = [order for order in pending if order.is_reduce_only and order.order_type == OrderType.MARKET]
        if not entries and not closing:
            for position in positions:
                pid = str(position.id)
                if pid not in session.exits:
                    # The native execution engine owns the closing order and asynchronous fills.
                    source.close_position(position, reduce_only=True)
                    session.exits.add(pid)
        if not positions and not entries:
            for order in pending:
                cid = str(order.client_order_id)
                if cid not in session.canceled:
                    source.cancel_order(order.client_order_id)
                    session.canceled.add(cid)
            if not pending:
                session.native_flat = not (session.persistence_failed or session.journal_failed)
                session.node.handle().stop()
        if session.stop_at is not None and now - session.stop_at > STOP_GRACE_SECONDS:
            session.failed = True
            session.event("unresolved", reason="native_exit_timeout", strict=False)
            session.node.handle().stop()


def build_node(session: Session, credentials: Credentials, cache_config, loaded=None):
    manifest = session.manifest
    instrument_ids = [f"{symbol}-PERP.BINANCE" for symbol in manifest["symbols"]]
    provider = BinanceInstrumentProviderConfig(load_all=False, load_ids=instrument_ids)
    proxy = manifest["config"].get("proxy_url")
    if session.account_reader is None:
        session.account_reader = BinanceReadOnly(credentials, proxy_url=proxy)
    builder = LiveNode.builder("live", TraderId(manifest["trader_id"]), Environment.LIVE)
    builder.with_logging(LoggerConfig(stdout_level=LogLevel.WARNING, print_config=False))
    builder.with_cache_config(CacheConfig(use_instance_id=False, flush_on_start=False))
    builder.with_cache_database_factory(cache_config)
    builder.with_load_state(False).with_save_state(False)
    builder.with_reconciliation(True)
    builder.with_exec_engine_config(LiveExecutionEngineConfig(
        load_cache=True, reconciliation=True, reconciliation_instrument_ids=instrument_ids,
        filter_unclaimed_external_orders=True, open_check_interval_secs=10.0, position_check_interval_secs=30.0))
    builder.with_data_engine_config(LiveDataEngineConfig(time_bars_timestamp_on_close=True,
        time_bars_skip_first_non_full_bar=True, validate_data_sequence=True))
    builder.with_risk_engine_config(LiveRiskEngineConfig(max_order_submit_rate="10/00:00:01",
        max_notional_per_order={iid: Decimal(manifest["config"]["max_notional_per_order"]) for iid in instrument_ids}))
    builder.with_delay_post_stop_secs(5)
    builder.add_data_client("BINANCE", BinanceDataClientFactory(), BinanceDataClientConfig(
        product_type=BinanceProductType.USD_M, environment=BinanceEnvironment.LIVE,
        instrument_provider=provider, proxy_url=proxy))
    builder.add_exec_client("BINANCE", BinanceExecutionClientFactory(), BinanceExecutionClientConfig(
        account_id=AccountId(manifest["account_id"]), product_type=BinanceProductType.USD_M,
        environment=BinanceEnvironment.LIVE, api_key=credentials.api_key, api_secret=credentials.api_secret,
        use_ws_trading=False, instrument_provider=provider, proxy_url=proxy,
        oms_type=OmsType.HEDGING, use_position_ids=False, futures_leverages=None, futures_margin_types=None))
    node = builder.build()
    session.node = node
    try:
        # Observer is always registered first; reconnect never constructs a trading source.
        node.add_strategy(Observer(session))
        if session.mode == "run":
            if loaded is None:
                raise Refusal("LIVE_SOURCE_MISSING", "a fresh run needs the reviewed source")
            if session.observe_stop_intent():
                raise Refusal("LIVE_ENTRY_STOPPED", "a stopped run cannot initialize trading source callbacks")
            session.source = live_source(loaded, session)
            node.add_strategy(session.source)
            # Native registration can apply Python-visible config fields (including
            # order_id_tag), so validate the identity the running node will use.
            require_source_config(session.source, source_strategy_id(manifest))
        else:
            # Register OMS before native cache load/reconciliation, including accepted entries
            # which have no first fill or position mapping yet. No old source is imported.
            node.add_strategy(Strategy(StrategyConfig(
                strategy_id=source_strategy_id(manifest), oms_type=OmsType.NETTING,
                use_uuid_client_order_ids=True, manage_stop=False, manage_gtd_expiry=False,
                manage_contingent_orders=False)))
    except BaseException:
        node.dispose()
        session.node, session.source = None, None
        raise
    return node


def execute(args) -> int:
    os.umask(0o077)
    manifest = read_manifest(args.manifest)
    credentials = read_credentials(args.credentials_file)
    if credentials.binding != manifest["credential_binding"]:
        raise Refusal("LIVE_ACCOUNT_BINDING", "the credential does not match the private execution binding")
    if importlib.metadata.version("nautilus_trader") != "2.0.0rc7":
        raise Refusal("LIVE_RUNTIME_VERSION", "Live requires the reviewed Nautilus version")
    args.output.mkdir(mode=0o700, parents=True, exist_ok=True)
    lock = (args.output / "runner.lock").open("a")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        lock.close()
        raise Refusal("LIVE_ALREADY_RUNNING", "this execution already has a runner") from None
    with lock:
        bind_manifest(args.output, manifest)
        session = Session(manifest, args.output, args.mode)
        observer = BinanceReadOnly(credentials, proxy_url=manifest["config"].get("proxy_url"))
        session.account_reader = observer
        snapshot = observer.snapshot(manifest["symbols"])
        observation = "preflight-" + str(snapshot["observed_ns"]) + ".json"
        write_json(args.output / observation, snapshot)
        session.event("preflight", mode=args.mode, observation=observation)
        if args.mode == "preflight":
            return 0
        if args.mode == "run":
            from engine.live_venue import require_admission
            require_admission(snapshot, manifest)
            require_flat(snapshot)
            loaded = source_for_run(manifest)
            try:
                with (args.output / "armed.json").open("x") as stream:
                    json.dump({"run_id": manifest["run_id"], "observed_ns": time.time_ns()}, stream)
                    stream.flush()
                    os.fsync(stream.fileno())
            except FileExistsError:
                raise Refusal("LIVE_COLD_RESTART", "a previously armed run can only reconcile without source callbacks") from None
        else:
            loaded = None
            if not (args.output / "armed.json").is_file():
                raise Refusal("LIVE_RUN_MISSING", "reconciliation needs the original armed execution")
            if snapshot["config"]["dualSidePosition"] is not True \
                    or snapshot["config"]["multiAssetsMargin"] is not False:
                raise Refusal("LIVE_ACCOUNT_MODE", "reconciliation requires the original hedge single-asset mode")
        run.clear_failures()
        run.FAILURE_PATH = args.output / "runtime_failures.jsonl"
        signals = {signal.SIGTERM, signal.SIGINT}
        signal.pthread_sigmask(signal.SIG_BLOCK, signals)
        def await_signal():
            signal.sigwait(signals)
            session.stop_requested.set()
        threading.Thread(target=await_signal, daemon=True).start()
        cache = LiveCache(args.output, resume=args.mode == "reconcile")
        session.cache_guard = cache
        node = None
        try:
            node = build_node(session, credentials, cache.config, loaded)
            session.event("connecting", mode=args.mode)
            node.run()
            source_outcome(session, node.cache)
            session.check_storage()
            # Late fills/cancels may arrive during native shutdown's residual-event grace.
            # Recheck the whole cache at the completed boundary, never a stale timer cut.
            observed_flat = not (pending_orders(node.cache) or node.cache.positions_open())
            session.native_flat = observed_flat and (session.native_flat or args.mode == "reconcile") \
                and not (session.persistence_failed or session.journal_failed or session.connection_failed)
        except BaseException as exc:
            session.event("unresolved", failure_type=type(exc).__name__, strict=False,
                          code=exc.code if isinstance(exc, Refusal) else None)
            raise
        finally:
            try:
                if node is not None:
                    node.dispose()
                session.node, session.source = None, None
            finally:
                try:
                    cache.close()
                except Refusal:
                    session.persistence_failed, session.native_flat = True, False
                    session.event("unresolved", reason="persistence_shutdown_failure", strict=False)
                    raise
        if session.native_flat:
            final_snapshot = observer.snapshot(manifest["symbols"])
            observation = "final-account-" + str(final_snapshot["observed_ns"]) + ".json"
            write_json(args.output / observation, final_snapshot)
            require_flat(final_snapshot)
            session.event("clean_stop" if args.mode == "run" else "reconciled_flat",
                          source_failed=session.failed, observation=observation)
            return 1 if session.failed else 0
        session.event("reconcile_stopped" if args.mode == "reconcile" else "unresolved", mode=args.mode)
        return 0 if args.mode == "reconcile" else 1


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--credentials-file", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--mode", choices=("preflight", "run", "reconcile"), required=True)
    args = parser.parse_args(argv)
    try:
        return execute(args)
    except Refusal as exc:
        print(str(exc), file=sys.stderr)
        return 2
    except Exception as exc:
        # Native transport errors can carry signed URLs. Do not print exception text.
        print(f"LIVE_UNRESOLVED: {type(exc).__name__}; private originals retained", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
