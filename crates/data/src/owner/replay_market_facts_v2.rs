//! Content-addressed Market Data facts for one replay decision cut.
//!
//! This additive contract keeps existing PIT, Source Binding, Instrument Master, observation,
//! joined-cut, and sample-projection records authoritative. It refers to those records only by
//! their exact producer identity and digest. Calendar, session, time-zone, market-semantics,
//! correction-policy, corporate-action, and historical-membership facts are represented here as
//! typed canonical records because no existing Owner record carries their complete meaning.
//!
//! A request carries only an untrusted PIT locator and replay window. It cannot submit facts,
//! dependency identities, a census, canonical bytes, or digests for this aggregate.
//!
//! Positive readback cannot be constructed or deserialized by a downstream caller:
//!
//! ```compile_fail
//! use vibe_data::owner::replay_market_facts_v2::ReplayMarketFactsReadbackV2;
//! let _forged = ReplayMarketFactsReadbackV2 {};
//! ```
//!
//! ```compile_fail
//! use vibe_data::owner::replay_market_facts_v2::ReplayMarketFactsReadbackV2;
//! let _: ReplayMarketFactsReadbackV2 = serde_json::from_str("{}").unwrap();
//! ```

use std::fmt::{Debug, Display};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::sample_projection_v4::UntrustedStrategyInputSampleProjectionLocatorV4;
use super::{pit_snapshot::UntrustedPitSnapshotLocator, source_binding::BindingDigest};

pub(super) mod authority;
mod codec;
pub(super) mod composition;
pub(super) mod postgres;

#[cfg(test)]
mod postgres_tests;
#[cfg(test)]
mod tests;

pub use authority::verify_replay_market_facts_readback_v2;
pub use composition::{
    ReplayCompositionBindingErrorV1, ReplayCompositionBindingIssuanceRequestV1,
    ReplayCompositionBindingLocatorV1, ReplayCompositionBindingReadbackV1,
    ReplayCompositionBindingResolverV1, ReplayCompositionBindingResponseV1,
    ReplayCompositionContentLocatorV1, ReplayCompositionIssuanceResponseV1,
    ReplayCompositionRequestLocatorV1, UntrustedReplayMarketFactsCompositionRequestV1,
};

/// Deployment-fixed Market Data Owner adapter for W3 positive composition.
///
/// Its database handle is private and its positive issuance method accepts the non-deserializable
/// R&D readback, so callers cannot inject a resolver or manufacture authenticated role custody.
pub struct ReplayCompositionOwnerV1 {
    pub(in crate::owner) owner: super::postgres::MarketDataOwnerPostgres,
    pub(in crate::owner) rd_role_set_pool: sqlx::PgPool,
}

/// Untrusted selectors for the exact existing Market Data custody used by sealed Composer.
///
/// These locators carry no fact authority. Market Data re-resolves every referenced receipt and
/// returns an authenticated capability only after issuing or recovering the exact V4 join.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct UntrustedComposerNativeJoinRequestV1 {
    pub joined_cut_identity: BindingDigest,
    pub joined_cut_digest: BindingDigest,
    pub frame_projection_digests: [BindingDigest; 6],
}

/// Move-only proof that Market Data issued and re-read one exact six-role V4 joined projection.
#[derive(Debug)]
pub struct AuthenticatedComposerNativeJoinV1 {
    locator: UntrustedStrategyInputSampleProjectionLocatorV4,
    joined_cut_digest: BindingDigest,
    joined_cut_receipt_digest: BindingDigest,
    schedule_dependency_set_digest: BindingDigest,
}

impl AuthenticatedComposerNativeJoinV1 {
    #[must_use]
    pub const fn locator(&self) -> &UntrustedStrategyInputSampleProjectionLocatorV4 {
        &self.locator
    }

    #[must_use]
    pub const fn joined_cut_digest(&self) -> BindingDigest {
        self.joined_cut_digest
    }

    #[must_use]
    pub const fn joined_cut_receipt_digest(&self) -> BindingDigest {
        self.joined_cut_receipt_digest
    }

