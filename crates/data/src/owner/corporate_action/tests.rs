use super::{authority, codec, *};
use rstest::rstest;

fn id(byte: u8) -> CorporateActionIdentity {
    CorporateActionIdentity::from_untrusted_bytes([byte; 32])
}

fn entry(
    action: u8,
    instrument: &[u8],
    terms: CorporateActionTermsV1,
) -> AuthenticatedCorporateActionEntryV1 {
    AuthenticatedCorporateActionEntryV1 {
        registry: CorporateActionRegistryEntryV1 {
            action_identity: id(action),
            instrument: instrument.into(),
            terms,
            correction_identity: id(action + 40),
        },
        predecessor_identity: None,
        effective_from_ns: 100,
        effective_until_ns: Some(101),
        provider_available_ns: 110,
        retrieval_ns: 115,
        correction_publication_ns: 112,
        owner_observation_ns: 120,
        decision_cut: 7,
        coordinate_identity: id(20),
        coordinate_digest: id(21),
        instrument_master_fact_digest: id(22),
        pit_snapshot_identity: id(23),
        pit_fact_digest: id(24),
        source_binding_identity: id(25),
        source_binding_fact_digest: id(26),
        source_binding_lineage_root: id(27),
        source_binding_lineage_version: 1,
        source_frontier: id(28),
        correction_frontier: id(29),
    }
}

fn inputs(
    entries: Vec<AuthenticatedCorporateActionEntryV1>,
) -> AuthenticatedCorporateActionInputsV1 {
    let mut instruments = entries
        .iter()
        .map(|entry| entry.registry.instrument.clone())
        .collect::<Vec<_>>();
    instruments.sort();
    instruments.dedup();
    AuthenticatedCorporateActionInputsV1 {
        entries: entries.into_boxed_slice(),
        instruments: instruments.into_boxed_slice(),
        r0_cut_identity: id(30),
        r0_cut_digest: id(31),
        instrument_master_readback_digest: id(32),
        instrument_master_cut_digest: id(33),
        pit_cut_digest: id(34),
        stable_correlation: id(9),
    }
}

fn proposal(instruments: Vec<&[u8]>) -> UntrustedCorporateActionProposalV1 {
    let mut proposal = UntrustedCorporateActionProposalV1 {
        request_identity: id(1),
        request_meaning_digest: id(99),
        consumer: CorporateActionConsumerV1::ReplayV2,
        replay_start_ns: 0,
        replay_end_ns_exclusive: 1_000,
        instruments: instruments
            .into_iter()
            .map(Box::from)
            .collect::<Vec<_>>()
            .into_boxed_slice(),
        owner_observation_ns: 120,
        decision_cut: 7,
        instrument_master_locator_bytes: vec![1].into_boxed_slice(),
        pit_locator_bytes: vec![2].into_boxed_slice(),
        source_binding_locator_bytes: vec![3].into_boxed_slice(),
        r0_locator_bytes: vec![4].into_boxed_slice(),
        stable_correlation: id(9),
    };
    proposal.request_meaning_digest = authority::request_meaning_digest_v1(&proposal).unwrap();
    proposal
}

