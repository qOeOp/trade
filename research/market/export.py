"""Export one market commit as Nautilus ParquetDataCatalogs for a replay window.

Per contract, `<root>/<SYMBOL>/` is one Catalog holding the instrument, LAST bars of the replay
timeframe and MARK price updates over [start, end), funding updates in [start, end), and the
complete UTC daily LAST bars before `start` (daily warm-up). Every timeframe is derived from the
stored one-minute bars by one rule (WS8a section 3): open is the first traded minute's open, high
and low are taken over traded minutes (volume > 0), all minutes only when none traded; close is
the last minute's close; volume is the sum. Weeks start Monday 00:00 UTC. A bucket holds the
minutes the source has; a bucket with none does not exist.

`export.json`, written last, marks a complete export and carries the counts the runner checks
against what BacktestNode loads. A cache entry is keyed by commit and window; a missing or partial
one is exported again.
"""

from __future__ import annotations

from concurrent.futures import ProcessPoolExecutor
from datetime import UTC, datetime
from decimal import Decimal
import json
import os
from pathlib import Path
import shutil
import tempfile
import time

import numpy as np
import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.parquet as pq

from research.market import store


MINUTE = 60_000
DAY = 86_400_000
STEPS = {"1m": MINUTE, "5m": 5 * MINUTE, "15m": 15 * MINUTE, "30m": 30 * MINUTE, "1h": 60 * MINUTE,
         "2h": 120 * MINUTE, "4h": 240 * MINUTE, "6h": 360 * MINUTE, "8h": 480 * MINUTE, "12h": 720 * MINUTE,
         "1d": DAY, "1w": 7 * DAY}
WEEK_OFFSET = 4 * DAY  # 1970-01-01 was a Thursday
NAUTILUS_SCALE = 16  # Nautilus high-precision raw: value x 10^16, little-endian int128
MARK_PRECISION = 8
CHUNK = 250_000
# Account terms Binance does not publish per contract; the same assumption the old Catalog used.
ASSUMED = {"maker_fee": "0.0002", "taker_fee": "0.0005", "margin_init": "0.1", "margin_maint": "0.1"}
COLUMNS = ("ts_open", "open", "high", "low", "close", "volume")


def _bar_spec(timeframe: str) -> str:
    unit = {"m": "MINUTE", "h": "HOUR", "d": "DAY", "w": "WEEK"}[timeframe[-1]]
    return f"{timeframe[:-1]}-{unit}"


def instrument_id(symbol: str) -> str:
    return f"{symbol}-PERP.BINANCE"


# Derivation

def buckets(ts: np.ndarray, timeframe: str) -> np.ndarray:
    step = STEPS[timeframe]
    offset = WEEK_OFFSET if timeframe == "1w" else 0
    return (ts - offset) // step * step + offset


def derive(bars: dict[str, np.ndarray], timeframe: str) -> dict[str, np.ndarray]:
    """Aggregate sorted one-minute integer bars into `timeframe` buckets (the WS8a rule)."""
    if timeframe == "1m" or not len(bars["ts_open"]):
        return bars
    start = buckets(bars["ts_open"], timeframe)
    first = np.nonzero(np.concatenate([[True], start[1:] != start[:-1]]))[0]
    o, h, l, c, v = (bars[name] for name in COLUMNS[1:])
    traded = v > 0
    any_traded = np.add.reduceat(traded.astype(np.int64), first) > 0
    big, small = np.iinfo(np.int64).max, np.iinfo(np.int64).min
    first_traded = np.minimum.reduceat(np.where(traded, np.arange(len(v)), big), first)
    last = np.concatenate([first[1:], [len(v)]]) - 1
    if float(np.add.reduceat(v.astype(np.float64), first).max()) >= 2.0 ** 62:
        raise OverflowError(f"{timeframe} volume would exceed BIGINT")
    return {
        "ts_open": start[first],
        "open": o[np.where(any_traded, first_traded, first)],
        "high": np.where(any_traded, np.maximum.reduceat(np.where(traded, h, small), first),
                         np.maximum.reduceat(h, first)),
        "low": np.where(any_traded, np.minimum.reduceat(np.where(traded, l, big), first),
                        np.minimum.reduceat(l, first)),
        "close": c[last],
        "volume": np.add.reduceat(v, first),
    }


