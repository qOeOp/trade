"""Coverage facts (`market.coverage_facts`, `market.diagnose_coverage`) and the bar and funding reads
they and the exporter share.

Facts only, at one pinned market day: per contract its member months, the gaps and zero-volume
minutes of its one-minute LAST and MARK bars in the input interval, how the two align, and its
funding settlement count and bounds; `market coverage` adds the settlement spacing and the settlements
missing inside it (`funding_spacing`), its quote, complete trade and metrics months and stored bounds
(`metrics_facts`) and the terms row an export of the market day trades on (`market.terms`); none is part of an export receipt. First
and last data are proxies of listing and delisting, no exchange fact. Nothing here drops a contract,
shortens a window, fills data or judges an economic failure.
"""

from __future__ import annotations

from collections.abc import Iterator
from datetime import date, datetime, timedelta
from decimal import Decimal
from itertools import groupby

import numpy as np
import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.parquet as pq

from market import files, instrument, lifecycle, metrics, series, store, universe
from market.sources import MINUTE
from shared import clock
from shared.refusals import refuse


FORMAT = "market-coverage-v1"
INTERPRETATION = (
    "Gaps, zero-volume minutes, missing funding and first or last data are input facts; their causes are unproven. "
    "The replay entry does not drop contracts, shorten the window, fill data or judge an economic failure from them, "
    "and does not decide for the strategy whether its indicators are ready. The replay treats each the same way in "
    "every run and the market holds no synthetic rows, so the strategy decides only how it reacts. A zero-volume "
    "minute is the exchange's record (sources holding the same minute agree at import): the strategy receives the "
    "bar, and bar execution moves the last price through it: an order already resting that it crosses waits for the "
    "next traded bar, and an order submitted in that minute can fill at once at the engine's last quote. A LAST gap has no bar and matches nothing; a derived bar is built from the minutes present, and "
    "a bucket with none does not exist. Through a MARK gap an open position is valued at its latest MARK while that "
    "is at most engine.config.MARK_CARRY_MAX_MINUTES old (the summary's mark_carry, a limitation). Valuation runs at the "
    "MARK times of the run's input contracts: a longer gap while a position is open fails the run's integrity "
    "(CAPITAL_VALUATION_GAP) when another input contract has a MARK inside it; when none has, nothing is valued inside "
    "it and the run does not fail, so compare mark.gap_intervals_ms with the positions. With no position open it "
    "changes nothing. "
    "A missing funding settlement settles nothing, so a held position's account result lacks that payment.")


# Reads at a market day

def read_series(market: files.Market, market_day: str, symbol: str, start_ms: int, end_ms: int,
                price_types: tuple[str, ...] = series.PRICE_TYPES) -> dict[str, dict[str, np.ndarray]]:
    """Both series' one-minute integer bars in [start_ms, end_ms) at an exact market day ({"LAST": ..., "MARK": ...}),
    from one read of each bar file: the files are disjoint in time and each is in key order."""
    stop = files._visible("bar", market_day, end_ms)
    blocks: dict[str, list[np.ndarray]] = {price_type: [] for price_type in price_types}
    for entry in files.entries(market, "bar", [symbol], start_ms, stop):
        for batch in files.file_batches(files.file_source(market, entry), files.BAR, [symbol], start_ms, stop):
            for price_type, found in blocks.items():
                part = batch.filter(pc.equal(batch.column("price_type"), price_type))
                if part.num_rows:
                    found.append(np.column_stack([part.column(name).to_numpy() for name in series.COLUMNS]))
    bars = {}
    for price_type in price_types:  # each series' blocks are freed once stacked
        found = blocks.pop(price_type)
        stacked = np.concatenate(found) if found else np.empty((0, 6), np.int64)
        bars[price_type] = {name: np.ascontiguousarray(stacked[:, index]) for index, name in enumerate(series.COLUMNS)}
    return bars


def read_bars(market: files.Market, market_day: str, symbol: str, price_type: str, start_ms: int,
              end_ms: int) -> dict[str, np.ndarray]:
    """One series' one-minute integer bars in [start_ms, end_ms) at an exact market day (read_series)."""
    return read_series(market, market_day, symbol, start_ms, end_ms, (price_type,))[price_type]


