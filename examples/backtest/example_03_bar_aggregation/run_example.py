#!/usr/bin/env python3
from decimal import Decimal

from strategy import DemoStrategy

from examples.utils.data_provider import prepare_demo_data_eurusd_futures_1min
from vibe_trading.backtest.engine import BacktestEngine
from vibe_trading.config import BacktestEngineConfig
from vibe_trading.config import LoggingConfig
from vibe_trading.model import Bar
from vibe_trading.model import BarType
from vibe_trading.model import TraderId
from vibe_trading.model.currencies import USD
from vibe_trading.model.enums import AccountType
from vibe_trading.model.enums import OmsType
from vibe_trading.model.identifiers import Venue
from vibe_trading.model.instruments.base import Instrument
from vibe_trading.model.objects import Money


if __name__ == "__main__":
    # ----------------------------------------------------------------------------------
    # 1. Configure and create backtest engine
    # ----------------------------------------------------------------------------------

    engine_config = BacktestEngineConfig(
        trader_id=TraderId("BACKTEST_TRADER-001"),
        logging=LoggingConfig(
            log_level="DEBUG",  # set DEBUG log level for console to see loaded bars in logs
        ),
    )
    engine = BacktestEngine(config=engine_config)

    # ----------------------------------------------------------------------------------
    # 2. Prepare market data
    # ----------------------------------------------------------------------------------

    prepared_data: dict = prepare_demo_data_eurusd_futures_1min()
    venue_name: str = prepared_data["venue_name"]
    eurusd_instrument: Instrument = prepared_data["instrument"]
    eurusd_1min_bartype: BarType = prepared_data["bar_type"]
    eurusd_1min_bars_list: list[Bar] = prepared_data["bars_list"]

    # ----------------------------------------------------------------------------------
    # 3. Configure trading environment
    # ----------------------------------------------------------------------------------

    # Set up the trading venue with a margin account
    engine.add_venue(
        venue=Venue(venue_name),
        oms_type=OmsType.NETTING,  # Order Management System type
        account_type=AccountType.MARGIN,  # Type of trading account
        starting_balances=[Money(1_000_000, USD)],  # Initial account balance
        base_currency=USD,  # Base currency for account
        default_leverage=Decimal(1),  # No leverage used for account
    )

    # Add instrument and market data to the engine
    engine.add_instrument(eurusd_instrument)
    engine.add_data(eurusd_1min_bars_list)

    # ----------------------------------------------------------------------------------
    # 4. Configure and run strategy
    # ----------------------------------------------------------------------------------

    # Create and register the bar aggregation strategy
    strategy = DemoStrategy(bar_type_1min=eurusd_1min_bartype)
    engine.add_strategy(strategy)

    # Execute the backtest
    engine.run()

    # Clean up resources
    engine.dispose()
