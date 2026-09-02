//! Durable normalized observation census and unchanged V1 joined-cut custody.
//!
//! The caller supplies a PIT locator and join claim, never frames or a census. Market Data alone
//! resolves the complete PIT/correction census and invokes the existing V1 seal/issue functions.
//! This module wraps the resulting V1 receipt by exact digest; it does not define a replacement
//! joined-cut codec.
//!
//! ```compile_fail
//! use vibe_data::owner::observation_census::ObservationCensusReadbackV1;
//! let _ = ObservationCensusReadbackV1 {};
//! ```
//!
//! ```compile_fail
//! use vibe_data::owner::observation_census::ObservationCensusReadbackV1;
//! let _: ObservationCensusReadbackV1 = serde_json::from_str("{}").unwrap();
//! ```

use std::fmt::{Display, Formatter};

use super::{
    pit_snapshot::UntrustedPitSnapshotLocator,
    source_binding::BindingDigest,
    strategy_input_joined_cut::{
        StrategyInputJoinedCutReceiptV1, UntrustedStrategyInputJoinClaimV1,
    },
};

pub(super) mod authority;
mod codec;

#[cfg(test)]
mod tests;

pub use authority::{
    verify_observation_census_readback_v1, verify_strategy_input_joined_cut_readback_v1,
};

pub type ObservationCensusIdentity = BindingDigest;

/// Untrusted request. Frames, selected components, and census bytes are intentionally absent.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UntrustedObservationCensusRequestV1 {
    request_identity: ObservationCensusIdentity,
    request_meaning_digest: ObservationCensusIdentity,
    pit_locator: UntrustedPitSnapshotLocator,
    join_claim: UntrustedStrategyInputJoinClaimV1,
    trigger_logical_time: u64,
    stable_correlation: ObservationCensusIdentity,
}

impl UntrustedObservationCensusRequestV1 {
    pub fn new(
        request_identity: ObservationCensusIdentity,
        pit_locator: UntrustedPitSnapshotLocator,
        join_claim: UntrustedStrategyInputJoinClaimV1,
        trigger_logical_time: u64,
        stable_correlation: ObservationCensusIdentity,
    ) -> Self {
        let mut request = Self {
            request_identity,
            request_meaning_digest: BindingDigest::from_untrusted_bytes([0; 32]),
            pit_locator,
            join_claim,
            trigger_logical_time,
            stable_correlation,
        };
        request.request_meaning_digest = authority::request_meaning_digest(&request)
            .unwrap_or(BindingDigest::from_untrusted_bytes([0; 32]));
        request
    }
    pub const fn request_identity(&self) -> ObservationCensusIdentity {
        self.request_identity
    }
    pub const fn request_meaning_digest(&self) -> ObservationCensusIdentity {
        self.request_meaning_digest
    }
    pub const fn pit_locator(&self) -> &UntrustedPitSnapshotLocator {
        &self.pit_locator
    }
    pub const fn join_claim(&self) -> &UntrustedStrategyInputJoinClaimV1 {
        &self.join_claim
    }
    pub const fn trigger_logical_time(&self) -> u64 {
        self.trigger_logical_time
    }
    pub const fn stable_correlation(&self) -> ObservationCensusIdentity {
        self.stable_correlation
    }
    pub const fn locator(&self) -> UntrustedObservationCensusLocatorV1 {
        UntrustedObservationCensusLocatorV1 {
            request_identity: self.request_identity,
            request_meaning_digest: self.request_meaning_digest,
        }
    }
}

/// Exact identity/meaning pair for response-loss recovery.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct UntrustedObservationCensusLocatorV1 {
    request_identity: ObservationCensusIdentity,
    request_meaning_digest: ObservationCensusIdentity,
}

impl UntrustedObservationCensusLocatorV1 {
    pub const fn from_untrusted(
        request_identity: ObservationCensusIdentity,
        request_meaning_digest: ObservationCensusIdentity,
    ) -> Self {
        Self {
            request_identity,
            request_meaning_digest,
        }
    }
    pub const fn request_identity(&self) -> ObservationCensusIdentity {
        self.request_identity
    }
    pub const fn request_meaning_digest(&self) -> ObservationCensusIdentity {
        self.request_meaning_digest
    }
}

/// Canonical identity projection for one exact single-value V1 frame in the complete census.
#[derive(Debug, Eq, PartialEq)]
pub struct ObservationCensusEntryV1 {
    input_role_identity: ObservationCensusIdentity,
    logical_time: u64,
    event_time: u64,
    owner_sequence: u64,
    event_identity: [u8; 16],
    trigger_digest: ObservationCensusIdentity,
    value_digest: ObservationCensusIdentity,
    canonical_bytes: Box<[u8]>,
    identity: ObservationCensusIdentity,
}

