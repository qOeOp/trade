#!/usr/bin/env bash
# Drives wait-for-run-artifact.bash against a stand-in `gh` whose answers change call by call:
# it returns once the artifact appears, fails at once and by name when the producer ends without it,
# and fails at the timeout when nothing ever happens - a waiter that returns too early and one that
# waits past a dead producer would each pass half of this.
set -euo pipefail
while IFS='=' read -r name _; do case "$name" in GIT_*) unset "$name" ;; esac done < <(env)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WAITER="${WAIT_FOR_RUN_ARTIFACT_SCRIPT:-${SCRIPT_DIR}/wait-for-run-artifact.bash}"
root="$(mktemp -d)"
trap 'rm -rf "$root"' EXIT
export GITHUB_REPOSITORY=o/r GITHUB_RUN_ID=1 GITHUB_RUN_ATTEMPT=1 WAIT_FOR_RUN_ARTIFACT_INTERVAL=0
export PATH="${root}/bin:${PATH}"
mkdir -p "${root}/bin"

# The stand-in reads, per call, one line of the scenario: "<artifact names> | <producer state>".
cat > "${root}/bin/gh" << 'EOF'
#!/usr/bin/env bash
calls=$(($(cat "$SCENARIO.n" 2>/dev/null || echo 0) + 1)); echo "$calls" > "$SCENARIO.n"
line="$(sed -n "$(((calls + 1) / 2))p" "$SCENARIO")"; [[ -n "$line" ]] || line="$(tail -1 "$SCENARIO")"
case "$*" in
  *"/artifacts "*) tr ' ' '\n' <<< "${line%%|*}" | sed '/^$/d' ;;
  *"/jobs "*) echo "${line#*| }" ;;
esac
EOF
chmod +x "${root}/bin/gh"

run_case() { # name, expected exit, expected output fragment, timeout, scenario lines...
  local name=$1 want=$2 fragment=$3 timeout=$4
  shift 4
  export SCENARIO="${root}/${name}"
  printf '%s\n' "$@" > "$SCENARIO"
  local status=0
  # Bounded from outside: a waiter that ignores its own timeout would otherwise hang this test.
  timeout 20 bash "$WAITER" rd-owner-archive "rd owner archive (ubuntu-22.04)" "$timeout" \
    > "${root}/${name}.out" 2>&1 || status=$?
  if [[ "$status" -eq 124 ]]; then
    echo "FAIL: ${name}: the waiter was still waiting after 20s; it ignored its ${timeout}s timeout." >&2
    exit 1
  fi
  if [[ "$status" -ne "$want" ]] || ! grep -qF -- "$fragment" "${root}/${name}.out"; then
    echo "FAIL: ${name}: expected exit ${want} with '${fragment}', got ${status}:" >&2
    cat "${root}/${name}.out" >&2
    exit 1
  fi
}

run_case appears 0 "artifact rd-owner-archive is published" 60 \
  " | in_progress " "other | in_progress " "other rd-owner-archive | completed success"
run_case producer-failed 1 "ended as 'failure' without publishing rd-owner-archive" 60 \
  " | in_progress " " | completed failure"
run_case producer-skipped 1 "ended as 'skipped'" 60 " | completed skipped"
run_case never 1 "was not published within 0s" 0 " | in_progress "
# A near-miss name is not the artifact.
run_case prefix-is-not-a-match 1 "was not published within 0s" 0 "rd-owner-archive-old | in_progress "

echo "wait-for-run-artifact: returns once published, fails by name on a dead producer and at the timeout"
