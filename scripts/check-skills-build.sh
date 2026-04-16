#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

cd "$ROOT_DIR"
"$ROOT_DIR/scripts/build-skills.sh"

artifacts=()
for cmd_dir in "$ROOT_DIR"/cmd/*; do
  [ -d "$cmd_dir" ] || continue
  name="$(basename "$cmd_dir")"
  artifacts+=(".agents/skills/$name/scripts/$name")
done

[ "${#artifacts[@]}" -gt 0 ] || exit 0

status="$(git status --short -- "${artifacts[@]}")"
[ -z "$status" ] && exit 0

printf '%s\n' "Generated skill artifacts are out of date. Rebuild and commit the updated files before pushing." >&2
printf '%s\n' "$status" >&2
exit 1
