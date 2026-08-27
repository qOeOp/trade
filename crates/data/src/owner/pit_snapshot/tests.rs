use std::collections::BTreeSet;

use rstest::rstest;

use super::{
    BindingDigest, PitSnapshotBlocker, PitSnapshotCommitAggregate, PitSnapshotDisposition,
    PitSnapshotError, UntrustedCorrectionPublicationTime, UntrustedEventEffectiveTime,
    UntrustedPitObservation, UntrustedPitObservationBatchProposal, UntrustedPitSnapshotEvidence,
    UntrustedPitSnapshotLocator, UntrustedPitSnapshotProposal, UntrustedPitSnapshotRequest,
    UntrustedPitSnapshotTimeEvidence, UntrustedProviderAvailableTime, UntrustedRetrievalTime,
    UntrustedSnapshotDecisionCut, VerifiedPitObservation,
    authority::{
        CommitFault, ObservedPitObservationNativeRow, TestOnlyCanonicalBasisResolver,
        TestOnlyPitSnapshotOwner, canonical_batch_bytes, canonical_observation_bytes,
        decode_canonical_observation_batch, derive_request_digest, derive_request_identity,
        prepare_observation_batch, refresh_request_claims, verify_observation_batch,
    },
};
use crate::owner::research_pit_terminal::{
    ResearchPitBlocker, ResearchPitDisposition, UntrustedResearchPitTerminalRequest,
    derive_license_binding_digest, derive_provenance_binding_digest,
    derive_snapshot_correction_rule_digest, seal_research_pit_terminal,
};
use crate::owner::source_binding::{
    MarketDataClockAdmission, SourceBindingBlocker, UntrustedAdapterBinding,
    UntrustedCompleteFrontier, UntrustedCredentialAudienceClaim,
    UntrustedCredentialCapabilityClaim, UntrustedLicensePolicy, UntrustedMarketDataAsOf,
    UntrustedMarketSemantics, UntrustedOpaqueCredentialHandle, UntrustedSourceBindingLocator,
    UntrustedSourceBindingProposal, UntrustedTrustPolicy,
    authority::{
        OwnerLineage, OwnerSourceBindingDecision, SourceBindingCommit,
        TestOnlyInMemorySourceBindingOwner, build_stored_aggregate, derive_binding_id,
        derive_time_evidence_identity,
    },
};

fn d(byte: u8) -> BindingDigest {
    BindingDigest::from_untrusted_bytes([byte; 32])
}

fn source_clock(cut: u64, sequence: u64) -> MarketDataClockAdmission {
    MarketDataClockAdmission::seal_for_test(
        "market-clock",
        "epoch-1",
        sequence,
        cut,
        cut,
        cut + 60,
        d(7),
        1,
        2,
    )
}

fn source_read_clock(cut: u64, now: u64, sequence: u64) -> MarketDataClockAdmission {
    MarketDataClockAdmission::seal_for_test(
        "market-clock",
        "epoch-1",
        sequence,
        now,
        cut,
        cut + 60,
        d(7),
        1,
        2,
    )
}

fn pit_read_clock(cut: u64, now: u64, sequence: u64) -> MarketDataClockAdmission {
    source_read_clock(cut, now, sequence)
}

fn source_proposal(sequence: u64, cut: u64) -> UntrustedSourceBindingProposal {
    let is_successor = sequence > 10;
    let mut proposal = UntrustedSourceBindingProposal {
        claimed_binding_id: d(0),
        schema_version: 1,
        adapter: UntrustedAdapterBinding {
            implementation_digest: d(1),
            configuration_digest: d(2),
            authenticated_endpoint_identity: "https://market.example/v1".into(),
            dataset_mapping: "dataset/trades".into(),
            account_mapping: "tenant/entitlement".into(),
        },
        credential_handle: UntrustedOpaqueCredentialHandle::from_untrusted_identity(
            d(6),
            UntrustedCredentialAudienceClaim::MarketData,
            [
                UntrustedCredentialCapabilityClaim::MarketDataRead,
                UntrustedCredentialCapabilityClaim::ReferenceDataRead,
                UntrustedCredentialCapabilityClaim::MetadataRead,
            ],
        ),
        trust_policy: UntrustedTrustPolicy {
            identity: "trust-policy".into(),
            version: 1,
        },
        semantics: UntrustedMarketSemantics {
            normalization: "normalization-v1".into(),
            adjustment: "raw-v1".into(),
            price_meaning: "quote-currency-per-base-v1".into(),
            calendar_rules: "calendar-v1".into(),
            session_rules: "session-v1".into(),
            timezone_rules: "iana-2026a".into(),
            instrument_lifecycle_rules: "instrument-lifecycle-v1".into(),
            corporate_action_rules: "corporate-actions-v1".into(),
            membership_rules: "historical-membership-v1".into(),
            universe_rules: "requester-rule-evaluation-v1".into(),
            correction_policy: "successor-only-v1".into(),
        },
        license: UntrustedLicensePolicy {
            use_scope: "acquire-cache-archive-backtest-model-display".into(),
            redistribution_scope: "derived-only".into(),
            retention_policy: "retain-30d-delete-v1".into(),
            redaction_policy: "no-licensed-payload-v1".into(),
        },
        source_frontier: UntrustedCompleteFrontier {
            stream_identity: "source-stream".into(),
            cut_identity: if is_successor {
                "source-cut-12".into()
            } else {
                "source-cut-10".into()
            },
            sequence,
            digest: if is_successor { d(8) } else { d(3) },
        },
        correction_frontier: UntrustedCompleteFrontier {
            stream_identity: "correction-stream".into(),
            cut_identity: format!(
                "correction-cut-{}",
                if is_successor { sequence } else { sequence + 1 }
            ),
            sequence: if is_successor { sequence } else { sequence + 1 },
            digest: if is_successor { d(9) } else { d(4) },
        },
        time_evidence: UntrustedMarketDataAsOf {
            claimed_evidence_identity: d(0),
            clock_identity: "market-clock".into(),
            clock_epoch: "epoch-1".into(),
            monotonic_sequence: if is_successor { 2 } else { 1 },
            restart_continuity_digest: d(7),
            skew_bound: 2,
            uncertainty_bound: 1,
            event_effective: 10,
            provider_available: if is_successor { 45 } else { 20 },
            retrieval: if is_successor { 49 } else { 30 },
            correction_publication: if is_successor { 49 } else { 25 },
            observed_at: cut,
            effective_at: cut,
            valid_through: cut + 60,
        },
    };
    proposal.time_evidence.claimed_evidence_identity =
        derive_time_evidence_identity(&proposal.time_evidence);
    proposal.claimed_binding_id = derive_binding_id(&proposal);
    proposal
}

fn source_fixture(
    blockers: impl IntoIterator<Item = SourceBindingBlocker>,
) -> (TestOnlyInMemorySourceBindingOwner, SourceBindingCommit) {
    let owner = TestOnlyInMemorySourceBindingOwner::default();
    let commit = owner
        .commit_initial(
            source_proposal(10, 40),
            OwnerSourceBindingDecision {
                blockers: blockers.into_iter().collect(),
            },
            &source_clock(40, 1),
        )
        .expect("source binding");
    (owner, commit)
}

