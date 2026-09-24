#!/usr/bin/env bash
# Keeps the Rust caches keyed on the compile environment make hands to cargo (see build-env.mk).
#
# Two ways that key goes stale without anything failing:
# - the Makefile sets a compiler, flag, wrapper or build-script variable itself, where the hash of
#   build-env.mk cannot see it;
# - a rust-cache step stops hashing build-env.mk into its prefix-key.
# rust-cache never saves over an exact key hit, so either one leaves a cached target directory
# recorded under the old environment, restored exactly on every run and never refreshed.
#
# Usage: check-build-env-file.bash [--self-test]
set -Eeuo pipefail

names='CC|CXX|AR|CFLAGS|CXXFLAGS|LDFLAGS|RUSTFLAGS|RUSTDOCFLAGS|RUSTC|RUSTC_WRAPPER|RUSTC_WORKSPACE_WRAPPER|CARGO_INCREMENTAL|CARGO_ENCODED_RUSTFLAGS|CARGO_BUILD_RUSTFLAGS|CARGO_BUILD_RUSTDOCFLAGS|CARGO_PROFILE_[A-Z0-9_]+|DOCS_RS'
# An assignment anywhere on a line - global, target-specific or a recipe's `VAR=value command` -
# and an `export`/`unexport`/`override` of the bare name.
assignment="(^|[^A-Za-z0-9_\$(])(${names})[[:space:]]*(::|[?:+!])?="
declaration="(^|[[:space:]:])(export|unexport|override)[[:space:]]+(${names})([[:space:]]|\$)"
prefix_key="prefix-key: v0-rust-\${{ hashFiles('build-env.mk') }}"

# Prints each line of a make file that sets a compile-environment variable; comment lines excluded.
compile_environment_settings() {
  grep -nE -e "$assignment" -e "$declaration" "$1" | grep -vE '^[0-9]+:[[:space:]]*#' || true
}

self_test() {
  local scratch
  scratch="$(mktemp -d "${TMPDIR:-/tmp}/check-build-env-file.XXXXXX")"
  trap 'rm -rf "$scratch"' RETURN
  local -a flagged=(
    'CC ?= clang'
    'export CC'
    'unexport CXX'
    'RUSTFLAGS += -D warnings'
    'cargo-test: export RUSTFLAGS=--cfg x'
    $'\tRUSTFLAGS="-C x" cargo build'
    'CARGO_PROFILE_DEV_DEBUG := 0'
    'override CFLAGS = -O2'
    'docs: DOCS_RS=1'
    'RUSTC_WRAPPER=sccache'
  )
  # Make source, matched literally.
  # shellcheck disable=SC2016
  local -a allowed=(
    '# CC=cc and CXX=c++ are make defaults'
    'cargo-test: export RUST_BACKTRACE=1'
    'CARGO_BUILD_JOBS := 2'
    '$(CARGO_BUILD_JOB_TARGETS): export CARGO_BUILD_WARNINGS=warn'
    'SCCACHE ?= $(shell command -v sccache)'
    $'\t@echo $(CC)'
    'XCC = 1'
    'CARGO_CI_PROFILE ?= ci-pr'
  )
  local line
  for line in "${flagged[@]}"; do
    printf '%s\n' "$line" > "$scratch/Makefile"
    if [[ -z "$(compile_environment_settings "$scratch/Makefile")" ]]; then
      echo "self-test: a compile-environment setting was not flagged: $line" >&2
      return 1
    fi
  done
  for line in "${allowed[@]}"; do
    printf '%s\n' "$line" > "$scratch/Makefile"
    if [[ -n "$(compile_environment_settings "$scratch/Makefile")" ]]; then
      echo "self-test: a line that sets no compile-environment variable was flagged: $line" >&2
      return 1
    fi
  done
  echo "ok: check-build-env-file self-test (${#flagged[@]} flagged, ${#allowed[@]} allowed)"
}

if [[ "${1:-}" == "--self-test" ]]; then
  self_test
  exit
fi

repo_root="$(git rev-parse --show-toplevel)"
status=0

settings="$(compile_environment_settings "$repo_root/Makefile")"
if [[ -n "$settings" ]]; then
  echo "The Makefile sets compile-environment variables; move them to build-env.mk:" >&2
  printf '%s\n' "$settings" >&2
  status=1
fi

# Every rust-cache step, wherever it is, must hash build-env.mk into its prefix-key.
while IFS= read -r file; do
  uses="$(grep -cE 'uses: Swatinem/rust-cache@' "$file" || true)"
  keyed="$(grep -cF "$prefix_key" "$file" || true)"
  if [[ "$uses" != "$keyed" ]]; then
    echo "$file: $uses rust-cache step(s) but $keyed with \`$prefix_key\`" >&2
    status=1
  fi
done < <(git -C "$repo_root" grep -lE 'uses: Swatinem/rust-cache@' -- .github | sed "s#^#$repo_root/#")

if [[ ! -f "$repo_root/build-env.mk" ]]; then
  echo "build-env.mk is missing, so every rust-cache prefix-key hashes nothing" >&2
  status=1
fi

if [[ "$status" == 0 ]]; then
  echo "ok: the compile environment is confined to build-env.mk and every rust-cache key hashes it"
fi
exit "$status"
