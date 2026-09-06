//! Caller-transaction-only PostgreSQL custody for native Time Zone V1.

#![allow(
    dead_code,
    reason = "C2 is intentionally not installed by global migration"
)]

use sqlx::{Postgres, Row, Transaction};

use super::reference_fact_catalog::resolve_reference_fact_catalog_entry_v1;
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
            seal_readback_v1,
        },
        codec,
    },
};

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
        let existing: Option<(Vec<u8>, Vec<u8>)> = sqlx::query_as("SELECT catalog_entry_identity,fact_bytes FROM market_data_private.time_zone_facts_v1 WHERE fact_identity=$1 FOR UPDATE")
            .bind(fact.identity().as_bytes().as_slice()).fetch_optional(&mut **transaction).await.map_err(store_error)?;
        if let Some((catalog_entry_identity, bytes)) = existing {
            if catalog_entry_identity != fact.catalog_entry_identity().as_bytes().as_slice()
                || bytes != fact.canonical_bytes()
            {
                return Err(TimeZoneErrorV1::StoreUntrusted);
            }
        } else {
            if let Some(predecessor) = fact.predecessor_identity() {
                let prior: Option<(Vec<u8>, Vec<u8>, Vec<u8>)> = sqlx::query_as("SELECT lineage_root,fact_identity,fact_bytes FROM market_data_private.time_zone_facts_v1 WHERE fact_identity=$1 FOR SHARE")
                    .bind(predecessor.as_bytes().as_slice()).fetch_optional(&mut **transaction).await.map_err(store_error)?;
                let Some((lineage, identity, bytes)) = prior else {
                    return Err(TimeZoneErrorV1::InvalidFact);
                };
                let prior_fact = decode_fact_v1(&bytes)?;
                let prior_catalog = load_catalog_for_fact(transaction, &prior_fact).await?;
                if prior_fact.identity() != predecessor
                    || lineage != fact.lineage_root().as_bytes().as_slice()
                    || identity != predecessor.as_bytes().as_slice()
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
    let fact_rows = sqlx::query("SELECT f.catalog_entry_identity,f.fact_bytes FROM market_data_private.time_zone_cut_facts_v1 j JOIN market_data_private.time_zone_facts_v1 f ON f.fact_identity=j.fact_identity WHERE j.cut_identity=$1 ORDER BY j.ordinal FOR SHARE OF j,f")
        .bind(&cut_identity).fetch_all(&mut **transaction).await.map_err(store_error)?;
    let mut facts = Vec::with_capacity(fact_rows.len());
    for row in fact_rows {
        let catalog_entry_identity: Vec<u8> =
            row.try_get("catalog_entry_identity").map_err(store_error)?;
        let bytes: Vec<u8> = row.try_get("fact_bytes").map_err(store_error)?;
        let fact = decode_fact_v1(&bytes)?;
        if catalog_entry_identity != fact.catalog_entry_identity().as_bytes().as_slice() {
            return Err(TimeZoneErrorV1::StoreUntrusted);
        }
        facts.push(bytes);
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

    for fact in readback.facts() {
        load_catalog_for_fact(transaction, fact).await?;
        let head: Option<Vec<u8>> = sqlx::query_scalar("SELECT fact_identity FROM market_data_private.time_zone_heads_v1 WHERE lineage_root=$1 FOR SHARE")
            .bind(fact.lineage_root().as_bytes().as_slice()).fetch_optional(&mut **transaction).await.map_err(store_error)?;
        if head.as_deref() != Some(fact.identity().as_bytes().as_slice()) {
            return Err(TimeZoneErrorV1::StoreUntrusted);
        }
    }
    Ok(Some(readback))
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

        for relation in [
            "time_zone_state_v1",
            "time_zone_facts_v1",
            "time_zone_heads_v1",
            "time_zone_cuts_v1",
            "time_zone_cut_facts_v1",
            "time_zone_receipts_v1",
            "time_zone_outbox_v1",
        ] {
            assert!(schema.contains(relation));
        }
        assert_eq!(schema.matches("REVOKE ALL ON TABLE").count(), 7);
        assert!(schema.contains("REVOKE ALL ON SCHEMA market_data_private FROM PUBLIC"));
        assert!(!include_str!("../postgres.rs").contains("install_time_zone_schema_v1("));
        let implementation = include_str!("time_zone.rs");
        assert!(implementation.contains("SAVEPOINT market_data_time_zone_v1"));
        assert!(implementation.contains("ROLLBACK TO SAVEPOINT market_data_time_zone_v1"));
        assert!(implementation.contains("pg_catalog.gen_random_uuid()"));
    }
}
