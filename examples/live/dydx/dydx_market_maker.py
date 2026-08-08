#!/usr/bin/env python3
"""
DYdX v4 Market Maker example using the Rust-backed adapter.

This example demonstrates the volatility market maker strategy on dYdX v4
using the new Rust-backed HTTP, WebSocket, and gRPC clients.

Prerequisites:
  - Environment variables:
      DYDX_WALLET_ADDRESS (or DYDX_TESTNET_WALLET_ADDRESS for testnet)
      DYDX_PRIVATE_KEY (or DYDX_TESTNET_PRIVATE_KEY for testnet)

Usage:
  python dydx_market_maker.py

"""

from decimal import Decimal

from vibe_trader.adapters.dydx import DydxDataClientConfig
from vibe_trader.adapters.dydx import DydxExecClientConfig
from vibe_trader.adapters.dydx import DydxLiveDataClientFactory
from vibe_trader.adapters.dydx import DydxLiveExecClientFactory
from vibe_trader.adapters.dydx import DydxNetwork
from vibe_trader.adapters.dydx.constants import DYDX
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

# dYdX v4 perpetual market
symbol = "ETH-USD-PERP"
trade_size = Decimal("0.010")

# Configure the trading node
config_node = TradingNodeConfig(
    trader_id=TraderId("DYDX-V4-MM-001"),
    logging=LoggingConfig(log_level="INFO", use_pyo3=True),
    exec_engine=LiveExecEngineConfig(
        reconciliation=True,
        reconciliation_lookback_mins=1440,
    ),
    cache=CacheConfig(
        timestamps_as_iso8601=True,
        buffer_interval_ms=100,
    ),
    data_clients={
        DYDX: DydxDataClientConfig(
            environment=DydxNetwork.MAINNET,
            instrument_provider=InstrumentProviderConfig(load_all=True),
        ),
    },
    exec_clients={
        DYDX: DydxExecClientConfig(
            environment=DydxNetwork.MAINNET,
            instrument_provider=InstrumentProviderConfig(load_all=True),
        ),
    },
    timeout_connection=20.0,
    timeout_reconciliation=10.0,
    timeout_portfolio=10.0,
    timeout_disconnection=10.0,
    timeout_post_stop=5.0,
)

# Instantiate the node with a configuration
node = TradingNode(config=config_node)

# Configure your strategy
strat_config = VolatilityMarketMakerConfig(
    instrument_id=InstrumentId.from_str(f"{symbol}.{DYDX}"),
    external_order_claims=[InstrumentId.from_str(f"{symbol}.{DYDX}")],
    bar_type=BarType.from_str(f"{symbol}.DYDX-1-MINUTE-LAST-EXTERNAL"),
    atr_period=20,
    atr_multiple=3.0,
    trade_size=trade_size,
)

# Instantiate your strategy
strategy = VolatilityMarketMaker(config=strat_config)

# Add your strategies and modules
node.trader.add_strategy(strategy)

# Register your client factories with the node (using v4 Rust-backed factories)
node.add_data_client_factory(DYDX, DydxLiveDataClientFactory)
node.add_exec_client_factory(DYDX, DydxLiveExecClientFactory)
node.build()


# Stop and dispose of the node with SIGINT/CTRL+C
if __name__ == "__main__":
    try:
        node.run()
    finally:
        node.dispose()
