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
    NYSE = Venue("NYSE")
    engine.add_venue(
        venue=NYSE,
        oms_type=OmsType.NETTING,
        account_type=AccountType.CASH,
        base_currency=USD,
        starting_balances=[Money(1_000_000.0, USD)],
    )

    # Add instruments
    TSLA_NYSE = TestInstrumentProvider.equity(symbol="TSLA", venue="NYSE")
    engine.add_instrument(TSLA_NYSE)

    # Add data
    loader = DatabentoDataLoader()

    filenames = [
        "tsla-dbeq-basic-trades-2024-01.dbn.zst",
        "tsla-dbeq-basic-trades-2024-02.dbn.zst",
        "tsla-dbeq-basic-trades-2024-03.dbn.zst",
    ]

    for filename in filenames:
        trades = loader.from_dbn_file(
            path=TEST_DATA_DIR / "databento" / "temp" / filename,
            instrument_id=TSLA_NYSE.id,
        )
        engine.add_data(trades)

    # Configure your strategy
    strategy_config = EMACrossLongOnlyConfig(
        instrument_id=TSLA_NYSE.id,
        bar_type=BarType.from_str(f"{TSLA_NYSE.id}-1-MINUTE-LAST-INTERNAL"),
        trade_size=Decimal(1000),
        fast_ema_period=10,
        slow_ema_period=20,
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
        print(engine.trader.generate_account_report(NYSE))
        print(engine.trader.generate_order_fills_report())
        print(engine.trader.generate_positions_report())

    # For repeated backtest runs make sure to reset the engine
    engine.reset()

    # Good practice to dispose of the object
    engine.dispose()
