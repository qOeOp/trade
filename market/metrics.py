"""Binance USD-M daily `metrics` archives: open interest and three long/short ratios, one row every five
minutes, stored as the archive gives them (market.import_metrics).

A row stamped `create_time` t describes t + 5 min (its open interest equals REST's at t + 5 min, measured
2026-10-31; docs/plans/binance-open-interest-input.zh.md), so nothing in it is known before then; the
exporter, not the import, applies the visibility rule. The archive's taker volume ratio (a trade aggregate)
and open interest value (open interest times an exchange price snapshot) are not stored.

Each contract's month is one data file, written under the import lock. An import adds the days of the month the
file does not hold, through the last closed UTC day, and keeps the stored rows as they are: the archive carries no
sequence to check across an interruption.
"""

from __future__ import annotations

import csv
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal, InvalidOperation
import io
from pathlib import Path
import time
import zipfile
import zlib

import pyarrow as pa

from market import files, series, sources, store, universe
from market.sources import MarketError, _refuse


COLUMNS = ("create_time", "symbol", "sum_open_interest", "sum_open_interest_value", "count_toptrader_long_short_ratio",
           "sum_toptrader_long_short_ratio", "count_long_short_ratio", "sum_taker_long_short_vol_ratio")
RATIOS = ("count_toptrader_long_short_ratio", "sum_toptrader_long_short_ratio", "count_long_short_ratio")
STEP = 300_000  # one row every five minutes
SCALE = 16  # the most decimals an archive has used (2022); the metrics columns are decimal128(38, 16)
# Binance publishes a day's archive the next day: a missing day that closed fewer days ago than this may be late or
# briefly unreachable, so market.follow tries it every round.
SETTLE_DAYS = 3


def exact(text: str, label: str) -> str:
    """The source's decimal text as a decimal128(38, SCALE) column holds it exactly; never rounded."""
    try:
        value = Decimal(text)
    except InvalidOperation as exc:
        raise _refuse(f"{label}: {text!r} is not a decimal", "SOURCE_SHAPE", missing=(label,)) from exc
    if not value.is_finite() or value < 0:
        raise _refuse(f"{label}: {text!r} is not a finite non-negative decimal", "SOURCE_SHAPE", missing=(label,))
    # Trailing zeros counted from the digits: normalize() would round under the context (1E-1000000000 is 0).
    _, digits, exponent = value.as_tuple()
    text = "".join(map(str, digits))
    decimals = -int(exponent) - (len(text) - len(text.rstrip("0")))
    if value and (value.adjusted() >= 38 - SCALE or decimals > SCALE):
        raise _refuse(f"{label}: {text!r} does not fit decimal128(38, {SCALE}) exactly", "SCALE_LOSS",
                      missing=(label,))
    return format(value, "f")


def rows(path: Path, symbol: str, day: str) -> tuple[list[tuple], dict]:
    """One day's rows in time order, and its readings: rows kept, identical repeats merged, empty ratios."""
    label = f"{symbol} {day}"
    low = series._day_ms(date.fromisoformat(day))
    found: dict[int, tuple] = {}
    repeated = 0
    empty = dict.fromkeys(RATIOS, 0)
    try:
        with zipfile.ZipFile(path) as archive:
            names = archive.namelist()
            if len(names) != 1:
                raise ValueError(f"expected one CSV, found {names}")
            with archive.open(names[0]) as raw, io.TextIOWrapper(raw, encoding="utf-8", newline="") as stream:
                reader = csv.reader(stream)
                if next(reader, None) != list(COLUMNS):
                    raise ValueError("the header is not the metrics columns")
                for row in reader:
                    if len(row) != len(COLUMNS):
                        raise ValueError(f"expected {len(COLUMNS)} columns, found {len(row)}")
                    item = dict(zip(COLUMNS, row, strict=True))
                    moment = int(datetime.strptime(item["create_time"], "%Y-%m-%d %H:%M:%S").replace(
                        tzinfo=UTC).timestamp() * 1000)
                    if item["symbol"] != symbol:
                        raise ValueError(f"a row names {item['symbol']!r}")
                    if moment % STEP or not low <= moment < low + store.DAY:
                        raise ValueError(f"create_time {item['create_time']} is off the five-minute grid of its day")
                    if not item["sum_open_interest"]:
                        raise ValueError(f"create_time {item['create_time']} has no open interest")
                    value = (symbol, moment, exact(item["sum_open_interest"], label + " sum_open_interest"),
                             *(exact(item[name], f"{label} {name}") if item[name] else None for name in RATIOS))
                    if moment in found:
                        if found[moment] != value:
                            raise _refuse(f"{label}: two rows at {item['create_time']} differ", "SOURCE_SHAPE",
                                          missing=(label,))
                        repeated += 1
                        continue
                    found[moment] = value
                    for name in RATIOS:
                        empty[name] += not item[name]
    except (ValueError, csv.Error, UnicodeError, zipfile.BadZipFile, zlib.error, EOFError) as exc:
        raise _refuse(f"{label}: rows do not parse as metrics ({exc})", "SOURCE_SHAPE", missing=(label,)) from exc
    readings = {"rows": len(found), "repeated_rows": repeated, "empty": empty}
    return [found[moment] for moment in sorted(found)], readings


