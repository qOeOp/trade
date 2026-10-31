"""Export one market commit as Nautilus ParquetDataCatalogs for a replay window (`market.export_catalogs`,
`market.export_episode`, `market.split_episodes`, `market.native_symbol`, `market.write_bars`,
`market.write_marks`, `market.write_quotes`, `market.write_funding`, `market.write_metrics`).

Per contract, `<root>/<SYMBOL>/` holds its receipt `export.json` and one Catalog per piece: the whole
contract when no lifecycle is given (the Catalog sits in the contract directory), one
`episode-<n>/` per lifecycle episode otherwise (a reused ticker becomes independent native
contracts). A Catalog holds the instrument, the stored one-minute LAST bars and one MARK price update
per one-minute MARK bar of the window, one QuoteTick per stored best bid/ask state (both sizes the
instrument's max quantity: no depth is modeled; none when the terms have no max quantity or no quotes are
stored), funding updates at their settlement times, the complete UTC
daily LAST bars derived from the minutes before the window's end (the daily warm-up) and the
episode's window events. `export.json`, written last, marks a complete export; a cache entry is
keyed by commit, window and lifecycle evidence, and a missing or partial one is exported again. The
receipt keeps the funding settlements' count and bounds, not their times: those stay in the pinned
commit (`market.read_funding`, `market bars`), and the receipt is sealed with every trial.
"""

from __future__ import annotations

from concurrent.futures import ProcessPoolExecutor
from decimal import Decimal, InvalidOperation
import hashlib
import json
from pathlib import Path
import shutil
import tempfile
from typing import Any

import numpy as np
import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.parquet as pq

from market import coverage, instrument, lifecycle, series, store
from market.sources import MINUTE, _refuse


DAY = 86_400_000
NAUTILUS_SCALE = 16  # Nautilus high-precision Catalog decimals: decimal128(38, 16)
CHUNK = 250_000
TIMEFRAME = "1m"  # the replay's execution bars (engine.config.EXECUTION_BAR_MINUTES)
FORMAT = coverage.FORMAT
COLUMNS = series.COLUMNS
VENUE = "BINANCE"


# market.native_symbol

def native_symbol(symbol: str, episode: int | None = None) -> dict:
    """market.native_symbol: {instrument_id, strategy_tag, short_name} of a public contract name and an
    optional episode number; a non-ASCII coin is spelled by its UTF-8 bytes."""
    if not isinstance(symbol, str) or not symbol.endswith("USDT") or symbol == "USDT" or "-" in symbol or "." in symbol:
        raise _refuse(f"{symbol!r} is no USDT perpetual name the engine can identify", "SYMBOL_SHAPE",
                      missing=(str(symbol),))
    if episode is not None and (type(episode) is not int or episode < 1):
        raise _refuse(f"episode {episode!r} is not a positive integer", "EPISODE_INDEX", missing=(str(episode),))
    coin = symbol.removesuffix("USDT")
    ascii_coin = coin if coin.isascii() else "X" + coin.encode().hex().upper()
    suffix = f"-E{episode}" if episode is not None else ""
    short = coin[4:] if coin.startswith("1000") and coin[4:5].isalpha() else coin
    return {"instrument_id": f"{ascii_coin}USDT{suffix}-PERP.{VENUE}",
            "strategy_tag": ascii_coin + (f"_E{episode}" if episode is not None else ""), "short_name": short}


# market.split_episodes

def _inside(bars: dict, low: int, high: int | None) -> dict:
    """The bars whose whole minute lies in [low, high) (milliseconds; no upper bound without `high`)."""
    opens = bars["ts_open"]
    keep = opens >= low
    if high is not None:
        keep &= opens + MINUTE - 1 < high
    return _keep(bars, keep)


def _keep(bars: dict[str, np.ndarray], keep: np.ndarray) -> dict[str, np.ndarray]:
    return {name: values[keep] for name, values in bars.items()}


