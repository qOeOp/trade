#!/usr/bin/env python3
import time
from decimal import Decimal

import pandas as pd

from vibe_trading.adapters.binance import BINANCE_VENUE
from vibe_trading.backtest.engine import BacktestEngine
from vibe_trading.config import BacktestEngineConfig
from vibe_trading.examples.strategies.ema_cross_trailing_stop import EMACrossTrailingStop
from vibe_trading.examples.strategies.ema_cross_trailing_stop import EMACrossTrailingStopConfig
from vibe_trading.model.currencies import ETH
from vibe_trading.model.currencies import USDT
from vibe_trading.model.data import BarType
from vibe_trading.model.enums import AccountType
from vibe_trading.model.enums import OmsType
from vibe_trading.model.identifiers import TraderId
from vibe_trading.model.objects import Money
from vibe_trading.persistence.wranglers import TradeTickDataWrangler
from vibe_trading.test_kit.providers import TestDataProvider
from vibe_trading.test_kit.providers import TestInstrumentProvider


if __name__ == "__main__":
    # Configure backtest engine
    config = BacktestEngineConfig(trader_id=TraderId("BACKTESTER-001"))

    # Build the backtest engine
    engine = BacktestEngine(config=config)

    # Add a trading venue (multiple venues possible)
    engine.add_venue(
        venue=BINANCE_VENUE,
        oms_type=OmsType.NETTING,
        account_type=AccountType.CASH,  # Spot CASH account (not for perpetuals or futures)
        base_currency=None,  # Multi-currency account
        starting_balances=[Money(1_000_000, USDT), Money(10, ETH)],
    )

    # Add instruments
    ETHUSDT_BINANCE = TestInstrumentProvider.ethusdt_binance()
    engine.add_instrument(ETHUSDT_BINANCE)

    # Add data
    provider = TestDataProvider()
    wrangler = TradeTickDataWrangler(instrument=ETHUSDT_BINANCE)
    ticks = wrangler.process(provider.read_csv_ticks("binance/ethusdt-trades.csv"))
    engine.add_data(ticks)

    # Configure your strategy
    strategy_config = EMACrossTrailingStopConfig(
        instrument_id=ETHUSDT_BINANCE.id,
        bar_type=BarType.from_str("ETHUSDT.BINANCE-100-TICK-LAST-INTERNAL"),
        trade_size=Decimal("0.10"),
        fast_ema_period=10,
        slow_ema_period=20,
        atr_period=20,
        trailing_atr_multiple=3.0,
        trailing_offset_type="PRICE",
        trigger_type="LAST_PRICE",
    )
    # Instantiate and add your strategy
    strategy = EMACrossTrailingStop(config=strategy_config)
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
        print(engine.trader.generate_account_report(BINANCE_VENUE))
        print(engine.trader.generate_order_fills_report())
        print(engine.trader.generate_positions_report())

    # For repeated backtest runs make sure to reset the engine
    engine.reset()

    # Good practice to dispose of the object
    engine.dispose()
