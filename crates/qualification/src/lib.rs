//! Qualification-owned protected-feedback frontier custody.
//!
//! The public surface accepts only an R&D basis locator. Positive readbacks
//! are constructed exclusively after direct PostgreSQL verification.

mod postgres;

#[cfg(feature = "owner-recovery")]
mod recovery;

pub use postgres::{
    PostgresQualificationOwnerV1, admit_historical_projection_in_transaction,
    admit_projection_in_transaction,
};
#[cfg(feature = "owner-recovery")]
pub use recovery::{RecoveryReceiptV1, run_owner_recovery_cli};
use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Caller-safe locator for a directly resolved R&D Independence Basis.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RdIndependenceBasisLocatorV1 {
    pub basis_identity: String,
    pub basis_digest: String,
    pub request_identity: String,
    pub principal: String,
    pub request_scope: Vec<String>,
}

/// Qualification's authoritative protected-feedback resolution.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ProtectedFeedbackResolutionV1 {
    GenesisEmpty,
    Frontier,
}

/// Sealed, serialize-only Qualification projection.
///
/// Callers cannot deserialize or construct a positive projection:
///
/// ```compile_fail
/// use vibe_qualification::ProtectedFeedbackFrontierReadbackV1;
/// let _: ProtectedFeedbackFrontierReadbackV1 = serde_json::from_str("{}").unwrap();
/// ```
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ProtectedFeedbackFrontierReadbackV1 {
    schema_version: u32,
    projection_identity: String,
    projection_digest: String,
    resolution: ProtectedFeedbackResolutionV1,
    principal: String,
    request_scope: Vec<String>,
    basis_identity: String,
    basis_digest: String,
    source_sequence: u64,
    source_cut: String,
    source_frontier_identity: Option<String>,
    source_frontier_digest: Option<String>,
    clock_epoch: String,
    projection_at_epoch_ms: u64,
    valid_through_epoch_ms: u64,
    receipt: ProtectedFeedbackFrontierReceiptV1,
}

impl ProtectedFeedbackFrontierReadbackV1 {
    pub fn projection_identity(&self) -> &str {
        &self.projection_identity
    }

    pub fn projection_digest(&self) -> &str {
        &self.projection_digest
    }

    pub fn resolution(&self) -> ProtectedFeedbackResolutionV1 {
        self.resolution
    }

    pub fn principal(&self) -> &str {
        &self.principal
    }

    pub fn request_scope(&self) -> &[String] {
        &self.request_scope
    }

    pub fn basis_identity(&self) -> &str {
        &self.basis_identity
    }

    pub fn basis_digest(&self) -> &str {
        &self.basis_digest
    }

    pub fn source_sequence(&self) -> u64 {
        self.source_sequence
    }

    pub fn source_cut(&self) -> &str {
        &self.source_cut
    }

    pub fn source_frontier_identity(&self) -> Option<&str> {
        self.source_frontier_identity.as_deref()
    }

    pub fn source_frontier_digest(&self) -> Option<&str> {
        self.source_frontier_digest.as_deref()
    }

    pub fn clock_epoch(&self) -> &str {
        &self.clock_epoch
    }

    pub fn projection_at_epoch_ms(&self) -> u64 {
        self.projection_at_epoch_ms
    }

    pub fn valid_through_epoch_ms(&self) -> u64 {
        self.valid_through_epoch_ms
    }

    /// Whether this sealed Owner readback authorizes a write at the exact
    /// half-open Owner cut supplied by the consuming transaction.
    pub fn is_current_at(&self, owner_cut_epoch_ms: u64) -> bool {
        self.projection_at_epoch_ms <= owner_cut_epoch_ms
            && owner_cut_epoch_ms < self.valid_through_epoch_ms
    }

    pub fn receipt(&self) -> &ProtectedFeedbackFrontierReceiptV1 {
        &self.receipt
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ProtectedFeedbackFrontierReceiptV1 {
    schema_version: u32,
    receipt_identity: String,
    projection_identity: String,
    projection_digest: String,
    committed_at_epoch_ms: u64,
}

impl ProtectedFeedbackFrontierReceiptV1 {
    pub fn receipt_identity(&self) -> &str {
        &self.receipt_identity
    }

    pub fn committed_at_epoch_ms(&self) -> u64 {
        self.committed_at_epoch_ms
    }
}

#[derive(Debug, Error)]
pub enum QualificationOwnerError {
    #[error("Qualification Owner state is unavailable: {0}")]
    Unavailable(String),
    #[error("Qualification Owner identity was reused with conflicting meaning")]
    ConflictingIdentity,
}
