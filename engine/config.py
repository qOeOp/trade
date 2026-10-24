"""The runner's configuration: the runtime contract, the fixed account, the command line, the window,
the effective configuration and the in-image identity probe (``--describe``).

The account and market facts (balance, leverage, matching) are fixed here; everything else, sizing
included, is the strategy source. Nothing here executes source or opens market data.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from datetime import UTC, datetime
import hashlib
import importlib.metadata
import json
import os
import re
import stat
import sys
from pathlib import Path
from types import MappingProxyType
from typing import TypedDict


# replay-contract@v6: one-minute execution bars and the constructor's `universe_membership`. A source written
# for another contract is refused, not run on these inputs. A source declaring QUOTE_EXECUTION = True (with its
# INITIAL_MARGIN_RATE and MAINTENANCE_MARGIN_RATE) runs the quote environment instead: the exported best bid/ask
# quotes drive matching and the native liquidation, bars only feed signals (engine.run.add_venue).
RUNTIME_CONTRACT = "replay-contract@v6"
EXECUTION_BAR_MINUTES = 1  # design constant: one-minute bars, matched as such
MINUTE_NS = 60_000_000_000

# The runtime source files hashed into the identity (runtime.image.LAYOUTS names the same paths).
ROOT = Path(__file__).resolve().parents[1]
RUNTIME_SOURCE_PATHS = {
    "config_source_sha256": "engine/config.py",
    "runner_source_sha256": "engine/run.py",
    "load_source_sha256": "engine/load.py",
    "report_source_sha256": "engine/report.py",
    "fingerprint_source_sha256": "engine/compare.py",
}
AUDIT_PATH = "engine/audit.py"


class AccountContract(TypedDict):
    """The value types of ACCOUNT_CONTRACT's terms."""
    venue: str
    oms_type: str
    account_type: str
    book_type: str
    base_currency: str
    starting_balance_usdt: str
    default_leverage: str
    support_gtd_orders: bool
    support_contingent_orders: bool
    reject_stop_orders: bool
    bar_execution: bool
    bar_adaptive_high_low_ordering: bool
    fill_model: str
    prob_fill_on_limit: str
    prob_slippage: str
    liquidity_consumption: bool
    queue_position: bool
    trader_id: str
    time_bars_timestamp_on_close: bool
    time_bars_skip_first_non_full_bar: bool
    validate_data_sequence: bool
    max_order_submit_rate: str
    chunk_size: int


ACCOUNT_CONTRACT: AccountContract = {
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
    # Fill model (Nautilus 2.0.0rc3 DefaultFillModel; user decision 2026-10-20): a resting limit fills only
    # when a bar trades through its price, never on a touch alone (prob_fill_on_limit 0); no model slippage
    # (prob_slippage 0). Both probabilities are 0, so the model draws no random numbers and needs no seed.
    # Adaptive ordering visits the bar extreme nearer the open first. Consumed-liquidity and queue tracking
    # stay off: on bars they reject repeat market orders and never fill limits respectively.
    "bar_adaptive_high_low_ordering": True,
    "fill_model": "DefaultFillModel",
    "prob_fill_on_limit": "0.0",
    "prob_slippage": "0.0",
    "liquidity_consumption": False,
    "queue_position": False,
    "trader_id": "R1-PORTFOLIO-001",
    "time_bars_timestamp_on_close": True,
    "time_bars_skip_first_non_full_bar": False,
    "validate_data_sequence": True,
    "max_order_submit_rate": "200/00:00:01",
    "chunk_size": 50_000,
}


def account_contract() -> MappingProxyType:
    """The fixed account and matching terms every candidate shares (engine.account_contract)."""
    return MappingProxyType(ACCOUNT_CONTRACT)


# Refusals. Every code the runner raises (here, in engine.load, engine.run and engine.report) and
# engine.compare_reports raises is in REFUSALS; the auditor's finding codes are in engine.audit.FINDINGS.

