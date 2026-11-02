"""Coverage facts (`market.coverage_facts`, `market.diagnose_coverage`) and the bar and funding reads
they and the exporter share.

Facts only, at one pinned market commit: per contract its member months, the gaps and zero-volume
minutes of its one-minute LAST and MARK bars in the input interval, how the two align, and its
funding settlement count and bounds; `market coverage` adds the settlement spacing and the settlements
missing inside it (`funding_spacing`), its quote, complete trade and metrics imports and stored bounds
(`quote_facts`, `trade_facts`, `metrics_facts`) and the terms row an export of the commit trades on (`market.terms`); none is part of an export receipt. First
and last data are proxies of listing and delisting, no exchange fact. Nothing here drops a contract,
shortens a window, fills data or judges an economic failure.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from decimal import Decimal

import numpy as np
import pyarrow.compute as pc

from market import instrument, lifecycle, metrics, series, store, universe, versions
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
    "bar, and bar execution moves the last price through it but fills nothing, so an order it crosses waits for the "
    "next traded bar. A LAST gap has no bar and matches nothing; a derived bar is built from the minutes present, and "
    "a bucket with none does not exist. Through a MARK gap an open position is valued at its latest MARK while that "
    "is at most engine.run.MARK_CARRY_MAX_MINUTES old (the summary's mark_carry, a limitation); a longer gap while a "
    "position is open fails the run's integrity (CAPITAL_VALUATION_GAP), and with no position open changes nothing. "
    "A missing funding settlement settles nothing, so a held position's account result lacks that payment.")


# Reads at a commit

def bar_blocks(market: versions.Market, commit: str, symbol: str, price_type: str, start_ms: int,
               end_ms: int | None):
    """One series' one-minute integer bars in [start_ms, end_ms) at an exact commit, as (rows, 6) arrays in
    time order: a version's bar files are disjoint in time and each is in key order."""
    for batch in versions.scan(market, versions.load_version(market, commit), "bar", [symbol], start_ms, end_ms):
        batch = batch.filter(pc.equal(batch.column("price_type"), price_type))
        if batch.num_rows:
            yield np.column_stack([batch.column(name).to_numpy() for name in COLUMNS])


def read_bars(market: versions.Market, commit: str, symbol: str, price_type: str, start_ms: int,
              end_ms: int) -> dict[str, np.ndarray]:
    """One series' one-minute integer bars in [start_ms, end_ms) at an exact commit."""
    blocks = list(bar_blocks(market, commit, symbol, price_type, start_ms, end_ms))
    stacked = np.concatenate(blocks) if blocks else np.empty((0, 6), np.int64)
    return {name: np.ascontiguousarray(stacked[:, index]) for index, name in enumerate(COLUMNS)}


def read_funding(market: versions.Market, commit: str, symbol: str, start_ms: int,
                 end_ms: int) -> list[tuple[int, Decimal]]:
    return [(int(at), rate) for batch in versions.read_table(market, commit, "funding", [symbol], start_ms, end_ms)
            for at, rate in zip(batch.column("funding_time").to_pylist(), batch.column("rate").to_pylist(), strict=True)]


def _edges(market: versions.Market, version: dict, table: str, symbol: str, start_ms: int | None = None,
           end_ms: int | None = None, price_type: str | None = None) -> tuple[int | None, int | None]:
    """The first and last stored time of `symbol` in `table` (and `price_type`) in [start_ms, end_ms): a
    table's files are disjoint in time, so the earliest file holding such a row gives the first and the latest
    the last, and no other file is read."""
    definition = versions.tables_of(version).get(table)
    if definition is None:  # a commit before the table
        return None, None
    found = versions.entries(version, table, [symbol], start_ms, end_ms)

    def bounds(entry: dict) -> tuple[int, int] | None:
        times: list[int] = []
        for batch in versions.file_batches(versions.file_bytes(market, entry["sha256"], "parquet"), definition,
                                           [symbol], start_ms, end_ms):
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


