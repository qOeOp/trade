#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
fixture_root="$(mktemp -d "${TMPDIR:-/tmp}/trade-ci-plan-tests.XXXXXX")"
source_repo="$fixture_root/source"
trap 'rm -rf "$fixture_root"' EXIT

git init -q --initial-branch=main "$source_repo"
git -C "$source_repo" config user.email ci-plan@example.invalid
git -C "$source_repo" config user.name ci-plan-test
mkdir -p \
  "$source_repo/.agents/skills/example/assets" \
  "$source_repo/.agents/skills/example/references/optimization" \
  "$source_repo/.agents/skills/example/references/verification" \
  "$source_repo/.agents/skills/example/scripts" \
  "$source_repo/.github/workflows" \
  "$source_repo/config" \
  "$source_repo/crates/example/src/python" \
  "$source_repo/misc" \
  "$source_repo/notes" \
  "$source_repo/python" \
  "$source_repo/schema" \
  "$source_repo/scripts/ci" \
  "$source_repo/tests/data"
cp "$repo_root/scripts/ci/plan.sh" "$source_repo/scripts/ci/plan.sh"
printf 'name: build\n' > "$source_repo/.github/workflows/build.yml"
printf 'repos: []\n' > "$source_repo/.pre-commit-config.yaml"
printf 'package main\n\nfunc main() {}\n' > "$source_repo/.agents/skills/example/scripts/helper.go"
printf '# Advisory\n' > "$source_repo/.agents/skills/example/assets/advisory.md"
printf '# Architecture\n' > "$source_repo/.agents/skills/example/references/optimization/architecture.md"
printf '# Handoff\n' > "$source_repo/.agents/skills/example/references/verification/handoff.md"
printf 'pub fn example() {}\n' > "$source_repo/crates/example/src/lib.rs"
printf 'use pyo3::prelude::*;\n' > "$source_repo/crates/example/src/python/mod.rs"
printf '[package]\nname = "nested"\nversion = "0.0.0"\n' > "$source_repo/crates/example/Cargo.toml"
printf '# Package\n' > "$source_repo/crates/example/README.md"
printf '[package]\nname = "example"\nversion = "0.0.0"\n' > "$source_repo/Cargo.toml"
printf '# Repository\n' > "$source_repo/README.md"
printf '# Design\n' > "$source_repo/notes/design.md"
printf 'binary\0payload\n' > "$source_repo/notes/binary.md"
printf '# Executable\n' > "$source_repo/notes/executable.md"
chmod +x "$source_repo/notes/executable.md"
ln -s design.md "$source_repo/notes/symlink.md"
printf '# Build configuration\n' > "$source_repo/config/README.md"
printf 'plain notes\n' > "$source_repo/misc/notes.txt"
printf 'opaque\n' > "$source_repo/misc/example.bin"
printf 'print("ok")\n' > "$source_repo/python/example.py"
printf '[project]\nname = "example"\n' > "$source_repo/python/pyproject.toml"
printf 'schema Example {}\n' > "$source_repo/schema/example.capnp"
printf 'fixture\n' > "$source_repo/tests/data/example.txt"
git -C "$source_repo" add .
git -C "$source_repo" commit -qm base

assert_output() {
  local output_file="$1" key="$2" expected="$3" actual
  actual="$(sed -n "s/^${key}=//p" "$output_file")"
  if [[ "$actual" != "$expected" ]]; then
    echo "Expected ${key}=${expected}, got ${actual:-<missing>}" >&2
    return 1
  fi
}

