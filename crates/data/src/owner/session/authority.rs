use std::collections::BTreeMap;

use super::{
    InstrumentMasterReferenceV1, LocalBoundaryV1, LocalResolutionV1, PreparedSessionResolutionV1,
    SessionCutV1, SessionDayCensusV1, SessionDependenciesV1, SessionErrorV1, SessionFactProposalV1,
    SessionFactV1, SessionIdentityV1, SessionReadbackV1, SessionReceiptV1,
    UntrustedSessionRequestV1, codec,
};
use crate::owner::{calendar, time_zone};

pub(crate) fn prepare_resolution_v1(
    request: UntrustedSessionRequestV1,
    dependencies: &SessionDependenciesV1<'_>,
    proposals: Vec<SessionFactProposalV1>,
    r0_cut_identity: SessionIdentityV1,
    r0_cut_digest: SessionIdentityV1,
) -> Result<PreparedSessionResolutionV1, SessionErrorV1> {
    validate_request(&request)?;
    validate_dependencies(&request, dependencies)?;

    if proposals.len() > codec::MAX_FACTS {
        return Err(SessionErrorV1::CapacityExceeded);
    }
    let mut facts = proposals
        .into_iter()
        .map(|proposal| issue_fact(&request, dependencies, &proposal))
        .collect::<Result<Vec<_>, _>>()?;
    facts.sort_by_key(|fact| (fact.trading_day, fact.interval_ordinal));
    let days = validate_census(&request, dependencies.calendar, &facts)?;
    let meaning = request_meaning_digest_v1(&request, &dependencies.instrument_master)?;
    let calendar_cut = dependencies.calendar.cut();
    let time_zone_cut = dependencies.time_zone.cut();
    let mut bytes = Vec::new();
    codec::header(&mut bytes);
    codec::id(&mut bytes, request.request_identity)?;
    codec::id(&mut bytes, meaning)?;
    bytes.push(1);
    codec::bytes(
        &mut bytes,
        &request.session_identity,
        codec::MAX_IDENTITY_BYTES,
    )?;
    bytes.extend_from_slice(&request.first_day.to_be_bytes());
    bytes.extend_from_slice(&request.last_day_exclusive.to_be_bytes());

    for value in [
        calendar_cut.identity(),
        calendar_cut.digest(),
        time_zone_cut.identity(),
        time_zone_cut.identity(),
        dependencies.instrument_master.readback_identity,
        dependencies.instrument_master.fact_digest,
        dependencies.instrument_master.cut_digest,
    ] {
        codec::id(&mut bytes, value)?;
    }
    bytes.extend_from_slice(&request.owner_observation_ns.to_be_bytes());
    bytes.extend_from_slice(&request.decision_cut.to_be_bytes());
    codec::id(&mut bytes, r0_cut_identity)?;
    codec::id(&mut bytes, r0_cut_digest)?;
    bytes.extend_from_slice(
        &u32::try_from(days.len())
            .map_err(|_| SessionErrorV1::CapacityExceeded)?
            .to_be_bytes(),
    );
    let mut fact_ids = Vec::new();

    for day in &days {
        bytes.extend_from_slice(&day.day.to_be_bytes());
        bytes.push(u8::from(day.is_open));
        bytes.extend_from_slice(
            &u32::try_from(day.intervals.len())
                .map_err(|_| SessionErrorV1::CapacityExceeded)?
                .to_be_bytes(),
        );

        for (ordinal, id, digest) in day.intervals.iter().copied() {
            bytes.extend_from_slice(&ordinal.to_be_bytes());
            codec::id(&mut bytes, id)?;
            codec::id(&mut bytes, digest)?;
            fact_ids.push(id);
        }
    }
    bytes.extend_from_slice(&0u32.to_be_bytes());
    let identity = codec::digest(codec::CUT_DOMAIN, &bytes);
    let request_identity = request.request_identity;
    Ok(PreparedSessionResolutionV1 {
        request,
        facts: facts.into(),
        cut: SessionCutV1 {
            request_identity,
            request_meaning_digest: meaning,
            days: days.into(),
            fact_identities: fact_ids.into(),
            identity,
            canonical_bytes: bytes.into(),
        },
    })
}

