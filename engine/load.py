"""Load what one replay needs: the verified strategy source, the exported market inputs, universe
membership and daily warm-up, and the lifecycle events checked against the coverage receipt."""

from __future__ import annotations

import hashlib
import importlib.util
import inspect
import json
import os
import re
import stat
import sys
from dataclasses import dataclass
from pathlib import Path
from types import ModuleType

from nautilus_trader.model import BarType, InstrumentId
from nautilus_trader.persistence import ParquetDataCatalog
from nautilus_trader.trading import Strategy

from engine.config import EXECUTION_BAR_MINUTES, MINUTE_NS, RUNTIME_CONTRACT, Refusal, parse_window


BAR_INTERVAL_NS = EXECUTION_BAR_MINUTES * MINUTE_NS
TIMEFRAME = f"{EXECUTION_BAR_MINUTES}m"
LIFECYCLE_COUNTS = ("instrument_close", "instrument_status")
COVERAGE_FORMAT = "execution-input-coverage-v1"
_SHA256 = re.compile(r"[0-9a-f]{64}\Z")


# Strategy

@dataclass(frozen=True)
class LoadedStrategy:
    source_path: Path
    source_sha256: str
    entry_class: str
    strategy_class: type[Strategy]
    binding: dict | None
    uses_stop_loss: bool = True
    daily_warmup: bool = False

    def metadata(self) -> dict:
        """engine.strategy_metadata: the run identity of the verified source and its two declarations."""
        identity = {
            "source_sha256": self.source_sha256,
            "strategy_entry_class": self.entry_class,
            "strategy_runtime_contract": RUNTIME_CONTRACT,
            "strategy_uses_stop_loss": self.uses_stop_loss,
            "strategy_daily_warmup": self.daily_warmup,
            "strategy_source": {
                "path": str(self.source_path),
                "sha256": self.source_sha256,
                "entry_class": self.entry_class,
            },
        }
        if self.binding is not None:
            identity["strategy_binding"] = self.binding.copy()
        return identity


def read_regular_file(path: Path) -> bytes:
    """Read through one descriptor; never follow a symlink at the file boundary."""
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    try:
        if not stat.S_ISREG(path.lstat().st_mode):
            raise ValueError(f"strategy source must be a regular file: {path}")
        descriptor = os.open(path, flags)
    except OSError as error:
        raise ValueError(f"cannot read strategy source: {path}: {error}") from error
    with os.fdopen(descriptor, "rb") as stream:
        if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
            raise ValueError(f"strategy source must be a regular file: {path}")
        return stream.read()


def _binding(path: Path | None, source_sha256: str, entry_class: str) -> dict | None:
    if path is None:
        return None
    try:
        value = json.loads(read_regular_file(path))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError(f"strategy binding is not valid JSON: {path}") from error
    required = {
        "database", "commit", "strategy_id", "revision", "source_sha256",
        "entry_class", "runtime_contract",
    }
    if not isinstance(value, dict) or set(value) != required:
        raise ValueError("strategy binding must contain the exact Dolt revision identity")
    for field in required - {"revision"}:
        if not isinstance(value[field], str) or not value[field].strip():
            raise ValueError(f"strategy binding has no valid {field}")
    if type(value["revision"]) is not int or value["revision"] < 1:
        raise ValueError("strategy binding revision must be a positive integer")
    if value["source_sha256"] != source_sha256:
        raise ValueError("strategy binding source hash differs from verified bytes")
    if value["entry_class"] != entry_class:
        raise ValueError("strategy binding entry class differs from selected class")
    if value["runtime_contract"] != RUNTIME_CONTRACT:
        raise ValueError("strategy binding runtime contract is unsupported")
    return value


