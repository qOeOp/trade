#!/bin/sh
set -eu

package_dir=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
compose_file="$package_dir/docker-compose.yml"
app_yaml="$package_dir/f/trade/rd_workbench.raw_app/raw_app.yaml"
profile="$package_dir/mcp-profile.json"

grep -Fq 'ghcr.io/windmill-labs/windmill:1.791.0@sha256:1e9ec20f5a99235ccce18e4a4879a8c14ff1738af37fd23c18d87594dcee5916' "$compose_file"
test "$(grep -c 'ghcr.io/windmill-labs/windmill:1.791.0@sha256:' "$compose_file")" -eq 2
if grep -Eq 'windmill[^[:space:]]*:(main|latest)(@|[[:space:]])' "$compose_file"; then
  echo "floating Windmill image tag is forbidden" >&2
  exit 1
fi

grep -Fq 'execution_mode: viewer' "$app_yaml"
if grep -Eq 'execution_mode: (publisher|anonymous)|(^|[[:space:]])public:' "$app_yaml"; then
  echo "unsafe Raw App execution policy" >&2
  exit 1
fi
if grep -Eq '^[[:space:]]*data:' "$app_yaml"; then
  echo "Raw App data-table access is forbidden" >&2
  exit 1
fi
grep -Fq '"IDENTITY_CONFLICT"' "$package_dir/f/trade/rd_workbench.raw_app/App.tsx"
grep -Fq 'result.owner_receipt' "$package_dir/f/trade/rd_workbench.raw_app/App.tsx"
grep -Fq 'path: f/trade/product_edge/research_goal_v2' "$package_dir/f/trade/rd_workbench.raw_app/backend/research_goal.yaml"
if grep -Fq '.route("/v1/research-goals", post' \
  "$package_dir/../../crates/strategy_factory_rd_owner_api/src/main.rs"; then
  echo "fresh V1 research submission route is forbidden" >&2
  exit 1
fi
if grep -Fq 'research_goal.submit_or_resolve.v1' \
  "$package_dir/../../crates/product_edge_admin/src/main.rs"; then
  echo "fresh V1 research manifest is forbidden" >&2
  exit 1
fi
grep -Fq 'type Action = "RESOLVE"' "$package_dir/f/trade/product_edge/research_goal_v1.ts"
grep -Fq 'result.trial_family.root_receipt.receipt_identity' "$package_dir/f/trade/rd_workbench.raw_app/App.tsx"
grep -Fq 'result.trial_family.membership_receipt.receipt_identity' "$package_dir/f/trade/rd_workbench.raw_app/App.tsx"
grep -Fq 'result.trial_family.census_frontier.frontier_identity' "$package_dir/f/trade/rd_workbench.raw_app/App.tsx"
grep -Fq 'backend.artifact_build' "$package_dir/f/trade/rd_workbench.raw_app/App.tsx"
grep -Fq 'artifactResult.artifact_review' "$package_dir/f/trade/rd_workbench.raw_app/App.tsx"
grep -Fq 'artifactResult?.artifact_review_actions?.actions' "$package_dir/f/trade/rd_workbench.raw_app/App.tsx"
grep -Fq 'verifyResearchConsumerProjectionV1(response, requestIdentity)' "$package_dir/f/trade/rd_workbench.raw_app/App.tsx"
grep -Fq 'verifyArtifactConsumerProjectionV1(' "$package_dir/f/trade/rd_workbench.raw_app/App.tsx"
grep -Fq 'deriveResearchConsumerProjectionV1(raw, request_identity)' "$package_dir/f/trade/product_edge/research_goal_v2.ts"
grep -Fq 'deriveArtifactConsumerProjectionV1(' "$package_dir/f/trade/product_edge/artifact_build_v1.ts"
grep -Fq '!artifactRunAdmission.canInvoke' \
  "$package_dir/f/trade/rd_workbench.raw_app/App.tsx"
grep -Fq 'research_request_identity,' \
  "$package_dir/f/trade/product_edge/artifact_build_v1.ts"
grep -Fq 'execution_custody.research_request_identity() != research_request_identity' \
  "$package_dir/../../crates/strategy_factory_rd_owner_api/src/main.rs"
grep -Fq 'researchAvailableAt(result, s1Context, consumerClockEpochMs)' \
  "$package_dir/f/trade/rd_workbench.raw_app/App.tsx"
grep -Fq 'const artifactDisplayContext = s1Context ?? artifactS1Context' \
  "$package_dir/f/trade/rd_workbench.raw_app/App.tsx"
grep -Fq 'artifactAvailableAt(artifactResult, artifactDisplayContext, consumerClockEpochMs)' \
  "$package_dir/f/trade/rd_workbench.raw_app/App.tsx"
