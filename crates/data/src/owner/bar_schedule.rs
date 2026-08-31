//! Canonical Market Data bar-schedule authority.
//!
//! Public facts and readbacks are opaque Owner artifacts. They deliberately implement neither
//! `Clone` nor `Deserialize`; an untrusted digest locator can only request an exact stored value.
//!
//! ```compile_fail
//! use vibe_data::owner::bar_schedule::BarScheduleReadbackV1;
//! fn requires_clone<T: Clone>() {}
//! requires_clone::<BarScheduleReadbackV1>();
//! ```
#![allow(
    dead_code,
    reason = "crate-private append and codec authority is integrated by the PostgreSQL Owner lane"
)]

use std::fmt::Display;

use sha2::{Digest as _, Sha256};

use super::{
    instrument_master::InstrumentMasterReadbackV1,
    pit_snapshot::VerifiedPitObservationBatch,
    source_binding::BindingDigest,
    strategy_input_binding::{StrategyInputBindingReceipt, project_sample_fact_v1},
};

pub type BarScheduleIdentity = BindingDigest;

const FACT_DOMAIN: &[u8] = b"market-data.bar-schedule-fact.v1\0";
const CUT_DOMAIN: &[u8] = b"market-data.bar-schedule-cut.v1\0";
const RECEIPT_DOMAIN: &[u8] = b"market-data.bar-schedule-receipt.v1\0";
const READBACK_DOMAIN: &[u8] = b"market-data.bar-schedule-readback.v1\0";
const CALENDAR_DOMAIN: &[u8] = b"market-data.bar-schedule.calendar.v1\0";
const SESSION_DOMAIN: &[u8] = b"market-data.bar-schedule.session.v1\0";
const TIME_ZONE_DOMAIN: &[u8] = b"market-data.bar-schedule.time-zone.v1\0";

/// Digest-only, untrusted lookup coordinate. It cannot construct a positive schedule.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct UntrustedBarScheduleLocatorV1 {
    pub digest: BarScheduleIdentity,
}

/// Closed schedule kind registry.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u8)]
pub enum BarScheduleKindV1 {
    FixedInterval = 0x01,
    ExchangeSession = 0x02,
}

/// Closed schedule unit registry.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u8)]
pub enum BarScheduleUnitV1 {
    Second = 0x01,
    Minute = 0x02,
    Hour = 0x03,
    ExchangeSessionDay = 0x04,
}

/// Closed label registry.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u8)]
pub enum BarScheduleLabelV1 {
    IntervalOpen = 0x01,
    IntervalClose = 0x02,
}

/// V1 admits complete bars only.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u8)]
pub enum BarScheduleCompletionV1 {
    CompleteOnly = 0x01,
}

/// Owner-local untrusted proposal. No proposal field is accepted by the sample projection path.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct UntrustedBarScheduleProposalV1 {
    pub(crate) canonical_instrument: String,
    pub(crate) predecessor_fact_digest: Option<BarScheduleIdentity>,
    pub(crate) effective_from: i128,
    pub(crate) effective_until: Option<i128>,
    pub(crate) kind: BarScheduleKindV1,
    pub(crate) step: u32,
    pub(crate) unit: BarScheduleUnitV1,
    pub(crate) anchor_identity: BarScheduleIdentity,
    pub(crate) label: BarScheduleLabelV1,
    pub(crate) completion: BarScheduleCompletionV1,
}

/// Canonical immutable schedule fact. Callers can inspect but cannot construct it.
#[derive(Debug, Eq, PartialEq)]
pub struct BarScheduleFactV1 {
    pub(super) canonical_instrument: String,
    pub(super) predecessor_fact_digest: Option<BarScheduleIdentity>,
    pub(super) effective_from: i128,
    pub(super) effective_until: Option<i128>,
    pub(super) kind: BarScheduleKindV1,
    pub(super) step: u32,
    pub(super) unit: BarScheduleUnitV1,
    pub(super) anchor_identity: BarScheduleIdentity,
    pub(super) calendar_identity: BarScheduleIdentity,
    pub(super) session_identity: BarScheduleIdentity,
    pub(super) time_zone_identity: BarScheduleIdentity,
    pub(super) label: BarScheduleLabelV1,
    pub(super) completion: BarScheduleCompletionV1,
    pub(super) instrument_master_digest: BarScheduleIdentity,
    pub(super) instrument_master_fact_digest: BarScheduleIdentity,
    pub(super) instrument_master_cut_digest: BarScheduleIdentity,
    pub(super) market_semantics_identity: BarScheduleIdentity,
    pub(super) schedule_source_frontier: BarScheduleIdentity,
    pub(super) schedule_correction_frontier: BarScheduleIdentity,
    pub(super) cut_effective_instant: i128,
    pub(super) canonical_bytes: Vec<u8>,
    pub(super) identity: BarScheduleIdentity,
}

