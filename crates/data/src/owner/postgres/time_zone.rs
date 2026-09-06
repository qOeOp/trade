//! Caller-transaction-only PostgreSQL custody for native Time Zone V1.

#![allow(
    dead_code,
    reason = "C2 is intentionally not installed by global migration"
)]

use sqlx::{PgPool, Postgres, Row, Transaction};

use super::reference_fact_catalog::{
    resolve_reference_fact_catalog_entry_v1, verify_reference_fact_catalog_head_v1,
};
use crate::owner::{
    reference_fact_catalog::{
        ReferenceFactCatalogEntryV1, ReferenceFactCatalogValueV1,
        UntrustedReferenceFactCatalogLocatorV1,
    },
    source_binding::BindingDigest,
    time_zone::{
        ResolvedTimeZoneFactProposalV1, TimeZoneErrorV1, TimeZoneFactProposalV1,
        TimeZoneReadbackV1, UntrustedTimeZoneLocatorV1, UntrustedTimeZoneRequestV1,
        authority::{
            decode_fact_v1, prepare_resolution_v1, rejoin_stored_v1, request_meaning_digest_v1,
            seal_readback_v1, validate_ordered_cut_fact_sequence_v1,
        },
        codec,
    },
};

pub(super) const TIME_ZONE_RELATIONS_V1: &[&str] = &[
    "time_zone_state_v1",
    "time_zone_facts_v1",
    "time_zone_heads_v1",
    "time_zone_cuts_v1",
    "time_zone_cut_facts_v1",
    "time_zone_receipts_v1",
    "time_zone_outbox_v1",
];

