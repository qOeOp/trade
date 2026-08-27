use std::{collections::BTreeMap, error::Error, fmt::Display};

use strategy_factory_program_sdk::lifecycle_v1::{
    ENVELOPE_WIRE_BYTES, EnvelopePayloadV1, EventOrderKeyV1, FillDispositionV1, FillEventV1,
    FillSideV1, LifecycleEnvelopeV1, LifecycleKind, encode_envelope_v1,
};

use super::{DigestV1, IdentityV1, digest, identity, is_zero};
use crate::strategy_replay::adapter::SimExchangeFillObservationV1;

const EVENT_IDENTITY_DOMAIN: &[u8] = b"backtest.strategy-replay.event-identity.v1\0";
const TIMER_SOURCE_DOMAIN: &[u8] = b"backtest.strategy-replay.timer-source.v1\0";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[allow(
    clippy::struct_field_names,
    reason = "the digest suffix makes each source evidence authority explicit"
)]
pub struct LifecycleSourceEvidenceV1 {
    source_receipt_digest: DigestV1,
    source_cut_digest: DigestV1,
    payload_digest: DigestV1,
}

impl LifecycleSourceEvidenceV1 {
    /// Creates the three-part source evidence binding.
    ///
    /// # Errors
    ///
    /// Returns an error if any evidence identity is absent.
    pub fn new(
        source_receipt_digest: DigestV1,
        source_cut_digest: DigestV1,
        payload_digest: DigestV1,
    ) -> Result<Self, SourceNormalizationFaultV1> {
        if is_zero(&source_receipt_digest)
            || is_zero(&source_cut_digest)
            || is_zero(&payload_digest)
        {
            return Err(SourceNormalizationFaultV1::MissingSourceIdentity);
        }
        Ok(Self {
            source_receipt_digest,
            source_cut_digest,
            payload_digest,
        })
    }

    #[must_use]
    pub const fn source_receipt_digest(&self) -> DigestV1 {
        self.source_receipt_digest
    }

    #[must_use]
    pub const fn source_cut_digest(&self) -> DigestV1 {
        self.source_cut_digest
    }

