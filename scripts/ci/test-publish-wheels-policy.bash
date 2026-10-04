#!/usr/bin/env bash
set -euo pipefail

# publish-wheels-policy.bash's only live consumer is security-audit.yml's `changes` job, which
# reads its output only to decide whether a `development`-mode push forces every audit job. The
# wheel/release pipeline that used to be its other consumer is gone; this is what is left of
# scripts/ci/test-publish-wheels.bash once the mode check it also covered is separated from the
# tests for everything that pipeline deleted.

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "${script_dir}/../.." && pwd)"

fail() {
  echo "::error::$1" >&2
  exit 1
}

policy() { bash "${repo_root}/scripts/ci/publish-wheels-policy.bash" "$@"; }

[[ "$(policy pull_request test-ci)" == "none" ]] ||
  fail "Pull requests must not force a development audit"
[[ "$(policy push develop)" == "development" ]] ||
  fail "A push to develop must force a development audit"
[[ "$(policy push test-ci)" == "none" ]] ||
  fail "A push to an unrelated branch must not force a development audit"
[[ "$(policy push nightly)" == "nightly" ]] ||
  fail "A push to nightly is its own, separate category"

echo "ok: publish-wheels-policy reports exactly the categories security-audit.yml's changes job reads"
