//! Transaction-bound read adapter for canonical Backtest Result custody.
//!
//! This crate opens no pool and starts or commits no transaction. Its only positive constructor
//! accepts a caller-held PostgreSQL transaction, validates the fixed Backtest-owned facade and
//! private storage boundary, locks one pre-existing exact custody set, and returns its original
//! Result, receipt, and outbox bytes.

use serde::{Deserialize, Serialize, de::DeserializeOwned};
use sqlx::{Postgres, Row, Transaction};
use thiserror::Error;
use vibe_backtest_owner_contracts::{
    BacktestResultOutboxV1, BacktestResultReceiptV1, CanonicalDigestV2, DiagnosticCategoryV2,
    EXPLORATORY_RESULT_COMMITTED_EVENT_KIND_V1, ObservationComponentV2, OpaqueIdentityV2,
    ReplayAuthorityClaimV2, ReplayNamespaceV2, ReplayRequestDtoV2, ReplayRequestV2,
    ReplayResultDtoV2, ReplayTerminalV2, ResultReconciliationStatusV2,
};

const QUERY_SCHEMA_V1: u16 = 1;
const ENVELOPE_SCHEMA_V1: u16 = 1;
const FACADE_SCHEMA: &str = "backtest_owner_api";
const FACADE_SIGNATURE: &str = "backtest_owner_api.lock_exploratory_result_v1(text,text,text,text)";
const REQUEST_STORAGE_DOMAIN: &str = "vibe.backtest.replay-request-storage.v2";
const RESULT_STORAGE_DOMAIN: &str = "vibe.backtest.replay-result-storage.v2";
const RECEIPT_STORAGE_DOMAIN: &str = "vibe.backtest.result-receipt-storage.v1";
const OUTBOX_STORAGE_DOMAIN: &str = "vibe.backtest.result-outbox-storage.v1";
const REQUEST_BINDING_DOMAIN: &str = "vibe.backtest.replay-request-binding.v2";

/// The exact fixed-source body accepted for the Backtest-owned lock/read facade.
pub const LOCK_EXPLORATORY_RESULT_SOURCE_V1: &str = "
SELECT stored_run.request_identity,stored_run.request_meaning_digest,stored_run.request_seal_digest,stored_run.rd_receipt_identity,stored_run.request_binding_blake3,stored_run.request_canonical_bytes,stored_run.request_canonical_bytes_blake3,stored_run.attempt_identity,stored_run.result_identity,stored_run.result_digest,stored_run.terminal,
       stored_result.result_identity,stored_result.result_digest,stored_result.request_identity,stored_result.request_meaning_digest,stored_result.attempt_identity,stored_result.terminal,stored_result.canonical_bytes,stored_result.canonical_bytes_blake3,
       stored_receipt.result_identity,stored_receipt.receipt_identity,stored_receipt.receipt_digest,stored_receipt.request_identity,stored_receipt.request_meaning_digest,stored_receipt.result_digest,stored_receipt.namespace,stored_receipt.outbox_event_identity,stored_receipt.committed_at_epoch_ms,stored_receipt.canonical_bytes,stored_receipt.canonical_bytes_blake3,
       stored_outbox.result_identity,stored_outbox.event_identity,stored_outbox.event_digest,stored_outbox.receipt_identity,stored_outbox.request_identity,stored_outbox.request_meaning_digest,stored_outbox.result_digest,stored_outbox.namespace,stored_outbox.payload_digest,stored_outbox.committed_at_epoch_ms,stored_outbox.canonical_bytes,stored_outbox.canonical_bytes_blake3
FROM public.backtest_replay_runs_v2 stored_run
JOIN public.backtest_replay_results_v2 stored_result USING(result_identity)
JOIN public.backtest_replay_result_receipts_v1 stored_receipt USING(result_identity)
JOIN public.backtest_replay_result_outbox_v1 stored_outbox USING(result_identity)
WHERE stored_run.request_identity=requested_request_identity
  AND stored_run.request_meaning_digest=requested_request_meaning_digest
  AND stored_result.result_identity=requested_result_identity
  AND stored_result.result_digest=requested_result_digest
  AND stored_result.request_identity=stored_run.request_identity
  AND stored_result.request_meaning_digest=stored_run.request_meaning_digest
  AND stored_receipt.request_identity=stored_run.request_identity
  AND stored_receipt.request_meaning_digest=stored_run.request_meaning_digest
  AND stored_receipt.result_digest=stored_result.result_digest
  AND stored_receipt.namespace='EXPLORATORY'
  AND stored_outbox.request_identity=stored_run.request_identity
  AND stored_outbox.request_meaning_digest=stored_run.request_meaning_digest
  AND stored_outbox.result_digest=stored_result.result_digest
  AND stored_outbox.namespace='EXPLORATORY'
  AND stored_outbox.receipt_identity=stored_receipt.receipt_identity
FOR UPDATE OF stored_run,stored_result,stored_receipt,stored_outbox
";

