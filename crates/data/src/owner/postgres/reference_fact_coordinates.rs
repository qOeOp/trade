//! PostgreSQL custody for durable R0 observation evidence.

use std::fmt::Debug;

use sqlx::{Postgres, Row, Transaction};

use crate::owner::{
    pit_snapshot::{
        PitSnapshotOwnerReadback, UntrustedPitSnapshotLocator, authority::verify_observation_batch,
    },
    reference_fact_coordinates::r0::{
        AuthenticatedReferenceFactR0EvidenceV1, R0IdentityV1, ReferenceFactR0ErrorV1,
        ReferenceFactR0ReadbackV1, UntrustedReferenceFactR0LocatorV1,
        UntrustedReferenceFactR0RequestV1, decode_and_verify_readback_v1, issue_readback_v1,
        issue_record_and_cut_v1,
    },
    source_binding::{SourceBindingOwnerReadback, UntrustedSourceBindingLocator},
};

use super::{
    build_head_fact, clock_for_pit_time, load_historical_clock, load_pit_for_update,
    load_pit_observation_batch_for_update, load_source_for_update,
};

pub(super) const REFERENCE_FACT_R0_SCHEMA_V1: &[&str] = &[
    "CREATE TABLE IF NOT EXISTS market_data_private.reference_fact_r0_records_v1 (record_identity BYTEA PRIMARY KEY CHECK(octet_length(record_identity)=32), request_identity BYTEA UNIQUE NOT NULL CHECK(octet_length(request_identity)=32), request_meaning_digest BYTEA NOT NULL CHECK(octet_length(request_meaning_digest)=32), record_bytes BYTEA NOT NULL CHECK(octet_length(record_bytes)>0))",
    "CREATE TABLE IF NOT EXISTS market_data_private.reference_fact_r0_cuts_v1 (request_identity BYTEA PRIMARY KEY REFERENCES market_data_private.reference_fact_r0_records_v1(request_identity), cut_identity BYTEA UNIQUE NOT NULL CHECK(octet_length(cut_identity)=32), cut_bytes BYTEA NOT NULL CHECK(octet_length(cut_bytes)>0))",
    "CREATE TABLE IF NOT EXISTS market_data_private.reference_fact_r0_state_v1 (singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK(singleton), store_generation_identity BYTEA NOT NULL CHECK(octet_length(store_generation_identity)=32), append_sequence BIGINT NOT NULL CHECK(append_sequence>=0))",
    "CREATE TABLE IF NOT EXISTS market_data_private.reference_fact_r0_receipts_v1 (request_identity BYTEA PRIMARY KEY REFERENCES market_data_private.reference_fact_r0_records_v1(request_identity), receipt_identity BYTEA UNIQUE NOT NULL CHECK(octet_length(receipt_identity)=32), receipt_bytes BYTEA NOT NULL CHECK(octet_length(receipt_bytes)>0), readback_identity BYTEA UNIQUE NOT NULL CHECK(octet_length(readback_identity)=32), readback_bytes BYTEA NOT NULL CHECK(octet_length(readback_bytes)>0), append_sequence BIGINT UNIQUE NOT NULL CHECK(append_sequence>0))",
    "CREATE TABLE IF NOT EXISTS market_data_private.reference_fact_r0_outbox_v1 (outbox_identity BYTEA PRIMARY KEY CHECK(octet_length(outbox_identity)=32), request_identity BYTEA UNIQUE NOT NULL REFERENCES market_data_private.reference_fact_r0_records_v1(request_identity), payload BYTEA NOT NULL CHECK(octet_length(payload)>0), FOREIGN KEY(outbox_identity) REFERENCES market_data_private.reference_fact_r0_receipts_v1(receipt_identity))",
    "REVOKE ALL ON TABLE market_data_private.reference_fact_r0_records_v1,market_data_private.reference_fact_r0_cuts_v1,market_data_private.reference_fact_r0_state_v1,market_data_private.reference_fact_r0_receipts_v1,market_data_private.reference_fact_r0_outbox_v1 FROM PUBLIC",
];

pub(super) async fn install_reference_fact_r0_schema_v1(
    transaction: &mut Transaction<'_, Postgres>,
) -> Result<(), ReferenceFactR0ErrorV1> {
    for statement in REFERENCE_FACT_R0_SCHEMA_V1 {
        sqlx::query(*statement)
            .execute(&mut **transaction)
            .await
            .map_err(store_error)?;
    }
    Ok(())
}