    #[must_use]
    pub const fn schedule_dependency_set_digest(&self) -> BindingDigest {
        self.schedule_dependency_set_digest
    }

    pub(in crate::owner) const fn from_owner_readback(
        locator: UntrustedStrategyInputSampleProjectionLocatorV4,
        joined_cut_digest: BindingDigest,
        joined_cut_receipt_digest: BindingDigest,
        schedule_dependency_set_digest: BindingDigest,
    ) -> Self {
        Self {
            locator,
            joined_cut_digest,
            joined_cut_receipt_digest,
            schedule_dependency_set_digest,
        }
    }
}

impl Debug for ReplayCompositionOwnerV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct(stringify!(ReplayCompositionOwnerV1))
            .finish_non_exhaustive()
    }
}

/// Pre-send-known identity and canonical meaning of one Market Data issuance attempt.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ReplayCompositionIssuanceLocatorV1 {
    request_identity: BindingDigest,
    request_meaning_digest: BindingDigest,
}

impl ReplayCompositionIssuanceLocatorV1 {
    #[must_use]
    pub const fn from_untrusted(
        request_identity: BindingDigest,
        request_meaning_digest: BindingDigest,
    ) -> Self {
        Self {
            request_identity,
            request_meaning_digest,
        }
    }

    #[must_use]
    pub const fn request_identity(&self) -> BindingDigest {
        self.request_identity
    }

    #[must_use]
    pub const fn request_meaning_digest(&self) -> BindingDigest {
        self.request_meaning_digest
    }
}

/// Locator-only command whose retry/recovery identity is known before the first send.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ReplayCompositionLocatorOnlyIssuanceRequestV1 {
    issuance_locator: ReplayCompositionIssuanceLocatorV1,
    composition: ReplayCompositionBindingIssuanceRequestV1,
}

impl ReplayCompositionLocatorOnlyIssuanceRequestV1 {
    /// Creates a command whose recovery identity and canonical meaning are fixed before send.
    ///
    /// # Errors
    ///
    /// Returns [`ReplayCompositionBindingErrorV1::InvalidRequest`] if the bounded composition
    /// command cannot be canonically encoded.
    pub fn new(
        request_identity: BindingDigest,
        composition: ReplayCompositionBindingIssuanceRequestV1,
    ) -> Result<Self, ReplayCompositionBindingErrorV1> {
        if request_identity.as_bytes() == &[0; 32] {
            return Err(ReplayCompositionBindingErrorV1::InvalidRequest);
        }
        let request_meaning_digest = replay_composition_issuance_meaning_digest_v1(&composition)?;
        Ok(Self {
            issuance_locator: ReplayCompositionIssuanceLocatorV1 {
                request_identity,
                request_meaning_digest,
            },
            composition,
        })
    }

    #[must_use]
    pub const fn from_untrusted(
        issuance_locator: ReplayCompositionIssuanceLocatorV1,
        composition: ReplayCompositionBindingIssuanceRequestV1,
    ) -> Self {
        Self {
            issuance_locator,
            composition,
        }
    }

    #[must_use]
    pub const fn issuance_locator(&self) -> ReplayCompositionIssuanceLocatorV1 {
        self.issuance_locator
    }

    #[must_use]
    pub const fn composition(&self) -> &ReplayCompositionBindingIssuanceRequestV1 {
        &self.composition
    }
}

/// Canonical pre-send meaning digest for a locator-only issuance command.
///
/// # Errors
///
/// Returns [`ReplayCompositionBindingErrorV1::InvalidRequest`] if the bounded composition command
/// cannot be canonically encoded.
pub fn replay_composition_issuance_meaning_digest_v1(
    composition: &ReplayCompositionBindingIssuanceRequestV1,
) -> Result<BindingDigest, ReplayCompositionBindingErrorV1> {
    let bytes = serde_json::to_vec(composition)
        .map_err(|_| ReplayCompositionBindingErrorV1::InvalidRequest)?;
    let mut hasher = Sha256::new();
    hasher.update(b"market-data.replay-composition-issuance-meaning.v1\0");
    hasher.update(bytes);
    Ok(BindingDigest::from_untrusted_bytes(
        hasher.finalize().into(),
    ))
}