def split_episodes(symbol: str, episodes: list[dict] | None, series_: dict, start_ns: int, end_ns: int) -> list[dict]:
    """market.split_episodes: the pieces of one contract; with lifecycle episodes, one native contract
    per episode holding only its complete minutes and the funding settled inside it."""
    if not episodes:
        native = native_symbol(symbol)
        return [{"index": None, "instrument_id": native["instrument_id"], "strategy_tag": native["strategy_tag"],
                 "episode": None, "low_ns": start_ns, "high_ns": end_ns, "catalog_dir": "", **series_}]
    previous_end = None
    pieces: list[dict] = []
    for index, episode in enumerate(episodes, start=1):
        if (not isinstance(episode, dict) or type(episode.get("start_ns")) is not int
                or not isinstance(episode.get("events"), list)
                or any(not isinstance(event, dict) or event.get("type") not in lifecycle.EVENT_TYPES
                       for event in episode["events"])):
            raise _refuse(f"episode {index} of {symbol} lacks start_ns or native events", "EPISODE_SHAPE",
                          missing=(symbol,))
        native = native_symbol(symbol, index)
        if episode.get("instrument_id") != native["instrument_id"]:
            raise _refuse(f"episode {index} of {symbol} is {episode.get('instrument_id')}, not "
                          f"{native['instrument_id']}", "EPISODE_SHAPE", missing=(symbol,))
        if pieces and (episode["start_ns"] <= pieces[-1]["episode"]["start_ns"] or previous_end is None
                       or episode["start_ns"] < previous_end):
            raise _refuse(f"episode {index} of {symbol} does not start after the previous one ended", "EPISODE_ORDER",
                          missing=(symbol,))
        low = episode["start_ns"] // 1_000_000
        ended = lifecycle.termination(episode)
        high = ended // 1_000_000 if ended is not None else None
        previous_end = ended
        pieces.append({"index": index, "instrument_id": native["instrument_id"], "strategy_tag": native["strategy_tag"],
                       "episode": episode, "low_ns": episode["start_ns"], "high_ns": ended,
                       "catalog_dir": f"episode-{index}", "last": _inside(series_["last"], low, high),
                       "mark": _inside(series_["mark"], low, high),
                       "daily_source": _inside(series_["daily_source"], low, high),
                       "funding": [(at, rate) for at, rate in series_["funding"]
                                   if at >= low and (high is None or at < high)]})
    return pieces


# Writing a Catalog (market.write_bars, market.write_marks, market.write_funding)

def needed_decimals(values: np.ndarray, scale: int) -> int:
    """The fewest decimals that represent every integer at `scale` exactly."""
    for places in range(scale + 1):
        if not len(values) or not np.any(values % 10 ** (scale - places)):
            return places
    return scale


def on_grid(values: np.ndarray, increment: str, scale: int) -> bool:
    """Whether every integer at `scale` is a whole multiple of `increment`; an increment finer than the
    scale's quantum counts as off the grid, which only widens the step to the prices' precision."""
    step = Decimal(increment).scaleb(scale)
    return step == step.to_integral_value() and (not len(values) or not np.any(values % int(step)))


def _exact(values: np.ndarray, scale: int, precision: int) -> bool:
    return precision >= scale or not len(values) or not np.any(values % 10 ** (scale - precision))


def nautilus_decimal(values: np.ndarray, scale: int) -> pa.Array:
    """Integers at `scale` as the Catalog's price and size column (decimal128(38, 16))."""
    words = np.empty((len(values), 2), np.int64)
    words[:, 0], words[:, 1] = values, values >> 63
    decimal = pa.Array.from_buffers(pa.decimal128(38, scale), len(values), [None, pa.py_buffer(words.tobytes())])
    return pc.cast(decimal, pa.decimal128(38, NAUTILUS_SCALE), safe=True)


def write_bars(catalog, bar_type: str, bars: dict[str, np.ndarray], step_ms: int, price_precision: int,
               size_precision: int, price_scale: int, volume_scale: int) -> int:
    """market.write_bars: integer bars as engine external Bars, each event at its close."""
    from nautilus_trader.persistence import BarDataWrangler
    ts = (bars["ts_open"].astype(np.int64) + step_ms - 1) * 1_000_000
    if len(ts) > 1 and not np.all(np.diff(ts) > 0):
        raise _refuse(f"{bar_type}: bar closes are not strictly increasing", "BARS_UNSORTED", missing=(bar_type,))
    if not all(_exact(bars[name], price_scale, price_precision) for name in ("open", "high", "low", "close")) or \
            not _exact(bars["volume"], volume_scale, size_precision):
        raise _refuse(f"{bar_type}: a price or volume is not exact at precision {price_precision}/{size_precision}",
                      "BAR_RAW_INEXACT", missing=(bar_type,))
    if not len(ts):
        return 0
    wrangler = BarDataWrangler(bar_type, price_precision, size_precision)
    instrument_id = bar_type.rsplit("-", 4)[0]
    written = 0
    for offset in range(0, len(ts), CHUNK):
        part = slice(offset, offset + CHUNK)
        stamps = pa.array(ts[part], pa.int64()).cast(pa.timestamp("ns", "UTC"))
        table = pa.table({**{name: nautilus_decimal(bars[name][part], price_scale) for name in ("open", "high", "low", "close")},
                          "volume": nautilus_decimal(bars["volume"][part], volume_scale),
                          "ts_event": stamps, "ts_init": stamps}).replace_schema_metadata(
            {"bar_type": bar_type, "instrument_id": instrument_id, "price_precision": str(price_precision),
             "size_precision": str(size_precision)})
        sink = pa.BufferOutputStream()
        with pa.ipc.new_stream(sink, table.schema) as writer:
            writer.write_table(table)
        converted = wrangler.process_record_batch_bytes(sink.getvalue().to_pybytes())
        catalog.write_bars(converted)
        written += len(converted)
    return written


