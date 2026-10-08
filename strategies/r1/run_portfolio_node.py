"""Native BacktestNode probe for the existing R1 Catalog, including funding."""

from __future__ import annotations

import argparse
import csv
import json
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from pathlib import Path

from nautilus_trader.backtest import (
    BacktestDataConfig,
    BacktestEngineConfig,
    BacktestNode,
    BacktestRunConfig,
    BacktestVenueConfig,
)
from nautilus_trader.analysis import MaxDrawdown, SharpeRatio
from nautilus_trader.common import LoggerConfig, LogLevel
from nautilus_trader.config import ImportableStrategyConfig
from nautilus_trader.data import DataEngineConfig
from nautilus_trader.model import (
    AccountType,
    BarType,
    BookType,
    ClientOrderId,
    Currency,
    MarkPriceUpdate,
    OmsType,
    TraderId,
)
from nautilus_trader.persistence import ParquetDataCatalog
from nautilus_trader.risk import RiskEngineConfig

from replay_util import _ns, _snapshot_equity_usdt
from replay_inputs import month_edges, read_instruments


def _orders_with_native_deadlines(cache, report):
    result = report.copy()
    deadlines = []
    for order_id in report.index:
        order = cache.order(ClientOrderId.from_str(str(order_id)))
        if order is None:
            raise RuntimeError(f"native order missing: {order_id}")
        deadline = getattr(order, "expire_time", None)
        if str(order.time_in_force) == "GTD" and deadline is None:
            raise RuntimeError(f"native GTD deadline missing: {order_id}")
        deadlines.append(str(deadline) if deadline is not None else "")
    result["expire_time_ns"] = deadlines
    return result


