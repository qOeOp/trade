#!/usr/bin/env bash

set -euo pipefail

readonly cargo_ci_profile="${CARGO_CI_PROFILE:-nextest}"

readonly guarded_paths=(
  crates/backtest_owner/src/postgres.rs
  crates/backtest_owner/tests/postgres_replay_v2.rs
)

if rg -n 'BACKTEST_TEST_DATABASE_URL or BACKTEST_DATABASE_URL|or_else\(\|\| std::env::var\("BACKTEST_DATABASE_URL"\)|ExploratoryReplayRequestLocatorV1|BACKTEST_IMPERSONATOR' "${guarded_paths[@]}"; then
  echo "ERROR: Backtest V2 storage tests contain a forbidden fallback or legacy authority." >&2
  exit 1
fi
if [[ "${1:-}" == "--check" ]]; then
  exit 0
fi
if ! command -v docker > /dev/null 2>&1; then
  echo "ERROR: Docker is required for isolated Backtest Owner PostgreSQL tests." >&2
  exit 1
fi

readonly postgres_image="public.ecr.aws/docker/library/postgres:16.4-alpine@sha256:5660c2cbfea50c7a9127d17dc4e48543eedd3d7a41a595a2dfa572471e37e64c"
suffix="$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')-$$"
readonly suffix
readonly container="vibe-backtest-owner-test-${suffix}"
readonly volume="vibe-backtest-owner-test-${suffix}"
readonly test_database="vibe_test_${suffix//-/_}"
readonly impersonator_database="vibe_impersonator_${suffix//-/_}"
test_password="$(od -An -N24 -tx1 /dev/urandom | tr -d ' \n')"
readonly test_password
readonly test_marker="backtest-owner-isolated-${suffix}"
container_created=false
volume_created=false
stage="container bootstrap"

remove_docker_object() {
  local kind="$1"
  local name="$2"
  local attempt=1
  local -a command=(docker volume rm "$name")
  if [[ "$kind" == container ]]; then
    command=(docker container rm --force "$name")
  fi
  while [[ "$attempt" -le 5 ]]; do
    if "${command[@]}" > /dev/null 2>&1; then
      return 0
    fi
    attempt=$((attempt + 1))
    sleep 1
  done
  return 1
}

cleanup() {
  local primary_status="$?"
  local cleanup_status=0
  trap - EXIT
  set +e
  if [[ "$primary_status" -ne 0 ]]; then
    echo "ERROR: Backtest PostgreSQL gate failed during ${stage}." >&2
  fi
  if [[ "$container_created" == true ]]; then
    remove_docker_object container "$container" || cleanup_status=1
  fi
  if [[ "$volume_created" == true ]]; then
    remove_docker_object volume "$volume" || cleanup_status=1
  fi
  if [[ "$primary_status" -ne 0 ]]; then
    exit "$primary_status"
  fi
  exit "$cleanup_status"
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
    try:
        with socket.create_connection((host, port), timeout=0.25):
            raise SystemExit(0)
    except OSError:
        time.sleep(0.25)
raise SystemExit(1)
PY
}

if ! docker image inspect "$postgres_image" > /dev/null 2>&1; then
  bash scripts/ci/docker-pull-retry.sh "$postgres_image" 3
fi
docker volume create "$volume" > /dev/null
volume_created=true
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

attempt=1
until docker exec "$container" pg_isready --username postgres --dbname postgres > /dev/null 2>&1; do
  if [[ "$attempt" -ge 30 ]]; then
    docker logs "$container" >&2
    echo "ERROR: isolated PostgreSQL did not become ready." >&2
    exit 1
  fi
  attempt=$((attempt + 1))
  sleep 1
done

docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
  --username postgres --dbname postgres \
  --set=test_database="$test_database" \
  --set=impersonator_database="$impersonator_database" << 'SQL'
CREATE DATABASE :"test_database" OWNER postgres;
CREATE DATABASE :"impersonator_database" OWNER postgres;
SQL

