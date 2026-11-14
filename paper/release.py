"""The active-route check and a PIPE-held instance of the existing Paper lifecycle lock."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import select
import sys

from ledger import db
from paper import recovery


def selected(path: Path | None, name: str | None) -> bool:
    if path is None:
        return True  # existing workstation/compose command
    try:
        value = json.loads(path.read_text())
        proxy = value["apps"]["http"]["servers"]["paper"]["routes"][-1]["handle"][0]
        return proxy["upstreams"] == [{"dial": f"{name}:8767"}]
    except OSError, ValueError, KeyError, IndexError, TypeError:
        return False


def barrier(profile: db.LedgerProfile) -> None:
    """The host owns stdin; EOF releases the DB lock. Every ping checks the owning DB connection."""
    with recovery.operation(profile) as conn:
        print("locked", flush=True)
        while select.select([sys.stdin], [], [], 900)[0]:
            command = sys.stdin.readline()
            if not command:
                return
            if command.strip() != "held" or conn is None:
                raise RuntimeError("invalid release lock protocol")
            if conn.rows("SELECT IS_USED_LOCK(%s) = CONNECTION_ID()", (f"{profile.database}/paper-lifecycle",)) != [
                (1,)
            ]:
                raise RuntimeError("release lifecycle lock was lost")
            print("held", flush=True)
        raise RuntimeError("release lifecycle lock holder timed out")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("barrier",))
    parser.add_argument("--ledger", default="paper")
    args = parser.parse_args()
    barrier(db.load_profile(args.ledger))


if __name__ == "__main__":
    main()
