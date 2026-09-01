#!/usr/bin/env bash

set -euo pipefail

readonly cargo_ci_profile="${CARGO_CI_PROFILE:-nextest}"

readonly guarded_paths=(
  crates/backtest_owner/src/postgres.rs
  crates/backtest_owner/tests/postgres_replay_v2.rs
  crates/backtest_result_custody/src/lib.rs
)

if rg -n 'BACKTEST_TEST_DATABASE_URL or BACKTEST_DATABASE_URL|or_else\(\|\| std::env::var\("BACKTEST_DATABASE_URL"\)|ExploratoryReplayRequestLocatorV1|BACKTEST_IMPERSONATOR' "${guarded_paths[@]}"; then
  echo "ERROR: Backtest V2 storage tests contain a forbidden fallback or legacy authority." >&2
  exit 1
fi
if rg -n 'PgPool|\.begin\(|\.commit\(' crates/backtest_result_custody/src/lib.rs; then
  echo "ERROR: Backtest Result custody adapter must use only the caller-held transaction." >&2
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
CREATE ROLE replay_rogue_rd_inbound_v1 NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE SCHEMA backtest_owner_api AUTHORIZATION backtest_owner;
REVOKE ALL ON SCHEMA backtest_owner_api FROM PUBLIC;
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
CREATE FUNCTION vibe_test_admin.forge_backtest_result_facade_source_v1()
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog
AS $function$
BEGIN
  EXECUTE $ddl$CREATE OR REPLACE FUNCTION backtest_owner_api.lock_exploratory_result_v1(requested_request_identity text,requested_request_meaning_digest text,requested_result_identity text,requested_result_digest text) RETURNS TABLE(canonical_result_bytes bytea,canonical_receipt_bytes bytea,canonical_outbox_bytes bytea) LANGUAGE sql STRICT VOLATILE PARALLEL UNSAFE SECURITY DEFINER SET search_path=pg_catalog AS $forged$ SELECT NULL::bytea,NULL::bytea,NULL::bytea WHERE false $forged$$ddl$;
END
$function$;
CREATE FUNCTION vibe_test_admin.set_backtest_result_facade_owner_drift_v1(forged boolean)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog
AS $function$
BEGIN
  IF forged THEN
    ALTER FUNCTION backtest_owner_api.lock_exploratory_result_v1(text,text,text,text) OWNER TO rd_owner;
  ELSE
    ALTER FUNCTION backtest_owner_api.lock_exploratory_result_v1(text,text,text,text) OWNER TO backtest_owner;
  END IF;
END
$function$;
CREATE FUNCTION vibe_test_admin.set_backtest_result_facade_acl_drift_v1(forged boolean)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog
AS $function$
BEGIN
  IF forged THEN
    GRANT EXECUTE ON FUNCTION backtest_owner_api.lock_exploratory_result_v1(text,text,text,text) TO qualification_writer;
  ELSE
    REVOKE EXECUTE ON FUNCTION backtest_owner_api.lock_exploratory_result_v1(text,text,text,text) FROM qualification_writer;
  END IF;
END
$function$;
CREATE FUNCTION vibe_test_admin.set_rogue_rd_inbound_membership_v1(forged boolean)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog
AS $function$
BEGIN
  IF forged THEN
    GRANT rd_owner TO replay_rogue_rd_inbound_v1 WITH INHERIT FALSE, SET TRUE;
  ELSE
    REVOKE rd_owner FROM replay_rogue_rd_inbound_v1;
  END IF;
END
$function$;
CREATE FUNCTION vibe_test_admin.set_backtest_result_facade_out_name_drift_v1(forged boolean)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog
AS $function$
DECLARE
  source_text text;
  first_out_name text;
