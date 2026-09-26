#!/usr/bin/env bash
set -Eeuo pipefail

# Everything here works on repositories of its own (fixtures, a temporary bare repository), and an
# inherited GIT_DIR or GIT_INDEX_FILE - a git hook, `git rebase --exec` - would point those git calls at
# the repository that called this instead: `git init` re-initialises it, `read-tree` empties its
# index. So no GIT_* variable is inherited. (A hook's entry must not do this: .pre-commit-config.yaml.)
while IFS='=' read -r name _; do
  case "$name" in
    GIT_*) unset "$name" ;;
  esac
done < <(env)

repo_root="$(git rev-parse --show-toplevel)"
fixture_root="$(mktemp -d "${TMPDIR:-/tmp}/trade-ci-plan-tests.XXXXXX")"
source_repo="$fixture_root/source"
trap 'rm -rf "$fixture_root"' EXIT
# Most checks below are a bare `grep -Fq` or `[[ ]]`. Under `set -e` a miss ends this script, and
# neither form prints anything, so a red arrives as an exit code plus whichever progress line it
# stopped after - which narrows the check to a section, not to a line. This names it.
# `-E` on the `set` line above is what also reaches the checks that sit inside a function: without
# it a failure in a function body fires no trap at all. A function called as `if ! func` still
# reports nothing, because the ERR trap follows the same suppression `set -e` does in a condition.
trap 'echo "test-plan.sh:${LINENO}: this check failed: ${BASH_COMMAND}" >&2' ERR

git init -q --initial-branch=main "$source_repo"
git -C "$source_repo" config user.email ci-plan@example.invalid
git -C "$source_repo" config user.name ci-plan-test
mkdir -p \
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
printf 'pub fn example() {}\n' > "$source_repo/crates/example/src/lib.rs"
printf 'use pyo3::prelude::*;\n' > "$source_repo/crates/example/src/python/mod.rs"
printf '[package]\nname = "nested"\nversion = "0.0.0"\n' > "$source_repo/crates/example/Cargo.toml"
printf '# Package\n' > "$source_repo/crates/example/README.md"
printf '[package]\nname = "example"\nversion = "0.0.0"\n' > "$source_repo/Cargo.toml"
printf '{"schema_version":2}\n' > "$source_repo/codex-skills.lock.json"
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

run_push_case() {
  local case_name="$1" mutation="$2" ref_name="$3" before_kind="$4" after_kind="$5"
  local checkout output_file base_sha before_sha after_sha
  shift 5
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
    before_sha="$base_sha"
    after_sha="$(git rev-parse HEAD)"
    case "$before_kind" in
      exact) ;;
      zero) before_sha=0000000000000000000000000000000000000000 ;;
      missing) before_sha= ;;
      *)
        echo "Unknown before kind: $before_kind" >&2
        exit 1
        ;;
    esac
    case "$after_kind" in
      exact) ;;
      base) after_sha="$base_sha" ;;
      missing) after_sha= ;;
      *)
        echo "Unknown after kind: $after_kind" >&2
        exit 1
        ;;
    esac
    EVENT_NAME=push REF_NAME="$ref_name" BEFORE_SHA="$before_sha" AFTER_SHA="$after_sha" \
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

run_inverse_mode_push_case() {
  local checkout output_file before_sha after_sha
  checkout="$fixture_root/case-pin-inverse-mode-main-push"
  git clone -q "$source_repo" "$checkout"
  git -C "$checkout" config user.email ci-plan@example.invalid
  git -C "$checkout" config user.name ci-plan-test
  (
    cd "$checkout"
    chmod +x codex-skills.lock.json
    git add codex-skills.lock.json
    git commit -qm pin-inverse-mode-before
    before_sha="$(git rev-parse HEAD)"
    chmod -x codex-skills.lock.json
    printf '{"schema_version":2,"commit":"changed"}\n' > codex-skills.lock.json
    git add codex-skills.lock.json
    git commit -qm pin-inverse-mode-after
    after_sha="$(git rev-parse HEAD)"
    output_file="$(mktemp "${TMPDIR:-/tmp}/trade-ci-plan-output.XXXXXX")"
    EVENT_NAME=push REF_NAME=main BEFORE_SHA="$before_sha" AFTER_SHA="$after_sha" \
      GITHUB_OUTPUT="$output_file" bash scripts/ci/plan.sh > /dev/null
    for assertion in "${fail_closed[@]}"; do
      assert_output "$output_file" "${assertion%%=*}" "${assertion#*=}"
    done
    rm -f "$output_file"
  )
  rm -rf "$checkout"
  echo "ok: pin_inverse_mode_main_push"
}