def write_marks(catalog, instrument_id, bars: dict[str, np.ndarray], step_ms: int, price_precision: int,
                price_scale: int) -> int:
    """market.write_marks: one MarkPriceUpdate per MARK minute's close, at that close."""
    from nautilus_trader.model import MarkPriceUpdate, Price
    ts = (bars["ts_open"].astype(np.int64) + step_ms - 1) * 1_000_000
    if len(ts) > 1 and not np.all(np.diff(ts) > 0):
        raise _refuse(f"{instrument_id}: mark times are not strictly increasing", "MARK_UNSORTED",
                      missing=(str(instrument_id),))
    if not _exact(bars["close"], price_scale, price_precision):
        raise _refuse(f"{instrument_id}: a mark price is not exact at precision {price_precision}", "MARK_INEXACT",
                      missing=(str(instrument_id),))
    factor = 10 ** (NAUTILUS_SCALE - price_scale)
    written = 0
    for offset in range(0, len(ts), CHUNK):
        part = slice(offset, offset + CHUNK)
        updates = [MarkPriceUpdate(instrument_id=instrument_id, value=Price.from_raw(int(close) * factor, price_precision),
                                   ts_event=int(t), ts_init=int(t))
                   for close, t in zip(bars["close"][part], ts[part], strict=True)]
        catalog.write_mark_price_updates(updates)
        written += len(updates)
    return written


def write_funding(root: Path, instrument_id: str, rows: list[tuple[int, Decimal]]) -> int:
    """market.write_funding: one engine FundingRateUpdate per settlement, settled at its time.

    The pinned Nautilus has no Python writer for FundingRateUpdate: this is its Catalog layout (the file under
    data/funding_rates/<instrument>/, named by its first and last ts_init, that `ParquetDataCatalog.query` reads)."""
    if not rows:
        return 0
    times = np.array([row[0] for row in rows], dtype=np.int64) * 1_000_000
    if len(times) > 1 and not np.all(np.diff(times) > 0):
        raise _refuse(f"{instrument_id}: funding settlement times are not strictly increasing", "FUNDING_UNSORTED",
                      missing=(instrument_id,))
    try:
        rates = [Decimal(str(row[1])) for row in rows]
    except InvalidOperation as exc:
        raise _refuse(f"{instrument_id}: a funding rate is no decimal", "FUNDING_RATE_SHAPE",
                      missing=(instrument_id,)) from exc
    if not all(rate.is_finite() for rate in rates):
        raise _refuse(f"{instrument_id}: a funding rate is not finite", "FUNDING_RATE_SHAPE", missing=(instrument_id,))
    stamps = pa.array(times, pa.int64()).cast(pa.timestamp("ns", "UTC"))
    table = pa.table({
        "rate": pa.array([format(rate.normalize(), "f") for rate in rates], pa.string()),
        "interval": pa.array([None] * len(rows), pa.uint64()), "next_funding_ns": stamps, "ts_event": stamps,
        "ts_init": stamps, "identifier": pa.array([instrument_id] * len(rows), pa.string()),
    }, schema=pa.schema([
        pa.field("rate", pa.string(), False), pa.field("interval", pa.uint64()),
        pa.field("next_funding_ns", pa.timestamp("ns", "UTC")), pa.field("ts_event", pa.timestamp("ns", "UTC"), False),
        pa.field("ts_init", pa.timestamp("ns", "UTC"), False), pa.field("identifier", pa.string())],
        metadata={"type_name": "FundingRateUpdate", "instrument_id": instrument_id}))
    directory = Path(root) / "data" / "funding_rates" / instrument_id
    directory.mkdir(parents=True, exist_ok=True)
    pq.write_table(table, directory / lifecycle.file_name(int(times[0]), int(times[-1])), compression="snappy")
    return len(rows)


