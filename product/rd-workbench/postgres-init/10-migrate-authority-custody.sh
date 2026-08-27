#!/bin/sh
set -eu

export PGPASSWORD="$POSTGRES_PASSWORD"
psql --set=ON_ERROR_STOP=1 --host "${POSTGRES_HOST:-postgres}" --username postgres --dbname "${POSTGRES_DATABASE:-rd_owner}" \
  --set=rd_password="$RD_OWNER_DB_PASSWORD" \
  --set=issuer_password="$OPERATOR_AUTHORIZATION_DB_PASSWORD" \
  --set=qualification_password="$QUALIFICATION_OWNER_DB_PASSWORD" \
  --set=edge_password="$PRODUCT_EDGE_DB_PASSWORD" \
  --set=backtest_password="$BACKTEST_OWNER_DB_PASSWORD" << 'SQL'
BEGIN;
DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rd_owner') THEN CREATE ROLE rd_owner LOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'operator_authorization_owner') THEN CREATE ROLE operator_authorization_owner NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'operator_authorization_writer') THEN CREATE ROLE operator_authorization_writer LOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'qualification_owner') THEN CREATE ROLE qualification_owner NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'qualification_writer') THEN CREATE ROLE qualification_writer LOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'product_edge_owner') THEN CREATE ROLE product_edge_owner LOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'backtest_owner') THEN CREATE ROLE backtest_owner LOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'portfolio_owner') THEN CREATE ROLE portfolio_owner NOLOGIN; END IF;
END
$roles$;
ALTER ROLE rd_owner PASSWORD :'rd_password';
ALTER ROLE operator_authorization_owner NOLOGIN;
ALTER ROLE operator_authorization_writer LOGIN PASSWORD :'issuer_password';
ALTER ROLE qualification_owner NOLOGIN;
ALTER ROLE qualification_writer LOGIN PASSWORD :'qualification_password';
ALTER ROLE product_edge_owner PASSWORD :'edge_password';
ALTER ROLE backtest_owner LOGIN PASSWORD :'backtest_password';
ALTER ROLE portfolio_owner NOLOGIN;
GRANT operator_authorization_owner TO operator_authorization_writer;
REVOKE portfolio_owner FROM product_edge_owner;
REVOKE operator_authorization_owner FROM product_edge_owner, rd_owner;
REVOKE qualification_owner FROM qualification_writer, product_edge_owner, rd_owner, operator_authorization_writer;
REVOKE rd_owner, product_edge_owner, qualification_owner, operator_authorization_owner, portfolio_owner FROM backtest_owner;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
DO $database_grants$
BEGIN
  EXECUTE pg_catalog.format(
    'REVOKE CONNECT ON DATABASE %I FROM PUBLIC, operator_authorization_owner, qualification_owner, portfolio_owner',
    pg_catalog.current_database()
  );
  EXECUTE pg_catalog.format(
    'GRANT CONNECT ON DATABASE %I TO rd_owner, operator_authorization_writer, qualification_writer, product_edge_owner, backtest_owner',
    pg_catalog.current_database()
  );
END
$database_grants$;
CREATE SCHEMA IF NOT EXISTS operator_authorization_private AUTHORIZATION operator_authorization_owner;
CREATE SCHEMA IF NOT EXISTS operator_authorization_api AUTHORIZATION operator_authorization_owner;
ALTER SCHEMA operator_authorization_private OWNER TO operator_authorization_owner;
ALTER SCHEMA operator_authorization_api OWNER TO operator_authorization_owner;
REVOKE ALL ON SCHEMA operator_authorization_private FROM PUBLIC, rd_owner, product_edge_owner, portfolio_owner;
REVOKE ALL ON SCHEMA operator_authorization_api FROM PUBLIC, rd_owner, product_edge_owner, portfolio_owner;
GRANT USAGE ON SCHEMA operator_authorization_api TO product_edge_owner;
GRANT USAGE, CREATE ON SCHEMA public TO rd_owner, product_edge_owner;
GRANT USAGE ON SCHEMA public TO qualification_writer;
CREATE SCHEMA IF NOT EXISTS product_edge_api AUTHORIZATION product_edge_owner;
ALTER SCHEMA product_edge_api OWNER TO product_edge_owner;
REVOKE ALL ON SCHEMA product_edge_api FROM PUBLIC, operator_authorization_writer, portfolio_owner;
GRANT USAGE ON SCHEMA product_edge_api TO rd_owner, portfolio_owner;
CREATE SCHEMA IF NOT EXISTS rd_owner_api AUTHORIZATION rd_owner;
ALTER SCHEMA rd_owner_api OWNER TO rd_owner;
REVOKE ALL ON SCHEMA rd_owner_api FROM PUBLIC, operator_authorization_writer, qualification_writer;
GRANT USAGE ON SCHEMA rd_owner_api TO product_edge_owner, qualification_writer;
REVOKE ALL ON SCHEMA public FROM backtest_owner;
GRANT USAGE ON SCHEMA public TO backtest_owner;

CREATE SCHEMA IF NOT EXISTS qualification_api AUTHORIZATION qualification_owner;
ALTER SCHEMA qualification_api OWNER TO qualification_owner;
REVOKE ALL ON SCHEMA qualification_api FROM PUBLIC, product_edge_owner, operator_authorization_writer;
GRANT USAGE ON SCHEMA qualification_api TO rd_owner, qualification_writer;

