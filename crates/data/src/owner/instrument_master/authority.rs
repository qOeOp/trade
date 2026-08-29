use std::collections::{BTreeMap, BTreeSet, HashSet};

use super::{
    BACKTEST_OWNER_V1, ClockProjection, InstrumentClass, InstrumentDecimal, InstrumentMasterCutV1,
    InstrumentMasterError, InstrumentMasterFactProposalV1, InstrumentMasterFactV1,
    InstrumentMasterIdentity, InstrumentMasterReadbackV1, InstrumentMasterReceiptV1,
    InstrumentMasterResolution, InstrumentMasterScopeV1, InstrumentVenueSourceMapping,
    MARKET_DATA_AS_OF, SAME_CLOCK_EPOCH_SEQUENCE_AND_CUT_V1, UntrustedInstrumentMasterRequestV1,
    codec::{self, Decoder, Encoder},
};
use crate::owner::shared_time_evidence::{ClockHeadHandoff, EpochSuccessorProof};

fn exact_32(value: &str) -> Result<[u8; 32], InstrumentMasterError> {
    value
        .as_bytes()
        .try_into()
        .map_err(|_| InstrumentMasterError::ClockMismatch)
}

pub(crate) fn clock_projection(
    handoff: &ClockHeadHandoff,
    proof: Option<&EpochSuccessorProof>,
) -> Result<ClockProjection, InstrumentMasterError> {
    let (epoch_proof_identity, epoch_proof_digest) = match proof {
        None => (None, None),
        Some(proof)
            if proof.successor_head_digest() == handoff.head_digest()
                && proof.successor_clock_identity() == handoff.clock_identity()
                && proof.successor_clock_epoch() == handoff.clock_epoch()
                && proof.successor_continuity_digest() == handoff.restart_continuity_digest() =>
        {
            let identity = proof.proof_identity();
            (Some(identity), Some(identity))
        }
        Some(_) => return Err(InstrumentMasterError::ClockDiscontinuous),
    };
    Ok(ClockProjection {
        clock_identity: exact_32(handoff.clock_identity())?,
        clock_epoch: exact_32(handoff.clock_epoch())?,
        monotonic_sequence: handoff.monotonic_sequence(),
        wall_observed: handoff.wall_observed(),
        decision_cut: handoff.decision_cut(),
        head_identity: handoff.head_identity(),
        head_digest: handoff.head_digest(),
        valid_through: handoff.valid_through(),
        restart_continuity_digest: handoff.restart_continuity_digest(),
        uncertainty_bound: handoff.uncertainty_bound(),
        skew_bound: handoff.skew_bound(),
        epoch_proof_identity,
        epoch_proof_digest,
    })
}

fn validate_nonempty(value: &str) -> Result<(), InstrumentMasterError> {
    if value.is_empty() {
        Err(InstrumentMasterError::InvalidFact)
    } else {
        Ok(())
    }
}

fn mapping_bytes(mapping: &InstrumentVenueSourceMapping) -> Result<Vec<u8>, InstrumentMasterError> {
    validate_nonempty(&mapping.venue_identity)?;
    validate_nonempty(&mapping.source_identity)?;
    if mapping.source_instrument.is_empty() {
        return Err(InstrumentMasterError::InvalidFact);
    }
    let mut encoder = Encoder::default();
    encoder.string(&mapping.venue_identity)?;
    encoder.string(&mapping.source_identity)?;
    encoder.bytes(&mapping.source_instrument)?;
    Ok(encoder.finish())
}

fn validate_mappings(
    mappings: &[InstrumentVenueSourceMapping],
) -> Result<(), InstrumentMasterError> {
    if mappings.is_empty() {
        return Err(InstrumentMasterError::InvalidFact);
    }
    let mut prior: Option<Vec<u8>> = None;

    for mapping in mappings {
        let bytes = mapping_bytes(mapping)?;
        if prior.as_ref().is_some_and(|prior| prior >= &bytes) {
            return Err(InstrumentMasterError::InvalidFact);
        }
        prior = Some(bytes);
    }
    Ok(())
}

fn validate_proposal(
    proposal: &InstrumentMasterFactProposalV1,
) -> Result<(), InstrumentMasterError> {
    validate_nonempty(&proposal.canonical_identity)?;
    validate_mappings(&proposal.mappings)?;
    for value in [
        &proposal.calendar_identity,
        &proposal.session_identity,
        &proposal.time_zone_identity,
    ] {
        validate_nonempty(value)?;
    }
    proposal.price_increment.validate()?;
    proposal.quantity_increment.validate()?;
    proposal.contract_multiplier.validate()?;
    if proposal
        .effective_until
        .is_some_and(|until| proposal.effective_from >= until)
        || proposal.provider_available > proposal.owner_observation
        || proposal.retrieval > proposal.owner_observation
        || proposal.correction_publication > proposal.owner_observation
    {
        return Err(InstrumentMasterError::InvalidFact);
    }
    Ok(())
}

fn encode_decimal(encoder: &mut Encoder, value: InstrumentDecimal) {
    encoder.i128(value.mantissa);
    encoder.u8(value.scale);
}
fn decode_decimal(decoder: &mut Decoder<'_>) -> Result<InstrumentDecimal, InstrumentMasterError> {
    let value = InstrumentDecimal {
        mantissa: decoder.i128()?,
        scale: decoder.u8()?,
    };
    value.validate()?;
    Ok(value)
}

