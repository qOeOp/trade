//! Sealed Operator Authorization Issuer facts.
//!
//! The Product Edge may resolve these facts, but cannot construct issuance or
//! revocation authority. Positive readbacks are serialize-only and are emitted
//! only after the PostgreSQL owner verifies canonical rows and outbox custody.

mod autonomous_policy_authorization;
mod grant;
mod postgres;

pub use autonomous_policy_authorization::{
    AUTONOMOUS_POLICY_AUTHORIZATION_SCHEMA_V1, AutonomousPolicyAuthorizationContentV1,
    AutonomousPolicyAuthorizationIssuanceProposalV1, AutonomousPolicyAuthorizationLocatorV1,
    AutonomousPolicyAuthorizationReadRequestV1, AutonomousPolicyAuthorizationReadbackV1,
    AutonomousPolicyAuthorizationResolutionV1, AutonomousPolicyAuthorizationRevocationFrontierV1,
    AutonomousPolicyAuthorizationRevocationProposalV1,
    AutonomousPolicyAuthorizationSuccessorProposalV1,
    AutonomousPolicyAuthorizationUnavailableReasonV1, AutonomousPolicyResourceV1,
    AutonomousPolicyV1, CapitalPolicyBindingV1, LIFECYCLE_ACTIONS_V1,
    STRATEGY_GOVERNANCE_AUDIENCE_V1, UntrustedCanonicalAutonomousPolicyAuthorizationEvidenceV1,
};

pub use grant::{
    GrantContentV1, GrantIssuanceProposalV1, GrantIssuanceReceiptV1, GrantLocatorV1,
    GrantReadbackV1, GrantResolutionV1, GrantRevocationFrontierV1, GrantRevocationProposalV1,
    GrantSuccessorProposalV1, GrantUnavailableReasonV1, UntrustedCanonicalGrantEvidenceV1,
};

use std::fmt::Display;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;

pub use postgres::{
    OperatorAuthorizationIssuerPostgresV1, parse_untrusted_authorization_envelope_v1,
    parse_untrusted_autonomous_policy_authorization_envelope_v1,
    parse_untrusted_portfolio_resource_grant_envelope_v1, resolve_authorization_in_transaction,
    resolve_autonomous_policy_authorization_in_transaction,
    resolve_portfolio_resource_grant_in_transaction,
};

pub const OPERATOR_AUTHORIZATION_SCHEMA_V1: u32 = 1;
pub const GENESIS_REVOCATION_FRONTIER: &str = "GENESIS_EMPTY";
pub const PORTFOLIO_RESOURCE_GRANT_SCHEMA_V1: u32 = 1;
pub const PORTFOLIO_OWNER_AUDIENCE_V1: &str = "PORTFOLIO";
pub const PORTFOLIO_VIEW_PERMISSION_V1: &str = "portfolio:view";

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

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ManifestSemanticKeyV1 {
    pub operation: String,
    pub operation_schema: String,
    pub target_owner: String,
}

impl ManifestSemanticKeyV1 {
    fn validate(&self) -> bool {
        !self.operation.trim().is_empty()
            && !self.operation_schema.trim().is_empty()
            && !self.target_owner.trim().is_empty()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "transition",
    rename_all = "SCREAMING_SNAKE_CASE",
    deny_unknown_fields
)]
pub enum ExpiredManifestRecoveryTransitionV1 {
    Retained {
        semantic_key: ManifestSemanticKeyV1,
        predecessor_manifest: OperationManifestBindingV1,
        successor_manifest: OperationManifestBindingV1,
    },
    Added {
        semantic_key: ManifestSemanticKeyV1,
        successor_manifest: OperationManifestBindingV1,
    },
    Removed {
        semantic_key: ManifestSemanticKeyV1,
        predecessor_manifest: OperationManifestBindingV1,
    },
}

impl ExpiredManifestRecoveryTransitionV1 {
    pub fn semantic_key(&self) -> &ManifestSemanticKeyV1 {
        match self {
            Self::Retained { semantic_key, .. }
            | Self::Added { semantic_key, .. }
            | Self::Removed { semantic_key, .. } => semantic_key,
        }
    }
}

