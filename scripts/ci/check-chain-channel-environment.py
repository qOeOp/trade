#!/usr/bin/env python3
"""
Refuse an `owner-chains` chain whose Cargo environment differs from `build`'s.

AGENTS.md accepts an Owner implementation on its chain entries passing in either channel, the
`owner-chains` workflow or `build`'s chain job, so the two must build the same binaries. They did
not: `owner-chains` compiled under the `nextest` profile, whose dependencies are optimised
(opt-level 1), and `build` under `ci-pr`, whose dependencies are not. Unoptimised sqlx and tokio
futures keep larger poll frames, so a test near the stack limit passed on `test-chain/` and
overflowed in the pull request's build (#993, entry 6). The same difference kept `owner-chains`
off the Rust cache `main` saves, because rust-cache folds every `CARGO_*` and `RUST*` variable
into the key.

`build` spells each value as a condition over the event, and `owner-chains` runs only on a push to
`test-chain/**`, where that condition would pick the other branch. So this compares against the
value `build` takes on the events that admit to `main` - a pull request, the merge queue, `main`
and `test-ci` - and refuses if the condition stops naming those events.

It also pins each archive job's Rust cache inputs exactly. The archive jobs keep a dependency
cache of the chain's own graph; restoring `rust tests`'s entry instead buys nothing, because the
chain's 12-package graph unifies dependency features differently from the workspace build that
saved it: a full-match restore still compiled all 792 units (owner-chains run 36063327107) and
only added the restore's 225 s (run 36061606498). A test-chain push must not save: only `main`
writes the entry.

And it pins the jobs that restore `rust tests`'s entry to the key that job saves it under. rust-cache
hashes every variable whose name starts with CARGO, CC, CFLAGS, CXX, CMAKE or RUST into the key
(src/config.ts:118 at c19371144), at workflow and job level alike, so one such variable that differs
on either side makes the restore miss. A missed restore is not an error: the job only runs cold, so
nothing else would ever say so. Each restorer must name the saving job's shared key and workspaces,
carry exactly its rust-cache variables with the values it takes on the events that admit to `main`,
and never save. A workflow-level variable such as SAVE_BUILD_CACHES is in every job's key too, which
is why its name must not start with one of those prefixes.

Stdlib only: the pre-commit job has no YAML library, and the two blocks read here are plain
`KEY: value` lines, optionally folded with `>-`.

"""

from __future__ import annotations

import re
import sys
from pathlib import Path


ACCEPTANCE_EVENTS = (
    "github.event_name == 'pull_request'",
    "github.event_name == 'merge_group'",
    "github.ref_name == 'main'",
    "github.ref_name == 'test-ci'",
)
CONDITIONAL = re.compile(
    r"^\$\{\{\s*\((?P<condition>.*)\)\s*&&\s*'(?P<then>[^']*)'\s*\|\|\s*'[^']*'\s*\}\}$",
)
CARGO_ENVIRONMENT = re.compile(r"^(CARGO_|RUST)")
# The prefixes rust-cache folds into its key (src/config.ts:118 at c19371144).
RUST_CACHE_ENVIRONMENT = re.compile(r"^(CARGO|CC|CFLAGS|CXX|CMAKE|RUST)")
# The job that saves the entry, and the jobs that must restore it.
CACHE_SAVER = ("build.yml", "rust-tests-linux-x86")
CACHE_RESTORERS = (("owner-chains.yml", "owner-chain"),)
RUST_CACHE_INPUT = re.compile(r"^\s+(rust-cache-[a-z-]+):\s*(.*)$")
CHAIN_CACHE = {
    "rust-cache-shared-key": "rd-owner-chain-archive-linux-x86",
    "rust-cache-workspaces": ". -> target/rust-tests-linux-x86",
    "rust-cache-on-failure": '"false"',
    "rust-cache-workspace-crates": '"false"',
}
ARCHIVE_JOBS = (
    (
        "owner-chains.yml",
        "rd-owner-archive",
        {**CHAIN_CACHE, "rust-cache-enabled": '"true"', "rust-cache-save-if": '"false"'},
    ),
    (
        "build.yml",
        "postgres-owner-chain-archive-linux-x86",
        {
            **CHAIN_CACHE,
            "rust-cache-enabled": "${{ runner.environment == 'github-hosted' && 'true' || 'false' }}",
            "rust-cache-save-if": "${{ env.SAVE_BUILD_CACHES }}",
        },
    ),
)


