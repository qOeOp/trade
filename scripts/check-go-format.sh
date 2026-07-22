#!/usr/bin/env sh

set -eu

directory="${1:-}"
if [ -z "$directory" ] || [ ! -d "$directory" ]; then
  printf 'quality: Go format check requires a module directory\n' >&2
  exit 1
fi

unformatted="$(find "$directory" -name '*.go' -type f -exec gofmt -l {} +)"
if [ -n "$unformatted" ]; then
  printf 'quality: gofmt required:\n%s\n' "$unformatted" >&2
  exit 1
fi
