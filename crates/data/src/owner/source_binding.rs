//! Untrusted Market Data Source Binding proposal and locator contracts.
//!
//! Production deliberately exposes no Source Binding writer, store, commit, resolve, trusted
//! clock, positive fact, receipt, or outbox type. No Market Data composition root or durable store
//! is admitted in this crate, so positive issuance remains fail-closed. A test-only in-memory Owner
//! fixture exercises the authority contract without claiming durable persistence or restart recovery.
//!
//! A downstream crate cannot instantiate the test-only Owner or choose trusted time:
//!
//! ```compile_fail
//! use vibe_data::owner::source_binding::{
//!     MarketDataClockAdmission, TestOnlyInMemorySourceBindingOwner,
//! };
//! ```
//!
//! It cannot import or construct a positive Owner fact:
//!
//! ```compile_fail
//! use vibe_data::owner::source_binding::SourceBindingFact;
//! ```
//!
//! It cannot import a commit or receipt and bypass native readback:
//!
//! ```compile_fail
//! use vibe_data::owner::source_binding::{SourceBindingCommit, SourceBindingReceipt};
//! ```
//!
//! It cannot construct the canonical positive disposition:
//!
//! ```compile_fail
//! use vibe_data::owner::source_binding::SourceBindingDisposition;
//!
//! let forged = SourceBindingDisposition::Admitted;
//! ```

use std::{
    collections::BTreeSet,
    fmt::{Debug, Display},
};

/// A fixed-size digest supplied through an untrusted boundary.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct BindingDigest([u8; 32]);

impl BindingDigest {
    /// Wraps untrusted digest bytes. Construction grants no Owner authority.
    pub const fn from_untrusted_bytes(bytes: [u8; 32]) -> Self {
        Self(bytes)
    }

    /// Returns the digest bytes.
    pub const fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }
}

/// Untrusted adapter implementation, configuration, endpoint, dataset, and account evidence.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UntrustedAdapterBinding {
    /// Adapter implementation digest.
    pub implementation_digest: BindingDigest,
    /// Adapter configuration digest.
    pub configuration_digest: BindingDigest,
    /// Claimed authenticated endpoint identity, never a reachability assertion.
    pub authenticated_endpoint_identity: String,
    /// Dataset or feed mapping.
    pub dataset_mapping: String,
    /// Vendor tenant or entitlement mapping, not an Execution account.
    pub account_mapping: String,
}

/// Untrusted audience claim for credential custody.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub enum UntrustedCredentialAudienceClaim {
    /// Market Data only.
    MarketData,
    /// Execution authority, which Market Data must reject.
    Execution,
    /// Paper-trading authority, which Market Data must reject.
    Paper,
    /// Private account authority, which Market Data must reject.
    Account,
    /// Private order authority, which Market Data must reject.
    Order,
    /// Trading authority, which Market Data must reject.
    Trading,
    /// Any other private-effect authority, which Market Data must reject.
    PrivateEffect,
}

/// Untrusted capability claim for a Market Data credential handle.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub enum UntrustedCredentialCapabilityClaim {
    /// Read public market data.
    MarketDataRead,
    /// Read public reference data.
    ReferenceDataRead,
    /// Read read-only provider metadata.
    MetadataRead,
    /// Read private account state, which Market Data must reject.
    AccountRead,
    /// Read or mutate orders, which Market Data must reject.
    OrderReadOrWrite,
    /// Perform trading, which Market Data must reject.
    Trading,
    /// Invoke any other private effect, which Market Data must reject.
    PrivateEffect,
}

#[derive(Clone, Eq, PartialEq)]
enum UntrustedCredentialMaterialClaim {
    HandleIdentity(BindingDigest),
    RawMaterialSupplied,
}

/// Opaque least-privilege credential-handle identity supplied as untrusted evidence.
///
/// The admitted representation can contain only a fixed handle-identity digest. A caller that has
/// raw material can explicitly submit it for rejection, but those bytes are discarded immediately
/// and never retained or encoded.
#[derive(Clone, Eq, PartialEq)]
pub struct UntrustedOpaqueCredentialHandle {
    material: UntrustedCredentialMaterialClaim,
    audience: UntrustedCredentialAudienceClaim,
    capabilities: BTreeSet<UntrustedCredentialCapabilityClaim>,
}

