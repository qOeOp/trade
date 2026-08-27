use std::{error::Error, fmt::Display};

use strategy_factory_program_sdk::lifecycle_v1::{
    LifecycleKind, PROPOSAL_WIRE_BYTES, TRACE_BYTES, TRACE_SCHEMA_VERSION, decode_envelope_v1,
    decode_proposal_v1,
};

use super::{DigestV1, digest, is_zero};
use crate::{
    result::CanonicalBacktestResult,
    strategy_replay::{
        adapter::{LifecycleProgramHost, StrategyReplayAdapterV1},
        source::order_tuple,
    },
};

const MAGIC: [u8; 4] = *b"BSR1";
const CODEC_VERSION: u16 = 1;
const HEADER_BYTES: usize = 428;
const MAX_RECORDS: usize = 1_000_000;
const MAX_RESTART_BUNDLE_BYTES: usize = 16 * 1024 * 1024;
const MAX_INNER_RESULT_BYTES: usize = 512 * 1024 * 1024;
const TERMINAL_DOMAIN: &[u8] = b"backtest.strategy-replay.result.v1\0";
const INNER_DOMAIN: &[u8] = b"backtest.strategy-replay.inner-result.v1\0";
const SOURCE_DOMAIN: &[u8] = b"backtest.strategy-replay.source.v1\0";

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CanonicalStrategyReplayResultV1 {
    bytes: Vec<u8>,
    terminal_digest: DigestV1,
    inner_result: CanonicalBacktestResult,
}

impl CanonicalStrategyReplayResultV1 {
    #[must_use]
    pub fn to_bytes(&self) -> Vec<u8> {
        self.bytes.clone()
    }

    #[must_use]
    pub const fn terminal_digest(&self) -> DigestV1 {
        self.terminal_digest
    }

    #[must_use]
    pub const fn inner_result(&self) -> &CanonicalBacktestResult {
        &self.inner_result
    }

