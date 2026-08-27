//! Untrusted PIT Market Snapshot request and persistence-port contracts.
//!
//! Production deliberately exposes no Market Data writer, positive fact, canonical disposition,
//! commit aggregate, outbox, receipt, trusted clock, or persistence port. A later composition root
//! may connect the crate-private port to durable storage, but A0 has no production mint path.
//!
//! Downstream callers cannot construct canonical availability or positive facts:
//!
//! ```compile_fail
//! use vibe_data::owner::pit_snapshot::{PitSnapshotDisposition, PitSnapshotFact};
//!
//! let forged = PitSnapshotDisposition::Available;
//! ```
//!
//! They cannot construct or persist a sealed positive aggregate:
//!
//! ```compile_fail
//! use vibe_data::owner::pit_snapshot::{
//!     PitSnapshotCommitAggregate, PitSnapshotPersistencePort,
//! };
//! ```
//!
//! Durable positive readback and its PostgreSQL composition cannot be caller-created:
//!
//! ```compile_fail
//! use vibe_data::owner::pit_snapshot::PitSnapshotOwnerReadback;
//!
//! let forged = PitSnapshotOwnerReadback { available: true };
//! ```
//!
//! ```compile_fail
//! use vibe_data::owner::postgres::MarketDataReadPostgres;
//! ```

use std::{
    collections::BTreeSet,
    fmt::{Debug, Display},
};

use serde::{Deserialize, Serialize};

use super::source_binding::{
    BindingDigest, MarketDataClockAdmission, UntrustedCompleteFrontier,
    UntrustedSourceBindingLocator,
};

#[cfg(feature = "sealed-strategy-input-acceptance")]
pub mod sealed_acceptance;

macro_rules! untrusted_time_coordinate {
    ($(#[$meta:meta])* $name:ident) => {
        $(#[$meta])*
        #[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
        pub struct $name {
            /// Claimed coordinate value.
            pub value: u64,
            /// Claimed common clock identity.
            pub clock_identity: String,
            /// Claimed common clock epoch.
            pub clock_epoch: String,
        }

        impl $name {
            /// Wraps an untrusted typed time coordinate.
            pub fn from_untrusted(
                value: u64,
                clock_identity: impl Into<String>,
                clock_epoch: impl Into<String>,
            ) -> Self {
                Self {
                    value,
                    clock_identity: clock_identity.into(),
                    clock_epoch: clock_epoch.into(),
                }
            }
        }
    };
}

untrusted_time_coordinate!(
    /// Untrusted event-effective coordinate. It cannot alias another time-coordinate type.
    UntrustedEventEffectiveTime
);
untrusted_time_coordinate!(
    /// Untrusted provider-available coordinate. It cannot alias another time-coordinate type.
    UntrustedProviderAvailableTime
);
untrusted_time_coordinate!(
    /// Untrusted retrieval coordinate. It cannot alias another time-coordinate type.
    UntrustedRetrievalTime
);
untrusted_time_coordinate!(
    /// Untrusted correction-publication coordinate. It cannot alias another time-coordinate type.
    UntrustedCorrectionPublicationTime
);
untrusted_time_coordinate!(
    /// Untrusted exact snapshot decision cut. It cannot alias an evidence coordinate.
    UntrustedSnapshotDecisionCut
);

/// Complete untrusted typed `MARKET_DATA_AS_OF` evidence for one PIT request.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct UntrustedPitSnapshotTimeEvidence {
    /// Event-effective coordinate.
    pub event_effective: UntrustedEventEffectiveTime,
    /// Provider-available coordinate.
    pub provider_available: UntrustedProviderAvailableTime,
    /// Retrieval coordinate.
    pub retrieval: UntrustedRetrievalTime,
    /// Correction-publication coordinate. `None` is explicit missing evidence.
    pub correction_publication: Option<UntrustedCorrectionPublicationTime>,
    /// Exact request decision cut.
    pub decision_cut: UntrustedSnapshotDecisionCut,
    /// Non-zero monotonic sequence at the cut.
    pub monotonic_sequence: u64,
    /// Non-zero restart-continuity evidence.
    pub restart_continuity_digest: BindingDigest,
    /// Non-zero uncertainty/skew bound.
    pub skew_bound: u64,
    /// Claimed uncertainty within the admitted skew bound.
    pub uncertainty_bound: u64,
    /// Observation time at the exact decision cut.
    pub observed_at: u64,
    /// Exclusive validity boundary.
    pub valid_through: u64,
}

/// Untrusted immutable PIT Market Snapshot request claim.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct UntrustedPitSnapshotRequest {
    /// Claimed Market Data-derived request identity.
    pub claimed_request_identity: BindingDigest,
    /// Claimed digest of request content excluding stable correlation.
    pub claimed_request_digest: BindingDigest,
    /// Stable requester correlation identity.
    pub correlation_identity: BindingDigest,
    /// Exact requester-owned identity whose frozen request is being answered.
    pub requester_identity: BindingDigest,
    /// Requester-owned instrument or universe scope digest.
    pub scope_digest: BindingDigest,
    /// Exact Source Binding locator; it remains untrusted until native Owner readback.
    pub source_binding: UntrustedSourceBindingLocator,
    /// Exact Instrument Master version digest.
    pub instrument_master_digest: BindingDigest,
    /// Exact Universe Selection Record digest.
    pub universe_selection_digest: BindingDigest,
    /// Exact Market Semantics Compatibility identity.
    pub market_semantics_identity: BindingDigest,
    /// Complete request time evidence.
    pub time_evidence: UntrustedPitSnapshotTimeEvidence,
}

