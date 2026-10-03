//! The window schedule fact a PIT window custody mints (slice T0-4b): where the frames of its
//! window lie, for one member and the custody's execution timeframe.
//!
//! The snapshot path keeps its own per-instrument `BarScheduleFactV1` chain, minted from one batch
//! row each; a custody never advances it. The custody's commit mints one window schedule fact per
//! member over the whole window instead, in the same transaction, and a successor custody mints
//! none: it restates its predecessor's basis, window and timeframes exactly, so the root's
//! schedules serve the whole chain.
//!
//! Frames sit at bar-close instants: `{ phase_ns + n * interval_ns }`, where the phase is the
//! instant the declared grid is anchored at reduced modulo the interval - zero for a grid anchored
//! at the Unix epoch, such as a daily bar closing at midnight UTC or a four-hour bar.

#![allow(
    dead_code,
    reason = "the frame reads are consumed by the custody's derived view (slice T0-5), not built yet"
)]

use sha2::{Digest as _, Sha256};

use super::authority::{CustodyTimeframeV1, DerivedCustodyV1};
use crate::owner::{
    bar_schedule::{
        BarScheduleClockV1, BarScheduleCompletionV1, BarScheduleKindV1, BarScheduleLabelV1,
        BarScheduleUnitV1,
    },
    declared_bar_timeframe_v1::{DeclaredBarAnchorV1, DeclaredBarShapeV1, anchor_identity_v1},
    source_binding::BindingDigest,
};

const SCHEDULE_DOMAIN: &[u8] = b"market-data.pit-window-schedule.v1\0";

/// One member's window schedule for a custody's execution timeframe.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct PitWindowScheduleFactV1 {
    pub(crate) custody_identity: BindingDigest,
    pub(crate) chain_root: BindingDigest,
    pub(crate) member_ordinal: u8,
    pub(crate) instrument: String,
    /// The execution timeframe's spec identity for this member.
    pub(crate) timeframe_identity: BindingDigest,
    pub(crate) shape: DeclaredBarShapeV1,
    pub(crate) interval_ns: u64,
    pub(crate) phase_ns: u64,
    pub(crate) window_start_ns: u64,
    pub(crate) window_end_ns_exclusive: u64,
    pub(crate) instrument_master_key: BindingDigest,
    pub(crate) instrument_master_fact_digest: BindingDigest,
    pub(crate) market_semantics_identity: BindingDigest,
    /// The minting cut of the custody that minted it.
    pub(crate) cut_ns: u64,
    canonical_bytes: Vec<u8>,
    identity: BindingDigest,
}

impl PitWindowScheduleFactV1 {
    pub(crate) fn canonical_bytes(&self) -> &[u8] {
        &self.canonical_bytes
    }

    pub(crate) const fn identity(&self) -> BindingDigest {
        self.identity
    }
}

#[cfg(test)]
impl PitWindowScheduleFactV1 {
    /// A sealed schedule of `step` hours from the Unix epoch over `window`, for tests of what reads
    /// one.
    pub(crate) fn hourly_for_test(
        member_ordinal: u8,
        instrument: &str,
        step: u32,
        window: (u64, u64),
    ) -> Self {
        let shape = DeclaredBarShapeV1 {
            kind: BarScheduleKindV1::FixedInterval,
            unit: BarScheduleUnitV1::Hour,
            step,
            anchor: DeclaredBarAnchorV1::UnixEpoch,
            clock: BarScheduleClockV1::Continuous,
            label: BarScheduleLabelV1::IntervalClose,
            completion: BarScheduleCompletionV1::CompleteOnly,
        };
        let interval_ns = u64::from(step) * 3_600_000_000_000;
        let zero = BindingDigest::from_untrusted_bytes([0; 32]);
        seal(Self {
            custody_identity: BindingDigest::from_untrusted_bytes([1; 32]),
            chain_root: BindingDigest::from_untrusted_bytes([1; 32]),
            member_ordinal,
            instrument: instrument.to_owned(),
            timeframe_identity: BindingDigest::from_untrusted_bytes([2; 32]),
            shape,
            interval_ns,
            phase_ns: 0,
            window_start_ns: window.0,
            window_end_ns_exclusive: window.1,
            instrument_master_key: BindingDigest::from_untrusted_bytes([3; 32]),
            instrument_master_fact_digest: BindingDigest::from_untrusted_bytes([4; 32]),
            market_semantics_identity: BindingDigest::from_untrusted_bytes([5; 32]),
            cut_ns: 1_790_000_000_000_000_000,
            canonical_bytes: Vec::new(),
            identity: zero,
        })
        .expect("a T0 schedule seals")
    }
}

