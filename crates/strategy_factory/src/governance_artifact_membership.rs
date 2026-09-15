//! R&D-owned query boundary for proving that one deterministic Artifact belongs to the exact
//! current TrialFamily census cut.
//!
//! The caller supplies only an untrusted locator. Positive evidence is reconstructed from the
//! existing Artifact-build and TrialFamily PostgreSQL custody in one transaction.

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Exact caller-safe coordinates for one Artifact/TrialFamily membership proof.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct GovernanceArtifactMembershipLocatorV1 {
    pub schema_version: u32,
    pub build_request_identity: String,
    pub attempt_identity: String,
    pub artifact_identity: String,
    pub artifact_build_owner_receipt_identity: String,
    pub build_receipt_identity: String,
    pub candidate_digest: String,
    pub intent_identity: String,
    pub trial_family_identity: String,
    pub trial_family_root_digest: String,
    pub artifact_binding_census_frontier_identity: String,
    pub artifact_binding_census_frontier_digest: String,
    pub census_frontier_identity: String,
    pub census_frontier_digest: String,
    pub artifact_family_binding_identity: String,
    pub artifact_family_binding_digest: String,
    pub artifact_family_binding_receipt_identity: String,
}

impl GovernanceArtifactMembershipLocatorV1 {
    pub(crate) fn is_complete(&self) -> bool {
        self.schema_version == 1
            && [
                self.build_request_identity.as_str(),
                self.attempt_identity.as_str(),
                self.artifact_identity.as_str(),
                self.artifact_build_owner_receipt_identity.as_str(),
                self.build_receipt_identity.as_str(),
                self.candidate_digest.as_str(),
                self.intent_identity.as_str(),
                self.trial_family_identity.as_str(),
                self.trial_family_root_digest.as_str(),
                self.artifact_binding_census_frontier_identity.as_str(),
                self.artifact_binding_census_frontier_digest.as_str(),
                self.census_frontier_identity.as_str(),
                self.census_frontier_digest.as_str(),
                self.artifact_family_binding_identity.as_str(),
                self.artifact_family_binding_digest.as_str(),
                self.artifact_family_binding_receipt_identity.as_str(),
            ]
            .into_iter()
            .all(|value| !value.trim().is_empty())
    }
}

/// Positive R&D evidence that one canonical Artifact's immutable binding cut is an ancestor of the
/// exact current family census cut.
///
/// This value deliberately contains no Governance generation, qualification, Runtime ABI,
/// compatibility, Shared Time, Portfolio, Execution, or Autonomous Policy assertion.
///
/// Callers may serialize an Owner result, but cannot deserialize or field-construct one:
///
/// ```compile_fail
/// use vibe_strategy_factory::governance_artifact_membership::GovernanceArtifactMembershipReadbackV1;
/// let _: GovernanceArtifactMembershipReadbackV1 = serde_json::from_str("{}").unwrap();
/// ```
///
/// ```compile_fail
/// use vibe_strategy_factory::governance_artifact_membership::{
///     GovernanceArtifactMembershipLocatorV1, GovernanceArtifactMembershipReadbackV1,
/// };
/// let _ = GovernanceArtifactMembershipReadbackV1 {
///     schema_version: 1,
///     locator: GovernanceArtifactMembershipLocatorV1 {
///         schema_version: 1,
///         build_request_identity: String::new(), attempt_identity: String::new(),
///         artifact_identity: String::new(), artifact_build_owner_receipt_identity: String::new(),
///         build_receipt_identity: String::new(), candidate_digest: String::new(),
///         intent_identity: String::new(), trial_family_identity: String::new(),
///         trial_family_root_digest: String::new(),
///         artifact_binding_census_frontier_identity: String::new(),
///         artifact_binding_census_frontier_digest: String::new(),
///         census_frontier_identity: String::new(),
///         census_frontier_digest: String::new(), artifact_family_binding_identity: String::new(),
///         artifact_family_binding_digest: String::new(),
///         artifact_family_binding_receipt_identity: String::new(),
///     },
///     request_semantic_digest: String::new(), intent_semantic_digest: String::new(),
///     artifact_review_identity: String::new(), wasm_digest: String::new(),
///     source_capsule_digest: String::new(), build_recipe_digest: String::new(),
///     dependency_identity: String::new(), rustc_release: String::new(),
///     rustc_commit: String::new(), target: String::new(), sandbox_policy: String::new(),
///     deterministic_double_build: false, artifact_security_admission: String::new(),
///     build_security_state: String::new(), committed_at_epoch_ms: 0,
/// };
/// ```
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct GovernanceArtifactMembershipReadbackV1 {
    pub(crate) schema_version: u32,
    pub(crate) locator: GovernanceArtifactMembershipLocatorV1,
    pub(crate) request_semantic_digest: String,
    pub(crate) intent_semantic_digest: String,
    pub(crate) artifact_review_identity: String,
    pub(crate) wasm_digest: String,
    pub(crate) source_capsule_digest: String,
    pub(crate) build_recipe_digest: String,
    pub(crate) dependency_identity: String,
    pub(crate) rustc_release: String,
    pub(crate) rustc_commit: String,
    pub(crate) target: String,
    pub(crate) sandbox_policy: String,
    pub(crate) deterministic_double_build: bool,
    pub(crate) artifact_security_admission: String,
    pub(crate) build_security_state: String,
    pub(crate) committed_at_epoch_ms: u64,
}

