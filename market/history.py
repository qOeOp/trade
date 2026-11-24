"""What an export takes from each contract's whole stored history (`market.contract_history`, `market.daily_bars`,
`market.data_end_stops`, `market.trade_halts`): the daily warm-up, the price grid's divisors and the first and last stored bars, from one
read of each `bar` month file for every contract at once (a file holds every contract and whole UTC days, so each file
is one task and a contract's days derive file by file), and where a contract's stored trades stop and resume."""

from __future__ import annotations

from concurrent.futures import ProcessPoolExecutor
from math import gcd
from typing import Any

import numpy as np
import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.parquet as pq

from market import files, lifecycle, series
from market.sources import DAY, MINUTE
from shared.refusals import refuse


COLUMNS = series.COLUMNS


def _keep(bars: dict[str, np.ndarray], keep: np.ndarray) -> dict[str, np.ndarray]:
    return {name: values[keep] for name, values in bars.items()}


def _gcd(values: np.ndarray) -> int:
    return int(np.gcd.reduce(values, axis=None)) if values.size else 0


def _contract_part(rows: np.ndarray, cuts: list[tuple[int, int | None]], start_ms: int, end_ms: int) -> dict:
    """One contract's LAST rows of one bar file (whole UTC days: a file is a month): their count, the greatest common
    divisor of their prices and of those opening at or after `start_ms`, and the daily bars of each cut (low, high):
    the minutes that open at or after low, before `end_ms`, and close before high."""
    prices, opens = rows[:, 1:5], rows[:, 0]
    daily = []
    for low, high in cuts:
        keep = (opens >= low) & (opens < (end_ms if high is None else min(end_ms, high)))
        if high is not None:
            keep &= opens + MINUTE - 1 < high
        daily.append(series.derive_bars({name: rows[keep, i] for i, name in enumerate(COLUMNS)}))
    return {"rows": len(rows), "gcd": _gcd(prices), "gcd_start": _gcd(prices[opens >= start_ms]), "daily": daily,
            "last": (int(opens[0]), int(opens[-1])), "mark": (None, None)}


def _file_history(market: files.Market, market_day: str, entry: files.DataFile, cuts: dict[str, list],
                  start_ms: int, end_ms: int) -> dict[str, dict]:
    """_contract_part of every contract in `cuts` that one bar file holds at the market day. A bar file is in key
    order (symbol, price type, time), so a contract's LAST rows are one run: each is finished before the next."""
    found: dict[str, dict] = {}
    pending: tuple[str, list[np.ndarray]] | None = None

    def finish() -> None:
        if pending is not None:
            symbol, blocks = pending
            if symbol in found:
                raise refuse("SERIES_UNSORTED", f"{entry.relative}: the rows of {symbol} are not contiguous",
                             missing=(entry.relative,))
            found[symbol] = _contract_part(np.concatenate(blocks), cuts[symbol], start_ms, end_ms)

    marks: dict[str, tuple[int, int]] = {}
    for batch in files.file_batches(files.file_bytes(market, entry), files.BAR, sorted(cuts), None,
                                    files._visible("bar", market_day, None)):
        mark = batch.filter(pc.equal(batch.column("price_type"), "MARK"))
        if mark.num_rows:
            edges = pa.Table.from_batches([mark]).group_by("symbol").aggregate([("ts_open", "min"), ("ts_open", "max")])
            for symbol, low, high in zip(*(edges.column(name).to_pylist() for name in
                                           ("symbol", "ts_open_min", "ts_open_max")), strict=True):
                before = marks.get(symbol, (low, high))
                marks[symbol] = (min(before[0], low), max(before[1], high))
        batch = batch.filter(pc.equal(batch.column("price_type"), "LAST"))
        if not batch.num_rows:
            continue
        rows = np.column_stack([batch.column(name).to_numpy() for name in COLUMNS])
        codes = pc.dictionary_encode(batch.column("symbol"))
        names, indices = codes.dictionary.to_pylist(), codes.indices.to_numpy()
        bounds = [0, *(np.flatnonzero(np.diff(indices)) + 1).tolist(), len(indices)]
        for low, high in zip(bounds, bounds[1:], strict=False):
            symbol = names[indices[low]]
            if pending is not None and pending[0] == symbol:
                pending[1].append(rows[low:high])
            else:
                finish()
                pending = (symbol, [rows[low:high]])
    finish()
    for symbol, edges in marks.items():
        found.setdefault(symbol, {"rows": 0, "gcd": 0, "gcd_start": 0, "daily": [{name: np.empty(0, np.int64) for name in
                                                                                    COLUMNS} for _ in cuts[symbol]],
                                  "last": (None, None)})["mark"] = edges
    return found


def _history_job(job: dict) -> dict[str, dict]:
    return _file_history(job["market"], job["market_day"], job["entry"], job["cuts"], job["start_ms"], job["end_ms"])


