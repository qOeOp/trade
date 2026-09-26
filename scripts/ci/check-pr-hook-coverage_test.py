#!/usr/bin/env python3
"""
Calibrate check-pr-hook-coverage.py in both directions against mutated copies of the
real runner.

The real scripts/ci/run-pre-commit.bash must pass. Each mutation drops a hook from a pull request's
coverage, or narrows the files it runs over, and must be refused with that hook named. Each first
proves it changed the copy, because a replacement that matched nothing would leave the runner intact
and the refusal would then be missing for the wrong reason.

Run: python3 -B scripts/ci/check-pr-hook-coverage_test.py

"""

from __future__ import annotations

import os
import subprocess
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
CHECK = Path(__file__).with_name("check-pr-hook-coverage.py")
RUNNER = Path(__file__).with_name("run-pre-commit.bash")


def run(runner: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, "-B", str(CHECK), str(ROOT)],
        capture_output=True,
        text=True,
        check=False,
        env={**os.environ, "RUN_PRE_COMMIT_SCRIPT": str(runner)},
    )


def mutate(text: str, old: str, new: str) -> str:
    if text.count(old) != 1:
        raise SystemExit(
            f"FAIL: mutation target {old!r} occurs {text.count(old)} times, expected once",
        )
    return text.replace(old, new)


MUTATIONS = {
    "a compiled hook dropped from the full route": (
        '    args=(--all-files "${COMPILED[@]}")\n',
        "    args=(--all-files cargo-clippy cargo-clippy-network-turmoil-non-linux cargo-machete check-links-offline)\n",
        "full route: `cargo-doc` ran over all files on every pull request and now runs nowhere.",
    ),
    "a no-compile hook skipped everywhere": (
        '    for hook in "${COMPILED[@]}"; do args+=(--skip "$hook"); done\n',
        '    for hook in "${COMPILED[@]}"; do args+=(--skip "$hook"); done\n    args+=(--skip fmt)\n',
        "narrow route: `fmt` ran over all files on every pull request and now runs nowhere.",
    ),
    "the narrow route loses its one compiled hook": (
        "  cargo-machete\n)\n\nscope=",
        "  cargo-machete\n  check-links-offline\n)\n\nscope=",
        "narrow route: `check-links-offline` ran over the diff on every pull request and now runs nowhere.",
    ),
    "the no-compile hooks narrowed to the diff": (
        "    args=(--all-files)\n    for hook in",
        "    args=(--from-ref x --to-ref HEAD)\n    for hook in",
        "full route: `typos` ran over all files on every pull request and now runs over the diff.",
    ),
    "a hook name the config does not have": (
        "  cargo-machete\n  check-links-offline\n)",
        "  cargo-machete\n  check-links-offline-renamed\n)",
        "names hooks .pre-commit-config.yaml does not have: ['check-links-offline-renamed']",
    ),
}


def main() -> int:
    failures = []
    agreeing = run(RUNNER)
    if agreeing.returncode != 0:
        failures.append(f"the real runner was refused:\n{agreeing.stderr}")
    source = RUNNER.read_text()
    with tempfile.TemporaryDirectory() as scratch:
        for name, (old, new, expected) in MUTATIONS.items():
            copy = Path(scratch) / "run-pre-commit.bash"
            copy.write_text(mutate(source, old, new))
            result = run(copy)
            if result.returncode == 0 or expected not in result.stderr:
                failures.append(
                    f"{name}: expected a refusal naming {expected!r}, got exit {result.returncode}:\n"
                    f"{result.stderr}",
                )
    for failure in failures:
        print(f"FAIL: {failure}", file=sys.stderr)
    if failures:
        return 1
    print(
        f"check-pr-hook-coverage: the real runner accepted, {len(MUTATIONS)} mutations refused by name.",
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
