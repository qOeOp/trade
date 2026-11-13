"""The report readers' market reads, which tests and report.graph swap: the market's daily returns
(market.daily_returns) and whether the active market holds a market day (market.resolve_day).

`current` holds the implementations in force. The market default reads the run's market through its
profile in the ledger profile directory. Tests swap them with `use(...)`.
"""

from __future__ import annotations

from collections.abc import Callable, Iterator
from contextlib import contextmanager
import copy
from dataclasses import dataclass, replace
from datetime import datetime
import functools

from shared import profiles
from shared.errors import Refusal
from shared.refusals import refuse


def _market_profile(database: str | None = None) -> dict:
    """The market profile in the ledger profile directory named `database` (a run's market_database), or the
    active one."""
    try:
        return profiles.market(database)
    except Refusal:
        raise refuse("MARKET_RETURNS_UNAVAILABLE", f"no market profile {database or '(the active one)'} in the "
                     "ledger profile directory", missing=("market profile",)) from None


def _market_returns(market_database: str | None, market_day: str | None, universe_rule: str | None, start: datetime,
                    end: datetime) -> dict:
    """market.daily_returns on the run's market (read only). The values are the run's stored
    input identity, which may lack them: the reader refuses a missing market day or universe rule."""
    from market import read
    from market.sources import MarketError
    try:
        return read.daily_returns(_market_profile(market_database), market_day or "", universe_rule, start, end)
    except MarketError as exc:
        raise refuse("MARKET_RETURNS_UNAVAILABLE", f"{exc.code}: {exc.message}", missing=exc.missing) from exc


def _market_day(ref: str) -> dict | None:
    """market.resolve_day of `ref` on the active market: {database (its name), market_day}, market_day None when
    it holds no such version (UNKNOWN_REF). None when the active market cannot be read (no profile, its
    directory unreachable): registration then refuses on its own."""
    from market import files
    from market.sources import MarketError
    try:
        profile = _market_profile()
        return {"database": profile["name"], "market_day": files.resolve_day(files.open_market(profile, "reader"), ref)}
    except Refusal:
        return None
    except MarketError as exc:
        return {"database": profile["name"], "market_day": None} if exc.code == "UNKNOWN_REF" else None


@dataclass(frozen=True)
class Seams:
    market_returns: Callable[[str | None, str | None, str | None, datetime, datetime], dict]
    market_day: Callable[[str], dict | None]


DEFAULT = Seams(market_returns=_market_returns, market_day=_market_day)
current = DEFAULT


@contextmanager
def use(**overrides) -> Iterator[Seams]:
    """Replace some implementations for the duration of the block (tests, and report.graph's reuse of
    market returns)."""
    global current
    previous = current
    current = replace(current, **overrides)
    try:
        yield current
    finally:
        current = previous


def reusing(read: Callable, noted: Callable[[Exception], None] = lambda exc: None) -> Callable:
    """`read` (market_returns) answering a repeated window from its first answer: a market day is immutable,
    so one reading reads each window once instead of once per comparison. Failures are not kept: `noted` sees
    each one before it propagates. Every caller gets its own copy."""
    answers: dict = {}

    def market_returns(*window):
        if window not in answers:
            try:
                answers[window] = read(*window)
            except Exception as exc:
                noted(exc)
                raise
        return copy.deepcopy(answers[window])
    return market_returns


def reading_once(function: Callable) -> Callable:
    """`function` reading each market window once per call (reusing)."""
    @functools.wraps(function)
    def wrapped(*args, **kwargs):
        with use(market_returns=reusing(current.market_returns)):
            return function(*args, **kwargs)
    return wrapped
