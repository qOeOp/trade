"""Market reads for the report (`market.daily_returns`) and for source reviewers (`market.stored_bars`).

The day's close is the MARK one-minute bar opening at 23:59 UTC; a day's return is that close over
the previous day's, minus one. The basket weighs equally the members of the day's month that have a
return that day (a member that stops trading drops out after its last return). Members are the
contracts the market directory holds that meet the universe rule; a deployment that narrows the
directory (`--bar-symbols`) narrows the basket to that list. Stored bars are the
exporter's own reads (`market.read_bars`, `market.daily_bars`, `market.read_funding`) at a pinned
commit, each bar with the time the Catalog stamps it. Only the market directory is read; nothing here
knows the ledger or the strategy.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import pyarrow as pa
import pyarrow.compute as pc

from market import coverage, export, files, instrument, series, store, universe
from market.sources import DAY as DAY_MS, MINUTE, _refuse


DAY = timedelta(days=1)
CLOSE_OFFSET_MS = DAY_MS - 60_000  # the open time of a day's last one-minute bar
BTC = "BTCUSDT"


def _utc_day(moment: datetime) -> datetime:
    moment = moment.replace(tzinfo=timezone.utc) if moment.tzinfo is None else moment.astimezone(timezone.utc)
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


def daily_returns(profile: dict, commit: str, universe_rule: str | None, start: datetime,
                  end: datetime) -> dict:
    """market.daily_returns: the BTC perpetual's and the held members' equal-weight UTC daily returns over
    [start, end) at a market commit."""
    first, last = _utc_day(start), _utc_day(end)
    days = []
    while first < last:
        days.append(first.date().isoformat())
        first += DAY
    if not days:
        raise _refuse("the window holds no whole UTC day", "MARKET_RETURNS_WINDOW", missing=("window",))
    market = files.open_market(profile, "reader")
    commit = store.check_commit(files.resolve_commit(market, store.check_commit(commit)))
    rule = universe.rule_of(market, commit)
    if rule != universe_rule:
        raise _refuse(f"market commit {commit} produces {rule}, not {universe_rule}", "RULE_VERSION_MISMATCH",
                      missing=("universe_rule",))
    months = {day[:7] for day in days}
    members: dict[str, set[str]] = {}
    for month, symbol in universe.months_of(market, commit):
        if month.strftime("%Y-%m") in months:
            members.setdefault(month.strftime("%Y-%m"), set()).add(symbol)
    symbols = sorted({BTC, *(symbol for found in members.values() for symbol in found)})
    first_close = int((datetime.fromisoformat(days[0]).replace(tzinfo=timezone.utc) - DAY).timestamp()) * 1000 \
        + CLOSE_OFFSET_MS
    closes: dict[str, dict[str, int]] = {}
    for batch in files.scan(market, commit, "bar", symbols, first_close, first_close + len(days) * DAY_MS + MINUTE):
        marks = batch.filter(pc.equal(batch.column("price_type"), "MARK"))
        found = marks.filter(pa.array(marks.column("ts_open").to_numpy() % DAY_MS == CLOSE_OFFSET_MS))
        for symbol, ts_open, close in zip(*(found.column(name).to_pylist() for name in ("symbol", "ts_open", "close")),
                                          strict=True):
            closes.setdefault(symbol, {})[datetime.fromtimestamp(ts_open // 1000, timezone.utc).date().isoformat()] = close
    return {**returns_from(closes, members, days), "commit": commit, "universe_rule": universe_rule}


# market.stored_bars

BAR_COLUMNS = ("ts_open_ms", "ts_event_ms", "open", "high", "low", "close", "volume")
FUNDING_COLUMNS = ("funding_time_ms", "rate")
STEPS = {"1m": MINUTE, "1d": DAY_MS}


def _iso(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _scaled(value: int, scale: int) -> str:
    return format(Decimal(int(value)).scaleb(-scale), "f")


def stored_bars(profile: dict, at: str | None, symbol: str, price_type: str, timeframe: str, start: str, end: str,
                limit: int | None) -> dict:
    """market.stored_bars: one contract's stored bars in [start, end) at the commit `at` names, as the
    exporter reads them: one-minute LAST or MARK bars, or the complete UTC daily LAST bars derived from
    the stored minutes (the export's daily warm-up), with the funding settlements of the same interval.
    With `limit`, at most that many bar periods from `start`; `next_start` then names where the rest begins."""
    start_ms, end_ms = coverage._ms(start), coverage._ms(end)
    coverage._interval(start_ms, end_ms)
    step = STEPS[timeframe]
    if timeframe == "1d" and (start_ms % DAY_MS or end_ms % DAY_MS):
        raise _refuse(f"[{start}, {end}) is not whole UTC days", "INTERVAL_INVALID", missing=("start", "end"))
    if timeframe == "1d" and price_type != "LAST":
        raise _refuse(f"daily bars are LAST bars, not {price_type}", "INTERVAL_INVALID", missing=("price_type",))
    stop = end_ms if limit is None else min(end_ms, start_ms + limit * step)
    market = files.open_market(profile, "reader")
    commit = files.resolve_commit(market, at)
    instrument.terms(market, commit, symbol)
    price_scale, volume_scale = series.PRICE_SCALE, series.VOLUME_SCALE
    if timeframe == "1d":
        bars = export.daily_bars(market, commit, symbol, start_ms, None, stop)
    else:
        bars = coverage.read_bars(market, commit, symbol, price_type, start_ms, stop)
    funding = coverage.read_funding(market, commit, symbol, start_ms, stop)
    rows = [[opened, opened + step - 1, *(_scaled(value, price_scale) for value in prices), _scaled(volume, volume_scale)]
            for opened, *prices, volume in zip(*(bars[name].tolist() for name in coverage.COLUMNS), strict=True)]
    return {"commit": commit, "symbol": symbol, "price_type": price_type, "timeframe": timeframe,
            "interval": {"start": _iso(start_ms), "end": _iso(stop), "ms": [start_ms, stop]},
            "next_start": _iso(stop) if stop < end_ms else None,
            "bars": {"columns": list(BAR_COLUMNS), "count": len(rows), "rows": rows},
            "funding": {"columns": list(FUNDING_COLUMNS), "count": len(funding),
                        "rows": [[at, format(rate.normalize(), "f")] for at, rate in funding]}}