impl BarScheduleFactV1 {
    pub fn canonical_instrument(&self) -> &str {
        &self.canonical_instrument
    }
    pub const fn predecessor_fact_digest(&self) -> Option<BarScheduleIdentity> {
        self.predecessor_fact_digest
    }
    pub const fn effective_from(&self) -> i128 {
        self.effective_from
    }
    pub const fn effective_until(&self) -> Option<i128> {
        self.effective_until
    }
    pub const fn kind(&self) -> BarScheduleKindV1 {
        self.kind
    }
    pub const fn step(&self) -> u32 {
        self.step
    }
    pub const fn unit(&self) -> BarScheduleUnitV1 {
        self.unit
    }
    pub const fn anchor_identity(&self) -> BarScheduleIdentity {
        self.anchor_identity
    }
    pub const fn calendar_identity(&self) -> BarScheduleIdentity {
        self.calendar_identity
    }
    pub const fn session_identity(&self) -> BarScheduleIdentity {
        self.session_identity
    }
    pub const fn time_zone_identity(&self) -> BarScheduleIdentity {
        self.time_zone_identity
    }
    pub const fn label(&self) -> BarScheduleLabelV1 {
        self.label
    }
    pub const fn completion(&self) -> BarScheduleCompletionV1 {
        self.completion
    }
    pub const fn instrument_master_digest(&self) -> BarScheduleIdentity {
        self.instrument_master_digest
    }
    pub const fn instrument_master_fact_digest(&self) -> BarScheduleIdentity {
        self.instrument_master_fact_digest
    }
    pub const fn instrument_master_cut_digest(&self) -> BarScheduleIdentity {
        self.instrument_master_cut_digest
    }
    pub const fn market_semantics_identity(&self) -> BarScheduleIdentity {
        self.market_semantics_identity
    }
    pub const fn schedule_source_frontier(&self) -> BarScheduleIdentity {
        self.schedule_source_frontier
    }
    pub const fn schedule_correction_frontier(&self) -> BarScheduleIdentity {
        self.schedule_correction_frontier
    }
    pub const fn cut_effective_instant(&self) -> i128 {
        self.cut_effective_instant
    }
    pub fn canonical_bytes(&self) -> &[u8] {
        &self.canonical_bytes
    }
    pub const fn identity(&self) -> BarScheduleIdentity {
        self.identity
    }
    pub const fn digest(&self) -> BarScheduleIdentity {
        self.identity
    }
}

#[derive(Debug, Eq, PartialEq)]
pub(super) struct BarScheduleCutV1 {
    pub(super) fact_digest: BarScheduleIdentity,
    pub(super) canonical_instrument: String,
    pub(super) effective_instant: i128,
    pub(super) instrument_master_digest: BarScheduleIdentity,
    pub(super) instrument_master_fact_digest: BarScheduleIdentity,
    pub(super) instrument_master_cut_digest: BarScheduleIdentity,
    pub(super) market_semantics_identity: BarScheduleIdentity,
    pub(super) source_frontier: BarScheduleIdentity,
    pub(super) correction_frontier: BarScheduleIdentity,
    pub(super) canonical_bytes: Vec<u8>,
    pub(super) identity: BarScheduleIdentity,
}

#[derive(Debug, Eq, PartialEq)]
pub(super) struct BarScheduleReceiptV1 {
    pub(super) fact_digest: BarScheduleIdentity,
    pub(super) cut_digest: BarScheduleIdentity,
    pub(super) store_generation_identity: BarScheduleIdentity,
    pub(super) store_append_sequence: u64,
    pub(super) canonical_bytes: Vec<u8>,
    pub(super) identity: BarScheduleIdentity,
}

/// Move-only exact readback reconstructed from canonical stored fact, cut, and receipt bytes.
#[derive(Debug, Eq, PartialEq)]
pub struct BarScheduleReadbackV1 {
    pub(super) fact: BarScheduleFactV1,
    pub(super) cut: BarScheduleCutV1,
    pub(super) receipt: BarScheduleReceiptV1,
    pub(super) canonical_bytes: Vec<u8>,
    pub(super) identity: BarScheduleIdentity,
}

