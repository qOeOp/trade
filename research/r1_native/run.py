"""
Run R-1u with Nautilus catalog data and native BacktestEngine reports.

The catalog must contain the instrument definition and complete LAST execution bars for
the chosen Binance USDT perpetual interval. This script never derives fills or PnL from
OHLC arrays.

"""

from __future__ import annotations

import argparse
import csv
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
from vibe_trading.model import MarkPriceUpdate
from vibe_trading.model import Money
from vibe_trading.model import OmsType
from vibe_trading.model import PositionAdjustmentType
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


def _snapshot_equity_usdt(snapshot) -> Decimal:
    if snapshot is None or snapshot.is_stale or snapshot.unpriced_instruments:
        raise RuntimeError("native portfolio equity snapshot is missing or stale")
    equity = snapshot.base_currency_equity
    if equity is None or equity.currency.code != "USDT":
        raise RuntimeError("native portfolio snapshot lacks USDT base equity")
    return equity.as_decimal()


def _validate_bars(
    data,
    start: int,
    end: int,
    minute: BarType,
    interval_ns: int,
) -> None:
    if not data:
        raise RuntimeError(f"no {minute} bars in requested catalog interval")
    if any(b.ts_event - a.ts_event != interval_ns for a, b in pairwise(data)):
        raise RuntimeError(
            "minute execution bars contain a gap, duplicate, or wrong timestamp interval",
        )
    if len(data) < 30 * 86_400_000_000_000 // interval_ns:
        raise RuntimeError("R-1 requires at least 30 complete days for signal warmup")
    if data[0].ts_event > start + interval_ns or data[-1].ts_event < end - interval_ns:
        raise RuntimeError("catalog does not cover the full requested interval")


def _validate_funding(rates, start: int, end: int) -> None:
    if not rates:
        raise RuntimeError("no settled funding rates in requested catalog interval")
    eight_hours = 8 * 3_600_000_000_000
    if rates[0].ts_event > start + eight_hours or rates[-1].ts_event < end - eight_hours:
        raise RuntimeError("settled funding rates do not cover the requested interval")
    # Binance's settled funding timestamps can drift a few milliseconds from
    # the nominal eight-hour boundary; preserve the exchange timestamp.
    if any(b.ts_event - a.ts_event > eight_hours + 1_000_000_000 for a, b in pairwise(rates)):
        raise RuntimeError(
            "settled funding rates contain a gap longer than eight hours",
        )
    if any(rate.next_funding_ns != rate.ts_event for rate in rates):
        raise RuntimeError(
            "catalog funding row is not bound to its settlement timestamp",
        )