/// One content-addressed recovery epoch that explicitly binds the complete
/// retained, added, and removed operation-manifest capability set.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExpiredManifestRecoveryEpochV1 {
    pub recovery_epoch_identity: String,
    pub recovery_epoch_digest: String,
    pub manifest_transitions: Vec<ExpiredManifestRecoveryTransitionV1>,
}

impl ExpiredManifestRecoveryEpochV1 {
    pub fn new(
        manifest_transitions: Vec<ExpiredManifestRecoveryTransitionV1>,
    ) -> Result<Self, OperatorAuthorizationError> {
        let mut value = Self {
            recovery_epoch_identity: String::new(),
            recovery_epoch_digest: String::new(),
            manifest_transitions,
        };
        value.recovery_epoch_digest = value.expected_digest()?;
        value.recovery_epoch_identity = identity(
            "expired-manifest-recovery-epoch-v1",
            &[&value.recovery_epoch_digest],
        );
        value.validate()?;
        Ok(value)
    }

    pub fn validate(&self) -> Result<(), OperatorAuthorizationError> {
        let predecessor = self.predecessor_operation_manifests();
        let successor = self.successor_operation_manifests();

        if self.manifest_transitions.is_empty()
            || self
                .manifest_transitions
                .iter()
                .any(|transition| !valid_recovery_transition(transition))
            || self
                .manifest_transitions
                .windows(2)
                .any(|pair| pair[0].semantic_key() >= pair[1].semantic_key())
            || !valid_manifest_bindings(&predecessor)
            || !valid_manifest_bindings(&successor)
            || self.recovery_epoch_digest != self.expected_digest()?
            || self.recovery_epoch_identity
                != identity(
                    "expired-manifest-recovery-epoch-v1",
                    &[&self.recovery_epoch_digest],
                )
        {
            return Err(OperatorAuthorizationError::InvalidProposal(
                "expired manifest recovery epoch",
            ));
        }
        Ok(())
    }

    pub fn predecessor_operation_manifests(&self) -> Vec<OperationManifestBindingV1> {
        let mut manifests = self
            .manifest_transitions
            .iter()
            .filter_map(|transition| match transition {
                ExpiredManifestRecoveryTransitionV1::Retained {
                    predecessor_manifest,
                    ..
                }
                | ExpiredManifestRecoveryTransitionV1::Removed {
                    predecessor_manifest,
                    ..
                } => Some(predecessor_manifest.clone()),
                ExpiredManifestRecoveryTransitionV1::Added { .. } => None,
            })
            .collect::<Vec<_>>();
        manifests.sort_by(|left, right| left.manifest_identity.cmp(&right.manifest_identity));
        manifests
    }

    pub fn successor_operation_manifests(&self) -> Vec<OperationManifestBindingV1> {
        let mut manifests = self
            .manifest_transitions
            .iter()
            .filter_map(|transition| match transition {
                ExpiredManifestRecoveryTransitionV1::Retained {
                    successor_manifest, ..
                }
                | ExpiredManifestRecoveryTransitionV1::Added {
                    successor_manifest, ..
                } => Some(successor_manifest.clone()),
                ExpiredManifestRecoveryTransitionV1::Removed { .. } => None,
            })
            .collect::<Vec<_>>();
        manifests.sort_by(|left, right| left.manifest_identity.cmp(&right.manifest_identity));
        manifests
    }

    pub fn evolves_capability_set(&self) -> bool {
        self.manifest_transitions.iter().any(|transition| {
            matches!(
                transition,
                ExpiredManifestRecoveryTransitionV1::Added { .. }
                    | ExpiredManifestRecoveryTransitionV1::Removed { .. }
            )
        })
    }

    fn expected_digest(&self) -> Result<String, OperatorAuthorizationError> {
        canonical_digest(
            "expired-manifest-recovery-epoch.v1",
            &self.manifest_transitions,
        )
    }
}

