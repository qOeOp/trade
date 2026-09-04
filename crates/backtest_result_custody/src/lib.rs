//! Locked, dependency-neutral R&D reads of Backtest-owned Replay V2 results.
//!
//! The locator and PostgreSQL envelope are untrusted. A positive value is created only after this
//! crate validates the fixed topology and the complete Result/receipt/outbox aggregate inside the
//! transaction supplied by the caller.

use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use serde::{Deserialize, Serialize};
use sqlx::{Postgres, Transaction};
use thiserror::Error;
use vibe_backtest_owner_contracts::{
    CanonicalDigestV2, OpaqueIdentityV2, ReplayNamespaceV2, ReplayResultDtoV2, ReplayTerminalV2,
};

const RESOLVE_FUNCTION: &str =
    "backtest_owner_api.resolve_exploratory_replay_result_v2(text,text,text)";
const AUTHORITY_LOCK_FUNCTION: &str = "backtest_authority_lock_api.lock_authority_catalogs_v1()";
const TOPOLOGY_FENCE: &str = "vibe.backtest.result-topology.v2";
const AUTHORITY_LOCK_FUNCTION_SOURCE: &str = "BEGIN LOCK TABLE pg_catalog.pg_authid, pg_catalog.pg_auth_members IN SHARE MODE; RETURN true; END";
const FUNCTION_SOURCE: &str = "DECLARE locked_result public.backtest_replay_results_v2%ROWTYPE; locked_receipt public.backtest_replay_result_receipts_v1%ROWTYPE; locked_outbox public.backtest_replay_result_outbox_v1%ROWTYPE; BEGIN SELECT result.* INTO locked_result FROM public.backtest_replay_results_v2 result WHERE result.result_identity=p_result_identity AND result.request_identity=p_request_identity AND result.attempt_identity=p_attempt_identity FOR SHARE; IF NOT FOUND THEN RETURN NULL; END IF; SELECT receipt.* INTO locked_receipt FROM public.backtest_replay_result_receipts_v1 receipt WHERE receipt.result_identity=p_result_identity FOR SHARE; IF NOT FOUND THEN RETURN NULL; END IF; SELECT outbox.* INTO locked_outbox FROM public.backtest_replay_result_outbox_v1 outbox WHERE outbox.result_identity=p_result_identity FOR SHARE; IF NOT FOUND THEN RETURN NULL; END IF; RETURN pg_catalog.jsonb_build_object('schema_version',2,'result',pg_catalog.jsonb_build_object('result_identity',locked_result.result_identity,'result_digest',locked_result.result_digest,'request_identity',locked_result.request_identity,'request_meaning_digest',locked_result.request_meaning_digest,'attempt_identity',locked_result.attempt_identity,'terminal',locked_result.terminal,'canonical_bytes_base64',pg_catalog.encode(locked_result.canonical_bytes,'base64'),'canonical_bytes_blake3',locked_result.canonical_bytes_blake3),'receipt',pg_catalog.jsonb_build_object('result_identity',locked_receipt.result_identity,'receipt_identity',locked_receipt.receipt_identity,'receipt_digest',locked_receipt.receipt_digest,'request_identity',locked_receipt.request_identity,'request_meaning_digest',locked_receipt.request_meaning_digest,'result_digest',locked_receipt.result_digest,'namespace',locked_receipt.namespace,'outbox_event_identity',locked_receipt.outbox_event_identity,'committed_at_epoch_ms',locked_receipt.committed_at_epoch_ms,'canonical_bytes_base64',pg_catalog.encode(locked_receipt.canonical_bytes,'base64'),'canonical_bytes_blake3',locked_receipt.canonical_bytes_blake3),'outbox',pg_catalog.jsonb_build_object('result_identity',locked_outbox.result_identity,'event_identity',locked_outbox.event_identity,'event_digest',locked_outbox.event_digest,'receipt_identity',locked_outbox.receipt_identity,'request_identity',locked_outbox.request_identity,'request_meaning_digest',locked_outbox.request_meaning_digest,'result_digest',locked_outbox.result_digest,'namespace',locked_outbox.namespace,'payload_digest',locked_outbox.payload_digest,'committed_at_epoch_ms',locked_outbox.committed_at_epoch_ms,'canonical_bytes_base64',pg_catalog.encode(locked_outbox.canonical_bytes,'base64'),'canonical_bytes_blake3',locked_outbox.canonical_bytes_blake3)); END";
const RESULT_STORAGE_DOMAIN: &str = "vibe.backtest.replay-result-storage.v2";
const RECEIPT_STORAGE_DOMAIN: &str = "vibe.backtest.result-receipt-storage.v1";
const OUTBOX_STORAGE_DOMAIN: &str = "vibe.backtest.result-outbox-storage.v1";
const RECEIPT_DIGEST_DOMAIN: &str = "vibe.backtest.result-receipt.v1";
const OUTBOX_PAYLOAD_DIGEST_DOMAIN: &str = "vibe.backtest.result-outbox-payload.v1";
const OUTBOX_EVENT_DIGEST_DOMAIN: &str = "vibe.backtest.result-outbox-event.v1";
const EVENT_KIND: &str = "EXPLORATORY_BACKTEST_RESULT_COMMITTED_V1";
const RESULT_TABLE_CENSUS_QUERY: &str = "
WITH family AS (
  SELECT relation.oid,relation.relname
    FROM pg_catalog.pg_class relation
    JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace
   WHERE namespace.nspname='public'
     AND relation.relname IN (
       'backtest_replay_results_v2',
       'backtest_replay_result_receipts_v1',
       'backtest_replay_result_outbox_v1'
     )
)
SELECT
  (SELECT pg_catalog.count(*)=3 AND pg_catalog.bool_and(
            relation.relkind='r'
        AND relation.relpersistence='p'
        AND access_method.amname='heap'
        AND pg_catalog.pg_get_userbyid(relation.relowner)='backtest_custodian'
        AND NOT relation.relrowsecurity
        AND NOT relation.relforcerowsecurity
        AND relation.relreplident='d'
        AND NOT relation.relispartition
        AND relation.reltablespace=0
        AND relation.reloptions IS NULL
      )
     FROM family
     JOIN pg_catalog.pg_class relation ON relation.oid=family.oid
     JOIN pg_catalog.pg_am access_method ON access_method.oid=relation.relam)
  AND NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class relation
      JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace
     WHERE namespace.nspname<>'public'
       AND relation.relname IN (
         'backtest_replay_results_v2',
         'backtest_replay_result_receipts_v1',
         'backtest_replay_result_outbox_v1'
       )
  )
  AND (SELECT pg_catalog.count(*)=31 AND NOT pg_catalog.bool_or(
        (family.relname,attribute.attnum,attribute.attname,
         pg_catalog.format_type(attribute.atttypid,attribute.atttypmod),attribute.attnotnull)
        NOT IN (VALUES
          ('backtest_replay_results_v2',1::smallint,'result_identity','text',true),
          ('backtest_replay_results_v2',2::smallint,'result_digest','text',true),
          ('backtest_replay_results_v2',3::smallint,'request_identity','text',true),
          ('backtest_replay_results_v2',4::smallint,'request_meaning_digest','text',true),
          ('backtest_replay_results_v2',5::smallint,'attempt_identity','text',true),
          ('backtest_replay_results_v2',6::smallint,'terminal','text',true),
          ('backtest_replay_results_v2',7::smallint,'canonical_bytes','bytea',true),
          ('backtest_replay_results_v2',8::smallint,'canonical_bytes_blake3','text',true),
          ('backtest_replay_result_receipts_v1',1::smallint,'result_identity','text',true),
          ('backtest_replay_result_receipts_v1',2::smallint,'receipt_identity','text',true),
          ('backtest_replay_result_receipts_v1',3::smallint,'receipt_digest','text',true),
          ('backtest_replay_result_receipts_v1',4::smallint,'request_identity','text',true),
          ('backtest_replay_result_receipts_v1',5::smallint,'request_meaning_digest','text',true),
          ('backtest_replay_result_receipts_v1',6::smallint,'result_digest','text',true),
          ('backtest_replay_result_receipts_v1',7::smallint,'namespace','text',true),
          ('backtest_replay_result_receipts_v1',8::smallint,'outbox_event_identity','text',true),
          ('backtest_replay_result_receipts_v1',9::smallint,'committed_at_epoch_ms','bigint',true),
          ('backtest_replay_result_receipts_v1',10::smallint,'canonical_bytes','bytea',true),
          ('backtest_replay_result_receipts_v1',11::smallint,'canonical_bytes_blake3','text',true),
          ('backtest_replay_result_outbox_v1',1::smallint,'result_identity','text',true),
          ('backtest_replay_result_outbox_v1',2::smallint,'event_identity','text',true),
          ('backtest_replay_result_outbox_v1',3::smallint,'event_digest','text',true),
          ('backtest_replay_result_outbox_v1',4::smallint,'receipt_identity','text',true),
          ('backtest_replay_result_outbox_v1',5::smallint,'request_identity','text',true),
          ('backtest_replay_result_outbox_v1',6::smallint,'request_meaning_digest','text',true),
          ('backtest_replay_result_outbox_v1',7::smallint,'result_digest','text',true),
          ('backtest_replay_result_outbox_v1',8::smallint,'namespace','text',true),
          ('backtest_replay_result_outbox_v1',9::smallint,'payload_digest','text',true),
          ('backtest_replay_result_outbox_v1',10::smallint,'committed_at_epoch_ms','bigint',true),
          ('backtest_replay_result_outbox_v1',11::smallint,'canonical_bytes','bytea',true),
          ('backtest_replay_result_outbox_v1',12::smallint,'canonical_bytes_blake3','text',true)
        )
        OR attribute.atthasdef
        OR attribute.attidentity<>''
        OR attribute.attgenerated<>''
        OR attribute.attacl IS NOT NULL
        OR attribute.attcollation<>attribute_type.typcollation
        OR attribute.attndims<>0
        OR NOT attribute.attislocal
        OR attribute.attinhcount<>0
      )
     FROM family
     JOIN pg_catalog.pg_attribute attribute
       ON attribute.attrelid=family.oid AND attribute.attnum>0 AND NOT attribute.attisdropped
     JOIN pg_catalog.pg_type attribute_type ON attribute_type.oid=attribute.atttypid)
  AND NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute attribute
     WHERE attribute.attrelid IN (SELECT oid FROM family)
       AND attribute.attnum>0 AND attribute.attisdropped
  )
  AND (SELECT pg_catalog.count(*)=8 AND NOT pg_catalog.bool_or(
        (family.relname,constraint_fact.contype::pg_catalog.text,
         pg_catalog.array_to_string(constraint_fact.conkey,' '))
        NOT IN (VALUES
          ('backtest_replay_results_v2','p','1'),
          ('backtest_replay_results_v2','u','3 5'),
          ('backtest_replay_result_receipts_v1','p','1'),
          ('backtest_replay_result_receipts_v1','u','2'),
          ('backtest_replay_result_receipts_v1','u','8'),
          ('backtest_replay_result_outbox_v1','p','1'),
          ('backtest_replay_result_outbox_v1','u','2'),
          ('backtest_replay_result_outbox_v1','u','4')
        )
        OR constraint_fact.condeferrable
        OR constraint_fact.condeferred
        OR NOT constraint_fact.convalidated
        OR NOT constraint_fact.connoinherit
        OR NOT constraint_fact.conislocal
        OR constraint_fact.coninhcount<>0
      )
     FROM pg_catalog.pg_constraint constraint_fact
     JOIN family ON family.oid=constraint_fact.conrelid
    WHERE constraint_fact.contype IN ('p','u'))
  AND (SELECT pg_catalog.count(*)=5 AND NOT pg_catalog.bool_or(
        (family.relname,pg_catalog.pg_get_expr(
          constraint_fact.conbin,constraint_fact.conrelid,false
        ))
        NOT IN (VALUES
          ('backtest_replay_results_v2',
           '(terminal = ANY (ARRAY[''RUN_REJECTED''::text, ''TERMINAL_RESULT''::text, ''INVALID_REPLAY_EVIDENCE''::text]))'),
          ('backtest_replay_result_receipts_v1','(namespace = ''EXPLORATORY''::text)'),
          ('backtest_replay_result_receipts_v1','(committed_at_epoch_ms >= 0)'),
          ('backtest_replay_result_outbox_v1','(namespace = ''EXPLORATORY''::text)'),
          ('backtest_replay_result_outbox_v1','(committed_at_epoch_ms >= 0)')
        )
        OR constraint_fact.condeferrable
        OR constraint_fact.condeferred
        OR NOT constraint_fact.convalidated
        OR constraint_fact.connoinherit
        OR NOT constraint_fact.conislocal
        OR constraint_fact.coninhcount<>0
      )
     FROM pg_catalog.pg_constraint constraint_fact
     JOIN family ON family.oid=constraint_fact.conrelid
    WHERE constraint_fact.contype='c')
  AND NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint constraint_fact
     WHERE constraint_fact.conrelid IN (SELECT oid FROM family)
       AND constraint_fact.contype NOT IN ('p','u','c')
  )
  AND NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint constraint_fact
     WHERE constraint_fact.confrelid IN (SELECT oid FROM family)
  )
  AND (SELECT pg_catalog.count(*)=8 AND NOT pg_catalog.bool_or(
        (family.relname,index_fact.indisprimary,
         pg_catalog.array_to_string(index_fact.indkey::smallint[],' '))
        NOT IN (VALUES
          ('backtest_replay_results_v2',true,'1'),
          ('backtest_replay_results_v2',false,'3 5'),
          ('backtest_replay_result_receipts_v1',true,'1'),
          ('backtest_replay_result_receipts_v1',false,'2'),
          ('backtest_replay_result_receipts_v1',false,'8'),
          ('backtest_replay_result_outbox_v1',true,'1'),
          ('backtest_replay_result_outbox_v1',false,'2'),
          ('backtest_replay_result_outbox_v1',false,'4')
        )
        OR NOT index_fact.indisunique
        OR index_fact.indisexclusion
        OR NOT index_fact.indimmediate
        OR index_fact.indisclustered
        OR NOT index_fact.indisvalid
        OR NOT index_fact.indisready
        OR NOT index_fact.indislive
        OR index_fact.indisreplident
        OR index_fact.indnullsnotdistinct
        OR index_fact.indnkeyatts<>index_fact.indnatts
        OR index_fact.indexprs IS NOT NULL
        OR index_fact.indpred IS NOT NULL
        OR index_relation.relkind<>'i'
        OR index_relation.relpersistence<>'p'
        OR index_relation.reltablespace<>0
        OR index_relation.reloptions IS NOT NULL
        OR pg_catalog.pg_get_userbyid(index_relation.relowner)<>'backtest_custodian'
        OR index_method.amname<>'btree'
        OR NOT EXISTS (
          SELECT 1 FROM pg_catalog.pg_constraint constraint_fact
           WHERE constraint_fact.conindid=index_relation.oid
        )
        OR EXISTS (
          SELECT 1 FROM pg_catalog.unnest(index_fact.indoption::smallint[]) option_value
           WHERE option_value<>0
        )
        OR EXISTS (
          SELECT 1
            FROM pg_catalog.unnest(index_fact.indclass::oid[]) class_oid
            JOIN pg_catalog.pg_opclass operator_class ON operator_class.oid=class_oid
           WHERE NOT operator_class.opcdefault
        )
        OR EXISTS (
          SELECT 1
            FROM pg_catalog.unnest(index_fact.indkey::smallint[])
                 WITH ORDINALITY key_fact(attnum,ordinality)
            JOIN pg_catalog.unnest(index_fact.indcollation::oid[])
                 WITH ORDINALITY collation_fact(collation_oid,ordinality)
              USING(ordinality)
            JOIN pg_catalog.pg_attribute attribute
              ON attribute.attrelid=index_fact.indrelid AND attribute.attnum=key_fact.attnum
           WHERE collation_fact.collation_oid<>attribute.attcollation
        )
      )
     FROM pg_catalog.pg_index index_fact
     JOIN family ON family.oid=index_fact.indrelid
     JOIN pg_catalog.pg_class index_relation ON index_relation.oid=index_fact.indexrelid
     JOIN pg_catalog.pg_am index_method ON index_method.oid=index_relation.relam)
  AND NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger trigger_fact
     WHERE trigger_fact.tgrelid IN (SELECT oid FROM family)
  )
  AND NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policy policy
     WHERE policy.polrelid IN (SELECT oid FROM family)
  )
  AND NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_rewrite rewrite
     WHERE rewrite.ev_class IN (SELECT oid FROM family)
  )
  AND NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_inherits inheritance
     WHERE inheritance.inhrelid IN (SELECT oid FROM family)
        OR inheritance.inhparent IN (SELECT oid FROM family)
  )
  AND NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_publication_rel publication
     WHERE publication.prrelid IN (SELECT oid FROM family)
  )
  AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_publication publication WHERE publication.puballtables)
  AND NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_publication_namespace publication_namespace
     JOIN pg_catalog.pg_namespace namespace ON namespace.oid=publication_namespace.pnnspid
    WHERE namespace.nspname='public'
  )
  AND NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_statistic_ext statistic
     WHERE statistic.stxrelid IN (SELECT oid FROM family)
  )
