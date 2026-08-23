//! Sealed Operator Authorization Issuer facts.
//!
//! The Product Edge may resolve these facts, but cannot construct issuance or
//! revocation authority. Positive readbacks are serialize-only and are emitted
//! only after the PostgreSQL owner verifies canonical rows and outbox custody.

mod postgres;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;

pub use postgres::{
    OperatorAuthorizationIssuerPostgresV1, parse_untrusted_authorization_envelope_v1,
    resolve_authorization_in_transaction,
};

pub const OPERATOR_AUTHORIZATION_SCHEMA_V1: u32 = 1;
pub const GENESIS_REVOCATION_FRONTIER: &str = "GENESIS_EMPTY";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OperatorAuthorizationScopeV1 {
    pub principal: String,
    pub audience: String,
    pub permissions: Vec<String>,
}

impl OperatorAuthorizationScopeV1 {
    pub fn validate(&self) -> Result<(), OperatorAuthorizationError> {
        if self.principal.trim().is_empty() || self.audience.trim().is_empty() {
            return Err(OperatorAuthorizationError::InvalidProposal(
                "principal/audience",
            ));
        }

        if self.permissions.is_empty()
            || self.permissions.iter().any(|item| item.trim().is_empty())
            || self.permissions.windows(2).any(|pair| pair[0] >= pair[1])
        {
            return Err(OperatorAuthorizationError::InvalidProposal(
                "permissions must be nonempty, sorted, and unique",
            ));
        }
        Ok(())
    }

