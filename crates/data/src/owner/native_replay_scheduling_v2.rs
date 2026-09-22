//! Verified ingredients for a native Replay frame sequence, and the sequence they make.
//!
//! One frame can be checked against an Owner-verified PIT batch and the unchanged V1 native
//! scheduling seal, and a sequence can be issued from frames that are already verified. The
//! durable request-window frame census those frames would be enumerated from exists, and so does
//! the sequence receipt/outbox custody. What has no caller is the step between them: nothing
//! resolves a window's census rows into the frame evidence this module's issuer takes.

#![allow(
    dead_code,
    reason = "the frame verifier and issuer wait for the resolver that would feed them"
)]

use std::collections::BTreeSet;

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
/// This is deliberately a frame ingredient, not a sequence capability or a persisted
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
    liquidity_receipt: NativeReplayQuoteLiquidityReceiptV2,
    bar_types: [BarType; 2],
    data: Vec<Data>,
}

impl NativeReplayFrameEvidenceV2 {
    #[must_use]
    pub const fn snapshot_identity(&self) -> BindingDigest {
        self.snapshot_identity
    }

    /// The sealed liquidity EVENT receipt for this frame's own PIT cut.
    ///
    /// A frame that verified always carries this; there is no path that produces frame evidence
    /// with unsealed liquidity.
    #[must_use]
    pub const fn liquidity_receipt(&self) -> &NativeReplayQuoteLiquidityReceiptV2 {
        &self.liquidity_receipt
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

    /// The two canonical BAR types this frame scheduled, in member order.
    #[must_use]
    pub const fn bar_types(&self) -> &[BarType; 2] {
        &self.bar_types
    }

    /// Consumes this Owner evidence, preserving the unchanged V1 native value order.
    #[must_use]
    pub fn into_native_schedule(self) -> ([BarType; 2], Vec<Data>) {
        (self.bar_types, self.data)
    }
}

/// Checks one real frame without claiming a complete request-window census.
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
        liquidity_receipt: NativeReplayQuoteLiquidityReceiptV2::seal(
            batch.snapshot_identity(),
            batch.fact_digest(),
            batch.digest(),
            frame_time_ns,
            window_end_ns_exclusive,
            &liquidity,
        ),
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

/// Why verified frames cannot become a sequence.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NativeReplayFrameSequenceRefusalV2 {
    /// Fewer than two frames: nothing bounds the liquidity of the frame a run would consume.
    SequenceCannotBoundItsLastFrame,
    /// The frames do not hold one canonical universe, timeframe and window between them.
    FramesDoNotShareTheirRequestShape,
    /// A frame repeats an earlier frame's PIT cut.
    SuccessorRepeatsTheFirstCut,
    /// A frame does not advance canonical event order.
    NonIncreasingEventOrder,
    /// A frame's liquidity EVENT does not precede the next frame's first BAR.
    LiquidityDoesNotPrecedeSuccessorBar,
}

/// The Owner-issued, move-only, request-bound frame sequence.
///
/// `docs/owners/market-data.md` names this capability and fixes its shape: the window's complete
/// two-member BAR frames, never fewer than two, each with its own Owner-verified Quote liquidity,
/// the first being the independently re-resolved initial V1 frame and every later one issued from
/// a distinct Owner-verified PIT snapshot and observation batch.
///
/// It is move-only on purpose - no `Clone`, no `Deserialize`. A sequence cannot be copied into a
/// second consumer or reconstructed from transported bytes; it is handed over once, by the Owner
/// that verified it.
///
/// Construction is the only place the cross-frame invariants are checked, so a value of this type
/// existing *is* the proof that they hold.
#[derive(Debug)]
pub struct NativeReplayFrameSequenceReadbackV2 {
    request_identity: BindingDigest,
    v1_binding_identity: BindingDigest,
    window_start_ns: u64,
    window_end_ns_exclusive: u64,
    sealed: SealedNativeReplayFrameSequenceV2,
    frames: Vec<NativeReplayFrameEvidenceV2>,
}

