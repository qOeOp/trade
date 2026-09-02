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
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rd_database_owner') THEN CREATE ROLE rd_database_owner NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rd_custodian') THEN CREATE ROLE rd_custodian NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'product_edge_custodian') THEN CREATE ROLE product_edge_custodian NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'replay_policy_catalog_owner') THEN CREATE ROLE replay_policy_catalog_owner NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'composer_owner') THEN CREATE ROLE composer_owner NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rd_owner') THEN CREATE ROLE rd_owner LOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rd_fact_writer') THEN CREATE ROLE rd_fact_writer LOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'operator_authorization_owner') THEN CREATE ROLE operator_authorization_owner NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'operator_authorization_writer') THEN CREATE ROLE operator_authorization_writer LOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'qualification_owner') THEN CREATE ROLE qualification_owner NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'qualification_writer') THEN CREATE ROLE qualification_writer LOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'product_edge_owner') THEN CREATE ROLE product_edge_owner LOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'backtest_owner') THEN CREATE ROLE backtest_owner LOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'portfolio_owner') THEN CREATE ROLE portfolio_owner NOLOGIN; END IF;
END
$roles$;
ALTER ROLE rd_database_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE rd_custodian NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE product_edge_custodian NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE replay_policy_catalog_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE composer_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE rd_owner LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD :'rd_password';
ALTER ROLE rd_fact_writer LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE operator_authorization_owner NOLOGIN;
ALTER ROLE operator_authorization_writer LOGIN PASSWORD :'issuer_password';
ALTER ROLE qualification_owner NOLOGIN;
ALTER ROLE qualification_writer LOGIN PASSWORD :'qualification_password';
ALTER ROLE product_edge_owner LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD :'edge_password';
ALTER ROLE backtest_owner LOGIN PASSWORD :'backtest_password';
ALTER ROLE portfolio_owner NOLOGIN;
GRANT operator_authorization_owner TO operator_authorization_writer;
REVOKE portfolio_owner FROM product_edge_owner;
REVOKE operator_authorization_owner FROM product_edge_owner, rd_owner;
REVOKE qualification_owner FROM qualification_writer, product_edge_owner, rd_owner, operator_authorization_writer;
REVOKE rd_owner, product_edge_owner, qualification_owner, operator_authorization_owner, portfolio_owner FROM backtest_owner;
DO $isolate_rd_authority_roles$
DECLARE authority_role text; membership record;
BEGIN
  FOREACH authority_role IN ARRAY ARRAY['rd_database_owner','rd_custodian','product_edge_custodian','replay_policy_catalog_owner','composer_owner','rd_fact_writer','rd_owner','qualification_owner','qualification_writer'] LOOP
    FOR membership IN
      SELECT granted.rolname AS granted_role, member.rolname AS member_role
      FROM pg_catalog.pg_auth_members edge
      JOIN pg_catalog.pg_roles granted ON granted.oid=edge.roleid
      JOIN pg_catalog.pg_roles member ON member.oid=edge.member
      WHERE granted.rolname=authority_role OR member.rolname=authority_role
    LOOP
      EXECUTE pg_catalog.format('REVOKE %I FROM %I',membership.granted_role,membership.member_role);
    END LOOP;
  END LOOP;
END
$isolate_rd_authority_roles$;
REVOKE replay_policy_catalog_owner, composer_owner, rd_database_owner, rd_custodian, product_edge_custodian FROM rd_owner, product_edge_owner, qualification_owner, qualification_writer, operator_authorization_owner, operator_authorization_writer, portfolio_owner, backtest_owner;
REVOKE rd_owner, product_edge_owner, qualification_owner, qualification_writer, operator_authorization_owner, operator_authorization_writer, portfolio_owner, backtest_owner FROM replay_policy_catalog_owner, composer_owner, rd_database_owner;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
DO $database_owner$
BEGIN
  EXECUTE pg_catalog.format('ALTER DATABASE %I OWNER TO rd_database_owner', pg_catalog.current_database());
END
$database_owner$;
DO $database_acl_cutover$
DECLARE grantee_name text;
BEGIN
  EXECUTE pg_catalog.format('REVOKE ALL PRIVILEGES ON DATABASE %I FROM PUBLIC',pg_catalog.current_database());
  FOR grantee_name IN
    SELECT DISTINCT role.rolname FROM pg_catalog.pg_database database
    CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(database.datacl,pg_catalog.acldefault('d',database.datdba))) acl
    JOIN pg_catalog.pg_roles role ON role.oid=acl.grantee
    WHERE database.datname=pg_catalog.current_database() AND acl.grantee<>database.datdba
  LOOP EXECUTE pg_catalog.format('REVOKE ALL PRIVILEGES ON DATABASE %I FROM %I',pg_catalog.current_database(),grantee_name); END LOOP;
  EXECUTE pg_catalog.format(
    'GRANT CONNECT ON DATABASE %I TO rd_owner, rd_fact_writer, operator_authorization_writer, qualification_writer, product_edge_owner, backtest_owner',
    pg_catalog.current_database()
  );
END
$database_acl_cutover$;
DO $database_acl_readback$
DECLARE exact boolean;
BEGIN
  WITH expected(role_name,privilege_type,is_grantable,grantor_name) AS (VALUES
    ('rd_owner','CONNECT',false,'rd_database_owner'),('rd_fact_writer','CONNECT',false,'rd_database_owner'),
    ('operator_authorization_writer','CONNECT',false,'rd_database_owner'),('qualification_writer','CONNECT',false,'rd_database_owner'),
    ('product_edge_owner','CONNECT',false,'rd_database_owner'),('backtest_owner','CONNECT',false,'rd_database_owner')
  ), actual AS (
    SELECT COALESCE(role.rolname,'PUBLIC'),acl.privilege_type,acl.is_grantable,pg_catalog.pg_get_userbyid(acl.grantor)
    FROM pg_catalog.pg_database database
    CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(database.datacl,pg_catalog.acldefault('d',database.datdba))) acl
    LEFT JOIN pg_catalog.pg_roles role ON role.oid=acl.grantee
    WHERE database.datname=pg_catalog.current_database() AND acl.grantee<>database.datdba
  )
  SELECT pg_catalog.pg_get_userbyid(database.datdba)='rd_database_owner'
    AND NOT EXISTS((SELECT * FROM expected EXCEPT SELECT * FROM actual) UNION ALL (SELECT * FROM actual EXCEPT SELECT * FROM expected))
  INTO exact FROM pg_catalog.pg_database database WHERE database.datname=pg_catalog.current_database();
  IF exact IS DISTINCT FROM true THEN RAISE EXCEPTION 'R&D database ACL manifest mismatch'; END IF;
END
$database_acl_readback$;
ALTER SCHEMA public OWNER TO rd_database_owner;
CREATE SCHEMA IF NOT EXISTS operator_authorization_private AUTHORIZATION operator_authorization_owner;
CREATE SCHEMA IF NOT EXISTS operator_authorization_api AUTHORIZATION operator_authorization_owner;
ALTER SCHEMA operator_authorization_private OWNER TO operator_authorization_owner;
ALTER SCHEMA operator_authorization_api OWNER TO operator_authorization_owner;
REVOKE ALL ON SCHEMA operator_authorization_private FROM PUBLIC, rd_owner, product_edge_owner, portfolio_owner;
REVOKE ALL ON SCHEMA operator_authorization_api FROM PUBLIC, rd_owner, product_edge_owner, portfolio_owner;
GRANT USAGE ON SCHEMA operator_authorization_api TO product_edge_owner;
REVOKE CREATE ON SCHEMA public FROM rd_owner, product_edge_owner;
GRANT USAGE ON SCHEMA public TO rd_owner, product_edge_owner;
GRANT USAGE ON SCHEMA public TO qualification_writer;
CREATE SCHEMA IF NOT EXISTS product_edge_api AUTHORIZATION product_edge_custodian;
ALTER SCHEMA product_edge_api OWNER TO product_edge_custodian;
CREATE SCHEMA IF NOT EXISTS rd_owner_api AUTHORIZATION rd_custodian;
ALTER SCHEMA rd_owner_api OWNER TO rd_custodian;
DO $normalize_runtime_api_schema_acl$
DECLARE schema_fact record; grantee_fact record;
BEGIN
  FOR schema_fact IN
    SELECT namespace.oid, namespace.nspname, namespace.nspowner
    FROM pg_catalog.pg_namespace namespace
    WHERE namespace.nspname IN ('product_edge_api','rd_owner_api')
  LOOP
    EXECUTE pg_catalog.format('REVOKE ALL ON SCHEMA %I FROM PUBLIC',schema_fact.nspname);
    FOR grantee_fact IN
      SELECT DISTINCT role.rolname
      FROM pg_catalog.aclexplode(COALESCE((SELECT nspacl FROM pg_catalog.pg_namespace WHERE oid=schema_fact.oid),pg_catalog.acldefault('n',schema_fact.nspowner))) acl
      JOIN pg_catalog.pg_roles role ON role.oid=acl.grantee
      WHERE acl.grantee<>schema_fact.nspowner
    LOOP
      EXECUTE pg_catalog.format('REVOKE ALL ON SCHEMA %I FROM %I',schema_fact.nspname,grantee_fact.rolname);
    END LOOP;
  END LOOP;
END
$normalize_runtime_api_schema_acl$;
GRANT USAGE ON SCHEMA product_edge_api TO product_edge_owner, rd_owner, portfolio_owner;
GRANT USAGE ON SCHEMA rd_owner_api TO rd_owner, product_edge_owner, qualification_writer, backtest_owner;
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
DO $qualification_closed_manifest$
DECLARE relation_fact record; relation_seal text; grantee_fact record;
BEGIN
  IF (SELECT pg_catalog.array_agg(namespace.nspname||':'||relation.relname||':'||relation.relkind::text||':'||relation.relpersistence::text||':'||pg_catalog.pg_get_userbyid(relation.relowner) ORDER BY namespace.nspname,relation.relname) FROM pg_catalog.pg_class relation JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace WHERE namespace.nspname='public' AND relation.relname LIKE 'qualification\_%' ESCAPE '\') IS DISTINCT FROM ARRAY['public:qualification_owner_outbox_v1:r:p:qualification_owner','public:qualification_owner_outbox_v1_aggregate_identity_event_kind_key:i:p:qualification_owner','public:qualification_owner_outbox_v1_pkey:i:p:qualification_owner','public:qualification_protected_feedback_basis_history_v1:i:p:qualification_owner','public:qualification_protected_feedback_heads_v1:r:p:qualification_owner','public:qualification_protected_feedback_heads_v1_frontier_identity_key:i:p:qualification_owner','public:qualification_protected_feedback_heads_v1_pkey:i:p:qualification_owner','public:qualification_protected_feedback_projections_v1:r:p:qualification_owner','public:qualification_protected_feedback_projections_v1_pkey:i:p:qualification_owner']::text[]
  OR EXISTS (
    WITH expected(relation_name,ordinal,column_name,type_name,typmod,not_null,default_expression,identity_kind,generated_kind) AS (VALUES
      ('qualification_protected_feedback_projections_v1',1,'projection_identity','text',-1,true,NULL::text,''::"char",''::"char"),('qualification_protected_feedback_projections_v1',2,'basis_identity','text',-1,true,NULL::text,''::"char",''::"char"),('qualification_protected_feedback_projections_v1',3,'principal','text',-1,true,NULL::text,''::"char",''::"char"),('qualification_protected_feedback_projections_v1',4,'request_scope_json','jsonb',-1,true,NULL::text,''::"char",''::"char"),('qualification_protected_feedback_projections_v1',5,'resolution_state','text',-1,true,NULL::text,''::"char",''::"char"),('qualification_protected_feedback_projections_v1',6,'source_sequence','bigint',-1,true,NULL::text,''::"char",''::"char"),('qualification_protected_feedback_projections_v1',7,'source_cut','text',-1,true,NULL::text,''::"char",''::"char"),('qualification_protected_feedback_projections_v1',8,'projection_digest','text',-1,true,NULL::text,''::"char",''::"char"),('qualification_protected_feedback_projections_v1',9,'projection_json','jsonb',-1,true,NULL::text,''::"char",''::"char"),('qualification_protected_feedback_projections_v1',10,'receipt_json','jsonb',-1,true,NULL::text,''::"char",''::"char"),('qualification_protected_feedback_projections_v1',11,'committed_at_epoch_ms','bigint',-1,true,NULL::text,''::"char",''::"char"),('qualification_protected_feedback_projections_v1',12,'valid_through_epoch_ms','bigint',-1,true,NULL::text,''::"char",''::"char"),
      ('qualification_protected_feedback_heads_v1',1,'principal_scope_key','text',-1,true,NULL::text,''::"char",''::"char"),('qualification_protected_feedback_heads_v1',2,'principal','text',-1,true,NULL::text,''::"char",''::"char"),('qualification_protected_feedback_heads_v1',3,'request_scope_json','jsonb',-1,true,NULL::text,''::"char",''::"char"),('qualification_protected_feedback_heads_v1',4,'frontier_identity','text',-1,true,NULL::text,''::"char",''::"char"),('qualification_protected_feedback_heads_v1',5,'frontier_digest','text',-1,true,NULL::text,''::"char",''::"char"),('qualification_protected_feedback_heads_v1',6,'source_sequence','bigint',-1,true,NULL::text,''::"char",''::"char"),('qualification_protected_feedback_heads_v1',7,'source_cut','text',-1,true,NULL::text,''::"char",''::"char"),('qualification_protected_feedback_heads_v1',8,'committed_at_epoch_ms','bigint',-1,true,NULL::text,''::"char",''::"char"),
      ('qualification_owner_outbox_v1',1,'event_identity','text',-1,true,NULL::text,''::"char",''::"char"),('qualification_owner_outbox_v1',2,'aggregate_identity','text',-1,true,NULL::text,''::"char",''::"char"),('qualification_owner_outbox_v1',3,'event_kind','text',-1,true,NULL::text,''::"char",''::"char"),('qualification_owner_outbox_v1',4,'payload_digest','text',-1,true,NULL::text,''::"char",''::"char"),('qualification_owner_outbox_v1',5,'payload_json','jsonb',-1,true,NULL::text,''::"char",''::"char"),('qualification_owner_outbox_v1',6,'committed_at_epoch_ms','bigint',-1,true,NULL::text,''::"char",''::"char")
    ), actual AS (
      SELECT relation.relname,attribute.attnum,attribute.attname,pg_catalog.format_type(attribute.atttypid,attribute.atttypmod),attribute.atttypmod,attribute.attnotnull,pg_catalog.pg_get_expr(default_fact.adbin,default_fact.adrelid),attribute.attidentity,attribute.attgenerated
      FROM pg_catalog.pg_class relation JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace JOIN pg_catalog.pg_attribute attribute ON attribute.attrelid=relation.oid LEFT JOIN pg_catalog.pg_attrdef default_fact ON default_fact.adrelid=attribute.attrelid AND default_fact.adnum=attribute.attnum
      WHERE namespace.nspname='public' AND relation.relname LIKE 'qualification\_%' ESCAPE '\' AND relation.relkind='r' AND attribute.attnum>0 AND NOT attribute.attisdropped
    ) SELECT * FROM expected EXCEPT SELECT * FROM actual UNION ALL SELECT * FROM actual EXCEPT SELECT * FROM expected
  ) OR EXISTS (
    WITH expected(relation_name,constraint_type,definition) AS (VALUES
      ('qualification_protected_feedback_projections_v1','p'::"char",'PRIMARY KEY (projection_identity)'),
      ('qualification_protected_feedback_heads_v1','f'::"char",'FOREIGN KEY (frontier_identity) REFERENCES qualification_protected_feedback_projections_v1(projection_identity)'),('qualification_protected_feedback_heads_v1','p'::"char",'PRIMARY KEY (principal_scope_key)'),('qualification_protected_feedback_heads_v1','u'::"char",'UNIQUE (frontier_identity)'),
      ('qualification_owner_outbox_v1','p'::"char",'PRIMARY KEY (event_identity)'),('qualification_owner_outbox_v1','u'::"char",'UNIQUE (aggregate_identity, event_kind)')
    ), actual AS (SELECT relation.relname,constraint_fact.contype,pg_catalog.pg_get_constraintdef(constraint_fact.oid,true) FROM pg_catalog.pg_constraint constraint_fact JOIN pg_catalog.pg_class relation ON relation.oid=constraint_fact.conrelid JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace WHERE namespace.nspname='public' AND relation.relname LIKE 'qualification\_%' ESCAPE '\')
    SELECT * FROM expected EXCEPT SELECT * FROM actual UNION ALL SELECT * FROM actual EXCEPT SELECT * FROM expected
  ) OR EXISTS (SELECT 1 FROM pg_catalog.pg_inherits inheritance WHERE inheritance.inhrelid IN (pg_catalog.to_regclass('public.qualification_protected_feedback_projections_v1'),pg_catalog.to_regclass('public.qualification_protected_feedback_heads_v1'),pg_catalog.to_regclass('public.qualification_owner_outbox_v1')) OR inheritance.inhparent IN (pg_catalog.to_regclass('public.qualification_protected_feedback_projections_v1'),pg_catalog.to_regclass('public.qualification_protected_feedback_heads_v1'),pg_catalog.to_regclass('public.qualification_owner_outbox_v1')))
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_publication_rel publication WHERE publication.prrelid IN (pg_catalog.to_regclass('public.qualification_protected_feedback_projections_v1'),pg_catalog.to_regclass('public.qualification_protected_feedback_heads_v1'),pg_catalog.to_regclass('public.qualification_owner_outbox_v1')))
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_publication publication WHERE publication.puballtables)
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_publication_namespace publication_schema WHERE publication_schema.pnnspid=pg_catalog.to_regnamespace('public'))
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_constraint foreign_key WHERE foreign_key.contype='f' AND foreign_key.confrelid IN (pg_catalog.to_regclass('public.qualification_protected_feedback_projections_v1'),pg_catalog.to_regclass('public.qualification_protected_feedback_heads_v1'),pg_catalog.to_regclass('public.qualification_owner_outbox_v1')) AND foreign_key.conrelid NOT IN (pg_catalog.to_regclass('public.qualification_protected_feedback_projections_v1'),pg_catalog.to_regclass('public.qualification_protected_feedback_heads_v1'),pg_catalog.to_regclass('public.qualification_owner_outbox_v1')))
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_depend dependency JOIN pg_catalog.pg_rewrite rewrite_fact ON dependency.classid='pg_catalog.pg_rewrite'::pg_catalog.regclass AND dependency.objid=rewrite_fact.oid WHERE dependency.refclassid='pg_catalog.pg_class'::pg_catalog.regclass AND dependency.refobjid IN (pg_catalog.to_regclass('public.qualification_protected_feedback_projections_v1'),pg_catalog.to_regclass('public.qualification_protected_feedback_heads_v1'),pg_catalog.to_regclass('public.qualification_owner_outbox_v1')) AND rewrite_fact.ev_class NOT IN (pg_catalog.to_regclass('public.qualification_protected_feedback_projections_v1'),pg_catalog.to_regclass('public.qualification_protected_feedback_heads_v1'),pg_catalog.to_regclass('public.qualification_owner_outbox_v1')))
    OR EXISTS (
      WITH expected(relation_name,is_primary,is_unique,key_columns,definition) AS (VALUES
        ('qualification_protected_feedback_projections_v1',true,true,ARRAY['projection_identity']::text[],'CREATE UNIQUE INDEX qualification_protected_feedback_projections_v1_pkey ON public.qualification_protected_feedback_projections_v1 USING btree (projection_identity)'),('qualification_protected_feedback_projections_v1',false,false,ARRAY['basis_identity','committed_at_epoch_ms','projection_identity']::text[],'CREATE INDEX qualification_protected_feedback_basis_history_v1 ON public.qualification_protected_feedback_projections_v1 USING btree (basis_identity, committed_at_epoch_ms, projection_identity)'),
        ('qualification_protected_feedback_heads_v1',true,true,ARRAY['principal_scope_key']::text[],'CREATE UNIQUE INDEX qualification_protected_feedback_heads_v1_pkey ON public.qualification_protected_feedback_heads_v1 USING btree (principal_scope_key)'),('qualification_protected_feedback_heads_v1',false,true,ARRAY['frontier_identity']::text[],'CREATE UNIQUE INDEX qualification_protected_feedback_heads_v1_frontier_identity_key ON public.qualification_protected_feedback_heads_v1 USING btree (frontier_identity)'),
        ('qualification_owner_outbox_v1',true,true,ARRAY['event_identity']::text[],'CREATE UNIQUE INDEX qualification_owner_outbox_v1_pkey ON public.qualification_owner_outbox_v1 USING btree (event_identity)'),('qualification_owner_outbox_v1',false,true,ARRAY['aggregate_identity','event_kind']::text[],'CREATE UNIQUE INDEX qualification_owner_outbox_v1_aggregate_identity_event_kind_key ON public.qualification_owner_outbox_v1 USING btree (aggregate_identity, event_kind)')
      ), actual AS (SELECT relation.relname,index_fact.indisprimary,index_fact.indisunique,ARRAY(SELECT pg_catalog.pg_get_indexdef(index_fact.indexrelid,ordinal,true) FROM pg_catalog.generate_series(1,index_fact.indnkeyatts) ordinal ORDER BY ordinal),pg_catalog.pg_get_indexdef(index_fact.indexrelid) FROM pg_catalog.pg_index index_fact JOIN pg_catalog.pg_class relation ON relation.oid=index_fact.indrelid JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace WHERE namespace.nspname='public' AND relation.relname LIKE 'qualification\_%' ESCAPE '\' AND index_fact.indexprs IS NULL AND index_fact.indpred IS NULL)
      SELECT * FROM expected EXCEPT SELECT * FROM actual UNION ALL SELECT * FROM actual EXCEPT SELECT * FROM expected
    )
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc routine WHERE routine.oid=pg_catalog.to_regprocedure('qualification_api.lock_projection_for_basis_v1(text,text,text,text,jsonb,text)') AND pg_catalog.pg_get_userbyid(routine.proowner)='qualification_owner' AND routine.prorettype=pg_catalog.to_regtype('jsonb') AND routine.prolang=(SELECT oid FROM pg_catalog.pg_language WHERE lanname='plpgsql') AND routine.pronargs=6 AND routine.prosecdef AND routine.proisstrict AND routine.provolatile='v' AND routine.proparallel='u' AND routine.proconfig=ARRAY['search_path=pg_catalog']::text[] AND pg_catalog.md5(routine.prosrc)='0df2d7dda2ac5d35a3711e0a4599ab99')
  THEN RAISE EXCEPTION 'Qualification committed column/constraint/dependency manifest mismatch'; END IF;
  IF EXISTS (
    SELECT 1 FROM (VALUES
      ('qualification_protected_feedback_projections_v1',ARRAY['projection_identity','basis_identity','principal','request_scope_json','resolution_state','source_sequence','source_cut','projection_digest','projection_json','receipt_json','committed_at_epoch_ms','valid_through_epoch_ms']::text[],2::bigint,1::bigint),
      ('qualification_protected_feedback_heads_v1',ARRAY['principal_scope_key','principal','request_scope_json','frontier_identity','frontier_digest','source_sequence','source_cut','committed_at_epoch_ms']::text[],2::bigint,3::bigint),
      ('qualification_owner_outbox_v1',ARRAY['event_identity','aggregate_identity','event_kind','payload_digest','payload_json','committed_at_epoch_ms']::text[],2::bigint,2::bigint)
    ) expected(name,columns,index_count,constraint_count)
    LEFT JOIN pg_catalog.pg_class relation ON relation.oid=pg_catalog.to_regclass('public.'||expected.name)
    WHERE relation.oid IS NULL OR relation.relkind<>'r' OR relation.relpersistence<>'p'
       OR (SELECT pg_catalog.array_agg(attribute.attname::text ORDER BY attribute.attnum) FROM pg_catalog.pg_attribute attribute WHERE attribute.attrelid=relation.oid AND attribute.attnum>0 AND NOT attribute.attisdropped)<>expected.columns
       OR (SELECT pg_catalog.count(*) FROM pg_catalog.pg_index index_fact WHERE index_fact.indrelid=relation.oid)<>expected.index_count
       OR (SELECT pg_catalog.count(*) FROM pg_catalog.pg_constraint constraint_fact WHERE constraint_fact.conrelid=relation.oid)<>expected.constraint_count
       OR relation.relrowsecurity OR relation.relforcerowsecurity
       OR EXISTS (SELECT 1 FROM pg_catalog.pg_trigger trigger_fact WHERE trigger_fact.tgrelid=relation.oid AND NOT trigger_fact.tgisinternal)
       OR EXISTS (SELECT 1 FROM pg_catalog.pg_rewrite rewrite_fact WHERE rewrite_fact.ev_class=relation.oid)
       OR EXISTS (SELECT 1 FROM pg_catalog.pg_policy policy_fact WHERE policy_fact.polrelid=relation.oid)
  ) THEN RAISE EXCEPTION 'Qualification closed relation manifest mismatch'; END IF;
  REVOKE ALL ON SCHEMA qualification_api FROM PUBLIC;
  FOR grantee_fact IN SELECT DISTINCT role.rolname FROM pg_catalog.pg_namespace namespace CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(namespace.nspacl,pg_catalog.acldefault('n',namespace.nspowner))) acl JOIN pg_catalog.pg_roles role ON role.oid=acl.grantee WHERE namespace.nspname='qualification_api' AND acl.grantee<>namespace.nspowner
  LOOP EXECUTE pg_catalog.format('REVOKE ALL ON SCHEMA qualification_api FROM %I',grantee_fact.rolname); END LOOP;
  GRANT USAGE ON SCHEMA qualification_api TO rd_owner, qualification_writer;
  FOR relation_fact IN SELECT relation.oid,relation.relname FROM pg_catalog.pg_class relation JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace WHERE namespace.nspname='public' AND relation.relname IN ('qualification_protected_feedback_projections_v1','qualification_protected_feedback_heads_v1','qualification_owner_outbox_v1')
  LOOP
    EXECUTE pg_catalog.format('REVOKE ALL ON TABLE public.%I FROM PUBLIC',relation_fact.relname);
    FOR grantee_fact IN SELECT DISTINCT role.rolname FROM pg_catalog.aclexplode(COALESCE((SELECT relacl FROM pg_catalog.pg_class WHERE oid=relation_fact.oid),pg_catalog.acldefault('r',(SELECT relowner FROM pg_catalog.pg_class WHERE oid=relation_fact.oid)))) acl JOIN pg_catalog.pg_roles role ON role.oid=acl.grantee WHERE acl.grantee<>(SELECT relowner FROM pg_catalog.pg_class WHERE oid=relation_fact.oid)
    LOOP EXECUTE pg_catalog.format('REVOKE ALL ON TABLE public.%I FROM %I',relation_fact.relname,grantee_fact.rolname); END LOOP;
    EXECUTE pg_catalog.format('GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.%I TO qualification_writer',relation_fact.relname);
    SELECT 'vibe-closed-relation-v2:'||pg_catalog.md5(pg_catalog.jsonb_build_object('columns',(SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(attribute.attnum,attribute.attname,attribute.atttypid::text,attribute.atttypmod,attribute.attnotnull,attribute.attidentity,attribute.attgenerated,pg_catalog.pg_get_expr(default_fact.adbin,default_fact.adrelid)) ORDER BY attribute.attnum) FROM pg_catalog.pg_attribute attribute LEFT JOIN pg_catalog.pg_attrdef default_fact ON default_fact.adrelid=attribute.attrelid AND default_fact.adnum=attribute.attnum WHERE attribute.attrelid=relation_fact.oid AND attribute.attnum>0 AND NOT attribute.attisdropped),'constraints',(SELECT pg_catalog.jsonb_agg(pg_catalog.pg_get_constraintdef(constraint_fact.oid,true) ORDER BY pg_catalog.pg_get_constraintdef(constraint_fact.oid,true)) FROM pg_catalog.pg_constraint constraint_fact WHERE constraint_fact.conrelid=relation_fact.oid),'indexes',(SELECT pg_catalog.jsonb_agg(pg_catalog.pg_get_indexdef(index_fact.indexrelid) ORDER BY pg_catalog.pg_get_indexdef(index_fact.indexrelid)) FROM pg_catalog.pg_index index_fact WHERE index_fact.indrelid=relation_fact.oid))::text) INTO relation_seal;
    EXECUTE pg_catalog.format('COMMENT ON TABLE public.%I IS %L',relation_fact.relname,relation_seal);
  END LOOP;
  REVOKE ALL ON FUNCTION qualification_api.lock_projection_for_basis_v1(text,text,text,text,jsonb,text) FROM PUBLIC;
  FOR grantee_fact IN SELECT DISTINCT role.rolname FROM pg_catalog.pg_proc procedure CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(procedure.proacl,pg_catalog.acldefault('f',procedure.proowner))) acl JOIN pg_catalog.pg_roles role ON role.oid=acl.grantee WHERE procedure.oid=pg_catalog.to_regprocedure('qualification_api.lock_projection_for_basis_v1(text,text,text,text,jsonb,text)') AND acl.grantee<>procedure.proowner
  LOOP EXECUTE pg_catalog.format('REVOKE ALL ON FUNCTION qualification_api.lock_projection_for_basis_v1(text,text,text,text,jsonb,text) FROM %I',grantee_fact.rolname); END LOOP;
  GRANT EXECUTE ON FUNCTION qualification_api.lock_projection_for_basis_v1(text,text,text,text,jsonb,text) TO rd_owner, qualification_writer;
  EXECUTE pg_catalog.format('COMMENT ON FUNCTION qualification_api.lock_projection_for_basis_v1(text,text,text,text,jsonb,text) IS %L','vibe-source-md5:'||pg_catalog.md5((SELECT prosrc FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure('qualification_api.lock_projection_for_basis_v1(text,text,text,text,jsonb,text)'))));
