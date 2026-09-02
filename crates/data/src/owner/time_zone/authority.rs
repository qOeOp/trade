use super::{
    PreparedTimeZoneResolutionV1, TimeZoneCutV1, TimeZoneErrorV1, TimeZoneFactProposalV1,
    TimeZoneFactV1, TimeZoneIdentity, TimeZoneReadbackV1, TimeZoneReceiptV1,
    UntrustedTimeZoneRequestV1, codec,
};

pub(crate) fn prepare_resolution_v1(
    request: UntrustedTimeZoneRequestV1,
    proposals: Vec<TimeZoneFactProposalV1>,
    r0_cut_identity: TimeZoneIdentity,
    r0_cut_digest: TimeZoneIdentity,
) -> Result<PreparedTimeZoneResolutionV1, TimeZoneErrorV1> {
    validate_request(&request)?;
    if proposals.is_empty() || proposals.len() > codec::MAX_FACTS {
        return Err(TimeZoneErrorV1::IncompleteCoverage);
    }
    for proposal in &proposals {
        let claim = proposal.dependencies.coordinates().claim();
        if claim.stable_correlation != request.stable_correlation
            || claim.time.owner_observation_ns != request.owner_observation_ns
            || claim.time.decision_cut != request.decision_cut
        {
            return Err(TimeZoneErrorV1::InvalidDependency);
        }
    }
    let mut facts = proposals
        .into_iter()
        .map(issue_fact_v1)
        .collect::<Result<Vec<_>, _>>()?;
    facts.sort_by_key(TimeZoneFactV1::effective_from_ns);
    validate_fact_graph(&request, &facts)?;
    let meaning = request_meaning_digest_v1(&request)?;
    let mut bytes = Vec::new();
    codec::header(&mut bytes);
    codec::identity(&mut bytes, request.request_identity)?;
    codec::identity(&mut bytes, meaning)?;
    bytes.push(request.consumer as u8);
    codec::bytes(
        &mut bytes,
        &request.time_zone_identity,
        codec::MAX_IDENTITY_BYTES,
    )?;
    codec::identity(&mut bytes, request.ruleset_identity)?;
    bytes.extend_from_slice(&request.window_start_ns.to_be_bytes());
    bytes.extend_from_slice(&request.window_end_ns_exclusive.to_be_bytes());
    bytes.extend_from_slice(&request.owner_observation_ns.to_be_bytes());
    bytes.extend_from_slice(&request.decision_cut.to_be_bytes());
    codec::identity(&mut bytes, r0_cut_identity)?;
    codec::identity(&mut bytes, r0_cut_digest)?;
    bytes.extend_from_slice(
        &u32::try_from(facts.len())
            .map_err(|_| TimeZoneErrorV1::CapacityExceeded)?
            .to_be_bytes(),
    );
    for fact in &facts {
        codec::identity(&mut bytes, fact.identity())?;
        codec::identity(
            &mut bytes,
            codec::digest(codec::FACT_DOMAIN, fact.canonical_bytes()),
        )?;
    }
    bytes.extend_from_slice(&0_u32.to_be_bytes());
    let identity = codec::digest(codec::CUT_DOMAIN, &bytes);
    let cut = TimeZoneCutV1 {
        request_identity: request.request_identity,
        request_meaning_digest: meaning,
        r0_cut_identity,
        r0_cut_digest,
        fact_identities: facts
            .iter()
            .map(TimeZoneFactV1::identity)
            .collect::<Vec<_>>()
            .into(),
        identity,
        canonical_bytes: bytes.into(),
    };
    Ok(PreparedTimeZoneResolutionV1 {
        request,
        facts: facts.into(),
        cut,
    })
}