const TIME_ZONE_CUSTODY_QUERY_V1: &str = "WITH expected(relation_name) AS (
  VALUES
    ('time_zone_state_v1'),
    ('time_zone_facts_v1'),
    ('time_zone_heads_v1'),
    ('time_zone_cuts_v1'),
    ('time_zone_cut_facts_v1'),
    ('time_zone_receipts_v1'),
    ('time_zone_outbox_v1')
), expected_columns(relation_name,ordinal,column_name,column_type,not_null,default_expression) AS (
  VALUES
    ('time_zone_state_v1',1,'singleton','boolean',true,'true'),
    ('time_zone_state_v1',2,'store_generation_identity','bytea',true,''),
    ('time_zone_state_v1',3,'append_sequence','bigint',true,''),
    ('time_zone_facts_v1',1,'fact_identity','bytea',true,''),
    ('time_zone_facts_v1',2,'time_zone_identity','bytea',true,''),
    ('time_zone_facts_v1',3,'ruleset_identity','bytea',true,''),
    ('time_zone_facts_v1',4,'catalog_entry_identity','bytea',true,''),
    ('time_zone_facts_v1',5,'lineage_root','bytea',true,''),
    ('time_zone_facts_v1',6,'correction_sequence','bigint',true,''),
    ('time_zone_facts_v1',7,'predecessor_identity','bytea',false,''),
    ('time_zone_facts_v1',8,'effective_from_ns','text',true,''),
    ('time_zone_facts_v1',9,'effective_until_ns','text',false,''),
    ('time_zone_facts_v1',10,'fact_bytes','bytea',true,''),
    ('time_zone_heads_v1',1,'lineage_root','bytea',true,''),
    ('time_zone_heads_v1',2,'fact_identity','bytea',true,''),
    ('time_zone_cuts_v1',1,'cut_identity','bytea',true,''),
    ('time_zone_cuts_v1',2,'request_identity','bytea',true,''),
    ('time_zone_cuts_v1',3,'request_meaning_digest','bytea',true,''),
    ('time_zone_cuts_v1',4,'cut_bytes','bytea',true,''),
    ('time_zone_cut_facts_v1',1,'cut_identity','bytea',true,''),
    ('time_zone_cut_facts_v1',2,'ordinal','bigint',true,''),
    ('time_zone_cut_facts_v1',3,'fact_identity','bytea',true,''),
    ('time_zone_receipts_v1',1,'request_identity','bytea',true,''),
    ('time_zone_receipts_v1',2,'request_meaning_digest','bytea',true,''),
    ('time_zone_receipts_v1',3,'cut_identity','bytea',true,''),
    ('time_zone_receipts_v1',4,'receipt_identity','bytea',true,''),
    ('time_zone_receipts_v1',5,'receipt_bytes','bytea',true,''),
    ('time_zone_receipts_v1',6,'append_sequence','bigint',true,''),
    ('time_zone_outbox_v1',1,'outbox_identity','bytea',true,''),
    ('time_zone_outbox_v1',2,'request_identity','bytea',true,''),
    ('time_zone_outbox_v1',3,'receipt_bytes','bytea',true,'')
), expected_keys(relation_name,constraint_type,columns,foreign_relation,foreign_columns) AS (
  VALUES
    ('time_zone_state_v1','p','singleton','',''),
    ('time_zone_facts_v1','p','fact_identity','',''),
    ('time_zone_facts_v1','u','catalog_entry_identity','',''),
    ('time_zone_facts_v1','f','predecessor_identity','time_zone_facts_v1','fact_identity'),
    ('time_zone_heads_v1','p','lineage_root','',''),
    ('time_zone_heads_v1','u','fact_identity','',''),
    ('time_zone_heads_v1','f','fact_identity','time_zone_facts_v1','fact_identity'),
    ('time_zone_cuts_v1','p','cut_identity','',''),
    ('time_zone_cuts_v1','u','request_identity','',''),
    ('time_zone_cut_facts_v1','p','cut_identity ordinal','',''),
    ('time_zone_cut_facts_v1','u','cut_identity fact_identity','',''),
    ('time_zone_cut_facts_v1','f','cut_identity','time_zone_cuts_v1','cut_identity'),
    ('time_zone_cut_facts_v1','f','fact_identity','time_zone_facts_v1','fact_identity'),
    ('time_zone_receipts_v1','p','request_identity','',''),
    ('time_zone_receipts_v1','u','cut_identity','',''),
    ('time_zone_receipts_v1','u','receipt_identity','',''),
    ('time_zone_receipts_v1','u','append_sequence','',''),
    ('time_zone_receipts_v1','f','cut_identity','time_zone_cuts_v1','cut_identity'),
    ('time_zone_outbox_v1','p','outbox_identity','',''),
    ('time_zone_outbox_v1','u','request_identity','',''),
    ('time_zone_outbox_v1','f','request_identity','time_zone_receipts_v1','request_identity')
), expected_checks(relation_name,expression) AS (
  VALUES
    ('time_zone_state_v1','singleton'),
    ('time_zone_state_v1','(octet_length(store_generation_identity) = 32)'),
    ('time_zone_state_v1','(append_sequence >= 0)'),
    ('time_zone_facts_v1','(octet_length(fact_identity) = 32)'),
    ('time_zone_facts_v1','(octet_length(time_zone_identity) > 0)'),
    ('time_zone_facts_v1','(octet_length(ruleset_identity) = 32)'),
    ('time_zone_facts_v1','(octet_length(catalog_entry_identity) = 32)'),
    ('time_zone_facts_v1','(octet_length(lineage_root) = 32)'),
    ('time_zone_facts_v1','(correction_sequence > 0)'),
    ('time_zone_facts_v1','(octet_length(fact_bytes) > 0)'),
    ('time_zone_heads_v1','(octet_length(lineage_root) = 32)'),
    ('time_zone_cuts_v1','(octet_length(cut_identity) = 32)'),
    ('time_zone_cuts_v1','(octet_length(request_identity) = 32)'),
    ('time_zone_cuts_v1','(octet_length(request_meaning_digest) = 32)'),
    ('time_zone_cuts_v1','(octet_length(cut_bytes) > 0)'),
    ('time_zone_cut_facts_v1','(ordinal > 0)'),
    ('time_zone_receipts_v1','(octet_length(request_meaning_digest) = 32)'),
    ('time_zone_receipts_v1','(octet_length(receipt_identity) = 32)'),
    ('time_zone_receipts_v1','(octet_length(receipt_bytes) > 0)'),
    ('time_zone_receipts_v1','(append_sequence > 0)'),
    ('time_zone_outbox_v1','(octet_length(outbox_identity) = 32)'),
    ('time_zone_outbox_v1','(octet_length(receipt_bytes) > 0)')
), relations AS (
  SELECT expected.relation_name,
         relation.oid,
         relation.relowner,
         relation.relkind,
         relation.relpersistence,
         relation.relrowsecurity,
         relation.relforcerowsecurity,
         relation.reloptions,
         relation.relacl
    FROM expected
    LEFT JOIN pg_catalog.pg_namespace namespace
      ON namespace.nspname='market_data_private'
    LEFT JOIN pg_catalog.pg_class relation
      ON relation.relnamespace=namespace.oid
     AND relation.relname=expected.relation_name
)
SELECT (
         SELECT count(*)=1
            AND pg_catalog.bool_and(pg_catalog.pg_get_userbyid(namespace.nspowner)='market_data_owner')
            AND pg_catalog.bool_and(NOT EXISTS (
              SELECT 1
                FROM pg_catalog.aclexplode(COALESCE(
                  namespace.nspacl,
                  pg_catalog.acldefault('n',namespace.nspowner)
                )) acl
               WHERE acl.grantee<>namespace.nspowner
            ))
           FROM pg_catalog.pg_namespace namespace
          WHERE namespace.nspname='market_data_private'
       )
   AND count(*)=(SELECT count(*) FROM expected)
   AND (SELECT count(*)=31 AND pg_catalog.bool_and(
         (relations.relation_name,attribute.attnum,attribute.attname,
          pg_catalog.format_type(attribute.atttypid,attribute.atttypmod),attribute.attnotnull,
          COALESCE(pg_catalog.pg_get_expr(default_fact.adbin,default_fact.adrelid),'') )
         IN (SELECT * FROM expected_columns)
         AND attribute.attidentity=''
         AND attribute.attgenerated=''
         AND attribute.attacl IS NULL
         AND attribute.attcollation=attribute_type.typcollation
         AND attribute.attndims=0
         AND attribute.attislocal
         AND attribute.attinhcount=0
       )
       FROM relations
       JOIN pg_catalog.pg_attribute attribute
         ON attribute.attrelid=relations.oid AND attribute.attnum>0 AND NOT attribute.attisdropped
       JOIN pg_catalog.pg_type attribute_type ON attribute_type.oid=attribute.atttypid
       LEFT JOIN pg_catalog.pg_attrdef default_fact
         ON default_fact.adrelid=relations.oid AND default_fact.adnum=attribute.attnum)
   AND NOT EXISTS (
         SELECT 1 FROM pg_catalog.pg_attribute attribute
          WHERE attribute.attrelid IN (SELECT oid FROM relations)
            AND attribute.attnum>0 AND attribute.attisdropped
       )
   AND (SELECT count(*)=21 AND pg_catalog.bool_and(
         (relations.relation_name,constraint_fact.contype::text,
          pg_catalog.array_to_string(ARRAY(SELECT attribute.attname FROM pg_catalog.unnest(constraint_fact.conkey) WITH ORDINALITY key(attnum,ordinality) JOIN pg_catalog.pg_attribute attribute ON attribute.attrelid=constraint_fact.conrelid AND attribute.attnum=key.attnum ORDER BY key.ordinality),' '),
          COALESCE(foreign_relation.relname,''),
          COALESCE(pg_catalog.array_to_string(ARRAY(SELECT attribute.attname FROM pg_catalog.unnest(constraint_fact.confkey) WITH ORDINALITY key(attnum,ordinality) JOIN pg_catalog.pg_attribute attribute ON attribute.attrelid=constraint_fact.confrelid AND attribute.attnum=key.attnum ORDER BY key.ordinality),' '),''))
         IN (SELECT * FROM expected_keys)
         AND NOT constraint_fact.condeferrable
         AND NOT constraint_fact.condeferred
         AND constraint_fact.convalidated
         AND constraint_fact.connoinherit
         AND constraint_fact.conislocal
         AND constraint_fact.coninhcount=0
         AND (constraint_fact.contype<>'f' OR (
           constraint_fact.confmatchtype='s' AND constraint_fact.confupdtype='a'
           AND constraint_fact.confdeltype='a' AND constraint_fact.confdelsetcols IS NULL
           AND foreign_relation.relnamespace=(SELECT oid FROM pg_catalog.pg_namespace WHERE nspname='market_data_private')
         ))
       )
       FROM pg_catalog.pg_constraint constraint_fact
       JOIN relations ON relations.oid=constraint_fact.conrelid
       LEFT JOIN pg_catalog.pg_class foreign_relation ON foreign_relation.oid=constraint_fact.confrelid
      WHERE constraint_fact.contype IN ('p','u','f'))
   AND (SELECT count(*)=22 AND pg_catalog.bool_and(
         (relations.relation_name,pg_catalog.pg_get_expr(constraint_fact.conbin,constraint_fact.conrelid,false))
         IN (SELECT * FROM expected_checks)
         AND NOT constraint_fact.condeferrable
         AND NOT constraint_fact.condeferred
         AND constraint_fact.convalidated
         AND NOT constraint_fact.connoinherit
         AND constraint_fact.conislocal
         AND constraint_fact.coninhcount=0
       )
       FROM pg_catalog.pg_constraint constraint_fact
       JOIN relations ON relations.oid=constraint_fact.conrelid
      WHERE constraint_fact.contype='c')
   AND NOT EXISTS (
         SELECT 1 FROM pg_catalog.pg_constraint constraint_fact
          WHERE constraint_fact.conrelid IN (SELECT oid FROM relations)
            AND constraint_fact.contype NOT IN ('p','u','f','c')
       )
   AND NOT EXISTS (
         SELECT 1 FROM pg_catalog.pg_inherits inheritance
          WHERE inheritance.inhrelid IN (SELECT oid FROM relations)
             OR inheritance.inhparent IN (SELECT oid FROM relations)
       )
   AND pg_catalog.bool_and(
         relations.oid IS NOT NULL
         AND pg_catalog.pg_get_userbyid(relations.relowner)='market_data_owner'
         AND relations.relkind='r'
         AND relations.relpersistence='p'
         AND NOT relations.relrowsecurity
         AND NOT relations.relforcerowsecurity
         AND relations.reloptions IS NULL
         AND NOT EXISTS (
           SELECT 1
             FROM pg_catalog.aclexplode(COALESCE(
               relations.relacl,
               pg_catalog.acldefault('r',relations.relowner)
             )) acl
            WHERE acl.grantee<>relations.relowner
         )
         AND NOT EXISTS (
           SELECT 1
             FROM pg_catalog.pg_attribute attribute
             CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) acl
            WHERE attribute.attrelid=relations.oid
              AND attribute.attnum>0
              AND NOT attribute.attisdropped
              AND acl.grantee<>relations.relowner
         )
         AND NOT EXISTS (
           SELECT 1
             FROM pg_catalog.pg_trigger trigger_entry
            WHERE trigger_entry.tgrelid=relations.oid
              AND NOT trigger_entry.tgisinternal
         )
         AND NOT EXISTS (
           SELECT 1
             FROM pg_catalog.pg_policy policy
            WHERE policy.polrelid=relations.oid
         )
       )
  FROM relations";

