#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
secret_dir="${repo_root}/.secrets"
secret_file="${secret_dir}/agent-host.env"

mkdir -p "${secret_dir}"
chmod 700 "${secret_dir}"

umask 077
touch "${secret_file}"
chmod 600 "${secret_file}"

added=0
ensure_token() {
  local name="$1"
  if grep -q "^${name}=" "${secret_file}"; then
    return
  fi
  printf '%s=%s\n' "${name}" "$(openssl rand -hex 32)" >> "${secret_file}"
  added=$((added + 1))
}

ensure_token "OPENCLAW_GATEWAY_TOKEN"
ensure_token "TRADE_MCP_HTTP_TOKEN"
ensure_token "TRADE_AGENT_HOST_HTTP_TOKEN"

if [[ "${added}" -eq 0 ]]; then
  printf '%s\n' "agent Host secret file already complete"
else
  printf '%s\n' "added ${added} missing Agent Host secret variable(s)"
fi
