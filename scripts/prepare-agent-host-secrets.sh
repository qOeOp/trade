#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
secret_dir="${repo_root}/.secrets"
secret_file="${secret_dir}/agent-host.env"

mkdir -p "${secret_dir}"
chmod 700 "${secret_dir}"

if [[ -e "${secret_file}" ]]; then
  chmod 600 "${secret_file}"
  printf '%s\n' "agent Host secret file already exists"
  exit 0
fi

umask 077
gateway_token="$(openssl rand -hex 32)"
mcp_token="$(openssl rand -hex 32)"
{
  printf 'OPENCLAW_GATEWAY_TOKEN=%s\n' "${gateway_token}"
  printf 'TRADE_MCP_HTTP_TOKEN=%s\n' "${mcp_token}"
} > "${secret_file}"
chmod 600 "${secret_file}"
printf '%s\n' "created .secrets/agent-host.env"
