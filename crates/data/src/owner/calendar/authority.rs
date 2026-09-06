#![allow(
    dead_code,
    reason = "Calendar product composition is intentionally not registered"
)]

use std::collections::{BTreeMap, BTreeSet};

use super::{
    CalendarConsumerV1, CalendarCutV1, CalendarErrorV1, CalendarFactV1, CalendarIdentityV1,
    CalendarReadbackV1, CalendarReceiptV1, UntrustedCalendarRequestV1, codec,
};
use crate::owner::{
    instrument_master::{InstrumentMasterReadbackV1, verify_instrument_master_readback},
    reference_fact_catalog::{
        ReferenceFactCatalogEntryV1, ReferenceFactCatalogKindV1, ReferenceFactCatalogValueV1,
        UntrustedReferenceFactCatalogLocatorV1,
    },
    reference_fact_coordinates::VerifiedReferenceFactCoordinatesV1,
};

const DAY_NS: i128 = 86_400_000_000_000;

#[derive(Clone, Debug)]
pub(crate) struct CalendarFactProposalV1 {
    pub(crate) catalog_locator: UntrustedReferenceFactCatalogLocatorV1,
    pub(crate) native_predecessor_identity: Option<CalendarIdentityV1>,
    pub(crate) coordinates: VerifiedReferenceFactCoordinatesV1,
    pub(crate) r0_coordinate_identity: CalendarIdentityV1,
    pub(crate) r0_coordinate_digest: CalendarIdentityV1,
}

#[derive(Clone, Copy)]
pub(crate) struct CalendarAuthenticatedInputsV1<'a> {
    pub(crate) instrument_master: &'a InstrumentMasterReadbackV1,
    pub(crate) source_binding_locator_bytes: &'a [u8],
    pub(crate) r0_locator_bytes: &'a [u8],
    pub(crate) r0_cut_identity: CalendarIdentityV1,
    pub(crate) r0_cut_digest: CalendarIdentityV1,
}

#[derive(Debug)]
pub(crate) struct PreparedCalendarCutV1 {
    pub(crate) facts: Box<[CalendarFactV1]>,
    pub(crate) cut: CalendarCutV1,
    pub(crate) stable_correlation: CalendarIdentityV1,
}

pub(crate) fn request_meaning_digest(
    request: &UntrustedCalendarRequestV1,
) -> Result<CalendarIdentityV1, CalendarErrorV1> {
    Ok(codec::digest(
        codec::REQUEST_DOMAIN,
        &encode_request_meaning(request)?,
    ))
}

pub(crate) fn prepare_calendar_cut_v1(
    request: &UntrustedCalendarRequestV1,
    proposals: Vec<CalendarFactProposalV1>,
    catalog_entries: Vec<ReferenceFactCatalogEntryV1>,
    authenticated: CalendarAuthenticatedInputsV1<'_>,
) -> Result<PreparedCalendarCutV1, CalendarErrorV1> {
    validate_request(request)?;
    if request.source_binding_locator_bytes() != authenticated.source_binding_locator_bytes
        || request.r0_locator_bytes() != authenticated.r0_locator_bytes
        || !codec::nonzero(authenticated.r0_cut_identity)
        || !codec::nonzero(authenticated.r0_cut_digest)
        || !verify_instrument_master_readback(authenticated.instrument_master)
        || authenticated.instrument_master.facts().is_empty()
        || authenticated
            .instrument_master
            .facts()
            .iter()
            .any(|fact| fact.calendar_identity().as_bytes() != request.calendar_identity())
    {
        return Err(CalendarErrorV1::DependencyMismatch);
    }

    let expected = expected_day_count(request)?;
    if proposals.len() != expected || catalog_entries.len() != expected {
        return Err(CalendarErrorV1::CoverageGap);
    }

    let mut by_day = BTreeMap::new();

    for (proposal, catalog_entry) in proposals.into_iter().zip(catalog_entries) {
        let fact = build_fact(request, &proposal, &catalog_entry)?;
        if by_day.insert(fact.day, fact).is_some() {
            return Err(CalendarErrorV1::CoverageGap);
        }
    }

    for (offset, day) in (request.first_day()..request.last_day_exclusive()).enumerate() {
        if !by_day.contains_key(&day) || offset >= codec::MAX_DAYS {
            return Err(CalendarErrorV1::CoverageGap);
        }
    }

    let facts = by_day.into_values().collect::<Vec<_>>().into_boxed_slice();
    let day_entries = facts
        .iter()
        .map(|fact| (fact.day, fact.identity, fact.identity))
        .collect::<Vec<_>>()
        .into_boxed_slice();
    let mut cut = CalendarCutV1 {
        request_identity: request.request_identity(),
        request_meaning_digest: request.request_meaning_digest(),
        consumer: request.consumer(),
        calendar_identity: request.calendar_identity().into(),
        first_day: request.first_day(),
        last_day_exclusive: request.last_day_exclusive(),
        owner_observation_ns: request.owner_observation_ns(),
        decision_cut: request.decision_cut(),
        r0_cut_identity: authenticated.r0_cut_identity,
        r0_cut_digest: authenticated.r0_cut_digest,
        days: day_entries,
        gaps: Box::new([]),
        canonical_bytes: Box::new([]),
        identity: zero(),
    };
    cut.canonical_bytes = encode_cut(&cut)?;
    cut.identity = codec::digest(codec::CUT_DOMAIN, &cut.canonical_bytes);
    verify_cut(request, &facts, &cut)?;
    Ok(PreparedCalendarCutV1 {
        facts,
        cut,
        stable_correlation: request.stable_correlation(),
    })
}

