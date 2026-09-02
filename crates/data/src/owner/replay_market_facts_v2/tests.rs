use rstest::rstest;

use super::{
    ReplayCorporateActionTermsV2, ReplayMarketDependencyKindV2, ReplayMarketDependencyRefV2,
    ReplayMarketFactsErrorV2, ReplayPriceAdjustmentV2, ReplayReferenceFactKindV2,
    ReplayReferenceFactTimeV2, ReplayReferenceFactValueV2, ReplayTimestampBasisV2,
    UntrustedReplayMarketFactsRequestV2,
    authority::{
        ReplayMarketFactsEvidenceV2, ReplayNativeChainEvidenceV2, ReplayReferenceFactCutProposalV2,
        ReplayReferenceFactProposalV2, ReplayReferenceFactScopeProposalV2,
        ReplayVerifiedNativeDerivedRecordV2, ReplayVerifiedNativeRecordV2,
        issue_replay_market_facts_v2, pit_clock_digest,
    },
    codec::{MAX_AGGREGATE_BYTES, MAX_CUT_BYTES, MAX_FACTS_PER_CUT, MAX_FIELD_BYTES},
    composition::{
        ReplayCompositionBindingErrorV1, ReplayCompositionBindingEvidenceV1,
        ReplayCompositionNativeLocatorKindV1, ReplayCompositionNativeLocatorV1,
        ReplayCompositionRoleEvidenceV1, compose_replay_market_facts_v2,
        decode_replay_composition_binding_v1, issue_replay_composition_binding_v1,
        verify_replay_composition_binding_v1,
    },
    verify_replay_market_facts_readback_v2,
};
use crate::owner::{
    pit_snapshot::{
        UntrustedCorrectionPublicationTime, UntrustedEventEffectiveTime,
        UntrustedPitSnapshotLocator, UntrustedPitSnapshotLocatorFields,
        UntrustedPitSnapshotTimeEvidence, UntrustedProviderAvailableTime, UntrustedRetrievalTime,
        UntrustedSnapshotDecisionCut,
    },
    source_binding::{BindingDigest, UntrustedCompleteFrontier},
};

fn d(value: u8) -> BindingDigest {
    BindingDigest::from_untrusted_bytes([value; 32])
}

fn time() -> ReplayReferenceFactTimeV2 {
    ReplayReferenceFactTimeV2 {
        effective_from_ns: 10,
        effective_until_ns: Some(100),
        provider_available_ns: 20,
        retrieval_ns: 30,
        correction_publication_ns: 40,
        owner_observation_ns: 50,
        decision_cut: 50,
    }
}

fn fact(value: ReplayReferenceFactValueV2, byte: u8) -> ReplayReferenceFactProposalV2 {
    ReplayReferenceFactProposalV2 {
        value,
        time: time(),
        source_identity: d(64),
        correction_identity: d(byte + 1),
    }
}

fn cut(
    seed: u8,
    kind: ReplayReferenceFactKindV2,
    facts: Vec<ReplayReferenceFactProposalV2>,
) -> ReplayReferenceFactCutProposalV2 {
    let (authority_kind, authority_identity) = match kind {
        ReplayReferenceFactKindV2::Calendar
        | ReplayReferenceFactKindV2::Session
        | ReplayReferenceFactKindV2::TimeZone
        | ReplayReferenceFactKindV2::CorporateAction => (
            ReplayMarketDependencyKindV2::InstrumentMasterCutV1,
            d(seed + 2),
        ),
        ReplayReferenceFactKindV2::MarketSemantics
        | ReplayReferenceFactKindV2::CorrectionPolicy => {
            (ReplayMarketDependencyKindV2::SourceBindingV1, d(64))
        }
        ReplayReferenceFactKindV2::HistoricalMembership => (
            ReplayMarketDependencyKindV2::UniverseSelectionV1,
            d(seed + 3),
        ),
    };
    ReplayReferenceFactCutProposalV2 {
        kind,
        scope: ReplayReferenceFactScopeProposalV2 {
            pit_snapshot_identity: d(seed + 70),
            pit_decision_cut: 50,
            pit_observed_at: 50,
            pit_valid_through: 60,
            pit_clock_digest: pit_clock_digest(b"clock", b"epoch").expect("bounded PIT clock"),
            replay_start_event_ns: 10,
            replay_end_event_ns_exclusive: 100,
            authority_kind,
            authority_identity,
        },
        facts,
    }
}

