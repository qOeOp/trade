"""Coverage facts (`market.coverage_facts`, `market.diagnose_coverage`) and the bar and funding reads
they and the exporter share.

Facts only, at one pinned market day: per contract its member months, the gaps and zero-volume
minutes of its one-minute LAST and MARK bars in the input interval, how the two align, and its
funding settlement count and bounds; `market coverage` adds the settlement spacing and the settlements
missing inside it (`funding_spacing`), its quote, complete trade and metrics months and stored bounds
(`quote_facts`, `trade_facts`, `metrics_facts`) and the
terms row an export of the market day trades on (`market.terms`); none is part of an export receipt. First
and last data are proxies of listing and delisting, no exchange fact. Nothing here drops a contract,
shortens a window, fills data or judges an economic failure.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from decimal import Decimal

import numpy as np
import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.parquet as pq

from market import files, instrument, lifecycle, metrics, series, store, universe
from market.sources import MINUTE, _refuse


FORMAT = "market-coverage-v1"
HOUR = 60 * MINUTE
COLUMNS = series.COLUMNS
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

def bar_blocks(market: files.Market, market_day: str, symbol: str, price_type: str, start_ms: int,
               end_ms: int | None):
    """One series' one-minute integer bars in [start_ms, end_ms) at an exact market day, as (rows, 6) arrays in
    time order: the bar files are disjoint in time and each is in key order."""
    for batch in files.scan(market, market_day, "bar", [symbol], start_ms, end_ms):
        batch = batch.filter(pc.equal(batch.column("price_type"), price_type))
        if batch.num_rows:
            yield np.column_stack([batch.column(name).to_numpy() for name in COLUMNS])


def read_bars(market: files.Market, market_day: str, symbol: str, price_type: str, start_ms: int,
              end_ms: int) -> dict[str, np.ndarray]:
    """One series' one-minute integer bars in [start_ms, end_ms) at an exact market day."""
    blocks = list(bar_blocks(market, market_day, symbol, price_type, start_ms, end_ms))
    stacked = np.concatenate(blocks) if blocks else np.empty((0, 6), np.int64)
    return {name: np.ascontiguousarray(stacked[:, index]) for index, name in enumerate(COLUMNS)}


def read_funding(market: files.Market, market_day: str, symbol: str, start_ms: int,
                 end_ms: int) -> list[tuple[int, Decimal]]:
    return [(int(at), rate) for batch in files.read_table(market, market_day, "funding", [symbol], start_ms, end_ms)
            for at, rate in zip(batch.column("funding_time").to_pylist(), batch.column("rate").to_pylist(), strict=True)]


def _edges(market: files.Market, market_day: str, table: str, symbol: str, start_ms: int | None = None,
           end_ms: int | None = None, price_type: str | None = None) -> tuple[int | None, int | None]:
    """The first and last stored time of `symbol` in `table` (and `price_type`) in [start_ms, end_ms) at the market day: a
    table's files are disjoint in time, so the earliest file holding such a row gives the first and the latest
    the last, and no other file is read."""
    definition = files.TABLES[table]
    end_ms = files._visible(table, market_day, end_ms)
    found = files.entries(market, table, [symbol], start_ms, end_ms)

    def bounds(entry: files.DataFile) -> tuple[int, int] | None:
        times: list[int] = []
        for batch in files.file_batches(files.file_bytes(market, entry), definition, [symbol], start_ms, end_ms):
            if price_type is not None:
                batch = batch.filter(pc.equal(batch.column("price_type"), price_type))
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
        raise _refuse(f"[{start_ms}, {end_ms}) is not a whole-minute interval with start before end",
                      "INTERVAL_INVALID", missing=("start", "end"))


