//! The Owner-sealed intake for one frozen PIT Market Snapshot Request.
//!
//! This is the first production surface on which an ordinary consumer can reach Market Data's own
//! minting authority. A caller supplies a frozen request and the locator of an already-evaluated
//! Universe Selection Record. It supplies no observations, no evidence, no digest, no clock and no
//! disposition: the Owner retrieves its own rows through a Data Client, stamps its own bindings,
//! resolves its own canonical basis and derives the terminal itself.
//!
//! What crosses back is a terminal, not custody. The readback carries the snapshot's identity, its
//! fact digest and its disposition, and no store receipt, raw row, lineage row, clock row, pool or
//! writer. A consumer cannot construct one, so a positive disposition can only have come from a
//! committed Owner fact.

use std::{
    fmt::{Debug, Display},
    sync::Arc,
};

use async_trait::async_trait;
use serde::{Deserialize, Serialize};

use super::{
    pit_observation_source_v1::PitObservationSourceV1,
    pit_snapshot::{PitSnapshotError, UntrustedPitSnapshotLocator, UntrustedPitSnapshotRequest},
    source_binding::BindingDigest,
    universe_selection::UntrustedUniverseSelectionLocatorV1,
};

/// The public terminal vocabulary of one snapshot request.
///
/// It mirrors the Owner's private disposition exactly. Consumers receive an explicit negative
/// rather than an error whenever Market Data reached a finding, so silence and transport failure
/// stay distinguishable from a decided answer.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PitMarketSnapshotDispositionV1 {
    /// The snapshot is complete, licensed, semantically compatible and fresh at the cut.
    Available,
    /// Rights were revoked or decisively denied.
    Unlicensed,
    /// Identity, semantics or time evidence could not be reconciled.
    Ambiguous,
    /// The evidence is no longer valid at the cut.
    Stale,
    /// The retrieval did not cover the evaluated universe.
    Insufficient,
    /// The admitted source could not answer at the cut.
    Unavailable,
}

/// The move-only terminal Market Data seals for one request.
///
/// It carries the Owner's own locator for the committed snapshot. Without it a submitter that has
/// just minted a snapshot could not name it to any later Owner intake, because the locator binds
/// fields the Owner derives and the submitter never sees. The locator is Owner-derived evidence
/// handed back for exact resolution, not something a caller may author.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct PitMarketSnapshotTerminalV1 {
    request_identity: BindingDigest,
    request_digest: BindingDigest,
    correlation_identity: BindingDigest,
    snapshot_identity: BindingDigest,
    fact_digest: BindingDigest,
    disposition: PitMarketSnapshotDispositionV1,
    locator: Option<UntrustedPitSnapshotLocator>,
    instrument_master_digest: BindingDigest,
}

/// The values a terminal is sealed over, named rather than positional.
///
/// Six of these are a `BindingDigest`, and a positional constructor makes two of them
/// interchangeable to the compiler while meaning entirely different things. That is not
/// hypothetical: the request identity, the scope digest and the universe selection digest were
/// conflated once in this Owner's first sweep caller, and no test caught it.
pub(crate) struct PitMarketSnapshotTerminalFieldsV1 {
    pub request_identity: BindingDigest,
    pub request_digest: BindingDigest,
    pub correlation_identity: BindingDigest,
    pub snapshot_identity: BindingDigest,
    pub fact_digest: BindingDigest,
    pub disposition: PitMarketSnapshotDispositionV1,
    pub locator: Option<UntrustedPitSnapshotLocator>,
    pub instrument_master_digest: BindingDigest,
}

impl PitMarketSnapshotTerminalV1 {
    pub(crate) fn seal(fields: PitMarketSnapshotTerminalFieldsV1) -> Self {
        Self {
            request_identity: fields.request_identity,
            request_digest: fields.request_digest,
            correlation_identity: fields.correlation_identity,
            snapshot_identity: fields.snapshot_identity,
            fact_digest: fields.fact_digest,
            disposition: fields.disposition,
            locator: fields.locator,
            instrument_master_digest: fields.instrument_master_digest,
        }
    }

    /// The Owner's locator for the committed snapshot, when the disposition committed one.
    ///
    /// A terminal negative has no snapshot to locate, so this is absent rather than zeroed.
    #[must_use]
    pub const fn locator(&self) -> Option<&UntrustedPitSnapshotLocator> {
        self.locator.as_ref()
    }