run_case() {
  local case_name="$1" mutation="$2" checkout output_file base_sha
  shift 2
  checkout="$fixture_root/case-${case_name}"
  git clone -q "$source_repo" "$checkout"
  git -C "$checkout" config user.email ci-plan@example.invalid
  git -C "$checkout" config user.name ci-plan-test
  (
    cd "$checkout"
    eval "$mutation"
    git add -A
    git commit -qm "$case_name" --allow-empty
    output_file="$(mktemp "${TMPDIR:-/tmp}/trade-ci-plan-output.XXXXXX")"
    base_sha="$(git rev-parse refs/remotes/origin/main)"
    EVENT_NAME=pull_request BASE_REF=main BASE_SHA="$base_sha" \
      GITHUB_OUTPUT="$output_file" bash scripts/ci/plan.sh > /dev/null
    while (($#)); do
      assert_output "$output_file" "${1%%=*}" "${1#*=}"
      shift
    done
    rm -f "$output_file"
  )
  rm -rf "$checkout"
  echo "ok: $case_name"
}

light=(
  run_tests=false run_rust_tests=false run_generated_drift=false
  run_full_pre_commit=false run_capnp_check=false
  codeql_go_impacted=false codeql_python_impacted=false
  codeql_rust_impacted=false
)
fail_closed=(
  run_tests=true run_rust_tests=true run_generated_drift=true
  run_full_pre_commit=true run_capnp_check=true
  codeql_go_impacted=true codeql_python_impacted=true
  codeql_rust_impacted=true
)

run_case arbitrary_markdown \
  "printf 'more\\n' >> notes/design.md" "${light[@]}"
run_case arbitrary_text \
  "printf 'more\\n' >> misc/notes.txt" "${light[@]}"
run_case nested_prose \
  "mkdir -p crates/example/guide; printf 'Guide\\n' > crates/example/guide/intro.rst" \
  "${light[@]}"
run_case protected_fixture_text \
  "printf 'more\\n' >> tests/data/example.txt" "${fail_closed[@]}"
run_case protected_workflow_prose \
  "printf '# Contract\\n' > .github/workflows/README.md" "${fail_closed[@]}"
run_case executable_prose \
  "chmod +x notes/design.md" "${fail_closed[@]}"
run_case symlink_prose \
  "rm notes/design.md; ln -s ../misc/notes.txt notes/design.md" "${fail_closed[@]}"
run_case prose_deleted \
  "rm notes/design.md" "${light[@]}"
run_case skill_prose_deletion \
  "rm .agents/skills/example/assets/advisory.md .agents/skills/example/references/optimization/architecture.md; printf 'more\n' >> .agents/skills/example/references/verification/handoff.md" \
  "${light[@]}"
run_case binary_prose_deleted \
  "rm notes/binary.md" "${fail_closed[@]}"
run_case executable_prose_deleted \
  "rm notes/executable.md" "${fail_closed[@]}"
run_case symlink_prose_deleted \
  "rm notes/symlink.md" "${fail_closed[@]}"
run_case protected_config_prose_deleted \
  "rm config/README.md" "${fail_closed[@]}"
run_case root_manifest_prose_deleted \
  "rm README.md" "${fail_closed[@]}"
run_case adjacent_manifest_prose_deleted \
  "rm crates/example/README.md" "${fail_closed[@]}"
run_case code_deleted \
  "rm python/example.py" "${fail_closed[@]}"
run_case unknown_deleted \
  "rm misc/example.bin" "${fail_closed[@]}"
run_case prose_renamed \
  "git mv notes/design.md misc/design.md" "${fail_closed[@]}"
run_case cross_extension_renamed \
  "git mv python/example.py notes/example.md" "${fail_closed[@]}"
run_case unknown_added \
  "printf 'unknown\\n' > misc/added.bin" "${fail_closed[@]}"

run_case go_only \
  "printf 'func changed() {}\\n' >> .agents/skills/example/scripts/helper.go" \
  run_tests=false run_rust_tests=false run_generated_drift=false \
  run_full_pre_commit=false run_capnp_check=false \
  codeql_go_impacted=true codeql_python_impacted=false \
  codeql_rust_impacted=false
run_case python_only \
  "printf 'print(\"changed\")\\n' >> python/example.py" \
  run_tests=true run_rust_tests=false run_generated_drift=false \
  run_full_pre_commit=false run_capnp_check=false \
  codeql_go_impacted=false codeql_python_impacted=true \
  codeql_rust_impacted=false
run_case python_manifest \
  "printf 'version = \"0.0.1\"\\n' >> python/pyproject.toml" \
  run_tests=true run_rust_tests=false run_generated_drift=false \
  run_full_pre_commit=false run_capnp_check=false \
  codeql_go_impacted=false codeql_python_impacted=true \
  codeql_rust_impacted=false
run_case python_generator \
  "printf 'print(\"generate\")\\n' > python/generate_stubs.py" \
  run_tests=true run_rust_tests=false run_generated_drift=true \
  run_full_pre_commit=false run_capnp_check=false \
  codeql_go_impacted=false codeql_python_impacted=true \
  codeql_rust_impacted=false
run_case rust_only \
  "printf 'pub fn changed() {}\\n' >> crates/example/src/lib.rs" \
  run_tests=true run_rust_tests=true run_generated_drift=false \
  run_full_pre_commit=true run_capnp_check=false \
  codeql_go_impacted=false codeql_python_impacted=false \
  codeql_rust_impacted=true
run_case rust_manifest \
  "printf '[workspace]\\n' >> Cargo.toml" \
  run_tests=true run_rust_tests=true run_generated_drift=false \
  run_full_pre_commit=true run_capnp_check=false \
  codeql_go_impacted=false codeql_python_impacted=false \
  codeql_rust_impacted=true
run_case mixed_go_python \
  "printf 'func changed() {}\\n' >> .agents/skills/example/scripts/helper.go; printf 'print(\"changed\")\\n' >> python/example.py" \
  run_tests=true run_rust_tests=false run_generated_drift=false \
  run_full_pre_commit=false run_capnp_check=false \
  codeql_go_impacted=true codeql_python_impacted=true \
  codeql_rust_impacted=false
run_case shared_schema \
  "printf '# changed\\n' >> schema/example.capnp" \
  run_tests=true run_rust_tests=true run_generated_drift=true \
  run_full_pre_commit=true run_capnp_check=true \
  codeql_go_impacted=false codeql_python_impacted=true \
  codeql_rust_impacted=true
run_case cross_language_binding \
  "printf 'pub fn changed() {}\\n' >> crates/example/src/python/mod.rs" \
  run_tests=true run_rust_tests=true run_generated_drift=true \
  run_full_pre_commit=true run_capnp_check=true \
  codeql_go_impacted=false codeql_python_impacted=true \
  codeql_rust_impacted=true

run_case workflow_self_change \
  "printf '# changed\\n' >> .github/workflows/build.yml" "${fail_closed[@]}"
run_case planner_self_change \
  "printf '# changed\\n' >> scripts/ci/plan.sh" "${fail_closed[@]}"
run_case security_config_change \
  "printf '# changed\\n' >> .pre-commit-config.yaml" "${fail_closed[@]}"
run_case empty_change ":" "${fail_closed[@]}"

invalid_base_checkout="$fixture_root/case-invalid-base"
git clone -q "$source_repo" "$invalid_base_checkout"
invalid_base_output="$(mktemp "${TMPDIR:-/tmp}/trade-ci-plan-output.XXXXXX")"
(
  cd "$invalid_base_checkout"
  EVENT_NAME=pull_request BASE_REF=main BASE_SHA=0000000000000000000000000000000000000000 \
    GITHUB_OUTPUT="$invalid_base_output" bash scripts/ci/plan.sh > /dev/null
)
for assertion in "${fail_closed[@]}"; do
  assert_output "$invalid_base_output" "${assertion%%=*}" "${assertion#*=}"
done
rm -f "$invalid_base_output"
rm -rf "$invalid_base_checkout"
echo "ok: invalid base history fails closed"

ready_entry() {
  local event_name="$1" action="$2" draft="$3"
  if [[ "$event_name" != pull_request ]]; then
    printf 'true\n'
    return
  fi
  case "${action}:${draft}" in
    ready_for_review:* | opened:false | reopened:false) printf 'true\n' ;;
    *) printf 'false\n' ;;
  esac
}

