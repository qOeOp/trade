"""The one place the report readers reach code of other packages: the market's daily returns
(market.daily_returns), reproducing a sealed run (replay.reproduce) and the engine's native report
comparison (engine.compare_reports).

`current` holds the implementations in force. The market default reads the run's market database
through its profile in the ledger profile directory. Tests swap them with `use(...)`.
"""

from __future__ import annotations

from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass, replace
from datetime import datetime
import json
from pathlib import Path

from ledger import db
from ledger.refusals import refuse


def _market_profile(database: str | None = None) -> dict:
    """The market database profile in the ledger profile directory (kind or holds `market`) holding
    `database`, or the active one."""
    found = []
    for path in sorted(db.home().glob("*.json")):
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if isinstance(value, dict) and "market" in (value.get("kind"), value.get("holds")):
            found.append(value)
    for value in found:
        if (value.get("database") == database) if database else value.get("role", value.get("kind")) == "active":
            return value
    raise refuse("MARKET_RETURNS_UNAVAILABLE", f"no market profile for database {database or '(the active one)'} in the "
                 "ledger profile directory", missing=("market profile",))


def _market_returns(market_database: str | None, commit: str | None, universe_rule: str | None, start: datetime,
                    end: datetime) -> dict:
    """market.daily_returns on the run's market database (read only). The values are the run's stored
    input identity, which may lack them: the reader refuses a missing commit or universe rule."""
    from market import read, store
    try:
        return read.daily_returns(_market_profile(market_database), commit, universe_rule, start, end)
    except store.MarketError as exc:
        raise refuse("MARKET_RETURNS_UNAVAILABLE", f"{exc.code}: {exc.message}", missing=exc.missing) from exc


def _reproduce(run_id: int, output: Path, ledger: db.LedgerProfile) -> dict:
    from registration import seams as registration_seams
    from replay import reproduce
    return reproduce.reproduce(run_id, output, ledger=ledger,
                               market=registration_seams.current.market(_market_profile()))


def _compare_reports(reference: Path, candidate: Path) -> dict:
    from engine.compare_reports import compare_reports
    return compare_reports(Path(reference), Path(candidate))


@dataclass(frozen=True)
class Seams:
    market_returns: Callable[[str | None, str | None, str | None, datetime, datetime], dict]
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
