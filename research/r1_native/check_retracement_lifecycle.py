"""
Check H13c native entry replacement and fill-before-cancel protection.
"""

from __future__ import annotations

import argparse
import json
from decimal import Decimal
from pathlib import Path

from retracement_strategy import RetracementPlan
from retracement_strategy import RetracementStrategy
from strategy import FourHour
from strategy import WaitingSignal

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


class ReplacementFixture:
    last_readout = None

    def on_closed(self, candle, prior_atr):
        self.last_readout = {"impulse": {"a_index": 3, "b_index": 4}}
        return RetracementPlan(
            candle.ts_event,
            3,
            4,
            85_000,
            86_000,
            85_500,
            85_400,
            85_236,
            85_100,
            86_000,
            (0, 1),
        )


class FixtureStrategy(RetracementStrategy):
    def on_bar(self, bar: Bar) -> None:
        if bar.bar_type != self.minute_bar_type:
            return
        if not getattr(self, "fixture_started", False):
            self.fixture_started = True
            self.selected_pair = (1, 2)
            self._submit_signal(
                WaitingSignal(
                    bar.ts_event,
                    bar.ts_event + 300_000_000_000 * 40,
                    1,
                    85_300,
                    85_100,
                    85_700,
                ),
            )
        elif not getattr(self, "fixture_replaced", False):
            self.fixture_replaced = True
            self.support_state = ReplacementFixture()
            self._queue_four_hour_candidate(FourHour(bar.ts_event, 85_600, 85_450, 85_500))
        super().on_bar(bar)


def _scenario(instrument, scenario: str) -> dict:
    engine = BacktestEngine(
        BacktestEngineConfig(
            trader_id=TraderId("H13C-CHECK-001"),
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
        instrument_id = instrument.id
        strategy = FixtureStrategy(
            instrument_id,
            BarType.from_str(f"{instrument_id}-1-DAY-LAST-INTERNAL"),
            Quantity.from_str("0.003"),
            execution_bar_minutes=5,
            strategy_id=StrategyId("H13C-CHECK"),
            signal_variant="support-confirmed-4h",
        )
        engine.add_strategy(strategy)
        bar_type = BarType.from_str(f"{instrument_id}-5-MINUTE-LAST-EXTERNAL")
        prices = [(85_500, 85_600, 85_450, 85_500)] * 8
        if scenario == "cancel_then_new_fill":
            prices[1] = (85_500, 85_600, 85_450, 85_500)
            prices[2] = (85_500, 85_550, 85_350, 85_420)
            prices[3] = (85_420, 86_050, 85_400, 86_010)
        else:
            prices[1] = (85_500, 85_550, 85_250, 85_320)
            prices[2] = (85_320, 85_650, 85_300, 85_600)
            prices[3] = (85_600, 85_750, 85_500, 85_710)
        start = 1_790_000_099_999_000_000
        times = [start + i * 300_000_000_000 for i in range(len(prices))]
        engine.add_data(
            [
                MarkPriceUpdate(instrument_id, instrument.make_price(row[3]), ts, ts)
                for row, ts in zip(prices, times, strict=True)
            ],
        )
        engine.add_data(
            [
                Bar(
                    bar_type,
                    *(instrument.make_price(value) for value in row),
                    instrument.make_qty(100),
                    ts,
                    ts,
                )
                for row, ts in zip(prices, times, strict=True)
            ],
        )
        engine.run()
        orders = engine.generate_orders_report()
        positions = engine.generate_positions_report()
        return {
            "scenario": scenario,
            "entry_statuses": [
                str(row.status)
                for row in orders.itertuples()
                if str(row.type) == "LIMIT" and str(row.side) == "BUY"
            ],
            "order_statuses": [str(row.status) for row in orders.itertuples()],
            "fills": len(engine.generate_fills_report()),
            "closed_positions": int(positions.ts_closed.notna().sum()) if len(positions) else 0,
            "slot_violations": strategy.slot_violations,
            "supersessions": strategy.retracement_supersessions,
            "cancel_race_fills": strategy.retracement_cancel_race_fills,
        }
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
        _scenario(instrument, "cancel_then_new_fill"),
        _scenario(instrument, "old_fill_before_cancel"),
    ]
    canceled, raced = results
    assert canceled["entry_statuses"] == ["CANCELED", "FILLED"]
    assert canceled["fills"] == 2
    assert canceled["closed_positions"] == 1
    assert canceled["supersessions"] == 1
    assert canceled["cancel_race_fills"] == 0
    assert raced["entry_statuses"] == ["FILLED"]
    assert raced["fills"] == 2
    assert raced["closed_positions"] == 1
    assert raced["supersessions"] == 0
    assert all(row["slot_violations"] == 0 for row in results)
    args.output.write_text(
        json.dumps({"scope": "native H13c replacement", "results": results}, indent=2) + "\n",
    )


if __name__ == "__main__":
    main()
