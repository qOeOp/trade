#!/bin/sh
set -eu

# Market Data's Deployment Store Admission custody: the signed append-only store manifests, one
# signed current head per scope, and the immutable admission receipts. It is kept apart from every
# store it admits: custody that lived inside the measured target would change its own measurement,
# and would share that target's owner credential.
#
# Two login principals and no third. The publisher only appends a signed manifest and advances the
# head; it runs on the administrator's side, never in the tested process. The custodian only reads
# history, reads the store clock, and records receipts. Neither holds a table privilege: every
# access is one of the SECURITY DEFINER functions below.
#
# Idempotent, and safe to run once per database: roles are cluster-wide, everything else is created
# in the database named by POSTGRES_DATABASE.

: "${DEPLOYMENT_STORE_PUBLISHER_DB_PASSWORD:?set DEPLOYMENT_STORE_PUBLISHER_DB_PASSWORD}"
: "${DEPLOYMENT_STORE_CUSTODIAN_DB_PASSWORD:?set DEPLOYMENT_STORE_CUSTODIAN_DB_PASSWORD}"
export PGPASSWORD="$POSTGRES_PASSWORD"
psql --set=ON_ERROR_STOP=1 --host "${POSTGRES_HOST:-postgres}" --username postgres --dbname "${POSTGRES_DATABASE:-rd_owner}" \
  --set=publisher_password="$DEPLOYMENT_STORE_PUBLISHER_DB_PASSWORD" \
  --set=custodian_password="$DEPLOYMENT_STORE_CUSTODIAN_DB_PASSWORD" << 'SQL'
BEGIN;
SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('vibe.deployment-store-custody.v1',0)
);
LOCK TABLE pg_catalog.pg_authid, pg_catalog.pg_auth_members IN SHARE ROW EXCLUSIVE MODE;
DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'deployment_store_custody_owner') THEN CREATE ROLE deployment_store_custody_owner NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'deployment_store_publisher') THEN CREATE ROLE deployment_store_publisher NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'deployment_store_custodian') THEN CREATE ROLE deployment_store_custodian NOLOGIN; END IF;
END
$roles$;
ALTER ROLE deployment_store_custody_owner NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE deployment_store_publisher LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD :'publisher_password';
ALTER ROLE deployment_store_custodian LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD :'custodian_password';
-- No membership in or of any custody role: each principal is exactly what it is granted below.
DO $memberships$
DECLARE
  membership record;
BEGIN
  FOR membership IN
    SELECT granted.rolname AS role_name, member.rolname AS member_name
    FROM pg_catalog.pg_auth_members AS edge
    JOIN pg_catalog.pg_roles AS granted ON granted.oid = edge.roleid
    JOIN pg_catalog.pg_roles AS member ON member.oid = edge.member
    WHERE granted.rolname IN ('deployment_store_custody_owner','deployment_store_publisher','deployment_store_custodian')
       OR member.rolname IN ('deployment_store_custody_owner','deployment_store_publisher','deployment_store_custodian')
  LOOP
    EXECUTE pg_catalog.format('REVOKE %I FROM %I', membership.role_name, membership.member_name);
  END LOOP;
  EXECUTE pg_catalog.format(
    'GRANT CONNECT ON DATABASE %I TO deployment_store_publisher, deployment_store_custodian',
    pg_catalog.current_database()
  );
END
$memberships$;

CREATE SCHEMA IF NOT EXISTS deployment_store_custody_private AUTHORIZATION deployment_store_custody_owner;
CREATE SCHEMA IF NOT EXISTS deployment_store_custody_api AUTHORIZATION deployment_store_custody_owner;
ALTER SCHEMA deployment_store_custody_private OWNER TO deployment_store_custody_owner;
ALTER SCHEMA deployment_store_custody_api OWNER TO deployment_store_custody_owner;
REVOKE ALL ON SCHEMA deployment_store_custody_private, deployment_store_custody_api FROM PUBLIC, deployment_store_publisher, deployment_store_custodian;
GRANT USAGE ON SCHEMA deployment_store_custody_api TO deployment_store_publisher, deployment_store_custodian;

SET LOCAL ROLE deployment_store_custody_owner;

