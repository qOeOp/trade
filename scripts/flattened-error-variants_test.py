#!/usr/bin/env python3
r"""
Calibrate flattened-error-variants.py on a repository it owns, in both directions.

The calibration runs against synthetic source committed to a throwaway git repository, not
against this one. A control that lives in the real tree is only as stable as the thing it
points at: the first positive control here was a real flattened variant, and the day it was
fixed the calibration went red for a reason that had nothing to do with the tool. Synthetic
source changes only when this file does.

Every check has a partner that answers the other way, because a walk that silently fails to
follow an edge produces the same short list as a walk that followed everything and found
little. The source is kept as a string rather than as files in this repository because any
`.rs` file under a `src/` directory here would be scanned as production code by this tool and
by production-producer-check.py.

Run: python3 -B scripts/flattened-error-variants_test.py

"""

import importlib.util
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


TOOL = Path(
    os.environ.get("FLATTENED_ERROR_VARIANTS_TOOL")
    or Path(__file__).with_name("flattened-error-variants.py"),
)

LIB = "crates/fixture/src/lib.rs"

# One enum, one variant per outcome, and one function per kind of edge. Every function name is
# declared once, so no step of the walk depends on attributing an ambiguous name.
SOURCE = """\
pub struct Unit;

pub enum FixtureError {
    Refused,
    Passed,
    Observed,
    Unused,
}

fn produce_refused() -> Result<(), FixtureError> {
    Err(FixtureError::Refused)
}

fn relay() -> Result<(), FixtureError> {
    produce_refused()
}

pub fn flattened_edge() -> Result<(), Unit> {
    relay().map_err(|_| Unit)
}

fn produce_passed() -> Result<(), FixtureError> {
    Err(FixtureError::Passed)
}

pub fn passing_edge() -> Result<(), FixtureError> {
    produce_passed()?;
    Ok(())
}

fn produce_observed() -> Result<(), FixtureError> {
    Err(FixtureError::Observed)
}

pub fn observing_edge() -> u16 {
    match produce_observed() {
        Err(FixtureError::Observed) => 409,
        _ => 503,
    }
}

fn two_arguments(first: u8, second: u8) -> Result<u8, Unit> {
    if first > second { Err(Unit) } else { Ok(first) }
}

pub fn multi_line_edge() -> Result<u8, u16> {
    two_arguments(
        1,
        2,
    )
    .map_err(|_| 503)
}

fn maybe() -> Result<u8, Unit> {
    Ok(1)
}

pub fn let_ok_edge() -> u8 {
    let Ok(value) = maybe() else {
        return 0;
    };
    value
}

fn maybe_again() -> Result<u8, Unit> {
    Ok(2)
}

pub fn ok_edge() -> Option<u8> {
    maybe_again().ok()
}

pub enum SingleError {
    Only,
    Other,
}

fn produce_only() -> Result<(), SingleError> {
    Err(SingleError::Only)
}

pub fn renamed_edge() -> Result<(), Unit> {
    produce_only().map_err(|_| {
        Unit
    })
}

pub enum PairError {
    First,
    Second,
}

fn produce_pair(flag: bool) -> Result<(), PairError> {
    if flag {
        return Err(PairError::First);
    }
    Err(PairError::Second)
}

pub fn lossy_edge() -> Result<(), Unit> {
    produce_pair(true).map_err(|_| Unit)
}
"""


def load_tool():
    spec = importlib.util.spec_from_file_location("flattened_error_variants", TOOL)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def guard_enclosing_repository():
    """
    Record the repository this runs from, and return a check that it is still as it was.

    The record is read with the environment as inherited - before `fixture_repository()`
    clears it - because that environment names the repository a leak would damage: run as a
    commit hook in a linked worktree, the shared repository behind every worktree. The check
    fails if it became bare or its HEAD moved.

    """
    git = shutil.which("git") or "git"
    env = dict(os.environ)
    home = Path.cwd()

    def read(*arguments):
        result = subprocess.run(
            [git, *arguments],
            cwd=home,
            env=env,
            capture_output=True,
            text=True,
            check=False,
        )
        return result.stdout.strip() if result.returncode == 0 else None

    def state():
        return {
            "core.bare": read("config", "--get", "core.bare"),
            "HEAD": read("rev-parse", "HEAD"),
        }

    before = state()

    def check():
        after = state()
        failures = [
            f"the enclosing repository's {name} was {before[name]!r} and is now {after[name]!r}"
            for name in before
            if after[name] != before[name]
        ]
        if after["core.bare"] == "true":
            failures.append(
                "the enclosing repository is now bare; every worktree sharing it is broken",
            )
        return failures

    return check


