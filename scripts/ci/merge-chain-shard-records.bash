#!/usr/bin/env bash
# Merge the R&D chain's per-shard records into the one directory the whole chain would have written.
#
# Each shard uploads its target/nextest/chain-records/ as an artifact; the aggregate job downloads
# them into one directory per shard. Records are named by the entry's global position (NNN.xml,
# NNN.log, NNN.timeout), so shards never name the same file unless they ran the same entry. This
# refuses that by name - two shards that both ran an entry is a broken shard list, not a record to
# pick from - and, given the chain's entry count, refuses a position no shard recorded.
#
# Usage: merge-chain-shard-records.bash <shard records root> <merged dir> [expected entry count]
#   <shard records root>/<shard name>/NNN.* for every shard that ran.
set -Eeuo pipefail
trap 'echo "merge-chain-shard-records.bash:${LINENO}: this failed: ${BASH_COMMAND}" >&2' ERR

root="${1:?shard records root}"
merged="${2:?merged directory}"
expected="${3:-}"

shopt -s nullglob
shards=("$root"/*/)
if [[ ${#shards[@]} -eq 0 ]]; then
  echo "ERROR: no shard records under ${root}." >&2
  exit 1
fi
mkdir -p -- "$merged"
declare -A owner=()
conflicts=0
for shard_dir in "${shards[@]}"; do
  shard="$(basename -- "$shard_dir")"
  files=("$shard_dir"*)
  if [[ ${#files[@]} -eq 0 ]]; then
    echo "ERROR: shard ${shard} uploaded no records." >&2
    conflicts=1
    continue
  fi
  for file in "${files[@]}"; do
    name="$(basename -- "$file")"
    if [[ -n "${owner[$name]:-}" ]]; then
      echo "ERROR: ${name} was recorded by both ${owner[$name]} and ${shard}." >&2
      conflicts=1
      continue
    fi
    owner[$name]="$shard"
    cp -- "$file" "${merged}/${name}"
  done
done
[[ "$conflicts" -eq 0 ]] || exit 1

xml=("$merged"/*.xml)
echo "merged ${#shards[@]} shard(s): ${#xml[@]} entry record(s) in ${merged}"
if [[ -n "$expected" ]]; then
  missing=()
  for ((position = 1; position <= expected; position++)); do
    [[ -e "$(printf '%s/%03d.xml' "$merged" "$position")" ]] || missing+=("$position")
  done
  if [[ ${#missing[@]} -gt 0 ]]; then
    echo "ERROR: no shard recorded entr$([[ ${#missing[@]} -eq 1 ]] && echo y || echo ies)" \
      "${missing[*]} of ${expected}." >&2
    exit 1
  fi
  if [[ ${#xml[@]} -ne "$expected" ]]; then
    echo "ERROR: ${#xml[@]} entry records for a chain of ${expected}." >&2
    exit 1
  fi
fi