def contract_history(market: files.Market, market_day: str, cuts: dict[str, list[tuple[int, int | None]]], start_ms: int,
                     end_ms: int, pool: ProcessPoolExecutor | None = None, *, grid: bool = True) -> dict[str, dict]:
    """market.contract_history: per contract of `cuts` ({symbol: [(low_ms, high_ms or None), ...]}) what the export
    takes from its whole stored LAST history at the market day: `rows`, the greatest common divisors `gcd` of every
    price and `gcd_start` of those opening at or after `start_ms` (price_grid), and per cut the complete UTC daily
    LAST bars before `end_ms` of the minutes that open at or after low and close before high (`daily`, the daily
    warm-up), and the first and last stored open time of its LAST and MARK bars (`edges`, coverage_facts). Each bar file is read once for every contract, by `pool` when given; without `grid` only the files
    overlapping the cuts are read, and the divisors cover only those."""
    low = 0 if grid else min(cut[0] for symbol_cuts in cuts.values() for cut in symbol_cuts)
    jobs = [{"market": market, "market_day": market_day, "entry": entry, "cuts": cuts, "start_ms": start_ms,
             "end_ms": end_ms}
            for entry in files.entries(market, "bar", None, low, files._visible("bar", market_day, None if grid
                                                                                  else end_ms))]
    parts = pool.map(_history_job, jobs) if pool is not None else map(_history_job, jobs)
    found: dict[str, dict[str, Any]] = {
        symbol: {"rows": 0, "gcd": 0, "gcd_start": 0, "daily": [[] for _ in symbol_cuts],
                 "edges": {"LAST": (None, None), "MARK": (None, None)}} for symbol, symbol_cuts in cuts.items()}
    for part in parts:  # in file order, which is time order
        for symbol, piece in part.items():
            into = found[symbol]
            into["rows"] += piece["rows"]
            into["gcd"], into["gcd_start"] = gcd(into["gcd"], piece["gcd"]), gcd(into["gcd_start"], piece["gcd_start"])
            for days, more in zip(into["daily"], piece["daily"], strict=True):
                days.append(more)
            for kind, (low, high) in (("LAST", piece["last"]), ("MARK", piece["mark"])):
                first, latest = into["edges"][kind]
                if low is not None:  # files are in time order
                    into["edges"][kind] = (low if first is None else first, high)
    for into in found.values():
        dailies = []
        for days in into["daily"]:
            daily = {name: np.concatenate([part[name] for part in days]) if days else np.empty(0, np.int64)
                     for name in COLUMNS}
            dailies.append(_keep(daily, daily["ts_open"] + DAY <= end_ms))
        into["daily"] = dailies
    return found


