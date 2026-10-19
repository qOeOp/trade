"""Replay one complete strategy over exported market data in one native Nautilus BacktestNode account.

The runner takes four things: the strategy reference, the inputs (one market commit exported per
contract, the contracts, their universe membership and lifecycle episodes), the window and the
account. Execution is on one-minute bars. The account and
market facts (balance, leverage, fees, funding, matching) are fixed in ``engine.config``; everything
else, sizing included, is the strategy source. ``--describe`` prints the image's runtime identity
and the resolved configuration instead of replaying.
"""

from __future__ import annotations

import functools
import json
import os
import sys
import time
import traceback
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path

from nautilus_trader.backtest import BacktestEngine, BacktestEngineConfig
from nautilus_trader.common import DataActor, ImportableActorConfig, LoggerConfig, LogLevel
from nautilus_trader.config import ImportableStrategyConfig
from nautilus_trader.data import DataEngineConfig
from nautilus_trader.model import (
    AccountType,
    Bar,
    BarType,
    BookType,
    Currency,
    FundingRateUpdate,
    InstrumentClose,
    InstrumentCloseType,
    InstrumentId,
    InstrumentStatus,
    MarkPriceUpdate,
    Money,
    OmsType,
    Price,
    StrategyId,
    TraderId,
    Venue,
)
from nautilus_trader.persistence import DataBackendSession, NautilusDataType
from nautilus_trader.risk import RiskEngineConfig
from nautilus_trader.trading import Strategy

from engine import report
from engine.config import (
    ACCOUNT_CONTRACT,
    EXECUTION_BAR_MINUTES,
    RUNTIME_CONTRACT,
    Refusal,
    Window,
    describe,
    effective_configuration,
    parse_configuration,
)
from engine.load import (
    BAR_INTERVAL_NS,
    LIFECYCLE_COUNTS,
    LoadedStrategy,
    load_strategy,
    mark_timestamps,
    read_market,
    read_regular_file,
    read_universe,
    strategy_id,
    warmup_daily_bars,
)


def execution_metadata(config) -> dict:
    """The execution binding checked against the configuration this runner resolves itself."""
    if config.execution_binding is None:
        return {}
    try:
        binding = json.loads(read_regular_file(config.execution_binding))
    except (UnicodeDecodeError, json.JSONDecodeError, ValueError) as error:
        raise Refusal("EXECUTION_BINDING_MISMATCH", "the execution binding is not valid JSON") from error
    if not isinstance(binding, dict) or set(binding) != {
        "runtime_identity", "effective_config", "effective_config_sha256",
    }:
        raise Refusal("EXECUTION_BINDING_MISMATCH", "the execution binding must hold the runtime and effective "
                                                    "configuration")
    effective = effective_configuration(config)
    if binding["effective_config"] != effective.values or binding["effective_config_sha256"] != effective.digest:
        raise Refusal("EXECUTION_BINDING_MISMATCH", "the execution binding differs from the resolved runner "
                                                    "configuration")
    identity = binding["runtime_identity"]
    if not isinstance(identity, dict) or identity.get("runtime_contract") != RUNTIME_CONTRACT:
        raise Refusal("EXECUTION_BINDING_MISMATCH", "the execution binding names an unsupported runtime contract")
    return {"runtime_identity": identity, "effective_config_sha256": effective.digest}


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
    universe_membership: list


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
                execution_bar_minutes=EXECUTION_BAR_MINUTES,
                strategy_id=StrategyId(config.strategy_id),
                universe_membership=tuple(tuple(interval) for interval in config.universe_membership),
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


# Clock APIs that register a callback, with the callback's position among their arguments
# (nautilus_trader.common.Clock in the pinned version).
CLOCK_CALLBACK_APIS = {"set_timer": 4, "set_timer_ns": 4, "set_time_alert": 2, "set_time_alert_ns": 2,
                       "register_default_handler": 0}


