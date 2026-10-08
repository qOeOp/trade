"""
Check H13f market OTO fills and native stop/target protection on synthetic bars.
"""

from __future__ import annotations

import argparse
import json
from decimal import Decimal
from pathlib import Path

from retracement_strategy import RetracementPlan
from retracement_strategy import RetracementStrategy
from strategy import FourHour

from vibe_trading.backtest import BacktestEngine
from vibe_trading.backtest import BacktestEngineConfig
from vibe_trading.common import LoggerConfig
from vibe_trading.common import LogLevel
from vibe_trading.data import DataEngineConfig
from vibe_trading.model import AccountType
from vibe_trading.model import Bar
from vibe_trading.model import BarType
from vibe_trading.model import MarkPriceUpdate
from vibe_trading.model import Money
from vibe_trading.model import OmsType
from vibe_trading.model import Quantity
from vibe_trading.model import StrategyId
from vibe_trading.model import TraderId
from vibe_trading.model import Venue
from vibe_trading.persistence import ParquetDataCatalog


class FixtureStrategy(RetracementStrategy):
    def on_bar(self, bar: Bar) -> None:
        if bar.bar_type == self.minute_bar_type and not getattr(self, "fixture_started", False):
            self.fixture_started = True
            plan = RetracementPlan(
                bar.ts_event - 14_400_000_000_000,
                3,
                4,
                85_000,
                86_500,
                85_500,
                85_400,
                85_236,
                85_100,
                86_500,
                (0, 1),
            )
            decision = FourHour(bar.ts_event, 85_600, 85_350, 85_500)
            self.pending_rejection = (decision, plan, 85_500)
        super().on_bar(bar)


def _scenario(instrument, scenario: str) -> dict:
    engine = BacktestEngine(
        BacktestEngineConfig(
            trader_id=TraderId("H13F-CHECK-001"),
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
            strategy_id=StrategyId("H13F-CHECK"),
            signal_variant="support-rejection-4h",
        )
        engine.add_strategy(strategy)
        bar_type = BarType.from_str(f"{instrument_id}-5-MINUTE-LAST-EXTERNAL")
        prices = [(85_500, 85_600, 85_350, 85_500)] * 6
        if scenario == "target":
            prices[2] = (85_500, 86_600, 85_450, 86_550)
        else:
            prices[2] = (85_500, 85_550, 85_000, 85_050)
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
        fills = engine.generate_fills_report()
        positions = engine.generate_positions_report()
        return {
            "scenario": scenario,
            "decision_ns": times[0],
            "entry_and_exit_orders": [
                {"type": str(row.type), "side": str(row.side), "status": str(row.status)}
                for row in orders.itertuples()
            ],
            "fill_count": len(fills),
            "fill_event_ns": [int(ts.value) for ts in fills.ts_event],
            "closed_positions": int(positions.ts_closed.notna().sum()) if len(positions) else 0,
            "slot_violations": strategy.slot_violations,
            "actual_price_violations": strategy.retracement_actual_price_violations,
        }
    finally:
        engine.dispose()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    catalog = ParquetDataCatalog(str(args.catalog))
    instrument = catalog.instruments(instrument_ids=["BTCUSDT-PERP.BINANCE"])[0]
    rows = [_scenario(instrument, case) for case in ("target", "stop")]
    for row in rows:
        assert row["fill_count"] == 2
        assert row["fill_event_ns"][0] > row["decision_ns"]
        assert row["closed_positions"] == 1
        assert row["slot_violations"] == 0
        assert row["actual_price_violations"] == 0
        assert not any(
            order["status"] in ("DENIED", "REJECTED") for order in row["entry_and_exit_orders"]
        )
        assert sum(order["type"] == "MARKET" for order in row["entry_and_exit_orders"]) == 1
    args.output.write_text(
        json.dumps({"scope": "native H13f market OTO", "results": rows}, indent=2) + "\n",
    )


if __name__ == "__main__":
    main()
