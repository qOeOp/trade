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
  "$source_repo/.agents/skills/example/scripts" \
  "$source_repo/.github/workflows" \
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
printf 'console.log("ok")\n' > "$source_repo/.agents/skills/example/scripts/helper.ts"
printf 'pub fn example() {}\n' > "$source_repo/crates/example/src/lib.rs"
printf 'use pyo3::prelude::*;\n' > "$source_repo/crates/example/src/python/mod.rs"
printf '[package]\nname = "example"\nversion = "0.0.0"\n' > "$source_repo/Cargo.toml"
printf '# Design\n' > "$source_repo/notes/design.md"
printf 'plain notes\n' > "$source_repo/misc/notes.txt"
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
  codeql_javascript_impacted=false codeql_python_impacted=false
  codeql_rust_impacted=false
)
fail_closed=(
  run_tests=true run_rust_tests=true run_generated_drift=true
  run_full_pre_commit=true run_capnp_check=true
  codeql_javascript_impacted=true codeql_python_impacted=true
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
  "rm notes/design.md" "${fail_closed[@]}"
run_case prose_renamed \
  "git mv notes/design.md misc/design.md" "${fail_closed[@]}"
run_case cross_extension_renamed \
  "git mv python/example.py notes/example.md" "${fail_closed[@]}"
run_case unknown_added \
  "printf 'unknown\\n' > misc/example.bin" "${fail_closed[@]}"

run_case javascript_only \
  "printf 'console.log(\"changed\")\\n' >> .agents/skills/example/scripts/helper.ts" \
  run_tests=false run_rust_tests=false run_generated_drift=false \
  run_full_pre_commit=false run_capnp_check=false \
  codeql_javascript_impacted=true codeql_python_impacted=false \
  codeql_rust_impacted=false
run_case python_only \
  "printf 'print(\"changed\")\\n' >> python/example.py" \
  run_tests=true run_rust_tests=false run_generated_drift=false \
  run_full_pre_commit=false run_capnp_check=false \
  codeql_javascript_impacted=false codeql_python_impacted=true \
  codeql_rust_impacted=false
run_case python_manifest \
  "printf 'version = \"0.0.1\"\\n' >> python/pyproject.toml" \
  run_tests=true run_rust_tests=false run_generated_drift=false \
  run_full_pre_commit=false run_capnp_check=false \
  codeql_javascript_impacted=false codeql_python_impacted=true \
  codeql_rust_impacted=false
run_case python_generator \
  "printf 'print(\"generate\")\\n' > python/generate_stubs.py" \
  run_tests=true run_rust_tests=false run_generated_drift=true \
  run_full_pre_commit=false run_capnp_check=false \
  codeql_javascript_impacted=false codeql_python_impacted=true \
  codeql_rust_impacted=false
run_case rust_only \
  "printf 'pub fn changed() {}\\n' >> crates/example/src/lib.rs" \
  run_tests=true run_rust_tests=true run_generated_drift=false \
  run_full_pre_commit=true run_capnp_check=false \
  codeql_javascript_impacted=false codeql_python_impacted=false \
  codeql_rust_impacted=true
run_case rust_manifest \
  "printf '[workspace]\\n' >> Cargo.toml" \
  run_tests=true run_rust_tests=true run_generated_drift=false \
  run_full_pre_commit=true run_capnp_check=false \
  codeql_javascript_impacted=false codeql_python_impacted=false \
  codeql_rust_impacted=true
run_case mixed_javascript_python \
  "printf 'console.log(\"changed\")\\n' >> .agents/skills/example/scripts/helper.ts; printf 'print(\"changed\")\\n' >> python/example.py" \
  run_tests=true run_rust_tests=false run_generated_drift=false \
  run_full_pre_commit=false run_capnp_check=false \
  codeql_javascript_impacted=true codeql_python_impacted=true \
  codeql_rust_impacted=false
run_case shared_schema \
  "printf '# changed\\n' >> schema/example.capnp" \
  run_tests=true run_rust_tests=true run_generated_drift=true \
  run_full_pre_commit=true run_capnp_check=true \
  codeql_javascript_impacted=false codeql_python_impacted=true \
  codeql_rust_impacted=true
run_case cross_language_binding \
  "printf 'pub fn changed() {}\\n' >> crates/example/src/python/mod.rs" \
  run_tests=true run_rust_tests=true run_generated_drift=true \
  run_full_pre_commit=true run_capnp_check=true \
  codeql_javascript_impacted=false codeql_python_impacted=true \
  codeql_rust_impacted=true

run_case workflow_self_change \
  "printf '# changed\\n' >> .github/workflows/build.yml" "${fail_closed[@]}"
run_case planner_self_change \
  "printf '# changed\\n' >> scripts/ci/plan.sh" "${fail_closed[@]}"
run_case security_config_change \
  "printf '# changed\\n' >> .pre-commit-config.yaml" "${fail_closed[@]}"
run_case empty_change ":" "${fail_closed[@]}"

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
grep -Fq 'types: [opened, reopened, synchronize, ready_for_review]' \
  "$repo_root/.github/workflows/pr-fast.yml"
echo "ok: workflow Ready-entry and stable-failure invariants"

echo "All CI plan cases passed"