pub(super) fn issue_fact(
    request: &UntrustedSessionRequestV1,
    deps: &SessionDependenciesV1<'_>,
    proposal: &SessionFactProposalV1,
) -> Result<SessionFactV1, SessionErrorV1> {
    let claim = proposal.coordinates.claim();
    if proposal.trading_day < request.first_day
        || proposal.trading_day >= request.last_day_exclusive
        || proposal.correction_sequence == 0
        || !codec::nonzero(proposal.correction_identity)
        || !codec::nonzero(proposal.r0_coordinate_identity)
        || !codec::nonzero(proposal.r0_coordinate_digest)
        || claim.stable_correlation != request.stable_correlation
        || claim.time.owner_observation_ns != request.owner_observation_ns
        || claim.time.decision_cut != request.decision_cut
        || claim.source.lineage_version != proposal.correction_sequence
        || claim.predecessor_identity != proposal.predecessor_identity
    {
        return Err(SessionErrorV1::InvalidDependency);
    }
    let calendar_fact = deps
        .calendar
        .facts()
        .iter()
        .find(|fact| fact.day() == proposal.trading_day)
        .ok_or(SessionErrorV1::IncompleteCensus)?;
    if !calendar_fact.is_open() {
        return Err(SessionErrorV1::IncompleteCensus);
    }
    let (utc_open, open_tz) = resolve_boundary(proposal.local_open, deps.time_zone)?;
    let (utc_close, close_tz) = resolve_boundary(proposal.local_close, deps.time_zone)?;
    if utc_open >= utc_close {
        return Err(SessionErrorV1::InvalidBoundary);
    }
    let mut bytes = Vec::new();
    codec::header(&mut bytes);
    codec::bytes(
        &mut bytes,
        &request.session_identity,
        codec::MAX_IDENTITY_BYTES,
    )?;
    bytes.extend_from_slice(&proposal.trading_day.to_be_bytes());
    bytes.extend_from_slice(&proposal.interval_ordinal.to_be_bytes());
    encode_boundary(&mut bytes, proposal.local_open);
    encode_boundary(&mut bytes, proposal.local_close);
    bytes.extend_from_slice(&utc_open.to_be_bytes());
    bytes.extend_from_slice(&utc_close.to_be_bytes());

    for value in [
        calendar_fact.identity(),
        calendar_fact.digest(),
        deps.calendar.cut().identity(),
        deps.calendar.cut().digest(),
        open_tz,
        open_tz,
        close_tz,
        close_tz,
        deps.time_zone.cut().identity(),
        deps.time_zone.cut().identity(),
        deps.instrument_master.readback_identity,
        deps.instrument_master.fact_digest,
        deps.instrument_master.cut_digest,
    ] {
        codec::id(&mut bytes, value)?;
    }
    encode_opt_id(&mut bytes, proposal.predecessor_identity)?;
    bytes.extend_from_slice(&proposal.correction_sequence.to_be_bytes());

    for value in [
        claim.time.provider_available_ns,
        claim.time.retrieval_ns,
        claim.time.correction_publication_ns,
        claim.time.owner_observation_ns,
    ] {
        bytes.extend_from_slice(&value.to_be_bytes());
    }
    bytes.extend_from_slice(&claim.time.decision_cut.to_be_bytes());

    for value in [
        proposal.r0_coordinate_identity,
        proposal.r0_coordinate_digest,
        claim.source.binding_identity,
        claim.source.binding_fact_digest,
        claim.source.lineage_root,
    ] {
        codec::id(&mut bytes, value)?;
    }
    bytes.extend_from_slice(&claim.source.lineage_version.to_be_bytes());
    for value in [
        claim.source.frontier.digest,
        claim.correction.digest,
        proposal.correction_identity,
    ] {
        codec::id(&mut bytes, value)?;
    }
    let identity = codec::digest(codec::FACT_DOMAIN, &bytes);
    Ok(SessionFactV1 {
        session_identity: request.session_identity.clone(),
        trading_day: proposal.trading_day,
        interval_ordinal: proposal.interval_ordinal,
        local_open: proposal.local_open,
        local_close: proposal.local_close,
        utc_open_ns: utc_open,
        utc_close_ns: utc_close,
        lineage_root: claim.source.lineage_root,
        source_binding_identity: claim.source.binding_identity,
        source_binding_fact_digest: claim.source.binding_fact_digest,
        source_binding_lineage_version: claim.source.lineage_version,
        source_frontier_digest: claim.source.frontier.digest,
        correction_frontier_digest: claim.correction.digest,
        predecessor_identity: proposal.predecessor_identity,
        correction_sequence: proposal.correction_sequence,
        provider_available_ns: claim.time.provider_available_ns,
        retrieval_ns: claim.time.retrieval_ns,
        correction_publication_ns: claim.time.correction_publication_ns,
        owner_observation_ns: claim.time.owner_observation_ns,
        decision_cut: claim.time.decision_cut,
        r0_coordinate_identity: proposal.r0_coordinate_identity,
        r0_coordinate_digest: proposal.r0_coordinate_digest,
        identity,
        canonical_bytes: bytes.into(),
    })
}

