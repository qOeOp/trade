#!/usr/bin/env bash

set -euo pipefail

REPO_ROOT=$(git rev-parse --show-toplevel)
HOOK="$REPO_ROOT/.pre-commit-hooks/check_frozen_source_convention_baseline.sh"
SOURCE="crates/strategy_factory/src/bounded_feature_program_lowerer_v1.rs"

CASE_ROOT=$(mktemp -d)
trap 'find "$CASE_ROOT" -depth -delete' EXIT

run_hook() {
  local case_root="$1"

  bash "$HOOK" "$case_root" > "$case_root/output.txt" 2>&1
}

exact_case="$CASE_ROOT/exact"
mkdir -p "$exact_case/$(dirname "$SOURCE")"
cp "$REPO_ROOT/$SOURCE" "$exact_case/$SOURCE"
if ! run_hook "$exact_case"; then
  echo "Expected exact frozen source bytes to pass"
  cat "$exact_case/output.txt"
  exit 1
fi

drift_case="$CASE_ROOT/drift"
mkdir -p "$drift_case/$(dirname "$SOURCE")"
cp "$REPO_ROOT/$SOURCE" "$drift_case/$SOURCE"
printf '\n' >> "$drift_case/$SOURCE"
if run_hook "$drift_case"; then
  echo "Expected one-byte frozen source drift to fail"
  exit 1
fi
grep -Fq "frozen convention source digest mismatch: $SOURCE" "$drift_case/output.txt"

missing_case="$CASE_ROOT/missing"
mkdir -p "$missing_case"
if run_hook "$missing_case"; then
  echo "Expected a missing frozen source to fail"
  exit 1
fi
grep -Fq "frozen convention source is missing or is not a regular file: $SOURCE" "$missing_case/output.txt"

echo "Frozen convention source baseline hook tests passed"