impl BarScheduleReadbackV1 {
    pub const fn fact(&self) -> &BarScheduleFactV1 {
        &self.fact
    }
    pub const fn identity(&self) -> BarScheduleIdentity {
        self.identity
    }
    pub const fn digest(&self) -> BarScheduleIdentity {
        self.identity
    }
    pub fn canonical_bytes(&self) -> &[u8] {
        &self.canonical_bytes
    }
    pub const fn receipt_identity(&self) -> BarScheduleIdentity {
        self.receipt.identity
    }
    pub const fn outbox_identity(&self) -> BarScheduleIdentity {
        self.receipt.identity
    }
}

#[derive(Debug)]
pub(crate) struct PreparedBarScheduleCommitV1 {
    pub(super) fact: BarScheduleFactV1,
    pub(super) cut: BarScheduleCutV1,
}

impl PreparedBarScheduleCommitV1 {
    pub(crate) const fn fact(&self) -> &BarScheduleFactV1 {
        &self.fact
    }
    pub(crate) const fn cut_digest(&self) -> BarScheduleIdentity {
        self.cut.identity
    }
    pub(crate) fn cut_canonical_bytes(&self) -> &[u8] {
        &self.cut.canonical_bytes
    }
    pub(crate) const fn expected_predecessor(&self) -> Option<BarScheduleIdentity> {
        self.fact.predecessor_fact_digest
    }
    pub(crate) const fn next_head(&self) -> BarScheduleIdentity {
        self.fact.identity
    }
}

pub(crate) mod resolver_seal {
    pub trait Sealed {}
}

#[async_trait::async_trait]
pub trait BarScheduleResolverV1: resolver_seal::Sealed + Send + Sync {
    async fn resolve_bar_schedule_v1(
        &self,
        locator: &UntrustedBarScheduleLocatorV1,
    ) -> Result<BarScheduleReadbackV1, BarScheduleError>;
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum BarScheduleError {
    UnsupportedDataKind,
    AmbiguousInstrumentMaster,
    InstrumentMasterMismatch,
    EffectiveIntervalMismatch,
    UnsupportedSchedule,
    InvalidCanonicalBytes,
    DigestMismatch,
    ReceiptMismatch,
    StoreUnavailable,
    UnknownIdentity,
}

impl Display for BarScheduleError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{self:?}")
    }
}
impl std::error::Error for BarScheduleError {}

/// Prepares an append only after exact BAR, Instrument Master, cut, interval, and frontier checks.
pub(crate) fn prepare_bar_schedule_commit_v1(
    proposal: UntrustedBarScheduleProposalV1,
    binding: &StrategyInputBindingReceipt,
    batch: &VerifiedPitObservationBatch,
    instrument_master: &InstrumentMasterReadbackV1,
) -> Result<PreparedBarScheduleCommitV1, BarScheduleError> {
    authority::prepare(proposal, binding, batch, instrument_master)
}

pub(super) mod authority {
    use super::*;