fn valid_recovery_transition(transition: &ExpiredManifestRecoveryTransitionV1) -> bool {
    if !transition.semantic_key().validate() {
        return false;
    }

    match transition {
        ExpiredManifestRecoveryTransitionV1::Retained {
            predecessor_manifest,
            successor_manifest,
            ..
        } => {
            valid_manifest_binding(predecessor_manifest)
                && valid_manifest_binding(successor_manifest)
                && predecessor_manifest != successor_manifest
        }
        ExpiredManifestRecoveryTransitionV1::Added {
            successor_manifest, ..
        } => valid_manifest_binding(successor_manifest),
        ExpiredManifestRecoveryTransitionV1::Removed {
            predecessor_manifest,
            ..
        } => valid_manifest_binding(predecessor_manifest),
    }
}

fn valid_manifest_binding(binding: &OperationManifestBindingV1) -> bool {
    !binding.manifest_identity.trim().is_empty() && !binding.manifest_digest.trim().is_empty()
}

fn valid_manifest_bindings(bindings: &[OperationManifestBindingV1]) -> bool {
    !bindings.is_empty()
        && bindings.iter().all(valid_manifest_binding)
        && bindings
            .windows(2)
            .all(|pair| pair[0].manifest_identity < pair[1].manifest_identity)
}

/// Exact resource coordinates for one Portfolio read grant.
///
/// These coordinates are deliberately separate from V1's generic permission
/// strings. Account, Execution Scope, and mode never become encoded suffixes
/// in `portfolio:view`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PortfolioResourceV1 {
    pub principal: String,
    pub audience: String,
    pub permission: String,
    pub account_identity: String,
    pub execution_scope_identity: String,
    pub mode: ExecutionModeV1,
}

impl PortfolioResourceV1 {
    pub fn validate(&self) -> Result<(), OperatorAuthorizationError> {
        if self.principal.trim().is_empty()
            || self.audience != PORTFOLIO_OWNER_AUDIENCE_V1
            || self.permission != PORTFOLIO_VIEW_PERMISSION_V1
            || self.account_identity.trim().is_empty()
            || self.execution_scope_identity.trim().is_empty()
        {
            return Err(OperatorAuthorizationError::InvalidProposal(
                "portfolio resource coordinates",
            ));
        }
        Ok(())
    }

    pub fn digest(&self) -> Result<String, OperatorAuthorizationError> {
        self.validate()?;
        canonical_digest("operator-authorization.portfolio-resource.v1", self)
    }
}

/// The trading mode a grant is bound to. `PAPER` and `LIVE` never alias.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ExecutionModeV1 {
    Paper,
    Live,
}

impl ExecutionModeV1 {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Paper => "PAPER",
            Self::Live => "LIVE",
        }
    }
}

/// The Portfolio grant's original name for [`ExecutionModeV1`].
pub type PortfolioResourceModeV1 = ExecutionModeV1;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProductEdgeManifestBindingV1 {
    pub manifest_locator: String,
    pub manifest_digest: String,
}

