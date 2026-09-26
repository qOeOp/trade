#!/usr/bin/env bash
# Exercise `test-rd-owner-postgres.bash --entry-count`, the N a caller compares with a report's
# "all N entries passed":
# - it equals the number of entries in the chain array;
# - it follows the array when an entry is added or removed, so it counts the array rather than
#   answering a constant;
# - it answers with nothing but bash on PATH, since its callers include jobs without rg or python.
#
# Run: bash scripts/ci/test-chain-entry-count.bash
set -Eeuo pipefail
trap 'echo "test-chain-entry-count.bash:${LINENO}: this failed: ${BASH_COMMAND}" >&2' ERR

chain="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/test-rd-owner-postgres.bash"
scratch="$(mktemp -d)"
trap 'rm -rf -- "$scratch"' EXIT

# The entries as the array spells them, counted between its opening line and its closing `)`.
array_entries() {
  awk '/^readonly rd_owner_postgres_tests=\($/ { inside = 1; next }
       inside && /^\)$/ { exit }
       inside && /^  \x27[^|]+\|[^|]+\|[^|]+\x27$/ { count++ }
       END { print count + 0 }' "$1"
}

# Only bash on PATH: an answer that needed rg, python or docker would fail here.
mkdir -p "$scratch/bin"
ln -s "$BASH" "$scratch/bin/bash"
entry_count() {
  env -i PATH="$scratch/bin" bash "$1" --entry-count
}

expected="$(array_entries "$chain")"
actual="$(entry_count "$chain")"
if [[ "$expected" -lt 1 || "$actual" != "$expected" ]]; then
  echo "FAIL: --entry-count answered ${actual}; the chain array holds ${expected} entries." >&2
  exit 1
fi

# One more entry, then one fewer: the answer must move with the array both ways.
added="$scratch/added.bash"
awk '{ print } /^readonly rd_owner_postgres_tests=\($/ { print "  \x27probe|probe|probe::added_entry\x27" }' \
  "$chain" > "$added"
removed="$scratch/removed.bash"
awk '/^readonly rd_owner_postgres_tests=\($/ { print; getline; next } { print }' "$chain" > "$removed"
if [[ "$(entry_count "$added")" != "$((expected + 1))" ]] ||
  [[ "$(entry_count "$removed")" != "$((expected - 1))" ]]; then
  echo "FAIL: --entry-count does not follow the chain array when an entry is added or removed." >&2
  exit 1
fi

echo "chain-entry-count: answers the chain array's ${expected} entries with only bash on PATH, and follows an added or removed entry"