CREATE TABLE IF NOT EXISTS deployment_store_custody_private.manifests_v1 (
  environment_identity TEXT NOT NULL,
  deployment_identity TEXT NOT NULL,
  consumer_owner TEXT NOT NULL,
  consumer_identity TEXT NOT NULL,
  backend TEXT NOT NULL,
  generation BIGINT NOT NULL CHECK (generation >= 1),
  manifest_identity TEXT NOT NULL UNIQUE,
  manifest_bytes BYTEA NOT NULL,
  signer_identity TEXT NOT NULL,
  signature BYTEA NOT NULL,
  published_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (environment_identity, deployment_identity, consumer_owner, consumer_identity, backend, generation)
);
CREATE TABLE IF NOT EXISTS deployment_store_custody_private.heads_v1 (
  environment_identity TEXT NOT NULL,
  deployment_identity TEXT NOT NULL,
  consumer_owner TEXT NOT NULL,
  consumer_identity TEXT NOT NULL,
  backend TEXT NOT NULL,
  head_identity TEXT NOT NULL,
  generation BIGINT NOT NULL CHECK (generation >= 1),
  manifest_identity TEXT NOT NULL REFERENCES deployment_store_custody_private.manifests_v1 (manifest_identity),
  head_bytes BYTEA NOT NULL,
  signer_identity TEXT NOT NULL,
  signature BYTEA NOT NULL,
  published_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (environment_identity, deployment_identity, consumer_owner, consumer_identity, backend, head_identity)
);
-- The one current head of a scope. Its primary key is the scope, so two current heads cannot be
-- stored; the custodian still refuses more than one if a reader ever returned them.
CREATE TABLE IF NOT EXISTS deployment_store_custody_private.current_heads_v1 (
  environment_identity TEXT NOT NULL,
  deployment_identity TEXT NOT NULL,
  consumer_owner TEXT NOT NULL,
  consumer_identity TEXT NOT NULL,
  backend TEXT NOT NULL,
  head_identity TEXT NOT NULL,
  PRIMARY KEY (environment_identity, deployment_identity, consumer_owner, consumer_identity, backend),
  FOREIGN KEY (environment_identity, deployment_identity, consumer_owner, consumer_identity, backend, head_identity)
    REFERENCES deployment_store_custody_private.heads_v1 (environment_identity, deployment_identity, consumer_owner, consumer_identity, backend, head_identity)
);
CREATE TABLE IF NOT EXISTS deployment_store_custody_private.receipts_v1 (
  slot TEXT PRIMARY KEY,
  environment_identity TEXT NOT NULL,
  deployment_identity TEXT NOT NULL,
  consumer_owner TEXT NOT NULL,
  consumer_identity TEXT NOT NULL,
  backend TEXT NOT NULL,
  receipt_identity TEXT NOT NULL UNIQUE,
  replay_identity TEXT NOT NULL,
  admitted_at_epoch_ms BIGINT NOT NULL CHECK (admitted_at_epoch_ms >= 0),
  receipt_bytes BYTEA NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL
);

-- Append-only by construction: nothing, the owner included, rewrites or removes a manifest, a head
-- or a receipt. Only the current-head pointer moves, and only through publish_v1.
CREATE OR REPLACE FUNCTION deployment_store_custody_private.refuse_rewrite_v1()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $function$
BEGIN
  RAISE EXCEPTION 'deployment store custody is append-only: % on %', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'integrity_constraint_violation';
END
$function$;
DO $append_only$
DECLARE
  relation TEXT;
BEGIN
  FOREACH relation IN ARRAY ARRAY['manifests_v1','heads_v1','receipts_v1'] LOOP
    EXECUTE pg_catalog.format('DROP TRIGGER IF EXISTS refuse_rewrite_v1 ON deployment_store_custody_private.%I', relation);
    EXECUTE pg_catalog.format('CREATE TRIGGER refuse_rewrite_v1 BEFORE UPDATE OR DELETE ON deployment_store_custody_private.%I FOR EACH ROW EXECUTE FUNCTION deployment_store_custody_private.refuse_rewrite_v1()', relation);
    EXECUTE pg_catalog.format('DROP TRIGGER IF EXISTS refuse_truncate_v1 ON deployment_store_custody_private.%I', relation);
    EXECUTE pg_catalog.format('CREATE TRIGGER refuse_truncate_v1 BEFORE TRUNCATE ON deployment_store_custody_private.%I FOR EACH STATEMENT EXECUTE FUNCTION deployment_store_custody_private.refuse_rewrite_v1()', relation);
  END LOOP;
