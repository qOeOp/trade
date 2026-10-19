"""The one place the report readers reach code of other packages: the market's daily returns
(market.daily_returns), reproducing a sealed run (replay.reproduce) and the engine's native report
comparison (engine.compare_reports).

`current` holds the implementations in force. The market default reads today's market database
(`market`: the MARK one-minute bar at 23:59 UTC of each day, the ranked monthly pool as the
common tradable range) through the market profile in the ledger profile directory; the market and
engine packages of a later phase replace it here. Tests swap them with `use(...)`.
"""

from __future__ import annotations

from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass, replace
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path

from ledger import db
from ledger.refusals import refuse


DAY = timedelta(days=1)
DAY_MS = 86_400_000
CLOSE_OFFSET_MS = DAY_MS - 60_000  # the open time of a day's last one-minute bar
BTC = "BTCUSDT"


def _market_profile() -> dict:
    """The market database profile in the ledger profile directory (kind or holds `market`)."""
    for path in sorted(db.home().glob("*.json")):
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if isinstance(value, dict) and "market" in (value.get("kind"), value.get("holds")):
            return value
    raise refuse("MARKET_RETURNS_UNAVAILABLE", "no market database profile in the ledger profile directory",
                 missing=("market profile",))


def _utc_day(moment: datetime) -> datetime:
    moment = moment.replace(tzinfo=timezone.utc) if moment.tzinfo is None else moment.astimezone(timezone.utc)
    return moment.replace(hour=0, minute=0, second=0, microsecond=0)


def daily_returns_from(closes: dict[str, dict[str, int]], members: dict[str, set[str]], days: list[str]) -> dict:
    """{days, btc, basket, members_per_day}: each symbol's return of day d is its close of d over its
    close of the day before, minus one; the basket weighs equally the members of d's month that have
    one (a member that stops trading drops out after its last return). None where none exists."""
    previous = {day: (datetime.fromisoformat(day) - DAY).date().isoformat() for day in days}

    def ret(symbol: str, day: str) -> float | None:
        series = closes.get(symbol) or {}
        now, before = series.get(day), series.get(previous[day])
        return None if now is None or before in (None, 0) else now / before - 1

    btc, basket, counts = [], [], []
    for day in days:
        btc.append(ret(BTC, day))
        found = [value for symbol in sorted(members.get(day[:7], ())) if (value := ret(symbol, day)) is not None]
        basket.append(sum(found) / len(found) if found else None)
        counts.append(len(found))
    return {"days": list(days), "btc": btc, "basket": basket, "members_per_day": counts}


def _market_returns(commit: str, universe_rule: str, start: datetime, end: datetime) -> dict:
    """market.daily_returns on today's market database (read only)."""
    from research.records import db as records_db
    from registration import seams as registration_seams
    profile = _market_profile()
    market = registration_seams.CurrentMarket(profile)
    if market.universe_rule(commit) != universe_rule:
        raise refuse("MARKET_RETURNS_UNAVAILABLE", f"market commit {commit} is not under universe rule {universe_rule}",
                     missing=("universe_rule",))
    first, last = _utc_day(start), _utc_day(end)
    days = []
    while first < last:
        days.append(first.date().isoformat())
        first += DAY
    if not days:
        raise refuse("MARKET_RETURNS_UNAVAILABLE", "the window holds no whole UTC day", missing=("window",))
    months = {day[:7] for day in days}
    members: dict[str, set[str]] = {}
    for month, symbol in market.universe_month(commit):
        if month in months:
            members.setdefault(month, set()).add(symbol)
    symbols = sorted({BTC, *(symbol for found in members.values() for symbol in found)})
    stamps = [int((datetime.fromisoformat(day).replace(tzinfo=timezone.utc) - DAY).timestamp()) * 1000
              + CLOSE_OFFSET_MS for day in days[:1]]
    stamps += [int(datetime.fromisoformat(day).replace(tzinfo=timezone.utc).timestamp()) * 1000 + CLOSE_OFFSET_MS
               for day in days]
    ref = db.check_ref(commit)
    closes: dict[str, dict[str, int]] = {}
    conn = records_db.connect(profile, "reader")
    try:
        marks = ", ".join(["%s"] * len(stamps))
        for symbol in symbols:
            for ts_open, close in records_db.rows(conn, f"SELECT ts_open, close FROM bar AS OF '{ref}' WHERE symbol = %s "
                                                        f"AND price_type = 'MARK' AND ts_open IN ({marks})",
                                                  (symbol, *stamps)):
                day = datetime.fromtimestamp(ts_open // 1000, timezone.utc).date().isoformat()
                closes.setdefault(symbol, {})[day] = close
    finally:
        conn.close()
    return {**daily_returns_from(closes, members, days), "commit": commit, "universe_rule": universe_rule}


def _reproduce(run_id: int, output: Path, ledger: db.LedgerProfile) -> dict:
    from registration import seams as registration_seams
    from replay import reproduce
    return reproduce.reproduce(run_id, output, ledger=ledger,
                               market=registration_seams.current.market(_market_profile()))


def _compare_reports(reference: Path, candidate: Path) -> dict:
    from engine import compare_reports
    return compare_reports.compare(Path(reference), Path(candidate))


@dataclass(frozen=True)
class Seams:
    market_returns: Callable[[str, str, datetime, datetime], dict]
    reproduce: Callable[[int, Path, db.LedgerProfile], dict]
    compare_reports: Callable[[Path, Path], dict]


DEFAULT = Seams(market_returns=_market_returns, reproduce=_reproduce, compare_reports=_compare_reports)
current = DEFAULT


@contextmanager
def use(**overrides) -> Iterator[Seams]:
    """Replace some implementations for the duration of the block (tests and later-phase wiring)."""
    global current
    previous = current
    current = replace(current, **overrides)
    try:
        yield current
    finally:
        current = previous
