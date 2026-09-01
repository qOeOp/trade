//! Durable PostgreSQL custody for sealed Backtest Replay V2 results.

#![expect(
    clippy::needless_raw_strings,
    reason = "fixed PostgreSQL sources and catalog queries are reviewed byte-for-byte"
)]

use sqlx::{PgPool, Postgres, Row, Transaction};
use thiserror::Error;
use vibe_strategy_factory::{
    exploratory_replay::{
        ExploratoryReplayAvailabilityV1, ExploratoryReplayReadResultV2,
        ExploratoryReplayRequestLocatorV2,
    },
    product_edge_postgres::PostgresResearchGoalOwnerV1,
};

use crate::{
    CanonicalDigestV2, OpaqueIdentityV2, ReplayNamespaceV2, ReplayRequestDtoV2, ReplayRequestV2,
    ReplayTerminalV2, SealedReplayResultV2,
};
use vibe_backtest_owner_contracts::{
    BacktestResultOutboxPayloadV1, BacktestResultOutboxV1, BacktestResultReceiptV1,
    EXPLORATORY_RESULT_COMMITTED_EVENT_KIND_V1,
};

const RESULT_STORAGE_DOMAIN: &str = "vibe.backtest.replay-result-storage.v2";
const REQUEST_STORAGE_DOMAIN: &str = "vibe.backtest.replay-request-storage.v2";
const REQUEST_BINDING_DOMAIN: &str = "vibe.backtest.replay-request-binding.v2";
const RECEIPT_STORAGE_DOMAIN: &str = "vibe.backtest.result-receipt-storage.v1";
const OUTBOX_STORAGE_DOMAIN: &str = "vibe.backtest.result-outbox-storage.v1";
const READBACK_COLUMNS_V2: &str = "SELECT stored_result.result_identity,stored_result.result_digest,stored_result.request_identity,stored_result.request_meaning_digest,stored_result.attempt_identity,stored_result.terminal,stored_result.canonical_bytes,stored_result.canonical_bytes_blake3,stored_run.result_identity AS run_result_identity,stored_run.request_identity AS run_request_identity,stored_run.request_meaning_digest AS run_request_meaning_digest,stored_run.attempt_identity AS run_attempt_identity,stored_run.result_digest AS run_result_digest,stored_run.terminal AS run_terminal,stored_run.request_seal_digest,stored_run.rd_receipt_identity,stored_run.request_binding_blake3,stored_run.request_canonical_bytes,stored_run.request_canonical_bytes_blake3,stored_receipt.result_identity AS receipt_result_identity,stored_receipt.receipt_identity,stored_receipt.receipt_digest,stored_receipt.request_identity AS receipt_request_identity,stored_receipt.request_meaning_digest AS receipt_request_meaning_digest,stored_receipt.result_digest AS receipt_result_digest,stored_receipt.namespace AS receipt_namespace,stored_receipt.outbox_event_identity,stored_receipt.committed_at_epoch_ms AS receipt_committed_at_epoch_ms,stored_receipt.canonical_bytes AS receipt_canonical_bytes,stored_receipt.canonical_bytes_blake3 AS receipt_canonical_bytes_blake3,stored_outbox.result_identity AS outbox_result_identity,stored_outbox.event_identity,stored_outbox.event_digest,stored_outbox.receipt_identity AS outbox_receipt_identity,stored_outbox.request_identity AS outbox_request_identity,stored_outbox.request_meaning_digest AS outbox_request_meaning_digest,stored_outbox.result_digest AS outbox_result_digest,stored_outbox.namespace AS outbox_namespace,stored_outbox.payload_digest,stored_outbox.committed_at_epoch_ms AS outbox_committed_at_epoch_ms,stored_outbox.canonical_bytes AS outbox_canonical_bytes,stored_outbox.canonical_bytes_blake3 AS outbox_canonical_bytes_blake3 FROM public.backtest_replay_results_v2 stored_result JOIN public.backtest_replay_runs_v2 stored_run USING(result_identity) JOIN public.backtest_replay_result_receipts_v1 stored_receipt USING(result_identity) JOIN public.backtest_replay_result_outbox_v1 stored_outbox USING(result_identity)";
const LOCK_RESULT_SOURCE_V1: &str = "
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
const STORAGE_SHAPE_V2: &str = r#"SELECT
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

/// Durable readback of one sealed Replay V2 request/result pair.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReplayResultReadbackV2 {
    result_identity: OpaqueIdentityV2,
    result_digest: CanonicalDigestV2,
    request_identity: OpaqueIdentityV2,
    request_meaning_digest: CanonicalDigestV2,
    attempt_identity: OpaqueIdentityV2,
    terminal: ReplayTerminalV2,
    request_canonical_bytes: Vec<u8>,
    result_canonical_bytes: Vec<u8>,
    receipt_canonical_bytes: Vec<u8>,
    outbox_canonical_bytes: Vec<u8>,
}

impl ReplayResultReadbackV2 {
    #[must_use]
    pub fn result_identity(&self) -> &OpaqueIdentityV2 {
        &self.result_identity
    }

    #[must_use]
    pub fn result_digest(&self) -> &CanonicalDigestV2 {
        &self.result_digest
    }

    #[must_use]
    pub fn request_identity(&self) -> &OpaqueIdentityV2 {
        &self.request_identity
    }

    #[must_use]
    pub fn request_meaning_digest(&self) -> &CanonicalDigestV2 {
        &self.request_meaning_digest
    }

    #[must_use]
    pub fn attempt_identity(&self) -> &OpaqueIdentityV2 {
        &self.attempt_identity
    }

    #[must_use]
    pub const fn terminal(&self) -> ReplayTerminalV2 {
        self.terminal
    }

    /// Returns the exact U1 Owner-sealed request bytes retained with the run.
    #[must_use]
    pub fn request_canonical_bytes(&self) -> &[u8] {
        &self.request_canonical_bytes
    }

    /// Returns the exact U2 sealed-result bytes retained by Backtest.
    #[must_use]
    pub fn result_canonical_bytes(&self) -> &[u8] {
        &self.result_canonical_bytes
    }

    /// Returns the exact first-commit Backtest receipt bytes.
    #[must_use]
    pub fn receipt_canonical_bytes(&self) -> &[u8] {
        &self.receipt_canonical_bytes
    }

    /// Returns the exact first-commit Backtest outbox bytes.
    #[must_use]
    pub fn outbox_canonical_bytes(&self) -> &[u8] {
        &self.outbox_canonical_bytes
    }
}

/// Fail-closed durable Replay V2 Owner errors.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum PostgresReplayOwnerErrorV2 {
    #[error("canonical backtest_owner PostgreSQL custody is unavailable")]
    CustodyUnavailable,
    #[error("sealed exploratory Replay V2 request is unavailable")]
    RequestUnavailable,
    #[error("sealed Replay V2 request and result disagree")]
    RequestBindingMismatch,
    #[error("only exploratory terminal Replay V2 results are admitted")]
    ResultNotAdmitted,
    #[error("Replay V2 request attempt is already bound to a different result")]
    ConflictingReplay,
    #[error("durable Replay V2 storage is unavailable")]
    StorageUnavailable,
    #[error("durable Replay V2 readback failed integrity verification")]
    CorruptReadback,
}

/// The sole durable Backtest Replay V2 result writer.
#[derive(Debug, Clone)]
pub struct PostgresReplayResultOwnerV2 {
    pool: PgPool,
}

impl PostgresReplayResultOwnerV2 {
    /// Materializes Backtest-owned storage under an explicit one-shot DDL grant.
    ///
    /// Runtime composition must use [`Self::connect`] after deployment bootstrap revokes that
    /// grant. This function returns no result-writing capability.
    ///
    /// # Errors
    ///
    /// Returns a fail-closed error when canonical custody or DDL is unavailable.
    pub async fn bootstrap_storage(database_url: &str) -> Result<(), PostgresReplayOwnerErrorV2> {
        let pool = canonical_pool(database_url).await?;
        migrate(&pool).await
    }

    /// Connects and admits only a least-privilege canonical `backtest_owner` runtime session.
    ///
    /// # Errors
    ///
    /// Returns a fail-closed error when custody or migration is unavailable.
    pub async fn connect(database_url: &str) -> Result<Self, PostgresReplayOwnerErrorV2> {
        let pool = canonical_pool(database_url).await?;
        validate_runtime_storage(&pool).await?;
        Ok(Self { pool })
    }

