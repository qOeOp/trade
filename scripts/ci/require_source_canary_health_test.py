#!/usr/bin/env python3
"""
Both directions for require_source_canary_health.py, against a stand-in `gh`.

The stand-in serves a run listing, each run's jobs and each job's log, written the way GitHub returns
them: a timestamp before every line and the receipt printed by source_canary.py. Only the same source
failing in the two newest runs is red:
- one failure, then a clean run: green, the failure as a warning only when it is the newest;
- the same source failing twice in a row: red, naming it;
- two different sources failing in consecutive runs: green;
- a cancelled run between two failures: skipped, so the two failures are consecutive and red;
- a source BLOCKED in both runs: green, because only FAILED counts;
- a receipt that cannot be read twice in a row: red; once: green with a warning;
- the newest run older than the limit: red;
- a listing that cannot be read: red;
- a start time read in UTC, not the local zone, and one that cannot be read: red;
- no `datetime.fromisoformat`, which the Python quality runs this under cannot read GitHub's times with.

"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path


SCRIPT = Path(__file__).with_name("require_source_canary_health.py")
SOURCES = ("arXiv query", "CORE work search", "FRED series")
NOW = 1790510400  # 2026-09-27T12:00:00Z

STANDIN = r"""#!/usr/bin/env python3
import json, os, re, sys
fixtures = os.environ["STANDIN_FIXTURES"]
path = sys.argv[-1]
if os.environ.get("STANDIN_FAIL") == "1":
    sys.exit(1)
if "/actions/workflows/" in path:
    print(open(os.path.join(fixtures, "listing.json")).read())
elif m := re.search(r"/actions/runs/(\d+)/jobs", path):
    print(json.dumps({"jobs": [{"id": int(m.group(1)) * 10}]}))
elif m := re.search(r"/actions/jobs/(\d+)/logs", path):
    print(open(os.path.join(fixtures, f"{int(m.group(1)) // 10}.log")).read())