END
$append_only$;

-- Appends one signed manifest and advances its scope's head to the signed head naming it, or
-- changes nothing. Outcomes: PUBLISHED; REPLAYED (this exact manifest and head are already current);
-- HEAD_MISMATCH (the current head is not the one the caller expected); CONFLICT (anything else
-- already holds this identity or generation). Publishes and commits of one scope serialize on the
-- scope's advisory lock, so a head never moves under a commit that has read it.
CREATE OR REPLACE FUNCTION deployment_store_custody_api.publish_v1(
  p_environment_identity TEXT, p_deployment_identity TEXT, p_consumer_owner TEXT,
  p_consumer_identity TEXT, p_backend TEXT, p_expected_head_identity TEXT, p_generation BIGINT,
  p_manifest_identity TEXT, p_manifest_bytes BYTEA, p_manifest_signer_identity TEXT, p_manifest_signature BYTEA,
  p_head_identity TEXT, p_head_bytes BYTEA, p_head_signer_identity TEXT, p_head_signature BYTEA
) RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $function$
DECLARE
  current_head TEXT;
  latest_generation BIGINT;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(pg_catalog.concat_ws(pg_catalog.chr(31),
    'vibe.deployment-store-custody.scope.v1', p_environment_identity, p_deployment_identity,
    p_consumer_owner, p_consumer_identity, p_backend), 0));
  SELECT c.head_identity INTO current_head
  FROM deployment_store_custody_private.current_heads_v1 AS c
  WHERE c.environment_identity = p_environment_identity AND c.deployment_identity = p_deployment_identity
    AND c.consumer_owner = p_consumer_owner AND c.consumer_identity = p_consumer_identity AND c.backend = p_backend;

  IF current_head IS NOT DISTINCT FROM p_head_identity THEN
    IF EXISTS (
      SELECT 1 FROM deployment_store_custody_private.manifests_v1 AS m
      WHERE m.manifest_identity = p_manifest_identity AND m.generation = p_generation
        AND m.manifest_bytes = p_manifest_bytes AND m.signer_identity = p_manifest_signer_identity
        AND m.signature = p_manifest_signature AND m.environment_identity = p_environment_identity
        AND m.deployment_identity = p_deployment_identity AND m.consumer_owner = p_consumer_owner
        AND m.consumer_identity = p_consumer_identity AND m.backend = p_backend
    ) AND EXISTS (
      SELECT 1 FROM deployment_store_custody_private.heads_v1 AS h
      WHERE h.head_identity = p_head_identity AND h.generation = p_generation
        AND h.manifest_identity = p_manifest_identity AND h.head_bytes = p_head_bytes
        AND h.signer_identity = p_head_signer_identity AND h.signature = p_head_signature
        AND h.environment_identity = p_environment_identity AND h.deployment_identity = p_deployment_identity
        AND h.consumer_owner = p_consumer_owner AND h.consumer_identity = p_consumer_identity AND h.backend = p_backend
    ) THEN
      RETURN 'REPLAYED';
    END IF;
    RETURN 'CONFLICT';
  END IF;

  IF current_head IS DISTINCT FROM p_expected_head_identity THEN
    RETURN 'HEAD_MISMATCH';
  END IF;
  SELECT COALESCE(pg_catalog.max(m.generation), 0) INTO latest_generation
  FROM deployment_store_custody_private.manifests_v1 AS m
  WHERE m.environment_identity = p_environment_identity AND m.deployment_identity = p_deployment_identity
    AND m.consumer_owner = p_consumer_owner AND m.consumer_identity = p_consumer_identity AND m.backend = p_backend;

  IF p_generation <> latest_generation + 1
     OR EXISTS (SELECT 1 FROM deployment_store_custody_private.manifests_v1 AS m WHERE m.manifest_identity = p_manifest_identity)
     OR EXISTS (
       SELECT 1 FROM deployment_store_custody_private.heads_v1 AS h
       WHERE h.head_identity = p_head_identity AND h.environment_identity = p_environment_identity
         AND h.deployment_identity = p_deployment_identity AND h.consumer_owner = p_consumer_owner
         AND h.consumer_identity = p_consumer_identity AND h.backend = p_backend
     ) THEN
    RETURN 'CONFLICT';
  END IF;
  INSERT INTO deployment_store_custody_private.manifests_v1 (
    environment_identity, deployment_identity, consumer_owner, consumer_identity, backend,
    generation, manifest_identity, manifest_bytes, signer_identity, signature, published_at
  ) VALUES (
    p_environment_identity, p_deployment_identity, p_consumer_owner, p_consumer_identity, p_backend,
    p_generation, p_manifest_identity, p_manifest_bytes, p_manifest_signer_identity, p_manifest_signature,
    pg_catalog.clock_timestamp()
  );
  INSERT INTO deployment_store_custody_private.heads_v1 (
    environment_identity, deployment_identity, consumer_owner, consumer_identity, backend,
    head_identity, generation, manifest_identity, head_bytes, signer_identity, signature, published_at
  ) VALUES (
    p_environment_identity, p_deployment_identity, p_consumer_owner, p_consumer_identity, p_backend,
    p_head_identity, p_generation, p_manifest_identity, p_head_bytes, p_head_signer_identity, p_head_signature,
    pg_catalog.clock_timestamp()
  );
  INSERT INTO deployment_store_custody_private.current_heads_v1 (
    environment_identity, deployment_identity, consumer_owner, consumer_identity, backend, head_identity
  ) VALUES (
    p_environment_identity, p_deployment_identity, p_consumer_owner, p_consumer_identity, p_backend, p_head_identity
  )
  ON CONFLICT (environment_identity, deployment_identity, consumer_owner, consumer_identity, backend)
  DO UPDATE SET head_identity = EXCLUDED.head_identity;
  RETURN 'PUBLISHED';