fn encode_clock(encoder: &mut Encoder, clock: &ClockProjection) {
    encoder.raw(&clock.clock_identity);
    encoder.raw(&clock.clock_epoch);
    encoder.u64(clock.monotonic_sequence);
    encoder.digest(clock.head_identity);
    encoder.digest(clock.head_digest);
    encoder.i128(i128::from(clock.wall_observed));
    encoder.i128(i128::from(clock.valid_through));
    encoder.digest(clock.restart_continuity_digest);
    encoder.u64(clock.uncertainty_bound);
    encoder.u64(clock.skew_bound);
    encoder.optional_digest(clock.epoch_proof_identity);
    encoder.optional_digest(clock.epoch_proof_digest);
}

fn decode_clock(
    decoder: &mut Decoder<'_>,
    decision_cut: u64,
) -> Result<ClockProjection, InstrumentMasterError> {
    let clock_identity = decoder.raw_32()?;
    let clock_epoch = decoder.raw_32()?;
    let monotonic_sequence = decoder.u64()?;
    let head_identity = decoder.digest()?;
    let head_digest = decoder.digest()?;
    let wall_observed =
        u64::try_from(decoder.i128()?).map_err(|_| InstrumentMasterError::CodecMismatch)?;
    let valid_through =
        u64::try_from(decoder.i128()?).map_err(|_| InstrumentMasterError::CodecMismatch)?;
    let restart_continuity_digest = decoder.digest()?;
    let uncertainty_bound = decoder.u64()?;
    let skew_bound = decoder.u64()?;
    let epoch_proof_identity = decoder.optional_digest()?;
    let epoch_proof_digest = decoder.optional_digest()?;
    if epoch_proof_identity.is_some() != epoch_proof_digest.is_some()
        || epoch_proof_identity
            .zip(epoch_proof_digest)
            .is_some_and(|(identity, digest)| identity != digest)
    {
        return Err(InstrumentMasterError::CodecMismatch);
    }
    Ok(ClockProjection {
        clock_identity,
        clock_epoch,
        monotonic_sequence,
        wall_observed,
        decision_cut,
        head_identity,
        head_digest,
        valid_through,
        restart_continuity_digest,
        uncertainty_bound,
        skew_bound,
        epoch_proof_identity,
        epoch_proof_digest,
    })
}

fn encode_fact_record(
    proposal: &InstrumentMasterFactProposalV1,
    clock: &ClockProjection,
) -> Result<Vec<u8>, InstrumentMasterError> {
    validate_proposal(proposal)?;
    let mut encoder = Encoder::default();
    encoder.u16(codec::VERSION);
    encoder.string(MARKET_DATA_AS_OF)?;
    encoder.string(&proposal.canonical_identity)?;
    encoder.optional_digest(proposal.predecessor_fact_digest);
    encoder.u32(codec::count(proposal.mappings.len())?);
    for mapping in &proposal.mappings {
        encoder.raw(&mapping_bytes(mapping)?);
    }
    encoder.u16(proposal.instrument_class as u16);
    encoder.optional_string(proposal.base_currency.as_deref())?;
    encoder.optional_string(proposal.quote_currency.as_deref())?;
    encoder.optional_string(proposal.settlement_currency.as_deref())?;
    encoder.optional_string(proposal.margin_currency.as_deref())?;
    encode_decimal(&mut encoder, proposal.price_increment);
    encode_decimal(&mut encoder, proposal.quantity_increment);
    encode_decimal(&mut encoder, proposal.contract_multiplier);
    encoder.string(&proposal.calendar_identity)?;
    encoder.string(&proposal.session_identity)?;
    encoder.string(&proposal.time_zone_identity)?;
    for digest in [
        proposal.lifecycle_frontier,
        proposal.corporate_action_frontier,
        proposal.historical_membership_frontier,
        proposal.market_semantics_identity,
        proposal.source_frontier,
        proposal.correction_frontier,
    ] {
        encoder.digest(digest);
    }
    encoder.i128(proposal.effective_from);
    encoder.optional_i128(proposal.effective_until);
    encoder.i128(proposal.provider_available);
    encoder.i128(proposal.retrieval);
    encoder.i128(proposal.correction_publication);
    encoder.i128(proposal.owner_observation);
    encoder.raw(&clock.clock_identity);
    encoder.raw(&clock.clock_epoch);
    encoder.u64(clock.monotonic_sequence);
    encoder.u64(clock.decision_cut);
    encoder.digest(clock.head_identity);
    encoder.digest(clock.head_digest);
    encoder.i128(i128::from(clock.wall_observed));
    encoder.i128(i128::from(clock.valid_through));
    encoder.digest(clock.restart_continuity_digest);
    encoder.u64(clock.uncertainty_bound);
    encoder.u64(clock.skew_bound);
    encoder.optional_digest(clock.epoch_proof_identity);
    encoder.optional_digest(clock.epoch_proof_digest);
    encoder.string(SAME_CLOCK_EPOCH_SEQUENCE_AND_CUT_V1)?;
    Ok(encoder.finish())
}

