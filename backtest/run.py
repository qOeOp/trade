"""Replay one complete strategy over exported market data in one native Nautilus BacktestNode account.

The runner takes four things: the strategy reference, the inputs (one market commit exported per
contract, the contracts and their pool membership), the window and the account. The account and
market facts (balance, leverage, fees, funding, matching) are fixed here; everything else, sizing
included, is the strategy source. ``--describe`` prints the image's runtime identity
and the resolved configuration instead of replaying.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import sys
from dataclasses import dataclass
from decimal import Decimal
from pathlib import Path

from nautilus_trader.backtest import (
    BacktestDataConfig,
    BacktestEngineConfig,
    BacktestNode,
    BacktestRunConfig,
    BacktestVenueConfig,
)
from nautilus_trader.common import DataActor, ImportableActorConfig, LoggerConfig, LogLevel
from nautilus_trader.config import ImportableStrategyConfig
from nautilus_trader.data import DataEngineConfig
from nautilus_trader.model import (
    AccountType,
    BarType,
    BookType,
    Currency,
    InstrumentId,
    OmsType,
    StrategyId,
    TraderId,
)
from nautilus_trader.risk import RiskEngineConfig
from nautilus_trader.trading import Strategy

from backtest import report
from backtest.load import (
    BAR_INTERVAL_NS,
    RUNTIME_CONTRACT,
    LoadedStrategy,
    load_strategy,
    mark_timestamps,
    ns,
    read_market,
    read_pool,
    read_regular_file,
    strategy_id,
    utc_datetime,
    warmup_daily_bars,
)


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


# Arguments

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--describe", action="store_true", help="print the runtime identity and resolved configuration")
    strategy = parser.add_argument_group("strategy reference")
    strategy.add_argument("--strategy-file", type=Path)
    strategy.add_argument("--strategy-class")
    strategy.add_argument("--strategy-sha256")
    strategy.add_argument("--strategy-binding", type=Path)
    strategy.add_argument("--execution-binding", type=Path)
    inputs = parser.add_argument_group("inputs: one market commit exported per contract (research.market.export)")
    inputs.add_argument("--market-root", type=Path, required=True, help="directory of per-contract Catalogs")
    inputs.add_argument("--market-commit", required=True, help="the market database commit they were exported from")
    inputs.add_argument("--pool", type=Path, help="pool membership JSON handed to every strategy")
    inputs.add_argument("--symbols", nargs="+", required=True, help="Binance symbols, e.g. BTCUSDT")
    window = parser.add_argument_group("window")
    window.add_argument("--start", required=True, help="ISO-8601 datetime with explicit Z or UTC offset")
    window.add_argument("--end", required=True, help="ISO-8601 datetime with explicit Z or UTC offset")
    window.add_argument("--trade-start", help="ISO-8601 datetime with explicit Z or UTC offset")
    parser.add_argument("--output", type=Path)
    return parser


def parse_configuration(argv: list[str] | None = None):
    """Resolve runner defaults without executing source or opening research data."""
    parser = build_parser()
    args = parser.parse_args(argv)
    if not args.describe:
        missing = [option for option in ("strategy_file", "strategy_class", "strategy_sha256", "output")
                   if getattr(args, option) is None]
        if missing:
            parser.error("a replay needs " + ", ".join("--" + name.replace("_", "-") for name in missing))
    times = {}
    for field in ("start", "end", "trade_start"):
        value = getattr(args, field)
        if value is None:
            continue
        try:
            times[field] = utc_datetime(value)
        except ValueError as exc:
            parser.error(f"--{field.replace('_', '-')}: {exc}")
    start, end = times["start"], times["end"]
    trade_start = times.get("trade_start", start)
    if (not start < end or not start <= trade_start < end
            or any(value.minute % 5 or value.second or value.microsecond
                   for value in (start, end, trade_start))):
        parser.error("replay needs a positive five-minute-aligned interval with trade-start inside it")
    if len(args.symbols) != len(set(args.symbols)):
        parser.error("--symbols must be unique")
    return args


def effective_configuration(args) -> dict:
    """Canonical experiment configuration, including native execution defaults."""
    return {
        "runtime_contract": RUNTIME_CONTRACT,
        "market_root": str(args.market_root),
        "market_commit": args.market_commit,
        "pool": str(args.pool) if args.pool is not None else None,
        "symbols": args.symbols,
        "start": args.start,
        "end": args.end,
        "trade_start": args.trade_start if args.trade_start is not None else args.start,
        "native_account": ACCOUNT_CONTRACT.copy(),
    }


def _config_sha(value: dict) -> str:
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode()
    return hashlib.sha256(encoded).hexdigest()


def describe(args) -> dict:
    """The executing image's native code and the replay configuration it would resolve."""
    metadata = report.runtime_source_metadata()
    effective = effective_configuration(args)
    return {
        "runtime_contract": RUNTIME_CONTRACT,
        "nautilus_version": importlib.metadata.version("nautilus_trader"),
        "python_version": sys.version.split()[0],
        "dependency_lock_sha256": hashlib.sha256((report.ROOT / "uv.lock").read_bytes()).hexdigest(),
        "source_files_sha256": {key: value for key, value in metadata.items() if key.endswith("_source_sha256")},
        "source_file_paths": metadata["source_file_paths"],
        "audit_source_sha256": hashlib.sha256((report.ROOT / report.AUDIT_PATH).read_bytes()).hexdigest(),
        "effective_config": effective,
        "effective_config_sha256": _config_sha(effective),
    }


