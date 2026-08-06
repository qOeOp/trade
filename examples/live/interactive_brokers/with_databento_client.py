#!/usr/bin/env python3
import os
import threading
import time

from vibe_trader.adapters.databento import DATABENTO
from vibe_trader.adapters.databento import DatabentoDataClientConfig
from vibe_trader.adapters.databento import DatabentoLiveDataClientFactory
from vibe_trader.adapters.interactive_brokers.common import IB
from vibe_trader.adapters.interactive_brokers.config import InteractiveBrokersExecClientConfig
from vibe_trader.adapters.interactive_brokers.config import (
    InteractiveBrokersInstrumentProviderConfig,
)
from vibe_trader.adapters.interactive_brokers.config import SymbologyMethod
from vibe_trader.adapters.interactive_brokers.factories import (
    InteractiveBrokersLiveExecClientFactory,
)
from vibe_trader.config import InstrumentProviderConfig
from vibe_trader.config import LiveExecClientConfig
from vibe_trader.config import LoggingConfig
from vibe_trader.config import RoutingConfig
from vibe_trader.config import TradingNodeConfig
from vibe_trader.examples.interactive_brokers import resolve_ib_endpoint
from vibe_trader.examples.strategies.subscribe import SubscribeStrategy
from vibe_trader.examples.strategies.subscribe import SubscribeStrategyConfig
from vibe_trader.live.node import TradingNode
from vibe_trader.model.identifiers import InstrumentId


# *** THIS IS A TEST STRATEGY WITH NO ALPHA ADVANTAGE WHATSOEVER. ***
# *** IT IS NOT INTENDED TO BE USED TO TRADE LIVE WITH REAL MONEY. ***

# *** THIS INTEGRATION IS STILL UNDER CONSTRUCTION. ***
# *** CONSIDER IT TO BE IN AN UNSTABLE BETA PHASE AND EXERCISE CAUTION. ***

ENABLE_EXECUTION_CLIENT = os.getenv("IB_EXAMPLE_ENABLE_EXECUTION", "0") == "1"
EXEC_ACCOUNT_ID = os.getenv("TWS_ACCOUNT")
IB_HOST, IB_PORT = resolve_ib_endpoint("IB_EXAMPLE_HOST", "IB_EXAMPLE_PORT")

instrument_ids = [
    InstrumentId.from_str("SPY.XNAS"),
    InstrumentId.from_str("AAPL.XNAS"),
    InstrumentId.from_str("V.XNAS"),
    InstrumentId.from_str("CLM6.GLBX"),
    InstrumentId.from_str("ESM6.GLBX"),
    InstrumentId.from_str("TFMG7.NDEX"),
    InstrumentId.from_str("CN5.IFEU"),
    InstrumentId.from_str("GH5.IFEU"),
]

exec_clients: dict[str, LiveExecClientConfig] = {}
if ENABLE_EXECUTION_CLIENT and EXEC_ACCOUNT_ID is not None:
    exec_clients = {
        IB: InteractiveBrokersExecClientConfig(
            ibg_host=IB_HOST,
            ibg_port=IB_PORT,
            ibg_client_id=int(os.getenv("IB_EXAMPLE_EXEC_CLIENT_ID", "1222")),
            account_id=EXEC_ACCOUNT_ID,
            instrument_provider=InteractiveBrokersInstrumentProviderConfig(
                symbology_method=SymbologyMethod.IB_SIMPLIFIED,
                load_ids=frozenset(instrument_ids),
            ),
            routing=RoutingConfig(
                default=True,
            ),
        ),
    }

# Configure the trading node

config_node = TradingNodeConfig(
    trader_id="TESTER-001",
    logging=LoggingConfig(log_level="INFO"),
    data_clients={
        DATABENTO: DatabentoDataClientConfig(
            http_gateway=None,
            instrument_provider=InstrumentProviderConfig(load_all=True),
            instrument_ids=instrument_ids,
        ),
    },
    exec_clients=exec_clients,
    timeout_connection=90.0,
    timeout_reconciliation=5.0,
    timeout_portfolio=5.0,
    timeout_disconnection=5.0,
    timeout_post_stop=2.0,
)


# Instantiate the node with a configuration
node = TradingNode(config=config_node)

# Configure your strategy
strategy_config = SubscribeStrategyConfig(
    instrument_id=InstrumentId.from_str("SPY.XNAS"),
    trade_ticks=False,
    quote_ticks=True,
    bars=True,
)
# Instantiate your strategy
strategy = SubscribeStrategy(config=strategy_config)

# Add your strategies and modules
node.trader.add_strategy(strategy)

# Register your client factories with the node (can take user-defined factories)
node.add_data_client_factory(DATABENTO, DatabentoLiveDataClientFactory)
if exec_clients:
    node.add_exec_client_factory(IB, InteractiveBrokersLiveExecClientFactory)
node.build()


# Stop and dispose of the node with SIGINT/CTRL+C
if __name__ == "__main__":
    auto_stop_seconds = int(os.getenv("IB_EXAMPLE_AUTO_STOP_SECONDS", "20"))

    def stop_after_delay() -> None:
        time.sleep(auto_stop_seconds)
        node.stop()

    if auto_stop_seconds > 0:
        threading.Thread(target=stop_after_delay, daemon=True).start()
    try:
        node.run()
    finally:
        node.dispose()