/// The phase of a grid anchored at `anchor`: the anchor instant reduced modulo `interval_ns`.
///
/// Only a grid anchored at the Unix epoch has an instant of its own; a session-open anchor has
/// none without a session, which T0 refuses before a schedule is minted.
pub(crate) const fn phase_ns_v1(anchor: DeclaredBarAnchorV1, interval_ns: u64) -> Option<u64> {
    match anchor {
        DeclaredBarAnchorV1::UnixEpoch if interval_ns > 0 => Some(0),
        _ => None,
    }
}

/// Whether `shape` is the one bar T0 schedules: a fixed interval on a continuous clock from the
/// Unix epoch, labelled at its close, complete bars only.
fn is_t0_shape(shape: &DeclaredBarShapeV1) -> bool {
    shape.kind == BarScheduleKindV1::FixedInterval
        && shape.clock == BarScheduleClockV1::Continuous
        && shape.anchor == DeclaredBarAnchorV1::UnixEpoch
        && shape.label == BarScheduleLabelV1::IntervalClose
        && shape.completion == BarScheduleCompletionV1::CompleteOnly
}

/// The window schedule facts a root custody mints, one per member, in member order.
///
/// Returns `None` for a timeframe T0 does not schedule, which the custody's authority refuses
/// before this is reached.
pub(crate) fn mint_window_schedules_v1(
    derived: &DerivedCustodyV1,
    custody_identity: BindingDigest,
    chain_root: BindingDigest,
    cut_ns: u64,
) -> Option<Vec<PitWindowScheduleFactV1>> {
    let execution: &CustodyTimeframeV1 = &derived.execution;
    derived
        .members
        .iter()
        .enumerate()
        .map(|(ordinal, instrument)| {
            seal(PitWindowScheduleFactV1 {
                custody_identity,
                chain_root,
                member_ordinal: u8::try_from(ordinal).ok()?,
                instrument: instrument.clone(),
                timeframe_identity: BindingDigest::from_untrusted_bytes(
                    *execution.member_identities.get(ordinal)?,
                ),
                shape: execution.shape,
                interval_ns: execution.interval_ns,
                phase_ns: phase_ns_v1(execution.shape.anchor, execution.interval_ns)?,
                window_start_ns: derived.window.0,
                window_end_ns_exclusive: derived.window.1,
                instrument_master_key: derived.instrument_master_key,
                instrument_master_fact_digest: *derived.member_fact_digests.get(ordinal)?,
                market_semantics_identity: derived.market_semantics_identity,
                cut_ns,
                canonical_bytes: Vec::new(),
                identity: BindingDigest::from_untrusted_bytes([0; 32]),
            })
        })
        .collect()
}

/// Encodes `fact` and stamps its bytes and identity, refusing any field T0 cannot schedule.
fn seal(mut fact: PitWindowScheduleFactV1) -> Option<PitWindowScheduleFactV1> {
    if !is_t0_shape(&fact.shape)
        || fact.instrument.is_empty()
        || fact.interval_ns == 0
        || fact.interval_ns != fixed_interval_ns(&fact.shape)?
        || phase_ns_v1(fact.shape.anchor, fact.interval_ns) != Some(fact.phase_ns)
        || fact.window_start_ns >= fact.window_end_ns_exclusive
    {
        return None;
    }
    fact.canonical_bytes = encode(&fact);
    fact.identity = sha256(&fact.canonical_bytes);
    Some(fact)
}

fn fixed_interval_ns(shape: &DeclaredBarShapeV1) -> Option<u64> {
    let unit: u64 = match shape.unit {
        BarScheduleUnitV1::Second => 1_000_000_000,
        BarScheduleUnitV1::Minute => 60_000_000_000,
        BarScheduleUnitV1::Hour => 3_600_000_000_000,
        BarScheduleUnitV1::ExchangeSessionDay => return None,
    };
    unit.checked_mul(u64::from(shape.step))
}

