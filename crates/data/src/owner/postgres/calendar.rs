//! Caller-transaction custody for Calendar V1.
//!
//! This module owns no pool and never begins, commits or rolls back a transaction. Its schema is
//! deliberately not included in the global Market Data migration until a later composition slice.

#![allow(
    dead_code,
    reason = "Calendar product composition is intentionally not registered"
)]

use sqlx::{Postgres, Row, Transaction};

use crate::owner::{
    calendar::{
        CalendarErrorV1, CalendarIdentityV1, CalendarReadbackV1, UntrustedCalendarLocatorV1,
        authority::{
            CalendarAuthenticatedInputsV1, CalendarFactProposalV1, PreparedCalendarCutV1,
            build_readback, decode_fact, decode_readback, prepare_calendar_cut_v1,
            verify_calendar_readback_v1,
        },
        codec,
    },
    reference_fact_catalog::{ReferenceFactCatalogValueV1, UntrustedReferenceFactCatalogLocatorV1},
    source_binding::BindingDigest,
};

pub(super) const CALENDAR_SCHEMA_V1: &[&str] = &[
    super::OWNER_SCHEMA_GUARD_V1,
    "REVOKE ALL ON SCHEMA market_data_private FROM PUBLIC",
    "CREATE TABLE IF NOT EXISTS market_data_private.calendar_state_v1 (singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK(singleton),store_generation_identity BYTEA NOT NULL CHECK(octet_length(store_generation_identity)=32),append_sequence BIGINT NOT NULL CHECK(append_sequence>=0))",
    "CREATE TABLE IF NOT EXISTS market_data_private.calendar_facts_v1 (fact_identity BYTEA PRIMARY KEY CHECK(octet_length(fact_identity)=32),calendar_identity BYTEA NOT NULL CHECK(octet_length(calendar_identity)>0),civil_day INTEGER NOT NULL,lineage_root BYTEA NOT NULL CHECK(octet_length(lineage_root)=32),correction_sequence BIGINT NOT NULL CHECK(correction_sequence>0),predecessor_identity BYTEA NULL REFERENCES market_data_private.calendar_facts_v1(fact_identity),fact_bytes BYTEA NOT NULL CHECK(octet_length(fact_bytes)>0),UNIQUE(lineage_root,correction_sequence),UNIQUE(calendar_identity,civil_day,correction_sequence))",
    "CREATE TABLE IF NOT EXISTS market_data_private.calendar_heads_v1 (calendar_identity BYTEA NOT NULL,civil_day INTEGER NOT NULL,lineage_root BYTEA NOT NULL CHECK(octet_length(lineage_root)=32),head_identity BYTEA NOT NULL UNIQUE REFERENCES market_data_private.calendar_facts_v1(fact_identity),correction_sequence BIGINT NOT NULL CHECK(correction_sequence>0),PRIMARY KEY(calendar_identity,civil_day))",
    "CREATE TABLE IF NOT EXISTS market_data_private.calendar_cuts_v1 (request_identity BYTEA PRIMARY KEY CHECK(octet_length(request_identity)=32),request_meaning_digest BYTEA NOT NULL CHECK(octet_length(request_meaning_digest)=32),cut_identity BYTEA NOT NULL UNIQUE CHECK(octet_length(cut_identity)=32),cut_bytes BYTEA NOT NULL CHECK(octet_length(cut_bytes)>0),readback_identity BYTEA NOT NULL UNIQUE CHECK(octet_length(readback_identity)=32),readback_bytes BYTEA NOT NULL CHECK(octet_length(readback_bytes)>0))",
    "CREATE TABLE IF NOT EXISTS market_data_private.calendar_cut_days_v1 (request_identity BYTEA NOT NULL REFERENCES market_data_private.calendar_cuts_v1(request_identity),civil_day INTEGER NOT NULL,fact_identity BYTEA NOT NULL REFERENCES market_data_private.calendar_facts_v1(fact_identity),fact_digest BYTEA NOT NULL CHECK(octet_length(fact_digest)=32),PRIMARY KEY(request_identity,civil_day))",
    "CREATE TABLE IF NOT EXISTS market_data_private.calendar_receipts_v1 (request_identity BYTEA PRIMARY KEY REFERENCES market_data_private.calendar_cuts_v1(request_identity),receipt_identity BYTEA NOT NULL UNIQUE CHECK(octet_length(receipt_identity)=32),receipt_bytes BYTEA NOT NULL CHECK(octet_length(receipt_bytes)>0),append_sequence BIGINT NOT NULL UNIQUE CHECK(append_sequence>0))",
    "CREATE TABLE IF NOT EXISTS market_data_private.calendar_outbox_v1 (request_identity BYTEA PRIMARY KEY REFERENCES market_data_private.calendar_cuts_v1(request_identity),outbox_identity BYTEA NOT NULL UNIQUE CHECK(octet_length(outbox_identity)=32),receipt_bytes BYTEA NOT NULL CHECK(octet_length(receipt_bytes)>0))",
    "CREATE OR REPLACE FUNCTION market_data_private.resolve_calendar_v1(p_request_identity BYTEA) RETURNS TABLE(request_meaning_digest BYTEA,cut_identity BYTEA,cut_bytes BYTEA,readback_identity BYTEA,readback_bytes BYTEA,receipt_identity BYTEA,receipt_bytes BYTEA,outbox_identity BYTEA,outbox_receipt_bytes BYTEA,store_generation_identity BYTEA,append_sequence BIGINT) LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=pg_catalog AS $function$ SELECT c.request_meaning_digest,c.cut_identity,c.cut_bytes,c.readback_identity,c.readback_bytes,r.receipt_identity,r.receipt_bytes,o.outbox_identity,o.receipt_bytes,s.store_generation_identity,r.append_sequence FROM market_data_private.calendar_cuts_v1 c JOIN market_data_private.calendar_receipts_v1 r USING(request_identity) JOIN market_data_private.calendar_outbox_v1 o USING(request_identity) CROSS JOIN market_data_private.calendar_state_v1 s WHERE s.singleton AND c.request_identity=p_request_identity $function$",
    "REVOKE ALL ON FUNCTION market_data_private.resolve_calendar_v1(BYTEA) FROM PUBLIC",
    "REVOKE ALL ON TABLE market_data_private.calendar_state_v1,market_data_private.calendar_facts_v1,market_data_private.calendar_heads_v1,market_data_private.calendar_cuts_v1,market_data_private.calendar_cut_days_v1,market_data_private.calendar_receipts_v1,market_data_private.calendar_outbox_v1 FROM PUBLIC",
];

