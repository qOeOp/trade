#!/usr/bin/env sh

set -eu

ROOT="$(git rev-parse --show-toplevel)"
lock_name="${1:-}"
case "$lock_name" in
  ""|*[!a-z0-9-]*)
    printf 'quality: exclusive test lock name must use lowercase ASCII and hyphens\n' >&2
    exit 1
    ;;
esac
shift
if [ "$#" -eq 0 ]; then
  printf 'quality: exclusive test command is required\n' >&2
  exit 1
fi

lock_dir="$ROOT/tmp/check/test-locks/$lock_name.lock"
owner_file="$lock_dir/owner-pid"

mkdir -p "$(dirname "$lock_dir")"
if ! mkdir "$lock_dir" 2>/dev/null; then
  current_owner="$(sed -n '1p' "$owner_file" 2>/dev/null || true)"
  case "$current_owner" in
    ""|*[!0-9]*) ;;
    *)
      if kill -0 "$current_owner" 2>/dev/null; then
        printf 'quality: exclusive test is already active (pid %s)\n' "$current_owner" >&2
        exit 1
      fi
      ;;
  esac
  rm -f "$owner_file"
  rmdir "$lock_dir" 2>/dev/null || {
    printf 'quality: stale exclusive test lock cannot be recovered safely\n' >&2
    exit 1
  }
  mkdir "$lock_dir"
fi
printf '%s\n' "$$" > "$owner_file"

release_test_lock() {
  current_owner="$(sed -n '1p' "$owner_file" 2>/dev/null || true)"
  if [ "$current_owner" = "$$" ]; then
    rm -f "$owner_file"
    rmdir "$lock_dir" 2>/dev/null || true
  fi
}
trap release_test_lock EXIT HUP INT TERM

"$@"