light=(
  run_tests=false run_rust_tests=false run_generated_drift=false
  run_full_pre_commit=false run_capnp_check=false
  codeql_python_impacted=false codeql_rust_impacted=false
)
fail_closed=(
  run_tests=true run_rust_tests=true run_generated_drift=true
  run_full_pre_commit=true run_capnp_check=true
  codeql_python_impacted=true codeql_rust_impacted=true
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

run_case python_only \
  "printf 'print(\"changed\")\\n' >> python/example.py" \
  run_tests=true run_rust_tests=false run_generated_drift=false \
  run_full_pre_commit=false run_capnp_check=false \
  codeql_python_impacted=true codeql_rust_impacted=false
run_case python_manifest \
  "printf 'version = \"0.0.1\"\\n' >> python/pyproject.toml" \
  run_tests=true run_rust_tests=false run_generated_drift=false \
  run_full_pre_commit=false run_capnp_check=false \
  codeql_python_impacted=true codeql_rust_impacted=false
run_case python_generator \
  "printf 'print(\"generate\")\\n' > python/generate_stubs.py" \
  run_tests=true run_rust_tests=false run_generated_drift=true \
  run_full_pre_commit=false run_capnp_check=false \
  codeql_python_impacted=true codeql_rust_impacted=false
run_case rust_only \
  "printf 'pub fn changed() {}\\n' >> crates/example/src/lib.rs" \
  run_tests=true run_rust_tests=true run_generated_drift=false \
  run_full_pre_commit=true run_capnp_check=false \
  codeql_python_impacted=false codeql_rust_impacted=true
run_case rust_manifest \
  "printf '[workspace]\\n' >> Cargo.toml" \
  run_tests=true run_rust_tests=true run_generated_drift=false \
  run_full_pre_commit=true run_capnp_check=false \
  codeql_python_impacted=false codeql_rust_impacted=true
run_case shared_schema \
  "printf '# changed\\n' >> schema/example.capnp" \
  run_tests=true run_rust_tests=true run_generated_drift=true \
  run_full_pre_commit=true run_capnp_check=true \
  codeql_python_impacted=true codeql_rust_impacted=true
run_case cross_language_binding \
  "printf 'pub fn changed() {}\\n' >> crates/example/src/python/mod.rs" \
  run_tests=true run_rust_tests=true run_generated_drift=true \
  run_full_pre_commit=true run_capnp_check=true \
  codeql_python_impacted=true codeql_rust_impacted=true

run_case workflow_self_change \
  "printf '# changed\\n' >> .github/workflows/build.yml" "${fail_closed[@]}"
run_case planner_self_change \
  "printf '# changed\\n' >> scripts/ci/plan.sh" "${fail_closed[@]}"
run_case security_config_change \
  "printf '# changed\\n' >> .pre-commit-config.yaml" "${fail_closed[@]}"
run_case empty_change ":" "${fail_closed[@]}"

run_push_case pin_only_main_push \
  "printf '{\"schema_version\":2,\"commit\":\"changed\"}\\n' > codex-skills.lock.json" \
  main exact exact "${light[@]}"
run_push_case pin_plus_python_main_push \
  "printf '{\"schema_version\":2,\"commit\":\"changed\"}\\n' > codex-skills.lock.json; printf 'print(\"changed\")\\n' >> python/example.py" \
  main exact exact "${fail_closed[@]}"
run_push_case pin_deleted_main_push \
  "rm codex-skills.lock.json" main exact exact "${fail_closed[@]}"
run_push_case pin_renamed_main_push \
  "git mv codex-skills.lock.json misc/codex-skills.lock.json" \
  main exact exact "${fail_closed[@]}"
run_push_case executable_pin_main_push \
  "chmod +x codex-skills.lock.json" main exact exact "${fail_closed[@]}"
run_inverse_mode_push_case
run_push_case pin_only_non_main_push \
  "printf '{\"schema_version\":2,\"commit\":\"changed\"}\\n' > codex-skills.lock.json" \
  nightly exact exact "${fail_closed[@]}"
run_push_case pin_only_zero_base_push \
  "printf '{\"schema_version\":2,\"commit\":\"changed\"}\\n' > codex-skills.lock.json" \
  main zero exact "${fail_closed[@]}"
run_push_case pin_only_mismatched_head_push \
  "printf '{\"schema_version\":2,\"commit\":\"changed\"}\\n' > codex-skills.lock.json" \
  main exact base "${fail_closed[@]}"

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

# The heavy scanners stay paused on pull requests; only `build` gates them.
for workflow in \
  "$repo_root/.github/workflows/codeql-analysis.yml" \
  "$repo_root/.github/workflows/security-audit.yml"; do
  if grep -Eq '^[[:space:]]+pull_request:' "$workflow"; then
    echo "PR CI must remain paused in $workflow" >&2
    exit 1
  fi
done
test ! -e "$repo_root/.github/workflows/pr-fast.yml"
build_triggers="$(sed -n '/^on:/,/^concurrency:/p' "$repo_root/.github/workflows/build.yml")"
for branch in test-ci test-pre-commit nightly master; do
  if [[ "$build_triggers" != *"- $branch"* ]]; then
    echo "build.yml push trigger must keep $branch" >&2
    exit 1
  fi
done
# `main` is verified on a schedule, not on push. Every push to `main` shared one concurrency group
# with `cancel-in-progress: true`, so each merge killed the run before it: 53 of the 60 `main`
# builds in the twenty hours to 2026-09-20T23:34Z were cancelled for 6 verdicts. Re-adding `main`
# here restores that, and it does so silently - the runs still appear, they just stop finishing.
# Comments are stripped: this must key on the YAML, not on prose that happens to name a branch.
push_branches="$(sed -n '/^  push:/,/^  [a-z_]*:/p' <<< "$build_triggers" | grep -v '^[[:space:]]*#')"
if [[ "$push_branches" == *"- main"* ]]; then
  echo "build.yml must not build main on push: merges cancel each other, so the tip goes" >&2
  echo "unverified. main is verified by the schedule trigger instead." >&2
  exit 1
fi
if [[ "$build_triggers" != *"schedule:"* ]] || [[ "$build_triggers" != *"cron:"* ]]; then
  echo "build.yml must keep the schedule trigger: it is the only thing that verifies main" >&2
  exit 1
fi

# `build` gates pull requests, but only on the events `ready-gate` can answer `run-full` for.
# Admitting `synchronize` here would fail every push instead of validating it.
if [[ "$build_triggers" != *"pull_request:"* ]]; then
  echo "build.yml must gate pull requests" >&2
  exit 1
fi
for pr_type in opened reopened ready_for_review; do
  if [[ "$build_triggers" != *"- $pr_type"* ]]; then
    echo "build.yml pull_request trigger must admit $pr_type" >&2
    exit 1
  fi
done
if [[ "$build_triggers" == *"- synchronize"* ]]; then
  echo "build.yml must not admit synchronize: ready-gate cannot answer it" >&2
  exit 1
fi
# A merge queue drops an entry whose required check never reports, so admitting `merge_group` is
# what keeps a configured queue able to merge anything at all.
if [[ "$build_triggers" != *"merge_group:"* ]] ||
  [[ "$build_triggers" != *"- checks_requested"* ]]; then
  echo "build.yml must answer merge_group: a queue drops entries it gets no verdict for" >&2
  exit 1
fi
# `workflow_dispatch` is how `main` gets a same-tree verdict between scheduled runs, so it has to be
# routed exactly like `schedule`: `run-full=true` from ready-gate and full validation from plan.sh.
# Both are run here with each event rather than read, so a case that sends dispatch to a skip - in
# the gate's shell or in plan.sh - turns this red.
if [[ "$build_triggers" != *"workflow_dispatch:"* ]]; then
  echo "build.yml must keep workflow_dispatch: it is the on-demand verdict for main" >&2
  exit 1
fi
ready_gate_script="$(awk '
  /^  ready-gate:/ { in_job = 1; next }
  in_job && /^  [a-z]/ { exit }
  in_job && /^        run: [|]$/ { in_run = 1; next }
  in_run && /^$/ { print ""; next }
  in_run && /^          / { sub(/^          /, ""); print; next }
  in_run { exit }
' "$repo_root/.github/workflows/build.yml")"
if [[ "$ready_gate_script" != *'run-full='* ]]; then
  echo "could not read ready-gate's classification script from build.yml" >&2
  exit 1
fi
for event in schedule workflow_dispatch; do
  gate_output="$(mktemp "${TMPDIR:-/tmp}/trade-ci-gate-output.XXXXXX")"
  EVENT_NAME="$event" ACTION='' DRAFT='' GITHUB_OUTPUT="$gate_output" \
    bash -c "$ready_gate_script" > /dev/null
  if [[ "$(cat "$gate_output")" != 'run-full=true' ]]; then
    echo "ready-gate must answer run-full=true for $event, got: $(cat "$gate_output")" >&2
    exit 1
  fi
  rm -f "$gate_output"
  plan_output="$(mktemp "${TMPDIR:-/tmp}/trade-ci-plan-output.XXXXXX")"
  (cd "$source_repo" && EVENT_NAME="$event" GITHUB_OUTPUT="$plan_output" bash scripts/ci/plan.sh > /dev/null)
  for assertion in "${fail_closed[@]}"; do
    assert_output "$plan_output" "${assertion%%=*}" "${assertion#*=}"
  done
  rm -f "$plan_output"
done
echo "ok: workflow_dispatch is routed like schedule, to full validation"
ready_gate_cases="$(sed -n '/ready-gate:/,/^  plan:/p' "$repo_root/.github/workflows/build.yml")"
for pr_case in 'ready_for_review:' 'opened:false' 'reopened:false'; do
  if [[ "$ready_gate_cases" != *"$pr_case"* ]]; then
    echo "ready-gate must still admit $pr_case" >&2
    exit 1
  fi
done
# CodeQL runs once a day off-peak and on demand, never per push: each Rust scan holds a runner for
# about 1.5 hours under the account's 20-job cap, and a push trigger ran 12 of them on 2026-09-24
# while pull requests queued. Comments are stripped so this keys on the YAML.
codeql_triggers="$(sed -n '/^on:/,/^jobs:/p' "$repo_root/.github/workflows/codeql-analysis.yml" |
  grep -v '^ *#')"
