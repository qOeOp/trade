#!/usr/bin/env python3
"""
Refuse a test-only Cargo feature in what a production image builds.

A production image builds each of its packages with `cargo build -p <package>`, so the features a
production binary carries are exactly what that package's normal dependencies resolve to. Twelve
core crates once declared `vibe-model = { features = ["stubs"] }` among their normal dependencies,
which compiled `vibe_model::stubs` (test fixtures) and `rstest` into every production binary, and a
production path came to build its instrument from one of those fixtures.

This reads the packages the Dockerfiles under product/ build, resolves each one's normal dependency
graph with `cargo tree`, and fails when a test-only feature is enabled by anything other than an
enabler named in ALLOWED. Every refusal names the package and what enabled the feature.

Usage: check-production-features.py [--self-test]

"""

from __future__ import annotations

import re
import subprocess
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
TARGET = "x86_64-unknown-linux-gnu"

# Features that exist for tests alone, by crate.
TEST_ONLY = {
    "vibe-model": ("stubs", "rstest"),
    "vibe-common": ("stubs",),
}

# The enablers a production build may still carry, by (crate, feature). `rstest` is only ever meant
# to arrive through `stubs`. The vibe-strategy-factory entry is the legacy formation path's stub
# instrument (`src/application.rs`); R&D has ruled that path retired, and this entry goes with it.
ALLOWED = {
    ("vibe-model", "stubs"): {"vibe-strategy-factory"},
    ("vibe-model", "rstest"): {'vibe-model feature "stubs"'},
}

TREE_LINE = re.compile(r"^(\d+)(.*)$")
PACKAGE_NODE = re.compile(r"^([A-Za-z0-9_-]+) v\S+")


def production_packages(root: Path) -> list[str]:
    """
    Return the packages the Dockerfiles under product/ build, in first-seen order.
    """
    packages: list[str] = []
    for dockerfile in sorted((root / "product").rglob("Dockerfile*")):
        text = dockerfile.read_text(encoding="utf-8")
        for match in re.finditer(r"cargo build\b(?:[^\n\\]|\\\n)*", text):
            for package in re.findall(r"-p\s+([A-Za-z0-9_-]+)", match.group(0)):
                if package not in packages:
                    packages.append(package)
    return packages


def enablers(tree: str, crate: str) -> dict[str, set[str]]:
    """
    Read `cargo tree -i <crate> -e normal,features --prefix depth` into feature ->
    enablers.

    cargo prints a node's children once, where the node first appears, and marks every later
    appearance `(*)`. That first appearance is not always at depth 1: a feature enabled through
    another feature is printed nested under it (`stubs` under `rstest`), and its depth-1 line is
    then only a `(*)` reference. So a feature's enablers are the children of whichever of its
    lines is not marked, at any depth: a package, named by its package name, or another feature,
    named as cargo prints it.

    """
    result: dict[str, set[str]] = {}
    open_features: dict[int, str] = {}
    feature_node = re.compile(re.escape(crate) + r' feature "([^"]+)"')
    for line in tree.splitlines():
        match = TREE_LINE.match(line)
        if not match:
            continue
        depth, node = int(match.group(1)), match.group(2).strip()
        for deeper in [d for d in open_features if d >= depth]:
            del open_features[deeper]
        name = node.removesuffix(" (*)")
        if depth - 1 in open_features:
            package = PACKAGE_NODE.match(name)
            result[open_features[depth - 1]].add(package.group(1) if package else name)
        feature = feature_node.fullmatch(node)
        if feature:
            result.setdefault(feature.group(1), set())
            open_features[depth] = feature.group(1)
    return result


def refusals(package: str, crate: str, tree: str) -> list[str]:
    """
    Return one refusal per test-only feature of `crate` that `package` enables without
    leave.
    """
    if not re.match(r"^0" + re.escape(crate) + r" v", tree):
        return [f"{package}: `cargo tree -i {crate}` did not start at {crate}; nothing was checked"]
    found = enablers(tree, crate)
    out = []
    for feature in TEST_ONLY[crate]:
        stray = sorted(found.get(feature, set()) - ALLOWED.get((crate, feature), set()))
        if stray:
            out.append(
                f"{package}: {crate} feature {feature!r} is enabled in production by: {', '.join(stray)}",
            )
    return out


def cargo_tree(package: str, crate: str) -> str:
    """
    Resolve `package`'s normal dependencies, inverted at `crate`, as cargo tree prints
    them.
    """
    command = [
        "cargo",
        "tree",
        "--locked",
        "-p",
        package,
        "-e",
        "normal,features",
        "--target",
        TARGET,
        "-i",
        crate,
        "--prefix",
        "depth",
    ]
    completed = subprocess.run(command, cwd=ROOT, capture_output=True, text=True, check=False)
    if completed.returncode != 0:
        # A package that does not depend on the crate at all carries none of its features.
        if "did not match any packages" in completed.stderr:
            return ""
        raise SystemExit(f"ERROR: {' '.join(command)} failed:\n{completed.stderr}")
    return completed.stdout