fn typed_time(cut: u64, sequence: u64) -> UntrustedPitSnapshotTimeEvidence {
    UntrustedPitSnapshotTimeEvidence {
        event_effective: UntrustedEventEffectiveTime::from_untrusted(10, "market-clock", "epoch-1"),
        provider_available: UntrustedProviderAvailableTime::from_untrusted(
            if cut == 40 { 20 } else { 45 },
            "market-clock",
            "epoch-1",
        ),
        retrieval: UntrustedRetrievalTime::from_untrusted(
            if cut == 40 { 30 } else { 49 },
            "market-clock",
            "epoch-1",
        ),
        correction_publication: Some(UntrustedCorrectionPublicationTime::from_untrusted(
            if cut == 40 { 25 } else { 49 },
            "market-clock",
            "epoch-1",
        )),
        decision_cut: UntrustedSnapshotDecisionCut::from_untrusted(cut, "market-clock", "epoch-1"),
        monotonic_sequence: sequence,
        restart_continuity_digest: d(7),
        skew_bound: 2,
        uncertainty_bound: 1,
        observed_at: cut,
        valid_through: cut + 60,
    }
}

fn proposal(locator: &UntrustedSourceBindingLocator) -> UntrustedPitSnapshotProposal {
    let mut request = UntrustedPitSnapshotRequest {
        claimed_request_identity: d(0),
        claimed_request_digest: d(0),
        correlation_identity: d(20),
        requester_identity: d(19),
        scope_digest: d(21),
        source_binding: locator.clone(),
        instrument_master_digest: d(22),
        universe_selection_digest: d(23),
        market_semantics_identity: d(24),
        time_evidence: typed_time(40, 1),
    };
    refresh_request_claims(&mut request);
    UntrustedPitSnapshotProposal {
        request,
        evidence: UntrustedPitSnapshotEvidence {
            normalized_records_digest: d(25),
            source_frontier: locator.source_frontier.clone(),
            correction_frontier: locator.correction_frontier.clone(),
            coverage_complete: true,
            semantics_compatible: true,
            source_available: true,
        },
    }
}

fn canonical_basis(
    value: &UntrustedPitSnapshotProposal,
    _source: &SourceBindingCommit,
) -> TestOnlyCanonicalBasisResolver {
    let time = &value.request.time_evidence;
    let clock = MarketDataClockAdmission::seal_for_test(
        time.decision_cut.clock_identity.clone(),
        time.decision_cut.clock_epoch.clone(),
        time.monotonic_sequence,
        time.observed_at,
        time.decision_cut.value,
        time.decision_cut.value + 60,
        time.restart_continuity_digest,
        time.uncertainty_bound,
        time.skew_bound,
    );
    canonical_basis_with_clock(value, &clock)
}

fn canonical_basis_with_clock(
    value: &UntrustedPitSnapshotProposal,
    clock: &MarketDataClockAdmission,
) -> TestOnlyCanonicalBasisResolver {
    TestOnlyCanonicalBasisResolver::seal_for_test(
        value.request.clone(),
        value.evidence.clone(),
        clock.clone(),
    )
}

fn assert_request_basis_rejects(
    original: &UntrustedPitSnapshotProposal,
    basis: &TestOnlyCanonicalBasisResolver,
    source_owner: &TestOnlyInMemorySourceBindingOwner,
    mutation: fn(&mut UntrustedPitSnapshotRequest),
    refresh_claims: bool,
    expected: PitSnapshotError,
) {
    let mut changed = original.clone();
    mutation(&mut changed.request);
    if refresh_claims {
        refresh_request_claims(&mut changed.request);
    }
    let cut = changed.request.time_evidence.decision_cut.value;
    let observed = changed.request.time_evidence.observed_at;
    let sequence = changed.request.time_evidence.monotonic_sequence;
    let mut owner = TestOnlyPitSnapshotOwner::default();
    assert_eq!(
        owner.commit_initial(
            changed,
            basis,
            source_owner,
            &source_read_clock(cut, observed, sequence),
        ),
        Err(expected)
    );
    assert_eq!(owner.commit_count(), 0);
    assert_eq!(owner.outbox_count(), 0);
}

type SourceLocatorMutation = fn(&mut UntrustedPitSnapshotRequest);

const SOURCE_LOCATOR_MUTATIONS: [(&str, SourceLocatorMutation); 32] = [
    ("owner", |r| r.source_binding.owner.push('x')),
    ("lineage_root", |r| r.source_binding.lineage_root = d(60)),
    ("lineage_version", |r| r.source_binding.lineage_version += 1),
    ("predecessor_binding_id", |r| {
        r.source_binding.predecessor_binding_id = Some(d(61));
    }),
    ("predecessor_fact_digest", |r| {
        r.source_binding.predecessor_fact_digest = Some(d(62));
    }),
    ("binding_id", |r| r.source_binding.binding_id = d(63)),
    ("fact_digest", |r| r.source_binding.fact_digest = d(64)),
    ("credential_handle_identity", |r| {
        r.source_binding.credential_handle_identity = d(65);
    }),
    ("credential_audience", |r| {
        r.source_binding.credential_audience = UntrustedCredentialAudienceClaim::Execution;
    }),
    ("credential_capabilities", |r| {
        r.source_binding
            .credential_capabilities
            .remove(&UntrustedCredentialCapabilityClaim::MetadataRead);
    }),
    ("source_frontier.stream_identity", |r| {
        r.source_binding.source_frontier.stream_identity.push('x');
    }),
    ("source_frontier.cut_identity", |r| {
        r.source_binding.source_frontier.cut_identity.push('x');
    }),
    ("source_frontier.sequence", |r| {
        r.source_binding.source_frontier.sequence += 1;
    }),
    ("source_frontier.digest", |r| {
        r.source_binding.source_frontier.digest = d(66);
    }),
    ("correction_frontier.stream_identity", |r| {
        r.source_binding
            .correction_frontier
            .stream_identity
            .push('x');
    }),
    ("correction_frontier.cut_identity", |r| {
        r.source_binding.correction_frontier.cut_identity.push('x');
    }),
    ("correction_frontier.sequence", |r| {
        r.source_binding.correction_frontier.sequence += 1;
    }),
    ("correction_frontier.digest", |r| {
        r.source_binding.correction_frontier.digest = d(67);
    }),
    ("time.claimed_evidence_identity", |r| {
        r.source_binding.time_evidence.claimed_evidence_identity = d(68);
    }),
    ("time.clock_identity", |r| {
        r.source_binding.time_evidence.clock_identity.push('x');
    }),
    ("time.clock_epoch", |r| {
        r.source_binding.time_evidence.clock_epoch.push('x');
    }),
    ("time.monotonic_sequence", |r| {
        r.source_binding.time_evidence.monotonic_sequence += 1;
    }),
    ("time.restart_continuity_digest", |r| {
        r.source_binding.time_evidence.restart_continuity_digest = d(69);
    }),
    ("time.skew_bound", |r| {
        r.source_binding.time_evidence.skew_bound += 1;
    }),
    ("time.uncertainty_bound", |r| {
        r.source_binding.time_evidence.uncertainty_bound += 1;
    }),
    ("time.event_effective", |r| {
        r.source_binding.time_evidence.event_effective += 1;
    }),
    ("time.provider_available", |r| {
        r.source_binding.time_evidence.provider_available += 1;
    }),
    ("time.retrieval", |r| {
        r.source_binding.time_evidence.retrieval += 1;
    }),
    ("time.correction_publication", |r| {
        r.source_binding.time_evidence.correction_publication += 1;
    }),
    ("time.observed_at", |r| {
        r.source_binding.time_evidence.observed_at += 1;
    }),
    ("time.effective_at", |r| {
        r.source_binding.time_evidence.effective_at += 1;
    }),
    ("time.valid_through_exclusive_comparison", |r| {
        r.source_binding.time_evidence.valid_through += 1;
    }),
];

