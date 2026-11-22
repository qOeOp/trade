"""What an export takes from each contract's whole stored history (`market.contract_history`, `market.daily_bars`):
the daily warm-up, the price grid's divisors and the first and last stored bars, from one read of each `bar` month
file for every contract at once. A file holds every contract and whole UTC days, so each file is one task and a
contract's days derive file by file."""

from __future__ import annotations

from concurrent.futures import ProcessPoolExecutor
from math import gcd
from typing import Any

import numpy as np
import pyarrow as pa
import pyarrow.compute as pc

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
