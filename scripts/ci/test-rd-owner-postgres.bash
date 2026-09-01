#!/usr/bin/env bash

set -euo pipefail

readonly guarded_roots=(
  crates/operator_authorization
  crates/product_edge
  crates/rd_source_intake_invocation_custody
  crates/qualification
  crates/strategy_factory
  crates/strategy_factory_rd_owner_api
)

# Build the three Owner test packages into one nextest archive. The ordered
# package/binary/test filters below then run from that immutable build while
# the database-sensitive tests still execute one at a time and fail fast.
readonly rd_owner_postgres_tests=(
  'vibe-strategy-factory|exploratory_replay_request_owner|legacy_replay_table_is_preserved_while_current_custody_commits_and_reads_back'
  'vibe-strategy-factory|vibe_strategy_factory|artifact_build_postgres::postgres_freshness_tests::legacy_prepared_drain_is_atomic_idempotent_and_read_only'
  'vibe-strategy-factory|vibe_strategy_factory|product_edge_postgres::tests::fresh_rd_owner_migrates_before_qualification_writer_validates'
  'vibe-strategy-factory|develop_composer_owner_v2|durable_owner_is_atomic_restart_exact_and_fail_closed'
  'vibe-strategy-factory|source_intake|postgres_source_invocation_lifecycle_is_canonical_once_only_and_acl_sealed'
  'vibe-strategy-factory-rd-owner-api|rd_owner_api_main|tests::same_identity_started_retry_returns_http_ok_with_exact_custody_once'
  'vibe-product-edge|vibe_product_edge|postgres::tests::genesis_admission_claim_cutover_and_revocation_are_canonical'
  'vibe-strategy-factory|exploratory_replay_request_owner|frozen_exploratory_replay_request_is_sealed_for_canonical_backtest_owner'
  'vibe-strategy-factory|exploratory_replay_request_owner|replay_at_or_after_valid_through_writes_no_frozen_row_or_outbox'
  'vibe-strategy-factory|source_intake|postgres_readback_rejects_tampered_raw_payload'
  'vibe-strategy-factory|vibe_strategy_factory|artifact_build_postgres::postgres_freshness_tests::specialized_artifact_admission_rechecks_locked_rd_view_at_final_cut'
)
readonly nextest_graph_args=(
  --locked
  --package vibe-strategy-factory
  --package vibe-strategy-factory-rd-owner-api
  --package vibe-product-edge
  --lib
  --tests
)
readonly nextest_archive_features='vibe-strategy-factory/sealed-develop-composer-acceptance'
readonly nextest_execution_args=(--fail-fast --run-ignored ignored-only)

check_nextest_graph_contract() {
  if rg -n '^[[:space:]]*cargo[[:space:]]+test([[:space:]]|$)' "${BASH_SOURCE[0]}"; then
    echo "ERROR: isolated PostgreSQL tests must use the shared nextest graph." >&2
    return 1
  fi
  if [[ "${#rd_owner_postgres_tests[@]}" -ne 11 ]]; then
    echo "ERROR: isolated PostgreSQL test selection must retain all eleven ordered tests." >&2
    return 1
  fi
  if [[ "${rd_owner_postgres_tests[0]}" != *'|legacy_replay_table_is_preserved_while_current_custody_commits_and_reads_back' ]] ||
    [[ "${rd_owner_postgres_tests[9]}" != *'|postgres_readback_rejects_tampered_raw_payload' ]] ||
    [[ "${rd_owner_postgres_tests[10]}" != *'|artifact_build_postgres::postgres_freshness_tests::specialized_artifact_admission_rechecks_locked_rd_view_at_final_cut' ]]; then
    echo "ERROR: isolated PostgreSQL test ordering must remain fresh-first and poison-last." >&2
    return 1
  fi
  if [[ "${nextest_graph_args[*]}" != '--locked --package vibe-strategy-factory --package vibe-strategy-factory-rd-owner-api --package vibe-product-edge --lib --tests' ]] ||
    [[ "$nextest_archive_features" != 'vibe-strategy-factory/sealed-develop-composer-acceptance' ]] ||
    [[ "${nextest_execution_args[*]}" != '--fail-fast --run-ignored ignored-only' ]]; then
    echo "ERROR: shared nextest graph or sequential ignored-only execution changed." >&2
    return 1
  fi

  local repository_root
  repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
  if ! rg -Uq \
    'cargo-test-rd-owner-postgres-isolated: check-nextest-installed.*\n\tNEXTEST_PROFILE="\$\(NEXTEST_PROFILE\)".*\n\tCARGO_CI_PROFILE="\$\(CARGO_CI_PROFILE\)".*\n\tRD_OWNER_POSTGRES_FEATURES="\$\(CARGO_FEATURES\)"' \
    "$repository_root/Makefile"; then
    echo "ERROR: Makefile must pass the shared nextest graph explicitly." >&2
    return 1
  fi
  if [[ "$(rg -c 'EXTRA_FEATURES="\$\{RUST_TEST_EXTRA_FEATURES\}"' \
    "$repository_root/.github/workflows/build.yml")" -ne 2 ]]; then
    echo "ERROR: workspace CI and local rust test step must use the shared feature graph." >&2
    return 1
  fi
  if ! rg -Uq \
    'RUST_TEST_EXTRA_FEATURES: >-\n[[:space:]]+capnp,hypersync,vibe-serialization/sbe,vibe-infrastructure/postgres,\n[[:space:]]+vibe-strategy-factory/sealed-develop-composer-acceptance' \
    "$repository_root/.github/workflows/rd-owner-postgres.yml"; then
    echo "ERROR: rd-owner-postgres workflow must define sealed-develop-composer-acceptance feature union." >&2
    return 1
  fi
  if ! rg -n 'EXTRA_FEATURES="\$\{RUST_TEST_EXTRA_FEATURES\}"' \
    "$repository_root/.github/workflows/rd-owner-postgres.yml" > /dev/null; then
    echo "ERROR: rd-owner-postgres workflow must pass RUST_TEST_EXTRA_FEATURES to the isolated test graph." >&2
    return 1
  fi
}

