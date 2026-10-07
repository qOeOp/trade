"""
Small native order-event probe for the registered R-1s execution design.

This uses synthetic prices only to test Nautilus order linkage and callbacks; it does
not produce strategy returns or research performance evidence.

"""

from __future__ import annotations

import argparse
import json
from decimal import Decimal
from pathlib import Path

from vibe_trading.backtest import BacktestEngine
from vibe_trading.backtest import BacktestEngineConfig
from vibe_trading.common import LoggerConfig
from vibe_trading.common import LogLevel
from vibe_trading.core import UUID4
from vibe_trading.data import DataEngineConfig
from vibe_trading.model import AccountType
from vibe_trading.model import Bar
from vibe_trading.model import BarType
from vibe_trading.model import ContingencyType
from vibe_trading.model import InstrumentId
from vibe_trading.model import LimitOrder
from vibe_trading.model import MarkPriceUpdate
from vibe_trading.model import Money
from vibe_trading.model import OmsType
from vibe_trading.model import OrderSide
from vibe_trading.model import StopMarketOrder
from vibe_trading.model import StrategyId
from vibe_trading.model import TimeInForce
from vibe_trading.model import TraderId
from vibe_trading.model import TriggerType
from vibe_trading.model import Venue
from vibe_trading.persistence import ParquetDataCatalog
from vibe_trading.trading import Strategy
from vibe_trading.trading import StrategyConfig