def job_block(text: str, job: str) -> list[str]:
    lines = text.splitlines()
    try:
        start = lines.index(f"  {job}:")
    except ValueError:
        raise SystemExit(f"ERROR: job `{job}` not found") from None
    block = []
    for line in lines[start + 1 :]:
        if re.match(r"^  \S", line) or re.match(r"^\S", line):
            break
        block.append(line)
    return block


def env_of(text: str, job: str) -> dict[str, str]:
    """
    Read the job-level `env:` mapping of `job`, joining folded scalars with single
    spaces.
    """
    block = job_block(text, job)
    try:
        start = block.index("    env:")
    except ValueError:
        raise SystemExit(f"ERROR: job `{job}` has no job-level env") from None
    env: dict[str, str] = {}
    key = None
    for line in block[start + 1 :]:
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        if not line.startswith("      "):
            break
        entry = re.match(r"^      ([A-Z][A-Z0-9_]*):\s*(.*)$", line)
        if entry:
            key, value = entry.group(1), entry.group(2)
            env[key] = "" if value == ">-" else value
        elif key is not None and line.startswith("        "):
            env[key] = f"{env[key]} {line.strip()}".strip()
        else:
            raise SystemExit(f"ERROR: unreadable env line in `{job}`: {line!r}")
    return env


def workflow_env(text: str) -> dict[str, str]:
    """
    Read the workflow-level `env:` mapping, joining folded scalars with single spaces.
    """
    lines = text.splitlines()
    if "env:" not in lines:
        return {}
    env: dict[str, str] = {}
    key = None
    for line in lines[lines.index("env:") + 1 :]:
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        if not line.startswith("  "):
            break
        entry = re.match(r"^  ([A-Z][A-Z0-9_]*):\s*(.*)$", line)
        if entry:
            key, value = entry.group(1), entry.group(2)
            env[key] = "" if value == ">-" else value
        elif key is not None and line.startswith("    "):
            env[key] = f"{env[key]} {line.strip()}".strip()
        else:
            raise SystemExit(f"ERROR: unreadable workflow env line: {line!r}")
    return env


def rust_cache_inputs(text: str, job: str) -> dict[str, str]:
    return {
        match.group(1): match.group(2)
        for line in job_block(text, job)
        if (match := RUST_CACHE_INPUT.match(line))
    }


def archive_cache_failures(texts: dict[str, str]) -> list[str]:
    failures = []
    for workflow, job, expected in ARCHIVE_JOBS:
        inputs = rust_cache_inputs(texts[workflow], job)
        if inputs.get("rust-cache-shared-key") == "rust-tests-linux-x86":
            failures.append(
                f"{workflow} job `{job}` restores `rust tests`'s cache entry. A full-match restore of it "
                "still compiled 792 of 792 chain units (run 36063327107) and cost 225 s (run 36061606498); "
                "the archive job keeps the chain's own dependency cache instead.",
            )
            continue
        failures.extend(
            f"{workflow} job `{job}` sets {name}={inputs.get(name, 'unset')!r}, "
            f"expected {expected.get(name, 'unset')!r}."
            for name in sorted(set(expected) | set(inputs))
            if inputs.get(name) != expected.get(name)
        )
    return failures


def keyed_env(text: str, job: str, *, acceptance: bool) -> dict[str, str]:
    """
    Return the variables rust-cache folds into `job`'s key: workflow level, then job
    level.
    """
    env = {**workflow_env(text), **env_of(text, job)}
    return {
        name: on_acceptance(name, value) if acceptance else value
        for name, value in env.items()
        if RUST_CACHE_ENVIRONMENT.match(name)
    }