impl ProductEdgeManifestBindingV1 {
    fn validate(&self) -> Result<(), OperatorAuthorizationError> {
        if self.manifest_locator.trim().is_empty() || !is_sha256_digest(&self.manifest_digest) {
            return Err(OperatorAuthorizationError::InvalidProposal(
                "product edge manifest binding",
            ));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PortfolioResourceGrantContentV1 {
    pub issuer_identity: String,
    pub issuer_key_version: String,
    pub resource: PortfolioResourceV1,
    pub product_edge_manifest: ProductEdgeManifestBindingV1,
    pub effective_at_epoch_ms: u64,
    pub valid_through_epoch_ms: u64,
}

impl PortfolioResourceGrantContentV1 {
    pub fn validate(&self) -> Result<(), OperatorAuthorizationError> {
        self.resource.validate()?;
        self.product_edge_manifest.validate()?;

        if self.issuer_identity.trim().is_empty()
            || self.issuer_key_version.trim().is_empty()
            || self.effective_at_epoch_ms >= self.valid_through_epoch_ms
        {
            return Err(OperatorAuthorizationError::InvalidProposal(
                "portfolio resource grant content",
            ));
        }
        Ok(())
    }

    pub fn content_digest(&self) -> Result<String, OperatorAuthorizationError> {
        self.validate()?;
        canonical_digest(&Self::content_digest_domain(), self)
    }

    pub fn grant_identity(&self) -> Result<String, OperatorAuthorizationError> {
        Ok(grant::grant_identity_for::<Self>(&self.content_digest()?))
    }
}

impl GrantContentV1 for PortfolioResourceGrantContentV1 {
    type Expected<'a> = (&'a PortfolioResourceV1, &'a ProductEdgeManifestBindingV1);

    const KIND_STEM: &'static str = "portfolio-resource-grant";
    const TABLE_STEM: &'static str = "portfolio_resource_grant";
    const SCHEMA_VERSION: u32 = PORTFOLIO_RESOURCE_GRANT_SCHEMA_V1;
    const CONSUMER_ROLES: &'static str = "product_edge_owner, operator_authorization_writer";
    const MIRROR_COLUMNS: &'static [&'static str] = &[
        "principal",
        "audience",
        "permission",
        "account_identity",
        "execution_scope_identity",
        "mode",
    ];

    fn validate(&self) -> Result<(), OperatorAuthorizationError> {
        Self::validate(self)
    }

    fn grant_identity(&self) -> Result<String, OperatorAuthorizationError> {
        Self::grant_identity(self)
    }

    fn resource_digest(&self) -> Result<String, OperatorAuthorizationError> {
        self.resource.digest()
    }

    fn issuer_identity(&self) -> &str {
        &self.issuer_identity
    }

    fn issuer_key_version(&self) -> &str {
        &self.issuer_key_version
    }

    fn effective_at_epoch_ms(&self) -> u64 {
        self.effective_at_epoch_ms
    }

    fn valid_through_epoch_ms(&self) -> u64 {
        self.valid_through_epoch_ms
    }

    fn same_resource(&self, other: &Self) -> bool {
        self.resource == other.resource
    }

    fn mirror_values(&self) -> Result<Vec<String>, OperatorAuthorizationError> {
        Ok(vec![
            self.resource.principal.clone(),
            self.resource.audience.clone(),
            self.resource.permission.clone(),
            self.resource.account_identity.clone(),
            self.resource.execution_scope_identity.clone(),
            self.resource.mode.as_str().to_string(),
        ])
    }

    fn resource_matches(&self, expected: &Self::Expected<'_>) -> bool {
        &self.resource == expected.0
    }

    fn manifest_matches(&self, expected: &Self::Expected<'_>) -> bool {
        &self.product_edge_manifest == expected.1
    }
}

pub type PortfolioResourceGrantIssuanceProposalV1 =
    GrantIssuanceProposalV1<PortfolioResourceGrantContentV1>;
pub type PortfolioResourceGrantLocatorV1 = GrantLocatorV1;
pub type PortfolioResourceGrantSuccessorProposalV1 =
    GrantSuccessorProposalV1<PortfolioResourceGrantContentV1>;
pub type PortfolioResourceGrantRevocationProposalV1 = GrantRevocationProposalV1;
pub type PortfolioResourceGrantIssuanceReceiptV1 = GrantIssuanceReceiptV1;
pub type PortfolioResourceGrantRevocationFrontierV1 = GrantRevocationFrontierV1;
pub type PortfolioResourceGrantReadbackV1 = GrantReadbackV1<PortfolioResourceGrantContentV1>;
pub type UntrustedCanonicalPortfolioResourceGrantEvidenceV1 =
    UntrustedCanonicalGrantEvidenceV1<PortfolioResourceGrantContentV1>;
pub type PortfolioResourceGrantUnavailableReasonV1 = GrantUnavailableReasonV1;
pub type PortfolioResourceGrantResolutionV1 = GrantResolutionV1<PortfolioResourceGrantContentV1>;

impl UntrustedCanonicalPortfolioResourceGrantEvidenceV1 {
    pub fn matches_resource(&self, expected: &PortfolioResourceV1) -> bool {
        &self.content.resource == expected
    }

    pub fn matches_product_edge_manifest(&self, expected: &ProductEdgeManifestBindingV1) -> bool {
        &self.content.product_edge_manifest == expected
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PortfolioResourceGrantReadRequestV1 {
    pub locator: PortfolioResourceGrantLocatorV1,
    pub expected_resource: PortfolioResourceV1,
    pub expected_manifest: ProductEdgeManifestBindingV1,
}

impl PortfolioResourceGrantReadRequestV1 {
    pub fn validate(&self) -> Result<(), OperatorAuthorizationError> {
        self.expected_resource.validate()?;
        self.expected_manifest.validate()?;

        if self.locator.validate().is_err() {
            return Err(OperatorAuthorizationError::InvalidProposal(
                "portfolio resource grant read",
            ));
        }
        Ok(())
    }
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OperatorAuthorizationExpiredManifestRecoveryProposalV1 {
    pub recovery_epoch: ExpiredManifestRecoveryEpochV1,
    pub predecessor_authorization: OperatorAuthorizationLocatorV1,
    pub expected_current_frontier_identity: String,
    pub successor: OperatorAuthorizationIssuanceProposalV1,
}

impl OperatorAuthorizationExpiredManifestRecoveryProposalV1 {
    pub fn validate(&self) -> Result<(), OperatorAuthorizationError> {
        self.recovery_epoch.validate()?;
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
            || self.successor.operation_manifests
                != self.recovery_epoch.successor_operation_manifests()
        {
            return Err(OperatorAuthorizationError::InvalidProposal(
                "expired manifest recovery",
            ));
        }
        Ok(())
    }

    pub fn semantic_digest(&self) -> Result<String, OperatorAuthorizationError> {
        self.validate()?;
        canonical_digest(
            "operator-authorization.expired-manifest-recovery-proposal.v1",
            self,
        )
    }
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
    #[serde(skip_serializing_if = "Option::is_none")]
    recovery_epoch: Option<ExpiredManifestRecoveryEpochV1>,
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
    pub fn recovery_epoch(&self) -> Option<&ExpiredManifestRecoveryEpochV1> {
        self.recovery_epoch.as_ref()
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
            recovery_epoch: self.recovery_epoch.clone(),
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
    #[serde(skip_serializing_if = "Option::is_none")]
    recovery_epoch: Option<ExpiredManifestRecoveryEpochV1>,
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
    pub fn recovery_epoch(&self) -> Option<&ExpiredManifestRecoveryEpochV1> {
        self.recovery_epoch.as_ref()
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
    #[error("operator authorization unavailable: {0}")]
    Unavailable(OperatorAuthorizationUnavailableV1),
    #[error("operator authorization storage unavailable: {0}")]
    Storage(String),
}

impl OperatorAuthorizationError {
    /// An `Unavailable` refusal that names its reason but no particular identity.
    #[must_use]
    pub fn unavailable(reason: OperatorAuthorizationUnavailableReasonV1) -> Self {
        Self::Unavailable(OperatorAuthorizationUnavailableV1::new(reason))
    }

    /// An `Unavailable` refusal about one exact identity.
    #[must_use]
    pub fn unavailable_for(
        reason: OperatorAuthorizationUnavailableReasonV1,
        kind: OperatorAuthorizationSubjectKindV1,
        identity: impl Into<String>,
    ) -> Self {
        Self::Unavailable(OperatorAuthorizationUnavailableV1::about(
            reason, kind, identity,
        ))
    }
}

/// Diagnostic detail behind [`OperatorAuthorizationError::Unavailable`].
///
/// It records why the issuer would not treat a row, a chain, or an
/// authorization as current, and which identity the refusal is about. It is
/// evidence for the operator and the log, not a disposition: every
/// `Unavailable` still fails closed exactly as before, and no reason grants a
/// caller a successor or a retry it did not already have.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OperatorAuthorizationUnavailableV1 {
    reason: OperatorAuthorizationUnavailableReasonV1,
    subject: Option<OperatorAuthorizationSubjectV1>,
}

impl OperatorAuthorizationUnavailableV1 {
    #[must_use]
    pub fn new(reason: OperatorAuthorizationUnavailableReasonV1) -> Self {
        Self {
            reason,
            subject: None,
        }
    }

    #[must_use]
    pub fn about(
        reason: OperatorAuthorizationUnavailableReasonV1,
        kind: OperatorAuthorizationSubjectKindV1,
        identity: impl Into<String>,
    ) -> Self {
        Self {
            reason,
            subject: Some(OperatorAuthorizationSubjectV1 {
                kind,
                identity: identity.into(),
            }),
        }
    }

    pub fn reason(&self) -> OperatorAuthorizationUnavailableReasonV1 {
        self.reason
    }

    pub fn subject(&self) -> Option<&OperatorAuthorizationSubjectV1> {
        self.subject.as_ref()
    }
}

impl Display for OperatorAuthorizationUnavailableV1 {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match &self.subject {
            Some(subject) => write!(f, "{} for {subject}", self.reason),
            None => write!(f, "{}", self.reason),
        }
    }
}

/// The exact identity an `Unavailable` refusal is about.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OperatorAuthorizationSubjectV1 {
    kind: OperatorAuthorizationSubjectKindV1,
    identity: String,
}

impl OperatorAuthorizationSubjectV1 {
    pub fn kind(&self) -> OperatorAuthorizationSubjectKindV1 {
        self.kind
    }

    pub fn identity(&self) -> &str {
        &self.identity
    }
}

impl Display for OperatorAuthorizationSubjectV1 {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{} {}", self.kind, self.identity)
    }
}

/// Which Operator Authorization identity a refusal names.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OperatorAuthorizationSubjectKindV1 {
    /// An issuance, by `authorization_identity`.
    Authorization,
    /// A revocation frontier, by `frontier_identity`.
    Frontier,
    /// A revocation head, by the `scope_digest` it is keyed on.
    ///
    /// Distinct from [`Self::Frontier`]: the head is the pointer, the frontier
    /// is what it points at, and either can be absent without the other.
    Head,
    /// A scope history, by `scope_digest`.
    Scope,
    /// A Portfolio resource grant, by `grant_identity`.
    Grant,
    /// A Portfolio resource history, by `resource_digest`.
    Resource,
    /// An expired-manifest recovery epoch, by `recovery_epoch_identity`.
    RecoveryEpoch,
    /// An outbox aggregate, by `aggregate_identity`.
    Outbox,
}

impl OperatorAuthorizationSubjectKindV1 {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Authorization => "authorization",
            Self::Frontier => "frontier",
            Self::Head => "revocation head",
            Self::Scope => "scope",
            Self::Grant => "grant",
            Self::Resource => "resource",
            Self::RecoveryEpoch => "recovery epoch",
            Self::Outbox => "outbox aggregate",
        }
    }
}