def _series(bars: dict, start_ms: int, end_ms: int, volume: bool) -> dict:
    times = np.asarray(bars["ts_open"], dtype=np.int64)
    if len(times) and (np.any(times % MINUTE) or np.any(np.diff(times) <= 0)):
        raise _refuse("bar open times are not whole, strictly increasing minutes", "SOURCE_SHAPE")
    facts = series.missing_intervals(times, start_ms, end_ms, MINUTE,
                                     np.asarray(bars["volume"]) if volume else None)
    found = {"rows": int(len(times)), "first_open_ms": int(times[0]) if len(times) else None,
             "last_open_ms": int(times[-1]) if len(times) else None,
             "gap_intervals_ms": [list(gap) for gap in facts["intervals"]], "missing_minutes": facts["missing_count"]}
    if volume:
        found["zero_volume_minutes"] = facts["zero_volume_count"]
    return found


def coverage_facts(market: files.Market, market_day: str, symbol: str, start_ms: int, end_ms: int, last_bars: dict,
                   mark_bars: dict, funding_rows: list[tuple[int, Decimal]]) -> dict:
    """market.coverage_facts: the market-coverage-v1 facts of one contract in [start_ms, end_ms) at an
    exact market day."""
    _interval(start_ms, end_ms)
    store.check_day(market_day)
    last, mark = _series(last_bars, start_ms, end_ms, True), _series(mark_bars, start_ms, end_ms, False)
    unmatched = int(len(np.setxor1d(np.asarray(last_bars["ts_open"]), np.asarray(mark_bars["ts_open"]))))
    months = [month.isoformat() for month, member in universe.months_of(market, market_day) if member == symbol]
    bounds = {}
    for price_type in ("LAST", "MARK"):
        first, latest = _edges(market, market_day, "bar", symbol, price_type=price_type)
        bounds[price_type] = {"first_open_ms": first, "last_open_ms": latest} if first is not None else None
    times = [int(at) for at, _ in funding_rows]
    return {"format": FORMAT, "market_day": market_day, "symbol": symbol, "input_interval_ms": [start_ms, end_ms],
            "last": last, "mark": mark, "last_mark_unmatched_minutes": unmatched,
            "funding": {"rows": len(times), "first_ms": times[0] if times else None,
                        "last_ms": times[-1] if times else None},
            "member_months": months,
            "listing_delisting": {"data_bounds_proxy": {"last": bounds["LAST"], "mark": bounds["MARK"]}},
            "interpretation": INTERPRETATION}


def funding_spacing(times: list[int]) -> dict:
    """The settlement spacing of one contract's funding times (ascending): runs of equal spacing between
    consecutive settlements, each time taken at its nearest whole UTC hour, and the settlements missing
    inside a run. A single interval that is a whole multiple k >= 2 of the spacing of the run(s) beside it
    (the same on both sides) is k - 1 missing settlements, not a spacing change."""
    slots = [round(at / HOUR) for at in times]
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
    return {"spacing": [{"spacing_ms": hours * HOUR, "from_ms": times[low], "to_ms": times[high]}
                        for hours, low, high in merged],
            "missing_settlements": missing}


