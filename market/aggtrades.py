"""Complete source aggTrades: bounded ZIP/CSV ingestion, exact codec at the trade scale (files.TRADE_SCALE).

Quote imports infer best bid/ask from the stored rows (market.quotes.import_quotes); bar reads do not read them,
and a replay exports them as trade ticks only on request (market.export.write_trades). Each ended contract month is
one data file, written under the import lock and never again; the contracts of one call are written at once, each
in its own process, and their files placed one after another.
"""

from __future__ import annotations

import codecs
import csv
from dataclasses import dataclass
from datetime import date
from decimal import Decimal, InvalidOperation
import io
from pathlib import Path
import time
import zipfile
import zlib

import numpy as np
import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.csv as pacsv

from market import files, sources, store
from shared import clock
from shared.refusals import refuse


CODEC = "binance-aggtrades-int64-scale8-v1"
SCALE = 10 ** files.TRADE_SCALE
MAX_INT = (1 << 63) - 1
MIN_VALUE = Decimal("0.00000001")
MAX_VALUE = Decimal("92233720368.54775807")
BATCH_ROWS = 100_000
BLOCK_BYTES = 1 << 21  # CSV bytes `_vectorized` parses at once (about 33,000 rows); larger blocks only hold more
INTEGER = r"^[0-9]{1,18}$"  # within signed int64
DECIMAL = r"^(?P<units>[0-9]{1,10})(?:\.(?P<fraction>[0-9]{1,8}))?$"  # exact at the scale, within signed int64
MAKERS = pa.array(["true", "false", "True", "False"])
BUYER_MAKER = pa.array(["true", "True"])
COLUMNS = ("agg_trade_id", "price", "quantity", "first_trade_id", "last_trade_id", "transact_time", "is_buyer_maker")


def scaled(text: str, label: str) -> int:
    """Prove representability without Decimal context rounding, float conversion or fallback."""
    try:
        value = Decimal(text)
        if not value.is_finite() or value <= 0:
            raise ValueError("not a positive finite decimal")
        # Reject extreme exponents before as_integer_ratio could allocate an enormous integer.
        if not MIN_VALUE <= value <= MAX_VALUE:
            raise refuse("SCALE_LOSS", f"{label}: {text!r} cannot be represented exactly by {CODEC}", missing=(label,))
        numerator, denominator = value.as_integer_ratio()
        integer, remainder = divmod(numerator * SCALE, denominator)
    except (InvalidOperation, ValueError, OverflowError) as exc:
        raise refuse("SOURCE_SHAPE", f"{label}: invalid decimal {text!r}", missing=(label,)) from exc
    if remainder or not 0 < integer <= MAX_INT:
        raise refuse("SCALE_LOSS", f"{label}: {text!r} cannot be represented exactly by {CODEC}", missing=(label,))
    return integer


@dataclass
class State:
    last_id: int | None = None
    last_time: int | None = None
    last_trade: int | None = None  # the previous row's last raw trade id


def follows(last_id: int | None, last_time: int | None, last_trade: int | None, identity: int, moment: int,
            first: int) -> bool:
    """Whether an aggTrade (its id, transact time and first raw trade id) continues the sequence the previous row
    ended (its id, time and last raw trade id; None before any): the next id, or, since Binance's archive gives one
    id twice to two distinct trades (SOLUSDT 2025-07-16), a repeated id later in time whose raw trade ids follow the
    previous row's (user, 2026-10-31); an identical or same-moment repeat does not."""
    return (last_id is None or identity == last_id + 1
            or (identity == last_id and last_time is not None and last_trade is not None and moment > last_time
                and first > last_trade))


class _Irregular(Exception):
    """A day `_vectorized` does not take as it is; `batches` reads it again row by row."""


def batches(path: Path, symbol: str, day: str, state: State, block: int = BLOCK_BYTES):
    """A day's rows as agg_trade record batches, continuing `state` (updated once the whole day is read). Rows
    spelled as the archives spell them are checked and scaled a CSV block at a time (`_vectorized`); at a day it does
    not take as it is, the day is read again row by row (`_exact`), which takes every spelling `scaled` takes and
    raises the same refusal at the same row. Retains a block, or a batch of rows, and the previous event."""
    done = 0
    try:
        for batch in _vectorized(path, symbol, day, state, block):
            done += batch.num_rows
            yield batch
    except _Irregular:
        for rows in _exact(path, symbol, day, state, done):
            yield record_batch(rows)


