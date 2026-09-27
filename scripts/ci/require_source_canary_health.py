#!/usr/bin/env python3
"""
Turn main's verdict red when the same research source fails in two canary runs in a row.

research-source-canary.yml probes external research sources once a week and nothing read its result:
it was red from 2026-09-22 (arXiv HTTP 406, which source_canary.py now reads as BLOCKED) with no
verdict affected. Every run red would be too noisy - sources time out now and then and recover by the
next run (CORE and Semantic Scholar on 2026-09-01) - and a result nobody reads is the same as no
probe. Only FAILED counts here; BLOCKED, RATE_LIMITED and SKIPPED describe this runner, not the
source. So, per source:
- FAILED in the newest two completed runs: red, naming the source and both runs;
- FAILED in the newest run only: a warning annotation, and green;
- a run whose receipt cannot be read counts as every source failing in it, so two such runs in a row
  are red and one is a warning;
- the newest run older than the given days (the weekly schedule stopped): red.

Receipts are read from each run's job log, where source_canary.py prints them as JSON.

Usage: require_source_canary_health.py <workflow file> <branch> <max age in days>
Needs GH_TOKEN with actions: read and GITHUB_REPOSITORY. REQUIRE_LATEST_NOW (epoch seconds) stands in
for the clock in tests.

"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import time
from datetime import datetime


GH = shutil.which("gh") or "gh"
SCHEMA = "qoeop-source-canary-receipt/v1"
TIMESTAMP = re.compile(r"^\d{4}-\d\d-\d\dT[\d:.]+Z ")
UNREADABLE = "(receipt unreadable)"


def gh(path: str) -> str:
    return subprocess.run(
        [GH, "api", "--allow-escape-sequences", path],
        capture_output=True,
        text=True,
        check=True,
        timeout=60,
    ).stdout


def failed_sources(log: str) -> set[str]:
    """
    Return the sources this log's receipt reports FAILED, or {UNREADABLE} when it holds
    no receipt.
    """
    lines = [TIMESTAMP.sub("", line) for line in log.splitlines()]
    for start, line in enumerate(lines):
        if line.rstrip() != "{" or start + 1 >= len(lines) or SCHEMA not in lines[start + 1]:
            continue
        for end in range(start + 1, len(lines)):
            if lines[end].rstrip() == "}":
                try:
                    receipt = json.loads("\n".join(lines[start : end + 1]))
                    return {
                        result["source"]
                        for result in receipt["results"]
                        if result["status"] == "FAILED"
                    }
                except (ValueError, KeyError, TypeError):
                    return {UNREADABLE}
    return {UNREADABLE}


def run_failures(repo: str, run_id: int) -> set[str]:
    jobs = json.loads(gh(f"repos/{repo}/actions/runs/{run_id}/jobs"))["jobs"]
    failures: set[str] = set()
    for job in jobs:
        failures |= failed_sources(gh(f"repos/{repo}/actions/jobs/{job['id']}/logs"))
    return failures or set()


def main() -> int:
    workflow, branch, max_age_days = sys.argv[1], sys.argv[2], float(sys.argv[3])
    repo = os.environ["GITHUB_REPOSITORY"]
    try:
        listing = json.loads(
            gh(
                f"repos/{repo}/actions/workflows/{workflow}/runs?branch={branch}&status=completed&per_page=20",
            ),
        )["workflow_runs"]
        runs = sorted(
            (
                run
                for run in listing
                if run.get("conclusion") != "cancelled" and run.get("head_branch") == branch
            ),
            key=lambda run: run["created_at"],
            reverse=True,
        )[:2]
        if not runs:
            print(f"ERROR: {workflow} has no completed run on {branch}.", file=sys.stderr)
            return 1
        failures = [run_failures(repo, run["id"]) for run in runs]
    except (subprocess.SubprocessError, ValueError, KeyError) as e:
        print(f"ERROR: could not read {workflow}'s runs on {branch} ({e}).", file=sys.stderr)
        return 1

    newest = runs[0]
    created = datetime.fromisoformat(newest["created_at"]).timestamp()
    now = float(os.environ.get("REQUIRE_LATEST_NOW") or time.time())
    age_days = (now - created) / 86400
    if age_days > max_age_days:
        print(
            f"ERROR: {workflow}'s newest run on {branch} is {age_days:.1f} days old, over "
            f"{max_age_days:g}: run {newest['id']} {newest.get('html_url', '')}",
            file=sys.stderr,
        )
        return 1

    where = [f"run {run['id']} ({run['created_at']})" for run in runs]
    twice = sorted(failures[0] & failures[1]) if len(failures) == 2 else []
    if twice:
        print(
            f"ERROR: {workflow}: {', '.join(twice)} failed in the two newest runs on {branch}: "
            f"{' and '.join(where)}.",
            file=sys.stderr,
        )
        return 1
    if failures[0]:
        print(
            f"::warning::{workflow}: {', '.join(sorted(failures[0]))} failed in the newest run on "
            f"{branch}, {where[0]}. Red only if the same source fails in the next run too.",
        )
    print(f"{workflow} on {branch}: no source failed in two runs in a row ({'; '.join(where)}).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
