#!/bin/bash
set -euo pipefail

# Resolve rust-toolchain.toml relative to this script's location
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TOOLCHAIN_FILE="${SCRIPT_DIR}/../rust-toolchain.toml"

# Check that rust-toolchain.toml exists
if [[ ! -f "$TOOLCHAIN_FILE" ]]; then
  echo "Error: rust-toolchain.toml not found at $TOOLCHAIN_FILE" >&2
  exit 1
fi

read_toolchain_value() {
  local key="$1"
  awk -v key="$key" '
    /^\[toolchain\]/ { in_section=1; next }
    /^\[/ { in_section=0 }
    in_section && $0 ~ "^[[:space:]]*" key "[[:space:]]*=" {
      sub(/^[^=]*=[[:space:]]*/, "")
      print
      exit
    }
  ' "$TOOLCHAIN_FILE"
}

VERSION=$(awk -F'"' '
  /^\[toolchain\]/ { in_section=1; next }
  /^\[/ { in_section=0 }
  in_section && /^[[:space:]]*channel[[:space:]]*=/ { print $2; exit }
' "$TOOLCHAIN_FILE")

if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Error: [toolchain].channel must be an exact Rust version in $TOOLCHAIN_FILE, was '$VERSION'" >&2
  exit 1
fi

case "${1:-}" in
  "")
    # Output version (without trailing newline for consistency)
    echo -n "$VERSION"
    ;;
  --target)
    TARGETS="$(read_toolchain_value targets)"
    TARGET="$(printf '%s' "$TARGETS" | sed -E 's/^\[[[:space:]]*"([A-Za-z0-9_.-]+)"[[:space:]]*\]$/\1/')"
    if [[ -z "$TARGETS" || "$TARGET" == "$TARGETS" ]]; then
      echo "Error: [toolchain].targets must contain exactly one target in $TOOLCHAIN_FILE, was '$TARGETS'" >&2
      exit 1
    fi
    echo -n "$TARGET"
    ;;
  *)
    echo "Usage: $0 [--target]" >&2
    exit 1
    ;;
esac
