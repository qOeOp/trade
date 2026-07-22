#!/usr/bin/env sh

set -eu

ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
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
sh "$ROOT/scripts/quality-lock.sh" acquire "$lock_dir" "$$"
release_test_lock() {
  sh "$ROOT/scripts/quality-lock.sh" release "$lock_dir" "$$"
}
trap release_test_lock EXIT HUP INT TERM

"$@"
