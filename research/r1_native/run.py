"""
Run R-1u with Nautilus catalog data and native BacktestEngine reports.

The catalog must contain the instrument definition and complete 1-minute LAST bars for
the chosen Binance USDT perpetual interval. This script never derives fills or PnL from
OHLC arrays.

"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from decimal import Decimal
from itertools import pairwise
from pathlib import Path

from strategy import R1Strategy

from vibe_trading.backtest import BacktestEngine
from vibe_trading.backtest import BacktestEngineConfig
from vibe_trading.data import DataEngineConfig
from vibe_trading.model import AccountType
from vibe_trading.model import BarType
from vibe_trading.model import InstrumentId
from vibe_trading.model import Money
from vibe_trading.model import OmsType
from vibe_trading.model import Quantity
from vibe_trading.model import TraderId
from vibe_trading.model import Venue
from vibe_trading.persistence import ParquetDataCatalog


SOURCE_COMMIT = "0725a7b3f89902e27cd421a18b4b879a13268534"


def _json_safe(value):
    if isinstance(value, dict):
        return {key: _json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(item) for item in value]
    if isinstance(value, float) and not math.isfinite(value):
        return None
    return value


def _ns(value: str) -> int:
    from datetime import datetime

    return int(
        datetime.fromisoformat(value).timestamp() * 1_000_000_000,
    )


def _validate_bars(data, start: int, end: int, minute: BarType) -> None:
    if not data:
        raise RuntimeError(f"no {minute} bars in requested catalog interval")
    if any(b.ts_event - a.ts_event != 60_000_000_000 for a, b in pairwise(data)):
        raise RuntimeError(
            "minute execution bars contain a gap, duplicate, or wrong timestamp interval",
        )
    if len(data) < 30 * 1440:
        raise RuntimeError("R-1 requires at least 30 complete days for signal warmup")
    if data[0].ts_event > start + 60_000_000_000 or data[-1].ts_event < end - 60_000_000_000:
        raise RuntimeError("catalog does not cover the full requested interval")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--catalog", type=Path, required=True)
    parser.add_argument("--instrument", default="BTCUSDT-PERP.BINANCE")
    parser.add_argument(
        "--start",
        required=True,
        help="Inclusive UTC timestamp, with warmup",
    )
    parser.add_argument("--end", required=True, help="Exclusive UTC timestamp")
    parser.add_argument("--quantity", default="0.010")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    instrument_id = InstrumentId.from_str(args.instrument)
    if instrument_id.venue != Venue("BINANCE") or not args.instrument.endswith(
        "-PERP.BINANCE",
    ):
        raise ValueError("R-1 replay requires a Binance USDT perpetual instrument")
    minute = BarType.from_str(f"{instrument_id}-1-MINUTE-LAST-EXTERNAL")
    daily = BarType.from_str(f"{instrument_id}-1-DAY-LAST-INTERNAL")
    start, end = _ns(args.start), _ns(args.end)
    if end <= start:
        raise ValueError("end must follow start")

    catalog = ParquetDataCatalog(str(args.catalog))
    instruments = catalog.instruments(instrument_ids=[str(instrument_id)])
    if len(instruments) != 1:
        raise RuntimeError(
            f"catalog needs exactly one instrument definition for {instrument_id}",
        )
    instrument = instruments[0]
    if instrument.quote_currency.code != "USDT":
        raise ValueError("R-1 replay requires a USDT quote currency")
    data = [
        bar
        for bar in catalog.query_bars([str(instrument_id)], start=start, end=end)
        if bar.bar_type == minute
    ]
    data.sort(key=lambda bar: bar.ts_event)
    _validate_bars(data, start, end, minute)

    engine = BacktestEngine(
        BacktestEngineConfig(
            trader_id=TraderId("R1-REPLAY-001"),
            data_engine=DataEngineConfig(
                time_bars_timestamp_on_close=True,
                time_bars_skip_first_non_full_bar=True,
                validate_data_sequence=True,
            ),
        ),
    )
    engine.add_venue(
        venue=Venue("BINANCE"),
        oms_type=OmsType.NETTING,
        account_type=AccountType.MARGIN,
        base_currency=instrument.quote_currency,
        starting_balances=[Money(100_000, instrument.quote_currency)],
        default_leverage=Decimal(1),
        support_gtd_orders=True,
        support_contingent_orders=True,
        bar_execution=True,
        bar_adaptive_high_low_ordering=False,
    )
    engine.add_instrument(instrument)
    engine.add_data(data)
    strategy = R1Strategy(instrument_id, daily, Quantity.from_str(args.quantity))
    engine.add_strategy(strategy)
    try:
        engine.run()
        result = engine.get_result()
        if strategy.slot_violations:
            raise RuntimeError(
                f"native fill events violated R-1 single-position rule {strategy.slot_violations} times",
            )
        args.output.mkdir(parents=True, exist_ok=True)
        reports = {
            "orders.csv": engine.generate_orders_report(),
            "fills.csv": engine.generate_fills_report(),
            "positions.csv": engine.generate_positions_report(),
            "account.csv": engine.generate_account_report(venue=Venue("BINANCE")),
        }
        for name, report in reports.items():
            report.to_csv(args.output / name, index=False)
        digest = hashlib.sha256()
        for bar in data:
            digest.update(
                f"{bar.ts_event}|{bar.open}|{bar.high}|{bar.low}|{bar.close}|{bar.volume}\n".encode(),
            )
        summary = {
            "source_commit": SOURCE_COMMIT,
            "instrument": args.instrument,
            "bar_type": str(minute),
            "first_bar_ns": data[0].ts_event,
            "last_bar_ns": data[-1].ts_event,
            "bars": len(data),
            "bar_sha256": digest.hexdigest(),
            "signals": strategy.signals,
            "signals_while_open": strategy.signals_while_open,
            "waiting_voided": strategy.waiting_voided,
            "waiting_released": strategy.waiting_released,
            "orders": result.total_orders,
            "positions": result.total_positions,
            "trade_quantity": args.quantity,
            "maker_fee": str(instrument.maker_fee),
            "taker_fee": str(instrument.taker_fee),
            "bar_execution": True,
            "bar_adaptive_high_low_ordering": False,
            "daily_bars_timestamp_on_close": True,
            "stats_returns": result.stats_returns,
            "stats_pnls": result.stats_pnls,
            "stats_general": result.stats_general,
            "perpetual_economics": "UNVERIFIED: no historical mark/funding inputs bound by this runner",
        }
        summary_json = json.dumps(
            _json_safe(summary),
            indent=2,
            default=str,
            allow_nan=False,
        )
        (args.output / "summary.json").write_text(summary_json + "\n")
        print(summary_json)
    finally:
        engine.dispose()


if __name__ == "__main__":
    main()