grep -Fq 'artifactBoundToS1Context(artifactResult, artifactDisplayContext)' \
  "$package_dir/f/trade/rd_workbench.raw_app/App.tsx"
grep -Fq 'artifactContextCurrentAt(artifactResult, artifactDisplayContext, consumerClockEpochMs)' \
  "$package_dir/f/trade/rd_workbench.raw_app/App.tsx"
grep -Fq 'deriveVerifiedArtifactS1ContextV1(' \
  "$package_dir/f/trade/rd_workbench.raw_app/App.tsx"
grep -Fq 'artifactContextCurrentAt(result, s1Context, nowEpochMs)' \
  "$package_dir/f/trade/rd_workbench.raw_app/control-policy.mjs"
grep -Fq 'receipt.intent_semantic_digest === s1Context?.intent_semantic_digest' \
  "$package_dir/f/trade/rd_workbench.raw_app/control-policy.mjs"
grep -Fq 'review.intent_semantic_digest === s1Context?.intent_semantic_digest' \
  "$package_dir/f/trade/rd_workbench.raw_app/control-policy.mjs"
grep -Fq 'nowEpochMs < s1Context.valid_through_epoch_ms' \
  "$package_dir/f/trade/rd_workbench.raw_app/control-policy.mjs"
grep -Fq 'nowEpochMs < result.research_view.valid_through_epoch_ms' \
  "$package_dir/f/trade/rd_workbench.raw_app/control-policy.mjs"
grep -Fq 'family?.root?.root_digest === s1Context?.trial_family_root_digest' \
  "$package_dir/f/trade/rd_workbench.raw_app/control-policy.mjs"
grep -Fq 'binding?.census_frontier_digest === s1Context?.census_frontier_digest' \
  "$package_dir/f/trade/rd_workbench.raw_app/control-policy.mjs"
grep -Fq 'artifactResult.artifact_trial_family.binding_receipt.receipt_identity' "$package_dir/f/trade/rd_workbench.raw_app/App.tsx"
grep -Fq 'independence_rationale: string' "$package_dir/f/trade/product_edge/research_goal_v2.ts"
grep -Fq 'result.independence_basis.receipt.receipt_identity' "$package_dir/f/trade/rd_workbench.raw_app/App.tsx"
grep -Fq 'result.protected_feedback.receipt.receipt_identity' "$package_dir/f/trade/rd_workbench.raw_app/App.tsx"
if grep -Eq 'semantic_predecessor_frontier|protected_feedback_frontier|independence_disposition|independence_basis_identity|frozen_falsifier_binding' "$package_dir/f/trade/product_edge/research_goal_v2.ts"; then
  echo "Product Edge V2 request must not accept canonical lineage or protected-feedback authority" >&2
  exit 1
fi
if grep -Eq 'trial_family_identity[?:]?[[:space:]]*(string|String)' "$package_dir/f/trade/product_edge/research_goal_v2.ts"; then
  echo "Product Edge V2 request must not accept a caller family identity" >&2
  exit 1
fi
if grep -Fq '_NOT_IMPLEMENTED_IN_S2"))' "$package_dir/f/trade/rd_workbench.raw_app/App.tsx"; then
  echo "Raw App must not infer action admission from string suffixes" >&2
  exit 1
fi
trap_line=$(grep -n '^trap cleanup EXIT HUP INT TERM$' "$package_dir/scripts/deploy.sh" | cut -d: -f1)
credential_copy_line=$(grep -n '^python3 - ' "$package_dir/scripts/deploy.sh" | cut -d: -f1)
[ "$trap_line" -lt "$credential_copy_line" ] || {
  echo "deployment credential cleanup must be armed before the first copy" >&2
  exit 1
}
grep -Fq 'network_mode: none' "$compose_file"
grep -Fq 'cap_drop:' "$compose_file"
grep -Fq 'read_only: true' "$compose_file"
grep -Fq 'profiles: ["authority-admin"]' "$compose_file"
test "$(grep -c 'profiles: \["authority-admin"\]' "$compose_file")" -eq 2
grep -Fq 'product-edge-authority-bootstrap' "$package_dir/Dockerfile.owner"
grep -Fq 'invocationClaim.state === "INVOCATION_STARTED"' "$package_dir/f/trade/product_edge/artifact_build_v1.ts"
grep -Fq 'invocationClaim.next_legal_action !== "MANUALLY_RECONCILE_PROVIDER_INVOCATION"' "$package_dir/f/trade/product_edge/artifact_build_v1.ts"
grep -Fq 'validProviderInvocationStartV1(' "$package_dir/f/trade/product_edge/artifact_build_v1.ts"
test "$(grep -c 'generated = await generateCandidate' "$package_dir/f/trade/product_edge/artifact_build_v1.ts")" -eq 1
grep -Fq 'start.admission_identity === claim.admission_identity' "$package_dir/f/trade/product_edge/artifact_build_v1.ts"
grep -Fq 'MANUALLY_RECONCILE_PROVIDER_INVOCATION' "$package_dir/f/trade/product_edge/artifact_build_v1.ts"
grep -Fq 'Complete terminal Owner custody wins over any invocation representation.' \
  "$package_dir/f/trade/product_edge/consumer_projection_v1.ts"