def daily_cuts(episodes: list[dict] | None) -> list[tuple[int, int | None]]:
    """The (low_ms, high_ms) of each piece's daily warm-up: the whole history without a lifecycle, else each
    episode's complete minutes (split_episodes)."""
    if not episodes:
        return [(0, None)]
    return [(-(-episode["start_ns"] // 1_000_000), ended // 1_000_000 if (ended := lifecycle.termination(episode))
             is not None else None) for episode in episodes]


def daily_bars(market: files.Market, market_day: str, symbol: str, low_ms: int, high_ms: int | None,
               end_ms: int) -> dict[str, np.ndarray]:
    """The complete UTC daily LAST bars before `end_ms` derived from the stored minutes that open at or after
    `low_ms` and close before `high_ms` (contract_history's daily warm-up of one contract)."""
    return contract_history(market, market_day, {symbol: [(low_ms, high_ms)]}, low_ms, end_ms,
                            grid=False)[symbol]["daily"][0]


# market.data_end_stops

QUIET_DAYS = 7  # a contract counts as stopped when it trades no more for this long, up to its next trade or the market day's end


def _traded(market: files.Market, entry: files.DataFile, symbols: set[str], low: int | None, high: int) -> pa.Table:
    """The (symbol, ts_open) of the traded minutes (volume above zero: only LAST has volume) of `symbols` in one bar
    file that open in [low, high), from the row groups that may hold them and only the columns this needs."""
    source = files.file_source(market, entry)
    reader = pq.ParquetFile(source if isinstance(source, str) else pa.BufferReader(source))
    column, names, found = reader.schema_arrow.get_field_index("symbol"), sorted(symbols), []
    for group in range(reader.num_row_groups):
        stats = reader.metadata.row_group(group).column(column).statistics
        if stats is not None and stats.has_min_max and not any(stats.min <= name <= stats.max for name in names):
            continue
        rows = reader.read_row_group(group, columns=["symbol", "ts_open", "volume"])
        keep = pc.and_(pc.greater(rows.column("volume"), 0), pc.less(rows.column("ts_open"), high))
        if low is not None:
            keep = pc.and_(keep, pc.greater_equal(rows.column("ts_open"), low))
        rows = rows.filter(keep)
        found.append(rows.filter(pc.is_in(rows.column("symbol"), pa.array(names))).select(["symbol", "ts_open"]))
    return pa.concat_tables(found) if found else pa.table({"symbol": pa.array([], pa.string()),
                                                           "ts_open": pa.array([], pa.int64())})


def data_end_stops(market: files.Market, market_day: str, symbols: list[str], end_ms: int) -> dict[str, int]:
    """market.data_end_stops: {symbol: stop in ms} for each contract that is stopped at `end_ms`: its last traded LAST
    minute (volume above zero) closing before `end_ms` is followed by at least QUIET_DAYS without a trade, up to its
    next stored trade or the market day's end; the stop is that minute's close. Only the files around `end_ms` are
    read, and earlier ones for the contracts that did not trade there."""
    stop_ms, quiet = files.day_end("bar", market_day), QUIET_DAYS * DAY
    end_ms = min(end_ms, stop_ms + MINUTE)  # nothing after the market day is read
    cut = end_ms - MINUTE
    last: dict[str, int] = {}
    following: dict[str, int] = {}
    for entry in files.entries(market, "bar", None, end_ms - quiet, min(end_ms + quiet, stop_ms)):
        rows = _traded(market, entry, set(symbols), end_ms - quiet, min(end_ms + quiet, stop_ms))
        for found, aggregate, part in ((last, "max", rows.filter(pc.less(rows.column("ts_open"), cut))),
                                       (following, "min", rows.filter(pc.greater_equal(rows.column("ts_open"), cut)))):
            grouped = part.group_by("symbol").aggregate([("ts_open", aggregate)])
            for symbol, opened in zip(grouped.column("symbol").to_pylist(),
                                      grouped.column(f"ts_open_{aggregate}").to_pylist(), strict=True):
                found[symbol] = (max if aggregate == "max" else min)(found.get(symbol, opened), opened)
    pending = set(symbols) - set(last)
    for entry in reversed(files.entries(market, "bar", None, None, end_ms - quiet)):
        if not pending:
            break
        grouped = _traded(market, entry, pending, None, min(cut, end_ms - quiet)).group_by("symbol").aggregate(
            [("ts_open", "max")])
        last.update(zip(grouped.column("symbol").to_pylist(), grouped.column("ts_open_max").to_pylist(), strict=True))
        pending -= set(last)
    return {symbol: opened + MINUTE for symbol, opened in sorted(last.items())
            if min(following.get(symbol, stop_ms), stop_ms) - (opened + MINUTE) >= quiet}


# market.trade_halts

def _halts_job(job: tuple[files.Market, files.DataFile, set[str], int]) -> dict[str, tuple[int, int, list]]:
    """{symbol: (first traded minute, last traded minute, halts between)} of one bar file, trades opening before the
    end; a symbol's rows are in time order within the file."""
    market, entry, symbols, end_ms = job
    rows = _traded(market, entry, symbols, None, end_ms)
    codes = pc.dictionary_encode(rows.column("symbol")).combine_chunks()
    if isinstance(codes, pa.ChunkedArray):
        codes = codes.chunk(0)
    names, indices, opens = codes.dictionary.to_pylist(), codes.indices.to_numpy(), rows.column("ts_open").to_numpy()
    found = {}
    for at, symbol in enumerate(names):
        own = opens[indices == at]
        wide = np.flatnonzero(np.diff(own) - MINUTE >= QUIET_DAYS * DAY)
        found[symbol] = (int(own[0]), int(own[-1]), [(int(own[i]) + MINUTE, int(own[i + 1])) for i in wide])
    return found


def trade_halts(market: files.Market, market_day: str, symbols: list[str], end_ms: int,
                pool: ProcessPoolExecutor | None = None) -> dict[str, list[tuple[int, int]]]:
    """market.trade_halts: {symbol: [(stop, resumption)] in ms} of the LAST trades stored through `market_day` that open
    before `end_ms`: each span of at least QUIET_DAYS between two consecutive traded minutes, from the first's close to the second's open.
    Missing minutes count like minutes without volume: no position is carried over a span without data either."""
    end_ms = min(end_ms, files.day_end("bar", market_day))
    jobs = [(market, entry, set(symbols), end_ms) for entry in files.entries(market, "bar", None, None, end_ms)]
    found: dict[str, list[tuple[int, int]]] = {}
    last: dict[str, int] = {}
    for part in pool.map(_halts_job, jobs) if pool is not None else map(_halts_job, jobs):  # in time order
        for symbol, (first, latest, inside) in part.items():
            if symbol in last and first - last[symbol] - MINUTE >= QUIET_DAYS * DAY:
                found.setdefault(symbol, []).append((last[symbol] + MINUTE, first))
            if inside:
                found.setdefault(symbol, []).extend(inside)
            last[symbol] = latest
    return found