fn cuts(seed: u8, with_action: bool) -> Vec<ReplayReferenceFactCutProposalV2> {
    let action = with_action.then(|| {
        fact(
            ReplayReferenceFactValueV2::CorporateAction {
                action_identity: d(30),
                instrument: b"AAPL.XNAS".to_vec(),
                terms: ReplayCorporateActionTermsV2::Split {
                    numerator: 4,
                    denominator: 1,
                },
            },
            31,
        )
    });
    vec![
        cut(
            seed,
            ReplayReferenceFactKindV2::Calendar,
            vec![fact(
                ReplayReferenceFactValueV2::Calendar {
                    calendar_identity: b"XNAS".to_vec(),
                    trading_day: 20_000,
                    is_open: true,
                },
                2,
            )],
        ),
        cut(
            seed,
            ReplayReferenceFactKindV2::Session,
            vec![fact(
                ReplayReferenceFactValueV2::Session {
                    session_identity: b"XNAS.REGULAR".to_vec(),
                    calendar_identity: b"XNAS".to_vec(),
                    opens_at_ns: 10,
                    closes_at_ns: 90,
                },
                4,
            )],
        ),
        cut(
            seed,
            ReplayReferenceFactKindV2::TimeZone,
            vec![fact(
                ReplayReferenceFactValueV2::TimeZone {
                    time_zone_identity: b"America/New_York".to_vec(),
                    ruleset_identity: d(6),
                    offset_seconds: -14_400,
                },
                7,
            )],
        ),
        cut(
            seed,
            ReplayReferenceFactKindV2::MarketSemantics,
            vec![fact(
                ReplayReferenceFactValueV2::MarketSemantics {
                    normalization_identity: d(9),
                    price_adjustment: ReplayPriceAdjustmentV2::SplitAdjusted,
                    timestamp_basis: ReplayTimestampBasisV2::IntervalClose,
                    price_unit_identity: d(10),
                    size_unit_identity: d(11),
                },
                12,
            )],
        ),
        cut(
            seed,
            ReplayReferenceFactKindV2::CorrectionPolicy,
            vec![fact(
                ReplayReferenceFactValueV2::CorrectionPolicy {
                    stream_identity: b"databento.corrections".to_vec(),
                    sequence: 3,
                    successor_only: true,
                },
                14,
            )],
        ),
        cut(
            seed,
            ReplayReferenceFactKindV2::CorporateAction,
            action.into_iter().collect(),
        ),
        cut(
            seed,
            ReplayReferenceFactKindV2::HistoricalMembership,
            vec![fact(
                ReplayReferenceFactValueV2::HistoricalMembership {
                    selection_identity: d(seed + 3),
                    member_key: b"AAPL".to_vec(),
                    instrument: b"AAPL.XNAS".to_vec(),
                    included: true,
                },
                21,
            )],
        ),
    ]
}

fn dependencies(seed: u8) -> Vec<ReplayMarketDependencyRefV2> {
    [
        ReplayMarketDependencyKindV2::PitSnapshotV1,
        ReplayMarketDependencyKindV2::SourceBindingV1,
        ReplayMarketDependencyKindV2::InstrumentMasterCutV1,
        ReplayMarketDependencyKindV2::UniverseSelectionV1,
    ]
    .into_iter()
    .enumerate()
    .map(|(index, kind)| {
        let byte = seed + u8::try_from(index).expect("small dependency index");
        let (identity, digest) = match kind {
            ReplayMarketDependencyKindV2::PitSnapshotV1 => (d(seed + 70), d(63)),
            ReplayMarketDependencyKindV2::SourceBindingV1 => (d(64), d(byte + 20)),
            _ => (d(byte), d(byte + 20)),
        };
        ReplayMarketDependencyRefV2::from_verified_owner_record(kind, identity, digest)
    })
    .collect()
}

fn native_chain(seed: u8) -> ReplayNativeChainEvidenceV2 {
    let observation =
        ReplayVerifiedNativeRecordV2::from_verified_native_record(d(seed + 4), d(seed + 24));
    let joined =
        ReplayVerifiedNativeRecordV2::from_verified_native_record(d(seed + 5), d(seed + 25));
    let sample =
        ReplayVerifiedNativeRecordV2::from_verified_native_record(d(seed + 6), d(seed + 26));
    ReplayNativeChainEvidenceV2::from_verified_native_records(
        observation,
        ReplayVerifiedNativeDerivedRecordV2::from_verified_native_record(joined, observation),
        ReplayVerifiedNativeDerivedRecordV2::from_verified_native_record(sample, joined),
    )
}

