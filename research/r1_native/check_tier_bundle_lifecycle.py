"""
Probe three native Nautilus OTO brackets on one netting instrument.
"""

from __future__ import annotations

import argparse
import json
from decimal import Decimal
from pathlib import Path

from strategy import R1Strategy

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
from vibe_trading.model import OrderSide
from vibe_trading.model import OrderType
from vibe_trading.model import Quantity
from vibe_trading.model import StrategyId
from vibe_trading.model import TimeInForce
from vibe_trading.model import TraderId
from vibe_trading.model import Venue
from vibe_trading.persistence import ParquetDataCatalog


ENTRY_PRICES = (70_284.8, 69_677.3, 68_925.8)
STOP = 67_441.1
TARGET = 72_858.5
STEP_NS = 300_000_000_000


class ThreeBracketFixture(R1Strategy):
    """
    Submit the three frozen source tiers through native order lists.
    """

    def on_bar(self, bar: Bar) -> None:
        if bar.bar_type != self.minute_bar_type or getattr(self, "submitted", False):
            return
        self.submitted = True
        self.bundle_entries = []
        for price in ENTRY_PRICES:
            orders = self.order_factory.bracket(
                instrument_id=self.instrument_id,
                order_side=OrderSide.BUY,
                quantity=Quantity.from_str("0.001"),
                entry_order_type=OrderType.LIMIT,
                entry_price=self.instrument.make_price(price),
                time_in_force=TimeInForce.GTC,
                tp_price=self.instrument.make_price(TARGET),
                tp_post_only=False,
                sl_trigger_price=self.instrument.make_price(STOP),
            )
            self.bundle_entries.append(orders[0].client_order_id)
            self.submit_order_list(orders)

    def on_position_closed(self, event) -> None:
        super().on_position_closed(event)
        for entry_id in self.bundle_entries:
            order = self.cache.order(entry_id)
            if order is not None and order.is_open:
                self.cancel_order(order)


def _scenario(instrument, exit_kind: str) -> dict:
    engine = BacktestEngine(
        BacktestEngineConfig(
            trader_id=TraderId("H15A-OTO-PROBE-001"),
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
        strategy = ThreeBracketFixture(
            instrument.id,
            BarType.from_str(f"{instrument.id}-1-DAY-LAST-INTERNAL"),
            Quantity.from_str("0.001"),
            execution_bar_minutes=5,
            strategy_id=StrategyId("H15A-OTO-PROBE"),
            signal_variant="support-near50-4h",
        )
        engine.add_strategy(strategy)
        bar_type = BarType.from_str(f"{instrument.id}-5-MINUTE-LAST-EXTERNAL")
        if exit_kind == "target_then_retrace":
            prices = [
                (71_000, 71_100, 70_900, 71_000),
                (70_900, 71_000, 70_200, 70_250),
                (70_250, 72_900, 70_200, 72_800),
                (72_800, 72_850, 68_800, 68_950),
                (68_950, 69_000, 68_900, 68_950),
            ]
        else:
            prices = [
                (71_000, 71_100, 70_900, 71_000),
                (70_900, 71_000, 70_200, 70_250),
                (70_250, 70_300, 69_600, 69_700),
                (69_700, 69_800, 68_800, 68_950),
                (68_950, 72_900, 68_900, 72_800)
                if exit_kind == "target"
                else (68_950, 69_000, 67_400, 67_450),
            ]
        start = 1_790_000_099_999_000_000
        times = [start + index * STEP_NS for index in range(len(prices))]
        engine.add_data(
            [
                MarkPriceUpdate(instrument.id, instrument.make_price(row[3]), ts, ts)
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
        fills = engine.generate_fills_report()
        typed_tags = orders.tags.astype(str)
        entry = orders[typed_tags == "['ENTRY']"]
        stops = orders[typed_tags == "['STOP_LOSS']"]
        targets = orders[typed_tags == "['TAKE_PROFIT']"]
        order_fields = (
            "client_order_id",
            "side",
            "type",
            "quantity",
            "filled_qty",
            "price",
            "trigger_price",
            "status",
            "tags",
        )
        visible_order_fields = [field for field in order_fields if field in orders.columns]
        return {
            "exit_kind": exit_kind,
            "entry_statuses": list(entry.status.astype(str)),
            "stop_statuses": list(stops.status.astype(str)),
            "target_statuses": list(targets.status.astype(str)),
            "filled_entries": int((entry.status == "FILLED").sum()),
            "filled_stops": int((stops.status == "FILLED").sum()),
            "filled_targets": int((targets.status == "FILLED").sum()),
            "denied_or_rejected": int(orders.status.isin(("DENIED", "REJECTED")).sum()),
            "native_fills": len(fills),
            "native_position_rows": len(positions),
            "closed_position_rows": int(positions.ts_closed.notna().sum()) if len(positions) else 0,
            "open_position_rows": int(positions.ts_closed.isna().sum()) if len(positions) else 0,
            "order_report_columns": list(orders.columns),
            "orders": [
                {field: str(row[field]) for field in visible_order_fields}
                for _, row in orders.iterrows()
            ],
        }
    finally:
        engine.dispose()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    instrument_id = InstrumentId.from_str("BTCUSDT-PERP.BINANCE")
    instruments = ParquetDataCatalog(str(args.catalog)).instruments(
        instrument_ids=[str(instrument_id)],
    )
    if len(instruments) != 1:
        raise RuntimeError("one BTC native Instrument is required")
    results = [
        _scenario(instruments[0], kind) for kind in ("target", "stop", "target_then_retrace")
    ]
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(
            {"method": "native Nautilus OTO probe", "results": results},
            indent=2,
        )
        + "\n",
    )


if __name__ == "__main__":
    main()
