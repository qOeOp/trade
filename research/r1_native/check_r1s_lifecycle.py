"""
Native execution checks for the R-1s Strategy, using synthetic prices only.
"""

from __future__ import annotations

import argparse
import json
from decimal import Decimal
from pathlib import Path

from r1s_strategy import R1StagedStrategy
from run import _json_safe
from strategy import DAY_NS
from strategy import WaitingSignal

from vibe_trading.backtest import BacktestEngine
from vibe_trading.backtest import BacktestEngineConfig
from vibe_trading.common import LoggerConfig
from vibe_trading.common import LogLevel
from vibe_trading.data import DataEngineConfig
from vibe_trading.model import AccountType
from vibe_trading.model import AggressorSide
from vibe_trading.model import Bar
from vibe_trading.model import BarType
from vibe_trading.model import InstrumentId
from vibe_trading.model import MarkPriceUpdate
from vibe_trading.model import Money
from vibe_trading.model import OmsType
from vibe_trading.model import Quantity
from vibe_trading.model import StrategyId
from vibe_trading.model import TradeId
from vibe_trading.model import TraderId
from vibe_trading.model import TradeTick
from vibe_trading.model import Venue
from vibe_trading.persistence import ParquetDataCatalog


class CaseStrategy(R1StagedStrategy):
    def __new__(cls, *args, **kwargs):
        return super().__new__(cls, *args, **kwargs)

    def on_bar(self, bar: Bar) -> None:
        if not getattr(self, "case_submitted", False):
            self.case_submitted = True
            invalid_notional = getattr(self, "case_scenario", None) == "invalid-notional"
            self._submit_signal(
                WaitingSignal(
                    bar.ts_event,
                    bar.ts_event + 10 * DAY_NS,
                    -1 if invalid_notional else 1,
                    85_300,
                    85_500
                    if invalid_notional
                    else -1
                    if getattr(self, "case_scenario", None) == "invalid-price"
                    else 85_100,
                    84_900 if invalid_notional else 85_700,
                    85_299.9 if invalid_notional else 600,
                ),
            )
        if (
            getattr(self, "case_scenario", None) == "time-exit"
            and getattr(self, "case_time_exit_sent", False)
            and not getattr(self, "case_reentry_queued", False)
            and bar.ts_event >= self.case_exit_due_ns + 300_000_000_000
        ):
            self.case_reentry_queued = True
            self.waiting.append(
                WaitingSignal(
                    bar.ts_event,
                    bar.ts_event + 10 * DAY_NS,
                    1,
                    85_300,
                    85_100,
                    85_700,
                    600,
                ),
            )
        super().on_bar(bar)

    def on_position_closed(self, event) -> None:
        super().on_position_closed(event)
        if getattr(self, "case_scenario", None) == "time-exit":
            self.case_time_exit_sent = True
            self.case_exit_due_ns = event.ts_event

    def on_order_filled(self, event) -> None:
        super().on_order_filled(event)
        if event.client_order_id == self.staged_first_id:
            stop = self.cache.order(self.staged_stop_id)
            self.case_events = getattr(self, "case_events", [])
            self.case_events.append(
                (
                    "first_fill",
                    str(event.last_qty),
                    str(self.cache.order(self.staged_first_id).filled_qty),
                    str(stop.quantity),
                    str(stop.trigger_price),
                    str(stop.status),
                ),
            )

    def on_order_updated(self, event) -> None:
        super().on_order_updated(event)
        if event.client_order_id == self.staged_stop_id:
            self.case_events = getattr(self, "case_events", [])
            self.case_events.append(
                ("stop_updated", str(event.quantity), str(event.trigger_price)),
            )


