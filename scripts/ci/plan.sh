#!/usr/bin/env bash
set -euo pipefail

# Single CI impact authority. Pull requests are classified from the exact base
# to HEAD name-status diff; push and ambiguous inputs fail closed to every gate.

emit() {
  local tests="$1" rust_tests="$2" generated="$3" full_prek="$4" capnp="$5"
  local javascript="$6" python="$7" rust="$8" reason="$9"
  {
    echo "run_tests=${tests}"
    echo "run_rust_tests=${rust_tests}"
    echo "run_generated_drift=${generated}"
    echo "run_full_pre_commit=${full_prek}"
    echo "run_capnp_check=${capnp}"
    echo "codeql_javascript_impacted=${javascript}"
    echo "codeql_python_impacted=${python}"
    echo "codeql_rust_impacted=${rust}"
    echo "pre_commit_base=${merge_base:-}"
  } >> "$GITHUB_OUTPUT"
  echo "$reason"
}

run_all() {
  emit true true true true true true true true "$1"
  exit 0
}

if [[ "${EVENT_NAME:-}" != pull_request ]]; then
  run_all "${EVENT_NAME:-unknown} event: running full validation"
fi
if [[ -z "${BASE_REF:-}" ]]; then
  run_all "PR base ref missing: running full validation"
fi

base_commit="${BASE_SHA:-}"
if [[ -n "$base_commit" ]]; then
  if [[ ! "$base_commit" =~ ^[0-9a-f]{40}$ ]] ||
    ! git cat-file -e "${base_commit}^{commit}" 2> /dev/null; then
    run_all "PR base commit invalid: running full validation"
  fi
else
  if ! base_commit="$(git rev-parse --verify "refs/remotes/origin/${BASE_REF}^{commit}" 2> /dev/null)"; then
    run_all "PR base commit unavailable: running full validation"
  fi
fi
if ! merge_base="$(git merge-base "$base_commit" HEAD 2> /dev/null)" ||
  [[ -z "$merge_base" ]]; then
  run_all "PR merge-base unavailable: running full validation"
fi

# Regular A/M prose has no build or language-analysis consumer unless it lives
# inside an authority, generated, schema, test-fixture, or data owner.
is_lightweight_prose() {
  local changed_file="$1" filename="${1##*/}"
  case "$changed_file" in
    .github/workflows/* | .github/actions/* | .github/scripts/* | \
      scripts/* | .pre-commit-hooks/* | schema/* | schemas/* | \
      generated/* | tests/* | fixtures/* | resources/* | data/* | \
      test_data/* | snapshots/* | */schema/* | */schemas/* | \
      */generated/* | */tests/* | */fixtures/* | */resources/* | \
      */data/* | */test_data/* | */snapshots/*)
      return 1
      ;;
  esac
  case "$filename" in
    requirements*.txt | constraints*.txt)
      return 1
      ;;
  esac
  case "$changed_file" in
    *.md | *.markdown | *.mdx | *.rst | *.adoc | *.txt | LICENSE | NOTICE | COPYING)
      return 0
      ;;
  esac
  return 1
}

tests=false
rust_tests=false
generated=false
full_prek=false
capnp=false
codeql_javascript=false
codeql_python=false
codeql_rust=false
changed=false

status_file="$(mktemp "${TMPDIR:-/tmp}/trade-ci-plan.XXXXXX")"
trap 'rm -f "$status_file"' EXIT
if ! git diff --name-status --find-renames -z "$merge_base" HEAD > "$status_file"; then
  run_all "Changed paths unavailable: running full validation"
fi

exec 3< "$status_file"
while IFS= read -r -d '' status <&3; do
  changed=true
  case "$status" in
    A | M)
      if ! IFS= read -r -d '' changed_file <&3; then
        run_all "Malformed changed path: running full validation"
      fi
      ;;
    D | R* | C*)
      run_all "${status} change detected: running full validation"
      ;;
    *)
      run_all "Unknown ${status} change detected: running full validation"
      ;;
  esac

  mode="$(git ls-tree HEAD -- "$changed_file" | awk 'NR == 1 { print $1 }')"
  if [[ "$mode" != 100644 ]]; then
    run_all "Non-regular or executable path changed: running full validation"
  fi
  if is_lightweight_prose "$changed_file"; then
    continue
  fi

  # The planner, CI/security workflows, reusable actions, and validation hooks
  # control their own authority. Syntax validation supplements, but never
  # replaces, fail-closed full analysis for these paths.
  case "$changed_file" in
    .github/workflows/* | .github/actions/* | .github/scripts/* | \
      .pre-commit-config.yaml | .pre-commit-hooks/* | scripts/ci/*)
      run_all "CI or security authority changed: running full validation"
      ;;
  esac

  # Shared schemas and cross-language bindings feed both Rust and Python.
  case "$changed_file" in
    schema/* | schemas/* | */schema/* | */schemas/* | *.capnp | *.proto | \
      crates/*/src/python/* | crates/*/src/bindings/*)
      tests=true
      rust_tests=true
      generated=true
      full_prek=true
      capnp=true
      codeql_python=true
      codeql_rust=true
      continue
      ;;
  esac

  case "$changed_file" in
    *.js | *.jsx | *.mjs | *.cjs | *.ts | *.tsx | *.mts | *.cts | \
      package.json | */package.json | package-lock.json | */package-lock.json | \
      bun.lock | */bun.lock | bun.lockb | */bun.lockb | yarn.lock | */yarn.lock | \
      pnpm-lock.yaml | */pnpm-lock.yaml)
      codeql_javascript=true
      ;;
    *.py | *.pyi | *.pyx | *.pxd | \
      python/pyproject.toml | python/uv.lock | setup.cfg | tox.ini | \
      requirements*.txt | constraints*.txt)
      tests=true
      codeql_python=true
      case "$changed_file" in
        *generate* | *.pyi | *.pyx | *.pxd)
          generated=true
          ;;
      esac
      ;;
    *.rs)
      tests=true
      rust_tests=true
      full_prek=true
      codeql_rust=true
      ;;
    Cargo.toml | */Cargo.toml | Cargo.lock | rust-toolchain.toml | .cargo/* | \
      */.cargo/* | clippy.toml)
      tests=true
      rust_tests=true
      full_prek=true
      codeql_rust=true
      ;;
    Makefile | tools.toml | *.sh | *.bash | *.zsh | *.toml | *.yaml | *.yml | \
      *.json | *.lock | generated/* | */generated/* | tests/* | */tests/* | \
      fixtures/* | */fixtures/* | resources/* | */resources/* | data/* | */data/*)
      run_all "Build input, generator, fixture, data, or config changed: running full validation"
      ;;
    *)
      run_all "Unknown changed path: running full validation"
      ;;
  esac
done
exec 3<&-

if [[ "$changed" != true ]]; then
  run_all "Empty changed-path set: running full validation"
fi

emit "$tests" "$rust_tests" "$generated" "$full_prek" "$capnp" \
  "$codeql_javascript" "$codeql_python" "$codeql_rust" \
  "PR impact plan: tests=${tests}, rust=${rust_tests}, generated=${generated}, changed-file pre-commit"
