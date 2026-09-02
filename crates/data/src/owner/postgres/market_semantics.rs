//! Caller-transaction PostgreSQL custody for native Market Semantics V1.

#![allow(
    dead_code,
    reason = "positive Registry composition is intentionally not installed"
)]

use sqlx::{Postgres, Row, Transaction};

use crate::owner::{
    market_semantics::{
        AuthenticatedMarketSemanticsInputsV1, MarketSemanticsErrorV1, MarketSemanticsIdentity,
        MarketSemanticsReadbackV1, MarketSemanticsRegistryEntryV1, MarketSemanticsRegistryKeyV1,
        UntrustedMarketSemanticsLocatorV1, UntrustedMarketSemanticsProposalV1,
        authority::{
            authenticate_market_semantics_inputs_from_r0_v1, decode_and_verify_readback_v1,
            derive_registry_key_v1, issue_fact_and_cut_v1, issue_readback_v1,
            seal_registry_entry_v1, validate_successor_v1,
        },
        codec::decode_registry_entry,
    },
    pit_snapshot::{UntrustedPitSnapshotLocator, authority::verify_observation_batch},
    source_binding::BindingDigest,
    source_binding::{SourceBindingOwnerReadback, UntrustedSourceBindingLocator},
};

use super::{
    load_durable_instrument_readback, load_pit_for_update, load_pit_observation_batch_for_update,
    load_source_for_update, reference_fact_coordinates::load_reference_fact_r0_readback_v1,
};

pub(super) const MARKET_SEMANTICS_SCHEMA_V1: &[&str] = &[
    "CREATE TABLE IF NOT EXISTS market_data_private.market_semantics_registry_v1 (registry_key_identity BYTEA PRIMARY KEY CHECK(octet_length(registry_key_identity)=32), registry_key_bytes BYTEA UNIQUE NOT NULL CHECK(octet_length(registry_key_bytes)>0), record_identity BYTEA UNIQUE NOT NULL CHECK(octet_length(record_identity)=32), record_bytes BYTEA NOT NULL CHECK(octet_length(record_bytes)>0))",
    "CREATE TABLE IF NOT EXISTS market_data_private.market_semantics_facts_v1 (fact_identity BYTEA PRIMARY KEY CHECK(octet_length(fact_identity)=32), compatibility_scope_identity BYTEA NOT NULL CHECK(octet_length(compatibility_scope_identity)=32), predecessor_identity BYTEA NULL REFERENCES market_data_private.market_semantics_facts_v1(fact_identity), effective_from_ns TEXT NOT NULL, effective_until_ns TEXT NULL, owner_observation_ns TEXT NOT NULL, decision_cut BIGINT NOT NULL CHECK(decision_cut>0), correction_identity BYTEA NOT NULL CHECK(octet_length(correction_identity)=32), fact_bytes BYTEA NOT NULL CHECK(octet_length(fact_bytes)>0), UNIQUE(compatibility_scope_identity,predecessor_identity))",
    "CREATE TABLE IF NOT EXISTS market_data_private.market_semantics_heads_v1 (compatibility_scope_identity BYTEA PRIMARY KEY CHECK(octet_length(compatibility_scope_identity)=32), fact_identity BYTEA UNIQUE NOT NULL REFERENCES market_data_private.market_semantics_facts_v1(fact_identity))",
    "CREATE TABLE IF NOT EXISTS market_data_private.market_semantics_cuts_v1 (request_identity BYTEA PRIMARY KEY CHECK(octet_length(request_identity)=32), request_meaning_digest BYTEA NOT NULL CHECK(octet_length(request_meaning_digest)=32), cut_identity BYTEA UNIQUE NOT NULL CHECK(octet_length(cut_identity)=32), cut_bytes BYTEA NOT NULL CHECK(octet_length(cut_bytes)>0))",
    "CREATE TABLE IF NOT EXISTS market_data_private.market_semantics_state_v1 (singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK(singleton), store_generation_identity BYTEA NOT NULL CHECK(octet_length(store_generation_identity)=32), append_sequence BIGINT NOT NULL CHECK(append_sequence>=0))",
    "CREATE TABLE IF NOT EXISTS market_data_private.market_semantics_receipts_v1 (request_identity BYTEA PRIMARY KEY REFERENCES market_data_private.market_semantics_cuts_v1(request_identity), fact_identity BYTEA NOT NULL REFERENCES market_data_private.market_semantics_facts_v1(fact_identity), receipt_identity BYTEA UNIQUE NOT NULL CHECK(octet_length(receipt_identity)=32), receipt_bytes BYTEA NOT NULL CHECK(octet_length(receipt_bytes)>0), readback_identity BYTEA UNIQUE NOT NULL CHECK(octet_length(readback_identity)=32), readback_bytes BYTEA NOT NULL CHECK(octet_length(readback_bytes)>0), append_sequence BIGINT UNIQUE NOT NULL CHECK(append_sequence>0))",
    "CREATE TABLE IF NOT EXISTS market_data_private.market_semantics_outbox_v1 (outbox_identity BYTEA PRIMARY KEY REFERENCES market_data_private.market_semantics_receipts_v1(receipt_identity) CHECK(octet_length(outbox_identity)=32), request_identity BYTEA UNIQUE NOT NULL REFERENCES market_data_private.market_semantics_receipts_v1(request_identity), payload BYTEA NOT NULL CHECK(octet_length(payload)>0))",
    "REVOKE ALL ON TABLE market_data_private.market_semantics_registry_v1,market_data_private.market_semantics_facts_v1,market_data_private.market_semantics_heads_v1,market_data_private.market_semantics_cuts_v1,market_data_private.market_semantics_state_v1,market_data_private.market_semantics_receipts_v1,market_data_private.market_semantics_outbox_v1 FROM PUBLIC",
];