REFUSALS: dict[str, str] = {
    "UNKNOWN_OPTION": "The command line holds an option the runner does not define, such as a strategy parameter.",
    "REPLAY_ARGUMENT_MISSING": "A replay lacks the strategy file, class, hash or output, or an option lacks its value.",
    "SYMBOL_DUPLICATE": "A contract appears twice in --symbols.",
    "WINDOW_TIMEZONE_MISSING": "A window boundary has no Z or UTC offset.",
    "WINDOW_TIMESTAMP_INVALID": "A window boundary is not ISO-8601, has an offset with seconds or more than six "
                                "fractional digits.",
    "WINDOW_NOT_ALIGNED": "A window boundary is not on the execution bar grid.",
    "WINDOW_ORDER_INVALID": "The window does not satisfy start <= trade_start < end.",
    "UNIVERSE_FILE_UNREADABLE": "The universe membership file is not a readable regular file.",
    "UNIVERSE_FILE_INVALID": "The universe membership file is not JSON with a membership object of integer pairs.",
    "ENGINE_VERSION_UNAVAILABLE": "The image holds no engine distribution metadata.",
    "DEPENDENCY_LOCK_MISSING": "The image holds no dependency lock file.",
    "SOURCE_FILE_MISSING": "A runtime source file that is hashed into the identity is missing.",
    "EXECUTION_BINDING_MISMATCH": "The execution binding is not JSON, names another contract or another effective "
                                  "configuration than the runner resolves.",
    "MARKET_RECEIPT_MISMATCH": "An export receipt names another market commit, window or bar timeframe.",
    "TERMS_APPROXIMATION_MISSING": "An export receipt lacks the historical-terms approximation mark.",
    "EPISODE_MAPPING_MISMATCH": "An export receipt lists no piece, or a piece's number or Catalog directory is not "
                                "its episode's.",
    "INSTRUMENT_NOT_UNIQUE": "An exported Catalog does not hold exactly one USDT instrument of the receipt's ID.",
    "CONTRACT_NAME_COLLISION": "Two contracts share a short name or strategy identifier.",
    "NO_ACTIVE_INSTRUMENT": "No contract's lifecycle intersects the input window.",
    "QUOTES_MISSING": "The source declares QUOTE_EXECUTION but an active contract's export holds no quotes.",
    "DATA_COUNT_MISMATCH": "The engine consumed another number of events than the export receipts hold.",
    "OBSERVER_COUNT_MISMATCH": "The capital observer did not start exactly once.",
    "LIFECYCLE_NATIVE_COUNT_INVALID": "A native lifecycle count is not a nonnegative integer, or an instance repeats.",
    "LIFECYCLE_BUNDLE_MISSING": "The summary counts lifecycle events but the inputs name no lifecycle bundle.",
    "LIFECYCLE_COVERAGE_MISMATCH": "The coverage receipt's format, window or market commit differs from the summary.",
    "LIFECYCLE_COUNT_MISMATCH": "Receipt, episode and native lifecycle counts disagree.",
    "LIFECYCLE_EVENT_INVALID": "A lifecycle event is not a native event, has inconsistent clocks or an invalid close.",
    "LIFECYCLE_DUPLICATE_EVENT": "A lifecycle event of one type, instance and time appears twice.",
    # engine.load_strategy
    "SOURCE_UNREADABLE": "The strategy source is not a regular file, is a link or cannot be read.",
    "CONTENT_HASH_INVALID": "The expected content hash is not 64 lowercase hexadecimal characters.",
    "CONTENT_HASH_MISMATCH": "The source bytes' SHA-256 differs from the expected content hash.",
    "SOURCE_EXECUTION_FAILED": "Executing the source as its own module raised.",
    "ENTRY_CLASS_INVALID": "The entry class is not one identifier declared in the source as a native Strategy.",
    "HOOK_MISSING": "replay_diagnostics or replay_integrity_findings is not callable.",
    "DECLARATION_NOT_BOOL": "DAILY_WARMUP, USES_STOP_LOSS or QUOTE_EXECUTION is not a bool.",
    "MARGIN_DECLARATION_INVALID": "A QUOTE_EXECUTION source's INITIAL_MARGIN_RATE or MAINTENANCE_MARGIN_RATE is not a "
                                  "decimal string with 0 < maintenance <= initial < 1.",
    # engine.warmup_daily_bars and engine.mark_timestamps
    "WARMUP_NOT_ADJACENT": "No daily bar closes 1 ms before the input start.",
    "WARMUP_INSUFFICIENT": "Too few contiguous daily bars end at the input start (no contract can start).",
    "EXPORT_MARKS_UNREADABLE": "An exported MARK file is missing, damaged or has no ts_event column.",
    # engine.configure_strategy
    "STRATEGY_CONSTRUCTION_FAILED": "The source's entry class raised while it was constructed.",
    # engine.write_native_reports, engine.write_order_events, engine.summary_statistics and engine.diagnostics
    "NATIVE_ACCOUNT_MISSING": "The portfolio holds no account of the venue.",
    "EQUITY_SNAPSHOT_UNAVAILABLE": "The final equity snapshot is missing, stale, unpriced or not in USDT.",
    "GTD_DEADLINE_MISSING": "A GTD order has no expiry time in the cache, or the cache lacks the order.",
    "SELF_CHECK_FINDINGS_INVALID": "replay_integrity_findings returned something other than nonempty strings.",
    "DIAGNOSTICS_NOT_DICT": "replay_diagnostics returned something other than a dict.",
    "DIAGNOSTICS_RESERVED_KEY": "replay_diagnostics used a native report fact's key.",
    "DIAGNOSTICS_NOT_JSON": "replay_diagnostics returned a value JSON cannot hold.",
    "ORDER_WITHOUT_EVENTS": "A cached order has no native event.",
    "NON_FINITE_EVENT_FIELD": "A native order event holds NaN or infinity, which JSON cannot hold unchanged.",
    "TRADING_WINDOW_EMPTY": "The trading window does not end after it starts.",
    "STARTING_BALANCE_NOT_POSITIVE": "The starting balance is not positive.",
    # engine.compare_reports
    "REPORT_DIR_MISSING": "A report directory to compare is missing or lacks a table file or summary.json.",
    "REPORT_TABLE_UNREADABLE": "A table to compare does not parse or lacks its business keys, or a summary lacks the "
                               "engine version or the account metrics.",
    "SAME_REPORT_DIRECTORY": "The reference and candidate are the same report directory.",
    "INVALID_TOLERANCE": "The account tolerance is negative, not finite or not a decimal.",
    # engine.main
    "NATIVE_EXECUTION_FAILED": "A strategy constructor or callback raised during the replay.",
    "INTEGRITY_FINDINGS": "The summary's integrity findings are not empty.",
}

