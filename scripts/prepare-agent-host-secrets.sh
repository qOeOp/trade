#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
secret_dir="${repo_root}/.secrets"
legacy_file="${secret_dir}/agent-host.env"
gateway_file="${secret_dir}/openclaw-gateway.env"
mcp_file="${secret_dir}/agent-mcp-http.env"
host_file="${secret_dir}/agent-host-http.env"

mkdir -p "${secret_dir}"
chmod 700 "${secret_dir}"

umask 077
touch "${legacy_file}"
chmod 600 "${legacy_file}"

created=0
prepare_scoped_token() {
  local name="$1"
  local target="$2"
  touch "${target}"
  chmod 600 "${target}"
  if grep -q "^${name}=" "${target}"; then
    return
  fi
  local value=""
  if grep -q "^${name}=" "${legacy_file}"; then
    value="$(sed -n "s/^${name}=//p" "${legacy_file}" | head -n 1)"
  fi
  if [[ -z "${value}" ]]; then
    value="$(openssl rand -hex 32)"
  fi
  printf '%s=%s\n' "${name}" "${value}" >> "${target}"
  created=$((created + 1))
}

prepare_scoped_token "OPENCLAW_GATEWAY_TOKEN" "${gateway_file}"
prepare_scoped_token "TRADE_MCP_HTTP_TOKEN" "${mcp_file}"
prepare_scoped_token "TRADE_AGENT_HOST_HTTP_TOKEN" "${host_file}"

if [[ "${created}" -eq 0 ]]; then
  printf '%s\n' "scoped Agent secret files already complete"
else
  printf '%s\n' "prepared ${created} scoped Agent secret file(s)"
fi
