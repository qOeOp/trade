//! Verified ingredients for a future two-frame native Replay sequence.
//!
//! One frame can be checked against an Owner-verified PIT batch and the unchanged V1 native
//! scheduling seal. A positive sequence cannot be issued until Market Data has a durable,
//! request-window-complete frame census and sequence receipt/outbox readback.

#![allow(
    dead_code,
    reason = "the frame verifier is reserved for the unavailable durable V2 sequence issuer"
)]

use sha2::{Digest, Sha256};
use vibe_model::{
    data::{BarType, Data},
    identifiers::InstrumentId,
};

use super::{
    bar_schedule::BarScheduleReadbackV1,
    native_replay_scheduling_v1::{
        NativeReplaySchedulingErrorV1, seal_native_replay_scheduling_v1,
    },
    pit_snapshot::{
        VerifiedPitObservation, VerifiedPitObservationBatch, authority::canonical_observation_bytes,
    },
    source_binding::BindingDigest,
};

const BAR_FIELDS: [&str; 5] = ["OPEN", "HIGH", "LOW", "CLOSE", "VOLUME"];
const QUOTE_FIELDS: [&str; 4] = ["BID_PRICE", "ASK_PRICE", "BID_SIZE", "ASK_SIZE"];

/// Exact Quote row evidence for one canonical universe member in one verified PIT cut.
///
/// The row digests are SHA-256 over the existing canonical PIT observation-row bytes. They are
/// evidence coordinates, not a durable liquidity EVENT receipt.
#[derive(Debug)]
pub struct NativeReplayQuoteLiquidityEvidenceV2 {
    instrument: InstrumentId,
    row_digests: [BindingDigest; 4],
    values: [(i128, u8); 4],
    event_time_ns: u64,
    initialization_time_ns: u64,
}

impl NativeReplayQuoteLiquidityEvidenceV2 {
    #[must_use]
    pub const fn instrument(&self) -> InstrumentId {
        self.instrument
    }

    #[must_use]
    pub const fn row_digests(&self) -> [BindingDigest; 4] {
        self.row_digests
    }

    /// Bid price, ask price, bid size, ask size in exact stored mantissa/scale order.
    #[must_use]
    pub const fn values(&self) -> [(i128, u8); 4] {
        self.values
    }

    #[must_use]
    pub const fn event_time_ns(&self) -> u64 {
        self.event_time_ns
    }

    #[must_use]
    pub const fn initialization_time_ns(&self) -> u64 {
        self.initialization_time_ns
    }
}

/// One complete two-member BAR/Quote frame, verified from one exact Owner PIT batch.
///
/// This is deliberately a frame ingredient, not a two-frame sequence capability or a persisted
/// receipt. The constructor remains Owner-local and consumes the V1 scheduling seal.
#[derive(Debug)]
pub struct NativeReplayFrameEvidenceV2 {
    snapshot_identity: BindingDigest,
    snapshot_fact_digest: BindingDigest,
    observation_batch_digest: BindingDigest,
    source_frontier_digest: BindingDigest,
    correction_frontier_digest: BindingDigest,
    scheduling_receipt_digest_v1: BindingDigest,
    member_instruments: [InstrumentId; 2],
    frame_time_ns: u64,
    window_end_ns_exclusive: u64,
    bar_row_digests: [[BindingDigest; 5]; 2],
    liquidity: [NativeReplayQuoteLiquidityEvidenceV2; 2],
    bar_types: [BarType; 2],
    data: Vec<Data>,
}

impl NativeReplayFrameEvidenceV2 {
    #[must_use]
    pub const fn snapshot_identity(&self) -> BindingDigest {
        self.snapshot_identity
    }

    #[must_use]
    pub const fn snapshot_fact_digest(&self) -> BindingDigest {
        self.snapshot_fact_digest
    }

    #[must_use]
    pub const fn observation_batch_digest(&self) -> BindingDigest {
        self.observation_batch_digest
    }

    #[must_use]
    pub const fn source_frontier_digest(&self) -> BindingDigest {
        self.source_frontier_digest
    }

