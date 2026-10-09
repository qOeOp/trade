"""Run the prepared R1 Catalog through published Nautilus BacktestNode."""

import hashlib
import tempfile
from decimal import Decimal
from itertools import pairwise
from pathlib import Path

from nautilus_trader.backtest import (
    BacktestDataConfig,
    BacktestEngineConfig,
    BacktestNode,
    BacktestRunConfig,
    BacktestVenueConfig,
)
from nautilus_trader.common import LoggerConfig, LogLevel
from nautilus_trader.config import ImportableStrategyConfig
from nautilus_trader.data import DataEngineConfig
from nautilus_trader.model import (
    AccountType,
    BarType,
    BookType,
    Currency,
    MarkPriceUpdate,
    OmsType,
    TraderId,
)
from nautilus_trader.persistence import ParquetDataCatalog
from nautilus_trader.risk import RiskEngineConfig

from backtest.r1.node_strategy import STRATEGIES, register_strategy
from backtest.r1.replay_inputs import month_edges, validate_funding_receipt
from backtest.r1.replay_util import _ns
from backtest.r1.strategy_loader import LoadedStrategy


BAR_INTERVAL_NS = 5 * 60_000_000_000
ACCOUNT_CONTRACT = {
    "venue": "BINANCE",
    "oms_type": "NETTING",
    "account_type": "MARGIN",
    "book_type": "L1_MBP",
    "base_currency": "USDT",
    "starting_balance_usdt": "100000",
    "default_leverage": "1",
    "support_gtd_orders": True,
    "support_contingent_orders": True,
    "reject_stop_orders": False,
    "bar_execution": True,
    "bar_adaptive_high_low_ordering": False,
    "trader_id": "R1-PORTFOLIO-001",
    "time_bars_timestamp_on_close": True,
    "time_bars_skip_first_non_full_bar": False,
    "validate_data_sequence": True,
    "max_order_submit_rate": "200/00:00:01",
    "chunk_size": 50_000,
}


class NodeReports:
    """Expose native Node reports to the existing R1 report writer."""

    def __init__(self, node: BacktestNode, run_id: str, result):
        self.node = node
        self.run_id = run_id
        self.result = result
        self.cache = node.get_engine_cache(run_id)
        self.portfolio = node.get_engine_portfolio(run_id)

    def get_result(self):
        return self.result

    def generate_orders_report(self):
        return self.node.generate_orders_report(self.run_id)

    def generate_fills_report(self):
        return self.node.generate_fills_report(self.run_id)

    def generate_positions_report(self):
        return self.node.generate_positions_report(self.run_id)

    def generate_account_report(self, *, venue):
        return self.node.generate_account_report(self.run_id, venue=venue)


def _mark_root(args) -> Path:
    if args.mark_root is not None:
        return args.mark_root
    identity = f"{args.catalog_root.resolve()}|{args.start}|{args.end}"
    digest = hashlib.sha256(identity.encode()).hexdigest()[:16]
    return Path(tempfile.gettempdir()) / "trade-r1-mark-catalog" / digest


def _prepare_mark_catalog(row: dict, target: Path, start, end) -> None:
    """Validate LAST/MARK coverage and materialize only the needed native type."""
    target.mkdir(parents=True, exist_ok=True)
    catalog = ParquetDataCatalog(str(target))
    existing = sorted(
        catalog.query_mark_price_updates([str(row["instrument_id"])]),
        key=lambda update: update.ts_event,
    )
    expected_total = row["completion"]["counts"]["mark"]
    if existing and len(existing) != expected_total:
        raise RuntimeError(
            f"{row['coin']}: partial native MARK catalog: {len(existing)}"
        )
    if not existing:
        catalog.write_instruments([row["instrument"]])
    last_type = BarType.from_str(f"{row['instrument_id']}-5-MINUTE-LAST-EXTERNAL")
    mark_type = BarType.from_str(f"{row['instrument_id']}-5-MINUTE-MARK-EXTERNAL")
    cached = iter(existing)
    previous_ts = None
    total = 0
    for begin, edge in month_edges(start, end):
        bars = row["catalog"].query_bars(
            [str(row["instrument_id"])],
            start=_ns(begin.isoformat()),
            end=_ns(edge.isoformat()) - 1,
        )
        last = sorted(
            (bar for bar in bars if bar.bar_type == last_type),
            key=lambda bar: bar.ts_event,
        )
        mark = sorted(
            (bar for bar in bars if bar.bar_type == mark_type),
            key=lambda bar: bar.ts_event,
        )
        expected = (_ns(edge.isoformat()) - _ns(begin.isoformat())) // BAR_INTERVAL_NS
        if (
            len(last) != expected
            or len(mark) != expected
            or last[0].ts_event != _ns(begin.isoformat()) + BAR_INTERVAL_NS - 1_000_000
            or last[-1].ts_event != _ns(edge.isoformat()) - 1_000_000
            or [bar.ts_event for bar in last] != [bar.ts_event for bar in mark]
            or any(
                b.ts_event - a.ts_event != BAR_INTERVAL_NS for a, b in pairwise(last)
            )
            or (
                previous_ts is not None
                and last[0].ts_event - previous_ts != BAR_INTERVAL_NS
            )
        ):
            raise RuntimeError(
                f"{row['coin']}: LAST/MARK five-minute coverage mismatch"
            )
        previous_ts = last[-1].ts_event
        if existing:
            for bar in mark:
                update = next(cached, None)
                if (
                    update is None
                    or update.ts_event != bar.ts_event
                    or update.value != bar.close
                ):
                    raise RuntimeError(
                        f"{row['coin']}: cached MARK update differs from source"
                    )
        else:
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
    if total != expected_total or (existing and next(cached, None) is not None):
        raise RuntimeError(f"{row['coin']}: MARK coverage total mismatch")
    print(f"{row['coin']}: validated {total} MARK updates", flush=True)


