#!/usr/bin/env python3
import asyncio
from decimal import Decimal

from vibe_trader.adapters.binance import BINANCE
from vibe_trader.adapters.binance import BinanceAccountType
from vibe_trader.adapters.binance import BinanceDataClientConfig
from vibe_trader.adapters.binance.common.enums import BinanceEnvironment
from vibe_trader.adapters.binance.factories import BinanceLiveDataClientFactory
from vibe_trader.adapters.sandbox.config import SandboxExecutionClientConfig
from vibe_trader.adapters.sandbox.factory import SandboxLiveExecClientFactory
from vibe_trader.config import CacheConfig
from vibe_trader.config import InstrumentProviderConfig
from vibe_trader.config import LiveExecEngineConfig
from vibe_trader.config import LoggingConfig
from vibe_trader.config import TradingNodeConfig
from vibe_trader.examples.strategies.volatility_market_maker import VolatilityMarketMaker
from vibe_trader.examples.strategies.volatility_market_maker import VolatilityMarketMakerConfig
from vibe_trader.live.node import TradingNode
from vibe_trader.model.data import BarType
from vibe_trader.model.identifiers import InstrumentId
from vibe_trader.model.identifiers import TraderId


# *** THIS IS A TEST STRATEGY WITH NO ALPHA ADVANTAGE WHATSOEVER. ***
# *** IT IS NOT INTENDED TO BE USED TO TRADE LIVE WITH REAL MONEY. ***


async def main():
    """
    Show how to run a strategy in a sandbox for the Binance venue.
    """
    # Configure the trading node
    config_node = TradingNodeConfig(
        trader_id=TraderId("TESTER-001"),
        logging=LoggingConfig(
            log_level="INFO",
            # log_level_file="DEBUG",
            # log_file_format="json",
            log_colors=True,
            use_pyo3=True,
        ),
        exec_engine=LiveExecEngineConfig(
            reconciliation=True,
            reconciliation_lookback_mins=1440,
            filter_position_reports=True,
            # snapshot_orders=True,
            # snapshot_positions=True,
            # snapshot_positions_interval_secs=5.0,
        ),
        cache=CacheConfig(
            # database=DatabaseConfig(timeout=2),
            timestamps_as_iso8601=True,
            flush_on_start=False,
        ),
        # message_bus=MessageBusConfig(
        #     database=DatabaseConfig(timeout=2),
        #     encoding="json",
        #     timestamps_as_iso8601=True,
        #     streams_prefix="quoters",
        #     use_instance_id=False,
        #     # types_filter=[QuoteTick],
        #     autotrim_mins=30,
        #     heartbeat_interval_secs=1,
        # ),
        data_clients={
            BINANCE: BinanceDataClientConfig(
                account_type=BinanceAccountType.USDT_FUTURES,
                base_url_http=None,  # Override with custom endpoint
                base_url_ws=None,  # Override with custom endpoint
                environment=BinanceEnvironment.TESTNET,
                us=False,  # If client is for Binance US
                instrument_provider=InstrumentProviderConfig(load_all=True),
            ),
        },
        exec_clients={
            BINANCE: SandboxExecutionClientConfig(
                venue=BINANCE,
                starting_balances=["10_000 USDT", "10 ETH"],
            ),
        },
        timeout_connection=30.0,
        timeout_reconciliation=10.0,
        timeout_portfolio=10.0,
        timeout_disconnection=10.0,
        timeout_post_stop=5.0,
    )

    # Instantiate the node with a configuration
    node = TradingNode(config=config_node)

    # Configure your strategy
    strat_config = VolatilityMarketMakerConfig(
        instrument_id=InstrumentId.from_str("ETHUSDT-PERP.BINANCE"),
        external_order_claims=[InstrumentId.from_str("ETHUSDT-PERP.BINANCE")],
        bar_type=BarType.from_str("ETHUSDT-PERP.BINANCE-1-MINUTE-LAST-EXTERNAL"),
        atr_period=20,
        atr_multiple=6.0,
        trade_size=Decimal("0.010"),
        # manage_gtd_expiry=True,
    )
    # Instantiate your strategy
    strategy = VolatilityMarketMaker(config=strat_config)

    # Add your strategies and modules
    node.trader.add_strategy(strategy)

    # Register your client factories with the node (can take user-defined factories)
    node.add_data_client_factory(BINANCE, BinanceLiveDataClientFactory)
    node.add_exec_client_factory(BINANCE, SandboxLiveExecClientFactory)
    node.build()

    try:
        await node.run_async()
    finally:
        await node.stop_async()
        await asyncio.sleep(1)
        node.dispose()


# Stop and dispose of the node with SIGINT/CTRL+C
if __name__ == "__main__":
    asyncio.run(main())
