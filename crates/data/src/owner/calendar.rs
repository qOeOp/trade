//! Native Market Data authority for complete trading-calendar day cuts.
//!
//! Public inputs are untrusted request and recovery locators. Positive facts, cuts, receipts and
//! readbacks can be created only by the crate-private authority after it receives native Owner
//! evidence. The PostgreSQL leaf remains transaction-bound and is not registered as a product
//! resolver by this module.

use std::fmt::{Display, Formatter};

use super::source_binding::BindingDigest;

pub(crate) mod authority;
pub(crate) mod codec;

pub use authority::verify_calendar_readback_v1;

#[cfg(test)]
mod tests;

pub type CalendarIdentityV1 = BindingDigest;

/// Closed set of internal consumers admitted by the Calendar V1 contract.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u16)]
pub enum CalendarConsumerV1 {
    Pit = 1,
    InstrumentMaster = 2,
    ReplayV2 = 3,
    Bar = 4,
}

/// Untrusted idempotency key and exact requested Calendar meaning.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UntrustedCalendarRequestV1 {
    request_identity: CalendarIdentityV1,
    request_meaning_digest: CalendarIdentityV1,
    consumer: CalendarConsumerV1,
    calendar_identity: Box<[u8]>,
    first_day: i32,
    last_day_exclusive: i32,
    owner_observation_ns: i128,
    decision_cut: u64,
    source_binding_locator_bytes: Box<[u8]>,
    r0_locator_bytes: Box<[u8]>,
    stable_correlation: CalendarIdentityV1,
}

impl UntrustedCalendarRequestV1 {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        request_identity: CalendarIdentityV1,
        consumer: CalendarConsumerV1,
        calendar_identity: impl Into<Box<[u8]>>,
        first_day: i32,
        last_day_exclusive: i32,
        owner_observation_ns: i128,
        decision_cut: u64,
        source_binding_locator_bytes: impl Into<Box<[u8]>>,
        r0_locator_bytes: impl Into<Box<[u8]>>,
        stable_correlation: CalendarIdentityV1,
    ) -> Self {
        let mut request = Self {
            request_identity,
            request_meaning_digest: zero(),
            consumer,
            calendar_identity: calendar_identity.into(),
            first_day,
            last_day_exclusive,
            owner_observation_ns,
            decision_cut,
            source_binding_locator_bytes: source_binding_locator_bytes.into(),
            r0_locator_bytes: r0_locator_bytes.into(),
            stable_correlation,
        };
        request.request_meaning_digest =
            authority::request_meaning_digest(&request).unwrap_or_else(|_| zero());
        request
    }

    pub const fn request_identity(&self) -> CalendarIdentityV1 {
        self.request_identity
    }
    pub const fn request_meaning_digest(&self) -> CalendarIdentityV1 {
        self.request_meaning_digest
    }
    pub const fn consumer(&self) -> CalendarConsumerV1 {
        self.consumer
    }
    pub fn calendar_identity(&self) -> &[u8] {
        &self.calendar_identity
    }
    pub const fn first_day(&self) -> i32 {
        self.first_day
    }
    pub const fn last_day_exclusive(&self) -> i32 {
        self.last_day_exclusive
    }
    pub const fn owner_observation_ns(&self) -> i128 {
        self.owner_observation_ns
    }
    pub const fn decision_cut(&self) -> u64 {
        self.decision_cut
    }
    pub fn source_binding_locator_bytes(&self) -> &[u8] {
        &self.source_binding_locator_bytes
    }
    pub fn r0_locator_bytes(&self) -> &[u8] {
        &self.r0_locator_bytes
    }
    pub const fn stable_correlation(&self) -> CalendarIdentityV1 {
        self.stable_correlation
    }
    pub const fn locator(&self) -> UntrustedCalendarLocatorV1 {
        UntrustedCalendarLocatorV1 {
            request_identity: self.request_identity,
            request_meaning_digest: self.request_meaning_digest,
        }
    }
}

/// Exact untrusted response-loss locator. Construction grants no read authority.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct UntrustedCalendarLocatorV1 {
    request_identity: CalendarIdentityV1,
    request_meaning_digest: CalendarIdentityV1,
}

impl UntrustedCalendarLocatorV1 {
    pub const fn from_untrusted(
        request_identity: CalendarIdentityV1,
        request_meaning_digest: CalendarIdentityV1,
    ) -> Self {
        Self {
            request_identity,
            request_meaning_digest,
        }
    }
    pub const fn request_identity(&self) -> CalendarIdentityV1 {
        self.request_identity
    }
    pub const fn request_meaning_digest(&self) -> CalendarIdentityV1 {
        self.request_meaning_digest
    }
}

/// Immutable effective-dated open/closed disposition for one UTC civil day.
#[derive(Debug, Eq, PartialEq)]
pub struct CalendarFactV1 {
    pub(crate) calendar_identity: Box<[u8]>,
    pub(crate) day: i32,
    pub(crate) is_open: bool,
    pub(crate) lineage_root: CalendarIdentityV1,
    pub(crate) correction_sequence: u64,
    pub(crate) predecessor_identity: Option<CalendarIdentityV1>,
    pub(crate) effective_from_ns: i128,
    pub(crate) effective_until_ns: Option<i128>,
    pub(crate) provider_available_ns: i128,
    pub(crate) retrieval_ns: i128,
    pub(crate) correction_publication_ns: i128,
    pub(crate) owner_observation_ns: i128,
    pub(crate) decision_cut: u64,
    pub(crate) r0_coordinate_identity: CalendarIdentityV1,
    pub(crate) r0_coordinate_digest: CalendarIdentityV1,
    pub(crate) source_binding_identity: CalendarIdentityV1,
    pub(crate) source_binding_fact_digest: CalendarIdentityV1,
    pub(crate) source_binding_lineage_root: CalendarIdentityV1,
    pub(crate) source_binding_lineage_version: u64,
    pub(crate) source_frontier_digest: CalendarIdentityV1,
    pub(crate) correction_frontier_digest: CalendarIdentityV1,
    pub(crate) canonical_bytes: Box<[u8]>,
    pub(crate) identity: CalendarIdentityV1,
}

