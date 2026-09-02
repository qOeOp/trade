use super::{
    AuthenticatedMarketSemanticsInputsV1, MarketSemanticsConsumerV1, MarketSemanticsCutEntryV1,
    MarketSemanticsCutV1, MarketSemanticsErrorV1, MarketSemanticsFactV1, MarketSemanticsIdentity,
    MarketSemanticsReadbackV1, MarketSemanticsReceiptV1, MarketSemanticsRegistryEntryV1,
    MarketSemanticsRegistryKeyV1, MarketSemanticsValueV1, UntrustedMarketSemanticsProposalV1,
    codec,
};
use crate::owner::{
    instrument_master::{InstrumentMasterReadbackV1, authority::verify_instrument_master_readback},
    pit_snapshot::VerifiedPitObservationBatch,
    reference_fact_coordinates::r0::ReferenceFactR0ReadbackV1,
    source_binding::SourceBindingOwnerReadback,
};

fn nonzero(value: MarketSemanticsIdentity) -> bool {
    value.as_bytes() != &[0; 32]
}

pub(crate) fn derive_registry_key_v1(
    compatibility_scope_identity: MarketSemanticsIdentity,
    source: &SourceBindingOwnerReadback,
    pit: &VerifiedPitObservationBatch,
    instrument: &InstrumentMasterReadbackV1,
    r0: &ReferenceFactR0ReadbackV1,
) -> Result<MarketSemanticsRegistryKeyV1, MarketSemanticsErrorV1> {
    let [instrument_fact] = instrument.facts() else {
        return Err(MarketSemanticsErrorV1::UnauthenticatedInput);
    };
    let evidence = &r0.record().evidence;
    if !source.is_admitted()
        || !verify_instrument_master_readback(instrument)
        || pit.snapshot_identity() != evidence.pit_snapshot_identity
        || pit.fact_digest() != evidence.pit_fact_digest
        || pit.digest() != evidence.observation_batch_digest
        || source.binding_id() != evidence.source_binding_identity
        || source.fact_digest() != evidence.source_binding_fact_digest
        || source.lineage_root() != evidence.source_binding_lineage_root
        || source.lineage_version() != evidence.source_binding_lineage_version
        || pit.source_binding_identity() != source.binding_id()
        || pit.source_binding_lineage_root() != source.lineage_root()
        || pit.source_binding_lineage_version() != source.lineage_version()
        || pit.instrument_master_digest() != instrument.digest()
        || pit.market_semantics_identity() != compatibility_scope_identity
        || instrument_fact.market_semantics_identity() != compatibility_scope_identity
        || instrument_fact.source_frontier() != evidence.source_frontier_digest
        || instrument_fact.correction_frontier() != evidence.correction_frontier_digest
    {
        return Err(MarketSemanticsErrorV1::DependencyMismatch);
    }
    let mut key = MarketSemanticsRegistryKeyV1 {
        compatibility_scope_identity,
        r0_record_identity: r0.record().identity(),
        r0_record_digest: r0.record().digest(),
        r0_cut_identity: r0.cut().identity(),
        r0_cut_digest: r0.cut().digest(),
        pit_snapshot_identity: pit.snapshot_identity(),
        pit_fact_digest: pit.fact_digest(),
        source_binding_identity: source.binding_id(),
        source_binding_fact_digest: source.fact_digest(),
        source_binding_lineage_root: source.lineage_root(),
        source_binding_lineage_version: source.lineage_version(),
        instrument_master_readback_digest: instrument.digest(),
        instrument_master_fact_digest: instrument_fact.digest(),
        instrument_master_cut_digest: instrument.cut().digest(),
        source_frontier: evidence.source_frontier_digest,
        correction_frontier: evidence.correction_frontier_digest,
        canonical_bytes: Box::default(),
        identity: MarketSemanticsIdentity::from_untrusted_bytes([0; 32]),
    };
    key.canonical_bytes = codec::encode_registry_key(&key)?;
    key.identity = codec::digest(codec::REGISTRY_KEY_DOMAIN, &key.canonical_bytes);
    Ok(key)
}