    /// Decodes and validates the complete canonical replay receipt.
    ///
    /// # Errors
    ///
    /// Returns an error for noncanonical bytes, identity/order/checkpoint mismatches, an invalid
    /// inner result, any digest mismatch, or the unavailable engine-owned consistency proof.
    pub fn from_slice(bytes: &[u8]) -> Result<Self, StrategyReplayResultFaultV1> {
        if bytes.len() < HEADER_BYTES + 32 + 8 + 32 {
            return Err(StrategyReplayResultFaultV1::InvalidLength);
        }
        let mut reader = Reader::new(bytes);
        if reader.take_array::<4>()? != MAGIC {
            return Err(StrategyReplayResultFaultV1::InvalidMagic);
        }

        if reader.u16()? != CODEC_VERSION {
            return Err(StrategyReplayResultFaultV1::UnsupportedVersion);
        }
        reader.zeroes(2)?;
        let header_digests = (0..13)
            .map(|_| reader.take_array::<32>())
            .collect::<Result<Vec<_>, _>>()?;

        if header_digests.iter().any(|value| is_zero(value)) {
            return Err(StrategyReplayResultFaultV1::MissingIdentity);
        }
        let declared_source_digest = header_digests[4];
        let record_count = usize::try_from(reader.u32()?)
            .map_err(|_| StrategyReplayResultFaultV1::InvalidLength)?;
        if record_count == 0 || record_count > MAX_RECORDS {
            return Err(StrategyReplayResultFaultV1::InvalidRecordCount);
        }

        let mut source_records = Vec::with_capacity(record_count);
        let mut last_order = None;
        let mut previous_checkpoint = None;
        let mut first_kind = None;
        let mut last_kind = None;

        for _ in 0..record_count {
            let event_record = reader.take(224)?;
            let envelope = decode_envelope_v1(&event_record[..128])
                .map_err(|_| StrategyReplayResultFaultV1::MalformedEvent)?;
            if event_record[128..].chunks_exact(32).any(is_zero) {
                return Err(StrategyReplayResultFaultV1::MissingSourceIdentity);
            }
            let order = order_tuple(envelope.order_key);
            if last_order.is_some_and(|last| order <= last) {
                return Err(StrategyReplayResultFaultV1::NonCanonicalOrder);
            }
            last_order = Some(order);
            first_kind.get_or_insert(envelope.order_key.kind);
            last_kind = Some(envelope.order_key.kind);
            source_records.push(event_record.to_vec());

            let checkpoint_before = reader.take_array::<32>()?;
            let checkpoint_after = reader.take_array::<32>()?;
            if is_zero(&checkpoint_before) || is_zero(&checkpoint_after) {
                return Err(StrategyReplayResultFaultV1::MalformedCheckpointChain);
            }

            if previous_checkpoint.is_some_and(|value| value != checkpoint_before) {
                return Err(StrategyReplayResultFaultV1::MalformedCheckpointChain);
            }
            previous_checkpoint = Some(checkpoint_after);

            let proposal_present = reader.u8()?;
            reader.zeroes(7)?;
            let proposal_bytes = reader.take(PROPOSAL_WIRE_BYTES)?;
            let proposal = match proposal_present {
                0 => {
                    if proposal_bytes.iter().any(|byte| *byte != 0) {
                        return Err(StrategyReplayResultFaultV1::NonCanonicalRecord);
                    }
                    None
                }
                1 => Some(
                    decode_proposal_v1(proposal_bytes)
                        .map_err(|_| StrategyReplayResultFaultV1::MalformedProposal)?,
                ),
                _ => return Err(StrategyReplayResultFaultV1::NonCanonicalRecord),
            };
            let trace = reader.take(TRACE_BYTES)?;
            validate_trace(trace, &envelope, proposal.as_ref())?;

            let association_present = reader.u8()?;
            reader.zeroes(7)?;
            let association = reader.take(48)?;
            match association_present {
                0 if association.iter().all(|byte| *byte == 0) => {}
                1 if association.chunks_exact(16).all(|value| !is_zero(value)) => {
                    let proposal =
                        proposal.ok_or(StrategyReplayResultFaultV1::MalformedAssociation)?;
                    if association[32..48] != proposal.intent_identity {
                        return Err(StrategyReplayResultFaultV1::MalformedAssociation);
                    }
                }
                _ => return Err(StrategyReplayResultFaultV1::MalformedAssociation),
            }

            let restart_digest = reader.take_array::<32>()?;
            let restart_len = usize::try_from(reader.u32()?)
                .map_err(|_| StrategyReplayResultFaultV1::InvalidLength)?;
            if restart_len == 0 || restart_len > MAX_RESTART_BUNDLE_BYTES {
                return Err(StrategyReplayResultFaultV1::InvalidLength);
            }
            let restart = reader.take(restart_len)?;
            if digest(b"backtest.strategy-replay.restart-bundle.v1\0", &[restart]) != restart_digest
            {
                return Err(StrategyReplayResultFaultV1::RestartDigestMismatch);
            }
        }

        if first_kind != Some(LifecycleKind::Start) || last_kind != Some(LifecycleKind::Stop) {
            return Err(StrategyReplayResultFaultV1::IncompleteLifecycle);
        }
        let source_refs = source_records.iter().map(Vec::as_slice).collect::<Vec<_>>();
        if digest(SOURCE_DOMAIN, &source_refs) != declared_source_digest {
            return Err(StrategyReplayResultFaultV1::SourceDigestMismatch);
        }

        let inner_digest = reader.take_array::<32>()?;
        let inner_len = usize::try_from(reader.u64()?)
            .map_err(|_| StrategyReplayResultFaultV1::InvalidLength)?;
        if inner_len == 0 || inner_len > MAX_INNER_RESULT_BYTES {
            return Err(StrategyReplayResultFaultV1::InvalidLength);
        }
        let inner_bytes = reader.take(inner_len)?;
        if digest(INNER_DOMAIN, &[inner_bytes]) != inner_digest {
            return Err(StrategyReplayResultFaultV1::InnerDigestMismatch);
        }
        let inner_result = CanonicalBacktestResult::from_slice(inner_bytes)
            .map_err(|_| StrategyReplayResultFaultV1::MalformedInnerResult)?;

        let terminal_offset = reader.offset;
        let terminal_digest = reader.take_array::<32>()?;
        if !reader.is_finished() {
            return Err(StrategyReplayResultFaultV1::TrailingBytes);
        }

        if digest(TERMINAL_DOMAIN, &[&bytes[..terminal_offset]]) != terminal_digest {
            return Err(StrategyReplayResultFaultV1::TerminalDigestMismatch);
        }
        let _ = (terminal_digest, inner_result);
        Err(StrategyReplayResultFaultV1::EngineConsistencyUnavailable)
    }
}