pub(crate) fn build_fact(
    proposal: InstrumentMasterFactProposalV1,
    handoff: &ClockHeadHandoff,
    proof: Option<&EpochSuccessorProof>,
) -> Result<InstrumentMasterFactV1, InstrumentMasterError> {
    let clock = clock_projection(handoff, proof)?;
    let observation = u64::try_from(proposal.owner_observation)
        .map_err(|_| InstrumentMasterError::ClockMismatch)?;

    if proposal.owner_observation < 0
        || observation >= clock.valid_through
        || proposal.owner_observation > i128::from(clock.wall_observed)
    {
        return Err(InstrumentMasterError::ClockExpired);
    }
    let canonical_bytes = encode_fact_record(&proposal, &clock)?;
    let identity = codec::identity(codec::FACT_DOMAIN, &canonical_bytes);
    Ok(InstrumentMasterFactV1 {
        proposal,
        clock,
        canonical_bytes,
        identity,
    })
}

pub(crate) fn decode_fact(bytes: &[u8]) -> Result<InstrumentMasterFactV1, InstrumentMasterError> {
    let mut decoder = Decoder::new(bytes);
    if decoder.u16()? != codec::VERSION || decoder.string()? != MARKET_DATA_AS_OF {
        return Err(InstrumentMasterError::CodecMismatch);
    }
    let canonical_identity = decoder.string()?;
    let predecessor_fact_digest = decoder.optional_digest()?;
    let mapping_count = decoder.u32()?;
    let mut mappings = Vec::with_capacity(
        usize::try_from(mapping_count).map_err(|_| InstrumentMasterError::CodecMismatch)?,
    );

    for _ in 0..mapping_count {
        mappings.push(InstrumentVenueSourceMapping {
            venue_identity: decoder.string()?,
            source_identity: decoder.string()?,
            source_instrument: decoder.bytes()?,
        });
    }
    let instrument_class = InstrumentClass::decode(decoder.u16()?)?;
    let base_currency = decoder.optional_string()?;
    let quote_currency = decoder.optional_string()?;
    let settlement_currency = decoder.optional_string()?;
    let margin_currency = decoder.optional_string()?;
    let price_increment = decode_decimal(&mut decoder)?;
    let quantity_increment = decode_decimal(&mut decoder)?;
    let contract_multiplier = decode_decimal(&mut decoder)?;
    let calendar_identity = decoder.string()?;
    let session_identity = decoder.string()?;
    let time_zone_identity = decoder.string()?;
    let lifecycle_frontier = decoder.digest()?;
    let corporate_action_frontier = decoder.digest()?;
    let historical_membership_frontier = decoder.digest()?;
    let market_semantics_identity = decoder.digest()?;
    let source_frontier = decoder.digest()?;
    let correction_frontier = decoder.digest()?;
    let effective_from = decoder.i128()?;
    let effective_until = decoder.optional_i128()?;
    let provider_available = decoder.i128()?;
    let retrieval = decoder.i128()?;
    let correction_publication = decoder.i128()?;
    let owner_observation = decoder.i128()?;
    let clock_identity = decoder.raw_32()?;
    let clock_epoch = decoder.raw_32()?;
    let monotonic_sequence = decoder.u64()?;
    let decision_cut = decoder.u64()?;
    let head_identity = decoder.digest()?;
    let head_digest = decoder.digest()?;
    let wall_observed =
        u64::try_from(decoder.i128()?).map_err(|_| InstrumentMasterError::CodecMismatch)?;
    let valid_through =
        u64::try_from(decoder.i128()?).map_err(|_| InstrumentMasterError::CodecMismatch)?;
    let restart_continuity_digest = decoder.digest()?;
    let uncertainty_bound = decoder.u64()?;
    let skew_bound = decoder.u64()?;
    let epoch_proof_identity = decoder.optional_digest()?;
    let epoch_proof_digest = decoder.optional_digest()?;
    if epoch_proof_identity.is_some() != epoch_proof_digest.is_some()
        || epoch_proof_identity
            .zip(epoch_proof_digest)
            .is_some_and(|(identity, digest)| identity != digest)
        || decoder.string()? != SAME_CLOCK_EPOCH_SEQUENCE_AND_CUT_V1
    {
        return Err(InstrumentMasterError::CodecMismatch);
    }
    decoder.finish()?;
    let proposal = InstrumentMasterFactProposalV1 {
        canonical_identity,
        predecessor_fact_digest,
        mappings,
        instrument_class,
        base_currency,
        quote_currency,
        settlement_currency,
        margin_currency,
        price_increment,
        quantity_increment,
        contract_multiplier,
        calendar_identity,
        session_identity,
        time_zone_identity,
        lifecycle_frontier,
        corporate_action_frontier,
        historical_membership_frontier,
        market_semantics_identity,
        source_frontier,
        correction_frontier,
        effective_from,
        effective_until,
        provider_available,
        retrieval,
        correction_publication,
        owner_observation,
    };
    let clock = ClockProjection {
        clock_identity,
        clock_epoch,
        monotonic_sequence,
        wall_observed,
        decision_cut,
        head_identity,
        head_digest,
        valid_through,
        restart_continuity_digest,
        uncertainty_bound,
        skew_bound,
        epoch_proof_identity,
        epoch_proof_digest,
    };
    validate_proposal(&proposal)?;

    if u64::try_from(owner_observation).map_err(|_| InstrumentMasterError::CodecMismatch)?
        >= valid_through
    {
        return Err(InstrumentMasterError::ClockExpired);
    }
    let canonical_bytes = bytes.to_vec();
    if encode_fact_record(&proposal, &clock)? != canonical_bytes {
        return Err(InstrumentMasterError::CodecMismatch);
    }
    let identity = codec::identity(codec::FACT_DOMAIN, bytes);
    Ok(InstrumentMasterFactV1 {
        proposal,
        clock,
        canonical_bytes,
        identity,
    })
}