/// Untrusted evidence from which Market Data alone derives a terminal snapshot disposition.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct UntrustedPitSnapshotEvidence {
    /// Digest of the normalized snapshot payload; payload bytes are not part of A0.
    pub normalized_records_digest: BindingDigest,
    /// Complete exact source frontier.
    pub source_frontier: UntrustedCompleteFrontier,
    /// Complete exact correction frontier.
    pub correction_frontier: UntrustedCompleteFrontier,
    /// Claimed coverage completeness.
    pub coverage_complete: bool,
    /// Claimed compatibility with the frozen market-semantics identity.
    pub semantics_compatible: bool,
    /// Claimed source availability at the decision cut.
    pub source_available: bool,
}

/// Complete untrusted PIT Snapshot proposal. It cannot mint a positive Owner fact directly.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct UntrustedPitSnapshotProposal {
    /// Exact request claim.
    pub request: UntrustedPitSnapshotRequest,
    /// Candidate normalized evidence.
    pub evidence: UntrustedPitSnapshotEvidence,
}

/// Public untrusted PIT Snapshot locator fields.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UntrustedPitSnapshotLocatorFields {
    /// Claimed Owner identity.
    pub owner: String,
    /// Claimed request identity.
    pub request_identity: BindingDigest,
    /// Claimed request content digest.
    pub request_digest: BindingDigest,
    /// Claimed stable correlation identity.
    pub correlation_identity: BindingDigest,
    /// Claimed exact requester-owned identity.
    pub requester_identity: BindingDigest,
    /// Claimed complete requested PIT scope digest.
    pub scope_digest: BindingDigest,
    /// Claimed snapshot identity.
    pub snapshot_identity: BindingDigest,
    /// Claimed fact digest.
    pub fact_digest: BindingDigest,
    /// Claimed exact Source Binding identity used by this snapshot.
    pub source_binding_identity: BindingDigest,
    /// Claimed Source Binding lineage root.
    pub source_binding_lineage_root: BindingDigest,
    /// Claimed Source Binding lineage version.
    pub source_binding_lineage_version: u64,
    /// Claimed lineage root.
    pub lineage_root: BindingDigest,
    /// Claimed lineage version.
    pub lineage_version: u64,
    /// Claimed predecessor snapshot identity.
    pub predecessor_snapshot_identity: Option<BindingDigest>,
    /// Claimed predecessor fact digest.
    pub predecessor_fact_digest: Option<BindingDigest>,
    /// Complete claimed source frontier.
    pub source_frontier: UntrustedCompleteFrontier,
    /// Complete claimed correction frontier.
    pub correction_frontier: UntrustedCompleteFrontier,
    /// Complete claimed time evidence.
    pub time_evidence: UntrustedPitSnapshotTimeEvidence,
}