    #[must_use]
    pub const fn correction_frontier_digest(&self) -> BindingDigest {
        self.correction_frontier_digest
    }

    #[must_use]
    pub const fn scheduling_receipt_digest_v1(&self) -> BindingDigest {
        self.scheduling_receipt_digest_v1
    }

    #[must_use]
    pub const fn member_instruments(&self) -> [InstrumentId; 2] {
        self.member_instruments
    }

    #[must_use]
    pub const fn frame_time_ns(&self) -> u64 {
        self.frame_time_ns
    }

    #[must_use]
    pub const fn window_end_ns_exclusive(&self) -> u64 {
        self.window_end_ns_exclusive
    }

    #[must_use]
    pub const fn bar_row_digests(&self) -> [[BindingDigest; 5]; 2] {
        self.bar_row_digests
    }

    #[must_use]
    pub const fn liquidity(&self) -> &[NativeReplayQuoteLiquidityEvidenceV2; 2] {
        &self.liquidity
    }

    /// Consumes this Owner evidence, preserving the unchanged V1 native value order.
    #[must_use]
    pub fn into_native_schedule(self) -> ([BarType; 2], Vec<Data>) {
        (self.bar_types, self.data)
    }
}

/// Checks one real frame without claiming a complete two-frame request census.
///
/// Both inputs are move-only or Owner-verified. The V1 seal supplies native price/quantity
/// conversion, schedule validation, and exact `[BAR0, BAR1, QUOTE0, QUOTE1]` selection. This
/// function binds its selected values back to the canonical BAR and Quote row evidence.
///
/// # Errors
///
/// Rejects an incomplete, ambiguous, differently sourced, or out-of-window frame.
#[allow(
    clippy::needless_pass_by_value,
    reason = "Owner evidence is consumed into one frame"
)]
pub(crate) fn verify_native_replay_frame_evidence_v2(
    batch: VerifiedPitObservationBatch,
    schedules: [BarScheduleReadbackV1; 2],
    member_instruments: [InstrumentId; 2],
    frame_time_ns: u64,
    window_end_ns_exclusive: u64,
) -> Result<NativeReplayFrameEvidenceV2, NativeReplaySchedulingErrorV1> {
    if member_instruments[0] >= member_instruments[1] || frame_time_ns >= window_end_ns_exclusive {
        return Err(NativeReplaySchedulingErrorV1::OwnerBindingMismatch);
    }

    let scheduling = seal_native_replay_scheduling_v1(
        batch.clone(),
        schedules,
        member_instruments,
        frame_time_ns,
        window_end_ns_exclusive,
    )?;
    let scheduling_receipt_digest_v1 = scheduling.receipt_digest();
    let (bar_types, data) = scheduling.into_native_schedule();
    let [
        Data::Bar(first_bar),
        Data::Bar(second_bar),
        Data::Quote(first_quote),
        Data::Quote(second_quote),
    ] = data.as_slice()
    else {
        return Err(NativeReplaySchedulingErrorV1::FieldCensusMismatch);
    };
    if first_bar.bar_type.instrument_id() != member_instruments[0]
        || second_bar.bar_type.instrument_id() != member_instruments[1]
        || first_bar.ts_event.as_u64() != frame_time_ns
        || second_bar.ts_event.as_u64() != frame_time_ns
        || first_quote.instrument_id != member_instruments[0]
        || second_quote.instrument_id != member_instruments[1]
        || !(frame_time_ns < first_quote.ts_event.as_u64()
            && first_quote.ts_event.as_u64() < second_quote.ts_event.as_u64()
            && second_quote.ts_event.as_u64() < window_end_ns_exclusive)
        || first_quote.ts_init != first_quote.ts_event
        || second_quote.ts_init != second_quote.ts_event
    {
        return Err(NativeReplaySchedulingErrorV1::EventOrderUnavailable);
    }

    let bar_row_digests = member_instruments.map(|instrument| {
        exact_row_digests::<5>(&batch, instrument, "BAR", frame_time_ns, &BAR_FIELDS)
    });
    let [first_bar_rows, second_bar_rows] = bar_row_digests;
    let liquidity = [
        quote_evidence(&batch, member_instruments[0], first_quote.ts_event.as_u64())?,
        quote_evidence(
            &batch,
            member_instruments[1],
            second_quote.ts_event.as_u64(),
        )?,
    ];

    Ok(NativeReplayFrameEvidenceV2 {
        snapshot_identity: batch.snapshot_identity(),
        snapshot_fact_digest: batch.fact_digest(),
        observation_batch_digest: batch.digest(),
        source_frontier_digest: batch.source_frontier_digest(),
        correction_frontier_digest: batch.correction_frontier_digest(),
        scheduling_receipt_digest_v1,
        member_instruments,
        frame_time_ns,
        window_end_ns_exclusive,
        bar_row_digests: [first_bar_rows?, second_bar_rows?],
        liquidity,
        bar_types,
        data,
    })
}

