"""Refuse a version number that does not fit its data generation (docs/plans/data-generation-in-release-20261123.zh.md).

Usage: python .github/scripts/release-generation.py X.Y.Z [REF]

A version whose ledger schema generations (`SCHEMA_VERSION` and `PAPER_SCHEMA_VERSION` in ledger/db.py at REF,
default HEAD) differ from the newest release tag's starts a new data generation: every deployment archives its ledger
and starts a new one when it reaches that version. Such a version must say so in its number: until 1.0 it raises the
minor version (0.5.1 -> 0.6.0, never 0.5.2), from 1.0 the major version. Any other version may raise any part.
"""

import ast
import re
import subprocess
import sys

NAMES = ("SCHEMA_VERSION", "PAPER_SCHEMA_VERSION")
TAG = re.compile(r"v(\d+)\.(\d+)\.(\d+)\Z")


def generations(text: str) -> dict[str, int]:
    """The schema generations a ledger/db.py assigns, read without importing it."""
    found = {}
    for node in ast.parse(text).body:
        if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
            name = node.targets[0].id
            if name in NAMES and isinstance(node.value, ast.Constant) and type(node.value.value) is int:
                found[name] = node.value.value
    if set(found) != set(NAMES):
        raise SystemExit(f"ledger/db.py does not assign {' and '.join(NAMES)} as integers")
    return found


def parse(version: str) -> tuple[int, int, int]:
    match = TAG.fullmatch(f"v{version}")
    if match is None:
        raise SystemExit(f"{version} is not X.Y.Z")
    return int(match[1]), int(match[2]), int(match[3])


def refusal(version: str, previous: str, before: dict[str, int], after: dict[str, int]) -> str | None:
    """Why `version` may not follow `previous` with these generations, or None."""
    if before == after:
        return None
    new, old = parse(version), parse(previous)
    changed = ", ".join(f"{name} {before[name]} -> {after[name]}" for name in NAMES if before[name] != after[name])
    if old[0] == 0 and new[:2] == old[:2]:
        return (f"{version} changes the data generation since v{previous} ({changed}), which starts a new ledger on "
                f"every deployment; until 1.0 that needs a new minor version: release {old[0]}.{old[1] + 1}.0")
    if old[0] > 0 and new[0] == old[0]:
        return (f"{version} changes the data generation since v{previous} ({changed}), which starts a new ledger on "
                f"every deployment; from 1.0 that needs a new major version: release {old[0] + 1}.0.0")
    return None


def git(*args: str) -> str:
    return subprocess.run(["git", *args], capture_output=True, text=True, check=True).stdout


def main(version: str, ref: str = "HEAD") -> None:
    parse(version)
    tags = [tag for tag in git("tag", "-l", "v*").split() if TAG.fullmatch(tag)]
    if not tags:
        return
    previous = max(tags, key=lambda tag: parse(tag[1:]))[1:]
    before = generations(git("show", f"v{previous}:ledger/db.py"))
    after = generations(git("show", f"{ref}:ledger/db.py"))
    reason = refusal(version, previous, before, after)
    if reason:
        raise SystemExit(reason)
    print(f"{version}: data generation {after} {'unchanged' if before == after else 'starts with this version'}")


if __name__ == "__main__":
    if len(sys.argv) not in (2, 3):
        raise SystemExit("usage: release-generation.py X.Y.Z [REF]")
    main(*sys.argv[1:])
