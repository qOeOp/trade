"""Import Binance public data into the market database, and read what it holds.

One import is one Dolt commit on main, through a covered-through day (exclusive, UTC):

1. daily quote volume of every eligible USDT perpetual (the pool's input);
2. the pool for every month whose eve is covered, checked against the months already stored;
3. for every contract the pool ever held: its terms, its 1-minute LAST and MARK bars and its
   funding, from where the stored rows end.

Sources are spliced in one order (monthly archive, daily archive, public REST) and the splice is
invisible above this module: a series is one sorted, duplicate-free run of closed minutes, and a
minute two sources both hold must agree exactly. Minutes no source holds (trading halts, a
delisting and relisting) stay missing and are reported. Stored rows are never rewritten. An
interrupted import keeps its rows in the working set; `--resume` continues from them.
"""

from __future__ import annotations

from concurrent.futures import ProcessPoolExecutor, ThreadPoolExecutor, as_completed
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
import io
import json
from pathlib import Path
import shutil
import tempfile
import time
import zipfile

import numpy as np
import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.csv as pcsv

from research.market import binance, universe
from research.records import db
from research.records.common import RecordError


PRICE_SCALE = 8
VOLUME_SCALE = 4
MINUTE = 60_000
DAY = 86_400_000
FIRST_MS = universe.day_ms(universe.ARCHIVES_BEGIN)
TERMS = ("price_increment", "size_increment", "min_quantity", "max_quantity", "min_notional", "min_price",
         "max_price")
_COLUMNS = ("open_time", "open", "high", "low", "close", "volume", "close_time")
_SCHEMA = pa.schema([("open_time", pa.int64()), *((name, pa.string()) for name in _COLUMNS[1:6]),
                     ("close_time", pa.int64())])


def _refuse(message, code="MARKET_REFUSED", **extra):
    return RecordError(message, code=code, write_status="not_written", **extra)


def default_cache() -> Path:
    return Path(tempfile.gettempdir()) / "trade-market-cache"


# One series from all sources

def _kline_table(path: Path) -> pa.Table:
    with zipfile.ZipFile(path) as archive:
        (name,) = archive.namelist()
        raw = archive.read(name)
    header = raw.startswith(b"open_time")
    table = pcsv.read_csv(io.BytesIO(raw), read_options=pcsv.ReadOptions(
        column_names=None if header else list(binance.KLINE_COLUMNS)),
        convert_options=pcsv.ConvertOptions(include_columns=list(_COLUMNS),
                                            column_types={field.name: field.type for field in _SCHEMA}))
    return table.select(list(_COLUMNS)).cast(_SCHEMA)


def _rest_table(rows: list[tuple]) -> pa.Table:
    return pa.table([pa.array([row[index] for row in rows], field.type) for index, field in enumerate(_SCHEMA)],
                    schema=_SCHEMA)


def _months(start_ms: int, end_ms: int) -> list[str]:
    first = universe.ms_day(start_ms).replace(day=1)
    return [month.strftime("%Y-%m") for month in universe.months(first, universe.ms_day(end_ms - 1))]


def missing(times: np.ndarray, start: int, end: int, step: int = MINUTE) -> list[tuple[int, int]]:
    """Missing [from, to) runs of the step grid in [start, end), given sorted grid times present."""
    if start >= end:
        return []
    edges = np.concatenate([[start - step], times[(times >= start) & (times < end)], [end]])
    jumps = np.nonzero(np.diff(edges) > step)[0]
    return [(int(edges[i] + step), int(edges[i + 1])) for i in jumps]