impl GovernanceArtifactMembershipReadbackV1 {
    pub const fn schema_version(&self) -> u32 {
        self.schema_version
    }

    pub fn locator(&self) -> &GovernanceArtifactMembershipLocatorV1 {
        &self.locator
    }

    pub fn artifact_review_identity(&self) -> &str {
        &self.artifact_review_identity
    }

    pub fn wasm_digest(&self) -> &str {
        &self.wasm_digest
    }

    pub fn build_recipe_digest(&self) -> &str {
        &self.build_recipe_digest
    }

    pub fn target(&self) -> &str {
        &self.target
    }

    pub fn sandbox_policy(&self) -> &str {
        &self.sandbox_policy
    }

    pub const fn deterministic_double_build(&self) -> bool {
        self.deterministic_double_build
    }

    pub fn build_security_state(&self) -> &str {
        &self.build_security_state
    }

    pub const fn committed_at_epoch_ms(&self) -> u64 {
        self.committed_at_epoch_ms
    }
}

#[derive(Debug, Error)]
pub enum GovernanceArtifactMembershipReadErrorV1 {
    #[error("R&D Governance Artifact membership unavailable")]
    Unavailable,
}

pub(crate) mod sealed_read_port {
    pub trait RdOwned {}
}

/// Query-only boundary implemented solely by the R&D-owned PostgreSQL reader.
///
/// ```compile_fail
/// use async_trait::async_trait;
/// use vibe_strategy_factory::governance_artifact_membership::{
///     GovernanceArtifactMembershipLocatorV1, GovernanceArtifactMembershipReadErrorV1,
///     GovernanceArtifactMembershipReadPortV1, GovernanceArtifactMembershipReadbackV1,
/// };
/// struct CallerOwnedPort;
/// #[async_trait]
/// impl GovernanceArtifactMembershipReadPortV1 for CallerOwnedPort {
///     async fn read_governance_artifact_membership(
///         &self,
///         _: &GovernanceArtifactMembershipLocatorV1,
///     ) -> Result<GovernanceArtifactMembershipReadbackV1, GovernanceArtifactMembershipReadErrorV1> {
///         unreachable!()
///     }
/// }
/// ```
#[async_trait]
pub trait GovernanceArtifactMembershipReadPortV1: sealed_read_port::RdOwned + Send + Sync {
    async fn read_governance_artifact_membership(
        &self,
        locator: &GovernanceArtifactMembershipLocatorV1,
    ) -> Result<GovernanceArtifactMembershipReadbackV1, GovernanceArtifactMembershipReadErrorV1>;
}