impl Display for OperatorAuthorizationSubjectKindV1 {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Why the issuer refused to treat custody or an authorization as current.
///
/// The vocabulary is closed and coarse on purpose: it distinguishes the
/// operator-visible failure classes (absent, duplicated, corrupt, chain
/// broken, expired, revoked, lost a race) without projecting protected detail.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OperatorAuthorizationUnavailableReasonV1 {
    /// A required row, envelope, or chain member is absent.
    Missing,
    /// More than one row exists where exactly one is canonical.
    Ambiguous,
    /// Stored bytes do not decode as the canonical shape.
    Malformed,
    /// Stored custody disagrees with its own canonical recomputation: a
    /// digest, receipt, column mirror, or schema version does not match.
    CustodyDrift,
    /// The caller's locator names an identity whose committed receipt differs.
    LocatorMismatch,
    /// The issuance or frontier chain is not one well-formed lineage.
    LineageBroken,
    /// The head row disagrees with the current frontier.
    HeadMismatch,
    /// The cut precedes the authorization's `not_before`.
    NotYetEffective,
    /// The cut is at or beyond the authorization's `valid_through`.
    Expired,
    /// The frontier at the cut revokes the authorization.
    Revoked,
    /// A historical read names a frontier older than the issuance admitted.
    FrontierMismatch,
    /// A row belongs to a different scope or resource history than requested.
    ScopeMismatch,
    /// A compare-and-swap on the head affected no row.
    CompareAndSwapLost,
    /// The connected role or schema topology is not the admitted one.
    TopologyNotAdmitted,
    /// The caller transaction is not READ COMMITTED.
    IsolationNotReadCommitted,
    /// A resource grant resolved as unavailable for this reason.
    Grant(GrantUnavailableReasonV1),
}

