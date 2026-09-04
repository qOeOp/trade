#!/bin/sh
set -eu

: "${RD_FACT_WRITER_DB_PASSWORD:?set RD_FACT_WRITER_DB_PASSWORD}"
: "${MARKET_DATA_OWNER_DB_PASSWORD:?set MARKET_DATA_OWNER_DB_PASSWORD}"
: "${REPLAY_POLICY_CATALOG_ADMIN_DB_PASSWORD:?set REPLAY_POLICY_CATALOG_ADMIN_DB_PASSWORD}"
export PGPASSWORD="$POSTGRES_PASSWORD"
psql --set=ON_ERROR_STOP=1 --host "${POSTGRES_HOST:-postgres}" --username postgres --dbname "${POSTGRES_DATABASE:-rd_owner}" \
  --set=rd_password="$RD_OWNER_DB_PASSWORD" \
  --set=fact_writer_password="$RD_FACT_WRITER_DB_PASSWORD" \
  --set=market_data_owner_password="$MARKET_DATA_OWNER_DB_PASSWORD" \
  --set=catalog_admin_password="$REPLAY_POLICY_CATALOG_ADMIN_DB_PASSWORD" \
  --set=issuer_password="$OPERATOR_AUTHORIZATION_DB_PASSWORD" \
  --set=qualification_password="$QUALIFICATION_OWNER_DB_PASSWORD" \
  --set=edge_password="$PRODUCT_EDGE_DB_PASSWORD" \
  --set=backtest_password="$BACKTEST_OWNER_DB_PASSWORD" << 'SQL'
BEGIN;
SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('vibe.backtest.result-topology.v2',0)
);
LOCK TABLE pg_catalog.pg_authid, pg_catalog.pg_auth_members IN SHARE ROW EXCLUSIVE MODE;
DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rd_database_owner') THEN CREATE ROLE rd_database_owner NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'replay_policy_catalog_owner') THEN CREATE ROLE replay_policy_catalog_owner NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'composer_owner') THEN CREATE ROLE composer_owner NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'market_data_owner') THEN CREATE ROLE market_data_owner LOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'backtest_custodian') THEN CREATE ROLE backtest_custodian NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rd_owner') THEN CREATE ROLE rd_owner LOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rd_fact_writer') THEN CREATE ROLE rd_fact_writer LOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'replay_policy_catalog_admin_writer') THEN CREATE ROLE replay_policy_catalog_admin_writer LOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'market_data_reader') THEN CREATE ROLE market_data_reader LOGIN; END IF;
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
ALTER ROLE replay_policy_catalog_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE composer_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE market_data_owner LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD :'market_data_owner_password';
ALTER ROLE backtest_custodian NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE rd_owner LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD :'rd_password';
ALTER ROLE rd_fact_writer LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD :'fact_writer_password';
ALTER ROLE replay_policy_catalog_admin_writer LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD :'catalog_admin_password';
ALTER ROLE market_data_reader LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE operator_authorization_owner NOLOGIN;
ALTER ROLE operator_authorization_writer LOGIN PASSWORD :'issuer_password';
ALTER ROLE qualification_owner NOLOGIN;
ALTER ROLE qualification_writer LOGIN PASSWORD :'qualification_password';
ALTER ROLE product_edge_owner PASSWORD :'edge_password';
ALTER ROLE backtest_owner LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD :'backtest_password';
ALTER ROLE portfolio_owner NOLOGIN;
GRANT operator_authorization_owner TO operator_authorization_writer;
REVOKE portfolio_owner FROM product_edge_owner;
REVOKE operator_authorization_owner FROM product_edge_owner, rd_owner;
REVOKE qualification_owner FROM qualification_writer, product_edge_owner, rd_owner, operator_authorization_writer;
REVOKE rd_owner, product_edge_owner, qualification_owner, operator_authorization_owner, portfolio_owner FROM backtest_owner;
DO $isolate_rd_authority_roles$
DECLARE authority_role text; membership record;
BEGIN
  FOREACH authority_role IN ARRAY ARRAY['rd_database_owner','replay_policy_catalog_owner','replay_policy_catalog_admin_writer','composer_owner','market_data_owner','backtest_custodian','backtest_owner','rd_fact_writer','market_data_reader'] LOOP
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
REVOKE replay_policy_catalog_owner, replay_policy_catalog_admin_writer, composer_owner, market_data_owner, rd_database_owner FROM rd_owner, rd_fact_writer, market_data_reader;
REVOKE rd_owner, rd_fact_writer, market_data_reader FROM replay_policy_catalog_owner, replay_policy_catalog_admin_writer, composer_owner, market_data_owner, rd_database_owner;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
DO $database_owner$
BEGIN
  EXECUTE pg_catalog.format('ALTER DATABASE %I OWNER TO rd_database_owner', pg_catalog.current_database());
END
$database_owner$;
DO $catalog_composer_database_access$
BEGIN
  EXECUTE pg_catalog.format(
    'REVOKE ALL PRIVILEGES ON DATABASE %I FROM market_data_reader',
    pg_catalog.current_database()
  );
  EXECUTE pg_catalog.format(
    'GRANT CONNECT ON DATABASE %I TO rd_owner, rd_fact_writer, replay_policy_catalog_admin_writer, market_data_reader, market_data_owner',
    pg_catalog.current_database()
  );
END
$catalog_composer_database_access$;
ALTER SCHEMA public OWNER TO rd_database_owner;
CREATE SCHEMA IF NOT EXISTS operator_authorization_private AUTHORIZATION operator_authorization_owner;
CREATE SCHEMA IF NOT EXISTS operator_authorization_api AUTHORIZATION operator_authorization_owner;
ALTER SCHEMA operator_authorization_private OWNER TO operator_authorization_owner;
ALTER SCHEMA operator_authorization_api OWNER TO operator_authorization_owner;
REVOKE ALL ON SCHEMA operator_authorization_private FROM PUBLIC, rd_owner, product_edge_owner, portfolio_owner;
REVOKE ALL ON SCHEMA operator_authorization_api FROM PUBLIC, rd_owner, product_edge_owner, portfolio_owner;
GRANT USAGE ON SCHEMA operator_authorization_api TO product_edge_owner;
REVOKE CREATE ON SCHEMA public FROM rd_owner;
GRANT USAGE ON SCHEMA public TO rd_owner;
GRANT USAGE, CREATE ON SCHEMA public TO product_edge_owner;
GRANT USAGE ON SCHEMA public TO qualification_writer;
CREATE SCHEMA IF NOT EXISTS product_edge_api AUTHORIZATION product_edge_owner;
ALTER SCHEMA product_edge_api OWNER TO product_edge_owner;
REVOKE ALL ON SCHEMA product_edge_api FROM PUBLIC, operator_authorization_writer, portfolio_owner;
GRANT USAGE ON SCHEMA product_edge_api TO rd_owner, portfolio_owner;
CREATE SCHEMA IF NOT EXISTS rd_owner_api AUTHORIZATION rd_owner;
ALTER SCHEMA rd_owner_api OWNER TO rd_owner;
REVOKE ALL ON SCHEMA rd_owner_api FROM PUBLIC, operator_authorization_writer, qualification_writer;
GRANT USAGE ON SCHEMA rd_owner_api TO product_edge_owner, qualification_writer, backtest_owner;
CREATE SCHEMA IF NOT EXISTS backtest_owner_api AUTHORIZATION backtest_custodian;
ALTER SCHEMA backtest_owner_api OWNER TO backtest_custodian;
REVOKE ALL ON SCHEMA backtest_owner_api FROM PUBLIC, rd_owner, rd_fact_writer, market_data_reader, backtest_owner, product_edge_owner, qualification_owner, qualification_writer, operator_authorization_owner, operator_authorization_writer, portfolio_owner;
GRANT USAGE ON SCHEMA backtest_owner_api TO rd_owner;

CREATE SCHEMA IF NOT EXISTS backtest_authority_lock_api AUTHORIZATION postgres;
ALTER SCHEMA backtest_authority_lock_api OWNER TO postgres;
REVOKE ALL ON SCHEMA backtest_authority_lock_api FROM PUBLIC, backtest_custodian, rd_owner, rd_fact_writer, market_data_reader, backtest_owner, product_edge_owner, qualification_owner, qualification_writer, operator_authorization_owner, operator_authorization_writer, portfolio_owner;
GRANT USAGE ON SCHEMA backtest_authority_lock_api TO rd_owner, backtest_owner;

CREATE TABLE IF NOT EXISTS public.backtest_replay_results_v2 (
  result_identity text PRIMARY KEY,
  result_digest text NOT NULL,
  request_identity text NOT NULL,
  request_meaning_digest text NOT NULL,
  attempt_identity text NOT NULL,
  terminal text NOT NULL CHECK (terminal IN ('RUN_REJECTED','TERMINAL_RESULT','INVALID_REPLAY_EVIDENCE')),
  canonical_bytes bytea NOT NULL,
  canonical_bytes_blake3 text NOT NULL,
  UNIQUE (request_identity,attempt_identity)
);
CREATE TABLE IF NOT EXISTS public.backtest_replay_result_receipts_v1 (
  result_identity text PRIMARY KEY,
  receipt_identity text NOT NULL UNIQUE,
  receipt_digest text NOT NULL,
  request_identity text NOT NULL,
  request_meaning_digest text NOT NULL,
  result_digest text NOT NULL,
  namespace text NOT NULL CHECK (namespace='EXPLORATORY'),
  outbox_event_identity text NOT NULL UNIQUE,
  committed_at_epoch_ms bigint NOT NULL CHECK (committed_at_epoch_ms>=0),
  canonical_bytes bytea NOT NULL,
  canonical_bytes_blake3 text NOT NULL
);
CREATE TABLE IF NOT EXISTS public.backtest_replay_result_outbox_v1 (
  result_identity text PRIMARY KEY,
  event_identity text NOT NULL UNIQUE,
  event_digest text NOT NULL,
  receipt_identity text NOT NULL UNIQUE,
  request_identity text NOT NULL,
  request_meaning_digest text NOT NULL,
  result_digest text NOT NULL,
  namespace text NOT NULL CHECK (namespace='EXPLORATORY'),
  payload_digest text NOT NULL,
  committed_at_epoch_ms bigint NOT NULL CHECK (committed_at_epoch_ms>=0),
  canonical_bytes bytea NOT NULL,
  canonical_bytes_blake3 text NOT NULL
);
ALTER TABLE public.backtest_replay_results_v2 OWNER TO backtest_custodian;
ALTER TABLE public.backtest_replay_result_receipts_v1 OWNER TO backtest_custodian;
ALTER TABLE public.backtest_replay_result_outbox_v1 OWNER TO backtest_custodian;
REVOKE ALL ON TABLE public.backtest_replay_results_v2, public.backtest_replay_result_receipts_v1, public.backtest_replay_result_outbox_v1 FROM PUBLIC, rd_owner, rd_fact_writer, market_data_reader, product_edge_owner, qualification_owner, qualification_writer, operator_authorization_owner, operator_authorization_writer, portfolio_owner, backtest_owner;
GRANT SELECT, INSERT ON TABLE public.backtest_replay_results_v2, public.backtest_replay_result_receipts_v1, public.backtest_replay_result_outbox_v1 TO backtest_owner;