fn build_fact(
    request: &UntrustedCalendarRequestV1,
    proposal: &CalendarFactProposalV1,
    catalog: &ReferenceFactCatalogEntryV1,
) -> Result<CalendarFactV1, CalendarErrorV1> {
    let claim = proposal.coordinates.claim();
    let ReferenceFactCatalogValueV1::Calendar {
        calendar_identity,
        day,
        is_open,
    } = catalog.value()
    else {
        return Err(CalendarErrorV1::DependencyMismatch);
    };
    let predecessor = proposal.native_predecessor_identity;
    let source = catalog.source();

    if catalog.locator() != proposal.catalog_locator
        || catalog.value().kind() != ReferenceFactCatalogKindV1::Calendar
        || calendar_identity.as_ref() != request.calendar_identity()
        || *day < request.first_day()
        || *day >= request.last_day_exclusive()
        || catalog.correction_sequence() == 0
        || !codec::nonzero(proposal.r0_coordinate_identity)
        || (!codec::nonzero(proposal.r0_coordinate_digest))
        || matches!(
            (
                catalog.correction_sequence(),
                catalog.predecessor_identity(),
                predecessor
            ),
            (1, Some(_), _) | (1, _, Some(_)) | (2.., None, _) | (2.., _, None)
        )
        || claim.stable_correlation != request.stable_correlation()
        || catalog.stable_correlation() != claim.stable_correlation
        || claim.pit.decision_cut != request.decision_cut()
        || i128::from(claim.pit.observed_at) != request.owner_observation_ns()
        || claim.time.owner_observation_ns != request.owner_observation_ns()
        || claim.time.decision_cut != request.decision_cut()
        || claim.source.binding_identity.as_bytes() == &[0; 32]
        || !claim.source.admitted
        || source.source_binding_identity != claim.source.binding_identity
        || source.source_binding_fact_digest != claim.source.binding_fact_digest
        || source.source_binding_lineage_root != claim.source.lineage_root
        || source.source_binding_lineage_version != claim.source.lineage_version
        || source.source_frontier_digest != claim.source.frontier.digest
        || source.correction_frontier_digest != claim.correction.digest
    {
        return Err(CalendarErrorV1::DependencyMismatch);
    }
    let day_start = i128::from(*day)
        .checked_mul(DAY_NS)
        .ok_or(CalendarErrorV1::InvalidFact)?;
    let day_end = day_start
        .checked_add(DAY_NS)
        .ok_or(CalendarErrorV1::InvalidFact)?;

    if catalog.effective_from_ns() >= day_end
        || catalog
            .effective_until_ns()
            .is_some_and(|until| until <= day_start)
    {
        return Err(CalendarErrorV1::InvalidFact);
    }

    let mut fact = CalendarFactV1 {
        calendar_identity: calendar_identity.clone(),
        day: *day,
        is_open: *is_open,
        catalog_entry_identity: catalog.identity(),
        lineage_root: catalog.scope_identity(),
        correction_sequence: catalog.correction_sequence(),
        predecessor_identity: predecessor,
        effective_from_ns: catalog.effective_from_ns(),
        effective_until_ns: catalog.effective_until_ns(),
        provider_available_ns: claim.time.provider_available_ns,
        retrieval_ns: claim.time.retrieval_ns,
        correction_publication_ns: claim.time.correction_publication_ns,
        owner_observation_ns: claim.time.owner_observation_ns,
        decision_cut: claim.time.decision_cut,
        r0_coordinate_identity: proposal.r0_coordinate_identity,
        r0_coordinate_digest: proposal.r0_coordinate_digest,
        source_binding_identity: claim.source.binding_identity,
        source_binding_fact_digest: claim.source.binding_fact_digest,
        source_binding_lineage_root: claim.source.lineage_root,
        source_binding_lineage_version: claim.source.lineage_version,
        source_frontier_digest: claim.source.frontier.digest,
        correction_frontier_digest: claim.correction.digest,
        canonical_bytes: Box::new([]),
        identity: zero(),
    };
    fact.canonical_bytes = encode_fact(&fact)?;
    fact.identity = codec::digest(codec::FACT_DOMAIN, &fact.canonical_bytes);
    Ok(fact)
}