/// Exact persisted response bytes returned for first issuance and every identical retry.
#[derive(Debug, Eq, PartialEq)]
pub struct ReplayCompositionDurableIssuanceResponseV1 {
    canonical_bytes: Box<[u8]>,
}

impl ReplayCompositionDurableIssuanceResponseV1 {
    pub(in crate::owner) fn from_exact_storage(bytes: Vec<u8>) -> Self {
        Self {
            canonical_bytes: bytes.into_boxed_slice(),
        }
    }

    #[must_use]
    pub fn canonical_bytes(&self) -> &[u8] {
        &self.canonical_bytes
    }
}

/// Untrusted request for one exact replay interval over a previously identified PIT snapshot.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UntrustedReplayMarketFactsRequestV2 {
    pit_locator: UntrustedPitSnapshotLocator,
    replay_start_event_ns: i128,
    replay_end_event_ns_exclusive: i128,
}

impl UntrustedReplayMarketFactsRequestV2 {
    /// Creates a request without accepting any caller-authored positive fact or census.
    pub const fn new(
        pit_locator: UntrustedPitSnapshotLocator,
        replay_start_event_ns: i128,
        replay_end_event_ns_exclusive: i128,
    ) -> Self {
        Self {
            pit_locator,
            replay_start_event_ns,
            replay_end_event_ns_exclusive,
        }
    }

    pub const fn pit_locator(&self) -> &UntrustedPitSnapshotLocator {
        &self.pit_locator
    }

    pub const fn replay_start_event_ns(&self) -> i128 {
        self.replay_start_event_ns
    }

    pub const fn replay_end_event_ns_exclusive(&self) -> i128 {
        self.replay_end_event_ns_exclusive
    }
}

/// Kinds of canonical reference facts first owned by this V2 model.
#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
#[repr(u16)]
pub enum ReplayReferenceFactKindV2 {
    Calendar = 1,
    Session = 2,
    TimeZone = 3,
    MarketSemantics = 4,
    CorrectionPolicy = 5,
    CorporateAction = 6,
    HistoricalMembership = 7,
}

/// Whether prices in a semantic cut are raw or adjusted.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u16)]
pub enum ReplayPriceAdjustmentV2 {
    Raw = 1,
    SplitAdjusted = 2,
    TotalReturnAdjusted = 3,
}

/// Timestamp interpretation sealed into market meaning.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u16)]
pub enum ReplayTimestampBasisV2 {
    EventEffective = 1,
    IntervalOpen = 2,
    IntervalClose = 3,
}

/// Actual corporate-action terms. A content digest alone is never an action fact.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ReplayCorporateActionTermsV2 {
    Split {
        numerator: u64,
        denominator: u64,
    },
    CashDividend {
        mantissa: i128,
        scale: u8,
        currency_identity: Vec<u8>,
    },
    SymbolChange {
        successor_instrument: Vec<u8>,
    },
    Expiry,
    Roll {
        successor_instrument: Vec<u8>,
    },
}

/// Typed fact meaning retained in canonical bytes.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ReplayReferenceFactValueV2 {
    Calendar {
        calendar_identity: Vec<u8>,
        trading_day: i32,
        is_open: bool,
    },
    Session {
        session_identity: Vec<u8>,
        calendar_identity: Vec<u8>,
        opens_at_ns: i128,
        closes_at_ns: i128,
    },
    TimeZone {
        time_zone_identity: Vec<u8>,
        ruleset_identity: BindingDigest,
        offset_seconds: i32,
    },
    MarketSemantics {
        normalization_identity: BindingDigest,
        price_adjustment: ReplayPriceAdjustmentV2,
        timestamp_basis: ReplayTimestampBasisV2,
        price_unit_identity: BindingDigest,
        size_unit_identity: BindingDigest,
    },
    CorrectionPolicy {
        stream_identity: Vec<u8>,
        sequence: u64,
        successor_only: bool,
    },
    CorporateAction {
        action_identity: BindingDigest,
        instrument: Vec<u8>,
        terms: ReplayCorporateActionTermsV2,
    },
    HistoricalMembership {
        selection_identity: BindingDigest,
        member_key: Vec<u8>,
        instrument: Vec<u8>,
        included: bool,
    },
}

