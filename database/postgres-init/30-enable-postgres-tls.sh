#!/bin/sh
# Turns on TLS for the deployment's PostgreSQL, so Deployment Store Admission can measure and read
# the Market Data store over a connection pinned to the deployment's own root.
#
# Run once by the `postgres-tls-install` service, and again to rotate the certificate. It copies the
# server certificate and key from /run/postgres-tls into the data volume, owned by the server's user
# with the key at mode 0600, which PostgreSQL requires and a bind mount cannot give. It then sets
# the three settings with ALTER SYSTEM, which persists them in the data directory, reloads, and
# refuses to finish until a TLS session is admitted. Every other connection in the stack states
# plaintext and is admitted as before.
set -eu

: "${POSTGRES_PASSWORD:?set POSTGRES_PASSWORD}"
tls_source=/run/postgres-tls
data_directory=/var/lib/postgresql/data

for file in server.crt server.key; do
  if [ ! -f "$tls_source/$file" ]; then
    echo "postgres-tls-install: $tls_source/$file is missing" >&2
    exit 1
  fi
done
install -o postgres -g postgres -m 0644 "$tls_source/server.crt" "$data_directory/server.crt"
install -o postgres -g postgres -m 0600 "$tls_source/server.key" "$data_directory/server.key"

export PGPASSWORD="$POSTGRES_PASSWORD"
host="${POSTGRES_HOST:-postgres}"

for setting in \
  "ssl_cert_file = '$data_directory/server.crt'" \
  "ssl_key_file = '$data_directory/server.key'" \
  "ssl = on"; do
  psql --set=ON_ERROR_STOP=1 --host "$host" --username postgres --dbname postgres \
    --command "ALTER SYSTEM SET $setting" > /dev/null
done
psql --set=ON_ERROR_STOP=1 --host "$host" --username postgres --dbname postgres \
  --tuples-only --command "SELECT pg_catalog.pg_reload_conf()" > /dev/null

# A reload is asynchronous: wait for a TLS session, and fail here if none is ever admitted.
attempt=0
while [ "$attempt" -lt 20 ]; do
  ssl=$(psql "host=$host user=postgres dbname=postgres sslmode=require" --tuples-only --no-align \
    --command "SELECT ssl FROM pg_catalog.pg_stat_ssl WHERE pid = pg_catalog.pg_backend_pid()" \
    2> /dev/null || true)

  if [ "$ssl" = "t" ]; then
    echo "postgres-tls-install: the server admits TLS sessions"
    exit 0
  fi
  attempt=$((attempt + 1))
  sleep 1
done
echo "postgres-tls-install: the server never admitted a TLS session" >&2
exit 1