assert_ready_entry() {
  local case_name="$1" event_name="$2" action="$3" draft="$4" expected="$5" actual
  actual="$(ready_entry "$event_name" "$action" "$draft")"
  if [[ "$actual" != "$expected" ]]; then
    echo "Expected ${case_name} ready-entry=${expected}, got ${actual}" >&2
    exit 1
  fi
  echo "ok: ${case_name} ready-entry=${actual}"
}

assert_ready_entry draft_open pull_request opened true false
assert_ready_entry ready_open pull_request opened false true
assert_ready_entry ready_reopen pull_request reopened false true
assert_ready_entry ready_synchronize pull_request synchronize false false
assert_ready_entry draft_to_ready pull_request ready_for_review false true

for workflow in \
  "$repo_root/.github/workflows/build.yml" \
  "$repo_root/.github/workflows/codeql-analysis.yml"; do
  grep -Fq 'synchronize' "$workflow"
  grep -Fq 'ready_for_review:* | opened:false | reopened:false' "$workflow"
  grep -Fq "if: needs.ready-gate.outputs.run-full == 'true'" "$workflow"
  grep -Fq 'needs-full-ready: move the PR to Draft, then mark it Ready' "$workflow"
done
codeql_workflow="$repo_root/.github/workflows/codeql-analysis.yml"
for output in go python rust; do
  case "$output" in
    go) env_name=GO_IMPACTED ;;
    python) env_name=PYTHON_IMPACTED ;;
    rust) env_name=RUST_IMPACTED ;;
  esac
  grep -Fq "${env_name}: \${{ needs.plan.outputs.${output}-impacted }}" \
    "$codeql_workflow"
