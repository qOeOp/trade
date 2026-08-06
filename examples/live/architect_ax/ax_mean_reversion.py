#!/usr/bin/env python3
from decimal import Decimal

from vibe_trader.adapters.architect_ax import AX
from vibe_trader.adapters.architect_ax import AxDataClientConfig
from vibe_trader.adapters.architect_ax import AxEnvironment
from vibe_trader.adapters.architect_ax import AxExecClientConfig
from vibe_trader.adapters.architect_ax import AxLiveDataClientFactory
from vibe_trader.adapters.architect_ax import AxLiveExecClientFactory
from vibe_trader.config import InstrumentProviderConfig
from vibe_trader.config import LiveExecEngineConfig
from vibe_trader.config import LiveRiskEngineConfig
from vibe_trader.config import LoggingConfig
from vibe_trader.config import TradingNodeConfig
from vibe_trader.examples.strategies.bb_mean_reversion import BBMeanReversion
from vibe_trader.examples.strategies.bb_mean_reversion import BBMeanReversionConfig
from vibe_trader.live.node import TradingNode
from vibe_trader.model.data import BarType
from vibe_trader.model.identifiers import InstrumentId
from vibe_trader.model.identifiers import TraderId


# *** THIS IS A TEST STRATEGY WITH NO ALPHA ADVANTAGE WHATSOEVER. ***
# *** IT IS NOT INTENDED TO BE USED TO TRADE LIVE WITH REAL MONEY. ***

instrument_id = InstrumentId.from_str(f"EURUSD-PERP.{AX}")

config_node = TradingNodeConfig(
    trader_id=TraderId("TESTER-001"),
    logging=LoggingConfig(
        log_level="INFO",
        use_pyo3=True,
    ),
    exec_engine=LiveExecEngineConfig(
        reconciliation=True,
        reconciliation_instrument_ids=[instrument_id],
    ),
    risk_engine=LiveRiskEngineConfig(bypass=True),
    data_clients={
        AX: AxDataClientConfig(
            environment=AxEnvironment.SANDBOX,
            instrument_provider=InstrumentProviderConfig(
                load_all=False,
                load_ids=frozenset([instrument_id]),
            ),
        ),
    },
    exec_clients={
        AX: AxExecClientConfig(
            environment=AxEnvironment.SANDBOX,
            instrument_provider=InstrumentProviderConfig(
                load_all=False,
                load_ids=frozenset([instrument_id]),
            ),
        ),
    },
    timeout_connection=20.0,
    timeout_reconciliation=10.0,
    timeout_portfolio=10.0,
    timeout_disconnection=10.0,
    timeout_post_stop=5.0,
)

node = TradingNode(config=config_node)

bar_type = BarType.from_str(f"{instrument_id}-1-MINUTE-MID-INTERNAL")

strategy = BBMeanReversion(
    config=BBMeanReversionConfig(
        instrument_id=instrument_id,
        bar_type=bar_type,
        trade_size=Decimal(1),
        bb_period=20,
        bb_std=2.0,
        rsi_period=14,
        rsi_buy_threshold=0.30,
        rsi_sell_threshold=0.70,
    ),
)

node.trader.add_strategy(strategy)

node.add_data_client_factory(AX, AxLiveDataClientFactory)
node.add_exec_client_factory(AX, AxLiveExecClientFactory)
node.build()

if __name__ == "__main__":
    try:
        node.run()
    finally:
        node.dispose()