pub(super) const TIME_ZONE_SCHEMA_V1: &[&str] = &[
    super::OWNER_SCHEMA_GUARD_V1,
    "REVOKE ALL ON SCHEMA market_data_private FROM PUBLIC",
    "CREATE TABLE IF NOT EXISTS market_data_private.time_zone_state_v1(singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK(singleton),store_generation_identity BYTEA NOT NULL CHECK(octet_length(store_generation_identity)=32),append_sequence BIGINT NOT NULL CHECK(append_sequence>=0))",
    "CREATE TABLE IF NOT EXISTS market_data_private.time_zone_facts_v1(fact_identity BYTEA PRIMARY KEY CHECK(octet_length(fact_identity)=32),time_zone_identity BYTEA NOT NULL CHECK(octet_length(time_zone_identity)>0),ruleset_identity BYTEA NOT NULL CHECK(octet_length(ruleset_identity)=32),catalog_entry_identity BYTEA UNIQUE NOT NULL CHECK(octet_length(catalog_entry_identity)=32),lineage_root BYTEA NOT NULL CHECK(octet_length(lineage_root)=32),correction_sequence BIGINT NOT NULL CHECK(correction_sequence>0),predecessor_identity BYTEA NULL REFERENCES market_data_private.time_zone_facts_v1(fact_identity),effective_from_ns TEXT NOT NULL,effective_until_ns TEXT NULL,fact_bytes BYTEA NOT NULL CHECK(octet_length(fact_bytes)>0))",
    "CREATE TABLE IF NOT EXISTS market_data_private.time_zone_heads_v1(lineage_root BYTEA PRIMARY KEY CHECK(octet_length(lineage_root)=32),fact_identity BYTEA UNIQUE NOT NULL REFERENCES market_data_private.time_zone_facts_v1(fact_identity))",
    "CREATE TABLE IF NOT EXISTS market_data_private.time_zone_cuts_v1(cut_identity BYTEA PRIMARY KEY CHECK(octet_length(cut_identity)=32),request_identity BYTEA UNIQUE NOT NULL CHECK(octet_length(request_identity)=32),request_meaning_digest BYTEA NOT NULL CHECK(octet_length(request_meaning_digest)=32),cut_bytes BYTEA NOT NULL CHECK(octet_length(cut_bytes)>0))",
    "CREATE TABLE IF NOT EXISTS market_data_private.time_zone_cut_facts_v1(cut_identity BYTEA NOT NULL REFERENCES market_data_private.time_zone_cuts_v1(cut_identity),ordinal BIGINT NOT NULL CHECK(ordinal>0),fact_identity BYTEA NOT NULL REFERENCES market_data_private.time_zone_facts_v1(fact_identity),PRIMARY KEY(cut_identity,ordinal),UNIQUE(cut_identity,fact_identity))",
    "CREATE TABLE IF NOT EXISTS market_data_private.time_zone_receipts_v1(request_identity BYTEA PRIMARY KEY,request_meaning_digest BYTEA NOT NULL CHECK(octet_length(request_meaning_digest)=32),cut_identity BYTEA UNIQUE NOT NULL REFERENCES market_data_private.time_zone_cuts_v1(cut_identity),receipt_identity BYTEA UNIQUE NOT NULL CHECK(octet_length(receipt_identity)=32),receipt_bytes BYTEA NOT NULL CHECK(octet_length(receipt_bytes)>0),append_sequence BIGINT UNIQUE NOT NULL CHECK(append_sequence>0))",
    "CREATE TABLE IF NOT EXISTS market_data_private.time_zone_outbox_v1(outbox_identity BYTEA PRIMARY KEY CHECK(octet_length(outbox_identity)=32),request_identity BYTEA UNIQUE NOT NULL REFERENCES market_data_private.time_zone_receipts_v1(request_identity),receipt_bytes BYTEA NOT NULL CHECK(octet_length(receipt_bytes)>0))",
    "REVOKE ALL ON TABLE market_data_private.time_zone_state_v1 FROM PUBLIC",
    "REVOKE ALL ON TABLE market_data_private.time_zone_facts_v1 FROM PUBLIC",
    "REVOKE ALL ON TABLE market_data_private.time_zone_heads_v1 FROM PUBLIC",
    "REVOKE ALL ON TABLE market_data_private.time_zone_cuts_v1 FROM PUBLIC",
    "REVOKE ALL ON TABLE market_data_private.time_zone_cut_facts_v1 FROM PUBLIC",
    "REVOKE ALL ON TABLE market_data_private.time_zone_receipts_v1 FROM PUBLIC",
    "REVOKE ALL ON TABLE market_data_private.time_zone_outbox_v1 FROM PUBLIC",
];