pub(super) fn resolve_boundary(
    boundary: LocalBoundaryV1,
    time_zone: &time_zone::TimeZoneReadbackV1,
) -> Result<(i128, SessionIdentityV1), SessionErrorV1> {
    if boundary.nanos_of_day
        >= u64::try_from(codec::DAY_NS).map_err(|_| SessionErrorV1::CapacityExceeded)?
    {
        return Err(SessionErrorV1::InvalidBoundary);
    }
    let local = i128::from(boundary.day)
        .checked_mul(codec::DAY_NS)
        .and_then(|v| v.checked_add(i128::from(boundary.nanos_of_day)))
        .ok_or(SessionErrorV1::CapacityExceeded)?;
    let mut candidates = Vec::new();

    for fact in time_zone.facts() {
        let offset = i128::from(fact.utc_offset_seconds())
            .checked_mul(1_000_000_000)
            .ok_or(SessionErrorV1::CapacityExceeded)?;
        let utc = local
            .checked_sub(offset)
            .ok_or(SessionErrorV1::CapacityExceeded)?;

        if utc >= fact.effective_from_ns()
            && fact.effective_until_ns().is_none_or(|until| utc < until)
        {
            candidates.push((utc, fact.identity()));
        }
    }
    candidates.sort_unstable();
    candidates.dedup();
    match (candidates.as_slice(), boundary.resolution) {
        ([], _) => Err(SessionErrorV1::GapBoundary),
        ([only], LocalResolutionV1::Exact) => Ok(*only),
        ([_, ..], LocalResolutionV1::Exact) => Err(SessionErrorV1::AmbiguousBoundary),
        ([_], _) => Err(SessionErrorV1::AmbiguousBoundary),
        (many, LocalResolutionV1::EarlierInstant) => Ok(many[0]),
        (many, LocalResolutionV1::LaterInstant) => {
            Ok(*many.last().ok_or(SessionErrorV1::GapBoundary)?)
        }
    }
}

pub(super) fn validate_census(
    request: &UntrustedSessionRequestV1,
    calendar: &calendar::CalendarReadbackV1,
    facts: &[SessionFactV1],
) -> Result<Vec<SessionDayCensusV1>, SessionErrorV1> {
    let mut by_day: BTreeMap<i32, Vec<&SessionFactV1>> = BTreeMap::new();

    if let Some(first) = facts.first()
        && facts.iter().any(|fact| {
            fact.source_binding_identity != first.source_binding_identity
                || fact.lineage_root != first.lineage_root
        })
    {
        return Err(SessionErrorV1::InvalidDependency);
    }

    for fact in facts {
        by_day.entry(fact.trading_day).or_default().push(fact);
    }
    let mut days = Vec::new();

    for day in request.first_day..request.last_day_exclusive {
        let calendar_fact = calendar
            .facts()
            .iter()
            .find(|fact| fact.day() == day)
            .ok_or(SessionErrorV1::IncompleteCensus)?;
        let entries = by_day.remove(&day).unwrap_or_default();
        if !calendar_fact.is_open() {
            if !entries.is_empty() {
                return Err(SessionErrorV1::IncompleteCensus);
            }
            days.push(SessionDayCensusV1 {
                day,
                is_open: false,
                intervals: Box::new([]),
            });
            continue;
        }

        if entries.is_empty() {
            return Err(SessionErrorV1::IncompleteCensus);
        }
        let mut intervals = Vec::new();

        for (index, fact) in entries.iter().enumerate() {
            if usize::try_from(fact.interval_ordinal)
                .map_err(|_| SessionErrorV1::CapacityExceeded)?
                != index
            {
                return Err(SessionErrorV1::NonCanonicalOrder);
            }

            if let Some(previous) = index.checked_sub(1).and_then(|i| entries.get(i))
                && (previous.utc_close_ns > fact.utc_open_ns
                    || previous.local_close != fact.local_open)
            {
                return Err(SessionErrorV1::NonCanonicalOrder);
            }
            intervals.push((fact.interval_ordinal, fact.identity, fact.identity));
        }
        days.push(SessionDayCensusV1 {
            day,
            is_open: true,
            intervals: intervals.into(),
        });
    }

    if !by_day.is_empty() {
        return Err(SessionErrorV1::IncompleteCensus);
    }
    Ok(days)
}