impl ObservationCensusEntryV1 {
    pub const fn input_role_identity(&self) -> ObservationCensusIdentity {
        self.input_role_identity
    }
    pub const fn logical_time(&self) -> u64 {
        self.logical_time
    }
    pub const fn event_time(&self) -> u64 {
        self.event_time
    }
    pub const fn owner_sequence(&self) -> u64 {
        self.owner_sequence
    }
    pub const fn event_identity(&self) -> &[u8; 16] {
        &self.event_identity
    }
    pub const fn trigger_digest(&self) -> ObservationCensusIdentity {
        self.trigger_digest
    }
    pub const fn value_digest(&self) -> ObservationCensusIdentity {
        self.value_digest
    }
    pub fn canonical_bytes(&self) -> &[u8] {
        &self.canonical_bytes
    }
    pub const fn identity(&self) -> ObservationCensusIdentity {
        self.identity
    }
    pub const fn digest(&self) -> ObservationCensusIdentity {
        self.identity
    }
}

/// Complete normalized PIT/correction census selected by Market Data.
#[derive(Debug, Eq, PartialEq)]
pub struct ObservationCensusRecordV1 {
    request_identity: ObservationCensusIdentity,
    request_meaning_digest: ObservationCensusIdentity,
    pit_snapshot_identity: ObservationCensusIdentity,
    pit_fact_digest: ObservationCensusIdentity,
    join_identity: ObservationCensusIdentity,
    trigger_logical_time: u64,
    entries: Box<[ObservationCensusEntryV1]>,
    canonical_bytes: Box<[u8]>,
    identity: ObservationCensusIdentity,
}

impl ObservationCensusRecordV1 {
    pub const fn request_identity(&self) -> ObservationCensusIdentity {
        self.request_identity
    }
    pub const fn request_meaning_digest(&self) -> ObservationCensusIdentity {
        self.request_meaning_digest
    }
    pub const fn pit_snapshot_identity(&self) -> ObservationCensusIdentity {
        self.pit_snapshot_identity
    }
    pub const fn pit_fact_digest(&self) -> ObservationCensusIdentity {
        self.pit_fact_digest
    }
    pub const fn join_identity(&self) -> ObservationCensusIdentity {
        self.join_identity
    }
    pub const fn trigger_logical_time(&self) -> u64 {
        self.trigger_logical_time
    }
    pub fn entries(&self) -> &[ObservationCensusEntryV1] {
        &self.entries
    }
    pub fn canonical_bytes(&self) -> &[u8] {
        &self.canonical_bytes
    }
    pub const fn identity(&self) -> ObservationCensusIdentity {
        self.identity
    }
    pub const fn digest(&self) -> ObservationCensusIdentity {
        self.identity
    }
}

#[derive(Debug, Eq, PartialEq)]
pub struct ObservationCensusReceiptV1 {
    request_identity: ObservationCensusIdentity,
    request_meaning_digest: ObservationCensusIdentity,
    census_identity: ObservationCensusIdentity,
    stable_correlation: ObservationCensusIdentity,
    canonical_bytes: Box<[u8]>,
    identity: ObservationCensusIdentity,
}

impl ObservationCensusReceiptV1 {
    pub const fn request_identity(&self) -> ObservationCensusIdentity {
        self.request_identity
    }
    pub const fn request_meaning_digest(&self) -> ObservationCensusIdentity {
        self.request_meaning_digest
    }
    pub const fn census_identity(&self) -> ObservationCensusIdentity {
        self.census_identity
    }
    pub const fn stable_correlation(&self) -> ObservationCensusIdentity {
        self.stable_correlation
    }
    pub fn canonical_bytes(&self) -> &[u8] {
        &self.canonical_bytes
    }
    pub const fn identity(&self) -> ObservationCensusIdentity {
        self.identity
    }
    pub const fn digest(&self) -> ObservationCensusIdentity {
        self.identity
    }
}

/// Move-only census readback. It carries no joined-cut mint capability.
#[derive(Debug, Eq, PartialEq)]
pub struct ObservationCensusReadbackV1 {
    record: ObservationCensusRecordV1,
    receipt: ObservationCensusReceiptV1,
}

impl ObservationCensusReadbackV1 {
    pub const fn record(&self) -> &ObservationCensusRecordV1 {
        &self.record
    }
    pub const fn receipt(&self) -> &ObservationCensusReceiptV1 {
        &self.receipt
    }
}

