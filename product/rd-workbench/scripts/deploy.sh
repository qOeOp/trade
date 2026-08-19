#!/bin/sh
set -eu

: "${WINDMILL_TOKEN_FILE:?set WINDMILL_TOKEN_FILE to the private deployment-token file}"
package_dir=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
workspace_id=${WINDMILL_WORKSPACE_ID:-trade-rd}
base_url=${WINDMILL_BASE_URL:-http://127.0.0.1:18000}

case $WINDMILL_TOKEN_FILE in
  /*) ;;
  *)
    echo "WINDMILL_TOKEN_FILE must be absolute" >&2
    exit 1
    ;;
esac
[ -f "$WINDMILL_TOKEN_FILE" ] && [ ! -L "$WINDMILL_TOKEN_FILE" ] || {
  echo "WINDMILL_TOKEN_FILE must be a regular non-symlink file" >&2
  exit 1
}
command -v python3 > /dev/null 2>&1 || {
  echo "python3 is required" >&2
  exit 1
}

umask 077
wmill_config_root=$(mktemp -d "${TMPDIR:-/tmp}/rd-workbench-wmill.XXXXXX")
wmill_config_store="$wmill_config_root/windmill"
mkdir -m 700 "$wmill_config_store"
auth_header="$wmill_config_root/authorization.header"
python3 - "$WINDMILL_TOKEN_FILE" "$wmill_config_store/remotes.ndjson" \
  "$wmill_config_store/activeWorkspace" "$auth_header" "$base_url" "$workspace_id" << 'PY'
import json
import os
import sys

token_path, remotes_path, active_path, header_path, base_url, workspace_id = sys.argv[1:]
with open(token_path, "r", encoding="utf-8") as source:
    token = source.read().strip()
if not token:
    raise SystemExit("deployment token file is empty")
profile = {
    "name": workspace_id,
    "remote": base_url.rstrip("/") + "/",
    "workspaceId": workspace_id,
    "token": token,
}
for path, content in (
    (remotes_path, json.dumps(profile, separators=(",", ":")) + "\n"),
    (active_path, workspace_id),
    (header_path, "Authorization: Bearer " + token + "\n"),
):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as output:
        output.write(content)
PY

cd "$package_dir"
npx --yes --package=windmill-cli@1.791.0 -- wmill \
  --config-dir "$wmill_config_root" \
  --workspace "$workspace_id" \
  sync push --yes --locks-required --lint

# Windmill CLI generates publisher mode for Full-code Apps by default. The
# Workbench is deliberately viewer-mode, and its authored bundle is isolated in
# Windmill's opaque-origin Raw App sandbox. Re-upload the exact bundle with the
# generated trigger policy while closing those two runtime policy fields.
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
cleanup() {
  rm -f "$app_payload"
  rm -rf "$wmill_config_root"
}
trap cleanup EXIT HUP INT TERM

npx --yes --package=windmill-cli@1.791.0 -- wmill app bundle "$app_dir"
npx --yes --package=windmill-cli@1.791.0 -- wmill \
  --config-dir "$wmill_config_root" \
  --workspace "$workspace_id" \
  app get "$app_path" --json |
  jq '.policy.execution_mode = "viewer"
      | .policy.sandbox = true
      | del(.policy.frontend_sdk_scopes)
      | {path, summary, value, policy,
         deployment_message: "S2 authenticated sandboxed viewer policy"}' \
    > "$app_payload"

curl --fail --silent --show-error \
  -X POST \
  -H "@$auth_header" \
  -F "app=@$app_payload;type=application/json" \
  -F "js=@$app_dir/dist/bundle.js;type=text/javascript" \
  -F "css=@$app_dir/dist/bundle.css;type=text/css" \
  "$base_url/api/w/$workspace_id/apps/update_raw/$app_path" \
  > /dev/null

execution_mode=$(npx --yes --package=windmill-cli@1.791.0 -- wmill \
  --config-dir "$wmill_config_root" \
  --workspace "$workspace_id" \
  app get "$app_path" --json | jq -r '.policy.execution_mode')
[ "$execution_mode" = viewer ] || {
  echo "raw app execution mode mismatch: $execution_mode" >&2
  exit 1
}
sandbox=$(npx --yes --package=windmill-cli@1.791.0 -- wmill \
  --config-dir "$wmill_config_root" \
  --workspace "$workspace_id" \
  app get "$app_path" --json | jq -r '.policy.sandbox // false')
[ "$sandbox" = true ] || {
  echo "raw app sandbox mismatch: $sandbox" >&2
  exit 1
}
frontend_sdk_scope_count=$(npx --yes --package=windmill-cli@1.791.0 -- wmill \
  --config-dir "$wmill_config_root" \
  --workspace "$workspace_id" \
  app get "$app_path" --json | jq -r '(.policy.frontend_sdk_scopes // []) | length')
[ "$frontend_sdk_scope_count" -eq 0 ] || {
  echo "raw app frontend SDK scopes must be empty" >&2
  exit 1
}
