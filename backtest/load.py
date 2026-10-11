"""Load what one replay needs: the verified strategy source, the window and the prepared inputs."""

from __future__ import annotations

import hashlib
import importlib.util
import inspect
import json
import os
import re
import stat
import sys
import tempfile
from dataclasses import dataclass
from datetime import UTC, datetime
from itertools import pairwise
from pathlib import Path
from types import ModuleType

import pyarrow.parquet as parquet
from nautilus_trader.model import BarType, InstrumentId, MarkPriceUpdate
from nautilus_trader.persistence import ParquetDataCatalog
from nautilus_trader.trading import Strategy


RUNTIME_CONTRACT = "r1-native-v4"
BAR_INTERVAL_NS = 5 * 60_000_000_000
_SHA256 = re.compile(r"[0-9a-f]{64}\Z")


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


# Strategy

@dataclass(frozen=True)
class LoadedStrategy:
    source_path: Path
    source_sha256: str
    entry_class: str
    strategy_class: type[Strategy]
    binding: dict | None
    uses_stop_loss: bool = True

    def metadata(self) -> dict:
        identity = {
            "strategy_source_sha256": self.source_sha256,
            "strategy_entry_class": self.entry_class,
            "strategy_runtime_contract": RUNTIME_CONTRACT,
            "strategy_uses_stop_loss": self.uses_stop_loss,
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
                          getattr(strategy_class, "USES_STOP_LOSS", True))


# Inputs

def month_edges(start: datetime, end: datetime):
    current = start
    while current < end:
        following = (current.replace(year=current.year + 1, month=1, day=1) if current.month == 12
                     else current.replace(month=current.month + 1, day=1))
        edge = min(following, end)
        yield current, edge
        current = edge


def read_instruments(root: Path, coins: list[str], quantities: dict[str, str], start: int, end: int):
    rows = []
    for coin in coins:
        catalog_path = root / coin / "minute"
        catalog = ParquetDataCatalog(str(catalog_path))
        completion = json.loads((catalog_path / "r1-download-complete.json").read_text())
        if (completion.get("start_ns"), completion.get("end_ns"), completion.get("bar_minutes")) != (start, end, 5):
            raise RuntimeError(f"{coin}: prepared minute interval does not match replay")
        instrument_id = InstrumentId.from_str(completion["instrument"])
        instruments = catalog.instruments(instrument_ids=[str(instrument_id)])
        if len(instruments) != 1 or instruments[0].quote_currency.code != "USDT":
            raise RuntimeError(f"{coin}: one Binance USDT instrument is required")
        assumption = json.loads((catalog_path / "instrument-assumption.json").read_text())
        if assumption.get("historical_terms") != "CURRENT_SNAPSHOT_APPROXIMATION":
            raise RuntimeError(f"{coin}: missing historical instrument assumption")
        rows.append({"coin": coin, "catalog": catalog, "catalog_path": catalog_path, "completion": completion,
                     "instrument": instruments[0], "instrument_id": instrument_id, "quantity": quantities[coin],
                     "counts": {"last": 0, "mark": 0, "funding": 0}})
    return rows


def warmup_daily_bars(daily_root: Path, coin: str, instrument_id: InstrumentId, start: int):
    path = daily_root / coin / "daily"
    completion = json.loads((path / "r1-daily-download-complete.json").read_text())
    if completion.get("instrument") != str(instrument_id) or completion.get("end_ns", 0) < start:
        raise RuntimeError(f"{coin}: daily warmup identity does not cover replay")
    bar_type = BarType.from_str(f"{instrument_id}-1-DAY-LAST-EXTERNAL")
    bars = sorted((bar for bar in ParquetDataCatalog(str(path)).query_bars([str(instrument_id)])
                   if bar.bar_type == bar_type and bar.ts_event < start), key=lambda bar: bar.ts_event)
    if (len(bars) < 200 or bars[-1].ts_event != start - 1_000_000
            or any(b.ts_event - a.ts_event != 86_400_000_000_000 for a, b in pairwise(bars))):
        raise RuntimeError(f"{coin}: daily warmup is not contiguous")
    return bars


