#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SKILLS_DIR="$ROOT_DIR/.agents/skills"

for cmd_dir in "$ROOT_DIR"/cmd/*; do
  [ -d "$cmd_dir" ] || continue
  name="$(basename "$cmd_dir")"
  target_dir="$SKILLS_DIR/$name/scripts"
  target_path="$target_dir/$name"
  mkdir -p "$target_dir"
  if [ -f "$cmd_dir/main.ts" ]; then
    dist_dir="$ROOT_DIR/dist/$name"
    rm -rf "$dist_dir"
    "$ROOT_DIR/node_modules/.bin/ncc" build "$cmd_dir/main.ts" -o "$dist_dir" >/dev/null
    mv "$dist_dir/index.js" "$dist_dir/cli.js"
    chmod +x "$dist_dir/cli.js"
    cp "$dist_dir/cli.js" "$target_path"
    chmod +x "$target_path"
    continue
  fi
  (
    cd "$ROOT_DIR"
    go build -o "$target_path" "./cmd/$name"
  )
done