END
$qualification_closed_manifest$;

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
CREATE TABLE IF NOT EXISTS public.product_edge_admission_event_stream_v1 (stream_identity TEXT PRIMARY KEY, last_owner_sequence BIGINT NOT NULL CHECK (last_owner_sequence >= 0));
INSERT INTO public.product_edge_admission_event_stream_v1 (stream_identity,last_owner_sequence) VALUES ('product-edge.admission-events.v1',0) ON CONFLICT (stream_identity) DO NOTHING;
CREATE TABLE IF NOT EXISTS public.product_edge_admission_events_v1 (owner_sequence BIGINT PRIMARY KEY CHECK (owner_sequence > 0), event_identity TEXT NOT NULL UNIQUE REFERENCES public.product_edge_owner_outbox_v1(event_identity), predecessor_event_identity TEXT, assignment_mode TEXT NOT NULL);
ALTER TABLE public.product_edge_admission_events_v1 ADD COLUMN IF NOT EXISTS predecessor_event_identity TEXT;
ALTER TABLE public.product_edge_admission_events_v1 ADD COLUMN IF NOT EXISTS assignment_mode TEXT;
UPDATE public.product_edge_admission_events_v1 SET assignment_mode='REBUILT' WHERE assignment_mode IS NULL;
WITH baseline AS (SELECT COALESCE(MAX(owner_sequence),0) AS value,(ARRAY_AGG(event_identity ORDER BY owner_sequence DESC))[1] AS predecessor_event_identity FROM public.product_edge_admission_events_v1), ranked AS (SELECT outbox.event_identity,baseline.value+ROW_NUMBER() OVER (ORDER BY outbox.committed_at_epoch_ms,outbox.event_identity) AS value,COALESCE(LAG(outbox.event_identity) OVER (ORDER BY outbox.committed_at_epoch_ms,outbox.event_identity),baseline.predecessor_event_identity) AS predecessor_event_identity FROM public.product_edge_owner_outbox_v1 outbox CROSS JOIN baseline LEFT JOIN public.product_edge_admission_events_v1 event ON event.event_identity=outbox.event_identity WHERE outbox.event_kind='PRODUCT_EDGE_REQUEST_ADMITTED_V1' AND event.event_identity IS NULL) INSERT INTO public.product_edge_admission_events_v1 (owner_sequence,event_identity,predecessor_event_identity,assignment_mode) SELECT value,event_identity,predecessor_event_identity,'REBUILT' FROM ranked ON CONFLICT (event_identity) DO NOTHING;
WITH linked AS (SELECT owner_sequence,LAG(event_identity) OVER (ORDER BY owner_sequence) AS predecessor_event_identity FROM public.product_edge_admission_events_v1) UPDATE public.product_edge_admission_events_v1 event SET predecessor_event_identity=linked.predecessor_event_identity FROM linked WHERE event.owner_sequence=linked.owner_sequence AND event.owner_sequence>1 AND event.predecessor_event_identity IS NULL;
UPDATE public.product_edge_admission_event_stream_v1 SET last_owner_sequence=GREATEST(last_owner_sequence,COALESCE((SELECT MAX(owner_sequence) FROM public.product_edge_admission_events_v1),0)) WHERE stream_identity='product-edge.admission-events.v1';
CREATE TABLE IF NOT EXISTS public.product_edge_expired_manifest_recoveries_v1 (recovery_epoch_identity TEXT PRIMARY KEY CHECK (recovery_epoch_identity <> ''), recovery_epoch_digest TEXT NOT NULL UNIQUE CHECK (recovery_epoch_digest <> ''), predecessor_binding_identity TEXT NOT NULL REFERENCES public.product_edge_deployment_bindings_v1(binding_identity) CHECK (predecessor_binding_identity <> ''), successor_binding_identity TEXT NOT NULL UNIQUE REFERENCES public.product_edge_deployment_bindings_v1(binding_identity) CHECK (successor_binding_identity <> '' AND successor_binding_identity <> predecessor_binding_identity), recovery_json JSONB NOT NULL, committed_at_epoch_ms BIGINT NOT NULL CHECK (committed_at_epoch_ms >= 0));
DO $product_edge_admission_guard_provision$
DECLARE routine_count bigint; trigger_count bigint;
BEGIN
  SELECT count(*) INTO routine_count FROM pg_catalog.pg_proc routine WHERE routine.oid IN (pg_catalog.to_regprocedure('public.product_edge_reject_admission_event_mutation_v1()'),pg_catalog.to_regprocedure('public.product_edge_reject_admission_assignment_mutation_v1()'));
  SELECT count(*) INTO trigger_count FROM pg_catalog.pg_trigger trigger_fact WHERE NOT trigger_fact.tgisinternal AND (trigger_fact.tgname,trigger_fact.tgfoid,trigger_fact.tgrelid) IN (('product_edge_admission_event_immutable_v1',pg_catalog.to_regprocedure('public.product_edge_reject_admission_event_mutation_v1()'),pg_catalog.to_regclass('public.product_edge_owner_outbox_v1')),('product_edge_admission_assignment_immutable_v1',pg_catalog.to_regprocedure('public.product_edge_reject_admission_assignment_mutation_v1()'),pg_catalog.to_regclass('public.product_edge_admission_events_v1')));
  IF routine_count=0 AND trigger_count=0
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc routine WHERE routine.proname IN ('product_edge_reject_admission_event_mutation_v1','product_edge_reject_admission_assignment_mutation_v1'))
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger trigger_fact WHERE NOT trigger_fact.tgisinternal AND trigger_fact.tgname IN ('product_edge_admission_event_immutable_v1','product_edge_admission_assignment_immutable_v1'))
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class relation JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace WHERE namespace.nspname='public' AND relation.relname LIKE 'product\_edge\_%' ESCAPE '\' AND pg_catalog.obj_description(relation.oid,'pg_class') LIKE 'vibe-closed-relation-v2:%')
  THEN
    EXECUTE $ddl$CREATE FUNCTION public.product_edge_reject_admission_event_mutation_v1() RETURNS trigger LANGUAGE plpgsql AS $function$ BEGIN IF OLD.event_kind = 'PRODUCT_EDGE_REQUEST_ADMITTED_V1' OR (TG_OP = 'UPDATE' AND NEW.event_kind = 'PRODUCT_EDGE_REQUEST_ADMITTED_V1') THEN RAISE EXCEPTION 'product edge admission events are immutable' USING ERRCODE = '55000'; END IF; IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW; END $function$$ddl$;
    REVOKE ALL ON FUNCTION public.product_edge_reject_admission_event_mutation_v1() FROM PUBLIC;
    CREATE TRIGGER product_edge_admission_event_immutable_v1 BEFORE UPDATE OR DELETE ON public.product_edge_owner_outbox_v1 FOR EACH ROW EXECUTE FUNCTION public.product_edge_reject_admission_event_mutation_v1();
    EXECUTE $ddl$CREATE FUNCTION public.product_edge_reject_admission_assignment_mutation_v1() RETURNS trigger LANGUAGE plpgsql AS $function$ BEGIN RAISE EXCEPTION 'product edge admission event assignments are immutable' USING ERRCODE = '55000'; RETURN OLD; END $function$$ddl$;
    REVOKE ALL ON FUNCTION public.product_edge_reject_admission_assignment_mutation_v1() FROM PUBLIC;
    CREATE TRIGGER product_edge_admission_assignment_immutable_v1 BEFORE UPDATE OR DELETE ON public.product_edge_admission_events_v1 FOR EACH ROW EXECUTE FUNCTION public.product_edge_reject_admission_assignment_mutation_v1();
  END IF;
END
$product_edge_admission_guard_provision$;

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
    EXECUTE format('ALTER TABLE %I.%I OWNER TO rd_custodian', object.schemaname, object.tablename);
    EXECUTE format('REVOKE ALL ON TABLE %I.%I FROM PUBLIC, product_edge_owner, operator_authorization_writer, qualification_owner, qualification_writer, backtest_owner, portfolio_owner', object.schemaname, object.tablename);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %I.%I TO rd_owner', object.schemaname, object.tablename);
  END LOOP;
  FOR object IN SELECT sequence_schema AS schemaname, sequence_name FROM information_schema.sequences WHERE sequence_schema = 'public' AND sequence_name LIKE 'rd_%' LOOP
    EXECUTE format('ALTER SEQUENCE %I.%I OWNER TO rd_custodian', object.schemaname, object.sequence_name);
    EXECUTE format('GRANT USAGE, SELECT, UPDATE ON SEQUENCE %I.%I TO rd_owner', object.schemaname, object.sequence_name);
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
ALTER FUNCTION rd_owner_api.lock_independence_basis_for_qualification_v1(text,text,text,jsonb) OWNER TO rd_custodian;
REVOKE ALL ON FUNCTION rd_owner_api.lock_independence_basis_for_qualification_v1(text,text,text,jsonb) FROM PUBLIC, product_edge_owner, operator_authorization_writer, qualification_owner;
GRANT EXECUTE ON FUNCTION rd_owner_api.lock_independence_basis_for_qualification_v1(text,text,text,jsonb) TO qualification_writer;

DO $product_edge_ownership$
DECLARE object record;
BEGIN
  FOR object IN SELECT schemaname, tablename FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'product_edge_%' LOOP
    EXECUTE format('ALTER TABLE %I.%I OWNER TO product_edge_custodian', object.schemaname, object.tablename);
    EXECUTE format('REVOKE ALL ON TABLE %I.%I FROM PUBLIC, rd_owner, operator_authorization_writer, qualification_owner, qualification_writer, backtest_owner, portfolio_owner', object.schemaname, object.tablename);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %I.%I TO product_edge_owner', object.schemaname, object.tablename);
  END LOOP;
END
$product_edge_ownership$;

CREATE OR REPLACE FUNCTION product_edge_api.lock_legacy_prepared_attempt_drain_effects_v1()
RETURNS jsonb LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN RETURN NULL; END IF;
  LOCK TABLE public.product_edge_effect_invocation_admissions_v1 IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.product_edge_effect_invocation_claims_v1 IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.product_edge_effect_invocation_states_v1 IN SHARE ROW EXCLUSIVE MODE;
  RETURN pg_catalog.jsonb_build_object('schema_version', 1);
END
$function$;
ALTER FUNCTION product_edge_api.lock_legacy_prepared_attempt_drain_effects_v1() OWNER TO product_edge_custodian;
REVOKE ALL ON FUNCTION product_edge_api.lock_legacy_prepared_attempt_drain_effects_v1() FROM PUBLIC, operator_authorization_owner, operator_authorization_writer, qualification_owner, qualification_writer, backtest_owner, portfolio_owner;
GRANT EXECUTE ON FUNCTION product_edge_api.lock_legacy_prepared_attempt_drain_effects_v1() TO rd_owner, product_edge_owner;

CREATE OR REPLACE FUNCTION product_edge_api.read_legacy_prepared_attempt_absence_v1(
  requested_admission_identity text,
  requested_attempt_identity text
)
RETURNS jsonb LANGUAGE plpgsql STRICT VOLATILE PARALLEL UNSAFE SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  admission_count bigint;
  claim_count bigint;
  state_count bigint;
  provider_start_count bigint;
BEGIN
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN RETURN NULL; END IF;
  LOCK TABLE public.product_edge_effect_invocation_admissions_v1 IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.product_edge_effect_invocation_claims_v1 IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.product_edge_effect_invocation_states_v1 IN SHARE ROW EXCLUSIVE MODE;
  SELECT pg_catalog.count(*) INTO admission_count
    FROM public.product_edge_effect_invocation_admissions_v1
   WHERE admission_identity=requested_admission_identity OR attempt_identity=requested_attempt_identity;
  SELECT pg_catalog.count(*) INTO claim_count
    FROM public.product_edge_effect_invocation_claims_v1
   WHERE admission_identity=requested_admission_identity OR attempt_identity=requested_attempt_identity;
  SELECT pg_catalog.count(*) INTO state_count
    FROM public.product_edge_effect_invocation_states_v1
   WHERE admission_identity=requested_admission_identity OR attempt_identity=requested_attempt_identity;
  SELECT pg_catalog.count(*) INTO provider_start_count
    FROM public.product_edge_effect_invocation_states_v1
   WHERE (admission_identity=requested_admission_identity OR attempt_identity=requested_attempt_identity)
     AND state_json->>'state'='INVOCATION_STARTED';
  RETURN pg_catalog.jsonb_build_object(
    'schema_version', 1,
    'effect_invocation_admission_count', admission_count,
    'effect_invocation_claim_count', claim_count,
    'effect_invocation_state_count', state_count,
    'provider_start_custody_count', provider_start_count
  );
END
$function$;
ALTER FUNCTION product_edge_api.read_legacy_prepared_attempt_absence_v1(text,text) OWNER TO product_edge_custodian;
REVOKE ALL ON FUNCTION product_edge_api.read_legacy_prepared_attempt_absence_v1(text,text) FROM PUBLIC, operator_authorization_owner, operator_authorization_writer, qualification_owner, qualification_writer, backtest_owner, portfolio_owner;
GRANT EXECUTE ON FUNCTION product_edge_api.read_legacy_prepared_attempt_absence_v1(text,text) TO rd_owner, product_edge_owner;

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
ALTER FUNCTION product_edge_api.lock_downstream_admission_v1(text,text,text) OWNER TO product_edge_custodian;
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
ALTER FUNCTION product_edge_api.lock_source_invocation_state_v1(text,text,text,text) OWNER TO product_edge_custodian;
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
ALTER FUNCTION product_edge_api.lock_source_invocation_claim_v1(text,text,text) OWNER TO product_edge_custodian;
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
ALTER FUNCTION product_edge_api.lock_source_invocation_started_v1(text,text,text) OWNER TO product_edge_custodian;
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
ALTER FUNCTION product_edge_api.lock_portfolio_read_policy_v1(text,text,text,text,text) OWNER TO product_edge_custodian;
REVOKE ALL ON FUNCTION product_edge_api.lock_portfolio_read_policy_v1(text,text,text,text,text) FROM PUBLIC, rd_owner, operator_authorization_writer, qualification_owner, qualification_writer;
GRANT EXECUTE ON FUNCTION product_edge_api.lock_portfolio_read_policy_v1(text,text,text,text,text) TO portfolio_owner;

-- Catalog and Composer are private object-owner domains.  This cutover preserves relation OIDs and
-- bytes: known public relations are locked and moved; unknown partial families abort the transaction.
CREATE SCHEMA IF NOT EXISTS replay_policy_catalog_private AUTHORIZATION replay_policy_catalog_owner;
CREATE SCHEMA IF NOT EXISTS replay_policy_catalog_api AUTHORIZATION replay_policy_catalog_owner;
CREATE SCHEMA IF NOT EXISTS composer_private AUTHORIZATION composer_owner;
CREATE SCHEMA IF NOT EXISTS composer_owner_api AUTHORIZATION composer_owner;
ALTER SCHEMA replay_policy_catalog_private OWNER TO replay_policy_catalog_owner;
ALTER SCHEMA replay_policy_catalog_api OWNER TO replay_policy_catalog_owner;
ALTER SCHEMA composer_private OWNER TO composer_owner;
ALTER SCHEMA composer_owner_api OWNER TO composer_owner;
REVOKE ALL ON SCHEMA replay_policy_catalog_private, replay_policy_catalog_api, composer_private, composer_owner_api FROM PUBLIC, rd_owner, rd_fact_writer, product_edge_owner, qualification_owner, qualification_writer, operator_authorization_owner, operator_authorization_writer, portfolio_owner, backtest_owner;
GRANT USAGE ON SCHEMA replay_policy_catalog_api, composer_owner_api TO rd_owner, rd_fact_writer;
DO $catalog_composer_schema_acl_cutover$
DECLARE grant_fact record;
BEGIN
  FOR grant_fact IN
    SELECT namespace.nspname,role.rolname FROM pg_catalog.pg_namespace namespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(namespace.nspacl,pg_catalog.acldefault('n',namespace.nspowner))) acl
    JOIN pg_catalog.pg_roles role ON role.oid=acl.grantee
    WHERE namespace.nspname IN ('replay_policy_catalog_private','replay_policy_catalog_api','composer_private','composer_owner_api')
      AND role.oid<>namespace.nspowner
  LOOP EXECUTE pg_catalog.format('REVOKE ALL ON SCHEMA %I FROM %I',grant_fact.nspname,grant_fact.rolname); END LOOP;
END
$catalog_composer_schema_acl_cutover$;
GRANT USAGE ON SCHEMA replay_policy_catalog_api, composer_owner_api TO rd_owner, rd_fact_writer;

DO $private_owner_cutover$
DECLARE
  catalog_names constant text[] := ARRAY['rd_replay_policy_catalog_records_v2','rd_replay_policy_catalog_head_v2','rd_replay_policy_catalog_revocations_v2','rd_replay_policy_catalog_audit_v2'];
  composer_names constant text[] := ARRAY['rd_develop_designs_v2','rd_develop_plans_v2','rd_develop_artifacts_v2','rd_develop_artifact_modules_v2','rd_develop_build_receipts_v2','rd_develop_composer_receipts_v2','rd_develop_host_receipts_v2','rd_develop_operations_v2','rd_develop_outbox_v2'];
  relation_name text;
  public_count integer;
  private_count integer;
BEGIN
  SELECT count(*) INTO public_count FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=ANY(catalog_names);
  SELECT count(*) INTO private_count FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='replay_policy_catalog_private' AND c.relname=ANY(catalog_names);
  IF public_count<>0 AND public_count<>4 OR private_count<>0 AND private_count<>4 OR public_count+private_count NOT IN (0,4) THEN RAISE EXCEPTION 'unknown Replay Policy Catalog relation family'; END IF;
  FOREACH relation_name IN ARRAY catalog_names LOOP
    IF pg_catalog.to_regclass('public.'||relation_name) IS NOT NULL THEN
      EXECUTE pg_catalog.format('LOCK TABLE public.%I IN ACCESS EXCLUSIVE MODE', relation_name);
      EXECUTE pg_catalog.format('ALTER TABLE public.%I SET SCHEMA replay_policy_catalog_private', relation_name);
    END IF;
  END LOOP;
  SELECT count(*) INTO public_count FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=ANY(composer_names);
  SELECT count(*) INTO private_count FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='composer_private' AND c.relname=ANY(composer_names);
  IF public_count<>0 AND public_count<>9 OR private_count<>0 AND private_count<>9 OR public_count+private_count NOT IN (0,9) THEN RAISE EXCEPTION 'unknown Composer relation family'; END IF;
  FOREACH relation_name IN ARRAY composer_names LOOP
    IF pg_catalog.to_regclass('public.'||relation_name) IS NOT NULL THEN
      EXECUTE pg_catalog.format('LOCK TABLE public.%I IN ACCESS EXCLUSIVE MODE', relation_name);
      EXECUTE pg_catalog.format('ALTER TABLE public.%I SET SCHEMA composer_private', relation_name);
    END IF;
  END LOOP;
END
$private_owner_cutover$;