fn correction_fixture() -> (
    TestOnlyInMemorySourceBindingOwner,
    SourceBindingCommit,
    TestOnlyPitSnapshotOwner,
    PitSnapshotCommitAggregate,
) {
    let source_owner = TestOnlyInMemorySourceBindingOwner::default();
    let source_initial = source_owner
        .commit_initial(
            source_proposal(10, 40),
            OwnerSourceBindingDecision {
                blockers: BTreeSet::new(),
            },
            &source_clock(40, 1),
        )
        .expect("source initial");
    let source_successor = source_owner
        .commit_successor(
            source_initial.receipt().locator(),
            source_proposal(12, 50),
            OwnerSourceBindingDecision {
                blockers: BTreeSet::new(),
            },
            &source_clock(50, 2),
        )
        .expect("source successor");
    let initial_value = proposal(source_initial.receipt().locator());
    let initial_basis = canonical_basis(&initial_value, &source_initial);
    let mut owner = TestOnlyPitSnapshotOwner::default();
    let initial = owner
        .commit_initial(
            initial_value,
            &initial_basis,
            &source_owner,
            &source_read_clock(40, 40, 1),
        )
        .expect("initial snapshot");
    (source_owner, source_successor, owner, initial)
}

#[rstest]
fn available_path_commits_one_sealed_fact_and_outbox_with_exact_readback() {
    let (source_owner, source) = source_fixture([]);
    let mut owner = TestOnlyPitSnapshotOwner::default();
    let value = proposal(source.receipt().locator());
    let basis = canonical_basis(&value, &source);
    let commit = owner
        .commit_initial(value, &basis, &source_owner, &source_read_clock(40, 40, 1))
        .expect("snapshot");
    assert_eq!(
        commit.fact().disposition(),
        PitSnapshotDisposition::Available
    );
    assert!(commit.fact().blockers().is_empty());
    assert_eq!(commit.fact().lineage_version(), 1);
    assert_eq!(owner.commit_count(), 1);
    assert_eq!(owner.outbox_count(), 1);
    assert_eq!(commit.outbox().digest(), commit.receipt().outbox_digest());
    assert!(!commit.outbox().payload().is_empty());
    assert_eq!(
        owner
            .resolve(commit.receipt().locator(), &pit_read_clock(40, 90, 2))
            .expect("readback"),
        commit
    );
}

#[rstest]
fn terminal_precedence_is_stable_and_stale_clock_is_zero_write() {
    let ordered = [
        (
            PitSnapshotBlocker::RightsUnlicensed,
            PitSnapshotDisposition::Unlicensed,
        ),
        (
            PitSnapshotBlocker::IdentitySemanticsOrTimeAmbiguous,
            PitSnapshotDisposition::Ambiguous,
        ),
        (
            PitSnapshotBlocker::EvidenceStale,
            PitSnapshotDisposition::Stale,
        ),
        (
            PitSnapshotBlocker::CoverageInsufficient,
            PitSnapshotDisposition::Insufficient,
        ),
        (
            PitSnapshotBlocker::SourceUnavailable,
            PitSnapshotDisposition::Unavailable,
        ),
    ];

    for mask in 1_u8..(1 << ordered.len()) {
        let expected = ordered
            .iter()
            .enumerate()
            .find(|(index, _)| mask & (1 << index) != 0)
            .map(|(_, value)| *value)
            .expect("selected");
        let source_blockers = if mask & 1 != 0 {
            vec![SourceBindingBlocker::RightsDeniedOrUnlicensed]
        } else {
            Vec::new()
        };
        let (source_owner, source) = source_fixture(source_blockers);
        let mut value = proposal(source.receipt().locator());

        if mask & (1 << 1) != 0 {
            value.evidence.semantics_compatible = false;
        }

        if mask & (1 << 2) != 0 {
            value.request.time_evidence.valid_through = 40;
            refresh_request_claims(&mut value.request);
        }

        if mask & (1 << 3) != 0 {
            value.evidence.coverage_complete = false;
        }

        if mask & (1 << 4) != 0 {
            value.evidence.source_available = false;
        }
        let basis = canonical_basis(&value, &source);

        let mut owner = TestOnlyPitSnapshotOwner::default();
        let result =
            owner.commit_initial(value, &basis, &source_owner, &source_read_clock(40, 40, 1));

        if mask & (1 << 2) != 0 {
            assert_eq!(result, Err(PitSnapshotError::TrustedClockMismatch));
            assert_eq!(owner.commit_count(), 0);
            assert_eq!(owner.outbox_count(), 0);
            continue;
        }
        let fact = result.expect("terminal").fact().clone();
        assert_eq!(fact.primary_blocker(), Some(expected.0));
        assert_eq!(fact.disposition(), expected.1);
        assert_eq!(fact.blockers().len(), mask.count_ones() as usize);
    }
}

#[rstest]
fn missing_mixed_or_future_correction_time_never_becomes_available() {
    for mutation in [
        |value: &mut UntrustedPitSnapshotProposal| {
            value.request.time_evidence.correction_publication = None;
        },
        |value: &mut UntrustedPitSnapshotProposal| {
            value
                .request
                .time_evidence
                .correction_publication
                .as_mut()
                .expect("correction")
                .clock_epoch = "other-epoch".into();
        },
        |value: &mut UntrustedPitSnapshotProposal| {
            value
                .request
                .time_evidence
                .correction_publication
                .as_mut()
                .expect("correction")
                .value = 41;
        },
    ] {
        let (source_owner, source) = source_fixture([]);
        let mut value = proposal(source.receipt().locator());
        mutation(&mut value);
        refresh_request_claims(&mut value.request);
        let basis = canonical_basis(&value, &source);
        let commit = TestOnlyPitSnapshotOwner::default()
            .commit_initial(value, &basis, &source_owner, &source_read_clock(40, 40, 1))
            .expect("terminal");
        assert_eq!(
            commit.fact().disposition(),
            PitSnapshotDisposition::Ambiguous
        );
        assert_ne!(
            commit.fact().disposition(),
            PitSnapshotDisposition::Available
        );
    }
}

#[rstest]
fn unresolved_rights_map_to_unavailable_not_available_or_unlicensed() {
    let (source_owner, source) = source_fixture([SourceBindingBlocker::RightsEvidenceUnresolved]);
    let value = proposal(source.receipt().locator());
    let basis = canonical_basis(&value, &source);
    let commit = TestOnlyPitSnapshotOwner::default()
        .commit_initial(value, &basis, &source_owner, &source_read_clock(40, 40, 1))
        .expect("terminal");
    assert_eq!(
        commit.fact().disposition(),
        PitSnapshotDisposition::Unavailable
    );
}

#[rstest]
fn forged_source_binding_locator_cannot_mint_availability_or_write() {
    let (source_owner, source) = source_fixture([]);
    let mut forged = source.receipt().locator().clone();
    forged.fact_digest = d(99);
    let mut value = proposal(&forged);
    refresh_request_claims(&mut value.request);
    let basis = canonical_basis(&value, &source);
    let mut owner = TestOnlyPitSnapshotOwner::default();
    assert_eq!(
        owner.commit_initial(value, &basis, &source_owner, &source_read_clock(40, 40, 1),),
        Err(PitSnapshotError::SourceBindingUnavailable)
    );
    assert_eq!(owner.commit_count(), 0);
    assert_eq!(owner.outbox_count(), 0);
}

