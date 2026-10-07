"""
Replay the prepared R-1 instruments in one native Nautilus account.

The runner streams the already prepared catalogs in UTC calendar-month chunks. Nautilus
owns all orders, fills, margin, funding, portfolio equity and reports.

"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
from datetime import UTC
from datetime import datetime
from datetime import timedelta
from decimal import Decimal
from itertools import pairwise
from pathlib import Path

from r1s_strategy import R1StagedStrategy
from run import SOURCE_COMMIT
from run import _json_safe
from run import _ns
from run import _snapshot_equity_usdt
from strategy import R1Strategy
from trendline_strategy import TrendlineBreakStrategy

from vibe_trading.analysis import MaxDrawdown
from vibe_trading.analysis import SharpeRatio
from vibe_trading.backtest import BacktestEngine
from vibe_trading.backtest import BacktestEngineConfig
from vibe_trading.common import LoggerConfig
from vibe_trading.common import LogLevel
from vibe_trading.data import DataEngineConfig
from vibe_trading.model import AccountType
from vibe_trading.model import BarType
from vibe_trading.model import InstrumentId
from vibe_trading.model import MarkPriceUpdate
from vibe_trading.model import Money
from vibe_trading.model import OmsType
from vibe_trading.model import Quantity
from vibe_trading.model import StrategyId
from vibe_trading.model import TraderId
from vibe_trading.model import Venue
from vibe_trading.persistence import ParquetDataCatalog


LINE_VARIANTS = ("trendline-4h", "line-support-4h", "line-resting-4h")
STAGED_EXITS = ("staged-r1s", "staged-edge-1r")


def _month_edges(start: datetime, end: datetime):
    current = start
    while current < end:
        next_month = (
            current.replace(year=current.year + 1, month=1, day=1)
            if current.month == 12
            else current.replace(month=current.month + 1, day=1)
        )
        edge = min(next_month, end)
        yield current, edge
        current = edge


def _read_instruments(
    root: Path,
    coins: list[str],
    quantities: dict[str, str],
    start: int,
    end: int,
):
    rows = []
    for coin in coins:
        catalog_path = root / coin / "minute"
        catalog = ParquetDataCatalog(str(catalog_path))
        completion = json.loads(
            (catalog_path / "r1-download-complete.json").read_text(),
        )
        if (
            completion.get("start_ns"),
            completion.get("end_ns"),
            completion.get("bar_minutes"),
        ) != (start, end, 5):
            raise RuntimeError(
                f"{coin}: prepared minute interval does not match replay",
            )
        instrument_id = InstrumentId.from_str(completion["instrument"])
        instruments = catalog.instruments(instrument_ids=[str(instrument_id)])
        if len(instruments) != 1 or instruments[0].quote_currency.code != "USDT":
            raise RuntimeError(f"{coin}: one Binance USDT instrument is required")
        assumption = json.loads(
            (catalog_path / "instrument-assumption.json").read_text(),
        )
        if assumption.get("historical_terms") != "CURRENT_SNAPSHOT_APPROXIMATION":
            raise RuntimeError(f"{coin}: missing historical instrument assumption")
        rows.append(
            {
                "coin": coin,
                "catalog": catalog,
                "completion": completion,
                "instrument": instruments[0],
                "instrument_id": instrument_id,
                "quantity": quantities[coin],
                "counts": {"last": 0, "mark": 0, "funding": 0},
                "previous_last": None,
                "previous_mark": None,
                "previous_funding": None,
            },
        )
    return rows


def _warmup(daily_root: Path, row: dict, start: int):
    path = daily_root / row["coin"] / "daily"
    completion = json.loads((path / "r1-daily-download-complete.json").read_text())
    if (
        completion.get("instrument") != str(row["instrument_id"])
        or completion.get("end_ns", 0) < start
    ):
        raise RuntimeError(
            f"{row['coin']}: daily warmup identity does not cover replay",
        )
    catalog = ParquetDataCatalog(str(path))
    bar_type = BarType.from_str(f"{row['instrument_id']}-1-DAY-LAST-EXTERNAL")
    bars = sorted(
        (
            bar
            for bar in catalog.query_bars([str(row["instrument_id"])])
            if bar.bar_type == bar_type and bar.ts_event < start
        ),
        key=lambda bar: bar.ts_event,
    )
    if (
        len(bars) < 200
        or bars[-1].ts_event != start - 1_000_000
        or any(b.ts_event - a.ts_event != 86_400_000_000_000 for a, b in pairwise(bars))
    ):
        raise RuntimeError(f"{row['coin']}: daily warmup is not contiguous")
    return bars


def _add_chunk(engine: BacktestEngine, rows: list[dict], start: int, end: int) -> None:
    interval_ns = 5 * 60_000_000_000
    for row in rows:
        instrument_id = row["instrument_id"]
        all_bars = row["catalog"].query_bars([str(instrument_id)], start=start, end=end)
        last_type = BarType.from_str(f"{instrument_id}-5-MINUTE-LAST-EXTERNAL")
        mark_type = BarType.from_str(f"{instrument_id}-5-MINUTE-MARK-EXTERNAL")
        last = sorted(
            (bar for bar in all_bars if bar.bar_type == last_type),
            key=lambda bar: bar.ts_event,
        )
        mark = sorted(
            (bar for bar in all_bars if bar.bar_type == mark_type),
            key=lambda bar: bar.ts_event,
        )
        del all_bars
        expected = (end - start) // interval_ns
        if (
            len(last) != expected
            or len(mark) != expected
            or last[0].ts_event > start + interval_ns
            or last[-1].ts_event < end - interval_ns
            or [bar.ts_event for bar in last] != [bar.ts_event for bar in mark]
            or any(b.ts_event - a.ts_event != interval_ns for a, b in pairwise(last))
            or (
                row["previous_last"] is not None
                and last[0].ts_event - row["previous_last"] != interval_ns
            )
            or (
                row["previous_mark"] is not None
                and mark[0].ts_event - row["previous_mark"] != interval_ns
            )
        ):
            raise RuntimeError(
                f"{row['coin']}: LAST/MARK five-minute coverage mismatch",
            )
        row["previous_last"] = last[-1].ts_event
        row["previous_mark"] = mark[-1].ts_event
        funding = sorted(
            row["catalog"].query_funding_rate_updates(
                [str(instrument_id)],
                start=start,
                end=end - 1,
            ),
            key=lambda rate: rate.ts_event,
        )
        if not funding or any(rate.next_funding_ns != rate.ts_event for rate in funding):
            raise RuntimeError(f"{row['coin']}: funding settlement coverage missing")
        if (
            row["previous_funding"] is not None
            and funding[0].ts_event - row["previous_funding"]
            > 8 * 3_600_000_000_000 + 1_000_000_000
        ):
            raise RuntimeError(f"{row['coin']}: funding settlement gap")
        row["previous_funding"] = funding[-1].ts_event
        row["counts"]["last"] += len(last)
        row["counts"]["mark"] += len(mark)
        row["counts"]["funding"] += len(funding)
        engine.add_data(
            [
                MarkPriceUpdate(
                    instrument_id=instrument_id,
                    value=bar.close,
                    ts_event=bar.ts_event,
                    ts_init=bar.ts_event,
                )
                for bar in mark
            ],
        )
        engine.add_data(funding)
        engine.add_data(last)


def main() -> None:  # noqa: C901 - CLI coordinates one shared-account replay lifecycle.
    parser = argparse.ArgumentParser()
    parser.add_argument("--catalog-root", type=Path, required=True)
    parser.add_argument("--daily-root", type=Path, required=True)
    parser.add_argument("--quantity-csv", type=Path, required=True)
    parser.add_argument("--coins", nargs="+", required=True)
    parser.add_argument("--start", required=True)
    parser.add_argument("--end", required=True)
    parser.add_argument("--trade-start")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument(
        "--signal-variant",
        choices=("daily-pivot", "box-4h", "box-edge-4h", *LINE_VARIANTS),
        default="daily-pivot",
    )
    parser.add_argument(
        "--exit-variant",
        choices=("fixed-2r", *STAGED_EXITS),
        default="fixed-2r",
    )
    parser.add_argument("--risk-budget-bps", type=float)
    parser.add_argument("--coin-notional-cap-pct", type=float, default=5.0)
    args = parser.parse_args()
    if (args.exit_variant, args.signal_variant) not in (
        ("staged-r1s", "daily-pivot"),
        ("staged-edge-1r", "box-edge-4h"),
    ) and args.exit_variant in STAGED_EXITS:
        raise ValueError("staged exit variant does not match its registered entry signal")
    if args.risk_budget_bps is not None and not 0 < args.risk_budget_bps < 10_000:
        raise ValueError("risk budget bps must be between zero and 10000")
    if not 0 < args.coin_notional_cap_pct <= 100:
        raise ValueError("coin notional cap pct must be between zero and 100")
    start_dt = datetime.fromisoformat(args.start).astimezone(UTC)
    end_dt = datetime.fromisoformat(args.end).astimezone(UTC)
    trade_start_dt = (
        datetime.fromisoformat(args.trade_start).astimezone(UTC)
        if args.trade_start is not None
        else start_dt
    )
    if (
        not start_dt < end_dt
        or not start_dt <= trade_start_dt < end_dt
        or start_dt.minute % 5
        or end_dt.minute % 5
        or trade_start_dt.minute % 5
        or start_dt.second
        or end_dt.second
        or trade_start_dt.second
    ):
        raise ValueError("replay needs a positive five-minute-aligned interval")
    start, end = _ns(args.start), _ns(args.end)
    trade_start = _ns(trade_start_dt.isoformat())
    with args.quantity_csv.open(newline="") as stream:
        quantities = {row["coin"]: row["quantity"] for row in csv.DictReader(stream)}
    if len(args.coins) != len(set(args.coins)) or any(
        coin not in quantities for coin in args.coins
    ):
        raise ValueError("coins must be unique and have registered quantities")
    rows = _read_instruments(args.catalog_root, args.coins, quantities, start, end)
    engine = BacktestEngine(
        BacktestEngineConfig(
            trader_id=TraderId("R1-PORTFOLIO-001"),
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
            venue=Venue("BINANCE"),
            oms_type=OmsType.NETTING,
            account_type=AccountType.MARGIN,
            base_currency=rows[0]["instrument"].quote_currency,
            starting_balances=[Money(100_000, rows[0]["instrument"].quote_currency)],
            default_leverage=Decimal(1),
            support_gtd_orders=True,
            support_contingent_orders=True,
            reject_stop_orders=False,
            bar_execution=True,
            bar_adaptive_high_low_ordering=False,
        )
        strategies = {}
        for row in rows:
            engine.add_instrument(row["instrument"])
            instrument_id = row["instrument_id"]
            strategy_class = (
                R1StagedStrategy
                if args.exit_variant in STAGED_EXITS
                else TrendlineBreakStrategy
                if args.signal_variant in LINE_VARIANTS
                else R1Strategy
            )
            strategy = strategy_class(
                instrument_id,
                BarType.from_str(f"{instrument_id}-1-DAY-LAST-INTERNAL"),
                Quantity.from_str(row["quantity"]),
                trade_start_ns=trade_start,
                historical_daily_bars=(
                    _warmup(args.daily_root, row, start)
                    if args.signal_variant == "daily-pivot"
                    else []
                ),
                execution_bar_minutes=5,
                strategy_id=StrategyId(f"R1-{row['coin']}"),
                signal_variant=args.signal_variant,
                risk_budget_fraction=(
                    args.risk_budget_bps / 10_000 if args.risk_budget_bps is not None else None
                ),
                max_coin_notional_fraction=args.coin_notional_cap_pct / 100,
            )
            engine.add_strategy(strategy)
            strategies[row["coin"]] = strategy
        for begin, edge in _month_edges(start_dt, end_dt):
            engine.clear_data()
            _add_chunk(engine, rows, _ns(begin.isoformat()), _ns(edge.isoformat()))
            engine.run(streaming=True)
            print(
                f"native portfolio replay completed through {edge.isoformat()}",
                flush=True,
            )
        engine.end()
        for row in rows:
            if row["counts"] != row["completion"].get("counts"):
                raise RuntimeError(
                    f"{row['coin']}: streamed totals do not match download receipt",
                )
        integrity_findings = []
        if any(strategy.slot_violations for strategy in strategies.values()):
            integrity_findings.append("native entry fills violated a per-coin slot")
        if args.exit_variant in STAGED_EXITS and any(
            strategy.staged_protection_failures
            or strategy.staged_order_failures
            or strategy.staged_invalid_actual_target_closes
            for strategy in strategies.values()
        ):
            integrity_findings.append("native staged order integrity failed")
        account = engine.portfolio.account(venue=Venue("BINANCE"))
        if account is None:
            raise RuntimeError("native portfolio account missing")
        final_equity = _snapshot_equity_usdt(
            engine.portfolio.build_snapshot(account.id),
        )
        result = engine.get_result()
        args.output.mkdir(parents=True, exist_ok=True)
        reports = {
            "orders.csv": engine.generate_orders_report(),
            "fills.csv": engine.generate_fills_report(),
            "positions.csv": engine.generate_positions_report(),
            "account.csv": engine.generate_account_report(venue=Venue("BINANCE")),
        }
        for name, report in reports.items():
            report.to_csv(
                args.output / name,
                index=True,
                index_label="ts_event" if name == "account.csv" else None,
            )
        with (args.output / "returns_series.csv").open("w", newline="") as stream:
            writer = csv.writer(stream)
            writer.writerow(("ts_event_ns", "native_return"))
            writer.writerows(sorted(result.returns_series.items()))
        positions = reports["positions.csv"]
        orders = reports["orders.csv"]
        if args.exit_variant in STAGED_EXITS and (
            (orders["status"] == "DENIED").any() or (orders["status"] == "REJECTED").any()
        ):
            integrity_findings.append("native staged orders were denied or rejected")
        if args.signal_variant in LINE_VARIANTS and (
            (orders["status"] == "DENIED").any() or (orders["status"] == "REJECTED").any()
        ):
            integrity_findings.append("native line orders were denied or rejected")
        if args.signal_variant == "box-edge-4h" and (
            (orders["status"] == "DENIED").any() or (orders["status"] == "REJECTED").any()
        ):
            integrity_findings.append("native range-edge orders were denied or rejected")
        closed = positions[positions["ts_closed"].notna()]
        pnl = closed["realized_pnl"].astype(str).str.extract(r"(-?[0-9.]+)")[0].astype(float)
        wins = int((pnl > 0).sum())
        duration_days = Decimal(str((end_dt - trade_start_dt) / timedelta(days=1)))
        eligible_returns = {
            ts: value for ts, value in result.returns_series.items() if ts >= trade_start
        }
        summary = {
            "source_commit": SOURCE_COMMIT,
            "strategy_source_sha256": hashlib.sha256(
                Path(__file__).with_name("strategy.py").read_bytes(),
            ).hexdigest(),
            "staged_strategy_source_sha256": (
                hashlib.sha256(Path(__file__).with_name("r1s_strategy.py").read_bytes()).hexdigest()
                if args.exit_variant in STAGED_EXITS
                else None
            ),
            "trendline_strategy_source_sha256": (
                hashlib.sha256(
                    Path(__file__).with_name("trendline_strategy.py").read_bytes(),
                ).hexdigest()
                if args.signal_variant in LINE_VARIANTS
                else None
            ),
            "runner_source_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
            "strategy": (
                "H11-box-edge-staged-1r"
                if args.exit_variant == "staged-edge-1r"
                else "R-1s"
                if args.exit_variant == "staged-r1s"
                else "R-1u"
                if args.signal_variant == "daily-pivot"
                else "H03-box-4h"
                if args.signal_variant == "box-4h"
                else "H10-box-edge-4h"
                if args.signal_variant == "box-edge-4h"
                else "H06-trendline-4h"
                if args.signal_variant == "trendline-4h"
                else "H08b-line-resting-4h"
                if args.signal_variant == "line-resting-4h"
                else "H08-line-support-4h"
            ),
            "signal_variant": args.signal_variant,
            "exit_variant": args.exit_variant,
            "integrity_findings": integrity_findings,
            "integrity_passed": not integrity_findings,
            "account_model": f"one native BacktestEngine margin account, 100000 USDT, {len(rows)} strategies sharing portfolio capital",
            "starting_balance_usdt": "100000",
            "sizing": (
                {
                    "mode": "native_equity_stop_risk_with_notional_cap",
                    "risk_budget_bps": args.risk_budget_bps,
                    "coin_notional_cap_pct": args.coin_notional_cap_pct,
                }
                if args.risk_budget_bps is not None
                else {"mode": "fixed_registered_quantity"}
            ),
            "final_equity_usdt": str(final_equity),
            "net_change_usdt": str(final_equity - Decimal(100_000)),
            "period_return_pct": float((final_equity / Decimal(100_000) - 1) * 100),
            "annualized_return_pct": float(
                ((final_equity / Decimal(100_000)) ** (Decimal(365) / duration_days) - 1) * 100,
            ),
            "closed_trades": len(closed),
            "winning_trades": wins,
            "closed_trade_win_rate": wins / len(closed) if len(closed) else None,
            "win_rate_definition": "positive native closed-position realized_pnl including fill commissions and position funding adjustments",
            "denied_orders": int((orders["status"] == "DENIED").sum()),
            "rejected_orders": int((orders["status"] == "REJECTED").sum()),
            "native_sharpe_252": SharpeRatio(252).calculate_from_returns(
                eligible_returns,
            ),
            "native_sharpe_365": SharpeRatio(365).calculate_from_returns(
                eligible_returns,
            ),
            "native_max_drawdown_daily_close": MaxDrawdown().calculate_from_returns(
                eligible_returns,
            ),
            "stats_returns": result.stats_returns,
            "stats_pnls": result.stats_pnls,
            "stats_general": result.stats_general,
            "data_interval_minutes": 5,
            "input_start_utc": args.start,
            "period_start_utc": trade_start_dt.isoformat(),
            "period_end_utc": args.end,
            "per_coin": [
                {
                    "coin": row["coin"],
                    "instrument": str(row["instrument_id"]),
                    "quantity": row["quantity"],
                    "counts": row["counts"],
                    "signals": strategies[row["coin"]].signals,
                    "box_breaks": strategies[row["coin"]].box_breaks,
                    "box_edge": (
                        {
                            "plans": strategies[row["coin"]].box_edge_plans,
                            "submitted_brackets": strategies[row["coin"]].waiting_released,
                            "invalid_price_skips": strategies[
                                row["coin"]
                            ].box_edge_invalid_price_skips,
                            "time_exits": strategies[row["coin"]].box_edge_time_exits,
                        }
                        if args.signal_variant == "box-edge-4h"
                        else None
                    ),
                    "line_breaks": (
                        {
                            "first_crosses": strategies[row["coin"]].line_state.first_crosses,
                            "weak_crosses": strategies[row["coin"]].line_state.weak_crosses,
                            "invalid_price_skips": strategies[row["coin"]].line_invalid_price_skips,
                            "time_exits": strategies[row["coin"]].line_time_exits,
                        }
                        if args.signal_variant == "trendline-4h"
                        else None
                    ),
                    "line_support": (
                        {
                            "broken_pairs": strategies[row["coin"]].line_state.broken_pairs,
                            "touches": strategies[row["coin"]].line_state.touches,
                            "rejections": strategies[row["coin"]].line_state.rejections,
                            "room_skips": strategies[row["coin"]].line_state.room_skips,
                            "invalid_price_skips": strategies[row["coin"]].line_invalid_price_skips,
                            "time_exits": strategies[row["coin"]].line_time_exits,
                        }
                        if args.signal_variant == "line-support-4h"
                        else None
                    ),
                    "line_resting": (
                        {
                            "broken_pairs": strategies[row["coin"]].line_state.broken_pairs,
                            "room_skips": strategies[row["coin"]].line_state.room_skips,
                            "invalid_price_skips": strategies[row["coin"]].line_invalid_price_skips,
                            "time_exits": strategies[row["coin"]].line_time_exits,
                            "submitted_brackets": strategies[row["coin"]].waiting_released,
                        }
                        if args.signal_variant == "line-resting-4h"
                        else None
                    ),
                    "risk_size_skips": strategies[row["coin"]].risk_size_skips,
                    "staged_execution": (
                        {
                            "missing_impulse": strategies[row["coin"]].staged_missing_impulse,
                            "split_skips": strategies[row["coin"]].staged_split_skips,
                            "invalid_price_skips": strategies[
                                row["coin"]
                            ].staged_invalid_price_skips,
                            "invalid_notional_skips": strategies[
                                row["coin"]
                            ].staged_invalid_notional_skips,
                            "invalid_actual_target_closes": strategies[
                                row["coin"]
                            ].staged_invalid_actual_target_closes,
                            "unallocatable_closes": strategies[
                                row["coin"]
                            ].staged_unallocatable_closes,
                            "protection_failures": strategies[
                                row["coin"]
                            ].staged_protection_failures,
                            "order_failures": strategies[row["coin"]].staged_order_failures,
                            "same_bar_first_stop": strategies[
                                row["coin"]
                            ].staged_same_bar_first_stop,
                        }
                        if args.exit_variant in STAGED_EXITS
                        else None
                    ),
                    "positions": sum(
                        positions["instrument_id"] == str(row["instrument_id"]),
                    ),
                }
                for row in rows
            ],
            "limitations": [
                "Five-minute execution bars cannot resolve every intrabar order sequence",
                "Current contract terms approximate historical metadata",
                "Fixed 2026 coin universe is backcast into 2025",
                "Minute-sampled portfolio drawdown is not yet reported",
            ],
        }
        payload = json.dumps(_json_safe(summary), indent=2, allow_nan=False)
        (args.output / "summary.json").write_text(payload + "\n")
        print(payload)
        if integrity_findings:
            raise RuntimeError("; ".join(integrity_findings))
    finally:
        engine.dispose()


if __name__ == "__main__":
    main()
