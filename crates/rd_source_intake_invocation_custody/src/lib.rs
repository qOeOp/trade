//! Canonical cross-owner custody for one Source Intake provider invocation.

use std::fmt::Display;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{Postgres, Transaction};
use thiserror::Error;
use vibe_product_edge_claim_custody::{
    StoredInvocationAdmissionReceiptV1, StoredInvocationClaimV1, StoredInvocationStateKindV1,
    StoredInvocationStateV1, invocation_admission_receipt_digest, invocation_claim_digest,
    invocation_state_digest,
};

const SOURCE_PROVIDER_EFFECT_V1: &str = "R_AND_D_SOURCE_PROVIDER_INVOCATION_V1";

#[derive(Debug, Error)]
pub enum SourceInvocationCustodyError {
    #[error("Source Intake invocation custody unavailable")]
    Unavailable,
    #[error("Source Intake invocation custody storage unavailable: {0}")]
    Storage(String),
}

/// Canonical R&D binding held under the R&D Owner's locked read port.
#[derive(Debug, PartialEq, Eq, Serialize)]
pub struct SourceAcquisitionBindingCustodyV1 {
    request_identity: String,
    binding_identity: String,
    binding_digest: String,
    admission_identity: String,
    admission_digest: String,
    operation_manifest_identity: String,
    operation_manifest_digest: String,
    normalized_doi: String,
    binding_commit_identity: String,
}