impl UntrustedOpaqueCredentialHandle {
    /// Wraps an untrusted opaque handle identity and its claimed least-privilege scope.
    pub fn from_untrusted_identity(
        identity: BindingDigest,
        audience: UntrustedCredentialAudienceClaim,
        capabilities: impl IntoIterator<Item = UntrustedCredentialCapabilityClaim>,
    ) -> Self {
        Self {
            material: UntrustedCredentialMaterialClaim::HandleIdentity(identity),
            audience,
            capabilities: capabilities.into_iter().collect(),
        }
    }

    /// Marks caller-supplied raw material for fail-closed rejection without retaining its bytes.
    pub fn from_untrusted_raw_material(
        raw_material: impl AsRef<[u8]>,
        audience: UntrustedCredentialAudienceClaim,
        capabilities: impl IntoIterator<Item = UntrustedCredentialCapabilityClaim>,
    ) -> Self {
        let _discarded_without_retention = raw_material.as_ref();

        Self {
            material: UntrustedCredentialMaterialClaim::RawMaterialSupplied,
            audience,
            capabilities: capabilities.into_iter().collect(),
        }
    }
}

impl Debug for UntrustedOpaqueCredentialHandle {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("UntrustedOpaqueCredentialHandle([REDACTED])")
    }
}

/// Untrusted versioned source trust-policy claim.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UntrustedTrustPolicy {
    /// Stable policy identity.
    pub identity: String,
    /// Policy version.
    pub version: u64,
}

/// Complete untrusted market-meaning claim.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UntrustedMarketSemantics {
    /// Normalization rules identity.
    pub normalization: String,
    /// Raw/adjusted and adjustment rules.
    pub adjustment: String,
    /// Price, size, currency, and timestamp meaning.
    pub price_meaning: String,
    /// Effective-dated trading calendar rules.
    pub calendar_rules: String,
    /// Session rules.
    pub session_rules: String,
    /// Time-zone ruleset.
    pub timezone_rules: String,
    /// Instrument identity, venue mapping, and lifecycle rules.
    pub instrument_lifecycle_rules: String,
    /// Corporate-action and symbol-change rules.
    pub corporate_action_rules: String,
    /// Historical membership rules.
    pub membership_rules: String,
    /// Requester-owned universe-rule evaluation semantics.
    pub universe_rules: String,
    /// Revision and successor correction policy.
    pub correction_policy: String,
}

/// Complete untrusted license, retention, and redaction claim.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UntrustedLicensePolicy {
    /// Acquisition, cache, archive, derived-output, backtest, model, and display use scope.
    pub use_scope: String,
    /// Redistribution scope.
    pub redistribution_scope: String,
    /// Retention and deletion basis.
    pub retention_policy: String,
    /// Required redaction policy.
    pub redaction_policy: String,
}

/// A complete untrusted native frontier claim.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UntrustedCompleteFrontier {
    /// Stable native source or correction stream identity.
    pub stream_identity: String,
    /// Exact native cut identity within the stream.
    pub cut_identity: String,
    /// Non-zero native sequence at the cut.
    pub sequence: u64,
    /// Digest of the complete frontier at that cut and sequence.
    pub digest: BindingDigest,
}

/// Complete untrusted `MARKET_DATA_AS_OF` evidence.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UntrustedMarketDataAsOf {
    /// Claimed domain-separated identity of this complete time-evidence tuple.
    pub claimed_evidence_identity: BindingDigest,
    /// Stable clock identity.
    pub clock_identity: String,
    /// Clock epoch. Restart without continuity requires a successor epoch.
    pub clock_epoch: String,
    /// Non-zero monotonic sequence at the decision cut.
    pub monotonic_sequence: u64,
    /// Non-zero restart-continuity proof digest.
    pub restart_continuity_digest: BindingDigest,
    /// Non-zero maximum admitted clock skew or uncertainty bound.
    pub skew_bound: u64,
    /// Claimed uncertainty within the admitted skew bound.
    pub uncertainty_bound: u64,
    /// Event-effective time.
    pub event_effective: u64,
    /// Provider-available time.
    pub provider_available: u64,
    /// Retrieval time.
    pub retrieval: u64,
    /// Correction-publication time.
    pub correction_publication: u64,
    /// Time the complete evidence was observed by Market Data.
    pub observed_at: u64,
    /// Exact effective decision cut.
    pub effective_at: u64,
    /// Exclusive validity boundary.
    pub valid_through: u64,
}

