#![allow(
    dead_code,
    reason = "Owner-private W1 issuance is intentionally unreachable before durable composition"
)]

use super::{
    ObservationCensusEntryV1, ObservationCensusErrorV1, ObservationCensusIdentity,
    ObservationCensusReadbackV1, ObservationCensusReceiptV1, ObservationCensusRecordV1,
    StrategyInputJoinedCutReadbackV1, UntrustedObservationCensusRequestV1,
    codec::{self, Decoder, Encoder},
};

use super::StrategyInputJoinedCutRecordV1;

use crate::owner::{
    pit_snapshot::{
        UntrustedCorrectionPublicationTime, UntrustedEventEffectiveTime,
        UntrustedPitSnapshotLocator, UntrustedPitSnapshotLocatorFields,
        UntrustedPitSnapshotTimeEvidence, UntrustedProviderAvailableTime, UntrustedRetrievalTime,
        UntrustedSnapshotDecisionCut,
    },
    source_binding::{BindingDigest, UntrustedCompleteFrontier},
    strategy_input_joined_cut::{StrategyInputJoinRoleClaimV1, UntrustedStrategyInputJoinClaimV1},
};

use crate::owner::{
    strategy_input_binding::{StrategyInputBindingReceipt, StrategyInputEventFrameReceipt},
    strategy_input_joined_cut::{
        issue_strategy_input_joined_cut_v1, seal_strategy_input_join_census_v1,
    },
};

pub(crate) fn request_meaning_digest(
    request: &UntrustedObservationCensusRequestV1,
) -> Result<super::ObservationCensusIdentity, ObservationCensusErrorV1> {
    Ok(codec::digest(
        codec::REQUEST_DOMAIN,
        &encode_request_meaning_v1(request)?,
    ))
}

fn encode_request_meaning_v1(
    request: &UntrustedObservationCensusRequestV1,
) -> Result<Vec<u8>, ObservationCensusErrorV1> {
    let claim = &request.join_claim;
    if claim.roles.len() > codec::MAX_JOIN_ROLES {
        return Err(ObservationCensusErrorV1::CapacityExceeded);
    }
    let mut encoder = Encoder::default();
    encoder.u16(codec::VERSION);
    encode_text(&mut encoder, &request.pit_locator.owner)?;
    encoder.digest(request.pit_locator.request_identity);
    encoder.digest(request.pit_locator.request_digest);
    encoder.digest(request.pit_locator.correlation_identity);
    encoder.digest(request.pit_locator.requester_identity);
    encoder.digest(request.pit_locator.scope_digest);
    encoder.digest(request.pit_locator.snapshot_identity);
    encoder.digest(request.pit_locator.fact_digest);
    encoder.digest(request.pit_locator.source_binding_identity);
    encoder.digest(request.pit_locator.source_binding_lineage_root);
    encoder.u64(request.pit_locator.source_binding_lineage_version);
    encoder.digest(request.pit_locator.lineage_root);
    encoder.u64(request.pit_locator.lineage_version);
    encode_optional_digest(
        &mut encoder,
        request.pit_locator.predecessor_snapshot_identity,
    );
    encode_optional_digest(&mut encoder, request.pit_locator.predecessor_fact_digest);
    encode_frontier(&mut encoder, &request.pit_locator.source_frontier)?;
    encode_frontier(&mut encoder, &request.pit_locator.correction_frontier)?;
    encode_time_evidence(&mut encoder, &request.pit_locator.time_evidence)?;
    encoder.digest(claim.strategy_design_identity);
    encoder.bytes(
        claim.join_semantic_id.as_bytes(),
        codec::MAX_JOIN_TEXT_BYTES,
    )?;
    encoder.digest(claim.join_identity);
    encoder.bytes(
        claim.alignment_semantic_id.as_bytes(),
        codec::MAX_JOIN_TEXT_BYTES,
    )?;
    encoder.bytes(
        claim.trigger_input_id.as_bytes(),
        codec::MAX_JOIN_TEXT_BYTES,
    )?;
    encoder.u64(claim.max_staleness_ns);
    encoder.u32(
        u32::try_from(claim.roles.len()).map_err(|_| ObservationCensusErrorV1::CapacityExceeded)?,
    );
    for role in &claim.roles {
        encoder.bytes(role.semantic_id.as_bytes(), codec::MAX_JOIN_TEXT_BYTES)?;
        encoder.digest(role.input_role_identity);
    }
    encoder.u64(request.trigger_logical_time);
    encoder.digest(request.stable_correlation);
    let bytes = encoder.finish()?;
    if bytes.len() > codec::MAX_REQUEST_BYTES {
        return Err(ObservationCensusErrorV1::CapacityExceeded);
    }
    Ok(bytes)
}