pub(super) async fn install_market_semantics_schema_v1(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<(), MarketSemanticsErrorV1> {
    for statement in MARKET_SEMANTICS_SCHEMA_V1 {
        sqlx::query(*statement)
            .execute(&mut **transaction)
            .await
            .map_err(store_error)?;
    }
    Ok(())
}

pub(super) async fn resolve_market_semantics_in_transaction_v1(
    transaction: &mut Transaction<'_, Postgres>,
    proposal: &UntrustedMarketSemanticsProposalV1,
) -> Result<MarketSemanticsReadbackV1, MarketSemanticsErrorV1> {
    let source_locator: UntrustedSourceBindingLocator =
        canonical_json_locator(&proposal.source_binding_locator_bytes)?;
    let pit_locator: UntrustedPitSnapshotLocator =
        canonical_json_locator(&proposal.pit_locator_bytes)?;
    let (instrument_request_identity, instrument_request_meaning) =
        decode_exact_locator(&proposal.instrument_master_locator_bytes)?;
    let (r0_request_identity, r0_request_meaning) =
        decode_exact_locator(&proposal.r0_locator_bytes)?;

    let source = load_source_for_update(transaction, source_locator.binding_id(), false)
        .await
        .map_err(|_| MarketSemanticsErrorV1::UnauthenticatedInput)?
        .ok_or(MarketSemanticsErrorV1::UnauthenticatedInput)?;
    if source.commit().receipt().locator() != &source_locator {
        return Err(MarketSemanticsErrorV1::DependencyMismatch);
    }
    let source = SourceBindingOwnerReadback::from_verified(&source);
    let pit = load_pit_for_update(transaction, pit_locator.snapshot_identity, false)
        .await
        .map_err(|_| MarketSemanticsErrorV1::UnauthenticatedInput)?
        .ok_or(MarketSemanticsErrorV1::UnauthenticatedInput)?;
    if pit.receipt().locator() != &pit_locator {
        return Err(MarketSemanticsErrorV1::DependencyMismatch);
    }
    let batch = load_pit_observation_batch_for_update(transaction, &pit)
        .await
        .map_err(|_| MarketSemanticsErrorV1::UnauthenticatedInput)?
        .ok_or(MarketSemanticsErrorV1::UnauthenticatedInput)?;
    let pit = verify_observation_batch(
        &pit,
        batch.source_binding_identity,
        batch.source_binding_lineage_root,
        batch.source_binding_lineage_version,
        batch.digest,
        &batch.bytes,
        &batch.rows,
    )
    .map_err(|_| MarketSemanticsErrorV1::DependencyMismatch)?;
    let instrument =
        load_durable_instrument_readback(transaction, instrument_request_identity, true)
            .await
            .map_err(|_| MarketSemanticsErrorV1::UnauthenticatedInput)?
            .ok_or(MarketSemanticsErrorV1::UnauthenticatedInput)?;
    if instrument.request_meaning_digest != instrument_request_meaning {
        return Err(MarketSemanticsErrorV1::DependencyMismatch);
    }
    let r0 = load_reference_fact_r0_readback_v1(transaction, r0_request_identity)
        .await
        .map_err(|_| MarketSemanticsErrorV1::UnauthenticatedInput)?
        .ok_or(MarketSemanticsErrorV1::UnauthenticatedInput)?;
    if r0.receipt().request_meaning_digest != r0_request_meaning {
        return Err(MarketSemanticsErrorV1::DependencyMismatch);
    }
    let key = derive_registry_key_v1(
        proposal.compatibility_scope_identity,
        &source,
        &pit,
        &instrument,
        &r0,
    )?;
    let registry = load_registry_entry(transaction, &key).await?;
    let inputs =
        authenticate_market_semantics_inputs_from_r0_v1(&source, &pit, &instrument, &r0, registry)?;
    append_market_semantics_in_transaction_v1(transaction, proposal, &inputs).await
}

async fn append_market_semantics_in_transaction_v1(
    transaction: &mut Transaction<'_, Postgres>,
    proposal: &UntrustedMarketSemanticsProposalV1,
    inputs: &AuthenticatedMarketSemanticsInputsV1,
) -> Result<MarketSemanticsReadbackV1, MarketSemanticsErrorV1> {
    let (fact, cut) = issue_fact_and_cut_v1(proposal, inputs)?;
    advisory_lock(transaction, proposal.request_identity).await?;
    advisory_lock(transaction, proposal.compatibility_scope_identity).await?;
    if let Some(readback) = load_readback(transaction, proposal.request_identity, true).await? {
        if readback.receipt().request_meaning_digest != proposal.request_meaning_digest
            || readback.cut().identity() != cut.identity()
        {
            return Err(MarketSemanticsErrorV1::RequestConflict);
        }
        return Ok(readback);
    }

    let head_bytes: Option<Vec<u8>> = sqlx::query_scalar(
        "SELECT f.fact_bytes FROM market_data_private.market_semantics_heads_v1 h JOIN market_data_private.market_semantics_facts_v1 f ON f.fact_identity=h.fact_identity WHERE h.compatibility_scope_identity=$1 FOR UPDATE OF h,f",
    ).bind(proposal.compatibility_scope_identity.as_bytes().as_slice()).fetch_optional(&mut **transaction).await.map_err(store_error)?;
    let predecessor = head_bytes
        .as_deref()
        .map(crate::owner::market_semantics::codec::decode_fact)
        .transpose()?;
    if predecessor
        .as_ref()
        .is_some_and(|prior| prior.identity() == fact.identity())
    {
        if predecessor
            .as_ref()
            .is_none_or(|prior| prior.canonical_bytes() != fact.canonical_bytes())
        {
            return Err(MarketSemanticsErrorV1::StoreUntrusted);
        }
    } else {
        validate_successor_v1(predecessor.as_ref(), &fact)?;
    }
    reject_ambiguous_overlap(transaction, &fact).await?;

    let database: String = sqlx::query_scalar("SELECT current_database()")
        .fetch_one(&mut **transaction)
        .await
        .map_err(store_error)?;
    let generation = store_generation(&database);
    sqlx::query("INSERT INTO market_data_private.market_semantics_state_v1(singleton,store_generation_identity,append_sequence) VALUES(TRUE,$1,0) ON CONFLICT(singleton) DO NOTHING")
        .bind(generation.as_bytes().as_slice()).execute(&mut **transaction).await.map_err(store_error)?;
    let sequence: i64 = sqlx::query_scalar("UPDATE market_data_private.market_semantics_state_v1 SET append_sequence=append_sequence+1 WHERE singleton AND store_generation_identity=$1 RETURNING append_sequence")
        .bind(generation.as_bytes().as_slice()).fetch_optional(&mut **transaction).await.map_err(store_error)?
        .ok_or(MarketSemanticsErrorV1::StoreUntrusted)?;
    let sequence = u64::try_from(sequence).map_err(|_| MarketSemanticsErrorV1::StoreUntrusted)?;
    let readback = issue_readback_v1(fact, cut, generation, sequence, proposal.stable_correlation)?;
    persist_readback(transaction, &readback).await?;
    Ok(readback)
}

pub(super) async fn recover_market_semantics_in_transaction_v1(
    transaction: &mut Transaction<'_, Postgres>,
    locator: UntrustedMarketSemanticsLocatorV1,
) -> Result<MarketSemanticsReadbackV1, MarketSemanticsErrorV1> {
    advisory_lock(transaction, locator.request_identity).await?;
    let readback = load_readback(transaction, locator.request_identity, true)
        .await?
        .ok_or(MarketSemanticsErrorV1::UnknownIdentity)?;
    if readback.receipt().request_meaning_digest != locator.request_meaning_digest {
        return Err(MarketSemanticsErrorV1::RequestConflict);
    }
    Ok(readback)
}

pub(super) async fn resolve_market_semantics_scope_in_transaction_v1(
    transaction: &mut Transaction<'_, Postgres>,
    compatibility_scope_identity: MarketSemanticsIdentity,
    effective_instant_ns: i128,
    owner_observation_ns: i128,
    decision_cut: u64,
) -> Result<MarketSemanticsReadbackV1, MarketSemanticsErrorV1> {
    let rows = sqlx::query("SELECT r.request_identity,f.fact_identity,f.fact_bytes FROM market_data_private.market_semantics_receipts_v1 r JOIN market_data_private.market_semantics_facts_v1 f ON f.fact_identity=r.fact_identity WHERE f.compatibility_scope_identity=$1 FOR SHARE OF r,f")
        .bind(compatibility_scope_identity.as_bytes().as_slice())
        .fetch_all(&mut **transaction)
        .await
        .map_err(store_error)?;
    let mut selected: Option<(
        crate::owner::market_semantics::MarketSemanticsFactV1,
        BindingDigest,
    )> = None;
    for row in rows {
        let fact_bytes: Vec<u8> = row.try_get("fact_bytes").map_err(store_error)?;
        let fact = crate::owner::market_semantics::codec::decode_fact(&fact_bytes)?;
        if fact.compatibility_scope_identity != compatibility_scope_identity
            || fact.decision_cut > decision_cut
            || fact.owner_observation_ns > owner_observation_ns
            || fact.effective_from_ns > effective_instant_ns
            || fact
                .effective_until_ns
                .is_some_and(|until| effective_instant_ns >= until)
        {
            continue;
        }
        let request_identity = row_digest(&row, "request_identity")?;
        if let Some((prior, _)) = &selected {
            let prior_key = (prior.owner_observation_ns, prior.correction_publication_ns);
            let next_key = (fact.owner_observation_ns, fact.correction_publication_ns);
            if next_key == prior_key && fact.identity() != prior.identity() {
                return Err(MarketSemanticsErrorV1::InvalidOverlap);
            }
            if next_key <= prior_key {
                continue;
            }
        }
        selected = Some((fact, request_identity));
    }
    let (fact, request_identity) = selected.ok_or(MarketSemanticsErrorV1::UnknownIdentity)?;
    let readback = load_readback(transaction, request_identity, true)
        .await?
        .ok_or(MarketSemanticsErrorV1::StoreUntrusted)?;
    let [resolved] = readback.facts() else {
        return Err(MarketSemanticsErrorV1::StoreUntrusted);
    };
    if resolved.identity() != fact.identity()
        || resolved.canonical_bytes() != fact.canonical_bytes()
    {
        return Err(MarketSemanticsErrorV1::StoreUntrusted);
    }
    Ok(readback)
}

async fn persist_readback(
    transaction: &mut Transaction<'_, Postgres>,
    readback: &MarketSemanticsReadbackV1,
) -> Result<(), MarketSemanticsErrorV1> {
    let [fact] = readback.facts() else {
        return Err(MarketSemanticsErrorV1::IncompleteCut);
    };
    sqlx::query("INSERT INTO market_data_private.market_semantics_facts_v1(fact_identity,compatibility_scope_identity,predecessor_identity,effective_from_ns,effective_until_ns,owner_observation_ns,decision_cut,correction_identity,fact_bytes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(fact_identity) DO NOTHING")
        .bind(fact.identity().as_bytes().as_slice()).bind(fact.compatibility_scope_identity().as_bytes().as_slice())
        .bind(fact.predecessor_identity().map(|value| value.as_bytes().to_vec())).bind(fact.effective_from_ns.to_string())
        .bind(fact.effective_until_ns.map(|value| value.to_string())).bind(fact.owner_observation_ns.to_string())
        .bind(i64::try_from(fact.decision_cut).map_err(|_| MarketSemanticsErrorV1::CapacityExceeded)?)
        .bind(fact.correction_identity.as_bytes().as_slice()).bind(fact.canonical_bytes())
        .execute(&mut **transaction).await.map_err(store_error)?;
    let stored: Vec<u8> = sqlx::query_scalar("SELECT fact_bytes FROM market_data_private.market_semantics_facts_v1 WHERE fact_identity=$1 FOR UPDATE")
        .bind(fact.identity().as_bytes().as_slice()).fetch_one(&mut **transaction).await.map_err(store_error)?;
    if stored != fact.canonical_bytes() {
        return Err(MarketSemanticsErrorV1::StoreUntrusted);
    }
    sqlx::query("INSERT INTO market_data_private.market_semantics_heads_v1(compatibility_scope_identity,fact_identity) VALUES($1,$2) ON CONFLICT(compatibility_scope_identity) DO UPDATE SET fact_identity=EXCLUDED.fact_identity")
        .bind(fact.compatibility_scope_identity().as_bytes().as_slice()).bind(fact.identity().as_bytes().as_slice())
        .execute(&mut **transaction).await.map_err(store_error)?;
    sqlx::query("INSERT INTO market_data_private.market_semantics_cuts_v1(request_identity,request_meaning_digest,cut_identity,cut_bytes) VALUES($1,$2,$3,$4)")
        .bind(readback.cut().request_identity.as_bytes().as_slice()).bind(readback.cut().request_meaning_digest.as_bytes().as_slice())
        .bind(readback.cut().identity().as_bytes().as_slice()).bind(readback.cut().canonical_bytes())
        .execute(&mut **transaction).await.map_err(store_error)?;
    sqlx::query("INSERT INTO market_data_private.market_semantics_receipts_v1(request_identity,fact_identity,receipt_identity,receipt_bytes,readback_identity,readback_bytes,append_sequence) VALUES($1,$2,$3,$4,$5,$6,$7)")
        .bind(readback.cut().request_identity.as_bytes().as_slice()).bind(fact.identity().as_bytes().as_slice()).bind(readback.receipt().identity().as_bytes().as_slice())
        .bind(readback.receipt().canonical_bytes()).bind(readback.identity().as_bytes().as_slice()).bind(readback.canonical_bytes())
        .bind(i64::try_from(readback.receipt().append_sequence).map_err(|_| MarketSemanticsErrorV1::CapacityExceeded)?)
        .execute(&mut **transaction).await.map_err(store_error)?;
    sqlx::query("INSERT INTO market_data_private.market_semantics_outbox_v1(outbox_identity,request_identity,payload) VALUES($1,$2,$3)")
        .bind(readback.outbox_identity().as_bytes().as_slice()).bind(readback.cut().request_identity.as_bytes().as_slice())
        .bind(readback.receipt().canonical_bytes()).execute(&mut **transaction).await.map_err(store_error)?;
    Ok(())
}

async fn load_readback(
    transaction: &mut Transaction<'_, Postgres>,
    request: BindingDigest,
    lock: bool,
) -> Result<Option<MarketSemanticsReadbackV1>, MarketSemanticsErrorV1> {
    let row = if lock {
        sqlx::query("SELECT c.request_meaning_digest,c.cut_identity,c.cut_bytes,r.receipt_identity,r.receipt_bytes,r.readback_identity,r.readback_bytes,r.append_sequence,o.outbox_identity,o.payload FROM market_data_private.market_semantics_cuts_v1 c JOIN market_data_private.market_semantics_receipts_v1 r ON r.request_identity=c.request_identity JOIN market_data_private.market_semantics_outbox_v1 o ON o.request_identity=c.request_identity WHERE c.request_identity=$1 FOR UPDATE OF c,r,o")
            .bind(request.as_bytes().as_slice()).fetch_optional(&mut **transaction).await.map_err(store_error)?
    } else {
        sqlx::query("SELECT c.request_meaning_digest,c.cut_identity,c.cut_bytes,r.receipt_identity,r.receipt_bytes,r.readback_identity,r.readback_bytes,r.append_sequence,o.outbox_identity,o.payload FROM market_data_private.market_semantics_cuts_v1 c JOIN market_data_private.market_semantics_receipts_v1 r ON r.request_identity=c.request_identity JOIN market_data_private.market_semantics_outbox_v1 o ON o.request_identity=c.request_identity WHERE c.request_identity=$1")
            .bind(request.as_bytes().as_slice()).fetch_optional(&mut **transaction).await.map_err(store_error)?
    };
    let Some(row) = row else {
        let partial: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM market_data_private.market_semantics_cuts_v1 WHERE request_identity=$1) OR EXISTS(SELECT 1 FROM market_data_private.market_semantics_receipts_v1 WHERE request_identity=$1) OR EXISTS(SELECT 1 FROM market_data_private.market_semantics_outbox_v1 WHERE request_identity=$1)")
            .bind(request.as_bytes().as_slice()).fetch_one(&mut **transaction).await.map_err(store_error)?;
        return if partial {
            Err(MarketSemanticsErrorV1::StoreUntrusted)
        } else {
            Ok(None)
        };
    };
    let readback_bytes: Vec<u8> = row.try_get("readback_bytes").map_err(store_error)?;
    let readback = decode_and_verify_readback_v1(&readback_bytes)?;
    let [fact] = readback.facts() else {
        return Err(MarketSemanticsErrorV1::StoreUntrusted);
    };
    let stored_fact: Option<Vec<u8>> = sqlx::query_scalar("SELECT fact_bytes FROM market_data_private.market_semantics_facts_v1 WHERE fact_identity=$1")
        .bind(fact.identity().as_bytes().as_slice()).fetch_optional(&mut **transaction).await.map_err(store_error)?;
    let state: Option<(Vec<u8>, i64)> = sqlx::query_as("SELECT store_generation_identity,append_sequence FROM market_data_private.market_semantics_state_v1 WHERE singleton")
        .fetch_optional(&mut **transaction).await.map_err(store_error)?;
    let stored_sequence: i64 = row.try_get("append_sequence").map_err(store_error)?;
    let exact = readback.cut().request_identity == request
        && row_bytes(&row, "request_meaning_digest")?
            == readback.cut().request_meaning_digest.as_bytes()
        && row_bytes(&row, "cut_identity")? == readback.cut().identity().as_bytes()
        && row_bytes(&row, "cut_bytes")? == readback.cut().canonical_bytes()
        && row_bytes(&row, "receipt_identity")? == readback.receipt().identity().as_bytes()
        && row_bytes(&row, "receipt_bytes")? == readback.receipt().canonical_bytes()
        && row_bytes(&row, "readback_identity")? == readback.identity().as_bytes()
        && row_bytes(&row, "outbox_identity")? == readback.outbox_identity().as_bytes()
        && row_bytes(&row, "payload")? == readback.receipt().canonical_bytes()
        && stored_fact.as_deref() == Some(fact.canonical_bytes())
        && u64::try_from(stored_sequence).ok() == Some(readback.receipt().append_sequence)
        && state.is_some_and(|(generation, sequence)| {
            generation == readback.receipt().store_generation_identity.as_bytes()
                && u64::try_from(sequence)
                    .is_ok_and(|current| current >= readback.receipt().append_sequence)
        });
    if !exact {
        return Err(MarketSemanticsErrorV1::StoreUntrusted);
    }
    Ok(Some(readback))
}

