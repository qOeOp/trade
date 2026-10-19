"""The runner's configuration: the runtime contract, the fixed account, the command line, the window,
the effective configuration and the in-image identity probe (``--describe``).

The account and market facts (balance, leverage, matching) are fixed here; everything else, sizing
included, is the strategy source. Nothing here executes source or opens market data.
"""

from __future__ import annotations

import argparse
from datetime import UTC, datetime
import hashlib
import importlib.metadata
import json
import re
import sys
from pathlib import Path
from types import MappingProxyType

from engine import report


RUNTIME_CONTRACT = "r1-native-v5"


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


def account_contract() -> MappingProxyType:
    """The fixed account and matching terms every candidate shares (engine.account_contract)."""
    return MappingProxyType(ACCOUNT_CONTRACT)


# Window

def utc_datetime(value: str) -> datetime:
    """Parse an explicit ISO-8601 timezone without consulting the host timezone."""
    try:
        if re.search(r"[+-]\d{2}(?::?\d{2})?(?::?\d{2})?[.,]\d+$", value):
            raise ValueError("fractional UTC offsets are unsupported")
        if any(len(fraction) > 6 for fraction in re.findall(r"[.,](\d+)", value)):
            raise ValueError("time precision must not exceed six fractional digits")
        parsed = datetime.fromisoformat(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(
            "time must be an ISO-8601 datetime with explicit Z or UTC offset, "
            "at most six fractional digits and no fractional UTC offset"
        ) from exc
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ValueError("time must include explicit Z or UTC offset")
    try:
        return parsed.astimezone(UTC)
    except OverflowError as exc:
        raise ValueError("time is outside the representable UTC datetime range") from exc


def ns(value: str) -> int:
    elapsed = utc_datetime(value) - datetime(1970, 1, 1, tzinfo=UTC)
    return ((elapsed.days * 86400 + elapsed.seconds) * 1_000_000 + elapsed.microseconds) * 1000


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
    inputs = parser.add_argument_group("inputs: one market commit exported per contract (market.export)")
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


def config_sha256(value: dict) -> str:
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
        "effective_config_sha256": config_sha256(effective),
    }
