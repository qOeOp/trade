#!/usr/bin/env python3
"""
Exercise owner-chain-matrix.py: a missing shard list refused by name, one R&D entry per
shard in first-seen order when one does, and a refusal by line for a malformed or empty
list. Also require both workflows to take their chain matrix from it, so a hand- written
matrix cannot creep back.

Run: python3 -B scripts/ci/owner-chain-matrix_test.py

"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path


TOOL = Path(
    os.environ.get("OWNER_CHAIN_MATRIX_TOOL") or Path(__file__).with_name("owner-chain-matrix.py"),
)
ROOT = Path(__file__).resolve().parents[2]


def run(tsv: str | None) -> subprocess.CompletedProcess[str]:
    with tempfile.TemporaryDirectory() as directory:
        path = Path(directory) / "shards.tsv"
        if tsv is not None:
            path.write_text(tsv, encoding="utf-8")
        return subprocess.run(
            [sys.executable, "-B", str(TOOL), str(path)],
            capture_output=True,
            text=True,
            check=False,
        )


def matrix(result: subprocess.CompletedProcess[str]) -> list[dict]:
    assert result.stdout.startswith("matrix="), result.stdout
    return json.loads(result.stdout[len("matrix=") :])["chain"]


def check_missing_list_refused() -> list[str]:
    missing = run(None)
    if missing.returncode == 0 or "there is no shard list" not in missing.stderr:
        return [
            f"a missing shard list is not refused by name: rc={missing.returncode} {missing.stderr!r}",
        ]
    return []


def check_shards() -> list[str]:
    failures = []
    # Each shard's browser flag must come from any of its rows: alpha's browser entry is its last row,
    # beta's its first, gamma has none.
    sharded = matrix(
        run(
            "# comment\nalpha\tc1\ttest_a\t0\nbeta\tc2\ttest_b\t1\nalpha\tc3\ttest_c\t1\n\nbeta\tc2\ttest_d\t0\ngamma\tc4\ttest_e\t0\n",
        ),
    )
    if [(e["key"], e["shard"], e["browser"]) for e in sharded] != [
        ("rd-owner", "alpha", 1),
        ("rd-owner", "beta", 1),
        ("rd-owner", "gamma", 0),
        ("market-data", "", 0),
    ]:
        failures.append(
            f"a three-shard list did not give one R&D entry per shard in first-seen order: {sharded}",
        )
    if sharded[0]["name"] != "rd owner postgres alpha (ubuntu-22.04)":
        failures.append(f"a shard's job is not named after it: {sharded[0]['name']}")
    if len({e["make"] for e in sharded if e["key"] == "rd-owner"}) != 1:
        failures.append("shards do not share the one R&D make line")
    return failures


def check_refusals() -> list[str]:
    failures = []
    for tsv, expected in (
        ("alpha\tc1\ttest_a\n", ":1: expected shard, component, test name, browser 0|1"),
        ("alpha\tc1\ttest_a\t2\n", ":1: expected shard, component, test name, browser 0|1"),
        ("# only a comment\n", "lists no entries"),
    ):
        result = run(tsv)
        if result.returncode == 0 or expected not in result.stderr:
            failures.append(
                f"{tsv!r} was not refused with {expected!r}: exit {result.returncode}, {result.stderr!r}",
            )
    return failures


def check_workflows() -> list[str]:
    failures = []
    for workflow, job in (
        ("build.yml", "postgres-owner-chain-plan-linux-x86"),
        ("owner-chains.yml", "owner-chain-plan"),
    ):
        text = (ROOT / ".github/workflows" / workflow).read_text(encoding="utf-8")
        if f"matrix: ${{{{ fromJSON(needs.{job}.outputs.matrix) }}}}" not in text:
            failures.append(f"{workflow} does not take its chain matrix from {job}")
        if (
            'run: python3 scripts/ci/owner-chain-matrix.py scripts/ci/rd-owner-chain-shards.tsv >> "$GITHUB_OUTPUT"'
            not in text
        ):
            failures.append(
                f"{workflow} does not generate the matrix from scripts/ci/rd-owner-chain-shards.tsv",
            )
    return failures


def main() -> int:
    failures = check_missing_list_refused() + check_shards() + check_refusals() + check_workflows()
    for failure in failures:
        print(f"FAIL: {failure}", file=sys.stderr)
    if failures:
        return 1
    print(
        "owner-chain-matrix: a missing shard list refused, one entry per shard with one, "
        "malformed and empty lists refused, both workflows use it",
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
