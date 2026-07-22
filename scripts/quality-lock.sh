#!/usr/bin/env sh

set -eu

action="${1:-}"
lock_dir="${2:-}"
owner_pid="${3:-}"

case "$lock_dir" in
  ""|"/"|".")
    printf 'quality: explicit narrow lock directory is required\n' >&2
    exit 1
    ;;
esac
case "$owner_pid" in
  ""|*[!0-9]*)
    printf 'quality: numeric lock owner pid is required\n' >&2
    exit 1
    ;;
esac

owner_file="$lock_dir/owner-pid"

acquire() {
  mkdir -p "$(dirname "$lock_dir")"
  if mkdir "$lock_dir" 2>/dev/null; then
    printf '%s\n' "$owner_pid" > "$owner_file"
    return 0
  fi

  current_owner="$(sed -n '1p' "$owner_file" 2>/dev/null || true)"
  case "$current_owner" in
    ""|*[!0-9]*) ;;
    *)
      if kill -0 "$current_owner" 2>/dev/null; then
        printf 'quality: another repository quality check is active (pid %s)\n' "$current_owner" >&2
        return 1
      fi
      ;;
  esac

  rm -f "$owner_file"
  rmdir "$lock_dir" 2>/dev/null || {
    printf 'quality: stale quality lock cannot be recovered safely: %s\n' "$lock_dir" >&2
    return 1
  }
  mkdir "$lock_dir"
  printf '%s\n' "$owner_pid" > "$owner_file"
}

release() {
  current_owner="$(sed -n '1p' "$owner_file" 2>/dev/null || true)"
  if [ "$current_owner" != "$owner_pid" ]; then
    return 0
  fi
  rm -f "$owner_file"
  rmdir "$lock_dir" 2>/dev/null || true
}

case "$action" in
  acquire) acquire ;;
  release) release ;;
  *)
    printf 'usage: quality-lock.sh <acquire|release> <lock-dir> <owner-pid>\n' >&2
    exit 1
    ;;
esac
