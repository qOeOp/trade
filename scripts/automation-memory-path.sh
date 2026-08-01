#!/usr/bin/env sh

set -eu

if [ "$#" -ne 1 ]; then
  printf 'usage: %s <automation-id>\n' "$0" >&2
  exit 1
fi

automation_id="$1"
codex_home="${CODEX_HOME:-.codex}"

printf '%s/automations/%s/memory.md\n' "$codex_home" "$automation_id"