fn validate_dependencies(
    request: &UntrustedSessionRequestV1,
    deps: &SessionDependenciesV1<'_>,
) -> Result<(), SessionErrorV1> {
    calendar::verify_calendar_readback_v1(deps.calendar)
        .map_err(|_| SessionErrorV1::InvalidDependency)?;
    let decoded = time_zone::authority::decode_readback_v1(deps.time_zone.canonical_bytes())
        .map_err(|_| SessionErrorV1::InvalidDependency)?;
    if &decoded != deps.time_zone {
        return Err(SessionErrorV1::InvalidDependency);
    }

    if deps.calendar.cut().first_day() != request.first_day
        || deps.calendar.cut().last_day_exclusive() != request.last_day_exclusive
        || deps.calendar_cut_locator_bytes != request.calendar_cut_locator_bytes.as_ref()
        || deps.time_zone_cut_locator_bytes != request.time_zone_cut_locator_bytes.as_ref()
        || deps.source_binding_locator_bytes != request.source_binding_locator_bytes.as_ref()
        || deps.r0_locator_bytes != request.r0_locator_bytes.as_ref()
    {
        return Err(SessionErrorV1::InvalidDependency);
    }
    validate_instrument_master(&deps.instrument_master)
}
fn validate_instrument_master(value: &InstrumentMasterReferenceV1) -> Result<(), SessionErrorV1> {
    if value.locator_bytes.is_empty()
        || value.locator_bytes.len() > codec::MAX_LOCATOR_BYTES
        || [value.readback_identity, value.fact_digest, value.cut_digest]
            .iter()
            .any(|v| !codec::nonzero(*v))
    {
        Err(SessionErrorV1::InvalidDependency)
    } else {
        Ok(())
    }
}
fn validate_request(r: &UntrustedSessionRequestV1) -> Result<(), SessionErrorV1> {
    if !codec::nonzero(r.request_identity)
        || !codec::nonzero(r.stable_correlation)
        || r.session_identity.is_empty()
        || r.session_identity.len() > codec::MAX_IDENTITY_BYTES
        || r.first_day >= r.last_day_exclusive
        || r.owner_observation_ns <= 0
        || r.decision_cut == 0
        || [
            &r.calendar_cut_locator_bytes,
            &r.time_zone_cut_locator_bytes,
            &r.source_binding_locator_bytes,
            &r.r0_locator_bytes,
        ]
        .iter()
        .any(|v| v.is_empty() || v.len() > codec::MAX_LOCATOR_BYTES)
    {
        Err(SessionErrorV1::InvalidRequest)
    } else {
        Ok(())
    }
}

pub(crate) fn request_meaning_digest_v1(
    r: &UntrustedSessionRequestV1,
    im: &InstrumentMasterReferenceV1,
) -> Result<SessionIdentityV1, SessionErrorV1> {
    validate_request(r)?;
    validate_instrument_master(im)?;
    let mut b = Vec::new();
    codec::header(&mut b);
    b.push(1);
    codec::bytes(&mut b, &r.session_identity, codec::MAX_IDENTITY_BYTES)?;
    b.extend_from_slice(&r.first_day.to_be_bytes());
    b.extend_from_slice(&r.last_day_exclusive.to_be_bytes());
    for v in [
        &r.calendar_cut_locator_bytes,
        &r.time_zone_cut_locator_bytes,
        &im.locator_bytes,
        &r.source_binding_locator_bytes,
        &r.r0_locator_bytes,
    ] {
        codec::bytes(&mut b, v, codec::MAX_LOCATOR_BYTES)?;
    }
    b.extend_from_slice(&r.owner_observation_ns.to_be_bytes());
    b.extend_from_slice(&r.decision_cut.to_be_bytes());
    codec::id(&mut b, r.stable_correlation)?;
    Ok(codec::digest(codec::REQUEST_DOMAIN, &b))
}