#[rstest]
fn mismatched_owner_resolved_basis_fields_reject_without_write() {
    let (source_owner, source) = source_fixture([]);
    let original = proposal(source.receipt().locator());
    let basis = canonical_basis(&original, &source);

    let mutations: [fn(&mut UntrustedPitSnapshotProposal); 15] = [
        |value: &mut UntrustedPitSnapshotProposal| {
            value.request.instrument_master_digest = d(90);
        },
        |value: &mut UntrustedPitSnapshotProposal| {
            value.request.universe_selection_digest = d(91);
        },
        |value: &mut UntrustedPitSnapshotProposal| {
            value.request.market_semantics_identity = d(92);
        },
        |value| value.evidence.normalized_records_digest = d(93),
        |value| value.evidence.source_frontier.stream_identity.push('x'),
        |value| value.evidence.source_frontier.cut_identity.push('x'),
        |value| value.evidence.source_frontier.sequence += 1,
        |value| value.evidence.source_frontier.digest = d(94),
        |value| value.evidence.correction_frontier.stream_identity.push('x'),
        |value| value.evidence.correction_frontier.cut_identity.push('x'),
        |value| value.evidence.correction_frontier.sequence += 1,
        |value| value.evidence.correction_frontier.digest = d(95),
        |value: &mut UntrustedPitSnapshotProposal| {
            value.evidence.coverage_complete = false;
        },
        |value: &mut UntrustedPitSnapshotProposal| {
            value.evidence.semantics_compatible = false;
        },
        |value: &mut UntrustedPitSnapshotProposal| {
            value.evidence.source_available = false;
        },
    ];

    for mutation in mutations {
        let mut changed = original.clone();
        mutation(&mut changed);
        refresh_request_claims(&mut changed.request);
        let mut owner = TestOnlyPitSnapshotOwner::default();
        assert_eq!(
            owner.commit_initial(
                changed,
                &basis,
                &source_owner,
                &source_read_clock(40, 40, 1),
            ),
            Err(PitSnapshotError::CanonicalBasisMismatch)
        );
        assert_eq!(owner.commit_count(), 0);
        assert_eq!(owner.outbox_count(), 0);
    }
}

#[rstest]
fn source_binding_must_cover_the_exact_shared_pit_decision_cut() {
    let (source_owner, source) = source_fixture([]);
    let mut current = proposal(source.receipt().locator());
    current.request.time_evidence = typed_time(50, 2);
    refresh_request_claims(&mut current.request);
    let current_basis = canonical_basis(&current, &source);
    let commit = TestOnlyPitSnapshotOwner::default()
        .commit_initial(
            current,
            &current_basis,
            &source_owner,
            &source_read_clock(50, 50, 2),
        )
        .expect("current source binding");
    assert_eq!(
        commit.fact().disposition(),
        PitSnapshotDisposition::Available
    );

    let mut expired = proposal(source.receipt().locator());
    expired.request.time_evidence = typed_time(100, 2);
    refresh_request_claims(&mut expired.request);
    let expired_basis = canonical_basis(&expired, &source);
    let mut owner = TestOnlyPitSnapshotOwner::default();
    assert_eq!(
        owner.commit_initial(
            expired,
            &expired_basis,
            &source_owner,
            &source_read_clock(100, 100, 2),
        ),
        Err(PitSnapshotError::SourceBindingUnavailable)
    );
    assert_eq!(owner.commit_count(), 0);
    assert_eq!(owner.outbox_count(), 0);
}

#[rstest]
fn exact_response_loss_replay_joins_one_atomic_commit() {
    let (source_owner, source) = source_fixture([]);
    let value = proposal(source.receipt().locator());
    let basis = canonical_basis(&value, &source);
    let mut owner = TestOnlyPitSnapshotOwner::default();
    assert_eq!(
        owner.commit_initial_with_fault(
            value.clone(),
            &basis,
            &source_owner,
            &source_read_clock(40, 40, 1),
            CommitFault::BeforeCommit,
        ),
        Err(PitSnapshotError::CommitInterrupted)
    );
    assert_eq!(owner.commit_count(), 0);
    assert_eq!(
        owner.commit_initial_with_fault(
            value.clone(),
            &basis,
            &source_owner,
            &source_read_clock(40, 40, 1),
            CommitFault::ResponseLoss,
        ),
        Err(PitSnapshotError::ResponseLost)
    );
    let recovered = owner
        .commit_initial(value, &basis, &source_owner, &source_read_clock(40, 40, 1))
        .expect("exact replay");
    assert_eq!(owner.commit_count(), 1);
    assert_eq!(owner.outbox_count(), 1);
    assert_eq!(
        recovered.fact().disposition(),
        PitSnapshotDisposition::Available
    );
}

#[rstest]
fn complete_owner_request_proof_rejects_self_consistent_mutation_without_write() {
    let (source_owner, source) = source_fixture([]);
    let original = proposal(source.receipt().locator());
    let basis = canonical_basis(&original, &source);

    for mutation in [
        |request: &mut UntrustedPitSnapshotRequest| request.correlation_identity = d(90),
        |request: &mut UntrustedPitSnapshotRequest| request.requester_identity = d(91),
        |request: &mut UntrustedPitSnapshotRequest| request.scope_digest = d(92),
        |request: &mut UntrustedPitSnapshotRequest| request.instrument_master_digest = d(93),
        |request: &mut UntrustedPitSnapshotRequest| request.universe_selection_digest = d(94),
        |request: &mut UntrustedPitSnapshotRequest| request.market_semantics_identity = d(95),
    ] {
        assert_request_basis_rejects(
            &original,
            &basis,
            &source_owner,
            mutation,
            true,
            PitSnapshotError::CanonicalBasisMismatch,
        );
    }

    assert_request_basis_rejects(
        &original,
        &basis,
        &source_owner,
        |request| request.claimed_request_identity = d(96),
        false,
        PitSnapshotError::RequestIdentityMismatch,
    );
    assert_request_basis_rejects(
        &original,
        &basis,
        &source_owner,
        |request| request.claimed_request_digest = d(97),
        false,
        PitSnapshotError::RequestDigestMismatch,
    );

    for (_, mutation) in SOURCE_LOCATOR_MUTATIONS {
        assert_request_basis_rejects(
            &original,
            &basis,
            &source_owner,
            mutation,
            true,
            PitSnapshotError::CanonicalBasisMismatch,
        );
    }

    let time_mutations: [fn(&mut UntrustedPitSnapshotRequest); 22] = [
        |r| r.time_evidence.event_effective.value += 1,
        |r| r.time_evidence.event_effective.clock_identity.push('x'),
        |r| r.time_evidence.event_effective.clock_epoch.push('x'),
        |r| r.time_evidence.provider_available.value += 1,
        |r| r.time_evidence.provider_available.clock_identity.push('x'),
        |r| r.time_evidence.provider_available.clock_epoch.push('x'),
        |r| r.time_evidence.retrieval.value += 1,
        |r| r.time_evidence.retrieval.clock_identity.push('x'),
        |r| r.time_evidence.retrieval.clock_epoch.push('x'),
        |r| r.time_evidence.correction_publication = None,
        |r| {
            r.time_evidence
                .correction_publication
                .as_mut()
                .expect("correction")
                .value += 1;
        },
        |r| {
            r.time_evidence
                .correction_publication
                .as_mut()
                .expect("correction")
                .clock_identity
                .push('x');
        },
        |r| {
            r.time_evidence
                .correction_publication
                .as_mut()
                .expect("correction")
                .clock_epoch
                .push('x');
        },
        |r| r.time_evidence.decision_cut.value += 1,
        |r| r.time_evidence.decision_cut.clock_identity.push('x'),
        |r| r.time_evidence.decision_cut.clock_epoch.push('x'),
        |r| r.time_evidence.monotonic_sequence += 1,
        |r| r.time_evidence.restart_continuity_digest = d(70),
        |r| r.time_evidence.skew_bound += 1,
        |r| r.time_evidence.uncertainty_bound += 1,
        |r| r.time_evidence.observed_at += 1,
        |r| r.time_evidence.valid_through += 1,
    ];

    for mutation in time_mutations {
        assert_request_basis_rejects(
            &original,
            &basis,
            &source_owner,
            mutation,
            true,
            PitSnapshotError::CanonicalBasisMismatch,
        );
    }
}