fn request(snapshot_byte: u8) -> UntrustedReplayMarketFactsRequestV2 {
    let frontier = UntrustedCompleteFrontier {
        stream_identity: "stream".into(),
        cut_identity: "cut".into(),
        sequence: 1,
        digest: d(55),
    };
    let time_evidence = UntrustedPitSnapshotTimeEvidence {
        event_effective: UntrustedEventEffectiveTime::from_untrusted(10, "clock", "epoch"),
        provider_available: UntrustedProviderAvailableTime::from_untrusted(20, "clock", "epoch"),
        retrieval: UntrustedRetrievalTime::from_untrusted(30, "clock", "epoch"),
        correction_publication: Some(UntrustedCorrectionPublicationTime::from_untrusted(
            40, "clock", "epoch",
        )),
        decision_cut: UntrustedSnapshotDecisionCut::from_untrusted(50, "clock", "epoch"),
        monotonic_sequence: 1,
        restart_continuity_digest: d(56),
        skew_bound: 1,
        uncertainty_bound: 0,
        observed_at: 50,
        valid_through: 60,
    };
    let locator = UntrustedPitSnapshotLocator::from_untrusted(UntrustedPitSnapshotLocatorFields {
        owner: "market_data".into(),
        request_identity: d(57),
        request_digest: d(58),
        correlation_identity: d(59),
        requester_identity: d(60),
        scope_digest: d(61),
        snapshot_identity: d(snapshot_byte),
        fact_digest: d(63),
        source_binding_identity: d(64),
        source_binding_lineage_root: d(65),
        source_binding_lineage_version: 1,
        lineage_root: d(66),
        lineage_version: 1,
        predecessor_snapshot_identity: None,
        predecessor_fact_digest: None,
        source_frontier: frontier.clone(),
        correction_frontier: frontier,
        time_evidence,
    });
    UntrustedReplayMarketFactsRequestV2::new(locator, 10, 100)
}

fn readback(seed: u8, with_action: bool) -> super::ReplayMarketFactsReadbackV2 {
    issue_replay_market_facts_v2(
        &request(seed + 70),
        ReplayMarketFactsEvidenceV2 {
            base_dependencies: dependencies(seed),
            native_chain: native_chain(seed),
            reference_cuts: cuts(seed, with_action),
            stable_correlation: d(seed + 40),
        },
    )
    .expect("canonical replay facts")
}

fn composition_evidence(seed: u8) -> ReplayCompositionBindingEvidenceV1 {
    let roles = vec![
        ReplayCompositionRoleEvidenceV1 {
            role_identity: d(101),
            declaration_identity: d(103),
            declaration_digest: d(105),
            binding_identity: d(107),
            binding_digest: d(109),
        },
        ReplayCompositionRoleEvidenceV1 {
            role_identity: d(102),
            declaration_identity: d(104),
            declaration_digest: d(106),
            binding_identity: d(108),
            binding_digest: d(110),
        },
    ];
    let role_ids = roles.iter().map(|role| role.role_identity).collect();
    let role_bindings: Vec<_> = roles
        .iter()
        .map(|role| (role.role_identity, role.binding_digest))
        .collect();
    ReplayCompositionBindingEvidenceV1 {
        authenticated_strategy_design_identity: d(90),
        authenticated_strategy_design_digest: d(91),
        registry_identity: d(92),
        registry_digest: d(93),
        native_locators: vec![
            ReplayCompositionNativeLocatorV1 {
                kind: ReplayCompositionNativeLocatorKindV1::MarketSemantics,
                identity: d(94),
                digest: d(95),
            },
            ReplayCompositionNativeLocatorV1 {
                kind: ReplayCompositionNativeLocatorKindV1::UniverseSelection,
                identity: d(seed + 3),
                digest: d(seed + 23),
            },
            ReplayCompositionNativeLocatorV1 {
                kind: ReplayCompositionNativeLocatorKindV1::PitSnapshot,
                identity: d(seed + 70),
                digest: d(63),
            },
            ReplayCompositionNativeLocatorV1 {
                kind: ReplayCompositionNativeLocatorKindV1::InstrumentMaster,
                identity: d(seed + 2),
                digest: d(seed + 22),
            },
            ReplayCompositionNativeLocatorV1 {
                kind: ReplayCompositionNativeLocatorKindV1::SourceBinding,
                identity: d(64),
                digest: d(seed + 21),
            },
        ],
        roles,
        census_identity: d(seed + 4),
        census_digest: d(seed + 24),
        census_roles: role_ids,
        joined_cut_identity: d(seed + 5),
        joined_cut_digest: d(seed + 25),
        joined_cut_roles: role_bindings.clone(),
        sample_projection_identity: d(seed + 6),
        sample_projection_digest: d(seed + 26),
        sample_projection_roles: role_bindings,
        stable_correlation: d(96),
    }
}