CREATE TABLE IF NOT EXISTS public.qualification_protected_feedback_projections_v1 (projection_identity TEXT PRIMARY KEY, basis_identity TEXT NOT NULL, principal TEXT NOT NULL, request_scope_json JSONB NOT NULL, resolution_state TEXT NOT NULL, source_sequence BIGINT NOT NULL, source_cut TEXT NOT NULL, projection_digest TEXT NOT NULL, projection_json JSONB NOT NULL, receipt_json JSONB NOT NULL, committed_at_epoch_ms BIGINT NOT NULL, valid_through_epoch_ms BIGINT NOT NULL);
ALTER TABLE public.qualification_protected_feedback_projections_v1 DROP CONSTRAINT IF EXISTS qualification_protected_feedback_projections_v1_basis_identity_key;
CREATE INDEX IF NOT EXISTS qualification_protected_feedback_basis_history_v1 ON public.qualification_protected_feedback_projections_v1(basis_identity, committed_at_epoch_ms, projection_identity);
CREATE TABLE IF NOT EXISTS public.qualification_protected_feedback_heads_v1 (principal_scope_key TEXT PRIMARY KEY, principal TEXT NOT NULL, request_scope_json JSONB NOT NULL, frontier_identity TEXT NOT NULL UNIQUE REFERENCES public.qualification_protected_feedback_projections_v1(projection_identity), frontier_digest TEXT NOT NULL, source_sequence BIGINT NOT NULL, source_cut TEXT NOT NULL, committed_at_epoch_ms BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS public.qualification_owner_outbox_v1 (event_identity TEXT PRIMARY KEY, aggregate_identity TEXT NOT NULL, event_kind TEXT NOT NULL, payload_digest TEXT NOT NULL, payload_json JSONB NOT NULL, committed_at_epoch_ms BIGINT NOT NULL, UNIQUE (aggregate_identity, event_kind));
ALTER TABLE public.qualification_protected_feedback_projections_v1 OWNER TO qualification_owner;
ALTER TABLE public.qualification_protected_feedback_heads_v1 OWNER TO qualification_owner;
ALTER TABLE public.qualification_owner_outbox_v1 OWNER TO qualification_owner;
REVOKE ALL ON TABLE public.qualification_protected_feedback_projections_v1, public.qualification_protected_feedback_heads_v1, public.qualification_owner_outbox_v1 FROM PUBLIC, rd_owner, product_edge_owner, operator_authorization_writer;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.qualification_protected_feedback_projections_v1, public.qualification_protected_feedback_heads_v1, public.qualification_owner_outbox_v1 TO qualification_writer;

CREATE OR REPLACE FUNCTION qualification_api.lock_projection_for_basis_v1(
  requested_basis_identity text,
  requested_basis_digest text,
  requested_request_identity text,
  requested_principal text,
  requested_request_scope jsonb,
  requested_principal_scope_key text
)
RETURNS jsonb LANGUAGE plpgsql STRICT VOLATILE PARALLEL UNSAFE SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  owner_cut_epoch_ms bigint;
BEGIN
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN RETURN NULL; END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(requested_principal_scope_key, 0));
  PERFORM head.principal_scope_key
  FROM public.qualification_protected_feedback_heads_v1 head
  WHERE head.principal_scope_key = requested_principal_scope_key
  FOR UPDATE;
  PERFORM projection.projection_identity
  FROM public.qualification_protected_feedback_projections_v1 projection
  WHERE projection.principal = requested_principal
    AND projection.request_scope_json = requested_request_scope
  ORDER BY projection.projection_identity
  FOR SHARE;
  PERFORM outbox.event_identity
  FROM public.qualification_owner_outbox_v1 outbox
  WHERE outbox.aggregate_identity IN (
    SELECT projection.projection_identity
    FROM public.qualification_protected_feedback_projections_v1 projection
    WHERE projection.principal = requested_principal
      AND projection.request_scope_json = requested_request_scope
  )
  ORDER BY outbox.event_identity
  FOR SHARE;
  owner_cut_epoch_ms := pg_catalog.floor(extract(epoch FROM pg_catalog.clock_timestamp()) * 1000)::bigint;

  RETURN pg_catalog.jsonb_build_object(
    'schema_version', 1,
    'basis_identity', requested_basis_identity,
    'basis_digest', requested_basis_digest,
    'request_identity', requested_request_identity,
    'principal', requested_principal,
    'request_scope', requested_request_scope,
    'principal_scope_key', requested_principal_scope_key,
    'owner_cut_epoch_ms', owner_cut_epoch_ms,
    'heads', COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(head) ORDER BY head.principal_scope_key)
      FROM public.qualification_protected_feedback_heads_v1 head
      WHERE head.principal_scope_key = requested_principal_scope_key
    ), '[]'::jsonb),
    'projections', COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(projection) ORDER BY projection.projection_identity)
      FROM public.qualification_protected_feedback_projections_v1 projection
      WHERE projection.principal = requested_principal
        AND projection.request_scope_json = requested_request_scope
    ), '[]'::jsonb),
    'outboxes', COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(outbox) ORDER BY outbox.event_identity)
      FROM public.qualification_owner_outbox_v1 outbox
      WHERE outbox.aggregate_identity IN (
        SELECT projection.projection_identity
        FROM public.qualification_protected_feedback_projections_v1 projection
        WHERE projection.principal = requested_principal
          AND projection.request_scope_json = requested_request_scope
      )
    ), '[]'::jsonb)
  );
END
$function$;
ALTER FUNCTION qualification_api.lock_projection_for_basis_v1(text,text,text,text,jsonb,text) OWNER TO qualification_owner;
REVOKE ALL ON FUNCTION qualification_api.lock_projection_for_basis_v1(text,text,text,text,jsonb,text) FROM PUBLIC, product_edge_owner, operator_authorization_writer;
GRANT EXECUTE ON FUNCTION qualification_api.lock_projection_for_basis_v1(text,text,text,text,jsonb,text) TO rd_owner, qualification_writer;

DO $move$
DECLARE name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['operator_authorization_issuances_v1','operator_authorization_revocation_frontiers_v1','operator_authorization_revocation_heads_v1','operator_authorization_owner_outbox_v1'] LOOP
    IF to_regclass(format('public.%I', name)) IS NOT NULL AND to_regclass(format('operator_authorization_private.%I', name)) IS NULL THEN
      EXECUTE format('ALTER TABLE public.%I SET SCHEMA operator_authorization_private', name);
    END IF;
  END LOOP;
END
$move$;