pub(crate) fn seal_registry_entry_v1(
    key: MarketSemanticsRegistryKeyV1,
    value: MarketSemanticsValueV1,
    correction_identity: MarketSemanticsIdentity,
) -> Result<MarketSemanticsRegistryEntryV1, MarketSemanticsErrorV1> {
    let key_bytes = codec::encode_registry_key(&key)?;
    let key_identity = codec::digest(codec::REGISTRY_KEY_DOMAIN, &key_bytes);
    if key.canonical_bytes.as_ref() != key_bytes.as_ref()
        || key.identity != key_identity
        || !nonzero(key.identity)
        || !nonzero(value.normalization_identity)
        || !nonzero(value.price_unit_identity)
        || !nonzero(value.size_unit_identity)
        || !nonzero(correction_identity)
    {
        return Err(MarketSemanticsErrorV1::InvalidRequest);
    }
    let mut entry = MarketSemanticsRegistryEntryV1 {
        key,
        value,
        correction_identity,
        canonical_bytes: Box::default(),
        identity: MarketSemanticsIdentity::from_untrusted_bytes([0; 32]),
    };
    entry.canonical_bytes = codec::encode_registry_entry(&entry)?;
    entry.identity = codec::digest(codec::REGISTRY_RECORD_DOMAIN, &entry.canonical_bytes);
    Ok(entry)
}

pub(crate) fn authenticate_market_semantics_inputs_from_r0_v1(
    source: &SourceBindingOwnerReadback,
    pit: &VerifiedPitObservationBatch,
    instrument: &InstrumentMasterReadbackV1,
    r0: &ReferenceFactR0ReadbackV1,
    registry: MarketSemanticsRegistryEntryV1,
) -> Result<AuthenticatedMarketSemanticsInputsV1, MarketSemanticsErrorV1> {
    let derived = derive_registry_key_v1(
        registry.key.compatibility_scope_identity,
        source,
        pit,
        instrument,
        r0,
    )?;
    if derived.identity != registry.key.identity
        || derived.canonical_bytes != registry.key.canonical_bytes
    {
        return Err(MarketSemanticsErrorV1::DependencyMismatch);
    }
    let evidence = &r0.record().evidence;
    Ok(AuthenticatedMarketSemanticsInputsV1 {
        registry,
        coordinate_identity: r0.record().identity(),
        coordinate_digest: r0.record().digest(),
        r0_cut_identity: r0.cut().identity(),
        r0_cut_digest: r0.cut().digest(),
        pit_snapshot_identity: evidence.pit_snapshot_identity,
        pit_fact_digest: evidence.pit_fact_digest,
        source_binding_identity: evidence.source_binding_identity,
        source_binding_fact_digest: evidence.source_binding_fact_digest,
        source_binding_lineage_root: evidence.source_binding_lineage_root,
        source_binding_lineage_version: evidence.source_binding_lineage_version,
        instrument_master_readback_digest: derived.instrument_master_readback_digest,
        instrument_master_fact_digest: derived.instrument_master_fact_digest,
        instrument_master_cut_digest: derived.instrument_master_cut_digest,
        source_frontier: evidence.source_frontier_digest,
        correction_frontier: evidence.correction_frontier_digest,
        provider_available_ns: r0.record().provider_available_ns,
        retrieval_ns: r0.record().retrieval_ns,
        correction_publication_ns: r0.record().correction_publication_ns,
        effective_from_ns: r0.record().effective_from_ns,
        effective_until_ns: r0.record().effective_until_ns,
        owner_observation_ns: r0.record().owner_observation_ns,
        decision_cut: r0.record().decision_cut,
        predecessor_identity: r0.record().predecessor_identity,
        stable_correlation: r0.record().stable_correlation,
    })
}

pub(crate) fn request_meaning_digest_v1(
    proposal: &UntrustedMarketSemanticsProposalV1,
) -> Result<MarketSemanticsIdentity, MarketSemanticsErrorV1> {
    Ok(codec::digest(
        codec::REQUEST_DOMAIN,
        &codec::encode_request_meaning(proposal)?,
    ))
}