pub(crate) fn build_readback(
    prepared: PreparedCalendarCutV1,
    store_generation_identity: CalendarIdentityV1,
    append_sequence: u64,
) -> Result<CalendarReadbackV1, CalendarErrorV1> {
    if !codec::nonzero(store_generation_identity) || append_sequence == 0 {
        return Err(CalendarErrorV1::InvalidRequest);
    }
    let outbox_identity = receipt_identity_without_outbox(
        prepared.cut.request_identity,
        prepared.cut.request_meaning_digest,
        prepared.cut.identity,
        store_generation_identity,
        append_sequence,
        prepared.stable_correlation,
    )?;
    let mut receipt = CalendarReceiptV1 {
        request_identity: prepared.cut.request_identity,
        request_meaning_digest: prepared.cut.request_meaning_digest,
        cut_identity: prepared.cut.identity,
        cut_digest: prepared.cut.identity,
        store_generation_identity,
        append_sequence,
        stable_correlation: prepared.stable_correlation,
        outbox_identity,
        canonical_bytes: Box::new([]),
        identity: zero(),
    };
    receipt.canonical_bytes = encode_receipt(&receipt)?;
    receipt.identity = codec::digest(codec::RECEIPT_DOMAIN, &receipt.canonical_bytes);
    if receipt.identity != outbox_identity {
        return Err(CalendarErrorV1::DigestMismatch);
    }
    let mut readback = CalendarReadbackV1 {
        facts: prepared.facts,
        cut: prepared.cut,
        receipt,
        outbox_identity,
        canonical_bytes: Box::new([]),
        identity: zero(),
    };
    readback.canonical_bytes = encode_readback(&readback)?;
    readback.identity = codec::digest(codec::READBACK_DOMAIN, &readback.canonical_bytes);
    verify_calendar_readback_v1(&readback)?;
    Ok(readback)
}

// The receipt identity is generation-bound and the outbox identity is exactly that receipt identity.
// Receipt bytes therefore do not encode an independently derived outbox value.
fn receipt_identity_without_outbox(
    request_identity: CalendarIdentityV1,
    request_meaning_digest: CalendarIdentityV1,
    cut_identity: CalendarIdentityV1,
    store_generation_identity: CalendarIdentityV1,
    append_sequence: u64,
    stable_correlation: CalendarIdentityV1,
) -> Result<CalendarIdentityV1, CalendarErrorV1> {
    let mut encoder = codec::Encoder::default();
    encoder.u16(codec::VERSION);
    encoder.u16(0);
    encoder.identity(request_identity);
    encoder.identity(request_meaning_digest);
    encoder.identity(cut_identity);
    encoder.identity(cut_identity);
    encoder.identity(store_generation_identity);
    encoder.u64(append_sequence);
    encoder.identity(stable_correlation);
    Ok(codec::digest(codec::RECEIPT_DOMAIN, &encoder.finish()?))
}

