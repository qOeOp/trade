//! Canonical R&D custody for one Product Edge provider invocation reservation.

use std::fmt::Display;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{Postgres, Transaction};
use thiserror::Error;
use vibe_product_edge_claim_custody::ProductEdgeInvocationClaimCustodyV1;

#[derive(Debug, Error)]
pub enum ArtifactInvocationCustodyError {
    #[error("R&D artifact invocation reservation unavailable")]
    Unavailable,
    #[error("R&D artifact invocation reservation storage unavailable: {0}")]
    Storage(String),
}

/// Complete canonical meaning of one R&D-owned invocation reservation.
#[derive(Debug, Clone, Copy)]
pub struct ArtifactInvocationReservationMeaningV1<'a> {
    pub request_identity: &'a str,
    pub admission_identity: &'a str,
    pub attempt_identity: &'a str,
    pub claim_identity: &'a str,
    pub claim_digest: &'a str,
    pub invocation_admission_receipt_identity: &'a str,
    pub invocation_admission_receipt_digest: &'a str,
    pub claimed_state_digest: &'a str,
    pub execution_custody_digest: &'a str,
    pub reserved_at_epoch_ms: u64,
}

/// Canonical content address for one complete reservation meaning.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ArtifactInvocationReservationSealV1 {
    reservation_identity: String,
    reservation_digest: String,
}

impl ArtifactInvocationReservationSealV1 {
    pub fn reservation_identity(&self) -> &str {
        &self.reservation_identity
    }

    pub fn reservation_digest(&self) -> &str {
        &self.reservation_digest
    }
}

#[derive(Serialize)]
struct CanonicalReservationMeaningV1<'a> {
    schema_version: u32,
    request_identity: &'a str,
    admission_identity: &'a str,
    attempt_identity: &'a str,
    claim_identity: &'a str,
    claim_digest: &'a str,
    invocation_admission_receipt_identity: &'a str,
    invocation_admission_receipt_digest: &'a str,
    claimed_state_digest: &'a str,
    execution_custody_digest: &'a str,
    reserved_at_epoch_ms: u64,
}

/// Seal one complete reservation using the R&D Owner's sole canonical grammar.
pub fn seal_invocation_reservation(
    meaning: ArtifactInvocationReservationMeaningV1<'_>,
) -> Result<ArtifactInvocationReservationSealV1, ArtifactInvocationCustodyError> {
    if meaning.request_identity.trim().is_empty()
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
        || meaning.execution_custody_digest.trim().is_empty()
        || meaning.reserved_at_epoch_ms == 0
    {
        return Err(ArtifactInvocationCustodyError::Unavailable);
    }
    let bytes = serde_json::to_vec(&CanonicalReservationMeaningV1 {
        schema_version: 1,
        request_identity: meaning.request_identity,
        admission_identity: meaning.admission_identity,
        attempt_identity: meaning.attempt_identity,
        claim_identity: meaning.claim_identity,
        claim_digest: meaning.claim_digest,
        invocation_admission_receipt_identity: meaning.invocation_admission_receipt_identity,
        invocation_admission_receipt_digest: meaning.invocation_admission_receipt_digest,
        claimed_state_digest: meaning.claimed_state_digest,
        execution_custody_digest: meaning.execution_custody_digest,
        reserved_at_epoch_ms: meaning.reserved_at_epoch_ms,
    })
    .map_err(storage)?;
    let reservation_digest = format!("sha256:{:x}", Sha256::digest(bytes));
    let reservation_identity = format!(
        "rd-artifact-invocation-reservation-v1-{}",
        reservation_digest.trim_start_matches("sha256:")
    );
    Ok(ArtifactInvocationReservationSealV1 {
        reservation_identity,
        reservation_digest,
    })
}

/// Move-only locator for one canonical R&D invocation reservation.
///
/// The token is neither serializable nor deserializable and has no public
/// constructor. Product Edge must still resolve the canonical R&D row under
/// lock before using it as a start fence.
///
/// ```compile_fail
/// use vibe_rd_artifact_invocation_custody::ArtifactInvocationStartReservationV1;
/// let _: ArtifactInvocationStartReservationV1 = serde_json::from_str("{}").unwrap();
/// ```
#[derive(Debug, PartialEq, Eq)]
pub struct ArtifactInvocationStartReservationV1 {
    build_request_identity: String,
    attempt_identity: String,
    admission_identity: String,
    claim_identity: String,
    claim_digest: String,
    invocation_admission_receipt_identity: String,
    invocation_admission_receipt_digest: String,
    claimed_state_digest: String,
    execution_custody_digest: String,
    reservation_identity: String,
    reservation_digest: String,
    reserved_at_epoch_ms: u64,
}