CREATE TABLE IF NOT EXISTS replay_policy_catalog_private.rd_replay_policy_catalog_records_v2 (catalog_record_id TEXT PRIMARY KEY, catalog_version NUMERIC(20,0) NOT NULL UNIQUE CHECK (catalog_version > 0 AND catalog_version <= 18446744073709551615), owner_identity TEXT NOT NULL, predecessor_record_id TEXT UNIQUE REFERENCES replay_policy_catalog_private.rd_replay_policy_catalog_records_v2(catalog_record_id), policy_grammar_parser_id TEXT NOT NULL, policy_grammar_parser_digest BYTEA NOT NULL CHECK (octet_length(policy_grammar_parser_digest) = 32), policy_canonical_bytes BYTEA NOT NULL, policy_digest BYTEA NOT NULL CHECK (octet_length(policy_digest) = 32), catalog_record_digest BYTEA NOT NULL UNIQUE CHECK (octet_length(catalog_record_digest) = 32), created_by TEXT NOT NULL, created_at_epoch_ms BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS replay_policy_catalog_private.rd_replay_policy_catalog_head_v2 (singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton), catalog_record_id TEXT NOT NULL UNIQUE REFERENCES replay_policy_catalog_private.rd_replay_policy_catalog_records_v2(catalog_record_id), catalog_version NUMERIC(20,0) NOT NULL UNIQUE, advanced_by TEXT NOT NULL, advanced_at_epoch_ms BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS replay_policy_catalog_private.rd_replay_policy_catalog_revocations_v2 (catalog_record_id TEXT PRIMARY KEY REFERENCES replay_policy_catalog_private.rd_replay_policy_catalog_records_v2(catalog_record_id), catalog_version NUMERIC(20,0) NOT NULL UNIQUE, revoked_by TEXT NOT NULL, revoked_at_epoch_ms BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS replay_policy_catalog_private.rd_replay_policy_catalog_audit_v2 (command_identity TEXT PRIMARY KEY, administrator_identity TEXT NOT NULL, authentication_fact_digest TEXT NOT NULL, command_kind TEXT NOT NULL, predecessor_record_id TEXT, predecessor_head_record_id TEXT, result_record_id TEXT, content_identity TEXT NOT NULL, audit_json JSONB NOT NULL, committed_at_epoch_ms BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS public.rd_trial_families_v1 (trial_family_identity TEXT PRIMARY KEY, intent_identity TEXT NOT NULL UNIQUE, root_digest TEXT NOT NULL, root_json JSONB NOT NULL, root_receipt_json JSONB NOT NULL, committed_at_epoch_ms BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS public.rd_trial_family_members_v1 (member_identity TEXT PRIMARY KEY, trial_family_identity TEXT NOT NULL REFERENCES public.rd_trial_families_v1(trial_family_identity), ordinal INTEGER NOT NULL, fact_identity TEXT NOT NULL UNIQUE, member_digest TEXT NOT NULL, member_json JSONB NOT NULL, membership_receipt_json JSONB NOT NULL, committed_at_epoch_ms BIGINT NOT NULL, UNIQUE (trial_family_identity, ordinal));
CREATE TABLE IF NOT EXISTS public.rd_trial_family_heads_v1 (trial_family_identity TEXT PRIMARY KEY REFERENCES public.rd_trial_families_v1(trial_family_identity), frontier_identity TEXT NOT NULL UNIQUE, frontier_digest TEXT NOT NULL, frontier_json JSONB NOT NULL, committed_at_epoch_ms BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS public.rd_trial_family_attempt_cuts_v2 (census_frontier_identity TEXT PRIMARY KEY, trial_family_identity TEXT NOT NULL REFERENCES public.rd_trial_families_v1(trial_family_identity), attempt_ordinal INTEGER NOT NULL, attempt_frontier_identity TEXT NOT NULL UNIQUE, candidate_set_frontier_identity TEXT NOT NULL UNIQUE, census_frontier_json JSONB NOT NULL, attempt_frontier_json JSONB NOT NULL, candidate_set_frontier_json JSONB NOT NULL, committed_at_epoch_ms BIGINT NOT NULL, UNIQUE (trial_family_identity, attempt_ordinal));
CREATE TABLE IF NOT EXISTS public.rd_artifact_trial_family_bindings_v1 (binding_identity TEXT PRIMARY KEY, artifact_identity TEXT NOT NULL UNIQUE, build_receipt_identity TEXT NOT NULL UNIQUE, intent_identity TEXT NOT NULL, trial_family_identity TEXT NOT NULL REFERENCES public.rd_trial_families_v1(trial_family_identity), binding_digest TEXT NOT NULL, binding_json JSONB NOT NULL, binding_receipt_json JSONB NOT NULL, committed_at_epoch_ms BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS public.rd_owner_outbox_v1 (event_identity TEXT PRIMARY KEY, aggregate_identity TEXT NOT NULL, event_kind TEXT NOT NULL, payload_digest TEXT NOT NULL, payload_json JSONB NOT NULL, committed_at_epoch_ms BIGINT NOT NULL, UNIQUE (aggregate_identity, event_kind));
DROP TRIGGER IF EXISTS rd_replay_policy_catalog_records_guard_v2 ON replay_policy_catalog_private.rd_replay_policy_catalog_records_v2;
DROP TRIGGER IF EXISTS rd_replay_policy_catalog_head_guard_v2 ON replay_policy_catalog_private.rd_replay_policy_catalog_head_v2;
DROP TRIGGER IF EXISTS rd_replay_policy_catalog_revocations_guard_v2 ON replay_policy_catalog_private.rd_replay_policy_catalog_revocations_v2;
DROP TRIGGER IF EXISTS rd_replay_policy_catalog_audit_guard_v2 ON replay_policy_catalog_private.rd_replay_policy_catalog_audit_v2;
DROP TRIGGER IF EXISTS rd_replay_policy_catalog_outbox_guard_v2 ON public.rd_owner_outbox_v1;
DROP FUNCTION IF EXISTS rd_owner_api.guard_replay_policy_catalog_mutation_v2();
ALTER TABLE public.rd_trial_families_v1 OWNER TO rd_custodian;
ALTER TABLE public.rd_trial_family_members_v1 OWNER TO rd_custodian;
ALTER TABLE public.rd_trial_family_heads_v1 OWNER TO rd_custodian;
ALTER TABLE public.rd_trial_family_attempt_cuts_v2 OWNER TO rd_custodian;
ALTER TABLE public.rd_artifact_trial_family_bindings_v1 OWNER TO rd_custodian;
ALTER TABLE public.rd_owner_outbox_v1 OWNER TO rd_custodian;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.rd_trial_families_v1, public.rd_trial_family_members_v1, public.rd_trial_family_heads_v1, public.rd_trial_family_attempt_cuts_v2, public.rd_artifact_trial_family_bindings_v1, public.rd_owner_outbox_v1 TO rd_owner;

CREATE TABLE IF NOT EXISTS composer_private.rd_develop_designs_v2 (design_identity BYTEA PRIMARY KEY, canonical_bytes BYTEA NOT NULL);
CREATE TABLE IF NOT EXISTS composer_private.rd_develop_plans_v2 (plan_digest BYTEA PRIMARY KEY, design_identity BYTEA NOT NULL UNIQUE REFERENCES composer_private.rd_develop_designs_v2(design_identity), canonical_bytes BYTEA NOT NULL);
CREATE TABLE IF NOT EXISTS composer_private.rd_develop_artifacts_v2 (artifact_identity BYTEA PRIMARY KEY, plan_digest BYTEA NOT NULL UNIQUE REFERENCES composer_private.rd_develop_plans_v2(plan_digest), package_bytes BYTEA NOT NULL);
CREATE TABLE IF NOT EXISTS composer_private.rd_develop_artifact_modules_v2 (artifact_identity BYTEA NOT NULL REFERENCES composer_private.rd_develop_artifacts_v2(artifact_identity), ordinal INTEGER NOT NULL, module_bytes BYTEA NOT NULL, PRIMARY KEY (artifact_identity, ordinal));
CREATE TABLE IF NOT EXISTS composer_private.rd_develop_build_receipts_v2 (receipt_identity BYTEA PRIMARY KEY, build_attempt_identity BYTEA NOT NULL UNIQUE, capsule_identity BYTEA NOT NULL UNIQUE, artifact_identity BYTEA NOT NULL REFERENCES composer_private.rd_develop_artifacts_v2(artifact_identity), ordinal INTEGER NOT NULL, canonical_bytes BYTEA NOT NULL, UNIQUE (artifact_identity, ordinal));
CREATE TABLE IF NOT EXISTS composer_private.rd_develop_composer_receipts_v2 (artifact_identity BYTEA PRIMARY KEY REFERENCES composer_private.rd_develop_artifacts_v2(artifact_identity), canonical_bytes BYTEA NOT NULL);
CREATE TABLE IF NOT EXISTS composer_private.rd_develop_host_receipts_v2 (artifact_identity BYTEA PRIMARY KEY REFERENCES composer_private.rd_develop_artifacts_v2(artifact_identity), canonical_bytes BYTEA NOT NULL);
CREATE TABLE IF NOT EXISTS composer_private.rd_develop_operations_v2 (request_identity TEXT PRIMARY KEY, request_digest BYTEA NOT NULL, research_request_identity BYTEA NOT NULL UNIQUE, intent_identity BYTEA NOT NULL UNIQUE, artifact_identity BYTEA NOT NULL UNIQUE REFERENCES composer_private.rd_develop_artifacts_v2(artifact_identity), canonical_receipt_bytes BYTEA NOT NULL, response_bytes BYTEA NOT NULL);
CREATE TABLE IF NOT EXISTS composer_private.rd_develop_outbox_v2 (request_identity TEXT PRIMARY KEY REFERENCES composer_private.rd_develop_operations_v2(request_identity), canonical_bytes BYTEA NOT NULL);

DO $private_table_owners$
DECLARE relation_name text;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY['rd_replay_policy_catalog_records_v2','rd_replay_policy_catalog_head_v2','rd_replay_policy_catalog_revocations_v2','rd_replay_policy_catalog_audit_v2'] LOOP EXECUTE pg_catalog.format('ALTER TABLE replay_policy_catalog_private.%I OWNER TO replay_policy_catalog_owner', relation_name); END LOOP;
  FOREACH relation_name IN ARRAY ARRAY['rd_develop_designs_v2','rd_develop_plans_v2','rd_develop_artifacts_v2','rd_develop_artifact_modules_v2','rd_develop_build_receipts_v2','rd_develop_composer_receipts_v2','rd_develop_host_receipts_v2','rd_develop_operations_v2','rd_develop_outbox_v2'] LOOP EXECUTE pg_catalog.format('ALTER TABLE composer_private.%I OWNER TO composer_owner', relation_name); END LOOP;
END
$private_table_owners$;
DO $catalog_composer_relation_acl_cutover$
DECLARE grant_fact record;
BEGIN
  FOR grant_fact IN
    SELECT DISTINCT namespace.nspname,relation.relname,acl.grantee,role.rolname
    FROM pg_catalog.pg_class relation
    JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(relation.relacl,pg_catalog.acldefault('r',relation.relowner))) acl
    LEFT JOIN pg_catalog.pg_roles role ON role.oid=acl.grantee
    WHERE namespace.nspname IN ('replay_policy_catalog_private','composer_private')
      AND relation.relkind='r' AND acl.grantee<>relation.relowner
  LOOP
    IF grant_fact.grantee=0 THEN
      EXECUTE pg_catalog.format('REVOKE ALL PRIVILEGES ON TABLE %I.%I FROM PUBLIC',grant_fact.nspname,grant_fact.relname);
    ELSE
      EXECUTE pg_catalog.format('REVOKE ALL PRIVILEGES ON TABLE %I.%I FROM %I',grant_fact.nspname,grant_fact.relname,grant_fact.rolname);
    END IF;
  END LOOP;
  FOR grant_fact IN
    SELECT DISTINCT namespace.nspname,relation.relname,attribute.attname,acl.grantee,role.rolname
    FROM pg_catalog.pg_class relation
    JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace
    JOIN pg_catalog.pg_attribute attribute ON attribute.attrelid=relation.oid
    CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) acl
    LEFT JOIN pg_catalog.pg_roles role ON role.oid=acl.grantee
    WHERE namespace.nspname IN ('replay_policy_catalog_private','composer_private')
      AND relation.relkind='r' AND attribute.attnum>0 AND NOT attribute.attisdropped
      AND acl.grantee<>relation.relowner
  LOOP
    IF grant_fact.grantee=0 THEN
      EXECUTE pg_catalog.format('REVOKE ALL (%I) ON TABLE %I.%I FROM PUBLIC',grant_fact.attname,grant_fact.nspname,grant_fact.relname);
    ELSE
      EXECUTE pg_catalog.format('REVOKE ALL (%I) ON TABLE %I.%I FROM %I',grant_fact.attname,grant_fact.nspname,grant_fact.relname,grant_fact.rolname);
    END IF;
  END LOOP;
END
$catalog_composer_relation_acl_cutover$;
DO $catalog_composer_relation_acl_readback$
DECLARE exact boolean;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_class relation JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace
    WHERE namespace.nspname IN ('replay_policy_catalog_private','composer_private') AND relation.relkind='S'
  ) THEN RAISE EXCEPTION 'Catalog/Composer sequence manifest mismatch'; END IF;
  SELECT count(*)=13 INTO exact FROM pg_catalog.pg_class relation JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace
  WHERE namespace.nspname IN ('replay_policy_catalog_private','composer_private') AND relation.relkind='r';
  IF exact IS DISTINCT FROM true THEN RAISE EXCEPTION 'Catalog/Composer relation ACL family mismatch'; END IF;
  IF EXISTS (
    SELECT relation.oid FROM pg_catalog.pg_class relation JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(relation.relacl,pg_catalog.acldefault('r',relation.relowner))) acl
    WHERE namespace.nspname IN ('replay_policy_catalog_private','composer_private') AND relation.relkind='r'
    GROUP BY relation.oid,relation.relowner
    HAVING count(*)<>7 OR count(DISTINCT acl.privilege_type)<>7
      OR bool_or(acl.grantee<>relation.relowner OR acl.grantor<>relation.relowner OR acl.is_grantable)
      OR bool_or(acl.privilege_type NOT IN ('INSERT','SELECT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'))
  ) THEN RAISE EXCEPTION 'Catalog/Composer relation ACL manifest mismatch'; END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_class relation JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace
    JOIN pg_catalog.pg_attribute attribute ON attribute.attrelid=relation.oid
    WHERE namespace.nspname IN ('replay_policy_catalog_private','composer_private') AND relation.relkind='r'
      AND attribute.attnum>0 AND NOT attribute.attisdropped AND attribute.attacl IS NOT NULL
      AND pg_catalog.cardinality(attribute.attacl)>0
      AND (
        SELECT count(*)<>4 OR count(DISTINCT acl.privilege_type)<>4
          OR bool_or(acl.grantee<>relation.relowner OR acl.grantor<>relation.relowner OR acl.is_grantable)
          OR bool_or(acl.privilege_type NOT IN ('INSERT','SELECT','UPDATE','REFERENCES'))
        FROM pg_catalog.aclexplode(attribute.attacl) acl
      )
  ) THEN RAISE EXCEPTION 'Catalog/Composer column ACL manifest mismatch'; END IF;
END
$catalog_composer_relation_acl_readback$;
GRANT INSERT ON TABLE public.rd_owner_outbox_v1 TO replay_policy_catalog_owner;

CREATE OR REPLACE FUNCTION replay_policy_catalog_api.lock_replay_policy_catalog_record_v2(p_record_id text)
RETURNS TABLE (catalog_record_id text, catalog_version numeric, owner_identity text, policy_grammar_parser_id text, policy_grammar_parser_digest bytea, policy_canonical_bytes bytea, policy_digest bytea, catalog_record_digest bytea, head_record_id text, head_version numeric, revoked boolean)
LANGUAGE sql STRICT VOLATILE PARALLEL UNSAFE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $catalog_read$
  SELECT record.catalog_record_id, record.catalog_version, record.owner_identity,
    record.policy_grammar_parser_id, record.policy_grammar_parser_digest, record.policy_canonical_bytes,
    record.policy_digest, record.catalog_record_digest, head.catalog_record_id, head.catalog_version,
    revocation.catalog_record_id IS NOT NULL
  FROM replay_policy_catalog_private.rd_replay_policy_catalog_records_v2 record
  LEFT JOIN replay_policy_catalog_private.rd_replay_policy_catalog_head_v2 head ON head.singleton
  LEFT JOIN replay_policy_catalog_private.rd_replay_policy_catalog_revocations_v2 revocation ON revocation.catalog_record_id=record.catalog_record_id
  WHERE record.catalog_record_id=CASE WHEN p_record_id='' THEN
    (SELECT latest.catalog_record_id FROM replay_policy_catalog_private.rd_replay_policy_catalog_records_v2 latest ORDER BY latest.catalog_version DESC LIMIT 1)
    ELSE p_record_id END
  FOR UPDATE OF record
$catalog_read$;
ALTER FUNCTION replay_policy_catalog_api.lock_replay_policy_catalog_record_v2(text) OWNER TO replay_policy_catalog_owner;
REVOKE ALL ON FUNCTION replay_policy_catalog_api.lock_replay_policy_catalog_record_v2(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION replay_policy_catalog_api.lock_replay_policy_catalog_record_v2(text) TO rd_owner, rd_fact_writer;

CREATE OR REPLACE FUNCTION replay_policy_catalog_api.lock_current_replay_policy_catalog_v2()
RETURNS TABLE (catalog_record_id text, catalog_version numeric, owner_identity text, policy_grammar_parser_id text, policy_grammar_parser_digest bytea, policy_canonical_bytes bytea, policy_digest bytea, catalog_record_digest bytea, head_record_id text, head_version numeric, revoked boolean)
LANGUAGE sql VOLATILE PARALLEL UNSAFE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $catalog_current$
  SELECT record.catalog_record_id, record.catalog_version, record.owner_identity,
    record.policy_grammar_parser_id, record.policy_grammar_parser_digest, record.policy_canonical_bytes,
    record.policy_digest, record.catalog_record_digest, head.catalog_record_id, head.catalog_version,
    revocation.catalog_record_id IS NOT NULL
  FROM replay_policy_catalog_private.rd_replay_policy_catalog_head_v2 head
  JOIN replay_policy_catalog_private.rd_replay_policy_catalog_records_v2 record ON record.catalog_record_id=head.catalog_record_id AND record.catalog_version=head.catalog_version
  LEFT JOIN replay_policy_catalog_private.rd_replay_policy_catalog_revocations_v2 revocation ON revocation.catalog_record_id=record.catalog_record_id
  WHERE head.singleton FOR UPDATE OF head, record
$catalog_current$;
ALTER FUNCTION replay_policy_catalog_api.lock_current_replay_policy_catalog_v2() OWNER TO replay_policy_catalog_owner;
REVOKE ALL ON FUNCTION replay_policy_catalog_api.lock_current_replay_policy_catalog_v2() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION replay_policy_catalog_api.lock_current_replay_policy_catalog_v2() TO rd_owner, rd_fact_writer;

CREATE OR REPLACE FUNCTION replay_policy_catalog_api.apply_replay_policy_catalog_command_v2(
  p_action text, p_command_identity text, p_administrator_identity text, p_authentication_digest text,
  p_record_id text, p_version numeric, p_predecessor_id text, p_parser_id text, p_parser_digest bytea,
  p_policy_bytes bytea, p_policy_digest bytea, p_record_digest bytea, p_expected_head text,
  p_content_identity text, p_audit jsonb, p_outbox_identity text, p_outbox_digest text, p_epoch_ms bigint
) RETURNS boolean LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $catalog_apply$
DECLARE actual_head text; actual_latest text;
BEGIN
  IF SESSION_USER<>'rd_fact_writer' THEN RAISE EXCEPTION 'R&D fact writer required' USING ERRCODE='42501'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(7246450332882419842);
  SELECT head.catalog_record_id INTO actual_head FROM replay_policy_catalog_private.rd_replay_policy_catalog_head_v2 head WHERE head.singleton FOR UPDATE;
  SELECT record.catalog_record_id INTO actual_latest FROM replay_policy_catalog_private.rd_replay_policy_catalog_records_v2 record ORDER BY record.catalog_version DESC LIMIT 1 FOR UPDATE;
  IF p_action='create' THEN
    IF actual_latest IS NOT NULL OR p_version<>1 THEN RETURN false; END IF;
    INSERT INTO replay_policy_catalog_private.rd_replay_policy_catalog_records_v2 VALUES (p_record_id,p_version,'vibe-strategy-factory/rd-owner',NULL,p_parser_id,p_parser_digest,p_policy_bytes,p_policy_digest,p_record_digest,p_administrator_identity,p_epoch_ms);
  ELSIF p_action='append' THEN
    IF actual_latest IS DISTINCT FROM p_predecessor_id THEN RETURN false; END IF;
    INSERT INTO replay_policy_catalog_private.rd_replay_policy_catalog_records_v2 VALUES (p_record_id,p_version,'vibe-strategy-factory/rd-owner',p_predecessor_id,p_parser_id,p_parser_digest,p_policy_bytes,p_policy_digest,p_record_digest,p_administrator_identity,p_epoch_ms);
  ELSIF p_action='advance' THEN
    IF actual_head IS DISTINCT FROM NULLIF(p_expected_head,'') OR EXISTS (SELECT 1 FROM replay_policy_catalog_private.rd_replay_policy_catalog_revocations_v2 WHERE catalog_record_id=p_record_id) THEN RETURN false; END IF;
    INSERT INTO replay_policy_catalog_private.rd_replay_policy_catalog_head_v2 VALUES (true,p_record_id,p_version,p_administrator_identity,p_epoch_ms) ON CONFLICT (singleton) DO UPDATE SET catalog_record_id=excluded.catalog_record_id,catalog_version=excluded.catalog_version,advanced_by=excluded.advanced_by,advanced_at_epoch_ms=excluded.advanced_at_epoch_ms;
  ELSIF p_action='revoke' THEN
    IF EXISTS (SELECT 1 FROM replay_policy_catalog_private.rd_replay_policy_catalog_revocations_v2 WHERE catalog_record_id=p_record_id) THEN RETURN false; END IF;
    INSERT INTO replay_policy_catalog_private.rd_replay_policy_catalog_revocations_v2 VALUES (p_record_id,p_version,p_administrator_identity,p_epoch_ms);
  ELSE RETURN false; END IF;
  INSERT INTO replay_policy_catalog_private.rd_replay_policy_catalog_audit_v2
    SELECT p_command_identity,p_administrator_identity,p_authentication_digest,p_audit->>'command_kind',p_audit->>'predecessor_record_id',p_audit->>'predecessor_head_record_id',p_audit->>'result_record_id',p_content_identity,p_audit,p_epoch_ms;
  INSERT INTO public.rd_owner_outbox_v1 VALUES (p_outbox_identity,p_command_identity,p_audit->>'command_kind',p_outbox_digest,p_audit,p_epoch_ms);
  RETURN true;
END
$catalog_apply$;
ALTER FUNCTION replay_policy_catalog_api.apply_replay_policy_catalog_command_v2(text,text,text,text,text,numeric,text,text,bytea,bytea,bytea,bytea,text,text,jsonb,text,text,bigint) OWNER TO replay_policy_catalog_owner;
REVOKE ALL ON FUNCTION replay_policy_catalog_api.apply_replay_policy_catalog_command_v2(text,text,text,text,text,numeric,text,text,bytea,bytea,bytea,bytea,text,text,jsonb,text,text,bigint) FROM PUBLIC, rd_owner, rd_fact_writer;
GRANT EXECUTE ON FUNCTION replay_policy_catalog_api.apply_replay_policy_catalog_command_v2(text,text,text,text,text,numeric,text,text,bytea,bytea,bytea,bytea,text,text,jsonb,text,text,bigint) TO rd_fact_writer;

CREATE OR REPLACE FUNCTION composer_owner_api.commit_develop_composer_v2(
  p_request_identity text, p_request_digest bytea, p_research_identity bytea, p_intent_identity bytea,
  p_artifact_identity bytea, p_design_identity bytea, p_plan_digest bytea, p_design_bytes bytea,
  p_plan_bytes bytea, p_package_bytes bytea, p_module_bytes bytea[], p_receipt_identities bytea[],
  p_attempt_identities bytea[], p_capsule_identities bytea[], p_build_bytes bytea[],
  p_composer_bytes bytea, p_host_bytes bytea, p_operation_bytes bytea, p_response_bytes bytea, p_outbox_bytes bytea
) RETURNS boolean LANGUAGE plpgsql STRICT VOLATILE PARALLEL UNSAFE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $composer_commit$DECLARE ordinal integer;
BEGIN
  IF SESSION_USER<>'rd_fact_writer' THEN RAISE EXCEPTION 'R&D fact writer required' USING ERRCODE='42501'; END IF;
  IF cardinality(p_receipt_identities)<>cardinality(p_attempt_identities)
     OR cardinality(p_receipt_identities)<>cardinality(p_capsule_identities)
     OR cardinality(p_receipt_identities)<>cardinality(p_build_bytes) THEN RETURN false; END IF;
  INSERT INTO composer_private.rd_develop_designs_v2 VALUES (p_design_identity,p_design_bytes);
  INSERT INTO composer_private.rd_develop_plans_v2 VALUES (p_plan_digest,p_design_identity,p_plan_bytes);
  INSERT INTO composer_private.rd_develop_artifacts_v2 VALUES (p_artifact_identity,p_plan_digest,p_package_bytes);
  FOR ordinal IN SELECT generate_subscripts(p_module_bytes,1) LOOP INSERT INTO composer_private.rd_develop_artifact_modules_v2 VALUES (p_artifact_identity,ordinal-1,p_module_bytes[ordinal]); END LOOP;
  FOR ordinal IN SELECT generate_subscripts(p_receipt_identities,1) LOOP INSERT INTO composer_private.rd_develop_build_receipts_v2 VALUES (p_receipt_identities[ordinal],p_attempt_identities[ordinal],p_capsule_identities[ordinal],p_artifact_identity,ordinal-1,p_build_bytes[ordinal]); END LOOP;
  INSERT INTO composer_private.rd_develop_composer_receipts_v2 VALUES (p_artifact_identity,p_composer_bytes);
  INSERT INTO composer_private.rd_develop_host_receipts_v2 VALUES (p_artifact_identity,p_host_bytes);
  INSERT INTO composer_private.rd_develop_operations_v2 VALUES (p_request_identity,p_request_digest,p_research_identity,p_intent_identity,p_artifact_identity,p_operation_bytes,p_response_bytes);
  INSERT INTO composer_private.rd_develop_outbox_v2 VALUES (p_request_identity,p_outbox_bytes);
  RETURN true;
END$composer_commit$;
ALTER FUNCTION composer_owner_api.commit_develop_composer_v2(text,bytea,bytea,bytea,bytea,bytea,bytea,bytea,bytea,bytea,bytea[],bytea[],bytea[],bytea[],bytea[],bytea,bytea,bytea,bytea,bytea) OWNER TO composer_owner;
REVOKE ALL ON FUNCTION composer_owner_api.commit_develop_composer_v2(text,bytea,bytea,bytea,bytea,bytea,bytea,bytea,bytea,bytea,bytea[],bytea[],bytea[],bytea[],bytea[],bytea,bytea,bytea,bytea,bytea) FROM PUBLIC, rd_owner, rd_fact_writer;
GRANT EXECUTE ON FUNCTION composer_owner_api.commit_develop_composer_v2(text,bytea,bytea,bytea,bytea,bytea,bytea,bytea,bytea,bytea,bytea[],bytea[],bytea[],bytea[],bytea[],bytea,bytea,bytea,bytea,bytea) TO rd_fact_writer;
CREATE OR REPLACE FUNCTION composer_owner_api.lock_accepted_develop_composer_v2(p_request_identity text)
RETURNS TABLE (request_digest bytea, research_request_identity bytea, intent_identity bytea, artifact_identity bytea, operation_receipt_bytes bytea, response_bytes bytea, plan_digest bytea, artifact_package_bytes bytea, design_identity bytea, plan_bytes bytea, design_bytes bytea, module_ordinals integer[], module_bytes bytea[], build_ordinals integer[], build_receipt_identities bytea[], build_attempt_identities bytea[], capsule_identities bytea[], build_receipt_bytes bytea[], composer_receipt_bytes bytea, host_receipt_bytes bytea, outbox_bytes bytea)
LANGUAGE plpgsql STRICT VOLATILE PARALLEL UNSAFE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $composer_read$BEGIN
  LOCK TABLE
    composer_private.rd_develop_designs_v2,
    composer_private.rd_develop_plans_v2,
    composer_private.rd_develop_artifacts_v2,
    composer_private.rd_develop_artifact_modules_v2,
    composer_private.rd_develop_build_receipts_v2,
    composer_private.rd_develop_composer_receipts_v2,
    composer_private.rd_develop_host_receipts_v2,
    composer_private.rd_develop_operations_v2,
    composer_private.rd_develop_outbox_v2
  IN SHARE MODE;
  RETURN QUERY
  SELECT operation.request_digest,
         operation.research_request_identity,
         operation.intent_identity,
         operation.artifact_identity,
         operation.canonical_receipt_bytes,
         operation.response_bytes,
         artifact.plan_digest,
         artifact.package_bytes,
         plan.design_identity,
         plan.canonical_bytes,
         design.canonical_bytes,
         COALESCE(modules.ordinals, ARRAY[]::integer[]),
         COALESCE(modules.canonical_bytes, ARRAY[]::bytea[]),
         COALESCE(builds.ordinals, ARRAY[]::integer[]),
         COALESCE(builds.receipt_identities, ARRAY[]::bytea[]),
         COALESCE(builds.attempt_identities, ARRAY[]::bytea[]),
         COALESCE(builds.capsule_identities, ARRAY[]::bytea[]),
         COALESCE(builds.canonical_bytes, ARRAY[]::bytea[]),
         composer.canonical_bytes,
         host.canonical_bytes,
         outbox.canonical_bytes
    FROM composer_private.rd_develop_operations_v2 operation
    JOIN composer_private.rd_develop_artifacts_v2 artifact
      ON artifact.artifact_identity=operation.artifact_identity
    JOIN composer_private.rd_develop_plans_v2 plan
      ON plan.plan_digest=artifact.plan_digest
    JOIN composer_private.rd_develop_designs_v2 design
      ON design.design_identity=plan.design_identity
    JOIN composer_private.rd_develop_composer_receipts_v2 composer
      ON composer.artifact_identity=artifact.artifact_identity
    JOIN composer_private.rd_develop_host_receipts_v2 host
      ON host.artifact_identity=artifact.artifact_identity
    JOIN composer_private.rd_develop_outbox_v2 outbox
      ON outbox.request_identity=operation.request_identity
    LEFT JOIN LATERAL (
      SELECT array_agg(module.ordinal ORDER BY module.ordinal) AS ordinals,
             array_agg(module.module_bytes ORDER BY module.ordinal) AS canonical_bytes
        FROM composer_private.rd_develop_artifact_modules_v2 module
       WHERE module.artifact_identity=artifact.artifact_identity
    ) modules ON TRUE
    LEFT JOIN LATERAL (
      SELECT array_agg(receipt.ordinal ORDER BY receipt.ordinal) AS ordinals,
             array_agg(receipt.receipt_identity ORDER BY receipt.ordinal) AS receipt_identities,
             array_agg(receipt.build_attempt_identity ORDER BY receipt.ordinal) AS attempt_identities,
             array_agg(receipt.capsule_identity ORDER BY receipt.ordinal) AS capsule_identities,
             array_agg(receipt.canonical_bytes ORDER BY receipt.ordinal) AS canonical_bytes
        FROM composer_private.rd_develop_build_receipts_v2 receipt
       WHERE receipt.artifact_identity=artifact.artifact_identity
    ) builds ON TRUE
   WHERE operation.request_identity=p_request_identity;
END$composer_read$;
ALTER FUNCTION composer_owner_api.lock_accepted_develop_composer_v2(text) OWNER TO composer_owner;
REVOKE ALL ON FUNCTION composer_owner_api.lock_accepted_develop_composer_v2(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION composer_owner_api.lock_accepted_develop_composer_v2(text) TO rd_owner, rd_fact_writer;
DO $catalog_composer_function_acl_cutover$
DECLARE grant_fact record;
BEGIN
  FOR grant_fact IN
    SELECT procedure.oid::pg_catalog.regprocedure AS signature,role.rolname
    FROM pg_catalog.pg_proc procedure
    JOIN pg_catalog.pg_namespace namespace ON namespace.oid=procedure.pronamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(procedure.proacl,pg_catalog.acldefault('f',procedure.proowner))) acl
    JOIN pg_catalog.pg_roles role ON role.oid=acl.grantee
    WHERE namespace.nspname IN ('replay_policy_catalog_api','composer_owner_api') AND role.oid<>procedure.proowner
  LOOP EXECUTE pg_catalog.format('REVOKE ALL ON FUNCTION %s FROM %I',grant_fact.signature,grant_fact.rolname); END LOOP;
END
$catalog_composer_function_acl_cutover$;
DO $source_legacy_topology_admission$
DECLARE
  present_relations bigint;
  present_routines bigint;
  present_triggers bigint;
BEGIN
  SELECT pg_catalog.count(*) INTO present_relations
  FROM pg_catalog.pg_class relation
  JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace
  WHERE namespace.nspname='public' AND relation.relkind IN ('r','p')
    AND relation.relname IN (
      'rd_source_intake_bindings_v1','rd_source_intake_receipts_v1','rd_source_raw_payloads_v1',
      'rd_source_raw_receipt_links_v1','rd_research_source_provenance_v1','rd_source_candidates_v1',
      'rd_legacy_prepared_attempt_drain_receipts_v1'
    );
  SELECT pg_catalog.count(*) INTO present_routines
  FROM pg_catalog.pg_proc routine
  WHERE routine.oid IN (
    pg_catalog.to_regprocedure('rd_owner_api.derive_source_intake_identity_v1(text,text[])'),
    pg_catalog.to_regprocedure('rd_owner_api.canonical_source_intake_json_v1(jsonb)'),
    pg_catalog.to_regprocedure('rd_owner_api.derive_openalex_location_rights_v1(jsonb,text)'),
    pg_catalog.to_regprocedure('rd_owner_api.derive_source_acquisition_binding_digest_v1(jsonb)'),
    pg_catalog.to_regprocedure('rd_owner_api.derive_source_acquisition_binding_identity_v1(jsonb)'),
    pg_catalog.to_regprocedure('rd_owner_api.lock_source_acquisition_binding_v1(text,text)'),
    pg_catalog.to_regprocedure('rd_owner_api.lock_source_invocation_reservation_v1(text,text,text,text,text)'),
    pg_catalog.to_regprocedure('rd_owner_api.valid_source_intake_started_custody_v1(text,text,text,jsonb)'),
    pg_catalog.to_regprocedure('rd_owner_api.guard_source_intake_binding_v1()'),
    pg_catalog.to_regprocedure('rd_owner_api.reject_source_intake_terminal_mutation_v1()'),
    pg_catalog.to_regprocedure('rd_owner_api.read_source_intake_v1(text)'),
    pg_catalog.to_regprocedure('rd_owner_api.valid_source_intake_binding_contract_v1(jsonb)'),
    pg_catalog.to_regprocedure('rd_owner_api.valid_source_intake_receipt_v1(jsonb,text,text,text,text,text,smallint,text,text,bigint)'),
    pg_catalog.to_regprocedure('rd_owner_api.canonical_source_intake_custody_v1(text)'),
    pg_catalog.to_regprocedure('rd_owner_api.peek_source_intake_research_handoff_v1(text,text,text)'),
    pg_catalog.to_regprocedure('rd_owner_api.lock_source_intake_research_handoff_v1(text,text,text)'),
    pg_catalog.to_regprocedure('public.rd_owner_reject_legacy_prepared_attempt_drain_mutation_v1()')
  );
  SELECT pg_catalog.count(*) INTO present_triggers
  FROM pg_catalog.pg_trigger trigger_fact
  WHERE NOT trigger_fact.tgisinternal AND trigger_fact.tgname IN (
    'rd_source_intake_binding_guard_v1','rd_source_intake_receipt_immutable_v1',
    'rd_source_raw_payload_immutable_v1','rd_source_raw_receipt_link_immutable_v1',
    'rd_research_source_provenance_immutable_v1','rd_source_candidate_immutable_v1',
    'rd_legacy_prepared_attempt_drain_immutable_v1'
  );
  IF (present_relations,present_routines,present_triggers) NOT IN ((0,0,0),(7,17,7)) THEN
    RAISE EXCEPTION 'Source Intake/legacy drain topology is partial';
  END IF;
END
$source_legacy_topology_admission$;
SELECT (
  pg_catalog.to_regclass('public.rd_source_intake_bindings_v1') IS NULL
  AND pg_catalog.to_regclass('public.rd_legacy_prepared_attempt_drain_receipts_v1') IS NULL
) AS provision_source_legacy_topology \gset
\if :provision_source_legacy_topology
CREATE OR REPLACE FUNCTION rd_owner_api.derive_source_intake_identity_v1(domain text, parts text[])
      RETURNS text LANGUAGE sql STRICT IMMUTABLE PARALLEL SAFE
      SET search_path = pg_catalog, pg_temp
      AS $function$
        SELECT 'sha256:' || pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
          pg_catalog.array_to_string(pg_catalog.array_prepend(domain, parts), pg_catalog.chr(31)),
          'UTF8'
        )), 'hex')
      $function$;