def coverage_facts(market: versions.Market, commit: str, symbol: str, start_ms: int, end_ms: int, last_bars: dict,
                   mark_bars: dict, funding_rows: list[tuple[int, Decimal]]) -> dict:
    """market.coverage_facts: the market-coverage-v1 facts of one contract in [start_ms, end_ms) at an
    exact market commit."""
    _interval(start_ms, end_ms)
    store.check_commit(commit)
    version = versions.load_version(market, commit)
    if not any(batch.num_rows for batch in versions.scan(market, version, "instrument", [symbol])):
        raise _refuse(f"{symbol} is no instrument at {commit}", "UNKNOWN_SYMBOL", missing=(symbol,))
    last, mark = _series(last_bars, start_ms, end_ms, True), _series(mark_bars, start_ms, end_ms, False)
    unmatched = int(len(np.setxor1d(np.asarray(last_bars["ts_open"]), np.asarray(mark_bars["ts_open"]))))
    months = [month.isoformat() for month, member in universe.months_of(market, commit) if member == symbol]
    bounds = {}
    for price_type in ("LAST", "MARK"):
        first, latest = _edges(market, version, "bar", symbol, price_type=price_type)
        bounds[price_type] = {"first_open_ms": first, "last_open_ms": latest} if first is not None else None
    times = [int(at) for at, _ in funding_rows]
    return {"format": FORMAT, "commit": commit, "symbol": symbol, "input_interval_ms": [start_ms, end_ms],
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


def quote_facts(market: versions.Market, commit: str, symbol: str, start_ms: int, end_ms: int, imports: list[dict]) -> dict:
    """The inferred best bid/ask of one contract in [start_ms, end_ms) at an exact market commit: each quote
    import holding it (month, `through` its exclusive end day, rule, commit, the rows its receipt counts),
    the first and last stored quote time in the interval and the parts of the interval no import covers."""
    months = []
    for item in imports:
        if symbol not in (item["symbols"] or ()):
            continue
        daily = (item["readings"] or {}).get(symbol)
        months.append({"month": item["month"], "through": item["through"], "quote_rule": item["quote_rule"],
                       "commit": item["commit"],
                       "rows": sum(day["quote_changes"] for day in daily.values()) if daily is not None else None})
    return {"imports": months, **_held(market, commit, symbol, start_ms, end_ms, months, "quote")}


def _held(market: versions.Market, commit: str, symbol: str, start_ms: int, end_ms: int, months: list[dict],
          table: str) -> dict:
    """The first and last stored time of `table` in the interval and the parts no import of `months` covers."""
    uncovered, at = [], start_ms
    for low, high in sorted((series._day_ms(date.fromisoformat(item.get("from") or f"{item['month']}-01")),
                             series._day_ms(date.fromisoformat(item["through"]))) for item in months):
        if at < min(low, end_ms):
            uncovered.append([at, min(low, end_ms)])
        at = max(at, high)
    if at < end_ms:
        uncovered.append([at, end_ms])
    first, last = (_edges(market, versions.load_version(market, commit), table, symbol, start_ms, end_ms) if months
                   else (None, None))
    return {"first_ms": first, "last_ms": last, "uncovered_intervals_ms": uncovered}


def trade_facts(market: versions.Market, commit: str, symbol: str, start_ms: int, end_ms: int, imports: list[dict]) -> dict:
    """The complete aggregate trades of one contract in [start_ms, end_ms) at an exact market commit, which a
    replay exports as trade ticks on request: each import holding it (month, `through` its exclusive end day,
    codec, commit, the rows its receipt counts), the first and last stored trade time in the interval and the
    parts of the interval no import covers."""
    months = [{"month": item["month"], "through": item["through"], "codec": item["codec"], "commit": item["commit"],
               "rows": sum(day["trades"] for day in (item["readings"] or {})[symbol].values())}
              for item in imports if symbol in (item["symbols"] or ())]
    return {"imports": months, **_held(market, commit, symbol, start_ms, end_ms, months, "agg_trade")}


def metrics_facts(market: versions.Market, commit: str, symbol: str, start_ms: int, end_ms: int, imports: list[dict]) -> dict:
    """The open interest and long/short ratio rows of one contract in [start_ms, end_ms) at an exact market commit,
    which a replay exports on request: each import holding it (month, the days `from` to `through` its exclusive
    end, commit, the rows its receipt counts, the rows the archive's five-minute grid lacks, the empty ratios and the
    days without an archive), the first and last stored create_time in the interval and the parts no import covers,
    days without an archive included."""
    parts = []
    for item in imports:
        if symbol not in (item["symbols"] or ()):
            continue
        daily = item["readings"][symbol]
        parts.append({"month": item["month"], "from": item["from"], "through": item["through"], "commit": item["commit"],
                      "rows": sum(day["rows"] for day in daily.values()),
                      "missing_rows": sum(store.DAY // metrics.STEP - day["rows"] for day in daily.values()),
                      "empty": {name: sum(day["empty"][name] for day in daily.values()) for name in metrics.RATIOS},
                      "unpublished": item["unpublished"][symbol]})
    found = _held(market, commit, symbol, start_ms, end_ms, parts, "metrics")
    gaps = [[max(low, start_ms), min(low + store.DAY, end_ms)] for part in parts for day in part["unpublished"]
            if (low := series._day_ms(date.fromisoformat(day))) < end_ms and low + store.DAY > start_ms]
    merged: list[list[int]] = []
    for low, high in sorted(found["uncovered_intervals_ms"] + gaps):
        if merged and low <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], high)
        else:
            merged.append([low, high])
    return {"imports": parts, **found, "uncovered_intervals_ms": merged}


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
    """Every universe member of the months [start, end) touches, at the commit `at` names."""
    start_ms, end_ms = _ms(start), _ms(end)
    _interval(start_ms, end_ms)
    first = series._ms_day(start_ms).replace(day=1)
    last = series._ms_day(end_ms - 1).replace(day=1)
    market = versions.open_market(profile, "reader")
    commit = versions.resolve_commit(market, at)
    return sorted({symbol for month, symbol in universe.months_of(market, commit) if first <= month <= last})


