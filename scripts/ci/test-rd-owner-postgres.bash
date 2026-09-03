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
  'vibe-strategy-factory|exploratory_replay_request_owner|origin_current_replay_table_renames_with_exact_v1_v2_read_continuity'
  'vibe-strategy-factory|vibe_strategy_factory|replay_policy_catalog_postgres_v2::postgres_tests::catalog_admin_and_family_formation_are_atomic_and_fail_closed'
  'vibe-strategy-factory|vibe_strategy_factory|artifact_build_postgres::postgres_freshness_tests::legacy_prepared_drain_is_atomic_idempotent_and_read_only'
  'vibe-strategy-factory|vibe_strategy_factory|product_edge_postgres::tests::fresh_rd_owner_existing_custody_validates_after_migration'
  'vibe-strategy-factory|vibe_strategy_factory|product_edge_postgres::tests::partial_sealed_non_anchor_objects_fail_before_ddl'
  'vibe-strategy-factory|develop_composer_owner_v2|durable_owner_is_atomic_restart_exact_and_fail_closed'
  'vibe-strategy-factory|develop_composer_postgres_v2|composer_startup_rejects_same_named_database_on_a_distinct_cluster'
  'vibe-strategy-factory|develop_composer_postgres_v2|composer_post_start_writer_reconnection_to_distinct_cluster_fails_before_write'
  'vibe-strategy-factory-rd-owner-api|rd_owner_api_main|tests::composer_read_startup_rejects_corrupt_index_options'
  'vibe-strategy-factory|source_intake|postgres_source_invocation_lifecycle_is_canonical_once_only_and_acl_sealed'
  'vibe-strategy-factory-rd-owner-api|rd_owner_api_main|tests::same_identity_started_retry_returns_http_ok_with_exact_custody_once'
  'vibe-product-edge|vibe_product_edge|postgres::tests::genesis_admission_claim_cutover_and_revocation_are_canonical'
  'vibe-product-edge|vibe_product_edge|postgres::tests::expired_manifest_recovery_rejoins_across_owners_and_preserves_old_rows'
  'vibe-strategy-factory|exploratory_replay_request_owner|frozen_exploratory_replay_request_is_sealed_for_canonical_backtest_owner'
  'vibe-strategy-factory|exploratory_replay_request_owner|replay_at_or_after_valid_through_writes_no_frozen_row_or_outbox'
  'vibe-strategy-factory|source_intake|postgres_readback_rejects_tampered_raw_payload'
  'vibe-strategy-factory|vibe_strategy_factory|artifact_build_postgres::postgres_freshness_tests::specialized_artifact_admission_rechecks_locked_rd_view_at_final_cut'
  'vibe-product-edge|vibe_product_edge|postgres::tests::expired_manifest_recovery_sidecars_reject_unknown_constraints_without_catalog_mutation'
)
readonly nextest_graph_args=(
  --locked
  --package vibe-strategy-factory
  --package vibe-strategy-factory-rd-owner-api
  --package vibe-product-edge
  --lib
  --tests
)
# The incoming Makefile union also contains workspace-root features that none of
# the three selected packages expose. Keep the archive projection package-scoped.
readonly nextest_archive_features='vibe-strategy-factory-rd-owner-api/sealed-develop-composer-acceptance'
readonly nextest_execution_args=(--fail-fast --run-ignored ignored-only)

check_nextest_graph_contract() {
  if rg -n '^[[:space:]]*cargo[[:space:]]+test([[:space:]]|$)' "${BASH_SOURCE[0]}"; then
    echo "ERROR: isolated PostgreSQL tests must use the shared nextest graph." >&2
    return 1
  fi
  if [[ "${#rd_owner_postgres_tests[@]}" -ne 19 ]]; then
    echo "ERROR: isolated PostgreSQL test selection must retain all nineteen ordered runtime and migration tests." >&2
    return 1
  fi
  if [[ "${rd_owner_postgres_tests[0]}" != *'|legacy_replay_table_is_preserved_while_current_custody_commits_and_reads_back' ]] ||
    [[ "${rd_owner_postgres_tests[1]}" != *'|origin_current_replay_table_renames_with_exact_v1_v2_read_continuity' ]] ||
    [[ "${rd_owner_postgres_tests[2]}" != *'|replay_policy_catalog_postgres_v2::postgres_tests::catalog_admin_and_family_formation_are_atomic_and_fail_closed' ]] ||
    [[ "${rd_owner_postgres_tests[5]}" != *'|product_edge_postgres::tests::partial_sealed_non_anchor_objects_fail_before_ddl' ]] ||
    [[ "${rd_owner_postgres_tests[7]}" != *'|composer_startup_rejects_same_named_database_on_a_distinct_cluster' ]] ||
    [[ "${rd_owner_postgres_tests[8]}" != *'|composer_post_start_writer_reconnection_to_distinct_cluster_fails_before_write' ]] ||
    [[ "${rd_owner_postgres_tests[9]}" != *'|tests::composer_read_startup_rejects_corrupt_index_options' ]] ||
    [[ "${rd_owner_postgres_tests[13]}" != *'|postgres::tests::expired_manifest_recovery_rejoins_across_owners_and_preserves_old_rows' ]] ||
    [[ "${rd_owner_postgres_tests[16]}" != *'|postgres_readback_rejects_tampered_raw_payload' ]] ||
    [[ "${rd_owner_postgres_tests[17]}" != *'|artifact_build_postgres::postgres_freshness_tests::specialized_artifact_admission_rechecks_locked_rd_view_at_final_cut' ]] ||
    [[ "${rd_owner_postgres_tests[18]}" != *'|postgres::tests::expired_manifest_recovery_sidecars_reject_unknown_constraints_without_catalog_mutation' ]]; then
    echo "ERROR: isolated PostgreSQL test ordering must remain fresh-first and poison-last." >&2
    return 1
  fi
  if [[ "${nextest_graph_args[*]}" != '--locked --package vibe-strategy-factory --package vibe-strategy-factory-rd-owner-api --package vibe-product-edge --lib --tests' ]] ||
    [[ "$nextest_archive_features" != 'vibe-strategy-factory-rd-owner-api/sealed-develop-composer-acceptance' ]] ||
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
    'RUST_TEST_EXTRA_FEATURES: >-\n[[:space:]]+capnp,hypersync,vibe-serialization/sbe,vibe-infrastructure/postgres,\n[[:space:]]+vibe-strategy-factory-rd-owner-api/sealed-develop-composer-acceptance' \
    "$repository_root/.github/workflows/rd-owner-postgres.yml"; then
    echo "ERROR: rd-owner-postgres workflow must define sealed-develop-composer-acceptance feature union." >&2
    return 1
  fi
  if ! rg -n 'EXTRA_FEATURES="\$\{RUST_TEST_EXTRA_FEATURES\}"' \
    "$repository_root/.github/workflows/rd-owner-postgres.yml" > /dev/null; then
    echo "ERROR: rd-owner-postgres workflow must pass RUST_TEST_EXTRA_FEATURES to the isolated test graph." >&2
    return 1
  fi
  if ! rg -Uq \
    'cargo nextest archive.*\n[[:space:]]+"\$\{nextest_graph_args\[@\]\}".*\n[[:space:]]+--features "\$nextest_archive_features"' \
    "${BASH_SOURCE[0]}"; then
    echo "ERROR: nextest archive must compile the exact selected-package feature projection." >&2
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

check_legacy_replay_fault_function_body() {
  local repository_root
  repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
  python3 - "${BASH_SOURCE[0]}" "$repository_root/crates/testkit/src/postgres.rs" << 'PY'
from hashlib import sha256
from pathlib import Path
import re
import sys

script = Path(sys.argv[1]).read_text(encoding="utf-8")
rust = Path(sys.argv[2]).read_text(encoding="utf-8")
body_match = re.search(
    r"CREATE FUNCTION vibe_test_legacy_replay_fault\.create_duplicate_current_candidate_v1\("
    r".*?AS \$function\$(.*?)\$function\$;",
    script,
    re.DOTALL,
)
digest_match = re.search(
    r'LEGACY_REPLAY_DUPLICATE_FUNCTION_SOURCE_SHA256_V1: &str =\s*"([0-9a-f]{64})";',
    rust,
)
if body_match is None or digest_match is None:
    raise SystemExit("ERROR: legacy Replay duplicate function source identity is unavailable")
actual = sha256(body_match.group(1).encode("utf-8")).hexdigest()
if actual != digest_match.group(1):
    raise SystemExit("ERROR: legacy Replay duplicate function body changed without admission identity")
PY
}

check_replay_policy_catalog_fault_function_bodies() {
  local repository_root
  repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
  python3 - "${BASH_SOURCE[0]}" "$repository_root/crates/testkit/src/postgres.rs" << 'PY'
from hashlib import sha256
from pathlib import Path
import re
import sys

script = Path(sys.argv[1]).read_text(encoding="utf-8")
rust = Path(sys.argv[2]).read_text(encoding="utf-8")
functions = {
    "acquire_v1": "REPLAY_POLICY_CATALOG_FAULT_ACQUIRE_FUNCTION_SOURCE_SHA256_V1",
    "release_v1": "REPLAY_POLICY_CATALOG_FAULT_RELEASE_FUNCTION_SOURCE_SHA256_V1",
    "inject_third_party_owner_edge_v1":
        "REPLAY_POLICY_CATALOG_FAULT_INJECT_MEMBERSHIP_FUNCTION_SOURCE_SHA256_V1",
    "restore_third_party_owner_edge_v1":
        "REPLAY_POLICY_CATALOG_FAULT_RESTORE_MEMBERSHIP_FUNCTION_SOURCE_SHA256_V1",
}

for function_name, constant_name in functions.items():
    body_match = re.search(
        rf"CREATE FUNCTION vibe_test_replay_policy_catalog_fault\.{function_name}\("
        r".*?AS \$function\$(.*?)\$function\$;",
        script,
        re.DOTALL,
    )
    digest_match = re.search(
        rf'{constant_name}: &str =\s*"([0-9a-f]{{64}})";',
        rust,
    )
    if body_match is None or digest_match is None:
        raise SystemExit(
            f"ERROR: Replay Policy Catalog fault source identity is unavailable: {function_name}"
        )
    actual = sha256(body_match.group(1).encode("utf-8")).hexdigest()
    if actual != digest_match.group(1):
        raise SystemExit(
            f"ERROR: Replay Policy Catalog fault body changed without admission identity: {function_name}"
        )
PY
}

check_legacy_migration_lease_function_bodies() {
  local repository_root
  repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
  python3 - "${BASH_SOURCE[0]}" "$repository_root/crates/testkit/src/postgres.rs" << 'PY'
from hashlib import sha256
from pathlib import Path
import re
import sys

script = Path(sys.argv[1]).read_text(encoding="utf-8")
rust = Path(sys.argv[2]).read_text(encoding="utf-8")
functions = {
    "acquire_v1": "LEGACY_MIGRATION_ACQUIRE_FUNCTION_SOURCE_SHA256_V1",
    "release_v1": "LEGACY_MIGRATION_RELEASE_FUNCTION_SOURCE_SHA256_V1",
}
for function_name, constant_name in functions.items():
    body_match = re.search(
        rf"CREATE FUNCTION vibe_test_legacy_migration_lease\.{function_name}\("
        r".*?AS \$function\$(.*?)\$function\$;",
        script,
        re.DOTALL,
    )
    digest_match = re.search(
        rf'{constant_name}: &str =\s*"([0-9a-f]{{64}})";',
        rust,
    )
    if body_match is None or digest_match is None:
        raise SystemExit(
            f"ERROR: legacy migration lease source identity is unavailable: {function_name}"
        )
    actual = sha256(body_match.group(1).encode("utf-8")).hexdigest()
    if actual != digest_match.group(1):
        raise SystemExit(
            f"ERROR: legacy migration lease body changed without admission identity: {function_name}"
        )

test_loop = script.rsplit(
    "# The first two filters exercise explicit legacy/origin migration", 1
)[1]
migration_loop = test_loop
if "GRANT CREATE ON SCHEMA public TO rd_owner;" in migration_loop:
    raise SystemExit("ERROR: legacy migration loop exposes raw public CREATE authority")
if "GRANT rd_custodian TO rd_owner;" in migration_loop:
    raise SystemExit("ERROR: legacy migration loop exposes raw custodian membership")
release = "vibe_test_legacy_migration_lease.release_v1(:'test_marker',:'lease_identity')"
if release not in migration_loop or migration_loop.index(release) > migration_loop.index('if [[ "$test_passed" != true ]]'):
    raise SystemExit("ERROR: legacy migration lease is not released before test failure exits")
grant_connect = 'GRANT CONNECT ON DATABASE :"migration_database" TO vibe_test_legacy_migration_caller;'
revoke_connect = 'REVOKE CONNECT ON DATABASE :"migration_database" FROM vibe_test_legacy_migration_caller;'
if migration_loop.count(grant_connect) != 1 or migration_loop.count(revoke_connect) != 1:
    raise SystemExit("ERROR: legacy migration caller CONNECT window is not unique")
if not (
    migration_loop.index(grant_connect) < migration_loop.index("test_passed=false")
    and migration_loop.index(release) < migration_loop.index(revoke_connect)
    and migration_loop.index(revoke_connect)
    < migration_loop.index('run_authority_migration_for_database "$migration_database"')
):
    raise SystemExit("ERROR: legacy migration caller CONNECT window is not bounded by release")

normalization_start = script.find(
    '\nreadonly legacy_normalization_lease_identity='
)
test_provision = script.find(
    '\nprovision_owner_schemas "$test_database"\n', normalization_start
)
origin_provision = script.find(
    '\nprovision_owner_schemas "$origin_current_database"\n', test_provision
)
production_migration = script.find(
    '\nrun_authority_migration_for_database "$test_database"\n', origin_provision
)
if min(normalization_start, test_provision, origin_provision, production_migration) < 0:
    raise SystemExit("ERROR: isolated legacy normalization lifecycle is unavailable")

normalization = script[normalization_start:test_provision]
ordered_normalization = (
    'legacy-replay-migration:${test_marker}:pre-authority-normalization:v2',
    'legacy_normalization_cleanup_armed=true',
    'CREATE DATABASE :"legacy_database" OWNER rd_database_owner;',
    'CREATE SCHEMA vibe_test_legacy_normalization AUTHORIZATION postgres;',
    "VALUES (true,:'test_marker',:'legacy_database');",
    'CREATE SCHEMA rd_owner_api AUTHORIZATION rd_owner;',
    'CREATE TABLE public.rd_exploratory_replay_request_custody_v1 (',
    "'internal-continuity-replay-v1'",
    'CREATE SCHEMA vibe_test_legacy_normalization_cluster AUTHORIZATION postgres;',
    "VALUES (true,:'test_marker','READY');",
    'CREATE FUNCTION vibe_test_legacy_normalization_cluster.acquire_v1(',
    "OR state_row.phase<>'READY'",
    "EXECUTE 'GRANT rd_custodian TO rd_owner WITH ADMIN FALSE, INHERIT TRUE, SET TRUE';",
    "SET phase='LEASED',target_database=requested_target,",
    'CREATE FUNCTION vibe_test_legacy_normalization_cluster.release_v1(',
    "EXECUTE 'REVOKE rd_custodian FROM rd_owner';",
    "SET phase='READY',target_database=NULL,lease_identity=NULL,",
    'REVOKE CONNECT ON DATABASE :"test_database" FROM rd_owner;',
    'REVOKE CONNECT ON DATABASE :"origin_current_database" FROM rd_owner;',
    'SELECT vibe_test_legacy_normalization_cluster.acquire_v1(',
    'GRANT CREATE ON SCHEMA public TO rd_owner;',
    'legacy_normalization_concurrent_rejection=0',
    'RD_OWNER_FRESH_TEST_DATABASE_URL="postgresql://rd_owner:${test_password}@${postgres_host}:${postgres_port}/${legacy_normalization_database}"',
    'legacy_normalization_status="$?"',
    'REVOKE CREATE ON SCHEMA public FROM rd_owner;',
    'SELECT vibe_test_legacy_normalization_cluster.release_v1(',
    'GRANT CONNECT ON DATABASE :"test_database" TO rd_owner;',
    'GRANT CONNECT ON DATABASE :"origin_current_database" TO rd_owner;',
    'DROP DATABASE :"legacy_database" WITH (FORCE);',
    'DROP SCHEMA vibe_test_legacy_normalization_cluster CASCADE;',
    'if [[ "$legacy_normalization_status" -ne 0 ]]',
)
position = -1
for required in ordered_normalization:
    position = normalization.find(required, position + 1)
    if position < 0:
        raise SystemExit(
            f"ERROR: isolated legacy normalization lifecycle is missing or reordered: {required}"
        )

if 'WITH TEMPLATE' in normalization or 'TEMPLATE :' in normalization:
    raise SystemExit("ERROR: legacy normalization database must not be cloned")
if normalization.count('CREATE DATABASE :"legacy_database"') != 1:
    raise SystemExit("ERROR: legacy normalization database creation is not unique")
if normalization.count('DROP DATABASE :"legacy_database" WITH (FORCE)') != 1:
    raise SystemExit("ERROR: legacy normalization database cleanup is not unique")
cleanup_function = script.find("\nrecover_legacy_normalization_topology() {")
cleanup_call = script.find(
    "\n  if ! recover_legacy_normalization_topology; then",
    cleanup_function,
)
top_level_trap = script.find("\ntrap cleanup EXIT", cleanup_call)
cleanup_arm = script.find(
    "\nlegacy_normalization_cleanup_armed=true", normalization_start
)
first_database_effect = script.find(
    'CREATE DATABASE :"legacy_database"', cleanup_arm
)
cleanup_disarm = script.find(
    "\nlegacy_normalization_cleanup_armed=false", first_database_effect
)
if min(
    cleanup_function, cleanup_call, top_level_trap, cleanup_arm,
    first_database_effect, cleanup_disarm,
) < 0 or not (
    cleanup_function < cleanup_call < top_level_trap
    < cleanup_arm < first_database_effect < cleanup_disarm
):
    raise SystemExit(
        "ERROR: legacy normalization recovery must be armed before its first effect"
    )
recovery_body = script[cleanup_function:cleanup_call]
for recovery_step in (
    'REVOKE CREATE ON SCHEMA public FROM rd_owner;',
    'REVOKE rd_custodian FROM rd_owner;',
    "'GRANT CONNECT ON DATABASE %I TO rd_owner'",
    'DROP DATABASE IF EXISTS :"legacy_database" WITH (FORCE);',
    'DROP SCHEMA IF EXISTS vibe_test_legacy_normalization_cluster CASCADE;',
):
    if recovery_step not in recovery_body:
        raise SystemExit(
            f"ERROR: legacy normalization recovery omits: {recovery_step}"
        )
for bounded_sql in (recovery_body, normalization):
    if "pg_catalog.extract(" in bounded_sql:
        raise SystemExit(
            "ERROR: PostgreSQL special EXTRACT syntax must not be schema-qualified"
        )
    for dollar_body in re.findall(
        r"\$[A-Za-z_][A-Za-z0-9_]*\$(.*?)\$[A-Za-z_][A-Za-z0-9_]*\$",
        bounded_sql,
        re.DOTALL,
    ):
        if re.search(r":'[A-Za-z_][A-Za-z0-9_]*'", dollar_body):
            raise SystemExit(
                "ERROR: psql variables are not expanded inside dollar-quoted SQL"
            )
if re.search(r"--command[^\n]*:'[A-Za-z_][A-Za-z0-9_]*'", recovery_body):
    raise SystemExit("ERROR: psql --command does not expand recovery variables")
if normalization.count(
    'SELECT vibe_test_legacy_normalization_cluster.acquire_v1('
) != 2:
    raise SystemExit("ERROR: cluster lease must have one acquire and one concurrent rejection")
if normalization.count(
    'SELECT vibe_test_legacy_normalization_cluster.release_v1('
) != 1:
    raise SystemExit("ERROR: cluster lease release is not unique")
if normalization.count('REVOKE CREATE ON SCHEMA public FROM rd_owner;') != 1:
    raise SystemExit("ERROR: target CREATE release is not unique")
if normalization.index(
    'REVOKE CREATE ON SCHEMA public FROM rd_owner;'
) > normalization.index(
    'SELECT vibe_test_legacy_normalization_cluster.release_v1('
):
    raise SystemExit("ERROR: target CREATE must be released before cluster membership")
if 'QUALIFICATION_WRITER_FRESH_TEST_DATABASE_URL=' in normalization:
    raise SystemExit("ERROR: standalone legacy normalization does not use Qualification storage")
if '/${test_database}"' in normalization:
    raise SystemExit("ERROR: legacy normalization must not target the shared authority database")

shared_fixture_start = script.find(
    "\nCREATE ROLE surprise_replay_grantee NOLOGIN;"
)
if shared_fixture_start < 0:
    raise SystemExit("ERROR: shared fixture boundary is unavailable")
shared_fixture = script[shared_fixture_start:normalization_start]
if "CREATE TABLE public.rd_exploratory_replay_request_custody_v1 (" in shared_fixture:
    raise SystemExit("ERROR: shared database is pre-seeded with legacy R&D custody")
if not (
    normalization_start < test_provision < origin_provision < production_migration
):
    raise SystemExit(
        "ERROR: isolated legacy normalization must finish before shared production migration"
    )
PY
}

check_migration_authority_boundary() {
  local repository_root
  local authority_migration
  repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
  authority_migration="$repository_root/product/rd-workbench/postgres-init/10-migrate-authority-custody.sh"
  local required_rd_storage_object
  for required_rd_storage_object in \
    "CREATE TABLE IF NOT EXISTS rd_research_request_receipts_v1" \
    "CREATE TABLE IF NOT EXISTS rd_independence_bases_v1" \
    "CREATE TABLE IF NOT EXISTS rd_independence_basis_admissions_v1" \
    "CREATE TABLE IF NOT EXISTS rd_independence_basis_heads_v1" \
    "rd_sealed_exploratory_replay_requests_v1 (" \
    "CREATE TABLE IF NOT EXISTS rd_complex_strategy_develop_evaluations_v1" \
    "CREATE TABLE IF NOT EXISTS rd_complex_strategy_develop_evaluation_heads_v1" \
    "CREATE TABLE IF NOT EXISTS rd_artifact_build_attempts_v1" \
    "CREATE TABLE IF NOT EXISTS rd_strategy_artifacts_v1" \
    "CREATE OR REPLACE FUNCTION rd_owner_api.peek_current_research_for_artifact_v1" \
    "CREATE OR REPLACE FUNCTION rd_owner_api.lock_current_research_for_artifact_v1" \
    "CREATE OR REPLACE FUNCTION rd_owner_api.lock_artifact_invocation_reservation_v1" \
    "CREATE FUNCTION rd_owner_api.verify_exploratory_replay_request_internal_v1" \
    "CREATE FUNCTION rd_owner_api.lock_exploratory_replay_request_v1" \
    "CREATE FUNCTION rd_owner_api.verify_exploratory_replay_request_internal_v2" \
    "CREATE FUNCTION rd_owner_api.resolve_exploratory_replay_request_v2" \
    "CREATE FUNCTION rd_owner_api.lock_exploratory_replay_request_v2"; do
    if ! rg -Fq "$required_rd_storage_object" "$authority_migration"; then
      echo "ERROR: production authority migration omits required R&D storage: $required_rd_storage_object" >&2
      return 1
    fi
  done
  if rg -Fq 'CREATE UNIQUE INDEX IF NOT EXISTS rd_research_intent_identity_v1' "$authority_migration" ||
    rg -Fq 'CREATE UNIQUE INDEX IF NOT EXISTS rd_complex_strategy_develop_evaluation_successors_v1' "$authority_migration" ||
    ! rg -Fq 'R&D research intent index manifest mismatch' "$authority_migration" ||
    ! rg -Fq 'R&D complex successor index manifest mismatch' "$authority_migration" ||
    ! rg -Fq "AND index_fact.indisvalid AND index_fact.indisready AND index_fact.indislive" "$authority_migration" ||
    ! rg -Fq "AND index_fact.indnkeyatts=1 AND index_fact.indnatts=1" "$authority_migration"; then
    echo "ERROR: production authority migration canonical index admission changed." >&2
    return 1
  fi
  if ! rg -Fq "test(=rd_owner_schema_is_provisioned_before_runtime_connections)" "${BASH_SOURCE[0]}" ||
    ! rg -Fq 'R&D research receipt predecessor manifest mismatch' "$authority_migration" ||
    ! rg -Fq 'Artifact storage partial predecessor manifest mismatch' "$authority_migration" ||
    ! rg -Fq 'Artifact storage final manifest mismatch' "$authority_migration" ||
    ! rg -Fq 'required R&D storage column manifest mismatch' "$authority_migration" ||
    ! rg -Fq 'required R&D storage constraint manifest mismatch' "$authority_migration" ||
    ! rg -Uq 'ALTER TABLE rd_research_request_receipts_v1 ADD COLUMN IF NOT EXISTS request_json JSONB;(?s:.*?)ALTER TABLE rd_research_request_receipts_v1 ADD COLUMN IF NOT EXISTS artifact_evidence_digest TEXT;(?s:.*?)ALTER TABLE rd_research_request_receipts_v1 ADD COLUMN IF NOT EXISTS artifact_evidence_json JSONB;(?s:.*?)ALTER TABLE rd_research_request_receipts_v1 ADD COLUMN IF NOT EXISTS source_ancestry_locator_json JSONB;(?s:.*?)ALTER TABLE rd_research_request_receipts_v1 ADD COLUMN IF NOT EXISTS source_ancestry_evidence_digest TEXT;' "$authority_migration" ||
    ! rg -Fq "test(=product_edge_schema_is_provisioned_before_runtime_connections)" "${BASH_SOURCE[0]}" ||
    ! rg -Fq "test(=artifact_build_postgres::postgres_freshness_tests::artifact_schema_is_provisioned_by_topology_admin)" "${BASH_SOURCE[0]}" ||
    ! rg -Fq "test(=product_edge_postgres::tests::runtime_diagnostic_manifest_is_empty_for_existing_custody)" "${BASH_SOURCE[0]}" ||
    ! rg -Fq "test(=product_edge_postgres::tests::runtime_diagnostic_manifest_locates_nonowner_sealed_column_acl)" "${BASH_SOURCE[0]}" ||
    ! rg -Fq "test(=tests::runtime_rd_owner_rejects_nonowner_sealed_column_acl)" "${BASH_SOURCE[0]}" ||
    ! rg -Fq "test(=tests::runtime_storage_connectors_start_without_migration_authority)" "${BASH_SOURCE[0]}" ||
    ! rg -Fq 'GRANT SELECT(request_identity) ON TABLE public.rd_sealed_exploratory_replay_requests_v1' "${BASH_SOURCE[0]}" ||
    ! rg -Fq 'REVOKE SELECT(request_identity) ON TABLE public.rd_sealed_exploratory_replay_requests_v1' "${BASH_SOURCE[0]}" ||
    ! rg -Fq 'return "$negative_runtime_status"' "${BASH_SOURCE[0]}" ||
    ! rg -Uq 'verify_runtime_startup\(\) \{(?s:.*?)-E "\$runtime_diagnostic_filter"(?s:.*?)artifact_runtime_manifest_failures "\$fixture_database"(?s:.*?)-E "\$runtime_startup_filter"(?s:.*?)\n\}' "${BASH_SOURCE[0]}" ||
    [[ "$(rg -Fc 'verify_runtime_startup "$test_database"' "${BASH_SOURCE[0]}")" -ne 3 ]] ||
    ! rg -Uq 'verify_runtime_startup "\$test_database"\nnegative_runtime_status=0(?s:.*?)if verify_sealed_column_acl_fails_closed "\$test_database"(?s:.*?)if verify_runtime_startup "\$test_database"' "${BASH_SOURCE[0]}" ||
    ! rg -Fq "wait_for_primary_after_failed_authority_migration" "${BASH_SOURCE[0]}" ||
    ! rg -Fq "SELECT NOT pg_catalog.pg_is_in_recovery()" "${BASH_SOURCE[0]}" ||
    ! rg -Fq 'return "$migration_status"' "${BASH_SOURCE[0]}" ||
    ! rg -Fq "CREATE ROLE rd_fact_writer LOGIN INHERIT" "$authority_migration" ||
    ! rg -Fq "ALTER ROLE rd_fact_writer LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS" "$authority_migration" ||
    ! rg -Fq "role.rolname='rd_fact_writer' AND role.rolcanlogin AND role.rolinherit" "$authority_migration" ||
    ! rg -Fq 'ALTER ROLE rd_fact_writer NOINHERIT;' "${BASH_SOURCE[0]}" ||
    ! rg -Fq 'Source Intake/legacy drain topology is partial' "$authority_migration" ||
    ! rg -Fq 'sealed relation schema or ACL drift' "$authority_migration" ||
    ! rg -Fq "tablename NOT IN ('rd_source_intake_bindings_v1','rd_source_intake_receipts_v1','rd_source_raw_payloads_v1','rd_source_raw_receipt_links_v1','rd_research_source_provenance_v1','rd_source_candidates_v1','rd_legacy_prepared_attempt_drain_receipts_v1','rd_exploratory_replay_requests_v1')" "$authority_migration" ||
    ! rg -Fq 'legacy exploratory Replay preservation topology mismatch' "$authority_migration" ||
    ! rg -Fq 'AND relation.relacl IS NULL' "$authority_migration" ||
    [[ "$(rg -Fc "AND tablename <> 'rd_exploratory_replay_requests_v1'" "$authority_migration")" -ne 1 ]] ||
    ! rg -Fq 'trigger_fact.tgrelid=relation.oid AND NOT trigger_fact.tgisinternal' "$authority_migration" ||
    [[ "$(rg -Fc "relation.relname<>'rd_exploratory_replay_requests_v1'" "$authority_migration")" -ne 2 ]] ||
    ! rg -Fq "('rd_owner_api.lock_source_intake_research_handoff_v1(text,text,text)',true,true,'v','u',ARRAY['search_path=pg_catalog, public, rd_owner_api, pg_temp']::text[],'890e336826ddcdf96d948b012c5ba32d')" "$authority_migration" ||
    ! rg -Fq "('public.rd_owner_reject_legacy_prepared_attempt_drain_mutation_v1()',false,false,'v','u',NULL::text[],'7e54a7158586a88841c26e8732a31e62')" "$authority_migration" ||
    ! rg -Fq 'Source Intake routine ownership, seal, or ACL manifest mismatch' "$authority_migration" ||
    ! rg -Fq 'product_edge_owner:EXECUTE:false' "$authority_migration" ||
    ! rg -Fq "EXECUTE pg_catalog.format('REVOKE EXECUTE ON FUNCTION %s FROM rd_owner',signature)" "$authority_migration" ||
    ! rg -Fq "EXECUTE pg_catalog.format('GRANT EXECUTE ON FUNCTION %s TO backtest_owner',signature)" "$authority_migration" ||
    ! rg -Fq 'GRANT SELECT, INSERT ON TABLE %I.%I TO rd_owner' "$authority_migration" ||
    ! rg -Fq 'lock_source_invocation_reservation_v1(text,text,text,text,text) TO product_edge_owner' "$authority_migration"; then
    echo "ERROR: bounded admin migration/runtime startup topology changed." >&2
    return 1
  fi
}

check_rd_owner_fresh_migration_lease() {
  python3 - "${BASH_SOURCE[0]}" << 'PY'
from pathlib import Path
import re
import sys

script = Path(sys.argv[1]).read_text(encoding="utf-8")
function_match = re.search(
    r"provision_owner_schemas\(\) \{(.*?)\n\}",
    script,
    re.DOTALL,
)
if function_match is None:
    raise SystemExit("ERROR: R&D fresh migration boundary is unavailable")
body = function_match.group(1)
ordered_contract = (
    "test(=rd_owner_schema_third_party_create_grant_fails_atomically)",
    "GRANT CREATE ON SCHEMA rd_owner_api TO surprise_replay_grantee;",
    "GRANT rd_custodian TO rd_owner\n"
    "  WITH ADMIN FALSE, INHERIT TRUE, SET TRUE;",
    "AND member.rolname='rd_owner'",
    "AND grantor.rolname='postgres' AND NOT membership.admin_option",
    "AND membership.inherit_option AND membership.set_option",
    "local rd_owner_test_status=0",
    'RD_OWNER_SEALED_TEST_DATABASE_URL="$rd_sealed_owner_url"',
    'RD_OWNER_FRESH_TEST_DATABASE_URL="$rd_fresh_owner_url"',
    'RD_OWNER_SCHEMA_LEASE_FAILURE_TEST_DATABASE_URL="$rd_schema_lease_failure_owner_url"',
    'rd_owner_test_status="$?"',
    "REVOKE rd_custodian FROM rd_owner;",
    "WHERE granted.rolname IN ('rd_custodian','rd_owner','rd_fact_writer')\n"
    "      OR member.rolname IN ('rd_custodian','rd_owner','rd_fact_writer')",
    "Replay Policy Catalog/R&D protected membership cleanup failed",
    'if [[ "$rd_owner_test_status" -ne 0 ]]; then',
    'return "$rd_owner_test_status"',
)
position = -1
for required in ordered_contract:
    next_position = body.find(required, position + 1)
    if next_position < 0:
        raise SystemExit(
            f"ERROR: R&D fresh migration lease contract is missing or reordered: {required}"
        )
    position = next_position
if body.count("GRANT rd_custodian TO rd_owner") != 1:
    raise SystemExit("ERROR: R&D fresh migration lease grant is not unique")
if body.count("REVOKE rd_custodian FROM rd_owner") != 1:
    raise SystemExit("ERROR: R&D fresh migration lease cleanup is not unique")
if body.count("GRANT CREATE ON SCHEMA rd_owner_api TO surprise_replay_grantee") != 1:
    raise SystemExit("ERROR: R&D schema ACL third-party negative is not unique")
PY
}

check_artifact_fresh_migration_lease() {
  python3 - "${BASH_SOURCE[0]}" << 'PY'
from pathlib import Path
import re
import sys

script = Path(sys.argv[1]).read_text(encoding="utf-8")
function_match = re.search(
    r"provision_owner_schemas\(\) \{(.*?)\n\}",
    script,
    re.DOTALL,
)
if function_match is None:
    raise SystemExit("ERROR: Artifact fresh migration boundary is unavailable")
body = function_match.group(1)
ordered_contract = (
    'local artifact_fresh_database="${fixture_database}_artifact_fresh"',
    'CREATE DATABASE :"artifact_fresh_database" OWNER rd_database_owner;',
    'GRANT CONNECT ON DATABASE :"artifact_fresh_database"\n'
    '  TO vibe_test_owner_topology_admin;',
    "CREATE SCHEMA rd_owner_api AUTHORIZATION rd_owner;",
    "GRANT CREATE ON SCHEMA public TO vibe_test_owner_topology_admin;",
    "GRANT USAGE ON SCHEMA rd_owner_api TO vibe_test_owner_topology_admin;",
    "GRANT CREATE ON SCHEMA rd_owner_api TO rd_custodian;",
    "GRANT rd_custodian TO vibe_test_owner_topology_admin\n"
    "  WITH ADMIN FALSE, INHERIT TRUE, SET TRUE;",
    "Artifact fresh migration lease topology mismatch",
    "local artifact_test_status=0",
    'RD_ARTIFACT_ADMIN_DATABASE_URL="$artifact_fresh_admin_url"',
    'artifact_test_status="$?"',
    "REVOKE CREATE ON SCHEMA public FROM vibe_test_owner_topology_admin;",
    "REVOKE USAGE ON SCHEMA rd_owner_api FROM vibe_test_owner_topology_admin;",
    "REVOKE CREATE ON SCHEMA rd_owner_api FROM rd_custodian;",
    "REVOKE rd_custodian FROM vibe_test_owner_topology_admin;",
    "Artifact fresh migration lease cleanup failed",
    'REVOKE CONNECT ON DATABASE :"artifact_fresh_database"\n'
    '  FROM vibe_test_owner_topology_admin;',
    'DROP DATABASE :"artifact_fresh_database" WITH (FORCE);',
    'if [[ "$artifact_test_status" -ne 0 ]]; then',
    'return "$artifact_test_status"',
)
position = -1
for required in ordered_contract:
    next_position = body.find(required, position + 1)
    if next_position < 0:
        raise SystemExit(
            f"ERROR: Artifact fresh migration lease contract is missing or reordered: {required}"
        )
    position = next_position
unique_contract = (
    'CREATE DATABASE :"artifact_fresh_database" OWNER rd_database_owner;',
    "GRANT CREATE ON SCHEMA public TO vibe_test_owner_topology_admin;",
    "GRANT USAGE ON SCHEMA rd_owner_api TO vibe_test_owner_topology_admin;",
    "GRANT CREATE ON SCHEMA rd_owner_api TO rd_custodian;",
    "GRANT rd_custodian TO vibe_test_owner_topology_admin",
    'RD_ARTIFACT_ADMIN_DATABASE_URL="$artifact_fresh_admin_url"',
    'artifact_test_status="$?"',
    "REVOKE CREATE ON SCHEMA public FROM vibe_test_owner_topology_admin;",
    "REVOKE USAGE ON SCHEMA rd_owner_api FROM vibe_test_owner_topology_admin;",
    "REVOKE CREATE ON SCHEMA rd_owner_api FROM rd_custodian;",
    "REVOKE rd_custodian FROM vibe_test_owner_topology_admin;",
    'DROP DATABASE :"artifact_fresh_database" WITH (FORCE);',
)
for required in unique_contract:
    if body.count(required) != 1:
        raise SystemExit(
            f"ERROR: Artifact fresh migration lease contract is not unique: {required}"
        )
PY
}

check_product_edge_fresh_migration_lease() {
  python3 - "${BASH_SOURCE[0]}" << 'PY'
from pathlib import Path
import re
import sys

script = Path(sys.argv[1]).read_text(encoding="utf-8")
function_match = re.search(
    r"provision_owner_schemas\(\) \{(.*?)\n\}",
    script,
    re.DOTALL,
)
if function_match is None:
    raise SystemExit("ERROR: Product Edge fresh migration boundary is unavailable")
body = function_match.group(1)
ordered_contract = (
    "BEGIN;\n"
    "GRANT product_edge_custodian TO vibe_test_owner_topology_admin\n"
    "  WITH ADMIN FALSE, INHERIT TRUE, SET TRUE;",
    "WHERE granted.rolname='product_edge_custodian'",
    "AND member.rolname='vibe_test_owner_topology_admin'",
    "AND grantor.rolname='postgres' AND NOT membership.admin_option",
    "AND membership.inherit_option AND membership.set_option",
    "$product_edge_migration_lease$;\nCOMMIT;",
    "local product_edge_test_status=0",
    'PRODUCT_EDGE_TEST_DATABASE_URL="$admin_url"',
    'product_edge_test_status="$?"',
    "BEGIN;\nREVOKE product_edge_custodian FROM vibe_test_owner_topology_admin;",
    "WHERE granted.rolname='product_edge_custodian'\n"
    "      OR member.rolname='product_edge_custodian'",
    "Product Edge custodian membership cleanup failed",
    "$product_edge_migration_cleanup$;\nCOMMIT;",
    'if [[ "$product_edge_test_status" -ne 0 ]]; then',
    'return "$product_edge_test_status"',
)
position = -1
for required in ordered_contract:
    next_position = body.find(required, position + 1)
    if next_position < 0:
        raise SystemExit(
            f"ERROR: Product Edge fresh migration lease contract is missing or reordered: {required}"
        )
    position = next_position
if body.count("GRANT product_edge_custodian TO vibe_test_owner_topology_admin") != 1:
    raise SystemExit("ERROR: Product Edge fresh migration lease grant is not unique")
if body.count("REVOKE product_edge_custodian FROM vibe_test_owner_topology_admin") != 1:
    raise SystemExit("ERROR: Product Edge fresh migration lease cleanup is not unique")
if body.count('PRODUCT_EDGE_TEST_DATABASE_URL="$admin_url"') != 1:
    raise SystemExit("ERROR: Product Edge fresh migration test is not unique")
if body.count('product_edge_test_status="$?"') != 1:
    raise SystemExit("ERROR: Product Edge fresh migration status capture is not unique")
if body.count(
    "WHERE granted.rolname='product_edge_custodian'\n"
    "     AND member.rolname='vibe_test_owner_topology_admin'"
) != 1:
    raise SystemExit("ERROR: Product Edge fresh migration lease readback is not unique")
if body.count("Product Edge custodian membership cleanup failed") != 1:
    raise SystemExit("ERROR: Product Edge fresh migration zero-edge proof is not unique")
PY
}

check_static_isolation
check_nextest_graph_contract
check_legacy_replay_fault_function_body
check_replay_policy_catalog_fault_function_bodies
check_legacy_migration_lease_function_bodies
check_migration_authority_boundary
check_rd_owner_fresh_migration_lease
check_artifact_fresh_migration_lease
check_product_edge_fresh_migration_lease
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
readonly rd_owner_postgres_features="${RD_OWNER_POSTGRES_FEATURES//[[:space:]]/}"
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
readonly origin_current_database="vibe_test_origin_current_${suffix//-/_}"
readonly legacy_normalization_database="${test_database}_rd_legacy"
readonly partial_sealed_database="vibe_test_partial_sealed_${suffix//-/_}"
readonly partial_sealed_routine_database="vibe_test_partial_sealed_routine_${suffix//-/_}"
readonly impersonator_container="vibe-rd-owner-impersonator-${suffix}"
readonly impersonator_volume="vibe-rd-owner-impersonator-${suffix}"
readonly impersonator_database="vibe_impersonator_${suffix//-/_}"
readonly primary_socket_dir="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/vibe-rd-owner-primary-socket-${suffix}"
readonly impersonator_socket_dir="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/vibe-rd-owner-impersonator-socket-${suffix}"
test_password="$(od -An -N24 -tx1 /dev/urandom | tr -d ' \n')"
readonly test_password
impersonator_password="$(od -An -N24 -tx1 /dev/urandom | tr -d ' \n')"
readonly impersonator_password
primary_socket_dir_created=false
impersonator_socket_dir_created=false
nextest_archive_dir=''
nextest_archive_file=''
legacy_normalization_cleanup_armed=false
readonly cleanup_docker_timeout_seconds=10

verify_docker_object_absent() {
  local object_type="$1"
  local object_name="$2"
  local listed_objects
  local -a list_command=(docker volume ls --format '{{.Name}}')
  if [[ "$object_type" == container ]]; then
    list_command=(docker container ls --all --format '{{.Names}}')
  fi

  if ! listed_objects="$(timeout -s KILL "$cleanup_docker_timeout_seconds" "${list_command[@]}")"; then
    echo "ERROR: cleanup could not verify ${object_type} ${object_name} absence." >&2
    return 1
  fi
  while IFS= read -r listed_object; do
    if [[ "$listed_object" == "$object_name" ]]; then
      echo "ERROR: cleanup left ${object_type} ${object_name} present." >&2
      return 1
    fi
  done <<< "$listed_objects"
}

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
    if timeout -s KILL "$cleanup_docker_timeout_seconds" "${remove_command[@]}" > /dev/null 2>&1; then
      break
    fi
    if verify_docker_object_absent "$object_type" "$object_name"; then
      return 0
    fi
    if [[ "$attempt" -lt "$max_attempts" ]]; then
      sleep 1
    fi
    attempt=$((attempt + 1))
  done
  if ! verify_docker_object_absent "$object_type" "$object_name"; then
    echo "ERROR: cleanup could not remove ${object_type} ${object_name}." >&2
    return 1
  fi
}

