#!/usr/bin/env bash

set -Eeuo pipefail
trap 'echo "$(basename "${BASH_SOURCE[0]}"):${LINENO}: this check failed: ${BASH_COMMAND}" >&2' ERR

readonly FROZEN_SOURCE_PATH="crates/strategy_factory/src/bounded_feature_program_lowerer_v1.rs"
readonly FROZEN_SOURCE_SHA256="7f86caeef1022de9643661bac9ce0a2c8e5b008b19a6b40322ec4300068f32db"

if [ "$#" -ne 1 ]; then
  echo "ERROR: frozen source baseline check requires one repository root" >&2
  exit 1
fi

repo_root="$1"
source_path="$repo_root/$FROZEN_SOURCE_PATH"

if [ ! -f "$source_path" ] || [ -L "$source_path" ]; then
  echo "ERROR: frozen convention source is missing or is not a regular file: $FROZEN_SOURCE_PATH" >&2
  exit 1
fi

if command -v shasum &> /dev/null; then
  actual_sha256=$(shasum -a 256 "$source_path" | awk '{print $1}')
elif command -v sha256sum &> /dev/null; then
  actual_sha256=$(sha256sum "$source_path" | awk '{print $1}')
else
  echo "ERROR: shasum or sha256sum is required for the frozen source baseline check" >&2
  exit 1
fi

if [ "$actual_sha256" != "$FROZEN_SOURCE_SHA256" ]; then
  echo "ERROR: frozen convention source digest mismatch: $FROZEN_SOURCE_PATH" >&2
  echo "Future lowerer changes require an explicit capsule compatibility migration and deliberate baseline update." >&2
  exit 1
fi

echo "Frozen convention source baseline is valid"