const PRIMARY_STORAGE_SHAPE_V2: &str = r#"SELECT
    run_class.relkind='r'
    AND result_class.relkind='r'
    AND run_class.relpersistence='p'
    AND result_class.relpersistence='p'
    AND NOT run_class.relispartition
    AND NOT result_class.relispartition
    AND NOT run_class.relrowsecurity
    AND NOT result_class.relrowsecurity
    AND NOT run_class.relforcerowsecurity
    AND NOT result_class.relforcerowsecurity
    AND run_class.relreplident='d'
    AND result_class.relreplident='d'
    AND run_class.reloptions IS NULL
    AND result_class.reloptions IS NULL
    AND run_class.reltablespace=0
    AND result_class.reltablespace=0
    AND run_class.relam=(SELECT access_method.oid FROM pg_catalog.pg_am access_method WHERE access_method.amname='heap')
    AND result_class.relam=(SELECT access_method.oid FROM pg_catalog.pg_am access_method WHERE access_method.amname='heap')
    AND pg_catalog.pg_get_userbyid(run_class.relowner)='backtest_owner'
    AND pg_catalog.pg_get_userbyid(result_class.relowner)='backtest_owner'
    AND (SELECT pg_catalog.array_agg(attribute.attname::text || ':' || pg_catalog.format_type(attribute.atttypid,attribute.atttypmod) || ':' || attribute.attnotnull::text || ':' || attribute.atthasdef::text || ':' || attribute.attidentity::text || ':' || attribute.attgenerated::text ORDER BY attribute.attnum)
         FROM pg_catalog.pg_attribute attribute
         WHERE attribute.attrelid=run_class.oid AND attribute.attnum>0 AND NOT attribute.attisdropped)
        =ARRAY['request_identity:text:true:false::','request_meaning_digest:text:true:false::','request_seal_digest:text:true:false::','rd_receipt_identity:text:true:false::','request_binding_blake3:text:true:false::','request_canonical_bytes:bytea:true:false::','request_canonical_bytes_blake3:text:true:false::','attempt_identity:text:true:false::','result_identity:text:true:false::','result_digest:text:true:false::','terminal:text:true:false::']::text[]
    AND (SELECT pg_catalog.array_agg(attribute.attname::text || ':' || pg_catalog.format_type(attribute.atttypid,attribute.atttypmod) || ':' || attribute.attnotnull::text || ':' || attribute.atthasdef::text || ':' || attribute.attidentity::text || ':' || attribute.attgenerated::text ORDER BY attribute.attnum)
         FROM pg_catalog.pg_attribute attribute
         WHERE attribute.attrelid=result_class.oid AND attribute.attnum>0 AND NOT attribute.attisdropped)
        =ARRAY['result_identity:text:true:false::','result_digest:text:true:false::','request_identity:text:true:false::','request_meaning_digest:text:true:false::','attempt_identity:text:true:false::','terminal:text:true:false::','canonical_bytes:bytea:true:false::','canonical_bytes_blake3:text:true:false::']::text[]
    AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_attribute attribute
        WHERE attribute.attrelid IN (run_class.oid,result_class.oid)
          AND attribute.attnum>0 AND NOT attribute.attisdropped
          AND ((attribute.atttypid='pg_catalog.text'::pg_catalog.regtype AND attribute.attcollation<>'pg_catalog."C"'::pg_catalog.regcollation)
            OR (attribute.atttypid<>'pg_catalog.text'::pg_catalog.regtype AND attribute.attcollation<>0)))
    AND (SELECT count(*) FROM pg_catalog.pg_constraint constraint_entry WHERE constraint_entry.conrelid=run_class.oid)=2
    AND EXISTS (SELECT 1 FROM pg_catalog.pg_constraint constraint_entry WHERE constraint_entry.conrelid=run_class.oid AND constraint_entry.contype='p' AND constraint_entry.conkey=ARRAY[(SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid=run_class.oid AND attname='result_identity')]::smallint[] AND constraint_entry.conindid<>0 AND NOT constraint_entry.condeferrable AND NOT constraint_entry.condeferred AND constraint_entry.convalidated)
    AND EXISTS (SELECT 1 FROM pg_catalog.pg_constraint constraint_entry WHERE constraint_entry.conrelid=run_class.oid AND constraint_entry.contype='u' AND constraint_entry.conkey=ARRAY[(SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid=run_class.oid AND attname='request_identity'),(SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid=run_class.oid AND attname='attempt_identity')]::smallint[] AND constraint_entry.conindid<>0 AND NOT constraint_entry.condeferrable AND NOT constraint_entry.condeferred AND constraint_entry.convalidated)
    AND (SELECT count(*) FROM pg_catalog.pg_constraint constraint_entry WHERE constraint_entry.conrelid=result_class.oid)=2
    AND EXISTS (SELECT 1 FROM pg_catalog.pg_constraint constraint_entry WHERE constraint_entry.conrelid=result_class.oid AND constraint_entry.contype='p' AND constraint_entry.conkey=ARRAY[(SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid=result_class.oid AND attname='result_identity')]::smallint[] AND constraint_entry.conindid<>0 AND NOT constraint_entry.condeferrable AND NOT constraint_entry.condeferred AND constraint_entry.convalidated)
    AND EXISTS (SELECT 1 FROM pg_catalog.pg_constraint constraint_entry WHERE constraint_entry.conrelid=result_class.oid AND constraint_entry.confrelid=run_class.oid AND constraint_entry.contype='f' AND constraint_entry.conkey=ARRAY[(SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid=result_class.oid AND attname='result_identity')]::smallint[] AND constraint_entry.confkey=ARRAY[(SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid=run_class.oid AND attname='result_identity')]::smallint[] AND constraint_entry.confupdtype='a' AND constraint_entry.confdeltype='a' AND constraint_entry.confmatchtype='s' AND NOT constraint_entry.condeferrable AND NOT constraint_entry.condeferred AND constraint_entry.convalidated)
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint constraint_entry WHERE constraint_entry.contype='f' AND constraint_entry.conrelid NOT IN (run_class.oid,result_class.oid,'public.backtest_replay_result_receipts_v1'::pg_catalog.regclass,'public.backtest_replay_result_outbox_v1'::pg_catalog.regclass) AND constraint_entry.confrelid IN (run_class.oid,result_class.oid))
    AND (SELECT count(*) FROM pg_catalog.pg_index index_entry WHERE index_entry.indrelid=run_class.oid)=2
    AND (SELECT count(*) FROM pg_catalog.pg_index index_entry WHERE index_entry.indrelid=result_class.oid)=1
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_index index_entry WHERE index_entry.indrelid IN (run_class.oid,result_class.oid) AND (NOT index_entry.indisvalid OR NOT index_entry.indisready OR NOT index_entry.indislive OR NOT index_entry.indisunique OR NOT index_entry.indimmediate OR index_entry.indisexclusion OR index_entry.indisclustered OR index_entry.indisreplident OR index_entry.indnullsnotdistinct OR index_entry.indexprs IS NOT NULL OR index_entry.indpred IS NOT NULL OR index_entry.indnatts<>index_entry.indnkeyatts OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint constraint_entry WHERE constraint_entry.conindid=index_entry.indexrelid AND constraint_entry.conrelid=index_entry.indrelid)))
    AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_index index_entry
        JOIN pg_catalog.pg_class index_class ON index_class.oid=index_entry.indexrelid
        WHERE index_entry.indrelid IN (run_class.oid,result_class.oid)
          AND (index_class.relkind<>'i' OR index_class.relpersistence<>'p' OR index_class.reloptions IS NOT NULL
            OR index_class.reltablespace<>0 OR pg_catalog.pg_get_userbyid(index_class.relowner)<>'backtest_owner'
            OR index_class.relam<>(SELECT access_method.oid FROM pg_catalog.pg_am access_method WHERE access_method.amname='btree')
            OR EXISTS (
              SELECT 1 FROM pg_catalog.generate_series(0,index_entry.indnkeyatts::integer-1) key_position
              JOIN pg_catalog.pg_attribute indexed_attribute
                ON indexed_attribute.attrelid=index_entry.indrelid AND indexed_attribute.attnum=index_entry.indkey[key_position]
              JOIN pg_catalog.pg_opclass operator_class ON operator_class.oid=index_entry.indclass[key_position]
              JOIN pg_catalog.pg_namespace operator_namespace ON operator_namespace.oid=operator_class.opcnamespace
              WHERE index_entry.indcollation[key_position]<>indexed_attribute.attcollation
                OR index_entry.indoption[key_position]<>0
                OR operator_namespace.nspname<>'pg_catalog'
                OR operator_class.opcname<>'text_ops'
                OR operator_class.opcintype<>'pg_catalog.text'::pg_catalog.regtype
                OR operator_class.opcmethod<>index_class.relam)))
    AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_depend dependency_entry
        WHERE dependency_entry.classid='pg_catalog.pg_class'::pg_catalog.regclass
          AND dependency_entry.objid IN (run_class.oid,result_class.oid)
          AND NOT (
            dependency_entry.deptype='n' AND dependency_entry.refobjsubid=0 AND (
              (dependency_entry.objsubid=0
                AND dependency_entry.refclassid='pg_catalog.pg_namespace'::pg_catalog.regclass
                AND dependency_entry.refobjid=run_class.relnamespace)
              OR (dependency_entry.objsubid=0
                AND dependency_entry.refclassid='pg_catalog.pg_am'::pg_catalog.regclass
                AND dependency_entry.refobjid IN (run_class.relam,result_class.relam))
              OR (dependency_entry.objsubid>0
                AND dependency_entry.refclassid='pg_catalog.pg_type'::pg_catalog.regclass
                AND EXISTS (SELECT 1 FROM pg_catalog.pg_attribute attribute
                  WHERE attribute.attrelid=dependency_entry.objid AND attribute.attnum=dependency_entry.objsubid
                    AND attribute.atttypid=dependency_entry.refobjid))
              OR (dependency_entry.objsubid>0
                AND dependency_entry.refclassid='pg_catalog.pg_collation'::pg_catalog.regclass
                AND EXISTS (SELECT 1 FROM pg_catalog.pg_attribute attribute
                  WHERE attribute.attrelid=dependency_entry.objid AND attribute.attnum=dependency_entry.objsubid
                    AND attribute.attcollation=dependency_entry.refobjid)))))
    AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_depend dependency_entry
        WHERE dependency_entry.deptype IN ('e','x') AND (
          (dependency_entry.classid='pg_catalog.pg_class'::pg_catalog.regclass AND (
            dependency_entry.objid IN (run_class.oid,result_class.oid)
            OR dependency_entry.objid IN (SELECT index_entry.indexrelid FROM pg_catalog.pg_index index_entry WHERE index_entry.indrelid IN (run_class.oid,result_class.oid))
            OR dependency_entry.objid IN (run_class.reltoastrelid,result_class.reltoastrelid)
            OR dependency_entry.objid IN (SELECT toast_index.indexrelid FROM pg_catalog.pg_index toast_index WHERE toast_index.indrelid IN (run_class.reltoastrelid,result_class.reltoastrelid))))
          OR (dependency_entry.classid='pg_catalog.pg_constraint'::pg_catalog.regclass
            AND dependency_entry.objid IN (SELECT constraint_entry.oid FROM pg_catalog.pg_constraint constraint_entry WHERE constraint_entry.conrelid IN (run_class.oid,result_class.oid)))
          OR (dependency_entry.classid='pg_catalog.pg_type'::pg_catalog.regclass
            AND dependency_entry.objid IN (run_class.reltype,result_class.reltype))))
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger trigger_entry WHERE trigger_entry.tgrelid IN (run_class.oid,result_class.oid) AND NOT trigger_entry.tgisinternal)
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_rewrite rule_entry WHERE rule_entry.ev_class IN (run_class.oid,result_class.oid))
    AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_rewrite rule_entry
        JOIN pg_catalog.pg_depend dependency_entry
          ON dependency_entry.classid='pg_catalog.pg_rewrite'::pg_catalog.regclass
         AND dependency_entry.objid=rule_entry.oid
         AND dependency_entry.refclassid='pg_catalog.pg_class'::pg_catalog.regclass
         AND dependency_entry.refobjid IN (run_class.oid,result_class.oid)
         AND dependency_entry.deptype='n'
        WHERE rule_entry.ev_class NOT IN (run_class.oid,result_class.oid)
    )
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policy policy_entry WHERE policy_entry.polrelid IN (run_class.oid,result_class.oid))
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_inherits inheritance_entry WHERE inheritance_entry.inhrelid IN (run_class.oid,result_class.oid) OR inheritance_entry.inhparent IN (run_class.oid,result_class.oid))
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_statistic_ext statistic_entry WHERE statistic_entry.stxrelid IN (run_class.oid,result_class.oid))
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_publication_tables publication_entry WHERE publication_entry.schemaname='public' AND publication_entry.tablename IN ('backtest_replay_runs_v2','backtest_replay_results_v2'))
FROM pg_catalog.pg_class run_class,pg_catalog.pg_class result_class
WHERE run_class.oid='public.backtest_replay_runs_v2'::pg_catalog.regclass
  AND result_class.oid='public.backtest_replay_results_v2'::pg_catalog.regclass"#;

