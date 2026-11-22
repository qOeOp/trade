"""What an export takes from each contract's whole stored history (`market.contract_history`, `market.daily_bars`,
`market.data_end_stops`): the daily warm-up, the price grid's divisors and the first and last stored bars, from one
read of each `bar` month file for every contract at once (a file holds every contract and whole UTC days, so each file
is one task and a contract's days derive file by file), and where a contract's stored trades stop."""

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

QUIET_DAYS = 7  # a contract counts as stopped once its last trade is this long before the market day's end


def _traded(market: files.Market, entry: files.DataFile, symbols: set[str], low: int | None, high: int) -> pa.Table:
    """The (symbol, ts_open) of the traded minutes (volume above zero: only LAST has volume) of `symbols` in one bar
    file that open in [low, high), from the row groups that may hold them and only the columns this needs. A reader
    opens the file itself: mapping a whole month file costs more than the few row groups read (measured)."""
    reader = pq.ParquetFile(pa.BufferReader(files.file_bytes(market, entry)) if market.locked or entry.relative in
                            market.pending else str(market.root / entry.relative))
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
    """market.data_end_stops: {symbol: stop in ms} for each contract whose last traded LAST minute (volume above
    zero) of everything stored through `market_day` closes before `end_ms` and at least QUIET_DAYS before the market
    day's end; the stop is that minute's close. A trade opening at or after `cut` rules a stop out, so the files from
    the cut on are read only until each contract has traded there, and those before it only for the rest."""
    stop_ms = files.day_end("bar", market_day)
    cut = min(end_ms - MINUTE, stop_ms - QUIET_DAYS * DAY - MINUTE + 1)
    pending = set(symbols)
    for entry in files.entries(market, "bar", None, cut, stop_ms):
        if not pending:
            break
        pending -= set(pc.unique(_traded(market, entry, pending, cut, stop_ms).column("symbol")).to_pylist())
    last: dict[str, int] = {}
    for entry in reversed(files.entries(market, "bar", None, None, cut)):
        if not pending:
            break
        grouped = _traded(market, entry, pending, None, cut).group_by("symbol").aggregate([("ts_open", "max")])
        last.update(zip(grouped.column("symbol").to_pylist(), grouped.column("ts_open_max").to_pylist(), strict=True))
        pending -= set(last)
    return {symbol: opened + MINUTE for symbol, opened in sorted(last.items())}
