#!/usr/bin/env python3
import os
import threading
import time

from vibe_trader.adapters.interactive_brokers.common import IB
from vibe_trader.adapters.interactive_brokers.config import IBMarketDataTypeEnum
from vibe_trader.adapters.interactive_brokers.config import InteractiveBrokersDataClientConfig
from vibe_trader.adapters.interactive_brokers.config import InteractiveBrokersExecClientConfig
from vibe_trader.adapters.interactive_brokers.config import (
    InteractiveBrokersInstrumentProviderConfig,
)
from vibe_trader.adapters.interactive_brokers.config import SymbologyMethod
from vibe_trader.adapters.interactive_brokers.factories import (
    InteractiveBrokersLiveDataClientFactory,
)
from vibe_trader.adapters.interactive_brokers.factories import (
    InteractiveBrokersLiveExecClientFactory,
)
from vibe_trader.config import LiveDataEngineConfig
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


instrument_provider = InteractiveBrokersInstrumentProviderConfig(
    symbology_method=SymbologyMethod.IB_SIMPLIFIED,
    load_ids=frozenset(
        [
            "EUR/USD.IDEALPRO",
            "BTC/USD.PAXOS",
            "SPY.ARCA",
            "AAPL.NASDAQ",
            "V.NYSE",
            "CLM6.NYMEX",
            "ESM6.CME",
            "^SPX.CBOE",
        ],
    ),
)

exec_clients: dict[str, LiveExecClientConfig] = {}
if ENABLE_EXECUTION_CLIENT and EXEC_ACCOUNT_ID is not None:
    exec_clients = {
        IB: InteractiveBrokersExecClientConfig(
            ibg_host=IB_HOST,
            ibg_port=IB_PORT,
            ibg_client_id=int(os.getenv("IB_EXAMPLE_EXEC_CLIENT_ID", "1202")),
            account_id=EXEC_ACCOUNT_ID,
            instrument_provider=instrument_provider,
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
        IB: InteractiveBrokersDataClientConfig(
            ibg_host=IB_HOST,
            ibg_port=IB_PORT,
            ibg_client_id=int(os.getenv("IB_EXAMPLE_DATA_CLIENT_ID", "1201")),
            handle_revised_bars=False,
            use_regular_trading_hours=True,
            market_data_type=IBMarketDataTypeEnum.DELAYED_FROZEN,  # If unset default is REALTIME
            instrument_provider=instrument_provider,
        ),
    },
    exec_clients=exec_clients,
    data_engine=LiveDataEngineConfig(
        time_bars_timestamp_on_close=False,  # Will use opening time as `ts_event` (same like IB)
        validate_data_sequence=True,  # Will make sure DataEngine discards any Bars received out of sequence
    ),
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
    # instrument_id=InstrumentId.from_str("EUR/USD.IDEALPRO"),
    instrument_id=InstrumentId.from_str("^SPX.CBOE"),
    trade_ticks=False,
    quote_ticks=False,
    bars=False,
    index_prices=True,
)
# Instantiate your strategy
strategy = SubscribeStrategy(config=strategy_config)

# Add your strategies and modules
node.trader.add_strategy(strategy)

# Register your client factories with the node (can take user-defined factories)
node.add_data_client_factory(IB, InteractiveBrokersLiveDataClientFactory)
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
