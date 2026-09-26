#!/usr/bin/env python3
"""
Refuse a pull request that would run fewer pre-commit hooks, or over fewer files, than
it did.

Until 2026-09-26 two jobs ran hooks on every pull request: build.yml's pre-commit job ran all of
them (all files on the full route, the diff on the narrow one), and pre-commit-pr.yml ran every hook
but the compiled ones over all files again. Now pre-commit-pr.yml is the only one to run the
no-compile hooks, and build.yml's job runs the compiled rest. This compares, hook by hook and route
by route, what the two jobs now run together with what they ran together before. BEFORE is that
earlier coverage, pinned as data; a hook added to .pre-commit-config.yaml later is classified by the
same rules, as the old commands would have run it.

What runs now is read from scripts/ci/run-pre-commit.bash --print, the arguments the jobs actually
pass to `prek run`, so the check cannot agree with a description while the jobs do something else.

Stdlib only: the plan job has no YAML library. The config is read for its `- id:` lines, which is
enough because no hook sets `stages` (checked below): every hook runs on `prek run`'s default stage.

"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
from pathlib import Path


# The coverage a pull request had before, as the two jobs' commands defined it.
BEFORE_PRE_COMMIT_PR_SKIP = (
    "cargo-clippy",
    "cargo-clippy-network-turmoil-non-linux",
    "cargo-doc",
    "cargo-machete",
    "check-links-offline",
)
BEFORE_BUILD_NARROW_SKIP = (
    "check-anyhow-usage",
    "check-logging-conventions",
    "check-tokio-usage",
    "check-dst-conventions",
    "check-pyo3-conventions",
    "check-testing-conventions",
    "check-vibe-conventions",
    "fmt",
    "cargo-clippy",
    "cargo-clippy-network-turmoil-non-linux",
    "cargo-doc",
    "cargo-machete",
)
ALL_FILES, DIFF = "all files", "the diff"
RANK = {None: 0, DIFF: 1, ALL_FILES: 2}


def hook_ids(config: Path) -> list[str]:
    text = config.read_text()
    if re.search(r"^\s*(default_)?stages:", text, re.MULTILINE):
        raise SystemExit(
            f"ERROR: {config} sets `stages`; this check assumes every hook runs on the default stage.",
        )
    ids = re.findall(r"^\s*- id:\s*(\S+)", text, re.MULTILINE)
    if not ids:
        raise SystemExit(f"ERROR: no hook ids found in {config}.")
    return ids


def coverage_of(args: list[str], ids: list[str], where: str) -> dict[str, str]:
    """
    Return {hook: mode} for one `prek run` argument list; none means the scope runs
    nothing.
    """
    if not args:
        return {}
    mode = ALL_FILES if "--all-files" in args else DIFF
    named, skipped, rest = [], [], iter(args)
    for arg in rest:
        if arg == "--skip":
            skipped.append(next(rest))
        elif arg in ("--from-ref", "--to-ref"):
            next(rest)
        elif not arg.startswith("-"):
            named.append(arg)
    unknown = sorted(set(named + skipped) - set(ids))
    if unknown:
        raise SystemExit(
            f"ERROR: {where} names hooks .pre-commit-config.yaml does not have: {unknown}",
        )
    selected = named or [hook for hook in ids if hook not in skipped]
    return dict.fromkeys(selected, mode)


def union(*parts: dict[str, str]) -> dict[str, str]:
    merged: dict[str, str] = {}
    for part in parts:
        for hook, mode in part.items():
            if RANK[mode] > RANK[merged.get(hook)]:
                merged[hook] = mode
    return merged


def scope_args(runner: Path, scope: str) -> list[str]:
    bash = shutil.which("bash")
    if bash is None:
        raise SystemExit(
            "ERROR: bash is not on PATH; it runs scripts/ci/run-pre-commit.bash --print.",
        )
    result = subprocess.run(
        [bash, str(runner), scope, "--print"],
        capture_output=True,
        text=True,
        check=False,
        env={**os.environ, "PRE_COMMIT_BASE": "0" * 40},
    )
    if result.returncode != 0:
        raise SystemExit(f"ERROR: {runner} {scope} --print failed:\n{result.stderr}")
    return result.stdout.split()


def check(root: Path, runner: Path) -> list[str]:
    ids = hook_ids(root / ".pre-commit-config.yaml")
    no_skip = [arg for hook in BEFORE_PRE_COMMIT_PR_SKIP for arg in ("--skip", hook)]
    narrow_skip = [arg for hook in BEFORE_BUILD_NARROW_SKIP for arg in ("--skip", hook)]
    before_pre_commit_pr = coverage_of(["--all-files", *no_skip], ids, "BEFORE")
    before = {
        "full": union(coverage_of(["--all-files"], ids, "BEFORE"), before_pre_commit_pr),
        "narrow": union(coverage_of(narrow_skip, ids, "BEFORE"), before_pre_commit_pr),
    }
    now_pre_commit_pr = coverage_of(scope_args(runner, "no-compile"), ids, "no-compile")
    now = {
        route: union(
            now_pre_commit_pr,
            coverage_of(scope_args(runner, f"pull-request-{route}"), ids, f"pull-request-{route}"),
        )
        for route in before
    }
    failures = []
    for route, expected in before.items():
        for hook in ids:
            was, is_now = expected.get(hook), now[route].get(hook)
            if RANK[is_now] < RANK[was]:
                failures.append(
                    f"{route} route: `{hook}` ran over {was} on every pull request and now runs "
                    f"{'over ' + is_now if is_now else 'nowhere'}.",
                )
    return failures


def main() -> int:
    root = Path(sys.argv[1]) if len(sys.argv) > 1 else Path.cwd()
    runner = Path(
        os.environ.get("RUN_PRE_COMMIT_SCRIPT") or root / "scripts/ci/run-pre-commit.bash",
    )
    failures = check(root, runner)
    for failure in failures:
        print(f"ERROR: {failure}", file=sys.stderr)
    if failures:
        print(
            "Between them, pre-commit-pr.yml and build.yml's pre-commit job must run every hook a pull\n"
            "request ran before they were split, over at least the same files (scripts/ci/run-pre-commit.bash).",
            file=sys.stderr,
        )
        return 1
    print(
        "pull requests run every pre-commit hook they ran before, over the same files, on both routes.",
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
