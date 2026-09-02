use super::{
    AuthenticatedCorporateActionEntryV1, AuthenticatedCorporateActionInputsV1,
    CorporateActionCutEntryV1, CorporateActionCutV1, CorporateActionErrorV1, CorporateActionFactV1,
    CorporateActionIdentity, CorporateActionInstrumentCensusV1, CorporateActionReadbackV1,
    CorporateActionReceiptV1, CorporateActionRegistryEntryV1, CorporateActionTermsV1,
    UntrustedCorporateActionProposalV1, codec,
};
use crate::owner::{
    instrument_master::{InstrumentMasterReadbackV1, authority::verify_instrument_master_readback},
    pit_snapshot::VerifiedPitObservationBatch,
    reference_fact_coordinates::VerifiedReferenceFactCoordinatesV1,
    source_binding::SourceBindingOwnerReadback,
};

fn nonzero(value: CorporateActionIdentity) -> bool {
    value.as_bytes() != &[0; 32]
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn authenticate_corporate_action_inputs_v1(
    source: &SourceBindingOwnerReadback,
    pit: &VerifiedPitObservationBatch,
    instrument_master: &InstrumentMasterReadbackV1,
    coordinates: &[VerifiedReferenceFactCoordinatesV1],
    coordinate_identities: &[(CorporateActionIdentity, CorporateActionIdentity)],
    registry: Box<[CorporateActionRegistryEntryV1]>,
    r0_cut_identity: CorporateActionIdentity,
    r0_cut_digest: CorporateActionIdentity,
    pit_cut_digest: CorporateActionIdentity,
    stable_correlation: CorporateActionIdentity,
) -> Result<AuthenticatedCorporateActionInputsV1, CorporateActionErrorV1> {
    if !source.is_admitted()
        || !verify_instrument_master_readback(instrument_master)
        || coordinates.len() != registry.len()
        || coordinate_identities.len() != registry.len()
        || ![
            r0_cut_identity,
            r0_cut_digest,
            pit_cut_digest,
            stable_correlation,
        ]
        .into_iter()
        .all(nonzero)
        || pit.source_binding_identity() != source.binding_id()
        || pit.source_binding_lineage_root() != source.lineage_root()
        || pit.source_binding_lineage_version() != source.lineage_version()
    {
        return Err(CorporateActionErrorV1::DependencyMismatch);
    }
    let mut entries = Vec::with_capacity(registry.len());
    for ((registry, coordinates), &(coordinate_identity, coordinate_digest)) in registry
        .into_vec()
        .into_iter()
        .zip(coordinates)
        .zip(coordinate_identities)
    {
        let claim = coordinates.claim();
        let instrument_fact = instrument_master
            .facts()
            .iter()
            .find(|fact| fact.canonical_identity().as_bytes() == registry.instrument.as_ref())
            .ok_or(CorporateActionErrorV1::UnauthenticatedInput)?;
        let successor_is_admitted = match &registry.terms {
            CorporateActionTermsV1::SymbolChange {
                successor_instrument,
            }
            | CorporateActionTermsV1::Roll {
                successor_instrument,
            } => instrument_master
                .facts()
                .iter()
                .any(|fact| fact.canonical_identity().as_bytes() == successor_instrument.as_ref()),
            _ => true,
        };
        if ![
            registry.action_identity,
            registry.correction_identity,
            coordinate_identity,
            coordinate_digest,
            claim.source.frontier.digest,
            claim.correction.digest,
        ]
        .into_iter()
        .all(nonzero)
            || claim.source.binding_identity != source.binding_id()
            || claim.source.binding_fact_digest != source.fact_digest()
            || claim.source.lineage_root != source.lineage_root()
            || claim.source.lineage_version != source.lineage_version()
            || claim.pit.snapshot_identity != pit.snapshot_identity()
            || claim.pit.fact_digest != pit.fact_digest()
            || claim.stable_correlation != stable_correlation
            || instrument_fact.source_frontier() != claim.source.frontier.digest
            || instrument_fact.correction_frontier() != claim.correction.digest
            || claim.time.owner_observation_ns != i128::from(claim.fact_clock.wall_observed)
            || claim.time.decision_cut != claim.fact_clock.decision_cut
            || !successor_is_admitted
        {
            return Err(CorporateActionErrorV1::DependencyMismatch);
        }
        entries.push(AuthenticatedCorporateActionEntryV1 {
            registry,
            predecessor_identity: claim.predecessor_identity,
            effective_from_ns: claim.time.effective_from_ns,
            effective_until_ns: claim.time.effective_until_ns,
            provider_available_ns: claim.time.provider_available_ns,
            retrieval_ns: claim.time.retrieval_ns,
            correction_publication_ns: claim.time.correction_publication_ns,
            owner_observation_ns: claim.time.owner_observation_ns,
            decision_cut: claim.time.decision_cut,
            coordinate_identity,
            coordinate_digest,
            instrument_master_fact_digest: instrument_fact.digest(),
            pit_snapshot_identity: pit.snapshot_identity(),
            pit_fact_digest: pit.fact_digest(),
            source_binding_identity: source.binding_id(),
            source_binding_fact_digest: source.fact_digest(),
            source_binding_lineage_root: source.lineage_root(),
            source_binding_lineage_version: source.lineage_version(),
            source_frontier: claim.source.frontier.digest,
            correction_frontier: claim.correction.digest,
        });
    }
    let mut instruments = instrument_master
        .facts()
        .iter()
        .map(|fact| Box::<[u8]>::from(fact.canonical_identity().as_bytes()))
        .collect::<Vec<_>>();
    instruments.sort();
    if instruments.is_empty()
        || instruments.iter().any(|value| value.is_empty())
        || instruments.windows(2).any(|pair| pair[0] >= pair[1])
    {
        return Err(CorporateActionErrorV1::DependencyMismatch);
    }
    Ok(AuthenticatedCorporateActionInputsV1 {
        entries: entries.into_boxed_slice(),
        instruments: instruments.into_boxed_slice(),
        r0_cut_identity,
        r0_cut_digest,
        instrument_master_readback_digest: instrument_master.digest(),
        instrument_master_cut_digest: instrument_master.cut().digest(),
        pit_cut_digest,
        stable_correlation,
    })
}

pub(crate) fn request_meaning_digest_v1(
    proposal: &UntrustedCorporateActionProposalV1,
) -> Result<CorporateActionIdentity, CorporateActionErrorV1> {
    Ok(codec::digest(
        codec::REQUEST_DOMAIN,
        &codec::encode_request_meaning(proposal)?,
    ))
}

pub(crate) fn issue_facts_and_cut_v1(
    proposal: &UntrustedCorporateActionProposalV1,
    inputs: &AuthenticatedCorporateActionInputsV1,
) -> Result<(Box<[CorporateActionFactV1]>, CorporateActionCutV1), CorporateActionErrorV1> {
    validate_request(proposal, inputs)?;
    let mut facts = Vec::with_capacity(inputs.entries.len());
    for input in &inputs.entries {
        if !proposal
            .instruments
            .iter()
            .any(|value| value.as_ref() == input.registry.instrument.as_ref())
            || input.effective_from_ns >= proposal.replay_end_ns_exclusive
            || input
                .effective_until_ns
                .is_some_and(|until| until <= proposal.replay_start_ns)
        {
            return Err(CorporateActionErrorV1::IncompleteCut);
        }
        let mut fact = CorporateActionFactV1 {
            action_identity: input.registry.action_identity,
            instrument: input.registry.instrument.clone(),
            terms: input.registry.terms.clone(),
            predecessor_identity: input.predecessor_identity,
            effective_from_ns: input.effective_from_ns,
            effective_until_ns: input.effective_until_ns,
            provider_available_ns: input.provider_available_ns,
            retrieval_ns: input.retrieval_ns,
            correction_publication_ns: input.correction_publication_ns,
            owner_observation_ns: input.owner_observation_ns,
            decision_cut: input.decision_cut,
            coordinate_identity: input.coordinate_identity,
            coordinate_digest: input.coordinate_digest,
            instrument_master_readback_digest: inputs.instrument_master_readback_digest,
            instrument_master_fact_digest: input.instrument_master_fact_digest,
            instrument_master_cut_digest: inputs.instrument_master_cut_digest,
            pit_snapshot_identity: input.pit_snapshot_identity,
            pit_fact_digest: input.pit_fact_digest,
            source_binding_identity: input.source_binding_identity,
            source_binding_fact_digest: input.source_binding_fact_digest,
            source_binding_lineage_root: input.source_binding_lineage_root,
            source_binding_lineage_version: input.source_binding_lineage_version,
            source_frontier: input.source_frontier,
            correction_frontier: input.correction_frontier,
            correction_identity: input.registry.correction_identity,
            canonical_bytes: Box::default(),
            identity: CorporateActionIdentity::from_untrusted_bytes([0; 32]),
        };
        if !valid_fact(&fact) {
            return Err(CorporateActionErrorV1::InvalidFact);
        }
        fact.canonical_bytes = codec::encode_fact(&fact)?;
        fact.identity = codec::digest(codec::FACT_DOMAIN, &fact.canonical_bytes);
        facts.push(fact);
    }
    facts.sort_by(|left, right| {
        left.instrument
            .cmp(&right.instrument)
            .then(left.effective_from_ns.cmp(&right.effective_from_ns))
            .then(left.action_identity.cmp(&right.action_identity))
    });
    if facts.windows(2).any(|pair| {
        pair[0].instrument == pair[1].instrument
            && pair[0].action_identity == pair[1].action_identity
    }) {
        return Err(CorporateActionErrorV1::IncompleteCut);
    }
    let mut census = Vec::with_capacity(proposal.instruments.len());
    for instrument in &proposal.instruments {
        let actions = facts
            .iter()
            .filter(|fact| fact.instrument.as_ref() == instrument.as_ref())
            .map(|fact| CorporateActionCutEntryV1 {
                action_identity: fact.action_identity,
                fact_identity: fact.identity,
                fact_digest: fact.identity,
                effective_from_ns: fact.effective_from_ns,
            })
            .collect::<Vec<_>>();
        census.push(CorporateActionInstrumentCensusV1 {
            instrument: instrument.clone(),
            actions: actions.into_boxed_slice(),
        });
    }
    let mut cut = CorporateActionCutV1 {
        request_identity: proposal.request_identity,
        request_meaning_digest: proposal.request_meaning_digest,
        consumer: proposal.consumer,
        replay_start_ns: proposal.replay_start_ns,
        replay_end_ns_exclusive: proposal.replay_end_ns_exclusive,
        owner_observation_ns: proposal.owner_observation_ns,
        decision_cut: proposal.decision_cut,
        r0_cut_identity: inputs.r0_cut_identity,
        r0_cut_digest: inputs.r0_cut_digest,
        instrument_master_cut_digest: inputs.instrument_master_cut_digest,
        pit_cut_digest: inputs.pit_cut_digest,
        census: census.into_boxed_slice(),
        gaps: Box::default(),
        canonical_bytes: Box::default(),
        identity: CorporateActionIdentity::from_untrusted_bytes([0; 32]),
    };
    cut.canonical_bytes = codec::encode_cut(&cut)?;
    cut.identity = codec::digest(codec::CUT_DOMAIN, &cut.canonical_bytes);
    Ok((facts.into_boxed_slice(), cut))
}

pub(crate) fn issue_readback_v1(
    facts: Box<[CorporateActionFactV1]>,
    cut: CorporateActionCutV1,
    store_generation_identity: CorporateActionIdentity,
    append_sequence: u64,
    stable_correlation: CorporateActionIdentity,
) -> Result<CorporateActionReadbackV1, CorporateActionErrorV1> {
    if !nonzero(store_generation_identity) || !nonzero(stable_correlation) || append_sequence == 0 {
        return Err(CorporateActionErrorV1::InvalidFact);
    }
    let mut receipt = CorporateActionReceiptV1 {
        request_identity: cut.request_identity,
        request_meaning_digest: cut.request_meaning_digest,
        consumer: cut.consumer,
        cut_identity: cut.identity,
        cut_digest: cut.identity,
        store_generation_identity,
        append_sequence,
        stable_correlation,
        canonical_bytes: Box::default(),
        identity: CorporateActionIdentity::from_untrusted_bytes([0; 32]),
    };
    receipt.canonical_bytes = codec::encode_receipt(&receipt)?;
    receipt.identity = codec::digest(codec::RECEIPT_DOMAIN, &receipt.canonical_bytes);
    let mut readback = CorporateActionReadbackV1 {
        facts,
        cut,
        outbox_identity: receipt.identity,
        receipt,
        canonical_bytes: Box::default(),
        identity: CorporateActionIdentity::from_untrusted_bytes([0; 32]),
    };
    readback.canonical_bytes = codec::encode_readback(&readback)?;
    readback.identity = codec::digest(codec::READBACK_DOMAIN, &readback.canonical_bytes);
    verify_readback_v1(&readback)?;
    Ok(readback)
}

pub(crate) fn verify_readback_v1(
    readback: &CorporateActionReadbackV1,
) -> Result<(), CorporateActionErrorV1> {
    if !readback.cut.gaps.is_empty()
        || readback.cut.census.is_empty()
        || readback.receipt.request_identity != readback.cut.request_identity
        || readback.receipt.request_meaning_digest != readback.cut.request_meaning_digest
        || readback.receipt.consumer != readback.cut.consumer
        || readback.receipt.cut_identity != readback.cut.identity
        || readback.receipt.cut_digest != readback.cut.identity
        || readback.receipt.append_sequence == 0
        || !nonzero(readback.receipt.store_generation_identity)
        || readback.outbox_identity != readback.receipt.identity
    {
        return Err(CorporateActionErrorV1::DigestMismatch);
    }
    let mut seen = 0usize;
    for census in &readback.cut.census {
        for entry in &census.actions {
            let fact = readback
                .facts
                .iter()
                .find(|fact| fact.identity == entry.fact_identity)
                .ok_or(CorporateActionErrorV1::IncompleteCut)?;
            if fact.instrument.as_ref() != census.instrument.as_ref()
                || fact.action_identity != entry.action_identity
                || fact.identity != entry.fact_digest
                || fact.effective_from_ns != entry.effective_from_ns
                || !valid_fact(fact)
            {
                return Err(CorporateActionErrorV1::DigestMismatch);
            }
            seen += 1;
        }
    }
    if seen != readback.facts.len()
        || readback
            .cut
            .census
            .windows(2)
            .any(|pair| pair[0].instrument >= pair[1].instrument)
        || readback.cut.census.iter().any(|c| {
            c.actions.windows(2).any(|p| {
                (p[0].effective_from_ns, p[0].action_identity)
                    >= (p[1].effective_from_ns, p[1].action_identity)
            })
        })
    {
        return Err(CorporateActionErrorV1::NonCanonicalOrder);
    }
    for fact in &readback.facts {
        if codec::encode_fact(fact)?.as_ref() != fact.canonical_bytes.as_ref()
            || codec::digest(codec::FACT_DOMAIN, &fact.canonical_bytes) != fact.identity
        {
            return Err(CorporateActionErrorV1::DigestMismatch);
        }
    }
    if codec::encode_cut(&readback.cut)?.as_ref() != readback.cut.canonical_bytes.as_ref()
        || codec::digest(codec::CUT_DOMAIN, &readback.cut.canonical_bytes) != readback.cut.identity
        || codec::encode_receipt(&readback.receipt)?.as_ref()
            != readback.receipt.canonical_bytes.as_ref()
        || codec::digest(codec::RECEIPT_DOMAIN, &readback.receipt.canonical_bytes)
            != readback.receipt.identity
        || codec::encode_readback(readback)?.as_ref() != readback.canonical_bytes.as_ref()
        || codec::digest(codec::READBACK_DOMAIN, &readback.canonical_bytes) != readback.identity
    {
        return Err(CorporateActionErrorV1::DigestMismatch);
    }
    Ok(())
}

pub(crate) fn decode_and_verify_readback_v1(
    bytes: &[u8],
) -> Result<CorporateActionReadbackV1, CorporateActionErrorV1> {
    let readback = codec::decode_readback(bytes)?;
    verify_readback_v1(&readback)?;
    Ok(readback)
}

pub(crate) fn validate_successor_v1(
    predecessor: Option<&CorporateActionFactV1>,
    successor: &CorporateActionFactV1,
) -> Result<(), CorporateActionErrorV1> {
    match (predecessor, successor.predecessor_identity) {
        (None, None) => Ok(()),
        (Some(prior), Some(id))
            if id == prior.identity
                && prior.action_identity == successor.action_identity
                && prior.instrument == successor.instrument
                && prior.correction_identity != successor.correction_identity
                && prior.correction_frontier != successor.correction_frontier
                && prior.source_binding_lineage_root == successor.source_binding_lineage_root
                && prior.source_binding_lineage_version
                    <= successor.source_binding_lineage_version
                && prior.owner_observation_ns < successor.owner_observation_ns
                && prior.decision_cut < successor.decision_cut
                && prior.effective_from_ns == successor.effective_from_ns
                && prior.effective_until_ns == successor.effective_until_ns =>
        {
            Ok(())
        }
        (None, Some(_)) => Err(CorporateActionErrorV1::MissingPredecessor),
        _ => Err(CorporateActionErrorV1::InvalidCorrection),
    }
}

fn validate_request(
    proposal: &UntrustedCorporateActionProposalV1,
    inputs: &AuthenticatedCorporateActionInputsV1,
) -> Result<(), CorporateActionErrorV1> {
    if !nonzero(proposal.request_identity)
        || !nonzero(proposal.stable_correlation)
        || proposal.request_meaning_digest != request_meaning_digest_v1(proposal)?
        || proposal.replay_start_ns >= proposal.replay_end_ns_exclusive
        || proposal.instruments.is_empty()
        || proposal.instruments.iter().any(|v| v.is_empty())
        || proposal.instruments.windows(2).any(|p| p[0] >= p[1])
        || proposal.instruments != inputs.instruments
        || proposal.owner_observation_ns == 0
        || proposal.decision_cut == 0
        || proposal.stable_correlation != inputs.stable_correlation
        || inputs.entries.iter().any(|e| {
            e.owner_observation_ns != proposal.owner_observation_ns
                || e.decision_cut != proposal.decision_cut
        })
    {
        Err(CorporateActionErrorV1::InvalidRequest)
    } else {
        Ok(())
    }
}

fn valid_fact(f: &CorporateActionFactV1) -> bool {
    let terms = match &f.terms {
        CorporateActionTermsV1::Split {
            numerator,
            denominator,
        } => *numerator > 0 && *denominator > 0,
        CorporateActionTermsV1::CashDividend {
            scale,
            currency_identity,
            ..
        } => *scale <= 38 && !currency_identity.is_empty(),
        CorporateActionTermsV1::SymbolChange {
            successor_instrument,
        }
        | CorporateActionTermsV1::Roll {
            successor_instrument,
        } => {
            !successor_instrument.is_empty()
                && successor_instrument.as_ref() != f.instrument.as_ref()
        }
        CorporateActionTermsV1::Expiry => true,
    };
    terms
        && !f.instrument.is_empty()
        && [
            f.action_identity,
            f.coordinate_identity,
            f.coordinate_digest,
            f.instrument_master_readback_digest,
            f.instrument_master_fact_digest,
            f.instrument_master_cut_digest,
            f.pit_snapshot_identity,
            f.pit_fact_digest,
            f.source_binding_identity,
            f.source_binding_fact_digest,
            f.source_binding_lineage_root,
            f.source_frontier,
            f.correction_frontier,
            f.correction_identity,
        ]
        .into_iter()
        .all(nonzero)
        && f.source_binding_lineage_version > 0
        && f.effective_until_ns.is_none_or(|v| f.effective_from_ns < v)
        && f.provider_available_ns <= f.retrieval_ns
        && f.correction_publication_ns <= f.owner_observation_ns
        && f.retrieval_ns <= f.owner_observation_ns
        && f.decision_cut > 0
}
