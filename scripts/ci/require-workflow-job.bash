#!/usr/bin/env bash
# Require that a job of another workflow succeeded on one commit, waiting while it is still running.
#
# build.yml's pre-commit job uses it on a pull request: the hooks that need no compiled workspace run
# in pre-commit-pr.yml on every push, and this makes their result part of the job `quality`
# requires, so they still gate the merge. The newest run of that workflow for the commit decides;
# a run that ended without success, or none within the timeout, fails here and says which.
#
# Usage: require-workflow-job.bash <workflow file> <job name> <commit sha> <timeout seconds>
# Needs GH_TOKEN with actions: read and GITHUB_REPOSITORY.
set -Eeuo pipefail
trap 'echo "require-workflow-job.bash:${LINENO}: this failed: ${BASH_COMMAND}" >&2' ERR

workflow="${1:?workflow file}"
job="${2:?job name}"
sha="${3:?commit sha}"
timeout_seconds="${4:?timeout in seconds}"
interval="${REQUIRE_WORKFLOW_JOB_INTERVAL:-15}"
repo="repos/${GITHUB_REPOSITORY:?}"

started=$SECONDS
state=""
while :; do
  run="$(gh api "${repo}/actions/workflows/${workflow}/runs?head_sha=${sha}&per_page=100" \
    --jq '[.workflow_runs[]] | sort_by(.run_number) | last | .id // empty')"
  if [[ -n "$run" ]]; then
    state="$(gh api "${repo}/actions/runs/${run}/jobs" --paginate \
      --jq ".jobs[] | select(.name == \"${job}\") | \"\\(.status) \\(.conclusion)\"" | head -1)"
    case "$state" in
      "completed success")
        echo "${workflow} / ${job} succeeded on ${sha} (run ${run}, $((SECONDS - started))s waited)"
        exit 0
        ;;
      completed\ *)
        echo "ERROR: ${workflow} / ${job} ended as '${state#completed }' on ${sha} (run ${run})." >&2
        exit 1
        ;;
    esac
  fi
  if ((SECONDS - started >= timeout_seconds)); then
    echo "ERROR: ${workflow} / ${job} did not succeed on ${sha} within ${timeout_seconds}s;" \
      "it is '${state:-not found}'." >&2
    exit 1
  fi
  sleep "$interval"
done
