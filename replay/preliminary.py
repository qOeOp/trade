"""A preliminary comparison's market (user 2026-11-17, 「加初步对账」): the market with the minutes Binance has not
archived yet read from its public REST endpoints, as a working copy under the comparison's temporary directory.

`overlay` makes a new market directory whose files link to the market's own (contract terms, members, bars, funding
and, for a source that read metrics, the run's contracts' metrics) and rewrites, beside them, only the months the
window reaches past what the market holds: their stored rows and, after each contract's last stored minute,
settlement or metrics row, the REST rows up to the window's end (market.sources: klines and markPriceKlines,
fundingRate, futures/data). Nothing reaches the market directory: every file written lies under the new directory,
and a link is replaced, never written through. A comparison on it is labelled preliminary (`data_source` rest)
wherever it is shown; the comparison on the archive stays the one that counts.

The requests are paced (market.sources) and the first refusal by Binance's limits (HTTP 403, 418, 429 or 451) ends
the comparison instead of being waited out.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable
from datetime import date
import os
from pathlib import Path

import pyarrow as pa
import pyarrow.compute as pc

from engine.config import utc_text
from market import files, metrics as stored_metrics, series, sources, store
from market.sources import DAY, MINUTE

MS = 1_000_000
LINKED = ("instrument", "universe_month", "bar", "funding")
SEARCH_MS = 32 * DAY  # how far before the window a contract's last settlement or metrics row is looked for


def _link(real: files.Market, root: Path, table: str, symbols: list[str] | None) -> None:
    """Link each file of `table` into `root`, in directories of its own: a write there replaces the link."""
    for entry in files.entries(real, table, symbols):
        target = root / entry.relative
        target.parent.mkdir(parents=True, exist_ok=True)
        os.symlink(real.root / entry.relative, target)


def _month(ms: int) -> date:
    return series._ms_day(ms).replace(day=1)


def _months(rows: Iterable[tuple], at: Callable[[tuple], int]) -> dict[date, list[tuple]]:
    found: dict[date, list[tuple]] = {}
    for row in rows:
        found.setdefault(_month(at(row)), []).append(row)
    return found


def _last(market: files.Market, table: str, symbol: str, column: str, low: int, high: int,
          price_type: str | None = None) -> int | None:
    """The latest `column` value of `symbol`'s rows in [low, high), of `price_type` for bars."""
    last = None
    for batch in files.read_table(market, None, table, [symbol], low, high):
        if price_type is not None:
            batch = batch.filter(pc.equal(batch.column("price_type"), price_type))
        if batch.num_rows:
            found = pc.max(batch.column(column)).as_py()
            last = found if last is None else max(last, found)
    return last


def _sorted(table: str, batches: list[pa.RecordBatch]) -> list[pa.RecordBatch]:
    definition = files.TABLES[table]
    rows = pa.Table.from_batches(batches, definition.schema)
    return rows.sort_by([(name, "ascending") for name in definition.key]).combine_chunks().to_batches()


def _whole(market: files.Market, table: str, month: date, symbol: str | None, new: list[pa.RecordBatch]) -> files.Written:
    """The month's file of `table` again: its stored rows and the new ones."""
    entry = files.data_file(table, month, symbol)
    stored = list(files.read_table(market, None, table, None if symbol is None else [symbol], entry.start_ms,
                                   entry.end_ms))
    return files.write_file(market, table, month, symbol, _sorted(table, [*stored, *new]))


def _bars(market: files.Market, symbols: list[str], start: int, end: int, fetched: dict) -> list[files.Written]:
    new: dict[date, list[pa.RecordBatch]] = {}
    for symbol in symbols:
        for price_type in series.PRICE_TYPES:
            last = _last(market, "bar", symbol, "ts_open", start, end, price_type)
            low = start if last is None else last + MINUTE
            rows = sources.rest_klines(price_type, symbol, "1m", low, end, patient=False) if low < end else []
            fetched.setdefault(symbol, {})[price_type] = {"from": utc_text(low * MS) if rows else None,
                                                          "bars": len(rows)}
            for month, part in _months(rows, lambda row: row[0]).items():
                bars, _ = store.bar_rows(sources.rows_table(part), symbol, price_type)
                new.setdefault(month, []).append(store.bar_batch(symbol, price_type, bars))
    return [_whole(market, "bar", month, None, batches) for month, batches in sorted(new.items())]


def _funding(market: files.Market, symbols: list[str], start: int, end: int, fetched: dict) -> list[files.Written]:
    new: dict[date, list[tuple]] = {}
    for symbol in symbols:
        last = _last(market, "funding", symbol, "funding_time", start - SEARCH_MS, end)
        low = start if last is None else last + 1
        rows = [row for row in sources.rest_funding(symbol, low, end, patient=False)
                if last is None or store.funding_slot(row[0]) != store.funding_slot(last)] if low < end else []
        fetched.setdefault(symbol, {})["funding"] = len(rows)
        for month, part in _months([(symbol, at, rate) for at, rate in rows], lambda row: row[1]).items():
            new.setdefault(month, []).extend(part)
    return [_whole(market, "funding", month, None, [store.funding_batch(sorted(rows))])
            for month, rows in sorted(new.items())]


def _metrics(market: files.Market, symbols: list[str], start: int, end: int, fetched: dict) -> list[files.Written]:
    written = []
    for symbol in symbols:
        last = _last(market, "metrics", symbol, "create_time", start - SEARCH_MS, end)
        low = start - start % stored_metrics.STEP if last is None else last + stored_metrics.STEP
        rows = sources.rest_metrics(symbol, low, end, patient=False) if low < end else []
        fetched.setdefault(symbol, {})["metrics"] = len(rows)
        for month, part in sorted(_months(rows, lambda row: row[1]).items()):
            written.append(_whole(market, "metrics", month, symbol, [stored_metrics.batch(part)]))
    return written


def overlay(market: dict, symbols: list[str], start: int, end: int, metrics: bool, root: Path) -> tuple[dict, dict]:
    """(the market profile of a new directory `root`, what REST added): the market's files linked, and the bars
    (LAST and MARK), funding and, with `metrics`, the metrics of `symbols` from each one's last stored row to `end`
    (ns) read from public REST, from `start` (ns) where it stores none."""
    real = files.open_market(market, "reader")
    root.mkdir(mode=0o700)
    for table in LINKED:
        _link(real, root, table, None)
    if metrics:
        _link(real, root, "metrics", symbols)
    copy = files.open_market({"root": str(root)}, "import")
    low, high = start // MS - start // MS % MINUTE, end // MS
    fetched: dict[str, dict] = {}
    with files.lock(copy):
        written = _funding(copy, symbols, low, high, fetched)
        if metrics:
            written += _metrics(copy, symbols, low, high, fetched)
        written += _bars(copy, symbols, low, high, fetched)  # bars last: the newest day comes from them
        for item in written:
            if not Path(item.temporary).resolve().is_relative_to(root.resolve()):
                raise AssertionError(f"{item.temporary} lies outside the preliminary market")
        files.place(copy, written)
    profile = {**market, "name": f"{market.get('name') or 'market'}-rest", "kind": "temporary", "root": str(root)}
    return profile, {"data_source": "rest", "market_day": files.latest_market_day(real), "until": utc_text(end),
                     "fetched": fetched}