recover_legacy_normalization_topology() {
  local recovery_failed=false
  local legacy_database_present
  if [[ "$legacy_normalization_cleanup_armed" != true ]]; then
    return 0
  fi

  legacy_database_present="$(
    docker exec --interactive "$container" psql --quiet --tuples-only --no-align \
      --set ON_ERROR_STOP=1 --username postgres --dbname postgres \
      --set=legacy_database="$legacy_normalization_database" << 'SQL'
SELECT count(*) FROM pg_catalog.pg_database WHERE datname=:'legacy_database';
SQL
  )" || recovery_failed=true
  if [[ "$legacy_database_present" == 1 ]] &&
    ! docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
      --username postgres --dbname "$legacy_normalization_database" << 'SQL'; then
REVOKE CREATE ON SCHEMA public FROM rd_owner;
SQL
    recovery_failed=true
  fi
  if ! docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
    --username postgres --dbname postgres \
    --set=legacy_database="$legacy_normalization_database" \
    --set=test_database="$test_database" \
    --set=origin_current_database="$origin_current_database" << 'SQL'; then
REVOKE rd_custodian FROM rd_owner;
SELECT pg_catalog.set_config(
  'vibe_test.test_database',:'test_database',false
);
SELECT pg_catalog.set_config(
  'vibe_test.origin_current_database',:'origin_current_database',false
);
DO $restore_shared_connect$
DECLARE database_name text;
BEGIN
  FOREACH database_name IN ARRAY ARRAY[
    pg_catalog.current_setting('vibe_test.test_database'),
    pg_catalog.current_setting('vibe_test.origin_current_database')
  ] LOOP
    IF EXISTS (
      SELECT 1 FROM pg_catalog.pg_database WHERE datname=database_name
    ) THEN
      EXECUTE pg_catalog.format(
        'GRANT CONNECT ON DATABASE %I TO rd_owner',database_name
      );
    END IF;
  END LOOP;
END
$restore_shared_connect$;
DROP DATABASE IF EXISTS :"legacy_database" WITH (FORCE);
DROP SCHEMA IF EXISTS vibe_test_legacy_normalization_cluster CASCADE;
SQL
    recovery_failed=true
  fi
  [[ "$recovery_failed" == false ]]
}

