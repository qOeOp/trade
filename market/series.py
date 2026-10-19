"""One-minute series (`market.stitch_series`, `market.missing_intervals`, `market.derive_bars`,
`market.check_derived`).

Sources are stitched in one order (monthly archive, daily archive, public REST) and the stitch is
invisible above this module: a series is one sorted, duplicate-free run of closed minutes, and a
minute two sources both hold must agree field by field. Minutes no source holds stay missing and
are returned as half-open intervals. Higher timeframes are derived from the minutes by one rule and
never stored.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import numpy as np
import pyarrow as pa
import pyarrow.compute as pc

from market import sources
from market.sources import KLINE_SCHEMA, MINUTE, MarketError, _refuse


DAY = 86_400_000
COLUMNS = ("ts_open", "open", "high", "low", "close", "volume")
PRICE_TYPES = ("LAST", "MARK")


def _ms_day(value: int) -> date:
    return datetime.fromtimestamp(value / 1000, UTC).date()


def _day_ms(value: date) -> int:
    return int(datetime(value.year, value.month, value.day, tzinfo=UTC).timestamp() * 1000)


def _months(start_ms: int, end_ms: int) -> list[str]:
    first, last = _ms_day(start_ms).replace(day=1), _ms_day(end_ms - 1).replace(day=1)
    found = []
    while first <= last:
        found.append(first.strftime("%Y-%m"))
        first = (first + timedelta(days=32)).replace(day=1)
    return found


def _days(start_ms: int, end_ms: int, month: str | None = None) -> list[str]:
    found, day = [], _ms_day(start_ms)
    while _day_ms(day) < end_ms:
        if month is None or day.strftime("%Y-%m") == month:
            found.append(day.isoformat())
        day += timedelta(days=1)
    return found


# market.missing_intervals

def missing_intervals(times, start_ms: int, end_ms: int, step_ms: int = MINUTE, volume=None) -> dict:
    """market.missing_intervals: the missing [from, to) runs of the step grid in [start_ms, end_ms) and the
    held and zero-volume counts; facts only, nothing filled."""
    times = np.asarray(times, dtype=np.int64)
    if len(times) and (np.any(np.diff(times) <= 0) or np.any((times - start_ms) % step_ms)):
        raise _refuse("times are not strictly increasing on the step grid", "GRID_MISALIGNED")
    if volume is not None and len(np.asarray(volume)) != len(times):
        raise _refuse("volume and times differ in length", "GRID_MISALIGNED")
    if start_ms >= end_ms:
        return {"intervals": [], "missing_count": 0, "present_count": 0, "first_ms": None, "last_ms": None,
                "zero_volume_count": None if volume is None else 0}
    inside = (times >= start_ms) & (times < end_ms)
    held = times[inside]
    edges = np.concatenate([[start_ms - step_ms], held, [end_ms]])
    jumps = np.nonzero(np.diff(edges) > step_ms)[0]
    intervals = [(int(edges[i] + step_ms), int(edges[i + 1])) for i in jumps]
    return {"intervals": intervals, "missing_count": int(sum((b - a) // step_ms for a, b in intervals)),
            "present_count": int(len(held)), "first_ms": int(held[0]) if len(held) else None,
            "last_ms": int(held[-1]) if len(held) else None,
            "zero_volume_count": None if volume is None else int(np.count_nonzero(np.asarray(volume)[inside] == 0))}


# market.stitch_series

SOURCES = ("monthly", "daily", "rest")


def _tagged(table: pa.Table, source: int) -> pa.Table:
    return table.append_column("source", pa.array(np.full(table.num_rows, source, np.int8)))


def _merge(parts: list[pa.Table], start_ms: int, end_ms: int, label: str) -> pa.Table:
    """One sorted run without duplicates in [start_ms, end_ms); a minute held twice must agree on every field.
    Parts carry a `source` column; of equal duplicates the earlier source is kept."""
    parts = [part for part in parts if part.num_rows]
    table = pa.concat_tables(parts) if parts else _tagged(KLINE_SCHEMA.empty_table(), 0)
    table = table.filter(pc.and_(pc.greater_equal(table["open_time"], start_ms), pc.less(table["open_time"], end_ms)))
    table = table.sort_by([("open_time", "ascending"), ("source", "ascending")])
    times = table["open_time"].to_numpy()
    same = np.nonzero(np.diff(times) == 0)[0]
    if len(same):
        fields = table.drop_columns(["source"])
        first, second = fields.take(pa.array(same)), fields.take(pa.array(same + 1))
        differs = [int(times[same[i]]) for i in range(len(same))
                   if first.slice(i, 1).to_pylist() != second.slice(i, 1).to_pylist()]
        if differs:
            raise _refuse(f"{label}: sources disagree at open_time {differs[:5]}", "SOURCE_CONFLICT",
                          missing=tuple(str(item) for item in differs[:5]))
        keep = np.ones(len(times), bool)
        keep[same + 1] = False
        table = table.filter(pa.array(keep))
    if table.num_rows:
        opens = table["open_time"].to_numpy()
        bad = (table["close_time"].to_numpy() != opens + MINUTE - 1) | (opens % MINUTE != 0)
        if bad.any():
            at = int(opens[int(np.argmax(bad))])
            raise _refuse(f"{label}: the row at {at} is not a closed one-minute kline", "SOURCE_SHAPE",
                          missing=(str(at),))
    return table


def _rest(price_type: str, symbol: str, start_ms: int, end_ms: int, trading: bool) -> pa.Table:
    """Public REST minutes; a contract no longer trading may be unknown to REST, which then has none."""
    try:
        return sources.rows_table(sources.rest_klines(price_type, symbol, "1m", start_ms, end_ms))
    except MarketError as exc:
        if exc.code == "SOURCE_UNKNOWN_SYMBOL" and not trading:
            return KLINE_SCHEMA.empty_table()
        raise


def stitch_series(archive_cache: Path, symbol: str, price_type: str, start_ms: int, end_ms: int, resumed: bool,
                  trading: bool, workers: int = 4) -> tuple[pa.Table, list[tuple[int, int]], dict]:
    """market.stitch_series: (minute table, gap intervals, rows taken per source) of one series in
    [start_ms, end_ms).

    `resumed`: start_ms continues stored minutes, so gaps count from it; otherwise from the first held
    minute. `trading`: the contract still trades, so minutes up to end_ms are expected; otherwise up to
    the last held minute.
    """
    if price_type not in PRICE_TYPES:
        raise _refuse(f"price type {price_type!r} is neither LAST nor MARK", "PRICE_TYPE_UNKNOWN",
                      missing=(str(price_type),))
    sources.check_symbol(symbol)
    label = f"{symbol} {price_type}"
    empty = KLINE_SCHEMA.empty_table()
    if start_ms >= end_ms:
        return empty, [], {name: 0 for name in SOURCES}
    if start_ms % MINUTE or end_ms % MINUTE:
        raise _refuse(f"{label}: [{start_ms}, {end_ms}) is not on the minute grid", "SOURCE_SHAPE")
    kind = sources.KIND_OF[price_type]
    months = _months(start_ms, end_ms)
    monthly = sources.monthly_archives(archive_cache, kind, symbol, "1m", months, workers)
    parts = [_tagged(sources.kline_table(path), 0) for path in monthly.values()]
    fetched: set[str] = set()

    def add_days(days: list[str]) -> None:
        wanted = [day for day in days if day not in fetched]
        fetched.update(wanted)
        if wanted:
            found = sources.daily_archives(archive_cache, kind, symbol, "1m", wanted, workers)
            parts.extend(_tagged(sources.kline_table(path), 1) for path in found.values())

    add_days([day for month in months if month not in monthly for day in _days(start_ms, end_ms, month)])
    table = _merge(parts, start_ms, end_ms, label)
    if not table.num_rows and (trading or resumed):
        # No archive at all (Binance publishes no markPriceKlines for some contracts, e.g. non-ASCII
        # ones, and none yet for a contract listed this month): public REST for the whole window.
        parts.append(_tagged(_rest(price_type, symbol, start_ms, end_ms, trading), 2))
        table = _merge(parts, start_ms, end_ms, label)

    def gaps_of(found: pa.Table) -> list[tuple[int, int]]:
        if not found.num_rows:
            return [(start_ms, end_ms)] if resumed and trading else []
        times = found["open_time"].to_numpy()
        low = start_ms if resumed else int(times[0])
        high = end_ms if trading else int(times[-1]) + MINUTE
        return missing_intervals(times, low, high, MINUTE)["intervals"] if low < high else []

    gaps = gaps_of(table)
    if gaps:
        add_days(sorted({day for a, b in gaps for day in _days(a - a % DAY, b)}))
        table = _merge(parts, start_ms, end_ms, label)
        gaps = gaps_of(table)
    for a, b in gaps:
        found = _rest(price_type, symbol, a, b, trading)
        if found.num_rows:
            parts.append(_tagged(found, 2))
    if gaps:
        table = _merge(parts, start_ms, end_ms, label)
        gaps = gaps_of(table)
    counts = np.bincount(table["source"].to_numpy(), minlength=3) if table.num_rows else np.zeros(3, np.int64)
    return table.drop_columns(["source"]), gaps, {name: int(counts[i]) for i, name in enumerate(SOURCES)}


# market.derive_bars

def _check_minutes(bars: dict, code: str) -> None:
    ts = np.asarray(bars["ts_open"], dtype=np.int64)
    if len(ts) and (np.any(np.diff(ts) <= 0) or np.any(ts % MINUTE)):
        raise _refuse("bar open times are not strictly increasing whole minutes", code)


def buckets(ts: np.ndarray, timeframe: str) -> np.ndarray:
    step = sources.STEP_MS[timeframe]
    offset = sources.WEEK_OFFSET if timeframe == "1w" else 0
    return (ts - offset) // step * step + offset


def derive_bars(minute_bars: dict[str, np.ndarray], timeframe: str) -> dict[str, np.ndarray]:
    """market.derive_bars: one-minute integer bars aggregated into `timeframe` buckets. Open is the first
    traded minute's open; high and low are over traded minutes (all minutes when none traded); close is
    the last minute's close; volume is the sum. A bucket without minutes does not exist."""
    if timeframe not in sources.TIMEFRAMES:
        raise _refuse(f"timeframe {timeframe!r} is not one of {', '.join(sources.TIMEFRAMES)}", "TIMEFRAME_UNKNOWN",
                      missing=(str(timeframe),))
    if timeframe == "1m" or not len(minute_bars["ts_open"]):
        return minute_bars
    _check_minutes(minute_bars, "INPUT_UNSORTED")
    start = buckets(np.asarray(minute_bars["ts_open"], dtype=np.int64), timeframe)
    first = np.nonzero(np.concatenate([[True], start[1:] != start[:-1]]))[0]
    o, h, l, c, v = (np.asarray(minute_bars[name], dtype=np.int64) for name in COLUMNS[1:])
    if float(np.add.reduceat(v.astype(np.float64), first).max()) >= 2.0 ** 63 - 1024:
        raise _refuse(f"a {timeframe} volume would exceed BIGINT", "VOLUME_OVERFLOW")
    traded = v > 0
    any_traded = np.add.reduceat(traded.astype(np.int64), first) > 0
    big, small = np.iinfo(np.int64).max, np.iinfo(np.int64).min
    first_traded = np.minimum.reduceat(np.where(traded, np.arange(len(v)), big), first)
    last = np.concatenate([first[1:], [len(v)]]) - 1
    return {
        "ts_open": start[first],
        "open": o[np.where(any_traded, first_traded, first)],
        "high": np.where(any_traded, np.maximum.reduceat(np.where(traded, h, small), first),
                         np.maximum.reduceat(h, first)),
        "low": np.where(any_traded, np.minimum.reduceat(np.where(traded, l, big), first),
                        np.minimum.reduceat(l, first)),
        "close": c[last],
        "volume": np.add.reduceat(v, first),
    }