[[ "$codeql_triggers" == *'workflow_dispatch:'* ]]
[[ "$codeql_triggers" == *'schedule:'* ]]
if [[ "$codeql_triggers" == *'push:'* ]]; then
  echo "codeql-analysis.yml must not run on push; it is scheduled once a day, off-peak." >&2
  exit 1
fi
# Match literal GitHub expressions and shell source.
# shellcheck disable=SC2016
grep -Fq 'AFTER_SHA: ${{ github.event.after }}' "$repo_root/.github/workflows/build.yml"
# shellcheck disable=SC2016
grep -Fq 'AFTER_SHA: ${{ github.event.after }}' "$repo_root/.github/workflows/codeql-analysis.yml"
# shellcheck disable=SC2016
grep -Fq 'PYTHON_IMPACTED: ${{ needs.plan.outputs.python-impacted }}' \
  "$repo_root/.github/workflows/codeql-analysis.yml"
# shellcheck disable=SC2016
grep -Fq 'RUST_IMPACTED: ${{ needs.plan.outputs.rust-impacted }}' \
  "$repo_root/.github/workflows/codeql-analysis.yml"
# shellcheck disable=SC2016
grep -Fq 'test "$RUN_ANALYSIS" = "$expected"' \
  "$repo_root/.github/workflows/codeql-analysis.yml"
security_triggers="$(sed -n '/^on:/,/^jobs:/p' "$repo_root/.github/workflows/security-audit.yml")"
[[ "$security_triggers" == *'branches: [main, develop, master, test-ci, test-security]'* ]]
[[ "$security_triggers" == *'schedule:'* ]]
[[ "$security_triggers" == *'workflow_dispatch:'* ]]
grep -Fq 'pull_request_target:' "$repo_root/.github/workflows/pr-title.yml"
echo "ok: build gates ready pull requests; heavy scanners paused; title validation retained"

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
# `main` is built by the schedule and, on demand, by a dispatch on main, never by a push, so every
# cache-saving job has to save on both: a job that gates on `push` alone simply stops populating the
# cache that pull requests restore from, and nothing goes red when it does. The schedule has missed
# slots (2026-09-24: 08:17 and 16:17 never ran, 12:17 ran 75 minutes late), and a cache key change
# stays cold until main saves again, so the dispatch has to save too. One definition,
# SAVE_BUILD_CACHES, and every event-gated save uses it - written as a universal, because the way
# this decays is a new job with its own gate.
save_gates="$(grep -E '(^|[[:space:]])(rust-cache-)?save-if:' "$build_workflow" | grep -vF '"false"' || true)"
save_gate_total="$(printf '%s\n' "$save_gates" | grep -c 'save-if:' || true)"
# Match a literal workflow expression.
# shellcheck disable=SC2016
save_gate_shared="$(printf '%s\n' "$save_gates" | grep -cF 'save-if: ${{ env.SAVE_BUILD_CACHES }}' || true)"
if [[ "$save_gate_total" != "$save_gate_shared" ]]; then
  echo "build.yml: $((save_gate_total - save_gate_shared)) cache-saving step(s) gate on their own condition" >&2
  echo "instead of env.SAVE_BUILD_CACHES:" >&2
  # Match a literal workflow expression.
  # shellcheck disable=SC2016
  printf '%s\n' "$save_gates" | grep -vF 'save-if: ${{ env.SAVE_BUILD_CACHES }}' >&2
  exit 1
