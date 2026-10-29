"""Complete source aggTrades: bounded ZIP/CSV ingestion, exact independent scale-8 codec.

This append-only input path does not participate in bar/quote reads, derivation or replay exports.
One explicit contract month uses the existing restricted import connection, lock and commit tests.
"""

from __future__ import annotations

import csv
from dataclasses import dataclass
from datetime import UTC, date, datetime
from decimal import Decimal, InvalidOperation
import hashlib
import http.client
import io
import json
from pathlib import Path
import re
import time
import urllib.parse
import zipfile
import zlib

import pymysql

from market import series, sources, store, universe
from market.sources import MarketError, _refuse


IMPORT = "binance-aggtrades"
CODEC = "binance-aggtrades-int64-scale8-v1"
SCALE = 100_000_000
MAX_INT = (1 << 63) - 1
MIN_VALUE = Decimal("0.00000001")
MAX_VALUE = Decimal("92233720368.54775807")
BATCH_ROWS = 5_000
DOWNLOAD_BYTES = 1 << 20
COLUMNS = tuple(field.name for field in sources.AGGTRADES_SCHEMA)
INSERT = "INSERT INTO agg_trade VALUES (%s,%s,%s,%s,%s,%s,%s,%s)"


def scaled(text: str, label: str) -> int:
    """Prove representability without Decimal context rounding, float conversion or fallback."""
    try:
        value = Decimal(text)
        if not value.is_finite() or value <= 0:
            raise ValueError("not a positive finite decimal")
        # Reject extreme exponents before as_integer_ratio could allocate an enormous integer.
        if not MIN_VALUE <= value <= MAX_VALUE:
            raise _refuse(f"{label}: {text!r} cannot be represented exactly by {CODEC}", "SCALE_LOSS", missing=(label,))
        numerator, denominator = value.as_integer_ratio()
        integer, remainder = divmod(numerator * SCALE, denominator)
    except (InvalidOperation, ValueError, OverflowError) as exc:
        raise _refuse(f"{label}: invalid decimal {text!r}", "SOURCE_SHAPE", missing=(label,)) from exc
    if remainder or not 0 < integer <= MAX_INT:
        raise _refuse(f"{label}: {text!r} cannot be represented exactly by {CODEC}", "SCALE_LOSS", missing=(label,))
    return integer


def _download(url: str, path: Path) -> None:
    """The archive body is copied to disk in bounded chunks; the checksum is fetched separately."""
    parts = urllib.parse.urlsplit(url)
    target = parts.path + (f"?{parts.query}" if parts.query else "")
    delay = 1.0
    for attempt in range(sources.ATTEMPTS):
        try:
            connection = sources._connection(parts.netloc)
            connection.request("GET", target, headers={"User-Agent": "trade-market/2"})
            response = connection.getresponse()
            status, retry_after = response.status, response.headers.get("Retry-After")
            with path.open("wb") as stream:
                while chunk := response.read(DOWNLOAD_BYTES):
                    if status == 200:
                        stream.write(chunk)
            if response.will_close:
                sources._drop(parts.netloc)
        except (OSError, http.client.HTTPException) as exc:
            sources._drop(parts.netloc)
            if attempt == sources.ATTEMPTS - 1:
                raise _refuse(f"{url}: {exc}", "SOURCE_UNREACHABLE", missing=(url,)) from exc
            time.sleep(delay)
            delay = min(delay * 2, 60)
            continue
        if status == 200:
            return
        if status == 404:
            raise sources._NotPublished(url)
        if status not in (403, 418, 429, 500, 502, 503, 504) or attempt == sources.ATTEMPTS - 1:
            raise _refuse(f"{url}: HTTP {status}", "SOURCE_UNREACHABLE", missing=(url,))
        wait = (float(retry_after) if retry_after and retry_after.isdigit()
                else 60.0 * 2 ** attempt if status in (403, 418, 429) else delay)
        time.sleep(max(delay, wait))
        delay = min(delay * 2, 60)


