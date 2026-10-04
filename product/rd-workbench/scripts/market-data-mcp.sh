#!/usr/bin/env bash
# The market-data MCP server for the local deployment that scripts/up.sh brings up.
#
#   market-data-mcp.sh install   builds market-data-mcp on this host, copies it into the state
#                                 directory, and prints the one `claude mcp add` command
#   market-data-mcp.sh           what Claude Code runs: reads RD_OWNER_API_TOKEN from the state
#                                 directory's env file and execs the server with it
#
# market-data-mcp and strategy-authoring-mcp are two processes reaching the same rd-owner-api
# deployment, which mounts both Owners' routes behind the one token up.sh generated: the token
# stays in the env file, never printed, never written into Claude Code's configuration, and never
# passed on a command line. MARKET_DATA_OWNER_API_URL defaults to the same loopback port
# strategy-authoring-mcp.sh uses.
set -euo pipefail

package_dir=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
repo_root=$(CDPATH='' cd -- "$package_dir/../.." && pwd)
# shellcheck source=product/rd-workbench/scripts/local-deployment.bash
source "$package_dir/scripts/local-deployment.bash"
env_file=$state_dir/.env
server=$state_dir/bin/market-data-mcp
self=$package_dir/scripts/market-data-mcp.sh

if [ "${1:-}" = install ]; then
  if [ ! -f "$env_file" ]; then
    echo "$env_file is missing: run make rd-workbench-up first" >&2
    exit 1
  fi
  # The server is its own Cargo workspace, with its own Cargo.lock, outside the root workspace.
  manifest=$repo_root/services/market-data-mcp/Cargo.toml
  cargo build --locked --release --manifest-path "$manifest"
  target_dir=$(cargo metadata --format-version 1 --no-deps --manifest-path "$manifest" |
    python3 -c 'import json, sys; print(json.load(sys.stdin)["target_directory"])')
  mkdir -p "$state_dir/bin"
  install -m 0755 "$target_dir/release/market-data-mcp" "$server"
  echo "Installed $server"
  echo "Register it with Claude Code (the token is read from $env_file when the server starts):"
  echo
  if [ "$local_project" = trade-rd-local ]; then
    echo "  claude mcp add --scope user market-data -- $self"
  else
    echo "  claude mcp add --scope user market-data -e RD_LOCAL_PROJECT=$local_project -- $self"
  fi
  echo
  echo "MARKET_DATA_OWNER_API_URL defaults to http://127.0.0.1:$api_port; set"
  echo "RD_LOCAL_API_PORT or MARKET_DATA_OWNER_API_URL in Claude Code's environment only if up.sh"
  echo "published another port."
  exit 0
fi

if [ ! -x "$server" ]; then
  echo "$server is missing: run make mcp-market-data" >&2
  exit 1
fi
token=$(sed -n 's/^RD_OWNER_API_TOKEN=//p' "$env_file")
if [ -z "$token" ]; then
  echo "$env_file names no RD_OWNER_API_TOKEN" >&2
  exit 1
fi
export MARKET_DATA_OWNER_API_TOKEN=$token
export MARKET_DATA_OWNER_API_URL=${MARKET_DATA_OWNER_API_URL:-http://127.0.0.1:$api_port}
exec "$server"