/// An untrusted locator that grants no Market Data read or write authority.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct UntrustedPitSnapshotLocator {
    pub(crate) owner: String,
    pub(crate) request_identity: BindingDigest,
    pub(crate) request_digest: BindingDigest,
    pub(crate) correlation_identity: BindingDigest,
    pub(crate) requester_identity: BindingDigest,
    pub(crate) scope_digest: BindingDigest,
    pub(crate) snapshot_identity: BindingDigest,
    pub(crate) fact_digest: BindingDigest,
    pub(crate) source_binding_identity: BindingDigest,
    pub(crate) source_binding_lineage_root: BindingDigest,
    pub(crate) source_binding_lineage_version: u64,
    pub(crate) lineage_root: BindingDigest,
    pub(crate) lineage_version: u64,
    pub(crate) predecessor_snapshot_identity: Option<BindingDigest>,
    pub(crate) predecessor_fact_digest: Option<BindingDigest>,
    pub(crate) source_frontier: UntrustedCompleteFrontier,
    pub(crate) correction_frontier: UntrustedCompleteFrontier,
    pub(crate) time_evidence: UntrustedPitSnapshotTimeEvidence,
}

impl UntrustedPitSnapshotLocator {
    /// Constructs an untrusted locator. Construction grants no Owner authority.
    pub fn from_untrusted(fields: UntrustedPitSnapshotLocatorFields) -> Self {
        Self {
            owner: fields.owner,
            request_identity: fields.request_identity,
            request_digest: fields.request_digest,
            correlation_identity: fields.correlation_identity,
            requester_identity: fields.requester_identity,
            scope_digest: fields.scope_digest,
            snapshot_identity: fields.snapshot_identity,
            fact_digest: fields.fact_digest,
            source_binding_identity: fields.source_binding_identity,
            source_binding_lineage_root: fields.source_binding_lineage_root,
            source_binding_lineage_version: fields.source_binding_lineage_version,
            lineage_root: fields.lineage_root,
            lineage_version: fields.lineage_version,
            predecessor_snapshot_identity: fields.predecessor_snapshot_identity,
            predecessor_fact_digest: fields.predecessor_fact_digest,
            source_frontier: fields.source_frontier,
            correction_frontier: fields.correction_frontier,
            time_evidence: fields.time_evidence,
        }
    }
}

/// Owner-sealed immutable PIT Snapshot readback.
///
/// Callers cannot construct or deserialize this value. Availability is observational and does not
/// grant provider, ingestion, or trading authority.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct PitSnapshotOwnerReadback {
    request_identity: BindingDigest,
    request_digest: BindingDigest,
    snapshot_identity: BindingDigest,
    fact_digest: BindingDigest,
    source_binding_identity: BindingDigest,
    lineage_root: BindingDigest,
    lineage_version: u64,
    outbox_digest: BindingDigest,
    available: bool,
    locator: UntrustedPitSnapshotLocator,
}

