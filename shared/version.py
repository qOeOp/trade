"""The product version and its line (docs/plans/version-line-branches-20261123.zh.md).

pyproject.toml's version is the one source a release tag, CHANGELOG.md and the IDE's About name. Its line is what a
ledger belongs to: until 1.0 `v0.<minor>`, from 1.0 `v<major>`. A version raises its line exactly when the previous
version's ledger can no longer be used, so a line names one ledger, published as that branch of the research
repository; patch versions share their line's branch.
"""

from pathlib import Path
import re
import tomllib

VERSION = re.compile(r"([0-9]+)\.([0-9]+)\.([0-9]+)\Z")


def product_version() -> str:
    return tomllib.loads((Path(__file__).resolve().parents[1] / "pyproject.toml").read_text())["project"]["version"]


def line(version: str) -> str:
    """`v0.<minor>` before 1.0, `v<major>` from 1.0."""
    found = VERSION.fullmatch(version)
    if found is None:
        raise ValueError(f"{version!r} is not X.Y.Z")
    major, minor = int(found[1]), int(found[2])
    return f"v0.{minor}" if major == 0 else f"v{major}"
