# shellcheck shell=bash
# shellcheck disable=SC2034 # local_project, state_dir and api_port are read by the sourcing script.
# Sourced by up.sh and the MCP scripts: which local deployment they address.
#
# RD_LOCAL_PROJECT names the compose project (default trade-rd-local). Each project has its own
# volumes and its own state directory, so two deployments never share an env file, a token or a
# database: trade-rd-local keeps product/rd-workbench/.local, and any other project uses
# product/rd-workbench/.local-<project>. RD_LOCAL_STATE_DIR still overrides the directory.
#
# up.sh records the loopback port it published in the state directory's api-port file, so a client
# finds its deployment from the project alone. RD_LOCAL_API_PORT, when set, wins; otherwise the
# recorded port is used, and 18080 before any is recorded.
#
# Expects package_dir; sets local_project, state_dir and api_port.

local_project=${RD_LOCAL_PROJECT:-trade-rd-local}

if [[ ! $local_project =~ ^[a-z0-9][a-z0-9_-]*$ ]]; then
  echo "RD_LOCAL_PROJECT must be lower-case letters, digits, '-' and '_': $local_project" >&2
  exit 1
fi

if [ "$local_project" = trade-rd-local ]; then
  state_dir=${RD_LOCAL_STATE_DIR:-$package_dir/.local}
else
  state_dir=${RD_LOCAL_STATE_DIR:-$package_dir/.local-$local_project}
fi

if [ -n "${RD_LOCAL_API_PORT:-}" ]; then
  api_port=$RD_LOCAL_API_PORT
elif [ -f "$state_dir/api-port" ]; then
  api_port=$(cat "$state_dir/api-port")
else
  api_port=18080
fi
