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
grep -Fq 'backend.artifact_build' "$package_dir/f/trade/rd_workbench.raw_app/App.tsx"
grep -Fq 'artifactResult.artifact_review' "$package_dir/f/trade/rd_workbench.raw_app/App.tsx"
grep -Fq 'artifactResult?.artifact_review_actions?.actions' "$package_dir/f/trade/rd_workbench.raw_app/App.tsx"
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
node --test "$package_dir/f/trade/rd_workbench.raw_app/control-policy.test.mjs"

python3 - "$profile" << 'PY'
import json
import sys

profile = json.load(open(sys.argv[1], encoding="utf-8"))
expected = [
    "mcp:scripts:f/trade/product_edge/research_goal_v1",
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

POSTGRES_PASSWORD=check-only \
  RD_OWNER_DB_PASSWORD=check-only \
  RD_OWNER_API_TOKEN=check-only \
  WINDMILL_DATABASE_URL=check-only \
  RD_OWNER_DATABASE_URL=check-only \
  docker compose --project-directory "$package_dir" --file "$compose_file" config --quiet
