//! Canonical Market Data sample-fact contracts.
//!
//! Issuance and durable preparation stay crate-private. Public values are opaque read-only
//! authority artifacts: they have no public constructor and deliberately implement neither
//! `Clone` nor `Deserialize`.
#![allow(
    dead_code,
    reason = "crate-private custody seam is consumed by the separately integrated PostgreSQL owner"
)]
//!
//! ```compile_fail
//! use vibe_data::owner::sample_fact::SampleReceiptV1;
//! let _: SampleReceiptV1 = serde_json::from_slice(b"{}").unwrap();
//! ```
//!
//! ```compile_fail
//! use vibe_data::owner::sample_fact::TimeframeProjectionReceiptV1;
//! fn requires_clone<T: Clone>() {}
//! requires_clone::<TimeframeProjectionReceiptV1>();
//! ```

use std::fmt::Display;

use sha2::{Digest as _, Sha256};

use super::{
    instrument_master::{InstrumentMasterFactV1, InstrumentMasterReadbackV1},
    source_binding::BindingDigest,
    strategy_input_binding::{
        STRATEGY_INPUT_FIXED_I128_LE_V1, StrategyInputBindingReceipt,
        StrategyInputBindingUnavailable, project_sample_fact_v1,
    },
};
use crate::owner::pit_snapshot::VerifiedPitObservationBatch;

const TIMEFRAME_SPEC_LEN: usize = 140;
const TIMEFRAME_PROJECTION_LEN: usize = 208;
const SAMPLE_RECEIPT_LEN: usize = 244;

const TIMEFRAME_ID_DOMAIN: &[u8] = b"market-data.timeframe.identity.v1\0";
const TIMEFRAME_RECEIPT_DOMAIN: &[u8] = b"market-data.timeframe-projection-receipt.v1\0";
const TIMEFRAME_ANCHOR_DOMAIN: &[u8] = b"market-data.timeframe.anchor.owner-evidence.v1\0";
const TIMEFRAME_CALENDAR_DOMAIN: &[u8] = b"market-data.timeframe.calendar.owner-evidence.v1\0";
const TIMEFRAME_SESSION_DOMAIN: &[u8] = b"market-data.timeframe.session.owner-evidence.v1\0";
const TIMEFRAME_TIME_ZONE_DOMAIN: &[u8] = b"market-data.timeframe.time-zone.owner-evidence.v1\0";
const EVENT_ID_DOMAIN: &[u8] = b"market-data.sample-event.identity.v1\0";
const SERIES_ID_DOMAIN: &[u8] = b"market-data.sample-series.identity.v1\0";
const SLOT_ID_DOMAIN: &[u8] = b"market-data.sample-slot.identity.v1\0";
const FACT_DIGEST_DOMAIN: &[u8] = b"market-data.sample-fact.v1\0";
const SAMPLE_ID_DOMAIN: &[u8] = b"market-data.sample.identity.v1\0";
const RECEIPT_DOMAIN: &[u8] = b"market-data.sample-receipt.v1\0";

type Identity = [u8; 32];

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u8)]
enum TimeframeKind {
    PointEvent = 0x01,
    FixedIntervalBar = 0x02,
    ExchangeSessionBar = 0x03,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u8)]
enum TimeframeUnit {
    NotApplicable = 0x00,
    Second = 0x01,
    Minute = 0x02,
    Hour = 0x03,
    ExchangeSessionDay = 0x04,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u8)]
enum LabelRule {
    EventEffective = 0x00,
    IntervalOpen = 0x01,
    IntervalClose = 0x02,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u8)]
enum PartialBarRule {
    NotApplicable = 0x00,
    CompleteOnly = 0x01,
    AdmitPartialAsDistinctSlot = 0x02,
}

/// Untrusted fixed-interval unit proposal. It cannot mint a timeframe identity.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum BarTimeframeUnitV1 {
    Second,
    Minute,
    Hour,
}

/// Untrusted bar-label proposal. It cannot mint a timeframe identity.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum BarLabelRuleV1 {
    IntervalOpen,
    IntervalClose,
}

/// Untrusted partial-bar proposal. V1 native preparation currently admits complete bars only.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum BarPartialRuleV1 {
    CompleteOnly,
    AdmitPartialAsDistinctSlot,
}

/// Untrusted structured proposal for one schedule-bounded fixed-interval bar.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct UntrustedFixedIntervalBarTimeframeV1 {
    pub step: u32,
    pub unit: BarTimeframeUnitV1,
    pub label: BarLabelRuleV1,
    pub partial: BarPartialRuleV1,
}

/// Untrusted structured proposal for one exchange-session-day bar.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct UntrustedExchangeSessionBarTimeframeV1 {
    pub label: BarLabelRuleV1,
    pub partial: BarPartialRuleV1,
}

/// Closed untrusted BAR timeframe proposal. Binding labels are never parsed into this value.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum UntrustedBarTimeframeProposalV1 {
    FixedInterval(UntrustedFixedIntervalBarTimeframeV1),
    ExchangeSession(UntrustedExchangeSessionBarTimeframeV1),
}

/// One exact canonical timeframe specification.
#[derive(Debug)]
pub struct TimeframeSpecV1 {
    bytes: [u8; TIMEFRAME_SPEC_LEN],
    identity: Identity,
}

impl TimeframeSpecV1 {
    fn point_event() -> Self {
        let mut bytes = Vec::with_capacity(TIMEFRAME_SPEC_LEN);
        put_u16(&mut bytes, 1);
        put_u16(&mut bytes, 0);
        bytes.push(TimeframeKind::PointEvent as u8);
        put_u32(&mut bytes, 1);
        bytes.push(TimeframeUnit::NotApplicable as u8);
        bytes.extend_from_slice(&[0; 128]);
        bytes.push(LabelRule::EventEffective as u8);
        bytes.push(PartialBarRule::NotApplicable as u8);
        let bytes: [u8; TIMEFRAME_SPEC_LEN] = bytes.try_into().expect("fixed timeframe width");
        Self {
            identity: sha256(TIMEFRAME_ID_DOMAIN, &bytes),
            bytes,
        }
    }

    #[allow(
        clippy::too_many_arguments,
        reason = "the documented fixed-width timeframe tuple has one canonical constructor"
    )]
    fn bar(
        kind: TimeframeKind,
        step: u32,
        unit: TimeframeUnit,
        anchor: Identity,
        calendar: Identity,
        session: Identity,
        time_zone: Identity,
        label: LabelRule,
        partial: PartialBarRule,
    ) -> Result<Self, SampleFactUnavailable> {
        validate_timeframe_combination(
            kind as u8,
            step,
            unit as u8,
            anchor,
            calendar,
            session,
            time_zone,
            label as u8,
            partial as u8,
        )?;
        let mut bytes = Vec::with_capacity(TIMEFRAME_SPEC_LEN);
        put_u16(&mut bytes, 1);
        put_u16(&mut bytes, 0);
        bytes.push(kind as u8);
        put_u32(&mut bytes, step);
        bytes.push(unit as u8);
        bytes.extend_from_slice(&anchor);
        bytes.extend_from_slice(&calendar);
        bytes.extend_from_slice(&session);
        bytes.extend_from_slice(&time_zone);
        bytes.push(label as u8);
        bytes.push(partial as u8);
        let bytes: [u8; TIMEFRAME_SPEC_LEN] = bytes
            .try_into()
            .map_err(|_| SampleFactUnavailable::InvalidLength)?;
        Ok(Self {
            identity: sha256(TIMEFRAME_ID_DOMAIN, &bytes),
            bytes,
        })
    }

    fn decode(bytes: &[u8]) -> Result<Self, SampleFactUnavailable> {
        if bytes.len() != TIMEFRAME_SPEC_LEN {
            return Err(SampleFactUnavailable::InvalidLength);
        }
        let mut decoder = Decoder::new(bytes);
        decoder.schema(1)?;
        let kind = decoder.u8()?;
        let step = decoder.u32()?;
        let unit = decoder.u8()?;
        let anchor = decoder.identity()?;
        let calendar = decoder.identity()?;
        let session = decoder.identity()?;
        let time_zone = decoder.identity()?;
        let label = decoder.u8()?;
        let partial = decoder.u8()?;
        decoder.end()?;
        validate_timeframe_combination(
            kind, step, unit, anchor, calendar, session, time_zone, label, partial,
        )?;
        let bytes: [u8; TIMEFRAME_SPEC_LEN] = bytes
            .try_into()
            .map_err(|_| SampleFactUnavailable::InvalidLength)?;
        Ok(Self {
            identity: sha256(TIMEFRAME_ID_DOMAIN, &bytes),
            bytes,
        })
    }

    /// Returns the canonical fixed-width bytes.
    #[must_use]
    pub const fn canonical_bytes(&self) -> &[u8; TIMEFRAME_SPEC_LEN] {
        &self.bytes
    }

    /// Returns the domain-separated canonical identity.
    #[must_use]
    pub const fn identity(&self) -> Identity {
        self.identity
    }
}

/// Opaque receipt binding one historical V1 binding digest to its timeframe specification.
#[derive(Debug)]
pub struct TimeframeProjectionReceiptV1 {
    bytes: [u8; TIMEFRAME_PROJECTION_LEN],
    digest: Identity,
    binding_receipt_digest: Identity,
    timeframe_identity: Identity,
    spec: TimeframeSpecV1,
}

impl TimeframeProjectionReceiptV1 {
    fn point_event(binding: &StrategyInputBindingReceipt) -> Self {
        let spec = TimeframeSpecV1::point_event();
        let binding_receipt_digest = *binding.digest().as_bytes();
        let mut bytes = Vec::with_capacity(TIMEFRAME_PROJECTION_LEN);
        put_u16(&mut bytes, 1);
        put_u16(&mut bytes, 0);
        bytes.extend_from_slice(&binding_receipt_digest);
        bytes.extend_from_slice(&spec.identity);
        bytes.extend_from_slice(&spec.bytes);
        let bytes: [u8; TIMEFRAME_PROJECTION_LEN] =
            bytes.try_into().expect("fixed timeframe receipt width");
        Self {
            digest: sha256(TIMEFRAME_RECEIPT_DOMAIN, &bytes),
            bytes,
            binding_receipt_digest,
            timeframe_identity: spec.identity,
            spec,
        }
    }