def _vectorized(path: Path, symbol: str, day: str, state: State, block: int):
    """`_exact`'s checks and scaling column by column, for archives in plain spelling (`INTEGER`, `DECIMAL`, a
    lower- or title-case maker flag); _Irregular at anything else, including a row any check refuses."""
    low = clock.day_ms(date.fromisoformat(day))
    last_id, last_time, last_trade = state.last_id, state.last_time, state.last_trade
    count = 0
    try:
        with zipfile.ZipFile(path) as archive:
            names = archive.namelist()
            if len(names) != 1:
                raise _Irregular
            with archive.open(names[0]) as head:
                if head.read(len(codecs.BOM_UTF8)) == codecs.BOM_UTF8:  # Arrow drops it, the csv module keeps it
                    raise _Irregular
            with archive.open(names[0]) as raw:
                reader = pacsv.open_csv(
                    raw, read_options=pacsv.ReadOptions(use_threads=False, block_size=block,
                                                     autogenerate_column_names=True),
                    parse_options=pacsv.ParseOptions(ignore_empty_lines=False),
                    convert_options=pacsv.ConvertOptions(column_types={f"f{i}": pa.string() for i in range(7)}))
                for index, batch in enumerate(reader):
                    if batch.num_columns != len(COLUMNS) or any(column.null_count for column in batch.columns):
                        raise _Irregular  # an empty line reads as nulls
                    if index == 0 and batch.num_rows and [column[0].as_py() for column in batch.columns] == list(
                            COLUMNS):
                        batch = batch.slice(1)
                    if not batch.num_rows:
                        continue
                    identities, prices, quantities, firsts, lasts, moments, makers = batch.columns
                    identity, first, last, moment = (_integers(column) for column in (identities, firsts, lasts,
                                                                                      moments))
                    if not pc.all(pc.is_in(makers, value_set=MAKERS)).as_py():
                        raise _Irregular
                    steps, later = np.diff(identity), np.diff(moment)
                    if (np.any(first > last) or np.any(later < 0) or moment[0] < low or moment[-1] >= low + store.DAY
                            or (last_time is not None and moment[0] < last_time)
                            or not follows(last_id, last_time, last_trade, int(identity[0]), int(moment[0]),
                                           int(first[0]))
                            or np.any((steps != 1) & ~((steps == 0) & (later > 0) & (first[1:] > last[:-1])))):
                        raise _Irregular
                    count += batch.num_rows
                    last_id, last_time, last_trade = int(identity[-1]), int(moment[-1]), int(last[-1])
                    yield pa.RecordBatch.from_arrays(
                        [pa.repeat(pa.scalar(symbol, pa.string()), batch.num_rows), moment, identity,
                         _decimals(prices), _decimals(quantities), first, last,
                         pc.is_in(makers, value_set=BUYER_MAKER)], schema=files.AGG_TRADE.schema)
    except (pa.ArrowException, ValueError, OSError, zipfile.BadZipFile, zlib.error, EOFError) as exc:
        raise _Irregular from exc
    if not count:
        raise _Irregular
    state.last_id, state.last_time, state.last_trade = last_id, last_time, last_trade


def _integers(column: pa.Array) -> np.ndarray:
    if not pc.all(pc.match_substring_regex(column, INTEGER)).as_py():
        raise _Irregular
    return pc.cast(column, pa.int64()).to_numpy()


def _decimals(column: pa.Array) -> pa.Array:
    """`scaled` of each value, all spelled as `DECIMAL`, none zero."""
    parts = pc.extract_regex(column, DECIMAL)
    if parts.null_count:
        raise _Irregular
    found = pc.cast(pc.binary_join_element_wise(parts.field("units"), pc.utf8_rpad(parts.field("fraction"),
                                                                                   files.TRADE_SCALE, "0"), ""),
                    pa.int64())
    if pc.min(found).as_py() < 1:
        raise _Irregular
    return found