    pub(crate) fn prepare(
        proposal: UntrustedBarScheduleProposalV1,
        binding: &StrategyInputBindingReceipt,
        batch: &VerifiedPitObservationBatch,
        instrument_master: &InstrumentMasterReadbackV1,
    ) -> Result<PreparedBarScheduleCommitV1, BarScheduleError> {
        let projection = project_sample_fact_v1(binding, batch)
            .map_err(|_| BarScheduleError::InstrumentMasterMismatch)?;
        let row = projection.row;
        if row.data_kind() != "BAR" {
            return Err(BarScheduleError::UnsupportedDataKind);
        }
        let [master_fact] = instrument_master.facts() else {
            return Err(BarScheduleError::AmbiguousInstrumentMaster);
        };
        let [resolution] = instrument_master.cut().resolutions.as_slice() else {
            return Err(BarScheduleError::AmbiguousInstrumentMaster);
        };
        let event = i128::from(row.event_effective());
        if proposal.canonical_instrument != row.instrument()
            || binding.locator().instrument() != row.instrument()
            || instrument_master.cut().expected_members() != [row.instrument()]
            || !matches!(
                &instrument_master.cut().scope,
                super::super::instrument_master::InstrumentMasterScopeV1::ExactInstrument(value)
                    if value == row.instrument()
            )
            || resolution.canonical_identity != row.instrument()
            || resolution.fact_digest != master_fact.digest()
            || master_fact.canonical_identity() != row.instrument()
            || instrument_master.digest() != batch.instrument_master_digest()
            || row.instrument_master_digest() != batch.instrument_master_digest()
            || master_fact.market_semantics_identity() != row.market_semantics_identity()
            || master_fact.market_semantics_identity() != batch.market_semantics_identity()
            || master_fact.market_semantics_identity()
                != binding.locator().market_semantics_identity()
            || master_fact.source_frontier() != row.source_frontier_digest()
            || master_fact.source_frontier() != batch.source_frontier_digest()
            || master_fact.correction_frontier() != row.correction_frontier_digest()
            || master_fact.correction_frontier() != batch.correction_frontier_digest()
            || instrument_master.cut().frontiers[3] != master_fact.market_semantics_identity()
            || instrument_master.cut().frontiers[4] != master_fact.source_frontier()
            || instrument_master.cut().frontiers[5] != master_fact.correction_frontier()
        {
            return Err(BarScheduleError::InstrumentMasterMismatch);
        }
        if instrument_master.cut().effective_instant() != event {
            return Err(BarScheduleError::InstrumentMasterMismatch);
        }
        if !contains(proposal.effective_from, proposal.effective_until, event)
            || !contains(
                master_fact.effective_from(),
                master_fact.effective_until(),
                event,
            )
        {
            return Err(BarScheduleError::EffectiveIntervalMismatch);
        }
        validate_spec(&proposal)?;
        let class = master_fact.instrument_class() as u16;
        let calendar_identity = field_identity(
            CALENDAR_DOMAIN,
            class,
            master_fact.digest(),
            master_fact.calendar_identity(),
        )?;
        let session_identity = field_identity(
            SESSION_DOMAIN,
            class,
            master_fact.digest(),
            master_fact.session_identity(),
        )?;
        let time_zone_identity = field_identity(
            TIME_ZONE_DOMAIN,
            class,
            master_fact.digest(),
            master_fact.time_zone_identity(),
        )?;
        let mut fact = BarScheduleFactV1 {
            canonical_instrument: proposal.canonical_instrument,
            predecessor_fact_digest: proposal.predecessor_fact_digest,
            effective_from: proposal.effective_from,
            effective_until: proposal.effective_until,
            kind: proposal.kind,
            step: proposal.step,
            unit: proposal.unit,
            anchor_identity: proposal.anchor_identity,
            calendar_identity,
            session_identity,
            time_zone_identity,
            label: proposal.label,
            completion: proposal.completion,
            instrument_master_digest: instrument_master.digest(),
            instrument_master_fact_digest: master_fact.digest(),
            instrument_master_cut_digest: instrument_master.cut().digest(),
            market_semantics_identity: master_fact.market_semantics_identity(),
            schedule_source_frontier: master_fact.source_frontier(),
            schedule_correction_frontier: master_fact.correction_frontier(),
            cut_effective_instant: event,
            canonical_bytes: Vec::new(),
            identity: zero(),
        };
        fact.canonical_bytes = encode_fact(&fact)?;
        fact.identity = digest(FACT_DOMAIN, &fact.canonical_bytes);
        let mut cut = BarScheduleCutV1 {
            fact_digest: fact.identity,
            canonical_instrument: fact.canonical_instrument.clone(),
            effective_instant: event,
            instrument_master_digest: fact.instrument_master_digest,
            instrument_master_fact_digest: fact.instrument_master_fact_digest,
            instrument_master_cut_digest: fact.instrument_master_cut_digest,
            market_semantics_identity: fact.market_semantics_identity,
            source_frontier: fact.schedule_source_frontier,
            correction_frontier: fact.schedule_correction_frontier,
            canonical_bytes: Vec::new(),
            identity: zero(),
        };
        cut.canonical_bytes = encode_cut(&cut)?;
        cut.identity = digest(CUT_DOMAIN, &cut.canonical_bytes);
        Ok(PreparedBarScheduleCommitV1 { fact, cut })
    }

    pub(crate) fn build_receipt(
        fact: &BarScheduleFactV1,
        cut: &BarScheduleCutV1,
        store_generation_identity: BarScheduleIdentity,
        store_append_sequence: u64,
    ) -> Result<BarScheduleReceiptV1, BarScheduleError> {
        if store_generation_identity == zero()
            || store_append_sequence == 0
            || cut.fact_digest != fact.digest()
        {
            return Err(BarScheduleError::ReceiptMismatch);
        }
        let mut receipt = BarScheduleReceiptV1 {
            fact_digest: fact.digest(),
            cut_digest: cut.identity,
            store_generation_identity,
            store_append_sequence,
            canonical_bytes: Vec::new(),
            identity: zero(),
        };
        receipt.canonical_bytes = encode_receipt(&receipt);
        receipt.identity = digest(RECEIPT_DOMAIN, &receipt.canonical_bytes);
        Ok(receipt)
    }