# Integrity findings (summary.json integrity_findings): every finding starts with one of these codes.
INTEGRITY_CODES: dict[str, str] = {
    "SELF_CHECK_FINDING": "The source's replay_integrity_findings reported a violated invariant.",
    "ORDERS_DENIED_OR_REJECTED": "The orders report holds DENIED or REJECTED orders.",
    "CAPITAL_VALUATION_GAP": "An open position could not be valued at a timestamp, or a MARK arrived out of order.",
    "CAPITAL_TIMESTAMP_COUNT_MISMATCH": "The observer valued another number of timestamps than the exported MARK "
                                        "files hold.",
    "EXPOSURE_WRITE_FAILED": "Writing the exposure table failed.",
}


class Refusal(ValueError):
    """A catalogued runner refusal; its text starts with the code."""

    def __init__(self, code: str, message: str):
        REFUSALS[code]  # an uncatalogued code is a KeyError
        super().__init__(f"{code}: {message}")
        self.code = code


# Window

@dataclass(frozen=True)
class Window:
    """[start, trade_start) warm-up and [trade_start, end) trading, as UTC nanoseconds and Z strings."""
    start_ns: int
    trade_start_ns: int
    end_ns: int
    start: str
    trade_start: str
    end: str


def utc_datetime(value: str) -> datetime:
    """Parse an explicit ISO-8601 timezone without consulting the host timezone."""
    try:
        if re.search(r"[+-]\d{2}(?::?\d{2})?(?::?\d{2})?[.,]\d+$", value):
            raise Refusal("WINDOW_TIMESTAMP_INVALID", "fractional UTC offsets are unsupported")
        if any(len(fraction) > 6 for fraction in re.findall(r"[.,](\d+)", value)):
            raise Refusal("WINDOW_TIMESTAMP_INVALID", "time precision must not exceed six fractional digits")
        parsed = datetime.fromisoformat(value)
    except Refusal:
        raise
    except (TypeError, ValueError) as exc:
        raise Refusal("WINDOW_TIMESTAMP_INVALID",
                      f"{value!r} is not an ISO-8601 datetime with explicit Z or UTC offset") from exc
    offset = parsed.utcoffset()
    if parsed.tzinfo is None or offset is None:
        raise Refusal("WINDOW_TIMEZONE_MISSING", f"{value!r} must include explicit Z or UTC offset")
    if offset.seconds % 60 or offset.microseconds:
        raise Refusal("WINDOW_TIMESTAMP_INVALID", f"{value!r} has an offset with seconds")
    try:
        return parsed.astimezone(UTC)
    except OverflowError as exc:
        raise Refusal("WINDOW_TIMESTAMP_INVALID", f"{value!r} is outside the representable UTC range") from exc