END
$function$;

-- One scope's whole signed history and its current head, read in one statement, with the store
-- clock's cut. HEAD rows name the head identity; MANIFEST rows the manifest identity.
CREATE OR REPLACE FUNCTION deployment_store_custody_api.resolve_history_v1(
  p_environment_identity TEXT, p_deployment_identity TEXT, p_consumer_owner TEXT,
  p_consumer_identity TEXT, p_backend TEXT
) RETURNS TABLE(entry_kind TEXT, generation BIGINT, identity TEXT, entry_bytes BYTEA, signer_identity TEXT, signature BYTEA, read_cut_epoch_ms BIGINT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $function$
  WITH cut AS (
    SELECT pg_catalog.floor(EXTRACT(epoch FROM pg_catalog.clock_timestamp()) * 1000)::bigint AS epoch_ms
  )
  SELECT 'MANIFEST', m.generation, m.manifest_identity, m.manifest_bytes, m.signer_identity, m.signature, cut.epoch_ms
  FROM deployment_store_custody_private.manifests_v1 AS m, cut
  WHERE m.environment_identity = p_environment_identity AND m.deployment_identity = p_deployment_identity
    AND m.consumer_owner = p_consumer_owner AND m.consumer_identity = p_consumer_identity AND m.backend = p_backend
  UNION ALL
  SELECT 'HEAD', h.generation, h.head_identity, h.head_bytes, h.signer_identity, h.signature, cut.epoch_ms
  FROM deployment_store_custody_private.current_heads_v1 AS c
  JOIN deployment_store_custody_private.heads_v1 AS h
    ON h.environment_identity = c.environment_identity AND h.deployment_identity = c.deployment_identity
   AND h.consumer_owner = c.consumer_owner AND h.consumer_identity = c.consumer_identity
   AND h.backend = c.backend AND h.head_identity = c.head_identity
  , cut
  WHERE c.environment_identity = p_environment_identity AND c.deployment_identity = p_deployment_identity
    AND c.consumer_owner = p_consumer_owner AND c.consumer_identity = p_consumer_identity AND c.backend = p_backend
  UNION ALL
  -- A scope with no history still answers with the cut, so an empty read is told from no read.
  SELECT 'CUT', NULL, NULL, NULL, NULL, NULL, cut.epoch_ms FROM cut
$function$;

-- The commit's view: takes the scope's advisory lock for the rest of the caller's transaction, so no
-- publish can move the head until the receipt is recorded or refused, then reads as above.
CREATE OR REPLACE FUNCTION deployment_store_custody_api.lock_history_v1(
  p_environment_identity TEXT, p_deployment_identity TEXT, p_consumer_owner TEXT,
  p_consumer_identity TEXT, p_backend TEXT
) RETURNS TABLE(entry_kind TEXT, generation BIGINT, identity TEXT, entry_bytes BYTEA, signer_identity TEXT, signature BYTEA, read_cut_epoch_ms BIGINT)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $function$
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(pg_catalog.concat_ws(pg_catalog.chr(31),
    'vibe.deployment-store-custody.scope.v1', p_environment_identity, p_deployment_identity,
    p_consumer_owner, p_consumer_identity, p_backend), 0));
  RETURN QUERY SELECT * FROM deployment_store_custody_api.resolve_history_v1(
    p_environment_identity, p_deployment_identity, p_consumer_owner, p_consumer_identity, p_backend
  );