#[test]
fn sealed_binding_composes_exact_existing_v2_path() {
    let replay = request(71);
    let binding = issue_replay_composition_binding_v1(&replay, composition_evidence(1))
        .expect("complete binding");
    assert!(verify_replay_composition_binding_v1(&binding));
    assert_eq!(binding.record().role_count(), 2);
    assert_eq!(binding.outbox().identity(), binding.receipt().identity());
    assert_eq!(
        binding.outbox().payload(),
        binding.receipt().canonical_bytes()
    );

    let composed = super::UntrustedReplayMarketFactsCompositionRequestV1::new(
        replay,
        binding.record().locator(),
    );
    let readback = compose_replay_market_facts_v2(
        &composed,
        &binding,
        ReplayMarketFactsEvidenceV2 {
            base_dependencies: dependencies(1),
            native_chain: native_chain(1),
            reference_cuts: cuts(1, true),
            stable_correlation: d(41),
        },
    )
    .expect("exact positive composition");
    assert!(verify_replay_market_facts_readback_v2(&readback));
    assert_eq!(readback.facts().frontier().dependencies().len(), 7);
}

#[test]
fn binding_exact_bytes_round_trip_and_mutation_or_reordering_fail_closed() {
    let replay = request(71);
    let binding = issue_replay_composition_binding_v1(&replay, composition_evidence(1))
        .expect("complete binding");
    let recovered = decode_replay_composition_binding_v1(
        binding.record().canonical_bytes(),
        binding.receipt().canonical_bytes(),
        binding.outbox().payload(),
    )
    .expect("exact recovery");
    assert_eq!(recovered, binding);

    let mut mutated = binding.record().canonical_bytes().to_vec();
    mutated[20] ^= 1;
    assert!(
        decode_replay_composition_binding_v1(
            &mutated,
            binding.receipt().canonical_bytes(),
            binding.outbox().payload(),
        )
        .is_err()
    );
    let mut reordered = binding.record().canonical_bytes().to_vec();
    let first_native_kind = 2 + 3 * 32 + 2 * 16 + 4 * 32 + 4;
    reordered[first_native_kind..first_native_kind + 2].copy_from_slice(&2_u16.to_be_bytes());
    assert!(
        decode_replay_composition_binding_v1(
            &reordered,
            binding.receipt().canonical_bytes(),
            binding.outbox().payload(),
        )
        .is_err()
    );
    let mut forged_receipt = binding.receipt().canonical_bytes().to_vec();
    forged_receipt[50] ^= 1;
    assert!(
        decode_replay_composition_binding_v1(
            binding.record().canonical_bytes(),
            &forged_receipt,
            &forged_receipt,
        )
        .is_err()
    );
}

#[test]
fn composition_fails_closed_on_incomplete_roles_and_exact_locator_mismatch() {
    let replay = request(71);
    let mut incomplete = composition_evidence(1);
    incomplete.sample_projection_roles.pop();
    assert_eq!(
        issue_replay_composition_binding_v1(&replay, incomplete),
        Err(ReplayCompositionBindingErrorV1::IncompleteComposition)
    );

    let binding = issue_replay_composition_binding_v1(&replay, composition_evidence(1))
        .expect("complete binding");
    let forged = super::UntrustedReplayMarketFactsCompositionRequestV1::new(
        replay,
        super::ReplayCompositionBindingLocatorV1::from_untrusted(d(120), d(120)),
    );
    assert_eq!(
        compose_replay_market_facts_v2(
            &forged,
            &binding,
            ReplayMarketFactsEvidenceV2 {
                base_dependencies: dependencies(1),
                native_chain: native_chain(1),
                reference_cuts: cuts(1, true),
                stable_correlation: d(41),
            },
        ),
        Err(ReplayCompositionBindingErrorV1::UnknownBinding)
    );
}

#[test]
fn binding_identity_changes_with_authenticated_design_and_joined_cut() {
    let replay = request(71);
    let first = issue_replay_composition_binding_v1(&replay, composition_evidence(1))
        .expect("first binding");
    let mut design_changed = composition_evidence(1);
    design_changed.authenticated_strategy_design_identity = d(97);
    let second =
        issue_replay_composition_binding_v1(&replay, design_changed).expect("second binding");
    assert_ne!(first.record().identity(), second.record().identity());

    let mut cross_spliced = composition_evidence(1);
    cross_spliced.joined_cut_identity = d(98);
    let binding = issue_replay_composition_binding_v1(&replay, cross_spliced)
        .expect("self-consistent sealed binding");
    let composed = super::UntrustedReplayMarketFactsCompositionRequestV1::new(
        replay,
        binding.record().locator(),
    );
    assert_eq!(
        compose_replay_market_facts_v2(
            &composed,
            &binding,
            ReplayMarketFactsEvidenceV2 {
                base_dependencies: dependencies(1),
                native_chain: native_chain(1),
                reference_cuts: cuts(1, true),
                stable_correlation: d(41),
            },
        ),
        Err(ReplayCompositionBindingErrorV1::DependencyMismatch)
    );
}

