"""The user's two research targets (`ledger.targets_for`; `ledger.set_targets` is in ledger.lines).

Targets are a maximum drawdown and a minimum annual return, bound to one research line or, with no
line, to the whole ledger as its default. They are the user's: they are recorded only as the user
states them, and they guide reading reports, never candidate eligibility. A change appends a row
superseding the one in force for the same scope, so the history stays and the targets in force are
the end of that chain; the schema keeps one chain per scope (scope 0 is the default). A line reads its own
targets, else the default, else none. Only an open line takes new targets.
"""

from __future__ import annotations

from collections.abc import Callable
from decimal import Decimal, InvalidOperation
import math

from ledger import db
from shared.refusals import refuse


TABLE = "line_target"
PLACES = Decimal("0.0001")  # DECIMAL(7,4)


def _value(name: str, value, below_one: bool) -> Decimal:
    try:
        number = float(value)
    except (TypeError, ValueError):
        number = math.nan
    try:
        found = Decimal(str(number)).quantize(PLACES) if math.isfinite(number) else None
    except InvalidOperation:
        found = None
    if found is None or found <= 0 or (below_one and found >= 1) or found >= 1000:
        raise refuse("TARGETS_INVALID", f"{name} {value!r} is not a fraction in range",
                     expected=f"{name} as a fraction, 0 < {name}" + (" < 1" if below_one else " < 1000"))
    return found


def check(max_drawdown, annual_return) -> tuple[Decimal, Decimal]:
    """The targets as stored (four decimal places), or TARGETS_INVALID."""
    return _value("max_drawdown", max_drawdown, True), _value("annual_return", annual_return, False)


def _tips(conn: db.LedgerConnection, scopes: tuple[int, ...] | None = None) -> dict[int, dict]:
    """The rows in force (the ones no later row supersedes) by scope, for `scopes` or every scope."""
    where = f" AND t.scope_key IN ({db.marks(scopes)})" if scopes else ""
    return {row["scope_key"]: row for row in conn.dicts(
        f"SELECT target_id, line_id, scope_key, max_drawdown, annual_return, created_at FROM {TABLE} t "
        f"WHERE NOT EXISTS (SELECT 1 FROM {TABLE} n WHERE n.supersedes = t.target_id){where}", scopes or ())}


def tip(conn: db.LedgerConnection, line_id: int | None) -> dict | None:
    """The row in force for one scope: the one no later row supersedes."""
    return _tips(conn, (line_id or 0,)).get(line_id or 0)


def reading(row: dict, source: str) -> dict:
    return {"max_drawdown": float(row["max_drawdown"]), "annual_return": float(row["annual_return"]),
            "source": source, "target_id": row["target_id"], "created_at": row["created_at"]}


def _in_force(tips: dict[int, dict], line_id: int | None) -> dict | None:
    own = tips.get(line_id) if line_id is not None else None
    if own is not None:
        return reading(own, "line")
    return reading(tips[0], "default") if 0 in tips else None


def targets_for(conn: db.LedgerConnection, line_id: int | None) -> dict | None:
    """{max_drawdown, annual_return, source (line or default), target_id, created_at} in force for
    line `line_id` at the version this connection reads, or None when neither the line nor the ledger has any."""
    return _in_force(_tips(conn, (line_id or 0, 0)), line_id)


def targets_by_line(conn: db.LedgerConnection) -> Callable[[int | None], dict | None]:
    """targets_for for any line, from one read of every scope's targets in force."""
    tips = _tips(conn)
    return lambda line_id: _in_force(tips, line_id)