ALTER FUNCTION rd_owner_api.derive_source_intake_identity_v1(text,text[]) OWNER TO rd_owner;
REVOKE ALL ON FUNCTION rd_owner_api.derive_source_intake_identity_v1(text,text[]) FROM PUBLIC, product_edge_owner, operator_authorization_writer, qualification_owner, qualification_writer;
CREATE OR REPLACE FUNCTION rd_owner_api.canonical_source_intake_json_v1(value jsonb)
      RETURNS text LANGUAGE plpgsql STRICT IMMUTABLE PARALLEL SAFE
      SET search_path = pg_catalog
      AS $function$
      DECLARE result text;
      DECLARE entry record;
      DECLARE first_entry boolean := true;
      BEGIN
        CASE pg_catalog.jsonb_typeof(value)
          WHEN 'object' THEN
            result := '{';
            FOR entry IN SELECT key, child FROM pg_catalog.jsonb_each(value) item(key, child) ORDER BY key LOOP
              IF NOT first_entry THEN result := result || ','; END IF;
              result := result || pg_catalog.to_json(entry.key)::text || ':' ||
                rd_owner_api.canonical_source_intake_json_v1(entry.child);
              first_entry := false;
            END LOOP;
            RETURN result || '}';
          WHEN 'array' THEN
            result := '[';
            FOR entry IN SELECT child FROM pg_catalog.jsonb_array_elements(value) WITH ORDINALITY item(child, ordinality) ORDER BY ordinality LOOP
              IF NOT first_entry THEN result := result || ','; END IF;
              result := result || rd_owner_api.canonical_source_intake_json_v1(entry.child);
              first_entry := false;
            END LOOP;
            RETURN result || ']';
          ELSE RETURN value::text;
        END CASE;
      END
      $function$;
ALTER FUNCTION rd_owner_api.canonical_source_intake_json_v1(jsonb) OWNER TO rd_owner;
REVOKE ALL ON FUNCTION rd_owner_api.canonical_source_intake_json_v1(jsonb) FROM PUBLIC, product_edge_owner, operator_authorization_writer, qualification_owner, qualification_writer;
CREATE OR REPLACE FUNCTION rd_owner_api.derive_openalex_location_rights_v1(body jsonb, normalized_doi text)
      RETURNS jsonb LANGUAGE sql STRICT IMMUTABLE PARALLEL SAFE
      SET search_path = pg_catalog, pg_temp
      AS $function$
        WITH locations AS (
          SELECT value AS location, ordinality - 1 AS location_index
          FROM pg_catalog.jsonb_array_elements(COALESCE(body->'locations', '[]'::jsonb))
               WITH ORDINALITY AS source(value, ordinality)
        ), locators AS (
          SELECT location, location_index,
            CASE WHEN location->>'landing_page_url' IS NULL THEN NULL ELSE
              'sha256:' || pg_catalog.encode(pg_catalog.sha256(
                pg_catalog.int8send(pg_catalog.octet_length('rd.source-intake.location.landing-page.v1')) ||
                pg_catalog.convert_to('rd.source-intake.location.landing-page.v1', 'UTF8') ||
                pg_catalog.int8send(pg_catalog.octet_length(location->>'landing_page_url')) ||
                pg_catalog.convert_to(location->>'landing_page_url', 'UTF8')
              ), 'hex') END AS landing_digest,
            CASE WHEN location->>'pdf_url' IS NULL THEN NULL ELSE
              'sha256:' || pg_catalog.encode(pg_catalog.sha256(
                pg_catalog.int8send(pg_catalog.octet_length('rd.source-intake.location.pdf.v1')) ||
                pg_catalog.convert_to('rd.source-intake.location.pdf.v1', 'UTF8') ||
                pg_catalog.int8send(pg_catalog.octet_length(location->>'pdf_url')) ||
                pg_catalog.convert_to(location->>'pdf_url', 'UTF8')
              ), 'hex') END AS pdf_digest
          FROM locations
        ), rights AS (
          SELECT location_index, pg_catalog.jsonb_build_object(
            'location_identity', rd_owner_api.derive_source_intake_identity_v1(
              'rd.source-intake.location-rights.v1', ARRAY[
                normalized_doi, location_index::text, COALESCE(landing_digest, 'ABSENT'),
                COALESCE(pdf_digest, 'ABSENT'), COALESCE(location->>'license', 'UNREPORTED')
              ]::text[]
            ),
            'is_open_access_metadata', location->'is_oa',
            'reported_license', location->'license',
            'landing_page_locator_digest', pg_catalog.to_jsonb(landing_digest),
            'pdf_locator_digest', pg_catalog.to_jsonb(pdf_digest),
            'posture', 'MUTABLE_METADATA_NOT_REUSE_GRANT'
          ) AS value
          FROM locators
        )
        SELECT COALESCE(pg_catalog.jsonb_agg(value ORDER BY location_index), '[]'::jsonb)
        FROM rights
      $function$;
ALTER FUNCTION rd_owner_api.derive_openalex_location_rights_v1(jsonb,text) OWNER TO rd_owner;
REVOKE ALL ON FUNCTION rd_owner_api.derive_openalex_location_rights_v1(jsonb,text) FROM PUBLIC, product_edge_owner, operator_authorization_writer, qualification_owner, qualification_writer;
CREATE OR REPLACE FUNCTION rd_owner_api.derive_source_acquisition_binding_digest_v1(binding jsonb)
      RETURNS text LANGUAGE sql STRICT IMMUTABLE PARALLEL SAFE
      SET search_path = pg_catalog
      AS $function$
        SELECT 'sha256:' || pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
          rd_owner_api.canonical_source_intake_json_v1(binding - 'binding_identity' - 'binding_digest'),
          'UTF8')), 'hex')
      $function$;
ALTER FUNCTION rd_owner_api.derive_source_acquisition_binding_digest_v1(jsonb) OWNER TO rd_owner;
REVOKE ALL ON FUNCTION rd_owner_api.derive_source_acquisition_binding_digest_v1(jsonb) FROM PUBLIC, product_edge_owner, operator_authorization_writer, qualification_owner, qualification_writer;
CREATE OR REPLACE FUNCTION rd_owner_api.derive_source_acquisition_binding_identity_v1(binding jsonb)
      RETURNS text LANGUAGE sql STRICT IMMUTABLE PARALLEL SAFE
      SET search_path = pg_catalog
      AS $function$
        SELECT rd_owner_api.derive_source_intake_identity_v1(
          'rd.source-acquisition-binding-identity.v1',
          ARRAY[rd_owner_api.derive_source_acquisition_binding_digest_v1(binding)]::text[])
      $function$;
ALTER FUNCTION rd_owner_api.derive_source_acquisition_binding_identity_v1(jsonb) OWNER TO rd_owner;
REVOKE ALL ON FUNCTION rd_owner_api.derive_source_acquisition_binding_identity_v1(jsonb) FROM PUBLIC, product_edge_owner, operator_authorization_writer, qualification_owner, qualification_writer;
CREATE TABLE public.rd_source_intake_bindings_v1 (
        request_identity text PRIMARY KEY,
        binding_identity text NOT NULL UNIQUE,
        binding_commit_identity text NOT NULL UNIQUE,
        binding_json jsonb NOT NULL,
        state text NOT NULL CHECK (state IN ('BINDING_CLOSED','PREPARED','INVOCATION_RESERVED','TERMINAL')),
        binding_committed_at_epoch_ms bigint NOT NULL CHECK (binding_committed_at_epoch_ms >= 0),
        product_edge_started_receipt_identity text,
        product_edge_started_json jsonb,
        invocation_identity text UNIQUE,
        terminal_receipt_identity text UNIQUE,
        CHECK (
          (state = 'BINDING_CLOSED' AND product_edge_started_receipt_identity IS NULL AND product_edge_started_json IS NULL AND invocation_identity IS NULL AND terminal_receipt_identity IS NULL)
          OR (state = 'PREPARED' AND product_edge_started_receipt_identity IS NOT NULL AND product_edge_started_json IS NOT NULL AND invocation_identity IS NULL AND terminal_receipt_identity IS NULL)
          OR (state = 'INVOCATION_RESERVED' AND product_edge_started_receipt_identity IS NOT NULL AND product_edge_started_json IS NOT NULL AND invocation_identity IS NOT NULL AND terminal_receipt_identity IS NULL)
          OR (state = 'TERMINAL' AND product_edge_started_receipt_identity IS NOT NULL AND product_edge_started_json IS NOT NULL AND terminal_receipt_identity IS NOT NULL)
        )
      );
CREATE OR REPLACE FUNCTION rd_owner_api.lock_source_acquisition_binding_v1(
        requested_request_identity text,
        requested_binding_identity text
      ) RETURNS jsonb LANGUAGE plpgsql STRICT VOLATILE PARALLEL UNSAFE SECURITY DEFINER
      SET search_path = pg_catalog
      AS $function$
      DECLARE locked record;
      BEGIN
        IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN RETURN NULL; END IF;
        SELECT request_identity, binding_identity, binding_commit_identity, binding_json,
               state, binding_committed_at_epoch_ms
          INTO locked
          FROM public.rd_source_intake_bindings_v1
         WHERE request_identity = requested_request_identity
           AND binding_identity = requested_binding_identity
         FOR SHARE;
        IF NOT FOUND
           OR locked.binding_json->>'request_identity' <> locked.request_identity
           OR locked.binding_json->>'binding_identity' <> locked.binding_identity
           OR rd_owner_api.valid_source_intake_binding_contract_v1(locked.binding_json) IS NOT TRUE
           OR locked.binding_json->>'gateway' <> 'WINDMILL_PRODUCT_EDGE'
           OR locked.binding_json#>>'{product_edge_admission,request_identity}' <> locked.request_identity
           OR locked.binding_json#>>'{product_edge_admission,admission_identity}' IS NULL
           OR locked.binding_json#>>'{product_edge_admission,admission_digest}' IS NULL
           OR locked.binding_json->>'operation_manifest_identity' IS NULL
           OR locked.binding_json->>'operation_manifest_digest' IS NULL
           OR locked.binding_json->>'policy_evidence_identity' IS NULL
           OR locked.binding_json->>'policy_evidence_digest' IS NULL
           OR locked.binding_json->>'normalized_doi' IS NULL
           OR locked.binding_json->>'admission' <> 'ADMITTED'
           OR locked.binding_json->>'connector_version' <> 'v1'
           OR locked.binding_json->>'tls_stack_identity' <> 'rustls-only-v1'
           OR locked.binding_json->>'method' <> 'GET'
           OR locked.binding_json->>'endpoint_path' <> '/works/doi:' || (locked.binding_json->>'normalized_doi')
           OR locked.binding_json->>'media_type' <> 'application/json'
           OR (locked.binding_json->>'retry_budget')::smallint <> 0
           OR (locked.binding_json->>'redirect_hop_limit')::smallint <> 0
           OR locked.binding_identity <> rd_owner_api.derive_source_acquisition_binding_identity_v1(locked.binding_json)
        THEN RETURN NULL; END IF;
        RETURN pg_catalog.jsonb_build_object(
          'schema_version', 1,
          'request_identity', locked.request_identity,
          'binding_identity', locked.binding_identity,
          'binding_digest', locked.binding_json->>'binding_digest',
          'admission_identity', locked.binding_json#>>'{product_edge_admission,admission_identity}',
          'admission_digest', locked.binding_json#>>'{product_edge_admission,admission_digest}',
          'operation_manifest_identity', locked.binding_json->>'operation_manifest_identity',
          'operation_manifest_digest', locked.binding_json->>'operation_manifest_digest',
          'normalized_doi', locked.binding_json->>'normalized_doi',
          'binding_commit_identity', locked.binding_commit_identity
        );
      END
      $function$;
ALTER FUNCTION rd_owner_api.lock_source_acquisition_binding_v1(text,text) OWNER TO rd_owner;
REVOKE ALL ON FUNCTION rd_owner_api.lock_source_acquisition_binding_v1(text,text) FROM PUBLIC, product_edge_owner, operator_authorization_writer, qualification_owner, qualification_writer;
GRANT EXECUTE ON FUNCTION rd_owner_api.lock_source_acquisition_binding_v1(text,text) TO product_edge_owner;
CREATE OR REPLACE FUNCTION rd_owner_api.lock_source_invocation_reservation_v1(
        requested_request_identity text,
        requested_attempt_identity text,
        requested_claim_identity text,
        requested_reservation_identity text,
        requested_reservation_digest text
      ) RETURNS jsonb LANGUAGE plpgsql STRICT VOLATILE PARALLEL UNSAFE SECURITY DEFINER
      SET search_path = pg_catalog
      AS $function$
      DECLARE locked record;
      DECLARE reservation jsonb;
      BEGIN
        IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN RETURN NULL; END IF;
        SELECT request_identity, binding_identity, binding_commit_identity, binding_json,
               product_edge_started_receipt_identity, product_edge_started_json
          INTO locked
          FROM public.rd_source_intake_bindings_v1
         WHERE request_identity = requested_request_identity
           AND binding_identity = requested_attempt_identity
           AND state = 'PREPARED'
         FOR SHARE;
        IF NOT FOUND THEN RETURN NULL; END IF;
        reservation := locked.product_edge_started_json;
        IF reservation->>'schema_version' <> '1'
           OR reservation->>'request_identity' <> locked.request_identity
           OR reservation->>'binding_identity' <> locked.binding_identity
           OR reservation->>'binding_commit_identity' <> locked.binding_commit_identity
           OR reservation->>'admission_identity' <>
              locked.binding_json#>>'{product_edge_admission,admission_identity}'
           OR reservation->>'attempt_identity' <> locked.binding_identity
           OR reservation->>'claim_identity' <> requested_claim_identity
           OR reservation->>'reservation_identity' <> requested_reservation_identity
           OR reservation->>'reservation_digest' <> requested_reservation_digest
           OR locked.product_edge_started_receipt_identity <> requested_reservation_identity
           OR reservation->>'reserved_at_epoch_ms' IS NULL
           OR pg_catalog.jsonb_typeof(reservation->'interpretation') <> 'object'
        THEN RETURN NULL; END IF;
        RETURN pg_catalog.jsonb_build_object(
          'schema_version', 1,
          'request_identity', reservation->>'request_identity',
          'binding_identity', reservation->>'binding_identity',
          'binding_commit_identity', reservation->>'binding_commit_identity',
          'admission_identity', reservation->>'admission_identity',
          'attempt_identity', reservation->>'attempt_identity',
          'claim_identity', reservation->>'claim_identity',
          'claim_digest', reservation->>'claim_digest',
          'invocation_admission_receipt_identity', reservation->>'invocation_admission_receipt_identity',
          'invocation_admission_receipt_digest', reservation->>'invocation_admission_receipt_digest',
          'claimed_state_digest', reservation->>'claimed_state_digest',
          'reservation_identity', reservation->>'reservation_identity',
          'reservation_digest', reservation->>'reservation_digest',
          'reserved_at_epoch_ms', (reservation->>'reserved_at_epoch_ms')::bigint
        );
      END
      $function$;