class GuardedClock:
    """The strategy's native clock, with every callback the source registers on it guarded."""

    def __init__(self, clock, instance):
        self._clock, self._instance = clock, instance

    def __getattr__(self, name):
        found = getattr(self._clock, name)
        if name not in CLOCK_CALLBACK_APIS:
            return found
        index = CLOCK_CALLBACK_APIS[name]

        def register(*args, **kwargs):
            if kwargs.get("callback") is not None:
                kwargs["callback"] = self._guard(name, kwargs["callback"])
            elif len(args) > index and args[index] is not None:
                args = (*args[:index], self._guard(name, args[index]), *args[index + 1:])
            return found(*args, **kwargs)
        return register

    def _guard(self, api: str, callback):
        instance, stage = self._instance, f"{api}:{getattr(callback, '__name__', 'callback')}"

        @functools.wraps(callback)
        def guarded(*args, **kwargs):
            try:
                return callback(*args, **kwargs)
            except Exception as exc:
                execution_failure(stage, exc, instance)
                raise
        return guarded


def _guarded_clock(self) -> GuardedClock:
    return GuardedClock(Strategy.clock.__get__(self, type(self)), self)


def guarded_callbacks(strategy_class: type) -> dict:
    """Every on_ callback and report hook the source's classes define, guarded, the most derived winning,
    and a clock whose registered callbacks are guarded too."""
    found = {"clock": property(_guarded_clock)}
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


# Lifecycle episodes (engine.episode_active, engine.episode_membership)

def _termination(episode: dict) -> int | None:
    """The earliest CLOSE status or InstrumentClose (delisting settlement) of an episode."""
    found = [int(event["ts_event"]) for event in episode.get("events") or ()
             if event.get("type") == "InstrumentClose" or event.get("action") == "CLOSE"]
    return min(found) if found else None


def episode_active(episode: dict | None, start_ns: int, end_ns: int) -> bool:
    """engine.episode_active: a lifecycle that intersects the input window gets an instance; missing
    bars never matter. PRE_CLOSE is not a termination: positions opened before it still need closing."""
    if episode is None:
        return True
    end = _termination(episode)
    return episode.get("start_ns", 0) < end_ns and (end is None or end > start_ns)


def episode_membership(intervals: tuple[tuple[int, int], ...], episode: dict | None) -> tuple[tuple[int, int], ...]:
    """engine.episode_membership: membership cut at the listing and at the first PRE_CLOSE, CLOSE or
    settlement; empty intervals are dropped."""
    if episode is None:
        return tuple(intervals)
    low = episode.get("start_ns") or 0
    stops = [int(event["ts_event"]) for event in episode.get("events") or ()
             if event.get("type") == "InstrumentClose" or event.get("action") in ("PRE_CLOSE", "CLOSE")]
    high = min(stops) if stops else None
    found = []
    for start, end in intervals:
        start, end = max(start, low), end if high is None else min(end, high)
        if start < end:
            found.append((start, end))
    return tuple(found)


def resident_bytes() -> int:
    """This process's resident memory (Linux /proc; elsewhere the peak from getrusage)."""
    try:
        with open("/proc/self/statm") as stream:
            return int(stream.read().split()[1]) * os.sysconf("SC_PAGE_SIZE")
    except (OSError, ValueError, IndexError):
        import resource
        peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        return peak if sys.platform == "darwin" else peak * 1024


@dataclass
class CapitalObserverConfig:
    instrument_ids: tuple[str, ...]
    exposure_path: str
    lifecycle_ids: tuple[str, ...] = ()
    progress_seconds: float = 60.0