def main() -> None:  # noqa: C901 - one native fixture driver checks several order-event paths.
    parser = argparse.ArgumentParser()
    parser.add_argument("--catalog", type=Path, required=True)
    parser.add_argument(
        "--scenario",
        choices=(
            "normal",
            "collision",
            "partial",
            "partial-first",
            "time-exit",
            "split-skip",
            "invalid-price",
            "invalid-notional",
        ),
        required=True,
    )
    args = parser.parse_args()
    instrument_id = InstrumentId.from_str("BTCUSDT-PERP.BINANCE")
    instrument = ParquetDataCatalog(str(args.catalog)).instruments(
        instrument_ids=[str(instrument_id)],
    )[0]
    bar_type = BarType.from_str(f"{instrument_id}-5-MINUTE-LAST-EXTERNAL")
    engine = BacktestEngine(
        BacktestEngineConfig(
            trader_id=TraderId("R1S-CHECK-001"),
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
            support_gtd_orders=True,
            support_contingent_orders=True,
            bar_execution=True,
            bar_adaptive_high_low_ordering=False,
            liquidity_consumption=args.scenario == "partial",
        )
        engine.add_instrument(instrument)
        strategy = CaseStrategy(
            instrument_id,
            BarType.from_str(f"{instrument_id}-1-DAY-LAST-INTERNAL"),
            Quantity.from_str(
                "0.005"
                if args.scenario == "partial-first"
                else "0.001"
                if args.scenario == "split-skip"
                else "0.003",
            ),
            execution_bar_minutes=5,
            strategy_id=StrategyId("R1S-CHECK"),
        )
        strategy.case_scenario = args.scenario
        engine.add_strategy(strategy)
        prices = [
            (85_210.4, 85_421.9, 85_181.1, 85_269.9),
            (85_269.9, 85_427.8, 85_178.4, 85_374.9),
            (85_375.0, 85_754.8, 85_300.0, 85_674.4),
            (85_674.5, 85_750.0, 85_584.7, 85_680.4),
            (85_680.4, 85_960.0, 85_561.0, 85_954.1),
        ]
        if args.scenario == "collision":
            prices[2] = (85_375.0, 85_754.8, 84_900.0, 85_674.4)
        if args.scenario == "partial":
            prices[2] = (85_375.0, 85_754.8, 85_301.0, 85_674.4)
        if args.scenario == "partial-first":
            prices[2] = (85_375.0, 85_600.0, 85_300.0, 85_500.0)
            prices[3] = (85_500.0, 85_750.0, 85_480.0, 85_680.4)
            prices[4] = (85_680.4, 85_750.0, 85_600.0, 85_680.4)
            prices.append((85_680.4, 85_960.0, 85_600.0, 85_954.1))
        if args.scenario == "time-exit":
            prices[2] = (85_375.0, 85_600.0, 85_300.0, 85_500.0)
            prices[3] = (85_500.0, 85_600.0, 85_400.0, 85_500.0)
            prices[4] = (85_500.0, 85_600.0, 85_400.0, 85_500.0)
        timestamps = [1_790_000_099_999_000_000 + i * 300_000_000_000 for i in range(len(prices))]
        if args.scenario == "time-exit":
            timestamps[3] = timestamps[1] + 61 * DAY_NS
            timestamps[4] = timestamps[3] + 300_000_000_000
        start = 1_790_000_099_999_000_000
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
        if args.scenario == "partial-first":
            engine.add_data(
                [
                    TradeTick(
                        instrument_id,
                        instrument.make_price(85_750),
                        instrument.make_qty(0.001),
                        AggressorSide.BUYER,
                        TradeId(f"R1S-PARTIAL-FIRST-{i}"),
                        start + 2 * 300_000_000_000 + i * 1_000_000_000,
                        start + 2 * 300_000_000_000 + i * 1_000_000_000,
                    )
                    for i in (1, 2)
                ],
            )
        engine.add_data(
            [
                Bar(
                    bar_type,
                    *(instrument.make_price(value) for value in row),
                    instrument.make_qty(
                        0.001
                        if args.scenario == "partial"
                        else 0.001
                        if args.scenario == "partial-first" and i in (3, 4)
                        else 100,
                    ),
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
        entry, stop = (
            (None, None)
            if args.scenario in ("split-skip", "invalid-price", "invalid-notional")
            else tuple(orders.iloc[:2].itertuples())
        )
        if args.scenario == "split-skip":
            valid = len(orders) == 0 and len(positions) == 0 and strategy.staged_split_skips == 1
        elif args.scenario == "invalid-price":
            valid = (
                len(orders) == 0
                and len(positions) == 0
                and strategy.staged_invalid_price_skips == 1
            )
        elif args.scenario == "invalid-notional":
            valid = (
                len(orders) == 0
                and len(positions) == 0
                and strategy.staged_invalid_notional_skips == 1
            )
        elif args.scenario == "normal":
            first, last = list(orders.iloc[2:].itertuples())
            valid = (
                str(entry.status) == "FILLED"
                and str(stop.status) == "CANCELED"
                and str(stop.quantity) == "0.002"
                and str(stop.trigger_price) == "85269.90"
                and str(first.status) == "FILLED"
                and str(first.quantity) == "0.001"
                and str(last.status) == "FILLED"
                and str(last.quantity) == "0.002"
                and len(positions) == 1
                and positions.ts_closed.notna().all()
            )
        elif args.scenario == "collision":
            first, last = list(orders.iloc[2:].itertuples())
            valid = (
                str(entry.status) == "FILLED"
                and str(stop.status) == "FILLED"
                and str(stop.quantity) == "0.002"
                and str(stop.trigger_price) == "85100.00"
                and str(first.status) == "FILLED"
                and str(last.status) == "CANCELED"
                and len(positions) == 1
                and positions.ts_closed.notna().all()
            )
        elif args.scenario == "partial":
            close = orders.iloc[2]
            valid = (
                len(orders) == 3
                and str(entry.status) == "CANCELED"
                and str(entry.filled_qty) == "0.001"
                and str(stop.status) == "CANCELED"
                and str(stop.quantity) == "0.001"
                and str(close.type) == "MARKET"
                and str(close.status) == "FILLED"
                and len(positions) == 1
                and positions.ts_closed.notna().all()
                and strategy.staged_unallocatable_closes == 1
            )
        elif args.scenario == "time-exit":
            old_first, old_last, close, new_entry, new_stop = list(
                orders.iloc[2:].itertuples(),
            )
            valid = (
                str(entry.status) == "FILLED"
                and str(stop.status) == "CANCELED"
                and str(old_first.status) == "CANCELED"
                and str(old_last.status) == "CANCELED"
                and str(close.type) == "MARKET"
                and str(close.status) == "FILLED"
                and str(new_entry.status) == "ACCEPTED"
                and str(new_stop.status) == "SUBMITTED"
                and str(strategy.staged_entry_id) == str(new_entry.Index)
                and not strategy.staged_cleanup_pending
                and strategy.slot_violations == 0
                and len(positions) == 1
                and positions.ts_closed.notna().all()
            )
        else:
            first, last = list(orders.iloc[2:].itertuples())
            first_fills = fills.reset_index()
            first_fills = first_fills[first_fills.client_order_id == str(first.Index)]
            valid = (
                str(entry.status) == "FILLED"
                and str(stop.status) == "CANCELED"
                and str(stop.quantity) == "0.003"
                and str(stop.trigger_price) == "85269.90"
                and str(first.status) == "FILLED"
                and str(first.quantity) == "0.002"
                and str(last.status) == "FILLED"
                and str(last.quantity) == "0.003"
                and list(first_fills.last_qty.astype(str)) == ["0.001", "0.001"]
                and ("stop_updated", "0.004", "85100.00") in getattr(strategy, "case_events", [])
                and ("stop_updated", "0.003", "85269.90") in getattr(strategy, "case_events", [])
                and len(positions) == 1
                and positions.ts_closed.notna().all()
            )
        if not valid or strategy.staged_protection_failures:
            raise RuntimeError(
                f"R-1s native {args.scenario} path failed: "
                f"{orders[['type', 'status', 'quantity', 'filled_qty', 'trigger_price']].to_dict('index')}; "
                f"{positions[['quantity', 'ts_closed']].to_dict('records')}; "
                f"fills={fills.reset_index()[['client_order_id', 'last_qty', 'last_px']].to_dict('records')}",
            )
        payload = {
            "scenario": args.scenario,
            "fills": (
                fills.reset_index()[["client_order_id", "last_qty", "last_px", "ts_event"]]
                .astype(str)
                .to_dict("records")
                if len(fills)
                else []
            ),
            "orders": (
                orders[["type", "status", "quantity", "filled_qty", "trigger_price"]]
                .astype(str)
                .to_dict("index")
                if len(orders)
                else {}
            ),
            "positions": (
                positions[["quantity", "ts_closed"]].astype(str).to_dict("records")
                if len(positions)
                else []
            ),
            "protection_failures": strategy.staged_protection_failures,
            "same_bar_first_stop": strategy.staged_same_bar_first_stop,
            "split_skips": strategy.staged_split_skips,
            "invalid_price_skips": strategy.staged_invalid_price_skips,
            "invalid_notional_skips": strategy.staged_invalid_notional_skips,
            "unallocatable_closes": strategy.staged_unallocatable_closes,
            "events": getattr(strategy, "case_events", []),
        }
        print(json.dumps(_json_safe(payload), indent=2, allow_nan=False))
    finally:
        engine.dispose()


if __name__ == "__main__":
    main()