fi
if [[ "$save_gate_total" -ne 3 ]]; then
  echo "build.yml has $save_gate_total cache-saving steps, expected 3." >&2
  echo "A removed entry stops saving a cache; a new one must use env.SAVE_BUILD_CACHES." >&2
  exit 1
fi
save_definition="$(sed -n '/^  SAVE_BUILD_CACHES: >-$/,/}}$/p' "$build_workflow")"
[[ "$save_definition" == *"github.event_name == 'schedule'"* ]]
[[ "$save_definition" == *"github.event_name == 'workflow_dispatch' && github.ref_name == 'main'"* ]]

# `main` reaches this workflow as a `schedule` event, never as a push, so anything that selects a
# Cargo profile or target directory by asking whether the event is a push silently picks the other
# branch on every scheduled run of `main`. That changes the profile and the cache key without
# changing a single job's name or status, which is the kind of drift nothing here would report.
# Select on the ref instead, the way `rust tests` already does.
profile_by_event="$(awk '
  /CARGO_CI_PROFILE:|CARGO_TARGET_DIR:/ { inside = 1; start = FNR; next }
  inside && /event_name == .push./ { print FILENAME ":" FNR ": " $0; inside = 0; next }
  inside && /^      [A-Z_]+:|^    steps:/ { inside = 0 }
' "$build_workflow")"
if [[ -n "$profile_by_event" ]]; then
  echo "build.yml selects a Cargo profile or target directory by event_name == 'push':" >&2
  echo "$profile_by_event" >&2
  echo "main is built by the schedule trigger, so that branch is never taken for main and the" >&2
  echo "job silently switches profile. Select on github.ref_name instead." >&2
  exit 1
fi

# A pull request builds one interpreter, everything else builds all three. The version kept on a
# pull request is not interchangeable: two steps gate on `matrix.python-version == '3.13'`, one of
# them the generated-stub drift check, so keeping a different version would stop that check running
# on pull requests without failing anything - a gate that goes quiet rather than red.
py_matrix="$(sed -n '/^        python-version: >-/,/}}/p' "$build_workflow")"
if [[ -z "$py_matrix" ]]; then
  echo "build.yml no longer selects the Python matrix by event. A pull request that builds all" >&2
  echo "three interpreters spends 3 of its 11 jobs on them, and the account allows 20 jobs, so" >&2
  echo "two pull requests then saturate it." >&2
  exit 1
fi
if [[ "$py_matrix" != *"github.event_name == 'pull_request'"* ]]; then
  echo "The Python matrix must branch on github.event_name == 'pull_request'." >&2
  exit 1
fi
if [[ "$py_matrix" != *'fromJSON('"'"'["3.13"]'"'"')'* ]]; then
  echo "A pull request must build exactly Python 3.13 - the version the drift check gates on." >&2
  echo "$py_matrix" >&2
  exit 1
fi
for py_version in 3.12 3.13 3.14; do
  if [[ "$py_matrix" != *"\"$py_version\""* ]]; then
    echo "The non-pull-request Python matrix must keep $py_version: compatibility is deferred to" >&2
    echo "the scheduled run, not dropped." >&2
    exit 1
  fi
done
# `grep -v '^ *#'`: the comment above the matrix quotes this same condition to explain itself, so
# counting raw occurrences would count the explanation as one of the things it explains. The three:
# the wheel job's Rust cache (only the version pull requests build uses it), the generated stubs'
# Rust cache and the drift check.
drift_gates="$(grep -v '^ *#' "$build_workflow" |
  grep -c "matrix.python-version == '3.13'" || true)"
if [[ "$drift_gates" -ne 3 ]]; then
  echo "build.yml gates $drift_gates step(s) on Python 3.13; expected 3. If that set changes, the" >&2
  echo "version a pull request keeps has to change with it, or those steps stop running there." >&2
  exit 1
fi

# Which tests ran must be recoverable from CI, not only from a human reading a log. `--status-level
# fail` prints nothing for a passing test, so a name's absence reads the same whether it ran and
# passed or was never selected. The JUnit record is the only machine-readable answer, and it is
# worth nothing unless it leaves the runner.
nextest_config="$repo_root/.config/nextest.toml"
if ! grep -q '^\[profile\.ci\.junit\]' "$nextest_config"; then
  echo ".config/nextest.toml must enable JUnit for profile ci." >&2
  echo "Without it no CI job can answer 'did this named test run', because a passing test" >&2
  echo "prints no name and an absent name is indistinguishable from one never selected." >&2
  exit 1
