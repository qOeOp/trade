"""The user's two research targets (`ledger.targets_for`, `ledger.set_targets`).

Targets are a maximum drawdown and a minimum annual return, bound to one research line or, with no
line, to the whole ledger as its default. They are the user's: they are recorded only as the user
states them, and they guide reading reports, never candidate eligibility. A change appends a row
superseding the one in force for the same scope, so the history stays and the targets in force are
the end of that chain; the schema keeps one chain per scope (scope 0 is the default). A line reads its own
targets, else the default, else none. Only an open line takes new targets.
"""

from __future__ import annotations

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


def _tip(conn: db.LedgerConnection, line_id: int | None) -> dict | None:
    """The row in force for one scope: the one no later row supersedes."""
    return conn.one(f"SELECT target_id, line_id, max_drawdown, annual_return, created_at FROM {TABLE} t "
                    f"WHERE t.scope_key = %s AND NOT EXISTS (SELECT 1 FROM {TABLE} n WHERE n.supersedes = t.target_id)",
                    (line_id or 0,))


def _reading(row: dict, source: str) -> dict:
    return {"max_drawdown": float(row["max_drawdown"]), "annual_return": float(row["annual_return"]),
            "source": source, "target_id": row["target_id"], "created_at": row["created_at"]}


def targets_for(conn: db.LedgerConnection, line_id: int | None) -> dict | None:
    """{max_drawdown, annual_return, source (line or default), target_id, created_at} in force for
    line `line_id` at the version this connection reads, or None when neither the line nor the ledger has any."""
    own = _tip(conn, line_id) if line_id is not None else None
    if own is not None:
        return _reading(own, "line")
    default = _tip(conn, None)
    return _reading(default, "default") if default is not None else None


def set_targets(conn: db.LedgerConnection, line_id: int | None, max_drawdown, annual_return) -> dict:
    """Record the user's targets for the open line `line_id`, or the ledger default when it is None.
    The same targets as the ones in force write nothing. Called inside a write (as `line select` does),
    it joins that transaction and sees its uncommitted line."""
    from ledger import lines
    drawdown, annual = check(max_drawdown, annual_return)
    if line_id is not None:
        lines.open_line(conn, line_id)
    tip = _tip(conn, line_id)
    source = "line" if line_id is not None else "default"
    if tip is not None and (tip["max_drawdown"], tip["annual_return"]) == (drawdown, annual):
        return {**_reading(tip, source), "line_id": line_id, "written": False, "commit": None}
    payload = {"line_id": line_id, "max_drawdown": str(drawdown), "annual_return": str(annual),
               "supersedes": tip["target_id"] if tip is not None else None}

    def insert(c, op):
        c.rows(f"INSERT INTO {TABLE} (line_id, max_drawdown, annual_return, supersedes, op_id) "
               "VALUES (%s, %s, %s, %s, %s)", (line_id, drawdown, annual, payload["supersedes"], op))
        return c.one(f"SELECT target_id, line_id, max_drawdown, annual_return, created_at FROM {TABLE} "
                     "WHERE op_id = %s", (op,))

    written = db.write(conn, "set_targets", payload, TABLE, insert)
    return {**_reading(written["record"], source), "line_id": line_id,
            "written": not written["replayed"], "commit": written["commit"]}