pub(crate) fn issue_fact_and_cut_v1(
    proposal: &UntrustedMarketSemanticsProposalV1,
    inputs: &AuthenticatedMarketSemanticsInputsV1,
) -> Result<(MarketSemanticsFactV1, MarketSemanticsCutV1), MarketSemanticsErrorV1> {
    validate_proposal(proposal, inputs)?;
    let mut fact = MarketSemanticsFactV1 {
        compatibility_scope_identity: proposal.compatibility_scope_identity,
        predecessor_identity: proposal.predecessor_identity,
        value: inputs.registry.value,
        effective_from_ns: proposal.effective_from_ns,
        effective_until_ns: proposal.effective_until_ns,
        provider_available_ns: inputs.provider_available_ns,
        retrieval_ns: inputs.retrieval_ns,
        correction_publication_ns: inputs.correction_publication_ns,
        owner_observation_ns: proposal.owner_observation_ns,
        decision_cut: proposal.decision_cut,
        coordinate_identity: inputs.coordinate_identity,
        coordinate_digest: inputs.coordinate_digest,
        pit_snapshot_identity: inputs.pit_snapshot_identity,
        pit_fact_digest: inputs.pit_fact_digest,
        source_binding_identity: inputs.source_binding_identity,
        source_binding_fact_digest: inputs.source_binding_fact_digest,
        source_binding_lineage_root: inputs.source_binding_lineage_root,
        source_binding_lineage_version: inputs.source_binding_lineage_version,
        instrument_master_readback_digest: inputs.instrument_master_readback_digest,
        instrument_master_fact_digest: inputs.instrument_master_fact_digest,
        instrument_master_cut_digest: inputs.instrument_master_cut_digest,
        source_frontier: inputs.source_frontier,
        correction_frontier: inputs.correction_frontier,
        correction_identity: inputs.registry.correction_identity,
        canonical_bytes: Box::default(),
        identity: MarketSemanticsIdentity::from_untrusted_bytes([0; 32]),
    };
    fact.canonical_bytes = codec::encode_fact(&fact)?;
    fact.identity = codec::digest(codec::FACT_DOMAIN, &fact.canonical_bytes);
    let entry = MarketSemanticsCutEntryV1 {
        scope_identity: proposal.compatibility_scope_identity,
        fact_identity: fact.identity,
        fact_digest: fact.identity,
    };
    let mut cut = MarketSemanticsCutV1 {
        request_identity: proposal.request_identity,
        request_meaning_digest: proposal.request_meaning_digest,
        consumer: proposal.consumer,
        compatibility_scope_identity: proposal.compatibility_scope_identity,
        effective_instant_ns: proposal.effective_instant_ns,
        owner_observation_ns: proposal.owner_observation_ns,
        decision_cut: proposal.decision_cut,
        r0_cut_identity: inputs.r0_cut_identity,
        r0_cut_digest: inputs.r0_cut_digest,
        entries: vec![entry].into_boxed_slice(),
        gaps: Box::default(),
        canonical_bytes: Box::default(),
        identity: MarketSemanticsIdentity::from_untrusted_bytes([0; 32]),
    };
    cut.canonical_bytes = codec::encode_cut(&cut)?;
    cut.identity = codec::digest(codec::CUT_DOMAIN, &cut.canonical_bytes);
    Ok((fact, cut))
}

pub(crate) fn issue_readback_v1(
    fact: MarketSemanticsFactV1,
    cut: MarketSemanticsCutV1,
    store_generation_identity: MarketSemanticsIdentity,
    append_sequence: u64,
    stable_correlation: MarketSemanticsIdentity,
) -> Result<MarketSemanticsReadbackV1, MarketSemanticsErrorV1> {
    if !nonzero(store_generation_identity) || !nonzero(stable_correlation) || append_sequence == 0 {
        return Err(MarketSemanticsErrorV1::InvalidFact);
    }
    let mut receipt = MarketSemanticsReceiptV1 {
        request_identity: cut.request_identity,
        request_meaning_digest: cut.request_meaning_digest,
        consumer: cut.consumer,
        cut_identity: cut.identity,
        cut_digest: cut.identity,
        store_generation_identity,
        append_sequence,
        stable_correlation,
        canonical_bytes: Box::default(),
        identity: MarketSemanticsIdentity::from_untrusted_bytes([0; 32]),
    };
    receipt.canonical_bytes = codec::encode_receipt(&receipt)?;
    receipt.identity = codec::digest(codec::RECEIPT_DOMAIN, &receipt.canonical_bytes);
    let outbox_identity = receipt.identity;
    let mut readback = MarketSemanticsReadbackV1 {
        facts: vec![fact].into_boxed_slice(),
        cut,
        receipt,
        outbox_identity,
        canonical_bytes: Box::default(),
        identity: MarketSemanticsIdentity::from_untrusted_bytes([0; 32]),
    };
    readback.canonical_bytes = codec::encode_readback(&readback)?;
    readback.identity = codec::digest(codec::READBACK_DOMAIN, &readback.canonical_bytes);
    verify_readback_v1(&readback)?;
    Ok(readback)
}

