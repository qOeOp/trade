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
    pit_snapshot::{PitSnapshotError, UntrustedPitSnapshotRequest},
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
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct PitMarketSnapshotTerminalV1 {
    request_identity: BindingDigest,
    request_digest: BindingDigest,
    correlation_identity: BindingDigest,
    snapshot_identity: BindingDigest,
    fact_digest: BindingDigest,
    disposition: PitMarketSnapshotDispositionV1,
}

impl PitMarketSnapshotTerminalV1 {
    pub(crate) const fn seal(
        request_identity: BindingDigest,
        request_digest: BindingDigest,
        correlation_identity: BindingDigest,
        snapshot_identity: BindingDigest,
        fact_digest: BindingDigest,
        disposition: PitMarketSnapshotDispositionV1,
    ) -> Self {
        Self {
            request_identity,
            request_digest,
            correlation_identity,
            snapshot_identity,
            fact_digest,
            disposition,
        }
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
