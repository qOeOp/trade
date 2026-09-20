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

# The venue's reachability is probed before the test rather than inferred from its verdict. The
# proof reports `ObservationUnavailable`, which is where three separate erasures end up: the Data
# Client discards the HTTP error, the store discards the client's category, and the intake
# discards the store's. So a red leg says the venue did not answer and nothing about why. This
# probe is the only place in the leg that can name a status code, and it names one per endpoint.
# The hosts do not answer alike, which is the whole reason to ask each of them separately rather
# than to ask one and generalise.
#
# The probe never decides the leg. It prints and continues, so the proof stays the verdict; a
# probe that failed the script would replace one mute red with another.
# The status alone, for the one decision this script makes. It shares `curl`'s invocation with the
# probe below so the number that chooses a host and the number that gets printed cannot disagree.
probe_status() {
  curl --silent --show-error --output /dev/null --write-out '%{http_code}' --max-time 20 "$1" || true
}

probe_endpoint() {
  local label="$1" url="$2" status body
  if ! body="$(mktemp)"; then
    # Without this the probe would call curl with an empty --output, and report the failure as
    # "curl produced no status" - blaming the tool for the harness's own missing temp directory.
    echo "market-data end-to-end venue probe: ${label}: no temporary file, probe not run" >&2
    return 0
  fi
  # curl's own stderr is left alone: for a connection failure its message ("Could not resolve
  # host", "Connection timed out") is the whole diagnosis, and `000` alone would not say which.
  status="$(curl --silent --show-error --output "$body" --write-out '%{http_code}' --max-time 20 "$url" || true)"
  if [[ -z "$status" ]]; then
    # An empty status means curl itself did not run. Without this branch that case would print as
    # a blank line and read like a quiet success.
    echo "market-data end-to-end venue probe: ${label}: curl produced no status (is curl installed?)" >&2
  elif [[ "$status" == "000" ]]; then
    echo "market-data end-to-end venue probe: ${label}: no HTTP response (DNS, TLS, or connection refused)" >&2
  else
    echo "market-data end-to-end venue probe: ${label}: HTTP ${status}: $(head -c 200 "$body" | tr -d '\r\n')" >&2
  fi
  rm -f "$body"
}

# The spot pair's two hosts. The first run of this probe settled which is which: the trading API
# answers a hosted runner with HTTP 451, "Service unavailable from a restricted location", and the
# public-data mirror answers 200. That is why the spot binding names the mirror.
probe_endpoint "api.binance.com (the spot trading API)" \
  "https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=1"
probe_endpoint "data-api.binance.vision (the spot binding's host)" \
  "https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=1"

# A perpetual has no mirror to fall back to, so these ask whether any host serves one from here.
# `data-api.binance.vision` is spot-only - it answers `/fapi/v1/klines` with 404 even from an
# unrestricted network, so a 404 here means "wrong path", not "blocked", and the probe would be
# lying if it were left out. The rest are separate hosts that serve the same futures API.
probe_endpoint "data-api.binance.vision/fapi (does the mirror carry futures?)" \
  "https://data-api.binance.vision/fapi/v1/klines?symbol=BTCUSDT&interval=4h&limit=1"
probe_endpoint "fapi.binance.com (the USD-M host the perpetual binding names)" \
  "https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=4h&limit=1"
probe_endpoint "www.binance.com/fapi (the site proxying the same futures API)" \
  "https://www.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=4h&limit=1"
probe_endpoint "dapi.binance.com (COIN-M, a different perpetual on a third host)" \
  "https://dapi.binance.com/dapi/v1/klines?symbol=BTCUSD_PERP&interval=4h&limit=1"

# The perpetual's host is chosen here, out loud, rather than hardcoded into the proof.
#
# The proof defaults to the venue's canonical USD-M host, which is what a deployment would name and
# what answers from an unrestricted network. It is 451 from a GitHub-hosted runner, and no
# public-data mirror carries futures - `data-api.binance.vision` answers `/fapi/v1/klines` with 404
# even from an unrestricted network, as the probe above shows. The one host measured answering from
# a runner is the venue's own site, which proxies the same futures API.
#
# So this substitutes that host only when the canonical one does not answer, prints that it did,
# and leaves a local run on the default. `MARKET_DATA_E2E_USDM_ENDPOINT` moves the Data Client and
# the recorded Source Binding endpoint together, because they are one value in the proof: a binding
# that named one host while the client called another is the defect this leg carried until the spot
# pair was fixed.
if [[ -n "${MARKET_DATA_E2E_USDM_ENDPOINT:-}" ]]; then
  usdm_reason="the environment set it"
else
  canonical_usdm_status="$(probe_status "https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=4h&limit=1")"
  if [[ "$canonical_usdm_status" == "200" ]]; then
    MARKET_DATA_E2E_USDM_ENDPOINT="https://fapi.binance.com"
    usdm_reason="the canonical host answered 200"
  else
    MARKET_DATA_E2E_USDM_ENDPOINT="https://www.binance.com"
    usdm_reason="the canonical host answered ${canonical_usdm_status}"
  fi
  export MARKET_DATA_E2E_USDM_ENDPOINT
fi
# Printed on every path, including the one where the caller chose the host. A run that did not say
# which host it called cannot be read afterwards, and the two paths are exactly where a reader
# would otherwise have to guess.
echo "market-data end-to-end: the perpetual proof calls ${MARKET_DATA_E2E_USDM_ENDPOINT} and records it as the binding's endpoint, because ${usdm_reason}" >&2

# Selection runs under nextest rather than `cargo test --exact`. The two agree except on the case
# that matters: `cargo test --exact missing_name` prints `0 passed` and exits 0, so renaming the
# proof below would leave this script green while running nothing. nextest refuses an empty
# selection with `error: no tests to run` and a non-zero exit.
set +e
# Both proofs share one store, so they run one at a time. Each reads the Owner's decision cut
# after admitting its own binding, and a cut read across another admission is a cut for a head that
# has already moved. `--no-capture` implies a single test thread today, but stating it keeps that
# an intent rather than a consequence of an unrelated flag.
cargo nextest run --manifest-path crates/adapters/binance/Cargo.toml \
  --test market_data_end_to_end \
  --cargo-profile "${CARGO_CI_PROFILE:-nextest}" \
  --run-ignored all \
  --no-capture \
  --test-threads 1 \
  -E 'test(=market_data_answers_one_frozen_request_without_a_credential)
    + test(=market_data_answers_one_frozen_perpetual_request_without_a_credential)
    + test(=market_data_answers_one_frozen_daily_perpetual_request_without_a_credential)'
test_status=$?
set -e

exit "$test_status"