def execution_metadata(args) -> dict:
    if args.execution_binding is None:
        return {}
    try:
        binding = json.loads(read_regular_file(args.execution_binding))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError("execution binding is not valid JSON") from error
    if not isinstance(binding, dict) or set(binding) != {
        "runtime_identity", "effective_config", "effective_config_sha256",
    }:
        raise ValueError("execution binding must contain runtime and effective configuration")
    effective = effective_configuration(args)
    digest = _config_sha(effective)
    if binding["effective_config"] != effective or binding["effective_config_sha256"] != digest:
        raise ValueError("execution binding differs from actual resolved runner configuration")
    identity = binding["runtime_identity"]
    if not isinstance(identity, dict) or identity.get("runtime_contract") != RUNTIME_CONTRACT:
        raise ValueError("execution binding runtime contract is unsupported")
    return {"runtime_identity": identity, "effective_config_sha256": digest}


# Node components. BacktestNode builds strategies and actors from importable paths, so the
# instances it creates register themselves here for the report to read.

STRATEGIES: dict[str, Strategy] = {}
OBSERVERS: list = []


@dataclass
class StrategyInputs:
    instrument_id: str
    trade_start_ns: int
    input_start_ns: int
    strategy_id: str
    catalog_path: str
    pool_membership: list


class _Configured:
    """Construct the source's entry class from the runner's inputs; nothing strategy-specific."""

    def __new__(cls, config: StrategyInputs):
        return Strategy.__new__(cls)

    def __init__(self, config: StrategyInputs):
        instrument_id = InstrumentId.from_str(config.instrument_id)
        super().__init__(
            instrument_id,
            BarType.from_str(f"{instrument_id}-1-DAY-LAST-INTERNAL"),
            trade_start_ns=config.trade_start_ns,
            historical_daily_bars=(
                warmup_daily_bars(Path(config.catalog_path), instrument_id, config.input_start_ns)
                if getattr(type(self), "DAILY_WARMUP", False) else []
            ),
            execution_bar_minutes=5,
            strategy_id=StrategyId(config.strategy_id),
            pool_membership=tuple(tuple(interval) for interval in config.pool_membership),
        )
        STRATEGIES[config.instrument_id] = self


def importable_strategy(loaded: LoadedStrategy) -> str:
    """Give ImportableStrategyConfig a path resolving inside this exact process."""
    name = f"NodeExternal_{loaded.source_sha256}_{loaded.entry_class}"
    if name not in globals():
        globals()[name] = type(name, (_Configured, loaded.strategy_class), {"__module__": __name__})
    return f"{__name__}:{name}"


@dataclass
class CapitalObserverConfig:
    instrument_ids: tuple[str, ...]