def write_quotes(catalog, instrument_id, rows, price_precision: int, size: str, size_precision: int, price_scale: int,
                 chunk: int = CHUNK) -> int:
    """market.write_quotes: one QuoteTick per stored best bid/ask state (`rows` yields (ts_ms, bid, ask) integer
    batches in time order); both sizes are `size` at the instrument's size precision (its max quantity: no depth
    is modeled)."""
    from nautilus_trader.model import Price, Quantity, QuoteTick
    factor = 10 ** (NAUTILUS_SCALE - price_scale)
    quantity = Quantity.from_str(format(Decimal(size).quantize(Decimal(1).scaleb(-size_precision)), "f"))
    written, last = 0, None
    pending = np.empty((0, 3), dtype=np.int64)

    def flush(part: np.ndarray) -> None:
        nonlocal written
        ticks = [QuoteTick(instrument_id, Price.from_raw(int(bid) * factor, price_precision),
                           Price.from_raw(int(ask) * factor, price_precision), quantity, quantity,
                           int(ts) * 1_000_000, int(ts) * 1_000_000) for ts, bid, ask in part.tolist()]
        catalog.write_quote_ticks(ticks)
        written += len(ticks)

    for batch in rows:
        block = np.array(batch, dtype=np.int64).reshape(-1, 3)
        if not len(block):
            continue
        if not _exact(block[:, 1], price_scale, price_precision) or not _exact(block[:, 2], price_scale, price_precision):
            raise _refuse(f"{instrument_id}: a quote price is not exact at precision {price_precision}", "QUOTE_INEXACT",
                          missing=(str(instrument_id),))
        if (last is not None and block[0, 0] < last) or np.any(np.diff(block[:, 0]) < 0):
            raise _refuse(f"{instrument_id}: quote times go backwards", "QUOTES_UNSORTED", missing=(str(instrument_id),))
        last = int(block[-1, 0])
        pending = np.concatenate((pending, block))
        while len(pending) >= chunk:
            # The catalog keeps each file's closed time interval disjoint from the others, so one millisecond's
            # states (several per trade burst) never straddle two files: a file ends only where the time changes.
            starts = np.flatnonzero(np.diff(pending[:, 0]) > 0) + 1  # where each later millisecond begins
            if not len(starts):
                break  # one millisecond so far: wait for the time to change
            within = starts[starts <= chunk]
            cut = int(within[-1] if len(within) else starts[0])  # a millisecond longer than a chunk is one file
            flush(pending[:cut])
            pending = pending[cut:]
    if len(pending):
        flush(pending)
    return written


def quote_rows(conn, commit: str, symbol: str, low_ms: int, high_ms: int | None, end_ms: int, chunk: int = CHUNK):
    """The stored quote states of [low_ms, min(high_ms, end_ms)) at `commit`, streamed as (ts, bid, ask) batches."""
    stop = end_ms if high_ms is None else min(end_ms, high_ms)
    # Historical bar-only commits predate the quote table. They export no quote states; the
    # quotes execution environment independently refuses a Catalog without quotes.
    if not conn.rows(f"SHOW TABLES AS OF '{commit}' LIKE 'quote'"):
        return
    yield from conn.stream(f"SELECT ts, bid, ask FROM quote AS OF '{commit}' WHERE symbol = %s AND ts >= %s AND ts < %s "
                           "ORDER BY ts, agg_trade_id", (symbol, low_ms, stop), size=chunk)


TRADE_SCALE = 8  # agg_trade prices and quantities: integers x 1e8 (binance-aggtrades-int64-scale8-v1)


