//! Native Market Data Owner authority for Market Semantics Compatibility.
//!
//! The public-facing repository has no constructor or resolver for positive custody. This module
//! is crate-private until the durable Strategy Input Binding Registry composes it in the same
//! Owner transaction.

#![allow(
    dead_code,
    reason = "the private native leaf intentionally awaits Strategy Input Binding Registry composition"
)]

use std::fmt::Display;

use super::source_binding::BindingDigest;

pub(super) mod authority;
pub(super) mod codec;

#[cfg(test)]
mod tests;

pub(crate) type MarketSemanticsIdentity = BindingDigest;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u16)]
pub(crate) enum MarketSemanticsConsumerV1 {
    StrategyInputBindingRegistry = 1,
    ReplayMarketFactsV2 = 2,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u16)]
pub(crate) enum MarketSemanticsPriceAdjustmentV1 {
    Raw = 1,
    SplitAdjusted = 2,
    TotalReturnAdjusted = 3,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u16)]
pub(crate) enum MarketSemanticsTimestampBasisV1 {
    EventEffective = 1,
    IntervalOpen = 2,
    IntervalClose = 3,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct MarketSemanticsValueV1 {
    pub(crate) normalization_identity: MarketSemanticsIdentity,
    pub(crate) price_adjustment: MarketSemanticsPriceAdjustmentV1,
    pub(crate) timestamp_basis: MarketSemanticsTimestampBasisV1,
    pub(crate) price_unit_identity: MarketSemanticsIdentity,
    pub(crate) size_unit_identity: MarketSemanticsIdentity,
}

/// Caller-controlled claim. None of these fields carries positive Owner authority.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct UntrustedMarketSemanticsProposalV1 {
    pub(crate) request_identity: MarketSemanticsIdentity,
    pub(crate) request_meaning_digest: MarketSemanticsIdentity,
    pub(crate) consumer: MarketSemanticsConsumerV1,
    pub(crate) compatibility_scope_identity: MarketSemanticsIdentity,
    pub(crate) predecessor_identity: Option<MarketSemanticsIdentity>,
    pub(crate) value: MarketSemanticsValueV1,
    pub(crate) effective_from_ns: i128,
    pub(crate) effective_until_ns: Option<i128>,
    pub(crate) effective_instant_ns: i128,
    pub(crate) owner_observation_ns: i128,
    pub(crate) decision_cut: u64,
    pub(crate) pit_locator_bytes: Box<[u8]>,
    pub(crate) source_binding_locator_bytes: Box<[u8]>,
    pub(crate) instrument_master_locator_bytes: Box<[u8]>,
    pub(crate) r0_locator_bytes: Box<[u8]>,
    pub(crate) stable_correlation: MarketSemanticsIdentity,
}