class CapitalObserver(DataActor):
    """Value the positions held between input bar timestamps.

    The sample labelled with bar timestamp T holds the positions open after every
    event before the next bar timestamp: T's bars and fills, and any fill, expiry
    or funding stamped between the bars. The first MARK of the next timestamp
    shows that point reached; each open position is then valued with the native
    ``Position.notional_value`` and ``Position.unrealized_pnl`` at T's MARK, the
    latest MARK. A position already changed at the next timestamp is reported. The
    runner values the last timestamp with ``finish`` once every component stopped.
    """

    def __new__(cls, config=None):
        return DataActor.__new__(cls)

    def __init__(self, config: CapitalObserverConfig):
        super().__init__(None)
        self.instrument_ids = [InstrumentId.from_str(value) for value in config.instrument_ids]
        self.rows, self.timestamps, self.findings = [], 0, []
        self._ts, self._marks = None, {}
        OBSERVERS.append(self)

    def on_start(self):
        for instrument_id in self.instrument_ids:
            self.subscribe_mark_prices(instrument_id)

    def on_mark_price(self, mark):
        if self._ts is not None and mark.ts_event < self._ts:
            self.findings.append(f"capital observation received MARK {mark.ts_event} after {self._ts}")
            return
        if self._ts is not None and mark.ts_event > self._ts:
            self._value(self._ts, self.cache)
        if self._ts is None or mark.ts_event > self._ts:
            self._ts, self._marks = mark.ts_event, {}
        self._marks[mark.instrument_id] = mark.value

    def finish(self, cache) -> None:
        """Value the last timestamp after strategies stopped, including any closing fills."""
        if self._ts is not None:
            self._value(self._ts, cache)
            self._ts = None

    def _value(self, ts: int, cache) -> None:
        self.timestamps += 1
        for position in cache.positions_open():
            price = self._marks.get(position.instrument_id)
            if price is None or position.ts_last >= ts + BAR_INTERVAL_NS:
                self.findings.append(f"capital observation cannot value {position.instrument_id} at {ts}")
                continue
            self.rows.append((ts, str(position.id), str(position.notional_value(price)),
                              str(position.unrealized_pnl(price))))


class Replay:
    """One finished Node run: its native reports, cache, portfolio, result and observer."""

    def __init__(self, node: BacktestNode, run_id: str, result, observer: CapitalObserver):
        self.node, self.run_id, self.result, self.observer = node, run_id, result, observer
        self.cache = node.get_engine_cache(run_id)
        self.portfolio = node.get_engine_portfolio(run_id)

    def orders(self):
        return self.node.generate_orders_report(self.run_id)

    def fills(self):
        return self.node.generate_fills_report(self.run_id)

    def positions(self):
        return self.node.generate_positions_report(self.run_id)

    def account(self, venue):
        return self.node.generate_account_report(self.run_id, venue=venue)