def check(root: Path) -> int:
    """
    Check every production package against every test-only feature and report the
    outcome.
    """
    packages = production_packages(root)
    if not packages:
        print(
            "ERROR: no `cargo build -p` found in product/**/Dockerfile*; nothing was checked",
            file=sys.stderr,
        )
        return 1
    problems = []
    for package in packages:
        for crate in TEST_ONLY:
            tree = cargo_tree(package, crate)
            if tree:
                problems.extend(refusals(package, crate, tree))
    if problems:
        print("ERROR: a production image builds with a test-only feature:", file=sys.stderr)
        for problem in problems:
            print(f"  {problem}", file=sys.stderr)
        print(
            "Move the feature to [dev-dependencies]; a production path must not need test stubs.",
            file=sys.stderr,
        )
        return 1
    print(
        f"production features: no test-only feature in {', '.join(packages)} beyond the named exception",
    )
    return 0


FIXTURE_ALLOWED = """\
0vibe-model v0.62.0 (/w/crates/model)
1vibe-model feature "default"
2vibe-analysis v0.62.0 (/w/crates/analysis)
1vibe-model feature "rstest"
2vibe-model feature "stubs"
1vibe-model feature "stubs"
2vibe-strategy-factory v0.62.0 (/w/crates/strategy_factory)
"""
FIXTURE_STRAY = """\
0vibe-model v0.62.0 (/w/crates/model)
1vibe-model feature "stubs"
2vibe-analysis v0.62.0 (/w/crates/analysis)
2vibe-strategy-factory v0.62.0 (/w/crates/strategy_factory)
1vibe-model feature "rstest"
2vibe-model feature "stubs"
2vibe-risk v0.62.0 (/w/crates/risk) (*)
"""
# The shape cargo really prints once `stubs` arrives through `rstest`: its enablers are listed at depth
# 3 under the nested line, and its own depth-1 line is only a reference.
FIXTURE_NESTED = """\
0vibe-model v0.62.0 (/w/crates/model)
1vibe-model feature "rstest"
2vibe-model feature "stubs"
3vibe-risk v0.62.0 (/w/crates/risk) (*)
3vibe-strategy-factory v0.62.0 (/w/crates/strategy_factory) (*)
1vibe-model feature "stubs" (*)
"""
FIXTURE_COMMON = """\
0vibe-common v0.62.0 (/w/crates/common)
1vibe-common feature "stubs"
2vibe-trading feature "default"
"""


def self_test() -> int:
    """
    Run the parser and the verdict against fixed trees in both directions.
    """
    failures = []
    if refusals("p", "vibe-model", FIXTURE_ALLOWED):
        failures.append("the named exception and rstest-through-stubs were refused")
    stray = refusals("p", "vibe-model", FIXTURE_STRAY)
    if stray != [
        "p: vibe-model feature 'stubs' is enabled in production by: vibe-analysis",
        "p: vibe-model feature 'rstest' is enabled in production by: vibe-risk",
    ]:
        failures.append(f"a stray stubs and rstest enabler were not both named: {stray}")
    if refusals("p", "vibe-model", FIXTURE_NESTED) != [
        "p: vibe-model feature 'stubs' is enabled in production by: vibe-risk",
    ]:
        failures.append("an enabler printed under a nested feature line was missed")
    if refusals("p", "vibe-common", FIXTURE_COMMON) != [
        "p: vibe-common feature 'stubs' is enabled in production by: vibe-trading feature \"default\"",
    ]:
        failures.append("vibe-common's stubs, enabled through a feature, was not refused")
    if not refusals("p", "vibe-model", FIXTURE_COMMON):
        failures.append("a tree rooted at another crate passed as checked")
    dockerfile = "RUN cargo build --locked --release -p alpha \\\n      --bin a \\\n    && cargo build -p beta --bin b\n"
    with tempfile.TemporaryDirectory() as probe:
        (Path(probe) / "product").mkdir()
        (Path(probe) / "product/Dockerfile.x").write_text(dockerfile, encoding="utf-8")
        if production_packages(Path(probe)) != ["alpha", "beta"]:
            failures.append(
                f"the Dockerfile packages were misread: {production_packages(Path(probe))}",
            )
    if failures:
        for failure in failures:
            print(f"FAIL: {failure}", file=sys.stderr)
        return 1
    print(
        "check-production-features: allows the named exception, names every stray enabler, refuses a tree it did not check, reads continued Dockerfile commands",
    )
    return 0


if __name__ == "__main__":
    sys.exit(self_test() if sys.argv[1:] == ["--self-test"] else check(ROOT))
