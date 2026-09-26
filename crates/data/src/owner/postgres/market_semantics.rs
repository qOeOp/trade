//! Caller-transaction PostgreSQL custody for native Market Semantics V1.

#![allow(
    dead_code,
    reason = "positive Registry composition is intentionally not installed"
)]

use std::fmt::Debug;

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
    "CREATE TABLE IF NOT EXISTS market_data_private.market_semantics_heads_v2 (compatibility_scope_identity BYTEA NOT NULL CHECK(octet_length(compatibility_scope_identity)=32), pit_snapshot_identity BYTEA NOT NULL CHECK(octet_length(pit_snapshot_identity)=32), fact_identity BYTEA UNIQUE NOT NULL REFERENCES market_data_private.market_semantics_facts_v1(fact_identity), PRIMARY KEY(compatibility_scope_identity,pit_snapshot_identity))",
    "CREATE TABLE IF NOT EXISTS market_data_private.market_semantics_cuts_v1 (request_identity BYTEA PRIMARY KEY CHECK(octet_length(request_identity)=32), request_meaning_digest BYTEA NOT NULL CHECK(octet_length(request_meaning_digest)=32), cut_identity BYTEA UNIQUE NOT NULL CHECK(octet_length(cut_identity)=32), cut_bytes BYTEA NOT NULL CHECK(octet_length(cut_bytes)>0))",
    "CREATE TABLE IF NOT EXISTS market_data_private.market_semantics_state_v1 (singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK(singleton), store_generation_identity BYTEA NOT NULL CHECK(octet_length(store_generation_identity)=32), append_sequence BIGINT NOT NULL CHECK(append_sequence>=0))",
    "CREATE TABLE IF NOT EXISTS market_data_private.market_semantics_receipts_v1 (request_identity BYTEA PRIMARY KEY REFERENCES market_data_private.market_semantics_cuts_v1(request_identity), fact_identity BYTEA NOT NULL REFERENCES market_data_private.market_semantics_facts_v1(fact_identity), receipt_identity BYTEA UNIQUE NOT NULL CHECK(octet_length(receipt_identity)=32), receipt_bytes BYTEA NOT NULL CHECK(octet_length(receipt_bytes)>0), readback_identity BYTEA UNIQUE NOT NULL CHECK(octet_length(readback_identity)=32), readback_bytes BYTEA NOT NULL CHECK(octet_length(readback_bytes)>0), append_sequence BIGINT UNIQUE NOT NULL CHECK(append_sequence>0))",
    "CREATE TABLE IF NOT EXISTS market_data_private.market_semantics_outbox_v1 (outbox_identity BYTEA PRIMARY KEY REFERENCES market_data_private.market_semantics_receipts_v1(receipt_identity) CHECK(octet_length(outbox_identity)=32), request_identity BYTEA UNIQUE NOT NULL REFERENCES market_data_private.market_semantics_receipts_v1(request_identity), payload BYTEA NOT NULL CHECK(octet_length(payload)>0))",
    "REVOKE ALL ON TABLE market_data_private.market_semantics_registry_v1,market_data_private.market_semantics_facts_v1,market_data_private.market_semantics_heads_v2,market_data_private.market_semantics_cuts_v1,market_data_private.market_semantics_state_v1,market_data_private.market_semantics_receipts_v1,market_data_private.market_semantics_outbox_v1 FROM PUBLIC",
];