class CapitalObserver(DataActor):
    """Value the positions held between input bar timestamps, and count the lifecycle events delivered.

    The sample labelled with bar timestamp T holds the positions open after every
    event before the next bar timestamp: T's bars and fills, and any fill, expiry
    or funding stamped between the bars. The first MARK of the next timestamp
    shows that point reached; each open position is then valued with the native
    ``Position.notional_value`` and ``Position.unrealized_pnl`` at T's MARK, the
    latest MARK, and written to the exposure table at once. A position already
    changed at the next timestamp is reported. The runner values the last
    timestamp with ``finish`` once every component stopped. Every
    ``progress_seconds`` of wall time it prints one progress line to standard error.
    """

    def __new__(cls, config=None):
        return DataActor.__new__(cls)

    def __init__(self, config: CapitalObserverConfig):
        super().__init__(None)
        self.instrument_ids = [InstrumentId.from_str(value) for value in config.instrument_ids]
        self.lifecycle_ids = [InstrumentId.from_str(value) for value in config.lifecycle_ids]
        self.timestamps, self.findings, self.marks_seen = 0, [], 0
        self.lifecycle = {str(value): {key: 0 for key in LIFECYCLE_COUNTS} for value in self.lifecycle_ids}
        self._ts, self._marks = None, {}
        self._writer = report.ExposureWriter(Path(config.exposure_path))
        self._progress_seconds, self._started = config.progress_seconds, time.monotonic()
        self._reported = self._started
        OBSERVERS.append(self)

    def on_start(self):
        for instrument_id in self.instrument_ids:
            self.subscribe_mark_prices(instrument_id)
        for instrument_id in self.lifecycle_ids:
            self.subscribe_instrument_status(instrument_id)
            self.subscribe_instrument_close(instrument_id)

    def on_instrument_status(self, status):
        self.lifecycle[str(status.instrument_id)]["instrument_status"] += 1

    def on_instrument_close(self, close):
        self.lifecycle[str(close.instrument_id)]["instrument_close"] += 1

    def on_mark_price(self, mark):
        self.marks_seen += 1
        if self._ts is not None and mark.ts_event < self._ts:
            self.findings.append(f"capital observation received MARK {mark.ts_event} after {self._ts}")
            return
        if self._ts is not None and mark.ts_event > self._ts:
            self._value(self._ts, self.cache)
            self._progress(mark.ts_event)
        if self._ts is None or mark.ts_event > self._ts:
            self._ts, self._marks = mark.ts_event, {}
        self._marks[mark.instrument_id] = mark.value

    def _progress(self, ts: int) -> None:
        now = time.monotonic()
        if now - self._reported < self._progress_seconds:
            return
        self._reported = now
        print(json.dumps({"progress": {"sim_time": datetime.fromtimestamp(ts // 10**9, UTC).isoformat(),
                                       "marks": self.marks_seen, "valued_timestamps": self.timestamps,
                                       "rss_mb": resident_bytes() // 2**20,
                                       "elapsed_s": round(now - self._started)}}), file=sys.stderr, flush=True)

    def finish(self, cache) -> None:
        """Value the last timestamp after strategies stopped, including any closing fills; close the table."""
        if self._ts is not None:
            self._value(self._ts, cache)
            self._ts = None
        self._writer.close()

    def _value(self, ts: int, cache) -> None:
        self.timestamps += 1
        for position in cache.positions_open():
            price = self._marks.get(position.instrument_id)
            if price is None or position.ts_last >= ts + BAR_INTERVAL_NS:
                self.findings.append(f"CAPITAL_VALUATION_GAP: capital observation cannot value "
                                     f"{position.instrument_id} at {ts}")
                continue
            try:
                self._writer.write((ts, str(position.id), str(position.notional_value(price)),
                                    str(position.unrealized_pnl(price))))
            except Exception as exc:
                self.findings.append(f"EXPOSURE_WRITE_FAILED: {type(exc).__name__}: {exc}")
                raise


class Replay:
    """One finished engine run: its native reports, cache, portfolio, result and observer."""

    def __init__(self, engine: BacktestEngine, result, observer: CapitalObserver):
        self.engine, self.result, self.observer = engine, result, observer
        self.cache = engine.cache
        self.portfolio = engine.portfolio

    def orders(self):
        return self.engine.generate_orders_report()

    def fills(self):
        return self.engine.generate_fills_report()

    def positions(self):
        return self.engine.generate_positions_report()

    def account(self, venue):
        return self.engine.generate_account_report(venue=venue)


# The input stream. BacktestNode, given one data configuration per contract and type, loads every
# configuration whole and merge-sorts them before streaming chunks to its engine, so its memory grows
# with the window. The runner streams the same events in the same order straight from the exported
# Parquet files: bars and MARK updates through Nautilus's DataBackendSession, which merges files by
# ts_init, one session per SESSION_WINDOW of time with only the files and rows of that window (a
# session reads ahead in every file it holds); the few funding and lifecycle events read whole. Equal
# ts_init keep the order of the configurations the node would have had, contract by contract MARK,
# funding, bars, status, close. The engine gets the node's chunks: chunk_size events, extended to
# the last event's ts_init, each run up to it.

STREAM_TYPES = ("MarkPriceUpdate", "FundingRateUpdate", "Bar", "InstrumentStatus", "InstrumentClose")
DATA_DIRECTORIES = {"Bar": "bars", "MarkPriceUpdate": "mark_prices", "FundingRateUpdate": "funding_rate_update",
                    "InstrumentStatus": "instrument_status", "InstrumentClose": "instrument_closes"}
RUN_ID = "r1-native-replay"
SESSION_BATCH = 5_000
SESSION_WINDOW_NS = 7 * 86_400 * 10**9


def _files(row: dict, kind: str) -> list[str]:
    root = Path(row["catalog_path"]) / "data" / DATA_DIRECTORIES[kind]
    return [str(path) for path in sorted(root.glob("*/*.parquet"))]


def _small_events(row: dict, kind: str) -> list:
    """The funding, status or close events of one contract, built as the catalog stores them."""
    import pyarrow.parquet as parquet
    found = []
    for path in _files(row, kind):
        table = parquet.read_table(path)
        metadata = {key.decode(): value.decode() for key, value in (table.schema.metadata or {}).items()}
        for item in table.to_pylist():
            if kind == "FundingRateUpdate":
                found.append(FundingRateUpdate(InstrumentId.from_str(item["instrument_id"]), Decimal(item["rate"]),
                                               item["ts_event"], item["ts_init"], item["interval"],
                                               item["next_funding_ns"]))
            elif kind == "InstrumentStatus":
                found.append(InstrumentStatus.from_dict({"type": "InstrumentStatus", **item}))
            else:
                raw = int.from_bytes(item["close_price"], "little", signed=True)
                found.append(InstrumentClose(InstrumentId.from_str(metadata["instrument_id"]),
                                             Price.from_raw(raw, int(metadata["price_precision"])),
                                             InstrumentCloseType(item["close_type"]), item["ts_event"],
                                             item["ts_init"]))
    return found


def _windowed(files: list[tuple], start: int, end: int, batch: int):
    """The bars and MARK updates of [start, end) in ts_init order, one DataBackendSession per window."""
    for low in range(start - start % SESSION_WINDOW_NS, end, SESSION_WINDOW_NS):
        high = low + SESSION_WINDOW_NS
        session, added = DataBackendSession(chunk_size=batch), 0
        for native, table, path, first, last in files:
            if first < high and last >= low:
                session.add_file(native, table, path, f"SELECT * FROM {table} WHERE ts_init >= {low} AND "
                                                      f"ts_init < {high} ORDER BY ts_init")
                added += 1
        if added:
            for chunk in session.to_query_result():
                yield from chunk


def market_events(rows: list[dict], start: int, end: int, batch: int = SESSION_BATCH):
    """Every input event of the replay in BacktestNode's order, streamed (see above); `start` and `end`
    bound the exported events' ts_init."""
    import pyarrow.parquet as parquet
    bars, marks, small, files = {}, {}, [], []
    for index, row in enumerate(rows):
        base = index * len(STREAM_TYPES)
        instrument_id = row["instrument_id"]
        bar_type = BarType.from_str(f"{instrument_id}-{EXECUTION_BAR_MINUTES}-MINUTE-LAST-EXTERNAL")
        bars[bar_type], marks[instrument_id] = base + STREAM_TYPES.index("Bar"), base
        for kind, native in (("Bar", NautilusDataType.Bar), ("MarkPriceUpdate", NautilusDataType.MarkPriceUpdate)):
            for number, path in enumerate(_files(row, kind)):
                if kind == "Bar" and f"/{bar_type}/" not in path:
                    continue  # the daily warm-up bars are the strategy's, never replayed
                column = parquet.read_table(path, columns=["ts_init"])["ts_init"]
                if len(column):
                    files.append((native, f"{kind.lower()}_{index}_{number}", path, column[0].as_py(),
                                  column[-1].as_py()))
        for kind in ("FundingRateUpdate", "InstrumentStatus", "InstrumentClose"):
            order = base + STREAM_TYPES.index(kind)
            small.extend((event.ts_init, order, sequence, event)
                         for sequence, event in enumerate(_small_events(row, kind)))
    small.sort(key=lambda item: item[:3])
    pending = 0

    def flush(group, ts):
        nonlocal pending
        while pending < len(small) and small[pending][0] < ts:
            yield small[pending][3]
            pending += 1
        while pending < len(small) and small[pending][0] == ts:
            group.append((small[pending][1], small[pending][3]))
            pending += 1
        group.sort(key=lambda item: item[0])  # stable: one configuration keeps its own order
        for _, event in group:
            yield event

    group, ts = [], None
    for event in _windowed(files, start, end, batch):
        at = event.ts_init
        if at != ts:
            if group:
                yield from flush(group, ts)
            group, ts = [], at
        group.append((bars[event.bar_type] if type(event) is Bar else marks[event.instrument_id], event))
    if group:
        yield from flush(group, ts)
    while pending < len(small):
        yield small[pending][3]
        pending += 1


def stream(engine: BacktestEngine, events, chunk_size: int) -> int:
    """BacktestNode's streaming run: aligned chunks, each run up to its last ts_init, the last to the end."""
    iterator, consumed = iter(events), 0
    following = next(iterator, None)
    if following is None:
        engine.end()
        return 0
    start = None
    while following is not None:
        chunk = [following]
        following = None
        for event in iterator:
            if len(chunk) < chunk_size or event.ts_init == chunk[-1].ts_init:
                chunk.append(event)
            else:
                following = event
                break
        end = chunk[-1].ts_init if following is not None else None
        engine.add_data(chunk, None, False, True)
        engine.run(start, end, RUN_ID, True)
        engine.clear_data()
        consumed += len(chunk)
        start = end
    engine.end()
    return consumed


def replay(rows: list[dict], window: Window, strategy: LoadedStrategy, universe: dict, output_dir: Path):
    """engine.replay: one venue and engine, each contract's one-minute bars, MARK and funding updates and
    lifecycle events streamed in time order, one strategy instance per contract whose lifecycle
    intersects the window, and exactly one capital observer; afterwards the native result is checked
    against the receipts."""
    active = [row for row in rows if episode_active(row["episode"], window.start_ns, window.end_ns)]
    if not active:
        raise Refusal("NO_ACTIVE_INSTRUMENT", "no contract's lifecycle intersects the input window")
    account = ACCOUNT_CONTRACT
    engine = BacktestEngine(BacktestEngineConfig(
        trader_id=TraderId(account["trader_id"]),
        logging=LoggerConfig(stdout_level=LogLevel.ERROR, print_config=False),
        data_engine=DataEngineConfig(
            time_bars_timestamp_on_close=account["time_bars_timestamp_on_close"],
            time_bars_skip_first_non_full_bar=account["time_bars_skip_first_non_full_bar"],
            validate_data_sequence=account["validate_data_sequence"],
        ),
        risk_engine=RiskEngineConfig(max_order_submit_rate=account["max_order_submit_rate"]),
    ))
    currency = Currency.from_str(account["base_currency"])
    engine.add_venue(
        Venue(account["venue"]), getattr(OmsType, account["oms_type"]), getattr(AccountType, account["account_type"]),
        [Money(Decimal(account["starting_balance_usdt"]), currency)], base_currency=currency,
        default_leverage=Decimal(account["default_leverage"]), book_type=getattr(BookType, account["book_type"]),
        reject_stop_orders=account["reject_stop_orders"], support_gtd_orders=account["support_gtd_orders"],
        support_contingent_orders=account["support_contingent_orders"], bar_execution=account["bar_execution"],
        bar_adaptive_high_low_ordering=account["bar_adaptive_high_low_ordering"])
    for row in rows:
        engine.add_instrument(row["instrument"])
    STRATEGIES.clear()
    OBSERVERS.clear()
    strategy_path = importable_strategy(strategy)
    for row in active:
        episode = row["episode"]
        engine.add_strategy_from_config(ImportableStrategyConfig(
            strategy_path=strategy_path,
            config_path=f"{__name__}:StrategyInputs",
            config={
                "instrument_id": str(row["instrument_id"]),
                "trade_start_ns": window.trade_start_ns,
                "input_start_ns": max(window.start_ns, (episode or {}).get("start_ns") or 0),
                "strategy_id": strategy_id(row["symbol"]),
                "catalog_path": str(row["catalog_path"]),
                "universe_membership": [list(interval) for interval in
                                        episode_membership(universe[row["symbol"]], episode)],
            },
        ))
    engine.add_actor_from_config(ImportableActorConfig(
        actor_path=f"{__name__}:CapitalObserver",
        config_path=f"{__name__}:CapitalObserverConfig",
        config={"instrument_ids": tuple(str(row["instrument_id"]) for row in rows),
                "exposure_path": str(output_dir / report.EXPOSURES),
                "lifecycle_ids": tuple(str(row["instrument_id"]) for row in rows if row["episode"] is not None)},
    ))
    stream(engine, market_events(rows, window.start_ns, window.end_ns), account["chunk_size"])
    result = engine.get_result()
    expected_iterations = sum(sum(value for key, value in row["counts"].items() if key != "daily") for row in rows)
    if result.iterations != expected_iterations:
        raise Refusal("DATA_COUNT_MISMATCH", f"the engine consumed {result.iterations} events, the export receipts "
                                             f"hold {expected_iterations}")
    if len(OBSERVERS) != 1:
        raise Refusal("OBSERVER_COUNT_MISMATCH", "the native capital observer did not start exactly once")
    strategies = {row["coin"]: STRATEGIES.get(str(row["instrument_id"])) for row in rows}
    finished = Replay(engine, result, OBSERVERS[0])
    finished.observer.finish(finished.cache)
    return finished, strategies


def main(argv: list[str] | None = None) -> None:
    """engine.main: replay the candidate and write the native reports; any failure exits nonzero."""
    global FAILURE_PATH
    config = parse_configuration(argv)
    if config.describe:
        print(json.dumps(describe(config), sort_keys=True))
        return
    FAILURES.clear()
    FAILURE_PATH = config.output / "runtime_failures.jsonl"
    executed = execution_metadata(config)
    effective = effective_configuration(config)
    strategy = load_strategy(config.strategy_file, config.strategy_class, config.strategy_sha256,
                             config.strategy_binding)
    window = config.window
    rows = read_market(config.market_root, list(config.symbols), config.market_commit, window.start_ns, window.end_ns)
    universe = read_universe(config.universe_path, list(config.symbols))
    config.output.mkdir(parents=True, exist_ok=True)
    finished, strategies = replay(rows, window, strategy, universe, config.output)
    identity = {
        **strategy.metadata(), **report.runtime_source_metadata(), **executed,
        "effective_config_sha256": effective.digest,
        "market_commit": config.market_commit,
        "strategy": strategy.binding["strategy_id"] if strategy.binding else strategy.entry_class,
    }
    _, findings = report.write(config.output, finished, strategies, rows, identity, window, ACCOUNT_CONTRACT,
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