BEGIN
  SELECT procedure.prosrc INTO STRICT source_text
  FROM pg_catalog.pg_proc procedure
  WHERE procedure.oid='backtest_owner_api.lock_exploratory_result_v1(text,text,text,text)'::pg_catalog.regprocedure;
  DROP FUNCTION backtest_owner_api.lock_exploratory_result_v1(text,text,text,text);
  first_out_name := CASE WHEN forged THEN 'run_request_identity_drift' ELSE 'run_request_identity' END;
  EXECUTE pg_catalog.format(
    'CREATE FUNCTION backtest_owner_api.lock_exploratory_result_v1(requested_request_identity text,requested_request_meaning_digest text,requested_result_identity text,requested_result_digest text) RETURNS TABLE(%I text,run_request_meaning_digest text,request_seal_digest text,rd_receipt_identity text,request_binding_blake3 text,request_canonical_bytes bytea,request_canonical_bytes_blake3 text,run_attempt_identity text,run_result_identity text,run_result_digest text,run_terminal text,result_identity text,result_digest text,result_request_identity text,result_request_meaning_digest text,result_attempt_identity text,result_terminal text,canonical_result_bytes bytea,result_canonical_bytes_blake3 text,receipt_result_identity text,receipt_identity text,receipt_digest text,receipt_request_identity text,receipt_request_meaning_digest text,receipt_result_digest text,receipt_namespace text,outbox_event_identity text,receipt_committed_at_epoch_ms bigint,canonical_receipt_bytes bytea,receipt_canonical_bytes_blake3 text,outbox_result_identity text,event_identity text,event_digest text,outbox_receipt_identity text,outbox_request_identity text,outbox_request_meaning_digest text,outbox_result_digest text,outbox_namespace text,payload_digest text,outbox_committed_at_epoch_ms bigint,canonical_outbox_bytes bytea,outbox_canonical_bytes_blake3 text) LANGUAGE sql STRICT VOLATILE PARALLEL UNSAFE SECURITY DEFINER SET search_path=pg_catalog AS %L',
    first_out_name,
    source_text
  );
  ALTER FUNCTION backtest_owner_api.lock_exploratory_result_v1(text,text,text,text) OWNER TO backtest_owner;
  REVOKE ALL ON FUNCTION backtest_owner_api.lock_exploratory_result_v1(text,text,text,text) FROM PUBLIC;
  GRANT EXECUTE ON FUNCTION backtest_owner_api.lock_exploratory_result_v1(text,text,text,text) TO rd_owner GRANTED BY backtest_owner;
