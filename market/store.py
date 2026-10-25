"""The market database (`market.connect`, `market.resolve_commit`, `market.import_month`,
`market.freshness`).

One import is one UTC month and one Dolt commit on main: every eligible contract's stitched
one-minute LAST and MARK bars and funding, terms that changed, and the common tradable range
recomputed for every month and compared with the stored months. Everything is written in one
transaction and committed once after the commit tests (dolt_tests, group commit) pass; any refusal
rolls the whole import back. The first import on an empty database (tables without the
market_schema row) also writes the schema row and the commit tests.

An engineering symbol allowlist narrows an import of an isolated market database to those contracts;
the scope is written in every import's commit message and read back by `freshness`.
"""

from __future__ import annotations

from concurrent.futures import ProcessPoolExecutor, as_completed
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
import io
import json
from pathlib import Path
import re
import shutil
import socket
import tempfile
import time
from typing import Any

import numpy as np
import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.csv as pcsv
import pymysql
import pymysql.constants.CR
import pymysql.cursors

from market import instrument, quotes, series, sources, universe
from market.sources import MINUTE, MarketError, _refuse


SCHEMA_VERSION = 2
PRICE_SCALE = series.PRICE_SCALE
VOLUME_SCALE = series.VOLUME_SCALE
DAY = 86_400_000
ROLES = {"import": "writer", "reader": "reader"}  # design role -> account name in the service's private file
REF = re.compile(r"[A-Za-z0-9][A-Za-z0-9_./-]{0,199}\Z")
HASH_PREFIX = re.compile(r"[0-9a-v]{1,32}\Z")
COMMIT_HASH = re.compile(r"[0-9a-v]{32}\Z")
WORKING_SETS = ("WORKING", "STAGED")
IMPORT = "binance-public"
QUOTE_IMPORT = "binance-aggtrades-bbo"  # quote imports: their commit messages carry quotes.RULE

# The commit tests, written once by the first import (market.dolt_tests). A day's bounds in UTC
# milliseconds come from DATEDIFF, independent of the session time zone. The eve test looks up the
# 1,440 minutes of each member's eve by full primary key: a range bound taken from each row is no
# index range on Dolt 2.4.2 (measured: a scan of the member's whole history), a key lookup is.
TESTS = (
    # The newest month's members only: earlier months are immutable and were checked by their commits.
    ("universe_members_traded_on_the_eve",
     "WITH RECURSIVE m(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM m WHERE i < 1439), "
     "members AS (SELECT symbol, month, DATEDIFF(month, '1970-01-01') * 86400000 - 86400000 AS eve FROM universe_month "
     "WHERE month = (SELECT MAX(month) FROM universe_month)) "
     "SELECT (SELECT COUNT(*) FROM members) - COUNT(DISTINCT n.symbol, n.month) FROM members n JOIN m JOIN bar b "
     "ON b.symbol = n.symbol AND b.price_type = 'LAST' AND b.ts_open = n.eve + m.i * 60000 WHERE b.volume > 0"),
    # The user's decision: every member has terms at the commit. A month imported after the fact has
    # terms observed later than the month; replays then carry the CURRENT_SNAPSHOT_APPROXIMATION
    # limitation naming the observation (engine.load.terms_approximations).
    ("universe_members_have_terms",
     "SELECT COUNT(*) FROM universe_month u WHERE NOT EXISTS (SELECT 1 FROM instrument i WHERE i.symbol = u.symbol)"),
    ("universe_rule_is_recorded",
     "SELECT COUNT(*) FROM universe_month WHERE month = (SELECT MAX(month) FROM universe_month) "
     "AND universe_rule <> (SELECT universe_rule FROM market_schema)"),
)


# Connections (market.connect)

class MarketConnection:
    """One connection to one market database as one role, with its market_schema facts."""

    def __init__(self, raw, profile: dict, role: str, facts: dict | None):
        self.raw, self.profile, self.role = raw, profile, role
        self.empty = facts is None
        facts = facts or {}
        self.version, self.price_scale = facts.get("version"), facts.get("price_scale")
        self.volume_scale, self.universe_rule = facts.get("volume_scale"), facts.get("universe_rule")
        self.import_seq = facts.get("import_seq")

    database = property(lambda self: self.profile.get("database"))

    def rows(self, statement: str, params=None) -> list[tuple]:
        try:
            with self.raw.cursor() as cursor:
                cursor.execute(statement, params)
                result = list(cursor.fetchall())
                while cursor.nextset():
                    cursor.fetchall()
                return result
        except pymysql.MySQLError as exc:
            raise _sql_error(exc) from exc

    def dicts(self, statement: str, params=None) -> list[dict]:
        try:
            with self.raw.cursor() as cursor:
                cursor.execute(statement, params)
                names = [column[0] for column in cursor.description or ()]
                return [dict(zip(names, row, strict=True)) for row in cursor.fetchall()]
        except pymysql.MySQLError as exc:
            raise _sql_error(exc) from exc

    def stream(self, statement: str, params=None, size: int = 200_000):
        """Rows in chunks through a server-side cursor (bar reads would not fit in client memory)."""
        try:
            with self.raw.cursor(pymysql.cursors.SSCursor) as cursor:
                cursor.execute(statement, params)
                while chunk := cursor.fetchmany(size):
                    yield chunk
        except pymysql.MySQLError as exc:
            raise _sql_error(exc) from exc

    def execute(self, statement, params=None) -> None:
        try:
            with self.raw.cursor() as cursor:
                cursor.execute(statement, params)
        except pymysql.MySQLError as exc:
            raise _sql_error(exc) from exc

    def many(self, statement: str, rows: list[tuple]) -> None:
        if not rows:
            return
        try:
            with self.raw.cursor() as cursor:
                cursor.executemany(statement, rows)
        except pymysql.MySQLError as exc:
            raise _sql_error(exc) from exc

    def close(self) -> None:
        try:
            self.raw.close()
        except pymysql.MySQLError:
            pass

    def __enter__(self):
        return self

    def __exit__(self, *exc) -> None:
        self.close()


def _service(profile: dict) -> dict:
    try:
        return json.loads((Path(profile["service"]) / "service.json").read_text(encoding="utf-8"))
    except (OSError, ValueError, KeyError, TypeError) as exc:
        raise _refuse(f"market profile {profile.get('name') if isinstance(profile, dict) else profile!r} names no "
                      "readable service", "MARKET_UNREACHABLE") from exc


def _service_connection(socket_path: str, **options) -> pymysql.Connection:
    """`pymysql.connect` over the service's Unix socket. pymysql 1.1.2 leaks its socket when the Unix
    connect itself fails (a stopped service), so the socket is reached first by one that is closed
    either way, and an unreachable one raises the same OperationalError pymysql would."""
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as probe:
        probe.settimeout(options.get("connect_timeout", 10))
        try:
            probe.connect(socket_path)
        except OSError as exc:
            raise pymysql.err.OperationalError(
                pymysql.constants.CR.CR_CONN_HOST_ERROR, f"Can't connect to MySQL server on {socket_path!r} ({exc})",
            ) from exc
    return pymysql.connect(unix_socket=socket_path, **options)


