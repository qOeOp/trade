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

It also holds the product's precision. The product runs at FIXED_PRECISION 16 (`high-precision`),
declared by vibe-strategy-factory itself, so every production package that links vibe-model must
resolve it with REQUIRED; a package that does not link vibe-model at all is named as such. And the
Makefile's standard-precision selection, which checks the inherited crates at 9, must resolve
vibe-model without it: a product crate that reached that selection would run at 16 under a
standard-precision name.

Usage: check-production-features.py [--self-test]

"""

from __future__ import annotations

import json
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

# Features every production package that links the crate must resolve: the product's precision.
REQUIRED = {"vibe-model": ("high-precision",)}

# The enablers a production build may still carry, by (crate, feature). `rstest` is only ever meant
# to arrive through `stubs`, so a stray `stubs` is refused once, by its own enabler.
ALLOWED = {
    ("vibe-model", "rstest"): {'vibe-model feature "stubs"'},
}

# A feature that exists for acceptance alone: compiled acceptance fixtures, corpora, grants or
# routes. A production image never enables one, in any crate, through any feature it does enable.
ACCEPTANCE_FEATURE = re.compile(r"^sealed-|acceptance")

TREE_LINE = re.compile(r"^(\d+)(.*)$")
PACKAGE_NODE = re.compile(r"^([A-Za-z0-9_-]+) v\S+")


Build = tuple[str, tuple[str, ...]]


def command_features(command: str) -> tuple[str, ...] | None:
    """
    Return the features a cargo command passes with `--features` or `-F`, or None when
    it passes `--all-features`, which no production image may use.
    """
    if "--all-features" in command:
        return None
    features: list[str] = []
    for match in re.finditer(r"(?:--features|-F)(?:\s+|=)(\"[^\"]*\"|'[^']*'|\S+)", command):
        features.extend(word for word in re.split(r"[,\s]+", match.group(1).strip("\"'")) if word)
    return tuple(sorted(set(features)))


def production_packages(root: Path) -> tuple[list[Build], list[str]]:
    """
    Return the packages the Dockerfiles under product/ build, each with the features its
    command passes, in first-seen order, and every cargo command there that names no
    package or passes `--all-features`.

    A `cargo build`, `cargo install` or `cargo run` is read only through an explicit
    `-p <package>` or `--package <package>`. One that names none - a bare workspace
    build, `cargo install --path ...` - is returned unparsed rather than skipped: a
    command this check cannot read must stop it, or the image it builds would pass
    unchecked. Images built from files outside product/ are out of scope; the one today,
    crates/strategy_factory/tools/program-seal.dockerfile, builds a `wasm32v1-none`
    guest that does not link vibe-model.

    """
    packages: list[Build] = []
    unparsed: list[str] = []
    for dockerfile in sorted((root / "product").rglob("Dockerfile*")):
        text = dockerfile.read_text(encoding="utf-8")
        commands = [
            command
            for match in re.finditer(r"cargo (?:build|install|run)\b(?:[^\n\\]|\\\n)*", text)
            # A shell line chains commands with `&&`, `||` or `;`, and each has its own features.
            for command in re.split(r"&&|\|\||;", match.group(0))
            if re.search(r"cargo (?:build|install|run)\b", command)
        ]
        for raw in commands:
            command = raw.strip().rstrip("\\").strip()
            named = re.findall(r"(?:-p|--package)\s+([A-Za-z0-9_-]+)", command)
            features = command_features(command)
            if not named or features is None:
                flat = " ".join(command.replace("\\\n", " ").split())
                unparsed.append(f"{dockerfile.relative_to(root)}: {flat}")
                continue
            for package in named:
                if (package, features) not in packages:
                    packages.append((package, features))
    return packages, unparsed


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


def missing_required(package: str, crate: str, tree: str) -> list[str]:
    """
    Return one refusal per REQUIRED feature of `crate` that `package` does not resolve.
    """
    found = enablers(tree, crate)
    return [
        f"{package}: {crate} resolves without {feature!r}, the product's precision"
        for feature in REQUIRED.get(crate, ())
        if feature not in found
    ]


def makefile_standard_precision_selection(makefile: str) -> list[str]:
    """
    Return the Makefile's STANDARD_PRECISION_ARGS as `cargo tree` arguments.

    `--lib` and `--tests` select targets, which `cargo tree` expresses as `-e
    normal,dev`.

    """
    variables = dict(re.findall(r"^(STANDARD_PRECISION_[A-Z]+) := (.*)$", makefile, re.MULTILINE))
    if "STANDARD_PRECISION_ARGS" not in variables:
        return []
    args = variables["STANDARD_PRECISION_ARGS"]
    for name, value in variables.items():
        args = args.replace(f"$({name})", value)
    words = re.findall(r'"[^"]*"|\S+', args)
    return [word.strip('"') for word in words if word not in ("--lib", "--tests")]


def build_selection(build: Build) -> list[str]:
    """
    Return the cargo selection that resolves `build` as its image builds it.
    """
    package, features = build
    return ["-p", package, *(["--features", ",".join(features)] if features else [])]


def build_label(build: Build) -> str:
    """
    Name a build in a message: its package, and its features when it passes any.
    """
    package, features = build
    return f"{package} --features {','.join(features)}" if features else package


def cargo_tree(build: Build, crate: str) -> str:
    """
    Resolve `build`'s normal dependencies, inverted at `crate`, as cargo tree prints
    them.
    """
    return cargo_tree_of(build_selection(build), "normal,features", crate)


def acceptance_crates() -> dict[str, list[str]]:
    """
    Return every workspace crate that declares an acceptance feature, with those
    features.
    """
    command = ["cargo", "metadata", "--locked", "--no-deps", "--format-version", "1"]
    completed = subprocess.run(command, cwd=ROOT, capture_output=True, text=True, check=False)
    if completed.returncode != 0:
        raise SystemExit(f"ERROR: {' '.join(command)} failed:\n{completed.stderr}")
    crates = {}
    for package in json.loads(completed.stdout)["packages"]:
        declared = sorted(name for name in package["features"] if ACCEPTANCE_FEATURE.search(name))
        if declared:
            crates[package["name"]] = declared
    return crates


def acceptance_features(tree: str, crate: str) -> dict[str, set[str]]:
    """
    Read `cargo tree -i <crate> -e normal,features --prefix depth` into each acceptance
    feature of `crate` it resolves, with its enablers.

    The tree must be inverted: a feature the root turns on through its own features reaches a
    dependency along a feature edge, which a forward tree does not print.

    """
    return {
        name: found
        for name, found in enablers(tree, crate).items()
        if ACCEPTANCE_FEATURE.search(name)
    }


def acceptance_refusals(build: Build, crates: dict[str, list[str]]) -> list[str]:
    """
    Refuse every acceptance feature, in any crate that declares one, that the image's
    build of `build` resolves.
    """
    problems = []
    for crate in sorted(crates):
        tree = cargo_tree(build, crate)
        for name, found in sorted(acceptance_features(tree, crate).items()):
            problems.append(
                f"{build_label(build)}: acceptance feature {crate}/{name} is enabled in a "
                f"production image by: {', '.join(sorted(found)) or 'the command line'}",
            )
    return problems


def cargo_tree_of(selection: list[str], edges: str, crate: str) -> str:
    """
    Resolve `selection`'s dependency graph over `edges`, inverted at `crate`.
    """
    command = [
        "cargo",
        "tree",
        "--locked",
        *selection,
        "-e",
        edges,
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
    packages, unparsed = production_packages(root)
    if not packages:
        print(
            "ERROR: no `cargo build -p` found in product/**/Dockerfile*; nothing was checked",
            file=sys.stderr,
        )
        return 1
    problems = [
        f"{command}: names no package or passes --all-features; extend production_packages(), "
        "build it with -p, and name its features"
        for command in unparsed
    ]
    unlinked = []
    crates = acceptance_crates()
    for build in packages:
        label = build_label(build)
        problems.extend(acceptance_refusals(build, crates))
        for crate in sorted(set(TEST_ONLY) | set(REQUIRED)):
            tree = cargo_tree(build, crate)
            if not tree:
                if crate in REQUIRED:
                    unlinked.append(label)
                continue
            if crate in TEST_ONLY:
                problems.extend(refusals(label, crate, tree))
            problems.extend(missing_required(label, crate, tree))
    problems.extend(standard_precision_refusals(root))
    if problems:
        print(
            "ERROR: a production image or the standard-precision selection has the wrong features:",
            file=sys.stderr,
        )
        for problem in problems:
            print(f"  {problem}", file=sys.stderr)
        print(
            "A test-only feature belongs in [dev-dependencies], and an acceptance feature never enters an "
            "image; high-precision belongs to the product "
            "crate's vibe-model dependency; a crate that brings high-precision into the standard-precision "
            "selection belongs in STANDARD_PRECISION_EXCLUDES.",
            file=sys.stderr,
        )
        return 1
    print(
        f"production features: no test-only or acceptance feature in "
        f"{', '.join(build_label(build) for build in packages)}; "
        f"high-precision wherever vibe-model is linked (not linked: "
        f"{', '.join(unlinked) or 'none'}); the standard-precision selection resolves without it",
    )
    return 0


def standard_precision_refusals(root: Path) -> list[str]:
    """
    Return a refusal when the Makefile's standard-precision selection is missing or
    resolves vibe-model with `high-precision`.
    """
    selection = makefile_standard_precision_selection(
        (root / "Makefile").read_text(encoding="utf-8"),
    )
    if not selection:
        return ["Makefile: STANDARD_PRECISION_ARGS was not found; nothing was checked"]
    tree = cargo_tree_of(selection, "normal,dev,features", "vibe-model")
    if "high-precision" in enablers(tree, "vibe-model"):
        return [
            "Makefile: STANDARD_PRECISION_ARGS resolves vibe-model with 'high-precision'; exclude "
            "the crate that brings it in, or the standard-precision check runs at 16",
        ]
    return []


FIXTURE_ALLOWED = """\
0vibe-model v0.62.0 (/w/crates/model)
1vibe-model feature "default"
2vibe-analysis v0.62.0 (/w/crates/analysis)
1vibe-model feature "rstest"
2vibe-model feature "stubs"
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