pub(crate) fn encode_observation_census_request_v1(
    request: &UntrustedObservationCensusRequestV1,
) -> Result<Box<[u8]>, ObservationCensusErrorV1> {
    validate_request(request)?;
    let meaning = encode_request_meaning_v1(request)?;
    let mut encoder = Encoder::default();
    encoder.u16(codec::VERSION);
    encoder.digest(request.request_identity);
    encoder.digest(request.request_meaning_digest);
    encoder.bytes(&meaning, codec::MAX_REQUEST_BYTES)?;
    let bytes = encoder.finish()?;
    if bytes.len() > codec::MAX_REQUEST_BYTES {
        return Err(ObservationCensusErrorV1::CapacityExceeded);
    }
    Ok(bytes.into_boxed_slice())
}

pub(crate) fn decode_observation_census_request_v1(
    bytes: &[u8],
) -> Result<UntrustedObservationCensusRequestV1, ObservationCensusErrorV1> {
    if bytes.len() > codec::MAX_REQUEST_BYTES {
        return Err(ObservationCensusErrorV1::CapacityExceeded);
    }
    let mut envelope = Decoder::new(bytes);
    if envelope.u16()? != codec::VERSION {
        return Err(ObservationCensusErrorV1::CodecMismatch);
    }
    let request_identity = envelope.digest()?;
    let claimed_meaning = envelope.digest()?;
    let meaning_bytes = envelope.bytes(codec::MAX_REQUEST_BYTES)?;
    envelope.finish()?;
    if codec::digest(codec::REQUEST_DOMAIN, meaning_bytes) != claimed_meaning {
        return Err(ObservationCensusErrorV1::DigestMismatch);
    }
    let mut decoder = Decoder::new(meaning_bytes);
    if decoder.u16()? != codec::VERSION {
        return Err(ObservationCensusErrorV1::CodecMismatch);
    }
    let owner = decode_text(&mut decoder)?;
    let request_identity_pit = decoder.digest()?;
    let request_digest = decoder.digest()?;
    let correlation_identity = decoder.digest()?;
    let requester_identity = decoder.digest()?;
    let scope_digest = decoder.digest()?;
    let snapshot_identity = decoder.digest()?;
    let fact_digest = decoder.digest()?;
    let source_binding_identity = decoder.digest()?;
    let source_binding_lineage_root = decoder.digest()?;
    let source_binding_lineage_version = decoder.u64()?;
    let lineage_root = decoder.digest()?;
    let lineage_version = decoder.u64()?;
    let predecessor_snapshot_identity = decode_optional_digest(&mut decoder)?;
    let predecessor_fact_digest = decode_optional_digest(&mut decoder)?;
    let source_frontier = decode_frontier(&mut decoder)?;
    let correction_frontier = decode_frontier(&mut decoder)?;
    let time_evidence = decode_time_evidence(&mut decoder)?;
    let strategy_design_identity = decoder.digest()?;
    let join_semantic_id = decode_join_text(&mut decoder)?;
    let join_identity = decoder.digest()?;
    let alignment_semantic_id = decode_join_text(&mut decoder)?;
    let trigger_input_id = decode_join_text(&mut decoder)?;
    let max_staleness_ns = decoder.u64()?;
    let role_count =
        usize::try_from(decoder.u32()?).map_err(|_| ObservationCensusErrorV1::CapacityExceeded)?;
    if role_count > codec::MAX_JOIN_ROLES {
        return Err(ObservationCensusErrorV1::CapacityExceeded);
    }
    let mut roles = Vec::with_capacity(role_count);
    for _ in 0..role_count {
        roles.push(StrategyInputJoinRoleClaimV1 {
            semantic_id: decode_join_text(&mut decoder)?,
            input_role_identity: decoder.digest()?,
        });
    }
    let trigger_logical_time = decoder.u64()?;
    let stable_correlation = decoder.digest()?;
    decoder.finish()?;
    let request = UntrustedObservationCensusRequestV1 {
        request_identity,
        request_meaning_digest: claimed_meaning,
        pit_locator: UntrustedPitSnapshotLocator::from_untrusted(
            UntrustedPitSnapshotLocatorFields {
                owner,
                request_identity: request_identity_pit,
                request_digest,
                correlation_identity,
                requester_identity,
                scope_digest,
                snapshot_identity,
                fact_digest,
                source_binding_identity,
                source_binding_lineage_root,
                source_binding_lineage_version,
                lineage_root,
                lineage_version,
                predecessor_snapshot_identity,
                predecessor_fact_digest,
                source_frontier,
                correction_frontier,
                time_evidence,
            },
        ),
        join_claim: UntrustedStrategyInputJoinClaimV1 {
            strategy_design_identity,
            join_semantic_id,
            join_identity,
            alignment_semantic_id,
            trigger_input_id,
            max_staleness_ns,
            roles,
        },
        trigger_logical_time,
        stable_correlation,
    };
    validate_request(&request)?;
    Ok(request)
}