pub(crate) fn issue_fact_v1(
    proposal: TimeZoneFactProposalV1,
) -> Result<TimeZoneFactV1, TimeZoneErrorV1> {
    let claim = proposal.dependencies.coordinates().claim();
    if proposal.time_zone_identity.is_empty()
        || proposal.time_zone_identity.len() > codec::MAX_IDENTITY_BYTES
        || !codec::nonzero(proposal.ruleset_identity)
        || proposal.correction_sequence == 0
        || claim.time.decision_cut != claim.pit.decision_cut
        || claim.source.lineage_version != proposal.correction_sequence
        || claim.correction.sequence != proposal.correction_sequence
    {
        return Err(TimeZoneErrorV1::InvalidFact);
    }
    let mut bytes = Vec::new();
    codec::header(&mut bytes);
    codec::bytes(
        &mut bytes,
        &proposal.time_zone_identity,
        codec::MAX_IDENTITY_BYTES,
    )?;
    codec::identity(&mut bytes, proposal.ruleset_identity)?;
    bytes.extend_from_slice(&proposal.utc_offset_seconds.to_be_bytes());
    codec::identity(&mut bytes, claim.source.lineage_root)?;
    bytes.extend_from_slice(&proposal.correction_sequence.to_be_bytes());
    encode_optional_identity(&mut bytes, claim.predecessor_identity)?;
    bytes.extend_from_slice(&claim.time.effective_from_ns.to_be_bytes());
    match claim.time.effective_until_ns {
        None => bytes.push(0),
        Some(value) => {
            bytes.push(1);
            bytes.extend_from_slice(&value.to_be_bytes());
        }
    }
    for value in [
        claim.time.provider_available_ns,
        claim.time.retrieval_ns,
        claim.time.correction_publication_ns,
        claim.time.owner_observation_ns,
    ] {
        bytes.extend_from_slice(&value.to_be_bytes());
    }
    bytes.extend_from_slice(&claim.time.decision_cut.to_be_bytes());
    codec::identity(&mut bytes, proposal.dependencies.r0_coordinate_identity())?;
    codec::identity(&mut bytes, proposal.dependencies.r0_coordinate_digest())?;
    codec::identity(&mut bytes, claim.source.binding_identity)?;
    codec::identity(&mut bytes, claim.source.binding_fact_digest)?;
    codec::identity(&mut bytes, claim.source.lineage_root)?;
    bytes.extend_from_slice(&claim.source.lineage_version.to_be_bytes());
    codec::identity(&mut bytes, claim.source.frontier.digest)?;
    codec::identity(&mut bytes, claim.correction.digest)?;
    if bytes.len() > codec::MAX_FACT_BYTES {
        return Err(TimeZoneErrorV1::CapacityExceeded);
    }
    let identity = codec::digest(codec::FACT_DOMAIN, &bytes);
    Ok(TimeZoneFactV1 {
        time_zone_identity: proposal.time_zone_identity,
        ruleset_identity: proposal.ruleset_identity,
        utc_offset_seconds: proposal.utc_offset_seconds,
        correction_sequence: proposal.correction_sequence,
        lineage_root: claim.source.lineage_root,
        source_binding_identity: claim.source.binding_identity,
        predecessor_identity: claim.predecessor_identity,
        effective_from_ns: claim.time.effective_from_ns,
        effective_until_ns: claim.time.effective_until_ns,
        owner_observation_ns: claim.time.owner_observation_ns,
        decision_cut: claim.time.decision_cut,
        identity,
        canonical_bytes: bytes.into(),
    })
}

