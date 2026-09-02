use super::{authority, codec, *};

fn id(byte: u8) -> MarketSemanticsIdentity {
    MarketSemanticsIdentity::from_untrusted_bytes([byte; 32])
}

fn value() -> MarketSemanticsValueV1 {
    MarketSemanticsValueV1 {
        normalization_identity: id(10),
        price_adjustment: MarketSemanticsPriceAdjustmentV1::Raw,
        timestamp_basis: MarketSemanticsTimestampBasisV1::EventEffective,
        price_unit_identity: id(11),
        size_unit_identity: id(12),
    }
}

impl MarketSemanticsRegistryEntryV1 {
    pub(crate) fn seal_for_postgres_test(
        compatibility_scope_identity: MarketSemanticsIdentity,
        value: MarketSemanticsValueV1,
        correction_identity: MarketSemanticsIdentity,
    ) -> Self {
        let mut key = MarketSemanticsRegistryKeyV1 {
            compatibility_scope_identity,
            r0_record_identity: id(31),
            r0_record_digest: id(32),
            r0_cut_identity: id(33),
            r0_cut_digest: id(34),
            pit_snapshot_identity: id(35),
            pit_fact_digest: id(36),
            source_binding_identity: id(37),
            source_binding_fact_digest: id(38),
            source_binding_lineage_root: id(39),
            source_binding_lineage_version: 1,
            instrument_master_readback_digest: id(40),
            instrument_master_fact_digest: id(41),
            instrument_master_cut_digest: id(42),
            source_frontier: id(43),
            correction_frontier: id(44),
            canonical_bytes: Box::default(),
            identity: id(99),
        };
        key.canonical_bytes = codec::encode_registry_key(&key).unwrap();
        key.identity = codec::digest(codec::REGISTRY_KEY_DOMAIN, &key.canonical_bytes);
        authority::seal_registry_entry_v1(key, value, correction_identity).unwrap()
    }
}

fn inputs() -> AuthenticatedMarketSemanticsInputsV1 {
    AuthenticatedMarketSemanticsInputsV1 {
        registry: MarketSemanticsRegistryEntryV1::seal_for_postgres_test(id(3), value(), id(30)),
        coordinate_identity: id(31),
        coordinate_digest: id(32),
        r0_cut_identity: id(33),
        r0_cut_digest: id(34),
        pit_snapshot_identity: id(35),
        pit_fact_digest: id(36),
        source_binding_identity: id(37),
        source_binding_fact_digest: id(38),
        source_binding_lineage_root: id(39),
        source_binding_lineage_version: 1,
        instrument_master_readback_digest: id(40),
        instrument_master_fact_digest: id(41),
        instrument_master_cut_digest: id(42),
        source_frontier: id(43),
        correction_frontier: id(44),
        provider_available_ns: 100,
        retrieval_ns: 110,
        correction_publication_ns: 105,
        effective_from_ns: 0,
        effective_until_ns: Some(1_000),
        owner_observation_ns: 120,
        decision_cut: 7,
        predecessor_identity: None,
        stable_correlation: id(9),
    }
}

fn proposal() -> UntrustedMarketSemanticsProposalV1 {
    let mut proposal = UntrustedMarketSemanticsProposalV1 {
        request_identity: id(1),
        request_meaning_digest: id(99),
        consumer: MarketSemanticsConsumerV1::StrategyInputBindingRegistry,
        compatibility_scope_identity: id(3),
        predecessor_identity: None,
        value: value(),
        effective_from_ns: 0,
        effective_until_ns: Some(1_000),
        effective_instant_ns: 500,
        owner_observation_ns: 120,
        decision_cut: 7,
        pit_locator_bytes: vec![1].into_boxed_slice(),
        source_binding_locator_bytes: vec![2].into_boxed_slice(),
        instrument_master_locator_bytes: vec![3].into_boxed_slice(),
        r0_locator_bytes: vec![4].into_boxed_slice(),
        stable_correlation: id(9),
    };
    proposal.request_meaning_digest = authority::request_meaning_digest_v1(&proposal).unwrap();
    proposal
}

fn readback() -> MarketSemanticsReadbackV1 {
    let proposal = proposal();
    let (fact, cut) = authority::issue_fact_and_cut_v1(&proposal, &inputs()).unwrap();
    authority::issue_readback_v1(fact, cut, id(50), 1, proposal.stable_correlation).unwrap()
}

#[test]
fn exact_readback_round_trip_verifies_every_nested_domain() {
    let readback = readback();
    let decoded = authority::decode_and_verify_readback_v1(readback.canonical_bytes()).unwrap();
    assert_eq!(decoded, readback);
    assert_eq!(readback.outbox_identity(), readback.receipt().identity());
}

