"""Imports into the market directory (`market.import_month`, `market.import_quotes`) and what a market commit
holds (`market.freshness`).

One bar import is one UTC month and one market version: every eligible contract's stitched one-minute LAST
and MARK bars and funding, terms that changed, and the month's common tradable range, one file per table
with new rows, committed after data_tests pass (market.versions). Any refusal comes before the version
replaces head; the files already written are listed by no version. The first import on an empty market
writes its first version.

An engineering symbol allowlist narrows an import of an isolated market to those contracts; the scope is
written in every import's receipt and read back by `freshness`.
"""

from __future__ import annotations

from concurrent.futures import ProcessPoolExecutor, as_completed
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal, InvalidOperation
import hashlib
import json
from pathlib import Path
import re
import shutil
import tempfile
import time
from typing import Any

import numpy as np
import pyarrow as pa
import pyarrow.compute as pc

from market import instrument, quotes, series, sources, universe, versions
from market.sources import MINUTE, MarketError, _refuse


PRICE_SCALE = series.PRICE_SCALE
VOLUME_SCALE = series.VOLUME_SCALE
DAY = 86_400_000
COMMIT_HASH = re.compile(r"[0-9a-v]{32}\Z")
# The kinds of the market directory's import receipts.
BARS = "binance-bars"
QUOTES = "binance-quotes"  # quote imports: their receipts carry quotes.RULE
TRADES = "binance-aggtrades"  # complete aggTrades imports (market.aggtrades): their receipts carry the codec
METRICS = "binance-metrics"  # open interest and long/short ratio imports (market.metrics)


def check_commit(commit) -> str:
    if not isinstance(commit, str) or not COMMIT_HASH.fullmatch(commit):
        raise _refuse(f"{commit!r} is not a resolved market commit hash", "MARKET_COMMIT_INVALID",
                      missing=(str(commit),))
    return commit


def default_cache() -> Path:
    return Path(tempfile.gettempdir()) / "trade-market-cache"


# Exact scaling

FLOAT_TAIL_ULPS = 4  # a float rendering lies within a few units in the last place of its double

def _wide(column) -> pa.Array:
    column = column.combine_chunks() if isinstance(column, pa.ChunkedArray) else column
    return pc.cast(column, pa.decimal128(38, 18))


def _int64(decimal: pa.Array, label: str) -> np.ndarray:
    words = np.frombuffer(decimal.buffers()[1], dtype=np.int64)[
        decimal.offset * 2:(decimal.offset + len(decimal)) * 2].reshape(-1, 2)
    if not np.all(words[:, 1] == words[:, 0] >> 63):
        raise _refuse(f"{label}: a scaled value exceeds BIGINT", "SCALE_RANGE")
    return words[:, 0].copy()


def scaled(column, scale: int, label: str, *, float_tails: bool = False) -> tuple[np.ndarray, int]:
    """Decimal strings as integers at `scale`, exactly.

    With `float_tails`, a value whose extra digits are a binary-float rendering of a value at
    `scale` (Binance archives hold a few, such as 108824285.69999999) is rounded to it: as doubles
    the two differ by at most FLOAT_TAIL_ULPS units in the last place. The count of such values is
    returned. Any other value with more decimals is refused, a real extra decimal of a large value
    included.
    """
    wide = _wide(column)
    try:
        return _int64(pc.cast(wide, pa.decimal128(38, scale), safe=True), label), 0
    except pa.ArrowInvalid:
        if not float_tails:
            raise _refuse(f"{label}: a value has more than {scale} decimals", "SCALE_LOSS") from None
    rounded = pc.cast(pc.round(wide, ndigits=scale, round_mode="half_to_even"), pa.decimal128(38, scale))
    exact = pc.cast(rounded, pa.decimal128(38, 18))
    changed = pc.not_equal(exact, wide)
    given = pc.cast(wide, pa.float64()).to_numpy(zero_copy_only=False)
    near = pc.cast(exact, pa.float64()).to_numpy(zero_copy_only=False)
    if np.any(np.abs(given - near) > FLOAT_TAIL_ULPS * np.spacing(np.abs(near))):
        raise _refuse(f"{label}: a value has more than {scale} decimals", "SCALE_LOSS")
    return _int64(rounded, label), int(pc.sum(changed).as_py() or 0)


def significant_decimals(column) -> int:
    """The most decimals any value needs, ignoring trailing zeros."""
    column = column.combine_chunks() if isinstance(column, pa.ChunkedArray) else column
    if not len(column):
        return 0
    fraction = pc.extract_regex(column, r"^[^.]*(?:\.(?P<d>\d*))?$").field("d")
    return int(pc.max(pc.utf8_length(pc.utf8_rtrim(pc.fill_null(fraction, ""), "0"))).as_py() or 0)


def bar_rows(table: pa.Table, symbol: str, price_type: str) -> tuple[dict[str, np.ndarray], int]:
    """A stitched minute table as integer bar columns {ts_open, open, high, low, close, volume} and the
    count of float-tail volumes rounded."""
    label = f"{symbol} {price_type}"
    prices = {name: scaled(table[name], PRICE_SCALE, f"{label} {name}")[0] for name in ("open", "high", "low", "close")}
    volume, rounded = scaled(table["volume"], VOLUME_SCALE, f"{label} volume", float_tails=True)
    if price_type == "MARK" and volume.any():
        at = table["open_time"][int(np.argmax(volume != 0))]
        raise _refuse(f"{label}: a mark-price kline at {at} carries a volume", "SOURCE_SHAPE", missing=(label,))
    o, h, lo, c = (prices[name] for name in ("open", "high", "low", "close"))
    bad = (lo > np.minimum(o, c)) | (h < np.maximum(o, c)) | (lo <= 0) | (volume < 0)
    if bad.any():
        raise _refuse(f"{label}: inconsistent bar at open_time {table['open_time'][int(np.argmax(bad))]}",
                      "SOURCE_SHAPE", missing=(label,))
    return {"ts_open": table["open_time"].to_numpy().astype(np.int64), **prices, "volume": volume}, rounded


# Terms

def inferred_terms(last: pa.Table) -> dict:
    """Increments of a contract absent from exchangeInfo: the most decimals its trades used."""
    price = max(significant_decimals(last[name]) for name in ("open", "high", "low", "close"))
    volume = last["volume"].combine_chunks()
    size = significant_decimals(pc.filter(volume, pc.less(pc.utf8_length(volume), 17)))
    return {"terms_source": "inferred", "price_increment": format(Decimal(1).scaleb(-price), "f"),
            "size_increment": format(Decimal(1).scaleb(-size), "f"),
            **{name: None for name in instrument.TERMS[2:]}, "classification": None}


