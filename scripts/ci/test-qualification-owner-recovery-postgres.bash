#!/usr/bin/env bash
set -euo pipefail

: "${QUALIFICATION_OWNER_RECOVERY_TEST_DATABASE_URL:?set an explicit disposable Qualification recovery test database URL}"
: "${QUALIFICATION_OWNER_RECOVERY_SECOND_TEST_DATABASE_URL:?set an explicit second disposable Qualification recovery test database URL}"

if [[ "${QUALIFICATION_OWNER_RECOVERY_TEST_DATABASE_URL}" == "${QUALIFICATION_OWNER_RECOVERY_SECOND_TEST_DATABASE_URL}" ]]; then
  echo "Qualification recovery test databases must be distinct" >&2
  exit 2
fi

if [[ -n "${RD_OWNER_DATABASE_URL:-}" && "${QUALIFICATION_OWNER_RECOVERY_TEST_DATABASE_URL}" == "${RD_OWNER_DATABASE_URL}" ]]; then
  echo "Qualification recovery test database must differ from RD_OWNER_DATABASE_URL" >&2
  exit 2
fi
if [[ -n "${DATABASE_URL:-}" && "${QUALIFICATION_OWNER_RECOVERY_TEST_DATABASE_URL}" == "${DATABASE_URL}" ]]; then
  echo "Qualification recovery test database must differ from DATABASE_URL" >&2
  exit 2
fi
if [[ -n "${RD_OWNER_DATABASE_URL:-}" && "${QUALIFICATION_OWNER_RECOVERY_SECOND_TEST_DATABASE_URL}" == "${RD_OWNER_DATABASE_URL}" ]]; then
  echo "Second Qualification recovery test database must differ from RD_OWNER_DATABASE_URL" >&2
  exit 2
fi
if [[ -n "${DATABASE_URL:-}" && "${QUALIFICATION_OWNER_RECOVERY_SECOND_TEST_DATABASE_URL}" == "${DATABASE_URL}" ]]; then
  echo "Second Qualification recovery test database must differ from DATABASE_URL" >&2
  exit 2
fi

python3 - << 'PY'
import os
from urllib.parse import urlsplit

for variable in (
    "QUALIFICATION_OWNER_RECOVERY_TEST_DATABASE_URL",
    "QUALIFICATION_OWNER_RECOVERY_SECOND_TEST_DATABASE_URL",
):
    parsed = urlsplit(os.environ[variable])
    database = parsed.path.lstrip("/")
    user = parsed.username or ""
    if not database.startswith("qualification_owner_recovery_test_"):
        raise SystemExit(f"{variable} disposable database name marker is missing")
    if not user.startswith("qualification_owner_recovery_test_"):
        raise SystemExit(f"{variable} disposable role marker is missing")
PY

# `cargo test --exact <name>` exits 0 when the name matches nothing: it prints
# `running 0 tests` and `test result: ok`, so a proof that was renamed or deleted
# leaves a line that passes while running nothing. This script already carried one
# such line - `response_cut_rolls_back_stale_create_and_history_corruption_fails_closed`
# was deleted in d5137bbf3 once the response-cut rollback was shown to be unreachable
# from any store this repository can materialize, and the invocation stayed behind.
# Run each proof through this function instead, which refuses a run that selected
# no test. Silence is the failure mode these scripts must not have.
run_exact_proof() {
  local test_path="$1"
  local output
  if ! output="$(cargo test -p vibe-qualification --all-features "$test_path" \
    -- --ignored --exact --nocapture 2>&1)"; then
    printf '%s\n' "$output" >&2
    echo "Qualification recovery proof failed: $test_path" >&2
    return 1
  fi
  printf '%s\n' "$output"
  if ! grep -qE 'test result: ok\. 1 passed' <<< "$output"; then
    echo "Qualification recovery proof selected no test: $test_path" >&2
    echo "       An exact filter that matches nothing exits 0. Fix the name or remove the line." >&2
    return 1
  fi
}

# The selection check reads each proof from a line that holds the test path alone
# (`scripts/ci/check-owner-custody-proof-selection.bash`), so keep the name on its
# own line here. Folding it onto the call line hides this proof from that check.
run_exact_proof \
  recovery::tests::isolated_postgres_recovery_is_atomic_fail_closed_and_replay_safe