fi
# `cargo nextest run` rewrites junit.xml. The rust tests job invokes it twice (workspace, then the
# toolchain proofs), so without a copy between them only the second survives and the artifact
# silently becomes a record of the proofs alone.
chain_block="$(sed -n '/^  postgres-owner-chains-linux-x86:/,/^  [a-z][a-z-]*:$/p' "$build_workflow")"
# The chain runs one `cargo nextest run` per entry and they all rewrite the same junit.xml, so
# publishing that file would ship one entry in a shape that looks like all of them. Publishing the
# per-entry copies the chain script takes is the supported way, and this names the difference
# rather than the word, so a future upload of the store path is caught whatever it is called.
if [[ "$chain_block" == *"nextest/ci/junit.xml"* ]]; then
  echo "The Owner chain job must not publish nextest's junit.xml: it runs one invocation per" >&2
  echo "entry, so that file holds the last entry only and would look like a full record." >&2
  echo "Publish target/nextest/chain-records/ instead - one file per entry." >&2
  exit 1
fi
# `|| true`: grep -c exits 1 when the count is zero, and under `set -e` that ends the script with
# no message - a red that names nothing, which is the failure mode this guard exists to prevent.
keeps="$(grep -c 'nextest/ci/junit\.xml' "$build_workflow" || true)"
if [[ "$keeps" -ne 1 ]]; then
  echo "build.yml copies junit.xml $keeps time(s); expected exactly 1, taken straight after the" >&2
  echo "workspace run and before anything else invokes nextest. A second copy would record" >&2
  echo "whatever ran last, and the toolchain proofs run one invocation per proof, so such a" >&2
  echo "record would hold one proof while looking like all of them." >&2
  exit 1
fi
if ! grep -q 'name: test-record-linux-x86' "$build_workflow"; then
  echo "build.yml must upload the JUnit record; a file that never leaves the runner answers" >&2
  echo "nothing about which tests ran." >&2
  exit 1
fi
# The chain runs one `cargo nextest run` per entry, so its junit.xml holds the last entry only.
# Uploading it would publish a file that looks like a full record and is not; the chain already
# names every entry it runs in the log.
# The per-entry record is what makes "did entry N run, and for how long" answerable without a
# person reading the log. It is worth nothing unless the script writes it and both channels that
# AGENTS.md accepts as chain evidence carry it off the runner.
# Two call sites, and both are load-bearing: the one inside the loop records every entry that
# completes, and the one in `cleanup` records the entry that ended the run - `--fail-fast` and
# `set -e` mean a failing entry never reaches its own copy. Counting them apart matters: grepping
# for the call at all is satisfied by either, so removing the loop copy would leave a record of
# nothing but failures while the guard stayed green.
# Match the literal call text, not an expansion of it.
# shellcheck disable=SC2016
chain_copies="$(grep -c 'keep_chain_record "\$chain_position"' \
  "$repo_root/scripts/ci/test-rd-owner-postgres.bash" || true)"
if [[ "$chain_copies" -ne 2 ]]; then
  echo "test-rd-owner-postgres.bash calls keep_chain_record $chain_copies time(s); expected 2:" >&2
  echo "once in the entry loop, once in cleanup for the entry that ended the run. With only the" >&2
  echo "cleanup call the record holds failures alone; with only the loop call a failing entry has" >&2
  echo "no record, and 'no record' would mean both 'never ran' and 'ran and failed'." >&2
  exit 1
fi
for chain_channel in .github/workflows/build.yml .github/workflows/owner-chains.yml; do
  if ! grep -q 'target/nextest/chain-records/' "$repo_root/$chain_channel"; then
    echo "$chain_channel carries the Owner chain but does not publish its per-entry record." >&2
    echo "A record that never leaves the runner answers nothing about which entries ran." >&2
    exit 1
  fi
  # Both channels run the chain job as a matrix over two legs, and only the R&D leg's script takes
  # the per-entry copies. An unconditional upload finds nothing on the Market Data leg, and
  # `if-no-files-found: error` - which is there so an empty upload cannot read as "no entry ran" -
  # then fails that job. Run 35688437514 is what that looks like.
  if ! grep -A1 'name: Publish which chain entries ran' "$repo_root/$chain_channel" |
    grep -q "matrix.chain.key == 'rd-owner'"; then
    echo "$chain_channel publishes the chain record without restricting it to the rd-owner leg." >&2
    echo "The Market Data leg writes no records, so the upload finds nothing there and fails the" >&2
    echo "job on if-no-files-found: error." >&2
    exit 1
  fi
done
# Both gate scripts assert with bare commands in places, and a bare command that fails under `set -e`
# prints nothing: run 35650397288 spent a hosted runner on the ordered chain and left the log holding
# nothing at all between the `make` line and `Error 1`. The ERR trap is what turns that into a line
# and a command; `-E` is what carries it into a function body, and that is not a detail - without
# `-E` a failure inside a function fires no trap at all, at the line or at the call site, and every
# check in these two scripts lives inside one.
for named_gate in scripts/ci/test-plan.sh scripts/ci/test-rd-owner-postgres.bash; do
  if ! grep -q '^set -Eeuo pipefail$' "$repo_root/$named_gate"; then
    echo "$named_gate does not set -E, so a check failing inside a function fires no ERR trap and" >&2
    echo "the script ends with an empty log instead of the line that refused." >&2
    exit 1
  fi
  if ! grep -q "^trap '.*BASH_COMMAND.*' ERR\$" "$repo_root/$named_gate"; then
    echo "$named_gate has no ERR trap naming the failing command, so a bare assertion in it fails" >&2
    echo "with no message and a red says only that the script exited non-zero." >&2
    exit 1
  fi
