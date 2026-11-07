"""Private immutable inputs and append-only host observations for one execution account."""

from __future__ import annotations

from contextlib import contextmanager
import fcntl
import json
import os
from pathlib import Path
import re
import stat
import time

from engine.live_errors import LiveRefusal


RUN_ID = re.compile(r"[a-z0-9][a-z0-9-]{0,23}\Z")


def fail(code: str, message: str):
    return LiveRefusal(code, message)


def private_directory(path: Path) -> Path:
    path = path.expanduser().absolute()
    if path.is_symlink():
        raise fail("LIVE_DIRECTORY", "Live custody cannot use a symbolic-link directory")
    path = path.resolve()
    if not path.exists():
        created = []
        parent = path
        while not parent.exists():
            created.append(parent)
            parent = parent.parent
        path.mkdir(mode=0o700, parents=True)
        for item in created:
            fsync_parent(item)
    mode = path.stat()
    if not stat.S_ISDIR(mode.st_mode) or mode.st_mode & 0o077:
        raise fail("LIVE_DIRECTORY", "Live custody requires a private directory (mode 0700)")
    return path


def directory(root: Path, run_id: str) -> Path:
    if not RUN_ID.fullmatch(run_id):
        raise fail("LIVE_RUN_ID", "run-id must contain 1–24 lowercase letters, digits or hyphens")
    return root / "runs" / run_id


def fsync_parent(path: Path) -> None:
    descriptor = os.open(path.parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def write_new(path: Path, data: bytes) -> None:
    descriptor = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, "wb") as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())
    fsync_parent(path)


def encode(value: dict) -> bytes:
    return (json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False) + "\n").encode()


def read(path: Path) -> dict:
    try:
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
        with os.fdopen(descriptor, "rb") as stream:
            if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
                raise ValueError
            value = json.load(stream)
        if not isinstance(value, dict):
            raise ValueError
        return value
    except (OSError, ValueError, TypeError) as exc:
        raise fail("LIVE_RECORD_UNAVAILABLE", "the private Live record is absent or malformed") from exc


def append(path: Path, event: str, run_id: str, **details) -> None:
    descriptor = os.open(path, os.O_CREAT | os.O_APPEND | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, "ab") as stream:
        stream.write(encode({"event": event, "run_id": run_id, "observed_ns": time.time_ns(), **details}))
        stream.flush()
        os.fsync(stream.fileno())
    fsync_parent(path)


def events(path: Path) -> list[dict]:
    if not path.exists():
        return []
    try:
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
        with os.fdopen(descriptor, "rb") as stream:
            data = stream.read()
        # An incomplete final write is evidence of an unresolved action, never a completed one.
        if data and not data.endswith(b"\n"):
            raise ValueError
        result = [json.loads(line) for line in data.splitlines()]
        if any(not isinstance(row, dict) for row in result):
            raise ValueError
        return result
    except (OSError, ValueError, TypeError) as exc:
        raise fail("LIVE_JOURNAL_UNAVAILABLE", "the Live journal is incomplete; retain it for reconciliation") from exc


@contextmanager
def serialized(root: Path):
    root = private_directory(root)
    descriptor = os.open(root / "account.lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, "r+") as stream:
        fcntl.flock(stream, fcntl.LOCK_EX)
        yield root


@contextmanager
def reading(root: Path):
    """Read an initialized custody root without creating a directory or lock.

    This coordinates with host commands only. Native journals have their own writer,
    so callers still have to treat incomplete native evidence as unknown.
    """
    root = root.expanduser().absolute()
    try:
        if root.is_symlink():
            raise ValueError
        root = root.resolve()
        mode = root.stat()
        if not stat.S_ISDIR(mode.st_mode) or mode.st_mode & 0o077:
            raise ValueError
        descriptor = os.open(root / "account.lock", os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    except (OSError, ValueError) as exc:
        raise fail("LIVE_RECORD_UNAVAILABLE", "the private Live root is not available for observation") from exc
    with os.fdopen(descriptor, "rb") as stream:
        if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
            raise fail("LIVE_RECORD_UNAVAILABLE", "the private Live lock is not a regular file")
        fcntl.flock(stream, fcntl.LOCK_SH)
        yield root