ALTER FUNCTION rd_owner_api.lock_source_invocation_reservation_v1(text,text,text,text,text) OWNER TO rd_owner;
REVOKE ALL ON FUNCTION rd_owner_api.lock_source_invocation_reservation_v1(text,text,text,text,text) FROM PUBLIC, product_edge_owner, operator_authorization_writer, qualification_owner, qualification_writer;
GRANT EXECUTE ON FUNCTION rd_owner_api.lock_source_invocation_reservation_v1(text,text,text,text,text) TO product_edge_owner;
CREATE OR REPLACE FUNCTION rd_owner_api.valid_source_intake_started_custody_v1(
        p_request_identity text,
        p_admission_identity text,
        p_started_receipt_identity text,
        p_started jsonb
      ) RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE
      SET search_path = pg_catalog, pg_temp
      AS $function$
        SELECT pg_catalog.jsonb_typeof(p_started) = 'object'
          AND (SELECT pg_catalog.array_agg(key ORDER BY key)
               FROM pg_catalog.jsonb_object_keys(p_started) AS keys(key)) IN (
                 ARRAY['admission_identity','attempt_identity','authority','binding_commit_identity','binding_identity',
                       'claim_digest','claim_identity','claimed_state_digest','interpretation',
                       'invocation_admission_receipt_digest','invocation_admission_receipt_identity',
                       'request_identity','reservation_digest','reservation_identity',
                       'reserved_at_epoch_ms','schema_version']::text[],
                 ARRAY['admission_identity','attempt_identity','authority','binding_commit_identity','binding_identity',
                       'claim_digest','claim_identity','claimed_state_digest','interpretation',
                       'invocation_admission_receipt_digest','invocation_admission_receipt_identity',
                       'policy_decision_digest','policy_decision_identity','policy_time',
                       'request_identity','reservation_digest','reservation_identity',
                       'reserved_at_epoch_ms','schema_version','started_at_epoch_ms',
                       'started_state_digest']::text[]
               )
          AND pg_catalog.jsonb_typeof(p_started->'request_identity') = 'string'
          AND pg_catalog.jsonb_typeof(p_started->'admission_identity') = 'string'
          AND p_started->>'request_identity' = p_request_identity
          AND p_started->>'admission_identity' = p_admission_identity
          AND p_started->>'schema_version' = '1'
          AND p_started->>'attempt_identity' = p_started->>'binding_identity'
          AND p_started->>'claim_identity' IS NOT NULL
          AND p_started->>'claim_digest' IS NOT NULL
          AND p_started->>'claimed_state_digest' IS NOT NULL
          AND p_started->>'invocation_admission_receipt_identity' IS NOT NULL
          AND p_started->>'invocation_admission_receipt_digest' IS NOT NULL
          AND p_started->>'reservation_identity' IS NOT NULL
          AND p_started->>'reservation_digest' IS NOT NULL
          AND p_started->>'reserved_at_epoch_ms' IS NOT NULL
          AND pg_catalog.jsonb_typeof(p_started->'authority') = 'object'
          AND (SELECT pg_catalog.array_agg(key ORDER BY key)
               FROM pg_catalog.jsonb_object_keys(p_started->'authority') AS keys(key)) = ARRAY[
                 'authority_class','environment_identity','fixture_corpus_digest','provider_profile_digest'
               ]::text[]
          AND p_started#>>'{authority,authority_class}' IN ('LIVE_EXTERNAL','SEALED_ACCEPTANCE')
          AND p_started#>>'{authority,environment_identity}' <> ''
          AND p_started#>>'{authority,provider_profile_digest}' ~ '^sha256:[0-9a-f]{64}$'
          AND (
            p_started->>'started_state_digest' IS NULL
            OR (p_started->>'policy_decision_identity' IS NOT NULL
                AND p_started->>'policy_decision_digest' ~ '^sha256:[0-9a-f]{64}$'
                AND pg_catalog.jsonb_typeof(p_started->'policy_time') = 'object')
          )
          AND p_started_receipt_identity = COALESCE(
                p_started->>'started_state_digest', p_started->>'reservation_identity'
              )
          AND pg_catalog.octet_length(p_started_receipt_identity) BETWEEN 1 AND 256
          AND p_started_receipt_identity !~ '[[:cntrl:]]'
          AND pg_catalog.jsonb_typeof(p_started->'interpretation') = 'object'
          AND (SELECT pg_catalog.array_agg(key ORDER BY key)
               FROM pg_catalog.jsonb_object_keys(p_started->'interpretation') AS keys(key)) = ARRAY[
                 'bounded_explanation','differentiating_prediction','falsifier','plausible_alternatives'
               ]::text[]
          AND pg_catalog.jsonb_typeof(p_started#>'{interpretation,bounded_explanation}') = 'string'
          AND pg_catalog.jsonb_typeof(p_started#>'{interpretation,differentiating_prediction}') = 'string'
          AND pg_catalog.jsonb_typeof(p_started#>'{interpretation,falsifier}') = 'string'
          AND pg_catalog.btrim(p_started#>>'{interpretation,bounded_explanation}') <> ''
          AND pg_catalog.btrim(p_started#>>'{interpretation,differentiating_prediction}') <> ''
          AND pg_catalog.btrim(p_started#>>'{interpretation,falsifier}') <> ''
          AND pg_catalog.octet_length(p_started#>>'{interpretation,bounded_explanation}') <= 8192
          AND pg_catalog.octet_length(p_started#>>'{interpretation,differentiating_prediction}') <= 8192
          AND pg_catalog.octet_length(p_started#>>'{interpretation,falsifier}') <= 8192
          AND (p_started#>>'{interpretation,bounded_explanation}') !~ '[[:cntrl:]]'
          AND (p_started#>>'{interpretation,differentiating_prediction}') !~ '[[:cntrl:]]'
          AND (p_started#>>'{interpretation,falsifier}') !~ '[[:cntrl:]]'
          AND pg_catalog.jsonb_typeof(p_started#>'{interpretation,plausible_alternatives}') = 'array'
          AND pg_catalog.jsonb_array_length(p_started#>'{interpretation,plausible_alternatives}') BETWEEN 1 AND 16
          AND NOT EXISTS (
            SELECT 1
            FROM pg_catalog.jsonb_array_elements(
              p_started#>'{interpretation,plausible_alternatives}'
            ) AS alternative(value)
            WHERE pg_catalog.jsonb_typeof(value) <> 'string'
               OR pg_catalog.btrim(value#>>'{}') = ''
               OR pg_catalog.octet_length(value#>>'{}') > 8192
               OR (value#>>'{}') ~ '[[:cntrl:]]'
          )
          AND (SELECT pg_catalog.count(*) = pg_catalog.count(DISTINCT value)
               FROM pg_catalog.jsonb_array_elements_text(
                 p_started#>'{interpretation,plausible_alternatives}'
               ) AS alternative(value))
      $function$;
ALTER FUNCTION rd_owner_api.valid_source_intake_started_custody_v1(text,text,text,jsonb) OWNER TO rd_owner;
REVOKE ALL ON FUNCTION rd_owner_api.valid_source_intake_started_custody_v1(text,text,text,jsonb) FROM PUBLIC, product_edge_owner, operator_authorization_writer, qualification_owner, qualification_writer;
CREATE OR REPLACE FUNCTION rd_owner_api.guard_source_intake_binding_v1()
      RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
      SET search_path = pg_catalog, public, pg_temp
      AS $function$
      BEGIN
        IF OLD.request_identity IS DISTINCT FROM NEW.request_identity
           OR OLD.binding_identity IS DISTINCT FROM NEW.binding_identity
           OR OLD.binding_commit_identity IS DISTINCT FROM NEW.binding_commit_identity
           OR OLD.binding_json IS DISTINCT FROM NEW.binding_json
           OR OLD.binding_committed_at_epoch_ms IS DISTINCT FROM NEW.binding_committed_at_epoch_ms THEN
          RAISE EXCEPTION 'immutable Source Intake binding changed';
        END IF;
        IF OLD.state IN ('INVOCATION_RESERVED','TERMINAL')
           AND (OLD.product_edge_started_receipt_identity IS DISTINCT FROM NEW.product_edge_started_receipt_identity
                OR OLD.product_edge_started_json IS DISTINCT FROM NEW.product_edge_started_json) THEN
          RAISE EXCEPTION 'committed Product Edge started custody changed';
        END IF;
        IF OLD.state = 'BINDING_CLOSED'
           AND NEW.state = 'PREPARED'
           AND rd_owner_api.valid_source_intake_started_custody_v1(
             NEW.request_identity,
             NEW.binding_json#>>'{product_edge_admission,admission_identity}',
             NEW.product_edge_started_receipt_identity,
             NEW.product_edge_started_json
           ) IS DISTINCT FROM true THEN
          RAISE EXCEPTION 'invalid Product Edge started custody';
        END IF;
        IF OLD.state = 'PREPARED'
           AND NEW.state = 'INVOCATION_RESERVED'
           AND (
             rd_owner_api.valid_source_intake_started_custody_v1(
               NEW.request_identity,
               NEW.binding_json#>>'{product_edge_admission,admission_identity}',
               NEW.product_edge_started_receipt_identity,
               NEW.product_edge_started_json
             ) IS DISTINCT FROM true
             OR NEW.product_edge_started_json->>'started_state_digest' IS NULL
             OR OLD.product_edge_started_json - 'interpretation'
                IS DISTINCT FROM NEW.product_edge_started_json - 'interpretation'
                                                       - 'started_state_digest'
                                                       - 'started_at_epoch_ms'
                                                       - 'policy_decision_identity'
                                                       - 'policy_decision_digest'
                                                       - 'policy_time'
             OR OLD.product_edge_started_json->'interpretation'
                IS DISTINCT FROM NEW.product_edge_started_json->'interpretation'
           ) THEN
          RAISE EXCEPTION 'invalid Product Edge started transition custody';
        END IF;
        IF NOT ((OLD.state = 'BINDING_CLOSED' AND NEW.state = 'PREPARED')
                OR (OLD.state = 'PREPARED' AND NEW.state = 'INVOCATION_RESERVED'
                    AND OLD.invocation_identity IS NULL AND NEW.invocation_identity IS NOT NULL)
                OR (OLD.state = 'PREPARED' AND NEW.state = 'TERMINAL'
                    AND OLD.invocation_identity IS NULL AND NEW.invocation_identity IS NULL)
                OR (OLD.state = 'INVOCATION_RESERVED' AND NEW.state = 'TERMINAL'
                    AND OLD.invocation_identity = NEW.invocation_identity)) THEN
          RAISE EXCEPTION 'invalid Source Intake lifecycle transition';
        END IF;
        RETURN NEW;
      END
      $function$;
ALTER FUNCTION rd_owner_api.guard_source_intake_binding_v1() OWNER TO rd_owner;
REVOKE ALL ON FUNCTION rd_owner_api.guard_source_intake_binding_v1() FROM PUBLIC, product_edge_owner, operator_authorization_writer, qualification_owner, qualification_writer;
CREATE TRIGGER rd_source_intake_binding_guard_v1 BEFORE UPDATE ON public.rd_source_intake_bindings_v1 FOR EACH ROW EXECUTE FUNCTION rd_owner_api.guard_source_intake_binding_v1();
CREATE TABLE public.rd_source_intake_receipts_v1 (
        receipt_identity text PRIMARY KEY,
        request_identity text NOT NULL UNIQUE REFERENCES public.rd_source_intake_bindings_v1(request_identity),
        terminal text NOT NULL CHECK (terminal IN ('RETRIEVED','NOT_FOUND','AUTH_REQUIRED','ACCESS_DENIED','RATE_LIMITED','TERMS_OR_LICENSE_BLOCKED','MALFORMED','UNAVAILABLE')),
        response_status smallint,
        response_header_digest text,
        content_digest text,
        receipt_json jsonb NOT NULL,
        attempt_identity text GENERATED ALWAYS AS (receipt_json->>'attempt_identity') STORED,
        terminal_evidence_identity text GENERATED ALWAYS AS (receipt_json->>'terminal_evidence_identity') STORED,
        terminal_evidence_digest text GENERATED ALWAYS AS (receipt_json->>'terminal_evidence_digest') STORED,
        connected_address inet GENERATED ALWAYS AS ((receipt_json->>'connected_address')::inet) STORED,
        response_media_type text GENERATED ALWAYS AS (receipt_json->>'response_media_type') STORED,
        response_size_bytes bigint GENERATED ALWAYS AS ((receipt_json->>'response_size_bytes')::bigint) STORED,
        shared_time_head_digest text GENERATED ALWAYS AS (receipt_json#>>'{retrieval_time,head_digest}') STORED,
        committed_at_epoch_ms bigint NOT NULL CHECK (committed_at_epoch_ms >= 0),
        CHECK (
          (terminal = 'RETRIEVED' AND response_status = 200 AND response_header_digest IS NOT NULL AND content_digest IS NOT NULL)
          OR (terminal <> 'RETRIEVED' AND content_digest IS NULL)
        ),
        UNIQUE (receipt_identity, terminal)
      );
CREATE TABLE public.rd_source_raw_payloads_v1 (
        content_digest text PRIMARY KEY,
        raw_payload bytea NOT NULL CHECK (octet_length(raw_payload) BETWEEN 1 AND 1048576)
      );
CREATE TABLE public.rd_source_raw_receipt_links_v1 (
        receipt_identity text PRIMARY KEY,
        terminal text NOT NULL DEFAULT 'RETRIEVED' CHECK (terminal = 'RETRIEVED'),
        content_digest text NOT NULL REFERENCES public.rd_source_raw_payloads_v1(content_digest),
        UNIQUE (receipt_identity, content_digest),
        FOREIGN KEY (receipt_identity, terminal)
          REFERENCES public.rd_source_intake_receipts_v1(receipt_identity, terminal)
      );
CREATE TABLE public.rd_research_source_provenance_v1 (
        provenance_identity text PRIMARY KEY,
        receipt_identity text NOT NULL UNIQUE,
        content_digest text NOT NULL,
        provenance_json jsonb NOT NULL,
        predecessor_provenance_identity text GENERATED ALWAYS AS (provenance_json->>'predecessor_provenance_identity') STORED,
        canonical_source_origin text GENERATED ALWAYS AS (provenance_json->>'canonical_source_origin') STORED,
        source_class text GENERATED ALWAYS AS (provenance_json->>'source_class') STORED,
        author_or_originating_system text GENERATED ALWAYS AS (provenance_json->>'author_or_originating_system') STORED,
        publication_time_epoch_ms bigint GENERATED ALWAYS AS ((provenance_json->>'publication_time_epoch_ms')::bigint) STORED,
        revision_identity text GENERATED ALWAYS AS (provenance_json->>'revision_identity') STORED,
        raw_content_digest text GENERATED ALWAYS AS (provenance_json->>'raw_content_digest') STORED,
        retrieval_time_head_digest text GENERATED ALWAYS AS (provenance_json#>>'{retrieval_time,head_digest}') STORED,
        rights_policy_version text GENERATED ALWAYS AS (provenance_json->>'rights_policy_version') STORED,
        retention_policy_version text GENERATED ALWAYS AS (provenance_json->>'retention_policy_version') STORED,
        interpretation_status text GENERATED ALWAYS AS (provenance_json->>'interpretation_status') STORED,
        FOREIGN KEY (receipt_identity, content_digest)
          REFERENCES public.rd_source_raw_receipt_links_v1(receipt_identity, content_digest)
      );
CREATE TABLE public.rd_source_candidates_v1 (
        candidate_identity text PRIMARY KEY,
        provenance_identity text NOT NULL UNIQUE REFERENCES public.rd_research_source_provenance_v1(provenance_identity),
        candidate_json jsonb NOT NULL
      );
ALTER TABLE public.rd_source_intake_bindings_v1
       ADD CONSTRAINT rd_source_intake_terminal_receipt_v1
       FOREIGN KEY (terminal_receipt_identity)
       REFERENCES public.rd_source_intake_receipts_v1(receipt_identity);
ALTER TABLE public.rd_source_intake_bindings_v1 OWNER TO rd_owner;
ALTER TABLE public.rd_source_intake_receipts_v1 OWNER TO rd_owner;
ALTER TABLE public.rd_source_raw_payloads_v1 OWNER TO rd_owner;
ALTER TABLE public.rd_source_raw_receipt_links_v1 OWNER TO rd_owner;
ALTER TABLE public.rd_research_source_provenance_v1 OWNER TO rd_owner;
ALTER TABLE public.rd_source_candidates_v1 OWNER TO rd_owner;
CREATE OR REPLACE FUNCTION rd_owner_api.reject_source_intake_terminal_mutation_v1()
      RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
      SET search_path = pg_catalog, pg_temp
      AS $function$
      BEGIN
        RAISE EXCEPTION 'immutable Source Intake terminal custody changed';
      END
      $function$;
ALTER FUNCTION rd_owner_api.reject_source_intake_terminal_mutation_v1() OWNER TO rd_owner;
REVOKE ALL ON FUNCTION rd_owner_api.reject_source_intake_terminal_mutation_v1() FROM PUBLIC, product_edge_owner, operator_authorization_writer, qualification_owner, qualification_writer;
CREATE TRIGGER rd_source_intake_receipt_immutable_v1 BEFORE UPDATE OR DELETE OR TRUNCATE ON public.rd_source_intake_receipts_v1 FOR EACH STATEMENT EXECUTE FUNCTION rd_owner_api.reject_source_intake_terminal_mutation_v1();
CREATE TRIGGER rd_source_raw_payload_immutable_v1 BEFORE UPDATE OR DELETE OR TRUNCATE ON public.rd_source_raw_payloads_v1 FOR EACH STATEMENT EXECUTE FUNCTION rd_owner_api.reject_source_intake_terminal_mutation_v1();
CREATE TRIGGER rd_source_raw_receipt_link_immutable_v1 BEFORE UPDATE OR DELETE OR TRUNCATE ON public.rd_source_raw_receipt_links_v1 FOR EACH STATEMENT EXECUTE FUNCTION rd_owner_api.reject_source_intake_terminal_mutation_v1();
CREATE TRIGGER rd_research_source_provenance_immutable_v1 BEFORE UPDATE OR DELETE OR TRUNCATE ON public.rd_research_source_provenance_v1 FOR EACH STATEMENT EXECUTE FUNCTION rd_owner_api.reject_source_intake_terminal_mutation_v1();
CREATE TRIGGER rd_source_candidate_immutable_v1 BEFORE UPDATE OR DELETE OR TRUNCATE ON public.rd_source_candidates_v1 FOR EACH STATEMENT EXECUTE FUNCTION rd_owner_api.reject_source_intake_terminal_mutation_v1();
REVOKE ALL ON public.rd_source_intake_bindings_v1, public.rd_source_intake_receipts_v1, public.rd_source_raw_payloads_v1, public.rd_source_raw_receipt_links_v1, public.rd_research_source_provenance_v1, public.rd_source_candidates_v1 FROM PUBLIC, product_edge_owner, operator_authorization_writer, qualification_owner, qualification_writer;
GRANT SELECT, INSERT, UPDATE ON public.rd_source_intake_bindings_v1 TO rd_owner;
GRANT SELECT, INSERT, UPDATE, REFERENCES ON public.rd_source_intake_receipts_v1, public.rd_source_raw_payloads_v1, public.rd_source_raw_receipt_links_v1, public.rd_research_source_provenance_v1, public.rd_source_candidates_v1 TO rd_owner;
CREATE OR REPLACE FUNCTION rd_owner_api.read_source_intake_v1(p_request_identity text)
      RETURNS jsonb LANGUAGE sql STRICT STABLE PARALLEL SAFE SECURITY DEFINER
      SET search_path = pg_catalog, public, pg_temp
      AS $function$
        WITH observed AS (
          SELECT binding.*,
                 receipt.receipt_identity, receipt.request_identity AS receipt_request_identity,
                 receipt.terminal, receipt.response_status, receipt.response_header_digest,
                 receipt.content_digest AS receipt_content_digest, receipt.receipt_json,
                 receipt.committed_at_epoch_ms,
                 raw_link.receipt_identity AS raw_link_receipt_identity,
                 raw_link.content_digest AS raw_link_content_digest,
                 raw.content_digest AS raw_content_digest, raw.raw_payload,
                 'sha256:' || pg_catalog.encode(pg_catalog.sha256(raw.raw_payload), 'hex') AS observed_content_digest,
                 provenance.provenance_identity, provenance.receipt_identity AS provenance_receipt_identity,
                 provenance.content_digest AS provenance_content_digest, provenance.provenance_json,
                 candidate.candidate_identity, candidate.provenance_identity AS candidate_provenance_identity,
                 candidate.candidate_json,
                 outbox.event_identity, outbox.aggregate_identity, outbox.event_kind,
                 outbox.payload_digest, outbox.payload_json,
                 outbox.committed_at_epoch_ms AS outbox_committed_at_epoch_ms
          FROM public.rd_source_intake_bindings_v1 binding
          LEFT JOIN public.rd_source_intake_receipts_v1 receipt
            ON receipt.request_identity = binding.request_identity
          LEFT JOIN public.rd_source_raw_receipt_links_v1 raw_link
            ON raw_link.receipt_identity = receipt.receipt_identity
          LEFT JOIN public.rd_source_raw_payloads_v1 raw
            ON raw.content_digest = raw_link.content_digest
          LEFT JOIN public.rd_research_source_provenance_v1 provenance
            ON provenance.receipt_identity = raw_link.receipt_identity
           AND provenance.content_digest = raw_link.content_digest
          LEFT JOIN public.rd_source_candidates_v1 candidate
            ON candidate.provenance_identity = provenance.provenance_identity
          LEFT JOIN public.rd_owner_outbox_v1 outbox
            ON outbox.aggregate_identity = binding.request_identity
           AND outbox.event_kind = 'SOURCE_INTAKE_TERMINATED_V1'
          WHERE binding.request_identity = p_request_identity
        ), interpreted AS (
          SELECT observed.*,
                 rd_owner_api.derive_source_intake_identity_v1(
                   'rd.source-intake.interpretation.v1', ARRAY[
                     observed.product_edge_started_json#>>'{interpretation,bounded_explanation}',
                     (SELECT pg_catalog.string_agg(value, pg_catalog.chr(30) ORDER BY ordinality)
                        FROM pg_catalog.jsonb_array_elements_text(
                          observed.product_edge_started_json#>'{interpretation,plausible_alternatives}'
                        ) WITH ORDINALITY AS alternative(value, ordinality)),
                     observed.product_edge_started_json#>>'{interpretation,differentiating_prediction}',
                     observed.product_edge_started_json#>>'{interpretation,falsifier}'
                   ]::text[]
                 ) AS observed_interpretation_digest
          FROM observed
        ), derived AS (
          SELECT interpreted.*,
                 rd_owner_api.derive_source_intake_identity_v1(
                   'rd.source-interpretation.v1',
                   ARRAY[interpreted.observed_interpretation_digest]::text[]
                 ) AS observed_interpretation_identity
          FROM interpreted
        )
        SELECT pg_catalog.jsonb_build_object(
          'request_identity', binding.request_identity,
          'binding_identity', binding.binding_identity,
          'authority', binding.binding_json->'authority',
          'state', binding.state,
          'terminal', binding.terminal,
          'receipt', CASE WHEN binding.receipt_identity IS NULL THEN NULL ELSE pg_catalog.jsonb_build_object(
            'receipt_identity', binding.receipt_identity,
            'request_identity', binding.receipt_request_identity,
            'binding_identity', binding.binding_identity,
            'invocation_identity', binding.invocation_identity,
            'terminal', binding.terminal,
            'response_status', binding.response_status,
            'response_header_digest', binding.response_header_digest,
            'content_digest', binding.receipt_content_digest,
            'committed_at_epoch_ms', binding.committed_at_epoch_ms
          ) END,
          'content_locator', CASE WHEN binding.raw_content_digest IS NULL THEN NULL ELSE 'rd-owner://source-payload/sha256/' || binding.raw_content_digest END,
          'content_digest', binding.raw_content_digest,
          'provenance_identity', binding.provenance_identity,
          'source_candidate_identity', binding.candidate_identity,
          'outbox_event_identity', binding.event_identity
        )
        FROM derived binding
        WHERE binding.state = 'TERMINAL'
          AND binding.terminal_receipt_identity = binding.receipt_identity
          AND NOT EXISTS (
            SELECT 1
            FROM (VALUES
              ('binding_identity'), ('request_identity'), ('channel'), ('admission_identity'),
              ('operation_manifest_identity'), ('normalized_doi'), ('connector_identity'),
              ('connector_version'), ('tls_stack_identity'), ('method'), ('https_origin'),
              ('endpoint_path'), ('absent_body_digest'), ('allowed_header_digest'), ('media_type'),
              ('rights_basis_identity'), ('retention_policy_identity'), ('time_evidence_identity'),
              ('admission')
            ) AS field(key)
            WHERE pg_catalog.jsonb_typeof(binding.binding_json->field.key)
                  IS DISTINCT FROM 'string'
          )
          AND NOT EXISTS (
            SELECT 1
            FROM (VALUES
              ('byte_limit'), ('timeout_ms'), ('retry_budget'), ('redirect_hop_limit'),
              ('observed_at_epoch_ms')
            ) AS field(key)
            WHERE pg_catalog.jsonb_typeof(binding.binding_json->field.key)
                  IS DISTINCT FROM 'number'
          )
          AND pg_catalog.jsonb_typeof(binding.binding_json->'resolved_addresses') = 'array'
          AND NOT EXISTS (
            SELECT 1
            FROM pg_catalog.jsonb_array_elements(binding.binding_json->'resolved_addresses') AS address(value)
            WHERE pg_catalog.jsonb_typeof(value) <> 'string'
          )
          AND binding.binding_json = pg_catalog.jsonb_build_object(
            'binding_identity', binding.binding_identity,
            'request_identity', binding.request_identity,
            'channel', binding.binding_json->>'channel',
            'admission_identity', binding.binding_json->>'admission_identity',
            'operation_manifest_identity', binding.binding_json->>'operation_manifest_identity',
            'normalized_doi', binding.binding_json->>'normalized_doi',
            'connector_identity', 'rd.openalex-work-by-doi',
            'connector_version', 'v1',
            'tls_stack_identity', 'rustls-only-v1',
            'method', 'GET',
            'https_origin', 'https://api.openalex.org',
            'endpoint_path', ('/works/doi:' || (binding.binding_json->>'normalized_doi')),
            'resolved_addresses', CASE
              WHEN pg_catalog.jsonb_typeof(binding.binding_json->'resolved_addresses') = 'array'
               AND NOT EXISTS (
                 SELECT 1
                 FROM pg_catalog.jsonb_array_elements(binding.binding_json->'resolved_addresses') AS address(value)
                 WHERE pg_catalog.jsonb_typeof(value) <> 'string'
               )
              THEN binding.binding_json->'resolved_addresses'
              ELSE NULL
            END,
            'absent_body_digest', binding.binding_json->>'absent_body_digest',
            'allowed_header_digest', binding.binding_json->>'allowed_header_digest',
            'media_type', 'application/json',
            'byte_limit', CASE
              WHEN pg_catalog.jsonb_typeof(binding.binding_json->'byte_limit') = 'number'
              THEN binding.binding_json->'byte_limit' ELSE NULL
            END,
            'timeout_ms', CASE
              WHEN pg_catalog.jsonb_typeof(binding.binding_json->'timeout_ms') = 'number'
              THEN binding.binding_json->'timeout_ms' ELSE NULL
            END,
            'retry_budget', 0,
            'redirect_hop_limit', 0,
            'rights_basis_identity', binding.binding_json->>'rights_basis_identity',
            'retention_policy_identity', binding.binding_json->>'retention_policy_identity',
            'time_evidence_identity', binding.binding_json->>'time_evidence_identity',
            'observed_at_epoch_ms', CASE
              WHEN pg_catalog.jsonb_typeof(binding.binding_json->'observed_at_epoch_ms') = 'number'
              THEN binding.binding_json->'observed_at_epoch_ms' ELSE NULL
            END,
            'admission', binding.binding_json->>'admission'
          )
          AND binding.binding_identity = rd_owner_api.derive_source_acquisition_binding_identity_v1(binding.binding_json)
          AND rd_owner_api.valid_source_intake_started_custody_v1(
            binding.request_identity,
            binding.binding_json->>'admission_identity',
            binding.product_edge_started_receipt_identity,
            binding.product_edge_started_json
          )
          AND (
            binding.invocation_identity IS NULL
            OR binding.invocation_identity = rd_owner_api.derive_source_intake_identity_v1(
              'rd.source-intake.openalex.invocation.v1', ARRAY[
                binding.request_identity, binding.binding_identity,
                binding.binding_commit_identity,
                binding.product_edge_started_receipt_identity
              ]::text[]
            )
          )
          AND binding.receipt_request_identity = binding.request_identity
          AND binding.receipt_identity = rd_owner_api.derive_source_intake_identity_v1(
            'rd.source-intake.receipt.v1', ARRAY[
              binding.request_identity, binding.binding_identity,
              COALESCE(binding.invocation_identity, rd_owner_api.derive_source_intake_identity_v1(
                'rd.source-intake.pre-invocation.v1', ARRAY[
                  binding.request_identity, binding.binding_identity,
                  binding.binding_commit_identity,
                  binding.product_edge_started_receipt_identity
                ]::text[]
              )), binding.terminal,
              COALESCE(binding.receipt_content_digest, 'ABSENT'),
              COALESCE(binding.response_status::text, 'ABSENT'),
              COALESCE(binding.response_header_digest, 'ABSENT'),
              binding.committed_at_epoch_ms::text
            ]::text[]
          )
          AND binding.receipt_json = pg_catalog.jsonb_build_object(
            'receipt_identity', binding.receipt_identity,
            'request_identity', binding.request_identity,
            'binding_identity', binding.binding_identity,
            'invocation_identity', binding.invocation_identity,
            'terminal', binding.terminal,
            'response_status', binding.response_status,
            'response_header_digest', binding.response_header_digest,
            'content_digest', binding.receipt_content_digest,
            'committed_at_epoch_ms', binding.committed_at_epoch_ms
          )
          AND binding.aggregate_identity = binding.request_identity
          AND binding.event_kind = 'SOURCE_INTAKE_TERMINATED_V1'
          AND binding.event_identity = rd_owner_api.derive_source_intake_identity_v1(
            'rd.owner-outbox.source-intake-terminated.v1',
            ARRAY[binding.request_identity, binding.receipt_identity]::text[]
          )
          AND binding.payload_digest = rd_owner_api.derive_source_intake_identity_v1(
            'rd.owner-outbox.payload.v1', ARRAY[
              binding.request_identity, binding.receipt_identity,
              COALESCE(binding.provenance_identity, 'ABSENT'),
              COALESCE(binding.candidate_identity, 'ABSENT')
            ]::text[]
          )
          AND binding.payload_json = pg_catalog.jsonb_build_object(
            'event_identity', binding.event_identity,
            'aggregate_identity', binding.aggregate_identity,
            'event_kind', binding.event_kind,
            'payload_digest', binding.payload_digest
          )
          AND binding.outbox_committed_at_epoch_ms = binding.committed_at_epoch_ms
          AND (
            binding.terminal <> 'RETRIEVED'
            OR (
             binding.invocation_identity IS NOT NULL
             AND binding.raw_link_receipt_identity = binding.receipt_identity
             AND binding.raw_link_content_digest = binding.receipt_content_digest
             AND binding.raw_content_digest = binding.observed_content_digest
             AND binding.raw_content_digest = binding.receipt_content_digest
             AND binding.provenance_receipt_identity = binding.receipt_identity
             AND binding.provenance_content_digest = binding.observed_content_digest
             AND binding.provenance_json = pg_catalog.jsonb_build_object(
               'provenance_identity', binding.provenance_identity,
               'canonical_source_identity',
                 ('doi:' || (binding.binding_json->>'normalized_doi')),
               'content_digest', binding.observed_content_digest,
               'connector_identity', 'rd.openalex-work-by-doi',
               'connector_version', 'v1',
               'acquisition_receipt_identity', binding.receipt_identity,
               'time_evidence_identity', binding.binding_json->>'time_evidence_identity',
               'rights_basis_identity', binding.binding_json->>'rights_basis_identity',
               'retention_policy_identity', binding.binding_json->>'retention_policy_identity',
               'bounded_interpretation_identity',
                 binding.observed_interpretation_identity,
               'bounded_interpretation_digest',
                 binding.observed_interpretation_digest,
               'interpretation', binding.product_edge_started_json->'interpretation',
               'trust_class', 'UNTRUSTED_EXTERNAL_DATA',
               'location_rights', rd_owner_api.derive_openalex_location_rights_v1(
                 pg_catalog.convert_from(binding.raw_payload, 'UTF8')::jsonb,
                 binding.binding_json->>'normalized_doi'
               )
             )
             AND binding.provenance_identity = rd_owner_api.derive_source_intake_identity_v1(
               'rd.research-source-provenance.v1', ARRAY[
                 binding.binding_json->>'normalized_doi', binding.observed_content_digest,
                 binding.receipt_identity, binding.binding_json->>'time_evidence_identity',
                 binding.observed_interpretation_identity,
                 binding.observed_interpretation_digest
               ]::text[]
             )
             AND binding.candidate_provenance_identity = binding.provenance_identity
             AND binding.candidate_json = pg_catalog.jsonb_build_object(
               'candidate_identity', binding.candidate_identity,
               'provenance_identity', binding.provenance_identity,
               'interpretation_digest', binding.observed_interpretation_digest,
               'trust_class', 'UNTRUSTED_EXTERNAL_DATA'
             )
             AND binding.candidate_identity = rd_owner_api.derive_source_intake_identity_v1(
               'rd.source-candidate.v1', ARRAY[
                 binding.provenance_identity,
                 binding.observed_interpretation_digest
               ]::text[]
             )
            )
          )
      $function$;
ALTER FUNCTION rd_owner_api.read_source_intake_v1(text) OWNER TO rd_owner;
REVOKE ALL ON FUNCTION rd_owner_api.read_source_intake_v1(text) FROM PUBLIC, product_edge_owner, operator_authorization_writer, qualification_owner, qualification_writer;
CREATE OR REPLACE FUNCTION rd_owner_api.valid_source_intake_binding_contract_v1(binding jsonb)
      RETURNS boolean LANGUAGE sql STRICT IMMUTABLE PARALLEL SAFE
      SET search_path = pg_catalog, pg_temp
      AS $function$
        SELECT pg_catalog.jsonb_typeof(binding) = 'object'
          AND (SELECT pg_catalog.array_agg(key ORDER BY key)
               FROM pg_catalog.jsonb_object_keys(binding) keys(key)) = ARRAY[
            'absent_body_digest','acquisition_scope','admission','allowed_header_digest','authority',
            'binding_digest','binding_identity','body_media_type','body_size_bytes','byte_limit',
            'connector_identity','connector_policy_identity','connector_policy_version','connector_version',
            'credential_audience','credential_handle_identity','credential_placement',
            'credential_policy_identity','credential_scope','dns_observation_digest',
            'dns_observation_identity','dns_policy_identity','dns_policy_version',
            'egress_policy_identity','egress_policy_version','endpoint_path','endpoint_query',
            'gateway','header_byte_limit','header_count_limit','host','https_origin','media_type',
            'method','network_policy_identity','network_policy_version','normalized_doi',
            'operation_manifest_digest','operation_manifest_identity','policy_evidence_digest',
            'policy_evidence_identity','predecessor_binding_identity','product_edge_admission',
            'redirect_hop_index','redirect_hop_limit','redirect_policy_identity',
            'redirect_policy_version','redirect_predecessor_binding_identity','request_identity',
            'resolved_addresses',
            'retention_effective_at_epoch_ms','retention_policy_identity','retention_policy_version',
            'retention_scope','retention_valid_through_epoch_ms','retry_budget','rights_basis_identity',
            'rights_effective_at_epoch_ms','rights_policy_version','rights_valid_through_epoch_ms',
            'schema_version','scheme','shared_time','timeout_ms','tls_policy_identity','tls_policy_version',
            'tls_stack_identity'
          ]::text[]
          AND binding->>'schema_version' = '1'
          AND binding->>'gateway' = 'WINDMILL_PRODUCT_EDGE'
          AND binding->>'predecessor_binding_identity' IS NULL
          AND pg_catalog.jsonb_typeof(binding->'authority') = 'object'
          AND (SELECT pg_catalog.array_agg(key ORDER BY key)
               FROM pg_catalog.jsonb_object_keys(binding->'authority') keys(key)) = ARRAY[
            'authority_class','environment_identity','fixture_corpus_digest','provider_profile_digest'
          ]::text[]
          AND binding#>>'{authority,authority_class}' IN ('LIVE_EXTERNAL','SEALED_ACCEPTANCE')
          AND binding#>>'{authority,environment_identity}' <> ''
          AND binding#>>'{authority,provider_profile_digest}' ~ '^sha256:[0-9a-f]{64}$'
          AND (
            (binding#>>'{authority,authority_class}' = 'LIVE_EXTERNAL'
             AND binding#>>'{authority,environment_identity}' = 'PRODUCTION_LIVE_EXTERNAL'
             AND binding#>>'{authority,provider_profile_digest}' = 'sha256:18e4411c991be0a92514bc8ff238ef0429f379d7aa0fd17c1169c7a4c0f45c6b'
             AND binding#>>'{authority,fixture_corpus_digest}' IS NULL)
            OR
            (binding#>>'{authority,authority_class}' = 'SEALED_ACCEPTANCE'
             AND binding#>>'{authority,environment_identity}' = 'source-intake-sealed-acceptance-environment-v1'
             AND binding#>>'{authority,provider_profile_digest}' = 'sha256:20e4901e7b97516edbaa744c0e866b0c509595386357c1b973e48beac1657f15'
             AND binding#>>'{authority,fixture_corpus_digest}' = 'sha256:b8cf806629fbb7baa2e38707b4d246a17e44d9841509701530cbd97558ddad18')
          )
          AND pg_catalog.jsonb_typeof(binding->'product_edge_admission') = 'object'
          AND (SELECT pg_catalog.array_agg(key ORDER BY key)
               FROM pg_catalog.jsonb_object_keys(binding->'product_edge_admission') keys(key))
              = ARRAY['admission_digest','admission_identity','request_identity']::text[]
          AND binding#>>'{product_edge_admission,request_identity}' = binding->>'request_identity'
          AND binding#>>'{product_edge_admission,admission_digest}' ~ '^sha256:[0-9a-f]{64}$'
          AND binding->>'operation_manifest_digest' ~ '^sha256:[0-9a-f]{64}$'
          AND binding->>'policy_evidence_digest' ~ '^sha256:[0-9a-f]{64}$'
          AND binding->>'connector_policy_identity' <> ''
          AND binding->>'connector_policy_version' <> ''
          AND binding->>'network_policy_identity' <> ''
          AND binding->>'network_policy_version' <> ''
          AND binding->>'dns_policy_identity' <> ''
          AND binding->>'dns_policy_version' <> ''
          AND binding->>'dns_observation_identity' <> ''
          AND binding->>'dns_observation_digest' ~ '^sha256:[0-9a-f]{64}$'
          AND binding->>'redirect_policy_identity' <> ''
          AND binding->>'redirect_policy_version' <> ''
          AND binding->>'credential_policy_identity' <> ''
          AND binding->>'credential_handle_identity' <> ''
          AND binding->>'credential_audience' <> ''
          AND binding->>'credential_scope' <> ''
          AND binding->>'egress_policy_identity' <> ''
          AND binding->>'egress_policy_version' <> ''
          AND binding->>'connector_version' = 'v1'
          AND binding->>'tls_stack_identity' = 'rustls-only-v1'
          AND binding->>'method' = 'GET'
          AND (
            (binding#>>'{authority,authority_class}' = 'LIVE_EXTERNAL'
             AND binding->>'connector_identity' = 'rd.openalex-work-by-doi'
             AND binding->>'scheme' = 'https'
             AND binding->>'host' = 'api.openalex.org'
             AND binding->>'https_origin' = 'https://api.openalex.org')
            OR
            (binding#>>'{authority,authority_class}' = 'SEALED_ACCEPTANCE'
             AND binding->>'connector_identity' = 'rd.openalex-work-by-doi.sealed-acceptance'
             AND binding->>'scheme' = 'sealed-acceptance'
             AND binding->>'host' = 'openalex-fixture.source-intake.invalid'
             AND binding->>'https_origin' = 'sealed-acceptance://openalex-fixture.source-intake.invalid'
             AND binding->>'credential_handle_identity' = 'NO_CREDENTIAL_CAPABILITY'
             AND binding->>'egress_policy_identity' = 'NO_EXTERNAL_NETWORK')
          )
          AND binding->>'endpoint_path' = '/works/doi:' || (binding->>'normalized_doi')
          AND binding->>'endpoint_query' = ''
          AND binding->>'redirect_predecessor_binding_identity' IS NULL
          AND binding->>'redirect_hop_index' = '0'
          AND binding->>'redirect_hop_limit' = '0'
          AND binding->>'retry_budget' = '0'
          AND binding->>'body_media_type' IS NULL
          AND binding->>'body_size_bytes' = '0'
          AND binding->>'credential_placement' = 'ABSENT_BODY_AND_HEADERS'
          AND binding->>'media_type' = 'application/json'
          AND pg_catalog.jsonb_typeof(binding->'resolved_addresses') = 'array'
          AND pg_catalog.jsonb_array_length(binding->'resolved_addresses') BETWEEN 1 AND 8
          AND pg_catalog.jsonb_typeof(binding->'shared_time') = 'object'
          AND (SELECT pg_catalog.array_agg(key ORDER BY key)
               FROM pg_catalog.jsonb_object_keys(binding->'shared_time') keys(key)) = ARRAY[
            'clock_epoch','clock_identity','comparison_rule','decision_cut_epoch_ms',
            'epoch_successor_proof_identity','head_digest','head_identity','monotonic_sequence',
            'predecessor_head_digest','restart_continuity_digest','skew_bound_ms',
            'successor_proof_commit_cut_epoch_ms','uncertainty_bound_ms','valid_through_epoch_ms',
            'wall_observed_epoch_ms'
          ]::text[]
          AND binding#>>'{shared_time,comparison_rule}' = 'EXCLUSIVE_VALID_THROUGH'
          AND (binding#>>'{shared_time,monotonic_sequence}')::bigint > 0
          AND (binding#>>'{shared_time,decision_cut_epoch_ms}')::bigint
                < (binding#>>'{shared_time,valid_through_epoch_ms}')::bigint
          AND (binding->>'rights_effective_at_epoch_ms')::bigint
                <= (binding#>>'{shared_time,decision_cut_epoch_ms}')::bigint
          AND (binding#>>'{shared_time,decision_cut_epoch_ms}')::bigint
                < (binding->>'rights_valid_through_epoch_ms')::bigint
          AND (binding->>'retention_effective_at_epoch_ms')::bigint
                <= (binding#>>'{shared_time,decision_cut_epoch_ms}')::bigint
          AND (binding#>>'{shared_time,decision_cut_epoch_ms}')::bigint
                < (binding->>'retention_valid_through_epoch_ms')::bigint
          AND binding->>'admission' IN ('ADMITTED','REJECTED','POLICY_UNAVAILABLE')
          AND (binding->>'header_count_limit')::bigint = 64
          AND (binding->>'header_byte_limit')::bigint = 32768
          AND (binding->>'byte_limit')::bigint BETWEEN 1 AND 1048576
          AND (binding->>'timeout_ms')::bigint BETWEEN 1 AND 5000
          AND binding->>'binding_digest'
                = rd_owner_api.derive_source_acquisition_binding_digest_v1(binding)
          AND binding->>'binding_identity'
                = rd_owner_api.derive_source_acquisition_binding_identity_v1(binding)
      $function$;
ALTER FUNCTION rd_owner_api.valid_source_intake_binding_contract_v1(jsonb) OWNER TO rd_owner;
REVOKE ALL ON FUNCTION rd_owner_api.valid_source_intake_binding_contract_v1(jsonb) FROM PUBLIC, product_edge_owner, operator_authorization_writer, qualification_owner, qualification_writer;
CREATE OR REPLACE FUNCTION rd_owner_api.valid_source_intake_receipt_v1(
        receipt jsonb, row_receipt_identity text, row_request_identity text, row_binding_identity text,
        row_invocation_identity text, row_terminal text, row_response_status smallint,
        row_response_header_digest text, row_content_digest text, row_committed_at_epoch_ms bigint
      ) RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE
      SET search_path = pg_catalog, pg_temp
      AS $function$
        SELECT pg_catalog.jsonb_typeof(receipt) = 'object'
          AND (SELECT pg_catalog.array_agg(key ORDER BY key)
               FROM pg_catalog.jsonb_object_keys(receipt) keys(key)) = ARRAY[
            'attempt_identity','binding_identity','committed_at_epoch_ms','connected_address',
            'content_digest','invocation_identity','policy_decision_digest','policy_decision_identity',
            'policy_decision_time','receipt_identity','request_identity','response_header_digest',
            'response_media_type','response_size_bytes','response_status','retrieval_time',
            'retrieval_time_evidence_digest','retrieval_time_evidence_identity','schema_version',
            'terminal','terminal_evidence_digest','terminal_evidence_identity'
          ]::text[]
          AND receipt->>'schema_version' = '1'
          AND receipt->>'receipt_identity' = row_receipt_identity
          AND receipt->>'request_identity' = row_request_identity
          AND receipt->>'binding_identity' = row_binding_identity
          AND receipt->>'attempt_identity' = row_binding_identity
          AND receipt->>'invocation_identity' IS NOT DISTINCT FROM row_invocation_identity
          AND receipt->>'terminal' = row_terminal
          AND (receipt->>'response_status')::smallint IS NOT DISTINCT FROM row_response_status
          AND receipt->>'response_header_digest' IS NOT DISTINCT FROM row_response_header_digest
          AND receipt->>'content_digest' IS NOT DISTINCT FROM row_content_digest
          AND (receipt->>'committed_at_epoch_ms')::bigint = row_committed_at_epoch_ms
          AND receipt->>'terminal_evidence_identity' ~ '^sha256:[0-9a-f]{64}$'
          AND receipt->>'terminal_evidence_digest' ~ '^sha256:[0-9a-f]{64}$'
          AND receipt->>'policy_decision_identity' <> ''
          AND receipt->>'policy_decision_digest' ~ '^sha256:[0-9a-f]{64}$'
          AND receipt->>'retrieval_time_evidence_identity' <> ''
          AND receipt->>'retrieval_time_evidence_digest' ~ '^sha256:[0-9a-f]{64}$'
          AND pg_catalog.jsonb_typeof(receipt->'policy_decision_time') = 'object'
          AND pg_catalog.jsonb_typeof(receipt->'retrieval_time') = 'object'
          AND (SELECT pg_catalog.array_agg(key ORDER BY key)
               FROM pg_catalog.jsonb_object_keys(receipt->'policy_decision_time') keys(key)) = ARRAY[
            'clock_epoch','clock_identity','comparison_rule','decision_cut_epoch_ms',
            'epoch_successor_proof_identity','head_digest','head_identity','monotonic_sequence',
            'predecessor_head_digest','restart_continuity_digest','skew_bound_ms',
            'successor_proof_commit_cut_epoch_ms','uncertainty_bound_ms','valid_through_epoch_ms',
            'wall_observed_epoch_ms'
          ]::text[]
          AND (SELECT pg_catalog.array_agg(key ORDER BY key)
               FROM pg_catalog.jsonb_object_keys(receipt->'retrieval_time') keys(key)) = ARRAY[
            'clock_epoch','clock_identity','comparison_rule','decision_cut_epoch_ms',
            'epoch_successor_proof_identity','head_digest','head_identity','monotonic_sequence',
            'predecessor_head_digest','restart_continuity_digest','skew_bound_ms',
            'successor_proof_commit_cut_epoch_ms','uncertainty_bound_ms','valid_through_epoch_ms',
            'wall_observed_epoch_ms'
          ]::text[]
          AND (receipt#>>'{policy_decision_time,decision_cut_epoch_ms}')::bigint
                <= (receipt#>>'{retrieval_time,decision_cut_epoch_ms}')::bigint
          AND (receipt#>>'{retrieval_time,decision_cut_epoch_ms}')::bigint
                < (receipt#>>'{retrieval_time,valid_through_epoch_ms}')::bigint
      $function$;
ALTER FUNCTION rd_owner_api.valid_source_intake_receipt_v1(jsonb,text,text,text,text,text,smallint,text,text,bigint) OWNER TO rd_owner;
REVOKE ALL ON FUNCTION rd_owner_api.valid_source_intake_receipt_v1(jsonb,text,text,text,text,text,smallint,text,text,bigint) FROM PUBLIC, product_edge_owner, operator_authorization_writer, qualification_owner, qualification_writer;
CREATE OR REPLACE FUNCTION rd_owner_api.canonical_source_intake_custody_v1(p_request_identity text)
      RETURNS jsonb LANGUAGE sql STRICT STABLE PARALLEL SAFE SECURITY DEFINER
      SET search_path = pg_catalog, public, pg_temp
      AS $function$
        SELECT pg_catalog.jsonb_build_object(
          'request_identity', binding.request_identity,
          'binding_identity', binding.binding_identity,
          'authority', binding.binding_json->'authority',
          'state', binding.state,
          'terminal', receipt.terminal,
          'receipt', receipt.receipt_json,
          'content_locator', CASE WHEN receipt.terminal = 'RETRIEVED'
            THEN 'rd-owner://source-payload/sha256/' || receipt.content_digest ELSE NULL END,
          'content_digest', receipt.content_digest,
          'provenance_identity', provenance.provenance_identity,
          'source_candidate_identity', candidate.candidate_identity,
          'outbox_event_identity', outbox.event_identity
        )
        FROM public.rd_source_intake_bindings_v1 binding
        JOIN public.rd_source_intake_receipts_v1 receipt
          ON receipt.request_identity = binding.request_identity
         AND receipt.receipt_identity = binding.terminal_receipt_identity
        JOIN public.rd_owner_outbox_v1 outbox
          ON outbox.aggregate_identity = binding.request_identity
         AND outbox.event_kind = 'SOURCE_INTAKE_TERMINATED_V1'
        LEFT JOIN public.rd_research_source_provenance_v1 provenance
          ON provenance.receipt_identity = receipt.receipt_identity
         AND provenance.content_digest = receipt.content_digest
        LEFT JOIN public.rd_source_candidates_v1 candidate
          ON candidate.provenance_identity = provenance.provenance_identity
        WHERE binding.request_identity = p_request_identity
          AND binding.state = 'TERMINAL'
          AND rd_owner_api.valid_source_intake_binding_contract_v1(binding.binding_json) IS TRUE
          AND binding.binding_json->>'request_identity' = binding.request_identity
          AND binding.binding_json->>'binding_identity' = binding.binding_identity
          AND binding.binding_json->>'admission' = 'ADMITTED'
          AND rd_owner_api.valid_source_intake_receipt_v1(
                receipt.receipt_json, receipt.receipt_identity, receipt.request_identity,
                binding.binding_identity, binding.invocation_identity, receipt.terminal,
                receipt.response_status, receipt.response_header_digest, receipt.content_digest,
                receipt.committed_at_epoch_ms
              ) IS TRUE
          AND (
            binding.invocation_identity IS NULL
            OR binding.invocation_identity = rd_owner_api.derive_source_intake_identity_v1(
              'rd.source-intake.openalex.invocation.v1', ARRAY[
                binding.request_identity, binding.binding_identity, binding.binding_commit_identity,
                binding.product_edge_started_receipt_identity,
                binding.product_edge_started_json->>'policy_decision_identity',
                binding.product_edge_started_json->>'policy_decision_digest',
                binding.product_edge_started_json#>>'{policy_time,head_digest}',
                binding.binding_json#>>'{authority,authority_class}',
                binding.binding_json#>>'{authority,environment_identity}',
                binding.binding_json#>>'{authority,provider_profile_digest}',
                COALESCE(binding.binding_json#>>'{authority,fixture_corpus_digest}', 'ABSENT')
              ]::text[])
          )
          AND receipt.receipt_identity = rd_owner_api.derive_source_intake_identity_v1(
            'rd.source-intake.receipt.v1', ARRAY[
              binding.request_identity, binding.binding_identity,
              COALESCE(binding.invocation_identity,
                rd_owner_api.derive_source_intake_identity_v1(
                  'rd.source-intake.pre-invocation.v1', ARRAY[
                    binding.request_identity, binding.binding_identity,
                    binding.binding_commit_identity, binding.product_edge_started_receipt_identity
                  ]::text[])),
              receipt.terminal, COALESCE(receipt.content_digest, 'ABSENT'),
              COALESCE(receipt.response_status::text, 'ABSENT'),
              COALESCE(receipt.response_header_digest, 'ABSENT'),
              COALESCE(receipt.receipt_json->>'connected_address', 'ABSENT'),
              COALESCE(receipt.receipt_json->>'response_media_type', 'ABSENT'),
              COALESCE(receipt.receipt_json->>'response_size_bytes', 'ABSENT'),
              receipt.receipt_json->>'policy_decision_identity',
              receipt.receipt_json->>'policy_decision_digest',
              receipt.receipt_json->>'retrieval_time_evidence_identity',
              receipt.receipt_json->>'retrieval_time_evidence_digest',
              receipt.receipt_json#>>'{retrieval_time,head_digest}',
              receipt.committed_at_epoch_ms::text
            ]::text[])
          AND receipt.receipt_json->>'terminal_evidence_digest' =
            rd_owner_api.derive_source_intake_identity_v1(
              'rd.source-intake.terminal-evidence.v1', ARRAY[
                binding.binding_identity,
                COALESCE(binding.invocation_identity,
                  rd_owner_api.derive_source_intake_identity_v1(
                    'rd.source-intake.pre-invocation.v1', ARRAY[
                      binding.request_identity, binding.binding_identity,
                      binding.binding_commit_identity, binding.product_edge_started_receipt_identity
                    ]::text[])),
                receipt.terminal, COALESCE(receipt.response_header_digest, 'ABSENT'),
                COALESCE(receipt.content_digest, 'ABSENT'),
                receipt.receipt_json->>'policy_decision_identity',
                receipt.receipt_json->>'policy_decision_digest',
                receipt.receipt_json->>'retrieval_time_evidence_identity',
                receipt.receipt_json->>'retrieval_time_evidence_digest',
                receipt.receipt_json#>>'{retrieval_time,head_digest}'
              ]::text[])
          AND receipt.receipt_json->>'terminal_evidence_identity' =
            rd_owner_api.derive_source_intake_identity_v1(
              'rd.source-intake.terminal-evidence-identity.v1',
              ARRAY[receipt.receipt_json->>'terminal_evidence_digest']::text[])
          AND (SELECT pg_catalog.count(*) FROM public.rd_source_intake_receipts_v1 singleton
               WHERE singleton.request_identity = binding.request_identity) = 1
          AND (SELECT pg_catalog.count(*) FROM public.rd_owner_outbox_v1 singleton
               WHERE singleton.aggregate_identity = binding.request_identity
                 AND singleton.event_kind = 'SOURCE_INTAKE_TERMINATED_V1') = 1
          AND outbox.event_identity = rd_owner_api.derive_source_intake_identity_v1(
                'rd.owner-outbox.source-intake-terminated.v1',
                ARRAY[binding.request_identity, receipt.receipt_identity]::text[])
          AND outbox.payload_digest = rd_owner_api.derive_source_intake_identity_v1(
                'rd.owner-outbox.payload.v1', ARRAY[binding.request_identity,
                  receipt.receipt_identity, COALESCE(provenance.provenance_identity, 'ABSENT'),
                  COALESCE(candidate.candidate_identity, 'ABSENT')]::text[])
          AND outbox.payload_json = pg_catalog.jsonb_build_object(
            'event_identity', outbox.event_identity,
            'aggregate_identity', outbox.aggregate_identity,
            'event_kind', outbox.event_kind,
            'payload_digest', outbox.payload_digest
          )
          AND outbox.committed_at_epoch_ms = receipt.committed_at_epoch_ms
          AND (
            (receipt.terminal = 'RETRIEVED'
             AND receipt.content_digest IS NOT NULL
             AND provenance.provenance_identity IS NOT NULL
             AND candidate.candidate_identity IS NOT NULL
             AND provenance.provenance_identity = rd_owner_api.derive_source_intake_identity_v1(
               'rd.research-source-provenance.v1', ARRAY[
                 binding.binding_json->>'normalized_doi', receipt.content_digest,
                 receipt.receipt_identity, receipt.receipt_json#>>'{retrieval_time,head_digest}',
                 rd_owner_api.derive_source_intake_identity_v1(
                   'rd.source-interpretation.v1', ARRAY[
                     rd_owner_api.derive_source_intake_identity_v1(
                       'rd.source-intake.interpretation.v1', ARRAY[
                         binding.product_edge_started_json#>>'{interpretation,bounded_explanation}',
                         (SELECT pg_catalog.string_agg(value, pg_catalog.chr(30) ORDER BY ordinality)
                            FROM pg_catalog.jsonb_array_elements_text(binding.product_edge_started_json#>'{interpretation,plausible_alternatives}')
                                 WITH ORDINALITY AS alternative(value, ordinality)),
                         binding.product_edge_started_json#>>'{interpretation,differentiating_prediction}',
                         binding.product_edge_started_json#>>'{interpretation,falsifier}'
                       ]::text[])
                   ]::text[]),
                 rd_owner_api.derive_source_intake_identity_v1(
                   'rd.source-intake.interpretation.v1', ARRAY[
                     binding.product_edge_started_json#>>'{interpretation,bounded_explanation}',
                     (SELECT pg_catalog.string_agg(value, pg_catalog.chr(30) ORDER BY ordinality)
                        FROM pg_catalog.jsonb_array_elements_text(binding.product_edge_started_json#>'{interpretation,plausible_alternatives}')
                             WITH ORDINALITY AS alternative(value, ordinality)),
                     binding.product_edge_started_json#>>'{interpretation,differentiating_prediction}',
                     binding.product_edge_started_json#>>'{interpretation,falsifier}'
                   ]::text[])
               ]::text[])
             AND provenance.provenance_json = pg_catalog.jsonb_build_object(
               'schema_version', 1,
               'provenance_identity', provenance.provenance_identity,
               'predecessor_provenance_identity', NULL,
               'canonical_source_identity', 'doi:' || (binding.binding_json->>'normalized_doi'),
               'canonical_source_origin', binding.binding_json->>'https_origin',
               'source_class', 'ACADEMIC_IDENTITY_AND_CITATION_GRAPH',
               'author_or_originating_system', 'OPENALEX',
               'publication_time_epoch_ms', NULL,
               'revision_identity', NULL,
               'linked_reference_identities', pg_catalog.jsonb_build_array(),
               'content_digest', receipt.content_digest,
               'raw_content_digest', receipt.content_digest,
               'connector_identity', binding.binding_json->>'connector_identity',
               'connector_version', binding.binding_json->>'connector_version',
               'acquisition_receipt_identity', receipt.receipt_identity,
               'retrieval_time', receipt.receipt_json->'retrieval_time',
               'valid_through_epoch_ms', (receipt.receipt_json#>>'{retrieval_time,valid_through_epoch_ms}')::bigint,
               'rights_basis_identity', binding.binding_json->>'rights_basis_identity',
               'rights_policy_version', binding.binding_json->>'rights_policy_version',
               'license_basis', binding.binding_json->>'rights_basis_identity',
               'attribution_basis', 'OPENALEX_METADATA_ATTRIBUTION',
               'acquisition_scope', binding.binding_json->>'acquisition_scope',
               'retention_policy_identity', binding.binding_json->>'retention_policy_identity',
               'retention_policy_version', binding.binding_json->>'retention_policy_version',
               'retention_scope', binding.binding_json->>'retention_scope',
               'location_rights', rd_owner_api.derive_openalex_location_rights_v1(
                 pg_catalog.convert_from((SELECT raw_value.raw_payload
                   FROM public.rd_source_raw_payloads_v1 raw_value
                   WHERE raw_value.content_digest = receipt.content_digest), 'UTF8')::jsonb,
                 binding.binding_json->>'normalized_doi'),
               'bounded_interpretation_identity', rd_owner_api.derive_source_intake_identity_v1(
                 'rd.source-interpretation.v1', ARRAY[
                   rd_owner_api.derive_source_intake_identity_v1(
                     'rd.source-intake.interpretation.v1', ARRAY[
                       binding.product_edge_started_json#>>'{interpretation,bounded_explanation}',
                       (SELECT pg_catalog.string_agg(value, pg_catalog.chr(30) ORDER BY ordinality)
                          FROM pg_catalog.jsonb_array_elements_text(binding.product_edge_started_json#>'{interpretation,plausible_alternatives}')
                               WITH ORDINALITY AS alternative(value, ordinality)),
                       binding.product_edge_started_json#>>'{interpretation,differentiating_prediction}',
                       binding.product_edge_started_json#>>'{interpretation,falsifier}'
                     ]::text[])
                 ]::text[]),
               'bounded_interpretation_digest', rd_owner_api.derive_source_intake_identity_v1(
                 'rd.source-intake.interpretation.v1', ARRAY[
                   binding.product_edge_started_json#>>'{interpretation,bounded_explanation}',
                   (SELECT pg_catalog.string_agg(value, pg_catalog.chr(30) ORDER BY ordinality)
                      FROM pg_catalog.jsonb_array_elements_text(binding.product_edge_started_json#>'{interpretation,plausible_alternatives}')
                           WITH ORDINALITY AS alternative(value, ordinality)),
                   binding.product_edge_started_json#>>'{interpretation,differentiating_prediction}',
                   binding.product_edge_started_json#>>'{interpretation,falsifier}'
                 ]::text[]),
               'interpretation', binding.product_edge_started_json->'interpretation',
               'interpretation_status', 'BOUNDED_RESEARCH_INTERPRETATION',
               'trust_class', 'UNTRUSTED_EXTERNAL_DATA'
             )
             AND candidate.candidate_identity = rd_owner_api.derive_source_intake_identity_v1(
               'rd.source-candidate.v1', ARRAY[
                 provenance.provenance_identity,
                 rd_owner_api.derive_source_intake_identity_v1(
                   'rd.source-intake.interpretation.v1', ARRAY[
                     binding.product_edge_started_json#>>'{interpretation,bounded_explanation}',
                     (SELECT pg_catalog.string_agg(value, pg_catalog.chr(30) ORDER BY ordinality)
                        FROM pg_catalog.jsonb_array_elements_text(binding.product_edge_started_json#>'{interpretation,plausible_alternatives}')
                             WITH ORDINALITY AS alternative(value, ordinality)),
                     binding.product_edge_started_json#>>'{interpretation,differentiating_prediction}',
                     binding.product_edge_started_json#>>'{interpretation,falsifier}'
                   ]::text[])
               ]::text[])
             AND candidate.candidate_json = pg_catalog.jsonb_build_object(
               'candidate_identity', candidate.candidate_identity,
               'provenance_identity', provenance.provenance_identity,
               'interpretation_digest', rd_owner_api.derive_source_intake_identity_v1(
                 'rd.source-intake.interpretation.v1', ARRAY[
                   binding.product_edge_started_json#>>'{interpretation,bounded_explanation}',
                   (SELECT pg_catalog.string_agg(value, pg_catalog.chr(30) ORDER BY ordinality)
                      FROM pg_catalog.jsonb_array_elements_text(binding.product_edge_started_json#>'{interpretation,plausible_alternatives}')
                           WITH ORDINALITY AS alternative(value, ordinality)),
                   binding.product_edge_started_json#>>'{interpretation,differentiating_prediction}',
                   binding.product_edge_started_json#>>'{interpretation,falsifier}'
                 ]::text[]),
               'trust_class', 'UNTRUSTED_EXTERNAL_DATA'
             ))
             AND EXISTS (
               SELECT 1 FROM public.rd_source_raw_payloads_v1 raw
               JOIN public.rd_source_raw_receipt_links_v1 raw_link
                 ON raw_link.receipt_identity = receipt.receipt_identity
                AND raw_link.terminal = 'RETRIEVED'
                AND raw_link.content_digest = raw.content_digest
               WHERE raw.content_digest = receipt.content_digest
                 AND raw.content_digest = 'sha256:' || pg_catalog.encode(pg_catalog.sha256(raw.raw_payload), 'hex')
             )
            OR
            (receipt.terminal <> 'RETRIEVED'
             AND receipt.content_digest IS NULL
             AND provenance.provenance_identity IS NULL
             AND candidate.candidate_identity IS NULL)
          )
      $function$;
ALTER FUNCTION rd_owner_api.canonical_source_intake_custody_v1(text) OWNER TO rd_owner;
REVOKE ALL ON FUNCTION rd_owner_api.canonical_source_intake_custody_v1(text) FROM PUBLIC, product_edge_owner, operator_authorization_writer, qualification_owner, qualification_writer;
CREATE OR REPLACE FUNCTION rd_owner_api.read_source_intake_v1(p_request_identity text)
      RETURNS jsonb LANGUAGE sql STRICT STABLE PARALLEL SAFE SECURITY DEFINER
      SET search_path = pg_catalog, rd_owner_api, pg_temp
      AS $function$
        SELECT rd_owner_api.canonical_source_intake_custody_v1(p_request_identity)
      $function$;
ALTER FUNCTION rd_owner_api.read_source_intake_v1(text) OWNER TO rd_owner;
REVOKE ALL ON FUNCTION rd_owner_api.read_source_intake_v1(text) FROM PUBLIC, product_edge_owner, operator_authorization_writer, qualification_owner, qualification_writer;
CREATE OR REPLACE FUNCTION rd_owner_api.peek_source_intake_research_handoff_v1(
        p_request_identity text, p_attempt_identity text, p_terminal_receipt_identity text
      ) RETURNS jsonb LANGUAGE sql STRICT STABLE PARALLEL SAFE SECURITY DEFINER
      SET search_path = pg_catalog, public, rd_owner_api, pg_temp
      AS $function$
        WITH canonical AS (
          SELECT rd_owner_api.canonical_source_intake_custody_v1(p_request_identity) AS readback
        )
        SELECT pg_catalog.jsonb_build_object(
          'request_identity', binding.request_identity,
          'attempt_identity', binding.binding_identity,
          'terminal_receipt_identity', receipt.receipt_identity,
          'binding', binding.binding_json,
          'receipt', receipt.receipt_json,
          'provenance', provenance.provenance_json,
          'candidate', candidate.candidate_json,
          'transition', outbox.payload_json
        )
        FROM canonical
        JOIN public.rd_source_intake_bindings_v1 binding
          ON binding.request_identity = canonical.readback->>'request_identity'
         AND binding.binding_identity = canonical.readback->>'binding_identity'
        JOIN public.rd_source_intake_receipts_v1 receipt
          ON receipt.request_identity = binding.request_identity
         AND receipt.receipt_identity = canonical.readback#>>'{receipt,receipt_identity}'
        JOIN public.rd_source_raw_receipt_links_v1 raw_link
          ON raw_link.receipt_identity = receipt.receipt_identity
         AND raw_link.terminal = 'RETRIEVED'
         AND raw_link.content_digest = canonical.readback->>'content_digest'
        JOIN public.rd_source_raw_payloads_v1 raw
          ON raw.content_digest = raw_link.content_digest
        JOIN public.rd_research_source_provenance_v1 provenance
          ON provenance.receipt_identity = receipt.receipt_identity
         AND provenance.content_digest = raw.content_digest
         AND provenance.provenance_identity = canonical.readback->>'provenance_identity'
        JOIN public.rd_source_candidates_v1 candidate
          ON candidate.provenance_identity = provenance.provenance_identity
         AND candidate.candidate_identity = canonical.readback->>'source_candidate_identity'
        JOIN public.rd_owner_outbox_v1 outbox
          ON outbox.aggregate_identity = binding.request_identity
         AND outbox.event_kind = 'SOURCE_INTAKE_TERMINATED_V1'
         AND outbox.event_identity = canonical.readback->>'outbox_event_identity'
        WHERE canonical.readback->>'terminal' = 'RETRIEVED'
          AND binding.request_identity = p_request_identity
          AND binding.binding_identity = p_attempt_identity
          AND receipt.receipt_identity = p_terminal_receipt_identity
          AND raw.content_digest = 'sha256:' || pg_catalog.encode(pg_catalog.sha256(raw.raw_payload), 'hex')
      $function$;
ALTER FUNCTION rd_owner_api.peek_source_intake_research_handoff_v1(text,text,text) OWNER TO rd_owner;
REVOKE ALL ON FUNCTION rd_owner_api.peek_source_intake_research_handoff_v1(text,text,text) FROM PUBLIC, product_edge_owner, operator_authorization_writer, qualification_owner, qualification_writer;
CREATE OR REPLACE FUNCTION rd_owner_api.lock_source_intake_research_handoff_v1(
        p_request_identity text, p_attempt_identity text, p_terminal_receipt_identity text
      ) RETURNS jsonb LANGUAGE plpgsql STRICT VOLATILE PARALLEL UNSAFE SECURITY DEFINER
      SET search_path = pg_catalog, public, rd_owner_api, pg_temp
      AS $function$
      DECLARE locked_count bigint; sealed jsonb;
      BEGIN
        IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN RETURN NULL; END IF;
        SELECT pg_catalog.count(*) INTO locked_count FROM (
          SELECT 1
          FROM public.rd_source_intake_bindings_v1 binding
          JOIN public.rd_source_intake_receipts_v1 receipt
            ON receipt.request_identity = binding.request_identity
           AND receipt.receipt_identity = binding.terminal_receipt_identity
          JOIN public.rd_source_raw_receipt_links_v1 raw_link
            ON raw_link.receipt_identity = receipt.receipt_identity
           AND raw_link.terminal = 'RETRIEVED'
           AND raw_link.content_digest = receipt.content_digest
          JOIN public.rd_source_raw_payloads_v1 raw
            ON raw.content_digest = raw_link.content_digest
          JOIN public.rd_research_source_provenance_v1 provenance
            ON provenance.receipt_identity = receipt.receipt_identity
           AND provenance.content_digest = raw.content_digest
          JOIN public.rd_source_candidates_v1 candidate
            ON candidate.provenance_identity = provenance.provenance_identity
          JOIN public.rd_owner_outbox_v1 outbox
            ON outbox.aggregate_identity = binding.request_identity
           AND outbox.event_kind = 'SOURCE_INTAKE_TERMINATED_V1'
          WHERE binding.request_identity = p_request_identity
            AND binding.binding_identity = p_attempt_identity
            AND receipt.receipt_identity = p_terminal_receipt_identity
          FOR SHARE OF binding, receipt, raw_link, raw, provenance, candidate, outbox
        ) locked;
        IF locked_count <> 1 THEN RETURN NULL; END IF;
        SELECT rd_owner_api.peek_source_intake_research_handoff_v1(
          p_request_identity, p_attempt_identity, p_terminal_receipt_identity
        ) INTO sealed;
        RETURN sealed;
      END
      $function$;
ALTER FUNCTION rd_owner_api.lock_source_intake_research_handoff_v1(text,text,text) OWNER TO rd_owner;
REVOKE ALL ON FUNCTION rd_owner_api.lock_source_intake_research_handoff_v1(text,text,text) FROM PUBLIC, product_edge_owner, operator_authorization_writer, qualification_owner, qualification_writer;
REVOKE ALL ON public.rd_source_raw_payloads_v1, public.rd_source_raw_receipt_links_v1 FROM product_edge_owner;
CREATE TABLE public.rd_legacy_prepared_attempt_drain_receipts_v1 (
  receipt_identity text PRIMARY KEY,
  receipt_digest text NOT NULL,
  build_request_identity text NOT NULL UNIQUE,
  attempt_identity text NOT NULL UNIQUE,
  receipt_json jsonb NOT NULL,
  committed_at_epoch_ms bigint NOT NULL
);
CREATE OR REPLACE FUNCTION public.rd_owner_reject_legacy_prepared_attempt_drain_mutation_v1()
RETURNS trigger LANGUAGE plpgsql
AS 'BEGIN RAISE EXCEPTION ''legacy PREPARED drain receipts are immutable''; END';
ALTER FUNCTION public.rd_owner_reject_legacy_prepared_attempt_drain_mutation_v1() OWNER TO rd_owner;
REVOKE ALL ON FUNCTION public.rd_owner_reject_legacy_prepared_attempt_drain_mutation_v1() FROM PUBLIC;
CREATE TRIGGER rd_legacy_prepared_attempt_drain_immutable_v1
BEFORE UPDATE OR DELETE ON public.rd_legacy_prepared_attempt_drain_receipts_v1
FOR EACH ROW EXECUTE FUNCTION public.rd_owner_reject_legacy_prepared_attempt_drain_mutation_v1();
ALTER TABLE public.rd_legacy_prepared_attempt_drain_receipts_v1 OWNER TO rd_owner;
REVOKE ALL ON TABLE public.rd_legacy_prepared_attempt_drain_receipts_v1
FROM PUBLIC, product_edge_owner, operator_authorization_owner, operator_authorization_writer,
     qualification_owner, qualification_writer, backtest_owner;
GRANT SELECT, INSERT ON TABLE public.rd_legacy_prepared_attempt_drain_receipts_v1 TO rd_owner;
\endif
DO $runtime_custody_cutover$
DECLARE object record; relation_seal text; exact boolean;
BEGIN
  IF EXISTS (
    WITH admitted(name) AS (SELECT * FROM pg_catalog.unnest(ARRAY[
      'rd_research_request_receipts_v1','rd_independence_bases_v1','rd_independence_basis_admissions_v1','rd_independence_basis_heads_v1','rd_trial_families_v1','rd_trial_family_members_v1','rd_trial_family_heads_v1','rd_trial_family_attempt_cuts_v2','rd_artifact_trial_family_bindings_v1','rd_owner_outbox_v1','rd_sealed_exploratory_replay_requests_v1','rd_complex_strategy_develop_evaluations_v1','rd_complex_strategy_develop_evaluation_heads_v1','rd_artifact_build_attempts_v1','rd_strategy_artifacts_v1',
      'rd_source_intake_bindings_v1','rd_source_intake_receipts_v1','rd_source_raw_payloads_v1','rd_source_raw_receipt_links_v1','rd_research_source_provenance_v1','rd_source_candidates_v1','rd_legacy_prepared_attempt_drain_receipts_v1',
      'product_edge_operation_manifests_v1','product_edge_deployment_bindings_v1','product_edge_deployment_supersessions_v1','product_edge_binding_manifests_v1','product_edge_deployment_heads_v1','product_edge_request_admissions_v1','product_edge_effect_invocation_admissions_v1','product_edge_effect_invocation_claims_v1','product_edge_effect_invocation_states_v1','product_edge_owner_outbox_v1','product_edge_admission_event_stream_v1','product_edge_admission_events_v1','product_edge_expired_manifest_recoveries_v1'
    ]::text[]))
    SELECT 1 FROM pg_catalog.pg_class relation JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace
    WHERE namespace.nspname='public' AND relation.relkind IN ('r','p') AND (relation.relname LIKE 'rd\_%' ESCAPE '\' OR relation.relname LIKE 'product\_edge\_%' ESCAPE '\') AND relation.relname NOT IN (SELECT name FROM admitted)
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_class relation JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace
    WHERE namespace.nspname='public' AND relation.relkind IN ('r','p') AND (relation.relname LIKE 'rd\_%' ESCAPE '\' OR relation.relname LIKE 'product\_edge\_%' ESCAPE '\')
      AND (relation.relrowsecurity OR relation.relforcerowsecurity OR EXISTS (SELECT 1 FROM pg_catalog.pg_policy policy_fact WHERE policy_fact.polrelid=relation.oid) OR EXISTS (SELECT 1 FROM pg_catalog.pg_rewrite rewrite_fact WHERE rewrite_fact.ev_class=relation.oid))
  ) THEN RAISE EXCEPTION 'R&D/Product Edge closed relation manifest mismatch'; END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class relation
    JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace
    WHERE namespace.nspname='public' AND relation.relkind IN ('r','p')
      AND (relation.relname LIKE 'rd\_%' ESCAPE '\' OR relation.relname LIKE 'product\_edge\_%' ESCAPE '\')
      AND pg_catalog.obj_description(relation.oid,'pg_class') LIKE 'vibe-closed-relation-v2:%'
      AND pg_catalog.obj_description(relation.oid,'pg_class') <> 'vibe-closed-relation-v2:'||pg_catalog.md5(pg_catalog.jsonb_build_object(
        'columns',(SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(attribute.attnum,attribute.attname,attribute.atttypid::text,attribute.atttypmod,attribute.attnotnull,attribute.attidentity,attribute.attgenerated,pg_catalog.pg_get_expr(default_fact.adbin,default_fact.adrelid)) ORDER BY attribute.attnum) FROM pg_catalog.pg_attribute attribute LEFT JOIN pg_catalog.pg_attrdef default_fact ON default_fact.adrelid=attribute.attrelid AND default_fact.adnum=attribute.attnum WHERE attribute.attrelid=relation.oid AND attribute.attnum>0 AND NOT attribute.attisdropped),
        'constraints',(SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.pg_get_constraintdef(constraint_fact.oid,true) ORDER BY pg_catalog.pg_get_constraintdef(constraint_fact.oid,true)),'[]'::jsonb) FROM pg_catalog.pg_constraint constraint_fact WHERE constraint_fact.conrelid=relation.oid),
        'acl',COALESCE(relation.relacl::text,'<NULL>')
      )::text)
  ) THEN RAISE EXCEPTION 'sealed relation schema or ACL drift'; END IF;

  WITH expected(signature,is_strict,is_security_definer,volatility,parallel_mode,configuration,source_md5) AS (VALUES
    ('rd_owner_api.derive_source_intake_identity_v1(text,text[])',true,false,'i','s',ARRAY['search_path=pg_catalog, pg_temp']::text[],'a31c928f1c821659c9bb9cb1f0dd9733'),
    ('rd_owner_api.canonical_source_intake_json_v1(jsonb)',true,false,'i','s',ARRAY['search_path=pg_catalog']::text[],'7e121eff781358fb34b3eb1b4f3a3fba'),
    ('rd_owner_api.derive_openalex_location_rights_v1(jsonb,text)',true,false,'i','s',ARRAY['search_path=pg_catalog, pg_temp']::text[],'72c39824378f217ccdc175193abc8712'),
    ('rd_owner_api.derive_source_acquisition_binding_digest_v1(jsonb)',true,false,'i','s',ARRAY['search_path=pg_catalog']::text[],'6baf8724270241782bb0857f2c42fb70'),
    ('rd_owner_api.derive_source_acquisition_binding_identity_v1(jsonb)',true,false,'i','s',ARRAY['search_path=pg_catalog']::text[],'2bcfa1235376adf3e3b28961ea4c3dbc'),
    ('rd_owner_api.lock_source_acquisition_binding_v1(text,text)',true,true,'v','u',ARRAY['search_path=pg_catalog']::text[],'2549b3888d45e13c7a29f726ae0609ea'),
    ('rd_owner_api.lock_source_invocation_reservation_v1(text,text,text,text,text)',true,true,'v','u',ARRAY['search_path=pg_catalog']::text[],'d7b3b51e2c41badfd1d7182d0f76845c'),
    ('rd_owner_api.valid_source_intake_started_custody_v1(text,text,text,jsonb)',false,false,'i','s',ARRAY['search_path=pg_catalog, pg_temp']::text[],'02a5b7abd00a313f33be896cc3cc6285'),
    ('rd_owner_api.guard_source_intake_binding_v1()',false,true,'v','u',ARRAY['search_path=pg_catalog, public, pg_temp']::text[],'aac9e3de9d005d89c2e99279314d3e2b'),
    ('rd_owner_api.reject_source_intake_terminal_mutation_v1()',false,true,'v','u',ARRAY['search_path=pg_catalog, pg_temp']::text[],'8879590a6d496c443091d0ee16857ab5'),
    ('rd_owner_api.read_source_intake_v1(text)',true,true,'s','s',ARRAY['search_path=pg_catalog, rd_owner_api, pg_temp']::text[],'6c2c8228eb2c1095667ced1401f6933b'),
    ('rd_owner_api.valid_source_intake_binding_contract_v1(jsonb)',true,false,'i','s',ARRAY['search_path=pg_catalog, pg_temp']::text[],'8b71a854ce984aa594f7f32ea3bcfc20'),
    ('rd_owner_api.valid_source_intake_receipt_v1(jsonb,text,text,text,text,text,smallint,text,text,bigint)',false,false,'i','s',ARRAY['search_path=pg_catalog, pg_temp']::text[],'8e226642cdbe2c88f762139e1b129e8f'),
    ('rd_owner_api.canonical_source_intake_custody_v1(text)',true,true,'s','s',ARRAY['search_path=pg_catalog, public, pg_temp']::text[],'2983efb78efd5ba30682ea80e64fd038'),
    ('rd_owner_api.peek_source_intake_research_handoff_v1(text,text,text)',true,true,'s','s',ARRAY['search_path=pg_catalog, public, rd_owner_api, pg_temp']::text[],'836e62db658d409dcd3ad1fd84b5a261'),
    ('rd_owner_api.lock_source_intake_research_handoff_v1(text,text,text)',true,true,'v','u',ARRAY['search_path=pg_catalog, public, rd_owner_api, pg_temp']::text[],'890e336826ddcdf96d948b012c5ba32d'),
    ('public.rd_owner_reject_legacy_prepared_attempt_drain_mutation_v1()',false,false,'v','u',NULL::text[],'7e54a7158586a88841c26e8732a31e62')
  ), actual AS (
    SELECT expected.signature,routine.proisstrict,routine.prosecdef,routine.provolatile::text,
           routine.proparallel::text,routine.proconfig,pg_catalog.md5(routine.prosrc)
    FROM expected LEFT JOIN pg_catalog.pg_proc routine ON routine.oid=pg_catalog.to_regprocedure(expected.signature)
  )
  SELECT NOT EXISTS((SELECT * FROM expected EXCEPT SELECT * FROM actual) UNION ALL (SELECT * FROM actual EXCEPT SELECT * FROM expected)) INTO exact;
  IF exact IS DISTINCT FROM true OR EXISTS (
    WITH expected(signature) AS (VALUES
      ('rd_owner_api.derive_source_intake_identity_v1(text,text[])'),('rd_owner_api.canonical_source_intake_json_v1(jsonb)'),('rd_owner_api.derive_openalex_location_rights_v1(jsonb,text)'),('rd_owner_api.derive_source_acquisition_binding_digest_v1(jsonb)'),('rd_owner_api.derive_source_acquisition_binding_identity_v1(jsonb)'),('rd_owner_api.lock_source_acquisition_binding_v1(text,text)'),('rd_owner_api.lock_source_invocation_reservation_v1(text,text,text,text,text)'),('rd_owner_api.valid_source_intake_started_custody_v1(text,text,text,jsonb)'),('rd_owner_api.guard_source_intake_binding_v1()'),('rd_owner_api.reject_source_intake_terminal_mutation_v1()'),('rd_owner_api.read_source_intake_v1(text)'),('rd_owner_api.valid_source_intake_binding_contract_v1(jsonb)'),('rd_owner_api.valid_source_intake_receipt_v1(jsonb,text,text,text,text,text,smallint,text,text,bigint)'),('rd_owner_api.canonical_source_intake_custody_v1(text)'),('rd_owner_api.peek_source_intake_research_handoff_v1(text,text,text)'),('rd_owner_api.lock_source_intake_research_handoff_v1(text,text,text)'),('public.rd_owner_reject_legacy_prepared_attempt_drain_mutation_v1()')
    )
    SELECT 1 FROM pg_catalog.pg_proc routine
    WHERE routine.proname IN ('derive_source_intake_identity_v1','canonical_source_intake_json_v1','derive_openalex_location_rights_v1','derive_source_acquisition_binding_digest_v1','derive_source_acquisition_binding_identity_v1','lock_source_acquisition_binding_v1','lock_source_invocation_reservation_v1','valid_source_intake_started_custody_v1','guard_source_intake_binding_v1','reject_source_intake_terminal_mutation_v1','read_source_intake_v1','valid_source_intake_binding_contract_v1','valid_source_intake_receipt_v1','canonical_source_intake_custody_v1','peek_source_intake_research_handoff_v1','lock_source_intake_research_handoff_v1','rd_owner_reject_legacy_prepared_attempt_drain_mutation_v1')
      AND routine.oid NOT IN (SELECT pg_catalog.to_regprocedure(signature) FROM expected)
  ) THEN RAISE EXCEPTION 'Source Intake/legacy drain routine manifest mismatch'; END IF;

  WITH expected(trigger_name,relation_name,routine_signature,trigger_type,definition) AS (VALUES
    ('rd_source_intake_binding_guard_v1','rd_source_intake_bindings_v1','rd_owner_api.guard_source_intake_binding_v1()',19::smallint,'CREATE TRIGGER rd_source_intake_binding_guard_v1 BEFORE UPDATE ON rd_source_intake_bindings_v1 FOR EACH ROW EXECUTE FUNCTION rd_owner_api.guard_source_intake_binding_v1()'),
    ('rd_source_intake_receipt_immutable_v1','rd_source_intake_receipts_v1','rd_owner_api.reject_source_intake_terminal_mutation_v1()',58::smallint,'CREATE TRIGGER rd_source_intake_receipt_immutable_v1 BEFORE DELETE OR UPDATE OR TRUNCATE ON rd_source_intake_receipts_v1 FOR EACH STATEMENT EXECUTE FUNCTION rd_owner_api.reject_source_intake_terminal_mutation_v1()'),
    ('rd_source_raw_payload_immutable_v1','rd_source_raw_payloads_v1','rd_owner_api.reject_source_intake_terminal_mutation_v1()',58::smallint,'CREATE TRIGGER rd_source_raw_payload_immutable_v1 BEFORE DELETE OR UPDATE OR TRUNCATE ON rd_source_raw_payloads_v1 FOR EACH STATEMENT EXECUTE FUNCTION rd_owner_api.reject_source_intake_terminal_mutation_v1()'),
    ('rd_source_raw_receipt_link_immutable_v1','rd_source_raw_receipt_links_v1','rd_owner_api.reject_source_intake_terminal_mutation_v1()',58::smallint,'CREATE TRIGGER rd_source_raw_receipt_link_immutable_v1 BEFORE DELETE OR UPDATE OR TRUNCATE ON rd_source_raw_receipt_links_v1 FOR EACH STATEMENT EXECUTE FUNCTION rd_owner_api.reject_source_intake_terminal_mutation_v1()'),
    ('rd_research_source_provenance_immutable_v1','rd_research_source_provenance_v1','rd_owner_api.reject_source_intake_terminal_mutation_v1()',58::smallint,'CREATE TRIGGER rd_research_source_provenance_immutable_v1 BEFORE DELETE OR UPDATE OR TRUNCATE ON rd_research_source_provenance_v1 FOR EACH STATEMENT EXECUTE FUNCTION rd_owner_api.reject_source_intake_terminal_mutation_v1()'),
    ('rd_source_candidate_immutable_v1','rd_source_candidates_v1','rd_owner_api.reject_source_intake_terminal_mutation_v1()',58::smallint,'CREATE TRIGGER rd_source_candidate_immutable_v1 BEFORE DELETE OR UPDATE OR TRUNCATE ON rd_source_candidates_v1 FOR EACH STATEMENT EXECUTE FUNCTION rd_owner_api.reject_source_intake_terminal_mutation_v1()'),
    ('rd_legacy_prepared_attempt_drain_immutable_v1','rd_legacy_prepared_attempt_drain_receipts_v1','public.rd_owner_reject_legacy_prepared_attempt_drain_mutation_v1()',27::smallint,'CREATE TRIGGER rd_legacy_prepared_attempt_drain_immutable_v1 BEFORE DELETE OR UPDATE ON rd_legacy_prepared_attempt_drain_receipts_v1 FOR EACH ROW EXECUTE FUNCTION rd_owner_reject_legacy_prepared_attempt_drain_mutation_v1()'),
    ('product_edge_admission_event_immutable_v1','product_edge_owner_outbox_v1','public.product_edge_reject_admission_event_mutation_v1()',27::smallint,'CREATE TRIGGER product_edge_admission_event_immutable_v1 BEFORE DELETE OR UPDATE ON product_edge_owner_outbox_v1 FOR EACH ROW EXECUTE FUNCTION product_edge_reject_admission_event_mutation_v1()'),
    ('product_edge_admission_assignment_immutable_v1','product_edge_admission_events_v1','public.product_edge_reject_admission_assignment_mutation_v1()',27::smallint,'CREATE TRIGGER product_edge_admission_assignment_immutable_v1 BEFORE DELETE OR UPDATE ON product_edge_admission_events_v1 FOR EACH ROW EXECUTE FUNCTION product_edge_reject_admission_assignment_mutation_v1()')
  ), actual AS (
    SELECT trigger_fact.tgname,relation.relname,pg_catalog.format('%I.%I(%s)',routine_namespace.nspname,routine.proname,pg_catalog.replace(pg_catalog.pg_get_function_identity_arguments(routine.oid),', ',',')),trigger_fact.tgtype,pg_catalog.pg_get_triggerdef(trigger_fact.oid,true)
    FROM pg_catalog.pg_trigger trigger_fact JOIN pg_catalog.pg_class relation ON relation.oid=trigger_fact.tgrelid JOIN pg_catalog.pg_proc routine ON routine.oid=trigger_fact.tgfoid JOIN pg_catalog.pg_namespace routine_namespace ON routine_namespace.oid=routine.pronamespace
    WHERE NOT trigger_fact.tgisinternal AND (trigger_fact.tgname IN (SELECT trigger_name FROM expected) OR trigger_fact.tgfoid IN (SELECT pg_catalog.to_regprocedure(routine_signature) FROM expected))
      AND trigger_fact.tgenabled='O' AND trigger_fact.tgnargs=0 AND trigger_fact.tgargs=''::bytea AND trigger_fact.tgqual IS NULL
      AND EXISTS (SELECT 1 FROM pg_catalog.pg_depend dependency WHERE dependency.classid='pg_catalog.pg_trigger'::pg_catalog.regclass AND dependency.objid=trigger_fact.oid AND dependency.refclassid='pg_catalog.pg_proc'::pg_catalog.regclass AND dependency.refobjid=trigger_fact.tgfoid AND dependency.deptype='n')
  )
  SELECT NOT EXISTS((SELECT * FROM expected EXCEPT SELECT * FROM actual) UNION ALL (SELECT * FROM actual EXCEPT SELECT * FROM expected)) INTO exact;
  IF exact IS DISTINCT FROM true THEN RAISE EXCEPTION 'R&D/Product Edge trigger dependency manifest mismatch'; END IF;

  IF (SELECT count(*)=2 AND bool_and(routine.prorettype=pg_catalog.to_regtype('trigger') AND routine.prolang=(SELECT oid FROM pg_catalog.pg_language WHERE lanname='plpgsql') AND routine.pronargs=0 AND NOT routine.proisstrict AND NOT routine.prosecdef AND routine.provolatile='v' AND routine.proparallel='u' AND routine.proconfig IS NULL AND pg_catalog.md5(routine.prosrc)=CASE routine.proname WHEN 'product_edge_reject_admission_event_mutation_v1' THEN '014d48cfd5b330c37330996eef7e211e' ELSE '143548e90171aa95dc9ae403d7ca6ee1' END) FROM pg_catalog.pg_proc routine WHERE routine.oid IN (pg_catalog.to_regprocedure('public.product_edge_reject_admission_event_mutation_v1()'),pg_catalog.to_regprocedure('public.product_edge_reject_admission_assignment_mutation_v1()'))) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Product Edge trigger routine manifest mismatch';
  END IF;

  FOR object IN
    SELECT relation.oid,namespace.nspname AS schema_name,relation.relname FROM pg_catalog.pg_class relation JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace
    WHERE namespace.nspname='public' AND relation.relkind IN ('r','p') AND relation.relname LIKE 'rd\_%' ESCAPE '\'
  LOOP
    EXECUTE pg_catalog.format('ALTER TABLE %I.%I OWNER TO rd_custodian',object.schema_name,object.relname);
    EXECUTE pg_catalog.format('REVOKE ALL ON TABLE %I.%I FROM PUBLIC, rd_owner, product_edge_owner, operator_authorization_owner, operator_authorization_writer, qualification_owner, qualification_writer, backtest_owner, portfolio_owner',object.schema_name,object.relname);
    IF object.relname='rd_source_intake_bindings_v1' THEN
      EXECUTE pg_catalog.format('GRANT SELECT, INSERT, UPDATE ON TABLE %I.%I TO rd_owner',object.schema_name,object.relname);
    ELSIF object.relname IN ('rd_source_intake_receipts_v1','rd_source_raw_payloads_v1','rd_source_raw_receipt_links_v1','rd_research_source_provenance_v1','rd_source_candidates_v1') THEN
      EXECUTE pg_catalog.format('GRANT SELECT, INSERT, UPDATE, REFERENCES ON TABLE %I.%I TO rd_owner',object.schema_name,object.relname);
    ELSIF object.relname='rd_legacy_prepared_attempt_drain_receipts_v1' THEN
      EXECUTE pg_catalog.format('GRANT SELECT, INSERT ON TABLE %I.%I TO rd_owner',object.schema_name,object.relname);
    ELSE
      EXECUTE pg_catalog.format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %I.%I TO rd_owner',object.schema_name,object.relname);
    END IF;
    SELECT 'vibe-closed-relation-v2:'||pg_catalog.md5(pg_catalog.jsonb_build_object(
      'columns',(SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(attribute.attnum,attribute.attname,attribute.atttypid::text,attribute.atttypmod,attribute.attnotnull,attribute.attidentity,attribute.attgenerated,pg_catalog.pg_get_expr(default_fact.adbin,default_fact.adrelid)) ORDER BY attribute.attnum) FROM pg_catalog.pg_attribute attribute LEFT JOIN pg_catalog.pg_attrdef default_fact ON default_fact.adrelid=attribute.attrelid AND default_fact.adnum=attribute.attnum WHERE attribute.attrelid=object.oid AND attribute.attnum>0 AND NOT attribute.attisdropped),
      'constraints',(SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.pg_get_constraintdef(constraint_fact.oid,true) ORDER BY pg_catalog.pg_get_constraintdef(constraint_fact.oid,true)),'[]'::jsonb) FROM pg_catalog.pg_constraint constraint_fact WHERE constraint_fact.conrelid=object.oid),
      'acl',COALESCE((SELECT relation.relacl::text FROM pg_catalog.pg_class relation WHERE relation.oid=object.oid),'<NULL>')
    )::text) INTO relation_seal;
    EXECUTE pg_catalog.format('COMMENT ON TABLE %I.%I IS %L',object.schema_name,object.relname,relation_seal);
  END LOOP;
  FOR object IN
    SELECT relation.oid,namespace.nspname AS schema_name,relation.relname FROM pg_catalog.pg_class relation JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace
    WHERE namespace.nspname='public' AND relation.relkind IN ('r','p') AND relation.relname LIKE 'product\_edge\_%' ESCAPE '\'
  LOOP
    EXECUTE pg_catalog.format('ALTER TABLE %I.%I OWNER TO product_edge_custodian',object.schema_name,object.relname);
    EXECUTE pg_catalog.format('REVOKE ALL ON TABLE %I.%I FROM PUBLIC, rd_owner, operator_authorization_writer, qualification_owner, qualification_writer, backtest_owner, portfolio_owner',object.schema_name,object.relname);
    EXECUTE pg_catalog.format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %I.%I TO product_edge_owner',object.schema_name,object.relname);
    SELECT 'vibe-closed-relation-v2:'||pg_catalog.md5(pg_catalog.jsonb_build_object('columns',(SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(attribute.attnum,attribute.attname,attribute.atttypid::text,attribute.atttypmod,attribute.attnotnull,attribute.attidentity,attribute.attgenerated,pg_catalog.pg_get_expr(default_fact.adbin,default_fact.adrelid)) ORDER BY attribute.attnum) FROM pg_catalog.pg_attribute attribute LEFT JOIN pg_catalog.pg_attrdef default_fact ON default_fact.adrelid=attribute.attrelid AND default_fact.adnum=attribute.attnum WHERE attribute.attrelid=object.oid AND attribute.attnum>0 AND NOT attribute.attisdropped),'constraints',(SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.pg_get_constraintdef(constraint_fact.oid,true) ORDER BY pg_catalog.pg_get_constraintdef(constraint_fact.oid,true)),'[]'::jsonb) FROM pg_catalog.pg_constraint constraint_fact WHERE constraint_fact.conrelid=object.oid),'acl',COALESCE((SELECT relation.relacl::text FROM pg_catalog.pg_class relation WHERE relation.oid=object.oid),'<NULL>'))::text) INTO relation_seal;
    EXECUTE pg_catalog.format('COMMENT ON TABLE %I.%I IS %L',object.schema_name,object.relname,relation_seal);
  END LOOP;
  FOR object IN
    SELECT procedure.oid::pg_catalog.regprocedure AS signature,CASE WHEN namespace.nspname='rd_owner_api' OR procedure.oid=pg_catalog.to_regprocedure('public.rd_owner_reject_legacy_prepared_attempt_drain_mutation_v1()') THEN 'rd_custodian' ELSE 'product_edge_custodian' END AS custodian,'vibe-source-md5:'||pg_catalog.md5(procedure.prosrc) AS source_seal
    FROM pg_catalog.pg_proc procedure JOIN pg_catalog.pg_namespace namespace ON namespace.oid=procedure.pronamespace
    WHERE namespace.nspname IN ('rd_owner_api','product_edge_api') OR procedure.oid IN (pg_catalog.to_regprocedure('public.product_edge_reject_admission_event_mutation_v1()'),pg_catalog.to_regprocedure('public.product_edge_reject_admission_assignment_mutation_v1()'),pg_catalog.to_regprocedure('public.rd_owner_reject_legacy_prepared_attempt_drain_mutation_v1()'))
  LOOP
    EXECUTE pg_catalog.format('ALTER FUNCTION %s OWNER TO %I',object.signature,object.custodian);
    FOR relation_seal IN SELECT role.rolname FROM pg_catalog.aclexplode(COALESCE((SELECT proacl FROM pg_catalog.pg_proc WHERE oid=object.signature::pg_catalog.regprocedure),pg_catalog.acldefault('f',(SELECT proowner FROM pg_catalog.pg_proc WHERE oid=object.signature::pg_catalog.regprocedure)))) acl JOIN pg_catalog.pg_roles role ON role.oid=acl.grantee WHERE role.rolname<>object.custodian
    LOOP EXECUTE pg_catalog.format('REVOKE ALL ON FUNCTION %s FROM %I',object.signature,relation_seal); END LOOP;
    EXECUTE pg_catalog.format('COMMENT ON FUNCTION %s IS %L',object.signature,object.source_seal);
  END LOOP;
END
$runtime_custody_cutover$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA rd_owner_api TO rd_owner;
GRANT EXECUTE ON FUNCTION rd_owner_api.lock_source_acquisition_binding_v1(text,text), rd_owner_api.lock_source_invocation_reservation_v1(text,text,text,text,text) TO product_edge_owner;
DO $source_intake_routine_acl_readback$
DECLARE exact boolean;
BEGIN
  WITH required(signature,product_edge_execute) AS (VALUES
    ('rd_owner_api.derive_source_intake_identity_v1(text,text[])',false),
    ('rd_owner_api.canonical_source_intake_json_v1(jsonb)',false),
    ('rd_owner_api.derive_openalex_location_rights_v1(jsonb,text)',false),
    ('rd_owner_api.derive_source_acquisition_binding_digest_v1(jsonb)',false),
    ('rd_owner_api.derive_source_acquisition_binding_identity_v1(jsonb)',false),
    ('rd_owner_api.lock_source_acquisition_binding_v1(text,text)',true),
    ('rd_owner_api.lock_source_invocation_reservation_v1(text,text,text,text,text)',true),
    ('rd_owner_api.valid_source_intake_started_custody_v1(text,text,text,jsonb)',false),
    ('rd_owner_api.guard_source_intake_binding_v1()',false),
    ('rd_owner_api.reject_source_intake_terminal_mutation_v1()',false),
    ('rd_owner_api.valid_source_intake_binding_contract_v1(jsonb)',false),
    ('rd_owner_api.valid_source_intake_receipt_v1(jsonb,text,text,text,text,text,smallint,text,text,bigint)',false),
    ('rd_owner_api.canonical_source_intake_custody_v1(text)',false),
    ('rd_owner_api.read_source_intake_v1(text)',false),
    ('rd_owner_api.peek_source_intake_research_handoff_v1(text,text,text)',false),
    ('rd_owner_api.lock_source_intake_research_handoff_v1(text,text,text)',false)
  )
  SELECT NOT EXISTS (
    SELECT 1 FROM required
    LEFT JOIN pg_catalog.pg_proc routine ON routine.oid=pg_catalog.to_regprocedure(required.signature)
    WHERE routine.oid IS NULL
       OR pg_catalog.pg_get_userbyid(routine.proowner)<>'rd_custodian'
       OR pg_catalog.obj_description(routine.oid,'pg_proc') IS DISTINCT FROM 'vibe-source-md5:'||pg_catalog.md5(routine.prosrc)
       OR (SELECT pg_catalog.array_agg(role.rolname||':'||acl.privilege_type||':'||acl.is_grantable::text ORDER BY role.rolname,acl.privilege_type,acl.is_grantable)
             FROM pg_catalog.aclexplode(COALESCE(routine.proacl,pg_catalog.acldefault('f',routine.proowner))) acl
             JOIN pg_catalog.pg_roles role ON role.oid=acl.grantee) IS DISTINCT FROM CASE WHEN required.product_edge_execute
               THEN ARRAY['product_edge_owner:EXECUTE:false','rd_custodian:EXECUTE:false','rd_owner:EXECUTE:false']::text[]
               ELSE ARRAY['rd_custodian:EXECUTE:false','rd_owner:EXECUTE:false']::text[] END
  ) INTO exact;
  IF exact IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Source Intake routine ownership, seal, or ACL manifest mismatch';
  END IF;
END
$source_intake_routine_acl_readback$;
DO $grant_optional_rd_runtime_routines$
DECLARE signature text;
BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'rd_owner_api.peek_current_research_for_artifact_v1(text)',
    'rd_owner_api.lock_current_research_for_artifact_v1(text,text,text)',
    'rd_owner_api.lock_artifact_invocation_reservation_v1(text,text,text,text,text)'
  ] LOOP
    IF pg_catalog.to_regprocedure(signature) IS NOT NULL THEN
      EXECUTE pg_catalog.format('GRANT EXECUTE ON FUNCTION %s TO product_edge_owner',signature);
    END IF;
  END LOOP;
  FOREACH signature IN ARRAY ARRAY[
    'rd_owner_api.lock_exploratory_replay_request_v1(text,text,text)',
    'rd_owner_api.lock_exploratory_replay_request_v2(text,text,text,text)'
  ] LOOP
    IF pg_catalog.to_regprocedure(signature) IS NOT NULL THEN
      EXECUTE pg_catalog.format('REVOKE EXECUTE ON FUNCTION %s FROM rd_owner',signature);
      EXECUTE pg_catalog.format('GRANT EXECUTE ON FUNCTION %s TO backtest_owner',signature);
    END IF;
  END LOOP;
END
$grant_optional_rd_runtime_routines$;
GRANT EXECUTE ON FUNCTION rd_owner_api.lock_independence_basis_for_qualification_v1(text,text,text,jsonb) TO qualification_writer;
GRANT EXECUTE ON FUNCTION product_edge_api.lock_legacy_prepared_attempt_drain_effects_v1(), product_edge_api.read_legacy_prepared_attempt_absence_v1(text,text), product_edge_api.lock_downstream_admission_v1(text,text,text), product_edge_api.lock_source_invocation_claim_v1(text,text,text), product_edge_api.lock_source_invocation_started_v1(text,text,text) TO rd_owner, product_edge_owner;
GRANT EXECUTE ON FUNCTION product_edge_api.lock_portfolio_read_policy_v1(text,text,text,text,text) TO portfolio_owner;
GRANT EXECUTE ON FUNCTION replay_policy_catalog_api.lock_replay_policy_catalog_record_v2(text), replay_policy_catalog_api.lock_current_replay_policy_catalog_v2(), composer_owner_api.lock_accepted_develop_composer_v2(text) TO rd_owner;
GRANT EXECUTE ON FUNCTION replay_policy_catalog_api.lock_replay_policy_catalog_record_v2(text), replay_policy_catalog_api.lock_current_replay_policy_catalog_v2(), replay_policy_catalog_api.apply_replay_policy_catalog_command_v2(text,text,text,text,text,numeric,text,text,bytea,bytea,bytea,bytea,text,text,jsonb,text,text,bigint), composer_owner_api.commit_develop_composer_v2(text,bytea,bytea,bytea,bytea,bytea,bytea,bytea,bytea,bytea,bytea[],bytea[],bytea[],bytea[],bytea[],bytea,bytea,bytea,bytea,bytea), composer_owner_api.lock_accepted_develop_composer_v2(text) TO rd_fact_writer;
DO $catalog_composer_readback$
DECLARE exact boolean;
BEGIN
  SELECT pg_catalog.pg_get_userbyid(database.datdba)='rd_database_owner'
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles role WHERE role.rolname IN ('rd_database_owner','replay_policy_catalog_owner','composer_owner') AND (role.rolcanlogin OR role.rolsuper OR role.rolcreatedb OR role.rolcreaterole OR role.rolreplication OR role.rolbypassrls))
    AND EXISTS (SELECT 1 FROM pg_catalog.pg_roles role WHERE role.rolname='rd_owner' AND role.rolcanlogin AND role.rolinherit AND NOT role.rolsuper AND NOT role.rolcreatedb AND NOT role.rolcreaterole AND NOT role.rolreplication AND NOT role.rolbypassrls)
    AND NOT pg_catalog.pg_has_role('rd_owner','replay_policy_catalog_owner','MEMBER')
    AND NOT pg_catalog.pg_has_role('rd_owner','composer_owner','MEMBER')
    AND NOT pg_catalog.pg_has_role('replay_policy_catalog_owner','rd_owner','MEMBER')
    AND NOT pg_catalog.pg_has_role('composer_owner','rd_owner','MEMBER')
    AND NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_auth_members membership
      JOIN pg_catalog.pg_roles granted ON granted.oid=membership.roleid
      JOIN pg_catalog.pg_roles member ON member.oid=membership.member
      WHERE granted.rolname IN ('rd_database_owner','replay_policy_catalog_owner','composer_owner','rd_fact_writer','rd_owner')
         OR member.rolname IN ('rd_database_owner','replay_policy_catalog_owner','composer_owner','rd_fact_writer','rd_owner')
    )
    AND NOT pg_catalog.has_schema_privilege('rd_owner','replay_policy_catalog_private','USAGE')
    AND NOT pg_catalog.has_schema_privilege('rd_owner','composer_private','USAGE')
    AND pg_catalog.has_schema_privilege('rd_owner','replay_policy_catalog_api','USAGE')
    AND pg_catalog.has_schema_privilege('rd_owner','composer_owner_api','USAGE')
    AND pg_catalog.has_schema_privilege('rd_fact_writer','replay_policy_catalog_api','USAGE')
    AND pg_catalog.has_schema_privilege('rd_fact_writer','composer_owner_api','USAGE')
    AND (SELECT count(*)=4 AND bool_and(pg_catalog.pg_get_userbyid(relation.relowner)='replay_policy_catalog_owner') AND NOT bool_or(pg_catalog.has_table_privilege('rd_owner',relation.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')) FROM pg_catalog.pg_class relation JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace WHERE namespace.nspname='replay_policy_catalog_private' AND relation.relkind='r')
    AND (SELECT count(*)=9 AND bool_and(pg_catalog.pg_get_userbyid(relation.relowner)='composer_owner') AND NOT bool_or(pg_catalog.has_table_privilege('rd_owner',relation.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')) FROM pg_catalog.pg_class relation JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace WHERE namespace.nspname='composer_private' AND relation.relkind='r')
    AND (SELECT count(*)=30 FROM pg_catalog.pg_attribute attribute JOIN pg_catalog.pg_class relation ON relation.oid=attribute.attrelid JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace WHERE namespace.nspname='replay_policy_catalog_private' AND relation.relkind='r' AND attribute.attnum>0 AND NOT attribute.attisdropped)
    AND (SELECT count(*)=30 FROM pg_catalog.pg_attribute attribute JOIN pg_catalog.pg_class relation ON relation.oid=attribute.attrelid JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace WHERE namespace.nspname='composer_private' AND relation.relkind='r' AND attribute.attnum>0 AND NOT attribute.attisdropped)
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class object JOIN pg_catalog.pg_namespace namespace ON namespace.oid=object.relnamespace WHERE namespace.nspname IN ('replay_policy_catalog_private','composer_private') AND object.relkind NOT IN ('r','i'))
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger trigger_fact JOIN pg_catalog.pg_class relation ON relation.oid=trigger_fact.tgrelid JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace WHERE namespace.nspname IN ('replay_policy_catalog_private','composer_private') AND NOT trigger_fact.tgisinternal)
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policy policy JOIN pg_catalog.pg_class relation ON relation.oid=policy.polrelid JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace WHERE namespace.nspname IN ('replay_policy_catalog_private','composer_private'))
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_rewrite rewrite JOIN pg_catalog.pg_class relation ON relation.oid=rewrite.ev_class JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace WHERE namespace.nspname='replay_policy_catalog_private')
    AND (SELECT count(*)=3 AND bool_and(procedure.oid IN (
      pg_catalog.to_regprocedure('replay_policy_catalog_api.lock_replay_policy_catalog_record_v2(text)'),
      pg_catalog.to_regprocedure('replay_policy_catalog_api.lock_current_replay_policy_catalog_v2()'),
      pg_catalog.to_regprocedure('replay_policy_catalog_api.apply_replay_policy_catalog_command_v2(text,text,text,text,text,numeric,text,text,bytea,bytea,bytea,bytea,text,text,jsonb,text,text,bigint)')
    )) FROM pg_catalog.pg_proc procedure JOIN pg_catalog.pg_namespace namespace ON namespace.oid=procedure.pronamespace WHERE namespace.nspname='replay_policy_catalog_api')
    AND (SELECT count(*)=2 AND bool_and(procedure.oid IN (
      pg_catalog.to_regprocedure('composer_owner_api.commit_develop_composer_v2(text,bytea,bytea,bytea,bytea,bytea,bytea,bytea,bytea,bytea,bytea[],bytea[],bytea[],bytea[],bytea[],bytea,bytea,bytea,bytea,bytea)'),
      pg_catalog.to_regprocedure('composer_owner_api.lock_accepted_develop_composer_v2(text)')
    )) FROM pg_catalog.pg_proc procedure JOIN pg_catalog.pg_namespace namespace ON namespace.oid=procedure.pronamespace WHERE namespace.nspname='composer_owner_api')
    AND pg_catalog.has_function_privilege('rd_owner','replay_policy_catalog_api.lock_replay_policy_catalog_record_v2(text)','EXECUTE')
    AND pg_catalog.has_function_privilege('rd_owner','replay_policy_catalog_api.lock_current_replay_policy_catalog_v2()','EXECUTE')
    AND NOT pg_catalog.has_function_privilege('rd_owner','replay_policy_catalog_api.apply_replay_policy_catalog_command_v2(text,text,text,text,text,numeric,text,text,bytea,bytea,bytea,bytea,text,text,jsonb,text,text,bigint)','EXECUTE')
    AND NOT pg_catalog.has_function_privilege('rd_owner','composer_owner_api.commit_develop_composer_v2(text,bytea,bytea,bytea,bytea,bytea,bytea,bytea,bytea,bytea,bytea[],bytea[],bytea[],bytea[],bytea[],bytea,bytea,bytea,bytea,bytea)','EXECUTE')
    AND pg_catalog.has_function_privilege('rd_fact_writer','replay_policy_catalog_api.apply_replay_policy_catalog_command_v2(text,text,text,text,text,numeric,text,text,bytea,bytea,bytea,bytea,text,text,jsonb,text,text,bigint)','EXECUTE')
    AND pg_catalog.has_function_privilege('rd_fact_writer','composer_owner_api.commit_develop_composer_v2(text,bytea,bytea,bytea,bytea,bytea,bytea,bytea,bytea,bytea,bytea[],bytea[],bytea[],bytea[],bytea[],bytea,bytea,bytea,bytea,bytea)','EXECUTE')
    AND pg_catalog.has_function_privilege('rd_owner','composer_owner_api.lock_accepted_develop_composer_v2(text)','EXECUTE')
    AND pg_catalog.has_function_privilege('rd_fact_writer','composer_owner_api.lock_accepted_develop_composer_v2(text)','EXECUTE')
  INTO exact FROM pg_catalog.pg_database database WHERE database.datname=pg_catalog.current_database();
  IF exact IS DISTINCT FROM true THEN RAISE EXCEPTION 'Catalog/Composer authority readback mismatch'; END IF;
END
$catalog_composer_readback$;
DO $catalog_composer_constraint_manifest$
DECLARE exact boolean;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint constraint_fact JOIN pg_catalog.pg_class relation ON relation.oid=constraint_fact.conrelid JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace
    WHERE namespace.nspname IN ('replay_policy_catalog_private','composer_private') AND (NOT constraint_fact.convalidated OR constraint_fact.condeferrable OR constraint_fact.condeferred OR (constraint_fact.contype='c' AND constraint_fact.connoinherit) OR (constraint_fact.contype='f' AND (constraint_fact.confupdtype<>'a' OR constraint_fact.confdeltype<>'a' OR constraint_fact.confmatchtype<>'s')))
  ) THEN RAISE EXCEPTION 'Catalog/Composer constraint option manifest mismatch'; END IF;
  WITH expected(schema_name,table_name,kind,key_names) AS (VALUES
    ('replay_policy_catalog_private','rd_replay_policy_catalog_records_v2','p','catalog_record_id'),('replay_policy_catalog_private','rd_replay_policy_catalog_records_v2','u','catalog_version'),('replay_policy_catalog_private','rd_replay_policy_catalog_records_v2','u','predecessor_record_id'),('replay_policy_catalog_private','rd_replay_policy_catalog_records_v2','u','catalog_record_digest'),
    ('replay_policy_catalog_private','rd_replay_policy_catalog_head_v2','p','singleton'),('replay_policy_catalog_private','rd_replay_policy_catalog_head_v2','u','catalog_record_id'),('replay_policy_catalog_private','rd_replay_policy_catalog_head_v2','u','catalog_version'),
    ('replay_policy_catalog_private','rd_replay_policy_catalog_revocations_v2','p','catalog_record_id'),('replay_policy_catalog_private','rd_replay_policy_catalog_revocations_v2','u','catalog_version'),('replay_policy_catalog_private','rd_replay_policy_catalog_audit_v2','p','command_identity'),
    ('composer_private','rd_develop_designs_v2','p','design_identity'),('composer_private','rd_develop_plans_v2','p','plan_digest'),('composer_private','rd_develop_plans_v2','u','design_identity'),('composer_private','rd_develop_artifacts_v2','p','artifact_identity'),('composer_private','rd_develop_artifacts_v2','u','plan_digest'),
    ('composer_private','rd_develop_artifact_modules_v2','p','artifact_identity,ordinal'),('composer_private','rd_develop_build_receipts_v2','p','receipt_identity'),('composer_private','rd_develop_build_receipts_v2','u','build_attempt_identity'),('composer_private','rd_develop_build_receipts_v2','u','capsule_identity'),('composer_private','rd_develop_build_receipts_v2','u','artifact_identity,ordinal'),
    ('composer_private','rd_develop_composer_receipts_v2','p','artifact_identity'),('composer_private','rd_develop_host_receipts_v2','p','artifact_identity'),('composer_private','rd_develop_operations_v2','p','request_identity'),('composer_private','rd_develop_operations_v2','u','research_request_identity'),('composer_private','rd_develop_operations_v2','u','intent_identity'),('composer_private','rd_develop_operations_v2','u','artifact_identity'),('composer_private','rd_develop_outbox_v2','p','request_identity')
  ), actual AS (
    SELECT namespace.nspname,relation.relname,constraint_fact.contype::text,string_agg(attribute.attname,',' ORDER BY key_position.ordinality)
    FROM pg_catalog.pg_constraint constraint_fact JOIN pg_catalog.pg_class relation ON relation.oid=constraint_fact.conrelid JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace
    CROSS JOIN LATERAL unnest(constraint_fact.conkey::smallint[]) WITH ORDINALITY key_position(attnum,ordinality) JOIN pg_catalog.pg_attribute attribute ON attribute.attrelid=relation.oid AND attribute.attnum=key_position.attnum
    WHERE namespace.nspname IN ('replay_policy_catalog_private','composer_private') AND constraint_fact.contype IN ('p','u') GROUP BY namespace.nspname,relation.relname,constraint_fact.oid
  ) SELECT NOT EXISTS((SELECT * FROM expected EXCEPT SELECT * FROM actual) UNION ALL (SELECT * FROM actual EXCEPT SELECT * FROM expected)) INTO exact;
  IF exact IS DISTINCT FROM true THEN RAISE EXCEPTION 'Catalog/Composer primary or unique manifest mismatch'; END IF;

  WITH expected(source_schema,source_table,source_keys,target_schema,target_table,target_keys) AS (VALUES
    ('replay_policy_catalog_private','rd_replay_policy_catalog_records_v2','predecessor_record_id','replay_policy_catalog_private','rd_replay_policy_catalog_records_v2','catalog_record_id'),('replay_policy_catalog_private','rd_replay_policy_catalog_head_v2','catalog_record_id','replay_policy_catalog_private','rd_replay_policy_catalog_records_v2','catalog_record_id'),('replay_policy_catalog_private','rd_replay_policy_catalog_revocations_v2','catalog_record_id','replay_policy_catalog_private','rd_replay_policy_catalog_records_v2','catalog_record_id'),
    ('composer_private','rd_develop_plans_v2','design_identity','composer_private','rd_develop_designs_v2','design_identity'),('composer_private','rd_develop_artifacts_v2','plan_digest','composer_private','rd_develop_plans_v2','plan_digest'),('composer_private','rd_develop_artifact_modules_v2','artifact_identity','composer_private','rd_develop_artifacts_v2','artifact_identity'),('composer_private','rd_develop_build_receipts_v2','artifact_identity','composer_private','rd_develop_artifacts_v2','artifact_identity'),('composer_private','rd_develop_composer_receipts_v2','artifact_identity','composer_private','rd_develop_artifacts_v2','artifact_identity'),('composer_private','rd_develop_host_receipts_v2','artifact_identity','composer_private','rd_develop_artifacts_v2','artifact_identity'),('composer_private','rd_develop_operations_v2','artifact_identity','composer_private','rd_develop_artifacts_v2','artifact_identity'),('composer_private','rd_develop_outbox_v2','request_identity','composer_private','rd_develop_operations_v2','request_identity')
  ), actual AS (
    SELECT source_namespace.nspname,source_relation.relname,string_agg(source_attribute.attname,',' ORDER BY key_fact.ordinality),target_namespace.nspname,target_relation.relname,string_agg(target_attribute.attname,',' ORDER BY key_fact.ordinality)
    FROM pg_catalog.pg_constraint constraint_fact JOIN pg_catalog.pg_class source_relation ON source_relation.oid=constraint_fact.conrelid JOIN pg_catalog.pg_namespace source_namespace ON source_namespace.oid=source_relation.relnamespace JOIN pg_catalog.pg_class target_relation ON target_relation.oid=constraint_fact.confrelid JOIN pg_catalog.pg_namespace target_namespace ON target_namespace.oid=target_relation.relnamespace
    CROSS JOIN LATERAL unnest(constraint_fact.conkey::smallint[],constraint_fact.confkey::smallint[]) WITH ORDINALITY key_fact(source_attnum,target_attnum,ordinality) JOIN pg_catalog.pg_attribute source_attribute ON source_attribute.attrelid=source_relation.oid AND source_attribute.attnum=key_fact.source_attnum JOIN pg_catalog.pg_attribute target_attribute ON target_attribute.attrelid=target_relation.oid AND target_attribute.attnum=key_fact.target_attnum
    WHERE source_namespace.nspname IN ('replay_policy_catalog_private','composer_private') AND constraint_fact.contype='f' GROUP BY source_namespace.nspname,source_relation.relname,target_namespace.nspname,target_relation.relname,constraint_fact.oid
  ) SELECT NOT EXISTS((SELECT * FROM expected EXCEPT SELECT * FROM actual) UNION ALL (SELECT * FROM actual EXCEPT SELECT * FROM expected)) INTO exact;
  IF exact IS DISTINCT FROM true THEN RAISE EXCEPTION 'Catalog/Composer foreign-key dependency manifest mismatch'; END IF;

  SELECT count(*)=5 AND bool_and(pg_catalog.pg_get_expr(constraint_fact.conbin,constraint_fact.conrelid) IN ('singleton','(octet_length(policy_grammar_parser_digest) = 32)','(octet_length(policy_digest) = 32)','(octet_length(catalog_record_digest) = 32)','((catalog_version > (0)::numeric) AND (catalog_version <= ''18446744073709551615''::numeric))'))
  INTO exact FROM pg_catalog.pg_constraint constraint_fact JOIN pg_catalog.pg_class relation ON relation.oid=constraint_fact.conrelid JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace WHERE namespace.nspname IN ('replay_policy_catalog_private','composer_private') AND constraint_fact.contype='c';
  IF exact IS DISTINCT FROM true THEN RAISE EXCEPTION 'Catalog/Composer CHECK manifest mismatch'; END IF;

  SELECT count(*)=27 AND bool_and(index_fact.indisvalid AND index_fact.indisready AND index_fact.indislive AND index_fact.indisunique AND NOT index_fact.indnullsnotdistinct AND index_fact.indexprs IS NULL AND index_fact.indpred IS NULL AND index_method.amname='btree' AND index_relation.reltablespace=0 AND index_relation.reloptions IS NULL AND pg_catalog.pg_get_userbyid(index_relation.relowner) IN ('replay_policy_catalog_owner','composer_owner') AND EXISTS(SELECT 1 FROM pg_catalog.pg_constraint constraint_fact WHERE constraint_fact.conindid=index_relation.oid) AND NOT EXISTS(SELECT 1 FROM unnest(index_fact.indclass::oid[]) class_oid JOIN pg_catalog.pg_opclass operator_class ON operator_class.oid=class_oid WHERE NOT operator_class.opcdefault) AND NOT EXISTS(SELECT 1 FROM unnest(index_fact.indoption::smallint[]) option_value WHERE option_value<>0) AND NOT EXISTS(SELECT 1 FROM unnest(index_fact.indkey::smallint[],index_fact.indcollation::oid[]) key_fact(attnum,collation_oid) JOIN pg_catalog.pg_attribute attribute ON attribute.attrelid=index_fact.indrelid AND attribute.attnum=key_fact.attnum WHERE key_fact.collation_oid<>attribute.attcollation))
  INTO exact FROM pg_catalog.pg_index index_fact JOIN pg_catalog.pg_class relation ON relation.oid=index_fact.indrelid JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace JOIN pg_catalog.pg_class index_relation ON index_relation.oid=index_fact.indexrelid JOIN pg_catalog.pg_am index_method ON index_method.oid=index_relation.relam WHERE namespace.nspname IN ('replay_policy_catalog_private','composer_private');
  IF exact IS DISTINCT FROM true THEN RAISE EXCEPTION 'Catalog/Composer index manifest mismatch'; END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint inbound JOIN pg_catalog.pg_class target ON target.oid=inbound.confrelid JOIN pg_catalog.pg_namespace target_namespace ON target_namespace.oid=target.relnamespace JOIN pg_catalog.pg_class source ON source.oid=inbound.conrelid JOIN pg_catalog.pg_namespace source_namespace ON source_namespace.oid=source.relnamespace
    WHERE target_namespace.nspname IN ('replay_policy_catalog_private','composer_private') AND source_namespace.nspname NOT IN ('replay_policy_catalog_private','composer_private')
  ) THEN RAISE EXCEPTION 'Catalog/Composer external inbound dependency mismatch'; END IF;
END
$catalog_composer_constraint_manifest$;
COMMIT;
SQL