impl ReplayReferenceFactValueV2 {
    pub const fn kind(&self) -> ReplayReferenceFactKindV2 {
        match self {
            Self::Calendar { .. } => ReplayReferenceFactKindV2::Calendar,
            Self::Session { .. } => ReplayReferenceFactKindV2::Session,
            Self::TimeZone { .. } => ReplayReferenceFactKindV2::TimeZone,
            Self::MarketSemantics { .. } => ReplayReferenceFactKindV2::MarketSemantics,
            Self::CorrectionPolicy { .. } => ReplayReferenceFactKindV2::CorrectionPolicy,
            Self::CorporateAction { .. } => ReplayReferenceFactKindV2::CorporateAction,
            Self::HistoricalMembership { .. } => ReplayReferenceFactKindV2::HistoricalMembership,
        }
    }
}

/// Four-time availability and half-open effective interval for one fact.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ReplayReferenceFactTimeV2 {
    pub effective_from_ns: i128,
    pub effective_until_ns: Option<i128>,
    pub provider_available_ns: i128,
    pub retrieval_ns: i128,
    pub correction_publication_ns: i128,
    pub owner_observation_ns: i128,
    pub decision_cut: u64,
}

/// Canonical immutable fact. It has neither a public constructor nor `Deserialize`.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReplayReferenceFactV2 {
    value: ReplayReferenceFactValueV2,
    time: ReplayReferenceFactTimeV2,
    scope: ReplayReferenceFactScopeV2,
    source_identity: BindingDigest,
    correction_identity: BindingDigest,
    canonical_bytes: Box<[u8]>,
    identity: BindingDigest,
}

impl ReplayReferenceFactV2 {
    pub const fn kind(&self) -> ReplayReferenceFactKindV2 {
        self.value.kind()
    }

    pub const fn value(&self) -> &ReplayReferenceFactValueV2 {
        &self.value
    }

    pub const fn time(&self) -> ReplayReferenceFactTimeV2 {
        self.time
    }

    pub const fn source_identity(&self) -> BindingDigest {
        self.source_identity
    }

    pub const fn correction_identity(&self) -> BindingDigest {
        self.correction_identity
    }

    pub fn canonical_bytes(&self) -> &[u8] {
        &self.canonical_bytes
    }

    pub const fn identity(&self) -> BindingDigest {
        self.identity
    }

    pub const fn digest(&self) -> BindingDigest {
        self.identity
    }
}

/// A complete canonical set cut. Empty is explicit and valid only for action or membership facts.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReplayReferenceFactCutV2 {
    kind: ReplayReferenceFactKindV2,
    scope: ReplayReferenceFactScopeV2,
    scope_canonical_bytes: Box<[u8]>,
    decision_cut: u64,
    facts: Box<[ReplayReferenceFactV2]>,
    canonical_bytes: Box<[u8]>,
    identity: BindingDigest,
}

impl ReplayReferenceFactCutV2 {
    pub const fn kind(&self) -> ReplayReferenceFactKindV2 {
        self.kind
    }

    pub fn scope(&self) -> &[u8] {
        &self.scope_canonical_bytes
    }

    pub const fn decision_cut(&self) -> u64 {
        self.decision_cut
    }

    pub fn facts(&self) -> &[ReplayReferenceFactV2] {
        &self.facts
    }

    pub const fn is_explicit_complete_empty(&self) -> bool {
        self.facts.is_empty()
    }

    pub fn canonical_bytes(&self) -> &[u8] {
        &self.canonical_bytes
    }

    pub const fn identity(&self) -> BindingDigest {
        self.identity
    }

    pub const fn digest(&self) -> BindingDigest {
        self.identity
    }
}

