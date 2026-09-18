//! One grant kind, many grants: the shape every issuer-signed resource grant shares.
//!
//! A grant binds one content-addressed authorization content to one resource
//! history with its own append-only revocation frontier. The Portfolio resource
//! grant and the Autonomous Policy Authorization are two kinds of the same
//! shape; each kind supplies only its content type, its resource key, and the
//! stems that name its digest domains and tables. Every kind's bytes, digests,
//! and table names are derived from those stems exactly as the first kind's
//! were, so introducing the shape changed nothing a stored row can observe.

use std::fmt::Debug;

use serde::{Deserialize, Serialize, de::DeserializeOwned};

use crate::{OperatorAuthorizationError, canonical_digest, identity};

/// What one grant kind must supply.
///
/// `KIND_STEM` names the kind in identity and digest domains
/// (`operator-authorization-<stem>-...`); `TABLE_STEM` names its four
/// PostgreSQL tables and its consumer lock function. `MIRROR_COLUMNS` are the
/// kind-specific columns the issuance table mirrors from the content so the
/// database can index and verify them, in the order `mirror_values` returns.
pub trait GrantContentV1: Clone + Debug + Eq + Serialize + DeserializeOwned + 'static {
    /// The coordinates a consumer expects a grant to match.
    type Expected<'a>;

    const KIND_STEM: &'static str;
    const TABLE_STEM: &'static str;
    const SCHEMA_VERSION: u32;
    /// The roles that may execute the consumer lock function, as one SQL list.
    const CONSUMER_ROLES: &'static str;
    const MIRROR_COLUMNS: &'static [&'static str];

    fn validate(&self) -> Result<(), OperatorAuthorizationError>;
    fn grant_identity(&self) -> Result<String, OperatorAuthorizationError>;
    /// Digest of the resource this grant belongs to; one revocation history per resource.
    fn resource_digest(&self) -> Result<String, OperatorAuthorizationError>;
    fn issuer_identity(&self) -> &str;
    fn issuer_key_version(&self) -> &str;
    fn effective_at_epoch_ms(&self) -> u64;
    fn valid_through_epoch_ms(&self) -> u64;
    /// Whether a successor stays on the same resource as its predecessor.
    fn same_resource(&self, other: &Self) -> bool;
    fn mirror_values(&self) -> Result<Vec<String>, OperatorAuthorizationError>;
    fn resource_matches(&self, expected: &Self::Expected<'_>) -> bool;
    fn manifest_matches(&self, expected: &Self::Expected<'_>) -> bool;

    fn grant_identity_domain() -> String {
        format!("operator-authorization-{}-v1", Self::KIND_STEM)
    }
    fn content_digest_domain() -> String {
        format!("operator-authorization.{}-content.v1", Self::KIND_STEM)
    }
    fn issuance_digest_domain() -> String {
        format!("operator-authorization.{}-issuance.v1", Self::KIND_STEM)
    }
    fn successor_digest_domain() -> String {
        format!("operator-authorization.{}-successor.v1", Self::KIND_STEM)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GrantLocatorV1 {
    pub grant_identity: String,
    pub issuance_receipt_identity: String,
}

impl GrantLocatorV1 {
    pub(crate) fn validate(&self) -> Result<(), OperatorAuthorizationError> {
        if self.grant_identity.trim().is_empty() || self.issuance_receipt_identity.trim().is_empty()
        {
            return Err(OperatorAuthorizationError::InvalidProposal("grant locator"));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GrantIssuanceProposalV1<C> {
    pub grant_identity: String,
    pub content: C,
    pub expected_revocation_frontier_identity: String,
}

impl<C: GrantContentV1> GrantIssuanceProposalV1<C> {
    pub fn validate(&self) -> Result<(), OperatorAuthorizationError> {
        self.content.validate()?;
        if self.grant_identity != self.content.grant_identity()?
            || self.expected_revocation_frontier_identity.trim().is_empty()
        {
            return Err(OperatorAuthorizationError::InvalidProposal(
                "grant issuance",
            ));
        }
        Ok(())
    }

    pub fn semantic_digest(&self) -> Result<String, OperatorAuthorizationError> {
        self.validate()?;
        canonical_digest(&C::issuance_digest_domain(), self)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GrantSuccessorProposalV1<C> {
    pub predecessor: GrantLocatorV1,
    pub expected_current_frontier_identity: String,
    pub successor: GrantIssuanceProposalV1<C>,
}

impl<C: GrantContentV1> GrantSuccessorProposalV1<C> {
    pub fn validate(&self) -> Result<(), OperatorAuthorizationError> {
        self.successor.validate()?;

        if self.predecessor.validate().is_err()
            || self.expected_current_frontier_identity.trim().is_empty()
            || self.successor.grant_identity == self.predecessor.grant_identity
            || self.successor.expected_revocation_frontier_identity
                != self.expected_current_frontier_identity
        {
            return Err(OperatorAuthorizationError::InvalidProposal(
                "grant successor",
            ));
        }
        Ok(())
    }

    pub fn semantic_digest(&self) -> Result<String, OperatorAuthorizationError> {
        self.validate()?;
        canonical_digest(&C::successor_digest_domain(), self)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GrantRevocationProposalV1 {
    pub grant: GrantLocatorV1,
    pub expected_frontier_identity: String,
    pub reason_code: String,
}

impl GrantRevocationProposalV1 {
    pub fn validate(&self) -> Result<(), OperatorAuthorizationError> {
        if self.grant.validate().is_err()
            || self.expected_frontier_identity.trim().is_empty()
            || self.reason_code.trim().is_empty()
        {
            return Err(OperatorAuthorizationError::InvalidProposal(
                "grant revocation",
            ));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct GrantIssuanceReceiptV1 {
    pub(crate) schema_version: u32,
    pub(crate) receipt_identity: String,
    pub(crate) grant_identity: String,
    pub(crate) issuance_digest: String,
    pub(crate) committed_at_epoch_ms: u64,
}

impl GrantIssuanceReceiptV1 {
    pub fn receipt_identity(&self) -> &str {
        &self.receipt_identity
    }
    pub fn grant_identity(&self) -> &str {
        &self.grant_identity
    }
    pub fn issuance_digest(&self) -> &str {
        &self.issuance_digest
    }
    pub fn committed_at_epoch_ms(&self) -> u64 {
        self.committed_at_epoch_ms
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct GrantRevocationFrontierV1 {
    pub(crate) schema_version: u32,
    pub(crate) frontier_identity: String,
    pub(crate) resource_digest: String,
    pub(crate) sequence: u64,
    pub(crate) predecessor_frontier_identity: Option<String>,
    pub(crate) revoked_grant_identities: Vec<String>,
    pub(crate) committed_at_epoch_ms: u64,
}

impl GrantRevocationFrontierV1 {
    pub fn frontier_identity(&self) -> &str {
        &self.frontier_identity
    }
    pub fn resource_digest(&self) -> &str {
        &self.resource_digest
    }
    pub fn sequence(&self) -> u64 {
        self.sequence
    }
    pub fn revoked_grant_identities(&self) -> &[String] {
        &self.revoked_grant_identities
    }
    pub fn committed_at_epoch_ms(&self) -> u64 {
        self.committed_at_epoch_ms
    }
}

/// Issuer-sealed positive grant. It is serialize-only and has no public
/// constructor or deserializer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct GrantReadbackV1<C> {
    pub(crate) issuance_receipt: GrantIssuanceReceiptV1,
    pub(crate) frontier: GrantRevocationFrontierV1,
    pub(crate) content: C,
    pub(crate) observed_at_epoch_ms: u64,
}

impl<C> GrantReadbackV1<C> {
    pub fn locator(&self) -> GrantLocatorV1 {
        GrantLocatorV1 {
            grant_identity: self.issuance_receipt.grant_identity.clone(),
            issuance_receipt_identity: self.issuance_receipt.receipt_identity.clone(),
        }
    }
    pub fn issuance_receipt(&self) -> &GrantIssuanceReceiptV1 {
        &self.issuance_receipt
    }
    pub fn frontier(&self) -> &GrantRevocationFrontierV1 {
        &self.frontier
    }
    pub fn content(&self) -> &C {
        &self.content
    }
    pub fn observed_at_epoch_ms(&self) -> u64 {
        self.observed_at_epoch_ms
    }
}

/// Canonically consistent locked grant bytes without Owner provenance.
///
/// Parsing untrusted bytes can produce this evidence, so it is explicitly not
/// an authorization, an availability decision, or permission for any read,
/// write, or effect. A consuming Owner must retain the source database locks,
/// compare its own custody, sample its later cut, and call
/// [`Self::is_current_at`] before making its own fail-closed decision.
///
/// The type has private fields, no public constructor, no deserializer, and no
/// conversion into [`GrantReadbackV1`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct UntrustedCanonicalGrantEvidenceV1<C> {
    pub(crate) schema_version: u32,
    pub(crate) issuance_receipt: GrantIssuanceReceiptV1,
    pub(crate) frontier: GrantRevocationFrontierV1,
    pub(crate) content: C,
}

impl<C: GrantContentV1> UntrustedCanonicalGrantEvidenceV1<C> {
    pub fn locator(&self) -> GrantLocatorV1 {
        GrantLocatorV1 {
            grant_identity: self.issuance_receipt.grant_identity.clone(),
            issuance_receipt_identity: self.issuance_receipt.receipt_identity.clone(),
        }
    }

    pub fn frontier_identity(&self) -> &str {
        &self.frontier.frontier_identity
    }

    pub fn content(&self) -> &C {
        &self.content
    }

    /// Whether the grant's resource is the one the consumer expected.
    pub fn matches_expected_resource(&self, expected: &C::Expected<'_>) -> bool {
        self.content.resource_matches(expected)
    }

    /// Whether the grant's manifest binding is the one the consumer expected.
    pub fn matches_expected_manifest(&self, expected: &C::Expected<'_>) -> bool {
        self.content.manifest_matches(expected)
    }

    pub fn is_current_at(&self, cut_epoch_ms: u64) -> bool {
        cut_epoch_ms >= self.content.effective_at_epoch_ms()
            && cut_epoch_ms < self.content.valid_through_epoch_ms()
            && !self
                .frontier
                .revoked_grant_identities
                .contains(&self.issuance_receipt.grant_identity)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum GrantUnavailableReasonV1 {
    InvalidRequest,
    OwnerUnavailable,
    ResourceMismatch,
    ManifestMismatch,
    NotEffective,
    Expired,
    Revoked,
}

impl GrantUnavailableReasonV1 {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::InvalidRequest => "INVALID_REQUEST",
            Self::OwnerUnavailable => "OWNER_UNAVAILABLE",
            Self::ResourceMismatch => "RESOURCE_MISMATCH",
            Self::ManifestMismatch => "MANIFEST_MISMATCH",
            Self::NotEffective => "NOT_EFFECTIVE",
            Self::Expired => "EXPIRED",
            Self::Revoked => "REVOKED",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "availability", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum GrantResolutionV1<C> {
    Available { grant: Box<GrantReadbackV1<C>> },
    Unavailable { reason: GrantUnavailableReasonV1 },
}

/// Identity of one grant from its content digest, in the kind's domain.
pub(crate) fn grant_identity_for<C: GrantContentV1>(content_digest: &str) -> String {
    identity(&C::grant_identity_domain(), &[content_digest])
}