# Reading a commit

def fetch(conn, commit: str, symbol: str, price_type: str, start: int, end: int) -> dict[str, np.ndarray]:
    """One series' one-minute bars in [start, end) at a commit, streamed into integer arrays."""
    import pymysql.cursors
    chunks = []
    with conn.cursor(pymysql.cursors.SSCursor) as cursor:
        cursor.execute(f"SELECT ts_open, open, high, low, close, volume FROM bar AS OF '{commit}' "
                       "WHERE symbol = %s AND price_type = %s AND ts_open >= %s AND ts_open < %s "
                       "ORDER BY ts_open", (symbol, price_type, start, end))
        while rows := cursor.fetchmany(200_000):
            chunks.append(np.array(rows, dtype=np.int64))
    stacked = np.concatenate(chunks) if chunks else np.empty((0, 6), np.int64)
    return {name: np.ascontiguousarray(stacked[:, index]) for index, name in enumerate(COLUMNS)}


def terms(conn, commit: str, symbol: str) -> dict:
    """The latest terms observed at the commit: one Nautilus instrument per replay."""
    from research.records import db
    found = db.dicts(
        conn, f"SELECT * FROM instrument AS OF '{commit}' WHERE symbol = %s ORDER BY observed_at DESC LIMIT 1",
        (symbol,))
    if not found:
        raise store._refuse(f"{symbol}: no terms at {commit}", "NO_TERMS")
    return found[0]


def funding(conn, commit: str, symbol: str, start: int, end: int) -> list[tuple[int, Decimal]]:
    from research.records import db
    return db.rows(conn, f"SELECT funding_time, rate FROM funding AS OF '{commit}' WHERE symbol = %s "
                         "AND funding_time >= %s AND funding_time < %s ORDER BY funding_time", (symbol, start, end))


# Writing a Catalog

def decimals(increment: str) -> int:
    return len(increment.split(".")[1]) if "." in increment else 0


def needed_decimals(values: np.ndarray, scale: int) -> int:
    """The fewest decimals that represent every integer at `scale` exactly."""
    for places in range(scale + 1):
        if not len(values) or not np.any(values % 10 ** (scale - places)):
            return places
    return scale


def nautilus_raw(values: np.ndarray, scale: int) -> pa.Array:
    """Integers at `scale` as Nautilus fixed-point raws (value x 10^16, int128 little-endian)."""
    words = np.empty((len(values), 2), np.int64)
    words[:, 0], words[:, 1] = values, values >> 63
    decimal = pa.Array.from_buffers(pa.decimal128(38, scale), len(values), [None, pa.py_buffer(words.tobytes())])
    decimal = pc.cast(decimal, pa.decimal128(38, NAUTILUS_SCALE), safe=True)
    return pa.Array.from_buffers(pa.binary(16), len(decimal), [None, decimal.buffers()[1]], offset=decimal.offset)


def build_instrument(symbol: str, row: dict, price_precision: int, *, native_id: str | None = None):
    from nautilus_trader.model import CryptoPerpetual, Currency, InstrumentId, Money, Price, Quantity, Symbol
    usdt = Currency.from_str("USDT")
    base_currency = Currency.from_str(symbol.removesuffix("USDT"))
    increment = row["price_increment"] if decimals(row["price_increment"]) == price_precision else format(
        Decimal(1).scaleb(-price_precision), "f")
    size = row["size_increment"]
    optional = lambda key, kind: kind(row[key]) if row[key] is not None else None  # noqa: E731
    return CryptoPerpetual(
        instrument_id=InstrumentId.from_str(native_id or instrument_id(symbol)), raw_symbol=Symbol(symbol),
        base_currency=base_currency, quote_currency=usdt, settlement_currency=usdt, is_inverse=False,
        price_precision=price_precision, size_precision=decimals(size),
        price_increment=Price.from_str(increment), size_increment=Quantity.from_str(size), ts_event=0, ts_init=0,
        multiplier=Quantity.from_str("1"), lot_size=Quantity.from_str(size),
        max_quantity=optional("max_quantity", Quantity.from_str), min_quantity=optional("min_quantity", Quantity.from_str),
        min_notional=Money(Decimal(row["min_notional"]), usdt) if row["min_notional"] is not None else None,
        max_price=optional("max_price", Price.from_str), min_price=optional("min_price", Price.from_str),
        margin_init=Decimal(ASSUMED["margin_init"]), margin_maint=Decimal(ASSUMED["margin_maint"]),
        maker_fee=Decimal(ASSUMED["maker_fee"]), taker_fee=Decimal(ASSUMED["taker_fee"]))