pub(crate) fn seal_readback_v1(
    prepared: PreparedSessionResolutionV1,
    generation: SessionIdentityV1,
    sequence: u64,
) -> Result<SessionReadbackV1, SessionErrorV1> {
    if !codec::nonzero(generation) || sequence == 0 {
        return Err(SessionErrorV1::StoreUntrusted);
    }
    let mut rb = Vec::new();
    codec::header(&mut rb);
    codec::id(&mut rb, prepared.request.request_identity)?;
    codec::id(&mut rb, prepared.cut.request_meaning_digest)?;
    codec::id(&mut rb, prepared.cut.identity)?;
    codec::id(&mut rb, prepared.cut.identity)?;
    codec::id(&mut rb, generation)?;
    rb.extend_from_slice(&sequence.to_be_bytes());
    codec::id(&mut rb, prepared.request.stable_correlation)?;
    let identity = codec::digest(codec::RECEIPT_DOMAIN, &rb);
    let receipt = SessionReceiptV1 {
        request_identity: prepared.request.request_identity,
        request_meaning_digest: prepared.cut.request_meaning_digest,
        cut_identity: prepared.cut.identity,
        store_generation_identity: generation,
        append_sequence: sequence,
        stable_correlation: prepared.request.stable_correlation,
        identity,
        canonical_bytes: rb.into(),
    };
    build_readback(prepared.facts, prepared.cut, receipt, identity)
}

fn build_readback(
    facts: Box<[SessionFactV1]>,
    cut: SessionCutV1,
    receipt: SessionReceiptV1,
    outbox: SessionIdentityV1,
) -> Result<SessionReadbackV1, SessionErrorV1> {
    if outbox != receipt.identity || facts.len() != cut.fact_identities.len() {
        return Err(SessionErrorV1::StoreUntrusted);
    }
    let mut b = Vec::new();
    codec::header(&mut b);
    b.extend_from_slice(
        &u32::try_from(facts.len())
            .map_err(|_| SessionErrorV1::CapacityExceeded)?
            .to_be_bytes(),
    );

    for (fact, id) in facts.iter().zip(cut.fact_identities.iter()) {
        if fact.identity != *id
            || codec::digest(codec::FACT_DOMAIN, fact.canonical_bytes()) != fact.identity
        {
            return Err(SessionErrorV1::StoreUntrusted);
        }
        codec::id(&mut b, fact.identity)?;
        codec::bytes(&mut b, fact.canonical_bytes(), codec::MAX_FACT_BYTES)?;
    }
    codec::id(&mut b, cut.identity)?;
    codec::bytes(&mut b, cut.canonical_bytes(), codec::MAX_READBACK_BYTES)?;
    codec::id(&mut b, receipt.identity)?;
    codec::bytes(&mut b, &receipt.canonical_bytes, codec::MAX_FACT_BYTES)?;
    codec::id(&mut b, outbox)?;
    if b.len() > codec::MAX_READBACK_BYTES {
        return Err(SessionErrorV1::CapacityExceeded);
    }
    let identity = codec::digest(codec::READBACK_DOMAIN, &b);
    Ok(SessionReadbackV1 {
        facts,
        cut,
        receipt,
        outbox_identity: outbox,
        canonical_bytes: b.into(),
        identity,
    })
}

pub(crate) fn decode_readback_v1(bytes: &[u8]) -> Result<SessionReadbackV1, SessionErrorV1> {
    let mut d = codec::Decoder::new(bytes)?;
    let n = usize::try_from(d.u32()?).map_err(|_| SessionErrorV1::CapacityExceeded)?;
    if n > codec::MAX_FACTS {
        return Err(SessionErrorV1::CapacityExceeded);
    }
    let mut facts = Vec::new();

    for _ in 0..n {
        let id = d.id()?;
        let fb = d.bytes(codec::MAX_FACT_BYTES)?;
        let fact = decode_fact(&fb)?;
        if id != fact.identity {
            return Err(SessionErrorV1::StoreUntrusted);
        }
        facts.push(fact);
    }
    let cut_id = d.id()?;
    let cb = d.bytes(codec::MAX_READBACK_BYTES)?;
    let cut = decode_cut(&cb)?;
    if cut_id != cut.identity {
        return Err(SessionErrorV1::StoreUntrusted);
    }
    let receipt_id = d.id()?;
    let rb = d.bytes(codec::MAX_FACT_BYTES)?;
    let receipt = decode_receipt(&rb)?;
    if receipt_id != receipt.identity {
        return Err(SessionErrorV1::StoreUntrusted);
    }
    let outbox = d.id()?;
    d.finish()?;
    let readback = build_readback(facts.into(), cut, receipt, outbox)?;
    if readback.canonical_bytes.as_ref() != bytes {
        return Err(SessionErrorV1::StoreUntrusted);
    }
    Ok(readback)
}

