#!/usr/bin/env python3
from vibe_trader.adapters.bybit import BYBIT
from vibe_trader.adapters.bybit import BybitDataClientConfig
from vibe_trader.adapters.bybit import BybitEnvironment
from vibe_trader.adapters.bybit import BybitLiveDataClientFactory
from vibe_trader.adapters.bybit import BybitLiveExecClientFactory
from vibe_trader.adapters.bybit import BybitProductType
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

# SPOT/LINEAR
product_type = BybitProductType.LINEAR
symbol = f"ETHUSDT-{product_type.value.upper()}"
instrument_id = InstrumentId.from_str(f"{symbol}.{BYBIT}")

# INVERSE
# product_type = BybitProductType.INVERSE
# symbol = f"XRPUSD-{product_type.value.upper()}"  # Use for inverse
# trade_size = Decimal("100")  # Use for inverse

# Configure the trading node
config_node = TradingNodeConfig(
    trader_id=TraderId("TESTER-001"),
    logging=LoggingConfig(
        log_level="INFO",
        # log_level_file="DEBUG",
        # log_file_max_size=1_000_000_000,
        use_pyo3=True,
    ),
    data_clients={
        BYBIT: BybitDataClientConfig(
            environment=BybitEnvironment.MAINNET,
            instrument_provider=InstrumentProviderConfig(load_all=True),
            product_types=(product_type,),
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

# Configure your strategy
config_tester = DataTesterConfig(
    instrument_ids=[instrument_id],
    bar_types=[BarType.from_str(f"{instrument_id}-1-MINUTE-LAST-EXTERNAL")],
    subscribe_instrument=True,
    # subscribe_book_at_interval=True,
    subscribe_quotes=True,
    subscribe_trades=True,
    subscribe_mark_prices=True,
    subscribe_index_prices=True,
    subscribe_funding_rates=True,
    subscribe_bars=True,
    # book_interval_ms=1,
    # request_bars=True,
)

# Instantiate your actor
tester = DataTester(config=config_tester)

# Add your actors and modules
node.trader.add_actor(tester)

# Register your client factories with the node (can take user-defined factories)
node.add_data_client_factory(BYBIT, BybitLiveDataClientFactory)
node.add_exec_client_factory(BYBIT, BybitLiveExecClientFactory)
node.build()


# Stop and dispose of the node with SIGINT/CTRL+C
if __name__ == "__main__":
    try:
        node.run()
    finally:
        node.dispose()