impl NativeReplayFrameSequenceReadbackV2 {
    /// Issues the sequence, or refuses with the exact cross-frame rule that failed.
    ///
    /// Each frame arrives with the census ordinal it was committed at, paired rather than in a
    /// second list, so a sequence whose ordinals do not line up with its frames cannot be spelled.
    /// Every rule here held between the two frames of a pair and holds between every neighbouring
    /// pair, except distinctness, which is asked of the whole sequence: two frames repeating one
    /// PIT cut are one frame counted twice however far apart the window puts them.
    ///
    /// # Errors
    ///
    /// Returns [`NativeReplayFrameSequenceRefusalV2`] for the first violated rule.
    pub fn issue(
        request_identity: BindingDigest,
        v1_binding_identity: BindingDigest,
        window_start_ns: u64,
        frames: Vec<(NativeReplayFrameEvidenceV2, u64)>,
    ) -> Result<Self, NativeReplayFrameSequenceRefusalV2> {
        let Some(((first, _), rest)) = frames.split_first() else {
            return Err(NativeReplayFrameSequenceRefusalV2::SequenceCannotBoundItsLastFrame);
        };

        if rest.is_empty() {
            return Err(NativeReplayFrameSequenceRefusalV2::SequenceCannotBoundItsLastFrame);
        }

        if rest.iter().any(|(frame, _)| {
            frame.member_instruments() != first.member_instruments()
                || frame.window_end_ns_exclusive() != first.window_end_ns_exclusive()
                || frame.bar_types() != first.bar_types()
        }) {
            return Err(NativeReplayFrameSequenceRefusalV2::FramesDoNotShareTheirRequestShape);
        }
        let mut cuts = BTreeSet::new();

        if frames.iter().any(|(frame, _)| {
            !cuts.insert((
                frame.snapshot_identity(),
                frame.snapshot_fact_digest(),
                frame.observation_batch_digest(),
            ))
        }) || frames.len()
            != frames
                .iter()
                .map(|(frame, _)| frame.snapshot_identity())
                .collect::<BTreeSet<_>>()
                .len()
        {
            return Err(NativeReplayFrameSequenceRefusalV2::SuccessorRepeatsTheFirstCut);
        }

        for pair in frames.windows(2) {
            let (earlier, later) = (&pair[0].0, &pair[1].0);

            if later.frame_time_ns() <= earlier.frame_time_ns() {
                return Err(NativeReplayFrameSequenceRefusalV2::NonIncreasingEventOrder);
            }

            // "All of a frame's liquidity EVENTs must precede the next frame's first BAR."
            if earlier
                .liquidity()
                .iter()
                .any(|member| member.event_time_ns() >= later.frame_time_ns())
            {
                return Err(
                    NativeReplayFrameSequenceRefusalV2::LiquidityDoesNotPrecedeSuccessorBar,
                );
            }
        }
        let window_end_ns_exclusive = first.window_end_ns_exclusive();
        let sealed_frames = frames
            .iter()
            .map(|(frame, ordinal)| sequence_frame(frame, *ordinal))
            .collect::<Vec<_>>();
        let sealed = seal_native_replay_frame_sequence_v2(
            v1_binding_identity,
            request_identity,
            window_start_ns,
            window_end_ns_exclusive,
            &sealed_frames,
        );
        Ok(Self {
            request_identity,
            v1_binding_identity,
            window_start_ns,
            window_end_ns_exclusive,
            sealed,
            frames: frames.into_iter().map(|(frame, _)| frame).collect(),
        })
    }

    #[must_use]
    pub fn sequence_digest(&self) -> BindingDigest {
        self.sealed.sequence_digest()
    }

    /// The exact bytes custody stores so a replay can return history rather than a re-derivation.
    #[must_use]
    pub fn sealed(&self) -> &SealedNativeReplayFrameSequenceV2 {
        &self.sealed
    }

    #[must_use]
    pub const fn request_identity(&self) -> BindingDigest {
        self.request_identity
    }

    #[must_use]
    pub const fn v1_binding_identity(&self) -> BindingDigest {
        self.v1_binding_identity
    }

    #[must_use]
    pub const fn window(&self) -> (u64, u64) {
        (self.window_start_ns, self.window_end_ns_exclusive)
    }

    #[must_use]
    pub fn frames(&self) -> &[NativeReplayFrameEvidenceV2] {
        &self.frames
    }

    /// Hands the frames on. The sequence is consumed, never shared.
    #[must_use]
    pub fn into_frames(self) -> Vec<NativeReplayFrameEvidenceV2> {
        self.frames
    }
}

fn sequence_frame(
    frame: &NativeReplayFrameEvidenceV2,
    frame_ordinal: u64,
) -> NativeReplaySequenceFrameV2 {
    NativeReplaySequenceFrameV2 {
        frame_ordinal,
        snapshot_identity: frame.snapshot_identity(),
        snapshot_fact_digest: frame.snapshot_fact_digest(),
        frame_receipt_digest: frame.observation_batch_digest(),
        scheduling_receipt_digest_v1: frame.scheduling_receipt_digest_v1(),
        liquidity_receipt_digest: frame.liquidity_receipt().receipt_digest(),
    }
}

/// Domain separator for the V2 frame sequence digest.
const FRAME_SEQUENCE_DIGEST_DOMAIN_V2: &[u8] = b"market-data.native-replay-frame-sequence.v2\0";

/// The sealed constituents of one frame, in the order the sequence commits to them.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct NativeReplaySequenceFrameV2 {
    pub frame_ordinal: u64,
    pub snapshot_identity: BindingDigest,
    pub snapshot_fact_digest: BindingDigest,
    pub frame_receipt_digest: BindingDigest,
    pub scheduling_receipt_digest_v1: BindingDigest,
    pub liquidity_receipt_digest: BindingDigest,
}