    fn from_spec(binding: &StrategyInputBindingReceipt, spec: TimeframeSpecV1) -> Self {
        let binding_receipt_digest = *binding.digest().as_bytes();
        let mut bytes = Vec::with_capacity(TIMEFRAME_PROJECTION_LEN);
        put_u16(&mut bytes, 1);
        put_u16(&mut bytes, 0);
        bytes.extend_from_slice(&binding_receipt_digest);
        bytes.extend_from_slice(&spec.identity);
        bytes.extend_from_slice(&spec.bytes);
        let bytes: [u8; TIMEFRAME_PROJECTION_LEN] =
            bytes.try_into().expect("fixed timeframe receipt width");
        Self {
            digest: sha256(TIMEFRAME_RECEIPT_DOMAIN, &bytes),
            bytes,
            binding_receipt_digest,
            timeframe_identity: spec.identity,
            spec,
        }
    }

    fn decode(bytes: &[u8], expected_digest: Identity) -> Result<Self, SampleFactUnavailable> {
        if bytes.len() != TIMEFRAME_PROJECTION_LEN {
            return Err(SampleFactUnavailable::InvalidLength);
        }

        if sha256(TIMEFRAME_RECEIPT_DOMAIN, bytes) != expected_digest {
            return Err(SampleFactUnavailable::DigestMismatch);
        }
        let mut decoder = Decoder::new(bytes);
        decoder.schema(1)?;
        let binding_receipt_digest = decoder.identity()?;
        let timeframe_identity = decoder.identity()?;
        let spec = TimeframeSpecV1::decode(decoder.take(TIMEFRAME_SPEC_LEN)?)?;
        decoder.end()?;

        if spec.identity != timeframe_identity {
            return Err(SampleFactUnavailable::IdentityMismatch);
        }
        let bytes: [u8; TIMEFRAME_PROJECTION_LEN] = bytes
            .try_into()
            .map_err(|_| SampleFactUnavailable::InvalidLength)?;
        Ok(Self {
            bytes,
            digest: expected_digest,
            binding_receipt_digest,
            timeframe_identity,
            spec,
        })
    }

    #[must_use]
    pub const fn canonical_bytes(&self) -> &[u8; TIMEFRAME_PROJECTION_LEN] {
        &self.bytes
    }
    #[must_use]
    pub const fn digest(&self) -> Identity {
        self.digest
    }
    #[must_use]
    pub const fn binding_receipt_digest(&self) -> Identity {
        self.binding_receipt_digest
    }
    #[must_use]
    pub const fn timeframe_identity(&self) -> Identity {
        self.timeframe_identity
    }
    #[must_use]
    pub const fn spec(&self) -> &TimeframeSpecV1 {
        &self.spec
    }
    pub(crate) fn is_point_event(&self) -> bool {
        self.spec.bytes[4] == TimeframeKind::PointEvent as u8
    }
    pub(crate) fn is_bar(&self) -> bool {
        matches!(
            self.spec.bytes[4],
            x if x == TimeframeKind::FixedIntervalBar as u8
                || x == TimeframeKind::ExchangeSessionBar as u8
        )
    }
}

/// Canonical immutable fact for one series slot.
#[derive(Debug)]
pub struct SampleFactV1 {
    bytes: Box<[u8]>,
    series_identity: Identity,
    slot_identity: Identity,
    series_predecessor: Identity,
    correction_predecessor: Option<Identity>,
    snapshot_identity: Identity,
    snapshot_fact_digest: Identity,
    observation_batch_digest: Identity,
    timeframe_identity: Identity,
    owner_event_identity: [u8; 16],
    fact_digest: Identity,
    sample_identity: Identity,
    canonical_row_digest: Identity,
}

impl SampleFactV1 {
    #[must_use]
    pub fn canonical_bytes(&self) -> &[u8] {
        &self.bytes
    }
    #[must_use]
    pub const fn series_identity(&self) -> Identity {
        self.series_identity
    }
    #[must_use]
    pub const fn slot_identity(&self) -> Identity {
        self.slot_identity
    }
    #[must_use]
    pub const fn series_predecessor(&self) -> Identity {
        self.series_predecessor
    }
    #[must_use]
    pub const fn correction_predecessor(&self) -> Option<Identity> {
        self.correction_predecessor
    }
    #[must_use]
    pub const fn snapshot_identity(&self) -> Identity {
        self.snapshot_identity
    }
    #[must_use]
    pub const fn snapshot_fact_digest(&self) -> Identity {
        self.snapshot_fact_digest
    }
    #[must_use]
    pub const fn observation_batch_digest(&self) -> Identity {
        self.observation_batch_digest
    }
    #[must_use]
    pub const fn timeframe_identity(&self) -> Identity {
        self.timeframe_identity
    }
    #[must_use]
    pub const fn owner_event_identity(&self) -> [u8; 16] {
        self.owner_event_identity
    }
    #[must_use]
    pub const fn fact_digest(&self) -> Identity {
        self.fact_digest
    }
    #[must_use]
    pub const fn sample_identity(&self) -> Identity {
        self.sample_identity
    }
    #[must_use]
    pub const fn canonical_row_digest(&self) -> Identity {
        self.canonical_row_digest
    }
}

/// Exact role-independent 244-byte sample receipt.
#[derive(Debug)]
pub struct SampleReceiptV1 {
    bytes: [u8; SAMPLE_RECEIPT_LEN],
    digest: Identity,
    sample_identity: Identity,
    fact_digest: Identity,
    timeframe_identity: Identity,
    owner_event_identity: [u8; 16],
    logical_time: u64,
    event_effective: u64,
    owner_sequence: u64,
    canonical_row_digest: Identity,
    source_binding_lineage_root: Identity,
    source_binding_lineage_version: u64,
    market_semantics_identity: Identity,
}

impl SampleReceiptV1 {
    #[must_use]
    pub const fn canonical_bytes(&self) -> &[u8; SAMPLE_RECEIPT_LEN] {
        &self.bytes
    }
    #[must_use]
    pub const fn digest(&self) -> Identity {
        self.digest
    }
    #[must_use]
    pub const fn sample_identity(&self) -> Identity {
        self.sample_identity
    }
    #[must_use]
    pub const fn fact_digest(&self) -> Identity {
        self.fact_digest
    }
    #[must_use]
    pub const fn timeframe_identity(&self) -> Identity {
        self.timeframe_identity
    }
    #[must_use]
    pub const fn owner_event_identity(&self) -> [u8; 16] {
        self.owner_event_identity
    }
    #[must_use]
    pub const fn logical_time(&self) -> u64 {
        self.logical_time
    }
    #[must_use]
    pub const fn event_effective(&self) -> u64 {
        self.event_effective
    }
    #[must_use]
    pub const fn owner_sequence(&self) -> u64 {
        self.owner_sequence
    }
    #[must_use]
    pub const fn canonical_row_digest(&self) -> Identity {
        self.canonical_row_digest
    }
    #[must_use]
    pub const fn source_binding_lineage_root(&self) -> Identity {
        self.source_binding_lineage_root
    }
    #[must_use]
    pub const fn source_binding_lineage_version(&self) -> u64 {
        self.source_binding_lineage_version
    }
    #[must_use]
    pub const fn market_semantics_identity(&self) -> Identity {
        self.market_semantics_identity
    }
}

/// Fail-closed canonicalization or authority error.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum SampleFactUnavailable {
    BindingUnavailable,
    UnsupportedDataKind,
    UnsupportedTimeframe,
    AmbiguousInstrumentMaster,
    InstrumentMasterMismatch,
    InvalidTag,
    InvalidCombination,
    InvalidLength,
    ReservedNonZero,
    TrailingBytes,
    OversizedValue,
    EmptyValue,
    ZeroIdentity,
    DigestMismatch,
    IdentityMismatch,
    ReceiptMismatch,
    PredecessorMismatch,
}

impl Display for SampleFactUnavailable {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{self:?}")
    }
}

impl std::error::Error for SampleFactUnavailable {}

impl From<StrategyInputBindingUnavailable> for SampleFactUnavailable {
    fn from(_: StrategyInputBindingUnavailable) -> Self {
        Self::BindingUnavailable
    }
}

/// Owner-known current heads used to prepare one atomic durable commit.
#[derive(Clone, Copy)]
pub(crate) struct SampleFactHeadsV1<'a> {
    pub(crate) series: Option<&'a StoredSampleReadbackV1>,
    pub(crate) slot: Option<&'a StoredSampleReadbackV1>,
}

/// Fully verified fact/receipt readback reconstructed only from exact stored canonical bytes.
pub(crate) struct StoredSampleReadbackV1 {
    fact: SampleFactV1,
    receipt: SampleReceiptV1,
}

impl StoredSampleReadbackV1 {
    pub(crate) const fn fact(&self) -> &SampleFactV1 {
        &self.fact
    }
    pub(crate) const fn receipt(&self) -> &SampleReceiptV1 {
        &self.receipt
    }
}

/// Canonical bytes and CAS expectations sufficient for the PostgreSQL owner transaction.
pub(crate) struct PreparedSampleCommitV1 {
    fact: SampleFactV1,
    receipt: SampleReceiptV1,
    timeframe_projection_digest: Identity,
    timeframe_projection_bytes: [u8; TIMEFRAME_PROJECTION_LEN],
    expected_series_head: Option<Identity>,
    expected_slot_head: Option<Identity>,
    series_sequence: u64,
    correction_sequence: u64,
    logical_time: u64,
    lineage_version: u64,
}