cleanup() {
  local primary_status="${1:-$?}"
  local cleanup_failed=false
  trap - EXIT
  trap '' HUP INT TERM
  set +e

  if [[ -n "$nextest_archive_file" ]] &&
    ! rm -f -- "$nextest_archive_file"; then
    cleanup_failed=true
  fi
  if [[ -n "$nextest_archive_dir" ]] &&
    ! rmdir -- "$nextest_archive_dir"; then
    cleanup_failed=true
  fi

  if ! recover_legacy_normalization_topology; then
    cleanup_failed=true
  fi
  if ! remove_docker_object_for_cleanup container "$container" 3; then
    cleanup_failed=true
  fi
  if ! remove_docker_object_for_cleanup container "$impersonator_container" 3; then
    cleanup_failed=true
  fi
  if ! remove_docker_object_for_cleanup volume "$volume" 5; then
    cleanup_failed=true
  fi
  if ! remove_docker_object_for_cleanup volume "$impersonator_volume" 5; then
    cleanup_failed=true
  fi
  if [[ "$primary_socket_dir_created" == true || -d "$primary_socket_dir" ]]; then
    rm -f -- "$primary_socket_dir/.s.PGSQL.5432" "$primary_socket_dir/.s.PGSQL.5432.lock" ||
      cleanup_failed=true
    rmdir -- "$primary_socket_dir" || cleanup_failed=true
  fi
  if [[ "$impersonator_socket_dir_created" == true || -d "$impersonator_socket_dir" ]]; then
    rm -f -- "$impersonator_socket_dir/.s.PGSQL.5432" "$impersonator_socket_dir/.s.PGSQL.5432.lock" ||
      cleanup_failed=true
    rmdir -- "$impersonator_socket_dir" || cleanup_failed=true
  fi
  if [[ -e "$primary_socket_dir" || -L "$primary_socket_dir" ||
    -e "$impersonator_socket_dir" || -L "$impersonator_socket_dir" ]]; then
    echo "ERROR: cleanup left an exact PostgreSQL socket artifact present." >&2
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
trap 'cleanup 129' HUP
trap 'cleanup 130' INT
trap 'cleanup 143' TERM

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
mkdir -- "$primary_socket_dir"
primary_socket_dir_created=true
chmod 0777 "$primary_socket_dir"
mkdir -- "$impersonator_socket_dir"
impersonator_socket_dir_created=true
chmod 0777 "$impersonator_socket_dir"
docker volume create "$volume" > /dev/null
docker volume create "$impersonator_volume" > /dev/null
docker run \
  --detach \
  --name "$container" \
  --publish 127.0.0.1::5432 \
  --mount "type=volume,source=${volume},target=/var/lib/postgresql/data" \
  --mount "type=bind,source=${primary_socket_dir},target=/vibe-postgres-socket" \
  --env POSTGRES_USER=postgres \
  --env "POSTGRES_PASSWORD=${test_password}" \
  --env POSTGRES_DB=postgres \
  "$postgres_image" -c unix_socket_directories=/var/run/postgresql,/vibe-postgres-socket > /dev/null
docker run \
  --detach \
  --name "$impersonator_container" \
  --publish 127.0.0.1::5432 \
  --mount "type=volume,source=${impersonator_volume},target=/var/lib/postgresql/data" \
  --mount "type=bind,source=${impersonator_socket_dir},target=/vibe-postgres-socket" \
  --env POSTGRES_USER=postgres \
  --env "POSTGRES_PASSWORD=${impersonator_password}" \
  --env "POSTGRES_DB=${impersonator_database}" \
  "$postgres_image" -c unix_socket_directories=/var/run/postgresql,/vibe-postgres-socket > /dev/null

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
  --set=test_database="$test_database" \
  --set=impersonator_password="$impersonator_password" << 'SQL'
CREATE ROLE rd_owner NOLOGIN;
CREATE ROLE rd_fact_writer LOGIN PASSWORD :'impersonator_password' NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOREPLICATION NOBYPASSRLS;
CREATE ROLE backtest_owner LOGIN PASSWORD :'impersonator_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE DATABASE :"test_database" OWNER postgres;
REVOKE CONNECT ON DATABASE :"test_database" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"test_database" TO rd_fact_writer;
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

wait_for_primary_after_failed_authority_migration() {
  local migration_database="$1"
  local attempt=1
  local primary_probe

  while [[ "$attempt" -le 30 ]]; do
    if primary_probe="$(timeout 3 docker exec \
      --env "PGPASSWORD=${test_password}" \
      "$container" psql --quiet --tuples-only --no-align --set ON_ERROR_STOP=1 \
      --host 127.0.0.1 --username postgres --dbname "$migration_database" \
      --command 'BEGIN; CREATE TEMP TABLE vibe_primary_readiness_probe_v1(value integer) ON COMMIT DROP; INSERT INTO vibe_primary_readiness_probe_v1 VALUES (1); SELECT NOT pg_catalog.pg_is_in_recovery(); ROLLBACK;' \
      2> /dev/null)" && [[ "$primary_probe" == "t" ]]; then
      return 0
    fi
    if [[ "$attempt" -lt 30 ]]; then
      sleep 1
    fi
    attempt=$((attempt + 1))
  done

  echo "ERROR: PostgreSQL did not return to writable primary state after failed authority migration." >&2
  docker logs --tail 80 "$container" >&2 || true
  return 1
}

run_authority_migration_for_database() {
  local migration_database="$1"
  local migration_status

  if docker exec --interactive \
    --env POSTGRES_HOST=127.0.0.1 \
    --env "POSTGRES_DATABASE=${migration_database}" \
    --env "POSTGRES_PASSWORD=${test_password}" \
    --env "RD_OWNER_DB_PASSWORD=${test_password}" \
    --env "OPERATOR_AUTHORIZATION_DB_PASSWORD=${test_password}" \
    --env "QUALIFICATION_OWNER_DB_PASSWORD=${test_password}" \
    --env "PRODUCT_EDGE_DB_PASSWORD=${test_password}" \
    --env "BACKTEST_OWNER_DB_PASSWORD=${test_password}" \
    "$container" sh -s < product/rd-workbench/postgres-init/10-migrate-authority-custody.sh; then
    return 0
  else
    migration_status="$?"
  fi

  if ! wait_for_primary_after_failed_authority_migration "$migration_database"; then
    exit 1
  fi
  return "$migration_status"
}
run_authority_migration() {
  run_authority_migration_for_database "$test_database"
}
restore_disposable_topology_admin() {
  local fixture_database="$1"
  docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
    --username postgres --dbname postgres --set=fixture_database="$fixture_database" << 'SQL'
REVOKE rd_custodian, product_edge_custodian
  FROM vibe_test_owner_topology_admin;
GRANT composer_owner TO vibe_test_owner_topology_admin
  WITH ADMIN FALSE, INHERIT TRUE, SET TRUE;
GRANT CONNECT ON DATABASE :"fixture_database" TO vibe_test_owner_topology_admin;
SQL
}
source_intake_topology_fingerprint() {
  docker exec --interactive "$container" psql --quiet --tuples-only --no-align \
    --set ON_ERROR_STOP=1 --username postgres --dbname "$test_database" << 'SQL'
WITH custody_fact AS (
  SELECT 'routine:'||routine.oid::text||':'||pg_catalog.pg_get_userbyid(routine.proowner)||':'||
         routine.proisstrict::text||':'||routine.prosecdef::text||':'||routine.provolatile::text||':'||
         routine.proparallel::text||':'||COALESCE(routine.proconfig::text,'<NULL>')||':'||
         COALESCE(routine.proacl::text,'<NULL>')||':'||COALESCE(pg_catalog.obj_description(routine.oid,'pg_proc'),'<NULL>')||':'||
         pg_catalog.md5(routine.prosrc) AS fact
  FROM pg_catalog.pg_proc routine
  JOIN pg_catalog.pg_namespace namespace ON namespace.oid=routine.pronamespace
  WHERE namespace.nspname='rd_owner_api' AND routine.proname IN (
    'derive_source_intake_identity_v1','canonical_source_intake_json_v1','derive_openalex_location_rights_v1',
    'derive_source_acquisition_binding_digest_v1','derive_source_acquisition_binding_identity_v1',
    'lock_source_acquisition_binding_v1','lock_source_invocation_reservation_v1',
    'valid_source_intake_started_custody_v1','guard_source_intake_binding_v1',
    'reject_source_intake_terminal_mutation_v1','read_source_intake_v1',
    'valid_source_intake_binding_contract_v1','valid_source_intake_receipt_v1',
    'canonical_source_intake_custody_v1','peek_source_intake_research_handoff_v1',
    'lock_source_intake_research_handoff_v1'
  )
  UNION ALL
  SELECT 'relation:'||relation.oid::text||':'||pg_catalog.pg_get_userbyid(relation.relowner)||':'||
         COALESCE(relation.relacl::text,'<NULL>')||':'||COALESCE(pg_catalog.obj_description(relation.oid,'pg_class'),'<NULL>')
  FROM pg_catalog.pg_class relation
  JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace
  WHERE namespace.nspname='public' AND relation.relname IN (
    'rd_source_intake_bindings_v1','rd_source_intake_receipts_v1','rd_source_raw_payloads_v1',
    'rd_source_raw_receipt_links_v1','rd_research_source_provenance_v1','rd_source_candidates_v1'
  )
)
SELECT pg_catalog.md5(pg_catalog.string_agg(fact,E'\n' ORDER BY fact)) FROM custody_fact;
SELECT pg_catalog.count(*) FROM public.rd_source_intake_bindings_v1;
SELECT pg_catalog.count(*) FROM public.rd_source_intake_receipts_v1;
SELECT pg_catalog.count(*) FROM public.rd_source_raw_payloads_v1;
SELECT pg_catalog.count(*) FROM public.rd_source_raw_receipt_links_v1;
SELECT pg_catalog.count(*) FROM public.rd_research_source_provenance_v1;
SELECT pg_catalog.count(*) FROM public.rd_source_candidates_v1;
SQL
}
run_authority_migration

docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
  --username postgres --dbname "$test_database" << 'SQL'
ALTER ROLE rd_fact_writer NOINHERIT;
SQL
run_authority_migration
docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
  --username postgres --dbname "$test_database" << 'SQL'
DO $rd_fact_writer_role_readback$
DECLARE exact boolean;
BEGIN
  SELECT pg_catalog.count(*)=1 AND pg_catalog.bool_and(
           role.rolcanlogin AND role.rolinherit
           AND NOT role.rolsuper AND NOT role.rolcreatedb AND NOT role.rolcreaterole
           AND NOT role.rolreplication AND NOT role.rolbypassrls
         )
    INTO exact
    FROM pg_catalog.pg_roles role
   WHERE role.rolname='rd_fact_writer';
  IF exact IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'R&D fact writer role normalization mismatch';
  END IF;
END
$rd_fact_writer_role_readback$;
SQL

docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
  --username postgres --dbname "$test_database" << 'SQL'
ALTER FUNCTION rd_owner_api.lock_source_intake_research_handoff_v1(text,text,text) PARALLEL RESTRICTED;
SQL
source_attribute_drift_fingerprint_before="$(source_intake_topology_fingerprint)"
readonly source_attribute_drift_fingerprint_before
if run_authority_migration; then
  echo "ERROR: authority migration accepted same-source Source Intake routine attribute drift" >&2
  exit 1
fi
source_attribute_drift_fingerprint_after="$(source_intake_topology_fingerprint)"
readonly source_attribute_drift_fingerprint_after
if [[ "$source_attribute_drift_fingerprint_after" != "$source_attribute_drift_fingerprint_before" ]]; then
  echo "ERROR: failed Source Intake routine attribute cutover committed custody mutation" >&2
  exit 1
fi
docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
  --username postgres --dbname "$test_database" << 'SQL'
ALTER FUNCTION rd_owner_api.lock_source_intake_research_handoff_v1(text,text,text) PARALLEL UNSAFE;
SQL
run_authority_migration

docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
  --username postgres --dbname "$test_database" --set=test_database="$test_database" << 'SQL'
CREATE ROLE legacy_catalog_actor NOLOGIN;
GRANT rd_owner TO legacy_catalog_actor;
GRANT CONNECT ON DATABASE :"test_database" TO legacy_catalog_actor;
GRANT CREATE ON DATABASE :"test_database" TO rd_owner;
GRANT SELECT ON TABLE replay_policy_catalog_private.rd_replay_policy_catalog_records_v2 TO legacy_catalog_actor;
GRANT SELECT(catalog_record_id) ON TABLE replay_policy_catalog_private.rd_replay_policy_catalog_records_v2 TO legacy_catalog_actor;
CREATE FUNCTION composer_owner_api.lock_accepted_develop_composer_v2(integer) RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS 'SELECT $1';
ALTER FUNCTION composer_owner_api.lock_accepted_develop_composer_v2(integer) OWNER TO composer_owner;
GRANT EXECUTE ON FUNCTION composer_owner_api.lock_accepted_develop_composer_v2(integer) TO legacy_catalog_actor;
SQL
if run_authority_migration; then
  echo "ERROR: authority migration accepted an unknown Composer overload" >&2
  exit 1
fi
docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
  --username postgres --dbname "$test_database" << 'SQL'
DROP FUNCTION composer_owner_api.lock_accepted_develop_composer_v2(integer);
SQL
run_authority_migration
docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
  --username postgres --dbname "$test_database" --set=test_database="$test_database" << 'SQL'
DO $legacy_cutover_readback$
BEGIN
  IF pg_catalog.pg_has_role('legacy_catalog_actor','rd_owner','MEMBER')
     OR pg_catalog.has_database_privilege('legacy_catalog_actor',pg_catalog.current_database(),'CONNECT')
     OR pg_catalog.has_database_privilege('rd_owner',pg_catalog.current_database(),'CREATE')
     OR pg_catalog.has_database_privilege('rd_owner',pg_catalog.current_database(),'TEMPORARY')
     OR pg_catalog.has_table_privilege('legacy_catalog_actor','replay_policy_catalog_private.rd_replay_policy_catalog_records_v2','SELECT')
     OR pg_catalog.has_column_privilege('legacy_catalog_actor','replay_policy_catalog_private.rd_replay_policy_catalog_records_v2','catalog_record_id','SELECT') THEN
    RAISE EXCEPTION 'legacy R&D authority survived cutover';
  END IF;
END
$legacy_cutover_readback$;
SQL
fixed_catalog_rows="$(docker exec \
  --env "PGPASSWORD=${test_password}" \
  "$container" psql --quiet --tuples-only --no-align --set ON_ERROR_STOP=1 \
  --host 127.0.0.1 --username rd_owner --dbname "$test_database" \
  --command 'SELECT count(*) FROM replay_policy_catalog_api.lock_current_replay_policy_catalog_v2()')"
readonly fixed_catalog_rows
if [[ "$fixed_catalog_rows" != "0" ]]; then
  echo "ERROR: fixed Catalog read API failed after ACL cutover" >&2
  exit 1
fi
for runtime_role in rd_owner rd_fact_writer operator_authorization_writer qualification_writer product_edge_owner backtest_owner; do
  if docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
    --username postgres --dbname "$test_database" << SQL; then
SET SESSION AUTHORIZATION "$runtime_role";
CREATE SCHEMA forbidden_${runtime_role}_schema;
SQL
    echo "ERROR: ${runtime_role} retained database CREATE" >&2
    exit 1
  fi
  if docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
    --username postgres --dbname "$test_database" << SQL; then
SET SESSION AUTHORIZATION "$runtime_role";
CREATE TEMP TABLE forbidden_${runtime_role}_temporary(value integer);
SQL
    echo "ERROR: ${runtime_role} retained database TEMPORARY" >&2
    exit 1
  fi
done
for runtime_role in rd_owner product_edge_owner; do
  runtime_schema='rd_owner_api'
  runtime_signature='rd_owner_api.lock_artifact_invocation_reservation_v1(text,text,text,text,text)'
  if [[ "$runtime_role" == product_edge_owner ]]; then
    runtime_schema='product_edge_api'
    runtime_signature='product_edge_api.lock_legacy_prepared_attempt_drain_effects_v1()'
  fi
  if docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
    --username postgres --dbname "$test_database" << SQL; then
SET SESSION AUTHORIZATION "$runtime_role";
CREATE FUNCTION ${runtime_schema}.forbidden_runtime_function_v1() RETURNS integer LANGUAGE sql AS 'SELECT 1';
SQL
    echo "ERROR: ${runtime_role} can create API routines" >&2
    exit 1
  fi
  if docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
    --username postgres --dbname "$test_database" << SQL; then
SET SESSION AUTHORIZATION "$runtime_role";
ALTER FUNCTION ${runtime_signature} RENAME TO forbidden_runtime_replacement_v1;
SQL
    echo "ERROR: ${runtime_role} can replace API routines" >&2
    exit 1
  fi
done
docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
  --username postgres --dbname "$test_database" << 'SQL'
DO $replace_catalog_check$
DECLARE constraint_name text;
BEGIN
  SELECT constraint_fact.conname INTO STRICT constraint_name
  FROM pg_catalog.pg_constraint constraint_fact
  WHERE constraint_fact.conrelid='replay_policy_catalog_private.rd_replay_policy_catalog_records_v2'::pg_catalog.regclass
    AND constraint_fact.contype='c' AND pg_catalog.pg_get_expr(constraint_fact.conbin,constraint_fact.conrelid) LIKE '%catalog_version%';
  EXECUTE pg_catalog.format('ALTER TABLE replay_policy_catalog_private.rd_replay_policy_catalog_records_v2 DROP CONSTRAINT %I',constraint_name);
END
$replace_catalog_check$;
ALTER TABLE replay_policy_catalog_private.rd_replay_policy_catalog_records_v2 ADD CONSTRAINT catalog_version_manifest_test CHECK (catalog_version > 0);
SQL
if run_authority_migration; then
  echo "ERROR: authority migration accepted same-count CHECK drift" >&2
  exit 1
fi
docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
  --username postgres --dbname "$test_database" << 'SQL'
ALTER TABLE replay_policy_catalog_private.rd_replay_policy_catalog_records_v2 DROP CONSTRAINT catalog_version_manifest_test;
ALTER TABLE replay_policy_catalog_private.rd_replay_policy_catalog_records_v2 ADD CONSTRAINT catalog_version_manifest_restored CHECK (catalog_version > 0 AND catalog_version <= 18446744073709551615);
SQL
run_authority_migration

docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
  --username postgres --dbname "$test_database" << 'SQL'
CREATE FUNCTION public.forbidden_qualification_trigger_v1() RETURNS trigger LANGUAGE plpgsql AS $function$ BEGIN RETURN NEW; END $function$;
CREATE TRIGGER forbidden_qualification_trigger_v1 BEFORE INSERT ON public.qualification_owner_outbox_v1 FOR EACH ROW EXECUTE FUNCTION public.forbidden_qualification_trigger_v1();
SQL
if run_authority_migration; then
  echo "ERROR: authority migration blessed an unexpected Qualification trigger dependency" >&2
  exit 1
fi
docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
  --username postgres --dbname "$test_database" << 'SQL'
DROP TRIGGER forbidden_qualification_trigger_v1 ON public.qualification_owner_outbox_v1;
DROP FUNCTION public.forbidden_qualification_trigger_v1();
SQL
run_authority_migration

readonly test_marker="rd-owner-isolated-${suffix}"
docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
  --username postgres --dbname "$test_database" \
  --set=test_database="$test_database" \
  --set=test_password="$test_password" \
  --set=test_marker="$test_marker" << 'SQL'
CREATE ROLE vibe_test_owner_topology_admin LOGIN PASSWORD :'test_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE vibe_test_legacy_replay_fault_writer LOGIN PASSWORD :'test_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE vibe_test_legacy_migration_caller LOGIN PASSWORD :'test_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE rd_fact_writer PASSWORD :'test_password';
GRANT composer_owner TO vibe_test_owner_topology_admin
  WITH ADMIN FALSE, INHERIT TRUE, SET TRUE;
GRANT CONNECT ON DATABASE :"test_database" TO vibe_test_owner_topology_admin;
GRANT CREATE ON SCHEMA public TO vibe_test_owner_topology_admin;
GRANT CONNECT ON DATABASE :"test_database" TO vibe_test_legacy_replay_fault_writer;
GRANT CONNECT ON DATABASE :"test_database" TO vibe_test_legacy_migration_caller;
CREATE SCHEMA IF NOT EXISTS vibe_test_admin AUTHORIZATION postgres;
CREATE TABLE IF NOT EXISTS vibe_test_admin.dedicated_postgres_test_instance_v1 (
  marker_identity text NOT NULL,
  database_name text NOT NULL,
  test_role text PRIMARY KEY
);
ALTER TABLE vibe_test_admin.dedicated_postgres_test_instance_v1 OWNER TO postgres;
REVOKE ALL ON SCHEMA vibe_test_admin FROM PUBLIC;
REVOKE ALL ON TABLE vibe_test_admin.dedicated_postgres_test_instance_v1 FROM PUBLIC;
GRANT USAGE ON SCHEMA vibe_test_admin TO operator_authorization_writer, product_edge_owner, rd_owner, rd_fact_writer, qualification_writer, backtest_owner, vibe_test_owner_topology_admin, vibe_test_legacy_replay_fault_writer, vibe_test_legacy_migration_caller;
GRANT SELECT ON TABLE vibe_test_admin.dedicated_postgres_test_instance_v1 TO operator_authorization_writer, product_edge_owner, rd_owner, rd_fact_writer, qualification_writer, backtest_owner, vibe_test_owner_topology_admin, vibe_test_legacy_replay_fault_writer, vibe_test_legacy_migration_caller;
DO $owner_topology_admin_membership$
DECLARE exact boolean;
BEGIN
  SELECT pg_catalog.count(*)=1 AND pg_catalog.bool_and(
           granted.rolname='composer_owner'
           AND NOT membership.admin_option
           AND membership.inherit_option
           AND membership.set_option
         )
    INTO exact
    FROM pg_catalog.pg_auth_members membership
    JOIN pg_catalog.pg_roles granted ON granted.oid=membership.roleid
    JOIN pg_catalog.pg_roles member ON member.oid=membership.member
   WHERE member.rolname='vibe_test_owner_topology_admin';
  IF exact IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Owner topology administrator membership mismatch';
  END IF;
END
$owner_topology_admin_membership$;
INSERT INTO vibe_test_admin.dedicated_postgres_test_instance_v1(marker_identity, database_name, test_role)
SELECT :'test_marker', :'test_database', role_name
FROM unnest(ARRAY[
  'operator_authorization_writer',
  'product_edge_owner',
  'rd_owner',
  'rd_fact_writer',
  'qualification_writer',
  'backtest_owner',
  'vibe_test_owner_topology_admin',
  'vibe_test_legacy_replay_fault_writer',
  'vibe_test_legacy_migration_caller'
]) AS role_name
ON CONFLICT (test_role) DO UPDATE
SET marker_identity=EXCLUDED.marker_identity, database_name=EXCLUDED.database_name;

CREATE SCHEMA vibe_test_replay_policy_catalog_fault AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA vibe_test_replay_policy_catalog_fault FROM PUBLIC;
GRANT USAGE ON SCHEMA vibe_test_replay_policy_catalog_fault
  TO vibe_test_owner_topology_admin;
CREATE TABLE vibe_test_replay_policy_catalog_fault.authority_state_v1 (
  singleton boolean DEFAULT true NOT NULL,
  marker_identity text NOT NULL,
  database_name name NOT NULL,
  execution_boundary text NOT NULL,
  phase text NOT NULL,
  lease_identity text,
  last_released_lease_identity text,
  CONSTRAINT authority_state_v1_singleton_pk PRIMARY KEY (singleton),
  CONSTRAINT authority_state_v1_singleton_check CHECK (singleton),
  CONSTRAINT authority_state_v1_phase_check
    CHECK (phase IN ('READY','LEASED','MEMBERSHIP_FAULT')),
  CONSTRAINT authority_state_v1_lease_check CHECK (
    (phase='READY' AND lease_identity IS NULL)
    OR (phase IN ('LEASED','MEMBERSHIP_FAULT') AND lease_identity IS NOT NULL)
  )
);
ALTER TABLE vibe_test_replay_policy_catalog_fault.authority_state_v1 OWNER TO postgres;
REVOKE ALL ON TABLE vibe_test_replay_policy_catalog_fault.authority_state_v1 FROM PUBLIC;
GRANT SELECT ON TABLE vibe_test_replay_policy_catalog_fault.authority_state_v1
  TO vibe_test_owner_topology_admin;
INSERT INTO vibe_test_replay_policy_catalog_fault.authority_state_v1(
  singleton,marker_identity,database_name,execution_boundary,phase,lease_identity,
  last_released_lease_identity
) VALUES (
  true,:'test_marker',:'test_database',
  'isolated-disposable-postgres-container:sequential-shell-loop:v1','READY',NULL,NULL
);

CREATE FUNCTION vibe_test_replay_policy_catalog_fault.acquire_v1(
  expected_marker_identity text,
  expected_lease_identity text
)
RETURNS text
LANGUAGE plpgsql STRICT VOLATILE PARALLEL UNSAFE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp
AS $function$
DECLARE
  exact_marker_count bigint;
  exact_protected_edge_count bigint;
  current_phase text;
  current_lease_identity text;
  last_released_lease_identity text;
BEGIN
  IF session_user<>'vibe_test_owner_topology_admin' OR current_user<>'postgres' THEN
    RAISE EXCEPTION 'Replay Policy Catalog fault authority caller mismatch' USING ERRCODE='42501';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('vibe-test-exclusive-authority-v1',0)
  );
  SELECT pg_catalog.count(*) INTO exact_marker_count
    FROM vibe_test_admin.dedicated_postgres_test_instance_v1 marker
   WHERE marker.marker_identity=expected_marker_identity
     AND marker.database_name=pg_catalog.current_database()
     AND marker.test_role='vibe_test_owner_topology_admin';
  IF exact_marker_count<>1 THEN
    RAISE EXCEPTION 'Replay Policy Catalog fault authority marker mismatch' USING ERRCODE='55000';
  END IF;
  IF EXISTS (
    SELECT 1 FROM vibe_test_legacy_migration_lease.authority_state_v1 state
     WHERE NOT state.singleton OR state.marker_identity<>expected_marker_identity
        OR state.database_name<>pg_catalog.current_database()
        OR state.phase<>'READY' OR state.lease_identity IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'legacy Replay migration authority is not clean' USING ERRCODE='55000';
  END IF;
  SELECT state.phase,state.lease_identity,state.last_released_lease_identity
    INTO current_phase,current_lease_identity,last_released_lease_identity
    FROM vibe_test_replay_policy_catalog_fault.authority_state_v1 state
   WHERE state.singleton AND state.marker_identity=expected_marker_identity
     AND state.database_name=pg_catalog.current_database()
     AND state.execution_boundary=
       'isolated-disposable-postgres-container:sequential-shell-loop:v1'
   FOR UPDATE;
  IF current_phase='LEASED'
     AND current_lease_identity=expected_lease_identity THEN
    SELECT pg_catalog.count(*) INTO exact_protected_edge_count
      FROM pg_catalog.pg_auth_members membership
      JOIN pg_catalog.pg_roles granted ON granted.oid=membership.roleid
      JOIN pg_catalog.pg_roles member ON member.oid=membership.member
      JOIN pg_catalog.pg_roles grantor ON grantor.oid=membership.grantor
     WHERE (granted.rolname IN ('replay_policy_catalog_owner','rd_owner','rd_fact_writer')
         OR member.rolname IN ('replay_policy_catalog_owner','rd_owner','rd_fact_writer'))
       AND granted.rolname='replay_policy_catalog_owner'
       AND member.rolname='vibe_test_owner_topology_admin'
       AND grantor.rolname='postgres' AND NOT membership.admin_option
       AND membership.inherit_option AND membership.set_option;
    IF exact_protected_edge_count=1 AND NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_auth_members membership
      JOIN pg_catalog.pg_roles granted ON granted.oid=membership.roleid
      JOIN pg_catalog.pg_roles member ON member.oid=membership.member
      WHERE (granted.rolname IN ('replay_policy_catalog_owner','rd_owner','rd_fact_writer')
          OR member.rolname IN ('replay_policy_catalog_owner','rd_owner','rd_fact_writer'))
        AND NOT (granted.rolname='replay_policy_catalog_owner'
             AND member.rolname='vibe_test_owner_topology_admin')
    ) THEN
      RETURN expected_lease_identity;
    END IF;
    RAISE EXCEPTION 'Replay Policy Catalog fault authority acquired outcome mismatch' USING ERRCODE='55000';
  END IF;
  IF current_phase IS DISTINCT FROM 'READY' OR current_lease_identity IS NOT NULL
     OR last_released_lease_identity=expected_lease_identity THEN
    RAISE EXCEPTION 'Replay Policy Catalog fault authority phase mismatch' USING ERRCODE='55000';
  END IF;
  SELECT pg_catalog.count(*) INTO exact_protected_edge_count
    FROM pg_catalog.pg_auth_members membership
    JOIN pg_catalog.pg_roles granted ON granted.oid=membership.roleid
    JOIN pg_catalog.pg_roles member ON member.oid=membership.member
   WHERE granted.rolname IN ('replay_policy_catalog_owner','rd_owner','rd_fact_writer')
      OR member.rolname IN ('replay_policy_catalog_owner','rd_owner','rd_fact_writer');
  IF exact_protected_edge_count<>0 THEN
    RAISE EXCEPTION 'Replay Policy Catalog protected membership is not clean' USING ERRCODE='55000';
  END IF;
  GRANT replay_policy_catalog_owner TO vibe_test_owner_topology_admin;
  SELECT pg_catalog.count(*) INTO exact_protected_edge_count
    FROM pg_catalog.pg_auth_members membership
    JOIN pg_catalog.pg_roles granted ON granted.oid=membership.roleid
    JOIN pg_catalog.pg_roles member ON member.oid=membership.member
    JOIN pg_catalog.pg_roles grantor ON grantor.oid=membership.grantor
   WHERE (granted.rolname IN ('replay_policy_catalog_owner','rd_owner','rd_fact_writer')
       OR member.rolname IN ('replay_policy_catalog_owner','rd_owner','rd_fact_writer'))
     AND granted.rolname='replay_policy_catalog_owner'
     AND member.rolname='vibe_test_owner_topology_admin'
     AND grantor.rolname='postgres' AND NOT membership.admin_option
     AND membership.inherit_option AND membership.set_option;
  IF exact_protected_edge_count<>1 OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_auth_members membership
    JOIN pg_catalog.pg_roles granted ON granted.oid=membership.roleid
    JOIN pg_catalog.pg_roles member ON member.oid=membership.member
    WHERE (granted.rolname IN ('replay_policy_catalog_owner','rd_owner','rd_fact_writer')
        OR member.rolname IN ('replay_policy_catalog_owner','rd_owner','rd_fact_writer'))
      AND NOT (granted.rolname='replay_policy_catalog_owner'
           AND member.rolname='vibe_test_owner_topology_admin')
  ) THEN
    RAISE EXCEPTION 'Replay Policy Catalog fault authority lease mismatch' USING ERRCODE='55000';
  END IF;
  UPDATE vibe_test_replay_policy_catalog_fault.authority_state_v1
     SET phase='LEASED',lease_identity=expected_lease_identity
   WHERE singleton AND phase='READY' AND lease_identity IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Replay Policy Catalog fault authority phase advance failed' USING ERRCODE='55000';
  END IF;
  RETURN expected_lease_identity;