check_static_isolation() {
  local forbidden_fallback
  forbidden_fallback='RD_OWNER_TEST_DATABASE_URL or RD_OWNER_DATABASE_URL|or_else\(\|\| std::env::var\("(RD_OWNER|PRODUCT_EDGE|OPERATOR_AUTHORIZATION|WINDMILL)_DATABASE_URL"\)'
  if rg -n --glob '*.rs' "$forbidden_fallback" "${guarded_roots[@]}"; then
    echo "ERROR: PostgreSQL tests may not fall back to a production/default database URL." >&2
    return 1
  fi

  python3 - "${guarded_roots[@]}" << 'PY'
from pathlib import Path
import re
import sys

destructive = re.compile(
    r'["\']\s*(?:DROP\s+(?:TABLE|SCHEMA|DATABASE)|TRUNCATE\s+TABLE|DELETE\s+FROM)\b',
    re.I,
)
isolated_test_database_guards = (
    "DedicatedPostgresTestDatabase",
    "CanonicalOwnerPostgresTestDatabaseV1",
)
failures = []
for root in map(Path, sys.argv[1:]):
    for path in root.rglob("*.rs"):
        text = path.read_text(encoding="utf-8")
        if not destructive.search(text):
            continue
        recovery_owned_qualification = path.as_posix() in {
            "crates/qualification/src/postgres.rs",
            "crates/qualification/src/recovery.rs",
        }
        if (
            recovery_owned_qualification
            and "QUALIFICATION_OWNER_RECOVERY_TEST_DATABASE_URL" in text
        ):
            continue
        if (
            not any(guard in text for guard in isolated_test_database_guards)
            or ".mutation()" not in text
        ):
            failures.append(str(path))
if failures:
    print("ERROR: destructive PostgreSQL test SQL lacks dedicated-database admission:", file=sys.stderr)
    for failure in failures:
        print(f"  {failure}", file=sys.stderr)
    raise SystemExit(1)
PY
}

check_static_isolation
check_nextest_graph_contract
if [[ "${1:-}" == "--check" ]]; then
  exit 0
fi

if [[ -z "${CARGO_CI_PROFILE:-}" ]]; then
  echo "ERROR: CARGO_CI_PROFILE must select a Cargo compile profile." >&2
  exit 1
fi
readonly cargo_ci_profile="$CARGO_CI_PROFILE"
if [[ -z "${NEXTEST_PROFILE:-}" ]]; then
  echo "ERROR: NEXTEST_PROFILE must select a nextest execution profile." >&2
  exit 1
fi
readonly nextest_profile="$NEXTEST_PROFILE"
if [[ -z "${RD_OWNER_POSTGRES_FEATURES:-}" ]]; then
  echo "ERROR: RD_OWNER_POSTGRES_FEATURES must select the shared workspace feature union." >&2
  exit 1
fi
readonly rd_owner_postgres_features="$RD_OWNER_POSTGRES_FEATURES"
case ",${rd_owner_postgres_features}," in
  *",${nextest_archive_features},"*) ;;
  *)
    echo "ERROR: R&D Owner PostgreSQL feature union must admit sealed Develop Composer acceptance." >&2
    exit 1
    ;;
esac

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "ERROR: isolated R&D Owner PostgreSQL tests require Linux." >&2
  exit 1
fi
if ! command -v docker > /dev/null 2>&1; then
  echo "ERROR: Docker is required for isolated R&D Owner PostgreSQL tests." >&2
  exit 1
fi
if ! command -v timeout > /dev/null 2>&1; then
  echo "ERROR: timeout is required for isolated R&D Owner PostgreSQL tests." >&2
  exit 1
fi

readonly postgres_image="public.ecr.aws/docker/library/postgres:16.4-alpine@sha256:5660c2cbfea50c7a9127d17dc4e48543eedd3d7a41a595a2dfa572471e37e64c"
suffix="$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')-$$"
readonly suffix
readonly container="vibe-rd-owner-test-${suffix}"
readonly volume="vibe-rd-owner-test-${suffix}"
readonly test_database="vibe_test_${suffix//-/_}"
readonly impersonator_container="vibe-rd-owner-impersonator-${suffix}"
readonly impersonator_volume="vibe-rd-owner-impersonator-${suffix}"
readonly impersonator_database="vibe_impersonator_${suffix//-/_}"
test_password="$(od -An -N24 -tx1 /dev/urandom | tr -d ' \n')"
readonly test_password
impersonator_password="$(od -An -N24 -tx1 /dev/urandom | tr -d ' \n')"
readonly impersonator_password
volume_created=false
impersonator_volume_created=false
container_created=false
impersonator_container_created=false
nextest_archive_dir=''
nextest_archive_file=''

