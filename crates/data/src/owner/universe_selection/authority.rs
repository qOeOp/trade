#![allow(
    dead_code,
    reason = "Owner-private W1 issuance is composed by the PostgreSQL seam"
)]

use std::collections::{BTreeMap, BTreeSet};

use super::{
    HistoricalMembershipRecordV1, UniverseSelectionErrorV1, UniverseSelectionIdentity,
    UniverseSelectionReadbackV1, UniverseSelectionReceiptV1, UniverseSelectionRecordV1,
    UntrustedUniverseSelectionRequestV1,
    codec::{self, Decoder, Encoder},
};

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct HistoricalMembershipFactProposalV1 {
    pub(crate) member_key: Vec<u8>,
    pub(crate) instrument: Vec<u8>,
    pub(crate) predecessor_identity: Option<UniverseSelectionIdentity>,
    pub(crate) effective_from_ns: i128,
    pub(crate) effective_until_ns: Option<i128>,
    pub(crate) provider_available_ns: i128,
    pub(crate) retrieval_ns: i128,
    pub(crate) correction_publication_ns: i128,
    pub(crate) owner_observation_ns: i128,
    pub(crate) decision_cut: u64,
    pub(crate) source_binding_lineage_root: UniverseSelectionIdentity,
    pub(crate) correction_frontier_digest: UniverseSelectionIdentity,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct HistoricalMembershipSourceFactV1 {
    pub(crate) proposal: HistoricalMembershipFactProposalV1,
    canonical_bytes: Box<[u8]>,
    identity: UniverseSelectionIdentity,
}

impl HistoricalMembershipSourceFactV1 {
    pub(crate) fn member_key(&self) -> &[u8] {
        &self.proposal.member_key
    }
    pub(crate) fn instrument(&self) -> &[u8] {
        &self.proposal.instrument
    }
    pub(crate) const fn identity(&self) -> UniverseSelectionIdentity {
        self.identity
    }
    pub(crate) const fn predecessor_identity(&self) -> Option<UniverseSelectionIdentity> {
        self.proposal.predecessor_identity
    }
    pub(crate) fn canonical_bytes(&self) -> &[u8] {
        &self.canonical_bytes
    }
    pub(crate) const fn decision_cut(&self) -> u64 {
        self.proposal.decision_cut
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct UniverseMembershipDispositionV1 {
    pub(crate) included: bool,
    pub(crate) exclusion_reason: Option<Vec<u8>>,
}

pub(crate) trait UniverseSelectionRuleEvaluatorV1: Send + Sync {
    fn evaluate(
        &self,
        selection_rule_identity: UniverseSelectionIdentity,
        selection_rule_bytes: &[u8],
        fact: &HistoricalMembershipSourceFactV1,
    ) -> Result<UniverseMembershipDispositionV1, UniverseSelectionErrorV1>;
}

/// Owner-private deterministic grammar: `00 01 01` selects all; `00 01 02 <prefix>` selects
/// instruments having the supplied non-empty byte prefix. Unsupported rules fail closed.
pub(crate) struct CanonicalUniverseSelectionRuleEvaluatorV1;

impl UniverseSelectionRuleEvaluatorV1 for CanonicalUniverseSelectionRuleEvaluatorV1 {
    fn evaluate(
        &self,
        _selection_rule_identity: UniverseSelectionIdentity,
        selection_rule_bytes: &[u8],
        fact: &HistoricalMembershipSourceFactV1,
    ) -> Result<UniverseMembershipDispositionV1, UniverseSelectionErrorV1> {
        let included = match selection_rule_bytes {
            [0, 1, 1] => true,
            [0, 1, 2, prefix @ ..] if !prefix.is_empty() => fact.instrument().starts_with(prefix),
            _ => return Err(UniverseSelectionErrorV1::EvaluatorUnavailable),
        };
        Ok(UniverseMembershipDispositionV1 {
            included,
            exclusion_reason: (!included).then(|| b"RULE_FILTERED_V1".to_vec()),
        })
    }
}

pub(crate) fn request_meaning_digest(
    request: &UntrustedUniverseSelectionRequestV1,
) -> Result<UniverseSelectionIdentity, UniverseSelectionErrorV1> {
    let mut encoder = Encoder::default();
    encoder.u16(codec::VERSION);
    encoder.bytes(request.requester_role.as_bytes(), codec::MAX_ROLE_BYTES)?;
    encoder.digest(request.selection_rule_identity);
    encoder.bytes(&request.selection_rule_bytes, codec::MAX_RULE_BYTES)?;
    encoder.digest(request.eligible_instrument_frontier);
    encoder.i128(request.effective_at_ns);
    encoder.i128(request.owner_observation_ns);
    encoder.u64(request.decision_cut);
    encoder.digest(request.source_binding_lineage_root);
    encoder.digest(request.correction_frontier_digest);
    encoder.digest(request.stable_correlation);
    Ok(codec::digest(codec::REQUEST_DOMAIN, &encoder.finish()?))
}

pub(crate) fn validate_request(
    request: &UntrustedUniverseSelectionRequestV1,
) -> Result<(), UniverseSelectionErrorV1> {
    let identities = [
        request.request_identity,
        request.selection_rule_identity,
        request.eligible_instrument_frontier,
        request.source_binding_lineage_root,
        request.correction_frontier_digest,
        request.stable_correlation,
    ];
    if identities.into_iter().any(|value| !codec::nonzero(value))
        || request.requester_role.is_empty()
        || request.requester_role.len() > codec::MAX_ROLE_BYTES
        || request.selection_rule_bytes.is_empty()
        || request.selection_rule_bytes.len() > codec::MAX_RULE_BYTES
        || request.decision_cut == 0
        || request.owner_observation_ns < request.effective_at_ns
        || request.request_meaning_digest != request_meaning_digest(request)?
    {
        return Err(UniverseSelectionErrorV1::InvalidRequest);
    }
    Ok(())
}

pub(crate) fn issue_source_fact_v1(
    proposal: HistoricalMembershipFactProposalV1,
) -> Result<HistoricalMembershipSourceFactV1, UniverseSelectionErrorV1> {
    if proposal.member_key.is_empty()
        || proposal.instrument.is_empty()
        || proposal.member_key.len() > codec::MAX_MEMBER_FIELD_BYTES
        || proposal.instrument.len() > codec::MAX_MEMBER_FIELD_BYTES
        || proposal
            .effective_until_ns
            .is_some_and(|until| until <= proposal.effective_from_ns)
        || proposal.provider_available_ns > proposal.owner_observation_ns
        || proposal.retrieval_ns > proposal.owner_observation_ns
        || proposal.correction_publication_ns > proposal.owner_observation_ns
        || proposal.decision_cut == 0
        || !codec::nonzero(proposal.source_binding_lineage_root)
        || !codec::nonzero(proposal.correction_frontier_digest)
    {
        return Err(UniverseSelectionErrorV1::InvalidMembership);
    }
    let canonical_bytes = encode_source_fact(&proposal)?.into_boxed_slice();
    let identity = codec::digest(codec::MEMBERSHIP_DOMAIN, &canonical_bytes);
    if proposal.predecessor_identity == Some(identity) {
        return Err(UniverseSelectionErrorV1::InvalidMembership);
    }
    Ok(HistoricalMembershipSourceFactV1 {
        proposal,
        canonical_bytes,
        identity,
    })
}

fn encode_source_fact(
    proposal: &HistoricalMembershipFactProposalV1,
) -> Result<Vec<u8>, UniverseSelectionErrorV1> {
    let mut encoder = Encoder::default();
    encoder.u16(codec::VERSION);
    encoder.bytes(&proposal.member_key, codec::MAX_MEMBER_FIELD_BYTES)?;
    encoder.bytes(&proposal.instrument, codec::MAX_MEMBER_FIELD_BYTES)?;
    encoder.optional_digest(proposal.predecessor_identity);
    encoder.i128(proposal.effective_from_ns);
    encoder.optional_i128(proposal.effective_until_ns);
    encoder.i128(proposal.provider_available_ns);
    encoder.i128(proposal.retrieval_ns);
    encoder.i128(proposal.correction_publication_ns);
    encoder.i128(proposal.owner_observation_ns);
    encoder.u64(proposal.decision_cut);
    encoder.digest(proposal.source_binding_lineage_root);
    encoder.digest(proposal.correction_frontier_digest);
    encoder.finish()
}

pub(crate) fn decode_source_fact_v1(
    bytes: &[u8],
) -> Result<HistoricalMembershipSourceFactV1, UniverseSelectionErrorV1> {
    let mut decoder = Decoder::new(bytes);
    if decoder.u16()? != codec::VERSION {
        return Err(UniverseSelectionErrorV1::CodecMismatch);
    }
    let proposal = HistoricalMembershipFactProposalV1 {
        member_key: decoder.bytes(codec::MAX_MEMBER_FIELD_BYTES)?,
        instrument: decoder.bytes(codec::MAX_MEMBER_FIELD_BYTES)?,
        predecessor_identity: decoder.optional_digest()?,
        effective_from_ns: decoder.i128()?,
        effective_until_ns: decoder.optional_i128()?,
        provider_available_ns: decoder.i128()?,
        retrieval_ns: decoder.i128()?,
        correction_publication_ns: decoder.i128()?,
        owner_observation_ns: decoder.i128()?,
        decision_cut: decoder.u64()?,
        source_binding_lineage_root: decoder.digest()?,
        correction_frontier_digest: decoder.digest()?,
    };
    decoder.finish()?;
    let fact = issue_source_fact_v1(proposal)?;
    if fact.canonical_bytes() != bytes {
        return Err(UniverseSelectionErrorV1::CodecMismatch);
    }
    Ok(fact)
}

pub(crate) fn select_complete_membership_v1(
    request: &UntrustedUniverseSelectionRequestV1,
    source_facts: &[HistoricalMembershipSourceFactV1],
    expected_member_keys: &[Vec<u8>],
    evaluator: Option<&dyn UniverseSelectionRuleEvaluatorV1>,
) -> Result<Vec<HistoricalMembershipRecordV1>, UniverseSelectionErrorV1> {
    validate_request(request)?;
    let evaluator = evaluator.ok_or(UniverseSelectionErrorV1::EvaluatorUnavailable)?;
    if expected_member_keys.len() > codec::MAX_MEMBERSHIP_RECORDS {
        return Err(UniverseSelectionErrorV1::CapacityExceeded);
    }
    let expected: BTreeSet<&[u8]> = expected_member_keys.iter().map(Vec::as_slice).collect();
    if expected.len() != expected_member_keys.len() || expected.iter().any(|key| key.is_empty()) {
        return Err(UniverseSelectionErrorV1::InvalidMembership);
    }
    let by_identity: BTreeMap<_, _> = source_facts
        .iter()
        .map(|fact| (fact.identity(), fact))
        .collect();
    if by_identity.len() != source_facts.len() {
        return Err(UniverseSelectionErrorV1::InvalidMembership);
    }
    for fact in source_facts {
        if let Some(predecessor) = fact.predecessor_identity() {
            let prior = by_identity
                .get(&predecessor)
                .ok_or(UniverseSelectionErrorV1::InvalidMembership)?;
            if prior.member_key() != fact.member_key() || prior.instrument() != fact.instrument() {
                return Err(UniverseSelectionErrorV1::InvalidMembership);
            }
        }
    }
    let mut selected = Vec::with_capacity(expected.len());
    for member_key in expected {
        let mut candidates: Vec<_> = source_facts
            .iter()
            .filter(|fact| {
                fact.member_key() == member_key
                    && fact.proposal.effective_from_ns <= request.effective_at_ns
                    && fact
                        .proposal
                        .effective_until_ns
                        .is_none_or(|until| request.effective_at_ns < until)
                    && fact.proposal.provider_available_ns <= request.owner_observation_ns
                    && fact.proposal.retrieval_ns <= request.owner_observation_ns
                    && fact.proposal.correction_publication_ns <= request.owner_observation_ns
                    && fact.proposal.owner_observation_ns <= request.owner_observation_ns
                    && fact.proposal.decision_cut <= request.decision_cut
                    && fact.proposal.source_binding_lineage_root
                        == request.source_binding_lineage_root
                    && fact.proposal.correction_frontier_digest
                        == request.correction_frontier_digest
            })
            .collect();
        candidates.sort_by_key(|fact| {
            (
                fact.proposal.decision_cut,
                fact.proposal.owner_observation_ns,
                fact.identity(),
            )
        });
        let fact = candidates
            .pop()
            .ok_or(UniverseSelectionErrorV1::InvalidMembership)?;
        if candidates.last().is_some_and(|other| {
            (
                other.proposal.decision_cut,
                other.proposal.owner_observation_ns,
            ) == (
                fact.proposal.decision_cut,
                fact.proposal.owner_observation_ns,
            )
        }) {
            return Err(UniverseSelectionErrorV1::InvalidMembership);
        }
        let disposition = evaluator.evaluate(
            request.selection_rule_identity,
            &request.selection_rule_bytes,
            fact,
        )?;
        if disposition.included == disposition.exclusion_reason.is_some()
            || disposition.exclusion_reason.as_ref().is_some_and(|reason| {
                reason.is_empty() || reason.len() > codec::MAX_EXCLUSION_REASON_BYTES
            })
        {
            return Err(UniverseSelectionErrorV1::InvalidMembership);
        }
        selected.push(issue_membership(request, fact, disposition)?);
    }
    selected.sort_by(|left, right| {
        (left.member_key(), left.instrument()).cmp(&(right.member_key(), right.instrument()))
    });
    if selected.len() != expected_member_keys.len() {
        return Err(UniverseSelectionErrorV1::InvalidMembership);
    }
    Ok(selected)
}

fn issue_membership(
    request: &UntrustedUniverseSelectionRequestV1,
    fact: &HistoricalMembershipSourceFactV1,
    disposition: UniverseMembershipDispositionV1,
) -> Result<HistoricalMembershipRecordV1, UniverseSelectionErrorV1> {
    let mut encoder = Encoder::default();
    encoder.u16(codec::VERSION);
    encoder.bytes(fact.member_key(), codec::MAX_MEMBER_FIELD_BYTES)?;
    encoder.bytes(fact.instrument(), codec::MAX_MEMBER_FIELD_BYTES)?;
    encoder.u8(u8::from(disposition.included));
    encoder.optional_bytes(
        disposition.exclusion_reason.as_deref(),
        codec::MAX_EXCLUSION_REASON_BYTES,
    )?;
    encoder.optional_digest(fact.predecessor_identity());
    encoder.digest(request.eligible_instrument_frontier);
    encoder.u64(fact.proposal.decision_cut);
    encoder.digest(fact.proposal.source_binding_lineage_root);
    encoder.digest(fact.proposal.correction_frontier_digest);
    encoder.i128(fact.proposal.effective_from_ns);
    encoder.optional_i128(fact.proposal.effective_until_ns);
    encoder.i128(fact.proposal.provider_available_ns);
    encoder.i128(fact.proposal.retrieval_ns);
    encoder.i128(fact.proposal.correction_publication_ns);
    encoder.i128(fact.proposal.owner_observation_ns);
    let canonical_bytes = encoder.finish()?.into_boxed_slice();
    let identity = codec::digest(codec::MEMBERSHIP_DOMAIN, &canonical_bytes);
    Ok(HistoricalMembershipRecordV1 {
        member_key: fact.proposal.member_key.clone().into_boxed_slice(),
        instrument: fact.proposal.instrument.clone().into_boxed_slice(),
        included: disposition.included,
        exclusion_reason: disposition.exclusion_reason.map(Vec::into_boxed_slice),
        predecessor_identity: fact.proposal.predecessor_identity,
        eligible_instrument_frontier: request.eligible_instrument_frontier,
        decision_cut: fact.proposal.decision_cut,
        source_binding_lineage_root: fact.proposal.source_binding_lineage_root,
        correction_frontier_digest: fact.proposal.correction_frontier_digest,
        effective_from_ns: fact.proposal.effective_from_ns,
        effective_until_ns: fact.proposal.effective_until_ns,
        provider_available_ns: fact.proposal.provider_available_ns,
        retrieval_ns: fact.proposal.retrieval_ns,
        correction_publication_ns: fact.proposal.correction_publication_ns,
        owner_observation_ns: fact.proposal.owner_observation_ns,
        identity,
        canonical_bytes,
    })
}

pub(crate) fn issue_universe_selection_readback_v1(
    request: &UntrustedUniverseSelectionRequestV1,
    membership: Vec<HistoricalMembershipRecordV1>,
    store_generation_identity: UniverseSelectionIdentity,
    store_append_sequence: u64,
) -> Result<UniverseSelectionReadbackV1, UniverseSelectionErrorV1> {
    validate_request(request)?;
    if membership.len() > codec::MAX_MEMBERSHIP_RECORDS
        || membership
            .windows(2)
            .any(|pair| pair[0].member_key() >= pair[1].member_key())
        || membership
            .iter()
            .any(|fact| fact.eligible_instrument_frontier != request.eligible_instrument_frontier)
        || !codec::nonzero(store_generation_identity)
        || store_append_sequence == 0
    {
        return Err(UniverseSelectionErrorV1::InvalidMembership);
    }
    let historical_membership_cut_identity = membership_cut_identity(&membership)?;
    let record_bytes =
        encode_record(request, historical_membership_cut_identity, &membership)?.into_boxed_slice();
    let selection_identity = codec::digest(codec::SELECTION_DOMAIN, &record_bytes);
    let record = UniverseSelectionRecordV1 {
        request_identity: request.request_identity,
        request_meaning_digest: request.request_meaning_digest,
        selection_rule_identity: request.selection_rule_identity,
        eligible_instrument_frontier: request.eligible_instrument_frontier,
        effective_at_ns: request.effective_at_ns,
        owner_observation_ns: request.owner_observation_ns,
        decision_cut: request.decision_cut,
        source_binding_lineage_root: request.source_binding_lineage_root,
        correction_frontier_digest: request.correction_frontier_digest,
        historical_membership_cut_identity,
        membership: membership.into_boxed_slice(),
        canonical_bytes: record_bytes,
        identity: selection_identity,
    };
    let receipt_bytes = encode_receipt(
        request,
        selection_identity,
        historical_membership_cut_identity,
        store_generation_identity,
        store_append_sequence,
    )?
    .into_boxed_slice();
    let receipt_identity = codec::digest(codec::RECEIPT_DOMAIN, &receipt_bytes);
    let receipt = UniverseSelectionReceiptV1 {
        request_identity: request.request_identity,
        request_meaning_digest: request.request_meaning_digest,
        selection_identity,
        historical_membership_cut_identity,
        stable_correlation: request.stable_correlation,
        store_generation_identity,
        store_append_sequence,
        canonical_bytes: receipt_bytes,
        identity: receipt_identity,
    };
    let outbox_identity = codec::digest(codec::OUTBOX_DOMAIN, receipt.canonical_bytes());
    let readback = UniverseSelectionReadbackV1 {
        record,
        receipt,
        outbox_identity,
    };
    verify_universe_selection_readback_v1(&readback)
        .then_some(readback)
        .ok_or(UniverseSelectionErrorV1::DigestMismatch)
}

fn membership_cut_identity(
    membership: &[HistoricalMembershipRecordV1],
) -> Result<UniverseSelectionIdentity, UniverseSelectionErrorV1> {
    let mut encoder = Encoder::default();
    encoder.u16(codec::VERSION);
    encoder.u32(
        u32::try_from(membership.len()).map_err(|_| UniverseSelectionErrorV1::CapacityExceeded)?,
    );
    for fact in membership {
        encoder.digest(fact.identity());
    }
    Ok(codec::digest(
        codec::MEMBERSHIP_CUT_DOMAIN,
        &encoder.finish()?,
    ))
}

fn encode_record(
    request: &UntrustedUniverseSelectionRequestV1,
    cut: UniverseSelectionIdentity,
    membership: &[HistoricalMembershipRecordV1],
) -> Result<Vec<u8>, UniverseSelectionErrorV1> {
    encode_record_values(
        request.request_identity,
        request.request_meaning_digest,
        request.selection_rule_identity,
        request.eligible_instrument_frontier,
        request.effective_at_ns,
        request.owner_observation_ns,
        request.decision_cut,
        request.source_binding_lineage_root,
        request.correction_frontier_digest,
        cut,
        membership,
    )
}

#[allow(clippy::too_many_arguments)]
fn encode_record_values(
    request_identity: UniverseSelectionIdentity,
    request_meaning_digest: UniverseSelectionIdentity,
    selection_rule_identity: UniverseSelectionIdentity,
    eligible_instrument_frontier: UniverseSelectionIdentity,
    effective_at_ns: i128,
    owner_observation_ns: i128,
    decision_cut: u64,
    source_binding_lineage_root: UniverseSelectionIdentity,
    correction_frontier_digest: UniverseSelectionIdentity,
    cut: UniverseSelectionIdentity,
    membership: &[HistoricalMembershipRecordV1],
) -> Result<Vec<u8>, UniverseSelectionErrorV1> {
    let mut encoder = Encoder::default();
    encoder.u16(codec::VERSION);
    encoder.digest(request_identity);
    encoder.digest(request_meaning_digest);
    encoder.digest(selection_rule_identity);
    encoder.digest(eligible_instrument_frontier);
    encoder.i128(effective_at_ns);
    encoder.i128(owner_observation_ns);
    encoder.u64(decision_cut);
    encoder.digest(source_binding_lineage_root);
    encoder.digest(correction_frontier_digest);
    encoder.digest(cut);
    encoder.u32(
        u32::try_from(membership.len()).map_err(|_| UniverseSelectionErrorV1::CapacityExceeded)?,
    );
    for fact in membership {
        encoder.bytes(fact.canonical_bytes(), codec::MAX_RECORD_BYTES)?;
    }
    encoder.finish()
}

fn encode_receipt(
    request: &UntrustedUniverseSelectionRequestV1,
    selection_identity: UniverseSelectionIdentity,
    cut: UniverseSelectionIdentity,
    generation: UniverseSelectionIdentity,
    sequence: u64,
) -> Result<Vec<u8>, UniverseSelectionErrorV1> {
    encode_receipt_values(
        request.request_identity,
        request.request_meaning_digest,
        selection_identity,
        cut,
        request.stable_correlation,
        generation,
        sequence,
    )
}

fn encode_receipt_values(
    request_identity: UniverseSelectionIdentity,
    request_meaning_digest: UniverseSelectionIdentity,
    selection_identity: UniverseSelectionIdentity,
    cut: UniverseSelectionIdentity,
    stable_correlation: UniverseSelectionIdentity,
    generation: UniverseSelectionIdentity,
    sequence: u64,
) -> Result<Vec<u8>, UniverseSelectionErrorV1> {
    let mut encoder = Encoder::default();
    encoder.u16(codec::VERSION);
    encoder.digest(request_identity);
    encoder.digest(request_meaning_digest);
    encoder.digest(selection_identity);
    encoder.digest(cut);
    encoder.digest(stable_correlation);
    encoder.digest(generation);
    encoder.u64(sequence);
    encoder.finish()
}

pub(crate) fn decode_readback_v1(
    record_bytes: &[u8],
    receipt_bytes: &[u8],
    outbox_identity: UniverseSelectionIdentity,
) -> Result<UniverseSelectionReadbackV1, UniverseSelectionErrorV1> {
    let mut decoder = Decoder::new(record_bytes);
    if decoder.u16()? != codec::VERSION {
        return Err(UniverseSelectionErrorV1::CodecMismatch);
    }
    let request_identity = decoder.digest()?;
    let request_meaning_digest = decoder.digest()?;
    let selection_rule_identity = decoder.digest()?;
    let eligible_instrument_frontier = decoder.digest()?;
    let effective_at_ns = decoder.i128()?;
    let owner_observation_ns = decoder.i128()?;
    let decision_cut = decoder.u64()?;
    let source_binding_lineage_root = decoder.digest()?;
    let correction_frontier_digest = decoder.digest()?;
    let historical_membership_cut_identity = decoder.digest()?;
    let count =
        usize::try_from(decoder.u32()?).map_err(|_| UniverseSelectionErrorV1::CapacityExceeded)?;
    if count > codec::MAX_MEMBERSHIP_RECORDS {
        return Err(UniverseSelectionErrorV1::CapacityExceeded);
    }
    let mut membership = Vec::with_capacity(count);
    for _ in 0..count {
        membership.push(decode_membership(&decoder.bytes(codec::MAX_RECORD_BYTES)?)?);
    }
    decoder.finish()?;
    let record = UniverseSelectionRecordV1 {
        request_identity,
        request_meaning_digest,
        selection_rule_identity,
        eligible_instrument_frontier,
        effective_at_ns,
        owner_observation_ns,
        decision_cut,
        source_binding_lineage_root,
        correction_frontier_digest,
        historical_membership_cut_identity,
        membership: membership.into_boxed_slice(),
        canonical_bytes: record_bytes.to_vec().into_boxed_slice(),
        identity: codec::digest(codec::SELECTION_DOMAIN, record_bytes),
    };
    let mut receipt_decoder = Decoder::new(receipt_bytes);
    if receipt_decoder.u16()? != codec::VERSION {
        return Err(UniverseSelectionErrorV1::CodecMismatch);
    }
    let receipt = UniverseSelectionReceiptV1 {
        request_identity: receipt_decoder.digest()?,
        request_meaning_digest: receipt_decoder.digest()?,
        selection_identity: receipt_decoder.digest()?,
        historical_membership_cut_identity: receipt_decoder.digest()?,
        stable_correlation: receipt_decoder.digest()?,
        store_generation_identity: receipt_decoder.digest()?,
        store_append_sequence: receipt_decoder.u64()?,
        canonical_bytes: receipt_bytes.to_vec().into_boxed_slice(),
        identity: codec::digest(codec::RECEIPT_DOMAIN, receipt_bytes),
    };
    receipt_decoder.finish()?;
    let readback = UniverseSelectionReadbackV1 {
        record,
        receipt,
        outbox_identity,
    };
    verify_universe_selection_readback_v1(&readback)
        .then_some(readback)
        .ok_or(UniverseSelectionErrorV1::StoreUntrusted)
}

fn decode_membership(
    bytes: &[u8],
) -> Result<HistoricalMembershipRecordV1, UniverseSelectionErrorV1> {
    let mut decoder = Decoder::new(bytes);
    if decoder.u16()? != codec::VERSION {
        return Err(UniverseSelectionErrorV1::CodecMismatch);
    }
    let member_key = decoder
        .bytes(codec::MAX_MEMBER_FIELD_BYTES)?
        .into_boxed_slice();
    let instrument = decoder
        .bytes(codec::MAX_MEMBER_FIELD_BYTES)?
        .into_boxed_slice();
    let included = match decoder.u8()? {
        0 => false,
        1 => true,
        _ => return Err(UniverseSelectionErrorV1::CodecMismatch),
    };
    let exclusion_reason = decoder
        .optional_bytes(codec::MAX_EXCLUSION_REASON_BYTES)?
        .map(Vec::into_boxed_slice);
    let predecessor_identity = decoder.optional_digest()?;
    let eligible_instrument_frontier = decoder.digest()?;
    let decision_cut = decoder.u64()?;
    let source_binding_lineage_root = decoder.digest()?;
    let correction_frontier_digest = decoder.digest()?;
    let effective_from_ns = decoder.i128()?;
    let effective_until_ns = decoder.optional_i128()?;
    let provider_available_ns = decoder.i128()?;
    let retrieval_ns = decoder.i128()?;
    let correction_publication_ns = decoder.i128()?;
    let owner_observation_ns = decoder.i128()?;
    decoder.finish()?;
    if included == exclusion_reason.is_some() {
        return Err(UniverseSelectionErrorV1::InvalidMembership);
    }
    Ok(HistoricalMembershipRecordV1 {
        member_key,
        instrument,
        included,
        exclusion_reason,
        predecessor_identity,
        eligible_instrument_frontier,
        decision_cut,
        source_binding_lineage_root,
        correction_frontier_digest,
        effective_from_ns,
        effective_until_ns,
        provider_available_ns,
        retrieval_ns,
        correction_publication_ns,
        owner_observation_ns,
        identity: codec::digest(codec::MEMBERSHIP_DOMAIN, bytes),
        canonical_bytes: bytes.to_vec().into_boxed_slice(),
    })
}

#[must_use]
pub fn verify_universe_selection_readback_v1(readback: &UniverseSelectionReadbackV1) -> bool {
    let record = &readback.record;
    let receipt = &readback.receipt;
    encode_record_values(
        record.request_identity,
        record.request_meaning_digest,
        record.selection_rule_identity,
        record.eligible_instrument_frontier,
        record.effective_at_ns,
        record.owner_observation_ns,
        record.decision_cut,
        record.source_binding_lineage_root,
        record.correction_frontier_digest,
        record.historical_membership_cut_identity,
        &record.membership,
    )
    .is_ok_and(|bytes| bytes.as_slice() == record.canonical_bytes.as_ref())
        && encode_receipt_values(
            receipt.request_identity,
            receipt.request_meaning_digest,
            receipt.selection_identity,
            receipt.historical_membership_cut_identity,
            receipt.stable_correlation,
            receipt.store_generation_identity,
            receipt.store_append_sequence,
        )
        .is_ok_and(|bytes| bytes.as_slice() == receipt.canonical_bytes.as_ref())
        && codec::digest(codec::SELECTION_DOMAIN, &record.canonical_bytes) == record.identity
        && codec::digest(codec::RECEIPT_DOMAIN, &receipt.canonical_bytes) == receipt.identity
        && codec::digest(codec::OUTBOX_DOMAIN, &receipt.canonical_bytes) == readback.outbox_identity
        && record
            .membership
            .windows(2)
            .all(|pair| pair[0].member_key() < pair[1].member_key())
        && membership_cut_identity(&record.membership)
            .is_ok_and(|cut| cut == record.historical_membership_cut_identity)
        && record.membership.iter().all(|fact| {
            codec::digest(codec::MEMBERSHIP_DOMAIN, &fact.canonical_bytes) == fact.identity
                && fact.eligible_instrument_frontier == record.eligible_instrument_frontier
                && fact.source_binding_lineage_root == record.source_binding_lineage_root
                && fact.correction_frontier_digest == record.correction_frontier_digest
                && fact.decision_cut <= record.decision_cut
                && fact.included != fact.exclusion_reason.is_some()
        })
        && receipt.request_identity == record.request_identity
        && receipt.request_meaning_digest == record.request_meaning_digest
        && receipt.selection_identity == record.identity
        && receipt.historical_membership_cut_identity == record.historical_membership_cut_identity
        && codec::nonzero(receipt.store_generation_identity)
        && receipt.store_append_sequence > 0
}
