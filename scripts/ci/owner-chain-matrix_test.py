#!/usr/bin/env python3
"""
Exercise owner-chain-matrix.py: a missing shard list refused by name, one R&D entry per
shard in name order (numbers compared as numbers) when one exists, and a refusal by line
for a malformed or empty list; `--rd-chain serial` gives one unsharded R&D job and still
refuses a broken list. Also require both workflows to take their chain matrix from it,
so a hand-written matrix cannot creep back.

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


def run(tsv: str | None, *options: str) -> subprocess.CompletedProcess[str]:
    with tempfile.TemporaryDirectory() as directory:
        path = Path(directory) / "shards.tsv"
        if tsv is not None:
            path.write_text(tsv, encoding="utf-8")
        return subprocess.run(
            [sys.executable, "-B", str(TOOL), *options, str(path)],
            capture_output=True,
            text=True,
            check=False,
        )


def outputs(result: subprocess.CompletedProcess[str]) -> dict[str, str]:
    assert result.returncode == 0, result.stderr
    return dict(line.split("=", 1) for line in result.stdout.splitlines())


def matrix(result: subprocess.CompletedProcess[str]) -> list[dict]:
    return json.loads(outputs(result)["matrix"])["chain"]


def check_missing_list_refused() -> list[str]:
    missing = run(None)
    if missing.returncode == 0 or "there is no shard list" not in missing.stderr:
        return [
            f"a missing shard list is not refused by name: rc={missing.returncode} {missing.stderr!r}",
        ]
    return []


def check_shards() -> list[str]:
    failures = []
    # Each shard's browser flag must come from any of its rows: shard-10's browser entry is its last
    # row, shard-2's its first, shard-1 has none. First seen is 10, 2, 1; name order is 1, 2, 10 - a
    # plain string sort would put 10 before 2.
    sharded = matrix(
        run(
            "# comment\nshard-10\tc1\ttest_a\t0\nshard-2\tc2\ttest_b\t1\nshard-10\tc3\ttest_c\t1\n\n"
            "shard-2\tc2\ttest_d\t0\nshard-1\tc4\ttest_e\t0\n",
        ),
    )
    if [(e["key"], e["shard"], e["browser"]) for e in sharded] != [
        ("rd-owner", "shard-1", 0),
        ("rd-owner", "shard-2", 1),
        ("rd-owner", "shard-10", 1),
        ("market-data", "", 0),
    ]:
        failures.append(
            f"a three-shard list did not give one R&D entry per shard in name order: {sharded}",
        )
    if sharded[0]["name"] != "rd owner postgres shard-1 (ubuntu-22.04)":
        failures.append(f"a shard's job is not named after it: {sharded[0]['name']}")
    if len({e["make"] for e in sharded if e["key"] == "rd-owner"}) != 1:
        failures.append("shards do not share the one R&D make line")
    return failures


def check_serial() -> list[str]:
    failures = []
    listed = "shard-2\tc1\ttest_a\t0\nshard-1\tc2\ttest_b\t1\n"
    serial = run(listed, "--rd-chain", "serial")
    if [(e["key"], e["shard"], e["browser"]) for e in matrix(serial)] != [
        ("rd-owner", "", 1),
        ("market-data", "", 0),
    ]:
        failures.append(f"--rd-chain serial did not give one unsharded R&D job: {matrix(serial)}")
    if outputs(serial)["rd-chain"] != "serial" or outputs(run(listed))["rd-chain"] != "shards":
        failures.append("the rd-chain output does not name the mode, or the default is not shards")
    broken = run("alpha\tc1\ttest_a\n", "--rd-chain", "serial")
    if broken.returncode == 0:
        failures.append("--rd-chain serial accepted a malformed shard list")
    failures.extend(
        f"{options} was not refused"
        for options in (("--rd-chain", "interleaved"), ("--rd-chain",))
        if run(listed, *options).returncode == 0
    )
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
    for workflow, job, options in (
        ("build.yml", "postgres-owner-chain-plan-linux-x86", '--rd-chain "$RD_CHAIN" '),
        ("owner-chains.yml", "owner-chain-plan", ""),
    ):
        # Whitespace-normalized, so a `run:` folded over two lines reads as the one command it is.
        text = " ".join((ROOT / ".github/workflows" / workflow).read_text(encoding="utf-8").split())
        if f"matrix: ${{{{ fromJSON(needs.{job}.outputs.matrix) }}}}" not in text:
            failures.append(f"{workflow} does not take its chain matrix from {job}")
        if (
            f"python3 scripts/ci/owner-chain-matrix.py {options}"
            'scripts/ci/rd-owner-chain-shards.tsv >> "$GITHUB_OUTPUT"' not in text
        ):
            failures.append(
                f"{workflow} does not generate the matrix from scripts/ci/rd-owner-chain-shards.tsv",
            )
    return failures


def main() -> int:
    failures = (
        check_missing_list_refused()
        + check_shards()
        + check_serial()
        + check_refusals()
        + check_workflows()
    )
    for failure in failures:
        print(f"FAIL: {failure}", file=sys.stderr)
    if failures:
        return 1
    print(
        "owner-chain-matrix: a missing shard list refused, one entry per shard in name order, "
        "malformed and empty lists refused, a serial run on request, both workflows use it",
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