#[test]
fn request_meaning_excludes_idempotency_key_but_binds_locators() {
    let original = proposal();
    let mut changed_key = original.clone();
    changed_key.request_identity = id(2);
    assert_eq!(
        authority::request_meaning_digest_v1(&original).unwrap(),
        authority::request_meaning_digest_v1(&changed_key).unwrap()
    );
    let mut changed_locator = original.clone();
    changed_locator.r0_locator_bytes = vec![9].into_boxed_slice();
    assert_ne!(
        authority::request_meaning_digest_v1(&original).unwrap(),
        authority::request_meaning_digest_v1(&changed_locator).unwrap()
    );
}

#[test]
fn first_leaf_rejects_later_replay_consumer() {
    let mut proposal = proposal();
    proposal.consumer = MarketSemanticsConsumerV1::ReplayMarketFactsV2;
    proposal.request_meaning_digest = authority::request_meaning_digest_v1(&proposal).unwrap();
    assert_eq!(
        authority::issue_fact_and_cut_v1(&proposal, &inputs()),
        Err(MarketSemanticsErrorV1::InvalidRequest)
    );
}

#[test]
fn untrusted_typed_value_cannot_override_registry() {
    let mut proposal = proposal();
    proposal.value.price_adjustment = MarketSemanticsPriceAdjustmentV1::SplitAdjusted;
    proposal.request_meaning_digest = authority::request_meaning_digest_v1(&proposal).unwrap();
    assert_eq!(
        authority::issue_fact_and_cut_v1(&proposal, &inputs()),
        Err(MarketSemanticsErrorV1::InvalidRequest)
    );
}

#[test]
fn trailing_or_tampered_custody_fails_closed() {
    let readback = readback();
    let mut trailing = readback.canonical_bytes().to_vec();
    trailing.push(0);
    assert!(authority::decode_and_verify_readback_v1(&trailing).is_err());
    let mut tampered = readback.canonical_bytes().to_vec();
    let last = tampered.len() - 1;
    tampered[last] ^= 1;
    assert_eq!(
        authority::decode_and_verify_readback_v1(&tampered),
        Err(MarketSemanticsErrorV1::DigestMismatch)
    );
}

#[test]
fn unknown_closed_enum_tag_is_rejected() {
    let fact = readback().facts()[0].clone();
    let mut bytes = fact.canonical_bytes().to_vec();
    // schema(4) + scope(32) + predecessor absence(1) + normalization(32)
    bytes[69] = 0;
    bytes[70] = 9;
    assert_eq!(
        codec::decode_fact(&bytes),
        Err(MarketSemanticsErrorV1::CodecMismatch)
    );
}

#[test]
fn generation_changes_receipt_and_outbox_remains_receipt() {
    let proposal = proposal();
    let inputs = inputs();
    let (fact_a, cut_a) = authority::issue_fact_and_cut_v1(&proposal, &inputs).unwrap();
    let first = authority::issue_readback_v1(fact_a, cut_a, id(50), 1, id(9)).unwrap();
    let (fact_b, cut_b) = authority::issue_fact_and_cut_v1(&proposal, &inputs).unwrap();
    let second = authority::issue_readback_v1(fact_b, cut_b, id(51), 1, id(9)).unwrap();
    assert_ne!(first.receipt().identity(), second.receipt().identity());
    assert_eq!(second.outbox_identity(), second.receipt().identity());
}

#[test]
fn correction_requires_current_direct_advancing_successor() {
    let first = readback().facts()[0].clone();
    let mut proposal = proposal();
    proposal.request_identity = id(60);
    proposal.predecessor_identity = Some(first.identity());
    proposal.owner_observation_ns = 130;
    proposal.decision_cut = 8;
    let mut next_inputs = inputs();
    next_inputs.registry.correction_identity = id(61);
    next_inputs.correction_frontier = id(62);
    next_inputs.owner_observation_ns = 130;
    next_inputs.decision_cut = 8;
    next_inputs.predecessor_identity = Some(first.identity());
    proposal.request_meaning_digest = authority::request_meaning_digest_v1(&proposal).unwrap();
    let (next, _) = authority::issue_fact_and_cut_v1(&proposal, &next_inputs).unwrap();
    assert_eq!(
        authority::validate_successor_v1(Some(&first), &next),
        Ok(())
    );
    assert_eq!(
        authority::validate_successor_v1(None, &next),
        Err(MarketSemanticsErrorV1::MissingPredecessor)
    );
}