END
$function$;

-- The store clock, for the commit to judge the receipt's window and stamp its admission.
CREATE OR REPLACE FUNCTION deployment_store_custody_api.admission_cut_v1()
RETURNS BIGINT LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $function$
  SELECT pg_catalog.floor(EXTRACT(epoch FROM pg_catalog.clock_timestamp()) * 1000)::bigint
$function$;

-- Records a receipt in its slot, or returns the receipt already there. The caller decides whether
-- that one is the same receipt; this function never overwrites.
CREATE OR REPLACE FUNCTION deployment_store_custody_api.record_receipt_v1(
  p_slot TEXT, p_environment_identity TEXT, p_deployment_identity TEXT, p_consumer_owner TEXT,
  p_consumer_identity TEXT, p_backend TEXT, p_receipt_identity TEXT, p_replay_identity TEXT,
  p_admitted_at_epoch_ms BIGINT, p_receipt_bytes BYTEA
) RETURNS TABLE(receipt_identity TEXT, replay_identity TEXT, admitted_at_epoch_ms BIGINT, receipt_bytes BYTEA)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $function$
BEGIN
  INSERT INTO deployment_store_custody_private.receipts_v1 AS r (
    slot, environment_identity, deployment_identity, consumer_owner, consumer_identity, backend,
    receipt_identity, replay_identity, admitted_at_epoch_ms, receipt_bytes, recorded_at
  ) VALUES (
    p_slot, p_environment_identity, p_deployment_identity, p_consumer_owner, p_consumer_identity, p_backend,
    p_receipt_identity, p_replay_identity, p_admitted_at_epoch_ms, p_receipt_bytes, pg_catalog.clock_timestamp()
  )
  ON CONFLICT (slot) DO NOTHING;
  RETURN QUERY
  SELECT r.receipt_identity, r.replay_identity, r.admitted_at_epoch_ms, r.receipt_bytes
  FROM deployment_store_custody_private.receipts_v1 AS r
  WHERE r.slot = p_slot;
END
$function$;

RESET ROLE;
REVOKE ALL ON ALL TABLES IN SCHEMA deployment_store_custody_private FROM PUBLIC, deployment_store_publisher, deployment_store_custodian;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA deployment_store_custody_private, deployment_store_custody_api FROM PUBLIC, deployment_store_publisher, deployment_store_custodian;
GRANT EXECUTE ON FUNCTION deployment_store_custody_api.publish_v1(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT, TEXT, BYTEA, TEXT, BYTEA, TEXT, BYTEA, TEXT, BYTEA) TO deployment_store_publisher;
GRANT EXECUTE ON FUNCTION deployment_store_custody_api.resolve_history_v1(TEXT, TEXT, TEXT, TEXT, TEXT) TO deployment_store_custodian;
GRANT EXECUTE ON FUNCTION deployment_store_custody_api.lock_history_v1(TEXT, TEXT, TEXT, TEXT, TEXT) TO deployment_store_custodian;
GRANT EXECUTE ON FUNCTION deployment_store_custody_api.admission_cut_v1() TO deployment_store_custodian;
GRANT EXECUTE ON FUNCTION deployment_store_custody_api.record_receipt_v1(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT, BYTEA) TO deployment_store_custodian;
COMMIT;
SQL