    /// Locks the exact U1 V2 request and atomically retains it with one U2 sealed terminal result.
    ///
    /// This is a storage port only. It neither runs Native Replay nor constructs consumption
    /// evidence. The future parameterized runner must supply the already sealed result.
    ///
    /// # Errors
    ///
    /// Returns without a run or result write when the V2 locator is wrong, stale, unavailable, or
    /// unequal to the sealed result. Same-attempt conflicting results also fail closed.
    pub async fn commit_exploratory_replay_result_v2(
        &self,
        request_owner: &PostgresResearchGoalOwnerV1,
        locator: &ExploratoryReplayRequestLocatorV2,
        result: &SealedReplayResultV2,
    ) -> Result<ReplayResultReadbackV2, PostgresReplayOwnerErrorV2> {
        self.commit_exploratory_replay_result_v2_inner(
            request_owner,
            locator,
            result,
            PrePersistActionV2::None,
        )
        .await
    }

    async fn commit_exploratory_replay_result_v2_inner(
        &self,
        request_owner: &PostgresResearchGoalOwnerV1,
        locator: &ExploratoryReplayRequestLocatorV2,
        result: &SealedReplayResultV2,
        pre_persist_action: PrePersistActionV2,
    ) -> Result<ReplayResultReadbackV2, PostgresReplayOwnerErrorV2> {
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(|_| PostgresReplayOwnerErrorV2::StorageUnavailable)?;
        lock_and_validate_runtime_storage(&mut transaction).await?;
        let locked = request_owner
            .lock_exploratory_replay_request_for_backtest_v2_in_transaction(
                &mut transaction,
                locator,
            )
            .await
            .map_err(|_| PostgresReplayOwnerErrorV2::RequestUnavailable)?;
        let (request, request_canonical_bytes, request_meaning_digest) =
            validate_locked_request(&locked, locator)?;
        validate_result_binding(&request, &request_meaning_digest, result)?;
        let result_canonical_bytes = result
            .to_canonical_bytes()
            .map_err(|_| PostgresReplayOwnerErrorV2::ResultNotAdmitted)?;
        run_pre_persist_action(&mut transaction, locator, pre_persist_action).await?;
        let stored = persist_result(
            &mut transaction,
            locator,
            result,
            request_canonical_bytes.clone(),
            result_canonical_bytes,
        )
        .await?;

        let revalidated = request_owner
            .lock_exploratory_replay_request_for_backtest_v2_in_transaction(
                &mut transaction,
                locator,
            )
            .await
            .map_err(|_| PostgresReplayOwnerErrorV2::RequestUnavailable)?;
        let (revalidated_request, revalidated_bytes, revalidated_meaning_digest) =
            validate_locked_request(&revalidated, locator)?;

        if revalidated_request != request
            || revalidated_bytes != request_canonical_bytes
            || revalidated_meaning_digest != request_meaning_digest
        {
            return Err(PostgresReplayOwnerErrorV2::RequestUnavailable);
        }
        validate_runtime_storage_in_transaction(&mut transaction).await?;
        transaction
            .commit()
            .await
            .map_err(|_| PostgresReplayOwnerErrorV2::StorageUnavailable)?;
        Ok(stored)
    }

    /// Rereads one durable request/result pair and verifies both exact byte streams.
    ///
    /// # Errors
    ///
    /// Returns an error when storage is unavailable or retained bytes fail integrity checks.
    pub async fn read_result_v2(
        &self,
        result_identity: &OpaqueIdentityV2,
    ) -> Result<Option<ReplayResultReadbackV2>, PostgresReplayOwnerErrorV2> {
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(|_| PostgresReplayOwnerErrorV2::StorageUnavailable)?;
        lock_and_validate_runtime_storage(&mut transaction).await?;
        let row = sqlx::query(sqlx::AssertSqlSafe(format!(
            "{READBACK_COLUMNS_V2} WHERE stored_result.result_identity=$1"
        )))
        .bind(result_identity.as_str())
        .fetch_optional(&mut *transaction)
        .await
        .map_err(|_| PostgresReplayOwnerErrorV2::StorageUnavailable)?;
        let readback = row.as_ref().map(decode_row).transpose()?;
        validate_runtime_storage_in_transaction(&mut transaction).await?;
        transaction
            .commit()
            .await
            .map_err(|_| PostgresReplayOwnerErrorV2::StorageUnavailable)?;
        Ok(readback)
    }

    #[cfg(test)]
    async fn commit_with_pre_persist_revocation_for_test(
        &self,
        request_owner: &PostgresResearchGoalOwnerV1,
        locator: &ExploratoryReplayRequestLocatorV2,
        result: &SealedReplayResultV2,
    ) -> Result<ReplayResultReadbackV2, PostgresReplayOwnerErrorV2> {
        self.commit_exploratory_replay_result_v2_inner(
            request_owner,
            locator,
            result,
            PrePersistActionV2::RevokeRequestForTest,
        )
        .await
    }
}

#[derive(Debug, Clone, Copy)]
enum PrePersistActionV2 {
    None,
    #[cfg(test)]
    RevokeRequestForTest,
}

async fn run_pre_persist_action(
    transaction: &mut Transaction<'_, Postgres>,
    locator: &ExploratoryReplayRequestLocatorV2,
    action: PrePersistActionV2,
) -> Result<(), PostgresReplayOwnerErrorV2> {
    #[cfg(not(test))]
    let _ = (transaction, locator);

    match action {
        PrePersistActionV2::None => Ok(()),
        #[cfg(test)]
        PrePersistActionV2::RevokeRequestForTest => {
            sqlx::query(
                "SELECT vibe_test_admin.revoke_replay_request_before_backtest_persist_v2($1)",
            )
            .bind(&locator.request_identity)
            .execute(&mut **transaction)
            .await
            .map_err(|_| PostgresReplayOwnerErrorV2::StorageUnavailable)?;
            Ok(())
        }
    }
}

async fn canonical_pool(database_url: &str) -> Result<PgPool, PostgresReplayOwnerErrorV2> {
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(4)
        .connect(database_url)
        .await
        .map_err(|_| PostgresReplayOwnerErrorV2::CustodyUnavailable)?;
    let (session_user, current_user): (String, String) =
        sqlx::query_as("SELECT session_user,current_user")
            .fetch_one(&pool)
            .await
            .map_err(|_| PostgresReplayOwnerErrorV2::CustodyUnavailable)?;

    if session_user != "backtest_owner" || current_user != "backtest_owner" {
        return Err(PostgresReplayOwnerErrorV2::CustodyUnavailable);
    }
    Ok(pool)
}

async fn validate_runtime_storage(pool: &PgPool) -> Result<(), PostgresReplayOwnerErrorV2> {
    let mut transaction = pool
        .begin()
        .await
        .map_err(|_| PostgresReplayOwnerErrorV2::StorageUnavailable)?;
    lock_and_validate_runtime_storage(&mut transaction).await?;
    validate_runtime_storage_in_transaction(&mut transaction).await?;
    transaction
        .commit()
        .await
        .map_err(|_| PostgresReplayOwnerErrorV2::StorageUnavailable)
}

