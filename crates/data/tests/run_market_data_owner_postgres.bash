#!/usr/bin/env bash
set -euo pipefail

# Ordered Market Data Owner custody proofs. Each one runs in its own freshly provisioned database
# on the one disposable server, so no proof inherits another's custody and none has to clean up
# after itself; the list fails fast at the first red proof.
readonly market_data_owner_postgres_tests=(
  owner::postgres::tests::postgres_owner_is_atomic_restart_safe_acl_sealed_and_fail_closed
  owner::postgres::sample_projection_v4::tests::postgres_v4_is_atomic_idempotent_exact_and_tamper_closed
  owner::postgres::live_market_stream_v1::tests::postgres_live_channel_head_resumes_and_is_acl_sealed_and_tamper_closed
  owner::store_admission::tests::the_admitted_bar_schedule_order_verifies_before_it_revalidates
  owner::store_admission::tests::a_refused_pit_readback_never_reads_schedule_candidates
  owner::instrument_master_v2_postgres::tests::postgres_v2_cut_custody_holds_one_or_two_members_and_migrates_a_legacy_table
  owner::instrument_master_v2_postgres::tests::postgres_bound_replay_issuance_keys_each_request_to_one_binding
  owner::instrument_economic_terms_postgres_v1::tests::postgres_economic_terms_resolve_for_one_member_or_two
)

# The ordered chain refuses a guarded crate whose test SQL is destructive without dedicated-database
# admission, and it refuses it statically, before a single test runs. This runner provisions its own
# database per proof, so it never needed that admission and never looked for it either: a proof can
# be green here and stop the chain leg an hour later in the queue. Ask the same question first.
#
# The rule is mirrored rather than imported because `scripts/ci/test-rd-owner-postgres.bash` belongs
# to the platform lane and pins its own source by line number. If the two ever disagree, the chain
# is authority and this copy is the stale one.
check_destructive_sql_admission() {
  python3 - "$repository_root" << 'PRECHECK'
from pathlib import Path
import re
import sys

destructive = re.compile(
    r'["\']\s*(?:DROP\s+(?:TABLE|SCHEMA|DATABASE)|TRUNCATE\s+TABLE|DELETE\s+FROM)\b',
    re.I,
)
guards = ("DedicatedPostgresTestDatabase", "CanonicalOwnerPostgresTestDatabaseV1")
legacy = {
    "crates/data/src/owner/postgres/sample_projection_v4.rs",
    "crates/data/src/owner/postgres/tests.rs",
}
root = Path(sys.argv[1])
failures = []

for path in (root / "crates" / "data").rglob("*.rs"):
    relative = path.relative_to(root).as_posix()
    text = path.read_text(encoding="utf-8")
    if not destructive.search(text) or relative in legacy:
        continue
    if not any(guard in text for guard in guards) or ".mutation()" not in text:
        failures.append(relative)

if failures:
    print(
        "ERROR: destructive PostgreSQL test SQL lacks dedicated-database admission:",
        file=sys.stderr,
    )
    for failure in failures:
        print(f"  {failure}", file=sys.stderr)
    print(
        "  the ordered chain refuses this before it runs anything; "
        "assert privileges with has_table_privilege instead of issuing the statement",
        file=sys.stderr,
    )
    sys.exit(1)
PRECHECK
}

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
check_destructive_sql_admission

# The same machine-wide lock as the ordered chain, on the same file: one local Owner chain at a
# time, whichever it is, taken before the first container. scripts/ci/owner-chain-lock.bash says
# why. A hosted runner runs one job, so CI does not take it.
if [[ "${GITHUB_ACTIONS:-}" != "true" ]]; then
  # shellcheck source=scripts/ci/owner-chain-lock.bash
  source "${repository_root}/scripts/ci/owner-chain-lock.bash"
  acquire_owner_chain_lock || exit 1
fi

