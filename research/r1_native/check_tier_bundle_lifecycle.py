"""
Probe three native Nautilus OTO brackets on one netting instrument.
"""

from __future__ import annotations

import argparse
import json
from decimal import Decimal
from pathlib import Path

from retracement_strategy import RetracementPlan
from strategy import FourHour
from strategy import R1Strategy
from tiered_retracement_strategy import LIFETIME_NS
from tiered_retracement_strategy import TieredRetracementStrategy

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
        self.closed_callbacks = getattr(self, "closed_callbacks", 0) + 1
        self.entry_state_at_close = [
            (
                str(entry_id),
                str(self.cache.order(entry_id).status),
                self.cache.order(entry_id).is_open,
            )
            for entry_id in self.bundle_entries
        ]
        super().on_position_closed(event)
        for entry_id in self.bundle_entries:
            order = self.cache.order(entry_id)
            if order is not None and order.is_open and not order.is_pending_cancel:
                self.cancel_order(entry_id)


class H15StrategyFixture(TieredRetracementStrategy):
    """
    Inject frozen S27 geometry into the actual H15 native order lifecycle.
    """

    def on_bar(self, bar: Bar) -> None:
        if bar.bar_type != self.minute_bar_type:
            return
        if getattr(self, "submitted", False):
            if getattr(self, "fixture_exit_kind", None) == "supersede_unfilled":
                self.fixture_bar_count += 1
                if self.fixture_bar_count == 2:
                    replacement = RetracementPlan(
                        ts_event=bar.ts_event,
                        a_index=2,
                        b_index=3,
                        a_low=68_000,
                        b_high=73_000,
                        level_50=70_500,
                        entry=70_500,
                        level_764=69_180,
                        stop=67_750,
                        target=73_000,
                        support_low_indices=(),
                    )
                    self.support_state = _ReplacementSelector(replacement)
                    self._queue_four_hour_candidate(
                        FourHour(bar.ts_event, float(bar.high), float(bar.low), float(bar.close)),
                    )
                else:
                    self._advance_waiting(bar)
            if (
                getattr(self, "fixture_exit_kind", None) == "time_exit"
                and self.opened_ns is not None
                and bar.ts_event >= self.opened_ns + LIFETIME_NS
            ):
                self._on_four_hour_bar(bar)
            return
        self.submitted = True
        self.fixture_bar_count = 1
        self._submit_bundle(
            RetracementPlan(
                ts_event=bar.ts_event,
                a_index=0,
                b_index=1,
                a_low=67_711,
                b_high=72_858.5,
                level_50=70_284.75,
                entry=70_284.75,
                level_764=68_926,
                stop=STOP,
                target=TARGET,
                support_low_indices=(),
            ),
        )


class _ReplacementSelector:
    def __init__(self, plan: RetracementPlan) -> None:
        self.plan = plan
        self.last_readout = None

    def on_closed(self, candle: FourHour, prior_atr: float | None) -> RetracementPlan:
        self.last_readout = {
            "impulse": {"a_index": self.plan.a_index, "b_index": self.plan.b_index},
        }
        return self.plan


def _scenario(instrument, exit_kind: str, strategy_kind: str) -> dict:
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
        strategy_class = H15StrategyFixture if strategy_kind == "h15" else ThreeBracketFixture
        strategy = strategy_class(
            instrument.id,
            BarType.from_str(f"{instrument.id}-1-DAY-LAST-INTERNAL"),
            Quantity.from_str("0.001"),
            execution_bar_minutes=5,
            strategy_id=StrategyId("H15A-OTO-PROBE"),
            signal_variant=(
                "support-three-tier-4h" if strategy_kind == "h15" else "support-near50-4h"
            ),
            risk_budget_fraction=0.0025 if strategy_kind == "h15" else None,
        )
        strategy.fixture_exit_kind = exit_kind
        engine.add_strategy(strategy)
        bar_type = BarType.from_str(f"{instrument.id}-5-MINUTE-LAST-EXTERNAL")
        if exit_kind == "supersede_unfilled":
            prices = [
                (71_000, 71_100, 70_900, 71_000),
                (71_000, 71_100, 70_900, 71_000),
                (71_000, 71_100, 70_900, 71_000),
                (71_000, 71_100, 70_400, 70_450),
                (70_450, 73_100, 70_400, 73_000),
            ]
        elif exit_kind == "time_exit":
            prices = [
                (71_000, 71_100, 70_900, 71_000),
                (71_000, 71_100, 68_800, 69_000),
            ] + [(69_000, 69_050, 68_950, 69_000)] * 1_441
        elif exit_kind == "unfilled_expiry":
            prices = [(71_000, 71_100, 70_900, 71_000)] + [
                (71_000, 71_050, 70_950, 71_000),
            ] * 1_441
        elif exit_kind == "same_bar_stop":
            prices = [
                (71_000, 71_100, 70_900, 71_000),
                (71_000, 71_100, 67_400, 67_450),
                (67_450, 67_500, 67_400, 67_450),
            ]
        elif exit_kind == "two_tier_target_then_retrace":
            prices = [
                (71_000, 71_100, 70_900, 71_000),
                (70_900, 71_000, 70_200, 70_250),
                (70_250, 70_300, 69_600, 69_700),
                (69_700, 72_900, 69_600, 72_800),
                (72_800, 72_850, 68_800, 68_950),
            ]
        elif exit_kind == "target_then_retrace":
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
            "strategy_kind": strategy_kind,
            "bundle_submissions": getattr(strategy, "bundle_submissions", None),
            "bundle_retirements": getattr(strategy, "bundle_retirements", None),
            "bundle_supersessions": getattr(strategy, "bundle_supersessions", None),
            "bundle_cancel_race_fills": getattr(strategy, "bundle_cancel_race_fills", None),
            "waiting_voided": getattr(strategy, "waiting_voided", None),
            "bundle_order_failures": getattr(strategy, "bundle_order_failures", None),
            "closed_callbacks": getattr(strategy, "closed_callbacks", 0),
            "entry_state_at_close": getattr(strategy, "entry_state_at_close", []),
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
    parser.add_argument("--strategy", choices=("primitive", "h15"), default="primitive")
    args = parser.parse_args()
    instrument_id = InstrumentId.from_str("BTCUSDT-PERP.BINANCE")
    instruments = ParquetDataCatalog(str(args.catalog)).instruments(
        instrument_ids=[str(instrument_id)],
    )
    if len(instruments) != 1:
        raise RuntimeError("one BTC native Instrument is required")
    kinds = ["target", "stop", "target_then_retrace"]
    if args.strategy == "h15":
        kinds.extend(
            (
                "two_tier_target_then_retrace",
                "same_bar_stop",
                "unfilled_expiry",
                "time_exit",
                "supersede_unfilled",
            ),
        )
    results = [_scenario(instruments[0], kind, args.strategy) for kind in kinds]
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(
            {"method": "native Nautilus OTO probe", "strategy": args.strategy, "results": results},
            indent=2,
        )
        + "\n",
    )


if __name__ == "__main__":
    main()