fn encode(fact: &PitWindowScheduleFactV1) -> Vec<u8> {
    let mut bytes = Vec::new();
    bytes.extend_from_slice(&1_u16.to_be_bytes());
    bytes.extend_from_slice(fact.custody_identity.as_bytes());
    bytes.extend_from_slice(fact.chain_root.as_bytes());
    put_u64(&mut bytes, u64::from(fact.member_ordinal));
    put_u64(&mut bytes, fact.instrument.len() as u64);
    bytes.extend_from_slice(fact.instrument.as_bytes());
    bytes.extend_from_slice(fact.timeframe_identity.as_bytes());
    bytes.push(fact.shape.kind as u8);
    put_u64(&mut bytes, u64::from(fact.shape.step));
    bytes.push(fact.shape.unit as u8);
    bytes.extend_from_slice(anchor_identity_v1(fact.shape.anchor).as_bytes());
    bytes.push(match fact.shape.clock {
        BarScheduleClockV1::Continuous => 1,
        BarScheduleClockV1::ScheduleBounded => 2,
    });
    bytes.push(fact.shape.label as u8);
    bytes.push(fact.shape.completion as u8);
    put_u64(&mut bytes, fact.interval_ns);
    put_u64(&mut bytes, fact.phase_ns);
    put_u64(&mut bytes, fact.window_start_ns);
    put_u64(&mut bytes, fact.window_end_ns_exclusive);
    bytes.extend_from_slice(fact.instrument_master_key.as_bytes());
    bytes.extend_from_slice(fact.instrument_master_fact_digest.as_bytes());
    bytes.extend_from_slice(fact.market_semantics_identity.as_bytes());
    put_u64(&mut bytes, fact.cut_ns);
    bytes
}

/// Reads stored bytes back into the fact they state, only when they reproduce `identity`.
pub(crate) fn decode_window_schedule_v1(
    bytes: &[u8],
    identity: BindingDigest,
) -> Option<PitWindowScheduleFactV1> {
    if sha256(bytes) != identity {
        return None;
    }
    let mut reader = Reader { bytes };

    if reader.take(2)? != 1_u16.to_be_bytes() {
        return None;
    }
    let custody_identity = reader.digest()?;
    let chain_root = reader.digest()?;
    let member_ordinal = u8::try_from(reader.u64()?).ok()?;
    let length = usize::try_from(reader.u64()?).ok()?;
    let instrument = String::from_utf8(reader.take(length)?.to_vec()).ok()?;
    let timeframe_identity = reader.digest()?;
    let kind = match reader.u8()? {
        1 => BarScheduleKindV1::FixedInterval,
        2 => BarScheduleKindV1::ExchangeSession,
        _ => return None,
    };
    let step = u32::try_from(reader.u64()?).ok()?;
    let unit = match reader.u8()? {
        1 => BarScheduleUnitV1::Second,
        2 => BarScheduleUnitV1::Minute,
        3 => BarScheduleUnitV1::Hour,
        4 => BarScheduleUnitV1::ExchangeSessionDay,
        _ => return None,
    };
    let anchor_identity = reader.digest()?;
    let anchor = [
        DeclaredBarAnchorV1::UnixEpoch,
        DeclaredBarAnchorV1::SessionOpen,
    ]
    .into_iter()
    .find(|anchor| anchor_identity_v1(*anchor) == anchor_identity)?;
    let clock = match reader.u8()? {
        1 => BarScheduleClockV1::Continuous,
        2 => BarScheduleClockV1::ScheduleBounded,
        _ => return None,
    };
    let label = match reader.u8()? {
        1 => BarScheduleLabelV1::IntervalOpen,
        2 => BarScheduleLabelV1::IntervalClose,
        _ => return None,
    };
    let completion = match reader.u8()? {
        1 => BarScheduleCompletionV1::CompleteOnly,
        _ => return None,
    };
    let fact = PitWindowScheduleFactV1 {
        custody_identity,
        chain_root,
        member_ordinal,
        instrument,
        timeframe_identity,
        shape: DeclaredBarShapeV1 {
            kind,
            unit,
            step,
            anchor,
            clock,
            label,
            completion,
        },
        interval_ns: reader.u64()?,
        phase_ns: reader.u64()?,
        window_start_ns: reader.u64()?,
        window_end_ns_exclusive: reader.u64()?,
        instrument_master_key: reader.digest()?,
        instrument_master_fact_digest: reader.digest()?,
        market_semantics_identity: reader.digest()?,
        cut_ns: reader.u64()?,
        canonical_bytes: Vec::new(),
        identity: BindingDigest::from_untrusted_bytes([0; 32]),
    };

    if !reader.bytes.is_empty() {
        return None;
    }
    // The bytes are re-derived from the fact they state, so a field T0 cannot schedule, or an
    // encoding other than the canonical one, is refused even under its own digest.
    seal(fact).filter(|fact| fact.canonical_bytes == bytes)
}