DO $remove_misplaced_authority_lock$
DECLARE misplaced oid := pg_catalog.to_regprocedure('backtest_owner_api.lock_authority_catalogs_v1()');
BEGIN
  IF misplaced IS NOT NULL AND NOT COALESCE((
    SELECT pg_catalog.pg_get_userbyid(procedure.proowner)='postgres'
      AND language.lanname='plpgsql' AND procedure.prokind='f' AND NOT procedure.proleakproof
      AND procedure.prorettype='boolean'::pg_catalog.regtype AND procedure.pronargs=0
      AND procedure.prosecdef AND procedure.proisstrict AND procedure.provolatile='v' AND procedure.proparallel='u'
      AND procedure.proconfig=ARRAY['search_path=pg_catalog, pg_temp']::text[]
      AND procedure.prosrc='BEGIN LOCK TABLE pg_catalog.pg_authid, pg_catalog.pg_auth_members IN SHARE MODE; RETURN true; END'
      AND (SELECT pg_catalog.count(*)=2 AND pg_catalog.bool_and(role.rolname IN ('rd_owner','backtest_owner') AND acl.privilege_type='EXECUTE' AND NOT acl.is_grantable AND pg_catalog.pg_get_userbyid(acl.grantor)='postgres') FROM pg_catalog.aclexplode(COALESCE(procedure.proacl,pg_catalog.acldefault('f',procedure.proowner))) acl LEFT JOIN pg_catalog.pg_roles role ON role.oid=acl.grantee WHERE acl.grantee<>procedure.proowner)
    FROM pg_catalog.pg_proc procedure JOIN pg_catalog.pg_language language ON language.oid=procedure.prolang
    WHERE procedure.oid=misplaced
  ),false) THEN
    RAISE EXCEPTION 'misplaced Backtest authority-lock function provenance mismatch';
  END IF;
  IF misplaced IS NOT NULL THEN
    EXECUTE 'DROP FUNCTION backtest_owner_api.lock_authority_catalogs_v1()';
  END IF;
END
$remove_misplaced_authority_lock$;
CREATE OR REPLACE FUNCTION backtest_authority_lock_api.lock_authority_catalogs_v1()
RETURNS boolean LANGUAGE plpgsql STRICT VOLATILE PARALLEL UNSAFE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$BEGIN LOCK TABLE pg_catalog.pg_authid, pg_catalog.pg_auth_members IN SHARE MODE; RETURN true; END$function$;
ALTER FUNCTION backtest_authority_lock_api.lock_authority_catalogs_v1() OWNER TO postgres;
REVOKE ALL ON FUNCTION backtest_authority_lock_api.lock_authority_catalogs_v1() FROM PUBLIC, backtest_custodian, rd_owner, rd_fact_writer, market_data_reader, backtest_owner, product_edge_owner, qualification_owner, qualification_writer, operator_authorization_owner, operator_authorization_writer, portfolio_owner;
GRANT EXECUTE ON FUNCTION backtest_authority_lock_api.lock_authority_catalogs_v1() TO rd_owner, backtest_owner;

CREATE OR REPLACE FUNCTION backtest_owner_api.resolve_exploratory_replay_result_v2(
  p_result_identity text,
  p_request_identity text,
  p_attempt_identity text
) RETURNS jsonb LANGUAGE plpgsql STRICT VOLATILE PARALLEL UNSAFE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$DECLARE locked_result public.backtest_replay_results_v2%ROWTYPE; locked_receipt public.backtest_replay_result_receipts_v1%ROWTYPE; locked_outbox public.backtest_replay_result_outbox_v1%ROWTYPE; BEGIN SELECT result.* INTO locked_result FROM public.backtest_replay_results_v2 result WHERE result.result_identity=p_result_identity AND result.request_identity=p_request_identity AND result.attempt_identity=p_attempt_identity FOR SHARE; IF NOT FOUND THEN RETURN NULL; END IF; SELECT receipt.* INTO locked_receipt FROM public.backtest_replay_result_receipts_v1 receipt WHERE receipt.result_identity=p_result_identity FOR SHARE; IF NOT FOUND THEN RETURN NULL; END IF; SELECT outbox.* INTO locked_outbox FROM public.backtest_replay_result_outbox_v1 outbox WHERE outbox.result_identity=p_result_identity FOR SHARE; IF NOT FOUND THEN RETURN NULL; END IF; RETURN pg_catalog.jsonb_build_object('schema_version',2,'result',pg_catalog.jsonb_build_object('result_identity',locked_result.result_identity,'result_digest',locked_result.result_digest,'request_identity',locked_result.request_identity,'request_meaning_digest',locked_result.request_meaning_digest,'attempt_identity',locked_result.attempt_identity,'terminal',locked_result.terminal,'canonical_bytes_base64',pg_catalog.encode(locked_result.canonical_bytes,'base64'),'canonical_bytes_blake3',locked_result.canonical_bytes_blake3),'receipt',pg_catalog.jsonb_build_object('result_identity',locked_receipt.result_identity,'receipt_identity',locked_receipt.receipt_identity,'receipt_digest',locked_receipt.receipt_digest,'request_identity',locked_receipt.request_identity,'request_meaning_digest',locked_receipt.request_meaning_digest,'result_digest',locked_receipt.result_digest,'namespace',locked_receipt.namespace,'outbox_event_identity',locked_receipt.outbox_event_identity,'committed_at_epoch_ms',locked_receipt.committed_at_epoch_ms,'canonical_bytes_base64',pg_catalog.encode(locked_receipt.canonical_bytes,'base64'),'canonical_bytes_blake3',locked_receipt.canonical_bytes_blake3),'outbox',pg_catalog.jsonb_build_object('result_identity',locked_outbox.result_identity,'event_identity',locked_outbox.event_identity,'event_digest',locked_outbox.event_digest,'receipt_identity',locked_outbox.receipt_identity,'request_identity',locked_outbox.request_identity,'request_meaning_digest',locked_outbox.request_meaning_digest,'result_digest',locked_outbox.result_digest,'namespace',locked_outbox.namespace,'payload_digest',locked_outbox.payload_digest,'committed_at_epoch_ms',locked_outbox.committed_at_epoch_ms,'canonical_bytes_base64',pg_catalog.encode(locked_outbox.canonical_bytes,'base64'),'canonical_bytes_blake3',locked_outbox.canonical_bytes_blake3)); END$function$;
ALTER FUNCTION backtest_owner_api.resolve_exploratory_replay_result_v2(text,text,text) OWNER TO backtest_custodian;
REVOKE ALL ON FUNCTION backtest_owner_api.resolve_exploratory_replay_result_v2(text,text,text) FROM PUBLIC, backtest_owner, product_edge_owner, qualification_owner, qualification_writer, operator_authorization_owner, operator_authorization_writer, portfolio_owner, rd_fact_writer, market_data_reader, rd_owner;
GRANT EXECUTE ON FUNCTION backtest_owner_api.resolve_exploratory_replay_result_v2(text,text,text) TO rd_owner;