remove_docker_object_for_cleanup() {
  local object_type="$1"
  local object_name="$2"
  local max_attempts="$3"
  local attempt=1
  local -a remove_command=(docker volume rm "$object_name")
  if [[ "$object_type" == container ]]; then
    remove_command=(docker container rm --force "$object_name")
  fi

  while [[ "$attempt" -le "$max_attempts" ]]; do
    if "${remove_command[@]}" > /dev/null 2>&1; then
      return 0
    fi
    if [[ "$attempt" -lt "$max_attempts" ]]; then
      sleep 1
    fi
    attempt=$((attempt + 1))
  done
  echo "ERROR: cleanup could not remove ${object_type} ${object_name}." >&2
  return 1
}

cleanup() {
  local primary_status="$?"
  local cleanup_failed=false
  trap - EXIT
  set +e

  if [[ -n "$nextest_archive_file" ]] &&
    ! rm -f -- "$nextest_archive_file"; then
    cleanup_failed=true
  fi
  if [[ -n "$nextest_archive_dir" ]] &&
    ! rmdir -- "$nextest_archive_dir"; then
    cleanup_failed=true
  fi

  if [[ "$container_created" == true ]] &&
    ! remove_docker_object_for_cleanup container "$container" 3; then
    cleanup_failed=true
  fi
  if [[ "$impersonator_container_created" == true ]] &&
    ! remove_docker_object_for_cleanup container "$impersonator_container" 3; then
    cleanup_failed=true
  fi
  if [[ "$volume_created" == true ]] &&
    ! remove_docker_object_for_cleanup volume "$volume" 5; then
    cleanup_failed=true
  fi
  if [[ "$impersonator_volume_created" == true ]] &&
    ! remove_docker_object_for_cleanup volume "$impersonator_volume" 5; then
    cleanup_failed=true
  fi

  if [[ "$primary_status" -ne 0 ]]; then
    exit "$primary_status"
  fi
  if [[ "$cleanup_failed" == true ]]; then
    exit 1
  fi
  exit 0
}
trap cleanup EXIT

probe_tcp_endpoint() {
  local host="$1"
  local port="$2"
  python3 - "$host" "$port" << 'PY'
import socket
import sys
import time

host, port = sys.argv[1], int(sys.argv[2])
deadline = time.monotonic() + 15
while time.monotonic() < deadline:
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        break
    try:
        with socket.create_connection((host, port), timeout=min(0.25, remaining)):
            raise SystemExit(0)
    except OSError:
        pass
    time.sleep(min(0.5, max(0, deadline - time.monotonic())))
raise SystemExit(1)
PY
}

select_reachable_postgres_endpoint() {
  local object_name="$1"
  local published_port="$2"
  local endpoint_label="$3"
  local host="127.0.0.1"
  local port="$published_port"

  if [[ -f /.dockerenv ]]; then
    if ! host="$(docker inspect --format '{{with index .NetworkSettings.Networks "bridge"}}{{.IPAddress}}{{end}}' "$object_name")" ||
      [[ -z "$host" ]]; then
      echo "ERROR: could not resolve ${endpoint_label} PostgreSQL sibling-container endpoint." >&2
      return 1
    fi
    port=5432
  fi

  if ! probe_tcp_endpoint "$host" "$port"; then
    echo "ERROR: ${endpoint_label} PostgreSQL endpoint is unreachable from the caller after 15 seconds." >&2
    return 1
  fi
  printf '%s %s\n' "$host" "$port"
}

if ! docker image inspect "$postgres_image" > /dev/null 2>&1; then
  bash scripts/ci/docker-pull-retry.sh "$postgres_image" 3
fi
docker volume create "$volume" > /dev/null
volume_created=true
docker volume create "$impersonator_volume" > /dev/null
impersonator_volume_created=true
docker run \
  --detach \
  --name "$container" \
  --publish 127.0.0.1::5432 \
  --mount "type=volume,source=${volume},target=/var/lib/postgresql/data" \
  --env POSTGRES_USER=postgres \
  --env "POSTGRES_PASSWORD=${test_password}" \
  --env POSTGRES_DB=postgres \
  "$postgres_image" > /dev/null
container_created=true
docker run \
  --detach \
  --name "$impersonator_container" \
  --publish 127.0.0.1::5432 \
  --mount "type=volume,source=${impersonator_volume},target=/var/lib/postgresql/data" \
  --env POSTGRES_USER=postgres \
  --env "POSTGRES_PASSWORD=${impersonator_password}" \
  --env "POSTGRES_DB=${impersonator_database}" \
  "$postgres_image" > /dev/null
impersonator_container_created=true

attempt=1
until docker exec "$container" pg_isready --username postgres --dbname postgres > /dev/null 2>&1; do
  if [[ "$attempt" -ge 30 ]]; then
    echo "ERROR: isolated PostgreSQL did not become ready." >&2
    exit 1
  fi
  attempt=$((attempt + 1))
  sleep 1
done

attempt=1
until timeout 3 docker exec "$impersonator_container" psql --quiet --username postgres \
  --dbname "$impersonator_database" --command 'SELECT 1' > /dev/null 2>&1; do
  if [[ "$attempt" -ge 30 ]]; then
    echo "ERROR: impersonating PostgreSQL did not become ready." >&2
    exit 1
  fi
  attempt=$((attempt + 1))
  sleep 1
done

docker exec --interactive "$impersonator_container" psql --quiet --set ON_ERROR_STOP=1 \
  --username postgres --dbname "$impersonator_database" \
  --set=impersonator_database="$impersonator_database" \
  --set=impersonator_password="$impersonator_password" << 'SQL'
