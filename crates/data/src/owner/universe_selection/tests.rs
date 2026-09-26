use super::{
    authority::{
        CanonicalUniverseSelectionRuleEvaluatorV1, HistoricalMembershipFactProposalV1,
        decode_readback_v1, issue_source_fact_v1, issue_universe_selection_readback_v1,
        select_complete_membership_v1,
    },
    *,
};
use rstest::rstest;

fn digest(byte: u8) -> BindingDigest {
    BindingDigest::from_untrusted_bytes([byte; 32])
}

fn request(
    rule: Vec<u8>,
    decision_cut: u64,
    observed: i128,
) -> UntrustedUniverseSelectionRequestV1 {
    UntrustedUniverseSelectionRequestV1::new(
        digest(1),
        "RESEARCH_OWNER_V1",
        digest(2),
        rule,
        digest(3),
        10,
        observed,
        decision_cut,
        digest(4),
        digest(5),
        digest(6),
    )
}

fn fact(
    key: &[u8],
    instrument: &[u8],
    decision_cut: u64,
    observed: i128,
) -> HistoricalMembershipFactProposalV1 {
    HistoricalMembershipFactProposalV1 {
        member_key: key.to_vec(),
        instrument: instrument.to_vec(),
        predecessor_identity: None,
        effective_from_ns: 1,
        effective_until_ns: None,
        provider_available_ns: 2,
        retrieval_ns: 3,
        correction_publication_ns: observed,
        owner_observation_ns: observed,
        decision_cut,
        source_binding_lineage_root: digest(4),
        correction_frontier_digest: digest(5),
    }
}

fn select(
    request: &UntrustedUniverseSelectionRequestV1,
    proposals: Vec<HistoricalMembershipFactProposalV1>,
    manifest: &[&[u8]],
) -> Result<UniverseSelectionReadbackV1, UniverseSelectionErrorV1> {
    let source = proposals
        .into_iter()
        .map(issue_source_fact_v1)
        .collect::<Result<Vec<_>, _>>()?;
    let manifest = manifest.iter().map(|key| key.to_vec()).collect::<Vec<_>>();
    let membership = select_complete_membership_v1(
        request,
        &source,
        &manifest,
        Some(&CanonicalUniverseSelectionRuleEvaluatorV1),
    )?;
    issue_universe_selection_readback_v1(request, membership, digest(9), 1)
}

#[rstest]
fn derives_complete_canonical_partition_without_caller_members() {
    let readback = select(
        &request(vec![0, 1, 2, b'A'], 7, 20),
        vec![
            fact(b"MSFT", b"MSFT.XNAS", 7, 20),
            fact(b"AAPL", b"AAPL.XNAS", 7, 20),
        ],
        &[b"AAPL", b"MSFT"],
    )
    .unwrap();
    assert_eq!(readback.record().membership().len(), 2);
    assert_eq!(readback.record().membership()[0].member_key(), b"AAPL");
    assert!(readback.record().membership()[0].included());
    assert!(!readback.record().membership()[1].included());
    assert_eq!(
        readback.record().membership()[1].exclusion_reason(),
        Some(b"RULE_FILTERED_V1".as_slice())
    );
    assert!(verify_universe_selection_readback_v1(&readback));
}

#[rstest]
fn omitted_manifest_member_and_future_correction_fail_closed() {
    let request = request(vec![0, 1, 1], 7, 20);
    assert_eq!(
        select(
            &request,
            vec![fact(b"AAPL", b"AAPL.XNAS", 7, 20)],
            &[b"AAPL", b"MSFT"]
        )
        .unwrap_err(),
        UniverseSelectionErrorV1::InvalidMembership,
    );
    let original = fact(b"AAPL", b"AAPL.XNAS", 7, 20);
    let mut correction = fact(b"AAPL", b"AAPL.XNAS", 8, 21);
    correction.predecessor_identity =
        Some(issue_source_fact_v1(original.clone()).unwrap().identity());
    let readback = select(&request, vec![original, correction], &[b"AAPL"]).unwrap();
    assert_eq!(readback.record().membership()[0].decision_cut(), 7);
}

#[rstest]
fn unsupported_or_absent_evaluator_is_typed_unavailable() {
    let request = request(vec![9], 7, 20);
    let source = vec![issue_source_fact_v1(fact(b"AAPL", b"AAPL.XNAS", 7, 20)).unwrap()];
    assert_eq!(
        select_complete_membership_v1(&request, &source, &[b"AAPL".to_vec()], None).unwrap_err(),
        UniverseSelectionErrorV1::EvaluatorUnavailable,
    );
    assert_eq!(
        select_complete_membership_v1(
            &request,
            &source,
            &[b"AAPL".to_vec()],
            Some(&CanonicalUniverseSelectionRuleEvaluatorV1)
        )
        .unwrap_err(),
        UniverseSelectionErrorV1::EvaluatorUnavailable,
    );
}

#[rstest]
fn durable_codec_recovers_exact_identity_and_rejects_tampering() {
    let readback = select(
        &request(vec![0, 1, 1], 7, 20),
        vec![fact(b"AAPL", b"AAPL.XNAS", 7, 20)],
        &[b"AAPL"],
    )
    .unwrap();
    let recovered = decode_readback_v1(
        readback.record().canonical_bytes(),
        readback.receipt().canonical_bytes(),
        readback.outbox_identity(),
    )
    .unwrap();
    assert_eq!(recovered.record().identity(), readback.record().identity());
    assert_eq!(
        recovered.receipt().identity(),
        readback.receipt().identity()
    );
    let mut tampered = readback.record().canonical_bytes().to_vec();
    tampered.push(0);
    assert_eq!(
        decode_readback_v1(
            &tampered,
            readback.receipt().canonical_bytes(),
            readback.outbox_identity()
        )
        .unwrap_err(),
        UniverseSelectionErrorV1::CodecMismatch,
    );
}