pub(super) async fn install_calendar_schema_v1(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<(), CalendarErrorV1> {
    for statement in CALENDAR_SCHEMA_V1 {
        sqlx::query(*statement)
            .execute(&mut **transaction)
            .await
            .map_err(store_error)?;
    }
    Ok(())
}

pub(super) async fn register_calendar_v1(
    transaction: &mut Transaction<'_, Postgres>,
    prepared: PreparedCalendarCutV1,
) -> Result<CalendarReadbackV1, CalendarErrorV1> {
    let request_identity = prepared.cut.request_identity;
    let request_meaning_digest = prepared.cut.request_meaning_digest;
    for fact in &prepared.facts {
        let catalog = load_catalog_for_fact(transaction, fact).await?;
        if catalog.identity() != fact.catalog_entry_identity()
            || catalog.scope_identity() != fact.lineage_root()
            || catalog.correction_sequence() != fact.correction_sequence()
        {
            return Err(CalendarErrorV1::DependencyMismatch);
        }
    }
    advisory_lock(transaction, request_identity).await?;
    if let Some(stored) = load_calendar_v1(transaction, request_identity, true).await? {
        if stored.cut().request_meaning_digest != request_meaning_digest
            || stored.cut().identity() != prepared.cut.identity()
            || stored.facts().len() != prepared.facts.len()
            || stored
                .facts()
                .iter()
                .zip(prepared.facts.iter())
                .any(|(left, right)| {
                    left.identity() != right.identity()
                        || left.canonical_bytes() != right.canonical_bytes()
                })
        {
            return Err(CalendarErrorV1::ReplayConflict);
        }
        return Ok(stored);
    }

    validate_fact_heads_and_rows(transaction, &prepared).await?;
    let (generation, prior_sequence) = state_for_update(transaction).await?;
    let append_sequence = prior_sequence
        .checked_add(1)
        .ok_or(CalendarErrorV1::SequenceOverflow)?;
    let readback = build_readback(prepared, generation, append_sequence)?;
    persist_facts_and_heads(transaction, &readback).await?;
    persist_aggregate(transaction, &readback).await?;
    let updated: Option<i64> = sqlx::query_scalar(
        "UPDATE market_data_private.calendar_state_v1 SET append_sequence=$1 WHERE singleton AND store_generation_identity=$2 AND append_sequence=$3 RETURNING append_sequence",
    )
    .bind(to_i64(append_sequence)?)
    .bind(generation.as_bytes().as_slice())
    .bind(to_i64(prior_sequence)?)
    .fetch_optional(&mut **transaction)
    .await
    .map_err(store_error)?;

    if updated != Some(to_i64(append_sequence)?) {
        return Err(CalendarErrorV1::StoreUntrusted);
    }
    verify_calendar_readback_v1(&readback)?;
    Ok(readback)
}

pub(super) async fn resolve_calendar_in_transaction_v1(
    transaction: &mut Transaction<'_, Postgres>,
    request: &crate::owner::calendar::UntrustedCalendarRequestV1,
    proposals: Vec<CalendarFactProposalV1>,
    authenticated: CalendarAuthenticatedInputsV1<'_>,
) -> Result<CalendarReadbackV1, CalendarErrorV1> {
    sqlx::query("SAVEPOINT market_data_calendar_catalog_v1")
        .execute(&mut **transaction)
        .await
        .map_err(store_error)?;
    let result = resolve_calendar_inner(transaction, request, proposals, authenticated).await;
    match result {
        Ok(readback) => {
            sqlx::query("RELEASE SAVEPOINT market_data_calendar_catalog_v1")
                .execute(&mut **transaction)
                .await
                .map_err(store_error)?;
            Ok(readback)
        }
        Err(error) => {
            sqlx::query("ROLLBACK TO SAVEPOINT market_data_calendar_catalog_v1")
                .execute(&mut **transaction)
                .await
                .map_err(store_error)?;
            sqlx::query("RELEASE SAVEPOINT market_data_calendar_catalog_v1")
                .execute(&mut **transaction)
                .await
                .map_err(store_error)?;
            Err(error)
        }
    }
}

async fn resolve_calendar_inner(
    transaction: &mut Transaction<'_, Postgres>,
    request: &crate::owner::calendar::UntrustedCalendarRequestV1,
    proposals: Vec<CalendarFactProposalV1>,
    authenticated: CalendarAuthenticatedInputsV1<'_>,
) -> Result<CalendarReadbackV1, CalendarErrorV1> {
    let mut catalog_entries = Vec::with_capacity(proposals.len());
    for proposal in &proposals {
        let entry = super::reference_fact_catalog::resolve_reference_fact_catalog_entry_v1(
            transaction,
            proposal.catalog_locator,
        )
        .await
        .map_err(map_catalog_error)?
        .ok_or(CalendarErrorV1::DependencyMismatch)?;
        catalog_entries.push(entry);
    }
    let prepared = prepare_calendar_cut_v1(request, proposals, catalog_entries, authenticated)?;
    register_calendar_v1(transaction, prepared).await
}

pub(super) async fn recover_calendar_v1(
    transaction: &mut Transaction<'_, Postgres>,
    locator: UntrustedCalendarLocatorV1,
) -> Result<CalendarReadbackV1, CalendarErrorV1> {
    let readback = load_calendar_v1(transaction, locator.request_identity(), false)
        .await?
        .ok_or(CalendarErrorV1::UnknownIdentity)?;
    if readback.cut().request_meaning_digest != locator.request_meaning_digest() {
        return Err(CalendarErrorV1::ReplayConflict);
    }
    Ok(readback)
}

async fn validate_fact_heads_and_rows(
    transaction: &mut Transaction<'_, Postgres>,
    prepared: &PreparedCalendarCutV1,
) -> Result<(), CalendarErrorV1> {
    for fact in &prepared.facts {
        let stored = sqlx::query("SELECT fact_bytes FROM market_data_private.calendar_facts_v1 WHERE fact_identity=$1 FOR UPDATE")
            .bind(fact.identity().as_bytes().as_slice()).fetch_optional(&mut **transaction).await.map_err(store_error)?;
        if let Some(row) = stored {
            let bytes: Vec<u8> = row.try_get("fact_bytes").map_err(store_error)?;
            if bytes != fact.canonical_bytes() {
                return Err(CalendarErrorV1::StoreUntrusted);
            }
            validate_stored_lineage(transaction, fact, prepared.cut.owner_observation_ns).await?;
            continue;
        }
        let head = sqlx::query("SELECT lineage_root,head_identity,correction_sequence FROM market_data_private.calendar_heads_v1 WHERE calendar_identity=$1 AND civil_day=$2 FOR UPDATE")
            .bind(fact.calendar_identity()).bind(fact.day()).fetch_optional(&mut **transaction).await.map_err(store_error)?;

        match (
            head,
            fact.predecessor_identity(),
            fact.correction_sequence(),
        ) {
            (None, None, 1) => {}
            (Some(row), Some(predecessor), sequence) => {
                let lineage = row_digest(&row, "lineage_root")?;
                let head_identity = row_digest(&row, "head_identity")?;
                let head_sequence: i64 = row.try_get("correction_sequence").map_err(store_error)?;

                if lineage != fact.lineage_root()
                    || head_identity != predecessor
                    || u64::try_from(head_sequence)
                        .ok()
                        .and_then(|value| value.checked_add(1))
                        != Some(sequence)
                {
                    return Err(CalendarErrorV1::CorrectionHeadMismatch);
                }
                let predecessor_row = sqlx::query("SELECT calendar_identity,civil_day,lineage_root,correction_sequence,fact_bytes FROM market_data_private.calendar_facts_v1 WHERE fact_identity=$1 FOR UPDATE")
                    .bind(predecessor.as_bytes().as_slice()).fetch_optional(&mut **transaction).await.map_err(store_error)?
                    .ok_or(CalendarErrorV1::InvalidPredecessor)?;
                let predecessor_calendar: Vec<u8> = predecessor_row
                    .try_get("calendar_identity")
                    .map_err(store_error)?;
                let predecessor_day: i32 =
                    predecessor_row.try_get("civil_day").map_err(store_error)?;

                if predecessor_calendar != fact.calendar_identity()
                    || predecessor_day != fact.day()
                    || row_digest(&predecessor_row, "lineage_root")? != fact.lineage_root()
                {
                    return Err(CalendarErrorV1::InvalidPredecessor);
                }
                let prior_bytes: Vec<u8> =
                    predecessor_row.try_get("fact_bytes").map_err(store_error)?;
                let prior_fact = decode_fact(&prior_bytes, predecessor)?;
                let catalog = load_catalog_for_fact(transaction, fact).await?;
                let prior_catalog = load_catalog_for_fact(transaction, &prior_fact).await?;
                if catalog.predecessor_identity() != Some(prior_fact.catalog_entry_identity())
                    || prior_catalog.identity() != prior_fact.catalog_entry_identity()
                    || catalog.scope_identity() != prior_catalog.scope_identity()
                    || catalog.source().source_binding_lineage_root
                        != prior_catalog.source().source_binding_lineage_root
                    || prior_catalog
                        .source()
                        .source_binding_lineage_version
                        .checked_add(1)
                        != Some(catalog.source().source_binding_lineage_version)
                {
                    return Err(CalendarErrorV1::InvalidPredecessor);
                }
            }
            _ => return Err(CalendarErrorV1::CorrectionHeadMismatch),
        }
    }
    Ok(())
}

async fn validate_stored_lineage(
    transaction: &mut Transaction<'_, Postgres>,
    selected: &crate::owner::calendar::CalendarFactV1,
    owner_observation_ns: i128,
) -> Result<(), CalendarErrorV1> {
    let _ = owner_observation_ns;
    let head = sqlx::query("SELECT head_identity,correction_sequence FROM market_data_private.calendar_heads_v1 WHERE calendar_identity=$1 AND civil_day=$2")
        .bind(selected.calendar_identity()).bind(selected.day()).fetch_optional(&mut **transaction).await.map_err(store_error)?
        .ok_or(CalendarErrorV1::StoreUntrusted)?;
    let head_sequence: i64 = head.try_get("correction_sequence").map_err(store_error)?;
    if row_digest(&head, "head_identity")? != selected.identity()
        || u64::try_from(head_sequence).ok() != Some(selected.correction_sequence())
    {
        return Err(CalendarErrorV1::StoreUntrusted);
    }
    Ok(())
}

async fn load_catalog_for_fact(
    transaction: &mut Transaction<'_, Postgres>,
    fact: &crate::owner::calendar::CalendarFactV1,
) -> Result<crate::owner::reference_fact_catalog::ReferenceFactCatalogEntryV1, CalendarErrorV1> {
    let identity = fact.catalog_entry_identity();
    let entry = super::reference_fact_catalog::resolve_reference_fact_catalog_entry_v1(
        transaction,
        UntrustedReferenceFactCatalogLocatorV1::from_untrusted(identity, identity),
    )
    .await
    .map_err(map_catalog_error)?
    .ok_or(CalendarErrorV1::StoreUntrusted)?;
    let source = entry.source();
    if entry.scope_identity() != fact.lineage_root
        || entry.correction_sequence() != fact.correction_sequence
        || entry.effective_from_ns() != fact.effective_from_ns
        || entry.effective_until_ns() != fact.effective_until_ns
        || source.source_binding_identity != fact.source_binding_identity
        || source.source_binding_fact_digest != fact.source_binding_fact_digest
        || source.source_binding_lineage_root != fact.source_binding_lineage_root
        || source.source_binding_lineage_version != fact.source_binding_lineage_version
        || source.source_frontier_digest != fact.source_frontier_digest
        || source.correction_frontier_digest != fact.correction_frontier_digest
        || !matches!(
            entry.value(),
            ReferenceFactCatalogValueV1::Calendar {
                calendar_identity,
                day,
                is_open,
            } if calendar_identity.as_ref() == fact.calendar_identity()
                && *day == fact.day()
                && *is_open == fact.is_open()
        )
    {
        return Err(CalendarErrorV1::StoreUntrusted);
    }
    Ok(entry)
}

fn map_catalog_error(
    error: crate::owner::reference_fact_catalog::ReferenceFactCatalogErrorV1,
) -> CalendarErrorV1 {
    match error {
        crate::owner::reference_fact_catalog::ReferenceFactCatalogErrorV1::StoreUnavailable => {
            CalendarErrorV1::StoreUnavailable
        }
        crate::owner::reference_fact_catalog::ReferenceFactCatalogErrorV1::StoreUntrusted => {
            CalendarErrorV1::StoreUntrusted
        }
        _ => CalendarErrorV1::DependencyMismatch,
    }
}

async fn persist_facts_and_heads(
    transaction: &mut Transaction<'_, Postgres>,
    readback: &CalendarReadbackV1,
) -> Result<(), CalendarErrorV1> {
    for fact in readback.facts() {
        let inserted = sqlx::query("INSERT INTO market_data_private.calendar_facts_v1(fact_identity,calendar_identity,civil_day,lineage_root,correction_sequence,predecessor_identity,fact_bytes) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(fact_identity) DO NOTHING")
            .bind(fact.identity().as_bytes().as_slice()).bind(fact.calendar_identity()).bind(fact.day())
            .bind(fact.lineage_root().as_bytes().as_slice()).bind(to_i64(fact.correction_sequence())?)
            .bind(fact.predecessor_identity().map(|value| value.as_bytes().to_vec())).bind(fact.canonical_bytes())
            .execute(&mut **transaction).await.map_err(store_error)?;

        if inserted.rows_affected() == 0 {
            continue;
        }
        sqlx::query("INSERT INTO market_data_private.calendar_heads_v1(calendar_identity,civil_day,lineage_root,head_identity,correction_sequence) VALUES($1,$2,$3,$4,$5) ON CONFLICT(calendar_identity,civil_day) DO UPDATE SET lineage_root=EXCLUDED.lineage_root,head_identity=EXCLUDED.head_identity,correction_sequence=EXCLUDED.correction_sequence")
            .bind(fact.calendar_identity()).bind(fact.day()).bind(fact.lineage_root().as_bytes().as_slice())
            .bind(fact.identity().as_bytes().as_slice()).bind(to_i64(fact.correction_sequence())?)
            .execute(&mut **transaction).await.map_err(store_error)?;
    }
    Ok(())
}

async fn persist_aggregate(
    transaction: &mut Transaction<'_, Postgres>,
    readback: &CalendarReadbackV1,
) -> Result<(), CalendarErrorV1> {
    sqlx::query("INSERT INTO market_data_private.calendar_cuts_v1(request_identity,request_meaning_digest,cut_identity,cut_bytes,readback_identity,readback_bytes) VALUES($1,$2,$3,$4,$5,$6)")
        .bind(readback.cut.request_identity.as_bytes().as_slice()).bind(readback.cut.request_meaning_digest.as_bytes().as_slice())
        .bind(readback.cut.identity().as_bytes().as_slice()).bind(readback.cut.canonical_bytes())
        .bind(readback.identity().as_bytes().as_slice()).bind(readback.canonical_bytes())
        .execute(&mut **transaction).await.map_err(store_error)?;

    for (day, identity, digest) in &readback.cut.days {
        sqlx::query("INSERT INTO market_data_private.calendar_cut_days_v1(request_identity,civil_day,fact_identity,fact_digest) VALUES($1,$2,$3,$4)")
            .bind(readback.cut.request_identity.as_bytes().as_slice()).bind(*day).bind(identity.as_bytes().as_slice()).bind(digest.as_bytes().as_slice())
            .execute(&mut **transaction).await.map_err(store_error)?;
    }
    sqlx::query("INSERT INTO market_data_private.calendar_receipts_v1(request_identity,receipt_identity,receipt_bytes,append_sequence) VALUES($1,$2,$3,$4)")
        .bind(readback.cut.request_identity.as_bytes().as_slice()).bind(readback.receipt_identity().as_bytes().as_slice())
        .bind(readback.receipt.canonical_bytes.as_ref()).bind(to_i64(readback.receipt.append_sequence)?)
        .execute(&mut **transaction).await.map_err(store_error)?;
    sqlx::query("INSERT INTO market_data_private.calendar_outbox_v1(request_identity,outbox_identity,receipt_bytes) VALUES($1,$2,$3)")
        .bind(readback.cut.request_identity.as_bytes().as_slice()).bind(readback.outbox_identity().as_bytes().as_slice())
        .bind(readback.receipt.canonical_bytes.as_ref()).execute(&mut **transaction).await.map_err(store_error)?;
    Ok(())
}

async fn load_calendar_v1(
    transaction: &mut Transaction<'_, Postgres>,
    request_identity: CalendarIdentityV1,
    lock: bool,
) -> Result<Option<CalendarReadbackV1>, CalendarErrorV1> {
    let sql = if lock {
        "SELECT c.request_meaning_digest,c.cut_identity,c.cut_bytes,c.readback_identity,c.readback_bytes,r.receipt_identity,r.receipt_bytes,o.outbox_identity,o.receipt_bytes AS outbox_receipt_bytes,s.store_generation_identity,r.append_sequence FROM market_data_private.calendar_cuts_v1 c JOIN market_data_private.calendar_receipts_v1 r USING(request_identity) JOIN market_data_private.calendar_outbox_v1 o USING(request_identity) CROSS JOIN market_data_private.calendar_state_v1 s WHERE s.singleton AND c.request_identity=$1 FOR UPDATE OF c,r,o,s"
    } else {
        "SELECT c.request_meaning_digest,c.cut_identity,c.cut_bytes,c.readback_identity,c.readback_bytes,r.receipt_identity,r.receipt_bytes,o.outbox_identity,o.receipt_bytes AS outbox_receipt_bytes,s.store_generation_identity,r.append_sequence FROM market_data_private.calendar_cuts_v1 c JOIN market_data_private.calendar_receipts_v1 r USING(request_identity) JOIN market_data_private.calendar_outbox_v1 o USING(request_identity) CROSS JOIN market_data_private.calendar_state_v1 s WHERE s.singleton AND c.request_identity=$1"
    };
    let row = sqlx::query(sql)
        .bind(request_identity.as_bytes().as_slice())
        .fetch_optional(&mut **transaction)
        .await
        .map_err(store_error)?;
    let Some(row) = row else {
        let partial: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM market_data_private.calendar_cuts_v1 WHERE request_identity=$1) OR EXISTS(SELECT 1 FROM market_data_private.calendar_receipts_v1 WHERE request_identity=$1) OR EXISTS(SELECT 1 FROM market_data_private.calendar_outbox_v1 WHERE request_identity=$1)")
            .bind(request_identity.as_bytes().as_slice()).fetch_one(&mut **transaction).await.map_err(store_error)?;
        return if partial {
            Err(CalendarErrorV1::StoreUntrusted)
        } else {
            Ok(None)
        };
    };
    let readback_bytes: Vec<u8> = row.try_get("readback_bytes").map_err(store_error)?;
    let readback = decode_readback(&readback_bytes)?;
    let receipt_bytes: Vec<u8> = row.try_get("receipt_bytes").map_err(store_error)?;
    let outbox_bytes: Vec<u8> = row.try_get("outbox_receipt_bytes").map_err(store_error)?;
    let append_sequence: i64 = row.try_get("append_sequence").map_err(store_error)?;
    if readback.cut.request_identity != request_identity
        || row_digest(&row, "request_meaning_digest")? != readback.cut.request_meaning_digest
        || row_digest(&row, "cut_identity")? != readback.cut.identity()
        || row_digest(&row, "readback_identity")? != readback.identity()
        || row_digest(&row, "receipt_identity")? != readback.receipt_identity()
        || row_digest(&row, "outbox_identity")? != readback.receipt_identity()
        || receipt_bytes != readback.receipt.canonical_bytes.as_ref()
        || outbox_bytes != receipt_bytes
        || row_digest(&row, "store_generation_identity")?
            != readback.receipt.store_generation_identity
        || u64::try_from(append_sequence).ok() != Some(readback.receipt.append_sequence)
    {
        return Err(CalendarErrorV1::StoreUntrusted);
    }
    verify_day_rows(transaction, &readback).await?;
    Ok(Some(readback))
}