pub(super) async fn resolve_reference_fact_r0_in_transaction_v1(
    transaction: &mut Transaction<'_, Postgres>,
    request: &UntrustedReferenceFactR0RequestV1,
) -> Result<ReferenceFactR0ReadbackV1, ReferenceFactR0ErrorV1> {
    advisory_lock(transaction, request.request_identity).await?;
    if let Some(readback) = load_readback(transaction, request.request_identity).await? {
        if readback.receipt().request_meaning_digest != request.request_meaning_digest {
            return Err(ReferenceFactR0ErrorV1::RequestConflict);
        }
        return Ok(readback);
    }

    let source_locator: UntrustedSourceBindingLocator =
        canonical_json_locator(&request.source_binding_locator_bytes)?;
    let pit_locator: UntrustedPitSnapshotLocator =
        canonical_json_locator(&request.pit_locator_bytes)?;

    let source = load_source_for_update(transaction, source_locator.binding_id(), false)
        .await
        .map_err(|_| ReferenceFactR0ErrorV1::EvidenceUnavailable)?
        .ok_or(ReferenceFactR0ErrorV1::EvidenceUnavailable)?;
    if source.commit().receipt().locator() != &source_locator {
        return Err(ReferenceFactR0ErrorV1::EvidenceMismatch);
    }
    let source_readback = SourceBindingOwnerReadback::from_verified(&source);
    if !source_readback.is_admitted() {
        return Err(ReferenceFactR0ErrorV1::EvidenceUnavailable);
    }

    let pit = load_pit_for_update(transaction, pit_locator.snapshot_identity, false)
        .await
        .map_err(|_| ReferenceFactR0ErrorV1::EvidenceUnavailable)?
        .ok_or(ReferenceFactR0ErrorV1::EvidenceUnavailable)?;

    if pit.receipt().locator() != &pit_locator
        || pit.fact().source_binding_identity() != source_readback.binding_id()
        || pit.fact().source_binding_lineage_root() != source_readback.lineage_root()
        || pit.fact().source_binding_lineage_version() != source_readback.lineage_version()
    {
        return Err(ReferenceFactR0ErrorV1::EvidenceMismatch);
    }
    let pit_readback = PitSnapshotOwnerReadback::from_verified(&pit);
    if !pit_readback.is_available()
        || pit_readback.snapshot_identity() != pit.fact().snapshot_identity()
        || pit_readback.fact_digest() != pit.fact().digest()
    {
        return Err(ReferenceFactR0ErrorV1::EvidenceUnavailable);
    }
    let stored_batch = load_pit_observation_batch_for_update(transaction, &pit)
        .await
        .map_err(|_| ReferenceFactR0ErrorV1::EvidenceUnavailable)?
        .ok_or(ReferenceFactR0ErrorV1::EvidenceUnavailable)?;
    let batch = verify_observation_batch(
        &pit,
        stored_batch.source_binding_identity,
        stored_batch.source_binding_lineage_root,
        stored_batch.source_binding_lineage_version,
        stored_batch.digest,
        &stored_batch.bytes,
        &stored_batch.rows,
    )
    .map_err(|_| ReferenceFactR0ErrorV1::EvidenceMismatch)?;

    let clock_expected = clock_for_pit_time(&pit.fact().request().time_evidence);
    let clock = load_historical_clock(transaction, &clock_expected)
        .await
        .map_err(|_| ReferenceFactR0ErrorV1::EvidenceUnavailable)?;
    let head = build_head_fact(&clock, None)
        .map_err(|_| ReferenceFactR0ErrorV1::EvidenceMismatch)?
        .handoff;
    let time = &pit.fact().request().time_evidence;
    let source_claim = pit.fact().request().source_binding.clone();
    let Some(correction_publication) = time.correction_publication.as_ref() else {
        return Err(ReferenceFactR0ErrorV1::EvidenceMismatch);
    };
    let event_effective = i128::from(time.event_effective.value);
    let event_end = event_effective
        .checked_add(1)
        .ok_or(ReferenceFactR0ErrorV1::EvidenceMismatch)?;

    if request.replay_start_event_ns != event_effective
        || request.replay_end_event_ns_exclusive != event_end
        || request.effective_from_ns != event_effective
        || request.effective_until_ns != Some(event_end)
        || request.provider_available_ns != i128::from(time.provider_available.value)
        || request.retrieval_ns != i128::from(time.retrieval.value)
        || request.correction_publication_ns != i128::from(correction_publication.value)
        || request.owner_observation_ns != i128::from(time.observed_at)
        || request.decision_cut != time.decision_cut.value
        || source_claim.source_frontier != pit.fact().evidence().source_frontier
        || source_claim.correction_frontier != pit.fact().evidence().correction_frontier
        || batch.observations().iter().any(|row| {
            row.event_effective() != time.event_effective.value
                || row.provider_available() != time.provider_available.value
                || row.retrieval() != time.retrieval.value
                || row.correction_publication() != correction_publication.value
                || row.source_binding_identity() != source_readback.binding_id()
                || row.source_frontier_digest() != source_claim.source_frontier.digest
                || row.correction_sequence() != source_claim.correction_frontier.sequence
                || row.correction_frontier_digest() != source_claim.correction_frontier.digest
        })
    {
        return Err(ReferenceFactR0ErrorV1::EvidenceMismatch);
    }
    let evidence = AuthenticatedReferenceFactR0EvidenceV1 {
        pit_request_identity: pit.fact().request_identity(),
        pit_request_digest: pit.fact().request_digest(),
        pit_snapshot_identity: pit.fact().snapshot_identity(),
        pit_fact_digest: pit.fact().digest(),
        pit_outbox_digest: pit_readback.outbox_digest(),
        observation_batch_digest: batch.digest(),
        source_binding_identity: source_readback.binding_id(),
        source_binding_fact_digest: source_readback.fact_digest(),
        source_binding_outbox_digest: source_readback.outbox_digest(),
        source_binding_lineage_root: source_readback.lineage_root(),
        source_binding_lineage_version: source_readback.lineage_version(),
        source_frontier_stream_identity: source_claim
            .source_frontier
            .stream_identity
            .as_bytes()
            .into(),
        source_frontier_cut_identity: source_claim.source_frontier.cut_identity.as_bytes().into(),
        source_frontier_sequence: source_claim.source_frontier.sequence,
        source_frontier_digest: source_claim.source_frontier.digest,
        correction_frontier_stream_identity: source_claim
            .correction_frontier
            .stream_identity
            .as_bytes()
            .into(),
        correction_frontier_cut_identity: source_claim
            .correction_frontier
            .cut_identity
            .as_bytes()
            .into(),
        correction_frontier_sequence: source_claim.correction_frontier.sequence,
        correction_frontier_digest: source_claim.correction_frontier.digest,
        clock_identity: clock.clock_identity.as_bytes().into(),
        clock_epoch: clock.clock_epoch.as_bytes().into(),
        clock_sequence: clock.monotonic_sequence,
        clock_wall_observed: clock.wall_observed,
        clock_decision_cut: clock.decision_cut,
        clock_valid_through: clock.valid_through,
        clock_head_identity: head.head_identity(),
        clock_head_digest: head.head_digest(),
        restart_continuity_digest: clock.restart_continuity_digest,
        uncertainty_bound: clock.uncertainty_bound,
        skew_bound: clock.skew_bound,
    };
    let (record, cut) = issue_record_and_cut_v1(request, evidence)?;
    let database: String = sqlx::query_scalar("SELECT current_database()")
        .fetch_one(&mut **transaction)
        .await
        .map_err(store_error)?;
    let generation = digest(
        b"vibe.market-data.reference-fact-r0-store-generation.v1\0",
        database.as_bytes(),
    );
    sqlx::query("INSERT INTO market_data_private.reference_fact_r0_state_v1(singleton,store_generation_identity,append_sequence) VALUES(TRUE,$1,0) ON CONFLICT(singleton) DO NOTHING")
        .bind(generation.as_bytes().as_slice()).execute(&mut **transaction).await.map_err(store_error)?;
    let sequence: i64 = sqlx::query_scalar("UPDATE market_data_private.reference_fact_r0_state_v1 SET append_sequence=append_sequence+1 WHERE singleton AND store_generation_identity=$1 RETURNING append_sequence")
        .bind(generation.as_bytes().as_slice()).fetch_optional(&mut **transaction).await.map_err(store_error)?
        .ok_or(ReferenceFactR0ErrorV1::StoreUntrusted)?;
    let sequence = u64::try_from(sequence).map_err(|_| ReferenceFactR0ErrorV1::StoreUntrusted)?;
    let readback = issue_readback_v1(record, cut, generation, sequence)?;
    persist(transaction, &readback).await?;
    Ok(readback)
}