pub(super) async fn install_market_semantics_schema_v1(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<(), MarketSemanticsErrorV1> {
    for statement in MARKET_SEMANTICS_SCHEMA_V1 {
        sqlx::query(*statement)
            .execute(&mut **transaction)
            .await
            .map_err(|cause| store_error(&cause))?;
    }
    migrate_scope_heads_to_snapshot_heads_v1(transaction).await
}

/// The migration that moves Market Semantics heads from one per scope to one per scope and PIT
/// snapshot, recorded once in the Owner's migration ledger.
const SNAPSHOT_HEADS_MIGRATION_ID: &str = "market-data-owner-market-semantics-snapshot-heads-v1";

/// The one-head-per-scope table as every earlier build creates it. It is kept, retired, so an
/// earlier binary finds it already present and fails on its first write rather than creating it
/// empty and admitting any genesis.
const LEGACY_SCOPE_HEADS_DDL: &str = "CREATE TABLE IF NOT EXISTS market_data_private.market_semantics_heads_v1 (compatibility_scope_identity BYTEA PRIMARY KEY CHECK(octet_length(compatibility_scope_identity)=32), fact_identity BYTEA UNIQUE NOT NULL REFERENCES market_data_private.market_semantics_facts_v1(fact_identity))";

const RETIRE_SCOPE_HEADS: &[&str] = &[
    "CREATE OR REPLACE FUNCTION market_data_private.market_semantics_heads_v1_retired() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $function$ BEGIN RAISE EXCEPTION 'market_semantics_heads_v1 is retired: Market Semantics heads are kept per compatibility scope and PIT snapshot in market_semantics_heads_v2'; END $function$",
    "CREATE TRIGGER market_semantics_heads_v1_retired BEFORE INSERT OR UPDATE OR DELETE ON market_data_private.market_semantics_heads_v1 FOR EACH ROW EXECUTE FUNCTION market_data_private.market_semantics_heads_v1_retired()",
    "CREATE TRIGGER market_semantics_heads_v1_retired_truncate BEFORE TRUNCATE ON market_data_private.market_semantics_heads_v1 FOR EACH STATEMENT EXECUTE FUNCTION market_data_private.market_semantics_heads_v1_retired()",
    "REVOKE ALL ON TABLE market_data_private.market_semantics_heads_v1 FROM PUBLIC",
    "REVOKE ALL ON FUNCTION market_data_private.market_semantics_heads_v1_retired() FROM PUBLIC",
];

/// Moves a store from one head per compatibility scope to one head per scope and PIT snapshot,
/// keying each head by the snapshot its fact binds, then retires the old table.
///
/// A fact is proven by one snapshot's evidence, so a second snapshot under the same Source Binding
/// needs its own chain; the old table could hold only the first. The step runs once, recorded in
/// the migration ledger, and refuses rather than guesses: an old table of any other shape, a head
/// whose fact does not decode or whose identity drifted, or a carry-over that does not account for
/// every old head stops the whole installation.
async fn migrate_scope_heads_to_snapshot_heads_v1(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<(), MarketSemanticsErrorV1> {
    let migrated: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM market_data_private.owner_migrations_v1 WHERE migration_id=$1)",
    )
    .bind(SNAPSHOT_HEADS_MIGRATION_ID)
    .fetch_one(&mut **transaction)
    .await
    .map_err(|cause| store_error(&cause))?;

    if migrated {
        return Ok(());
    }
    sqlx::query(LEGACY_SCOPE_HEADS_DDL)
        .execute(&mut **transaction)
        .await
        .map_err(|cause| store_error(&cause))?;
    let columns: Vec<String> = sqlx::query_scalar(
        "SELECT a.attname::text||':'||pg_catalog.format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull::text FROM pg_catalog.pg_attribute a WHERE a.attrelid='market_data_private.market_semantics_heads_v1'::regclass AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum",
    )
    .fetch_all(&mut **transaction)
    .await
    .map_err(|cause| store_error(&cause))?;

    if columns
        != [
            "compatibility_scope_identity:bytea:true",
            "fact_identity:bytea:true",
        ]
    {
        return Err(MarketSemanticsErrorV1::StoreUntrusted);
    }
    let heads: Vec<(Vec<u8>, Vec<u8>, Vec<u8>)> = sqlx::query_as(
        "SELECT h.compatibility_scope_identity,h.fact_identity,f.fact_bytes FROM market_data_private.market_semantics_heads_v1 h JOIN market_data_private.market_semantics_facts_v1 f ON f.fact_identity=h.fact_identity FOR UPDATE OF h,f",
    )
    .fetch_all(&mut **transaction)
    .await
    .map_err(|cause| store_error(&cause))?;

    for (scope, fact_identity, fact_bytes) in &heads {
        let fact = crate::owner::market_semantics::codec::decode_fact(fact_bytes)?;

        if fact.identity().as_bytes().as_slice() != fact_identity.as_slice()
            || fact.compatibility_scope_identity().as_bytes().as_slice() != scope.as_slice()
        {
            return Err(MarketSemanticsErrorV1::StoreUntrusted);
        }
        sqlx::query("INSERT INTO market_data_private.market_semantics_heads_v2(compatibility_scope_identity,pit_snapshot_identity,fact_identity) VALUES($1,$2,$3)")
            .bind(scope.as_slice())
            .bind(fact.pit_snapshot_identity.as_bytes().as_slice())
            .bind(fact_identity.as_slice())
            .execute(&mut **transaction)
            .await
            .map_err(|cause| store_error(&cause))?;
    }
    let (old, carried): (i64, i64) = sqlx::query_as(
        "SELECT (SELECT pg_catalog.count(*) FROM market_data_private.market_semantics_heads_v1),(SELECT pg_catalog.count(*) FROM market_data_private.market_semantics_heads_v1 h JOIN market_data_private.market_semantics_heads_v2 n ON n.fact_identity=h.fact_identity AND n.compatibility_scope_identity=h.compatibility_scope_identity)",
    )
    .fetch_one(&mut **transaction)
    .await
    .map_err(|cause| store_error(&cause))?;

    if usize::try_from(old).ok() != Some(heads.len()) || old != carried {
        return Err(MarketSemanticsErrorV1::StoreUntrusted);
    }

    for statement in RETIRE_SCOPE_HEADS {
        sqlx::query(*statement)
            .execute(&mut **transaction)
            .await
            .map_err(|cause| store_error(&cause))?;
    }
    sqlx::query("INSERT INTO market_data_private.owner_migrations_v1(migration_id) VALUES ($1)")
        .bind(SNAPSHOT_HEADS_MIGRATION_ID)
        .execute(&mut **transaction)
        .await
        .map_err(|cause| store_error(&cause))?;
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
    if let Some(readback) =
        load_readback(transaction, proposal.request_identity, true, false).await?
    {
        if readback.receipt().request_meaning_digest != proposal.request_meaning_digest
            || readback.cut().identity() != cut.identity()
        {
            return Err(MarketSemanticsErrorV1::RequestConflict);
        }
        return Ok(readback);
    }

    // Appends to one scope are ordered twice: the caller locked the scope's Source Binding rows
    // `FOR UPDATE` when it resolved the inputs, and the scope lock above orders any append that did
    // not. The named refusal also rests on READ COMMITTED: each statement takes its own snapshot,
    // so the heads read here include any head a concurrent append committed while this one waited.
    // Under REPEATABLE READ the snapshot is fixed by the transaction's first statement, before it
    // waited, so the second append reads the scope without the first one's head and is not refused
    // here. Measured on 2026-09-26, it then failed closed later as a store refusal rather than being
    // admitted, but that rests on an unrelated write conflict and loses `ScopeValueConflict`.
    let scope_heads = load_scope_heads(transaction, proposal.compatibility_scope_identity).await?;
    let predecessor = scope_heads
        .iter()
        .find(|head| head.pit_snapshot_identity == fact.pit_snapshot_identity)
        .cloned();

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
        reject_scope_value_conflict(&scope_heads, &fact)?;
    }
    reject_ambiguous_overlap(transaction, &fact).await?;

    let database: String = sqlx::query_scalar("SELECT current_database()")
        .fetch_one(&mut **transaction)
        .await
        .map_err(|cause| store_error(&cause))?;
    let generation = store_generation(&database);
    sqlx::query("INSERT INTO market_data_private.market_semantics_state_v1(singleton,store_generation_identity,append_sequence) VALUES(TRUE,$1,0) ON CONFLICT(singleton) DO NOTHING")
        .bind(generation.as_bytes().as_slice()).execute(&mut **transaction).await.map_err(|cause| store_error(&cause))?;
    let sequence: i64 = sqlx::query_scalar("UPDATE market_data_private.market_semantics_state_v1 SET append_sequence=append_sequence+1 WHERE singleton AND store_generation_identity=$1 RETURNING append_sequence")
        .bind(generation.as_bytes().as_slice()).fetch_optional(&mut **transaction).await.map_err(|cause| store_error(&cause))?
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
    let readback = load_readback(transaction, locator.request_identity, true, false)
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
    pit_snapshot_identity: MarketSemanticsIdentity,
    effective_instant_ns: i128,
    owner_observation_ns: i128,
    decision_cut: u64,
) -> Result<MarketSemanticsReadbackV1, MarketSemanticsErrorV1> {
    resolve_market_semantics_scope_with_lock_v1(
        transaction,
        compatibility_scope_identity,
        pit_snapshot_identity,
        effective_instant_ns,
        owner_observation_ns,
        decision_cut,
        ScopeReadModeV1::LockRows,
    )
    .await
}

