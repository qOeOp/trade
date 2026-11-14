"""Read-only release checks and a PIPE-held instance of the existing Paper lifecycle lock."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import select
import sys

from engine import paper_checkpoint as checkpoint
from ledger import db, paper as records
from paper import recovery, runs
from runtime import image


def selected(path: Path | None, name: str | None) -> bool:
    if path is None:
        return True  # existing workstation/compose command
    try:
        value = json.loads(path.read_text())
        proxy = value["apps"]["http"]["servers"]["paper"]["routes"][-1]["handle"][0]
        return proxy["upstreams"] == [{"dial": f"{name}:8767"}]
    except OSError, ValueError, KeyError, IndexError, TypeError:
        return False


def compatible(profile: db.LedgerProfile, runtime: str) -> dict:
    """No replay, recovery, seal or ledger write: inspect pinned layouts and existing native formats."""
    default = image.resolve(runtime or image.EXECUTION)
    with db.connect(profile, "reader") as conn:
        rows = records.paper_runs(conn)
    pinned = {}
    for row in rows:
        if row["seal"]:
            continue
        ref = row["image_ref"]
        if ref not in pinned:
            pinned[ref] = image.resolve(ref)
        directory = runs.run_dir(profile, row["paper_id"])
        # A running account can be between checkpoints (dirty); do not grade recovery eligibility
        # or alter its originals. Reject a format/identity this controller cannot understand.
        manifest = directory / "out/recovery/current.json"
        if manifest.exists():
            found = json.loads(manifest.read_bytes())
            expected = recovery.identity(row, (directory / "inputs/universe.json").read_bytes())
            if found.get("format") != checkpoint.FORMAT or found.get("identity") != expected:
                raise RuntimeError(f"controller cannot read run {row['paper_id']}'s original checkpoint format")
        path = directory / "out/events.jsonl"
        if path.exists():
            data = path.read_bytes()
            _, unreadable = records.journal_lines(data[: data.rfind(b"\n") + 1])
            if unreadable:
                raise RuntimeError(f"controller cannot read run {row['paper_id']}'s existing native journal")
    return {
        "runtime": default["image_ref"],
        "contracts": sorted({v["runtime_contract"] for v in pinned.values()}),
        "runs": [r["paper_id"] for r in rows if not r["seal"]],
    }


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
            if conn.rows("SELECT IS_USED_LOCK(%s) = CONNECTION_ID()", (recovery.lock_name(profile),)) != [(1,)]:
                raise RuntimeError("release lifecycle lock was lost")
            print("held", flush=True)
        raise RuntimeError("release lifecycle lock holder timed out")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("check", "barrier"))
    parser.add_argument("--ledger", default="paper")
    parser.add_argument("--runtime")
    args = parser.parse_args()
    profile = db.load_profile(args.ledger)
    if args.action == "barrier":
        barrier(profile)
    else:
        if not args.runtime:
            parser.error("check requires --runtime")
        print(json.dumps(compatible(profile, args.runtime)))


if __name__ == "__main__":
    main()