pub(crate) fn validate_members(members: &[String]) -> Result<(), InstrumentMasterError> {
    if members.is_empty() {
        return Err(InstrumentMasterError::MembershipMismatch);
    }
    let mut prior: Option<&[u8]> = None;

    for member in members {
        validate_nonempty(member).map_err(|_| InstrumentMasterError::MembershipMismatch)?;
        if prior.is_some_and(|prior| prior >= member.as_bytes()) {
            return Err(InstrumentMasterError::MembershipMismatch);
        }
        prior = Some(member.as_bytes());
    }
    Ok(())
}

fn encode_scope(
    encoder: &mut Encoder,
    scope: &InstrumentMasterScopeV1,
) -> Result<(), InstrumentMasterError> {
    match scope {
        InstrumentMasterScopeV1::ExactInstrument(identity) => {
            encoder.u16(1);
            encoder.string(identity)?;
        }
        InstrumentMasterScopeV1::UniverseSelectionRecord(identity) => {
            encoder.u16(2);
            encoder.digest(*identity);
        }
    }
    Ok(())
}

fn decode_scope(
    decoder: &mut Decoder<'_>,
) -> Result<InstrumentMasterScopeV1, InstrumentMasterError> {
    match decoder.u16()? {
        1 => Ok(InstrumentMasterScopeV1::ExactInstrument(decoder.string()?)),
        2 => Ok(InstrumentMasterScopeV1::UniverseSelectionRecord(
            decoder.digest()?,
        )),
        _ => Err(InstrumentMasterError::CodecMismatch),
    }
}

fn encode_cut_record(cut: &InstrumentMasterCutV1) -> Result<Vec<u8>, InstrumentMasterError> {
    validate_cut_semantics(cut)?;
    let mut encoder = Encoder::default();
    encoder.u16(codec::VERSION);
    encoder.string(BACKTEST_OWNER_V1)?;
    encoder.digest(cut.request_identity);
    encoder.string(MARKET_DATA_AS_OF)?;
    encoder.digest(cut.request_meaning_digest);
    encode_scope(&mut encoder, &cut.scope)?;
    encoder.u32(codec::count(cut.expected_members.len())?);
    for member in &cut.expected_members {
        encoder.string(member)?;
    }
    encoder.i128(cut.effective_instant);
    encoder.i128(cut.owner_observation);
    encoder.u64(cut.decision_cut);
    encode_clock(&mut encoder, &cut.clock);
    encoder.string(SAME_CLOCK_EPOCH_SEQUENCE_AND_CUT_V1)?;
    encoder.u32(codec::count(cut.resolutions.len())?);
    for resolution in &cut.resolutions {
        encoder.string(&resolution.canonical_identity)?;
        encoder.digest(resolution.fact_digest);
    }

    for frontier in cut.frontiers {
        encoder.digest(frontier);
    }
    encoder.u32(0);
    Ok(encoder.finish())
}

pub(crate) fn build_cut(
    request: &UntrustedInstrumentMasterRequestV1,
    expected_members: Vec<String>,
    facts: &[InstrumentMasterFactV1],
    clock: ClockProjection,
) -> Result<InstrumentMasterCutV1, InstrumentMasterError> {
    if request.consumer_role != BACKTEST_OWNER_V1 {
        return Err(InstrumentMasterError::WrongRole);
    }
    validate_members(&expected_members)?;

    if request.owner_observation < 0
        || u64::try_from(request.owner_observation)
            .map_err(|_| InstrumentMasterError::ClockMismatch)?
            >= clock.valid_through
        || request.decision_cut != clock.decision_cut
    {
        return Err(InstrumentMasterError::ClockExpired);
    }

    match &request.scope {
        InstrumentMasterScopeV1::ExactInstrument(identity)
            if expected_members.len() == 1 && expected_members[0] == *identity => {}
        InstrumentMasterScopeV1::UniverseSelectionRecord(_) => {}
        _ => return Err(InstrumentMasterError::MembershipMismatch),
    }

    if facts.len() != expected_members.len() {
        return Err(InstrumentMasterError::MembershipMismatch);
    }
    let resolutions = facts
        .iter()
        .zip(&expected_members)
        .map(|(fact, member)| {
            if fact.canonical_identity() != member {
                return Err(InstrumentMasterError::MembershipMismatch);
            }
            Ok(InstrumentMasterResolution {
                canonical_identity: member.clone(),
                fact_digest: fact.digest(),
            })
        })
        .collect::<Result<Vec<_>, _>>()?;
    let frontiers = [
        request.lifecycle_frontier,
        request.corporate_action_frontier,
        request.historical_membership_frontier,
        request.market_semantics_identity,
        request.source_frontier,
        request.correction_frontier,
    ];

    if facts.iter().any(|fact| {
        fact.clock.clock_identity != clock.clock_identity
            || fact.clock.clock_epoch != clock.clock_epoch
            || fact.clock.monotonic_sequence > clock.monotonic_sequence
            || fact.clock.decision_cut > request.decision_cut
            || fact.proposal.owner_observation > request.owner_observation
            || fact.proposal.provider_available > request.owner_observation
            || fact.proposal.retrieval > request.owner_observation
            || fact.proposal.correction_publication > request.owner_observation
            || [
                fact.proposal.lifecycle_frontier,
                fact.proposal.corporate_action_frontier,
                fact.proposal.historical_membership_frontier,
                fact.proposal.market_semantics_identity,
                fact.proposal.source_frontier,
                fact.proposal.correction_frontier,
            ] != frontiers
    }) {
        return Err(InstrumentMasterError::FrontierMismatch);
    }
    let mut cut = InstrumentMasterCutV1 {
        request_identity: request.request_identity,
        request_meaning_digest: request.request_meaning_digest,
        scope: request.scope.clone(),
        expected_members,
        effective_instant: request.effective_instant,
        owner_observation: request.owner_observation,
        decision_cut: request.decision_cut,
        clock,
        resolutions,
        frontiers,
        canonical_bytes: Vec::new(),
        identity: InstrumentMasterIdentity::from_untrusted_bytes([0; 32]),
    };
    cut.canonical_bytes = encode_cut_record(&cut)?;
    cut.identity = codec::identity(codec::CUT_DOMAIN, &cut.canonical_bytes);
    Ok(cut)
}

