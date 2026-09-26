#!/usr/bin/env bash
# Merge the R&D chain's per-shard records into the one directory the whole chain would have written.
#
# Each shard uploads its target/nextest/chain-records/ as an artifact; the aggregate job downloads
# them into one directory per shard. Records are named by the entry's global position (NNN.xml,
# NNN.log, NNN.timeout), so shards never name the same file unless they ran the same entry. This
# refuses that by name - two shards that both ran an entry is a broken shard list, not a record to
# pick from. It is the one check the report cannot make: `test-rd-owner-postgres.bash
# --report-records` reads the merged directory, where the second copy has already replaced the
# first. Completeness is the report's: it requires every position of the chain, run as recorded.
#
# Every shard the list names must have uploaded records, and nothing else may have: a shard that died
# before its first entry uploads nothing, and is named here rather than folded into a count.
#
# Usage: merge-chain-shard-records.bash <shard records root> <merged dir> <shard list tsv>
#   <shard records root>/<shard name>/NNN.* per shard; the list is scripts/ci/rd-owner-chain-shards.tsv.
set -Eeuo pipefail
trap 'echo "merge-chain-shard-records.bash:${LINENO}: this failed: ${BASH_COMMAND}" >&2' ERR

root="${1:?shard records root}"
merged="${2:?merged directory}"
list="${3:?shard list}"

shopt -s nullglob
mapfile -t expected < <(grep -v '^#' "$list" | cut -f1 | sed '/^$/d' | sort -u)
if [[ ${#expected[@]} -eq 0 ]]; then
  echo "ERROR: ${list} names no shards." >&2
  exit 1
fi
mkdir -p -- "$merged"
declare -A owner=()
conflicts=0
missing=()
for shard in "${expected[@]}"; do
  files=("${root}/${shard}"/*)
  if [[ ${#files[@]} -eq 0 ]]; then
    missing+=("$shard")
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
if [[ ${#missing[@]} -gt 0 ]]; then
  echo "ERROR: no records from ${missing[*]} (of ${#expected[@]} shards): each died before its first" \
    "entry, or never ran. Their own job logs say why." >&2
  conflicts=1
fi
for dir in "$root"/*/; do
  shard="$(basename -- "$dir")"
  if [[ " ${expected[*]} " != *" ${shard} "* ]]; then
    echo "ERROR: records from ${shard}, which ${list} does not name." >&2
    conflicts=1
  fi
done
[[ "$conflicts" -eq 0 ]] || exit 1

xml=("$merged"/*.xml)
echo "merged ${#expected[@]} shard(s): ${#xml[@]} entry record(s) in ${merged}"