def validate_funding_receipt(row: dict, start: int, end: int) -> None:
    """Audit legacy event coverage; BacktestNode itself loads the native data."""
    timestamps = []
    for relative_path in row["catalog"].query_files("funding_rate_update", identifiers=[str(row["instrument_id"])]):
        table = parquet.read_table(row["catalog_path"] / relative_path, columns=["ts_event", "next_funding_ns"])
        for event, settlement in zip(table["ts_event"].to_pylist(), table["next_funding_ns"].to_pylist(), strict=True):
            if event != settlement:
                raise RuntimeError(f"{row['coin']}: funding settlement timestamp mismatch")
            if start <= event < end:
                timestamps.append(event)
    timestamps.sort()
    if (len(timestamps) != row["completion"]["counts"]["funding"] or not timestamps
            or any(b - a > 8 * 3_600_000_000_000 + 1_000_000_000 for a, b in pairwise(timestamps))):
        raise RuntimeError(f"{row['coin']}: funding settlement coverage mismatch")


def mark_root(args) -> Path:
    if args.mark_root is not None:
        return args.mark_root
    identity = f"{args.catalog_root.resolve()}|{args.start}|{args.end}"
    digest = hashlib.sha256(identity.encode()).hexdigest()[:16]
    return Path(tempfile.gettempdir()) / "trade-r1-mark-catalog" / digest


def prepare_mark_catalog(row: dict, target: Path, start, end) -> None:
    """Validate LAST/MARK coverage and materialize only the needed native type."""
    target.mkdir(parents=True, exist_ok=True)
    catalog = ParquetDataCatalog(str(target))
    existing = sorted(catalog.query_mark_price_updates([str(row["instrument_id"])]), key=lambda update: update.ts_event)
    expected_total = row["completion"]["counts"]["mark"]
    if existing and len(existing) != expected_total:
        raise RuntimeError(f"{row['coin']}: partial native MARK catalog: {len(existing)}")
    if not existing:
        catalog.write_instruments([row["instrument"]])
    last_type = BarType.from_str(f"{row['instrument_id']}-5-MINUTE-LAST-EXTERNAL")
    mark_type = BarType.from_str(f"{row['instrument_id']}-5-MINUTE-MARK-EXTERNAL")
    cached = iter(existing)
    previous_ts = None
    total = 0
    for begin, edge in month_edges(start, end):
        begin_ns, edge_ns = ns(begin.isoformat()), ns(edge.isoformat())
        bars = row["catalog"].query_bars([str(row["instrument_id"])], start=begin_ns, end=edge_ns - 1)
        last = sorted((bar for bar in bars if bar.bar_type == last_type), key=lambda bar: bar.ts_event)
        mark = sorted((bar for bar in bars if bar.bar_type == mark_type), key=lambda bar: bar.ts_event)
        expected = (edge_ns - begin_ns) // BAR_INTERVAL_NS
        if (len(last) != expected or len(mark) != expected
                or last[0].ts_event != begin_ns + BAR_INTERVAL_NS - 1_000_000
                or last[-1].ts_event != edge_ns - 1_000_000
                or [bar.ts_event for bar in last] != [bar.ts_event for bar in mark]
                or any(b.ts_event - a.ts_event != BAR_INTERVAL_NS for a, b in pairwise(last))
                or (previous_ts is not None and last[0].ts_event - previous_ts != BAR_INTERVAL_NS)):
            raise RuntimeError(f"{row['coin']}: LAST/MARK five-minute coverage mismatch")
        previous_ts = last[-1].ts_event
        if existing:
            for bar in mark:
                update = next(cached, None)
                if update is None or update.ts_event != bar.ts_event or update.value != bar.close:
                    raise RuntimeError(f"{row['coin']}: cached MARK update differs from source")
        else:
            catalog.write_mark_price_updates([
                MarkPriceUpdate(instrument_id=row["instrument_id"], value=bar.close, ts_event=bar.ts_event,
                                ts_init=bar.ts_event)
                for bar in mark
            ])
        total += len(mark)
    if total != expected_total or (existing and next(cached, None) is not None):
        raise RuntimeError(f"{row['coin']}: MARK coverage total mismatch")
    print(f"{row['coin']}: validated {total} MARK updates", flush=True)