stage="authority topology migration"
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

# The current U1 integration test proves that an identically named role and callable legacy
# facade in another database cannot impersonate canonical custody. This disposable database is
# only that upstream rejection fixture; it never seeds or resolves the V2 request used below.
stage="current U1 cross-database rejection fixture"
docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
  --username postgres --dbname "$impersonator_database" << 'SQL'
REVOKE CONNECT ON DATABASE :DBNAME FROM PUBLIC;
GRANT CONNECT ON DATABASE :DBNAME TO backtest_owner;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
CREATE SCHEMA rd_owner_api AUTHORIZATION rd_owner;
REVOKE ALL ON SCHEMA rd_owner_api FROM PUBLIC;
GRANT USAGE ON SCHEMA rd_owner_api TO backtest_owner;
CREATE FUNCTION rd_owner_api.lock_exploratory_replay_request_v1(text,text,text)
RETURNS jsonb LANGUAGE plpgsql STRICT VOLATILE PARALLEL UNSAFE SECURITY DEFINER
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
SQL

stage="disposable marker admission"
docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
  --username postgres --dbname "$test_database" \
  --set=test_database="$test_database" \
  --set=test_marker="$test_marker" << 'SQL'
CREATE SCHEMA vibe_test_admin AUTHORIZATION postgres;
CREATE TABLE vibe_test_admin.dedicated_postgres_test_instance_v1 (
  marker_identity text NOT NULL,
  database_name text NOT NULL,
  test_role text PRIMARY KEY
);
REVOKE ALL ON SCHEMA vibe_test_admin FROM PUBLIC;
REVOKE ALL ON TABLE vibe_test_admin.dedicated_postgres_test_instance_v1 FROM PUBLIC;
GRANT USAGE ON SCHEMA vibe_test_admin TO operator_authorization_writer, product_edge_owner, rd_owner, qualification_writer, backtest_owner;
GRANT SELECT ON TABLE vibe_test_admin.dedicated_postgres_test_instance_v1 TO operator_authorization_writer, product_edge_owner, rd_owner, qualification_writer, backtest_owner;
INSERT INTO vibe_test_admin.dedicated_postgres_test_instance_v1(marker_identity,database_name,test_role)
SELECT :'test_marker', :'test_database', role_name
FROM unnest(ARRAY[
  'operator_authorization_writer',
  'product_edge_owner',
  'rd_owner',
  'qualification_writer',
  'backtest_owner'
]) AS role_name;
SQL

port_mapping="$(docker port "$container" 5432/tcp)"
postgres_port="${port_mapping##*:}"
case "$postgres_port" in
  '' | *[!0-9]*)
    echo "ERROR: could not determine isolated PostgreSQL port." >&2
    exit 1
    ;;
esac
postgres_host="127.0.0.1"
if [[ -f /.dockerenv ]]; then
  postgres_host="$(docker inspect --format '{{with index .NetworkSettings.Networks "bridge"}}{{.IPAddress}}{{end}}' "$container")"
  postgres_port=5432
fi
if [[ -z "$postgres_host" ]] || ! probe_tcp_endpoint "$postgres_host" "$postgres_port"; then
  echo "ERROR: isolated PostgreSQL endpoint is unreachable." >&2
  exit 1
fi

