#!/usr/bin/env bash
# The strategy-authoring MCP server for the local deployment that scripts/up.sh brings up.
#
#   strategy-authoring-mcp.sh install   builds strategy-authoring-mcp on this host, copies it into the
#                                       state directory, and prints the one `claude mcp add` command
#   strategy-authoring-mcp.sh           what Claude Code runs: reads RD_OWNER_API_TOKEN from the state
#                                       directory's env file and execs the server with it
#
# The token stays in the env file up.sh generated. It is never printed, never written into Claude
# Code's configuration, and never passed on a command line; the server reads it from its own
# environment. RD_OWNER_API_URL defaults to the loopback port up.sh publishes.
set -euo pipefail

package_dir=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
repo_root=$(CDPATH='' cd -- "$package_dir/../.." && pwd)
# shellcheck source=product/rd-workbench/scripts/local-deployment.bash
source "$package_dir/scripts/local-deployment.bash"
env_file=$state_dir/.env
server=$state_dir/bin/strategy-authoring-mcp
self=$package_dir/scripts/strategy-authoring-mcp.sh

if [ "${1:-}" = install ]; then
  if [ ! -f "$env_file" ]; then
    echo "$env_file is missing: run make rd-workbench-up first" >&2
    exit 1
  fi
  cargo build --locked --release --manifest-path "$repo_root/Cargo.toml" \
    -p vibe-strategy-authoring-mcp
  target_dir=$(cargo metadata --format-version 1 --no-deps --manifest-path "$repo_root/Cargo.toml" |
    python3 -c 'import json, sys; print(json.load(sys.stdin)["target_directory"])')
  mkdir -p "$state_dir/bin"
  install -m 0755 "$target_dir/release/strategy-authoring-mcp" "$server"
  echo "Installed $server"
  echo "Register it with Claude Code (the token is read from $env_file when the server starts):"
  echo
  if [ "$local_project" = trade-rd-local ]; then
    echo "  claude mcp add --scope user strategy-authoring -- $self"
  else
    echo "  claude mcp add --scope user strategy-authoring -e RD_LOCAL_PROJECT=$local_project -- $self"
  fi
  echo
  echo "RD_OWNER_API_URL defaults to http://127.0.0.1:$api_port; set RD_LOCAL_API_PORT"
  echo "or RD_OWNER_API_URL in Claude Code's environment only if up.sh published another port."
  exit 0
fi

if [ ! -x "$server" ]; then
  echo "$server is missing: run make mcp-strategy-authoring" >&2
  exit 1
fi
token=$(sed -n 's/^RD_OWNER_API_TOKEN=//p' "$env_file")
if [ -z "$token" ]; then
  echo "$env_file names no RD_OWNER_API_TOKEN" >&2
  exit 1
fi
export RD_OWNER_API_TOKEN=$token
export RD_OWNER_API_URL=${RD_OWNER_API_URL:-http://127.0.0.1:$api_port}
exec "$server"