def listed_terms(item: dict) -> dict:
    return {"terms_source": "exchange_info", **{name: item[name] for name in instrument.TERMS},
            "classification": {"contract_type": item["contract_type"], "quote_asset": item["quote_asset"],
                               "underlying_type": item["underlying_type"],
                               "underlying_sub_types": item["underlying_sub_types"]}}


def _same_terms(stored: dict | None, terms: dict) -> bool:
    if stored is None:
        return False
    stored_class = stored.get("classification")
    if isinstance(stored_class, str):
        stored_class = json.loads(stored_class)
    return (stored["terms_source"] == terms["terms_source"] and stored_class == terms["classification"]
            and all(str(stored[name]) == str(terms[name]) if terms[name] is not None else stored[name] is None
                    for name in instrument.TERMS))


def _item_of(symbol: str, row: dict | None) -> dict | None:
    """The classification input of a stored terms row: None for inferred terms (no exchange metadata)."""
    if row is None or row.get("classification") is None:
        return None
    found = row["classification"] if isinstance(row["classification"], dict) else json.loads(row["classification"])
    quote = found.get("quote_asset") or ""
    return {"symbol": symbol, "contract_type": found.get("contract_type"), "underlying_type": found.get("underlying_type"),
            "base_asset": symbol[:-len(quote)] if quote and symbol.endswith(quote) else symbol}


# One contract, prepared in a worker process

def prepare(job: dict) -> dict:
    """Stitch, check and scale one contract's month of bars and funding. The bars the month's earlier imports
    declared are compared with the stored ones (MONTH_EXISTS when they differ); the new ones go to an Arrow
    file under `work` for the month's one bar file."""
    try:
        return _prepare(job)
    except MarketError as exc:
        raise MarketError(f"{job['symbol']}: {exc.message}", code=exc.code,
                          missing=(job["symbol"], *exc.missing)) from exc


def _prepare(job: dict) -> dict:
    sources.REST_INTERVAL, sources.FUNDING_INTERVAL = job["rest_interval"]
    started = time.monotonic()
    symbol, cache, end, trading = job["symbol"], Path(job["cache"]), job["end"], job["trading"]
    held = job["held"] if job["held"] is not None else job["start"]  # stored before this: compared, never written
    report = {"symbol": symbol, "rows": {}, "gaps": {}, "source_rows": {}, "rounded_volumes": 0, "terms": None,
              "derived_findings": None, "bars": None}
    new_batches, last = [], None
    for price_type in ("LAST", "MARK"):
        table, gaps, used = series.stitch_series(cache, symbol, price_type, job["start"], end,
                                                 job["resumed"][price_type], trading)
        report["gaps"][price_type], report["source_rows"][price_type] = gaps, used
        if price_type == "LAST":
            last = table
        bars, rounded = bar_rows(table, symbol, price_type) if table.num_rows else (_empty_bars(), 0)
        report["rounded_volumes"] += rounded
        if price_type == "LAST" and table.num_rows:
            report["derived_findings"] = _derived_findings(symbol, bars, job, trading)
        old = bars["ts_open"] < held
        if job["held"] is not None:
            _compare_bars(job, price_type, {name: values[old] for name, values in bars.items()})
        new = {name: values[~old] for name, values in bars.items()}
        report["rows"][price_type] = int(len(new["ts_open"]))
        if len(new["ts_open"]):
            new_batches.append(bar_batch(symbol, price_type, new))
    if job["terms"] is None and last is not None and last.num_rows:
        report["terms"] = inferred_terms(last)
    if new_batches:
        path = Path(job["work"]) / f"{symbol.encode().hex()}.arrow"
        with pa.OSFile(str(path), "wb") as sink, pa.ipc.new_file(sink, versions.BAR.schema) as writer:
            for batch in new_batches:
                writer.write_batch(batch)
        report["bars"] = str(path)
    found = funding(cache, symbol, job["start"], end, trading=trading)
    report["funding_reread"] = [row for row in found if row[0] < held]
    report["funding"] = [row for row in found if row[0] >= held]
    report["seconds"] = round(time.monotonic() - started, 1)
    return report


def _empty_bars() -> dict[str, np.ndarray]:
    return {name: np.empty(0, np.int64) for name in series.COLUMNS}


def bar_batch(symbol: str, price_type: str, bars: dict[str, np.ndarray]) -> pa.RecordBatch:
    """Integer bar columns of one contract and price type as rows of the bar table."""
    count = len(bars["ts_open"])
    return pa.RecordBatch.from_arrays(
        [pa.array([symbol] * count, pa.string()), pa.array([price_type] * count, pa.string()),
         *(pa.array(bars[name], pa.int64()) for name in series.COLUMNS)], schema=versions.BAR.schema)


def _bar_bytes(bars: dict[str, np.ndarray]) -> bytes:
    """Bars as the bytes their digest is taken of: row by row, series.COLUMNS as little-endian int64, so the
    digest does not depend on how the rows were batched."""
    return np.column_stack([np.asarray(bars[name], dtype="<i8") for name in series.COLUMNS]).tobytes()


def _compare_bars(job: dict, price_type: str, reread: dict[str, np.ndarray]) -> None:
    """The reread minutes the month's earlier imports declared must be the stored ones (MONTH_EXISTS
    otherwise): nothing an earlier source wrote stays unchecked, and nothing is added inside a declared
    interval. Compared by digest; on a difference the stored rows are read to name the minutes."""
    rows, digest = job["stored"][price_type]
    if (len(reread["ts_open"]), hashlib.sha256(_bar_bytes(reread)).hexdigest()) == (rows, digest):
        return
    market = versions.open_market({"root": job["root"]}, "reader")
    found = [batch.filter(pc.equal(batch.column("price_type"), price_type)) for batch in versions.read_table(
        market, job["commit"], "bar", [job["symbol"]], job["start"], job["held"])]
    stored = {name: np.concatenate([batch.column(name).to_numpy() for batch in found] or [np.empty(0, np.int64)])
              for name in series.COLUMNS}
    times = sorted(set(stored["ts_open"].tolist()) ^ set(reread["ts_open"].tolist()))
    if not times:
        differs = np.nonzero(np.any([stored[name] != reread[name] for name in series.COLUMNS], axis=0))[0]
        times = stored["ts_open"][differs].tolist()
    label = series._ms_day(job["start"]).strftime("%Y-%m")
    raise _refuse(f"{price_type}: the sources now differ from the stored {label} rows at {times[:5]}", "MONTH_EXISTS",
                  missing=(label, *map(str, times[:5])))


