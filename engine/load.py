"""Load what one replay needs: the verified strategy source and its run identity, the exported market
inputs, universe membership and daily warm-up, the source's self-reported diagnostics, and the
lifecycle events checked against the coverage receipt."""

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

from engine.config import EXECUTION_BAR_MINUTES, MINUTE_NS, RUNTIME_CONTRACT, Refusal, parse_window, utc_text


BAR_INTERVAL_NS = EXECUTION_BAR_MINUTES * MINUTE_NS
TIMEFRAME = f"{EXECUTION_BAR_MINUTES}m"
LIFECYCLE_COUNTS = ("instrument_close", "instrument_status")
COVERAGE_FORMAT = "execution-input-coverage-v1"
_SHA256 = re.compile(r"[0-9a-f]{64}\Z")


# Strategy

@dataclass(frozen=True)
class LoadedStrategy:
    source_path: Path
    content_hash: str
    entry_class: str
    strategy_class: type[Strategy]
    binding: dict | None
    uses_stop_loss: bool = True
    daily_warmup: bool = False


def read_regular_file(path: Path) -> bytes:
    """Read through one descriptor; never follow a symlink at the file boundary."""
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    try:
        if not stat.S_ISREG(path.lstat().st_mode):
            raise Refusal("SOURCE_UNREADABLE", f"strategy source must be a regular file: {path}")
        descriptor = os.open(path, flags)
    except OSError as error:
        raise Refusal("SOURCE_UNREADABLE", f"cannot read strategy source: {path}: {error}") from error
    with os.fdopen(descriptor, "rb") as stream:
        if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
            raise Refusal("SOURCE_UNREADABLE", f"strategy source must be a regular file: {path}")
        return stream.read()


def _binding(path: Path | None, content_hash: str, entry_class: str) -> dict | None:
    if path is None:
        return None
    try:
        value = json.loads(read_regular_file(path))
    except (UnicodeDecodeError, json.JSONDecodeError, Refusal) as error:
        raise Refusal("BINDING_MISMATCH", f"strategy binding is not valid JSON: {path}") from error
    required = {
        "database", "commit", "strategy_id", "revision", "content_hash",
        "entry_class", "runtime_contract",
    }
    if not isinstance(value, dict) or set(value) != required:
        raise Refusal("BINDING_MISMATCH", "strategy binding must contain the exact Dolt revision identity")
    for field in required - {"revision"}:
        if not isinstance(value[field], str) or not value[field].strip():
            raise Refusal("BINDING_MISMATCH", f"strategy binding has no valid {field}")
    if type(value["revision"]) is not int or value["revision"] < 1:
        raise Refusal("BINDING_MISMATCH", "strategy binding revision must be a positive integer")
    if value["content_hash"] != content_hash:
        raise Refusal("BINDING_MISMATCH", "strategy binding content hash differs from verified bytes")
    if value["entry_class"] != entry_class:
        raise Refusal("BINDING_MISMATCH", "strategy binding entry class differs from selected class")
    if value["runtime_contract"] != RUNTIME_CONTRACT:
        raise Refusal("BINDING_MISMATCH", "strategy binding runtime contract is unsupported")
    return value