END
$function$;

CREATE FUNCTION vibe_test_replay_policy_catalog_fault.release_v1(
  expected_marker_identity text,
  expected_lease_identity text
)
RETURNS text
LANGUAGE plpgsql STRICT VOLATILE PARALLEL UNSAFE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp
AS $function$
DECLARE
  exact_marker_count bigint;
  exact_protected_edge_count bigint;
  current_phase text;
  current_lease_identity text;
  last_released_lease_identity text;
BEGIN
  IF session_user<>'vibe_test_owner_topology_admin' OR current_user<>'postgres' THEN
    RAISE EXCEPTION 'Replay Policy Catalog fault authority caller mismatch' USING ERRCODE='42501';
  END IF;
  SELECT pg_catalog.count(*) INTO exact_marker_count
    FROM vibe_test_admin.dedicated_postgres_test_instance_v1 marker
   WHERE marker.marker_identity=expected_marker_identity
     AND marker.database_name=pg_catalog.current_database()
     AND marker.test_role='vibe_test_owner_topology_admin';
  IF exact_marker_count<>1 THEN
    RAISE EXCEPTION 'Replay Policy Catalog fault authority marker mismatch' USING ERRCODE='55000';
  END IF;
  SELECT state.phase,state.lease_identity,state.last_released_lease_identity
    INTO current_phase,current_lease_identity,last_released_lease_identity
    FROM vibe_test_replay_policy_catalog_fault.authority_state_v1 state
   WHERE state.singleton AND state.marker_identity=expected_marker_identity
     AND state.database_name=pg_catalog.current_database()
     AND state.execution_boundary=
       'isolated-disposable-postgres-container:sequential-shell-loop:v1'
   FOR UPDATE;
  IF current_phase='READY' AND current_lease_identity IS NULL
     AND last_released_lease_identity=expected_lease_identity THEN
    SELECT pg_catalog.count(*) INTO exact_protected_edge_count
      FROM pg_catalog.pg_auth_members membership
      JOIN pg_catalog.pg_roles granted ON granted.oid=membership.roleid
      JOIN pg_catalog.pg_roles member ON member.oid=membership.member
     WHERE granted.rolname IN ('replay_policy_catalog_owner','rd_owner','rd_fact_writer')
        OR member.rolname IN ('replay_policy_catalog_owner','rd_owner','rd_fact_writer');
    IF exact_protected_edge_count=0 THEN
      RETURN 'READY';
    END IF;
    RAISE EXCEPTION 'Replay Policy Catalog released authority graph mismatch' USING ERRCODE='55000';
  END IF;
  IF current_phase IS DISTINCT FROM 'LEASED'
     OR current_lease_identity IS DISTINCT FROM expected_lease_identity THEN
    RAISE EXCEPTION 'Replay Policy Catalog fault authority phase mismatch' USING ERRCODE='55000';
  END IF;
  SELECT pg_catalog.count(*) INTO exact_protected_edge_count
    FROM pg_catalog.pg_auth_members membership
    JOIN pg_catalog.pg_roles granted ON granted.oid=membership.roleid
    JOIN pg_catalog.pg_roles member ON member.oid=membership.member
    JOIN pg_catalog.pg_roles grantor ON grantor.oid=membership.grantor
   WHERE (granted.rolname IN ('replay_policy_catalog_owner','rd_owner','rd_fact_writer')
       OR member.rolname IN ('replay_policy_catalog_owner','rd_owner','rd_fact_writer'))
     AND granted.rolname='replay_policy_catalog_owner'
     AND member.rolname='vibe_test_owner_topology_admin'
     AND grantor.rolname='postgres' AND NOT membership.admin_option
     AND membership.inherit_option AND membership.set_option;
  IF exact_protected_edge_count<>1 OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_auth_members membership
    JOIN pg_catalog.pg_roles granted ON granted.oid=membership.roleid
    JOIN pg_catalog.pg_roles member ON member.oid=membership.member
    WHERE (granted.rolname IN ('replay_policy_catalog_owner','rd_owner','rd_fact_writer')
        OR member.rolname IN ('replay_policy_catalog_owner','rd_owner','rd_fact_writer'))
      AND NOT (granted.rolname='replay_policy_catalog_owner'
           AND member.rolname='vibe_test_owner_topology_admin')
  ) THEN
    RAISE EXCEPTION 'Replay Policy Catalog fault authority lease mismatch' USING ERRCODE='55000';
  END IF;
  REVOKE replay_policy_catalog_owner FROM vibe_test_owner_topology_admin;
  SELECT pg_catalog.count(*) INTO exact_protected_edge_count
    FROM pg_catalog.pg_auth_members membership
    JOIN pg_catalog.pg_roles granted ON granted.oid=membership.roleid
    JOIN pg_catalog.pg_roles member ON member.oid=membership.member
   WHERE granted.rolname IN ('replay_policy_catalog_owner','rd_owner','rd_fact_writer')
      OR member.rolname IN ('replay_policy_catalog_owner','rd_owner','rd_fact_writer');
  IF exact_protected_edge_count<>0 THEN
    RAISE EXCEPTION 'Replay Policy Catalog protected membership release failed' USING ERRCODE='55000';
  END IF;
  UPDATE vibe_test_replay_policy_catalog_fault.authority_state_v1
     SET phase='READY',lease_identity=NULL,
         last_released_lease_identity=expected_lease_identity
   WHERE singleton AND phase='LEASED'
     AND lease_identity=expected_lease_identity;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Replay Policy Catalog fault authority phase release failed' USING ERRCODE='55000';
  END IF;
  RETURN 'READY';
END
$function$;

CREATE FUNCTION vibe_test_replay_policy_catalog_fault.inject_third_party_owner_edge_v1(
  expected_marker_identity text,
  expected_lease_identity text
)
RETURNS text
LANGUAGE plpgsql STRICT VOLATILE PARALLEL UNSAFE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp
AS $function$
DECLARE
  exact_marker_count bigint;
  exact_protected_edge_count bigint;
  current_phase text;
  current_lease_identity text;
BEGIN
  IF session_user<>'vibe_test_owner_topology_admin' OR current_user<>'postgres' THEN
    RAISE EXCEPTION 'Replay Policy Catalog membership fault caller mismatch' USING ERRCODE='42501';
  END IF;
  SELECT pg_catalog.count(*) INTO exact_marker_count
    FROM vibe_test_admin.dedicated_postgres_test_instance_v1 marker
   WHERE marker.marker_identity=expected_marker_identity
     AND marker.database_name=pg_catalog.current_database()
     AND marker.test_role='vibe_test_owner_topology_admin';
  IF exact_marker_count<>1 THEN
    RAISE EXCEPTION 'Replay Policy Catalog membership fault marker mismatch' USING ERRCODE='55000';
  END IF;
  SELECT state.phase,state.lease_identity INTO current_phase,current_lease_identity
    FROM vibe_test_replay_policy_catalog_fault.authority_state_v1 state
   WHERE state.singleton AND state.marker_identity=expected_marker_identity
     AND state.database_name=pg_catalog.current_database()
     AND state.execution_boundary=
       'isolated-disposable-postgres-container:sequential-shell-loop:v1'
   FOR UPDATE;
  IF current_phase='MEMBERSHIP_FAULT'
     AND current_lease_identity=expected_lease_identity THEN
    SELECT pg_catalog.count(*) INTO exact_protected_edge_count
      FROM pg_catalog.pg_auth_members membership
      JOIN pg_catalog.pg_roles granted ON granted.oid=membership.roleid
      JOIN pg_catalog.pg_roles member ON member.oid=membership.member
      JOIN pg_catalog.pg_roles grantor ON grantor.oid=membership.grantor
     WHERE (granted.rolname IN ('replay_policy_catalog_owner','rd_owner','rd_fact_writer')
         OR member.rolname IN ('replay_policy_catalog_owner','rd_owner','rd_fact_writer'))
       AND granted.rolname='replay_policy_catalog_owner'
       AND member.rolname='qualification_writer'
       AND grantor.rolname='postgres' AND NOT membership.admin_option
       AND NOT membership.inherit_option AND NOT membership.set_option;
    IF exact_protected_edge_count=1 AND NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_auth_members membership
      JOIN pg_catalog.pg_roles granted ON granted.oid=membership.roleid
      JOIN pg_catalog.pg_roles member ON member.oid=membership.member
      WHERE (granted.rolname IN ('replay_policy_catalog_owner','rd_owner','rd_fact_writer')
          OR member.rolname IN ('replay_policy_catalog_owner','rd_owner','rd_fact_writer'))
        AND NOT (granted.rolname='replay_policy_catalog_owner'
             AND member.rolname='qualification_writer')
    ) THEN
      RETURN expected_lease_identity;
    END IF;
    RAISE EXCEPTION 'Replay Policy Catalog membership fault outcome mismatch' USING ERRCODE='55000';
  END IF;
  IF current_phase IS DISTINCT FROM 'LEASED'
     OR current_lease_identity IS DISTINCT FROM expected_lease_identity THEN
    RAISE EXCEPTION 'Replay Policy Catalog membership fault phase mismatch' USING ERRCODE='55000';
  END IF;
  SELECT pg_catalog.count(*) INTO exact_protected_edge_count
    FROM pg_catalog.pg_auth_members membership
    JOIN pg_catalog.pg_roles granted ON granted.oid=membership.roleid
    JOIN pg_catalog.pg_roles member ON member.oid=membership.member
    JOIN pg_catalog.pg_roles grantor ON grantor.oid=membership.grantor
   WHERE (granted.rolname IN ('replay_policy_catalog_owner','rd_owner','rd_fact_writer')
       OR member.rolname IN ('replay_policy_catalog_owner','rd_owner','rd_fact_writer'))
     AND granted.rolname='replay_policy_catalog_owner'
     AND member.rolname='vibe_test_owner_topology_admin'
     AND grantor.rolname='postgres' AND NOT membership.admin_option
     AND membership.inherit_option AND membership.set_option;
  IF exact_protected_edge_count<>1 OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_auth_members membership
    JOIN pg_catalog.pg_roles granted ON granted.oid=membership.roleid
    JOIN pg_catalog.pg_roles member ON member.oid=membership.member
    WHERE (granted.rolname IN ('replay_policy_catalog_owner','rd_owner','rd_fact_writer')
        OR member.rolname IN ('replay_policy_catalog_owner','rd_owner','rd_fact_writer'))
      AND NOT (granted.rolname='replay_policy_catalog_owner'
           AND member.rolname='vibe_test_owner_topology_admin')
  ) THEN
    RAISE EXCEPTION 'Replay Policy Catalog membership fault lease mismatch' USING ERRCODE='55000';
  END IF;
  GRANT replay_policy_catalog_owner TO qualification_writer
    WITH ADMIN FALSE, INHERIT FALSE, SET FALSE;
  REVOKE replay_policy_catalog_owner FROM vibe_test_owner_topology_admin;
  SELECT pg_catalog.count(*) INTO exact_protected_edge_count
    FROM pg_catalog.pg_auth_members membership
    JOIN pg_catalog.pg_roles granted ON granted.oid=membership.roleid
    JOIN pg_catalog.pg_roles member ON member.oid=membership.member
    JOIN pg_catalog.pg_roles grantor ON grantor.oid=membership.grantor
   WHERE (granted.rolname IN ('replay_policy_catalog_owner','rd_owner','rd_fact_writer')
       OR member.rolname IN ('replay_policy_catalog_owner','rd_owner','rd_fact_writer'))
     AND granted.rolname='replay_policy_catalog_owner'
     AND member.rolname='qualification_writer'
     AND grantor.rolname='postgres' AND NOT membership.admin_option
     AND NOT membership.inherit_option AND NOT membership.set_option;
  IF exact_protected_edge_count<>1 OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_auth_members membership
    JOIN pg_catalog.pg_roles granted ON granted.oid=membership.roleid
    JOIN pg_catalog.pg_roles member ON member.oid=membership.member
    WHERE (granted.rolname IN ('replay_policy_catalog_owner','rd_owner','rd_fact_writer')
        OR member.rolname IN ('replay_policy_catalog_owner','rd_owner','rd_fact_writer'))
      AND NOT (granted.rolname='replay_policy_catalog_owner'
           AND member.rolname='qualification_writer')
  ) THEN
    RAISE EXCEPTION 'Replay Policy Catalog membership fault edge mismatch' USING ERRCODE='55000';
  END IF;
  UPDATE vibe_test_replay_policy_catalog_fault.authority_state_v1
     SET phase='MEMBERSHIP_FAULT'
   WHERE singleton AND phase='LEASED'
     AND lease_identity=expected_lease_identity;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Replay Policy Catalog membership fault phase advance failed' USING ERRCODE='55000';
  END IF;
  RETURN expected_lease_identity;
END
$function$;

CREATE FUNCTION vibe_test_replay_policy_catalog_fault.restore_third_party_owner_edge_v1(
  expected_marker_identity text,
  expected_lease_identity text
)
RETURNS text
LANGUAGE plpgsql STRICT VOLATILE PARALLEL UNSAFE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp
AS $function$
DECLARE
  exact_marker_count bigint;
  exact_protected_edge_count bigint;
  current_phase text;
  current_lease_identity text;
  last_released_lease_identity text;
BEGIN
  IF session_user<>'vibe_test_owner_topology_admin' OR current_user<>'postgres' THEN
    RAISE EXCEPTION 'Replay Policy Catalog membership fault caller mismatch' USING ERRCODE='42501';
  END IF;
  SELECT pg_catalog.count(*) INTO exact_marker_count
    FROM vibe_test_admin.dedicated_postgres_test_instance_v1 marker
   WHERE marker.marker_identity=expected_marker_identity
     AND marker.database_name=pg_catalog.current_database()
     AND marker.test_role='vibe_test_owner_topology_admin';
  IF exact_marker_count<>1 THEN
    RAISE EXCEPTION 'Replay Policy Catalog membership fault marker mismatch' USING ERRCODE='55000';
  END IF;
  SELECT state.phase,state.lease_identity,state.last_released_lease_identity
    INTO current_phase,current_lease_identity,last_released_lease_identity
    FROM vibe_test_replay_policy_catalog_fault.authority_state_v1 state
   WHERE state.singleton AND state.marker_identity=expected_marker_identity
     AND state.database_name=pg_catalog.current_database()
     AND state.execution_boundary=
       'isolated-disposable-postgres-container:sequential-shell-loop:v1'
   FOR UPDATE;
  IF current_phase='READY' AND current_lease_identity IS NULL
     AND last_released_lease_identity=expected_lease_identity THEN
    SELECT pg_catalog.count(*) INTO exact_protected_edge_count
      FROM pg_catalog.pg_auth_members membership
      JOIN pg_catalog.pg_roles granted ON granted.oid=membership.roleid
      JOIN pg_catalog.pg_roles member ON member.oid=membership.member
     WHERE granted.rolname IN ('replay_policy_catalog_owner','rd_owner','rd_fact_writer')
        OR member.rolname IN ('replay_policy_catalog_owner','rd_owner','rd_fact_writer');
    IF exact_protected_edge_count=0 THEN
      RETURN 'READY';
    END IF;
    RAISE EXCEPTION 'Replay Policy Catalog restored membership graph mismatch' USING ERRCODE='55000';
  END IF;
  IF current_phase IS DISTINCT FROM 'MEMBERSHIP_FAULT'
     OR current_lease_identity IS DISTINCT FROM expected_lease_identity THEN
    RAISE EXCEPTION 'Replay Policy Catalog membership fault phase mismatch' USING ERRCODE='55000';
  END IF;
  SELECT pg_catalog.count(*) INTO exact_protected_edge_count
    FROM pg_catalog.pg_auth_members membership
    JOIN pg_catalog.pg_roles granted ON granted.oid=membership.roleid
    JOIN pg_catalog.pg_roles member ON member.oid=membership.member
    JOIN pg_catalog.pg_roles grantor ON grantor.oid=membership.grantor
   WHERE (granted.rolname IN ('replay_policy_catalog_owner','rd_owner','rd_fact_writer')
       OR member.rolname IN ('replay_policy_catalog_owner','rd_owner','rd_fact_writer'))
     AND granted.rolname='replay_policy_catalog_owner'
     AND member.rolname='qualification_writer'
     AND grantor.rolname='postgres' AND NOT membership.admin_option
     AND NOT membership.inherit_option AND NOT membership.set_option;
  IF exact_protected_edge_count<>1 OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_auth_members membership
    JOIN pg_catalog.pg_roles granted ON granted.oid=membership.roleid
    JOIN pg_catalog.pg_roles member ON member.oid=membership.member
    WHERE (granted.rolname IN ('replay_policy_catalog_owner','rd_owner','rd_fact_writer')
        OR member.rolname IN ('replay_policy_catalog_owner','rd_owner','rd_fact_writer'))
      AND NOT (granted.rolname='replay_policy_catalog_owner'
           AND member.rolname='qualification_writer')
  ) THEN
    RAISE EXCEPTION 'Replay Policy Catalog membership fault edge mismatch' USING ERRCODE='55000';
  END IF;
  REVOKE replay_policy_catalog_owner FROM qualification_writer;
  SELECT pg_catalog.count(*) INTO exact_protected_edge_count
    FROM pg_catalog.pg_auth_members membership
    JOIN pg_catalog.pg_roles granted ON granted.oid=membership.roleid
    JOIN pg_catalog.pg_roles member ON member.oid=membership.member
   WHERE granted.rolname IN ('replay_policy_catalog_owner','rd_owner','rd_fact_writer')
      OR member.rolname IN ('replay_policy_catalog_owner','rd_owner','rd_fact_writer');
  IF exact_protected_edge_count<>0 THEN
    RAISE EXCEPTION 'Replay Policy Catalog membership fault restore failed' USING ERRCODE='55000';
  END IF;
  UPDATE vibe_test_replay_policy_catalog_fault.authority_state_v1
     SET phase='READY',lease_identity=NULL,
         last_released_lease_identity=expected_lease_identity
   WHERE singleton AND phase='MEMBERSHIP_FAULT'
     AND lease_identity=expected_lease_identity;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Replay Policy Catalog membership fault phase restore failed' USING ERRCODE='55000';
  END IF;
  RETURN 'READY';
END
$function$;