    pub(crate) fn build_readback(
        fact: BarScheduleFactV1,
        cut: BarScheduleCutV1,
        receipt: BarScheduleReceiptV1,
    ) -> Result<BarScheduleReadbackV1, BarScheduleError> {
        if receipt.fact_digest != fact.digest()
            || receipt.cut_digest != cut.identity
            || cut.fact_digest != fact.digest()
        {
            return Err(BarScheduleError::ReceiptMismatch);
        }
        let canonical_bytes = encode_readback(&fact, &cut, &receipt)?;
        let identity = digest(READBACK_DOMAIN, &canonical_bytes);
        Ok(BarScheduleReadbackV1 {
            fact,
            cut,
            receipt,
            canonical_bytes,
            identity,
        })
    }

    pub(crate) fn decode_fact(
        bytes: &[u8],
        expected: BarScheduleIdentity,
    ) -> Result<BarScheduleFactV1, BarScheduleError> {
        if digest(FACT_DOMAIN, bytes) != expected {
            return Err(BarScheduleError::DigestMismatch);
        }
        let mut d = Decoder::new(bytes);
        d.schema()?;
        let mut fact = BarScheduleFactV1 {
            canonical_instrument: d.string()?,
            predecessor_fact_digest: d.optional_digest()?,
            effective_from: d.i128()?,
            effective_until: d.optional_i128()?,
            kind: kind(d.u8()?)?,
            step: d.u32()?,
            unit: unit(d.u8()?)?,
            anchor_identity: d.digest()?,
            calendar_identity: d.digest()?,
            session_identity: d.digest()?,
            time_zone_identity: d.digest()?,
            label: label(d.u8()?)?,
            completion: completion(d.u8()?)?,
            instrument_master_digest: d.digest()?,
            instrument_master_fact_digest: d.digest()?,
            instrument_master_cut_digest: d.digest()?,
            market_semantics_identity: d.digest()?,
            schedule_source_frontier: d.digest()?,
            schedule_correction_frontier: d.digest()?,
            cut_effective_instant: d.i128()?,
            canonical_bytes: bytes.to_vec(),
            identity: expected,
        };
        d.end()?;
        validate_decoded_fact(&fact)?;
        fact.identity = expected;
        Ok(fact)
    }

    pub(crate) fn decode_cut(
        bytes: &[u8],
        expected: BarScheduleIdentity,
    ) -> Result<BarScheduleCutV1, BarScheduleError> {
        if digest(CUT_DOMAIN, bytes) != expected {
            return Err(BarScheduleError::DigestMismatch);
        }
        let mut d = Decoder::new(bytes);
        d.schema()?;
        let cut = BarScheduleCutV1 {
            fact_digest: d.digest()?,
            canonical_instrument: d.string()?,
            effective_instant: d.i128()?,
            instrument_master_digest: d.digest()?,
            instrument_master_fact_digest: d.digest()?,
            instrument_master_cut_digest: d.digest()?,
            market_semantics_identity: d.digest()?,
            source_frontier: d.digest()?,
            correction_frontier: d.digest()?,
            canonical_bytes: bytes.to_vec(),
            identity: expected,
        };
        d.end()?;
        Ok(cut)
    }

    pub(crate) fn decode_receipt(
        bytes: &[u8],
        expected: BarScheduleIdentity,
    ) -> Result<BarScheduleReceiptV1, BarScheduleError> {
        if digest(RECEIPT_DOMAIN, bytes) != expected {
            return Err(BarScheduleError::DigestMismatch);
        }
        let mut d = Decoder::new(bytes);
        d.schema()?;
        let receipt = BarScheduleReceiptV1 {
            fact_digest: d.digest()?,
            cut_digest: d.digest()?,
            store_generation_identity: d.digest()?,
            store_append_sequence: d.u64()?,
            canonical_bytes: bytes.to_vec(),
            identity: expected,
        };
        d.end()?;
        if receipt.store_generation_identity == zero() || receipt.store_append_sequence == 0 {
            return Err(BarScheduleError::InvalidCanonicalBytes);
        }
        Ok(receipt)
    }