CREATE ROLE rd_owner NOLOGIN;
CREATE ROLE backtest_owner LOGIN PASSWORD :'impersonator_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
REVOKE CONNECT ON DATABASE :"impersonator_database" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"impersonator_database" TO backtest_owner;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
CREATE SCHEMA rd_owner_api AUTHORIZATION rd_owner;
REVOKE ALL ON SCHEMA rd_owner_api FROM PUBLIC;
GRANT USAGE ON SCHEMA rd_owner_api TO backtest_owner;
CREATE FUNCTION rd_owner_api.lock_exploratory_replay_request_v1(text,text,text)
RETURNS jsonb
LANGUAGE plpgsql STRICT VOLATILE PARALLEL UNSAFE SECURITY DEFINER
SET search_path=pg_catalog
AS $function$
DECLARE encoded text;
BEGIN
  encoded := pg_catalog.current_setting('vibe.fake_envelope_base64', true);
  IF encoded IS NULL OR encoded = '' THEN
    RETURN pg_catalog.jsonb_build_object('schema_version',1,'availability','STALE');
  END IF;
  RETURN pg_catalog.convert_from(pg_catalog.decode(encoded,'base64'),'UTF8')::pg_catalog.jsonb;
END
$function$;
ALTER FUNCTION rd_owner_api.lock_exploratory_replay_request_v1(text,text,text) OWNER TO rd_owner;
REVOKE ALL ON FUNCTION rd_owner_api.lock_exploratory_replay_request_v1(text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rd_owner_api.lock_exploratory_replay_request_v1(text,text,text) TO backtest_owner;
CREATE FUNCTION rd_owner_api.lock_exploratory_replay_request_v2(text,text,text,text)
RETURNS jsonb
LANGUAGE plpgsql STRICT VOLATILE PARALLEL UNSAFE SECURITY DEFINER
SET search_path=pg_catalog
AS $function$
DECLARE encoded text;
BEGIN
  encoded := pg_catalog.current_setting('vibe.fake_envelope_base64', true);
  IF encoded IS NULL OR encoded = '' THEN
    RETURN pg_catalog.jsonb_build_object('schema_version',2,'availability','STALE');
  END IF;
  RETURN pg_catalog.convert_from(pg_catalog.decode(encoded,'base64'),'UTF8')::pg_catalog.jsonb;
END
$function$;
ALTER FUNCTION rd_owner_api.lock_exploratory_replay_request_v2(text,text,text,text) OWNER TO rd_owner;
REVOKE ALL ON FUNCTION rd_owner_api.lock_exploratory_replay_request_v2(text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rd_owner_api.lock_exploratory_replay_request_v2(text,text,text,text) TO backtest_owner;
SQL

docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
  --username postgres --dbname postgres \
  --set=test_database="$test_database" \
  --set=test_password="$test_password" << 'SQL'
CREATE DATABASE :"test_database" OWNER postgres;
SQL

docker exec --interactive \
  --env POSTGRES_HOST=127.0.0.1 \
  --env "POSTGRES_DATABASE=${test_database}" \
  --env "POSTGRES_PASSWORD=${test_password}" \
  --env "RD_OWNER_DB_PASSWORD=${test_password}" \
  --env "OPERATOR_AUTHORIZATION_DB_PASSWORD=${test_password}" \
  --env "QUALIFICATION_OWNER_DB_PASSWORD=${test_password}" \
  --env "PRODUCT_EDGE_DB_PASSWORD=${test_password}" \
  --env "BACKTEST_OWNER_DB_PASSWORD=${test_password}" \
  "$container" sh -s < product/rd-workbench/postgres-init/10-migrate-authority-custody.sh

readonly test_marker="rd-owner-isolated-${suffix}"
docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
  --username postgres --dbname "$test_database" \
  --set=test_database="$test_database" \
  --set=test_marker="$test_marker" << 'SQL'
CREATE SCHEMA IF NOT EXISTS vibe_test_admin AUTHORIZATION postgres;
CREATE TABLE IF NOT EXISTS vibe_test_admin.dedicated_postgres_test_instance_v1 (
  marker_identity text NOT NULL,
  database_name text NOT NULL,
  test_role text PRIMARY KEY
);
ALTER TABLE vibe_test_admin.dedicated_postgres_test_instance_v1 OWNER TO postgres;
REVOKE ALL ON SCHEMA vibe_test_admin FROM PUBLIC;
REVOKE ALL ON TABLE vibe_test_admin.dedicated_postgres_test_instance_v1 FROM PUBLIC;
GRANT USAGE ON SCHEMA vibe_test_admin TO operator_authorization_writer, product_edge_owner, rd_owner, qualification_writer, backtest_owner;
GRANT SELECT ON TABLE vibe_test_admin.dedicated_postgres_test_instance_v1 TO operator_authorization_writer, product_edge_owner, rd_owner, qualification_writer, backtest_owner;
INSERT INTO vibe_test_admin.dedicated_postgres_test_instance_v1(marker_identity, database_name, test_role)
SELECT :'test_marker', :'test_database', role_name
FROM unnest(ARRAY[
  'operator_authorization_writer',
  'product_edge_owner',
  'rd_owner',
  'qualification_writer',
  'backtest_owner'
]) AS role_name
ON CONFLICT (test_role) DO UPDATE
SET marker_identity=EXCLUDED.marker_identity, database_name=EXCLUDED.database_name;
SQL

docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
  --username postgres --dbname "$test_database" << 'SQL'
CREATE TABLE public.rd_exploratory_replay_requests_v1 (
  replay_request_identity text PRIMARY KEY,
  run_attempt_identity text NOT NULL UNIQUE,
  semantic_digest text NOT NULL,
  request_json jsonb NOT NULL,
  receipt_json jsonb NOT NULL,
  handoff_json jsonb,
  committed_at_epoch_ms bigint NOT NULL,
  research_view_json jsonb,
  request_schema_version smallint NOT NULL,
  v2_canonical_request_bytes bytea,
  v2_meaning_digest text,
  v2_seal_digest text,
  v2_receipt_json jsonb
);
ALTER TABLE public.rd_exploratory_replay_requests_v1 OWNER TO rd_owner;
COMMENT ON TABLE public.rd_exploratory_replay_requests_v1 IS 'legacy Replay sentinel v1';
INSERT INTO public.rd_exploratory_replay_requests_v1 (
  replay_request_identity,
  run_attempt_identity,
  semantic_digest,
  request_json,
  receipt_json,
  handoff_json,
  committed_at_epoch_ms,
  research_view_json,
  request_schema_version,
  v2_canonical_request_bytes,
  v2_meaning_digest,
  v2_seal_digest,
  v2_receipt_json
)
SELECT
  'legacy-replay-' || ordinal::text,
  'legacy-attempt-' || ordinal::text,
  'sha256:legacy-' || ordinal::text,
  pg_catalog.jsonb_build_object('ordinal',ordinal,'kind','legacy-request'),
  pg_catalog.jsonb_build_object('ordinal',ordinal,'kind','legacy-receipt'),
  pg_catalog.jsonb_build_object('ordinal',ordinal,'kind','legacy-handoff'),
  ordinal,
  pg_catalog.jsonb_build_object('ordinal',ordinal,'kind','legacy-research-view'),
  2,
  pg_catalog.decode(pg_catalog.lpad(pg_catalog.to_hex(ordinal),2,'0'),'hex'),
  'sha256:legacy-meaning-' || ordinal::text,
  'sha256:legacy-seal-' || ordinal::text,
  pg_catalog.jsonb_build_object('ordinal',ordinal,'kind','legacy-v2-receipt')
FROM pg_catalog.generate_series(0,25) ordinal;
SQL

port_mapping="$(docker port "$container" 5432/tcp)"
postgres_port="${port_mapping##*:}"
case "$postgres_port" in
  '' | *[!0-9]*)
    echo "ERROR: could not determine isolated PostgreSQL port." >&2
    exit 1
    ;;
esac
readonly published_postgres_port="$postgres_port"

impersonator_port_mapping="$(docker port "$impersonator_container" 5432/tcp)"
impersonator_port="${impersonator_port_mapping##*:}"
case "$impersonator_port" in
  '' | *[!0-9]*)
    echo "ERROR: could not determine impersonating PostgreSQL port." >&2
    exit 1
    ;;
