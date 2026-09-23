#!/usr/bin/env python3
"""
Prove that `check-feature-gate-coverage.py` asks Cargo what CI compiles.

The guard once carried a hand-written set of "what CI compiles", read off the `--features` strings
by eye. A string does not name every feature it enables - `a/x` inside a dependency's feature list
turns on `x` over there - so thirteen of its twenty-three "no job compiles it" entries named code
the ordered chain compiles every round. Nothing caught it, because the set and the entries were the
same reading written twice.

This pins the property that reading cannot satisfy: a feature no CI string mentions, that Cargo
still turns on, must count as compiled. It also pins the other side, because a check that calls
everything compiled would pass the first half and prove nothing.

"""

import importlib.util
import pathlib
import sys


HERE = pathlib.Path(__file__).resolve().parent
GUARD = HERE / "check-feature-gate-coverage.py"

# Enabled only through another crate's feature list: `vibe-strategy-factory-rd-owner-api/
# sealed-source-intake-acceptance` is what the Makefile passes, and it turns this on over in
# `vibe-strategy-factory`. No `--features` string anywhere in the repository says this name.
TRANSITIVELY_ENABLED = "sealed-strategy-input-acceptance"

# Turned on by nothing CI builds. If this ever reads as compiled, either CI started compiling it -
# a change worth noticing, and the reason `sealed-source-intake-composer-acceptance` stopped being
# this probe when the ordered chain took it - or the resolution below stopped discriminating.
ENABLED_BY_NOTHING = "isolated-event-replay-acceptance"


def load() -> object:
    """
    Import the guard, whose file name is not an identifier.
    """
    spec = importlib.util.spec_from_file_location("feature_gate_coverage", GUARD)
    if spec is None or spec.loader is None:
        sys.exit(f"ERROR: {GUARD} could not be loaded, so nothing here can be checked.")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main() -> int:
    guard = load()
    strings = guard.ci_feature_strings()
    compiled = guard.compiled_features()

    failures = []

    # The instrument that replaced the hand-written set. Both halves are needed: the first alone
    # passes for a resolution that returns every feature name in the workspace.
    if TRANSITIVELY_ENABLED not in compiled:
        failures.append(
            f"`{TRANSITIVELY_ENABLED}` is enabled by another crate's feature list and is not "
            f"resolved as compiled. The guard is reading feature strings again.",
        )
    if ENABLED_BY_NOTHING in compiled:
        failures.append(
            f"`{ENABLED_BY_NOTHING}` is named by no feature string and reached by no feature "
            f"list, and is resolved as compiled. The resolution no longer discriminates.",
        )

    # The reason the first half is not a tautology: no string says this name, so no amount of
    # reading them produces it. This also fails if someone adds it to a string, which would make
    # the first assertion pass for a reason that teaches nothing.
    naming = sorted(s for s in strings if TRANSITIVELY_ENABLED in s)
    if naming:
        failures.append(
            f"`{TRANSITIVELY_ENABLED}` is now named directly by {len(naming)} feature string(s), "
            f"so it no longer probes transitive resolution. Pick another one.",
        )

    for failure in failures:
        print(f"ERROR: {failure}", file=sys.stderr)
    if failures:
        return 1
    print(
        f"ok: `{TRANSITIVELY_ENABLED}` is compiled through a feature list no string names, and "
        f"`{ENABLED_BY_NOTHING}` is not compiled",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
