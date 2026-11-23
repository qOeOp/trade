"""The product version and its line (docs/plans/main-is-the-ledger-in-use-20261123.zh.md).

pyproject.toml's version is the one source a release tag, CHANGELOG.md and the IDE's About name. Its line is what a
ledger belongs to: until 1.0 `v0.<minor>`, from 1.0 `v<major>`. A version raises its line exactly when the previous
version's ledger can no longer be used, so a line names one ledger; patch versions share their line's ledger. The
research repository's `main` holds the ledger in use, which names its line by the Dolt tag `line/<line>` on its first
commit (`tag`); a line's ledger moves to the branch named after the line when the next line replaces it on `main`.
"""

from pathlib import Path
import re
import tomllib

VERSION = re.compile(r"([0-9]+)\.([0-9]+)\.([0-9]+)\Z")
LINE = re.compile(r"v(?:0\.([0-9]+)|([1-9][0-9]*))\Z")
TAG = "line/"  # a ledger's line tag: TAG + line


def product_version() -> str:
    return tomllib.loads((Path(__file__).resolve().parents[1] / "pyproject.toml").read_text())["project"]["version"]


def line(version: str) -> str:
    """`v0.<minor>` before 1.0, `v<major>` from 1.0."""
    found = VERSION.fullmatch(version)
    if found is None:
        raise ValueError(f"{version!r} is not X.Y.Z")
    major, minor = int(found[1]), int(found[2])
    return f"v0.{minor}" if major == 0 else f"v{major}"


def order(name: str) -> tuple[int, int]:
    """Where line `name` comes among lines: a later line sorts after an earlier one."""
    found = LINE.fullmatch(name)
    if found is None:
        raise ValueError(f"{name!r} is not a version line")
    return (0, int(found[1])) if found[1] is not None else (int(found[2]), 0)


def tag(name: str) -> str:
    """The Dolt tag that names line `name` on its ledger's first commit."""
    order(name)
    return TAG + name
