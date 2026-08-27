#!/usr/bin/env bash
set -eu

check_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
# shellcheck source=product/rd-workbench/scripts/check/common.bash
. "$check_dir/common.bash"

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
