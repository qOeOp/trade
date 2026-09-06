//! Private native Time Zone authority.
//!
//! This leaf authenticates UTC-offset ruleset transitions. It neither selects ambiguous local
//! instants nor depends on Calendar or Session, and is not registered in the global store.

#![allow(
    dead_code,
    reason = "C2 is composed by a later native-reference-fact slice"
)]

use std::fmt::Display;

use super::{
    reference_fact_catalog::ReferenceFactCatalogEntryV1,
    reference_fact_coordinates::VerifiedReferenceFactCoordinatesV1, source_binding::BindingDigest,
};

pub(crate) mod authority;
pub(crate) mod codec;

#[cfg(test)]
pub(crate) mod tests;

pub(crate) type TimeZoneIdentity = BindingDigest;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u8)]
pub(crate) enum TimeZoneConsumerV1 {
    Pit = 1,
    InstrumentMaster = 2,
    ReplayV2 = 3,
    Bar = 4,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum TimeZoneErrorV1 {
    InvalidRequest,
    InvalidDependency,
    InvalidFact,
    IncompleteCoverage,
    NonCanonicalOrder,
    CapacityExceeded,
    RequestConflict,
    UnknownIdentity,
    StoreUntrusted,
    StoreUnavailable,
}

impl Display for TimeZoneErrorV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("native Time Zone authority rejected the operation")
    }
}

impl std::error::Error for TimeZoneErrorV1 {}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct VerifiedTimeZoneDependenciesV1 {
    coordinates: VerifiedReferenceFactCoordinatesV1,
    r0_coordinate_identity: TimeZoneIdentity,
    r0_coordinate_digest: TimeZoneIdentity,
}

impl VerifiedTimeZoneDependenciesV1 {
    pub(crate) fn verify(
        coordinates: VerifiedReferenceFactCoordinatesV1,
        r0_coordinate_identity: TimeZoneIdentity,
        r0_coordinate_digest: TimeZoneIdentity,
    ) -> Result<Self, TimeZoneErrorV1> {
        if !codec::nonzero(r0_coordinate_identity) || !codec::nonzero(r0_coordinate_digest) {
            return Err(TimeZoneErrorV1::InvalidDependency);
        }
        Ok(Self {
            coordinates,
            r0_coordinate_identity,
            r0_coordinate_digest,
        })
    }

