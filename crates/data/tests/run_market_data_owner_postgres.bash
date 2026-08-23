#!/usr/bin/env bash
set -euo pipefail

container="vibe-md-d1-${PPID}-$$"
database="vibe_test_market_data_${PPID}_$$"
marker="md-d1-${PPID}-$$"
admin_password="md_d1_admin_test_only"
owner_password="md_d1_owner_test_only"
reader_password="md_d1_reader_test_only"

cleanup() {
  docker rm -f "$container" > /dev/null 2>&1 || true
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

docker run --detach --name "$container" --publish 127.0.0.1::5432 \
  --env POSTGRES_PASSWORD="$admin_password" postgres:16.10-alpine > /dev/null

for _ in $(seq 1 60); do
  if docker exec "$container" pg_isready -U postgres > /dev/null 2>&1; then
    break
  fi
  sleep 1
done
docker exec "$container" pg_isready -U postgres > /dev/null

port="$(docker port "$container" 5432/tcp | sed -E 's/.*:([0-9]+)$/\1/')"
docker exec "$container" psql -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -c "CREATE ROLE vibe_test_role_market_data_owner LOGIN PASSWORD '$owner_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS"
docker exec "$container" psql -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -c "CREATE ROLE vibe_test_role_market_data_reader LOGIN PASSWORD '$reader_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS"
docker exec "$container" psql -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -c "CREATE DATABASE \"$database\" OWNER vibe_test_role_market_data_owner"
docker exec "$container" psql -v ON_ERROR_STOP=1 -U postgres -d "$database" \
  -c "CREATE TABLE public.vibe_test_instance_marker(marker_identity TEXT PRIMARY KEY); INSERT INTO public.vibe_test_instance_marker VALUES ('$marker'); REVOKE ALL ON public.vibe_test_instance_marker FROM PUBLIC; GRANT SELECT ON public.vibe_test_instance_marker TO vibe_test_role_market_data_owner, vibe_test_role_market_data_reader"

export MARKET_DATA_ADMIN_TEST_DATABASE_URL="postgres://postgres:$admin_password@127.0.0.1:$port/$database"
export MARKET_DATA_OWNER_TEST_DATABASE_URL="postgres://vibe_test_role_market_data_owner:$owner_password@127.0.0.1:$port/$database"
export MARKET_DATA_READER_TEST_DATABASE_URL="postgres://vibe_test_role_market_data_reader:$reader_password@127.0.0.1:$port/$database"
export VIBE_POSTGRES_TEST_DATABASE_NAME="$database"
export VIBE_POSTGRES_TEST_INSTANCE_MARKER="$marker"

cargo test --manifest-path crates/data/Cargo.toml \
  owner::postgres::tests::postgres_owner_is_atomic_restart_safe_acl_sealed_and_fail_closed \
  --lib -- --ignored --exact