    pub(crate) fn decode_readback(
        bytes: &[u8],
        expected: BarScheduleIdentity,
    ) -> Result<BarScheduleReadbackV1, BarScheduleError> {
        if digest(READBACK_DOMAIN, bytes) != expected {
            return Err(BarScheduleError::DigestMismatch);
        }
        let mut d = Decoder::new(bytes);
        d.schema()?;
        let fact_expected = d.digest()?;
        let fact_bytes = d.bytes()?;
        let cut_expected = d.digest()?;
        let cut_bytes = d.bytes()?;
        let receipt_expected = d.digest()?;
        let receipt_bytes = d.bytes()?;
        d.end()?;
        let fact = decode_fact(&fact_bytes, fact_expected)?;
        let cut = decode_cut(&cut_bytes, cut_expected)?;
        let receipt = decode_receipt(&receipt_bytes, receipt_expected)?;
        let readback = build_readback(fact, cut, receipt)?;
        if readback.canonical_bytes != bytes || readback.identity != expected {
            return Err(BarScheduleError::ReceiptMismatch);
        }
        Ok(readback)
    }

    pub(crate) fn verify_readback(readback: &BarScheduleReadbackV1) -> bool {
        decode_readback(&readback.canonical_bytes, readback.identity).is_ok()
    }

    fn encode_fact(f: &BarScheduleFactV1) -> Result<Vec<u8>, BarScheduleError> {
        let mut e = Encoder::new();
        e.string(&f.canonical_instrument)?;
        e.optional_digest(f.predecessor_fact_digest);
        e.i128(f.effective_from);
        e.optional_i128(f.effective_until);
        e.u8(f.kind as u8);
        e.u32(f.step);
        e.u8(f.unit as u8);
        for v in [
            f.anchor_identity,
            f.calendar_identity,
            f.session_identity,
            f.time_zone_identity,
        ] {
            e.digest(v);
        }
        e.u8(f.label as u8);
        e.u8(f.completion as u8);
        for v in [
            f.instrument_master_digest,
            f.instrument_master_fact_digest,
            f.instrument_master_cut_digest,
            f.market_semantics_identity,
            f.schedule_source_frontier,
            f.schedule_correction_frontier,
        ] {
            e.digest(v);
        }
        e.i128(f.cut_effective_instant);
        Ok(e.finish())
    }
    fn encode_cut(c: &BarScheduleCutV1) -> Result<Vec<u8>, BarScheduleError> {
        let mut e = Encoder::new();
        e.digest(c.fact_digest);
        e.string(&c.canonical_instrument)?;
        e.i128(c.effective_instant);
        for v in [
            c.instrument_master_digest,
            c.instrument_master_fact_digest,
            c.instrument_master_cut_digest,
            c.market_semantics_identity,
            c.source_frontier,
            c.correction_frontier,
        ] {
            e.digest(v);
        }
        Ok(e.finish())
    }
    fn encode_receipt(r: &BarScheduleReceiptV1) -> Vec<u8> {
        let mut e = Encoder::new();
        e.digest(r.fact_digest);
        e.digest(r.cut_digest);
        e.digest(r.store_generation_identity);
        e.u64(r.store_append_sequence);
        e.finish()
    }
    fn encode_readback(
        f: &BarScheduleFactV1,
        c: &BarScheduleCutV1,
        r: &BarScheduleReceiptV1,
    ) -> Result<Vec<u8>, BarScheduleError> {
        let mut e = Encoder::new();
        e.digest(f.identity);
        e.bytes(&f.canonical_bytes)?;
        e.digest(c.identity);
        e.bytes(&c.canonical_bytes)?;
        e.digest(r.identity);
        e.bytes(&r.canonical_bytes)?;
        Ok(e.finish())
    }

    fn validate_decoded_fact(f: &BarScheduleFactV1) -> Result<(), BarScheduleError> {
        let p = UntrustedBarScheduleProposalV1 {
            canonical_instrument: f.canonical_instrument.clone(),
            predecessor_fact_digest: f.predecessor_fact_digest,
            effective_from: f.effective_from,
            effective_until: f.effective_until,
            kind: f.kind,
            step: f.step,
            unit: f.unit,
            anchor_identity: f.anchor_identity,
            label: f.label,
            completion: f.completion,
        };
        validate_spec(&p)?;
        if !contains(f.effective_from, f.effective_until, f.cut_effective_instant)
            || [
                f.calendar_identity,
                f.session_identity,
                f.time_zone_identity,
                f.instrument_master_digest,
                f.instrument_master_fact_digest,
                f.instrument_master_cut_digest,
                f.market_semantics_identity,
                f.schedule_source_frontier,
                f.schedule_correction_frontier,
            ]
            .contains(&zero())
        {
            return Err(BarScheduleError::InvalidCanonicalBytes);
        }
        Ok(())
    }
}

