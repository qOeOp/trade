"""Native Binance LiveNode assembly; replay and Sandbox keep their own builders."""
from __future__ import annotations
from nautilus_trader.adapters.binance import (
    BinanceDataClientConfig, BinanceDataClientFactory, BinanceEnvironment,
    BinanceExecutionClientConfig, BinanceExecutionClientFactory,
    BinanceInstrumentProviderConfig, BinanceProductType,
)
from nautilus_trader.common import CacheConfig, Environment, LoggerConfig, LogLevel
from nautilus_trader.live import (
    LiveDataEngineConfig, LiveExecutionEngineConfig, LiveNode, LiveNodeConfig, LiveRiskEngineConfig,
)
from nautilus_trader.model import AccountId, ExecAlgorithmId, OmsType, TraderId
from nautilus_trader.persistence import DataCatalogConfig
from nautilus_trader.trading import ExecutionAlgorithm, ExecutionAlgorithmConfig, Strategy
from engine import history, strategy as strategy_runtime
from engine.live_errors import LiveRefusal as Refusal
from engine.live_venue import BinanceReadOnly, Credentials
from engine.live_lifecycle import Observer
from engine.config import instrument_id
from engine.live_records import strategy_ids
from engine.live_session import Session
from engine.live_source import live_source

ENTRY_GATE = ExecAlgorithmId("LIVE-GATE")
ACCOUNT_PURGE_MINUTES = 60
ACCOUNT_LOOKBACK_MINUTES = 24 * 60  # a start's account.csv keeps the last day of account states


def build_node(session: Session, credentials: Credentials, cache_config, loaded=None,
               *, source_module: str = "engine.live"):
    manifest = session.manifest
    instrument_ids = [instrument_id(symbol) for symbol in manifest["symbols"]]
    provider = BinanceInstrumentProviderConfig(load_all=False, load_ids=instrument_ids)
    proxy = manifest["config"].get("proxy_url")
    if session.account_reader is None:
        session.account_reader = BinanceReadOnly(credentials, proxy_url=proxy)
    data = LiveDataEngineConfig(time_bars_timestamp_on_close=True, time_bars_skip_first_non_full_bar=False,
                                validate_data_sequence=True, time_bars_build_delay=history.BUILD_DELAY_US)
    builder = LiveNode.builder("live", TraderId(manifest["trader_id"]), Environment.LIVE)
    if session.mode == "run":
        # The warm-up is requested from the run's Catalog, which it fills at T (engine.history).
        builder = builder.from_config("live", LiveNodeConfig(
            environment=Environment.LIVE, trader_id=TraderId(manifest["trader_id"]), data_engine=data,
            catalogs=[DataCatalogConfig(path=str(session.catalog()))]))
    builder.with_logging(LoggerConfig(stdout_level=LogLevel.WARNING, print_config=False))
    builder.with_cache_config(CacheConfig(use_instance_id=False, flush_on_start=False,
                                          bar_capacity=history.bar_capacity(loaded.warmup if loaded else ())))
    builder.with_cache_database_factory(cache_config)
    builder.with_load_state(False).with_save_state(False)
    builder.with_reconciliation(True)
    builder.with_exec_engine_config(LiveExecutionEngineConfig(
        load_cache=True, reconciliation=True, reconciliation_instrument_ids=instrument_ids,
        filter_unclaimed_external_orders=True, open_check_interval_secs=10.0, position_check_interval_secs=30.0,
        # Account states in memory only (rc7 never trims Redis); orders and positions stay whole for the reports.
        purge_account_events_interval_mins=ACCOUNT_PURGE_MINUTES,
        purge_account_events_lookback_mins=ACCOUNT_LOOKBACK_MINUTES))
    builder.with_data_engine_config(data)
    # The native per-order notional cap also blocks reductions. Each
    # entry is valued at the admission boundary; all remaining native risk stays on.
    builder.with_risk_engine_config(LiveRiskEngineConfig(max_order_submit_rate="10/00:00:01"))
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
            session.sources = live_source(loaded, session, source_module=source_module)
            # Denies the source's entries natively while a missing bar holds entries closed (engine.live_connection).
            session.entry_gate = ExecutionAlgorithm(ExecutionAlgorithmConfig(exec_algorithm_id=ENTRY_GATE))
            node.add_exec_algorithm(session.entry_gate)
            node.add_actor(history.WarmupActor(history.WarmupActorConfig(live=True)))
            for symbol, source in session.sources.items():
                node.add_strategy(source)
                # Native registration can apply Python-visible config fields (including
                # order_id_tag), so validate the identity the running node will use.
                strategy_runtime.require_source_config(source, strategy_ids(manifest)[symbol])
        else:
            # Register OMS before native cache load/reconciliation, including accepted entries
            # which have no first fill or position mapping yet. No old source is imported.
            for strategy in strategy_ids(manifest).values():
                node.add_strategy(Strategy(strategy_runtime.source_config(strategy)))
    except BaseException:
        node.dispose()
        session.node, session.entry_gate = None, None
        session.sources = {}
        raise
    return node