    #[must_use]
    pub const fn payload_digest(&self) -> DigestV1 {
        self.payload_digest
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NormalizedLifecycleEventV1 {
    envelope: LifecycleEnvelopeV1,
    wire: [u8; ENVELOPE_WIRE_BYTES],
    source: LifecycleSourceEvidenceV1,
}

impl NormalizedLifecycleEventV1 {
    /// Constructs a source-bound `START` event.
    ///
    /// # Errors
    ///
    /// Returns an error when identity or ordering evidence is missing or malformed.
    pub fn start(
        replay_identity: DigestV1,
        logical_time_ns: u64,
        event_time_ns: u64,
        owner_sequence: u64,
        source: LifecycleSourceEvidenceV1,
    ) -> Result<Self, SourceNormalizationFaultV1> {
        Self::from_source(
            replay_identity,
            logical_time_ns,
            event_time_ns,
            owner_sequence,
            LifecycleKind::Start,
            EnvelopePayloadV1::Start,
            source,
        )
    }

    /// Constructs a source-bound `BAR` event.
    ///
    /// # Errors
    ///
    /// Returns an error when identity or ordering evidence is missing or malformed.
    pub fn bar(
        replay_identity: DigestV1,
        logical_time_ns: u64,
        event_time_ns: u64,
        owner_sequence: u64,
        source: LifecycleSourceEvidenceV1,
    ) -> Result<Self, SourceNormalizationFaultV1> {
        Self::from_source(
            replay_identity,
            logical_time_ns,
            event_time_ns,
            owner_sequence,
            LifecycleKind::Bar,
            EnvelopePayloadV1::Bar,
            source,
        )
    }

    /// Constructs a deterministic synthetic `TIMER` event without wall-clock input.
    ///
    /// # Errors
    ///
    /// Returns an error when the replay, schedule, or ordering identity is missing.
    pub fn timer(
        replay_identity: DigestV1,
        timer_schedule_digest: DigestV1,
        logical_time_ns: u64,
        event_time_ns: u64,
        owner_sequence: u64,
    ) -> Result<Self, SourceNormalizationFaultV1> {
        if is_zero(&timer_schedule_digest) {
            return Err(SourceNormalizationFaultV1::MissingSourceIdentity);
        }
        let logical = logical_time_ns.to_le_bytes();
        let event = event_time_ns.to_le_bytes();
        let sequence = owner_sequence.to_le_bytes();
        let receipt = digest(
            TIMER_SOURCE_DOMAIN,
            &[&replay_identity, &timer_schedule_digest],
        );
        let cut = digest(TIMER_SOURCE_DOMAIN, &[&timer_schedule_digest, &event]);
        let payload = digest(
            TIMER_SOURCE_DOMAIN,
            &[&replay_identity, &logical, &event, &sequence],
        );
        Self::from_source(
            replay_identity,
            logical_time_ns,
            event_time_ns,
            owner_sequence,
            LifecycleKind::Timer,
            EnvelopePayloadV1::Timer,
            LifecycleSourceEvidenceV1::new(receipt, cut, payload)?,
        )
    }

    /// Constructs a source-bound `STOP` event.
    ///
    /// # Errors
    ///
    /// Returns an error when identity or ordering evidence is missing or malformed.
    pub fn stop(
        replay_identity: DigestV1,
        logical_time_ns: u64,
        event_time_ns: u64,
        owner_sequence: u64,
        source: LifecycleSourceEvidenceV1,
    ) -> Result<Self, SourceNormalizationFaultV1> {
        Self::from_source(
            replay_identity,
            logical_time_ns,
            event_time_ns,
            owner_sequence,
            LifecycleKind::Stop,
            EnvelopePayloadV1::Stop,
            source,
        )
    }

    pub(crate) fn fill(
        replay_identity: DigestV1,
        observation: &SimExchangeFillObservationV1,
    ) -> Result<Self, SourceNormalizationFaultV1> {
        let payload = EnvelopePayloadV1::Fill(FillEventV1 {
            intent_identity: observation.intent_identity(),
            side: observation.side(),
            disposition: observation.disposition(),
            cumulative_filled_units: observation.cumulative_filled_units(),
        });
        Self::from_source(
            replay_identity,
            observation.logical_time_ns(),
            observation.event_time_ns(),
            observation.owner_sequence(),
            LifecycleKind::Fill,
            payload,
            observation.source_evidence(),
        )
    }

    fn from_source(
        replay_identity: DigestV1,
        logical_time_ns: u64,
        event_time_ns: u64,
        owner_sequence: u64,
        kind: LifecycleKind,
        payload: EnvelopePayloadV1,
        source: LifecycleSourceEvidenceV1,
    ) -> Result<Self, SourceNormalizationFaultV1> {
        if is_zero(&replay_identity) {
            return Err(SourceNormalizationFaultV1::MissingReplayIdentity);
        }
        let logical = logical_time_ns.to_le_bytes();
        let event = event_time_ns.to_le_bytes();
        let sequence = owner_sequence.to_le_bytes();
        let kind_byte = [kind as u8];
        let event_identity = identity(
            EVENT_IDENTITY_DOMAIN,
            &[
                &replay_identity,
                &logical,
                &event,
                &kind_byte,
                &sequence,
                &source.source_receipt_digest,
                &source.source_cut_digest,
            ],
        );
        let order_key = EventOrderKeyV1::new(
            logical_time_ns,
            event_time_ns,
            kind,
            owner_sequence,
            event_identity,
        )
        .map_err(|_| SourceNormalizationFaultV1::MissingOrderCoordinate)?;
        let envelope = LifecycleEnvelopeV1::new_bound(order_key, payload)
            .map_err(|_| SourceNormalizationFaultV1::MalformedEnvelope)?;
        let wire = encode_envelope_v1(envelope)
            .map_err(|_| SourceNormalizationFaultV1::MalformedEnvelope)?;
        Ok(Self {
            envelope,
            wire,
            source,
        })
    }

    #[must_use]
    pub const fn envelope(&self) -> LifecycleEnvelopeV1 {
        self.envelope
    }

    #[must_use]
    pub const fn canonical_wire(&self) -> &[u8; ENVELOPE_WIRE_BYTES] {
        &self.wire
    }

    #[must_use]
    pub const fn source_evidence(&self) -> LifecycleSourceEvidenceV1 {
        self.source
    }

    pub(crate) fn canonical_record_bytes(&self) -> [u8; 224] {
        let mut bytes = [0_u8; 224];
        bytes[..128].copy_from_slice(&self.wire);
        bytes[128..160].copy_from_slice(&self.source.source_receipt_digest);
        bytes[160..192].copy_from_slice(&self.source.source_cut_digest);
        bytes[192..224].copy_from_slice(&self.source.payload_digest);
        bytes
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StrategyReplaySourceV1 {
    events: Vec<NormalizedLifecycleEventV1>,
    source_digest: DigestV1,
}

impl StrategyReplaySourceV1 {
    /// Deduplicates exact joins and orders events by the SDK total-order tuple.
    ///
    /// # Errors
    ///
    /// Returns an error when one stable event identity carries conflicting bytes.
    pub fn canonicalize(
        events: impl IntoIterator<Item = NormalizedLifecycleEventV1>,
    ) -> Result<Self, SourceNormalizationFaultV1> {
        let mut by_identity = BTreeMap::<IdentityV1, NormalizedLifecycleEventV1>::new();

        for event in events {
            let event_identity = event.envelope.order_key.event_identity;
            if let Some(existing) = by_identity.get(&event_identity) {
                if existing != &event {
                    return Err(SourceNormalizationFaultV1::ConflictingEventIdentity);
                }
            } else {
                by_identity.insert(event_identity, event);
            }
        }
        let mut events = by_identity.into_values().collect::<Vec<_>>();
        events.sort_by_key(|event| order_tuple(event.envelope.order_key));
        let records = events
            .iter()
            .map(NormalizedLifecycleEventV1::canonical_record_bytes)
            .collect::<Vec<_>>();
        let refs = records
            .iter()
            .map(<[u8; 224]>::as_slice)
            .collect::<Vec<_>>();
        let source_digest = digest(b"backtest.strategy-replay.source.v1\0", &refs);
        Ok(Self {
            events,
            source_digest,
        })
    }

    #[must_use]
    pub fn events(&self) -> &[NormalizedLifecycleEventV1] {
        &self.events
    }

    #[must_use]
    pub const fn source_digest(&self) -> DigestV1 {
        self.source_digest
    }
}

pub(crate) fn order_tuple(key: EventOrderKeyV1) -> (u64, u64, u8, u64, IdentityV1) {
    (
        key.logical_time_ns,
        key.event_time_ns,
        key.kind as u8,
        key.owner_sequence,
        key.event_identity,
    )
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SourceNormalizationFaultV1 {
    MissingReplayIdentity,
    MissingSourceIdentity,
    MissingOrderCoordinate,
    MalformedEnvelope,
    ConflictingEventIdentity,
}

impl Display for SourceNormalizationFaultV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "strategy replay source fault: {self:?}")
    }
}

impl Error for SourceNormalizationFaultV1 {}

pub(crate) const fn fill_side_from_delta(delta_units: i64) -> FillSideV1 {
    if delta_units > 0 {
        FillSideV1::Buy
    } else {
        FillSideV1::Sell
    }
}

pub(crate) const fn valid_terminal_cumulative(
    disposition: FillDispositionV1,
    cumulative: u64,
    requested: u64,
) -> bool {
    match disposition {
        FillDispositionV1::PartiallyFilled => cumulative > 0 && cumulative < requested,
        FillDispositionV1::Filled => cumulative == requested,
        FillDispositionV1::Rejected | FillDispositionV1::Canceled => cumulative < requested,
    }
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::*;

    #[rstest]
    fn conflicting_bytes_for_one_event_identity_fail_closed() {
        let event = NormalizedLifecycleEventV1::bar(
            [4; 32],
            1,
            1,
            1,
            LifecycleSourceEvidenceV1::new([1; 32], [2; 32], [3; 32]).unwrap(),
        )
        .unwrap();
        let conflict = NormalizedLifecycleEventV1::bar(
            [4; 32],
            1,
            1,
            1,
            LifecycleSourceEvidenceV1::new([1; 32], [2; 32], [5; 32]).unwrap(),
        )
        .unwrap();
        assert_eq!(
            event.envelope.order_key.event_identity,
            conflict.envelope.order_key.event_identity
        );
        assert_eq!(
            StrategyReplaySourceV1::canonicalize([event, conflict]).unwrap_err(),
            SourceNormalizationFaultV1::ConflictingEventIdentity
        );
    }
}
