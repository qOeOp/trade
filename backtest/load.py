"""Load what one replay needs: the verified strategy source, the window and the exported market inputs."""

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
from datetime import UTC, datetime
from pathlib import Path
from types import ModuleType

from nautilus_trader.model import BarType, InstrumentId
from nautilus_trader.persistence import ParquetDataCatalog
from nautilus_trader.trading import Strategy


RUNTIME_CONTRACT = "r1-native-v7"
BAR_INTERVAL_NS = 60_000_000_000
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


# Inputs: a market commit exported as one Catalog per contract (research/market/export.py)

def coin(symbol: str) -> str:
    """The contract's short name: BTCUSDT -> BTC, 1000PEPEUSDT -> PEPE (a leading 1000 before letters)."""
    base = symbol.removesuffix("USDT")
    return base[4:] if base.startswith("1000") and base[4:5].isalpha() else base


def strategy_id(symbol: str) -> str:
    """Nautilus identifiers are ASCII; a non-ASCII coin is spelled by its UTF-8 bytes."""
    name = coin(symbol)
    return f"R1-{name}" if name.isascii() else "R1-X" + name.encode().hex().upper()


def read_pool(path: Path | None, symbols: list[str]) -> dict[str, tuple[tuple[int, int], ...]]:
    """Each contract's pool membership as [start_ns, end_ns) intervals (empty without a pool file)."""
    if path is None:
        return {symbol: () for symbol in symbols}
    value = json.loads(read_regular_file(path))
    if not isinstance(value, dict) or not isinstance(value.get("membership"), dict):
        raise ValueError("pool file must hold a membership object")
    return {symbol: tuple((int(a), int(b)) for a, b in value["membership"].get(symbol, [])) for symbol in symbols}


def read_market(root: Path, symbols: list[str], commit: str, start: int, end: int):
    rows = []
    for symbol in symbols:
        path = root / symbol
        receipt = json.loads((path / "export.json").read_text())
        if ((receipt.get("commit"), receipt.get("start_ns"), receipt.get("end_ns"), receipt.get("timeframe"))
                != (commit, start, end, "1m")):
            raise RuntimeError(f"{symbol}: exported Catalog is not commit {commit} over the replay window")
        if receipt.get("historical_terms") != "CURRENT_SNAPSHOT_APPROXIMATION":
            raise RuntimeError(f"{symbol}: missing historical instrument assumption")
        for index, item in enumerate(receipt.get('episodes', [receipt]), 1):
            if ((item.get('commit'), item.get('start_ns'), item.get('end_ns'), item.get('timeframe'))
                    != (commit, start, end, '1m') or item.get('historical_terms') != receipt['historical_terms']):
                raise RuntimeError(f'{symbol}: episode differs from the original market scope')
            if 'episodes' in receipt and item.get('catalog_directory') != f'episode-{index}':
                raise RuntimeError(f'{symbol}: episode Catalog directory differs from its mapping')
            catalog_path = path / item['catalog_directory'] if 'episodes' in receipt else path
            instrument_id = InstrumentId.from_str(item['instrument_id'])
            instruments = ParquetDataCatalog(str(catalog_path)).instruments(instrument_ids=[str(instrument_id)])
            if len(instruments) != 1 or instruments[0].quote_currency.code != 'USDT':
                raise RuntimeError(f'{symbol}: one Binance USDT instrument is required')
            counts = {key: item['counts'][key] for key in ('last', 'mark', 'funding')}
            counts.update({key: item['counts'][key] for key in ('instrument_close', 'instrument_status')
                           if key in item['counts']})
            # The public universe retains its original ticker; native state is per contract episode.
            native_symbol = str(instrument_id.symbol).removesuffix('-PERP') if 'episode' in item else symbol
            rows.append({'symbol': native_symbol, 'source_symbol': symbol, 'coin': coin(native_symbol),
                         'catalog_path': catalog_path, 'receipt': item, 'instrument': instruments[0],
                         'instrument_id': instrument_id, 'counts': counts})
    names = [row["coin"] for row in rows]
    if len(set(names)) != len(names) or len({strategy_id(row['symbol']) for row in rows}) != len(rows):
        raise ValueError("contracts must have distinct names")
    return rows


def episode_membership(intervals, episode):
    """Intersect original membership with the supplied legal opening lifetime (not announcement PIT)."""
    if episode is None:
        return intervals
    low = episode['start_ns'] or 0
    ends = [e['ts_event'] for e in episode['events'] if e['type'] == 'InstrumentClose'
            or (e['type'] == 'InstrumentStatus' and e['action'] in ('PRE_CLOSE', 'CLOSE'))]
    high = min(ends) if ends else None
    return tuple((max(a, low), min(b, high) if high is not None else b) for a, b in intervals
                 if max(a, low) < (min(b, high) if high is not None else b))


def episode_active(episode, start, end):
    """Legal lifetime intersects the input window; a missing bar never makes an episode inactive."""
    if episode is None:
        return True
    ending = next((e['ts_event'] for e in episode['events'] if e['type'] == 'InstrumentClose'
                   or (e['type'] == 'InstrumentStatus' and e['action'] == 'CLOSE')), None)
    return (episode['start_ns'] or 0) < end and (ending is None or ending > start)


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
    """Distinct MARK update times over every contract: the timestamps the capital observer values."""
    import numpy as np
    import pyarrow.parquet as parquet
    found = [parquet.read_table(path, columns=["ts_event"])["ts_event"].to_numpy()
             for row in rows for path in sorted((row["catalog_path"] / "data").glob("mark_prices/**/*.parquet"))]
    return len(np.unique(np.concatenate(found))) if found else 0