# market.check_derived

def _rounded(values: np.ndarray, scale: int, precision: int) -> np.ndarray:
    if precision >= scale:
        return values
    divisor = 10 ** (scale - precision)
    return (values + divisor // 2) // divisor


def check_derived(derived: dict, native: dict, timeframe: str, price_precision: int, size_precision: int, *,
                  price_scale: int = 8, volume_scale: int = 4) -> list[dict]:
    """market.check_derived: findings where derived bars and the exchange's native bars of the same
    timeframe differ at the contract's precision; an empty list means they agree. Nothing is changed."""
    if price_precision < 0 or size_precision < 0:
        raise _refuse("a precision is negative", "PRECISION_INVALID")
    if timeframe not in sources.TIMEFRAMES:
        raise _refuse(f"timeframe {timeframe!r} is unknown", "TIMEFRAME_UNKNOWN", missing=(str(timeframe),))
    for side in (derived, native):
        ts = np.asarray(side["ts_open"], dtype=np.int64)
        if len(ts) and (np.any(np.diff(ts) <= 0) or np.any(buckets(ts, timeframe) != ts)):
            raise _refuse(f"bar open times are not strictly increasing on the {timeframe} grid", "GRID_MISALIGNED")
    index = {int(ts): i for i, ts in enumerate(native["ts_open"])}
    findings, seen = [], set()
    for i, ts in enumerate(derived["ts_open"]):
        ts = int(ts)
        j = index.get(ts)
        if j is None:
            findings.append({"ts_open": ts, "kind": "bucket_only_derived", "field": None, "derived_value": None,
                             "native_value": None})
            continue
        seen.add(ts)
        for name in COLUMNS[1:]:
            scale, precision = (volume_scale, size_precision) if name == "volume" else (price_scale, price_precision)
            a = int(_rounded(np.asarray([derived[name][i]], np.int64), scale, precision)[0])
            b = int(_rounded(np.asarray([native[name][j]], np.int64), scale, precision)[0])
            if a != b:
                findings.append({"ts_open": ts, "kind": "value_mismatch", "field": name,
                                 "derived_value": int(derived[name][i]), "native_value": int(native[name][j])})
    findings += [{"ts_open": int(ts), "kind": "bucket_only_native", "field": None, "derived_value": None,
                  "native_value": None} for ts in native["ts_open"] if int(ts) not in seen]
    return sorted(findings, key=lambda item: (item["ts_open"], item["kind"], item["field"] or ""))
