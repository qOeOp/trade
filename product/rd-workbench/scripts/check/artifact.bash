#!/usr/bin/env bash
set -eu

check_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
# shellcheck source=product/rd-workbench/scripts/check/common.bash
. "$check_dir/common.bash"

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