const AUXILIARY_STORAGE_SHAPE_V1: &str = r#"SELECT
    receipt_class.relkind='r'
    AND outbox_class.relkind='r'
    AND receipt_class.relpersistence='p'
    AND outbox_class.relpersistence='p'
    AND NOT receipt_class.relispartition
    AND NOT outbox_class.relispartition
    AND NOT receipt_class.relrowsecurity
    AND NOT outbox_class.relrowsecurity
    AND NOT receipt_class.relforcerowsecurity
    AND NOT outbox_class.relforcerowsecurity
    AND receipt_class.relreplident='d'
    AND outbox_class.relreplident='d'
    AND receipt_class.reloptions IS NULL
    AND outbox_class.reloptions IS NULL
    AND receipt_class.reltablespace=0
    AND outbox_class.reltablespace=0
    AND receipt_class.relam=(SELECT access_method.oid FROM pg_catalog.pg_am access_method WHERE access_method.amname='heap')
    AND outbox_class.relam=(SELECT access_method.oid FROM pg_catalog.pg_am access_method WHERE access_method.amname='heap')
    AND pg_catalog.pg_get_userbyid(receipt_class.relowner)='backtest_owner'
    AND pg_catalog.pg_get_userbyid(outbox_class.relowner)='backtest_owner'
    AND (SELECT pg_catalog.array_agg(attribute.attname::text || ':' || pg_catalog.format_type(attribute.atttypid,attribute.atttypmod) || ':' || attribute.attnotnull::text || ':' || attribute.atthasdef::text || ':' || attribute.attidentity::text || ':' || attribute.attgenerated::text ORDER BY attribute.attnum)
         FROM pg_catalog.pg_attribute attribute
         WHERE attribute.attrelid=receipt_class.oid AND attribute.attnum>0 AND NOT attribute.attisdropped)
        =ARRAY['result_identity:text:true:false::','receipt_identity:text:true:false::','receipt_digest:text:true:false::','request_identity:text:true:false::','request_meaning_digest:text:true:false::','result_digest:text:true:false::','namespace:text:true:false::','outbox_event_identity:text:true:false::','committed_at_epoch_ms:bigint:true:false::','canonical_bytes:bytea:true:false::','canonical_bytes_blake3:text:true:false::']::text[]
    AND (SELECT pg_catalog.array_agg(attribute.attname::text || ':' || pg_catalog.format_type(attribute.atttypid,attribute.atttypmod) || ':' || attribute.attnotnull::text || ':' || attribute.atthasdef::text || ':' || attribute.attidentity::text || ':' || attribute.attgenerated::text ORDER BY attribute.attnum)
         FROM pg_catalog.pg_attribute attribute
         WHERE attribute.attrelid=outbox_class.oid AND attribute.attnum>0 AND NOT attribute.attisdropped)
        =ARRAY['result_identity:text:true:false::','event_identity:text:true:false::','event_digest:text:true:false::','receipt_identity:text:true:false::','request_identity:text:true:false::','request_meaning_digest:text:true:false::','result_digest:text:true:false::','namespace:text:true:false::','payload_digest:text:true:false::','committed_at_epoch_ms:bigint:true:false::','canonical_bytes:bytea:true:false::','canonical_bytes_blake3:text:true:false::']::text[]
    AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_attribute attribute
        WHERE attribute.attrelid IN (receipt_class.oid,outbox_class.oid)
          AND attribute.attnum>0 AND NOT attribute.attisdropped
          AND ((attribute.atttypid='pg_catalog.text'::pg_catalog.regtype AND attribute.attcollation<>'pg_catalog."C"'::pg_catalog.regcollation)
            OR (attribute.atttypid<>'pg_catalog.text'::pg_catalog.regtype AND attribute.attcollation<>0)))
    AND (SELECT count(*) FROM pg_catalog.pg_constraint constraint_entry WHERE constraint_entry.conrelid=receipt_class.oid)=4
    AND EXISTS (SELECT 1 FROM pg_catalog.pg_constraint constraint_entry WHERE constraint_entry.conrelid=receipt_class.oid AND constraint_entry.contype='p' AND constraint_entry.conkey=ARRAY[(SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid=receipt_class.oid AND attname='result_identity')]::smallint[] AND constraint_entry.conindid<>0 AND NOT constraint_entry.condeferrable AND NOT constraint_entry.condeferred AND constraint_entry.convalidated)
    AND EXISTS (SELECT 1 FROM pg_catalog.pg_constraint constraint_entry WHERE constraint_entry.conrelid=receipt_class.oid AND constraint_entry.contype='u' AND constraint_entry.conkey=ARRAY[(SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid=receipt_class.oid AND attname='receipt_identity')]::smallint[] AND constraint_entry.conindid<>0 AND NOT constraint_entry.condeferrable AND NOT constraint_entry.condeferred AND constraint_entry.convalidated)
    AND EXISTS (SELECT 1 FROM pg_catalog.pg_constraint constraint_entry WHERE constraint_entry.conrelid=receipt_class.oid AND constraint_entry.contype='u' AND constraint_entry.conkey=ARRAY[(SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid=receipt_class.oid AND attname='outbox_event_identity')]::smallint[] AND constraint_entry.conindid<>0 AND NOT constraint_entry.condeferrable AND NOT constraint_entry.condeferred AND constraint_entry.convalidated)
    AND EXISTS (SELECT 1 FROM pg_catalog.pg_constraint constraint_entry WHERE constraint_entry.conrelid=receipt_class.oid AND constraint_entry.confrelid='public.backtest_replay_results_v2'::pg_catalog.regclass AND constraint_entry.contype='f' AND constraint_entry.conkey=ARRAY[(SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid=receipt_class.oid AND attname='result_identity')]::smallint[] AND constraint_entry.confkey=ARRAY[(SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid='public.backtest_replay_results_v2'::pg_catalog.regclass AND attname='result_identity')]::smallint[] AND constraint_entry.confupdtype='a' AND constraint_entry.confdeltype='a' AND constraint_entry.confmatchtype='s' AND NOT constraint_entry.condeferrable AND NOT constraint_entry.condeferred AND constraint_entry.convalidated)
    AND (SELECT count(*) FROM pg_catalog.pg_constraint constraint_entry WHERE constraint_entry.conrelid=outbox_class.oid)=5
    AND EXISTS (SELECT 1 FROM pg_catalog.pg_constraint constraint_entry WHERE constraint_entry.conrelid=outbox_class.oid AND constraint_entry.contype='p' AND constraint_entry.conkey=ARRAY[(SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid=outbox_class.oid AND attname='result_identity')]::smallint[] AND constraint_entry.conindid<>0 AND NOT constraint_entry.condeferrable AND NOT constraint_entry.condeferred AND constraint_entry.convalidated)
    AND EXISTS (SELECT 1 FROM pg_catalog.pg_constraint constraint_entry WHERE constraint_entry.conrelid=outbox_class.oid AND constraint_entry.contype='u' AND constraint_entry.conkey=ARRAY[(SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid=outbox_class.oid AND attname='event_identity')]::smallint[] AND constraint_entry.conindid<>0 AND NOT constraint_entry.condeferrable AND NOT constraint_entry.condeferred AND constraint_entry.convalidated)
    AND EXISTS (SELECT 1 FROM pg_catalog.pg_constraint constraint_entry WHERE constraint_entry.conrelid=outbox_class.oid AND constraint_entry.contype='u' AND constraint_entry.conkey=ARRAY[(SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid=outbox_class.oid AND attname='receipt_identity')]::smallint[] AND constraint_entry.conindid<>0 AND NOT constraint_entry.condeferrable AND NOT constraint_entry.condeferred AND constraint_entry.convalidated)
    AND EXISTS (SELECT 1 FROM pg_catalog.pg_constraint constraint_entry WHERE constraint_entry.conrelid=outbox_class.oid AND constraint_entry.confrelid='public.backtest_replay_results_v2'::pg_catalog.regclass AND constraint_entry.contype='f' AND constraint_entry.conkey=ARRAY[(SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid=outbox_class.oid AND attname='result_identity')]::smallint[] AND constraint_entry.confkey=ARRAY[(SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid='public.backtest_replay_results_v2'::pg_catalog.regclass AND attname='result_identity')]::smallint[] AND constraint_entry.confupdtype='a' AND constraint_entry.confdeltype='a' AND constraint_entry.confmatchtype='s' AND NOT constraint_entry.condeferrable AND NOT constraint_entry.condeferred AND constraint_entry.convalidated)
    AND EXISTS (SELECT 1 FROM pg_catalog.pg_constraint constraint_entry WHERE constraint_entry.conrelid=outbox_class.oid AND constraint_entry.confrelid=receipt_class.oid AND constraint_entry.contype='f' AND constraint_entry.conkey=ARRAY[(SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid=outbox_class.oid AND attname='receipt_identity')]::smallint[] AND constraint_entry.confkey=ARRAY[(SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid=receipt_class.oid AND attname='receipt_identity')]::smallint[] AND constraint_entry.confupdtype='a' AND constraint_entry.confdeltype='a' AND constraint_entry.confmatchtype='s' AND NOT constraint_entry.condeferrable AND NOT constraint_entry.condeferred AND constraint_entry.convalidated)
    AND (SELECT count(*) FROM pg_catalog.pg_index index_entry WHERE index_entry.indrelid=receipt_class.oid)=3
    AND (SELECT count(*) FROM pg_catalog.pg_index index_entry WHERE index_entry.indrelid=outbox_class.oid)=3
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_index index_entry WHERE index_entry.indrelid IN (receipt_class.oid,outbox_class.oid) AND (NOT index_entry.indisvalid OR NOT index_entry.indisready OR NOT index_entry.indislive OR NOT index_entry.indisunique OR NOT index_entry.indimmediate OR index_entry.indisexclusion OR index_entry.indisclustered OR index_entry.indisreplident OR index_entry.indnullsnotdistinct OR index_entry.indexprs IS NOT NULL OR index_entry.indpred IS NOT NULL OR index_entry.indnatts<>index_entry.indnkeyatts OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint constraint_entry WHERE constraint_entry.conindid=index_entry.indexrelid AND constraint_entry.conrelid=index_entry.indrelid)))
    AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_index index_entry
        JOIN pg_catalog.pg_class index_class ON index_class.oid=index_entry.indexrelid
        WHERE index_entry.indrelid IN (receipt_class.oid,outbox_class.oid)
          AND (index_class.relkind<>'i' OR index_class.relpersistence<>'p' OR index_class.reloptions IS NOT NULL
            OR index_class.reltablespace<>0 OR pg_catalog.pg_get_userbyid(index_class.relowner)<>'backtest_owner'
            OR index_class.relam<>(SELECT access_method.oid FROM pg_catalog.pg_am access_method WHERE access_method.amname='btree')
            OR EXISTS (
              SELECT 1 FROM pg_catalog.generate_series(0,index_entry.indnkeyatts::integer-1) key_position
              JOIN pg_catalog.pg_attribute indexed_attribute
                ON indexed_attribute.attrelid=index_entry.indrelid AND indexed_attribute.attnum=index_entry.indkey[key_position]
              JOIN pg_catalog.pg_opclass operator_class ON operator_class.oid=index_entry.indclass[key_position]
              JOIN pg_catalog.pg_namespace operator_namespace ON operator_namespace.oid=operator_class.opcnamespace
              WHERE index_entry.indcollation[key_position]<>indexed_attribute.attcollation
                OR index_entry.indoption[key_position]<>0
                OR operator_namespace.nspname<>'pg_catalog'
                OR operator_class.opcname<>'text_ops'
                OR operator_class.opcintype<>'pg_catalog.text'::pg_catalog.regtype
                OR operator_class.opcmethod<>index_class.relam)))
    AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_depend dependency_entry
        WHERE dependency_entry.classid='pg_catalog.pg_class'::pg_catalog.regclass
          AND dependency_entry.objid IN (receipt_class.oid,outbox_class.oid)
          AND NOT (
            dependency_entry.deptype='n' AND dependency_entry.refobjsubid=0 AND (
              (dependency_entry.objsubid=0
                AND dependency_entry.refclassid='pg_catalog.pg_namespace'::pg_catalog.regclass
                AND dependency_entry.refobjid=receipt_class.relnamespace)
              OR (dependency_entry.objsubid=0
                AND dependency_entry.refclassid='pg_catalog.pg_am'::pg_catalog.regclass
                AND dependency_entry.refobjid IN (receipt_class.relam,outbox_class.relam))
              OR (dependency_entry.objsubid>0
                AND dependency_entry.refclassid='pg_catalog.pg_type'::pg_catalog.regclass
                AND EXISTS (SELECT 1 FROM pg_catalog.pg_attribute attribute
                  WHERE attribute.attrelid=dependency_entry.objid AND attribute.attnum=dependency_entry.objsubid
                    AND attribute.atttypid=dependency_entry.refobjid))
              OR (dependency_entry.objsubid>0
                AND dependency_entry.refclassid='pg_catalog.pg_collation'::pg_catalog.regclass
                AND EXISTS (SELECT 1 FROM pg_catalog.pg_attribute attribute
                  WHERE attribute.attrelid=dependency_entry.objid AND attribute.attnum=dependency_entry.objsubid
                    AND attribute.attcollation=dependency_entry.refobjid)))))
    AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_depend dependency_entry
        WHERE dependency_entry.deptype IN ('e','x') AND (
          (dependency_entry.classid='pg_catalog.pg_class'::pg_catalog.regclass AND (
            dependency_entry.objid IN (receipt_class.oid,outbox_class.oid)
            OR dependency_entry.objid IN (SELECT index_entry.indexrelid FROM pg_catalog.pg_index index_entry WHERE index_entry.indrelid IN (receipt_class.oid,outbox_class.oid))
            OR dependency_entry.objid IN (receipt_class.reltoastrelid,outbox_class.reltoastrelid)
            OR dependency_entry.objid IN (SELECT toast_index.indexrelid FROM pg_catalog.pg_index toast_index WHERE toast_index.indrelid IN (receipt_class.reltoastrelid,outbox_class.reltoastrelid))))
          OR (dependency_entry.classid='pg_catalog.pg_constraint'::pg_catalog.regclass
            AND dependency_entry.objid IN (SELECT constraint_entry.oid FROM pg_catalog.pg_constraint constraint_entry WHERE constraint_entry.conrelid IN (receipt_class.oid,outbox_class.oid)))
          OR (dependency_entry.classid='pg_catalog.pg_type'::pg_catalog.regclass
            AND dependency_entry.objid IN (receipt_class.reltype,outbox_class.reltype))))
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint constraint_entry WHERE constraint_entry.contype='f' AND constraint_entry.conrelid NOT IN ('public.backtest_replay_runs_v2'::pg_catalog.regclass,'public.backtest_replay_results_v2'::pg_catalog.regclass,receipt_class.oid,outbox_class.oid) AND constraint_entry.confrelid IN (receipt_class.oid,outbox_class.oid))
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger trigger_entry WHERE trigger_entry.tgrelid IN (receipt_class.oid,outbox_class.oid) AND NOT trigger_entry.tgisinternal)
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_rewrite rule_entry WHERE rule_entry.ev_class IN (receipt_class.oid,outbox_class.oid))
    AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_rewrite rule_entry
        JOIN pg_catalog.pg_depend dependency_entry ON dependency_entry.classid='pg_catalog.pg_rewrite'::pg_catalog.regclass
          AND dependency_entry.objid=rule_entry.oid AND dependency_entry.refclassid='pg_catalog.pg_class'::pg_catalog.regclass
          AND dependency_entry.refobjid IN (receipt_class.oid,outbox_class.oid) AND dependency_entry.deptype='n'
        WHERE rule_entry.ev_class NOT IN (receipt_class.oid,outbox_class.oid))
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policy policy_entry WHERE policy_entry.polrelid IN (receipt_class.oid,outbox_class.oid))
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_inherits inheritance_entry WHERE inheritance_entry.inhrelid IN (receipt_class.oid,outbox_class.oid) OR inheritance_entry.inhparent IN (receipt_class.oid,outbox_class.oid))
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_statistic_ext statistic_entry WHERE statistic_entry.stxrelid IN (receipt_class.oid,outbox_class.oid))
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_publication_tables publication_entry WHERE publication_entry.schemaname='public' AND publication_entry.tablename IN ('backtest_replay_result_receipts_v1','backtest_replay_result_outbox_v1'))
FROM pg_catalog.pg_class receipt_class,pg_catalog.pg_class outbox_class
WHERE receipt_class.oid='public.backtest_replay_result_receipts_v1'::pg_catalog.regclass
  AND outbox_class.oid='public.backtest_replay_result_outbox_v1'::pg_catalog.regclass"#;