ALTER FUNCTION vibe_test_replay_policy_catalog_fault.acquire_v1(text,text) OWNER TO postgres;
ALTER FUNCTION vibe_test_replay_policy_catalog_fault.release_v1(text,text) OWNER TO postgres;
ALTER FUNCTION vibe_test_replay_policy_catalog_fault.inject_third_party_owner_edge_v1(text,text) OWNER TO postgres;
ALTER FUNCTION vibe_test_replay_policy_catalog_fault.restore_third_party_owner_edge_v1(text,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION vibe_test_replay_policy_catalog_fault.acquire_v1(text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION vibe_test_replay_policy_catalog_fault.release_v1(text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION vibe_test_replay_policy_catalog_fault.inject_third_party_owner_edge_v1(text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION vibe_test_replay_policy_catalog_fault.restore_third_party_owner_edge_v1(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vibe_test_replay_policy_catalog_fault.acquire_v1(text,text) TO vibe_test_owner_topology_admin;
GRANT EXECUTE ON FUNCTION vibe_test_replay_policy_catalog_fault.release_v1(text,text) TO vibe_test_owner_topology_admin;
GRANT EXECUTE ON FUNCTION vibe_test_replay_policy_catalog_fault.inject_third_party_owner_edge_v1(text,text) TO vibe_test_owner_topology_admin;
GRANT EXECUTE ON FUNCTION vibe_test_replay_policy_catalog_fault.restore_third_party_owner_edge_v1(text,text) TO vibe_test_owner_topology_admin;

CREATE SCHEMA vibe_test_legacy_migration_lease AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA vibe_test_legacy_migration_lease FROM PUBLIC;
GRANT USAGE ON SCHEMA vibe_test_legacy_migration_lease
  TO vibe_test_legacy_migration_caller;
CREATE TABLE vibe_test_legacy_migration_lease.authority_state_v1 (
  singleton boolean DEFAULT true NOT NULL,
  marker_identity text NOT NULL,
  database_name name NOT NULL,
  phase text NOT NULL,
  lease_identity text,
  last_released_lease_identity text,
  CONSTRAINT legacy_migration_authority_state_v1_singleton_pk PRIMARY KEY (singleton),
  CONSTRAINT legacy_migration_authority_state_v1_singleton_check CHECK (singleton),
  CONSTRAINT legacy_migration_authority_state_v1_phase_check CHECK (phase IN ('READY','LEASED')),
  CONSTRAINT legacy_migration_authority_state_v1_lease_check CHECK (
    (phase='READY' AND lease_identity IS NULL)
    OR (phase='LEASED' AND lease_identity IS NOT NULL)
  )
);
ALTER TABLE vibe_test_legacy_migration_lease.authority_state_v1 OWNER TO postgres;
REVOKE ALL ON TABLE vibe_test_legacy_migration_lease.authority_state_v1 FROM PUBLIC;
INSERT INTO vibe_test_legacy_migration_lease.authority_state_v1(
  singleton,marker_identity,database_name,phase,lease_identity,last_released_lease_identity
) VALUES (true,:'test_marker',:'test_database','READY',NULL,NULL);

CREATE FUNCTION vibe_test_legacy_migration_lease.acquire_v1(
  expected_marker_identity text,
  expected_lease_identity text
)
RETURNS text
LANGUAGE plpgsql STRICT VOLATILE PARALLEL UNSAFE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp
AS $function$
DECLARE
  exact_marker_count bigint;
  exact_membership_count bigint;
  exact_schema_create_count bigint;
  current_phase text;
  current_lease_identity text;
  last_released_lease_identity text;
BEGIN
  IF session_user<>'vibe_test_legacy_migration_caller' OR current_user<>'postgres' THEN
    RAISE EXCEPTION 'legacy Replay migration authority caller mismatch' USING ERRCODE='42501';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('vibe-test-exclusive-authority-v1',0)
  );
  SELECT pg_catalog.count(*) INTO exact_marker_count
    FROM vibe_test_admin.dedicated_postgres_test_instance_v1 marker
   WHERE marker.marker_identity=expected_marker_identity
     AND marker.database_name=pg_catalog.current_database()
     AND marker.test_role='vibe_test_legacy_migration_caller';
  IF exact_marker_count<>1 OR expected_lease_identity='' THEN
    RAISE EXCEPTION 'legacy Replay migration authority marker mismatch' USING ERRCODE='55000';
  END IF;
  SELECT state.phase,state.lease_identity,state.last_released_lease_identity
    INTO current_phase,current_lease_identity,last_released_lease_identity
    FROM vibe_test_legacy_migration_lease.authority_state_v1 state
   WHERE state.singleton AND state.marker_identity=expected_marker_identity
     AND state.database_name=pg_catalog.current_database()
   FOR UPDATE;
  IF current_phase='LEASED' AND current_lease_identity=expected_lease_identity THEN
    SELECT pg_catalog.count(*) INTO exact_membership_count
      FROM pg_catalog.pg_auth_members membership
      JOIN pg_catalog.pg_roles granted ON granted.oid=membership.roleid
      JOIN pg_catalog.pg_roles member ON member.oid=membership.member
      JOIN pg_catalog.pg_roles grantor ON grantor.oid=membership.grantor
     WHERE granted.rolname='rd_custodian' AND member.rolname='rd_owner'
       AND grantor.rolname='postgres' AND NOT membership.admin_option
       AND membership.inherit_option AND membership.set_option;
    SELECT pg_catalog.count(*) INTO exact_schema_create_count
      FROM pg_catalog.pg_namespace namespace
      CROSS JOIN LATERAL pg_catalog.aclexplode(namespace.nspacl) acl
     WHERE namespace.nspname='public'
       AND acl.grantee=pg_catalog.to_regrole('rd_owner')::oid
       AND acl.privilege_type='CREATE' AND NOT acl.is_grantable;
    IF exact_membership_count=1 AND exact_schema_create_count=1 THEN
      RETURN expected_lease_identity;
    END IF;
    RAISE EXCEPTION 'legacy Replay migration leased authority mismatch' USING ERRCODE='55000';
  END IF;
  IF current_phase IS DISTINCT FROM 'READY' OR current_lease_identity IS NOT NULL
     OR last_released_lease_identity=expected_lease_identity THEN
    RAISE EXCEPTION 'legacy Replay migration authority phase mismatch' USING ERRCODE='55000';
  END IF;
  IF pg_catalog.has_schema_privilege('rd_owner','public','CREATE')
     OR pg_catalog.pg_has_role('rd_owner','rd_custodian','MEMBER')
     OR EXISTS (
       SELECT 1 FROM vibe_test_replay_policy_catalog_fault.authority_state_v1 state
        WHERE NOT state.singleton OR state.marker_identity<>expected_marker_identity
           OR state.database_name<>pg_catalog.current_database()
           OR state.phase<>'READY' OR state.lease_identity IS NOT NULL
     ) THEN
    RAISE EXCEPTION 'legacy Replay migration authority is not clean' USING ERRCODE='55000';
  END IF;
  GRANT CREATE ON SCHEMA public TO rd_owner;
  GRANT rd_custodian TO rd_owner WITH ADMIN FALSE, INHERIT TRUE, SET TRUE;
  SELECT pg_catalog.count(*) INTO exact_membership_count
    FROM pg_catalog.pg_auth_members membership
    JOIN pg_catalog.pg_roles granted ON granted.oid=membership.roleid
    JOIN pg_catalog.pg_roles member ON member.oid=membership.member
    JOIN pg_catalog.pg_roles grantor ON grantor.oid=membership.grantor
   WHERE granted.rolname='rd_custodian' AND member.rolname='rd_owner'
     AND grantor.rolname='postgres' AND NOT membership.admin_option
     AND membership.inherit_option AND membership.set_option;
  SELECT pg_catalog.count(*) INTO exact_schema_create_count
    FROM pg_catalog.pg_namespace namespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(namespace.nspacl) acl
   WHERE namespace.nspname='public'
     AND acl.grantee=pg_catalog.to_regrole('rd_owner')::oid
     AND acl.privilege_type='CREATE' AND NOT acl.is_grantable;
  IF exact_membership_count<>1 OR exact_schema_create_count<>1 THEN
    RAISE EXCEPTION 'legacy Replay migration authority acquire mismatch' USING ERRCODE='55000';
  END IF;
  UPDATE vibe_test_legacy_migration_lease.authority_state_v1
     SET phase='LEASED',lease_identity=expected_lease_identity
   WHERE singleton AND phase='READY' AND lease_identity IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'legacy Replay migration authority phase advance failed' USING ERRCODE='55000';
  END IF;
  RETURN expected_lease_identity;
END
$function$;

CREATE FUNCTION vibe_test_legacy_migration_lease.release_v1(
  expected_marker_identity text,
  expected_lease_identity text
)
RETURNS text
LANGUAGE plpgsql STRICT VOLATILE PARALLEL UNSAFE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp
AS $function$
DECLARE
  exact_marker_count bigint;
  current_phase text;
  current_lease_identity text;
  last_released_lease_identity text;
BEGIN
  IF session_user<>'vibe_test_legacy_migration_caller' OR current_user<>'postgres' THEN
    RAISE EXCEPTION 'legacy Replay migration authority caller mismatch' USING ERRCODE='42501';
  END IF;
  SELECT pg_catalog.count(*) INTO exact_marker_count
    FROM vibe_test_admin.dedicated_postgres_test_instance_v1 marker
   WHERE marker.marker_identity=expected_marker_identity
     AND marker.database_name=pg_catalog.current_database()
     AND marker.test_role='vibe_test_legacy_migration_caller';
  IF exact_marker_count<>1 OR expected_lease_identity='' THEN
    RAISE EXCEPTION 'legacy Replay migration authority marker mismatch' USING ERRCODE='55000';
  END IF;
  SELECT state.phase,state.lease_identity,state.last_released_lease_identity
    INTO current_phase,current_lease_identity,last_released_lease_identity
    FROM vibe_test_legacy_migration_lease.authority_state_v1 state
   WHERE state.singleton AND state.marker_identity=expected_marker_identity
     AND state.database_name=pg_catalog.current_database()
   FOR UPDATE;
  IF current_phase='READY' AND current_lease_identity IS NULL
     AND (last_released_lease_identity IS NULL
          OR last_released_lease_identity=expected_lease_identity) THEN
    IF NOT pg_catalog.has_schema_privilege('rd_owner','public','CREATE')
       AND NOT pg_catalog.pg_has_role('rd_owner','rd_custodian','MEMBER') THEN
      RETURN 'READY';
    END IF;
    RAISE EXCEPTION 'legacy Replay migration released authority mismatch' USING ERRCODE='55000';
  END IF;
  IF current_phase IS DISTINCT FROM 'LEASED'
     OR current_lease_identity IS DISTINCT FROM expected_lease_identity THEN
    RAISE EXCEPTION 'legacy Replay migration authority phase mismatch' USING ERRCODE='55000';
  END IF;
  REVOKE CREATE ON SCHEMA public FROM rd_owner;
  REVOKE rd_custodian FROM rd_owner;
  IF pg_catalog.has_schema_privilege('rd_owner','public','CREATE')
     OR pg_catalog.pg_has_role('rd_owner','rd_custodian','MEMBER') THEN
    RAISE EXCEPTION 'legacy Replay migration authority release mismatch' USING ERRCODE='55000';
  END IF;
  UPDATE vibe_test_legacy_migration_lease.authority_state_v1
     SET phase='READY',lease_identity=NULL,
         last_released_lease_identity=expected_lease_identity
   WHERE singleton AND phase='LEASED' AND lease_identity=expected_lease_identity;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'legacy Replay migration authority phase release failed' USING ERRCODE='55000';
  END IF;
  RETURN 'READY';
END
$function$;

ALTER FUNCTION vibe_test_legacy_migration_lease.acquire_v1(text,text) OWNER TO postgres;
ALTER FUNCTION vibe_test_legacy_migration_lease.release_v1(text,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION vibe_test_legacy_migration_lease.acquire_v1(text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION vibe_test_legacy_migration_lease.release_v1(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vibe_test_legacy_migration_lease.acquire_v1(text,text)
  TO vibe_test_legacy_migration_caller;
GRANT EXECUTE ON FUNCTION vibe_test_legacy_migration_lease.release_v1(text,text)
  TO vibe_test_legacy_migration_caller;

CREATE SCHEMA vibe_test_legacy_replay_fault AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA vibe_test_legacy_replay_fault FROM PUBLIC;
GRANT USAGE ON SCHEMA vibe_test_legacy_replay_fault TO vibe_test_legacy_replay_fault_writer;
CREATE FUNCTION vibe_test_legacy_replay_fault.create_duplicate_current_candidate_v1(
  expected_marker_identity text
)
RETURNS void
LANGUAGE plpgsql STRICT VOLATILE PARALLEL UNSAFE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp
AS $function$
DECLARE
  exact_marker_count bigint;
  selected_row_count bigint;
BEGIN
  IF session_user<>'vibe_test_legacy_replay_fault_writer' OR current_user<>'postgres' THEN
    RAISE EXCEPTION 'legacy Replay fault caller mismatch' USING ERRCODE='42501';
  END IF;
  SELECT pg_catalog.count(*) INTO exact_marker_count
    FROM vibe_test_admin.dedicated_postgres_test_instance_v1 marker
   WHERE marker.marker_identity=expected_marker_identity
     AND marker.database_name=pg_catalog.current_database()
     AND marker.test_role='vibe_test_legacy_replay_fault_writer';
  IF exact_marker_count<>1 THEN
    RAISE EXCEPTION 'legacy Replay fault database marker mismatch' USING ERRCODE='55000';
  END IF;
  IF pg_catalog.to_regclass('public.rd_exploratory_replay_request_custody_v1') IS NOT NULL THEN
    RAISE EXCEPTION 'legacy Replay duplicate already exists' USING ERRCODE='55000';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class relation
      JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace
      JOIN pg_catalog.pg_roles owner ON owner.oid=relation.relowner
     WHERE namespace.nspname='public'
       AND relation.relname='rd_sealed_exploratory_replay_requests_v1'
       AND relation.relkind='r' AND relation.relpersistence='p'
       AND owner.rolname='rd_custodian'
  ) THEN
    RAISE EXCEPTION 'sealed Replay source unavailable' USING ERRCODE='55000';
  END IF;
  SELECT pg_catalog.count(*) INTO selected_row_count
    FROM public.rd_sealed_exploratory_replay_requests_v1 sealed
   WHERE sealed.request_identity='internal-continuity-replay-v1';
  IF selected_row_count<>1 THEN
    RAISE EXCEPTION 'legacy Replay selected row mismatch' USING ERRCODE='55000';
  END IF;

  CREATE TABLE public.rd_exploratory_replay_request_custody_v1
    (LIKE public.rd_sealed_exploratory_replay_requests_v1 INCLUDING ALL);
  INSERT INTO public.rd_exploratory_replay_request_custody_v1
  SELECT * FROM public.rd_sealed_exploratory_replay_requests_v1
   WHERE request_identity='internal-continuity-replay-v1';
  GET DIAGNOSTICS selected_row_count=ROW_COUNT;
  IF selected_row_count<>1 THEN
    RAISE EXCEPTION 'legacy Replay duplicate copy mismatch' USING ERRCODE='55000';
  END IF;
  ALTER TABLE public.rd_exploratory_replay_request_custody_v1 OWNER TO rd_owner;
  GRANT SELECT,UPDATE ON TABLE public.rd_exploratory_replay_request_custody_v1
    TO surprise_replay_grantee;
  REVOKE EXECUTE ON FUNCTION
    vibe_test_legacy_replay_fault.create_duplicate_current_candidate_v1(text)
    FROM vibe_test_legacy_replay_fault_writer;
END
$function$;
ALTER FUNCTION vibe_test_legacy_replay_fault.create_duplicate_current_candidate_v1(text)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION
  vibe_test_legacy_replay_fault.create_duplicate_current_candidate_v1(text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  vibe_test_legacy_replay_fault.create_duplicate_current_candidate_v1(text)
  TO vibe_test_legacy_replay_fault_writer;
SQL

docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
  --username postgres --dbname postgres \
  --set=test_database="$test_database" \
  --set=origin_current_database="$origin_current_database" << 'SQL'
CREATE DATABASE :"origin_current_database" WITH TEMPLATE :"test_database" OWNER rd_database_owner;
REVOKE CONNECT,TEMPORARY ON DATABASE :"origin_current_database" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"origin_current_database"
  TO operator_authorization_writer, product_edge_owner, rd_owner, rd_fact_writer, qualification_writer, backtest_owner, vibe_test_owner_topology_admin, vibe_test_legacy_migration_caller;
SQL

docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
  --username postgres --dbname "$origin_current_database" << 'SQL'
DO $origin_database_acl$
DECLARE runtime_role text;
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_database AS db
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(db.datacl, pg_catalog.acldefault('d', db.datdba))
      ) AS acl(grantor, grantee, privilege_type, is_grantable)
     WHERE db.datname = pg_catalog.current_database()
       AND acl.grantee = 0
       AND acl.privilege_type IN ('CONNECT', 'TEMPORARY')
  ) THEN
    RAISE EXCEPTION 'origin-current PUBLIC database privilege survived clone';
  END IF;
  FOREACH runtime_role IN ARRAY ARRAY[
    'operator_authorization_writer','product_edge_owner','rd_owner','rd_fact_writer',
    'qualification_writer','backtest_owner'
  ] LOOP
    IF NOT pg_catalog.has_database_privilege(
         runtime_role,pg_catalog.current_database(),'CONNECT'
       )
       OR pg_catalog.has_database_privilege(
         runtime_role,pg_catalog.current_database(),'CREATE,TEMPORARY'
       ) THEN
      RAISE EXCEPTION 'origin-current runtime database ACL mismatch for %',runtime_role;
    END IF;
  END LOOP;
END
$origin_database_acl$;
SQL

docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
  --username postgres --dbname "$origin_current_database" \
  --set=origin_current_database="$origin_current_database" << 'SQL'
UPDATE vibe_test_admin.dedicated_postgres_test_instance_v1
   SET database_name=:'origin_current_database';
UPDATE vibe_test_replay_policy_catalog_fault.authority_state_v1
   SET database_name=:'origin_current_database';
UPDATE vibe_test_legacy_migration_lease.authority_state_v1
   SET database_name=:'origin_current_database';
SQL

docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
  --username postgres --dbname "$test_database" << 'SQL'
CREATE ROLE surprise_replay_grantee NOLOGIN;
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

legacy_replay_fingerprint() {
  docker exec --interactive "$container" psql --quiet --tuples-only --no-align \
    --set ON_ERROR_STOP=1 --username postgres --dbname "$test_database" << 'SQL'
SELECT 'count=' || pg_catalog.count(*)::text
  FROM public.rd_exploratory_replay_requests_v1;

SELECT 'oid=' || 'public.rd_exploratory_replay_requests_v1'::pg_catalog.regclass::oid::text;

SELECT 'data_bytes_md5=' || pg_catalog.md5(COALESCE(
  pg_catalog.string_agg(
    pg_catalog.encode(
      pg_catalog.convert_to(pg_catalog.row_to_json(legacy)::text, 'UTF8'),
      'hex'
    ),
    E'\n' ORDER BY replay_request_identity
  ),
  ''
))
  FROM public.rd_exploratory_replay_requests_v1 legacy;

SELECT 'catalog_md5=' || pg_catalog.md5(
  relation.relkind::text || ':' ||
  relation.relpersistence::text || ':' ||
  relation.relreplident::text || ':' ||
  COALESCE(relation.reloptions::text, '<NULL>') || ':' ||
  COALESCE(pg_catalog.obj_description(relation.oid, 'pg_class'), '<NULL>') || ':' ||
  COALESCE((
    SELECT pg_catalog.string_agg(
      attribute.attnum::text || ':' ||
      attribute.attname || ':' ||
      pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) || ':' ||
      attribute.attnotnull::text || ':' ||
      attribute.attidentity::text || ':' ||
      attribute.attgenerated::text || ':' ||
      COALESCE(attribute.attacl::text, '<NULL>') || ':' ||
      COALESCE(pg_catalog.pg_get_expr(default_entry.adbin, default_entry.adrelid), '<NULL>'),
      E'\n' ORDER BY attribute.attnum
    )
      FROM pg_catalog.pg_attribute attribute
      LEFT JOIN pg_catalog.pg_attrdef default_entry
        ON default_entry.adrelid=attribute.attrelid
       AND default_entry.adnum=attribute.attnum
     WHERE attribute.attrelid=relation.oid
       AND attribute.attnum>0
       AND NOT attribute.attisdropped
  ), '<NULL>') || ':' ||
  COALESCE((
    SELECT pg_catalog.string_agg(
      constraint_entry.conname || ':' ||
      constraint_entry.contype::text || ':' ||
      pg_catalog.pg_get_constraintdef(constraint_entry.oid, true),
      E'\n' ORDER BY constraint_entry.conname
    )
      FROM pg_catalog.pg_constraint constraint_entry
     WHERE constraint_entry.conrelid=relation.oid
  ), '<NULL>') || ':' ||
  COALESCE((
    SELECT pg_catalog.string_agg(
      pg_catalog.pg_get_indexdef(index_entry.indexrelid),
      E'\n' ORDER BY index_entry.indexrelid::pg_catalog.regclass::text
    )
      FROM pg_catalog.pg_index index_entry
     WHERE index_entry.indrelid=relation.oid
  ), '<NULL>')
)
  FROM pg_catalog.pg_class relation
 WHERE relation.oid='public.rd_exploratory_replay_requests_v1'::pg_catalog.regclass;

SQL
}

legacy_replay_fingerprint_before="$(legacy_replay_fingerprint)"
readonly legacy_replay_fingerprint_before

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
export RD_OWNER_PARTIAL_SEALED_TEST_DATABASE_URL="postgresql://rd_owner:${test_password}@${postgres_host}:${postgres_port}/${partial_sealed_database}"
export RD_OWNER_PARTIAL_SEALED_ROUTINE_TEST_DATABASE_URL="postgresql://rd_owner:${test_password}@${postgres_host}:${postgres_port}/${partial_sealed_routine_database}"
export QUALIFICATION_WRITER_FRESH_TEST_DATABASE_URL="postgresql://qualification_writer:${test_password}@${postgres_host}:${postgres_port}/${test_database}"
export OPERATOR_AUTHORIZATION_TEST_DATABASE_URL="postgresql://operator_authorization_writer:${test_password}@${postgres_host}:${postgres_port}/${test_database}"
export PRODUCT_EDGE_TEST_DATABASE_URL="postgresql://product_edge_owner:${test_password}@${postgres_host}:${postgres_port}/${test_database}"
export RD_OWNER_TEST_DATABASE_URL="postgresql://rd_owner:${test_password}@${postgres_host}:${postgres_port}/${test_database}"
export RD_FACT_WRITER_TEST_DATABASE_URL="postgresql://rd_fact_writer:${test_password}@${postgres_host}:${postgres_port}/${test_database}"
export RD_OWNER_DRAIN_ALIAS_TEST_DATABASE_URL="postgresql://rd_owner:${test_password}@${postgres_alias_host}:${postgres_alias_port}/${test_database}"
export QUALIFICATION_TEST_DATABASE_URL="postgresql://qualification_writer:${test_password}@${postgres_host}:${postgres_port}/${test_database}"
export BACKTEST_TEST_DATABASE_URL="postgresql://backtest_owner:${test_password}@${postgres_host}:${postgres_port}/${test_database}"
export VIBE_TEST_OWNER_TOPOLOGY_ADMIN_DATABASE_URL="postgresql://vibe_test_owner_topology_admin:${test_password}@${postgres_host}:${postgres_port}/${test_database}"
export VIBE_TEST_LEGACY_REPLAY_FAULT_DATABASE_URL="postgresql://vibe_test_legacy_replay_fault_writer:${test_password}@${postgres_host}:${postgres_port}/${test_database}"
export VIBE_TEST_LEGACY_MIGRATION_DATABASE_URL="postgresql://vibe_test_legacy_migration_caller:${test_password}@${postgres_host}:${postgres_port}/${test_database}"
export BACKTEST_IMPERSONATOR_TEST_DATABASE_URL="postgresql://backtest_owner:${impersonator_password}@${impersonator_host}:${impersonator_port}/${impersonator_database}"
primary_socket_host="${primary_socket_dir//\//%2F}"
impersonator_socket_host="${impersonator_socket_dir//\//%2F}"
export RD_OWNER_SOCKET_TEST_DATABASE_URL="postgresql://rd_owner:${test_password}@localhost/${test_database}?host=${primary_socket_host}"
export RD_FACT_WRITER_SOCKET_TEST_DATABASE_URL="postgresql://rd_fact_writer:${test_password}@localhost/${test_database}?host=${primary_socket_host}"
export RD_FACT_WRITER_IMPERSONATOR_TEST_DATABASE_URL="postgresql://rd_fact_writer:${impersonator_password}@localhost/${test_database}?host=${impersonator_socket_host}"
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

revoke_runtime_schema_create() {
  local fixture_database="$1"
  docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
    --username postgres --dbname "$fixture_database" << 'SQL'
REVOKE CREATE ON SCHEMA public
  FROM rd_owner, product_edge_owner, vibe_test_owner_topology_admin;
DO $runtime_acl$
BEGIN
  IF pg_catalog.has_schema_privilege('rd_owner','public','CREATE')
     OR pg_catalog.has_schema_privilege('product_edge_owner','public','CREATE')
     OR pg_catalog.has_schema_privilege('vibe_test_owner_topology_admin','public','CREATE')
     OR pg_catalog.has_database_privilege(
       'rd_owner',pg_catalog.current_database(),'CREATE,TEMPORARY'
     )
     OR pg_catalog.has_database_privilege(
       'product_edge_owner',pg_catalog.current_database(),'CREATE,TEMPORARY'
     ) THEN
    RAISE EXCEPTION 'Owner migration authority survived deployment';
  END IF;
END
$runtime_acl$;
SQL
}

provision_owner_schemas() {
  local fixture_database="$1"
  local admin_url="postgresql://vibe_test_owner_topology_admin:${test_password}@${postgres_host}:${postgres_port}/${fixture_database}"
  local rd_sealed_owner_url="postgresql://rd_owner:${test_password}@${postgres_host}:${postgres_port}/${fixture_database}"
  local rd_fresh_database="${fixture_database}_rd_fresh"
  local rd_fresh_owner_url="postgresql://rd_owner:${test_password}@${postgres_host}:${postgres_port}/${rd_fresh_database}"
  local rd_schema_lease_failure_database="${fixture_database}_rd_schema_lease_failure"
  local rd_schema_lease_failure_owner_url="postgresql://rd_owner:${test_password}@${postgres_host}:${postgres_port}/${rd_schema_lease_failure_database}"
  local artifact_fresh_database="${fixture_database}_artifact_fresh"
  local artifact_fresh_admin_url="postgresql://vibe_test_owner_topology_admin:${test_password}@${postgres_host}:${postgres_port}/${artifact_fresh_database}"
  local qualification_url="postgresql://qualification_writer:${test_password}@${postgres_host}:${postgres_port}/${fixture_database}"
  local product_edge_filter='package(vibe-strategy-factory) & binary(exploratory_replay_request_owner) & test(=product_edge_schema_is_provisioned_before_runtime_connections)'
  local rd_owner_filter='package(vibe-strategy-factory) & binary(exploratory_replay_request_owner) & (test(=rd_owner_schema_is_provisioned_before_runtime_connections) | test(=rd_owner_schema_third_party_create_grant_fails_atomically))'
  local artifact_filter='package(vibe-strategy-factory) & binary(vibe_strategy_factory) & test(=artifact_build_postgres::postgres_freshness_tests::artifact_schema_is_provisioned_by_topology_admin)'

  docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
    --username postgres --dbname "$fixture_database" << 'SQL'
BEGIN;
GRANT product_edge_custodian TO vibe_test_owner_topology_admin
  WITH ADMIN FALSE, INHERIT TRUE, SET TRUE;
DO $product_edge_migration_lease$
DECLARE exact_edge_count bigint;
BEGIN
  SELECT pg_catalog.count(*) INTO exact_edge_count
    FROM pg_catalog.pg_auth_members membership
    JOIN pg_catalog.pg_roles granted ON granted.oid=membership.roleid
    JOIN pg_catalog.pg_roles member ON member.oid=membership.member
    JOIN pg_catalog.pg_roles grantor ON grantor.oid=membership.grantor
   WHERE granted.rolname='product_edge_custodian'
     AND member.rolname='vibe_test_owner_topology_admin'
     AND grantor.rolname='postgres' AND NOT membership.admin_option
     AND membership.inherit_option AND membership.set_option;
  IF exact_edge_count<>1 OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_auth_members membership
    JOIN pg_catalog.pg_roles granted ON granted.oid=membership.roleid
    JOIN pg_catalog.pg_roles member ON member.oid=membership.member
    JOIN pg_catalog.pg_roles grantor ON grantor.oid=membership.grantor
    WHERE (granted.rolname='product_edge_custodian'
        OR member.rolname='product_edge_custodian')
      AND NOT (granted.rolname='product_edge_custodian'
           AND member.rolname='vibe_test_owner_topology_admin'
           AND grantor.rolname='postgres' AND NOT membership.admin_option
           AND membership.inherit_option AND membership.set_option)
  ) THEN
    RAISE EXCEPTION 'Product Edge fresh migration lease membership mismatch';
  END IF;
END
$product_edge_migration_lease$;
COMMIT;
SQL

  local product_edge_test_status=0
  if env PRODUCT_EDGE_TEST_DATABASE_URL="$admin_url" \
    cargo nextest run \
    --archive-file "$nextest_archive_file" \
    --profile "$nextest_profile" \
    "${nextest_execution_args[@]}" \
    -E "$product_edge_filter"; then
    :
  else
    product_edge_test_status="$?"
  fi

  docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
    --username postgres --dbname "$fixture_database" << 'SQL'
BEGIN;
REVOKE product_edge_custodian FROM vibe_test_owner_topology_admin;
DO $product_edge_migration_cleanup$
DECLARE protected_edge_count bigint;
BEGIN
  SELECT pg_catalog.count(*) INTO protected_edge_count
    FROM pg_catalog.pg_auth_members membership
    JOIN pg_catalog.pg_roles granted ON granted.oid=membership.roleid
    JOIN pg_catalog.pg_roles member ON member.oid=membership.member
   WHERE granted.rolname='product_edge_custodian'
      OR member.rolname='product_edge_custodian';
  IF protected_edge_count<>0 THEN
    RAISE EXCEPTION 'Product Edge custodian membership cleanup failed';
  END IF;
END
$product_edge_migration_cleanup$;
COMMIT;
SQL

  if [[ "$product_edge_test_status" -ne 0 ]]; then
    return "$product_edge_test_status"
  fi

  docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
    --username postgres --dbname postgres \
    --set=rd_fresh_database="$rd_fresh_database" \
    --set=rd_schema_lease_failure_database="$rd_schema_lease_failure_database" << 'SQL'
CREATE DATABASE :"rd_fresh_database" OWNER rd_database_owner;
REVOKE CONNECT ON DATABASE :"rd_fresh_database" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"rd_fresh_database"
  TO rd_owner;
GRANT CREATE ON DATABASE :"rd_fresh_database" TO rd_owner;
CREATE DATABASE :"rd_schema_lease_failure_database" OWNER rd_database_owner;
REVOKE CONNECT ON DATABASE :"rd_schema_lease_failure_database" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"rd_schema_lease_failure_database" TO rd_owner;
GRANT CREATE ON DATABASE :"rd_schema_lease_failure_database" TO rd_owner;
SQL
  docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
    --username postgres --dbname "$rd_fresh_database" << 'SQL'
CREATE SCHEMA rd_owner_api AUTHORIZATION rd_owner;
GRANT CREATE ON SCHEMA public TO rd_owner;
SQL
  docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
    --username postgres --dbname "$rd_schema_lease_failure_database" << 'SQL'
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT CREATE ON SCHEMA public TO rd_owner;
CREATE SCHEMA rd_owner_api AUTHORIZATION rd_owner;
REVOKE ALL ON SCHEMA rd_owner_api FROM PUBLIC;
GRANT CREATE ON SCHEMA rd_owner_api TO surprise_replay_grantee;
SQL

  docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
    --username postgres --dbname "$fixture_database" << 'SQL'
BEGIN;
GRANT rd_custodian TO rd_owner
  WITH ADMIN FALSE, INHERIT TRUE, SET TRUE;
DO $rd_owner_migration_lease$
DECLARE exact_edge_count bigint;
BEGIN
  SELECT pg_catalog.count(*) INTO exact_edge_count
    FROM pg_catalog.pg_auth_members membership
    JOIN pg_catalog.pg_roles granted ON granted.oid=membership.roleid
    JOIN pg_catalog.pg_roles member ON member.oid=membership.member
    JOIN pg_catalog.pg_roles grantor ON grantor.oid=membership.grantor
   WHERE (granted.rolname IN ('rd_custodian','rd_owner','rd_fact_writer')
       OR member.rolname IN ('rd_custodian','rd_owner','rd_fact_writer'))
     AND granted.rolname='rd_custodian'
     AND member.rolname='rd_owner'
     AND grantor.rolname='postgres' AND NOT membership.admin_option
     AND membership.inherit_option AND membership.set_option;
  IF exact_edge_count<>1 OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_auth_members membership
    JOIN pg_catalog.pg_roles granted ON granted.oid=membership.roleid
    JOIN pg_catalog.pg_roles member ON member.oid=membership.member
    WHERE (granted.rolname IN ('rd_custodian','rd_owner','rd_fact_writer')
        OR member.rolname IN ('rd_custodian','rd_owner','rd_fact_writer'))
      AND NOT (granted.rolname='rd_custodian'
           AND member.rolname='rd_owner')
  ) THEN
    RAISE EXCEPTION 'R&D fresh migration lease membership mismatch';
  END IF;
END
$rd_owner_migration_lease$;
COMMIT;
SQL

  local rd_owner_test_status=0
  if env \
    RD_OWNER_SEALED_TEST_DATABASE_URL="$rd_sealed_owner_url" \
    RD_OWNER_FRESH_TEST_DATABASE_URL="$rd_fresh_owner_url" \
    RD_OWNER_SCHEMA_LEASE_FAILURE_TEST_DATABASE_URL="$rd_schema_lease_failure_owner_url" \
    QUALIFICATION_WRITER_FRESH_TEST_DATABASE_URL="$qualification_url" \
    cargo nextest run \
    --archive-file "$nextest_archive_file" \
    --profile "$nextest_profile" \
    "${nextest_execution_args[@]}" \
    -E "$rd_owner_filter"; then
    :
  else
    rd_owner_test_status="$?"
  fi

  docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
    --username postgres --dbname "$fixture_database" << 'SQL'
REVOKE rd_custodian FROM rd_owner;
DO $rd_owner_migration_cleanup$
DECLARE protected_edge_count bigint;
BEGIN
  SELECT pg_catalog.count(*) INTO protected_edge_count
    FROM pg_catalog.pg_auth_members membership
    JOIN pg_catalog.pg_roles granted ON granted.oid=membership.roleid
    JOIN pg_catalog.pg_roles member ON member.oid=membership.member
   WHERE granted.rolname IN ('rd_custodian','rd_owner','rd_fact_writer')
      OR member.rolname IN ('rd_custodian','rd_owner','rd_fact_writer');
  IF protected_edge_count<>0 THEN
    RAISE EXCEPTION 'Replay Policy Catalog/R&D protected membership cleanup failed';
  END IF;
END
$rd_owner_migration_cleanup$;
SQL

  docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
    --username postgres --dbname postgres \
    --set=rd_fresh_database="$rd_fresh_database" \
    --set=rd_schema_lease_failure_database="$rd_schema_lease_failure_database" << 'SQL'
DROP DATABASE :"rd_fresh_database" WITH (FORCE);
DROP DATABASE :"rd_schema_lease_failure_database" WITH (FORCE);
SQL

  if [[ "$rd_owner_test_status" -ne 0 ]]; then
    return "$rd_owner_test_status"
  fi

  docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
    --username postgres --dbname postgres \
    --set=artifact_fresh_database="$artifact_fresh_database" << 'SQL'
CREATE DATABASE :"artifact_fresh_database" OWNER rd_database_owner;
REVOKE ALL ON DATABASE :"artifact_fresh_database" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"artifact_fresh_database"
  TO vibe_test_owner_topology_admin;
SQL
  docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
    --username postgres --dbname "$artifact_fresh_database" << 'SQL'
BEGIN;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
CREATE SCHEMA rd_owner_api AUTHORIZATION rd_owner;
REVOKE ALL ON SCHEMA rd_owner_api FROM PUBLIC;
GRANT CREATE ON SCHEMA public TO vibe_test_owner_topology_admin;
GRANT USAGE ON SCHEMA rd_owner_api TO vibe_test_owner_topology_admin;
GRANT CREATE ON SCHEMA rd_owner_api TO rd_custodian;
GRANT rd_custodian TO vibe_test_owner_topology_admin
  WITH ADMIN FALSE, INHERIT TRUE, SET TRUE;
DO $artifact_migration_lease$
BEGIN
  IF pg_catalog.pg_get_userbyid((
       SELECT namespace.nspowner
         FROM pg_catalog.pg_namespace namespace
        WHERE namespace.nspname='rd_owner_api'
     )) IS DISTINCT FROM 'rd_owner'
     OR NOT pg_catalog.has_database_privilege(
       'vibe_test_owner_topology_admin',pg_catalog.current_database(),'CONNECT'
     )
     OR pg_catalog.has_database_privilege(
       'vibe_test_owner_topology_admin',pg_catalog.current_database(),'CREATE,TEMPORARY'
     )
     OR EXISTS (
       WITH admitted(grantee,privilege_type,is_grantable) AS (VALUES
         ('vibe_test_owner_topology_admin','CONNECT',false)
       ), actual AS (
         SELECT COALESCE(grantee.rolname,'PUBLIC'),
                acl.privilege_type,
                acl.is_grantable
           FROM pg_catalog.pg_database database_entry
           CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(
             database_entry.datacl,
             pg_catalog.acldefault('d',database_entry.datdba)
           )) acl
           LEFT JOIN pg_catalog.pg_roles grantee ON grantee.oid=acl.grantee
          WHERE database_entry.datname=pg_catalog.current_database()
            AND acl.grantee<>database_entry.datdba
       )
       SELECT * FROM admitted EXCEPT SELECT * FROM actual
       UNION ALL
       SELECT * FROM actual EXCEPT SELECT * FROM admitted
     )
     OR NOT pg_catalog.has_schema_privilege(
       'vibe_test_owner_topology_admin','public','CREATE'
     )
     OR NOT pg_catalog.has_schema_privilege(
       'vibe_test_owner_topology_admin','rd_owner_api','CREATE'
     )
     OR NOT pg_catalog.has_schema_privilege(
       'vibe_test_owner_topology_admin','rd_owner_api','USAGE'
     )
     OR (SELECT pg_catalog.count(*)<>1
           OR pg_catalog.count(*) FILTER (
             WHERE granted.rolname='rd_custodian'
               AND member.rolname='vibe_test_owner_topology_admin'
               AND grantor.rolname='postgres'
               AND NOT membership.admin_option
               AND membership.inherit_option
               AND membership.set_option
           )<>1
         FROM pg_catalog.pg_auth_members membership
         JOIN pg_catalog.pg_roles granted ON granted.oid=membership.roleid
         JOIN pg_catalog.pg_roles member ON member.oid=membership.member
         JOIN pg_catalog.pg_roles grantor ON grantor.oid=membership.grantor
        WHERE granted.rolname='rd_custodian'
           OR member.rolname='rd_custodian')
     OR EXISTS (
       WITH admitted(schema_name,grantee,privilege_type,is_grantable) AS (VALUES
         ('public','PUBLIC','USAGE',false),
         ('public','pg_database_owner','CREATE',false),
         ('public','pg_database_owner','USAGE',false),
         ('public','vibe_test_owner_topology_admin','CREATE',false),
         ('rd_owner_api','rd_custodian','CREATE',false),
         ('rd_owner_api','rd_owner','CREATE',false),
         ('rd_owner_api','rd_owner','USAGE',false),
         ('rd_owner_api','vibe_test_owner_topology_admin','USAGE',false)
       ), actual AS (
         SELECT namespace.nspname,
                COALESCE(grantee.rolname,'PUBLIC'),
                acl.privilege_type,
                acl.is_grantable
           FROM pg_catalog.pg_namespace namespace
           CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(
             namespace.nspacl,
             pg_catalog.acldefault('n',namespace.nspowner)
           )) acl
           LEFT JOIN pg_catalog.pg_roles grantee ON grantee.oid=acl.grantee
          WHERE namespace.nspname IN ('public','rd_owner_api')
       )
       SELECT * FROM admitted EXCEPT SELECT * FROM actual
       UNION ALL
       SELECT * FROM actual EXCEPT SELECT * FROM admitted
     ) THEN
    RAISE EXCEPTION 'Artifact fresh migration lease topology mismatch';
  END IF;
END
$artifact_migration_lease$;
COMMIT;
SQL

  local artifact_test_status=0
  if env RD_ARTIFACT_ADMIN_DATABASE_URL="$artifact_fresh_admin_url" \
    cargo nextest run \
    --archive-file "$nextest_archive_file" \
    --profile "$nextest_profile" \
    "${nextest_execution_args[@]}" \
    -E "$artifact_filter"; then
    :
  else
    artifact_test_status="$?"
  fi

  docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
    --username postgres --dbname "$artifact_fresh_database" << 'SQL'
BEGIN;
REVOKE CREATE ON SCHEMA public FROM vibe_test_owner_topology_admin;
REVOKE USAGE ON SCHEMA rd_owner_api FROM vibe_test_owner_topology_admin;
REVOKE CREATE ON SCHEMA rd_owner_api FROM rd_custodian;
REVOKE rd_custodian FROM vibe_test_owner_topology_admin;
DO $artifact_migration_cleanup$
BEGIN
  IF pg_catalog.pg_has_role(
       'vibe_test_owner_topology_admin','rd_custodian','MEMBER'
     )
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.pg_auth_members membership
         JOIN pg_catalog.pg_roles granted ON granted.oid=membership.roleid
         JOIN pg_catalog.pg_roles member ON member.oid=membership.member
        WHERE granted.rolname='rd_custodian'
           OR member.rolname='rd_custodian'
     )
     OR pg_catalog.has_schema_privilege(
       'vibe_test_owner_topology_admin','public','CREATE'
     )
     OR pg_catalog.has_schema_privilege(
       'vibe_test_owner_topology_admin','rd_owner_api','CREATE'
     )
     OR pg_catalog.has_schema_privilege(
       'vibe_test_owner_topology_admin','rd_owner_api','USAGE'
     )
     OR pg_catalog.has_schema_privilege(
       'rd_custodian','rd_owner_api','CREATE'
     ) THEN
    RAISE EXCEPTION 'Artifact fresh migration lease cleanup failed';
  END IF;