container="vibe-md-d1-${PPID}-$$"
database_prefix="vibe_test_market_data_${PPID}_$$"
marker_prefix="md-d1-${PPID}-$$"
admin_password="md_d1_admin_test_only"
owner_password="md_d1_owner_test_only"
reader_password="md_d1_reader_test_only"

# shellcheck disable=SC2329 # invoked indirectly by the EXIT trap
cleanup() {
  local primary_status="${1:-0}"
  local cleanup_status=0
  local matching_containers=""

  if ! matching_containers="$(docker ps -aq --filter "name=^/${container}$")"; then
    cleanup_status=1
  elif [[ -n "$matching_containers" ]]; then
    docker rm -f "$container" > /dev/null 2>&1 || cleanup_status=$?
  fi

  if ! matching_containers="$(docker ps -aq --filter "name=^/${container}$")"; then
    cleanup_status=1
  elif [[ -n "$matching_containers" ]]; then
    cleanup_status=1
  fi

  if [[ "$primary_status" -ne 0 ]]; then
    exit "$primary_status"
  fi

  exit "$cleanup_status"
}
trap 'cleanup "$?"' EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

docker run --detach --name "$container" --publish 127.0.0.1::5432 \
  --env POSTGRES_PASSWORD="$admin_password" postgres:16.10-alpine > /dev/null

# The postgres entrypoint runs initdb against a temporary server, stops it, then starts the real
# one. A single `pg_isready` can answer for the temporary server and be followed immediately by the
# restart, which is how this bootstrap failed on main at 19:14 on 2026-09-16: `pg_isready` returned
# 2 (no response) about 1.5 s after the container started, and because it reports on stdout the
# `> /dev/null` left the step with no diagnosis at all. Requiring consecutive successes spans the
# restart instead of racing it.
required_consecutive_ready=3
consecutive_ready=0
for _ in $(seq 1 60); do
  if docker exec "$container" pg_isready -U postgres > /dev/null 2>&1; then
    consecutive_ready=$((consecutive_ready + 1))
    if [[ "$consecutive_ready" -ge "$required_consecutive_ready" ]]; then
      break
    fi
  else
    consecutive_ready=0
  fi
  sleep 1
done

if [[ "$consecutive_ready" -lt "$required_consecutive_ready" ]]; then
  # Keep stdout and stderr: this is the only place that can say why the server never settled.
  echo "market-data bootstrap: ${container} never reported ready ${required_consecutive_ready} times" >&2
  docker exec "$container" pg_isready -U postgres >&2 || true
  docker logs --tail 50 "$container" >&2 || true
  exit 1
fi

port="$(docker port "$container" 5432/tcp | sed -E 's/.*:([0-9]+)$/\1/')"
docker exec "$container" psql -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -c "CREATE ROLE vibe_test_role_market_data_owner LOGIN PASSWORD '$owner_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS"
docker exec "$container" psql -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -c "CREATE ROLE vibe_test_role_market_data_reader LOGIN PASSWORD '$reader_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS"