async fn reject_ambiguous_overlap(
    transaction: &mut Transaction<'_, Postgres>,
    fact: &crate::owner::market_semantics::MarketSemanticsFactV1,
) -> Result<(), MarketSemanticsErrorV1> {
    let rows: Vec<Vec<u8>> = sqlx::query_scalar("SELECT fact_bytes FROM market_data_private.market_semantics_facts_v1 WHERE compatibility_scope_identity=$1 FOR SHARE")
        .bind(fact.compatibility_scope_identity().as_bytes().as_slice()).fetch_all(&mut **transaction).await.map_err(store_error)?;
    for bytes in rows {
        let prior = crate::owner::market_semantics::codec::decode_fact(&bytes)?;
        if prior.identity() == fact.identity()
            || Some(prior.identity()) == fact.predecessor_identity()
            || (prior.effective_from_ns == fact.effective_from_ns
                && prior.effective_until_ns == fact.effective_until_ns)
        {
            continue;
        }
        let overlaps = fact.effective_from_ns < prior.effective_until_ns.unwrap_or(i128::MAX)
            && prior.effective_from_ns < fact.effective_until_ns.unwrap_or(i128::MAX);
        if overlaps {
            return Err(MarketSemanticsErrorV1::InvalidOverlap);
        }
    }
    Ok(())
}