async fn verify_day_rows(
    transaction: &mut Transaction<'_, Postgres>,
    readback: &CalendarReadbackV1,
) -> Result<(), CalendarErrorV1> {
    let rows = sqlx::query("SELECT d.civil_day,d.fact_identity,d.fact_digest,f.fact_bytes FROM market_data_private.calendar_cut_days_v1 d JOIN market_data_private.calendar_facts_v1 f ON f.fact_identity=d.fact_identity WHERE d.request_identity=$1 ORDER BY d.civil_day")
        .bind(readback.cut.request_identity.as_bytes().as_slice()).fetch_all(&mut **transaction).await.map_err(store_error)?;
    if rows.len() != readback.cut.days.len() {
        return Err(CalendarErrorV1::StoreUntrusted);
    }

    for ((row, expected), fact) in rows
        .iter()
        .zip(readback.cut.days.iter())
        .zip(readback.facts())
    {
        let day: i32 = row.try_get("civil_day").map_err(store_error)?;
        let fact_bytes: Vec<u8> = row.try_get("fact_bytes").map_err(store_error)?;
        if day != expected.0
            || row_digest(row, "fact_identity")? != expected.1
            || row_digest(row, "fact_digest")? != expected.2
            || fact_bytes != fact.canonical_bytes()
        {
            return Err(CalendarErrorV1::StoreUntrusted);
        }
        load_catalog_for_fact(transaction, fact).await?;
        let head: Option<(Vec<u8>, i64)> = sqlx::query_as("SELECT head_identity,correction_sequence FROM market_data_private.calendar_heads_v1 WHERE calendar_identity=$1 AND civil_day=$2 FOR SHARE")
            .bind(fact.calendar_identity()).bind(fact.day()).fetch_optional(&mut **transaction).await.map_err(store_error)?;
        if head.as_ref().is_none_or(|(identity, sequence)| {
            identity.as_slice() != fact.identity().as_bytes().as_slice()
                || u64::try_from(*sequence).ok() != Some(fact.correction_sequence())
        }) {
            return Err(CalendarErrorV1::StoreUntrusted);
        }
    }
    Ok(())
}

