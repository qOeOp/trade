"""Atomic Paper recovery originals. No order, fill or account reconstruction lives here.

The runtime freezes a native Redis RDB on its owning thread, then publishes its journal cut.
The CLI and runtime use the same reader: a dirty or changed journal never falls back to a new account.
"""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import uuid

from engine.config import Refusal


FORMAT = "paper-native-checkpoint-v1"
HASH = re.compile(r"[0-9a-f]{64}\Z")


def fail(message: str) -> Refusal:
    return Refusal("PAPER_RECOVERY_UNAVAILABLE", message)


def sync_directory(path: Path) -> None:
    fd = os.open(path, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def atomic(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    partial = path.with_name(f".{path.name}.{uuid.uuid4().hex}")
    try:
        with partial.open("xb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(partial, path)
        sync_directory(path.parent)
    finally:
        partial.unlink(missing_ok=True)


def digest(path: Path, size: int | None = None) -> str:
    if path.is_symlink() or not path.is_file():
        raise fail(f"recovery original is missing or a symlink: {path.name}")
    result = hashlib.sha256()
    with path.open("rb") as stream:
        remaining = path.stat().st_size if size is None else size
        while remaining:
            data = stream.read(min(remaining, 1 << 20))
            if not data:
                raise fail(f"recovery original is shorter than its cut: {path.name}")
            result.update(data)
            remaining -= len(data)
    return result.hexdigest()


def dirty(output: Path) -> None:
    path = output / "recovery" / "dirty"
    if not path.exists():
        atomic(path, b"an input or callback is not checkpointed\n")


def read(output: Path, identity: str) -> dict:
    root = output / "recovery"
    path = root / "current.json"
    if root.is_symlink() or path.is_symlink() or not path.is_file():
        raise fail("no complete native checkpoint; the existing run is retained")
    try:
        found = json.loads(path.read_bytes())
        if (found["format"] != FORMAT or found["identity"] != identity
                or not HASH.fullmatch(found["cache_sha256"]) or not HASH.fullmatch(found["journal_sha256"])
                or type(found["journal_bytes"]) is not int or found["journal_bytes"] < 0):
            raise ValueError("checkpoint identity or cut is invalid")
    except (KeyError, TypeError, ValueError) as exc:
        raise fail(f"native checkpoint is invalid: {exc}") from exc
    if (root / "dirty").exists():
        raise fail("the last callback/input was not checkpointed; automatic recovery is refused")
    journal = output / "events.jsonl"
    if not journal.is_file() or journal.stat().st_size != found["journal_bytes"]:
        raise fail("the journal has an unhandled tail or is missing; automatic recovery is refused")
    if digest(journal) != found["journal_sha256"]:
        raise fail("the checkpoint journal prefix has changed")
    cache = root / f"{found['cache_sha256']}.rdb"
    if digest(cache) != found["cache_sha256"]:
        raise fail("the native checkpoint original has changed")
    return found


def publish(output: Path, identity: str, rdb: Path) -> dict:
    """Called only after the owner has saved hooks, drained the native FIFO and frozen Redis."""
    root = output / "recovery"
    root.mkdir(parents=True, exist_ok=True)
    journal = output / "events.jsonl"
    cache_hash = digest(rdb)
    cache = root / f"{cache_hash}.rdb"
    if not cache.exists():
        temporary = root / f".{uuid.uuid4().hex}.rdb"
        try:
            with rdb.open("rb") as source, temporary.open("xb") as target:
                shutil.copyfileobj(source, target)
                target.flush()
                os.fsync(target.fileno())
            os.replace(temporary, cache)
            sync_directory(root)
        finally:
            temporary.unlink(missing_ok=True)
    found = {"format": FORMAT, "identity": identity, "cache_sha256": cache_hash,
             "journal_bytes": journal.stat().st_size, "journal_sha256": digest(journal)}
    atomic(root / "current.json", json.dumps(found, sort_keys=True).encode())
    (root / "dirty").unlink(missing_ok=True)
    sync_directory(root)
    return found


def retain_used(output: Path, found: dict) -> Path:
    """Keep an actually used original, including its binding, before the next process can advance."""
    root = output / "recovery"
    used = root / "used" / hashlib.sha256(json.dumps(found, sort_keys=True).encode()).hexdigest()
    used.mkdir(parents=True, exist_ok=True)
    target = used / "cache.rdb"
    if not target.exists():
        os.link(root / f"{found['cache_sha256']}.rdb", target)
    atomic(used / "manifest.json", json.dumps(found, sort_keys=True).encode())
    sync_directory(used)
    return target