pub(super) async fn register_market_semantics_registry_entry_v1(
    transaction: &mut Transaction<'_, Postgres>,
    entry: &MarketSemanticsRegistryEntryV1,
) -> Result<(), MarketSemanticsErrorV1> {
    advisory_lock(transaction, entry.key().identity()).await?;
    sqlx::query("INSERT INTO market_data_private.market_semantics_registry_v1(registry_key_identity,registry_key_bytes,record_identity,record_bytes) VALUES($1,$2,$3,$4) ON CONFLICT(registry_key_identity) DO NOTHING")
        .bind(entry.key().identity().as_bytes().as_slice())
        .bind(entry.key().canonical_bytes())
        .bind(entry.identity().as_bytes().as_slice())
        .bind(entry.canonical_bytes())
        .execute(&mut **transaction)
        .await
        .map_err(store_error)?;
    let row = sqlx::query("SELECT registry_key_bytes,record_identity,record_bytes FROM market_data_private.market_semantics_registry_v1 WHERE registry_key_identity=$1 FOR UPDATE")
        .bind(entry.key().identity().as_bytes().as_slice())
        .fetch_one(&mut **transaction)
        .await
        .map_err(store_error)?;
    let stored = decode_registry_entry(&row_bytes(&row, "record_bytes")?)?;
    if row_bytes(&row, "registry_key_bytes")? != entry.key().canonical_bytes()
        || row_bytes(&row, "record_identity")? != entry.identity().as_bytes()
        || stored != *entry
    {
        return Err(MarketSemanticsErrorV1::StoreUntrusted);
    }
    Ok(())
}