impl PreparedSampleCommitV1 {
    pub(crate) const fn fact(&self) -> &SampleFactV1 {
        &self.fact
    }
    pub(crate) const fn receipt(&self) -> &SampleReceiptV1 {
        &self.receipt
    }
    pub(crate) const fn expected_series_head(&self) -> Option<Identity> {
        self.expected_series_head
    }
    pub(crate) const fn expected_slot_head(&self) -> Option<Identity> {
        self.expected_slot_head
    }
    pub(crate) const fn next_series_head(&self) -> Identity {
        self.fact.sample_identity
    }
    pub(crate) const fn next_slot_head(&self) -> Identity {
        self.fact.sample_identity
    }
    pub(crate) const fn sample_identity(&self) -> Identity {
        self.fact.sample_identity
    }
    pub(crate) const fn fact_digest(&self) -> Identity {
        self.fact.fact_digest
    }
    pub(crate) const fn series_identity(&self) -> Identity {
        self.fact.series_identity
    }
    pub(crate) fn series_predecessor(&self) -> Option<Identity> {
        if self.fact.series_predecessor == [0; 32] {
            None
        } else {
            Some(self.fact.series_predecessor)
        }
    }
    pub(crate) const fn series_sequence(&self) -> u64 {
        self.series_sequence
    }
    pub(crate) const fn correction_slot_identity(&self) -> Identity {
        self.fact.slot_identity
    }
    pub(crate) const fn correction_predecessor(&self) -> Option<Identity> {
        self.fact.correction_predecessor
    }
    pub(crate) const fn correction_sequence(&self) -> u64 {
        self.correction_sequence
    }
    pub(crate) const fn logical_time(&self) -> u64 {
        self.logical_time
    }
    pub(crate) const fn lineage_version(&self) -> u64 {
        self.lineage_version
    }
    pub(crate) const fn timeframe_projection_receipt_digest(&self) -> Identity {
        self.timeframe_projection_digest
    }
    pub(crate) fn timeframe_projection_binding_receipt_digest(&self) -> Identity {
        let mut identity = [0_u8; 32];
        identity.copy_from_slice(&self.timeframe_projection_bytes[4..36]);
        identity
    }
    pub(crate) const fn timeframe_projection_receipt_bytes(
        &self,
    ) -> &[u8; TIMEFRAME_PROJECTION_LEN] {
        &self.timeframe_projection_bytes
    }
    pub(crate) fn fact_canonical_bytes(&self) -> &[u8] {
        self.fact.canonical_bytes()
    }
    pub(crate) const fn sample_receipt_digest(&self) -> Identity {
        self.receipt.digest
    }
    pub(crate) const fn sample_receipt_canonical_bytes(&self) -> &[u8; SAMPLE_RECEIPT_LEN] {
        &self.receipt.bytes
    }
    pub(crate) const fn outbox_identity(&self) -> Identity {
        self.fact.sample_identity
    }
    pub(crate) const fn outbox_payload_digest(&self) -> Identity {
        self.receipt.digest
    }
    pub(crate) const fn outbox_canonical_payload_bytes(&self) -> &[u8; SAMPLE_RECEIPT_LEN] {
        &self.receipt.bytes
    }
}

pub(crate) fn prepare_point_event_timeframe_projection_v1(
    binding: &StrategyInputBindingReceipt,
) -> TimeframeProjectionReceiptV1 {
    TimeframeProjectionReceiptV1::point_event(binding)
}

/// Mints one BAR timeframe projection only from the exact selected row and native Instrument
/// Master evidence. The binding's free-form timeframe remains provenance and is never parsed.
pub(crate) fn prepare_bar_timeframe_projection_v1(
    binding: &StrategyInputBindingReceipt,
    batch: &VerifiedPitObservationBatch,
    instrument_master: &InstrumentMasterReadbackV1,
    proposal: UntrustedBarTimeframeProposalV1,
) -> Result<TimeframeProjectionReceiptV1, SampleFactUnavailable> {
    let projection = project_sample_fact_v1(binding, batch)?;
    let row = projection.row;
    if row.data_kind() != "BAR" {
        return Err(SampleFactUnavailable::UnsupportedDataKind);
    }

    let [fact] = instrument_master.facts() else {
        return Err(SampleFactUnavailable::AmbiguousInstrumentMaster);
    };
    validate_instrument_master_timeframe_evidence(
        binding,
        batch,
        row,
        fact,
        instrument_master,
    )?;

    let class_tag = fact.instrument_class() as u16;
    let anchor = timeframe_anchor_identity(
        binding,
        batch,
        row,
        projection.canonical_row_digest,
        fact,
        class_tag,
    )?;
    let calendar = instrument_master_field_identity(
        TIMEFRAME_CALENDAR_DOMAIN,
        fact,
        class_tag,
        fact.calendar_identity(),
    )?;
    let session = instrument_master_field_identity(
        TIMEFRAME_SESSION_DOMAIN,
        fact,
        class_tag,
        fact.session_identity(),
    )?;
    let time_zone = instrument_master_field_identity(
        TIMEFRAME_TIME_ZONE_DOMAIN,
        fact,
        class_tag,
        fact.time_zone_identity(),
    )?;

    let (kind, step, unit, label, partial) = match proposal {
        UntrustedBarTimeframeProposalV1::FixedInterval(proposal) => (
            TimeframeKind::FixedIntervalBar,
            proposal.step,
            match proposal.unit {
                BarTimeframeUnitV1::Second => TimeframeUnit::Second,
                BarTimeframeUnitV1::Minute => TimeframeUnit::Minute,
                BarTimeframeUnitV1::Hour => TimeframeUnit::Hour,
            },
            label_rule(proposal.label),
            admitted_partial_rule(proposal.partial)?,
        ),
        UntrustedBarTimeframeProposalV1::ExchangeSession(proposal) => (
            TimeframeKind::ExchangeSessionBar,
            1,
            TimeframeUnit::ExchangeSessionDay,
            label_rule(proposal.label),
            admitted_partial_rule(proposal.partial)?,
        ),
    };
    let spec = TimeframeSpecV1::bar(
        kind, step, unit, anchor, calendar, session, time_zone, label, partial,
    )?;
    Ok(TimeframeProjectionReceiptV1::from_spec(binding, spec))
}

pub(crate) fn verify_stored_timeframe_projection_v1(
    bytes: &[u8],
    expected_digest: Identity,
) -> Result<TimeframeProjectionReceiptV1, SampleFactUnavailable> {
    TimeframeProjectionReceiptV1::decode(bytes, expected_digest)
}

pub(crate) fn prepare_sample_commit_v1(
    binding: &StrategyInputBindingReceipt,
    batch: &VerifiedPitObservationBatch,
    timeframe: &TimeframeProjectionReceiptV1,
    heads: SampleFactHeadsV1<'_>,
) -> Result<PreparedSampleCommitV1, SampleFactUnavailable> {
    if timeframe.binding_receipt_digest != *binding.digest().as_bytes() {
        return Err(SampleFactUnavailable::ReceiptMismatch);
    }
    let projection = project_sample_fact_v1(binding, batch)?;
    let row = projection.row;
    let data_kind = data_kind_tag(row.data_kind())?;
    let compatible = if timeframe.is_bar() {
        data_kind == 0x01
    } else if timeframe.is_point_event() {
        data_kind != 0x01
    } else {
        false
    };
    if !compatible {
        return Err(SampleFactUnavailable::UnsupportedDataKind);
    }
    let channel = channel_tag(row.channel())?;
    let locator = projection.binding.locator();
    let series_bytes = series_projection_bytes(
        row.instrument().as_bytes(),
        channel,
        data_kind,
        locator.field_semantic_identity().as_bytes(),
        timeframe.timeframe_identity,
        STRATEGY_INPUT_FIXED_I128_LE_V1.as_bytes(),
        locator.unit().as_bytes(),
        row.value_scale(),
        batch.source_binding_lineage_root(),
        row.correction_stream_identity().as_bytes(),
        row.market_semantics_identity(),
    )?;
    let series_identity = sha256(SERIES_ID_DOMAIN, &series_bytes);
    nonzero(series_identity)?;

    let series_predecessor = heads
        .series
        .map_or([0; 32], |head| head.fact.sample_identity);
    if let Some(head) = heads.series
        && head.fact.series_identity != series_identity
    {
        return Err(SampleFactUnavailable::PredecessorMismatch);
    }

    let root_slot = derive_slot_identity(
        series_identity,
        row.event_effective(),
        *batch.fact_digest().as_bytes(),
    );
    let (slot_identity, correction_predecessor) = match heads.slot {
        None => (root_slot, None),
        Some(head) => {
            if head.fact.series_identity != series_identity {
                return Err(SampleFactUnavailable::PredecessorMismatch);
            }
            (head.fact.slot_identity, Some(head.fact.sample_identity))
        }
    };

    if heads.slot.is_some() && heads.series.is_none() {
        return Err(SampleFactUnavailable::PredecessorMismatch);
    }

    let logical_time = row.provider_available().max(row.correction_publication());
    let owner_sequence = row.correction_sequence();
    if owner_sequence == 0 {
        return Err(SampleFactUnavailable::ZeroIdentity);
    }
    let owner_event_identity = event_identity(
        batch,
        row,
        projection.canonical_row_digest,
        logical_time,
        owner_sequence,
    )?;

    let mut bytes = Vec::new();
    put_u16(&mut bytes, 1);
    put_u16(&mut bytes, 0);
    bytes.extend_from_slice(&series_identity);
    bytes.extend_from_slice(&slot_identity);
    bytes.extend_from_slice(&series_predecessor);
    put_optional_identity(&mut bytes, correction_predecessor);
    bytes.extend_from_slice(batch.snapshot_identity().as_bytes());
    bytes.extend_from_slice(batch.fact_digest().as_bytes());
    bytes.extend_from_slice(batch.digest().as_bytes());
    put_var(&mut bytes, row.instrument().as_bytes())?;
    bytes.push(channel);
    bytes.push(data_kind);
    put_var(&mut bytes, locator.field_semantic_identity().as_bytes())?;
    bytes.extend_from_slice(&timeframe.timeframe_identity);
    bytes.extend_from_slice(&owner_event_identity);
    put_u64(&mut bytes, logical_time);
    put_u64(&mut bytes, row.event_effective());
    put_u64(&mut bytes, row.provider_available());
    put_u64(&mut bytes, row.retrieval());
    put_u64(&mut bytes, row.correction_publication());
    put_u64(&mut bytes, owner_sequence);
    put_var(&mut bytes, STRATEGY_INPUT_FIXED_I128_LE_V1.as_bytes())?;
    put_var(&mut bytes, &row.value_mantissa().to_le_bytes())?;
    bytes.push(row.value_scale());
    bytes.extend_from_slice(projection.canonical_row_digest.as_bytes());
    bytes.extend_from_slice(row.source_binding_identity().as_bytes());
    bytes.extend_from_slice(batch.source_binding_lineage_root().as_bytes());
    put_u64(&mut bytes, batch.source_binding_lineage_version());
    bytes.extend_from_slice(row.source_frontier_digest().as_bytes());
    put_var(&mut bytes, row.correction_stream_identity().as_bytes())?;
    bytes.extend_from_slice(row.correction_frontier_digest().as_bytes());
    bytes.extend_from_slice(row.instrument_master_digest().as_bytes());
    bytes.extend_from_slice(row.universe_selection_digest().as_bytes());
    bytes.extend_from_slice(row.market_semantics_identity().as_bytes());

    let fact_digest = sha256(FACT_DIGEST_DOMAIN, &bytes);
    let sample_identity = sha256(SAMPLE_ID_DOMAIN, &fact_digest);
    nonzero(fact_digest)?;
    nonzero(sample_identity)?;
    let fact = SampleFactV1 {
        bytes: bytes.into_boxed_slice(),
        series_identity,
        slot_identity,
        series_predecessor,
        correction_predecessor,
        snapshot_identity: *batch.snapshot_identity().as_bytes(),
        snapshot_fact_digest: *batch.fact_digest().as_bytes(),
        observation_batch_digest: *batch.digest().as_bytes(),
        timeframe_identity: timeframe.timeframe_identity,
        owner_event_identity,
        fact_digest,
        sample_identity,
        canonical_row_digest: *projection.canonical_row_digest.as_bytes(),
    };
    let receipt = receipt_from_fact(
        &fact,
        logical_time,
        row.event_effective(),
        owner_sequence,
        *batch.source_binding_lineage_root().as_bytes(),
        batch.source_binding_lineage_version(),
        *row.market_semantics_identity().as_bytes(),
    );
    Ok(PreparedSampleCommitV1 {
        fact,
        receipt,
        timeframe_projection_digest: timeframe.digest,
        timeframe_projection_bytes: timeframe.bytes,
        expected_series_head: heads.series.map(|head| head.fact.sample_identity),
        expected_slot_head: heads.slot.map(|head| head.fact.sample_identity),
        series_sequence: owner_sequence,
        correction_sequence: owner_sequence,
        logical_time,
        lineage_version: batch.source_binding_lineage_version(),
    })
}