fn encode_text(encoder: &mut Encoder, value: &str) -> Result<(), ObservationCensusErrorV1> {
    encoder.bytes(value.as_bytes(), codec::MAX_LOCATOR_TEXT_BYTES)
}

fn decode_text(decoder: &mut Decoder<'_>) -> Result<String, ObservationCensusErrorV1> {
    String::from_utf8(decoder.bytes(codec::MAX_LOCATOR_TEXT_BYTES)?.to_vec())
        .map_err(|_| ObservationCensusErrorV1::CodecMismatch)
}

fn decode_join_text(decoder: &mut Decoder<'_>) -> Result<String, ObservationCensusErrorV1> {
    String::from_utf8(decoder.bytes(codec::MAX_JOIN_TEXT_BYTES)?.to_vec())
        .map_err(|_| ObservationCensusErrorV1::CodecMismatch)
}

fn encode_optional_digest(encoder: &mut Encoder, value: Option<BindingDigest>) {
    match value {
        Some(value) => {
            encoder.u8(1);
            encoder.digest(value);
        }
        None => encoder.u8(0),
    }
}

fn decode_optional_digest(
    decoder: &mut Decoder<'_>,
) -> Result<Option<BindingDigest>, ObservationCensusErrorV1> {
    match decoder.u8()? {
        0 => Ok(None),
        1 => Ok(Some(decoder.digest()?)),
        _ => Err(ObservationCensusErrorV1::CodecMismatch),
    }
}

fn encode_frontier(
    encoder: &mut Encoder,
    frontier: &UntrustedCompleteFrontier,
) -> Result<(), ObservationCensusErrorV1> {
    encode_text(encoder, &frontier.stream_identity)?;
    encode_text(encoder, &frontier.cut_identity)?;
    encoder.u64(frontier.sequence);
    encoder.digest(frontier.digest);
    Ok(())
}

fn decode_frontier(
    decoder: &mut Decoder<'_>,
) -> Result<UntrustedCompleteFrontier, ObservationCensusErrorV1> {
    Ok(UntrustedCompleteFrontier {
        stream_identity: decode_text(decoder)?,
        cut_identity: decode_text(decoder)?,
        sequence: decoder.u64()?,
        digest: decoder.digest()?,
    })
}

fn encode_coordinate(
    encoder: &mut Encoder,
    value: u64,
    clock_identity: &str,
    clock_epoch: &str,
) -> Result<(), ObservationCensusErrorV1> {
    encoder.u64(value);
    encode_text(encoder, clock_identity)?;
    encode_text(encoder, clock_epoch)
}

fn decode_coordinate(
    decoder: &mut Decoder<'_>,
) -> Result<(u64, String, String), ObservationCensusErrorV1> {
    Ok((decoder.u64()?, decode_text(decoder)?, decode_text(decoder)?))
}

