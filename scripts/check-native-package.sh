#!/usr/bin/env sh

set -eu

ROOT="$(CDPATH='' cd -- "$(dirname "$0")/.." && pwd)"
kind="${1:-}"
dir="${2:-}"

if [ "$#" -ne 2 ] || [ ! -d "$ROOT/$dir" ]; then
  printf 'usage: scripts/check-native-package.sh <go|python|rust> <repo-relative-package-dir>\n' >&2
  exit 2
fi

case "$kind" in
  go)
    sh "$ROOT/scripts/check-go-format.sh" "$ROOT/$dir"
    (cd "$ROOT/$dir" && go test ./... && go vet ./...)
    ;;
  python)
    python_cmd="$(sh "$ROOT/scripts/resolve-python.sh")"
    "$python_cmd" -m compileall -q "$ROOT/$dir/scripts"
    (cd "$ROOT/$dir" && "$python_cmd" -W error -m unittest discover -s scripts -p 'test*.py')
    find "$ROOT/$dir" -type d -name __pycache__ -prune -exec rm -rf {} +
    ;;
  rust)
    (cd "$ROOT/$dir" && cargo fmt --all -- --check)
    (cd "$ROOT/$dir" && cargo check)
    (cd "$ROOT/$dir" && cargo clippy --all-targets -- -D warnings)
    (cd "$ROOT/$dir" && cargo test)
    ;;
  *)
    printf 'unsupported native package kind: %s\n' "$kind" >&2
    exit 2
    ;;
esac
