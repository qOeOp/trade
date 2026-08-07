#!/usr/bin/env bash
set -euo pipefail

title=${1-}
pattern='^[[:alnum:]][[:alnum:]._-]*\([^()]+\)!?: .+'
if [[ ! "$title" =~ $pattern ]]; then
  printf 'pull request title must use Conventional Commits: type(scope): description\n' >&2
  exit 1
fi