fn encode_time_evidence(
    encoder: &mut Encoder,
    evidence: &UntrustedPitSnapshotTimeEvidence,
) -> Result<(), ObservationCensusErrorV1> {
    encode_coordinate(
        encoder,
        evidence.event_effective.value,
        &evidence.event_effective.clock_identity,
        &evidence.event_effective.clock_epoch,
    )?;
    encode_coordinate(
        encoder,
        evidence.provider_available.value,
        &evidence.provider_available.clock_identity,
        &evidence.provider_available.clock_epoch,
    )?;
    encode_coordinate(
        encoder,
        evidence.retrieval.value,
        &evidence.retrieval.clock_identity,
        &evidence.retrieval.clock_epoch,
    )?;
    match &evidence.correction_publication {
        Some(value) => {
            encoder.u8(1);
            encode_coordinate(
                encoder,
                value.value,
                &value.clock_identity,
                &value.clock_epoch,
            )?;
        }
        None => encoder.u8(0),
    }
    encode_coordinate(
        encoder,
        evidence.decision_cut.value,
        &evidence.decision_cut.clock_identity,
        &evidence.decision_cut.clock_epoch,
    )?;
    encoder.u64(evidence.monotonic_sequence);
    encoder.digest(evidence.restart_continuity_digest);
    encoder.u64(evidence.skew_bound);
    encoder.u64(evidence.uncertainty_bound);
    encoder.u64(evidence.observed_at);
    encoder.u64(evidence.valid_through);
    Ok(())
}

fn decode_time_evidence(
    decoder: &mut Decoder<'_>,
) -> Result<UntrustedPitSnapshotTimeEvidence, ObservationCensusErrorV1> {
    let event = decode_coordinate(decoder)?;
    let provider = decode_coordinate(decoder)?;
    let retrieval = decode_coordinate(decoder)?;
    let correction = match decoder.u8()? {
        0 => None,
        1 => {
            let value = decode_coordinate(decoder)?;
            Some(UntrustedCorrectionPublicationTime::from_untrusted(
                value.0, value.1, value.2,
            ))
        }
        _ => return Err(ObservationCensusErrorV1::CodecMismatch),
    };
    let decision = decode_coordinate(decoder)?;
    Ok(UntrustedPitSnapshotTimeEvidence {
        event_effective: UntrustedEventEffectiveTime::from_untrusted(event.0, event.1, event.2),
        provider_available: UntrustedProviderAvailableTime::from_untrusted(
            provider.0, provider.1, provider.2,
        ),
        retrieval: UntrustedRetrievalTime::from_untrusted(retrieval.0, retrieval.1, retrieval.2),
        correction_publication: correction,
        decision_cut: UntrustedSnapshotDecisionCut::from_untrusted(
            decision.0, decision.1, decision.2,
        ),
        monotonic_sequence: decoder.u64()?,
        restart_continuity_digest: decoder.digest()?,
        skew_bound: decoder.u64()?,
        uncertainty_bound: decoder.u64()?,
        observed_at: decoder.u64()?,
        valid_through: decoder.u64()?,
    })
}

fn validate_request(
    request: &UntrustedObservationCensusRequestV1,
) -> Result<(), ObservationCensusErrorV1> {
    if !codec::nonzero(request.request_identity)
        || !codec::nonzero(request.stable_correlation)
        || request.trigger_logical_time == 0
        || request.join_claim.roles.len() < 2
        || request.request_meaning_digest != request_meaning_digest(request)?
    {
        Err(ObservationCensusErrorV1::InvalidRequest)
    } else {
        Ok(())
    }
}

pub(crate) fn issue_observation_census_and_joined_cut_v1(
    request: &UntrustedObservationCensusRequestV1,
    bindings: &[StrategyInputBindingReceipt],
    frames: Vec<StrategyInputEventFrameReceipt>,
) -> Result<
    (
        ObservationCensusReadbackV1,
        StrategyInputJoinedCutReadbackV1,
    ),
    ObservationCensusErrorV1,