done
# Match literal shell expressions embedded in the workflow.
# shellcheck disable=SC2016
grep -Fq 'invalid CodeQL impact output: ${impact:-<missing>}' "$codeql_workflow"
# shellcheck disable=SC2016
grep -Fq '"$RUN_FULL" == true && "$PLAN_RESULT" == success && "$impacted" == true' \
  "$codeql_workflow"
# shellcheck disable=SC2016
grep -Fq 'false) test "$RUN_ANALYSIS" = false' "$codeql_workflow"
grep -Fq 'types: [opened, reopened, synchronize, ready_for_review]' \
  "$repo_root/.github/workflows/pr-fast.yml"
echo "ok: workflow Ready-entry, impacted CodeQL, and stable-failure invariants"

build_workflow="$repo_root/.github/workflows/build.yml"
common_setup="$repo_root/.github/actions/common-setup/action.yml"
disk_cleanup="$repo_root/scripts/ci/free-disk-space.sh"

grep -Fq 'minimum-free-space-gb:' "$common_setup"
# Match literal workflow/template expressions.
# shellcheck disable=SC2016
grep -Fq -- '--minimum-free-gb "$MINIMUM_FREE_SPACE_GB"' "$common_setup"
if grep -Fq 'runner.name' "$common_setup"; then
  echo "Disk cleanup must not depend on runner identity" >&2
  exit 1
fi
grep -Fq 'Skipping cleanup:' "$disk_cleanup"
grep -Fq 'Available disk remains below' "$disk_cleanup"

# Match literal GitHub expressions.
# shellcheck disable=SC2016
grep -Fq 'rust-cache-workspaces: . -> target/py${{ matrix.python-version }}' "$build_workflow"
# shellcheck disable=SC2016
grep -Fq 'rust-cache-save-if: ${{ github.event_name == '\''push'\'' }}' "$build_workflow"
grep -Fq 'rust-cache-workspace-crates: "true"' "$build_workflow"
grep -Fq 'rust-doctests-linux-x86:' "$build_workflow"
rust_tests_block="$(sed -n '/^  rust-tests-linux-x86:/,/^  quality:/p' "$build_workflow")"
[[ "$rust_tests_block" == *'minimum-free-space-gb: "110"'* ]]
# shellcheck disable=SC2016
grep -Fq 'RUST_DOCTESTS_RESULT: ${{ needs.rust-doctests-linux-x86.result }}' "$build_workflow"
# Match literal shell source.
# shellcheck disable=SC2016
grep -Fq 'test "$RUST_DOCTESTS_RESULT" = success' "$build_workflow"

generated_block="$(sed -n '/Restore generated stubs Rust cache/,/Upload wheel artifact/p' "$build_workflow")"
[[ "$generated_block" == *'workspaces: . -> target/py-stubs'* ]]
# shellcheck disable=SC2016
[[ "$generated_block" == *'generated-stubs-dev-py${{ matrix.python-version }}'* ]]
[[ "$generated_block" == *"runner.environment == 'github-hosted'"* ]]
[[ "$generated_block" == *"format('{0}/target/py-stubs', github.workspace)"* ]]
[[ "$generated_block" == *'make py-stubs'* ]]
if [[ "$generated_block" == *cache-hit* ]]; then
  echo "Generated drift must run on cache miss" >&2
  exit 1
fi