DO $backtest_result_topology_readback$
DECLARE exact boolean;
BEGIN
  SELECT
    (SELECT pg_catalog.pg_get_userbyid(namespace.nspowner)='backtest_custodian' FROM pg_catalog.pg_namespace namespace WHERE namespace.nspname='backtest_owner_api')
    AND (SELECT pg_catalog.count(*)=1 AND pg_catalog.bool_and(procedure.oid=pg_catalog.to_regprocedure('backtest_owner_api.resolve_exploratory_replay_result_v2(text,text,text)'))
           FROM pg_catalog.pg_proc procedure JOIN pg_catalog.pg_namespace namespace ON namespace.oid=procedure.pronamespace
          WHERE namespace.nspname='backtest_owner_api')
    AND (SELECT pg_catalog.count(*)=3 AND pg_catalog.bool_and(pg_catalog.pg_get_userbyid(relation.relowner)='backtest_custodian' AND relation.relkind='r' AND NOT relation.relrowsecurity AND NOT relation.relforcerowsecurity)
           FROM pg_catalog.pg_class relation JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace
          WHERE namespace.nspname='public' AND relation.relname IN ('backtest_replay_results_v2','backtest_replay_result_receipts_v1','backtest_replay_result_outbox_v1'))
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members membership WHERE membership.roleid IN (SELECT oid FROM pg_catalog.pg_roles WHERE rolname IN ('backtest_custodian','backtest_owner','rd_owner')) OR membership.member IN (SELECT oid FROM pg_catalog.pg_roles WHERE rolname IN ('backtest_custodian','backtest_owner','rd_owner')))
    AND (SELECT role.rolcanlogin AND role.rolinherit AND NOT role.rolsuper AND NOT role.rolcreatedb AND NOT role.rolcreaterole AND NOT role.rolreplication AND NOT role.rolbypassrls FROM pg_catalog.pg_roles role WHERE role.rolname='backtest_owner')
    AND (SELECT role.rolcanlogin AND role.rolinherit AND NOT role.rolsuper AND NOT role.rolcreatedb AND NOT role.rolcreaterole AND NOT role.rolreplication AND NOT role.rolbypassrls FROM pg_catalog.pg_roles role WHERE role.rolname='rd_owner')
    AND (SELECT pg_catalog.count(*)=1 AND pg_catalog.bool_and(role.rolname='rd_owner' AND acl.privilege_type='USAGE' AND NOT acl.is_grantable AND pg_catalog.pg_get_userbyid(acl.grantor)='backtest_custodian')
           FROM pg_catalog.pg_namespace namespace CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(namespace.nspacl,pg_catalog.acldefault('n',namespace.nspowner))) acl LEFT JOIN pg_catalog.pg_roles role ON role.oid=acl.grantee
          WHERE namespace.nspname='backtest_owner_api' AND acl.grantee<>namespace.nspowner)
    AND (SELECT pg_catalog.pg_get_userbyid(namespace.nspowner)='postgres'
           AND (SELECT pg_catalog.count(*)=2 AND pg_catalog.bool_and(role.rolname IN ('rd_owner','backtest_owner') AND acl.privilege_type='USAGE' AND NOT acl.is_grantable AND pg_catalog.pg_get_userbyid(acl.grantor)='postgres') FROM pg_catalog.aclexplode(COALESCE(namespace.nspacl,pg_catalog.acldefault('n',namespace.nspowner))) acl LEFT JOIN pg_catalog.pg_roles role ON role.oid=acl.grantee WHERE acl.grantee<>namespace.nspowner)
           AND NOT EXISTS (
             SELECT relation.oid FROM pg_catalog.pg_class relation WHERE relation.relnamespace=namespace.oid
             UNION ALL SELECT data_type.oid FROM pg_catalog.pg_type data_type WHERE data_type.typnamespace=namespace.oid
             UNION ALL SELECT operator.oid FROM pg_catalog.pg_operator operator WHERE operator.oprnamespace=namespace.oid
             UNION ALL SELECT operator_class.oid FROM pg_catalog.pg_opclass operator_class WHERE operator_class.opcnamespace=namespace.oid
             UNION ALL SELECT operator_family.oid FROM pg_catalog.pg_opfamily operator_family WHERE operator_family.opfnamespace=namespace.oid
             UNION ALL SELECT collation_entry.oid FROM pg_catalog.pg_collation collation_entry WHERE collation_entry.collnamespace=namespace.oid
             UNION ALL SELECT conversion.oid FROM pg_catalog.pg_conversion conversion WHERE conversion.connamespace=namespace.oid
             UNION ALL SELECT text_search_config.oid FROM pg_catalog.pg_ts_config text_search_config WHERE text_search_config.cfgnamespace=namespace.oid
             UNION ALL SELECT text_search_dictionary.oid FROM pg_catalog.pg_ts_dict text_search_dictionary WHERE text_search_dictionary.dictnamespace=namespace.oid
             UNION ALL SELECT text_search_parser.oid FROM pg_catalog.pg_ts_parser text_search_parser WHERE text_search_parser.prsnamespace=namespace.oid
             UNION ALL SELECT text_search_template.oid FROM pg_catalog.pg_ts_template text_search_template WHERE text_search_template.tmplnamespace=namespace.oid
             UNION ALL SELECT extended_statistic.oid FROM pg_catalog.pg_statistic_ext extended_statistic WHERE extended_statistic.stxnamespace=namespace.oid
             UNION ALL SELECT default_acl.oid FROM pg_catalog.pg_default_acl default_acl WHERE default_acl.defaclnamespace=namespace.oid
           )
           FROM pg_catalog.pg_namespace namespace WHERE namespace.nspname='backtest_authority_lock_api')
    AND (SELECT pg_catalog.count(*)=1 FROM pg_catalog.pg_proc procedure JOIN pg_catalog.pg_namespace namespace ON namespace.oid=procedure.pronamespace WHERE namespace.nspname='backtest_authority_lock_api')
    AND (SELECT pg_catalog.pg_get_userbyid(procedure.proowner)='postgres' AND language.lanname='plpgsql' AND procedure.prokind='f' AND NOT procedure.proleakproof AND procedure.prorettype='boolean'::pg_catalog.regtype AND procedure.pronargs=0 AND procedure.prosecdef AND procedure.proisstrict AND procedure.provolatile='v' AND procedure.proparallel='u' AND procedure.proconfig=ARRAY['search_path=pg_catalog, pg_temp']::text[] AND procedure.prosrc='BEGIN LOCK TABLE pg_catalog.pg_authid, pg_catalog.pg_auth_members IN SHARE MODE; RETURN true; END'
           AND (SELECT pg_catalog.count(*)=2 AND pg_catalog.bool_and(role.rolname IN ('rd_owner','backtest_owner') AND acl.privilege_type='EXECUTE' AND NOT acl.is_grantable AND pg_catalog.pg_get_userbyid(acl.grantor)='postgres') FROM pg_catalog.aclexplode(COALESCE(procedure.proacl,pg_catalog.acldefault('f',procedure.proowner))) acl LEFT JOIN pg_catalog.pg_roles role ON role.oid=acl.grantee WHERE acl.grantee<>procedure.proowner)
           FROM pg_catalog.pg_proc procedure JOIN pg_catalog.pg_language language ON language.oid=procedure.prolang WHERE procedure.oid=pg_catalog.to_regprocedure('backtest_authority_lock_api.lock_authority_catalogs_v1()'))
    AND pg_catalog.has_schema_privilege('rd_owner','backtest_owner_api','USAGE')
    AND NOT pg_catalog.has_schema_privilege('rd_owner','backtest_owner_api','CREATE')
    AND NOT pg_catalog.has_schema_privilege('backtest_owner','backtest_owner_api','USAGE,CREATE')
    AND pg_catalog.has_schema_privilege('rd_owner','backtest_authority_lock_api','USAGE')
    AND NOT pg_catalog.has_schema_privilege('rd_owner','backtest_authority_lock_api','CREATE')
    AND pg_catalog.has_schema_privilege('backtest_owner','backtest_authority_lock_api','USAGE')
    AND NOT pg_catalog.has_schema_privilege('backtest_owner','backtest_authority_lock_api','CREATE')
    AND NOT pg_catalog.has_table_privilege('rd_owner','public.backtest_replay_results_v2','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    AND NOT pg_catalog.has_table_privilege('rd_owner','public.backtest_replay_result_receipts_v1','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    AND NOT pg_catalog.has_table_privilege('rd_owner','public.backtest_replay_result_outbox_v1','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    AND pg_catalog.has_function_privilege('rd_owner','backtest_owner_api.resolve_exploratory_replay_result_v2(text,text,text)','EXECUTE')
    AND NOT pg_catalog.has_function_privilege('backtest_owner','backtest_owner_api.resolve_exploratory_replay_result_v2(text,text,text)','EXECUTE')
    AND pg_catalog.has_table_privilege('backtest_owner','public.backtest_replay_results_v2','SELECT')
    AND pg_catalog.has_table_privilege('backtest_owner','public.backtest_replay_results_v2','INSERT')
    AND pg_catalog.has_table_privilege('backtest_owner','public.backtest_replay_result_receipts_v1','SELECT')
    AND pg_catalog.has_table_privilege('backtest_owner','public.backtest_replay_result_receipts_v1','INSERT')
    AND pg_catalog.has_table_privilege('backtest_owner','public.backtest_replay_result_outbox_v1','SELECT')
    AND pg_catalog.has_table_privilege('backtest_owner','public.backtest_replay_result_outbox_v1','INSERT')
    AND NOT pg_catalog.has_table_privilege('backtest_owner','public.backtest_replay_results_v2','UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    AND NOT pg_catalog.has_table_privilege('backtest_owner','public.backtest_replay_result_receipts_v1','UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    AND NOT pg_catalog.has_table_privilege('backtest_owner','public.backtest_replay_result_outbox_v1','UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
  INTO exact;
  IF exact IS DISTINCT FROM true THEN RAISE EXCEPTION 'Backtest Result topology mismatch'; END IF;
END
$backtest_result_topology_readback$;
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
ALTER FUNCTION product_edge_api.lock_legacy_prepared_attempt_drain_effects_v1() OWNER TO product_edge_owner;
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
ALTER FUNCTION product_edge_api.read_legacy_prepared_attempt_absence_v1(text,text) OWNER TO product_edge_owner;
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

-- Catalog and Composer are private object-owner domains.  This cutover preserves relation OIDs and
-- bytes: known public relations are locked and moved; unknown partial families abort the transaction.
DO $private_owner_cutover_gate$
DECLARE
  catalog_names constant text[] := ARRAY['rd_replay_policy_catalog_records_v2','rd_replay_policy_catalog_head_v2','rd_replay_policy_catalog_revocations_v2','rd_replay_policy_catalog_audit_v2'];
  composer_names constant text[] := ARRAY['rd_develop_designs_v2','rd_develop_plans_v2','rd_develop_artifacts_v2','rd_develop_artifact_modules_v2','rd_develop_build_receipts_v2','rd_develop_composer_receipts_v2','rd_develop_host_receipts_v2','rd_develop_operations_v2','rd_develop_strategy_design_role_set_attestations_v1','rd_develop_strategy_design_native_joins_v1','rd_develop_outbox_v2'];
  relation_name text;
  catalog_public_count integer;
  catalog_private_count integer;
  composer_public_count integer;
  composer_private_count integer;
  catalog_public_exact boolean;
  catalog_private_exact boolean;
  composer_public_exact boolean;
  composer_private_exact boolean;
BEGIN
  SELECT count(*),COALESCE(bool_and(c.relkind='r' AND c.relpersistence='p'),false) INTO catalog_public_count,catalog_public_exact FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=ANY(catalog_names);
  SELECT count(*),COALESCE(bool_and(c.relkind='r' AND c.relpersistence='p'),false) INTO catalog_private_count,catalog_private_exact FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='replay_policy_catalog_private' AND c.relname=ANY(catalog_names);
  SELECT count(*),COALESCE(bool_and(c.relkind='r' AND c.relpersistence='p'),false) INTO composer_public_count,composer_public_exact FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=ANY(composer_names);
  SELECT count(*),COALESCE(bool_and(c.relkind='r' AND c.relpersistence='p'),false) INTO composer_private_count,composer_private_exact FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='composer_private' AND c.relname=ANY(composer_names);
  IF NOT (
    (catalog_public_count=4 AND catalog_public_exact AND catalog_private_count=0 AND composer_public_count IN (9,11) AND composer_public_exact AND composer_private_count=0)
    OR
    (catalog_public_count=0 AND catalog_private_count=4 AND catalog_private_exact AND composer_public_count=0 AND composer_private_count IN (9,11) AND composer_private_exact)
  ) THEN RAISE EXCEPTION 'Catalog/Composer relation families are absent, partial, or mixed'; END IF;
  FOREACH relation_name IN ARRAY catalog_names LOOP
    IF catalog_public_count=4 THEN EXECUTE pg_catalog.format('LOCK TABLE public.%I IN ACCESS EXCLUSIVE MODE',relation_name);
    ELSE EXECUTE pg_catalog.format('LOCK TABLE replay_policy_catalog_private.%I IN ACCESS EXCLUSIVE MODE',relation_name); END IF;
  END LOOP;
  FOREACH relation_name IN ARRAY composer_names LOOP
    IF composer_public_count>0 AND pg_catalog.to_regclass('public.'||relation_name) IS NOT NULL THEN
      EXECUTE pg_catalog.format('LOCK TABLE public.%I IN ACCESS EXCLUSIVE MODE',relation_name);
    ELSIF composer_private_count>0 AND pg_catalog.to_regclass('composer_private.'||relation_name) IS NOT NULL THEN
      EXECUTE pg_catalog.format('LOCK TABLE composer_private.%I IN ACCESS EXCLUSIVE MODE',relation_name);
    END IF;
  END LOOP;
END
$private_owner_cutover_gate$;

CREATE SCHEMA IF NOT EXISTS replay_policy_catalog_private AUTHORIZATION replay_policy_catalog_owner;
CREATE SCHEMA IF NOT EXISTS replay_policy_catalog_api AUTHORIZATION replay_policy_catalog_owner;
CREATE SCHEMA IF NOT EXISTS composer_private AUTHORIZATION composer_owner;
CREATE SCHEMA IF NOT EXISTS composer_owner_api AUTHORIZATION composer_owner;
ALTER SCHEMA replay_policy_catalog_private OWNER TO replay_policy_catalog_owner;
ALTER SCHEMA replay_policy_catalog_api OWNER TO replay_policy_catalog_owner;
ALTER SCHEMA composer_private OWNER TO composer_owner;
ALTER SCHEMA composer_owner_api OWNER TO composer_owner;
ALTER SCHEMA market_data_private OWNER TO market_data_owner;
REVOKE ALL ON SCHEMA replay_policy_catalog_private, replay_policy_catalog_api, composer_private, composer_owner_api, market_data_private FROM PUBLIC, rd_owner, rd_fact_writer, replay_policy_catalog_admin_writer, market_data_reader, product_edge_owner, qualification_owner, qualification_writer, operator_authorization_owner, operator_authorization_writer, portfolio_owner, backtest_owner;
GRANT USAGE ON SCHEMA replay_policy_catalog_api TO rd_owner, replay_policy_catalog_admin_writer;
GRANT USAGE ON SCHEMA composer_owner_api TO rd_owner, rd_fact_writer, market_data_reader, market_data_owner;
DO $market_data_owner_cutover$
DECLARE object record;
BEGIN
  FOR object IN
    SELECT relation.oid::pg_catalog.regclass AS identity
      FROM pg_catalog.pg_class relation
      JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace
     WHERE namespace.nspname='market_data_private'
       AND relation.relkind IN ('r','p','S')
     ORDER BY relation.relname
  LOOP
    IF (SELECT relkind FROM pg_catalog.pg_class WHERE oid=object.identity)='S' THEN
      EXECUTE pg_catalog.format('ALTER SEQUENCE %s OWNER TO market_data_owner',object.identity);
    ELSE
      EXECUTE pg_catalog.format('ALTER TABLE %s OWNER TO market_data_owner',object.identity);
    END IF;
  END LOOP;
  FOR object IN
    SELECT procedure.oid::pg_catalog.regprocedure AS identity
      FROM pg_catalog.pg_proc procedure
      JOIN pg_catalog.pg_namespace namespace ON namespace.oid=procedure.pronamespace
     WHERE namespace.nspname='market_data_private'
     ORDER BY procedure.oid
  LOOP
    EXECUTE pg_catalog.format('ALTER FUNCTION %s OWNER TO market_data_owner',object.identity);
  END LOOP;
END
$market_data_owner_cutover$;
REVOKE ALL ON ALL TABLES IN SCHEMA market_data_private FROM PUBLIC, rd_owner, rd_fact_writer, market_data_reader;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA market_data_private FROM PUBLIC, rd_owner, rd_fact_writer, market_data_reader;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA market_data_private FROM PUBLIC, rd_owner, rd_fact_writer;
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
GRANT USAGE ON SCHEMA replay_policy_catalog_api TO rd_owner, replay_policy_catalog_admin_writer;
GRANT USAGE ON SCHEMA composer_owner_api TO rd_owner, rd_fact_writer, market_data_reader, market_data_owner;

DO $private_owner_cutover$
DECLARE
  catalog_names constant text[] := ARRAY['rd_replay_policy_catalog_records_v2','rd_replay_policy_catalog_head_v2','rd_replay_policy_catalog_revocations_v2','rd_replay_policy_catalog_audit_v2'];
  composer_names constant text[] := ARRAY['rd_develop_designs_v2','rd_develop_plans_v2','rd_develop_artifacts_v2','rd_develop_artifact_modules_v2','rd_develop_build_receipts_v2','rd_develop_composer_receipts_v2','rd_develop_host_receipts_v2','rd_develop_operations_v2','rd_develop_strategy_design_role_set_attestations_v1','rd_develop_strategy_design_native_joins_v1','rd_develop_outbox_v2'];
  relation_name text;
BEGIN
  FOREACH relation_name IN ARRAY catalog_names LOOP
    IF pg_catalog.to_regclass('public.'||relation_name) IS NOT NULL THEN
      EXECUTE pg_catalog.format('ALTER TABLE public.%I SET SCHEMA replay_policy_catalog_private', relation_name);
    END IF;
  END LOOP;
  FOREACH relation_name IN ARRAY composer_names LOOP
    IF pg_catalog.to_regclass('public.'||relation_name) IS NOT NULL THEN
      EXECUTE pg_catalog.format('ALTER TABLE public.%I SET SCHEMA composer_private', relation_name);
    END IF;
  END LOOP;
END
$private_owner_cutover$;

CREATE TABLE IF NOT EXISTS replay_policy_catalog_private.rd_replay_policy_catalog_records_v2 (catalog_record_id TEXT PRIMARY KEY, catalog_version NUMERIC(20,0) NOT NULL UNIQUE CHECK (catalog_version > 0 AND catalog_version <= 18446744073709551615), owner_identity TEXT NOT NULL, predecessor_record_id TEXT UNIQUE REFERENCES replay_policy_catalog_private.rd_replay_policy_catalog_records_v2(catalog_record_id), policy_grammar_parser_id TEXT NOT NULL, policy_grammar_parser_digest BYTEA NOT NULL CHECK (octet_length(policy_grammar_parser_digest) = 32), policy_canonical_bytes BYTEA NOT NULL, policy_digest BYTEA NOT NULL CHECK (octet_length(policy_digest) = 32), catalog_record_digest BYTEA NOT NULL UNIQUE CHECK (octet_length(catalog_record_digest) = 32), created_by TEXT NOT NULL, created_at_epoch_ms BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS replay_policy_catalog_private.rd_replay_policy_catalog_head_v2 (singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton), catalog_record_id TEXT NOT NULL UNIQUE REFERENCES replay_policy_catalog_private.rd_replay_policy_catalog_records_v2(catalog_record_id), catalog_version NUMERIC(20,0) NOT NULL UNIQUE, advanced_by TEXT NOT NULL, advanced_at_epoch_ms BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS replay_policy_catalog_private.rd_replay_policy_catalog_revocations_v2 (catalog_record_id TEXT PRIMARY KEY REFERENCES replay_policy_catalog_private.rd_replay_policy_catalog_records_v2(catalog_record_id), catalog_version NUMERIC(20,0) NOT NULL UNIQUE, revoked_by TEXT NOT NULL, revoked_at_epoch_ms BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS replay_policy_catalog_private.rd_replay_policy_catalog_audit_v2 (command_identity TEXT PRIMARY KEY, administrator_identity TEXT NOT NULL, authentication_fact_digest TEXT NOT NULL, command_kind TEXT NOT NULL, predecessor_record_id TEXT, predecessor_head_record_id TEXT, result_record_id TEXT, content_identity TEXT NOT NULL, audit_json JSONB NOT NULL, committed_at_epoch_ms BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS composer_private.rd_develop_designs_v2 (design_identity BYTEA PRIMARY KEY, canonical_bytes BYTEA NOT NULL);
CREATE TABLE IF NOT EXISTS composer_private.rd_develop_plans_v2 (plan_digest BYTEA PRIMARY KEY, design_identity BYTEA NOT NULL UNIQUE REFERENCES composer_private.rd_develop_designs_v2(design_identity), canonical_bytes BYTEA NOT NULL);
CREATE TABLE IF NOT EXISTS composer_private.rd_develop_artifacts_v2 (artifact_identity BYTEA PRIMARY KEY, plan_digest BYTEA NOT NULL UNIQUE REFERENCES composer_private.rd_develop_plans_v2(plan_digest), package_bytes BYTEA NOT NULL);
CREATE TABLE IF NOT EXISTS composer_private.rd_develop_artifact_modules_v2 (artifact_identity BYTEA NOT NULL REFERENCES composer_private.rd_develop_artifacts_v2(artifact_identity), ordinal INTEGER NOT NULL, module_bytes BYTEA NOT NULL, PRIMARY KEY (artifact_identity, ordinal));
CREATE TABLE IF NOT EXISTS composer_private.rd_develop_build_receipts_v2 (receipt_identity BYTEA PRIMARY KEY, build_attempt_identity BYTEA NOT NULL UNIQUE, capsule_identity BYTEA NOT NULL UNIQUE, artifact_identity BYTEA NOT NULL REFERENCES composer_private.rd_develop_artifacts_v2(artifact_identity), ordinal INTEGER NOT NULL, canonical_bytes BYTEA NOT NULL, UNIQUE (artifact_identity, ordinal));
CREATE TABLE IF NOT EXISTS composer_private.rd_develop_composer_receipts_v2 (artifact_identity BYTEA PRIMARY KEY REFERENCES composer_private.rd_develop_artifacts_v2(artifact_identity), canonical_bytes BYTEA NOT NULL);
CREATE TABLE IF NOT EXISTS composer_private.rd_develop_host_receipts_v2 (artifact_identity BYTEA PRIMARY KEY REFERENCES composer_private.rd_develop_artifacts_v2(artifact_identity), canonical_bytes BYTEA NOT NULL);
CREATE TABLE IF NOT EXISTS composer_private.rd_develop_operations_v2 (request_identity TEXT PRIMARY KEY, request_digest BYTEA NOT NULL, research_request_identity BYTEA NOT NULL UNIQUE, intent_identity BYTEA NOT NULL UNIQUE, artifact_identity BYTEA NOT NULL UNIQUE REFERENCES composer_private.rd_develop_artifacts_v2(artifact_identity), canonical_receipt_bytes BYTEA NOT NULL, response_bytes BYTEA NOT NULL);
CREATE TABLE IF NOT EXISTS composer_private.rd_develop_strategy_design_role_set_attestations_v1 (request_identity TEXT PRIMARY KEY REFERENCES composer_private.rd_develop_operations_v2(request_identity), composer_schema_version INTEGER NOT NULL, operation_receipt_identity BYTEA NOT NULL UNIQUE, artifact_locator TEXT NOT NULL, artifact_identity BYTEA NOT NULL UNIQUE, canonical_plan_digest BYTEA NOT NULL UNIQUE, design_digest BYTEA NOT NULL, attestation_identity BYTEA NOT NULL UNIQUE, attestation_digest BYTEA NOT NULL UNIQUE, canonical_bytes BYTEA NOT NULL, UNIQUE (request_identity, composer_schema_version, operation_receipt_identity, artifact_locator, artifact_identity, canonical_plan_digest, design_digest));
CREATE TABLE IF NOT EXISTS composer_private.rd_develop_strategy_design_native_joins_v1 (request_identity TEXT PRIMARY KEY REFERENCES composer_private.rd_develop_operations_v2(request_identity), native_join_digest BYTEA NOT NULL UNIQUE, projection_receipt_digest BYTEA NOT NULL UNIQUE, joined_cut_digest BYTEA NOT NULL, schedule_dependency_set_digest BYTEA NOT NULL, canonical_bytes BYTEA NOT NULL);
CREATE TABLE IF NOT EXISTS composer_private.rd_develop_outbox_v2 (request_identity TEXT PRIMARY KEY REFERENCES composer_private.rd_develop_operations_v2(request_identity), canonical_bytes BYTEA NOT NULL);

DO $private_table_owners$
DECLARE relation_name text;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY['rd_replay_policy_catalog_records_v2','rd_replay_policy_catalog_head_v2','rd_replay_policy_catalog_revocations_v2','rd_replay_policy_catalog_audit_v2'] LOOP EXECUTE pg_catalog.format('ALTER TABLE replay_policy_catalog_private.%I OWNER TO replay_policy_catalog_owner', relation_name); END LOOP;
  FOREACH relation_name IN ARRAY ARRAY['rd_develop_designs_v2','rd_develop_plans_v2','rd_develop_artifacts_v2','rd_develop_artifact_modules_v2','rd_develop_build_receipts_v2','rd_develop_composer_receipts_v2','rd_develop_host_receipts_v2','rd_develop_operations_v2','rd_develop_strategy_design_role_set_attestations_v1','rd_develop_strategy_design_native_joins_v1','rd_develop_outbox_v2'] LOOP EXECUTE pg_catalog.format('ALTER TABLE composer_private.%I OWNER TO composer_owner', relation_name); END LOOP;
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
REVOKE ALL ON ALL TABLES IN SCHEMA replay_policy_catalog_private FROM market_data_reader;
REVOKE ALL ON ALL TABLES IN SCHEMA composer_private FROM market_data_reader;
DO $catalog_composer_relation_acl_readback$
DECLARE exact boolean;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_class relation JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace
    WHERE namespace.nspname IN ('replay_policy_catalog_private','composer_private') AND relation.relkind='S'
  ) THEN RAISE EXCEPTION 'Catalog/Composer sequence manifest mismatch'; END IF;
  SELECT count(*)=15 AND bool_and(relation.relpersistence='p') INTO exact FROM pg_catalog.pg_class relation JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace
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

CREATE OR REPLACE FUNCTION replay_policy_catalog_api.lock_replay_policy_catalog_census_v2()
RETURNS TABLE (record_count bigint, head_count bigint, revocation_count bigint, audit_count bigint)
LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $catalog_census$
BEGIN
  LOCK TABLE replay_policy_catalog_private.rd_replay_policy_catalog_records_v2,
    replay_policy_catalog_private.rd_replay_policy_catalog_head_v2,
    replay_policy_catalog_private.rd_replay_policy_catalog_revocations_v2,
    replay_policy_catalog_private.rd_replay_policy_catalog_audit_v2 IN SHARE ROW EXCLUSIVE MODE;
  RETURN QUERY SELECT
    (SELECT pg_catalog.count(*) FROM replay_policy_catalog_private.rd_replay_policy_catalog_records_v2),
    (SELECT pg_catalog.count(*) FROM replay_policy_catalog_private.rd_replay_policy_catalog_head_v2),
    (SELECT pg_catalog.count(*) FROM replay_policy_catalog_private.rd_replay_policy_catalog_revocations_v2),
    (SELECT pg_catalog.count(*) FROM replay_policy_catalog_private.rd_replay_policy_catalog_audit_v2);
END
$catalog_census$;
ALTER FUNCTION replay_policy_catalog_api.lock_replay_policy_catalog_census_v2() OWNER TO replay_policy_catalog_owner;
REVOKE ALL ON FUNCTION replay_policy_catalog_api.lock_replay_policy_catalog_census_v2() FROM PUBLIC, rd_owner, rd_fact_writer, replay_policy_catalog_admin_writer;
GRANT EXECUTE ON FUNCTION replay_policy_catalog_api.lock_replay_policy_catalog_census_v2() TO rd_owner, replay_policy_catalog_admin_writer;

CREATE OR REPLACE FUNCTION replay_policy_catalog_api.lock_replay_policy_catalog_record_v2(p_record_id text)
RETURNS TABLE (catalog_record_id text, catalog_version numeric, owner_identity text, predecessor_record_id text, policy_grammar_parser_id text, policy_grammar_parser_digest bytea, policy_canonical_bytes bytea, policy_digest bytea, catalog_record_digest bytea, created_by text, created_at_epoch_ms bigint, head_record_id text, head_version numeric, advanced_by text, advanced_at_epoch_ms bigint, revoked boolean)
LANGUAGE sql STRICT VOLATILE PARALLEL UNSAFE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $catalog_read$
  SELECT record.catalog_record_id, record.catalog_version, record.owner_identity, record.predecessor_record_id,
    record.policy_grammar_parser_id, record.policy_grammar_parser_digest, record.policy_canonical_bytes,
    record.policy_digest, record.catalog_record_digest, record.created_by, record.created_at_epoch_ms,
    head.catalog_record_id, head.catalog_version, head.advanced_by, head.advanced_at_epoch_ms,
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
GRANT EXECUTE ON FUNCTION replay_policy_catalog_api.lock_replay_policy_catalog_record_v2(text) TO rd_owner, replay_policy_catalog_admin_writer;

CREATE OR REPLACE FUNCTION replay_policy_catalog_api.lock_current_replay_policy_catalog_v2()
RETURNS TABLE (catalog_record_id text, catalog_version numeric, owner_identity text, predecessor_record_id text, policy_grammar_parser_id text, policy_grammar_parser_digest bytea, policy_canonical_bytes bytea, policy_digest bytea, catalog_record_digest bytea, created_by text, created_at_epoch_ms bigint, head_record_id text, head_version numeric, advanced_by text, advanced_at_epoch_ms bigint, revoked boolean)
LANGUAGE sql VOLATILE PARALLEL UNSAFE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $catalog_current$
  SELECT record.catalog_record_id, record.catalog_version, record.owner_identity, record.predecessor_record_id,
    record.policy_grammar_parser_id, record.policy_grammar_parser_digest, record.policy_canonical_bytes,
    record.policy_digest, record.catalog_record_digest, record.created_by, record.created_at_epoch_ms,
    head.catalog_record_id, head.catalog_version, head.advanced_by, head.advanced_at_epoch_ms,
    revocation.catalog_record_id IS NOT NULL
  FROM replay_policy_catalog_private.rd_replay_policy_catalog_head_v2 head
  JOIN replay_policy_catalog_private.rd_replay_policy_catalog_records_v2 record ON record.catalog_record_id=head.catalog_record_id AND record.catalog_version=head.catalog_version
  LEFT JOIN replay_policy_catalog_private.rd_replay_policy_catalog_revocations_v2 revocation ON revocation.catalog_record_id=record.catalog_record_id
  WHERE head.singleton FOR UPDATE OF head, record
$catalog_current$;
ALTER FUNCTION replay_policy_catalog_api.lock_current_replay_policy_catalog_v2() OWNER TO replay_policy_catalog_owner;
REVOKE ALL ON FUNCTION replay_policy_catalog_api.lock_current_replay_policy_catalog_v2() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION replay_policy_catalog_api.lock_current_replay_policy_catalog_v2() TO rd_owner, replay_policy_catalog_admin_writer;

CREATE OR REPLACE FUNCTION replay_policy_catalog_api.read_replay_policy_catalog_audit_v2(p_command_identity text)
RETURNS TABLE (administrator_identity text, authentication_fact_digest text, command_kind text, predecessor_record_id text, predecessor_head_record_id text, result_record_id text, content_identity text, audit_json jsonb, committed_at_epoch_ms bigint)
LANGUAGE sql STRICT VOLATILE PARALLEL UNSAFE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $catalog_audit_read$
  SELECT audit.administrator_identity, audit.authentication_fact_digest, audit.command_kind,
    audit.predecessor_record_id, audit.predecessor_head_record_id, audit.result_record_id,
    audit.content_identity, audit.audit_json, audit.committed_at_epoch_ms
  FROM replay_policy_catalog_private.rd_replay_policy_catalog_audit_v2 audit
  WHERE audit.command_identity=p_command_identity
$catalog_audit_read$;
ALTER FUNCTION replay_policy_catalog_api.read_replay_policy_catalog_audit_v2(text) OWNER TO replay_policy_catalog_owner;
REVOKE ALL ON FUNCTION replay_policy_catalog_api.read_replay_policy_catalog_audit_v2(text) FROM PUBLIC, rd_owner, rd_fact_writer, replay_policy_catalog_admin_writer;
GRANT EXECUTE ON FUNCTION replay_policy_catalog_api.read_replay_policy_catalog_audit_v2(text) TO rd_owner, replay_policy_catalog_admin_writer;

CREATE OR REPLACE FUNCTION replay_policy_catalog_api.apply_replay_policy_catalog_command_v2(
  p_action text, p_command_identity text, p_administrator_identity text, p_authentication_digest text,
  p_record_id text, p_version numeric, p_predecessor_id text, p_parser_id text, p_parser_digest bytea,
  p_policy_bytes bytea, p_policy_digest bytea, p_record_digest bytea, p_expected_head text,
  p_content_identity text, p_audit jsonb, p_epoch_ms bigint
) RETURNS boolean LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $catalog_apply$
DECLARE actual_head text; actual_latest text;
BEGIN
  IF SESSION_USER<>'replay_policy_catalog_admin_writer' THEN RAISE EXCEPTION 'Replay Policy Catalog admin writer required' USING ERRCODE='42501'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(7246450332882419842);
  SELECT head.catalog_record_id INTO actual_head FROM replay_policy_catalog_private.rd_replay_policy_catalog_head_v2 head WHERE head.singleton FOR UPDATE;
  SELECT record.catalog_record_id INTO actual_latest FROM replay_policy_catalog_private.rd_replay_policy_catalog_records_v2 record ORDER BY record.catalog_version DESC LIMIT 1 FOR UPDATE;
  IF p_action='create' THEN
    IF actual_latest IS NOT NULL OR actual_head IS NOT NULL OR p_version<>1
      OR EXISTS (SELECT 1 FROM replay_policy_catalog_private.rd_replay_policy_catalog_revocations_v2)
      OR EXISTS (SELECT 1 FROM replay_policy_catalog_private.rd_replay_policy_catalog_audit_v2)
    THEN RETURN false; END IF;
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
  RETURN true;
END
$catalog_apply$;
ALTER FUNCTION replay_policy_catalog_api.apply_replay_policy_catalog_command_v2(text,text,text,text,text,numeric,text,text,bytea,bytea,bytea,bytea,text,text,jsonb,bigint) OWNER TO replay_policy_catalog_owner;
REVOKE ALL ON FUNCTION replay_policy_catalog_api.apply_replay_policy_catalog_command_v2(text,text,text,text,text,numeric,text,text,bytea,bytea,bytea,bytea,text,text,jsonb,bigint) FROM PUBLIC, rd_owner, rd_fact_writer, replay_policy_catalog_admin_writer;
GRANT EXECUTE ON FUNCTION replay_policy_catalog_api.apply_replay_policy_catalog_command_v2(text,text,text,text,text,numeric,text,text,bytea,bytea,bytea,bytea,text,text,jsonb,bigint) TO replay_policy_catalog_admin_writer;

DROP FUNCTION IF EXISTS composer_owner_api.commit_develop_composer_v2(text,bytea,bytea,bytea,bytea,bytea,bytea,bytea,bytea,bytea,bytea[],bytea[],bytea[],bytea[],bytea[],bytea,bytea,bytea,bytea,bytea);
CREATE OR REPLACE FUNCTION composer_owner_api.commit_develop_composer_v2(
  p_request_identity text, p_request_digest bytea, p_research_identity bytea, p_intent_identity bytea,
  p_artifact_identity bytea, p_design_identity bytea, p_plan_digest bytea, p_design_bytes bytea,
  p_plan_bytes bytea, p_package_bytes bytea, p_module_bytes bytea[], p_receipt_identities bytea[],
  p_attempt_identities bytea[], p_capsule_identities bytea[], p_build_bytes bytea[],
  p_composer_bytes bytea, p_host_bytes bytea, p_operation_bytes bytea, p_response_bytes bytea, p_outbox_bytes bytea,
  p_role_schema_version integer, p_role_operation_receipt_identity bytea, p_role_artifact_locator text,
  p_role_design_digest bytea, p_role_attestation_identity bytea, p_role_attestation_digest bytea, p_role_bytes bytea,
  p_native_join_digest bytea, p_projection_receipt_digest bytea, p_joined_cut_digest bytea,
  p_schedule_dependency_set_digest bytea, p_native_join_bytes bytea
) RETURNS boolean LANGUAGE plpgsql STRICT VOLATILE PARALLEL UNSAFE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $composer_commit$DECLARE ordinal integer;
BEGIN
  IF SESSION_USER<>'rd_fact_writer' THEN RAISE EXCEPTION 'R&D fact writer required' USING ERRCODE='42501'; END IF;
  IF cardinality(p_receipt_identities)<>cardinality(p_attempt_identities)
     OR cardinality(p_receipt_identities)<>cardinality(p_capsule_identities)
     OR cardinality(p_receipt_identities)<>cardinality(p_build_bytes) THEN RETURN false; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('rd.develop.composer.commit.v2:'||p_request_identity,0));
  PERFORM operation.request_identity FROM composer_private.rd_develop_operations_v2 operation WHERE operation.request_identity=p_request_identity FOR UPDATE;
  IF FOUND THEN
    RETURN EXISTS (
      SELECT 1
        FROM composer_private.rd_develop_operations_v2 operation
        JOIN composer_private.rd_develop_artifacts_v2 artifact ON artifact.artifact_identity=operation.artifact_identity
        JOIN composer_private.rd_develop_plans_v2 plan ON plan.plan_digest=artifact.plan_digest
        JOIN composer_private.rd_develop_designs_v2 design ON design.design_identity=plan.design_identity
        JOIN composer_private.rd_develop_composer_receipts_v2 composer ON composer.artifact_identity=artifact.artifact_identity
        JOIN composer_private.rd_develop_host_receipts_v2 host ON host.artifact_identity=artifact.artifact_identity
        JOIN composer_private.rd_develop_strategy_design_role_set_attestations_v1 role_set ON role_set.request_identity=operation.request_identity
        JOIN composer_private.rd_develop_outbox_v2 outbox ON outbox.request_identity=operation.request_identity
        LEFT JOIN composer_private.rd_develop_strategy_design_native_joins_v1 native_join ON native_join.request_identity=operation.request_identity
        LEFT JOIN LATERAL (SELECT array_agg(module.ordinal ORDER BY module.ordinal) AS ordinals,array_agg(module.module_bytes ORDER BY module.ordinal) AS canonical_bytes FROM composer_private.rd_develop_artifact_modules_v2 module WHERE module.artifact_identity=artifact.artifact_identity) modules ON true
        LEFT JOIN LATERAL (SELECT array_agg(receipt.ordinal ORDER BY receipt.ordinal) AS ordinals,array_agg(receipt.receipt_identity ORDER BY receipt.ordinal) AS identities,array_agg(receipt.build_attempt_identity ORDER BY receipt.ordinal) AS attempts,array_agg(receipt.capsule_identity ORDER BY receipt.ordinal) AS capsules,array_agg(receipt.canonical_bytes ORDER BY receipt.ordinal) AS canonical_bytes FROM composer_private.rd_develop_build_receipts_v2 receipt WHERE receipt.artifact_identity=artifact.artifact_identity) builds ON true
       WHERE operation.request_identity=p_request_identity
         AND operation.request_digest=p_request_digest AND operation.research_request_identity=p_research_identity AND operation.intent_identity=p_intent_identity AND operation.artifact_identity=p_artifact_identity AND operation.canonical_receipt_bytes=p_operation_bytes AND operation.response_bytes=p_response_bytes
         AND artifact.plan_digest=p_plan_digest AND artifact.package_bytes=p_package_bytes
         AND plan.design_identity=p_design_identity AND plan.canonical_bytes=p_plan_bytes AND design.canonical_bytes=p_design_bytes
         AND COALESCE(modules.ordinals,ARRAY[]::integer[])=(SELECT COALESCE(array_agg(value),ARRAY[]::integer[]) FROM generate_series(0,cardinality(p_module_bytes)-1) value)
         AND COALESCE(modules.canonical_bytes,ARRAY[]::bytea[])=p_module_bytes
         AND COALESCE(builds.ordinals,ARRAY[]::integer[])=(SELECT COALESCE(array_agg(value),ARRAY[]::integer[]) FROM generate_series(0,cardinality(p_receipt_identities)-1) value)
         AND COALESCE(builds.identities,ARRAY[]::bytea[])=p_receipt_identities AND COALESCE(builds.attempts,ARRAY[]::bytea[])=p_attempt_identities AND COALESCE(builds.capsules,ARRAY[]::bytea[])=p_capsule_identities AND COALESCE(builds.canonical_bytes,ARRAY[]::bytea[])=p_build_bytes
         AND composer.canonical_bytes=p_composer_bytes AND host.canonical_bytes=p_host_bytes AND outbox.canonical_bytes=p_outbox_bytes
         AND role_set.composer_schema_version=p_role_schema_version AND role_set.operation_receipt_identity=p_role_operation_receipt_identity AND role_set.artifact_locator=p_role_artifact_locator AND role_set.artifact_identity=p_artifact_identity AND role_set.canonical_plan_digest=p_plan_digest AND role_set.design_digest=p_role_design_digest AND role_set.attestation_identity=p_role_attestation_identity AND role_set.attestation_digest=p_role_attestation_digest AND role_set.canonical_bytes=p_role_bytes
         AND ((octet_length(p_native_join_bytes)=0 AND native_join.request_identity IS NULL) OR (octet_length(p_native_join_bytes)>0 AND native_join.native_join_digest=p_native_join_digest AND native_join.projection_receipt_digest=p_projection_receipt_digest AND native_join.joined_cut_digest=p_joined_cut_digest AND native_join.schedule_dependency_set_digest=p_schedule_dependency_set_digest AND native_join.canonical_bytes=p_native_join_bytes))
    );
  END IF;
  INSERT INTO composer_private.rd_develop_designs_v2 VALUES (p_design_identity,p_design_bytes);
  INSERT INTO composer_private.rd_develop_plans_v2 VALUES (p_plan_digest,p_design_identity,p_plan_bytes);
  INSERT INTO composer_private.rd_develop_artifacts_v2 VALUES (p_artifact_identity,p_plan_digest,p_package_bytes);
  FOR ordinal IN SELECT generate_subscripts(p_module_bytes,1) LOOP INSERT INTO composer_private.rd_develop_artifact_modules_v2 VALUES (p_artifact_identity,ordinal-1,p_module_bytes[ordinal]); END LOOP;
  FOR ordinal IN SELECT generate_subscripts(p_receipt_identities,1) LOOP INSERT INTO composer_private.rd_develop_build_receipts_v2 VALUES (p_receipt_identities[ordinal],p_attempt_identities[ordinal],p_capsule_identities[ordinal],p_artifact_identity,ordinal-1,p_build_bytes[ordinal]); END LOOP;
  INSERT INTO composer_private.rd_develop_composer_receipts_v2 VALUES (p_artifact_identity,p_composer_bytes);
  INSERT INTO composer_private.rd_develop_host_receipts_v2 VALUES (p_artifact_identity,p_host_bytes);
  INSERT INTO composer_private.rd_develop_operations_v2 VALUES (p_request_identity,p_request_digest,p_research_identity,p_intent_identity,p_artifact_identity,p_operation_bytes,p_response_bytes);
  INSERT INTO composer_private.rd_develop_strategy_design_role_set_attestations_v1 VALUES (p_request_identity,p_role_schema_version,p_role_operation_receipt_identity,p_role_artifact_locator,p_artifact_identity,p_plan_digest,p_role_design_digest,p_role_attestation_identity,p_role_attestation_digest,p_role_bytes);
  IF octet_length(p_native_join_bytes)>0 THEN
    INSERT INTO composer_private.rd_develop_strategy_design_native_joins_v1 VALUES (p_request_identity,p_native_join_digest,p_projection_receipt_digest,p_joined_cut_digest,p_schedule_dependency_set_digest,p_native_join_bytes);
  END IF;
  INSERT INTO composer_private.rd_develop_outbox_v2 VALUES (p_request_identity,p_outbox_bytes);
  RETURN true;
END$composer_commit$;
ALTER FUNCTION composer_owner_api.commit_develop_composer_v2(text,bytea,bytea,bytea,bytea,bytea,bytea,bytea,bytea,bytea,bytea[],bytea[],bytea[],bytea[],bytea[],bytea,bytea,bytea,bytea,bytea,integer,bytea,text,bytea,bytea,bytea,bytea,bytea,bytea,bytea,bytea,bytea) OWNER TO composer_owner;
REVOKE ALL ON FUNCTION composer_owner_api.commit_develop_composer_v2(text,bytea,bytea,bytea,bytea,bytea,bytea,bytea,bytea,bytea,bytea[],bytea[],bytea[],bytea[],bytea[],bytea,bytea,bytea,bytea,bytea,integer,bytea,text,bytea,bytea,bytea,bytea,bytea,bytea,bytea,bytea,bytea) FROM PUBLIC, rd_owner, rd_fact_writer;
GRANT EXECUTE ON FUNCTION composer_owner_api.commit_develop_composer_v2(text,bytea,bytea,bytea,bytea,bytea,bytea,bytea,bytea,bytea,bytea[],bytea[],bytea[],bytea[],bytea[],bytea,bytea,bytea,bytea,bytea,integer,bytea,text,bytea,bytea,bytea,bytea,bytea,bytea,bytea,bytea,bytea) TO rd_fact_writer;
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
    composer_private.rd_develop_strategy_design_role_set_attestations_v1,
    composer_private.rd_develop_strategy_design_native_joins_v1,
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
GRANT EXECUTE ON FUNCTION composer_owner_api.lock_accepted_develop_composer_v2(text) TO rd_owner;
CREATE OR REPLACE FUNCTION composer_owner_api.lock_replay_composition_cut_v1(p_request_identity text)
RETURNS bigint
LANGUAGE plpgsql STRICT VOLATILE PARALLEL UNSAFE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $replay_composition_cut$
BEGIN
  IF session_user NOT IN ('market_data_reader','market_data_owner') OR current_user<>'composer_owner' THEN
    RAISE EXCEPTION 'Replay composition cut caller mismatch' USING ERRCODE='42501';
  END IF;
  IF session_user='market_data_owner' THEN
    IF NOT pg_catalog.pg_try_advisory_xact_lock_shared(
      pg_catalog.hashtextextended('rd.develop.composer.commit.v2:'||p_request_identity,0)
    ) THEN
      RETURN 0;
    END IF;
  ELSE
    PERFORM pg_catalog.pg_advisory_xact_lock_shared(
      pg_catalog.hashtextextended('rd.develop.composer.commit.v2:'||p_request_identity,0)
    );
  END IF;
  RETURN pg_catalog.pg_backend_pid();
END
$replay_composition_cut$;
ALTER FUNCTION composer_owner_api.lock_replay_composition_cut_v1(text) OWNER TO composer_owner;
REVOKE ALL ON FUNCTION composer_owner_api.lock_replay_composition_cut_v1(text) FROM PUBLIC, rd_owner, rd_fact_writer;
GRANT EXECUTE ON FUNCTION composer_owner_api.lock_replay_composition_cut_v1(text) TO market_data_reader, market_data_owner;
CREATE OR REPLACE FUNCTION composer_owner_api.resolve_strategy_design_role_set_attestation_v1(
  p_request_identity text, p_composer_schema_version integer, p_operation_receipt_identity bytea,
  p_artifact_locator text, p_artifact_identity bytea, p_canonical_plan_digest bytea, p_design_digest bytea
) RETURNS TABLE(attestation_identity bytea, attestation_digest bytea, canonical_bytes bytea)
LANGUAGE sql STRICT STABLE PARALLEL SAFE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $composer_role_set_read$SELECT attestation.attestation_identity,attestation.attestation_digest,attestation.canonical_bytes FROM composer_private.rd_develop_strategy_design_role_set_attestations_v1 attestation WHERE attestation.request_identity=p_request_identity AND attestation.composer_schema_version=p_composer_schema_version AND attestation.operation_receipt_identity=p_operation_receipt_identity AND attestation.artifact_locator=p_artifact_locator AND attestation.artifact_identity=p_artifact_identity AND attestation.canonical_plan_digest=p_canonical_plan_digest AND attestation.design_digest=p_design_digest$composer_role_set_read$;
ALTER FUNCTION composer_owner_api.resolve_strategy_design_role_set_attestation_v1(text,integer,bytea,text,bytea,bytea,bytea) OWNER TO composer_owner;
REVOKE ALL ON FUNCTION composer_owner_api.resolve_strategy_design_role_set_attestation_v1(text,integer,bytea,text,bytea,bytea,bytea) FROM PUBLIC, rd_owner, rd_fact_writer;
GRANT EXECUTE ON FUNCTION composer_owner_api.resolve_strategy_design_role_set_attestation_v1(text,integer,bytea,text,bytea,bytea,bytea) TO market_data_reader;
CREATE OR REPLACE FUNCTION composer_owner_api.resolve_strategy_design_native_join_v1(
  p_request_identity text, p_composer_schema_version integer, p_operation_receipt_identity bytea,
  p_artifact_locator text, p_artifact_identity bytea, p_canonical_plan_digest bytea, p_design_digest bytea
) RETURNS TABLE(native_join_digest bytea, projection_receipt_digest bytea, joined_cut_digest bytea, schedule_dependency_set_digest bytea, canonical_bytes bytea)
LANGUAGE sql STRICT STABLE PARALLEL SAFE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $composer_native_join_read$SELECT native_join.native_join_digest,native_join.projection_receipt_digest,native_join.joined_cut_digest,native_join.schedule_dependency_set_digest,native_join.canonical_bytes FROM composer_private.rd_develop_strategy_design_native_joins_v1 native_join JOIN composer_private.rd_develop_strategy_design_role_set_attestations_v1 attestation USING(request_identity) WHERE native_join.request_identity=p_request_identity AND attestation.composer_schema_version=p_composer_schema_version AND attestation.operation_receipt_identity=p_operation_receipt_identity AND attestation.artifact_locator=p_artifact_locator AND attestation.artifact_identity=p_artifact_identity AND attestation.canonical_plan_digest=p_canonical_plan_digest AND attestation.design_digest=p_design_digest$composer_native_join_read$;
ALTER FUNCTION composer_owner_api.resolve_strategy_design_native_join_v1(text,integer,bytea,text,bytea,bytea,bytea) OWNER TO composer_owner;
REVOKE ALL ON FUNCTION composer_owner_api.resolve_strategy_design_native_join_v1(text,integer,bytea,text,bytea,bytea,bytea) FROM PUBLIC, rd_owner, rd_fact_writer;
GRANT EXECUTE ON FUNCTION composer_owner_api.resolve_strategy_design_native_join_v1(text,integer,bytea,text,bytea,bytea,bytea) TO market_data_reader;
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
GRANT EXECUTE ON FUNCTION replay_policy_catalog_api.lock_replay_policy_catalog_census_v2(), replay_policy_catalog_api.lock_replay_policy_catalog_record_v2(text), replay_policy_catalog_api.lock_current_replay_policy_catalog_v2(), replay_policy_catalog_api.read_replay_policy_catalog_audit_v2(text), composer_owner_api.lock_accepted_develop_composer_v2(text) TO rd_owner;
GRANT EXECUTE ON FUNCTION replay_policy_catalog_api.lock_replay_policy_catalog_census_v2(), replay_policy_catalog_api.lock_replay_policy_catalog_record_v2(text), replay_policy_catalog_api.lock_current_replay_policy_catalog_v2(), replay_policy_catalog_api.read_replay_policy_catalog_audit_v2(text), replay_policy_catalog_api.apply_replay_policy_catalog_command_v2(text,text,text,text,text,numeric,text,text,bytea,bytea,bytea,bytea,text,text,jsonb,bigint) TO replay_policy_catalog_admin_writer;
GRANT EXECUTE ON FUNCTION composer_owner_api.commit_develop_composer_v2(text,bytea,bytea,bytea,bytea,bytea,bytea,bytea,bytea,bytea,bytea[],bytea[],bytea[],bytea[],bytea[],bytea,bytea,bytea,bytea,bytea,integer,bytea,text,bytea,bytea,bytea,bytea,bytea,bytea,bytea,bytea,bytea) TO rd_fact_writer;
GRANT EXECUTE ON FUNCTION composer_owner_api.resolve_strategy_design_role_set_attestation_v1(text,integer,bytea,text,bytea,bytea,bytea), composer_owner_api.resolve_strategy_design_native_join_v1(text,integer,bytea,text,bytea,bytea,bytea) TO market_data_reader;
DO $catalog_composer_readback$
DECLARE exact boolean;
BEGIN
  SELECT pg_catalog.pg_get_userbyid(database.datdba)='rd_database_owner'
    AND pg_catalog.has_database_privilege('market_data_reader',database.oid,'CONNECT')
    AND NOT pg_catalog.has_database_privilege('market_data_reader',database.oid,'CREATE,TEMPORARY')
    AND pg_catalog.has_database_privilege('market_data_owner',database.oid,'CONNECT')
    AND NOT pg_catalog.has_database_privilege('market_data_owner',database.oid,'CREATE,TEMPORARY')
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles role WHERE role.rolname IN ('rd_database_owner','replay_policy_catalog_owner','composer_owner') AND (role.rolcanlogin OR role.rolsuper OR role.rolcreatedb OR role.rolcreaterole OR role.rolreplication OR role.rolbypassrls))
    AND EXISTS (SELECT 1 FROM pg_catalog.pg_roles role WHERE role.rolname='replay_policy_catalog_admin_writer' AND role.rolcanlogin AND role.rolinherit AND NOT role.rolsuper AND NOT role.rolcreatedb AND NOT role.rolcreaterole AND NOT role.rolreplication AND NOT role.rolbypassrls)
    AND EXISTS (SELECT 1 FROM pg_catalog.pg_roles role WHERE role.rolname='rd_owner' AND role.rolcanlogin AND role.rolinherit AND NOT role.rolsuper AND NOT role.rolcreatedb AND NOT role.rolcreaterole AND NOT role.rolreplication AND NOT role.rolbypassrls)
    AND EXISTS (SELECT 1 FROM pg_catalog.pg_roles role WHERE role.rolname='rd_fact_writer' AND role.rolcanlogin AND role.rolinherit AND NOT role.rolsuper AND NOT role.rolcreatedb AND NOT role.rolcreaterole AND NOT role.rolreplication AND NOT role.rolbypassrls)
    AND EXISTS (SELECT 1 FROM pg_catalog.pg_roles role WHERE role.rolname='market_data_reader' AND role.rolcanlogin AND role.rolinherit AND NOT role.rolsuper AND NOT role.rolcreatedb AND NOT role.rolcreaterole AND NOT role.rolreplication AND NOT role.rolbypassrls)
    AND EXISTS (SELECT 1 FROM pg_catalog.pg_roles role WHERE role.rolname='market_data_owner' AND role.rolcanlogin AND role.rolinherit AND NOT role.rolsuper AND NOT role.rolcreatedb AND NOT role.rolcreaterole AND NOT role.rolreplication AND NOT role.rolbypassrls)
    AND NOT pg_catalog.pg_has_role('rd_owner','replay_policy_catalog_owner','MEMBER')
    AND NOT pg_catalog.pg_has_role('rd_owner','composer_owner','MEMBER')
    AND NOT pg_catalog.pg_has_role('replay_policy_catalog_owner','rd_owner','MEMBER')
    AND NOT pg_catalog.pg_has_role('composer_owner','rd_owner','MEMBER')
    AND NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_auth_members membership
      JOIN pg_catalog.pg_roles granted ON granted.oid=membership.roleid
      JOIN pg_catalog.pg_roles member ON member.oid=membership.member
      WHERE granted.rolname IN ('rd_database_owner','replay_policy_catalog_owner','replay_policy_catalog_admin_writer','composer_owner','market_data_owner','rd_fact_writer','rd_owner','market_data_reader')
         OR member.rolname IN ('rd_database_owner','replay_policy_catalog_owner','replay_policy_catalog_admin_writer','composer_owner','market_data_owner','rd_fact_writer','rd_owner','market_data_reader')
    )
    AND NOT pg_catalog.has_schema_privilege('rd_owner','replay_policy_catalog_private','USAGE')
    AND NOT pg_catalog.has_schema_privilege('rd_owner','composer_private','USAGE')
    AND NOT pg_catalog.has_schema_privilege('rd_fact_writer','composer_private','USAGE,CREATE')
    AND NOT pg_catalog.has_schema_privilege('market_data_reader','replay_policy_catalog_private','USAGE,CREATE')
    AND NOT pg_catalog.has_schema_privilege('market_data_reader','composer_private','USAGE,CREATE')
    AND NOT pg_catalog.has_schema_privilege('market_data_owner','composer_private','USAGE,CREATE')
    AND NOT pg_catalog.has_schema_privilege('market_data_reader','replay_policy_catalog_api','USAGE')
    AND pg_catalog.has_schema_privilege('market_data_reader','composer_owner_api','USAGE')
    AND pg_catalog.has_schema_privilege('market_data_owner','composer_owner_api','USAGE')
    AND pg_catalog.has_schema_privilege('rd_owner','replay_policy_catalog_api','USAGE')
    AND pg_catalog.has_schema_privilege('rd_owner','composer_owner_api','USAGE')
    AND NOT pg_catalog.has_schema_privilege('rd_fact_writer','replay_policy_catalog_api','USAGE')
    AND pg_catalog.has_schema_privilege('replay_policy_catalog_admin_writer','replay_policy_catalog_api','USAGE')
    AND pg_catalog.has_schema_privilege('rd_fact_writer','composer_owner_api','USAGE')
    AND (SELECT count(*)=4 AND bool_and(relation.relpersistence='p' AND pg_catalog.pg_get_userbyid(relation.relowner)='replay_policy_catalog_owner') AND NOT bool_or(pg_catalog.has_table_privilege('rd_owner',relation.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')) AND NOT bool_or(pg_catalog.has_table_privilege('market_data_reader',relation.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')) FROM pg_catalog.pg_class relation JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace WHERE namespace.nspname='replay_policy_catalog_private' AND relation.relkind='r')
    AND (SELECT count(*)=11 AND bool_and(relation.relpersistence='p' AND pg_catalog.pg_get_userbyid(relation.relowner)='composer_owner') AND NOT bool_or(pg_catalog.has_table_privilege('rd_owner',relation.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')) AND NOT bool_or(pg_catalog.has_table_privilege('rd_fact_writer',relation.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')) AND NOT bool_or(pg_catalog.has_table_privilege('market_data_reader',relation.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')) AND NOT bool_or(pg_catalog.has_table_privilege('market_data_owner',relation.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')) FROM pg_catalog.pg_class relation JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace WHERE namespace.nspname='composer_private' AND relation.relkind='r')
    AND (SELECT count(*)=30 FROM pg_catalog.pg_attribute attribute JOIN pg_catalog.pg_class relation ON relation.oid=attribute.attrelid JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace WHERE namespace.nspname='replay_policy_catalog_private' AND relation.relkind='r' AND attribute.attnum>0 AND NOT attribute.attisdropped)
    AND (SELECT count(*)=46 FROM pg_catalog.pg_attribute attribute JOIN pg_catalog.pg_class relation ON relation.oid=attribute.attrelid JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace WHERE namespace.nspname='composer_private' AND relation.relkind='r' AND attribute.attnum>0 AND NOT attribute.attisdropped)
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class object JOIN pg_catalog.pg_namespace namespace ON namespace.oid=object.relnamespace WHERE namespace.nspname IN ('replay_policy_catalog_private','composer_private') AND object.relkind NOT IN ('r','i'))
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger trigger_fact JOIN pg_catalog.pg_class relation ON relation.oid=trigger_fact.tgrelid JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace WHERE namespace.nspname IN ('replay_policy_catalog_private','composer_private') AND NOT trigger_fact.tgisinternal)
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policy policy JOIN pg_catalog.pg_class relation ON relation.oid=policy.polrelid JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace WHERE namespace.nspname IN ('replay_policy_catalog_private','composer_private'))
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_rewrite rewrite JOIN pg_catalog.pg_class relation ON relation.oid=rewrite.ev_class JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace WHERE namespace.nspname='replay_policy_catalog_private')
    AND (SELECT count(*)=5 AND bool_and(procedure.oid IN (
      pg_catalog.to_regprocedure('replay_policy_catalog_api.lock_replay_policy_catalog_census_v2()'),
      pg_catalog.to_regprocedure('replay_policy_catalog_api.lock_replay_policy_catalog_record_v2(text)'),
      pg_catalog.to_regprocedure('replay_policy_catalog_api.lock_current_replay_policy_catalog_v2()'),
      pg_catalog.to_regprocedure('replay_policy_catalog_api.read_replay_policy_catalog_audit_v2(text)'),
      pg_catalog.to_regprocedure('replay_policy_catalog_api.apply_replay_policy_catalog_command_v2(text,text,text,text,text,numeric,text,text,bytea,bytea,bytea,bytea,text,text,jsonb,bigint)')
    )) FROM pg_catalog.pg_proc procedure JOIN pg_catalog.pg_namespace namespace ON namespace.oid=procedure.pronamespace WHERE namespace.nspname='replay_policy_catalog_api')
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc procedure JOIN pg_catalog.pg_namespace namespace ON namespace.oid=procedure.pronamespace WHERE namespace.nspname='replay_policy_catalog_api' AND pg_catalog.has_function_privilege('market_data_reader',procedure.oid,'EXECUTE'))
    AND (SELECT count(*)=1 AND bool_and(
      pg_catalog.pg_get_userbyid(procedure.proowner)='replay_policy_catalog_owner'
      AND procedure.prosecdef AND procedure.provolatile='v' AND procedure.proparallel='u'
      AND procedure.proisstrict AND procedure.proretset
      AND procedure.proconfig=ARRAY['search_path=pg_catalog, pg_temp']::text[]
      AND procedure.prosrc=$catalog_audit_read$
  SELECT audit.administrator_identity, audit.authentication_fact_digest, audit.command_kind,
    audit.predecessor_record_id, audit.predecessor_head_record_id, audit.result_record_id,
    audit.content_identity, audit.audit_json, audit.committed_at_epoch_ms
  FROM replay_policy_catalog_private.rd_replay_policy_catalog_audit_v2 audit
  WHERE audit.command_identity=p_command_identity
$catalog_audit_read$
    ) FROM pg_catalog.pg_proc procedure JOIN pg_catalog.pg_namespace namespace ON namespace.oid=procedure.pronamespace
      WHERE namespace.nspname='replay_policy_catalog_api' AND procedure.proname='read_replay_policy_catalog_audit_v2')
    AND (SELECT count(*)=5 AND bool_and(procedure.oid IN (
      pg_catalog.to_regprocedure('composer_owner_api.commit_develop_composer_v2(text,bytea,bytea,bytea,bytea,bytea,bytea,bytea,bytea,bytea,bytea[],bytea[],bytea[],bytea[],bytea[],bytea,bytea,bytea,bytea,bytea,integer,bytea,text,bytea,bytea,bytea,bytea,bytea,bytea,bytea,bytea,bytea)'),
      pg_catalog.to_regprocedure('composer_owner_api.lock_accepted_develop_composer_v2(text)'),
      pg_catalog.to_regprocedure('composer_owner_api.lock_replay_composition_cut_v1(text)'),
      pg_catalog.to_regprocedure('composer_owner_api.resolve_strategy_design_role_set_attestation_v1(text,integer,bytea,text,bytea,bytea,bytea)'),
      pg_catalog.to_regprocedure('composer_owner_api.resolve_strategy_design_native_join_v1(text,integer,bytea,text,bytea,bytea,bytea)')
    )) FROM pg_catalog.pg_proc procedure JOIN pg_catalog.pg_namespace namespace ON namespace.oid=procedure.pronamespace WHERE namespace.nspname='composer_owner_api')
    AND pg_catalog.has_function_privilege('rd_owner','replay_policy_catalog_api.lock_replay_policy_catalog_record_v2(text)','EXECUTE')
    AND pg_catalog.has_function_privilege('rd_owner','replay_policy_catalog_api.lock_current_replay_policy_catalog_v2()','EXECUTE')
    AND pg_catalog.has_function_privilege('rd_owner','replay_policy_catalog_api.lock_replay_policy_catalog_census_v2()','EXECUTE')
    AND NOT pg_catalog.has_function_privilege('rd_owner','replay_policy_catalog_api.apply_replay_policy_catalog_command_v2(text,text,text,text,text,numeric,text,text,bytea,bytea,bytea,bytea,text,text,jsonb,bigint)','EXECUTE')
    AND pg_catalog.has_function_privilege('rd_owner','replay_policy_catalog_api.read_replay_policy_catalog_audit_v2(text)','EXECUTE')
    AND NOT pg_catalog.has_function_privilege('rd_owner','composer_owner_api.commit_develop_composer_v2(text,bytea,bytea,bytea,bytea,bytea,bytea,bytea,bytea,bytea,bytea[],bytea[],bytea[],bytea[],bytea[],bytea,bytea,bytea,bytea,bytea,integer,bytea,text,bytea,bytea,bytea,bytea,bytea,bytea,bytea,bytea,bytea)','EXECUTE')
    AND NOT pg_catalog.has_function_privilege('rd_fact_writer','replay_policy_catalog_api.apply_replay_policy_catalog_command_v2(text,text,text,text,text,numeric,text,text,bytea,bytea,bytea,bytea,text,text,jsonb,bigint)','EXECUTE')
    AND NOT pg_catalog.has_function_privilege('rd_fact_writer','replay_policy_catalog_api.read_replay_policy_catalog_audit_v2(text)','EXECUTE')
    AND pg_catalog.has_function_privilege('replay_policy_catalog_admin_writer','replay_policy_catalog_api.apply_replay_policy_catalog_command_v2(text,text,text,text,text,numeric,text,text,bytea,bytea,bytea,bytea,text,text,jsonb,bigint)','EXECUTE')
    AND pg_catalog.has_function_privilege('replay_policy_catalog_admin_writer','replay_policy_catalog_api.read_replay_policy_catalog_audit_v2(text)','EXECUTE')
    AND pg_catalog.has_function_privilege('rd_fact_writer','composer_owner_api.commit_develop_composer_v2(text,bytea,bytea,bytea,bytea,bytea,bytea,bytea,bytea,bytea,bytea[],bytea[],bytea[],bytea[],bytea[],bytea,bytea,bytea,bytea,bytea,integer,bytea,text,bytea,bytea,bytea,bytea,bytea,bytea,bytea,bytea,bytea)','EXECUTE')
    AND pg_catalog.has_function_privilege('rd_owner','composer_owner_api.lock_accepted_develop_composer_v2(text)','EXECUTE')
    AND NOT pg_catalog.has_function_privilege('rd_fact_writer','composer_owner_api.lock_accepted_develop_composer_v2(text)','EXECUTE')
    AND NOT pg_catalog.has_function_privilege('rd_owner','composer_owner_api.resolve_strategy_design_role_set_attestation_v1(text,integer,bytea,text,bytea,bytea,bytea)','EXECUTE')
    AND NOT pg_catalog.has_function_privilege('rd_owner','composer_owner_api.resolve_strategy_design_native_join_v1(text,integer,bytea,text,bytea,bytea,bytea)','EXECUTE')
    AND NOT pg_catalog.has_function_privilege('rd_fact_writer','composer_owner_api.resolve_strategy_design_role_set_attestation_v1(text,integer,bytea,text,bytea,bytea,bytea)','EXECUTE')
    AND NOT pg_catalog.has_function_privilege('rd_fact_writer','composer_owner_api.resolve_strategy_design_native_join_v1(text,integer,bytea,text,bytea,bytea,bytea)','EXECUTE')
    AND pg_catalog.has_function_privilege('market_data_reader','composer_owner_api.resolve_strategy_design_role_set_attestation_v1(text,integer,bytea,text,bytea,bytea,bytea)','EXECUTE')
    AND pg_catalog.has_function_privilege('market_data_reader','composer_owner_api.resolve_strategy_design_native_join_v1(text,integer,bytea,text,bytea,bytea,bytea)','EXECUTE')
    AND pg_catalog.has_function_privilege('market_data_reader','composer_owner_api.lock_replay_composition_cut_v1(text)','EXECUTE')
    AND pg_catalog.has_function_privilege('market_data_owner','composer_owner_api.lock_replay_composition_cut_v1(text)','EXECUTE')
    AND NOT pg_catalog.has_function_privilege('market_data_owner','composer_owner_api.resolve_strategy_design_role_set_attestation_v1(text,integer,bytea,text,bytea,bytea,bytea)','EXECUTE')
    AND NOT pg_catalog.has_function_privilege('market_data_owner','composer_owner_api.resolve_strategy_design_native_join_v1(text,integer,bytea,text,bytea,bytea,bytea)','EXECUTE')
    AND NOT pg_catalog.has_function_privilege('market_data_reader','composer_owner_api.commit_develop_composer_v2(text,bytea,bytea,bytea,bytea,bytea,bytea,bytea,bytea,bytea,bytea[],bytea[],bytea[],bytea[],bytea[],bytea,bytea,bytea,bytea,bytea,integer,bytea,text,bytea,bytea,bytea,bytea,bytea,bytea,bytea,bytea,bytea)','EXECUTE')
    AND NOT pg_catalog.has_function_privilege('market_data_reader','composer_owner_api.lock_accepted_develop_composer_v2(text)','EXECUTE')
    AND NOT pg_catalog.has_table_privilege('market_data_reader','composer_private.rd_develop_strategy_design_role_set_attestations_v1','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    AND NOT pg_catalog.has_table_privilege('market_data_reader','composer_private.rd_develop_strategy_design_native_joins_v1','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
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
    ('composer_private','rd_develop_composer_receipts_v2','p','artifact_identity'),('composer_private','rd_develop_host_receipts_v2','p','artifact_identity'),('composer_private','rd_develop_operations_v2','p','request_identity'),('composer_private','rd_develop_operations_v2','u','research_request_identity'),('composer_private','rd_develop_operations_v2','u','intent_identity'),('composer_private','rd_develop_operations_v2','u','artifact_identity'),
    ('composer_private','rd_develop_strategy_design_role_set_attestations_v1','p','request_identity'),('composer_private','rd_develop_strategy_design_role_set_attestations_v1','u','operation_receipt_identity'),('composer_private','rd_develop_strategy_design_role_set_attestations_v1','u','artifact_identity'),('composer_private','rd_develop_strategy_design_role_set_attestations_v1','u','canonical_plan_digest'),('composer_private','rd_develop_strategy_design_role_set_attestations_v1','u','attestation_identity'),('composer_private','rd_develop_strategy_design_role_set_attestations_v1','u','attestation_digest'),('composer_private','rd_develop_strategy_design_role_set_attestations_v1','u','request_identity,composer_schema_version,operation_receipt_identity,artifact_locator,artifact_identity,canonical_plan_digest,design_digest'),
    ('composer_private','rd_develop_strategy_design_native_joins_v1','p','request_identity'),('composer_private','rd_develop_strategy_design_native_joins_v1','u','native_join_digest'),('composer_private','rd_develop_strategy_design_native_joins_v1','u','projection_receipt_digest'),('composer_private','rd_develop_outbox_v2','p','request_identity')
  ), actual AS (
    SELECT namespace.nspname,relation.relname,constraint_fact.contype::text,string_agg(attribute.attname,',' ORDER BY key_position.ordinality)
    FROM pg_catalog.pg_constraint constraint_fact JOIN pg_catalog.pg_class relation ON relation.oid=constraint_fact.conrelid JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace
    CROSS JOIN LATERAL unnest(constraint_fact.conkey::smallint[]) WITH ORDINALITY key_position(attnum,ordinality) JOIN pg_catalog.pg_attribute attribute ON attribute.attrelid=relation.oid AND attribute.attnum=key_position.attnum
    WHERE namespace.nspname IN ('replay_policy_catalog_private','composer_private') AND constraint_fact.contype IN ('p','u') GROUP BY namespace.nspname,relation.relname,constraint_fact.oid
  ) SELECT NOT EXISTS((SELECT * FROM expected EXCEPT SELECT * FROM actual) UNION ALL (SELECT * FROM actual EXCEPT SELECT * FROM expected)) INTO exact;
  IF exact IS DISTINCT FROM true THEN RAISE EXCEPTION 'Catalog/Composer primary or unique manifest mismatch'; END IF;

  WITH expected(source_schema,source_table,source_keys,target_schema,target_table,target_keys) AS (VALUES
    ('replay_policy_catalog_private','rd_replay_policy_catalog_records_v2','predecessor_record_id','replay_policy_catalog_private','rd_replay_policy_catalog_records_v2','catalog_record_id'),('replay_policy_catalog_private','rd_replay_policy_catalog_head_v2','catalog_record_id','replay_policy_catalog_private','rd_replay_policy_catalog_records_v2','catalog_record_id'),('replay_policy_catalog_private','rd_replay_policy_catalog_revocations_v2','catalog_record_id','replay_policy_catalog_private','rd_replay_policy_catalog_records_v2','catalog_record_id'),
    ('composer_private','rd_develop_plans_v2','design_identity','composer_private','rd_develop_designs_v2','design_identity'),('composer_private','rd_develop_artifacts_v2','plan_digest','composer_private','rd_develop_plans_v2','plan_digest'),('composer_private','rd_develop_artifact_modules_v2','artifact_identity','composer_private','rd_develop_artifacts_v2','artifact_identity'),('composer_private','rd_develop_build_receipts_v2','artifact_identity','composer_private','rd_develop_artifacts_v2','artifact_identity'),('composer_private','rd_develop_composer_receipts_v2','artifact_identity','composer_private','rd_develop_artifacts_v2','artifact_identity'),('composer_private','rd_develop_host_receipts_v2','artifact_identity','composer_private','rd_develop_artifacts_v2','artifact_identity'),('composer_private','rd_develop_operations_v2','artifact_identity','composer_private','rd_develop_artifacts_v2','artifact_identity'),('composer_private','rd_develop_strategy_design_role_set_attestations_v1','request_identity','composer_private','rd_develop_operations_v2','request_identity'),('composer_private','rd_develop_strategy_design_native_joins_v1','request_identity','composer_private','rd_develop_operations_v2','request_identity'),('composer_private','rd_develop_outbox_v2','request_identity','composer_private','rd_develop_operations_v2','request_identity')
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

  SELECT count(*)=37 AND bool_and(index_fact.indisvalid AND index_fact.indisready AND index_fact.indislive AND index_fact.indisunique AND NOT index_fact.indnullsnotdistinct AND index_fact.indexprs IS NULL AND index_fact.indpred IS NULL AND index_method.amname='btree' AND index_relation.relpersistence='p' AND index_relation.reltablespace=0 AND index_relation.reloptions IS NULL AND pg_catalog.pg_get_userbyid(index_relation.relowner) IN ('replay_policy_catalog_owner','composer_owner') AND EXISTS(SELECT 1 FROM pg_catalog.pg_constraint constraint_fact WHERE constraint_fact.conindid=index_relation.oid) AND NOT EXISTS(SELECT 1 FROM unnest(index_fact.indclass::oid[]) class_oid JOIN pg_catalog.pg_opclass operator_class ON operator_class.oid=class_oid WHERE NOT operator_class.opcdefault) AND NOT EXISTS(SELECT 1 FROM unnest(index_fact.indoption::smallint[]) option_value WHERE option_value<>0) AND NOT EXISTS(SELECT 1 FROM unnest(index_fact.indkey::smallint[],index_fact.indcollation::oid[]) key_fact(attnum,collation_oid) JOIN pg_catalog.pg_attribute attribute ON attribute.attrelid=index_fact.indrelid AND attribute.attnum=key_fact.attnum WHERE key_fact.collation_oid<>attribute.attcollation))
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
