"""Resume one unsealed Paper run, retaining its pinned container and native originals.

All Docker/ledger lifecycle operations share a database advisory lock. A host file lock cannot
coordinate the macOS CLI with the daemon in Docker's Linux VM.
"""

from __future__ import annotations

from contextlib import contextmanager
from functools import wraps
import hashlib
import json
import os
from pathlib import Path
import threading
import time

from engine import paper_checkpoint as checkpoint
from engine.config import Refusal as RuntimeRefusal
from ledger import db, paper as records
from shared.refusals import refuse


CRASH_RESTARTS, CRASH_WINDOW = 3, 3600
LOCAL = threading.local()


@contextmanager
def operation(profile: db.LedgerProfile):
    key = (str(profile.service_root.resolve()), profile.database)
    held: set[tuple[str, str]] = getattr(LOCAL, "held", set())
    if key in held:
        yield
        return
    with db.connect(profile, "reader") as conn:
        name = f"{profile.database}/paper-lifecycle"
        if conn.rows("SELECT GET_LOCK(%s, %s)", (name, 120)) != [(1,)]:
            raise refuse("PAPER_RECOVERY_UNAVAILABLE", "another Paper lifecycle operation is still in progress")
        LOCAL.held = held | {key}
        try:
            yield conn
        finally:
            LOCAL.held = held
            conn.rows("SELECT RELEASE_LOCK(%s)", (name,))


def serialized(function):
    @wraps(function)
    def call(profile, *args, **kwargs):
        with operation(profile):
            return function(profile, *args, **kwargs)
    return call


def identity(row: dict, universe: bytes) -> str:
    # op_id binds the point to the logical declaration and survives moving that ledger to a server.
    value = {key: row[key] for key in ("paper_id", "op_id", "source_sha256", "image_ref", "symbols",
                                       "market_day", "config")}
    value["universe_sha256"] = hashlib.sha256(universe).hexdigest()
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def bind(row: dict, directory: Path) -> None:
    value = identity(row, (directory / "inputs" / "universe.json").read_bytes())
    checkpoint.atomic(directory / "inputs" / "recovery.json", json.dumps({"identity": value}).encode())


def launches(path: Path) -> list[dict]:
    found: list[dict] = []
    try:
        data = path.read_bytes()
    except FileNotFoundError:
        return found
    for raw in data.splitlines():
        try:
            value = json.loads(raw)
            if value.get("action") in ("start", "resume") and type(value.get("wall_ns")) is int:
                found.append(value)
        except (ValueError, AttributeError):
            continue
    return found


def launched(directory: Path, action: str) -> None:
    path = directory / "out" / "launches.jsonl"
    # Preserve an interrupted administrative line rather than joining the next attempt onto it.
    data = path.read_bytes() if path.exists() else b""
    with path.open("ab", buffering=0) as stream:
        if data and not data.endswith(b"\n"):
            stream.write(b"\n")
        stream.write(json.dumps({"action": action, "wall_ns": time.time_ns()}).encode() + b"\n")
        os.fsync(stream.fileno())


@serialized
def resume(profile: db.LedgerProfile, market: dict, paper_id: int) -> dict:
    """Restart the unsealed run `paper_id` from its native checkpoint, with every original input unchanged: the
    strategy source, the identity the checkpoint binds, the pinned container, and the contract terms, re-exported
    from the market at the run's market day and compared with inputs/terms.json (CF-18: a terms file changed on the
    host would otherwise be read silently on restart). PAPER_RECOVERY_UNAVAILABLE otherwise."""
    from paper import runs
    with db.connect(profile, "reader") as conn:
        row = records.read_paper_run(conn, paper_id)
        if records.seal_of(conn, paper_id) is not None:
            raise refuse("PAPER_RECOVERY_UNAVAILABLE", "a sealed run is immutable and cannot be resumed")
        all_rows = records.paper_runs(conn)
    directory = runs.run_dir(profile, paper_id)
    if (directory / "out" / "STOP").exists():
        raise refuse("PAPER_RECOVERY_UNAVAILABLE", "the user stopped this run; recovery is not a new start")
    named = runs.names(profile, paper_id)
    if runs._running(named["runner"]):
        return {"paper_id": paper_id, "write_status": "replayed", "state": "running"}
    expected = identity(row, (directory / "inputs" / "universe.json").read_bytes())
    if hashlib.sha256((directory / "inputs" / "strategy.py").read_bytes()).hexdigest() != row["source_sha256"]:
        raise refuse("PAPER_RECOVERY_UNAVAILABLE", "the run's original strategy input has changed")
    try:
        held = json.loads((directory / "inputs" / "terms.json").read_bytes())
    except (OSError, ValueError):
        held = None
    expected_terms = json.loads(json.dumps(runs._terms(market, str(row["market_day"]), list(row["symbols"])),
                                           sort_keys=True))
    if held != expected_terms:
        raise refuse("PAPER_RECOVERY_UNAVAILABLE", "the run's terms input no longer matches the contract terms at "
                                                   f"its market day {row['market_day']}")
    try:
        checkpoint.read(directory / "out", expected)
    except RuntimeRefusal as exc:
        raise refuse(exc.code, str(exc)) from exc
    config = runs._docker("inspect", "--format", "{{json .Config}}", named["runner"])
    if config.returncode or json.loads(config.stdout).get("Image") != row["image_ref"]:
        raise refuse("PAPER_RECOVERY_UNAVAILABLE", "the original pinned runner container is missing or changed")
    present = runs.containers(profile)
    if any(item["source_sha256"] == row["source_sha256"] for item in present
           if item["role"] == "runner" and item["running"]):
        raise refuse("PAPER_RECOVERY_UNAVAILABLE", "another run of this source is running")
    # The run takes back the memory its stopped containers were limited to (paper/runs.py admit).
    runs.admit(profile, runs.limits([name for name in (named["runner"], named["egress"]) if not runs._running(name)]),
               present)
    since = time.time_ns() - CRASH_WINDOW * 1_000_000_000
    attempts = sum(1 for old in all_rows if old["source_sha256"] == row["source_sha256"]
                   for attempt in launches(runs.run_dir(profile, old["paper_id"]) / "out" / "launches.jsonl")
                   if attempt["action"] == "resume" and attempt["wall_ns"] >= since)
    if attempts >= CRASH_RESTARTS:
        raise refuse("PAPER_RECOVERY_UNAVAILABLE", f"this source reached {CRASH_RESTARTS} recovery attempts per hour")
    # Record before Docker: failures before the runner can journal still consume an attempt.
    launched(directory, "resume")
    if not runs._running(named["egress"]):
        runs._checked("start", named["egress"])
    runs._checked("start", named["runner"])
    return {"paper_id": paper_id, "write_status": "written", "state": "resuming"}
