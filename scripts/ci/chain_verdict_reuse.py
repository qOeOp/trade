#!/usr/bin/env python3
"""
Decide whether a pull request's build may take the Owner chains' verdict from an owner-
chains run.

A chain verdict proves the tree it ran on and nothing else. A pull request's build checks out
GitHub's merge commit (refs/pull/N/merge), so the tree it would prove is that checkout's
`HEAD^{tree}`, not the pull request head's. owner-chains.yml runs the same chain jobs at the same
profile (#998). An owner-chains run on exactly that tree has therefore already proven what the
build's chain jobs would prove. In two days to 2026-09-27, 17 of 92 pull request builds that ran
the chains were in that position, and they spent 11.2 runner-hours doing it again.

The build reuses a verdict only when every one of these holds:

- some completed owner-chains run in the last three days has a head commit whose tree, read from
  the commit object, equals this checkout's tree;
- every such run concluded success, since a failed run on the same tree makes the verdict
  contested (a cancelled run is no verdict and is set aside);
- the reused run has each chain job this tree's matrix names, plus the archive and the report,
  concluded success;
- its report is the whole-chain report, not a PARTIAL one, and it states
  "=== ordered chain: all N entries passed, N recorded" with N equal to this tree's
  `--entry-count`.

Anything else answers "run the chains", with the reason: no candidate, a contested one, a
missing, failed or skipped job, a different N, or any error or timeout while looking. On reuse
it prints the run, its URL and both trees, so anyone can check the claim.

"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import time
from collections.abc import Callable
from dataclasses import dataclass


VERDICT = re.compile(
    r"^=== ordered chain: all (\d+) entries passed, (\d+) recorded\s*$",
    re.MULTILINE,
)
ANSI = re.compile(r"\x1b\[[0-9;]*m")
ARCHIVE_JOB = "rd owner archive (ubuntu-22.04)"
REPORT_JOB = "rd owner chain report"
LOOKBACK_SECONDS = 3 * 24 * 3600


@dataclass(frozen=True)
class Decision:
    run_id: int | None
    reason: str
    url: str = ""
    run_tree: str = ""


def qualify(
    run: dict,
    required: set[str],
    entry_count: int,
    jobs_of: Callable[[int], list[dict]],
    report_log: Callable[[int], str],
) -> str | None:
    """
    Return why this run's verdict cannot be reused, or None when it can.
    """
    if run.get("conclusion") != "success":
        return f"run {run['id']} concluded {run.get('conclusion')}"
    jobs = {job["name"]: job for job in jobs_of(run["id"])}
    partial = [name for name in jobs if name.startswith(REPORT_JOB) and name != REPORT_JOB]
    if partial:
        return (
            f"run {run['id']} reported a partial chain ({partial[0]}), not an ordered-chain verdict"
        )
    for name in sorted(required | {ARCHIVE_JOB, REPORT_JOB}):
        job = jobs.get(name)
        if job is None:
            return f"run {run['id']} has no job {name!r}"
        if job.get("conclusion") != "success":
            return f"run {run['id']} job {name!r} concluded {job.get('conclusion')}"
    match = VERDICT.search(ANSI.sub("", report_log(jobs[REPORT_JOB]["id"])))
    if match is None:
        return f"run {run['id']}'s report states no ordered-chain verdict"
    passed, recorded = int(match.group(1)), int(match.group(2))
    if passed != entry_count or recorded != entry_count:
        return f"run {run['id']}'s report covers {passed} passed/{recorded} recorded, this tree has {entry_count} entries"
    return None


def decide(
    tree: str,
    entry_count: int,
    required: set[str],
    runs: list[dict],
    commit_tree: Callable[[str], str],
    jobs_of: Callable[[int], list[dict]],
    report_log: Callable[[int], str],
) -> Decision:
    same = [
        run
        for run in runs
        if run.get("status") == "completed" and commit_tree(run["head_sha"]) == tree
    ]
    verdicts = [run for run in same if run.get("conclusion") != "cancelled"]
    if not verdicts:
        return Decision(None, f"no completed owner-chains run on tree {tree}")
    reasons = [qualify(run, required, entry_count, jobs_of, report_log) for run in verdicts]
    refused = [reason for reason in reasons if reason is not None]
    if refused:
        return Decision(None, refused[0])
    newest = max(verdicts, key=lambda run: run["created_at"])
    return Decision(
        newest["id"],
        "reused",
        newest.get("html_url", ""),
        commit_tree(newest["head_sha"]),
    )


GH = shutil.which("gh") or "gh"
GIT = shutil.which("git") or "git"
BASH = shutil.which("bash") or "bash"


def gh(path: str, *extra: str) -> str:
    return subprocess.run(
        [GH, "api", *extra, path],
        capture_output=True,
        text=True,
        check=True,
        timeout=60,
    ).stdout


def main() -> int:
    repo = os.environ["GITHUB_REPOSITORY"]
    output = os.environ.get("GITHUB_OUTPUT")
    tree = "unknown"
    try:
        tree = subprocess.run(
            [GIT, "rev-parse", "HEAD^{tree}"],
            capture_output=True,
            text=True,
            check=True,
            timeout=30,
        ).stdout.strip()
        entry_count = int(
            subprocess.run(
                [BASH, "scripts/ci/test-rd-owner-postgres.bash", "--entry-count"],
                capture_output=True,
                text=True,
                check=True,
                timeout=60,
            ).stdout.strip(),
        )
        matrix_out = subprocess.run(
            [
                sys.executable,
                "scripts/ci/owner-chain-matrix.py",
                "--rd-chain",
                "shards",
                "scripts/ci/rd-owner-chain-shards.tsv",
            ],
            capture_output=True,
            text=True,
            check=True,
            timeout=60,
        ).stdout
        matrix = json.loads(
            next(line for line in matrix_out.splitlines() if line.startswith("matrix="))[
                len("matrix=") :
            ],
        )
        required = {entry["name"] for entry in matrix["chain"]}
        since = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() - LOOKBACK_SECONDS))
        listing = gh(
            f"repos/{repo}/actions/workflows/owner-chains.yml/runs?status=completed&created=>{since}&per_page=100",
            "--paginate",
            "--jq",
            ".workflow_runs[]|@json",
        )
        runs = [json.loads(line) for line in listing.splitlines() if line]
        trees: dict[str, str] = {}

        def commit_tree(sha: str) -> str:
            if sha not in trees:
                trees[sha] = json.loads(gh(f"repos/{repo}/git/commits/{sha}"))["tree"]["sha"]
            return trees[sha]

        def jobs_of(run_id: int) -> list[dict]:
            return json.loads(
                gh(f"repos/{repo}/actions/runs/{run_id}/jobs?filter=latest&per_page=100"),
            )["jobs"]

        def report_log(job_id: int) -> str:
            return gh(f"repos/{repo}/actions/jobs/{job_id}/logs", "--allow-escape-sequences")

        decision = decide(tree, entry_count, required, runs, commit_tree, jobs_of, report_log)
    except Exception as e:  # any failure to look means the chains run
        decision = Decision(None, f"lookup failed ({type(e).__name__}: {e})")
    if decision.run_id is None:
        print(f"chain verdict: running the Owner chains: {decision.reason}")
    else:
        print(
            f"chain verdict: reusing owner-chains run {decision.run_id} ({decision.url}): "
            f"its tree {decision.run_tree} == this checkout's tree {tree}",
        )
    if output:
        with open(output, "a") as sink:
            sink.write(
                f"reuse-run={decision.run_id or ''}\nreuse-url={decision.url}\n"
                f"reuse-tree={decision.run_tree}\nthis-tree={tree}\n",
            )
    return 0


if __name__ == "__main__":
    sys.exit(main())