def _derived_findings(symbol: str, bars: dict, job: dict, trading: bool) -> list[dict] | None:
    """market.check_derived of the month's derived daily LAST bars against the exchange's native daily
    klines over the whole days held; None when the exchange no longer serves the contract."""
    first = -(-int(bars["ts_open"][0]) // DAY) * DAY
    last = (int(bars["ts_open"][-1]) + MINUTE) // DAY * DAY
    if first >= last:
        return []
    keep = (bars["ts_open"] >= first) & (bars["ts_open"] < last)
    derived = series.derive_bars({name: values[keep] for name, values in bars.items()}, "1d")
    try:
        rows = sources.rest_klines("LAST", symbol, "1d", first, last)
    except MarketError as exc:
        if exc.code == "SOURCE_UNKNOWN_SYMBOL" and not trading:
            return None
        raise
    native = bar_rows(sources.rows_table([(*row[:6], row[0] + MINUTE - 1) for row in rows]), symbol, "LAST")[0] \
        if rows else _empty_bars()
    terms = job["terms"] or {}
    price = instrument.decimals(terms["price_increment"]) if terms.get("price_increment") else PRICE_SCALE
    size = instrument.decimals(terms["size_increment"]) if terms.get("size_increment") else VOLUME_SCALE
    return series.check_derived(derived, native, "1d", price, size, price_scale=PRICE_SCALE,
                                volume_scale=VOLUME_SCALE)


HOUR = 3_600_000


def funding_slot(time_ms: int) -> int:
    """The settlement a funding time belongs to: its nearest whole UTC hour. Binance settles at most once
    an hour (intervals of 1, 4 or 8 hours) and its times carry milliseconds of jitter, so two sources'
    times in one slot are one settlement; their rates must agree."""
    return (time_ms + HOUR // 2) // HOUR


def funding(cache: Path, symbol: str, start: int, end: int, *, trading: bool) -> list[tuple[int, str]]:
    """Settlements in [start, end): monthly archives, then public REST for months without one (there
    are no daily funding archives). One settlement per funding slot: a slot held by two sources with
    different rates refuses SOURCE_CONFLICT (the earlier source's time is kept); one source holding two
    settlements in a slot refuses SOURCE_SHAPE."""
    if start >= end:
        return []
    months = series._months(start, end)
    monthly = sources.monthly_archives(cache, "fundingRate", symbol, None, months)
    slots: dict[int, tuple[int, str]] = {}

    def add(found, label: str) -> None:
        seen = set()
        for time_ms, rate in found:
            slot = funding_slot(time_ms)
            if slot in seen:
                raise _refuse(f"{symbol} funding: {label} holds two settlements in the hour of {time_ms}",
                              "SOURCE_SHAPE", missing=(str(time_ms),))
            seen.add(slot)
            if slot in slots and Decimal(slots[slot][1]) != Decimal(rate):
                raise _refuse(f"{symbol} funding: sources disagree on the settlement at {time_ms}", "SOURCE_CONFLICT",
                              missing=(str(time_ms),))
            slots.setdefault(slot, (time_ms, rate))

    for month in sorted(monthly):
        add(sources.funding_rows(monthly[month]), f"the {month} archive")
    missing = [month for month in months if month not in monthly]
    if missing:
        low = max(start, series._day_ms(date.fromisoformat(missing[0] + "-01")))
        try:
            add(sources.rest_funding(symbol, low, end), "public REST")
        except MarketError as exc:
            if exc.code != "SOURCE_UNKNOWN_SYMBOL" or trading:
                raise
    return sorted(row for row in slots.values() if start <= row[0] < end)


# The import (market.import_month)

def _month_ms(month: date) -> int:
    return series._day_ms(month)


def _scope(symbols) -> list[str] | None:
    if symbols is None:
        return None
    if (not isinstance(symbols, (list, tuple)) or not symbols or len(set(symbols)) != len(symbols)
            or any(not isinstance(item, str) or not sources.SYMBOL.fullmatch(item) for item in symbols)):
        raise _refuse("the engineering symbol allowlist is empty, repeats a contract or names a malformed one",
                      "IMPORT_SCOPE", missing=("--symbols",))
    return sorted(symbols)


def month_bounds(month: date) -> tuple[int, int]:
    """[start, end) of an import of `month`: the month through the last closed UTC day (MONTH_INVALID for
    a malformed or future month)."""
    if not isinstance(month, date) or isinstance(month, datetime) or month.day != 1:
        raise _refuse(f"{month!r} is not the first day of a month", "MONTH_INVALID", missing=(str(month),))
    start = _month_ms(month)
    end = min(_month_ms(universe.next_month(month)), series._day_ms(datetime.now(UTC).date()))
    if start > end:
        raise _refuse(f"{month:%Y-%m} has not begun", "MONTH_INVALID", missing=(f"{month:%Y-%m}",))
    return start, end


def import_month(profile: dict, month: date, cache_root: Path, workers: int = 4, symbols: list[str] | None = None,
                 log=print) -> dict:
    """market.import_month: append one UTC month (the current month through the last closed day) as one
    market version, after the latest stored month or, as a backfill, just before the earliest. On its first
    day the current month has no closed day and imports its members only: they depend on the days before it
    alone. `symbols` is the engineering allowlist of an isolated market."""
    started = time.monotonic()
    scope = _scope(symbols)
    start_ms, end_ms = month_bounds(month)
    market = versions.open_market(profile, "import")
    work = Path(tempfile.mkdtemp(prefix="market-load-"))
    try:
        with versions.lock(market):
            return _import(market, month, start_ms, end_ms, Path(cache_root), workers, scope, work, log, started)
    finally:
        shutil.rmtree(work, ignore_errors=True)


def head_version(market: versions.Market) -> dict:
    """The head's version file, or an empty one with the code's market_schema on an empty market."""
    return market.version or {"market_schema": market.market_schema, "parent": None, "files": [], "receipts": []}


def _import(market: versions.Market, month: date, start_ms: int, end_ms: int, cache: Path, workers: int,
            scope: list[str] | None, work: Path, log, started: float) -> dict:
    label = f"{month:%Y-%m}"
    version = head_version(market)
    facts = version["market_schema"]
    if facts["universe_rule"] != universe.RULE:
        raise _refuse(f"the market produces {facts['universe_rule']}, this code {universe.RULE}",
                      "RULE_VERSION_MISMATCH", missing=(str(facts["universe_rule"]),))
    if (facts["price_scale"], facts["volume_scale"]) != (PRICE_SCALE, VOLUME_SCALE):
        raise _refuse("the market stores other integer scales", "SCHEMA_VERSION_MISMATCH")
    done = versions.receipts(market, market.head, BARS)
    if done and any(item["scope"] != (scope or "all") for item in done):
        raise _refuse(f"earlier imports cover scope {done[-1]['scope']}, this one {scope or 'all'}", "IMPORT_SCOPE",
                      missing=("--symbols",))
    if not done and start_ms == end_ms:
        raise _refuse(f"{label} has no closed UTC day yet, and the first import has no members to give",
                      "MONTH_INVALID", missing=(label,))
    through = {item["month"]: item["through"] for item in done}  # a month imported twice: its latest import
    if through.get(label) == universe.next_month(month).isoformat():
        raise _refuse(f"the market already holds {label} through its end", "MONTH_EXISTS", missing=(label,))
    held = sorted(through)
    earliest, latest = (date.fromisoformat(held[i] + "-01") for i in (0, -1)) if done else (month, month)
    # Months extend at either end: the latest month completed or the month after it, or the month just
    # before the earliest (a backfill: every stored version and its rows stay as they are).
    backfill = bool(done) and universe.next_month(month) == earliest
    if done and not backfill and (month not in (latest, universe.next_month(latest)) or (
            month == universe.next_month(latest) and through[held[-1]] != month.isoformat())):
        raise _refuse(f"the stored months run from {held[0]} to {held[-1]} through {through[held[-1]]}; import "
                      f"the month after {held[-1]} or the month before {held[0]}", "MONTH_INVALID",
                      missing=(held[0], held[-1]))
    first_month = month if backfill else earliest
    if backfill:
        _check_empty(market, version, month, start_ms, end_ms)
    # The month's earlier imports declared [start, held_ms) for every contract: the bar and funding files
    # of this one start there.
    held_ms = series._day_ms(date.fromisoformat(through[label])) if label in through else None

    observed, listed = sources.rest_exchange_info()
    by_symbol = {item["symbol"]: item for item in listed}
    candidates = scope if scope is not None else sorted(
        {item["symbol"] for item in listed} | set(sources.archive_symbols()))
    first_seen, stored_terms = _terms_rows(market, version)
    # A contract keeps the classification of its earliest stored observation (later rows are recorded and
    # never reclassify it); a contract never seen is classified by today's exchangeInfo.
    classified = {symbol: universe.classify_contract(
        symbol, _item_of(symbol, first_seen[symbol]) if symbol in first_seen else by_symbol.get(symbol), universe.RULE)
        for symbol in candidates}
    excluded = {symbol: item["reason"] for symbol, item in sorted(classified.items()) if not item["eligible"]}
    eligible = sorted(symbol for symbol, item in classified.items() if item["eligible"])
    log(f"{label}: {len(eligible)} eligible contracts, {len(excluded)} excluded")

    appended_terms = []
    for symbol in candidates:
        item = by_symbol.get(symbol)
        if item is not None and item["symbol"].endswith("USDT"):
            observed_terms = listed_terms(item)
            if not _same_terms(stored_terms.get(symbol), observed_terms):
                appended_terms.append((symbol, observed, observed_terms))

    jobs = []
    if start_ms < end_ms:  # a month on its first day: members only
        stored_bars = _stored_bars(market, version, start_ms, held_ms) if held_ms is not None else {}
        resumed = _present(market, version, start_ms - MINUTE, start_ms)
        empty = (0, hashlib.sha256().hexdigest())
        for symbol in eligible:
            item = by_symbol.get(symbol)
            terms = listed_terms(item) if item is not None else stored_terms.get(symbol)
            jobs.append({"symbol": symbol, "cache": str(cache), "work": str(work), "start": start_ms, "end": end_ms,
                         "held": held_ms, "root": str(market.root), "commit": market.head,
                         "stored": {kind: stored_bars.get((symbol, kind), empty) for kind in ("LAST", "MARK")},
                         "resumed": {kind: (symbol, kind) in resumed for kind in ("LAST", "MARK")},
                         "trading": item is not None and item["status"] == "TRADING",
                         "terms": {key: terms[key] for key in ("price_increment", "size_increment")} if terms else None,
                         "rest_interval": (sources.REST_INTERVAL * workers, sources.FUNDING_INTERVAL * workers)})
    stored_funding = _stored_funding(market, version, start_ms, held_ms) if held_ms is not None and jobs else {}

    totals: dict[str, Any] = {"bar_rows": 0, "funding_rows": 0, "rounded_volumes": 0, "gaps": {}, "inferred_terms": [],
                              "source_rows": {name: 0 for name in series.SOURCES}, "derived_findings": {},
                              "per_symbol": {}}
    written: dict[str, str] = {}
    settlements: list[tuple[str, int, str]] = []
    # One worker prepares in this process; more prepare in a process pool (speed only, same result).
    pool = ProcessPoolExecutor(min(workers, len(jobs))) if workers > 1 and len(jobs) > 1 else None
    try:
        reports = (future.result() for future in as_completed([pool.submit(prepare, job) for job in jobs])) \
            if pool is not None else (prepare(job) for job in jobs)
        for count, report in enumerate(reports, start=1):
            symbol = report["symbol"]
            _compare_funding(symbol, stored_funding.get(symbol, {}), report["funding_reread"], label)
            if report["bars"]:
                written[symbol] = report["bars"]
            settlements += [(symbol, at, rate) for at, rate in report["funding"]]
            if report["terms"]:
                appended_terms.append((symbol, observed, report["terms"]))
                totals["inferred_terms"].append(symbol)
            rows = sum(report["rows"].values())
            totals["bar_rows"] += rows
            totals["funding_rows"] += len(report["funding"])
            totals["rounded_volumes"] += report["rounded_volumes"]
            for used in report["source_rows"].values():
                for name, value in used.items():
                    totals["source_rows"][name] += value
            gaps = {key: value for key, value in report["gaps"].items() if value}
            if gaps:
                totals["gaps"][symbol] = gaps
            if report["derived_findings"]:
                totals["derived_findings"][symbol] = report["derived_findings"]
            totals["per_symbol"][symbol] = {"bars": report["rows"], "funding": len(report["funding"]),
                                            "source_rows": report["source_rows"]}
            log(f"[{count}/{len(jobs)}] {symbol}: {rows} bars, {len(report['funding'])} funding, prepared "
                f"{report['seconds']}s")
    finally:
        if pool is not None:
            pool.shutdown(wait=False, cancel_futures=True)

    # One file per table with new rows, holding every contract; bar and funding cover what the month's
    # earlier imports had not declared, through this import's last closed day.
    low = held_ms if held_ms is not None else start_ms
    entries = []
    if written:
        entries.append(versions.write_file(market, "bar", None, low, end_ms, _arrow_batches(
            [written[symbol] for symbol in sorted(written)])))
    if settlements:
        entries.append(versions.write_file(market, "funding", None, low, end_ms, [funding_batch(sorted(settlements))]))
    if appended_terms:
        appended_terms.sort(key=lambda row: row[0])
        entries.append(versions.write_file(market, "instrument", None, observed, observed + 1,
                                           [instrument_batch(appended_terms)]))
    # The month's members are computed on the version this import makes, its terms and bars included.
    child = {**version, "files": version["files"] + entries}
    members, new = _universe(market, child, month, first_month)
    if new:
        entries.append(_members_file(market, month, new))
    filled = _fill_universe(market, child, month, earliest, latest) if backfill else {}
    for at, found in filled.items():
        if found:
            entries.append(_members_file(market, at, found))
    result = {"month": label, "universe_rule": universe.RULE, "scope": scope or "all",
              "through": series._ms_day(end_ms).isoformat(), "instruments_appended": len(appended_terms),
              "bar_rows": totals["bar_rows"], "funding_rows": totals["funding_rows"], "universe_members": members,
              "gaps": dict(sorted(totals["gaps"].items())), "source_rows": totals["source_rows"], "excluded": excluded,
              "inferred_terms": sorted(totals["inferred_terms"]), "rounded_volumes": totals["rounded_volumes"],
              "derived_findings": dict(sorted(totals["derived_findings"].items())),
              "per_symbol": dict(sorted(totals["per_symbol"].items())),
              "universe_filled": {f"{key:%Y-%m}": value for key, value in filled.items()}}
    if not market.empty and not entries:  # the same month with nothing new: the latest bar version, no new one
        return {**result, "market_commit": _bar_version(market), "seconds": round(time.monotonic() - started)}
    receipt = {"import": BARS, "month": label, "through": series._ms_day(end_ms).isoformat(),
               "universe_rule": universe.RULE, "scope": scope or "all"}
    commit = versions.commit_version(market, entries, receipt)
    return {**result, "market_commit": commit, "seconds": round(time.monotonic() - started)}


def _bar_version(market: versions.Market) -> str | None:
    """The latest version a bar import wrote: back from head to the first version whose own receipt is BARS."""
    for commit in versions.chain(market):
        if versions.receipt(market, versions.load_version(market, commit)["receipts"][-1])["import"] == BARS:
            return commit
    return None


def _arrow_batches(paths: list[str]):
    """The batches of the workers' Arrow files, in the order given (contracts in key order)."""
    for path in paths:
        with pa.memory_map(path) as source:
            reader = pa.ipc.open_file(source)
            for index in range(reader.num_record_batches):
                yield reader.get_batch(index)


def funding_batch(rows: list[tuple[str, int, str]]) -> pa.RecordBatch:
    """(symbol, funding_time, rate) rows, in key order, as rows of the funding table."""
    kind = versions.FUNDING.schema.field("rate").type
    try:
        rates = pa.array([Decimal(rate) for _, _, rate in rows], kind)
    except (pa.ArrowInvalid, InvalidOperation) as exc:
        raise _refuse(f"a funding rate does not fit {kind} exactly: {exc}", "SCALE_LOSS", missing=("funding",)) from exc
    return pa.RecordBatch.from_arrays([pa.array([row[0] for row in rows], pa.string()),
                                       pa.array([row[1] for row in rows], pa.int64()), rates],
                                      schema=versions.FUNDING.schema)


def instrument_batch(rows: list[tuple[str, int, dict]]) -> pa.RecordBatch:
    """(symbol, observed_at, terms) rows, in key order, as rows of the instrument table."""
    columns = [[symbol for symbol, _, _ in rows], [at for _, at, _ in rows],
               [terms["terms_source"] for _, _, terms in rows]]
    columns += [[None if terms[name] is None else str(terms[name]) for _, _, terms in rows] for name in instrument.TERMS]
    columns.append([None if terms["classification"] is None else json.dumps(terms["classification"], sort_keys=True)
                    for _, _, terms in rows])
    schema = versions.INSTRUMENT.schema
    return pa.RecordBatch.from_arrays([pa.array(values, field.type) for values, field in zip(columns, schema, strict=True)],
                                      schema=schema)


def _members_file(market: versions.Market, month: date, members: list[str]) -> dict:
    schema = versions.UNIVERSE_MONTH.schema
    batch = pa.RecordBatch.from_arrays([pa.array([universe.RULE] * len(members), pa.string()),
                                        pa.array([month] * len(members), pa.date32()),
                                        pa.array(members, pa.string())], schema=schema)
    return versions.write_file(market, "universe_month", None, _month_ms(month),
                               _month_ms(universe.next_month(month)), [batch])


def _stored_bars(market: versions.Market, version: dict, low: int, high: int) -> dict[tuple[str, str], tuple[int, str]]:
    """{(symbol, price_type): (rows, SHA-256 of _bar_bytes)} of the stored bars in [low, high), read file by
    file: a month's files are disjoint in time and each is in key order, so each series is hashed in time
    order with one row group in memory."""
    found: dict[tuple[str, str], list] = {}
    for batch in versions.scan(market, version, "bar", None, low, high):
        if not batch.num_rows:
            continue
        keys = pc.binary_join_element_wise(batch.column("symbol"), batch.column("price_type"), "\0")
        names = keys.to_numpy(zero_copy_only=False)
        cuts = [0, *(np.flatnonzero(names[1:] != names[:-1]) + 1).tolist(), len(names)]
        columns = {name: batch.column(name).to_numpy() for name in series.COLUMNS}
        for a, b in zip(cuts, cuts[1:], strict=False):
            symbol, price_type = names[a].split("\0")
            entry = found.setdefault((symbol, price_type), [0, hashlib.sha256()])
            entry[0] += b - a
            entry[1].update(_bar_bytes({name: values[a:b] for name, values in columns.items()}))
    return {key: (rows, digest.hexdigest()) for key, (rows, digest) in found.items()}


def _present(market: versions.Market, version: dict, low: int, high: int) -> set[tuple[str, str]]:
    """The (symbol, price_type) series holding a stored bar in [low, high)."""
    found: set[tuple[str, str]] = set()
    for batch in versions.scan(market, version, "bar", None, low, high):
        found.update(zip(batch.column("symbol").to_pylist(), batch.column("price_type").to_pylist(), strict=True))
    return found


def _stored_funding(market: versions.Market, version: dict, low: int, high: int) -> dict[str, dict[int, Decimal]]:
    found: dict[str, dict[int, Decimal]] = {}
    for batch in versions.scan(market, version, "funding", None, low, high):
        for symbol, at, rate in zip(*(batch.column(name).to_pylist() for name in ("symbol", "funding_time", "rate")),
                                    strict=True):
            found.setdefault(symbol, {})[funding_slot(at)] = rate
    return found


def _compare_funding(symbol: str, stored: dict[int, Decimal], reread: list[tuple[int, str]], label: str) -> None:
    """The month's settlements the earlier imports declared, reread from the sources, must equal the stored
    ones (MONTH_EXISTS otherwise)."""
    rates = {funding_slot(at): Decimal(rate) for at, rate in reread}
    if stored != rates:
        slots = sorted(slot for slot in set(stored) | set(rates) if stored.get(slot) != rates.get(slot))
        raise _refuse(f"{symbol} funding: the sources now differ from the stored {label} settlements in hours "
                      f"{slots[:5]}", "MONTH_EXISTS", missing=(label, symbol))


def _terms_rows(market: versions.Market, version: dict) -> tuple[dict[str, dict], dict[str, dict]]:
    """Each contract's earliest stored terms row (the observation its universe classification comes from) and
    its latest."""
    earliest: dict[str, dict] = {}
    latest: dict[str, dict] = {}
    for batch in versions.scan(market, version, "instrument"):
        for row in batch.to_pylist():
            symbol = row["symbol"]
            if symbol not in earliest or row["observed_at"] < earliest[symbol]["observed_at"]:
                earliest[symbol] = row
            if symbol not in latest or row["observed_at"] > latest[symbol]["observed_at"]:
                latest[symbol] = row
    return earliest, latest


def trading_days(market: versions.Market, version: dict, symbols: list[str], low: date,
                 high: date) -> dict[str, set[date]]:
    """Each contract's UTC days in [low, high) with at least one traded one-minute LAST bar in `version`."""
    found: dict[str, set[date]] = {symbol: set() for symbol in symbols}
    if not symbols:
        return found
    for batch in versions.scan(market, version, "bar", symbols, series._day_ms(low), series._day_ms(high)):
        traded = batch.filter(pc.and_(pc.equal(batch.column("price_type"), "LAST"),
                                      pc.greater(batch.column("volume"), 0)))
        days = pa.table({"symbol": traded.column("symbol"),
                         "day": pc.divide(traded.column("ts_open"), DAY)}).group_by(["symbol", "day"]).aggregate([])
        for symbol, day in zip(days.column("symbol").to_pylist(), days.column("day").to_pylist(), strict=True):
            found[symbol].add(date(1970, 1, 1) + timedelta(days=int(day)))
    return found


def _first_members(first_month: date) -> date:
    """The first month that can have members when `first_month` is the earliest held: its look-back of
    listed_days lies inside the held months."""
    listed_days = universe.rule(universe.RULE)["listed_days"]
    first = first_month
    while first - timedelta(days=listed_days) < first_month:
        first = universe.next_month(first)
    return first


def _members(market: versions.Market, version: dict, month: date) -> set[str]:
    found: set[str] = set()
    for batch in versions.scan(market, version, "universe_month", None, _month_ms(month),
                               _month_ms(universe.next_month(month))):
        found.update(batch.filter(pc.equal(batch.column("universe_rule"), universe.RULE)).column("symbol").to_pylist())
    return found


def _universe(market: versions.Market, version: dict, month: date, first_month: date) -> tuple[list[str], list[str]]:
    """The universe of `month` alone in `version`: (members, members to write). Stored months cannot change
    (bars only extend, and a month's look-back lies before it), so only the imported month is computed;
    importing it again must give the stored members (UNIVERSE_CHANGED otherwise). The first month has
    none: no history before it is held."""
    listed_days = universe.rule(universe.RULE)["listed_days"]
    first = _first_members(first_month)
    stored = _members(market, version, month)
    if month < first:
        if stored:
            raise _refuse(f"{month:%Y-%m} has stored members before the second imported month", "UNIVERSE_CHANGED",
                          missing=(f"{month:%Y-%m}",))
        return [], []
    rows, _ = _terms_rows(market, version)
    classifications = [universe.classify_contract(symbol, _item_of(symbol, row), universe.RULE)
                       for symbol, row in sorted(rows.items())]
    look_back = month - timedelta(days=listed_days)
    days = trading_days(market, version, [item["symbol"] for item in classifications if item["eligible"]], look_back,
                        month)
    computed = {symbol for _, symbol in universe.monthly_universe(classifications, days, month, month, universe.RULE,
                                                                   covered=(look_back, month - timedelta(days=1)))}
    if stored and computed != stored:
        raise _refuse(f"{month:%Y-%m} recomputes to other members than stored: "
                      + ", ".join(sorted(computed ^ stored)), "UNIVERSE_CHANGED",
                      missing=(f"{month:%Y-%m}", *sorted(computed ^ stored)))
    return sorted(computed), ([] if stored else sorted(computed))


def _check_empty(market: versions.Market, version: dict, month: date, start_ms: int, end_ms: int) -> None:
    """A backfilled month holds no bar or funding row of any contract yet (MONTH_EXISTS); its members are
    checked by _universe."""
    label = f"{month:%Y-%m}"
    for table in ("bar", "funding"):
        for batch in versions.scan(market, version, table, None, start_ms, end_ms):
            if batch.num_rows:
                symbol = batch.column("symbol")[0].as_py()
                raise _refuse(f"the market already holds {symbol} rows in {label}", "MONTH_EXISTS",
                              missing=(label, symbol))


def _fill_universe(market: versions.Market, version: dict, month: date, earliest: date,
                   latest: date) -> dict[date, list[str]]:
    """After backfilling `month` before `earliest`: the members of the stored months whose look-back the
    backfill completes, {month: members}. They had none for want of history; one that has any refuses
    UNIVERSE_CHANGED. Later months already had their look-back and stay as stored."""
    filled, at = {}, _first_members(month)
    while at < _first_members(earliest) and at <= latest:
        if _members(market, version, at):
            raise _refuse(f"{at:%Y-%m} already has members, before its look-back was held", "UNIVERSE_CHANGED",
                          missing=(f"{at:%Y-%m}",))
        filled[at] = _universe(market, version, at, month)[0]
        at = universe.next_month(at)
    return filled


# market.freshness

def freshness(profile: dict, ref: str | None = None) -> dict:
    """market.freshness: what a market commit holds (universe months and contracts, the newest minute,
    the latest complete day and month, the import scope)."""
    market = versions.open_market(profile, "reader")
    commit = versions.resolve_commit(market, ref)
    version = versions.load_version(market, commit)
    rule = version["market_schema"]["universe_rule"]
    members = universe.months_of(market, commit)
    months = sorted({month for month, _ in members})
    if not months:
        raise _refuse(f"market commit {commit} has no universe month", "MARKET_EMPTY", missing=(commit,))
    newest = None
    # A table's files are disjoint in time: the newest minute is in the latest file holding a LAST bar.
    for entry in reversed(versions.entries(version, "bar")):
        for batch in versions.file_batches(versions.entry_bytes(market, entry), versions.BAR):
            opens = batch.filter(pc.equal(batch.column("price_type"), "LAST")).column("ts_open")
            if len(opens):
                newest = max(newest or 0, pc.max(opens).as_py())
        if newest is not None:
            break
    done = versions.receipts(market, commit, BARS)
    covered = newest + MINUTE if newest is not None else None
    day = series._ms_day(covered) if covered is not None else None
    complete_day = (day - timedelta(days=1)) if day is not None else None
    month_start = day.replace(day=1) if day is not None else None
    at_month_start = month_start is not None and covered == series._day_ms(month_start)
    complete_month = (month_start - timedelta(days=1)).strftime("%Y-%m") if month_start is not None else None
    return {"commit": commit, "universe_rule": rule, "universe_months": [value.strftime("%Y-%m") for value in months],
            "symbols": len({symbol for _, symbol in members}), "covered_through": covered,
            "latest_complete_day": complete_day, "latest_complete_month": complete_month,
            "current_month_through": None if covered is None or at_month_start else covered,
            "scope": done[-1]["scope"] if done else None}


# One file and one version per contract (quotes, complete aggTrades)

def worker_market(job: dict) -> versions.Market:
    """The market a worker process writes one contract's file into: the calling process holds the import lock
    and hands over the head's files of that table and contract, which write_file checks the new one against."""
    return versions.Market(Path(job["root"]), "import", None, True, locked=True,
                           version={"market_schema": job["market_schema"], "files": job["files"]})


def contract_job(market: versions.Market, table: str, symbol: str, **fields) -> dict:
    version = head_version(market)
    return {"root": str(market.root), "market_schema": version["market_schema"], "symbol": symbol, "files": [
        entry for entry in version["files"] if entry["table"] == table and entry["symbol"] == symbol], **fields}


def contract_versions(market: versions.Market, jobs: list[dict], write, workers: int, log) -> list[dict]:
    """Each job's file written by `write(job)` -> {entry, receipt, result}, in a process pool when there are
    several, and committed as a version of its own, in job order. A refused contract leaves the other
    contracts' versions; the refusal raised is the first contract's, naming the versions committed."""
    done: list[dict] = []
    failed: tuple[str, BaseException] | None = None
    pool = ProcessPoolExecutor(min(workers, len(jobs))) if workers > 1 and len(jobs) > 1 else None
    try:
        futures = [pool.submit(write, job) for job in jobs] if pool is not None else None
        for index, job in enumerate(jobs):
            try:
                found = futures[index].result() if futures is not None else write(job)
                commit = versions.commit_version(market, [found["entry"]], found["receipt"])
            except Exception as exc:  # noqa: BLE001 - the other contracts go on; raised below
                failed = failed or (job["symbol"], exc)
                continue
            done.append({**found["result"], "market_commit": commit})
            log(f"{job['symbol']}: {commit}")
    finally:
        if pool is not None:
            pool.shutdown(wait=False, cancel_futures=True)
    if failed is not None:
        symbol, error = failed
        committed = ", ".join(f"{item['symbols'][0]} {item['market_commit']}" for item in done)
        if committed and isinstance(error, MarketError):
            raise MarketError(f"{symbol}: {error.message}; committed meanwhile: {committed}", code=error.code,
                              missing=error.missing) from error
        raise error
    return done


def month_entry(market: versions.Market, table: str, symbol: str, start_ms: int, end_ms: int) -> bool:
    """Whether the head holds a file of `table` for `symbol` meeting [start_ms, end_ms)."""
    return any(entry["table"] == table and entry["symbol"] == symbol and entry["start_ms"] < end_ms
               and entry["end_ms"] > start_ms for entry in head_version(market)["files"])


def earlier_entry(market: versions.Market, table: str, symbol: str, start_ms: int) -> bool:
    """Whether the head holds a file of `table` for `symbol` starting before `start_ms`."""
    return any(entry["table"] == table and entry["symbol"] == symbol and entry["start_ms"] < start_ms
               for entry in head_version(market)["files"])


# Quotes (market.import_quotes): best bid/ask inferred from Binance aggTrades under quotes.RULE

def import_quotes(profile: dict, month: date, cache_root: Path, workers: int = 4, symbols: list[str] | None = None,
                  log=print) -> dict:
    """market.import_quotes: append one UTC month of inferred best bid/ask (quotes.RULE) of `symbols`
    (default: the month's universe members), one file and one market version per contract; insert only, one
    month per contract. Every state change is stored: thinning to per-second extremes moves a liquidation to
    the second's adverse extreme up to a second late (measured), so there is no thinned form."""
    started = time.monotonic()
    scope = _scope(symbols)
    start_ms, end_ms = month_bounds(month)
    if start_ms == end_ms:
        raise _refuse(f"{month:%Y-%m} has no closed UTC day yet", "MONTH_INVALID", missing=(f"{month:%Y-%m}",))
    market = versions.open_market(profile, "import")
    with versions.lock(market):
        return _import_quotes(market, month, start_ms, end_ms, Path(cache_root), workers, scope, log, started)


def _import_quotes(market: versions.Market, month: date, start_ms: int, end_ms: int, cache: Path, workers: int,
                   scope: list[str] | None, log, started: float) -> dict:
    label = f"{month:%Y-%m}"
    if market.empty:
        raise _refuse("the market holds no bars yet; quotes need the contracts' terms", "MARKET_EMPTY")
    version = head_version(market)
    if "quote" not in versions.tables_of(version):
        raise _refuse("the market's tables have no quote; run market upgrade first", "SCHEMA_MISMATCH",
                      missing=("quote",))
    done = versions.receipts(market, market.head, QUOTES)
    if any(item["quote_rule"] != quotes.RULE for item in done):
        raise _refuse(f"earlier quote imports used rule {done[-1]['quote_rule']}, this code {quotes.RULE}",
                      "RULE_VERSION_MISMATCH", missing=(str(done[-1]["quote_rule"]),))
    if scope is None:
        scope = sorted(_members(market, version, month))
        if not scope:
            raise _refuse(f"{label} has no universe members in the market; import its bars first or name --symbols",
                          "UNIVERSE_UNKNOWN", missing=(label,))
    stored = [symbol for symbol in scope if month_entry(market, "quote", symbol, start_ms, end_ms)]
    if stored:
        raise _refuse(f"the market already holds {label} quotes of {stored}", "MONTH_EXISTS", missing=(label,))
    _, latest = _terms_rows(market, version)
    jobs = []
    for symbol in scope:
        # The newest stored terms: like the bar import, the price increment is the one observed at import time.
        if symbol not in latest:
            raise _refuse(f"{symbol}: the market holds no contract terms", "TERMS_UNKNOWN", missing=(symbol,))
        jobs.append(contract_job(market, "quote", symbol, cache=str(cache), start=start_ms, end=end_ms,
                                 tick=latest[symbol]["price_increment"], workers=workers,
                                 earlier=earlier_entry(market, "quote", symbol, start_ms)))
    # One contract at a time: a contract-day's derivation is held whole, and fetch_all already downloads in
    # `workers` threads.
    found = contract_versions(market, jobs, quote_month, 1, log)
    per_symbol = {item["symbols"][0]: {**item["per_symbol"], "market_commit": item["market_commit"]} for item in found}
    return {"month": label, "through": series._ms_day(end_ms).isoformat(), "quote_rule": quotes.RULE,
            "symbols": scope, "quote_rows": sum(item["quotes"] for item in per_symbol.values()),
            "per_symbol": per_symbol, "archives": {symbol: item["archives"][symbol] for item in found
                                                   for symbol in item["symbols"]},
            "market_commit": market.head, "seconds": round(time.monotonic() - started)}


def quote_month(job: dict) -> dict:
    """One contract's month of quotes, written as one file (in a worker process): {entry, receipt, result}."""
    symbol, cache, tick = job["symbol"], Path(job["cache"]), Decimal(job["tick"])
    days = [series._ms_day(at).isoformat() for at in range(job["start"], job["end"], DAY)]
    eve = series._ms_day(job["start"] - DAY).isoformat()
    state = quotes.State()
    try:
        eve_path = sources.fetch_archive(cache, sources.aggtrades_key(symbol, eve))
    except MarketError as exc:
        if exc.code != "ARCHIVE_NOT_PUBLISHED" or job["earlier"]:
            raise
        eve_path = None  # the contract's first archive: the inference starts cold on the first day
    if eve_path is not None:
        quotes.derive(sources.aggtrades_table(eve_path), tick, state, f"{symbol} {eve}")
    paths = sources.fetch_all(cache, [sources.aggtrades_key(symbol, day) for day in days], job["workers"])
    archives = {day: _published_sha(path) for day, path in zip(days, paths, strict=True)}
    if eve_path is not None:
        archives[eve] = _published_sha(eve_path)
    readings = {"trades": 0, "quote_changes": 0, "stale_side_adjustments": 0, "minutes_with_trades": 0,
                "trade_gap_max_ms": 0, "trade_gap_p99_ms": 0}
    daily: dict[str, dict] = {}
    written = 0

    def rows():
        # One day at a time: derive, scale, write, drop (a month of BTCUSDT is tens of millions of states).
        nonlocal written
        for day, path in zip(days, paths, strict=True):
            found, day_readings = quotes.derive(sources.aggtrades_table(path), tick, state, f"{symbol} {day}")
            scaled_rows = quotes.scaled_rows(symbol, found, PRICE_SCALE)
            del found
            if scaled_rows:
                yield pa.RecordBatch.from_arrays(
                    [pa.array(column, field.type) for column, field in zip(zip(*scaled_rows, strict=True),
                                                                            versions.QUOTE.schema, strict=True)],
                    schema=versions.QUOTE.schema)
            written += len(scaled_rows)
            del scaled_rows
            for key, value in day_readings.items():
                readings[key] = max(readings[key], value) if key.startswith("trade_gap") else readings[key] + value
            daily[day] = {key: day_readings[key] for key in ("trades", "quote_changes", "stale_side_adjustments",
                                                             "trade_gap_max_ms")}

    entry = versions.write_file(worker_market(job), "quote", symbol, job["start"], job["end"], rows())
    # The receipt: the rule, every archive's published SHA-256 and each day's readings (trades, states,
    # stale-side adjustments, largest trade gap), so the derivation can be audited later.
    receipt = {"import": QUOTES, "month": series._ms_day(job["start"]).strftime("%Y-%m"),
               "through": series._ms_day(job["end"]).isoformat(), "quote_rule": quotes.RULE, "symbols": [symbol],
               "archives": {symbol: archives}, "readings": {symbol: daily}}
    return {"entry": entry, "receipt": receipt, "result": {**receipt, "quotes": written, "per_symbol": {
        **readings, "quotes": written, "eve_archive": eve_path is not None, "days": len(days), "daily": daily}}}


def _published_sha(path: Path) -> str:
    """The SHA-256 the exchange published beside a cached archive (fetch_archive verified it)."""
    return (Path(path).with_name(Path(path).name + ".CHECKSUM")).read_text(encoding="utf-8").split()[0]