def connect(profile: dict, role: str) -> MarketConnection:
    """market.connect: the market database as `import` (the import account) or `reader`, its schema
    generation checked; the import account on an empty database gets the empty-database mark."""
    if role not in ROLES:
        raise _refuse(f"role must be import or reader, got {role!r}", "ROLE_UNKNOWN", missing=(str(role),))
    config = _service(profile)
    account = ((config.get("databases") or {}).get(profile.get("database")) or {}).get(ROLES[role])
    if account is None:
        raise _refuse(f"the service has no {role} account for market database {profile.get('database')}",
                      "MARKET_UNREACHABLE", missing=(str(profile.get("database")),))
    try:
        raw = _service_connection(config["socket"], user=account["user"], password=account["password"],
                                  database=profile["database"], charset="utf8mb4", autocommit=role == "reader",
                                  connect_timeout=5, read_timeout=7200, write_timeout=7200,
                                  max_allowed_packet=1 << 30)
    except pymysql.MySQLError as exc:
        raise _refuse(f"cannot connect to market database {profile.get('database')}: "
                      f"{exc.args[1] if len(exc.args) > 1 else exc}", "MARKET_UNREACHABLE",
                      missing=(str(profile.get("database")),)) from exc
    conn = MarketConnection(raw, profile, role, None)
    try:
        if role == "import":
            conn.execute("SET autocommit = 0")  # one import, one transaction (pymysql's flag alone is not applied)
        found = conn.dicts("SELECT version, price_scale, volume_scale, universe_rule, import_seq FROM market_schema "
                           "WHERE singleton = 1")
        if role == "import":
            raw.commit()
    except MarketError:
        conn.close()
        raise
    if (found and found[0]["version"] != SCHEMA_VERSION) or (not found and role == "reader"):
        conn.close()
        raise _refuse(f"market schema generation {found[0]['version'] if found else None}, this code reads "
                      f"{SCHEMA_VERSION}", "SCHEMA_VERSION_MISMATCH", missing=(str(profile.get("database")),))
    return MarketConnection(raw, profile, role, found[0] if found else None)


def _sql_error(exc: pymysql.MySQLError) -> MarketError:
    code = exc.args[0] if exc.args else None
    text = str(exc.args[1]) if len(exc.args) > 1 else str(exc)
    if code == 1213 or "conflict" in text.lower():
        return _refuse("another import landed first; this one was rolled back", "CONCURRENT_WRITE")
    if code in (1142, 1143, 1370, 1644) or (code == 1105 and "permission" in text.lower()):  # 1644: a guard trigger
        return _refuse(f"the market account may not do this: {text}", "MARKET_PERMISSION")
    return _refuse(f"the market database refused the statement (MySQL error {code}): {text}", "MARKET_SQL_ERROR")


# market.resolve_commit

def resolve_commit(conn: MarketConnection, ref: str | None) -> str:
    """market.resolve_commit: the one full commit hash a branch, tag, commit hash or unique prefix names."""
    ref = ref or "main"
    if isinstance(ref, str) and ref.upper() in WORKING_SETS:
        raise _refuse(f"{ref} is a working set, not a commit", "NOT_A_COMMIT", missing=(ref,))
    if not isinstance(ref, str) or not REF.fullmatch(ref) or ".." in ref:
        raise _refuse(f"invalid market reference {ref!r}", "UNKNOWN_REF", missing=(str(ref),))
    if HASH_PREFIX.fullmatch(ref):
        found = [commit for (commit,) in conn.rows("SELECT commit_hash FROM dolt_log WHERE commit_hash LIKE %s",
                                                   (ref + "%",))]
        if len(found) > 1:
            raise _refuse(f"{ref} is a prefix of {len(found)} market commits", "AMBIGUOUS_REF", missing=(ref,))
        if found:
            return found[0]
    for statement in ("SELECT hash FROM dolt_branches WHERE name = %s",
                      "SELECT tag_hash FROM dolt_tags WHERE tag_name = %s"):
        found = conn.rows(statement, (ref,))
        if found:
            return found[0][0]
    raise _refuse(f"{ref!r} is no branch, tag or commit of the market database", "UNKNOWN_REF", missing=(ref,))


def check_commit(commit) -> str:
    if not isinstance(commit, str) or not COMMIT_HASH.fullmatch(commit):
        raise _refuse(f"{commit!r} is not a resolved market commit hash", "MARKET_COMMIT_INVALID",
                      missing=(str(commit),))
    return commit


def default_cache() -> Path:
    return Path(tempfile.gettempdir()) / "trade-market-cache"


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
    `scale` (Binance archives hold a few, such as 108824285.69999999) is rounded to it; the count of
    such values is returned. Any other value with more decimals is refused.
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
    if not len(column):
        return 0
    fraction = pc.extract_regex(column, r"^[^.]*(?:\.(?P<d>\d*))?$").field("d")
    return int(pc.max(pc.utf8_length(pc.utf8_rtrim(pc.fill_null(fraction, ""), "0"))).as_py() or 0)


def bar_rows(table: pa.Table, symbol: str, price_type: str) -> tuple[dict[str, np.ndarray], int]:
    """A stitched minute table as integer bar columns {ts_open, open, high, low, close, volume} and the
    count of float-tail volumes rounded."""
    label = f"{symbol} {price_type}"
    prices = {name: scaled(table[name], PRICE_SCALE, f"{label} {name}")[0] for name in ("open", "high", "low", "close")}
    volume, rounded = scaled(table["volume"], VOLUME_SCALE, f"{label} volume", float_tails=True)
    if price_type == "MARK" and volume.any():
        at = table["open_time"][int(np.argmax(volume != 0))]
        raise _refuse(f"{label}: a mark-price kline at {at} carries a volume", "SOURCE_SHAPE", missing=(label,))
    o, h, lo, c = (prices[name] for name in ("open", "high", "low", "close"))
    bad = (lo > np.minimum(o, c)) | (h < np.maximum(o, c)) | (lo <= 0) | (volume < 0)
    if bad.any():
        raise _refuse(f"{label}: inconsistent bar at open_time {table['open_time'][int(np.argmax(bad))]}",
                      "SOURCE_SHAPE", missing=(label,))
    return {"ts_open": table["open_time"].to_numpy().astype(np.int64), **prices, "volume": volume}, rounded


INSERT_ROWS = 20_000