def load_strategy(
    source_path: Path,
    entry_class: str,
    expected_content_hash: str,
    binding_path: Path | None = None,
) -> LoadedStrategy:
    """engine.load_strategy: execute exactly hash-checked source bytes and resolve a native class.

    This verifies identity, not safety of arbitrary Python. The invoking sandbox
    or fixed runtime image supplies the execution boundary.
    """
    if not isinstance(expected_content_hash, str) or not _SHA256.fullmatch(expected_content_hash):
        raise Refusal("CONTENT_HASH_INVALID", "strategy SHA-256 must be 64 lowercase hexadecimal characters")
    if not isinstance(entry_class, str) or not entry_class.isidentifier():
        raise Refusal("ENTRY_CLASS_INVALID", "strategy class must be one Python class name")
    source = read_regular_file(source_path)
    actual_sha256 = hashlib.sha256(source).hexdigest()
    if actual_sha256 != expected_content_hash:
        raise Refusal("CONTENT_HASH_MISMATCH", "strategy SHA-256 differs from the published source")
    binding = _binding(binding_path, actual_sha256, entry_class)
    source_path = source_path.resolve()
    module_name = f"_strategy_{actual_sha256}"
    module = sys.modules.get(module_name)
    if module is None:
        module = ModuleType(module_name)
        module.__file__ = str(source_path)
        module.__package__ = ""
        module.__spec__ = importlib.util.spec_from_loader(module_name, loader=None)
        sys.modules[module_name] = module
        try:
            exec(compile(source, str(source_path), "exec"), module.__dict__)
        except Exception as exc:
            sys.modules.pop(module_name, None)
            raise Refusal("SOURCE_EXECUTION_FAILED", f"{type(exc).__name__}: {exc}") from exc
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
        raise Refusal("ENTRY_CLASS_INVALID", "strategy entry class must be declared here and extend native Strategy")
    for name in ("replay_diagnostics", "replay_integrity_findings"):
        if not callable(getattr(strategy_class, name, None)):
            raise Refusal("HOOK_MISSING", f"{RUNTIME_CONTRACT} strategy requires {name}")
    if type(getattr(strategy_class, "DAILY_WARMUP", False)) is not bool:
        raise Refusal("DECLARATION_NOT_BOOL", "strategy DAILY_WARMUP must be True or False")
    if type(getattr(strategy_class, "USES_STOP_LOSS", True)) is not bool:
        raise Refusal("DECLARATION_NOT_BOOL", "strategy USES_STOP_LOSS must be True or False")
    return LoadedStrategy(source_path, actual_sha256, entry_class, strategy_class, binding,
                          getattr(strategy_class, "USES_STOP_LOSS", True), getattr(strategy_class, "DAILY_WARMUP", False))


def strategy_metadata(loaded: LoadedStrategy) -> dict:
    """engine.strategy_metadata: the run identity of the verified source and its two declarations."""
    identity = {
        "source_sha256": loaded.content_hash,
        "strategy_entry_class": loaded.entry_class,
        "strategy_runtime_contract": RUNTIME_CONTRACT,
        "strategy_uses_stop_loss": loaded.uses_stop_loss,
        "strategy_daily_warmup": loaded.daily_warmup,
        "strategy_source": {
            "path": str(loaded.source_path),
            "content_hash": loaded.content_hash,
            "entry_class": loaded.entry_class,
        },
    }
    if loaded.binding is not None:
        identity["strategy_binding"] = loaded.binding.copy()
    return identity


RESERVED_DIAGNOSTICS = {"coin", "instrument", "quantity", "counts", "positions"}


def diagnostics(strategy: Strategy) -> dict:
    """engine.diagnostics: the source's own counters, kept apart from the native report facts."""
    value = strategy.replay_diagnostics()
    if not isinstance(value, dict):
        raise Refusal("DIAGNOSTICS_NOT_DICT", f"strategy diagnostics are a {type(value).__name__}, not a dict")
    if RESERVED_DIAGNOSTICS.intersection(value):
        raise Refusal("DIAGNOSTICS_RESERVED_KEY", "strategy diagnostics must not replace native report facts: "
                      + ", ".join(sorted(RESERVED_DIAGNOSTICS.intersection(value))))
    try:
        json.dumps(value, allow_nan=True)
    except (TypeError, ValueError) as exc:
        raise Refusal("DIAGNOSTICS_NOT_JSON", f"strategy diagnostics are not JSON: {exc}") from exc
    return value


# Inputs: a market commit exported as one Catalog per contract (market/export.py)

def coin(symbol: str, episode: int | None = None) -> str:
    """The contract's short name: BTCUSDT -> BTC, 1000PEPEUSDT -> PEPE (a leading 1000 before letters);
    a lifecycle episode n of a reused ticker adds _E<n>."""
    base = symbol.removesuffix("USDT")
    name = base[4:] if base.startswith("1000") and base[4:5].isalpha() else base
    return name + (f"_E{episode}" if episode is not None else "")