#[rstest]
fn one_shared_clock_admission_is_frozen_field_for_field() {
    let (source_owner, source) = source_fixture([]);
    let value = proposal(source.receipt().locator());
    let basis = canonical_basis(&value, &source);
    let mutations: [fn(&mut MarketDataClockAdmission); 9] = [
        |clock| clock.clock_identity = "other-clock".into(),
        |clock| clock.clock_epoch = "other-epoch".into(),
        |clock| clock.monotonic_sequence = 2,
        |clock| clock.wall_observed = 41,
        |clock| clock.decision_cut = 41,
        |clock| clock.valid_through = 101,
        |clock| clock.restart_continuity_digest = d(8),
        |clock| clock.uncertainty_bound = 2,
        |clock| clock.skew_bound = 3,
    ];

    for mutation in mutations {
        let mut changed_clock = source_read_clock(40, 40, 1);
        mutation(&mut changed_clock);
        let mut owner = TestOnlyPitSnapshotOwner::default();
        assert_eq!(
            owner.commit_initial(value.clone(), &basis, &source_owner, &changed_clock,),
            Err(PitSnapshotError::CanonicalBasisMismatch)
        );
        assert_eq!(owner.commit_count(), 0);
        assert_eq!(owner.outbox_count(), 0);
    }
}

#[rstest]
fn correction_is_exactly_next_successor_and_never_mutates_predecessor() {
    let source_owner = TestOnlyInMemorySourceBindingOwner::default();
    let source_initial = source_owner
        .commit_initial(
            source_proposal(10, 40),
            OwnerSourceBindingDecision {
                blockers: BTreeSet::new(),
            },
            &source_clock(40, 1),
        )
        .expect("source initial");
    let source_successor = source_owner
        .commit_successor(
            source_initial.receipt().locator(),
            source_proposal(12, 50),
            OwnerSourceBindingDecision {
                blockers: BTreeSet::new(),
            },
            &source_clock(50, 2),
        )
        .expect("source successor");
    let mut owner = TestOnlyPitSnapshotOwner::default();
    let initial_value = proposal(source_initial.receipt().locator());
    let initial_basis = canonical_basis(&initial_value, &source_initial);
    let initial = owner
        .commit_initial(
            initial_value,
            &initial_basis,
            &source_owner,
            &source_read_clock(40, 40, 1),
        )
        .expect("initial");
    let mut correction = proposal(source_successor.receipt().locator());
    correction.request.time_evidence = typed_time(50, 2);
    correction.evidence.source_frontier = source_successor.fact().source_frontier().clone();
    correction.evidence.correction_frontier = source_successor.fact().correction_frontier().clone();
    correction.evidence.normalized_records_digest = d(26);
    refresh_request_claims(&mut correction.request);
    let correction_basis = canonical_basis(&correction, &source_successor);
    let successor = owner
        .commit_correction(
            initial.receipt().locator(),
            correction.clone(),
            &correction_basis,
            &source_owner,
            &source_read_clock(50, 50, 2),
        )
        .expect("correction");
    assert_eq!(successor.fact().lineage_version(), 2);
    assert_eq!(
        successor.fact().disposition(),
        PitSnapshotDisposition::Available
    );
    assert_ne!(successor.fact().digest(), initial.fact().digest());
    assert_eq!(owner.commit_count(), 2);
    assert_eq!(
        owner
            .resolve(initial.receipt().locator(), &pit_read_clock(40, 90, 2))
            .expect("old readback"),
        initial
    );

    let mut skipped = correction;
    skipped.evidence.correction_frontier.sequence += 1;
    skipped.evidence.correction_frontier.digest = d(27);
    assert_eq!(
        owner.commit_correction(
            initial.receipt().locator(),
            skipped,
            &correction_basis,
            &source_owner,
            &source_read_clock(50, 50, 2),
        ),
        Err(PitSnapshotError::InvalidCorrectionSequence)
    );
    assert_eq!(owner.commit_count(), 2);
}

#[rstest]
fn pit_correction_accepts_frontier_advance_with_validity_shrink_covering_cut() {
    let (source_owner, source_successor, mut owner, initial) = correction_fixture();
    let mut correction = proposal(source_successor.receipt().locator());
    correction.request.time_evidence = typed_time(50, 2);
    correction.request.time_evidence.valid_through = 90;
    correction.evidence.source_frontier = source_successor.fact().source_frontier().clone();
    correction.evidence.correction_frontier = source_successor.fact().correction_frontier().clone();
    correction.evidence.normalized_records_digest = d(26);
    refresh_request_claims(&mut correction.request);
    let clock = MarketDataClockAdmission::seal_for_test(
        "market-clock",
        "epoch-1",
        2,
        50,
        50,
        90,
        d(7),
        1,
        2,
    );
    let basis = canonical_basis_with_clock(&correction, &clock);
    let committed = owner
        .commit_correction(
            initial.receipt().locator(),
            correction,
            &basis,
            &source_owner,
            &clock,
        )
        .expect("valid shrinking correction");
    assert_eq!(committed.fact().lineage_version(), 2);
    assert_eq!(owner.commit_count(), 2);
    assert_eq!(owner.outbox_count(), 2);
}

#[rstest]
fn correction_rejects_a_different_source_binding_lineage_without_write() {
    let source_owner = TestOnlyInMemorySourceBindingOwner::default();
    let source_initial = source_owner
        .commit_initial(
            source_proposal(10, 40),
            OwnerSourceBindingDecision {
                blockers: BTreeSet::new(),
            },
            &source_clock(40, 1),
        )
        .expect("source initial");
    let unrelated_source = source_owner
        .commit_initial(
            source_proposal(12, 50),
            OwnerSourceBindingDecision {
                blockers: BTreeSet::new(),
            },
            &source_clock(50, 2),
        )
        .expect("unrelated source lineage");
    let initial_value = proposal(source_initial.receipt().locator());
    let initial_basis = canonical_basis(&initial_value, &source_initial);
    let mut owner = TestOnlyPitSnapshotOwner::default();
    let initial = owner
        .commit_initial(
            initial_value,
            &initial_basis,
            &source_owner,
            &source_read_clock(40, 40, 1),
        )
        .expect("initial snapshot");
    let mut correction = proposal(unrelated_source.receipt().locator());
    correction.request.time_evidence = typed_time(50, 2);
    correction.evidence.source_frontier = unrelated_source.fact().source_frontier().clone();
    correction.evidence.correction_frontier = unrelated_source.fact().correction_frontier().clone();
    correction.evidence.normalized_records_digest = d(26);
    refresh_request_claims(&mut correction.request);
    let correction_basis = canonical_basis(&correction, &unrelated_source);
    assert_eq!(
        owner.commit_correction(
            initial.receipt().locator(),
            correction,
            &correction_basis,
            &source_owner,
            &source_read_clock(50, 50, 2),
        ),
        Err(PitSnapshotError::CorrectionHeadMismatch)
    );
    assert_eq!(owner.commit_count(), 1);
    assert_eq!(owner.outbox_count(), 1);
}

