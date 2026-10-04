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
  owner::store_admission::tests::the_admitted_quote_cut_read_resolves_what_custody_resolves
  owner::store_admission::tests::the_admitted_custody_reads_resolve_what_custody_resolves
  owner::store_admission::tests::the_postgres_custody_store_admits_on_its_own_clock_and_refuses_what_moved
  owner::store_admission::tests::each_floor_is_the_catalog_closure_of_its_reads
  owner::postgres::admitted_read_api_v1::tests::the_admitted_read_schema_is_what_its_statements_declare
  owner::store_admission::tests::the_role_identity_moves_with_every_privilege_the_role_gains_and_no_other
  owner::store_admission::tests::the_admitted_reader_holds_every_admitted_read_and_nothing_else
  owner::store_admission::tests::the_pinned_tls_measurer_and_its_reads_reach_the_store_only_over_the_pinned_root
  owner::store_admission::tests::the_production_seam_admits_what_the_administrator_measured_sealed_and_published
  owner::instrument_master_v2_postgres::tests::postgres_v2_cut_custody_holds_one_or_two_members_and_migrates_a_legacy_table
  owner::instrument_master_v2_postgres::tests::postgres_bound_replay_issuance_keys_each_request_to_one_binding
  owner::instrument_master_v2_postgres::tests::postgres_a_fact_resolves_by_its_digest_only_as_a_link_of_its_verified_chain
  owner::instrument_economic_terms_postgres_v1::tests::postgres_economic_terms_resolve_for_one_member_or_two
  owner::postgres::pit_intake_member_count_tests::pit_intake_admits_one_or_two_universe_members_and_refuses_the_rest_unwritten
  owner::postgres::native_replay_quote_cut_intake_tests::an_intake_minted_frame_takes_the_quote_cut_its_intake_minted_on_the_same_facts
  owner::replay_market_facts_v2::first_corpus_v1_readback_postgres_tests::first_corpus_reads_back_through_the_v1_lock_function_unchanged
  owner::replay_market_facts_v2::universe_member_shape_postgres_tests::replay_facts_table_migrates_and_keeps_each_row_to_its_shape
  owner::postgres::replay_market_facts_v2::universe_issuance::postgres_tests::postgres_universe_member_composition_issues_a_binding_that_keys_its_cut
  owner::postgres::tests::postgres_each_research_request_under_one_binding_gets_its_own_market_semantics
  owner::postgres::tests::postgres_production_admits_market_semantics_for_the_chain_fixture_instrument
  owner::postgres::tests::the_market_base_corpus_is_named_by_its_snapshot_after_a_production_admission
  owner::postgres::chain_market_base_v1_tests::the_acceptance_basis_is_written_once_and_rejoined_without_moving_a_pointer
  owner::postgres::chain_market_base_v1_tests::a_store_on_another_clock_refuses_the_basis_at_its_source_binding
  owner::postgres::chain_market_base_v1_tests::a_base_snapshot_over_another_source_binding_is_refused_on_rejoin
  owner::postgres::chain_market_base_v1_tests::the_basis_rejoins_the_base_the_replay_composition_entry_writes
  owner::postgres::chain_market_base_v1_tests::the_base_records_are_the_same_written_or_rejoined
  owner::postgres::tests::postgres_concurrent_values_under_one_binding_leave_one_value
  owner::postgres::tests::postgres_market_semantics_heads_migrate_to_one_head_per_snapshot
  owner::postgres::pit_initial_intake_correlation_tests::postgres_an_initial_intake_claims_its_correlation_once_and_reads_back_by_it
  owner::postgres::pit_empty_observation_tests::postgres_an_empty_answer_is_an_insufficient_snapshot_without_a_batch
  owner::postgres::pit_empty_observation_tests::postgres_a_partial_answer_is_insufficient_and_its_retry_rejoins
  owner::postgres::universe_sample_projection_v1_tests::postgres_a_universe_frame_issues_one_sample_projection_over_the_host_frame
  owner::postgres::universe_member_composition_basis_v1_tests::postgres_a_new_snapshot_reads_the_basis_its_universe_composition_issues_from
  owner::postgres::instrument_master_admission_v1_tests::postgres_an_instrument_fact_takes_its_scope_and_frontiers_from_the_named_binding
  owner::postgres::instrument_master_admission_v2_tests::postgres_a_v2_baseline_is_admitted_from_its_payload_and_resolved_at_the_research_cut
  owner::postgres::instrument_master_status_delta_v2_tests::postgres_a_status_delta_extends_the_v2_fact_and_the_cut_after_it_resolves_it
  owner::postgres::instrument_master_status_delta_v2_tests::postgres_two_identical_v2_submissions_at_once_both_answer_with_the_one_fact
  owner::postgres::instrument_master_snapshot_v2_tests::postgres_a_snapshot_extends_the_v2_fact_and_advances_the_clock_it_needs
  owner::postgres::instrument_master_snapshot_v2_tests::postgres_a_snapshot_past_a_head_on_another_clock_is_refused_and_writes_nothing
  owner::postgres::instrument_master_snapshot_v2_tests::postgres_a_minting_snapshot_and_another_clock_writer_at_once_both_answer
  owner::postgres::source_availability_rule_v1_tests::postgres_a_schema_two_binding_stores_its_availability_rule
  owner::postgres::pit_window_custody_v1_tests::postgres_a_custody_commits_once_and_a_resubmission_rejoins_without_writing
  owner::postgres::pit_window_custody_v1_tests::postgres_every_custody_refusal_writes_nothing
  owner::postgres::pit_window_custody_v1_tests::postgres_a_successor_corrects_its_chain_and_refuses_a_branch_or_a_changed_basis
  owner::postgres::pit_window_custody_v1_tests::postgres_a_successor_naming_another_universe_record_is_refused
  owner::postgres::pit_window_custody_v1_tests::postgres_availability_follows_the_rule_and_never_passes_the_minting_cut
  owner::postgres::pit_window_custody_v1_tests::postgres_a_custody_after_a_snapshot_of_its_scope_states_the_scope_value
  owner::postgres::pit_window_custody_v1_tests::postgres_a_snapshot_after_a_custody_of_its_scope_states_the_scope_value
  owner::postgres::pit_window_view_v1_tests::postgres_a_run_reads_dense_frames_from_its_chain_head
  owner::postgres::pit_window_view_v1_tests::postgres_a_run_outside_its_window_or_chain_is_refused
  owner::postgres::pit_window_view_v1_tests::postgres_a_frame_without_a_complete_cross_section_refuses_the_run
  owner::postgres::pit_window_view_v1_tests::postgres_an_availability_rule_at_the_minting_instant_hides_every_frame
  owner::postgres::pit_window_view_v1_tests::postgres_a_correction_published_before_d_k_changes_only_frame_k
  owner::postgres::pit_window_view_v1_tests::postgres_a_pinned_head_reads_the_view_at_that_head_and_a_foreign_head_is_refused
  owner::postgres::pit_window_view_v1_tests::postgres_a_tampered_custody_row_refuses_the_view
  owner::postgres::pit_window_view_v1_tests::postgres_a_run_carries_its_root_chain_basis_at_the_head_it_read
  owner::postgres::pit_window_view_v1_tests::postgres_a_run_without_its_verified_chain_basis_is_refused
  owner::postgres::native_replay_custody_frame_v1_tests::postgres_a_one_member_custody_frame_equals_its_snapshot_frame
  owner::postgres::native_replay_custody_frame_v1_tests::postgres_two_single_timeframe_custody_frames_equal_their_snapshot_frames
  owner::postgres::native_replay_custody_frame_v1_tests::postgres_a_custody_frame_refuses_a_foreign_head_and_never_mixes_two_heads
  owner::postgres::native_replay_custody_frame_v1_tests::postgres_without_a_derived_quote_cut_a_custody_frame_is_refused_not_invented
  owner::postgres::source_binding_admission_v1_tests::postgres_an_unsupported_bar_timeframe_is_refused_by_name_and_writes_nothing
  owner::postgres::bar_schedule_acceptance_v1_tests::postgres_a_declared_bar_role_gets_the_schedule_its_frame_reads_once
  owner::postgres::bar_schedule_acceptance_v1_tests::postgres_the_schedule_refuses_each_input_it_cannot_derive_from
  owner::postgres::bar_schedule_acceptance_v1_tests::postgres_a_continuous_declaration_mints_a_schedule_without_calendar_or_session
  owner::postgres::bar_schedule_acceptance_v1_tests::postgres_no_schedule_is_proposed_for_rows_their_binding_does_not_declare
  owner::store_admission::tests::a_production_build_refuses_evidence_that_names_no_admission
)