fn quote_evidence(
    batch: &VerifiedPitObservationBatch,
    instrument: InstrumentId,
    event_time_ns: u64,
) -> Result<NativeReplayQuoteLiquidityEvidenceV2, NativeReplaySchedulingErrorV1> {
    let rows = exact_rows(batch, instrument, "QUOTE", event_time_ns, &QUOTE_FIELDS)?;
    Ok(NativeReplayQuoteLiquidityEvidenceV2 {
        instrument,
        row_digests: rows.map(row_digest),
        values: rows.map(|row| (row.value_mantissa(), row.value_scale())),
        event_time_ns,
        initialization_time_ns: event_time_ns,
    })
}

fn exact_row_digests<const N: usize>(
    batch: &VerifiedPitObservationBatch,
    instrument: InstrumentId,
    data_kind: &str,
    event_time_ns: u64,
    fields: &[&str; N],
) -> Result<[BindingDigest; N], NativeReplaySchedulingErrorV1> {
    Ok(exact_rows(batch, instrument, data_kind, event_time_ns, fields)?.map(row_digest))
}

fn exact_rows<'a, const N: usize>(
    batch: &'a VerifiedPitObservationBatch,
    instrument: InstrumentId,
    data_kind: &str,
    event_time_ns: u64,
    fields: &[&str; N],
) -> Result<[&'a VerifiedPitObservation; N], NativeReplaySchedulingErrorV1> {
    let instrument = instrument.to_string();
    let candidates = batch
        .observations()
        .iter()
        .filter(|row| {
            row.instrument() == instrument
                && row.data_kind() == data_kind
                && row.event_effective() == event_time_ns
                && fields.contains(&row.field())
        })
        .collect::<Vec<_>>();
    if candidates.len() != N {
        return Err(NativeReplaySchedulingErrorV1::FieldCensusMismatch);
    }
    let ordered = fields
        .iter()
        .map(|field| {
            let mut matching = candidates
                .iter()
                .copied()
                .filter(|row| row.field() == *field);
            let row = matching
                .next()
                .ok_or(NativeReplaySchedulingErrorV1::FieldCensusMismatch)?;
            if matching.next().is_some() {
                return Err(NativeReplaySchedulingErrorV1::FieldCensusMismatch);
            }
            Ok(row)
        })
        .collect::<Result<Vec<_>, _>>()?;
    let first = ordered[0];
    if ordered.iter().any(|row| {
        row.channel() != first.channel()
            || row.timeframe() != first.timeframe()
            || row.provider_available() != first.provider_available()
            || row.retrieval() != first.retrieval()
            || row.correction_publication() != first.correction_publication()
            || row.source_binding_identity() != first.source_binding_identity()
            || row.source_frontier_digest() != first.source_frontier_digest()
            || row.instrument_master_digest() != first.instrument_master_digest()
            || row.universe_selection_digest() != first.universe_selection_digest()
            || row.market_semantics_identity() != first.market_semantics_identity()
            || row.correction_stream_identity() != first.correction_stream_identity()
            || row.correction_sequence() != first.correction_sequence()
            || row.correction_frontier_digest() != first.correction_frontier_digest()
    }) {
        return Err(NativeReplaySchedulingErrorV1::OwnerBindingMismatch);
    }
    ordered
        .try_into()
        .map_err(|_| NativeReplaySchedulingErrorV1::FieldCensusMismatch)
}