END
$function$;
REVOKE ALL ON FUNCTION vibe_test_admin.forge_backtest_result_facade_source_v1(),vibe_test_admin.set_backtest_result_facade_owner_drift_v1(boolean),vibe_test_admin.set_backtest_result_facade_acl_drift_v1(boolean),vibe_test_admin.set_rogue_rd_inbound_membership_v1(boolean),vibe_test_admin.set_backtest_result_facade_out_name_drift_v1(boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vibe_test_admin.forge_backtest_result_facade_source_v1(),vibe_test_admin.set_backtest_result_facade_owner_drift_v1(boolean),vibe_test_admin.set_backtest_result_facade_acl_drift_v1(boolean),vibe_test_admin.set_backtest_result_facade_out_name_drift_v1(boolean) TO rd_owner;
GRANT EXECUTE ON FUNCTION vibe_test_admin.set_rogue_rd_inbound_membership_v1(boolean) TO backtest_owner;
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
  --command "DROP TABLE IF EXISTS public.backtest_replay_result_outbox_v1,public.backtest_replay_result_receipts_v1,public.backtest_replay_results_v2,public.backtest_replay_runs_v2" \
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

oracle_failed=false
stage="Backtest auxiliary dropped-uniqueness bootstrap rejection"
docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
  --username postgres --dbname "$test_database" \
  --command "ALTER TABLE public.backtest_replay_result_receipts_v1 DROP CONSTRAINT backtest_replay_result_receipts_v1_receipt_identity_key" \
  --command "GRANT CREATE ON SCHEMA public TO backtest_owner"
if ! cargo test --locked --profile "$cargo_ci_profile" --package vibe-backtest-owner --lib \
  postgres::durable_postgres_replay_v2::bootstrap_rejects_auxiliary_dropped_uniqueness \
  -- --ignored --exact; then
  oracle_failed=true
fi
docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
  --username postgres --dbname "$test_database" \
  --command "ALTER TABLE public.backtest_replay_result_receipts_v1 ADD CONSTRAINT backtest_replay_result_receipts_v1_receipt_identity_key UNIQUE(receipt_identity)" \
  --command "REVOKE CREATE ON SCHEMA public FROM backtest_owner"

stage="Backtest auxiliary post-connect dropped-uniqueness rejection"
if ! cargo test --locked --profile "$cargo_ci_profile" --package vibe-backtest-owner --lib \
  postgres::durable_postgres_replay_v2::existing_handle_rejects_auxiliary_dropped_uniqueness \
  -- --ignored --exact; then
  oracle_failed=true
fi

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
CREATE FUNCTION vibe_test_admin.set_backtest_external_view_v2(enabled boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog
AS $function$
BEGIN
  IF enabled THEN
    CREATE VIEW public.backtest_external_runs_v2 AS
    SELECT * FROM public.backtest_replay_runs_v2;
    GRANT SELECT, DELETE ON public.backtest_external_runs_v2 TO rd_owner;
  ELSE
    DROP VIEW IF EXISTS public.backtest_external_runs_v2;
  END IF;
END
$function$;
REVOKE ALL ON FUNCTION vibe_test_admin.set_backtest_external_view_v2(boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vibe_test_admin.set_backtest_external_view_v2(boolean) TO backtest_owner;
CREATE FUNCTION vibe_test_admin.set_replay_owner_membership_v1(principal_name text,authority_name text,enabled boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog
AS $function$
BEGIN
  IF principal_name NOT IN ('backtest_owner','rd_owner')
     OR authority_name NOT IN ('product_edge_owner','qualification_owner','qualification_writer','operator_authorization_writer') THEN
    RAISE EXCEPTION 'undeclared Replay Owner membership fixture';
  END IF;
  IF enabled THEN
    EXECUTE pg_catalog.format('GRANT %I TO %I WITH INHERIT TRUE, SET TRUE',authority_name,principal_name);
  ELSE
    EXECUTE pg_catalog.format('REVOKE %I FROM %I',authority_name,principal_name);
  END IF;
END
$function$;
REVOKE ALL ON FUNCTION vibe_test_admin.set_replay_owner_membership_v1(text,text,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vibe_test_admin.set_replay_owner_membership_v1(text,text,boolean) TO backtest_owner;
CREATE COLLATION vibe_test_admin.backtest_nondeterministic_ci_v1 (
  provider=icu,
  locale='und-u-ks-level2',
  deterministic=false
);
CREATE FUNCTION vibe_test_admin.set_backtest_scalar_shape_drift_v1(drift_kind text,enabled boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog
AS $function$
BEGIN
  IF drift_kind='collation' THEN
    IF enabled THEN
      ALTER TABLE public.backtest_replay_runs_v2
        ALTER COLUMN request_identity TYPE text COLLATE vibe_test_admin.backtest_nondeterministic_ci_v1
        USING request_identity::text;
    ELSE
      ALTER TABLE public.backtest_replay_runs_v2
        ALTER COLUMN request_identity TYPE text COLLATE pg_catalog."C"
        USING request_identity::text;
    END IF;
  ELSIF drift_kind='opclass' THEN
    UPDATE pg_catalog.pg_index index_entry
    SET indclass[0]=(SELECT operator_class.oid
      FROM pg_catalog.pg_opclass operator_class
      JOIN pg_catalog.pg_am access_method ON access_method.oid=operator_class.opcmethod
      WHERE operator_class.opcname=CASE WHEN enabled THEN 'text_pattern_ops' ELSE 'text_ops' END
        AND operator_class.opcnamespace='pg_catalog'::pg_catalog.regnamespace
        AND operator_class.opcintype='pg_catalog.text'::pg_catalog.regtype
        AND access_method.amname='btree')
    WHERE index_entry.indexrelid='public.backtest_replay_runs_v2_pkey'::pg_catalog.regclass;
  ELSE
    RAISE EXCEPTION 'undeclared Backtest scalar shape drift';
  END IF;
END
$function$;
REVOKE ALL ON FUNCTION vibe_test_admin.set_backtest_scalar_shape_drift_v1(text,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vibe_test_admin.set_backtest_scalar_shape_drift_v1(text,boolean) TO backtest_owner;
CREATE FUNCTION vibe_test_admin.set_backtest_extension_membership_v1(enabled boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog
AS $function$
BEGIN
  IF enabled THEN
    ALTER EXTENSION plpgsql ADD TABLE public.backtest_replay_runs_v2;
  ELSE
    ALTER EXTENSION plpgsql DROP TABLE public.backtest_replay_runs_v2;
  END IF;
END
$function$;
REVOKE ALL ON FUNCTION vibe_test_admin.set_backtest_extension_membership_v1(boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vibe_test_admin.set_backtest_extension_membership_v1(boolean) TO backtest_owner;
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

stage="Backtest preexisting external view rejection"
docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
  --username postgres --dbname "$test_database" \
  --command "SELECT vibe_test_admin.set_backtest_external_view_v2(true)"
cargo test --locked --profile "$cargo_ci_profile" --package vibe-backtest-owner --lib \
  postgres::durable_postgres_replay_v2::runtime_connect_rejects_preexisting_external_view \
  -- --ignored --exact
docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
  --username postgres --dbname "$test_database" \
  --command "GRANT CREATE ON SCHEMA public TO backtest_owner"
cargo test --locked --profile "$cargo_ci_profile" --package vibe-backtest-owner --lib \
  postgres::durable_postgres_replay_v2::bootstrap_rejects_preexisting_external_view \
  -- --ignored --exact
docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
  --username postgres --dbname "$test_database" \
  --command "SELECT vibe_test_admin.set_backtest_external_view_v2(false)" \
  --command "REVOKE CREATE ON SCHEMA public FROM backtest_owner"

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

stage="Backtest reverse SET membership rejection"
docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
  --username postgres --dbname "$test_database" \
  --command "GRANT rd_owner TO backtest_owner WITH INHERIT FALSE, SET TRUE"
if ! cargo test --locked --profile "$cargo_ci_profile" --package vibe-backtest-owner --lib \
  postgres::durable_postgres_replay_v2::runtime_rejects_backtest_set_membership_into_rd_owner \
  -- --ignored --exact; then
  oracle_failed=true
fi
docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
  --username postgres --dbname "$test_database" \
  --command "REVOKE rd_owner FROM backtest_owner"

stage="Backtest unknown capability role rejection"
docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
  --username postgres --dbname "$test_database" << 'SQL'
CREATE ROLE replay_unknown_capability_writer NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE TABLE vibe_test_admin.replay_unknown_capability_write_v1 (identity text PRIMARY KEY);
REVOKE ALL ON TABLE vibe_test_admin.replay_unknown_capability_write_v1 FROM PUBLIC;
GRANT INSERT ON TABLE vibe_test_admin.replay_unknown_capability_write_v1 TO replay_unknown_capability_writer;
GRANT replay_unknown_capability_writer TO backtest_owner,rd_owner WITH INHERIT FALSE,SET TRUE;
SQL
if ! cargo test --locked --profile "$cargo_ci_profile" --package vibe-backtest-owner --lib \
  postgres::durable_postgres_replay_v2::writer_and_reader_reject_unknown_capability_role_membership \
  -- --ignored --exact; then
  oracle_failed=true
fi
docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
  --username postgres --dbname "$test_database" << 'SQL'
REVOKE replay_unknown_capability_writer FROM backtest_owner,rd_owner;
DROP TABLE vibe_test_admin.replay_unknown_capability_write_v1;
DROP ROLE replay_unknown_capability_writer;
SQL

stage="Backtest post-connect Product Edge Owner membership rejection"
if ! cargo test --locked --profile "$cargo_ci_profile" --package vibe-backtest-owner --lib \
  postgres::durable_postgres_replay_v2::existing_handle_rejects_product_edge_owner_membership \
  -- --ignored --exact; then
  oracle_failed=true
fi

stage="Result reader post-connect Qualification Owner membership rejection"
if ! cargo test --locked --profile "$cargo_ci_profile" --package vibe-backtest-owner --lib \
  postgres::durable_postgres_replay_v2::result_reader_rejects_qualification_owner_membership \
  -- --ignored --exact; then
  oracle_failed=true
fi

stage="Result reader Operator Authorization Writer membership rejection"
if ! cargo test --locked --profile "$cargo_ci_profile" --package vibe-backtest-owner --lib \
  postgres::durable_postgres_replay_v2::result_reader_rejects_operator_authorization_writer_membership \
  -- --ignored --exact; then
  oracle_failed=true
fi

stage="Result reader post-connect declared-constraint drop rejection"
if ! cargo test --locked --profile "$cargo_ci_profile" --package vibe-backtest-owner --lib \
  postgres::durable_postgres_replay_v2::result_reader_rejects_dropped_receipt_uniqueness \
  -- --ignored --exact; then
  oracle_failed=true
fi

stage="Result reader post-connect undeclared-constraint rejection"
if ! cargo test --locked --profile "$cargo_ci_profile" --package vibe-backtest-owner --lib \
  postgres::durable_postgres_replay_v2::result_reader_rejects_undeclared_constraint \
  -- --ignored --exact; then
  oracle_failed=true
fi

# Seed through the repository's real U1 V2 Owner path. No request meaning is synthesized here.
stage="native R&D schema consumers"
cargo test --locked --profile "$cargo_ci_profile" --package vibe-strategy-factory --lib \
  product_edge_postgres::tests::fresh_rd_owner_migrates_before_qualification_writer_validates \
  -- --ignored --exact
cargo test --locked --profile "$cargo_ci_profile" --package vibe-strategy-factory \
  --test source_intake \
  postgres_source_invocation_lifecycle_is_canonical_once_only_and_acl_sealed \
  -- --ignored --exact
cargo test --locked --profile "$cargo_ci_profile" --package vibe-product-edge --lib \
  postgres::tests::genesis_admission_claim_cutover_and_revocation_are_canonical \
  -- --ignored --exact

stage="real sealed R&D V2 request seed"
cargo test --locked --profile "$cargo_ci_profile" --package vibe-strategy-factory \
  --test exploratory_replay_request_owner \
  frozen_exploratory_replay_request_is_sealed_for_canonical_backtest_owner \
  -- --ignored --exact

stage="Backtest writer and R&D request-lock Qualification Writer membership rejection"
if ! cargo test --locked --profile "$cargo_ci_profile" --package vibe-backtest-owner --lib \
  postgres::durable_postgres_replay_v2::writer_and_request_lock_reject_qualification_writer_membership \
  -- --ignored --exact; then
  oracle_failed=true
fi

stage="Backtest scalar collation and index opclass drift rejection"
if ! cargo test --locked --profile "$cargo_ci_profile" --package vibe-backtest-owner --lib \
  postgres::durable_postgres_replay_v2::writer_and_reader_reject_collation_and_index_opclass_drift_without_byte_changes \
  -- --ignored --exact; then
  oracle_failed=true
fi

stage="Backtest undeclared extension dependency rejection"
if ! cargo test --locked --profile "$cargo_ci_profile" --package vibe-backtest-owner --lib \
  postgres::durable_postgres_replay_v2::writer_and_reader_reject_extension_membership_dependency_without_byte_changes \
  -- --ignored --exact; then
  oracle_failed=true
fi

stage="Backtest Replay V2 R&D internal helper source-drift rejection"
if ! cargo test --locked --profile "$cargo_ci_profile" --package vibe-backtest-owner --lib \
  postgres::durable_postgres_replay_v2::existing_handle_rejects_forged_internal_v1_helper_before_rows \
  -- --ignored --exact; then
  oracle_failed=true
fi
if ! cargo test --locked --profile "$cargo_ci_profile" --package vibe-backtest-owner --lib \
  postgres::durable_postgres_replay_v2::existing_handle_rejects_forged_internal_v2_helper_before_rows \
  -- --ignored --exact; then
  oracle_failed=true
fi
if ! cargo test --locked --profile "$cargo_ci_profile" --package vibe-backtest-owner --lib \
  postgres::durable_postgres_replay_v2::existing_handle_rejects_forged_lock_facade_before_rows \
  -- --ignored --exact; then
  oracle_failed=true
fi

stage="native R&D API same-identity recovery"
cargo test --locked --profile "$cargo_ci_profile" --package vibe-strategy-factory-rd-owner-api \
  --bin strategy-factory-rd-owner-api \
  tests::same_identity_started_retry_returns_http_ok_with_exact_custody_once \
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

stage="Backtest post-connect external view rejection"
if ! cargo test --locked --profile "$cargo_ci_profile" --package vibe-backtest-owner --lib \
  postgres::durable_postgres_replay_v2::existing_handle_rejects_post_connect_external_view \
  -- --ignored --exact; then
  oracle_failed=true
fi
docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
  --username postgres --dbname "$test_database" \
  --command "DROP VIEW IF EXISTS public.backtest_external_runs_v2" \
  --command "DROP FUNCTION vibe_test_admin.set_backtest_external_view_v2(boolean)"

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
  --command "TRUNCATE public.backtest_replay_result_outbox_v1,public.backtest_replay_result_receipts_v1,public.backtest_replay_results_v2,public.backtest_replay_runs_v2"
if ! cargo test --locked --profile "$cargo_ci_profile" --package vibe-backtest-owner --lib \
  postgres::durable_postgres_replay_v2::tampered_rd_receipt_identity_fails_closed_after_restart \
  -- --ignored --exact; then
  oracle_failed=true
fi
docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
  --username postgres --dbname "$test_database" \
  --command "TRUNCATE public.backtest_replay_result_outbox_v1,public.backtest_replay_result_receipts_v1,public.backtest_replay_results_v2,public.backtest_replay_runs_v2"

if [[ "$oracle_failed" == true ]]; then
  echo "ERROR: one or more Backtest Replay V2 regression oracles failed." >&2
  exit 1
fi

stage="Backtest Result facade drift rejection"
cargo test --locked --profile "$cargo_ci_profile" --package vibe-backtest-owner --lib \
  postgres::durable_postgres_replay_v2::result_custody_facade_drift_never_produces_positive_readback \
  -- --ignored --exact

stage="Backtest inbound R&D role reachability rejection"
cargo test --locked --profile "$cargo_ci_profile" --package vibe-backtest-owner --lib \
  postgres::durable_postgres_replay_v2::all_public_seams_reject_capability_free_inbound_rd_owner_membership \
  -- --ignored --exact

stage="Backtest Result same-source OUT declaration drift rejection"
cargo test --locked --profile "$cargo_ci_profile" --package vibe-backtest-owner --lib \
  postgres::durable_postgres_replay_v2::result_reader_rejects_same_source_out_declaration_drift \
  -- --ignored --exact

stage="Backtest Result SQL facade protected-namespace exclusion"
cargo test --locked --profile "$cargo_ci_profile" --package vibe-backtest-owner --lib \
  postgres::durable_postgres_replay_v2::result_custody_sql_facade_excludes_protected_namespaces \
  -- --ignored --exact

stage="Backtest Result reader duplicate-row drift rejection"
cargo test --locked --profile "$cargo_ci_profile" --package vibe-backtest-owner --lib \
  postgres::durable_postgres_replay_v2::result_reader_rejects_duplicate_outbox_rows \
  -- --ignored --exact

stage="Backtest Result scalar mirror and cross-splice rejection"
cargo test --locked --profile "$cargo_ci_profile" --package vibe-backtest-owner --lib \
  postgres::durable_postgres_replay_v2::scalar_mirror_tamper_and_cross_splice_fail_closed_at_both_public_seams \
  -- --ignored --exact

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
     OR (SELECT tableowner FROM pg_catalog.pg_tables WHERE schemaname='public' AND tablename='backtest_replay_result_receipts_v1') <> 'backtest_owner'
     OR (SELECT tableowner FROM pg_catalog.pg_tables WHERE schemaname='public' AND tablename='backtest_replay_result_outbox_v1') <> 'backtest_owner'
     OR (SELECT pg_catalog.pg_get_userbyid(nspowner) FROM pg_catalog.pg_namespace WHERE nspname='backtest_owner_api') <> 'backtest_owner'
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
       OR pg_catalog.has_table_privilege(role_name,'public.backtest_replay_result_receipts_v1','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
       OR pg_catalog.has_table_privilege(role_name,'public.backtest_replay_result_outbox_v1','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    THEN
      RAISE EXCEPTION '% crossed the Backtest result custody boundary', role_name;
    END IF;
  END LOOP;
END
$audit$;
DO $facade_audit$
BEGIN
  IF NOT pg_catalog.has_schema_privilege('rd_owner','backtest_owner_api','USAGE')
     OR NOT pg_catalog.has_function_privilege('rd_owner','backtest_owner_api.lock_exploratory_result_v1(text,text,text,text)','EXECUTE')
     OR pg_catalog.has_function_privilege('public','backtest_owner_api.lock_exploratory_result_v1(text,text,text,text)','EXECUTE')
  THEN
    RAISE EXCEPTION 'Backtest Result read facade ACL mismatch';
  END IF;
END
$facade_audit$;
SQL