fn validate_cut_semantics(cut: &InstrumentMasterCutV1) -> Result<(), InstrumentMasterError> {
    validate_members(&cut.expected_members)?;
    if cut.owner_observation < 0
        || u64::try_from(cut.owner_observation).map_err(|_| InstrumentMasterError::ClockMismatch)?
            >= cut.clock.valid_through
        || cut.decision_cut != cut.clock.decision_cut
        || cut.clock.epoch_proof_identity.is_some() != cut.clock.epoch_proof_digest.is_some()
        || cut
            .clock
            .epoch_proof_identity
            .zip(cut.clock.epoch_proof_digest)
            .is_some_and(|(identity, digest)| identity != digest)
    {
        return Err(InstrumentMasterError::ClockMismatch);
    }

    match &cut.scope {
        InstrumentMasterScopeV1::ExactInstrument(identity)
            if cut.expected_members.len() == 1 && cut.expected_members[0] == *identity => {}
        InstrumentMasterScopeV1::UniverseSelectionRecord(_) => {}
        _ => return Err(InstrumentMasterError::MembershipMismatch),
    }

    if cut.expected_members.len() != cut.resolutions.len()
        || cut
            .expected_members
            .iter()
            .zip(&cut.resolutions)
            .any(|(member, resolution)| member != &resolution.canonical_identity)
    {
        return Err(InstrumentMasterError::MembershipMismatch);
    }
    Ok(())
}

pub(crate) fn cut_matches_request(
    cut: &InstrumentMasterCutV1,
    request: &UntrustedInstrumentMasterRequestV1,
) -> bool {
    cut.request_identity == request.request_identity
        && cut.request_meaning_digest == request.request_meaning_digest
        && cut.scope == request.scope
        && cut.effective_instant == request.effective_instant
        && cut.owner_observation == request.owner_observation
        && cut.decision_cut == request.decision_cut
        && cut.clock.head_identity == request.clock_head.head_identity()
        && cut.clock.head_digest == request.clock_head.head_digest()
        && cut.frontiers
            == [
                request.lifecycle_frontier,
                request.corporate_action_frontier,
                request.historical_membership_frontier,
                request.market_semantics_identity,
                request.source_frontier,
                request.correction_frontier,
            ]
}

fn encode_receipt_record(
    receipt: &InstrumentMasterReceiptV1,
) -> Result<Vec<u8>, InstrumentMasterError> {
    let mut encoder = Encoder::default();
    encoder.u16(codec::VERSION);
    encoder.digest(receipt.request_identity);
    encoder.digest(receipt.request_meaning_digest);
    encoder.string(BACKTEST_OWNER_V1)?;
    encoder.u32(codec::count(receipt.fact_bytes.len())?);
    for bytes in &receipt.fact_bytes {
        encoder.bytes(bytes)?;
    }
    encoder.bytes(&receipt.cut_bytes)?;
    encoder.digest(receipt.store_generation_identity);
    encoder.u64(receipt.store_append_sequence);
    encoder.digest(receipt.stable_correlation);
    Ok(encoder.finish())
}

pub(crate) fn build_receipt(
    request: &UntrustedInstrumentMasterRequestV1,
    facts: &[InstrumentMasterFactV1],
    cut: &InstrumentMasterCutV1,
    store_generation_identity: InstrumentMasterIdentity,
    store_append_sequence: u64,
) -> Result<InstrumentMasterReceiptV1, InstrumentMasterError> {
    let mut receipt = InstrumentMasterReceiptV1 {
        request_identity: request.request_identity,
        request_meaning_digest: request.request_meaning_digest,
        fact_bytes: facts
            .iter()
            .map(|fact| fact.canonical_bytes.clone())
            .collect(),
        cut_bytes: cut.canonical_bytes.clone(),
        store_generation_identity,
        store_append_sequence,
        stable_correlation: request.stable_correlation,
        canonical_bytes: Vec::new(),
        identity: InstrumentMasterIdentity::from_untrusted_bytes([0; 32]),
    };
    receipt.canonical_bytes = encode_receipt_record(&receipt)?;
    receipt.identity = codec::identity(codec::RECEIPT_DOMAIN, &receipt.canonical_bytes);
    Ok(receipt)
}

