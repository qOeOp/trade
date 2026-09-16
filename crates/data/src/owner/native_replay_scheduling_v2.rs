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

/// Why a pair of verified frames cannot become a sequence.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NativeReplayFrameSequenceRefusalV2 {
    /// The pair does not hold one canonical universe, timeframe and window between them.
    FramesDoNotShareTheirRequestShape,
    /// The successor repeats the first frame's PIT cut.
    SuccessorRepeatsTheFirstCut,
    /// The successor does not advance canonical event order.
    NonIncreasingEventOrder,
    /// A first-frame liquidity EVENT does not precede the successor's first BAR.
    LiquidityDoesNotPrecedeSuccessorBar,
}

/// The Owner-issued, move-only, request-bound two-frame sequence.
///
/// `docs/owners/market-data.md` names this capability and fixes its shape: exactly two complete
/// two-member BAR frames, each with its own Owner-verified Quote liquidity, the first being the
/// independently re-resolved initial V1 frame and the second issued from a distinct Owner-verified
/// PIT snapshot and observation batch.
///
/// It is move-only on purpose — no `Clone`, no `Deserialize`. A sequence cannot be copied into a
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
    frames: [NativeReplayFrameEvidenceV2; 2],
}

impl NativeReplayFrameSequenceReadbackV2 {
    /// Issues the sequence, or refuses with the exact cross-frame rule that failed.
    ///
    /// # Errors
    ///
    /// Returns [`NativeReplayFrameSequenceRefusalV2`] for the first violated rule.
    pub fn issue(
        request_identity: BindingDigest,
        v1_binding_identity: BindingDigest,
        window_start_ns: u64,
        frames: [NativeReplayFrameEvidenceV2; 2],
        frame_ordinals: [u64; 2],
    ) -> Result<Self, NativeReplayFrameSequenceRefusalV2> {
        let [first, second] = &frames;
        if first.member_instruments() != second.member_instruments()
            || first.window_end_ns_exclusive() != second.window_end_ns_exclusive()
            || first.bar_types() != second.bar_types()
        {
            return Err(NativeReplayFrameSequenceRefusalV2::FramesDoNotShareTheirRequestShape);
        }
        if first.snapshot_identity() == second.snapshot_identity()
            || first.snapshot_fact_digest() == second.snapshot_fact_digest()
            || first.observation_batch_digest() == second.observation_batch_digest()
        {
            return Err(NativeReplayFrameSequenceRefusalV2::SuccessorRepeatsTheFirstCut);
        }
        if second.frame_time_ns() <= first.frame_time_ns() {
            return Err(NativeReplayFrameSequenceRefusalV2::NonIncreasingEventOrder);
        }
        // "All first-frame liquidity EVENTs must precede the second frame's first BAR."
        if first
            .liquidity()
            .iter()
            .any(|member| member.event_time_ns() >= second.frame_time_ns())
        {
            return Err(NativeReplayFrameSequenceRefusalV2::LiquidityDoesNotPrecedeSuccessorBar);
        }

        let window_end_ns_exclusive = first.window_end_ns_exclusive();
        let sealed = seal_native_replay_frame_sequence_v2(
            v1_binding_identity,
            request_identity,
            window_start_ns,
            window_end_ns_exclusive,
            &[
                sequence_frame(first, frame_ordinals[0]),
                sequence_frame(second, frame_ordinals[1]),
            ],
        );
        Ok(Self {
            request_identity,
            v1_binding_identity,
            window_start_ns,
            window_end_ns_exclusive,
            sealed,
            frames,
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
    pub const fn frames(&self) -> &[NativeReplayFrameEvidenceV2; 2] {
        &self.frames
    }

    /// Hands the frames on. The sequence is consumed, never shared.
    #[must_use]
    pub fn into_frames(self) -> [NativeReplayFrameEvidenceV2; 2] {
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

/// Domain separator for the V2 two-frame sequence digest.
const FRAME_SEQUENCE_DIGEST_DOMAIN_V2: &[u8] =
    b"market-data.native-replay-frame-sequence.v2\0";

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
/// Frame order is part of the sealed meaning: the same two frames transposed seal differently, so
/// a sequence cannot be reinterpreted by reordering what it contains. The distinct PIT cuts are
/// committed per frame rather than as a set, so moving a receipt from one cut to the other cannot
/// preserve the digest.
#[must_use]
pub fn seal_native_replay_frame_sequence_v2(
    v1_binding_identity: BindingDigest,
    request_identity: BindingDigest,
    window_start_ns: u64,
    window_end_ns_exclusive: u64,
    frames: &[NativeReplaySequenceFrameV2; 2],
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
/// readback" to be stored "atomically and append-only". Deriving all three here — rather than in
/// the storage adapter — keeps one meaning: the receipt attests the sealed bytes, the outbox
/// publishes that receipt, and the locator is the pair the request already fixes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NativeReplayFrameSequenceCustodyRecordV2 {
    sequence_identity: BindingDigest,
    request_identity: BindingDigest,
    v1_binding_identity: BindingDigest,
    window_start_ns: u64,
    window_end_ns_exclusive: u64,
    first_snapshot_identity: BindingDigest,
    second_snapshot_identity: BindingDigest,
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
        let [first, second] = sequence.frames();
        let (window_start_ns, window_end_ns_exclusive) = sequence.window();
        Self::seal_from_parts(
            sequence.sealed(),
            sequence.request_identity(),
            sequence.v1_binding_identity(),
            window_start_ns,
            window_end_ns_exclusive,
            first.snapshot_identity(),
            second.snapshot_identity(),
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
        second_snapshot_identity: BindingDigest,
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
        receipt_bytes.extend_from_slice(second_snapshot_identity.as_bytes());
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
            second_snapshot_identity,
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
    pub const fn second_snapshot_identity(&self) -> BindingDigest {
        self.second_snapshot_identity
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
    /// The census itself could not be read; nothing is claimed about the window.
    CensusUnavailable,
    /// The census does not agree that the sealed request's frame is the first in this window.
    FirstFrameIsNotTheSealedRequestFrame,
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