impl OperatorAuthorizationUnavailableReasonV1 {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Missing => "MISSING",
            Self::Ambiguous => "AMBIGUOUS",
            Self::Malformed => "MALFORMED",
            Self::CustodyDrift => "CUSTODY_DRIFT",
            Self::LocatorMismatch => "LOCATOR_MISMATCH",
            Self::LineageBroken => "LINEAGE_BROKEN",
            Self::HeadMismatch => "HEAD_MISMATCH",
            Self::NotYetEffective => "NOT_YET_EFFECTIVE",
            Self::Expired => "EXPIRED",
            Self::Revoked => "REVOKED",
            Self::FrontierMismatch => "FRONTIER_MISMATCH",
            Self::ScopeMismatch => "SCOPE_MISMATCH",
            Self::CompareAndSwapLost => "COMPARE_AND_SWAP_LOST",
            Self::TopologyNotAdmitted => "TOPOLOGY_NOT_ADMITTED",
            Self::IsolationNotReadCommitted => "ISOLATION_NOT_READ_COMMITTED",
            Self::Grant(GrantUnavailableReasonV1::InvalidRequest) => "GRANT_INVALID_REQUEST",
            Self::Grant(GrantUnavailableReasonV1::OwnerUnavailable) => "GRANT_OWNER_UNAVAILABLE",
            Self::Grant(GrantUnavailableReasonV1::ResourceMismatch) => "GRANT_RESOURCE_MISMATCH",
            Self::Grant(GrantUnavailableReasonV1::ManifestMismatch) => "GRANT_MANIFEST_MISMATCH",
            Self::Grant(GrantUnavailableReasonV1::NotEffective) => "GRANT_NOT_EFFECTIVE",
            Self::Grant(GrantUnavailableReasonV1::Expired) => "GRANT_EXPIRED",
            Self::Grant(GrantUnavailableReasonV1::Revoked) => "GRANT_REVOKED",
        }
    }

    /// The reason an authorization with these bounds is not current at `cut`.
    ///
    /// Returns `None` when the window admits the cut and the caller has not
    /// observed a revocation; the caller decides revocation separately.
    pub fn for_window(
        cut_epoch_ms: u64,
        not_before_epoch_ms: u64,
        valid_through_epoch_ms: u64,
    ) -> Option<Self> {
        if cut_epoch_ms < not_before_epoch_ms {
            Some(Self::NotYetEffective)
        } else if cut_epoch_ms >= valid_through_epoch_ms {
            Some(Self::Expired)
        } else {
            None
        }
    }
}