def read_funding(market: files.Market, market_day: str, symbol: str, start_ms: int,
                 end_ms: int) -> list[tuple[int, Decimal]]:
    return [(int(at), rate) for batch in files.read_table(market, market_day, "funding", [symbol], start_ms, end_ms)
            for at, rate in zip(batch.column("funding_time").to_pylist(), batch.column("rate").to_pylist(), strict=True)]


def _bar_runs(market: files.Market, market_day: str, entry: files.DataFile, symbols: list[str]
              ) -> Iterator[tuple[str, str, np.ndarray, np.ndarray]]:
    """(symbol, price type, ts_open, volume) of each series of `symbols` in one bar file at the market day. The file is
    in key order, so a series is one run of rows and is finished before the next."""
    key: tuple[str, str] | None = None
    pending: list[tuple[np.ndarray, np.ndarray]] = []

    def finish() -> Iterator[tuple[str, str, np.ndarray, np.ndarray]]:
        if key is not None:
            yield *key, np.concatenate([part[0] for part in pending]), np.concatenate([part[1] for part in pending])

    for batch in files.file_batches(files.file_source(market, entry), files.BAR, symbols, None,
                                    files._visible("bar", market_day, None),
                                    columns=["symbol", "price_type", "ts_open", "volume"]):
        names, kinds = (pc.dictionary_encode(batch.column(name)) for name in ("symbol", "price_type"))
        symbol_at, kind_at = names.indices.to_numpy(), kinds.indices.to_numpy()
        times, volume = batch.column("ts_open").to_numpy(), batch.column("volume").to_numpy()
        bounds = [0, *(np.flatnonzero(np.diff(symbol_at) | np.diff(kind_at)) + 1).tolist(), len(times)]
        for low, high in zip(bounds, bounds[1:], strict=False):
            if low == high:
                continue
            found = (names.dictionary[symbol_at[low]].as_py(), kinds.dictionary[kind_at[low]].as_py())
            if found != key:
                if key is not None and found < key:
                    raise refuse("SERIES_UNSORTED", f"{entry.relative}: {' '.join(found)} rows follow {' '.join(key)} rows",
                                 missing=(entry.relative,))
                yield from finish()
                key, pending = found, []
            pending.append((times[low:high], volume[low:high]))
    yield from finish()


def _bar_facts(market: files.Market, market_day: str, symbols: list[str], start_ms: int, end_ms: int
               ) -> dict[str, tuple[_Bars, dict[str, tuple[int | None, int | None]]]]:
    """{symbol: (the _Bars of [start_ms, end_ms), the LAST and MARK edges of the whole stored history)} at the market
    day, one contract's month held at a time. A bar file meeting the interval is read once for every contract. Files are
    disjoint in time, so another is read only for the contracts whose first or last minute it may hold, at most once for
    each."""
    entries = files.entries(market, "bar", None, None, files._visible("bar", market_day, None))
    found = {symbol: _Bars(start_ms, end_ms) for symbol in symbols}
    edges: dict[str, dict[tuple[str, str], tuple[int, int]]] = {}  # per file, the first and last minute of each series
    asked: dict[str, set[str]] = {entry.relative: set() for entry in entries}

    def read(entry: files.DataFile, wanted: set[str]) -> Iterator[tuple[str, dict[str, dict[str, np.ndarray]]]]:
        asked[entry.relative] |= wanted
        into = edges.setdefault(entry.relative, {})
        for symbol, runs in groupby(_bar_runs(market, market_day, entry, sorted(wanted)), key=lambda run: run[0]):
            parts = {price_type: {"ts_open": times, "volume": volume} for _, price_type, times, volume in runs}
            for price_type, part in parts.items():
                into[symbol, price_type] = int(part["ts_open"].min()), int(part["ts_open"].max())
            yield symbol, parts

    for entry in entries:
        if entry.start_ms >= end_ms or entry.end_ms <= start_ms:
            continue
        for symbol, parts in read(entry, set(symbols)):
            for part in parts.values():
                keep = (part["ts_open"] >= start_ms) & (part["ts_open"] < end_ms)
                part.update({name: values[keep] for name, values in part.items()})
            found[symbol].add(parts.get("LAST"), parts.get("MARK"))
    bounds: list[dict[tuple[str, str], int]] = []
    for side, order in enumerate((entries, entries[::-1])):
        reached: dict[tuple[str, str], int] = {}
        for entry in order:
            pending = {symbol for symbol in symbols for price_type in series.PRICE_TYPES
                       if (symbol, price_type) not in reached}
            if not pending:
                break
            if pending - asked[entry.relative]:
                for _ in read(entry, pending - asked[entry.relative]):
                    pass
            for key, edge in edges[entry.relative].items():
                reached.setdefault(key, edge[side])
        bounds.append(reached)
    return {symbol: (bars, {price_type: (bounds[0].get((symbol, price_type)), bounds[1].get((symbol, price_type)))
                            for price_type in series.PRICE_TYPES}) for symbol, bars in found.items()}


