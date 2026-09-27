#!/usr/bin/env bash
# Drives merge-chain-shard-records.bash over fixture shard directories and a shard list: disjoint
# shards merge with every file in place; an entry two shards both recorded, a listed shard with no
# records (named, all of them) and records from a shard the list does not name are each refused. A
# merge that silently kept one copy of a duplicate passes the first case and fails the second.
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

printf '# header\nshard-1\tc\tt1\t-\nshard-2\tc\tt2\tnode\nshard-1\tc\tt3\tbrowser\n' > "${root}/shards.tsv"

run_case() { # case, expected exit, expected output fragment, then any selected shards
  local status=0
  bash "$MERGER" "${root}/$1/in" "${root}/$1/out" "${root}/shards.tsv" "${@:4}" > "${root}/$1.out" 2>&1 || status=$?
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
run_case empty 1 "no records from shard-2 (of 2 shards)"

mkdir -p "${root}/none/in"
run_case none 1 "no records from shard-1 shard-2 (of 2 shards)"

shard stray shard-1 1 && shard stray shard-2 2 && shard stray shard-9 3
run_case stray 1 "records from shard-9, which"

# A partial run: only the selected shard is expected, a shard it did not select is refused, and a
# selection naming a shard the list does not is refused.
shard partial shard-2 2 4
run_case partial 0 "merged 1 shard(s): 2 entry record(s)" shard-2
shard partial-stray shard-1 1 && shard partial-stray shard-2 2
run_case partial-stray 1 "records from shard-1, which this partial run did not select" shard-2
shard partial-unlisted shard-2 2
run_case partial-unlisted 1 "the selection names shard-7" shard-7

echo "merge-chain-shard-records: merges the listed or selected shards, refuses duplicates, missing, unlisted and unselected shards by name"