#[rstest]
fn canonical_facts_bind_actual_reference_meaning_and_all_dependencies() {
    let readback = readback(1, true);
    assert!(verify_replay_market_facts_readback_v2(&readback));
    assert_eq!(readback.facts().reference_cuts().len(), 7);
    assert_eq!(readback.facts().frontier().dependencies().len(), 7);
    let action = readback
        .facts()
        .reference_cuts()
        .iter()
        .find(|cut| cut.kind() == ReplayReferenceFactKindV2::CorporateAction)
        .expect("action cut");
    assert!(matches!(
        action.facts()[0].value(),
        ReplayReferenceFactValueV2::CorporateAction {
            terms: ReplayCorporateActionTermsV2::Split {
                numerator: 4,
                denominator: 1
            },
            ..
        }
    ));
}

#[rstest]
fn explicit_complete_zero_action_cut_is_content_addressed() {
    let first = readback(1, false);
    let repeated = readback(1, false);
    let empty = first
        .facts()
        .reference_cuts()
        .iter()
        .find(|cut| cut.kind() == ReplayReferenceFactKindV2::CorporateAction)
        .expect("action cut");
    assert!(empty.is_explicit_complete_empty());
    assert_eq!(first.facts().identity(), repeated.facts().identity());
    assert_ne!(
        first.facts().identity(),
        readback(1, true).facts().identity()
    );
}

#[rstest]
fn canonical_byte_tamper_never_verifies() {
    let mut readback = readback(1, true);
    readback.facts.canonical_bytes[3] ^= 1;
    assert!(!verify_replay_market_facts_readback_v2(&readback));
}

#[rstest]
fn scalar_only_and_cross_splice_tamper_never_verify() {
    let mut first = readback(1, true);
    let second = readback(2, true);
    first.reference_fact_mut().time.decision_cut += 1;
    assert!(!verify_replay_market_facts_readback_v2(&first));

    let mut first = readback(1, true);
    first.receipt.facts_identity = second.facts().identity();
    assert!(!verify_replay_market_facts_readback_v2(&first));

    let mut first = readback(1, true);
    first.receipt = second.receipt;
    assert!(!verify_replay_market_facts_readback_v2(&first));
}

impl super::ReplayMarketFactsReadbackV2 {
    fn reference_fact_mut(&mut self) -> &mut super::ReplayReferenceFactV2 {
        &mut self.facts.reference_cuts[0].facts[0]
    }
}

#[rstest]
fn missing_dependency_or_reference_cut_fails_closed() {
    let mut missing_dependency = dependencies(1);
    missing_dependency.pop();
    assert!(
        issue_replay_market_facts_v2(
            &request(71),
            ReplayMarketFactsEvidenceV2 {
                base_dependencies: missing_dependency,
                native_chain: native_chain(1),
                reference_cuts: cuts(1, true),
                stable_correlation: d(41),
            },
        )
        .is_err()
    );

    let mut missing_cut = cuts(1, true);
    missing_cut.pop();
    assert!(
        issue_replay_market_facts_v2(
            &request(71),
            ReplayMarketFactsEvidenceV2 {
                base_dependencies: dependencies(1),
                native_chain: native_chain(1),
                reference_cuts: missing_cut,
                stable_correlation: d(41),
            },
        )
        .is_err()
    );
}

fn issue(seed: u8, reference_cuts: Vec<ReplayReferenceFactCutProposalV2>) -> bool {
    issue_replay_market_facts_v2(
        &request(seed + 70),
        ReplayMarketFactsEvidenceV2 {
            base_dependencies: dependencies(seed),
            native_chain: native_chain(seed),
            reference_cuts,
            stable_correlation: d(seed + 40),
        },
    )
    .is_ok()
}