def ns(value: str) -> int:
    elapsed = utc_datetime(value) - datetime(1970, 1, 1, tzinfo=UTC)
    return ((elapsed.days * 86400 + elapsed.seconds) * 1_000_000 + elapsed.microseconds) * 1000


def utc_text(value_ns: int) -> str:
    """The Z-terminated text of a whole-second UTC instant."""
    return datetime.fromtimestamp(value_ns // 1_000_000_000, UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_window(start: str, trade_start: str | None, end: str,
                 execution_bar_minutes: int = EXECUTION_BAR_MINUTES) -> Window:
    """engine.parse_window: explicit UTC boundaries on the execution bar grid, start <= trade_start < end."""
    values = {"start": ns(start), "end": ns(end)}
    values["trade_start"] = ns(trade_start) if trade_start is not None else values["start"]
    step = execution_bar_minutes * MINUTE_NS
    for name, value in values.items():
        if value % step:
            raise Refusal("WINDOW_NOT_ALIGNED", f"--{name.replace('_', '-')} is not on the "
                                                f"{execution_bar_minutes}-minute grid")
    if not values["start"] <= values["trade_start"] < values["end"]:
        raise Refusal("WINDOW_ORDER_INVALID", "the window needs start <= trade-start < end")
    return Window(values["start"], values["trade_start"], values["end"], utc_text(values["start"]),
                  utc_text(values["trade_start"]), utc_text(values["end"]))


# Arguments

class _Parser(argparse.ArgumentParser):
    def error(self, message):
        code = "UNKNOWN_OPTION" if "unrecognized arguments" in message else "REPLAY_ARGUMENT_MISSING"
        raise Refusal(code, message)


def build_parser() -> argparse.ArgumentParser:
    parser = _Parser(description=__doc__, allow_abbrev=False)
    parser.add_argument("--describe", action="store_true", help="print the runtime identity and resolved configuration")
    strategy = parser.add_argument_group("strategy reference")
    strategy.add_argument("--strategy-file", type=Path)
    strategy.add_argument("--strategy-class")
    strategy.add_argument("--strategy-sha256")
    strategy.add_argument("--execution-binding", type=Path)
    inputs = parser.add_argument_group("inputs: one market commit exported per contract (market.export)")
    inputs.add_argument("--market-root", type=Path, required=True, help="directory of per-contract Catalogs")
    inputs.add_argument("--market-commit", required=True, help="the market database commit they were exported from")
    inputs.add_argument("--universe", type=Path, help="universe membership JSON handed to every strategy")
    inputs.add_argument("--symbols", nargs="+", required=True, help="Binance symbols, e.g. BTCUSDT")
    window = parser.add_argument_group("window")
    window.add_argument("--start", required=True, help="ISO-8601 datetime with explicit Z or UTC offset")
    window.add_argument("--end", required=True, help="ISO-8601 datetime with explicit Z or UTC offset")
    window.add_argument("--trade-start", help="ISO-8601 datetime with explicit Z or UTC offset")
    parser.add_argument("--output", type=Path)
    return parser


@dataclass(frozen=True)
class RunnerConfiguration:
    describe: bool
    strategy_file: Path | None
    strategy_class: str | None
    strategy_sha256: str | None
    execution_binding: Path | None
    market_root: Path
    market_commit: str
    universe_path: Path | None
    symbols: tuple[str, ...]
    window: Window
    output: Path | None


def parse_configuration(argv: list[str] | None = None) -> RunnerConfiguration:
    """engine.parse_configuration: the runner's inputs, without executing source or opening data."""
    args = build_parser().parse_args(argv)
    if not args.describe:
        missing = [option for option in ("strategy_file", "strategy_class", "strategy_sha256", "output")
                   if getattr(args, option) is None]
        if missing:
            raise Refusal("REPLAY_ARGUMENT_MISSING",
                          "a replay needs " + ", ".join("--" + name.replace("_", "-") for name in missing))
    window = parse_window(args.start, args.trade_start, args.end)
    if len(args.symbols) != len(set(args.symbols)):
        raise Refusal("SYMBOL_DUPLICATE", "--symbols must be unique")
    return RunnerConfiguration(args.describe, args.strategy_file, args.strategy_class, args.strategy_sha256,
                               args.execution_binding, args.market_root, args.market_commit,
                               args.universe, tuple(args.symbols), window, args.output)