/// The V2 sequence digest.
///
/// `docs/architecture/strategy-factory.md` requires the V2 meaning to include "the V1 binding
/// identity, both ordered frame, native scheduling and liquidity EVENT receipt digests, their
/// distinct PIT cuts and a domain-separated sequence digest covering all of them", and
/// `docs/owners/market-data.md` requires it to bind "both complete frame/schedule/liquidity
/// receipt sets in canonical order and the request identity/window".
///
/// Frame order is part of the sealed meaning: the same frames transposed seal differently, so
/// a sequence cannot be reinterpreted by reordering what it contains. The frame count is sealed
/// ahead of the frames, so a longer sequence can never be read as a shorter one with trailing
/// bytes. The distinct PIT cuts are committed per frame rather than as a set, so moving a receipt
/// from one cut to another cannot preserve the digest.
#[must_use]
pub fn seal_native_replay_frame_sequence_v2(
    v1_binding_identity: BindingDigest,
    request_identity: BindingDigest,
    window_start_ns: u64,
    window_end_ns_exclusive: u64,
    frames: &[NativeReplaySequenceFrameV2],
) -> SealedNativeReplayFrameSequenceV2 {
    let mut bytes = Vec::new();
    bytes.extend_from_slice(FRAME_SEQUENCE_DIGEST_DOMAIN_V2);
    bytes.extend_from_slice(&2_u16.to_be_bytes());
    bytes.extend_from_slice(&0_u16.to_be_bytes());
    bytes.extend_from_slice(v1_binding_identity.as_bytes());
    bytes.extend_from_slice(request_identity.as_bytes());
    bytes.extend_from_slice(&window_start_ns.to_be_bytes());
    bytes.extend_from_slice(&window_end_ns_exclusive.to_be_bytes());
    bytes.push(u8::try_from(frames.len()).unwrap_or(u8::MAX));
    for frame in frames {
        bytes.extend_from_slice(&frame.frame_ordinal.to_be_bytes());
        bytes.extend_from_slice(frame.snapshot_identity.as_bytes());
        bytes.extend_from_slice(frame.snapshot_fact_digest.as_bytes());
        bytes.extend_from_slice(frame.frame_receipt_digest.as_bytes());
        bytes.extend_from_slice(frame.scheduling_receipt_digest_v1.as_bytes());
        bytes.extend_from_slice(frame.liquidity_receipt_digest.as_bytes());
    }
    SealedNativeReplayFrameSequenceV2 {
        sequence_digest: BindingDigest::from_untrusted_bytes(Sha256::digest(&bytes).into()),
        canonical_bytes: bytes,
    }
}

/// One sealed sequence: the canonical bytes and the digest taken over exactly those bytes.
///
/// Custody stores the bytes. A replay that re-derived them would return whatever today's code
/// produces, which is not the same claim as returning the history that was sealed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SealedNativeReplayFrameSequenceV2 {
    canonical_bytes: Vec<u8>,
    sequence_digest: BindingDigest,
}

impl SealedNativeReplayFrameSequenceV2 {
    #[must_use]
    pub fn canonical_bytes(&self) -> &[u8] {
        &self.canonical_bytes
    }

    #[must_use]
    pub const fn sequence_digest(&self) -> BindingDigest {
        self.sequence_digest
    }
}

/// Domain separating the sequence receipt from the sequence bytes it attests.
pub const FRAME_SEQUENCE_RECEIPT_DOMAIN_V2: &[u8] =
    b"market-data.native-replay-frame-sequence-receipt.v2\0";

/// Domain separating the outbox payload from the receipt it publishes.
pub const FRAME_SEQUENCE_OUTBOX_DOMAIN_V2: &[u8] =
    b"market-data.native-replay-frame-sequence-outbox.v2\0";

/// Everything custody must store for one sealed V2 sequence, derived once from the sealed bytes.
///
/// `docs/owners/market-data.md` requires the sequence's "receipt/outbox and exact-locator
/// readback" to be stored "atomically and append-only". Deriving all three here - rather than in
/// the storage adapter - keeps one meaning: the receipt attests the sealed bytes, the outbox
/// publishes that receipt, and the locator is the pair the request already fixes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NativeReplayFrameSequenceCustodyRecordV2 {
    sequence_identity: BindingDigest,
    request_identity: BindingDigest,
    v1_binding_identity: BindingDigest,
    window_start_ns: u64,
    window_end_ns_exclusive: u64,
    first_snapshot_identity: BindingDigest,
    last_snapshot_identity: BindingDigest,
    sequence_bytes: Vec<u8>,
    receipt_identity: BindingDigest,
    receipt_bytes: Vec<u8>,
    outbox_identity: BindingDigest,
    outbox_payload: Vec<u8>,
}

impl NativeReplayFrameSequenceCustodyRecordV2 {
    /// Derives the custody record from an issued sequence.
    #[must_use]
    pub fn seal(sequence: &NativeReplayFrameSequenceReadbackV2) -> Self {
        let frames = sequence.frames();
        // The locator is the window's two ends. Every frame between them is in the sealed bytes,
        // so the record never has to grow a column per frame to stay exact. An issued sequence is
        // never shorter than two frames, so these are always two different cuts.
        let (Some(first), Some(last)) = (frames.first(), frames.last()) else {
            unreachable!("an issued sequence is never empty")
        };
        let (window_start_ns, window_end_ns_exclusive) = sequence.window();
        Self::seal_from_parts(
            sequence.sealed(),
            sequence.request_identity(),
            sequence.v1_binding_identity(),
            window_start_ns,
            window_end_ns_exclusive,
            first.snapshot_identity(),
            last.snapshot_identity(),
        )
    }

