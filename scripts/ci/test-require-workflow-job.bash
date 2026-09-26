#!/usr/bin/env bash
# Drives require-workflow-job.bash against a stand-in `gh` whose answers change call by call. It
# returns once the job succeeds, fails at once and by name when the job ends otherwise, and fails at
# the timeout when no run appears or the job never finishes - a requirement that passes too early
# and one that waits past a finished failure would each pass half of this. Which run is newest is
# chosen by the real `gh --jq` filter, which this stand-in does not evaluate.
set -euo pipefail
while IFS='=' read -r name _; do case "$name" in GIT_*) unset "$name" ;; esac done < <(env)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REQUIRER="${REQUIRE_WORKFLOW_JOB_SCRIPT:-${SCRIPT_DIR}/require-workflow-job.bash}"
root="$(mktemp -d)"
trap 'rm -rf "$root"' EXIT
export GITHUB_REPOSITORY=o/r REQUIRE_WORKFLOW_JOB_INTERVAL=0
export PATH="${root}/bin:${PATH}"
mkdir -p "${root}/bin"

# The stand-in reads, per poll (two calls: runs, then jobs), one scenario line:
# "<run id or empty> | <job status and conclusion>". The last line repeats.
cat > "${root}/bin/gh" << 'EOF'
#!/usr/bin/env bash
calls=$(($(cat "$SCENARIO.n" 2>/dev/null || echo 0) + 1)); echo "$calls" > "$SCENARIO.n"
case "$*" in
  *"/runs?head_sha="*)
    line="$(sed -n "$(cat "$SCENARIO.polls" 2>/dev/null || echo 1)p" "$SCENARIO")"
    [[ -n "$line" ]] || line="$(tail -1 "$SCENARIO")"
    echo $(($(cat "$SCENARIO.polls" 2>/dev/null || echo 1) + 1)) > "$SCENARIO.polls"
    run="${line%%|*}"; run="${run// /}"
    if [[ -n "$run" ]]; then echo "$run"; fi
    ;;
  *"/jobs"*)
    polls=$(($(cat "$SCENARIO.polls") - 1))
    line="$(sed -n "${polls}p" "$SCENARIO")"; [[ -n "$line" ]] || line="$(tail -1 "$SCENARIO")"
    echo "${line#*| }"
    ;;
esac
EOF
chmod +x "${root}/bin/gh"

run_case() { # name, expected exit, expected output fragment, timeout, scenario lines...
  local name=$1 want=$2 fragment=$3 timeout=$4
  shift 4
  export SCENARIO="${root}/${name}"
  printf '%s\n' "$@" > "$SCENARIO"
  local status=0
  # Bounded from outside: a requirement that ignores its own timeout would otherwise hang this test.
  timeout 20 bash "$REQUIRER" pre-commit-pr.yml "pre-commit (no-compile hooks)" abc123 "$timeout" \
    > "${root}/${name}.out" 2>&1 || status=$?
  if [[ "$status" -eq 124 ]]; then
    echo "FAIL: ${name}: still waiting after 20s; it ignored its ${timeout}s timeout." >&2
    exit 1
  fi
  if [[ "$status" -ne "$want" ]] || ! grep -qF -- "$fragment" "${root}/${name}.out"; then
    echo "FAIL: ${name}: expected exit ${want} with '${fragment}', got ${status}:" >&2
    cat "${root}/${name}.out" >&2
    exit 1
  fi
}

run_case succeeds-after-running 0 "succeeded on abc123 (run 7" 60 \
  "| " "7 | in_progress " "7 | completed success"
run_case failed 1 "ended as 'failure' on abc123 (run 7)" 60 \
  "7 | in_progress " "7 | completed failure"
run_case cancelled 1 "ended as 'cancelled'" 60 "7 | completed cancelled"
run_case never-ran 1 "did not succeed on abc123 within 0s; it is 'not found'" 0 "| "
run_case still-running-at-timeout 1 "it is 'in_progress '" 0 "7 | in_progress "

echo "require-workflow-job: waits for the job, fails by name on any other ending and at the timeout"