def diagnose_coverage(profile: dict, at: str | None, symbols: list[str], start: str, end: str,
                      lifecycle_bundle: tuple[dict, dict[str, bytes]] | None) -> dict:
    """market.diagnose_coverage: coverage facts of an explicit contract list at the commit `at` names,
    with the validated lifecycle episodes of a given lifecycle bundle; never a partial result."""
    start_ms, end_ms = _ms(start), _ms(end)
    _interval(start_ms, end_ms)
    if not symbols or len(set(symbols)) != len(symbols):
        raise _refuse("the contract list is empty or repeats a contract", "EMPTY_SYMBOLS", missing=("symbols",))
    market = versions.open_market(profile, "reader")
    commit = versions.resolve_commit(market, at)
    episodes = None
    if lifecycle_bundle is not None:
        body, files = lifecycle_bundle
        episodes = lifecycle.validate_lifecycle(body, commit, files)
    found = []
    imports, trade_imports = (versions.imports(market, commit, store.QUOTES),
                              versions.imports(market, commit, store.TRADES))
    metrics_imports = versions.imports(market, commit, store.METRICS)
    for symbol in symbols:
        last = read_bars(market, commit, symbol, "LAST", start_ms, end_ms)
        mark = read_bars(market, commit, symbol, "MARK", start_ms, end_ms)
        funding = read_funding(market, commit, symbol, start_ms, end_ms)
        facts = coverage_facts(market, commit, symbol, start_ms, end_ms, last, mark, funding)
        terms = instrument.terms(market, commit, symbol)
        found.append({**facts, "funding": {**facts["funding"], **funding_spacing([at for at, _ in funding])},
                      "quotes": quote_facts(market, commit, symbol, start_ms, end_ms, imports),
                      "trades": trade_facts(market, commit, symbol, start_ms, end_ms, trade_imports),
                      "metrics": metrics_facts(market, commit, symbol, start_ms, end_ms, metrics_imports),
                      "terms": {key: value for key, value in terms.items() if key != "symbol"}})
    return {"commit": commit, "scope": "explicit_symbols", "input_interval_ms": [start_ms, end_ms], "coverage": found,
            "lifecycle": None if episodes is None else {symbol: episodes.get(symbol, []) for symbol in symbols},
            "lifecycle_missing": [] if episodes is None else [symbol for symbol in symbols if symbol not in episodes],
            "interpretation": INTERPRETATION}