export OPERATOR_AUTHORIZATION_TEST_DATABASE_URL="postgresql://operator_authorization_writer:${test_password}@${postgres_host}:${postgres_port}/${test_database}"
export PRODUCT_EDGE_TEST_DATABASE_URL="postgresql://product_edge_owner:${test_password}@${postgres_host}:${postgres_port}/${test_database}"
export RD_OWNER_TEST_DATABASE_URL="postgresql://rd_owner:${test_password}@${postgres_host}:${postgres_port}/${test_database}"
export QUALIFICATION_TEST_DATABASE_URL="postgresql://qualification_writer:${test_password}@${postgres_host}:${postgres_port}/${test_database}"
export BACKTEST_TEST_DATABASE_URL="postgresql://backtest_owner:${test_password}@${postgres_host}:${postgres_port}/${test_database}"
export BACKTEST_IMPERSONATOR_TEST_DATABASE_URL="postgresql://backtest_owner:${test_password}@${postgres_host}:${postgres_port}/${impersonator_database}"
export RD_OWNER_FRESH_TEST_DATABASE_URL="$RD_OWNER_TEST_DATABASE_URL"
export QUALIFICATION_WRITER_FRESH_TEST_DATABASE_URL="$QUALIFICATION_TEST_DATABASE_URL"
export VIBE_POSTGRES_TEST_DATABASE_NAME="$test_database"
export VIBE_POSTGRES_TEST_INSTANCE_MARKER="$test_marker"

stage="Backtest malformed existing schema rejection"
docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
  --username postgres --dbname "$test_database" << 'SQL'
GRANT CREATE ON SCHEMA public TO backtest_owner;
SET ROLE backtest_owner;
CREATE TABLE public.backtest_replay_runs_v2 (
  request_identity TEXT NOT NULL,
  request_meaning_digest TEXT NOT NULL,
  request_seal_digest TEXT NOT NULL,
  rd_receipt_identity TEXT NOT NULL,
  request_binding_blake3 TEXT NOT NULL,
  request_canonical_bytes BYTEA NOT NULL,
  request_canonical_bytes_blake3 TEXT NOT NULL,
  attempt_identity TEXT NOT NULL,
  result_identity TEXT PRIMARY KEY,
  result_digest TEXT NOT NULL,
  terminal TEXT NOT NULL,
  UNIQUE(request_identity,attempt_identity)
);
CREATE TABLE public.backtest_replay_results_v2 (
  result_identity TEXT PRIMARY KEY REFERENCES public.backtest_replay_runs_v2(result_identity),
  result_digest TEXT NOT NULL,
  request_identity TEXT NOT NULL,
  request_meaning_digest TEXT NOT NULL,
  attempt_identity TEXT NOT NULL,
  terminal TEXT NOT NULL,
  canonical_bytes BYTEA NOT NULL,
  canonical_bytes_blake3 TEXT NOT NULL
);
CREATE INDEX undeclared_backtest_request_digest_v2
ON public.backtest_replay_runs_v2(request_meaning_digest);
RESET ROLE;
SQL
cargo test --locked --profile "$cargo_ci_profile" --package vibe-backtest-owner --lib \
  postgres::durable_postgres_replay_v2::bootstrap_rejects_malformed_existing_storage_schema \
  -- --ignored --exact
docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
  --username postgres --dbname "$test_database" \
  --command "DROP TABLE public.backtest_replay_results_v2,public.backtest_replay_runs_v2" \
  --command "REVOKE CREATE ON SCHEMA public FROM backtest_owner"

# Deployment bootstrap owns DDL. The grant exists only for this isolated migration call.
stage="one-shot Backtest storage bootstrap"
docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
  --username postgres --dbname "$test_database" \
  --command "GRANT CREATE ON SCHEMA public TO backtest_owner"
cargo test --locked --profile "$cargo_ci_profile" --package vibe-backtest-owner --lib \
  postgres::durable_postgres_replay_v2::canonical_backtest_role_materializes_owned_storage_once \
  -- --ignored --exact
docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
  --username postgres --dbname "$test_database" \
  --command "REVOKE CREATE ON SCHEMA public FROM backtest_owner"

docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
  --username postgres --dbname "$test_database" << 'SQL'