#[rstest]
fn unrelated_universe_scope_or_membership_selection_fails_closed() {
    let mut wrong_scope = cuts(1, true);
    let membership = wrong_scope
        .iter_mut()
        .find(|cut| cut.kind == ReplayReferenceFactKindV2::HistoricalMembership)
        .expect("membership cut");
    membership.scope.authority_identity = d(99);
    assert!(!issue(1, wrong_scope));

    let mut wrong_selection = cuts(1, true);
    let membership = wrong_selection
        .iter_mut()
        .find(|cut| cut.kind == ReplayReferenceFactKindV2::HistoricalMembership)
        .expect("membership cut");
    let ReplayReferenceFactValueV2::HistoricalMembership {
        selection_identity, ..
    } = &mut membership.facts[0].value
    else {
        panic!("membership value")
    };
    *selection_identity = d(99);
    assert!(!issue(1, wrong_selection));
}

#[rstest]
fn empty_cut_with_wrong_pit_decision_or_window_fails_closed() {
    let mut wrong_decision = cuts(1, false);
    let action = wrong_decision
        .iter_mut()
        .find(|cut| cut.kind == ReplayReferenceFactKindV2::CorporateAction)
        .expect("empty action cut");
    action.scope.pit_decision_cut += 1;
    assert!(!issue(1, wrong_decision));

    let mut wrong_window = cuts(1, false);
    let action = wrong_window
        .iter_mut()
        .find(|cut| cut.kind == ReplayReferenceFactKindV2::CorporateAction)
        .expect("empty action cut");
    action.scope.replay_end_event_ns_exclusive += 1;
    assert!(!issue(1, wrong_window));

    let mut wrong_valid_through = cuts(1, false);
    let action = wrong_valid_through
        .iter_mut()
        .find(|cut| cut.kind == ReplayReferenceFactKindV2::CorporateAction)
        .expect("empty action cut");
    action.scope.pit_valid_through += 1;
    assert!(!issue(1, wrong_valid_through));

    let mut readback = readback(1, false);
    readback.facts.pit_valid_through += 1;
    assert!(!verify_replay_market_facts_readback_v2(&readback));
}

#[rstest]
fn conflicting_logical_fact_key_fails_closed() {
    let mut conflicting = cuts(1, true);
    let calendar = conflicting
        .iter_mut()
        .find(|cut| cut.kind == ReplayReferenceFactKindV2::Calendar)
        .expect("calendar cut");
    let mut opposite = calendar.facts[0].clone();
    let ReplayReferenceFactValueV2::Calendar { is_open, .. } = &mut opposite.value else {
        panic!("calendar value")
    };
    *is_open = !*is_open;
    opposite.correction_identity = d(98);
    calendar.facts.push(opposite);
    assert!(!issue(1, conflicting));
}

#[rstest]
fn kind_specific_interval_outside_replay_window_fails_closed() {
    let mut invalid_session = cuts(1, true);
    let session = invalid_session
        .iter_mut()
        .find(|cut| cut.kind == ReplayReferenceFactKindV2::Session)
        .expect("session cut");
    let ReplayReferenceFactValueV2::Session { opens_at_ns, .. } = &mut session.facts[0].value
    else {
        panic!("session value")
    };
    *opens_at_ns = 9;
    assert!(!issue(1, invalid_session));

    let mut disjoint_calendar = cuts(1, true);
    let calendar = disjoint_calendar
        .iter_mut()
        .find(|cut| cut.kind == ReplayReferenceFactKindV2::Calendar)
        .expect("calendar cut");
    calendar.facts[0].time.effective_from_ns = 100;
    calendar.facts[0].time.effective_until_ns = Some(110);
    assert!(!issue(1, disjoint_calendar));
}

#[rstest]
fn oversized_count_field_and_aggregate_fail_before_positive_readback() {
    let mut excessive_count = cuts(1, true);
    let calendar = excessive_count
        .iter_mut()
        .find(|cut| cut.kind == ReplayReferenceFactKindV2::Calendar)
        .expect("calendar cut");
    calendar.facts = vec![calendar.facts[0].clone(); MAX_FACTS_PER_CUT + 1];
    assert!(!issue(1, excessive_count));

    let mut excessive_field = cuts(1, true);
    let calendar = excessive_field
        .iter_mut()
        .find(|cut| cut.kind == ReplayReferenceFactKindV2::Calendar)
        .expect("calendar cut");
    let ReplayReferenceFactValueV2::Calendar {
        calendar_identity, ..
    } = &mut calendar.facts[0].value
    else {
        panic!("calendar value")
    };
    *calendar_identity = vec![b'x'; MAX_FIELD_BYTES + 1];
    assert!(!issue(1, excessive_field));

    let mut aggregate = readback(1, true);
    aggregate.facts.canonical_bytes = vec![0; MAX_AGGREGATE_BYTES + 1].into_boxed_slice();
    assert!(!verify_replay_market_facts_readback_v2(&aggregate));
}