END
$artifact_migration_cleanup$;
COMMIT;
SQL

  docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
    --username postgres --dbname postgres \
    --set=artifact_fresh_database="$artifact_fresh_database" << 'SQL'
REVOKE CONNECT ON DATABASE :"artifact_fresh_database"
  FROM vibe_test_owner_topology_admin;
DROP DATABASE :"artifact_fresh_database" WITH (FORCE);
SQL

  if [[ "$artifact_test_status" -ne 0 ]]; then
    return "$artifact_test_status"
  fi
}

readonly legacy_normalization_lease_identity="legacy-replay-migration:${test_marker}:pre-authority-normalization:v2"
readonly legacy_normalization_filter='package(vibe-strategy-factory) & binary(vibe_strategy_factory) & test(=product_edge_postgres::tests::legacy_rd_owner_storage_is_normalized_before_authority_migration)'

legacy_normalization_cleanup_armed=true
docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
  --username postgres --dbname postgres \
  --set=legacy_database="$legacy_normalization_database" << 'SQL'
CREATE DATABASE :"legacy_database" OWNER rd_database_owner;
REVOKE CONNECT,TEMPORARY ON DATABASE :"legacy_database" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"legacy_database" TO rd_owner;
SQL

docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
  --username postgres --dbname "$legacy_normalization_database" \
  --set=test_marker="$test_marker" \
  --set=legacy_database="$legacy_normalization_database" \
  --set=lease_identity="$legacy_normalization_lease_identity" << 'SQL'
CREATE SCHEMA vibe_test_legacy_normalization AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA vibe_test_legacy_normalization FROM PUBLIC;
CREATE TABLE vibe_test_legacy_normalization.instance_v1 (
  singleton boolean PRIMARY KEY CHECK (singleton),
  test_marker text NOT NULL,
  database_name text NOT NULL
);
REVOKE ALL ON TABLE vibe_test_legacy_normalization.instance_v1 FROM PUBLIC;
INSERT INTO vibe_test_legacy_normalization.instance_v1 (
  singleton,test_marker,database_name
) VALUES (true,:'test_marker',:'legacy_database');

CREATE SCHEMA rd_owner_api AUTHORIZATION rd_owner;
CREATE TABLE public.rd_exploratory_replay_request_custody_v1 (
  request_identity text PRIMARY KEY,
  request_digest text NOT NULL,
  build_request_identity text NOT NULL,
  attempt_identity text NOT NULL,
  intent_identity text NOT NULL,
  trial_family_identity text NOT NULL,
  artifact_identity text NOT NULL,
  build_receipt_identity text NOT NULL,
  artifact_family_binding_identity text NOT NULL,
  census_frontier_identity text NOT NULL,
  frozen_json jsonb NOT NULL,
  receipt_json jsonb NOT NULL,
  lifecycle_state text NOT NULL DEFAULT 'FROZEN',
  committed_at_epoch_ms bigint NOT NULL,
  request_schema_version smallint NOT NULL DEFAULT 1,
  v2_canonical_request_bytes bytea,
  v2_meaning_digest text,
  v2_seal_digest text,
  v2_receipt_json jsonb
);
ALTER TABLE public.rd_exploratory_replay_request_custody_v1 OWNER TO rd_owner;
REVOKE ALL ON TABLE public.rd_exploratory_replay_request_custody_v1 FROM PUBLIC;
GRANT SELECT,UPDATE ON TABLE public.rd_exploratory_replay_request_custody_v1
  TO surprise_replay_grantee;
GRANT SELECT(request_identity),UPDATE(lifecycle_state)
  ON TABLE public.rd_exploratory_replay_request_custody_v1 TO surprise_replay_grantee;
INSERT INTO public.rd_exploratory_replay_request_custody_v1 VALUES (
  'internal-continuity-replay-v1',
  'sha256:internal-continuity-request-v1',
  'internal-continuity-build-v1',
  'internal-continuity-attempt-v1',
  'internal-continuity-intent-v1',
  'internal-continuity-family-v1',
  'sha256:internal-continuity-artifact-v1',
  'internal-continuity-build-receipt-v1',
  'internal-continuity-family-binding-v1',
  'internal-continuity-census-v1',
  '{"kind":"internal-custody-continuity","schema_version":1}'::jsonb,
  '{"kind":"internal-custody-continuity-receipt","schema_version":1}'::jsonb,
  'FROZEN',
  1700000000000,
  2,
  pg_catalog.decode('00112233445566778899aabbccddeeff','hex'),
  'sha256:internal-continuity-meaning-v2',
  'sha256:internal-continuity-seal-v2',
  '{"kind":"internal-custody-continuity-v2-receipt","schema_version":2}'::jsonb
);

SQL

docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
  --username postgres --dbname postgres \
  --set=test_marker="$test_marker" \
  --set=legacy_database="$legacy_normalization_database" \
  --set=test_database="$test_database" \
  --set=origin_current_database="$origin_current_database" \
  --set=lease_identity="$legacy_normalization_lease_identity" << 'SQL'
CREATE SCHEMA vibe_test_legacy_normalization_cluster AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA vibe_test_legacy_normalization_cluster FROM PUBLIC;
CREATE TABLE vibe_test_legacy_normalization_cluster.authority_state_v1 (
  singleton boolean PRIMARY KEY CHECK (singleton),
  test_marker text NOT NULL,
  phase text NOT NULL CHECK (phase IN ('READY','LEASED')),
  target_database text,
  lease_identity text,
  acquired_at_epoch_ms bigint,
  released_at_epoch_ms bigint
);
REVOKE ALL ON TABLE vibe_test_legacy_normalization_cluster.authority_state_v1 FROM PUBLIC;
INSERT INTO vibe_test_legacy_normalization_cluster.authority_state_v1 (
  singleton,test_marker,phase
) VALUES (true,:'test_marker','READY');

CREATE FUNCTION vibe_test_legacy_normalization_cluster.acquire_v1(
  requested_marker text,
  requested_target text,
  requested_lease text,
  shared_database text,
  origin_database text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog
AS $function$
DECLARE state_row record;
BEGIN
  IF session_user<>'postgres' OR current_database()<>'postgres' THEN
    RAISE EXCEPTION 'legacy normalization cluster lease caller mismatch';
  END IF;
  SELECT * INTO STRICT state_row
    FROM vibe_test_legacy_normalization_cluster.authority_state_v1
   WHERE singleton FOR UPDATE;
  IF state_row.test_marker<>requested_marker
     OR state_row.phase<>'READY'
     OR state_row.target_database IS NOT NULL
     OR state_row.lease_identity IS NOT NULL
     OR requested_target IN (shared_database,origin_database)
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_database
        WHERE datname=requested_target
     )
     OR pg_catalog.has_database_privilege('rd_owner',shared_database,'CONNECT')
     OR pg_catalog.has_database_privilege('rd_owner',origin_database,'CONNECT')
     OR EXISTS (
       SELECT 1 FROM pg_catalog.pg_stat_activity
        WHERE usename='rd_owner'
          AND datname IN (shared_database,origin_database)
     )
     OR EXISTS (
       SELECT 1 FROM pg_catalog.pg_auth_members membership
       JOIN pg_catalog.pg_roles granted ON granted.oid=membership.roleid
       JOIN pg_catalog.pg_roles member ON member.oid=membership.member
       WHERE granted.rolname IN ('rd_custodian','rd_owner','replay_policy_catalog_owner','rd_fact_writer')
          OR member.rolname IN ('rd_custodian','rd_owner','replay_policy_catalog_owner','rd_fact_writer')
     ) THEN
    RAISE EXCEPTION 'legacy normalization cluster lease unavailable';
  END IF;
  EXECUTE 'GRANT rd_custodian TO rd_owner WITH ADMIN FALSE, INHERIT TRUE, SET TRUE';
  UPDATE vibe_test_legacy_normalization_cluster.authority_state_v1
     SET phase='LEASED',target_database=requested_target,
         lease_identity=requested_lease,
         acquired_at_epoch_ms=pg_catalog.floor(
           extract(epoch FROM pg_catalog.clock_timestamp())*1000
         )::bigint
   WHERE singleton;
END
$function$;
REVOKE ALL ON FUNCTION
  vibe_test_legacy_normalization_cluster.acquire_v1(text,text,text,text,text)
  FROM PUBLIC;

CREATE FUNCTION vibe_test_legacy_normalization_cluster.release_v1(
  requested_marker text,
  requested_target text,
  requested_lease text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog
AS $function$
DECLARE state_row record;
BEGIN
  IF session_user<>'postgres' OR current_database()<>'postgres' THEN
    RAISE EXCEPTION 'legacy normalization cluster release caller mismatch';
  END IF;
  SELECT * INTO STRICT state_row
    FROM vibe_test_legacy_normalization_cluster.authority_state_v1
   WHERE singleton FOR UPDATE;
  IF state_row.test_marker<>requested_marker
     OR state_row.phase<>'LEASED'
     OR state_row.target_database<>requested_target
     OR state_row.lease_identity<>requested_lease THEN
    RAISE EXCEPTION 'legacy normalization cluster release mismatch';
  END IF;
  EXECUTE 'REVOKE rd_custodian FROM rd_owner';
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_auth_members membership
    JOIN pg_catalog.pg_roles granted ON granted.oid=membership.roleid
    JOIN pg_catalog.pg_roles member ON member.oid=membership.member
    WHERE granted.rolname IN ('rd_custodian','rd_owner','replay_policy_catalog_owner','rd_fact_writer')
       OR member.rolname IN ('rd_custodian','rd_owner','replay_policy_catalog_owner','rd_fact_writer')
  ) THEN
    RAISE EXCEPTION 'legacy normalization cluster membership survived release';
  END IF;
  UPDATE vibe_test_legacy_normalization_cluster.authority_state_v1
     SET phase='READY',target_database=NULL,lease_identity=NULL,
         released_at_epoch_ms=pg_catalog.floor(
           extract(epoch FROM pg_catalog.clock_timestamp())*1000
         )::bigint
   WHERE singleton;
END
$function$;
REVOKE ALL ON FUNCTION
  vibe_test_legacy_normalization_cluster.release_v1(text,text,text)
  FROM PUBLIC;