#[allow(
    dead_code,
    reason = "the canonical clock is constructed only by the test-only Owner until composition exists"
)]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum MarketDataClockCutKind {
    MarketDataAsOf,
}

#[allow(
    dead_code,
    reason = "the canonical clock is constructed only by the test-only Owner until composition exists"
)]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum MarketDataClockComparisonRule {
    ExclusiveValidThrough,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct MarketDataClockAdmission {
    pub(crate) cut_kind: MarketDataClockCutKind,
    pub(crate) clock_identity: String,
    pub(crate) clock_epoch: String,
    pub(crate) monotonic_sequence: u64,
    pub(crate) wall_observed: u64,
    pub(crate) decision_cut: u64,
    pub(crate) valid_through: u64,
    pub(crate) restart_continuity_digest: BindingDigest,
    pub(crate) uncertainty_bound: u64,
    pub(crate) skew_bound: u64,
    pub(crate) comparison_rule: MarketDataClockComparisonRule,
}

#[allow(
    dead_code,
    reason = "the canonical clock is validated only by the test-only Owner until composition exists"
)]
impl MarketDataClockAdmission {
    pub(crate) fn is_complete(&self) -> bool {
        self.cut_kind == MarketDataClockCutKind::MarketDataAsOf
            && self.comparison_rule == MarketDataClockComparisonRule::ExclusiveValidThrough
            && !self.clock_identity.trim().is_empty()
            && !self.clock_epoch.trim().is_empty()
            && self.monotonic_sequence != 0
            && self.restart_continuity_digest.as_bytes() != &[0; 32]
            && self.skew_bound != 0
            && self.uncertainty_bound <= self.skew_bound
            && self.decision_cut != 0
            && self.wall_observed >= self.decision_cut
            && self.wall_observed < self.valid_through
            && self.decision_cut < self.valid_through
    }
}

/// Supported Source Binding blockers in stable Owner precedence order.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub enum SourceBindingBlocker {
    /// Rights were revoked.
    RightsRevoked,
    /// Decisive denial or missing license.
    RightsDeniedOrUnlicensed,
    /// Rights evidence is unknown or unresolved.
    RightsEvidenceUnresolved,
    /// Source, endpoint, implementation, or configuration identity mismatch.
    SourceIdentityOrConfigMismatch,
    /// Market semantics are incompatible.
    SemanticsIncompatible,
    /// The source is unavailable.
    SourceUnavailable,
    /// Evidence is stale or incomplete.
    EvidenceStaleOrIncomplete,
}

/// Untrusted Source Binding proposal. It can never mint a positive Owner fact directly.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UntrustedSourceBindingProposal {
    /// Claimed semantic binding identity; Market Data derives and compares it independently.
    pub claimed_binding_id: BindingDigest,
    /// Canonical contract version. Version one is currently supported.
    pub schema_version: u16,
    /// Untrusted adapter, endpoint, dataset, and account evidence.
    pub adapter: UntrustedAdapterBinding,
    /// Untrusted opaque credential custody handle.
    pub credential_handle: UntrustedOpaqueCredentialHandle,
    /// Untrusted trust-policy claim.
    pub trust_policy: UntrustedTrustPolicy,
    /// Complete untrusted market-semantics claim.
    pub semantics: UntrustedMarketSemantics,
    /// Complete untrusted license-policy claim.
    pub license: UntrustedLicensePolicy,
    /// Complete untrusted source frontier.
    pub source_frontier: UntrustedCompleteFrontier,
    /// Complete untrusted correction frontier.
    pub correction_frontier: UntrustedCompleteFrontier,
    /// Complete untrusted `MARKET_DATA_AS_OF` evidence.
    pub time_evidence: UntrustedMarketDataAsOf,
}

/// Untrusted locator used only for exact Owner-store resolution.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UntrustedSourceBindingLocator {
    pub(crate) owner: String,
    pub(crate) lineage_root: BindingDigest,
    pub(crate) lineage_version: u64,
    pub(crate) predecessor_binding_id: Option<BindingDigest>,
    pub(crate) predecessor_fact_digest: Option<BindingDigest>,
    pub(crate) binding_id: BindingDigest,
    pub(crate) fact_digest: BindingDigest,
    pub(crate) credential_handle_identity: BindingDigest,
    pub(crate) credential_audience: UntrustedCredentialAudienceClaim,
    pub(crate) credential_capabilities: BTreeSet<UntrustedCredentialCapabilityClaim>,
    pub(crate) source_frontier: UntrustedCompleteFrontier,
    pub(crate) correction_frontier: UntrustedCompleteFrontier,
    pub(crate) time_evidence: UntrustedMarketDataAsOf,
}