impl ArtifactInvocationStartReservationV1 {
    pub fn attempt_identity(&self) -> &str {
        &self.attempt_identity
    }
    pub fn admission_identity(&self) -> &str {
        &self.admission_identity
    }
    pub fn claim_identity(&self) -> &str {
        &self.claim_identity
    }
    pub fn claim_digest(&self) -> &str {
        &self.claim_digest
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct LockedReservationEnvelopeV1 {
    schema_version: u32,
    build_request_identity: String,
    attempt_identity: String,
    admission_identity: String,
    claim_identity: String,
    claim_digest: String,
    invocation_admission_receipt_identity: String,
    invocation_admission_receipt_digest: String,
    claimed_state_digest: String,
    execution_custody_digest: String,
    reservation_identity: String,
    reservation_digest: String,
    reserved_at_epoch_ms: u64,
}

pub async fn resolve_invocation_start_reservation_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    build_request_identity: &str,
    attempt_identity: &str,
    claim: &ProductEdgeInvocationClaimCustodyV1,
    reservation_identity: &str,
    reservation_digest: &str,
) -> Result<ArtifactInvocationStartReservationV1, ArtifactInvocationCustodyError> {
    if build_request_identity.trim().is_empty()
        || attempt_identity.trim().is_empty()
        || reservation_identity.trim().is_empty()
        || reservation_digest.trim().is_empty()
        || claim.attempt_identity() != attempt_identity
    {
        return Err(ArtifactInvocationCustodyError::Unavailable);
    }
    let value: Option<serde_json::Value> = sqlx::query_scalar(
        "SELECT rd_owner_api.lock_artifact_invocation_reservation_v1($1,$2,$3,$4,$5)",
    )
    .bind(build_request_identity)
    .bind(attempt_identity)
    .bind(claim.claim_identity())
    .bind(reservation_identity)
    .bind(reservation_digest)
    .fetch_one(&mut **transaction)
    .await
    .map_err(storage)?;
    let envelope: LockedReservationEnvelopeV1 =
        serde_json::from_value(value.ok_or(ArtifactInvocationCustodyError::Unavailable)?)
            .map_err(|_| ArtifactInvocationCustodyError::Unavailable)?;

    if envelope.schema_version != 1
        || envelope.build_request_identity != build_request_identity
        || envelope.attempt_identity != attempt_identity
        || envelope.admission_identity != claim.admission_identity()
        || envelope.claim_identity != claim.claim_identity()
        || envelope.claim_digest != claim.claim_digest()
        || envelope.invocation_admission_receipt_identity
            != claim.invocation_admission_receipt_identity()
        || envelope.invocation_admission_receipt_digest
            != claim.invocation_admission_receipt_digest()
        || envelope.claimed_state_digest != claim.claimed_state_digest()
        || envelope.execution_custody_digest.trim().is_empty()
        || envelope.reservation_identity != reservation_identity
        || envelope.reservation_digest != reservation_digest
    {
        return Err(ArtifactInvocationCustodyError::Unavailable);
    }
    let canonical_seal = seal_invocation_reservation(ArtifactInvocationReservationMeaningV1 {
        request_identity: &envelope.build_request_identity,
        admission_identity: &envelope.admission_identity,
        attempt_identity: &envelope.attempt_identity,
        claim_identity: &envelope.claim_identity,
        claim_digest: &envelope.claim_digest,
        invocation_admission_receipt_identity: &envelope.invocation_admission_receipt_identity,
        invocation_admission_receipt_digest: &envelope.invocation_admission_receipt_digest,
        claimed_state_digest: &envelope.claimed_state_digest,
        execution_custody_digest: &envelope.execution_custody_digest,
        reserved_at_epoch_ms: envelope.reserved_at_epoch_ms,
    })?;

    if canonical_seal.reservation_identity() != envelope.reservation_identity
        || canonical_seal.reservation_digest() != envelope.reservation_digest
    {
        return Err(ArtifactInvocationCustodyError::Unavailable);
    }
    Ok(ArtifactInvocationStartReservationV1 {
        build_request_identity: envelope.build_request_identity,
        attempt_identity: envelope.attempt_identity,
        admission_identity: envelope.admission_identity,
        claim_identity: envelope.claim_identity,
        claim_digest: envelope.claim_digest,
        invocation_admission_receipt_identity: envelope.invocation_admission_receipt_identity,
        invocation_admission_receipt_digest: envelope.invocation_admission_receipt_digest,
        claimed_state_digest: envelope.claimed_state_digest,
        execution_custody_digest: envelope.execution_custody_digest,
        reservation_identity: envelope.reservation_identity,
        reservation_digest: envelope.reservation_digest,
        reserved_at_epoch_ms: envelope.reserved_at_epoch_ms,
    })
}

pub async fn verify_invocation_start_reservation_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    reservation: &ArtifactInvocationStartReservationV1,
    claim: &ProductEdgeInvocationClaimCustodyV1,
) -> Result<(), ArtifactInvocationCustodyError> {
    let verified = resolve_invocation_start_reservation_in_transaction(
        transaction,
        &reservation.build_request_identity,
        &reservation.attempt_identity,
        claim,
        &reservation.reservation_identity,
        &reservation.reservation_digest,
    )
    .await?;

    if &verified != reservation {
        return Err(ArtifactInvocationCustodyError::Unavailable);
    }
    Ok(())
}

