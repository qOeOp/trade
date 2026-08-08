#!/usr/bin/env python3
import asyncio
from decimal import Decimal

from vibe_trader.adapters.bybit import BybitDataClientConfig
from vibe_trader.adapters.bybit import BybitEnvironment
from vibe_trader.adapters.bybit import BybitLiveDataClientFactory
from vibe_trader.adapters.bybit import BybitProductType
from vibe_trader.adapters.sandbox.config import SandboxExecutionClientConfig
from vibe_trader.adapters.sandbox.factory import SandboxLiveExecClientFactory
from vibe_trader.config import InstrumentProviderConfig
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
    Show how to run a strategy in a sandbox for the Bybit venue.
    """
    instrument_provider_config = InstrumentProviderConfig(load_all=True)

    # Set up the execution clients (required per venue)
    venues = ["BYBIT"]

    exec_clients = {}
    for venue in venues:
        exec_clients[venue] = SandboxExecutionClientConfig(
            venue=venue,
            starting_balances=["10_000 USDT", "10 ETH"],
            instrument_provider=instrument_provider_config,
            account_type="MARGIN",
            oms_type="NETTING",
        )

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
        data_clients={
            "BYBIT": BybitDataClientConfig(
                environment=BybitEnvironment.MAINNET,
                instrument_provider=instrument_provider_config,
                product_types=(BybitProductType.LINEAR,),
            ),
        },
        exec_clients=exec_clients,
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
        instrument_id=InstrumentId.from_str("ETHUSDT-LINEAR.BYBIT"),
        external_order_claims=[InstrumentId.from_str("ETHUSDT-LINEAR.BYBIT")],
        bar_type=BarType.from_str("ETHUSDT-LINEAR.BYBIT-1-MINUTE-LAST-EXTERNAL"),
        atr_period=20,
        atr_multiple=6.0,
        trade_size=Decimal("0.010"),
        # manage_gtd_expiry=True,
    )
    # Instantiate your strategy
    strategy = VolatilityMarketMaker(config=strat_config)

    # Add your strategies and modules
    node.trader.add_strategy(strategy)

    # Register client factories with the node
    for data_client in config_node.data_clients:
        node.add_data_client_factory(data_client, BybitLiveDataClientFactory)

    for exec_client in config_node.exec_clients:
        node.add_exec_client_factory(exec_client, SandboxLiveExecClientFactory)

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