#[rstest]
fn request_meaning_binds_rule_bytes_and_identity() {
    assert_ne!(
        request(vec![0, 1, 1], 7, 20).request_meaning_digest(),
        request(vec![0, 1, 2, b'A'], 7, 20).request_meaning_digest()
    );
    assert_eq!(
        request(vec![0, 1, 1], 7, 20).request_identity(),
        request(vec![0, 1, 2, b'A'], 7, 20).request_identity()
    );
}

#[rstest]
fn instrument_master_adapter_consumes_only_owner_selected_members() {
    use crate::owner::instrument_master::InstrumentMasterUniverseMembershipResolver;

    let readback = select(
        &request(vec![0, 1, 2, b'A'], 7, 20),
        vec![
            fact(b"MSFT", b"MSFT.XNAS", 7, 20),
            fact(b"AAPL", b"AAPL.XNAS", 7, 20),
        ],
        &[b"AAPL", b"MSFT"],
    )
    .unwrap();
    let membership = readback
        .resolve_instrument_master_membership(readback.record().identity())
        .unwrap();
    assert_eq!(membership.members, vec!["AAPL.XNAS"]);
}

fn fixed_member_request(
    rule_identity: Option<BindingDigest>,
    rule_bytes: Vec<u8>,
) -> UntrustedUniverseSelectionRequestV1 {
    let scope =
        crate::owner::research_instrument_scope_v1::ResearchInstrumentScopeV1::from_identities(
            vec!["MSFT.XNAS".into()],
        )
        .unwrap();
    UntrustedUniverseSelectionRequestV1::new(
        digest(1),
        "RESEARCH_OWNER_V1",
        rule_identity.unwrap_or(scope.identity()),
        if rule_bytes.is_empty() {
            scope.fixed_member_selection_rule_bytes()
        } else {
            rule_bytes
        },
        digest(3),
        10,
        20,
        7,
        digest(4),
        digest(5),
        digest(6),
    )
}

#[rstest]
fn the_fixed_member_rule_includes_exactly_the_scopes_instruments() {
    let readback = select(
        &fixed_member_request(None, Vec::new()),
        vec![
            fact(b"MSFT", b"MSFT.XNAS", 7, 20),
            fact(b"AAPL", b"AAPL.XNAS", 7, 20),
        ],
        &[b"AAPL", b"MSFT"],
    )
    .unwrap();
    let membership = readback
        .record()
        .membership()
        .iter()
        .map(|member| {
            (
                member.instrument(),
                member.included(),
                member.exclusion_reason(),
            )
        })
        .collect::<Vec<_>>();
    assert_eq!(
        membership,
        [
            (
                b"AAPL.XNAS".as_slice(),
                false,
                Some(b"RULE_FILTERED_V1".as_slice())
            ),
            (b"MSFT.XNAS".as_slice(), true, None),
        ]
    );
    assert!(verify_universe_selection_readback_v1(&readback));
}

#[rstest]
#[case::another_rule_identity(Some(digest(2)), Vec::new())]
#[case::bytes_that_are_no_scope(None, vec![0, 1, 3, 9])]
#[case::the_prefix_alone(None, vec![0, 1, 3])]
fn a_fixed_member_rule_that_does_not_state_its_scope_is_refused(
    #[case] rule_identity: Option<BindingDigest>,
    #[case] rule_bytes: Vec<u8>,
) {
    assert_eq!(
        select(
            &fixed_member_request(rule_identity, rule_bytes),
            vec![fact(b"MSFT", b"MSFT.XNAS", 7, 20)],
            &[b"MSFT"],
        )
        .unwrap_err(),
        UniverseSelectionErrorV1::InvalidRequest
    );
}

/// R&D is given the included members in the record's membership order, as the Instrument Master
/// canonical identities the record holds.
///
/// The fixture includes every member it is given, so an excluded member being dropped is proven
/// against a real selection instead: `rd_universe_selection_read_oracle_v1` reads one whose second
/// member is excluded.
#[rstest]
fn rd_reads_the_included_members_in_record_order() {
    let readback = crate::owner::instrument_master_v2_postgres::tests::selection_of(&[
        ("member-a", "AAPL.XNAS"),
        ("member-b", "MSFT.XNAS"),
    ]);
    let members = UniverseSelectionMembersForRdV1::from_readback(&readback).unwrap();
    assert_eq!(
        members
            .members()
            .iter()
            .map(|member| (member.member_key().to_vec(), member.instrument()))
            .collect::<Vec<_>>(),
        [
            (b"member-a".to_vec(), "AAPL.XNAS"),
            (b"member-b".to_vec(), "MSFT.XNAS"),
        ]
    );
}

/// An instrument identity that is not UTF-8 is refused, not read lossily as another instrument.
#[rstest]
fn rd_refuses_a_member_whose_instrument_identity_is_not_utf8() {
    let readback =
        crate::owner::instrument_master_v2_postgres::tests::selection_with_instrument_bytes(
            1,
            &[("member-a", &[0xff, 0xfe, 0x41])],
        );
    assert_eq!(
        UniverseSelectionMembersForRdV1::from_readback(&readback),
        Err(UniverseSelectionErrorV1::StoreUntrusted)
    );
}
