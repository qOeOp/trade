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

It also refuses a Rust cache restore in either archive job. The chain's 12-package graph unifies
dependency features differently from the workspace build whose entry `main` saves, so a
full-match restore still compiled all 792 units (owner-chains run 36063327107) and only added the
restore's 225 s (run 36061606498). common-setup restores by default, so the job must say "false".

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
RUST_CACHE_INPUT = re.compile(r"^\s+(rust-cache-[a-z-]+):\s*(.*)$")
ARCHIVE_JOBS = (
    ("owner-chains.yml", "rd-owner-archive"),
    ("build.yml", "postgres-owner-chain-archive-linux-x86"),
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


def rust_cache_inputs(text: str, job: str) -> dict[str, str]:
    return {
        match.group(1): match.group(2)
        for line in job_block(text, job)
        if (match := RUST_CACHE_INPUT.match(line))
    }


def archive_cache_failures(texts: dict[str, str]) -> list[str]:
    failures = []
    for workflow, job in ARCHIVE_JOBS:
        inputs = rust_cache_inputs(texts[workflow], job)
        if inputs != {"rust-cache-enabled": '"false"'}:
            spelled = ", ".join(f"{name}: {value}" for name, value in inputs.items())
            spelled = spelled or "rust-cache-enabled unset, which common-setup defaults to true"
            failures.append(
                f"{workflow} job `{job}` restores the Rust cache ({spelled}). "
                'It must set exactly rust-cache-enabled: "false": '
                "a full-match restore of `rust tests`'s entry still compiled 792 of 792 chain units "
                "(run 36063327107) and cost 225 s (run 36061606498).",
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
    return failures + archive_cache_failures({"build.yml": build, "owner-chains.yml": chains})


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
        "and neither archive job restores the Rust cache.",
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