# Proofs of code that exists only in a build carrying `sealed-strategy-input-acceptance`. They run
# with that feature, in a build of their own, because the list above must be the build without it:
# that is where the production branch of what they relax is the branch compiled and proven.
readonly market_data_owner_postgres_sealed_acceptance_tests=(
  owner::store_admission::tests::the_sealed_acceptance_resolver_reads_under_exactly_its_grants
  owner::postgres::native_replay_custody_frame_v1_tests::postgres_the_sealed_acceptance_custody_resolver_reads_a_frame_with_its_stated_quotes
  owner::postgres::sealed_acceptance_custody_chain_v1_tests::postgres_the_sealed_acceptance_chain_reads_every_frame_with_its_derived_quote_cut
  owner::postgres::sealed_acceptance_custody_chain_v1_tests::postgres_a_bar_the_custody_intake_refuses_is_refused_under_its_name
)

# Proofs in an integration-test binary, as `<binary>::<test>`. They reach what exists only in a build
# that is not a test build of the library - `rd-owner-api`'s production resolvers - so they cannot
# be unit tests. They migrate the Owner as a process outside the crate does, through the intake,
# which reads MARKET_DATA_OWNER_DATABASE_URL; it is given to them alone.
readonly market_data_owner_postgres_integration_tests=(
  store_admission_production_resolvers::the_native_replay_resolvers_open_and_read_in_required_mode
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

# A wall clock on every proof; scripts/ci/chain-entry-watchdog.bash says why. 360s is about twice the
# slowest successful run of this whole runner - 169s, the first proof's compile included, over 7 runs
# of 2026-09-24 - while the slowest proof itself took 37.7s; it stays under the CI step's 15-minute
# limit, so a hung proof is stopped and named here rather than by the step timeout. This expires as
# proofs grow slower: when one routinely passes 180s, re-measure and raise it.
# MARKET_DATA_PROOF_WALL_CLOCK_SECONDS lowers it to make the watchdog fire on purpose.
# shellcheck source=scripts/ci/chain-entry-watchdog.bash
source "$repository_root/scripts/ci/chain-entry-watchdog.bash"
readonly proof_wall_clock_seconds="${MARKET_DATA_PROOF_WALL_CLOCK_SECONDS:-360}"
readonly proof_record_dir="$repository_root/target/nextest/market-data-records"
check_destructive_sql_admission

# The same machine-wide lock as the ordered chain, on the same file: one local Owner chain at a
# time, whichever it is, taken before the first container. scripts/ci/owner-chain-lock.bash says
# why. A hosted runner runs one job, so CI does not take it.
if [[ "${GITHUB_ACTIONS:-}" != "true" ]]; then
  # shellcheck source=scripts/ci/owner-chain-lock.bash
  source "${repository_root}/scripts/ci/owner-chain-lock.bash"
  acquire_owner_chain_lock || exit 1
  # Binaries built by another worktree must not run here; cargo-target-in-worktree.bash says why.
  # shellcheck source=scripts/ci/cargo-target-in-worktree.bash
  source "${repository_root}/scripts/ci/cargo-target-in-worktree.bash"
  require_cargo_target_inside_worktree || exit 1
fi

container="vibe-md-d1-${PPID}-$$"
database_prefix="vibe_test_market_data_${PPID}_$$"
marker_prefix="md-d1-${PPID}-$$"
admin_password="md_d1_admin_test_only"
owner_password="md_d1_owner_test_only"
reader_password="md_d1_reader_test_only"
custody_publisher_password="md_d1_custody_publisher_test_only"
custody_custodian_password="md_d1_custody_custodian_test_only"
admitted_reader_password="md_d1_admitted_reader_test_only"
# A made-up test value, assembled at run time rather than written as `name="value"` so secret
# scanners do not report a fake credential (GitGuardian did on #1243; #1169 set the precedent).
printf -v tls_only_password '%s_%s' md_d1_tls_only test_only
readonly tls_dir="$repository_root/target/nextest/market-data-tls"

# shellcheck disable=SC2329 # invoked indirectly by the EXIT trap
cleanup() {
  local primary_status="${1:-0}"
  local cleanup_status=0
  local matching_containers=""

  disarm_chain_entry_watchdog

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

# `--init`, as in the R&D chain (test-rd-owner-postgres.bash says why at its first `docker run`): with
# PostgreSQL as PID 1, any orphaned shell child of a `docker exec` is reaped by the postmaster, and
# one killed by a signal restarts every server process. Nothing here drives psql from an in-container
# heredoc today; this keeps that from mattering if something ever does.
# The deployment's PostgreSQL (product/rd-workbench/docker-compose.yml), pinned by the same digest:
# mirror.gcr.io first, public.ecr.aws if it does not serve (scripts/ci/pull-pinned-image.bash).
postgres_image="$(bash "$repository_root/scripts/ci/pull-pinned-image.bash" \
  "mirror.gcr.io/library/postgres:16.10-alpine@sha256:029660641a0cfc575b14f336ba448fb8a75fd595d42e1fa316b9fb4378742297" \
  "public.ecr.aws/docker/library/postgres:16.10-alpine@sha256:029660641a0cfc575b14f336ba448fb8a75fd595d42e1fa316b9fb4378742297")"
docker run --detach --init --name "$container" --publish 127.0.0.1::5432 \
  --env POSTGRES_PASSWORD="$admin_password" "$postgres_image" > /dev/null

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

# TLS for Store Admission's pinned measurer: a throwaway root, and a certificate for 127.0.0.1 it
# issues, which the server presents once `ssl` is on. Every other connection here states plaintext
# and is still admitted. One role, vibe_test_role_market_data_tls_only, is admitted over TLS alone,
# so a proof that reaches the store as it can only have reached it over TLS.
rm -rf -- "$tls_dir"
mkdir -p -- "$tls_dir"
openssl req -x509 -new -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -days 2 \
  -subj "/CN=vibe test market data root" -keyout "$tls_dir/root.key" -out "$tls_dir/root.crt" \
  -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign" 2> /dev/null
openssl req -new -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes \
  -subj "/CN=127.0.0.1" -keyout "$tls_dir/server.key" -out "$tls_dir/server.csr" 2> /dev/null
printf '%s\n' "basicConstraints=critical,CA:FALSE" "keyUsage=critical,digitalSignature" \
  "extendedKeyUsage=serverAuth" "subjectAltName=IP:127.0.0.1" > "$tls_dir/server.ext"
openssl x509 -req -in "$tls_dir/server.csr" -CA "$tls_dir/root.crt" -CAkey "$tls_dir/root.key" \
  -CAcreateserial -days 2 -extfile "$tls_dir/server.ext" -out "$tls_dir/server.crt" 2> /dev/null
docker cp "$tls_dir/server.crt" "$container:/var/lib/postgresql/server.crt" > /dev/null
docker cp "$tls_dir/server.key" "$container:/var/lib/postgresql/server.key" > /dev/null
docker exec "$container" sh -c 'chown postgres:postgres /var/lib/postgresql/server.crt /var/lib/postgresql/server.key && chmod 600 /var/lib/postgresql/server.key'
# First match wins, so this line goes above the image's own `host all all all scram-sha-256`.
docker exec "$container" sh -c 'hba=/var/lib/postgresql/data/pg_hba.conf && { echo "hostnossl all vibe_test_role_market_data_tls_only all reject"; cat "$hba"; } > "$hba.next" && cat "$hba.next" > "$hba" && rm "$hba.next"'
for setting in "ssl_cert_file = '/var/lib/postgresql/server.crt'" \
  "ssl_key_file = '/var/lib/postgresql/server.key'" "ssl = on"; do
  docker exec "$container" psql -v ON_ERROR_STOP=1 -U postgres -d postgres -c "ALTER SYSTEM SET $setting" > /dev/null
done
docker exec "$container" psql -v ON_ERROR_STOP=1 -U postgres -d postgres -Atqc "SELECT pg_catalog.pg_reload_conf()" > /dev/null
# A reload is asynchronous: wait until a TLS session is admitted, and fail here if none ever is.
tls_ready=""
for _ in $(seq 1 20); do
  tls_ready="$(docker exec --env PGPASSWORD="$admin_password" "$container" \
    psql "host=127.0.0.1 user=postgres dbname=postgres sslmode=require" -Atqc \
    "SELECT ssl FROM pg_catalog.pg_stat_ssl WHERE pid = pg_catalog.pg_backend_pid()" 2> /dev/null || true)"
  [[ "$tls_ready" == "t" ]] && break
  sleep 0.5
done

if [[ "$tls_ready" != "t" ]]; then
  echo "market-data bootstrap: ${container} never admitted a TLS session after ssl was turned on" >&2
  docker logs --tail 50 "$container" >&2 || true
  exit 1
fi
docker exec "$container" psql -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -c "CREATE ROLE vibe_test_role_market_data_owner LOGIN PASSWORD '$owner_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS"
docker exec "$container" psql -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -c "CREATE ROLE vibe_test_role_market_data_reader LOGIN PASSWORD '$reader_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS"
docker exec "$container" psql -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -c "CREATE ROLE vibe_test_role_market_data_tls_only LOGIN PASSWORD '$tls_only_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS"

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

  # Deployment Store Admission custody, from the deployment's own init script rather than a copy of
  # it: the same file provisions the custody schema, its two principals and their functions here.
  docker exec -i \
    --env POSTGRES_PASSWORD="$admin_password" \
    --env POSTGRES_HOST=127.0.0.1 \
    --env POSTGRES_DATABASE="$database" \
    --env DEPLOYMENT_STORE_PUBLISHER_DB_PASSWORD="$custody_publisher_password" \
    --env DEPLOYMENT_STORE_CUSTODIAN_DB_PASSWORD="$custody_custodian_password" \
    "$container" sh -s < "$repository_root/product/rd-workbench/postgres-init/20-deployment-store-custody.sh" > /dev/null

  # The admitted reader, from the deployment's own init script: the principal Store Admission
  # leases. The Owner's migration grants it the admitted read wrappers once a proof migrates.
  docker exec -i \
    --env POSTGRES_PASSWORD="$admin_password" \
    --env POSTGRES_HOST=127.0.0.1 \
    --env POSTGRES_DATABASE="$database" \
    --env MARKET_DATA_ADMITTED_READER_DB_PASSWORD="$admitted_reader_password" \
    "$container" sh -s < "$repository_root/product/rd-workbench/postgres-init/25-market-data-admitted-reader.sh" > /dev/null

  export MARKET_DATA_ADMIN_TEST_DATABASE_URL="postgres://postgres:$admin_password@127.0.0.1:$port/$database"
  export DEPLOYMENT_STORE_PUBLISHER_TEST_DATABASE_URL="postgres://deployment_store_publisher:$custody_publisher_password@127.0.0.1:$port/$database"
  export DEPLOYMENT_STORE_CUSTODIAN_TEST_DATABASE_URL="postgres://deployment_store_custodian:$custody_custodian_password@127.0.0.1:$port/$database"
  export MARKET_DATA_OWNER_TEST_DATABASE_URL="postgres://vibe_test_role_market_data_owner:$owner_password@127.0.0.1:$port/$database"
  export MARKET_DATA_READER_TEST_DATABASE_URL="postgres://vibe_test_role_market_data_reader:$reader_password@127.0.0.1:$port/$database"
  export MARKET_DATA_ADMITTED_READER_TEST_DATABASE_URL="postgres://market_data_admitted_reader:$admitted_reader_password@127.0.0.1:$port/$database"
  export MARKET_DATA_TLS_ONLY_TEST_DATABASE_URL="postgres://vibe_test_role_market_data_tls_only:$tls_only_password@127.0.0.1:$port/$database"
  export MARKET_DATA_TLS_ROOT_CERTIFICATE_FILE="$tls_dir/root.crt"
  export MARKET_DATA_TLS_SERVER_CERTIFICATE_FILE="$tls_dir/server.crt"
  export VIBE_POSTGRES_TEST_DATABASE_NAME="$database"
  export VIBE_POSTGRES_TEST_INSTANCE_MARKER="$marker"
}

rm -rf -- "$proof_record_dir"
mkdir -p -- "$proof_record_dir"
# One ordinal across both lists: each proof still gets a database of its own, and the guard below
# walks every database either list materialized.
readonly all_market_data_proofs=(
  "${market_data_owner_postgres_tests[@]}"
  "${market_data_owner_postgres_sealed_acceptance_tests[@]}"
  "${market_data_owner_postgres_integration_tests[@]}"
)
readonly plain_proof_count="${#market_data_owner_postgres_tests[@]}"
readonly library_proof_count=$((plain_proof_count + ${#market_data_owner_postgres_sealed_acceptance_tests[@]}))
ordinal=0
for proof in "${all_market_data_proofs[@]}"; do
  ordinal=$((ordinal + 1))
  feature_args=()
  target_args=(--lib)
  proof_env=()
  test_selection="$proof"

  if [[ "$ordinal" -gt "$library_proof_count" ]]; then
    target_args=(--test "${proof%%::*}")
    test_selection="${proof#*::}"
  elif [[ "$ordinal" -gt "$plain_proof_count" ]]; then
    feature_args=(--features sealed-strategy-input-acceptance)
  fi
  arm_chain_entry_watchdog "$proof_wall_clock_seconds" \
    "$(printf '%s/%03d.timeout' "$proof_record_dir" "$ordinal")" \
    "market-data proof ${ordinal}/${#all_market_data_proofs[@]} (${proof})"
  provision_database "${database_prefix}_${ordinal}" "${marker_prefix}-${ordinal}"

  # Selection runs under nextest, not `cargo test --exact`, because the two differ on the case that
  # matters: a name that no longer exists. `cargo test --exact missing_name` prints `0 passed` and
  # exits 0, so renaming a proof would leave this gate green while running nothing at all. nextest
  # refuses an empty selection with `error: no tests to run` and a non-zero exit, which makes the
  # gate fail closed by construction rather than by a wrapper someone has to remember to keep.
  if [[ "$ordinal" -gt "$library_proof_count" ]]; then
    proof_env=("MARKET_DATA_OWNER_DATABASE_URL=${MARKET_DATA_OWNER_TEST_DATABASE_URL}")
  fi
  set +e
  env ${proof_env[@]+"${proof_env[@]}"} cargo nextest run \
    --manifest-path crates/data/Cargo.toml \
    "${target_args[@]}" \
    --cargo-profile "${CARGO_CI_PROFILE:-nextest}" \
    --run-ignored all \
    ${feature_args[@]+"${feature_args[@]}"} \
    -E "test(=${test_selection})"
  test_status=$?
  set -e
  disarm_chain_entry_watchdog

  if [[ "$test_status" -ne 0 ]]; then
    echo "market-data proof ${ordinal}/${#all_market_data_proofs[@]} failed: ${proof}" >&2
    echo "  a non-zero exit here is either a failing proof or a selection that matched nothing;" >&2
    echo "  nextest prints 'error: no tests to run' for the second, which means the name is stale" >&2
    exit "$test_status"
  fi
done

# Every SECURITY DEFINER routine, in every database the chain materialized, must search pg_temp last
# and name no schema another role can create in; scripts/ci/check-security-definer-search-path.sql
# holds the rule, and no routine is exempt from it.
guard_databases=(postgres)
for ((guard_ordinal = 1; guard_ordinal <= ${#all_market_data_proofs[@]}; guard_ordinal++)); do
  guard_databases+=("${database_prefix}_${guard_ordinal}")
done
bash "$repository_root/scripts/ci/run-security-definer-guard.bash" "$container" "${guard_databases[@]}"

exit 0
