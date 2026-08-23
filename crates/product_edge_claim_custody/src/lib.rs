//! Canonical storage contracts for Product Edge provider-invocation custody.
//!
//! These stored records are write proposals and persistence codecs, not
//! positive authority. Sealed claim and start custody is issued only by the
//! canonical locked resolver.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{Postgres, Row, Transaction};
use std::fmt::Display;
use thiserror::Error;

const PRODUCT_EDGE_SCHEMA_V1: u32 = 1;
const INVOCATION_ADMISSION_EVENT: &str = "PRODUCT_EDGE_PROVIDER_INVOCATION_ADMITTED_V1";
const INVOCATION_CLAIM_EVENT: &str = "PRODUCT_EDGE_PROVIDER_INVOCATION_CLAIMED_V1";
const INVOCATION_CLAIM_STATE_EVENT: &str = "PRODUCT_EDGE_PROVIDER_INVOCATION_CLAIM_STATE_V1";
const INVOCATION_STARTED_EVENT: &str = "PRODUCT_EDGE_PROVIDER_INVOCATION_STARTED_V1";

#[derive(Debug, Error)]
pub enum ProductEdgeClaimCustodyError {
    #[error("Product Edge claim custody encoding unavailable: {0}")]
    Encoding(String),
    #[error("Product Edge claim custody unavailable")]
    Unavailable,
    #[error("Product Edge claim custody storage unavailable: {0}")]
    Storage(String),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StoredInvocationClaimV1 {
    pub schema_version: u32,
    pub claim_identity: String,
    pub admission_identity: String,
    pub attempt_identity: String,
    pub invocation_admission_receipt_identity: String,
    pub invocation_admission_receipt_digest: String,
    pub claim_digest: String,
    pub committed_at_epoch_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StoredInvocationAdmissionReceiptV1 {
    pub schema_version: u32,
    pub receipt_identity: String,
    pub receipt_digest: String,
    pub request_identity: String,
    pub admission_identity: String,
    pub admission_digest: String,
    pub historical_binding_identity: String,
    pub historical_binding_generation: u64,
    pub historical_authorization_identity: String,
    pub historical_issuance_receipt_identity: String,
    pub historical_authorization_frontier_identity: String,
    pub current_binding_identity: String,
    pub current_binding_generation: u64,
    pub current_authorization_identity: String,
    pub current_issuance_receipt_identity: String,
    pub current_authorization_frontier_identity: String,
    pub current_authorization_not_before_epoch_ms: u64,
    pub current_authorization_valid_through_epoch_ms: u64,
    pub current_binding_valid_from_epoch_ms: u64,
    pub current_binding_valid_through_epoch_ms: u64,
    pub effective_principal: String,
    pub authorized_scope: Vec<String>,
    pub scope_policy_version: String,
    pub capability_policy_version: String,
    pub audit_policy_version: String,
    pub manifest_identity: String,
    pub manifest_digest: String,
    pub manifest_effective_from_epoch_ms: u64,
    pub manifest_valid_through_epoch_ms: u64,
    pub attempt_identity: String,
    pub effect: String,
    pub claim_identity: String,
    pub write_cut_epoch_ms: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum StoredInvocationStateKindV1 {
    Claimed,
    InvocationStarted,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StoredInvocationStateV1 {
    pub schema_version: u32,
    pub claim_identity: String,
    pub admission_identity: String,
    pub attempt_identity: String,
    pub claim_digest: String,
    pub state: StoredInvocationStateKindV1,
    pub state_digest: String,
    pub updated_at_epoch_ms: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ProductEdgeInvocationStateV1 {
    Claimed,
    InvocationStarted,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ProductEdgeInvocationNextLegalActionV1 {
    RunBoundedExecutionAgent,
    ManuallyReconcileProviderInvocation,
}

/// Canonically resolved Product Edge provider-invocation claim custody.
///
/// Positive custody cannot be deserialized or constructed by callers.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ProductEdgeInvocationClaimCustodyV1 {
    schema_version: u32,
    request_identity: String,
    claim_identity: String,
    admission_identity: String,
    attempt_identity: String,
    invocation_admission_receipt_identity: String,
    invocation_admission_receipt_digest: String,
    claim_digest: String,
    #[serde(skip)]
    claimed_state_digest: String,
    state_digest: String,
    committed_at_epoch_ms: u64,
    #[serde(skip)]
    state: ProductEdgeInvocationStateV1,
}

impl ProductEdgeInvocationClaimCustodyV1 {
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
    pub fn claimed_state_digest(&self) -> &str {
        &self.claimed_state_digest
    }
    pub fn invocation_admission_receipt_identity(&self) -> &str {
        &self.invocation_admission_receipt_identity
    }
    pub fn invocation_admission_receipt_digest(&self) -> &str {
        &self.invocation_admission_receipt_digest
    }
    pub fn state_digest(&self) -> &str {
        &self.state_digest
    }
    pub fn state(&self) -> ProductEdgeInvocationStateV1 {
        self.state
    }
    pub fn next_legal_action(&self) -> ProductEdgeInvocationNextLegalActionV1 {
        match self.state {
            ProductEdgeInvocationStateV1::Claimed => {
                ProductEdgeInvocationNextLegalActionV1::RunBoundedExecutionAgent
            }
            ProductEdgeInvocationStateV1::InvocationStarted => {
                ProductEdgeInvocationNextLegalActionV1::ManuallyReconcileProviderInvocation
            }
        }
    }
}

/// Canonically resolved Product Edge provider-invocation start custody.
///
/// Positive custody cannot be deserialized or constructed by callers.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ProductEdgeInvocationStartCustodyV1 {
    schema_version: u32,
    request_identity: String,
    claim_identity: String,
    admission_identity: String,
    attempt_identity: String,
    claim_digest: String,
    state_digest: String,
    started_at_epoch_ms: u64,
}

impl ProductEdgeInvocationStartCustodyV1 {
    pub fn state_digest(&self) -> &str {
        &self.state_digest
    }
}

pub fn invocation_claim_digest(
    stored: &StoredInvocationClaimV1,
) -> Result<String, ProductEdgeClaimCustodyError> {
    let mut meaning = stored.clone();
    meaning.claim_digest.clear();
    canonical_digest("product-edge.provider-invocation-claim.v1", &meaning)
}

pub fn invocation_admission_receipt_digest(
    stored: &StoredInvocationAdmissionReceiptV1,
) -> Result<String, ProductEdgeClaimCustodyError> {
    let mut meaning = stored.clone();
    meaning.receipt_digest.clear();
    canonical_digest(
        "product-edge.provider-invocation-admission-receipt.v1",
        &meaning,
    )
}

pub fn invocation_state_digest(
    stored: &StoredInvocationStateV1,
) -> Result<String, ProductEdgeClaimCustodyError> {
    let mut meaning = stored.clone();
    meaning.state_digest.clear();
    canonical_digest("product-edge.provider-invocation-state.v1", &meaning)
}

fn canonical_digest<T: Serialize>(
    domain: &str,
    value: &T,
) -> Result<String, ProductEdgeClaimCustodyError> {
    let bytes = serde_json::to_vec(value)
        .map_err(|e| ProductEdgeClaimCustodyError::Encoding(e.to_string()))?;
    let mut hash = Sha256::new();
    hash.update((domain.len() as u64).to_be_bytes());
    hash.update(domain.as_bytes());
    hash.update((bytes.len() as u64).to_be_bytes());
    hash.update(bytes);
    Ok(format!("sha256:{:x}", hash.finalize()))
}

pub async fn load_invocation_admission_receipt(
    transaction: &mut Transaction<'_, Postgres>,
    claim_identity: &str,
) -> Result<Option<StoredInvocationAdmissionReceiptV1>, ProductEdgeClaimCustodyError> {
    let rows = sqlx::query("SELECT receipt_identity, receipt_digest, admission_identity, attempt_identity, claim_identity, receipt_json, write_cut_epoch_ms FROM product_edge_effect_invocation_admissions_v1 WHERE claim_identity=$1 FOR UPDATE")
        .bind(claim_identity)
        .fetch_all(&mut **transaction)
        .await
        .map_err(storage)?;

    if rows.len() > 1 {
        return Err(ProductEdgeClaimCustodyError::Unavailable);
    }
    let Some(row) = rows.first() else {
        return Ok(None);
    };
    let stored: StoredInvocationAdmissionReceiptV1 =
        from_json(row.try_get("receipt_json").map_err(storage)?)?;

    if stored.schema_version != PRODUCT_EDGE_SCHEMA_V1
        || stored.receipt_identity
            != row
                .try_get::<String, _>("receipt_identity")
                .map_err(storage)?
        || stored.receipt_digest
            != row
                .try_get::<String, _>("receipt_digest")
                .map_err(storage)?
        || stored.admission_identity
            != row
                .try_get::<String, _>("admission_identity")
                .map_err(storage)?
        || stored.attempt_identity
            != row
                .try_get::<String, _>("attempt_identity")
                .map_err(storage)?
        || stored.claim_identity
            != row
                .try_get::<String, _>("claim_identity")
                .map_err(storage)?
        || stored.write_cut_epoch_ms
            != from_i64(row.try_get("write_cut_epoch_ms").map_err(storage)?)?
        || invocation_admission_receipt_digest(&stored)? != stored.receipt_digest
        || stored.current_binding_identity.is_empty()
        || stored.current_binding_generation < stored.historical_binding_generation
        || stored.current_authorization_identity.is_empty()
        || stored.current_issuance_receipt_identity.is_empty()
        || stored.current_authorization_frontier_identity.is_empty()
        || stored.write_cut_epoch_ms < stored.current_authorization_not_before_epoch_ms
        || stored.write_cut_epoch_ms >= stored.current_authorization_valid_through_epoch_ms
        || !authority_windows_are_current_at(
            stored.write_cut_epoch_ms,
            stored.current_binding_valid_from_epoch_ms,
            stored.current_binding_valid_through_epoch_ms,
            stored.manifest_effective_from_epoch_ms,
            stored.manifest_valid_through_epoch_ms,
        )
    {
        return Err(ProductEdgeClaimCustodyError::Unavailable);
    }
    verify_outbox(
        transaction,
        &stored.receipt_identity,
        &stored.admission_identity,
        INVOCATION_ADMISSION_EVENT,
        &stored,
        stored.write_cut_epoch_ms,
    )
    .await?;
    Ok(Some(stored))
}

pub async fn load_invocation_claim(
    transaction: &mut Transaction<'_, Postgres>,
    admission_identity: &str,
) -> Result<Option<StoredInvocationClaimV1>, ProductEdgeClaimCustodyError> {
    let rows = sqlx::query("SELECT admission_identity, claim_identity, attempt_identity, claim_digest, claim_json, committed_at_epoch_ms FROM product_edge_effect_invocation_claims_v1 WHERE admission_identity=$1 FOR UPDATE")
        .bind(admission_identity)
        .fetch_all(&mut **transaction)
        .await
        .map_err(storage)?;

    if rows.len() > 1 {
        return Err(ProductEdgeClaimCustodyError::Unavailable);
    }
    let Some(row) = rows.first() else {
        return Ok(None);
    };
    let stored: StoredInvocationClaimV1 = from_json(row.try_get("claim_json").map_err(storage)?)?;
    if stored.schema_version != PRODUCT_EDGE_SCHEMA_V1
        || stored.admission_identity
            != row
                .try_get::<String, _>("admission_identity")
                .map_err(storage)?
        || stored.claim_identity
            != row
                .try_get::<String, _>("claim_identity")
                .map_err(storage)?
        || stored.attempt_identity
            != row
                .try_get::<String, _>("attempt_identity")
                .map_err(storage)?
        || stored.claim_digest != row.try_get::<String, _>("claim_digest").map_err(storage)?
        || stored.committed_at_epoch_ms
            != from_i64(row.try_get("committed_at_epoch_ms").map_err(storage)?)?
        || invocation_claim_digest(&stored)? != stored.claim_digest
    {
        return Err(ProductEdgeClaimCustodyError::Unavailable);
    }
    let receipt = load_invocation_admission_receipt(transaction, &stored.claim_identity)
        .await?
        .ok_or(ProductEdgeClaimCustodyError::Unavailable)?;

    if receipt.receipt_identity != stored.invocation_admission_receipt_identity
        || receipt.receipt_digest != stored.invocation_admission_receipt_digest
        || receipt.admission_identity != stored.admission_identity
        || receipt.attempt_identity != stored.attempt_identity
        || receipt.claim_identity != stored.claim_identity
        || receipt.write_cut_epoch_ms != stored.committed_at_epoch_ms
    {
        return Err(ProductEdgeClaimCustodyError::Unavailable);
    }
    verify_outbox(
        transaction,
        &stored.claim_identity,
        &stored.admission_identity,
        INVOCATION_CLAIM_EVENT,
        &stored,
        stored.committed_at_epoch_ms,
    )
    .await?;
    Ok(Some(stored))
}

pub async fn load_invocation_state(
    transaction: &mut Transaction<'_, Postgres>,
    claim_identity: &str,
) -> Result<Option<StoredInvocationStateV1>, ProductEdgeClaimCustodyError> {
    let rows = sqlx::query("SELECT claim_identity, admission_identity, attempt_identity, claim_digest, state_digest, state_json, updated_at_epoch_ms FROM product_edge_effect_invocation_states_v1 WHERE claim_identity=$1 FOR UPDATE")
        .bind(claim_identity)
        .fetch_all(&mut **transaction)
        .await
        .map_err(storage)?;

    if rows.len() > 1 {
        return Err(ProductEdgeClaimCustodyError::Unavailable);
    }
    let Some(row) = rows.first() else {
        return Ok(None);
    };
    let stored: StoredInvocationStateV1 = from_json(row.try_get("state_json").map_err(storage)?)?;
    if stored.schema_version != PRODUCT_EDGE_SCHEMA_V1
        || stored.claim_identity
            != row
                .try_get::<String, _>("claim_identity")
                .map_err(storage)?
        || stored.admission_identity
            != row
                .try_get::<String, _>("admission_identity")
                .map_err(storage)?
        || stored.attempt_identity
            != row
                .try_get::<String, _>("attempt_identity")
                .map_err(storage)?
        || stored.claim_digest != row.try_get::<String, _>("claim_digest").map_err(storage)?
        || stored.state_digest != row.try_get::<String, _>("state_digest").map_err(storage)?
        || stored.updated_at_epoch_ms
            != from_i64(row.try_get("updated_at_epoch_ms").map_err(storage)?)?
        || invocation_state_digest(&stored)? != stored.state_digest
    {
        return Err(ProductEdgeClaimCustodyError::Unavailable);
    }
    let (event_kind, event_time) = match stored.state {
        StoredInvocationStateKindV1::Claimed => {
            (INVOCATION_CLAIM_STATE_EVENT, stored.updated_at_epoch_ms)
        }
        StoredInvocationStateKindV1::InvocationStarted => {
            (INVOCATION_STARTED_EVENT, stored.updated_at_epoch_ms)
        }
    };
    verify_outbox(
        transaction,
        &stored.state_digest,
        &stored.claim_identity,
        event_kind,
        &stored,
        event_time,
    )
    .await?;
    Ok(Some(stored))
}

pub async fn resolve_invocation_claim_custody(
    transaction: &mut Transaction<'_, Postgres>,
    admission_identity: &str,
) -> Result<Option<ProductEdgeInvocationClaimCustodyV1>, ProductEdgeClaimCustodyError> {
    let Some(claim) = load_invocation_claim(transaction, admission_identity).await? else {
        return Ok(None);
    };
    let receipt = load_invocation_admission_receipt(transaction, &claim.claim_identity)
        .await?
        .ok_or(ProductEdgeClaimCustodyError::Unavailable)?;
    let state = load_invocation_state(transaction, &claim.claim_identity)
        .await?
        .ok_or(ProductEdgeClaimCustodyError::Unavailable)?;

    if state.admission_identity != claim.admission_identity
        || state.attempt_identity != claim.attempt_identity
        || state.claim_digest != claim.claim_digest
    {
        return Err(ProductEdgeClaimCustodyError::Unavailable);
    }
    let mut claimed_state = StoredInvocationStateV1 {
        schema_version: claim.schema_version,
        claim_identity: claim.claim_identity.clone(),
        admission_identity: claim.admission_identity.clone(),
        attempt_identity: claim.attempt_identity.clone(),
        claim_digest: claim.claim_digest.clone(),
        state: StoredInvocationStateKindV1::Claimed,
        state_digest: String::new(),
        updated_at_epoch_ms: claim.committed_at_epoch_ms,
    };
    claimed_state.state_digest = invocation_state_digest(&claimed_state)?;
    verify_outbox(
        transaction,
        &claimed_state.state_digest,
        &claimed_state.claim_identity,
        INVOCATION_CLAIM_STATE_EVENT,
        &claimed_state,
        claimed_state.updated_at_epoch_ms,
    )
    .await?;

    if state.state == StoredInvocationStateKindV1::Claimed && state != claimed_state {
        return Err(ProductEdgeClaimCustodyError::Unavailable);
    }
    Ok(Some(ProductEdgeInvocationClaimCustodyV1 {
        schema_version: claim.schema_version,
        request_identity: receipt.request_identity,
        claim_identity: claim.claim_identity,
        admission_identity: claim.admission_identity,
        attempt_identity: claim.attempt_identity,
        invocation_admission_receipt_identity: claim.invocation_admission_receipt_identity,
        invocation_admission_receipt_digest: claim.invocation_admission_receipt_digest,
        claim_digest: claim.claim_digest,
        claimed_state_digest: claimed_state.state_digest,
        state_digest: state.state_digest,
        committed_at_epoch_ms: claim.committed_at_epoch_ms,
        state: match state.state {
            StoredInvocationStateKindV1::Claimed => ProductEdgeInvocationStateV1::Claimed,
            StoredInvocationStateKindV1::InvocationStarted => {
                ProductEdgeInvocationStateV1::InvocationStarted
            }
        },
    }))
}

pub async fn resolve_invocation_start_custody(
    transaction: &mut Transaction<'_, Postgres>,
    admission_identity: &str,
) -> Result<Option<ProductEdgeInvocationStartCustodyV1>, ProductEdgeClaimCustodyError> {
    let Some(claim) = load_invocation_claim(transaction, admission_identity).await? else {
        return Ok(None);
    };
    let receipt = load_invocation_admission_receipt(transaction, &claim.claim_identity)
        .await?
        .ok_or(ProductEdgeClaimCustodyError::Unavailable)?;
    let state = load_invocation_state(transaction, &claim.claim_identity)
        .await?
        .ok_or(ProductEdgeClaimCustodyError::Unavailable)?;

    if state.state != StoredInvocationStateKindV1::InvocationStarted
        || state.admission_identity != claim.admission_identity
        || state.attempt_identity != claim.attempt_identity
        || state.claim_digest != claim.claim_digest
    {
        return Err(ProductEdgeClaimCustodyError::Unavailable);
    }
    Ok(Some(ProductEdgeInvocationStartCustodyV1 {
        schema_version: state.schema_version,
        request_identity: receipt.request_identity,
        claim_identity: state.claim_identity,
        admission_identity: state.admission_identity,
        attempt_identity: state.attempt_identity,
        claim_digest: state.claim_digest,
        state_digest: state.state_digest,
        started_at_epoch_ms: state.updated_at_epoch_ms,
    }))
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct StoredOutboxV1 {
    schema_version: u32,
    event_identity: String,
    aggregate_identity: String,
    event_kind: String,
    payload_digest: String,
    committed_at_epoch_ms: u64,
}

async fn verify_outbox<T: Serialize>(
    transaction: &mut Transaction<'_, Postgres>,
    seed: &str,
    aggregate: &str,
    kind: &str,
    payload: &T,
    committed_at: u64,
) -> Result<(), ProductEdgeClaimCustodyError> {
    let payload_digest = canonical_digest("product-edge.outbox-payload.v1", payload)?;
    let event_identity = identity(
        "product-edge-owner-event-v1",
        &[
            seed,
            aggregate,
            kind,
            &payload_digest,
            &committed_at.to_string(),
        ],
    );
    let rows = sqlx::query("SELECT event_identity, aggregate_identity, event_kind, payload_digest, payload_json, committed_at_epoch_ms FROM product_edge_owner_outbox_v1 WHERE aggregate_identity = $1 FOR SHARE")
        .bind(aggregate)
        .fetch_all(&mut **transaction)
        .await
        .map_err(storage)?;
    let matches = rows
        .iter()
        .filter(|row| row.try_get::<String, _>("event_kind").ok().as_deref() == Some(kind))
        .collect::<Vec<_>>();

    if matches.len() != 1 {
        return Err(ProductEdgeClaimCustodyError::Unavailable);
    }
    let row = matches[0];
    let record: StoredOutboxV1 = from_json(row.try_get("payload_json").map_err(storage)?)?;
    let expected = StoredOutboxV1 {
        schema_version: PRODUCT_EDGE_SCHEMA_V1,
        event_identity: event_identity.clone(),
        aggregate_identity: aggregate.to_string(),
        event_kind: kind.to_string(),
        payload_digest: payload_digest.clone(),
        committed_at_epoch_ms: committed_at,
    };

    if record != expected
        || row
            .try_get::<String, _>("event_identity")
            .map_err(storage)?
            != event_identity
        || row
            .try_get::<String, _>("aggregate_identity")
            .map_err(storage)?
            != aggregate
        || row.try_get::<String, _>("event_kind").map_err(storage)? != kind
        || row
            .try_get::<String, _>("payload_digest")
            .map_err(storage)?
            != payload_digest
        || from_i64(row.try_get("committed_at_epoch_ms").map_err(storage)?)? != committed_at
    {
        return Err(ProductEdgeClaimCustodyError::Unavailable);
    }
    Ok(())
}

fn authority_windows_are_current_at(
    cut: u64,
    binding_from: u64,
    binding_through: u64,
    manifest_from: u64,
    manifest_through: u64,
) -> bool {
    binding_from <= cut && cut < binding_through && manifest_from <= cut && cut < manifest_through
}

fn identity(domain: &str, parts: &[&str]) -> String {
    let mut hash = Sha256::new();
    hash.update((domain.len() as u64).to_be_bytes());
    hash.update(domain.as_bytes());
    for part in parts {
        hash.update((part.len() as u64).to_be_bytes());
        hash.update(part.as_bytes());
    }
    format!("{}-{:x}", domain.replace('.', "-"), hash.finalize())
}

fn from_json<T: for<'de> Deserialize<'de>>(
    value: serde_json::Value,
) -> Result<T, ProductEdgeClaimCustodyError> {
    serde_json::from_value(value).map_err(|_| ProductEdgeClaimCustodyError::Unavailable)
}

fn from_i64(value: i64) -> Result<u64, ProductEdgeClaimCustodyError> {
    u64::try_from(value).map_err(|_| ProductEdgeClaimCustodyError::Unavailable)
}

fn storage(error: impl Display) -> ProductEdgeClaimCustodyError {
    ProductEdgeClaimCustodyError::Storage(error.to_string())
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::*;

    #[rstest]
    fn sealed_custody_serialization_binds_request_admission_attempt_and_claim() {
        let claim = ProductEdgeInvocationClaimCustodyV1 {
            schema_version: 1,
            request_identity: "build-1".to_string(),
            claim_identity: "claim-1".to_string(),
            admission_identity: "admission-1".to_string(),
            attempt_identity: "attempt-1".to_string(),
            invocation_admission_receipt_identity: "receipt-1".to_string(),
            invocation_admission_receipt_digest: "sha256:receipt".to_string(),
            claim_digest: "sha256:claim".to_string(),
            claimed_state_digest: "sha256:claimed-state".to_string(),
            state_digest: "sha256:state".to_string(),
            committed_at_epoch_ms: 10,
            state: ProductEdgeInvocationStateV1::Claimed,
        };
        let started = ProductEdgeInvocationStartCustodyV1 {
            schema_version: 1,
            request_identity: "build-1".to_string(),
            claim_identity: "claim-1".to_string(),
            admission_identity: "admission-1".to_string(),
            attempt_identity: "attempt-1".to_string(),
            claim_digest: "sha256:claim".to_string(),
            state_digest: "sha256:started".to_string(),
            started_at_epoch_ms: 11,
        };
        let claimed = serde_json::to_value(claim).unwrap();
        let started = serde_json::to_value(started).unwrap();
        for custody in [&claimed, &started] {
            assert_eq!(custody["schema_version"], 1);
            assert_eq!(custody["request_identity"], "build-1");
            assert_eq!(custody["admission_identity"], "admission-1");
            assert_eq!(custody["attempt_identity"], "attempt-1");
            assert_eq!(custody["claim_identity"], "claim-1");
            assert_eq!(custody["claim_digest"], "sha256:claim");
        }
        assert_eq!(
            claimed["invocation_admission_receipt_identity"],
            "receipt-1"
        );
        assert_eq!(
            claimed["invocation_admission_receipt_digest"],
            "sha256:receipt"
        );
        assert!(claimed.get("state").is_none());
        assert!(claimed.get("claimed_state_digest").is_none());
    }
}
