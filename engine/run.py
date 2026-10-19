"""Replay one complete strategy over exported market data in one native Nautilus BacktestNode account.

The runner takes four things: the strategy reference, the inputs (one market commit exported per
contract, the contracts and their pool membership), the window and the account. The account and
market facts (balance, leverage, fees, funding, matching) are fixed in ``engine.config``; everything
else, sizing included, is the strategy source. ``--describe`` prints the image's runtime identity
and the resolved configuration instead of replaying.
"""

from __future__ import annotations

import functools
import json
import os
import traceback
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

from engine import report
from engine.config import (
    ACCOUNT_CONTRACT,
    RUNTIME_CONTRACT,
    config_sha256,
    describe,
    effective_configuration,
    ns,
    parse_configuration,
    utc_datetime,
)
from engine.load import (
    BAR_INTERVAL_NS,
    LoadedStrategy,
    load_strategy,
    mark_timestamps,
    read_market,
    read_pool,
    read_regular_file,
    strategy_id,
    warmup_daily_bars,
)


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
    digest = config_sha256(effective)
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
        try:
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
        except Exception as exc:
            execution_failure("constructor", exc, None)
            raise
        STRATEGIES[config.instrument_id] = self


# Structured runtime failures (engine.execution_failure): a strategy's constructor or callback that
# raises leaves a receipt in the process and in <output>/runtime_failures.jsonl before the exception
# goes on, so a failure the engine catches still fails the run (NATIVE_EXECUTION_FAILED).

FAILURE_FORMAT = "runtime-failure-v1"
FAILURES: list[dict] = []
FAILURE_PATH: Path | None = None  # the receipt file of this process's replay, once main set it
GUARDED_HOOKS = ("replay_diagnostics", "replay_integrity_findings")


def execution_failure(stage: str, exc: BaseException, instance) -> None:
    """Record one constructor or callback exception; never raises itself."""
    try:
        instrument = next((key for key, value in STRATEGIES.items() if value is instance), None)
        receipt = {"format": FAILURE_FORMAT, "stage": stage, "exception_type": type(exc).__name__,
                   "message": str(exc), "traceback": "".join(traceback.format_exception(exc)),
                   "instrument_id": instrument or "unconstructed"}
        FAILURES.append(receipt)
        if FAILURE_PATH is not None:
            with FAILURE_PATH.open("a", encoding="utf-8") as stream:
                stream.write(json.dumps(receipt, ensure_ascii=False, sort_keys=True) + "\n")
                stream.flush()
                os.fsync(stream.fileno())
    except Exception as error:  # the receipt is evidence; failing to write it must not hide the original
        FAILURES.append({"format": FAILURE_FORMAT, "stage": stage, "exception_type": type(exc).__name__,
                         "message": f"{exc} (receipt not written: {error})", "traceback": "",
                         "instrument_id": "unconstructed"})


def guard_callback(name: str, method):
    """The source's callback, recording any exception it raises before raising it unchanged."""
    @functools.wraps(method)
    def guarded(self, *args, **kwargs):
        try:
            return method(self, *args, **kwargs)
        except Exception as exc:
            execution_failure(name, exc, self)
            raise
    return guarded


def guarded_callbacks(strategy_class: type) -> dict:
    """Every on_ callback and report hook the source's classes define, guarded; the most derived wins."""
    found = {}
    for cls in strategy_class.__mro__:
        if cls is Strategy:
            break
        for name, value in vars(cls).items():
            if (name.startswith("on_") or name in GUARDED_HOOKS) and callable(value) and name not in found:
                found[name] = guard_callback(name, value)
    return found


def importable_strategy(loaded: LoadedStrategy) -> str:
    """Give ImportableStrategyConfig a path resolving inside this exact process."""
    name = f"NodeExternal_{loaded.source_sha256}_{loaded.entry_class}"
    if name not in globals():
        globals()[name] = type(name, (_Configured, loaded.strategy_class),
                               {"__module__": __name__, **guarded_callbacks(loaded.strategy_class)})
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
    global FAILURE_PATH
    args = parse_configuration(argv)
    if args.describe:
        print(json.dumps(describe(args), sort_keys=True))
        return
    FAILURES.clear()
    FAILURE_PATH = args.output / "runtime_failures.jsonl"
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
    if FAILURES:
        raise RuntimeError("NATIVE_EXECUTION_FAILED: " + "; ".join(
            f"{item['exception_type']} in {item['stage']} ({item['instrument_id']})" for item in FAILURES))
    if findings:
        raise RuntimeError("INTEGRITY_FINDINGS: " + "; ".join(findings))


if __name__ == "__main__":
    # Run inside the importable module, so the Node finds this process's strategy and observer registries.
    from engine.run import main as run_main
    run_main()
