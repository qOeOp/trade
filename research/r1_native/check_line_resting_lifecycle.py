"""
Check H08b limit fill, protection, and one-bar expiry in native Nautilus.
"""

from __future__ import annotations

import argparse
import json
from decimal import Decimal
from pathlib import Path

from trendline_strategy import LineCandle
from trendline_strategy import LineRestingPlan
from trendline_strategy import TrendlineBreakStrategy

from vibe_trading.backtest import BacktestEngine
from vibe_trading.backtest import BacktestEngineConfig
from vibe_trading.common import LoggerConfig
from vibe_trading.common import LogLevel
from vibe_trading.data import DataEngineConfig
from vibe_trading.model import AccountType
from vibe_trading.model import Bar
from vibe_trading.model import BarType
from vibe_trading.model import InstrumentId
from vibe_trading.model import MarkPriceUpdate
from vibe_trading.model import Money
from vibe_trading.model import OmsType
from vibe_trading.model import Quantity
from vibe_trading.model import StrategyId
from vibe_trading.model import TraderId
from vibe_trading.model import Venue
from vibe_trading.persistence import ParquetDataCatalog


class FixtureStrategy(TrendlineBreakStrategy):
    def on_bar(self, bar: Bar) -> None:
        if bar.bar_type == self.four_hour_bar_type:
            return
        if bar.bar_type == self.minute_bar_type and not getattr(self, "fixture_submitted", False):
            self.fixture_submitted = True
            self.line_state.candles.append(
                LineCandle(bar.ts_event, 85_500, 85_600, 85_400, 85_500),
            )
            self._submit_line_resting(
                LineRestingPlan(bar.ts_event, 85_300, 85_100, 85_700, (10, 30)),
            )
        super().on_bar(bar)


def _scenario(instrument, scenario: str) -> dict:
    instrument_id = instrument.id
    engine = BacktestEngine(
        BacktestEngineConfig(
            trader_id=TraderId("H08B-CHECK-001"),
            logging=LoggerConfig(stdout_level=LogLevel.ERROR, print_config=False),
            data_engine=DataEngineConfig(validate_data_sequence=True),
        ),
    )
    try:
        engine.add_venue(
            Venue("BINANCE"),
            OmsType.NETTING,
            AccountType.MARGIN,
            base_currency=instrument.quote_currency,
            starting_balances=[Money(100_000, instrument.quote_currency)],
            default_leverage=Decimal(1),
            support_gtd_orders=True,
            support_contingent_orders=True,
            reject_stop_orders=False,
            bar_execution=True,
            bar_adaptive_high_low_ordering=False,
        )
        engine.add_instrument(instrument)
        strategy = FixtureStrategy(
            instrument_id,
            BarType.from_str(f"{instrument_id}-1-DAY-LAST-INTERNAL"),
            Quantity.from_str("0.003"),
            execution_bar_minutes=5,
            strategy_id=StrategyId("H08B-CHECK"),
            signal_variant="line-resting-4h",
        )
        engine.add_strategy(strategy)
        bar_type = BarType.from_str(f"{instrument_id}-5-MINUTE-LAST-EXTERNAL")
        start = 1_790_000_099_999_000_000
        prices = [(85_500, 85_600, 85_400, 85_500)] * 50
        if scenario == "fill_and_target":
            prices[1] = (85_500, 85_550, 85_250, 85_320)
            prices[2] = (85_320, 85_750, 85_300, 85_710)
            prices[3:] = [(85_710, 85_760, 85_690, 85_730)] * 47
        elif scenario == "same_bar_stop":
            prices[1] = (85_500, 85_550, 85_000, 85_100)
            prices[2:] = [(85_100, 85_150, 85_050, 85_100)] * 48
        times = [start + i * 300_000_000_000 for i in range(len(prices))]
        engine.add_data(
            [
                MarkPriceUpdate(
                    instrument_id,
                    instrument.make_price(row[3]),
                    times[i],
                    times[i],
                )
                for i, row in enumerate(prices)
            ],
        )
        engine.add_data(
            [
                Bar(
                    bar_type,
                    *(instrument.make_price(value) for value in row),
                    instrument.make_qty(100),
                    times[i],
                    times[i],
                )
                for i, row in enumerate(prices)
            ],
        )
        engine.run()
        orders = engine.generate_orders_report()
        fills = engine.generate_fills_report()
        positions = engine.generate_positions_report()
        result = {
            "scenario": scenario,
            "orders": [
                {
                    "type": str(row.type),
                    "status": str(row.status),
                    "quantity": str(row.quantity),
                }
                for row in orders.itertuples()
            ],
            "fills": len(fills),
            "closed_positions": int(positions.ts_closed.notna().sum()) if len(positions) else 0,
            "resting_entry_live_after_run": strategy.resting_entry_id is not None,
            "slot_violations": strategy.slot_violations,
        }
        return result
    finally:
        engine.dispose()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    instrument_id = InstrumentId.from_str("BTCUSDT-PERP.BINANCE")
    instrument = ParquetDataCatalog(str(args.catalog)).instruments(
        instrument_ids=[str(instrument_id)],
    )[0]
    results = [
        _scenario(instrument, "fill_and_target"),
        _scenario(instrument, "unfilled_expiry"),
        _scenario(instrument, "same_bar_stop"),
    ]
    filled, expired, stopped = results
    assert [row["type"] for row in filled["orders"]] == ["LIMIT", "STOP_MARKET", "LIMIT"]
    assert [row["status"] for row in filled["orders"]] == ["FILLED", "CANCELED", "FILLED"]
    assert filled["fills"] == 2
    assert filled["closed_positions"] == 1
    assert expired["orders"][0]["status"] == "EXPIRED"
    assert [row["status"] for row in expired["orders"][1:]] == ["CANCELED", "CANCELED"]
    assert expired["fills"] == 0
    assert expired["closed_positions"] == 0
    assert [row["status"] for row in stopped["orders"]] == ["FILLED", "FILLED", "CANCELED"]
    assert stopped["fills"] == 2
    assert stopped["closed_positions"] == 1
    assert all(
        not row["resting_entry_live_after_run"] and row["slot_violations"] == 0 for row in results
    )
    args.output.write_text(
        json.dumps({"scope": "native synthetic H08b lifecycle", "results": results}, indent=2)
        + "\n",
    )


if __name__ == "__main__":
    main()
