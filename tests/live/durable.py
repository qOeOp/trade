"""The check that a Live private record was put in place durably (live.state.replace): the new bytes fsynced before
the rename, the directory after it."""

from __future__ import annotations

import os
from pathlib import Path
import stat
from unittest import mock


def assert_durable_replace(case, target: Path, action) -> None:
    """Run `action` and assert it put `target` in place durably: a regular file fsynced, renamed onto `target`,
    then `target`'s directory fsynced."""
    seen: list[tuple] = []
    fsync, rename = os.fsync, os.replace

    def synced(descriptor):
        mode = os.fstat(descriptor).st_mode
        seen.append(("fsync", "file" if stat.S_ISREG(mode) else "directory" if stat.S_ISDIR(mode) else "other"))
        return fsync(descriptor)

    def renamed(source, destination):
        seen.append(("replace", Path(destination).resolve()))
        return rename(source, destination)

    with mock.patch("os.fsync", side_effect=synced), mock.patch("os.replace", side_effect=renamed):
        action()
    target = target.resolve()
    case.assertIn(("replace", target), seen)
    at = seen.index(("replace", target))
    case.assertIn(("fsync", "file"), seen[:at], "the new bytes were not fsynced before the rename")
    case.assertIn(("fsync", "directory"), seen[at + 1:], "the rename was not made durable")