def _merge(parts: list[pa.Table], start: int, end: int, label: str) -> pa.Table:
    """One sorted run without duplicates in [start, end); a minute held twice must agree exactly."""
    parts = [part for part in parts if part.num_rows]
    table = pa.concat_tables(parts) if parts else _SCHEMA.empty_table()
    table = table.filter(pc.and_(pc.greater_equal(table["open_time"], start), pc.less(table["open_time"], end)))
    table = table.sort_by("open_time")
    times = table["open_time"].to_numpy()
    same = np.nonzero(np.diff(times) == 0)[0]
    if len(same):
        first, second = table.take(pa.array(same)), table.take(pa.array(same + 1))
        differs = [int(first["open_time"][i].as_py()) for i in range(len(same))
                   if first.slice(i, 1).to_pylist() != second.slice(i, 1).to_pylist()]
        if differs:
            raise _refuse(f"{label}: sources disagree at open_time {differs[:5]}", "SOURCE_CONFLICT")
        keep = np.ones(len(times), bool)
        keep[same + 1] = False
        table = table.filter(pa.array(keep))
    if table.num_rows and not pc.all(pc.equal(table["close_time"],
                                              pc.add(table["open_time"], MINUTE - 1))).as_py():
        raise _refuse(f"{label}: a row is not a closed one-minute kline", "SOURCE_SHAPE")
    return table


def _rest(fetch, *args, trading: bool):
    """Public REST rows; a contract no longer trading may be unknown to REST, which then has none."""
    try:
        return fetch(*args)
    except binance.UnknownSymbol:
        if trading:
            raise
        return []


def series(cache: binance.Cache, symbol: str, price_type: str, start: int, end: int, *, resumed: bool,
           trading: bool) -> tuple[pa.Table, list[tuple[int, int]]]:
    """The 1-minute klines of one series in [start, end) and the minutes no source holds.

    `resumed`: `start` continues stored rows, so missing minutes count from it; otherwise from the
    first minute any source holds. `trading`: the contract still trades, so minutes up to `end`
    are expected; otherwise up to the last minute any source holds.
    """
    kind, label = binance.KINDS[price_type], f"{symbol} {price_type}"
    if start >= end:
        return _SCHEMA.empty_table(), []
    months = _months(start, end)
    monthly = {binance.period(key): key for key in binance.archive_keys("monthly", kind, symbol, "1m")}
    parts = [_kline_table(path) for path in cache.fetch_all([monthly[m] for m in months if m in monthly], 4)]
    daily = {}

    def add_days(days: set[date]) -> None:
        for stem in sorted({day.strftime("%Y-%m") for day in days}):
            if stem not in daily:
                daily[stem] = binance.archive_keys("daily", kind, symbol, "1m", stem)
        keys = [key for stem in sorted({day.strftime("%Y-%m") for day in days}) for key in daily[stem]
                if date.fromisoformat(binance.period(key)) in days]
        parts.extend(_kline_table(path) for path in cache.fetch_all(keys, 4))

    # Months without a monthly archive (the open month, a missing one) come from daily archives.
    add_days({universe.ms_day(t) for m in months if m not in monthly
              for t in range(max(start, universe.day_ms(date.fromisoformat(m + "-01"))),
                             min(end, universe.day_ms(date.fromisoformat(m + "-01")) + 31 * DAY), DAY)
              if universe.ms_day(t).strftime("%Y-%m") == m})
    table = _merge(parts, start, end, label)
    if not table.num_rows and (trading or resumed):
        # No archive at all (Binance publishes no markPriceKlines for some symbols, e.g. non-ASCII
        # ones, and none yet for a contract listed this month): public REST for the whole range.
        parts.append(_rest_table(_rest(binance.rest_klines, price_type, symbol, "1m", start, end, trading=trading)))
        table = _merge(parts, start, end, label)
    if not table.num_rows:
        return table, ([(start, end)] if resumed and trading else [])
    times = table["open_time"].to_numpy()
    low = start if resumed else int(times[0])
    high = end if trading else int(times[-1]) + MINUTE
    gaps = missing(times, low, high)
    if gaps:
        add_days({universe.ms_day(t) for a, b in gaps for t in range(a - a % DAY, b, DAY)})
        table = _merge(parts, start, end, label)
        gaps = missing(table["open_time"].to_numpy(), low, high)
    for a, b in gaps:
        rows = _rest(binance.rest_klines, price_type, symbol, "1m", a, b, trading=trading)
        if rows:
            parts.append(_rest_table(rows))
    if gaps:
        table = _merge(parts, start, end, label)
        gaps = missing(table["open_time"].to_numpy(), low, high)
    return table, gaps


# Exact scaling

