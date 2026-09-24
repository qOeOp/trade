#!/usr/bin/env bash
# Runs check-security-definer-search-path.sql in every connectable database of one chain container
# and says what it checked.
#
# Usage: run-security-definer-guard.bash <container> <database>...
#
# The databases named are every one the calling chain created, plus `postgres`. The guard scans
# what the server actually holds and fails when that set differs from the named one, and when the
# scan checked no routine at all: a pass has to read something, so it cannot be mistaken for a
# guard that never ran or found nothing to look at.
set -euo pipefail

if (($# < 2)); then
  echo "usage: $0 <container> <database>..." >&2
  exit 2
fi
container="$1"
shift

guard_sql="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/check-security-definer-search-path.sql"
expected_databases="$(printf '%s\n' "$@" | LC_ALL=C sort)"
scanned_databases="$(docker exec "$container" psql --username postgres --dbname postgres -Atqc \
  "SELECT datname FROM pg_catalog.pg_database WHERE NOT datistemplate AND datallowconn" | LC_ALL=C sort)"

if [[ "$scanned_databases" != "$expected_databases" ]]; then
  echo "ERROR: security-definer search_path: the server holds a different set of databases than this chain created" >&2
  echo "  created: $(tr '\n' ' ' <<< "$expected_databases")" >&2
  echo "  scanned: $(tr '\n' ' ' <<< "$scanned_databases")" >&2
  exit 1
fi

checked_routines=0
allowlisted_routines=0
checked_databases=0

while IFS= read -r database; do
  counts="$(docker exec --interactive "$container" psql --quiet --no-align --tuples-only \
    --set ON_ERROR_STOP=1 --username postgres --dbname "$database" < "$guard_sql")"

  if [[ ! "$counts" =~ ^([0-9]+)\ ([0-9]+)$ ]]; then
    echo "ERROR: security-definer search_path: database ${database} answered '${counts}', not '<checked> <allowlisted>'" >&2
    exit 1
  fi
  checked_routines=$((checked_routines + BASH_REMATCH[1]))
  allowlisted_routines=$((allowlisted_routines + BASH_REMATCH[2]))
  checked_databases=$((checked_databases + 1))
done <<< "$scanned_databases"

echo "security-definer search_path: checked ${checked_routines} functions (${allowlisted_routines} allowlisted) in ${checked_databases} databases"

if ((checked_routines == 0)); then
  echo "ERROR: security-definer search_path: no SECURITY DEFINER routine in any database; the guard read nothing" >&2
  exit 1
fi