impl UntrustedMarketSemanticsProposalV1 {
    pub(crate) fn locator(&self) -> UntrustedMarketSemanticsLocatorV1 {
        UntrustedMarketSemanticsLocatorV1 {
            request_identity: self.request_identity,
            request_meaning_digest: self.request_meaning_digest,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct UntrustedMarketSemanticsLocatorV1 {
    pub(crate) request_identity: MarketSemanticsIdentity,
    pub(crate) request_meaning_digest: MarketSemanticsIdentity,
}

/// Market Data-owned closed-registry projection. It is never accepted from a public caller.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct MarketSemanticsRegistryKeyV1 {
    pub(super) compatibility_scope_identity: MarketSemanticsIdentity,
    pub(super) r0_record_identity: MarketSemanticsIdentity,
    pub(super) r0_record_digest: MarketSemanticsIdentity,
    pub(super) r0_cut_identity: MarketSemanticsIdentity,
    pub(super) r0_cut_digest: MarketSemanticsIdentity,
    pub(super) pit_snapshot_identity: MarketSemanticsIdentity,
    pub(super) pit_fact_digest: MarketSemanticsIdentity,
    pub(super) source_binding_identity: MarketSemanticsIdentity,
    pub(super) source_binding_fact_digest: MarketSemanticsIdentity,
    pub(super) source_binding_lineage_root: MarketSemanticsIdentity,
    pub(super) source_binding_lineage_version: u64,
    pub(super) instrument_master_readback_digest: MarketSemanticsIdentity,
    pub(super) instrument_master_fact_digest: MarketSemanticsIdentity,
    pub(super) instrument_master_cut_digest: MarketSemanticsIdentity,
    pub(super) source_frontier: MarketSemanticsIdentity,
    pub(super) correction_frontier: MarketSemanticsIdentity,
    pub(super) canonical_bytes: Box<[u8]>,
    pub(super) identity: MarketSemanticsIdentity,
}

impl MarketSemanticsRegistryKeyV1 {
    pub(crate) const fn identity(&self) -> MarketSemanticsIdentity {
        self.identity
    }
    pub(crate) fn canonical_bytes(&self) -> &[u8] {
        &self.canonical_bytes
    }
}

/// Market Data-owned closed-registry record. Its constructor is private to the authority module.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct MarketSemanticsRegistryEntryV1 {
    pub(super) key: MarketSemanticsRegistryKeyV1,
    pub(super) value: MarketSemanticsValueV1,
    pub(super) correction_identity: MarketSemanticsIdentity,
    pub(super) canonical_bytes: Box<[u8]>,
    pub(super) identity: MarketSemanticsIdentity,
}

impl MarketSemanticsRegistryEntryV1 {
    pub(crate) const fn key(&self) -> &MarketSemanticsRegistryKeyV1 {
        &self.key
    }
    pub(crate) const fn value(&self) -> MarketSemanticsValueV1 {
        self.value
    }
    pub(crate) const fn correction_identity(&self) -> MarketSemanticsIdentity {
        self.correction_identity
    }
    pub(crate) fn canonical_bytes(&self) -> &[u8] {
        &self.canonical_bytes
    }
    pub(crate) const fn identity(&self) -> MarketSemanticsIdentity {
        self.identity
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct AuthenticatedMarketSemanticsInputsV1 {
    registry: MarketSemanticsRegistryEntryV1,
    coordinate_identity: MarketSemanticsIdentity,
    coordinate_digest: MarketSemanticsIdentity,
    r0_cut_identity: MarketSemanticsIdentity,
    r0_cut_digest: MarketSemanticsIdentity,
    pit_snapshot_identity: MarketSemanticsIdentity,
    pit_fact_digest: MarketSemanticsIdentity,
    source_binding_identity: MarketSemanticsIdentity,
    source_binding_fact_digest: MarketSemanticsIdentity,
    source_binding_lineage_root: MarketSemanticsIdentity,
    source_binding_lineage_version: u64,
    instrument_master_readback_digest: MarketSemanticsIdentity,
    instrument_master_fact_digest: MarketSemanticsIdentity,
    instrument_master_cut_digest: MarketSemanticsIdentity,
    source_frontier: MarketSemanticsIdentity,
    correction_frontier: MarketSemanticsIdentity,
    provider_available_ns: i128,
    retrieval_ns: i128,
    correction_publication_ns: i128,
    effective_from_ns: i128,
    effective_until_ns: Option<i128>,
    owner_observation_ns: i128,
    decision_cut: u64,
    predecessor_identity: Option<MarketSemanticsIdentity>,
    stable_correlation: MarketSemanticsIdentity,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct MarketSemanticsFactV1 {
    pub(super) compatibility_scope_identity: MarketSemanticsIdentity,
    pub(super) predecessor_identity: Option<MarketSemanticsIdentity>,
    pub(super) value: MarketSemanticsValueV1,
    pub(super) effective_from_ns: i128,
    pub(super) effective_until_ns: Option<i128>,
    pub(super) provider_available_ns: i128,
    pub(super) retrieval_ns: i128,
    pub(super) correction_publication_ns: i128,
    pub(super) owner_observation_ns: i128,
    pub(super) decision_cut: u64,
    pub(super) coordinate_identity: MarketSemanticsIdentity,
    pub(super) coordinate_digest: MarketSemanticsIdentity,
    pub(super) pit_snapshot_identity: MarketSemanticsIdentity,
    pub(super) pit_fact_digest: MarketSemanticsIdentity,
    pub(super) source_binding_identity: MarketSemanticsIdentity,
    pub(super) source_binding_fact_digest: MarketSemanticsIdentity,
    pub(super) source_binding_lineage_root: MarketSemanticsIdentity,
    pub(super) source_binding_lineage_version: u64,
    pub(super) instrument_master_readback_digest: MarketSemanticsIdentity,
    pub(super) instrument_master_fact_digest: MarketSemanticsIdentity,
    pub(super) instrument_master_cut_digest: MarketSemanticsIdentity,
    pub(super) source_frontier: MarketSemanticsIdentity,
    pub(super) correction_frontier: MarketSemanticsIdentity,
    pub(super) correction_identity: MarketSemanticsIdentity,
    pub(super) canonical_bytes: Box<[u8]>,
    pub(super) identity: MarketSemanticsIdentity,
}

impl MarketSemanticsFactV1 {
    pub(crate) const fn identity(&self) -> MarketSemanticsIdentity {
        self.identity
    }
    pub(crate) const fn digest(&self) -> MarketSemanticsIdentity {
        self.identity
    }
    pub(crate) fn canonical_bytes(&self) -> &[u8] {
        &self.canonical_bytes
    }
    pub(crate) const fn compatibility_scope_identity(&self) -> MarketSemanticsIdentity {
        self.compatibility_scope_identity
    }
    pub(crate) const fn predecessor_identity(&self) -> Option<MarketSemanticsIdentity> {
        self.predecessor_identity
    }
    pub(crate) const fn value(&self) -> MarketSemanticsValueV1 {
        self.value
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct MarketSemanticsCutEntryV1 {
    pub(super) scope_identity: MarketSemanticsIdentity,
    pub(super) fact_identity: MarketSemanticsIdentity,
    pub(super) fact_digest: MarketSemanticsIdentity,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct MarketSemanticsCutV1 {
    pub(super) request_identity: MarketSemanticsIdentity,
    pub(super) request_meaning_digest: MarketSemanticsIdentity,
    pub(super) consumer: MarketSemanticsConsumerV1,
    pub(super) compatibility_scope_identity: MarketSemanticsIdentity,
    pub(super) effective_instant_ns: i128,
    pub(super) owner_observation_ns: i128,
    pub(super) decision_cut: u64,
    pub(super) r0_cut_identity: MarketSemanticsIdentity,
    pub(super) r0_cut_digest: MarketSemanticsIdentity,
    pub(super) entries: Box<[MarketSemanticsCutEntryV1]>,
    pub(super) gaps: Box<[MarketSemanticsIdentity]>,
    pub(super) canonical_bytes: Box<[u8]>,
    pub(super) identity: MarketSemanticsIdentity,
}

impl MarketSemanticsCutV1 {
    pub(crate) const fn identity(&self) -> MarketSemanticsIdentity {
        self.identity
    }
    pub(crate) const fn digest(&self) -> MarketSemanticsIdentity {
        self.identity
    }
    pub(crate) fn canonical_bytes(&self) -> &[u8] {
        &self.canonical_bytes
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct MarketSemanticsReceiptV1 {
    pub(super) request_identity: MarketSemanticsIdentity,
    pub(super) request_meaning_digest: MarketSemanticsIdentity,
    pub(super) consumer: MarketSemanticsConsumerV1,
    pub(super) cut_identity: MarketSemanticsIdentity,
    pub(super) cut_digest: MarketSemanticsIdentity,
    pub(super) store_generation_identity: MarketSemanticsIdentity,
    pub(super) append_sequence: u64,
    pub(super) stable_correlation: MarketSemanticsIdentity,
    pub(super) canonical_bytes: Box<[u8]>,
    pub(super) identity: MarketSemanticsIdentity,
}

impl MarketSemanticsReceiptV1 {
    pub(crate) const fn identity(&self) -> MarketSemanticsIdentity {
        self.identity
    }
    pub(crate) fn canonical_bytes(&self) -> &[u8] {
        &self.canonical_bytes
    }
}

/// Move-only complete Owner custody.
#[derive(Debug, Eq, PartialEq)]
pub(crate) struct MarketSemanticsReadbackV1 {
    pub(super) facts: Box<[MarketSemanticsFactV1]>,
    pub(super) cut: MarketSemanticsCutV1,
    pub(super) receipt: MarketSemanticsReceiptV1,
    pub(super) outbox_identity: MarketSemanticsIdentity,
    pub(super) canonical_bytes: Box<[u8]>,
    pub(super) identity: MarketSemanticsIdentity,
}

impl MarketSemanticsReadbackV1 {
    pub(crate) fn facts(&self) -> &[MarketSemanticsFactV1] {
        &self.facts
    }
    pub(crate) const fn cut(&self) -> &MarketSemanticsCutV1 {
        &self.cut
    }
    pub(crate) const fn receipt(&self) -> &MarketSemanticsReceiptV1 {
        &self.receipt
    }
    pub(crate) const fn outbox_identity(&self) -> MarketSemanticsIdentity {
        self.outbox_identity
    }
    pub(crate) const fn identity(&self) -> MarketSemanticsIdentity {
        self.identity
    }
    pub(crate) fn canonical_bytes(&self) -> &[u8] {
        &self.canonical_bytes
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum MarketSemanticsErrorV1 {
    InvalidRequest,
    InvalidRegistryEntry,
    UnauthenticatedInput,
    DependencyMismatch,
    InvalidFact,
    InvalidCorrection,
    MissingPredecessor,
    PredecessorBranch,
    InvalidOverlap,
    IncompleteCut,
    CodecMismatch,
    DigestMismatch,
    CapacityExceeded,
    RequestConflict,
    UnknownIdentity,
    StoreUnavailable,
    StoreUntrusted,
}

impl Display for MarketSemanticsErrorV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{self:?}")
    }
}

impl std::error::Error for MarketSemanticsErrorV1 {}
