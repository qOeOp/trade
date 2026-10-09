"""Small native OTO probe for the preregistered F01-11 combined variant."""

from __future__ import annotations

import argparse
import json
from decimal import Decimal
from pathlib import Path

from nautilus_trader.backtest import BacktestEngine
from nautilus_trader.backtest import BacktestEngineConfig
from nautilus_trader.common import LoggerConfig
from nautilus_trader.common import LogLevel
from nautilus_trader.data import DataEngineConfig
from nautilus_trader.execution import StaticLatencyModel
from nautilus_trader.model import AccountType
from nautilus_trader.model import Bar
from nautilus_trader.model import BarType
from nautilus_trader.model import InstrumentId
from nautilus_trader.model import MarkPriceUpdate
from nautilus_trader.model import Money
from nautilus_trader.model import OmsType
from nautilus_trader.model import Quantity
from nautilus_trader.model import StrategyId
from nautilus_trader.model import TraderId
from nautilus_trader.model import Venue
from nautilus_trader.persistence import ParquetDataCatalog

from retracement_strategy import RetracementPlan
from strategy import FOUR_HOUR_NS
from tiered_retracement_strategy import BROAD_LIFETIME_NS
from tiered_retracement_strategy import BROAD_LINE_CANCEL_VARIANT
from tiered_retracement_strategy import TieredRetracementStrategy


STEP_NS = 300_000_000_000
START_NS = 1_790_000_099_999_000_000
UNTOUCHED = (71_000, 71_100, 70_900, 71_000)
FIRST_FILL = (71_000, 71_050, 70_200, 70_250)


class CombinedFixture(TieredRetracementStrategy):
    def _freeze_entry_line(self) -> None:
        self.line_frozen_for_position = True
        if self.fixture_case == "no_line":
            return
        self.frozen_line = (
            -100 if self.fixture_case == "expired_line" else -1,
            69_700 if self.fixture_case == "both_filled" else 70_100,
            0.0,
        )
        self.line_snapshots += 1

    def on_bar(self, bar: Bar) -> None:
        if bar.bar_type != self.minute_bar_type:
            return
        if not getattr(self, "fixture_submitted", False):
            self.fixture_submitted = True
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
                    stop=68_500,
                    target=72_858.5,
                    support_low_indices=(),
                ),
            )
            return
        if (
            self.opened_ns is not None
            and bar.ts_event >= self.opened_ns + FOUR_HOUR_NS
            and not getattr(self, "fixture_line_checked", False)
        ):
            self.fixture_line_checked = True
            self._cancel_pending_on_frozen_line_break(bar)


def _bars(case: str) -> list[tuple[int, int, int, int]]:
    opening = [UNTOUCHED, FIRST_FILL]
    if case == "both_filled":
        opening.append((70_250, 70_300, 69_550, 69_750))
    filler = opening[-1][3]
    bars = opening + [(filler, filler + 50, filler - 50, filler)] * (49 - len(opening))
    line_bar = (filler, filler + 50, 69_850, 69_900)
    if case == "both_filled":
        line_bar = (filler, filler + 50, 69_650, 69_650)
    elif case == "at_line":
        line_bar = (filler, 70_300, 70_050, 70_100)
    elif case == "wick_only":
        line_bar = (filler, 70_300, 70_050, 70_200)
    elif case == "same_bar_stop":
        line_bar = (filler, 70_300, 68_400, 68_450)
    elif case == "same_bar_target":
        line_bar = (filler, 72_900, 70_200, 72_800)
    bars.append(line_bar)
    if case == "delayed_fill":
        bars.extend(
            [
                (69_900, 70_000, 69_500, 69_650),
                (69_650, 72_900, 69_600, 72_800),
            ],
        )
    elif case not in ("same_bar_stop", "same_bar_target"):
        bars.append((line_bar[3], 72_900, line_bar[3] - 50, 72_800))
    return bars


