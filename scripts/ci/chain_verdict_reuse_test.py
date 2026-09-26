#!/usr/bin/env python3
"""
Both directions for scripts/ci/chain_verdict_reuse.py's decision.

Exactly one shape reuses: the same tree, green, whole-chain report, every job this tree's matrix
names, N equal to this tree's entry count. Every other case here must answer "run", and says
which rule refused it:
- a tree one byte away;
- the same tree but a failed run, or a green and a failed one side by side;
- only a cancelled run;
- a PARTIAL report, the owner-chains partial mode's green run;
- a shard missing, cancelled or skipped;
- a report for fewer entries, or recording a different count than passed.

"""

from __future__ import annotations

import sys
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parent))
from chain_verdict_reuse import ARCHIVE_JOB
from chain_verdict_reuse import REPORT_JOB
from chain_verdict_reuse import decide


TREE = "a" * 40
OTHER_TREE = "a" * 39 + "b"
SHARDS = {f"rd owner postgres shard-{n} (ubuntu-22.04)" for n in range(1, 5)} | {
    "market data owner postgres (ubuntu-22.04)",
}
N = 110
WHOLE = f"=== ordered chain: all {N} entries passed, {N} recorded\n"


def run(
    run_id: int,
    sha: str,
    conclusion: str = "success",
    created: str = "2026-09-27T01:00:00Z",
) -> dict:
    return {
        "id": run_id,
        "head_sha": sha,
        "status": "completed",
        "conclusion": conclusion,
        "created_at": created,
        "html_url": f"https://example.invalid/runs/{run_id}",
    }


def jobs(report: str = REPORT_JOB, drop: str = "", override: dict | None = None) -> list[dict]:
    names = sorted(SHARDS | {ARCHIVE_JOB, report, "owner chain plan"})
    listed = [
        {"id": i, "name": name, "conclusion": (override or {}).get(name, "success")}
        for i, name in enumerate(names)
    ]
    listed.append(
        {
            "id": 99,
            "name": "market data end-to-end, no credential (ubuntu-22.04)",
            "conclusion": "skipped",
        },
    )
    return [job for job in listed if job["name"] != drop]


def check(
    label: str,
    runs: list[dict],
    trees: dict,
    run_jobs: dict,
    logs: dict,
    expect_reuse: int | None,
    why: str = "",
) -> None:
    decision = decide(TREE, N, SHARDS, runs, trees.__getitem__, run_jobs.__getitem__, logs.get)
    if decision.run_id != expect_reuse:
        sys.exit(
            f"FAIL {label}: expected {expect_reuse}, got {decision.run_id} ({decision.reason})",
        )
    if why and why not in decision.reason:
        sys.exit(f"FAIL {label}: the reason does not say {why!r}: {decision.reason}")
    print(
        f"ok {label}: {'reuse ' + str(decision.run_id) if decision.run_id else 'run - ' + decision.reason}",
    )


def main() -> None:
    report_id = sorted(SHARDS | {ARCHIVE_JOB, REPORT_JOB, "owner chain plan"}).index(REPORT_JOB)
    whole = {report_id: WHOLE}
    check("same tree, green, whole chain", [run(1, "s1")], {"s1": TREE}, {1: jobs()}, whole, 1)
    check(
        "tree one byte away",
        [run(1, "s1")],
        {"s1": OTHER_TREE},
        {1: jobs()},
        whole,
        None,
        "no completed owner-chains run",
    )
    check(
        "same tree, failed",
        [run(1, "s1", "failure")],
        {"s1": TREE},
        {1: jobs()},
        whole,
        None,
        "concluded failure",
    )
    check(
        "same tree, green and failed",
        [run(1, "s1"), run(2, "s2", "failure")],
        {"s1": TREE, "s2": TREE},
        {1: jobs(), 2: jobs()},
        whole,
        None,
        "concluded failure",
    )
    check(
        "same tree, only cancelled",
        [run(1, "s1", "cancelled")],
        {"s1": TREE},
        {1: jobs()},
        whole,
        None,
        "no completed",
    )
    partial = f"{REPORT_JOB} (PARTIAL: shard-2)"
    partial_id = sorted(SHARDS | {ARCHIVE_JOB, partial, "owner chain plan"}).index(partial)
    check(
        "same tree, green PARTIAL run",
        [run(1, "s1")],
        {"s1": TREE},
        {1: jobs(report=partial)},
        {partial_id: "=== PARTIAL: shard-2; not an ordered-chain verdict\n"},
        None,
        "partial chain",
    )
    check(
        "a shard missing",
        [run(1, "s1")],
        {"s1": TREE},
        {1: jobs(drop="rd owner postgres shard-3 (ubuntu-22.04)")},
        whole,
        None,
        "has no job",
    )
    for state in ("cancelled", "skipped", "failure"):
        check(
            f"a shard {state}",
            [run(1, "s1")],
            {"s1": TREE},
            {1: jobs(override={"rd owner postgres shard-2 (ubuntu-22.04)": state})},
            whole,
            None,
            f"concluded {state}",
        )
    check(
        "report for 109 entries",
        [run(1, "s1")],
        {"s1": TREE},
        {1: jobs()},
        {report_id: "=== ordered chain: all 109 entries passed, 109 recorded\n"},
        None,
        "this tree has 110",
    )
    check(
        "report recording a different count",
        [run(1, "s1")],
        {"s1": TREE},
        {1: jobs()},
        {report_id: f"=== ordered chain: all {N} entries passed, {N - 1} recorded\n"},
        None,
        "recorded",
    )
    check(
        "report with no verdict line",
        [run(1, "s1")],
        {"s1": TREE},
        {1: jobs()},
        {report_id: "no verdict\n"},
        None,
        "no ordered-chain verdict",
    )
    check(
        "two green runs, the newest reused",
        [run(1, "s1"), run(2, "s2", created="2026-09-27T02:00:00Z")],
        {"s1": TREE, "s2": TREE},
        {1: jobs(), 2: jobs()},
        whole,
        2,
    )
    print(
        "ok: only the same tree's green whole-chain verdict for this tree's entry count is reused",
    )


if __name__ == "__main__":
    main()