pub(crate) fn decode_receipt(
    bytes: &[u8],
) -> Result<InstrumentMasterReceiptV1, InstrumentMasterError> {
    let mut decoder = Decoder::new(bytes);
    if decoder.u16()? != codec::VERSION {
        return Err(InstrumentMasterError::CodecMismatch);
    }
    let request_identity = decoder.digest()?;
    let request_meaning_digest = decoder.digest()?;
    if decoder.string()? != BACKTEST_OWNER_V1 {
        return Err(InstrumentMasterError::CodecMismatch);
    }
    let count = decoder.u32()?;
    let mut fact_bytes = Vec::new();
    for _ in 0..count {
        fact_bytes.push(decoder.bytes()?);
    }
    let cut_bytes = decoder.bytes()?;
    let store_generation_identity = decoder.digest()?;
    let store_append_sequence = decoder.u64()?;
    let stable_correlation = decoder.digest()?;
    decoder.finish()?;
    let mut receipt = InstrumentMasterReceiptV1 {
        request_identity,
        request_meaning_digest,
        fact_bytes,
        cut_bytes,
        store_generation_identity,
        store_append_sequence,
        stable_correlation,
        canonical_bytes: bytes.to_vec(),
        identity: codec::identity(codec::RECEIPT_DOMAIN, bytes),
    };

    if encode_receipt_record(&receipt)? != bytes {
        return Err(InstrumentMasterError::CodecMismatch);
    }
    receipt.identity = codec::identity(codec::RECEIPT_DOMAIN, bytes);
    Ok(receipt)
}

fn encode_readback_record(
    readback: &InstrumentMasterReadbackV1,
) -> Result<Vec<u8>, InstrumentMasterError> {
    let mut encoder = Encoder::default();
    encoder.u16(codec::VERSION);
    encoder.digest(readback.request_identity);
    encoder.digest(readback.request_meaning_digest);
    encoder.string(BACKTEST_OWNER_V1)?;
    encoder.u32(codec::count(readback.facts.len())?);
    for fact in &readback.facts {
        encoder.bytes(&fact.canonical_bytes)?;
    }
    encoder.bytes(&readback.cut.canonical_bytes)?;
    encoder.digest(readback.stable_correlation);
    encoder.digest(readback.store_generation_identity);
    encoder.u64(readback.store_append_sequence);
    encoder.digest(readback.receipt_identity);
    encoder.digest(readback.outbox_identity);
    Ok(encoder.finish())
}

pub(crate) fn build_readback(
    receipt: &InstrumentMasterReceiptV1,
) -> Result<InstrumentMasterReadbackV1, InstrumentMasterError> {
    if codec::identity(codec::RECEIPT_DOMAIN, &receipt.canonical_bytes) != receipt.identity
        || encode_receipt_record(receipt)? != receipt.canonical_bytes
    {
        return Err(InstrumentMasterError::DigestMismatch);
    }
    let facts = receipt
        .fact_bytes
        .iter()
        .map(|bytes| decode_fact(bytes))
        .collect::<Result<Vec<_>, _>>()?;
    let cut = decode_cut(&receipt.cut_bytes)?;
    let mut readback = InstrumentMasterReadbackV1 {
        request_identity: receipt.request_identity,
        request_meaning_digest: receipt.request_meaning_digest,
        facts,
        cut,
        stable_correlation: receipt.stable_correlation,
        store_generation_identity: receipt.store_generation_identity,
        store_append_sequence: receipt.store_append_sequence,
        receipt_identity: receipt.identity,
        outbox_identity: receipt.identity,
        canonical_bytes: Vec::new(),
        identity: InstrumentMasterIdentity::from_untrusted_bytes([0; 32]),
    };
    validate_nested(&readback)?;
    readback.canonical_bytes = encode_readback_record(&readback)?;
    readback.identity = codec::identity(codec::READBACK_DOMAIN, &readback.canonical_bytes);
    Ok(readback)
}