> {
    validate_request(request)?;
    if frames.is_empty() {
        return Err(ObservationCensusErrorV1::IncompleteCensus);
    }
    if frames.len() > codec::MAX_CENSUS_ENTRIES {
        return Err(ObservationCensusErrorV1::CapacityExceeded);
    }
    let expected_batch = frames[0].trigger().observation_batch_digest();
    if frames.iter().any(|frame| {
        frame.trigger().snapshot_identity() != request.pit_locator.snapshot_identity
            || frame.trigger().snapshot_fact_digest() != request.pit_locator.fact_digest
            || frame.trigger().observation_batch_digest() != expected_batch
    }) {
        return Err(ObservationCensusErrorV1::IncompleteCensus);
    }
    let mut entries = frames
        .iter()
        .map(issue_entry)
        .collect::<Result<Vec<_>, _>>()?;
    entries.sort_by_key(|entry| {
        (
            entry.input_role_identity,
            entry.logical_time,
            entry.event_time,
            entry.owner_sequence,
            entry.event_identity,
        )
    });
    if entries.windows(2).any(|pair| {
        (
            pair[0].input_role_identity,
            pair[0].logical_time,
            pair[0].event_time,
            pair[0].owner_sequence,
            pair[0].event_identity,
        ) == (
            pair[1].input_role_identity,
            pair[1].logical_time,
            pair[1].event_time,
            pair[1].owner_sequence,
            pair[1].event_identity,
        )
    }) {
        return Err(ObservationCensusErrorV1::IncompleteCensus);
    }
    let sealed = seal_strategy_input_join_census_v1(frames)
        .map_err(|_| ObservationCensusErrorV1::JoinedCutUnavailable)?;
    let joined_cut_receipt = issue_strategy_input_joined_cut_v1(
        &request.join_claim,
        bindings,
        &sealed,
        request.trigger_logical_time,
    )
    .map_err(|_| ObservationCensusErrorV1::JoinedCutUnavailable)?;
    let mut census_encoder = Encoder::default();
    census_encoder.u16(codec::VERSION);
    census_encoder.digest(request.request_identity);
    census_encoder.digest(request.request_meaning_digest);
    census_encoder.digest(request.pit_locator.snapshot_identity);
    census_encoder.digest(request.pit_locator.fact_digest);
    census_encoder.digest(request.join_claim.join_identity);
    census_encoder.u64(request.trigger_logical_time);
    census_encoder
        .u32(u32::try_from(entries.len()).map_err(|_| ObservationCensusErrorV1::CapacityExceeded)?);
    for entry in &entries {
        census_encoder.digest(entry.identity);
    }
    let census_bytes = census_encoder.finish()?.into_boxed_slice();
    let census_identity = codec::digest(codec::CENSUS_DOMAIN, &census_bytes);
    let record = ObservationCensusRecordV1 {
        request_identity: request.request_identity,
        request_meaning_digest: request.request_meaning_digest,
        pit_snapshot_identity: request.pit_locator.snapshot_identity,
        pit_fact_digest: request.pit_locator.fact_digest,
        join_identity: request.join_claim.join_identity,
        trigger_logical_time: request.trigger_logical_time,
        entries: entries.into_boxed_slice(),
        canonical_bytes: census_bytes,
        identity: census_identity,
    };
    let mut receipt_encoder = Encoder::default();
    receipt_encoder.u16(codec::VERSION);
    receipt_encoder.digest(request.request_identity);
    receipt_encoder.digest(request.request_meaning_digest);
    receipt_encoder.digest(census_identity);
    receipt_encoder.digest(request.stable_correlation);
    let receipt_bytes = receipt_encoder.finish()?.into_boxed_slice();
    let receipt = ObservationCensusReceiptV1 {
        request_identity: request.request_identity,
        request_meaning_digest: request.request_meaning_digest,
        census_identity,
        stable_correlation: request.stable_correlation,
        identity: codec::digest(codec::RECEIPT_DOMAIN, &receipt_bytes),
        canonical_bytes: receipt_bytes,
    };
    let census_readback = ObservationCensusReadbackV1 { record, receipt };
    let mut custody_encoder = Encoder::default();
    custody_encoder.u16(codec::VERSION);
    custody_encoder.digest(request.request_identity);
    custody_encoder.digest(request.request_meaning_digest);
    custody_encoder.digest(census_identity);
    custody_encoder.digest(census_identity);
    custody_encoder.digest(joined_cut_receipt.digest());
    let custody_bytes = custody_encoder.finish()?.into_boxed_slice();
    let custody_identity = codec::digest(codec::JOINED_CUT_CUSTODY_DOMAIN, &custody_bytes);
    let joined_readback = StrategyInputJoinedCutReadbackV1 {
        record: StrategyInputJoinedCutRecordV1 {
            request_identity: request.request_identity,
            request_meaning_digest: request.request_meaning_digest,
            observation_census_identity: census_identity,
            observation_census_digest: census_identity,
            joined_cut_receipt,
            canonical_bytes: custody_bytes,
            identity: custody_identity,
        },
    };
    if verify_observation_census_readback_v1(&census_readback)
        && verify_strategy_input_joined_cut_readback_v1(&joined_readback)
    {
        Ok((census_readback, joined_readback))
    } else {
        Err(ObservationCensusErrorV1::DigestMismatch)
    }
}