/// Verifies every nested Calendar identity, byte encoding, dependency binding, and day census.
///
/// # Errors
///
/// Returns [`CalendarErrorV1`] when any stored byte sequence, digest, lineage, dependency binding,
/// or coverage invariant is invalid.
pub fn verify_calendar_readback_v1(readback: &CalendarReadbackV1) -> Result<(), CalendarErrorV1> {
    let expected_count = i64::from(readback.cut.last_day_exclusive)
        .checked_sub(i64::from(readback.cut.first_day))
        .and_then(|value| usize::try_from(value).ok())
        .filter(|value| *value > 0 && *value <= codec::MAX_DAYS)
        .ok_or(CalendarErrorV1::CoverageGap)?;

    if readback.facts.is_empty()
        || readback.facts.len() != expected_count
        || !readback.cut.gaps.is_empty()
        || readback.receipt.request_identity != readback.cut.request_identity
        || readback.receipt.request_meaning_digest != readback.cut.request_meaning_digest
        || readback.receipt.cut_identity != readback.cut.identity
        || readback.receipt.cut_digest != readback.cut.identity
        || readback.outbox_identity != readback.receipt.identity
        || readback.receipt.outbox_identity != readback.receipt.identity
        || codec::digest(codec::CUT_DOMAIN, &readback.cut.canonical_bytes) != readback.cut.identity
        || codec::digest(codec::RECEIPT_DOMAIN, &readback.receipt.canonical_bytes)
            != readback.receipt.identity
        || codec::digest(codec::READBACK_DOMAIN, &readback.canonical_bytes) != readback.identity
        || encode_cut(&readback.cut)? != readback.cut.canonical_bytes
        || encode_receipt(&readback.receipt)? != readback.receipt.canonical_bytes
        || encode_readback(readback)? != readback.canonical_bytes
    {
        return Err(CalendarErrorV1::DigestMismatch);
    }
    let mut days = BTreeSet::new();

    for (offset, (fact, (day, identity, digest))) in readback
        .facts
        .iter()
        .zip(readback.cut.days.iter())
        .enumerate()
    {
        let expected_day = readback
            .cut
            .first_day
            .checked_add(i32::try_from(offset).map_err(|_| CalendarErrorV1::CapacityExceeded)?)
            .ok_or(CalendarErrorV1::CapacityExceeded)?;

        if fact.day != *day
            || *day != expected_day
            || fact.identity != *identity
            || fact.identity != *digest
            || fact.calendar_identity != readback.cut.calendar_identity
            || !days.insert(fact.day)
            || encode_fact(fact)? != fact.canonical_bytes
            || codec::digest(codec::FACT_DOMAIN, &fact.canonical_bytes) != fact.identity
        {
            return Err(CalendarErrorV1::DigestMismatch);
        }
    }

    if days.len() != readback.facts.len() || readback.facts.len() != readback.cut.days.len() {
        return Err(CalendarErrorV1::CoverageGap);
    }
    Ok(())
}

pub(crate) fn encode_request_meaning(
    request: &UntrustedCalendarRequestV1,
) -> Result<Box<[u8]>, CalendarErrorV1> {
    let mut encoder = codec::Encoder::default();
    encoder.u16(codec::VERSION);
    encoder.u16(0);
    encoder.u16(request.consumer() as u16);
    encoder.bytes(request.calendar_identity(), codec::MAX_IDENTITY_BYTES)?;
    encoder.i32(request.first_day());
    encoder.i32(request.last_day_exclusive());
    encoder.i128(request.owner_observation_ns());
    encoder.u64(request.decision_cut());
    encoder.bytes(
        request.source_binding_locator_bytes(),
        codec::MAX_LOCATOR_BYTES,
    )?;
    encoder.bytes(request.r0_locator_bytes(), codec::MAX_LOCATOR_BYTES)?;
    encoder.identity(request.stable_correlation());
    encoder.finish()
}

pub(crate) fn encode_fact(fact: &CalendarFactV1) -> Result<Box<[u8]>, CalendarErrorV1> {
    let mut encoder = codec::Encoder::default();
    encoder.u16(codec::VERSION);
    encoder.u16(0);
    encoder.bytes(&fact.calendar_identity, codec::MAX_IDENTITY_BYTES)?;
    encoder.i32(fact.day);
    encoder.bool(fact.is_open);
    encoder.identity(fact.catalog_entry_identity);
    encoder.identity(fact.lineage_root);
    encoder.u64(fact.correction_sequence);
    encoder.optional_identity(fact.predecessor_identity);
    encoder.i128(fact.effective_from_ns);
    encoder.optional_i128(fact.effective_until_ns);
    encoder.i128(fact.provider_available_ns);
    encoder.i128(fact.retrieval_ns);
    encoder.i128(fact.correction_publication_ns);
    encoder.i128(fact.owner_observation_ns);
    encoder.u64(fact.decision_cut);
    encoder.identity(fact.r0_coordinate_identity);
    encoder.identity(fact.r0_coordinate_digest);
    encoder.identity(fact.source_binding_identity);
    encoder.identity(fact.source_binding_fact_digest);
    encoder.identity(fact.source_binding_lineage_root);
    encoder.u64(fact.source_binding_lineage_version);
    encoder.identity(fact.source_frontier_digest);
    encoder.identity(fact.correction_frontier_digest);
    encoder.finish()
}

