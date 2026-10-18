"""Temporary working locations (`ledger.temporary_path`).

Working copies (exploration and precheck output, sealed replay working directories, temporary
ledger services) must lie strictly under a platform temporary root and be new; the active ledger
uses the same test in reverse to refuse a temporary location. Pure: reads the file system, never
writes it.
"""

from __future__ import annotations

import os
from pathlib import Path
import tempfile

from ledger.refusals import refuse


def _roots(temp_roots: tuple[Path, ...] | None) -> tuple[Path, ...]:
    given = temp_roots if temp_roots is not None else (Path(tempfile.gettempdir()), Path("/tmp"))
    resolved = []
    for root in given:
        root = Path(root).expanduser().resolve()
        if root not in resolved:
            resolved.append(root)
    return tuple(resolved)


def temporary_path(path: str | Path, require_new: bool = True, temp_roots: tuple[Path, ...] | None = None) -> Path:
    """The resolved absolute path when it lies strictly under a temporary root (and is new)."""
    expanded = Path(os.path.abspath(Path(path).expanduser()))
    resolved = expanded.resolve()
    roots = _roots(temp_roots)
    if not any(resolved != root and resolved.is_relative_to(root) for root in roots):
        raise refuse("NOT_TEMPORARY_PATH", f"{resolved} is not strictly under a temporary root",
                     expected="a path under one of: " + ", ".join(str(root) for root in roots))
    if require_new and (os.path.lexists(expanded) or os.path.lexists(resolved)):
        raise refuse("PATH_EXISTS", f"{resolved} already exists; working copies are always new",
                     expected="a path that does not exist yet")
    return resolved
