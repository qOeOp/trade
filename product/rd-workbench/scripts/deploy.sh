#!/bin/sh
set -eu

: "${WINDMILL_TOKEN:?set WINDMILL_TOKEN from the authenticated local workspace}"
package_dir=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
workspace_id=${WINDMILL_WORKSPACE_ID:-trade-rd}
base_url=${WINDMILL_BASE_URL:-http://127.0.0.1:18000}

cd "$package_dir"
npx --yes --package=windmill-cli@1.791.0 -- wmill \
  --base-url "$base_url" \
  --workspace "$workspace_id" \
  --token "$WINDMILL_TOKEN" \
  sync push --yes --locks-required --lint

# Windmill CLI generates publisher mode for Full-code Apps by default. S1 is
# deliberately viewer-mode: the authenticated viewer's permissions must govern
# the only Product Edge operation. Re-upload the exact bundle with the same
# generated trigger policy and only change execution_mode.
command -v curl > /dev/null 2>&1 || {
  echo "curl is required" >&2
  exit 1
}
command -v jq > /dev/null 2>&1 || {
  echo "jq is required" >&2
  exit 1
}

app_path=f/trade/rd_workbench
app_dir="$package_dir/$app_path.raw_app"
app_payload=$(mktemp "${TMPDIR:-/tmp}/rd-workbench-app.XXXXXX")
trap 'rm -f "$app_payload"' EXIT HUP INT TERM

npx --yes --package=windmill-cli@1.791.0 -- wmill app bundle "$app_dir"
npx --yes --package=windmill-cli@1.791.0 -- wmill \
  --base-url "$base_url" \
  --workspace "$workspace_id" \
  --token "$WINDMILL_TOKEN" \
  app get "$app_path" --json |
  jq '.policy.execution_mode = "viewer"
      | {path, summary, value, policy,
         deployment_message: "S1 authenticated viewer policy"}' \
    > "$app_payload"

curl --fail --silent --show-error \
  -X POST \
  -H "Authorization: Bearer $WINDMILL_TOKEN" \
  -F "app=@$app_payload;type=application/json" \
  -F "js=@$app_dir/dist/bundle.js;type=text/javascript" \
  -F "css=@$app_dir/dist/bundle.css;type=text/css" \
  "$base_url/api/w/$workspace_id/apps/update_raw/$app_path" \
  > /dev/null

execution_mode=$(npx --yes --package=windmill-cli@1.791.0 -- wmill \
  --base-url "$base_url" \
  --workspace "$workspace_id" \
  --token "$WINDMILL_TOKEN" \
  app get "$app_path" --json | jq -r '.policy.execution_mode')
[ "$execution_mode" = viewer ] || {
  echo "raw app execution mode mismatch: $execution_mode" >&2
  exit 1
}
