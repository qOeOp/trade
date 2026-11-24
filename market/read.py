"""Market reads for the report (`market.daily_returns`), for source reviewers (`market.stored_bars`) and for
registration (`market.freshness`).

The day's close is the MARK one-minute bar opening at 23:59 UTC; a day's return is that close over
the previous day's, minus one. The basket weighs equally the members of the day's month that have a
return that day (a member that stops trading drops out after its last return). Members are the
contracts the market directory holds that meet the universe rule: every eligible contract by default; a
deployment that narrows the directory (`--bar-symbols`) narrows the basket to that list. Stored bars are the
exporter's own reads (`market.read_bars`, `market.daily_bars`, `market.read_funding`) at a pinned
market day, each bar with the time the Catalog stamps it. Only the market directory is read; nothing here
knows the ledger or the strategy.
"""

from __future__ import annotations

from collections.abc import Iterator
from datetime import date, datetime, timedelta, UTC
from decimal import Decimal

import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.parquet as pq

from market import coverage, files, history, instrument, series, universe
from market.sources import DAY as DAY_MS, MINUTE
from shared import clock
from shared.refusals import refuse


DAY = timedelta(days=1)
CLOSE_OFFSET_MS = DAY_MS - 60_000  # the open time of a day's last one-minute bar
BTC = "BTCUSDT"


def _utc_day(moment: datetime) -> datetime:
    moment = moment.replace(tzinfo=UTC) if moment.tzinfo is None else moment.astimezone(UTC)
    return moment.replace(hour=0, minute=0, second=0, microsecond=0)


def returns_from(closes: dict[str, dict[str, int]], members: dict[str, set[str]], days: list[str]) -> dict:
    """{days, btc, basket} from day closes by symbol and members by month; None where a day has no return."""
    previous = {day: (date.fromisoformat(day) - DAY).isoformat() for day in days}

    def ret(symbol: str, day: str) -> float | None:
        series = closes.get(symbol) or {}
        now, before = series.get(day), series.get(previous[day])
        return None if now is None or before is None or before == 0 else now / before - 1

    btc, basket = [], []
    for day in days:
        btc.append(ret(BTC, day))
        found = [value for symbol in sorted(members.get(day[:7], ())) if (value := ret(symbol, day)) is not None]
        basket.append(sum(found) / len(found) if found else None)
    return {"days": list(days), "btc": btc, "basket": basket}


def _day_closes(market: files.Market, market_day: str, symbols: list[str], start_ms: int,
                end_ms: int) -> Iterator[pa.RecordBatch]:
    """The MARK bars opening at 23:59 UTC that files.scan would give for the request. The integer time filter, which
    keeps one row in 1440, runs before any string is compared, and the strings are read as dictionaries: comparing
    them row by row is most of a scan's cost."""
    schema = files.BAR.schema
    texts = [name for name in schema.names if schema.field(name).type == files.STRING]
    end_ms = min(end_ms, files.day_end("bar", market_day))
    wanted = pa.array(symbols, files.STRING)
    for entry in files.entries(market, "bar", symbols, start_ms, end_ms):
        reader = pq.ParquetFile(pa.BufferReader(files.file_bytes(market, entry)), read_dictionary=texts)
        for batch in reader.iter_batches():
            times = batch.column("ts_open").to_numpy()
            closing = (times % DAY_MS == CLOSE_OFFSET_MS) & (times >= start_ms) & (times < end_ms)
            found = batch.filter(pa.array(closing)).cast(schema)
            yield found.filter(pc.and_(pc.equal(found.column("price_type"), "MARK"),
                                       pc.is_in(found.column("symbol"), wanted)))


def daily_returns(profile: dict, market_day: str, universe_rule: str | None, start: datetime,
                  end: datetime) -> dict:
    """market.daily_returns: the BTC perpetual's and the held members' equal-weight UTC daily returns over
    [start, end) at a market day."""
    first, last = _utc_day(start), _utc_day(end)
    days = []
    while first < last:
        days.append(first.date().isoformat())
        first += DAY
    if not days:
        raise refuse("MARKET_RETURNS_WINDOW", "the window holds no whole UTC day", missing=("window",))
    market = files.open_market(profile, "reader")
    market_day = files.resolve_day(market, files.check_day(market_day))
    rule = universe.rule_of(market, market_day)
    if rule != universe_rule:
        raise refuse("RULE_VERSION_MISMATCH", f"market day {market_day} produces {rule}, not {universe_rule}",
                     missing=("universe_rule",))
    months = {day[:7] for day in days}
    members: dict[str, set[str]] = {}
    for month, symbol in universe.months_of(market, market_day):
        if month.strftime("%Y-%m") in months:
            members.setdefault(month.strftime("%Y-%m"), set()).add(symbol)
    symbols = sorted({BTC, *(symbol for found in members.values() for symbol in found)})
    first_close = clock.day_ms(date.fromisoformat(days[0]) - DAY) + CLOSE_OFFSET_MS
    closes: dict[str, dict[str, int]] = {}
    for found in _day_closes(market, market_day, symbols, first_close, first_close + len(days) * DAY_MS + MINUTE):
        for symbol, ts_open, close in zip(*(found.column(name).to_pylist() for name in ("symbol", "ts_open", "close")),
                                          strict=True):
            closes.setdefault(symbol, {})[clock.ms_day(ts_open).isoformat()] = close
    return {**returns_from(closes, members, days), "market_day": market_day, "universe_rule": universe_rule}