def _edges(market: files.Market, market_day: str, table: str, symbol: str, start_ms: int,
           end_ms: int) -> tuple[int | None, int | None]:
    """The first and last stored time of `symbol` in `table` in [start_ms, end_ms) at the market day: a table's files
    are disjoint in time, so the earliest file holding such a row gives the first and the latest the last, and no
    other file is read."""
    definition = files.TABLES[table]
    stop = files._visible(table, market_day, end_ms)
    found = files.entries(market, table, [symbol], start_ms, stop)

    def bounds(entry: files.DataFile) -> tuple[int, int] | None:
        times: list[int] = []
        for batch in files.file_batches(files.file_bytes(market, entry), definition, [symbol], start_ms, stop):
            if batch.num_rows:
                times += [value.as_py() for value in pc.min_max(batch.column(definition.time)).values()]
        return (min(times), max(times)) if times else None

    for index, entry in enumerate(found):
        earliest = bounds(entry)
        if earliest is not None:
            for later in reversed(found[index + 1:]):
                latest = bounds(later)
                if latest is not None:
                    return earliest[0], latest[1]
            return earliest
    return None, None


# market.coverage_facts

def _interval(start_ms, end_ms) -> None:
    if (type(start_ms) is not int or type(end_ms) is not int or start_ms >= end_ms or start_ms % MINUTE
            or end_ms % MINUTE):
        raise refuse("INTERVAL_INVALID",
                     f"[{start_ms}, {end_ms}) is not a whole-minute interval with start before end",
                     missing=("start", "end"))