fn issue_entry(
    frame: &StrategyInputEventFrameReceipt,
) -> Result<ObservationCensusEntryV1, ObservationCensusErrorV1> {
    let [value] = frame.values() else {
        return Err(ObservationCensusErrorV1::IncompleteCensus);
    };
    let lifecycle = frame.trigger().lifecycle();
    let mut encoder = Encoder::default();
    encoder.u16(codec::VERSION);
    encoder.digest(value.input_role_identity());
    encoder.u64(lifecycle.logical_time());
    encoder.u64(lifecycle.event_time());
    encoder.u64(lifecycle.owner_sequence());
    encoder.raw(&lifecycle.event_identity());
    encoder.digest(frame.trigger().digest());
    encoder.digest(value.digest());
    let bytes = encoder.finish()?.into_boxed_slice();
    let identity = codec::digest(codec::ENTRY_DOMAIN, &bytes);
    Ok(ObservationCensusEntryV1 {
        input_role_identity: value.input_role_identity(),
        logical_time: lifecycle.logical_time(),
        event_time: lifecycle.event_time(),
        owner_sequence: lifecycle.owner_sequence(),
        event_identity: lifecycle.event_identity(),
        trigger_digest: frame.trigger().digest(),
        value_digest: value.digest(),
        canonical_bytes: bytes,
        identity,
    })
}

fn encode_entry(entry: &ObservationCensusEntryV1) -> Result<Vec<u8>, ObservationCensusErrorV1> {
    let mut encoder = Encoder::default();
    encoder.u16(codec::VERSION);
    encoder.digest(entry.input_role_identity);
    encoder.u64(entry.logical_time);
    encoder.u64(entry.event_time);
    encoder.u64(entry.owner_sequence);
    encoder.raw(&entry.event_identity);
    encoder.digest(entry.trigger_digest);
    encoder.digest(entry.value_digest);
    encoder.finish()
}

fn encode_record(record: &ObservationCensusRecordV1) -> Result<Vec<u8>, ObservationCensusErrorV1> {
    let mut encoder = Encoder::default();
    encoder.u16(codec::VERSION);
    encoder.digest(record.request_identity);
    encoder.digest(record.request_meaning_digest);
    encoder.digest(record.pit_snapshot_identity);
    encoder.digest(record.pit_fact_digest);
    encoder.digest(record.join_identity);
    encoder.u64(record.trigger_logical_time);
    encoder.u32(
        u32::try_from(record.entries.len())
            .map_err(|_| ObservationCensusErrorV1::CapacityExceeded)?,
    );
    for entry in &record.entries {
        encoder.digest(entry.identity);
    }
    encoder.finish()
}

fn encode_receipt(
    receipt: &ObservationCensusReceiptV1,
) -> Result<Vec<u8>, ObservationCensusErrorV1> {
    let mut encoder = Encoder::default();
    encoder.u16(codec::VERSION);
    encoder.digest(receipt.request_identity);
    encoder.digest(receipt.request_meaning_digest);
    encoder.digest(receipt.census_identity);
    encoder.digest(receipt.stable_correlation);
    encoder.finish()
}

fn entry_key(
    entry: &ObservationCensusEntryV1,
) -> (ObservationCensusIdentity, u64, u64, u64, [u8; 16]) {
    (
        entry.input_role_identity,
        entry.logical_time,
        entry.event_time,
        entry.owner_sequence,
        entry.event_identity,
    )
}

/// Encodes the complete nested census custody used only by the Market Data store.
pub(crate) fn encode_observation_census_storage_v1(
    readback: &ObservationCensusReadbackV1,
) -> Result<Box<[u8]>, ObservationCensusErrorV1> {
    if !verify_observation_census_readback_v1(readback) {
        return Err(ObservationCensusErrorV1::DigestMismatch);
    }
    let mut encoder = Encoder::default();
    encoder.u16(codec::VERSION);
    encoder.u32(
        u32::try_from(readback.record.entries.len())
            .map_err(|_| ObservationCensusErrorV1::CapacityExceeded)?,
    );
    for entry in &readback.record.entries {
        encoder.bytes(&entry.canonical_bytes, codec::MAX_RECORD_BYTES)?;
    }
    encoder.bytes(&readback.record.canonical_bytes, codec::MAX_RECORD_BYTES)?;
    encoder.bytes(&readback.receipt.canonical_bytes, codec::MAX_RECORD_BYTES)?;
    let body = encoder.finish()?;
    let mut envelope = Encoder::default();
    envelope.digest(codec::digest(codec::STORAGE_DOMAIN, &body));
    envelope.raw(&body);
    Ok(envelope.finish()?.into_boxed_slice())
}

