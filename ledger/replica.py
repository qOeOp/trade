"""Read-only research replicas. Fetch validates an immutable commit before fast-forwarding main.

The existing origin is the authority; HTTP cannot choose a URL, branch or database. This is a local
cache of published research, never a publishing peer or the Paper execution database.
"""
from __future__ import annotations

import pymysql

from ledger import db, publish
from shared.errors import Refusal
from shared.refusals import refuse


def _open(profile: db.LedgerProfile):
    config = db._known_service(profile.service_root)
    accounts = config.get("databases", {}).get(profile.database, {})
    if profile.kind is not None or set(accounts) != {"reader"}:
        raise refuse("REPLICA_REQUIRED", "sync requires a research replica with only a reader account")
    try:
        return db._admin(config, database=profile.database)
    except pymysql.MySQLError as exc:
        raise db._connection_error(exc) from exc


def _origin(cursor) -> str:
    rows = publish._rows(cursor, "SELECT url FROM dolt_remotes WHERE name = 'origin'")
    if len(rows) != 1:
        raise refuse("REMOTE_UNSET", "the replica has no configured origin")
    return rows[0][0]


HISTORY = 10


def _history(cursor) -> list[dict]:
    """The latest moves of the replica's main, newest first, read from Dolt's reflog: when it moved (UTC)
    and between which commits. Only bootstrap and sync move main. The reflog survives restarts but not
    garbage collection; the oldest move it holds (bootstrap, or the first kept) has no previous commit."""
    rows = publish._rows(cursor, "SELECT ref_timestamp, commit_hash FROM dolt_reflog('main') LIMIT %s",
                         (HISTORY + 1,))
    return [{"at": at.strftime("%Y-%m-%dT%H:%M:%SZ"), "previous_commit": rows[i + 1][1] if i + 1 < len(rows) else None,
             "ledger_commit": commit} for i, (at, commit) in enumerate(rows[:HISTORY])]


def status(profile: db.LedgerProfile) -> dict:
    raw = _open(profile)
    try:
        with raw.cursor() as cursor:
            origin = _origin(cursor)
            (head,), = publish._rows(cursor, "SELECT DOLT_HASHOF('main')")
            history = _history(cursor)
        return {"database": profile.database, "origin": origin, "ledger_commit": head, "history": history}
    except pymysql.MySQLError as exc:
        raise db._sql_error(exc) from exc
    finally:
        raw.close()


def sync(profile: db.LedgerProfile) -> dict:
    raw = _open(profile)
    before = target = origin = None
    validated = False
    try:
        with raw.cursor() as cursor:
            # The advisory lock serializes both HTTP and independent CLI callers.
            (locked,), = publish._rows(cursor, "SELECT GET_LOCK(%s, 0)", (f"{profile.database}/replica-sync",))
            if not locked:
                raise refuse("REPLICA_BUSY", "a research sync is already running")
            try:
                origin = _origin(cursor)
                if publish._rows(cursor, "SELECT table_name FROM dolt_status"):
                    raise refuse("DIRTY_WORKING_SET", "the replica has local changes; they are retained")
                (before,), = publish._rows(cursor, "SELECT DOLT_HASHOF('main')")
                publish._rows(cursor, "CALL DOLT_FETCH('origin')")
                (target,), = publish._rows(cursor, "SELECT DOLT_HASHOF('origin/main')")
                # A revision database reads fetched commits without changing the visible head.
                cursor.execute(f"USE `{profile.database}/{target}`")
                if publish._rows(cursor, "SELECT version FROM ledger_schema WHERE singleton = 1") != [
                        (db.SCHEMA_VERSION,)]:
                    raise refuse("REPLICA_INVALID", "the published schema is not readable by this product")
                cursor.execute(f"USE `{profile.database}/main`")
                validated = True
                publish._rows(cursor, "CALL DOLT_MERGE('--ff-only', 'origin/main')")
                (head,), = publish._rows(cursor, "SELECT DOLT_HASHOF('main')")
                return {"database": profile.database, "origin": origin, "previous_commit": before,
                        "ledger_commit": head, "changed": head != before}
            finally:
                publish._rows(cursor, "SELECT RELEASE_LOCK(%s)", (f"{profile.database}/replica-sync",))
    except pymysql.MySQLError as exc:
        # A lost reply after fast-forward does not prove that nothing changed. Re-read the already
        # validated target instead of resetting or claiming a rollback.
        if validated and before and target:
            try:
                current = status(profile)["ledger_commit"]
            except Refusal:
                current = None
            if current == target:
                return {"database": profile.database, "origin": origin, "previous_commit": before,
                        "ledger_commit": target, "changed": target != before}
        raise refuse("REPLICA_SYNC_FAILED", "sync could not confirm completion; keep the available view and retry: "
                     + str(exc.args[-1])[:300]) from exc
    finally:
        raw.close()