/// Structured Owner-only binding for one complete fact census.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct ReplayReferenceFactScopeV2 {
    pit_snapshot_identity: BindingDigest,
    pit_decision_cut: u64,
    pit_observed_at: u64,
    pit_valid_through: u64,
    pit_clock_digest: BindingDigest,
    replay_start_event_ns: i128,
    replay_end_event_ns_exclusive: i128,
    authority_kind: ReplayMarketDependencyKindV2,
    authority_identity: BindingDigest,
}

/// Sealed subject chain projected from the three native producer capabilities.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct ReplayNativeChainV2 {
    observation_census: ReplayMarketDependencyRefV2,
    joined_cut: ReplayMarketDependencyRefV2,
    joined_cut_observation_subject: BindingDigest,
    joined_cut_observation_subject_digest: BindingDigest,
    sample_projection: ReplayMarketDependencyRefV2,
    sample_projection_joined_cut_subject: BindingDigest,
    sample_projection_joined_cut_subject_digest: BindingDigest,
}

/// Existing producer namespaces referenced without copying their fact bytes.
#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
#[repr(u16)]
pub enum ReplayMarketDependencyKindV2 {
    PitSnapshotV1 = 1,
    SourceBindingV1 = 2,
    InstrumentMasterCutV1 = 3,
    UniverseSelectionV1 = 4,
    ObservationCensusV1 = 5,
    StrategyInputJoinedCutV1 = 6,
    StrategyInputSampleProjectionV2 = 7,
    StrategyInputSampleProjectionV4 = 8,
}

/// Exact reference to an existing immutable Owner record.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ReplayMarketDependencyRefV2 {
    kind: ReplayMarketDependencyKindV2,
    identity: BindingDigest,
    digest: BindingDigest,
}

impl ReplayMarketDependencyRefV2 {
    pub const fn kind(&self) -> ReplayMarketDependencyKindV2 {
        self.kind
    }

    pub const fn identity(&self) -> BindingDigest {
        self.identity
    }

    pub const fn digest(&self) -> BindingDigest {
        self.digest
    }
}

/// Complete dependency frontier sealed into the aggregate.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReplayMarketFactsFrontierV2 {
    dependencies: Box<[ReplayMarketDependencyRefV2]>,
    native_chain: ReplayNativeChainV2,
    reference_cut_identities: Box<[BindingDigest]>,
    canonical_bytes: Box<[u8]>,
    identity: BindingDigest,
}

impl ReplayMarketFactsFrontierV2 {
    pub fn dependencies(&self) -> &[ReplayMarketDependencyRefV2] {
        &self.dependencies
    }

    pub fn reference_cut_identities(&self) -> &[BindingDigest] {
        &self.reference_cut_identities
    }

    pub fn canonical_bytes(&self) -> &[u8] {
        &self.canonical_bytes
    }

    pub const fn identity(&self) -> BindingDigest {
        self.identity
    }

    pub const fn digest(&self) -> BindingDigest {
        self.identity
    }
}

/// One complete content-addressed replay fact cut.
#[derive(Debug, Eq, PartialEq)]
pub struct ReplayMarketFactsV2 {
    request_identity: BindingDigest,
    request_digest: BindingDigest,
    pit_snapshot_identity: BindingDigest,
    pit_fact_digest: BindingDigest,
    pit_decision_cut: u64,
    pit_observed_at: u64,
    pit_valid_through: u64,
    pit_clock_identity: Box<[u8]>,
    pit_clock_epoch: Box<[u8]>,
    replay_start_event_ns: i128,
    replay_end_event_ns_exclusive: i128,
    reference_cuts: Box<[ReplayReferenceFactCutV2]>,
    frontier: ReplayMarketFactsFrontierV2,
    canonical_bytes: Box<[u8]>,
    identity: BindingDigest,
}

impl ReplayMarketFactsV2 {
    pub const fn request_identity(&self) -> BindingDigest {
        self.request_identity
    }

    pub const fn request_digest(&self) -> BindingDigest {
        self.request_digest
    }

