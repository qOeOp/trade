"""Market directories for the import tests: a throwaway one per test, `seed` writing files the way the bar import
does for tests that need a market without stitching sources, and files written by hand, as another hand changing a
market outside the imports would."""

from __future__ import annotations

from datetime import date
from pathlib import Path
import shutil
import tempfile

import pyarrow as pa
import pyarrow.parquet as pq

from market import files, series, store, universe


def directory(cleanup) -> dict:
    """The profile of a new empty market directory, removed by `cleanup` (a test's addCleanup)."""
    root = tempfile.mkdtemp(prefix="market-")
    cleanup(shutil.rmtree, root, True)
    return {"root": root}


def _months(batch: pa.RecordBatch, table: str):
    """The batch split by the month of its time column, in month order."""
    days = [files._day(at) for at in batch.column(files.TABLES[table].time).to_pylist()]
    for month in sorted({day.replace(day=1) for day in days}):
        low, high = files._ms(month), files._ms(universe.next_month(month))
        yield month, batch.filter(pa.array([low <= files._ms(day) < high for day in days]))


def merged(market: files.Market, table: str, month: date | None, symbol: str | None, batch: pa.RecordBatch) -> files.Written:
    """The file of `month` written with `batch` added to what it holds, in key order."""
    definition = files.TABLES[table]
    low, high = (files._ms(month), files._ms(universe.next_month(month))) if month else (None, None)
    stored = list(files.scan(market, None, table, [symbol] if symbol else None, low, high))
    rows = pa.Table.from_batches([*stored, batch], definition.schema)
    order = [(name, "ascending") for name in definition.key]
    return files.write_file(market, table, month, symbol, rows.sort_by(order).combine_chunks().to_batches())


def seed(profile: dict, *, month: str, through: str, terms: list[tuple[str, dict]], bars: dict,
         funding: dict | None = None, members: list[tuple] = (), observed_at: int = 1) -> str:
    """One bar import's files: terms [(symbol, {increments})], bars {(symbol, price_type): integer columns}, funding
    {symbol: [(time, Decimal rate)]}, universe members [(month date, symbol)]. The commit of the day before `through`."""
    classification = {"contract_type": "PERPETUAL", "quote_asset": "USDT", "underlying_type": "COIN",
                      "underlying_sub_types": []}
    market = files.open_market(profile, "import")
    with files.lock(market):
        written = []
        if terms:
            written.append(merged(market, "instrument", None, None, store.instrument_batch(
                [(symbol, observed_at, {"terms_source": "exchange_info", **item, "min_quantity": "0.001",
                                        "max_quantity": "1000", "min_notional": "5", "min_price": "0.01",
                                        "max_price": "1000000", "classification": classification})
                 for symbol, item in sorted(terms)])))
        settlements = sorted((symbol, at, rate) for symbol, rows in (funding or {}).items() for at, rate in rows)
        if settlements:
            batch = store.funding_batch(settlements)
            written += [merged(market, "funding", at, None, part) for at, part in _months(batch, "funding")]
        for at in sorted({at for at, _ in members}):
            written.append(store._members_file(market, at, sorted(symbol for day, symbol in members if day == at)))
        if bars:
            batches = [pa.RecordBatch.from_pydict(
                {"symbol": [symbol] * len(columns["ts_open"]), "price_type": [kind] * len(columns["ts_open"]),
                 **{name: columns[name] for name in series.COLUMNS}}, schema=files.BAR.schema)
                for (symbol, kind), columns in sorted(bars.items())]
            batch = pa.Table.from_batches(batches, files.BAR.schema).combine_chunks().to_batches()[0]
            written += [merged(market, "bar", at, None, part) for at, part in _months(batch, "bar")]
        files.place(market, written)
    return files.commit_of(date.fromordinal(date.fromisoformat(through).toordinal() - 1))


def forged(profile: dict, table: str, month: date | None = None, symbol: str | None = None,
           rows: dict | None = None) -> Path:
    """A file of `rows` (columns by name) in `table`, in place of the one there, that no import wrote and no check
    read."""
    path = Path(profile["root"]) / files.relative_path(table, month, symbol)
    path.parent.mkdir(parents=True, exist_ok=True)
    pq.write_table(pa.table(rows or {}, schema=files.TABLES[table].schema), path)
    return path


def read(profile: dict, table: str, symbols: list[str] | None = None, start_ms: int | None = None,
         end_ms: int | None = None, commit: str | None = None) -> pa.Table:
    """The table's rows at `commit` (every row by default) in key order."""
    market = files.open_market(profile, "reader")
    definition = files.TABLES[table]
    return pa.Table.from_batches(list(files.read_table(market, commit, table, symbols, start_ms, end_ms)),
                                 definition.schema)