def fixture_repository():
    """
    Return (directory, rev) of a fresh git repository holding SOURCE at LIB.

    The commit is checked, not assumed: a commit that fails for want of an identity
    leaves HEAD where it was, and every check would then read a tree that is not this
    one.

    """
    # Run from a git hook, the environment names the enclosing repository (GIT_DIR,
    # GIT_INDEX_FILE, ...), and every git call below would act on it instead: `git init`
    # re-initialises it as bare, which breaks every worktree that shares it. Nothing here may
    # inherit that, and the tool's own reads of the fixture must not either.
    for name in [name for name in os.environ if name.startswith("GIT_")]:
        del os.environ[name]
    directory = tempfile.mkdtemp(prefix="flattened-error-variants-")
    path = Path(directory) / LIB
    path.parent.mkdir(parents=True)
    path.write_text(SOURCE)
    git = shutil.which("git") or "git"
    identity = ["-c", "user.name=calibration", "-c", "user.email=calibration@invalid"]
    for arguments in (["init", "-q"], ["add", LIB], [*identity, "commit", "-q", "-m", "fixture"]):
        subprocess.run([git, *arguments], cwd=directory, check=True)
    toplevel = subprocess.run(
        [git, "rev-parse", "--show-toplevel"],
        cwd=directory,
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()
    if Path(toplevel).resolve() != Path(directory).resolve():
        sys.exit(f"the fixture resolves to the repository at {toplevel}, not {directory}")
    rev = subprocess.run(
        [git, "rev-parse", "HEAD"],
        cwd=directory,
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()
    listed = subprocess.run(
        [git, "ls-tree", "-r", "--name-only", rev],
        cwd=directory,
        capture_output=True,
        text=True,
        check=True,
    ).stdout.split()
    if listed != [LIB]:
        sys.exit(
            f"the fixture commit holds {listed}, not [{LIB}]; nothing below would mean anything",
        )
    return directory, rev


def run_checks(fev, rev):
    """
    Return the failure messages of every paired check against the fixture at `rev`.
    """
    ppc = fev.ppc
    failures = []

    def check(condition, message):
        if not condition:
            failures.append(message)

    def edge(name):
        line = next((n for p, n, _t in ppc.call_sites(rev, name) if p == LIB), None)
        return fev.classify_edge(rev, LIB, line, name) if line else ("missing", name)

    enums, results, (counts, how) = fev.classify_all(rev)
    check(
        set(enums) == {"FixtureError", "SingleError", "PairError"},
        f"enums found in the fixture: {sorted(enums)}",
    )
    variants = {v for v, _ in enums.get("FixtureError", [(None, None, [])])[0][2]}
    check(variants == {"Refused", "Passed", "Observed", "Unused"}, f"variants: {sorted(variants)}")

    def bucket(name, enum="FixtureError"):
        return results.get((enum, name), ("missing", []))

    def site_count(enum, name):
        return sorted(v for (k, _site), v in counts.items() if k == (enum, name))

    # Flattened at the last hop, two calls above its producer.
    refused, evidence = bucket("Refused")
    check(refused == "listed", f"FixtureError::Refused: {refused}, expected listed")
    flats = {r[3][:2] for r in evidence if r[2] == "flat"}
    check(
        len(flats) == 1 and all(p == LIB for p, _ in flats),
        f"Refused flattened at {sorted(flats)}",
    )
    # One value reaches its discard, and a sibling the walk could not finish keeps it listed.
    check(
        site_count("FixtureError", "Refused") == [(1, 1)],
        f"Refused counts {site_count('FixtureError', 'Refused')}",
    )

    # The only value of its enum that reaches its discard, every sibling accounted for: renamed,
    # not lost - off the main list, proven by the walk.
    only, evidence = bucket("Only", "SingleError")
    check(only == "renamed", f"SingleError::Only: {only}, expected renamed")
    becomes = {r[3][3] for r in evidence if r[2] == "flat"}
    check(becomes == {"Unit"}, f"a block-bodied discard closure becomes {sorted(becomes)}")
    check(
        how.get(("SingleError", "Only")) == "by the walk",
        f"SingleError::Only renamed {how.get(('SingleError', 'Only'))!r}",
    )

    # Two values reaching the same discard: information lost, so both stay on the main list.
    for name in ("First", "Second"):
        found, evidence = bucket(name, "PairError")
        check(found == "listed", f"PairError::{name}: {found}, expected listed")
        becomes = {r[3][3] for r in evidence if r[2] == "flat"}
        check(becomes == {"Unit"}, f"a one-line discard closure becomes {sorted(becomes)}")
        check(
            site_count("PairError", name) == [(2, 0)],
            f"PairError::{name} counts {site_count('PairError', name)}",
        )

    # A ruling can close a sibling the walk left open; without one, it stays listed.
    site = ("crates/x/src/lib.rs", 7)
    listed = {("E", "A"): ("listed", [("p", 1, "flat", (*site, "why", "becomes"), ())])}
    reach, open_ = {("E", *site): {"A"}}, {("E", "B")}
    fev.rename_single_values(unruled := dict(listed), reach, open_)
    check(
        unruled[("E", "A")][0] == "listed",
        "a value with an open sibling and no ruling was renamed",
    )
    saved = fev.DISPOSITIONS.copy()
    fev.DISPOSITIONS[("E", "A")] = {"single_valued": True, "note": "calibration"}
    _counts, ruled_how = fev.rename_single_values(ruled := dict(listed), reach, open_)
    fev.DISPOSITIONS.clear()
    fev.DISPOSITIONS.update(saved)
    check(ruled[("E", "A")][0] == "renamed", "a ruling of a single value did not rename it")
    check("ruling" in ruled_how.get(("E", "A"), ""), f"renamed by {ruled_how.get(('E', 'A'))!r}")

    # Passed through untouched by `?` to a function nothing calls. It must be kept off the list
    # by the walk reaching a boundary - not by being undeterminable, which would pass this too.
    passed, evidence = bucket("Passed")
    check(
        passed == "reaches-boundary",
        f"FixtureError::Passed: {passed}, expected reaches-boundary",
    )
    check(any(r[2] == "boundary" for r in evidence), "Passed: no path reached a boundary")
    check(not any(r[2] == "flat" for r in evidence), "Passed: a path was flattened")

    # Named in a caller's pattern, and never constructed.
    observed, _evidence = bucket("Observed")
    check(observed == "observed", f"FixtureError::Observed: {observed}, expected observed")
    unused, _evidence = bucket("Unused")
    check(unused == "unconstructed", f"FixtureError::Unused: {unused}, expected unconstructed")

    # One edge of each kind, paired with one of the opposite kind.
    kind, why = edge("produce_refused")
    check(
        (kind, why) == ("propagate", "tail expression"),
        f"a call returned as the tail expression: {kind}, {why}",
    )
    kind, why = edge("relay")
    check(kind == "discard", f"`.map_err(|_| ..)` on the last hop: {kind}, {why}")
    kind, why = edge("produce_passed")
    check((kind, why) == ("propagate", "?"), f"a call followed by `?`: {kind}, {why}")
    kind, why = edge("two_arguments")
    check(kind == "discard", f"`.map_err(|_| ..)` after a multi-line call: {kind}, {why}")
    kind, why = edge("maybe")
    check(kind == "discard" and "let Ok" in why, f"`let Ok(..) = .. else`: {kind}, {why}")
    kind, why = edge("maybe_again")
    check(kind == "discard" and why == ".ok()", f"`.ok()` on a result: {kind}, {why}")

    # The boundary every binary has, against an ordinary function that has a caller.
    finished, _steps = fev._follow(rev, "main", ("main",), {}, LIB)
    check(finished and finished[0][0] == "boundary", "`main` was not treated as a boundary")
    callers, how = fev.callers_of(rev, "produce_passed", LIB)
    check(callers is not None and len(callers) > 0, f"produce_passed: callers {callers!r} ({how})")

    # A ruling whose variant is no longer listed is stale. Both answers.
    everything = dict.fromkeys(fev.DISPOSITIONS, ("listed", []))
    check(
        fev._stale_dispositions(everything) == [],
        "a ruling on a listed variant was called stale",
    )
    check(
        fev._stale_dispositions({}) == sorted(fev.DISPOSITIONS),
        "a ruling on a variant no longer listed was not called stale",
    )
    return failures


def main():
    enclosing = guard_enclosing_repository()
    home = Path.cwd()
    directory, rev = fixture_repository()
    try:
        os.chdir(directory)
        failures = run_checks(load_tool(), rev)
    finally:
        os.chdir(home)
        shutil.rmtree(directory, ignore_errors=True)
    failures += enclosing()
    if failures:
        print("flattened-error-variants calibration FAILED:")
        for message in failures:
            print(f"  {message}")
        print(
            "\nThe fixture is synthetic, so a failure here is the tool, not the repository: its"
            "\nwalk regressed, or it now reads an edge shape differently. Rebuild the fixture with"
            "\n`fixture_repository()` and run the tool on it with `Enum::Variant` to read the paths.",
        )
        return 1
    print(
        "flattened-error-variants calibration passed on its own fixture: both directions exercised",
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