pub(crate) fn verify_stored_sample_readback_v1(
    fact_bytes: &[u8],
    expected_fact_digest: Identity,
    receipt_bytes: &[u8],
    expected_receipt_digest: Identity,
) -> Result<StoredSampleReadbackV1, SampleFactUnavailable> {
    let fact = decode_fact(fact_bytes, expected_fact_digest)?;
    let receipt = decode_receipt(receipt_bytes, expected_receipt_digest)?;
    if receipt.fact_digest != fact.fact_digest || receipt.sample_identity != fact.sample_identity {
        return Err(SampleFactUnavailable::ReceiptMismatch);
    }
    let projection = decode_fact_receipt_projection(fact_bytes)?;
    let expected = receipt_from_fact(
        &fact,
        projection.logical_time,
        projection.event_effective,
        projection.owner_sequence,
        projection.lineage_root,
        projection.lineage_version,
        projection.market_semantics_identity,
    );

    if expected.bytes != receipt.bytes {
        return Err(SampleFactUnavailable::ReceiptMismatch);
    }
    Ok(StoredSampleReadbackV1 { fact, receipt })
}

fn validate_instrument_master_timeframe_evidence(
    binding: &StrategyInputBindingReceipt,
    batch: &VerifiedPitObservationBatch,
    row: &crate::owner::pit_snapshot::VerifiedPitObservation,
    fact: &InstrumentMasterFactV1,
    readback: &InstrumentMasterReadbackV1,
) -> Result<(), SampleFactUnavailable> {
    let locator = binding.locator();
    let expected_members = readback.cut().expected_members();
    if expected_members.len() != 1
        || expected_members[0] != row.instrument()
        || fact.canonical_identity() != row.instrument()
        || locator.instrument() != row.instrument()
        || readback.digest() != batch.instrument_master_digest()
        || row.instrument_master_digest() != batch.instrument_master_digest()
        || fact.market_semantics_identity() != row.market_semantics_identity()
        || fact.market_semantics_identity() != batch.market_semantics_identity()
        || fact.market_semantics_identity() != locator.market_semantics_identity()
        || fact.correction_frontier() != row.correction_frontier_digest()
        || fact.correction_frontier() != batch.correction_frontier_digest()
    {
        return Err(SampleFactUnavailable::InstrumentMasterMismatch);
    }
    if fact.calendar_identity().is_empty()
        || fact.session_identity().is_empty()
        || fact.time_zone_identity().is_empty()
    {
        return Err(SampleFactUnavailable::UnsupportedTimeframe);
    }
    Ok(())
}

#[allow(
    clippy::too_many_arguments,
    reason = "the anchor cross-binds every exact selected Owner evidence coordinate"
)]
fn timeframe_anchor_identity(
    binding: &StrategyInputBindingReceipt,
    batch: &VerifiedPitObservationBatch,
    row: &crate::owner::pit_snapshot::VerifiedPitObservation,
    canonical_row_digest: BindingDigest,
    fact: &InstrumentMasterFactV1,
    class_tag: u16,
) -> Result<Identity, SampleFactUnavailable> {
    let mut bytes = Vec::new();
    put_u16(&mut bytes, 1);
    put_u16(&mut bytes, class_tag);
    bytes.extend_from_slice(binding.digest().as_bytes());
    bytes.extend_from_slice(batch.digest().as_bytes());
    bytes.extend_from_slice(canonical_row_digest.as_bytes());
    bytes.extend_from_slice(row.source_binding_identity().as_bytes());
    bytes.extend_from_slice(batch.source_binding_lineage_root().as_bytes());
    put_u64(&mut bytes, batch.source_binding_lineage_version());
    bytes.extend_from_slice(fact.digest().as_bytes());
    put_var(&mut bytes, row.instrument().as_bytes())?;
    let identity = sha256(TIMEFRAME_ANCHOR_DOMAIN, &bytes);
    nonzero(identity)?;
    Ok(identity)
}

fn instrument_master_field_identity(
    domain: &[u8],
    fact: &InstrumentMasterFactV1,
    class_tag: u16,
    field: &str,
) -> Result<Identity, SampleFactUnavailable> {
    if field.is_empty() {
        return Err(SampleFactUnavailable::UnsupportedTimeframe);
    }
    let mut bytes = Vec::new();
    put_u16(&mut bytes, 1);
    put_u16(&mut bytes, class_tag);
    bytes.extend_from_slice(fact.digest().as_bytes());
    put_var(&mut bytes, field.as_bytes())?;
    let identity = sha256(domain, &bytes);
    nonzero(identity)?;
    Ok(identity)
}

const fn label_rule(proposal: BarLabelRuleV1) -> LabelRule {
    match proposal {
        BarLabelRuleV1::IntervalOpen => LabelRule::IntervalOpen,
        BarLabelRuleV1::IntervalClose => LabelRule::IntervalClose,
    }
}

fn admitted_partial_rule(
    proposal: BarPartialRuleV1,
) -> Result<PartialBarRule, SampleFactUnavailable> {
    match proposal {
        BarPartialRuleV1::CompleteOnly => Ok(PartialBarRule::CompleteOnly),
        BarPartialRuleV1::AdmitPartialAsDistinctSlot => {
            Err(SampleFactUnavailable::UnsupportedTimeframe)
        }
    }
}

#[allow(
    clippy::too_many_arguments,
    reason = "the documented fixed-width timeframe tuple is validated without a second representation"
)]
fn validate_timeframe_combination(
    kind: u8,
    step: u32,
    unit: u8,
    anchor: Identity,
    calendar: Identity,
    session: Identity,
    time_zone: Identity,
    label: u8,
    partial: u8,
) -> Result<(), SampleFactUnavailable> {
    let zero = [0; 32];
    let valid = match kind {
        x if x == TimeframeKind::PointEvent as u8 => {
            step == 1
                && unit == TimeframeUnit::NotApplicable as u8
                && [anchor, calendar, session, time_zone]
                    .iter()
                    .all(|v| *v == zero)
                && label == LabelRule::EventEffective as u8
                && partial == PartialBarRule::NotApplicable as u8
        }
        x if x == TimeframeKind::FixedIntervalBar as u8 => {
            step > 0
                && matches!(unit, 0x01..=0x03)
                && anchor != zero
                && time_zone != zero
                && ((calendar == zero && session == zero) || (calendar != zero && session != zero))
                && matches!(label, 0x01 | 0x02)
                && matches!(partial, 0x01 | 0x02)
        }
        x if x == TimeframeKind::ExchangeSessionBar as u8 => {
            step == 1
                && unit == TimeframeUnit::ExchangeSessionDay as u8
                && [anchor, calendar, session, time_zone]
                    .iter()
                    .all(|v| *v != zero)
                && matches!(label, 0x01 | 0x02)
                && matches!(partial, 0x01 | 0x02)
        }
        _ => return Err(SampleFactUnavailable::InvalidTag),
    };

    if valid {
        Ok(())
    } else {
        Err(SampleFactUnavailable::InvalidCombination)
    }
}

fn channel_tag(value: &str) -> Result<u8, SampleFactUnavailable> {
    match value {
        "MARKET" => Ok(0x01),
        "REFERENCE" => Ok(0x02),
        "ECONOMIC" => Ok(0x03),
        _ => Err(SampleFactUnavailable::InvalidTag),
    }
}

fn data_kind_tag(value: &str) -> Result<u8, SampleFactUnavailable> {
    match value {
        "BAR" => Ok(0x01),
        "QUOTE" => Ok(0x02),
        "TRADE" => Ok(0x03),
        "SCALAR" => Ok(0x04),
        _ => Err(SampleFactUnavailable::InvalidTag),
    }
}

#[allow(
    clippy::too_many_arguments,
    reason = "the documented ordered series projection is encoded directly without an alternate authority type"
)]
fn series_projection_bytes(
    instrument: &[u8],
    channel: u8,
    data_kind: u8,
    field_semantic: &[u8],
    timeframe_identity: Identity,
    value_semantic: &[u8],
    unit: &[u8],
    scale: u8,
    lineage_root: BindingDigest,
    correction_stream: &[u8],
    market_semantics: BindingDigest,
) -> Result<Vec<u8>, SampleFactUnavailable> {
    let mut bytes = Vec::new();
    put_u16(&mut bytes, 1);
    put_u16(&mut bytes, 0);
    put_var(&mut bytes, instrument)?;
    bytes.push(channel);
    bytes.push(data_kind);
    put_var(&mut bytes, field_semantic)?;
    bytes.extend_from_slice(&timeframe_identity);
    put_var(&mut bytes, value_semantic)?;
    put_var(&mut bytes, unit)?;
    bytes.push(scale);
    bytes.extend_from_slice(lineage_root.as_bytes());
    put_var(&mut bytes, correction_stream)?;
    bytes.extend_from_slice(market_semantics.as_bytes());
    Ok(bytes)
}