async fn load_registry_entry(
    transaction: &mut Transaction<'_, Postgres>,
    key: &MarketSemanticsRegistryKeyV1,
) -> Result<MarketSemanticsRegistryEntryV1, MarketSemanticsErrorV1> {
    let rows = sqlx::query("SELECT registry_key_identity,registry_key_bytes,record_identity,record_bytes FROM market_data_private.market_semantics_registry_v1 WHERE registry_key_identity=$1 FOR SHARE")
        .bind(key.identity().as_bytes().as_slice())
        .fetch_all(&mut **transaction)
        .await
        .map_err(store_error)?;
    let [row] = rows.as_slice() else {
        return Err(MarketSemanticsErrorV1::UnauthenticatedInput);
    };
    let entry = decode_registry_entry(&row_bytes(row, "record_bytes")?)?;
    let verified = seal_registry_entry_v1(
        entry.key().clone(),
        entry.value(),
        entry.correction_identity(),
    )?;
    if row_bytes(row, "registry_key_identity")? != key.identity().as_bytes()
        || row_bytes(row, "registry_key_bytes")? != key.canonical_bytes()
        || row_bytes(row, "record_identity")? != entry.identity().as_bytes()
        || entry.key() != key
        || entry != verified
    {
        return Err(MarketSemanticsErrorV1::StoreUntrusted);
    }
    Ok(entry)
}