impl PitSnapshotOwnerReadback {
    #[allow(
        dead_code,
        reason = "constructed by the private durable resolver before product composition exists"
    )]
    pub(crate) fn from_verified(aggregate: &PitSnapshotCommitAggregate) -> Self {
        let fact = aggregate.fact();
        Self {
            request_identity: fact.request_identity(),
            request_digest: fact.request_digest(),
            snapshot_identity: fact.snapshot_identity(),
            fact_digest: fact.digest(),
            source_binding_identity: fact.source_binding_identity(),
            lineage_root: fact.lineage_root(),
            lineage_version: fact.lineage_version(),
            outbox_digest: aggregate.receipt().outbox_digest(),
            available: fact.disposition() == PitSnapshotDisposition::Available,
            locator: aggregate.receipt().locator().clone(),
        }
    }

    /// Returns the exact request identity.
    pub const fn request_identity(&self) -> BindingDigest {
        self.request_identity
    }

    /// Returns the exact request content digest.
    pub const fn request_digest(&self) -> BindingDigest {
        self.request_digest
    }

    /// Returns the canonical snapshot identity.
    pub const fn snapshot_identity(&self) -> BindingDigest {
        self.snapshot_identity
    }

    /// Returns the canonical fact digest.
    pub const fn fact_digest(&self) -> BindingDigest {
        self.fact_digest
    }

    /// Returns the exact Source Binding identity consumed at the PIT cut.
    pub const fn source_binding_identity(&self) -> BindingDigest {
        self.source_binding_identity
    }

    /// Returns the immutable correction lineage root.
    pub const fn lineage_root(&self) -> BindingDigest {
        self.lineage_root
    }

    /// Returns the immutable correction lineage version.
    pub const fn lineage_version(&self) -> u64 {
        self.lineage_version
    }

    /// Returns the co-committed native outbox digest.
    pub const fn outbox_digest(&self) -> BindingDigest {
        self.outbox_digest
    }

    /// Reports whether Market Data's private canonical disposition is available.
    pub const fn is_available(&self) -> bool {
        self.available
    }

    /// Returns an untrusted locator suitable only for exact Owner resolution.
    pub const fn locator(&self) -> &UntrustedPitSnapshotLocator {
        &self.locator
    }
}

/// Read-only direct PIT Snapshot Owner consumer port.
#[async_trait::async_trait]
pub trait PitSnapshotOwnerResolver: Send + Sync {
    /// Resolves one exact immutable locator from native Market Data custody.
    async fn resolve_pit_snapshot(
        &self,
        locator: &UntrustedPitSnapshotLocator,
    ) -> Result<PitSnapshotOwnerReadback, PitSnapshotError>;
}

/// Crate-private untrusted normalized observation input for the Market Data Owner.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct UntrustedPitObservation {
    pub(crate) symbolic_key: String,
    pub(crate) member_key: String,
    pub(crate) instrument: String,
    pub(crate) channel: String,
    pub(crate) data_kind: String,
    pub(crate) timeframe: String,
    pub(crate) field: String,
    pub(crate) value_mantissa: i128,
    pub(crate) value_scale: u8,
    pub(crate) event_effective: u64,
    pub(crate) provider_available: u64,
    pub(crate) retrieval: u64,
    pub(crate) correction_publication: u64,
    pub(crate) source_binding_identity: BindingDigest,
    pub(crate) source_frontier_digest: BindingDigest,
    pub(crate) instrument_master_digest: BindingDigest,
    pub(crate) universe_selection_digest: BindingDigest,
    pub(crate) market_semantics_identity: BindingDigest,
    pub(crate) correction_stream_identity: String,
    pub(crate) correction_sequence: u64,
    pub(crate) correction_frontier_digest: BindingDigest,
}

/// Explicit crate-private untrusted batch input. Existing PIT proposal methods do not consume it.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct UntrustedPitObservationBatchProposal {
    pub(crate) rows: Vec<UntrustedPitObservation>,
}

/// One canonical observation whose bytes were verified as a member of the complete PIT batch.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VerifiedPitObservation {
    pub(crate) symbolic_key: String,
    pub(crate) member_key: String,
    pub(crate) instrument: String,
    pub(crate) channel: String,
    pub(crate) data_kind: String,
    pub(crate) timeframe: String,
    pub(crate) field: String,
    pub(crate) value_mantissa: i128,
    pub(crate) value_scale: u8,
    pub(crate) event_effective: u64,
    pub(crate) provider_available: u64,
    pub(crate) retrieval: u64,
    pub(crate) correction_publication: u64,
    pub(crate) source_binding_identity: BindingDigest,
    pub(crate) source_frontier_digest: BindingDigest,
    pub(crate) instrument_master_digest: BindingDigest,
    pub(crate) universe_selection_digest: BindingDigest,
    pub(crate) market_semantics_identity: BindingDigest,
    pub(crate) correction_stream_identity: String,
    pub(crate) correction_sequence: u64,
    pub(crate) correction_frontier_digest: BindingDigest,
}

