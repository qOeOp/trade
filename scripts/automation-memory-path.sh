#!/usr/bin/env sh

set -eu

if [ "$#" -ne 1 ]; then
  printf 'usage: %s <automation-id>\n' "$0" >&2
  exit 1
fi

automation_id="$1"
codex_home="$(sh "$(dirname "$0")/resolve-codex-home.sh")"

printf '%s/automations/%s/memory.md\n' "$codex_home" "$automation_id"