def _wide(column) -> pa.Array:
    column = column.combine_chunks() if isinstance(column, pa.ChunkedArray) else column
    return pc.cast(column, pa.decimal128(38, 18))


def _int64(decimal: pa.Array, label: str) -> np.ndarray:
    words = np.frombuffer(decimal.buffers()[1], dtype=np.int64)[
        decimal.offset * 2:(decimal.offset + len(decimal)) * 2].reshape(-1, 2)
    if not np.all(words[:, 1] == words[:, 0] >> 63):
        raise _refuse(f"{label}: a scaled value exceeds BIGINT", "SCALE_RANGE")
    return words[:, 0].copy()


def scaled(column, scale: int, label: str, *, float_tails: bool = False) -> tuple[np.ndarray, int]:
    """Decimal strings as integers at `scale`, exactly.

    With `float_tails`, a value whose extra digits are a binary-float rendering of a value at
    `scale` (Binance archives hold a few, such as 108824285.69999999) is rounded to it; the count
    of such values is returned. Any other value with more decimals is refused.
    """
    wide = _wide(column)
    try:
        return _int64(pc.cast(wide, pa.decimal128(38, scale), safe=True), label), 0
    except pa.ArrowInvalid:
        if not float_tails:
            raise _refuse(f"{label}: a value has more than {scale} decimals", "SCALE_LOSS") from None
    rounded = pc.cast(pc.round(wide, ndigits=scale, round_mode="half_to_even"), pa.decimal128(38, scale))
    exact = pc.cast(rounded, pa.decimal128(38, 18))
    changed = pc.not_equal(exact, wide)
    error = pc.abs(pc.subtract(pc.cast(wide, pa.float64()), pc.cast(exact, pa.float64())))
    tolerance = pc.max_element_wise(pc.multiply(pc.abs(pc.cast(wide, pa.float64())), 1e-12), 1e-12)
    if not pc.all(pc.less_equal(error, tolerance)).as_py():
        raise _refuse(f"{label}: a value has more than {scale} decimals", "SCALE_LOSS")
    return _int64(rounded, label), int(pc.sum(changed).as_py() or 0)


def significant_decimals(column) -> int:
    """The most decimals any value needs, ignoring trailing zeros."""
    column = column.combine_chunks() if isinstance(column, pa.ChunkedArray) else column
    fraction = pc.extract_regex(column, r"^[^.]*(?:\.(?P<d>\d*))?$").field("d")
    return int(pc.max(pc.utf8_length(pc.utf8_rtrim(pc.fill_null(fraction, ""), "0"))).as_py() or 0)


def bar_rows(table: pa.Table, symbol: str, price_type: str) -> tuple[pa.Table, int]:
    label = f"{symbol} {price_type}"
    prices = {name: scaled(table[name], PRICE_SCALE, f"{label} {name}")[0] for name in ("open", "high", "low", "close")}
    volume, rounded = scaled(table["volume"], VOLUME_SCALE, f"{label} volume", float_tails=True)
    o, h, l, c = (prices[name] for name in ("open", "high", "low", "close"))
    bad = (l > np.minimum(o, c)) | (h < np.maximum(o, c)) | (l <= 0) | (volume < 0)
    if price_type == "MARK":
        bad |= volume != 0
    if bad.any():
        raise _refuse(f"{label}: inconsistent bar at open_time {table['open_time'][int(np.argmax(bad))]}",
                      "SOURCE_SHAPE")
    n = table.num_rows
    return pa.table({"symbol": pa.array([symbol] * n, pa.string()), "price_type": pa.array([price_type] * n),
                     "ts_open": table["open_time"], **{k: pa.array(v) for k, v in prices.items()},
                     "volume": pa.array(volume)}), rounded


INSERT_ROWS = 20_000