pub(crate) fn request_meaning_digest_v1(
    request: &UntrustedTimeZoneRequestV1,
) -> Result<TimeZoneIdentity, TimeZoneErrorV1> {
    validate_request(request)?;
    let mut bytes = Vec::new();
    codec::header(&mut bytes);
    bytes.push(request.consumer as u8);
    codec::bytes(
        &mut bytes,
        &request.time_zone_identity,
        codec::MAX_IDENTITY_BYTES,
    )?;
    codec::identity(&mut bytes, request.ruleset_identity)?;
    bytes.extend_from_slice(&request.window_start_ns.to_be_bytes());
    bytes.extend_from_slice(&request.window_end_ns_exclusive.to_be_bytes());
    bytes.extend_from_slice(&request.owner_observation_ns.to_be_bytes());
    bytes.extend_from_slice(&request.decision_cut.to_be_bytes());
    codec::bytes(
        &mut bytes,
        &request.source_binding_locator_bytes,
        codec::MAX_LOCATOR_BYTES,
    )?;
    codec::bytes(
        &mut bytes,
        &request.r0_locator_bytes,
        codec::MAX_LOCATOR_BYTES,
    )?;
    codec::identity(&mut bytes, request.stable_correlation)?;
    Ok(codec::digest(codec::REQUEST_DOMAIN, &bytes))
}

pub(crate) fn seal_readback_v1(
    prepared: PreparedTimeZoneResolutionV1,
    store_generation_identity: TimeZoneIdentity,
    append_sequence: u64,
) -> Result<TimeZoneReadbackV1, TimeZoneErrorV1> {
    if !codec::nonzero(store_generation_identity) || append_sequence == 0 {
        return Err(TimeZoneErrorV1::StoreUntrusted);
    }
    let cut_digest = codec::digest(codec::CUT_DOMAIN, prepared.cut.canonical_bytes());
    if cut_digest != prepared.cut.identity() {
        return Err(TimeZoneErrorV1::StoreUntrusted);
    }
    let mut receipt_bytes = Vec::new();
    codec::header(&mut receipt_bytes);
    codec::identity(&mut receipt_bytes, prepared.request.request_identity)?;
    codec::identity(&mut receipt_bytes, prepared.cut.request_meaning_digest())?;
    codec::identity(&mut receipt_bytes, prepared.cut.identity())?;
    codec::identity(&mut receipt_bytes, cut_digest)?;
    codec::identity(&mut receipt_bytes, store_generation_identity)?;
    receipt_bytes.extend_from_slice(&append_sequence.to_be_bytes());
    codec::identity(&mut receipt_bytes, prepared.request.stable_correlation)?;
    let receipt_identity = codec::digest(codec::RECEIPT_DOMAIN, &receipt_bytes);
    let receipt = TimeZoneReceiptV1 {
        request_identity: prepared.request.request_identity,
        request_meaning_digest: prepared.cut.request_meaning_digest(),
        cut_identity: prepared.cut.identity(),
        cut_digest,
        store_generation_identity,
        append_sequence,
        stable_correlation: prepared.request.stable_correlation,
        identity: receipt_identity,
        canonical_bytes: receipt_bytes.into(),
    };
    build_readback(prepared.facts, prepared.cut, receipt, receipt_identity)
}

fn build_readback(
    facts: Box<[TimeZoneFactV1]>,
    cut: TimeZoneCutV1,
    receipt: TimeZoneReceiptV1,
    outbox_identity: TimeZoneIdentity,
) -> Result<TimeZoneReadbackV1, TimeZoneErrorV1> {
    if outbox_identity != receipt.identity() || facts.len() != cut.fact_identities().len() {
        return Err(TimeZoneErrorV1::StoreUntrusted);
    }
    let mut bytes = Vec::new();
    codec::header(&mut bytes);
    bytes.extend_from_slice(
        &u32::try_from(facts.len())
            .map_err(|_| TimeZoneErrorV1::CapacityExceeded)?
            .to_be_bytes(),
    );
    for (fact, expected) in facts.iter().zip(cut.fact_identities()) {
        if fact.identity() != *expected
            || codec::digest(codec::FACT_DOMAIN, fact.canonical_bytes()) != fact.identity()
        {
            return Err(TimeZoneErrorV1::StoreUntrusted);
        }
        codec::identity(&mut bytes, fact.identity())?;
        codec::bytes(&mut bytes, fact.canonical_bytes(), codec::MAX_FACT_BYTES)?;
    }
    codec::identity(&mut bytes, cut.identity())?;
    codec::bytes(&mut bytes, cut.canonical_bytes(), codec::MAX_READBACK_BYTES)?;
    codec::identity(&mut bytes, receipt.identity())?;
    codec::bytes(&mut bytes, receipt.canonical_bytes(), codec::MAX_FACT_BYTES)?;
    codec::identity(&mut bytes, outbox_identity)?;
    if bytes.len() > codec::MAX_READBACK_BYTES {
        return Err(TimeZoneErrorV1::CapacityExceeded);
    }
    Ok(TimeZoneReadbackV1 {
        facts,
        cut,
        receipt,
        outbox_identity,
        canonical_bytes: bytes.into(),
    })
}