def held_days(market: files.Market, symbol: str, month: date | None = None) -> set[date]:
    """The days `symbol` holds rows of, in `month` or at all."""
    low, high = (series._day_ms(month), series._day_ms(universe.next_month(month))) if month else (None, None)
    found: set[date] = set()
    for entry in files.entries(market, "metrics", [symbol], low, high):
        for batch in files.file_batches(files.file_bytes(market, entry), files.METRICS):
            stamps = batch.column("create_time").to_numpy(zero_copy_only=False)
            found.update(date(1970, 1, 1) + timedelta(days=int(day)) for day in set((stamps // store.DAY).tolist()))
    return found


def import_month(profile: dict, month: date, cache: Path, symbols: list[str] | None = None, log=print,
                 first: date | None = None) -> dict:
    """market.import_metrics: add each contract's days of `month` (from `first`) not yet held, through the last closed
    UTC day, one file per contract (default: the month's universe members). A refused contract leaves the earlier
    contracts' files in place; its refusal names them."""
    started = time.monotonic()
    scope = store._scope(symbols)
    start, end = store.month_bounds(month)
    if start >= end:
        raise _refuse(f"{month:%Y-%m} has no closed UTC day yet", "MONTH_INVALID", missing=(f"{month:%Y-%m}",))
    if first is not None:
        start = max(start, series._day_ms(first))
    market = files.open_market(profile, "import")
    imports: list[dict] = []
    with files.lock(market):
        if market.empty:
            raise _refuse("the market holds no bars yet", "MARKET_EMPTY")
        if scope is None:
            scope = sorted(store._members(market, month))
            if not scope:
                raise _refuse(f"{month:%Y-%m} has no universe members in the market; import its bars first or name "
                              "--symbols", "UNIVERSE_UNKNOWN", missing=(f"{month:%Y-%m}",))
        for symbol in scope:
            try:
                imports.append(_import(market, month, start, end, cache, symbol, log))
            except MarketError as exc:
                placed = ", ".join(item["symbols"][0] for item in imports)
                if placed:
                    raise MarketError(f"{symbol}: {exc.message}; written meanwhile: {placed}", code=exc.code,
                                      missing=exc.missing) from exc
                raise
        commit = files.latest_commit(market)
    return {"month": f"{month:%Y-%m}", "imports": imports, "metrics_rows": sum(item["metrics_rows"] for item in imports),
            "market_day": commit, "seconds": round(time.monotonic() - started, 1)}


def _import(market: files.Market, month: date, start: int, end: int, cache: Path, symbol: str, log) -> dict:
    """One contract's published days in [start, end) the file does not hold, added to the stored rows."""
    label = f"{month:%Y-%m}"
    held = held_days(market, symbol, month)
    days = [day for at in range(start, end, store.DAY) if (day := series._ms_day(at)) not in held]
    if not days:
        raise _refuse(f"the market already holds every closed day of {label} metrics of {symbol}",
                      "MONTH_EXISTS", missing=(label,))
    found = {}
    for day in days:
        try:
            found[day] = sources.fetch_archive(cache, sources.metrics_key(symbol, day.isoformat()))
        except MarketError as exc:
            if exc.code != "ARCHIVE_NOT_PUBLISHED":
                raise
    if not found:
        raise _refuse(f"{symbol}: no metrics archive of {days[0]}..{days[-1]} is published", "ARCHIVE_NOT_PUBLISHED",
                      missing=(symbol,))
    # A day missing within SETTLE_DAYS may still be published: the days after it wait, so a commit through them cannot
    # read a hole that fills in later. Older than that it is a hole the archive left.
    settled = datetime.now(UTC).date() - timedelta(days=SETTLE_DAYS)
    waiting = [day for day in days if day not in found and day < max(found) and day >= settled]
    if waiting:
        found = {day: path for day, path in found.items() if day < waiting[0]}
        if not found:
            raise _refuse(f"{symbol}: the metrics archive of {waiting[0]} is not published yet; the days after it wait",
                          "ARCHIVE_NOT_PUBLISHED", missing=(symbol,))
    readings, new = {}, []
    for day in sorted(found):
        kept, readings[day.isoformat()] = rows(found[day], symbol, day.isoformat())
        if kept:
            new.append(batch(kept))
        log(f"{symbol} {day}: {len(kept)} metrics rows")
    stored = list(files.scan(market, None, "metrics", [symbol], series._day_ms(month),
                             series._day_ms(universe.next_month(month))))
    merged = pa.Table.from_batches(stored + new, files.METRICS.schema).sort_by(
        [(name, "ascending") for name in files.METRICS.key]).combine_chunks()
    written = files.write_file(market, "metrics", month, symbol, merged.to_batches())
    files.place(market, [written])
    return {"month": label, "from": min(found).isoformat(), "through": (max(found) + timedelta(days=1)).isoformat(),
            "symbols": [symbol], "readings": {symbol: readings},
            "unpublished": {symbol: [day.isoformat() for day in days if day not in found and day < max(found)]},
            "metrics_rows": sum(item.num_rows for item in new)}


def batch(found: list[tuple]) -> pa.RecordBatch:
    """rows()'s tuples as rows of the metrics table: the decimal texts exactly, empty ratios as nulls."""
    schema = files.METRICS.schema
    return pa.RecordBatch.from_arrays(
        [pa.array([row[0] for row in found], pa.string()), pa.array([row[1] for row in found], pa.int64()),
         *(pa.array([None if row[index] is None else Decimal(row[index]) for row in found], schema.field(index).type)
           for index in range(2, len(schema)))], schema=schema)