fn canonical_json_locator<T>(bytes: &[u8]) -> Result<T, MarketSemanticsErrorV1>
where
    T: serde::de::DeserializeOwned + serde::Serialize,
{
    let value: T =
        serde_json::from_slice(bytes).map_err(|_| MarketSemanticsErrorV1::CodecMismatch)?;
    if serde_json::to_vec(&value)
        .map_err(|_| MarketSemanticsErrorV1::CodecMismatch)?
        .as_slice()
        != bytes
    {
        return Err(MarketSemanticsErrorV1::CodecMismatch);
    }
    Ok(value)
}

fn decode_exact_locator(
    bytes: &[u8],
) -> Result<(BindingDigest, BindingDigest), MarketSemanticsErrorV1> {
    let exact: &[u8; 64] = bytes
        .try_into()
        .map_err(|_| MarketSemanticsErrorV1::CodecMismatch)?;
    let request_identity = exact[..32]
        .try_into()
        .map(BindingDigest::from_untrusted_bytes)
        .map_err(|_| MarketSemanticsErrorV1::CodecMismatch)?;
    let request_meaning = exact[32..]
        .try_into()
        .map(BindingDigest::from_untrusted_bytes)
        .map_err(|_| MarketSemanticsErrorV1::CodecMismatch)?;
    if request_identity.as_bytes() == &[0; 32] || request_meaning.as_bytes() == &[0; 32] {
        return Err(MarketSemanticsErrorV1::CodecMismatch);
    }
    Ok((request_identity, request_meaning))
}

