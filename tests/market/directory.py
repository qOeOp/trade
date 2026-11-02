"""Market directories for the import tests: a throwaway one per test, `seed` writing a version the way
the bar import does for tests that need a market without stitching sources, and versions written by
hand, as another hand changing a market outside the imports would."""

from __future__ import annotations

from datetime import date
import hashlib
from pathlib import Path
import shutil
import tempfile

import pyarrow as pa
import pyarrow.parquet as pq

from market import series, store, universe, versions


def directory(cleanup) -> dict:
    """The profile of a new empty market directory, removed by `cleanup` (a test's addCleanup)."""
    root = tempfile.mkdtemp(prefix="market-")
    cleanup(shutil.rmtree, root, True)
    return {"root": root}


def head(profile: dict) -> str | None:
    found = Path(profile["root"]) / "head"
    return found.read_text().strip() if found.exists() else None


def move_head(profile: dict, commit: str) -> None:
    (Path(profile["root"]) / "head").write_text(f"{commit}\n")


def seed(profile: dict, *, month: str, through: str, terms: list[tuple[str, dict]], bars: dict,
         funding: dict | None = None, members: list[tuple] = (), scope="all", observed_at: int = 1) -> str:
    """One bar import's version: terms [(symbol, {increments})], bars {(symbol, price_type): integer
    columns}, funding {symbol: [(time, Decimal rate)]}, universe members [(month date, symbol)] of `month`."""
    classification = {"contract_type": "PERPETUAL", "quote_asset": "USDT", "underlying_type": "COIN",
                      "underlying_sub_types": []}
    start, end = (series._day_ms(date.fromisoformat(day)) for day in (month + "-01", through))
    market = versions.open_market(profile, "import")
    with versions.lock(market):
        entries = [versions.write_file(market, "instrument", None, observed_at, observed_at + 1, [store.instrument_batch(
            [(symbol, observed_at, {"terms_source": "exchange_info", **item, "min_quantity": "0.001",
                                    "max_quantity": "1000", "min_notional": "5", "min_price": "0.01",
                                    "max_price": "1000000", "classification": classification})
             for symbol, item in sorted(terms)])])] if terms else []
        if bars:  # a file from the month's start, or from the first bar given before it (an eve)
            low = min([start] + [int(columns["ts_open"][0]) for columns in bars.values()])
            entries.append(versions.write_file(market, "bar", None, low, end, [pa.RecordBatch.from_pydict(
                {"symbol": [symbol] * len(columns["ts_open"]), "price_type": [kind] * len(columns["ts_open"]),
                 **{name: columns[name] for name in series.COLUMNS}}, schema=versions.BAR.schema)
                for (symbol, kind), columns in sorted(bars.items())]))
        settlements = sorted((symbol, at, rate) for symbol, rows in (funding or {}).items() for at, rate in rows)
        if settlements:  # likewise from the first settlement before the month
            entries.append(versions.write_file(market, "funding", None, min([start] + [at for _, at, _ in settlements]),
                                               end, [store.funding_batch(settlements)]))
        for at in sorted({at for at, _ in members}):
            entries.append(store._members_file(market, at, sorted(symbol for day, symbol in members if day == at)))
        return versions.commit_version(market, entries, {"import": store.BARS, "month": month, "through": through,
                                                         "universe_rule": universe.RULE, "scope": scope})


def forged(profile: dict, *, schema: dict | None = None, table: str | None = None, symbol: str | None = None,
           start_ms: int = 0, end_ms: int = 0, rows: dict | None = None, replace: bool = False) -> str:
    """A version on top of head that no import wrote and no check read: its market_schema updated with
    `schema`, and a file of `rows` (columns by name) in `table`, in place of the files it meets when
    `replace`. Head moves to it."""
    market = versions.open_market(profile, "reader")
    assert market.version is not None
    files = list(market.version["files"])
    if table is not None:
        sink = pa.BufferOutputStream()
        pq.write_table(pa.table(rows or {}, schema=versions.tables_of(market.version)[table].schema), sink)
        data = sink.getvalue().to_pybytes()
        entry = {"table": table, "symbol": symbol, "start_ms": start_ms, "end_ms": end_ms,
                 "sha256": hashlib.sha256(data).hexdigest()}
        (market.root / "files" / f"{entry['sha256']}.parquet").write_bytes(data)
        files = [stored for stored in files if not (replace and versions.overlap(stored, entry))] + [entry]
    child = {"market_schema": {**market.market_schema, **(schema or {})}, "parent": market.head, "files": files,
             "receipts": market.version["receipts"]}
    made = versions.version_id(child)
    (market.root / "versions" / f"{made}.json").write_bytes(versions.canonical(child))
    move_head(profile, made)
    return made


def read(profile: dict, table: str, symbols: list[str] | None = None, start_ms: int | None = None,
         end_ms: int | None = None, commit: str | None = None) -> pa.Table:
    """The table's rows at `commit` (head by default) in key order."""
    market = versions.open_market(profile, "reader")
    version = versions.load_version(market, commit or market.head)
    definition = versions.tables_of(version)[table]
    return pa.Table.from_batches(list(versions.read_version(market, version, table, symbols, start_ms, end_ms)),
                                 definition.schema)
