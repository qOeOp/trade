#!/bin/sh
set -eu

# Market Data's admitted reader: the one principal a Deployment Store Admission leases to read the
# Market Data store. It logs in, inherits nothing, holds no role membership in either direction,
# and may connect to the database. That is all this script grants it.
#
# Everything it may read is granted by the Market Data Owner's own migration, which creates the
# SECURITY DEFINER wrappers in market_data_admitted_read and, when this role exists, grants it USAGE
# on that schema and EXECUTE on every function in it. The wrappers exist only after that migration
# runs, so the grant cannot live here; a reader provisioned after the migration last ran gains it
# the next time the Owner migrates. Nothing is ever granted to it on market_data_private.
#
# Idempotent, and safe to run once per database: the role is cluster-wide, CONNECT is granted on
# the database named by POSTGRES_DATABASE.

: "${MARKET_DATA_ADMITTED_READER_DB_PASSWORD:?set MARKET_DATA_ADMITTED_READER_DB_PASSWORD}"
export PGPASSWORD="$POSTGRES_PASSWORD"
psql --set=ON_ERROR_STOP=1 --host "${POSTGRES_HOST:-postgres}" --username postgres --dbname "${POSTGRES_DATABASE:-rd_owner}" \
  --set=reader_password="$MARKET_DATA_ADMITTED_READER_DB_PASSWORD" << 'SQL'
BEGIN;
SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('vibe.market-data-admitted-reader.v1',0)
);
LOCK TABLE pg_catalog.pg_authid, pg_catalog.pg_auth_members IN SHARE ROW EXCLUSIVE MODE;
DO $role$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'market_data_admitted_reader') THEN CREATE ROLE market_data_admitted_reader NOLOGIN; END IF;
END
$role$;
ALTER ROLE market_data_admitted_reader LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD :'reader_password';
-- No membership in or of the reader: it is exactly what it is granted.
DO $memberships$
DECLARE
  membership record;
BEGIN
  FOR membership IN
    SELECT granted.rolname AS role_name, member.rolname AS member_name
    FROM pg_catalog.pg_auth_members AS edge
    JOIN pg_catalog.pg_roles AS granted ON granted.oid = edge.roleid
    JOIN pg_catalog.pg_roles AS member ON member.oid = edge.member
    WHERE granted.rolname = 'market_data_admitted_reader' OR member.rolname = 'market_data_admitted_reader'
  LOOP
    EXECUTE pg_catalog.format('REVOKE %I FROM %I', membership.role_name, membership.member_name);
  END LOOP;
  EXECUTE pg_catalog.format(
    'GRANT CONNECT ON DATABASE %I TO market_data_admitted_reader',
    pg_catalog.current_database()
  );
END
$memberships$;
COMMIT;
SQL