/// One eligible frame offered to the two-frame census for a sealed request window.
///
/// `frame_ordinal` is the scope-dense position Market Data assigns when it commits the frame's
/// PIT cut. Density is what proves "no skipped eligible frame": the existing correction lineage
/// orders revisions of one request and cannot see a sibling lineage's frame in the same window,
/// which is why `docs/owners/market-data.md` calls for a census rather than reusing it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NativeReplayFrameCensusCandidateV2 {
    pub frame_ordinal: u64,
    pub snapshot_identity: BindingDigest,
    /// Everything both frames must hold in common: the canonical two-member universe, the
    /// Design/role set, the Instrument Master cut, the timeframe, and the venue/account scope.
    pub scope_digest: BindingDigest,
    /// Identifies which correction branch produced this frame at its ordinal.
    pub correction_branch_digest: BindingDigest,
    pub frame_time_ns: u64,
    /// When Market Data observed the frame. Observation after the request's decision cut is
    /// inadmissible however eligible the frame otherwise looks.
    pub observed_decision_cut_ns: u64,
    pub first_bar_event_ns: u64,
    pub last_liquidity_event_ns: u64,
}

/// Why a candidate set cannot become a two-frame profile.
///
/// Every variant is a refusal to issue, never a truncation: the bounded V2 profile is unavailable
/// rather than silently narrowed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NativeReplayFrameCensusRefusalV2 {
    ObservationAfterDecisionCut,
    EligibleFrameCountIsNotTwo,
    DuplicateFrameIdentity,
    AmbiguousCorrectionBranch,
    SkippedEligibleFrame,
    NonIncreasingEventOrder,
    ScopeMismatch,
    LiquidityDoesNotPrecedeSuccessorBar,
}

/// Admits the bounded two-frame profile, or refuses with the exact reason.
///
/// The caller supplies no frame list of its own: this reads a census Market Data resolved for the
/// sealed request window and decision cut. A third eligible frame makes the profile unavailable
/// rather than truncating it to the first two.
///
/// # Errors
///
/// Returns the exact [`NativeReplayFrameCensusRefusalV2`] for the first violated admission rule.
pub fn admit_two_frame_census_v2(
    request_decision_cut_ns: u64,
    window_start_ns: u64,
    window_end_ns_exclusive: u64,
    census: &[NativeReplayFrameCensusCandidateV2],
) -> Result<[&NativeReplayFrameCensusCandidateV2; 2], NativeReplayFrameCensusRefusalV2> {
    if census
        .iter()
        .any(|frame| frame.observed_decision_cut_ns > request_decision_cut_ns)
    {
        return Err(NativeReplayFrameCensusRefusalV2::ObservationAfterDecisionCut);
    }

    let mut eligible: Vec<&NativeReplayFrameCensusCandidateV2> = census
        .iter()
        .filter(|frame| {
            frame.frame_time_ns >= window_start_ns
                && frame.frame_time_ns < window_end_ns_exclusive
        })
        .collect();
    eligible.sort_by_key(|frame| frame.frame_ordinal);

    // Two frames at one ordinal are competing correction branches; the census cannot choose.
    if eligible.windows(2).any(|pair| {
        pair[0].frame_ordinal == pair[1].frame_ordinal
            && pair[0].correction_branch_digest != pair[1].correction_branch_digest
    }) {
        return Err(NativeReplayFrameCensusRefusalV2::AmbiguousCorrectionBranch);
    }

    let [first, second] = match eligible.as_slice() {
        [first, second] => [*first, *second],
        _ => return Err(NativeReplayFrameCensusRefusalV2::EligibleFrameCountIsNotTwo),
    };

    if first.snapshot_identity == second.snapshot_identity {
        return Err(NativeReplayFrameCensusRefusalV2::DuplicateFrameIdentity);
    }
    if second.frame_ordinal != first.frame_ordinal + 1 {
        return Err(NativeReplayFrameCensusRefusalV2::SkippedEligibleFrame);
    }
    if second.frame_time_ns <= first.frame_time_ns {
        return Err(NativeReplayFrameCensusRefusalV2::NonIncreasingEventOrder);
    }
    if first.scope_digest != second.scope_digest {
        return Err(NativeReplayFrameCensusRefusalV2::ScopeMismatch);
    }
    if first.last_liquidity_event_ns >= second.first_bar_event_ns {
        return Err(NativeReplayFrameCensusRefusalV2::LiquidityDoesNotPrecedeSuccessorBar);
    }

    Ok([first, second])
}

