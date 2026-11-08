"""Native Binance LiveNode assembly; replay and Sandbox keep their own builders."""
from __future__ import annotations
from nautilus_trader.adapters.binance import (
    BinanceDataClientConfig, BinanceDataClientFactory, BinanceEnvironment,
    BinanceExecutionClientConfig, BinanceExecutionClientFactory,
    BinanceInstrumentProviderConfig, BinanceProductType,
)
from nautilus_trader.common import CacheConfig, Environment, LoggerConfig, LogLevel
from nautilus_trader.live import LiveDataEngineConfig, LiveExecutionEngineConfig, LiveNode, LiveRiskEngineConfig
from nautilus_trader.model import AccountId, OmsType, TraderId
from nautilus_trader.trading import Strategy, StrategyConfig
from engine.live_errors import LiveRefusal as Refusal
from engine.live_venue import BinanceReadOnly, Credentials
from engine.live_lifecycle import Observer
from engine.live_records import source_strategy_id
from engine.live_session import Session
from engine.live_source import live_source, require_source_config

def build_node(session: Session, credentials: Credentials, cache_config, loaded=None,
               *, source_module: str = "engine.live"):
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
    # The native per-order notional cap also blocks reductions. Each LIMIT
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
            session.source = live_source(loaded, session, source_module=source_module)
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
