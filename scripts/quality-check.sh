#!/usr/bin/env sh

set -eu

ROOT="$(CDPATH='' cd -- "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

QUALITY_SCOPE="${1:-all}"
if [ "$#" -gt 1 ]; then
  printf 'quality: usage: scripts/quality-check.sh [all|policy|packages|native]\n' >&2
  exit 2
fi
case "$QUALITY_SCOPE" in
  all|policy|packages|native) ;;
  *)
    printf 'quality: unsupported scope: %s\n' "$QUALITY_SCOPE" >&2
    exit 2
    ;;
esac

QUALITY_LOCK_DIR="$ROOT/tmp/check/quality-check.lock"
QUALITY_WORKSPACE_SNAPSHOT="$ROOT/tmp/check/quality-workspace-snapshot.json"
QUALITY_WORKSPACE_POSTFLIGHT=0
sh scripts/quality-lock.sh acquire "$QUALITY_LOCK_DIR" "$$"

finish_quality_check() {
  quality_status=$?
  postflight_status=0
  trap - EXIT HUP INT TERM
  if [ "$QUALITY_WORKSPACE_POSTFLIGHT" -eq 1 ]; then
    bun scripts/check-workspace-side-effects.ts --action check --snapshot "$QUALITY_WORKSPACE_SNAPSHOT" || postflight_status=$?
  fi
  sh scripts/quality-lock.sh release "$QUALITY_LOCK_DIR" "$$"
  if [ "$quality_status" -ne 0 ]; then
    exit "$quality_status"
  fi
  exit "$postflight_status"
}
trap finish_quality_check EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

if [ -n "${CI:-}" ]; then
  bun scripts/check-workspace-side-effects.ts --action capture --snapshot "$QUALITY_WORKSPACE_SNAPSHOT" --require-clean >/dev/null
else
  bun scripts/check-workspace-side-effects.ts --action capture --snapshot "$QUALITY_WORKSPACE_SNAPSHOT" >/dev/null
fi
QUALITY_WORKSPACE_POSTFLIGHT=1

log() {
  printf 'quality: %s\n' "$*"
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'quality: missing required command: %s\n' "$1" >&2
    exit 1
  fi
}

require_shellcheck() {
  if ! shellcheck_path="$(command -v shellcheck 2>/dev/null)"; then
    printf 'quality: ShellCheck 0.11.0 is required on PATH; command not found\n' >&2
    exit 1
  fi
  case "$shellcheck_path" in
    node_modules/*|*/node_modules/*)
      printf 'quality: refusing stale npm ShellCheck wrapper at %s; install native ShellCheck 0.11.0 on PATH\n' "$shellcheck_path" >&2
      exit 1
      ;;
  esac
  if ! shellcheck_output="$(shellcheck --version)"; then
    printf 'quality: unable to read ShellCheck version from %s\n' "$shellcheck_path" >&2
    exit 1
  fi
  shellcheck_version="$(printf '%s\n' "$shellcheck_output" | sed -n 's/^version: //p')"
  if [ "$shellcheck_version" != "0.11.0" ]; then
    printf 'quality: ShellCheck 0.11.0 is required on PATH; found %s at %s\n' "${shellcheck_version:-unknown}" "$shellcheck_path" >&2
    exit 1
  fi
}

check_policy() {
  require_cmd bun
  require_shellcheck
  log "diff"
  if [ -n "${QUALITY_DIFF_BASE:-}" ]; then
    git diff --no-renames --check "$QUALITY_DIFF_BASE"...HEAD
  else
    git diff --no-renames --check HEAD
  fi

  log "shell and source lint"
  git ls-files --cached --others --exclude-standard -- '*.sh' | while IFS= read -r file; do
    [ -f "$file" ] || continue
    sh -n "$file"
    shellcheck --severity=warning -e SC1007 "$file"
  done
  bun run lint

  log "security and machine interfaces"
  bun scripts/check-secrets.ts
  bun scripts/toolset.ts --validate
  bun test ./scripts/check-workspace-contracts.test.ts ./scripts/check-workspace-side-effects.test.ts
}

check_packages() {
  require_cmd bun
  log "package contracts"
  if [ -n "${QUALITY_PACKAGE_SHARD:-}" ]; then
    bun scripts/check-workspace-contracts.ts --run-shard "$QUALITY_PACKAGE_SHARD"
  else
    bun scripts/check-workspace-contracts.ts --run-all
  fi
}

check_native() {
  if git ls-files --cached --others --exclude-standard -- '**/go.mod' | grep -q .; then
    require_cmd go
    git ls-files --cached --others --exclude-standard -- '**/go.mod' | while IFS= read -r manifest; do
      [ -f "$manifest" ] || continue
      sh scripts/check-native-package.sh go "$(dirname "$manifest")"
    done
  fi

  if git ls-files --cached --others --exclude-standard -- '**/Cargo.toml' | grep -q .; then
    require_cmd cargo
    git ls-files --cached --others --exclude-standard -- '**/Cargo.toml' | while IFS= read -r manifest; do
      [ -f "$manifest" ] || continue
      sh scripts/check-native-package.sh rust "$(dirname "$manifest")"
    done
  fi

  python_cmd="$(sh scripts/resolve-python.sh)"
  python_files="$(git ls-files --cached --others --exclude-standard -- '**/*.py')"
  if [ -n "$python_files" ]; then
    printf '%s\n' "$python_files" | while IFS= read -r file; do
      [ -f "$file" ] || continue
      "$python_cmd" -B -m py_compile "$file"
      case "${file##*/}" in
        test*.py) "$python_cmd" -B -W error "$file" ;;
      esac
    done
  fi
}

case "$QUALITY_SCOPE" in
  all)
    check_policy
    check_packages
    check_native
    ;;
  policy) check_policy ;;
  packages) check_packages ;;
  native) check_native ;;
esac

log "$QUALITY_SCOPE ok"
