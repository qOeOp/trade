#!/usr/bin/env python3
from vibe_trader.adapters.architect_ax import AX
from vibe_trader.adapters.architect_ax import AxDataClientConfig
from vibe_trader.adapters.architect_ax import AxEnvironment
from vibe_trader.adapters.architect_ax import AxLiveDataClientFactory
from vibe_trader.config import InstrumentProviderConfig
from vibe_trader.config import LiveExecEngineConfig
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

# Configuration
symbol = "GBPUSD-PERP"
instrument_id = InstrumentId.from_str(f"{symbol}.{AX}")

# Configure the trading node
config_node = TradingNodeConfig(
    trader_id=TraderId("TESTER-001"),
    logging=LoggingConfig(
        log_level="INFO",
        use_pyo3=True,
    ),
    exec_engine=LiveExecEngineConfig(
        reconciliation=False,
    ),
    data_clients={
        AX: AxDataClientConfig(
            environment=AxEnvironment.SANDBOX,
            instrument_provider=InstrumentProviderConfig(load_all=True),
            update_instruments_interval_mins=60,
        ),
    },
    timeout_connection=20.0,
    timeout_disconnection=5.0,
    timeout_post_stop=5.0,
)

# Instantiate the node with a configuration
node = TradingNode(config=config_node)

# Configure and initialize the tester
bar_type = BarType.from_str(f"{instrument_id}-1-MINUTE-LAST-EXTERNAL")

config_tester = DataTesterConfig(
    instrument_ids=[instrument_id],
    bar_types=[bar_type],
    subscribe_quotes=True,
    subscribe_trades=True,
    subscribe_mark_prices=True,
    subscribe_bars=True,
    subscribe_funding_rates=True,
    request_trades=True,
    request_bars=True,
    request_funding_rates=True,
    log_data=True,
)

# Alternative config for testing the order book:
# config_tester = DataTesterConfig(
#     instrument_ids=[instrument_id],
#     bar_types=[bar_type],
#     subscribe_book_at_interval=True,
#     book_type=BookType.L2_MBP,
#     book_interval_ms=10,
#     log_data=True,
# )

tester = DataTester(config=config_tester)

node.trader.add_actor(tester)

# Register your client factories with the node
node.add_data_client_factory(AX, AxLiveDataClientFactory)
node.build()


# Stop and dispose of the node with SIGINT/CTRL+C
if __name__ == "__main__":
    try:
        node.run()
    finally:
        node.dispose()
