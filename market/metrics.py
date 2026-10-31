"""Binance USD-M daily `metrics` archives: open interest and three long/short ratios, one row every five
minutes, stored as the archive gives them (market.import_metrics).

A row stamped `create_time` t describes t + 5 min (its open interest equals REST's at t + 5 min, measured
2026-10-31; docs/plans/binance-open-interest-input.zh.md), so nothing in it is known before then; the
exporter, not the import, applies the visibility rule. The archive's taker volume ratio (a trade aggregate)
and open interest value (open interest times an exchange price snapshot) are not stored.

Each contract month is one transaction and one commit on the restricted import account under the import
lock and commit tests. A month is imported through its last closed UTC day and a later import appends the
days after that: the archive carries no sequence to check across an interruption.
"""

from __future__ import annotations

import csv
from datetime import UTC, date, datetime
from decimal import Decimal, InvalidOperation
import io
import json
from pathlib import Path
import time
import zipfile
import zlib

import pymysql

from market import series, sources, store, universe
from market.sources import MarketError, _refuse


IMPORT = store.METRICS_IMPORT
COLUMNS = ("create_time", "symbol", "sum_open_interest", "sum_open_interest_value", "count_toptrader_long_short_ratio",
           "sum_toptrader_long_short_ratio", "count_long_short_ratio", "sum_taker_long_short_vol_ratio")
RATIOS = ("count_toptrader_long_short_ratio", "sum_toptrader_long_short_ratio", "count_long_short_ratio")
STEP = 300_000  # one row every five minutes
SCALE = 16  # the most decimals an archive has used (2022); DECIMAL(38,16) in market/schema.sql
INTEGER_DIGITS = 38 - SCALE
INSERT = "INSERT INTO metrics VALUES (%s,%s,%s,%s,%s,%s)"


def exact(text: str, label: str) -> str:
    """The archive's decimal text as the stored column holds it exactly; never rounded."""
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
    if value and (value.adjusted() >= INTEGER_DIGITS or decimals > SCALE):
        raise _refuse(f"{label}: {text!r} does not fit DECIMAL(38,{SCALE}) exactly", "SCALE_LOSS", missing=(label,))
    return format(value, "f")


def rows(path: Path, symbol: str, day: str) -> tuple[list[tuple], dict]:
    """One day's rows in time order, and its readings: rows kept, identical repeats merged, empty ratios."""
    label = f"{symbol} {day}"
    low = series._day_ms(date.fromisoformat(day))
    found: dict[int, tuple] = {}
    readings = {"rows": 0, "repeated_rows": 0, "empty": dict.fromkeys(RATIOS, 0)}
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
                        readings["repeated_rows"] += 1
                        continue
                    found[moment] = value
                    for name in RATIOS:
                        readings["empty"][name] += not item[name]
    except (ValueError, csv.Error, UnicodeError, zipfile.BadZipFile, zlib.error, EOFError) as exc:
        raise _refuse(f"{label}: rows do not parse as metrics ({exc})", "SOURCE_SHAPE", missing=(label,)) from exc
    readings["rows"] = len(found)
    return [found[moment] for moment in sorted(found)], readings