FIXTURE_ACCEPTANCE = """\
0vibe-data v0.62.0 (/w/crates/data)
1vibe-data feature "default"
2vibe-strategy-factory v0.62.0 (/w/crates/strategy_factory)
1vibe-data feature "sealed-strategy-input-acceptance"
2vibe-strategy-factory feature "sealed-strategy-input-acceptance"
3vibe-strategy-factory feature "sealed-develop-composer-acceptance"
4vibe-strategy-factory-rd-owner-api feature "sealed-develop-composer-acceptance" (command-line)
"""

FIXTURE_PRODUCTION = """\
0vibe-data v0.62.0 (/w/crates/data)
1vibe-data feature "default"
2vibe-strategy-factory v0.62.0 (/w/crates/strategy_factory)
"""


def test_only_feature_failures() -> list[str]:
    """
    Return what the test-only feature rule gets wrong on fixed trees and Dockerfiles.
    """
    failures = []
    if refusals("p", "vibe-model", FIXTURE_ALLOWED):
        failures.append("rstest-through-stubs was refused")
    stray = refusals("p", "vibe-model", FIXTURE_STRAY)
    if stray != [
        "p: vibe-model feature 'stubs' is enabled in production by: vibe-analysis, vibe-strategy-factory",
        "p: vibe-model feature 'rstest' is enabled in production by: vibe-risk",
    ]:
        failures.append(f"a stray stubs and rstest enabler were not both named: {stray}")
    if refusals("p", "vibe-model", FIXTURE_NESTED) != [
        "p: vibe-model feature 'stubs' is enabled in production by: vibe-risk, vibe-strategy-factory",
    ]:
        failures.append("an enabler printed under a nested feature line was missed")
    if refusals("p", "vibe-common", FIXTURE_COMMON) != [
        "p: vibe-common feature 'stubs' is enabled in production by: vibe-trading feature \"default\"",
    ]:
        failures.append("vibe-common's stubs, enabled through a feature, was not refused")
    if not refusals("p", "vibe-model", FIXTURE_COMMON):
        failures.append("a tree rooted at another crate passed as checked")
    return failures