def insert_statements(rows: pa.Table, symbol: str, price_type: str):
    """Multi-row INSERT statements of `INSERT_ROWS` bars each (the writer has no FILE privilege)."""
    if "'" in symbol or "\\" in symbol:
        raise _refuse(f"unexpected character in symbol {symbol!r}", "SOURCE_SHAPE")
    prefix = f"('{symbol}','{price_type}',".encode()
    numbers = rows.select(["ts_open", "open", "high", "low", "close", "volume"])
    for offset in range(0, numbers.num_rows, INSERT_ROWS):
        sink = io.BytesIO()
        pcsv.write_csv(numbers.slice(offset, INSERT_ROWS), sink,
                       write_options=pcsv.WriteOptions(include_header=False, quoting_style="none"))
        body = sink.getvalue().rstrip(b"\n").replace(b"\n", b")," + prefix)
        yield b"INSERT INTO bar VALUES " + prefix + body + b")"


# Terms

def listed_terms(item: dict) -> dict:
    filters = {entry["filterType"]: entry for entry in item["filters"]}
    price, lot = filters["PRICE_FILTER"], filters["LOT_SIZE"]
    return {"terms_source": "exchange_info", "price_increment": price["tickSize"], "size_increment": lot["stepSize"],
            "min_quantity": lot["minQty"], "max_quantity": lot["maxQty"],
            "min_notional": filters["MIN_NOTIONAL"]["notional"], "min_price": price["minPrice"],
            "max_price": price["maxPrice"]}


def inferred_terms(last: pa.Table) -> dict:
    """Increments of a contract absent from exchangeInfo: the most decimals its trades used."""
    price = max(significant_decimals(last[name]) for name in ("open", "high", "low", "close"))
    volume = last["volume"].combine_chunks()
    size = significant_decimals(pc.filter(volume, pc.less(pc.utf8_length(volume), 17)))
    return {"terms_source": "inferred", "price_increment": format(Decimal(1).scaleb(-price), "f"),
            "size_increment": format(Decimal(1).scaleb(-size), "f"),
            **{name: None for name in TERMS[2:]}}


# One contract, prepared in a worker process

def prepare(job: dict) -> dict:
    """Fetch, check and scale one contract's new bars and funding; bars go to statements under `work`."""
    try:
        return _prepare(job)
    except Exception as exc:
        raise RuntimeError(f"{job['symbol']}: {exc}") from exc


def _prepare(job: dict) -> dict:
    binance.REST_INTERVAL, binance.FUNDING_INTERVAL = job["rest_interval"]
    started = time.monotonic()
    symbol, cache, end, trading = job["symbol"], binance.Cache(Path(job["cache"])), job["end"], job["trading"]
    stored = job["stored"]
    last, last_gaps = series(cache, symbol, "LAST", stored.get("LAST", job["listed"]), end,
                             resumed="LAST" in stored, trading=trading)
    span = (job["first_last"] if "LAST" in stored else (int(last["open_time"][0].as_py()) if last.num_rows else end),
            int(last["open_time"][-1].as_py()) + MINUTE if last.num_rows else stored.get("LAST", end))
    mark_from = stored.get("MARK", span[0])
    mark, mark_gaps = series(cache, symbol, "MARK", mark_from, span[1], resumed=True, trading=True)
    report = {"symbol": symbol, "rows": {"LAST": last.num_rows, "MARK": mark.num_rows},
              "gaps": {"LAST": last_gaps, "MARK": mark_gaps}, "rounded_volumes": 0, "terms": None}
    if job["terms"] is None and last.num_rows and "LAST" not in stored:
        report["terms"] = inferred_terms(last)
    if last.num_rows:
        report["price_decimals"] = max(significant_decimals(last[name]) for name in ("open", "high", "low", "close"))
    path = Path(job["work"]) / f"{symbol.encode().hex()}.sql"
    with open(path, "wb") as stream:
        for price_type, table in (("LAST", last), ("MARK", mark)):
            if table.num_rows:
                rows, rounded = bar_rows(table, symbol, price_type)
                for statement in insert_statements(rows, symbol, price_type):
                    stream.write(statement + b"\0")
                report["rounded_volumes"] += rounded
    report["statements"] = str(path)
    report["funding"] = funding(cache, symbol, job["stored_funding"], max(span[0], FIRST_MS), end, trading=trading)
    report["seconds"] = round(time.monotonic() - started, 1)
    return report