pub(crate) fn encode_cut(cut: &CalendarCutV1) -> Result<Box<[u8]>, CalendarErrorV1> {
    let mut encoder = codec::Encoder::default();
    encoder.u16(codec::VERSION);
    encoder.u16(0);
    encoder.identity(cut.request_identity);
    encoder.identity(cut.request_meaning_digest);
    encoder.u16(cut.consumer as u16);
    encoder.bytes(&cut.calendar_identity, codec::MAX_IDENTITY_BYTES)?;
    encoder.i32(cut.first_day);
    encoder.i32(cut.last_day_exclusive);
    encoder.i128(cut.owner_observation_ns);
    encoder.u64(cut.decision_cut);
    encoder.identity(cut.r0_cut_identity);
    encoder.identity(cut.r0_cut_digest);
    encoder.u32(u32::try_from(cut.days.len()).map_err(|_| CalendarErrorV1::CapacityExceeded)?);
    for (day, identity, digest) in &cut.days {
        encoder.i32(*day);
        encoder.identity(*identity);
        encoder.identity(*digest);
    }
    encoder.u32(u32::try_from(cut.gaps.len()).map_err(|_| CalendarErrorV1::CapacityExceeded)?);
    for day in &cut.gaps {
        encoder.i32(*day);
    }
    encoder.finish()
}

pub(crate) fn encode_receipt(receipt: &CalendarReceiptV1) -> Result<Box<[u8]>, CalendarErrorV1> {
    let mut encoder = codec::Encoder::default();
    encoder.u16(codec::VERSION);
    encoder.u16(0);
    encoder.identity(receipt.request_identity);
    encoder.identity(receipt.request_meaning_digest);
    encoder.identity(receipt.cut_identity);
    encoder.identity(receipt.cut_digest);
    encoder.identity(receipt.store_generation_identity);
    encoder.u64(receipt.append_sequence);
    encoder.identity(receipt.stable_correlation);
    encoder.finish()
}

pub(crate) fn encode_readback(readback: &CalendarReadbackV1) -> Result<Box<[u8]>, CalendarErrorV1> {
    let mut encoder = codec::Encoder::default();
    encoder.u16(codec::VERSION);
    encoder.u16(0);
    encoder
        .u32(u32::try_from(readback.facts.len()).map_err(|_| CalendarErrorV1::CapacityExceeded)?);
    for fact in &readback.facts {
        encoder.identity(fact.identity);
        encoder.bytes(&fact.canonical_bytes, codec::MAX_ARTIFACT_BYTES)?;
    }
    encoder.identity(readback.cut.identity);
    encoder.bytes(&readback.cut.canonical_bytes, codec::MAX_ARTIFACT_BYTES)?;
    encoder.identity(readback.receipt.identity);
    encoder.bytes(&readback.receipt.canonical_bytes, codec::MAX_ARTIFACT_BYTES)?;
    encoder.identity(readback.outbox_identity);
    encoder.finish()
}

pub(crate) fn decode_readback(bytes: &[u8]) -> Result<CalendarReadbackV1, CalendarErrorV1> {
    let mut decoder = codec::Decoder::new(bytes);
    require_header(&mut decoder)?;
    let count = usize::try_from(decoder.u32()?).map_err(|_| CalendarErrorV1::CapacityExceeded)?;
    if count == 0 || count > codec::MAX_DAYS {
        return Err(CalendarErrorV1::CapacityExceeded);
    }
    let mut facts = Vec::with_capacity(count);
    for _ in 0..count {
        let identity = decoder.identity()?;
        let fact_bytes = decoder.bytes(codec::MAX_ARTIFACT_BYTES)?;
        facts.push(decode_fact(&fact_bytes, identity)?);
    }
    let cut_identity = decoder.identity()?;
    let cut_bytes = decoder.bytes(codec::MAX_ARTIFACT_BYTES)?;
    let cut = decode_cut(&cut_bytes, cut_identity)?;
    let receipt_identity = decoder.identity()?;
    let receipt_bytes = decoder.bytes(codec::MAX_ARTIFACT_BYTES)?;
    let receipt = decode_receipt(&receipt_bytes, receipt_identity)?;
    let outbox_identity = decoder.identity()?;
    decoder.finish()?;
    let mut readback = CalendarReadbackV1 {
        facts: facts.into_boxed_slice(),
        cut,
        receipt,
        outbox_identity,
        canonical_bytes: bytes.into(),
        identity: codec::digest(codec::READBACK_DOMAIN, bytes),
    };
    // Keep the stored exact bytes; verifier recomputes all nested projections.
    readback.canonical_bytes = bytes.into();
    verify_calendar_readback_v1(&readback)?;
    Ok(readback)
}

