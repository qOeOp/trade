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
  (
    cd "$ROOT_DIR"
    go build -o "$target_path" "./cmd/$name"
  )
done