fn storage(error: impl Display) -> ArtifactInvocationCustodyError {
    ArtifactInvocationCustodyError::Storage(error.to_string())
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::*;

    fn envelope() -> LockedReservationEnvelopeV1 {
        LockedReservationEnvelopeV1 {
            schema_version: 1,
            build_request_identity: "build-1".to_string(),
            attempt_identity: "attempt-1".to_string(),
            admission_identity: "admission-1".to_string(),
            claim_identity: "claim-1".to_string(),
            claim_digest: "sha256:claim".to_string(),
            invocation_admission_receipt_identity: "receipt-1".to_string(),
            invocation_admission_receipt_digest: "sha256:receipt".to_string(),
            claimed_state_digest: "sha256:state".to_string(),
            execution_custody_digest: "sha256:custody".to_string(),
            reservation_identity: String::new(),
            reservation_digest: String::new(),
            reserved_at_epoch_ms: 10,
        }
    }

    fn seal(envelope: &LockedReservationEnvelopeV1) -> ArtifactInvocationReservationSealV1 {
        seal_invocation_reservation(ArtifactInvocationReservationMeaningV1 {
            request_identity: &envelope.build_request_identity,
            admission_identity: &envelope.admission_identity,
            attempt_identity: &envelope.attempt_identity,
            claim_identity: &envelope.claim_identity,
            claim_digest: &envelope.claim_digest,
            invocation_admission_receipt_identity: &envelope.invocation_admission_receipt_identity,
            invocation_admission_receipt_digest: &envelope.invocation_admission_receipt_digest,
            claimed_state_digest: &envelope.claimed_state_digest,
            execution_custody_digest: &envelope.execution_custody_digest,
            reserved_at_epoch_ms: envelope.reserved_at_epoch_ms,
        })
        .unwrap()
    }

    #[rstest]
    fn reservation_digest_binds_every_claim_and_cut_field() {
        let original = envelope();
        let original_seal = seal(&original);
        let mut variants = Vec::new();
        macro_rules! changed {
            ($field:ident, $value:expr) => {{
                let mut changed = original.clone();
                changed.$field = $value;
                variants.push(changed);
            }};
        }
        changed!(build_request_identity, "build-2".to_string());
        changed!(admission_identity, "admission-2".to_string());
        changed!(attempt_identity, "attempt-2".to_string());
        changed!(execution_custody_digest, "sha256:custody-2".to_string());
        changed!(claim_identity, "claim-2".to_string());
        changed!(claim_digest, "sha256:claim-2".to_string());
        changed!(
            invocation_admission_receipt_identity,
            "receipt-2".to_string()
        );
        changed!(
            invocation_admission_receipt_digest,
            "sha256:receipt-2".to_string()
        );
        changed!(claimed_state_digest, "sha256:state-2".to_string());
        changed!(reserved_at_epoch_ms, 11);
        for changed in variants {
            assert_ne!(original_seal, seal(&changed));
        }
        assert_eq!(
            original_seal.reservation_identity(),
            format!(
                "rd-artifact-invocation-reservation-v1-{}",
                original_seal
                    .reservation_digest()
                    .trim_start_matches("sha256:")
            )
        );
    }
}