async fn lock_and_validate_runtime_storage(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<(), PostgresReplayOwnerErrorV2> {
    set_local_lock_timeout(transaction, PostgresReplayOwnerErrorV2::CustodyUnavailable).await?;
    sqlx::query(
        "LOCK TABLE public.backtest_replay_runs_v2,public.backtest_replay_results_v2,public.backtest_replay_result_receipts_v1,public.backtest_replay_result_outbox_v1 IN SHARE ROW EXCLUSIVE MODE",
    )
    .execute(&mut **transaction)
    .await
    .map_err(|_| PostgresReplayOwnerErrorV2::CustodyUnavailable)?;
    validate_runtime_storage_in_transaction(transaction).await
}

async fn set_local_lock_timeout(
    transaction: &mut Transaction<'_, Postgres>,
    error: PostgresReplayOwnerErrorV2,
) -> Result<(), PostgresReplayOwnerErrorV2> {
    sqlx::query("SET LOCAL lock_timeout='1000ms'")
        .execute(&mut **transaction)
        .await
        .map_err(|_| error)?;
    Ok(())
}

async fn validate_runtime_storage_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<(), PostgresReplayOwnerErrorV2> {
    if !storage_shape_v2_in_transaction(transaction).await? {
        return Err(PostgresReplayOwnerErrorV2::CustodyUnavailable);
    }
    validate_principal_and_role_graph(transaction).await?;
    validate_storage_acl(transaction, true).await
}

async fn validate_principal_and_role_graph(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<(), PostgresReplayOwnerErrorV2> {
    let admitted: bool = sqlx::query_scalar(
        r#"SELECT
            session_user='backtest_owner'
            AND current_user='backtest_owner'
            AND COALESCE((
                SELECT role_entry.rolcanlogin
                    AND NOT role_entry.rolsuper
                    AND NOT role_entry.rolcreatedb
                    AND NOT role_entry.rolcreaterole
                    AND NOT role_entry.rolreplication
                    AND NOT role_entry.rolbypassrls
                FROM pg_catalog.pg_roles role_entry
                WHERE role_entry.rolname='backtest_owner'
            ),false)
            AND NOT EXISTS (
                SELECT 1
                FROM pg_catalog.pg_roles principal
                WHERE principal.rolname='rd_owner'
                  AND (principal.rolsuper OR principal.rolcreatedb OR principal.rolcreaterole
                    OR principal.rolreplication OR principal.rolbypassrls)
            )
            AND NOT EXISTS (
                SELECT 1
                FROM pg_catalog.pg_roles role_entry
                WHERE role_entry.rolname <> 'backtest_owner'
                  AND NOT role_entry.rolsuper
                  AND (
                    pg_catalog.pg_has_role(role_entry.oid,'backtest_owner','USAGE')
                    OR pg_catalog.pg_has_role(role_entry.oid,'backtest_owner','SET')
                  )
            )
            AND NOT EXISTS (
                SELECT 1
                FROM pg_catalog.pg_roles role_entry
                WHERE role_entry.rolname <> 'rd_owner'
                  AND NOT role_entry.rolsuper
                  AND (
                    pg_catalog.pg_has_role(role_entry.oid,'rd_owner','USAGE')
                    OR pg_catalog.pg_has_role(role_entry.oid,'rd_owner','SET')
                  )
            )
            AND NOT EXISTS (
                SELECT 1
                FROM pg_catalog.pg_roles role_entry
                WHERE role_entry.rolname <> 'backtest_owner'
                  AND (
                    role_entry.rolsuper
                    OR role_entry.rolcreatedb
                    OR role_entry.rolcreaterole
                    OR role_entry.rolreplication
                    OR role_entry.rolbypassrls
                    OR EXISTS (
                      SELECT 1 FROM pg_catalog.pg_namespace authority_namespace
                      WHERE authority_namespace.nspowner=role_entry.oid
                        AND authority_namespace.nspname NOT IN ('pg_catalog','information_schema','pg_toast')
                        AND authority_namespace.nspname NOT LIKE 'pg_temp_%'
                        AND authority_namespace.nspname NOT LIKE 'pg_toast_temp_%'
                    )
                    OR EXISTS (
                      SELECT 1 FROM pg_catalog.pg_class authority_class
                      JOIN pg_catalog.pg_namespace authority_namespace ON authority_namespace.oid=authority_class.relnamespace
                      WHERE authority_class.relowner=role_entry.oid
                        AND authority_namespace.nspname NOT IN ('pg_catalog','information_schema','pg_toast')
                        AND authority_namespace.nspname NOT LIKE 'pg_temp_%'
                        AND authority_namespace.nspname NOT LIKE 'pg_toast_temp_%'
                    )
                    OR EXISTS (
                      SELECT 1 FROM pg_catalog.pg_class authority_class
                      JOIN pg_catalog.pg_namespace authority_namespace ON authority_namespace.oid=authority_class.relnamespace
                      CROSS JOIN LATERAL pg_catalog.aclexplode(authority_class.relacl) authority_acl
                      WHERE authority_acl.grantee=role_entry.oid
                        AND authority_acl.privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER')
                        AND authority_namespace.nspname NOT IN ('pg_catalog','information_schema','pg_toast')
                        AND authority_namespace.nspname NOT LIKE 'pg_temp_%'
                        AND authority_namespace.nspname NOT LIKE 'pg_toast_temp_%'
                    )
                    OR EXISTS (
                      SELECT 1 FROM pg_catalog.pg_proc authority_procedure
                      JOIN pg_catalog.pg_namespace authority_namespace ON authority_namespace.oid=authority_procedure.pronamespace
                      WHERE authority_procedure.proowner=role_entry.oid
                        AND authority_namespace.nspname NOT IN ('pg_catalog','information_schema')
                        AND authority_namespace.nspname NOT LIKE 'pg_temp_%'
                    )
                    OR EXISTS (
                      SELECT 1 FROM pg_catalog.pg_proc authority_procedure
                      JOIN pg_catalog.pg_namespace authority_namespace ON authority_namespace.oid=authority_procedure.pronamespace
                      CROSS JOIN LATERAL pg_catalog.aclexplode(authority_procedure.proacl) authority_acl
                      WHERE authority_acl.grantee=role_entry.oid
                        AND authority_acl.privilege_type='EXECUTE'
                        AND authority_procedure.prosecdef
                        AND authority_namespace.nspname NOT IN ('pg_catalog','information_schema')
                        AND authority_namespace.nspname NOT LIKE 'pg_temp_%'
                    )
                  )
                  AND (
                    pg_catalog.pg_has_role('backtest_owner',role_entry.oid,'USAGE')
                    OR pg_catalog.pg_has_role('backtest_owner',role_entry.oid,'SET')
                    OR (role_entry.rolname<>'rd_owner' AND (
                      pg_catalog.pg_has_role('rd_owner',role_entry.oid,'USAGE')
                      OR pg_catalog.pg_has_role('rd_owner',role_entry.oid,'SET')
                    ))
                  )
            )"#,
    )
    .fetch_one(&mut **transaction)
    .await
    .map_err(|_| PostgresReplayOwnerErrorV2::StorageUnavailable)?;

    if admitted {
        Ok(())
    } else {
        Err(PostgresReplayOwnerErrorV2::CustodyUnavailable)
    }
}

async fn validate_storage_acl(
    transaction: &mut Transaction<'_, Postgres>,
    require_no_schema_create: bool,
) -> Result<(), PostgresReplayOwnerErrorV2> {
    let admitted: bool = sqlx::query_scalar(
        r#"SELECT
            (NOT $1 OR NOT pg_catalog.has_schema_privilege('backtest_owner','public','CREATE'))
            AND NOT EXISTS (
                SELECT 1
                FROM pg_catalog.pg_class class_entry
                CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(class_entry.relacl,pg_catalog.acldefault('r',class_entry.relowner))) acl_entry
                WHERE class_entry.oid IN ('public.backtest_replay_runs_v2'::pg_catalog.regclass,'public.backtest_replay_results_v2'::pg_catalog.regclass,'public.backtest_replay_result_receipts_v1'::pg_catalog.regclass,'public.backtest_replay_result_outbox_v1'::pg_catalog.regclass)
                  AND acl_entry.grantee <> class_entry.relowner
            )
            AND NOT EXISTS (
                SELECT 1
                FROM pg_catalog.pg_roles role_entry
                WHERE role_entry.rolname <> 'backtest_owner'
                  AND role_entry.rolcanlogin
                  AND NOT role_entry.rolsuper
                  AND (
                    pg_catalog.has_table_privilege(role_entry.oid,'public.backtest_replay_runs_v2','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
                    OR pg_catalog.has_table_privilege(role_entry.oid,'public.backtest_replay_results_v2','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
                    OR pg_catalog.has_table_privilege(role_entry.oid,'public.backtest_replay_result_receipts_v1','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
                    OR pg_catalog.has_table_privilege(role_entry.oid,'public.backtest_replay_result_outbox_v1','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
                  )
            )
            AND NOT EXISTS (
                SELECT 1
                FROM pg_catalog.pg_attribute attribute
                WHERE attribute.attrelid IN ('public.backtest_replay_runs_v2'::pg_catalog.regclass,'public.backtest_replay_results_v2'::pg_catalog.regclass,'public.backtest_replay_result_receipts_v1'::pg_catalog.regclass,'public.backtest_replay_result_outbox_v1'::pg_catalog.regclass)
                  AND attribute.attnum>0
                  AND NOT attribute.attisdropped
                  AND attribute.attacl IS NOT NULL
            )"#,
    )
    .bind(require_no_schema_create)
    .fetch_one(&mut **transaction)
    .await
    .map_err(|_| PostgresReplayOwnerErrorV2::StorageUnavailable)?;

    if admitted {
        Ok(())
    } else {
        Err(PostgresReplayOwnerErrorV2::CustodyUnavailable)
    }
}

async fn storage_shape_v2_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<bool, PostgresReplayOwnerErrorV2> {
    let primary: bool = sqlx::query_scalar(STORAGE_SHAPE_V2)
        .fetch_optional(&mut **transaction)
        .await
        .map_err(|_| PostgresReplayOwnerErrorV2::StorageUnavailable)
        .map(Option::unwrap_or_default)?;
    let auxiliary: bool = sqlx::query_scalar(AUXILIARY_STORAGE_SHAPE_V1)
        .fetch_optional(&mut **transaction)
        .await
        .map_err(|_| PostgresReplayOwnerErrorV2::StorageUnavailable)
        .map(Option::unwrap_or_default)?;
    Ok(primary && auxiliary)
}

fn validate_result_binding(
    request: &ReplayRequestV2,
    request_meaning_digest: &CanonicalDigestV2,
    result: &SealedReplayResultV2,
) -> Result<(), PostgresReplayOwnerErrorV2> {
    if request.namespace() != ReplayNamespaceV2::Exploratory
        || result.namespace() != ReplayNamespaceV2::Exploratory
        || result.terminal() == ReplayTerminalV2::InProgressOrUnknown
    {
        return Err(PostgresReplayOwnerErrorV2::ResultNotAdmitted);
    }

    if result.request_identity() != request.request_identity()
        || result.request_meaning_digest() != request_meaning_digest
    {
        return Err(PostgresReplayOwnerErrorV2::RequestBindingMismatch);
    }
    Ok(())
}

fn validate_locked_request(
    locked: &ExploratoryReplayReadResultV2,
    locator: &ExploratoryReplayRequestLocatorV2,
) -> Result<(ReplayRequestV2, Vec<u8>, CanonicalDigestV2), PostgresReplayOwnerErrorV2> {
    if locked.projection().availability != ExploratoryReplayAvailabilityV1::Available {
        return Err(PostgresReplayOwnerErrorV2::RequestUnavailable);
    }
    let readback = locked
        .readback()
        .ok_or(PostgresReplayOwnerErrorV2::RequestUnavailable)?;
    let request = readback.request().clone();
    let request_canonical_bytes = request
        .to_canonical_bytes()
        .map_err(|_| PostgresReplayOwnerErrorV2::RequestUnavailable)?;
    let request_meaning_digest = request
        .meaning_digest()
        .map_err(|_| PostgresReplayOwnerErrorV2::RequestUnavailable)?;

    if request_canonical_bytes != readback.canonical_request_bytes()
        || request.request_identity().as_str() != locator.request_identity
        || request_meaning_digest.as_str() != locator.meaning_digest
        || readback.meaning_digest() != locator.meaning_digest
        || readback.receipt_identity() != locator.receipt_identity
        || readback.seal_digest() != locator.seal_digest
    {
        return Err(PostgresReplayOwnerErrorV2::RequestUnavailable);
    }
    Ok((request, request_canonical_bytes, request_meaning_digest))
}

async fn migrate(pool: &PgPool) -> Result<(), PostgresReplayOwnerErrorV2> {
    let mut transaction = pool
        .begin()
        .await
        .map_err(|_| PostgresReplayOwnerErrorV2::StorageUnavailable)?;
    set_local_lock_timeout(
        &mut transaction,
        PostgresReplayOwnerErrorV2::StorageUnavailable,
    )
    .await?;
    validate_principal_and_role_graph(&mut transaction).await?;

    let existing_objects: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM pg_catalog.pg_class class_entry JOIN pg_catalog.pg_namespace namespace_entry ON namespace_entry.oid=class_entry.relnamespace WHERE namespace_entry.nspname='public' AND class_entry.relname IN ('backtest_replay_runs_v2','backtest_replay_results_v2','backtest_replay_result_receipts_v1','backtest_replay_result_outbox_v1')",
    )
    .fetch_one(&mut *transaction)
    .await
    .map_err(|_| PostgresReplayOwnerErrorV2::StorageUnavailable)?;
    if existing_objects != 0 && existing_objects != 4 {
        return Err(PostgresReplayOwnerErrorV2::StorageUnavailable);
    }

    if existing_objects == 4 {
        sqlx::query(
            "LOCK TABLE public.backtest_replay_runs_v2,public.backtest_replay_results_v2,public.backtest_replay_result_receipts_v1,public.backtest_replay_result_outbox_v1 IN ACCESS EXCLUSIVE MODE",
        )
        .execute(&mut *transaction)
        .await
        .map_err(|_| PostgresReplayOwnerErrorV2::StorageUnavailable)?;
        if !storage_shape_v2_in_transaction(&mut transaction).await? {
            return Err(PostgresReplayOwnerErrorV2::StorageUnavailable);
        }
    }

    if existing_objects == 0 {
        for statement in [
            "CREATE TABLE public.backtest_replay_runs_v2 (request_identity TEXT COLLATE pg_catalog.\"C\" NOT NULL,request_meaning_digest TEXT COLLATE pg_catalog.\"C\" NOT NULL,request_seal_digest TEXT COLLATE pg_catalog.\"C\" NOT NULL,rd_receipt_identity TEXT COLLATE pg_catalog.\"C\" NOT NULL,request_binding_blake3 TEXT COLLATE pg_catalog.\"C\" NOT NULL,request_canonical_bytes BYTEA NOT NULL,request_canonical_bytes_blake3 TEXT COLLATE pg_catalog.\"C\" NOT NULL,attempt_identity TEXT COLLATE pg_catalog.\"C\" NOT NULL,result_identity TEXT COLLATE pg_catalog.\"C\" PRIMARY KEY,result_digest TEXT COLLATE pg_catalog.\"C\" NOT NULL,terminal TEXT COLLATE pg_catalog.\"C\" NOT NULL,UNIQUE(request_identity,attempt_identity))",
            "CREATE TABLE public.backtest_replay_results_v2 (result_identity TEXT COLLATE pg_catalog.\"C\" PRIMARY KEY REFERENCES public.backtest_replay_runs_v2(result_identity),result_digest TEXT COLLATE pg_catalog.\"C\" NOT NULL,request_identity TEXT COLLATE pg_catalog.\"C\" NOT NULL,request_meaning_digest TEXT COLLATE pg_catalog.\"C\" NOT NULL,attempt_identity TEXT COLLATE pg_catalog.\"C\" NOT NULL,terminal TEXT COLLATE pg_catalog.\"C\" NOT NULL,canonical_bytes BYTEA NOT NULL,canonical_bytes_blake3 TEXT COLLATE pg_catalog.\"C\" NOT NULL)",
            "CREATE TABLE public.backtest_replay_result_receipts_v1 (result_identity TEXT COLLATE pg_catalog.\"C\" PRIMARY KEY REFERENCES public.backtest_replay_results_v2(result_identity),receipt_identity TEXT COLLATE pg_catalog.\"C\" NOT NULL UNIQUE,receipt_digest TEXT COLLATE pg_catalog.\"C\" NOT NULL,request_identity TEXT COLLATE pg_catalog.\"C\" NOT NULL,request_meaning_digest TEXT COLLATE pg_catalog.\"C\" NOT NULL,result_digest TEXT COLLATE pg_catalog.\"C\" NOT NULL,namespace TEXT COLLATE pg_catalog.\"C\" NOT NULL,outbox_event_identity TEXT COLLATE pg_catalog.\"C\" NOT NULL UNIQUE,committed_at_epoch_ms BIGINT NOT NULL,canonical_bytes BYTEA NOT NULL,canonical_bytes_blake3 TEXT COLLATE pg_catalog.\"C\" NOT NULL)",
            "CREATE TABLE public.backtest_replay_result_outbox_v1 (result_identity TEXT COLLATE pg_catalog.\"C\" PRIMARY KEY REFERENCES public.backtest_replay_results_v2(result_identity),event_identity TEXT COLLATE pg_catalog.\"C\" NOT NULL UNIQUE,event_digest TEXT COLLATE pg_catalog.\"C\" NOT NULL,receipt_identity TEXT COLLATE pg_catalog.\"C\" NOT NULL UNIQUE REFERENCES public.backtest_replay_result_receipts_v1(receipt_identity),request_identity TEXT COLLATE pg_catalog.\"C\" NOT NULL,request_meaning_digest TEXT COLLATE pg_catalog.\"C\" NOT NULL,result_digest TEXT COLLATE pg_catalog.\"C\" NOT NULL,namespace TEXT COLLATE pg_catalog.\"C\" NOT NULL,payload_digest TEXT COLLATE pg_catalog.\"C\" NOT NULL,committed_at_epoch_ms BIGINT NOT NULL,canonical_bytes BYTEA NOT NULL,canonical_bytes_blake3 TEXT COLLATE pg_catalog.\"C\" NOT NULL)",
        ] {
            sqlx::query(statement)
                .execute(&mut *transaction)
                .await
                .map_err(|_| PostgresReplayOwnerErrorV2::StorageUnavailable)?;
        }
        sqlx::query(
            "LOCK TABLE public.backtest_replay_runs_v2,public.backtest_replay_results_v2,public.backtest_replay_result_receipts_v1,public.backtest_replay_result_outbox_v1 IN ACCESS EXCLUSIVE MODE",
        )
        .execute(&mut *transaction)
        .await
        .map_err(|_| PostgresReplayOwnerErrorV2::StorageUnavailable)?;
    }

    for statement in [
        "REVOKE ALL ON TABLE public.backtest_replay_runs_v2,public.backtest_replay_results_v2,public.backtest_replay_result_receipts_v1,public.backtest_replay_result_outbox_v1 FROM PUBLIC",
        "DO $acl$ DECLARE grantee_name text; BEGIN FOR grantee_name IN SELECT DISTINCT role_entry.rolname FROM pg_catalog.pg_class class_entry CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(class_entry.relacl,pg_catalog.acldefault('r',class_entry.relowner))) acl_entry JOIN pg_catalog.pg_roles role_entry ON role_entry.oid=acl_entry.grantee WHERE class_entry.oid IN ('public.backtest_replay_runs_v2'::pg_catalog.regclass,'public.backtest_replay_results_v2'::pg_catalog.regclass,'public.backtest_replay_result_receipts_v1'::pg_catalog.regclass,'public.backtest_replay_result_outbox_v1'::pg_catalog.regclass) AND role_entry.rolname <> 'backtest_owner' LOOP EXECUTE pg_catalog.format('REVOKE ALL ON TABLE public.backtest_replay_runs_v2,public.backtest_replay_results_v2,public.backtest_replay_result_receipts_v1,public.backtest_replay_result_outbox_v1 FROM %I',grantee_name); END LOOP; END $acl$",
    ] {
        sqlx::query(statement)
            .execute(&mut *transaction)
            .await
            .map_err(|_| PostgresReplayOwnerErrorV2::StorageUnavailable)?;
    }

    let schema_owner: Option<String> = sqlx::query_scalar(
        "SELECT pg_catalog.pg_get_userbyid(namespace_entry.nspowner) FROM pg_catalog.pg_namespace namespace_entry WHERE namespace_entry.nspname='backtest_owner_api'",
    )
    .fetch_optional(&mut *transaction)
    .await
    .map_err(|_| PostgresReplayOwnerErrorV2::StorageUnavailable)?;
    if schema_owner.as_deref() != Some("backtest_owner") {
        return Err(PostgresReplayOwnerErrorV2::StorageUnavailable);
    }
    sqlx::query("REVOKE ALL ON SCHEMA backtest_owner_api FROM PUBLIC")
        .execute(&mut *transaction)
        .await
        .map_err(|_| PostgresReplayOwnerErrorV2::StorageUnavailable)?;
    sqlx::query("DO $acl$ DECLARE grantee_name text; BEGIN FOR grantee_name IN SELECT DISTINCT role_entry.rolname FROM pg_catalog.pg_namespace namespace_entry CROSS JOIN LATERAL pg_catalog.aclexplode(namespace_entry.nspacl) acl_entry JOIN pg_catalog.pg_roles role_entry ON role_entry.oid=acl_entry.grantee WHERE namespace_entry.nspname='backtest_owner_api' AND role_entry.rolname<>'backtest_owner' LOOP EXECUTE pg_catalog.format('REVOKE ALL ON SCHEMA backtest_owner_api FROM %I',grantee_name); END LOOP; END $acl$")
        .execute(&mut *transaction)
        .await
        .map_err(|_| PostgresReplayOwnerErrorV2::StorageUnavailable)?;
    sqlx::query("GRANT USAGE ON SCHEMA backtest_owner_api TO rd_owner")
        .execute(&mut *transaction)
        .await
        .map_err(|_| PostgresReplayOwnerErrorV2::StorageUnavailable)?;
    let function_ddl = format!(
        "CREATE OR REPLACE FUNCTION backtest_owner_api.lock_exploratory_result_v1(requested_request_identity text,requested_request_meaning_digest text,requested_result_identity text,requested_result_digest text) RETURNS TABLE(run_request_identity text,run_request_meaning_digest text,request_seal_digest text,rd_receipt_identity text,request_binding_blake3 text,request_canonical_bytes bytea,request_canonical_bytes_blake3 text,run_attempt_identity text,run_result_identity text,run_result_digest text,run_terminal text,result_identity text,result_digest text,result_request_identity text,result_request_meaning_digest text,result_attempt_identity text,result_terminal text,canonical_result_bytes bytea,result_canonical_bytes_blake3 text,receipt_result_identity text,receipt_identity text,receipt_digest text,receipt_request_identity text,receipt_request_meaning_digest text,receipt_result_digest text,receipt_namespace text,outbox_event_identity text,receipt_committed_at_epoch_ms bigint,canonical_receipt_bytes bytea,receipt_canonical_bytes_blake3 text,outbox_result_identity text,event_identity text,event_digest text,outbox_receipt_identity text,outbox_request_identity text,outbox_request_meaning_digest text,outbox_result_digest text,outbox_namespace text,payload_digest text,outbox_committed_at_epoch_ms bigint,canonical_outbox_bytes bytea,outbox_canonical_bytes_blake3 text) LANGUAGE sql STRICT VOLATILE PARALLEL UNSAFE SECURITY DEFINER SET search_path=pg_catalog AS $function${LOCK_RESULT_SOURCE_V1}$function$"
    );
    sqlx::query(sqlx::AssertSqlSafe(function_ddl))
        .execute(&mut *transaction)
        .await
        .map_err(|_| PostgresReplayOwnerErrorV2::StorageUnavailable)?;
    sqlx::query("DO $acl$ DECLARE grantee_name text; BEGIN FOR grantee_name IN SELECT DISTINCT role_entry.rolname FROM pg_catalog.pg_proc facade CROSS JOIN LATERAL pg_catalog.aclexplode(facade.proacl) acl_entry JOIN pg_catalog.pg_roles role_entry ON role_entry.oid=acl_entry.grantee WHERE facade.oid='backtest_owner_api.lock_exploratory_result_v1(text,text,text,text)'::pg_catalog.regprocedure AND role_entry.rolname<>'backtest_owner' LOOP EXECUTE pg_catalog.format('REVOKE ALL ON FUNCTION backtest_owner_api.lock_exploratory_result_v1(text,text,text,text) FROM %I',grantee_name); END LOOP; END $acl$")
        .execute(&mut *transaction)
        .await
        .map_err(|_| PostgresReplayOwnerErrorV2::StorageUnavailable)?;
    for statement in [
        "REVOKE ALL ON FUNCTION backtest_owner_api.lock_exploratory_result_v1(text,text,text,text) FROM PUBLIC",
        "GRANT EXECUTE ON FUNCTION backtest_owner_api.lock_exploratory_result_v1(text,text,text,text) TO rd_owner",
    ] {
        sqlx::query(statement)
            .execute(&mut *transaction)
            .await
            .map_err(|_| PostgresReplayOwnerErrorV2::StorageUnavailable)?;
    }

    if !storage_shape_v2_in_transaction(&mut transaction).await? {
        return Err(PostgresReplayOwnerErrorV2::StorageUnavailable);
    }
    validate_principal_and_role_graph(&mut transaction).await?;
    validate_storage_acl(&mut transaction, false).await?;
    transaction
        .commit()
        .await
        .map_err(|_| PostgresReplayOwnerErrorV2::StorageUnavailable)
}

async fn persist_result(
    transaction: &mut Transaction<'_, Postgres>,
    locator: &ExploratoryReplayRequestLocatorV2,
    result: &SealedReplayResultV2,
    request_canonical_bytes: Vec<u8>,
    result_canonical_bytes: Vec<u8>,
) -> Result<ReplayResultReadbackV2, PostgresReplayOwnerErrorV2> {
    let request_bytes_digest =
        canonical_bytes_digest(REQUEST_STORAGE_DOMAIN, &request_canonical_bytes);
    let request_binding_digest = request_binding_digest(
        &request_canonical_bytes,
        &locator.seal_digest,
        &locator.receipt_identity,
    );
    let result_bytes_digest =
        canonical_bytes_digest(RESULT_STORAGE_DOMAIN, &result_canonical_bytes);
    let terminal = terminal_text(result.terminal());
    let existing = sqlx::query(sqlx::AssertSqlSafe(format!(
        "{READBACK_COLUMNS_V2} WHERE stored_run.request_identity=$1 AND stored_run.attempt_identity=$2 FOR UPDATE"
    )))
    .bind(result.request_identity().as_str())
    .bind(result.attempt_identity().as_str())
    .fetch_optional(&mut **transaction)
    .await
    .map_err(|_| PostgresReplayOwnerErrorV2::StorageUnavailable)?;

    if let Some(row) = existing {
        let identical = exact_existing_commit(
            &row,
            locator,
            result,
            &request_canonical_bytes,
            &result_canonical_bytes,
        )?;
        let readback = decode_row(&row)?;
        return if identical {
            Ok(readback)
        } else {
            Err(PostgresReplayOwnerErrorV2::ConflictingReplay)
        };
    }

    let run = sqlx::query(
        "INSERT INTO public.backtest_replay_runs_v2(request_identity,request_meaning_digest,request_seal_digest,rd_receipt_identity,request_binding_blake3,request_canonical_bytes,request_canonical_bytes_blake3,attempt_identity,result_identity,result_digest,terminal) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT DO NOTHING",
    )
    .bind(result.request_identity().as_str())
    .bind(result.request_meaning_digest().as_str())
    .bind(&locator.seal_digest)
    .bind(&locator.receipt_identity)
    .bind(&request_binding_digest)
    .bind(&request_canonical_bytes)
    .bind(&request_bytes_digest)
    .bind(result.attempt_identity().as_str())
    .bind(result.result_identity().as_str())
    .bind(result.result_digest().as_str())
    .bind(terminal)
    .execute(&mut **transaction)
    .await
    .map_err(|_| PostgresReplayOwnerErrorV2::StorageUnavailable)?;

    if run.rows_affected() == 0 {
        let row = sqlx::query(sqlx::AssertSqlSafe(format!(
            "{READBACK_COLUMNS_V2} WHERE stored_run.request_identity=$1 AND stored_run.attempt_identity=$2 FOR UPDATE"
        )))
        .bind(result.request_identity().as_str())
        .bind(result.attempt_identity().as_str())
        .fetch_optional(&mut **transaction)
        .await
        .map_err(|_| PostgresReplayOwnerErrorV2::StorageUnavailable)?
        .ok_or(PostgresReplayOwnerErrorV2::ConflictingReplay)?;
        return if exact_existing_commit(
            &row,
            locator,
            result,
            &request_canonical_bytes,
            &result_canonical_bytes,
        )? {
            decode_row(&row)
        } else {
            Err(PostgresReplayOwnerErrorV2::ConflictingReplay)
        };
    }
    sqlx::query(
        "INSERT INTO public.backtest_replay_results_v2(result_identity,result_digest,request_identity,request_meaning_digest,attempt_identity,terminal,canonical_bytes,canonical_bytes_blake3) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
    )
    .bind(result.result_identity().as_str())
    .bind(result.result_digest().as_str())
    .bind(result.request_identity().as_str())
    .bind(result.request_meaning_digest().as_str())
    .bind(result.attempt_identity().as_str())
    .bind(terminal)
    .bind(&result_canonical_bytes)
    .bind(&result_bytes_digest)
    .execute(&mut **transaction)
    .await
    .map_err(|_| PostgresReplayOwnerErrorV2::StorageUnavailable)?;
    let committed_at_epoch_ms: i64 = sqlx::query_scalar(
        "SELECT (pg_catalog.extract(epoch FROM transaction_timestamp())*1000)::bigint",
    )
    .fetch_one(&mut **transaction)
    .await
    .map_err(|_| PostgresReplayOwnerErrorV2::StorageUnavailable)?;
    let committed_at_epoch_ms = u64::try_from(committed_at_epoch_ms)
        .map_err(|_| PostgresReplayOwnerErrorV2::StorageUnavailable)?;
    let (receipt, receipt_canonical_bytes, outbox, outbox_canonical_bytes) =
        build_custody_wires(result, committed_at_epoch_ms)?;
    let receipt_bytes_digest =
        canonical_bytes_digest(RECEIPT_STORAGE_DOMAIN, &receipt_canonical_bytes);
    let outbox_bytes_digest =
        canonical_bytes_digest(OUTBOX_STORAGE_DOMAIN, &outbox_canonical_bytes);
    sqlx::query(
        "INSERT INTO public.backtest_replay_result_receipts_v1(result_identity,receipt_identity,receipt_digest,request_identity,request_meaning_digest,result_digest,namespace,outbox_event_identity,committed_at_epoch_ms,canonical_bytes,canonical_bytes_blake3) VALUES($1,$2,$3,$4,$5,$6,'EXPLORATORY',$7,$8,$9,$10)",
    )
    .bind(result.result_identity().as_str())
    .bind(receipt.receipt_identity.as_str())
    .bind(receipt.receipt_digest.as_str())
    .bind(result.request_identity().as_str())
    .bind(result.request_meaning_digest().as_str())
    .bind(result.result_digest().as_str())
    .bind(receipt.outbox_event_identity.as_str())
    .bind(i64::try_from(committed_at_epoch_ms).map_err(|_| PostgresReplayOwnerErrorV2::StorageUnavailable)?)
    .bind(&receipt_canonical_bytes)
    .bind(&receipt_bytes_digest)
    .execute(&mut **transaction)
    .await
    .map_err(|_| PostgresReplayOwnerErrorV2::StorageUnavailable)?;
    sqlx::query(
        "INSERT INTO public.backtest_replay_result_outbox_v1(result_identity,event_identity,event_digest,receipt_identity,request_identity,request_meaning_digest,result_digest,namespace,payload_digest,committed_at_epoch_ms,canonical_bytes,canonical_bytes_blake3) VALUES($1,$2,$3,$4,$5,$6,$7,'EXPLORATORY',$8,$9,$10,$11)",
    )
    .bind(result.result_identity().as_str())
    .bind(outbox.event_identity.as_str())
    .bind(outbox.event_digest.as_str())
    .bind(receipt.receipt_identity.as_str())
    .bind(result.request_identity().as_str())
    .bind(result.request_meaning_digest().as_str())
    .bind(result.result_digest().as_str())
    .bind(outbox.payload_digest.as_str())
    .bind(i64::try_from(committed_at_epoch_ms).map_err(|_| PostgresReplayOwnerErrorV2::StorageUnavailable)?)
    .bind(&outbox_canonical_bytes)
    .bind(&outbox_bytes_digest)
    .execute(&mut **transaction)
    .await
    .map_err(|_| PostgresReplayOwnerErrorV2::StorageUnavailable)?;
    Ok(readback_from_result(
        result,
        request_canonical_bytes,
        result_canonical_bytes,
        receipt_canonical_bytes,
        outbox_canonical_bytes,
    ))
}

fn build_custody_wires(
    result: &SealedReplayResultV2,
    committed_at_epoch_ms: u64,
) -> Result<
    (
        BacktestResultReceiptV1,
        Vec<u8>,
        BacktestResultOutboxV1,
        Vec<u8>,
    ),
    PostgresReplayOwnerErrorV2,
> {
    let result_suffix = result
        .result_digest()
        .as_str()
        .trim_start_matches("blake3:");
    let receipt_identity = typed_identity(format!("backtest-result-receipt-v1-{result_suffix}"))?;
    let event_identity = typed_identity(format!("backtest-result-outbox-v1-{result_suffix}"))?;
    let placeholder = typed_digest(format!("blake3:{}", "0".repeat(64)))?;
    let mut receipt = BacktestResultReceiptV1 {
        schema_version: 1,
        receipt_identity: receipt_identity.clone(),
        receipt_digest: placeholder.clone(),
        request_identity: result.request_identity().clone(),
        request_meaning_digest: result.request_meaning_digest().clone(),
        result_identity: result.result_identity().clone(),
        result_digest: result.result_digest().clone(),
        namespace: ReplayNamespaceV2::Exploratory,
        outbox_event_identity: event_identity.clone(),
        committed_at_epoch_ms,
    };
    receipt.receipt_digest = receipt
        .expected_digest()
        .map_err(|_| PostgresReplayOwnerErrorV2::StorageUnavailable)?;
    let payload = BacktestResultOutboxPayloadV1 {
        schema_version: 1,
        receipt_identity,
        receipt_digest: receipt.receipt_digest.clone(),
        request_identity: result.request_identity().clone(),
        request_meaning_digest: result.request_meaning_digest().clone(),
        result_identity: result.result_identity().clone(),
        result_digest: result.result_digest().clone(),
        namespace: ReplayNamespaceV2::Exploratory,
        committed_at_epoch_ms,
    };
    let mut outbox = BacktestResultOutboxV1 {
        schema_version: 1,
        event_identity,
        event_digest: placeholder.clone(),
        aggregate_identity: result.result_identity().clone(),
        event_kind: typed_identity(EXPLORATORY_RESULT_COMMITTED_EVENT_KIND_V1.to_string())?,
        payload_digest: placeholder,
        payload,
        committed_at_epoch_ms,
    };
    outbox.payload_digest = outbox
        .expected_payload_digest()
        .map_err(|_| PostgresReplayOwnerErrorV2::StorageUnavailable)?;
    outbox.event_digest = outbox
        .expected_event_digest()
        .map_err(|_| PostgresReplayOwnerErrorV2::StorageUnavailable)?;
    let receipt_bytes =
        serde_json::to_vec(&receipt).map_err(|_| PostgresReplayOwnerErrorV2::StorageUnavailable)?;
    let outbox_bytes =
        serde_json::to_vec(&outbox).map_err(|_| PostgresReplayOwnerErrorV2::StorageUnavailable)?;
    Ok((receipt, receipt_bytes, outbox, outbox_bytes))
}

fn exact_existing_commit(
    row: &sqlx::postgres::PgRow,
    locator: &ExploratoryReplayRequestLocatorV2,
    result: &SealedReplayResultV2,
    request_canonical_bytes: &[u8],
    result_canonical_bytes: &[u8],
) -> Result<bool, PostgresReplayOwnerErrorV2> {
    let readback = decode_row(row)?;
    let request_seal_digest: String = row.try_get("request_seal_digest")?;
    let rd_receipt_identity: String = row.try_get("rd_receipt_identity")?;
    Ok(readback.result_identity() == result.result_identity()
        && readback.result_digest() == result.result_digest()
        && readback.request_identity() == result.request_identity()
        && readback.request_meaning_digest() == result.request_meaning_digest()
        && readback.attempt_identity() == result.attempt_identity()
        && readback.terminal() == result.terminal()
        && readback.request_canonical_bytes() == request_canonical_bytes
        && readback.result_canonical_bytes() == result_canonical_bytes
        && request_seal_digest == locator.seal_digest
        && rd_receipt_identity == locator.receipt_identity)
}

fn decode_row(
    row: &sqlx::postgres::PgRow,
) -> Result<ReplayResultReadbackV2, PostgresReplayOwnerErrorV2> {
    let result_identity = typed_identity(row.try_get("result_identity")?)?;
    let result_digest = typed_digest(row.try_get("result_digest")?)?;
    let request_identity = typed_identity(row.try_get("request_identity")?)?;
    let request_meaning_digest = typed_digest(row.try_get("request_meaning_digest")?)?;
    let attempt_identity = typed_identity(row.try_get("attempt_identity")?)?;
    let terminal_value: String = row.try_get("terminal")?;
    let terminal = parse_terminal(&terminal_value)?;
    let request_canonical_bytes: Vec<u8> = row.try_get("request_canonical_bytes")?;
    let request_bytes_digest: String = row.try_get("request_canonical_bytes_blake3")?;
    let request_seal_digest: String = row.try_get("request_seal_digest")?;
    let rd_receipt_identity: String = row.try_get("rd_receipt_identity")?;
    let stored_request_binding_digest: String = row.try_get("request_binding_blake3")?;
    let result_canonical_bytes: Vec<u8> = row.try_get("canonical_bytes")?;
    let result_bytes_digest: String = row.try_get("canonical_bytes_blake3")?;
    let receipt_canonical_bytes: Vec<u8> = row.try_get("receipt_canonical_bytes")?;
    let receipt_bytes_digest: String = row.try_get("receipt_canonical_bytes_blake3")?;
    let outbox_canonical_bytes: Vec<u8> = row.try_get("outbox_canonical_bytes")?;
    let outbox_bytes_digest: String = row.try_get("outbox_canonical_bytes_blake3")?;

    if canonical_bytes_digest(REQUEST_STORAGE_DOMAIN, &request_canonical_bytes)
        != request_bytes_digest
        || request_seal_digest.is_empty()
        || rd_receipt_identity.is_empty()
        || request_binding_digest(
            &request_canonical_bytes,
            &request_seal_digest,
            &rd_receipt_identity,
        ) != stored_request_binding_digest
        || canonical_bytes_digest(RESULT_STORAGE_DOMAIN, &result_canonical_bytes)
            != result_bytes_digest
        || canonical_bytes_digest(RECEIPT_STORAGE_DOMAIN, &receipt_canonical_bytes)
            != receipt_bytes_digest
        || canonical_bytes_digest(OUTBOX_STORAGE_DOMAIN, &outbox_canonical_bytes)
            != outbox_bytes_digest
    {
        return Err(PostgresReplayOwnerErrorV2::CorruptReadback);
    }
    let run_request_identity: String = row.try_get("run_request_identity")?;
    let run_request_meaning_digest: String = row.try_get("run_request_meaning_digest")?;
    let run_attempt_identity: String = row.try_get("run_attempt_identity")?;
    let run_result_identity: String = row.try_get("run_result_identity")?;
    let run_result_digest: String = row.try_get("run_result_digest")?;
    let run_terminal: String = row.try_get("run_terminal")?;

    if run_request_identity != request_identity.as_str()
        || run_request_meaning_digest != request_meaning_digest.as_str()
        || run_attempt_identity != attempt_identity.as_str()
        || run_result_identity != result_identity.as_str()
        || run_result_digest != result_digest.as_str()
        || run_terminal != terminal_value
    {
        return Err(PostgresReplayOwnerErrorV2::CorruptReadback);
    }
    validate_stored_request(
        &request_canonical_bytes,
        &request_identity,
        &request_meaning_digest,
    )?;
    validate_stored_result(
        &result_canonical_bytes,
        &result_identity,
        &result_digest,
        &request_identity,
        &request_meaning_digest,
        &attempt_identity,
        &terminal_value,
    )?;
    validate_stored_custody_wires(
        row,
        &receipt_canonical_bytes,
        &outbox_canonical_bytes,
        &result_identity,
        &result_digest,
        &request_identity,
        &request_meaning_digest,
    )?;
    Ok(ReplayResultReadbackV2 {
        result_identity,
        result_digest,
        request_identity,
        request_meaning_digest,
        attempt_identity,
        terminal,
        request_canonical_bytes,
        result_canonical_bytes,
        receipt_canonical_bytes,
        outbox_canonical_bytes,
    })
}

fn validate_stored_custody_wires(
    row: &sqlx::postgres::PgRow,
    receipt_bytes: &[u8],
    outbox_bytes: &[u8],
    result_identity: &OpaqueIdentityV2,
    result_digest: &CanonicalDigestV2,
    request_identity: &OpaqueIdentityV2,
    request_meaning_digest: &CanonicalDigestV2,
) -> Result<(), PostgresReplayOwnerErrorV2> {
    let receipt: BacktestResultReceiptV1 = serde_json::from_slice(receipt_bytes)
        .map_err(|_| PostgresReplayOwnerErrorV2::CorruptReadback)?;
    let outbox: BacktestResultOutboxV1 = serde_json::from_slice(outbox_bytes)
        .map_err(|_| PostgresReplayOwnerErrorV2::CorruptReadback)?;
    let canonical = serde_json::to_vec(&receipt)
        .map_err(|_| PostgresReplayOwnerErrorV2::CorruptReadback)?
        == receipt_bytes
        && serde_json::to_vec(&outbox).map_err(|_| PostgresReplayOwnerErrorV2::CorruptReadback)?
            == outbox_bytes;
    let receipt_committed_at_epoch_ms: i64 = row.try_get("receipt_committed_at_epoch_ms")?;
    let outbox_committed_at_epoch_ms: i64 = row.try_get("outbox_committed_at_epoch_ms")?;
    let valid = canonical
        && receipt.namespace == ReplayNamespaceV2::Exploratory
        && receipt.expected_digest().ok().as_ref() == Some(&receipt.receipt_digest)
        && &receipt.request_identity == request_identity
        && &receipt.request_meaning_digest == request_meaning_digest
        && &receipt.result_identity == result_identity
        && &receipt.result_digest == result_digest
        && outbox.payload.namespace == ReplayNamespaceV2::Exploratory
        && outbox.event_kind.as_str() == EXPLORATORY_RESULT_COMMITTED_EVENT_KIND_V1
        && outbox.expected_payload_digest().ok().as_ref() == Some(&outbox.payload_digest)
        && outbox.expected_event_digest().ok().as_ref() == Some(&outbox.event_digest)
        && outbox.aggregate_identity == *result_identity
        && outbox.payload.receipt_identity == receipt.receipt_identity
        && outbox.payload.receipt_digest == receipt.receipt_digest
        && outbox.payload.request_identity == *request_identity
        && outbox.payload.request_meaning_digest == *request_meaning_digest
        && outbox.payload.result_identity == *result_identity
        && outbox.payload.result_digest == *result_digest
        && outbox.payload.committed_at_epoch_ms == receipt.committed_at_epoch_ms
        && outbox.committed_at_epoch_ms == receipt.committed_at_epoch_ms
        && receipt.outbox_event_identity == outbox.event_identity
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
        && u64::try_from(outbox_committed_at_epoch_ms).ok() == Some(outbox.committed_at_epoch_ms);
    if valid {
        Ok(())
    } else {
        Err(PostgresReplayOwnerErrorV2::CorruptReadback)
    }
}

fn validate_stored_request(
    canonical_bytes: &[u8],
    request_identity: &OpaqueIdentityV2,
    request_meaning_digest: &CanonicalDigestV2,
) -> Result<(), PostgresReplayOwnerErrorV2> {
    let request_dto: ReplayRequestDtoV2 = serde_json::from_slice(canonical_bytes)
        .map_err(|_| PostgresReplayOwnerErrorV2::CorruptReadback)?;
    let request = ReplayRequestV2::try_from(request_dto)
        .map_err(|_| PostgresReplayOwnerErrorV2::CorruptReadback)?;
    let digest = request
        .meaning_digest()
        .map_err(|_| PostgresReplayOwnerErrorV2::CorruptReadback)?;

    if request.request_identity() != request_identity
        || &digest != request_meaning_digest
        || request
            .to_canonical_bytes()
            .map_err(|_| PostgresReplayOwnerErrorV2::CorruptReadback)?
            != canonical_bytes
    {
        return Err(PostgresReplayOwnerErrorV2::CorruptReadback);
    }
    Ok(())
}

fn validate_stored_result(
    canonical_bytes: &[u8],
    result_identity: &OpaqueIdentityV2,
    result_digest: &CanonicalDigestV2,
    request_identity: &OpaqueIdentityV2,
    request_meaning_digest: &CanonicalDigestV2,
    attempt_identity: &OpaqueIdentityV2,
    terminal_value: &str,
) -> Result<(), PostgresReplayOwnerErrorV2> {
    let value: serde_json::Value = serde_json::from_slice(canonical_bytes)
        .map_err(|_| PostgresReplayOwnerErrorV2::CorruptReadback)?;
    let matches = value
        .get("schema_version")
        .and_then(serde_json::Value::as_u64)
        == Some(2)
        && value
            .get("result_identity")
            .and_then(serde_json::Value::as_str)
            == Some(result_identity.as_str())
        && value
            .get("result_digest")
            .and_then(serde_json::Value::as_str)
            == Some(result_digest.as_str())
        && value
            .get("request_identity")
            .and_then(serde_json::Value::as_str)
            == Some(request_identity.as_str())
        && value
            .get("request_meaning_digest")
            .and_then(serde_json::Value::as_str)
            == Some(request_meaning_digest.as_str())
        && value
            .get("attempt_identity")
            .and_then(serde_json::Value::as_str)
            == Some(attempt_identity.as_str())
        && value.get("terminal").and_then(serde_json::Value::as_str) == Some(terminal_value)
        && value.get("namespace").and_then(serde_json::Value::as_str) == Some("EXPLORATORY")
        && value
            .get("replay_authority")
            .and_then(|authority| authority.get("namespace"))
            .and_then(serde_json::Value::as_str)
            == Some("EXPLORATORY")
        && value
            .get("reconciliation")
            .and_then(serde_json::Value::as_array)
            .is_some_and(|atoms| atoms.len() == 28)
        && value
            .get("diagnostic_census")
            .and_then(serde_json::Value::as_array)
            .is_some_and(|diagnostics| !diagnostics.is_empty())
        && (terminal_value != "TERMINAL_RESULT"
            || value
                .get("semantic_trace")
                .is_some_and(serde_json::Value::is_object));

    if !matches || !stored_result_digest_matches(canonical_bytes, result_identity, result_digest) {
        return Err(PostgresReplayOwnerErrorV2::CorruptReadback);
    }
    Ok(())
}

fn stored_result_digest_matches(
    canonical_bytes: &[u8],
    result_identity: &OpaqueIdentityV2,
    result_digest: &CanonicalDigestV2,
) -> bool {
    let Ok(encoded_identity) = serde_json::to_string(result_identity.as_str()) else {
        return false;
    };
    let Ok(encoded_digest) = serde_json::to_string(result_digest.as_str()) else {
        return false;
    };
    let sealed_prefix = format!(
        "{{\"schema_version\":2,\"result_identity\":{encoded_identity},\"result_digest\":{encoded_digest},"
    );
    let Some(remainder) = canonical_bytes.strip_prefix(sealed_prefix.as_bytes()) else {
        return false;
    };
    let mut provisional_bytes = b"{\"schema_version\":2,".to_vec();
    provisional_bytes.extend_from_slice(remainder);
    let mut hasher = blake3::Hasher::new();
    hasher.update(b"vibe.backtest.replay-result.v2\0");
    hasher.update(&provisional_bytes);
    let computed = format!("blake3:{}", hasher.finalize().to_hex());
    result_digest.as_str() == computed
        && result_identity.as_str()
            == format!(
                "backtest-replay-result-v2-{}",
                computed.trim_start_matches("blake3:")
            )
}

fn readback_from_result(
    result: &SealedReplayResultV2,
    request_canonical_bytes: Vec<u8>,
    result_canonical_bytes: Vec<u8>,
    receipt_canonical_bytes: Vec<u8>,
    outbox_canonical_bytes: Vec<u8>,
) -> ReplayResultReadbackV2 {
    ReplayResultReadbackV2 {
        result_identity: result.result_identity().clone(),
        result_digest: result.result_digest().clone(),
        request_identity: result.request_identity().clone(),
        request_meaning_digest: result.request_meaning_digest().clone(),
        attempt_identity: result.attempt_identity().clone(),
        terminal: result.terminal(),
        request_canonical_bytes,
        result_canonical_bytes,
        receipt_canonical_bytes,
        outbox_canonical_bytes,
    }
}

fn typed_identity(value: String) -> Result<OpaqueIdentityV2, PostgresReplayOwnerErrorV2> {
    value
        .try_into()
        .map_err(|_| PostgresReplayOwnerErrorV2::CorruptReadback)
}

fn typed_digest(value: String) -> Result<CanonicalDigestV2, PostgresReplayOwnerErrorV2> {
    value
        .try_into()
        .map_err(|_| PostgresReplayOwnerErrorV2::CorruptReadback)
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

fn parse_terminal(value: &str) -> Result<ReplayTerminalV2, PostgresReplayOwnerErrorV2> {
    match value {
        "TERMINAL_RESULT" => Ok(ReplayTerminalV2::TerminalResult),
        "INVALID_REPLAY_EVIDENCE" => Ok(ReplayTerminalV2::InvalidReplayEvidence),
        "RUN_REJECTED" => Ok(ReplayTerminalV2::RunRejected),
        "IN_PROGRESS_OR_UNKNOWN" => Ok(ReplayTerminalV2::InProgressOrUnknown),
        _ => Err(PostgresReplayOwnerErrorV2::CorruptReadback),
    }
}

impl From<sqlx::Error> for PostgresReplayOwnerErrorV2 {
    fn from(_: sqlx::Error) -> Self {
        Self::CorruptReadback
    }
}

#[cfg(test)]
#[path = "../tests/postgres_replay_v2.rs"]
mod postgres_replay_v2;

#[cfg(test)]
crate::postgres_replay_v2_tests!();
