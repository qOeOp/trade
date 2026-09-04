//! Durable Market Data authority for requester-defined Universe Selection.
//!
//! The request carries a selection rule and eligible frontier, never selected members. Positive
//! membership and readback values have no public constructor or deserializer and the resolver is
//! crate-sealed. Instrument Master may consume this readback, but this module does not depend on
//! Instrument Master.
//!
//! ```compile_fail
//! use vibe_data::owner::universe_selection::UniverseSelectionReadbackV1;
//! let _ = UniverseSelectionReadbackV1 {};
//! ```
//!
//! ```compile_fail
//! use vibe_data::owner::universe_selection::UniverseSelectionReadbackV1;
//! let _: UniverseSelectionReadbackV1 = serde_json::from_str("{}").unwrap();
//! ```

use std::fmt::Display;

use super::source_binding::BindingDigest;

pub(super) mod authority;
pub(crate) mod codec;

#[cfg(test)]
mod tests;

pub use authority::verify_universe_selection_readback_v1;

pub type UniverseSelectionIdentity = BindingDigest;

/// Untrusted idempotency key plus requester-owned selection meaning. It contains no members.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UntrustedUniverseSelectionRequestV1 {
    request_identity: UniverseSelectionIdentity,
    request_meaning_digest: UniverseSelectionIdentity,
    requester_role: String,
    selection_rule_identity: UniverseSelectionIdentity,
    selection_rule_bytes: Box<[u8]>,
    eligible_instrument_frontier: UniverseSelectionIdentity,
    effective_at_ns: i128,
    owner_observation_ns: i128,
    decision_cut: u64,
    source_binding_lineage_root: UniverseSelectionIdentity,
    correction_frontier_digest: UniverseSelectionIdentity,
    stable_correlation: UniverseSelectionIdentity,
}

impl UntrustedUniverseSelectionRequestV1 {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        request_identity: UniverseSelectionIdentity,
        requester_role: impl Into<String>,
        selection_rule_identity: UniverseSelectionIdentity,
        selection_rule_bytes: impl Into<Box<[u8]>>,
        eligible_instrument_frontier: UniverseSelectionIdentity,
        effective_at_ns: i128,
        owner_observation_ns: i128,
        decision_cut: u64,
        source_binding_lineage_root: UniverseSelectionIdentity,
        correction_frontier_digest: UniverseSelectionIdentity,
        stable_correlation: UniverseSelectionIdentity,
    ) -> Self {
        let mut request = Self {
            request_identity,
            request_meaning_digest: BindingDigest::from_untrusted_bytes([0; 32]),
            requester_role: requester_role.into(),
            selection_rule_identity,
            selection_rule_bytes: selection_rule_bytes.into(),
            eligible_instrument_frontier,
            effective_at_ns,
            owner_observation_ns,
            decision_cut,
            source_binding_lineage_root,
            correction_frontier_digest,
            stable_correlation,
        };
        request.request_meaning_digest = authority::request_meaning_digest(&request)
            .unwrap_or(BindingDigest::from_untrusted_bytes([0; 32]));
        request
    }

    pub const fn request_identity(&self) -> UniverseSelectionIdentity {
        self.request_identity
    }
    pub const fn request_meaning_digest(&self) -> UniverseSelectionIdentity {
        self.request_meaning_digest
    }
    pub fn requester_role(&self) -> &str {
        &self.requester_role
    }
    pub const fn selection_rule_identity(&self) -> UniverseSelectionIdentity {
        self.selection_rule_identity
    }
    pub fn selection_rule_bytes(&self) -> &[u8] {
        &self.selection_rule_bytes
    }
    pub const fn eligible_instrument_frontier(&self) -> UniverseSelectionIdentity {
        self.eligible_instrument_frontier
    }
    pub const fn effective_at_ns(&self) -> i128 {
        self.effective_at_ns
    }
    pub const fn owner_observation_ns(&self) -> i128 {
        self.owner_observation_ns
    }
    pub const fn decision_cut(&self) -> u64 {
        self.decision_cut
    }
    pub const fn source_binding_lineage_root(&self) -> UniverseSelectionIdentity {
        self.source_binding_lineage_root
    }
    pub const fn correction_frontier_digest(&self) -> UniverseSelectionIdentity {
        self.correction_frontier_digest
    }
    pub const fn stable_correlation(&self) -> UniverseSelectionIdentity {
        self.stable_correlation
    }
    pub fn locator(&self) -> UntrustedUniverseSelectionLocatorV1 {
        UntrustedUniverseSelectionLocatorV1 {
            request_identity: self.request_identity,
            request_meaning_digest: self.request_meaning_digest,
        }
    }
}

/// Exact identity/meaning pair used for response-loss recovery.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct UntrustedUniverseSelectionLocatorV1 {
    request_identity: UniverseSelectionIdentity,
    request_meaning_digest: UniverseSelectionIdentity,
}