def load_strategy(
    path: Path,
    entry_class: str,
    expected_sha256: str,
    binding_path: Path | None = None,
) -> LoadedStrategy:
    """Execute exactly hash-checked source bytes and resolve a native class.

    This verifies identity, not safety of arbitrary Python. The invoking sandbox
    or fixed runtime image supplies the execution boundary.
    """
    if not isinstance(expected_sha256, str) or not _SHA256.fullmatch(expected_sha256):
        raise ValueError("strategy SHA-256 must be 64 lowercase hexadecimal characters")
    if not entry_class.isidentifier():
        raise ValueError("strategy class must be one Python class name")
    source = read_regular_file(path)
    actual_sha256 = hashlib.sha256(source).hexdigest()
    if actual_sha256 != expected_sha256:
        raise ValueError("strategy SHA-256 differs from the published source")
    binding = _binding(binding_path, actual_sha256, entry_class)
    source_path = path.resolve()
    module_name = f"_trade_strategy_{actual_sha256}"
    module = sys.modules.get(module_name)
    if module is None:
        module = ModuleType(module_name)
        module.__file__ = str(source_path)
        module.__package__ = ""
        module.__spec__ = importlib.util.spec_from_loader(module_name, loader=None)
        sys.modules[module_name] = module
        try:
            exec(compile(source, str(source_path), "exec"), module.__dict__)
        except BaseException:
            sys.modules.pop(module_name, None)
            raise
    strategy_class = getattr(module, entry_class, None)
    if (
        not inspect.isclass(strategy_class)
        or strategy_class is Strategy
        or not issubclass(strategy_class, Strategy)
        or strategy_class.__module__ != module_name
    ):
        raise ValueError("strategy entry class must be declared here and extend native Strategy")
    for name in ("replay_diagnostics", "replay_integrity_findings"):
        if not callable(getattr(strategy_class, name, None)):
            raise ValueError(f"{RUNTIME_CONTRACT} strategy requires {name}")
    if type(getattr(strategy_class, "DAILY_WARMUP", False)) is not bool:
        raise ValueError("strategy DAILY_WARMUP must be True or False")
    if type(getattr(strategy_class, "USES_STOP_LOSS", True)) is not bool:
        raise ValueError("strategy USES_STOP_LOSS must be True or False")
    return LoadedStrategy(source_path, actual_sha256, entry_class, strategy_class, binding,
                          getattr(strategy_class, "USES_STOP_LOSS", True), getattr(strategy_class, "DAILY_WARMUP", False))


# Inputs: a market commit exported as one Catalog per contract (market/export.py)

def coin(symbol: str) -> str:
    """The contract's short name: BTCUSDT -> BTC, 1000PEPEUSDT -> PEPE (a leading 1000 before letters)."""
    base = symbol.removesuffix("USDT")
    return base[4:] if base.startswith("1000") and base[4:5].isalpha() else base


def strategy_id(symbol: str) -> str:
    """Nautilus identifiers are ASCII; a non-ASCII coin is spelled by its UTF-8 bytes."""
    name = coin(symbol)
    return f"R1-{name}" if name.isascii() else "R1-X" + name.encode().hex().upper()


def read_universe(path: Path | None, symbols: list[str]) -> dict[str, tuple[tuple[int, int], ...]]:
    """engine.read_universe: each contract's membership as [start_ns, end_ns) intervals (empty without a file)."""
    if path is None:
        return {symbol: () for symbol in symbols}
    try:
        value = json.loads(read_regular_file(path))
        if not isinstance(value, dict) or not isinstance(value.get("membership"), dict):
            raise ValueError("the file holds no membership object")
        found = {}
        for symbol in symbols:
            intervals = value["membership"].get(symbol, [])
            if not isinstance(intervals, list) or any(
                    not isinstance(pair, list) or len(pair) != 2 or any(type(item) is not int for item in pair)
                    for pair in intervals):
                raise ValueError(f"the membership of {symbol} is not a list of integer pairs")
            found[symbol] = tuple((a, b) for a, b in intervals)
        return found
    except (ValueError, UnicodeDecodeError) as exc:
        raise Refusal("UNIVERSE_FILE_INVALID", f"{path}: {exc}") from exc


def read_market(root: Path, symbols: list[str], commit: str, start: int, end: int):
    """engine.read_market: each contract's export receipt checked against the commit, the window and the
    one-minute timeframe, and its Catalog's one instrument."""
    rows = []
    for symbol in symbols:
        path = root / symbol
        receipt = json.loads((path / "export.json").read_text())
        if ((receipt.get("commit"), receipt.get("start_ns"), receipt.get("end_ns"), receipt.get("timeframe"))
                != (commit, start, end, TIMEFRAME)):
            raise Refusal("MARKET_RECEIPT_MISMATCH", f"{symbol}: the export is not commit {commit} over the replay "
                                                     f"window in {TIMEFRAME} bars")
        if receipt.get("historical_terms") != "CURRENT_SNAPSHOT_APPROXIMATION":
            raise Refusal("TERMS_APPROXIMATION_MISSING", f"{symbol}: the receipt has no historical-terms mark")
        instrument_id = InstrumentId.from_str(receipt["instrument_id"])
        instruments = ParquetDataCatalog(str(path)).instruments(instrument_ids=[str(instrument_id)])
        if len(instruments) != 1 or instruments[0].quote_currency.code != "USDT":
            raise Refusal("INSTRUMENT_NOT_UNIQUE", f"{symbol}: one Binance USDT instrument is required")
        counts = {key: receipt["counts"][key] for key in ("last", "mark", "funding")}
        counts.update({key: receipt["counts"][key] for key in LIFECYCLE_COUNTS if receipt["counts"].get(key)})
        rows.append({"symbol": symbol, "coin": coin(symbol), "catalog_path": path, "receipt": receipt,
                     "instrument": instruments[0], "instrument_id": instrument_id, "counts": counts,
                     "episode": receipt.get("episode")})
    names = [row["coin"] for row in rows]
    if len(set(names)) != len(names) or len({strategy_id(symbol) for symbol in symbols}) != len(symbols):
        raise Refusal("CONTRACT_NAME_COLLISION", "contracts must have distinct short names and strategy identifiers")
    return rows