#[rstest]
fn pit_correction_requires_every_frontier_cut_and_time_to_advance_without_write() {
    let mutations: [fn(&mut UntrustedPitSnapshotProposal); 17] = [
        |value| value.evidence.source_frontier.cut_identity = "source-cut-10".into(),
        |value| value.evidence.source_frontier.sequence = 10,
        |value| value.evidence.source_frontier.digest = d(3),
        |value| value.evidence.correction_frontier.cut_identity = "correction-cut-11".into(),
        |value| value.evidence.correction_frontier.sequence = 11,
        |value| value.evidence.correction_frontier.digest = d(4),
        |value| value.request.time_evidence.event_effective.value = 9,
        |value| value.request.time_evidence.provider_available.value = 19,
        |value| {
            value.request.time_evidence.provider_available.value = 21;
            value.request.time_evidence.retrieval.value = 29;
            value
                .request
                .time_evidence
                .correction_publication
                .as_mut()
                .expect("correction")
                .value = 26;
        },
        |value| {
            value
                .request
                .time_evidence
                .correction_publication
                .as_mut()
                .expect("correction")
                .value = 25;
        },
        |value| value.request.time_evidence.decision_cut.value = 40,
        |value| value.request.time_evidence.observed_at = 40,
        |value| value.request.time_evidence.monotonic_sequence = 1,
        |value| value.request.time_evidence.restart_continuity_digest = d(8),
        |value| value.request.time_evidence.uncertainty_bound = 2,
        |value| value.request.time_evidence.skew_bound = 3,
        |value| value.request.time_evidence.decision_cut.clock_epoch = "epoch-2".into(),
    ];

    for mutation in mutations {
        let (source_owner, source_successor, mut owner, initial) = correction_fixture();
        let mut correction = proposal(source_successor.receipt().locator());
        correction.request.time_evidence = typed_time(50, 2);
        correction.evidence.source_frontier = source_successor.fact().source_frontier().clone();
        correction.evidence.correction_frontier =
            source_successor.fact().correction_frontier().clone();
        correction.evidence.normalized_records_digest = d(26);
        mutation(&mut correction);
        refresh_request_claims(&mut correction.request);
        let basis = canonical_basis(&correction, &source_successor);
        assert_eq!(
            owner.commit_correction(
                initial.receipt().locator(),
                correction,
                &basis,
                &source_owner,
                &source_read_clock(50, 50, 2),
            ),
            Err(PitSnapshotError::InvalidCorrectionSequence)
        );
        assert_eq!(owner.commit_count(), 1);
        assert_eq!(owner.outbox_count(), 1);
    }

    for preserve_identity in [true, false] {
        let (source_owner, source_successor, mut owner, initial) = correction_fixture();
        let mut correction = proposal(source_successor.receipt().locator());
        correction.request.time_evidence = typed_time(50, 2);
        correction.evidence.source_frontier = source_successor.fact().source_frontier().clone();
        correction.evidence.correction_frontier =
            source_successor.fact().correction_frontier().clone();
        correction.evidence.normalized_records_digest = d(26);
        refresh_request_claims(&mut correction.request);
        if preserve_identity {
            correction.request.claimed_request_identity = initial.fact().request_identity();
        } else {
            correction.request.claimed_request_digest = initial.fact().request_digest();
        }
        let basis = canonical_basis(&correction, &source_successor);
        assert_eq!(
            owner.commit_correction(
                initial.receipt().locator(),
                correction,
                &basis,
                &source_owner,
                &source_read_clock(50, 50, 2),
            ),
            Err(PitSnapshotError::CorrectionHeadMismatch)
        );
        assert_eq!(owner.commit_count(), 1);
        assert_eq!(owner.outbox_count(), 1);
    }
}

#[rstest]
fn request_identity_is_domain_separated_and_binds_all_request_coordinates() {
    let (_, source) = source_fixture([]);
    let original = proposal(source.receipt().locator()).request;
    assert_ne!(
        derive_request_digest(&original),
        derive_request_identity(&original)
    );
    let expected_digest = derive_request_digest(&original);
    let expected_identity = derive_request_identity(&original);
    let mut variants = Vec::new();

    for mutation in [
        |value: &mut UntrustedPitSnapshotRequest| value.requester_identity = d(69),
        |value: &mut UntrustedPitSnapshotRequest| value.scope_digest = d(70),
        |value: &mut UntrustedPitSnapshotRequest| value.instrument_master_digest = d(71),
        |value: &mut UntrustedPitSnapshotRequest| value.universe_selection_digest = d(72),
        |value: &mut UntrustedPitSnapshotRequest| value.market_semantics_identity = d(73),
        |value: &mut UntrustedPitSnapshotRequest| value.time_evidence.event_effective.value += 1,
        |value: &mut UntrustedPitSnapshotRequest| value.time_evidence.provider_available.value += 1,
        |value: &mut UntrustedPitSnapshotRequest| value.time_evidence.retrieval.value += 1,
        |value: &mut UntrustedPitSnapshotRequest| {
            value
                .time_evidence
                .correction_publication
                .as_mut()
                .expect("correction")
                .value += 1;
        },
        |value: &mut UntrustedPitSnapshotRequest| value.time_evidence.decision_cut.value += 1,
    ] {
        let mut value = original.clone();
        mutation(&mut value);
        variants.push(value);
    }

    for value in variants {
        assert_ne!(derive_request_digest(&value), expected_digest);
        assert_ne!(derive_request_identity(&value), expected_identity);
    }

    let mut correlation = original;
    correlation.correlation_identity = d(74);
    assert_eq!(derive_request_digest(&correlation), expected_digest);
    assert_ne!(derive_request_identity(&correlation), expected_identity);
}

#[rstest]
fn every_source_locator_and_time_leaf_changes_request_digest_and_identity() {
    let (_, source) = source_fixture([]);
    let original = proposal(source.receipt().locator()).request;
    let expected_digest = derive_request_digest(&original);
    let expected_identity = derive_request_identity(&original);

    for (field, mutation) in SOURCE_LOCATOR_MUTATIONS {
        let mut changed = original.clone();
        mutation(&mut changed);
        assert_ne!(
            derive_request_digest(&changed),
            expected_digest,
            "source field {field} must change the request digest"
        );
        assert_ne!(
            derive_request_identity(&changed),
            expected_identity,
            "source field {field} must change the request identity"
        );
    }
}

#[rstest]
fn every_locator_field_is_exact_native_readback() {
    let (source_owner, source) = source_fixture([]);
    let mut owner = TestOnlyPitSnapshotOwner::default();
    let value = proposal(source.receipt().locator());
    let basis = canonical_basis(&value, &source);
    let commit = owner
        .commit_initial(value, &basis, &source_owner, &source_read_clock(40, 40, 1))
        .expect("commit");
    let original = commit.receipt().locator().clone();
    let mut forged = Vec::new();
    macro_rules! changed {
        ($body:expr) => {{
            let mut value = original.clone();
            $body(&mut value);
            forged.push(value);
        }};
    }
    changed!(|v: &mut UntrustedPitSnapshotLocator| v.owner.push('x'));
    changed!(|v: &mut UntrustedPitSnapshotLocator| v.request_identity = d(80));
    changed!(|v: &mut UntrustedPitSnapshotLocator| v.request_digest = d(81));
    changed!(|v: &mut UntrustedPitSnapshotLocator| v.correlation_identity = d(82));
    changed!(|v: &mut UntrustedPitSnapshotLocator| v.requester_identity = d(90));
    changed!(|v: &mut UntrustedPitSnapshotLocator| v.scope_digest = d(91));
    changed!(|v: &mut UntrustedPitSnapshotLocator| v.snapshot_identity = d(83));
    changed!(|v: &mut UntrustedPitSnapshotLocator| v.fact_digest = d(84));
    changed!(|v: &mut UntrustedPitSnapshotLocator| v.source_binding_identity = d(88));
    changed!(|v: &mut UntrustedPitSnapshotLocator| v.source_binding_lineage_root = d(89));
    changed!(|v: &mut UntrustedPitSnapshotLocator| v.source_binding_lineage_version += 1);
    changed!(|v: &mut UntrustedPitSnapshotLocator| v.lineage_root = d(85));
    changed!(|v: &mut UntrustedPitSnapshotLocator| v.lineage_version += 1);
    changed!(|v: &mut UntrustedPitSnapshotLocator| v.predecessor_snapshot_identity = Some(d(86)));
    changed!(|v: &mut UntrustedPitSnapshotLocator| v.predecessor_fact_digest = Some(d(87)));
    changed!(|v: &mut UntrustedPitSnapshotLocator| v.source_frontier.sequence += 1);
    changed!(|v: &mut UntrustedPitSnapshotLocator| v.correction_frontier.sequence += 1);
    changed!(|v: &mut UntrustedPitSnapshotLocator| v.time_evidence.observed_at += 1);

    for locator in forged {
        assert!(owner.resolve(&locator, &pit_read_clock(40, 90, 2)).is_err());
    }
}