";

/// A caller-owned lookup. It carries no Result authority.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ExploratoryReplayResultLocatorV2<'a> {
    pub result_identity: &'a str,
    pub request_identity: &'a str,
    pub attempt_identity: &'a str,
}

/// Fail-closed locked-read errors.
#[derive(Debug, Error)]
pub enum BacktestResultCustodyErrorV2 {
    #[error("Backtest Replay V2 result custody unavailable")]
    Unavailable,
    #[error("Backtest Replay V2 result custody storage unavailable: {0}")]
    Storage(String),
}

/// Move-only positive Backtest custody readback.
///
/// It has no public constructor and is not deserializable; caller bytes cannot create one.
#[derive(Debug)]
pub struct LockedExploratoryReplayResultV2 {
    result: ReplayResultDtoV2,
    result_canonical_bytes: Vec<u8>,
    receipt_canonical_bytes: Vec<u8>,
    outbox_canonical_bytes: Vec<u8>,
}

impl LockedExploratoryReplayResultV2 {
    #[must_use]
    pub const fn result(&self) -> &ReplayResultDtoV2 {
        &self.result
    }

    #[must_use]
    pub fn result_canonical_bytes(&self) -> &[u8] {
        &self.result_canonical_bytes
    }

    #[must_use]
    pub fn receipt_canonical_bytes(&self) -> &[u8] {
        &self.receipt_canonical_bytes
    }

