#!/usr/bin/env bash
set -eu

check_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
# shellcheck source=product/rd-workbench/scripts/check/common.bash
. "$check_dir/common.bash"

# The consumer's configuration: the rd-owner-api service block, where the admission reads it. The
# administrator's one-shot services elsewhere in the file provision principals and pass their
# passwords, as every other provisioning service does; none of that reaches the consumer.
rd_owner_api_block=$(awk '/^  rd-owner-api:$/ { inside = 1; print; next } inside && /^  [a-z]/ { exit } inside' "$compose_file")
while IFS= read -r pin; do
  if ! printf '%s\n' "$rd_owner_api_block" | grep -Fq -- "$pin"; then
    echo "rd-owner-api does not carry: $pin" >&2
    exit 1
  fi
done << 'PINS'
DEPLOYMENT_STORE_ADMISSION_MODE: ${DEPLOYMENT_STORE_ADMISSION_MODE-disabled}
DEPLOYMENT_STORE_ENVIRONMENT_IDENTITY: ${DEPLOYMENT_STORE_ENVIRONMENT_IDENTITY:-}
DEPLOYMENT_STORE_DEPLOYMENT_IDENTITY: ${DEPLOYMENT_STORE_DEPLOYMENT_IDENTITY:-}
DEPLOYMENT_STORE_EXPECTED_HEAD_IDENTITY: ${DEPLOYMENT_STORE_EXPECTED_HEAD_IDENTITY:-}
DEPLOYMENT_STORE_ANTI_ROLLBACK_MODE: ${DEPLOYMENT_STORE_ANTI_ROLLBACK_MODE:-}
DEPLOYMENT_STORE_SIGNER_IDENTITY: ${DEPLOYMENT_STORE_SIGNER_IDENTITY:-}
DEPLOYMENT_STORE_SIGNER_PUBLIC_KEY_PATH: /run/deployment-store/signer-public-key.hex
DEPLOYMENT_STORE_LEASED_FILES_DIRECTORY: /run/deployment-store/leased
DEPLOYMENT_STORE_LEASE_PERIOD_MS: ${DEPLOYMENT_STORE_LEASE_PERIOD_MS:-}
DEPLOYMENT_STORE_POSTGRES_ROOT_CERTIFICATE_PATH: /run/deployment-store/postgres-root.crt
DEPLOYMENT_STORE_CUSTODIAN_CONNECTION_FILE: /run/deployment-store/custodian-connection
${DEPLOYMENT_STORE_FILES_DIRECTORY:-deployment-store-files}:/run/deployment-store:ro
PINS
test "$(printf '%s\n' "$rd_owner_api_block" | grep -Ec '^[[:space:]]+DEPLOYMENT_STORE_[A-Z_]+:')" -eq 11
grep -Fxq 'DEPLOYMENT_STORE_ADMISSION_MODE=disabled' "$env_example"
grep -Fxq 'DEPLOYMENT_STORE_ENVIRONMENT_IDENTITY=' "$env_example"
grep -Fxq 'DEPLOYMENT_STORE_DEPLOYMENT_IDENTITY=' "$env_example"
grep -Fxq 'DEPLOYMENT_STORE_EXPECTED_HEAD_IDENTITY=' "$env_example"
grep -Fxq 'DEPLOYMENT_STORE_ANTI_ROLLBACK_MODE=' "$env_example"
grep -Fxq 'DEPLOYMENT_STORE_SIGNER_IDENTITY=' "$env_example"
grep -Fxq 'DEPLOYMENT_STORE_LEASE_PERIOD_MS=' "$env_example"
grep -Fxq 'DEPLOYMENT_STORE_FILES_DIRECTORY=' "$env_example"
grep -Fxq 'DEPLOYMENT_STORE_ADMIN_DIRECTORY=' "$env_example"
test "$(grep -Ec '^DEPLOYMENT_STORE_[A-Z_]+=' "$env_example")" -eq 9
if printf '%s\n' "$rd_owner_api_block" | grep -Ei 'DEPLOYMENT_STORE_[A-Z_]*(DATABASE_URL|DSN|PASSWORD|SECRET|PRIVATE_KEY|CREDENTIAL)' ||
  grep -Ei 'DEPLOYMENT_STORE_[A-Z_]*(DATABASE_URL|DSN|PASSWORD|SECRET|PRIVATE_KEY|CREDENTIAL)' "$env_example"; then
  echo "store admission must not accept a raw DSN or secret environment value" >&2
  exit 1
fi
grep -Fq 'mode the three store identities may remain empty' "$readme"
grep -Fq 'mode fails closed during startup, naming the' "$readme"
grep -Fq 'SINGLE_TRUST_DOMAIN_NO_ROLLBACK_WITNESS' "$readme"
grep -Fq 'A raw DSN, password, secret, private key, or caller-authored' "$readme"
bootstrap_line=$(grep -nF 'bootstrap_deployment_store_admission().await?;' "$rd_owner_api" | cut -d: -f1)
listener_line=$(grep -n '^    let listener = TcpListener::bind' "$rd_owner_api" | cut -d: -f1)
[ "$bootstrap_line" -lt "$listener_line" ] || {
  echo "store admission must fail closed before rd-owner-api listens" >&2
  exit 1
}
# The production seam is composed from the deployment's configuration, and from nothing else.
grep -Fq 'composition::production_custodian(lookup)' "$store_admission"
grep -Fq 'admit_rd_owner_market_data_postgres_with(request, |name| std::env::var(name).ok())' "$store_admission"
# `grep -rE`, not `rg`: ripgrep is absent on the CI runner, and because this is a
# NEGATIVE assertion a missing command makes the condition false and the check pass
# silently. Verified equivalent here against a matching control pattern.
if grep -rnE 'vibe[_-]deployment[_-]store[_-]admission|MarketDataPitTerminalStorageEvidence|into_pit_terminal_snapshot_port|resolve_pit_terminal' \
  "$package_dir/../../crates/strategy_factory_rd_owner_api"; then
  echo "rd-owner-api must receive only the Market Data sealed Research PIT terminal resolver" >&2
  exit 1
fi