pub(crate) fn verify_readback_v1(
    readback: &MarketSemanticsReadbackV1,
) -> Result<(), MarketSemanticsErrorV1> {
    let [fact] = readback.facts.as_ref() else {
        return Err(MarketSemanticsErrorV1::IncompleteCut);
    };
    let [entry] = readback.cut.entries.as_ref() else {
        return Err(MarketSemanticsErrorV1::IncompleteCut);
    };
    if !valid_fact(fact)
        || !readback.cut.gaps.is_empty()
        || entry.scope_identity != fact.compatibility_scope_identity
        || entry.fact_identity != fact.identity
        || entry.fact_digest != fact.identity
        || readback.cut.compatibility_scope_identity != fact.compatibility_scope_identity
        || readback.cut.effective_instant_ns < fact.effective_from_ns
        || fact
            .effective_until_ns
            .is_some_and(|until| readback.cut.effective_instant_ns >= until)
        || readback.cut.owner_observation_ns != fact.owner_observation_ns
        || readback.cut.decision_cut != fact.decision_cut
        || !nonzero(readback.cut.request_identity)
        || !nonzero(readback.cut.request_meaning_digest)
        || !nonzero(readback.cut.r0_cut_identity)
        || !nonzero(readback.cut.r0_cut_digest)
        || readback.receipt.request_identity != readback.cut.request_identity
        || readback.receipt.request_meaning_digest != readback.cut.request_meaning_digest
        || readback.receipt.consumer != readback.cut.consumer
        || readback.receipt.cut_identity != readback.cut.identity
        || readback.receipt.cut_digest != readback.cut.identity
        || !nonzero(readback.receipt.store_generation_identity)
        || readback.receipt.append_sequence == 0
        || !nonzero(readback.receipt.stable_correlation)
        || readback.outbox_identity != readback.receipt.identity
        || codec::encode_fact(fact)?.as_ref() != fact.canonical_bytes.as_ref()
        || codec::digest(codec::FACT_DOMAIN, &fact.canonical_bytes) != fact.identity
        || codec::encode_cut(&readback.cut)?.as_ref() != readback.cut.canonical_bytes.as_ref()
        || codec::digest(codec::CUT_DOMAIN, &readback.cut.canonical_bytes) != readback.cut.identity
        || codec::encode_receipt(&readback.receipt)?.as_ref()
            != readback.receipt.canonical_bytes.as_ref()
        || codec::digest(codec::RECEIPT_DOMAIN, &readback.receipt.canonical_bytes)
            != readback.receipt.identity
        || codec::encode_readback(readback)?.as_ref() != readback.canonical_bytes.as_ref()
        || codec::digest(codec::READBACK_DOMAIN, &readback.canonical_bytes) != readback.identity
    {
        return Err(MarketSemanticsErrorV1::DigestMismatch);
    }
    Ok(())
}

pub(crate) fn decode_and_verify_readback_v1(
    bytes: &[u8],
) -> Result<MarketSemanticsReadbackV1, MarketSemanticsErrorV1> {
    let readback = codec::decode_readback(bytes)?;
    verify_readback_v1(&readback)?;
    Ok(readback)
}