pub(crate) fn decode_cut(bytes: &[u8]) -> Result<InstrumentMasterCutV1, InstrumentMasterError> {
    let mut decoder = Decoder::new(bytes);
    if decoder.u16()? != codec::VERSION || decoder.string()? != BACKTEST_OWNER_V1 {
        return Err(InstrumentMasterError::CodecMismatch);
    }
    let request_identity = decoder.digest()?;
    if decoder.string()? != MARKET_DATA_AS_OF {
        return Err(InstrumentMasterError::CodecMismatch);
    }
    let request_meaning_digest = decoder.digest()?;
    let scope = decode_scope(&mut decoder)?;
    let member_count = decoder.u32()?;
    let mut expected_members = Vec::new();
    for _ in 0..member_count {
        expected_members.push(decoder.string()?);
    }
    validate_members(&expected_members)?;
    let effective_instant = decoder.i128()?;
    let owner_observation = decoder.i128()?;
    let decision_cut = decoder.u64()?;
    let clock = decode_clock(&mut decoder, decision_cut)?;
    if decoder.string()? != SAME_CLOCK_EPOCH_SEQUENCE_AND_CUT_V1 {
        return Err(InstrumentMasterError::CodecMismatch);
    }
    let resolution_count = decoder.u32()?;
    let mut resolutions = Vec::new();
    let mut prior: Option<Vec<u8>> = None;

    for _ in 0..resolution_count {
        let canonical_identity = decoder.string()?;

        if prior
            .as_ref()
            .is_some_and(|p| p.as_slice() >= canonical_identity.as_bytes())
        {
            return Err(InstrumentMasterError::CodecMismatch);
        }
        prior = Some(canonical_identity.as_bytes().to_vec());
        resolutions.push(InstrumentMasterResolution {
            canonical_identity,
            fact_digest: decoder.digest()?,
        });
    }
    let frontiers = [
        decoder.digest()?,
        decoder.digest()?,
        decoder.digest()?,
        decoder.digest()?,
        decoder.digest()?,
        decoder.digest()?,
    ];

    if decoder.u32()? != 0 {
        return Err(InstrumentMasterError::CodecMismatch);
    }
    decoder.finish()?;
    let mut cut = InstrumentMasterCutV1 {
        request_identity,
        request_meaning_digest,
        scope,
        expected_members,
        effective_instant,
        owner_observation,
        decision_cut,
        clock,
        resolutions,
        frontiers,
        canonical_bytes: bytes.to_vec(),
        identity: codec::identity(codec::CUT_DOMAIN, bytes),
    };

    validate_cut_semantics(&cut)?;

    if encode_cut_record(&cut)? != bytes {
        return Err(InstrumentMasterError::CodecMismatch);
    }
    cut.identity = codec::identity(codec::CUT_DOMAIN, bytes);
    Ok(cut)
}

fn validate_nested(readback: &InstrumentMasterReadbackV1) -> Result<(), InstrumentMasterError> {
    if readback.receipt_identity != readback.outbox_identity
        || readback.request_identity != readback.cut.request_identity
        || readback.request_meaning_digest != readback.cut.request_meaning_digest
        || readback.facts.len() != readback.cut.expected_members.len()
        || readback.cut.resolutions.len() != readback.facts.len()
    {
        return Err(InstrumentMasterError::DigestMismatch);
    }

    let decoded_cut = decode_cut(&readback.cut.canonical_bytes)?;
    if decoded_cut != readback.cut || decoded_cut.identity() != readback.cut.identity {
        return Err(InstrumentMasterError::DigestMismatch);
    }

    for ((fact, resolution), member) in readback
        .facts
        .iter()
        .zip(&readback.cut.resolutions)
        .zip(&readback.cut.expected_members)
    {
        if fact.canonical_identity() != member
            || resolution.canonical_identity != *member
            || resolution.fact_digest != fact.digest()
            || decode_fact(&fact.canonical_bytes)? != *fact
            || !effective_contains(fact, readback.cut.effective_instant)
            || !observable(
                fact,
                readback.cut.owner_observation,
                readback.cut.decision_cut,
                &readback.cut.clock,
            )
            || [
                fact.proposal.lifecycle_frontier,
                fact.proposal.corporate_action_frontier,
                fact.proposal.historical_membership_frontier,
                fact.proposal.market_semantics_identity,
                fact.proposal.source_frontier,
                fact.proposal.correction_frontier,
            ] != readback.cut.frontiers
        {
            return Err(InstrumentMasterError::DigestMismatch);
        }
    }
    Ok(())
}

/// Strictly verifies every nested domain, equality, rehash, and byte-for-byte re-encoding.
pub fn verify_instrument_master_readback(readback: &InstrumentMasterReadbackV1) -> bool {
    validate_nested(readback).is_ok()
        && encode_readback_record(readback).is_ok_and(|bytes| bytes == readback.canonical_bytes)
        && codec::identity(codec::READBACK_DOMAIN, &readback.canonical_bytes) == readback.identity
}

pub(crate) fn select_facts(
    facts: &[InstrumentMasterFactV1],
    members: &[String],
    effective: i128,
    observation: i128,
    cut: u64,
    clock: &ClockProjection,
) -> Result<Vec<InstrumentMasterFactV1>, InstrumentMasterError> {
    let mut selected = Vec::with_capacity(members.len());
    for member in members {
        let all = facts
            .iter()
            .filter(|fact| fact.canonical_identity() == member)
            .collect::<Vec<_>>();
        let by_digest = all
            .iter()
            .map(|fact| (fact.digest(), *fact))
            .collect::<BTreeMap<_, _>>();

        for fact in &all {
            if let Some(predecessor) = fact.predecessor_fact_digest() {
                let prior = by_digest
                    .get(&predecessor)
                    .ok_or(InstrumentMasterError::MissingPredecessor)?;
                if prior.canonical_identity() != fact.canonical_identity() {
                    return Err(InstrumentMasterError::MissingPredecessor);
                }
            }
        }
        let mut successors = BTreeMap::<InstrumentMasterIdentity, usize>::new();

        for fact in &all {
            if let Some(prior) = fact.predecessor_fact_digest() {
                *successors.entry(prior).or_default() += 1;
            }
        }

        if successors.values().any(|count| *count > 1) {
            return Err(InstrumentMasterError::PredecessorBranch);
        }

        for fact in &all {
            let mut seen = HashSet::new();
            let mut cursor = Some(fact.digest());
            while let Some(digest) = cursor {
                if !seen.insert(digest) {
                    return Err(InstrumentMasterError::PredecessorCycle);
                }
                cursor = by_digest
                    .get(&digest)
                    .and_then(|value| value.predecessor_fact_digest());
            }
        }

        for (index, left) in all.iter().enumerate() {
            for right in all.iter().skip(index + 1) {
                if intervals_overlap(left, right) && !same_chain(left, right, &by_digest) {
                    return Err(InstrumentMasterError::InvalidOverlap);
                }
            }
        }
        let eligible = all
            .into_iter()
            .filter(|fact| {
                effective_contains(fact, effective) && observable(fact, observation, cut, clock)
            })
            .collect::<Vec<_>>();
        let eligible_digests = eligible
            .iter()
            .map(|fact| fact.digest())
            .collect::<BTreeSet<_>>();
        let maximal = eligible
            .into_iter()
            .filter(|fact| {
                !successors_of(fact.digest(), &by_digest)
                    .iter()
                    .any(|digest| eligible_digests.contains(digest))
            })
            .collect::<Vec<_>>();

        if maximal.is_empty() {
            return Err(InstrumentMasterError::UnknownIdentity);
        }

        if maximal.len() != 1 {
            return Err(InstrumentMasterError::AmbiguousIdentity);
        }
        selected.push(maximal[0].clone());
    }
    Ok(selected)
}

