#!/usr/bin/env bash

# Run the Owner proofs that need a real tool and no database.
#
# These proofs lower a bounded program to first-party source, invoke the toolchain `rust-toolchain.toml`
# pins, and assert the result is a real strict-ABI-3 module rather than a shape. They are `#[ignore]`
# because they cost a compiler run, and until this script existed nothing anywhere selected them: the
# custody chains were the only jobs that run ignored tests, and their exemption recorded - wrongly -
# that no job had both a database and the toolchain. These proofs need no database at all, and
# `targets = ["wasm32v1-none"]` in `rust-toolchain.toml` means every job `common-setup` provisions
# already has the target.
#
# Each proof is selected on its own so a renamed or deleted test cannot be absorbed by the others.
# `cargo nextest` exits 4 on an empty filter, so a name that stops matching fails here rather than
# reporting a green run of nothing.

set -euo pipefail

script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repository_root="$(cd "${script_directory}/../.." && pwd)"
cd "$repository_root"

readonly nextest_profile="${NEXTEST_PROFILE:-default}"
readonly wasm_proof_features='sealed-develop-composer-acceptance'

# Proofs that hold on every host the workspace builds for. Both drive the toolchain directly, so
# they need the pinned target and nothing else.
#
# `two_lowerings_two_builds_and_strict_replay_mint_one_v3_identity` is deliberately absent. It
# builds through `develop_plugin_build_v2_sandbox`, which verifies the frozen Linux target sysroot,
# and `docs/owners/rd.md` holds that freeze against the bytes every current host carries until a
# fresh hosted A0 readback. Selecting it here would add a red check that reports that one fact a
# second time.
readonly portable_wasm_proofs=(
  'bounded_feature_program_lowerer_v1::tests::every_executable_operation_builds_and_runs_as_strict_abi_three_wasm'
)

# Compiled only on aarch64, so an x86_64 job would select a test that does not exist there and fail
# on the empty filter rather than on the proof.
readonly aarch64_wasm_proofs=(
  'develop_composer_v2_tests::real_v3_owner_build_reaches_composer_program_host_and_durable_abi3_artifact'
)

# Seals and reseals a caller-edited project through `docker buildx`. Its exemption named Docker as
# the obstacle; every job that provisions Docker already has buildx, and the proof takes sixteen
# seconds, so the obstacle was never real.
readonly docker_seal_proof='materially_different_external_project_is_artifact_only_and_exactly_recoverable'

selected_proofs=("${portable_wasm_proofs[@]}")
if [[ "$(uname -m)" == "arm64" || "$(uname -m)" == "aarch64" ]]; then
  selected_proofs+=("${aarch64_wasm_proofs[@]}")
else
  echo "Host is $(uname -m): skipping the aarch64-only Composer build proof."
fi

echo "Running ${#selected_proofs[@]} wasm toolchain proof(s) under the pinned target..."

for proof in "${selected_proofs[@]}"; do
  echo "--- $proof"
  cargo nextest run \
    --locked \
    --package vibe-strategy-factory \
    --lib \
    --features "$wasm_proof_features" \
    --profile "$nextest_profile" \
    --run-ignored ignored-only \
    --fail-fast \
    -E "test(=${proof})"
done

echo "--- $docker_seal_proof"
cargo nextest run \
  --locked \
  --package vibe-strategy-factory \
  --test product_skeleton \
  --profile "$nextest_profile" \
  --run-ignored ignored-only \
  --fail-fast \
  -E "test(=${docker_seal_proof})"

echo "Every selected toolchain proof ran against the real tool it names"