def warmup_daily_bars(catalog_path: Path, instrument_id: InstrumentId, start: int):
    """The unbroken run of daily LAST bars ending 1 ms before `start`; at least 200."""
    bar_type = BarType.from_str(f"{instrument_id}-1-DAY-LAST-EXTERNAL")
    bars = sorted((bar for bar in ParquetDataCatalog(str(catalog_path)).query_bars([str(bar_type)], end=start - 1)
                   if bar.bar_type == bar_type and bar.ts_event < start), key=lambda bar: bar.ts_event)
    first = len(bars)
    while first > 0 and (first == len(bars) or bars[first].ts_event - bars[first - 1].ts_event == 86_400_000_000_000):
        first -= 1
    run = bars[first:]
    if len(run) < 200 or run[-1].ts_event != start - 1_000_000:
        raise RuntimeError(f"{instrument_id}: fewer than 200 contiguous daily bars end at the replay start")
    return run


def mark_timestamps(rows: list[dict]) -> int:
    """engine.mark_timestamps: distinct MARK update times over every contract, read file by file from the
    exported Parquet (only ts_event), so memory stays at one window's timestamps."""
    import numpy as np
    import pyarrow.parquet as parquet
    found = np.empty(0, dtype=np.uint64)
    for row in rows:
        for path in sorted((Path(row["catalog_path"]) / "data").glob("mark_prices/**/*.parquet")):
            found = np.union1d(found, parquet.read_table(path, columns=["ts_event"])["ts_event"].to_numpy())
    return len(found)


# Lifecycle (engine.lifecycle_events): the native InstrumentStatus and InstrumentClose events of a replay,
# rebuilt from the coverage receipt's export episodes and checked against the native summary's counts.

def _native_lifecycle(event: dict):
    from nautilus_trader.model import InstrumentClose, InstrumentStatus
    kind = event.get("type") if isinstance(event, dict) else None
    native = {"InstrumentStatus": InstrumentStatus, "InstrumentClose": InstrumentClose}.get(kind)
    if native is None:
        raise Refusal("LIFECYCLE_EVENT_INVALID", f"unknown lifecycle event type {kind!r}")
    try:
        built = native.from_dict(dict(event))
    except Exception as exc:
        raise Refusal("LIFECYCLE_EVENT_INVALID", f"{kind} cannot be built natively: {exc}") from exc
    if built.ts_event != built.ts_init:
        raise Refusal("LIFECYCLE_EVENT_INVALID", f"{kind} of {built.instrument_id} has ts_event != ts_init")
    if kind == "InstrumentClose" and (built.close_type.name != "CONTRACT_EXPIRED" or built.close_price.as_decimal() <= 0):
        raise Refusal("LIFECYCLE_EVENT_INVALID", f"InstrumentClose of {built.instrument_id} is not a positive "
                                                 "CONTRACT_EXPIRED close")
    return built


def _native_counts(summary: dict) -> dict[str, dict[str, int]]:
    counts: dict[str, dict[str, int]] = {}
    for coin_row in summary.get("per_coin") or ():
        instrument = coin_row.get("instrument") if isinstance(coin_row, dict) else None
        values = (coin_row.get("counts") or {}) if isinstance(coin_row, dict) else {}
        found = {key: values.get(key, 0) for key in LIFECYCLE_COUNTS}
        if (not isinstance(instrument, str) or instrument in counts
                or any(type(value) is not int or value < 0 for value in found.values())):
            raise Refusal("LIFECYCLE_NATIVE_COUNT_INVALID", f"the lifecycle counts of {instrument} are not "
                                                            "nonnegative integers of one instance")
        counts[instrument] = found
    return counts