def _month_end(ts_ms: int) -> int:
    """The first millisecond of the UTC month after the one holding `ts_ms`."""
    day = series._ms_day(ts_ms)
    return series._day_ms(day.replace(year=day.year + day.month // 12, month=day.month % 12 + 1, day=1))


def write_trades(catalog, instrument_id, rows, price_precision: int, size_precision: int, chunk: int = CHUNK) -> int:
    """market.write_trades: one TradeTick per stored aggregate trade (`rows` yields (ts_ms, agg_trade_id, price,
    quantity, is_buyer_maker) integer batches in (time, ID) order): the price and quantity exact at the
    instrument's precisions, the aggressor SELL when the buyer made the market (else BUY), the aggregate trade ID
    as the trade ID. A file never straddles a millisecond or a UTC month."""
    from nautilus_trader.model import AggressorSide, Price, Quantity, TradeId, TradeTick
    factor = 10 ** (NAUTILUS_SCALE - TRADE_SCALE)
    written, last = 0, None
    pending = np.empty((0, 5), dtype=np.int64)

    def flush(part: np.ndarray) -> None:
        nonlocal written
        ticks = [TradeTick(instrument_id, Price.from_raw(int(price) * factor, price_precision),
                           Quantity.from_raw(int(quantity) * factor, size_precision),
                           AggressorSide.SELL if maker else AggressorSide.BUY, TradeId(str(int(trade_id))),
                           int(ts) * 1_000_000, int(ts) * 1_000_000)
                 for ts, trade_id, price, quantity, maker in part.tolist()]
        catalog.write_trade_ticks(ticks)
        written += len(ticks)

    for batch in rows:
        block = np.array(batch, dtype=np.int64).reshape(-1, 5)
        if not len(block):
            continue
        if not _exact(block[:, 2], TRADE_SCALE, price_precision) or not _exact(block[:, 3], TRADE_SCALE, size_precision):
            raise _refuse(f"{instrument_id}: a trade price or quantity is not exact at precisions {price_precision}, "
                          f"{size_precision}", "TRADE_INEXACT", missing=(str(instrument_id),))
        pending = np.concatenate((pending, block))
        while len(pending):
            if last is None or pending[0, 0] >= last:
                last = _month_end(int(pending[0, 0]))
            inside = int(np.searchsorted(pending[:, 0], last))
            if inside < len(pending):
                flush(pending[:inside])  # the month ends here: its trades are complete
                pending = pending[inside:]
                continue
            if len(pending) < chunk:
                break
            changes = np.flatnonzero(np.diff(pending[:chunk + 1, 0]) > 0) if len(pending) > chunk else np.empty(0)
            if not len(changes):
                break  # one millisecond longer than a chunk: wait for the time to change
            cut = int(changes[-1]) + 1
            flush(pending[:cut])
            pending = pending[cut:]
    if len(pending):
        flush(pending)
    return written


def trade_rows(conn, commit: str, symbol: str, low_ms: int, high_ms: int | None, end_ms: int, chunk: int = CHUNK):
    """The stored aggregate trades of [low_ms, min(high_ms, end_ms)) at `commit`, streamed as (ts, agg_trade_id,
    price, quantity, is_buyer_maker) batches in (time, ID) order."""
    stop = end_ms if high_ms is None else min(end_ms, high_ms)
    # Commits before the agg_trade table export no trade; the runner refuses the months (TRADES_MISSING).
    if not conn.rows(f"SHOW TABLES AS OF '{commit}' LIKE 'agg_trade'"):
        return
    yield from conn.stream(f"SELECT transact_time, agg_trade_id, price, quantity, is_buyer_maker FROM agg_trade "
                           f"AS OF '{commit}' WHERE symbol = %s AND transact_time >= %s AND transact_time < %s "
                           "ORDER BY transact_time, agg_trade_id", (symbol, low_ms, stop), size=chunk)


# Open interest and long/short ratios (market/metrics.py): a row stamped create_time describes create_time + 5 min
# (its open interest equals public REST's then) and reaches a strategy 5 minutes later, past REST's publication
# (at most 189 s after its stamp, measured 2026-10-31; docs/plans/binance-open-interest-input.zh.md). Both are
# whole minutes, so a row arrives on a minute boundary: an order it prompts in the bar environment fills at the
# close of the bar that ends there, not at a price older than the decision.
METRICS_RULE = "binance-metrics-visible-v1"
METRICS_DESCRIBES_MS = 5 * MINUTE  # ts_event = create_time + 5 min
METRICS_VISIBLE_MS = 10 * MINUTE  # ts_init = create_time + 10 min
METRICS_VALUES = ("sum_open_interest", "count_toptrader_long_short_ratio", "sum_toptrader_long_short_ratio",
                  "count_long_short_ratio")


def metrics_rows(conn, commit: str, symbol: str, low_ms: int, high_ms: int | None, end_ms: int) -> list[tuple]:
    """The stored metrics rows of [low_ms, min(high_ms, end_ms)) at `commit`: the instant each describes
    (create_time + 5 min) at or after low_ms and its visibility (create_time + 10 min) before the end, so a
    strategy is never handed a row stamped before its input starts. Each as (create_time, sum_open_interest,
    three ratios or None), in time order."""
    stop = end_ms if high_ms is None else min(end_ms, high_ms)
    # Commits before the metrics table export none; the runner refuses the months (METRICS_MISSING).
    if not conn.rows(f"SHOW TABLES AS OF '{commit}' LIKE 'metrics'"):
        return []
    return conn.rows(f"SELECT create_time, {', '.join(METRICS_VALUES)} FROM metrics AS OF '{commit}' WHERE symbol = %s "
                     "AND create_time >= %s AND create_time < %s ORDER BY create_time",
                     (symbol, low_ms - METRICS_DESCRIBES_MS, stop - METRICS_VISIBLE_MS))


def write_metrics(root: Path, instrument_id: str, rows: list[tuple]) -> int:
    """market.write_metrics: one file of the rows under data/metrics/<instrument>/ (named by its first and last
    ts_init), ts_event and ts_init in nanoseconds by the visibility rule and the values as exact decimals (a ratio
    the archive left empty stays null); the runner streams each row as custom data."""
    if not rows:
        return 0
    stamps = np.array([row[0] for row in rows], dtype=np.int64)
    columns = {"ts_event": pa.array((stamps + METRICS_DESCRIBES_MS) * 1_000_000, pa.int64()),
               "ts_init": pa.array((stamps + METRICS_VISIBLE_MS) * 1_000_000, pa.int64())}
    for index, name in enumerate(METRICS_VALUES, start=1):
        columns[name] = pa.array([row[index] for row in rows], pa.decimal128(38, 16))
    table = pa.table(columns).replace_schema_metadata({"type_name": "Metrics", "instrument_id": instrument_id,
                                                       "rule": METRICS_RULE})
    directory = Path(root) / "data" / "metrics" / instrument_id
    directory.mkdir(parents=True, exist_ok=True)
    first, last = int(columns["ts_init"][0].as_py()), int(columns["ts_init"][-1].as_py())
    pq.write_table(table, directory / lifecycle.file_name(first, last), compression="snappy")
    return len(rows)


# The daily warm-up, derived while streaming

DAILY_CHUNK = 20_000  # rows per streamed chunk: about two weeks of minutes


def daily_bars(conn, commit: str, symbol: str, low_ms: int, high_ms: int | None, end_ms: int,
               chunk: int = DAILY_CHUNK) -> dict[str, np.ndarray]:
    """The complete UTC daily LAST bars before `end_ms` derived from the stored minutes that open at or after
    `low_ms` and close before `high_ms`, streamed in chunks: a chunk's last (possibly unfinished) day
    carries into the next, so memory holds one chunk and the days, never the whole history."""
    stop = end_ms if high_ms is None else min(end_ms, high_ms)
    parts, carry = [], np.empty((0, 6), np.int64)
    for rows in conn.stream(f"SELECT ts_open, open, high, low, close, volume FROM bar AS OF '{commit}' WHERE "
                            "symbol = %s AND price_type = 'LAST' AND ts_open >= %s AND ts_open < %s ORDER BY ts_open",
                            (symbol, low_ms, stop), size=chunk):
        block = np.array(rows, dtype=np.int64)
        if high_ms is not None:
            block = block[block[:, 0] + MINUTE - 1 < high_ms]
        block = np.concatenate([carry, block]) if len(carry) else block
        if not len(block):
            continue
        days = block[:, 0] // DAY
        cut = int(np.searchsorted(days, days[-1]))
        if cut:
            parts.append(series.derive_bars({name: block[:cut, i] for i, name in enumerate(COLUMNS)}, "1d"))
        carry = block[cut:]
    if len(carry):
        parts.append(series.derive_bars({name: carry[:, i] for i, name in enumerate(COLUMNS)}, "1d"))
    daily = {name: np.concatenate([part[name] for part in parts]) if parts else np.empty(0, np.int64)
             for name in COLUMNS}
    return _keep(daily, daily["ts_open"] + DAY <= end_ms)


# market.export_episode

def export_episode(job: dict) -> dict:
    """market.export_episode: one contract's Catalogs for the window under `job['path']`; returns its receipt."""
    from nautilus_trader.model import InstrumentId
    from nautilus_trader.persistence import ParquetDataCatalog
    symbol, commit, start_ns, end_ns = job["symbol"], job["commit"], job["start_ns"], job["end_ns"]
    start, end = start_ns // 1_000_000, end_ns // 1_000_000
    price_scale, volume_scale = job["scales"]
    path = Path(job["path"])
    shutil.rmtree(path, ignore_errors=True)
    path.mkdir(parents=True)
    with store.connect(job["profile"], "reader") as conn:
        terms = instrument.terms(conn, commit, symbol)
        raw: dict[str, Any]
        raw = {"last": coverage.read_bars(conn, commit, symbol, "LAST", start, end),
               "mark": coverage.read_bars(conn, commit, symbol, "MARK", start, end),
               "daily_source": {name: np.empty(0, np.int64) for name in COLUMNS},  # streamed per piece below
               "funding": coverage.read_funding(conn, commit, symbol, start, end)}
        facts = coverage.coverage_facts(conn, commit, symbol, start, end, raw["last"], raw["mark"], raw["funding"])
        split = split_episodes(symbol, job.get("episodes"), raw, start_ns, end_ns)
        # Every complete UTC day before the window's end, inside the piece: a contract listed late starts
        # once its warm-up holds.
        dailies = [daily_bars(conn, commit, symbol, -(-piece["low_ns"] // 1_000_000) if piece["index"] else 0,
                              piece["high_ns"] // 1_000_000 if piece["high_ns"] is not None and piece["index"]
                              else None, end) for piece in split]
    exchange = instrument.decimals(terms["price_increment"])
    size_increment = instrument.decimals(terms["size_increment"])
    pieces, record = [], None
    for piece, daily in zip(split, dailies, strict=True):
        last, mark = piece["last"], piece["mark"]
        precision = max([exchange] + [needed_decimals(bars[name], price_scale) for bars in (last, daily)
                                      for name in ("open", "high", "low", "close")])
        # Only the window's minutes are matched: warm-up days reach back past older ticks
        made, record = instrument.build_instrument(
            symbol, terms, precision, piece["instrument_id"],
            on_grid=all(on_grid(last[name], terms["price_increment"], price_scale)
                        for name in ("open", "high", "low", "close")))
        if piece["episode"] is not None:
            lifecycle.require_native_price(piece["episode"], made, start_ns, end_ns)
        root = path / piece["catalog_dir"] if piece["catalog_dir"] else path
        root.mkdir(parents=True, exist_ok=True)
        catalog = ParquetDataCatalog(str(root))
        catalog.write_instruments([made])
        iid = InstrumentId.from_str(piece["instrument_id"])
        mark_precision = max(precision, needed_decimals(mark["close"], price_scale))
        quote_size = terms.get("max_quantity")  # None for inferred terms: no quotes can be exported
        with store.connect(job["profile"], "reader") as conn:
            quotes = write_quotes(catalog, iid, quote_rows(conn, commit, symbol, max(start, -(-piece["low_ns"] // 1_000_000)),
                                                            piece["high_ns"] // 1_000_000 if piece["high_ns"] is not None
                                                            else None, end),
                                  precision, quote_size, size_increment, price_scale) \
                if job.get("include_quotes", True) and quote_size is not None else 0
            trades = write_trades(catalog, iid, trade_rows(conn, commit, symbol, max(start, -(-piece["low_ns"] // 1_000_000)),
                                                           piece["high_ns"] // 1_000_000 if piece["high_ns"] is not None
                                                           else None, end),
                                  precision, size_increment) if job.get("include_trades") else None
            metrics = write_metrics(root, str(iid), metrics_rows(
                conn, commit, symbol, max(start, -(-piece["low_ns"] // 1_000_000)),
                piece["high_ns"] // 1_000_000 if piece["high_ns"] is not None else None, end)) \
                if job.get("include_metrics") else None
        counts = {"last": write_bars(catalog, f"{iid}-1-MINUTE-LAST-EXTERNAL", last, MINUTE, precision,
                                     max(size_increment, needed_decimals(last["volume"], volume_scale)),
                                     price_scale, volume_scale),
                  "mark": write_marks(catalog, iid, mark, MINUTE, mark_precision, price_scale),
                  "quote": quotes,
                  "funding": write_funding(root, str(iid), piece["funding"]),
                  "daily": write_bars(catalog, f"{iid}-1-DAY-LAST-EXTERNAL", daily, DAY, precision,
                                      max(size_increment, needed_decimals(daily["volume"], volume_scale)),
                                      price_scale, volume_scale),
                  "instrument_close": 0, "instrument_status": 0}
        if trades is not None:  # only on request, so an export without trades keeps its receipt bytes
            counts["trade"] = trades
        if metrics is not None:  # likewise
            counts["metrics"] = metrics
        if piece["episode"] is not None:
            counts.update(lifecycle.write_lifecycle_events(catalog, piece["episode"], start_ns, end_ns))
        low = max(start, -(-piece["low_ns"] // 1_000_000 // MINUTE) * MINUTE)
        high = min(end, piece["high_ns"] // 1_000_000 // MINUTE * MINUTE) if piece["high_ns"] is not None else end
        held = series.missing_intervals(last["ts_open"], low, high, MINUTE) if low < high else {"missing_count": 0}
        opens = last["ts_open"]
        pieces.append({"index": piece["index"], "instrument_id": piece["instrument_id"],
                       "catalog_dir": piece["catalog_dir"], "counts": counts,
                       "first_bar_ns": int((opens[0] + MINUTE - 1) * 1_000_000) if len(opens) else None,
                       "last_bar_ns": int((opens[-1] + MINUTE - 1) * 1_000_000) if len(opens) else None,
                       "missing_minutes": held["missing_count"],
                       "last_mark_unmatched": int(len(np.setxor1d(opens, mark["ts_open"]))),
                       "price_precision": precision, "price_precision_widened": record["price_precision_widened"],
                       "mark_precision": mark_precision, "quote_size": quote_size if quotes else None,
                       "episode": piece["episode"]})
    assert record is not None  # split_episodes returns at least one piece
    receipt = {"format": FORMAT, "symbol": symbol, "commit": commit, "timeframe": TIMEFRAME, "start_ns": start_ns,
               "end_ns": end_ns, "coverage": facts, "terms_source": record["terms_source"],
               "terms_observed_at": record["terms_observed_at"], "historical_terms": record["historical_terms"],
               "assumed": record["assumed"], "pieces": pieces}
    if job.get("include_metrics"):
        receipt["metrics_rule"] = METRICS_RULE
    (path / "export.json").write_text(json.dumps(receipt, indent=1, ensure_ascii=False), encoding="utf-8")
    return receipt


def complete(path: Path) -> dict | None:
    """The receipt of a complete cached export, or None."""
    try:
        found = json.loads((path / "export.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return found if isinstance(found, dict) and found.get("format") == FORMAT and found.get("pieces") else None


def default_cache() -> Path:
    return Path(tempfile.gettempdir()) / "trade-market-catalog"


ROOT = Path(__file__).resolve().parents[1]
# The exporter's implementation: the market modules an export runs and the dependency lock.
EXPORTER_FILES = ("market/coverage.py", "market/export.py", "market/instrument.py", "market/lifecycle.py",
                  "market/series.py", "market/sources.py", "market/store.py", "market/universe.py", "uv.lock")


def exporter_sha256() -> str:
    """The total hash of the exporter files, each file's SHA-256 sorted by path; part of the cache key."""
    digests = {path: hashlib.sha256((ROOT / path).read_bytes()).hexdigest() for path in EXPORTER_FILES}
    return hashlib.sha256(json.dumps(dict(sorted(digests.items())), sort_keys=True, separators=(",", ":"))
                          .encode()).hexdigest()


# market.export_catalogs

def export_catalogs(profile: dict, at: str | None, symbols: list[str], start_ns: int, end_ns: int,
                    episodes: dict[str, list[dict]] | None = None, lifecycle_files: dict[str, bytes] | None = None,
                    fresh: bool = False, root: Path | None = None, workers: int = 4, *,
                    include_quotes: bool = True, include_trades: bool = False, include_metrics: bool = False) -> dict:
    """market.export_catalogs: each contract's Catalogs and receipt at one commit for [start_ns, end_ns),
    from the cache unless `fresh`; the lifecycle evidence files are copied under lifecycle-evidence/.
    `include_quotes=False` omits unused quote conversion for bars execution; `include_trades` adds every stored
    aggregate trade as a TradeTick and its count, `include_metrics` every visible metrics row and its count (the
    receipt names the visibility rule); all other inputs are unchanged.
    """
    step = MINUTE * 1_000_000
    if type(start_ns) is not int or type(end_ns) is not int or start_ns >= end_ns or start_ns % step or end_ns % step:
        raise _refuse(f"export window [{start_ns}, {end_ns}) is not a positive one-minute interval", "EXPORT_WINDOW",
                      missing=("start", "end"))
    if not symbols or len(set(symbols)) != len(symbols):
        raise _refuse("export needs each contract once", "EXPORT_SCOPE", missing=("symbols",))
    with store.connect(profile, "reader") as conn:
        try:
            commit = store.resolve_commit(conn, at)
        except store.MarketError as exc:
            raise _refuse(f"market reference {at!r} does not resolve ({exc.code})", "MARKET_COMMIT",
                          missing=(str(at),)) from exc
        (price_scale, volume_scale), = conn.rows(f"SELECT price_scale, volume_scale FROM market_schema AS OF '{commit}'")
    if fresh:
        if root is not None:
            Path(root).mkdir(parents=True, exist_ok=True)
        window = Path(tempfile.mkdtemp(prefix="market-export-", dir=root))
    else:
        key = (f"{start_ns}-{end_ns}-q{int(include_quotes)}{'-t1' if include_trades else ''}"
               f"{'-m1' if include_metrics else ''}-x{exporter_sha256()[:16]}")
        if lifecycle_files:
            key += "-l" + hashlib.sha256(json.dumps({name: hashlib.sha256(data).hexdigest() for name, data in
                                                     sorted(lifecycle_files.items())}).encode()).hexdigest()[:16]
        window = Path(root or default_cache()) / commit / key
    receipts, jobs = {}, []
    for symbol in symbols:
        found = None if fresh else complete(window / symbol)
        if found:
            receipts[symbol] = found
        else:
            jobs.append({"profile": profile, "commit": commit, "symbol": symbol, "start_ns": start_ns,
                         "end_ns": end_ns, "path": str(window / symbol), "scales": (price_scale, volume_scale),
                         "episodes": (episodes or {}).get(symbol), "include_quotes": include_quotes,
                         "include_trades": include_trades, "include_metrics": include_metrics})
    try:
        if jobs:
            with ProcessPoolExecutor(max(1, min(workers, len(jobs)))) as pool:
                for receipt in pool.map(export_episode, jobs):
                    receipts[receipt["symbol"]] = receipt
        for name, data in sorted((lifecycle_files or {}).items()):
            target = window / "lifecycle-evidence" / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
    except BaseException:
        if fresh:  # a failed export leaves no partial directory (a cached one keeps no receipt for the failure)
            shutil.rmtree(window, ignore_errors=True)
        raise
    return {"commit": commit, "root": str(window), "exported": len(jobs), "cached": len(symbols) - len(jobs),
            "receipts": {symbol: receipts[symbol] for symbol in symbols}}
