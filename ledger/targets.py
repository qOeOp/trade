"""The user's two research targets (`ledger.targets_for`, `ledger.set_targets`).

Targets are a maximum drawdown and a minimum annual return, bound to one research line or, with no
line, to the whole ledger as its default. They are the user's: they are recorded only as the user
states them, and they guide reading reports, never candidate eligibility. A change appends a row
superseding the one in force for the same scope, so the history stays and the targets in force are
the end of that chain. A line reads its own targets, else the default, else none; a version written
before `ledger upgrade` added the table holds none. Only an open line takes new targets: a closed
line's closing tag marks its end.
"""

from __future__ import annotations

from decimal import Decimal, InvalidOperation
import math

from ledger import db
from ledger.refusals import refuse


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


def held(conn: db.LedgerConnection) -> bool:
    """Whether the version this connection reads has the targets table."""
    return bool(conn.rows("SHOW TABLES LIKE %s", (TABLE,)))


def _tip(conn: db.LedgerConnection, line: str | None) -> dict | None:
    """The row in force for one scope: the one no later row supersedes."""
    rows = conn.dicts(f"SELECT target_id, line_bundle, max_drawdown, annual_return, created_at FROM {TABLE} t "
                      f"WHERE t.line_bundle <=> %s AND NOT EXISTS (SELECT 1 FROM {TABLE} n "
                      "WHERE n.supersedes = t.target_id)", (line,))
    if len(rows) > 1:
        raise refuse("LEDGER_CORRUPT", f"{len(rows)} target rows are in force for {line or 'the default'}",
                     missing=tuple(str(row["target_id"]) for row in rows))
    return rows[0] if rows else None


def _reading(row: dict, source: str) -> dict:
    return {"max_drawdown": float(row["max_drawdown"]), "annual_return": float(row["annual_return"]),
            "source": source, "target_id": row["target_id"], "created_at": row["created_at"]}


def targets_for(conn: db.LedgerConnection, line: str | None) -> dict | None:
    """{max_drawdown, annual_return, source (line or default), target_id, created_at} in force for
    `line` at the version this connection reads, or None when neither the line nor the ledger has any."""
    if not held(conn):
        return None
    own = _tip(conn, line) if line is not None else None
    if own is not None:
        return _reading(own, "line")
    default = _tip(conn, None)
    return _reading(default, "default") if default is not None else None


def set_targets(conn: db.LedgerConnection, line: str | None, max_drawdown, annual_return) -> dict:
    """Record the user's targets for the open line `line`, or the ledger default when `line` is None.
    The same targets as the ones in force write nothing. Called inside a write (as `line select` does),
    it joins that transaction and sees its uncommitted line."""
    from ledger import lines
    drawdown, annual = check(max_drawdown, annual_return)
    if not held(conn):
        raise refuse("LEDGER_UPGRADE_REQUIRED", f"the ledger has no {TABLE} table", missing=(TABLE,))
    if line is not None and line not in lines.open_lines(conn):
        if line not in lines.line_bundles(conn):
            raise refuse("LINE_UNKNOWN", f"no research line {line!r}", missing=(str(line),))
        raise refuse("LINE_ENDED", f"{line} is closed; only an open line takes targets", missing=(line,))
    tip = _tip(conn, line)
    if tip is not None and (tip["max_drawdown"], tip["annual_return"]) == (drawdown, annual):
        return {**_reading(tip, "line" if line else "default"), "line": line, "written": False, "commit": None}
    payload = {"line": line, "max_drawdown": str(drawdown), "annual_return": str(annual),
               "supersedes": tip["target_id"] if tip is not None else None}

    def insert(c, op):
        c.rows(f"INSERT INTO {TABLE} (line_bundle, max_drawdown, annual_return, supersedes, op_id, created_at) "
               "VALUES (%s, %s, %s, %s, %s, UTC_TIMESTAMP(6))", (line, drawdown, annual, payload["supersedes"], op))
        return c.one(f"SELECT target_id, line_bundle, max_drawdown, annual_return, created_at FROM {TABLE} "
                     "WHERE op_id = %s", (op,))

    written = db.write(conn, "set_targets", payload, TABLE, insert)
    return {**_reading(written["record"], "line" if line else "default"), "line": line,
            "written": not written["replayed"], "commit": written["commit"]}