def funding(cache: binance.Cache, symbol: str, after: int | None, start: int, end: int, *,
            trading: bool) -> list[tuple[int, str]]:
    """Settlements in (after, end): monthly archives, then public REST (there are no daily archives)."""
    start = after + 1 if after is not None else start
    if start >= end:
        return []
    months = _months(start, end)
    monthly = {binance.period(key): key for key in binance.archive_keys("monthly", "fundingRate", symbol, None)}
    rows: dict[int, str] = {}

    def add(found) -> None:
        for time_ms, rate in found:
            if Decimal(rows.get(time_ms, rate)) != Decimal(rate):
                raise _refuse(f"{symbol} funding: sources disagree at {time_ms}", "SOURCE_CONFLICT")
            rows.setdefault(time_ms, rate)

    for path in cache.fetch_all([monthly[m] for m in months if m in monthly], 4):
        add(binance.funding_rows(path))
    if trading or any(m not in monthly for m in months):
        tail = max([time_ms for time_ms in rows if time_ms < end], default=start - 1) + 1
        add(_rest(binance.rest_funding, symbol, tail, end, trading=trading))
    return sorted((time_ms, rate) for time_ms, rate in rows.items() if start <= time_ms < end)


# The import

def _rows(conn, statement, params=None):
    return db.rows(conn, statement, params)


def _stored_state(conn, symbol: str) -> dict:
    state = {"stored": {}, "first_last": None}
    for price_type in ("LAST", "MARK"):
        found = _rows(conn, "SELECT ts_open FROM bar WHERE symbol = %s AND price_type = %s "
                            "ORDER BY ts_open DESC LIMIT 1", (symbol, price_type))
        if found:
            state["stored"][price_type] = found[0][0] + MINUTE
    first = _rows(conn, "SELECT ts_open FROM bar WHERE symbol = %s AND price_type = 'LAST' ORDER BY ts_open LIMIT 1",
                  (symbol,))
    state["first_last"] = first[0][0] if first else None
    found = _rows(conn, "SELECT funding_time FROM funding WHERE symbol = %s ORDER BY funding_time DESC LIMIT 1",
                  (symbol,))
    state["stored_funding"] = found[0][0] if found else None
    terms = db.dicts(conn, "SELECT * FROM instrument WHERE symbol = %s ORDER BY observed_at DESC LIMIT 1", (symbol,))
    state["terms_row"] = terms[0] if terms else None
    return state