impl CalendarFactV1 {
    pub fn calendar_identity(&self) -> &[u8] {
        &self.calendar_identity
    }
    pub const fn day(&self) -> i32 {
        self.day
    }
    pub const fn is_open(&self) -> bool {
        self.is_open
    }
    pub const fn lineage_root(&self) -> CalendarIdentityV1 {
        self.lineage_root
    }
    pub const fn correction_sequence(&self) -> u64 {
        self.correction_sequence
    }
    pub const fn predecessor_identity(&self) -> Option<CalendarIdentityV1> {
        self.predecessor_identity
    }
    pub const fn identity(&self) -> CalendarIdentityV1 {
        self.identity
    }
    pub const fn digest(&self) -> CalendarIdentityV1 {
        self.identity
    }
    pub fn canonical_bytes(&self) -> &[u8] {
        &self.canonical_bytes
    }
}

/// Complete day census for one exact request.
#[derive(Debug, Eq, PartialEq)]
pub struct CalendarCutV1 {
    pub(crate) request_identity: CalendarIdentityV1,
    pub(crate) request_meaning_digest: CalendarIdentityV1,
    pub(crate) consumer: CalendarConsumerV1,
    pub(crate) calendar_identity: Box<[u8]>,
    pub(crate) first_day: i32,
    pub(crate) last_day_exclusive: i32,
    pub(crate) owner_observation_ns: i128,
    pub(crate) decision_cut: u64,
    pub(crate) r0_cut_identity: CalendarIdentityV1,
    pub(crate) r0_cut_digest: CalendarIdentityV1,
    pub(crate) days: Box<[(i32, CalendarIdentityV1, CalendarIdentityV1)]>,
    pub(crate) gaps: Box<[i32]>,
    pub(crate) canonical_bytes: Box<[u8]>,
    pub(crate) identity: CalendarIdentityV1,
}

impl CalendarCutV1 {
    pub const fn identity(&self) -> CalendarIdentityV1 {
        self.identity
    }
    pub const fn digest(&self) -> CalendarIdentityV1 {
        self.identity
    }
    pub fn calendar_identity(&self) -> &[u8] {
        &self.calendar_identity
    }
    pub const fn first_day(&self) -> i32 {
        self.first_day
    }
    pub const fn last_day_exclusive(&self) -> i32 {
        self.last_day_exclusive
    }
    pub fn days(&self) -> &[(i32, CalendarIdentityV1, CalendarIdentityV1)] {
        &self.days
    }
    pub fn canonical_bytes(&self) -> &[u8] {
        &self.canonical_bytes
    }
}

#[derive(Debug, Eq, PartialEq)]
pub(crate) struct CalendarReceiptV1 {
    pub(crate) request_identity: CalendarIdentityV1,
    pub(crate) request_meaning_digest: CalendarIdentityV1,
    pub(crate) cut_identity: CalendarIdentityV1,
    pub(crate) cut_digest: CalendarIdentityV1,
    pub(crate) store_generation_identity: CalendarIdentityV1,
    pub(crate) append_sequence: u64,
    pub(crate) stable_correlation: CalendarIdentityV1,
    pub(crate) outbox_identity: CalendarIdentityV1,
    pub(crate) canonical_bytes: Box<[u8]>,
    pub(crate) identity: CalendarIdentityV1,
}

/// Move-only Owner-sealed Calendar aggregate.
#[derive(Debug, Eq, PartialEq)]
pub struct CalendarReadbackV1 {
    pub(crate) facts: Box<[CalendarFactV1]>,
    pub(crate) cut: CalendarCutV1,
    pub(crate) receipt: CalendarReceiptV1,
    pub(crate) outbox_identity: CalendarIdentityV1,
    pub(crate) canonical_bytes: Box<[u8]>,
    pub(crate) identity: CalendarIdentityV1,
}

impl CalendarReadbackV1 {
    pub fn facts(&self) -> &[CalendarFactV1] {
        &self.facts
    }
    pub const fn cut(&self) -> &CalendarCutV1 {
        &self.cut
    }
    pub const fn receipt_identity(&self) -> CalendarIdentityV1 {
        self.receipt.identity
    }
    pub const fn outbox_identity(&self) -> CalendarIdentityV1 {
        self.outbox_identity
    }
    pub const fn identity(&self) -> CalendarIdentityV1 {
        self.identity
    }
    pub const fn digest(&self) -> CalendarIdentityV1 {
        self.identity
    }
    pub fn canonical_bytes(&self) -> &[u8] {
        &self.canonical_bytes
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CalendarErrorV1 {
    InvalidRequest,
    InvalidFact,
    InvalidPredecessor,
    CorrectionHeadMismatch,
    CoverageGap,
    DependencyMismatch,
    CapacityExceeded,
    CodecMismatch,
    DigestMismatch,
    ReplayConflict,
    UnknownIdentity,
    StoreUnavailable,
    StoreUntrusted,
    SequenceOverflow,
}

impl Display for CalendarErrorV1 {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{self:?}")
    }
}

impl std::error::Error for CalendarErrorV1 {}

const fn zero() -> CalendarIdentityV1 {
    BindingDigest::from_untrusted_bytes([0; 32])
}
