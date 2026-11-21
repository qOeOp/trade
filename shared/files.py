"""One durable whole-file replace for the host (`atomic_write`): the bytes go to a new sibling, are synced, renamed
over the target, and the directory is synced, so a reader sees the old file or the new one and a crash keeps one of
them. The replay image cannot import this package; the engine has its own (`engine.config.atomic`)."""

from __future__ import annotations

import os
from pathlib import Path
import secrets


def atomic_write(path: Path, data: bytes, mode: int | None = None) -> None:
    """Replace `path` with `data` durably. `mode` sets the new file's permission bits (default: the umask's)."""
    temporary = path.with_name(f".{path.name}.{secrets.token_hex(4)}")
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o666)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            if mode is not None:
                os.fchmod(stream.fileno(), mode)
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)
    directory = os.open(path.parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(directory)
    finally:
        os.close(directory)