pub(crate) fn decode_fact(
    bytes: &[u8],
    identity: CalendarIdentityV1,
) -> Result<CalendarFactV1, CalendarErrorV1> {
    let mut d = codec::Decoder::new(bytes);
    require_header(&mut d)?;
    let fact = CalendarFactV1 {
        calendar_identity: d.bytes(codec::MAX_IDENTITY_BYTES)?,
        day: d.i32()?,
        is_open: d.bool()?,
        catalog_entry_identity: d.identity()?,
        lineage_root: d.identity()?,
        correction_sequence: d.u64()?,
        predecessor_identity: d.optional_identity()?,
        effective_from_ns: d.i128()?,
        effective_until_ns: d.optional_i128()?,
        provider_available_ns: d.i128()?,
        retrieval_ns: d.i128()?,
        correction_publication_ns: d.i128()?,
        owner_observation_ns: d.i128()?,
        decision_cut: d.u64()?,
        r0_coordinate_identity: d.identity()?,
        r0_coordinate_digest: d.identity()?,
        source_binding_identity: d.identity()?,
        source_binding_fact_digest: d.identity()?,
        source_binding_lineage_root: d.identity()?,
        source_binding_lineage_version: d.u64()?,
        source_frontier_digest: d.identity()?,
        correction_frontier_digest: d.identity()?,
        canonical_bytes: bytes.into(),
        identity,
    };
    d.finish()?;

    if codec::digest(codec::FACT_DOMAIN, bytes) != identity || encode_fact(&fact)?.as_ref() != bytes
    {
        return Err(CalendarErrorV1::DigestMismatch);
    }
    Ok(fact)
}

pub(crate) fn decode_cut(
    bytes: &[u8],
    identity: CalendarIdentityV1,
) -> Result<CalendarCutV1, CalendarErrorV1> {
    let mut d = codec::Decoder::new(bytes);
    require_header(&mut d)?;
    let request_identity = d.identity()?;
    let request_meaning_digest = d.identity()?;
    let consumer = decode_consumer(d.u16()?)?;
    let calendar_identity = d.bytes(codec::MAX_IDENTITY_BYTES)?;
    let first_day = d.i32()?;
    let last_day_exclusive = d.i32()?;
    let owner_observation_ns = d.i128()?;
    let decision_cut = d.u64()?;
    let r0_cut_identity = d.identity()?;
    let r0_cut_digest = d.identity()?;
    let count = usize::try_from(d.u32()?).map_err(|_| CalendarErrorV1::CapacityExceeded)?;
    if count == 0 || count > codec::MAX_DAYS {
        return Err(CalendarErrorV1::CapacityExceeded);
    }
    let mut days = Vec::with_capacity(count);
    for _ in 0..count {
        days.push((d.i32()?, d.identity()?, d.identity()?));
    }
    let gap_count = usize::try_from(d.u32()?).map_err(|_| CalendarErrorV1::CapacityExceeded)?;
    if gap_count > codec::MAX_DAYS {
        return Err(CalendarErrorV1::CapacityExceeded);
    }
    let mut gaps = Vec::with_capacity(gap_count);
    for _ in 0..gap_count {
        gaps.push(d.i32()?);
    }
    d.finish()?;
    let cut = CalendarCutV1 {
        request_identity,
        request_meaning_digest,
        consumer,
        calendar_identity,
        first_day,
        last_day_exclusive,
        owner_observation_ns,
        decision_cut,
        r0_cut_identity,
        r0_cut_digest,
        days: days.into_boxed_slice(),
        gaps: gaps.into_boxed_slice(),
        canonical_bytes: bytes.into(),
        identity,
    };

    if codec::digest(codec::CUT_DOMAIN, bytes) != identity || encode_cut(&cut)?.as_ref() != bytes {
        return Err(CalendarErrorV1::DigestMismatch);
    }
    Ok(cut)
}