    pub const fn pit_snapshot_identity(&self) -> BindingDigest {
        self.pit_snapshot_identity
    }

    pub const fn pit_fact_digest(&self) -> BindingDigest {
        self.pit_fact_digest
    }

    pub const fn pit_decision_cut(&self) -> u64 {
        self.pit_decision_cut
    }

    pub const fn pit_observed_at(&self) -> u64 {
        self.pit_observed_at
    }

    pub const fn pit_valid_through(&self) -> u64 {
        self.pit_valid_through
    }

    pub const fn replay_start_event_ns(&self) -> i128 {
        self.replay_start_event_ns
    }

    pub const fn replay_end_event_ns_exclusive(&self) -> i128 {
        self.replay_end_event_ns_exclusive
    }

    pub fn reference_cuts(&self) -> &[ReplayReferenceFactCutV2] {
        &self.reference_cuts
    }

    pub const fn frontier(&self) -> &ReplayMarketFactsFrontierV2 {
        &self.frontier
    }

    pub fn canonical_bytes(&self) -> &[u8] {
        &self.canonical_bytes
    }

    pub const fn identity(&self) -> BindingDigest {
        self.identity
    }

    pub const fn digest(&self) -> BindingDigest {
        self.identity
    }
}

/// Owner receipt for the exact aggregate and frontier.
#[derive(Debug, Eq, PartialEq)]
pub struct ReplayMarketFactsReceiptV2 {
    request_identity: BindingDigest,
    facts_identity: BindingDigest,
    frontier_identity: BindingDigest,
    stable_correlation: BindingDigest,
    canonical_bytes: Box<[u8]>,
    identity: BindingDigest,
}

impl ReplayMarketFactsReceiptV2 {
    pub const fn request_identity(&self) -> BindingDigest {
        self.request_identity
    }

    pub const fn facts_identity(&self) -> BindingDigest {
        self.facts_identity
    }

    pub const fn frontier_identity(&self) -> BindingDigest {
        self.frontier_identity
    }

    pub const fn stable_correlation(&self) -> BindingDigest {
        self.stable_correlation
    }

    pub fn canonical_bytes(&self) -> &[u8] {
        &self.canonical_bytes
    }

    pub const fn identity(&self) -> BindingDigest {
        self.identity
    }

    pub const fn digest(&self) -> BindingDigest {
        self.identity
    }
}

/// Move-only Owner-sealed readback.
#[derive(Debug, Eq, PartialEq)]
pub struct ReplayMarketFactsReadbackV2 {
    facts: ReplayMarketFactsV2,
    receipt: ReplayMarketFactsReceiptV2,
}

impl ReplayMarketFactsReadbackV2 {
    pub const fn facts(&self) -> &ReplayMarketFactsV2 {
        &self.facts
    }

    pub const fn receipt(&self) -> &ReplayMarketFactsReceiptV2 {
        &self.receipt
    }
}

pub(crate) mod resolver_seal {
    pub trait Sealed {}
}

/// Dependency-neutral read-only port. Implementations remain inside Market Data.
#[async_trait::async_trait]
#[allow(private_bounds)]
pub trait ReplayMarketFactsResolverV2: resolver_seal::Sealed + Send + Sync {
    async fn resolve_replay_market_facts_v2(
        &self,
        request: &UntrustedReplayMarketFactsRequestV2,
    ) -> Result<ReplayMarketFactsReadbackV2, ReplayMarketFactsErrorV2>;
}

/// Fail-closed foundation errors. No error carries a partial positive fact or cut.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ReplayMarketFactsErrorV2 {
    InvalidRequest,
    InvalidFact,
    InvalidFactCut,
    IncompleteReferenceCuts,
    DependencyMismatch,
    NonCanonicalOrder,
    DigestMismatch,
    CanonicalEncodingUnavailable,
    CapacityExceeded,
    CustodyUnavailable,
}

impl Display for ReplayMarketFactsErrorV2 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{self:?}")
    }
}

impl std::error::Error for ReplayMarketFactsErrorV2 {}
