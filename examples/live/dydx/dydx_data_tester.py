#!/usr/bin/env python3
"""
DYdX v4 DataTester example using the Rust-backed adapter.

This script demonstrates how to use the DataTester actor to validate
market data functionality for the dYdX v4 adapter.

Usage:
  python dydx_data_tester.py

"""

from vibe_trader.adapters.dydx import DYDX_VENUE
from vibe_trader.adapters.dydx import DydxDataClientConfig
from vibe_trader.adapters.dydx import DydxLiveDataClientFactory
from vibe_trader.adapters.dydx import DydxNetwork
from vibe_trader.adapters.dydx.constants import DYDX
from vibe_trader.config import InstrumentProviderConfig
from vibe_trader.config import LoggingConfig
from vibe_trader.config import TradingNodeConfig
from vibe_trader.live.node import TradingNode
from vibe_trader.model.data import BarType
from vibe_trader.model.identifiers import InstrumentId
from vibe_trader.model.identifiers import TraderId
from vibe_trader.test_kit.strategies.tester_data import DataTester
from vibe_trader.test_kit.strategies.tester_data import DataTesterConfig


# *** THIS IS A TEST STRATEGY WITH NO ALPHA ADVANTAGE WHATSOEVER. ***
# *** IT IS NOT INTENDED TO BE USED TO TRADE LIVE WITH REAL MONEY. ***

# dYdX v4 perpetual markets
# All instruments follow {BASE}-{QUOTE}-PERP.DYDX naming
symbol = "ETH-USD-PERP"
instrument_id = InstrumentId.from_str(f"{symbol}.{DYDX_VENUE}")

# Configure the trading node
config_node = TradingNodeConfig(
    trader_id=TraderId("TESTER-001"),
    logging=LoggingConfig(
        log_level="INFO",
        use_pyo3=True,
    ),
    data_clients={
        DYDX: DydxDataClientConfig(
            environment=DydxNetwork.MAINNET,
            instrument_provider=InstrumentProviderConfig(load_all=True),
        ),
    },
    timeout_connection=20.0,
    timeout_reconciliation=10.0,
    timeout_portfolio=10.0,
    timeout_disconnection=10.0,
    timeout_post_stop=1.0,
)

# Instantiate the node with a configuration
node = TradingNode(config=config_node)

# Configure your data tester
config_tester = DataTesterConfig(
    instrument_ids=[instrument_id],
    bar_types=[BarType.from_str(f"{instrument_id}-1-MINUTE-LAST-EXTERNAL")],
    subscribe_instrument=True,
    # subscribe_book_deltas=True,
    # subscribe_book_at_interval=True,
    subscribe_quotes=True,
    subscribe_trades=True,
    subscribe_mark_prices=True,
    subscribe_index_prices=True,
    subscribe_funding_rates=True,
    subscribe_instrument_status=True,
    subscribe_bars=True,
    # request_trades=True,
    # request_bars=True,
    log_data=True,
)

# Instantiate your actor
tester = DataTester(config=config_tester)

# Add your actors and modules
node.trader.add_actor(tester)

# Register your client factories with the node (using v4 Rust-backed factory)
node.add_data_client_factory(DYDX, DydxLiveDataClientFactory)
node.build()


# Stop and dispose of the node with SIGINT/CTRL+C
if __name__ == "__main__":
    try:
        node.run()
    finally:
        node.dispose()