grep -Fq 'MANUALLY_RECONCILE_PROVIDER_INVOCATION' \
  "$package_dir/f/trade/product_edge/consumer_projection_v1.ts"
grep -Fq "rd-research-request-receipt-v2-\${suffix}" \
  "$package_dir/f/trade/product_edge/consumer_projection_v1.ts"
grep -Fq "rd-research-intent-v2-\${suffix}" \
  "$package_dir/f/trade/product_edge/consumer_projection_v1.ts"
grep -Fq 'rd.independence-basis.v1' \
  "$package_dir/f/trade/product_edge/consumer_projection_v1.ts"
grep -Fq 'qualification.protected-feedback-frontier.v1' \
  "$package_dir/f/trade/product_edge/consumer_projection_v1.ts"
grep -Fq 'rd.research-view.identity.v2' \
  "$package_dir/f/trade/product_edge/consumer_projection_v1.ts"
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
grep -Fq 'CREATE SCHEMA IF NOT EXISTS rd_owner_api AUTHORIZATION rd_owner' "$package_dir/postgres-init/10-migrate-authority-custody.sh"
grep -Fq 'GRANT USAGE ON SCHEMA rd_owner_api TO product_edge_owner' "$package_dir/postgres-init/10-migrate-authority-custody.sh"
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
node --test "$package_dir/f/trade/rd_workbench.raw_app/control-policy.test.mjs"
node --test "$package_dir/f/trade/product_edge/artifact_build_v1.metadata.test.mjs"
node --experimental-strip-types --test \
  "$package_dir/f/trade/product_edge/consumer_projection_v1.test.mjs" \
  "$package_dir/f/trade/product_edge/artifact_build_v1.test.mjs"

python3 - "$profile" << 'PY'
import json
import sys

profile = json.load(open(sys.argv[1], encoding="utf-8"))
expected = [
    "mcp:scripts:f/trade/product_edge/research_goal_v2",
    "mcp:scripts:f/trade/product_edge/artifact_build_v1",
    "mcp:endpoints:getJob,getJobLogs",
]
if profile.get("scopes") != expected:
    raise SystemExit("MCP token scopes are not the exact deny-by-default profile")
if profile.get("workspace_id") != "trade-rd":
    raise SystemExit("MCP token must be bound to the product workspace")
if profile.get("read_only") is not False:
    raise SystemExit("MCP token must allow only the scoped Product Edge job run")
if set(profile) != {"label", "workspace_id", "scopes", "read_only"}:
    raise SystemExit("MCP profile must stay a directly mintable NewToken request")
PY

if [ "${1:-}" = "--static-only" ]; then
  exit 0
fi

POSTGRES_PASSWORD=check-only \
  RD_OWNER_DB_PASSWORD=check-only \
  OPERATOR_AUTHORIZATION_DB_PASSWORD=check-only \
  QUALIFICATION_OWNER_DB_PASSWORD=check-only \
  PRODUCT_EDGE_DB_PASSWORD=check-only \
  RD_OWNER_API_TOKEN=check-only \
  WINDMILL_DATABASE_URL=check-only \
  RD_OWNER_DATABASE_URL=check-only \
  OPERATOR_AUTHORIZATION_DATABASE_URL=check-only \
  QUALIFICATION_OWNER_DATABASE_URL=check-only \
  PRODUCT_EDGE_DATABASE_URL=check-only \
  PRODUCT_EDGE_DEPLOYMENT_IDENTITY=check-only \
  PRODUCT_EDGE_TRUSTED_ISSUER_IDENTITY=check-only \
  PRODUCT_EDGE_TRUSTED_ISSUER_KEY_VERSION=check-only \
  PRODUCT_EDGE_TRUSTED_AUTHORIZATION_AUDIENCE=check-only \
  PRODUCT_EDGE_BOOTSTRAP_CONFIG=/tmp/check-only-product-edge-bootstrap.json \
  docker compose --project-directory "$package_dir" --file "$compose_file" config --quiet