impl<H: LifecycleProgramHost> StrategyReplayAdapterV1<H> {
    /// Refuses to seal until an engine-owned reconciler can prove the inner result against every
    /// replay event, trace, simulated order association, and fill.
    ///
    /// # Errors
    ///
    /// Always returns `EngineConsistencyUnavailable` in this contract-only slice.
    pub fn finish(
        self,
        _inner_result: &CanonicalBacktestResult,
    ) -> Result<CanonicalStrategyReplayResultV1, StrategyReplayResultFaultV1> {
        Err(StrategyReplayResultFaultV1::EngineConsistencyUnavailable)
    }
}

fn validate_trace(
    trace: &[u8],
    envelope: &strategy_factory_program_sdk::lifecycle_v1::LifecycleEnvelopeV1,
    proposal: Option<&strategy_factory_program_sdk::lifecycle_v1::ProposalV1>,
) -> Result<(), StrategyReplayResultFaultV1> {
    if u16::from_le_bytes(trace[0..2].try_into().expect("fixed trace")) != TRACE_SCHEMA_VERSION
        || trace[2..8].iter().any(|byte| *byte != 0)
        || trace[8] != 1
        || trace[9] != envelope.order_key.kind as u8
        || trace[10..16].iter().any(|byte| *byte != 0)
        || trace[16..24] != envelope.order_key.logical_time_ns.to_le_bytes()
        || trace[24..32] != envelope.order_key.event_time_ns.to_le_bytes()
        || trace[32..40] != envelope.order_key.owner_sequence.to_le_bytes()
        || trace[40..56] != envelope.order_key.event_identity
        || trace[56..88] != envelope.envelope_digest
        || !matches!(trace[120], 1..=5)
        || !matches!(trace[121], 0..=4)
        || !matches!(trace[122], 0..=3)
        || trace[123] & !7 != 0
        || trace[124..128].iter().any(|byte| *byte != 0)
        || trace[312..320].iter().any(|byte| *byte != 0)
    {
        return Err(StrategyReplayResultFaultV1::MalformedTrace);
    }

    match proposal {
        Some(value) if trace[88..120] == value.proposal_digest => {}
        None if trace[88..120].iter().all(|byte| *byte == 0) => {}
        _ => return Err(StrategyReplayResultFaultV1::MalformedTrace),
    }
    validate_target(&trace[144..176])?;
    validate_protection(&trace[176..216])?;
    validate_fill_frontier(&trace[216..248])?;
    Ok(())
}

fn validate_target(bytes: &[u8]) -> Result<(), StrategyReplayResultFaultV1> {
    let zero = |range: std::ops::Range<usize>| bytes[range].iter().all(|byte| *byte == 0);
    let valid = match bytes[0] {
        0 => zero(1..32),
        1 => zero(1..8) && zero(16..32) && read_i64(bytes, 8) != i64::MIN,
        2 => {
            let weight = i32::from_le_bytes(bytes[8..12].try_into().expect("fixed target"));
            zero(1..8) && zero(12..32) && (-1_000_000..=1_000_000).contains(&weight)
        }
        3 => zero(1..8) && zero(24..32) && read_i64(bytes, 16) != i64::MIN,
        4 => {
            let weight = i32::from_le_bytes(bytes[16..20].try_into().expect("fixed target"));
            zero(1..8) && zero(20..32) && (-1_000_000..=1_000_000).contains(&weight)
        }
        _ => false,
    };

    if valid {
        Ok(())
    } else {
        Err(StrategyReplayResultFaultV1::MalformedTrace)
    }
}

fn validate_protection(bytes: &[u8]) -> Result<(), StrategyReplayResultFaultV1> {
    let option = |tag: usize, value: usize| -> Option<Option<i64>> {
        match bytes[tag] {
            0 if bytes[value..value + 8].iter().all(|byte| *byte == 0) => Some(None),
            1 => Some(Some(read_i64(bytes, value))),
            _ => None,
        }
    };
    let stop = option(0, 1).ok_or(StrategyReplayResultFaultV1::MalformedTrace)?;
    let take = option(9, 10).ok_or(StrategyReplayResultFaultV1::MalformedTrace)?;
    let distance = match bytes[18] {
        0 if bytes[19..27].iter().all(|byte| *byte == 0) => None,
        1 => Some(u64::from_le_bytes(
            bytes[19..27].try_into().expect("fixed protection"),
        )),
        _ => return Err(StrategyReplayResultFaultV1::MalformedTrace),
    };
    let trailing = option(27, 28).ok_or(StrategyReplayResultFaultV1::MalformedTrace)?;

    if bytes[36..40].iter().any(|byte| *byte != 0)
        || stop.is_some_and(|value| value <= 0)
        || take.is_some_and(|value| value <= 0)
        || trailing.is_some_and(|value| value <= 0)
        || distance == Some(0)
        || distance.is_some() != trailing.is_some()
    {
        return Err(StrategyReplayResultFaultV1::MalformedTrace);
    }
    Ok(())
}