pub(super) async fn recover_reference_fact_r0_in_transaction_v1(
    transaction: &mut Transaction<'_, Postgres>,
    locator: UntrustedReferenceFactR0LocatorV1,
) -> Result<ReferenceFactR0ReadbackV1, ReferenceFactR0ErrorV1> {
    advisory_lock(transaction, locator.request_identity).await?;
    let readback = load_readback(transaction, locator.request_identity)
        .await?
        .ok_or(ReferenceFactR0ErrorV1::UnknownIdentity)?;
    if readback.receipt().request_meaning_digest != locator.request_meaning_digest {
        return Err(ReferenceFactR0ErrorV1::RequestConflict);
    }
    Ok(readback)
}

async fn persist(
    tx: &mut Transaction<'_, Postgres>,
    value: &ReferenceFactR0ReadbackV1,
) -> Result<(), ReferenceFactR0ErrorV1> {
    let r = value.record();
    let c = value.cut();
    let p = value.receipt();
    sqlx::query("INSERT INTO market_data_private.reference_fact_r0_records_v1(record_identity,request_identity,request_meaning_digest,record_bytes) VALUES($1,$2,$3,$4)")
        .bind(r.identity().as_bytes().as_slice()).bind(r.request_identity.as_bytes().as_slice()).bind(r.request_meaning_digest.as_bytes().as_slice()).bind(r.canonical_bytes()).execute(&mut **tx).await.map_err(store_error)?;
    sqlx::query("INSERT INTO market_data_private.reference_fact_r0_cuts_v1(request_identity,cut_identity,cut_bytes) VALUES($1,$2,$3)")
        .bind(r.request_identity.as_bytes().as_slice()).bind(c.identity().as_bytes().as_slice()).bind(c.canonical_bytes()).execute(&mut **tx).await.map_err(store_error)?;
    sqlx::query("INSERT INTO market_data_private.reference_fact_r0_receipts_v1(request_identity,receipt_identity,receipt_bytes,readback_identity,readback_bytes,append_sequence) VALUES($1,$2,$3,$4,$5,$6)")
        .bind(r.request_identity.as_bytes().as_slice()).bind(p.identity().as_bytes().as_slice()).bind(p.canonical_bytes()).bind(value.identity().as_bytes().as_slice()).bind(value.canonical_bytes()).bind(i64::try_from(p.append_sequence).map_err(|_|ReferenceFactR0ErrorV1::StoreUntrusted)?).execute(&mut **tx).await.map_err(store_error)?;
    sqlx::query("INSERT INTO market_data_private.reference_fact_r0_outbox_v1(outbox_identity,request_identity,payload) VALUES($1,$2,$3)")
        .bind(value.outbox_identity().as_bytes().as_slice()).bind(r.request_identity.as_bytes().as_slice()).bind(p.canonical_bytes()).execute(&mut **tx).await.map_err(store_error)?;
    Ok(())
}