def restorer_failures(texts: dict[str, str]) -> list[str]:
    saver_workflow, saver = CACHE_SAVER
    saved = rust_cache_inputs(texts[saver_workflow], saver)
    saved_env = keyed_env(texts[saver_workflow], saver, acceptance=True)
    failures = []
    for workflow, job in CACHE_RESTORERS:
        inputs = rust_cache_inputs(texts[workflow], job)
        where = f"{workflow} job `{job}`"
        failures.extend(
            f"{where} restores with {name}={inputs.get(name, 'unset')!r}, but {saver_workflow} job "
            f"`{saver}` saves the entry with {saved.get(name, 'unset')!r}."
            for name in ("rust-cache-shared-key", "rust-cache-workspaces")
            if inputs.get(name) != saved.get(name)
        )
        if inputs.get("rust-cache-save-if") != '"false"':
            failures.append(
                f"{where} sets rust-cache-save-if={inputs.get('rust-cache-save-if', 'unset')!r}; only "
                f"{saver_workflow} job `{saver}` writes the entry it restores.",
            )
        restored_env = keyed_env(texts[workflow], job, acceptance=False)
        failures.extend(
            f"{where} restores with {name}={restored_env.get(name, 'unset')!r}, but {saver_workflow} job "
            f"`{saver}` saves the entry with {saved_env.get(name, 'unset')!r}: rust-cache folds {name} into "
            "the key, so the restore misses and the job runs cold, which nothing reports."
            for name in sorted(set(saved_env) | set(restored_env))
            if restored_env.get(name) != saved_env.get(name)
        )
    return failures


def on_acceptance(name: str, value: str) -> str:
    """
    Return the value `build` gives `name` on the events that admit to `main`.
    """
    if "${{" not in value:
        return value
    match = CONDITIONAL.match(value)
    if match is None:
        raise SystemExit(
            f"ERROR: build.yml's chain job spells {name} as an expression this check cannot read:\n"
            f"  {value}\n"
            "Keep the `(<events>) && '<acceptance value>' || '<other>'` form, or teach this check the new one.",
        )
    condition = re.sub(r"\s+", " ", match.group("condition"))
    missing = [event for event in ACCEPTANCE_EVENTS if event not in condition]
    if missing:
        raise SystemExit(
            f"ERROR: build.yml's chain job no longer takes its {name} branch on {', '.join(missing)}, so the value "
            "compared here is not the one those events build with.",
        )
    return match.group("then")


def check(root: Path) -> list[str]:
    build = (root / ".github/workflows/build.yml").read_text()
    chains = (root / ".github/workflows/owner-chains.yml").read_text()
    expected = {
        name: on_acceptance(name, value)
        for name, value in env_of(build, "postgres-owner-chains-linux-x86").items()
        if CARGO_ENVIRONMENT.match(name)
    }
    failures = []
    # Every job that builds or runs the chain's binaries carries the whole Cargo environment: the two
    # chain jobs, and the two archive jobs that now build what they run. The venue leg shares no cache
    # entry with `build` and has no counterpart there, but it is evidence for the same Owner, so it
    # builds under the same profile.
    jobs = (
        ("owner-chains.yml", chains, "owner-chain", None),
        ("owner-chains.yml", chains, "rd-owner-archive", None),
        ("build.yml", build, "postgres-owner-chain-archive-linux-x86", None),
        ("owner-chains.yml", chains, "venue-end-to-end", ["CARGO_CI_PROFILE"]),
    )
    for workflow, text, job, only in jobs:
        actual = {
            name: on_acceptance(name, value) if workflow == "build.yml" else value
            for name, value in env_of(text, job).items()
            if CARGO_ENVIRONMENT.match(name)
        }
        failures += [
            f"{workflow} job `{job}` sets {name}={actual.get(name)!r}; "
            f"build.yml's chain job builds with {expected[name]!r} on a pull request, `main` and `test-ci`."
            for name in (only or sorted(expected))
            if actual.get(name) != expected[name]
        ]
        if only is None:
            failures += [
                f"{workflow} job `{job}` sets {name}, which build.yml's chain job does not."
                for name in sorted(set(actual) - set(expected))
            ]
    texts = {"build.yml": build, "owner-chains.yml": chains}
    return failures + archive_cache_failures(texts) + restorer_failures(texts)


def main() -> int:
    root = Path(sys.argv[1]) if len(sys.argv) > 1 else Path.cwd()
    failures = check(root)
    for failure in failures:
        print(f"ERROR: {failure}", file=sys.stderr)
    if failures:
        print(
            "Both channels are Owner acceptance (AGENTS.md), so they must compile the same binaries: a profile\n"
            "difference changes optimisation and stack frames (#993 entry 6), and any CARGO_/RUST difference\n"
            "also changes the rust-cache key, so owner-chains stops reading the entry main saves.",
            file=sys.stderr,
        )
        return 1
    print(
        "owner-chains builds its chains with build's acceptance-time Cargo environment, "
        "and both archive jobs keep the chain's own dependency cache.",
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
