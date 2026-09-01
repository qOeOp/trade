#!/usr/bin/env bash
set -eu

check_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
# shellcheck source=product/rd-workbench/scripts/check/common.bash
. "$check_dir/common.bash"

grep -Fq 'ALTER TABLE operator_authorization_private.operator_authorization_issuances_v1 OWNER TO operator_authorization_owner' "$package_dir/postgres-init/10-migrate-authority-custody.sh"
grep -Fq 'ALTER DATABASE %I OWNER TO rd_database_owner' "$package_dir/postgres-init/10-migrate-authority-custody.sh"
grep -Fq 'ALTER SCHEMA public OWNER TO rd_database_owner' "$package_dir/postgres-init/10-migrate-authority-custody.sh"
grep -Fq 'CREATE SCHEMA IF NOT EXISTS replay_policy_catalog_private AUTHORIZATION replay_policy_catalog_owner' "$package_dir/postgres-init/10-migrate-authority-custody.sh"
grep -Fq 'CREATE SCHEMA IF NOT EXISTS composer_private AUTHORIZATION composer_owner' "$package_dir/postgres-init/10-migrate-authority-custody.sh"
grep -Fq 'ALTER TABLE public.%I SET SCHEMA replay_policy_catalog_private' "$package_dir/postgres-init/10-migrate-authority-custody.sh"
grep -Fq 'ALTER TABLE public.%I SET SCHEMA composer_private' "$package_dir/postgres-init/10-migrate-authority-custody.sh"
grep -Fq 'CREATE OR REPLACE FUNCTION replay_policy_catalog_api.apply_replay_policy_catalog_command_v2(' "$package_dir/postgres-init/10-migrate-authority-custody.sh"
grep -Fq 'CREATE OR REPLACE FUNCTION replay_policy_catalog_api.lock_current_replay_policy_catalog_v2()' "$package_dir/postgres-init/10-migrate-authority-custody.sh"
grep -Fq 'CREATE OR REPLACE FUNCTION composer_owner_api.commit_develop_composer_v2(' "$package_dir/postgres-init/10-migrate-authority-custody.sh"
grep -Fq 'CREATE OR REPLACE FUNCTION composer_owner_api.lock_accepted_develop_composer_v2(' "$package_dir/postgres-init/10-migrate-authority-custody.sh"
test "$(grep -Fc "IF SESSION_USER<>'rd_fact_writer' THEN RAISE EXCEPTION 'R&D fact writer required'" "$package_dir/postgres-init/10-migrate-authority-custody.sh")" -eq 2
grep -Fq "DO \$database_acl_cutover\$" "$package_dir/postgres-init/10-migrate-authority-custody.sh"
grep -Fq 'REVOKE ALL PRIVILEGES ON DATABASE %I FROM PUBLIC' "$package_dir/postgres-init/10-migrate-authority-custody.sh"
grep -Fq "DO \$database_acl_readback\$" "$package_dir/postgres-init/10-migrate-authority-custody.sh"
grep -Fq "'rd_fact_writer','CONNECT',false,'rd_database_owner'" "$package_dir/postgres-init/10-migrate-authority-custody.sh"
grep -Fq "R&D database ACL manifest mismatch" "$package_dir/postgres-init/10-migrate-authority-custody.sh"
grep -Fq 'GRANT CREATE ON DATABASE :"test_database" TO rd_owner' "$package_dir/../../scripts/ci/test-rd-owner-postgres.bash"
grep -Fq "pg_catalog.current_database(),'TEMPORARY'" "$package_dir/../../scripts/ci/test-rd-owner-postgres.bash"
grep -Fq 'for runtime_role in rd_owner rd_fact_writer operator_authorization_writer qualification_writer product_edge_owner backtest_owner' "$package_dir/../../scripts/ci/test-rd-owner-postgres.bash"
grep -Fq "DO \$catalog_composer_function_acl_cutover\$" "$package_dir/postgres-init/10-migrate-authority-custody.sh"
grep -Fq "DO \$catalog_composer_relation_acl_cutover\$" "$package_dir/postgres-init/10-migrate-authority-custody.sh"
grep -Fq "DO \$catalog_composer_relation_acl_readback\$" "$package_dir/postgres-init/10-migrate-authority-custody.sh"
grep -Fq "REVOKE ALL (%I) ON TABLE %I.%I FROM %I" "$package_dir/postgres-init/10-migrate-authority-custody.sh"
grep -Fq "Catalog/Composer column ACL manifest mismatch" "$package_dir/postgres-init/10-migrate-authority-custody.sh"
grep -Fq "Catalog/Composer sequence manifest mismatch" "$package_dir/postgres-init/10-migrate-authority-custody.sh"
grep -Fq 'GRANT SELECT(catalog_record_id) ON TABLE replay_policy_catalog_private.rd_replay_policy_catalog_records_v2 TO legacy_catalog_actor' "$package_dir/../../scripts/ci/test-rd-owner-postgres.bash"
grep -Fq -- "--command 'SELECT count(*) FROM replay_policy_catalog_api.lock_current_replay_policy_catalog_v2()'" "$package_dir/../../scripts/ci/test-rd-owner-postgres.bash"
grep -Fq "ALTER ROLE rd_owner LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS" "$package_dir/postgres-init/10-migrate-authority-custody.sh"
grep -Fq "DO \$catalog_composer_constraint_manifest\$" "$package_dir/postgres-init/10-migrate-authority-custody.sh"
grep -Fq "foreign-key dependency manifest mismatch" "$package_dir/postgres-init/10-migrate-authority-custody.sh"
grep -Fq 'CREATE ROLE rd_fact_writer LOGIN' "$package_dir/postgres-init/10-migrate-authority-custody.sh"
grep -Fq ') TO rd_fact_writer;' "$package_dir/postgres-init/10-migrate-authority-custody.sh"
if grep -Eq 'GRANT EXECUTE ON FUNCTION (replay_policy_catalog_api\.apply_replay_policy_catalog_command_v2|composer_owner_api\.commit_develop_composer_v2).* TO rd_owner' "$package_dir/postgres-init/10-migrate-authority-custody.sh"; then
  echo "rd_owner must not execute Catalog/Composer mutation routines" >&2
  exit 1
