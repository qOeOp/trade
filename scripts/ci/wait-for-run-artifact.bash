#!/usr/bin/env bash
# Wait for an artifact another job of this same workflow run publishes, instead of `needs:`-ing that
# job. A job that `needs:` it cannot start until it ends; one that waits here does its own setup
# first - the chain's shards install their runtime and browser while the archive job compiles - and
# only then blocks, for the artifact alone.
#
# It never waits on a producer that can no longer deliver: once the producing job has completed
# without success (failed, cancelled, skipped), this fails at once and says which, rather than
# holding a runner until the timeout.
#
# Usage: wait-for-run-artifact.bash <artifact name> <producing job name> <timeout seconds>
# Needs GH_TOKEN with actions: read, GITHUB_REPOSITORY, GITHUB_RUN_ID and GITHUB_RUN_ATTEMPT.
set -Eeuo pipefail
trap 'echo "wait-for-run-artifact.bash:${LINENO}: this failed: ${BASH_COMMAND}" >&2' ERR

artifact="${1:?artifact name}"
producer="${2:?producing job name}"
timeout_seconds="${3:?timeout in seconds}"
interval="${WAIT_FOR_RUN_ARTIFACT_INTERVAL:-10}"
run="repos/${GITHUB_REPOSITORY:?}/actions/runs/${GITHUB_RUN_ID:?}"
api_error_file="$(mktemp)"
trap 'rm -f "$api_error_file"' EXIT

# A temporary Actions API failure says nothing about the artifact or its producer. Retry that
# read before deciding; a permission/configuration error still fails immediately.
api_query() {
  local attempt output
  for attempt in 1 2 3; do
    if output="$(gh api "$@" 2> "$api_error_file")"; then
      printf '%s\n' "$output"
      return 0
    fi
    if ! grep -Eqi '\(HTTP (429|5[0-9][0-9])\)|timed? out|connection reset' "$api_error_file" ||
      ((attempt == 3)); then
      cat "$api_error_file" >&2
      return 1
    fi
    echo "Actions API read failed temporarily; retrying (${attempt}/3)" >&2
    sleep "${WAIT_FOR_RUN_ARTIFACT_RETRY_DELAY:-$attempt}"
  done
}

started=$SECONDS
while :; do
  if ! artifacts="$(api_query "${run}/artifacts" --paginate --jq '.artifacts[].name')"; then
    exit 1
  fi
  if grep -Fxq -- "$artifact" <<< "$artifacts"; then
    echo "artifact ${artifact} is published ($((SECONDS - started))s waited)"
    exit 0
  fi
  if ! states="$(api_query "${run}/attempts/${GITHUB_RUN_ATTEMPT:?}/jobs" --paginate \
    --jq ".jobs[] | select(.name == \"${producer}\") | \"\\(.status) \\(.conclusion)\"")"; then
    exit 1
  fi
  state="${states%%$'\n'*}"
  if [[ "$state" == completed\ * && "$state" != "completed success" ]]; then
    echo "ERROR: ${producer} ended as '${state#completed }' without publishing ${artifact}." >&2
    exit 1
  fi
  if ((SECONDS - started >= timeout_seconds)); then
    echo "ERROR: ${artifact} was not published within ${timeout_seconds}s; ${producer} is '${state:-not found}'." >&2
    exit 1
  fi
  sleep "$interval"
done
