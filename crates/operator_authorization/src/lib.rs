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
    parse_untrusted_portfolio_resource_grant_envelope_v1, resolve_authorization_in_transaction,
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
    pub mode: PortfolioResourceModeV1,
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PortfolioResourceModeV1 {
    Paper,
    Live,
}

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
        canonical_digest(
            "operator-authorization.portfolio-resource-grant-content.v1",
            self,
        )
    }

    pub fn grant_identity(&self) -> Result<String, OperatorAuthorizationError> {
        Ok(identity(
            "operator-authorization-portfolio-resource-grant-v1",
            &[&self.content_digest()?],
        ))
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PortfolioResourceGrantIssuanceProposalV1 {
    pub grant_identity: String,
    pub content: PortfolioResourceGrantContentV1,
    pub expected_revocation_frontier_identity: String,
}

impl PortfolioResourceGrantIssuanceProposalV1 {
    pub fn validate(&self) -> Result<(), OperatorAuthorizationError> {
        self.content.validate()?;
        if self.grant_identity != self.content.grant_identity()?
            || self.expected_revocation_frontier_identity.trim().is_empty()
        {
            return Err(OperatorAuthorizationError::InvalidProposal(
                "portfolio resource grant issuance",
            ));
        }
        Ok(())
    }

    pub fn semantic_digest(&self) -> Result<String, OperatorAuthorizationError> {
        self.validate()?;
        canonical_digest(
            "operator-authorization.portfolio-resource-grant-issuance.v1",
            self,
        )
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PortfolioResourceGrantLocatorV1 {
    pub grant_identity: String,
    pub issuance_receipt_identity: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PortfolioResourceGrantSuccessorProposalV1 {
    pub predecessor: PortfolioResourceGrantLocatorV1,
    pub expected_current_frontier_identity: String,
    pub successor: PortfolioResourceGrantIssuanceProposalV1,
}

impl PortfolioResourceGrantSuccessorProposalV1 {
    pub fn validate(&self) -> Result<(), OperatorAuthorizationError> {
        self.successor.validate()?;

        if self.predecessor.grant_identity.trim().is_empty()
            || self.predecessor.issuance_receipt_identity.trim().is_empty()
            || self.expected_current_frontier_identity.trim().is_empty()
            || self.successor.grant_identity == self.predecessor.grant_identity
            || self.successor.expected_revocation_frontier_identity
                != self.expected_current_frontier_identity
        {
            return Err(OperatorAuthorizationError::InvalidProposal(
                "portfolio resource grant successor",
            ));
        }
        Ok(())
    }

    pub fn semantic_digest(&self) -> Result<String, OperatorAuthorizationError> {
        self.validate()?;
        canonical_digest(
            "operator-authorization.portfolio-resource-grant-successor.v1",
            self,
        )
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PortfolioResourceGrantRevocationProposalV1 {
    pub grant: PortfolioResourceGrantLocatorV1,
    pub expected_frontier_identity: String,
    pub reason_code: String,
}

impl PortfolioResourceGrantRevocationProposalV1 {
    pub fn validate(&self) -> Result<(), OperatorAuthorizationError> {
        if self.grant.grant_identity.trim().is_empty()
            || self.grant.issuance_receipt_identity.trim().is_empty()
            || self.expected_frontier_identity.trim().is_empty()
            || self.reason_code.trim().is_empty()
        {
            return Err(OperatorAuthorizationError::InvalidProposal(
                "portfolio resource grant revocation",
            ));
        }
        Ok(())
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

        if self.locator.grant_identity.trim().is_empty()
            || self.locator.issuance_receipt_identity.trim().is_empty()
        {
            return Err(OperatorAuthorizationError::InvalidProposal(
                "portfolio resource grant read",
            ));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PortfolioResourceGrantIssuanceReceiptV1 {
    schema_version: u32,
    receipt_identity: String,
    grant_identity: String,
    issuance_digest: String,
    committed_at_epoch_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PortfolioResourceGrantRevocationFrontierV1 {
    schema_version: u32,
    frontier_identity: String,
    resource_digest: String,
    sequence: u64,
    predecessor_frontier_identity: Option<String>,
    revoked_grant_identities: Vec<String>,
    committed_at_epoch_ms: u64,
}

impl PortfolioResourceGrantRevocationFrontierV1 {
    pub fn frontier_identity(&self) -> &str {
        &self.frontier_identity
    }
    pub fn revoked_grant_identities(&self) -> &[String] {
        &self.revoked_grant_identities
    }
}

/// OA-sealed positive Portfolio resource grant. It is serialize-only and has
/// no public constructor or deserializer.
///
/// ```compile_fail
/// use vibe_operator_authorization::PortfolioResourceGrantReadbackV1;
/// let _: PortfolioResourceGrantReadbackV1 = serde_json::from_str("{}").unwrap();
/// ```
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PortfolioResourceGrantReadbackV1 {
    issuance_receipt: PortfolioResourceGrantIssuanceReceiptV1,
    frontier: PortfolioResourceGrantRevocationFrontierV1,
    content: PortfolioResourceGrantContentV1,
    observed_at_epoch_ms: u64,
}

impl PortfolioResourceGrantReadbackV1 {
    pub fn locator(&self) -> PortfolioResourceGrantLocatorV1 {
        PortfolioResourceGrantLocatorV1 {
            grant_identity: self.issuance_receipt.grant_identity.clone(),
            issuance_receipt_identity: self.issuance_receipt.receipt_identity.clone(),
        }
    }
    pub fn frontier(&self) -> &PortfolioResourceGrantRevocationFrontierV1 {
        &self.frontier
    }
    pub fn content(&self) -> &PortfolioResourceGrantContentV1 {
        &self.content
    }
    pub fn observed_at_epoch_ms(&self) -> u64 {
        self.observed_at_epoch_ms
    }
}

/// Canonically consistent locked Portfolio grant bytes without Owner provenance.
///
/// Parsing untrusted bytes can produce this evidence, so it is explicitly not
/// an authorization, a Portfolio availability decision, or permission for any
/// read, write, or effect. A consuming Owner must retain the source database
/// locks, compare its own custody, sample its later cut, and call
/// [`Self::is_current_at`] before making its own fail-closed decision.
///
/// The type has private fields, no public constructor, no deserializer, and no
/// conversion into [`PortfolioResourceGrantReadbackV1`].
///
/// ```compile_fail
/// use vibe_operator_authorization::UntrustedCanonicalPortfolioResourceGrantEvidenceV1;
/// let _: UntrustedCanonicalPortfolioResourceGrantEvidenceV1 =
///     serde_json::from_str("{}").unwrap();
/// ```
///
/// ```compile_fail
/// use vibe_operator_authorization::UntrustedCanonicalPortfolioResourceGrantEvidenceV1;
/// let _ = UntrustedCanonicalPortfolioResourceGrantEvidenceV1 {};
/// ```
///
/// ```compile_fail
/// use vibe_operator_authorization::{
///     PortfolioResourceGrantReadbackV1,
///     UntrustedCanonicalPortfolioResourceGrantEvidenceV1,
/// };
/// fn promote(
///     evidence: UntrustedCanonicalPortfolioResourceGrantEvidenceV1,
/// ) -> PortfolioResourceGrantReadbackV1 {
///     evidence.into()
/// }
/// ```
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct UntrustedCanonicalPortfolioResourceGrantEvidenceV1 {
    schema_version: u32,
    issuance_receipt: PortfolioResourceGrantIssuanceReceiptV1,
    frontier: PortfolioResourceGrantRevocationFrontierV1,
    content: PortfolioResourceGrantContentV1,
}

impl UntrustedCanonicalPortfolioResourceGrantEvidenceV1 {
    pub fn locator(&self) -> PortfolioResourceGrantLocatorV1 {
        PortfolioResourceGrantLocatorV1 {
            grant_identity: self.issuance_receipt.grant_identity.clone(),
            issuance_receipt_identity: self.issuance_receipt.receipt_identity.clone(),
        }
    }

    pub fn frontier_identity(&self) -> &str {
        &self.frontier.frontier_identity
    }

    pub fn matches_resource(&self, expected: &PortfolioResourceV1) -> bool {
        &self.content.resource == expected
    }

    pub fn matches_product_edge_manifest(&self, expected: &ProductEdgeManifestBindingV1) -> bool {
        &self.content.product_edge_manifest == expected
    }

    pub fn is_current_at(&self, cut_epoch_ms: u64) -> bool {
        cut_epoch_ms >= self.content.effective_at_epoch_ms
            && cut_epoch_ms < self.content.valid_through_epoch_ms
            && !self
                .frontier
                .revoked_grant_identities
                .contains(&self.issuance_receipt.grant_identity)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PortfolioResourceGrantUnavailableReasonV1 {
    InvalidRequest,
    OwnerUnavailable,
    ResourceMismatch,
    ManifestMismatch,
    NotEffective,
    Expired,
    Revoked,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "availability", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PortfolioResourceGrantResolutionV1 {
    Available {
        grant: Box<PortfolioResourceGrantReadbackV1>,
    },
    Unavailable {
        reason: PortfolioResourceGrantUnavailableReasonV1,
    },
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