    /// The exact request identity this terminal answers.
    #[must_use]
    pub const fn request_identity(&self) -> BindingDigest {
        self.request_identity
    }

    /// The exact request content digest this terminal answers.
    #[must_use]
    pub const fn request_digest(&self) -> BindingDigest {
        self.request_digest
    }

    /// The requester's stable correlation identity.
    #[must_use]
    pub const fn correlation_identity(&self) -> BindingDigest {
        self.correlation_identity
    }

    /// The committed snapshot identity.
    #[must_use]
    pub const fn snapshot_identity(&self) -> BindingDigest {
        self.snapshot_identity
    }

    /// The committed snapshot fact digest.
    #[must_use]
    pub const fn fact_digest(&self) -> BindingDigest {
        self.fact_digest
    }

    /// The Instrument Master cut digest this snapshot was resolved against.
    ///
    /// The Owner resolves it from the request's own effective instant, and Instrument Master facts
    /// are effective-dated, so two terminals at different coordinates may legitimately differ here.
    /// A caller composing several snapshots into one corpus is required to use one cut for all of
    /// them, and this is how it can tell where that stops being possible.
    #[must_use]
    pub const fn instrument_master_digest(&self) -> BindingDigest {
        self.instrument_master_digest
    }

    /// The terminal disposition Market Data derived.
    #[must_use]
    pub const fn disposition(&self) -> PitMarketSnapshotDispositionV1 {
        self.disposition
    }
}

/// Why an intake could not reach a terminal at all.
///
/// A decided negative is never one of these: it arrives as a terminal disposition. These are the
/// cases where Market Data has no finding to report.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PitMarketSnapshotIntakeErrorV1 {
    /// The request is malformed, or its claims do not derive from its own content.
    InvalidRequest,
    /// The request names a Source Binding this Owner does not hold.
    SourceBindingUnavailable,
    /// The Data Client could not answer the scope the Owner issued.
    ObservationUnavailable,
    /// The Data Client answered, but the batch does not satisfy the Owner's canonical contract.
    ///
    /// This is a defect in the client, not an absence of data, and it stays distinct from
    /// unavailability so an operator is not sent looking at the provider for a local bug.
    ObservationBatchInvalid,
    /// Market Data holds no canonical clock head, so it can bind no decision cut.
    ClockUnavailable,
    /// The Owner store is unreachable or refused the commit.
    StoreUnavailable,
    /// The same request identity is already bound to different content.
    RequestConflict,
    /// No Instrument Master V1 fact of this Owner answers the request's instrument at its cut.
    InstrumentMasterUnavailable,
    /// The recovered Universe Selection Record includes no member, or more than two.
    UniverseMemberCountUnadmitted,
    /// An included member's key is not the canonical instrument it names.
    UniverseMemberKeyIsNotInstrument,
}

impl Display for PitMarketSnapshotIntakeErrorV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let text = match self {
            Self::InvalidRequest => "the PIT request is malformed",
            Self::SourceBindingUnavailable => "the request names an unavailable Source Binding",
            Self::ObservationUnavailable => "the observation source could not answer the scope",
            Self::ObservationBatchInvalid => "the observation batch is not canonical",
            Self::ClockUnavailable => "Market Data holds no canonical clock head",
            Self::StoreUnavailable => "the Market Data store is unavailable",
            Self::RequestConflict => "the request identity is bound to different content",
            Self::InstrumentMasterUnavailable => {
                "no Instrument Master fact answers the request's instrument at its cut"
            }
            Self::UniverseMemberCountUnadmitted => {
                "the Universe Selection Record includes no member or more than two"
            }
            Self::UniverseMemberKeyIsNotInstrument => {
                "a Universe Selection member key is not the canonical instrument it names"
            }
        };
        formatter.write_str(text)
    }
}

impl std::error::Error for PitMarketSnapshotIntakeErrorV1 {}

