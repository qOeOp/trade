#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VENV_DIR="$SCRIPT_DIR/.venv"
REQ_FILE="$SCRIPT_DIR/requirements.txt"
STAMP_FILE="$VENV_DIR/.requirements.sha256"
CURRENT_HASH="$(shasum -a 256 "$REQ_FILE" | awk '{print $1}')"

if [ ! -x "$VENV_DIR/bin/python" ]; then
  python3 -m venv "$VENV_DIR"
fi

if [ ! -f "$STAMP_FILE" ] || [ "$(cat "$STAMP_FILE")" != "$CURRENT_HASH" ]; then
  "$VENV_DIR/bin/python" -m pip install -r "$REQ_FILE"
  printf '%s' "$CURRENT_HASH" > "$STAMP_FILE"
fi

exec "$VENV_DIR/bin/python" "$SCRIPT_DIR/analyze.py" "$@"
