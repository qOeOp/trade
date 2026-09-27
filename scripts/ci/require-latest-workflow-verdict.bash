#!/usr/bin/env bash
# Require that a workflow's latest verdict on a branch is green and recent.
#
# build.yml's quality uses it on main for security-audit.yml, which runs on main's pushes and once a
# day but gates nothing there: from 2026-09-23 to 09-27 it was red for 53 runs while every verdict
# main produced stayed green. Pull requests that touch what it audits require it through the
# path-filtered workflows; this makes main's own verdict carry it too.
#
# The newest completed run on the branch decides. A cancelled run is no verdict and is skipped.
# It fails, naming the run, when that run did not succeed, when it is older than the given hours (a
# stopped schedule must not keep an old green alive), when no completed run is listed, and when the
# listing cannot be read at all.
#
# Usage: require-latest-workflow-verdict.bash <workflow file> <branch> <max age in hours>
# Needs GH_TOKEN with actions: read and GITHUB_REPOSITORY. REQUIRE_LATEST_NOW (epoch seconds) stands
# in for the clock in tests.
set -Eeuo pipefail
trap 'echo "require-latest-workflow-verdict.bash:${LINENO}: this failed: ${BASH_COMMAND}" >&2' ERR

workflow="${1:?workflow file}"
branch="${2:?branch}"
max_age_hours="${3:?max age in hours}"
listing="$(mktemp)"
trap 'rm -f "$listing"' EXIT

if ! gh api "repos/${GITHUB_REPOSITORY:?}/actions/workflows/${workflow}/runs?branch=${branch}&status=completed&per_page=30" \
  > "$listing" 2> /dev/null; then
  echo "ERROR: could not list ${workflow}'s runs on ${branch}, so its verdict is unknown." >&2
  exit 1
fi

python3 - "$listing" "$workflow" "$branch" "$max_age_hours" << 'PY'
import json
import os
import sys
import time
from datetime import datetime

path, workflow, branch, max_age_hours = sys.argv[1], sys.argv[2], sys.argv[3], float(sys.argv[4])
try:
    runs = json.load(open(path))["workflow_runs"]
except (ValueError, KeyError, TypeError) as error:
    sys.exit(f"ERROR: {workflow}'s run listing on {branch} is unreadable ({error}), so its verdict is unknown.")
verdicts = sorted(
    (
        run
        for run in runs
        if run.get("status") == "completed"
        and run.get("conclusion") != "cancelled"
        and run.get("head_branch") == branch
    ),
    key=lambda run: run["created_at"],
    reverse=True,
)
if not verdicts:
    sys.exit(f"ERROR: {workflow} has no completed run on {branch} among the last {len(runs)} listed.")
latest = verdicts[0]
created = datetime.fromisoformat(latest["created_at"].replace("Z", "+00:00")).timestamp()
now = float(os.environ.get("REQUIRE_LATEST_NOW") or time.time())
age_hours = (now - created) / 3600
where = (
    f"run {latest['id']} ({latest.get('event')}, {latest['created_at']}, "
    f"head {latest.get('head_sha', '')[:9]}): {latest.get('html_url', '')}"
)
if latest.get("conclusion") != "success":
    sys.exit(f"ERROR: {workflow}'s latest verdict on {branch} is {latest.get('conclusion')}: {where}")
if age_hours > max_age_hours:
    sys.exit(
        f"ERROR: {workflow}'s latest verdict on {branch} is {age_hours:.1f} hours old, over "
        f"{max_age_hours:g}: {where}",
    )
print(f"{workflow}'s latest verdict on {branch} is success, {age_hours:.1f} hours old: {where}")
PY
