"""
Check native line Strategy market entry and bracket on synthetic prices.
"""

from __future__ import annotations

import argparse
import json
from decimal import Decimal
from pathlib import Path

from trendline_strategy import LineBreak
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
        if bar.bar_type == self.minute_bar_type and not getattr(self, "fixture_submitted", False):
            self.fixture_submitted = True
            self._submit_line_break(
                LineBreak(bar.ts_event, 1, 85_300, 85_100, 85_700, (10, 30)),
            )
        super().on_bar(bar)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--catalog", type=Path, required=True)
    parser.add_argument(
        "--signal-variant",
        choices=("trendline-4h", "line-support-4h"),
        default="trendline-4h",
    )
    args = parser.parse_args()
    instrument_id = InstrumentId.from_str("BTCUSDT-PERP.BINANCE")
    instrument = ParquetDataCatalog(str(args.catalog)).instruments(
        instrument_ids=[str(instrument_id)],
    )[0]
    engine = BacktestEngine(
        BacktestEngineConfig(
            trader_id=TraderId("H06-CHECK-001"),
            logging=LoggerConfig(stdout_level=LogLevel.ERROR, print_config=False),
            data_engine=DataEngineConfig(
                time_bars_timestamp_on_close=True,
                time_bars_skip_first_non_full_bar=False,
                validate_data_sequence=True,
            ),
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
            support_contingent_orders=True,
            bar_execution=True,
            bar_adaptive_high_low_ordering=False,
        )
        engine.add_instrument(instrument)
        strategy = FixtureStrategy(
            instrument_id,
            BarType.from_str(f"{instrument_id}-1-DAY-LAST-INTERNAL"),
            Quantity.from_str("0.003"),
            execution_bar_minutes=5,
            strategy_id=StrategyId(
                "H08-CHECK" if args.signal_variant == "line-support-4h" else "H06-CHECK",
            ),
            signal_variant=args.signal_variant,
        )
        engine.add_strategy(strategy)
        bar_type = BarType.from_str(f"{instrument_id}-5-MINUTE-LAST-EXTERNAL")
        prices = [
            (85_290, 85_320, 85_250, 85_300),
            (85_310, 85_350, 85_240, 85_320),
            (85_320, 85_750, 85_300, 85_710),
            (85_710, 85_760, 85_690, 85_730),
        ]
        start = 1_790_000_099_999_000_000
        timestamps = [start + i * 300_000_000_000 for i in range(len(prices))]
        engine.add_data(
            [
                MarkPriceUpdate(
                    instrument_id,
                    instrument.make_price(row[3]),
                    timestamps[i],
                    timestamps[i],
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
                    timestamps[i],
                    timestamps[i],
                )
                for i, row in enumerate(prices)
            ],
        )
        engine.run()
        orders = engine.generate_orders_report()
        fills = engine.generate_fills_report()
        positions = engine.generate_positions_report()
        result = {
            "orders": [
                {
                    "type": str(row.type),
                    "status": str(row.status),
                    "quantity": str(row.quantity),
                }
                for row in orders.itertuples()
            ],
            "fills": len(fills),
            "closed_positions": int(positions.ts_closed.notna().sum()),
        }
        print(json.dumps(result, indent=2))
        assert len(orders) == 3, result
        assert [str(x) for x in orders["status"]] == ["FILLED", "CANCELED", "FILLED"], result
        assert str(orders.iloc[0]["type"]) == "MARKET", result
        assert str(orders.iloc[1]["type"]) == "STOP_MARKET", result
        assert str(orders.iloc[2]["type"]) == "LIMIT", result
        assert len(fills) == 2, result
        assert result["closed_positions"] == 1, result
    finally:
        engine.dispose()


if __name__ == "__main__":
    main()
