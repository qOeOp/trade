#!/usr/bin/env bash
set -eu

check_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
# shellcheck source=product/rd-workbench/scripts/check/common.bash
. "$check_dir/common.bash"

grep -Fq 'ALTER TABLE operator_authorization_private.operator_authorization_issuances_v1 OWNER TO operator_authorization_owner' "$package_dir/postgres-init/10-migrate-authority-custody.sh"
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