for job_range in \
  '/^  build:/,/^  rust-doctests-linux-x86:/' \
  '/^  rust-doctests-linux-x86:/,/^  rust-tests-linux-x86:/' \
  '/^  rust-tests-linux-x86:/,/^  quality:/'; do
  job_block="$(sed -n "$job_range p" "$build_workflow")"
  if [[ "$job_block" == *$'\n      - pre-commit\n'* ]]; then
    echo "Independent build/test jobs must not wait for pre-commit" >&2
    exit 1
  fi
done

doctest_block="$(sed -n '/^  rust-doctests-linux-x86:/,/^  rust-tests-linux-x86:/p' "$build_workflow")"
[[ "$doctest_block" == *'make cargo-test-doc'* ]]
if [[ "$doctest_block" == *'services:'* || "$doctest_block" == *'Install Vibe CLI'* ||
  "$doctest_block" == *'Init postgres schema'* || "$doctest_block" == *'common-test-data'* ||
  "$doctest_block" == *'make cargo-test NEXTEST'* ]]; then
  echo "Rust doctests must not consume services, CLI bootstrap, test data, or nextest" >&2
  exit 1
fi

for condition in \
  "if: inputs.build-type == 'test'" \
  "if: inputs.build-type == 'test' && runner.os != 'macOS'" \
  "if: inputs.build-type == 'test' && runner.os == 'macOS'"; do
  if [[ "$(grep -Fxc "      $condition" "$common_setup")" != 1 ]]; then
    echo "Expected exactly one cargo-nextest condition: $condition" >&2
    exit 1
  fi
done

workflow_job_block() {
  local workflow="$1" job="$2"
  awk -v header="  ${job}:" '
    $0 == header { selected = 1 }
    selected && $0 != header && /^  [[:alnum:]_-]+:$/ { exit }
    selected { print }
  ' "$workflow"
}

assert_nextest_role() {
  local workflow="$1" job="$2" expected="$3" block
  block="$(workflow_job_block "$workflow" "$job")"
  if [[ -z "$block" ]]; then
    echo "Missing workflow job: ${workflow}:${job}" >&2
    exit 1
  fi
  if [[ "$expected" == test ]]; then
    [[ "$block" == *'build-type: "test"'* ]]
  elif [[ "$block" == *'build-type: "test"'* ]]; then
    echo "Non-nextest job must not request cargo-nextest: ${workflow}:${job}" >&2
    exit 1
  fi
}

assert_nextest_role "$build_workflow" rust-tests-linux-x86 test
assert_nextest_role "$repo_root/.github/workflows/performance.yml" performance-benchmarks test
assert_nextest_role "$repo_root/.github/workflows/dst.yml" dst-smoke test
assert_nextest_role "$repo_root/.github/workflows/nightly-tests.yml" turmoil test
assert_nextest_role "$repo_root/.github/workflows/nightly-miri.yml" miri test

assert_nextest_role "$build_workflow" pre-commit release
assert_nextest_role "$build_workflow" build release
assert_nextest_role "$build_workflow" rust-doctests-linux-x86 release
assert_nextest_role "$build_workflow" release-cargo-publish-preflight release
assert_nextest_role "$repo_root/.github/workflows/nightly-tests.yml" standard-precision release
assert_nextest_role "$repo_root/.github/workflows/nightly-tests.yml" cargo-publish-plan release

[[ "$(workflow_job_block "$build_workflow" rust-tests-linux-x86)" == *'make cargo-test NEXTEST_PROFILE=ci'* ]]
[[ "$(workflow_job_block "$repo_root/.github/workflows/performance.yml" performance-benchmarks)" == *'make cargo-test NEXTEST_PROFILE=ci'* ]]
[[ "$(workflow_job_block "$repo_root/.github/workflows/dst.yml" dst-smoke)" == *'make cargo-test-sim NEXTEST_PROFILE=ci'* ]]
[[ "$(workflow_job_block "$repo_root/.github/workflows/nightly-tests.yml" turmoil)" == *'cargo nextest run'* ]]
[[ "$(workflow_job_block "$repo_root/.github/workflows/nightly-miri.yml" miri)" == *'make cargo-miri-'* ]]
echo "ok: adaptive cleanup, Rust cache, doctest isolation, and nextest consumer invariants"

echo "All CI plan cases passed"