def _prepare_mark_catalog(
    row: dict, target: Path, start: datetime, end: datetime
) -> None:
    """Materialize native mark updates from the already downloaded MARK bars."""
    target.mkdir(parents=True, exist_ok=True)
    catalog = ParquetDataCatalog(str(target))
    existing = catalog.query_mark_price_updates([str(row["instrument_id"])])
    mark_type = BarType.from_str(f"{row['instrument_id']}-5-MINUTE-MARK-EXTERNAL")
    if len(existing) == row["completion"]["counts"]["mark"]:
        cached = iter(sorted(existing, key=lambda update: update.ts_event))
        for begin, edge in month_edges(start, end):
            bars = row["catalog"].query_bars(
                [str(row["instrument_id"])],
                start=_ns(begin.isoformat()),
                end=_ns(edge.isoformat()) - 1,
            )
            for bar in sorted(
                (item for item in bars if item.bar_type == mark_type),
                key=lambda item: item.ts_event,
            ):
                update = next(cached, None)
                if (
                    update is None
                    or update.ts_event != bar.ts_event
                    or update.value != bar.close
                ):
                    raise RuntimeError(
                        f"{row['coin']}: cached MARK update differs from source"
                    )
        if next(cached, None) is not None:
            raise RuntimeError(f"{row['coin']}: cached MARK update has extra events")
        print(f"{row['coin']}: reusing {len(existing)} native MARK updates", flush=True)
        return
    if existing:
        raise RuntimeError(
            f"{row['coin']}: partial native MARK catalog: {len(existing)}"
        )
    catalog.write_instruments([row["instrument"]])
    total = 0
    for begin, edge in month_edges(start, end):
        bars = row["catalog"].query_bars(
            [str(row["instrument_id"])],
            start=_ns(begin.isoformat()),
            end=_ns(edge.isoformat()) - 1,
        )
        mark = sorted(
            (bar for bar in bars if bar.bar_type == mark_type),
            key=lambda bar: bar.ts_event,
        )
        if not mark:
            raise RuntimeError(f"{row['coin']}: missing MARK bars")
        catalog.write_mark_price_updates(
            [
                MarkPriceUpdate(
                    instrument_id=row["instrument_id"],
                    value=bar.close,
                    ts_event=bar.ts_event,
                    ts_init=bar.ts_event,
                )
                for bar in mark
            ]
        )
        total += len(mark)
    if total != row["completion"]["counts"]["mark"]:
        raise RuntimeError(f"{row['coin']}: MARK conversion count mismatch: {total}")
    print(f"{row['coin']}: {total} native MARK updates", flush=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--catalog-root", type=Path, required=True)
    parser.add_argument("--quantity-csv", type=Path, required=True)
    parser.add_argument("--coins", nargs="+", required=True)
    parser.add_argument("--start", required=True)
    parser.add_argument("--end", required=True)
    parser.add_argument("--trade-start", required=True)
    parser.add_argument(
        "--signal-variant",
        choices=("support-broad-two-tier-4h", "support-three-tier-line-cancel-4h"),
        default="support-broad-two-tier-4h",
    )
    parser.add_argument("--mark-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    start = datetime.fromisoformat(args.start).astimezone(UTC)
    end = datetime.fromisoformat(args.end).astimezone(UTC)
    with args.quantity_csv.open(newline="") as stream:
        quantities = {row["coin"]: row["quantity"] for row in csv.DictReader(stream)}
    rows = read_instruments(
        args.catalog_root,
        args.coins,
        quantities,
        _ns(start.isoformat()),
        _ns(end.isoformat()),
    )
    data = []
    for row in rows:
        mark_path = args.mark_root / row["coin"]
        _prepare_mark_catalog(row, mark_path, start, end)
        identity = row["instrument_id"]
        data.extend(
            [
                BacktestDataConfig(
                    data_type="MarkPriceUpdate",
                    catalog_path=str(mark_path),
                    instrument_id=identity,
                ),
                BacktestDataConfig(
                    data_type="FundingRateUpdate",
                    catalog_path=str(row["catalog_path"]),
                    instrument_id=identity,
                ),
                BacktestDataConfig(
                    data_type="Bar",
                    catalog_path=str(row["catalog_path"]),
                    instrument_id=identity,
                    bar_types=[f"{identity}-5-MINUTE-LAST-EXTERNAL"],
                ),
            ]
        )
    config = BacktestRunConfig(
        venues=[
            BacktestVenueConfig(
                name="BINANCE",
                oms_type=OmsType.NETTING,
                account_type=AccountType.MARGIN,
                book_type=BookType.L1_MBP,
                base_currency=Currency.from_str("USDT"),
                starting_balances=["100000 USDT"],
                default_leverage=Decimal(1),
                support_gtd_orders=True,
                support_contingent_orders=True,
                reject_stop_orders=False,
                bar_execution=True,
                bar_adaptive_high_low_ordering=False,
            )
        ],
        data=data,
        engine=BacktestEngineConfig(
            trader_id=TraderId("R1-PORTFOLIO-001"),
            logging=LoggerConfig(stdout_level=LogLevel.ERROR, print_config=False),
            data_engine=DataEngineConfig(
                time_bars_timestamp_on_close=True,
                time_bars_skip_first_non_full_bar=False,
                validate_data_sequence=True,
            ),
            risk_engine=RiskEngineConfig(max_order_submit_rate="200/00:00:01"),
        ),
        chunk_size=50_000,
        dispose_on_completion=False,
    )
    node = BacktestNode([config])
    node.build()
    for row in rows:
        node.add_strategy_from_config(
            config.id,
            ImportableStrategyConfig(
                strategy_path="node_strategy:NodeTieredStrategy",
                config_path="node_strategy:NodeTieredConfig",
                config={
                    "instrument_id": str(row["instrument_id"]),
                    "trade_size": row["quantity"],
                    "trade_start_ns": _ns(args.trade_start),
                    "strategy_id": f"R1-{row['coin']}",
                    "signal_variant": args.signal_variant,
                },
            ),
        )
    result = node.run()[0]
    print(f"NODE RESULT {result}", flush=True)
    args.output.mkdir(parents=True, exist_ok=True)
    reports = {
        "orders.csv": _orders_with_native_deadlines(
            node.get_engine_cache(config.id),
            node.generate_orders_report(config.id),
        ),
        "fills.csv": node.generate_fills_report(config.id),
        "positions.csv": node.generate_positions_report(config.id),
        "account.csv": node.generate_account_report(
            config.id,
            venue=rows[0]["instrument_id"].venue,
        ),
    }
    for name, report in reports.items():
        report.to_csv(
            args.output / name,
            index=True,
            index_label="ts_event" if name == "account.csv" else None,
        )
    portfolio = node.get_engine_portfolio(config.id)
    account = portfolio.account(venue=rows[0]["instrument_id"].venue)
    equity = _snapshot_equity_usdt(portfolio.build_snapshot(account.id))
    with (args.output / "returns_series.csv").open("w", newline="") as stream:
        writer = csv.writer(stream)
        writer.writerow(("ts_event_ns", "native_return"))
        writer.writerows(sorted(result.returns_series.items()))
    positions = reports["positions.csv"]
    closed = positions[positions["ts_closed"].notna()]
    pnl = (
        closed["realized_pnl"].astype(str).str.extract(r"(-?[0-9.]+)")[0].astype(float)
    )
    trade_start_ns = _ns(args.trade_start)
    eligible_returns = {
        ts: value for ts, value in result.returns_series.items() if ts >= trade_start_ns
    }
    duration_days = Decimal(
        str(
            (end - datetime.fromisoformat(args.trade_start).astimezone(UTC))
            / timedelta(days=1)
        )
    )
    summary = {
        "input_start_utc": args.start,
        "period_start_utc": args.trade_start,
        "period_end_utc": args.end,
        "coins": args.coins,
        "signal_variant": args.signal_variant,
        "iterations": result.iterations,
        "orders": result.total_orders,
        "fills": len(reports["fills.csv"]),
        "positions": len(positions),
        "closed_trades": len(closed),
        "winning_trades": int((pnl > 0).sum()),
        "final_equity_usdt": str(equity),
        "annualized_return_pct": float(
            ((equity / Decimal(100_000)) ** (Decimal(365) / duration_days) - 1) * 100
        ),
        "native_sharpe_365": SharpeRatio(365).calculate_from_returns(eligible_returns),
        "native_max_drawdown_daily_close": MaxDrawdown().calculate_from_returns(
            eligible_returns
        ),
    }
    (args.output / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(
        f"RESULT iterations={result.iterations} orders={result.total_orders} "
        f"positions={result.total_positions} equity={equity}",
        flush=True,
    )


if __name__ == "__main__":
    main()
