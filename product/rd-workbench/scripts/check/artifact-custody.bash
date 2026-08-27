#!/usr/bin/env bash
set -eu

check_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
# shellcheck source=product/rd-workbench/scripts/check/common.bash
. "$check_dir/common.bash"

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
