"""One connection per command to one named ledger, and the single write protocol.

Every write is one transaction on one connection on the active round branch: refuse a dirty
working set, insert, bump the single `ledger_head` row and `dolt_commit`. Two concurrent writers
both update that row, so Dolt refuses the later one with error 1213 instead of merging them.
Retrying an operation with the same `op_id` returns the original record instead of writing again.
"""

from __future__ import annotations

from contextlib import contextmanager
import hashlib
import json
import re

import pymysql
import pymysql.cursors

from research.records.common import RecordError


SCHEMA_VERSION = 2
MARKET_SCHEMA_VERSION = 1
DOLT_VERSION = "2.4.2"
ROUND_PREFIX = "round/"
CLOSED_PREFIX = "closed/"
REF = re.compile(r"[A-Za-z0-9][A-Za-z0-9_./-]{0,199}\Z")


class ConflictError(RecordError):
    """Another write landed first, or this operation ID already names different content."""


def _refuse(message, code, **extra):
    return RecordError(message, code=code, write_status="not_written", **extra)


def op_id(kind: str, payload) -> str:
    """A default operation ID: the same payload gives the same ID, so a retry is idempotent."""
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str)
    return f"{kind}:{hashlib.sha256(encoded.encode()).hexdigest()[:40]}"


def connect(profile: dict, role: str, *, branch: str | None = None, streaming: bool = False):
    """Open the command's one connection: `admin`, `writer` or `reader`, over the unix socket."""
    from research.records.ledger import credentials
    user, password, socket_path = credentials(profile, role)
    database = profile["database"] + (f"/{branch}" if branch else "")
    try:
        return pymysql.connect(unix_socket=socket_path, user=user, password=password, database=database,
                               charset="utf8mb4", autocommit=True, connect_timeout=5, read_timeout=600,
                               write_timeout=600, max_allowed_packet=1 << 30,
                               cursorclass=pymysql.cursors.SSCursor if streaming else pymysql.cursors.Cursor)
    except pymysql.MySQLError as exc:
        raise RecordError(f"cannot connect to ledger {profile['name']} ({socket_path}): {exc}",
                          code="LEDGER_UNAVAILABLE", write_status="not_written",
                          next_actions=[f"Start it with `ledger start --ledger {profile['name']}`, "
                                        "then rerun the same command."]) from exc


def rows(conn, statement: str, params=None) -> list[tuple]:
    try:
        with conn.cursor() as cursor:
            cursor.execute(statement, params)
            result = cursor.fetchall()
            while cursor.nextset():
                cursor.fetchall()
            return list(result)
    except pymysql.MySQLError as exc:
        raise _sql_error(exc) from exc


def dicts(conn, statement: str, params=None) -> list[dict]:
    try:
        with conn.cursor() as cursor:
            cursor.execute(statement, params)
            names = [column[0] for column in cursor.description or ()]
            return [dict(zip(names, row)) for row in cursor.fetchall()]
    except pymysql.MySQLError as exc:
        raise _sql_error(exc) from exc


def one(conn, statement: str, params=None):
    found = dicts(conn, statement, params)
    return found[0] if found else None


def _sql_error(exc: pymysql.MySQLError) -> RecordError:
    code = exc.args[0] if exc.args else None
    if code == 1213:
        return ConflictError("another write landed first (Dolt 1213); nothing was written",
                             code="CONCURRENT_WRITE", write_status="not_written",
                             next_actions=["Reread the ledger, check the record still makes sense, then rerun "
                                           "the same command; it is idempotent."])
    if code == 1142 or (code == 1105 and "permissions on branch" in str(exc)):
        return _refuse(f"the ledger account may not do this: {exc.args[1] if len(exc.args) > 1 else exc}",
                       "LEDGER_PERMISSION")
    return RecordError(f"Dolt SQL error: {exc}", code="DOLT_SQL_ERROR", write_status="not_written")