def dockerfile_failures() -> list[str]:
    """
    Return what the Dockerfile reading and the acceptance rule get wrong on fixed files
    and trees.
    """
    failures = []
    dockerfile = "RUN cargo build --locked --release -p alpha \\\n      --bin a \\\n    && cargo build -p beta --bin b\n"
    with tempfile.TemporaryDirectory() as probe:
        (Path(probe) / "product").mkdir()
        (Path(probe) / "product/Dockerfile.x").write_text(dockerfile, encoding="utf-8")
        if production_packages(Path(probe)) != ([("alpha", ()), ("beta", ())], []):
            failures.append(
                f"the Dockerfile packages were misread: {production_packages(Path(probe))}",
            )
        (Path(probe) / "product/Dockerfile.y").write_text(
            "RUN cargo build --release \\\n    --locked\nRUN cargo install --path crates/tool\n"
            "RUN cargo build --package gamma\n",
            encoding="utf-8",
        )
        packages, unparsed = production_packages(Path(probe))
        if packages != [("alpha", ()), ("beta", ()), ("gamma", ())] or unparsed != [
            "product/Dockerfile.y: cargo build --release --locked",
            "product/Dockerfile.y: cargo install --path crates/tool",
        ]:
            failures.append(
                f"a command naming no package was not held unparsed: {packages} {unparsed}",
            )
        (Path(probe) / "product/Dockerfile.y").unlink()
        (Path(probe) / "product/Dockerfile.z").write_text(
            "RUN cargo build -p delta --features composer-v3-replay,native-replay-execution \\\n"
            '      --bin d \\\n    && cargo build -p epsilon -F "b a"\n'
            "RUN cargo build -p zeta --all-features\n",
            encoding="utf-8",
        )
        packages, unparsed = production_packages(Path(probe))
        if packages != [
            ("alpha", ()),
            ("beta", ()),
            ("delta", ("composer-v3-replay", "native-replay-execution")),
            ("epsilon", ("a", "b")),
        ] or unparsed != ["product/Dockerfile.z: cargo build -p zeta --all-features"]:
            failures.append(
                f"a command's features were misread, or --all-features was not held: {packages} {unparsed}",
            )
    found = acceptance_features(FIXTURE_ACCEPTANCE, "vibe-data")
    if found != {
        "sealed-strategy-input-acceptance": {
            'vibe-strategy-factory feature "sealed-strategy-input-acceptance"',
        },
    }:
        failures.append(f"an acceptance feature in a production tree was not named: {found}")
    if acceptance_features(FIXTURE_PRODUCTION, "vibe-data"):
        failures.append("a production feature was read as acceptance code")
    return failures