impl From<PitSnapshotError> for PitMarketSnapshotIntakeErrorV1 {
    fn from(error: PitSnapshotError) -> Self {
        match error {
            PitSnapshotError::SourceBindingUnavailable => Self::SourceBindingUnavailable,
            PitSnapshotError::ObservationBatchUnavailable => Self::ObservationUnavailable,
            PitSnapshotError::InvalidObservationBatch => Self::ObservationBatchInvalid,
            PitSnapshotError::ReplayConflict | PitSnapshotError::CorrectionHeadMismatch => {
                Self::RequestConflict
            }
            PitSnapshotError::PersistenceUnavailable | PitSnapshotError::CommitInterrupted => {
                Self::StoreUnavailable
            }
            PitSnapshotError::InstrumentMasterUnavailable => Self::InstrumentMasterUnavailable,
            PitSnapshotError::UniverseMemberCountUnadmitted => Self::UniverseMemberCountUnadmitted,
            PitSnapshotError::UniverseMemberKeyIsNotInstrument => {
                Self::UniverseMemberKeyIsNotInstrument
            }
            _ => Self::InvalidRequest,
        }
    }
}

/// The Owner's current canonical decision cut, as a requester must repeat it.
///
/// A frozen request is admitted only when its time evidence repeats this cut exactly, so a
/// requester has to read the Owner's clock before it can freeze anything. That is the point: the
/// cut is Market Data's, and a consumer that picked its own would be choosing when its own evidence
/// was observed.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct MarketDataDecisionCutV1 {
    /// The Owner's clock identity.
    pub clock_identity: String,
    /// The Owner's clock epoch.
    pub clock_epoch: String,
    /// The exact decision cut, which also equals the wall observation.
    pub decision_cut: u64,
    /// The monotonic sequence at the cut.
    pub monotonic_sequence: u64,
    /// The restart-continuity digest for this epoch.
    pub restart_continuity_digest: BindingDigest,
    /// The exclusive bound past which this cut is stale.
    pub valid_through: u64,
    /// The clock's uncertainty bound.
    pub uncertainty_bound: u64,
    /// The clock's skew bound.
    pub skew_bound: u64,
}

const DECISION_CUT_DOMAIN_V1: &[u8] = b"vibe.market-data.decision-cut.v1\0";

impl MarketDataDecisionCutV1 {
    /// The digest a consumer stores to name exactly this cut.
    ///
    /// SHA-256 over `vibe.market-data.decision-cut.v1\0`, then the clock identity and the clock
    /// epoch, each prefixed by its UTF-8 length as `u16LE`, then `decision_cut` and
    /// `monotonic_sequence` as `u64LE`, the 32-byte restart-continuity digest, and `valid_through`,
    /// `uncertainty_bound` and `skew_bound` as `u64LE`. `None` when the identity or the epoch is
    /// longer than a `u16` length can state; the Owner's own are 32 bytes each.
    #[must_use]
    pub fn digest(&self) -> Option<BindingDigest> {
        use sha2::{Digest, Sha256};

        let identity_length = u16::try_from(self.clock_identity.len()).ok()?;
        let epoch_length = u16::try_from(self.clock_epoch.len()).ok()?;
        let mut hasher = Sha256::new();
        hasher.update(DECISION_CUT_DOMAIN_V1);
        hasher.update(identity_length.to_le_bytes());
        hasher.update(self.clock_identity.as_bytes());
        hasher.update(epoch_length.to_le_bytes());
        hasher.update(self.clock_epoch.as_bytes());
        hasher.update(self.decision_cut.to_le_bytes());
        hasher.update(self.monotonic_sequence.to_le_bytes());
        hasher.update(self.restart_continuity_digest.as_bytes());
        hasher.update(self.valid_through.to_le_bytes());
        hasher.update(self.uncertainty_bound.to_le_bytes());
        hasher.update(self.skew_bound.to_le_bytes());
        Some(BindingDigest::from_untrusted_bytes(
            hasher.finalize().into(),
        ))
    }
}

/// The sealed production intake. Strategy Factory cannot implement or construct it.
#[async_trait]
pub trait PitMarketSnapshotIntakeV1: Send + Sync + sealed::Sealed {
    /// Returns the cut a request must be frozen against.
    ///
    /// # Errors
    ///
    /// Returns [`PitMarketSnapshotIntakeErrorV1::ClockUnavailable`] when the Owner holds no head.
    async fn current_decision_cut(
        &self,
    ) -> Result<MarketDataDecisionCutV1, PitMarketSnapshotIntakeErrorV1>;

