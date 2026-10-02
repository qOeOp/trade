#!/usr/bin/env python3
"""
Name the features a sealed acceptance feature carries but does not own.

A sealed acceptance feature may include a feature that is meant to stand on its own: a production
surface that the acceptance exercises but that a production build turns on without any acceptance
code. The ordered chain and its clippy then compile that feature only with the acceptance beside
it, so code behind it that leans on an acceptance symbol compiles in every CI run and fails the
first build that turns the feature on alone.

A carried feature is one of a workspace package's features that the union reaches through feature
lists, that is not itself `sealed-`, and that the union does not name. It is found by walking the
packages' own `[features]` tables from each union entry, not by asking Cargo what the union
resolves to: that resolution also holds every feature the rest of the workspace unifies in, and says
nothing about which of them the sealed features brought.

Usage: sealed_carried_features.py <union>
Prints one `<package> <feature>` line per carried feature; none is a valid answer.

"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
from collections.abc import Iterable
from typing import Any


SEALED = "sealed-"


def _dependency_package(package: dict[str, Any], name: str) -> str | None:
    # A feature list names a dependency by the key it has in Cargo.toml, which is its rename when
    # it has one.
    for dependency in package["dependencies"]:
        key = dependency.get("rename") or dependency["name"]
        if key.replace("-", "_") == name.replace("-", "_"):
            return dependency["name"]
    return None


def carried(metadata: dict[str, Any], union: Iterable[str]) -> list[tuple[str, str]]:
    """
    Return the non-sealed workspace features the union reaches and does not name.
    """
    members = set(metadata["workspace_members"])
    packages = {p["name"]: p for p in metadata["packages"] if p["id"] in members}
    named = [tuple(entry.split("/", 1)) for entry in union if entry]
    for package, feature in named:
        # A union entry this walk cannot start from would leave everything behind it unwalked, and
        # the answer would read as "carries nothing".
        if package not in packages or feature not in packages[package]["features"]:
            raise ValueError(f"the union names {package}/{feature}, which no workspace package has")
    seen: set[tuple[str, str]] = set()
    stack = list(named)
    while stack:
        package, feature = stack.pop()
        if (package, feature) in seen or package not in packages:
            continue
        seen.add((package, feature))
        for item in packages[package]["features"].get(feature, []):
            if item.startswith("dep:"):
                continue
            if "/" in item:
                dependency, sub = item.split("/", 1)
                target = _dependency_package(packages[package], dependency.removesuffix("?"))
                if target is not None:
                    stack.append((target, sub))
            else:
                stack.append((package, item))
    return sorted(
        (package, feature)
        for package, feature in seen - set(named)
        if not feature.startswith(SEALED)
    )


def main(argv: list[str]) -> int:
    if len(argv) != 2 or not argv[1]:
        sys.exit("usage: sealed_carried_features.py <union>")
    cargo = shutil.which("cargo")
    if cargo is None:
        sys.exit("ERROR: cargo is not on PATH, so the workspace's feature lists cannot be read.")
    metadata = json.loads(
        subprocess.run(
            [cargo, "metadata", "--format-version", "1", "--locked", "--no-deps"],
            capture_output=True,
            text=True,
            check=True,
        ).stdout,
    )
    try:
        found = carried(metadata, argv[1].split(","))
    except ValueError as e:
        sys.exit(f"ERROR: {e}")
    for package, feature in found:
        print(f"{package} {feature}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
