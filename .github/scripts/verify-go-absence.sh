#!/usr/bin/env bash
set -euo pipefail

go_paths_file=$(mktemp)
trap 'rm -f "$go_paths_file"' EXIT

if ! git ls-files -z -- \
    ':(glob)**/*.go' \
    ':(glob)**/go.mod' \
    ':(glob)**/go.sum' \
    ':(glob)**/go.work' \
    ':(glob)**/go.work.sum' >"$go_paths_file"; then
  printf 'Failed to inventory tracked paths for Go absence proof.\n' >&2
  exit 1
fi

if [[ -s "$go_paths_file" ]]; then
  if ! IFS= read -r -d '' go_path <"$go_paths_file"; then
    printf 'Tracked Go inventory was not NUL-delimited.\n' >&2
    exit 1
  fi
  printf 'Go is present but is not covered by CodeQL: %q\n' "$go_path" >&2
  exit 1
fi

printf 'Verified tracked repository content has no Go source or module/workspace manifest.\n'