esac

postgres_endpoint="$(
  select_reachable_postgres_endpoint "$container" "$postgres_port" "isolated"
)"
read -r postgres_host postgres_port <<< "$postgres_endpoint"
if [[ -f /.dockerenv ]]; then
  postgres_alias_host="host.docker.internal"
  postgres_alias_port="$published_postgres_port"
else
  postgres_alias_host="localhost"
  postgres_alias_port="$published_postgres_port"
fi
readonly postgres_alias_host postgres_alias_port
if [[ "$postgres_alias_host" == "$postgres_host" && "$postgres_alias_port" == "$postgres_port" ]]; then
  echo "ERROR: isolated PostgreSQL alias endpoint is not distinct." >&2
  exit 1
fi
if ! probe_tcp_endpoint "$postgres_alias_host" "$postgres_alias_port"; then
  echo "ERROR: isolated PostgreSQL alias endpoint is unreachable from the caller after 15 seconds." >&2
  exit 1
fi
impersonator_endpoint="$(
  select_reachable_postgres_endpoint \
    "$impersonator_container" "$impersonator_port" "impersonating"
)"
read -r impersonator_host impersonator_port <<< "$impersonator_endpoint"

export RD_OWNER_FRESH_TEST_DATABASE_URL="postgresql://rd_owner:${test_password}@${postgres_host}:${postgres_port}/${test_database}"
export QUALIFICATION_WRITER_FRESH_TEST_DATABASE_URL="postgresql://qualification_writer:${test_password}@${postgres_host}:${postgres_port}/${test_database}"
export OPERATOR_AUTHORIZATION_TEST_DATABASE_URL="postgresql://operator_authorization_writer:${test_password}@${postgres_host}:${postgres_port}/${test_database}"
export PRODUCT_EDGE_TEST_DATABASE_URL="postgresql://product_edge_owner:${test_password}@${postgres_host}:${postgres_port}/${test_database}"
export RD_OWNER_TEST_DATABASE_URL="postgresql://rd_owner:${test_password}@${postgres_host}:${postgres_port}/${test_database}"
export RD_OWNER_DRAIN_ALIAS_TEST_DATABASE_URL="postgresql://rd_owner:${test_password}@${postgres_alias_host}:${postgres_alias_port}/${test_database}"
export QUALIFICATION_TEST_DATABASE_URL="postgresql://qualification_writer:${test_password}@${postgres_host}:${postgres_port}/${test_database}"
export BACKTEST_TEST_DATABASE_URL="postgresql://backtest_owner:${test_password}@${postgres_host}:${postgres_port}/${test_database}"
export BACKTEST_IMPERSONATOR_TEST_DATABASE_URL="postgresql://backtest_owner:${impersonator_password}@${impersonator_host}:${impersonator_port}/${impersonator_database}"
export VIBE_POSTGRES_TEST_DATABASE_NAME="$test_database"
export VIBE_POSTGRES_TEST_INSTANCE_MARKER="$test_marker"