# market.stored_bars

BAR_COLUMNS = ("ts_open_ms", "ts_event_ms", "open", "high", "low", "close", "volume")
FUNDING_COLUMNS = ("funding_time_ms", "rate")
STEPS = {"1m": MINUTE, "1d": DAY_MS}


def _iso(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000, UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def _scaled(value: int, scale: int) -> str:
    return format(Decimal(int(value)).scaleb(-scale), "f")


def stored_bars(profile: dict, at: str | None, symbol: str, price_type: str, timeframe: str, start: str, end: str,
                limit: int | None, *, funding: bool = True) -> dict:
    """market.stored_bars: one contract's stored bars in [start, end) at the market day `at` names, as the
    exporter reads them: one-minute LAST or MARK bars, or the complete UTC daily LAST bars derived from
    the stored minutes (the export's daily warm-up), with the funding settlements of the same interval
    (without `funding`, the bars alone). With `limit`, at most that many bar periods from `start`;
    `next_start` then names where the rest begins."""
    start_ms, end_ms = coverage._ms(start), coverage._ms(end)
    coverage._interval(start_ms, end_ms)
    step = STEPS[timeframe]
    if timeframe == "1d" and (start_ms % DAY_MS or end_ms % DAY_MS):
        raise refuse("INTERVAL_INVALID", f"[{start}, {end}) is not whole UTC days", missing=("start", "end"))
    if timeframe == "1d" and price_type != "LAST":
        raise refuse("INTERVAL_INVALID", f"daily bars are LAST bars, not {price_type}", missing=("price_type",))
    stop = end_ms if limit is None else min(end_ms, start_ms + limit * step)
    market = files.open_market(profile, "reader")
    market_day = files.resolve_day(market, at)
    instrument.terms(market, market_day, symbol)
    if timeframe == "1d":
        bars = history.daily_bars(market, market_day, symbol, start_ms, None, stop)
    else:
        bars = coverage.read_bars(market, market_day, symbol, price_type, start_ms, stop)
    rows = [[opened, opened + step - 1, *(_scaled(value, series.PRICE_SCALE) for value in prices),
             _scaled(volume, series.VOLUME_SCALE)]
            for opened, *prices, volume in zip(*(bars[name].tolist() for name in series.COLUMNS), strict=True)]
    found = {"market_day": market_day, "symbol": symbol, "price_type": price_type, "timeframe": timeframe,
             "interval": {"start": _iso(start_ms), "end": _iso(stop), "ms": [start_ms, stop]},
             "next_start": _iso(stop) if stop < end_ms else None,
             "bars": {"columns": list(BAR_COLUMNS), "count": len(rows), "rows": rows}}
    if funding:
        settlements = coverage.read_funding(market, market_day, symbol, start_ms, stop)
        found["funding"] = {"columns": list(FUNDING_COLUMNS), "count": len(settlements),
                            "rows": [[at, format(rate.normalize(), "f")] for at, rate in settlements]}
    return found


# market.freshness

def freshness(profile: dict, ref: str | None = None) -> dict:
    """market.freshness: a market day's universe months and its latest complete UTC day (the day before the one
    holding the newest LAST minute's end)."""
    market = files.open_market(profile, "reader")
    market_day = files.resolve_day(market, ref)
    months = sorted({month for month, _ in universe.months_of(market, market_day)})
    if not months:
        raise refuse("MARKET_EMPTY", f"market day {market_day} has no universe month", missing=(market_day,))
    newest = None
    # A table's files are disjoint in time: the newest minute is in the latest file holding a LAST bar.
    high = files._visible("bar", market_day, None)
    for entry in reversed(files.entries(market, "bar", None, None, high)):
        for batch in files.file_batches(files.file_bytes(market, entry), files.BAR, None, None, high):
            opens = batch.filter(pc.equal(batch.column("price_type"), "LAST")).column("ts_open")
            if len(opens):
                newest = max(newest or 0, pc.max(opens).as_py())
        if newest is not None:
            break
    complete_day = clock.ms_day(newest + MINUTE) - timedelta(days=1) if newest is not None else None
    return {"market_day": market_day, "universe_months": [value.strftime("%Y-%m") for value in months],
            "latest_complete_day": complete_day}
