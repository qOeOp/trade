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
ready_gate_cases="$(sed -n '/ready-gate:/,/^  plan:/p' "$repo_root/.github/workflows/build.yml")"
for pr_case in 'ready_for_review:' 'opened:false' 'reopened:false'; do
  if [[ "$ready_gate_cases" != *"$pr_case"* ]]; then
    echo "ready-gate must still admit $pr_case" >&2
    exit 1
  fi
done
codeql_triggers="$(sed -n '/^on:/,/^jobs:/p' "$repo_root/.github/workflows/codeql-analysis.yml")"
[[ "$codeql_triggers" == *'workflow_dispatch:'* ]]
[[ "$codeql_triggers" == *'branches: [main]'* ]]
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
# `main` is built by the schedule trigger, not by a push, so every cache-saving job has to save on
# the scheduled run too: a job that still gates on `push` alone simply stops populating the cache
# that pull requests restore from, and nothing goes red when it does. Written as a universal rather
# than as a list of today's entries - the way this decays is a seventh job gating on `push` alone,
# which an enumeration of six would not notice.
save_gate_total="$(awk '/save-if:/ && /event_name/ {n++} END {print n+0}' "$build_workflow")"
save_gate_scheduled="$(awk '/save-if:/ && /event_name/ && /schedule/ {n++} END {print n+0}' "$build_workflow")"
if [[ "$save_gate_total" != "$save_gate_scheduled" ]]; then
  echo "build.yml: $((save_gate_total - save_gate_scheduled)) cache-saving job(s) gate on push alone," >&2
  echo "but main is built on a schedule, so those jobs never save a cache for main:" >&2
  awk '/save-if:/ && /event_name/ && !/schedule/ {print "  " FILENAME ":" FNR ": " $0}' \
    "$build_workflow" >&2
  exit 1
fi
if [[ "$save_gate_total" -ne 6 ]]; then
  echo "build.yml has $save_gate_total event-gated save-if entries, expected 6." >&2
  echo "A removed entry stops saving a cache; a new one must also admit the schedule." >&2
  exit 1
fi

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
# The key must stay a literal. It used to interpolate the Python version and hash
# `build.yml`, `Cargo.lock` and the `Makefile`; rust-cache derives those itself, so naming
# them could only lose entries, and the entry never came back -- runs 35413952045 and
# 35438818832 both logged `No cache found.` and rebuilt 595 crates. Asserting the literal
# keeps the entry distinct from the wheel cache in this same job without re-introducing
# compile inputs.
[[ "$generated_block" == *'key: py-stubs'* ]]
if [[ "$generated_block" == *'hashFiles('* ]]; then
  echo "Generated stubs cache key must not name compile inputs: rust-cache derives them" >&2
  exit 1
fi
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