nextest_temp_root="${RUNNER_TEMP:-${TMPDIR:-/tmp}}"
if [[ ! -d "$nextest_temp_root" ]]; then
  echo "ERROR: nextest archive parent does not exist: ${nextest_temp_root}" >&2
  exit 1
fi
nextest_archive_dir="$(mktemp -d "${nextest_temp_root%/}/vibe-rd-owner-nextest.XXXXXXXX")"
nextest_archive_file="${nextest_archive_dir}/rd-owner-tests.tar.zst"
cargo nextest archive \
  "${nextest_graph_args[@]}" \
  --features "$nextest_archive_features" \
  --profile "$nextest_profile" \
  --cargo-profile "$cargo_ci_profile" \
  --archive-file "$nextest_archive_file"

# The first filter makes the first application connection to the fresh
# database. Filters 8 and 9 deliberately poison Owner state and therefore stay
# after every positive consumer, with the Research mismatch absolute last.
for test_selection in "${rd_owner_postgres_tests[@]}"; do
  IFS='|' read -r test_package test_binary test_name <<< "$test_selection"
  cargo nextest run \
    --archive-file "$nextest_archive_file" \
    --profile "$nextest_profile" \
    "${nextest_execution_args[@]}" \
    -E "package(${test_package}) & binary(${test_binary}) & test(=${test_name})"
done

docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
  --username postgres --dbname "$test_database" << 'SQL'
DO $acl$
DECLARE
  unexpected_source_table text;
  forbidden_role_source text;
  forbidden_privilege text;
  privilege_name text;
  role_name text;
  qualification_table text;
