//! Owner-sealed native scheduling projection for one two-member Replay window.
//!
//! The projection consumes one verified PIT batch and two move-only BAR schedule readbacks. It
//! emits exactly two complete BAR signals followed by the first complete Quote for each member.
//! Callers cannot supply prices, quantities, event order, or timestamps.

use std::collections::BTreeMap;

use sha2::{Digest, Sha256};
use thiserror::Error;
use vibe_model::{
    data::{Bar, BarSpecification, BarType, Data, QuoteTick},
    enums::{AggregationSource, BarAggregation, PriceType},
    identifiers::InstrumentId,
    types::{
        fixed::mantissa_exponent_to_fixed_i128,
        price::{Price, PriceRaw},
        quantity::{Quantity, QuantityRaw},
    },
};

use super::{
    bar_schedule::{
        BarScheduleCompletionV1, BarScheduleKindV1, BarScheduleLabelV1, BarScheduleReadbackV1,
        BarScheduleUnitV1,
    },
    pit_snapshot::{VerifiedPitObservation, VerifiedPitObservationBatch},
    source_binding::BindingDigest,
};

const RECEIPT_DOMAIN_V1: &[u8] = b"market-data.native-replay-scheduling-readback.v1\0";
const TARGET_SET_MEMBER_COUNT: usize = 2;
const BAR_FIELDS: [&str; 5] = ["OPEN", "HIGH", "LOW", "CLOSE", "VOLUME"];
const QUOTE_FIELDS: [&str; 4] = ["BID_PRICE", "ASK_PRICE", "BID_SIZE", "ASK_SIZE"];

/// Move-only Market Data authority for the exact native scheduling values of one Replay request.
#[derive(Debug)]
pub struct NativeReplaySchedulingReadbackV1 {
    observation_batch_digest: BindingDigest,
    bar_schedule_digests: [BindingDigest; TARGET_SET_MEMBER_COUNT],
    member_instruments: [InstrumentId; TARGET_SET_MEMBER_COUNT],
    frame_time_ns: u64,
    window_end_ns_exclusive: u64,
    bar_types: [BarType; TARGET_SET_MEMBER_COUNT],
    data: Vec<Data>,
    receipt_digest: BindingDigest,
}

impl NativeReplaySchedulingReadbackV1 {
    #[must_use]
    pub const fn observation_batch_digest(&self) -> BindingDigest {
        self.observation_batch_digest
    }

    #[must_use]
    pub const fn bar_schedule_digests(&self) -> [BindingDigest; TARGET_SET_MEMBER_COUNT] {
        self.bar_schedule_digests
    }

