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
from vibe_trading.execution import StaticLatencyModel
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
            if getattr(self, "fixture_exit_kind", None) in (
                "supersede_unfilled",
                "old_fill_before_cancel_request",
                "fill_during_pending_cancel",
            ):
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


class H18StrategyFixture(H15StrategyFixture):
    """
    Drive the actual native cancel method with a frozen synthetic line.
    """

    def _freeze_entry_line(self) -> None:
        self.line_frozen_for_position = True
        if self.fixture_exit_kind == "no_line":
            return
        self.frozen_line = (
            -100 if self.fixture_exit_kind == "expired_line" else -1,
            69_700 if self.fixture_exit_kind in ("two_filled", "all_filled") else 70_100,
            0.0,
        )
        self.line_snapshots += 1

    def on_bar(self, bar: Bar) -> None:
        if (
            bar.bar_type == self.minute_bar_type
            and self.opened_ns is not None
            and bar.ts_event >= self.opened_ns + 4 * 3_600_000_000_000
            and not getattr(self, "fixture_line_checked", False)
        ):
            self.fixture_line_checked = True
            self._cancel_pending_on_frozen_line_break(bar)
        super().on_bar(bar)


class _ReplacementSelector:
    def __init__(self, plan: RetracementPlan) -> None:
        self.plan = plan
        self.last_readout = None

    def on_closed(self, candle: FourHour, prior_atr: float | None) -> RetracementPlan:
        self.last_readout = {
            "impulse": {"a_index": self.plan.a_index, "b_index": self.plan.b_index},
        }
        return self.plan


def _fill_net(fills) -> tuple[str, str]:
    net = Decimal(0)
    minimum_net = Decimal(0)
    if len(fills):
        for fill in fills.sort_values("ts_event", kind="stable").itertuples():
            quantity = Decimal(str(fill.last_qty))
            net += quantity if fill.order_side == "BUY" else -quantity
            minimum_net = min(minimum_net, net)
    return str(minimum_net), str(net)


def _scenario(instrument, exit_kind: str, strategy_kind: str) -> dict:  # noqa: C901
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
            latency_model=(
                StaticLatencyModel(cancel_latency_nanos=600_000_000_000)
                if exit_kind in ("fill_during_pending_cancel", "delayed_fill")
                else None
            ),
        )
        engine.add_instrument(instrument)
        strategy_class = (
            H18StrategyFixture
            if strategy_kind == "h18"
            else H15StrategyFixture
            if strategy_kind in ("h15", "h16")
            else ThreeBracketFixture
        )
        strategy = strategy_class(
            instrument.id,
            BarType.from_str(f"{instrument.id}-1-DAY-LAST-INTERNAL"),
            Quantity.from_str("0.001"),
            execution_bar_minutes=5,
            strategy_id=StrategyId("H15A-OTO-PROBE"),
            signal_variant=(
                "support-three-tier-4h"
                if strategy_kind == "h15"
                else "support-three-tier-line-cancel-4h"
                if strategy_kind == "h18"
                else "support-deep-two-tier-4h"
                if strategy_kind == "h16"
                else "support-near50-4h"
            ),
            risk_budget_fraction=0.0025 if strategy_kind in ("h15", "h16", "h18") else None,
        )
        strategy.fixture_exit_kind = exit_kind
        engine.add_strategy(strategy)
        bar_type = BarType.from_str(f"{instrument.id}-5-MINUTE-LAST-EXTERNAL")
        if exit_kind == "fill_during_pending_cancel":
            prices = [
                (71_000, 71_100, 70_900, 71_000),
                (71_000, 71_100, 70_900, 71_000),
                (71_000, 71_100, 70_200, 70_250),
                (70_250, 72_900, 70_200, 72_800),
                (72_800, 72_850, 68_800, 68_950),
            ]
        elif exit_kind == "old_fill_before_cancel_request":
            prices = [
                (71_000, 71_100, 70_900, 71_000),
                (71_000, 71_100, 70_200, 70_250),
                (70_250, 72_900, 70_200, 72_800),
                (72_800, 72_850, 68_800, 68_950),
            ]
        elif exit_kind == "supersede_unfilled":
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
        if strategy_kind == "h16":
            prices = _deep_tier_prices(exit_kind)
        elif strategy_kind == "h18":
            prices = _line_cancel_prices(exit_kind)
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
        fill_fields = ("side", "order_side", "last_qty", "ts_event", "client_order_id")
        visible_fill_fields = [field for field in fill_fields if field in fills.columns]
        minimum_net, final_net = _fill_net(fills)
        return {
            "exit_kind": exit_kind,
            "strategy_kind": strategy_kind,
            "bundle_submissions": getattr(strategy, "bundle_submissions", None),
            "bundle_retirements": getattr(strategy, "bundle_retirements", None),
            "bundle_supersessions": getattr(strategy, "bundle_supersessions", None),
            "bundle_cancel_race_fills": getattr(strategy, "bundle_cancel_race_fills", None),
            "waiting_voided": getattr(strategy, "waiting_voided", None),
            "bundle_order_failures": getattr(strategy, "bundle_order_failures", None),
            "line_break_events": getattr(strategy, "line_break_events", None),
            "line_cancel_requests": getattr(strategy, "line_cancel_requests", None),
            "line_cancel_race_fills": getattr(strategy, "line_cancel_race_fills", None),
            "closed_callbacks": getattr(strategy, "closed_callbacks", 0),
            "entry_state_at_close": getattr(strategy, "entry_state_at_close", []),
            "entry_statuses": list(entry.status.astype(str)),
            "stop_statuses": list(stops.status.astype(str)),
            "target_statuses": list(targets.status.astype(str)),
            "filled_entries": int((entry.status == "FILLED").sum()),
            "filled_stops": int((stops.status == "FILLED").sum()),
            "filled_targets": int((targets.status == "FILLED").sum()),
            "denied_or_rejected": int(orders.status.isin(("DENIED", "REJECTED")).sum()),
            "nonterminal_orders": int(
                (
                    ~orders.status.isin(("FILLED", "CANCELED", "EXPIRED", "REJECTED", "DENIED"))
                ).sum(),
            ),
            "native_fills": len(fills),
            "minimum_native_fill_net_qty": minimum_net,
            "final_native_fill_net_qty": final_net,
            "native_position_rows": len(positions),
            "closed_position_rows": int(positions.ts_closed.notna().sum()) if len(positions) else 0,
            "open_position_rows": int(positions.ts_closed.isna().sum()) if len(positions) else 0,
            "position_sides": list(positions.side.astype(str)) if len(positions) else [],
            "order_report_columns": list(orders.columns),
            "fill_report_columns": list(fills.columns),
            "fills": [
                {field: str(row[field]) for field in visible_fill_fields}
                for _, row in fills.iterrows()
            ],
            "orders": [
                {field: str(row[field]) for field in visible_order_fields}
                for _, row in orders.iterrows()
            ],
        }
    finally:
        engine.dispose()