def replay(rows: list[dict], args, trade_start: int, strategy: LoadedStrategy, pool: dict):
    data = []
    for row in rows:
        instrument_id = row["instrument_id"]
        data.extend([
            BacktestDataConfig(data_type="MarkPriceUpdate", catalog_path=str(row["catalog_path"]),
                               instrument_id=instrument_id),
            BacktestDataConfig(data_type="FundingRateUpdate", catalog_path=str(row["catalog_path"]),
                               instrument_id=instrument_id),
            BacktestDataConfig(data_type="Bar", catalog_path=str(row["catalog_path"]), instrument_id=instrument_id,
                               bar_types=[f"{instrument_id}-5-MINUTE-LAST-EXTERNAL"]),
        ])
    account = ACCOUNT_CONTRACT
    config = BacktestRunConfig(
        venues=[
            BacktestVenueConfig(
                name=account["venue"],
                oms_type=getattr(OmsType, account["oms_type"]),
                account_type=getattr(AccountType, account["account_type"]),
                book_type=getattr(BookType, account["book_type"]),
                base_currency=Currency.from_str(account["base_currency"]),
                starting_balances=[f"{account['starting_balance_usdt']} {account['base_currency']}"],
                default_leverage=Decimal(account["default_leverage"]),
                support_gtd_orders=account["support_gtd_orders"],
                support_contingent_orders=account["support_contingent_orders"],
                reject_stop_orders=account["reject_stop_orders"],
                bar_execution=account["bar_execution"],
                bar_adaptive_high_low_ordering=account["bar_adaptive_high_low_ordering"],
            )
        ],
        data=data,
        engine=BacktestEngineConfig(
            trader_id=TraderId(account["trader_id"]),
            logging=LoggerConfig(stdout_level=LogLevel.ERROR, print_config=False),
            data_engine=DataEngineConfig(
                time_bars_timestamp_on_close=account["time_bars_timestamp_on_close"],
                time_bars_skip_first_non_full_bar=account["time_bars_skip_first_non_full_bar"],
                validate_data_sequence=account["validate_data_sequence"],
            ),
            risk_engine=RiskEngineConfig(max_order_submit_rate=account["max_order_submit_rate"]),
        ),
        chunk_size=account["chunk_size"],
        dispose_on_completion=False,
    )
    node = BacktestNode([config])
    node.build()
    STRATEGIES.clear()
    OBSERVERS.clear()
    strategy_path = importable_strategy(strategy)
    for row in rows:
        node.add_strategy_from_config(
            config.id,
            ImportableStrategyConfig(
                strategy_path=strategy_path,
                config_path=f"{__name__}:StrategyInputs",
                config={
                    "instrument_id": str(row["instrument_id"]),
                    "trade_start_ns": trade_start,
                    "input_start_ns": ns(args.start),
                    "strategy_id": strategy_id(row["symbol"]),
                    "catalog_path": str(row["catalog_path"]),
                    "pool_membership": [list(interval) for interval in pool[row["symbol"]]],
                },
            ),
        )
    node.add_actor_from_config(
        config.id,
        ImportableActorConfig(
            actor_path=f"{__name__}:CapitalObserver",
            config_path=f"{__name__}:CapitalObserverConfig",
            config={"instrument_ids": tuple(str(row["instrument_id"]) for row in rows)},
        ),
    )
    result = node.run()[0]
    expected_iterations = sum(sum(row["counts"].values()) for row in rows)
    if result.iterations != expected_iterations:
        raise RuntimeError(
            f"native data count differs from the export receipts: {result.iterations} != {expected_iterations}",
        )
    strategies = {row["coin"]: STRATEGIES[str(row["instrument_id"])] for row in rows}
    if len(OBSERVERS) != 1:
        raise RuntimeError("native capital observer did not start exactly once")
    finished = Replay(node, config.id, result, OBSERVERS[0])
    finished.observer.finish(finished.cache)
    return finished, strategies


def main(argv: list[str] | None = None) -> None:
    args = parse_configuration(argv)
    if args.describe:
        print(json.dumps(describe(args), sort_keys=True))
        return
    executed = execution_metadata(args)
    strategy = load_strategy(args.strategy_file, args.strategy_class, args.strategy_sha256, args.strategy_binding)
    start_dt, end_dt = utc_datetime(args.start), utc_datetime(args.end)
    trade_start_dt = utc_datetime(args.trade_start) if args.trade_start is not None else start_dt
    start, end = ns(args.start), ns(args.end)
    trade_start = ns(trade_start_dt.isoformat())
    rows = read_market(args.market_root, args.symbols, args.market_commit, start, end)
    pool = read_pool(args.pool, args.symbols)
    finished, strategies = replay(rows, args, trade_start, strategy, pool)
    identity = {
        **strategy.metadata(), **report.runtime_source_metadata(), **executed,
        "market_commit": args.market_commit,
        "strategy": strategy.binding["strategy_id"] if strategy.binding else strategy.entry_class,
    }
    window = {"start": args.start, "end": args.end, "trade_start_dt": trade_start_dt, "end_dt": end_dt,
              "trade_start_ns": trade_start}
    _, findings = report.write(args.output, finished, strategies, rows, identity, window, ACCOUNT_CONTRACT,
                               mark_timestamps(rows))
    if findings:
        raise RuntimeError("; ".join(findings))


if __name__ == "__main__":
    # Run inside the importable module, so the Node finds this process's strategy and observer registries.
    from backtest.run import main as run_main
    run_main()
