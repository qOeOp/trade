#!/usr/bin/env python3
from datetime import timedelta

from vibe_trader.adapters.bybit import BYBIT
from vibe_trader.adapters.bybit import BYBIT_CLIENT_ID
from vibe_trader.adapters.bybit import BybitDataClientConfig
from vibe_trader.adapters.bybit import BybitEnvironment
from vibe_trader.adapters.bybit import BybitExecClientConfig
from vibe_trader.adapters.bybit import BybitLiveDataClientFactory
from vibe_trader.adapters.bybit import BybitLiveExecClientFactory
from vibe_trader.adapters.bybit import BybitProductType
from vibe_trader.adapters.bybit import BybitTickerData
from vibe_trader.common.events import TimeEvent
from vibe_trader.config import InstrumentProviderConfig
from vibe_trader.config import LiveExecEngineConfig
from vibe_trader.config import LoggingConfig
from vibe_trader.config import StrategyConfig
from vibe_trader.config import TradingNodeConfig
from vibe_trader.core.data import Data
from vibe_trader.live.node import TradingNode
from vibe_trader.model.data import DataType
from vibe_trader.model.identifiers import InstrumentId
from vibe_trader.trading import Strategy


# *** THIS IS A TEST STRATEGY WITH NO ALPHA ADVANTAGE WHATSOEVER. ***
# *** IT IS NOT INTENDED TO BE USED TO TRADE LIVE WITH REAL MONEY. ***


class RequestDemoStrategyConfig(StrategyConfig, frozen=True):
    instrument_id: InstrumentId
    interval: int


class RequestDemoStrategy(Strategy):
    """
    Strategy showcases how to request custom data from bybit adapter. BybitTickerData is
    specific to Bybit adapter and you can request it with `request_data` method.

    Also this strategy demonstrate:
    - how to request BybitTickerData
    - how to use clock to schedule this request periodically by time interval in seconds.

    """

    def __init__(self, config: RequestDemoStrategyConfig):
        super().__init__()

    def on_start(self):
        seconds_delta = timedelta(seconds=self.config.interval)
        self.clock.set_timer(
            name="fetch_ticker",
            interval=seconds_delta,
            callback=self.send_tickers_request,
        )

    def send_tickers_request(self, time_event: TimeEvent) -> None:
        data_type = DataType(
            BybitTickerData,
            metadata={"symbol": self.config.instrument_id.symbol},
        )
        self.request_data(data_type, BYBIT_CLIENT_ID)

    def on_historical_data(self, data: Data) -> None:
        if isinstance(data, BybitTickerData):
            self.log.info(f"{data}")


config_node = TradingNodeConfig(
    trader_id="TESTER-001",
    logging=LoggingConfig(log_level="INFO"),
    exec_engine=LiveExecEngineConfig(
        reconciliation=True,
        reconciliation_lookback_mins=1440,
    ),
    data_clients={
        BYBIT: BybitDataClientConfig(
            product_types=(BybitProductType.LINEAR,),
            environment=BybitEnvironment.TESTNET,
            instrument_provider=InstrumentProviderConfig(load_all=True),
        ),
    },
    exec_clients={
        BYBIT: BybitExecClientConfig(
            product_types=(BybitProductType.LINEAR,),
            environment=BybitEnvironment.TESTNET,
            instrument_provider=InstrumentProviderConfig(load_all=True),
        ),
    },
    timeout_connection=20.0,
    timeout_reconciliation=10.0,
    timeout_portfolio=10.0,
    timeout_disconnection=10.0,
    timeout_post_stop=5.0,
)

node = TradingNode(config=config_node)

instrument_id = InstrumentId.from_str("ETHUSDT-LINEAR.BYBIT")
strategy_config = RequestDemoStrategyConfig(
    instrument_id=instrument_id,
    interval=10,
)
strategy_config = RequestDemoStrategy(config=strategy_config)

node.trader.add_strategy(strategy_config)
node.add_data_client_factory(BYBIT, BybitLiveDataClientFactory)
node.add_exec_client_factory(BYBIT, BybitLiveExecClientFactory)
node.build()

if __name__ == "__main__":
    try:
        node.run()
    finally:
        node.dispose()