REVOKE CONNECT ON DATABASE :"test_database" FROM rd_owner;
REVOKE CONNECT ON DATABASE :"origin_current_database" FROM rd_owner;
SELECT vibe_test_legacy_normalization_cluster.acquire_v1(
  :'test_marker',:'legacy_database',:'lease_identity',
  :'test_database',:'origin_current_database'
);
SELECT pg_catalog.set_config(
  'vibe_test.test_database',:'test_database',false
);
SELECT pg_catalog.set_config(
  'vibe_test.origin_current_database',:'origin_current_database',false
);
SELECT pg_catalog.set_config(
  'vibe_test.legacy_database',:'legacy_database',false
);
SELECT pg_catalog.set_config(
  'vibe_test.lease_identity',:'lease_identity',false
);
DO $cluster_lease_readback$
BEGIN
  IF pg_catalog.has_database_privilege(
       'rd_owner',pg_catalog.current_setting('vibe_test.test_database'),'CONNECT'
     )
     OR pg_catalog.has_database_privilege(
       'rd_owner',
       pg_catalog.current_setting('vibe_test.origin_current_database'),
       'CONNECT'
     )
     OR EXISTS (
       SELECT 1 FROM pg_catalog.pg_stat_activity
        WHERE usename='rd_owner'
          AND datname IN (
            pg_catalog.current_setting('vibe_test.test_database'),
            pg_catalog.current_setting('vibe_test.origin_current_database')
          )
     )
     OR (SELECT pg_catalog.count(*)
           FROM pg_catalog.pg_auth_members membership
           JOIN pg_catalog.pg_roles granted ON granted.oid=membership.roleid
           JOIN pg_catalog.pg_roles member ON member.oid=membership.member
           JOIN pg_catalog.pg_roles grantor ON grantor.oid=membership.grantor
          WHERE granted.rolname='rd_custodian'
            AND member.rolname='rd_owner'
            AND grantor.rolname='postgres'
            AND NOT membership.admin_option
            AND membership.inherit_option
            AND membership.set_option)<>1
     OR NOT EXISTS (
       SELECT 1
         FROM vibe_test_legacy_normalization_cluster.authority_state_v1
        WHERE singleton AND phase='LEASED'
          AND target_database=
              pg_catalog.current_setting('vibe_test.legacy_database')
          AND lease_identity=
              pg_catalog.current_setting('vibe_test.lease_identity')
          AND acquired_at_epoch_ms IS NOT NULL
     ) THEN
    RAISE EXCEPTION 'legacy normalization cluster lease readback mismatch';
  END IF;
END
$cluster_lease_readback$;
SQL

docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
  --username postgres --dbname "$legacy_normalization_database" \
  --set=test_marker="$test_marker" \
  --set=legacy_database="$legacy_normalization_database" << 'SQL'
BEGIN;
SELECT pg_catalog.set_config(
  'vibe_test.test_marker',:'test_marker',true
);
SELECT pg_catalog.set_config(
  'vibe_test.legacy_database',:'legacy_database',true
);
DO $target_lease$
DECLARE marker_row record;
BEGIN
  SELECT * INTO STRICT marker_row
    FROM vibe_test_legacy_normalization.instance_v1
   WHERE singleton;
  IF marker_row.test_marker<>
       pg_catalog.current_setting('vibe_test.test_marker')
     OR marker_row.database_name<>
       pg_catalog.current_setting('vibe_test.legacy_database')
     OR marker_row.database_name<>pg_catalog.current_database()
     OR pg_catalog.has_schema_privilege('rd_owner','public','CREATE') THEN
    RAISE EXCEPTION 'legacy normalization target marker mismatch';
  END IF;
END
$target_lease$;
GRANT CREATE ON SCHEMA public TO rd_owner;
COMMIT;
SQL

legacy_normalization_concurrent_rejection=0
if docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
  --username postgres --dbname postgres \
  --set=test_marker="$test_marker" \
  --set=legacy_database="$legacy_normalization_database" \
  --set=test_database="$test_database" \
  --set=origin_current_database="$origin_current_database" \
  --set=lease_identity="$legacy_normalization_lease_identity" << 'SQL'; then
SELECT vibe_test_legacy_normalization_cluster.acquire_v1(
  :'test_marker',:'legacy_database',:'lease_identity',
  :'test_database',:'origin_current_database'
);
SQL
  legacy_normalization_concurrent_rejection=1
fi

legacy_normalization_status=0
if [[ "$legacy_normalization_concurrent_rejection" -eq 0 ]] && env \
  RD_OWNER_FRESH_TEST_DATABASE_URL="postgresql://rd_owner:${test_password}@${postgres_host}:${postgres_port}/${legacy_normalization_database}" \
  cargo nextest run \
  --archive-file "$nextest_archive_file" \
  --profile "$nextest_profile" \
  "${nextest_execution_args[@]}" \
  -E "$legacy_normalization_filter"; then
  :
else
  legacy_normalization_status="$?"
fi

legacy_normalization_cleanup_status=0
if docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
  --username postgres --dbname "$legacy_normalization_database" \
  --set=test_marker="$test_marker" \
  --set=lease_identity="$legacy_normalization_lease_identity" << 'SQL'; then
BEGIN;
REVOKE CREATE ON SCHEMA public FROM rd_owner;
DO $target_release$
BEGIN
  IF pg_catalog.has_schema_privilege('rd_owner','public','CREATE') THEN
    RAISE EXCEPTION 'legacy normalization target CREATE survived release';
  END IF;
END
$target_release$;
COMMIT;
SQL
  :
else
  legacy_normalization_cleanup_status="$?"
fi

legacy_normalization_cluster_cleanup_status=0
if docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
  --username postgres --dbname postgres \
  --set=test_marker="$test_marker" \
  --set=legacy_database="$legacy_normalization_database" \
  --set=lease_identity="$legacy_normalization_lease_identity" \
  --set=test_database="$test_database" \
  --set=origin_current_database="$origin_current_database" << 'SQL'; then
BEGIN;
SELECT vibe_test_legacy_normalization_cluster.release_v1(
  :'test_marker',:'legacy_database',:'lease_identity'
);
GRANT CONNECT ON DATABASE :"test_database" TO rd_owner;
GRANT CONNECT ON DATABASE :"origin_current_database" TO rd_owner;
SELECT pg_catalog.set_config(
  'vibe_test.test_database',:'test_database',true
);
SELECT pg_catalog.set_config(
  'vibe_test.origin_current_database',:'origin_current_database',true
);
DO $shared_restored$
BEGIN
  IF NOT pg_catalog.has_database_privilege(
       'rd_owner',pg_catalog.current_setting('vibe_test.test_database'),'CONNECT'
     )
     OR NOT pg_catalog.has_database_privilege(
       'rd_owner',
       pg_catalog.current_setting('vibe_test.origin_current_database'),
       'CONNECT'
     )
     OR pg_catalog.pg_has_role('rd_owner','rd_custodian','MEMBER')
     OR NOT EXISTS (
       SELECT 1
         FROM vibe_test_legacy_normalization_cluster.authority_state_v1
        WHERE singleton AND phase='READY'
          AND target_database IS NULL AND lease_identity IS NULL
          AND released_at_epoch_ms IS NOT NULL
     ) THEN
    RAISE EXCEPTION 'legacy normalization cluster release was not exact';
  END IF;
END
$shared_restored$;
COMMIT;
SQL
  :
else
  legacy_normalization_cluster_cleanup_status="$?"
fi

if [[ "$legacy_normalization_cluster_cleanup_status" -ne 0 ]]; then
  docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
    --username postgres --dbname postgres \
    --set=test_database="$test_database" \
    --set=origin_current_database="$origin_current_database" << 'SQL'
REVOKE rd_custodian FROM rd_owner;
GRANT CONNECT ON DATABASE :"test_database" TO rd_owner;
GRANT CONNECT ON DATABASE :"origin_current_database" TO rd_owner;
SELECT pg_catalog.set_config(
  'vibe_test.test_database',:'test_database',false
);
SELECT pg_catalog.set_config(
  'vibe_test.origin_current_database',:'origin_current_database',false
);
DO $failed_release_cleanup$
BEGIN
  IF pg_catalog.pg_has_role('rd_owner','rd_custodian','MEMBER')
     OR NOT pg_catalog.has_database_privilege(
       'rd_owner',pg_catalog.current_setting('vibe_test.test_database'),'CONNECT'
     )
     OR NOT pg_catalog.has_database_privilege(
       'rd_owner',
       pg_catalog.current_setting('vibe_test.origin_current_database'),
       'CONNECT'
     ) THEN
    RAISE EXCEPTION 'legacy normalization failed-release cleanup mismatch';
  END IF;
END
$failed_release_cleanup$;
SQL
fi

legacy_normalization_drop_status=0
if docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
  --username postgres --dbname postgres \
  --set=legacy_database="$legacy_normalization_database" << 'SQL'; then
REVOKE CONNECT ON DATABASE :"legacy_database" FROM rd_owner;
DROP DATABASE :"legacy_database" WITH (FORCE);
DROP SCHEMA vibe_test_legacy_normalization_cluster CASCADE;
SQL
  :
else
  legacy_normalization_drop_status="$?"
fi

if [[ "$legacy_normalization_status" -ne 0 ]]; then exit "$legacy_normalization_status"; fi
if [[ "$legacy_normalization_cleanup_status" -ne 0 ]]; then exit "$legacy_normalization_cleanup_status"; fi
if [[ "$legacy_normalization_cluster_cleanup_status" -ne 0 ]]; then exit "$legacy_normalization_cluster_cleanup_status"; fi
if [[ "$legacy_normalization_drop_status" -ne 0 ]]; then exit "$legacy_normalization_drop_status"; fi
legacy_normalization_cleanup_armed=false

provision_owner_schemas "$test_database"
provision_owner_schemas "$origin_current_database"

docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
  --username postgres --dbname postgres \
  --set=partial_sealed_database="$partial_sealed_database" << 'SQL'
CREATE DATABASE :"partial_sealed_database" OWNER rd_database_owner;
REVOKE CONNECT ON DATABASE :"partial_sealed_database" FROM PUBLIC;
GRANT CONNECT, CREATE ON DATABASE :"partial_sealed_database" TO rd_owner;
SQL
docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
  --username postgres --dbname "$partial_sealed_database" << 'SQL'
GRANT USAGE, CREATE ON SCHEMA public TO rd_owner;
CREATE SCHEMA rd_owner_api AUTHORIZATION rd_owner;
CREATE TABLE public.rd_source_candidates_v1 (probe integer NOT NULL);
ALTER TABLE public.rd_source_candidates_v1 OWNER TO rd_custodian;
REVOKE ALL ON TABLE public.rd_source_candidates_v1 FROM PUBLIC;
SQL

docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
  --username postgres --dbname postgres \
  --set=partial_sealed_routine_database="$partial_sealed_routine_database" << 'SQL'
CREATE DATABASE :"partial_sealed_routine_database" OWNER rd_database_owner;
REVOKE CONNECT ON DATABASE :"partial_sealed_routine_database" FROM PUBLIC;
GRANT CONNECT, CREATE ON DATABASE :"partial_sealed_routine_database" TO rd_owner;
SQL
docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
  --username postgres --dbname "$partial_sealed_routine_database" << 'SQL'
GRANT USAGE, CREATE ON SCHEMA public TO rd_owner;
CREATE SCHEMA rd_owner_api AUTHORIZATION rd_owner;
CREATE FUNCTION public.rd_owner_reject_legacy_prepared_attempt_drain_mutation_v1()
RETURNS trigger LANGUAGE plpgsql AS $function$ BEGIN RETURN NULL; END $function$;
ALTER FUNCTION public.rd_owner_reject_legacy_prepared_attempt_drain_mutation_v1()
  OWNER TO rd_custodian;
REVOKE ALL ON FUNCTION public.rd_owner_reject_legacy_prepared_attempt_drain_mutation_v1()
  FROM PUBLIC;
SQL

partial_sealed_topology_fingerprint() {
  local fingerprint_database="$1"
  {
    docker exec "$container" pg_dump \
      --schema-only --quote-all-identifiers --username postgres \
      --dbname "$fingerprint_database"
    docker exec --interactive "$container" psql --quiet --tuples-only --no-align \
      --set ON_ERROR_STOP=1 --username postgres --dbname postgres \
      --set=fingerprint_database="$fingerprint_database" << 'SQL'
SELECT 'database:'||database_entry.datname||':'||
       pg_catalog.pg_get_userbyid(database_entry.datdba)||':'||
       COALESCE(database_entry.datacl::text,'<NULL>')
  FROM pg_catalog.pg_database database_entry
 WHERE database_entry.datname=:'fingerprint_database';
SELECT 'role:'||role.rolname||':'||role.rolsuper::text||':'||role.rolinherit::text||':'||
       role.rolcreaterole::text||':'||role.rolcreatedb::text||':'||role.rolcanlogin::text||':'||
       role.rolreplication::text||':'||role.rolbypassrls::text||':'||
       COALESCE(role.rolconfig::text,'<NULL>')
  FROM pg_catalog.pg_roles role
 WHERE role.rolname IN ('rd_owner','rd_custodian','rd_database_owner')
 ORDER BY role.rolname;
SELECT 'membership:'||granted.rolname||':'||member.rolname||':'||grantor.rolname||':'||
       membership.admin_option::text||':'||membership.inherit_option::text||':'||
       membership.set_option::text
  FROM pg_catalog.pg_auth_members membership
  JOIN pg_catalog.pg_roles granted ON granted.oid=membership.roleid
  JOIN pg_catalog.pg_roles member ON member.oid=membership.member
  JOIN pg_catalog.pg_roles grantor ON grantor.oid=membership.grantor
 WHERE granted.rolname IN ('rd_owner','rd_custodian','rd_database_owner')
    OR member.rolname IN ('rd_owner','rd_custodian','rd_database_owner')
 ORDER BY granted.rolname,member.rolname,grantor.rolname;
SQL
  } | sed -e '/^\\restrict /d' -e '/^\\unrestrict /d' | sha256sum | awk '{print $1}'
}

run_authority_migration_for_database "$test_database"
run_authority_migration_for_database "$origin_current_database"
revoke_runtime_schema_create "$test_database"
revoke_runtime_schema_create "$origin_current_database"
verify_sealed_column_acl_fails_closed() {
  local fixture_database="$1"
  local negative_runtime_filter='(package(vibe-strategy-factory) & test(=product_edge_postgres::tests::runtime_diagnostic_manifest_locates_nonowner_sealed_column_acl)) | (package(vibe-strategy-factory-rd-owner-api) & binary(rd_owner_api_main) & test(=tests::runtime_rd_owner_rejects_nonowner_sealed_column_acl))'
  local injection_status=0
  local negative_runtime_status=0
  local cleanup_status=0

  if docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
    --username postgres --dbname "$fixture_database" << 'SQL'; then
BEGIN;
GRANT SELECT(request_identity) ON TABLE public.rd_sealed_exploratory_replay_requests_v1
  TO vibe_test_legacy_replay_fault_writer;
DO $sealed_column_acl_injection$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class relation
      CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(
        relation.relacl,
        pg_catalog.acldefault('r', relation.relowner)
      )) acl
     WHERE relation.oid='public.rd_sealed_exploratory_replay_requests_v1'::pg_catalog.regclass
       AND acl.grantee<>relation.relowner
  ) OR (SELECT count(*)
          FROM pg_catalog.pg_class relation
          JOIN pg_catalog.pg_attribute attribute ON attribute.attrelid=relation.oid
          CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) acl
         WHERE relation.oid='public.rd_sealed_exploratory_replay_requests_v1'::pg_catalog.regclass
           AND attribute.attname='request_identity'
           AND acl.grantee=pg_catalog.to_regrole('vibe_test_legacy_replay_fault_writer')::oid
           AND acl.privilege_type='SELECT' AND NOT acl.is_grantable)<>1
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.pg_class relation
         JOIN pg_catalog.pg_attribute attribute ON attribute.attrelid=relation.oid
         CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) acl
        WHERE relation.oid='public.rd_sealed_exploratory_replay_requests_v1'::pg_catalog.regclass
          AND attribute.attnum>0 AND NOT attribute.attisdropped
          AND acl.grantee<>relation.relowner
          AND NOT (attribute.attname='request_identity'
               AND acl.grantee=pg_catalog.to_regrole('vibe_test_legacy_replay_fault_writer')::oid
               AND acl.privilege_type='SELECT' AND NOT acl.is_grantable)
     ) THEN
    RAISE EXCEPTION 'sealed column ACL fault injection mismatch';
  END IF;
END
$sealed_column_acl_injection$;
COMMIT;
SQL
    :
  else
    injection_status="$?"
  fi

  if [[ "$injection_status" -eq 0 ]] && env \
    RD_OWNER_RUNTIME_STARTUP_DATABASE_URL="postgresql://rd_owner:${test_password}@${postgres_host}:${postgres_port}/${fixture_database}" \
    QUALIFICATION_RUNTIME_STARTUP_DATABASE_URL="postgresql://qualification_writer:${test_password}@${postgres_host}:${postgres_port}/${fixture_database}" \
    cargo nextest run \
    --archive-file "$nextest_archive_file" \
    --profile "$nextest_profile" \
    "${nextest_execution_args[@]}" \
    -E "$negative_runtime_filter"; then
    :
  else
    negative_runtime_status="$?"
  fi

  if docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
    --username postgres --dbname "$fixture_database" << 'SQL'; then
REVOKE SELECT(request_identity) ON TABLE public.rd_sealed_exploratory_replay_requests_v1
  FROM vibe_test_legacy_replay_fault_writer;
DO $sealed_column_acl_cleanup$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class relation
      CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(
        relation.relacl,
        pg_catalog.acldefault('r', relation.relowner)
      )) acl
     WHERE relation.oid='public.rd_sealed_exploratory_replay_requests_v1'::pg_catalog.regclass
       AND acl.grantee<>relation.relowner
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class relation
      JOIN pg_catalog.pg_attribute attribute ON attribute.attrelid=relation.oid
      CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) acl
     WHERE relation.oid='public.rd_sealed_exploratory_replay_requests_v1'::pg_catalog.regclass
       AND attribute.attnum>0 AND NOT attribute.attisdropped
       AND acl.grantee<>relation.relowner
  ) THEN
    RAISE EXCEPTION 'sealed table or column ACL cleanup mismatch';
  END IF;
END
$sealed_column_acl_cleanup$;
SQL
    :
  else
    cleanup_status="$?"
  fi

  if [[ "$injection_status" -ne 0 ]]; then
    return "$injection_status"
  fi
  if [[ "$cleanup_status" -ne 0 ]]; then
    return "$cleanup_status"
  fi
  return "$negative_runtime_status"
}

verify_owner_column_acl_fails_closed() {
  local fixture_database="$1"
  local relation_name="$2"
  local column_name="$3"
  local database_url_variable="$4"
  local negative_filter="$5"
  local runtime_role
  local injection_status=0
  local negative_status=0
  local cleanup_status=0

  case "$database_url_variable" in
    QUALIFICATION_*) runtime_role='qualification_writer' ;;
    PRODUCT_EDGE_*) runtime_role='product_edge_owner' ;;
    *) runtime_role='rd_owner' ;;
  esac

  if docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
    --username postgres --dbname "$fixture_database" \
    --set=relation_name="$relation_name" --set=column_name="$column_name" << 'SQL'; then
SELECT pg_catalog.set_config('vibe_test.relation_name',:'relation_name',false);
SELECT pg_catalog.set_config('vibe_test.column_name',:'column_name',false);
DO $column_acl_injection$
BEGIN
  EXECUTE pg_catalog.format(
    'GRANT SELECT (%I) ON TABLE public.%I TO vibe_test_legacy_replay_fault_writer',
    pg_catalog.current_setting('vibe_test.column_name'),
    pg_catalog.current_setting('vibe_test.relation_name')
  );
END
$column_acl_injection$;
SQL
    :
  else
    injection_status="$?"
  fi

  if [[ "$injection_status" -eq 0 ]] && env \
    "${database_url_variable}=postgresql://${runtime_role}:${test_password}@${postgres_host}:${postgres_port}/${fixture_database}" \
    cargo nextest run \
    --archive-file "$nextest_archive_file" \
    --profile "$nextest_profile" \
    "${nextest_execution_args[@]}" \
    -E "$negative_filter"; then
    :
  else
    negative_status="$?"
  fi

  if docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
    --username postgres --dbname "$fixture_database" \
    --set=relation_name="$relation_name" --set=column_name="$column_name" << 'SQL'; then
SELECT pg_catalog.set_config('vibe_test.relation_name',:'relation_name',false);
SELECT pg_catalog.set_config('vibe_test.column_name',:'column_name',false);
DO $column_acl_cleanup$
BEGIN
  EXECUTE pg_catalog.format(
    'REVOKE ALL (%I) ON TABLE public.%I FROM vibe_test_legacy_replay_fault_writer',
    pg_catalog.current_setting('vibe_test.column_name'),
    pg_catalog.current_setting('vibe_test.relation_name')
  );
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute attribute
    CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) acl
    WHERE attribute.attrelid=pg_catalog.to_regclass('public.'||pg_catalog.current_setting('vibe_test.relation_name'))
      AND attribute.attnum>0 AND NOT attribute.attisdropped
      AND acl.grantee<>(
        SELECT relation.relowner FROM pg_catalog.pg_class relation
        WHERE relation.oid=attribute.attrelid
      )
  ) THEN RAISE EXCEPTION 'Owner column ACL cleanup mismatch'; END IF;
END
$column_acl_cleanup$;
SQL
    :
  else
    cleanup_status="$?"
  fi

  if [[ "$injection_status" -ne 0 ]]; then return "$injection_status"; fi
  if [[ "$cleanup_status" -ne 0 ]]; then return "$cleanup_status"; fi
  return "$negative_status"
}

