"""Load what one replay needs: the verified strategy source and its run identity, the exported market
inputs, universe membership and daily warm-up, the source's self-reported diagnostics, and the
lifecycle events checked against the coverage receipt."""

from __future__ import annotations

import ast
import hashlib
import importlib.util
import inspect
import json
import os
import re
import stat
import sys
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from types import ModuleType
from typing import Any

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

ENVIRONMENT_NAMES = ("QUOTE_EXECUTION", "INITIAL_MARGIN_RATE", "MAINTENANCE_MARGIN_RATE")
# The source runs in the runner's process, so the source check refuses the routes by which it could reach the
# runner or a file: an import beyond pure computation and the native strategy API, a module reached through an
# allowed one or kept under another name, dynamic execution or attribute access by name, dunder and frame
# introspection, a private attribute of anything but `self`, a kept `type(...)`, the shared decimal context,
# assignment through an imported object or a call result, and rebinding what the runner wraps.
SOURCE_STDLIB = frozenset({"__future__", "bisect", "calendar", "collections", "dataclasses", "datetime", "decimal",
                           "enum", "heapq", "itertools", "math", "statistics"})
SOURCE_NAUTILUS = ("nautilus_trader.common", "nautilus_trader.config", "nautilus_trader.core",
                   "nautilus_trader.indicators", "nautilus_trader.model", "nautilus_trader.trading")
SOURCE_REFUSED_NAMES = frozenset({
    "breakpoint", "compile", "delattr", "eval", "exec", "getattr", "globals", "input", "locals", "open", "setattr",
    "vars",
})
SOURCE_REFUSED_ATTRIBUTES = frozenset({
    "DefaultContext", "ag_code", "ag_frame", "cr_code", "cr_frame", "f_back", "f_builtins", "f_code", "f_globals",
    "f_locals", "getcontext", "gi_code", "gi_frame", "gi_yieldfrom", "mro", "setcontext", "tb_frame", "tb_next",
})
SOURCE_DUNDERS = frozenset({"__init__", "__name__"})
# What the runner wraps around the source (engine.run.guarded_callbacks): the native callbacks, the two hooks,
# the guarded clock and the read-only cache.
SOURCE_WRAPPED = frozenset({name for name in dir(Strategy) if name.startswith("on_")} | {
    "cache", "clock", "replay_diagnostics", "replay_integrity_findings", "shutdown_system"})
# Where a one-argument type(x) may appear: read at once, compared, or turned into text or a class check.
SOURCE_TYPE_USES = frozenset({"isinstance", "issubclass", "repr", "str"})


def _module_allowed(module: str) -> bool:
    return module.partition(".")[0] in SOURCE_STDLIB or any(
        module == allowed or module.startswith(allowed + ".") for allowed in SOURCE_NAUTILUS)


def _refused_attribute(name: str) -> bool:
    return name in SOURCE_REFUSED_ATTRIBUTES or (
        name.startswith("__") and name.endswith("__") and name not in SOURCE_DUNDERS)


def _imported(node: ast.Import | ast.ImportFrom, found: list) -> dict[str, object]:
    """The names an allowed import binds and their objects; each refused part noted in `found`."""
    bound: dict[str, object] = {}
    if isinstance(node, ast.Import):
        for alias in node.names:
            if not _module_allowed(alias.name):
                found.append((node.lineno, f"import {alias.name}"))
            elif alias.asname:
                bound[alias.asname] = importlib.import_module(alias.name)
            else:
                bound[alias.name.partition(".")[0]] = importlib.import_module(alias.name.partition(".")[0])
        return bound
    name = node.module or ""
    if node.level or not _module_allowed(name):
        found.append((node.lineno, f"from {'.' * node.level}{name} import"))
        return bound
    module = importlib.import_module(name)
    for alias in node.names:
        if alias.name == "*" or _refused_attribute(alias.name):
            found.append((node.lineno, f"from {name} import {alias.name}"))
            continue
        value = getattr(module, alias.name, None)
        if value is None and _module_allowed(f"{name}.{alias.name}"):
            value = importlib.import_module(f"{name}.{alias.name}")
        if isinstance(value, ModuleType) and not _module_allowed(value.__name__):
            found.append((node.lineno, f"from {name} import {alias.name} (module {value.__name__})"))
            continue
        bound[alias.asname or alias.name] = value
    return bound