pub(super) async fn verify_time_zone_custody_v1(pool: &PgPool) -> Result<(), TimeZoneErrorV1> {
    let exact: bool = sqlx::query_scalar(TIME_ZONE_CUSTODY_QUERY_V1)
        .fetch_one(pool)
        .await
        .map_err(store_error)?;

    if !exact {
        return Err(TimeZoneErrorV1::StoreUntrusted);
    }
    Ok(())
}

pub(super) async fn install_time_zone_schema_v1(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<(), TimeZoneErrorV1> {
    for statement in TIME_ZONE_SCHEMA_V1 {
        sqlx::query(*statement)
            .execute(&mut **transaction)
            .await
            .map_err(store_error)?;
    }
    Ok(())
}

pub(super) async fn resolve_time_zone_in_transaction_v1(
    transaction: &mut Transaction<'_, Postgres>,
    request: UntrustedTimeZoneRequestV1,
    proposals: Vec<TimeZoneFactProposalV1>,
    r0_cut_identity: BindingDigest,
    r0_cut_digest: BindingDigest,
) -> Result<TimeZoneReadbackV1, TimeZoneErrorV1> {
    sqlx::query("SAVEPOINT market_data_time_zone_v1")
        .execute(&mut **transaction)
        .await
        .map_err(store_error)?;
    let result = resolve_inner(
        transaction,
        request,
        proposals,
        r0_cut_identity,
        r0_cut_digest,
    )
    .await;

    match result {
        Ok(readback) => {
            sqlx::query("RELEASE SAVEPOINT market_data_time_zone_v1")
                .execute(&mut **transaction)
                .await
                .map_err(store_error)?;
            Ok(readback)
        }
        Err(e) => {
            sqlx::query("ROLLBACK TO SAVEPOINT market_data_time_zone_v1")
                .execute(&mut **transaction)
                .await
                .map_err(store_error)?;
            sqlx::query("RELEASE SAVEPOINT market_data_time_zone_v1")
                .execute(&mut **transaction)
                .await
                .map_err(store_error)?;
            Err(e)
        }
    }
}

async fn resolve_inner(
    transaction: &mut Transaction<'_, Postgres>,
    request: UntrustedTimeZoneRequestV1,
    proposals: Vec<TimeZoneFactProposalV1>,
    r0_cut_identity: BindingDigest,
    r0_cut_digest: BindingDigest,
) -> Result<TimeZoneReadbackV1, TimeZoneErrorV1> {
    let meaning = request_meaning_digest_v1(&request)?;
    advisory_lock(transaction, request.request_identity).await?;
    if let Some(readback) = load(transaction, request.request_identity).await? {
        if readback.cut().request_meaning_digest() != meaning {
            return Err(TimeZoneErrorV1::RequestConflict);
        }
        return Ok(readback);
    }
    let mut resolved = Vec::with_capacity(proposals.len());
    for proposal in proposals {
        let catalog_entry =
            resolve_reference_fact_catalog_entry_v1(transaction, proposal.catalog_locator)
                .await
                .map_err(|_| TimeZoneErrorV1::InvalidDependency)?
                .ok_or(TimeZoneErrorV1::UnknownIdentity)?;
        resolved.push(ResolvedTimeZoneFactProposalV1 {
            proposal,
            catalog_entry,
        });
    }
    let prepared = prepare_resolution_v1(request, resolved, r0_cut_identity, r0_cut_digest)?;
    sqlx::query("SELECT pg_advisory_xact_lock(6075990727067795457)")
        .execute(&mut **transaction)
        .await
        .map_err(store_error)?;
    let mut state: Option<(Vec<u8>, i64)> = sqlx::query_as("SELECT store_generation_identity,append_sequence FROM market_data_private.time_zone_state_v1 WHERE singleton FOR UPDATE")
        .fetch_optional(&mut **transaction).await.map_err(store_error)?;

    if state.is_none() {
        let seed: String = sqlx::query_scalar(
            "SELECT current_database() || ':' || pg_catalog.gen_random_uuid()::text",
        )
        .fetch_one(&mut **transaction)
        .await
        .map_err(store_error)?;
        let generation = codec::digest(
            b"vibe.market-data.time-zone-store-generation.v1\0",
            seed.as_bytes(),
        );
        sqlx::query("INSERT INTO market_data_private.time_zone_state_v1(singleton,store_generation_identity,append_sequence) VALUES(TRUE,$1,0)")
            .bind(generation.as_bytes().as_slice()).execute(&mut **transaction).await.map_err(store_error)?;
        state = Some((generation.as_bytes().to_vec(), 0));
    }
    let state = state.ok_or(TimeZoneErrorV1::StoreUntrusted)?;
    let generation = digest_from_row(state.0.clone())?;
    let sequence = u64::try_from(state.1)
        .map_err(|_| TimeZoneErrorV1::StoreUntrusted)?
        .checked_add(1)
        .ok_or(TimeZoneErrorV1::CapacityExceeded)?;
    let readback = seal_readback_v1(prepared, generation, sequence)?;
    for fact in readback.facts() {
        advisory_lock(transaction, fact.identity()).await?;
        let catalog_entry = load_catalog_for_fact(transaction, fact).await?;
        if let Some(existing) =
            load_native_time_zone_fact_v1(transaction, fact.identity(), true).await?
        {
            if existing.canonical_bytes() != fact.canonical_bytes() {
                return Err(TimeZoneErrorV1::StoreUntrusted);
            }
        } else {
            if let Some(predecessor) = fact.predecessor_identity() {
                let Some(prior_fact) =
                    load_native_time_zone_fact_v1(transaction, predecessor, false).await?
                else {
                    return Err(TimeZoneErrorV1::InvalidFact);
                };
                let prior_catalog = load_catalog_for_fact(transaction, &prior_fact).await?;
                if prior_fact.identity() != predecessor
                    || prior_fact.lineage_root() != fact.lineage_root()
                    || prior_fact.time_zone_identity() != fact.time_zone_identity()
                    || prior_fact.ruleset_identity() != fact.ruleset_identity()
                    || prior_fact.correction_sequence().checked_add(1)
                        != Some(fact.correction_sequence())
                    || catalog_entry.predecessor_identity() != Some(prior_catalog.identity())
                    || prior_fact.catalog_entry_identity() != prior_catalog.identity()
                {
                    return Err(TimeZoneErrorV1::InvalidFact);
                }
            }
            sqlx::query("INSERT INTO market_data_private.time_zone_facts_v1(fact_identity,time_zone_identity,ruleset_identity,catalog_entry_identity,lineage_root,correction_sequence,predecessor_identity,effective_from_ns,effective_until_ns,fact_bytes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)")
                .bind(fact.identity().as_bytes().as_slice()).bind(fact.time_zone_identity()).bind(fact.ruleset_identity().as_bytes().as_slice()).bind(fact.catalog_entry_identity().as_bytes().as_slice()).bind(fact.lineage_root().as_bytes().as_slice())
                .bind(i64::try_from(fact.correction_sequence()).map_err(|_| TimeZoneErrorV1::CapacityExceeded)?).bind(fact.predecessor_identity().map(|value| value.as_bytes().to_vec()))
                .bind(fact.effective_from_ns().to_string()).bind(fact.effective_until_ns().map(|value| value.to_string())).bind(fact.canonical_bytes())
                .execute(&mut **transaction).await.map_err(store_error)?;
        }
        let head: Option<Vec<u8>> = sqlx::query_scalar("SELECT fact_identity FROM market_data_private.time_zone_heads_v1 WHERE lineage_root=$1 FOR UPDATE")
            .bind(fact.lineage_root().as_bytes().as_slice()).fetch_optional(&mut **transaction).await.map_err(store_error)?;
        match head {
            None if fact.predecessor_identity().is_none() => {
                sqlx::query("INSERT INTO market_data_private.time_zone_heads_v1(lineage_root,fact_identity) VALUES($1,$2)").bind(fact.lineage_root().as_bytes().as_slice()).bind(fact.identity().as_bytes().as_slice()).execute(&mut **transaction).await.map_err(store_error)?;
            }
            Some(head) if head == fact.identity().as_bytes().as_slice() => {}
            Some(head)
                if fact
                    .predecessor_identity()
                    .is_some_and(|prior| prior.as_bytes().as_slice() == head) =>
            {
                sqlx::query("UPDATE market_data_private.time_zone_heads_v1 SET fact_identity=$2 WHERE lineage_root=$1").bind(fact.lineage_root().as_bytes().as_slice()).bind(fact.identity().as_bytes().as_slice()).execute(&mut **transaction).await.map_err(store_error)?;
            }
            _ => return Err(TimeZoneErrorV1::RequestConflict),
        }
    }
    sqlx::query("INSERT INTO market_data_private.time_zone_cuts_v1(cut_identity,request_identity,request_meaning_digest,cut_bytes) VALUES($1,$2,$3,$4)")
        .bind(readback.cut().identity().as_bytes().as_slice()).bind(readback.cut().request_identity().as_bytes().as_slice()).bind(readback.cut().request_meaning_digest().as_bytes().as_slice()).bind(readback.cut().canonical_bytes()).execute(&mut **transaction).await.map_err(store_error)?;
    for (index, fact) in readback.facts().iter().enumerate() {
        sqlx::query("INSERT INTO market_data_private.time_zone_cut_facts_v1(cut_identity,ordinal,fact_identity) VALUES($1,$2,$3)").bind(readback.cut().identity().as_bytes().as_slice()).bind(i64::try_from(index + 1).map_err(|_| TimeZoneErrorV1::CapacityExceeded)?).bind(fact.identity().as_bytes().as_slice()).execute(&mut **transaction).await.map_err(store_error)?;
    }
    sqlx::query("INSERT INTO market_data_private.time_zone_receipts_v1(request_identity,request_meaning_digest,cut_identity,receipt_identity,receipt_bytes,append_sequence) VALUES($1,$2,$3,$4,$5,$6)")
        .bind(readback.receipt().request_identity().as_bytes().as_slice()).bind(readback.receipt().request_meaning_digest().as_bytes().as_slice()).bind(readback.receipt().cut_identity().as_bytes().as_slice()).bind(readback.receipt().identity().as_bytes().as_slice()).bind(readback.receipt().canonical_bytes()).bind(i64::try_from(sequence).map_err(|_| TimeZoneErrorV1::CapacityExceeded)?).execute(&mut **transaction).await.map_err(store_error)?;
    sqlx::query("INSERT INTO market_data_private.time_zone_outbox_v1(outbox_identity,request_identity,receipt_bytes) VALUES($1,$2,$3)")
        .bind(readback.outbox_identity().as_bytes().as_slice()).bind(readback.receipt().request_identity().as_bytes().as_slice()).bind(readback.receipt().canonical_bytes()).execute(&mut **transaction).await.map_err(store_error)?;
    let update = sqlx::query("UPDATE market_data_private.time_zone_state_v1 SET append_sequence=$1 WHERE singleton AND store_generation_identity=$2 AND append_sequence=$3")
        .bind(i64::try_from(sequence).map_err(|_| TimeZoneErrorV1::CapacityExceeded)?).bind(generation.as_bytes().as_slice()).bind(state.1).execute(&mut **transaction).await.map_err(store_error)?;
    if update.rows_affected() != 1 {
        return Err(TimeZoneErrorV1::StoreUntrusted);
    }
    Ok(readback)
}

pub(super) async fn recover_time_zone_in_transaction_v1(
    transaction: &mut Transaction<'_, Postgres>,
    locator: UntrustedTimeZoneLocatorV1,
) -> Result<TimeZoneReadbackV1, TimeZoneErrorV1> {
    advisory_lock(transaction, locator.request_identity).await?;
    let readback = load(transaction, locator.request_identity)
        .await?
        .ok_or(TimeZoneErrorV1::UnknownIdentity)?;
    if readback.cut().request_meaning_digest() != locator.request_meaning_digest {
        return Err(TimeZoneErrorV1::RequestConflict);
    }
    Ok(readback)
}

async fn load(
    transaction: &mut Transaction<'_, Postgres>,
    request: BindingDigest,
) -> Result<Option<TimeZoneReadbackV1>, TimeZoneErrorV1> {
    let row = sqlx::query("SELECT c.cut_identity,c.request_meaning_digest AS cut_meaning,c.cut_bytes,r.request_meaning_digest AS receipt_meaning,r.cut_identity AS receipt_cut_identity,r.receipt_identity,r.receipt_bytes,r.append_sequence,o.outbox_identity,o.receipt_bytes AS outbox_payload FROM market_data_private.time_zone_cuts_v1 c JOIN market_data_private.time_zone_receipts_v1 r ON r.request_identity=c.request_identity JOIN market_data_private.time_zone_outbox_v1 o ON o.request_identity=c.request_identity WHERE c.request_identity=$1 FOR UPDATE OF c,r,o")
        .bind(request.as_bytes().as_slice()).fetch_optional(&mut **transaction).await.map_err(store_error)?;
    let Some(row) = row else {
        let partial: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM market_data_private.time_zone_cuts_v1 WHERE request_identity=$1) OR EXISTS(SELECT 1 FROM market_data_private.time_zone_receipts_v1 WHERE request_identity=$1) OR EXISTS(SELECT 1 FROM market_data_private.time_zone_outbox_v1 WHERE request_identity=$1)")
            .bind(request.as_bytes().as_slice()).fetch_one(&mut **transaction).await.map_err(store_error)?;
        return if partial {
            Err(TimeZoneErrorV1::StoreUntrusted)
        } else {
            Ok(None)
        };
    };
    let cut_identity: Vec<u8> = row.try_get("cut_identity").map_err(store_error)?;
    let cut_meaning: Vec<u8> = row.try_get("cut_meaning").map_err(store_error)?;
    let receipt_meaning: Vec<u8> = row.try_get("receipt_meaning").map_err(store_error)?;
    let receipt_cut_identity: Vec<u8> = row.try_get("receipt_cut_identity").map_err(store_error)?;
    let cut_bytes: Vec<u8> = row.try_get("cut_bytes").map_err(store_error)?;
    let receipt_identity: Vec<u8> = row.try_get("receipt_identity").map_err(store_error)?;
    let receipt_bytes: Vec<u8> = row.try_get("receipt_bytes").map_err(store_error)?;
    let append_sequence: i64 = row.try_get("append_sequence").map_err(store_error)?;
    let outbox_identity = digest_from_row(row.try_get("outbox_identity").map_err(store_error)?)?;
    let outbox_payload: Vec<u8> = row.try_get("outbox_payload").map_err(store_error)?;

    if cut_identity
        != codec::digest(codec::CUT_DOMAIN, &cut_bytes)
            .as_bytes()
            .as_slice()
        || receipt_identity
            != codec::digest(codec::RECEIPT_DOMAIN, &receipt_bytes)
                .as_bytes()
                .as_slice()
    {
        return Err(TimeZoneErrorV1::StoreUntrusted);
    }
    let fact_rows = sqlx::query("SELECT j.ordinal,j.fact_identity FROM market_data_private.time_zone_cut_facts_v1 j WHERE j.cut_identity=$1 ORDER BY j.ordinal FOR SHARE OF j")
        .bind(&cut_identity).fetch_all(&mut **transaction).await.map_err(store_error)?;
    let mut facts = Vec::with_capacity(fact_rows.len());
    for (index, row) in fact_rows.into_iter().enumerate() {
        let ordinal: i64 = row.try_get("ordinal").map_err(store_error)?;
        if usize::try_from(ordinal).ok() != Some(index + 1) {
            return Err(TimeZoneErrorV1::StoreUntrusted);
        }
        let identity = digest_from_row(row.try_get("fact_identity").map_err(store_error)?)?;
        let fact = load_native_time_zone_fact_v1(transaction, identity, false)
            .await?
            .ok_or(TimeZoneErrorV1::StoreUntrusted)?;
        facts.push(fact.canonical_bytes().to_vec());
    }
    let readback = rejoin_stored_v1(
        &facts,
        &cut_bytes,
        &receipt_bytes,
        outbox_identity,
        &outbox_payload,
    )?;
    let state: Option<(Vec<u8>, i64)> = sqlx::query_as("SELECT store_generation_identity,append_sequence FROM market_data_private.time_zone_state_v1 WHERE singleton FOR SHARE")
        .fetch_optional(&mut **transaction).await.map_err(store_error)?;
    let Some((generation, store_sequence)) = state else {
        return Err(TimeZoneErrorV1::StoreUntrusted);
    };

    if cut_meaning
        != readback
            .cut()
            .request_meaning_digest()
            .as_bytes()
            .as_slice()
        || receipt_meaning
            != readback
                .receipt()
                .request_meaning_digest()
                .as_bytes()
                .as_slice()
        || receipt_cut_identity != readback.receipt().cut_identity().as_bytes().as_slice()
        || append_sequence <= 0
        || u64::try_from(append_sequence).ok() != Some(readback.receipt().append_sequence())
        || generation
            != readback
                .receipt()
                .store_generation_identity()
                .as_bytes()
                .as_slice()
        || store_sequence < append_sequence
    {
        return Err(TimeZoneErrorV1::StoreUntrusted);
    }

    validate_ordered_cut_fact_sequence_v1(readback.facts())
        .map_err(|_| TimeZoneErrorV1::StoreUntrusted)?;
    let cut_last = readback
        .facts()
        .last()
        .ok_or(TimeZoneErrorV1::StoreUntrusted)?;
    let head_identity: BindingDigest = digest_from_row(
        sqlx::query_scalar("SELECT fact_identity FROM market_data_private.time_zone_heads_v1 WHERE lineage_root=$1 FOR SHARE")
            .bind(cut_last.lineage_root().as_bytes().as_slice())
            .fetch_optional(&mut **transaction).await.map_err(store_error)?
            .ok_or(TimeZoneErrorV1::StoreUntrusted)?,
    )?;
    let head = load_native_time_zone_fact_v1(transaction, head_identity, false)
        .await?
        .ok_or(TimeZoneErrorV1::StoreUntrusted)?;
    verify_native_time_zone_lineage_v1(transaction, &head, readback.facts()).await?;
    Ok(Some(readback))
}