    /// Answers one frozen request with an Owner-derived terminal.
    ///
    /// # Errors
    ///
    /// Returns a bounded category only when Market Data reached no finding at all.
    async fn submit(
        &self,
        request: UntrustedPitSnapshotRequest,
        universe_selection: UntrustedUniverseSelectionLocatorV1,
    ) -> Result<PitMarketSnapshotTerminalV1, PitMarketSnapshotIntakeErrorV1>;
}

pub(crate) mod sealed {
    pub trait Sealed {}
}

/// Opens the sole configured Market Data intake and binds one Data Client to it.
///
/// The deployment configuration root chooses the database through
/// `MARKET_DATA_OWNER_DATABASE_URL`; no caller-supplied pool, URL or clock can construct this
/// intake. The Data Client is supplied by the composition root because the document gives Data
/// Clients to Market Data, and a consumer of the intake never sees it.
///
/// # Errors
///
/// Returns a redacted configuration or store failure without attempting a default database.
pub async fn pit_market_snapshot_intake_from_environment_v1(
    observations: Arc<dyn PitObservationSourceV1>,
) -> Result<Arc<dyn PitMarketSnapshotIntakeV1>, PitMarketSnapshotIntakeErrorV1> {
    super::postgres::pit_market_snapshot_intake_from_environment_v1(observations).await
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::*;

    fn cut() -> MarketDataDecisionCutV1 {
        MarketDataDecisionCutV1 {
            clock_identity: "market-data.owner-clock.v1-00001".into(),
            clock_epoch: "market-data.owner-epoch.v1-00001".into(),
            decision_cut: 1_000,
            monotonic_sequence: 7,
            restart_continuity_digest: BindingDigest::from_untrusted_bytes([0x11; 32]),
            valid_through: 2_000,
            uncertainty_bound: 3,
            skew_bound: 5,
        }
    }

    fn from_hex(value: &str) -> Vec<u8> {
        (0..value.len())
            .step_by(2)
            .map(|at| u8::from_str_radix(&value[at..at + 2], 16).unwrap())
            .collect()
    }

    // The expected bytes were computed outside this crate, from the layout the digest documents.
    #[rstest]
    fn the_decision_cut_digest_is_sha256_over_its_documented_layout() {
        assert_eq!(
            cut().digest().unwrap().as_bytes().to_vec(),
            from_hex("f07756bd5cbd90cffac86ed64f13ee7aedbd91576eb202701b26dd35d09d60df")
        );
    }

    #[rstest]
    #[case::clock_identity(|cut: &mut MarketDataDecisionCutV1| cut.clock_identity.push('x'))]
    #[case::clock_epoch(|cut: &mut MarketDataDecisionCutV1| cut.clock_epoch.push('x'))]
    #[case::decision_cut(|cut: &mut MarketDataDecisionCutV1| cut.decision_cut += 1)]
    #[case::monotonic_sequence(|cut: &mut MarketDataDecisionCutV1| cut.monotonic_sequence += 1)]
    #[case::restart_continuity(|cut: &mut MarketDataDecisionCutV1| {
        cut.restart_continuity_digest = BindingDigest::from_untrusted_bytes([0x12; 32]);
    })]
    #[case::valid_through(|cut: &mut MarketDataDecisionCutV1| cut.valid_through += 1)]
    #[case::uncertainty_bound(|cut: &mut MarketDataDecisionCutV1| cut.uncertainty_bound += 1)]
    #[case::skew_bound(|cut: &mut MarketDataDecisionCutV1| cut.skew_bound += 1)]
    #[case::identity_epoch_boundary(|cut: &mut MarketDataDecisionCutV1| {
        cut.clock_epoch.insert(0, cut.clock_identity.pop().unwrap());
    })]
    fn every_field_of_the_cut_moves_its_digest(#[case] change: fn(&mut MarketDataDecisionCutV1)) {
        let mut changed = cut();
        change(&mut changed);
        assert_ne!(changed.digest(), cut().digest());
    }

    #[rstest]
    fn a_cut_whose_identity_no_u16_length_can_state_has_no_digest() {
        let mut oversized = cut();
        oversized.clock_identity = "x".repeat(usize::from(u16::MAX) + 1);
        assert_eq!(oversized.digest(), None);
    }
}
