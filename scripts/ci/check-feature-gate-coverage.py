#!/usr/bin/env python3
"""
Name the Cargo features that gate code no gate compiles, and fail when a new one
appears.

A feature nobody compiles is not a warning the build emits: the code behind `#[cfg(feature = ...)]`
is simply absent from every artifact, so it cannot fail to build, cannot fail a lint, and cannot
fail a test. It accumulates silently and surfaces only when someone finally turns the feature on.

This is a guard, not a report. The two sets below record what CI compiles and what CI lints, and
every gated feature outside them is listed in EXPECTED_UNCOVERED with the reason it is there. A
gated feature that appears in neither the sets nor that list fails this check, so adding one is a
decision somebody writes down rather than a silence.

"""

import collections
import re
import shutil
import subprocess
import sys


# Linted by `scripts/clippy-changed.sh`: DESIRED_FEATURES, intersected per package, plus the four
# formats that script adds for `vibe-serialization` alone.
LINTED = {"ffi", "python", "high-precision", "defi", "arrow", "capnp", "display", "sbe"}

# Compiled by the `rust tests` job and the ordered Owner chains. `--all-features` exists only in
# `make clippy` and `make docsrs-check`, and neither runs: `make clippy` has no CI caller, and
# `docsrs-check`'s two callers are `build.yml`'s `release-docs-features-preflight` (skipped on
# every recent run) and `nightly-docs-features-check.yml` (guarded on the upstream repository).
COMPILED = LINTED | {
    "streaming",
    "hypersync",
    "postgres",
    "sealed-develop-composer-acceptance",
    "sealed-source-intake-acceptance",
    "sealed-artifact-source-browser-acceptance",
}

# Gated features outside both sets. Each entry states why it is not covered, because "nobody
# compiles it" is a fact about CI rather than a property of the feature, and the two are fixed
# differently.
EXPECTED_UNCOVERED = {
    # Sealed acceptances. Each gates code and appears in no `--features` string anywhere in
    # `.github/`, the Makefile or `scripts/`.
    "sealed-source-intake-composer-acceptance": "sealed acceptance named by no --features string",
    "sealed-strategy-input-acceptance": "sealed acceptance named by no --features string",
    "sealed-source-intake-research-acceptance": "sealed acceptance named by no --features string",
    "sealed-artifact-source-acceptance": "sealed acceptance named by no --features string",
    "isolated-event-replay-acceptance": "sealed acceptance named by no --features string",
    # Named only by workflows that do not run here.
    "turmoil": "nightly-tests.yml only; every job there is upstream-guarded",
    "transport-sockudo": "nightly-tests.yml only; every job there is upstream-guarded",
    # Named only by `make docsrs-check`, whose two callers are both skipped: build.yml's
    # `release-docs-features-preflight` and the upstream-guarded nightly-docs-features-check.yml.
    "examples": "docsrs-check only; both callers skipped",
    "live": "docsrs-check only; both callers skipped",
    "cloud": "docsrs-check only; both callers skipped",
    "gateway": "docsrs-check only; both callers skipped",
    "persistence": "docsrs-check only; both callers skipped",
    "node": "docsrs-check only; both callers skipped",
    "indicators": "docsrs-check only; both callers skipped",
    "plugin": "docsrs-check only; both callers skipped",
    "redis": "docsrs-check only; both callers skipped",
    "replay": "docsrs-check only; both callers skipped",
    "tracing-bridge": "docsrs-check only; both callers skipped",
    # Named by a script that is run by hand.
    "fuzz": "scripts/fuzz-adapter.sh only; run by hand",
    # Gate code in crates whose feature reaches no job.
    "betfair": "crates/pyo3 bindings for a venue the test gate excludes",
    "datasets": "crates/testkit helper; no --features string names it",
    "testers": "crates/testkit helper; no --features string names it",
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


def main() -> int:
    found = gated_features()
    uncovered = {f: c for f, c in found.items() if f not in COMPILED}
    unlinted = {f: c for f, c in found.items() if f in COMPILED and f not in LINTED}

    print(f"gated features: {len(found)} names across {sum(found.values())} cfg sites")
    print(f"  compiled and linted   {len([f for f in found if f in LINTED])}")
    print(f"  compiled, never lint  {len(unlinted)}  ({sum(unlinted.values())} sites)")
    print(f"  never compiled        {len(uncovered)}  ({sum(uncovered.values())} sites)")

    for feature, count in sorted(unlinted.items(), key=lambda kv: -kv[1]):
        print(f"    unlinted  {feature:44s} {count:4d} sites")

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
