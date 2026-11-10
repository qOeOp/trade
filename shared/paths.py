"""Temporary working locations (`temporary_path`) and the source checkout (`REPOSITORY`).

Working copies (exploration and precheck output, sealed replay working directories, temporary
ledger services) must lie strictly under a platform temporary root and be new; the active ledger
uses the same test in reverse to refuse a temporary location. Pure: reads the file system, never
writes it.
"""

from __future__ import annotations

import os
from pathlib import Path
import tempfile

from shared.errors import Refusal
from shared.refusals import refuse


REPOSITORY = Path(__file__).resolve().parents[1]


def _roots() -> tuple[Path, ...]:
    resolved = []
    for root in (Path(tempfile.gettempdir()), Path("/tmp")):
        root = Path(root).expanduser().resolve()
        if root not in resolved:
            resolved.append(root)
    return tuple(resolved)


def temporary_path(path: str | Path, require_new: bool = True) -> Path:
    """The resolved absolute path when it lies strictly under a temporary root (and is new)."""
    expanded = Path(os.path.abspath(Path(path).expanduser()))
    resolved = expanded.resolve()
    roots = _roots()
    if not any(resolved != root and resolved.is_relative_to(root) for root in roots):
        raise refuse("NOT_TEMPORARY_PATH", f"{resolved} is not strictly under a temporary root",
                     expected="a path under one of: " + ", ".join(str(root) for root in roots))
    if require_new and (os.path.lexists(expanded) or os.path.lexists(resolved)):
        raise refuse("PATH_EXISTS", f"{resolved} already exists; working copies are always new",
                     expected="a path that does not exist yet")
    return resolved


def is_temporary(path: Path) -> bool:
    try:
        temporary_path(path, require_new=False)
    except Refusal:
        return False
    return True


def inside(path: Path, root: Path) -> bool:
    return Path(path).expanduser().resolve().is_relative_to(root.resolve())