async fn state_for_update(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<(CalendarIdentityV1, u64), CalendarErrorV1> {
    let database_name: String = sqlx::query_scalar("SELECT current_database()")
        .fetch_one(&mut **transaction)
        .await
        .map_err(store_error)?;
    let generation = codec::digest(codec::STORE_DOMAIN, database_name.as_bytes());
    sqlx::query("INSERT INTO market_data_private.calendar_state_v1(singleton,store_generation_identity,append_sequence) VALUES(TRUE,$1,0) ON CONFLICT(singleton) DO NOTHING")
        .bind(generation.as_bytes().as_slice()).execute(&mut **transaction).await.map_err(store_error)?;
    let row = sqlx::query("SELECT store_generation_identity,append_sequence FROM market_data_private.calendar_state_v1 WHERE singleton FOR UPDATE")
        .fetch_one(&mut **transaction).await.map_err(store_error)?;
    let stored = row_digest(&row, "store_generation_identity")?;
    let sequence: i64 = row.try_get("append_sequence").map_err(store_error)?;

    if stored != generation {
        return Err(CalendarErrorV1::StoreUntrusted);
    }
    Ok((
        generation,
        u64::try_from(sequence).map_err(|_| CalendarErrorV1::StoreUntrusted)?,
    ))
}

async fn advisory_lock(
    transaction: &mut Transaction<'_, Postgres>,
    identity: BindingDigest,
) -> Result<(), CalendarErrorV1> {
    let key = i64::from_be_bytes(
        identity.as_bytes()[..8]
            .try_into()
            .map_err(|_| CalendarErrorV1::StoreUnavailable)?,
    );
    sqlx::query("SELECT pg_advisory_xact_lock($1)")
        .bind(key)
        .execute(&mut **transaction)
        .await
        .map_err(store_error)?;
    Ok(())
}

fn row_digest(
    row: &sqlx::postgres::PgRow,
    name: &str,
) -> Result<CalendarIdentityV1, CalendarErrorV1> {
    let bytes: Vec<u8> = row.try_get(name).map_err(store_error)?;
    let array: [u8; 32] = bytes
        .try_into()
        .map_err(|_| CalendarErrorV1::StoreUntrusted)?;
    Ok(CalendarIdentityV1::from_untrusted_bytes(array))
}

fn to_i64(value: u64) -> Result<i64, CalendarErrorV1> {
    i64::try_from(value).map_err(|_| CalendarErrorV1::SequenceOverflow)
}
fn store_error(_: sqlx::Error) -> CalendarErrorV1 {
    CalendarErrorV1::StoreUnavailable
}

#[cfg(test)]
mod tests {
    use super::*;
    use rstest::rstest;

    #[rstest]
    fn schema_is_private_bounded_and_not_global_registration() {
        let joined = CALENDAR_SCHEMA_V1.join("\n");
        assert!(joined.contains("bootstrap schema ownership is unavailable"));
        assert!(!joined.contains("CREATE SCHEMA"));
        assert!(joined.contains("REVOKE ALL ON SCHEMA market_data_private FROM PUBLIC"));
        assert!(joined.contains(
            "REVOKE ALL ON FUNCTION market_data_private.resolve_calendar_v1(BYTEA) FROM PUBLIC"
        ));
        assert!(joined.contains("REVOKE ALL ON TABLE market_data_private.calendar_state_v1"));
        assert!(
            !joined.contains("REVOKE ALL ON ALL TABLES IN SCHEMA market_data_private FROM PUBLIC")
        );
        assert!(joined.contains("calendar_state_v1"));
        assert!(joined.contains("calendar_facts_v1"));
        assert!(joined.contains("calendar_heads_v1"));
        assert!(joined.contains("calendar_cuts_v1"));
        assert!(joined.contains("calendar_receipts_v1"));
        assert!(joined.contains("calendar_outbox_v1"));
        let implementation = include_str!("calendar.rs");
        assert!(implementation.contains("resolve_reference_fact_catalog_entry_v1"));
        assert!(implementation.contains("SAVEPOINT market_data_calendar_catalog_v1"));
        assert!(
            implementation.contains("head_identity")
                && implementation.contains("selected.identity()")
        );
        assert!(
            !super::super::MIGRATION_STATEMENTS
                .iter()
                .any(|statement| statement.contains("calendar_"))
        );
    }
}