def write_bars(catalog, bar_type: str, bars: dict[str, np.ndarray], step: int, price_precision: int,
               size_precision: int, price_scale: int, volume_scale: int) -> int:
    from nautilus_trader.persistence import BarDataWrangler
    ts = ((bars["ts_open"] + step - 1) * 1_000_000).astype(np.uint64)
    if len(ts) > 1 and not np.all(np.diff(ts.astype(np.int64)) > 0):
        raise RuntimeError(f"{bar_type}: unsorted export")
    wrangler = BarDataWrangler(bar_type, price_precision, size_precision)
    written = 0
    for offset in range(0, len(ts), CHUNK):
        part = slice(offset, offset + CHUNK)
        table = pa.table({**{name: nautilus_raw(bars[name][part], price_scale) for name in ("open", "high", "low", "close")},
                          "volume": nautilus_raw(bars["volume"][part], volume_scale),
                          "ts_event": pa.array(ts[part]), "ts_init": pa.array(ts[part])}).replace_schema_metadata(
            {"bar_type": bar_type, "instrument_id": bar_type.split("-")[0] + "-" + bar_type.split("-")[1],
             "price_precision": str(price_precision), "size_precision": str(size_precision)})
        sink = pa.BufferOutputStream()
        with pa.ipc.new_stream(sink, table.schema) as writer:
            writer.write_table(table)
        converted = wrangler.process_record_batch_bytes(sink.getvalue().to_pybytes())
        catalog.write_bars(converted)
        written += len(converted)
    return written


def write_marks(catalog, iid, bars: dict[str, np.ndarray], step: int, price_scale: int) -> int:
    from nautilus_trader.model import MarkPriceUpdate, Price
    ts = (bars["ts_open"] + step - 1) * 1_000_000
    divisor = 10 ** (price_scale - MARK_PRECISION)
    written = 0
    for offset in range(0, len(ts), CHUNK):
        part = slice(offset, offset + CHUNK)
        updates = [MarkPriceUpdate(instrument_id=iid, value=Price.from_raw(int(close // divisor) * 10 ** (
            NAUTILUS_SCALE - MARK_PRECISION), MARK_PRECISION), ts_event=int(t), ts_init=int(t))
            for close, t in zip(bars["close"][part], ts[part])]
        catalog.write_mark_price_updates(updates)
        written += len(updates)
    return written