fn validate_spec(p: &UntrustedBarScheduleProposalV1) -> Result<(), BarScheduleError> {
    if p.canonical_instrument.is_empty()
        || p.anchor_identity == zero()
        || p.step == 0
        || p.effective_until.is_some_and(|u| p.effective_from >= u)
    {
        return Err(BarScheduleError::UnsupportedSchedule);
    }
    match (p.kind, p.unit, p.step) {
        (
            BarScheduleKindV1::FixedInterval,
            BarScheduleUnitV1::Second | BarScheduleUnitV1::Minute | BarScheduleUnitV1::Hour,
            _,
        ) => Ok(()),
        (BarScheduleKindV1::ExchangeSession, BarScheduleUnitV1::ExchangeSessionDay, 1) => Ok(()),
        _ => Err(BarScheduleError::UnsupportedSchedule),
    }
}
fn contains(from: i128, until: Option<i128>, at: i128) -> bool {
    from <= at && until.is_none_or(|u| at < u)
}
fn field_identity(
    domain: &[u8],
    class: u16,
    fact: BarScheduleIdentity,
    value: &str,
) -> Result<BarScheduleIdentity, BarScheduleError> {
    if value.is_empty() {
        return Err(BarScheduleError::UnsupportedSchedule);
    }
    let mut b = Vec::new();
    b.extend_from_slice(&1u16.to_le_bytes());
    b.extend_from_slice(&class.to_le_bytes());
    b.extend_from_slice(fact.as_bytes());
    let n = u16::try_from(value.len()).map_err(|_| BarScheduleError::UnsupportedSchedule)?;
    b.extend_from_slice(&n.to_le_bytes());
    b.extend_from_slice(value.as_bytes());
    Ok(digest(domain, &b))
}
fn digest(domain: &[u8], bytes: &[u8]) -> BarScheduleIdentity {
    let mut h = Sha256::new();
    h.update(domain);
    h.update(bytes);
    BarScheduleIdentity::from_untrusted_bytes(h.finalize().into())
}
fn zero() -> BarScheduleIdentity {
    BarScheduleIdentity::from_untrusted_bytes([0; 32])
}