impl VerifiedPitObservation {
    pub fn symbolic_key(&self) -> &str {
        &self.symbolic_key
    }
    pub fn member_key(&self) -> &str {
        &self.member_key
    }
    pub fn instrument(&self) -> &str {
        &self.instrument
    }
    pub fn channel(&self) -> &str {
        &self.channel
    }
    pub fn data_kind(&self) -> &str {
        &self.data_kind
    }
    pub fn timeframe(&self) -> &str {
        &self.timeframe
    }
    pub fn field(&self) -> &str {
        &self.field
    }
    pub const fn value_mantissa(&self) -> i128 {
        self.value_mantissa
    }
    pub const fn value_scale(&self) -> u8 {
        self.value_scale
    }
    pub const fn event_effective(&self) -> u64 {
        self.event_effective
    }
    pub const fn provider_available(&self) -> u64 {
        self.provider_available
    }
    pub const fn retrieval(&self) -> u64 {
        self.retrieval
    }
    pub const fn correction_publication(&self) -> u64 {
        self.correction_publication
    }
    pub const fn source_binding_identity(&self) -> BindingDigest {
        self.source_binding_identity
    }
    pub const fn source_frontier_digest(&self) -> BindingDigest {
        self.source_frontier_digest
    }
    pub const fn instrument_master_digest(&self) -> BindingDigest {
        self.instrument_master_digest
    }
    pub const fn universe_selection_digest(&self) -> BindingDigest {
        self.universe_selection_digest
    }
    pub const fn market_semantics_identity(&self) -> BindingDigest {
        self.market_semantics_identity
    }
    pub fn correction_stream_identity(&self) -> &str {
        &self.correction_stream_identity
    }
    pub const fn correction_sequence(&self) -> u64 {
        self.correction_sequence
    }
    pub const fn correction_frontier_digest(&self) -> BindingDigest {
        self.correction_frontier_digest
    }
}

/// Owner-verified complete normalized observation batch for one exact PIT snapshot.
///
/// Private fields and the absence of `Deserialize` make this value unconstructible from caller
/// bytes. Member selection is safe only after the complete canonical batch has been verified.
///
/// ```compile_fail
/// use vibe_data::owner::pit_snapshot::VerifiedPitObservationBatch;
///
/// let forged: VerifiedPitObservationBatch = serde_json::from_slice(b"{}").unwrap();
/// ```
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VerifiedPitObservationBatch {
    pub(crate) request_identity: BindingDigest,
    pub(crate) request_digest: BindingDigest,
    pub(crate) snapshot_identity: BindingDigest,
    pub(crate) fact_digest: BindingDigest,
    pub(crate) source_binding_identity: BindingDigest,
    pub(crate) source_binding_lineage_root: BindingDigest,
    pub(crate) source_binding_lineage_version: u64,
    pub(crate) source_frontier_digest: BindingDigest,
    pub(crate) correction_frontier_digest: BindingDigest,
    pub(crate) instrument_master_digest: BindingDigest,
    pub(crate) universe_selection_digest: BindingDigest,
    pub(crate) market_semantics_identity: BindingDigest,
    pub(crate) time_evidence: UntrustedPitSnapshotTimeEvidence,
    pub(crate) digest: BindingDigest,
    pub(crate) observations: Box<[VerifiedPitObservation]>,
}