done
# The chain's own summary must be printed before the server log, never after it. That dump is
# unbounded - 270157 lines on run 35703938333 - and while GitHub keeps the whole job log, two of the
# three commands people read one with return a silently shortened copy: measured on that run, the raw
# jobs/<id>/logs API gave 297380 lines and held the summary, `gh run view --log` gave 119412 and
# `gh run view --job <id> --log` gave 78108, and neither of those two held it. A summary printed
# after the dump is therefore readable only by someone who already knows which command to use.
# `|| true` on both greps, so an absent side is reported below rather than ending this script inside
# a command substitution.
chain_script="$repo_root/scripts/ci/test-rd-owner-postgres.bash"
chain_summary_line="$(grep -n 'ordered chain stopped at entry' "$chain_script" | head -1 | cut -d: -f1 || true)"
chain_dump_line="$(grep -n 'postgres server log (chain container)' "$chain_script" | head -1 | cut -d: -f1 || true)"
if [[ -z "$chain_summary_line" || -z "$chain_dump_line" ]]; then
  echo "test-rd-owner-postgres.bash no longer prints both the chain summary and the server log, so" >&2
  echo "their order cannot be read: summary='$chain_summary_line' dump='$chain_dump_line'." >&2
  exit 1
fi
if [[ "$chain_summary_line" -ge "$chain_dump_line" ]]; then
  echo "test-rd-owner-postgres.bash prints its chain summary at line $chain_summary_line, after the" >&2
  echo "unbounded server log at line $chain_dump_line. A truncated hosted log keeps the dump and" >&2
  echo "drops the one line that says which entry stopped the run." >&2
  exit 1
fi
# The chain's Linux restriction may be stepped over deliberately, and the step must stay expensive to
# take by accident and impossible to take silently. Three things are pinned: the restriction itself,
# the one variable that lifts it, and the sentence saying what a run under it is worth. The third is
# the one that decays - a later edit shortening the message would leave a bypass that no longer says
# a local pass is not acceptance, and nothing else in this repository would notice.
chain_linux_gate="$repo_root/scripts/ci/test-rd-owner-postgres.bash"
# Match literal shell source.
# shellcheck disable=SC2016
if ! grep -Fq 'if [[ "$(uname -s)" != "Linux" ]]; then' "$chain_linux_gate"; then
  echo "test-rd-owner-postgres.bash no longer refuses a non-Linux host." >&2
  echo "Acceptance is these entries passing on Linux CI; dropping the check removes the only" >&2
  echo "place that says so to someone running it elsewhere." >&2
  exit 1
fi
if ! grep -Fq 'RD_OWNER_CHAIN_LOCAL_PREFLIGHT' "$chain_linux_gate"; then
  echo "test-rd-owner-postgres.bash refuses a non-Linux host with no named way through." >&2
  echo "Without one the refusal is stepped over by editing it out, which leaves nothing in the" >&2
  echo "log saying the run skipped it." >&2
  exit 1
fi
if ! grep -Fq 'Acceptance is' "$chain_linux_gate"; then
  echo "test-rd-owner-postgres.bash lets a non-Linux run proceed without saying what it is worth." >&2
  echo "The message must state that a pass there is a working state and acceptance is Linux CI." >&2
  exit 1
fi

# `quality` must skip a run the ready gate did not admit as full, and must still be `always()` for
# every run it did. Both halves matter and they pull in opposite directions, so each is pinned.
#
# Without `always()` the job stops aggregating the moment anything it waits on fails, which is the
# only situation it exists for. Without the run-full condition it runs on a draft pull request's
# opening run, finds every job it aggregates skipped, and reports that as a failure - a red that
# takes three and a half minutes to appear and stays for the hour the real run needs. Two sessions
# read that red on two different pull requests on 2026-09-22 and acted on it.
#
# A skipped `quality` cannot let anything through: the only runs it skips are a draft pull request's,
# and a draft cannot be merged. Marking it ready starts a run where this condition holds.
quality_if="$(grep -A 1 '^  quality:' "$build_workflow" | grep -c 'name: quality' || true)"
if [[ "$quality_if" != "1" ]]; then
  echo "build.yml no longer declares a job named quality where this check expects it." >&2
  exit 1
fi
# The `if:` line itself, not the block around it. Matching the block passed while `always()` sat
# only in the comment explaining why it has to be there: the sentence written to justify the
# condition satisfied the check for the condition, and removing the condition changed nothing.
quality_if_line="$(sed -n '/^  quality:/,/^    steps:/p' "$build_workflow" | grep '^    if: ' || true)"
if [[ -z "$quality_if_line" ]]; then
  echo "build.yml's quality job has no if: line, so it runs on every run including the ones the" >&2
  echo "ready gate refused." >&2
  exit 1
fi
if [[ "$quality_if_line" != *"always()"* ]]; then
  echo "build.yml's quality job is no longer always(), so it stops aggregating exactly when" >&2
  echo "something it waits on fails - which is the case it exists to report." >&2
  exit 1
fi
if [[ "$quality_if_line" != *"needs.ready-gate.outputs.run-full == 'true'"* ]]; then
  echo "build.yml's quality job runs on a run the ready gate did not admit as full. Every job it" >&2
  echo "aggregates is skipped there, so it reports that nothing as a failure: a red that appears" >&2
  echo "in minutes and outlives the real run, on a draft pull request, which is how the" >&2
  echo "documentation says to open one." >&2
  exit 1
fi
# The author still has to be told how to get a full run; ready-gate says it without failing anything.
if ! grep -Fq 'needs-full-ready: move the PR to Draft, then mark it Ready' "$build_workflow"; then
  echo "build.yml no longer tells the author how to turn a partial run into a full one." >&2
  echo "Skipping quality removes the red that used to say it, so the notice must stay." >&2
  exit 1
fi

