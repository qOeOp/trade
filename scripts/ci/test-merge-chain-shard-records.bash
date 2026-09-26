#!/usr/bin/env bash
# Drives merge-chain-shard-records.bash over fixture shard directories: disjoint shards merge with
# every file in place; an entry two shards both recorded, a shard with nothing and no shards at all
# are each refused by name. A merge that silently kept one copy of a duplicate passes the first case
# and fails the second.
set -euo pipefail
while IFS='=' read -r name _; do case "$name" in GIT_*) unset "$name" ;; esac done < <(env)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MERGER="${MERGE_CHAIN_SHARD_RECORDS_SCRIPT:-${SCRIPT_DIR}/merge-chain-shard-records.bash}"
root="$(mktemp -d)"
trap 'rm -rf "$root"' EXIT

shard() { # case, shard name, positions...
  local dir="${root}/$1/in/$2"
  shift 2
  mkdir -p "$dir"
  for position in "$@"; do
    printf '<testsuites/>\n' > "$(printf '%s/%03d.xml' "$dir" "$position")"
    printf 'log %s\n' "$position" > "$(printf '%s/%03d.log' "$dir" "$position")"
  done
}

run_case() { # case, expected exit, expected output fragment
  local status=0
  bash "$MERGER" "${root}/$1/in" "${root}/$1/out" > "${root}/$1.out" 2>&1 || status=$?
  if [[ "$status" -ne "$2" ]] || ! grep -qF -- "$3" "${root}/$1.out"; then
    echo "FAIL: $1: expected exit $2 with '$3', got ${status}:" >&2
    cat "${root}/$1.out" >&2
    exit 1
  fi
}

shard complete shard-1 1 3 && shard complete shard-2 2 4 5
run_case complete 0 "merged 2 shard(s): 5 entry record(s)"
[[ "$(cat "${root}/complete/out/004.log")" == "log 4" ]] || {
  echo "FAIL: complete: 004.log was not copied from its shard." >&2
  exit 1
}

shard duplicate shard-1 1 2 && shard duplicate shard-2 2 3
run_case duplicate 1 "002.log was recorded by both shard-1 and shard-2."

shard empty shard-1 1 2 3 && mkdir -p "${root}/empty/in/shard-2"
run_case empty 1 "shard shard-2 uploaded no records."

mkdir -p "${root}/none/in"
run_case none 1 "no shard records under"

echo "merge-chain-shard-records: merges disjoint shards, refuses duplicates and empty shards by name"