async fn load_native_time_zone_fact_v1(
    transaction: &mut Transaction<'_, Postgres>,
    identity: BindingDigest,
    for_update: bool,
) -> Result<Option<crate::owner::time_zone::TimeZoneFactV1>, TimeZoneErrorV1> {
    let statement = if for_update {
        "SELECT fact_identity,time_zone_identity,ruleset_identity,catalog_entry_identity,lineage_root,correction_sequence,predecessor_identity,effective_from_ns,effective_until_ns,fact_bytes FROM market_data_private.time_zone_facts_v1 WHERE fact_identity=$1 FOR UPDATE"
    } else {
        "SELECT fact_identity,time_zone_identity,ruleset_identity,catalog_entry_identity,lineage_root,correction_sequence,predecessor_identity,effective_from_ns,effective_until_ns,fact_bytes FROM market_data_private.time_zone_facts_v1 WHERE fact_identity=$1 FOR SHARE"
    };
    let row = sqlx::query(statement)
        .bind(identity.as_bytes().as_slice())
        .fetch_optional(&mut **transaction)
        .await
        .map_err(store_error)?;
    let Some(row) = row else {
        return Ok(None);
    };
    let bytes: Vec<u8> = row.try_get("fact_bytes").map_err(store_error)?;
    let fact = decode_fact_v1(&bytes)?;
    let stored_sequence: i64 = row.try_get("correction_sequence").map_err(store_error)?;
    let stored_predecessor: Option<Vec<u8>> =
        row.try_get("predecessor_identity").map_err(store_error)?;
    let stored_effective_until: Option<String> =
        row.try_get("effective_until_ns").map_err(store_error)?;
    let canonical_predecessor = fact
        .predecessor_identity()
        .map(|value| value.as_bytes().to_vec());

    if row
        .try_get::<Vec<u8>, _>("fact_identity")
        .map_err(store_error)?
        != fact.identity().as_bytes().as_slice()
        || row
            .try_get::<Vec<u8>, _>("time_zone_identity")
            .map_err(store_error)?
            != fact.time_zone_identity()
        || row
            .try_get::<Vec<u8>, _>("ruleset_identity")
            .map_err(store_error)?
            != fact.ruleset_identity().as_bytes().as_slice()
        || row
            .try_get::<Vec<u8>, _>("catalog_entry_identity")
            .map_err(store_error)?
            != fact.catalog_entry_identity().as_bytes().as_slice()
        || row
            .try_get::<Vec<u8>, _>("lineage_root")
            .map_err(store_error)?
            != fact.lineage_root().as_bytes().as_slice()
        || u64::try_from(stored_sequence).ok() != Some(fact.correction_sequence())
        || stored_predecessor != canonical_predecessor
        || row
            .try_get::<String, _>("effective_from_ns")
            .map_err(store_error)?
            != fact.effective_from_ns().to_string()
        || stored_effective_until != fact.effective_until_ns().map(|value| value.to_string())
    {
        return Err(TimeZoneErrorV1::StoreUntrusted);
    }
    Ok(Some(fact))
}