pub(super) async fn load_reference_fact_r0_readback_v1(
    tx: &mut Transaction<'_, Postgres>,
    request: R0IdentityV1,
) -> Result<Option<ReferenceFactR0ReadbackV1>, ReferenceFactR0ErrorV1> {
    load_readback(tx, request).await
}

async fn load_readback(
    tx: &mut Transaction<'_, Postgres>,
    request: R0IdentityV1,
) -> Result<Option<ReferenceFactR0ReadbackV1>, ReferenceFactR0ErrorV1> {
    let row=sqlx::query("SELECT x.request_identity,x.record_identity,x.request_meaning_digest,x.record_bytes,c.cut_identity,c.cut_bytes,p.receipt_identity,p.receipt_bytes,p.readback_identity,p.readback_bytes,p.append_sequence,o.outbox_identity,o.payload,s.store_generation_identity,s.append_sequence AS state_sequence FROM market_data_private.reference_fact_r0_records_v1 x JOIN market_data_private.reference_fact_r0_cuts_v1 c USING(request_identity) JOIN market_data_private.reference_fact_r0_receipts_v1 p USING(request_identity) JOIN market_data_private.reference_fact_r0_outbox_v1 o USING(request_identity) CROSS JOIN market_data_private.reference_fact_r0_state_v1 s WHERE s.singleton AND x.request_identity=$1 FOR UPDATE OF x,c,p,o,s")
        .bind(request.as_bytes().as_slice()).fetch_optional(&mut **tx).await.map_err(store_error)?;
    let Some(row) = row else {
        let partial:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM market_data_private.reference_fact_r0_records_v1 WHERE request_identity=$1) OR EXISTS(SELECT 1 FROM market_data_private.reference_fact_r0_cuts_v1 WHERE request_identity=$1) OR EXISTS(SELECT 1 FROM market_data_private.reference_fact_r0_receipts_v1 WHERE request_identity=$1) OR EXISTS(SELECT 1 FROM market_data_private.reference_fact_r0_outbox_v1 WHERE request_identity=$1)").bind(request.as_bytes().as_slice()).fetch_one(&mut **tx).await.map_err(store_error)?;
        return if partial {
            Err(ReferenceFactR0ErrorV1::StoreUntrusted)
        } else {
            Ok(None)
        };
    };
    let readback_bytes: Vec<u8> = row.try_get("readback_bytes").map_err(store_error)?;
    let v = decode_and_verify_readback_v1(&readback_bytes)?;
    let bytes = |n: &str| -> Result<Vec<u8>, ReferenceFactR0ErrorV1> {
        row.try_get(n).map_err(store_error)
    };
    let stored_seq: i64 = row.try_get("append_sequence").map_err(store_error)?;
    let state_seq: i64 = row.try_get("state_sequence").map_err(store_error)?;
    let exact = bytes("request_identity")? == request.as_bytes()
        && v.record().request_identity == request
        && bytes("record_identity")? == v.record().identity().as_bytes()
        && bytes("request_meaning_digest")? == v.record().request_meaning_digest.as_bytes()
        && bytes("record_bytes")? == v.record().canonical_bytes()
        && bytes("cut_identity")? == v.cut().identity().as_bytes()
        && bytes("cut_bytes")? == v.cut().canonical_bytes()
        && bytes("receipt_identity")? == v.receipt().identity().as_bytes()
        && bytes("receipt_bytes")? == v.receipt().canonical_bytes()
        && bytes("readback_identity")? == v.identity().as_bytes()
        && bytes("outbox_identity")? == v.outbox_identity().as_bytes()
        && bytes("payload")? == v.receipt().canonical_bytes()
        && bytes("store_generation_identity")? == v.receipt().store_generation_identity.as_bytes()
        && u64::try_from(stored_seq).ok() == Some(v.receipt().append_sequence)
        && u64::try_from(state_seq).is_ok_and(|x| x >= v.receipt().append_sequence);
    if !exact {
        return Err(ReferenceFactR0ErrorV1::StoreUntrusted);
    }
    Ok(Some(v))
}