# Entry 28 is the only entry whose work depends on inputs the chain script does not itself produce,
# and without them it reports PASS in eleven milliseconds. The check that says so must exist, must
# name all three inputs, and must behave differently in a preflight than in the gate - carrying on
# there, refusing here. Each is pinned, because each fails silently if it is dropped: a missing
# check restores the eleven-millisecond green, a check naming fewer inputs sends the reader after
# the wrong one, and a check that refuses in a preflight turns ninety-eight real entries into
# twenty-seven under `--fail-fast`.
chain_script="$repo_root/scripts/ci/test-rd-owner-postgres.bash"
for sealed_input in DASHBOARD_STRATEGY_VIEWER_BROWSER_ACCEPTANCE \
  DASHBOARD_STRATEGY_VIEWER_BROWSER_EXECUTABLE \
  DASHBOARD_STRATEGY_VIEWER_ACCEPTANCE_CANDIDATE; do
  if ! grep -Fq "$sealed_input" "$chain_script"; then
    echo "test-rd-owner-postgres.bash does not check for $sealed_input before running the chain." >&2
    echo "Entry 28 returns in milliseconds and reports PASS when it is absent, so the chain goes" >&2
    echo "green having driven no browser at all." >&2
    exit 1
  fi
done
if ! grep -q 'check_sealed_browser_inputs$' "$chain_script"; then
  echo "test-rd-owner-postgres.bash defines the sealed-input check and never calls it." >&2
  exit 1
fi
sealed_check_block="$(sed -n '/^check_sealed_browser_inputs() {/,/^}/p' "$chain_script")"
if [[ "$sealed_check_block" != *'RD_OWNER_CHAIN_LOCAL_PREFLIGHT'* ]]; then
  echo "the sealed-input check treats a preflight and the gate alike. A preflight must carry on" >&2
  echo "and record that entry 28 covered nothing; --fail-fast would otherwise cut the run short." >&2
  exit 1
fi
if [[ "$sealed_check_block" != *'return 1'* ]]; then
  echo "the sealed-input check never refuses, so the gate would accept a chain whose browser" >&2
  echo "acceptance ran nothing." >&2
  exit 1
fi

# The chain red-rate report answers a question three filters make easy to answer wrongly, and all
# three were used wrongly in the two days before it was written. Each is pinned here because each
# one silently shrinks the answer rather than failing:
#
#   a `--status` filter on the listing loses chain failures inside runs whose own conclusion is
#   `cancelled`; there were two in the first window this was run over.
#   an `--event` filter loses the scheduled runs, which is where `main`'s own verdict comes from.
#   printing an aggregate without the per-day split describes an average of regimes - 40%, 12% and
#   0% on three consecutive days - that the repository was never in.
#
# Comment lines are excluded: the script's own header names all three filters in order to say why
# it does not use them, and a search that counted those would pass on a script that used them.
chain_report="$repo_root/scripts/ci/report-chain-red-rate.bash"
chain_report_code="$(grep -v '^[[:space:]]*#' "$chain_report" || true)"
if [[ -z "$chain_report_code" ]]; then
  echo "scripts/ci/report-chain-red-rate.bash has no code outside its comments." >&2
  exit 1
fi
for forbidden_filter in --status --event; do
  if [[ "$chain_report_code" == *"gh run list"*"$forbidden_filter"* ]]; then
    echo "report-chain-red-rate.bash filters its run listing with $forbidden_filter." >&2
    echo "A --status filter loses chain failures inside cancelled runs; an --event filter loses" >&2
    echo "the scheduled runs that carry main's own verdict. Both shrink the answer in silence." >&2
    exit 1
  fi
done
if [[ "$chain_report_code" != *'.jobs[]'* ]]; then
  echo "report-chain-red-rate.bash no longer reads the chain job's own conclusion, so it reports" >&2
  echo "the run's conclusion instead - which is a different question with a smaller answer." >&2
  exit 1
fi
if [[ "$chain_report_code" != *'by day'* ]]; then
  echo "report-chain-red-rate.bash no longer prints the per-day split. Its aggregate is an average" >&2
  echo "over whatever regimes the window spans, and quoting it describes no state that existed." >&2
  exit 1
fi

grep -Fq 'rust-cache-workspace-crates: "true"' "$build_workflow"
grep -Fq 'rust-doctests-linux-x86:' "$build_workflow"
rust_tests_block="$(sed -n '/^  rust-tests-linux-x86:/,/^  quality:/p' "$build_workflow")"
[[ "$rust_tests_block" == *'minimum-free-space-gb: "70"'* ]]
# shellcheck disable=SC2016
grep -Fq 'RUST_DOCTESTS_RESULT: ${{ needs.rust-doctests-linux-x86.result }}' "$build_workflow"
# Match literal shell source.
# shellcheck disable=SC2016
grep -Fq 'test "$RUST_DOCTESTS_RESULT" = success' "$build_workflow"

generated_block="$(sed -n '/Restore generated stubs Rust cache/,/Upload wheel artifact/p' "$build_workflow")"
[[ "$generated_block" == *'workspaces: . -> target/py-stubs'* ]]
# The key must stay a literal. It used to interpolate the Python version and hash
# `build.yml`, `Cargo.lock` and the `Makefile`; rust-cache derives those itself, so naming
# them could only lose entries, and the entry never came back -- runs 35413952045 and
# 35438818832 both logged `No cache found.` and rebuilt 595 crates. Asserting the literal
# keeps the entry distinct from the wheel cache in this same job without re-introducing
# compile inputs.
[[ "$generated_block" == *'key: py-stubs'* ]]
# The one file hashed into every rust-cache prefix is build-env.mk (scripts/ci/check-build-env-file.bash);
# any other hashFiles in this block is the churn described above.
generated_prefix="prefix-key: v0-rust-\${{ hashFiles('build-env.mk') }}"
[[ "$generated_block" == *"$generated_prefix"* ]]
if [[ "${generated_block//"$generated_prefix"/}" == *'hashFiles('* ]]; then
  echo "Generated stubs cache key must not name compile inputs: rust-cache derives them" >&2
  exit 1