def insert_statements(bars: dict[str, np.ndarray], symbol: str, price_type: str):
    """Multi-row INSERT statements of INSERT_ROWS bars each (the import account has no FILE privilege)."""
    sources.check_symbol(symbol)
    prefix = f"('{symbol}','{price_type}',".encode()
    numbers = pa.table({name: pa.array(bars[name]) for name in series.COLUMNS})
    for offset in range(0, numbers.num_rows, INSERT_ROWS):
        sink = io.BytesIO()
        pcsv.write_csv(numbers.slice(offset, INSERT_ROWS), sink,
                       write_options=pcsv.WriteOptions(include_header=False, quoting_style="none"))
        body = sink.getvalue().rstrip(b"\n").replace(b"\n", b")," + prefix)
        yield b"INSERT INTO bar VALUES " + prefix + body + b")"


# Terms

def inferred_terms(last: pa.Table) -> dict:
    """Increments of a contract absent from exchangeInfo: the most decimals its trades used."""
    price = max(significant_decimals(last[name]) for name in ("open", "high", "low", "close"))
    volume = last["volume"].combine_chunks()
    size = significant_decimals(pc.filter(volume, pc.less(pc.utf8_length(volume), 17)))
    return {"terms_source": "inferred", "price_increment": format(Decimal(1).scaleb(-price), "f"),
            "size_increment": format(Decimal(1).scaleb(-size), "f"),
            **{name: None for name in instrument.TERMS[2:]}, "classification": None}


def listed_terms(item: dict) -> dict:
    return {"terms_source": "exchange_info", **{name: item[name] for name in instrument.TERMS},
            "classification": {"contract_type": item["contract_type"], "quote_asset": item["quote_asset"],
                               "underlying_type": item["underlying_type"],
                               "underlying_sub_types": item["underlying_sub_types"]}}


def _same_terms(stored: dict | None, terms: dict) -> bool:
    if stored is None:
        return False
    stored_class = stored.get("classification")
    if isinstance(stored_class, str):
        stored_class = json.loads(stored_class)
    return (stored["terms_source"] == terms["terms_source"] and stored_class == terms["classification"]
            and all(str(stored[name]) == str(terms[name]) if terms[name] is not None else stored[name] is None
                    for name in instrument.TERMS))


def _item_of(symbol: str, row: dict | None) -> dict | None:
    """The classification input of a stored terms row: None for inferred terms (no exchange metadata)."""
    if row is None or row.get("classification") is None:
        return None
    found = row["classification"] if isinstance(row["classification"], dict) else json.loads(row["classification"])
    quote = found.get("quote_asset") or ""
    return {"symbol": symbol, "contract_type": found.get("contract_type"), "underlying_type": found.get("underlying_type"),
            "base_asset": symbol[:-len(quote)] if quote and symbol.endswith(quote) else symbol}


# One contract, prepared in a worker process

def prepare(job: dict) -> dict:
    """Stitch, check and scale one contract's month of bars and funding; the new bars go to statements under
    `work`, the bars and funding already stored for the month come back for the comparison."""
    try:
        return _prepare(job)
    except MarketError as exc:
        raise MarketError(f"{job['symbol']}: {exc.message}", code=exc.code,
                          missing=(job["symbol"], *exc.missing)) from exc


def _prepare(job: dict) -> dict:
    sources.REST_INTERVAL, sources.FUNDING_INTERVAL = job["rest_interval"]
    started = time.monotonic()
    symbol, cache, end, trading = job["symbol"], Path(job["cache"]), job["end"], job["trading"]
    report = {"symbol": symbol, "rows": {}, "gaps": {}, "source_rows": {}, "rounded_volumes": 0, "terms": None,
              "derived_findings": None, "reread": {}}
    path = Path(job["work"]) / f"{symbol.encode().hex()}.sql"
    last = None
    with open(path, "wb") as stream:
        for price_type in ("LAST", "MARK"):
            resumed, stored_through = job["series"][price_type]
            table, gaps, used = series.stitch_series(cache, symbol, price_type, job["start"], end, resumed, trading)
            report["gaps"][price_type], report["source_rows"][price_type] = gaps, used
            if price_type == "LAST":
                last = table
            bars, rounded = bar_rows(table, symbol, price_type) if table.num_rows else (_empty_bars(), 0)
            report["rounded_volumes"] += rounded
            if price_type == "LAST" and table.num_rows:
                report["derived_findings"] = _derived_findings(symbol, bars, job, trading)
            # The month's minutes before the stored last one are reread and compared, never written again.
            old = bars["ts_open"] < (stored_through or job["start"])
            report["reread"][price_type] = {name: values[old] for name, values in bars.items()}
            new = {name: values[~old] for name, values in bars.items()}
            report["rows"][price_type] = int(len(new["ts_open"]))
            for statement in insert_statements(new, symbol, price_type):
                stream.write(statement + b"\0")
    if job["terms"] is None and last is not None and last.num_rows:
        report["terms"] = inferred_terms(last)
    report["statements"] = str(path)
    found = funding(cache, symbol, job["start"], end, trading=trading)
    stored_through = job["funding_through"] or job["start"]
    report["funding_reread"] = [row for row in found if row[0] < stored_through]
    report["funding"] = [row for row in found if row[0] >= stored_through]
    report["seconds"] = round(time.monotonic() - started, 1)
    return report


def _empty_bars() -> dict[str, np.ndarray]:
    return {name: np.empty(0, np.int64) for name in series.COLUMNS}