pub(crate) fn decode_readback_v1(bytes: &[u8]) -> Result<TimeZoneReadbackV1, TimeZoneErrorV1> {
    if bytes.len() > codec::MAX_READBACK_BYTES {
        return Err(TimeZoneErrorV1::CapacityExceeded);
    }
    let mut decoder = codec::Decoder::new(bytes)?;
    let count = usize::try_from(decoder.u32()?).map_err(|_| TimeZoneErrorV1::CapacityExceeded)?;
    if count == 0 || count > codec::MAX_FACTS {
        return Err(TimeZoneErrorV1::StoreUntrusted);
    }
    let mut facts = Vec::with_capacity(count);
    for _ in 0..count {
        let identity = decoder.identity()?;
        let fact_bytes = decoder.bytes(codec::MAX_FACT_BYTES)?;
        let fact = decode_fact_v1(&fact_bytes)?;
        if fact.identity() != identity {
            return Err(TimeZoneErrorV1::StoreUntrusted);
        }
        facts.push(fact);
    }
    let cut_identity = decoder.identity()?;
    let cut_bytes = decoder.bytes(codec::MAX_READBACK_BYTES)?;
    let cut = decode_cut_v1(&cut_bytes)?;
    if cut.identity() != cut_identity {
        return Err(TimeZoneErrorV1::StoreUntrusted);
    }
    let receipt_identity = decoder.identity()?;
    let receipt_bytes = decoder.bytes(codec::MAX_FACT_BYTES)?;
    let receipt = decode_receipt_v1(&receipt_bytes)?;
    if receipt.identity() != receipt_identity {
        return Err(TimeZoneErrorV1::StoreUntrusted);
    }
    let outbox_identity = decoder.identity()?;
    decoder.finish()?;
    let readback = build_readback(facts.into(), cut, receipt, outbox_identity)?;
    if readback.canonical_bytes() != bytes {
        return Err(TimeZoneErrorV1::StoreUntrusted);
    }
    Ok(readback)
}

pub(crate) fn rejoin_stored_v1(
    fact_rows: &[Vec<u8>],
    cut_bytes: &[u8],
    receipt_bytes: &[u8],
    outbox_identity: TimeZoneIdentity,
    outbox_payload: &[u8],
) -> Result<TimeZoneReadbackV1, TimeZoneErrorV1> {
    if receipt_bytes != outbox_payload {
        return Err(TimeZoneErrorV1::StoreUntrusted);
    }
    let facts = fact_rows
        .iter()
        .map(|bytes| decode_fact_v1(bytes))
        .collect::<Result<Vec<_>, _>>()?;
    let cut = decode_cut_v1(cut_bytes)?;
    let receipt = decode_receipt_v1(receipt_bytes)?;
    build_readback(facts.into(), cut, receipt, outbox_identity)
}

