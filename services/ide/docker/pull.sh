#!/bin/sh
# trade-ide-pull ledger|market: fast-forward the copy's main from its public DoltHub copy.
# Exit status 3: the public copy's history no longer descends from this copy; nothing is reset.
set -u
case "${1:-}" in
  ledger) database=research ;;
  market) database=market ;;
  *) echo "usage: trade-ide-pull ledger|market" >&2; exit 2 ;;
esac
output=$(dolt --host 127.0.0.1 --port 3306 --no-tls --user root --password "$(cat /data/dolt/admin.password)" \
  --use-db "$database" sql -q "CALL DOLT_PULL('origin', 'main', '--ff-only')" 2>&1) && exit 0
echo "$output" >&2
case "$output" in
  *fast-forward*|*"non-fast-forward"*) exit 3 ;;
esac
exit 1