fn validate_fill_frontier(bytes: &[u8]) -> Result<(), StrategyReplayResultFaultV1> {
    if !matches!(bytes[24], 0..=4) || bytes[25..32].iter().any(|byte| *byte != 0) {
        return Err(StrategyReplayResultFaultV1::MalformedTrace);
    }
    let empty_identity = bytes[..16].iter().all(|byte| *byte == 0);
    let cumulative = u64::from_le_bytes(bytes[16..24].try_into().expect("fixed frontier"));
    if empty_identity != (cumulative == 0 && bytes[24] == 0) {
        return Err(StrategyReplayResultFaultV1::MalformedTrace);
    }
    Ok(())
}

fn read_i64(bytes: &[u8], offset: usize) -> i64 {
    i64::from_le_bytes(bytes[offset..offset + 8].try_into().expect("fixed field"))
}

struct Reader<'a> {
    bytes: &'a [u8],
    offset: usize,
}

impl<'a> Reader<'a> {
    const fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, offset: 0 }
    }

    fn take(&mut self, len: usize) -> Result<&'a [u8], StrategyReplayResultFaultV1> {
        let end = self
            .offset
            .checked_add(len)
            .ok_or(StrategyReplayResultFaultV1::InvalidLength)?;
        let value = self
            .bytes
            .get(self.offset..end)
            .ok_or(StrategyReplayResultFaultV1::InvalidLength)?;
        self.offset = end;
        Ok(value)
    }

    fn take_array<const N: usize>(&mut self) -> Result<[u8; N], StrategyReplayResultFaultV1> {
        self.take(N)?
            .try_into()
            .map_err(|_| StrategyReplayResultFaultV1::InvalidLength)
    }

    fn u8(&mut self) -> Result<u8, StrategyReplayResultFaultV1> {
        Ok(self.take(1)?[0])
    }

    fn u16(&mut self) -> Result<u16, StrategyReplayResultFaultV1> {
        Ok(u16::from_le_bytes(self.take_array()?))
    }

    fn u32(&mut self) -> Result<u32, StrategyReplayResultFaultV1> {
        Ok(u32::from_le_bytes(self.take_array()?))
    }

    fn u64(&mut self) -> Result<u64, StrategyReplayResultFaultV1> {
        Ok(u64::from_le_bytes(self.take_array()?))
    }

    fn zeroes(&mut self, len: usize) -> Result<(), StrategyReplayResultFaultV1> {
        if self.take(len)?.iter().any(|byte| *byte != 0) {
            Err(StrategyReplayResultFaultV1::NonCanonicalRecord)
        } else {
            Ok(())
        }
    }

    const fn is_finished(&self) -> bool {
        self.offset == self.bytes.len()
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StrategyReplayResultFaultV1 {
    InvalidLength,
    InvalidMagic,
    UnsupportedVersion,
    MissingIdentity,
    MissingSourceIdentity,
    InvalidRecordCount,
    MalformedEvent,
    NonCanonicalOrder,
    MalformedCheckpointChain,
    MalformedProposal,
    MalformedTrace,
    MalformedAssociation,
    NonCanonicalRecord,
    RestartDigestMismatch,
    SourceDigestMismatch,
    IncompleteLifecycle,
    InnerDigestMismatch,
    MalformedInnerResult,
    TerminalDigestMismatch,
    TrailingBytes,
    ConsumedIdentityDrift,
    EngineConsistencyUnavailable,
}

impl Display for StrategyReplayResultFaultV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            formatter,
            "canonical strategy replay result fault: {self:?}"
        )
    }
}

impl Error for StrategyReplayResultFaultV1 {}