    #[must_use]
    pub fn outbox_canonical_bytes(&self) -> &[u8] {
        &self.outbox_canonical_bytes
    }
}

/// Resolves one complete aggregate under locks held by the caller's existing R&D transaction.
pub async fn resolve_exploratory_replay_result_v2(
    transaction: &mut Transaction<'_, Postgres>,
    locator: ExploratoryReplayResultLocatorV2<'_>,
) -> Result<Option<LockedExploratoryReplayResultV2>, BacktestResultCustodyErrorV2> {
    if locator.result_identity.trim().is_empty()
        || locator.request_identity.trim().is_empty()
        || locator.attempt_identity.trim().is_empty()
    {
        return Err(BacktestResultCustodyErrorV2::Unavailable);
    }
    acquire_topology_fence(transaction).await?;
    validate_topology(transaction, "rd_owner").await?;
    let envelope: Option<serde_json::Value> = sqlx::query_scalar(
        "SELECT backtest_owner_api.resolve_exploratory_replay_result_v2($1,$2,$3)",
    )
    .bind(locator.result_identity)
    .bind(locator.request_identity)
    .bind(locator.attempt_identity)
    .fetch_one(&mut **transaction)
    .await
    .map_err(|e| storage(&e))?;
    envelope
        .map(|value| validate_envelope(value, locator))
        .transpose()
}