def _deep_tier_prices(exit_kind: str) -> list[tuple[int, int, int, int]]:
    untouched = (71_000, 71_100, 70_900, 71_000)
    first = (70_900, 71_000, 69_600, 69_700)
    second = (69_700, 69_800, 68_800, 68_950)
    target = (68_950, 72_900, 68_900, 72_800)
    stop = (68_950, 69_000, 67_400, 67_450)
    if exit_kind == "unfilled_expiry":
        return [untouched] + [(71_000, 71_050, 70_950, 71_000)] * 1_441
    if exit_kind == "time_exit":
        return [untouched, second] + [(69_000, 69_050, 68_950, 69_000)] * 1_441
    if exit_kind == "same_bar_stop":
        return [untouched, (71_000, 71_100, 67_400, 67_450), stop]
    if exit_kind == "supersede_unfilled":
        return [untouched] * 3 + [
            (71_000, 71_100, 70_400, 70_450),
            (70_450, 73_100, 69_800, 73_000),
        ]
    if exit_kind == "old_fill_before_cancel_request":
        return [untouched, first, (69_700, 72_900, 69_600, 72_800), second]
    if exit_kind == "fill_during_pending_cancel":
        return [untouched, untouched, first, (69_700, 72_900, 69_600, 72_800), second]
    if exit_kind == "target_then_retrace":
        return [untouched, first, (69_700, 72_900, 69_600, 72_800), second, untouched]
    if exit_kind == "two_tier_target_then_retrace":
        return [untouched, first, second, target, second]
    return [untouched, first, second, target if exit_kind == "target" else stop]


def _line_cancel_prices(exit_kind: str) -> list[tuple[int, int, int, int]]:
    untouched = (71_000, 71_100, 70_900, 71_000)
    first = (71_000, 71_050, 70_200, 70_250)
    second = (70_250, 70_300, 69_600, 69_750)
    third = (69_750, 69_800, 68_800, 69_000)
    if exit_kind == "all_filled":
        opening = [untouched, third]
        line_bar = (69_000, 69_100, 68_950, 69_000)
    elif exit_kind == "two_filled":
        opening = [untouched, first, second]
        line_bar = (69_750, 69_800, 69_650, 69_650)
    else:
        opening = [untouched, first]
        line_bar = (70_250, 70_300, 69_850, 69_900)
    if exit_kind == "at_line":
        line_bar = (70_250, 70_300, 70_050, 70_100)
    elif exit_kind == "wick_only":
        line_bar = (70_250, 70_300, 70_050, 70_200)
    elif exit_kind == "fill_before_cancel":
        line_bar = (70_250, 70_300, 69_600, 69_650)
    elif exit_kind == "same_bar_stop":
        line_bar = (70_250, 70_300, 67_400, 67_450)
    elif exit_kind == "same_bar_target":
        line_bar = (70_250, 72_900, 70_200, 72_800)
    filler = opening[-1][3]
    bars = opening + [(filler, filler + 50, filler - 50, filler)] * (49 - len(opening))
    bars.append(line_bar)
    if exit_kind == "delayed_fill":
        bars.extend(
            [
                (69_900, 70_000, 69_500, 69_650),
                (69_650, 72_900, 69_600, 72_800),
            ],
        )
    elif exit_kind not in ("same_bar_stop", "same_bar_target"):
        bars.append((line_bar[3], 72_900, line_bar[3] - 50, 72_800))
    return bars


