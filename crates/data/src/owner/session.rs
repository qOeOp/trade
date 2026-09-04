//! Private native Session authority: the sole join of Calendar and Time Zone cuts.

#![allow(
    dead_code,
    reason = "Session composition is delivered by a later Owner slice"
)]

use std::fmt::Display;

use super::{
    calendar::CalendarReadbackV1, reference_fact_coordinates::VerifiedReferenceFactCoordinatesV1,
    source_binding::BindingDigest, time_zone::TimeZoneReadbackV1,
};

pub(crate) mod authority;
pub(crate) mod codec;
#[cfg(test)]
pub(crate) mod tests;

pub(crate) type SessionIdentityV1 = BindingDigest;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u8)]
pub(crate) enum LocalResolutionV1 {
    Exact = 1,
    EarlierInstant = 2,
    LaterInstant = 3,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct LocalBoundaryV1 {
    pub(crate) day: i32,
    pub(crate) nanos_of_day: u64,
    pub(crate) resolution: LocalResolutionV1,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct InstrumentMasterReferenceV1 {
    pub(crate) locator_bytes: Box<[u8]>,
    pub(crate) readback_identity: SessionIdentityV1,
    pub(crate) fact_digest: SessionIdentityV1,
    pub(crate) cut_digest: SessionIdentityV1,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct SessionDependenciesV1<'a> {
    pub(crate) calendar: &'a CalendarReadbackV1,
    pub(crate) time_zone: &'a TimeZoneReadbackV1,
    pub(crate) instrument_master: InstrumentMasterReferenceV1,
    pub(crate) calendar_cut_locator_bytes: &'a [u8],
    pub(crate) time_zone_cut_locator_bytes: &'a [u8],
    pub(crate) source_binding_locator_bytes: &'a [u8],
    pub(crate) r0_locator_bytes: &'a [u8],
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct SessionFactProposalV1 {
    pub(crate) trading_day: i32,
    pub(crate) interval_ordinal: u32,
    pub(crate) local_open: LocalBoundaryV1,
    pub(crate) local_close: LocalBoundaryV1,
    pub(crate) predecessor_identity: Option<SessionIdentityV1>,
    pub(crate) correction_sequence: u64,
    pub(crate) correction_identity: SessionIdentityV1,
    pub(crate) coordinates: VerifiedReferenceFactCoordinatesV1,
    pub(crate) r0_coordinate_identity: SessionIdentityV1,
    pub(crate) r0_coordinate_digest: SessionIdentityV1,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct SessionFactV1 {
    pub(crate) session_identity: Box<[u8]>,
    pub(crate) trading_day: i32,
    pub(crate) interval_ordinal: u32,
    pub(crate) local_open: LocalBoundaryV1,
    pub(crate) local_close: LocalBoundaryV1,
    pub(crate) utc_open_ns: i128,
    pub(crate) utc_close_ns: i128,
    pub(crate) lineage_root: SessionIdentityV1,
    pub(crate) source_binding_identity: SessionIdentityV1,
    pub(crate) predecessor_identity: Option<SessionIdentityV1>,
    pub(crate) correction_sequence: u64,
    pub(crate) identity: SessionIdentityV1,
    pub(crate) canonical_bytes: Box<[u8]>,
}

impl SessionFactV1 {
    pub(crate) const fn identity(&self) -> SessionIdentityV1 {
        self.identity
    }
    pub(crate) fn canonical_bytes(&self) -> &[u8] {
        &self.canonical_bytes
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct UntrustedSessionRequestV1 {
    pub(crate) request_identity: SessionIdentityV1,
    pub(crate) session_identity: Box<[u8]>,
    pub(crate) first_day: i32,
    pub(crate) last_day_exclusive: i32,
    pub(crate) calendar_cut_locator_bytes: Box<[u8]>,
    pub(crate) time_zone_cut_locator_bytes: Box<[u8]>,
    pub(crate) source_binding_locator_bytes: Box<[u8]>,
    pub(crate) r0_locator_bytes: Box<[u8]>,
    pub(crate) owner_observation_ns: i128,
    pub(crate) decision_cut: u64,
    pub(crate) stable_correlation: SessionIdentityV1,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct SessionDayCensusV1 {
    pub(crate) day: i32,
    pub(crate) is_open: bool,
    pub(crate) intervals: Box<[(u32, SessionIdentityV1, SessionIdentityV1)]>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct SessionCutV1 {
    pub(crate) request_identity: SessionIdentityV1,
    pub(crate) request_meaning_digest: SessionIdentityV1,
    pub(crate) days: Box<[SessionDayCensusV1]>,
    pub(crate) fact_identities: Box<[SessionIdentityV1]>,
    pub(crate) identity: SessionIdentityV1,
    pub(crate) canonical_bytes: Box<[u8]>,
}

impl SessionCutV1 {
    pub(crate) const fn identity(&self) -> SessionIdentityV1 {
        self.identity
    }
    pub(crate) fn canonical_bytes(&self) -> &[u8] {
        &self.canonical_bytes
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct PreparedSessionResolutionV1 {
    pub(crate) request: UntrustedSessionRequestV1,
    pub(crate) facts: Box<[SessionFactV1]>,
    pub(crate) cut: SessionCutV1,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct SessionReceiptV1 {
    pub(crate) request_identity: SessionIdentityV1,
    pub(crate) request_meaning_digest: SessionIdentityV1,
    pub(crate) cut_identity: SessionIdentityV1,
    pub(crate) store_generation_identity: SessionIdentityV1,
    pub(crate) append_sequence: u64,
    pub(crate) stable_correlation: SessionIdentityV1,
    pub(crate) identity: SessionIdentityV1,
    pub(crate) canonical_bytes: Box<[u8]>,
}

#[derive(Debug, Eq, PartialEq)]
pub(crate) struct SessionReadbackV1 {
    pub(crate) facts: Box<[SessionFactV1]>,
    pub(crate) cut: SessionCutV1,
    pub(crate) receipt: SessionReceiptV1,
    pub(crate) outbox_identity: SessionIdentityV1,
    pub(crate) canonical_bytes: Box<[u8]>,
    pub(crate) identity: SessionIdentityV1,
}

impl SessionReadbackV1 {
    pub(crate) fn facts(&self) -> &[SessionFactV1] {
        &self.facts
    }
    pub(crate) fn canonical_bytes(&self) -> &[u8] {
        &self.canonical_bytes
    }
    pub(crate) const fn identity(&self) -> SessionIdentityV1 {
        self.identity
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct UntrustedSessionLocatorV1 {
    pub(crate) request_identity: SessionIdentityV1,
    pub(crate) request_meaning_digest: SessionIdentityV1,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum SessionErrorV1 {
    InvalidRequest,
    InvalidDependency,
    InvalidBoundary,
    GapBoundary,
    AmbiguousBoundary,
    IncompleteCensus,
    NonCanonicalOrder,
    CapacityExceeded,
    RequestConflict,
    UnknownIdentity,
    StoreUntrusted,
    StoreUnavailable,
}
impl Display for SessionErrorV1 {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("native Session authority rejected the operation")
    }
}
impl std::error::Error for SessionErrorV1 {}
