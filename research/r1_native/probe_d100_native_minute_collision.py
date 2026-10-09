"""D100: local Nautilus OTO replay of two frozen H10 real 1m/5m collision cases."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
from decimal import Decimal
from pathlib import Path

from nautilus_trader.backtest import BacktestEngine, BacktestEngineConfig
from nautilus_trader.common import LoggerConfig, LogLevel
from nautilus_trader.data import DataEngineConfig
from nautilus_trader.model import (
    AccountType,
    BarType,
    MarkPriceUpdate,
    Money,
    OmsType,
    OrderSide,
    OrderType,
    Quantity,
    StrategyId,
    TimeInForce,
    TraderId,
    Venue,
)
from nautilus_trader.persistence import ParquetDataCatalog
from nautilus_trader.trading import Strategy, StrategyConfig


ROOT = Path(__file__).resolve().parent
D100 = ROOT / "results/2026-10-09-d100-h10-one-minute-collision.json"
D100_SHA = "85fa15c4655fecbe0f22dfaeac0ede2e314484773d294421f39e4b8d2686c720"
H10 = Path("/tmp/r1-rd-h10-full-37")
ONE_ROOT = Path("/tmp/r1-37-2026oct7")
FIVE_ROOT = Path("/tmp/r1-37-1y-5m-2026oct7")
MINUTE_NS = 60_000_000_000
FIVE_NS = 5 * MINUTE_NS


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


class Probe(Strategy):
    def __new__(cls, instrument_id, bar_type, plan):
        return super().__new__(cls)

    def __init__(self, instrument_id, bar_type, plan) -> None:
        super().__init__(StrategyConfig(strategy_id=StrategyId("D100-PROBE")))
        self.instrument_id = instrument_id
        self.bar_type = bar_type
        self.plan = plan
        self.submitted = False
        self.events = []

    def on_start(self) -> None:
        self.subscribe_bars(self.bar_type)

    def on_bar(self, bar) -> None:
        if self.submitted:
            return
        self.submitted = True
        orders = self.order_factory.bracket(
            instrument_id=self.instrument_id,
            order_side=self.plan["side"],
            quantity=self.plan["quantity"],
            entry_order_type=OrderType.LIMIT,
            entry_price=self.plan["entry"],
            time_in_force=TimeInForce.GTD,
            expire_time=self.plan["expire_time"],
            tp_price=self.plan["target"],
            tp_post_only=False,
            sl_trigger_price=self.plan["stop"],
        )
        self.order_ids = [str(order.client_order_id) for order in orders]
        self.submit_order_list(orders)

    def on_order_filled(self, event) -> None:
        self.events.append(["filled", str(event.client_order_id), event.ts_event, str(event.last_px)])

    def on_order_rejected(self, event) -> None:
        self.events.append(["rejected", str(event.client_order_id), event.ts_event, str(event.reason)])

    def on_order_canceled(self, event) -> None:
        self.events.append(["canceled", str(event.client_order_id), event.ts_event])


def replay(case: dict, minute_step: int, old_orders: dict) -> dict:
    coin = case["coin"]
    entry = old_orders[case["entry_order_id"]]
    stop = old_orders[case["stop_order_id"]]
    target = next(
        row for row in old_orders.values()
        if row["parent_order_id"] == entry["client_order_id"] and row["tags"] == "['TAKE_PROFIT']"
    )
    root = (ONE_ROOT if minute_step == 1 else FIVE_ROOT) / coin / "minute"
    catalog = ParquetDataCatalog(str(root))
    instrument_id = entry["instrument_id"]
    instrument = catalog.instruments(instrument_ids=[instrument_id])[0]
    bar_type = BarType.from_str(f"{instrument_id}-{minute_step}-MINUTE-LAST-EXTERNAL")
    end_ns = case["five_minute_end_ns"]
    previous_end = end_ns - FIVE_NS
    bars = sorted(
        (
            bar for bar in catalog.query_bars([instrument_id], start=previous_end, end=end_ns)
            if bar.bar_type == bar_type
        ),
        key=lambda bar: bar.ts_event,
    )
    expected_count = 6 if minute_step == 1 else 2
    if len(bars) != expected_count or bars[0].ts_event != previous_end or bars[-1].ts_event != end_ns:
        raise RuntimeError(f"{coin}: incomplete real {minute_step}m local bars")
    plan = {
        "side": OrderSide.BUY if entry["side"] == "BUY" else OrderSide.SELL,
        "quantity": Quantity.from_str(entry["quantity"]),
        "entry": instrument.make_price(float(Decimal(entry["price"]))),
        "stop": instrument.make_price(float(Decimal(stop["trigger_price"]))),
        "target": instrument.make_price(float(Decimal(target["price"]))),
        "expire_time": int(Decimal(entry["expire_time_ns"])),
    }
    if plan["expire_time"] <= end_ns:
        raise RuntimeError(f"{coin}: original H10 parent expires before local event completes")
    engine = BacktestEngine(
        BacktestEngineConfig(
            trader_id=TraderId("D100-PROBE-001"),
            logging=LoggerConfig(stdout_level=LogLevel.ERROR, print_config=False),
            data_engine=DataEngineConfig(
                time_bars_timestamp_on_close=True,
                time_bars_skip_first_non_full_bar=False,
                validate_data_sequence=True,
            ),
        )
    )
    try:
        engine.add_venue(
            Venue("BINANCE"), OmsType.NETTING, AccountType.MARGIN,
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
        probe = Probe(instrument.id, bar_type, plan)
        engine.add_strategy(probe)
        engine.add_data([
            MarkPriceUpdate(instrument.id, bar.close, bar.ts_event, bar.ts_event)
            for bar in bars
        ])
        engine.add_data(bars)
        engine.run()
        report = engine.generate_orders_report()
        by_id = {str(index): row for index, row in report.iterrows()}
        if len(probe.order_ids) != 3:
            raise RuntimeError("local native bracket not submitted")
        order_states = []
        for order_id in probe.order_ids:
            row = by_id[order_id]
            order_states.append({
                "id": order_id,
                "type": str(row["type"]),
                "status": str(row["status"]),
                "filled_qty": str(row["filled_qty"]),
                "price": str(row.get("price", "")),
                "trigger_price": str(row.get("trigger_price", "")),
            })
        return {
            "resolution_minutes": minute_step,
            "bar_count": len(bars),
            "bar_timestamps_ns": [bar.ts_event for bar in bars],
            "order_states": order_states,
            "events": probe.events,
            "position_count": len(engine.generate_positions_report()),
        }
    finally:
        engine.dispose()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if sha(D100) != D100_SHA:
        raise RuntimeError("D100 frozen case selection changed")
    source = json.loads(D100.read_text())
    old_orders = {row["client_order_id"]: row for row in csv.DictReader((H10 / "orders.csv").open(newline=""))}
    cases = []
    for key in ("first_separated_case", "first_same_minute_case"):
        case = source[key]
        if case is None:
            continue
        cases.append({
            "case_selection": key,
            "source_case": case,
            "five_minute_native": replay(case, 5, old_orders),
            "one_minute_native": replay(case, 1, old_orders),
        })
    result = {
        "schema": "r1-d100-local-native-1m-5m-oto/v1",
        "method": "published Nautilus BacktestEngine local order-event mechanics with actual Catalog bars and frozen H10 order geometry; no shared-account PnL",
        "d100_classification_sha256": D100_SHA,
        "h10_orders_sha256": sha(H10 / "orders.csv"),
        "cases": cases,
        "limits": "The original H10 order was already resting in a shared account; this local probe submits at the previous observed bar with a fresh 100k account. It tests OTO event semantics, not exact annual order inventory or strategy returns.",
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n")


if __name__ == "__main__":
    main()