def import_month(profile: dict, month: date, cache: Path, symbols: list[str] | None = None, log=print) -> dict:
    """market.import_metrics: append each contract's days of `month` not yet held, through the last closed
    UTC day, one transaction and commit per contract (default: the month's universe members). A refused
    contract leaves the earlier contracts' commits in place; its refusal names them."""
    started = time.monotonic()
    scope = store._scope(symbols)
    if not isinstance(month, date) or isinstance(month, datetime) or month.day != 1:
        raise _refuse(f"{month!r} is not the first day of a month", "MONTH_INVALID", missing=(str(month),))
    start = series._day_ms(month)
    end = min(series._day_ms(universe.next_month(month)), series._day_ms(datetime.now(UTC).date()))
    if start >= end:
        raise _refuse(f"{month:%Y-%m} has no closed UTC day yet", "MONTH_INVALID", missing=(f"{month:%Y-%m}",))
    conn = store.connect(profile, "import")
    imports: list[dict] = []
    try:
        store.lock(conn)
        if conn.empty:
            raise _refuse("the market database holds no bar import yet", "MARKET_EMPTY")
        if conn.rows("SELECT table_name FROM dolt_status"):
            raise _refuse("the market database has uncommitted changes", "DIRTY_WORKING_SET", missing=("dolt_status",))
        store.require_commit_checks(conn)
        if not conn.rows("SHOW TABLES LIKE 'metrics'"):
            raise _refuse("metrics is missing; run market upgrade first", "SCHEMA_MISMATCH", missing=("metrics",))
        if scope is None:
            scope = [symbol for (symbol,) in conn.rows("SELECT symbol FROM universe_month WHERE universe_rule = %s "
                                                         "AND month = %s ORDER BY symbol", (conn.universe_rule, month))]
            if not scope:
                raise _refuse(f"{month:%Y-%m} has no universe members in the market database; import its bars first "
                              "or name --symbols", "UNIVERSE_UNKNOWN", missing=(f"{month:%Y-%m}",))
        held = {}
        for item in store.metrics_imports(conn):
            if item["month"] == f"{month:%Y-%m}":
                for symbol in item["symbols"]:
                    held[symbol] = max(held.get(symbol, start), series._day_ms(date.fromisoformat(item["through"])))
        for symbol in scope:
            try:
                imports.append(_import(conn, month, held.get(symbol, start), end, cache, symbol, log))
            except BaseException as exc:
                try:
                    conn.raw.rollback()
                except pymysql.MySQLError:
                    pass
                committed = ", ".join(f"{item['symbols'][0]} {item['market_commit']}" for item in imports)
                if committed and isinstance(exc, MarketError):
                    raise MarketError(f"{symbol}: {exc.message}; committed meanwhile: {committed}", code=exc.code,
                                      missing=exc.missing) from exc
                raise
    finally:
        conn.close()  # also releases the import lock
    return {"month": f"{month:%Y-%m}", "imports": imports, "metrics_rows": sum(item["metrics_rows"] for item in imports),
            "seconds": round(time.monotonic() - started, 1)}


def _import(conn, month: date, start: int, end: int, cache: Path, symbol: str, log) -> dict:
    """One contract's days [start, end): unpublished days after the last published one stay for a later import
    (the archive appears a day late); unpublished days before it are recorded and never filled."""
    label = f"{month:%Y-%m}"
    if start >= end:
        raise _refuse(f"the market database already holds every closed day of {label} metrics of {symbol}",
                      "MONTH_EXISTS", missing=(label,))
    days = [series._ms_day(at).isoformat() for at in range(start, end, store.DAY)]
    found = {}
    for day in days:
        try:
            found[day] = sources.fetch_archive(cache, sources.metrics_key(symbol, day))
        except MarketError as exc:
            if exc.code != "ARCHIVE_NOT_PUBLISHED":
                raise
    if not found:
        raise _refuse(f"{symbol}: no metrics archive of {days[0]}..{days[-1]} is published", "ARCHIVE_NOT_PUBLISHED",
                      missing=(symbol,))
    last = max(found)
    unpublished = [day for day in days if day not in found and day < last]
    archives, readings, total = {}, {}, 0
    for day in sorted(found):
        kept, readings[day] = rows(found[day], symbol, day)
        conn.many(INSERT, kept)
        archives[day] = store._published_sha(found[day])
        total += len(kept)
        log(f"{symbol} {day}: {len(kept)} metrics rows")
    receipt = {"import": IMPORT, "month": label, "from": days[0],
               "through": series._ms_day(series._day_ms(date.fromisoformat(last)) + store.DAY).isoformat(),
               "symbols": [symbol], "archives": {symbol: archives}, "readings": {symbol: readings},
               "unpublished": {symbol: unpublished}}
    commit = store._commit(conn, json.dumps(receipt, separators=(",", ":"), ensure_ascii=False))
    return {**receipt, "metrics_rows": total, "market_commit": commit}