/// Public untrusted locator fields. They grant no resolution authority.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UntrustedSourceBindingLocatorFields {
    /// Claimed Owner identity.
    pub owner: String,
    /// Claimed canonical lineage root.
    pub lineage_root: BindingDigest,
    /// Claimed exactly-next lineage version.
    pub lineage_version: u64,
    /// Claimed predecessor binding identity.
    pub predecessor_binding_id: Option<BindingDigest>,
    /// Claimed predecessor fact digest.
    pub predecessor_fact_digest: Option<BindingDigest>,
    /// Claimed semantic binding identity.
    pub binding_id: BindingDigest,
    /// Claimed positive fact digest.
    pub fact_digest: BindingDigest,
    /// Claimed opaque credential-handle identity.
    pub credential_handle_identity: BindingDigest,
    /// Claimed credential audience.
    pub credential_audience: UntrustedCredentialAudienceClaim,
    /// Claimed deterministic read-only capability set.
    pub credential_capabilities: BTreeSet<UntrustedCredentialCapabilityClaim>,
    /// Complete claimed source frontier.
    pub source_frontier: UntrustedCompleteFrontier,
    /// Complete claimed correction frontier.
    pub correction_frontier: UntrustedCompleteFrontier,
    /// Complete claimed time-evidence tuple.
    pub time_evidence: UntrustedMarketDataAsOf,
}

impl UntrustedSourceBindingLocator {
    /// Constructs an untrusted locator. Construction grants no Owner authority.
    pub fn from_untrusted(fields: UntrustedSourceBindingLocatorFields) -> Self {
        Self {
            owner: fields.owner,
            lineage_root: fields.lineage_root,
            lineage_version: fields.lineage_version,
            predecessor_binding_id: fields.predecessor_binding_id,
            predecessor_fact_digest: fields.predecessor_fact_digest,
            binding_id: fields.binding_id,
            fact_digest: fields.fact_digest,
            credential_handle_identity: fields.credential_handle_identity,
            credential_audience: fields.credential_audience,
            credential_capabilities: fields.credential_capabilities,
            source_frontier: fields.source_frontier,
            correction_frontier: fields.correction_frontier,
            time_evidence: fields.time_evidence,
        }
    }
}

/// Rejected untrusted proposal or test-only Owner operation.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum SourceBindingError {
    /// A required identifier or policy field is empty.
    MissingField(&'static str),
    /// A required digest is zero.
    ZeroDigest(&'static str),
    /// A version, sequence, or skew bound is zero or unsupported.
    InvalidVersionOrSequence(&'static str),
    /// Caller identity differs from Market Data's canonical semantic identity.
    BindingIdentityMismatch,
    /// Caller time identity differs from Market Data's canonical time-evidence identity.
    TimeEvidenceIdentityMismatch,
    /// Raw credential material was supplied where only an opaque handle identity is permitted.
    RawCredentialMaterial,
    /// The claimed credential audience is not exclusively Market Data.
    InvalidCredentialAudience,
    /// The claimed credential capability set is empty or contains a private/effect capability.
    ForbiddenCredentialCapability,
    /// Owner-sealed clock evidence does not exactly cover the proposal or readback cut.
    TrustedClockMismatch,
    /// Time evidence is zero, stale, incomplete, or incorrectly ordered at the exact cut.
    InvalidTimeEvidence,
    /// The requested predecessor is not the locked current lineage head.
    LineageHeadMismatch,
    /// A successor did not strictly advance the canonical frontiers and time evidence.
    SuccessorDoesNotAdvance,
    /// The same derived identity was submitted with different canonical meaning.
    ReplayConflict,
    /// Test-only in-memory custody is unavailable.
    StoreUnavailable,
    /// A test fault occurred before the atomic commit.
    CommitInterrupted,
    /// Commit succeeded but the response was lost; an exact retry can recover it.
    ResponseLost,
    /// The untrusted locator is not an exact Owner-store receipt.
    LocatorMismatch,
}

impl Display for SourceBindingError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{self:?}")
    }
}

impl std::error::Error for SourceBindingError {}

#[cfg(test)]
pub(crate) mod authority;
#[cfg(test)]
mod tests;