fn observation_batch_fixture() -> (
    PitSnapshotCommitAggregate,
    VerifiedPitObservation,
    Vec<u8>,
    Vec<ObservedPitObservationNativeRow>,
) {
    let (source_owner, source) = source_fixture([]);
    let mut value = proposal(source.receipt().locator());
    let request = &value.request;
    let evidence = &value.evidence;
    let row = VerifiedPitObservation {
        symbolic_key: "AAPL.CLOSE".to_owned(),
        member_key: "AAPL.XNAS".to_owned(),
        instrument: "AAPL.XNAS".to_owned(),
        channel: "MARKET".to_owned(),
        data_kind: "BAR".to_owned(),
        timeframe: "1M".to_owned(),
        field: "CLOSE".to_owned(),
        value_mantissa: 12_345,
        value_scale: 2,
        event_effective: request.time_evidence.event_effective.value,
        provider_available: request.time_evidence.provider_available.value,
        retrieval: request.time_evidence.retrieval.value,
        correction_publication: request
            .time_evidence
            .correction_publication
            .as_ref()
            .expect("correction time")
            .value,
        source_binding_identity: source.receipt().locator().binding_id,
        source_frontier_digest: evidence.source_frontier.digest,
        instrument_master_digest: request.instrument_master_digest,
        universe_selection_digest: request.universe_selection_digest,
        market_semantics_identity: request.market_semantics_identity,
        correction_stream_identity: evidence.correction_frontier.stream_identity.clone(),
        correction_sequence: evidence.correction_frontier.sequence,
        correction_frontier_digest: evidence.correction_frontier.digest,
    };
    let row_bytes = canonical_observation_bytes(&row);
    let batch_bytes = canonical_batch_bytes(std::slice::from_ref(&row));
    value.evidence.normalized_records_digest =
        BindingDigest::from_untrusted_bytes(*blake3::hash(&batch_bytes).as_bytes());
    let basis = canonical_basis(&value, &source);
    let aggregate = TestOnlyPitSnapshotOwner::default()
        .commit_initial(value, &basis, &source_owner, &source_read_clock(40, 40, 1))
        .expect("snapshot");
    (
        aggregate,
        row.clone(),
        batch_bytes,
        vec![ObservedPitObservationNativeRow {
            ordinal: 1,
            symbolic_key: row.symbolic_key.clone(),
            member_key: row.member_key,
            row_bytes,
        }],
    )
}

fn untrusted_observation(row: &VerifiedPitObservation) -> UntrustedPitObservation {
    UntrustedPitObservation {
        symbolic_key: row.symbolic_key.clone(),
        member_key: row.member_key.clone(),
        instrument: row.instrument.clone(),
        channel: row.channel.clone(),
        data_kind: row.data_kind.clone(),
        timeframe: row.timeframe.clone(),
        field: row.field.clone(),
        value_mantissa: row.value_mantissa,
        value_scale: row.value_scale,
        event_effective: row.event_effective,
        provider_available: row.provider_available,
        retrieval: row.retrieval,
        correction_publication: row.correction_publication,
        source_binding_identity: row.source_binding_identity,
        source_frontier_digest: row.source_frontier_digest,
        instrument_master_digest: row.instrument_master_digest,
        universe_selection_digest: row.universe_selection_digest,
        market_semantics_identity: row.market_semantics_identity,
        correction_stream_identity: row.correction_stream_identity.clone(),
        correction_sequence: row.correction_sequence,
        correction_frontier_digest: row.correction_frontier_digest,
    }
}

#[rstest]
fn explicit_untrusted_batch_is_prepared_only_when_complete_owner_claims_match() {
    let (aggregate, row, batch_bytes, _) = observation_batch_fixture();
    let snapshot = UntrustedPitSnapshotProposal {
        request: aggregate.fact().request().clone(),
        evidence: aggregate.fact().evidence().clone(),
    };
    let prepared = prepare_observation_batch(
        &snapshot,
        &UntrustedPitObservationBatchProposal {
            rows: vec![untrusted_observation(&row)],
        },
    )
    .expect("prepared batch");
    assert_eq!(prepared.bytes(), batch_bytes);
    assert_eq!(
        prepared.digest(),
        snapshot.evidence.normalized_records_digest
    );

    let mut forged = untrusted_observation(&row);
    forged.market_semantics_identity = d(99);
    assert_eq!(
        prepare_observation_batch(
            &snapshot,
            &UntrustedPitObservationBatchProposal { rows: vec![forged] },
        ),
        Err(PitSnapshotError::InvalidObservationBatch)
    );
    assert_eq!(
        prepare_observation_batch(
            &snapshot,
            &UntrustedPitObservationBatchProposal {
                rows: vec![untrusted_observation(&row), untrusted_observation(&row)],
            },
        ),
        Err(PitSnapshotError::InvalidObservationBatch)
    );
}

#[rstest]
fn complete_canonical_observation_batch_is_verified_before_selection() {
    let (aggregate, _, batch_bytes, rows) = observation_batch_fixture();
    let digest = BindingDigest::from_untrusted_bytes(*blake3::hash(&batch_bytes).as_bytes());
    let verified = verify_observation_batch(
        &aggregate,
        aggregate.fact().source_binding_identity(),
        aggregate.fact().source_binding_lineage_root(),
        aggregate.fact().source_binding_lineage_version(),
        digest,
        &batch_bytes,
        &rows,
    )
    .expect("verified batch");

    assert_eq!(verified.digest(), digest);
    assert_eq!(
        verified.snapshot_identity(),
        aggregate.fact().snapshot_identity()
    );
    assert_eq!(verified.observations().len(), 1);
    assert_eq!(
        verified
            .select("AAPL.CLOSE", "AAPL.XNAS")
            .expect("member")
            .value_mantissa(),
        12_345
    );
}

#[rstest]
fn batch_rejects_digest_row_count_order_duplicate_and_unknown_bytes() {
    let (aggregate, row, batch_bytes, rows) = observation_batch_fixture();
    let digest = BindingDigest::from_untrusted_bytes(*blake3::hash(&batch_bytes).as_bytes());

    assert_eq!(
        verify_observation_batch(
            &aggregate,
            aggregate.fact().source_binding_identity(),
            aggregate.fact().source_binding_lineage_root(),
            aggregate.fact().source_binding_lineage_version(),
            d(99),
            &batch_bytes,
            &rows,
        ),
        Err(PitSnapshotError::ObservationBatchUnavailable)
    );
    assert_eq!(
        verify_observation_batch(
            &aggregate,
            aggregate.fact().source_binding_identity(),
            aggregate.fact().source_binding_lineage_root(),
            aggregate.fact().source_binding_lineage_version(),
            digest,
            &batch_bytes,
            &[],
        ),
        Err(PitSnapshotError::ObservationBatchUnavailable)
    );

    let duplicate_rows = [row.clone(), row.clone()];
    let duplicate_bytes = canonical_batch_bytes(&duplicate_rows);
    assert_eq!(
        decode_canonical_observation_batch(
            &duplicate_bytes,
            &[
                canonical_observation_bytes(&row),
                canonical_observation_bytes(&row)
            ],
        ),
        Err(PitSnapshotError::InvalidObservationBatch)
    );

    let mut unknown = rows[0].row_bytes.clone();
    unknown.push(1);
    let domain = b"VIBE_PIT_OBSERVATION_BATCH_V1";
    let mut unknown_batch = Vec::new();
    unknown_batch.extend_from_slice(&(domain.len() as u64).to_be_bytes());
    unknown_batch.extend_from_slice(domain);
    unknown_batch.extend_from_slice(&1_u64.to_be_bytes());
    unknown_batch.extend_from_slice(&(unknown.len() as u64).to_be_bytes());
    unknown_batch.extend_from_slice(&unknown);
    assert_eq!(
        decode_canonical_observation_batch(&unknown_batch, &[unknown]),
        Err(PitSnapshotError::InvalidObservationBatch)
    );
}