def _sha(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def fetch_archive(cache: Path, key: str) -> Path:
    """Same official daily keys and checksums as quotes, without materializing ZIP bytes in RAM."""
    target = Path(cache) / key
    checksum = target.with_name(target.name + ".CHECKSUM")
    if target.is_file() and checksum.is_file():
        cached_checksum = checksum.read_text().split()
        if cached_checksum and _sha(target) == cached_checksum[0].lower():
            return target
    partial = target.with_name(target.name + ".part")
    target.parent.mkdir(parents=True, exist_ok=True)
    url = sources.ARCHIVE + urllib.parse.quote(key)
    try:
        expected = sources._get(url + ".CHECKSUM")
        digest = expected.split()[0].decode("ascii", errors="replace") if expected.split() else ""
        if not re.fullmatch(r"[0-9a-fA-F]{64}", digest):
            raise _refuse(f"{key}: invalid .CHECKSUM", "CHECKSUM_MISMATCH", missing=(key,))
        _download(url, partial)
        actual = _sha(partial)
        if actual != digest.lower():
            raise _refuse(f"{key}: SHA-256 {actual} differs from its .CHECKSUM {digest}", "CHECKSUM_MISMATCH",
                          missing=(key,))
        checksum_partial = checksum.with_name(checksum.name + ".part")
        checksum_partial.write_bytes(expected)
        checksum_partial.replace(checksum)
        partial.replace(target)
    except sources._NotPublished as exc:
        raise _refuse(f"{key} is not published", "ARCHIVE_NOT_PUBLISHED", missing=(key,)) from exc
    finally:
        partial.unlink(missing_ok=True)
    return target


@dataclass
class State:
    last_id: int | None = None
    last_time: int | None = None


def batches(path: Path, symbol: str, day: str, state: State, readings: dict, size: int = BATCH_ROWS):
    """One CSV row at a time; retain only an INSERT batch and the previous event across days."""
    label = f"{symbol} {day}"
    low = series._day_ms(date.fromisoformat(day))
    previous_id, previous_time = state.last_id, state.last_time
    readings.update(trades=0, first_agg_trade_id=None, last_agg_trade_id=None,
                    first_ms=None, last_ms=None, trade_gap_max_ms=0)
    rows = []
    try:
        with zipfile.ZipFile(path) as archive:
            names = archive.namelist()
            if len(names) != 1:
                raise ValueError(f"expected one CSV, found {names}")
            with archive.open(names[0]) as raw, io.TextIOWrapper(raw, encoding="utf-8", newline="") as stream:
                for index, row in enumerate(csv.reader(stream)):
                    if index == 0 and row == list(COLUMNS):
                        continue
                    if len(row) != len(COLUMNS):
                        raise ValueError(f"expected seven columns, found {len(row)}")
                    identity_text, price, quantity, first_text, last_text, moment_text, maker = row
                    identity, first, last, moment = map(int, (identity_text, first_text, last_text, moment_text))
                    if any(not 0 <= value <= MAX_INT for value in (identity, first, last, moment)):
                        raise ValueError("source ID or time is outside signed int64")
                    if first > last or maker not in ("true", "false", "True", "False"):
                        raise ValueError("invalid first/last trade ID or maker flag")
                    if previous_id is not None and identity != previous_id + 1:
                        raise _refuse(f"{label}: aggTrade ids are not contiguous (after agg_trade_id "
                                      f"{previous_id} comes {identity})", "SEQUENCE_GAP", missing=(label,))
                    if previous_time is not None and moment < previous_time:
                        raise ValueError("transact_time goes backwards")
                    if not low <= moment < low + store.DAY:
                        raise ValueError(f"transact_time {moment} is outside its UTC archive day")
                    p, q = scaled(price, label + " price"), scaled(quantity, label + " quantity")
                    if readings["trades"] == 0:
                        readings.update(first_agg_trade_id=identity, first_ms=moment)
                    elif previous_time is not None:
                        readings["trade_gap_max_ms"] = max(readings["trade_gap_max_ms"], moment - previous_time)
                    readings["trades"] += 1
                    readings.update(last_agg_trade_id=identity, last_ms=moment)
                    previous_id, previous_time = identity, moment
                    rows.append((symbol, moment, identity, p, q, first, last, maker.lower() == "true"))
                    if len(rows) >= size:
                        yield rows
                        rows = []
    except (ValueError, csv.Error, UnicodeError, zipfile.BadZipFile, zlib.error, EOFError) as exc:
        raise _refuse(f"{label}: rows do not parse as complete aggTrades ({exc})", "SOURCE_SHAPE", missing=(label,)) from exc
    if not readings["trades"]:
        raise _refuse(f"{label}: the archive holds no trades", "SOURCE_SHAPE", missing=(label,))
    state.last_id, state.last_time = previous_id, previous_time
    if rows:
        yield rows


def import_month(profile: dict, month: date, cache: Path, symbol: str, log=print) -> dict:
    """One contract month, one transaction/commit. No raw-SQL administrator write path."""
    started = time.monotonic()
    store._scope([symbol], profile)
    if not isinstance(month, date) or isinstance(month, datetime) or month.day != 1:
        raise _refuse(f"{month!r} is not the first day of a month", "MONTH_INVALID", missing=(str(month),))
    start = series._day_ms(month)
    end = min(series._day_ms(universe.next_month(month)), series._day_ms(datetime.now(UTC).date()))
    if start >= end:
        raise _refuse(f"{month:%Y-%m} has no closed UTC day yet", "MONTH_INVALID", missing=(f"{month:%Y-%m}",))
    conn = store.connect(profile, "import")
    try:
        store.lock(conn)
        result = _import(conn, month, start, end, cache, symbol, log)
        return {**result, "seconds": round(time.monotonic() - started, 1)}
    except BaseException:
        try:
            conn.raw.rollback()
        except pymysql.MySQLError:
            pass
        raise
    finally:
        conn.close()


def _import(conn, month, start, end, cache, symbol, log):
    if conn.empty:
        raise _refuse("the market database holds no bar import yet", "MARKET_EMPTY")
    if conn.rows("SELECT table_name FROM dolt_status"):
        raise _refuse("the market database has uncommitted changes", "DIRTY_WORKING_SET", missing=("dolt_status",))
    (groups,), = conn.rows("SELECT @@GLOBAL.dolt_commit_verification_groups")
    if "commit" not in str(groups or "").split(","):
        raise _refuse(f"the service's commit verification groups are {groups!r}, not 'commit'",
                      "COMMIT_CHECKS_DISABLED", missing=("dolt_commit_verification_groups",))
    if not conn.rows("SHOW TABLES LIKE 'agg_trade'"):
        raise _refuse("agg_trade is missing; run market upgrade first", "SCHEMA_MISMATCH", missing=("agg_trade",))
    for message, in conn.rows("SELECT message FROM dolt_log"):
        try:
            item = json.loads(message)
        except ValueError:
            continue
        if isinstance(item, dict) and item.get("import") == IMPORT and item.get("codec") != CODEC:
            raise _refuse(f"earlier complete aggTrades import used codec {item.get('codec')!r}, this code {CODEC}",
                          "RULE_VERSION_MISMATCH", missing=(str(item.get("codec")),))
    if conn.rows("SELECT 1 FROM agg_trade WHERE symbol = %s AND transact_time >= %s "
                 "AND transact_time < %s LIMIT 1", (symbol, start, end)):
        raise _refuse(f"the market database already holds {month:%Y-%m} aggTrades of {symbol}",
                      "MONTH_EXISTS", missing=(f"{month:%Y-%m}",))
    state = State()
    archives, daily = {}, {}
    eve = series._ms_day(start - store.DAY).isoformat()
    try:
        path = fetch_archive(cache, sources.aggtrades_key(symbol, eve))
    except MarketError as exc:
        if exc.code != "ARCHIVE_NOT_PUBLISHED" or conn.rows(
                "SELECT 1 FROM agg_trade WHERE symbol = %s AND transact_time < %s LIMIT 1", (symbol, start)):
            raise
    else:
        for _ in batches(path, symbol, eve, state, {}):
            pass
        archives[eve] = store._published_sha(path)
    total = 0
    for moment in range(start, end, store.DAY):
        day = series._ms_day(moment).isoformat()
        path = fetch_archive(cache, sources.aggtrades_key(symbol, day))
        readings = {}
        for rows in batches(path, symbol, day, state, readings):
            conn.many(INSERT, rows)
        archives[day] = store._published_sha(path)
        daily[day] = readings
        total += readings["trades"]
        log(f"{symbol} {day}: {readings['trades']} aggTrades")
    receipt = {"import": IMPORT, "month": f"{month:%Y-%m}", "through": series._ms_day(end).isoformat(),
               "symbols": [symbol], "codec": CODEC, "archives": {symbol: archives}, "readings": {symbol: daily}}
    commit = store._commit(conn, json.dumps(receipt, separators=(",", ":"), ensure_ascii=False))
    return {**receipt, "trade_rows": total, "market_commit": commit}