fn derive_slot_identity(
    series: Identity,
    event_effective: u64,
    snapshot_fact: Identity,
) -> Identity {
    let mut bytes = Vec::with_capacity(72);
    bytes.extend_from_slice(&series);
    put_u64(&mut bytes, event_effective);
    bytes.extend_from_slice(&snapshot_fact);
    sha256(SLOT_ID_DOMAIN, &bytes)
}

fn event_identity(
    batch: &VerifiedPitObservationBatch,
    row: &crate::owner::pit_snapshot::VerifiedPitObservation,
    canonical_row_digest: BindingDigest,
    logical_time: u64,
    owner_sequence: u64,
) -> Result<[u8; 16], SampleFactUnavailable> {
    let mut bytes = Vec::new();
    put_u16(&mut bytes, 1);
    put_u16(&mut bytes, 0);
    bytes.extend_from_slice(batch.snapshot_identity().as_bytes());
    bytes.extend_from_slice(batch.fact_digest().as_bytes());
    bytes.extend_from_slice(batch.digest().as_bytes());
    bytes.extend_from_slice(canonical_row_digest.as_bytes());
    put_u64(&mut bytes, logical_time);
    put_u64(&mut bytes, row.event_effective());
    put_u64(&mut bytes, row.provider_available());
    put_u64(&mut bytes, row.retrieval());
    put_u64(&mut bytes, row.correction_publication());
    put_u64(&mut bytes, owner_sequence);
    put_var(&mut bytes, row.correction_stream_identity().as_bytes())?;
    bytes.extend_from_slice(row.correction_frontier_digest().as_bytes());
    let digest = sha256(EVENT_ID_DOMAIN, &bytes);
    let mut identity = [0; 16];
    identity.copy_from_slice(&digest[..16]);
    if identity == [0; 16] {
        return Err(SampleFactUnavailable::ZeroIdentity);
    }
    Ok(identity)
}

fn receipt_from_fact(
    fact: &SampleFactV1,
    logical_time: u64,
    event_effective: u64,
    owner_sequence: u64,
    lineage_root: Identity,
    lineage_version: u64,
    market_semantics: Identity,
) -> SampleReceiptV1 {
    let mut bytes = Vec::with_capacity(SAMPLE_RECEIPT_LEN);
    put_u16(&mut bytes, 1);
    put_u16(&mut bytes, 0);
    bytes.extend_from_slice(&fact.sample_identity);
    bytes.extend_from_slice(&fact.fact_digest);
    bytes.extend_from_slice(&fact.timeframe_identity);
    bytes.extend_from_slice(&fact.owner_event_identity);
    put_u64(&mut bytes, logical_time);
    put_u64(&mut bytes, event_effective);
    put_u64(&mut bytes, owner_sequence);
    bytes.extend_from_slice(&fact.canonical_row_digest);
    bytes.extend_from_slice(&lineage_root);
    put_u64(&mut bytes, lineage_version);
    bytes.extend_from_slice(&market_semantics);
    let bytes: [u8; SAMPLE_RECEIPT_LEN] = bytes.try_into().expect("fixed sample receipt width");
    SampleReceiptV1 {
        digest: sha256(RECEIPT_DOMAIN, &bytes),
        bytes,
        sample_identity: fact.sample_identity,
        fact_digest: fact.fact_digest,
        timeframe_identity: fact.timeframe_identity,
        owner_event_identity: fact.owner_event_identity,
        logical_time,
        event_effective,
        owner_sequence,
        canonical_row_digest: fact.canonical_row_digest,
        source_binding_lineage_root: lineage_root,
        source_binding_lineage_version: lineage_version,
        market_semantics_identity: market_semantics,
    }
}

fn decode_fact(
    bytes: &[u8],
    expected_digest: Identity,
) -> Result<SampleFactV1, SampleFactUnavailable> {
    if sha256(FACT_DIGEST_DOMAIN, bytes) != expected_digest {
        return Err(SampleFactUnavailable::DigestMismatch);
    }
    let mut d = Decoder::new(bytes);
    d.schema(1)?;
    let series_identity = d.identity()?;
    let slot_identity = d.identity()?;
    let series_predecessor = d.identity()?;
    let correction_predecessor = d.optional_identity()?;
    let snapshot_identity = d.identity()?;
    let snapshot_fact = d.identity()?;
    let batch_digest = d.identity()?;
    let instrument = d.var()?;
    if instrument.is_empty() {
        return Err(SampleFactUnavailable::EmptyValue);
    }
    let channel = d.u8()?;
    if !matches!(channel, 0x01..=0x03) {
        return Err(SampleFactUnavailable::InvalidTag);
    }
    let data_kind = d.u8()?;
    if !matches!(data_kind, 0x01..=0x04) {
        return Err(SampleFactUnavailable::InvalidTag);
    }
    let field = d.var()?;
    let timeframe_identity = d.identity()?;
    let owner_event_identity = d.identity16()?;
    let logical_time = d.u64()?;
    let event_effective = d.u64()?;
    let provider_available = d.u64()?;
    let retrieval = d.u64()?;
    let correction_publication = d.u64()?;
    let owner_sequence = d.u64()?;
    let value_semantic = d.var()?;
    let value = d.var()?;
    if value.len() != 16 {
        return Err(SampleFactUnavailable::InvalidLength);
    }
    let scale = d.u8()?;
    let canonical_row_digest = d.identity()?;
    let source_binding_identity = d.identity()?;
    let lineage_root = d.identity()?;
    let lineage_version = d.u64()?;
    let source_frontier = d.identity()?;
    let correction_stream = d.var()?;
    let correction_frontier = d.identity()?;
    let instrument_master = d.identity()?;
    let universe = d.identity()?;
    let market_semantics = d.identity()?;
    d.end()?;

    for identity in [
        series_identity,
        slot_identity,
        snapshot_identity,
        snapshot_fact,
        batch_digest,
        timeframe_identity,
        canonical_row_digest,
        source_binding_identity,
        lineage_root,
        source_frontier,
        correction_frontier,
        instrument_master,
        universe,
        market_semantics,
    ] {
        nonzero(identity)?;
    }
    let (expected_data_kind, unit) = field_semantic_registry(field)?;
    if data_kind != expected_data_kind
        || owner_event_identity == [0; 16]
        || owner_sequence == 0
        || lineage_version == 0
        || field.is_empty()
        || value_semantic != STRATEGY_INPUT_FIXED_I128_LE_V1.as_bytes()
        || correction_stream.is_empty()
    {
        return Err(SampleFactUnavailable::InvalidCombination);
    }

    if let Some(predecessor) = correction_predecessor {
        nonzero(predecessor)?;

        if series_predecessor == [0; 32] {
            return Err(SampleFactUnavailable::PredecessorMismatch);
        }
    } else if slot_identity != derive_slot_identity(series_identity, event_effective, snapshot_fact)
    {
        return Err(SampleFactUnavailable::IdentityMismatch);
    }
    let series_bytes = series_projection_bytes(
        instrument,
        channel,
        data_kind,
        field,
        timeframe_identity,
        value_semantic,
        unit,
        scale,
        BindingDigest::from_untrusted_bytes(lineage_root),
        correction_stream,
        BindingDigest::from_untrusted_bytes(market_semantics),
    )?;

    if sha256(SERIES_ID_DOMAIN, &series_bytes) != series_identity {
        return Err(SampleFactUnavailable::IdentityMismatch);
    }
    let expected_event = {
        let mut preimage = Vec::new();
        put_u16(&mut preimage, 1);
        put_u16(&mut preimage, 0);
        preimage.extend_from_slice(&snapshot_identity);
        preimage.extend_from_slice(&snapshot_fact);
        preimage.extend_from_slice(&batch_digest);
        preimage.extend_from_slice(&canonical_row_digest);

        for value in [
            logical_time,
            event_effective,
            provider_available,
            retrieval,
            correction_publication,
            owner_sequence,
        ] {
            put_u64(&mut preimage, value);
        }
        put_var(&mut preimage, correction_stream)?;
        preimage.extend_from_slice(&correction_frontier);
        let digest = sha256(EVENT_ID_DOMAIN, &preimage);
        let mut id = [0; 16];
        id.copy_from_slice(&digest[..16]);
        id
    };

    if expected_event != owner_event_identity {
        return Err(SampleFactUnavailable::IdentityMismatch);
    }
    let sample_identity = sha256(SAMPLE_ID_DOMAIN, &expected_digest);
    nonzero(sample_identity)?;
    Ok(SampleFactV1 {
        bytes: bytes.to_vec().into_boxed_slice(),
        series_identity,
        slot_identity,
        series_predecessor,
        correction_predecessor,
        snapshot_identity,
        snapshot_fact_digest: snapshot_fact,
        observation_batch_digest: batch_digest,
        timeframe_identity,
        owner_event_identity,
        fact_digest: expected_digest,
        sample_identity,
        canonical_row_digest,
    })
}

fn field_semantic_registry(field: &[u8]) -> Result<(u8, &'static [u8]), SampleFactUnavailable> {
    match field {
        b"MARKET_DATA.BAR.OPEN.PRICE.V1"
        | b"MARKET_DATA.BAR.HIGH.PRICE.V1"
        | b"MARKET_DATA.BAR.LOW.PRICE.V1"
        | b"MARKET_DATA.BAR.CLOSE.PRICE.V1" => Ok((0x01, b"PRICE")),
        b"MARKET_DATA.BAR.VOLUME.QUANTITY.V1" => Ok((0x01, b"QUANTITY")),
        b"MARKET_DATA.QUOTE.BID.PRICE.V1" | b"MARKET_DATA.QUOTE.ASK.PRICE.V1" => {
            Ok((0x02, b"PRICE"))
        }
        b"MARKET_DATA.QUOTE.BID.SIZE.V1" | b"MARKET_DATA.QUOTE.ASK.SIZE.V1" => {
            Ok((0x02, b"QUANTITY"))
        }
        b"MARKET_DATA.TRADE.LAST.PRICE.V1" => Ok((0x03, b"PRICE")),
        b"MARKET_DATA.TRADE.LAST.SIZE.V1" => Ok((0x03, b"QUANTITY")),
        b"MARKET_DATA.SCALAR.VALUE.V1" => Ok((0x04, b"SCALAR")),
        _ => Err(SampleFactUnavailable::InvalidTag),
    }
}

