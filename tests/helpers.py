"""Helpers shared by test modules."""

from __future__ import annotations

import csv
import shutil
import tempfile
import unittest
from collections.abc import Callable, Iterable, Mapping
from pathlib import Path
from typing import Any

from shared.errors import Refusal


def refused(call: Callable[..., Any], *args: Any,
            error: type[BaseException] | tuple[type[BaseException], ...] = Refusal, **kwargs: Any) -> Any:
    """The `error` (a Refusal by default, or one of a tuple) that `call(*args, **kwargs)` raises; its `.code` is the
    refusal code."""
    try:
        call(*args, **kwargs)
    except error as caught:
        return caught
    raise AssertionError(f"{getattr(call, '__name__', call)} raised no {error}")


def assert_refused(test: unittest.TestCase, code: str, call: Callable[..., Any], *args: Any, **kwargs: Any) -> Any:
    """The Refusal `call(*args, **kwargs)` raises, after `test` checks that its code is `code`."""
    caught = refused(call, *args, **kwargs)
    test.assertEqual(caught.code, code, caught.message)
    return caught


def tempdir(cleanup: Callable[..., Any], prefix: str | None = None, dir: str | None = None) -> Path:
    """A new temporary directory that `cleanup` (a test's addCleanup or a class's addClassCleanup) removes."""
    path = Path(tempfile.mkdtemp(prefix=prefix, dir=dir))
    cleanup(shutil.rmtree, path, True)
    return path


def write_csv(path: Path, rows: Iterable[Mapping[str, Any]]) -> None:
    """Write `rows` as a CSV file with a header of the first row's keys, as a native report file is laid out."""
    rows = list(rows)
    with path.open("w", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)