impl SourceAcquisitionBindingCustodyV1 {
    pub fn request_identity(&self) -> &str {
        &self.request_identity
    }
    pub fn binding_identity(&self) -> &str {
        &self.binding_identity
    }
    pub fn binding_digest(&self) -> &str {
        &self.binding_digest
    }
    pub fn admission_identity(&self) -> &str {
        &self.admission_identity
    }
    pub fn admission_digest(&self) -> &str {
        &self.admission_digest
    }
    pub fn operation_manifest_identity(&self) -> &str {
        &self.operation_manifest_identity
    }
    pub fn operation_manifest_digest(&self) -> &str {
        &self.operation_manifest_digest
    }
    pub fn normalized_doi(&self) -> &str {
        &self.normalized_doi
    }
    pub fn binding_commit_identity(&self) -> &str {
        &self.binding_commit_identity
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct LockedBindingEnvelopeV1 {
    schema_version: u32,
    request_identity: String,
    binding_identity: String,
    binding_digest: String,
    admission_identity: String,
    admission_digest: String,
    operation_manifest_identity: String,
    operation_manifest_digest: String,
    normalized_doi: String,
    binding_commit_identity: String,
}

/// Resolve and verify the exact R&D-owned Source Acquisition Binding before a
/// Product Edge invocation claim is allowed to commit.
pub async fn resolve_source_acquisition_binding_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    request_identity: &str,
    binding_identity: &str,
) -> Result<SourceAcquisitionBindingCustodyV1, SourceInvocationCustodyError> {
    if request_identity.trim().is_empty() || binding_identity.trim().is_empty() {
        return Err(SourceInvocationCustodyError::Unavailable);
    }
    let value: Option<serde_json::Value> =
        sqlx::query_scalar("SELECT rd_owner_api.lock_source_acquisition_binding_v1($1,$2)")
            .bind(request_identity)
            .bind(binding_identity)
            .fetch_one(&mut **transaction)
            .await
            .map_err(storage)?;
    let envelope: LockedBindingEnvelopeV1 =
        serde_json::from_value(value.ok_or(SourceInvocationCustodyError::Unavailable)?)
            .map_err(|_| SourceInvocationCustodyError::Unavailable)?;

    if envelope.schema_version != 1
        || envelope.request_identity != request_identity
        || envelope.binding_identity != binding_identity
        || !valid_sha256(&envelope.binding_digest)
        || envelope.admission_identity.trim().is_empty()
        || !valid_sha256(&envelope.admission_digest)
        || envelope.operation_manifest_identity.trim().is_empty()
        || !valid_sha256(&envelope.operation_manifest_digest)
        || envelope.normalized_doi.trim().is_empty()
        || envelope.binding_commit_identity.trim().is_empty()
    {
        return Err(SourceInvocationCustodyError::Unavailable);
    }
    Ok(SourceAcquisitionBindingCustodyV1 {
        request_identity: envelope.request_identity,
        binding_identity: envelope.binding_identity,
        binding_digest: envelope.binding_digest,
        admission_identity: envelope.admission_identity,
        admission_digest: envelope.admission_digest,
        operation_manifest_identity: envelope.operation_manifest_identity,
        operation_manifest_digest: envelope.operation_manifest_digest,
        normalized_doi: envelope.normalized_doi,
        binding_commit_identity: envelope.binding_commit_identity,
    })
}

fn valid_sha256(value: &str) -> bool {
    value.len() == 71
        && value.starts_with("sha256:")
        && value[7..]
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

/// Canonically verified Product Edge claim returned only through its locked
/// downstream read port. It has no public positive constructor or deserializer.
#[derive(Debug, PartialEq, Eq, Serialize)]
pub struct SourceInvocationClaimCustodyV1 {
    request_identity: String,
    admission_identity: String,
    attempt_identity: String,
    claim_identity: String,
    claim_digest: String,
    invocation_admission_receipt_identity: String,
    invocation_admission_receipt_digest: String,
    claimed_state_digest: String,
}

impl SourceInvocationClaimCustodyV1 {
    pub fn request_identity(&self) -> &str {
        &self.request_identity
    }
    pub fn admission_identity(&self) -> &str {
        &self.admission_identity
    }
    pub fn attempt_identity(&self) -> &str {
        &self.attempt_identity
    }
    pub fn claim_identity(&self) -> &str {
        &self.claim_identity
    }
    pub fn claim_digest(&self) -> &str {
        &self.claim_digest
    }
    pub fn invocation_admission_receipt_identity(&self) -> &str {
        &self.invocation_admission_receipt_identity
    }
    pub fn invocation_admission_receipt_digest(&self) -> &str {
        &self.invocation_admission_receipt_digest
    }
    pub fn claimed_state_digest(&self) -> &str {
        &self.claimed_state_digest
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct LockedClaimEnvelopeV1 {
    schema_version: u32,
    admission: LockedInvocationAdmissionV1,
    claim: LockedInvocationClaimV1,
    state: LockedInvocationStateV1,
    admission_outbox: LockedOutboxV1,
    claim_outbox: LockedOutboxV1,
    claimed_state_outbox: LockedOutboxV1,
    current_state_outbox: LockedOutboxV1,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct LockedInvocationAdmissionV1 {
    receipt_identity: String,
    receipt_digest: String,
    admission_identity: String,
    attempt_identity: String,
    claim_identity: String,
    receipt_json: StoredInvocationAdmissionReceiptV1,
    write_cut_epoch_ms: u64,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct LockedInvocationClaimV1 {
    admission_identity: String,
    claim_identity: String,
    attempt_identity: String,
    claim_digest: String,
    claim_json: StoredInvocationClaimV1,
    committed_at_epoch_ms: u64,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct LockedInvocationStateV1 {
    claim_identity: String,
    admission_identity: String,
    attempt_identity: String,
    claim_digest: String,
    state_digest: String,
    state_json: StoredInvocationStateV1,
    updated_at_epoch_ms: u64,
}

#[derive(Debug, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct LockedOutboxV1 {
    event_identity: String,
    aggregate_identity: String,
    event_kind: String,
    payload_digest: String,
    payload_json: StoredOutboxV1,
    committed_at_epoch_ms: u64,
}

#[derive(Debug, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct StoredOutboxV1 {
    schema_version: u32,
    event_identity: String,
    aggregate_identity: String,
    event_kind: String,
    payload_digest: String,
    committed_at_epoch_ms: u64,
}

/// Resolve and verify the exact Product Edge claim for the R&D reservation.
pub async fn resolve_source_invocation_claim_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    request_identity: &str,
    admission_identity: &str,
    attempt_identity: &str,
) -> Result<SourceInvocationClaimCustodyV1, SourceInvocationCustodyError> {
    if request_identity.trim().is_empty()
        || admission_identity.trim().is_empty()
        || attempt_identity.trim().is_empty()
    {
        return Err(SourceInvocationCustodyError::Unavailable);
    }
    let value: Option<serde_json::Value> =
        sqlx::query_scalar("SELECT product_edge_api.lock_source_invocation_claim_v1($1,$2,$3)")
            .bind(request_identity)
            .bind(admission_identity)
            .bind(attempt_identity)
            .fetch_one(&mut **transaction)
            .await
            .map_err(storage)?;
    let envelope: LockedClaimEnvelopeV1 =
        serde_json::from_value(value.ok_or(SourceInvocationCustodyError::Unavailable)?)
            .map_err(|_| SourceInvocationCustodyError::Unavailable)?;
    let admission = &envelope.admission.receipt_json;
    let claim = &envelope.claim.claim_json;
    let state = &envelope.state.state_json;
    if envelope.schema_version != 1
        || admission.schema_version != 1
        || claim.schema_version != 1
        || state.schema_version != 1
        || !valid_admission_columns(&envelope.admission)
        || !valid_claim_columns(&envelope.claim)
        || !valid_state_columns(&envelope.state)
        || admission.request_identity != request_identity
        || admission.admission_identity != admission_identity
        || admission.attempt_identity != attempt_identity
        || admission.effect != SOURCE_PROVIDER_EFFECT_V1
        || claim.admission_identity != admission_identity
        || claim.attempt_identity != attempt_identity
        || claim.claim_identity != admission.claim_identity
        || claim.invocation_admission_receipt_identity != admission.receipt_identity
        || claim.invocation_admission_receipt_digest != admission.receipt_digest
        || state.state != StoredInvocationStateKindV1::Claimed
        || state.claim_identity != claim.claim_identity
        || state.admission_identity != admission_identity
        || state.attempt_identity != attempt_identity
        || state.claim_digest != claim.claim_digest
        || invocation_admission_receipt_digest(admission)
            .map_err(|_| SourceInvocationCustodyError::Unavailable)?
            != admission.receipt_digest
        || invocation_claim_digest(claim).map_err(|_| SourceInvocationCustodyError::Unavailable)?
            != claim.claim_digest
        || invocation_state_digest(state).map_err(|_| SourceInvocationCustodyError::Unavailable)?
            != state.state_digest
        || !valid_outbox(
            &envelope.admission_outbox,
            &admission.receipt_identity,
            &admission.admission_identity,
            "PRODUCT_EDGE_PROVIDER_INVOCATION_ADMITTED_V1",
            &admission,
            admission.write_cut_epoch_ms,
        )?
        || !valid_outbox(
            &envelope.claim_outbox,
            &claim.claim_identity,
            &claim.admission_identity,
            "PRODUCT_EDGE_PROVIDER_INVOCATION_CLAIMED_V1",
            &claim,
            claim.committed_at_epoch_ms,
        )?
        || !valid_claimed_state_outbox(&envelope.claimed_state_outbox, claim)?
        || envelope.current_state_outbox != envelope.claimed_state_outbox
    {
        return Err(SourceInvocationCustodyError::Unavailable);
    }
    Ok(SourceInvocationClaimCustodyV1 {
        request_identity: admission.request_identity.clone(),
        admission_identity: claim.admission_identity.clone(),
        attempt_identity: claim.attempt_identity.clone(),
        claim_identity: claim.claim_identity.clone(),
        claim_digest: claim.claim_digest.clone(),
        invocation_admission_receipt_identity: claim.invocation_admission_receipt_identity.clone(),
        invocation_admission_receipt_digest: claim.invocation_admission_receipt_digest.clone(),
        claimed_state_digest: state.state_digest.clone(),
    })
}

#[derive(Debug, Clone, Copy)]
pub struct SourceInvocationReservationMeaningV1<'a> {
    pub request_identity: &'a str,
    pub binding_identity: &'a str,
    pub binding_commit_identity: &'a str,
    pub admission_identity: &'a str,
    pub attempt_identity: &'a str,
    pub claim_identity: &'a str,
    pub claim_digest: &'a str,
    pub invocation_admission_receipt_identity: &'a str,
    pub invocation_admission_receipt_digest: &'a str,
    pub claimed_state_digest: &'a str,
    pub reserved_at_epoch_ms: u64,
}

#[derive(Serialize)]
struct CanonicalReservationMeaningV1<'a> {
    schema_version: u32,
    request_identity: &'a str,
    binding_identity: &'a str,
    binding_commit_identity: &'a str,
    admission_identity: &'a str,
    attempt_identity: &'a str,
    claim_identity: &'a str,
    claim_digest: &'a str,
    invocation_admission_receipt_identity: &'a str,
    invocation_admission_receipt_digest: &'a str,
    claimed_state_digest: &'a str,
    reserved_at_epoch_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SourceInvocationReservationSealV1 {
    reservation_identity: String,
    reservation_digest: String,
}

impl SourceInvocationReservationSealV1 {
    pub fn reservation_identity(&self) -> &str {
        &self.reservation_identity
    }
    pub fn reservation_digest(&self) -> &str {
        &self.reservation_digest
    }
}

pub fn seal_source_invocation_reservation(
    meaning: SourceInvocationReservationMeaningV1<'_>,
) -> Result<SourceInvocationReservationSealV1, SourceInvocationCustodyError> {
    if meaning.request_identity.trim().is_empty()
        || meaning.binding_identity.trim().is_empty()
        || meaning.binding_commit_identity.trim().is_empty()
        || meaning.admission_identity.trim().is_empty()
        || meaning.attempt_identity.trim().is_empty()
        || meaning.claim_identity.trim().is_empty()
        || meaning.claim_digest.trim().is_empty()
        || meaning
            .invocation_admission_receipt_identity
            .trim()
            .is_empty()
        || meaning
            .invocation_admission_receipt_digest
            .trim()
            .is_empty()
        || meaning.claimed_state_digest.trim().is_empty()
        || meaning.reserved_at_epoch_ms == 0
    {
        return Err(SourceInvocationCustodyError::Unavailable);
    }
    let bytes = serde_json::to_vec(&CanonicalReservationMeaningV1 {
        schema_version: 1,
        request_identity: meaning.request_identity,
        binding_identity: meaning.binding_identity,
        binding_commit_identity: meaning.binding_commit_identity,
        admission_identity: meaning.admission_identity,
        attempt_identity: meaning.attempt_identity,
        claim_identity: meaning.claim_identity,
        claim_digest: meaning.claim_digest,
        invocation_admission_receipt_identity: meaning.invocation_admission_receipt_identity,
        invocation_admission_receipt_digest: meaning.invocation_admission_receipt_digest,
        claimed_state_digest: meaning.claimed_state_digest,
        reserved_at_epoch_ms: meaning.reserved_at_epoch_ms,
    })
    .map_err(storage)?;
    let reservation_digest = format!("sha256:{:x}", Sha256::digest(bytes));
    let reservation_identity = format!(
        "rd-source-invocation-reservation-v1-{}",
        reservation_digest.trim_start_matches("sha256:")
    );
    Ok(SourceInvocationReservationSealV1 {
        reservation_identity,
        reservation_digest,
    })
}

/// Move-only locator for an exact R&D invocation reservation. Positive custody
/// has no public constructor and cannot be deserialized.
#[derive(Debug, PartialEq, Eq)]
pub struct SourceInvocationStartReservationV1 {
    request_identity: String,
    binding_identity: String,
    binding_commit_identity: String,
    admission_identity: String,
    attempt_identity: String,
    claim_identity: String,
    claim_digest: String,
    invocation_admission_receipt_identity: String,
    invocation_admission_receipt_digest: String,
    claimed_state_digest: String,
    reservation_identity: String,
    reservation_digest: String,
    reserved_at_epoch_ms: u64,
}

impl SourceInvocationStartReservationV1 {
    pub fn request_identity(&self) -> &str {
        &self.request_identity
    }
    pub fn admission_identity(&self) -> &str {
        &self.admission_identity
    }
    pub fn attempt_identity(&self) -> &str {
        &self.attempt_identity
    }
    pub fn claim_identity(&self) -> &str {
        &self.claim_identity
    }
    pub fn claim_digest(&self) -> &str {
        &self.claim_digest
    }
}

pub async fn verify_source_invocation_start_reservation_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    reservation: &SourceInvocationStartReservationV1,
) -> Result<(), SourceInvocationCustodyError> {
    let verified = resolve_source_invocation_start_reservation_in_transaction(
        transaction,
        &reservation.request_identity,
        &reservation.attempt_identity,
        &reservation.claim_identity,
        &reservation.reservation_identity,
        &reservation.reservation_digest,
    )
    .await?;

    if &verified != reservation {
        return Err(SourceInvocationCustodyError::Unavailable);
    }
    Ok(())
}

/// Canonical started state returned only through the Product Edge locked read
/// port. Terminal R&D custody binds this digest rather than caller JSON.
#[derive(Debug, PartialEq, Eq, Serialize)]
pub struct SourceInvocationStartedCustodyV1 {
    request_identity: String,
    admission_identity: String,
    attempt_identity: String,
    claim_identity: String,
    claim_digest: String,
    invocation_admission_receipt_identity: String,
    invocation_admission_receipt_digest: String,
    claimed_state_digest: String,
    started_state_digest: String,
    started_at_epoch_ms: u64,
}

impl SourceInvocationStartedCustodyV1 {
    pub fn request_identity(&self) -> &str {
        &self.request_identity
    }
    pub fn admission_identity(&self) -> &str {
        &self.admission_identity
    }
    pub fn attempt_identity(&self) -> &str {
        &self.attempt_identity
    }
    pub fn claim_identity(&self) -> &str {
        &self.claim_identity
    }
    pub fn claim_digest(&self) -> &str {
        &self.claim_digest
    }
    pub fn invocation_admission_receipt_identity(&self) -> &str {
        &self.invocation_admission_receipt_identity
    }
    pub fn invocation_admission_receipt_digest(&self) -> &str {
        &self.invocation_admission_receipt_digest
    }
    pub fn claimed_state_digest(&self) -> &str {
        &self.claimed_state_digest
    }
    pub fn started_state_digest(&self) -> &str {
        &self.started_state_digest
    }
    pub fn started_at_epoch_ms(&self) -> u64 {
        self.started_at_epoch_ms
    }
}

pub async fn resolve_source_invocation_started_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    request_identity: &str,
    admission_identity: &str,
    attempt_identity: &str,
) -> Result<SourceInvocationStartedCustodyV1, SourceInvocationCustodyError> {
    let value: Option<serde_json::Value> =
        sqlx::query_scalar("SELECT product_edge_api.lock_source_invocation_started_v1($1,$2,$3)")
            .bind(request_identity)
            .bind(admission_identity)
            .bind(attempt_identity)
            .fetch_one(&mut **transaction)
            .await
            .map_err(storage)?;
    let envelope: LockedClaimEnvelopeV1 =
        serde_json::from_value(value.ok_or(SourceInvocationCustodyError::Unavailable)?)
            .map_err(|_| SourceInvocationCustodyError::Unavailable)?;
    let admission = &envelope.admission.receipt_json;
    let claim = &envelope.claim.claim_json;
    let state = &envelope.state.state_json;
    if envelope.schema_version != 1
        || admission.schema_version != 1
        || claim.schema_version != 1
        || state.schema_version != 1
        || !valid_admission_columns(&envelope.admission)
        || !valid_claim_columns(&envelope.claim)
        || !valid_state_columns(&envelope.state)
        || admission.request_identity != request_identity
        || admission.admission_identity != admission_identity
        || admission.attempt_identity != attempt_identity
        || admission.effect != SOURCE_PROVIDER_EFFECT_V1
        || claim.admission_identity != admission_identity
        || claim.attempt_identity != attempt_identity
        || claim.claim_identity != admission.claim_identity
        || claim.invocation_admission_receipt_identity != admission.receipt_identity
        || claim.invocation_admission_receipt_digest != admission.receipt_digest
        || state.state != StoredInvocationStateKindV1::InvocationStarted
        || state.claim_identity != claim.claim_identity
        || state.admission_identity != admission_identity
        || state.attempt_identity != attempt_identity
        || state.claim_digest != claim.claim_digest
        || invocation_admission_receipt_digest(admission)
            .map_err(|_| SourceInvocationCustodyError::Unavailable)?
            != admission.receipt_digest
        || invocation_claim_digest(claim).map_err(|_| SourceInvocationCustodyError::Unavailable)?
            != claim.claim_digest
        || invocation_state_digest(state).map_err(|_| SourceInvocationCustodyError::Unavailable)?
            != state.state_digest
        || !valid_outbox(
            &envelope.admission_outbox,
            &admission.receipt_identity,
            &admission.admission_identity,
            "PRODUCT_EDGE_PROVIDER_INVOCATION_ADMITTED_V1",
            &admission,
            admission.write_cut_epoch_ms,
        )?
        || !valid_outbox(
            &envelope.claim_outbox,
            &claim.claim_identity,
            &claim.admission_identity,
            "PRODUCT_EDGE_PROVIDER_INVOCATION_CLAIMED_V1",
            &claim,
            claim.committed_at_epoch_ms,
        )?
        || !valid_claimed_state_outbox(&envelope.claimed_state_outbox, claim)?
        || !valid_outbox(
            &envelope.current_state_outbox,
            &state.state_digest,
            &state.claim_identity,
            "PRODUCT_EDGE_PROVIDER_INVOCATION_STARTED_V1",
            &state,
            state.updated_at_epoch_ms,
        )?
    {
        return Err(SourceInvocationCustodyError::Unavailable);
    }
    let claimed_state_digest = claimed_state_digest(claim)?;
    Ok(SourceInvocationStartedCustodyV1 {
        request_identity: admission.request_identity.clone(),
        admission_identity: claim.admission_identity.clone(),
        attempt_identity: claim.attempt_identity.clone(),
        claim_identity: claim.claim_identity.clone(),
        claim_digest: claim.claim_digest.clone(),
        invocation_admission_receipt_identity: claim.invocation_admission_receipt_identity.clone(),
        invocation_admission_receipt_digest: claim.invocation_admission_receipt_digest.clone(),
        claimed_state_digest,
        started_state_digest: state.state_digest.clone(),
        started_at_epoch_ms: state.updated_at_epoch_ms,
    })
}

fn valid_admission_columns(locked: &LockedInvocationAdmissionV1) -> bool {
    let admission = &locked.receipt_json;
    locked.receipt_identity == admission.receipt_identity
        && locked.receipt_digest == admission.receipt_digest
        && locked.admission_identity == admission.admission_identity
        && locked.attempt_identity == admission.attempt_identity
        && locked.claim_identity == admission.claim_identity
        && locked.write_cut_epoch_ms == admission.write_cut_epoch_ms
}

fn valid_claim_columns(locked: &LockedInvocationClaimV1) -> bool {
    let claim = &locked.claim_json;
    locked.admission_identity == claim.admission_identity
        && locked.claim_identity == claim.claim_identity
        && locked.attempt_identity == claim.attempt_identity
        && locked.claim_digest == claim.claim_digest
        && locked.committed_at_epoch_ms == claim.committed_at_epoch_ms
}

fn valid_state_columns(locked: &LockedInvocationStateV1) -> bool {
    let state = &locked.state_json;
    locked.claim_identity == state.claim_identity
        && locked.admission_identity == state.admission_identity
        && locked.attempt_identity == state.attempt_identity
        && locked.claim_digest == state.claim_digest
        && locked.state_digest == state.state_digest
        && locked.updated_at_epoch_ms == state.updated_at_epoch_ms
}

fn valid_claimed_state_outbox(
    outbox: &LockedOutboxV1,
    claim: &StoredInvocationClaimV1,
) -> Result<bool, SourceInvocationCustodyError> {
    let state_digest = claimed_state_digest(claim)?;
    let mut state = StoredInvocationStateV1 {
        schema_version: claim.schema_version,
        claim_identity: claim.claim_identity.clone(),
        admission_identity: claim.admission_identity.clone(),
        attempt_identity: claim.attempt_identity.clone(),
        claim_digest: claim.claim_digest.clone(),
        state: StoredInvocationStateKindV1::Claimed,
        state_digest: String::new(),
        updated_at_epoch_ms: claim.committed_at_epoch_ms,
    };
    state.state_digest = state_digest;
    valid_outbox(
        outbox,
        &state.state_digest,
        &state.claim_identity,
        "PRODUCT_EDGE_PROVIDER_INVOCATION_CLAIM_STATE_V1",
        &state,
        state.updated_at_epoch_ms,
    )
}

fn claimed_state_digest(
    claim: &StoredInvocationClaimV1,
) -> Result<String, SourceInvocationCustodyError> {
    invocation_state_digest(&StoredInvocationStateV1 {
        schema_version: claim.schema_version,
        claim_identity: claim.claim_identity.clone(),
        admission_identity: claim.admission_identity.clone(),
        attempt_identity: claim.attempt_identity.clone(),
        claim_digest: claim.claim_digest.clone(),
        state: StoredInvocationStateKindV1::Claimed,
        state_digest: String::new(),
        updated_at_epoch_ms: claim.committed_at_epoch_ms,
    })
    .map_err(|_| SourceInvocationCustodyError::Unavailable)
}

fn valid_outbox<T: Serialize>(
    outbox: &LockedOutboxV1,
    seed: &str,
    aggregate: &str,
    kind: &str,
    payload: &T,
    committed_at_epoch_ms: u64,
) -> Result<bool, SourceInvocationCustodyError> {
    let bytes = serde_json::to_vec(payload).map_err(storage)?;
    let mut hash = Sha256::new();
    let domain = "product-edge.outbox-payload.v1";
    hash.update((domain.len() as u64).to_be_bytes());
    hash.update(domain.as_bytes());
    hash.update((bytes.len() as u64).to_be_bytes());
    hash.update(bytes);
    let payload_digest = format!("sha256:{:x}", hash.finalize());
    let event_identity = invocation_identity(
        "product-edge-owner-event-v1",
        &[
            seed,
            aggregate,
            kind,
            &payload_digest,
            &committed_at_epoch_ms.to_string(),
        ],
    );
    let expected_json = StoredOutboxV1 {
        schema_version: 1,
        event_identity: event_identity.clone(),
        aggregate_identity: aggregate.to_string(),
        event_kind: kind.to_string(),
        payload_digest: payload_digest.clone(),
        committed_at_epoch_ms,
    };
    Ok(outbox.event_identity == event_identity
        && outbox.aggregate_identity == aggregate
        && outbox.event_kind == kind
        && outbox.payload_digest == payload_digest
        && outbox.committed_at_epoch_ms == committed_at_epoch_ms
        && outbox.payload_json == expected_json)
}

fn invocation_identity(domain: &str, parts: &[&str]) -> String {
    let mut hash = Sha256::new();
    hash.update((domain.len() as u64).to_be_bytes());
    hash.update(domain.as_bytes());
    for part in parts {
        hash.update((part.len() as u64).to_be_bytes());
        hash.update(part.as_bytes());
    }
    format!("{}-{:x}", domain.replace('.', "-"), hash.finalize())
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct LockedReservationEnvelopeV1 {
    schema_version: u32,
    request_identity: String,
    binding_identity: String,
    binding_commit_identity: String,
    admission_identity: String,
    attempt_identity: String,
    claim_identity: String,
    claim_digest: String,
    invocation_admission_receipt_identity: String,
    invocation_admission_receipt_digest: String,
    claimed_state_digest: String,
    reservation_identity: String,
    reservation_digest: String,
    reserved_at_epoch_ms: u64,
}

pub async fn resolve_source_invocation_start_reservation_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    request_identity: &str,
    attempt_identity: &str,
    claim_identity: &str,
    reservation_identity: &str,
    reservation_digest: &str,
) -> Result<SourceInvocationStartReservationV1, SourceInvocationCustodyError> {
    let value: Option<serde_json::Value> = sqlx::query_scalar(
        "SELECT rd_owner_api.lock_source_invocation_reservation_v1($1,$2,$3,$4,$5)",
    )
    .bind(request_identity)
    .bind(attempt_identity)
    .bind(claim_identity)
    .bind(reservation_identity)
    .bind(reservation_digest)
    .fetch_one(&mut **transaction)
    .await
    .map_err(storage)?;
    let envelope: LockedReservationEnvelopeV1 =
        serde_json::from_value(value.ok_or(SourceInvocationCustodyError::Unavailable)?)
            .map_err(|_| SourceInvocationCustodyError::Unavailable)?;
    let seal = seal_source_invocation_reservation(SourceInvocationReservationMeaningV1 {
        request_identity: &envelope.request_identity,
        binding_identity: &envelope.binding_identity,
        binding_commit_identity: &envelope.binding_commit_identity,
        admission_identity: &envelope.admission_identity,
        attempt_identity: &envelope.attempt_identity,
        claim_identity: &envelope.claim_identity,
        claim_digest: &envelope.claim_digest,
        invocation_admission_receipt_identity: &envelope.invocation_admission_receipt_identity,
        invocation_admission_receipt_digest: &envelope.invocation_admission_receipt_digest,
        claimed_state_digest: &envelope.claimed_state_digest,
        reserved_at_epoch_ms: envelope.reserved_at_epoch_ms,
    })?;

    if envelope.schema_version != 1
        || envelope.request_identity != request_identity
        || envelope.attempt_identity != attempt_identity
        || envelope.claim_identity != claim_identity
        || envelope.reservation_identity != reservation_identity
        || envelope.reservation_digest != reservation_digest
        || seal.reservation_identity() != reservation_identity
        || seal.reservation_digest() != reservation_digest
    {
        return Err(SourceInvocationCustodyError::Unavailable);
    }
    Ok(SourceInvocationStartReservationV1 {
        request_identity: envelope.request_identity,
        binding_identity: envelope.binding_identity,
        binding_commit_identity: envelope.binding_commit_identity,
        admission_identity: envelope.admission_identity,
        attempt_identity: envelope.attempt_identity,
        claim_identity: envelope.claim_identity,
        claim_digest: envelope.claim_digest,
        invocation_admission_receipt_identity: envelope.invocation_admission_receipt_identity,
        invocation_admission_receipt_digest: envelope.invocation_admission_receipt_digest,
        claimed_state_digest: envelope.claimed_state_digest,
        reservation_identity: envelope.reservation_identity,
        reservation_digest: envelope.reservation_digest,
        reserved_at_epoch_ms: envelope.reserved_at_epoch_ms,
    })
}

fn storage(error: impl Display) -> SourceInvocationCustodyError {
    SourceInvocationCustodyError::Storage(error.to_string())
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::*;

    fn meaning() -> SourceInvocationReservationMeaningV1<'static> {
        SourceInvocationReservationMeaningV1 {
            request_identity: "request-1",
            binding_identity: "binding-1",
            binding_commit_identity: "binding-commit-1",
            admission_identity: "admission-1",
            attempt_identity: "attempt-1",
            claim_identity: "claim-1",
            claim_digest: "sha256:claim",
            invocation_admission_receipt_identity: "receipt-1",
            invocation_admission_receipt_digest: "sha256:receipt",
            claimed_state_digest: "sha256:state",
            reserved_at_epoch_ms: 10,
        }
    }