CREATE FUNCTION vibe_test_admin.set_backtest_external_inbound_fk_v2(enabled boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog
AS $function$
BEGIN
  IF enabled THEN
    CREATE TABLE public.backtest_external_inbound_fk_v2 (
      result_identity TEXT REFERENCES public.backtest_replay_runs_v2(result_identity)
    );
  ELSE
    DROP TABLE IF EXISTS public.backtest_external_inbound_fk_v2;
  END IF;
END
$function$;
REVOKE ALL ON FUNCTION vibe_test_admin.set_backtest_external_inbound_fk_v2(boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vibe_test_admin.set_backtest_external_inbound_fk_v2(boolean) TO backtest_owner;
SQL

stage="Backtest preexisting external inbound FK rejection"
docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
  --username postgres --dbname "$test_database" \
  --command "SELECT vibe_test_admin.set_backtest_external_inbound_fk_v2(true)" \
  --command "GRANT CREATE ON SCHEMA public TO backtest_owner"
cargo test --locked --profile "$cargo_ci_profile" --package vibe-backtest-owner --lib \
  postgres::durable_postgres_replay_v2::bootstrap_rejects_preexisting_external_inbound_fk \
  -- --ignored --exact
docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
  --username postgres --dbname "$test_database" \
  --command "SELECT vibe_test_admin.set_backtest_external_inbound_fk_v2(false)" \
  --command "REVOKE CREATE ON SCHEMA public FROM backtest_owner"

oracle_failed=false

stage="Backtest bootstrap named-role ACL cleanup"
docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
  --username postgres --dbname "$test_database" \
  --command "GRANT SELECT ON public.backtest_replay_runs_v2,public.backtest_replay_results_v2 TO rd_owner" \
  --command "GRANT CREATE ON SCHEMA public TO backtest_owner"
cargo test --locked --profile "$cargo_ci_profile" --package vibe-backtest-owner --lib \
  postgres::durable_postgres_replay_v2::canonical_backtest_role_materializes_owned_storage_once \
  -- --ignored --exact
docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
  --username postgres --dbname "$test_database" \
  --command "REVOKE CREATE ON SCHEMA public FROM backtest_owner"
if ! cargo test --locked --profile "$cargo_ci_profile" --package vibe-backtest-owner --lib \
  postgres::durable_postgres_replay_v2::bootstrap_clears_poisoned_named_role_acl \
  -- --ignored --exact; then
  oracle_failed=true
fi

stage="Backtest runtime named-role ACL rejection"
docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
  --username postgres --dbname "$test_database" \
  --command "GRANT SELECT ON public.backtest_replay_runs_v2 TO rd_owner"
if ! cargo test --locked --profile "$cargo_ci_profile" --package vibe-backtest-owner --lib \
  postgres::durable_postgres_replay_v2::runtime_connect_rejects_post_bootstrap_named_role_acl \
  -- --ignored --exact; then
  oracle_failed=true
fi
docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
  --username postgres --dbname "$test_database" \
  --command "REVOKE ALL ON public.backtest_replay_runs_v2,public.backtest_replay_results_v2 FROM rd_owner"

stage="Backtest existing-handle ACL revalidation"
if ! cargo test --locked --profile "$cargo_ci_profile" --package vibe-backtest-owner --lib \
  postgres::durable_postgres_replay_v2::existing_handle_rejects_post_connect_named_role_acl \
  -- --ignored --exact; then
  oracle_failed=true
fi

stage="Backtest existing-handle exact-schema revalidation"
docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
  --username postgres --dbname "$test_database" << 'SQL'
CREATE FUNCTION vibe_test_admin.noop_backtest_trigger_v2()
RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog
AS $function$
BEGIN
  RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION vibe_test_admin.noop_backtest_trigger_v2() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vibe_test_admin.noop_backtest_trigger_v2() TO backtest_owner;
SQL
if ! cargo test --locked --profile "$cargo_ci_profile" --package vibe-backtest-owner --lib \
  postgres::durable_postgres_replay_v2::existing_handle_rejects_post_connect_storage_trigger \
  -- --ignored --exact; then
  oracle_failed=true
fi
docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
  --username postgres --dbname "$test_database" \
  --command "DROP TRIGGER IF EXISTS aaa_test_undeclared_backtest_trigger ON public.backtest_replay_runs_v2" \
  --command "DROP FUNCTION vibe_test_admin.noop_backtest_trigger_v2()"

stage="Backtest concurrent ACCESS SHARE admission"
if ! cargo test --locked --profile "$cargo_ci_profile" --package vibe-backtest-owner --lib \
  postgres::durable_postgres_replay_v2::runtime_allows_concurrent_access_share_reader \
  -- --ignored --exact; then
  oracle_failed=true
fi

stage="Backtest SET-only role impersonation rejection"
docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
  --username postgres --dbname "$test_database" \
  --command "GRANT backtest_owner TO product_edge_owner WITH INHERIT FALSE, SET TRUE"
if ! cargo test --locked --profile "$cargo_ci_profile" --package vibe-backtest-owner --lib \
  postgres::durable_postgres_replay_v2::runtime_rejects_set_only_role_impersonation \
  -- --ignored --exact; then
  oracle_failed=true
fi
docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
  --username postgres --dbname "$test_database" \
  --command "REVOKE backtest_owner FROM product_edge_owner"

# Seed through the repository's real U1 V2 Owner path. No request meaning is synthesized here.
stage="native R&D schema consumers"
cargo test --locked --profile "$cargo_ci_profile" --package vibe-strategy-factory --lib \
  product_edge_postgres::tests::fresh_rd_owner_migrates_before_qualification_writer_validates \
  -- --ignored --exact
cargo test --locked --profile "$cargo_ci_profile" --package vibe-strategy-factory \
  --test source_intake \
  postgres_source_invocation_lifecycle_is_canonical_once_only_and_acl_sealed \
  -- --ignored --exact
cargo test --locked --profile "$cargo_ci_profile" --package vibe-strategy-factory-rd-owner-api \
  --bin strategy-factory-rd-owner-api \
  tests::same_identity_started_retry_returns_http_ok_with_exact_custody_once \
  -- --ignored --exact
cargo test --locked --profile "$cargo_ci_profile" --package vibe-product-edge --lib \
  postgres::tests::genesis_admission_claim_cutover_and_revocation_are_canonical \
  -- --ignored --exact

stage="real sealed R&D V2 request seed"
cargo test --locked --profile "$cargo_ci_profile" --package vibe-strategy-factory \
  --test exploratory_replay_request_owner \
  frozen_exploratory_replay_request_is_sealed_for_canonical_backtest_owner \
  -- --ignored --exact

stage="Backtest bounded conflicting-lock rejection"
if ! cargo test --locked --profile "$cargo_ci_profile" --package vibe-backtest-owner --lib \
  postgres::durable_postgres_replay_v2::runtime_lock_conflict_fails_closed_near_one_second \
  -- --ignored --exact; then
  oracle_failed=true
fi

stage="Backtest post-connect external inbound FK rejection"
if ! cargo test --locked --profile "$cargo_ci_profile" --package vibe-backtest-owner --lib \
  postgres::durable_postgres_replay_v2::existing_handle_rejects_post_connect_external_inbound_fk \
  -- --ignored --exact; then
  oracle_failed=true
fi
docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
  --username postgres --dbname "$test_database" \
  --command "DROP TABLE IF EXISTS public.backtest_external_inbound_fk_v2" \
  --command "DROP FUNCTION vibe_test_admin.set_backtest_external_inbound_fk_v2(boolean)"

stage="R&D transaction SET-only role impersonation rejection"
docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
  --username postgres --dbname "$test_database" \
  --command "GRANT backtest_owner TO product_edge_owner WITH INHERIT FALSE, SET TRUE"
if ! cargo test --locked --profile "$cargo_ci_profile" --package vibe-strategy-factory \
  --test exploratory_replay_request_owner \
  caller_transaction_rejects_set_only_backtest_role_impersonation \
  -- --ignored --exact; then
  oracle_failed=true
fi
docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
  --username postgres --dbname "$test_database" \
  --command "REVOKE backtest_owner FROM product_edge_owner"

stage="Backtest Replay V2 controlled revocation-before-insert oracle"
docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
  --username postgres --dbname "$test_database" << 'SQL'
CREATE FUNCTION vibe_test_admin.revoke_replay_request_before_backtest_persist_v2(p_request_identity text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog
AS $function$
BEGIN
  UPDATE public.rd_exploratory_replay_requests_v1
  SET lifecycle_state='REVOKED'
  WHERE request_identity=p_request_identity;
END
$function$;
REVOKE ALL ON FUNCTION vibe_test_admin.revoke_replay_request_before_backtest_persist_v2(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vibe_test_admin.revoke_replay_request_before_backtest_persist_v2(text) TO backtest_owner;
SQL
if ! cargo test --locked --profile "$cargo_ci_profile" --package vibe-backtest-owner --lib \
  postgres::durable_postgres_replay_v2::revocation_between_validation_and_insert_writes_nothing \
  -- --ignored --exact; then
  oracle_failed=true
fi
docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
  --username postgres --dbname "$test_database" << 'SQL'
DROP FUNCTION vibe_test_admin.revoke_replay_request_before_backtest_persist_v2(text);
SQL

stage="Backtest Replay V2 durable binding tamper oracles"
if ! cargo test --locked --profile "$cargo_ci_profile" --package vibe-backtest-owner --lib \
  postgres::durable_postgres_replay_v2::tampered_request_seal_digest_fails_closed_after_restart \
  -- --ignored --exact; then
  oracle_failed=true
fi
docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
  --username postgres --dbname "$test_database" \
  --command "TRUNCATE public.backtest_replay_results_v2,public.backtest_replay_runs_v2"
if ! cargo test --locked --profile "$cargo_ci_profile" --package vibe-backtest-owner --lib \
  postgres::durable_postgres_replay_v2::tampered_rd_receipt_identity_fails_closed_after_restart \
  -- --ignored --exact; then
  oracle_failed=true
fi
docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
  --username postgres --dbname "$test_database" \
  --command "TRUNCATE public.backtest_replay_results_v2,public.backtest_replay_runs_v2"

if [[ "$oracle_failed" == true ]]; then
  echo "ERROR: one or more Backtest Replay V2 regression oracles failed." >&2
  exit 1
fi

# This proves storage semantics only. The Market -> parameterized runner predecessor remains held.
stage="Backtest Replay V2 storage adapter"
cargo test --locked --profile "$cargo_ci_profile" --package vibe-backtest-owner --lib \
  postgres::durable_postgres_replay_v2::v2_storage_adapter_is_atomic_restart_stable_and_fail_closed \
  -- --ignored --exact

stage="Owner ACL audit"
docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
  --username postgres --dbname "$test_database" << 'SQL'
DO $audit$
DECLARE role_name text;
BEGIN
  IF pg_catalog.has_schema_privilege('backtest_owner','public','CREATE')
     OR (SELECT tableowner FROM pg_catalog.pg_tables WHERE schemaname='public' AND tablename='backtest_replay_runs_v2') <> 'backtest_owner'
     OR (SELECT tableowner FROM pg_catalog.pg_tables WHERE schemaname='public' AND tablename='backtest_replay_results_v2') <> 'backtest_owner'
  THEN
    RAISE EXCEPTION 'Backtest Replay V2 custody mismatch';
  END IF;
  FOREACH role_name IN ARRAY ARRAY[
    'rd_owner',
    'qualification_owner',
    'qualification_writer',
    'product_edge_owner',
    'operator_authorization_owner',
    'operator_authorization_writer'
  ] LOOP
    IF pg_catalog.has_table_privilege(role_name,'public.backtest_replay_runs_v2','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
       OR pg_catalog.has_table_privilege(role_name,'public.backtest_replay_results_v2','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    THEN
      RAISE EXCEPTION '% crossed the Backtest result custody boundary', role_name;
    END IF;
  END LOOP;
END
$audit$;
SQL