pub(crate) fn decode_fact_v1(bytes: &[u8]) -> Result<TimeZoneFactV1, TimeZoneErrorV1> {
    let mut decoder = codec::Decoder::new(bytes)?;
    let time_zone_identity = decoder.bytes(codec::MAX_IDENTITY_BYTES)?;
    let ruleset_identity = decoder.identity()?;
    let utc_offset_seconds = decoder.i32()?;
    let lineage_root = decoder.identity()?;
    let correction_sequence = decoder.u64()?;
    if correction_sequence == 0 {
        return Err(TimeZoneErrorV1::StoreUntrusted);
    }
    let predecessor_identity = decoder.optional_identity()?;
    let effective_from_ns = decoder.i128()?;
    let effective_until_ns = decoder.optional_i128()?;
    if effective_until_ns.is_some_and(|until| until <= effective_from_ns) {
        return Err(TimeZoneErrorV1::StoreUntrusted);
    }
    let provider_available_ns = decoder.i128()?;
    let retrieval_ns = decoder.i128()?;
    let correction_publication_ns = decoder.i128()?;
    let owner_observation_ns = decoder.i128()?;
    let decision_cut = decoder.u64()?;
    let _r0_coordinate_identity = decoder.identity()?;
    let _r0_coordinate_digest = decoder.identity()?;
    let source_binding_identity = decoder.identity()?;
    let _source_binding_fact_digest = decoder.identity()?;
    let tail_lineage_root = decoder.identity()?;
    let lineage_version = decoder.u64()?;
    let _source_frontier_digest = decoder.identity()?;
    let _correction_frontier_digest = decoder.identity()?;
    decoder.finish()?;
    if tail_lineage_root != lineage_root
        || lineage_version != correction_sequence
        || provider_available_ns <= 0
        || correction_publication_ns <= 0
        || provider_available_ns > correction_publication_ns
        || correction_publication_ns > retrieval_ns
        || retrieval_ns > owner_observation_ns
        || decision_cut == 0
    {
        return Err(TimeZoneErrorV1::StoreUntrusted);
    }
    let identity = codec::digest(codec::FACT_DOMAIN, bytes);
    Ok(TimeZoneFactV1 {
        time_zone_identity,
        ruleset_identity,
        utc_offset_seconds,
        correction_sequence,
        lineage_root,
        source_binding_identity,
        predecessor_identity,
        effective_from_ns,
        effective_until_ns,
        owner_observation_ns,
        decision_cut,
        identity,
        canonical_bytes: bytes.into(),
    })
}

pub(crate) fn decode_cut_v1(bytes: &[u8]) -> Result<TimeZoneCutV1, TimeZoneErrorV1> {
    let mut decoder = codec::Decoder::new(bytes)?;
    let request_identity = decoder.identity()?;
    let request_meaning_digest = decoder.identity()?;
    let consumer = decoder.u8()?;
    if !(1..=4).contains(&consumer) {
        return Err(TimeZoneErrorV1::StoreUntrusted);
    }
    let _zone = decoder.bytes(codec::MAX_IDENTITY_BYTES)?;
    let _ruleset = decoder.identity()?;
    let start = decoder.i128()?;
    let end = decoder.i128()?;
    if start >= end {
        return Err(TimeZoneErrorV1::StoreUntrusted);
    }
    let _observation = decoder.i128()?;
    if decoder.u64()? == 0 {
        return Err(TimeZoneErrorV1::StoreUntrusted);
    }
    let r0_cut_identity = decoder.identity()?;
    let r0_cut_digest = decoder.identity()?;
    let count = usize::try_from(decoder.u32()?).map_err(|_| TimeZoneErrorV1::CapacityExceeded)?;
    if count == 0 || count > codec::MAX_FACTS {
        return Err(TimeZoneErrorV1::StoreUntrusted);
    }
    let mut identities = Vec::with_capacity(count);
    for _ in 0..count {
        identities.push(decoder.identity()?);
        let _ = decoder.identity()?;
    }
    if decoder.u32()? != 0 {
        return Err(TimeZoneErrorV1::IncompleteCoverage);
    }
    decoder.finish()?;
    Ok(TimeZoneCutV1 {
        request_identity,
        request_meaning_digest,
        r0_cut_identity,
        r0_cut_digest,
        fact_identities: identities.into(),
        identity: codec::digest(codec::CUT_DOMAIN, bytes),
        canonical_bytes: bytes.into(),
    })
}