pub(crate) fn rejoin_stored_v1(
    facts: &[Vec<u8>],
    cut: &[u8],
    receipt: &[u8],
    outbox: SessionIdentityV1,
    payload: &[u8],
) -> Result<SessionReadbackV1, SessionErrorV1> {
    if receipt != payload {
        return Err(SessionErrorV1::StoreUntrusted);
    }
    build_readback(
        facts
            .iter()
            .map(|b| decode_fact(b))
            .collect::<Result<Vec<_>, _>>()?
            .into(),
        decode_cut(cut)?,
        decode_receipt(receipt)?,
        outbox,
    )
}

pub(super) fn decode_fact(bytes: &[u8]) -> Result<SessionFactV1, SessionErrorV1> {
    let mut d = codec::Decoder::new(bytes)?;
    let session_identity = d.bytes(codec::MAX_IDENTITY_BYTES)?;
    let trading_day = d.i32()?;
    let interval_ordinal = d.u32()?;
    let local_open = decode_boundary(&mut d)?;
    let local_close = decode_boundary(&mut d)?;
    let utc_open_ns = d.i128()?;
    let utc_close_ns = d.i128()?;
    if utc_open_ns >= utc_close_ns {
        return Err(SessionErrorV1::StoreUntrusted);
    }

    for _ in 0..13 {
        let _ = d.id()?;
    }
    let predecessor_identity = d.opt_id()?;
    let correction_sequence = d.u64()?;
    if correction_sequence == 0 {
        return Err(SessionErrorV1::StoreUntrusted);
    }

    let provider_available_ns = d.i128()?;
    let retrieval_ns = d.i128()?;
    let correction_publication_ns = d.i128()?;
    let owner_observation_ns = d.i128()?;
    let decision_cut = d.u64()?;

    if provider_available_ns <= 0
        || correction_publication_ns <= 0
        || provider_available_ns > correction_publication_ns
        || correction_publication_ns > retrieval_ns
        || retrieval_ns > owner_observation_ns
        || decision_cut == 0
    {
        return Err(SessionErrorV1::StoreUntrusted);
    }
    let r0_coordinate_identity = d.id()?;
    let r0_coordinate_digest = d.id()?;
    let source_binding_identity = d.id()?;
    let source_binding_fact_digest = d.id()?;
    let lineage_root = d.id()?;
    let source_binding_lineage_version = d.u64()?;
    if source_binding_lineage_version != correction_sequence {
        return Err(SessionErrorV1::StoreUntrusted);
    }
    let source_frontier_digest = d.id()?;
    let correction_frontier_digest = d.id()?;
    let _correction_identity = d.id()?;
    d.finish()?;
    Ok(SessionFactV1 {
        session_identity,
        trading_day,
        interval_ordinal,
        local_open,
        local_close,
        utc_open_ns,
        utc_close_ns,
        lineage_root,
        source_binding_identity,
        source_binding_fact_digest,
        source_binding_lineage_version,
        source_frontier_digest,
        correction_frontier_digest,
        predecessor_identity,
        correction_sequence,
        provider_available_ns,
        retrieval_ns,
        correction_publication_ns,
        owner_observation_ns,
        decision_cut,
        r0_coordinate_identity,
        r0_coordinate_digest,
        identity: codec::digest(codec::FACT_DOMAIN, bytes),
        canonical_bytes: bytes.into(),
    })
}