    /// Derives the custody record from sealed bytes and the coordinates they were sealed over.
    #[must_use]
    pub fn seal_from_parts(
        sealed: &SealedNativeReplayFrameSequenceV2,
        request_identity: BindingDigest,
        v1_binding_identity: BindingDigest,
        window_start_ns: u64,
        window_end_ns_exclusive: u64,
        first_snapshot_identity: BindingDigest,
        last_snapshot_identity: BindingDigest,
    ) -> Self {
        let sequence_identity = sealed.sequence_digest();
        let mut receipt_bytes = Vec::new();
        receipt_bytes.extend_from_slice(FRAME_SEQUENCE_RECEIPT_DOMAIN_V2);
        receipt_bytes.extend_from_slice(sequence_identity.as_bytes());
        receipt_bytes.extend_from_slice(request_identity.as_bytes());
        receipt_bytes.extend_from_slice(v1_binding_identity.as_bytes());
        receipt_bytes.extend_from_slice(&window_start_ns.to_be_bytes());
        receipt_bytes.extend_from_slice(&window_end_ns_exclusive.to_be_bytes());
        receipt_bytes.extend_from_slice(first_snapshot_identity.as_bytes());
        receipt_bytes.extend_from_slice(last_snapshot_identity.as_bytes());
        let receipt_identity =
            BindingDigest::from_untrusted_bytes(Sha256::digest(&receipt_bytes).into());

        let mut outbox_payload = Vec::new();
        outbox_payload.extend_from_slice(FRAME_SEQUENCE_OUTBOX_DOMAIN_V2);
        outbox_payload.extend_from_slice(sequence_identity.as_bytes());
        outbox_payload.extend_from_slice(receipt_identity.as_bytes());
        let outbox_identity =
            BindingDigest::from_untrusted_bytes(Sha256::digest(&outbox_payload).into());

        Self {
            sequence_identity,
            request_identity,
            v1_binding_identity,
            window_start_ns,
            window_end_ns_exclusive,
            first_snapshot_identity,
            last_snapshot_identity,
            sequence_bytes: sealed.canonical_bytes().to_vec(),
            receipt_identity,
            receipt_bytes,
            outbox_identity,
            outbox_payload,
        }
    }

    #[must_use]
    pub const fn sequence_identity(&self) -> BindingDigest {
        self.sequence_identity
    }

    #[must_use]
    pub const fn request_identity(&self) -> BindingDigest {
        self.request_identity
    }

    #[must_use]
    pub const fn v1_binding_identity(&self) -> BindingDigest {
        self.v1_binding_identity
    }

    #[must_use]
    pub const fn window_start_ns(&self) -> u64 {
        self.window_start_ns
    }

    #[must_use]
    pub const fn window_end_ns_exclusive(&self) -> u64 {
        self.window_end_ns_exclusive
    }

    #[must_use]
    pub const fn first_snapshot_identity(&self) -> BindingDigest {
        self.first_snapshot_identity
    }

    #[must_use]
    /// The last frame's PIT cut. Storage calls this column `second_snapshot_identity`, which was
    /// its exact meaning while a sequence was a pair and is its last frame now.
    pub const fn last_snapshot_identity(&self) -> BindingDigest {
        self.last_snapshot_identity
    }

    #[must_use]
    pub fn sequence_bytes(&self) -> &[u8] {
        &self.sequence_bytes
    }

    #[must_use]
    pub const fn receipt_identity(&self) -> BindingDigest {
        self.receipt_identity
    }

    #[must_use]
    pub fn receipt_bytes(&self) -> &[u8] {
        &self.receipt_bytes
    }

    #[must_use]
    pub const fn outbox_identity(&self) -> BindingDigest {
        self.outbox_identity
    }

    #[must_use]
    pub fn outbox_payload(&self) -> &[u8] {
        &self.outbox_payload
    }
}

/// Why custody refused a V2 sequence.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NativeReplayFrameSequenceCustodyRefusalV2 {
    /// Custody could not be reached or read; nothing was decided.
    CustodyUnavailable,
    /// The request already holds a sequence whose sealed meaning differs. Nothing was written.
    SequenceConflict,
}

/// One eligible frame offered to the census for a sealed request window.
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

/// Why a candidate set cannot become an admitted sequence.
///
/// Every variant is a refusal to issue, never a truncation: the bounded V2 profile is unavailable
/// rather than silently narrowed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NativeReplayFrameCensusRefusalV2 {
    /// The census itself could not be read; nothing is claimed about the window.
    CensusUnavailable,
    /// The census does not agree that the sealed request's frame is the first in this window.
    FirstFrameIsNotTheSealedRequestFrame,
    ObservationAfterDecisionCut,
    EligibleFrameCountIsBelowTwo,
    DuplicateFrameIdentity,
    AmbiguousCorrectionBranch,
    SkippedEligibleFrame,
    NonIncreasingEventOrder,
    ScopeMismatch,
    LiquidityDoesNotPrecedeSuccessorBar,
}

/// The frames one request window admits, in canonical order.
///
/// The last admitted frame is not consumed. It is there to bound the liquidity of the frame before
/// it, which is the whole reason a pair needed a second frame, so the type keeps the two apart
/// rather than leaving a consumer to remember which one it may run.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AdmittedNativeReplayFrameSequenceV2<'a> {
    consumed: Vec<&'a NativeReplayFrameCensusCandidateV2>,
    bounding_successor: &'a NativeReplayFrameCensusCandidateV2,
}

impl<'a> AdmittedNativeReplayFrameSequenceV2<'a> {
    /// The frames a run consumes, in canonical order. Never empty.
    #[must_use]
    pub fn consumed(&self) -> &[&'a NativeReplayFrameCensusCandidateV2] {
        &self.consumed
    }

    /// The frame that bounds the last consumed frame's liquidity and is never itself consumed.
    #[must_use]
    pub const fn bounding_successor(&self) -> &'a NativeReplayFrameCensusCandidateV2 {
        self.bounding_successor
    }
}