/// Domain separator for the per-frame Quote liquidity EVENT receipt.
const QUOTE_LIQUIDITY_RECEIPT_DOMAIN_V2: &[u8] =
    b"market-data.native-replay-quote-liquidity-receipt.v2\0";

/// The canonical per-frame Quote liquidity EVENT receipt.
///
/// `docs/owners/market-data.md` requires each frame to carry its own Owner-verified liquidity, and
/// requires that receipt to seal "the exact Owner-verified Quote row digests, bid/ask prices and
/// sizes, event/initialization times and member order from that frame's PIT cut". Two halves of
/// that already existed and neither sealed the other: [`NativeReplayQuoteLiquidityEvidenceV2`]
/// carries the row digests and the exact stored `(mantissa, scale)` values but is never digested,
/// while the V1 scheduling receipt digests prices and times as Nautilus display strings and binds
/// no row identity at all. This type seals both halves under one domain, against the frame's own
/// PIT cut, so a fill can be authorized by an Owner fact rather than by transported values.
///
/// The bytes are fixed width apart from the two instrument identifiers, which are length-prefixed.
/// Member order is the canonical universe member order and is part of the sealed meaning: the same
/// two members in the opposite order seal to a different digest.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NativeReplayQuoteLiquidityReceiptV2 {
    canonical_bytes: Vec<u8>,
    receipt_digest: BindingDigest,
}

impl NativeReplayQuoteLiquidityReceiptV2 {
    /// Seals one frame's complete two-member Quote liquidity against that frame's PIT cut.
    #[must_use]
    pub fn seal(
        snapshot_identity: BindingDigest,
        snapshot_fact_digest: BindingDigest,
        observation_batch_digest: BindingDigest,
        frame_time_ns: u64,
        window_end_ns_exclusive: u64,
        liquidity: &[NativeReplayQuoteLiquidityEvidenceV2; 2],
    ) -> Self {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(QUOTE_LIQUIDITY_RECEIPT_DOMAIN_V2);
        bytes.extend_from_slice(&2_u16.to_be_bytes());
        bytes.extend_from_slice(&0_u16.to_be_bytes());
        bytes.extend_from_slice(snapshot_identity.as_bytes());
        bytes.extend_from_slice(snapshot_fact_digest.as_bytes());
        bytes.extend_from_slice(observation_batch_digest.as_bytes());
        bytes.extend_from_slice(&frame_time_ns.to_be_bytes());
        bytes.extend_from_slice(&window_end_ns_exclusive.to_be_bytes());
        bytes.push(u8::try_from(liquidity.len()).unwrap_or(u8::MAX));
        for member in liquidity {
            append_liquidity_member(&mut bytes, member);
        }
        let receipt_digest = BindingDigest::from_untrusted_bytes(Sha256::digest(&bytes).into());
        Self {
            canonical_bytes: bytes,
            receipt_digest,
        }
    }

    #[must_use]
    pub fn canonical_bytes(&self) -> &[u8] {
        &self.canonical_bytes
    }

    #[must_use]
    pub const fn receipt_digest(&self) -> BindingDigest {
        self.receipt_digest
    }
}