fn readback() -> CorporateActionReadbackV1 {
    let proposal = proposal(vec![b"AAA"]);
    let inputs = inputs(vec![entry(
        1,
        b"AAA",
        CorporateActionTermsV1::Split {
            numerator: 2,
            denominator: 1,
        },
    )]);
    let (facts, cut) = authority::issue_facts_and_cut_v1(&proposal, &inputs).unwrap();
    authority::issue_readback_v1(facts, cut, id(50), 1, id(9)).unwrap()
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn replay_empty_corporate_action_fixture_v1(
    request_identity: CorporateActionIdentity,
    instrument: &[u8],
    replay_start_ns: i128,
    replay_end_ns_exclusive: i128,
    owner_observation_ns: i128,
    decision_cut: u64,
    instrument_locator_bytes: &[u8],
    pit_locator_bytes: &[u8],
    source_locator_bytes: &[u8],
    r0_locator_bytes: &[u8],
    stable_correlation: CorporateActionIdentity,
    r0_cut_identity: CorporateActionIdentity,
    r0_cut_digest: CorporateActionIdentity,
    instrument_readback_digest: CorporateActionIdentity,
    instrument_cut_digest: CorporateActionIdentity,
    pit_cut_digest: CorporateActionIdentity,
) -> (
    UntrustedCorporateActionProposalV1,
    AuthenticatedCorporateActionInputsV1,
) {
    let mut proposal = UntrustedCorporateActionProposalV1 {
        request_identity,
        request_meaning_digest: id(0),
        consumer: CorporateActionConsumerV1::ReplayV2,
        replay_start_ns,
        replay_end_ns_exclusive,
        instruments: vec![instrument.to_vec().into_boxed_slice()].into_boxed_slice(),
        owner_observation_ns,
        decision_cut,
        instrument_master_locator_bytes: instrument_locator_bytes.to_vec().into_boxed_slice(),
        pit_locator_bytes: pit_locator_bytes.to_vec().into_boxed_slice(),
        source_binding_locator_bytes: source_locator_bytes.to_vec().into_boxed_slice(),
        r0_locator_bytes: r0_locator_bytes.to_vec().into_boxed_slice(),
        stable_correlation,
    };
    proposal.request_meaning_digest = authority::request_meaning_digest_v1(&proposal).unwrap();
    let inputs = AuthenticatedCorporateActionInputsV1 {
        entries: Box::new([]),
        instruments: vec![instrument.to_vec().into_boxed_slice()].into_boxed_slice(),
        r0_cut_identity,
        r0_cut_digest,
        instrument_master_readback_digest: instrument_readback_digest,
        instrument_master_cut_digest: instrument_cut_digest,
        pit_cut_digest,
        stable_correlation,
    };
    (proposal, inputs)
}

#[rstest]
fn exact_readback_roundtrip_and_receipt_is_outbox() {
    let value = readback();
    let decoded = authority::decode_and_verify_readback_v1(value.canonical_bytes()).unwrap();
    assert_eq!(decoded, value);
    assert_eq!(value.outbox_identity(), value.receipt().identity());
}

#[rstest]
fn explicit_empty_instrument_census_is_canonical() {
    let _ = replay_empty_corporate_action_fixture_v1(
        id(90),
        b"AAA",
        0,
        1_000,
        120,
        7,
        b"instrument",
        b"pit",
        b"source",
        b"r0",
        id(9),
        id(30),
        id(31),
        id(32),
        id(33),
        id(34),
    );
    let proposal = proposal(vec![b"AAA", b"BBB"]);
    let mut authenticated = inputs(Vec::new());
    authenticated.instruments =
        vec![b"AAA".as_slice().into(), b"BBB".as_slice().into()].into_boxed_slice();
    let (facts, cut) = authority::issue_facts_and_cut_v1(&proposal, &authenticated).unwrap();
    assert!(facts.is_empty());
    assert_eq!(cut.census.len(), 2);
    assert!(cut.census.iter().all(|value| value.actions.is_empty()));
    let readback = authority::issue_readback_v1(facts, cut, id(50), 1, id(9)).unwrap();
    assert!(authority::decode_and_verify_readback_v1(readback.canonical_bytes()).is_ok());
}

#[rstest]
fn request_binds_ordered_census_and_locators_but_not_request_key() {
    let original = proposal(vec![b"AAA", b"BBB"]);
    let mut key = original.clone();
    key.request_identity = id(2);
    assert_eq!(
        authority::request_meaning_digest_v1(&original),
        authority::request_meaning_digest_v1(&key)
    );
    let mut locator = original.clone();
    locator.r0_locator_bytes = vec![9].into_boxed_slice();
    assert_ne!(
        authority::request_meaning_digest_v1(&original),
        authority::request_meaning_digest_v1(&locator)
    );
}

#[rstest]
fn unsorted_or_duplicate_instruments_fail_closed() {
    let proposal = proposal(vec![b"BBB", b"AAA"]);
    assert_eq!(
        authority::issue_facts_and_cut_v1(&proposal, &inputs(Vec::new())),
        Err(CorporateActionErrorV1::InvalidRequest)
    );
}

#[rstest]
fn split_direction_and_cash_adjustment_are_fixed() {
    let split = CorporateActionTermsV1::Split {
        numerator: 3,
        denominator: 2,
    };
    assert_eq!(split.split_quantity_ratio(), Some((3, 2)));
    assert_eq!(split.split_price_ratio(), Some((2, 3)));
    assert_eq!(split.cash_dividend_price_adjustment(), None);
    let dividend = CorporateActionTermsV1::CashDividend {
        mantissa: -25,
        scale: 2,
        currency_identity: b"USD".as_slice().into(),
    };
    assert_eq!(
        dividend.cash_dividend_price_adjustment(),
        Some(CashDividendPriceAdjustmentV1::SubtractCashFromPreActionPrice)
    );
}

#[rstest]
fn all_closed_action_terms_roundtrip_without_normalization() {
    let proposal = proposal(vec![b"AAA"]);
    let terms = vec![
        CorporateActionTermsV1::Split {
            numerator: 3,
            denominator: 2,
        },
        CorporateActionTermsV1::CashDividend {
            mantissa: -25,
            scale: 2,
            currency_identity: b"USD".as_slice().into(),
        },
        CorporateActionTermsV1::SymbolChange {
            successor_instrument: b"AAB".as_slice().into(),
        },
        CorporateActionTermsV1::Expiry,
        CorporateActionTermsV1::Roll {
            successor_instrument: b"AAC".as_slice().into(),
        },
    ];
    let authenticated = inputs(
        terms
            .into_iter()
            .enumerate()
            .map(|(index, terms)| entry(u8::try_from(index + 1).unwrap(), b"AAA", terms))
            .collect(),
    );
    let (facts, cut) = authority::issue_facts_and_cut_v1(&proposal, &authenticated).unwrap();
    let readback = authority::issue_readback_v1(facts, cut, id(50), 1, id(9)).unwrap();
    assert_eq!(
        authority::decode_and_verify_readback_v1(readback.canonical_bytes()).unwrap(),
        readback
    );
}

#[rstest]
fn invalid_ratio_or_self_transition_is_rejected() {
    let p = proposal(vec![b"AAA"]);
    let bad = inputs(vec![entry(
        1,
        b"AAA",
        CorporateActionTermsV1::Split {
            numerator: 0,
            denominator: 1,
        },
    )]);
    assert_eq!(
        authority::issue_facts_and_cut_v1(&p, &bad),
        Err(CorporateActionErrorV1::InvalidFact)
    );
    let bad = inputs(vec![entry(
        1,
        b"AAA",
        CorporateActionTermsV1::Roll {
            successor_instrument: b"AAA".as_slice().into(),
        },
    )]);
    assert_eq!(
        authority::issue_facts_and_cut_v1(&p, &bad),
        Err(CorporateActionErrorV1::InvalidFact)
    );
}

#[rstest]
fn tamper_and_unknown_term_tag_fail_closed() {
    let value = readback();
    let mut trailing = value.canonical_bytes().to_vec();
    trailing.push(0);
    assert!(authority::decode_and_verify_readback_v1(&trailing).is_err());
    let mut fact = value.facts()[0].canonical_bytes().to_vec();
    fact[43] = 0;
    fact[44] = 9;
    assert_eq!(
        codec::decode_fact(&fact),
        Err(CorporateActionErrorV1::CodecMismatch)
    );
}

#[rstest]
fn correction_requires_direct_same_action_successor() {
    let first = readback().facts()[0].clone();
    let mut next = first.clone();
    next.predecessor_identity = Some(first.identity());
    next.correction_identity = id(70);
    next.correction_frontier = id(71);
    next.owner_observation_ns = 130;
    next.decision_cut = 8;
    next.canonical_bytes = codec::encode_fact(&next).unwrap();
    next.identity = codec::digest(codec::FACT_DOMAIN, &next.canonical_bytes);
    assert_eq!(
        authority::validate_successor_v1(Some(&first), &next),
        Ok(())
    );
    next.action_identity = id(72);
    assert_eq!(
        authority::validate_successor_v1(Some(&first), &next),
        Err(CorporateActionErrorV1::InvalidCorrection)
    );
}

#[rstest]
fn generation_changes_receipt_identity() {
    let p = proposal(vec![b"AAA"]);
    let input = inputs(vec![entry(1, b"AAA", CorporateActionTermsV1::Expiry)]);
    let (facts, cut) = authority::issue_facts_and_cut_v1(&p, &input).unwrap();
    let a = authority::issue_readback_v1(facts, cut, id(50), 1, id(9)).unwrap();
    let (facts, cut) = authority::issue_facts_and_cut_v1(&p, &input).unwrap();
    let b = authority::issue_readback_v1(facts, cut, id(51), 1, id(9)).unwrap();
    assert_ne!(a.receipt().identity(), b.receipt().identity());
    assert_eq!(b.receipt().identity(), b.outbox_identity());
}
