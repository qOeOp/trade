"""What Paper's and Live's native nodes share: the replay's data engine, the warm-up Catalog and the Binance USD-M
public data client. Each side adds its own cache, execution client, risk engine and actors."""
from __future__ import annotations

from pathlib import Path

from nautilus_trader.adapters.binance import (
    BinanceDataClientConfig, BinanceDataClientFactory, BinanceEnvironment, BinanceInstrumentProviderConfig,
    BinanceProductType,
)
from nautilus_trader.common import Environment, LoggerConfig, LogLevel
from nautilus_trader.live import LiveDataEngineConfig, LiveNode, LiveNodeConfig
from nautilus_trader.model import TraderId
from nautilus_trader.persistence import DataCatalogConfig

from engine import history
from engine.config import ACCOUNT_CONTRACT


def node_base(name: str, trader_id: str, environment: Environment, catalog: Path | None, instrument_ids: list[str],
              proxy_url: str | None):
    """A LiveNode builder with the data engine a replay builds (ACCOUNT_CONTRACT), the run's Catalog when given (the
    warm-ups are requested from it, which they fill at T: engine.history), warnings-only logging and the public data
    client of `instrument_ids`, reached through `proxy_url`."""
    account = ACCOUNT_CONTRACT
    data = LiveDataEngineConfig(
        time_bars_timestamp_on_close=account["time_bars_timestamp_on_close"],
        time_bars_skip_first_non_full_bar=account["time_bars_skip_first_non_full_bar"],
        validate_data_sequence=account["validate_data_sequence"], time_bars_build_delay=history.BUILD_DELAY_US)
    builder = LiveNode.builder(name, TraderId(trader_id), environment)
    if catalog is not None:
        builder = builder.from_config(name, LiveNodeConfig(environment=environment, trader_id=TraderId(trader_id),
                                                           data_engine=data,
                                                           catalogs=[DataCatalogConfig(path=str(catalog))]))
    builder.with_logging(LoggerConfig(stdout_level=LogLevel.WARNING, print_config=False))
    builder.with_data_engine_config(data)
    builder.add_data_client(account["venue"], BinanceDataClientFactory(), BinanceDataClientConfig(
        product_type=BinanceProductType.USD_M, environment=BinanceEnvironment.LIVE, proxy_url=proxy_url,
        instrument_provider=BinanceInstrumentProviderConfig(load_all=False, load_ids=instrument_ids)))
    return builder