impl VerifiedPitObservationBatch {
    pub const fn request_identity(&self) -> BindingDigest {
        self.request_identity
    }
    pub const fn request_digest(&self) -> BindingDigest {
        self.request_digest
    }
    pub const fn snapshot_identity(&self) -> BindingDigest {
        self.snapshot_identity
    }
    pub const fn fact_digest(&self) -> BindingDigest {
        self.fact_digest
    }
    pub const fn source_binding_identity(&self) -> BindingDigest {
        self.source_binding_identity
    }
    pub const fn source_binding_lineage_root(&self) -> BindingDigest {
        self.source_binding_lineage_root
    }
    pub const fn source_binding_lineage_version(&self) -> u64 {
        self.source_binding_lineage_version
    }
    pub const fn source_frontier_digest(&self) -> BindingDigest {
        self.source_frontier_digest
    }
    pub const fn correction_frontier_digest(&self) -> BindingDigest {
        self.correction_frontier_digest
    }
    pub const fn instrument_master_digest(&self) -> BindingDigest {
        self.instrument_master_digest
    }
    pub const fn universe_selection_digest(&self) -> BindingDigest {
        self.universe_selection_digest
    }
    pub const fn market_semantics_identity(&self) -> BindingDigest {
        self.market_semantics_identity
    }
    pub const fn time_evidence(&self) -> &UntrustedPitSnapshotTimeEvidence {
        &self.time_evidence
    }
    pub const fn digest(&self) -> BindingDigest {
        self.digest
    }
    pub fn observations(&self) -> &[VerifiedPitObservation] {
        &self.observations
    }
    pub fn select(&self, symbolic_key: &str, member_key: &str) -> Option<&VerifiedPitObservation> {
        self.observations
            .binary_search_by(|row| {
                (row.symbolic_key.as_str(), row.member_key.as_str())
                    .cmp(&(symbolic_key, member_key))
            })
            .ok()
            .map(|index| &self.observations[index])
    }
}

/// Read-only direct PIT-evaluation Owner consumer port.
#[async_trait::async_trait]
pub trait PitObservationBatchOwnerResolver: Send + Sync {
    /// Resolves and verifies the complete canonical observation batch for one immutable snapshot.
    async fn resolve_pit_observation_batch(
        &self,
        locator: &UntrustedPitSnapshotLocator,
    ) -> Result<VerifiedPitObservationBatch, PitSnapshotError>;
}

/// Rejected untrusted proposal or test-only Owner operation.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum PitSnapshotError {
    /// A required identity is missing.
    MissingField(&'static str),
    /// A required digest is zero.
    ZeroDigest(&'static str),
    /// Claimed request content differs from Market Data's canonical encoding.
    RequestDigestMismatch,
    /// Claimed request identity differs from Market Data's canonical encoding.
    RequestIdentityMismatch,
    /// Exact native Source Binding readback was unavailable or not admitted.
    SourceBindingUnavailable,
    /// Proposal basis differs from crate-private Owner-resolved canonical facts.
    CanonicalBasisMismatch,
    /// Owner-sealed clock evidence does not cover the exact decision cut.
    TrustedClockMismatch,
    /// The requested predecessor is not the current canonical correction head.
    CorrectionHeadMismatch,
    /// Correction sequence is not the exactly-next sequence.
    InvalidCorrectionSequence,
    /// Same immutable identity was submitted with different canonical meaning.
    ReplayConflict,
    /// Persistence is unavailable.
    PersistenceUnavailable,
    /// A test fault occurred before the atomic fact-plus-outbox commit.
    CommitInterrupted,
    /// Commit succeeded but its response was lost; exact replay can recover it.
    ResponseLost,
    /// Locator does not exactly match native persisted readback.
    LocatorMismatch,
    /// Normalized observation-batch custody was missing or contradicted native PIT meaning.
    ObservationBatchUnavailable,
    /// Normalized observation bytes were non-canonical, malformed, or incomplete.
    InvalidObservationBatch,
    /// The caller did not identify the canonical Research Owner consumer.
    ConsumerRoleMismatch,
    /// A caller comparison binding differs from canonical native Market Data facts.
    ConsumerBindingMismatch,
}

impl Display for PitSnapshotError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{self:?}")
    }
}

