"""Probe pinned Nautilus DEFAULT versus MARK_PRICE bracket stops on one instrument."""

from __future__ import annotations

import argparse
import json
from decimal import Decimal
from pathlib import Path

import pandas as pd
from nautilus_trader.backtest import BacktestEngine
from nautilus_trader.backtest import BacktestEngineConfig
from nautilus_trader.common import LogLevel
from nautilus_trader.common import LoggerConfig
from nautilus_trader.data import DataEngineConfig
from nautilus_trader.model import AccountType
from nautilus_trader.model import Bar
from nautilus_trader.model import BarType
from nautilus_trader.model import InstrumentId
from nautilus_trader.model import MarkPriceUpdate
from nautilus_trader.model import Money
from nautilus_trader.model import OmsType
from nautilus_trader.model import OrderSide
from nautilus_trader.model import OrderType
from nautilus_trader.model import Quantity
from nautilus_trader.model import StrategyId
from nautilus_trader.model import TimeInForce
from nautilus_trader.model import TraderId
from nautilus_trader.model import TriggerType
from nautilus_trader.model import Venue
from nautilus_trader.persistence import ParquetDataCatalog
from strategy import R1Strategy


START_NS = 1_790_000_099_999_000_000
STEP_NS = 300_000_000_000
LAST_OHLC = (
    (100_000, 100_100, 99_900, 100_000),
    (100_000, 100_100, 98_500, 99_000),
    (99_000, 100_000, 94_000, 99_000),
    (99_000, 100_000, 98_000, 99_000),
    (99_000, 100_000, 98_000, 99_000),
)
MARK_CLOSE = (100_000, 99_500, 99_500, 94_000, 94_000)
MARK_ONLY_LAST_OHLC = (
    LAST_OHLC[0],
    LAST_OHLC[1],
    (99_000, 100_000, 97_000, 99_000),
    (99_000, 100_000, 97_000, 99_000),
    (99_000, 100_000, 97_000, 99_000),
)
MARK_ONLY_MARK_CLOSE = (100_000, 99_500, 94_000, 94_000, 94_000)


class MarkStopFixture(R1Strategy):
    def on_bar(self, bar: Bar) -> None:
        if bar.bar_type != self.minute_bar_type or getattr(self, "submitted", False):
            return
        self.submitted = True
        bracket = self.order_factory.bracket(
            instrument_id=self.instrument_id,
            order_side=OrderSide.BUY,
            quantity=self.instrument.make_qty(0.01),
            entry_order_type=OrderType.LIMIT,
            entry_price=self.instrument.make_price(99_000),
            time_in_force=TimeInForce.GTC,
            tp_price=self.instrument.make_price(110_000),
            tp_post_only=False,
            sl_trigger_price=self.instrument.make_price(95_000),
            sl_trigger_type=self.fixture_trigger_type,
        )
        self.submit_order_list(bracket)


def run_one(
    instrument, trigger_type: TriggerType, last_ohlc: tuple, mark_close: tuple
) -> dict:
    engine = BacktestEngine(
        BacktestEngineConfig(
            trader_id=TraderId(f"D74-{str(trigger_type)}"),
            logging=LoggerConfig(stdout_level=LogLevel.ERROR, print_config=False),
            data_engine=DataEngineConfig(validate_data_sequence=True),
        )
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
        strategy = MarkStopFixture(
            instrument.id,
            BarType.from_str(f"{instrument.id}-1-DAY-LAST-INTERNAL"),
            Quantity.from_str("0.01"),
            execution_bar_minutes=5,
            strategy_id=StrategyId(f"D74-{str(trigger_type)}"),
            signal_variant="support-broad-two-tier-4h",
        )
        strategy.fixture_trigger_type = trigger_type
        engine.add_strategy(strategy)
        last_type = BarType.from_str(f"{instrument.id}-5-MINUTE-LAST-EXTERNAL")
        times = [START_NS + i * STEP_NS for i in range(len(last_ohlc))]
        engine.add_data(
            [
                MarkPriceUpdate(
                    instrument.id,
                    instrument.make_price(mark),
                    ts,
                    ts,
                )
                for mark, ts in zip(mark_close, times, strict=True)
            ]
        )
        engine.add_data(
            [
                Bar(
                    last_type,
                    *(instrument.make_price(value) for value in row),
                    instrument.make_qty(100),
                    ts,
                    ts,
                )
                for row, ts in zip(last_ohlc, times, strict=True)
            ]
        )
        engine.run()
        orders = engine.generate_orders_report().reset_index()
        fills = engine.generate_fills_report().reset_index()
        positions = engine.generate_positions_report().reset_index()
        result = {
            "trigger_type": str(trigger_type),
            "orders": [
                {
                    "client_order_id": str(row.client_order_id),
                    "type": str(row.type),
                    "status": str(row.status),
                    "trigger_type": str(row.trigger_type),
                    "trigger_price": str(row.trigger_price),
                    "ts_last": str(row.ts_last),
                }
                for row in orders.itertuples()
            ],
            "fills": [
                {
                    "client_order_id": str(row.client_order_id),
                    "order_type": str(row.order_type),
                    "last_px": str(row.last_px),
                    "ts_event": str(row.ts_event),
                }
                for row in fills.itertuples()
            ],
            "position_count": len(positions),
            "open_position_count": sum(
                pd.isna(row.ts_closed) for row in positions.itertuples()
            ),
            "final_account_total": str(
                engine.portfolio.account(Venue("BINANCE")).balance_total(
                    instrument.quote_currency
                )
            ),
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
    instruments = ParquetDataCatalog(str(args.catalog)).instruments(
        instrument_ids=[str(instrument_id)]
    )
    if len(instruments) != 1:
        raise RuntimeError("D74 requires the one registered BTC native Instrument")
    paths = {
        "last_spike_before_mark": (LAST_OHLC, MARK_CLOSE),
        "mark_cross_without_last": (MARK_ONLY_LAST_OHLC, MARK_ONLY_MARK_CLOSE),
    }
    results = {
        name: {
            "last_ohlc": last_ohlc,
            "mark_close_updates": mark_close,
            "DEFAULT": run_one(
                instruments[0], TriggerType.DEFAULT, last_ohlc, mark_close
            ),
            "MARK_PRICE": run_one(
                instruments[0], TriggerType.MARK_PRICE, last_ohlc, mark_close
            ),
        }
        for name, (last_ohlc, mark_close) in paths.items()
    }
    output = {
        "schema": "r1-native-d74-mark-trigger-capability/v1",
        "preregistration_commit": "72f8afbd3",
        "registered_instrument_catalog": str(args.catalog),
        "bar_event_times_ns": [START_NS + i * STEP_NS for i in range(len(LAST_OHLC))],
        "paths": results,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, indent=2, sort_keys=True) + "\n")


if __name__ == "__main__":
    main()