fn decode_cut(bytes: &[u8]) -> Result<SessionCutV1, SessionErrorV1> {
    let mut d = codec::Decoder::new(bytes)?;
    let request_identity = d.id()?;
    let request_meaning_digest = d.id()?;
    if d.u8()? != 1 {
        return Err(SessionErrorV1::StoreUntrusted);
    }
    let _session = d.bytes(codec::MAX_IDENTITY_BYTES)?;
    let first = d.i32()?;
    let last = d.i32()?;
    if first >= last {
        return Err(SessionErrorV1::StoreUntrusted);
    }

    for _ in 0..7 {
        let _ = d.id()?;
    }
    let _obs = d.i128()?;
    if d.u64()? == 0 {
        return Err(SessionErrorV1::StoreUntrusted);
    }
    let _r0 = d.id()?;
    let _r0d = d.id()?;
    let count = usize::try_from(d.u32()?).map_err(|_| SessionErrorV1::CapacityExceeded)?;
    if count
        != usize::try_from(i64::from(last) - i64::from(first))
            .map_err(|_| SessionErrorV1::CapacityExceeded)?
    {
        return Err(SessionErrorV1::StoreUntrusted);
    }
    let mut days = Vec::new();
    let mut ids = Vec::new();

    for expected in first..last {
        if d.i32()? != expected {
            return Err(SessionErrorV1::StoreUntrusted);
        }
        let open = match d.u8()? {
            0 => false,
            1 => true,
            _ => return Err(SessionErrorV1::StoreUntrusted),
        };
        let n = usize::try_from(d.u32()?).map_err(|_| SessionErrorV1::CapacityExceeded)?;
        if open == n.eq(&0) {
            return Err(SessionErrorV1::StoreUntrusted);
        }
        let mut intervals = Vec::new();

        for ordinal in 0..n {
            if d.u32()? != u32::try_from(ordinal).map_err(|_| SessionErrorV1::CapacityExceeded)? {
                return Err(SessionErrorV1::StoreUntrusted);
            }
            let id = d.id()?;
            let digest = d.id()?;
            if id != digest {
                return Err(SessionErrorV1::StoreUntrusted);
            }
            ids.push(id);
            intervals.push((
                u32::try_from(ordinal).map_err(|_| SessionErrorV1::CapacityExceeded)?,
                id,
                digest,
            ));
        }
        days.push(SessionDayCensusV1 {
            day: expected,
            is_open: open,
            intervals: intervals.into(),
        });
    }

    if d.u32()? != 0 {
        return Err(SessionErrorV1::IncompleteCensus);
    }
    d.finish()?;
    Ok(SessionCutV1 {
        request_identity,
        request_meaning_digest,
        days: days.into(),
        fact_identities: ids.into(),
        identity: codec::digest(codec::CUT_DOMAIN, bytes),
        canonical_bytes: bytes.into(),
    })
}

fn decode_receipt(bytes: &[u8]) -> Result<SessionReceiptV1, SessionErrorV1> {
    let mut d = codec::Decoder::new(bytes)?;
    let request_identity = d.id()?;
    let request_meaning_digest = d.id()?;
    let cut_identity = d.id()?;
    if d.id()? != cut_identity {
        return Err(SessionErrorV1::StoreUntrusted);
    }
    let store_generation_identity = d.id()?;
    let append_sequence = d.u64()?;
    if append_sequence == 0 {
        return Err(SessionErrorV1::StoreUntrusted);
    }
    let stable_correlation = d.id()?;
    d.finish()?;
    Ok(SessionReceiptV1 {
        request_identity,
        request_meaning_digest,
        cut_identity,
        store_generation_identity,
        append_sequence,
        stable_correlation,
        identity: codec::digest(codec::RECEIPT_DOMAIN, bytes),
        canonical_bytes: bytes.into(),
    })
}

fn encode_boundary(b: &mut Vec<u8>, v: LocalBoundaryV1) {
    b.extend_from_slice(&v.day.to_be_bytes());
    b.extend_from_slice(&v.nanos_of_day.to_be_bytes());
    b.push(v.resolution as u8);
}
fn decode_boundary(d: &mut codec::Decoder<'_>) -> Result<LocalBoundaryV1, SessionErrorV1> {
    let day = d.i32()?;
    let nanos_of_day = d.u64()?;
    if i128::from(nanos_of_day) >= codec::DAY_NS {
        return Err(SessionErrorV1::StoreUntrusted);
    }
    let resolution = match d.u8()? {
        1 => LocalResolutionV1::Exact,
        2 => LocalResolutionV1::EarlierInstant,
        3 => LocalResolutionV1::LaterInstant,
        _ => return Err(SessionErrorV1::StoreUntrusted),
    };
    Ok(LocalBoundaryV1 {
        day,
        nanos_of_day,
        resolution,
    })
}
fn encode_opt_id(b: &mut Vec<u8>, v: Option<SessionIdentityV1>) -> Result<(), SessionErrorV1> {
    match v {
        None => b.push(0),
        Some(v) => {
            b.push(1);
            codec::id(b, v)?;
        }
    }
    Ok(())
}
