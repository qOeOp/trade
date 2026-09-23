#!/usr/bin/env python3
"""
Name the Cargo features that gate code no gate compiles, and fail when a new one
appears.

A feature nobody compiles is not a warning the build emits: the code behind `#[cfg(feature = ...)]`
is simply absent from every artifact, so it cannot fail to build, cannot fail a lint, and cannot
fail a test. It accumulates silently and surfaces only when someone finally turns the feature on.

This is a guard, not a report. What CI compiles is resolved by asking Cargo, not by reading the
`--features` strings, because a string enables features it does not name; what CI lints is the set
below. Every gated feature outside both is listed in EXPECTED_UNCOVERED with the reason it is
there. A gated feature in neither fails this check, so adding one is a decision somebody writes
down rather than a silence - and so is a feature that becomes compiled, because its entry then
contradicts Cargo and this check says so.

"""

import collections
import json
import pathlib
import re
import shutil
import subprocess
import sys


# Linted by `scripts/clippy-changed.sh`: DESIRED_FEATURES, intersected per package, plus the four
# formats that script adds for `vibe-serialization` alone.
LINTED = {"ffi", "python", "high-precision", "defi", "arrow", "capnp", "display", "sbe"}

# `COMPILED` is not written here. It is resolved by asking Cargo what the `--features` strings CI
# passes actually turn on, because a string does not name every feature it enables: `a/x` inside a
# dependency's feature list turns on `x` over there, and the string that mentions only `a` says so
# nowhere. A hand-written set recorded the conclusion instead of that input, and eleven features the
# ordered chain compiles every round were listed below as compiled by nothing. Nothing could have
# caught it, because the set and the list were both written by the same reading.


# Gated features outside both sets. Each entry states why it is not covered, because "nobody
# compiles it" is a fact about CI rather than a property of the feature, and the two are fixed
# differently.
EXPECTED_UNCOVERED = {
    # Sealed acceptances no CI feature string turns on, directly or through another crate's
    # feature list. Cargo is asked for that, so an entry here that becomes reachable fails below.
    "isolated-event-replay-acceptance": "sealed acceptance named by no --features string",
    # Named only by workflows that do not run here.
    "turmoil": "nightly-tests.yml only; every job there is upstream-guarded",
    # Named only by `make docsrs-check`, whose two callers are both skipped: build.yml's
    # `release-docs-features-preflight` and the upstream-guarded nightly-docs-features-check.yml.
    "gateway": "docsrs-check only; both callers skipped",
    "persistence": "docsrs-check only; both callers skipped",
    "indicators": "docsrs-check only; both callers skipped",
    "tracing-bridge": "docsrs-check only; both callers skipped",
    # Named by a script that is run by hand.
    "fuzz": "scripts/fuzz-adapter.sh only; run by hand",
    # Gate code in crates whose feature reaches no job.
    "betfair": "crates/pyo3 bindings for a venue the test gate excludes",
    "owner-recovery": "crates/qualification; no --features string names it",
}

# POSIX ERE, for `git grep -E`. Not a Python pattern: `re` reads `[[:space:]]` as a nested set.
GATE = r'cfg\([[:space:]]*feature[[:space:]]*=[[:space:]]*"[a-z0-9_-]+"'
NAME = re.compile(r'"([a-z0-9_-]+)"')


def gated_features() -> collections.Counter:
    """
    Every feature name that gates code, with how many `cfg` sites name it.
    """
    git = shutil.which("git")
    if git is None:
        sys.exit("ERROR: git is not on PATH, so nothing here can be measured.")
    proc = subprocess.run(
        [git, "grep", "-hoE", GATE, "--", "crates/", "product/"],
        capture_output=True,
        text=True,
        check=False,
    )
    found = collections.Counter(NAME.findall(proc.stdout))
    # A zero here means the pattern stopped matching, not that the repository stopped gating code.
    # `git grep -E` is POSIX ERE and does not know `\s`; this asserts the instrument before its
    # output is read as a finding.
    if not found:
        sys.exit(
            "ERROR: no `cfg(feature = ...)` sites matched. The pattern is broken, not the tree.",
        )
    return found


WORKFLOWS = pathlib.Path(".github/workflows")
YAML_EXTRA = re.compile(r"^(\s*)RUST_TEST_EXTRA_FEATURES:\s*(.*)$")
SHELL_EXTRA = re.compile(r'EXTRA_FEATURES="([^"$]+)"')
# The make variables every CI Rust invocation passes to `--features`. Each is expanded once per
# `EXTRA_FEATURES` value the workflows set, because that is the only input that varies between them.
FEATURE_VARIABLES = (
    "CARGO_FEATURES",
    "RD_OWNER_POSTGRES_FEATURES",
    "CORE_SELECTED_FEATURES",
)


def tool(name: str) -> str:
    """
    Resolve a required tool, or say that nothing here can be measured without it.
    """
    found = shutil.which(name)
    if found is None:
        sys.exit(f"ERROR: {name} is not on PATH, so what CI compiles cannot be resolved.")
    return found