impl UntrustedUniverseSelectionLocatorV1 {
    pub const fn from_untrusted(
        request_identity: UniverseSelectionIdentity,
        request_meaning_digest: UniverseSelectionIdentity,
    ) -> Self {
        Self {
            request_identity,
            request_meaning_digest,
        }
    }
    pub const fn request_identity(&self) -> UniverseSelectionIdentity {
        self.request_identity
    }
    pub const fn request_meaning_digest(&self) -> UniverseSelectionIdentity {
        self.request_meaning_digest
    }
}

/// One effective-dated historical membership disposition selected by Market Data.
#[derive(Debug, Eq, PartialEq)]
pub struct HistoricalMembershipRecordV1 {
    member_key: Box<[u8]>,
    instrument: Box<[u8]>,
    included: bool,
    exclusion_reason: Option<Box<[u8]>>,
    predecessor_identity: Option<UniverseSelectionIdentity>,
    eligible_instrument_frontier: UniverseSelectionIdentity,
    decision_cut: u64,
    source_binding_lineage_root: UniverseSelectionIdentity,
    correction_frontier_digest: UniverseSelectionIdentity,
    effective_from_ns: i128,
    effective_until_ns: Option<i128>,
    provider_available_ns: i128,
    retrieval_ns: i128,
    correction_publication_ns: i128,
    owner_observation_ns: i128,
    identity: UniverseSelectionIdentity,
    canonical_bytes: Box<[u8]>,
}

impl HistoricalMembershipRecordV1 {
    pub fn member_key(&self) -> &[u8] {
        &self.member_key
    }
    pub fn instrument(&self) -> &[u8] {
        &self.instrument
    }
    pub const fn included(&self) -> bool {
        self.included
    }
    pub fn exclusion_reason(&self) -> Option<&[u8]> {
        self.exclusion_reason.as_deref()
    }
    pub const fn predecessor_identity(&self) -> Option<UniverseSelectionIdentity> {
        self.predecessor_identity
    }
    pub const fn eligible_instrument_frontier(&self) -> UniverseSelectionIdentity {
        self.eligible_instrument_frontier
    }
    pub const fn decision_cut(&self) -> u64 {
        self.decision_cut
    }
    pub const fn source_binding_lineage_root(&self) -> UniverseSelectionIdentity {
        self.source_binding_lineage_root
    }
    pub const fn correction_frontier_digest(&self) -> UniverseSelectionIdentity {
        self.correction_frontier_digest
    }
    pub const fn effective_from_ns(&self) -> i128 {
        self.effective_from_ns
    }
    pub const fn effective_until_ns(&self) -> Option<i128> {
        self.effective_until_ns
    }
    pub const fn provider_available_ns(&self) -> i128 {
        self.provider_available_ns
    }
    pub const fn retrieval_ns(&self) -> i128 {
        self.retrieval_ns
    }
    pub const fn correction_publication_ns(&self) -> i128 {
        self.correction_publication_ns
    }
    pub const fn owner_observation_ns(&self) -> i128 {
        self.owner_observation_ns
    }
    pub const fn identity(&self) -> UniverseSelectionIdentity {
        self.identity
    }
    pub const fn digest(&self) -> UniverseSelectionIdentity {
        self.identity
    }
    pub fn canonical_bytes(&self) -> &[u8] {
        &self.canonical_bytes
    }
}

/// Canonical result for one exact requester rule and eligible frontier.
#[derive(Debug, Eq, PartialEq)]
pub struct UniverseSelectionRecordV1 {
    request_identity: UniverseSelectionIdentity,
    request_meaning_digest: UniverseSelectionIdentity,
    selection_rule_identity: UniverseSelectionIdentity,
    eligible_instrument_frontier: UniverseSelectionIdentity,
    effective_at_ns: i128,
    owner_observation_ns: i128,
    decision_cut: u64,
    source_binding_lineage_root: UniverseSelectionIdentity,
    correction_frontier_digest: UniverseSelectionIdentity,
    historical_membership_cut_identity: UniverseSelectionIdentity,
    membership: Box<[HistoricalMembershipRecordV1]>,
    canonical_bytes: Box<[u8]>,
    identity: UniverseSelectionIdentity,
}