/// Non-authoritative, pre-send-known locator for one exact request/result pair.
///
/// Receipt and outbox identities are deliberately absent: their canonical bytes contain the Owner
/// commit timestamp and therefore cannot be known before the first committed response exists.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExploratoryResultLocatorV1 {
    pub request_identity: OpaqueIdentityV2,
    pub request_meaning_digest: CanonicalDigestV2,
    pub result_identity: OpaqueIdentityV2,
    pub result_digest: CanonicalDigestV2,
}

/// Caller-authored query for the fixed exploratory-only facade.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExploratoryResultCustodyQueryV1 {
    pub schema_version: u16,
    pub locator: ExploratoryResultLocatorV1,
}

/// Untrusted bytes returned by the fixed Backtest facade.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct UntrustedResultCustodyEnvelopeV1 {
    pub schema_version: u16,
    pub canonical_result_bytes: Vec<u8>,
    pub canonical_receipt_bytes: Vec<u8>,
    pub canonical_outbox_bytes: Vec<u8>,
}

#[derive(Debug)]
struct ValidatedExploratoryResultEnvelopeV1 {
    result: ReplayResultDtoV2,
    receipt: BacktestResultReceiptV1,
    outbox: BacktestResultOutboxV1,
    canonical_result_bytes: Vec<u8>,
    canonical_receipt_bytes: Vec<u8>,
    canonical_outbox_bytes: Vec<u8>,
}

/// Move-only positive Backtest Owner readback.
///
/// It has no public constructor and does not implement `Clone`, `Serialize`, or `Deserialize`.
#[derive(Debug)]
pub struct SealedExploratoryResultReadbackV1 {
    validated: ValidatedExploratoryResultEnvelopeV1,
}

impl SealedExploratoryResultReadbackV1 {
    #[must_use]
    pub const fn result(&self) -> &ReplayResultDtoV2 {
        &self.validated.result
    }

    #[must_use]
    pub const fn receipt(&self) -> &BacktestResultReceiptV1 {
        &self.validated.receipt
    }

    #[must_use]
    pub const fn outbox(&self) -> &BacktestResultOutboxV1 {
        &self.validated.outbox
    }

    #[must_use]
    pub fn canonical_result_bytes(&self) -> &[u8] {
        &self.validated.canonical_result_bytes
    }

    #[must_use]
    pub fn canonical_receipt_bytes(&self) -> &[u8] {
        &self.validated.canonical_receipt_bytes
    }

    #[must_use]
    pub fn canonical_outbox_bytes(&self) -> &[u8] {
        &self.validated.canonical_outbox_bytes
    }
}

/// Locks and validates a pre-existing exact exploratory Result custody set inside the caller's
/// transaction. Missing custody is a read-only negative result and never creates first custody.
pub async fn lock_exploratory_result_v1_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    query: &ExploratoryResultCustodyQueryV1,
) -> Result<Option<SealedExploratoryResultReadbackV1>, ResultCustodyErrorV1> {
    require_schema("query", query.schema_version, QUERY_SCHEMA_V1)?;
    validate_boundary(transaction).await?;
    let rows = sqlx::query(
        "SELECT * FROM backtest_owner_api.lock_exploratory_result_v1($1,$2,$3,$4) LIMIT 2",
    )
    .bind(query.locator.request_identity.as_str())
    .bind(query.locator.request_meaning_digest.as_str())
    .bind(query.locator.result_identity.as_str())
    .bind(query.locator.result_digest.as_str())
    .fetch_all(&mut **transaction)
    .await
    .map_err(|_| ResultCustodyErrorV1::CustodyUnavailable)?;
    let row = match rows.as_slice() {
        [] => return Ok(None),
        [row] => row,
        _ => return Err(ResultCustodyErrorV1::CustodyUnavailable),
    };
    let request_canonical_bytes: Vec<u8> = row.try_get("request_canonical_bytes")?;
    let validated = validate_untrusted_envelope(
        query,
        UntrustedResultCustodyEnvelopeV1 {
            schema_version: ENVELOPE_SCHEMA_V1,
            canonical_result_bytes: row.try_get("canonical_result_bytes")?,
            canonical_receipt_bytes: row.try_get("canonical_receipt_bytes")?,
            canonical_outbox_bytes: row.try_get("canonical_outbox_bytes")?,
        },
    )?;
    validate_stored_row(row, query, &request_canonical_bytes, &validated)?;
    Ok(Some(SealedExploratoryResultReadbackV1 { validated }))
}