impl std::error::Error for PitSnapshotError {}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize)]
#[allow(
    dead_code,
    reason = "A0 terminal vocabulary is consumed by the later Market Data composition"
)]
pub(crate) enum PitSnapshotBlocker {
    RightsUnlicensed,
    IdentitySemanticsOrTimeAmbiguous,
    EvidenceStale,
    CoverageInsufficient,
    SourceUnavailable,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[allow(
    dead_code,
    reason = "A0 terminal vocabulary is consumed by the later Market Data composition"
)]
pub(crate) enum PitSnapshotDisposition {
    Available,
    Unlicensed,
    Ambiguous,
    Stale,
    Insufficient,
    Unavailable,
}

#[allow(
    dead_code,
    reason = "A0 is consumed by the later A1 persistence implementation"
)]
#[derive(Clone, Deserialize, Eq, PartialEq, Serialize)]
pub(crate) struct PitSnapshotFact {
    request: UntrustedPitSnapshotRequest,
    evidence: UntrustedPitSnapshotEvidence,
    clock_admission: MarketDataClockAdmission,
    source_binding_identity: BindingDigest,
    source_binding_lineage_root: BindingDigest,
    source_binding_lineage_version: u64,
    snapshot_identity: BindingDigest,
    lineage_root: BindingDigest,
    lineage_version: u64,
    predecessor_snapshot_identity: Option<BindingDigest>,
    predecessor_fact_digest: Option<BindingDigest>,
    blockers: BTreeSet<PitSnapshotBlocker>,
    disposition: PitSnapshotDisposition,
    primary_blocker: Option<PitSnapshotBlocker>,
    digest: BindingDigest,
}

impl Debug for PitSnapshotFact {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct(stringify!(PitSnapshotFact))
            .field("request_identity", &self.request.claimed_request_identity)
            .field("snapshot_identity", &self.snapshot_identity)
            .field("lineage_version", &self.lineage_version)
            .field("blockers", &self.blockers)
            .field("disposition", &self.disposition)
            .field("digest", &self.digest)
            .finish_non_exhaustive()
    }
}

#[allow(
    dead_code,
    reason = "A0 is consumed by the later A1 persistence implementation"
)]
impl PitSnapshotFact {
    pub(crate) const fn request_identity(&self) -> BindingDigest {
        self.request.claimed_request_identity
    }

    pub(crate) const fn request_digest(&self) -> BindingDigest {
        self.request.claimed_request_digest
    }

    pub(crate) const fn correlation_identity(&self) -> BindingDigest {
        self.request.correlation_identity
    }

    pub(crate) const fn snapshot_identity(&self) -> BindingDigest {
        self.snapshot_identity
    }

    pub(crate) const fn source_binding_identity(&self) -> BindingDigest {
        self.source_binding_identity
    }

    pub(crate) const fn source_binding_lineage_root(&self) -> BindingDigest {
        self.source_binding_lineage_root
    }

    pub(crate) const fn source_binding_lineage_version(&self) -> u64 {
        self.source_binding_lineage_version
    }

    pub(crate) const fn disposition(&self) -> PitSnapshotDisposition {
        self.disposition
    }

    pub(crate) const fn primary_blocker(&self) -> Option<PitSnapshotBlocker> {
        self.primary_blocker
    }

    pub(crate) const fn blockers(&self) -> &BTreeSet<PitSnapshotBlocker> {
        &self.blockers
    }

    pub(crate) const fn lineage_version(&self) -> u64 {
        self.lineage_version
    }

    pub(crate) const fn lineage_root(&self) -> BindingDigest {
        self.lineage_root
    }

    pub(crate) const fn predecessor_snapshot_identity(&self) -> Option<BindingDigest> {
        self.predecessor_snapshot_identity
    }

    pub(crate) const fn predecessor_fact_digest(&self) -> Option<BindingDigest> {
        self.predecessor_fact_digest
    }

    pub(crate) const fn request(&self) -> &UntrustedPitSnapshotRequest {
        &self.request
    }

