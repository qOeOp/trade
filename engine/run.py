"""Replay one complete strategy over exported market data in one native Nautilus BacktestEngine account.

The runner takes four things: the strategy reference, the inputs (one market commit exported per
contract, the contracts, their universe membership and lifecycle episodes), the window and the
account. Execution is on one-minute bars. The account and
market facts (balance, leverage, fees, funding, matching) are fixed in ``engine.config``; everything
else, sizing included, is the strategy source. ``--describe`` prints the image's runtime identity
and the resolved configuration instead of replaying.
"""

from __future__ import annotations

import functools
import importlib.metadata
import json
import os
import sys
import time
import traceback
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path
from urllib.parse import unquote

from nautilus_trader.backtest import BacktestEngine, BacktestEngineConfig
from nautilus_trader.common import DataActor, LoggerConfig, LogLevel
from nautilus_trader.data import DataEngineConfig
from nautilus_trader.execution import DefaultFillModel
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
    EXECUTION_BINDING_FIELDS,
    MINUTE_NS,
    RUNTIME_CONTRACT,
    Refusal,
    Window,
    describe,
    key_difference,
    utc_text,
    effective_configuration,
    parse_configuration,
    runtime_source_metadata,
)
from engine.load import (
    BAR_INTERVAL_NS,
    LIFECYCLE_COUNTS,
    LoadedStrategy,
    load_strategy,
    read_market,
    read_regular_file,
    read_universe,
    strategy_metadata,
    terms_approximations,
    warmup_daily_bars,
    warmup_start,
    WARMUP_DAYS,
)


def execution_metadata(config) -> dict:
    """The execution binding checked against the configuration this runner resolves itself."""
    if config.execution_binding is None:
        return {}
    try:
        binding = json.loads(read_regular_file(config.execution_binding))
    except (UnicodeDecodeError, json.JSONDecodeError, ValueError) as error:
        raise Refusal("EXECUTION_BINDING_MISMATCH", f"the execution binding is unreadable or not JSON: {error}") from error
    if not isinstance(binding, dict) or set(binding) != EXECUTION_BINDING_FIELDS:
        found = key_difference(binding, EXECUTION_BINDING_FIELDS) if isinstance(binding, dict) else \
            f"it is a {type(binding).__name__}, not an object"
        raise Refusal("EXECUTION_BINDING_MISMATCH", "the execution binding must hold exactly the runtime and "
                                                    f"effective configuration: {found}")
    effective = effective_configuration(config)
    stated = binding["effective_config"]
    if stated != effective.values or binding["effective_config_sha256"] != effective.digest:
        differing = (sorted(key for key in set(stated) | set(effective.values)
                            if stated.get(key) != effective.values.get(key))
                     if isinstance(stated, dict) else ["effective_config"])
        raise Refusal("EXECUTION_BINDING_MISMATCH", "the execution binding differs from the resolved runner "
                                                    "configuration in " + (", ".join(differing) or
                                                                           "effective_config_sha256"))
    identity = binding["runtime_identity"]
    if not isinstance(identity, dict) or identity.get("runtime_contract") != RUNTIME_CONTRACT:
        named = identity.get("runtime_contract") if isinstance(identity, dict) else None
        raise Refusal("EXECUTION_BINDING_MISMATCH", f"the execution binding names runtime contract {named!r}, the "
                                                    f"runner is {RUNTIME_CONTRACT}")
    return {"runtime_identity": identity, "effective_config_sha256": effective.digest}


# Engine components. Each strategy instance and the capital observer register themselves here, for
# the report to read, however they were built (engine.configure_strategy and engine.capital_observer
# build them; their classes stay importable for a BacktestNode configuration).