fn validate_stored_row(
    row: &sqlx::postgres::PgRow,
    query: &ExploratoryResultCustodyQueryV1,
    request_canonical_bytes: &[u8],
    validated: &ValidatedExploratoryResultEnvelopeV1,
) -> Result<(), ResultCustodyErrorV1> {
    let request_dto: ReplayRequestDtoV2 = parse_canonical("request", request_canonical_bytes)?;
    let request = ReplayRequestV2::try_from(request_dto)
        .map_err(|_| ResultCustodyErrorV1::MalformedCanonicalBytes("request"))?;
    let request_meaning_digest = request
        .meaning_digest()
        .map_err(|_| ResultCustodyErrorV1::CanonicalEncodingUnavailable)?;
    let request_seal_digest: String = row.try_get("request_seal_digest")?;
    let rd_receipt_identity: String = row.try_get("rd_receipt_identity")?;
    let result = &validated.result;
    let receipt = &validated.receipt;
    let outbox = &validated.outbox;
    let receipt_committed_at_epoch_ms: i64 = row.try_get("receipt_committed_at_epoch_ms")?;
    let outbox_committed_at_epoch_ms: i64 = row.try_get("outbox_committed_at_epoch_ms")?;

    let valid = request.to_canonical_bytes().ok().as_deref() == Some(request_canonical_bytes)
        && request.request_identity() == &query.locator.request_identity
        && request_meaning_digest == query.locator.request_meaning_digest
        && !request_seal_digest.is_empty()
        && !rd_receipt_identity.is_empty()
        && row.try_get::<String, _>("request_canonical_bytes_blake3")?
            == canonical_bytes_digest(REQUEST_STORAGE_DOMAIN, request_canonical_bytes)
        && row.try_get::<String, _>("request_binding_blake3")?
            == request_binding_digest(
                request_canonical_bytes,
                &request_seal_digest,
                &rd_receipt_identity,
            )
        && row.try_get::<String, _>("run_request_identity")? == request.request_identity().as_str()
        && row.try_get::<String, _>("run_request_meaning_digest")?
            == request_meaning_digest.as_str()
        && row.try_get::<String, _>("run_attempt_identity")? == result.attempt_identity.as_str()
        && row.try_get::<String, _>("run_result_identity")? == result.result_identity.as_str()
        && row.try_get::<String, _>("run_result_digest")? == result.result_digest.as_str()
        && row.try_get::<String, _>("run_terminal")? == terminal_text(result.terminal)
        && row.try_get::<String, _>("result_identity")? == result.result_identity.as_str()
        && row.try_get::<String, _>("result_digest")? == result.result_digest.as_str()
        && row.try_get::<String, _>("result_request_identity")? == result.request_identity.as_str()
        && row.try_get::<String, _>("result_request_meaning_digest")?
            == result.request_meaning_digest.as_str()
        && row.try_get::<String, _>("result_attempt_identity")? == result.attempt_identity.as_str()
        && row.try_get::<String, _>("result_terminal")? == terminal_text(result.terminal)
        && row.try_get::<String, _>("result_canonical_bytes_blake3")?
            == canonical_bytes_digest(RESULT_STORAGE_DOMAIN, &validated.canonical_result_bytes)
        && row.try_get::<String, _>("receipt_result_identity")? == receipt.result_identity.as_str()
        && row.try_get::<String, _>("receipt_identity")? == receipt.receipt_identity.as_str()
        && row.try_get::<String, _>("receipt_digest")? == receipt.receipt_digest.as_str()
        && row.try_get::<String, _>("receipt_request_identity")?
            == receipt.request_identity.as_str()
        && row.try_get::<String, _>("receipt_request_meaning_digest")?
            == receipt.request_meaning_digest.as_str()
        && row.try_get::<String, _>("receipt_result_digest")? == receipt.result_digest.as_str()
        && row.try_get::<String, _>("receipt_namespace")? == "EXPLORATORY"
        && row.try_get::<String, _>("outbox_event_identity")?
            == receipt.outbox_event_identity.as_str()
        && u64::try_from(receipt_committed_at_epoch_ms).ok() == Some(receipt.committed_at_epoch_ms)
        && row.try_get::<String, _>("receipt_canonical_bytes_blake3")?
            == canonical_bytes_digest(RECEIPT_STORAGE_DOMAIN, &validated.canonical_receipt_bytes)
        && row.try_get::<String, _>("outbox_result_identity")?
            == outbox.aggregate_identity.as_str()
        && row.try_get::<String, _>("event_identity")? == outbox.event_identity.as_str()
        && row.try_get::<String, _>("event_digest")? == outbox.event_digest.as_str()
        && row.try_get::<String, _>("outbox_receipt_identity")?
            == outbox.payload.receipt_identity.as_str()
        && row.try_get::<String, _>("outbox_request_identity")?
            == outbox.payload.request_identity.as_str()
        && row.try_get::<String, _>("outbox_request_meaning_digest")?
            == outbox.payload.request_meaning_digest.as_str()
        && row.try_get::<String, _>("outbox_result_digest")?
            == outbox.payload.result_digest.as_str()
        && row.try_get::<String, _>("outbox_namespace")? == "EXPLORATORY"
        && row.try_get::<String, _>("payload_digest")? == outbox.payload_digest.as_str()
        && u64::try_from(outbox_committed_at_epoch_ms).ok() == Some(outbox.committed_at_epoch_ms)
        && row.try_get::<String, _>("outbox_canonical_bytes_blake3")?
            == canonical_bytes_digest(OUTBOX_STORAGE_DOMAIN, &validated.canonical_outbox_bytes);
    if valid {
        Ok(())
    } else {
        Err(ResultCustodyErrorV1::CustodyUnavailable)
    }
}

fn validate_untrusted_envelope(
    query: &ExploratoryResultCustodyQueryV1,
    envelope: UntrustedResultCustodyEnvelopeV1,
) -> Result<ValidatedExploratoryResultEnvelopeV1, ResultCustodyErrorV1> {
    require_schema("envelope", envelope.schema_version, ENVELOPE_SCHEMA_V1)?;
    let result: ReplayResultDtoV2 = parse_canonical("result", &envelope.canonical_result_bytes)?;
    validate_result(query, &result)?;
    let receipt: BacktestResultReceiptV1 =
        parse_canonical("receipt", &envelope.canonical_receipt_bytes)?;
    validate_receipt(&result, &receipt)?;
    let outbox: BacktestResultOutboxV1 =
        parse_canonical("outbox", &envelope.canonical_outbox_bytes)?;
    validate_outbox(&result, &receipt, &outbox)?;
    Ok(ValidatedExploratoryResultEnvelopeV1 {
        result,
        receipt,
        outbox,
        canonical_result_bytes: envelope.canonical_result_bytes,
        canonical_receipt_bytes: envelope.canonical_receipt_bytes,
        canonical_outbox_bytes: envelope.canonical_outbox_bytes,
    })
}

