#!/usr/bin/env bash
set -Eeuo pipefail
trap 'echo "$(basename "${BASH_SOURCE[0]}"):${LINENO}: this check failed: ${BASH_COMMAND}" >&2' ERR

# Run cargo fmt while forcing rustfmt to read an empty config
# to avoid nightly-only options in the repository rustfmt.toml.

tmpdir="$(mktemp -d)"
cleanup() { rm -rf "$tmpdir"; }
trap cleanup EXIT

# Create an empty rustfmt.toml in the temp directory
touch "$tmpdir/rustfmt.toml"

# Forward all args; ensure rustfmt-specific flags come after '--'
has_dd=false
for arg in "$@"; do
  if [[ "$arg" == "--" ]]; then
    has_dd=true
    break
  fi
done

if $has_dd; then
  cargo fmt "$@" --config-path "$tmpdir"
else
  cargo fmt "$@" -- --config-path "$tmpdir"
fi