pub(super) async fn resolve_market_semantics_scope_read_only_in_transaction_v1(
    transaction: &mut Transaction<'_, Postgres>,
    compatibility_scope_identity: MarketSemanticsIdentity,
    pit_snapshot_identity: MarketSemanticsIdentity,
    effective_instant_ns: i128,
    owner_observation_ns: i128,
    decision_cut: u64,
) -> Result<MarketSemanticsReadbackV1, MarketSemanticsErrorV1> {
    resolve_market_semantics_scope_with_lock_v1(
        transaction,
        compatibility_scope_identity,
        pit_snapshot_identity,
        effective_instant_ns,
        owner_observation_ns,
        decision_cut,
        ScopeReadModeV1::ReadOnly,
    )
    .await
}

pub(super) async fn resolve_market_semantics_scope_for_rd_strategy_input_v1(
    transaction: &mut Transaction<'_, Postgres>,
    compatibility_scope_identity: MarketSemanticsIdentity,
    pit_snapshot_identity: MarketSemanticsIdentity,
    effective_instant_ns: i128,
    owner_observation_ns: i128,
    decision_cut: u64,
) -> Result<MarketSemanticsReadbackV1, MarketSemanticsErrorV1> {
    // The Market Data writer takes the exclusive form of this scope lock before appending.
    // Hold its shared form through the R&D commit so a new fact cannot become the selected cut.
    sqlx::query("SELECT pg_catalog.pg_advisory_xact_lock_shared(pg_catalog.hashtextextended(pg_catalog.encode($1::bytea,'hex'),0))")
        .bind(compatibility_scope_identity.as_bytes().as_slice())
        .execute(&mut **transaction)
        .await
        .map_err(|cause| store_error(&cause))?;
    resolve_market_semantics_scope_with_lock_v1(
        transaction,
        compatibility_scope_identity,
        pit_snapshot_identity,
        effective_instant_ns,
        owner_observation_ns,
        decision_cut,
        ScopeReadModeV1::RdOwner,
    )
    .await
}

