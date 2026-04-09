#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SKILL_NAME="$(basename "$SKILL_DIR")"
REQ_FILE="$SCRIPT_DIR/requirements.txt"
MIN_SUPPORTED_PYTHON='3.9'

resolve_workspace_root() {
  if git -C "$PWD" rev-parse --show-toplevel >/dev/null 2>&1; then
    git -C "$PWD" rev-parse --show-toplevel
    return 0
  fi

  if git -C "$SKILL_DIR" rev-parse --show-toplevel >/dev/null 2>&1; then
    git -C "$SKILL_DIR" rev-parse --show-toplevel
    return 0
  fi

  pwd
}

WORKSPACE_ROOT="$(resolve_workspace_root)"
export CODEX_WORKSPACE_ROOT="$WORKSPACE_ROOT"

VENV_DIR="$WORKSPACE_ROOT/.cache/skills/$SKILL_NAME/.venv"
STAMP_FILE="$VENV_DIR/.requirements.sha256"
PYTHON_FILE="$VENV_DIR/.python-path"
CURRENT_HASH="$(shasum -a 256 "$REQ_FILE" | awk '{print $1}')"

python_supported() {
  "$1" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 9) else 1)'
}

find_uv_python() {
  local version="$1"
  local candidate=""

  if ! command -v uv >/dev/null 2>&1; then
    return 1
  fi

  candidate="$(uv python find "$version" 2>/dev/null | tail -n 1)"
  if [ -n "$candidate" ] && [ -x "$candidate" ]; then
    printf '%s
' "$candidate"
    return 0
  fi

  return 1
}

select_python() {
  local candidate=""
  local version=""

  for version in 3.12 3.11 3.10 3.9 3.13 3.14; do
    candidate="python$version"
    if command -v "$candidate" >/dev/null 2>&1 && python_supported "$candidate"; then
      command -v "$candidate"
      return 0
    fi

    candidate="$(find_uv_python "$version" || true)"
    if [ -n "$candidate" ] && python_supported "$candidate"; then
      printf '%s
' "$candidate"
      return 0
    fi
  done

  if command -v python3 >/dev/null 2>&1 && python_supported python3; then
    command -v python3
    return 0
  fi

  return 1
}

PYTHON_BIN="$(select_python || true)"
if [ -z "$PYTHON_BIN" ]; then
  echo "ohlcv-fetch 需要 Python 3.9+；当前未找到受支持的 python3 解释器。" >&2
  exit 1
fi

REBUILD_VENV=0
if [ ! -x "$VENV_DIR/bin/python" ]; then
  REBUILD_VENV=1
elif [ ! -f "$PYTHON_FILE" ]; then
  REBUILD_VENV=1
elif [ "$(cat "$PYTHON_FILE")" != "$PYTHON_BIN" ]; then
  REBUILD_VENV=1
elif ! "$VENV_DIR/bin/python" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 9) else 1)'; then
  REBUILD_VENV=1
fi

if [ "$REBUILD_VENV" -eq 1 ]; then
  rm -rf "$VENV_DIR"
fi

mkdir -p "$(dirname "$VENV_DIR")"

if [ ! -x "$VENV_DIR/bin/python" ]; then
  "$PYTHON_BIN" -m venv "$VENV_DIR"
  printf '%s' "$PYTHON_BIN" > "$PYTHON_FILE"
fi

if [ ! -f "$STAMP_FILE" ] || [ "$(cat "$STAMP_FILE")" != "$CURRENT_HASH" ]; then
  "$VENV_DIR/bin/python" -m pip install -r "$REQ_FILE"
  printf '%s' "$CURRENT_HASH" > "$STAMP_FILE"
fi

exec "$VENV_DIR/bin/python" "$SCRIPT_DIR/fetch.py" "$@"
