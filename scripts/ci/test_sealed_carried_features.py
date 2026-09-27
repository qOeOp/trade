#!/usr/bin/env python3
"""
Both directions for sealed_carried_features.py, against a stand-in workspace.

- a non-sealed feature the union reaches is carried, whether through its own package's list, a
  renamed dependency, or a weak `dep?/feature` entry;
- a sealed feature it reaches, a feature the union names, an optional-dependency `dep:` entry and a
  package outside the workspace are not;
- a cycle in the feature lists ends;
- a union entry no workspace package has is refused rather than read as "carries nothing";
- a union that carries nothing answers nothing.

"""

from __future__ import annotations

import sys
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parent))
from sealed_carried_features import carried


def package(name: str, features: dict[str, list[str]], dependencies=()) -> dict:
    return {
        "id": f"{name} 0.1.0",
        "name": name,
        "features": features,
        "dependencies": [{"name": dep, "rename": rename} for dep, rename in dependencies],
    }


METADATA = {
    "workspace_members": ["api 0.1.0", "factory 0.1.0", "edge 0.1.0"],
    "packages": [
        package(
            "api",
            {
                "default": [],
                "issuance": [],
                "replay": ["issuance", "sf/replay", "cycle-a"],
                "cycle-a": ["cycle-b"],
                "cycle-b": ["cycle-a"],
                "sealed-acceptance": ["replay", "sealed-inner", "dep:optional", "edge?/weak"],
                "sealed-inner": [],
                "unrelated": [],
            },
            dependencies=[("factory", "sf"), ("edge", None), ("outside", None)],
        ),
        package(
            "factory",
            {"default": [], "replay": ["outside/leak"], "sealed-own": []},
            dependencies=[("outside", None)],
        ),
        package("edge", {"weak": [], "sealed-deployment": []}),
        package("outside", {"leak": []}),
    ],
}


def expect(label: str, union: list[str], want: list[tuple[str, str]]) -> None:
    got = carried(METADATA, union)
    if got != want:
        sys.exit(f"FAIL {label}: expected {want}, got {got}")
    print(f"ok {label}")


def main() -> None:
    expect(
        "a sealed feature's non-sealed reach",
        ["api/sealed-acceptance"],
        [
            ("api", "cycle-a"),
            ("api", "cycle-b"),
            ("api", "issuance"),
            ("api", "replay"),
            ("edge", "weak"),
            ("factory", "replay"),
        ],
    )
    expect(
        "a feature the union names is not carried by it",
        ["api/sealed-acceptance", "api/replay"],
        [
            ("api", "cycle-a"),
            ("api", "cycle-b"),
            ("api", "issuance"),
            ("edge", "weak"),
            ("factory", "replay"),
        ],
    )
    expect("a union that carries nothing", ["edge/sealed-deployment"], [])
    try:
        carried(METADATA, ["api/sealed-missing"])
    except ValueError as e:
        print(f"ok an unknown union entry is refused: {e}")
    else:
        sys.exit("FAIL an unknown union entry was walked as if it carried nothing")
    try:
        carried(METADATA, ["outside/leak"])
    except ValueError:
        print("ok a union entry outside the workspace is refused")
    else:
        sys.exit("FAIL a union entry outside the workspace was accepted")
    print("ok: carried features are exactly the non-sealed workspace features the union reaches")


if __name__ == "__main__":
    main()