struct FactReceiptProjection {
    logical_time: u64,
    event_effective: u64,
    owner_sequence: u64,
    lineage_root: Identity,
    lineage_version: u64,
    market_semantics_identity: Identity,
}

fn decode_fact_receipt_projection(
    bytes: &[u8],
) -> Result<FactReceiptProjection, SampleFactUnavailable> {
    let mut d = Decoder::new(bytes);
    d.schema(1)?;
    d.take(32 * 3)?;
    let _ = d.optional_identity()?;
    d.take(32 * 3)?;
    d.var()?;
    d.take(2)?;
    d.var()?;
    d.take(32 + 16)?;
    let logical_time = d.u64()?;
    let event_effective = d.u64()?;
    d.take(8 * 3)?;
    let owner_sequence = d.u64()?;
    d.var()?;
    d.var()?;
    d.take(1 + 32 + 32)?;
    let lineage_root = d.identity()?;
    let lineage_version = d.u64()?;
    d.take(32)?;
    d.var()?;
    d.take(32 * 3)?;
    let market_semantics_identity = d.identity()?;
    d.end()?;
    Ok(FactReceiptProjection {
        logical_time,
        event_effective,
        owner_sequence,
        lineage_root,
        lineage_version,
        market_semantics_identity,
    })
}

fn decode_receipt(
    bytes: &[u8],
    expected_digest: Identity,
) -> Result<SampleReceiptV1, SampleFactUnavailable> {
    if bytes.len() != SAMPLE_RECEIPT_LEN {
        return Err(SampleFactUnavailable::InvalidLength);
    }

    if sha256(RECEIPT_DOMAIN, bytes) != expected_digest {
        return Err(SampleFactUnavailable::DigestMismatch);
    }
    let mut d = Decoder::new(bytes);
    d.schema(1)?;
    let sample_identity = d.identity()?;
    let fact_digest = d.identity()?;
    let timeframe_identity = d.identity()?;
    let owner_event_identity = d.identity16()?;
    let logical_time = d.u64()?;
    let event_effective = d.u64()?;
    let owner_sequence = d.u64()?;
    let canonical_row_digest = d.identity()?;
    let source_binding_lineage_root = d.identity()?;
    let source_binding_lineage_version = d.u64()?;
    let market_semantics_identity = d.identity()?;
    d.end()?;

    for identity in [
        sample_identity,
        fact_digest,
        timeframe_identity,
        canonical_row_digest,
        source_binding_lineage_root,
        market_semantics_identity,
    ] {
        nonzero(identity)?;
    }

    if owner_event_identity == [0; 16] || owner_sequence == 0 || source_binding_lineage_version == 0
    {
        return Err(SampleFactUnavailable::InvalidCombination);
    }
    let bytes: [u8; SAMPLE_RECEIPT_LEN] = bytes
        .try_into()
        .map_err(|_| SampleFactUnavailable::InvalidLength)?;
    Ok(SampleReceiptV1 {
        bytes,
        digest: expected_digest,
        sample_identity,
        fact_digest,
        timeframe_identity,
        owner_event_identity,
        logical_time,
        event_effective,
        owner_sequence,
        canonical_row_digest,
        source_binding_lineage_root,
        source_binding_lineage_version,
        market_semantics_identity,
    })
}

fn sha256(domain: &[u8], bytes: &[u8]) -> Identity {
    let mut hasher = Sha256::new();
    hasher.update(domain);
    hasher.update(bytes);
    hasher.finalize().into()
}

fn nonzero(identity: Identity) -> Result<(), SampleFactUnavailable> {
    if identity == [0; 32] {
        Err(SampleFactUnavailable::ZeroIdentity)
    } else {
        Ok(())
    }
}

fn put_u16(bytes: &mut Vec<u8>, value: u16) {
    bytes.extend_from_slice(&value.to_le_bytes());
}
fn put_u32(bytes: &mut Vec<u8>, value: u32) {
    bytes.extend_from_slice(&value.to_le_bytes());
}
fn put_u64(bytes: &mut Vec<u8>, value: u64) {
    bytes.extend_from_slice(&value.to_le_bytes());
}
fn put_var(bytes: &mut Vec<u8>, value: &[u8]) -> Result<(), SampleFactUnavailable> {
    if value.is_empty() {
        return Err(SampleFactUnavailable::EmptyValue);
    }
    let len = u16::try_from(value.len()).map_err(|_| SampleFactUnavailable::OversizedValue)?;
    put_u16(bytes, len);
    bytes.extend_from_slice(value);
    Ok(())
}
fn put_optional_identity(bytes: &mut Vec<u8>, value: Option<Identity>) {
    match value {
        None => bytes.push(0),
        Some(value) => {
            bytes.push(1);
            bytes.extend_from_slice(&value);
        }
    }
}