    pub(crate) const fn evidence(&self) -> &UntrustedPitSnapshotEvidence {
        &self.evidence
    }

    pub(crate) const fn clock_admission(&self) -> &MarketDataClockAdmission {
        &self.clock_admission
    }

    pub(crate) const fn digest(&self) -> BindingDigest {
        self.digest
    }
}

#[allow(
    dead_code,
    reason = "A0 is consumed by the later A1 persistence implementation"
)]
#[derive(Clone, Deserialize, Eq, PartialEq, Serialize)]
pub(crate) struct PitSnapshotOutboxRecord {
    payload: Box<[u8]>,
    digest: BindingDigest,
}

impl Debug for PitSnapshotOutboxRecord {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct(stringify!(PitSnapshotOutboxRecord))
            .field("payload_len", &self.payload.len())
            .field("digest", &self.digest)
            .finish_non_exhaustive()
    }
}

#[allow(
    dead_code,
    reason = "A0 is consumed by the later A1 persistence implementation"
)]
impl PitSnapshotOutboxRecord {
    pub(crate) fn payload(&self) -> &[u8] {
        &self.payload
    }

    pub(crate) const fn digest(&self) -> BindingDigest {
        self.digest
    }
}

#[allow(
    dead_code,
    reason = "A0 is consumed by the later A1 persistence implementation"
)]
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(crate) struct PitSnapshotReceipt {
    locator: UntrustedPitSnapshotLocator,
    outbox_digest: BindingDigest,
}

#[allow(
    dead_code,
    reason = "A0 is consumed by the later A1 persistence implementation"
)]
impl PitSnapshotReceipt {
    pub(crate) const fn locator(&self) -> &UntrustedPitSnapshotLocator {
        &self.locator
    }

    pub(crate) const fn outbox_digest(&self) -> BindingDigest {
        self.outbox_digest
    }
}

/// One sealed atomic unit. Its private fields prevent a sibling module from minting positive truth.
#[allow(
    dead_code,
    reason = "A0 is consumed by the later A1 persistence implementation"
)]
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(crate) struct PitSnapshotCommitAggregate {
    fact: PitSnapshotFact,
    outbox: PitSnapshotOutboxRecord,
    receipt: PitSnapshotReceipt,
}

#[allow(
    dead_code,
    reason = "A0 is consumed by the later A1 persistence implementation"
)]
impl PitSnapshotCommitAggregate {
    pub(crate) const fn fact(&self) -> &PitSnapshotFact {
        &self.fact
    }

    pub(crate) const fn outbox(&self) -> &PitSnapshotOutboxRecord {
        &self.outbox
    }

    pub(crate) const fn receipt(&self) -> &PitSnapshotReceipt {
        &self.receipt
    }
}

#[allow(
    dead_code,
    reason = "A0 is consumed by the later A1 persistence implementation"
)]
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum PitSnapshotPersistenceResult {
    Inserted(PitSnapshotCommitAggregate),
    ExactReplay(PitSnapshotCommitAggregate),
}

/// A1's native store must implement one atomic fact-plus-outbox operation and exact readback.
#[allow(
    dead_code,
    reason = "A0 is consumed by the later A1 persistence implementation"
)]
pub(crate) trait PitSnapshotPersistencePort {
    /// Atomically inserts exactly one sealed fact and its native outbox, joins exact replay, and
    /// rejects conflicting meaning without a partial write.
    fn commit_fact_and_outbox_atomically(
        &mut self,
        aggregate: PitSnapshotCommitAggregate,
    ) -> Result<PitSnapshotPersistenceResult, PitSnapshotError>;

    /// Resolves exact immutable native readback; locator mismatch must fail closed.
    fn resolve_exact(
        &self,
        locator: &UntrustedPitSnapshotLocator,
    ) -> Result<PitSnapshotCommitAggregate, PitSnapshotError>;
}

pub(crate) mod authority;
#[cfg(test)]
mod tests;