/// Exact locator for the separately resolved V1 joined-cut custody record.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct UntrustedStrategyInputJoinedCutLocatorV1 {
    joined_cut_identity: ObservationCensusIdentity,
    joined_cut_digest: ObservationCensusIdentity,
}

impl UntrustedStrategyInputJoinedCutLocatorV1 {
    pub const fn from_untrusted(
        joined_cut_identity: ObservationCensusIdentity,
        joined_cut_digest: ObservationCensusIdentity,
    ) -> Self {
        Self {
            joined_cut_identity,
            joined_cut_digest,
        }
    }
    pub const fn joined_cut_identity(&self) -> ObservationCensusIdentity {
        self.joined_cut_identity
    }
    pub const fn joined_cut_digest(&self) -> ObservationCensusIdentity {
        self.joined_cut_digest
    }
}

/// Custody wrapper around the unchanged V1 joined-cut receipt.
#[derive(Debug, Eq, PartialEq)]
pub struct StrategyInputJoinedCutRecordV1 {
    request_identity: ObservationCensusIdentity,
    request_meaning_digest: ObservationCensusIdentity,
    observation_census_identity: ObservationCensusIdentity,
    observation_census_digest: ObservationCensusIdentity,
    joined_cut_receipt: StrategyInputJoinedCutReceiptV1,
    canonical_bytes: Box<[u8]>,
    identity: ObservationCensusIdentity,
}

impl StrategyInputJoinedCutRecordV1 {
    pub const fn request_identity(&self) -> ObservationCensusIdentity {
        self.request_identity
    }
    pub const fn request_meaning_digest(&self) -> ObservationCensusIdentity {
        self.request_meaning_digest
    }
    pub const fn observation_census_identity(&self) -> ObservationCensusIdentity {
        self.observation_census_identity
    }
    pub const fn observation_census_digest(&self) -> ObservationCensusIdentity {
        self.observation_census_digest
    }
    pub const fn joined_cut_receipt(&self) -> &StrategyInputJoinedCutReceiptV1 {
        &self.joined_cut_receipt
    }
    pub fn canonical_bytes(&self) -> &[u8] {
        &self.canonical_bytes
    }
    pub const fn identity(&self) -> ObservationCensusIdentity {
        self.identity
    }
    pub const fn digest(&self) -> ObservationCensusIdentity {
        self.identity
    }
    pub const fn locator(&self) -> UntrustedStrategyInputJoinedCutLocatorV1 {
        UntrustedStrategyInputJoinedCutLocatorV1 {
            joined_cut_identity: self.identity,
            joined_cut_digest: self.identity,
        }
    }
}

#[derive(Debug, Eq, PartialEq)]
pub struct StrategyInputJoinedCutReadbackV1 {
    record: StrategyInputJoinedCutRecordV1,
}
impl StrategyInputJoinedCutReadbackV1 {
    pub const fn record(&self) -> &StrategyInputJoinedCutRecordV1 {
        &self.record
    }
}

#[doc(hidden)]
pub(crate) mod resolver_seal {
    pub trait Sealed {}
}

#[async_trait::async_trait]
#[allow(private_bounds)]
pub trait ObservationCensusResolverV1: resolver_seal::Sealed + Send + Sync {
    async fn resolve_observation_census_v1(
        &self,
        request: &UntrustedObservationCensusRequestV1,
    ) -> Result<ObservationCensusReadbackV1, ObservationCensusErrorV1>;
    async fn recover_observation_census_v1(
        &self,
        locator: &UntrustedObservationCensusLocatorV1,
    ) -> Result<ObservationCensusReadbackV1, ObservationCensusErrorV1>;
}

#[async_trait::async_trait]
#[allow(private_bounds)]
pub trait StrategyInputJoinedCutOwnerResolverV1: resolver_seal::Sealed + Send + Sync {
    async fn resolve_strategy_input_joined_cut_v1(
        &self,
        locator: &UntrustedStrategyInputJoinedCutLocatorV1,
    ) -> Result<StrategyInputJoinedCutReadbackV1, ObservationCensusErrorV1>;
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ObservationCensusErrorV1 {
    InvalidRequest,
    IncompleteCensus,
    NonCanonicalOrder,
    CapacityExceeded,
    CodecMismatch,
    DigestMismatch,
    JoinedCutUnavailable,
    MarketSemanticsUnavailable,
    RequestConflict,
    UnknownIdentity,
    StoreUnavailable,
    CommitInterrupted,
    ResponseLost,
}

impl Display for ObservationCensusErrorV1 {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{self:?}")
    }
}
impl std::error::Error for ObservationCensusErrorV1 {}