fi
if grep -Eq 'GRANT (SELECT|INSERT|UPDATE|DELETE|TRUNCATE).*TO rd_owner' "$package_dir/postgres-init/10-migrate-authority-custody.sh"; then
  echo "rd_owner must use fixed Catalog/Composer APIs, not raw table grants" >&2
  exit 1
fi
grep -Fq "tablename LIKE 'rd_%'" "$package_dir/postgres-init/10-migrate-authority-custody.sh"
if grep -Fq "tablename LIKE 'rd_%' OR tablename LIKE 'qualification_%'" "$package_dir/postgres-init/10-migrate-authority-custody.sh"; then
  echo "rd_owner must not own Qualification tables" >&2
  exit 1
fi
grep -Fq 'ALTER TABLE public.qualification_protected_feedback_projections_v1 OWNER TO qualification_owner' "$package_dir/postgres-init/10-migrate-authority-custody.sh"
grep -Fq 'ALTER DEFAULT PRIVILEGES FOR ROLE rd_owner IN SCHEMA public REVOKE SELECT ON TABLES FROM qualification_owner, qualification_writer' "$package_dir/postgres-init/10-migrate-authority-custody.sh"
grep -Fq "REVOKE ALL PRIVILEGES ON TABLE %I.%I FROM qualification_owner, qualification_writer" "$package_dir/postgres-init/10-migrate-authority-custody.sh"
grep -Fq 'GRANT EXECUTE ON FUNCTION rd_owner_api.lock_independence_basis_for_qualification_v1(text,text,text,jsonb) TO qualification_writer' "$package_dir/postgres-init/10-migrate-authority-custody.sh"
grep -Fq 'CREATE OR REPLACE FUNCTION qualification_api.lock_projection_for_basis_v1(' "$package_dir/postgres-init/10-migrate-authority-custody.sh"
grep -Fq "ALTER TABLE %I.%I OWNER TO rd_owner" "$package_dir/postgres-init/10-migrate-authority-custody.sh"
grep -Fq 'ALTER TABLE %I.%I OWNER TO product_edge_owner' "$package_dir/postgres-init/10-migrate-authority-custody.sh"
test "$(grep -Ec '^UPDATE public\.product_edge_(deployment_bindings|request_admissions)_v1$' "$package_dir/postgres-init/10-migrate-authority-custody.sh")" -eq 2
if grep -Eq '^[[:space:]]*(DELETE FROM|UPDATE .*SET .*(_json|_digest|committed_at)|INSERT INTO .*(_json|_digest|committed_at))[[:space:]]' "$package_dir/postgres-init/10-migrate-authority-custody.sh"; then
  echo "authority custody migration must not rewrite canonical business facts" >&2
  exit 1
