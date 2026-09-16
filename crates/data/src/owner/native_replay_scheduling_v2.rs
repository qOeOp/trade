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

fn row_digest(row: &VerifiedPitObservation) -> BindingDigest {
    BindingDigest::from_untrusted_bytes(Sha256::digest(canonical_observation_bytes(row)).into())
}
