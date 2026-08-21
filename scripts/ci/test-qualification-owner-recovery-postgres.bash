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

cargo test -p vibe-qualification --all-features \
  recovery::tests::isolated_postgres_recovery_is_atomic_fail_closed_and_replay_safe \
  -- --ignored --exact --nocapture
