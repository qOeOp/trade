#!/usr/bin/env python3
from decimal import Decimal

from vibe_trader.adapters.bybit import BYBIT
from vibe_trader.adapters.bybit import BybitDataClientConfig
from vibe_trader.adapters.bybit import BybitEnvironment
from vibe_trader.adapters.bybit import BybitExecClientConfig
from vibe_trader.adapters.bybit import BybitLiveDataClientFactory
from vibe_trader.adapters.bybit import BybitLiveExecClientFactory
from vibe_trader.adapters.bybit import BybitProductType
from vibe_trader.config import InstrumentProviderConfig
from vibe_trader.config import LiveExecEngineConfig
from vibe_trader.config import LoggingConfig
from vibe_trader.config import TradingNodeConfig
from vibe_trader.examples.strategies.ema_cross_trailing_stop import EMACrossTrailingStop
from vibe_trader.examples.strategies.ema_cross_trailing_stop import EMACrossTrailingStopConfig
from vibe_trader.live.node import TradingNode
from vibe_trader.model.data import BarType
from vibe_trader.model.identifiers import InstrumentId
from vibe_trader.model.identifiers import TraderId


# *** THIS IS A TEST STRATEGY WITH NO ALPHA ADVANTAGE WHATSOEVER. ***
# *** IT IS NOT INTENDED TO BE USED TO TRADE LIVE WITH REAL MONEY. ***

# SPOT/LINEAR
product_type = BybitProductType.LINEAR
symbol = f"ETHUSDT-{product_type.value.upper()}"
trade_size = Decimal("0.010")

# INVERSE
# product_type = BybitProductType.INVERSE
# symbol = f"XRPUSD-{product_type.value.upper()}"  # Use for inverse
# trade_size = Decimal("100")  # Use for inverse

# Configure the trading node
config_node = TradingNodeConfig(
    trader_id=TraderId("TESTER-001"),
    logging=LoggingConfig(log_level="INFO", use_pyo3=True),
    exec_engine=LiveExecEngineConfig(
        reconciliation=True,
        reconciliation_lookback_mins=1440,
    ),
    data_clients={
        BYBIT: BybitDataClientConfig(
            environment=BybitEnvironment.MAINNET,
            instrument_provider=InstrumentProviderConfig(load_all=True),
            product_types=(product_type,),
        ),
    },
    exec_clients={
        BYBIT: BybitExecClientConfig(
            environment=BybitEnvironment.MAINNET,
            instrument_provider=InstrumentProviderConfig(load_all=True),
            product_types=(product_type,),
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
strat_config = EMACrossTrailingStopConfig(
    instrument_id=InstrumentId.from_str(f"{symbol}.BYBIT"),
    external_order_claims=[InstrumentId.from_str(f"{symbol}.BYBIT")],
    bar_type=BarType.from_str(f"{symbol}.BYBIT-1-MINUTE-LAST-EXTERNAL"),
    fast_ema_period=10,
    slow_ema_period=20,
    atr_period=20,
    trailing_atr_multiple=3.0,
    trailing_offset_type="BASIS_POINTS",
    trigger_type="LAST_PRICE",
    trade_size=trade_size,
)
# Instantiate your strategy
strategy = EMACrossTrailingStop(config=strat_config)

# Add your strategies and modules
node.trader.add_strategy(strategy)

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