async fn validate_boundary(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<(), ResultCustodyErrorV1> {
    let primary_shape: bool = sqlx::query_scalar(PRIMARY_STORAGE_SHAPE_V2)
        .fetch_optional(&mut **transaction)
        .await
        .map_err(|_| ResultCustodyErrorV1::CustodyUnavailable)?
        .unwrap_or(false);
    let auxiliary_shape: bool = sqlx::query_scalar(AUXILIARY_STORAGE_SHAPE_V1)
        .fetch_optional(&mut **transaction)
        .await
        .map_err(|_| ResultCustodyErrorV1::CustodyUnavailable)?
        .unwrap_or(false);
    if !primary_shape || !auxiliary_shape {
        return Err(ResultCustodyErrorV1::CustodyUnavailable);
    }
    let valid: bool = sqlx::query_scalar(
        "SELECT
          session_user='rd_owner' AND current_user='rd_owner'
          AND NOT EXISTS (
            SELECT 1 FROM pg_catalog.pg_roles role_entry
            WHERE role_entry.rolname IN ('rd_owner','backtest_owner')
              AND (role_entry.rolsuper OR role_entry.rolcreaterole OR role_entry.rolcreatedb
                OR role_entry.rolreplication OR role_entry.rolbypassrls)
          )
          AND NOT pg_catalog.pg_has_role('rd_owner','backtest_owner','USAGE')
          AND NOT pg_catalog.pg_has_role('rd_owner','backtest_owner','SET')
          AND NOT pg_catalog.pg_has_role('backtest_owner','rd_owner','USAGE')
          AND NOT pg_catalog.pg_has_role('backtest_owner','rd_owner','SET')
          AND NOT EXISTS (
            SELECT 1 FROM pg_catalog.pg_roles role_entry
            WHERE role_entry.rolname<>'backtest_owner' AND NOT role_entry.rolsuper
              AND (pg_catalog.pg_has_role(role_entry.oid,'backtest_owner','USAGE')
                OR pg_catalog.pg_has_role(role_entry.oid,'backtest_owner','SET')))
          AND NOT EXISTS (
            SELECT 1 FROM pg_catalog.pg_roles role_entry
            WHERE role_entry.rolname<>'rd_owner' AND NOT role_entry.rolsuper
              AND (pg_catalog.pg_has_role(role_entry.oid,'rd_owner','USAGE')
                OR pg_catalog.pg_has_role(role_entry.oid,'rd_owner','SET')))
          AND NOT EXISTS (
            SELECT 1 FROM pg_catalog.pg_roles role_entry
            WHERE role_entry.rolname NOT IN ('rd_owner','backtest_owner')
              AND (role_entry.rolsuper OR role_entry.rolcreaterole OR role_entry.rolcreatedb
                OR role_entry.rolreplication OR role_entry.rolbypassrls
                OR EXISTS (
                  SELECT 1 FROM pg_catalog.pg_namespace authority_namespace
                  WHERE authority_namespace.nspowner=role_entry.oid
                    AND authority_namespace.nspname NOT IN ('pg_catalog','information_schema','pg_toast')
                    AND authority_namespace.nspname NOT LIKE 'pg_temp_%'
                    AND authority_namespace.nspname NOT LIKE 'pg_toast_temp_%')
                OR EXISTS (
                  SELECT 1 FROM pg_catalog.pg_class authority_class
                  JOIN pg_catalog.pg_namespace authority_namespace ON authority_namespace.oid=authority_class.relnamespace
                  WHERE authority_class.relowner=role_entry.oid
                    AND authority_namespace.nspname NOT IN ('pg_catalog','information_schema','pg_toast')
                    AND authority_namespace.nspname NOT LIKE 'pg_temp_%'
                    AND authority_namespace.nspname NOT LIKE 'pg_toast_temp_%')
                OR EXISTS (
                  SELECT 1 FROM pg_catalog.pg_class authority_class
                  JOIN pg_catalog.pg_namespace authority_namespace ON authority_namespace.oid=authority_class.relnamespace
                  CROSS JOIN LATERAL pg_catalog.aclexplode(authority_class.relacl) authority_acl
                  WHERE authority_acl.grantee=role_entry.oid
                    AND authority_acl.privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER')
                    AND authority_namespace.nspname NOT IN ('pg_catalog','information_schema','pg_toast')
                    AND authority_namespace.nspname NOT LIKE 'pg_temp_%'
                    AND authority_namespace.nspname NOT LIKE 'pg_toast_temp_%')
                OR EXISTS (
                  SELECT 1 FROM pg_catalog.pg_proc authority_procedure
                  JOIN pg_catalog.pg_namespace authority_namespace ON authority_namespace.oid=authority_procedure.pronamespace
                  WHERE authority_procedure.proowner=role_entry.oid
                    AND authority_namespace.nspname NOT IN ('pg_catalog','information_schema')
                    AND authority_namespace.nspname NOT LIKE 'pg_temp_%')
                OR EXISTS (
                  SELECT 1 FROM pg_catalog.pg_proc authority_procedure
                  JOIN pg_catalog.pg_namespace authority_namespace ON authority_namespace.oid=authority_procedure.pronamespace
                  CROSS JOIN LATERAL pg_catalog.aclexplode(authority_procedure.proacl) authority_acl
                  WHERE authority_acl.grantee=role_entry.oid
                    AND authority_acl.privilege_type='EXECUTE'
                    AND authority_procedure.prosecdef
                    AND authority_namespace.nspname NOT IN ('pg_catalog','information_schema')
                    AND authority_namespace.nspname NOT LIKE 'pg_temp_%'))
              AND (pg_catalog.pg_has_role('backtest_owner',role_entry.oid,'USAGE')
                OR pg_catalog.pg_has_role('backtest_owner',role_entry.oid,'SET')
                OR pg_catalog.pg_has_role('rd_owner',role_entry.oid,'USAGE')
                OR pg_catalog.pg_has_role('rd_owner',role_entry.oid,'SET')))
          AND (SELECT pg_catalog.pg_get_userbyid(namespace_entry.nspowner)='backtest_owner'
               FROM pg_catalog.pg_namespace namespace_entry WHERE namespace_entry.nspname=$1)
          AND (SELECT count(*)=4 AND bool_and(pg_catalog.pg_get_userbyid(class_entry.relowner)='backtest_owner')
               FROM pg_catalog.pg_class class_entry JOIN pg_catalog.pg_namespace namespace_entry ON namespace_entry.oid=class_entry.relnamespace
               WHERE namespace_entry.nspname='public' AND class_entry.relname IN ('backtest_replay_runs_v2','backtest_replay_results_v2','backtest_replay_result_receipts_v1','backtest_replay_result_outbox_v1'))
          AND NOT EXISTS (
            SELECT 1 FROM pg_catalog.pg_class class_entry
            CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(class_entry.relacl,pg_catalog.acldefault('r',class_entry.relowner))) acl_entry
            JOIN pg_catalog.pg_namespace namespace_entry ON namespace_entry.oid=class_entry.relnamespace
            WHERE namespace_entry.nspname='public' AND class_entry.relname IN ('backtest_replay_runs_v2','backtest_replay_results_v2','backtest_replay_result_receipts_v1','backtest_replay_result_outbox_v1')
              AND acl_entry.grantee<>class_entry.relowner)
          AND NOT EXISTS (
            SELECT 1 FROM pg_catalog.pg_roles role_entry
            WHERE role_entry.rolname<>'backtest_owner' AND NOT role_entry.rolsuper
              AND (pg_catalog.has_table_privilege(role_entry.oid,'public.backtest_replay_runs_v2','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
                OR pg_catalog.has_table_privilege(role_entry.oid,'public.backtest_replay_results_v2','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
                OR pg_catalog.has_table_privilege(role_entry.oid,'public.backtest_replay_result_receipts_v1','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
                OR pg_catalog.has_table_privilege(role_entry.oid,'public.backtest_replay_result_outbox_v1','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')))
          AND (SELECT pg_catalog.pg_get_userbyid(facade.proowner)='backtest_owner'
                       AND facade.prosecdef AND facade.provolatile='v' AND NOT facade.proleakproof
                       AND facade.proparallel='u' AND facade.proisstrict
                       AND language_entry.lanname='sql' AND facade.proretset AND facade.pronargs=4
                       AND facade.proargnames=ARRAY['requested_request_identity','requested_request_meaning_digest','requested_result_identity','requested_result_digest','run_request_identity','run_request_meaning_digest','request_seal_digest','rd_receipt_identity','request_binding_blake3','request_canonical_bytes','request_canonical_bytes_blake3','run_attempt_identity','run_result_identity','run_result_digest','run_terminal','result_identity','result_digest','result_request_identity','result_request_meaning_digest','result_attempt_identity','result_terminal','canonical_result_bytes','result_canonical_bytes_blake3','receipt_result_identity','receipt_identity','receipt_digest','receipt_request_identity','receipt_request_meaning_digest','receipt_result_digest','receipt_namespace','outbox_event_identity','receipt_committed_at_epoch_ms','canonical_receipt_bytes','receipt_canonical_bytes_blake3','outbox_result_identity','event_identity','event_digest','outbox_receipt_identity','outbox_request_identity','outbox_request_meaning_digest','outbox_result_digest','outbox_namespace','payload_digest','outbox_committed_at_epoch_ms','canonical_outbox_bytes','outbox_canonical_bytes_blake3']::text[]
                       AND facade.proargtypes='25 25 25 25'::pg_catalog.oidvector
                       AND facade.prorettype='pg_catalog.record'::pg_catalog.regtype
                       AND pg_catalog.cardinality(facade.proallargtypes)=46
                       AND pg_catalog.cardinality(facade.proargmodes)=46
                       AND facade.proargmodes[1:4]=pg_catalog.array_fill('i'::\"char\",ARRAY[4])
                       AND facade.proargmodes[5:46]=pg_catalog.array_fill('t'::\"char\",ARRAY[42])
                       AND NOT EXISTS (
                         SELECT 1 FROM pg_catalog.generate_subscripts(facade.proallargtypes,1) argument_position
                         WHERE facade.proallargtypes[argument_position]<>(CASE
                           WHEN argument_position IN (10,22,33,45) THEN 'pg_catalog.bytea'::pg_catalog.regtype::oid
                           WHEN argument_position IN (32,44) THEN 'pg_catalog.int8'::pg_catalog.regtype::oid
                           ELSE 'pg_catalog.text'::pg_catalog.regtype::oid END))
                       AND facade.proconfig=ARRAY['search_path=pg_catalog']::text[]
                       AND facade.prosrc=$2
               FROM pg_catalog.pg_proc facade JOIN pg_catalog.pg_language language_entry ON language_entry.oid=facade.prolang
               WHERE facade.oid=pg_catalog.to_regprocedure($3))
          AND pg_catalog.has_schema_privilege('rd_owner',$1,'USAGE')
          AND pg_catalog.has_function_privilege('rd_owner',$3,'EXECUTE')
          AND NOT pg_catalog.has_schema_privilege('public',$1,'USAGE')
          AND NOT pg_catalog.has_function_privilege('public',$3,'EXECUTE')
          AND NOT EXISTS (
            SELECT 1 FROM pg_catalog.pg_namespace namespace_entry
            CROSS JOIN LATERAL pg_catalog.aclexplode(namespace_entry.nspacl) acl_entry
            JOIN pg_catalog.pg_roles grantee ON grantee.oid=acl_entry.grantee
            WHERE namespace_entry.nspname=$1
              AND (grantee.rolname NOT IN ('backtest_owner','rd_owner')
                OR (grantee.rolname='backtest_owner' AND acl_entry.privilege_type NOT IN ('USAGE','CREATE'))
                OR (grantee.rolname='rd_owner' AND acl_entry.privilege_type<>'USAGE')
                OR acl_entry.is_grantable))
          AND EXISTS (
            SELECT 1 FROM pg_catalog.pg_proc facade CROSS JOIN LATERAL pg_catalog.aclexplode(facade.proacl) acl_entry
            JOIN pg_catalog.pg_roles grantee ON grantee.oid=acl_entry.grantee
            JOIN pg_catalog.pg_roles grantor ON grantor.oid=acl_entry.grantor
            WHERE facade.oid=pg_catalog.to_regprocedure($3) AND grantee.rolname='rd_owner'
              AND grantor.rolname='backtest_owner' AND acl_entry.privilege_type='EXECUTE' AND NOT acl_entry.is_grantable)
          AND NOT EXISTS (
            SELECT 1 FROM pg_catalog.pg_proc facade CROSS JOIN LATERAL pg_catalog.aclexplode(facade.proacl) acl_entry
            JOIN pg_catalog.pg_roles grantee ON grantee.oid=acl_entry.grantee
            WHERE facade.oid=pg_catalog.to_regprocedure($3)
              AND (grantee.rolname NOT IN ('backtest_owner','rd_owner') OR acl_entry.privilege_type<>'EXECUTE' OR acl_entry.is_grantable))",
    )
    .bind(FACADE_SCHEMA)
    .bind(LOCK_EXPLORATORY_RESULT_SOURCE_V1)
    .bind(FACADE_SIGNATURE)
    .fetch_one(&mut **transaction)
    .await
    .map_err(|_| ResultCustodyErrorV1::CustodyUnavailable)?;
    if valid {
        Ok(())
    } else {
        Err(ResultCustodyErrorV1::CustodyUnavailable)
    }
}

fn validate_result(
    query: &ExploratoryResultCustodyQueryV1,
    result: &ReplayResultDtoV2,
) -> Result<(), ResultCustodyErrorV1> {
    if result.namespace != ReplayNamespaceV2::Exploratory
        || result.replay_authority != ReplayAuthorityClaimV2::Exploratory
    {
        return Err(ResultCustodyErrorV1::ProtectedNamespace);
    }
    if result.expected_result_digest().ok().as_ref() != Some(&result.result_digest) {
        return Err(ResultCustodyErrorV1::ResultDigestMismatch);
    }
    if result.expected_result_identity().ok().as_ref() != Some(&result.result_identity) {
        return Err(ResultCustodyErrorV1::ResultIdentityMismatch);
    }
    if result.request_identity != query.locator.request_identity
        || result.request_meaning_digest != query.locator.request_meaning_digest
        || result.result_identity != query.locator.result_identity
        || result.result_digest != query.locator.result_digest
    {
        return Err(ResultCustodyErrorV1::RequestResultCorrelationMismatch);
    }
    validate_result_structure(result)
}

fn validate_result_structure(result: &ReplayResultDtoV2) -> Result<(), ResultCustodyErrorV1> {
    if result.reconciliation.len() != ObservationComponentV2::REQUESTED_MEANING.len() {
        return Err(ResultCustodyErrorV1::InvalidResultStructure(
            "reconciliation census",
        ));
    }
    for component in ObservationComponentV2::REQUESTED_MEANING {
        let mut atoms = result
            .reconciliation
            .iter()
            .filter(|atom| atom.component == component);
        let Some(atom) = atoms.next() else {
            return Err(ResultCustodyErrorV1::InvalidResultStructure(
                "missing reconciliation",
            ));
        };
        if atoms.next().is_some() {
            return Err(ResultCustodyErrorV1::InvalidResultStructure(
                "duplicate reconciliation",
            ));
        }
        if atom.status == ResultReconciliationStatusV2::Exact
            && (atom.observed_meaning_identity.as_ref() != Some(&atom.requested_meaning_identity)
                || atom.observed_meaning_digest.as_ref() != Some(&atom.requested_meaning_digest)
                || atom
                    .observation_locator
                    .as_ref()
                    .map(|value| value.component)
                    != Some(component))
        {
            return Err(ResultCustodyErrorV1::InvalidResultStructure(
                "false exact reconciliation",
            ));
        }
    }
    for component in [
        ObservationComponentV2::FrozenResearchIntent,
        ObservationComponentV2::TrialFamily,
        ObservationComponentV2::TrialFamilyCensusFrontier,
        ObservationComponentV2::ReplayAuthority,
    ] {
        if !result.reconciliation.iter().any(|atom| {
            atom.component == component && atom.status == ResultReconciliationStatusV2::Exact
        }) {
            return Err(ResultCustodyErrorV1::InvalidResultStructure(
                "lineage authority",
            ));
        }
    }
    if result.terminal == ReplayTerminalV2::TerminalResult
        && (result.semantic_trace.is_none()
            || result
                .reconciliation
                .iter()
                .any(|atom| atom.status != ResultReconciliationStatusV2::Exact))
    {
        return Err(ResultCustodyErrorV1::InvalidResultStructure(
            "terminal evidence",
        ));
    }
    if let Some(trace) = &result.semantic_trace
        && (trace.request_identity != result.request_identity
            || trace.request_meaning_digest != result.request_meaning_digest
            || trace.attempt_identity != result.attempt_identity
            || trace.component != ObservationComponentV2::SemanticTrace
            || trace.locator.component != ObservationComponentV2::SemanticTrace)
    {
        return Err(ResultCustodyErrorV1::InvalidResultStructure(
            "semantic trace",
        ));
    }
    if result.diagnostic_census.is_empty()
        || result.diagnostic_census.iter().any(|diagnostic| {
            diagnostic.request_identity != result.request_identity
                || diagnostic.request_meaning_digest != result.request_meaning_digest
                || diagnostic.attempt_identity != result.attempt_identity
                || diagnostic.decisive_evidence.component != ObservationComponentV2::SemanticTrace
        })
    {
        return Err(ResultCustodyErrorV1::InvalidResultStructure(
            "diagnostic census",
        ));
    }
    let singleton = result.diagnostic_census.iter().any(|value| {
        matches!(
            value.category,
            DiagnosticCategoryV2::NoExecutionDefect | DiagnosticCategoryV2::UnresolvedFailure
        )
    });
    if singleton && result.diagnostic_census.len() != 1 {
        return Err(ResultCustodyErrorV1::InvalidResultStructure(
            "diagnostic categories",
        ));
    }
    Ok(())
}

fn validate_receipt(
    result: &ReplayResultDtoV2,
    receipt: &BacktestResultReceiptV1,
) -> Result<(), ResultCustodyErrorV1> {
    if receipt.namespace != ReplayNamespaceV2::Exploratory
        || receipt.expected_digest().ok().as_ref() != Some(&receipt.receipt_digest)
        || receipt.request_identity != result.request_identity
        || receipt.request_meaning_digest != result.request_meaning_digest
        || receipt.result_identity != result.result_identity
        || receipt.result_digest != result.result_digest
    {
        return Err(ResultCustodyErrorV1::ReceiptBindingMismatch);
    }
    Ok(())
}

fn validate_outbox(
    result: &ReplayResultDtoV2,
    receipt: &BacktestResultReceiptV1,
    outbox: &BacktestResultOutboxV1,
) -> Result<(), ResultCustodyErrorV1> {
    if outbox.payload.namespace != ReplayNamespaceV2::Exploratory
        || outbox.event_kind.as_str() != EXPLORATORY_RESULT_COMMITTED_EVENT_KIND_V1
        || outbox.expected_payload_digest().ok().as_ref() != Some(&outbox.payload_digest)
        || outbox.expected_event_digest().ok().as_ref() != Some(&outbox.event_digest)
        || outbox.aggregate_identity != result.result_identity
        || outbox.payload.receipt_identity != receipt.receipt_identity
        || outbox.payload.receipt_digest != receipt.receipt_digest
        || outbox.payload.request_identity != result.request_identity
        || outbox.payload.request_meaning_digest != result.request_meaning_digest
        || outbox.payload.result_identity != result.result_identity
        || outbox.payload.result_digest != result.result_digest
        || outbox.payload.committed_at_epoch_ms != receipt.committed_at_epoch_ms
        || outbox.committed_at_epoch_ms != receipt.committed_at_epoch_ms
        || receipt.outbox_event_identity != outbox.event_identity
    {
        return Err(ResultCustodyErrorV1::OutboxBindingMismatch);
    }
    Ok(())
}

fn parse_canonical<T: DeserializeOwned + Serialize>(
    artifact: &'static str,
    bytes: &[u8],
) -> Result<T, ResultCustodyErrorV1> {
    let mut deserializer = serde_json::Deserializer::from_slice(bytes);
    let value = T::deserialize(&mut deserializer)
        .map_err(|_| ResultCustodyErrorV1::MalformedCanonicalBytes(artifact))?;
    deserializer
        .end()
        .map_err(|_| ResultCustodyErrorV1::NonCanonicalBytes(artifact))?;
    if serde_json::to_vec(&value).map_err(|_| ResultCustodyErrorV1::CanonicalEncodingUnavailable)?
        != bytes
    {
        return Err(ResultCustodyErrorV1::NonCanonicalBytes(artifact));
    }
    Ok(value)
}

fn canonical_bytes_digest(domain: &str, bytes: &[u8]) -> String {
    let mut hasher = blake3::Hasher::new();
    hasher.update(domain.as_bytes());
    hasher.update(&[0]);
    hasher.update(bytes);
    format!("blake3:{}", hasher.finalize().to_hex())
}

fn request_binding_digest(
    request_canonical_bytes: &[u8],
    request_seal_digest: &str,
    rd_receipt_identity: &str,
) -> String {
    let mut hasher = blake3::Hasher::new();
    hasher.update(REQUEST_BINDING_DOMAIN.as_bytes());
    for value in [
        request_canonical_bytes,
        request_seal_digest.as_bytes(),
        rd_receipt_identity.as_bytes(),
    ] {
        hasher.update(&(value.len() as u64).to_be_bytes());
        hasher.update(value);
    }
    format!("blake3:{}", hasher.finalize().to_hex())
}

const fn terminal_text(terminal: ReplayTerminalV2) -> &'static str {
    match terminal {
        ReplayTerminalV2::TerminalResult => "TERMINAL_RESULT",
        ReplayTerminalV2::InvalidReplayEvidence => "INVALID_REPLAY_EVIDENCE",
        ReplayTerminalV2::RunRejected => "RUN_REJECTED",
        ReplayTerminalV2::InProgressOrUnknown => "IN_PROGRESS_OR_UNKNOWN",
    }
}

fn require_schema(
    artifact: &'static str,
    actual: u16,
    expected: u16,
) -> Result<(), ResultCustodyErrorV1> {
    if actual == expected {
        Ok(())
    } else {
        Err(ResultCustodyErrorV1::UnsupportedSchema {
            artifact,
            expected,
            actual,
        })
    }
}

/// Fail-closed errors from the transaction-bound custody adapter.
#[derive(Debug, Error)]
pub enum ResultCustodyErrorV1 {
    #[error("canonical Backtest Result custody is unavailable")]
    CustodyUnavailable,
    #[error("unsupported {artifact} schema: expected {expected}, received {actual}")]
    UnsupportedSchema {
        artifact: &'static str,
        expected: u16,
        actual: u16,
    },
    #[error("malformed or unknown-field {0} canonical bytes")]
    MalformedCanonicalBytes(&'static str),
    #[error("noncanonical or trailing {0} bytes")]
    NonCanonicalBytes(&'static str),
    #[error("protected Backtest Result custody is not exposed to R&D")]
    ProtectedNamespace,
    #[error("Backtest Result digest mismatch")]
    ResultDigestMismatch,
    #[error("Backtest Result identity mismatch")]
    ResultIdentityMismatch,
    #[error("Backtest Result structure is invalid: {0}")]
    InvalidResultStructure(&'static str),
    #[error("Backtest Result does not correlate with the exact query")]
    RequestResultCorrelationMismatch,
    #[error("Backtest Result receipt binding is incomplete or mismatched")]
    ReceiptBindingMismatch,
    #[error("Backtest Result outbox binding is incomplete or mismatched")]
    OutboxBindingMismatch,
    #[error("canonical custody encoding unavailable")]
    CanonicalEncodingUnavailable,
}

impl From<sqlx::Error> for ResultCustodyErrorV1 {
    fn from(_: sqlx::Error) -> Self {
        Self::CustodyUnavailable
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use vibe_backtest_owner_contracts::{
        ComponentObservationLocatorV2, ResultConsumptionObservationV2, ResultDiagnosticEvidenceV2,
        ResultReconciliationAtomV2,
    };

    fn identity(value: &str) -> OpaqueIdentityV2 {
        OpaqueIdentityV2::try_from(value.to_string()).expect("fixture identity")
    }

    fn digest(byte: char) -> CanonicalDigestV2 {
        CanonicalDigestV2::try_from(format!("sha256:{}", byte.to_string().repeat(64)))
            .expect("fixture digest")
    }

    fn observation_locator(
        component: ObservationComponentV2,
        byte: char,
    ) -> ComponentObservationLocatorV2 {
        ComponentObservationLocatorV2 {
            component,
            reference: identity(&format!("{component:?}-observation")),
            digest: digest(byte),
        }
    }

    fn fixture(
        seed: char,
    ) -> (
        ExploratoryResultCustodyQueryV1,
        UntrustedResultCustodyEnvelopeV1,
    ) {
        let request_identity = identity(&format!("request-{seed}"));
        let request_meaning_digest = digest(seed);
        let attempt_identity = identity(&format!("attempt-{seed}"));
        let reconciliation = ObservationComponentV2::REQUESTED_MEANING
            .into_iter()
            .map(|component| ResultReconciliationAtomV2 {
                component,
                requested_meaning_identity: identity(&format!("{component:?}-{seed}")),
                requested_meaning_digest: digest(seed),
                observed_meaning_identity: Some(identity(&format!("{component:?}-{seed}"))),
                observed_meaning_digest: Some(digest(seed)),
                observation_locator: Some(observation_locator(component, seed)),
                status: ResultReconciliationStatusV2::Exact,
            })
            .collect();
        let semantic_trace = ResultConsumptionObservationV2 {
            request_identity: request_identity.clone(),
            request_meaning_digest: request_meaning_digest.clone(),
            attempt_identity: attempt_identity.clone(),
            component: ObservationComponentV2::SemanticTrace,
            locator: observation_locator(ObservationComponentV2::SemanticTrace, seed),
            observed_meaning_identity: identity(&format!("semantic-trace-{seed}")),
            observed_meaning_digest: digest(seed),
        };
        let diagnostic = ResultDiagnosticEvidenceV2 {
            request_identity: request_identity.clone(),
            request_meaning_digest: request_meaning_digest.clone(),
            attempt_identity: attempt_identity.clone(),
            category: DiagnosticCategoryV2::NoExecutionDefect,
            decisive_evidence: observation_locator(ObservationComponentV2::SemanticTrace, seed),
        };
        let placeholder = digest('0');
        let mut result = ReplayResultDtoV2 {
            schema_version: 2,
            result_identity: identity("placeholder-result"),
            result_digest: placeholder.clone(),
            request_identity: request_identity.clone(),
            request_meaning_digest: request_meaning_digest.clone(),
            namespace: ReplayNamespaceV2::Exploratory,
            replay_authority: ReplayAuthorityClaimV2::Exploratory,
            attempt_identity,
            terminal: ReplayTerminalV2::TerminalResult,
            reconciliation,
            semantic_trace: Some(semantic_trace),
            diagnostic_census: vec![diagnostic],
        };
        result.result_digest = result.expected_result_digest().expect("result digest");
        result.result_identity = result.expected_result_identity().expect("result identity");
        let receipt_identity = identity(&format!("receipt-{seed}"));
        let event_identity = identity(&format!("outbox-{seed}"));
        let mut receipt = BacktestResultReceiptV1 {
            schema_version: 1,
            receipt_identity: receipt_identity.clone(),
            receipt_digest: placeholder.clone(),
            request_identity: request_identity.clone(),
            request_meaning_digest: request_meaning_digest.clone(),
            result_identity: result.result_identity.clone(),
            result_digest: result.result_digest.clone(),
            namespace: ReplayNamespaceV2::Exploratory,
            outbox_event_identity: event_identity.clone(),
            committed_at_epoch_ms: 1_725_000_000_000,
        };
        receipt.receipt_digest = receipt.expected_digest().expect("receipt digest");
        let payload = vibe_backtest_owner_contracts::BacktestResultOutboxPayloadV1 {
            schema_version: 1,
            receipt_identity,
            receipt_digest: receipt.receipt_digest.clone(),
            request_identity: request_identity.clone(),
            request_meaning_digest: request_meaning_digest.clone(),
            result_identity: result.result_identity.clone(),
            result_digest: result.result_digest.clone(),
            namespace: ReplayNamespaceV2::Exploratory,
            committed_at_epoch_ms: receipt.committed_at_epoch_ms,
        };
        let mut outbox = BacktestResultOutboxV1 {
            schema_version: 1,
            event_identity,
            event_digest: placeholder.clone(),
            aggregate_identity: result.result_identity.clone(),
            event_kind: identity(EXPLORATORY_RESULT_COMMITTED_EVENT_KIND_V1),
            payload_digest: placeholder,
            payload,
            committed_at_epoch_ms: receipt.committed_at_epoch_ms,
        };
        outbox.payload_digest = outbox.expected_payload_digest().expect("payload digest");
        outbox.event_digest = outbox.expected_event_digest().expect("event digest");
        let query = ExploratoryResultCustodyQueryV1 {
            schema_version: 1,
            locator: ExploratoryResultLocatorV1 {
                request_identity,
                request_meaning_digest,
                result_identity: result.result_identity.clone(),
                result_digest: result.result_digest.clone(),
            },
        };
        let envelope = UntrustedResultCustodyEnvelopeV1 {
            schema_version: 1,
            canonical_result_bytes: serde_json::to_vec(&result).expect("result bytes"),
            canonical_receipt_bytes: serde_json::to_vec(&receipt).expect("receipt bytes"),
            canonical_outbox_bytes: serde_json::to_vec(&outbox).expect("outbox bytes"),
        };
        (query, envelope)
    }

    #[test]
    fn exact_custody_preserves_all_first_commit_bytes() {
        let (query, envelope) = fixture('a');
        let expected = envelope.clone();
        let validated = validate_untrusted_envelope(&query, envelope).expect("valid custody");
        assert_eq!(
            validated.canonical_result_bytes,
            expected.canonical_result_bytes
        );
        assert_eq!(
            validated.canonical_receipt_bytes,
            expected.canonical_receipt_bytes
        );
        assert_eq!(
            validated.canonical_outbox_bytes,
            expected.canonical_outbox_bytes
        );
    }

    #[test]
    fn reader_shape_oracles_freeze_collation_index_and_dependency_identity() {
        for shape in [PRIMARY_STORAGE_SHAPE_V2, AUXILIARY_STORAGE_SHAPE_V1] {
            assert!(shape.contains("attribute.attcollation"));
            assert!(shape.contains("pg_catalog.\"C\""));
            assert!(shape.contains("operator_class.opcname<>'text_ops'"));
            assert!(shape.contains("index_entry.indcollation[key_position]"));
            assert!(shape.contains("index_entry.indoption[key_position]"));
            assert!(shape.contains("dependency_entry.deptype IN ('e','x')"));
            assert!(shape.contains("reltoastrelid"));
        }
    }

    #[test]
    fn result_tamper_never_produces_positive_custody() {
        let (query, mut envelope) = fixture('a');
        let mut result: ReplayResultDtoV2 =
            serde_json::from_slice(&envelope.canonical_result_bytes).expect("result");
        result.attempt_identity = identity("tampered-attempt");
        envelope.canonical_result_bytes = serde_json::to_vec(&result).expect("tampered bytes");
        assert!(matches!(
            validate_untrusted_envelope(&query, envelope),
            Err(ResultCustodyErrorV1::ResultDigestMismatch)
        ));
    }

    #[test]
    fn cross_spliced_receipt_and_outbox_never_produce_positive_custody() {
        let (query, mut envelope) = fixture('a');
        let (_, other) = fixture('b');
        envelope.canonical_receipt_bytes = other.canonical_receipt_bytes;
        envelope.canonical_outbox_bytes = other.canonical_outbox_bytes;
        assert!(matches!(
            validate_untrusted_envelope(&query, envelope),
            Err(ResultCustodyErrorV1::ReceiptBindingMismatch)
        ));
    }

    #[test]
    fn protected_result_never_produces_positive_custody() {
        let (query, mut envelope) = fixture('a');
        let mut result: ReplayResultDtoV2 =
            serde_json::from_slice(&envelope.canonical_result_bytes).expect("result");
        result.namespace = ReplayNamespaceV2::Protected;
        envelope.canonical_result_bytes = serde_json::to_vec(&result).expect("protected bytes");
        assert!(matches!(
            validate_untrusted_envelope(&query, envelope),
            Err(ResultCustodyErrorV1::ProtectedNamespace)
        ));
    }
}