async fn advisory_lock(
    transaction: &mut Transaction<'_, Postgres>,
    identity: BindingDigest,
) -> Result<(), MarketSemanticsErrorV1> {
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended(encode($1::bytea,'hex'),0))")
        .bind(identity.as_bytes().as_slice())
        .execute(&mut **transaction)
        .await
        .map_err(store_error)?;
    Ok(())
}

fn row_bytes(row: &sqlx::postgres::PgRow, name: &str) -> Result<Vec<u8>, MarketSemanticsErrorV1> {
    row.try_get(name).map_err(store_error)
}

fn row_digest(
    row: &sqlx::postgres::PgRow,
    name: &str,
) -> Result<BindingDigest, MarketSemanticsErrorV1> {
    let bytes: [u8; 32] = row_bytes(row, name)?
        .try_into()
        .map_err(|_| MarketSemanticsErrorV1::StoreUntrusted)?;
    Ok(BindingDigest::from_untrusted_bytes(bytes))
}

fn store_generation(database: &str) -> MarketSemanticsIdentity {
    let mut hasher = blake3::Hasher::new();
    hasher.update(b"vibe.market-data.market-semantics-store-generation.v1\0");
    hasher.update(database.as_bytes());
    MarketSemanticsIdentity::from_untrusted_bytes(*hasher.finalize().as_bytes())
}

fn store_error(_: impl std::fmt::Debug) -> MarketSemanticsErrorV1 {
    MarketSemanticsErrorV1::StoreUnavailable
}

#[cfg(test)]
mod tests {
    use super::MARKET_SEMANTICS_SCHEMA_V1;

    #[test]
    fn schema_is_private_write_once_and_outbox_equals_receipt_identity() {
        let schema = MARKET_SEMANTICS_SCHEMA_V1.join("\n");
        assert!(schema.contains("market_semantics_facts_v1"));
        assert!(schema.contains("market_semantics_heads_v1"));
        assert!(schema.contains("market_semantics_receipts_v1"));
        assert!(schema.contains("market_semantics_outbox_v1"));
        assert!(schema.contains("REVOKE ALL ON TABLE"));
        assert!(!schema.contains("GRANT"));
    }
}
