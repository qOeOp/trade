"""Market reads for the report (`market.daily_returns`).

The day's close is the MARK one-minute bar opening at 23:59 UTC; a day's return is that close over
the previous day's, minus one. The basket weighs equally the members of the day's month that have a
return that day (a member that stops trading drops out after its last return). Only the market
database is read; nothing here knows the ledger or the strategy.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from market import store, universe
from market.sources import _refuse


DAY = timedelta(days=1)
DAY_MS = 86_400_000
CLOSE_OFFSET_MS = DAY_MS - 60_000  # the open time of a day's last one-minute bar
BTC = "BTCUSDT"


def _utc_day(moment: datetime) -> datetime:
    moment = moment.replace(tzinfo=timezone.utc) if moment.tzinfo is None else moment.astimezone(timezone.utc)
    return moment.replace(hour=0, minute=0, second=0, microsecond=0)


def returns_from(closes: dict[str, dict[str, int]], members: dict[str, set[str]], days: list[str]) -> dict:
    """{days, btc, basket, members_per_day} from day closes by symbol and members by month; None where a
    day has no return."""
    previous = {day: (date.fromisoformat(day) - DAY).isoformat() for day in days}

    def ret(symbol: str, day: str) -> float | None:
        series = closes.get(symbol) or {}
        now, before = series.get(day), series.get(previous[day])
        return None if now is None or before is None or before == 0 else now / before - 1

    btc, basket, counts = [], [], []
    for day in days:
        btc.append(ret(BTC, day))
        found = [value for symbol in sorted(members.get(day[:7], ())) if (value := ret(symbol, day)) is not None]
        basket.append(sum(found) / len(found) if found else None)
        counts.append(len(found))
    return {"days": list(days), "btc": btc, "basket": basket, "members_per_day": counts}


def daily_returns(profile: dict, commit: str | None, universe_rule: str | None, start: datetime,
                  end: datetime) -> dict:
    """market.daily_returns: the BTC perpetual's and the common tradable range's equal-weight UTC daily
    returns over [start, end) at a market commit."""
    first, last = _utc_day(start), _utc_day(end)
    days = []
    while first < last:
        days.append(first.date().isoformat())
        first += DAY
    if not days:
        raise _refuse("the window holds no whole UTC day", "MARKET_RETURNS_WINDOW", missing=("window",))
    with store.connect(profile, "reader") as conn:
        commit = store.check_commit(store.resolve_commit(conn, store.check_commit(commit)))
        (rule,), = conn.rows(f"SELECT universe_rule FROM market_schema AS OF '{commit}'")
        if rule != universe_rule:
            raise _refuse(f"market commit {commit} produces {rule}, not {universe_rule}", "RULE_VERSION_MISMATCH",
                          missing=("universe_rule",))
        months = {day[:7] for day in days}
        members: dict[str, set[str]] = {}
        for month, symbol in universe.months_of(conn, commit):
            if month.strftime("%Y-%m") in months:
                members.setdefault(month.strftime("%Y-%m"), set()).add(symbol)
        symbols = sorted({BTC, *(symbol for found in members.values() for symbol in found)})
        stamps = [int((datetime.fromisoformat(days[0]).replace(tzinfo=timezone.utc) - DAY).timestamp()) * 1000
                  + CLOSE_OFFSET_MS]
        stamps += [int(datetime.fromisoformat(day).replace(tzinfo=timezone.utc).timestamp()) * 1000 + CLOSE_OFFSET_MS
                   for day in days]
        marks = ", ".join(["%s"] * len(stamps))
        closes: dict[str, dict[str, int]] = {}
        for symbol in symbols:
            for ts_open, close in conn.rows(f"SELECT ts_open, close FROM bar AS OF '{commit}' WHERE symbol = %s AND "
                                            f"price_type = 'MARK' AND ts_open IN ({marks})", (symbol, *stamps)):
                closes.setdefault(symbol, {})[datetime.fromtimestamp(ts_open // 1000, timezone.utc).date().isoformat()] \
                    = close
    return {**returns_from(closes, members, days), "commit": commit, "universe_rule": universe_rule}