class Probe(Strategy):
    def __new__(cls, instrument_id: InstrumentId, bar_type: BarType):
        return super().__new__(cls)

    def __init__(self, instrument_id: InstrumentId, bar_type: BarType) -> None:
        super().__init__(StrategyConfig(strategy_id=StrategyId("R1S-PROBE")))
        self.instrument_id = instrument_id
        self.bar_type = bar_type
        self.entry_id = None
        self.stop_id = None
        self.first_id = None
        self.last_id = None
        self.events = []

    def on_start(self) -> None:
        self.subscribe_bars(self.bar_type)

    def on_bar(self, bar: Bar) -> None:
        self.events.append(
            ("bar", str(bar.open), str(bar.low), str(bar.high), str(bar.close)),
        )
        if self.entry_id is not None:
            return
        instrument = self.cache.instrument(self.instrument_id)
        ts = self.clock.timestamp_ns()
        self.entry_id = self.order_factory.generate_client_order_id()
        self.stop_id = self.order_factory.generate_client_order_id()
        list_id = self.order_factory.generate_order_list_id()
        entry = LimitOrder(
            self.order_factory.trader_id,
            self.order_factory.strategy_id,
            self.instrument_id,
            self.entry_id,
            OrderSide.BUY,
            instrument.make_qty(0.003),
            instrument.make_price(85_300),
            TimeInForce.GTC,
            False,
            False,
            False,
            UUID4(),
            ts,
            contingency_type=ContingencyType.OTO,
            order_list_id=list_id,
            linked_order_ids=[self.stop_id],
        )
        stop = StopMarketOrder(
            self.order_factory.trader_id,
            self.order_factory.strategy_id,
            self.instrument_id,
            self.stop_id,
            OrderSide.SELL,
            instrument.make_qty(0.003),
            instrument.make_price(85_100),
            TriggerType.DEFAULT,
            TimeInForce.GTC,
            True,
            False,
            UUID4(),
            ts,
            order_list_id=list_id,
            parent_order_id=self.entry_id,
        )
        self.submit_order_list([entry, stop])

    def on_order_filled(self, event) -> None:
        self.events.append(("filled", str(event.client_order_id), str(event.last_qty)))
        if event.client_order_id == self.first_id:
            position = self.cache.position_for_order(self.entry_id)
            self.events.append(
                ("position_after_first", str(position.quantity), position.avg_px_open),
            )
            self.modify_order(
                self.stop_id,
                quantity=position.quantity,
                trigger_price=self.cache.instrument(self.instrument_id).make_price(
                    position.avg_px_open,
                ),
            )
            return
        if event.client_order_id == self.stop_id:
            for target_id in (self.first_id, self.last_id):
                if target_id is not None:
                    target = self.cache.order(target_id)
                    if target is not None and target.is_open:
                        self.cancel_order(target_id)
            return
        if event.client_order_id != self.entry_id:
            return
        instrument = self.cache.instrument(self.instrument_id)
        first = self.order_factory.limit(
            self.instrument_id,
            OrderSide.SELL,
            instrument.make_qty(0.001),
            instrument.make_price(85_500),
            reduce_only=True,
        )
        last = self.order_factory.limit(
            self.instrument_id,
            OrderSide.SELL,
            instrument.make_qty(0.002),
            instrument.make_price(85_900),
            reduce_only=True,
        )
        self.first_id, self.last_id = first.client_order_id, last.client_order_id
        self.submit_order(first)
        self.submit_order(last)

    def on_order_accepted(self, event) -> None:
        self.events.append(("accepted", str(event.client_order_id)))

    def on_order_updated(self, event) -> None:
        self.events.append(
            (
                "updated",
                str(event.client_order_id),
                str(event.quantity),
                str(event.trigger_price),
            ),
        )

    def on_order_canceled(self, event) -> None:
        self.events.append(("canceled", str(event.client_order_id)))

    def on_order_rejected(self, event) -> None:
        self.events.append(("rejected", str(event.client_order_id), str(event.reason)))

    def on_position_closed(self, event) -> None:
        self.events.append(("position_closed", str(event.position_id)))
        for order_id in (self.stop_id, self.first_id, self.last_id):
            if order_id is not None:
                order = self.cache.order(order_id)
                if order is not None and order.is_open:
                    self.cancel_order(order_id)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--catalog", type=Path, required=True)
    parser.add_argument(
        "--scenario",
        choices=("normal", "stop-first", "collision"),
        default="normal",
    )
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    instrument_id = InstrumentId.from_str("BTCUSDT-PERP.BINANCE")
    instrument = ParquetDataCatalog(str(args.catalog)).instruments(
        instrument_ids=[str(instrument_id)],
    )[0]
    bar_type = BarType.from_str(f"{instrument_id}-5-MINUTE-LAST-EXTERNAL")
    engine = BacktestEngine(
        BacktestEngineConfig(
            trader_id=TraderId("R1S-PROBE-001"),
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
        probe = Probe(instrument_id, bar_type)
        engine.add_strategy(probe)
        prices = [
            (85_210.4, 85_421.9, 85_181.1, 85_269.9),
            (85_269.9, 85_427.8, 85_178.4, 85_374.9),
            (85_375.0, 85_754.8, 85_300.0, 85_674.4),
            (85_674.5, 85_750.0, 85_584.7, 85_680.4),
            (85_680.4, 85_960.0, 85_561.0, 85_954.1),
        ]
        if args.scenario == "stop-first":
            prices[2] = (85_375.0, 85_400.0, 84_900.0, 85_000.0)
            prices[3:] = [(85_000.0, 85_050.0, 84_950.0, 85_000.0)] * 2
        elif args.scenario == "collision":
            prices[2] = (85_375.0, 85_754.8, 84_900.0, 85_674.4)
        start = 1_790_000_099_999_000_000
        engine.add_data(
            [
                MarkPriceUpdate(
                    instrument_id=instrument_id,
                    value=instrument.make_price(row[3]),
                    ts_event=start + i * 300_000_000_000,
                    ts_init=start + i * 300_000_000_000,
                )
                for i, row in enumerate(prices)
            ],
        )
        engine.add_data(
            [
                Bar(
                    bar_type,
                    *(instrument.make_price(x) for x in row),
                    instrument.make_qty(100),
                    start + i * 300_000_000_000,
                    start + i * 300_000_000_000,
                )
                for i, row in enumerate(prices)
            ],
        )
        engine.run()
        orders = engine.generate_orders_report()
        positions = engine.generate_positions_report()
        order_by_id = {str(index): row for index, row in orders.iterrows()}
        stop = order_by_id[str(probe.stop_id)]
        first = order_by_id[str(probe.first_id)]
        last = order_by_id[str(probe.last_id)]
        expected = {
            "normal": ("CANCELED", "FILLED", "FILLED", "85269.90"),
            "stop-first": ("FILLED", "CANCELED", "CANCELED", "85100.00"),
            "collision": ("FILLED", "FILLED", "CANCELED", "85100.00"),
        }[args.scenario]
        actual = (
            str(stop.status),
            str(first.status),
            str(last.status),
            str(stop.trigger_price),
        )
        if actual != expected or len(positions) != 1 or not positions.ts_closed.notna().all():
            raise RuntimeError(
                f"native staged-order probe changed: {actual} != {expected}",
            )
        payload = {
            "scenario": args.scenario,
            "result": "native_order_events_verified",
            "price_path": prices,
            "events": probe.events,
            "orders": [
                {
                    "id": str(row.Index),
                    "type": str(row.type),
                    "quantity": str(row.quantity),
                    "filled_qty": str(row.filled_qty),
                    "status": str(row.status),
                    "trigger_price": str(row.trigger_price),
                }
                for row in orders.itertuples()
            ],
            "positions": len(positions),
            "closed_positions": int(positions.ts_closed.notna().sum()) if len(positions) else 0,
        }
        rendered = json.dumps(payload, indent=2) + "\n"
        if args.output is None:
            print(rendered, end="")
        else:
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(rendered)
    finally:
        engine.dispose()


if __name__ == "__main__":
    main()