BEGIN
  IF EXISTS (
       SELECT 1
       FROM pg_catalog.pg_database database_entry
       CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(
         database_entry.datacl,
         pg_catalog.acldefault('d', database_entry.datdba)
       )) database_acl
       WHERE database_entry.datname = pg_catalog.current_database()
         AND database_acl.grantee = 0
         AND database_acl.privilege_type = 'CONNECT'
     )
     OR NOT pg_catalog.has_database_privilege('rd_owner', pg_catalog.current_database(), 'CONNECT')
     OR NOT pg_catalog.has_database_privilege('operator_authorization_writer', pg_catalog.current_database(), 'CONNECT')
     OR NOT pg_catalog.has_database_privilege('qualification_writer', pg_catalog.current_database(), 'CONNECT')
     OR NOT pg_catalog.has_database_privilege('product_edge_owner', pg_catalog.current_database(), 'CONNECT')
     OR NOT pg_catalog.has_database_privilege('backtest_owner', pg_catalog.current_database(), 'CONNECT')
     OR pg_catalog.has_database_privilege('qualification_owner', pg_catalog.current_database(), 'CONNECT')
     OR pg_catalog.has_database_privilege('operator_authorization_owner', pg_catalog.current_database(), 'CONNECT')
     OR (SELECT rolcanlogin FROM pg_catalog.pg_roles WHERE rolname = 'qualification_owner')
     OR pg_catalog.pg_has_role('qualification_writer', 'qualification_owner', 'MEMBER')
     OR pg_catalog.pg_has_role('rd_owner', 'qualification_owner', 'MEMBER')
     OR pg_catalog.has_schema_privilege('qualification_writer', 'public', 'CREATE')
     OR (SELECT rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls
         FROM pg_catalog.pg_roles WHERE rolname = 'qualification_writer')
     OR pg_catalog.pg_has_role('qualification_writer', 'rd_owner', 'MEMBER')
     OR pg_catalog.pg_has_role('qualification_writer', 'product_edge_owner', 'MEMBER')
     OR pg_catalog.pg_has_role('qualification_writer', 'operator_authorization_owner', 'MEMBER')
     OR pg_catalog.has_schema_privilege('qualification_writer', 'rd_owner_api', 'CREATE')
     OR (SELECT rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls
         FROM pg_catalog.pg_roles WHERE rolname = 'backtest_owner')
     OR pg_catalog.pg_has_role('backtest_owner', 'rd_owner', 'MEMBER')
     OR pg_catalog.pg_has_role('backtest_owner', 'product_edge_owner', 'MEMBER')
     OR pg_catalog.pg_has_role('backtest_owner', 'qualification_owner', 'MEMBER')
     OR pg_catalog.pg_has_role('backtest_owner', 'operator_authorization_owner', 'MEMBER')
     OR pg_catalog.has_schema_privilege('backtest_owner', 'public', 'CREATE')
     OR pg_catalog.has_schema_privilege('backtest_owner', 'rd_owner_api', 'CREATE')
  THEN
    RAISE EXCEPTION 'Qualification owner/writer physical roles or database CONNECT custody are not separated';
  END IF;

  IF NOT pg_catalog.has_function_privilege(
    'rd_owner',
    'qualification_api.lock_projection_for_basis_v1(text,text,text,text,jsonb,text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'rd_owner lacks the sealed Qualification admission API';
  END IF;

  IF NOT pg_catalog.has_schema_privilege('qualification_writer', 'rd_owner_api', 'USAGE')
     OR NOT pg_catalog.has_function_privilege(
       'qualification_writer',
       'rd_owner_api.lock_independence_basis_for_qualification_v1(text,text,text,jsonb)',
       'EXECUTE'
     )
  THEN
    RAISE EXCEPTION 'qualification_writer lacks the sealed R&D basis API';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc procedure
    JOIN pg_catalog.pg_namespace namespace ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'rd_owner_api'
      AND procedure.oid <> pg_catalog.to_regprocedure(
        'rd_owner_api.lock_independence_basis_for_qualification_v1(text,text,text,jsonb)'
      )
      AND pg_catalog.has_function_privilege('qualification_writer', procedure.oid, 'EXECUTE')
  ) THEN
    RAISE EXCEPTION 'qualification_writer can execute an unadmitted R&D Owner API';
  END IF;

  FOREACH role_name IN ARRAY ARRAY['qualification_owner', 'qualification_writer'] LOOP
    SELECT table_name INTO unexpected_source_table
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name LIKE 'rd_%'
      AND (SELECT pg_catalog.bool_or(pg_catalog.has_table_privilege(
        role_name,
        pg_catalog.format('public.%I', table_name),
        checked_privilege
      )) FROM pg_catalog.unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) checked_privilege)
    LIMIT 1;
    IF unexpected_source_table IS NOT NULL THEN
      RAISE EXCEPTION '% has forbidden raw R&D source privilege on %', role_name, unexpected_source_table;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc procedure
    JOIN pg_catalog.pg_roles role ON role.oid = procedure.proowner
    WHERE procedure.oid = pg_catalog.to_regprocedure(
      'rd_owner_api.lock_independence_basis_for_qualification_v1(text,text,text,jsonb)'
    )
      AND role.rolname = 'rd_owner'
      AND procedure.prosecdef
      AND procedure.proisstrict
      AND procedure.provolatile = 'v'
      AND procedure.proparallel = 'u'
      AND procedure.proconfig = ARRAY['search_path=pg_catalog']
  )
  THEN
    RAISE EXCEPTION 'sealed R&D basis API metadata mismatch';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc procedure
    JOIN pg_catalog.pg_roles role ON role.oid = procedure.proowner
    WHERE procedure.oid = pg_catalog.to_regprocedure(
      'rd_owner_api.lock_exploratory_replay_request_v1(text,text,text)'
    )
      AND role.rolname = 'rd_owner'
      AND procedure.prosecdef
      AND procedure.proisstrict
      AND procedure.provolatile = 'v'
      AND procedure.proparallel = 'u'
      AND procedure.proconfig = ARRAY['search_path=pg_catalog']
  )
     OR NOT pg_catalog.has_schema_privilege('backtest_owner', 'rd_owner_api', 'USAGE')
     OR NOT pg_catalog.has_function_privilege(
       'backtest_owner',
       'rd_owner_api.lock_exploratory_replay_request_v1(text,text,text)',
       'EXECUTE'
     )
  THEN
    RAISE EXCEPTION 'sealed exploratory replay Backtest API metadata or ACL mismatch';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc procedure
    JOIN pg_catalog.pg_roles role ON role.oid = procedure.proowner
    WHERE procedure.oid = pg_catalog.to_regprocedure(
      'rd_owner_api.lock_exploratory_replay_request_v2(text,text,text,text)'
    )
      AND role.rolname = 'rd_owner'
      AND procedure.prosecdef
      AND procedure.proisstrict
      AND procedure.provolatile = 'v'
      AND procedure.proparallel = 'u'
      AND procedure.proconfig = ARRAY['search_path=pg_catalog']
  )
     OR NOT pg_catalog.has_function_privilege(
       'backtest_owner',
       'rd_owner_api.lock_exploratory_replay_request_v2(text,text,text,text)',
       'EXECUTE'
     )
  THEN
    RAISE EXCEPTION 'sealed exploratory Replay V2 Backtest API metadata or ACL mismatch';
  END IF;

  FOREACH role_name IN ARRAY ARRAY[
    'public',
    'rd_owner',
    'qualification_owner',
    'qualification_writer',
    'product_edge_owner',
    'operator_authorization_owner',
    'operator_authorization_writer'
  ] LOOP
    IF pg_catalog.has_function_privilege(
      role_name,
      'rd_owner_api.lock_exploratory_replay_request_v1(text,text,text)',
      'EXECUTE'
    ) THEN
      RAISE EXCEPTION '% can execute the sealed exploratory replay API', role_name;
    END IF;
    IF pg_catalog.has_function_privilege(
      role_name,
      'rd_owner_api.lock_exploratory_replay_request_v2(text,text,text,text)',
      'EXECUTE'
    ) THEN
      RAISE EXCEPTION '% can execute the sealed exploratory Replay V2 API', role_name;
    END IF;
  END LOOP;

  IF pg_catalog.has_table_privilege(
       'backtest_owner',
       'public.rd_exploratory_replay_request_custody_v1',
       'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
     )
     OR pg_catalog.has_table_privilege(
       'backtest_owner',
       'public.rd_owner_outbox_v1',
       'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
     )
  THEN
    RAISE EXCEPTION 'backtest_owner has forbidden raw R&D table privilege';
  END IF;

  IF pg_catalog.to_regprocedure(
    'rd_owner_api.lock_independence_basis_for_qualification_v1(text,text,text,text,jsonb)'
  ) IS NOT NULL THEN
    RAISE EXCEPTION 'obsolete R&D basis API signature remains published';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_index index_entry
    JOIN pg_catalog.pg_class index_relation ON index_relation.oid = index_entry.indexrelid
    WHERE index_relation.relname = 'rd_owner_outbox_aggregate_kind_v1'
      AND index_entry.indrelid = 'public.rd_owner_outbox_v1'::pg_catalog.regclass
      AND index_entry.indisunique
      AND index_entry.indisvalid
  ) THEN
    RAISE EXCEPTION 'R&D owner outbox aggregate/event uniqueness is unavailable';
  END IF;

  FOREACH role_name IN ARRAY ARRAY[
    'public',
    'qualification_owner',
    'product_edge_owner',
    'operator_authorization_owner',
    'operator_authorization_writer',
    'backtest_owner'
  ] LOOP
    IF pg_catalog.has_function_privilege(
      role_name,
      'rd_owner_api.lock_independence_basis_for_qualification_v1(text,text,text,jsonb)',
      'EXECUTE'
    ) THEN
      RAISE EXCEPTION '% can execute the sealed R&D basis API', role_name;
    END IF;
  END LOOP;

  FOREACH qualification_table IN ARRAY ARRAY[
    'qualification_protected_feedback_projections_v1',
    'qualification_protected_feedback_heads_v1',
    'qualification_owner_outbox_v1'
  ] LOOP
    IF (SELECT tableowner FROM pg_catalog.pg_tables WHERE schemaname = 'public' AND tablename = qualification_table) <> 'qualification_owner' THEN
      RAISE EXCEPTION 'Qualification table custody mismatch for %', qualification_table;
    END IF;
    FOREACH privilege_name IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'] LOOP
      IF NOT pg_catalog.has_table_privilege(
        'qualification_writer',
        pg_catalog.format('public.%I', qualification_table),
        privilege_name
      ) THEN
        RAISE EXCEPTION 'qualification_writer lacks % on %', privilege_name, qualification_table;
      END IF;
    END LOOP;
    FOREACH forbidden_privilege IN ARRAY ARRAY['TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
      IF pg_catalog.has_table_privilege(
        'qualification_writer',
        pg_catalog.format('public.%I', qualification_table),
        forbidden_privilege
      ) THEN
        RAISE EXCEPTION 'qualification_writer has forbidden % on %', forbidden_privilege, qualification_table;
      END IF;
    END LOOP;
  END LOOP;

  FOREACH role_name IN ARRAY ARRAY[
    'rd_owner',
    'product_edge_owner',
    'operator_authorization_owner',
    'operator_authorization_writer'
  ] LOOP
    FOREACH qualification_table IN ARRAY ARRAY[
      'qualification_protected_feedback_projections_v1',
      'qualification_protected_feedback_heads_v1',
      'qualification_owner_outbox_v1'
    ] LOOP
      FOREACH forbidden_privilege IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
        IF pg_catalog.has_table_privilege(
          role_name,
          pg_catalog.format('public.%I', qualification_table),
          forbidden_privilege
        ) THEN
          RAISE EXCEPTION '% has forbidden Qualification privilege % on %', role_name, forbidden_privilege, qualification_table;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;

  FOREACH role_name IN ARRAY ARRAY[
    'product_edge_owner',
    'operator_authorization_owner',
    'operator_authorization_writer'
  ] LOOP
    IF pg_catalog.has_table_privilege(role_name, 'public.rd_independence_bases_v1', 'SELECT')
       OR pg_catalog.has_table_privilege(role_name, 'public.rd_owner_outbox_v1', 'SELECT')
       OR pg_catalog.has_function_privilege(role_name, 'qualification_api.lock_projection_for_basis_v1(text,text,text,text,jsonb,text)', 'EXECUTE')
    THEN
      RAISE EXCEPTION '% crossed the R&D/Qualification custody boundary', role_name;
    END IF;
    forbidden_role_source := NULL;
    SELECT table_name INTO forbidden_role_source
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name LIKE 'rd_%'
      AND (
        pg_catalog.has_table_privilege(
          role_name, pg_catalog.format('public.%I', table_name), 'SELECT'
        )
        OR (SELECT pg_catalog.bool_or(pg_catalog.has_table_privilege(
          role_name,
          pg_catalog.format('public.%I', table_name),
          checked_privilege
        )) FROM pg_catalog.unnest(ARRAY['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) checked_privilege)
      )
    LIMIT 1;
    IF forbidden_role_source IS NOT NULL THEN
      RAISE EXCEPTION '% can access forbidden R&D source %', role_name, forbidden_role_source;
    END IF;
  END LOOP;

  IF (SELECT tableowner FROM pg_catalog.pg_tables WHERE schemaname = 'public' AND tablename = 'rd_independence_bases_v1') <> 'rd_owner'
     OR (SELECT tableowner FROM pg_catalog.pg_tables WHERE schemaname = 'public' AND tablename = 'rd_owner_outbox_v1') <> 'rd_owner'
     OR (SELECT tableowner FROM pg_catalog.pg_tables WHERE schemaname = 'public' AND tablename = 'rd_exploratory_replay_request_custody_v1') <> 'rd_owner'
  THEN
    RAISE EXCEPTION 'R&D canonical source ownership mismatch';
  END IF;

END
$acl$;
SQL
