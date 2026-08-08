#!/usr/bin/env bash
set -euo pipefail

# Classify changed paths for build.yml. The plan is the single owner of CI
# impact routing: workflow jobs only consume these outputs.
#
# Outputs (to $GITHUB_OUTPUT):
#   run_tests              - build and test the Python wheel matrix
#   run_rust_tests         - run Rust doctests and tests
#   run_generated_drift    - regenerate and check Python stubs/docstrings
#   run_full_pre_commit    - use prek --all-files rather than the PR diff
#   run_capnp_check        - run make check-capnp-schemas in pre-commit
#   pre_commit_base        - PR merge-base for prek --from-ref
#
# Unknown paths, unsafe deletions or renames, missing history, and CI authority
# changes are deliberately full routes. Pushes and non-PR events are also full
# routes: path reduction is a pull-request feedback optimization, never a
# release gate.

emit() {
  local tests="$1" rust="$2" generated="$3" full_prek="$4" capnp="$5" reason="$6"
  {
    echo "run_tests=${tests}"
    echo "run_rust_tests=${rust}"
    echo "run_generated_drift=${generated}"
    echo "run_full_pre_commit=${full_prek}"
    echo "run_capnp_check=${capnp}"
    echo "pre_commit_base=${merge_base:-}"
  } >> "$GITHUB_OUTPUT"
  echo "$reason"
}

run_all() {
  emit true true true true true "$1"
  exit 0
}

if [[ "${EVENT_NAME:-}" != "pull_request" ]]; then
  run_all "${EVENT_NAME:-unknown} event: running full validation"
fi

if [[ -z "${BASE_REF:-}" ]]; then
  run_all "PR base ref missing: running full validation"
fi
if ! merge_base="$(git merge-base "origin/${BASE_REF}" HEAD 2> /dev/null)"; then
  run_all "Failed to compute PR merge-base: running full validation"
fi
if [[ -z "$merge_base" ]]; then
  run_all "Empty PR merge-base: running full validation"
fi

# These paths have no product, runtime, package, or build-graph consumer. Keep
# this allowlist narrower than the A/M path router below: README and license
# files, crate metadata, executable CI policy, and independent workflows can be
# harmless to edit while still being unsafe to remove or rename.
is_safe_destructive_path() {
  local file="$1"

  if [[ "$file" =~ ^(docs|\.agents|\.codex)/ ]]; then
    return 0
  fi
  case "$file" in
    .gitignore | .gitattributes | .editorconfig | \
      ADAPTERS.md | BENCHMARKING.md | CONTRIBUTING.md | MIGRATION_V2.md | ROADMAP.md | \
      .github/CODEOWNERS | .github/OVERVIEW.md | .github/pull_request_template.md)
      return 0
      ;;
  esac
  return 1
}

safe_destructive_change=false
outside_safe_destructive_domain=false

while IFS=$'\t' read -r status first_path second_path; do
  [[ -z "$status" ]] && continue
  case "$status" in
    A | M)
      if ! is_safe_destructive_path "$first_path"; then
        outside_safe_destructive_domain=true
      fi
      ;;
    D)
      if ! is_safe_destructive_path "$first_path"; then
        run_all "Unsafe deletion detected: running full validation"
      fi
      safe_destructive_change=true
      ;;
    *)
      if [[ "$status" =~ ^R[0-9]+$ ]] &&
        is_safe_destructive_path "$first_path" &&
        is_safe_destructive_path "$second_path"; then
        safe_destructive_change=true
      else
        run_all "${status} change detected: running full validation"
      fi
      ;;
  esac
done < <(git diff --name-status --find-renames "$merge_base" HEAD)

if [[ "$safe_destructive_change" == true && "$outside_safe_destructive_domain" == true ]]; then
  run_all "Safe deletion or rename mixed with another impact domain: running full validation"
fi

wheel=false
rust=false
generated=false
capnp=false
unknown=false

while IFS= read -r file; do
  [[ -z "$file" ]] && continue

  # Documentation, Codex workflow material, and PR metadata have no package
  # consumer. They still run changed-file pre-commit hooks below.
  if [[ "$file" =~ ^(docs|\.agents|\.codex)/ ]]; then
    continue
  fi
  if [[ "$file" =~ ^[A-Z][A-Z0-9_]*\.md$ || "$file" == LICENSE ]]; then
    continue
  fi
  if [[ "$file" == .gitignore || "$file" == .gitattributes || "$file" == .editorconfig ]]; then
    continue
  fi
  if [[ "$file" =~ ^crates/.+/README\.md$ ]]; then
    continue
  fi
  if [[ "$file" == .github/CODEOWNERS || "$file" == .github/OVERVIEW.md ||
    "$file" == .github/pull_request_template.md || "$file" == .github/scripts/validate-pr-title.sh ]]; then
    continue
  fi
  if [[ "$file" =~ ^\.github/workflows/ ]]; then
    if [[ "$file" == .github/workflows/build.yml ]]; then
      run_all "Build workflow changed: running full validation"
    fi
    # Independent workflow changes do not alter build.yml's build graph.
    continue
  fi

  # CI authority and package/toolchain boundaries are full routes.
  if [[ "$file" == Makefile || "$file" == .pre-commit-config.yaml ||
    "$file" =~ ^(scripts/ci|\.github/actions|\.cargo|schema|crates)/ ||
    "$file" == Cargo.toml || "$file" == Cargo.lock || "$file" == rust-toolchain.toml ||
    "$file" == tools.toml ]]; then
    run_all "CI, Rust, schema, or toolchain authority changed: running full validation"
  fi

  if [[ "$file" =~ ^python/ ]]; then
    wheel=true
    if [[ "$file" == python/generate_stubs.py || "$file" == python/generate_docstrings.py ||
      "$file" == python/vibe_trader/config/__init__.py ||
      "$file" =~ ^python/vibe_trader/adapters/[^/]+/__init__\.py$ ||
      "$file" =~ ^python/vibe_trader/.*\.pyi$ ]]; then
      generated=true
    fi
    continue
  fi

  # Everything else has no enumerated consumer, so it must not reduce gates.
  unknown=true
done < <(git diff --name-only --find-renames "$merge_base" HEAD)

if [[ "$unknown" == true ]]; then
  run_all "Unknown changed path: running full validation"
fi

emit "$wheel" "$rust" "$generated" false "$capnp" \
  "PR path plan: wheel=${wheel}, rust=${rust}, generated-drift=${generated}, changed-file pre-commit"