pub(crate) fn validate_successor_v1(
    predecessor: Option<&MarketSemanticsFactV1>,
    successor: &MarketSemanticsFactV1,
) -> Result<(), MarketSemanticsErrorV1> {
    match (predecessor, successor.predecessor_identity) {
        (None, None) => Ok(()),
        (Some(prior), Some(identity))
            if identity == prior.identity
                && prior.compatibility_scope_identity == successor.compatibility_scope_identity
                && prior.correction_identity != successor.correction_identity
                && prior.correction_frontier != successor.correction_frontier
                && prior.source_binding_lineage_root == successor.source_binding_lineage_root
                && prior.source_binding_lineage_version
                    <= successor.source_binding_lineage_version
                && prior.owner_observation_ns < successor.owner_observation_ns
                && prior.decision_cut < successor.decision_cut =>
        {
            Ok(())
        }
        (None, Some(_)) => Err(MarketSemanticsErrorV1::MissingPredecessor),
        _ => Err(MarketSemanticsErrorV1::InvalidCorrection),
    }
}

fn valid_fact(fact: &MarketSemanticsFactV1) -> bool {
    [
        fact.compatibility_scope_identity,
        fact.value.normalization_identity,
        fact.value.price_unit_identity,
        fact.value.size_unit_identity,
        fact.coordinate_identity,
        fact.coordinate_digest,
        fact.pit_snapshot_identity,
        fact.pit_fact_digest,
        fact.source_binding_identity,
        fact.source_binding_fact_digest,
        fact.source_binding_lineage_root,
        fact.instrument_master_readback_digest,
        fact.instrument_master_fact_digest,
        fact.instrument_master_cut_digest,
        fact.source_frontier,
        fact.correction_frontier,
        fact.correction_identity,
    ]
    .into_iter()
    .all(nonzero)
        && fact.predecessor_identity.is_none_or(nonzero)
        && fact.predecessor_identity != Some(fact.identity)
        && fact
            .effective_until_ns
            .is_none_or(|until| until > fact.effective_from_ns)
        && fact.provider_available_ns > 0
        && fact.provider_available_ns <= fact.retrieval_ns
        && fact.correction_publication_ns > 0
        && fact.correction_publication_ns <= fact.retrieval_ns
        && fact.retrieval_ns <= fact.owner_observation_ns
        && fact.decision_cut > 0
        && fact.source_binding_lineage_version > 0
}

fn validate_proposal(
    proposal: &UntrustedMarketSemanticsProposalV1,
    inputs: &AuthenticatedMarketSemanticsInputsV1,
) -> Result<(), MarketSemanticsErrorV1> {
    let identities = [
        proposal.request_identity,
        proposal.compatibility_scope_identity,
        proposal.value.normalization_identity,
        proposal.value.price_unit_identity,
        proposal.value.size_unit_identity,
        proposal.stable_correlation,
    ];
    if proposal.consumer != MarketSemanticsConsumerV1::StrategyInputBindingRegistry
        || !identities.into_iter().all(nonzero)
        || proposal.request_meaning_digest != request_meaning_digest_v1(proposal)?
        || proposal.compatibility_scope_identity != inputs.registry.key.compatibility_scope_identity
        || proposal.value != inputs.registry.value
        || proposal.effective_from_ns != inputs.effective_from_ns
        || proposal.effective_until_ns != inputs.effective_until_ns
        || proposal.owner_observation_ns != inputs.owner_observation_ns
        || proposal.decision_cut != inputs.decision_cut
        || proposal.predecessor_identity != inputs.predecessor_identity
        || proposal.stable_correlation != inputs.stable_correlation
        || proposal
            .effective_until_ns
            .is_some_and(|until| until <= proposal.effective_from_ns)
        || proposal.effective_instant_ns < proposal.effective_from_ns
        || proposal
            .effective_until_ns
            .is_some_and(|until| proposal.effective_instant_ns >= until)
        || proposal.owner_observation_ns <= 0
        || proposal.decision_cut == 0
        || inputs.provider_available_ns > inputs.retrieval_ns
        || inputs.correction_publication_ns > inputs.retrieval_ns
        || inputs.retrieval_ns > proposal.owner_observation_ns
    {
        return Err(MarketSemanticsErrorV1::InvalidRequest);
    }
    Ok(())
}