def strategy_id(symbol: str, episode: int | None = None) -> str:
    """Nautilus identifiers are ASCII; a non-ASCII coin is spelled by its UTF-8 bytes."""
    name = coin(symbol)
    name = name if name.isascii() else "X" + name.encode().hex().upper()
    return f"R1-{name}" + (f"_E{episode}" if episode is not None else "")


def read_universe(universe_path: Path | None, symbols: list[str]) -> dict[str, tuple[tuple[int, int], ...]]:
    """engine.read_universe: each contract's membership as [start_ns, end_ns) intervals (empty without a file)."""
    if universe_path is None:
        return {symbol: () for symbol in symbols}
    try:
        value = json.loads(read_regular_file(universe_path))
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
        raise Refusal("UNIVERSE_FILE_INVALID", f"{universe_path}: {exc}") from exc


def read_market(market_root: Path, symbols: list[str], market_commit: str, start_ns: int, end_ns: int) -> list[dict]:
    """engine.read_market: each contract's export receipt checked against the commit, the window and the
    one-minute timeframe, and one row per exported piece (the contract, or each lifecycle episode of a
    reused ticker) with its Catalog's one instrument."""
    rows = []
    for symbol in symbols:
        path = market_root / symbol
        receipt = json.loads((path / "export.json").read_text(encoding="utf-8"))
        if ((receipt.get("commit"), receipt.get("start_ns"), receipt.get("end_ns"), receipt.get("timeframe"))
                != (market_commit, start_ns, end_ns, TIMEFRAME)):
            raise Refusal("MARKET_RECEIPT_MISMATCH", f"{symbol}: the export is not commit {market_commit} over the "
                                                     f"replay window in {TIMEFRAME} bars")
        if receipt.get("historical_terms") != "CURRENT_SNAPSHOT_APPROXIMATION":
            raise Refusal("TERMS_APPROXIMATION_MISSING", f"{symbol}: the receipt has no historical-terms mark")
        pieces = receipt.get("pieces")
        if not isinstance(pieces, list) or not pieces:
            raise Refusal("EPISODE_MAPPING_MISMATCH", f"{symbol}: the receipt lists no exported piece")
        for number, piece in enumerate(pieces, start=1):
            index = piece.get("index") if isinstance(piece, dict) else "invalid"
            single = index is None and len(pieces) == 1
            if not single and (index != number or piece.get("catalog_dir") != f"episode-{number}"):
                raise Refusal("EPISODE_MAPPING_MISMATCH", f"{symbol}: piece {number} is not episode-{number}")
            if single and piece.get("catalog_dir") != "":
                raise Refusal("EPISODE_MAPPING_MISMATCH", f"{symbol}: its one piece is not the contract directory")
            catalog_path = path / piece["catalog_dir"] if piece["catalog_dir"] else path
            instrument_id = InstrumentId.from_str(piece["instrument_id"])
            instruments = ParquetDataCatalog(str(catalog_path)).instruments(instrument_ids=[str(instrument_id)])
            if len(instruments) != 1 or instruments[0].quote_currency.code != "USDT":
                raise Refusal("INSTRUMENT_NOT_UNIQUE", f"{symbol}: one Binance USDT instrument is required")
            counts = {key: piece["counts"][key] for key in ("last", "mark", "funding")}
            counts.update({key: piece["counts"][key] for key in LIFECYCLE_COUNTS if piece["counts"].get(key)})
            rows.append({"symbol": symbol, "coin": coin(symbol, index), "strategy_id": strategy_id(symbol, index),
                         "catalog_path": catalog_path, "receipt": receipt, "piece": piece,
                         "instrument": instruments[0], "instrument_id": instrument_id, "counts": counts,
                         "episode": piece.get("episode")})
    names = [row["coin"] for row in rows]
    if len(set(names)) != len(names) or len({row["strategy_id"] for row in rows}) != len(rows):
        raise Refusal("CONTRACT_NAME_COLLISION", "contracts must have distinct short names and strategy identifiers")
    return rows