"""


def receipt_log(failed: set[str] | dict[str, str]) -> str:
    """
    Print a receipt: a set names the FAILED sources, a dict gives any source's status.
    """
    statuses = failed if isinstance(failed, dict) else dict.fromkeys(failed, "FAILED")
    receipt = {
        "schema": "qoeop-source-canary-receipt/v1",
        "domain": "research-source",
        "results": [
            {"source": s, "status": statuses.get(s, "HEALTHY"), "detail": "x"} for s in SOURCES
        ],
    }
    body = json.dumps(receipt, indent=2).splitlines()
    lines = ["Run python3 scripts/ci/source_canary.py research-source", *body, "##[error]done"]
    return "\n".join(f"2026-09-27T10:00:00.0000000Z {line}" for line in lines)


def check(label: str, runs: list[tuple[str, str, object]], want: int, fragment: str, **env) -> None:
    """
    Serve these runs, each (created_at, conclusion, failed sources or a raw log), newest
    last.
    """
    with tempfile.TemporaryDirectory() as root:
        fixtures, bin_dir = Path(root, "f"), Path(root, "bin")
        fixtures.mkdir()
        bin_dir.mkdir()
        gh = bin_dir / "gh"
        gh.write_text(STANDIN)
        gh.chmod(0o755)
        listing = []
        for number, (created, conclusion, failed) in enumerate(runs, 1):
            listing.append(
                {
                    "id": number,
                    "status": "completed",
                    "conclusion": conclusion,
                    "created_at": created,
                    "head_branch": "main",
                    "html_url": f"https://example.invalid/runs/{number}",
                },
            )
            log = failed if isinstance(failed, str) else receipt_log(failed)
            (fixtures / f"{number}.log").write_text(log)
        (fixtures / "listing.json").write_text(json.dumps({"workflow_runs": listing}))
        result = subprocess.run(
            [
                sys.executable,
                "-B",
                str(SCRIPT),
                "research-source-canary.yml",
                "main",
                env.pop("MAX_AGE_DAYS", "15"),
            ],
            capture_output=True,
            text=True,
            check=False,
            env={
                **os.environ,
                "PATH": f"{bin_dir}{os.pathsep}{os.environ['PATH']}",
                "GITHUB_REPOSITORY": "o/r",
                "STANDIN_FIXTURES": str(fixtures),
                "REQUIRE_LATEST_NOW": str(NOW),
                **env,
            },
        )
        output = result.stdout + result.stderr
        if result.returncode != want or fragment not in output:
            sys.exit(
                f"FAIL {label}: expected exit {want} with {fragment!r}, got {result.returncode}:\n{output}",
            )
        print(f"ok {label}")


def main() -> None:
    if "fromisoformat(" in SCRIPT.read_text(encoding="utf-8"):
        sys.exit(
            "FAIL the script uses datetime.fromisoformat, which refuses GitHub's trailing Z under the "
            "runner's system Python 3.10 that quality runs it with (run 36357614937)",
        )
    print("ok the script parses GitHub's times without fromisoformat")
    check(
        "one failure, then a clean run",
        [
            ("2026-09-20T10:00:00Z", "failure", {"CORE work search"}),
            ("2026-09-27T10:00:00Z", "success", set()),
        ],
        0,
        "no source failed in two runs in a row",
    )
    check(
        "the newest run fails once",
        [
            ("2026-09-20T10:00:00Z", "success", set()),
            ("2026-09-27T10:00:00Z", "failure", {"arXiv query"}),
        ],
        0,
        "::warning::research-source-canary.yml: arXiv query failed in the newest run",
    )
    check(
        "the same source twice in a row",
        [
            ("2026-09-20T10:00:00Z", "failure", {"arXiv query"}),
            ("2026-09-27T10:00:00Z", "failure", {"arXiv query"}),
        ],
        1,
        "arXiv query failed in the two newest runs",
    )
    check(
        "two different sources in consecutive runs",
        [
            ("2026-09-20T10:00:00Z", "failure", {"CORE work search"}),
            ("2026-09-27T10:00:00Z", "failure", {"arXiv query"}),
        ],
        0,
        "no source failed in two runs in a row",
    )
    check(
        "a cancelled run between two failures",
        [
            ("2026-09-20T10:00:00Z", "failure", {"arXiv query"}),
            ("2026-09-24T10:00:00Z", "cancelled", set()),
            ("2026-09-27T10:00:00Z", "failure", {"arXiv query"}),
        ],
        1,
        "arXiv query failed in the two newest runs",
    )
    check(
        "a source blocked in both runs",
        [
            ("2026-09-20T10:00:00Z", "success", {"arXiv query": "BLOCKED"}),
            ("2026-09-27T10:00:00Z", "success", {"arXiv query": "BLOCKED"}),
        ],
        0,
        "no source failed in two runs in a row",
    )
    check(
        "an unreadable receipt twice",
        [
            ("2026-09-20T10:00:00Z", "failure", "no receipt here"),
            ("2026-09-27T10:00:00Z", "failure", "nor here"),
        ],
        1,
        "(receipt unreadable) failed in the two newest runs",
    )
    check(
        "an unreadable receipt once",
        [
            ("2026-09-20T10:00:00Z", "success", set()),
            ("2026-09-27T10:00:00Z", "failure", "no receipt here"),
        ],
        0,
        "::warning::",
    )
    check(
        "the newest run too old",
        [("2026-09-11T10:00:00Z", "success", set())],
        1,
        "days old, over 15",
    )
    check(
        "a start time 11.5 hours old, under a 12-hour limit, read in UTC",
        [("2026-09-27T00:30:00Z", "success", set())],
        0,
        "no source failed in two runs in a row",
        MAX_AGE_DAYS="0.5",
    )
    check(
        "a start time that cannot be read",
        [("2026-09-27 00:30:00", "success", set())],
        1,
        "could not read when",
    )
    check(
        "the listing cannot be read",
        [("2026-09-27T10:00:00Z", "success", set())],
        1,
        "could not read",
        STANDIN_FAIL="1",
    )
    print("ok: only the same source failing in the two newest runs turns the verdict red")


if __name__ == "__main__":
    main()