def lifecycle_events(coverage: dict, summary: dict) -> tuple[dict, ...]:
    """engine.lifecycle_events: the window's terminations (InstrumentClose, InstrumentStatus CLOSE) by clock.

    Without a lifecycle bundle every native count must be zero. With one, the receipt's window and
    market commit equal the summary's, each counted instance has exactly one exported episode whose
    counts equal the native counts, and every event in the window is a native event.
    """
    native = _native_counts(summary)
    identity = coverage.get("input_identity") if isinstance(coverage, dict) else None
    if not isinstance(identity, dict) or not identity.get("lifecycle_bundle"):
        nonzero = sorted(instrument for instrument, values in native.items() if any(values.values()))
        if nonzero:
            raise Refusal("LIFECYCLE_BUNDLE_MISSING", f"lifecycle events without a lifecycle bundle: {nonzero}")
        return ()
    config = coverage.get("effective_config") if isinstance(coverage.get("effective_config"), dict) else {}
    try:
        window = parse_window(config.get("start"), None, config.get("end"))
        stated = parse_window(summary.get("input_start_utc"), None, summary.get("period_end_utc"))
    except (Refusal, TypeError, AttributeError) as exc:
        raise Refusal("LIFECYCLE_COVERAGE_MISMATCH", f"the receipt or summary window does not parse: {exc}") from exc
    if (coverage.get("format") != COVERAGE_FORMAT or (window.start_ns, window.end_ns) != (stated.start_ns, stated.end_ns)
            or identity.get("market_commit") != summary.get("market_commit")):
        raise Refusal("LIFECYCLE_COVERAGE_MISMATCH", "the coverage receipt's format, window or market commit differs "
                                                     "from the native summary")
    receipts = coverage.get("export_receipts") if isinstance(coverage.get("export_receipts"), dict) else {}
    represented: dict[str, dict] = {}
    for symbol, receipt in receipts.items():
        if not isinstance(receipt, dict):
            raise Refusal("LIFECYCLE_COUNT_MISMATCH", f"{symbol} has no export receipt")
        episode = receipt.get("episode")
        if episode is None:
            continue
        instrument = receipt.get("instrument_id")
        if not isinstance(episode, dict) or episode.get("instrument_id") != instrument or instrument in represented:
            raise Refusal("LIFECYCLE_COUNT_MISMATCH", f"{symbol}: the episode is not the one instance {instrument}")
        counted = receipt.get("counts") or {}
        if any(counted.get(key, 0) != native.get(instrument, {}).get(key, 0) for key in LIFECYCLE_COUNTS):
            raise Refusal("LIFECYCLE_COUNT_MISMATCH", f"{symbol}: receipt lifecycle counts differ from the native counts")
        represented[instrument] = {"episode": episode, "counts": counted}
    for instrument, values in native.items():
        if any(values.values()) and instrument not in represented:
            raise Refusal("LIFECYCLE_COUNT_MISMATCH", f"{instrument} counts lifecycle events but has no episode")
    found, seen = [], set()
    for instrument, item in represented.items():
        inside = {key: 0 for key in LIFECYCLE_COUNTS}
        for event in item["episode"].get("events") or ():
            built = _native_lifecycle(event)
            if str(built.instrument_id) != instrument:
                raise Refusal("LIFECYCLE_EVENT_INVALID", f"an event of {built.instrument_id} is in {instrument}'s episode")
            if not window.start_ns <= built.ts_event < window.end_ns:
                continue
            kind = event["type"]
            inside["instrument_close" if kind == "InstrumentClose" else "instrument_status"] += 1
            terminal = kind == "InstrumentClose" or built.action.name == "CLOSE"
            if not terminal:
                continue
            key = (kind, instrument, built.ts_event)
            if key in seen:
                raise Refusal("LIFECYCLE_DUPLICATE_EVENT", f"{kind} of {instrument} at {built.ts_event} repeats")
            seen.add(key)
            found.append({"type": kind, "instrument_id": instrument, "ts_event": int(built.ts_event),
                          "action": "CLOSE" if kind == "InstrumentStatus" else None,
                          "close_price": str(built.close_price) if kind == "InstrumentClose" else None})
        if any(inside[key] != item["counts"].get(key, 0) for key in LIFECYCLE_COUNTS):
            raise Refusal("LIFECYCLE_COUNT_MISMATCH", f"{instrument}: the episode's events in the window differ from "
                                                      "the receipt counts")
    return tuple(sorted(found, key=lambda value: (value["ts_event"], value["instrument_id"], value["type"])))
