#!/usr/bin/env python3
from decimal import Decimal

from strategy import SimpleTimerStrategy

from examples.utils.data_provider import prepare_demo_data_eurusd_futures_1min
from vibe_trader.backtest.engine import BacktestEngine
from vibe_trader.config import BacktestEngineConfig
from vibe_trader.config import LoggingConfig
from vibe_trader.model import Bar
from vibe_trader.model import BarType
from vibe_trader.model import TraderId
from vibe_trader.model.currencies import USD
from vibe_trader.model.enums import AccountType
from vibe_trader.model.enums import OmsType
from vibe_trader.model.identifiers import Venue
from vibe_trader.model.instruments.base import Instrument
from vibe_trader.model.objects import Money


if __name__ == "__main__":
    """
    This example demonstrates how to use timer functionality in a trading strategy.

    The strategy sets up a timer that triggers every 3 minutes and processes bar data.
    This is useful for implementing periodic actions in your trading strategies.

    """

    # ----------------------------------------------------------------------------------
    # 1. Configure and create backtest engine
    # ----------------------------------------------------------------------------------

    engine_config = BacktestEngineConfig(
        trader_id=TraderId("BACKTEST-TIMER-001"),  # Unique identifier for this backtest
        logging=LoggingConfig(
            log_level="DEBUG",  # Set to DEBUG to see detailed timer and bar processing logs
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
    eurusd_1min_bars: list[Bar] = prepared_data["bars_list"]

    # ----------------------------------------------------------------------------------
    # 3. Configure trading environment
    # ----------------------------------------------------------------------------------

    # Set up the trading venue with a margin account
    engine.add_venue(
        venue=Venue(venue_name),
        oms_type=OmsType.NETTING,  # Use a netting order management system
        account_type=AccountType.MARGIN,  # Use a margin trading account
        starting_balances=[Money(1_000_000, USD)],  # Set initial capital
        base_currency=USD,  # Account currency
        default_leverage=Decimal(1),  # No leverage (1:1)
    )

    # Register the trading instrument
    engine.add_instrument(eurusd_instrument)

    # Load historical market data
    engine.add_data(eurusd_1min_bars)

    # ----------------------------------------------------------------------------------
    # 4. Configure and run strategy
    # ----------------------------------------------------------------------------------

    # Create and register the timer strategy
    strategy = SimpleTimerStrategy(primary_bar_type=eurusd_1min_bartype)
    engine.add_strategy(strategy)

    # Execute the backtest
    engine.run()

    # Clean up resources
    engine.dispose()