/// Validates the exact append-only writer topology in the supplied Backtest transaction.
pub async fn validate_backtest_result_writer_topology_v2(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<(), BacktestResultCustodyErrorV2> {
    acquire_topology_fence(transaction).await?;
    sqlx::query(
        "LOCK TABLE public.backtest_replay_results_v2, public.backtest_replay_result_receipts_v1, public.backtest_replay_result_outbox_v1 IN ROW EXCLUSIVE MODE",
    )
    .execute(&mut **transaction)
    .await
    .map_err(|e| storage(&e))?;
    validate_topology(transaction, "backtest_owner").await?;
    Ok(())
}

async fn acquire_topology_fence(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<(), BacktestResultCustodyErrorV2> {
    sqlx::query(
        "SELECT pg_catalog.pg_advisory_xact_lock_shared(pg_catalog.hashtextextended($1,0))",
    )
    .bind(TOPOLOGY_FENCE)
    .execute(&mut **transaction)
    .await
    .map_err(|e| storage(&e))?;
    let exact_lock: bool = sqlx::query_scalar(
        "SELECT CASE WHEN
          (SELECT pg_catalog.pg_get_userbyid(procedure.proowner)='postgres'
             AND language.lanname='plpgsql' AND procedure.prokind='f' AND NOT procedure.proleakproof
             AND procedure.prorettype='boolean'::pg_catalog.regtype
             AND procedure.pronargs=0 AND procedure.prosecdef AND procedure.proisstrict
             AND procedure.provolatile='v' AND procedure.proparallel='u'
             AND procedure.proconfig=ARRAY['search_path=pg_catalog, pg_temp']::text[]
             AND procedure.prosrc=$1
             AND (SELECT pg_catalog.pg_get_userbyid(namespace.nspowner)='postgres'
                    AND (SELECT pg_catalog.count(*)=2 AND pg_catalog.bool_and(
                           role.rolname IN ('rd_owner','backtest_owner')
                           AND acl.privilege_type='USAGE' AND NOT acl.is_grantable
                           AND pg_catalog.pg_get_userbyid(acl.grantor)='postgres'
                         )
                           FROM pg_catalog.aclexplode(COALESCE(namespace.nspacl,pg_catalog.acldefault('n',namespace.nspowner))) acl
                           LEFT JOIN pg_catalog.pg_roles role ON role.oid=acl.grantee
                          WHERE acl.grantee<>namespace.nspowner)
                    AND NOT EXISTS (
                          SELECT relation.oid FROM pg_catalog.pg_class relation WHERE relation.relnamespace=namespace.oid
                          UNION ALL SELECT data_type.oid FROM pg_catalog.pg_type data_type WHERE data_type.typnamespace=namespace.oid
                          UNION ALL SELECT operator.oid FROM pg_catalog.pg_operator operator WHERE operator.oprnamespace=namespace.oid
                          UNION ALL SELECT operator_class.oid FROM pg_catalog.pg_opclass operator_class WHERE operator_class.opcnamespace=namespace.oid
                          UNION ALL SELECT operator_family.oid FROM pg_catalog.pg_opfamily operator_family WHERE operator_family.opfnamespace=namespace.oid
                          UNION ALL SELECT collation.oid FROM pg_catalog.pg_collation collation WHERE collation.collnamespace=namespace.oid
                          UNION ALL SELECT conversion.oid FROM pg_catalog.pg_conversion conversion WHERE conversion.connamespace=namespace.oid
                          UNION ALL SELECT text_search_config.oid FROM pg_catalog.pg_ts_config text_search_config WHERE text_search_config.cfgnamespace=namespace.oid
                          UNION ALL SELECT text_search_dictionary.oid FROM pg_catalog.pg_ts_dict text_search_dictionary WHERE text_search_dictionary.dictnamespace=namespace.oid
                          UNION ALL SELECT text_search_parser.oid FROM pg_catalog.pg_ts_parser text_search_parser WHERE text_search_parser.prsnamespace=namespace.oid
                          UNION ALL SELECT text_search_template.oid FROM pg_catalog.pg_ts_template text_search_template WHERE text_search_template.tmplnamespace=namespace.oid
                          UNION ALL SELECT extended_statistic.oid FROM pg_catalog.pg_statistic_ext extended_statistic WHERE extended_statistic.stxnamespace=namespace.oid
                          UNION ALL SELECT default_acl.oid FROM pg_catalog.pg_default_acl default_acl WHERE default_acl.defaclnamespace=namespace.oid
                        )
                    FROM pg_catalog.pg_namespace namespace
                   WHERE namespace.nspname='backtest_authority_lock_api')
             AND (SELECT pg_catalog.count(*)=1
                    FROM pg_catalog.pg_proc sibling
                    JOIN pg_catalog.pg_namespace namespace ON namespace.oid=sibling.pronamespace
                   WHERE namespace.nspname='backtest_authority_lock_api')
             AND (SELECT pg_catalog.count(*)=2 AND pg_catalog.bool_and(
                    role.rolname IN ('rd_owner','backtest_owner')
                    AND acl.privilege_type='EXECUTE' AND NOT acl.is_grantable
                    AND pg_catalog.pg_get_userbyid(acl.grantor)='postgres'
                  )
                    FROM pg_catalog.aclexplode(COALESCE(procedure.proacl,pg_catalog.acldefault('f',procedure.proowner))) acl
                    LEFT JOIN pg_catalog.pg_roles role ON role.oid=acl.grantee
                   WHERE acl.grantee<>procedure.proowner)
             FROM pg_catalog.pg_proc procedure JOIN pg_catalog.pg_language language ON language.oid=procedure.prolang WHERE procedure.oid=pg_catalog.to_regprocedure($2))
          THEN backtest_authority_lock_api.lock_authority_catalogs_v1() ELSE false END",
    )
    .bind(AUTHORITY_LOCK_FUNCTION_SOURCE)
    .bind(AUTHORITY_LOCK_FUNCTION)
    .fetch_one(&mut **transaction)
    .await
    .map_err(|e| storage(&e))?;
    if !exact_lock {
        return Err(BacktestResultCustodyErrorV2::Unavailable);
    }
    Ok(())
}

async fn validate_topology(
    transaction: &mut Transaction<'_, Postgres>,
    expected_principal: &str,
) -> Result<(), BacktestResultCustodyErrorV2> {
    let exact_census: bool = sqlx::query_scalar(RESULT_TABLE_CENSUS_QUERY)
        .fetch_one(&mut **transaction)
        .await
        .map_err(|e| storage(&e))?;
    if !exact_census {
        return Err(BacktestResultCustodyErrorV2::Unavailable);
    }
    let exact: bool = sqlx::query_scalar(
        "SELECT session_user=$3 AND current_user=$3
        AND (SELECT pg_catalog.pg_get_userbyid(namespace.nspowner)='backtest_custodian'
               FROM pg_catalog.pg_namespace namespace WHERE namespace.nspname='backtest_owner_api')
        AND (SELECT pg_catalog.count(*)=1 AND pg_catalog.bool_and(procedure.oid=pg_catalog.to_regprocedure($2))
               FROM pg_catalog.pg_proc procedure JOIN pg_catalog.pg_namespace namespace ON namespace.oid=procedure.pronamespace
              WHERE namespace.nspname='backtest_owner_api')
        AND (SELECT pg_catalog.count(*)=3 AND pg_catalog.bool_and(pg_catalog.pg_get_userbyid(relation.relowner)='backtest_custodian' AND relation.relkind='r' AND NOT relation.relrowsecurity AND NOT relation.relforcerowsecurity)
               FROM pg_catalog.pg_class relation JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace
              WHERE namespace.nspname='public' AND relation.relname IN ('backtest_replay_results_v2','backtest_replay_result_receipts_v1','backtest_replay_result_outbox_v1'))
        AND (SELECT pg_catalog.pg_get_userbyid(procedure.proowner)='backtest_custodian' AND procedure.prosecdef AND procedure.proisstrict AND procedure.provolatile='v' AND procedure.proparallel='u' AND procedure.proconfig=ARRAY['search_path=pg_catalog, pg_temp']::text[] AND procedure.prosrc=$1
               FROM pg_catalog.pg_proc procedure WHERE procedure.oid=pg_catalog.to_regprocedure($2))
        AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members membership WHERE membership.roleid IN (SELECT oid FROM pg_catalog.pg_roles WHERE rolname IN ('backtest_custodian','backtest_owner','rd_owner')) OR membership.member IN (SELECT oid FROM pg_catalog.pg_roles WHERE rolname IN ('backtest_custodian','backtest_owner','rd_owner')))
        AND (SELECT NOT role.rolcanlogin AND NOT role.rolsuper AND NOT role.rolcreatedb AND NOT role.rolcreaterole AND NOT role.rolreplication AND NOT role.rolbypassrls FROM pg_catalog.pg_roles role WHERE role.rolname='backtest_custodian')
        AND (SELECT role.rolcanlogin AND role.rolinherit AND NOT role.rolsuper AND NOT role.rolcreatedb AND NOT role.rolcreaterole AND NOT role.rolreplication AND NOT role.rolbypassrls FROM pg_catalog.pg_roles role WHERE role.rolname='backtest_owner')
        AND (SELECT role.rolcanlogin AND role.rolinherit AND NOT role.rolsuper AND NOT role.rolcreatedb AND NOT role.rolcreaterole AND NOT role.rolreplication AND NOT role.rolbypassrls FROM pg_catalog.pg_roles role WHERE role.rolname='rd_owner')
        AND (SELECT pg_catalog.count(*)=1 AND pg_catalog.bool_and(role.rolname='rd_owner' AND acl.privilege_type='USAGE' AND NOT acl.is_grantable AND pg_catalog.pg_get_userbyid(acl.grantor)='backtest_custodian')
               FROM pg_catalog.pg_namespace namespace CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(namespace.nspacl,pg_catalog.acldefault('n',namespace.nspowner))) acl LEFT JOIN pg_catalog.pg_roles role ON role.oid=acl.grantee
              WHERE namespace.nspname='backtest_owner_api' AND acl.grantee<>namespace.nspowner)
        AND (SELECT pg_catalog.count(*)=1 AND pg_catalog.bool_and(role.rolname='rd_owner' AND acl.privilege_type='EXECUTE' AND NOT acl.is_grantable AND pg_catalog.pg_get_userbyid(acl.grantor)='backtest_custodian')
               FROM pg_catalog.pg_proc procedure CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(procedure.proacl,pg_catalog.acldefault('f',procedure.proowner))) acl LEFT JOIN pg_catalog.pg_roles role ON role.oid=acl.grantee
              WHERE procedure.oid=pg_catalog.to_regprocedure($2) AND acl.grantee<>procedure.proowner)
        AND (SELECT pg_catalog.count(*)=6 AND pg_catalog.bool_and(role.rolname='backtest_owner' AND acl.privilege_type IN ('SELECT','INSERT') AND NOT acl.is_grantable AND pg_catalog.pg_get_userbyid(acl.grantor)='backtest_custodian')
               FROM pg_catalog.pg_class relation JOIN pg_catalog.pg_namespace namespace ON namespace.oid=relation.relnamespace CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(relation.relacl,pg_catalog.acldefault('r',relation.relowner))) acl LEFT JOIN pg_catalog.pg_roles role ON role.oid=acl.grantee
              WHERE namespace.nspname='public' AND relation.relname IN ('backtest_replay_results_v2','backtest_replay_result_receipts_v1','backtest_replay_result_outbox_v1') AND acl.grantee<>relation.relowner)
        AND pg_catalog.has_schema_privilege('rd_owner','backtest_owner_api','USAGE')
        AND NOT pg_catalog.has_schema_privilege('rd_owner','backtest_owner_api','CREATE')
        AND NOT pg_catalog.has_schema_privilege('backtest_owner','backtest_owner_api','USAGE,CREATE')
        AND pg_catalog.has_function_privilege('rd_owner',$2,'EXECUTE')
        AND NOT pg_catalog.has_function_privilege('backtest_owner',$2,'EXECUTE')
        AND NOT pg_catalog.has_table_privilege('rd_owner','public.backtest_replay_results_v2','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        AND NOT pg_catalog.has_table_privilege('rd_owner','public.backtest_replay_result_receipts_v1','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        AND NOT pg_catalog.has_table_privilege('rd_owner','public.backtest_replay_result_outbox_v1','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        AND pg_catalog.has_table_privilege('backtest_owner','public.backtest_replay_results_v2','SELECT')
        AND pg_catalog.has_table_privilege('backtest_owner','public.backtest_replay_results_v2','INSERT')
        AND pg_catalog.has_table_privilege('backtest_owner','public.backtest_replay_result_receipts_v1','SELECT')
        AND pg_catalog.has_table_privilege('backtest_owner','public.backtest_replay_result_receipts_v1','INSERT')
        AND pg_catalog.has_table_privilege('backtest_owner','public.backtest_replay_result_outbox_v1','SELECT')
        AND pg_catalog.has_table_privilege('backtest_owner','public.backtest_replay_result_outbox_v1','INSERT')
        AND NOT pg_catalog.has_table_privilege('backtest_owner','public.backtest_replay_results_v2','UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        AND NOT pg_catalog.has_table_privilege('backtest_owner','public.backtest_replay_result_receipts_v1','UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        AND NOT pg_catalog.has_table_privilege('backtest_owner','public.backtest_replay_result_outbox_v1','UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute attribute CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) acl WHERE attribute.attrelid IN ('public.backtest_replay_results_v2'::pg_catalog.regclass,'public.backtest_replay_result_receipts_v1'::pg_catalog.regclass,'public.backtest_replay_result_outbox_v1'::pg_catalog.regclass) AND attribute.attnum>0 AND NOT attribute.attisdropped)",
    )
    .bind(FUNCTION_SOURCE)
    .bind(RESOLVE_FUNCTION)
    .bind(expected_principal)
    .fetch_one(&mut **transaction)
    .await
    .map_err(|e| storage(&e))?;
    if exact {
        Ok(())
    } else {
        Err(BacktestResultCustodyErrorV2::Unavailable)
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct LockedEnvelopeV2 {
    schema_version: u16,
    result: StoredResultV2,
    receipt: StoredReceiptV1,
    outbox: StoredOutboxV1,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct StoredResultV2 {
    result_identity: String,
    result_digest: String,
    request_identity: String,
    request_meaning_digest: String,
    attempt_identity: String,
    terminal: String,
    canonical_bytes_base64: String,
    canonical_bytes_blake3: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct StoredReceiptV1 {
    result_identity: String,
    receipt_identity: String,
    receipt_digest: String,
    request_identity: String,
    request_meaning_digest: String,
    result_digest: String,
    namespace: String,
    outbox_event_identity: String,
    committed_at_epoch_ms: u64,
    canonical_bytes_base64: String,
    canonical_bytes_blake3: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct StoredOutboxV1 {
    result_identity: String,
    event_identity: String,
    event_digest: String,
    receipt_identity: String,
    request_identity: String,
    request_meaning_digest: String,
    result_digest: String,
    namespace: String,
    payload_digest: String,
    committed_at_epoch_ms: u64,
    canonical_bytes_base64: String,
    canonical_bytes_blake3: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct ResultReceiptV1 {
    schema_version: u16,
    receipt_identity: OpaqueIdentityV2,
    receipt_digest: CanonicalDigestV2,
    request_identity: OpaqueIdentityV2,
    request_meaning_digest: CanonicalDigestV2,
    result_identity: OpaqueIdentityV2,
    result_digest: CanonicalDigestV2,
    namespace: ReplayNamespaceV2,
    outbox_event_identity: OpaqueIdentityV2,
    committed_at_epoch_ms: u64,
}

#[derive(Serialize)]
struct ResultReceiptPreimageV1<'a> {
    schema_version: u16,
    receipt_identity: &'a OpaqueIdentityV2,
    request_identity: &'a OpaqueIdentityV2,
    request_meaning_digest: &'a CanonicalDigestV2,
    result_identity: &'a OpaqueIdentityV2,
    result_digest: &'a CanonicalDigestV2,
    namespace: ReplayNamespaceV2,
    outbox_event_identity: &'a OpaqueIdentityV2,
    committed_at_epoch_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct ResultOutboxPayloadV1 {
    schema_version: u16,
    receipt_identity: OpaqueIdentityV2,
    receipt_digest: CanonicalDigestV2,
    request_identity: OpaqueIdentityV2,
    request_meaning_digest: CanonicalDigestV2,
    result_identity: OpaqueIdentityV2,
    result_digest: CanonicalDigestV2,
    namespace: ReplayNamespaceV2,
    committed_at_epoch_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct ResultOutboxV1 {
    schema_version: u16,
    event_identity: OpaqueIdentityV2,
    event_digest: CanonicalDigestV2,
    aggregate_identity: OpaqueIdentityV2,
    event_kind: OpaqueIdentityV2,
    payload_digest: CanonicalDigestV2,
    payload: ResultOutboxPayloadV1,
    committed_at_epoch_ms: u64,
}

#[derive(Serialize)]
struct ResultOutboxPreimageV1<'a> {
    schema_version: u16,
    event_identity: &'a OpaqueIdentityV2,
    aggregate_identity: &'a OpaqueIdentityV2,
    event_kind: &'a OpaqueIdentityV2,
    payload_digest: &'a CanonicalDigestV2,
    payload: &'a ResultOutboxPayloadV1,
    committed_at_epoch_ms: u64,
}

fn validate_envelope(
    value: serde_json::Value,
    locator: ExploratoryReplayResultLocatorV2<'_>,
) -> Result<LockedExploratoryReplayResultV2, BacktestResultCustodyErrorV2> {
    let envelope: LockedEnvelopeV2 =
        serde_json::from_value(value).map_err(|_| BacktestResultCustodyErrorV2::Unavailable)?;
    let result_bytes = decode_bytes(&envelope.result.canonical_bytes_base64)?;
    let receipt_bytes = decode_bytes(&envelope.receipt.canonical_bytes_base64)?;
    let outbox_bytes = decode_bytes(&envelope.outbox.canonical_bytes_base64)?;
    let result = ReplayResultDtoV2::from_canonical_bytes(&result_bytes)
        .map_err(|_| BacktestResultCustodyErrorV2::Unavailable)?;
    let receipt: ResultReceiptV1 = decode_canonical(&receipt_bytes)?;
    let outbox: ResultOutboxV1 = decode_canonical(&outbox_bytes)?;

    let exact = envelope.schema_version == 2
        && result.namespace == ReplayNamespaceV2::Exploratory
        && result.terminal != ReplayTerminalV2::InProgressOrUnknown
        && result.result_identity.as_str() == locator.result_identity
        && result.request_identity.as_str() == locator.request_identity
        && result.attempt_identity.as_str() == locator.attempt_identity
        && envelope.result.result_identity == result.result_identity.as_str()
        && envelope.result.result_digest == result.result_digest.as_str()
        && envelope.result.request_identity == result.request_identity.as_str()
        && envelope.result.request_meaning_digest == result.request_meaning_digest.as_str()
        && envelope.result.attempt_identity == result.attempt_identity.as_str()
        && envelope.result.terminal == terminal_text(result.terminal)
        && envelope.result.canonical_bytes_blake3
            == storage_digest(RESULT_STORAGE_DOMAIN, &result_bytes)
        && envelope.receipt.result_identity == result.result_identity.as_str()
        && envelope.receipt.receipt_identity == receipt.receipt_identity.as_str()
        && envelope.receipt.receipt_digest == receipt.receipt_digest.as_str()
        && envelope.receipt.request_identity == receipt.request_identity.as_str()
        && envelope.receipt.request_meaning_digest == receipt.request_meaning_digest.as_str()
        && envelope.receipt.result_digest == receipt.result_digest.as_str()
        && envelope.receipt.namespace == "EXPLORATORY"
        && envelope.receipt.outbox_event_identity == receipt.outbox_event_identity.as_str()
        && envelope.receipt.committed_at_epoch_ms == receipt.committed_at_epoch_ms
        && envelope.receipt.canonical_bytes_blake3
            == storage_digest(RECEIPT_STORAGE_DOMAIN, &receipt_bytes)
        && envelope.outbox.result_identity == result.result_identity.as_str()
        && envelope.outbox.event_identity == outbox.event_identity.as_str()
        && envelope.outbox.event_digest == outbox.event_digest.as_str()
        && envelope.outbox.receipt_identity == outbox.payload.receipt_identity.as_str()
        && envelope.outbox.request_identity == outbox.payload.request_identity.as_str()
        && envelope.outbox.request_meaning_digest == outbox.payload.request_meaning_digest.as_str()
        && envelope.outbox.result_digest == outbox.payload.result_digest.as_str()
        && envelope.outbox.namespace == "EXPLORATORY"
        && envelope.outbox.payload_digest == outbox.payload_digest.as_str()
        && envelope.outbox.committed_at_epoch_ms == outbox.committed_at_epoch_ms
        && envelope.outbox.canonical_bytes_blake3
            == storage_digest(OUTBOX_STORAGE_DOMAIN, &outbox_bytes)
        && receipt.schema_version == 1
        && receipt.receipt_digest
            == digest_value(
                RECEIPT_DIGEST_DOMAIN,
                &ResultReceiptPreimageV1 {
                    schema_version: receipt.schema_version,
                    receipt_identity: &receipt.receipt_identity,
                    request_identity: &receipt.request_identity,
                    request_meaning_digest: &receipt.request_meaning_digest,
                    result_identity: &receipt.result_identity,
                    result_digest: &receipt.result_digest,
                    namespace: receipt.namespace,
                    outbox_event_identity: &receipt.outbox_event_identity,
                    committed_at_epoch_ms: receipt.committed_at_epoch_ms,
                },
            )?
        && receipt.request_identity == result.request_identity
        && receipt.request_meaning_digest == result.request_meaning_digest
        && receipt.result_identity == result.result_identity
        && receipt.result_digest == result.result_digest
        && receipt.namespace == ReplayNamespaceV2::Exploratory
        && outbox.schema_version == 1
        && outbox.payload.schema_version == 1
        && outbox.payload_digest == digest_value(OUTBOX_PAYLOAD_DIGEST_DOMAIN, &outbox.payload)?
        && outbox.event_digest
            == digest_value(
                OUTBOX_EVENT_DIGEST_DOMAIN,
                &ResultOutboxPreimageV1 {
                    schema_version: outbox.schema_version,
                    event_identity: &outbox.event_identity,
                    aggregate_identity: &outbox.aggregate_identity,
                    event_kind: &outbox.event_kind,
                    payload_digest: &outbox.payload_digest,
                    payload: &outbox.payload,
                    committed_at_epoch_ms: outbox.committed_at_epoch_ms,
                },
            )?
        && outbox.aggregate_identity == result.result_identity
        && outbox.event_kind.as_str() == EVENT_KIND
        && receipt.outbox_event_identity == outbox.event_identity
        && outbox.payload.receipt_identity == receipt.receipt_identity
        && outbox.payload.receipt_digest == receipt.receipt_digest
        && outbox.payload.request_identity == result.request_identity
        && outbox.payload.request_meaning_digest == result.request_meaning_digest
        && outbox.payload.result_identity == result.result_identity
        && outbox.payload.result_digest == result.result_digest
        && outbox.payload.namespace == ReplayNamespaceV2::Exploratory
        && outbox.committed_at_epoch_ms == receipt.committed_at_epoch_ms
        && outbox.payload.committed_at_epoch_ms == receipt.committed_at_epoch_ms;
    if !exact {
        return Err(BacktestResultCustodyErrorV2::Unavailable);
    }
    Ok(LockedExploratoryReplayResultV2 {
        result,
        result_canonical_bytes: result_bytes,
        receipt_canonical_bytes: receipt_bytes,
        outbox_canonical_bytes: outbox_bytes,
    })
}

fn decode_bytes(value: &str) -> Result<Vec<u8>, BacktestResultCustodyErrorV2> {
    BASE64
        .decode(value)
        .map_err(|_| BacktestResultCustodyErrorV2::Unavailable)
}

fn decode_canonical<T>(bytes: &[u8]) -> Result<T, BacktestResultCustodyErrorV2>
where
    T: for<'de> Deserialize<'de> + Serialize,
{
    let value: T =
        serde_json::from_slice(bytes).map_err(|_| BacktestResultCustodyErrorV2::Unavailable)?;
    if serde_json::to_vec(&value).map_err(|_| BacktestResultCustodyErrorV2::Unavailable)? != bytes {
        return Err(BacktestResultCustodyErrorV2::Unavailable);
    }
    Ok(value)
}

fn terminal_text(value: ReplayTerminalV2) -> &'static str {
    match value {
        ReplayTerminalV2::RunRejected => "RUN_REJECTED",
        ReplayTerminalV2::InProgressOrUnknown => "IN_PROGRESS_OR_UNKNOWN",
        ReplayTerminalV2::TerminalResult => "TERMINAL_RESULT",
        ReplayTerminalV2::InvalidReplayEvidence => "INVALID_REPLAY_EVIDENCE",
    }
}

fn storage_digest(domain: &str, bytes: &[u8]) -> String {
    let mut hasher = blake3::Hasher::new();
    hasher.update(domain.as_bytes());
    hasher.update(b"\0");
    hasher.update(bytes);
    format!("blake3:{}", hasher.finalize().to_hex())
}

fn digest_value<T: Serialize>(
    domain: &str,
    value: &T,
) -> Result<CanonicalDigestV2, BacktestResultCustodyErrorV2> {
    let bytes = serde_json::to_vec(value).map_err(|_| BacktestResultCustodyErrorV2::Unavailable)?;
    CanonicalDigestV2::try_from(storage_digest(domain, &bytes))
        .map_err(|_| BacktestResultCustodyErrorV2::Unavailable)
}

fn storage(error: &sqlx::Error) -> BacktestResultCustodyErrorV2 {
    BacktestResultCustodyErrorV2::Storage(error.to_string())
}

#[cfg(test)]
mod tests {
    use serde::Serialize;
    use vibe_backtest_owner_contracts::{
        ComponentObservationLocatorV2, DiagnosticCategoryV2, DiagnosticEvidenceDtoV2,
        ObservationComponentV2, ReconciliationAtomDtoV2, ReconciliationStatusV2,
        ReplayAuthorityClaimV2,
    };

    use super::*;

    #[derive(Serialize)]
    struct ResultDigestPreimageV2<'a> {
        schema_version: u16,
        request_identity: &'a OpaqueIdentityV2,
        request_meaning_digest: &'a CanonicalDigestV2,
        namespace: ReplayNamespaceV2,
        replay_authority: &'a ReplayAuthorityClaimV2,
        attempt_identity: &'a OpaqueIdentityV2,
        terminal: ReplayTerminalV2,
        reconciliation: &'a [ReconciliationAtomDtoV2],
        semantic_trace:
            Option<&'a vibe_backtest_owner_contracts::ConsumedComponentObservationDtoV2>,
        diagnostic_census: &'a [DiagnosticEvidenceDtoV2],
    }

    #[test]
    fn topology_census_requires_durable_heap_tables_and_indexes() {
        assert!(RESULT_TABLE_CENSUS_QUERY.contains("relation.relpersistence='p'"));
        assert!(RESULT_TABLE_CENSUS_QUERY.contains("access_method.amname='heap'"));
        assert!(RESULT_TABLE_CENSUS_QUERY.contains("index_relation.relpersistence<>'p'"));
        assert!(RESULT_TABLE_CENSUS_QUERY.contains("index_method.amname<>'btree'"));
    }

    #[test]
    fn topology_census_rejects_after_insert_trigger_drift() {
        assert!(RESULT_TABLE_CENSUS_QUERY.contains(
            "SELECT 1 FROM pg_catalog.pg_trigger trigger_fact\n     WHERE trigger_fact.tgrelid IN (SELECT oid FROM family)"
        ));
        assert!(!RESULT_TABLE_CENSUS_QUERY.contains("NOT trigger_fact.tgisinternal"));
    }

    #[test]
    fn topology_census_covers_exact_structural_boundaries() {
        for required in [
            "pg_catalog.count(*)=31",
            "pg_catalog.count(*)=8",
            "pg_catalog.count(*)=5",
            "constraint_fact.contype NOT IN ('p','u','c')",
            "constraint_fact.confrelid IN (SELECT oid FROM family)",
            "pg_catalog.pg_rewrite",
            "pg_catalog.pg_inherits",
            "pg_catalog.pg_publication_rel",
            "pg_catalog.pg_publication_namespace",
            "pg_catalog.pg_statistic_ext",
            "namespace.nspname<>'public'",
        ] {
            assert!(
                RESULT_TABLE_CENSUS_QUERY.contains(required),
                "missing {required}"
            );
        }
    }

    fn identity(value: impl Into<String>) -> OpaqueIdentityV2 {
        OpaqueIdentityV2::try_from(value.into()).expect("fixture identity")
    }

    fn digest(byte: char) -> CanonicalDigestV2 {
        CanonicalDigestV2::try_from(format!("sha256:{}", byte.to_string().repeat(64)))
            .expect("fixture digest")
    }

    fn result_fixture(label: &str, byte: char) -> (ReplayResultDtoV2, Vec<u8>) {
        let request_identity = identity(format!("request-{label}"));
        let request_meaning_digest = digest(byte);
        let attempt_identity = identity(format!("attempt-{label}"));
        let reconciliation = ObservationComponentV2::REQUESTED_MEANING
            .into_iter()
            .map(|component| {
                let meaning_identity = identity(format!("meaning-{label}-{component:?}"));
                let meaning_digest = digest(byte);
                ReconciliationAtomDtoV2 {
                    component,
                    requested_meaning_identity: meaning_identity.clone(),
                    requested_meaning_digest: meaning_digest.clone(),
                    observed_meaning_identity: Some(meaning_identity),
                    observed_meaning_digest: Some(meaning_digest),
                    observation_locator: Some(ComponentObservationLocatorV2 {
                        component,
                        reference: identity(format!("observation-{label}-{component:?}")),
                        digest: digest(byte),
                    }),
                    status: ReconciliationStatusV2::Exact,
                }
            })
            .collect::<Vec<_>>();
        let diagnostic_census = vec![DiagnosticEvidenceDtoV2 {
            request_identity: request_identity.clone(),
            request_meaning_digest: request_meaning_digest.clone(),
            attempt_identity: attempt_identity.clone(),
            category: DiagnosticCategoryV2::UnresolvedFailure,
            decisive_evidence: ComponentObservationLocatorV2 {
                component: ObservationComponentV2::SemanticTrace,
                reference: identity(format!("diagnostic-{label}")),
                digest: digest(byte),
            },
        }];
        let mut result = ReplayResultDtoV2 {
            schema_version: 2,
            result_identity: identity("placeholder-result"),
            result_digest: digest('0'),
            request_identity,
            request_meaning_digest,
            namespace: ReplayNamespaceV2::Exploratory,
            replay_authority: ReplayAuthorityClaimV2::Exploratory,
            attempt_identity,
            terminal: ReplayTerminalV2::InvalidReplayEvidence,
            reconciliation,
            semantic_trace: None,
            diagnostic_census,
        };

        let preimage = ResultDigestPreimageV2 {
            schema_version: result.schema_version,
            request_identity: &result.request_identity,
            request_meaning_digest: &result.request_meaning_digest,
            namespace: result.namespace,
            replay_authority: &result.replay_authority,
            attempt_identity: &result.attempt_identity,
            terminal: result.terminal,
            reconciliation: &result.reconciliation,
            semantic_trace: result.semantic_trace.as_ref(),
            diagnostic_census: &result.diagnostic_census,
        };
        result.result_digest =
            digest_value("vibe.backtest.replay-result.v2", &preimage).expect("result digest");
        result.result_identity = identity(format!(
            "backtest-replay-result-v2-{}",
            result
                .result_digest
                .as_str()
                .strip_prefix("blake3:")
                .expect("blake3 result digest")
        ));
        let bytes = result.to_canonical_bytes().expect("canonical result wire");
        (result, bytes)
    }

    fn custody_fixture(
        result: &ReplayResultDtoV2,
        epoch: u64,
    ) -> (ResultReceiptV1, Vec<u8>, ResultOutboxV1, Vec<u8>) {
        let suffix = result
            .result_digest
            .as_str()
            .strip_prefix("blake3:")
            .expect("blake3 result digest");
        let receipt_identity = identity(format!("backtest-result-receipt-v1-{suffix}"));
        let event_identity = identity(format!("backtest-result-outbox-v1-{suffix}"));
        let placeholder = digest('0');
        let mut receipt = ResultReceiptV1 {
            schema_version: 1,
            receipt_identity: receipt_identity.clone(),
            receipt_digest: placeholder.clone(),
            request_identity: result.request_identity.clone(),
            request_meaning_digest: result.request_meaning_digest.clone(),
            result_identity: result.result_identity.clone(),
            result_digest: result.result_digest.clone(),
            namespace: ReplayNamespaceV2::Exploratory,
            outbox_event_identity: event_identity.clone(),
            committed_at_epoch_ms: epoch,
        };
        receipt.receipt_digest = digest_value(
            RECEIPT_DIGEST_DOMAIN,
            &ResultReceiptPreimageV1 {
                schema_version: receipt.schema_version,
                receipt_identity: &receipt.receipt_identity,
                request_identity: &receipt.request_identity,
                request_meaning_digest: &receipt.request_meaning_digest,
                result_identity: &receipt.result_identity,
                result_digest: &receipt.result_digest,
                namespace: receipt.namespace,
                outbox_event_identity: &receipt.outbox_event_identity,
                committed_at_epoch_ms: receipt.committed_at_epoch_ms,
            },
        )
        .expect("receipt digest");
        let payload = ResultOutboxPayloadV1 {
            schema_version: 1,
            receipt_identity,
            receipt_digest: receipt.receipt_digest.clone(),
            request_identity: result.request_identity.clone(),
            request_meaning_digest: result.request_meaning_digest.clone(),
            result_identity: result.result_identity.clone(),
            result_digest: result.result_digest.clone(),
            namespace: ReplayNamespaceV2::Exploratory,
            committed_at_epoch_ms: epoch,
        };
        let mut outbox = ResultOutboxV1 {
            schema_version: 1,
            event_identity,
            event_digest: placeholder.clone(),
            aggregate_identity: result.result_identity.clone(),
            event_kind: identity(EVENT_KIND),
            payload_digest: placeholder,
            payload,
            committed_at_epoch_ms: epoch,
        };
        outbox.payload_digest =
            digest_value(OUTBOX_PAYLOAD_DIGEST_DOMAIN, &outbox.payload).expect("payload digest");
        outbox.event_digest = digest_value(
            OUTBOX_EVENT_DIGEST_DOMAIN,
            &ResultOutboxPreimageV1 {
                schema_version: outbox.schema_version,
                event_identity: &outbox.event_identity,
                aggregate_identity: &outbox.aggregate_identity,
                event_kind: &outbox.event_kind,
                payload_digest: &outbox.payload_digest,
                payload: &outbox.payload,
                committed_at_epoch_ms: outbox.committed_at_epoch_ms,
            },
        )
        .expect("event digest");
        let receipt_bytes = serde_json::to_vec(&receipt).expect("canonical receipt wire");
        let outbox_bytes = serde_json::to_vec(&outbox).expect("canonical outbox wire");
        (receipt, receipt_bytes, outbox, outbox_bytes)
    }

    fn envelope(
        result: &ReplayResultDtoV2,
        result_bytes: &[u8],
        receipt: &ResultReceiptV1,
        receipt_bytes: &[u8],
        outbox: &ResultOutboxV1,
        outbox_bytes: &[u8],
    ) -> serde_json::Value {
        serde_json::json!({
            "schema_version": 2,
            "result": {
                "result_identity": result.result_identity.as_str(),
                "result_digest": result.result_digest.as_str(),
                "request_identity": result.request_identity.as_str(),
                "request_meaning_digest": result.request_meaning_digest.as_str(),
                "attempt_identity": result.attempt_identity.as_str(),
                "terminal": terminal_text(result.terminal),
                "canonical_bytes_base64": BASE64.encode(result_bytes),
                "canonical_bytes_blake3": storage_digest(RESULT_STORAGE_DOMAIN, result_bytes),
            },
            "receipt": {
                "result_identity": receipt.result_identity.as_str(),
                "receipt_identity": receipt.receipt_identity.as_str(),
                "receipt_digest": receipt.receipt_digest.as_str(),
                "request_identity": receipt.request_identity.as_str(),
                "request_meaning_digest": receipt.request_meaning_digest.as_str(),
                "result_digest": receipt.result_digest.as_str(),
                "namespace": "EXPLORATORY",
                "outbox_event_identity": receipt.outbox_event_identity.as_str(),
                "committed_at_epoch_ms": receipt.committed_at_epoch_ms,
                "canonical_bytes_base64": BASE64.encode(receipt_bytes),
                "canonical_bytes_blake3": storage_digest(RECEIPT_STORAGE_DOMAIN, receipt_bytes),
            },
            "outbox": {
                "result_identity": outbox.aggregate_identity.as_str(),
                "event_identity": outbox.event_identity.as_str(),
                "event_digest": outbox.event_digest.as_str(),
                "receipt_identity": outbox.payload.receipt_identity.as_str(),
                "request_identity": outbox.payload.request_identity.as_str(),
                "request_meaning_digest": outbox.payload.request_meaning_digest.as_str(),
                "result_digest": outbox.payload.result_digest.as_str(),
                "namespace": "EXPLORATORY",
                "payload_digest": outbox.payload_digest.as_str(),
                "committed_at_epoch_ms": outbox.committed_at_epoch_ms,
                "canonical_bytes_base64": BASE64.encode(outbox_bytes),
                "canonical_bytes_blake3": storage_digest(OUTBOX_STORAGE_DOMAIN, outbox_bytes),
            },
        })
    }

    #[test]
    fn valid_canonical_aggregates_cannot_be_cross_spliced() {
        let (result_a, result_bytes_a) = result_fixture("a", 'a');
        let (receipt_a, receipt_bytes_a, outbox_a, outbox_bytes_a) = custody_fixture(&result_a, 1);
        let (result_b, result_bytes_b) = result_fixture("b", 'b');
        let (receipt_b, receipt_bytes_b, outbox_b, outbox_bytes_b) = custody_fixture(&result_b, 2);

        for (result, result_bytes, receipt, receipt_bytes, outbox, outbox_bytes) in [
            (
                &result_a,
                &result_bytes_a,
                &receipt_a,
                &receipt_bytes_a,
                &outbox_a,
                &outbox_bytes_a,
            ),
            (
                &result_b,
                &result_bytes_b,
                &receipt_b,
                &receipt_bytes_b,
                &outbox_b,
                &outbox_bytes_b,
            ),
        ] {
            validate_envelope(
                envelope(
                    result,
                    result_bytes,
                    receipt,
                    receipt_bytes,
                    outbox,
                    outbox_bytes,
                ),
                ExploratoryReplayResultLocatorV2 {
                    result_identity: result.result_identity.as_str(),
                    request_identity: result.request_identity.as_str(),
                    attempt_identity: result.attempt_identity.as_str(),
                },
            )
            .expect("independently valid canonical aggregate");
        }

        let cross_spliced = envelope(
            &result_a,
            &result_bytes_a,
            &receipt_b,
            &receipt_bytes_b,
            &outbox_b,
            &outbox_bytes_b,
        );
        assert!(matches!(
            validate_envelope(
                cross_spliced,
                ExploratoryReplayResultLocatorV2 {
                    result_identity: result_a.result_identity.as_str(),
                    request_identity: result_a.request_identity.as_str(),
                    attempt_identity: result_a.attempt_identity.as_str(),
                },
            ),
            Err(BacktestResultCustodyErrorV2::Unavailable)
        ));
    }
}