def rounds(conn) -> dict:
    """Round branches and their closing tags, read on the given connection."""
    branches = {name[len(ROUND_PREFIX):]: commit for name, commit in rows(
        conn, "SELECT name, hash FROM dolt_branches WHERE name LIKE 'round/%'")}
    tags = {name[len(CLOSED_PREFIX):]: commit for name, commit in rows(
        conn, "SELECT tag_name, tag_hash FROM dolt_tags WHERE tag_name LIKE 'closed/%'")}
    return {"open": sorted(goal for goal in branches if goal not in tags),
            "closed": sorted(tags), "branches": branches, "tags": tags}


def active_goal(conn) -> str:
    found = rounds(conn)["open"]
    if not found:
        raise _refuse("no round is open on this ledger", "NO_ACTIVE_ROUND",
                      next_actions=["Open one with `round open --goal GOAL.json`."])
    if len(found) > 1:
        raise _refuse(f"more than one round is open: {found}", "SEVERAL_ACTIVE_ROUNDS")
    return found[0]


def check_ref(ref: str) -> str:
    if not isinstance(ref, str) or not REF.fullmatch(ref) or ".." in ref:
        raise _refuse(f"invalid Dolt ref: {ref!r}", "INVALID_REF")
    return ref


@contextmanager
def reading(profile: dict, at: str | None = None):
    """A reader connection, on the active round branch unless `at` names a branch or tag."""
    conn = connect(profile, "reader")
    try:
        if at is None:
            goal = rounds(conn)["open"]
            if len(goal) == 1:
                rows(conn, f"USE `{profile['database']}/{ROUND_PREFIX}{goal[0]}`")
        else:
            check_ref(at)
            names = {name for (name,) in rows(conn, "SELECT name FROM dolt_branches")}
            if at in names:
                rows(conn, f"USE `{profile['database']}/{at}`")
            else:
                # A tag or commit: read-only revision database.
                rows(conn, f"USE `{profile['database']}/{at}`")
        yield conn
    finally:
        conn.close()


@contextmanager
def session(profile: dict, role: str = "writer"):
    """The command's one connection, on the open round's branch, for its reads and its writes."""
    from research.records.ledger import require_writable
    if role != "reader":
        require_writable(profile)
    conn = connect(profile, role)
    try:
        conn.goal = active_goal(conn)
        rows(conn, f"USE `{profile['database']}/{ROUND_PREFIX}{conn.goal}`")
        yield conn
    finally:
        conn.close()


def write(profile: dict, *, kind: str, op: str, table: str, insert, replay=None, conn=None) -> dict:
    """Run `insert(conn)` as one atomic, idempotent write on the open round's branch.

    `table` holds the record's `op_id`. A prior row with this `op_id` is returned through
    `replay(conn, row)` (default: the row) without writing. `insert` returns the result dict.
    `conn` is the command's `session` when it also reads; without it the write opens its own.
    """
    if conn is None:
        with session(profile) as own:
            return write(profile, kind=kind, op=op, table=table, insert=insert, replay=replay, conn=own)
    goal = conn.goal
    try:
        conn.autocommit(False)
        conn.begin()
        try:
            prior = one(conn, f"SELECT * FROM `{table}` WHERE op_id = %s", (op,))
            if prior is not None:
                conn.rollback()
                result = replay(conn, prior) if replay else prior
                return {**result, "replayed": True, "goal_id": goal}
            if rows(conn, "SELECT table_name FROM dolt_status"):
                raise _refuse("the round branch has uncommitted SQL changes; nothing was written",
                              "DIRTY_WORKING_SET",
                              next_actions=["Inspect `dolt_status` with an administrator; never commit them under "
                                            "another operation."])
            result = insert(conn)
            rows(conn, "UPDATE ledger_head SET seq = seq + 1, op_id = %s WHERE singleton = 1", (op,))
            (commit,), = rows(conn, "CALL DOLT_COMMIT('-a', '-m', %s)", (f"{kind}:{op}",))
            conn.commit()
        except Exception:
            try:
                conn.rollback()
            except pymysql.MySQLError:
                pass
            raise
        finally:
            conn.autocommit(True)
        return {**result, "commit": commit, "replayed": False, "goal_id": goal, "op_id": op}
    except pymysql.MySQLError as exc:
        raise _sql_error(exc) from exc
