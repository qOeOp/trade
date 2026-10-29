"""Maintain only the IDE's disposable public copies; repair-market is an explicit administrator action.

Ordinary pulls remain fast-forward only. A repair retains the old market head on an immutable local
branch before realigning main; fetched historical branches remain reachable in the same database.
"""
from __future__ import annotations

import fcntl
import json
from pathlib import Path
import sys

import pymysql

SERVICE = Path("/data/dolt")
REWRITTEN = 3


def sql(conn, query: str, params=None) -> list[tuple]:
    with conn.cursor() as cursor:
        cursor.execute(query, params)
        rows = list(cursor.fetchall())
        while cursor.nextset():
            pass
        return rows


def retain(conn, name: str, commit: str) -> None:
    """Never force-update a retained branch, including when a remote branch itself changed history."""
    found = sql(conn, "SELECT hash FROM dolt_branches WHERE name = %s", (name,))
    if found and found[0][0] != commit:
        name = f"ide-retained/{commit}"
        found = sql(conn, "SELECT hash FROM dolt_branches WHERE name = %s", (name,))
    if not found:
        sql(conn, "CALL DOLT_BRANCH(%s, %s)", (name, commit))
    elif found[0][0] != commit:
        raise RuntimeError(f"retained branch {name} names another commit")


def fetch_market(conn) -> None:
    # A clone can have a main-only refspec. Historical lines also pin commits on other branches.
    sql(conn, "CALL DOLT_FETCH('origin', 'refs/heads/*:refs/remotes/origin/*')")
    for remote, commit in sql(conn, "SELECT name, hash FROM dolt_remote_branches"):
        name = remote.removeprefix("remotes/origin/")
        if remote.startswith("remotes/origin/") and name != "main":
            retain(conn, name, commit)


def pull(conn, database: str) -> None:
    if database == "market":
        fetch_market(conn)
        sql(conn, "CALL DOLT_MERGE('--ff-only', 'origin/main')")
    else:
        sql(conn, "CALL DOLT_PULL('origin', 'main', '--ff-only')")


def repair_market(conn) -> dict:
    if sql(conn, "SELECT table_name FROM dolt_status"):
        raise RuntimeError("market copy has uncommitted changes; preserve them before repair")
    fetch_market(conn)  # failure leaves main untouched
    (old,), = sql(conn, "SELECT DOLT_HASHOF('HEAD')")
    (new,), = sql(conn, "SELECT DOLT_HASHOF('origin/main')")
    archive = f"ide-retained/{old}"
    if old != new:
        retain(conn, archive, old)  # a failure here must not move main
        sql(conn, "CALL DOLT_RESET('--hard', %s)", (new,))
    return {"database": "market", "before": old, "after": new,
            "retained_branch": archive if old != new else None}


def connection(database: str):
    # This administrator belongs to the IDE copy, never the research/market services or their profiles.
    profile = json.loads(Path("/data/ledgers/research.json").read_text())
    if profile.get("kind") is not None or profile.get("service") != str(SERVICE):
        raise RuntimeError("this is not the IDE's read-only public copy")
    return pymysql.connect(host="127.0.0.1", port=3306, user="root",
                           password=(SERVICE / "admin.password").read_text().strip(), database=f"{database}/main",
                           autocommit=True, connect_timeout=10, read_timeout=1800, write_timeout=1800)


def main(arguments: list[str]) -> int:
    if len(arguments) != 1 or arguments[0] not in ("ledger", "market", "repair-market"):
        print("usage: trade-ide-pull ledger|market|repair-market", file=sys.stderr)
        return 2
    action = arguments[0]
    database = "research" if action == "ledger" else "market"
    try:
        # Repair and polling use the same lock; no process or server needs to be stopped.
        with (SERVICE / f"{database}-sync.lock").open("a") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            with connection(database) as conn:
                if action == "repair-market":
                    print(json.dumps(repair_market(conn)))
                else:
                    pull(conn, database)
        return 0
    except (OSError, ValueError, RuntimeError, pymysql.MySQLError) as exc:
        message = str(exc)
        print(message, file=sys.stderr)
        return REWRITTEN if any(text in message.lower() for text in ("fast-forward", "no common ancestor")) else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