/// Admits the window's frame sequence, or refuses with the exact reason.
///
/// The caller supplies no frame list of its own: this reads a census Market Data resolved for the
/// sealed request window and decision cut. A window holding more than two eligible frames is a
/// longer sequence rather than an unavailable profile, because refusing it was only ever a refusal
/// to silently truncate, and admitting all of them truncates nothing. Every other rule is what it
/// was: each one held between the two frames of a pair, and each one now holds between every
/// neighbouring pair, so a longer window admits nothing a pair would not have.
///
/// # Errors
///
/// Returns the exact [`NativeReplayFrameCensusRefusalV2`] for the first violated admission rule.
pub fn admit_frame_census_v2(
    request_decision_cut_ns: u64,
    window_start_ns: u64,
    window_end_ns_exclusive: u64,
    census: &[NativeReplayFrameCensusCandidateV2],
) -> Result<AdmittedNativeReplayFrameSequenceV2<'_>, NativeReplayFrameCensusRefusalV2> {
    if census
        .iter()
        .any(|frame| frame.observed_decision_cut_ns > request_decision_cut_ns)
    {
        return Err(NativeReplayFrameCensusRefusalV2::ObservationAfterDecisionCut);
    }

    let mut eligible: Vec<&NativeReplayFrameCensusCandidateV2> = census
        .iter()
        .filter(|frame| {
            frame.frame_time_ns >= window_start_ns && frame.frame_time_ns < window_end_ns_exclusive
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
    let mut identities = BTreeSet::new();

    // Distinctness is asked of the whole sequence, not only of neighbours: two frames sharing an
    // identity are the same frame counted twice however far apart the census puts them.
    if eligible
        .iter()
        .any(|frame| !identities.insert(frame.snapshot_identity))
    {
        return Err(NativeReplayFrameCensusRefusalV2::DuplicateFrameIdentity);
    }

    for pair in eligible.windows(2) {
        let (first, second) = (pair[0], pair[1]);

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
    }
    let Some((bounding_successor, consumed)) = eligible.split_last() else {
        return Err(NativeReplayFrameCensusRefusalV2::EligibleFrameCountIsBelowTwo);
    };

    if consumed.is_empty() {
        return Err(NativeReplayFrameCensusRefusalV2::EligibleFrameCountIsBelowTwo);
    }
    Ok(AdmittedNativeReplayFrameSequenceV2 {
        consumed: consumed.to_vec(),
        bounding_successor,
    })
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

    fn member(
        instrument: &str,
        seed: u8,
        event_time_ns: u64,
    ) -> NativeReplayQuoteLiquidityEvidenceV2 {
        NativeReplayQuoteLiquidityEvidenceV2 {
            instrument: InstrumentId::from(instrument),
            row_digests: [
                digest(seed),
                digest(seed + 1),
                digest(seed + 2),
                digest(seed + 3),
            ],
            values: [(101, 2), (103, 2), (5, 0), (7, 0)],
            event_time_ns,
            initialization_time_ns: event_time_ns,
        }
    }

    fn sealed(
        liquidity: &[NativeReplayQuoteLiquidityEvidenceV2; 2],
    ) -> NativeReplayQuoteLiquidityReceiptV2 {
        NativeReplayQuoteLiquidityReceiptV2::seal(
            digest(0x10),
            digest(0x11),
            digest(0x12),
            900,
            1_000,
            liquidity,
        )
    }

    #[rstest]
    fn the_same_frame_liquidity_seals_to_the_same_receipt() {
        let first = sealed(&[
            member("AAPL.NASDAQ", 0x20, 910),
            member("MSFT.NASDAQ", 0x30, 920),
        ]);
        let second = sealed(&[
            member("AAPL.NASDAQ", 0x20, 910),
            member("MSFT.NASDAQ", 0x30, 920),
        ]);

        assert_eq!(first, second);
        assert_eq!(first.receipt_digest(), second.receipt_digest());
        assert!(
            first
                .canonical_bytes()
                .starts_with(QUOTE_LIQUIDITY_RECEIPT_DOMAIN_V2)
        );
    }

    #[rstest]
    fn member_order_is_part_of_the_sealed_meaning() {
        let forward = sealed(&[
            member("AAPL.NASDAQ", 0x20, 910),
            member("MSFT.NASDAQ", 0x30, 920),
        ]);
        let reversed = sealed(&[
            member("MSFT.NASDAQ", 0x30, 920),
            member("AAPL.NASDAQ", 0x20, 910),
        ]);

        assert_ne!(forward.receipt_digest(), reversed.receipt_digest());
    }

    #[rstest]
    fn every_sealed_liquidity_coordinate_changes_the_receipt() {
        let base = sealed(&[
            member("AAPL.NASDAQ", 0x20, 910),
            member("MSFT.NASDAQ", 0x30, 920),
        ]);

        // A different Owner row identity for the same rendered values.
        let moved_row = sealed(&[
            member("AAPL.NASDAQ", 0x40, 910),
            member("MSFT.NASDAQ", 0x30, 920),
        ]);
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
            sealed(&[
                member("AAPL.NASDAQ", 0x20, 911),
                member("MSFT.NASDAQ", 0x30, 920)
            ])
            .receipt_digest()
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
        let liquidity = || {
            [
                member("AAPL.NASDAQ", 0x20, 910),
                member("MSFT.NASDAQ", 0x30, 920),
            ]
        };
        let base = sealed(&liquidity());

        for moved in [
            NativeReplayQuoteLiquidityReceiptV2::seal(
                digest(0x99),
                digest(0x11),
                digest(0x12),
                900,
                1_000,
                &liquidity(),
            ),
            NativeReplayQuoteLiquidityReceiptV2::seal(
                digest(0x10),
                digest(0x99),
                digest(0x12),
                900,
                1_000,
                &liquidity(),
            ),
            NativeReplayQuoteLiquidityReceiptV2::seal(
                digest(0x10),
                digest(0x11),
                digest(0x99),
                900,
                1_000,
                &liquidity(),
            ),
            NativeReplayQuoteLiquidityReceiptV2::seal(
                digest(0x10),
                digest(0x11),
                digest(0x12),
                901,
                1_000,
                &liquidity(),
            ),
            NativeReplayQuoteLiquidityReceiptV2::seal(
                digest(0x10),
                digest(0x11),
                digest(0x12),
                900,
                1_001,
                &liquidity(),
            ),
        ] {
            assert_ne!(base.receipt_digest(), moved.receipt_digest());
        }
    }
}

#[cfg(test)]
mod frame_sequence_tests {
    use rstest::rstest;
    use vibe_model::{
        data::BarSpecification,
        enums::{AggregationSource, BarAggregation, PriceType},
    };

    use super::*;

    const WINDOW_START: u64 = 1_000;
    const WINDOW_END: u64 = 2_000;

    fn digest(seed: u8) -> BindingDigest {
        BindingDigest::from_untrusted_bytes([seed; 32])
    }

    fn instruments() -> [InstrumentId; 2] {
        [
            InstrumentId::from("AAA-PERP.SIM"),
            InstrumentId::from("BBB-PERP.SIM"),
        ]
    }

    fn bar_types() -> [BarType; 2] {
        instruments().map(|instrument| {
            BarType::new(
                instrument,
                BarSpecification::new(1, BarAggregation::Minute, PriceType::Last),
                AggregationSource::External,
            )
        })
    }

    fn liquidity_member(
        instrument: InstrumentId,
        seed: u8,
        event_time_ns: u64,
    ) -> NativeReplayQuoteLiquidityEvidenceV2 {
        NativeReplayQuoteLiquidityEvidenceV2 {
            instrument,
            row_digests: [
                digest(seed),
                digest(seed.wrapping_add(1)),
                digest(seed.wrapping_add(2)),
                digest(seed.wrapping_add(3)),
            ],
            values: [(101, 2), (103, 2), (5, 0), (7, 0)],
            event_time_ns,
            initialization_time_ns: event_time_ns,
        }
    }

    /// One already-verified frame.
    ///
    /// `issue` takes frames the Owner has verified and checks only what holds between them, so
    /// these are written rather than resolved: what a resolver adds is the inside of a frame, and
    /// no rule here reads it. A fixture that resolved them would prove the resolver, not this.
    fn frame(seed: u8, frame_time_ns: u64) -> NativeReplayFrameEvidenceV2 {
        let [first, second] = instruments();
        let liquidity = [
            liquidity_member(first, seed, frame_time_ns + 1),
            liquidity_member(second, seed.wrapping_add(4), frame_time_ns + 2),
        ];
        let liquidity_receipt = NativeReplayQuoteLiquidityReceiptV2::seal(
            digest(seed),
            digest(seed.wrapping_add(1)),
            digest(seed.wrapping_add(2)),
            frame_time_ns,
            WINDOW_END,
            &liquidity,
        );
        NativeReplayFrameEvidenceV2 {
            snapshot_identity: digest(seed),
            snapshot_fact_digest: digest(seed.wrapping_add(1)),
            observation_batch_digest: digest(seed.wrapping_add(2)),
            source_frontier_digest: digest(0xA0),
            correction_frontier_digest: digest(0xA1),
            scheduling_receipt_digest_v1: digest(seed.wrapping_add(3)),
            member_instruments: instruments(),
            frame_time_ns,
            window_end_ns_exclusive: WINDOW_END,
            bar_row_digests: [[digest(seed); 5], [digest(seed.wrapping_add(1)); 5]],
            liquidity,
            liquidity_receipt,
            bar_types: bar_types(),
            data: Vec::new(),
        }
    }

    fn run(specs: &[(u8, u64, u64)]) -> Vec<(NativeReplayFrameEvidenceV2, u64)> {
        specs
            .iter()
            .map(|(seed, frame_time_ns, ordinal)| (frame(*seed, *frame_time_ns), *ordinal))
            .collect()
    }

    fn issue(
        frames: Vec<(NativeReplayFrameEvidenceV2, u64)>,
    ) -> Result<NativeReplayFrameSequenceReadbackV2, NativeReplayFrameSequenceRefusalV2> {
        NativeReplayFrameSequenceReadbackV2::issue(digest(0x01), digest(0x02), WINDOW_START, frames)
    }

    fn three() -> Vec<(NativeReplayFrameEvidenceV2, u64)> {
        run(&[(0x20, 1_100, 7), (0x40, 1_400, 8), (0x60, 1_700, 9)])
    }

    #[rstest]
    fn a_sequence_longer_than_a_pair_is_issued_and_seals_its_own_order() {
        let sequence = issue(three()).expect("a dense in-window sequence");

        assert_eq!(sequence.frames().len(), 3);
        assert_eq!(sequence.window(), (WINDOW_START, WINDOW_END));
        assert_ne!(sequence.sequence_digest(), digest(0));

        // The same three PIT cuts, each at a different position in the window, seal differently:
        // a sequence cannot be reinterpreted by reordering what it contains.
        let transposed = issue(run(&[(0x20, 1_100, 7), (0x60, 1_400, 8), (0x40, 1_700, 9)]))
            .expect("a dense in-window sequence");
        assert_ne!(sequence.sequence_digest(), transposed.sequence_digest());
    }

    #[rstest]
    #[case::none(vec![])]
    #[case::one(run(&[(0x20, 1_100, 7)]))]
    fn a_sequence_with_nothing_to_bound_its_last_frame_is_refused(
        #[case] frames: Vec<(NativeReplayFrameEvidenceV2, u64)>,
    ) {
        assert_eq!(
            issue(frames).err(),
            Some(NativeReplayFrameSequenceRefusalV2::SequenceCannotBoundItsLastFrame)
        );
    }

    /// The rules read every frame, not only the opening pair.
    #[rstest]
    fn a_third_frame_that_leaves_the_request_shape_is_refused() {
        let mut frames = three();
        frames[2].0.window_end_ns_exclusive = WINDOW_END + 1;

        assert_eq!(
            issue(frames).err(),
            Some(NativeReplayFrameSequenceRefusalV2::FramesDoNotShareTheirRequestShape)
        );
    }

    #[rstest]
    fn a_pit_cut_repeated_far_apart_is_one_frame_counted_twice() {
        let mut frames = three();
        frames[2].0.snapshot_identity = frames[0].0.snapshot_identity;

        assert_eq!(
            issue(frames).err(),
            Some(NativeReplayFrameSequenceRefusalV2::SuccessorRepeatsTheFirstCut)
        );
    }

    #[rstest]
    fn canonical_event_order_must_advance_at_every_step() {
        let mut frames = three();
        frames[2].0.frame_time_ns = frames[1].0.frame_time_ns;

        assert_eq!(
            issue(frames).err(),
            Some(NativeReplayFrameSequenceRefusalV2::NonIncreasingEventOrder)
        );
    }

    #[rstest]
    fn liquidity_must_precede_the_next_frames_bar_at_every_step() {
        let mut frames = three();
        let successor_bar = frames[2].0.frame_time_ns;
        frames[1].0.liquidity[1].event_time_ns = successor_bar;

        assert_eq!(
            issue(frames).err(),
            Some(NativeReplayFrameSequenceRefusalV2::LiquidityDoesNotPrecedeSuccessorBar)
        );
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
    ) -> Result<AdmittedNativeReplayFrameSequenceV2<'_>, NativeReplayFrameCensusRefusalV2> {
        admit_frame_census_v2(CUT, WINDOW_START, WINDOW_END, census)
    }

    fn ordinals(sequence: &AdmittedNativeReplayFrameSequenceV2<'_>) -> (Vec<u64>, u64) {
        (
            sequence
                .consumed()
                .iter()
                .map(|frame| frame.frame_ordinal)
                .collect(),
            sequence.bounding_successor().frame_ordinal,
        )
    }

    fn pair() -> Vec<NativeReplayFrameCensusCandidateV2> {
        vec![frame(7, 0x20, 1_100), frame(8, 0x30, 1_500)]
    }

    fn run(ordinals: &[(u64, u8, u64)]) -> Vec<NativeReplayFrameCensusCandidateV2> {
        ordinals
            .iter()
            .map(|(ordinal, seed, frame_time_ns)| frame(*ordinal, *seed, *frame_time_ns))
            .collect()
    }

    #[rstest]
    fn a_dense_in_window_pair_is_admitted_in_event_order() {
        let census = pair();
        let sequence = admit(&census).expect("bounded frame sequence");

        assert_eq!(ordinals(&sequence), (vec![7], 8));
        assert!(
            sequence.consumed()[0].last_liquidity_event_ns
                < sequence.bounding_successor().first_bar_event_ns
        );
    }

    /// A window holding more frames is a longer sequence, and the last one still only bounds.
    #[rstest]
    fn a_longer_window_consumes_every_frame_but_the_bounding_successor() {
        let census = run(&[
            (7, 0x20, 1_100),
            (8, 0x30, 1_400),
            (9, 0x40, 1_700),
            (10, 0x50, 1_900),
        ]);
        let sequence = admit(&census).expect("bounded frame sequence");

        assert_eq!(ordinals(&sequence), (vec![7, 8, 9], 10));
    }

    #[rstest]
    #[case::none(vec![])]
    #[case::one(vec![frame(7, 0x20, 1_100)])]
    fn a_window_with_nothing_to_bound_the_first_frame_consumes_nothing(
        #[case] census: Vec<NativeReplayFrameCensusCandidateV2>,
    ) {
        assert_eq!(
            admit(&census),
            Err(NativeReplayFrameCensusRefusalV2::EligibleFrameCountIsBelowTwo)
        );
    }

    /// Every neighbouring pair is checked, not only the first: an admissible opening pair vouches
    /// for nothing that comes after it.
    #[rstest]
    fn a_defect_after_an_admissible_opening_pair_still_refuses() {
        let mut gapped = run(&[(7, 0x20, 1_100), (8, 0x30, 1_400), (10, 0x40, 1_700)]);
        assert_eq!(
            admit(&gapped),
            Err(NativeReplayFrameCensusRefusalV2::SkippedEligibleFrame)
        );

        gapped[2].frame_ordinal = 9;
        gapped[2].scope_digest = digest(0x77);
        assert_eq!(
            admit(&gapped),
            Err(NativeReplayFrameCensusRefusalV2::ScopeMismatch)
        );

        let mut overlapping = run(&[(7, 0x20, 1_100), (8, 0x30, 1_400), (9, 0x40, 1_700)]);
        overlapping[1].last_liquidity_event_ns = overlapping[2].first_bar_event_ns;
        assert_eq!(
            admit(&overlapping),
            Err(NativeReplayFrameCensusRefusalV2::LiquidityDoesNotPrecedeSuccessorBar)
        );
    }

    /// Distinctness is asked of the whole sequence, not only of neighbours.
    #[rstest]
    fn one_identity_repeated_far_apart_is_still_one_frame_counted_twice() {
        let mut repeated = run(&[(7, 0x20, 1_100), (8, 0x30, 1_400), (9, 0x40, 1_700)]);
        repeated[2].snapshot_identity = repeated[0].snapshot_identity;

        assert_eq!(
            admit(&repeated),
            Err(NativeReplayFrameCensusRefusalV2::DuplicateFrameIdentity)
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
            Err(NativeReplayFrameCensusRefusalV2::EligibleFrameCountIsBelowTwo)
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
    fn neighbouring_frames_must_hold_the_same_scope() {
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
    fn neighbouring_frames_can_never_share_one_snapshot_identity() {
        let mut duplicate = frame(8, 0x20, 1_500);
        duplicate.correction_branch_digest = digest(0x02);
        let census = vec![frame(7, 0x20, 1_100), duplicate];

        assert_eq!(
            admit(&census),
            Err(NativeReplayFrameCensusRefusalV2::DuplicateFrameIdentity)
        );
    }
}

#[cfg(test)]
mod frame_sequence_digest_tests {
    use rstest::rstest;

    use super::*;

    fn digest(seed: u8) -> BindingDigest {
        BindingDigest::from_untrusted_bytes([seed; 32])
    }

    fn frame(ordinal: u64, seed: u8) -> NativeReplaySequenceFrameV2 {
        NativeReplaySequenceFrameV2 {
            frame_ordinal: ordinal,
            snapshot_identity: digest(seed),
            snapshot_fact_digest: digest(seed + 1),
            frame_receipt_digest: digest(seed + 2),
            scheduling_receipt_digest_v1: digest(seed + 3),
            liquidity_receipt_digest: digest(seed + 4),
        }
    }

    fn sealed(frames: &[NativeReplaySequenceFrameV2; 2]) -> BindingDigest {
        seal_native_replay_frame_sequence_v2(digest(0x01), digest(0x02), 1_000, 2_000, frames)
            .sequence_digest()
    }

    fn pair() -> [NativeReplaySequenceFrameV2; 2] {
        [frame(7, 0x20), frame(8, 0x40)]
    }

    #[rstest]
    fn the_same_sequence_seals_identically() {
        assert_eq!(sealed(&pair()), sealed(&pair()));
    }

    #[rstest]
    fn frame_order_is_part_of_the_sealed_meaning() {
        let [first, second] = pair();
        assert_ne!(sealed(&pair()), sealed(&[second, first]));
    }

    #[rstest]
    fn every_constituent_of_every_frame_is_covered() {
        let base = sealed(&pair());

        for mutate in [
            |f: &mut NativeReplaySequenceFrameV2| f.frame_ordinal += 1,
            |f: &mut NativeReplaySequenceFrameV2| f.snapshot_identity = digest(0x99),
            |f: &mut NativeReplaySequenceFrameV2| f.snapshot_fact_digest = digest(0x99),
            |f: &mut NativeReplaySequenceFrameV2| f.frame_receipt_digest = digest(0x99),
            |f: &mut NativeReplaySequenceFrameV2| f.scheduling_receipt_digest_v1 = digest(0x99),
            |f: &mut NativeReplaySequenceFrameV2| f.liquidity_receipt_digest = digest(0x99),
        ] {
            // Moving the constituent on either frame must move the sequence digest.
            let mut only_first = pair();
            mutate(&mut only_first[0]);
            assert_ne!(base, sealed(&only_first));

            let mut only_second = pair();
            mutate(&mut only_second[1]);
            assert_ne!(base, sealed(&only_second));
        }
    }

    #[rstest]
    fn a_receipt_moved_between_the_two_cuts_cannot_preserve_the_digest() {
        // The cuts are committed per frame, not as a set, so swapping one frame's liquidity
        // receipt onto the other is a different sequence even though the multiset is unchanged.
        let mut swapped = pair();
        let first_liquidity = swapped[0].liquidity_receipt_digest;
        swapped[0].liquidity_receipt_digest = swapped[1].liquidity_receipt_digest;
        swapped[1].liquidity_receipt_digest = first_liquidity;

        assert_ne!(sealed(&pair()), sealed(&swapped));
    }

    #[rstest]
    fn the_sequence_binds_its_v1_binding_request_and_window() {
        let base = sealed(&pair());
        let frames = pair();

        for moved in [
            seal_native_replay_frame_sequence_v2(digest(0x99), digest(0x02), 1_000, 2_000, &frames)
                .sequence_digest(),
            seal_native_replay_frame_sequence_v2(digest(0x01), digest(0x99), 1_000, 2_000, &frames)
                .sequence_digest(),
            seal_native_replay_frame_sequence_v2(digest(0x01), digest(0x02), 1_001, 2_000, &frames)
                .sequence_digest(),
            seal_native_replay_frame_sequence_v2(digest(0x01), digest(0x02), 1_000, 2_001, &frames)
                .sequence_digest(),
        ] {
            assert_ne!(base, moved);
        }
    }
}