def run_native_node(
    rows: list[dict], args, start_dt, end_dt, trade_start: int, strategy: LoadedStrategy
):
    mark_root = _mark_root(args)
    data = []
    for row in rows:
        mark_path = mark_root / row["coin"]
        _prepare_mark_catalog(row, mark_path, start_dt, end_dt)
        validate_funding_receipt(row, _ns(args.start), _ns(args.end))
        instrument_id = row["instrument_id"]
        data.extend(
            [
                BacktestDataConfig(
                    data_type="MarkPriceUpdate",
                    catalog_path=str(mark_path),
                    instrument_id=instrument_id,
                ),
                BacktestDataConfig(
                    data_type="FundingRateUpdate",
                    catalog_path=str(row["catalog_path"]),
                    instrument_id=instrument_id,
                ),
                BacktestDataConfig(
                    data_type="Bar",
                    catalog_path=str(row["catalog_path"]),
                    instrument_id=instrument_id,
                    bar_types=[f"{instrument_id}-5-MINUTE-LAST-EXTERNAL"],
                ),
            ]
        )
    config = BacktestRunConfig(
        venues=[
            BacktestVenueConfig(
                name=ACCOUNT_CONTRACT["venue"],
                oms_type=getattr(OmsType, ACCOUNT_CONTRACT["oms_type"]),
                account_type=getattr(AccountType, ACCOUNT_CONTRACT["account_type"]),
                book_type=getattr(BookType, ACCOUNT_CONTRACT["book_type"]),
                base_currency=Currency.from_str(ACCOUNT_CONTRACT["base_currency"]),
                starting_balances=[f"{ACCOUNT_CONTRACT['starting_balance_usdt']} {ACCOUNT_CONTRACT['base_currency']}"],
                default_leverage=Decimal(ACCOUNT_CONTRACT["default_leverage"]),
                support_gtd_orders=ACCOUNT_CONTRACT["support_gtd_orders"],
                support_contingent_orders=ACCOUNT_CONTRACT["support_contingent_orders"],
                reject_stop_orders=ACCOUNT_CONTRACT["reject_stop_orders"],
                bar_execution=ACCOUNT_CONTRACT["bar_execution"],
                bar_adaptive_high_low_ordering=ACCOUNT_CONTRACT["bar_adaptive_high_low_ordering"],
            )
        ],
        data=data,
        engine=BacktestEngineConfig(
            trader_id=TraderId(ACCOUNT_CONTRACT["trader_id"]),
            logging=LoggerConfig(stdout_level=LogLevel.ERROR, print_config=False),
            data_engine=DataEngineConfig(
                time_bars_timestamp_on_close=ACCOUNT_CONTRACT["time_bars_timestamp_on_close"],
                time_bars_skip_first_non_full_bar=ACCOUNT_CONTRACT["time_bars_skip_first_non_full_bar"],
                validate_data_sequence=ACCOUNT_CONTRACT["validate_data_sequence"],
            ),
            risk_engine=RiskEngineConfig(max_order_submit_rate=ACCOUNT_CONTRACT["max_order_submit_rate"]),
        ),
        chunk_size=ACCOUNT_CONTRACT["chunk_size"],
        dispose_on_completion=False,
    )
    node = BacktestNode([config])
    node.build()
    STRATEGIES.clear()
    strategy_path = register_strategy(strategy)
    for row in rows:
        node.add_strategy_from_config(
            config.id,
            ImportableStrategyConfig(
                strategy_path=strategy_path,
                config_path="backtest.r1.node_strategy:NodeStrategyConfig",
                config={
                    "coin": row["coin"],
                    "instrument_id": str(row["instrument_id"]),
                    "trade_size": row["quantity"],
                    "trade_start_ns": trade_start,
                    "input_start_ns": _ns(args.start),
                    "strategy_id": f"R1-{row['coin']}",
                    "signal_variant": args.signal_variant,
                    "daily_root": str(args.daily_root),
                    "daily_warmup": args.daily_warmup,
                    "risk_budget_fraction": (
                        args.risk_budget_bps / 10_000
                        if args.risk_budget_bps is not None
                        else None
                    ),
                    "max_coin_notional_fraction": args.coin_notional_cap_pct / 100,
                },
            ),
        )
    result = node.run()[0]
    expected_iterations = sum(sum(row["completion"]["counts"].values()) for row in rows)
    if result.iterations != expected_iterations:
        raise RuntimeError(
            f"native data count differs from download receipts: {result.iterations} != {expected_iterations}",
        )
    for row in rows:
        row["counts"] = row["completion"]["counts"].copy()
    strategies = {row["coin"]: STRATEGIES[str(row["instrument_id"])] for row in rows}
    return NodeReports(node, config.id, result), strategies