def precision_failures() -> list[str]:
    """
    Return what the precision rules get wrong on fixed trees and Makefiles.
    """
    failures = []
    if missing_required("p", "vibe-model", FIXTURE_ALLOWED) != [
        "p: vibe-model resolves without 'high-precision', the product's precision",
    ]:
        failures.append("a production vibe-model without high-precision was not refused")
    if missing_required(
        "p",
        "vibe-model",
        FIXTURE_ALLOWED + '1vibe-model feature "high-precision"\n',
    ):
        failures.append("a production vibe-model with high-precision was refused")
    makefile = (
        "STANDARD_PRECISION_EXCLUDES := --exclude a --exclude b\n"
        "STANDARD_PRECISION_ARGS := --workspace $(STANDARD_PRECISION_EXCLUDES) "
        '--no-default-features --lib --tests --features "ffi,python"\n'
    )
    expected = [
        "--workspace",
        "--exclude",
        "a",
        "--exclude",
        "b",
        "--no-default-features",
        "--features",
        "ffi,python",
    ]
    if makefile_standard_precision_selection(makefile) != expected:
        failures.append(
            f"the Makefile selection was misread: {makefile_standard_precision_selection(makefile)}",
        )
    if makefile_standard_precision_selection("OTHER := x\n"):
        failures.append("a Makefile without the selection read as a selection")
    return failures


def self_test() -> int:
    """
    Run the parsers and the verdicts against fixed trees in both directions.
    """
    failures = test_only_feature_failures() + dockerfile_failures() + precision_failures()
    if failures:
        for failure in failures:
            print(f"FAIL: {failure}", file=sys.stderr)
        return 1
    print(
        "check-production-features: allows rstest through stubs, names every stray enabler, refuses a "
        "tree it did not check, reads continued Dockerfile commands and their features, refuses "
        "--all-features and acceptance features, requires the product's precision, "
        "reads the Makefile's standard-precision selection",
    )
    return 0


if __name__ == "__main__":
    sys.exit(self_test() if sys.argv[1:] == ["--self-test"] else check(ROOT))
