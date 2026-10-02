#!/usr/bin/env bash
# LANE8 PROBE, NOT FOR MERGE: how large the member test and binary executables rust-cache drops are.
set -uo pipefail
deps="${CARGO_TARGET_DIR:?}/ci-pr/deps"
list="$(mktemp)"
find "$deps" -maxdepth 1 -type f -perm -u+x ! -name '*.*' ! -name 'lib*' > "$list"
count="$(wc -l < "$list")"
bytes="$(xargs -a "$list" stat -c %s | awk '{s += $1} END {print s + 0}')"
compressed="$(tar -cf - -T "$list" 2> /dev/null | zstd -T0 --long=30 -q -c | wc -c)"
echo "LANE8-X member executables in ci-pr/deps: ${count}, ${bytes} bytes, ${compressed} bytes as zstd --long=30"
xargs -a "$list" stat -c '%s %n' | sort -rn | head -10 | sed 's/^/LANE8-X largest /'
rm -f "$list"
