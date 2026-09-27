#!/usr/bin/env bash
# Drives require-latest-workflow-verdict.bash against a stand-in `gh` that returns a fixed run listing
# as JSON, so the script's own choice of the run that decides is what gets tested. It must pass only on
# a recent green latest verdict:
# - a recent success passes, also when a newer cancelled run is listed above it;
# - a newer failure over an older success fails, naming that run;
# - a success older than the limit fails;
# - a branch whose runs are all cancelled or on other branches fails;
# - an unreadable or failed listing fails.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REQUIRER="${SCRIPT_DIR}/require-latest-workflow-verdict.bash"
root="$(mktemp -d)"
trap 'rm -rf "$root"' EXIT
export GITHUB_REPOSITORY=o/r PATH="${root}/bin:${PATH}"
# 2026-09-27T12:00:00Z
export REQUIRE_LATEST_NOW=1790510400
mkdir -p "${root}/bin"
cat > "${root}/bin/gh" << 'EOF'
#!/usr/bin/env bash
[[ "${STANDIN_FAIL:-}" != 1 ]] || exit 1
cat "$STANDIN_LISTING"
EOF
chmod +x "${root}/bin/gh"

run() { # id, conclusion, created_at, branch
  printf '{"id":%s,"status":"completed","conclusion":"%s","created_at":"%s","head_branch":"%s","event":"push","head_sha":"abcdef0123456789","html_url":"https://example.invalid/runs/%s"}' \
    "$1" "$2" "$3" "$4" "$1"
}
listing() {
  local IFS=,
  printf '{"workflow_runs":[%s]}' "$*"
}

check() { # name, expected exit, expected fragment, listing
  local name=$1 want=$2 fragment=$3 status=0
  printf '%s' "$4" > "${root}/${name}.json"
  STANDIN_LISTING="${root}/${name}.json" bash "$REQUIRER" security-audit.yml main 49 \
    > "${root}/${name}.out" 2>&1 || status=$?
  if [[ "$status" -ne "$want" ]] || ! grep -qF -- "$fragment" "${root}/${name}.out"; then
    echo "FAIL: ${name}: expected exit ${want} with '${fragment}', got ${status}:" >&2
    cat "${root}/${name}.out" >&2
    exit 1
  fi
  echo "ok ${name}"
}

check recent-success 0 "latest verdict on main is success, 2.0 hours old: run 2" \
  "$(listing "$(run 2 success 2026-09-27T10:00:00Z main)" "$(run 1 failure 2026-09-26T10:00:00Z main)")"
check cancelled-above-success 0 "latest verdict on main is success" \
  "$(listing "$(run 3 cancelled 2026-09-27T11:00:00Z main)" "$(run 2 success 2026-09-27T10:00:00Z main)")"
check failure-above-success 1 "latest verdict on main is failure: run 3" \
  "$(listing "$(run 2 success 2026-09-27T09:00:00Z main)" "$(run 3 failure 2026-09-27T10:00:00Z main)")"
check stale-success 1 "is 50.0 hours old, over 49" \
  "$(listing "$(run 2 success 2026-09-25T10:00:00Z main)")"
check other-branch-only 1 "has no completed run on main" \
  "$(listing "$(run 4 success 2026-09-27T11:00:00Z feature)" "$(run 3 cancelled 2026-09-27T10:00:00Z main)")"
check unreadable 1 "listing on main is unreadable" '<html>rate limited</html>'
STANDIN_FAIL=1 check listing-failed 1 "could not list security-audit.yml's runs on main" '{}'
echo "ok: only a recent green latest verdict passes"
