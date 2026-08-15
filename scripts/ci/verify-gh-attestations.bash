#!/usr/bin/env bash
# Verify GitHub artifact or OCI attestations with bounded retry.
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/ci/release-verification-retry.bash disable=SC1091
source "${script_dir}/release-verification-retry.bash"

attempts="${GH_ATTESTATION_VERIFY_ATTEMPTS:-7}"
retry_delay_seconds="${GH_ATTESTATION_VERIFY_RETRY_DELAY_SECONDS:-15}"
max_retry_delay_seconds="${GH_ATTESTATION_VERIFY_MAX_RETRY_DELAY_SECONDS:-120}"
command_timeout_seconds="${GH_ATTESTATION_VERIFY_COMMAND_TIMEOUT_SECONDS:-0}"
github_server_url="${GITHUB_SERVER_URL:-https://github.com}"
attestation_identity="${ATTESTATION_IDENTITY:-}"
attestation_issuer="${ATTESTATION_ISSUER:-https://token.actions.githubusercontent.com}"
predicate_type="${ATTESTATION_PREDICATE_TYPE:-}"
source_digest="${ATTESTATION_SOURCE_DIGEST:-}"
source_ref="${ATTESTATION_SOURCE_REF:-}"
signer_digest="${ATTESTATION_SIGNER_DIGEST:-}"
deny_self_hosted_runners="${ATTESTATION_DENY_SELF_HOSTED_RUNNERS:-false}"

validate_positive_integer() {
  local name=$1
  local value=$2

  if ! [[ "$value" =~ ^[0-9]+$ ]] || [[ "$value" -lt 1 ]]; then
    echo "::error::${name} must be a positive integer."
    exit 1
  fi
}

validate_positive_integer GH_ATTESTATION_VERIFY_ATTEMPTS "$attempts"
validate_positive_integer GH_ATTESTATION_VERIFY_RETRY_DELAY_SECONDS "$retry_delay_seconds"
validate_positive_integer GH_ATTESTATION_VERIFY_MAX_RETRY_DELAY_SECONDS "$max_retry_delay_seconds"
if ! [[ "$command_timeout_seconds" =~ ^[0-9]+$ ]]; then
  echo "::error::GH_ATTESTATION_VERIFY_COMMAND_TIMEOUT_SECONDS must be a non-negative integer."
  exit 1
fi
for digest_name in source_digest signer_digest; do
  digest_value="${!digest_name}"
  if [[ -n "$digest_value" ]] &&
    ! [[ "$digest_value" =~ ^([0-9a-f]{40}|[0-9a-f]{64})$ ]]; then
    echo "::error::${digest_name} must be a lowercase 40- or 64-character hexadecimal digest."
    exit 1
  fi
done
if [[ -n "$source_ref" && "$source_ref" != refs/* ]]; then
  echo "::error::ATTESTATION_SOURCE_REF must be a full refs/* ref."
  exit 1
fi
if [[ "$deny_self_hosted_runners" != "true" && "$deny_self_hosted_runners" != "false" ]]; then
  echo "::error::ATTESTATION_DENY_SELF_HOSTED_RUNNERS must be true or false."
  exit 1
fi

if [[ "$#" -eq 0 ]]; then
  echo "::error::Usage: verify-gh-attestations.bash <subject> [<subject>...]"
  exit 1
fi
if [[ -z "${GITHUB_REPOSITORY:-}" ]]; then
  echo "::error::GITHUB_REPOSITORY not set."
  exit 1
fi
if [[ -z "${GITHUB_TOKEN:-}" && -z "${GH_TOKEN:-}" ]]; then
  echo "::error::GITHUB_TOKEN or GH_TOKEN not set."
  exit 1
fi
if [[ -z "$attestation_identity" && -n "${GITHUB_WORKFLOW_REF:-}" ]]; then
  attestation_identity="${github_server_url}/${GITHUB_WORKFLOW_REF}"
fi
if [[ -z "$attestation_identity" ]]; then
  echo "::error::ATTESTATION_IDENTITY or GITHUB_WORKFLOW_REF is required."
  exit 1
fi
if ! command -v gh > /dev/null; then
  echo "::error::gh not found."
  exit 1
fi
if ! gh attestation --help > /dev/null 2>&1; then
  echo "::error::This GitHub CLI version does not support 'gh attestation'."
  exit 1
fi

subjects=()
for subject in "$@"; do
  case "$subject" in
    oci://*) ;;
    *)
      if [[ ! -f "$subject" ]]; then
        echo "::error::Attestation subject not found: $subject"
        exit 1
      fi
      ;;
  esac
  subjects+=("$subject")
done

run_with_timeout() {
  if [[ "$command_timeout_seconds" -eq 0 ]] || ! command -v timeout > /dev/null; then
    "$@"
  else
    timeout "$command_timeout_seconds" "$@"
  fi
}

verify_subject() {
  local subject=$1
  local command=(
    gh attestation verify "$subject"
    --repo "$GITHUB_REPOSITORY"
    --cert-identity "$attestation_identity"
    --cert-oidc-issuer "$attestation_issuer"
  )

  if [[ -n "$predicate_type" ]]; then
    command+=(--predicate-type "$predicate_type")
  fi
  if [[ -n "$source_digest" ]]; then
    command+=(--source-digest "$source_digest")
  fi
  if [[ -n "$source_ref" ]]; then
    command+=(--source-ref "$source_ref")
  fi
  if [[ -n "$signer_digest" ]]; then
    command+=(--signer-digest "$signer_digest")
  fi
  if [[ "$deny_self_hosted_runners" == "true" ]]; then
    command+=(--deny-self-hosted-runners)
  fi

  run_release_verification_with_retry \
    "gh attestation verify ${subject}" \
    "$attempts" \
    "$retry_delay_seconds" \
    "$max_retry_delay_seconds" \
    run_with_timeout "${command[@]}"
  echo "Verified attestation for ${subject}."
}

for subject in "${subjects[@]}"; do
  verify_subject "$subject"
done
