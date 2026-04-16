#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

if [ "${CI:-}" = "true" ]; then
  exit 0
fi

if ! command -v git >/dev/null 2>&1; then
  exit 0
fi

if ! git -C "$ROOT_DIR" rev-parse --git-dir >/dev/null 2>&1; then
  exit 0
fi

current_path="$(git -C "$ROOT_DIR" config --local --get core.hooksPath || true)"
if [ "$current_path" = ".githooks" ]; then
  exit 0
fi

git -C "$ROOT_DIR" config --local core.hooksPath .githooks
printf '%s\n' "Configured git hooks path to .githooks"