def terms_approximations(rows: list[dict], end_ns: int) -> list[str]:
    """CURRENT_SNAPSHOT_APPROXIMATION limitations: each contract whose terms were observed after the
    window's end (a market imported after the fact), named with its observation time."""
    found = {}
    for row in rows:
        observed = row["receipt"].get("terms_observed_at")
        if isinstance(observed, int) and observed * 1_000_000 >= end_ns and row["symbol"] not in found:
            found[row["symbol"]] = (f"CURRENT_SNAPSHOT_APPROXIMATION: {row['symbol']} trades on terms observed at "
                                    f"{utc_text(observed * 1_000_000)} (observed_at {observed}), after the window end "
                                    f"{utc_text(end_ns)}")
    return list(found.values())


DAY_NS = 86_400_000_000_000
WARMUP_DAYS = 200  # uncalibrated example value


def _daily_bars(catalog_path: Path, instrument_id: InstrumentId, before: int | None = None) -> list:
    bar_type = BarType.from_str(f"{instrument_id}-1-DAY-LAST-EXTERNAL")
    found = ParquetDataCatalog(str(catalog_path)).query_bars([str(bar_type)], end=before - 1 if before else None)
    return sorted((bar for bar in found if bar.bar_type == bar_type and (before is None or bar.ts_event < before)),
                  key=lambda bar: bar.ts_event)


def warmup_daily_bars(catalog_path: Path, instrument_id: InstrumentId, start_ns: int) -> list:
    """engine.warmup_daily_bars: the unbroken run of daily LAST bars ending 1 ms before `start_ns`; at least 200."""
    bars = _daily_bars(catalog_path, instrument_id, start_ns)
    if not bars or bars[-1].ts_event != start_ns - 1_000_000:
        raise Refusal("WARMUP_NOT_ADJACENT", f"{instrument_id}: no daily bar closes 1 ms before the input start")
    first = len(bars) - 1
    while first > 0 and bars[first].ts_event - bars[first - 1].ts_event == DAY_NS:
        first -= 1
    run = bars[first:]
    if len(run) < WARMUP_DAYS:
        raise Refusal("WARMUP_INSUFFICIENT", f"{instrument_id}: {len(run)} contiguous daily bars end at the input "
                                             f"start, {WARMUP_DAYS} are needed")
    return run


def warmup_start(catalog_path: Path, instrument_id: InstrumentId, earliest: int, end: int) -> int | None:
    """The first instant at or after `earliest` and before `end` at which the daily warm-up holds (WARMUP_DAYS
    contiguous daily bars end 1 ms before it); None when it never holds in the window."""
    run, previous = 0, None
    for bar in _daily_bars(catalog_path, instrument_id):
        run = run + 1 if previous is not None and bar.ts_event - previous == DAY_NS else 1
        previous = bar.ts_event
        moment = bar.ts_event + 1_000_000
        if run >= WARMUP_DAYS and earliest <= moment < end:
            return moment
    return None


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
        if not isinstance(receipt, dict) or not isinstance(receipt.get("pieces"), list):
            raise Refusal("LIFECYCLE_COUNT_MISMATCH", f"{symbol} has no export receipt")
        for piece in receipt["pieces"]:
            episode = piece.get("episode") if isinstance(piece, dict) else None
            if episode is None:
                continue
            instrument = piece.get("instrument_id")
            if not isinstance(episode, dict) or episode.get("instrument_id") != instrument or instrument in represented:
                raise Refusal("LIFECYCLE_COUNT_MISMATCH", f"{symbol}: the episode is not the one instance {instrument}")
            counted = piece.get("counts") or {}
            if any(counted.get(key, 0) != native.get(instrument, {}).get(key, 0) for key in LIFECYCLE_COUNTS):
                raise Refusal("LIFECYCLE_COUNT_MISMATCH", f"{symbol}: receipt lifecycle counts differ from the native "
                                                          "counts")
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