#[rstest]
fn batch_rejects_every_native_header_and_row_index_mutation() {
    let (aggregate, _, batch_bytes, rows) = observation_batch_fixture();
    let digest = BindingDigest::from_untrusted_bytes(*blake3::hash(&batch_bytes).as_bytes());
    let verify = |source_identity,
                  source_root,
                  source_version,
                  native_rows: &[ObservedPitObservationNativeRow]| {
        verify_observation_batch(
            &aggregate,
            source_identity,
            source_root,
            source_version,
            digest,
            &batch_bytes,
            native_rows,
        )
    };
    assert_eq!(
        verify(
            d(91),
            aggregate.fact().source_binding_lineage_root(),
            aggregate.fact().source_binding_lineage_version(),
            &rows,
        ),
        Err(PitSnapshotError::ObservationBatchUnavailable)
    );
    assert_eq!(
        verify(
            aggregate.fact().source_binding_identity(),
            d(92),
            aggregate.fact().source_binding_lineage_version(),
            &rows,
        ),
        Err(PitSnapshotError::ObservationBatchUnavailable)
    );
    assert_eq!(
        verify(
            aggregate.fact().source_binding_identity(),
            aggregate.fact().source_binding_lineage_root(),
            aggregate.fact().source_binding_lineage_version() + 1,
            &rows,
        ),
        Err(PitSnapshotError::ObservationBatchUnavailable)
    );

    for mutate in [
        |row: &mut ObservedPitObservationNativeRow| row.ordinal += 1,
        |row: &mut ObservedPitObservationNativeRow| row.symbolic_key.push_str(".FORGED"),
        |row: &mut ObservedPitObservationNativeRow| row.member_key.push_str(".FORGED"),
    ] {
        let mut forged = rows.clone();
        mutate(&mut forged[0]);
        assert_eq!(
            verify(
                aggregate.fact().source_binding_identity(),
                aggregate.fact().source_binding_lineage_root(),
                aggregate.fact().source_binding_lineage_version(),
                &forged,
            ),
            Err(PitSnapshotError::ObservationBatchUnavailable)
        );
    }
}

#[rstest]
fn batch_rejects_invalid_scale_and_four_time_custody() {
    let (_, mut row, _, _) = observation_batch_fixture();
    row.value_scale = 19;
    let invalid_scale = canonical_batch_bytes(std::slice::from_ref(&row));
    assert_eq!(
        decode_canonical_observation_batch(&invalid_scale, &[canonical_observation_bytes(&row)],),
        Err(PitSnapshotError::InvalidObservationBatch)
    );

    row.value_scale = 2;
    row.correction_publication = row.retrieval + 1;
    let invalid_time = canonical_batch_bytes(std::slice::from_ref(&row));
    assert_eq!(
        decode_canonical_observation_batch(&invalid_time, &[canonical_observation_bytes(&row)],),
        Err(PitSnapshotError::InvalidObservationBatch)
    );
}

fn research_terminal_fixture(
    coverage_complete: bool,
) -> (
    PitSnapshotCommitAggregate,
    crate::owner::source_binding::authority::SourceBindingStoredAggregate,
    UntrustedResearchPitTerminalRequest,
) {
    let source_proposal = source_proposal(10, 40);
    let source_identity = derive_binding_id(&source_proposal);
    let source = build_stored_aggregate(
        source_proposal,
        OwnerSourceBindingDecision {
            blockers: BTreeSet::new(),
        },
        OwnerLineage {
            root: source_identity,
            version: 1,
            predecessor_binding_id: None,
            predecessor_fact_digest: None,
        },
    );
    let mut proposal = proposal(source.commit().receipt().locator());
    proposal.evidence.coverage_complete = coverage_complete;
    let basis = canonical_basis_with_clock(&proposal, &source_clock(40, 1));
    let pit = super::authority::prepare_initial_aggregate(
        proposal,
        &basis,
        source.commit().fact(),
        &source_clock(40, 1),
    )
    .expect("canonical PIT terminal");
    let fact = pit.fact();
    let request = UntrustedResearchPitTerminalRequest {
        consumer_role: "RESEARCH_OWNER".into(),
        locator: pit.receipt().locator().clone(),
        requester_identity: fact.request().requester_identity,
        request_identity: fact.request_identity(),
        request_digest: fact.request_digest(),
        scope_digest: fact.request().scope_digest,
        correlation_identity: fact.correlation_identity(),
        source_binding_identity: fact.source_binding_identity(),
        source_binding_fact_digest: source.commit().fact().digest(),
        source_binding_lineage_root: fact.source_binding_lineage_root(),
        source_binding_lineage_version: fact.source_binding_lineage_version(),
        source_frontier: fact.evidence().source_frontier.clone(),
        correction_frontier: fact.evidence().correction_frontier.clone(),
        time_evidence: fact.request().time_evidence.clone(),
        snapshot_correction_rule_digest: derive_snapshot_correction_rule_digest(
            fact.request(),
            fact.evidence().correction_frontier.clone(),
        )
        .expect("snapshot rule"),
        provenance_binding_digest: derive_provenance_binding_digest(source.commit().fact())
            .expect("provenance"),
        license_binding_digest: derive_license_binding_digest(source.commit().fact())
            .expect("license"),
    };
    (pit, source, request)
}

#[rstest]
fn research_terminal_exposes_positive_only_for_complete_available() {
    let (pit, source, request) = research_terminal_fixture(true);
    let persisted = serde_json::to_value(&pit).expect("persisted PIT envelope");
    assert_eq!(
        persisted["fact"]["source_binding_identity"],
        serde_json::to_value(pit.fact().source_binding_identity()).expect("source identity")
    );
    let terminal = seal_research_pit_terminal(&pit, &source, &request).expect("terminal");

    assert_eq!(terminal.disposition(), ResearchPitDisposition::Available);
    assert!(terminal.blockers().is_empty());
    assert_eq!(terminal.primary_blocker(), None);
    assert_eq!(terminal.request_identity(), request.request_identity);
    assert_eq!(terminal.scope_digest(), request.scope_digest);
    assert_eq!(terminal.source_frontier(), &request.source_frontier);
    assert_eq!(terminal.correction_frontier(), &request.correction_frontier);
    assert_eq!(terminal.time_evidence(), &request.time_evidence);
    assert_eq!(
        terminal.available().map(
            crate::owner::research_pit_terminal::AvailableResearchPitSnapshot::snapshot_identity
        ),
        Some(pit.fact().snapshot_identity())
    );
}

#[rstest]
fn research_terminal_keeps_negative_explicit_and_rejects_comparison_splice() {
    let (pit, source, mut request) = research_terminal_fixture(false);
    let terminal = seal_research_pit_terminal(&pit, &source, &request).expect("terminal");

    assert_eq!(terminal.disposition(), ResearchPitDisposition::Insufficient);
    assert_eq!(
        terminal.blockers(),
        &[ResearchPitBlocker::CoverageInsufficient]
    );
    assert_eq!(
        terminal.primary_blocker(),
        Some(ResearchPitBlocker::CoverageInsufficient)
    );
    assert!(terminal.available().is_none());

    request.snapshot_correction_rule_digest = d(99);
    assert_eq!(
        seal_research_pit_terminal(&pit, &source, &request),
        Err(PitSnapshotError::ConsumerBindingMismatch)
    );
}
