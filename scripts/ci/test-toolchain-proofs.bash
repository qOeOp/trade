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
  'bounded_feature_program_lowerer_v1::tests::generated_candidate_is_a_real_strict_abi_three_module'
)

# Compiled only on the hosts the sandbox admits (macOS arm64, Linux arm64, Linux x86_64), which are
# the hosts every job here runs on; a host outside that set would select a test that does not exist
# there and fail on the empty filter rather than on the proof.
readonly admitted_host_wasm_proofs=(
  'develop_composer_v2_tests::real_v3_owner_build_reaches_composer_program_host_and_durable_abi3_artifact'
)

# Seals and reseals a caller-edited project through `docker buildx`. Its exemption named Docker as
# the obstacle; every job that provisions Docker already has buildx, and the proof takes sixteen
# seconds, so the obstacle was never real. The real one is the architecture: the sealed project's
# image is an arm64 image, an image fact rather than a host-profile one, so the proof holds only on
# arm64. On an x86_64 runner its toolchain stage cannot execute at all, measured as
#   #9 [toolchain 2/2] RUN rustup target add wasm32v1-none
#   #9 0.109 exec /bin/sh: exec format error
#   #9 ERROR: process "/bin/sh -c rustup target add wasm32v1-none" did not complete successfully: exit code: 255
# which is the host reporting that the image is for another machine, not the proof failing.
readonly docker_seal_proof='materially_different_external_project_is_artifact_only_and_exactly_recoverable'

selected_proofs=("${portable_wasm_proofs[@]}" "${admitted_host_wasm_proofs[@]}")
refused=()

# The wasm proofs run in the build `make cargo-test` has just made - its packages, features and
# Cargo profile, which the Makefile hands over as CARGO_TEST_SCOPE_FLAGS, CARGO_FEATURES and
# CARGO_CI_PROFILE - so nextest compiles nothing and runs only them. Built on their own (one package,
# one feature, the default `test` profile) they recompiled vibe-strategy-factory and its dependencies
# for about 40 s of proofs: 1m44s-2m47s of compile in `rust tests` (runs 36240226575, 36241288847).
for variable in CARGO_TEST_SCOPE_FLAGS CARGO_FEATURES CARGO_CI_PROFILE; do
  if [[ -z "${!variable:-}" ]]; then
    echo "ERROR: ${variable} is empty; run this through \`make cargo-test-toolchain-proofs\`." >&2
    exit 1
  fi
done
if [[ ",${CARGO_FEATURES}," != *",vibe-strategy-factory/${wasm_proof_features},"* ]]; then
  echo "ERROR: CARGO_FEATURES lacks vibe-strategy-factory/${wasm_proof_features}, which the proofs" >&2
  echo "       compile behind. Pass it in EXTRA_FEATURES, as build.yml's \`rust tests\` does." >&2
  exit 1
fi
# shellcheck disable=SC2206 # The Makefile's flag list is space-separated and holds no quoting.
graph=(${CARGO_TEST_SCOPE_FLAGS} --features "$CARGO_FEATURES" --cargo-profile "$CARGO_CI_PROFILE")
# The package and kind are binary-level predicates, so nextest lists only the one test binary that
# holds the proofs; without them `list` and `run` each enumerated all 160 binaries - two minutes
# of the step on run 36245175294 for 26 s of proofs.
filter=""
for proof in "${selected_proofs[@]}"; do
  filter+="${filter:+ | }test(=${proof})"
done
filter="package(vibe-strategy-factory) & kind(lib) & (${filter})"

# Selected is asserted, not assumed: a filter that matched fewer tests would run the rest and pass,
# in the same shape as all of them passing.
echo "Running ${#selected_proofs[@]} toolchain proof(s) against the tools they name..."
selected_count="$(
  cargo nextest list --locked "${graph[@]}" --run-ignored ignored-only -E "$filter" \
    --message-format json |
    python3 -c '
import json, sys
listing = json.load(sys.stdin)
print(sum(
    1
    for suite in listing["rust-suites"].values()
    for case in suite["testcases"].values()
    if case["filter-match"]["status"] == "matches"
))
'
)"
if [[ "$selected_count" -ne "${#selected_proofs[@]}" ]]; then
  echo "ERROR: the proof filter selects ${selected_count} test(s), not ${#selected_proofs[@]}:" >&2
  printf '  %s\n' "${selected_proofs[@]}" >&2
  exit 1
fi

# Every proof reports, whatever its neighbours did: a proof nobody hears from is the thing this
# script exists to prevent. `--no-tests=fail` states the property rather than inheriting a default.
if ! cargo nextest run --locked "${graph[@]}" \
  --profile "$nextest_profile" \
  --run-ignored ignored-only \
  --no-tests=fail \
  --no-fail-fast \
  -E "$filter"; then
  refused+=("the shared-build wasm proofs (nextest names each failure above)")
fi

# The record, when asked for: exactly these proofs, each passed, by name.
if [[ -n "${TOOLCHAIN_PROOFS_JUNIT:-}" ]]; then
  # nextest's store directory is <workspace>/target/nextest whatever CARGO_TARGET_DIR says.
  junit="target/nextest/${nextest_profile}/junit.xml"
  mkdir -p "$(dirname "$TOOLCHAIN_PROOFS_JUNIT")"
  cp -- "$junit" "$TOOLCHAIN_PROOFS_JUNIT"
  python3 - "$TOOLCHAIN_PROOFS_JUNIT" "${selected_proofs[@]}" << 'RECORD'
import sys
import xml.etree.ElementTree as ElementTree

cases = {
    case.get("name"): case
    for case in ElementTree.parse(sys.argv[1]).getroot().iter("testcase")
}
expected = set(sys.argv[2:])
missing = sorted(expected - set(cases))
extra = sorted(set(cases) - expected)
failed = sorted(
    name for name in expected & set(cases) if cases[name].find("failure") is not None
    or cases[name].find("error") is not None or cases[name].find("skipped") is not None
)
if missing or extra or failed:
    print(f"ERROR: the proof record is not these {len(expected)} proofs, each passed:", file=sys.stderr)
    for label, names in (("missing", missing), ("unexpected", extra), ("not passed", failed)):
        for name in names:
            print(f"  {label}: {name}", file=sys.stderr)
    sys.exit(1)
print(f"Recorded {len(expected)} toolchain proof(s), each passed, in {sys.argv[1]}")
RECORD
fi

if [[ "$(uname -m)" == "arm64" || "$(uname -m)" == "aarch64" ]]; then
  echo "--- $docker_seal_proof"
  if ! cargo nextest run \
    --locked \
    --package vibe-strategy-factory \
    --test product_skeleton \
    --profile "$nextest_profile" \
    --run-ignored ignored-only \
    --no-tests=fail \
    --fail-fast \
    -E "test(=${docker_seal_proof})"; then
    refused+=("$docker_seal_proof")
  fi
else
  echo "Host is $(uname -m): skipping the Docker seal proof, whose sealed image is arm64 and"
  echo "cannot execute its toolchain stage here."
fi

if [ "${#refused[@]}" -gt 0 ]; then
  echo "ERROR: ${#refused[@]} toolchain proof(s) refused:" >&2
  printf '  %s\n' "${refused[@]}" >&2
  exit 1
fi

echo "Every selected toolchain proof ran against the real tool it names"