struct Decoder<'a> {
    bytes: &'a [u8],
    offset: usize,
}
impl<'a> Decoder<'a> {
    const fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, offset: 0 }
    }
    fn take(&mut self, len: usize) -> Result<&'a [u8], SampleFactUnavailable> {
        let end = self
            .offset
            .checked_add(len)
            .ok_or(SampleFactUnavailable::InvalidLength)?;
        let value = self
            .bytes
            .get(self.offset..end)
            .ok_or(SampleFactUnavailable::InvalidLength)?;
        self.offset = end;
        Ok(value)
    }
    fn schema(&mut self, expected: u16) -> Result<(), SampleFactUnavailable> {
        if self.u16()? != expected {
            return Err(SampleFactUnavailable::InvalidTag);
        }

        if self.u16()? != 0 {
            return Err(SampleFactUnavailable::ReservedNonZero);
        }
        Ok(())
    }
    fn u8(&mut self) -> Result<u8, SampleFactUnavailable> {
        Ok(self.take(1)?[0])
    }
    fn u16(&mut self) -> Result<u16, SampleFactUnavailable> {
        Ok(u16::from_le_bytes(self.take(2)?.try_into().expect("width")))
    }
    fn u32(&mut self) -> Result<u32, SampleFactUnavailable> {
        Ok(u32::from_le_bytes(self.take(4)?.try_into().expect("width")))
    }
    fn u64(&mut self) -> Result<u64, SampleFactUnavailable> {
        Ok(u64::from_le_bytes(self.take(8)?.try_into().expect("width")))
    }
    fn identity(&mut self) -> Result<Identity, SampleFactUnavailable> {
        Ok(self.take(32)?.try_into().expect("width"))
    }
    fn identity16(&mut self) -> Result<[u8; 16], SampleFactUnavailable> {
        Ok(self.take(16)?.try_into().expect("width"))
    }
    fn optional_identity(&mut self) -> Result<Option<Identity>, SampleFactUnavailable> {
        match self.u8()? {
            0 => Ok(None),
            1 => Ok(Some(self.identity()?)),
            _ => Err(SampleFactUnavailable::InvalidTag),
        }
    }
    fn var(&mut self) -> Result<&'a [u8], SampleFactUnavailable> {
        let len = usize::from(self.u16()?);
        if len == 0 {
            return Err(SampleFactUnavailable::EmptyValue);
        }
        self.take(len)
    }
    fn end(&self) -> Result<(), SampleFactUnavailable> {
        if self.offset == self.bytes.len() {
            Ok(())
        } else {
            Err(SampleFactUnavailable::TrailingBytes)
        }
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::owner::{
        instrument_master::{
            ClockProjection, InstrumentClass, InstrumentDecimal, InstrumentMasterCutV1,
            InstrumentMasterFactProposalV1, InstrumentMasterFactV1, InstrumentMasterReadbackV1,
            InstrumentMasterResolution, InstrumentMasterScopeV1, InstrumentVenueSourceMapping,
        },
        pit_snapshot::{
            UntrustedCorrectionPublicationTime, UntrustedEventEffectiveTime,
            UntrustedPitSnapshotTimeEvidence, UntrustedProviderAvailableTime,
            UntrustedRetrievalTime, UntrustedSnapshotDecisionCut, VerifiedPitObservation,
            VerifiedPitObservationBatch,
        },
        strategy_input_binding::{
            MarketDataFieldSemantic, StrategyInputChannel, StrategyInputEventFrameReceipt,
            StrategyInputUnit, UntrustedStrategyInputBindingRequest, UntrustedStrategyInputScope,
            bind_strategy_input_event_frame, bind_strategy_input_role,
        },
    };
    use rstest::rstest;

    fn d(value: u8) -> BindingDigest {
        BindingDigest::from_untrusted_bytes([value; 32])
    }

    fn row(event_effective: u64, sequence: u64) -> VerifiedPitObservation {
        VerifiedPitObservation {
            symbolic_key: "AAPL.BID".into(),
            member_key: "AAPL.XNAS".into(),
            instrument: "AAPL.XNAS".into(),
            channel: "MARKET".into(),
            data_kind: "QUOTE".into(),
            timeframe: "caller-provenance-only".into(),
            field: "BID_PRICE".into(),
            value_mantissa: 12_345,
            value_scale: 2,
            event_effective,
            provider_available: 20 + sequence,
            retrieval: 40 + sequence,
            correction_publication: 30 + sequence,
            source_binding_identity: d(6),
            source_frontier_digest: d(7),
            instrument_master_digest: d(9),
            universe_selection_digest: d(10),
            market_semantics_identity: d(11),
            correction_stream_identity: "quote-corrections".into(),
            correction_sequence: sequence,
            correction_frontier_digest: d(8 + sequence as u8),
        }
    }

    fn bar_row(event_effective: u64, sequence: u64) -> VerifiedPitObservation {
        let mut row = row(event_effective, sequence);
        row.symbolic_key = "AAPL.CLOSE".into();
        row.data_kind = "BAR".into();
        row.field = "CLOSE".into();
        row.timeframe = "not-a-timeframe-authority".into();
        row.correction_stream_identity = "bar-corrections".into();
        row
    }

    fn batch(row: VerifiedPitObservation, fact: u8) -> VerifiedPitObservationBatch {
        VerifiedPitObservationBatch {
            request_identity: d(1),
            request_digest: d(2),
            snapshot_identity: d(3 + fact),
            fact_digest: d(fact),
            source_binding_identity: d(6),
            source_binding_lineage_root: d(16),
            source_binding_lineage_version: 1,
            source_frontier_digest: d(7),
            correction_frontier_digest: row.correction_frontier_digest(),
            instrument_master_digest: d(9),
            universe_selection_digest: d(10),
            market_semantics_identity: d(11),
            time_evidence: UntrustedPitSnapshotTimeEvidence {
                event_effective: UntrustedEventEffectiveTime::from_untrusted(10, "clock", "epoch"),
                provider_available: UntrustedProviderAvailableTime::from_untrusted(
                    20, "clock", "epoch",
                ),
                retrieval: UntrustedRetrievalTime::from_untrusted(40, "clock", "epoch"),
                correction_publication: Some(UntrustedCorrectionPublicationTime::from_untrusted(
                    30, "clock", "epoch",
                )),
                decision_cut: UntrustedSnapshotDecisionCut::from_untrusted(40, "clock", "epoch"),
                monotonic_sequence: 1,
                restart_continuity_digest: d(19),
                skew_bound: 1,
                uncertainty_bound: 1,
                observed_at: 40,
                valid_through: 50,
            },
            digest: d(5 + fact),
            observations: vec![row].into_boxed_slice(),
        }
    }

    fn request(batch: &VerifiedPitObservationBatch) -> UntrustedStrategyInputBindingRequest {
        UntrustedStrategyInputBindingRequest {
            research_request_identity: d(20),
            strategy_design_identity: d(21),
            input_role_identity: d(22),
            scope: UntrustedStrategyInputScope::ExactInstrument {
                instrument: "AAPL.XNAS".into(),
            },
            field_semantic: MarketDataFieldSemantic::QuoteBidPrice,
            channel: StrategyInputChannel::Market,
            timeframe: "caller-provenance-only".into(),
            unit: StrategyInputUnit::Price,
            scale: 2,
            pit_request_identity: batch.request_identity(),
            pit_request_digest: batch.request_digest(),
            snapshot_identity: batch.snapshot_identity(),
            snapshot_fact_digest: batch.fact_digest(),
            observation_batch_digest: batch.digest(),
            source_binding_identity: batch.source_binding_identity(),
            source_frontier_digest: batch.source_frontier_digest(),
            correction_frontier_digest: batch.correction_frontier_digest(),
            instrument_master_digest: batch.instrument_master_digest(),
            universe_selection_digest: batch.universe_selection_digest(),
            market_semantics_identity: batch.market_semantics_identity(),
            decision_cut: 40,
        }
    }

    fn bar_request(batch: &VerifiedPitObservationBatch) -> UntrustedStrategyInputBindingRequest {
        let mut request = request(batch);
        request.field_semantic = MarketDataFieldSemantic::BarClosePrice;
        request.timeframe = "not-a-timeframe-authority".into();
        request
    }

    fn instrument_master_readback(
        instrument: &str,
        market_semantics: BindingDigest,
        correction_frontier: BindingDigest,
    ) -> InstrumentMasterReadbackV1 {
        let clock = ClockProjection {
            clock_identity: [31; 32],
            clock_epoch: [32; 32],
            monotonic_sequence: 1,
            wall_observed: 40,
            decision_cut: 40,
            head_identity: d(33),
            head_digest: d(34),
            valid_through: 50,
            restart_continuity_digest: d(35),
            uncertainty_bound: 1,
            skew_bound: 1,
            epoch_proof_identity: None,
            epoch_proof_digest: None,
        };
        let fact = InstrumentMasterFactV1 {
            proposal: InstrumentMasterFactProposalV1 {
                canonical_identity: instrument.into(),
                predecessor_fact_digest: None,
                mappings: vec![InstrumentVenueSourceMapping {
                    venue_identity: "XNAS".into(),
                    source_identity: "SIP".into(),
                    source_instrument: b"AAPL".to_vec(),
                }],
                instrument_class: InstrumentClass::Equity,
                base_currency: Some("USD".into()),
                quote_currency: None,
                settlement_currency: Some("USD".into()),
                margin_currency: None,
                price_increment: InstrumentDecimal {
                    mantissa: 1,
                    scale: 2,
                },
                quantity_increment: InstrumentDecimal {
                    mantissa: 1,
                    scale: 0,
                },
                contract_multiplier: InstrumentDecimal {
                    mantissa: 1,
                    scale: 0,
                },
                calendar_identity: "XNYS-CALENDAR-V1".into(),
                session_identity: "XNYS-REGULAR-V1".into(),
                time_zone_identity: "America/New_York".into(),
                lifecycle_frontier: d(36),
                corporate_action_frontier: d(37),
                historical_membership_frontier: d(38),
                market_semantics_identity: market_semantics,
                source_frontier: d(7),
                correction_frontier,
                effective_from: 1,
                effective_until: Some(100),
                provider_available: 20,
                retrieval: 30,
                correction_publication: 31,
                owner_observation: 40,
            },
            clock: clock.clone(),
            canonical_bytes: vec![1],
            identity: d(30),
        };
        let cut = InstrumentMasterCutV1 {
            request_identity: d(40),
            request_meaning_digest: d(41),
            scope: InstrumentMasterScopeV1::ExactInstrument(instrument.into()),
            expected_members: vec![instrument.into()],
            effective_instant: 10,
            owner_observation: 40,
            decision_cut: 40,
            clock,
            resolutions: vec![InstrumentMasterResolution {
                canonical_identity: instrument.into(),
                fact_digest: fact.digest(),
            }],
            frontiers: [d(42); 6],
            canonical_bytes: vec![2],
            identity: d(43),
        };
        InstrumentMasterReadbackV1 {
            request_identity: d(40),
            request_meaning_digest: d(41),
            facts: vec![fact],
            cut,
            stable_correlation: d(44),
            store_generation_identity: d(45),
            store_append_sequence: 1,
            receipt_identity: d(46),
            outbox_identity: d(46),
            canonical_bytes: vec![3],
            identity: d(9),
        }
    }

    fn stored(commit: &PreparedSampleCommitV1) -> StoredSampleReadbackV1 {
        verify_stored_sample_readback_v1(
            commit.fact_canonical_bytes(),
            commit.fact_digest(),
            commit.sample_receipt_canonical_bytes(),
            commit.sample_receipt_digest(),
        )
        .expect("exact stored bytes verify")
    }

    pub(crate) fn prepared_point_event_fixture_v1() -> PreparedSampleCommitV1 {
        let batch = batch(row(10, 1), 30);
        let binding =
            bind_strategy_input_role(&request(&batch), &batch).expect("sealed V1 binding");
        let timeframe = prepare_point_event_timeframe_projection_v1(&binding);
        prepare_sample_commit_v1(
            &binding,
            &batch,
            &timeframe,
            SampleFactHeadsV1 {
                series: None,
                slot: None,
            },
        )
        .expect("contract-verified point event sample")
    }

    pub(crate) fn point_event_projection_fixture_v2() -> (
        StrategyInputBindingReceipt,
        StrategyInputEventFrameReceipt,
        TimeframeProjectionReceiptV1,
        StoredSampleReadbackV1,
    ) {
        point_event_projection_fixture_variant_v2(10, 1, 30, d(22))
    }

    pub(crate) fn point_event_projection_fixture_variant_v2(
        event_effective: u64,
        sequence: u64,
        fact: u8,
        role: BindingDigest,
    ) -> (
        StrategyInputBindingReceipt,
        StrategyInputEventFrameReceipt,
        TimeframeProjectionReceiptV1,
        StoredSampleReadbackV1,
    ) {
        let batch = batch(row(event_effective, sequence), fact);
        let mut request = request(&batch);
        request.input_role_identity = role;
        let binding = bind_strategy_input_role(&request, &batch).expect("sealed V1 binding");
        let frame = bind_strategy_input_event_frame(std::slice::from_ref(&binding), &batch)
            .expect("complete V1 event frame");
        let timeframe = prepare_point_event_timeframe_projection_v1(&binding);
        let commit = prepare_sample_commit_v1(
            &binding,
            &batch,
            &timeframe,
            SampleFactHeadsV1 {
                series: None,
                slot: None,
            },
        )
        .expect("contract-verified point event sample");
        (binding, frame, timeframe, stored(&commit))
    }

    fn prepared_bar_projection_fixture_v2() -> (
        StrategyInputBindingReceipt,
        StrategyInputEventFrameReceipt,
        TimeframeProjectionReceiptV1,
        PreparedSampleCommitV1,
    ) {
        let batch = batch(bar_row(10, 3), 30);
        let binding = bind_strategy_input_role(&bar_request(&batch), &batch)
            .expect("sealed V1 BAR binding");
        let frame = bind_strategy_input_event_frame(std::slice::from_ref(&binding), &batch)
            .expect("complete V1 BAR frame");
        let master = instrument_master_readback(
            "AAPL.XNAS",
            batch.market_semantics_identity(),
            batch.correction_frontier_digest(),
        );
        let timeframe = prepare_bar_timeframe_projection_v1(
            &binding,
            &batch,
            &master,
            UntrustedBarTimeframeProposalV1::FixedInterval(
                UntrustedFixedIntervalBarTimeframeV1 {
                    step: 5,
                    unit: BarTimeframeUnitV1::Minute,
                    label: BarLabelRuleV1::IntervalClose,
                    partial: BarPartialRuleV1::CompleteOnly,
                },
            ),
        )
        .expect("Owner-derived BAR timeframe");
        let commit = prepare_sample_commit_v1(
            &binding,
            &batch,
            &timeframe,
            SampleFactHeadsV1 {
                series: None,
                slot: None,
            },
        )
        .expect("contract-verified BAR sample");
        (binding, frame, timeframe, commit)
    }

    pub(crate) fn bar_projection_fixture_v2() -> (
        StrategyInputBindingReceipt,
        StrategyInputEventFrameReceipt,
        TimeframeProjectionReceiptV1,
        StoredSampleReadbackV1,
    ) {
        let (binding, frame, timeframe, commit) = prepared_bar_projection_fixture_v2();
        (binding, frame, timeframe, stored(&commit))
    }

    pub(crate) fn prepared_bar_postgres_fixture_v2() -> (
        StrategyInputBindingReceipt,
        StrategyInputEventFrameReceipt,
        TimeframeProjectionReceiptV1,
        PreparedSampleCommitV1,
    ) {
        prepared_bar_projection_fixture_v2()
    }

    #[rstest]
    fn point_event_codec_is_fixed_and_domain_separated() {
        let spec = TimeframeSpecV1::point_event();
        assert_eq!(spec.canonical_bytes().len(), 140);
        assert_eq!(
            TimeframeSpecV1::decode(spec.canonical_bytes())
                .unwrap()
                .identity(),
            spec.identity()
        );
        assert_ne!(
            spec.identity(),
            sha256(b"wrong-domain\0", spec.canonical_bytes())
        );
    }

    #[rstest]
    fn timeframe_decoder_rejects_tag_combination_reserved_length_and_trailing_mutations() {
        let valid = TimeframeSpecV1::point_event().canonical_bytes().to_vec();

        for (offset, value, expected) in [
            (4, 0xff, SampleFactUnavailable::InvalidTag),
            (5, 2, SampleFactUnavailable::InvalidCombination),
            (2, 1, SampleFactUnavailable::ReservedNonZero),
        ] {
            let mut bytes = valid.clone();
            bytes[offset] = value;
            assert_eq!(TimeframeSpecV1::decode(&bytes).unwrap_err(), expected);
        }
        assert_eq!(
            TimeframeSpecV1::decode(&valid[..139]).unwrap_err(),
            SampleFactUnavailable::InvalidLength
        );
        let mut trailing = valid;
        trailing.push(0);
        assert_eq!(
            TimeframeSpecV1::decode(&trailing).unwrap_err(),
            SampleFactUnavailable::InvalidLength
        );
    }

    #[rstest]
    fn receipt_decoder_enforces_exact_244_bytes_reserved_and_digest() {
        let fact = SampleFactV1 {
            bytes: Box::new([]),
            series_identity: [1; 32],
            slot_identity: [2; 32],
            series_predecessor: [0; 32],
            correction_predecessor: None,
            snapshot_identity: [14; 32],
            snapshot_fact_digest: [15; 32],
            observation_batch_digest: [16; 32],
            timeframe_identity: [3; 32],
            owner_event_identity: [4; 16],
            fact_digest: [5; 32],
            sample_identity: [6; 32],
            canonical_row_digest: [7; 32],
        };
        let receipt = receipt_from_fact(&fact, 8, 9, 10, [11; 32], 12, [13; 32]);
        assert_eq!(receipt.canonical_bytes().len(), 244);
        assert!(decode_receipt(receipt.canonical_bytes(), receipt.digest()).is_ok());
        let mut reserved = receipt.canonical_bytes().to_vec();
        reserved[2] = 1;
        let digest = sha256(RECEIPT_DOMAIN, &reserved);
        assert_eq!(
            decode_receipt(&reserved, digest).unwrap_err(),
            SampleFactUnavailable::ReservedNonZero
        );
        let mut trailing = receipt.canonical_bytes().to_vec();
        trailing.push(0);
        assert_eq!(
            decode_receipt(&trailing, sha256(RECEIPT_DOMAIN, &trailing)).unwrap_err(),
            SampleFactUnavailable::InvalidLength
        );
    }

    #[rstest]
    fn point_event_preparation_reuses_v1_row_digest_and_binds_projection() {
        let batch = batch(row(10, 3), 30);
        let binding =
            bind_strategy_input_role(&request(&batch), &batch).expect("sealed V1 binding");
        let projection = project_sample_fact_v1(&binding, &batch).expect("unchanged V1 evidence");
        let timeframe = prepare_point_event_timeframe_projection_v1(&binding);
        let commit = prepare_sample_commit_v1(
            &binding,
            &batch,
            &timeframe,
            SampleFactHeadsV1 {
                series: None,
                slot: None,
            },
        )
        .expect("point event fact");

        assert_eq!(
            commit.fact().canonical_row_digest(),
            *projection.canonical_row_digest.as_bytes()
        );
        assert_eq!(
            commit.timeframe_projection_receipt_digest(),
            timeframe.digest()
        );
        assert_eq!(commit.sample_receipt_canonical_bytes().len(), 244);
        assert_ne!(commit.fact_digest(), commit.sample_identity());
    }

    #[rstest]
    fn bar_timeframes_are_minted_from_owner_evidence_and_commit_without_label_parsing() {
        let batch = batch(bar_row(10, 3), 30);
        let binding =
            bind_strategy_input_role(&bar_request(&batch), &batch).expect("sealed BAR binding");
        let master = instrument_master_readback(
            "AAPL.XNAS",
            batch.market_semantics_identity(),
            batch.correction_frontier_digest(),
        );
        let fixed = prepare_bar_timeframe_projection_v1(
            &binding,
            &batch,
            &master,
            UntrustedBarTimeframeProposalV1::FixedInterval(
                UntrustedFixedIntervalBarTimeframeV1 {
                    step: 5,
                    unit: BarTimeframeUnitV1::Minute,
                    label: BarLabelRuleV1::IntervalClose,
                    partial: BarPartialRuleV1::CompleteOnly,
                },
            ),
        )
        .expect("fixed BAR");
        assert!(fixed.is_bar());
        assert_eq!(fixed.spec().canonical_bytes()[4], 0x02);
        assert_eq!(&fixed.spec().canonical_bytes()[5..9], &5_u32.to_le_bytes());
        assert_eq!(fixed.spec().canonical_bytes()[9], 0x02);
        for identity in fixed.spec().canonical_bytes()[10..138].chunks_exact(32) {
            assert_ne!(identity, [0; 32]);
        }
        let commit = prepare_sample_commit_v1(
            &binding,
            &batch,
            &fixed,
            SampleFactHeadsV1 {
                series: None,
                slot: None,
            },
        )
        .expect("BAR sample fact");
        assert_eq!(commit.fact().timeframe_identity(), fixed.timeframe_identity());

        let session = prepare_bar_timeframe_projection_v1(
            &binding,
            &batch,
            &master,
            UntrustedBarTimeframeProposalV1::ExchangeSession(
                UntrustedExchangeSessionBarTimeframeV1 {
                    label: BarLabelRuleV1::IntervalOpen,
                    partial: BarPartialRuleV1::CompleteOnly,
                },
            ),
        )
        .expect("session BAR");
        assert_eq!(session.spec().canonical_bytes()[4], 0x03);
        assert_eq!(session.spec().canonical_bytes()[9], 0x04);
        assert_ne!(fixed.timeframe_identity(), session.timeframe_identity());
    }

    #[rstest]
    fn bar_timeframe_mint_rejects_partial_and_instrument_master_splices() {
        let batch = batch(bar_row(10, 3), 30);
        let binding =
            bind_strategy_input_role(&bar_request(&batch), &batch).expect("sealed BAR binding");
        let proposal = UntrustedBarTimeframeProposalV1::FixedInterval(
            UntrustedFixedIntervalBarTimeframeV1 {
                step: 1,
                unit: BarTimeframeUnitV1::Hour,
                label: BarLabelRuleV1::IntervalClose,
                partial: BarPartialRuleV1::CompleteOnly,
            },
        );
        let mut master = instrument_master_readback(
            "AAPL.XNAS",
            batch.market_semantics_identity(),
            batch.correction_frontier_digest(),
        );

        master.facts.push(master.facts[0].clone());
        assert_eq!(
            prepare_bar_timeframe_projection_v1(&binding, &batch, &master, proposal)
                .unwrap_err(),
            SampleFactUnavailable::AmbiguousInstrumentMaster
        );
        master.facts.pop();
        master.facts[0].proposal.market_semantics_identity = d(90);
        assert_eq!(
            prepare_bar_timeframe_projection_v1(&binding, &batch, &master, proposal)
                .unwrap_err(),
            SampleFactUnavailable::InstrumentMasterMismatch
        );
        master.facts[0].proposal.market_semantics_identity = batch.market_semantics_identity();
        master.facts[0].proposal.correction_frontier = d(91);
        assert_eq!(
            prepare_bar_timeframe_projection_v1(&binding, &batch, &master, proposal)
                .unwrap_err(),
            SampleFactUnavailable::InstrumentMasterMismatch
        );

        let master = instrument_master_readback(
            "AAPL.XNAS",
            batch.market_semantics_identity(),
            batch.correction_frontier_digest(),
        );
        let partial = UntrustedBarTimeframeProposalV1::ExchangeSession(
            UntrustedExchangeSessionBarTimeframeV1 {
                label: BarLabelRuleV1::IntervalOpen,
                partial: BarPartialRuleV1::AdmitPartialAsDistinctSlot,
            },
        );
        assert_eq!(
            prepare_bar_timeframe_projection_v1(&binding, &batch, &master, partial).unwrap_err(),
            SampleFactUnavailable::UnsupportedTimeframe
        );
    }

    #[rstest]
    fn equal_value_new_slot_and_correction_have_distinct_predecessor_semantics() {
        let first_batch = batch(row(10, 3), 30);
        let binding =
            bind_strategy_input_role(&request(&first_batch), &first_batch).expect("sealed binding");
        let timeframe = prepare_point_event_timeframe_projection_v1(&binding);
        let first = prepare_sample_commit_v1(
            &binding,
            &first_batch,
            &timeframe,
            SampleFactHeadsV1 {
                series: None,
                slot: None,
            },
        )
        .expect("first fact");
        let first_stored = stored(&first);

        let next_batch = batch(row(11, 4), 31);
        let next_slot = prepare_sample_commit_v1(
            &binding,
            &next_batch,
            &timeframe,
            SampleFactHeadsV1 {
                series: Some(&first_stored),
                slot: None,
            },
        )
        .expect("equal value in new slot");
        assert_ne!(first.sample_identity(), next_slot.sample_identity());
        assert_ne!(
            first.correction_slot_identity(),
            next_slot.correction_slot_identity()
        );
        assert_eq!(next_slot.correction_predecessor(), None);

        let correction_batch = batch(row(10, 4), 32);
        let correction = prepare_sample_commit_v1(
            &binding,
            &correction_batch,
            &timeframe,
            SampleFactHeadsV1 {
                series: Some(&first_stored),
                slot: Some(&first_stored),
            },
        )
        .expect("equal-value correction");
        assert_eq!(
            first.correction_slot_identity(),
            correction.correction_slot_identity()
        );
        assert_eq!(
            correction.series_predecessor(),
            Some(first.sample_identity())
        );
        assert_eq!(
            correction.correction_predecessor(),
            Some(first.sample_identity())
        );
        assert_ne!(first.sample_identity(), correction.sample_identity());
    }
}
