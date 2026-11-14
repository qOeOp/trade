"""The Paper lifecycle lock and a run's recovery identity (paper.runs resumes a run with them).

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
from ledger import db
from shared.refusals import refuse


LOCAL = threading.local()


def lock_name(profile: db.LedgerProfile) -> str:
    return f"{profile.database}/paper-lifecycle"


@contextmanager
def operation(profile: db.LedgerProfile):
    key = (str(profile.service_root.resolve()), profile.database)
    held: set[tuple[str, str]] = getattr(LOCAL, "held", set())
    if key in held:
        yield
        return
    with db.connect(profile, "reader") as conn:
        name = lock_name(profile)
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


def launched(directory: Path, action: str) -> None:
    path = directory / "out" / "launches.jsonl"
    # Preserve an interrupted administrative line rather than joining the next attempt onto it.
    data = path.read_bytes() if path.exists() else b""
    with path.open("ab", buffering=0) as stream:
        if data and not data.endswith(b"\n"):
            stream.write(b"\n")
        stream.write(json.dumps({"action": action, "wall_ns": time.time_ns()}).encode() + b"\n")
        os.fsync(stream.fileno())