#[rstest]
fn verifier_replays_scope_and_membership_semantics() {
    let mut wrong_decision = readback(1, false);
    let action = wrong_decision
        .facts
        .reference_cuts
        .iter_mut()
        .find(|cut| cut.kind == ReplayReferenceFactKindV2::CorporateAction)
        .expect("empty action cut");
    action.scope.pit_decision_cut += 1;
    assert!(!verify_replay_market_facts_readback_v2(&wrong_decision));

    let mut wrong_selection = readback(1, true);
    let membership = wrong_selection
        .facts
        .reference_cuts
        .iter_mut()
        .find(|cut| cut.kind == ReplayReferenceFactKindV2::HistoricalMembership)
        .expect("membership cut");
    let ReplayReferenceFactValueV2::HistoricalMembership {
        selection_identity, ..
    } = &mut membership.facts[0].value
    else {
        panic!("membership value")
    };
    *selection_identity = d(99);
    assert!(!verify_replay_market_facts_readback_v2(&wrong_selection));
}

#[rstest]
fn native_subject_chain_cross_splices_fail_at_issuer_and_verifier() {
    let mut wrong_joined_subject = native_chain(1);
    wrong_joined_subject.joined_cut_observation_subject = d(99);
    assert!(
        issue_replay_market_facts_v2(
            &request(71),
            ReplayMarketFactsEvidenceV2 {
                base_dependencies: dependencies(1),
                native_chain: wrong_joined_subject,
                reference_cuts: cuts(1, true),
                stable_correlation: d(41),
            },
        )
        .is_err()
    );

    let mut wrong_sample_subject = native_chain(1);
    wrong_sample_subject.sample_projection_joined_cut_subject = d(99);
    assert!(
        issue_replay_market_facts_v2(
            &request(71),
            ReplayMarketFactsEvidenceV2 {
                base_dependencies: dependencies(1),
                native_chain: wrong_sample_subject,
                reference_cuts: cuts(1, true),
                stable_correlation: d(41),
            },
        )
        .is_err()
    );

    let mut verifier_joined = readback(1, true);
    verifier_joined
        .facts
        .frontier
        .native_chain
        .joined_cut_observation_subject = d(99);
    assert!(!verify_replay_market_facts_readback_v2(&verifier_joined));

    let mut verifier_sample = readback(1, true);
    verifier_sample
        .facts
        .frontier
        .native_chain
        .sample_projection_joined_cut_subject = d(99);
    assert!(!verify_replay_market_facts_readback_v2(&verifier_sample));
}

#[rstest]
fn overlapping_logical_history_fails_at_issuer_and_verifier() {
    let mut overlapping = cuts(1, true);
    let time_zone = overlapping
        .iter_mut()
        .find(|cut| cut.kind == ReplayReferenceFactKindV2::TimeZone)
        .expect("time-zone cut");
    time_zone.facts[0].time.effective_until_ns = Some(70);
    let mut successor = time_zone.facts[0].clone();
    successor.time.effective_from_ns = 60;
    successor.time.effective_until_ns = Some(100);
    successor.correction_identity = d(99);
    time_zone.facts.push(successor);
    assert!(!issue(1, overlapping));

    let mut adjacent = cuts(1, true);
    let time_zone = adjacent
        .iter_mut()
        .find(|cut| cut.kind == ReplayReferenceFactKindV2::TimeZone)
        .expect("time-zone cut");
    time_zone.facts[0].time.effective_until_ns = Some(60);
    let mut successor = time_zone.facts[0].clone();
    successor.time.effective_from_ns = 60;
    successor.time.effective_until_ns = Some(100);
    successor.correction_identity = d(99);
    time_zone.facts.push(successor);
    let mut readback = issue_replay_market_facts_v2(
        &request(71),
        ReplayMarketFactsEvidenceV2 {
            base_dependencies: dependencies(1),
            native_chain: native_chain(1),
            reference_cuts: adjacent,
            stable_correlation: d(41),
        },
    )
    .expect("adjacent successor history");
    let time_zone = readback
        .facts
        .reference_cuts
        .iter_mut()
        .find(|cut| cut.kind == ReplayReferenceFactKindV2::TimeZone)
        .expect("time-zone cut");
    time_zone
        .facts
        .iter_mut()
        .find(|fact| fact.time.effective_from_ns == 60)
        .expect("successor fact")
        .time
        .effective_from_ns = 59;
    assert!(!verify_replay_market_facts_readback_v2(&readback));
}