async fn verify_native_time_zone_lineage_v1(
    transaction: &mut Transaction<'_, Postgres>,
    head: &crate::owner::time_zone::TimeZoneFactV1,
    cut_facts: &[crate::owner::time_zone::TimeZoneFactV1],
) -> Result<(), TimeZoneErrorV1> {
    let mut current = load_native_time_zone_fact_v1(transaction, head.identity(), false)
        .await?
        .ok_or(TimeZoneErrorV1::StoreUntrusted)?;
    if current.canonical_bytes() != head.canonical_bytes() {
        return Err(TimeZoneErrorV1::StoreUntrusted);
    }
    let head_catalog = load_catalog_for_fact(transaction, &current).await?;
    verify_reference_fact_catalog_head_v1(transaction, &head_catalog)
        .await
        .map_err(|_| TimeZoneErrorV1::StoreUntrusted)?;
    let mut seen = Vec::new();
    let mut backward_lineage = Vec::new();

    loop {
        if seen.contains(&current.identity()) {
            return Err(TimeZoneErrorV1::StoreUntrusted);
        }
        seen.push(current.identity());
        backward_lineage.push(current.identity());
        let current_catalog = load_catalog_for_fact(transaction, &current).await?;
        let Some(predecessor) = current.predecessor_identity() else {
            if current.correction_sequence() == 1
                && current_catalog.predecessor_identity().is_none()
            {
                break;
            }

            return Err(TimeZoneErrorV1::StoreUntrusted);
        };
        let prior = load_native_time_zone_fact_v1(transaction, predecessor, false)
            .await?
            .ok_or(TimeZoneErrorV1::StoreUntrusted)?;
        let prior_catalog = load_catalog_for_fact(transaction, &prior).await?;
        if prior.identity() != predecessor
            || prior.lineage_root() != current.lineage_root()
            || prior.time_zone_identity() != current.time_zone_identity()
            || prior.ruleset_identity() != current.ruleset_identity()
            || prior.correction_sequence().checked_add(1) != Some(current.correction_sequence())
            || current_catalog.predecessor_identity() != Some(prior_catalog.identity())
            || !time_zone_effective_interval_follows(&prior, &current)
        {
            return Err(TimeZoneErrorV1::StoreUntrusted);
        }
        current = prior;
    }

    let last_cut_identity = cut_facts
        .last()
        .ok_or(TimeZoneErrorV1::StoreUntrusted)?
        .identity();
    let position = backward_lineage
        .iter()
        .position(|identity| *identity == last_cut_identity)
        .ok_or(TimeZoneErrorV1::StoreUntrusted)?;
    let expected = cut_facts
        .iter()
        .rev()
        .map(crate::owner::time_zone::TimeZoneFactV1::identity);

    if backward_lineage[position..]
        .iter()
        .copied()
        .take(cut_facts.len())
        .ne(expected)
        || backward_lineage[..position]
            .iter()
            .any(|identity| cut_facts.iter().any(|fact| fact.identity() == *identity))
    {
        return Err(TimeZoneErrorV1::StoreUntrusted);
    }
    Ok(())
}