def _held(market: files.Market, market_day: str, table: str, symbol: str, start_ms: int, end_ms: int,
          nulls: tuple[str, ...] = ()) -> dict:
    """`symbol`'s files of `table` meeting [start_ms, end_ms) at the market day: `months`, each with its rows at the market day
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
        months.append({"month": series._ms_day(entry.start_ms).strftime("%Y-%m"), "rows": rows,
                       **({"empty": counts} if nulls else {})})
        if at < entry.start_ms:
            uncovered.append([at, entry.start_ms])
        at = max(at, min(entry.end_ms, visible))
    if at < end_ms:
        uncovered.append([at, end_ms])
    first, last = _edges(market, market_day, table, symbol, start_ms, end_ms) if found else (None, None)
    return {"months": months, "first_ms": first, "last_ms": last, "uncovered_intervals_ms": uncovered}


def quote_facts(market: files.Market, market_day: str, symbol: str, start_ms: int, end_ms: int) -> dict:
    """The inferred best bid/ask of one contract in [start_ms, end_ms) at an exact market day: each month's file
    meeting it and its rows, the first and last stored quote time in the interval and the parts no file holds."""
    return _held(market, market_day, "quote", symbol, start_ms, end_ms)


def trade_facts(market: files.Market, market_day: str, symbol: str, start_ms: int, end_ms: int) -> dict:
    """The complete aggregate trades of one contract in [start_ms, end_ms) at an exact market day, which a replay
    exports as trade ticks on request: as quote_facts."""
    return _held(market, market_day, "agg_trade", symbol, start_ms, end_ms)


def metrics_facts(market: files.Market, market_day: str, symbol: str, start_ms: int, end_ms: int) -> dict:
    """The open interest and long/short ratio rows of one contract in [start_ms, end_ms) at an exact market day,
    which a replay exports on request: each month's file meeting it with its rows, the rows the five-minute grid of the
    days it holds lacks, the empty ratios and the days up to the market day it does not hold, the first and last stored
    create_time in the interval and the parts with no row, missing days included."""
    found = _held(market, market_day, "metrics", symbol, start_ms, end_ms, metrics.RATIOS)
    limit = series._ms_day(files.day_end("metrics", market_day))
    gaps = []
    for part in found["months"]:
        month = date.fromisoformat(f"{part['month']}-01")
        held = {day for day in metrics.held_days(market, symbol, month) if day < limit}
        days = [month + timedelta(days=count) for count in range((universe.next_month(month) - month).days)]
        part["missing_rows"] = len(held) * (store.DAY // metrics.STEP) - part["rows"]
        part["missing_days"] = [day.isoformat() for day in days if day not in held and day < limit]
        gaps += [[max(low, start_ms), min(low + store.DAY, end_ms)] for day in part["missing_days"]
                 if (low := series._day_ms(date.fromisoformat(day))) < end_ms and low + store.DAY > start_ms]
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
        raise _refuse(f"{text!r} is not an ISO-8601 time", "INTERVAL_INVALID", missing=(str(text),)) from exc
    if moment.utcoffset() != timedelta(0):
        raise _refuse(f"{text!r} is not an explicit UTC time", "INTERVAL_INVALID", missing=(str(text),))
    return int(moment.timestamp() * 1000)


def universe_members(profile: dict, at: str | None, start: str, end: str) -> list[str]:
    """Every universe member of the months [start, end) touches, at the market day `at` names."""
    start_ms, end_ms = _ms(start), _ms(end)
    _interval(start_ms, end_ms)
    first = series._ms_day(start_ms).replace(day=1)
    last = series._ms_day(end_ms - 1).replace(day=1)
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
        raise _refuse("the contract list is empty or repeats a contract", "EMPTY_SYMBOLS", missing=("symbols",))
    market = files.open_market(profile, "reader")
    market_day = files.resolve_day(market, at)
    episodes = None
    if lifecycle_bundle is not None:
        body, evidence = lifecycle_bundle
        episodes = lifecycle.validate_lifecycle(body, market_day, evidence)
    found = []
    for symbol in symbols:
        terms = instrument.terms(market, market_day, symbol)
        last = read_bars(market, market_day, symbol, "LAST", start_ms, end_ms)
        mark = read_bars(market, market_day, symbol, "MARK", start_ms, end_ms)
        funding = read_funding(market, market_day, symbol, start_ms, end_ms)
        facts = coverage_facts(market, market_day, symbol, start_ms, end_ms, last, mark, funding)
        found.append({**facts, "interpretation": INTERPRETATION,
                      "funding": {**facts["funding"], **funding_spacing([at for at, _ in funding])},
                      "quotes": quote_facts(market, market_day, symbol, start_ms, end_ms),
                      "trades": trade_facts(market, market_day, symbol, start_ms, end_ms),
                      "metrics": metrics_facts(market, market_day, symbol, start_ms, end_ms),
                      "terms": {key: value for key, value in terms.items() if key != "symbol"}})
    return {"market_day": market_day, "scope": "explicit_symbols", "input_interval_ms": [start_ms, end_ms], "coverage": found,
            "lifecycle": None if episodes is None else {symbol: episodes.get(symbol, []) for symbol in symbols},
            "lifecycle_missing": [] if episodes is None else [symbol for symbol in symbols if symbol not in episodes],
            "interpretation": INTERPRETATION}