class _Series:
    """The facts of one series' minutes in [start_ms, end_ms), added in time order."""

    def __init__(self, start_ms: int, end_ms: int) -> None:
        self.end_ms, self.at = end_ms, start_ms  # `at`: the minute the next row is due
        self.rows = self.zero = 0
        self.first: int | None = None
        self.last: int | None = None
        self.gaps: list[list[int]] = []

    def add(self, times: np.ndarray, volume: np.ndarray | None) -> None:
        if not len(times):
            return
        if (np.any(times % MINUTE) or np.any(np.diff(times) <= 0) or (self.last is not None and times[0] <= self.last)):
            raise refuse("SOURCE_SHAPE", "bar open times are not whole, strictly increasing minutes")
        end = min(int(times[-1]) + MINUTE, self.end_ms)
        facts = series.missing_intervals(times, self.at, end, MINUTE, volume)
        self.gaps += [list(gap) for gap in facts["intervals"]]
        self.zero += facts["zero_volume_count"] or 0
        self.first = int(times[0]) if self.first is None else self.first
        self.rows, self.last, self.at = self.rows + len(times), int(times[-1]), end

    def facts(self, volume: bool) -> dict:
        gaps = self.gaps + ([[self.at, self.end_ms]] if self.at < self.end_ms else [])
        return {"rows": self.rows, "first_open_ms": self.first, "last_open_ms": self.last, "gap_intervals_ms": gaps,
                "missing_minutes": sum((high - low) // MINUTE for low, high in gaps),
                **({"zero_volume_minutes": self.zero} if volume else {})}


class _Bars:
    """One contract's LAST and MARK facts of [start_ms, end_ms), from bars added in time order: each part's LAST and
    MARK rows cover the same time, or None."""

    def __init__(self, start_ms: int, end_ms: int) -> None:
        self.last, self.mark, self.unmatched = _Series(start_ms, end_ms), _Series(start_ms, end_ms), 0

    def add(self, last: dict | None, mark: dict | None) -> None:
        empty = np.empty(0, np.int64)
        opens, marks = (empty if bars is None else np.asarray(bars["ts_open"], np.int64) for bars in (last, mark))
        self.last.add(opens, empty if last is None else np.asarray(last["volume"]))
        self.mark.add(marks, None)
        self.unmatched += int(len(np.setxor1d(opens, marks, assume_unique=True)))  # unique: each series ascends

    def facts(self) -> dict:
        return {"last": self.last.facts(True), "mark": self.mark.facts(False),
                "last_mark_unmatched_minutes": self.unmatched}


def coverage_facts(market_day: str, symbol: str, start_ms: int, end_ms: int, last_bars: dict,
                   mark_bars: dict, funding_rows: list[tuple[int, Decimal]],
                   edges: dict[str, tuple[int | None, int | None]], months: list[date]) -> dict:
    """market.coverage_facts: the market-coverage-v1 facts of one contract in [start_ms, end_ms) at an
    exact market day. `edges`: {"LAST": (first, last), "MARK": ...} open times of the whole stored history
    (market.contract_history). `months`: the contract's member months (universe.months_of)."""
    _interval(start_ms, end_ms)
    files.check_day(market_day)
    bars = _Bars(start_ms, end_ms)
    bars.add(last_bars, mark_bars)
    return _contract_facts(market_day, symbol, start_ms, end_ms, bars, months, [int(at) for at, _ in funding_rows], edges)


def _contract_facts(market_day: str, symbol: str, start_ms: int, end_ms: int, bars: _Bars, months: list[date],
                    funding: list[int], edges: dict[str, tuple[int | None, int | None]]) -> dict:
    bounds = {price_type.lower(): {"first_open_ms": edges[price_type][0], "last_open_ms": edges[price_type][1]}
              if edges[price_type][0] is not None else None for price_type in series.PRICE_TYPES}
    return {"format": FORMAT, "market_day": market_day, "symbol": symbol, "input_interval_ms": [start_ms, end_ms],
            **bars.facts(),
            "funding": {"rows": len(funding), "first_ms": funding[0] if funding else None,
                        "last_ms": funding[-1] if funding else None},
            "member_months": [month.isoformat() for month in months],
            "listing_delisting": {"data_bounds_proxy": bounds}, "interpretation": INTERPRETATION}


def funding_spacing(times: list[int]) -> dict:
    """The settlement spacing of one contract's funding times (ascending): runs of equal spacing between
    consecutive settlements, each time taken at its nearest whole UTC hour, and the settlements missing
    inside a run. A single interval that is a whole multiple k >= 2 of the spacing of the run(s) beside it
    (the same on both sides) is k - 1 missing settlements, not a spacing change."""
    slots = [store.funding_slot(at) for at in times]
    runs: list[list[int]] = []  # [hours, index of the first settlement, index of the last]
    for index, hours in enumerate(later - earlier for earlier, later in zip(slots[:-1], slots[1:], strict=True)):
        if runs and runs[-1][0] == hours:
            runs[-1][2] = index + 1
        else:
            runs.append([hours, index, index + 1])
    merged: list[list[int]] = []
    missing = []
    for position, (hours, low, high) in enumerate(runs):
        beside = {runs[at][0] for at in (position - 1, position + 1) if 0 <= at < len(runs)}
        spacing = beside.pop() if len(beside) == 1 else None
        if high - low == 1 and spacing is not None and hours > spacing and hours % spacing == 0:
            missing.append({"after_ms": times[low], "before_ms": times[high], "missing": hours // spacing - 1})
            hours = spacing
        if merged and merged[-1][0] == hours:
            merged[-1][2] = high
        else:
            merged.append([hours, low, high])
    return {"spacing": [{"spacing_ms": hours * store.HOUR, "from_ms": times[low], "to_ms": times[high]}
                        for hours, low, high in merged],
            "missing_settlements": missing}


def _held(market: files.Market, market_day: str, table: str, symbol: str, start_ms: int, end_ms: int,
          nulls: tuple[str, ...] = ()) -> dict:
    """`symbol`'s files of `table` (its inferred best bid/ask, its complete aggregate trades, which a replay exports as
    trade ticks on request, or its metrics) meeting [start_ms, end_ms) at the market day: `months`, each with its rows at the market day
    (and the nulls of the `nulls` columns), the first and last stored time in the interval and the parts with no
    file. A file ending by the market day counts from its footer; one it cuts through is read."""
    visible = files.day_end(table, market_day)
    found = files.entries(market, table, [symbol], start_ms, min(end_ms, visible))
    months, uncovered, at = [], [], start_ms
    for entry in found:
        counts = dict.fromkeys(nulls, 0)
        if entry.end_ms <= visible:
            footer = pq.ParquetFile(pa.BufferReader(files.file_bytes(market, entry))).metadata
            rows = footer.num_rows
            for group in range(footer.num_row_groups):
                for index in range(footer.num_columns):
                    column = footer.row_group(group).column(index)
                    if column.path_in_schema in counts:
                        counts[column.path_in_schema] += column.statistics.null_count
        else:
            rows = 0
            for batch in files.file_batches(files.file_bytes(market, entry), files.TABLES[table], [symbol], None, visible):
                rows += batch.num_rows
                for name in nulls:
                    counts[name] += batch.column(name).null_count
        months.append({"month": clock.ms_day(entry.start_ms).strftime("%Y-%m"), "rows": rows,
                       **({"empty": counts} if nulls else {})})
        if at < entry.start_ms:
            uncovered.append([at, entry.start_ms])
        at = max(at, min(entry.end_ms, visible))
    if at < end_ms:
        uncovered.append([at, end_ms])
    first, last = _edges(market, market_day, table, symbol, start_ms, end_ms) if found else (None, None)
    return {"months": months, "first_ms": first, "last_ms": last, "uncovered_intervals_ms": uncovered}


def metrics_facts(market: files.Market, market_day: str, symbol: str, start_ms: int, end_ms: int) -> dict:
    """The open interest and long/short ratio rows of one contract in [start_ms, end_ms) at an exact market day,
    which a replay exports on request: each month's file meeting it with its rows, the rows the five-minute grid of the
    days it holds lacks, the empty ratios and the days up to the market day it does not hold, the first and last stored
    create_time in the interval and the parts with no row, missing days included."""
    found = _held(market, market_day, "metrics", symbol, start_ms, end_ms, metrics.RATIOS)
    limit = clock.ms_day(files.day_end("metrics", market_day))
    gaps = []
    for part in found["months"]:
        month = date.fromisoformat(f"{part['month']}-01")
        held = {day for day in metrics.held_days(market, symbol, month) if day < limit}
        days = [month + timedelta(days=count) for count in range((clock.next_month(month) - month).days)]
        part["missing_rows"] = len(held) * (store.DAY // metrics.STEP) - part["rows"]
        part["missing_days"] = [day.isoformat() for day in days if day not in held and day < limit]
        gaps += [[max(low, start_ms), min(low + store.DAY, end_ms)] for day in part["missing_days"]
                 if (low := clock.day_ms(date.fromisoformat(day))) < end_ms and low + store.DAY > start_ms]
    merged: list[list[int]] = []
    for low, high in sorted(found["uncovered_intervals_ms"] + gaps):
        if merged and low <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], high)
        else:
            merged.append([low, high])
    return {**found, "uncovered_intervals_ms": merged}


# market.diagnose_coverage

def _ms(text: str) -> int:
    try:
        moment = datetime.fromisoformat(str(text).replace("Z", "+00:00"))
    except ValueError as exc:
        raise refuse("INTERVAL_INVALID", f"{text!r} is not an ISO-8601 time", missing=(str(text),)) from exc
    if moment.utcoffset() != timedelta(0):
        raise refuse("INTERVAL_INVALID", f"{text!r} is not an explicit UTC time", missing=(str(text),))
    return int(moment.timestamp() * 1000)


def universe_members(profile: dict, at: str | None, start: str, end: str) -> list[str]:
    """Every universe member of the months [start, end) touches, at the market day `at` names."""
    start_ms, end_ms = _ms(start), _ms(end)
    _interval(start_ms, end_ms)
    first = clock.ms_day(start_ms).replace(day=1)
    last = clock.ms_day(end_ms - 1).replace(day=1)
    market = files.open_market(profile, "reader")
    market_day = files.resolve_day(market, at)
    return sorted({symbol for month, symbol in universe.months_of(market, market_day) if first <= month <= last})


def diagnose_coverage(profile: dict, at: str | None, symbols: list[str], start: str, end: str,
                      lifecycle_bundle: tuple[dict, dict[str, bytes]] | None) -> dict:
    """market.diagnose_coverage: coverage facts of an explicit contract list at the market day `at` names,
    with the validated lifecycle episodes of a given lifecycle bundle; never a partial result."""
    start_ms, end_ms = _ms(start), _ms(end)
    _interval(start_ms, end_ms)
    if not symbols or len(set(symbols)) != len(symbols):
        raise refuse("EMPTY_SYMBOLS", "the contract list is empty or repeats a contract", missing=("symbols",))
    market = files.open_market(profile, "reader")
    market_day = files.resolve_day(market, at)
    episodes = None
    if lifecycle_bundle is not None:
        body, evidence = lifecycle_bundle
        episodes = lifecycle.validate_lifecycle(body, market_day, evidence)
    stored = _bar_facts(market, market_day, symbols, start_ms, end_ms)
    terms = {symbol: instrument.terms(market, market_day, symbol, any(first is not None for first, _ in edges.values()))
             for symbol, (_, edges) in stored.items()}
    funding: dict[str, list[int]] = {symbol: [] for symbol in symbols}
    for batch in files.read_table(market, market_day, "funding", symbols, start_ms, end_ms):
        for symbol, at in zip(*(batch.column(name).to_pylist() for name in ("symbol", "funding_time")), strict=True):
            funding[symbol].append(int(at))
    months: dict[str, list[date]] = {symbol: [] for symbol in symbols}
    for month, member in universe.months_of(market, market_day):
        if member in months:
            months[member].append(month)
    found = []
    for symbol in symbols:
        bars, edges = stored[symbol]
        facts = _contract_facts(market_day, symbol, start_ms, end_ms, bars, months[symbol], funding[symbol], edges)
        found.append({**facts, "funding": {**facts["funding"], **funding_spacing(funding[symbol])},
                      "quotes": _held(market, market_day, "quote", symbol, start_ms, end_ms),
                      "trades": _held(market, market_day, "agg_trade", symbol, start_ms, end_ms),
                      "metrics": metrics_facts(market, market_day, symbol, start_ms, end_ms),
                      "terms": {key: value for key, value in terms[symbol].items() if key != "symbol"}})
    return {"market_day": market_day, "scope": "explicit_symbols", "input_interval_ms": [start_ms, end_ms], "coverage": found,
            "lifecycle": None if episodes is None else {symbol: episodes.get(symbol, []) for symbol in symbols},
            "lifecycle_missing": [] if episodes is None else [symbol for symbol in symbols if symbol not in episodes],
            "interpretation": INTERPRETATION}


def listed_day(market: files.Market, market_day: str, symbol: str) -> date | None:
    """The first day a contract traded before its first universe month at `market_day` (its listing, for a contract
    new to the market): its bars begin there. None when it is no member of any month."""
    months = [month for month, member in universe.months_of(market, market_day) if member == symbol]
    if not months:
        return None
    start = min(months)
    while True:  # read back a quarter at a time until one holds no trading day
        days = store.trading_days(market, [symbol], start - timedelta(days=92), start)[symbol]
        if not days:
            return start
        start = min(days)