    #[must_use]
    pub const fn member_instruments(&self) -> [InstrumentId; TARGET_SET_MEMBER_COUNT] {
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
    pub const fn receipt_digest(&self) -> BindingDigest {
        self.receipt_digest
    }

    /// Consumes the authority and releases the already-fixed native schedule to its bundle.
    #[must_use]
    pub fn into_native_schedule(self) -> ([BarType; TARGET_SET_MEMBER_COUNT], Vec<Data>) {
        (self.bar_types, self.data)
    }
}

#[derive(Clone, Copy, Debug, Error, Eq, PartialEq)]
pub enum NativeReplaySchedulingErrorV1 {
    #[error("native Replay scheduling Owner bindings mismatch")]
    OwnerBindingMismatch,
    #[error("native Replay scheduling field census is incomplete or ambiguous")]
    FieldCensusMismatch,
    #[error("native Replay scheduling event order is unavailable")]
    EventOrderUnavailable,
    #[error("native Replay scheduling value is not exactly representable")]
    NativeRepresentation,
}

/// Seals one exact `[BAR0, BAR1, QUOTE0, QUOTE1]` native schedule from Owner readbacks.
///
/// # Errors
///
/// Fails when either schedule, member, field census, provenance coordinate, time, or native value
/// is missing, duplicated, mismatched, or not exactly representable.
pub fn seal_native_replay_scheduling_v1(
    batch: VerifiedPitObservationBatch,
    schedules: [BarScheduleReadbackV1; TARGET_SET_MEMBER_COUNT],
    member_instruments: [InstrumentId; TARGET_SET_MEMBER_COUNT],
    frame_time_ns: u64,
    window_end_ns_exclusive: u64,
) -> Result<NativeReplaySchedulingReadbackV1, NativeReplaySchedulingErrorV1> {
    if member_instruments[0] >= member_instruments[1] || frame_time_ns >= window_end_ns_exclusive {
        return Err(NativeReplaySchedulingErrorV1::OwnerBindingMismatch);
    }

    let bar_types = [
        validated_bar_type(&schedules[0], &batch, member_instruments[0], frame_time_ns)?,
        validated_bar_type(&schedules[1], &batch, member_instruments[1], frame_time_ns)?,
    ];
    let first_bar = project_bar(
        &batch,
        member_instruments[0],
        bar_types[0],
        frame_time_ns,
        schedule_timeframe(schedules[0].fact())?,
    )?;
    let second_bar = project_bar(
        &batch,
        member_instruments[1],
        bar_types[1],
        frame_time_ns,
        schedule_timeframe(schedules[1].fact())?,
    )?;
    let first_quote = project_first_quote(
        &batch,
        member_instruments[0],
        frame_time_ns,
        window_end_ns_exclusive,
    )?;
    let second_quote = project_first_quote(
        &batch,
        member_instruments[1],
        first_quote.ts_event.as_u64(),
        window_end_ns_exclusive,
    )?;
    let data = vec![
        Data::Bar(first_bar),
        Data::Bar(second_bar),
        Data::Quote(first_quote),
        Data::Quote(second_quote),
    ];
    let bar_schedule_digests = schedules.each_ref().map(|value| value.digest());
    let receipt_digest = digest_receipt(
        batch.digest(),
        bar_schedule_digests,
        member_instruments,
        frame_time_ns,
        window_end_ns_exclusive,
        &data,
    )?;
    Ok(NativeReplaySchedulingReadbackV1 {
        observation_batch_digest: batch.digest(),
        bar_schedule_digests,
        member_instruments,
        frame_time_ns,
        window_end_ns_exclusive,
        bar_types,
        data,
        receipt_digest,
    })
}

fn validated_bar_type(
    schedule: &BarScheduleReadbackV1,
    batch: &VerifiedPitObservationBatch,
    instrument_id: InstrumentId,
    frame_time_ns: u64,
) -> Result<BarType, NativeReplaySchedulingErrorV1> {
    let fact = schedule.fact();
    if fact.canonical_instrument() != instrument_id.to_string()
        || fact.label() != BarScheduleLabelV1::IntervalClose
        || fact.completion() != BarScheduleCompletionV1::CompleteOnly
        || fact.effective_from() > i128::from(frame_time_ns)
        || fact
            .effective_until()
            .is_some_and(|end| i128::from(frame_time_ns) >= end)
        || fact.cut_effective_instant() != i128::from(frame_time_ns)
        || fact.instrument_master_digest() != batch.instrument_master_digest()
        || fact.market_semantics_identity() != batch.market_semantics_identity()
        || fact.schedule_source_frontier() != batch.source_frontier_digest()
        || fact.schedule_correction_frontier() != batch.correction_frontier_digest()
    {
        return Err(NativeReplaySchedulingErrorV1::OwnerBindingMismatch);
    }
    let aggregation = match (fact.kind(), fact.unit()) {
        (BarScheduleKindV1::FixedInterval, BarScheduleUnitV1::Second) => BarAggregation::Second,
        (BarScheduleKindV1::FixedInterval, BarScheduleUnitV1::Minute) => BarAggregation::Minute,
        (BarScheduleKindV1::FixedInterval, BarScheduleUnitV1::Hour) => BarAggregation::Hour,
        (BarScheduleKindV1::ExchangeSession, BarScheduleUnitV1::ExchangeSessionDay) => {
            BarAggregation::Day
        }
        _ => return Err(NativeReplaySchedulingErrorV1::OwnerBindingMismatch),
    };
    let step = usize::try_from(fact.step())
        .map_err(|_| NativeReplaySchedulingErrorV1::NativeRepresentation)?;
    let specification = BarSpecification::new_checked(step, aggregation, PriceType::Last)
        .map_err(|_| NativeReplaySchedulingErrorV1::NativeRepresentation)?;
    Ok(BarType::new(
        instrument_id,
        specification,
        AggregationSource::External,
    ))
}

fn schedule_timeframe(
    fact: &super::bar_schedule::BarScheduleFactV1,
) -> Result<String, NativeReplaySchedulingErrorV1> {
    let suffix = match fact.unit() {
        BarScheduleUnitV1::Second => "S",
        BarScheduleUnitV1::Minute => "M",
        BarScheduleUnitV1::Hour => "H",
        BarScheduleUnitV1::ExchangeSessionDay => "D",
    };
    Ok(format!("{}{suffix}", fact.step()))
}

fn project_bar(
    batch: &VerifiedPitObservationBatch,
    instrument_id: InstrumentId,
    bar_type: BarType,
    frame_time_ns: u64,
    timeframe: String,
) -> Result<Bar, NativeReplaySchedulingErrorV1> {
    let instrument = instrument_id.to_string();
    let rows = exact_fields(
        batch.observations().iter().filter(|row| {
            row.instrument() == instrument
                && row.data_kind() == "BAR"
                && row.timeframe() == timeframe
                && row.event_effective() == frame_time_ns
        }),
        &BAR_FIELDS,
    )?;
    verify_same_event_coordinate(rows.values().copied())?;
    let open = native_price(rows["OPEN"])?;
    let high = native_price(rows["HIGH"])?;
    let low = native_price(rows["LOW"])?;
    let close = native_price(rows["CLOSE"])?;
    let volume = native_quantity(rows["VOLUME"], true)?;
    if [high, low, close]
        .into_iter()
        .any(|value| value.precision != open.precision)
    {
        return Err(NativeReplaySchedulingErrorV1::NativeRepresentation);
    }
    Bar::new_checked(
        bar_type,
        open,
        high,
        low,
        close,
        volume,
        frame_time_ns.into(),
        frame_time_ns.into(),
    )
    .map_err(|_| NativeReplaySchedulingErrorV1::NativeRepresentation)
}

fn project_first_quote(
    batch: &VerifiedPitObservationBatch,
    instrument_id: InstrumentId,
    after_event_ns: u64,
    window_end_ns_exclusive: u64,
) -> Result<QuoteTick, NativeReplaySchedulingErrorV1> {
    let instrument = instrument_id.to_string();
    let mut by_event = BTreeMap::<u64, Vec<&VerifiedPitObservation>>::new();
    for row in batch.observations().iter().filter(|row| {
        row.instrument() == instrument
            && row.data_kind() == "QUOTE"
            && row.event_effective() > after_event_ns
            && row.event_effective() < window_end_ns_exclusive
            && QUOTE_FIELDS.contains(&row.field())
    }) {
        by_event.entry(row.event_effective()).or_default().push(row);
    }
    for (event_time_ns, candidates) in by_event {
        let mut rows = BTreeMap::new();
        for row in candidates {
            if rows.insert(row.field(), row).is_some() {
                return Err(NativeReplaySchedulingErrorV1::FieldCensusMismatch);
            }
        }
        if rows.len() != QUOTE_FIELDS.len()
            || QUOTE_FIELDS.iter().any(|field| !rows.contains_key(field))
        {
            continue;
        }
        verify_same_event_coordinate(rows.values().copied())?;
        let bid_price = native_price(rows["BID_PRICE"])?;
        let ask_price = native_price(rows["ASK_PRICE"])?;
        let bid_size = native_quantity(rows["BID_SIZE"], false)?;
        let ask_size = native_quantity(rows["ASK_SIZE"], false)?;
        if bid_price > ask_price
            || bid_price.precision != ask_price.precision
            || bid_size.precision != ask_size.precision
        {
            return Err(NativeReplaySchedulingErrorV1::NativeRepresentation);
        }
        return QuoteTick::new_checked(
            instrument_id,
            bid_price,
            ask_price,
            bid_size,
            ask_size,
            event_time_ns.into(),
            event_time_ns.into(),
        )
        .map_err(|_| NativeReplaySchedulingErrorV1::NativeRepresentation);
    }
    Err(NativeReplaySchedulingErrorV1::EventOrderUnavailable)
}

fn exact_fields<'a>(
    rows: impl Iterator<Item = &'a VerifiedPitObservation>,
    required: &[&str],
) -> Result<BTreeMap<&'a str, &'a VerifiedPitObservation>, NativeReplaySchedulingErrorV1> {
    let mut values = BTreeMap::new();
    for row in rows.filter(|row| required.contains(&row.field())) {
        if values.insert(row.field(), row).is_some() {
            return Err(NativeReplaySchedulingErrorV1::FieldCensusMismatch);
        }
    }
    if values.len() != required.len() || required.iter().any(|field| !values.contains_key(field)) {
        return Err(NativeReplaySchedulingErrorV1::FieldCensusMismatch);
    }
    Ok(values)
}