fn canonical_json_locator<T>(bytes: &[u8]) -> Result<T, ReferenceFactR0ErrorV1>
where
    T: serde::de::DeserializeOwned + serde::Serialize,
{
    let value: T =
        serde_json::from_slice(bytes).map_err(|_| ReferenceFactR0ErrorV1::CodecMismatch)?;
    if serde_json::to_vec(&value)
        .map_err(|_| ReferenceFactR0ErrorV1::CodecMismatch)?
        .as_slice()
        != bytes
    {
        return Err(ReferenceFactR0ErrorV1::CodecMismatch);
    }
    Ok(value)
}
async fn advisory_lock(
    tx: &mut Transaction<'_, Postgres>,
    v: R0IdentityV1,
) -> Result<(), ReferenceFactR0ErrorV1> {
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended(encode($1::bytea,'hex'),0))")
        .bind(v.as_bytes().as_slice())
        .execute(&mut **tx)
        .await
        .map_err(store_error)?;
    Ok(())
}
fn digest(domain: &[u8], bytes: &[u8]) -> R0IdentityV1 {
    let mut h = blake3::Hasher::new();
    h.update(domain);
    h.update(bytes);
    R0IdentityV1::from_untrusted_bytes(*h.finalize().as_bytes())
}
fn store_error(_: impl Debug) -> ReferenceFactR0ErrorV1 {
    ReferenceFactR0ErrorV1::StoreUnavailable
}