/// How a scope read takes its rows: locked by Market Data, unlocked, or through R&D's locked facade.
#[derive(Clone, Copy)]
enum ScopeReadModeV1 {
    LockRows,
    ReadOnly,
    RdOwner,
}

async fn resolve_market_semantics_scope_with_lock_v1(
    transaction: &mut Transaction<'_, Postgres>,
    compatibility_scope_identity: MarketSemanticsIdentity,
    pit_snapshot_identity: MarketSemanticsIdentity,
    effective_instant_ns: i128,
    owner_observation_ns: i128,
    decision_cut: u64,
    mode: ScopeReadModeV1,
) -> Result<MarketSemanticsReadbackV1, MarketSemanticsErrorV1> {
    let (lock, rd_owner) = match mode {
        ScopeReadModeV1::LockRows => (true, false),
        ScopeReadModeV1::ReadOnly => (false, false),
        ScopeReadModeV1::RdOwner => (true, true),
    };
    let query = if rd_owner {
        "SELECT * FROM market_data_rd_api.lock_market_semantics_scope_for_strategy_input_v1($1)"
    } else if lock {
        "SELECT r.request_identity,f.fact_identity,f.fact_bytes FROM market_data_private.market_semantics_receipts_v1 r JOIN market_data_private.market_semantics_facts_v1 f ON f.fact_identity=r.fact_identity WHERE f.compatibility_scope_identity=$1 FOR SHARE OF r,f"
    } else {
        "SELECT r.request_identity,f.fact_identity,f.fact_bytes FROM market_data_private.market_semantics_receipts_v1 r JOIN market_data_private.market_semantics_facts_v1 f ON f.fact_identity=r.fact_identity WHERE f.compatibility_scope_identity=$1"
    };
    let rows = sqlx::query(query)
        .bind(compatibility_scope_identity.as_bytes().as_slice())
        .fetch_all(&mut **transaction)
        .await
        .map_err(|cause| store_error(&cause))?;
    let mut selected: Option<(
        crate::owner::market_semantics::MarketSemanticsFactV1,
        BindingDigest,
    )> = None;

    for row in rows {
        let fact_bytes: Vec<u8> = row
            .try_get("fact_bytes")
            .map_err(|cause| store_error(&cause))?;
        let fact = crate::owner::market_semantics::codec::decode_fact(&fact_bytes)?;
        if fact.compatibility_scope_identity != compatibility_scope_identity
            || fact.pit_snapshot_identity != pit_snapshot_identity
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
    let readback = load_readback(transaction, request_identity, lock, rd_owner)
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
        .execute(&mut **transaction).await.map_err(|cause| store_error(&cause))?;
    let stored: Vec<u8> = sqlx::query_scalar("SELECT fact_bytes FROM market_data_private.market_semantics_facts_v1 WHERE fact_identity=$1 FOR UPDATE")
        .bind(fact.identity().as_bytes().as_slice()).fetch_one(&mut **transaction).await.map_err(|cause| store_error(&cause))?;
    if stored != fact.canonical_bytes() {
        return Err(MarketSemanticsErrorV1::StoreUntrusted);
    }
    sqlx::query("INSERT INTO market_data_private.market_semantics_heads_v2(compatibility_scope_identity,pit_snapshot_identity,fact_identity) VALUES($1,$2,$3) ON CONFLICT(compatibility_scope_identity,pit_snapshot_identity) DO UPDATE SET fact_identity=EXCLUDED.fact_identity")
        .bind(fact.compatibility_scope_identity().as_bytes().as_slice()).bind(fact.pit_snapshot_identity.as_bytes().as_slice()).bind(fact.identity().as_bytes().as_slice())
        .execute(&mut **transaction).await.map_err(|cause| store_error(&cause))?;
    sqlx::query("INSERT INTO market_data_private.market_semantics_cuts_v1(request_identity,request_meaning_digest,cut_identity,cut_bytes) VALUES($1,$2,$3,$4)")
        .bind(readback.cut().request_identity.as_bytes().as_slice()).bind(readback.cut().request_meaning_digest.as_bytes().as_slice())
        .bind(readback.cut().identity().as_bytes().as_slice()).bind(readback.cut().canonical_bytes())
        .execute(&mut **transaction).await.map_err(|cause| store_error(&cause))?;
    sqlx::query("INSERT INTO market_data_private.market_semantics_receipts_v1(request_identity,fact_identity,receipt_identity,receipt_bytes,readback_identity,readback_bytes,append_sequence) VALUES($1,$2,$3,$4,$5,$6,$7)")
        .bind(readback.cut().request_identity.as_bytes().as_slice()).bind(fact.identity().as_bytes().as_slice()).bind(readback.receipt().identity().as_bytes().as_slice())
        .bind(readback.receipt().canonical_bytes()).bind(readback.identity().as_bytes().as_slice()).bind(readback.canonical_bytes())
        .bind(i64::try_from(readback.receipt().append_sequence).map_err(|_| MarketSemanticsErrorV1::CapacityExceeded)?)
        .execute(&mut **transaction).await.map_err(|cause| store_error(&cause))?;
    sqlx::query("INSERT INTO market_data_private.market_semantics_outbox_v1(outbox_identity,request_identity,payload) VALUES($1,$2,$3)")
        .bind(readback.outbox_identity().as_bytes().as_slice()).bind(readback.cut().request_identity.as_bytes().as_slice())
        .bind(readback.receipt().canonical_bytes()).execute(&mut **transaction).await.map_err(|cause| store_error(&cause))?;
    Ok(())
}

async fn load_readback(
    transaction: &mut Transaction<'_, Postgres>,
    request: BindingDigest,
    lock: bool,
    rd_owner: bool,
) -> Result<Option<MarketSemanticsReadbackV1>, MarketSemanticsErrorV1> {
    let row = if rd_owner {
        sqlx::query("SELECT * FROM market_data_rd_api.lock_market_semantics_readback_for_strategy_input_v1($1)")
            .bind(request.as_bytes().as_slice()).fetch_optional(&mut **transaction).await.map_err(|cause| store_error(&cause))?
    } else if lock {
        sqlx::query("SELECT c.request_meaning_digest,c.cut_identity,c.cut_bytes,r.receipt_identity,r.receipt_bytes,r.readback_identity,r.readback_bytes,r.append_sequence,o.outbox_identity,o.payload FROM market_data_private.market_semantics_cuts_v1 c JOIN market_data_private.market_semantics_receipts_v1 r ON r.request_identity=c.request_identity JOIN market_data_private.market_semantics_outbox_v1 o ON o.request_identity=c.request_identity WHERE c.request_identity=$1 FOR UPDATE OF c,r,o")
            .bind(request.as_bytes().as_slice()).fetch_optional(&mut **transaction).await.map_err(|cause| store_error(&cause))?
    } else {
        sqlx::query("SELECT c.request_meaning_digest,c.cut_identity,c.cut_bytes,r.receipt_identity,r.receipt_bytes,r.readback_identity,r.readback_bytes,r.append_sequence,o.outbox_identity,o.payload FROM market_data_private.market_semantics_cuts_v1 c JOIN market_data_private.market_semantics_receipts_v1 r ON r.request_identity=c.request_identity JOIN market_data_private.market_semantics_outbox_v1 o ON o.request_identity=c.request_identity WHERE c.request_identity=$1")
            .bind(request.as_bytes().as_slice()).fetch_optional(&mut **transaction).await.map_err(|cause| store_error(&cause))?
    };
    let Some(row) = row else {
        if rd_owner {
            return Err(MarketSemanticsErrorV1::StoreUntrusted);
        }
        let partial: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM market_data_private.market_semantics_cuts_v1 WHERE request_identity=$1) OR EXISTS(SELECT 1 FROM market_data_private.market_semantics_receipts_v1 WHERE request_identity=$1) OR EXISTS(SELECT 1 FROM market_data_private.market_semantics_outbox_v1 WHERE request_identity=$1)")
            .bind(request.as_bytes().as_slice()).fetch_one(&mut **transaction).await.map_err(|cause| store_error(&cause))?;
        return if partial {
            Err(MarketSemanticsErrorV1::StoreUntrusted)
        } else {
            Ok(None)
        };
    };
    let readback_bytes: Vec<u8> = row
        .try_get("readback_bytes")
        .map_err(|cause| store_error(&cause))?;
    let readback = decode_and_verify_readback_v1(&readback_bytes)?;
    let [fact] = readback.facts() else {
        return Err(MarketSemanticsErrorV1::StoreUntrusted);
    };
    let stored_fact: Option<Vec<u8>> = if rd_owner {
        Some(
            row.try_get("stored_fact_bytes")
                .map_err(|cause| store_error(&cause))?,
        )
    } else {
        sqlx::query_scalar("SELECT fact_bytes FROM market_data_private.market_semantics_facts_v1 WHERE fact_identity=$1")
            .bind(fact.identity().as_bytes().as_slice()).fetch_optional(&mut **transaction).await.map_err(|cause| store_error(&cause))?
    };
    let state: Option<(Vec<u8>, i64)> = if rd_owner {
        Some((
            row.try_get("store_generation_identity")
                .map_err(|cause| store_error(&cause))?,
            row.try_get("state_append_sequence")
                .map_err(|cause| store_error(&cause))?,
        ))
    } else {
        sqlx::query_as("SELECT store_generation_identity,append_sequence FROM market_data_private.market_semantics_state_v1 WHERE singleton")
            .fetch_optional(&mut **transaction).await.map_err(|cause| store_error(&cause))?
    };
    let stored_sequence: i64 = row
        .try_get("append_sequence")
        .map_err(|cause| store_error(&cause))?;
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

/// The PIT snapshot of a compatibility scope's only head, for a caller that holds no snapshot and
/// relies on the scope answering with exactly one chain. A scope with no head or with several has
/// no such answer, and is refused rather than read by picking one.
pub(super) async fn resolve_sole_market_semantics_head_snapshot_v1(
    transaction: &mut Transaction<'_, Postgres>,
    compatibility_scope_identity: MarketSemanticsIdentity,
) -> Result<MarketSemanticsIdentity, MarketSemanticsErrorV1> {
    let heads = load_scope_heads(transaction, compatibility_scope_identity).await?;
    let [head] = heads.as_slice() else {
        return Err(MarketSemanticsErrorV1::UnknownIdentity);
    };
    Ok(head.pit_snapshot_identity)
}

/// Every current head of one compatibility scope, one per PIT snapshot, locked for the append.
async fn load_scope_heads(
    transaction: &mut Transaction<'_, Postgres>,
    compatibility_scope_identity: MarketSemanticsIdentity,
) -> Result<Vec<crate::owner::market_semantics::MarketSemanticsFactV1>, MarketSemanticsErrorV1> {
    let rows: Vec<Vec<u8>> = sqlx::query_scalar(
        "SELECT f.fact_bytes FROM market_data_private.market_semantics_heads_v2 h JOIN market_data_private.market_semantics_facts_v1 f ON f.fact_identity=h.fact_identity WHERE h.compatibility_scope_identity=$1 FOR UPDATE OF h,f",
    )
    .bind(compatibility_scope_identity.as_bytes().as_slice())
    .fetch_all(&mut **transaction)
    .await
    .map_err(|cause| store_error(&cause))?;
    rows.iter()
        .map(|bytes| crate::owner::market_semantics::codec::decode_fact(bytes))
        .collect()
}

/// One Source Binding states one price adjustment: after every commit, every head of a scope
/// carries the same typed value. The head this fact succeeds is the one it may replace, so only
/// the other heads constrain it; a value change is therefore possible only when it reaches every
/// head of the scope at once.
fn reject_scope_value_conflict(
    scope_heads: &[crate::owner::market_semantics::MarketSemanticsFactV1],
    fact: &crate::owner::market_semantics::MarketSemanticsFactV1,
) -> Result<(), MarketSemanticsErrorV1> {
    if scope_heads.iter().any(|head| {
        Some(head.identity()) != fact.predecessor_identity() && head.value != fact.value
    }) {
        return Err(MarketSemanticsErrorV1::ScopeValueConflict);
    }
    Ok(())
}

async fn reject_ambiguous_overlap(
    transaction: &mut Transaction<'_, Postgres>,
    fact: &crate::owner::market_semantics::MarketSemanticsFactV1,
) -> Result<(), MarketSemanticsErrorV1> {
    let rows: Vec<Vec<u8>> = sqlx::query_scalar("SELECT fact_bytes FROM market_data_private.market_semantics_facts_v1 WHERE compatibility_scope_identity=$1 FOR SHARE")
        .bind(fact.compatibility_scope_identity().as_bytes().as_slice()).fetch_all(&mut **transaction).await.map_err(|cause| store_error(&cause))?;

    for bytes in rows {
        let prior = crate::owner::market_semantics::codec::decode_fact(&bytes)?;
        // Effective regimes may not overlap within one chain; each PIT snapshot keeps its own.
        if prior.pit_snapshot_identity != fact.pit_snapshot_identity
            || prior.identity() == fact.identity()
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
        .map_err(|cause| store_error(&cause))?;
    let row = sqlx::query("SELECT registry_key_bytes,record_identity,record_bytes FROM market_data_private.market_semantics_registry_v1 WHERE registry_key_identity=$1 FOR UPDATE")
        .bind(entry.key().identity().as_bytes().as_slice())
        .fetch_one(&mut **transaction)
        .await
        .map_err(|cause| store_error(&cause))?;
    if row_bytes(&row, "registry_key_bytes")? != entry.key().canonical_bytes() {
        return Err(MarketSemanticsErrorV1::StoreUntrusted);
    }
    let stored = decode_registry_entry(&row_bytes(&row, "record_bytes")?)?;
    let stored_identity_holds = row_bytes(&row, "record_identity")? == stored.identity().as_bytes();

    if stored_identity_holds && stored == *entry {
        return Ok(());
    }

    // A key is stated once. A sound stored record under the same key that states another value is
    // the submitter's conflict; any other difference is the store's, and is not named as one.
    if stored_identity_holds
        && stored.key() == entry.key()
        && stored.correction_identity() == entry.correction_identity()
        && stored.value() != entry.value()
    {
        return Err(MarketSemanticsErrorV1::RegistryValueConflict);
    }
    Err(MarketSemanticsErrorV1::StoreUntrusted)
}

async fn load_registry_entry(
    transaction: &mut Transaction<'_, Postgres>,
    key: &MarketSemanticsRegistryKeyV1,
) -> Result<MarketSemanticsRegistryEntryV1, MarketSemanticsErrorV1> {
    let rows = sqlx::query("SELECT registry_key_identity,registry_key_bytes,record_identity,record_bytes FROM market_data_private.market_semantics_registry_v1 WHERE registry_key_identity=$1 FOR SHARE")
        .bind(key.identity().as_bytes().as_slice())
        .fetch_all(&mut **transaction)
        .await
        .map_err(|cause| store_error(&cause))?;
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
        .map_err(|cause| store_error(&cause))?;
    Ok(())
}

fn row_bytes(row: &sqlx::postgres::PgRow, name: &str) -> Result<Vec<u8>, MarketSemanticsErrorV1> {
    row.try_get(name).map_err(|cause| store_error(&cause))
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

#[track_caller]
fn store_error(cause: &impl Debug) -> MarketSemanticsErrorV1 {
    crate::owner::storage_diagnostic::refused_by_store_at(cause);
    MarketSemanticsErrorV1::StoreUnavailable
}

#[cfg(test)]
mod tests {
    use super::MARKET_SEMANTICS_SCHEMA_V1;
    use rstest::rstest;

    #[rstest]
    fn schema_is_private_write_once_and_outbox_equals_receipt_identity() {
        let schema = MARKET_SEMANTICS_SCHEMA_V1.join("\n");
        assert!(schema.contains("market_semantics_facts_v1"));
        assert!(schema.contains("market_semantics_heads_v2"));
        assert!(schema.contains("market_semantics_receipts_v1"));
        assert!(schema.contains("market_semantics_outbox_v1"));
        assert!(schema.contains("REVOKE ALL ON TABLE"));
        assert!(!schema.contains("GRANT"));
    }
}