pub(crate) fn decode_receipt(
    bytes: &[u8],
    identity: CalendarIdentityV1,
) -> Result<CalendarReceiptV1, CalendarErrorV1> {
    let mut d = codec::Decoder::new(bytes);
    require_header(&mut d)?;
    let mut receipt = CalendarReceiptV1 {
        request_identity: d.identity()?,
        request_meaning_digest: d.identity()?,
        cut_identity: d.identity()?,
        cut_digest: d.identity()?,
        store_generation_identity: d.identity()?,
        append_sequence: d.u64()?,
        stable_correlation: d.identity()?,
        outbox_identity: identity,
        canonical_bytes: bytes.into(),
        identity,
    };
    d.finish()?;
    receipt.outbox_identity = identity;
    if codec::digest(codec::RECEIPT_DOMAIN, bytes) != identity
        || encode_receipt(&receipt)?.as_ref() != bytes
    {
        return Err(CalendarErrorV1::DigestMismatch);
    }
    Ok(receipt)
}

fn validate_request(request: &UntrustedCalendarRequestV1) -> Result<(), CalendarErrorV1> {
    if !codec::nonzero(request.request_identity())
        || !codec::nonzero(request.stable_correlation())
        || request.calendar_identity().is_empty()
        || request.calendar_identity().len() > codec::MAX_IDENTITY_BYTES
        || request.first_day() >= request.last_day_exclusive()
        || request.owner_observation_ns() <= 0
        || request.decision_cut() == 0
        || request.source_binding_locator_bytes().is_empty()
        || request.r0_locator_bytes().is_empty()
        || expected_day_count(request).is_err()
        || request_meaning_digest(request)? != request.request_meaning_digest()
    {
        return Err(CalendarErrorV1::InvalidRequest);
    }
    Ok(())
}

fn verify_cut(
    request: &UntrustedCalendarRequestV1,
    facts: &[CalendarFactV1],
    cut: &CalendarCutV1,
) -> Result<(), CalendarErrorV1> {
    if !cut.gaps.is_empty()
        || cut.days.len() != expected_day_count(request)?
        || cut.days.len() != facts.len()
    {
        return Err(CalendarErrorV1::CoverageGap);
    }

    for (offset, ((day, identity, digest), fact)) in cut.days.iter().zip(facts).enumerate() {
        let expected_day = request
            .first_day()
            .checked_add(i32::try_from(offset).map_err(|_| CalendarErrorV1::CapacityExceeded)?)
            .ok_or(CalendarErrorV1::CapacityExceeded)?;

        if *day != expected_day
            || fact.day != expected_day
            || *identity != fact.identity
            || *digest != fact.identity
        {
            return Err(CalendarErrorV1::CoverageGap);
        }
    }
    Ok(())
}

fn expected_day_count(request: &UntrustedCalendarRequestV1) -> Result<usize, CalendarErrorV1> {
    let count = i64::from(request.last_day_exclusive()) - i64::from(request.first_day());
    let count = usize::try_from(count).map_err(|_| CalendarErrorV1::CapacityExceeded)?;
    if count == 0 || count > codec::MAX_DAYS {
        Err(CalendarErrorV1::CapacityExceeded)
    } else {
        Ok(count)
    }
}

fn decode_consumer(value: u16) -> Result<CalendarConsumerV1, CalendarErrorV1> {
    match value {
        1 => Ok(CalendarConsumerV1::Pit),
        2 => Ok(CalendarConsumerV1::InstrumentMaster),
        3 => Ok(CalendarConsumerV1::ReplayV2),
        4 => Ok(CalendarConsumerV1::Bar),
        _ => Err(CalendarErrorV1::CodecMismatch),
    }
}

fn require_header(decoder: &mut codec::Decoder<'_>) -> Result<(), CalendarErrorV1> {
    if decoder.u16()? == codec::VERSION && decoder.u16()? == 0 {
        Ok(())
    } else {
        Err(CalendarErrorV1::CodecMismatch)
    }
}

const fn zero() -> CalendarIdentityV1 {
    CalendarIdentityV1::from_untrusted_bytes([0; 32])
}