/// The frame instants of `schedule` in `[run_start_ns, run_end_ns_exclusive)`: the bar-close
/// instants of its grid inside both the run and the schedule's window, in order.
pub(crate) fn frame_instants_v1(
    schedule: &PitWindowScheduleFactV1,
    run_start_ns: u64,
    run_end_ns_exclusive: u64,
) -> impl Iterator<Item = u64> {
    let interval = schedule.interval_ns;
    let phase = schedule.phase_ns;
    let low = run_start_ns.max(schedule.window_start_ns);
    let high = run_end_ns_exclusive.min(schedule.window_end_ns_exclusive);
    let first = if low <= phase {
        Some(phase)
    } else {
        (low - phase)
            .div_ceil(interval)
            .checked_mul(interval)
            .and_then(|offset| phase.checked_add(offset))
    };
    std::iter::successors(first, move |instant| instant.checked_add(interval))
        .take_while(move |instant| *instant < high)
}

/// The window schedule check of a custody frame: the schedule's window contains `e_k` on its
/// grid, and its effective start - the custody window's start - is at or before `d_k`.
///
/// The minting cut is not compared: under the narrowing the user authorized on 2026-09-27, a
/// custody's frames no longer carry their own minting evidence and only backfilled history is
/// admitted, so the cut stays custody evidence. The window grid is the Source Binding's
/// declaration, knowable before any frame; comparing the cut would refuse every backfilled frame,
/// whose `d_k` lies in the past of the day the custody was minted.
pub(crate) fn window_schedule_admits_frame_v1(
    schedule: &PitWindowScheduleFactV1,
    event_ns: u64,
    decision_cut_ns: u64,
) -> bool {
    event_ns >= schedule.window_start_ns
        && event_ns < schedule.window_end_ns_exclusive
        && event_ns >= schedule.phase_ns
        && (event_ns - schedule.phase_ns).is_multiple_of(schedule.interval_ns)
        && schedule.window_start_ns <= decision_cut_ns
}

struct Reader<'a> {
    bytes: &'a [u8],
}

impl<'a> Reader<'a> {
    fn take(&mut self, length: usize) -> Option<&'a [u8]> {
        if self.bytes.len() < length {
            return None;
        }
        let (head, tail) = self.bytes.split_at(length);
        self.bytes = tail;
        Some(head)
    }

    fn u8(&mut self) -> Option<u8> {
        Some(self.take(1)?[0])
    }

    fn u64(&mut self) -> Option<u64> {
        Some(u64::from_be_bytes(self.take(8)?.try_into().ok()?))
    }

    fn digest(&mut self) -> Option<BindingDigest> {
        Some(BindingDigest::from_untrusted_bytes(
            self.take(32)?.try_into().ok()?,
        ))
    }
}

fn put_u64(out: &mut Vec<u8>, value: u64) {
    out.extend_from_slice(&value.to_be_bytes());
}

fn sha256(bytes: &[u8]) -> BindingDigest {
    let mut hasher = Sha256::new();
    hasher.update(SCHEDULE_DOMAIN);
    hasher.update(bytes);
    BindingDigest::from_untrusted_bytes(hasher.finalize().into())
}

#[cfg(test)]
#[path = "schedule_tests.rs"]
mod tests;