fi
grep -Fq 'CREATE OR REPLACE FUNCTION product_edge_api.lock_downstream_admission_v1(' "$package_dir/postgres-init/10-migrate-authority-custody.sh"
grep -Fq 'RETURNS jsonb LANGUAGE plpgsql STRICT VOLATILE PARALLEL UNSAFE SECURITY DEFINER' "$package_dir/postgres-init/10-migrate-authority-custody.sh"
grep -Fq 'SET search_path = pg_catalog' "$package_dir/postgres-init/10-migrate-authority-custody.sh"
grep -Fq 'GRANT EXECUTE ON FUNCTION product_edge_api.lock_downstream_admission_v1(text,text,text) TO rd_owner, product_edge_owner' "$package_dir/postgres-init/10-migrate-authority-custody.sh"
grep -Fq 'CREATE OR REPLACE FUNCTION product_edge_api.lock_source_invocation_claim_v1(' "$package_dir/postgres-init/10-migrate-authority-custody.sh"
grep -Fq 'CREATE OR REPLACE FUNCTION product_edge_api.lock_source_invocation_started_v1(' "$package_dir/postgres-init/10-migrate-authority-custody.sh"
grep -Fq 'GRANT EXECUTE ON FUNCTION product_edge_api.lock_source_invocation_claim_v1(text,text,text) TO rd_owner, product_edge_owner' "$package_dir/postgres-init/10-migrate-authority-custody.sh"
grep -Fq 'GRANT EXECUTE ON FUNCTION product_edge_api.lock_source_invocation_started_v1(text,text,text) TO rd_owner, product_edge_owner' "$package_dir/postgres-init/10-migrate-authority-custody.sh"
grep -Fq 'CREATE SCHEMA IF NOT EXISTS rd_owner_api AUTHORIZATION rd_owner' "$package_dir/postgres-init/10-migrate-authority-custody.sh"
grep -Fq 'GRANT USAGE ON SCHEMA rd_owner_api TO product_edge_owner' "$package_dir/postgres-init/10-migrate-authority-custody.sh"
grep -Fq 'CREATE OR REPLACE FUNCTION rd_owner_api.lock_source_acquisition_binding_v1(' "$package_dir/../../crates/strategy_factory/src/source_intake/postgres.rs"
grep -Fq 'CREATE OR REPLACE FUNCTION rd_owner_api.lock_source_invocation_reservation_v1(' "$package_dir/../../crates/strategy_factory/src/source_intake/postgres.rs"
grep -Fq 'CREATE OR REPLACE FUNCTION rd_owner_api.lock_current_research_for_artifact_v1(' "$package_dir/../../crates/strategy_factory/src/product_edge_postgres.rs"
grep -Fq 'RETURNS jsonb LANGUAGE plpgsql STRICT VOLATILE PARALLEL UNSAFE SECURITY DEFINER' "$package_dir/../../crates/strategy_factory/src/product_edge_postgres.rs"
grep -Fq 'SET search_path = pg_catalog' "$package_dir/../../crates/strategy_factory/src/product_edge_postgres.rs"
grep -Fq 'GRANT EXECUTE ON FUNCTION rd_owner_api.lock_current_research_for_artifact_v1(text,text,text) TO product_edge_owner' "$package_dir/../../crates/strategy_factory/src/product_edge_postgres.rs"
grep -Fq '.admit_artifact_build_request(' "$package_dir/../../crates/strategy_factory_rd_owner_api/src/main.rs"
grep -Fq 'if request.operation == ARTIFACT_BUILD_OPERATION_V1' "$package_dir/../../crates/product_edge/src/postgres.rs"
if grep -Fq 'ProductEdgeCurrentOwnerEvidence' "$package_dir/../../crates/product_edge/src/lib.rs" ||
  grep -Eq 'valid_through_epoch_ms:[[:space:]]*number|fresh:[[:space:]]*boolean|evidence_digest:[[:space:]]*string' \
    "$package_dir/f/trade/product_edge/artifact_build_v1.ts"; then
  echo "artifact transport must expose no caller-constructible freshness evidence" >&2
  exit 1
fi
test "$(grep -c 'SELECT operator_authorization_api.lock_current_authorization_v1(' "$package_dir/postgres-init/10-migrate-authority-custody.sh")" -eq 1
oa_lock_line=$(grep -n 'SELECT operator_authorization_api.lock_current_authorization_v1(' "$package_dir/postgres-init/10-migrate-authority-custody.sh" | cut -d: -f1)
pe_lock_line=$(grep -n "pg_advisory_xact_lock_shared(pg_catalog.hashtextextended('deployment'" "$package_dir/postgres-init/10-migrate-authority-custody.sh" | cut -d: -f1)
test "$oa_lock_line" -lt "$pe_lock_line"
grep -Fq 'product-edge-recover-expired-manifests' "$package_dir/Dockerfile.owner"
grep -Fq 'authority-recovery:' "$package_dir/docker-compose.yml"
grep -Fq 'profiles: ["authority-admin"]' "$package_dir/docker-compose.yml"
grep -Fq 'PRODUCT_EDGE_RECOVERY_CONFIG' "$package_dir/docker-compose.yml"
grep -Fq ':/run/secrets/product-edge-recovery.json:ro' "$package_dir/docker-compose.yml"
grep -Fq 'authority-custody-migrate:' "$package_dir/docker-compose.yml"
if grep -Eq '^[[:space:]]*authority-recovery:[[:space:]]*$' "$package_dir/docker-compose.yml" &&
  ! grep -A3 -F 'authority-recovery:' "$package_dir/docker-compose.yml" | grep -Fq 'profiles: ["authority-admin"]'; then
  echo "authority recovery must remain opt-in" >&2
  exit 1
fi