impl Display for OperatorAuthorizationUnavailableReasonV1 {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
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

fn is_sha256_digest(value: &str) -> bool {
    value
        .strip_prefix("sha256:")
        .is_some_and(|hex| hex.len() == 64 && hex.bytes().all(|byte| byte.is_ascii_hexdigit()))
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

    #[rstest]
    fn expired_manifest_recovery_epoch_binds_complete_old_and_new_sets() {
        let binding = |identity: &str| OperationManifestBindingV1 {
            manifest_identity: identity.into(),
            manifest_digest: format!("sha256:{identity}"),
        };
        let key = |operation: &str| ManifestSemanticKeyV1 {
            operation: operation.into(),
            operation_schema: format!("{operation}-schema"),
            target_owner: "R_AND_D".into(),
        };
        let epoch = ExpiredManifestRecoveryEpochV1::new(vec![
            ExpiredManifestRecoveryTransitionV1::Added {
                semantic_key: key("alpha.add"),
                successor_manifest: binding("manifest-added"),
            },
            ExpiredManifestRecoveryTransitionV1::Removed {
                semantic_key: key("beta.remove"),
                predecessor_manifest: binding("manifest-removed"),
            },
            ExpiredManifestRecoveryTransitionV1::Retained {
                semantic_key: key("gamma.keep"),
                predecessor_manifest: binding("manifest-retained-old"),
                successor_manifest: binding("manifest-retained-new"),
            },
        ])
        .unwrap();
        assert!(epoch.validate().is_ok());
        assert!(epoch.evolves_capability_set());
        assert_eq!(epoch.predecessor_operation_manifests().len(), 2);
        assert_eq!(epoch.successor_operation_manifests().len(), 2);

        let mut changed = epoch.clone();
        let ExpiredManifestRecoveryTransitionV1::Added {
            successor_manifest, ..
        } = &mut changed.manifest_transitions[0]
        else {
            unreachable!()
        };
        successor_manifest.manifest_digest.push_str("-changed");
        assert!(changed.validate().is_err());

        let mut duplicate_key = epoch.clone();
        let first_key = duplicate_key.manifest_transitions[0].semantic_key().clone();
        let ExpiredManifestRecoveryTransitionV1::Removed { semantic_key, .. } =
            &mut duplicate_key.manifest_transitions[1]
        else {
            unreachable!()
        };
        *semantic_key = first_key;
        assert!(duplicate_key.validate().is_err());

        let mut changed_identity = epoch;
        changed_identity
            .recovery_epoch_identity
            .push_str("-changed");
        assert!(changed_identity.validate().is_err());
    }

    fn portfolio_content(mode: PortfolioResourceModeV1) -> PortfolioResourceGrantContentV1 {
        PortfolioResourceGrantContentV1 {
            issuer_identity: "operator-authorization-owner".into(),
            issuer_key_version: "key-v1".into(),
            resource: PortfolioResourceV1 {
                principal: "principal-1".into(),
                audience: PORTFOLIO_OWNER_AUDIENCE_V1.into(),
                permission: PORTFOLIO_VIEW_PERMISSION_V1.into(),
                account_identity: "account-1".into(),
                execution_scope_identity: "execution-scope-1".into(),
                mode,
            },
            product_edge_manifest: ProductEdgeManifestBindingV1 {
                manifest_locator: "product-edge-manifest-1".into(),
                manifest_digest: format!("sha256:{}", "a".repeat(64)),
            },
            effective_at_epoch_ms: 10,
            valid_through_epoch_ms: 20,
        }
    }

    type ContentMutation = Box<dyn Fn(&mut PortfolioResourceGrantContentV1)>;

    #[rstest]
    fn portfolio_resource_grant_identity_is_canonical_and_every_coordinate_is_bound() {
        let content = portfolio_content(PortfolioResourceModeV1::Paper);
        let original = content.grant_identity().unwrap();
        assert_eq!(content.grant_identity().unwrap(), original);

        let mutations: Vec<ContentMutation> = vec![
            Box::new(|value| value.issuer_identity.push_str("-other")),
            Box::new(|value| value.issuer_key_version.push_str("-other")),
            Box::new(|value| value.resource.principal.push_str("-other")),
            Box::new(|value| value.resource.audience.push_str("-other")),
            Box::new(|value| value.resource.permission.push_str("-other")),
            Box::new(|value| value.resource.account_identity.push_str("-other")),
            Box::new(|value| value.resource.execution_scope_identity.push_str("-other")),
            Box::new(|value| value.resource.mode = PortfolioResourceModeV1::Live),
            Box::new(|value| value.effective_at_epoch_ms += 1),
            Box::new(|value| value.valid_through_epoch_ms += 1),
            Box::new(|value| {
                value
                    .product_edge_manifest
                    .manifest_locator
                    .push_str("-other");
            }),
            Box::new(|value| {
                value
                    .product_edge_manifest
                    .manifest_digest
                    .replace_range(7..8, "b");
            }),
        ];

        for mutate in mutations {
            let mut changed = content.clone();
            mutate(&mut changed);
            if changed.validate().is_ok() {
                assert_ne!(changed.grant_identity().unwrap(), original);
            }
        }
    }

    #[rstest]
    fn portfolio_resource_grant_rejects_encoded_coordinates_and_malformed_digest() {
        let content = portfolio_content(PortfolioResourceModeV1::Paper);
        let mut proposal = PortfolioResourceGrantIssuanceProposalV1 {
            grant_identity: content.grant_identity().unwrap(),
            content,
            expected_revocation_frontier_identity: "EMPTY".into(),
        };
        assert!(proposal.validate().is_ok());

        proposal.content.resource.permission = "portfolio:view:account-1".into();
        assert!(proposal.validate().is_err());
        proposal.content.resource.permission = PORTFOLIO_VIEW_PERMISSION_V1.into();
        proposal.content.product_edge_manifest.manifest_digest = "sha256:caller-payload".into();
        assert!(proposal.validate().is_err());
    }
}
