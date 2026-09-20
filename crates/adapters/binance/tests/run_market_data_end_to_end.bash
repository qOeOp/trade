#!/usr/bin/env bash
set -euo pipefail

container="vibe-md-e2e-binance-${PPID}-$$"
database="vibe_test_market_data_e2e_binance_${PPID}_$$"
marker="md-e2e-binance-${PPID}-$$"
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
  echo "market-data end-to-end bootstrap: ${container} never reported ready ${required_consecutive_ready} times" >&2
  docker exec "$container" pg_isready -U postgres >&2 || true
  docker logs --tail 50 "$container" >&2 || true
  exit 1
fi

port="$(docker port "$container" 5432/tcp | sed -E 's/.*:([0-9]+)$/\1/')"
docker exec "$container" psql -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -c "CREATE ROLE vibe_test_role_market_data_owner LOGIN PASSWORD '$owner_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS"
docker exec "$container" psql -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -c "CREATE ROLE vibe_test_role_market_data_reader LOGIN PASSWORD '$reader_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS"
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

# The composition roots read the deployment variable, not the harness one.
export MARKET_DATA_OWNER_DATABASE_URL="$MARKET_DATA_OWNER_TEST_DATABASE_URL"

# The venue serves this data without authentication, so there is no key to require here. That is
# the point of this leg: the whole production path can be exercised with nothing but Docker and a
# reachable network.

# Selection runs under nextest rather than `cargo test --exact`. The two agree except on the case
# that matters: `cargo test --exact missing_name` prints `0 passed` and exits 0, so renaming the
# proof below would leave this script green while running nothing. nextest refuses an empty
# selection with `error: no tests to run` and a non-zero exit.
set +e
cargo nextest run --manifest-path crates/adapters/binance/Cargo.toml \
  --test market_data_end_to_end \
  --cargo-profile "${CARGO_CI_PROFILE:-nextest}" \
  --run-ignored all \
  --no-capture \
  -E 'test(=market_data_answers_one_frozen_request_without_a_credential)'
test_status=$?
set -e

exit "$test_status"