runtime_diagnostic_filter='package(vibe-strategy-factory) & test(=product_edge_postgres::tests::runtime_diagnostic_manifest_is_empty_for_existing_custody)'
runtime_startup_filter='package(vibe-strategy-factory-rd-owner-api) & binary(rd_owner_api_main) & test(=tests::runtime_storage_connectors_start_without_migration_authority)'
artifact_runtime_manifest_failures() {
  local fixture_database="$1"
  docker exec \
    --env "PGPASSWORD=${test_password}" \
    "$container" psql --quiet --tuples-only --no-align --set ON_ERROR_STOP=1 \
    --host 127.0.0.1 --username rd_owner --dbname "$fixture_database" << 'SQL'
WITH required_relation(name) AS (
  VALUES ('rd_artifact_build_attempts_v1'),('rd_strategy_artifacts_v1')
), relation_manifest AS (
  SELECT pg_catalog.count(*)=2 AND pg_catalog.bool_and(
    pg_catalog.pg_get_userbyid(relation.relowner)='rd_custodian'
    AND relation.relkind='r' AND relation.relpersistence='p'
    AND NOT relation.relrowsecurity AND NOT relation.relforcerowsecurity
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger trigger_fact WHERE trigger_fact.tgrelid=relation.oid AND NOT trigger_fact.tgisinternal)
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_rewrite rewrite_fact WHERE rewrite_fact.ev_class=relation.oid)
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policy policy_fact WHERE policy_fact.polrelid=relation.oid)
    AND pg_catalog.obj_description(relation.oid,'pg_class')='vibe-closed-relation-v2:'||pg_catalog.md5(pg_catalog.jsonb_build_object(
      'columns',(SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(attribute.attnum,attribute.attname,attribute.atttypid::text,attribute.atttypmod,attribute.attnotnull,attribute.attidentity,attribute.attgenerated,pg_catalog.pg_get_expr(default_fact.adbin,default_fact.adrelid)) ORDER BY attribute.attnum) FROM pg_catalog.pg_attribute attribute LEFT JOIN pg_catalog.pg_attrdef default_fact ON default_fact.adrelid=attribute.attrelid AND default_fact.adnum=attribute.attnum WHERE attribute.attrelid=relation.oid AND attribute.attnum>0 AND NOT attribute.attisdropped),
      'constraints',(SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.pg_get_constraintdef(constraint_fact.oid,true) ORDER BY pg_catalog.pg_get_constraintdef(constraint_fact.oid,true)),'[]'::jsonb) FROM pg_catalog.pg_constraint constraint_fact WHERE constraint_fact.conrelid=relation.oid),
      'acl',COALESCE(relation.relacl::text,'<NULL>'))::text)
    AND (SELECT pg_catalog.count(*)=11
      AND pg_catalog.array_agg(acl.privilege_type ORDER BY acl.privilege_type) FILTER (WHERE acl.grantee=relation.relowner AND NOT acl.is_grantable) IS NOT DISTINCT FROM ARRAY['DELETE','INSERT','REFERENCES','SELECT','TRIGGER','TRUNCATE','UPDATE']::text[]
      AND pg_catalog.array_agg(acl.privilege_type ORDER BY acl.privilege_type) FILTER (WHERE acl.grantee=pg_catalog.to_regrole('rd_owner')::oid AND NOT acl.is_grantable) IS NOT DISTINCT FROM ARRAY['DELETE','INSERT','SELECT','UPDATE']::text[]
      FROM pg_catalog.aclexplode(COALESCE(relation.relacl,pg_catalog.acldefault('r',relation.relowner))) acl)
  ) AS exact
  FROM required_relation
  JOIN pg_catalog.pg_class relation
    ON relation.oid=pg_catalog.to_regclass('public.'||required_relation.name)
), invariant(label,exact) AS (
  VALUES
    ('artifact.runtime-role', session_user='rd_owner' AND EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=session_user AND rolcanlogin AND rolinherit AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls)),
    ('artifact.runtime-membership', NOT EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members membership WHERE membership.roleid=pg_catalog.to_regrole(session_user)::oid OR membership.member=pg_catalog.to_regrole(session_user)::oid)),
    ('artifact.database-acl', NOT pg_catalog.has_database_privilege(session_user,pg_catalog.current_database(),'CREATE,TEMPORARY')),
    ('artifact.public-schema-acl', NOT pg_catalog.has_schema_privilege(session_user,'public','CREATE')),
    ('artifact.custodian-role', EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='rd_custodian' AND NOT rolcanlogin AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls)),
    ('artifact.custodian-membership', NOT pg_catalog.pg_has_role(session_user,'rd_custodian','MEMBER')),
    ('artifact.api-schema', pg_catalog.pg_get_userbyid((SELECT nspowner FROM pg_catalog.pg_namespace WHERE nspname='rd_owner_api'))='rd_custodian' AND pg_catalog.has_schema_privilege(session_user,'rd_owner_api','USAGE') AND NOT pg_catalog.has_schema_privilege(session_user,'rd_owner_api','CREATE')),
    ('artifact.api-schema-acl', (SELECT pg_catalog.count(*)=6 AND pg_catalog.count(*) FILTER (WHERE acl.grantee=namespace.nspowner AND NOT acl.is_grantable)=2 AND pg_catalog.count(*) FILTER (WHERE acl.grantee=pg_catalog.to_regrole('rd_owner')::oid AND acl.privilege_type='USAGE' AND NOT acl.is_grantable)=1 AND pg_catalog.count(*) FILTER (WHERE acl.grantee=pg_catalog.to_regrole('product_edge_owner')::oid AND acl.privilege_type='USAGE' AND NOT acl.is_grantable)=1 AND pg_catalog.count(*) FILTER (WHERE acl.grantee=pg_catalog.to_regrole('qualification_writer')::oid AND acl.privilege_type='USAGE' AND NOT acl.is_grantable)=1 AND pg_catalog.count(*) FILTER (WHERE acl.grantee=pg_catalog.to_regrole('backtest_owner')::oid AND acl.privilege_type='USAGE' AND NOT acl.is_grantable)=1 FROM pg_catalog.pg_namespace namespace, LATERAL pg_catalog.aclexplode(COALESCE(namespace.nspacl,pg_catalog.acldefault('n',namespace.nspowner))) acl WHERE namespace.nspname='rd_owner_api')),
    ('artifact.relations', (SELECT exact FROM relation_manifest)),
    ('artifact.reservation-routine', EXISTS (SELECT 1 FROM pg_catalog.pg_proc routine WHERE routine.oid=pg_catalog.to_regprocedure('rd_owner_api.lock_artifact_invocation_reservation_v1(text,text,text,text,text)') AND pg_catalog.pg_get_userbyid(routine.proowner)='rd_custodian' AND routine.prosecdef AND routine.proisstrict AND routine.provolatile='v' AND routine.proparallel='u' AND routine.proconfig=ARRAY['search_path=pg_catalog']::text[] AND pg_catalog.obj_description(routine.oid,'pg_proc')='vibe-source-md5:'||pg_catalog.md5(routine.prosrc) AND (SELECT pg_catalog.array_agg(role.rolname::text ORDER BY role.rolname) FROM pg_catalog.aclexplode(COALESCE(routine.proacl,pg_catalog.acldefault('f',routine.proowner))) acl JOIN pg_catalog.pg_roles role ON role.oid=acl.grantee WHERE acl.privilege_type='EXECUTE' AND NOT acl.is_grantable)=ARRAY['product_edge_owner','rd_custodian','rd_owner']::text[]))
)
SELECT pg_catalog.string_agg(label,',' ORDER BY label)
FROM invariant
WHERE exact IS DISTINCT FROM true;
SQL
}
verify_runtime_startup() {
  local fixture_database="$1"
  local artifact_manifest_failures

  if env \
    RD_OWNER_RUNTIME_STARTUP_DATABASE_URL="postgresql://rd_owner:${test_password}@${postgres_host}:${postgres_port}/${fixture_database}" \
    cargo nextest run \
    --archive-file "$nextest_archive_file" \
    --profile "$nextest_profile" \
    "${nextest_execution_args[@]}" \
    -E "$runtime_diagnostic_filter"; then
    :
  else
    return "$?"
  fi
  if ! artifact_manifest_failures="$(artifact_runtime_manifest_failures "$fixture_database")"; then
    echo "ERROR: Artifact runtime startup manifest diagnostic failed" >&2
    return 1
  fi
  if [[ -n "$artifact_manifest_failures" ]]; then
    echo "ERROR: Artifact runtime startup manifest mismatch: ${artifact_manifest_failures}" >&2
    return 1
  fi
  env \
    RD_OWNER_RUNTIME_STARTUP_DATABASE_URL="postgresql://rd_owner:${test_password}@${postgres_host}:${postgres_port}/${fixture_database}" \
    RD_FACT_WRITER_RUNTIME_STARTUP_DATABASE_URL="postgresql://rd_fact_writer:${test_password}@${postgres_host}:${postgres_port}/${fixture_database}" \
    QUALIFICATION_RUNTIME_STARTUP_DATABASE_URL="postgresql://qualification_writer:${test_password}@${postgres_host}:${postgres_port}/${fixture_database}" \
    PRODUCT_EDGE_RUNTIME_STARTUP_DATABASE_URL="postgresql://product_edge_owner:${test_password}@${postgres_host}:${postgres_port}/${fixture_database}" \
    cargo nextest run \
    --archive-file "$nextest_archive_file" \
    --profile "$nextest_profile" \
    "${nextest_execution_args[@]}" \
    -E "$runtime_startup_filter"
}

verify_runtime_startup "$test_database"
negative_runtime_status=0
if verify_sealed_column_acl_fails_closed "$test_database"; then
  :
else
  negative_runtime_status="$?"
fi
if [[ "$negative_runtime_status" -eq 0 ]]; then
  if verify_owner_column_acl_fails_closed \
    "$test_database" qualification_protected_feedback_projections_v1 projection_json \
    QUALIFICATION_COLUMN_ACL_TEST_DATABASE_URL \
    'package(vibe-strategy-factory) & test(=product_edge_postgres::tests::qualification_existing_topology_rejects_nonowner_column_acl)'; then
    :
  else
    negative_runtime_status="$?"
  fi
fi
if [[ "$negative_runtime_status" -eq 0 ]]; then
  if verify_owner_column_acl_fails_closed \
    "$test_database" rd_source_candidates_v1 candidate_json \
    RD_SOURCE_INTAKE_COLUMN_ACL_TEST_DATABASE_URL \
    'package(vibe-strategy-factory) & test(=source_intake::postgres::terminal_wrapper_tests::existing_topology_rejects_nonowner_column_acl)'; then
    :
  else
    negative_runtime_status="$?"
  fi
fi
if [[ "$negative_runtime_status" -eq 0 ]]; then
  if verify_owner_column_acl_fails_closed \
    "$test_database" product_edge_operation_manifests_v1 manifest_json \
    PRODUCT_EDGE_COLUMN_ACL_TEST_DATABASE_URL \
    'package(vibe-product-edge) & test(=postgres::tests::existing_topology_rejects_nonowner_column_acl)'; then
    :
  else
    negative_runtime_status="$?"
  fi
fi
post_cleanup_runtime_status=0
if verify_runtime_startup "$test_database"; then
  :
else
  post_cleanup_runtime_status="$?"
fi
if [[ "$negative_runtime_status" -ne 0 ]]; then
  exit "$negative_runtime_status"
fi
if [[ "$post_cleanup_runtime_status" -ne 0 ]]; then
  exit "$post_cleanup_runtime_status"
fi

# Production runtime startup above proves the final migration with no disposable
# authority. Restore only the isolated test administrator needed by later fault probes.
restore_disposable_topology_admin "$test_database"
restore_disposable_topology_admin "$origin_current_database"

# The first two filters exercise explicit legacy/origin migration under separate,
# test-bounded schema authority. The final filters deliberately poison Owner state
# and therefore stay after every positive consumer, with the malformed OA/PE schema probe last.
for test_selection in "${rd_owner_postgres_tests[@]}"; do
  IFS='|' read -r test_package test_binary test_name <<< "$test_selection"
  test_filter="package(${test_package}) & binary(${test_binary}) & test(=${test_name})"
  migration_database=''
  if [[ "$test_name" == 'legacy_replay_table_is_preserved_while_current_custody_commits_and_reads_back' ]]; then
    migration_database="$test_database"
  elif [[ "$test_name" == 'origin_current_replay_table_renames_with_exact_v1_v2_read_continuity' ]]; then
    migration_database="$origin_current_database"
  fi
  legacy_migration_lease_identity=''
  legacy_migration_url=''
  if [[ -n "$migration_database" ]]; then
    legacy_migration_lease_identity="legacy-replay-migration:${test_marker}:${test_name}:v1"
    legacy_migration_url="postgresql://vibe_test_legacy_migration_caller:${test_password}@${postgres_host}:${postgres_port}/${migration_database}"
    docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
      --username postgres --dbname postgres \
      --set=migration_database="$migration_database" << 'SQL'
GRANT CONNECT ON DATABASE :"migration_database" TO vibe_test_legacy_migration_caller;
SQL
  fi
  test_passed=false
  if [[ "$test_name" == 'partial_sealed_non_anchor_objects_fail_before_ddl' ]]; then
    partial_sealed_fingerprint_before="$(
      printf '%s\n%s\n' \
        "$(partial_sealed_topology_fingerprint "$partial_sealed_database")" \
        "$(partial_sealed_topology_fingerprint "$partial_sealed_routine_database")" |
        sha256sum | awk '{print $1}'
    )"
    if env \
      RD_OWNER_PARTIAL_SEALED_TEST_DATABASE_URL="postgresql://rd_owner:${test_password}@${postgres_host}:${postgres_port}/${partial_sealed_database}" \
      RD_OWNER_PARTIAL_SEALED_ROUTINE_TEST_DATABASE_URL="postgresql://rd_owner:${test_password}@${postgres_host}:${postgres_port}/${partial_sealed_routine_database}" \
      QUALIFICATION_WRITER_FRESH_TEST_DATABASE_URL="postgresql://qualification_writer:${test_password}@${postgres_host}:${postgres_port}/${test_database}" \
      cargo nextest run \
      --archive-file "$nextest_archive_file" \
      --profile "$nextest_profile" \
      "${nextest_execution_args[@]}" \
      -E "$test_filter"; then
      test_passed=true
    fi
    partial_sealed_fingerprint_after="$(
      printf '%s\n%s\n' \
        "$(partial_sealed_topology_fingerprint "$partial_sealed_database")" \
        "$(partial_sealed_topology_fingerprint "$partial_sealed_routine_database")" |
        sha256sum | awk '{print $1}'
    )"
    if [[ "$partial_sealed_fingerprint_after" != "$partial_sealed_fingerprint_before" ]]; then
      echo "ERROR: rejected partial-sealed R&D startup changed PostgreSQL topology." >&2
      test_passed=false
    fi
    docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
      --username postgres --dbname postgres \
      --set=partial_sealed_database="$partial_sealed_database" \
      --set=partial_sealed_routine_database="$partial_sealed_routine_database" << 'SQL'
DROP DATABASE :"partial_sealed_database" WITH (FORCE);
DROP DATABASE :"partial_sealed_routine_database" WITH (FORCE);
SQL
    if docker exec "$container" psql --quiet --tuples-only --no-align \
      --set ON_ERROR_STOP=1 --username postgres --dbname postgres \
      --set=partial_sealed_database="$partial_sealed_database" \
      --set=partial_sealed_routine_database="$partial_sealed_routine_database" \
      --command "SELECT 1 FROM pg_catalog.pg_database WHERE datname IN (:'partial_sealed_database',:'partial_sealed_routine_database')" | grep -q 1; then
      echo "ERROR: partial-sealed PostgreSQL fixture database survived cleanup." >&2
      test_passed=false
    fi
  elif [[ "$test_name" == 'origin_current_replay_table_renames_with_exact_v1_v2_read_continuity' ]]; then
    if env \
      VIBE_POSTGRES_TEST_DATABASE_NAME="$origin_current_database" \
      OPERATOR_AUTHORIZATION_TEST_DATABASE_URL="postgresql://operator_authorization_writer:${test_password}@${postgres_host}:${postgres_port}/${origin_current_database}" \
      PRODUCT_EDGE_TEST_DATABASE_URL="postgresql://product_edge_owner:${test_password}@${postgres_host}:${postgres_port}/${origin_current_database}" \
      RD_OWNER_TEST_DATABASE_URL="postgresql://rd_owner:${test_password}@${postgres_host}:${postgres_port}/${origin_current_database}" \
      RD_FACT_WRITER_TEST_DATABASE_URL="postgresql://rd_fact_writer:${test_password}@${postgres_host}:${postgres_port}/${origin_current_database}" \
      QUALIFICATION_TEST_DATABASE_URL="postgresql://qualification_writer:${test_password}@${postgres_host}:${postgres_port}/${origin_current_database}" \
      BACKTEST_TEST_DATABASE_URL="postgresql://backtest_owner:${test_password}@${postgres_host}:${postgres_port}/${origin_current_database}" \
      VIBE_TEST_OWNER_TOPOLOGY_ADMIN_DATABASE_URL="postgresql://vibe_test_owner_topology_admin:${test_password}@${postgres_host}:${postgres_port}/${origin_current_database}" \
      VIBE_TEST_LEGACY_MIGRATION_DATABASE_URL="$legacy_migration_url" \
      VIBE_TEST_LEGACY_MIGRATION_LEASE_IDENTITY="$legacy_migration_lease_identity" \
      cargo nextest run \
      --archive-file "$nextest_archive_file" \
      --profile "$nextest_profile" \
      "${nextest_execution_args[@]}" \
      -E "$test_filter"; then
      test_passed=true
    fi
  else
    if [[ -n "$migration_database" ]]; then
      if env \
        VIBE_TEST_LEGACY_MIGRATION_DATABASE_URL="$legacy_migration_url" \
        VIBE_TEST_LEGACY_MIGRATION_LEASE_IDENTITY="$legacy_migration_lease_identity" \
        cargo nextest run \
        --archive-file "$nextest_archive_file" \
        --profile "$nextest_profile" \
        "${nextest_execution_args[@]}" \
        -E "$test_filter"; then
        test_passed=true
      fi
    elif cargo nextest run \
      --archive-file "$nextest_archive_file" \
      --profile "$nextest_profile" \
      "${nextest_execution_args[@]}" \
      -E "$test_filter"; then
      test_passed=true
    fi
  fi
  if [[ -n "$migration_database" ]]; then
    docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
      --username postgres --dbname "$migration_database" \
      --set=test_marker="$test_marker" \
      --set=lease_identity="$legacy_migration_lease_identity" << 'SQL'
SET SESSION AUTHORIZATION vibe_test_legacy_migration_caller;
SELECT vibe_test_legacy_migration_lease.release_v1(:'test_marker',:'lease_identity');
RESET SESSION AUTHORIZATION;
SQL
    docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
      --username postgres --dbname postgres \
      --set=migration_database="$migration_database" << 'SQL'
REVOKE CONNECT ON DATABASE :"migration_database" FROM vibe_test_legacy_migration_caller;
SQL
    run_authority_migration_for_database "$migration_database"
    revoke_runtime_schema_create "$migration_database"
    restore_disposable_topology_admin "$migration_database"
  fi
  if [[ "$test_passed" != true ]]; then
    exit 1
  fi
  if [[ "$test_name" == 'legacy_replay_table_is_preserved_while_current_custody_commits_and_reads_back' ]]; then
    for fixture_database in "$test_database" "$origin_current_database"; do
      docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
        --username postgres --dbname "$fixture_database" << 'SQL'
DO $fixture_cleanup$
BEGIN
  IF pg_catalog.to_regclass(
    'public.rd_exploratory_replay_request_custody_v1'
  ) IS NOT NULL THEN
    RAISE EXCEPTION 'legacy Replay duplicate fixture was not removed';
  END IF;
END
$fixture_cleanup$;
REVOKE USAGE ON SCHEMA vibe_test_admin
  FROM vibe_test_legacy_replay_fault_writer;
REVOKE SELECT ON TABLE vibe_test_admin.dedicated_postgres_test_instance_v1
  FROM vibe_test_legacy_replay_fault_writer;
DELETE FROM vibe_test_admin.dedicated_postgres_test_instance_v1
 WHERE test_role='vibe_test_legacy_replay_fault_writer';
DROP SCHEMA vibe_test_legacy_replay_fault CASCADE;
SQL
    done
    docker exec --interactive "$container" psql --quiet --set ON_ERROR_STOP=1 \
      --username postgres --dbname postgres \
      --set=test_database="$test_database" \
      --set=origin_current_database="$origin_current_database" << 'SQL'
REVOKE CONNECT ON DATABASE :"test_database"
  FROM vibe_test_legacy_replay_fault_writer;
REVOKE CONNECT ON DATABASE :"origin_current_database"
  FROM vibe_test_legacy_replay_fault_writer;
DROP ROLE vibe_test_legacy_replay_fault_writer;
SQL
  fi
done

legacy_replay_fingerprint_after="$(legacy_replay_fingerprint)"
readonly legacy_replay_fingerprint_after
if [[ "$legacy_replay_fingerprint_after" != "$legacy_replay_fingerprint_before" ]]; then
  echo "ERROR: legacy exploratory Replay table data or catalog changed." >&2
  exit 1
fi

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
       WITH expected(role_name,privilege_type,is_grantable,grantor_name) AS (VALUES
         ('rd_owner','CONNECT',false,'rd_database_owner'),('rd_fact_writer','CONNECT',false,'rd_database_owner'),
         ('operator_authorization_writer','CONNECT',false,'rd_database_owner'),('qualification_writer','CONNECT',false,'rd_database_owner'),
         ('product_edge_owner','CONNECT',false,'rd_database_owner'),('backtest_owner','CONNECT',false,'rd_database_owner'),
         ('vibe_test_owner_topology_admin','CONNECT',false,'rd_database_owner')
       ), actual AS (
         SELECT COALESCE(role.rolname,'PUBLIC'),database_acl.privilege_type,database_acl.is_grantable,
                pg_catalog.pg_get_userbyid(database_acl.grantor)
         FROM pg_catalog.pg_database database_entry
         CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(
           database_entry.datacl,
           pg_catalog.acldefault('d', database_entry.datdba)
         )) database_acl
         LEFT JOIN pg_catalog.pg_roles role ON role.oid=database_acl.grantee
         WHERE database_entry.datname=pg_catalog.current_database()
           AND database_acl.grantee<>database_entry.datdba
       )
       SELECT * FROM expected EXCEPT SELECT * FROM actual
       UNION ALL
       SELECT * FROM actual EXCEPT SELECT * FROM expected
     )
     OR NOT pg_catalog.has_database_privilege('rd_owner', pg_catalog.current_database(), 'CONNECT')
     OR NOT pg_catalog.has_database_privilege('rd_fact_writer', pg_catalog.current_database(), 'CONNECT')
     OR NOT pg_catalog.has_database_privilege('operator_authorization_writer', pg_catalog.current_database(), 'CONNECT')
     OR NOT pg_catalog.has_database_privilege('qualification_writer', pg_catalog.current_database(), 'CONNECT')
     OR NOT pg_catalog.has_database_privilege('product_edge_owner', pg_catalog.current_database(), 'CONNECT')
     OR NOT pg_catalog.has_database_privilege('backtest_owner', pg_catalog.current_database(), 'CONNECT')
     OR pg_catalog.has_database_privilege('qualification_owner', pg_catalog.current_database(), 'CONNECT')
     OR pg_catalog.has_database_privilege('operator_authorization_owner', pg_catalog.current_database(), 'CONNECT')
     OR (SELECT count(*)<>1 OR count(*) FILTER (WHERE granted.rolname='composer_owner' AND NOT membership.admin_option AND membership.inherit_option AND membership.set_option)<>1 FROM pg_catalog.pg_auth_members membership JOIN pg_catalog.pg_roles administrator ON administrator.oid=membership.member JOIN pg_catalog.pg_roles granted ON granted.oid=membership.roleid WHERE administrator.rolname='vibe_test_owner_topology_admin')
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members membership JOIN pg_catalog.pg_roles granted ON granted.oid=membership.roleid JOIN pg_catalog.pg_roles member ON member.oid=membership.member WHERE granted.rolname IN ('replay_policy_catalog_owner','rd_owner','rd_fact_writer') OR member.rolname IN ('replay_policy_catalog_owner','rd_owner','rd_fact_writer'))
     OR EXISTS (
       SELECT 1 FROM pg_catalog.unnest(ARRAY['rd_owner','rd_fact_writer','operator_authorization_writer','qualification_writer','product_edge_owner','backtest_owner']) runtime_role(role_name)
       WHERE pg_catalog.has_database_privilege(runtime_role.role_name,pg_catalog.current_database(),'CREATE')
          OR pg_catalog.has_database_privilege(runtime_role.role_name,pg_catalog.current_database(),'TEMPORARY')
     )
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
     OR pg_catalog.pg_get_userbyid((
          SELECT namespace.nspowner FROM pg_catalog.pg_namespace namespace
           WHERE namespace.nspname='rd_owner_api'
        )) IS DISTINCT FROM 'rd_custodian'
     OR NOT pg_catalog.has_schema_privilege('rd_owner', 'rd_owner_api', 'USAGE')
     OR pg_catalog.has_schema_privilege('rd_owner', 'rd_owner_api', 'CREATE')
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
      AND role.rolname = 'rd_custodian'
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
      AND role.rolname = 'rd_custodian'
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
      AND role.rolname = 'rd_custodian'
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
       'public.rd_sealed_exploratory_replay_requests_v1',
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

  IF (SELECT tableowner FROM pg_catalog.pg_tables WHERE schemaname = 'public' AND tablename = 'rd_independence_bases_v1') <> 'rd_custodian'
     OR (SELECT tableowner FROM pg_catalog.pg_tables WHERE schemaname = 'public' AND tablename = 'rd_owner_outbox_v1') <> 'rd_custodian'
     OR (SELECT tableowner FROM pg_catalog.pg_tables WHERE schemaname = 'public' AND tablename = 'rd_sealed_exploratory_replay_requests_v1') <> 'rd_custodian'
  THEN
    RAISE EXCEPTION 'R&D canonical source ownership mismatch';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class relation
      CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(
        relation.relacl,
        pg_catalog.acldefault('r', relation.relowner)
      )) acl
     WHERE relation.oid='public.rd_sealed_exploratory_replay_requests_v1'::pg_catalog.regclass
       AND acl.grantee<>relation.relowner
  ) THEN
    RAISE EXCEPTION 'sealed exploratory Replay table ACL is not Owner-private';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class relation
      JOIN pg_catalog.pg_attribute attribute ON attribute.attrelid=relation.oid
      CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) acl
     WHERE relation.oid='public.rd_sealed_exploratory_replay_requests_v1'::pg_catalog.regclass
       AND attribute.attnum>0
       AND NOT attribute.attisdropped
       AND acl.grantee<>relation.relowner
  ) THEN
    RAISE EXCEPTION 'sealed exploratory Replay column ACL is not Owner-private';
  END IF;

  IF pg_catalog.to_regclass('public.rd_exploratory_replay_request_custody_v1') IS NOT NULL
     OR (
       SELECT pg_catalog.count(*)
         FROM public.rd_sealed_exploratory_replay_requests_v1
        WHERE request_identity='internal-continuity-replay-v1'
          AND request_digest='sha256:internal-continuity-request-v1'
          AND committed_at_epoch_ms=1700000000000
          AND request_schema_version=1
     ) <> 1
  THEN
    RAISE EXCEPTION 'prior internal exploratory Replay custody was orphaned';
  END IF;

END
$acl$;
SQL