/// Appends one member in the fixed `BID_PRICE, ASK_PRICE, BID_SIZE, ASK_SIZE` field order.
///
/// Values are the exact stored PIT `(mantissa, scale)` pair rather than any rendered decimal, so
/// the receipt cannot drift with a display convention.
fn append_liquidity_member(bytes: &mut Vec<u8>, member: &NativeReplayQuoteLiquidityEvidenceV2) {
    let instrument = member.instrument().to_string();
    let instrument = instrument.as_bytes();
    bytes.extend_from_slice(
        &u32::try_from(instrument.len())
            .unwrap_or(u32::MAX)
            .to_be_bytes(),
    );
    bytes.extend_from_slice(instrument);
    for digest in member.row_digests() {
        bytes.extend_from_slice(digest.as_bytes());
    }
    for (mantissa, scale) in member.values() {
        bytes.extend_from_slice(&mantissa.to_be_bytes());
        bytes.push(scale);
    }
    bytes.extend_from_slice(&member.event_time_ns().to_be_bytes());
    bytes.extend_from_slice(&member.initialization_time_ns().to_be_bytes());
}

fn row_digest(row: &VerifiedPitObservation) -> BindingDigest {
    BindingDigest::from_untrusted_bytes(Sha256::digest(canonical_observation_bytes(row)).into())
}

#[cfg(test)]
mod quote_liquidity_receipt_tests {
    use rstest::rstest;

    use super::*;

    fn digest(seed: u8) -> BindingDigest {
        BindingDigest::from_untrusted_bytes([seed; 32])
    }

    fn member(instrument: &str, seed: u8, event_time_ns: u64) -> NativeReplayQuoteLiquidityEvidenceV2 {
        NativeReplayQuoteLiquidityEvidenceV2 {
            instrument: InstrumentId::from(instrument),
            row_digests: [digest(seed), digest(seed + 1), digest(seed + 2), digest(seed + 3)],
            values: [(101, 2), (103, 2), (5, 0), (7, 0)],
            event_time_ns,
            initialization_time_ns: event_time_ns,
        }
    }

    fn sealed(liquidity: &[NativeReplayQuoteLiquidityEvidenceV2; 2]) -> NativeReplayQuoteLiquidityReceiptV2 {
        NativeReplayQuoteLiquidityReceiptV2::seal(digest(0x10), digest(0x11), digest(0x12), 900, 1_000, liquidity)
    }

    #[rstest]
    fn the_same_frame_liquidity_seals_to_the_same_receipt() {
        let first = sealed(&[member("AAPL.NASDAQ", 0x20, 910), member("MSFT.NASDAQ", 0x30, 920)]);
        let second = sealed(&[member("AAPL.NASDAQ", 0x20, 910), member("MSFT.NASDAQ", 0x30, 920)]);

        assert_eq!(first, second);
        assert_eq!(first.receipt_digest(), second.receipt_digest());
        assert!(first.canonical_bytes().starts_with(QUOTE_LIQUIDITY_RECEIPT_DOMAIN_V2));
    }

    #[rstest]
    fn member_order_is_part_of_the_sealed_meaning() {
        let forward = sealed(&[member("AAPL.NASDAQ", 0x20, 910), member("MSFT.NASDAQ", 0x30, 920)]);
        let reversed = sealed(&[member("MSFT.NASDAQ", 0x30, 920), member("AAPL.NASDAQ", 0x20, 910)]);

        assert_ne!(forward.receipt_digest(), reversed.receipt_digest());
    }