pub(crate) fn validate_fact_graph(
    facts: &[InstrumentMasterFactV1],
) -> Result<(), InstrumentMasterError> {
    let identities = facts
        .iter()
        .map(InstrumentMasterFactV1::canonical_identity)
        .collect::<BTreeSet<_>>();

    for identity in identities {
        let all = facts
            .iter()
            .filter(|fact| fact.canonical_identity() == identity)
            .collect::<Vec<_>>();
        let by_digest = all
            .iter()
            .map(|fact| (fact.digest(), *fact))
            .collect::<BTreeMap<_, _>>();
        let mut successors = BTreeMap::<InstrumentMasterIdentity, usize>::new();

        for fact in &all {
            if let Some(predecessor) = fact.predecessor_fact_digest() {
                let prior = by_digest
                    .get(&predecessor)
                    .ok_or(InstrumentMasterError::MissingPredecessor)?;
                if prior.canonical_identity() != identity {
                    return Err(InstrumentMasterError::MissingPredecessor);
                }
                *successors.entry(predecessor).or_default() += 1;
            }
        }

        if successors.values().any(|count| *count > 1) {
            return Err(InstrumentMasterError::PredecessorBranch);
        }

        for fact in &all {
            let mut seen = HashSet::new();
            let mut cursor = Some(fact.digest());
            while let Some(digest) = cursor {
                if !seen.insert(digest) {
                    return Err(InstrumentMasterError::PredecessorCycle);
                }
                cursor = by_digest
                    .get(&digest)
                    .and_then(|value| value.predecessor_fact_digest());
            }
        }

        for (index, left) in all.iter().enumerate() {
            for right in all.iter().skip(index + 1) {
                if intervals_overlap(left, right) && !same_chain(left, right, &by_digest) {
                    return Err(InstrumentMasterError::InvalidOverlap);
                }
            }
        }
    }
    Ok(())
}

fn effective_contains(fact: &InstrumentMasterFactV1, instant: i128) -> bool {
    fact.proposal.effective_from <= instant
        && fact
            .proposal
            .effective_until
            .is_none_or(|until| instant < until)
}
fn observable(
    fact: &InstrumentMasterFactV1,
    observation: i128,
    cut: u64,
    clock: &ClockProjection,
) -> bool {
    fact.clock.clock_identity == clock.clock_identity
        && fact.clock.clock_epoch == clock.clock_epoch
        && fact.clock.monotonic_sequence <= clock.monotonic_sequence
        && fact.clock.decision_cut <= cut
        && fact.proposal.provider_available <= observation
        && fact.proposal.retrieval <= observation
        && fact.proposal.correction_publication <= observation
        && fact.proposal.owner_observation <= observation
}
fn intervals_overlap(left: &InstrumentMasterFactV1, right: &InstrumentMasterFactV1) -> bool {
    left.proposal.effective_from < right.proposal.effective_until.unwrap_or(i128::MAX)
        && right.proposal.effective_from < left.proposal.effective_until.unwrap_or(i128::MAX)
}
fn same_chain(
    left: &InstrumentMasterFactV1,
    right: &InstrumentMasterFactV1,
    facts: &BTreeMap<InstrumentMasterIdentity, &InstrumentMasterFactV1>,
) -> bool {
    is_ancestor(left.digest(), right, facts) || is_ancestor(right.digest(), left, facts)
}
fn is_ancestor(
    target: InstrumentMasterIdentity,
    fact: &InstrumentMasterFactV1,
    facts: &BTreeMap<InstrumentMasterIdentity, &InstrumentMasterFactV1>,
) -> bool {
    let mut cursor = fact.predecessor_fact_digest();
    while let Some(digest) = cursor {
        if digest == target {
            return true;
        }
        cursor = facts
            .get(&digest)
            .and_then(|value| value.predecessor_fact_digest());
    }
    false
}
fn successors_of(
    target: InstrumentMasterIdentity,
    facts: &BTreeMap<InstrumentMasterIdentity, &InstrumentMasterFactV1>,
) -> Vec<InstrumentMasterIdentity> {
    facts
        .iter()
        .filter_map(|(digest, fact)| {
            (fact.predecessor_fact_digest() == Some(target)).then_some(*digest)
        })
        .collect()
}