struct Encoder {
    bytes: Vec<u8>,
}
impl Encoder {
    fn new() -> Self {
        Self {
            bytes: vec![1, 0, 0, 0],
        }
    }
    fn finish(self) -> Vec<u8> {
        self.bytes
    }
    fn u8(&mut self, v: u8) {
        self.bytes.push(v)
    }
    fn u32(&mut self, v: u32) {
        self.bytes.extend_from_slice(&v.to_le_bytes())
    }
    fn u64(&mut self, v: u64) {
        self.bytes.extend_from_slice(&v.to_le_bytes())
    }
    fn i128(&mut self, v: i128) {
        self.bytes.extend_from_slice(&v.to_le_bytes())
    }
    fn digest(&mut self, v: BarScheduleIdentity) {
        self.bytes.extend_from_slice(v.as_bytes())
    }
    fn optional_digest(&mut self, v: Option<BarScheduleIdentity>) {
        match v {
            None => self.u8(0),
            Some(v) => {
                self.u8(1);
                self.digest(v)
            }
        }
    }
    fn optional_i128(&mut self, v: Option<i128>) {
        match v {
            None => self.u8(0),
            Some(v) => {
                self.u8(1);
                self.i128(v)
            }
        }
    }
    fn bytes(&mut self, v: &[u8]) -> Result<(), BarScheduleError> {
        let n = u32::try_from(v.len()).map_err(|_| BarScheduleError::InvalidCanonicalBytes)?;
        self.u32(n);
        self.bytes.extend_from_slice(v);
        Ok(())
    }
    fn string(&mut self, v: &str) -> Result<(), BarScheduleError> {
        if v.is_empty() {
            return Err(BarScheduleError::InvalidCanonicalBytes);
        }
        let n = u16::try_from(v.len()).map_err(|_| BarScheduleError::InvalidCanonicalBytes)?;
        self.bytes.extend_from_slice(&n.to_le_bytes());
        self.bytes.extend_from_slice(v.as_bytes());
        Ok(())
    }
}
struct Decoder<'a> {
    bytes: &'a [u8],
    offset: usize,
}
impl<'a> Decoder<'a> {
    fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, offset: 0 }
    }
    fn take(&mut self, n: usize) -> Result<&'a [u8], BarScheduleError> {
        let end = self
            .offset
            .checked_add(n)
            .ok_or(BarScheduleError::InvalidCanonicalBytes)?;
        let v = self
            .bytes
            .get(self.offset..end)
            .ok_or(BarScheduleError::InvalidCanonicalBytes)?;
        self.offset = end;
        Ok(v)
    }
    fn schema(&mut self) -> Result<(), BarScheduleError> {
        if self.take(4)? != [1, 0, 0, 0] {
            return Err(BarScheduleError::InvalidCanonicalBytes);
        }
        Ok(())
    }
    fn u8(&mut self) -> Result<u8, BarScheduleError> {
        Ok(self.take(1)?[0])
    }
    fn u32(&mut self) -> Result<u32, BarScheduleError> {
        Ok(u32::from_le_bytes(self.take(4)?.try_into().unwrap()))
    }
    fn u64(&mut self) -> Result<u64, BarScheduleError> {
        Ok(u64::from_le_bytes(self.take(8)?.try_into().unwrap()))
    }
    fn i128(&mut self) -> Result<i128, BarScheduleError> {
        Ok(i128::from_le_bytes(self.take(16)?.try_into().unwrap()))
    }
    fn digest(&mut self) -> Result<BarScheduleIdentity, BarScheduleError> {
        Ok(BarScheduleIdentity::from_untrusted_bytes(
            self.take(32)?.try_into().unwrap(),
        ))
    }
    fn optional_digest(&mut self) -> Result<Option<BarScheduleIdentity>, BarScheduleError> {
        match self.u8()? {
            0 => Ok(None),
            1 => Ok(Some(self.digest()?)),
            _ => Err(BarScheduleError::InvalidCanonicalBytes),
        }
    }
    fn optional_i128(&mut self) -> Result<Option<i128>, BarScheduleError> {
        match self.u8()? {
            0 => Ok(None),
            1 => Ok(Some(self.i128()?)),
            _ => Err(BarScheduleError::InvalidCanonicalBytes),
        }
    }
    fn bytes(&mut self) -> Result<Vec<u8>, BarScheduleError> {
        let n =
            usize::try_from(self.u32()?).map_err(|_| BarScheduleError::InvalidCanonicalBytes)?;
        Ok(self.take(n)?.to_vec())
    }
    fn string(&mut self) -> Result<String, BarScheduleError> {
        let n = usize::from(u16::from_le_bytes(self.take(2)?.try_into().unwrap()));
        if n == 0 {
            return Err(BarScheduleError::InvalidCanonicalBytes);
        }
        String::from_utf8(self.take(n)?.to_vec())
            .map_err(|_| BarScheduleError::InvalidCanonicalBytes)
    }
    fn end(&self) -> Result<(), BarScheduleError> {
        if self.offset == self.bytes.len() {
            Ok(())
        } else {
            Err(BarScheduleError::InvalidCanonicalBytes)
        }
    }
}
fn kind(v: u8) -> Result<BarScheduleKindV1, BarScheduleError> {
    match v {
        1 => Ok(BarScheduleKindV1::FixedInterval),
        2 => Ok(BarScheduleKindV1::ExchangeSession),
        _ => Err(BarScheduleError::InvalidCanonicalBytes),
    }
}
fn unit(v: u8) -> Result<BarScheduleUnitV1, BarScheduleError> {
    match v {
        1 => Ok(BarScheduleUnitV1::Second),
        2 => Ok(BarScheduleUnitV1::Minute),
        3 => Ok(BarScheduleUnitV1::Hour),
        4 => Ok(BarScheduleUnitV1::ExchangeSessionDay),
        _ => Err(BarScheduleError::InvalidCanonicalBytes),
    }
}
fn label(v: u8) -> Result<BarScheduleLabelV1, BarScheduleError> {
    match v {
        1 => Ok(BarScheduleLabelV1::IntervalOpen),
        2 => Ok(BarScheduleLabelV1::IntervalClose),
        _ => Err(BarScheduleError::InvalidCanonicalBytes),
    }
}
fn completion(v: u8) -> Result<BarScheduleCompletionV1, BarScheduleError> {
    match v {
        1 => Ok(BarScheduleCompletionV1::CompleteOnly),
        _ => Err(BarScheduleError::InvalidCanonicalBytes),
    }
}
