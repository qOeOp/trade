#!/usr/bin/env python3
from vibe_trader.adapters.bitmex import BITMEX
from vibe_trader.adapters.bitmex import BitmexDataClientConfig
from vibe_trader.adapters.bitmex import BitmexEnvironment
from vibe_trader.adapters.bitmex import BitmexLiveDataClientFactory
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

# Example symbols for different BitMEX products
# Perpetual swap: XBTUSD (Bitcoin perpetual)
# Futures: XBTH25 (Bitcoin futures expiring March 2025)
# Alt perpetuals: ETHUSD, SOLUSD, etc.

testnet = False  # If client uses the testnet API
symbol = "XBTUSD"  # Bitcoin perpetual swap
# symbol = "SOLUSDT"  # Solana spot
# symbol = "ETHUSDT"  # Ethereum spot
# symbol = ".BXBT"  # Bitcoin index

# Configure the trading node
config_node = TradingNodeConfig(
    trader_id=TraderId("TESTER-001"),
    logging=LoggingConfig(log_level="INFO", use_pyo3=True),
    exec_engine=LiveExecEngineConfig(
        reconciliation=False,  # Not applicable
    ),
    data_clients={
        BITMEX: BitmexDataClientConfig(
            environment=BitmexEnvironment.TESTNET if testnet else BitmexEnvironment.MAINNET,
            instrument_provider=InstrumentProviderConfig(load_all=True),
        ),
    },
    timeout_connection=10.0,
    timeout_reconciliation=10.0,
    timeout_disconnection=2.0,
    timeout_post_stop=1.0,
)

# Configure the data tester actor
config_tester = DataTesterConfig(
    instrument_ids=[InstrumentId.from_str(f"{symbol}.{BITMEX}")],
    bar_types=[BarType.from_str(f"{symbol}.{BITMEX}-1-MINUTE-LAST-EXTERNAL")],
    subscribe_instrument=True,
    subscribe_instrument_status=True,
    # subscribe_quotes=True,
    # subscribe_trades=True,
    # subscribe_mark_prices=True,
    # subscribe_index_prices=True,
    # subscribe_funding_rates=True,
    # subscribe_bars=True,
    # subscribe_book_deltas=True,
    # subscribe_book_depth=True,
    subscribe_book_at_interval=True,
    book_depth=25,
    book_interval_ms=10,
    # request_trades=True,
    # request_bars=True,
)

# Setup and run the trading node
node = TradingNode(config=config_node)

# Add the strategy to the node
node.trader.add_actor(DataTester(config=config_tester))

# Register the data client factory
node.add_data_client_factory(BITMEX, BitmexLiveDataClientFactory)
node.build()

# Run the node
try:
    node.run()
except KeyboardInterrupt:
    node.stop()
finally:
    node.dispose()