def ci_extra_features() -> set[str]:
    """
    Every `EXTRA_FEATURES` value the workflows set, including the empty default.
    """
    values = {""}
    for workflow in sorted(WORKFLOWS.glob("*.yml")):
        lines = workflow.read_text(encoding="utf-8").splitlines()
        for index, line in enumerate(lines):
            values.update(SHELL_EXTRA.findall(line))
            match = YAML_EXTRA.match(line)
            if match is None:
                continue
            indent, inline = match.group(1), match.group(2).strip()
            if inline not in {">-", ">", "|", "|-"}:
                values.add(inline)
                continue
            # A folded block: the value is every following line indented past the key.
            folded = []
            for continued in lines[index + 1 :]:
                if continued.strip() and not continued.startswith(indent + " "):
                    break
                folded.append(continued.strip())
            values.add("".join(folded))
    # A zero here means the patterns stopped matching, not that CI stopped passing features.
    if values == {""}:
        sys.exit(
            "ERROR: no `EXTRA_FEATURES` value was found in .github/workflows. The patterns are "
            "broken, not the workflows.",
        )
    return values


def ci_feature_strings() -> set[str]:
    """
    Every string CI hands to `--features`, taken from the make variables that build
    them.
    """
    make = tool("make")
    strings = set()
    for extra in sorted(ci_extra_features()):
        proc = subprocess.run(
            [
                make,
                "--eval=print-%: ; @echo $($*)",
                *(f"print-{variable}" for variable in FEATURE_VARIABLES),
                f"EXTRA_FEATURES={extra}",
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        strings.update(line.strip() for line in proc.stdout.splitlines() if line.strip())
    if not strings:
        sys.exit(
            "ERROR: make printed no feature string. The variable names here no longer exist in the "
            "Makefile.",
        )
    return strings


def compiled_features() -> set[str]:
    """
    Every feature Cargo turns on for a workspace crate under any of CI's `--features`
    strings.
    """
    cargo = tool("cargo")
    enabled: set[str] = set()
    for features in sorted(ci_feature_strings()):
        proc = subprocess.run(
            [cargo, "metadata", "--format-version", "1", "--features", features],
            capture_output=True,
            text=True,
            check=False,
        )
        if proc.returncode != 0:
            sys.exit(f"ERROR: `cargo metadata --features {features}` failed:\n{proc.stderr}")
        metadata = json.loads(proc.stdout)
        # `resolve.nodes` carries the features Cargo settled on per package, which is the answer
        # this script needs. `cargo tree -e features` cannot give it: that command prints a
        # feature only where a package appears as somebody's dependency, so a workspace crate
        # nothing depends on contributes none of its own features and reads as uncompiled.
        members = set(metadata["workspace_members"])
        for node in metadata["resolve"]["nodes"]:
            if node["id"] in members:
                enabled.update(node["features"])
    # Cargo resolved nothing: the flags changed, or the workspace does not build here. Either way
    # the set would read as "CI compiles no feature at all" and condemn every gated feature.
    if not enabled:
        sys.exit(
            "ERROR: `cargo metadata` reported no feature for any workspace crate. The instrument "
            "is broken, not the workspace.",
        )
    return enabled


def main() -> int:
    found = gated_features()
    # `LINTED` joins them because `scripts/clippy-changed.sh` builds what it lints, so a feature
    # that job names is compiled by it even when no test string turns it on.
    compiled = compiled_features() | LINTED
    uncovered = {f: c for f, c in found.items() if f not in compiled}
    unlinted = {f: c for f, c in found.items() if f in compiled and f not in LINTED}

    print(f"gated features: {len(found)} names across {sum(found.values())} cfg sites")
    print(f"  compiled and linted   {len([f for f in found if f in LINTED])}")
    # Each detail block follows the summary line it belongs to. Both were printed after the last
    # summary line, so every feature CI compiles but never lints read as one nothing compiles.
    print(f"  compiled, never lint  {len(unlinted)}  ({sum(unlinted.values())} sites)")
    for feature, count in sorted(unlinted.items(), key=lambda kv: -kv[1]):
        print(f"    {feature:48s} {count:4d} sites")
    print(f"  never compiled        {len(uncovered)}  ({sum(uncovered.values())} sites)")
    # Naming them is what this script is for. They were counted and left unnamed unless they were
    # also an error, so the answer to "which features does no job compile" was a number.
    for feature, count in sorted(uncovered.items(), key=lambda kv: -kv[1]):
        print(
            f"    {feature:48s} {count:4d} sites  {EXPECTED_UNCOVERED.get(feature, 'unexplained')}",
        )

    unexplained = sorted(f for f in uncovered if f not in EXPECTED_UNCOVERED)
    stale = sorted(f for f in EXPECTED_UNCOVERED if f not in uncovered)

    for feature in unexplained:
        print(
            f"ERROR: `{feature}` gates {uncovered[feature]} cfg sites and no job compiles it, and "
            f"nothing here says why.",
            file=sys.stderr,
        )
    for feature in stale:
        print(
            f"ERROR: `{feature}` is listed as uncovered and is now either compiled or no longer "
            f"gating any code. Remove it from EXPECTED_UNCOVERED.",
            file=sys.stderr,
        )

    if unexplained or stale:
        return 1
    print("ok: every gated feature is compiled, or is listed with the reason it is not")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