def source_findings(source: bytes) -> list[str]:
    """engine.source_findings: what in the source reaches outside its own rules, one line each with its line
    number, in line order; [] when nothing does. Static (it imports only allowed modules), so it proves no
    safety: it refuses the routes to the runner and to files that need no visibly odd code."""
    tree = ast.parse(source, filename="<strategy>")
    parents = {child: node for node in ast.walk(tree) for child in ast.iter_child_nodes(node)}
    found: list[tuple[int, str]] = []
    imported: dict[str, object] = {}
    for node in ast.walk(tree):
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            imported.update(_imported(node, found))
    for node in ast.walk(tree):
        line = getattr(node, "lineno", 0)
        if isinstance(node, ast.Name):
            if node.id in SOURCE_REFUSED_NAMES or (
                    node.id.startswith("__") and node.id.endswith("__") and node.id not in SOURCE_DUNDERS):
                found.append((line, f"name {node.id}"))
            elif isinstance(imported.get(node.id), ModuleType):
                parent, value, path = parents.get(node), imported[node.id], node.id
                if not (isinstance(parent, ast.Attribute) and parent.value is node and isinstance(node.ctx, ast.Load)):
                    found.append((line, f"module {node.id} used other than by attribute"))
                while isinstance(parent, ast.Attribute) and isinstance(value, ModuleType):
                    value, path = getattr(value, parent.attr, None), f"{path}.{parent.attr}"
                    if isinstance(value, ModuleType) and not _module_allowed(value.__name__):
                        found.append((line, f"attribute {path} (module {value.__name__})"))
                        break
                    parent = parents.get(parent)
        elif isinstance(node, ast.Attribute):
            if _refused_attribute(node.attr):
                found.append((line, f"attribute {node.attr}"))
            elif node.attr.startswith("_") and not node.attr.startswith("__") and not (
                    isinstance(node.value, ast.Name) and node.value.id == "self"):
                found.append((line, f"private attribute {ast.unparse(node)}"))
            if isinstance(node.ctx, (ast.Store, ast.Del)):
                root = node.value
                while isinstance(root, (ast.Attribute, ast.Subscript)):
                    root = root.value
                if not isinstance(root, ast.Name) or root.id in imported or node.attr in SOURCE_WRAPPED:
                    found.append((line, f"assignment to {ast.unparse(node)}"))
        elif isinstance(node, ast.MatchClass):
            found += [(line, f"attribute {name}") for name in node.kwd_attrs if _refused_attribute(name)]
        elif (isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "type"
              and len(node.args) == 1 and not node.keywords):
            parent = parents.get(node)
            if not (isinstance(parent, ast.Attribute) and parent.value is node
                    or isinstance(parent, (ast.Compare, ast.FormattedValue))
                    or isinstance(parent, ast.Call) and isinstance(parent.func, ast.Name)
                    and parent.func.id in SOURCE_TYPE_USES):
                found.append((line, "type(...) kept other than by attribute, comparison, text or class check"))
    return [f"line {line}: {text}" for line, text in sorted(set(found))]


@dataclass(frozen=True)
class LoadedStrategy:
    source_path: Path
    content_hash: str
    entry_class: str
    strategy_class: type[Strategy]
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


def load_strategy(
    source_path: Path,
    entry_class: str,
    expected_content_hash: str,
) -> LoadedStrategy:
    """engine.load_strategy: execute exactly hash-checked source bytes that pass the source check and
    resolve a native class.

    The source check refuses the plain routes into the runner, files and dynamic execution; it is not a
    sandbox. The fixed runtime image supplies the execution boundary (no network, read-only inputs).
    """
    if not isinstance(expected_content_hash, str) or not _SHA256.fullmatch(expected_content_hash):
        raise Refusal("CONTENT_HASH_INVALID", "strategy SHA-256 must be 64 lowercase hexadecimal characters")
    if not isinstance(entry_class, str) or not entry_class.isidentifier():
        raise Refusal("ENTRY_CLASS_INVALID", "strategy class must be one Python class name")
    source = read_regular_file(source_path)
    actual_sha256 = hashlib.sha256(source).hexdigest()
    if actual_sha256 != expected_content_hash:
        raise Refusal("CONTENT_HASH_MISMATCH", "strategy SHA-256 differs from the published source")
    try:
        reach = source_findings(source)
    except (SyntaxError, ValueError, ImportError) as exc:
        raise Refusal("SOURCE_EXECUTION_FAILED", f"{type(exc).__name__}: {exc}") from exc
    if reach:
        raise Refusal("SOURCE_REACH", "; ".join(reach))
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
    declared = [name for name in ENVIRONMENT_NAMES if hasattr(strategy_class, name)]
    if declared:
        raise Refusal("ENVIRONMENT_DECLARED", "the execution environment is the runner's --execution and margin rates, "
                                              "not the source's " + ", ".join(declared))
    return LoadedStrategy(source_path, actual_sha256, entry_class, strategy_class,
                          getattr(strategy_class, "USES_STOP_LOSS", True), getattr(strategy_class, "DAILY_WARMUP", False))