    #[rstest]
    fn every_sealed_liquidity_coordinate_changes_the_receipt() {
        let base = sealed(&[member("AAPL.NASDAQ", 0x20, 910), member("MSFT.NASDAQ", 0x30, 920)]);

        // A different Owner row identity for the same rendered values.
        let moved_row = sealed(&[member("AAPL.NASDAQ", 0x40, 910), member("MSFT.NASDAQ", 0x30, 920)]);
        assert_ne!(base.receipt_digest(), moved_row.receipt_digest());

        // A different stored price mantissa.
        let mut repriced = member("AAPL.NASDAQ", 0x20, 910);
        repriced.values[0] = (102, 2);
        assert_ne!(
            base.receipt_digest(),
            sealed(&[repriced, member("MSFT.NASDAQ", 0x30, 920)]).receipt_digest()
        );

        // The same mantissa under a different scale is a different price.
        let mut rescaled = member("AAPL.NASDAQ", 0x20, 910);
        rescaled.values[0] = (101, 3);
        assert_ne!(
            base.receipt_digest(),
            sealed(&[rescaled, member("MSFT.NASDAQ", 0x30, 920)]).receipt_digest()
        );

        // A different size.
        let mut resized = member("AAPL.NASDAQ", 0x20, 910);
        resized.values[2] = (6, 0);
        assert_ne!(
            base.receipt_digest(),
            sealed(&[resized, member("MSFT.NASDAQ", 0x30, 920)]).receipt_digest()
        );

        // A different event time, and an initialization time that no longer equals it.
        assert_ne!(
            base.receipt_digest(),
            sealed(&[member("AAPL.NASDAQ", 0x20, 911), member("MSFT.NASDAQ", 0x30, 920)]).receipt_digest()
        );
        let mut reinitialized = member("AAPL.NASDAQ", 0x20, 910);
        reinitialized.initialization_time_ns = 912;
        assert_ne!(
            base.receipt_digest(),
            sealed(&[reinitialized, member("MSFT.NASDAQ", 0x30, 920)]).receipt_digest()
        );
    }

    #[rstest]
    fn the_receipt_binds_its_own_frame_cut_and_window() {
        let liquidity = || [member("AAPL.NASDAQ", 0x20, 910), member("MSFT.NASDAQ", 0x30, 920)];
        let base = sealed(&liquidity());

        for moved in [
            NativeReplayQuoteLiquidityReceiptV2::seal(digest(0x99), digest(0x11), digest(0x12), 900, 1_000, &liquidity()),
            NativeReplayQuoteLiquidityReceiptV2::seal(digest(0x10), digest(0x99), digest(0x12), 900, 1_000, &liquidity()),
            NativeReplayQuoteLiquidityReceiptV2::seal(digest(0x10), digest(0x11), digest(0x99), 900, 1_000, &liquidity()),
            NativeReplayQuoteLiquidityReceiptV2::seal(digest(0x10), digest(0x11), digest(0x12), 901, 1_000, &liquidity()),
            NativeReplayQuoteLiquidityReceiptV2::seal(digest(0x10), digest(0x11), digest(0x12), 900, 1_001, &liquidity()),
        ] {
            assert_ne!(base.receipt_digest(), moved.receipt_digest());
        }
    }
}

#[cfg(test)]
mod frame_census_tests {
    use rstest::rstest;

    use super::*;

    const CUT: u64 = 10_000;
    const WINDOW_START: u64 = 1_000;
    const WINDOW_END: u64 = 2_000;

    fn digest(seed: u8) -> BindingDigest {
        BindingDigest::from_untrusted_bytes([seed; 32])
    }

    fn frame(ordinal: u64, seed: u8, frame_time_ns: u64) -> NativeReplayFrameCensusCandidateV2 {
        NativeReplayFrameCensusCandidateV2 {
            frame_ordinal: ordinal,
            snapshot_identity: digest(seed),
            scope_digest: digest(0x01),
            correction_branch_digest: digest(0x02),
            frame_time_ns,
            observed_decision_cut_ns: CUT - 1,
            first_bar_event_ns: frame_time_ns,
            last_liquidity_event_ns: frame_time_ns + 10,
        }
    }

    fn admit(
        census: &[NativeReplayFrameCensusCandidateV2],
    ) -> Result<[&NativeReplayFrameCensusCandidateV2; 2], NativeReplayFrameCensusRefusalV2> {
        admit_two_frame_census_v2(CUT, WINDOW_START, WINDOW_END, census)
    }

    fn pair() -> Vec<NativeReplayFrameCensusCandidateV2> {
        vec![frame(7, 0x20, 1_100), frame(8, 0x30, 1_500)]
    }

    #[rstest]
    fn a_dense_in_window_pair_is_admitted_in_event_order() {
        let census = pair();
        let [first, second] = admit(&census).expect("bounded two-frame profile");

        assert_eq!(first.frame_ordinal, 7);
        assert_eq!(second.frame_ordinal, 8);
        assert!(first.last_liquidity_event_ns < second.first_bar_event_ns);
    }