fn time_zone_effective_interval_follows(
    prior: &crate::owner::time_zone::TimeZoneFactV1,
    current: &crate::owner::time_zone::TimeZoneFactV1,
) -> bool {
    (prior.effective_from_ns() == current.effective_from_ns()
        && prior.effective_until_ns() == current.effective_until_ns())
        || prior.effective_until_ns() == Some(current.effective_from_ns())
}

async fn load_catalog_for_fact(
    transaction: &mut Transaction<'_, Postgres>,
    fact: &crate::owner::time_zone::TimeZoneFactV1,
) -> Result<ReferenceFactCatalogEntryV1, TimeZoneErrorV1> {
    let identity = fact.catalog_entry_identity();
    let entry = resolve_reference_fact_catalog_entry_v1(
        transaction,
        UntrustedReferenceFactCatalogLocatorV1::from_untrusted(identity, identity),
    )
    .await
    .map_err(|e| match e {
        crate::owner::reference_fact_catalog::ReferenceFactCatalogErrorV1::StoreUnavailable => {
            TimeZoneErrorV1::StoreUnavailable
        }
        _ => TimeZoneErrorV1::StoreUntrusted,
    })?
    .ok_or(TimeZoneErrorV1::StoreUntrusted)?;
    let source = entry.source();
    let evidence = fact.evidence();
    if entry.scope_identity() != fact.lineage_root()
        || entry.correction_sequence() != fact.correction_sequence()
        || entry.effective_from_ns() != fact.effective_from_ns()
        || entry.effective_until_ns() != fact.effective_until_ns()
        || source.source_binding_identity != evidence.source_binding_identity
        || source.source_binding_fact_digest != evidence.source_binding_fact_digest
        || source.source_binding_lineage_root != evidence.source_binding_lineage_root
        || source.source_binding_lineage_version != evidence.source_binding_lineage_version
        || source.source_frontier_digest != evidence.source_frontier_digest
        || source.correction_frontier_digest != evidence.correction_frontier_digest
        || !matches!(
            entry.value(),
            ReferenceFactCatalogValueV1::TimeZone {
                time_zone_identity,
                ruleset_identity,
                utc_offset_seconds,
            } if time_zone_identity.as_ref() == fact.time_zone_identity()
                && *ruleset_identity == fact.ruleset_identity()
                && *utc_offset_seconds == fact.utc_offset_seconds()
        )
    {
        return Err(TimeZoneErrorV1::StoreUntrusted);
    }
    Ok(entry)
}