def _derived_findings(symbol: str, bars: dict, job: dict, trading: bool) -> list[dict] | None:
    """market.check_derived of the month's derived daily LAST bars against the exchange's native daily
    klines over the whole days held; None when the exchange no longer serves the contract."""
    first = -(-int(bars["ts_open"][0]) // DAY) * DAY
    last = (int(bars["ts_open"][-1]) + MINUTE) // DAY * DAY
    if first >= last:
        return []
    keep = (bars["ts_open"] >= first) & (bars["ts_open"] < last)
    derived = series.derive_bars({name: values[keep] for name, values in bars.items()}, "1d")
    try:
        rows = sources.rest_klines("LAST", symbol, "1d", first, last)
    except MarketError as exc:
        if exc.code == "SOURCE_UNKNOWN_SYMBOL" and not trading:
            return None
        raise
    native = bar_rows(sources.rows_table([(*row[:6], row[0] + MINUTE - 1) for row in rows]), symbol, "LAST")[0] \
        if rows else _empty_bars()
    terms = job["terms"] or {}
    price = instrument.decimals(terms["price_increment"]) if terms.get("price_increment") else PRICE_SCALE
    size = instrument.decimals(terms["size_increment"]) if terms.get("size_increment") else VOLUME_SCALE
    return series.check_derived(derived, native, "1d", price, size, price_scale=PRICE_SCALE,
                                volume_scale=VOLUME_SCALE)


HOUR = 3_600_000


def funding_slot(time_ms: int) -> int:
    """The settlement a funding time belongs to: its nearest whole UTC hour. Binance settles at most once
    an hour (intervals of 1, 4 or 8 hours) and its times carry milliseconds of jitter, so two sources'
    times in one slot are one settlement; their rates must agree."""
    return (time_ms + HOUR // 2) // HOUR


def funding(cache: Path, symbol: str, start: int, end: int, *, trading: bool) -> list[tuple[int, str]]:
    """Settlements in [start, end): monthly archives, then public REST for months without one (there
    are no daily funding archives). One settlement per funding slot: a slot held by two sources with
    different rates refuses SOURCE_CONFLICT (the earlier source's time is kept); one source holding two
    settlements in a slot refuses SOURCE_SHAPE."""
    if start >= end:
        return []
    months = series._months(start, end)
    monthly = sources.monthly_archives(cache, "fundingRate", symbol, None, months)
    slots: dict[int, tuple[int, str]] = {}

    def add(found, label: str) -> None:
        seen = set()
        for time_ms, rate in found:
            slot = funding_slot(time_ms)
            if slot in seen:
                raise _refuse(f"{symbol} funding: {label} holds two settlements in the hour of {time_ms}",
                              "SOURCE_SHAPE", missing=(str(time_ms),))
            seen.add(slot)
            if slot in slots and Decimal(slots[slot][1]) != Decimal(rate):
                raise _refuse(f"{symbol} funding: sources disagree on the settlement at {time_ms}", "SOURCE_CONFLICT",
                              missing=(str(time_ms),))
            slots.setdefault(slot, (time_ms, rate))

    for month in sorted(monthly):
        add(sources.funding_rows(monthly[month]), f"the {month} archive")
    missing = [month for month in months if month not in monthly]
    if missing:
        low = max(start, series._day_ms(date.fromisoformat(missing[0] + "-01")))
        try:
            add(sources.rest_funding(symbol, low, end), "public REST")
        except MarketError as exc:
            if exc.code != "SOURCE_UNKNOWN_SYMBOL" or trading:
                raise
    return sorted(row for row in slots.values() if start <= row[0] < end)


# The import (market.import_month)

def imports(conn: MarketConnection, ref: str = "main") -> list[dict]:
    """The import commits reachable from `ref`, oldest first: {commit, month, through, universe_rule, scope}."""
    found = []
    for commit, message in conn.rows("SELECT commit_hash, message FROM DOLT_LOG(%s)", (ref,)):
        try:
            value = json.loads(message)
        except ValueError:
            continue
        if isinstance(value, dict) and value.get("import") == IMPORT:
            found.append({"commit": commit, **{key: value.get(key) for key in ("month", "through", "universe_rule",
                                                                               "scope")}})
    return found[::-1]


def _month_ms(month: date) -> int:
    return series._day_ms(month)


def _scope(symbols, profile: dict) -> list[str] | None:
    if symbols is None:
        return None
    if (not isinstance(symbols, (list, tuple)) or not symbols or len(set(symbols)) != len(symbols)
            or any(not isinstance(item, str) or not sources.SYMBOL.fullmatch(item) for item in symbols)):
        raise _refuse("the engineering symbol allowlist is empty, repeats a contract or names a malformed one",
                      "IMPORT_SCOPE", missing=("--symbols",))
    return sorted(symbols)


def import_month(profile: dict, month: date, cache_root: Path, workers: int = 4, symbols: list[str] | None = None,
                 log=print) -> dict:
    """market.import_month: append one UTC month (the current month through the last closed day) as one
    market commit, after the latest stored month or, as a backfill, just before the earliest. `symbols` is
    the engineering allowlist of an isolated market database."""
    started = time.monotonic()
    scope = _scope(symbols, profile)
    if not isinstance(month, date) or isinstance(month, datetime) or month.day != 1:
        raise _refuse(f"{month!r} is not the first day of a month", "MONTH_INVALID", missing=(str(month),))
    today = datetime.now(UTC).date()
    start_ms, end_ms = _month_ms(month), min(_month_ms(universe.next_month(month)), series._day_ms(today))
    if start_ms >= end_ms:
        raise _refuse(f"{month:%Y-%m} has no closed UTC day yet", "MONTH_INVALID", missing=(f"{month:%Y-%m}",))
    conn = connect(profile, "import")
    work = Path(tempfile.mkdtemp(prefix="market-load-"))
    try:
        lock(conn)
        return _import(conn, month, start_ms, end_ms, Path(cache_root), workers, scope, work, log, started)
    except BaseException:
        try:
            conn.raw.rollback()
        except pymysql.MySQLError:
            pass
        raise
    finally:
        conn.close()  # also releases the import lock
        shutil.rmtree(work, ignore_errors=True)


def lock(conn: MarketConnection) -> None:
    """Hold the database's import lock for this connection's life: one import at a time."""
    name = f"market-import:{conn.database}"
    (held,), = conn.rows("SELECT GET_LOCK(%s, 0)", (name,))
    if held != 1:
        raise _refuse(f"another import of {conn.database} holds {name}", "CONCURRENT_IMPORT", missing=(name,))


def _stored(conn: MarketConnection, symbol: str, price_type: str, low: int, high: int) -> dict[str, np.ndarray]:
    found = conn.rows("SELECT ts_open, open, high, low, close, volume FROM bar WHERE symbol = %s AND price_type = %s "
                      "AND ts_open >= %s AND ts_open < %s ORDER BY ts_open", (symbol, price_type, low, high))
    stacked = np.array(found, dtype=np.int64).reshape(-1, 6)
    return {name: stacked[:, index] for index, name in enumerate(series.COLUMNS)}


def _same_bars(a: dict, b: dict) -> bool:
    return all(len(a[name]) == len(b[name]) and np.array_equal(a[name], b[name]) for name in series.COLUMNS)


def _import(conn: MarketConnection, month: date, start_ms: int, end_ms: int, cache: Path, workers: int,
            scope: list[str] | None, work: Path, log, started: float) -> dict:
    label = f"{month:%Y-%m}"
    if not conn.empty and conn.universe_rule != universe.RULE:
        raise _refuse(f"the market database produces {conn.universe_rule}, this code {universe.RULE}",
                      "RULE_VERSION_MISMATCH", missing=(str(conn.universe_rule),))
    if not conn.empty and (conn.price_scale, conn.volume_scale) != (PRICE_SCALE, VOLUME_SCALE):
        raise _refuse("the market database stores other integer scales", "SCHEMA_VERSION_MISMATCH")
    if conn.rows("SELECT table_name FROM dolt_status"):
        raise _refuse("the market database has uncommitted changes", "DIRTY_WORKING_SET", missing=("dolt_status",))
    (groups,), = conn.rows("SELECT @@GLOBAL.dolt_commit_verification_groups")
    if "commit" not in str(groups or "").split(","):
        raise _refuse(f"the service's commit verification groups are {groups!r}, not 'commit'",
                      "COMMIT_CHECKS_DISABLED", missing=("dolt_commit_verification_groups",))
    done = imports(conn)
    if done and any(item["scope"] != (scope or "all") for item in done):
        raise _refuse(f"earlier imports cover scope {done[-1]['scope']}, this one {scope or 'all'}", "IMPORT_SCOPE",
                      missing=("--symbols",))
    through = {item["month"]: item["through"] for item in done}  # a month imported twice: its latest import
    if through.get(label) == universe.next_month(month).isoformat():
        raise _refuse(f"the market database already holds {label} through its end", "MONTH_EXISTS", missing=(label,))
    held = sorted(through)
    earliest, latest = (date.fromisoformat(held[i] + "-01") for i in (0, -1)) if done else (month, month)
    # Months extend at either end: the latest month completed or the month after it, or the month just
    # before the earliest (a backfill: insert only, so every stored commit and its rows stay as they are).
    backfill = bool(done) and universe.next_month(month) == earliest
    if done and not backfill and (month not in (latest, universe.next_month(latest)) or (
            month == universe.next_month(latest) and through[held[-1]] != month.isoformat())):
        raise _refuse(f"the stored months run from {held[0]} to {held[-1]} through {through[held[-1]]}; import "
                      f"the month after {held[-1]} or the month before {held[0]}", "MONTH_INVALID",
                      missing=(held[0], held[-1]))
    first_month = month if backfill else earliest
    if backfill:
        _check_empty(conn, month, start_ms, end_ms)

    observed, listed = sources.rest_exchange_info()
    by_symbol = {item["symbol"]: item for item in listed}
    candidates = scope if scope is not None else sorted(
        {item["symbol"] for item in listed} | set(sources.archive_symbols()))
    first_seen = _classification_rows(conn)
    # A contract keeps the classification of its earliest stored observation (later rows are recorded and
    # never reclassify it); a contract never seen is classified by today's exchangeInfo.
    classified = {symbol: universe.classify_contract(
        symbol, _item_of(symbol, first_seen[symbol]) if symbol in first_seen else by_symbol.get(symbol), universe.RULE)
        for symbol in candidates}
    excluded = {symbol: item["reason"] for symbol, item in sorted(classified.items()) if not item["eligible"]}
    eligible = sorted(symbol for symbol, item in classified.items() if item["eligible"])
    log(f"{label}: {len(eligible)} eligible contracts, {len(excluded)} excluded")

    stored_terms = {row["symbol"]: row for row in conn.dicts(
        "SELECT i.* FROM instrument i JOIN (SELECT symbol, MAX(observed_at) AS observed_at FROM instrument "
        "GROUP BY symbol) latest USING (symbol, observed_at)")}
    appended_terms = []
    for symbol in candidates:
        item = by_symbol.get(symbol)
        if item is not None and item["symbol"].endswith("USDT"):
            observed_terms = listed_terms(item)
            if not _same_terms(stored_terms.get(symbol), observed_terms):
                appended_terms.append((symbol, observed, observed_terms))

    jobs, stored_through = [], {}
    for symbol in eligible:
        item = by_symbol.get(symbol)
        plan = {}
        for price_type in ("LAST", "MARK"):
            # The month's own minutes only: a backfilled month has later months stored after it.
            found = conn.rows("SELECT ts_open FROM bar WHERE symbol = %s AND price_type = %s AND ts_open < %s "
                              "ORDER BY ts_open DESC LIMIT 1", (symbol, price_type, end_ms))
            last_open = found[0][0] if found else None
            # The month is stitched whole: minutes up to the stored last one are reread and compared.
            within = last_open + MINUTE if last_open is not None and last_open >= start_ms else None
            before = conn.rows("SELECT 1 FROM bar WHERE symbol = %s AND price_type = %s AND ts_open = %s",
                               (symbol, price_type, start_ms - MINUTE))
            plan[price_type] = (bool(before), within)
            stored_through[(symbol, price_type)] = within
        found = conn.rows("SELECT funding_time FROM funding WHERE symbol = %s AND funding_time >= %s "
                          "AND funding_time < %s ORDER BY funding_time DESC LIMIT 1", (symbol, start_ms, end_ms))
        funding_through = found[0][0] + 1 if found else None
        stored_through[(symbol, "funding")] = funding_through
        terms = listed_terms(item) if item is not None else stored_terms.get(symbol)
        jobs.append({"symbol": symbol, "cache": str(cache), "work": str(work), "start": start_ms, "end": end_ms,
                     "trading": item is not None and item["status"] == "TRADING", "series": plan,
                     "funding_through": funding_through,
                     "terms": {key: terms[key] for key in ("price_increment", "size_increment")} if terms else None,
                     "rest_interval": (sources.REST_INTERVAL * workers, sources.FUNDING_INTERVAL * workers)})

    totals: dict[str, Any] = {"bar_rows": 0, "funding_rows": 0, "rounded_volumes": 0, "gaps": {}, "inferred_terms": [],
                              "source_rows": {name: 0 for name in series.SOURCES}, "derived_findings": {},
                              "per_symbol": {}}
    # One worker prepares in this process; more prepare in a process pool (speed only, same result).
    pool = ProcessPoolExecutor(min(workers, len(jobs))) if workers > 1 and len(jobs) > 1 else None
    try:
        reports = (future.result() for future in as_completed([pool.submit(prepare, job) for job in jobs])) \
            if pool is not None else (prepare(job) for job in jobs)
        for count, report in enumerate(reports, start=1):
            symbol = report["symbol"]
            loaded = time.monotonic()
            _compare_reread(conn, symbol, report, stored_through, start_ms, label)
            statements = Path(report["statements"])
            for statement in statements.read_bytes().split(b"\0"):
                if statement:
                    conn.execute(statement)
            statements.unlink()
            conn.many("INSERT INTO funding VALUES (%s, %s, %s)", [(symbol, at, rate) for at, rate in report["funding"]])
            if report["terms"]:
                appended_terms.append((symbol, observed, report["terms"]))
                totals["inferred_terms"].append(symbol)
            rows = sum(report["rows"].values())
            totals["bar_rows"] += rows
            totals["funding_rows"] += len(report["funding"])
            totals["rounded_volumes"] += report["rounded_volumes"]
            for used in report["source_rows"].values():
                for name, value in used.items():
                    totals["source_rows"][name] += value
            gaps = {key: value for key, value in report["gaps"].items() if value}
            if gaps:
                totals["gaps"][symbol] = gaps
            if report["derived_findings"]:
                totals["derived_findings"][symbol] = report["derived_findings"]
            totals["per_symbol"][symbol] = {"bars": report["rows"], "funding": len(report["funding"]),
                                            "source_rows": report["source_rows"]}
            log(f"[{count}/{len(jobs)}] {symbol}: {rows} bars, {len(report['funding'])} funding, prepared "
                f"{report['seconds']}s, loaded {time.monotonic() - loaded:.1f}s")
    finally:
        if pool is not None:
            pool.shutdown(wait=False, cancel_futures=True)
    appended_terms.sort(key=lambda row: row[0])
    conn.many("INSERT INTO instrument VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
              [(symbol, at, terms["terms_source"], *(terms[name] for name in instrument.TERMS),
                json.dumps(terms["classification"], sort_keys=True) if terms["classification"] is not None else None)
               for symbol, at, terms in appended_terms])

    members, added = _universe(conn, month, first_month)
    filled = _fill_universe(conn, month, earliest, latest) if backfill else {}
    added += sum(len(found) for found in filled.values())
    result = {"month": label, "universe_rule": universe.RULE, "scope": scope or "all",
              "through": series._ms_day(end_ms).isoformat(), "instruments_appended": len(appended_terms),
              "bar_rows": totals["bar_rows"], "funding_rows": totals["funding_rows"], "universe_members": members,
              "gaps": dict(sorted(totals["gaps"].items())), "source_rows": totals["source_rows"], "excluded": excluded,
              "inferred_terms": sorted(totals["inferred_terms"]), "rounded_volumes": totals["rounded_volumes"],
              "derived_findings": dict(sorted(totals["derived_findings"].items())),
              "per_symbol": dict(sorted(totals["per_symbol"].items())),
              "universe_filled": {f"{key:%Y-%m}": value for key, value in filled.items()}}
    if not conn.empty and not (appended_terms or totals["bar_rows"] or totals["funding_rows"] or added):
        conn.raw.rollback()  # the same month with nothing new: the stored commit, no new one
        return {**result, "market_commit": done[-1]["commit"], "seconds": round(time.monotonic() - started)}
    if conn.empty:
        conn.execute("INSERT INTO market_schema VALUES (1, %s, %s, %s, %s, 1)",
                     (SCHEMA_VERSION, PRICE_SCALE, VOLUME_SCALE, universe.RULE))
        conn.many("INSERT INTO dolt_tests VALUES (%s, 'commit', %s, 'expected_single_value', '==', '0')", list(TESTS))
    else:
        conn.execute("UPDATE market_schema SET import_seq = import_seq + 1 WHERE singleton = 1")
    message = json.dumps({"import": IMPORT, "month": label, "through": series._ms_day(end_ms).isoformat(),
                          "universe_rule": universe.RULE, "scope": scope or "all"}, separators=(",", ":"),
                         ensure_ascii=False)
    commit = _commit(conn, message)
    return {**result, "market_commit": commit, "seconds": round(time.monotonic() - started)}


def _commit(conn: MarketConnection, message: str) -> str:
    """One DOLT_COMMIT, which runs the commit tests (group commit); a failing test is DATA_TESTS_FAILED."""
    try:
        with conn.raw.cursor() as cursor:
            cursor.execute("CALL DOLT_COMMIT('-A', '-m', %s)", (message,))
            (commit,), = cursor.fetchall()
    except pymysql.MySQLError as exc:
        text = str(exc.args[1]) if len(exc.args) > 1 else str(exc)
        if "commit verification failed" in text:
            failed = tuple(name for name, _ in TESTS if name in text)
            raise _refuse(f"market commit tests failed: {text}", "DATA_TESTS_FAILED", missing=failed) from exc
        raise _sql_error(exc) from exc
    conn.raw.commit()
    return commit


def _compare_reread(conn: MarketConnection, symbol: str, report: dict, stored_through: dict, start_ms: int,
                    label: str) -> None:
    """The month's bars and funding before the stored last ones, reread from the sources, must equal the
    stored rows (MONTH_EXISTS otherwise): nothing an earlier source wrote stays unchecked."""
    for price_type in ("LAST", "MARK"):
        high = stored_through[(symbol, price_type)]
        if high is None:
            continue
        stored = _stored(conn, symbol, price_type, start_ms, high)
        if not _same_bars(stored, report["reread"][price_type]):
            reread = report["reread"][price_type]
            times = sorted(set(stored["ts_open"].tolist()) ^ set(reread["ts_open"].tolist()))
            if not times:
                differs = np.nonzero(np.any([stored[name] != reread[name] for name in series.COLUMNS], axis=0))[0]
                times = stored["ts_open"][differs].tolist()
            raise _refuse(f"{symbol} {price_type}: the sources now differ from the stored {label} rows at "
                          f"{times[:5]}", "MONTH_EXISTS", missing=(label, symbol, *map(str, times[:5])))
    high = stored_through[(symbol, "funding")]
    if high is not None:
        stored_rates = {funding_slot(int(at)): Decimal(rate) for at, rate in conn.rows(
            "SELECT funding_time, rate FROM funding WHERE symbol = %s AND funding_time >= %s AND funding_time < %s",
            (symbol, start_ms, high))}
        reread_rates = {funding_slot(at): Decimal(rate) for at, rate in report["funding_reread"]}
        if stored_rates != reread_rates:
            slots = sorted(slot for slot in set(stored_rates) | set(reread_rates)
                           if stored_rates.get(slot) != reread_rates.get(slot))
            raise _refuse(f"{symbol} funding: the sources now differ from the stored {label} settlements in hours "
                          f"{slots[:5]}", "MONTH_EXISTS", missing=(label, symbol))


def _classification_rows(conn: MarketConnection) -> dict[str, dict]:
    """Each contract's earliest stored terms row: the observation its universe classification comes from."""
    return {row["symbol"]: row for row in conn.dicts(
        "SELECT i.symbol, i.classification FROM instrument i JOIN (SELECT symbol, MIN(observed_at) AS observed_at "
        "FROM instrument GROUP BY symbol) earliest USING (symbol, observed_at)")}


def trading_days(conn: MarketConnection, symbols: list[str], low: date, high: date) -> dict[str, set[date]]:
    """Each contract's UTC days in [low, high) with at least one traded one-minute LAST bar."""
    found: dict[str, set[date]] = {}
    for symbol in symbols:
        days = conn.rows("SELECT DISTINCT ts_open DIV 86400000 FROM bar WHERE symbol = %s AND price_type = 'LAST' "
                         "AND ts_open >= %s AND ts_open < %s AND volume > 0",
                         (symbol, series._day_ms(low), series._day_ms(high)))
        found[symbol] = {date(1970, 1, 1) + timedelta(days=int(day)) for (day,) in days}
    return found


def _first_members(first_month: date) -> date:
    """The first month that can have members when `first_month` is the earliest held: its look-back of
    listed_days lies inside the held months."""
    listed_days = universe.rule(universe.RULE)["listed_days"]
    first = first_month
    while first - timedelta(days=listed_days) < first_month:
        first = universe.next_month(first)
    return first


def _universe(conn: MarketConnection, month: date, first_month: date) -> tuple[list[str], int]:
    """The universe of `month` alone: (members, rows inserted). Stored months cannot change (bars are
    insert-only, and a month's look-back lies before it), so only the imported month is computed;
    importing it again must give the stored members (UNIVERSE_CHANGED otherwise). The first month has
    none: no history before it is held."""
    listed_days = universe.rule(universe.RULE)["listed_days"]
    first = _first_members(first_month)
    stored = {symbol for (symbol,) in conn.rows("SELECT symbol FROM universe_month WHERE universe_rule = %s AND "
                                                "month = %s", (universe.RULE, month))}
    if month < first:
        if stored:
            raise _refuse(f"{month:%Y-%m} has stored members before the second imported month", "UNIVERSE_CHANGED",
                          missing=(f"{month:%Y-%m}",))
        return [], 0
    rows = _classification_rows(conn)
    classifications = [universe.classify_contract(symbol, _item_of(symbol, row), universe.RULE)
                       for symbol, row in sorted(rows.items())]
    look_back = month - timedelta(days=listed_days)
    days = trading_days(conn, [item["symbol"] for item in classifications if item["eligible"]], look_back, month)
    computed = {symbol for _, symbol in universe.monthly_universe(classifications, days, month, month, universe.RULE,
                                                                   covered=(look_back, month - timedelta(days=1)))}
    if stored and computed != stored:
        raise _refuse(f"{month:%Y-%m} recomputes to other members than stored: "
                      + ", ".join(sorted(computed ^ stored)), "UNIVERSE_CHANGED",
                      missing=(f"{month:%Y-%m}", *sorted(computed ^ stored)))
    new = sorted(computed - stored)
    conn.many("INSERT INTO universe_month VALUES (%s, %s, %s)", [(universe.RULE, month, symbol) for symbol in new])
    return sorted(computed), len(new)


def _check_empty(conn: MarketConnection, month: date, start_ms: int, end_ms: int) -> None:
    """A backfilled month holds no bar or funding row of any contract yet (MONTH_EXISTS); its members are
    checked by _universe."""
    label = f"{month:%Y-%m}"
    for (symbol,) in conn.rows("SELECT DISTINCT symbol FROM instrument ORDER BY symbol"):
        for statement in ("SELECT 1 FROM bar WHERE symbol = %s AND price_type IN ('LAST', 'MARK') AND ts_open >= %s "
                          "AND ts_open < %s LIMIT 1",
                          "SELECT 1 FROM funding WHERE symbol = %s AND funding_time >= %s AND funding_time < %s LIMIT 1"):
            if conn.rows(statement, (symbol, start_ms, end_ms)):
                raise _refuse(f"the market database already holds {symbol} rows in {label}", "MONTH_EXISTS",
                              missing=(label, symbol))


def _fill_universe(conn: MarketConnection, month: date, earliest: date, latest: date) -> dict[date, list[str]]:
    """After backfilling `month` before `earliest`: the members of the stored months whose look-back the
    backfill completes, {month: members}. They had none for want of history; one that has any refuses
    UNIVERSE_CHANGED. Later months already had their look-back and stay as stored."""
    filled, at = {}, _first_members(month)
    while at < _first_members(earliest) and at <= latest:
        if conn.rows("SELECT 1 FROM universe_month WHERE month = %s LIMIT 1", (at,)):
            raise _refuse(f"{at:%Y-%m} already has members, before its look-back was held", "UNIVERSE_CHANGED",
                          missing=(f"{at:%Y-%m}",))
        filled[at] = _universe(conn, at, month)[0]
        at = universe.next_month(at)
    return filled


# market.freshness

def freshness(profile: dict, ref: str | None = None) -> dict:
    """market.freshness: what a market commit holds (universe months and contracts, the newest minute,
    the latest complete day and month, the import scope)."""
    with connect(profile, "reader") as conn:
        commit = resolve_commit(conn, ref)
        (rule,), = conn.rows(f"SELECT universe_rule FROM market_schema AS OF '{commit}'")
        months = [value for (value,) in conn.rows(f"SELECT DISTINCT month FROM universe_month AS OF '{commit}' "
                                                  "WHERE universe_rule = %s ORDER BY month", (rule,))]
        if not months:
            raise _refuse(f"market commit {commit} has no universe month", "MARKET_EMPTY", missing=(commit,))
        (count,), = conn.rows(f"SELECT COUNT(DISTINCT symbol) FROM universe_month AS OF '{commit}' "
                              "WHERE universe_rule = %s", (rule,))
        newest = None
        for (symbol,) in conn.rows(f"SELECT DISTINCT symbol FROM instrument AS OF '{commit}'"):
            found = conn.rows(f"SELECT ts_open FROM bar AS OF '{commit}' WHERE symbol = %s AND price_type = 'LAST' "
                              "ORDER BY ts_open DESC LIMIT 1", (symbol,))
            if found and (newest is None or found[0][0] > newest):
                newest = found[0][0]
        done = imports(conn, commit)
    covered = newest + MINUTE if newest is not None else None
    day = series._ms_day(covered) if covered is not None else None
    complete_day = (day - timedelta(days=1)) if day is not None else None
    month_start = day.replace(day=1) if day is not None else None
    at_month_start = month_start is not None and covered == series._day_ms(month_start)
    complete_month = (month_start - timedelta(days=1)).strftime("%Y-%m") if month_start is not None else None
    return {"commit": commit, "universe_rule": rule, "universe_months": [value.strftime("%Y-%m") for value in months],
            "symbols": int(count), "covered_through": covered, "latest_complete_day": complete_day,
            "latest_complete_month": complete_month,
            "current_month_through": None if covered is None or at_month_start else covered,
            "scope": done[-1]["scope"] if done else None}


# Quotes (market.import_quotes): best bid/ask inferred from Binance aggTrades under quotes.RULE

def quote_imports(conn: MarketConnection, ref: str = "main") -> list[dict]:
    """The quote import commits reachable from `ref`, oldest first: {commit, month, through, quote_rule, symbols,
    archives (the archive SHA-256 of every day read), readings (each day's trades, states, adjustments, largest gap)}."""
    found = []
    for commit, message in conn.rows("SELECT commit_hash, message FROM DOLT_LOG(%s)", (ref,)):
        try:
            value = json.loads(message)
        except ValueError:
            continue
        if isinstance(value, dict) and value.get("import") == QUOTE_IMPORT:
            found.append({"commit": commit, **{key: value.get(key) for key in ("month", "through", "quote_rule",
                                                                               "symbols", "archives", "readings")}})
    return found[::-1]


def import_quotes(profile: dict, month: date, cache_root: Path, workers: int = 4, symbols: list[str] | None = None,
                  log=print) -> dict:
    """market.import_quotes: append one UTC month of inferred best bid/ask (quotes.RULE) of `symbols`
    (default: the month's universe members) as one market commit; insert only, one month per symbol.
    Every state change is stored: thinning to per-second extremes moves a liquidation to the second's
    adverse extreme up to a second late (measured), so there is no thinned form."""
    started = time.monotonic()
    scope = _scope(symbols, profile)
    if not isinstance(month, date) or isinstance(month, datetime) or month.day != 1:
        raise _refuse(f"{month!r} is not the first day of a month", "MONTH_INVALID", missing=(str(month),))
    today = datetime.now(UTC).date()
    start_ms, end_ms = _month_ms(month), min(_month_ms(universe.next_month(month)), series._day_ms(today))
    if start_ms >= end_ms:
        raise _refuse(f"{month:%Y-%m} has no closed UTC day yet", "MONTH_INVALID", missing=(f"{month:%Y-%m}",))
    conn = connect(profile, "import")
    try:
        lock(conn)
        return _import_quotes(conn, month, start_ms, end_ms, Path(cache_root), workers, scope, log, started)
    except BaseException:
        try:
            conn.raw.rollback()
        except pymysql.MySQLError:
            pass
        raise
    finally:
        conn.close()


def _import_quotes(conn: MarketConnection, month: date, start_ms: int, end_ms: int, cache: Path, workers: int,
                   scope: list[str] | None, log, started: float) -> dict:
    label = f"{month:%Y-%m}"
    if conn.empty:
        raise _refuse("the market database holds no bars yet; quotes need the contracts' terms", "MARKET_EMPTY")
    if conn.rows("SELECT table_name FROM dolt_status"):
        raise _refuse("the market database has uncommitted changes", "DIRTY_WORKING_SET", missing=("dolt_status",))
    (groups,), = conn.rows("SELECT @@GLOBAL.dolt_commit_verification_groups")
    if "commit" not in str(groups or "").split(","):
        raise _refuse(f"the service's commit verification groups are {groups!r}, not 'commit'",
                      "COMMIT_CHECKS_DISABLED", missing=("dolt_commit_verification_groups",))
    done = quote_imports(conn)
    if any(item["quote_rule"] != quotes.RULE for item in done):
        raise _refuse(f"earlier quote imports used rule {done[-1]['quote_rule']}, this code {quotes.RULE}",
                      "RULE_VERSION_MISMATCH", missing=(str(done[-1]["quote_rule"]),))
    if scope is None:
        scope = [symbol for (symbol,) in conn.rows("SELECT symbol FROM universe_month WHERE universe_rule = %s "
                                                     "AND month = %s ORDER BY symbol", (conn.universe_rule, month))]
        if not scope:
            raise _refuse(f"{label} has no universe members in the market database; import its bars first or name "
                          "--symbols", "UNIVERSE_UNKNOWN", missing=(label,))
    stored = dict(conn.rows("SELECT symbol, COUNT(*) FROM quote WHERE ts >= %s AND ts < %s GROUP BY symbol",
                            (start_ms, end_ms)))
    if any(symbol in stored for symbol in scope):
        raise _refuse(f"the market database already holds {label} quotes of "
                      f"{sorted(symbol for symbol in scope if symbol in stored)}", "MONTH_EXISTS", missing=(label,))
    days = [series._ms_day(at).isoformat() for at in range(start_ms, end_ms, DAY)]
    eve = series._ms_day(start_ms - DAY).isoformat()
    per_symbol: dict[str, dict] = {}
    archives: dict[str, dict[str, str]] = {}  # the input identity: each day's archive SHA-256 (its .CHECKSUM)
    total = 0
    for symbol in scope:
        # The newest stored terms: like the bar import, the price increment is the one observed at import time.
        terms = conn.rows("SELECT price_increment FROM instrument WHERE symbol = %s ORDER BY observed_at DESC LIMIT 1",
                          (symbol,))
        if not terms:
            raise _refuse(f"{symbol}: the market database holds no contract terms", "TERMS_UNKNOWN", missing=(symbol,))
        tick = Decimal(terms[0][0])
        (earlier,), = conn.rows("SELECT COUNT(*) FROM quote WHERE symbol = %s AND ts < %s", (symbol, start_ms))
        state = quotes.State()
        try:
            eve_path = sources.fetch_archive(cache, sources.aggtrades_key(symbol, eve))
        except MarketError as exc:
            if exc.code != "ARCHIVE_NOT_PUBLISHED" or earlier:
                raise
            eve_path = None  # the contract's first archive: the inference starts cold on the first day
        if eve_path is not None:
            quotes.derive(sources.aggtrades_table(eve_path), tick, state, f"{symbol} {eve}")
        paths = sources.fetch_all(cache, [sources.aggtrades_key(symbol, day) for day in days], workers)
        archives[symbol] = {day: _published_sha(path) for day, path in zip(days, paths, strict=True)}
        if eve_path is not None:
            archives[symbol][eve] = _published_sha(eve_path)
        readings = {"trades": 0, "quote_changes": 0, "stale_side_adjustments": 0, "minutes_with_trades": 0,
                    "trade_gap_max_ms": 0, "trade_gap_p99_ms": 0}
        daily: dict[str, dict] = {}
        written = 0
        # One day at a time: derive, scale, insert, drop (a month of BTCUSDT is tens of millions of states).
        for day, path in zip(days, paths, strict=True):
            found, day_readings = quotes.derive(sources.aggtrades_table(path), tick, state, f"{symbol} {day}")
            scaled_rows = quotes.scaled_rows(symbol, found, PRICE_SCALE)
            del found
            for offset in range(0, len(scaled_rows), INSERT_ROWS):
                chunk = scaled_rows[offset:offset + INSERT_ROWS]
                conn.execute("INSERT INTO quote VALUES " + ",".join(f"('{symbol}',{ts},{identity},{bid},{ask})"
                                                                     for _, ts, identity, bid, ask in chunk))
            written += len(scaled_rows)
            del scaled_rows
            for key, value in day_readings.items():
                readings[key] = max(readings[key], value) if key.startswith("trade_gap") else readings[key] + value
            daily[day] = {key: day_readings[key] for key in ("trades", "quote_changes", "stale_side_adjustments",
                                                             "trade_gap_max_ms")}
        total += written
        per_symbol[symbol] = {**readings, "quotes": written, "eve_archive": eve_path is not None, "days": len(days),
                              "daily": daily}
        log(f"{symbol}: {written} quotes from {readings['trades']} trades")
    # The commit message is the import's receipt: the rule, every archive's published SHA-256 and each day's
    # readings (trades, states, stale-side adjustments, largest trade gap), so the derivation can be audited later.
    message = json.dumps({"import": QUOTE_IMPORT, "month": label, "through": series._ms_day(end_ms).isoformat(),
                          "quote_rule": quotes.RULE, "symbols": scope, "archives": archives,
                          "readings": {symbol: per_symbol[symbol]["daily"] for symbol in scope}},
                         separators=(",", ":"), ensure_ascii=False)
    commit = _commit(conn, message)
    return {"month": label, "through": series._ms_day(end_ms).isoformat(), "quote_rule": quotes.RULE, "symbols": scope, "quote_rows": total, "per_symbol": per_symbol, "archives": archives, "market_commit": commit,
            "seconds": round(time.monotonic() - started)}


def _published_sha(path: Path) -> str:
    """The SHA-256 the exchange published beside a cached archive (fetch_archive verified it)."""
    return (Path(path).with_name(Path(path).name + ".CHECKSUM")).read_text(encoding="utf-8").split()[0]