# Provisions one database the way the deployment's Market Data store is admitted: owned by the
# Owner role, with a private schema the reader cannot even see and an immutable admin marker the
# test harness verifies before it will treat the database as disposable.
provision_database() {
  local database="$1"
  local marker="$2"
  local schema_admitted

  docker exec "$container" psql -v ON_ERROR_STOP=1 -U postgres -d postgres \
    -c "CREATE DATABASE \"$database\" OWNER vibe_test_role_market_data_owner"
  docker exec "$container" psql -v ON_ERROR_STOP=1 -U postgres -d "$database" \
    -c "CREATE SCHEMA market_data_private AUTHORIZATION vibe_test_role_market_data_owner; ALTER SCHEMA market_data_private OWNER TO vibe_test_role_market_data_owner; REVOKE ALL ON SCHEMA market_data_private FROM PUBLIC, vibe_test_role_market_data_reader"
  schema_admitted="$(docker exec "$container" psql -v ON_ERROR_STOP=1 -U postgres -d "$database" -Atqc "SELECT pg_catalog.pg_get_userbyid(namespace.nspowner)='vibe_test_role_market_data_owner' AND pg_catalog.has_schema_privilege('vibe_test_role_market_data_owner',namespace.oid,'USAGE') AND pg_catalog.has_schema_privilege('vibe_test_role_market_data_owner',namespace.oid,'CREATE') AND NOT pg_catalog.has_schema_privilege('vibe_test_role_market_data_reader',namespace.oid,'USAGE') AND NOT pg_catalog.has_schema_privilege('vibe_test_role_market_data_reader',namespace.oid,'CREATE') AND NOT EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(namespace.nspacl,pg_catalog.acldefault('n',namespace.nspowner))) privilege WHERE privilege.grantee=0 AND privilege.privilege_type IN ('USAGE','CREATE')) FROM pg_catalog.pg_namespace namespace WHERE namespace.nspname='market_data_private'")"
  [[ "$schema_admitted" == "t" ]]
  docker exec "$container" psql -v ON_ERROR_STOP=1 -U postgres -d "$database" \
    -c "CREATE TABLE public.vibe_test_instance_marker(marker_identity TEXT PRIMARY KEY); INSERT INTO public.vibe_test_instance_marker VALUES ('$marker'); REVOKE ALL ON public.vibe_test_instance_marker FROM PUBLIC; GRANT SELECT ON public.vibe_test_instance_marker TO vibe_test_role_market_data_owner, vibe_test_role_market_data_reader"

  export MARKET_DATA_ADMIN_TEST_DATABASE_URL="postgres://postgres:$admin_password@127.0.0.1:$port/$database"
  export MARKET_DATA_OWNER_TEST_DATABASE_URL="postgres://vibe_test_role_market_data_owner:$owner_password@127.0.0.1:$port/$database"
  export MARKET_DATA_READER_TEST_DATABASE_URL="postgres://vibe_test_role_market_data_reader:$reader_password@127.0.0.1:$port/$database"
  export VIBE_POSTGRES_TEST_DATABASE_NAME="$database"
  export VIBE_POSTGRES_TEST_INSTANCE_MARKER="$marker"
}

ordinal=0
for test_selection in "${market_data_owner_postgres_tests[@]}"; do
  ordinal=$((ordinal + 1))
  provision_database "${database_prefix}_${ordinal}" "${marker_prefix}-${ordinal}"

  # Selection runs under nextest, not `cargo test --exact`, because the two differ on the case that
  # matters: a name that no longer exists. `cargo test --exact missing_name` prints `0 passed` and
  # exits 0, so renaming a proof would leave this gate green while running nothing at all. nextest
  # refuses an empty selection with `error: no tests to run` and a non-zero exit, which makes the
  # gate fail closed by construction rather than by a wrapper someone has to remember to keep.
  set +e
  cargo nextest run \
    --manifest-path crates/data/Cargo.toml \
    --lib \
    --cargo-profile "${CARGO_CI_PROFILE:-nextest}" \
    --run-ignored all \
    -E "test(=${test_selection})"
  test_status=$?
  set -e

  if [[ "$test_status" -ne 0 ]]; then
    echo "market-data proof ${ordinal}/${#market_data_owner_postgres_tests[@]} failed: ${test_selection}" >&2
    echo "  a non-zero exit here is either a failing proof or a selection that matched nothing;" >&2
    echo "  nextest prints 'error: no tests to run' for the second, which means the name is stale" >&2
    exit "$test_status"
  fi
done

# Every SECURITY DEFINER routine, in every database the chain materialized, must search pg_temp last
# and name no schema another role can create in; scripts/ci/check-security-definer-search-path.sql
# holds the rule and the shrinking list of routines that do not meet it yet.
guard_databases=(postgres)
for ((guard_ordinal = 1; guard_ordinal <= ${#market_data_owner_postgres_tests[@]}; guard_ordinal++)); do
  guard_databases+=("${database_prefix}_${guard_ordinal}")
done
bash "$repository_root/scripts/ci/run-security-definer-guard.bash" "$container" "${guard_databases[@]}"

exit 0