def _scenario(instrument, case: str) -> dict:
    engine = BacktestEngine(
        BacktestEngineConfig(
            trader_id=TraderId("F01-OTO-PROBE-001"),
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
                if case == "delayed_fill"
                else None
            ),
        )
        engine.add_instrument(instrument)
        strategy = CombinedFixture(
            instrument.id,
            BarType.from_str(f"{instrument.id}-1-DAY-LAST-INTERNAL"),
            Quantity.from_str("0.001"),
            execution_bar_minutes=5,
            strategy_id=StrategyId("F01-OTO-PROBE"),
            signal_variant=BROAD_LINE_CANCEL_VARIANT,
            risk_budget_fraction=0.0025,
        )
        strategy.fixture_case = case
        engine.add_strategy(strategy)
        bar_type = BarType.from_str(f"{instrument.id}-5-MINUTE-LAST-EXTERNAL")
        prices = _bars(case)
        timestamps = [START_NS + i * STEP_NS for i in range(len(prices))]
        if case == "at_lifetime":
            timestamps[-2] = timestamps[1] + BROAD_LIFETIME_NS
            timestamps[-1] = timestamps[-2] + STEP_NS
        engine.add_data(
            [
                MarkPriceUpdate(instrument.id, instrument.make_price(row[3]), ts, ts)
                for row, ts in zip(prices, timestamps, strict=True)
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
                for row, ts in zip(prices, timestamps, strict=True)
            ],
        )
        engine.run()
        orders = engine.generate_orders_report()
        fills = engine.generate_fills_report()
        positions = engine.generate_positions_report()
        tags = orders.tags.astype(str)
        entries = orders[tags == "['ENTRY']"]
        stops = orders[tags == "['STOP_LOSS']"]
        targets = orders[tags == "['TAKE_PROFIT']"]
        net = Decimal(0)
        minimum_net = Decimal(0)
        for fill in fills.sort_values("ts_event", kind="stable").itertuples():
            size = Decimal(str(fill.last_qty))
            net += size if fill.order_side == "BUY" else -size
            minimum_net = min(minimum_net, net)
        result = {
            "case": case,
            "filled_entries": int((entries.status == "FILLED").sum()),
            "filled_stops": int((stops.status == "FILLED").sum()),
            "filled_targets": int((targets.status == "FILLED").sum()),
            "line_break_events": strategy.line_break_events,
            "cancel_requests": strategy.line_cancel_requests,
            "fills_during_cancel": strategy.line_cancel_race_fills,
            "denied_or_rejected": int(orders.status.isin(("DENIED", "REJECTED")).sum()),
            "nonterminal_orders": int(
                (
                    ~orders.status.isin(
                        ("FILLED", "CANCELED", "EXPIRED", "REJECTED", "DENIED")
                    )
                ).sum(),
            ),
            "open_positions": int(positions.ts_closed.isna().sum())
            if len(positions)
            else 0,
            "minimum_net_quantity": str(minimum_net),
            "final_net_quantity": str(net),
            "entry_statuses": list(entries.status.astype(str)),
            "stop_statuses": list(stops.status.astype(str)),
            "target_statuses": list(targets.status.astype(str)),
        }
        expected = {
            "one_pending": (1, 0, 1, 1, 1, 0),
            "both_filled": (2, 0, 2, 1, 0, 0),
            "at_line": (1, 0, 1, 0, 0, 0),
            "wick_only": (1, 0, 1, 0, 0, 0),
            "no_line": (1, 0, 1, 0, 0, 0),
            "expired_line": (1, 0, 1, 0, 0, 0),
            "at_lifetime": (1, 0, 1, 0, 0, 0),
            "same_bar_stop": (2, 2, 0, 0, 0, 0),
            "same_bar_target": (1, 0, 1, 0, 0, 0),
            "delayed_fill": (2, 0, 2, 1, 1, 1),
        }
        observed = tuple(
            result[field]
            for field in (
                "filled_entries",
                "filled_stops",
                "filled_targets",
                "line_break_events",
                "cancel_requests",
                "fills_during_cancel",
            )
        )
        if (
            observed != expected[case]
            or len(entries) != 2
            or len(stops) != 2
            or len(targets) != 2
            or result["denied_or_rejected"]
            or result["nonterminal_orders"]
            or result["open_positions"]
            or minimum_net < 0
            or net != 0
        ):
            raise RuntimeError(f"native F01-11 lifecycle failed: {result}")
        return result
    finally:
        engine.dispose()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    instrument_id = InstrumentId.from_str("BTCUSDT-PERP.BINANCE")
    catalog = ParquetDataCatalog(str(args.catalog))
    instruments = catalog.instruments(instrument_ids=[str(instrument_id)])
    if len(instruments) != 1:
        raise RuntimeError("one BTC native Instrument is required")
    cases = (
        "one_pending",
        "both_filled",
        "at_line",
        "wick_only",
        "no_line",
        "expired_line",
        "at_lifetime",
        "same_bar_stop",
        "same_bar_target",
        "delayed_fill",
    )
    results = [_scenario(instruments[0], case) for case in cases]
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(
            {"method": "native Nautilus F01-11 OTO probe", "results": results}, indent=2
        )
        + "\n",
    )
    print(json.dumps({"cases": len(results), "passed": True}, indent=2))


if __name__ == "__main__":
    main()