def _exact(path: Path, symbol: str, day: str, state: State, skip: int, size: int = BATCH_ROWS):
    """One CSV row at a time, the rows after the first `skip` in batches of `size`."""
    label = f"{symbol} {day}"
    low = clock.day_ms(date.fromisoformat(day))
    previous_id, previous_time, previous_trade = state.last_id, state.last_time, state.last_trade
    count = 0
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
                    if not follows(previous_id, previous_time, previous_trade, identity, moment, first):
                        raise refuse("SEQUENCE_GAP", f"{label}: aggTrade ids are not contiguous (after agg_trade_id "
                                     f"{previous_id} comes {identity})", missing=(label,))
                    if previous_time is not None and moment < previous_time:
                        raise ValueError("transact_time goes backwards")
                    if not low <= moment < low + store.DAY:
                        raise ValueError(f"transact_time {moment} is outside its UTC archive day")
                    p, q = scaled(price, label + " price"), scaled(quantity, label + " quantity")
                    count += 1
                    previous_id, previous_time, previous_trade = identity, moment, last
                    if count > skip:
                        rows.append((symbol, moment, identity, p, q, first, last, maker.lower() == "true"))
                    if len(rows) >= size:
                        yield rows
                        rows = []
    except (ValueError, csv.Error, UnicodeError, zipfile.BadZipFile, zlib.error, EOFError) as exc:
        raise refuse("SOURCE_SHAPE", f"{label}: rows do not parse as complete aggTrades ({exc})",
                     missing=(label,)) from exc
    if not count:
        raise refuse("SOURCE_SHAPE", f"{label}: the archive holds no trades", missing=(label,))
    state.last_id, state.last_time, state.last_trade = previous_id, previous_time, previous_trade
    if rows:
        yield rows


def record_batch(rows: list[tuple]) -> pa.RecordBatch:
    """Rows of `batches` as agg_trade's columns."""
    return pa.RecordBatch.from_arrays([pa.array(column, field.type) for column, field in zip(
        zip(*rows, strict=True), files.AGG_TRADE.schema, strict=True)], schema=files.AGG_TRADE.schema)


def import_month(profile: dict, month: date, cache: Path, symbols: list[str], log=print) -> dict:
    """One ended month of each contract in `symbols`, each its own file (store.import_contracts). The contracts are
    written at once, each in its own worker process (parsing a day's CSV is the work), while this process holds the
    import lock and places their files in contract order. A contract's refusal leaves the other contracts' files in
    place; the refusal raised is that of the first refused contract, and its message names the others written."""
    def run(market: files.Market, scope: list[str], start: int, end: int) -> dict:
        jobs = [{"root": str(market.root), "symbol": symbol, "cache": str(cache), "start": start, "end": end,
                 "held": bool(files.entries(market, "agg_trade", [symbol], start, end)),
                 "earlier": store.earlier_file(market, "agg_trade", symbol, start)} for symbol in scope]
        return {"codec": CODEC, "per_symbol": store.contract_files(market, jobs, trade_month, len(jobs), log)}
    # an empty, repeated or malformed list is EMPTY_SYMBOLS
    return store.import_contracts(profile, month, symbols or [], store.closed_month, run,
                                  "the market holds no bars yet")


def eve(cache: Path, symbol: str, start: int, earlier: bool, state: State):
    """`batches` of the day before the month from its archive, which carries the trade sequence into the month; None
    when it is not published, which it may be only when the market holds no earlier file of the contract (not
    `earlier`)."""
    day = clock.ms_day(start - store.DAY).isoformat()
    path = (sources.fetch_archive if earlier else sources.published)(cache, sources.aggtrades_key(symbol, day))
    return None if path is None else batches(path, symbol, day, state)


def month_rows(cache: Path, symbol: str, start: int, end: int, earlier: bool):
    """A contract month's daily archives as `batches` rows, each fetched into `cache` or read from it, after the eve
    (`eve`); without it the sequence starts on the first day."""
    state = State()
    for _ in eve(cache, symbol, start, earlier, state) or ():
        pass
    for moment in range(start, end, store.DAY):
        day = clock.ms_day(moment).isoformat()
        yield from batches(sources.fetch_archive(cache, sources.aggtrades_key(symbol, day)), symbol, day, state)


def trade_month(job: dict) -> dict:
    """One contract month as one file (in a worker process): {written, result}."""
    started = time.monotonic()
    symbol, cache, start, end = job["symbol"], Path(job["cache"]), job["start"], job["end"]
    if job["held"]:  # this contract only: the others of the call go on
        raise refuse("MONTH_EXISTS", f"the market already holds {clock.ms_day(start):%Y-%m} aggTrades of {symbol}",
                     missing=(f"{clock.ms_day(start):%Y-%m}",))
    total = 0

    def rows():
        nonlocal total
        for found in month_rows(cache, symbol, start, end, job["earlier"]):
            total += found.num_rows
            yield found

    written = files.write_file(store.worker_market(job), "agg_trade", clock.ms_day(start), symbol, rows())
    return {"written": written, "result": {"rows": total, "seconds": round(time.monotonic() - started, 1)}}
