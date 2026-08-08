#!/usr/bin/env python3
import time
from decimal import Decimal
from pathlib import Path

import pandas as pd

from vibe_trader.adapters.databento import DatabentoDataLoader
from vibe_trader.backtest.engine import BacktestEngine
from vibe_trader.config import BacktestEngineConfig
from vibe_trader.config import LoggingConfig
from vibe_trader.examples.strategies.ema_cross_long_only import EMACrossLongOnly
from vibe_trader.examples.strategies.ema_cross_long_only import EMACrossLongOnlyConfig
from vibe_trader.model.currencies import USD
from vibe_trader.model.data import BarType
from vibe_trader.model.enums import AccountType
from vibe_trader.model.enums import OmsType
from vibe_trader.model.identifiers import TraderId
from vibe_trader.model.identifiers import Venue
from vibe_trader.model.objects import Money
from vibe_trader.test_kit.providers import TestInstrumentProvider


TEST_DATA_DIR = Path(__file__).resolve().parents[2] / "test_data"


if __name__ == "__main__":
    # Configure backtest engine
    config = BacktestEngineConfig(
        trader_id=TraderId("BACKTESTER-001"),
        logging=LoggingConfig(log_level="INFO"),
    )

    # Build the backtest engine
    engine = BacktestEngine(config=config)

    # Add a trading venue (multiple venues possible)
    NASDAQ = Venue("XNAS")
    engine.add_venue(
        venue=NASDAQ,
        oms_type=OmsType.NETTING,
        account_type=AccountType.CASH,
        base_currency=USD,
        starting_balances=[Money(1_000_000.0, USD)],
    )

    # Add instruments
    SPY_XNAS = TestInstrumentProvider.equity(symbol="SPY", venue="XNAS")
    engine.add_instrument(SPY_XNAS)

    # Add data
    loader = DatabentoDataLoader()

    filenames = [
        "spy-xnas-trades-2024-01.dbn.zst",
        "spy-xnas-trades-2024-02.dbn.zst",
        "spy-xnas-trades-2024-03.dbn.zst",
    ]

    for filename in filenames:
        trades = loader.from_dbn_file(
            path=TEST_DATA_DIR / "databento" / "temp" / filename,
            instrument_id=SPY_XNAS.id,
        )
        engine.add_data(trades)

    # Configure your strategy
    strategy_config = EMACrossLongOnlyConfig(
        instrument_id=SPY_XNAS.id,
        bar_type=BarType.from_str(f"{SPY_XNAS.id}-1000-TICK-LAST-INTERNAL"),
        trade_size=Decimal(100),
        fast_ema_period=10,
        slow_ema_period=20,
        request_historical_bars=False,  # Using internally aggregated tick bars
    )

    # Instantiate and add your strategy
    strategy = EMACrossLongOnly(config=strategy_config)
    engine.add_strategy(strategy=strategy)

    time.sleep(0.1)
    input("Press Enter to continue...")

    # Run the engine (from start to end of data)
    engine.run()

    # Optionally view reports
    with pd.option_context(
        "display.max_rows",
        100,
        "display.max_columns",
        None,
        "display.width",
        300,
    ):
        print(engine.trader.generate_account_report(NASDAQ))
        print(engine.trader.generate_order_fills_report())
        print(engine.trader.generate_positions_report())

    # For repeated backtest runs make sure to reset the engine
    engine.reset()

    # Good practice to dispose of the object
    engine.dispose()