def _ns_name(start: int, end: int) -> str:
    def stamp(value: int) -> str:
        return datetime.fromtimestamp(value // 1_000_000_000, UTC).strftime("%Y-%m-%dT%H-%M-%S") + \
            f"-{value % 1_000_000_000:09d}Z"
    return f"{stamp(start)}_{stamp(end)}.parquet"


def write_funding(root: Path, iid: str, rows: list[tuple[int, Decimal]]) -> int:
    """rc3 has no Python writer for FundingRateUpdate: the schema BacktestNode's loader reads."""
    if not rows:
        return 0
    times = np.array([row[0] for row in rows], dtype=np.uint64) * 1_000_000
    rates = [format(Decimal(row[1]).normalize(), "f") for row in rows]
    table = pa.table({
        "instrument_id": pa.array([iid] * len(rows), pa.string()), "rate": pa.array(rates, pa.string()),
        "interval": pa.array([None] * len(rows), pa.uint64()), "next_funding_ns": pa.array(times, pa.uint64()),
        "ts_event": pa.array(times, pa.uint64()), "ts_init": pa.array(times, pa.uint64()),
    }, schema=pa.schema([
        pa.field("instrument_id", pa.string(), False), pa.field("rate", pa.string(), False),
        pa.field("interval", pa.uint64()), pa.field("next_funding_ns", pa.uint64()),
        pa.field("ts_event", pa.uint64(), False), pa.field("ts_init", pa.uint64(), False)],
        metadata={"instrument_id": iid, "type": "FundingRateUpdate"}))
    directory = root / "data" / "funding_rate_update" / iid
    directory.mkdir(parents=True, exist_ok=True)
    pq.write_table(table, directory / _ns_name(int(times[0]), int(times[-1])), compression="snappy")
    return len(rows)


# One contract

def _export_episode(job: dict) -> dict:
    """Write one contract's Catalog for the window into `job['path']`; returns its receipt."""
    from nautilus_trader.model import InstrumentId
    from nautilus_trader.persistence import ParquetDataCatalog
    from research.records import db
    started = time.monotonic()
    symbol, commit, start, end, timeframe = job["symbol"], job["commit"], job["start"], job["end"], job["timeframe"]
    path = Path(job["path"])
    shutil.rmtree(path, ignore_errors=True)
    path.mkdir(parents=True)
    step = STEPS[timeframe]
    conn = db.connect(job["profile"], "reader")
    try:
        row = terms(conn, commit, symbol)
        raw_last = fetch(conn, commit, symbol, "LAST", start, end)
        raw_mark = fetch(conn, commit, symbol, "MARK", start, end)
        last = derive(raw_last, timeframe)
        mark = derive(raw_mark, timeframe)
        daily = derive(fetch(conn, commit, symbol, "LAST", 0, start - start % DAY), "1d") if job["daily"] else None
        rates = funding(conn, commit, symbol, start, end)
        from research.market.coverage import facts
        coverage = facts(conn, commit, symbol, start, end, raw_last, raw_mark, rates)
    finally:
        conn.close()
    episode = job.get('episode')
    if episode is not None:
        from research.market import lifecycle
        last = derive(lifecycle.project(raw_last, episode), timeframe)
        mark = derive(lifecycle.project(raw_mark, episode), timeframe)
        low, high = episode['start_ns'] or 0, lifecycle.end_ns(episode)
        if daily is not None:
            keep = daily['ts_open'] * 1_000_000 >= low
            if high is not None:
                keep &= (daily['ts_open'] + DAY - 1) * 1_000_000 < high
            daily = {name: values[keep] for name, values in daily.items()}
        rates = [(t, rate) for t, rate in rates if t * 1_000_000 >= low
                 and (high is None or t * 1_000_000 < high)]
    price_scale, volume_scale = job["scales"]
    exchange_precision = decimals(row["price_increment"])
    needed = max([needed_decimals(series[name], price_scale) for series in (last, daily) if series is not None
                  for name in ("open", "high", "low", "close")], default=0)
    precision = max(exchange_precision, needed)
    size_precision = decimals(row["size_increment"])
    native_id = episode['instrument_id'] if episode is not None else instrument_id(symbol)
    instrument = build_instrument(symbol, row, precision, native_id=native_id)
    if episode is not None:
        lifecycle.require_native_price(episode, instrument, start * 1_000_000, end * 1_000_000)
    catalog = ParquetDataCatalog(str(path))
    catalog.write_instruments([instrument])
    iid = InstrumentId.from_str(native_id)
    counts = {"last": write_bars(catalog, f"{iid}-{_bar_spec(timeframe)}-LAST-EXTERNAL", last, step, precision,
                                 max(size_precision, needed_decimals(last["volume"], volume_scale)),
                                 price_scale, volume_scale),
              "mark": write_marks(catalog, iid, mark, step, price_scale),
              "funding": write_funding(path, str(iid), rates)}
    if daily is not None:
        counts["daily"] = write_bars(catalog, f"{iid}-1-DAY-LAST-EXTERNAL", daily, DAY, precision,
                                     max(size_precision, needed_decimals(daily["volume"], volume_scale)),
                                     price_scale, volume_scale)
    if episode is not None:
        from research.market.lifecycle import write_events
        counts.update(write_events(path, episode, start * 1_000_000, end * 1_000_000))
    unmatched = int(len(np.setxor1d(last["ts_open"], mark["ts_open"])))
    receipt = {"symbol": symbol, "instrument_id": str(iid), "commit": commit, "timeframe": timeframe,
               "start_ns": start * 1_000_000, "end_ns": end * 1_000_000, "counts": counts, "coverage": coverage,
               "first_bar_ns": int((last["ts_open"][0] + step - 1) * 1_000_000) if len(last["ts_open"]) else None,
               "last_bar_ns": int((last["ts_open"][-1] + step - 1) * 1_000_000) if len(last["ts_open"]) else None,
               "missing_buckets": int((end - start) // step - len(last["ts_open"])),
               "last_mark_unmatched": unmatched,
               "price_precision": precision, "price_precision_widened": precision != exchange_precision,
               "terms_source": row["terms_source"], "terms_observed_at": row["observed_at"],
               "historical_terms": "CURRENT_SNAPSHOT_APPROXIMATION", "assumed": ASSUMED,
               "seconds": round(time.monotonic() - started, 1)}
    if episode is not None:
        receipt['episode'] = episode
    (path / "export.json").write_text(json.dumps(receipt, indent=1))
    return receipt


def export_symbol(job: dict) -> dict:
    if 'episodes' not in job:
        return _export_episode(job)
    path = Path(job['path'])
    path.mkdir(parents=True, exist_ok=True)
    receipts = []
    for index, episode in enumerate(job['episodes']):
        receipt = _export_episode({**job, 'episode': episode, 'path': str(path / f'episode-{index + 1}')})
        receipt.pop('seconds', None)
        receipt['catalog_directory'] = f'episode-{index + 1}'
        receipts.append(receipt)
    # Original scope and raw coverage remain visible, including wholly inactive contracts.
    value = {**receipts[0], 'episodes': receipts, 'seconds': 0.0}
    value.pop('episode', None)
    value.pop('catalog_directory', None)
    value['counts'] = {key: sum(r['counts'].get(key, 0) for r in receipts)
                       for key in {key for r in receipts for key in r['counts']}}
    (path / 'export.json').write_text(json.dumps(value, indent=1))
    return value


def complete(path: Path) -> dict | None:
    try:
        value = json.loads((path / "export.json").read_text())
        return value if value.get("coverage", {}).get("format") == "market-coverage-v1" else None
    except (OSError, ValueError):
        return None


def default_cache() -> Path:
    return Path(tempfile.gettempdir()) / "trade-market-catalog"


def export(profile: dict, *, at: str | None, symbols: list[str], start: int, end: int, timeframe: str = "1m",
           daily: bool = True, root: Path | None = None, workers: int = 4, fresh: bool = False,
           lifecycle_episodes: dict | None = None, lifecycle_files: dict | None = None) -> dict:
    """Export (or reuse from the cache) each contract's Catalog at one commit for [start, end) ms.

    Returns the window directory and the receipts. `fresh` exports into a new temporary directory
    and never reuses a cache entry.
    """
    from research.records import db
    conn = db.connect(profile, "reader")
    try:
        commit = store.resolve(conn, at)
        (price_scale, volume_scale), = db.rows(conn, f"SELECT price_scale, volume_scale FROM market_schema AS OF '{commit}'")
    finally:
        conn.close()
    if fresh:
        window = Path(tempfile.mkdtemp(prefix="market-export-", dir=root))
    else:
        window = Path(root or default_cache()) / commit / f"{start}-{end}-{timeframe}{'-d' if daily else ''}"
        if lifecycle_files is not None:
            from research.market.lifecycle import files_digest
            window = window.with_name(window.name + '-life-' + files_digest(lifecycle_files))
    receipts, jobs = {}, []
    for symbol in symbols:
        found = None if fresh else complete(window / symbol)
        if found:
            receipts[symbol] = found
        else:
            jobs.append({"symbol": symbol, "commit": commit, "start": start, "end": end, "timeframe": timeframe,
                         "daily": daily, "path": str(window / symbol), "profile": profile,
                         "scales": (price_scale, volume_scale)})
            if lifecycle_episodes and symbol in lifecycle_episodes:
                jobs[-1]['episodes'] = lifecycle_episodes[symbol]
    started = time.monotonic()
    if jobs:
        with ProcessPoolExecutor(min(workers, len(jobs))) as pool:
            for receipt in pool.map(export_symbol, jobs):
                receipts[receipt["symbol"]] = receipt
    if lifecycle_files is not None:
        for name, content in lifecycle_files.items():
            target = window / 'lifecycle-evidence' / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(content)
    return {"commit": commit, "root": str(window), "exported": len(jobs), "reused": len(symbols) - len(jobs),
            "seconds": round(time.monotonic() - started, 1), "receipts": receipts}