fn digest_from_row(bytes: Vec<u8>) -> Result<BindingDigest, TimeZoneErrorV1> {
    Ok(BindingDigest::from_untrusted_bytes(
        bytes
            .try_into()
            .map_err(|_| TimeZoneErrorV1::StoreUntrusted)?,
    ))
}
async fn advisory_lock(
    transaction: &mut Transaction<'_, Postgres>,
    identity: BindingDigest,
) -> Result<(), TimeZoneErrorV1> {
    let key = i64::from_be_bytes(
        identity.as_bytes()[..8]
            .try_into()
            .map_err(|_| TimeZoneErrorV1::StoreUntrusted)?,
    );
    sqlx::query("SELECT pg_advisory_xact_lock($1)")
        .bind(key)
        .execute(&mut **transaction)
        .await
        .map_err(store_error)?;
    Ok(())
}
fn store_error<E>(_error: E) -> TimeZoneErrorV1 {
    TimeZoneErrorV1::StoreUnavailable
}

#[cfg(test)]
mod tests {
    use super::*;
    use rstest::rstest;
    #[rstest]
    fn schema_is_private_complete_and_unregistered() {
        let schema = TIME_ZONE_SCHEMA_V1.join("\n");
        assert!(schema.contains("bootstrap schema ownership is unavailable"));
        assert!(!schema.contains("CREATE SCHEMA"));

        for relation in TIME_ZONE_RELATIONS_V1 {
            assert!(schema.contains(relation));
        }
        assert_eq!(schema.matches("REVOKE ALL ON TABLE").count(), 7);
        assert!(schema.contains("REVOKE ALL ON SCHEMA market_data_private FROM PUBLIC"));
        assert!(!include_str!("../postgres.rs").contains("install_time_zone_schema_v1("));
        let implementation = include_str!("time_zone.rs");
        assert!(implementation.contains("SAVEPOINT market_data_time_zone_v1"));
        assert!(implementation.contains("ROLLBACK TO SAVEPOINT market_data_time_zone_v1"));
        assert!(implementation.contains("pg_catalog.gen_random_uuid()"));
        assert!(TIME_ZONE_CUSTODY_QUERY_V1.contains("pg_catalog.aclexplode"));
        assert!(TIME_ZONE_CUSTODY_QUERY_V1.contains("attribute.attacl"));
        assert!(TIME_ZONE_CUSTODY_QUERY_V1.contains("count(*)=31"));
        assert!(TIME_ZONE_CUSTODY_QUERY_V1.contains("count(*)=21"));
        assert!(TIME_ZONE_CUSTODY_QUERY_V1.contains("count(*)=22"));
        assert!(TIME_ZONE_CUSTODY_QUERY_V1.contains("attribute.attisdropped"));
        assert!(
            TIME_ZONE_CUSTODY_QUERY_V1
                .contains("attribute.attcollation=attribute_type.typcollation")
        );
        assert!(TIME_ZONE_CUSTODY_QUERY_V1.contains("pg_catalog.pg_inherits"));
        assert!(TIME_ZONE_CUSTODY_QUERY_V1.contains("constraint_fact.connoinherit"));
        assert!(TIME_ZONE_CUSTODY_QUERY_V1.contains("foreign_relation.relnamespace"));
        assert!(TIME_ZONE_CUSTODY_QUERY_V1.contains("constraint_fact.confmatchtype='s'"));
        assert!(TIME_ZONE_CUSTODY_QUERY_V1.contains("trigger_entry.tgisinternal"));
        assert!(TIME_ZONE_CUSTODY_QUERY_V1.contains("pg_catalog.pg_policy"));
    }
}
