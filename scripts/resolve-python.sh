#!/usr/bin/env sh

set -eu

if command -v python3 >/dev/null 2>&1; then
  printf 'python3\n'
  exit 0
fi

if command -v python >/dev/null 2>&1; then
  printf 'python\n'
  exit 0
fi

printf 'no python interpreter found\n' >&2
exit 1