STRATEGIES: dict[str, Strategy] = {}
OBSERVERS: list = []
SHUTDOWN: list = []  # reasons of ShutdownSystem requests the sources made


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
        instrument_id = InstrumentId.from_str(config.instrument_id)
        # super() is the source's entry class, which _runner_class combines with this one.
        super().__init__(  # type: ignore[call-arg]
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
        self._replay_input_start_ns = config.input_start_ns
        STRATEGIES[config.instrument_id] = self  # type: ignore[assignment]  # self is a combined Strategy subclass

    def shutdown_system(self, reason=None):
        SHUTDOWN.append(reason)  # the streamed run stops feeding, as BacktestNode does
        return super().shutdown_system(reason)


# Structured runtime failures (engine.execution_failure): a strategy's constructor or callback that
# raises, and any exception that ends main before its verdict, leaves a receipt in the process and in
# <output>/runtime_failures.jsonl before the exception goes on, so a failure the engine catches still
# fails the run (NATIVE_EXECUTION_FAILED). Each distinct (exception type, stage, instance, message) is
# one record with its count and its first traceback, so a callback failing on every bar stays one line.

FAILURE_FORMAT = "runtime-failure-v2"
FAILURES: list[dict] = []  # the records, in order of first occurrence; `count` grows in place
FAILURE_PATH: Path | None = None  # the receipt file of this process's replay, once main set it
GUARDED_HOOKS = ("replay_diagnostics", "replay_integrity_findings")
MAX_FAILURE_RECORDS = 100  # distinct records kept; later new ones are counted in one overflow record
MAX_FAILURE_TEXT = 4000  # characters of a message, and (x 5) of a traceback, a record keeps
OVERFLOW_STAGE = "receipt_overflow"
OVERFLOW_SIGNATURE = (None, OVERFLOW_STAGE, None, None)
_SIGNATURES: dict[tuple, dict] = {}


def _clip(text: str, limit: int) -> str:
    return text if len(text) <= limit else text[:limit] + f"... ({len(text) - limit} more characters)"


def _overflow() -> dict:
    return {"stage": OVERFLOW_STAGE, "exception_type": "various", "instrument_id": "various", "code": None,
            "message": f"failures beyond the first {MAX_FAILURE_RECORDS} distinct records", "traceback": ""}


def _record(signature: tuple, build) -> dict:
    """The record of `signature` (made by `build` the first time), its count raised by one; once
    MAX_FAILURE_RECORDS records exist, a new signature counts in the one overflow record instead."""
    receipt = _SIGNATURES.get(signature)
    if receipt is None and len(_SIGNATURES) >= MAX_FAILURE_RECORDS:
        signature, build = OVERFLOW_SIGNATURE, _overflow
        receipt = _SIGNATURES.get(signature)
    if receipt is None:
        receipt = {"format": FAILURE_FORMAT, **build(), "count": 0}
        _SIGNATURES[signature] = receipt
        FAILURES.append(receipt)
    receipt["count"] += 1
    return receipt


def write_failures() -> None:
    """Replace the receipt file with the current records (written beside it, then renamed into place)."""
    if FAILURE_PATH is None:
        return
    FAILURE_PATH.parent.mkdir(parents=True, exist_ok=True)
    partial = FAILURE_PATH.with_name("." + FAILURE_PATH.name + ".partial")
    with partial.open("w", encoding="utf-8") as stream:
        for receipt in FAILURES:
            stream.write(json.dumps(receipt, ensure_ascii=False, sort_keys=True) + "\n")
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(partial, FAILURE_PATH)


def execution_failure(stage: str, exc: BaseException, instance) -> None:
    """Record one constructor, callback or runner-stage exception; never raises itself.

    The file is rewritten when a record is new and when its count reaches a power of two (and once
    more when main ends), so a runner killed mid-replay leaves every distinct failure and each count
    at least half its true value."""
    kind = type(exc).__name__
    try:
        instrument = next((key for key, value in STRATEGIES.items() if value is instance), None) or "unconstructed"
        message = str(exc)
        receipt = _record((kind, stage, instrument, message), lambda: {
            "stage": stage, "exception_type": kind, "instrument_id": instrument,
            "code": exc.code if isinstance(exc, Refusal) else None, "message": _clip(message, MAX_FAILURE_TEXT),
            "traceback": _clip("".join(traceback.format_exception(exc)), 5 * MAX_FAILURE_TEXT)})
    except Exception as error:  # an exception that cannot even be described still fails the run
        failure = type(error).__name__  # bound here: `error` is unbound once the except clause ends
        receipt = _record((kind, stage, "unconstructed", None), lambda: {
            "stage": stage, "exception_type": kind, "instrument_id": "unconstructed", "code": None,
            "message": f"the exception could not be described: {failure}", "traceback": ""})
    if receipt["count"] & (receipt["count"] - 1):
        return
    try:
        write_failures()
    except Exception as error:  # the receipt is evidence; failing to write it must not hide the original
        note = f" (receipt not written: {error})"
        if not receipt["message"].endswith(note):
            receipt["message"] += note


def clear_failures() -> None:
    FAILURES.clear()
    _SIGNATURES.clear()


# Data callbacks. An instance whose input starts after the replay's (its daily warm-up first holds
# later) gets no data stamped before its input start: the instance starts there.
DATA_CALLBACKS = ("on_bar", "on_mark_price", "on_funding_rate", "on_index_price", "on_quote_tick", "on_trade_tick",
                  "on_instrument_status", "on_instrument_close", "on_data")


def guard_callback(name: str, method):
    """The source's callback, recording any exception it raises before raising it unchanged."""
    data = name in DATA_CALLBACKS

    @functools.wraps(method)
    def guarded(self, *args, **kwargs):
        if data and args and getattr(args[0], "ts_event", None) is not None and \
                args[0].ts_event < getattr(self, "_replay_input_start_ns", 0):
            return None
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


def _runner_class(loaded: LoadedStrategy) -> type:
    """The runner's class around the source's entry class, made once per process under a name holding the
    content hash and entry class, so `engine.run:<name>` resolves inside this exact process."""
    name = f"NodeExternal_{loaded.content_hash}_{loaded.entry_class}"
    if name not in globals():
        globals()[name] = type(name, (_Configured, loaded.strategy_class),
                               {"__module__": __name__, **guarded_callbacks(loaded.strategy_class)})
    return globals()[name]


def configure_strategy(strategy: LoadedStrategy, inputs: StrategyInputs) -> Strategy:
    """engine.configure_strategy: the source's entry class constructed from the runner's inputs alone,
    registered by contract; a constructor that raises leaves a receipt and refuses the replay."""
    try:
        return _runner_class(strategy)(inputs)
    except Exception as exc:
        execution_failure("constructor", exc, None)
        raise Refusal("STRATEGY_CONSTRUCTION_FAILED", f"{inputs.instrument_id}: {type(exc).__name__}: {exc}") from exc


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


# A one-minute hole in a contract's MARK data is valued at its latest MARK up to this age
# (uncalibrated example value); an older MARK leaves the position unvalued (CAPITAL_VALUATION_GAP).
MARK_CARRY_MAX_MINUTES = 60
MARK_CARRY_MAX_NS = MARK_CARRY_MAX_MINUTES * 60 * 10**9


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
    latest MARK, and written to the exposure table at once. A contract without a
    MARK at T (a hole in its one-minute data) is valued at its latest MARK while
    that is at most MARK_CARRY_MAX_MINUTES old; each such hole is kept as one
    interval in ``carried`` (a coverage fact of the summary). A position that
    cannot be valued (an older MARK, none, or a position already changed at the
    next timestamp) is one CAPITAL_VALUATION_GAP finding per contiguous interval.
    The runner values the last timestamp with ``finish`` once every component
    stopped. Every ``progress_seconds`` of wall time it prints one progress line
    to standard error.
    """

    findings: list[str]
    _ts: int | None
    _marks: dict[InstrumentId, Price]
    _latest: dict[InstrumentId, tuple[int, Price]]

    def __new__(cls, config=None):
        return DataActor.__new__(cls)

    def __init__(self, config: CapitalObserverConfig):
        super().__init__(None)
        self.instrument_ids = [InstrumentId.from_str(value) for value in config.instrument_ids]
        self.lifecycle_ids = [InstrumentId.from_str(value) for value in config.lifecycle_ids]
        self.timestamps, self.findings, self.marks_seen = 0, [], 0
        self.lifecycle = {str(value): {key: 0 for key in LIFECYCLE_COUNTS} for value in self.lifecycle_ids}
        self._ts, self._marks, self._latest = None, {}, {}
        self.carried: list[dict] = []
        self._carrying: dict[str, dict] = {}  # instrument -> the open carry interval
        self._gaps: dict[str, dict] = {}  # instrument -> the open valuation-gap interval
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
            self.findings.append(f"CAPITAL_VALUATION_GAP: capital observation received MARK {mark.ts_event} after "
                                 f"{self._ts}")
            return
        if self._ts is not None and mark.ts_event > self._ts:
            self._value(self._ts, self.cache)
            self._progress(mark.ts_event)
        if self._ts is None or mark.ts_event > self._ts:
            self._ts, self._marks = mark.ts_event, {}
        self._marks[mark.instrument_id] = mark.value
        self._latest[mark.instrument_id] = (mark.ts_event, mark.value)

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
        for instrument in list(self._carrying):
            self._close_carry(instrument)
        for instrument in list(self._gaps):
            self._close_gap(instrument)
        self._writer.close()

    def _close_carry(self, instrument: str) -> None:
        self.carried.append(self._carrying.pop(instrument))

    def _close_gap(self, instrument: str) -> None:
        gap = self._gaps.pop(instrument)
        self.findings.append(f"CAPITAL_VALUATION_GAP: capital observation cannot value {instrument} at "
                             f"{gap['labels']} labels from {gap['from_ns']} to {gap['to_ns']} ({gap['why']})")

    def _value(self, ts: int, cache) -> None:
        self.timestamps += 1
        unvalued: dict[str, str]
        carried, unvalued = set(), {}
        for position in cache.positions_open():
            instrument = str(position.instrument_id)
            price = self._marks.get(position.instrument_id)
            why = None
            if price is None:
                latest = self._latest.get(position.instrument_id)
                if latest is not None and ts - latest[0] <= MARK_CARRY_MAX_NS:
                    price = latest[1]
                    carried.add((instrument, latest[0]))
                else:
                    why = f"no MARK within {MARK_CARRY_MAX_MINUTES} minutes"
            if why is None and position.ts_last >= ts + BAR_INTERVAL_NS:
                why = "the position changed before the next timestamp"
            if why is not None:
                unvalued.setdefault(instrument, why)
                continue
            try:
                self._writer.write((ts, str(position.id), str(position.notional_value(price)),
                                    str(position.unrealized_pnl(price)), str(position.realized_pnl)))
            except Exception as exc:
                self.findings.append(f"EXPOSURE_WRITE_FAILED: {type(exc).__name__}: {exc}")
                raise
        for instrument, mark_ns in carried:
            found = self._carrying.get(instrument)
            if found is not None and found["mark_ns"] != mark_ns:
                self._close_carry(instrument)
                found = None
            if found is None:
                self._carrying[instrument] = found = {"instrument_id": instrument, "mark_ns": mark_ns,
                                                      "from_ns": ts, "to_ns": ts, "labels": 0}
            found["to_ns"], found["labels"] = ts, found["labels"] + 1
        for instrument in [key for key in self._carrying if key not in {name for name, _ in carried}]:
            self._close_carry(instrument)
        for instrument, why in unvalued.items():
            gap = self._gaps.setdefault(instrument, {"from_ns": ts, "to_ns": ts, "labels": 0, "why": why})
            gap["to_ns"], gap["labels"] = ts, gap["labels"] + 1
        for instrument in [key for key in self._gaps if key not in unvalued]:
            self._close_gap(instrument)


def capital_observer(instrument_ids: tuple[str, ...], exposure_path: Path,
                     lifecycle_ids: tuple[str, ...] = ()) -> CapitalObserver:
    """engine.capital_observer: the one observer valuing every open position at each input bar timestamp
    into the exposure table, and counting the lifecycle events of `lifecycle_ids`."""
    return CapitalObserver(CapitalObserverConfig(tuple(instrument_ids), str(exposure_path), tuple(lifecycle_ids)))


def capital_findings(observer: CapitalObserver, expected_timestamps: int) -> list[str]:
    """engine.capital_findings: the observation valued every input timestamp and every open position in it."""
    findings = list(dict.fromkeys(observer.findings))
    if observer.timestamps != expected_timestamps:
        findings.append(f"CAPITAL_TIMESTAMP_COUNT_MISMATCH: capital observation valued {observer.timestamps} of "
                        f"{expected_timestamps} input timestamps")
    return findings


def mark_timestamps(rows: list[dict]) -> int:
    """engine.mark_timestamps: distinct MARK update times over every contract, from the exported Parquet
    files' ts_event column. Updates stamped on a minute close (the export's) fill one bitmap over the
    files' minute range; any other stamp is counted exactly on its own."""
    import numpy as np
    import pyarrow.parquet as parquet
    paths = []
    for row in rows:
        found = sorted((Path(row["catalog_path"]) / "data").glob("mark_prices/**/*.parquet"))
        if not found and (row.get("counts") or {}).get("mark"):
            raise Refusal("EXPORT_MARKS_UNREADABLE", f"{row.get('symbol')}: the receipt counts MARK updates but "
                                                     "no MARK file exists")
        paths += found
    columns, low, high = [], None, None
    for path in paths:
        try:
            values = parquet.read_table(path, columns=["ts_event"])["ts_event"].to_numpy().astype(np.int64)
        except Exception as exc:
            raise Refusal("EXPORT_MARKS_UNREADABLE", f"{path}: {type(exc).__name__}: {exc}") from exc
        columns.append(values)
        if len(values):
            low = values.min() if low is None else min(low, values.min())
            high = values.max() if high is None else max(high, values.max())
    if low is None:
        return 0
    base = low - low % MINUTE_NS
    seen = np.zeros((high - base) // MINUTE_NS + 1, dtype=bool)
    other = []
    for values in columns:
        closes = (values + 1_000_000) % MINUTE_NS == 0
        seen[(values[closes] - base) // MINUTE_NS] = True
        if not closes.all():
            other.append(np.unique(values[~closes]))
    return int(seen.sum()) + (len(np.unique(np.concatenate(other))) if other else 0)


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


CLOSE_TYPES = {variant.value: variant for variant in (InstrumentCloseType.END_OF_SESSION,
                                                       InstrumentCloseType.CONTRACT_EXPIRED)}


def _small_events(row: dict, kind: str):
    """The funding, status or close events of one contract, in file order, built one at a time from the
    columns the catalog stores (the exporter writes InstrumentClose.close_type as its uint8 value)."""
    import pyarrow.parquet as parquet
    for path in _files(row, kind):
        table = parquet.read_table(path)
        metadata = {key.decode(): value.decode() for key, value in (table.schema.metadata or {}).items()}
        columns = {name: table.column(name).to_pylist() for name in table.column_names}
        for index in range(table.num_rows):
            item = {name: values[index] for name, values in columns.items()}
            if kind == "FundingRateUpdate":
                yield FundingRateUpdate(InstrumentId.from_str(item["instrument_id"]), Decimal(item["rate"]),
                                        item["ts_event"], item["ts_init"], item["interval"], item["next_funding_ns"])
            elif kind == "InstrumentStatus":
                yield InstrumentStatus.from_dict({"type": "InstrumentStatus", **item})
            else:
                raw = int.from_bytes(item["close_price"], "little", signed=True)
                yield InstrumentClose(InstrumentId.from_str(metadata["instrument_id"]),
                                      Price.from_raw(raw, int(metadata["price_precision"])),
                                      CLOSE_TYPES[item["close_type"]], item["ts_event"], item["ts_init"])


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
                yield from chunk  # type: ignore[misc]  # stubbed Any | None; iteration ends instead of yielding None


def _keyed(events, order: int):
    """(ts_init, configuration order, sequence, event) of one source, lazily."""
    for sequence, event in enumerate(events):
        yield event.ts_init, order, sequence, event


def market_events(rows: list[dict], start: int, end: int, batch: int = SESSION_BATCH):
    """Every input event of the replay in BacktestNode's order, streamed (see above); `start` and `end`
    bound the exported events' ts_init."""
    import heapq
    import pyarrow.parquet as parquet
    bars, marks, small, files = {}, {}, [], []
    for index, row in enumerate(rows):
        base = index * len(STREAM_TYPES)
        instrument_id = row["instrument_id"]
        bar_type = BarType.from_str(f"{instrument_id}-{EXECUTION_BAR_MINUTES}-MINUTE-LAST-EXTERNAL")
        bars[bar_type], marks[instrument_id] = base + STREAM_TYPES.index("Bar"), base
        for kind, native in (("Bar", NautilusDataType.Bar), ("MarkPriceUpdate", NautilusDataType.MarkPriceUpdate)):
            for number, path in enumerate(_files(row, kind)):
                if kind == "Bar" and unquote(Path(path).parent.name) != str(bar_type):
                    continue  # the daily warm-up bars are the strategy's, never replayed (names are %-encoded)
                column = parquet.read_table(path, columns=["ts_init"])["ts_init"]
                if len(column):
                    files.append((native, f"{kind.lower()}_{index}_{number}", path, column[0].as_py(),
                                  column[-1].as_py()))
        for kind in ("FundingRateUpdate", "InstrumentStatus", "InstrumentClose"):
            small.append(_keyed(_small_events(row, kind), base + STREAM_TYPES.index(kind)))
    pending = heapq.merge(*small, key=lambda item: item[:3])  # each source is in file (ts_init) order
    following = next(pending, None)

    def flush(group, ts):
        nonlocal following
        while following is not None and following[0] < ts:
            yield following[3]
            following = next(pending, None)
        while following is not None and following[0] == ts:
            group.append((following[1], following[3]))
            following = next(pending, None)
        group.sort(key=lambda item: item[0])  # stable: one configuration keeps its own order
        for _, event in group:
            yield event

    group: list[tuple[int, object]]
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
    while following is not None:
        yield following[3]
        following = next(pending, None)


def stream(engine: BacktestEngine, events, chunk_size: int) -> int:
    """BacktestNode's streaming run: aligned chunks, each run up to its last ts_init, the last to the end; a
    shutdown a source requested during a chunk ends the feed (the engine already ended the run)."""
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
        if SHUTDOWN:
            return consumed
        start = end
    engine.end()
    return consumed


def plan_instances(rows: list[dict], window: Window, strategy: LoadedStrategy) -> tuple[list[tuple], list[str]]:
    """[(row, input start, trade start)] of the contracts that get an instance, and the limitations.

    A contract gets an instance when its lifecycle intersects the window; its input starts at the
    later of the replay start and its listing. A source declaring DAILY_WARMUP starts each instance
    at the first instant its warm-up holds; a contract where it never holds in the window gets none.
    """
    planned, limitations, waiting = [], [], 0
    for row in rows:
        episode = row["episode"]
        if not episode_active(episode, window.start_ns, window.end_ns):
            continue
        start = max(window.start_ns, (episode or {}).get("start_ns") or 0)
        if strategy.daily_warmup:
            end = min(window.end_ns, _termination(episode) or window.end_ns) if episode else window.end_ns
            found = warmup_start(Path(row["catalog_path"]), row["instrument_id"], start, end)
            if found is None:
                waiting += 1
                limitations.append(f"{row['symbol']}: its daily warm-up ({WARMUP_DAYS} contiguous days) never holds "
                                   "in the window; it has no strategy instance")
                continue
            if found > start:
                limitations.append(f"{row['symbol']}: its daily warm-up first holds at {utc_text(found)}; its "
                                   "strategy instance starts there")
            start = found
        planned.append((row, start, max(window.trade_start_ns, start)))
    if not planned:
        if waiting:
            raise Refusal("WARMUP_INSUFFICIENT", f"no contract's daily warm-up of {WARMUP_DAYS} days holds in the "
                                                 "window")
        raise Refusal("NO_ACTIVE_INSTRUMENT", "no contract's lifecycle intersects the input window")
    return planned, limitations


def fill_model(account) -> DefaultFillModel:
    """engine.fill_model: a fresh native fill model per engine; with probabilities 0 it draws nothing."""
    return DefaultFillModel(prob_fill_on_limit=float(account["prob_fill_on_limit"]),
                            prob_slippage=float(account["prob_slippage"]))


def add_venue(engine: BacktestEngine, account=ACCOUNT_CONTRACT) -> None:
    """engine.add_venue: the one simulated venue with the account and matching terms."""
    currency = Currency.from_str(account["base_currency"])
    engine.add_venue(
        Venue(account["venue"]), getattr(OmsType, account["oms_type"]), getattr(AccountType, account["account_type"]),
        # The pinned Money takes the amount through __float__, as the stub's float says; the value stays a Decimal.
        [Money(Decimal(account["starting_balance_usdt"]), currency)], base_currency=currency,  # type: ignore[arg-type]
        default_leverage=Decimal(account["default_leverage"]), book_type=getattr(BookType, account["book_type"]),
        reject_stop_orders=account["reject_stop_orders"], support_gtd_orders=account["support_gtd_orders"],
        support_contingent_orders=account["support_contingent_orders"], bar_execution=account["bar_execution"],
        bar_adaptive_high_low_ordering=account["bar_adaptive_high_low_ordering"], fill_model=fill_model(account),
        liquidity_consumption=account["liquidity_consumption"], queue_position=account["queue_position"])


def replay(rows: list[dict], window: Window, strategy: LoadedStrategy, pool: dict, output_dir: Path):
    """engine.replay: one venue and engine, each contract's one-minute bars, MARK and funding updates and
    lifecycle events streamed in time order, one strategy instance per contract whose lifecycle (and
    daily warm-up) holds in the window, and exactly one capital observer; afterwards the native result
    is checked against the receipts. Returns (Replay, instances by coin, limitations)."""
    planned, limitations = plan_instances(rows, window, strategy)
    limitations += terms_approximations(rows, window.end_ns)
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
    add_venue(engine, account)
    for row in rows:
        engine.add_instrument(row["instrument"])
    STRATEGIES.clear()
    OBSERVERS.clear()
    SHUTDOWN.clear()
    for row, input_start, trade_start in planned:
        engine.add_strategy(configure_strategy(strategy, StrategyInputs(
            instrument_id=str(row["instrument_id"]),
            trade_start_ns=trade_start,
            input_start_ns=input_start,
            strategy_id=row["strategy_id"],
            catalog_path=str(row["catalog_path"]),
            universe_membership=[[max(low, input_start), high] for low, high in
                                 episode_membership(pool[row["symbol"]], row["episode"]) if high > input_start],
        )))
    engine.add_actor(capital_observer(tuple(str(row["instrument_id"]) for row in rows), output_dir / report.EXPOSURES,
                                      tuple(str(row["instrument_id"]) for row in rows if row["episode"] is not None)))
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
    return finished, strategies, limitations


def main(argv: list[str] | None = None) -> None:
    """engine.main: replay the candidate and write the native reports; any failure exits nonzero.

    An exception that ends a stage before the verdict (the execution binding, loading the strategy,
    reading the inputs, the replay, the reports) is recorded as a runtime failure of that stage, with
    its refusal code, before it goes on."""
    global FAILURE_PATH
    config = parse_configuration(argv)
    if config.describe:
        print(json.dumps(describe(config), sort_keys=True))
        return
    # parse_configuration refuses a replay without these (REPLAY_ARGUMENT_MISSING); only --describe omits them.
    assert config.output is not None and config.strategy_file is not None and config.strategy_class is not None \
        and config.strategy_sha256 is not None
    clear_failures()
    FAILURE_PATH = config.output / "runtime_failures.jsonl"
    stage = "execution_binding"
    try:
        executed = execution_metadata(config)
        effective = effective_configuration(config)
        stage = "load"
        strategy = load_strategy(config.strategy_file, config.strategy_class, config.strategy_sha256)
        stage = "inputs"
        window = config.window
        rows = read_market(config.market_root, list(config.symbols), config.market_commit, window.start_ns,
                           window.end_ns)
        universe = read_universe(config.universe_path, list(config.symbols))
        config.output.mkdir(parents=True, exist_ok=True)
        stage = "replay"
        finished, strategies, limitations = replay(rows, window, strategy, universe, config.output)
        stage = "reports"
        identity = {
            **strategy_metadata(strategy), **runtime_source_metadata(), **executed,
            "effective_config_sha256": effective.digest,
            "engine_version": importlib.metadata.version("nautilus_trader"),
            "market_commit": config.market_commit,
            "strategy": strategy.entry_class,
        }
        _, findings = report.write_native_reports(config.output, finished, strategies, rows, identity, window,
                                                  ACCOUNT_CONTRACT, limitations, mark_timestamps(rows))
    except Exception as exc:
        execution_failure(stage, exc, None)
        raise
    finally:
        try:
            if FAILURES:
                write_failures()  # the final counts
        except Exception as error:  # the failure that ends the run must stay the one raised
            print(f"runtime failure receipts not written: {error}", file=sys.stderr)
    if FAILURES:
        shown = FAILURES[:20]
        raise Refusal("NATIVE_EXECUTION_FAILED", "; ".join(
            f"{item['exception_type']} in {item['stage']} ({item['instrument_id']}) x{item['count']}"
            for item in shown) + (f"; and {len(FAILURES) - 20} more records" if len(FAILURES) > 20 else ""))
    if findings:
        raise Refusal("INTEGRITY_FINDINGS", "; ".join(findings[:20]) + (f"; and {len(findings) - 20} more"
                                                                         if len(findings) > 20 else ""))


if __name__ == "__main__":
    # Run inside the importable module, so the Node finds this process's strategy and observer registries.
    from engine.run import main as run_main
    run_main()