def read_universe_bytes(path: Path) -> bytes:
    """A regular file's bytes through one descriptor, never following a link."""
    try:
        if not stat.S_ISREG(path.lstat().st_mode):
            raise OSError("not a regular file")
        descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
        with os.fdopen(descriptor, "rb") as stream:
            return stream.read()
    except OSError as exc:
        raise Refusal("UNIVERSE_FILE_UNREADABLE", f"{path}: {exc}") from exc


@dataclass(frozen=True)
class EffectiveConfiguration:
    values: dict
    digest: str


HOST_PATH_KEYS = ("market_root", "universe_path")
# The execution binding the replay entry writes and engine.run.execution_metadata checks.
EXECUTION_BINDING_FIELDS = frozenset({"runtime_identity", "effective_config", "effective_config_sha256"})


def key_difference(found, required) -> str:
    """'missing a, b; extra c': how a key set differs from the required one."""
    missing, extra = sorted(set(required) - set(found)), sorted(set(found) - set(required))
    return "; ".join([*([f"missing {', '.join(missing)}"] if missing else []),
                      *([f"extra {', '.join(extra)}"] if extra else [])])


def config_sha256(values: dict) -> str:
    """The digest of the values without their host paths (canonical JSON)."""
    hashed = {key: value for key, value in values.items() if key not in HOST_PATH_KEYS}
    encoded = json.dumps(hashed, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode()
    return hashlib.sha256(encoded).hexdigest()


def effective_configuration(config: RunnerConfiguration) -> EffectiveConfiguration:
    """engine.effective_configuration: what the runner resolves, comparable between host and image."""
    universe = config.universe_path
    values = {
        "runtime_contract": RUNTIME_CONTRACT,
        "execution_bar_minutes": EXECUTION_BAR_MINUTES,
        "market_root": str(config.market_root),
        "market_commit": config.market_commit,
        "universe_path": str(universe) if universe is not None else None,
        "universe_sha256": hashlib.sha256(read_universe_bytes(universe)).hexdigest() if universe is not None else None,
        "symbols": list(config.symbols),
        "start": config.window.start,
        "trade_start": config.window.trade_start,
        "end": config.window.end,
        "account": ACCOUNT_CONTRACT.copy(),
    }
    return EffectiveConfiguration(values, config_sha256(values))


def runtime_source_metadata() -> dict:
    """The runtime source files' hashes, independent of any strategy revision."""
    return {
        **{field: hashlib.sha256((ROOT / path).read_bytes()).hexdigest() for field, path in RUNTIME_SOURCE_PATHS.items()},
        "source_file_paths": RUNTIME_SOURCE_PATHS.copy(),
    }


def describe(config: RunnerConfiguration) -> dict:
    """engine.describe: the executing image's runtime code and the configuration it would resolve."""
    try:
        engine_version = importlib.metadata.version("nautilus_trader")
    except importlib.metadata.PackageNotFoundError as exc:
        raise Refusal("ENGINE_VERSION_UNAVAILABLE", "no nautilus_trader distribution metadata") from exc
    lock = ROOT / "uv.lock"
    if not lock.is_file():
        raise Refusal("DEPENDENCY_LOCK_MISSING", f"{lock} is missing")
    missing = [path for path in (*RUNTIME_SOURCE_PATHS.values(), AUDIT_PATH) if not (ROOT / path).is_file()]
    if missing:
        raise Refusal("SOURCE_FILE_MISSING", ", ".join(missing))
    metadata = runtime_source_metadata()
    effective = effective_configuration(config)
    return {
        "runtime_contract": RUNTIME_CONTRACT,
        "engine_version": engine_version,
        "python_version": sys.version.split()[0],
        "dependency_lock_sha256": hashlib.sha256(lock.read_bytes()).hexdigest(),
        "source_files_sha256": {key: value for key, value in metadata.items() if key.endswith("_source_sha256")},
        "source_file_paths": metadata["source_file_paths"],
        "audit_source_sha256": hashlib.sha256((ROOT / AUDIT_PATH).read_bytes()).hexdigest(),
        "effective_config": effective.values,
        "effective_config_sha256": effective.digest,
    }