fn verify_same_event_coordinate<'a>(
    mut rows: impl Iterator<Item = &'a VerifiedPitObservation>,
) -> Result<(), NativeReplaySchedulingErrorV1> {
    let first = rows
        .next()
        .ok_or(NativeReplaySchedulingErrorV1::FieldCensusMismatch)?;
    if rows.any(|row| {
        row.instrument() != first.instrument()
            || row.channel() != first.channel()
            || row.data_kind() != first.data_kind()
            || row.timeframe() != first.timeframe()
            || row.event_effective() != first.event_effective()
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
    Ok(())
}

fn native_price(row: &VerifiedPitObservation) -> Result<Price, NativeReplaySchedulingErrorV1> {
    if row.value_mantissa() <= 0 {
        return Err(NativeReplaySchedulingErrorV1::NativeRepresentation);
    }
    let raw = native_raw(row)?;
    Price::from_raw_checked(
        PriceRaw::try_from(raw).map_err(|_| NativeReplaySchedulingErrorV1::NativeRepresentation)?,
        row.value_scale(),
    )
    .map_err(|_| NativeReplaySchedulingErrorV1::NativeRepresentation)
}

fn native_quantity(
    row: &VerifiedPitObservation,
    allow_zero: bool,
) -> Result<Quantity, NativeReplaySchedulingErrorV1> {
    if row.value_mantissa() < 0 || (!allow_zero && row.value_mantissa() == 0) {
        return Err(NativeReplaySchedulingErrorV1::NativeRepresentation);
    }
    let raw = native_raw(row)?;
    Quantity::from_raw_checked(
        QuantityRaw::try_from(raw)
            .map_err(|_| NativeReplaySchedulingErrorV1::NativeRepresentation)?,
        row.value_scale(),
    )
    .map_err(|_| NativeReplaySchedulingErrorV1::NativeRepresentation)
}

fn native_raw(row: &VerifiedPitObservation) -> Result<i128, NativeReplaySchedulingErrorV1> {
    let exponent = i8::try_from(row.value_scale())
        .map(|scale| -scale)
        .map_err(|_| NativeReplaySchedulingErrorV1::NativeRepresentation)?;
    mantissa_exponent_to_fixed_i128(row.value_mantissa(), exponent, row.value_scale())
        .map_err(|_| NativeReplaySchedulingErrorV1::NativeRepresentation)
}

fn digest_receipt(
    batch_digest: BindingDigest,
    schedule_digests: [BindingDigest; TARGET_SET_MEMBER_COUNT],
    instruments: [InstrumentId; TARGET_SET_MEMBER_COUNT],
    frame_time_ns: u64,
    window_end_ns_exclusive: u64,
    data: &[Data],
) -> Result<BindingDigest, NativeReplaySchedulingErrorV1> {
    let mut hasher = Sha256::new();
    hasher.update(RECEIPT_DOMAIN_V1);
    hasher.update(batch_digest.as_bytes());
    for digest in schedule_digests {
        hasher.update(digest.as_bytes());
    }
    for instrument in instruments {
        hash_text(&mut hasher, &instrument.to_string())?;
    }
    hasher.update(frame_time_ns.to_be_bytes());
    hasher.update(window_end_ns_exclusive.to_be_bytes());
    for value in data {
        match value {
            Data::Bar(bar) => {
                hasher.update([1]);
                hash_text(&mut hasher, &bar.bar_type.to_string())?;
                for price in [bar.open, bar.high, bar.low, bar.close] {
                    hash_text(&mut hasher, &price.to_string())?;
                }
                hash_text(&mut hasher, &bar.volume.to_string())?;
                hasher.update(bar.ts_event.as_u64().to_be_bytes());
                hasher.update(bar.ts_init.as_u64().to_be_bytes());
            }
            Data::Quote(quote) => {
                hasher.update([2]);
                hash_text(&mut hasher, &quote.instrument_id.to_string())?;
                for price in [quote.bid_price, quote.ask_price] {
                    hash_text(&mut hasher, &price.to_string())?;
                }
                for quantity in [quote.bid_size, quote.ask_size] {
                    hash_text(&mut hasher, &quantity.to_string())?;
                }
                hasher.update(quote.ts_event.as_u64().to_be_bytes());
                hasher.update(quote.ts_init.as_u64().to_be_bytes());
            }
            _ => return Err(NativeReplaySchedulingErrorV1::FieldCensusMismatch),
        }
    }
    Ok(BindingDigest::from_untrusted_bytes(
        hasher.finalize().into(),
    ))
}

fn hash_text(hasher: &mut Sha256, value: &str) -> Result<(), NativeReplaySchedulingErrorV1> {
    let length = u64::try_from(value.len())
        .map_err(|_| NativeReplaySchedulingErrorV1::NativeRepresentation)?;
    hasher.update(length.to_be_bytes());
    hasher.update(value.as_bytes());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::owner::{
        bar_schedule::{BarScheduleCutV1, BarScheduleFactV1, BarScheduleReceiptV1},
        pit_snapshot::{
            UntrustedCorrectionPublicationTime, UntrustedEventEffectiveTime,
            UntrustedPitSnapshotTimeEvidence, UntrustedProviderAvailableTime,
            UntrustedRetrievalTime, UntrustedSnapshotDecisionCut,
        },
    };

    fn digest(value: u8) -> BindingDigest {
        BindingDigest::from_untrusted_bytes([value; 32])
    }

    fn row(
        instrument: &str,
        data_kind: &str,
        timeframe: &str,
        field: &str,
        mantissa: i128,
        scale: u8,
        event: u64,
    ) -> VerifiedPitObservation {
        VerifiedPitObservation {
            symbolic_key: format!("{instrument}.{field}"),
            member_key: instrument.to_owned(),
            instrument: instrument.to_owned(),
            channel: "MARKET".to_owned(),
            data_kind: data_kind.to_owned(),
            timeframe: timeframe.to_owned(),
            field: field.to_owned(),
            value_mantissa: mantissa,
            value_scale: scale,
            event_effective: event,
            provider_available: event,
            retrieval: event,
            correction_publication: event,
            source_binding_identity: digest(3),
            source_frontier_digest: digest(4),
            instrument_master_digest: digest(5),
            universe_selection_digest: digest(6),
            market_semantics_identity: digest(7),
            correction_stream_identity: "market-corrections".to_owned(),
            correction_sequence: 1,
            correction_frontier_digest: digest(8),
        }
    }

    fn rows_for(instrument: &str, quote_event: u64) -> Vec<VerifiedPitObservation> {
        let mut rows = Vec::new();
        for (field, mantissa, scale) in [
            ("OPEN", 10_000, 2),
            ("HIGH", 10_100, 2),
            ("LOW", 9_900, 2),
            ("CLOSE", 10_050, 2),
            ("VOLUME", 1_000, 0),
        ] {
            rows.push(row(instrument, "BAR", "1M", field, mantissa, scale, 100));
        }
        for (field, mantissa, scale) in [
            ("BID_PRICE", 10_000, 2),
            ("ASK_PRICE", 10_001, 2),
            ("BID_SIZE", 100, 0),
            ("ASK_SIZE", 100, 0),
        ] {
            rows.push(row(
                instrument,
                "QUOTE",
                "TICK",
                field,
                mantissa,
                scale,
                quote_event,
            ));
        }
        rows
    }

    fn batch(rows: Vec<VerifiedPitObservation>) -> VerifiedPitObservationBatch {
        VerifiedPitObservationBatch {
            request_identity: digest(10),
            request_digest: digest(11),
            snapshot_identity: digest(12),
            fact_digest: digest(13),
            source_binding_identity: digest(3),
            source_binding_lineage_root: digest(14),
            source_binding_lineage_version: 1,
            source_frontier_digest: digest(4),
            correction_frontier_digest: digest(8),
            instrument_master_digest: digest(5),
            universe_selection_digest: digest(6),
            market_semantics_identity: digest(7),
            time_evidence: UntrustedPitSnapshotTimeEvidence {
                event_effective: UntrustedEventEffectiveTime::from_untrusted(100, "clock", "epoch"),
                provider_available: UntrustedProviderAvailableTime::from_untrusted(
                    100, "clock", "epoch",
                ),
                retrieval: UntrustedRetrievalTime::from_untrusted(100, "clock", "epoch"),
                correction_publication: Some(UntrustedCorrectionPublicationTime::from_untrusted(
                    100, "clock", "epoch",
                )),
                decision_cut: UntrustedSnapshotDecisionCut::from_untrusted(200, "clock", "epoch"),
                monotonic_sequence: 1,
                restart_continuity_digest: digest(15),
                skew_bound: 1,
                uncertainty_bound: 1,
                observed_at: 200,
                valid_through: 300,
            },
            digest: digest(16),
            observations: rows.into_boxed_slice(),
        }
    }

    fn schedule(instrument: &str, identity: u8) -> BarScheduleReadbackV1 {
        let fact_identity = digest(identity);
        let cut_identity = digest(identity + 20);
        let fact = BarScheduleFactV1 {
            canonical_instrument: instrument.to_owned(),
            predecessor_fact_digest: None,
            effective_from: 0,
            effective_until: None,
            kind: BarScheduleKindV1::FixedInterval,
            step: 1,
            unit: BarScheduleUnitV1::Minute,
            anchor_identity: digest(30),
            calendar_identity: digest(31),
            session_identity: digest(32),
            time_zone_identity: digest(33),
            label: BarScheduleLabelV1::IntervalClose,
            completion: BarScheduleCompletionV1::CompleteOnly,
            instrument_master_digest: digest(5),
            instrument_master_fact_digest: digest(identity + 40),
            instrument_master_cut_digest: digest(34),
            market_semantics_identity: digest(7),
            schedule_source_frontier: digest(4),
            schedule_correction_frontier: digest(8),
            cut_effective_instant: 100,
            canonical_bytes: vec![identity],
            identity: fact_identity,
        };
        BarScheduleReadbackV1 {
            fact,
            cut: BarScheduleCutV1 {
                fact_digest: fact_identity,
                canonical_instrument: instrument.to_owned(),
                effective_instant: 100,
                instrument_master_digest: digest(5),
                instrument_master_fact_digest: digest(identity + 40),
                instrument_master_cut_digest: digest(34),
                market_semantics_identity: digest(7),
                source_frontier: digest(4),
                correction_frontier: digest(8),
                canonical_bytes: vec![identity + 1],
                identity: cut_identity,
            },
            receipt: BarScheduleReceiptV1 {
                fact_digest: fact_identity,
                cut_digest: cut_identity,
                store_generation_identity: digest(35),
                store_append_sequence: 1,
                canonical_bytes: vec![identity + 2],
                identity: digest(identity + 21),
            },
            canonical_bytes: vec![identity + 3],
            identity: digest(identity + 22),
        }
    }

    #[test]
    fn seals_exact_two_bar_then_two_quote_schedule() {
        let first = InstrumentId::from("AAA-PERP.SIM");
        let second = InstrumentId::from("BBB-PERP.SIM");
        let mut rows = rows_for("AAA-PERP.SIM", 101);
        rows.extend(rows_for("BBB-PERP.SIM", 102));

        let readback = seal_native_replay_scheduling_v1(
            batch(rows),
            [schedule("AAA-PERP.SIM", 40), schedule("BBB-PERP.SIM", 41)],
            [first, second],
            100,
            200,
        )
        .unwrap();

        assert_eq!(readback.member_instruments(), [first, second]);
        assert_ne!(
            readback.receipt_digest(),
            BindingDigest::from_untrusted_bytes([0; 32])
        );
        let (_, data) = readback.into_native_schedule();
        assert!(matches!(
            data.as_slice(),
            [Data::Bar(_), Data::Bar(_), Data::Quote(_), Data::Quote(_)]
        ));
    }

    #[test]
    fn missing_quote_field_cannot_mint_scheduling_authority() {
        let first = InstrumentId::from("AAA-PERP.SIM");
        let second = InstrumentId::from("BBB-PERP.SIM");
        let mut rows = rows_for("AAA-PERP.SIM", 101);
        rows.extend(
            rows_for("BBB-PERP.SIM", 102)
                .into_iter()
                .filter(|row| row.field() != "ASK_SIZE"),
        );

        assert_eq!(
            seal_native_replay_scheduling_v1(
                batch(rows),
                [schedule("AAA-PERP.SIM", 40), schedule("BBB-PERP.SIM", 41)],
                [first, second],
                100,
                200,
            )
            .unwrap_err(),
            NativeReplaySchedulingErrorV1::EventOrderUnavailable
        );
    }

    #[test]
    fn duplicate_quote_field_cannot_be_skipped_for_a_later_event() {
        let first = InstrumentId::from("AAA-PERP.SIM");
        let second = InstrumentId::from("BBB-PERP.SIM");
        let mut rows = rows_for("AAA-PERP.SIM", 101);
        let duplicate = rows
            .iter()
            .find(|row| row.field() == "BID_PRICE")
            .unwrap()
            .clone();
        rows.push(duplicate);
        rows.extend(rows_for("BBB-PERP.SIM", 102));

        assert_eq!(
            seal_native_replay_scheduling_v1(
                batch(rows),
                [schedule("AAA-PERP.SIM", 40), schedule("BBB-PERP.SIM", 41)],
                [first, second],
                100,
                200,
            )
            .unwrap_err(),
            NativeReplaySchedulingErrorV1::FieldCensusMismatch
        );
    }
}