fi
bash "$repo_root/scripts/ci/check-build-env-file.bash" --self-test
bash "$repo_root/scripts/ci/check-build-env-file.bash"
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
assert_nextest_role "$repo_root/.github/workflows/nightly-tests.yml" standard-precision release
assert_nextest_role "$repo_root/.github/workflows/nightly-tests.yml" cargo-publish-plan release

[[ "$(workflow_job_block "$build_workflow" rust-tests-linux-x86)" == *'make cargo-test NEXTEST_PROFILE=ci'* ]]
[[ "$(workflow_job_block "$repo_root/.github/workflows/performance.yml" performance-benchmarks)" == *'make cargo-test NEXTEST_PROFILE=ci'* ]]
[[ "$(workflow_job_block "$repo_root/.github/workflows/dst.yml" dst-smoke)" == *'make cargo-test-sim NEXTEST_PROFILE=ci'* ]]
[[ "$(workflow_job_block "$repo_root/.github/workflows/nightly-tests.yml" turmoil)" == *'cargo nextest run'* ]]
[[ "$(workflow_job_block "$repo_root/.github/workflows/nightly-miri.yml" miri)" == *'make cargo-miri-'* ]]
echo "ok: adaptive cleanup, Rust cache, doctest isolation, and nextest consumer invariants"

# A pull request's pre-commit hooks run in two jobs: pre-commit-pr.yml runs the no-compile ones on
# every push, build.yml's pre-commit job runs the compiled rest, and build.yml's `quality` requires
# the other's result for the same head. Between them they must cover every hook a pull request ran before the split,
# over the same files, on both routes; the coverage is computed from the arguments the jobs pass.
python3 -B "$repo_root/scripts/ci/check-pr-hook-coverage.py" "$repo_root"
python3 -B "$repo_root/scripts/ci/check-pr-hook-coverage_test.py"
bash "$repo_root/scripts/ci/test-require-workflow-job.bash"
pre_commit_pr="$repo_root/.github/workflows/pre-commit-pr.yml"
pre_commit_job="$(workflow_job_block "$build_workflow" pre-commit)"
# Match literal workflow expressions.
# shellcheck disable=SC2016
[[ "$pre_commit_job" == *'bash scripts/ci/run-pre-commit.bash "pull-request-${route}"'* ]]
# shellcheck disable=SC2016
[[ "$pre_commit_job" == *'bash scripts/ci/run-pre-commit.bash "$route"'* ]]
grep -Fq 'run: bash scripts/ci/run-pre-commit.bash no-compile' "$pre_commit_pr"
grep -Eq '^  pull_request:' "$pre_commit_pr"
quality_job="$(workflow_job_block "$build_workflow" quality)"
required_job="$(grep -oE '"pre-commit \(no-compile hooks\)"' <<< "$quality_job" || true)"
if [[ -z "$required_job" ]] || [[ "$quality_job" != *'bash scripts/ci/require-workflow-job.bash pre-commit-pr.yml'* ]] ||
  ! grep -Fq "name: ${required_job//\"/}" "$pre_commit_pr"; then
  echo "build.yml's quality job must require pre-commit-pr.yml's no-compile job by its exact name." >&2
  exit 1
fi
echo "ok: pull requests keep their pre-commit coverage across the two jobs"

# Every PostgreSQL and Redis image CI runs is pinned by digest, in services and in scripts alike. The
# digest is what lets scripts/ci/pull-pinned-image.bash take the image from mirror.gcr.io or from
# public.ecr.aws and still run the same bytes; a tag-only reference could change under a job. Every
# PostgreSQL digest is also the deployment's (product/rd-workbench/docker-compose.yml), so the Owner
# acceptances run on the server production runs. The pull script's own test uses reference fixtures,
# and comments are prose.
python3 - "$repo_root" << 'PINNED'
import re
import subprocess
import sys

root = sys.argv[1]
files = subprocess.run(
    ["git", "-C", root, "ls-files", ".github/workflows/*.yml", "scripts/ci/*.bash", "scripts/ci/*.sh",
     "crates/data/tests/*.bash"],
    capture_output=True, text=True, check=True,
).stdout.split()
reference = re.compile(r"(postgres|redis):[0-9][^\s\"'@]*(@sha256:[0-9a-f]{64})?")
compose = "product/rd-workbench/docker-compose.yml"
deployed = set(re.findall(r"image: postgres:[^@\s]+@(sha256:[0-9a-f]{64})", open(f"{root}/{compose}", encoding="utf-8").read()))
if len(deployed) != 1:
    print(f"{compose} must run exactly one PostgreSQL digest, found {sorted(deployed)}.", file=sys.stderr)
    sys.exit(1)
(deployed,) = deployed
unpinned = []
drifted = []
for path in files:
    if path == "scripts/ci/test-pull-pinned-image.bash":
        continue
    for number, line in enumerate(open(f"{root}/{path}", encoding="utf-8"), start=1):
        if line.lstrip().startswith("#"):
            continue
        for m in reference.finditer(line):
            if not m.group(2):
                unpinned.append(f"{path}:{number}: {m.group(0)}")
            elif m.group(1) == "postgres" and m.group(2) != f"@{deployed}":
                drifted.append(f"{path}:{number}: {m.group(0)}")
if drifted:
    print(f"PostgreSQL images CI runs must be the deployment's ({compose}: {deployed}):", file=sys.stderr)
    print("\n".join(drifted), file=sys.stderr)
    sys.exit(1)
if unpinned:
    print("PostgreSQL/Redis images CI runs must be pinned by digest (image:tag@sha256:...):", file=sys.stderr)
    print("\n".join(unpinned), file=sys.stderr)
    sys.exit(1)
PINNED
bash "$repo_root/scripts/ci/test-pull-pinned-image.bash"
echo "ok: every PostgreSQL/Redis image CI runs is pinned by digest, PostgreSQL to the deployment's"

echo "All CI plan cases passed"
