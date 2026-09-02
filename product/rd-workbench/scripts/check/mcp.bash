#!/usr/bin/env bash
set -eu

check_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
# shellcheck source=product/rd-workbench/scripts/check/common.bash
. "$check_dir/common.bash"

python3 - "$profile" << 'PY'
import json
import sys

profile = json.load(open(sys.argv[1], encoding="utf-8"))
expected = [
    "mcp:scripts:f/trade/product_edge/research_goal_v2",
    "mcp:scripts:f/trade/product_edge/artifact_build_v1",
    "mcp:scripts:f/trade/product_edge/exploratory_replay_v2",
    "mcp:scripts:f/trade/product_edge/develop_composer_v2",
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