def main() -> None:  # noqa: C901 - CLI coordinates one frozen native replay lifecycle.
    parser = argparse.ArgumentParser()
    parser.add_argument("--catalog", type=Path, required=True)
    parser.add_argument("--instrument", default="BTCUSDT-PERP.BINANCE")
    parser.add_argument(
        "--start",
        required=True,
        help="Inclusive UTC timestamp, with warmup",
    )
    parser.add_argument("--end", required=True, help="Exclusive UTC timestamp")
    parser.add_argument(
        "--trade-start",
        help="Inclusive UTC trading start; earlier catalog data only warms the strategy",
    )
    parser.add_argument("--quantity", default="0.010")
    parser.add_argument("--bar-minutes", type=int, choices=(1, 5), default=1)
    parser.add_argument(
        "--report-start",
        help="UTC timestamp for a native mark-to-market equity comparison",
    )
    parser.add_argument(
        "--warmup-daily-catalog",
        type=Path,
        help="Native catalog of earlier complete daily LAST bars for long signal history",
    )
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    instrument_id = InstrumentId.from_str(args.instrument)
    if instrument_id.venue != Venue("BINANCE") or not args.instrument.endswith(
        "-PERP.BINANCE",
    ):
        raise ValueError("R-1 replay requires a Binance USDT perpetual instrument")
    minute = BarType.from_str(
        f"{instrument_id}-{args.bar_minutes}-MINUTE-LAST-EXTERNAL",
    )
    mark_minute = BarType.from_str(
        f"{instrument_id}-{args.bar_minutes}-MINUTE-MARK-EXTERNAL",
    )
    daily = BarType.from_str(f"{instrument_id}-1-DAY-LAST-INTERNAL")
    start, end = _ns(args.start), _ns(args.end)
    interval_ns = args.bar_minutes * 60_000_000_000
    if start % interval_ns or end % interval_ns:
        raise ValueError("execution interval must align with bar boundaries")
    if end <= start:
        raise ValueError("end must follow start")
    trade_start = _ns(args.trade_start) if args.trade_start else start
    if not start <= trade_start < end:
        raise ValueError("trade-start must be inside the catalog interval")
    report_start = _ns(args.report_start) if args.report_start else None
    if report_start is not None and not trade_start < report_start < end:
        raise ValueError("report-start must follow trade-start inside the replay")

    catalog = ParquetDataCatalog(str(args.catalog))
    instruments = catalog.instruments(instrument_ids=[str(instrument_id)])
    if len(instruments) != 1:
        raise RuntimeError(
            f"catalog needs exactly one instrument definition for {instrument_id}",
        )
    instrument = instruments[0]
    if instrument.quote_currency.code != "USDT":
        raise ValueError("R-1 replay requires a USDT quote currency")
    all_bars = catalog.query_bars([str(instrument_id)], start=start, end=end)
    data = [bar for bar in all_bars if bar.bar_type == minute]
    data.sort(key=lambda bar: bar.ts_event)
    _validate_bars(data, start, end, minute, interval_ns)
    mark_bars = [bar for bar in all_bars if bar.bar_type == mark_minute]
    del all_bars
    mark_bars.sort(key=lambda bar: bar.ts_event)
    _validate_bars(mark_bars, start, end, mark_minute, interval_ns)
    if [bar.ts_event for bar in mark_bars] != [bar.ts_event for bar in data]:
        raise RuntimeError("mark and execution minutes do not align")
    mark_updates = [
        MarkPriceUpdate(
            instrument_id=instrument_id,
            value=bar.close,
            ts_event=bar.ts_event,
            ts_init=bar.ts_event,
        )
        for bar in mark_bars
    ]
    funding = catalog.query_funding_rate_updates(
        [str(instrument_id)],
        start=start,
        end=end - 1,
    )
    funding.sort(key=lambda rate: rate.ts_event)
    _validate_funding(funding, start, end)
    completion = json.loads((args.catalog / "r1-download-complete.json").read_text())
    if (
        completion.get("instrument"),
        completion.get("start_ns"),
        completion.get("end_ns"),
        completion.get("bar_minutes", 1),
    ) != (
        str(instrument_id),
        start,
        end,
        args.bar_minutes,
    ):
        raise RuntimeError("catalog completion record does not match requested replay")
    if completion.get("counts") != {
        "last": len(data),
        "mark": len(mark_bars),
        "funding": len(funding),
    }:
        raise RuntimeError("catalog contents do not match completed native download")
    assumption = json.loads((args.catalog / "instrument-assumption.json").read_text())
    if assumption.get("historical_terms") != "CURRENT_SNAPSHOT_APPROXIMATION":
        raise RuntimeError("instrument assumption record is missing or unsupported")

    historical_daily_bars = []
    if args.warmup_daily_catalog:
        daily_catalog = ParquetDataCatalog(str(args.warmup_daily_catalog))
        daily_completion = json.loads(
            (args.warmup_daily_catalog / "r1-daily-download-complete.json").read_text(),
        )
        if (
            daily_completion.get("instrument") != str(instrument_id)
            or daily_completion.get("end_ns", 0) < start
        ):
            raise RuntimeError("daily warmup completion does not cover minute start")
        external_daily = BarType.from_str(f"{instrument_id}-1-DAY-LAST-EXTERNAL")
        all_daily_bars = sorted(
            (
                bar
                for bar in daily_catalog.query_bars([str(instrument_id)])
                if bar.bar_type == external_daily
            ),
            key=lambda bar: bar.ts_event,
        )
        if len(all_daily_bars) != daily_completion.get("counts", {}).get("daily"):
            raise RuntimeError(
                "daily warmup catalog does not match its completion record",
            )
        historical_daily_bars = sorted(
            (bar for bar in all_daily_bars if bar.ts_event < start),
            key=lambda bar: bar.ts_event,
        )
        if (
            len(historical_daily_bars) < 200
            or historical_daily_bars[-1].ts_event != start - 1_000_000
            or any(
                b.ts_event - a.ts_event != 86_400_000_000_000
                for a, b in pairwise(historical_daily_bars)
            )
        ):
            raise RuntimeError(
                "daily warmup catalog lacks contiguous long history to minute start",
            )
    historical_daily_count = len(historical_daily_bars)
    historical_daily_digest = hashlib.sha256()
    for bar in historical_daily_bars:
        historical_daily_digest.update(
            f"{bar.ts_event}|{bar.open}|{bar.high}|{bar.low}|{bar.close}\n".encode(),
        )

    engine = BacktestEngine(
        BacktestEngineConfig(
            trader_id=TraderId("R1-REPLAY-001"),
            data_engine=DataEngineConfig(
                time_bars_timestamp_on_close=True,
                time_bars_skip_first_non_full_bar=not bool(historical_daily_count),
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
        # A filled limit entry can gap beyond its protective stop inside a bar.
        # Fill that already-triggered native stop at market rather than leave
        # the position unprotected after a rejected contingent order.
        reject_stop_orders=False,
        bar_execution=True,
        bar_adaptive_high_low_ordering=False,
    )
    engine.add_instrument(instrument)
    streams = (mark_updates, funding, data)
    for stream in streams:
        first = (
            [item for item in stream if item.ts_init < report_start]
            if report_start is not None
            else stream
        )
        engine.add_data(first)
    strategy = R1Strategy(
        instrument_id,
        daily,
        Quantity.from_str(args.quantity),
        trade_start_ns=trade_start,
        historical_daily_bars=historical_daily_bars,
        execution_bar_minutes=args.bar_minutes,
    )
    engine.add_strategy(strategy)
    try:
        window_equity = None
        if report_start is not None:
            # Native streaming keeps the Strategy, account, and orders alive
            # across the reporting boundary. Split the input stream to take
            # exact portfolio snapshots without reconstructing PnL outside
            # Nautilus or starting from an artificial flat account.
            engine.run(streaming=True)
            account = engine.portfolio.account(venue=Venue("BINANCE"))
            if account is None:
                raise RuntimeError("native portfolio account is missing")
            first = engine.portfolio.build_snapshot(account.id)
            first_equity = _snapshot_equity_usdt(first)
            engine.clear_data()
            for stream in streams:
                engine.add_data(
                    [item for item in stream if item.ts_init >= report_start],
                )
            engine.run(streaming=True)
            engine.end()
            last = engine.portfolio.build_snapshot(account.id)
            last_equity = _snapshot_equity_usdt(last)
            window_equity = {
                "report_start_ns": report_start,
                "first_snapshot_ns": first.ts_event,
                "last_snapshot_ns": last.ts_event,
                "first_usdt": str(first_equity),
                "last_usdt": str(last_equity),
                "change_usdt": str(last_equity - first_equity),
            }
        else:
            engine.run()
        account = engine.portfolio.account(venue=Venue("BINANCE"))
        if account is None:
            raise RuntimeError("native portfolio account is missing")
        final_equity = _snapshot_equity_usdt(
            engine.portfolio.build_snapshot(account.id),
        )
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
        with (args.output / "returns_series.csv").open("w", newline="") as stream:
            writer = csv.writer(stream)
            writer.writerow(("ts_event_ns", "native_return"))
            writer.writerows(sorted(result.returns_series.items()))
        # NETTING reuses a position id. Closed lifetimes live in native cache
        # snapshots, while positions() exposes the latest lifetime only.
        position_lifetimes = {
            position.ts_opened: position
            for position in (
                engine.cache.position_snapshots()
                + engine.cache.positions(instrument_id=instrument_id)
            )
            if position.instrument_id == instrument_id
        }
        funding_adjustments = [
            adjustment
            for position in position_lifetimes.values()
            for adjustment in position.adjustments()
            if adjustment.adjustment_type == PositionAdjustmentType.FUNDING
        ]
        funding_applied = sum(
            (
                adjustment.pnl_change.as_decimal()
                for adjustment in funding_adjustments
                if adjustment.pnl_change is not None
            ),
            Decimal(0),
        )
        digest = hashlib.sha256()
        for bar in data:
            digest.update(
                f"{bar.ts_event}|{bar.open}|{bar.high}|{bar.low}|{bar.close}|{bar.volume}\n".encode(),
            )
        mark_digest = hashlib.sha256()
        for bar in mark_bars:
            mark_digest.update(
                f"{bar.ts_event}|{bar.open}|{bar.high}|{bar.low}|{bar.close}\n".encode(),
            )
        funding_digest = hashlib.sha256()
        for rate in funding:
            funding_digest.update(f"{rate.ts_event}|{rate.rate}\n".encode())
        summary = {
            "source_commit": SOURCE_COMMIT,
            "instrument": args.instrument,
            "trade_start_ns": trade_start,
            "trade_end_ns": end,
            "warmup_bars": sum(bar.ts_event < trade_start for bar in data),
            "trade_window_bars": sum(bar.ts_event >= trade_start for bar in data),
            "daily_bars_seen": len(strategy.days),
            "last_daily_ns": strategy.last_daily_ns,
            "historical_daily_warmup_bars": historical_daily_count,
            "historical_daily_warmup_sha256": historical_daily_digest.hexdigest(),
            "bar_type": str(minute),
            "bar_minutes": args.bar_minutes,
            "first_bar_ns": data[0].ts_event,
            "last_bar_ns": data[-1].ts_event,
            "bars": len(data),
            "bar_sha256": digest.hexdigest(),
            "mark_bars": len(mark_bars),
            "mark_bar_sha256": mark_digest.hexdigest(),
            "funding_settlements": len(funding),
            "funding_settlements_in_trade_window": sum(
                rate.ts_event >= trade_start for rate in funding
            ),
            "funding_sha256": funding_digest.hexdigest(),
            "funding_applied_count": len(funding_adjustments),
            "funding_applied_usdt": str(funding_applied),
            "instrument_assumption": assumption,
            "signals": strategy.signals,
            "breaks_in_trade_window": strategy.breaks_in_trade_window,
            "trend_aligned_breaks_in_trade_window": strategy.trend_aligned_breaks_in_trade_window,
            "signals_while_open": strategy.signals_while_open,
            "waiting_voided": strategy.waiting_voided,
            "waiting_released": strategy.waiting_released,
            "orders": result.total_orders,
            "positions": result.total_positions,
            "trade_quantity": args.quantity,
            "maker_fee": str(instrument.maker_fee),
            "taker_fee": str(instrument.taker_fee),
            "bar_execution": True,
            "reject_stop_orders": False,
            "bar_adaptive_high_low_ordering": False,
            "daily_bars_timestamp_on_close": True,
            "stats_returns": result.stats_returns,
            "stats_pnls": result.stats_pnls,
            "stats_general": result.stats_general,
            "window_equity": window_equity,
            "final_equity_usdt": str(final_equity),
            "perpetual_economics": "historical minute mark closes and settled funding bound; historical instrument terms and execution costs remain approximate",
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