def main() -> None:  # noqa: C901 - probes native order lifecycle scenarios.
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument(
        "--strategy",
        choices=("primitive", "h15", "h16", "h18"),
        default="primitive",
    )
    args = parser.parse_args()
    instrument_id = InstrumentId.from_str("BTCUSDT-PERP.BINANCE")
    instruments = ParquetDataCatalog(str(args.catalog)).instruments(
        instrument_ids=[str(instrument_id)],
    )
    if len(instruments) != 1:
        raise RuntimeError("one BTC native Instrument is required")
    kinds = ["target", "stop", "target_then_retrace"]
    if args.strategy in ("h15", "h16"):
        kinds.extend(
            (
                "two_tier_target_then_retrace",
                "same_bar_stop",
                "unfilled_expiry",
                "time_exit",
                "supersede_unfilled",
                "old_fill_before_cancel_request",
                "fill_during_pending_cancel",
            ),
        )
    elif args.strategy == "h18":
        kinds = [
            "one_filled",
            "two_filled",
            "at_line",
            "wick_only",
            "no_line",
            "expired_line",
            "all_filled",
            "same_bar_stop",
            "same_bar_target",
            "fill_before_cancel",
            "delayed_fill",
        ]
    results = [_scenario(instruments[0], kind, args.strategy) for kind in kinds]
    if args.strategy in ("h15", "h16"):
        expected = {
            "target": (3, 0, 3),
            "stop": (3, 3, 0),
            "target_then_retrace": (1, 0, 1),
            "two_tier_target_then_retrace": (2, 0, 2),
            "same_bar_stop": (3, 3, 0),
            "unfilled_expiry": (0, 0, 0),
            "time_exit": (3, 0, 0),
            "supersede_unfilled": (1, 0, 1),
            "old_fill_before_cancel_request": (1, 0, 1),
            "fill_during_pending_cancel": (1, 0, 1),
        }
        if args.strategy == "h16":
            expected.update(
                target=(2, 0, 2),
                stop=(2, 2, 0),
                two_tier_target_then_retrace=(2, 0, 2),
                same_bar_stop=(2, 2, 0),
                time_exit=(2, 0, 0),
            )
        for result in results:
            observed = (
                result["filled_entries"],
                result["filled_stops"],
                result["filled_targets"],
            )
            if (
                observed != expected[result["exit_kind"]]
                or any(
                    (
                        result["denied_or_rejected"],
                        result["nonterminal_orders"],
                        result["open_position_rows"],
                    ),
                )
                or any(side == "SHORT" for side in result["position_sides"])
                or Decimal(result["minimum_native_fill_net_qty"]) < 0
                or Decimal(result["final_native_fill_net_qty"]) != 0
            ):
                raise RuntimeError(f"H15 native lifecycle failed: {result['exit_kind']}: {result}")
    elif args.strategy == "h18":
        expected = {
            "one_filled": (1, 0, 1, 1, 2, 0),
            "two_filled": (2, 0, 2, 1, 1, 0),
            "at_line": (1, 0, 1, 0, 0, 0),
            "wick_only": (1, 0, 1, 0, 0, 0),
            "no_line": (1, 0, 1, 0, 0, 0),
            "expired_line": (1, 0, 1, 0, 0, 0),
            "all_filled": (3, 0, 3, 1, 0, 0),
            "same_bar_stop": (3, 3, 0, 0, 0, 0),
            "same_bar_target": (1, 0, 1, 0, 0, 0),
            "fill_before_cancel": (2, 0, 2, 1, 1, 0),
            "delayed_fill": (2, 0, 2, 1, 2, 1),
        }
        for result in results:
            observed = tuple(
                result[field]
                for field in (
                    "filled_entries",
                    "filled_stops",
                    "filled_targets",
                    "line_break_events",
                    "line_cancel_requests",
                    "line_cancel_race_fills",
                )
            )
            if (
                observed != expected[result["exit_kind"]]
                or result["denied_or_rejected"]
                or result["nonterminal_orders"]
                or result["open_position_rows"]
                or any(side == "SHORT" for side in result["position_sides"])
                or Decimal(result["minimum_native_fill_net_qty"]) < 0
                or Decimal(result["final_native_fill_net_qty"]) != 0
            ):
                raise RuntimeError(f"H18 native lifecycle failed: {result['exit_kind']}: {result}")
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
