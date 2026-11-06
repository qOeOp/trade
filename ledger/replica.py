"""Read-only research replicas. Fetch validates an immutable commit before fast-forwarding main.

The existing origin is the authority; HTTP cannot choose a URL, branch or database. This is a local
cache of published research, never a publishing peer or the Paper execution database.
"""
from __future__ import annotations

import pymysql

from ledger import db, publish
from ledger.refusals import refuse


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


def status(profile: db.LedgerProfile) -> dict:
    raw = _open(profile)
    try:
        with raw.cursor() as cursor:
            origin = _origin(cursor)
            (head,), = publish._rows(cursor, "SELECT DOLT_HASHOF('main')")
        return {"database": profile.database, "origin": origin, "ledger_commit": head}
    finally:
        raw.close()


def sync(profile: db.LedgerProfile) -> dict:
    raw = _open(profile)
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
                from report import review
                cursor.execute(f"USE `{profile.database}/{target}`")
                if publish._rows(cursor, "SELECT version FROM ledger_schema WHERE singleton = 1") != [
                        (db.SCHEMA_VERSION,)]:
                    raise refuse("REPLICA_INVALID", "the published schema is not readable by this product")
                found = {row[0]: tuple(row) for row in publish._rows(cursor, "SELECT * FROM dolt_tests")}
                if found != review.product_commit_tests():
                    raise refuse("REPLICA_INVALID", "the published commit's tests differ from this product")
                failed = [name for name, result, _ in publish._rows(
                    cursor, "SELECT test_name, status, message FROM dolt_test_run('*')") if result != "PASS"]
                if failed:
                    raise refuse("REPLICA_INVALID", "the published commit fails its native tests", missing=tuple(failed))
                cursor.execute(f"USE `{profile.database}/main`")
                publish._rows(cursor, "CALL DOLT_MERGE('--ff-only', 'origin/main')")
                (head,), = publish._rows(cursor, "SELECT DOLT_HASHOF('main')")
                return {"database": profile.database, "origin": origin, "previous_commit": before,
                        "ledger_commit": head, "changed": head != before}
            finally:
                publish._rows(cursor, "SELECT RELEASE_LOCK(%s)", (f"{profile.database}/replica-sync",))
    except pymysql.MySQLError as exc:
        raise refuse("REPLICA_SYNC_FAILED", "fetch or fast-forward failed; the previous research head is retained: "
                     + str(exc.args[-1])[:300]) from exc
    finally:
        raw.close()