pub(crate) fn decode_receipt_v1(bytes: &[u8]) -> Result<TimeZoneReceiptV1, TimeZoneErrorV1> {
    let mut decoder = codec::Decoder::new(bytes)?;
    let request_identity = decoder.identity()?;
    let request_meaning_digest = decoder.identity()?;
    let cut_identity = decoder.identity()?;
    let cut_digest = decoder.identity()?;
    let store_generation_identity = decoder.identity()?;
    let append_sequence = decoder.u64()?;
    if append_sequence == 0 {
        return Err(TimeZoneErrorV1::StoreUntrusted);
    }
    let stable_correlation = decoder.identity()?;
    decoder.finish()?;
    Ok(TimeZoneReceiptV1 {
        request_identity,
        request_meaning_digest,
        cut_identity,
        cut_digest,
        store_generation_identity,
        append_sequence,
        stable_correlation,
        identity: codec::digest(codec::RECEIPT_DOMAIN, bytes),
        canonical_bytes: bytes.into(),
    })
}

fn validate_request(request: &UntrustedTimeZoneRequestV1) -> Result<(), TimeZoneErrorV1> {
    if !codec::nonzero(request.request_identity)
        || !codec::nonzero(request.ruleset_identity)
        || !codec::nonzero(request.stable_correlation)
        || request.time_zone_identity.is_empty()
        || request.time_zone_identity.len() > codec::MAX_IDENTITY_BYTES
        || request.window_start_ns >= request.window_end_ns_exclusive
        || request.decision_cut == 0
        || request.source_binding_locator_bytes.is_empty()
        || request.r0_locator_bytes.is_empty()
        || request.source_binding_locator_bytes.len() > codec::MAX_LOCATOR_BYTES
        || request.r0_locator_bytes.len() > codec::MAX_LOCATOR_BYTES
    {
        return Err(TimeZoneErrorV1::InvalidRequest);
    }
    Ok(())
}

fn validate_fact_graph(
    request: &UntrustedTimeZoneRequestV1,
    facts: &[TimeZoneFactV1],
) -> Result<(), TimeZoneErrorV1> {
    let first = facts.first().ok_or(TimeZoneErrorV1::IncompleteCoverage)?;
    let last = facts.last().ok_or(TimeZoneErrorV1::IncompleteCoverage)?;
    if first.effective_from_ns() > request.window_start_ns
        || last
            .effective_until_ns()
            .is_some_and(|until| until < request.window_end_ns_exclusive)
    {
        return Err(TimeZoneErrorV1::IncompleteCoverage);
    }
    for fact in facts {
        if fact.time_zone_identity() != request.time_zone_identity.as_ref()
            || fact.ruleset_identity() != request.ruleset_identity
            || fact.owner_observation_ns() != request.owner_observation_ns
            || fact.decision_cut() != request.decision_cut
        {
            return Err(TimeZoneErrorV1::InvalidDependency);
        }
    }
    for pair in facts.windows(2) {
        let left = &pair[0];
        let right = &pair[1];
        if left.effective_until_ns() != Some(right.effective_from_ns())
            || right.predecessor_identity() != Some(left.identity())
            || right.correction_sequence()
                != left
                    .correction_sequence()
                    .checked_add(1)
                    .ok_or(TimeZoneErrorV1::CapacityExceeded)?
            || right.lineage_root() != left.lineage_root()
            || right.source_binding_identity() != left.source_binding_identity()
        {
            return Err(TimeZoneErrorV1::NonCanonicalOrder);
        }
    }
    Ok(())
}

fn encode_optional_identity(
    output: &mut Vec<u8>,
    value: Option<TimeZoneIdentity>,
) -> Result<(), TimeZoneErrorV1> {
    match value {
        None => output.push(0),
        Some(value) => {
            output.push(1);
            codec::identity(output, value)?;
        }
    }
    Ok(())
}
