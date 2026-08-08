#!/usr/bin/env bash
set -euo pipefail

title=${1-}
pattern='^[a-z][a-z0-9-]*\([a-z0-9][a-z0-9._/-]*\)!?: .+$'
description=${title#*: }

if [[ "$title" =~ [[:cntrl:]] ]] ||
  [[ ! "$title" =~ $pattern ]] ||
  [[ "$description" == [[:space:]]* ]] ||
  [[ "$description" == *[[:space:]] ]]; then
  printf 'pull request title must use lowercase type(scope)!?: description without boundary whitespace\n' >&2
  exit 1
fi