#[rstest]
fn reused_non_adjacent_correction_identity_fails_at_issuer_and_verifier() {
    let mut reused = cuts(1, true);
    let time_zone = reused
        .iter_mut()
        .find(|cut| cut.kind == ReplayReferenceFactKindV2::TimeZone)
        .expect("time-zone cut");
    time_zone.facts[0].time.effective_until_ns = Some(40);
    let reused_identity = time_zone.facts[0].correction_identity;
    let mut middle = time_zone.facts[0].clone();
    middle.time.effective_from_ns = 40;
    middle.time.effective_until_ns = Some(70);
    middle.correction_identity = d(98);
    let mut last = middle.clone();
    last.time.effective_from_ns = 70;
    last.time.effective_until_ns = Some(100);
    last.correction_identity = reused_identity;
    time_zone.facts.extend([middle, last]);
    assert!(!issue(1, reused));

    let mut valid = cuts(1, true);
    let time_zone = valid
        .iter_mut()
        .find(|cut| cut.kind == ReplayReferenceFactKindV2::TimeZone)
        .expect("time-zone cut");
    time_zone.facts[0].time.effective_until_ns = Some(40);
    let reused_identity = time_zone.facts[0].correction_identity;
    let mut middle = time_zone.facts[0].clone();
    middle.time.effective_from_ns = 40;
    middle.time.effective_until_ns = Some(70);
    middle.correction_identity = d(98);
    let mut last = middle.clone();
    last.time.effective_from_ns = 70;
    last.time.effective_until_ns = Some(100);
    last.correction_identity = d(99);
    time_zone.facts.extend([middle, last]);
    let mut readback = issue_replay_market_facts_v2(
        &request(71),
        ReplayMarketFactsEvidenceV2 {
            base_dependencies: dependencies(1),
            native_chain: native_chain(1),
            reference_cuts: valid,
            stable_correlation: d(41),
        },
    )
    .expect("three contiguous facts with unique correction identities");
    let time_zone = readback
        .facts
        .reference_cuts
        .iter_mut()
        .find(|cut| cut.kind == ReplayReferenceFactKindV2::TimeZone)
        .expect("time-zone cut");
    time_zone
        .facts
        .iter_mut()
        .find(|fact| fact.time.effective_from_ns == 70)
        .expect("last fact")
        .correction_identity = reused_identity;
    assert!(!verify_replay_market_facts_readback_v2(&readback));
}

#[rstest]
fn post_pit_observation_fails_at_issuer_and_verifier() {
    let mut post_pit = cuts(1, true);
    post_pit[0].facts[0].time.owner_observation_ns = 51;
    assert!(!issue(1, post_pit));

    let mut readback = readback(1, true);
    readback.reference_fact_mut().time.retrieval_ns = 51;
    assert!(!verify_replay_market_facts_readback_v2(&readback));
}

#[rstest]
fn incomparable_pit_clock_epoch_fails_at_issuer_and_verifier() {
    let mut incomparable = request(71);
    incomparable.pit_locator.time_evidence.retrieval.clock_epoch = "other-epoch".into();
    assert!(
        issue_replay_market_facts_v2(
            &incomparable,
            ReplayMarketFactsEvidenceV2 {
                base_dependencies: dependencies(1),
                native_chain: native_chain(1),
                reference_cuts: cuts(1, true),
                stable_correlation: d(41),
            },
        )
        .is_err()
    );

    let mut readback = readback(1, true);
    readback.facts.pit_clock_epoch = b"other-epoch".to_vec().into_boxed_slice();
    assert!(!verify_replay_market_facts_readback_v2(&readback));
}

#[rstest]
fn cumulative_cut_preflight_rejects_before_child_canonical_materialization() {
    let mut excessive = cuts(1, true);
    let calendar = excessive
        .iter_mut()
        .find(|cut| cut.kind == ReplayReferenceFactKindV2::Calendar)
        .expect("calendar cut");
    let fact_count = MAX_CUT_BYTES / MAX_FIELD_BYTES + 1;
    calendar.facts = (0..fact_count)
        .map(|index| {
            let mut proposal = calendar.facts[0].clone();
            let ReplayReferenceFactValueV2::Calendar {
                calendar_identity,
                trading_day,
                ..
            } = &mut proposal.value
            else {
                panic!("calendar value")
            };
            *calendar_identity = vec![b'x'; MAX_FIELD_BYTES];
            *trading_day = i32::try_from(index).expect("bounded fact index");
            proposal
        })
        .collect();
    let result = issue_replay_market_facts_v2(
        &request(71),
        ReplayMarketFactsEvidenceV2 {
            base_dependencies: dependencies(1),
            native_chain: native_chain(1),
            reference_cuts: excessive,
            stable_correlation: d(41),
        },
    );
    assert_eq!(result, Err(ReplayMarketFactsErrorV2::CapacityExceeded));
}
