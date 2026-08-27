#!/usr/bin/env bash
set -eu

check_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
# shellcheck source=product/rd-workbench/scripts/check/common.bash
. "$check_dir/common.bash"

grep -Fq "DEPLOYMENT_STORE_ADMISSION_MODE: \${DEPLOYMENT_STORE_ADMISSION_MODE-disabled}" "$compose_file"
grep -Fq "DEPLOYMENT_STORE_ENVIRONMENT_IDENTITY: \${DEPLOYMENT_STORE_ENVIRONMENT_IDENTITY:-}" "$compose_file"
grep -Fq "DEPLOYMENT_STORE_DEPLOYMENT_IDENTITY: \${DEPLOYMENT_STORE_DEPLOYMENT_IDENTITY:-}" "$compose_file"
grep -Fq "DEPLOYMENT_STORE_EXPECTED_HEAD_IDENTITY: \${DEPLOYMENT_STORE_EXPECTED_HEAD_IDENTITY:-}" "$compose_file"
test "$(grep -Ec '^[[:space:]]+DEPLOYMENT_STORE_[A-Z_]+:' "$compose_file")" -eq 4
grep -Fxq 'DEPLOYMENT_STORE_ADMISSION_MODE=disabled' "$env_example"
grep -Fxq 'DEPLOYMENT_STORE_ENVIRONMENT_IDENTITY=' "$env_example"
grep -Fxq 'DEPLOYMENT_STORE_DEPLOYMENT_IDENTITY=' "$env_example"
grep -Fxq 'DEPLOYMENT_STORE_EXPECTED_HEAD_IDENTITY=' "$env_example"
test "$(grep -Ec '^DEPLOYMENT_STORE_[A-Z_]+=' "$env_example")" -eq 4
if grep -Ei 'DEPLOYMENT_STORE_[A-Z_]*(DATABASE_URL|DSN|PASSWORD|SECRET|PRIVATE_KEY|CREDENTIAL)' \
  "$env_example" "$compose_file"; then
  echo "store admission must not accept a raw DSN or secret environment value" >&2
  exit 1
fi
grep -Fq 'mode the three store identities may remain empty' "$readme"
grep -Fq 'only fail closed during startup.' "$readme"
grep -Fq 'It does not claim that a governed Market Data' "$readme"
grep -Fq 'A raw DSN, password, secret, private key, or caller-authored' "$readme"
bootstrap_line=$(grep -nF 'bootstrap_deployment_store_admission().await?;' "$rd_owner_api" | cut -d: -f1)
listener_line=$(grep -n '^    let listener = TcpListener::bind' "$rd_owner_api" | cut -d: -f1)
[ "$bootstrap_line" -lt "$listener_line" ] || {
  echo "store admission must fail closed before rd-owner-api listens" >&2
  exit 1
}
grep -Fq 'Arc::new(UnavailableCustodyStore)' "$store_admission"
grep -Fq 'Arc::new(UnavailableSignatureVerifier)' "$store_admission"
grep -Fq 'Arc::new(UnavailableAntiRollbackWitness)' "$store_admission"
grep -Fq 'Arc::new(UnavailableCredentialResolver)' "$store_admission"
grep -Fq 'Arc::new(UnavailableDirectMeasurer)' "$store_admission"
