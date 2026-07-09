#!/usr/bin/env sh

set -eu

if [ "${CODEX_HOME:-}" ]; then
  printf '%s\n' "$CODEX_HOME"
  exit 0
fi

printf '.codex\n'