    pub fn digest(&self) -> Result<String, OperatorAuthorizationError> {
        canonical_digest("operator-authorization.scope.v1", self)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OperationManifestBindingV1 {
    pub manifest_identity: String,
    pub manifest_digest: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OperatorAuthorizationIssuanceProposalV1 {
    pub authorization_identity: String,
    pub issuer_identity: String,
    pub issuer_key_version: String,
    pub scope: OperatorAuthorizationScopeV1,
    pub request_proof_digest: String,
    pub operation_manifests: Vec<OperationManifestBindingV1>,
    pub not_before_epoch_ms: u64,
    pub valid_through_epoch_ms: u64,
    pub expected_revocation_head: String,
}

impl OperatorAuthorizationIssuanceProposalV1 {
    pub fn validate(&self) -> Result<(), OperatorAuthorizationError> {
        self.scope.validate()?;

        if self.authorization_identity.trim().is_empty()
            || self.issuer_identity.trim().is_empty()
            || self.issuer_key_version.trim().is_empty()
            || self.request_proof_digest.trim().is_empty()
            || self.operation_manifests.is_empty()
            || self
                .operation_manifests
                .iter()
                .any(|item| item.manifest_identity.is_empty() || item.manifest_digest.is_empty())
            || self
                .operation_manifests
                .windows(2)
                .any(|pair| pair[0].manifest_identity >= pair[1].manifest_identity)
            || self.not_before_epoch_ms >= self.valid_through_epoch_ms
            || self.expected_revocation_head != "EMPTY"
        {
            return Err(OperatorAuthorizationError::InvalidProposal("issuance"));
        }
        Ok(())
    }

    pub fn semantic_digest(&self) -> Result<String, OperatorAuthorizationError> {
        canonical_digest("operator-authorization.issuance-proposal.v1", self)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OperatorAuthorizationLocatorV1 {
    pub authorization_identity: String,
    pub issuance_receipt_identity: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OperatorAuthorizationSuccessorIssuanceProposalV1 {
    pub predecessor_authorization: OperatorAuthorizationLocatorV1,
    pub expected_current_frontier_identity: String,
    pub successor: OperatorAuthorizationIssuanceProposalV1,
}

impl OperatorAuthorizationSuccessorIssuanceProposalV1 {
    pub fn validate(&self) -> Result<(), OperatorAuthorizationError> {
        self.successor.validate()?;

        if self
            .predecessor_authorization
            .authorization_identity
            .trim()
            .is_empty()
            || self
                .predecessor_authorization
                .issuance_receipt_identity
                .trim()
                .is_empty()
            || self.expected_current_frontier_identity.trim().is_empty()
            || self.successor.authorization_identity
                == self.predecessor_authorization.authorization_identity
        {
            return Err(OperatorAuthorizationError::InvalidProposal(
                "successor issuance",
            ));
        }
        Ok(())
    }

    pub fn semantic_digest(&self) -> Result<String, OperatorAuthorizationError> {
        canonical_digest(
            "operator-authorization.successor-issuance-proposal.v1",
            self,
        )
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OperatorAuthorizationRevocationProposalV1 {
    pub authorization: OperatorAuthorizationLocatorV1,
    pub expected_frontier_identity: String,
    pub reason_code: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct OperatorAuthorizationIssuanceReceiptV1 {
    schema_version: u32,
    receipt_identity: String,
    authorization_identity: String,
    issuance_digest: String,
    committed_at_epoch_ms: u64,
}

impl OperatorAuthorizationIssuanceReceiptV1 {
    pub fn receipt_identity(&self) -> &str {
        &self.receipt_identity
    }
    pub fn authorization_identity(&self) -> &str {
        &self.authorization_identity
    }
    pub fn issuance_digest(&self) -> &str {
        &self.issuance_digest
    }
    pub fn committed_at_epoch_ms(&self) -> u64 {
        self.committed_at_epoch_ms
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct OperatorAuthorizationRevocationFrontierV1 {
    schema_version: u32,
    frontier_identity: String,
    scope_digest: String,
    sequence: u64,
    predecessor_frontier_identity: Option<String>,
    revoked_authorization_identities: Vec<String>,
    committed_at_epoch_ms: u64,
}

impl OperatorAuthorizationRevocationFrontierV1 {
    pub fn frontier_identity(&self) -> &str {
        &self.frontier_identity
    }
    pub fn scope_digest(&self) -> &str {
        &self.scope_digest
    }
    pub fn sequence(&self) -> u64 {
        self.sequence
    }
    pub fn revoked_authorization_identities(&self) -> &[String] {
        &self.revoked_authorization_identities
    }
    pub fn committed_at_epoch_ms(&self) -> u64 {
        self.committed_at_epoch_ms
    }
}

/// Sealed issuer readback; callers cannot deserialize positive authorization.
///
/// ```compile_fail
/// use vibe_operator_authorization::OperatorAuthorizationReadbackV1;
/// let _: OperatorAuthorizationReadbackV1 = serde_json::from_str("{}").unwrap();
/// ```
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct OperatorAuthorizationReadbackV1 {
    issuance_receipt: OperatorAuthorizationIssuanceReceiptV1,
    frontier: OperatorAuthorizationRevocationFrontierV1,
    issuer_identity: String,
    issuer_key_version: String,
    scope: OperatorAuthorizationScopeV1,
    request_proof_digest: String,
    operation_manifests: Vec<OperationManifestBindingV1>,
    not_before_epoch_ms: u64,
    valid_through_epoch_ms: u64,
}

impl OperatorAuthorizationReadbackV1 {
    pub fn locator(&self) -> OperatorAuthorizationLocatorV1 {
        OperatorAuthorizationLocatorV1 {
            authorization_identity: self.issuance_receipt.authorization_identity.clone(),
            issuance_receipt_identity: self.issuance_receipt.receipt_identity.clone(),
        }
    }
    pub fn issuance_receipt(&self) -> &OperatorAuthorizationIssuanceReceiptV1 {
        &self.issuance_receipt
    }
    pub fn frontier(&self) -> &OperatorAuthorizationRevocationFrontierV1 {
        &self.frontier
    }
    pub fn issuer_identity(&self) -> &str {
        &self.issuer_identity
    }
    pub fn issuer_key_version(&self) -> &str {
        &self.issuer_key_version
    }
    pub fn scope(&self) -> &OperatorAuthorizationScopeV1 {
        &self.scope
    }
    pub fn request_proof_digest(&self) -> &str {
        &self.request_proof_digest
    }
    pub fn operation_manifests(&self) -> &[OperationManifestBindingV1] {
        &self.operation_manifests
    }
    pub fn not_before_epoch_ms(&self) -> u64 {
        self.not_before_epoch_ms
    }
    pub fn valid_through_epoch_ms(&self) -> u64 {
        self.valid_through_epoch_ms
    }
    pub fn is_current_at(&self, read_cut_epoch_ms: u64) -> bool {
        read_cut_epoch_ms >= self.not_before_epoch_ms
            && read_cut_epoch_ms < self.valid_through_epoch_ms
            && !self
                .frontier
                .revoked_authorization_identities
                .contains(&self.issuance_receipt.authorization_identity)
    }
    pub fn canonical_evidence(&self) -> UntrustedCanonicalAuthorizationEvidenceV1 {
        UntrustedCanonicalAuthorizationEvidenceV1 {
            issuance_receipt: self.issuance_receipt.clone(),
            frontier: self.frontier.clone(),
            issuer_identity: self.issuer_identity.clone(),
            issuer_key_version: self.issuer_key_version.clone(),
            scope: self.scope.clone(),
            request_proof_digest: self.request_proof_digest.clone(),
            operation_manifests: self.operation_manifests.clone(),
            not_before_epoch_ms: self.not_before_epoch_ms,
            valid_through_epoch_ms: self.valid_through_epoch_ms,
        }
    }
}

/// Canonically consistent authorization bytes without Owner provenance.
///
/// This type is intentionally not an Owner readback: parsing caller-provided
/// bytes can produce it, so only the database port that sourced the bytes while
/// retaining the issuer locks may use it as part of a higher-level custody
/// decision. It is serialize-only and has no public constructor.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct UntrustedCanonicalAuthorizationEvidenceV1 {
    issuance_receipt: OperatorAuthorizationIssuanceReceiptV1,
    frontier: OperatorAuthorizationRevocationFrontierV1,
    issuer_identity: String,
    issuer_key_version: String,
    scope: OperatorAuthorizationScopeV1,
    request_proof_digest: String,
    operation_manifests: Vec<OperationManifestBindingV1>,
    not_before_epoch_ms: u64,
    valid_through_epoch_ms: u64,
}

impl UntrustedCanonicalAuthorizationEvidenceV1 {
    pub fn locator(&self) -> OperatorAuthorizationLocatorV1 {
        OperatorAuthorizationLocatorV1 {
            authorization_identity: self.issuance_receipt.authorization_identity.clone(),
            issuance_receipt_identity: self.issuance_receipt.receipt_identity.clone(),
        }
    }
    pub fn issuance_receipt(&self) -> &OperatorAuthorizationIssuanceReceiptV1 {
        &self.issuance_receipt
    }
    pub fn frontier(&self) -> &OperatorAuthorizationRevocationFrontierV1 {
        &self.frontier
    }
    pub fn issuer_identity(&self) -> &str {
        &self.issuer_identity
    }
    pub fn issuer_key_version(&self) -> &str {
        &self.issuer_key_version
    }
    pub fn scope(&self) -> &OperatorAuthorizationScopeV1 {
        &self.scope
    }
    pub fn request_proof_digest(&self) -> &str {
        &self.request_proof_digest
    }
    pub fn operation_manifests(&self) -> &[OperationManifestBindingV1] {
        &self.operation_manifests
    }
    pub fn not_before_epoch_ms(&self) -> u64 {
        self.not_before_epoch_ms
    }
    pub fn valid_through_epoch_ms(&self) -> u64 {
        self.valid_through_epoch_ms
    }
    pub fn is_current_at(&self, read_cut_epoch_ms: u64) -> bool {
        read_cut_epoch_ms >= self.not_before_epoch_ms
            && read_cut_epoch_ms < self.valid_through_epoch_ms
            && !self
                .frontier
                .revoked_authorization_identities
                .contains(&self.issuance_receipt.authorization_identity)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AuthorizationReadModeV1 {
    /// Return the canonical current frontier while retaining its source locks,
    /// without deciding time validity. The consuming Owner samples its own
    /// write cut after all later locks and calls `is_current_at` on the sealed
    /// evidence immediately before writing.
    CurrentAtLock,
    Current {
        read_cut_epoch_ms: u64,
    },
    Historical {
        frontier_identity: String,
    },
}

#[derive(Debug, Error)]
pub enum OperatorAuthorizationError {
    #[error("invalid operator authorization proposal: {0}")]
    InvalidProposal(&'static str),
    #[error("operator authorization identity conflicts with committed meaning")]
    ConflictingReplay,
    #[error("operator authorization unavailable")]
    Unavailable,
    #[error("operator authorization storage unavailable: {0}")]
    Storage(String),
}

pub(crate) fn canonical_bytes<T: Serialize>(
    value: &T,
) -> Result<Vec<u8>, OperatorAuthorizationError> {
    serde_json::to_vec(value).map_err(|e| OperatorAuthorizationError::Storage(e.to_string()))
}

pub(crate) fn canonical_digest<T: Serialize>(
    domain: &str,
    value: &T,
) -> Result<String, OperatorAuthorizationError> {
    let bytes = canonical_bytes(value)?;
    let mut hash = Sha256::new();
    hash.update((domain.len() as u64).to_be_bytes());
    hash.update(domain.as_bytes());
    hash.update((bytes.len() as u64).to_be_bytes());
    hash.update(bytes);
    Ok(format!("sha256:{:x}", hash.finalize()))
}

pub(crate) fn identity(domain: &str, parts: &[&str]) -> String {
    let mut hash = Sha256::new();
    hash.update((domain.len() as u64).to_be_bytes());
    hash.update(domain.as_bytes());
    for part in parts {
        hash.update((part.len() as u64).to_be_bytes());
        hash.update(part.as_bytes());
    }
    format!("{}-{:x}", domain.replace('.', "-"), hash.finalize())
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::*;

    #[rstest]
    fn scope_rejects_unsorted_or_duplicate_permissions() {
        let scope = OperatorAuthorizationScopeV1 {
            principal: "u/admin".into(),
            audience: "rd-owner".into(),
            permissions: vec!["z".into(), "a".into()],
        };
        assert!(scope.validate().is_err());
    }

    #[rstest]
    fn successor_issuance_requires_distinct_identity_and_complete_frontier() {
        let proposal = OperatorAuthorizationSuccessorIssuanceProposalV1 {
            predecessor_authorization: OperatorAuthorizationLocatorV1 {
                authorization_identity: "authorization-1".into(),
                issuance_receipt_identity: "receipt-1".into(),
            },
            expected_current_frontier_identity: "frontier-1".into(),
            successor: OperatorAuthorizationIssuanceProposalV1 {
                authorization_identity: "authorization-2".into(),
                issuer_identity: "issuer-1".into(),
                issuer_key_version: "key-1".into(),
                scope: OperatorAuthorizationScopeV1 {
                    principal: "principal-1".into(),
                    audience: "R_AND_D".into(),
                    permissions: vec!["research:submit".into()],
                },
                request_proof_digest: "sha256:proof".into(),
                operation_manifests: vec![OperationManifestBindingV1 {
                    manifest_identity: "manifest-1".into(),
                    manifest_digest: "sha256:manifest".into(),
                }],
                not_before_epoch_ms: 10,
                valid_through_epoch_ms: 20,
                expected_revocation_head: "EMPTY".into(),
            },
        };
        assert!(proposal.validate().is_ok());

        let mut same_identity = proposal.clone();
        same_identity.successor.authorization_identity = same_identity
            .predecessor_authorization
            .authorization_identity
            .clone();
        assert!(same_identity.validate().is_err());
        let mut stale_frontier = proposal.clone();
        stale_frontier.expected_current_frontier_identity.clear();
        assert!(stale_frontier.validate().is_err());

        let mut malformed = serde_json::to_value(proposal).unwrap();
        malformed["caller_asserted_current"] = serde_json::json!(true);
        assert!(
            serde_json::from_value::<OperatorAuthorizationSuccessorIssuanceProposalV1>(malformed)
                .is_err()
        );
    }
}