CREATE TABLE IF NOT EXISTS operator_authorization_private.operator_authorization_issuances_v1 (authorization_identity TEXT PRIMARY KEY, issuer_identity TEXT NOT NULL, principal TEXT NOT NULL, audience TEXT NOT NULL, scope_digest TEXT NOT NULL, semantic_digest TEXT NOT NULL, issuance_json JSONB NOT NULL, receipt_json JSONB NOT NULL, committed_at_epoch_ms BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS operator_authorization_private.operator_authorization_revocation_frontiers_v1 (frontier_identity TEXT PRIMARY KEY, issuer_identity TEXT NOT NULL, principal TEXT NOT NULL, audience TEXT NOT NULL, scope_digest TEXT NOT NULL, sequence BIGINT NOT NULL, predecessor_frontier_identity TEXT, frontier_digest TEXT NOT NULL, frontier_json JSONB NOT NULL, committed_at_epoch_ms BIGINT NOT NULL, UNIQUE(scope_digest, sequence));
CREATE TABLE IF NOT EXISTS operator_authorization_private.operator_authorization_revocation_heads_v1 (scope_digest TEXT PRIMARY KEY, frontier_identity TEXT NOT NULL REFERENCES operator_authorization_private.operator_authorization_revocation_frontiers_v1(frontier_identity), sequence BIGINT NOT NULL, frontier_digest TEXT NOT NULL, committed_at_epoch_ms BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS operator_authorization_private.operator_authorization_owner_outbox_v1 (event_identity TEXT PRIMARY KEY, aggregate_identity TEXT NOT NULL, event_kind TEXT NOT NULL, payload_digest TEXT NOT NULL, payload_json JSONB NOT NULL, committed_at_epoch_ms BIGINT NOT NULL);
CREATE INDEX IF NOT EXISTS operator_authorization_issuance_scope_v1 ON operator_authorization_private.operator_authorization_issuances_v1(scope_digest, authorization_identity);
CREATE INDEX IF NOT EXISTS operator_authorization_outbox_aggregate_v1 ON operator_authorization_private.operator_authorization_owner_outbox_v1(aggregate_identity, event_kind);
ALTER TABLE operator_authorization_private.operator_authorization_issuances_v1 OWNER TO operator_authorization_owner;
ALTER TABLE operator_authorization_private.operator_authorization_revocation_frontiers_v1 OWNER TO operator_authorization_owner;
ALTER TABLE operator_authorization_private.operator_authorization_revocation_heads_v1 OWNER TO operator_authorization_owner;
ALTER TABLE operator_authorization_private.operator_authorization_owner_outbox_v1 OWNER TO operator_authorization_owner;
REVOKE ALL ON ALL TABLES IN SCHEMA operator_authorization_private FROM PUBLIC, rd_owner, product_edge_owner;

CREATE OR REPLACE FUNCTION operator_authorization_api.lock_current_authorization_v1(requested_authorization_identity text, requested_issuance_receipt_identity text)
RETURNS jsonb LANGUAGE plpgsql STRICT VOLATILE PARALLEL UNSAFE SECURITY DEFINER
SET search_path = pg_catalog, operator_authorization_private
AS $function$
DECLARE
  issuance operator_authorization_private.operator_authorization_issuances_v1%ROWTYPE;
  head operator_authorization_private.operator_authorization_revocation_heads_v1%ROWTYPE;
  current_frontier operator_authorization_private.operator_authorization_revocation_frontiers_v1%ROWTYPE;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN RETURN NULL; END IF;
  SELECT * INTO issuance FROM operator_authorization_private.operator_authorization_issuances_v1 WHERE authorization_identity = requested_authorization_identity FOR SHARE;
  IF NOT FOUND OR issuance.receipt_json->>'receipt_identity' <> requested_issuance_receipt_identity THEN RETURN NULL; END IF;
  SELECT * INTO head FROM operator_authorization_private.operator_authorization_revocation_heads_v1 WHERE scope_digest = issuance.scope_digest FOR SHARE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO current_frontier FROM operator_authorization_private.operator_authorization_revocation_frontiers_v1 WHERE frontier_identity = head.frontier_identity AND scope_digest = issuance.scope_digest FOR SHARE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  PERFORM 1 FROM operator_authorization_private.operator_authorization_issuances_v1 scope_issuance WHERE scope_issuance.scope_digest = issuance.scope_digest FOR SHARE;
  PERFORM 1 FROM operator_authorization_private.operator_authorization_revocation_frontiers_v1 frontier WHERE frontier.scope_digest = issuance.scope_digest FOR SHARE;
  PERFORM 1 FROM operator_authorization_private.operator_authorization_owner_outbox_v1 outbox WHERE outbox.aggregate_identity IN (SELECT scope_issuance.authorization_identity FROM operator_authorization_private.operator_authorization_issuances_v1 scope_issuance WHERE scope_issuance.scope_digest = issuance.scope_digest) OR outbox.aggregate_identity IN (SELECT frontier.frontier_identity FROM operator_authorization_private.operator_authorization_revocation_frontiers_v1 frontier WHERE frontier.scope_digest = issuance.scope_digest) FOR SHARE;
  RETURN jsonb_build_object(
    'issuance', to_jsonb(issuance), 'head', to_jsonb(head), 'current_frontier', to_jsonb(current_frontier),
    'issuances', COALESCE((SELECT jsonb_agg(to_jsonb(scope_issuance) ORDER BY scope_issuance.committed_at_epoch_ms, scope_issuance.authorization_identity) FROM operator_authorization_private.operator_authorization_issuances_v1 scope_issuance WHERE scope_issuance.scope_digest = issuance.scope_digest), '[]'::jsonb),
    'frontiers', COALESCE((SELECT jsonb_agg(to_jsonb(frontier) ORDER BY frontier.sequence, frontier.frontier_identity) FROM operator_authorization_private.operator_authorization_revocation_frontiers_v1 frontier WHERE frontier.scope_digest = issuance.scope_digest), '[]'::jsonb),
    'outboxes', COALESCE((SELECT jsonb_agg(to_jsonb(outbox) ORDER BY outbox.event_identity) FROM operator_authorization_private.operator_authorization_owner_outbox_v1 outbox WHERE outbox.aggregate_identity IN (SELECT scope_issuance.authorization_identity FROM operator_authorization_private.operator_authorization_issuances_v1 scope_issuance WHERE scope_issuance.scope_digest = issuance.scope_digest) OR outbox.aggregate_identity IN (SELECT frontier.frontier_identity FROM operator_authorization_private.operator_authorization_revocation_frontiers_v1 frontier WHERE frontier.scope_digest = issuance.scope_digest)), '[]'::jsonb)
  );
END
$function$;
ALTER FUNCTION operator_authorization_api.lock_current_authorization_v1(text, text) OWNER TO operator_authorization_owner;
REVOKE ALL ON FUNCTION operator_authorization_api.lock_current_authorization_v1(text, text) FROM PUBLIC, rd_owner;
GRANT EXECUTE ON FUNCTION operator_authorization_api.lock_current_authorization_v1(text, text) TO product_edge_owner, operator_authorization_writer;

CREATE TABLE IF NOT EXISTS public.product_edge_operation_manifests_v1 (manifest_identity TEXT PRIMARY KEY, operation TEXT NOT NULL, operation_schema TEXT NOT NULL, target_owner TEXT NOT NULL, manifest_digest TEXT NOT NULL, manifest_json JSONB NOT NULL, receipt_json JSONB NOT NULL, committed_at_epoch_ms BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS public.product_edge_deployment_bindings_v1 (binding_identity TEXT PRIMARY KEY, deployment_identity TEXT NOT NULL, generation BIGINT NOT NULL, predecessor_binding_identity TEXT, authorization_identity TEXT, issuance_receipt_identity TEXT, authorization_frontier_identity TEXT, binding_digest TEXT NOT NULL, binding_json JSONB NOT NULL, receipt_json JSONB NOT NULL, committed_at_epoch_ms BIGINT NOT NULL, UNIQUE(deployment_identity, generation));
CREATE TABLE IF NOT EXISTS public.product_edge_deployment_supersessions_v1 (binding_identity TEXT PRIMARY KEY REFERENCES public.product_edge_deployment_bindings_v1(binding_identity), successor_binding_identity TEXT, supersession_digest TEXT NOT NULL, supersession_json JSONB NOT NULL, committed_at_epoch_ms BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS public.product_edge_deployment_heads_v1 (deployment_identity TEXT PRIMARY KEY, binding_identity TEXT NOT NULL REFERENCES public.product_edge_deployment_bindings_v1(binding_identity), generation BIGINT NOT NULL, binding_digest TEXT NOT NULL, committed_at_epoch_ms BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS public.product_edge_binding_manifests_v1 (binding_identity TEXT NOT NULL REFERENCES public.product_edge_deployment_bindings_v1(binding_identity), manifest_identity TEXT NOT NULL REFERENCES public.product_edge_operation_manifests_v1(manifest_identity), manifest_digest TEXT NOT NULL, PRIMARY KEY(binding_identity, manifest_identity));
CREATE TABLE IF NOT EXISTS public.product_edge_request_admissions_v1 (request_identity TEXT PRIMARY KEY, admission_identity TEXT NOT NULL UNIQUE, deployment_identity TEXT, binding_identity TEXT, authorization_identity TEXT, issuance_receipt_identity TEXT, authorization_frontier_identity TEXT, request_semantic_digest TEXT NOT NULL, admission_digest TEXT NOT NULL, admission_json JSONB NOT NULL, receipt_json JSONB NOT NULL, committed_at_epoch_ms BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS public.product_edge_effect_invocation_admissions_v1 (receipt_identity TEXT PRIMARY KEY, receipt_digest TEXT NOT NULL, admission_identity TEXT NOT NULL UNIQUE, attempt_identity TEXT NOT NULL UNIQUE, claim_identity TEXT NOT NULL UNIQUE, receipt_json JSONB NOT NULL, write_cut_epoch_ms BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS public.product_edge_effect_invocation_claims_v1 (admission_identity TEXT PRIMARY KEY, claim_identity TEXT NOT NULL UNIQUE, attempt_identity TEXT NOT NULL UNIQUE, claim_digest TEXT NOT NULL, claim_json JSONB NOT NULL, committed_at_epoch_ms BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS public.product_edge_effect_invocation_states_v1 (claim_identity TEXT PRIMARY KEY REFERENCES public.product_edge_effect_invocation_claims_v1(claim_identity), admission_identity TEXT NOT NULL UNIQUE, attempt_identity TEXT NOT NULL UNIQUE, claim_digest TEXT NOT NULL, state_digest TEXT NOT NULL, state_json JSONB NOT NULL, updated_at_epoch_ms BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS public.product_edge_owner_outbox_v1 (event_identity TEXT PRIMARY KEY, aggregate_identity TEXT NOT NULL, event_kind TEXT NOT NULL, payload_digest TEXT NOT NULL, payload_json JSONB NOT NULL, committed_at_epoch_ms BIGINT NOT NULL);

ALTER TABLE public.product_edge_deployment_bindings_v1 ADD COLUMN IF NOT EXISTS authorization_identity TEXT;
ALTER TABLE public.product_edge_deployment_bindings_v1 ADD COLUMN IF NOT EXISTS issuance_receipt_identity TEXT;
ALTER TABLE public.product_edge_deployment_bindings_v1 ADD COLUMN IF NOT EXISTS authorization_frontier_identity TEXT;
UPDATE public.product_edge_deployment_bindings_v1
SET authorization_identity=binding_json#>>'{authorization,authorization_identity}',
    issuance_receipt_identity=binding_json#>>'{authorization,issuance_receipt_identity}',
    authorization_frontier_identity=binding_json->>'authorization_frontier_identity'
WHERE binding_json ? 'authorization_frontier_identity'
  AND (authorization_identity IS NULL OR issuance_receipt_identity IS NULL OR authorization_frontier_identity IS NULL);
ALTER TABLE public.product_edge_request_admissions_v1 ADD COLUMN IF NOT EXISTS deployment_identity TEXT;
ALTER TABLE public.product_edge_request_admissions_v1 ADD COLUMN IF NOT EXISTS binding_identity TEXT;
ALTER TABLE public.product_edge_request_admissions_v1 ADD COLUMN IF NOT EXISTS authorization_identity TEXT;
ALTER TABLE public.product_edge_request_admissions_v1 ADD COLUMN IF NOT EXISTS issuance_receipt_identity TEXT;
ALTER TABLE public.product_edge_request_admissions_v1 ADD COLUMN IF NOT EXISTS authorization_frontier_identity TEXT;
UPDATE public.product_edge_request_admissions_v1
SET deployment_identity=admission_json->>'deployment_identity',
    binding_identity=admission_json->>'binding_identity',
    authorization_identity=admission_json#>>'{authorization,authorization_identity}',
    issuance_receipt_identity=admission_json#>>'{authorization,issuance_receipt_identity}',
    authorization_frontier_identity=admission_json->>'authorization_frontier_identity'
WHERE deployment_identity IS NULL OR binding_identity IS NULL OR authorization_identity IS NULL OR issuance_receipt_identity IS NULL OR authorization_frontier_identity IS NULL;
INSERT INTO public.product_edge_binding_manifests_v1 (binding_identity, manifest_identity, manifest_digest)
SELECT binding.binding_identity, manifest_identity.value, manifest.manifest_digest
FROM public.product_edge_deployment_bindings_v1 binding
CROSS JOIN LATERAL jsonb_array_elements_text(binding.binding_json->'manifest_identities') manifest_identity(value)
JOIN public.product_edge_operation_manifests_v1 manifest ON manifest.manifest_identity=manifest_identity.value
ON CONFLICT (binding_identity, manifest_identity) DO NOTHING;

DO $rd_ownership$
DECLARE object record;
BEGIN
  FOR object IN SELECT schemaname, tablename FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'rd_%' LOOP
    EXECUTE format('ALTER TABLE %I.%I OWNER TO rd_owner', object.schemaname, object.tablename);
  END LOOP;
  FOR object IN SELECT sequence_schema AS schemaname, sequence_name FROM information_schema.sequences WHERE sequence_schema = 'public' AND sequence_name LIKE 'rd_%' LOOP
    EXECUTE format('ALTER SEQUENCE %I.%I OWNER TO rd_owner', object.schemaname, object.sequence_name);
  END LOOP;
END
$rd_ownership$;

ALTER DEFAULT PRIVILEGES FOR ROLE rd_owner IN SCHEMA public REVOKE SELECT ON TABLES FROM qualification_owner, qualification_writer;
DO $qualification_basis_reads$
DECLARE object record;
BEGIN
  FOR object IN
    SELECT schemaname, tablename
    FROM pg_tables
    WHERE schemaname = 'public' AND tablename LIKE 'rd_%'
  LOOP
    EXECUTE pg_catalog.format(
      'REVOKE ALL PRIVILEGES ON TABLE %I.%I FROM qualification_owner, qualification_writer',
      object.schemaname,
      object.tablename
    );
  END LOOP;
END
$qualification_basis_reads$;

DROP FUNCTION IF EXISTS rd_owner_api.lock_independence_basis_for_qualification_v1(text,text,text,text,jsonb);
CREATE OR REPLACE FUNCTION rd_owner_api.lock_independence_basis_for_qualification_v1(
  requested_basis_identity text,
  requested_basis_digest text,
  requested_principal text,
  requested_request_scope jsonb
)
RETURNS jsonb LANGUAGE plpgsql STRICT VOLATILE PARALLEL UNSAFE SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  locked_basis record;
  locked_outbox record;
BEGIN
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN RETURN NULL; END IF;
  SELECT basis_identity, request_identity, principal, request_scope_json, lineage_digest,
         basis_digest, basis_json, receipt_json, committed_at_epoch_ms
    INTO locked_basis
    FROM public.rd_independence_bases_v1
   WHERE basis_identity = requested_basis_identity
     AND basis_digest = requested_basis_digest
     AND principal = requested_principal
     AND request_scope_json = requested_request_scope
   FOR SHARE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT event_identity, aggregate_identity, event_kind, payload_digest, payload_json,
         committed_at_epoch_ms
    INTO STRICT locked_outbox
    FROM public.rd_owner_outbox_v1
   WHERE aggregate_identity = requested_basis_identity
     AND event_kind = 'INDEPENDENCE_BASIS_PRECOMMITTED_V1'
   FOR SHARE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN pg_catalog.jsonb_build_object(
    'schema_version', 1,
    'basis', pg_catalog.jsonb_build_object(
      'basis_identity', locked_basis.basis_identity,
      'request_identity', locked_basis.request_identity,
      'principal', locked_basis.principal,
      'request_scope_json', locked_basis.request_scope_json,
      'lineage_digest', locked_basis.lineage_digest,
      'basis_digest', locked_basis.basis_digest,
      'basis_json', locked_basis.basis_json,
      'receipt_json', locked_basis.receipt_json,
      'committed_at_epoch_ms', locked_basis.committed_at_epoch_ms
    ),
    'outbox', pg_catalog.jsonb_build_object(
      'event_identity', locked_outbox.event_identity,
      'aggregate_identity', locked_outbox.aggregate_identity,
      'event_kind', locked_outbox.event_kind,
      'payload_digest', locked_outbox.payload_digest,
      'payload_json', locked_outbox.payload_json,
      'committed_at_epoch_ms', locked_outbox.committed_at_epoch_ms
    )
  );
END
$function$;
ALTER FUNCTION rd_owner_api.lock_independence_basis_for_qualification_v1(text,text,text,jsonb) OWNER TO rd_owner;
REVOKE ALL ON FUNCTION rd_owner_api.lock_independence_basis_for_qualification_v1(text,text,text,jsonb) FROM PUBLIC, product_edge_owner, operator_authorization_writer, qualification_owner;
GRANT EXECUTE ON FUNCTION rd_owner_api.lock_independence_basis_for_qualification_v1(text,text,text,jsonb) TO qualification_writer;

DO $product_edge_ownership$
DECLARE object record;
BEGIN
  FOR object IN SELECT schemaname, tablename FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'product_edge_%' LOOP
    EXECUTE format('ALTER TABLE %I.%I OWNER TO product_edge_owner', object.schemaname, object.tablename);
    EXECUTE format('REVOKE ALL ON TABLE %I.%I FROM rd_owner, operator_authorization_writer, portfolio_owner', object.schemaname, object.tablename);
  END LOOP;
END
$product_edge_ownership$;

CREATE OR REPLACE FUNCTION product_edge_api.lock_downstream_admission_v1(
  requested_request_identity text,
  requested_admission_identity text,
  requested_admission_digest text
)
RETURNS jsonb LANGUAGE plpgsql STRICT VOLATILE PARALLEL UNSAFE SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  hinted_admission public.product_edge_request_admissions_v1%ROWTYPE;
  locked_admission public.product_edge_request_admissions_v1%ROWTYPE;
  requirement record;
  authorization_envelope jsonb;
  authorization_envelopes jsonb := '[]'::jsonb;
  hinted_binding_locators jsonb;
  locked_head jsonb;
BEGIN
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN RETURN NULL; END IF;

  SELECT * INTO hinted_admission
  FROM public.product_edge_request_admissions_v1
  WHERE request_identity=requested_request_identity;
  IF NOT FOUND
     OR hinted_admission.admission_identity<>requested_admission_identity
     OR hinted_admission.admission_digest<>requested_admission_digest
  THEN RETURN NULL; END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'binding_identity', binding.binding_identity,
      'generation', binding.generation,
      'authorization_identity', binding.authorization_identity,
      'issuance_receipt_identity', binding.issuance_receipt_identity,
      'authorization_frontier_identity', binding.authorization_frontier_identity,
      'binding_digest', binding.binding_digest
    ) ORDER BY binding.generation, binding.binding_identity), '[]'::jsonb)
  INTO hinted_binding_locators
  FROM public.product_edge_deployment_bindings_v1 binding
  WHERE binding.deployment_identity=hinted_admission.deployment_identity;

  FOR requirement IN
    SELECT authorization_identity, issuance_receipt_identity
    FROM (
      SELECT binding.authorization_identity, binding.issuance_receipt_identity
      FROM public.product_edge_deployment_bindings_v1 binding
      WHERE binding.deployment_identity=hinted_admission.deployment_identity
      UNION
      SELECT hinted_admission.authorization_identity, hinted_admission.issuance_receipt_identity
    ) locator
    ORDER BY authorization_identity, issuance_receipt_identity
  LOOP
    SELECT operator_authorization_api.lock_current_authorization_v1(
      requirement.authorization_identity,
      requirement.issuance_receipt_identity
    ) INTO authorization_envelope;
    IF authorization_envelope IS NULL THEN RETURN NULL; END IF;
    authorization_envelopes := authorization_envelopes || jsonb_build_array(jsonb_build_object(
      'authorization_identity', requirement.authorization_identity,
      'issuance_receipt_identity', requirement.issuance_receipt_identity,
      'envelope', authorization_envelope
    ));
  END LOOP;

  PERFORM pg_catalog.pg_advisory_xact_lock_shared(pg_catalog.hashtextextended('deployment'||hinted_admission.deployment_identity, 0));
  PERFORM pg_catalog.pg_advisory_xact_lock_shared(pg_catalog.hashtextextended('request'||requested_request_identity, 0));

  SELECT * INTO locked_admission
  FROM public.product_edge_request_admissions_v1
  WHERE request_identity=requested_request_identity
  FOR SHARE;
  IF NOT FOUND OR to_jsonb(locked_admission)<>to_jsonb(hinted_admission) THEN RETURN NULL; END IF;

  PERFORM binding.binding_identity
  FROM public.product_edge_deployment_bindings_v1 binding
  WHERE binding.deployment_identity=locked_admission.deployment_identity
  ORDER BY binding.generation, binding.binding_identity
  FOR SHARE;
  SELECT to_jsonb(head) INTO locked_head
  FROM public.product_edge_deployment_heads_v1 head
  WHERE head.deployment_identity=locked_admission.deployment_identity
  FOR SHARE;
  PERFORM supersession.binding_identity
  FROM public.product_edge_deployment_supersessions_v1 supersession
  JOIN public.product_edge_deployment_bindings_v1 binding ON binding.binding_identity=supersession.binding_identity
  WHERE binding.deployment_identity=locked_admission.deployment_identity
  ORDER BY supersession.binding_identity
  FOR SHARE OF supersession;
  PERFORM locator.binding_identity
  FROM public.product_edge_binding_manifests_v1 locator
  JOIN public.product_edge_deployment_bindings_v1 binding ON binding.binding_identity=locator.binding_identity
  WHERE binding.deployment_identity=locked_admission.deployment_identity
  ORDER BY locator.binding_identity, locator.manifest_identity
  FOR SHARE OF locator;
  PERFORM manifest.manifest_identity
  FROM public.product_edge_operation_manifests_v1 manifest
  JOIN public.product_edge_binding_manifests_v1 locator ON locator.manifest_identity=manifest.manifest_identity
  JOIN public.product_edge_deployment_bindings_v1 binding ON binding.binding_identity=locator.binding_identity
  WHERE binding.deployment_identity=locked_admission.deployment_identity
  ORDER BY manifest.manifest_identity
  FOR SHARE OF manifest;
  PERFORM outbox.event_identity
  FROM public.product_edge_owner_outbox_v1 outbox
  WHERE (outbox.aggregate_identity=locked_admission.admission_identity
         AND outbox.event_kind='PRODUCT_EDGE_REQUEST_ADMITTED_V1')
     OR (outbox.aggregate_identity IN (
       SELECT binding.binding_identity FROM public.product_edge_deployment_bindings_v1 binding
       WHERE binding.deployment_identity=locked_admission.deployment_identity
     ) AND outbox.event_kind IN ('PRODUCT_EDGE_DEPLOYMENT_BINDING_ACTIVE_V1','PRODUCT_EDGE_DEPLOYMENT_BINDING_SUPERSEDED_V1'))
     OR (outbox.aggregate_identity IN (
       SELECT locator.manifest_identity
       FROM public.product_edge_binding_manifests_v1 locator
       JOIN public.product_edge_deployment_bindings_v1 binding ON binding.binding_identity=locator.binding_identity
       WHERE binding.deployment_identity=locked_admission.deployment_identity
     ) AND outbox.event_kind='PRODUCT_EDGE_OPERATION_MANIFEST_APPROVED_V1')
  ORDER BY outbox.event_identity
  FOR SHARE;

  RETURN jsonb_build_object(
    'hinted_admission', to_jsonb(hinted_admission),
    'hinted_binding_locators', hinted_binding_locators,
    'admission', to_jsonb(locked_admission),
    'bindings', COALESCE((SELECT jsonb_agg(to_jsonb(binding) ORDER BY binding.generation, binding.binding_identity) FROM public.product_edge_deployment_bindings_v1 binding WHERE binding.deployment_identity=locked_admission.deployment_identity), '[]'::jsonb),
    'head', locked_head,
    'supersessions', COALESCE((SELECT jsonb_agg(to_jsonb(supersession) ORDER BY supersession.binding_identity) FROM public.product_edge_deployment_supersessions_v1 supersession JOIN public.product_edge_deployment_bindings_v1 binding ON binding.binding_identity=supersession.binding_identity WHERE binding.deployment_identity=locked_admission.deployment_identity), '[]'::jsonb),
    'binding_manifests', COALESCE((SELECT jsonb_agg(to_jsonb(locator) ORDER BY locator.binding_identity, locator.manifest_identity) FROM public.product_edge_binding_manifests_v1 locator JOIN public.product_edge_deployment_bindings_v1 binding ON binding.binding_identity=locator.binding_identity WHERE binding.deployment_identity=locked_admission.deployment_identity), '[]'::jsonb),
    'manifests', COALESCE((SELECT jsonb_agg(to_jsonb(manifest) ORDER BY manifest.manifest_identity) FROM public.product_edge_operation_manifests_v1 manifest WHERE manifest.manifest_identity IN (SELECT locator.manifest_identity FROM public.product_edge_binding_manifests_v1 locator JOIN public.product_edge_deployment_bindings_v1 binding ON binding.binding_identity=locator.binding_identity WHERE binding.deployment_identity=locked_admission.deployment_identity)), '[]'::jsonb),
    'outboxes', COALESCE((SELECT jsonb_agg(to_jsonb(outbox) ORDER BY outbox.event_identity) FROM public.product_edge_owner_outbox_v1 outbox WHERE (outbox.aggregate_identity=locked_admission.admission_identity AND outbox.event_kind='PRODUCT_EDGE_REQUEST_ADMITTED_V1') OR (outbox.aggregate_identity IN (SELECT binding.binding_identity FROM public.product_edge_deployment_bindings_v1 binding WHERE binding.deployment_identity=locked_admission.deployment_identity) AND outbox.event_kind IN ('PRODUCT_EDGE_DEPLOYMENT_BINDING_ACTIVE_V1','PRODUCT_EDGE_DEPLOYMENT_BINDING_SUPERSEDED_V1')) OR (outbox.aggregate_identity IN (SELECT locator.manifest_identity FROM public.product_edge_binding_manifests_v1 locator JOIN public.product_edge_deployment_bindings_v1 binding ON binding.binding_identity=locator.binding_identity WHERE binding.deployment_identity=locked_admission.deployment_identity) AND outbox.event_kind='PRODUCT_EDGE_OPERATION_MANIFEST_APPROVED_V1')), '[]'::jsonb),
    'authorizations', authorization_envelopes
  );
END
$function$;
ALTER FUNCTION product_edge_api.lock_downstream_admission_v1(text,text,text) OWNER TO product_edge_owner;
REVOKE ALL ON FUNCTION product_edge_api.lock_downstream_admission_v1(text,text,text) FROM PUBLIC, operator_authorization_writer, portfolio_owner;
GRANT EXECUTE ON FUNCTION product_edge_api.lock_downstream_admission_v1(text,text,text) TO rd_owner, product_edge_owner;

CREATE OR REPLACE FUNCTION product_edge_api.lock_source_invocation_state_v1(
  requested_request_identity text,
  requested_admission_identity text,
  requested_attempt_identity text,
  requested_state text
)
RETURNS jsonb LANGUAGE plpgsql STRICT VOLATILE PARALLEL UNSAFE SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  locked_admission record;
  locked_claim record;
  locked_state record;
  admission_outbox jsonb;
  claim_outbox jsonb;
  claimed_state_outbox jsonb;
  current_state_outbox jsonb;
BEGIN
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed'
     OR requested_state NOT IN ('CLAIMED','INVOCATION_STARTED')
  THEN RETURN NULL; END IF;

  SELECT receipt_identity, receipt_digest, admission_identity, attempt_identity,
         claim_identity, receipt_json, write_cut_epoch_ms
    INTO locked_admission
    FROM public.product_edge_effect_invocation_admissions_v1
   WHERE admission_identity = requested_admission_identity
     AND attempt_identity = requested_attempt_identity
     AND receipt_json->>'request_identity' = requested_request_identity
     AND receipt_json->>'effect' = 'R_AND_D_SOURCE_PROVIDER_INVOCATION_V1'
   FOR SHARE;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT admission_identity, claim_identity, attempt_identity, claim_digest,
         claim_json, committed_at_epoch_ms
    INTO locked_claim
    FROM public.product_edge_effect_invocation_claims_v1
   WHERE admission_identity = requested_admission_identity
     AND attempt_identity = requested_attempt_identity
     AND claim_identity = locked_admission.claim_identity
   FOR SHARE;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT claim_identity, admission_identity, attempt_identity, claim_digest,
         state_digest, state_json, updated_at_epoch_ms
    INTO locked_state
    FROM public.product_edge_effect_invocation_states_v1
   WHERE claim_identity = locked_claim.claim_identity
     AND admission_identity = requested_admission_identity
     AND attempt_identity = requested_attempt_identity
     AND state_json->>'state' = requested_state
   FOR SHARE;
  IF NOT FOUND THEN RETURN NULL; END IF;

  PERFORM event_identity
    FROM public.product_edge_owner_outbox_v1
   WHERE (aggregate_identity = requested_admission_identity
          AND event_kind IN ('PRODUCT_EDGE_PROVIDER_INVOCATION_ADMITTED_V1','PRODUCT_EDGE_PROVIDER_INVOCATION_CLAIMED_V1'))
      OR (aggregate_identity = locked_claim.claim_identity
          AND event_kind IN ('PRODUCT_EDGE_PROVIDER_INVOCATION_CLAIM_STATE_V1','PRODUCT_EDGE_PROVIDER_INVOCATION_STARTED_V1'))
   ORDER BY event_identity
   FOR SHARE;

  SELECT CASE WHEN pg_catalog.count(*) = 1
              THEN (pg_catalog.jsonb_agg(pg_catalog.to_jsonb(outbox) ORDER BY event_identity))->0 END
    INTO admission_outbox
    FROM public.product_edge_owner_outbox_v1 outbox
   WHERE aggregate_identity = requested_admission_identity
     AND event_kind = 'PRODUCT_EDGE_PROVIDER_INVOCATION_ADMITTED_V1';
  SELECT CASE WHEN pg_catalog.count(*) = 1
              THEN (pg_catalog.jsonb_agg(pg_catalog.to_jsonb(outbox) ORDER BY event_identity))->0 END
    INTO claim_outbox
    FROM public.product_edge_owner_outbox_v1 outbox
   WHERE aggregate_identity = requested_admission_identity
     AND event_kind = 'PRODUCT_EDGE_PROVIDER_INVOCATION_CLAIMED_V1';
  SELECT CASE WHEN pg_catalog.count(*) = 1
              THEN (pg_catalog.jsonb_agg(pg_catalog.to_jsonb(outbox) ORDER BY event_identity))->0 END
    INTO claimed_state_outbox
    FROM public.product_edge_owner_outbox_v1 outbox
   WHERE aggregate_identity = locked_claim.claim_identity
     AND event_kind = 'PRODUCT_EDGE_PROVIDER_INVOCATION_CLAIM_STATE_V1';
  SELECT CASE WHEN pg_catalog.count(*) = 1
              THEN (pg_catalog.jsonb_agg(pg_catalog.to_jsonb(outbox) ORDER BY event_identity))->0 END
    INTO current_state_outbox
    FROM public.product_edge_owner_outbox_v1 outbox
   WHERE aggregate_identity = locked_claim.claim_identity
     AND event_kind = CASE requested_state
       WHEN 'CLAIMED' THEN 'PRODUCT_EDGE_PROVIDER_INVOCATION_CLAIM_STATE_V1'
       ELSE 'PRODUCT_EDGE_PROVIDER_INVOCATION_STARTED_V1' END;
  IF admission_outbox IS NULL OR claim_outbox IS NULL
     OR claimed_state_outbox IS NULL OR current_state_outbox IS NULL
  THEN RETURN NULL; END IF;

  RETURN pg_catalog.jsonb_build_object(
    'schema_version', 1,
    'admission', pg_catalog.to_jsonb(locked_admission),
    'claim', pg_catalog.to_jsonb(locked_claim),
    'state', pg_catalog.to_jsonb(locked_state),
    'admission_outbox', admission_outbox,
    'claim_outbox', claim_outbox,
    'claimed_state_outbox', claimed_state_outbox,
    'current_state_outbox', current_state_outbox
  );
END
$function$;
ALTER FUNCTION product_edge_api.lock_source_invocation_state_v1(text,text,text,text) OWNER TO product_edge_owner;
REVOKE ALL ON FUNCTION product_edge_api.lock_source_invocation_state_v1(text,text,text,text) FROM PUBLIC, rd_owner, operator_authorization_writer, qualification_owner, qualification_writer, portfolio_owner;

CREATE OR REPLACE FUNCTION product_edge_api.lock_source_invocation_claim_v1(
  requested_request_identity text,
  requested_admission_identity text,
  requested_attempt_identity text
)
RETURNS jsonb LANGUAGE sql STRICT VOLATILE PARALLEL UNSAFE SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT product_edge_api.lock_source_invocation_state_v1($1,$2,$3,'CLAIMED')
$function$;
ALTER FUNCTION product_edge_api.lock_source_invocation_claim_v1(text,text,text) OWNER TO product_edge_owner;
REVOKE ALL ON FUNCTION product_edge_api.lock_source_invocation_claim_v1(text,text,text) FROM PUBLIC, operator_authorization_writer, qualification_owner, qualification_writer, portfolio_owner;
GRANT EXECUTE ON FUNCTION product_edge_api.lock_source_invocation_claim_v1(text,text,text) TO rd_owner, product_edge_owner;

CREATE OR REPLACE FUNCTION product_edge_api.lock_source_invocation_started_v1(
  requested_request_identity text,
  requested_admission_identity text,
  requested_attempt_identity text
)
RETURNS jsonb LANGUAGE sql STRICT VOLATILE PARALLEL UNSAFE SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT product_edge_api.lock_source_invocation_state_v1($1,$2,$3,'INVOCATION_STARTED')
$function$;
ALTER FUNCTION product_edge_api.lock_source_invocation_started_v1(text,text,text) OWNER TO product_edge_owner;
REVOKE ALL ON FUNCTION product_edge_api.lock_source_invocation_started_v1(text,text,text) FROM PUBLIC, operator_authorization_writer, qualification_owner, qualification_writer, portfolio_owner;
GRANT EXECUTE ON FUNCTION product_edge_api.lock_source_invocation_started_v1(text,text,text) TO rd_owner, product_edge_owner;

CREATE OR REPLACE FUNCTION product_edge_api.lock_portfolio_read_policy_v1(
  requested_grant_identity text,
  requested_grant_receipt_identity text,
  requested_request_identity text,
  requested_admission_identity text,
  requested_admission_digest text
)
RETURNS jsonb LANGUAGE plpgsql STRICT VOLATILE PARALLEL UNSAFE SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  operator_authorization_envelope jsonb;
  product_edge_envelope jsonb;
BEGIN
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN RETURN NULL; END IF;

  SELECT operator_authorization_api.lock_current_portfolio_resource_grant_v1(
    requested_grant_identity,
    requested_grant_receipt_identity
  ) INTO operator_authorization_envelope;
  IF operator_authorization_envelope IS NULL THEN RETURN NULL; END IF;

  SELECT product_edge_api.lock_downstream_admission_v1(
    requested_request_identity,
    requested_admission_identity,
    requested_admission_digest
  ) INTO product_edge_envelope;
  IF product_edge_envelope IS NULL THEN RETURN NULL; END IF;

  RETURN pg_catalog.jsonb_build_object(
    'operator_authorization', operator_authorization_envelope,
    'product_edge', product_edge_envelope
  );
END
$function$;
ALTER FUNCTION product_edge_api.lock_portfolio_read_policy_v1(text,text,text,text,text) OWNER TO product_edge_owner;
REVOKE ALL ON FUNCTION product_edge_api.lock_portfolio_read_policy_v1(text,text,text,text,text) FROM PUBLIC, rd_owner, operator_authorization_writer, qualification_owner, qualification_writer;
GRANT EXECUTE ON FUNCTION product_edge_api.lock_portfolio_read_policy_v1(text,text,text,text,text) TO portfolio_owner;
COMMIT;
SQL