def strategy_metadata(loaded: LoadedStrategy) -> dict:
    """engine.strategy_metadata: the run identity of the verified source and its two declarations."""
    return {
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


RESERVED_DIAGNOSTICS = {"coin", "instrument", "quantity", "counts", "positions"}


def diagnostics(strategy: Strategy) -> dict:
    """engine.diagnostics: the source's own counters, kept apart from the native report facts."""
    value = strategy.replay_diagnostics()  # type: ignore[attr-defined]  # load_strategy refuses a source without it
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


def entry_windows(coverage: dict, summary: dict) -> dict[str, tuple[tuple[int, int], ...]]:
    """engine.entry_windows: each exported instrument's entry intervals from trusted input receipts.

    Membership is intersected with its episode and the input window. Overlapping or adjacent
    intervals form one interval; an empty membership permits only reduce-only orders.
    """
    if not isinstance(coverage, dict) or coverage.get("format") != COVERAGE_FORMAT:
        raise ValueError("input-coverage.json is missing or has an unknown format")
    config = coverage["effective_config"]
    window = parse_window(config["start"], config["trade_start"], config["end"])
    stated = parse_window(summary["input_start_utc"], summary["period_start_utc"], summary["period_end_utc"])
    membership = coverage["membership"]
    if (window != stated or coverage["input_identity"]["market_commit"] != summary["market_commit"]
            or membership["commit"] != summary["market_commit"]):
        raise ValueError("entry scope window or market commit differs from the summary")
    members = membership["membership"]
    if not isinstance(members, dict) or not isinstance(coverage["export_receipts"], dict):
        raise ValueError("input receipt has no membership or export mapping")
    allowed = {}
    for symbol, receipt in coverage["export_receipts"].items():
        intervals = members.get(symbol, [])
        if not isinstance(intervals, list) or any(
                not isinstance(pair, list) or len(pair) != 2 or any(type(value) is not int for value in pair)
                or pair[0] >= pair[1] for pair in intervals):
            raise ValueError(f"{symbol}: membership is not a list of nonempty integer intervals")
        pieces = receipt["pieces"]
        if not isinstance(pieces, list) or not pieces:
            raise ValueError(f"{symbol}: no exported instances")
        for piece in pieces:
            instrument, episode = piece["instrument_id"], piece.get("episode")
            if not isinstance(instrument, str) or not instrument or instrument in allowed:
                raise ValueError(f"{symbol}: exported instrument is missing or repeats")
            if episode is not None:
                if (not coverage["input_identity"].get("lifecycle_bundle")
                        or not isinstance(episode, dict) or episode["instrument_id"] != instrument
                        or type(episode["start_ns"]) is not int):
                    raise ValueError(f"{symbol}: episode is not the trusted exported instrument")
                for event in episode["events"]:
                    if str(_native_lifecycle(event).instrument_id) != instrument:
                        raise ValueError(f"{symbol}: lifecycle event changes instrument")
            clipped: list[tuple[int, int]] = []
            for low, high in sorted(episode_membership(tuple(map(tuple, intervals)), episode)):
                low, high = max(low, window.start_ns), min(high, window.end_ns)
                if low >= high:
                    continue
                if clipped and low <= clipped[-1][1]:
                    clipped[-1] = (clipped[-1][0], max(high, clipped[-1][1]))
                else:
                    clipped.append((low, high))
            allowed[instrument] = tuple(clipped)
    if not allowed:
        raise ValueError("input receipt names no exported instrument")
    return allowed



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
            if not isinstance(piece, dict):
                raise Refusal("EPISODE_MAPPING_MISMATCH", f"{symbol}: piece {number} is not episode-{number}")
            index = piece.get("index")
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
            if piece["counts"].get("quote"):
                counts["quote"] = piece["counts"]["quote"]
            if "trade" in piece["counts"]:  # exported only on request (--trade-ticks), then streamed, even none
                counts["trade"] = piece["counts"]["trade"]
            if "metrics" in piece["counts"]:  # likewise (--metrics)
                counts["metrics"] = piece["counts"]["metrics"]
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
    builders: dict[object, Callable[[dict], Any]] = {"InstrumentStatus": InstrumentStatus.from_dict,
                                                     "InstrumentClose": InstrumentClose.from_dict}
    native = builders.get(kind)
    if native is None:
        raise Refusal("LIFECYCLE_EVENT_INVALID", f"unknown lifecycle event type {kind!r}")
    try:
        built = native(dict(event))
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
    config = coverage["effective_config"] if isinstance(coverage.get("effective_config"), dict) else {}
    try:  # unvalidated JSON: a value that is not a string fails parse_window, as the except below records
        window = parse_window(config.get("start"), None, config.get("end"))  # type: ignore[arg-type]
        stated = parse_window(summary.get("input_start_utc"), None, summary.get("period_end_utc"))  # type: ignore[arg-type]
    except (Refusal, TypeError, AttributeError) as exc:
        raise Refusal("LIFECYCLE_COVERAGE_MISMATCH", f"the receipt or summary window does not parse: {exc}") from exc
    if (coverage.get("format") != COVERAGE_FORMAT or (window.start_ns, window.end_ns) != (stated.start_ns, stated.end_ns)
            or identity.get("market_commit") != summary.get("market_commit")):
        raise Refusal("LIFECYCLE_COVERAGE_MISMATCH", "the coverage receipt's format, window or market commit differs "
                                                     "from the native summary")
    receipts = coverage["export_receipts"] if isinstance(coverage.get("export_receipts"), dict) else {}
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