def run_import(profile: dict, *, through: date, cache_root: Path, workers: int = 4, resume: bool = False,
               log=print) -> dict:
    """Append everything up to `through` (exclusive) and commit once on main."""
    started = time.monotonic()
    today = datetime.now(UTC).date()
    if through > today:
        raise _refuse(f"--through {through} is after today ({today} UTC); only closed days are imported")
    end = universe.day_ms(through)
    cache = binance.Cache(cache_root)
    work = Path(tempfile.mkdtemp(prefix="market-load-", dir=cache_root.parent if cache_root.parent.exists() else None))
    conn = db.connect(profile, "writer")
    try:
        if _rows(conn, "SELECT table_name FROM dolt_status") and not resume:
            raise _refuse("the market database has uncommitted rows from an interrupted import",
                          "DIRTY_WORKING_SET", next_actions=["Rerun the same import with --resume."])
        (version, price_scale, volume_scale, rule), = _rows(
            conn, "SELECT version, price_scale, volume_scale, pool_rule FROM market_schema")
        if (version, price_scale, volume_scale, rule) != (db.MARKET_SCHEMA_VERSION, PRICE_SCALE, VOLUME_SCALE,
                                                          universe.POOL_RULE):
            raise _refuse("the market database was written under another schema, scale or pool rule", "MARKET_SCHEMA")
        info = binance.exchange_info()
        observed = int(info["serverTime"])
        listed = {item["symbol"]: item for item in info["symbols"]}
        split = universe.classify(binance.archive_symbols(), info)
        log(f"{len(split['eligible'])} eligible contracts, {len(split['excluded'])} excluded")

        # 1. Daily quote volume.
        stored_days = dict(_rows(conn, "SELECT symbol, MAX(day) FROM daily_volume GROUP BY symbol"))

        def volumes(symbol):
            since = stored_days.get(symbol)
            trading = listed.get(symbol, {}).get("status") == "TRADING"
            return symbol, universe.daily_volume(cache, symbol, through, trading=trading,
                                                 since=since + timedelta(days=1) if since else None)

        new_days = 0
        with ThreadPoolExecutor(8) as pool:
            for symbol, rows in pool.map(volumes, split["eligible"]):
                since = stored_days.get(symbol)
                rows = [(symbol, day, value) for day, value in rows if since is None or day > since]
                if rows:
                    with conn.cursor() as cursor:
                        cursor.executemany("INSERT INTO daily_volume VALUES (%s, %s, %s)", rows)
                    new_days += len(rows)
        log(f"daily volume: {new_days} new rows ({time.monotonic() - started:.0f}s)")

        # 2. Pool.
        by_symbol: dict[str, list] = {}
        for symbol, day, value in _rows(conn, "SELECT symbol, day, quote_volume FROM daily_volume ORDER BY symbol, day"):
            by_symbol.setdefault(symbol, []).append((day, value))
        computed = universe.pool(by_symbol, universe.FIRST_MONTH, through.replace(day=1) if through.day > 1
                                 else through)
        stored_pool = {(month, rank, symbol) for month, rank, symbol in _rows(conn, "SELECT month, `rank`, symbol FROM pool")}
        stored_months = {month for month, _, _ in stored_pool}
        changed = sorted({row[0] for row in computed if row[0] in stored_months} ^ stored_months) or sorted(
            {month for month, rank, symbol, _ in computed if month in stored_months
             and (month, rank, symbol) not in stored_pool})
        if changed:
            raise _refuse(f"the pool recomputed from stored volumes differs for {changed[:3]}", "POOL_CHANGED")
        new_pool = [(month, rank, symbol) for month, rank, symbol, _ in computed if month not in stored_months]
        if new_pool:
            with conn.cursor() as cursor:
                cursor.executemany("INSERT INTO pool VALUES (%s, %s, %s)", new_pool)
        members = sorted({symbol for _, _, symbol, _ in computed})
        log(f"pool: {len(new_pool)} new rows; {len(members)} contracts ever in it")

        # 3. Contracts: terms, bars and funding.
        jobs = []
        for symbol in members:
            state = _stored_state(conn, symbol)
            item = listed.get(symbol)
            trading = bool(item) and item.get("status") == "TRADING"
            terms = listed_terms(item) if item else None
            if terms and (state["terms_row"] is None or any(
                    str(state["terms_row"][key]) != str(terms[key]) for key in ("terms_source", *TERMS))):
                with conn.cursor() as cursor:
                    cursor.execute("INSERT INTO instrument VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
                                   (symbol, observed, terms["terms_source"], *(terms[key] for key in TERMS)))
            listed_day = by_symbol[symbol][0][0]
            jobs.append({"symbol": symbol, "cache": str(cache_root), "work": str(work), "end": end,
                         "trading": trading, "terms": terms or state["terms_row"],
                         "listed": max(FIRST_MS, universe.day_ms(listed_day)), **state,
                         "rest_interval": (binance.REST_INTERVAL * workers, binance.FUNDING_INTERVAL * workers)})
        totals = {"rows": 0, "funding": 0, "rounded_volumes": 0, "gaps": {}, "inferred": [], "price_decimals": {}}
        pool = ProcessPoolExecutor(workers)
        futures = [pool.submit(prepare, {key: value for key, value in job.items() if key != "terms_row"})
                   for job in jobs]
        try:
            for done, future in enumerate(as_completed(futures), start=1):
                report = future.result()
                symbol = report["symbol"]
                loaded = time.monotonic()
                statements = Path(report["statements"])
                with conn.cursor() as cursor:
                    for statement in statements.read_bytes().split(b"\0"):
                        if statement:
                            cursor.execute(statement)
                statements.unlink()
                if report["funding"]:
                    with conn.cursor() as cursor:
                        cursor.executemany("INSERT INTO funding VALUES (%s, %s, %s)",
                                           [(symbol, t, rate) for t, rate in report["funding"]])
                if report["terms"]:
                    terms = report["terms"]
                    with conn.cursor() as cursor:
                        cursor.execute("INSERT INTO instrument VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
                                       (symbol, observed, "inferred", *(terms[key] for key in TERMS)))
                    totals["inferred"].append(symbol)
                rows = report["rows"]["LAST"] + report["rows"]["MARK"]
                totals["rows"] += rows
                totals["funding"] += len(report["funding"])
                totals["rounded_volumes"] += report["rounded_volumes"]
                if report.get("price_decimals") is not None:
                    totals["price_decimals"][symbol] = report["price_decimals"]
                gaps = {key: value for key, value in report["gaps"].items() if value}
                if gaps:
                    totals["gaps"][symbol] = gaps
                log(f"[{done}/{len(jobs)}] {symbol}: {rows} bars, {len(report['funding'])} funding, "
                    f"prepared {report['seconds']}s, loaded {time.monotonic() - loaded:.1f}s")
        finally:
            pool.shutdown(wait=False, cancel_futures=True)

        # 4. One commit.
        message = json.dumps({"import": "binance-public", "through": through.isoformat(),
                              "pool_rule": universe.POOL_RULE}, separators=(",", ":"))
        dirty = _rows(conn, "SELECT table_name FROM dolt_status")
        commit = _rows(conn, "CALL DOLT_COMMIT('-A', '-m', %s)", (message,))[0][0] if dirty else None
    finally:
        conn.close()
        shutil.rmtree(work, ignore_errors=True)
    return {"commit": commit, "through": through.isoformat(), "eligible": len(split["eligible"]),
            "excluded": split["excluded"], "daily_volume_rows": new_days, "pool_rows": len(new_pool),
            "pool_contracts": len(members), **totals, "seconds": round(time.monotonic() - started)}