    pub(crate) const fn coordinates(&self) -> &VerifiedReferenceFactCoordinatesV1 {
        &self.coordinates
    }
    pub(crate) const fn r0_coordinate_identity(&self) -> TimeZoneIdentity {
        self.r0_coordinate_identity
    }
    pub(crate) const fn r0_coordinate_digest(&self) -> TimeZoneIdentity {
        self.r0_coordinate_digest
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct TimeZoneFactProposalV1 {
    pub(crate) catalog_entry: ReferenceFactCatalogEntryV1,
    pub(crate) dependencies: VerifiedTimeZoneDependenciesV1,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct TimeZoneFactV1 {
    time_zone_identity: Box<[u8]>,
    ruleset_identity: TimeZoneIdentity,
    utc_offset_seconds: i32,
    correction_sequence: u64,
    lineage_root: TimeZoneIdentity,
    source_binding_identity: TimeZoneIdentity,
    predecessor_identity: Option<TimeZoneIdentity>,
    effective_from_ns: i128,
    effective_until_ns: Option<i128>,
    owner_observation_ns: i128,
    decision_cut: u64,
    identity: TimeZoneIdentity,
    canonical_bytes: Box<[u8]>,
}

impl TimeZoneFactV1 {
    pub(crate) fn time_zone_identity(&self) -> &[u8] {
        &self.time_zone_identity
    }
    pub(crate) const fn ruleset_identity(&self) -> TimeZoneIdentity {
        self.ruleset_identity
    }
    pub(crate) const fn utc_offset_seconds(&self) -> i32 {
        self.utc_offset_seconds
    }
    pub(crate) const fn correction_sequence(&self) -> u64 {
        self.correction_sequence
    }
    pub(crate) const fn identity(&self) -> TimeZoneIdentity {
        self.identity
    }
    pub(crate) fn canonical_bytes(&self) -> &[u8] {
        &self.canonical_bytes
    }
    pub(crate) const fn lineage_root(&self) -> TimeZoneIdentity {
        self.lineage_root
    }
    pub(crate) const fn source_binding_identity(&self) -> TimeZoneIdentity {
        self.source_binding_identity
    }
    pub(crate) const fn predecessor_identity(&self) -> Option<TimeZoneIdentity> {
        self.predecessor_identity
    }
    pub(crate) const fn effective_from_ns(&self) -> i128 {
        self.effective_from_ns
    }
    pub(crate) const fn effective_until_ns(&self) -> Option<i128> {
        self.effective_until_ns
    }
    pub(crate) const fn owner_observation_ns(&self) -> i128 {
        self.owner_observation_ns
    }
    pub(crate) const fn decision_cut(&self) -> u64 {
        self.decision_cut
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct UntrustedTimeZoneRequestV1 {
    pub(crate) request_identity: TimeZoneIdentity,
    pub(crate) consumer: TimeZoneConsumerV1,
    pub(crate) time_zone_identity: Box<[u8]>,
    pub(crate) ruleset_identity: TimeZoneIdentity,
    pub(crate) window_start_ns: i128,
    pub(crate) window_end_ns_exclusive: i128,
    pub(crate) owner_observation_ns: i128,
    pub(crate) decision_cut: u64,
    pub(crate) source_binding_locator_bytes: Box<[u8]>,
    pub(crate) r0_locator_bytes: Box<[u8]>,
    pub(crate) stable_correlation: TimeZoneIdentity,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct TimeZoneCutV1 {
    request_identity: TimeZoneIdentity,
    request_meaning_digest: TimeZoneIdentity,
    r0_cut_identity: TimeZoneIdentity,
    r0_cut_digest: TimeZoneIdentity,
    fact_identities: Box<[TimeZoneIdentity]>,
    identity: TimeZoneIdentity,
    canonical_bytes: Box<[u8]>,
}

impl TimeZoneCutV1 {
    pub(crate) const fn request_identity(&self) -> TimeZoneIdentity {
        self.request_identity
    }
    pub(crate) const fn request_meaning_digest(&self) -> TimeZoneIdentity {
        self.request_meaning_digest
    }
    pub(crate) const fn r0_cut_identity(&self) -> TimeZoneIdentity {
        self.r0_cut_identity
    }
    pub(crate) const fn r0_cut_digest(&self) -> TimeZoneIdentity {
        self.r0_cut_digest
    }
    pub(crate) fn fact_identities(&self) -> &[TimeZoneIdentity] {
        &self.fact_identities
    }
    pub(crate) const fn identity(&self) -> TimeZoneIdentity {
        self.identity
    }
    pub(crate) fn canonical_bytes(&self) -> &[u8] {
        &self.canonical_bytes
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct PreparedTimeZoneResolutionV1 {
    request: UntrustedTimeZoneRequestV1,
    facts: Box<[TimeZoneFactV1]>,
    cut: TimeZoneCutV1,
}

impl PreparedTimeZoneResolutionV1 {
    pub(crate) const fn request(&self) -> &UntrustedTimeZoneRequestV1 {
        &self.request
    }
    pub(crate) fn facts(&self) -> &[TimeZoneFactV1] {
        &self.facts
    }
    pub(crate) const fn cut(&self) -> &TimeZoneCutV1 {
        &self.cut
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct TimeZoneReceiptV1 {
    request_identity: TimeZoneIdentity,
    request_meaning_digest: TimeZoneIdentity,
    cut_identity: TimeZoneIdentity,
    cut_digest: TimeZoneIdentity,
    store_generation_identity: TimeZoneIdentity,
    append_sequence: u64,
    stable_correlation: TimeZoneIdentity,
    identity: TimeZoneIdentity,
    canonical_bytes: Box<[u8]>,
}

impl TimeZoneReceiptV1 {
    pub(crate) const fn request_identity(&self) -> TimeZoneIdentity {
        self.request_identity
    }
    pub(crate) const fn request_meaning_digest(&self) -> TimeZoneIdentity {
        self.request_meaning_digest
    }
    pub(crate) const fn cut_identity(&self) -> TimeZoneIdentity {
        self.cut_identity
    }
    pub(crate) const fn cut_digest(&self) -> TimeZoneIdentity {
        self.cut_digest
    }
    pub(crate) const fn store_generation_identity(&self) -> TimeZoneIdentity {
        self.store_generation_identity
    }
    pub(crate) const fn append_sequence(&self) -> u64 {
        self.append_sequence
    }
    pub(crate) const fn stable_correlation(&self) -> TimeZoneIdentity {
        self.stable_correlation
    }
    pub(crate) const fn identity(&self) -> TimeZoneIdentity {
        self.identity
    }
    pub(crate) fn canonical_bytes(&self) -> &[u8] {
        &self.canonical_bytes
    }
}

#[derive(Debug, Eq, PartialEq)]
pub(crate) struct TimeZoneReadbackV1 {
    facts: Box<[TimeZoneFactV1]>,
    cut: TimeZoneCutV1,
    receipt: TimeZoneReceiptV1,
    outbox_identity: TimeZoneIdentity,
    canonical_bytes: Box<[u8]>,
}

impl TimeZoneReadbackV1 {
    pub(crate) fn facts(&self) -> &[TimeZoneFactV1] {
        &self.facts
    }
    pub(crate) const fn cut(&self) -> &TimeZoneCutV1 {
        &self.cut
    }
    pub(crate) const fn receipt(&self) -> &TimeZoneReceiptV1 {
        &self.receipt
    }
    pub(crate) const fn outbox_identity(&self) -> TimeZoneIdentity {
        self.outbox_identity
    }
    pub(crate) fn canonical_bytes(&self) -> &[u8] {
        &self.canonical_bytes
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct UntrustedTimeZoneLocatorV1 {
    pub(crate) request_identity: TimeZoneIdentity,
    pub(crate) request_meaning_digest: TimeZoneIdentity,
}