/// Decodes and re-verifies one complete store-owned census readback.
pub(crate) fn decode_observation_census_storage_v1(
    bytes: &[u8],
) -> Result<ObservationCensusReadbackV1, ObservationCensusErrorV1> {
    if bytes.len() > codec::MAX_RECORD_BYTES {
        return Err(ObservationCensusErrorV1::CapacityExceeded);
    }
    let mut envelope = codec::Decoder::new(bytes);
    let expected_digest = envelope.digest()?;
    let body = &bytes[32..];
    if expected_digest != codec::digest(codec::STORAGE_DOMAIN, body) {
        return Err(ObservationCensusErrorV1::DigestMismatch);
    }
    let version = envelope.u16()?;
    if version != codec::VERSION {
        return Err(ObservationCensusErrorV1::CodecMismatch);
    }
    let count =
        usize::try_from(envelope.u32()?).map_err(|_| ObservationCensusErrorV1::CapacityExceeded)?;
    if count == 0 || count > codec::MAX_CENSUS_ENTRIES {
        return Err(ObservationCensusErrorV1::IncompleteCensus);
    }
    let mut entries = Vec::with_capacity(count);
    for _ in 0..count {
        entries.push(decode_entry(envelope.bytes(codec::MAX_RECORD_BYTES)?)?);
    }
    let record_bytes = envelope
        .bytes(codec::MAX_RECORD_BYTES)?
        .to_vec()
        .into_boxed_slice();
    let receipt_bytes = envelope
        .bytes(codec::MAX_RECORD_BYTES)?
        .to_vec()
        .into_boxed_slice();
    envelope.finish()?;
    let record = decode_record(record_bytes, entries.into_boxed_slice())?;
    let receipt = decode_receipt(receipt_bytes)?;
    let readback = ObservationCensusReadbackV1 { record, receipt };
    if verify_observation_census_readback_v1(&readback) {
        Ok(readback)
    } else {
        Err(ObservationCensusErrorV1::DigestMismatch)
    }
}

fn decode_entry(bytes: &[u8]) -> Result<ObservationCensusEntryV1, ObservationCensusErrorV1> {
    let mut decoder = codec::Decoder::new(bytes);
    if decoder.u16()? != codec::VERSION {
        return Err(ObservationCensusErrorV1::CodecMismatch);
    }
    let input_role_identity = decoder.digest()?;
    let logical_time = decoder.u64()?;
    let event_time = decoder.u64()?;
    let owner_sequence = decoder.u64()?;
    let event_identity = decoder.fixed::<16>()?;
    let trigger_digest = decoder.digest()?;
    let value_digest = decoder.digest()?;
    decoder.finish()?;
    if !codec::nonzero(input_role_identity)
        || !codec::nonzero(trigger_digest)
        || !codec::nonzero(value_digest)
        || logical_time == 0
        || owner_sequence == 0
        || event_identity == [0; 16]
    {
        return Err(ObservationCensusErrorV1::CodecMismatch);
    }
    let canonical_bytes = bytes.to_vec().into_boxed_slice();
    Ok(ObservationCensusEntryV1 {
        input_role_identity,
        logical_time,
        event_time,
        owner_sequence,
        event_identity,
        trigger_digest,
        value_digest,
        identity: codec::digest(codec::ENTRY_DOMAIN, &canonical_bytes),
        canonical_bytes,
    })
}

fn decode_record(
    bytes: Box<[u8]>,
    entries: Box<[ObservationCensusEntryV1]>,
) -> Result<ObservationCensusRecordV1, ObservationCensusErrorV1> {
    let mut decoder = codec::Decoder::new(&bytes);
    if decoder.u16()? != codec::VERSION {
        return Err(ObservationCensusErrorV1::CodecMismatch);
    }
    let request_identity = decoder.digest()?;
    let request_meaning_digest = decoder.digest()?;
    let pit_snapshot_identity = decoder.digest()?;
    let pit_fact_digest = decoder.digest()?;
    let join_identity = decoder.digest()?;
    let trigger_logical_time = decoder.u64()?;
    let count =
        usize::try_from(decoder.u32()?).map_err(|_| ObservationCensusErrorV1::CapacityExceeded)?;
    if count != entries.len() {
        return Err(ObservationCensusErrorV1::IncompleteCensus);
    }
    for entry in &entries {
        if decoder.digest()? != entry.identity {
            return Err(ObservationCensusErrorV1::DigestMismatch);
        }
    }
    decoder.finish()?;
    Ok(ObservationCensusRecordV1 {
        request_identity,
        request_meaning_digest,
        pit_snapshot_identity,
        pit_fact_digest,
        join_identity,
        trigger_logical_time,
        identity: codec::digest(codec::CENSUS_DOMAIN, &bytes),
        canonical_bytes: bytes,
        entries,
    })
}

