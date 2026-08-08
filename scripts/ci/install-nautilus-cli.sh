#!/usr/bin/env bash
set -euo pipefail

# Install the current Vibe CLI from source.
# qOeOp/trade has no authorized prebuilt distribution endpoint.
# Set VIBE_CLI_FORCE_SOURCE=1 to acknowledge the source-build contract.

BIN_DIR="${BIN_DIR:-"$HOME/.local/bin"}"
export PATH="$BIN_DIR:$PATH"

INSTALL_ATTEMPTS="${INSTALL_ATTEMPTS:-5}"

if ! [[ "$INSTALL_ATTEMPTS" =~ ^[0-9]+$ ]] || [ "$INSTALL_ATTEMPTS" -lt 1 ]; then
  echo "INSTALL_ATTEMPTS must be a positive integer" >&2
  exit 1
fi

cargo_install_cli() {
  for attempt in $(seq 1 "$INSTALL_ATTEMPTS"); do
    if cargo install -q \
      --path crates/cli \
      --bin vibe \
      --locked \
      --force \
      --profile "${VIBE_CLI_PROFILE:-${CARGO_CI_PROFILE:-release}}" \
      --root "$HOME/.local"; then
      return 0
    fi

    if [ "$attempt" -lt "$INSTALL_ATTEMPTS" ]; then
      echo "cargo install failed, retrying... (attempt ${attempt}/${INSTALL_ATTEMPTS})"
      sleep $((2 ** attempt))
    else
      echo "cargo install failed (attempt ${attempt}/${INSTALL_ATTEMPTS})"
    fi
  done

  return 1
}

if [ "${VIBE_CLI_FORCE_SOURCE:-0}" != "1" ]; then
  echo "VIBE_CLI_FORCE_SOURCE=1 is required; no prebuilt Vibe CLI endpoint is configured" >&2
  exit 1
fi

echo "Building Vibe CLI from source (VIBE_CLI_FORCE_SOURCE=1)..."
cargo_install_cli
vibe --version