impl UniverseSelectionRecordV1 {
    pub const fn request_identity(&self) -> UniverseSelectionIdentity {
        self.request_identity
    }
    pub const fn request_meaning_digest(&self) -> UniverseSelectionIdentity {
        self.request_meaning_digest
    }
    pub const fn selection_rule_identity(&self) -> UniverseSelectionIdentity {
        self.selection_rule_identity
    }
    pub const fn eligible_instrument_frontier(&self) -> UniverseSelectionIdentity {
        self.eligible_instrument_frontier
    }
    pub const fn effective_at_ns(&self) -> i128 {
        self.effective_at_ns
    }
    pub const fn owner_observation_ns(&self) -> i128 {
        self.owner_observation_ns
    }
    pub const fn decision_cut(&self) -> u64 {
        self.decision_cut
    }
    pub const fn source_binding_lineage_root(&self) -> UniverseSelectionIdentity {
        self.source_binding_lineage_root
    }
    pub const fn correction_frontier_digest(&self) -> UniverseSelectionIdentity {
        self.correction_frontier_digest
    }
    pub const fn historical_membership_cut_identity(&self) -> UniverseSelectionIdentity {
        self.historical_membership_cut_identity
    }
    pub fn membership(&self) -> &[HistoricalMembershipRecordV1] {
        &self.membership
    }
    pub fn canonical_bytes(&self) -> &[u8] {
        &self.canonical_bytes
    }
    pub const fn identity(&self) -> UniverseSelectionIdentity {
        self.identity
    }
    pub const fn digest(&self) -> UniverseSelectionIdentity {
        self.identity
    }
}

#[derive(Debug, Eq, PartialEq)]
pub struct UniverseSelectionReceiptV1 {
    request_identity: UniverseSelectionIdentity,
    request_meaning_digest: UniverseSelectionIdentity,
    selection_identity: UniverseSelectionIdentity,
    historical_membership_cut_identity: UniverseSelectionIdentity,
    stable_correlation: UniverseSelectionIdentity,
    store_generation_identity: UniverseSelectionIdentity,
    store_append_sequence: u64,
    canonical_bytes: Box<[u8]>,
    identity: UniverseSelectionIdentity,
}

impl UniverseSelectionReceiptV1 {
    pub const fn request_identity(&self) -> UniverseSelectionIdentity {
        self.request_identity
    }
    pub const fn request_meaning_digest(&self) -> UniverseSelectionIdentity {
        self.request_meaning_digest
    }
    pub const fn selection_identity(&self) -> UniverseSelectionIdentity {
        self.selection_identity
    }
    pub const fn historical_membership_cut_identity(&self) -> UniverseSelectionIdentity {
        self.historical_membership_cut_identity
    }
    pub const fn stable_correlation(&self) -> UniverseSelectionIdentity {
        self.stable_correlation
    }
    pub const fn store_generation_identity(&self) -> UniverseSelectionIdentity {
        self.store_generation_identity
    }
    pub const fn store_append_sequence(&self) -> u64 {
        self.store_append_sequence
    }
    pub fn canonical_bytes(&self) -> &[u8] {
        &self.canonical_bytes
    }
    pub const fn identity(&self) -> UniverseSelectionIdentity {
        self.identity
    }
    pub const fn digest(&self) -> UniverseSelectionIdentity {
        self.identity
    }
}

/// Move-only positive readback.
#[derive(Debug, Eq, PartialEq)]
pub struct UniverseSelectionReadbackV1 {
    record: UniverseSelectionRecordV1,
    receipt: UniverseSelectionReceiptV1,
    outbox_identity: UniverseSelectionIdentity,
}

impl UniverseSelectionReadbackV1 {
    pub const fn record(&self) -> &UniverseSelectionRecordV1 {
        &self.record
    }
    pub const fn receipt(&self) -> &UniverseSelectionReceiptV1 {
        &self.receipt
    }
    pub const fn outbox_identity(&self) -> UniverseSelectionIdentity {
        self.outbox_identity
    }
}

#[doc(hidden)]
pub(crate) mod resolver_seal {
    pub trait Sealed {}
}

#[async_trait::async_trait]
#[allow(private_bounds)]
pub trait UniverseSelectionResolverV1: resolver_seal::Sealed + Send + Sync {
    async fn resolve_universe_selection_v1(
        &self,
        request: &UntrustedUniverseSelectionRequestV1,
    ) -> Result<UniverseSelectionReadbackV1, UniverseSelectionErrorV1>;

    async fn recover_universe_selection_v1(
        &self,
        locator: &UntrustedUniverseSelectionLocatorV1,
    ) -> Result<UniverseSelectionReadbackV1, UniverseSelectionErrorV1>;
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum UniverseSelectionErrorV1 {
    InvalidRequest,
    InvalidMembership,
    NonCanonicalOrder,
    CapacityExceeded,
    CodecMismatch,
    DigestMismatch,
    RequestConflict,
    UnknownIdentity,
    StoreUnavailable,
    EvaluatorUnavailable,
    StoreUntrusted,
    CommitInterrupted,
    ResponseLost,
}

impl Display for UniverseSelectionErrorV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{self:?}")
    }
}
impl std::error::Error for UniverseSelectionErrorV1 {}