fn decode_receipt(
    bytes: Box<[u8]>,
) -> Result<ObservationCensusReceiptV1, ObservationCensusErrorV1> {
    let mut decoder = codec::Decoder::new(&bytes);
    if decoder.u16()? != codec::VERSION {
        return Err(ObservationCensusErrorV1::CodecMismatch);
    }
    let request_identity = decoder.digest()?;
    let request_meaning_digest = decoder.digest()?;
    let census_identity = decoder.digest()?;
    let stable_correlation = decoder.digest()?;
    decoder.finish()?;
    Ok(ObservationCensusReceiptV1 {
        request_identity,
        request_meaning_digest,
        census_identity,
        stable_correlation,
        identity: codec::digest(codec::RECEIPT_DOMAIN, &bytes),
        canonical_bytes: bytes,
    })
}

#[must_use]
pub fn verify_observation_census_readback_v1(readback: &ObservationCensusReadbackV1) -> bool {
    let record = &readback.record;
    let receipt = &readback.receipt;
    !record.entries.is_empty()
        && record.entries.len() <= codec::MAX_CENSUS_ENTRIES
        && record
            .entries
            .windows(2)
            .all(|pair| entry_key(&pair[0]) < entry_key(&pair[1]))
        && record.entries.iter().all(|entry| {
            encode_entry(entry)
                .is_ok_and(|bytes| bytes.as_slice() == entry.canonical_bytes.as_ref())
                && codec::digest(codec::ENTRY_DOMAIN, &entry.canonical_bytes) == entry.identity
        })
        && encode_record(record)
            .is_ok_and(|bytes| bytes.as_slice() == record.canonical_bytes.as_ref())
        && codec::digest(codec::CENSUS_DOMAIN, &record.canonical_bytes) == record.identity
        && encode_receipt(receipt)
            .is_ok_and(|bytes| bytes.as_slice() == receipt.canonical_bytes.as_ref())
        && codec::digest(codec::RECEIPT_DOMAIN, &receipt.canonical_bytes) == receipt.identity
        && receipt.request_identity == record.request_identity
        && receipt.request_meaning_digest == record.request_meaning_digest
        && receipt.census_identity == record.identity
        && codec::nonzero(receipt.stable_correlation)
}

#[must_use]
pub fn verify_strategy_input_joined_cut_readback_v1(
    readback: &StrategyInputJoinedCutReadbackV1,
) -> bool {
    let record = &readback.record;
    let mut decoder = codec::Decoder::new(&record.canonical_bytes);
    let fields = (|| {
        if decoder.u16()? != codec::VERSION {
            return Err(ObservationCensusErrorV1::CodecMismatch);
        }
        let request_identity = decoder.digest()?;
        let request_meaning_digest = decoder.digest()?;
        let census_identity = decoder.digest()?;
        let census_digest = decoder.digest()?;
        let joined_cut_digest = decoder.digest()?;
        decoder.finish()?;
        Ok((
            request_identity,
            request_meaning_digest,
            census_identity,
            census_digest,
            joined_cut_digest,
        ))
    })();
    fields.is_ok_and(
        |(
            request_identity,
            request_meaning_digest,
            census_identity,
            census_digest,
            joined_cut_digest,
        )| {
            request_identity == record.request_identity
                && request_meaning_digest == record.request_meaning_digest
                && census_identity == record.observation_census_identity
                && census_digest == record.observation_census_digest
                && joined_cut_digest == record.joined_cut_receipt.digest()
        },
    ) && codec::digest(codec::JOINED_CUT_CUSTODY_DOMAIN, &record.canonical_bytes) == record.identity
        && record.joined_cut_receipt.has_valid_digest()
        && record.observation_census_identity == record.observation_census_digest
}
