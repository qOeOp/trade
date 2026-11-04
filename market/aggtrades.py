"""Complete source aggTrades: bounded ZIP/CSV ingestion, exact independent scale-8 codec.

Quote imports infer best bid/ask from the stored rows (market.store.import_quotes); bar reads do not read them,
and a replay exports them as trade ticks only on request (market.export.write_trades). Each ended contract month is
one data file, written under the import lock and never again; the contracts of one call are written at once, each
in its own process, and their files placed one after another.
"""

from __future__ import annotations

import csv
from dataclasses import dataclass
from datetime import date
from decimal import Decimal, InvalidOperation
import hashlib
import http.client
import io
from pathlib import Path
import re
import time
import urllib.parse
import zipfile
import zlib

import pyarrow as pa

from market import files, series, sources, store
from market.sources import MarketError, _refuse


CODEC = "binance-aggtrades-int64-scale8-v1"
SCALE = 100_000_000
MAX_INT = (1 << 63) - 1
MIN_VALUE = Decimal("0.00000001")
MAX_VALUE = Decimal("92233720368.54775807")
BATCH_ROWS = 100_000
DOWNLOAD_BYTES = 1 << 20
COLUMNS = tuple(field.name for field in sources.AGGTRADES_SCHEMA)


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
    last_trade: int | None = None  # the previous row's last raw trade id


def batches(path: Path, symbol: str, day: str, state: State, readings: dict, size: int = BATCH_ROWS):
    """One CSV row at a time; retain only a batch of rows and the previous event across days."""
    label = f"{symbol} {day}"
    low = series._day_ms(date.fromisoformat(day))
    previous_id, previous_time, previous_trade = state.last_id, state.last_time, state.last_trade
    readings["trades"] = 0
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
                    # Binance's archive gives one id twice to two distinct trades (SOLUSDT 2025-07-16): a
                    # repeated id later in time whose raw trade ids follow the previous row's is kept
                    # (user, 2026-10-31); an identical or same-moment repeat is not.
                    repeated = (identity == previous_id and previous_time is not None and previous_trade is not None
                                and moment > previous_time and first > previous_trade)
                    if previous_id is not None and identity != previous_id + 1 and not repeated:
                        raise _refuse(f"{label}: aggTrade ids are not contiguous (after agg_trade_id "
                                      f"{previous_id} comes {identity})", "SEQUENCE_GAP", missing=(label,))
                    if previous_time is not None and moment < previous_time:
                        raise ValueError("transact_time goes backwards")
                    if not low <= moment < low + store.DAY:
                        raise ValueError(f"transact_time {moment} is outside its UTC archive day")
                    p, q = scaled(price, label + " price"), scaled(quantity, label + " quantity")
                    readings["trades"] += 1
                    previous_id, previous_time, previous_trade = identity, moment, last
                    rows.append((symbol, moment, identity, p, q, first, last, maker.lower() == "true"))
                    if len(rows) >= size:
                        yield rows
                        rows = []
    except (ValueError, csv.Error, UnicodeError, zipfile.BadZipFile, zlib.error, EOFError) as exc:
        raise _refuse(f"{label}: rows do not parse as complete aggTrades ({exc})", "SOURCE_SHAPE", missing=(label,)) from exc
    if not readings["trades"]:
        raise _refuse(f"{label}: the archive holds no trades", "SOURCE_SHAPE", missing=(label,))
    state.last_id, state.last_time, state.last_trade = previous_id, previous_time, previous_trade
    if rows:
        yield rows


def record_batch(rows: list[tuple]) -> pa.RecordBatch:
    """Rows of `batches` as agg_trade's columns."""
    return pa.RecordBatch.from_arrays([pa.array(column, field.type) for column, field in zip(
        zip(*rows, strict=True), files.AGG_TRADE.schema, strict=True)], schema=files.AGG_TRADE.schema)


def import_month(profile: dict, month: date, cache: Path, symbols: list[str], log=print) -> dict:
    """One ended month of each contract in `symbols`, each its own file. The contracts are written at once, each in
    its own worker process (parsing a day's CSV is the work), while this process holds the import lock and places
    their files in contract order. A contract's refusal leaves the other contracts' files in place; the refusal
    raised is that of the first refused contract, and its message names the others written."""
    started = time.monotonic()
    symbols = store._scope(symbols or []) or []  # an empty, repeated or malformed list is IMPORT_SCOPE
    start, end = store.closed_month(month)
    market = files.open_market(profile, "import")
    with files.lock(market):
        if market.empty:
            raise _refuse("the market holds no bars yet", "MARKET_EMPTY")
        jobs = []
        for symbol in symbols:
            jobs.append({"root": str(market.root), "symbol": symbol, "cache": str(cache), "start": start, "end": end,
                         "held": bool(files.entries(market, "agg_trade", [symbol], start, end)),
                         "earlier": store.earlier_file(market, "agg_trade", symbol, start)})
        imports = store.contract_files(market, jobs, trade_month, len(jobs), log)
        commit = files.latest_commit(market)
    return {"month": f"{month:%Y-%m}", "imports": imports, "trade_rows": sum(item["trade_rows"] for item in imports),
            "market_commit": commit, "seconds": round(time.monotonic() - started, 1)}


def trade_month(job: dict) -> dict:
    """One contract month as one file (in a worker process): {written, result}."""
    started = time.monotonic()
    symbol, cache, start, end = job["symbol"], Path(job["cache"]), job["start"], job["end"]
    if job["held"]:  # this contract only: the others of the call go on
        raise _refuse(f"the market already holds {series._ms_day(start):%Y-%m} aggTrades of {symbol}", "MONTH_EXISTS",
                      missing=(f"{series._ms_day(start):%Y-%m}",))
    state = State()
    eve = series._ms_day(start - store.DAY).isoformat()
    try:
        path = fetch_archive(cache, sources.aggtrades_key(symbol, eve))
    except MarketError as exc:
        if exc.code != "ARCHIVE_NOT_PUBLISHED" or job["earlier"]:
            raise
    else:
        for _ in batches(path, symbol, eve, state, {}):
            pass
    total = 0

    def rows():
        nonlocal total
        for moment in range(start, end, store.DAY):
            day = series._ms_day(moment).isoformat()
            path = fetch_archive(cache, sources.aggtrades_key(symbol, day))
            readings: dict = {}
            for found in batches(path, symbol, day, state, readings):
                yield record_batch(found)
            total += readings["trades"]

    written = files.write_file(store.worker_market(job), "agg_trade", series._ms_day(start), symbol, rows())
    return {"written": written, "result": {"month": series._ms_day(start).strftime("%Y-%m"), "symbols": [symbol],
                                           "codec": CODEC, "trade_rows": total,
                                           "seconds": round(time.monotonic() - started, 1)}}