    #[rstest]
    fn reservation_seal_binds_every_cross_owner_coordinate() {
        let original = meaning();
        let original_seal = seal_source_invocation_reservation(original).unwrap();
        let variants = [
            SourceInvocationReservationMeaningV1 {
                request_identity: "request-2",
                ..original
            },
            SourceInvocationReservationMeaningV1 {
                binding_identity: "binding-2",
                ..original
            },
            SourceInvocationReservationMeaningV1 {
                binding_commit_identity: "commit-2",
                ..original
            },
            SourceInvocationReservationMeaningV1 {
                admission_identity: "admission-2",
                ..original
            },
            SourceInvocationReservationMeaningV1 {
                attempt_identity: "attempt-2",
                ..original
            },
            SourceInvocationReservationMeaningV1 {
                claim_identity: "claim-2",
                ..original
            },
            SourceInvocationReservationMeaningV1 {
                claim_digest: "sha256:claim-2",
                ..original
            },
            SourceInvocationReservationMeaningV1 {
                invocation_admission_receipt_identity: "receipt-2",
                ..original
            },
            SourceInvocationReservationMeaningV1 {
                invocation_admission_receipt_digest: "sha256:receipt-2",
                ..original
            },
            SourceInvocationReservationMeaningV1 {
                claimed_state_digest: "sha256:state-2",
                ..original
            },
            SourceInvocationReservationMeaningV1 {
                reserved_at_epoch_ms: 11,
                ..original
            },
        ];

        for changed in variants {
            assert_ne!(
                original_seal,
                seal_source_invocation_reservation(changed).unwrap()
            );
        }
    }

    #[rstest]
    fn started_custody_exposes_the_complete_verified_chain() {
        let custody = SourceInvocationStartedCustodyV1 {
            request_identity: "request-1".into(),
            admission_identity: "admission-1".into(),
            attempt_identity: "attempt-1".into(),
            claim_identity: "claim-1".into(),
            claim_digest: "sha256:claim".into(),
            invocation_admission_receipt_identity: "receipt-1".into(),
            invocation_admission_receipt_digest: "sha256:receipt".into(),
            claimed_state_digest: "sha256:claimed-state".into(),
            started_state_digest: "sha256:started-state".into(),
            started_at_epoch_ms: 10,
        };
        assert_eq!(custody.invocation_admission_receipt_identity(), "receipt-1");
        assert_eq!(
            custody.invocation_admission_receipt_digest(),
            "sha256:receipt"
        );
        assert_eq!(custody.claimed_state_digest(), "sha256:claimed-state");
    }
}
