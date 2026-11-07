"""The one place the report readers reach code of other packages: the market's daily returns
(market.daily_returns), whether the active market holds a commit (market.resolve_commit), reproducing a sealed run (replay.reproduce) and the engine's native report
comparison (engine.compare_reports).

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
import json

from ledger import db
from ledger.errors import Refusal
from ledger.refusals import refuse


def _market_profile(database: str | None = None) -> dict:
    """The market profile in the ledger profile directory (kind or holds `market`) named `database` (a run's
    market_database), or the active one."""
    found = []
    for path in sorted(db.home().glob("*.json")):
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if isinstance(value, dict) and value.get("kind") == "market" and (
                value.get("name") == database if database else value.get("role") == "active"):
            found.append(value)
    if found:
        return found[0]
    raise refuse("MARKET_RETURNS_UNAVAILABLE", f"no market profile {database or '(the active one)'} in the ledger "
                 "profile directory", missing=("market profile",))


def _market_returns(market_database: str | None, commit: str | None, universe_rule: str | None, start: datetime,
                    end: datetime) -> dict:
    """market.daily_returns on the run's market (read only). The values are the run's stored
    input identity, which may lack them: the reader refuses a missing commit or universe rule."""
    from market import read
    from market.sources import MarketError
    try:
        return read.daily_returns(_market_profile(market_database), commit or "", universe_rule, start, end)
    except MarketError as exc:
        raise refuse("MARKET_RETURNS_UNAVAILABLE", f"{exc.code}: {exc.message}", missing=exc.missing) from exc


def _market_commit(ref: str) -> dict | None:
    """market.resolve_commit of `ref` on the active market: {database (its name), commit}, commit None when
    it holds no such version (UNKNOWN_REF). None when the active market cannot be read (no profile, its
    directory unreachable): registration then refuses on its own."""
    from market import files
    from market.sources import MarketError
    try:
        profile = _market_profile()
        return {"database": profile["name"], "commit": files.resolve_commit(files.open_market(profile, "reader"), ref)}
    except Refusal:
        return None
    except MarketError as exc:
        return {"database": profile["name"], "commit": None} if exc.code == "UNKNOWN_REF" else None


@dataclass(frozen=True)
class Seams:
    market_returns: Callable[[str | None, str | None, str | None, datetime, datetime], dict]
    market_commit: Callable[[str], dict | None]


DEFAULT = Seams(market_returns=_market_returns, market_commit=_market_commit)
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


def reusing(read: Callable, noted: Callable[[Exception], None] = lambda exc: None) -> Callable:
    """`read` (market_returns) answering a repeated window from its first answer: a market commit is immutable,
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