    #[rstest]
    #[case::none(vec![])]
    #[case::one(vec![frame(7, 0x20, 1_100)])]
    #[case::three(vec![frame(7, 0x20, 1_100), frame(8, 0x30, 1_400), frame(9, 0x40, 1_700)])]
    fn only_exactly_two_eligible_frames_admit_the_bounded_profile(
        #[case] census: Vec<NativeReplayFrameCensusCandidateV2>,
    ) {
        assert_eq!(
            admit(&census),
            Err(NativeReplayFrameCensusRefusalV2::EligibleFrameCountIsNotTwo)
        );
    }

    #[rstest]
    fn a_gap_in_the_scope_census_is_a_skipped_eligible_frame() {
        let census = vec![frame(7, 0x20, 1_100), frame(9, 0x30, 1_500)];

        assert_eq!(
            admit(&census),
            Err(NativeReplayFrameCensusRefusalV2::SkippedEligibleFrame)
        );
    }

    #[rstest]
    fn two_branches_at_one_ordinal_cannot_be_chosen_between() {
        let mut competing = frame(7, 0x30, 1_500);
        competing.correction_branch_digest = digest(0x99);
        let census = vec![frame(7, 0x20, 1_100), competing];

        assert_eq!(
            admit(&census),
            Err(NativeReplayFrameCensusRefusalV2::AmbiguousCorrectionBranch)
        );
    }

    #[rstest]
    fn a_frame_observed_after_the_decision_cut_is_inadmissible() {
        let mut late = frame(8, 0x30, 1_500);
        late.observed_decision_cut_ns = CUT + 1;
        let census = vec![frame(7, 0x20, 1_100), late];

        assert_eq!(
            admit(&census),
            Err(NativeReplayFrameCensusRefusalV2::ObservationAfterDecisionCut)
        );
    }

    #[rstest]
    fn frames_outside_the_half_open_window_are_not_eligible() {
        // The window is half-open, so its exclusive end is outside it.
        let census = vec![frame(7, 0x20, 1_100), frame(8, 0x30, WINDOW_END)];
        assert_eq!(
            admit(&census),
            Err(NativeReplayFrameCensusRefusalV2::EligibleFrameCountIsNotTwo)
        );

        // ...while its inclusive start is inside it.
        let census = vec![frame(7, 0x20, WINDOW_START), frame(8, 0x30, 1_500)];
        assert!(admit(&census).is_ok());
    }

    #[rstest]
    fn the_successor_must_advance_canonical_event_order() {
        let census = vec![frame(7, 0x20, 1_500), frame(8, 0x30, 1_500)];

        assert_eq!(
            admit(&census),
            Err(NativeReplayFrameCensusRefusalV2::NonIncreasingEventOrder)
        );
    }

    #[rstest]
    fn both_frames_must_hold_the_same_scope() {
        let mut moved = frame(8, 0x30, 1_500);
        moved.scope_digest = digest(0x77);
        let census = vec![frame(7, 0x20, 1_100), moved];

        assert_eq!(
            admit(&census),
            Err(NativeReplayFrameCensusRefusalV2::ScopeMismatch)
        );
    }

    #[rstest]
    fn first_frame_liquidity_must_precede_the_successor_bar() {
        let mut first = frame(7, 0x20, 1_100);
        let second = frame(8, 0x30, 1_500);
        first.last_liquidity_event_ns = second.first_bar_event_ns;

        assert_eq!(
            admit(&[first, second]),
            Err(NativeReplayFrameCensusRefusalV2::LiquidityDoesNotPrecedeSuccessorBar)
        );
    }

    #[rstest]
    fn two_frames_can_never_share_one_snapshot_identity() {
        let mut duplicate = frame(8, 0x20, 1_500);
        duplicate.correction_branch_digest = digest(0x02);
        let census = vec![frame(7, 0x20, 1_100), duplicate];

        assert_eq!(
            admit(&census),
            Err(NativeReplayFrameCensusRefusalV2::DuplicateFrameIdentity)
        );
    }
}