# Reading

def resolve(conn, at: str | None) -> str:
    """The commit hash of a branch, tag or commit (default main)."""
    return _rows(conn, "SELECT DOLT_HASHOF(%s)", (db.check_ref(at or "main"),))[0][0]


def freshness(profile: dict, at: str | None = None) -> dict:
    """What a market commit holds: the pool months, the newest minute and the latest complete month."""
    conn = db.connect(profile, "reader")
    try:
        commit = resolve(conn, at)
        first_month, last_month = _rows(conn, f"SELECT MIN(month), MAX(month) FROM pool AS OF '{commit}'")[0]
        newest = None
        for (symbol,) in _rows(conn, f"SELECT symbol FROM pool AS OF '{commit}' WHERE month = %s", (last_month,)):
            found = _rows(conn, f"SELECT ts_open FROM bar AS OF '{commit}' WHERE symbol = %s AND price_type = 'LAST' "
                                "ORDER BY ts_open DESC LIMIT 1", (symbol,))
            if found and (newest is None or found[0][0] > newest):
                newest = found[0][0]
    finally:
        conn.close()
    if newest is None:
        return {"commit": commit, "pool_months": None, "covered_through": None, "latest_complete_month": None}
    covered = universe.ms_day(newest + MINUTE)  # exclusive: imports end at a UTC midnight
    return {"commit": commit, "pool_months": [first_month.isoformat()[:7], last_month.isoformat()[:7]],
            "covered_through": covered.isoformat(),
            "latest_complete_month": (covered.replace(day=1) - timedelta(days=1)).isoformat()[:7],
            "current_month_through": (covered - timedelta(days=1)).isoformat() if covered.day > 1 else None}


def read_pool(profile: dict, at: str | None = None, month: str | None = None) -> dict:
    """The pool at a commit: {month: [symbol by rank]}, and the membership intervals per contract."""
    conn = db.connect(profile, "reader")
    try:
        commit = resolve(conn, at)
        query = f"SELECT month, `rank`, symbol FROM pool AS OF '{commit}'"
        params = ()
        if month:
            query += " WHERE month = %s"
            params = (date.fromisoformat(month + "-01"),)
        found = _rows(conn, query + " ORDER BY month, `rank`", params)
    finally:
        conn.close()
    months: dict[str, list[str]] = {}
    for value, _, symbol in found:
        months.setdefault(value.isoformat()[:7], []).append(symbol)
    return {"commit": commit, "pool_rule": universe.POOL_RULE, "months": months}
