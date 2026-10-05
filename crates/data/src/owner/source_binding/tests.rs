use std::{
    collections::BTreeSet,
    sync::{Arc, Barrier},
    thread,
};

use rstest::rstest;

use super::{
    BindingDigest, MarketDataClockAdmission, SourceBindingBlocker, SourceBindingError,
    UntrustedAdapterBinding, UntrustedCompleteFrontier, UntrustedCredentialAudienceClaim,
    UntrustedCredentialCapabilityClaim, UntrustedLicensePolicy, UntrustedMarketDataAsOf,
    UntrustedMarketSemantics, UntrustedOpaqueCredentialHandle, UntrustedSourceAvailabilityRuleV1,
    UntrustedSourceBarAnchorV1, UntrustedSourceBarCadenceV1, UntrustedSourceBarClockV1,
    UntrustedSourceBarCompletionV1, UntrustedSourceBarLabelV1, UntrustedSourceBarTimeframeV1,
    UntrustedSourceBarUnitV1, UntrustedSourceBindingLocator, UntrustedSourceBindingProposal,
    UntrustedSourceVisibilityV1, UntrustedTrustPolicy,
    authority::{
        CommitFault, OwnerSourceBindingDecision, SourceBindingDisposition,
        TestOnlyInMemorySourceBindingOwner, availability_rule_digest_v1, derive_binding_id,
        derive_time_evidence_identity,
    },
};

const SECRET_SENTINEL: &str = "actual-secret-must-never-appear";

fn d(byte: u8) -> BindingDigest {
    BindingDigest::from_untrusted_bytes([byte; 32])
}

fn decision(
    blockers: impl IntoIterator<Item = SourceBindingBlocker>,
) -> OwnerSourceBindingDecision {
    OwnerSourceBindingDecision {
        blockers: blockers.into_iter().collect(),
    }
}

fn commit_clock() -> MarketDataClockAdmission {
    MarketDataClockAdmission::seal_for_test("clock", "epoch-1", 1, 40, 40, 100, d(7), 1, 2)
}

fn read_clock(now: u64) -> MarketDataClockAdmission {
    MarketDataClockAdmission::seal_for_test("clock", "epoch-1", 2, now, 40, 100, d(7), 1, 2)
}

fn successor_clock() -> MarketDataClockAdmission {
    MarketDataClockAdmission::seal_for_test("clock", "epoch-1", 2, 50, 50, 110, d(7), 1, 2)
}

fn clock_for(value: &UntrustedSourceBindingProposal) -> MarketDataClockAdmission {
    let time = &value.time_evidence;
    MarketDataClockAdmission::seal_for_test(
        time.clock_identity.clone(),
        time.clock_epoch.clone(),
        time.monotonic_sequence,
        time.observed_at,
        time.effective_at,
        time.valid_through,
        time.restart_continuity_digest,
        time.uncertainty_bound,
        time.skew_bound,
    )
}

fn read_only_capabilities() -> BTreeSet<UntrustedCredentialCapabilityClaim> {
    [
        UntrustedCredentialCapabilityClaim::MarketDataRead,
        UntrustedCredentialCapabilityClaim::ReferenceDataRead,
        UntrustedCredentialCapabilityClaim::MetadataRead,
    ]
    .into_iter()
    .collect()
}

fn credential_handle() -> UntrustedOpaqueCredentialHandle {
    UntrustedOpaqueCredentialHandle::from_untrusted_identity(
        d(6),
        UntrustedCredentialAudienceClaim::MarketData,
        read_only_capabilities(),
    )
}

fn proposal() -> UntrustedSourceBindingProposal {
    let mut proposal = UntrustedSourceBindingProposal {
        availability_rule: None,
        bar_timeframes: Vec::new(),
        claimed_binding_id: d(0),
        schema_version: 1,
        adapter: UntrustedAdapterBinding {
            implementation_digest: d(1),
            configuration_digest: d(2),
            authenticated_endpoint_identity: "https://market.example/v1".into(),
            dataset_mapping: "dataset/trades".into(),
            account_mapping: "tenant/entitlement".into(),
        },
        credential_handle: credential_handle(),
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
            cut_identity: "source-cut-10".into(),
            sequence: 10,
            digest: d(3),
        },
        correction_frontier: UntrustedCompleteFrontier {
            stream_identity: "correction-stream".into(),
            cut_identity: "correction-cut-11".into(),
            sequence: 11,
            digest: d(4),
        },
        time_evidence: UntrustedMarketDataAsOf {
            claimed_evidence_identity: d(0),
            clock_identity: "clock".into(),
            clock_epoch: "epoch-1".into(),
            monotonic_sequence: 1,
            restart_continuity_digest: d(7),
            skew_bound: 2,
            uncertainty_bound: 1,
            event_effective: 10,
            provider_available: 20,
            retrieval: 30,
            correction_publication: 25,
            observed_at: 40,
            effective_at: 40,
            valid_through: 100,
        },
    };
    refresh_claims(&mut proposal);
    proposal
}

fn successor_proposal() -> UntrustedSourceBindingProposal {
    let mut value = proposal();
    value.source_frontier.cut_identity = "source-cut-12".into();
    value.source_frontier.sequence = 12;
    value.source_frontier.digest = d(8);
    value.time_evidence.monotonic_sequence = 2;
    value.time_evidence.provider_available = 45;
    value.time_evidence.retrieval = 49;
    value.time_evidence.correction_publication = 49;
    value.time_evidence.observed_at = 50;
    value.time_evidence.effective_at = 50;
    value.time_evidence.valid_through = 110;
    refresh_claims(&mut value);
    value
}

fn refresh_claims(proposal: &mut UntrustedSourceBindingProposal) {
    proposal.time_evidence.claimed_evidence_identity =
        derive_time_evidence_identity(&proposal.time_evidence);
    proposal.claimed_binding_id = derive_binding_id(proposal);
}

#[rstest]
fn admitted_fixture_path_uses_sealed_clock_and_complete_readback() {
    let owner = TestOnlyInMemorySourceBindingOwner::default();
    let commit = owner
        .commit_initial(proposal(), decision([]), &commit_clock())
        .expect("commit");
    assert_eq!(
        commit.fact().disposition(),
        SourceBindingDisposition::Admitted
    );
    assert!(commit.fact().blockers().is_empty());
    assert_eq!(commit.fact().lineage_version(), 1);
    assert_eq!(commit.fact().lineage_root(), commit.fact().binding_id());
    assert_eq!(commit.fact().predecessor_binding_id(), None);
    assert_eq!(
        owner
            .resolve(commit.receipt().locator(), &read_clock(90))
            .expect("resolve"),
        commit.fact().clone()
    );
    let outbox = owner
        .resolve_outbox(commit.receipt().locator(), &read_clock(90))
        .expect("outbox");
    assert_eq!(outbox.digest(), commit.receipt().outbox_digest());
    assert!(outbox.payload_len() > 32);
}

#[rstest]
fn blocker_precedence_and_disposition_cover_every_supported_set() {
    let ordered = [
        (
            SourceBindingBlocker::RightsRevoked,
            SourceBindingDisposition::Revoked,
        ),
        (
            SourceBindingBlocker::RightsDeniedOrUnlicensed,
            SourceBindingDisposition::Unlicensed,
        ),
        (
            SourceBindingBlocker::RightsEvidenceUnresolved,
            SourceBindingDisposition::Unavailable,
        ),
        (
            SourceBindingBlocker::SourceIdentityOrConfigMismatch,
            SourceBindingDisposition::Incompatible,
        ),
        (
            SourceBindingBlocker::SemanticsIncompatible,
            SourceBindingDisposition::Incompatible,
        ),
        (
            SourceBindingBlocker::SourceUnavailable,
            SourceBindingDisposition::Unavailable,
        ),
        (
            SourceBindingBlocker::EvidenceStaleOrIncomplete,
            SourceBindingDisposition::Unavailable,
        ),
    ];

    for mask in 1_u16..(1 << ordered.len()) {
        let selected: Vec<_> = ordered
            .iter()
            .enumerate()
            .filter(|(index, _)| mask & (1 << index) != 0)
            .map(|(_, value)| *value)
            .collect();
        let expected = selected[0];

        for reverse in [false, true] {
            let mut values = selected.clone();
            if reverse {
                values.reverse();
            }
            let fact = TestOnlyInMemorySourceBindingOwner::default()
                .commit_initial(
                    proposal(),
                    decision(values.into_iter().map(|entry| entry.0)),
                    &commit_clock(),
                )
                .expect("commit")
                .fact()
                .clone();
            assert_eq!(fact.primary_blocker(), Some(expected.0));
            assert_eq!(fact.disposition(), expected.1);
            assert_eq!(fact.blockers().len(), selected.len());
        }
    }
}

#[rstest]
fn caller_claimed_binding_and_time_identities_must_match_owner_derivation() {
    let owner = TestOnlyInMemorySourceBindingOwner::default();
    let mut wrong_binding = proposal();
    wrong_binding.claimed_binding_id = d(9);
    assert_eq!(
        owner.commit_initial(wrong_binding, decision([]), &commit_clock()),
        Err(SourceBindingError::BindingIdentityMismatch)
    );
    let mut wrong_time = proposal();
    wrong_time.time_evidence.claimed_evidence_identity = d(9);
    wrong_time.claimed_binding_id = derive_binding_id(&wrong_time);
    assert_eq!(
        owner.commit_initial(wrong_time, decision([]), &commit_clock()),
        Err(SourceBindingError::TimeEvidenceIdentityMismatch)
    );
    assert_eq!(owner.commit_count(), 0);
}

#[rstest]
fn wrong_credential_audience_is_rejected_without_write() {
    for audience in [
        UntrustedCredentialAudienceClaim::Execution,
        UntrustedCredentialAudienceClaim::Paper,
        UntrustedCredentialAudienceClaim::Account,
        UntrustedCredentialAudienceClaim::Order,
        UntrustedCredentialAudienceClaim::Trading,
        UntrustedCredentialAudienceClaim::PrivateEffect,
    ] {
        let owner = TestOnlyInMemorySourceBindingOwner::default();
        let mut value = proposal();
        value.credential_handle = UntrustedOpaqueCredentialHandle::from_untrusted_identity(
            d(6),
            audience,
            read_only_capabilities(),
        );
        refresh_claims(&mut value);
        assert_eq!(
            owner.commit_initial(value, decision([]), &commit_clock()),
            Err(SourceBindingError::InvalidCredentialAudience)
        );
        assert_eq!(owner.commit_count(), 0);
    }
}

#[rstest]
fn forbidden_or_missing_credential_capability_is_rejected_without_write() {
    for capabilities in [
        BTreeSet::new(),
        [UntrustedCredentialCapabilityClaim::AccountRead]
            .into_iter()
            .collect(),
        [UntrustedCredentialCapabilityClaim::OrderReadOrWrite]
            .into_iter()
            .collect(),
        [UntrustedCredentialCapabilityClaim::Trading]
            .into_iter()
            .collect(),
        [UntrustedCredentialCapabilityClaim::PrivateEffect]
            .into_iter()
            .collect(),
    ] {
        let owner = TestOnlyInMemorySourceBindingOwner::default();
        let mut value = proposal();
        value.credential_handle = UntrustedOpaqueCredentialHandle::from_untrusted_identity(
            d(6),
            UntrustedCredentialAudienceClaim::MarketData,
            capabilities,
        );
        refresh_claims(&mut value);
        assert_eq!(
            owner.commit_initial(value, decision([]), &commit_clock()),
            Err(SourceBindingError::ForbiddenCredentialCapability)
        );
        assert_eq!(owner.commit_count(), 0);
    }
}

#[rstest]
fn raw_credential_material_is_discarded_and_rejected_without_write() {
    let owner = TestOnlyInMemorySourceBindingOwner::default();
    let mut value = proposal();
    value.credential_handle = UntrustedOpaqueCredentialHandle::from_untrusted_raw_material(
        SECRET_SENTINEL,
        UntrustedCredentialAudienceClaim::MarketData,
        read_only_capabilities(),
    );
    refresh_claims(&mut value);
    assert!(!format!("{:?}", value.credential_handle).contains(SECRET_SENTINEL));
    assert_eq!(
        owner.commit_initial(value, decision([]), &commit_clock()),
        Err(SourceBindingError::RawCredentialMaterial)
    );
    assert_eq!(owner.commit_count(), 0);
}

#[rstest]
fn every_semantic_field_changes_owner_derived_binding_identity() {
    let original = proposal();
    let expected = derive_binding_id(&original);
    let mut mutations: Vec<UntrustedSourceBindingProposal> = Vec::new();
    macro_rules! changed {
        ($body:expr) => {{
            let mut value = original.clone();
            $body(&mut value);
            refresh_claims(&mut value);
            mutations.push(value);
        }};
    }
    changed!(|v: &mut UntrustedSourceBindingProposal| v.schema_version = 2);
    changed!(|v: &mut UntrustedSourceBindingProposal| v.adapter.implementation_digest = d(9));
    changed!(|v: &mut UntrustedSourceBindingProposal| v.adapter.configuration_digest = d(9));
    changed!(|v: &mut UntrustedSourceBindingProposal| v
        .adapter
        .authenticated_endpoint_identity
        .push('x'));
    changed!(|v: &mut UntrustedSourceBindingProposal| v.adapter.dataset_mapping.push('x'));
    changed!(|v: &mut UntrustedSourceBindingProposal| v.adapter.account_mapping.push('x'));
    changed!(
        |v: &mut UntrustedSourceBindingProposal| v.credential_handle =
            UntrustedOpaqueCredentialHandle::from_untrusted_identity(
                d(9),
                UntrustedCredentialAudienceClaim::MarketData,
                read_only_capabilities(),
            )
    );
    changed!(
        |v: &mut UntrustedSourceBindingProposal| v.credential_handle =
            UntrustedOpaqueCredentialHandle::from_untrusted_identity(
                d(6),
                UntrustedCredentialAudienceClaim::Execution,
                read_only_capabilities(),
            )
    );
    changed!(
        |v: &mut UntrustedSourceBindingProposal| v.credential_handle =
            UntrustedOpaqueCredentialHandle::from_untrusted_identity(
                d(6),
                UntrustedCredentialAudienceClaim::MarketData,
                [UntrustedCredentialCapabilityClaim::MarketDataRead],
            )
    );
    changed!(|v: &mut UntrustedSourceBindingProposal| v.trust_policy.identity.push('x'));
    changed!(|v: &mut UntrustedSourceBindingProposal| v.trust_policy.version += 1);
    changed!(|v: &mut UntrustedSourceBindingProposal| v.semantics.normalization.push('x'));
    changed!(|v: &mut UntrustedSourceBindingProposal| v.semantics.adjustment.push('x'));
    changed!(|v: &mut UntrustedSourceBindingProposal| v.semantics.price_meaning.push('x'));
    changed!(|v: &mut UntrustedSourceBindingProposal| v.semantics.calendar_rules.push('x'));
    changed!(|v: &mut UntrustedSourceBindingProposal| v.semantics.session_rules.push('x'));
    changed!(|v: &mut UntrustedSourceBindingProposal| v.semantics.timezone_rules.push('x'));
    changed!(|v: &mut UntrustedSourceBindingProposal| v
        .semantics
        .instrument_lifecycle_rules
        .push('x'));
    changed!(|v: &mut UntrustedSourceBindingProposal| v.semantics.corporate_action_rules.push('x'));
    changed!(|v: &mut UntrustedSourceBindingProposal| v.semantics.membership_rules.push('x'));
    changed!(|v: &mut UntrustedSourceBindingProposal| v.semantics.universe_rules.push('x'));
    changed!(|v: &mut UntrustedSourceBindingProposal| v.semantics.correction_policy.push('x'));
    changed!(|v: &mut UntrustedSourceBindingProposal| v.license.use_scope.push('x'));
    changed!(|v: &mut UntrustedSourceBindingProposal| v.license.redistribution_scope.push('x'));
    changed!(|v: &mut UntrustedSourceBindingProposal| v.license.retention_policy.push('x'));
    changed!(|v: &mut UntrustedSourceBindingProposal| v.license.redaction_policy.push('x'));
    changed!(|v: &mut UntrustedSourceBindingProposal| v.source_frontier.stream_identity.push('x'));
    changed!(|v: &mut UntrustedSourceBindingProposal| v.source_frontier.cut_identity.push('x'));
    changed!(|v: &mut UntrustedSourceBindingProposal| v.source_frontier.sequence += 1);
    changed!(|v: &mut UntrustedSourceBindingProposal| v.source_frontier.digest = d(9));
    changed!(|v: &mut UntrustedSourceBindingProposal| v
        .correction_frontier
        .stream_identity
        .push('x'));
    changed!(|v: &mut UntrustedSourceBindingProposal| v.correction_frontier.cut_identity.push('x'));
    changed!(|v: &mut UntrustedSourceBindingProposal| v.correction_frontier.sequence += 1);
    changed!(|v: &mut UntrustedSourceBindingProposal| v.correction_frontier.digest = d(9));
    changed!(|v: &mut UntrustedSourceBindingProposal| v.time_evidence.clock_identity.push('x'));
    changed!(|v: &mut UntrustedSourceBindingProposal| v.time_evidence.clock_epoch.push('x'));
    changed!(|v: &mut UntrustedSourceBindingProposal| v.time_evidence.monotonic_sequence += 1);
    changed!(
        |v: &mut UntrustedSourceBindingProposal| v.time_evidence.restart_continuity_digest = d(9)
    );
    changed!(|v: &mut UntrustedSourceBindingProposal| v.time_evidence.skew_bound += 1);
    changed!(|v: &mut UntrustedSourceBindingProposal| v.time_evidence.uncertainty_bound += 1);
    changed!(|v: &mut UntrustedSourceBindingProposal| v.time_evidence.event_effective += 1);
    changed!(|v: &mut UntrustedSourceBindingProposal| v.time_evidence.provider_available += 1);
    changed!(|v: &mut UntrustedSourceBindingProposal| v.time_evidence.retrieval += 1);
    changed!(|v: &mut UntrustedSourceBindingProposal| v.time_evidence.correction_publication += 1);
    changed!(|v: &mut UntrustedSourceBindingProposal| v.time_evidence.observed_at += 1);
    changed!(|v: &mut UntrustedSourceBindingProposal| v.time_evidence.effective_at += 1);
    changed!(|v: &mut UntrustedSourceBindingProposal| v.time_evidence.valid_through += 1);
    assert_eq!(mutations.len(), 47);

    for mutation in mutations {
        assert_ne!(derive_binding_id(&mutation), expected);
    }
}

#[rstest]
fn canonical_binding_identity_has_a_golden_digest() {
    assert_eq!(
        derive_binding_id(&proposal()),
        BindingDigest::from_untrusted_bytes([
            34, 22, 209, 83, 214, 187, 172, 221, 64, 59, 191, 79, 42, 8, 226, 218, 187, 246, 52,
            216, 185, 32, 4, 152, 104, 164, 94, 84, 241, 160, 211, 56,
        ])
    );
}

#[rstest]
fn exact_and_concurrent_initial_replay_join_one_commit() {
    let owner = Arc::new(TestOnlyInMemorySourceBindingOwner::default());
    let barrier = Arc::new(Barrier::new(8));
    let mut workers = Vec::new();

    for _ in 0..8 {
        let owner = Arc::clone(&owner);
        let barrier = Arc::clone(&barrier);
        workers.push(thread::spawn(move || {
            barrier.wait();
            owner
                .commit_initial(proposal(), decision([]), &commit_clock())
                .expect("commit")
        }));
    }
    let commits: Vec<_> = workers
        .into_iter()
        .map(|worker| worker.join().expect("join"))
        .collect();
    assert!(commits.iter().all(|value| value == &commits[0]));
    assert_eq!(owner.commit_count(), 1);
}

#[rstest]
fn owner_locks_exactly_next_lineage_and_rejects_fabricated_or_old_heads() {
    let owner = TestOnlyInMemorySourceBindingOwner::default();
    let initial = owner
        .commit_initial(proposal(), decision([]), &commit_clock())
        .expect("initial");
    let successor = owner
        .commit_successor(
            initial.receipt().locator(),
            successor_proposal(),
            decision([]),
            &successor_clock(),
        )
        .expect("successor");
    assert_eq!(successor.fact().lineage_version(), 2);
    assert_eq!(successor.fact().lineage_root(), initial.fact().binding_id());
    assert_eq!(
        successor.fact().predecessor_binding_id(),
        Some(initial.fact().binding_id())
    );
    let mut competing = successor_proposal();
    competing.source_frontier.sequence += 1;
    competing.source_frontier.cut_identity.push('x');
    refresh_claims(&mut competing);
    assert_eq!(
        owner.commit_successor(
            initial.receipt().locator(),
            competing,
            decision([]),
            &successor_clock(),
        ),
        Err(SourceBindingError::LineageHeadMismatch)
    );
    let mut forged = initial.receipt().locator().clone();
    forged.fact_digest = d(9);
    assert_eq!(
        owner.commit_successor(
            &forged,
            successor_proposal(),
            decision([]),
            &successor_clock(),
        ),
        Err(SourceBindingError::LineageHeadMismatch)
    );
}

#[rstest]
fn source_successor_enforces_nondecreasing_frontiers_and_clock_time_monotonicity() {
    let mutations: [fn(&mut UntrustedSourceBindingProposal); 12] = [
        |value| value.source_frontier.sequence = 9,
        |value| value.source_frontier.sequence = 10,
        |value| value.source_frontier.cut_identity = "source-cut-10".into(),
        |value| value.source_frontier.digest = d(3),
        |value| value.correction_frontier.cut_identity.push('x'),
        |value| value.time_evidence.monotonic_sequence = 1,
        |value| value.time_evidence.event_effective = 9,
        |value| value.time_evidence.provider_available = 19,
        |value| {
            value.time_evidence.provider_available = 21;
            value.time_evidence.retrieval = 29;
            value.time_evidence.correction_publication = 26;
        },
        |value| value.time_evidence.correction_publication = 24,
        |value| value.time_evidence.restart_continuity_digest = d(8),
        |value| value.time_evidence.uncertainty_bound = 2,
    ];

    for (index, mutation) in mutations.into_iter().enumerate() {
        let owner = TestOnlyInMemorySourceBindingOwner::default();
        let initial = owner
            .commit_initial(proposal(), decision([]), &commit_clock())
            .expect("initial");
        let mut successor = successor_proposal();
        mutation(&mut successor);
        refresh_claims(&mut successor);
        let clock = clock_for(&successor);
        assert_eq!(
            owner.commit_successor(initial.receipt().locator(), successor, decision([]), &clock,),
            Err(SourceBindingError::SuccessorDoesNotAdvance),
            "mutation {index}"
        );
        assert_eq!(owner.commit_count(), 1);
        assert_eq!(owner.outbox_count(), 1);
    }

    for cut in [40, 39] {
        let owner = TestOnlyInMemorySourceBindingOwner::default();
        let initial = owner
            .commit_initial(proposal(), decision([]), &commit_clock())
            .expect("initial");
        let mut successor = successor_proposal();
        successor.time_evidence.provider_available = 20;
        successor.time_evidence.retrieval = 30;
        successor.time_evidence.correction_publication = 25;
        successor.time_evidence.observed_at = cut;
        successor.time_evidence.effective_at = cut;
        refresh_claims(&mut successor);
        let clock = clock_for(&successor);
        assert_eq!(
            owner.commit_successor(initial.receipt().locator(), successor, decision([]), &clock,),
            Err(SourceBindingError::SuccessorDoesNotAdvance)
        );
        assert_eq!(owner.commit_count(), 1);
        assert_eq!(owner.outbox_count(), 1);
    }
}

#[rstest]
fn source_successor_accepts_frontier_advance_and_validity_shrink_covering_new_cut() {
    let owner = TestOnlyInMemorySourceBindingOwner::default();
    let initial = owner
        .commit_initial(proposal(), decision([]), &commit_clock())
        .expect("initial");
    let mut successor = successor_proposal();
    successor.time_evidence.valid_through = 90;
    refresh_claims(&mut successor);
    let committed = owner
        .commit_successor(
            initial.receipt().locator(),
            successor.clone(),
            decision([]),
            &clock_for(&successor),
        )
        .expect("valid shrinking successor");
    assert_eq!(committed.fact().lineage_version(), 2);
    assert_eq!(owner.commit_count(), 2);
    assert_eq!(owner.outbox_count(), 2);
}

#[rstest]
fn response_loss_retry_recovers_initial_and_successor_commits() {
    let owner = TestOnlyInMemorySourceBindingOwner::default();
    assert_eq!(
        owner.commit_initial_with_fault(
            proposal(),
            decision([]),
            &commit_clock(),
            CommitFault::BeforeCommit,
        ),
        Err(SourceBindingError::CommitInterrupted)
    );
    assert_eq!(owner.commit_count(), 0);
    assert_eq!(
        owner.commit_initial_with_fault(
            proposal(),
            decision([]),
            &commit_clock(),
            CommitFault::ResponseLoss,
        ),
        Err(SourceBindingError::ResponseLost)
    );
    let initial = owner
        .commit_initial(proposal(), decision([]), &commit_clock())
        .expect("initial retry");
    assert_eq!(
        owner.commit_successor_with_fault(
            initial.receipt().locator(),
            successor_proposal(),
            decision([]),
            &successor_clock(),
            CommitFault::ResponseLoss,
        ),
        Err(SourceBindingError::ResponseLost)
    );
    let recovered = owner
        .commit_successor(
            initial.receipt().locator(),
            successor_proposal(),
            decision([]),
            &successor_clock(),
        )
        .expect("successor retry");
    assert_eq!(recovered.fact().lineage_version(), 2);
    assert_eq!(owner.commit_count(), 2);
}

#[rstest]
fn same_binding_identity_with_different_owner_decision_conflicts_without_write() {
    let owner = TestOnlyInMemorySourceBindingOwner::default();
    owner
        .commit_initial(proposal(), decision([]), &commit_clock())
        .expect("first");
    assert_eq!(
        owner.commit_initial(
            proposal(),
            decision([SourceBindingBlocker::SourceUnavailable]),
            &commit_clock(),
        ),
        Err(SourceBindingError::ReplayConflict)
    );
    assert_eq!(owner.commit_count(), 1);
}

#[rstest]
fn exact_cut_requires_all_availability_times_and_complete_clock_proof() {
    for mutation in [
        |v: &mut UntrustedSourceBindingProposal| v.time_evidence.provider_available = 41,
        |v: &mut UntrustedSourceBindingProposal| v.time_evidence.retrieval = 41,
        |v: &mut UntrustedSourceBindingProposal| v.time_evidence.correction_publication = 41,
        |v: &mut UntrustedSourceBindingProposal| v.time_evidence.correction_publication = 31,
        |v: &mut UntrustedSourceBindingProposal| v.time_evidence.observed_at = 39,
        |v: &mut UntrustedSourceBindingProposal| v.time_evidence.skew_bound = 0,
        |v: &mut UntrustedSourceBindingProposal| v.time_evidence.uncertainty_bound = 3,
        |v: &mut UntrustedSourceBindingProposal| v.time_evidence.restart_continuity_digest = d(0),
    ] {
        let mut value = proposal();
        mutation(&mut value);
        refresh_claims(&mut value);
        assert!(
            TestOnlyInMemorySourceBindingOwner::default()
                .commit_initial(value, decision([]), &commit_clock())
                .is_err()
        );
    }
}

#[rstest]
fn caller_cannot_choose_now_epoch_continuity_or_skew_for_commit_or_readback() {
    let value = proposal();
    let mutations: [fn(&mut MarketDataClockAdmission); 9] = [
        |clock| clock.clock_identity = "other-clock".into(),
        |clock| clock.clock_epoch = "other-epoch".into(),
        |clock| clock.monotonic_sequence = 2,
        |clock| clock.wall_observed = 41,
        |clock| clock.decision_cut = 39,
        |clock| clock.valid_through = 40,
        |clock| clock.restart_continuity_digest = d(8),
        |clock| clock.uncertainty_bound = 3,
        |clock| clock.skew_bound = 3,
    ];

    for mutation in mutations {
        let owner = TestOnlyInMemorySourceBindingOwner::default();
        let mut clock = commit_clock();
        mutation(&mut clock);
        assert!(
            owner
                .commit_initial(value.clone(), decision([]), &clock)
                .is_err()
        );
        assert_eq!(owner.commit_count(), 0);
    }
    let owner = TestOnlyInMemorySourceBindingOwner::default();
    let commit = owner
        .commit_initial(value, decision([]), &commit_clock())
        .expect("commit");
    assert!(
        owner
            .resolve(commit.receipt().locator(), &read_clock(99))
            .is_ok()
    );
    assert_eq!(
        owner.resolve(commit.receipt().locator(), &read_clock(100)),
        Err(SourceBindingError::TrustedClockMismatch)
    );
}

#[rstest]
fn locator_verifies_complete_lineage_frontiers_and_time_tuple() {
    let owner = TestOnlyInMemorySourceBindingOwner::default();
    let commit = owner
        .commit_initial(proposal(), decision([]), &commit_clock())
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
    changed!(|v: &mut UntrustedSourceBindingLocator| v.owner.push('x'));
    changed!(|v: &mut UntrustedSourceBindingLocator| v.lineage_root = d(9));
    changed!(|v: &mut UntrustedSourceBindingLocator| v.lineage_version += 1);
    changed!(|v: &mut UntrustedSourceBindingLocator| v.predecessor_binding_id = Some(d(9)));
    changed!(|v: &mut UntrustedSourceBindingLocator| v.predecessor_fact_digest = Some(d(9)));
    changed!(|v: &mut UntrustedSourceBindingLocator| v.binding_id = d(9));
    changed!(|v: &mut UntrustedSourceBindingLocator| v.fact_digest = d(9));
    changed!(|v: &mut UntrustedSourceBindingLocator| v.credential_handle_identity = d(9));
    changed!(
        |v: &mut UntrustedSourceBindingLocator| v.credential_audience =
            UntrustedCredentialAudienceClaim::Execution
    );
    changed!(|v: &mut UntrustedSourceBindingLocator| v
        .credential_capabilities
        .remove(&UntrustedCredentialCapabilityClaim::MetadataRead));
    changed!(|v: &mut UntrustedSourceBindingLocator| v.source_frontier.stream_identity.push('x'));
    changed!(|v: &mut UntrustedSourceBindingLocator| v.source_frontier.cut_identity.push('x'));
    changed!(|v: &mut UntrustedSourceBindingLocator| v.source_frontier.sequence += 1);
    changed!(|v: &mut UntrustedSourceBindingLocator| v.source_frontier.digest = d(9));
    changed!(|v: &mut UntrustedSourceBindingLocator| v
        .correction_frontier
        .stream_identity
        .push('x'));
    changed!(|v: &mut UntrustedSourceBindingLocator| v.correction_frontier.cut_identity.push('x'));
    changed!(|v: &mut UntrustedSourceBindingLocator| v.correction_frontier.sequence += 1);
    changed!(|v: &mut UntrustedSourceBindingLocator| v.correction_frontier.digest = d(9));
    changed!(|v: &mut UntrustedSourceBindingLocator| v.time_evidence.clock_identity.push('x'));
    changed!(|v: &mut UntrustedSourceBindingLocator| v.time_evidence.clock_epoch.push('x'));
    changed!(|v: &mut UntrustedSourceBindingLocator| v.time_evidence.monotonic_sequence += 1);
    changed!(
        |v: &mut UntrustedSourceBindingLocator| v.time_evidence.restart_continuity_digest = d(9)
    );
    changed!(|v: &mut UntrustedSourceBindingLocator| v.time_evidence.skew_bound += 1);
    changed!(|v: &mut UntrustedSourceBindingLocator| v.time_evidence.uncertainty_bound += 1);
    changed!(|v: &mut UntrustedSourceBindingLocator| v.time_evidence.event_effective += 1);
    changed!(|v: &mut UntrustedSourceBindingLocator| v.time_evidence.provider_available += 1);
    changed!(|v: &mut UntrustedSourceBindingLocator| v.time_evidence.retrieval += 1);
    changed!(|v: &mut UntrustedSourceBindingLocator| v.time_evidence.correction_publication += 1);
    changed!(|v: &mut UntrustedSourceBindingLocator| v.time_evidence.observed_at += 1);
    changed!(|v: &mut UntrustedSourceBindingLocator| v.time_evidence.effective_at += 1);
    changed!(|v: &mut UntrustedSourceBindingLocator| v.time_evidence.valid_through += 1);
    changed!(
        |v: &mut UntrustedSourceBindingLocator| v.time_evidence.claimed_evidence_identity = d(9)
    );
    assert_eq!(forged.len(), 32);

    for locator in forged {
        assert!(owner.resolve(&locator, &read_clock(90)).is_err());
    }
}

#[rstest]
fn canonical_ordering_is_independent_of_owner_blocker_insertion_order() {
    let left = TestOnlyInMemorySourceBindingOwner::default()
        .commit_initial(
            proposal(),
            decision([
                SourceBindingBlocker::SourceUnavailable,
                SourceBindingBlocker::RightsRevoked,
            ]),
            &commit_clock(),
        )
        .expect("left");
    let right = TestOnlyInMemorySourceBindingOwner::default()
        .commit_initial(
            proposal(),
            decision([
                SourceBindingBlocker::RightsRevoked,
                SourceBindingBlocker::SourceUnavailable,
            ]),
            &commit_clock(),
        )
        .expect("right");
    let primary_only = TestOnlyInMemorySourceBindingOwner::default()
        .commit_initial(
            proposal(),
            decision([SourceBindingBlocker::RightsRevoked]),
            &commit_clock(),
        )
        .expect("primary only");
    assert_eq!(left.fact().digest(), right.fact().digest());
    assert_eq!(
        left.receipt().outbox_digest(),
        right.receipt().outbox_digest()
    );
    assert_ne!(
        left.receipt().outbox_digest(),
        primary_only.receipt().outbox_digest()
    );
}

#[rstest]
fn capability_order_is_canonical_and_opaque_identity_is_redacted() {
    let mut left_proposal = proposal();
    left_proposal.credential_handle = UntrustedOpaqueCredentialHandle::from_untrusted_identity(
        d(6),
        UntrustedCredentialAudienceClaim::MarketData,
        [
            UntrustedCredentialCapabilityClaim::MetadataRead,
            UntrustedCredentialCapabilityClaim::MarketDataRead,
            UntrustedCredentialCapabilityClaim::ReferenceDataRead,
        ],
    );
    refresh_claims(&mut left_proposal);
    assert_eq!(
        derive_binding_id(&left_proposal),
        derive_binding_id(&proposal())
    );

    let owner = TestOnlyInMemorySourceBindingOwner::default();
    let commit = owner
        .commit_initial(left_proposal.clone(), decision([]), &commit_clock())
        .expect("commit");
    let outbox = owner
        .resolve_outbox(commit.receipt().locator(), &read_clock(90))
        .expect("outbox");
    let debug = format!(
        "{commit:?} {:?} {outbox:?}",
        left_proposal.credential_handle
    );
    assert!(!debug.contains(SECRET_SENTINEL));
    assert!(
        !outbox
            .payload()
            .windows(SECRET_SENTINEL.len())
            .any(|window| window == SECRET_SENTINEL.as_bytes())
    );
}

fn with_rule(
    mut value: UntrustedSourceBindingProposal,
    rule: UntrustedSourceAvailabilityRuleV1,
) -> UntrustedSourceBindingProposal {
    value.schema_version = 2;
    value.availability_rule = Some(rule);
    refresh_claims(&mut value);
    value
}

const fn after_close(
    lag_ns: u64,
    publishes_corrections: bool,
) -> UntrustedSourceAvailabilityRuleV1 {
    UntrustedSourceAvailabilityRuleV1 {
        visibility: UntrustedSourceVisibilityV1::AfterBarClose { lag_ns },
        publishes_corrections,
    }
}

/// Bindings minted before availability rules existed keep their identities: a schema-1 proposal
/// encodes nothing new. The digests are the ones main derived for these fixtures before rules were
/// added (captured on `6126709dd`).
#[rstest]
fn a_schema_one_binding_keeps_the_identity_it_had_before_rules() {
    let mut initial = proposal();
    refresh_claims(&mut initial);
    assert_eq!(
        derive_binding_id(&initial).as_bytes(),
        &[
            34, 22, 209, 83, 214, 187, 172, 221, 64, 59, 191, 79, 42, 8, 226, 218, 187, 246, 52,
            216, 185, 32, 4, 152, 104, 164, 94, 84, 241, 160, 211, 56
        ]
    );
    assert_eq!(
        derive_binding_id(&successor_proposal()).as_bytes(),
        &[
            187, 80, 237, 132, 157, 80, 19, 40, 55, 138, 59, 0, 139, 220, 0, 78, 51, 55, 204, 109,
            223, 140, 8, 2, 9, 170, 85, 161, 183, 222, 122, 77
        ]
    );
}

#[rstest]
fn a_rule_is_declared_by_schema_two_and_only_by_it() {
    let owner = TestOnlyInMemorySourceBindingOwner::default();
    let mut rule_under_one = proposal();
    rule_under_one.availability_rule = Some(after_close(1_000, false));
    refresh_claims(&mut rule_under_one);
    let mut none_under_two = proposal();
    none_under_two.schema_version = 2;
    refresh_claims(&mut none_under_two);

    for refused in [rule_under_one, none_under_two] {
        assert!(matches!(
            owner.commit_initial(refused, decision([]), &commit_clock()),
            Err(SourceBindingError::InvalidVersionOrSequence(
                "schema_version"
            ))
        ));
    }
    let admitted = owner
        .commit_initial(
            with_rule(proposal(), after_close(1_000, false)),
            decision([]),
            &commit_clock(),
        )
        .unwrap();
    assert_eq!(
        admitted.fact().availability_rule(),
        Some(&after_close(1_000, false))
    );
}

/// The binding identity states the rule, so two bindings that differ only in their rule are two
/// bindings; the rule's own digest ignores everything but the rule, so a successor that keeps it
/// keeps the digest.
#[rstest]
fn the_rule_enters_the_identity_and_its_digest_is_the_rule_alone() {
    let lagged = with_rule(proposal(), after_close(1_000, false));
    let rules = [
        after_close(1_000, false),
        after_close(1_001, false),
        after_close(1_000, true),
        UntrustedSourceAvailabilityRuleV1 {
            visibility: UntrustedSourceVisibilityV1::AtRetrieval,
            publishes_corrections: false,
        },
    ];
    let identities: BTreeSet<_> = rules
        .iter()
        .map(|rule| derive_binding_id(&with_rule(proposal(), rule.clone())))
        .collect();
    assert_eq!(identities.len(), rules.len());
    let digests: BTreeSet<_> = rules.iter().map(availability_rule_digest_v1).collect();
    assert_eq!(digests.len(), rules.len());
    assert!(!identities.contains(&derive_binding_id(&proposal())));

    let successor = with_rule(successor_proposal(), after_close(1_000, false));
    assert_ne!(derive_binding_id(&successor), derive_binding_id(&lagged));
    assert_eq!(
        availability_rule_digest_v1(successor.availability_rule.as_ref().unwrap()),
        availability_rule_digest_v1(lagged.availability_rule.as_ref().unwrap()),
    );
}

/// A stored schema-1 binding has no rule field; it reads back as declaring none, and serializes
/// back without the field, so every stored binding row decodes unchanged.
#[rstest]
fn a_stored_schema_one_binding_reads_back_without_a_rule() {
    let schema_one = proposal();
    let json = serde_json::to_value(&schema_one).unwrap();
    assert!(json.get("availability_rule").is_none());
    let decoded: UntrustedSourceBindingProposal = serde_json::from_value(json).unwrap();
    assert_eq!(decoded, schema_one);
    let schema_two = with_rule(proposal(), after_close(1_000, true));
    let round_trip: UntrustedSourceBindingProposal =
        serde_json::from_value(serde_json::to_value(&schema_two).unwrap()).unwrap();
    assert_eq!(round_trip, schema_two);
}

const fn fixed(step: u32, unit: UntrustedSourceBarUnitV1) -> UntrustedSourceBarCadenceV1 {
    UntrustedSourceBarCadenceV1::FixedInterval { step, unit }
}

fn bar(
    row_timeframe: &str,
    cadence: UntrustedSourceBarCadenceV1,
    anchor: UntrustedSourceBarAnchorV1,
    clock: UntrustedSourceBarClockV1,
) -> UntrustedSourceBarTimeframeV1 {
    UntrustedSourceBarTimeframeV1 {
        row_timeframe: row_timeframe.to_owned(),
        cadence,
        anchor,
        clock,
        label: UntrustedSourceBarLabelV1::IntervalClose,
        completion: UntrustedSourceBarCompletionV1::CompleteOnly,
    }
}

/// A Binance USD-M perpetual's `1d` klines: 24 hours from the Unix epoch on a continuous clock.
fn utc_day() -> UntrustedSourceBarTimeframeV1 {
    bar(
        "1D",
        fixed(24, UntrustedSourceBarUnitV1::Hour),
        UntrustedSourceBarAnchorV1::UnixEpoch,
        UntrustedSourceBarClockV1::Continuous,
    )
}

fn session_minute() -> UntrustedSourceBarTimeframeV1 {
    bar(
        "1M",
        fixed(1, UntrustedSourceBarUnitV1::Minute),
        UntrustedSourceBarAnchorV1::SessionOpen,
        UntrustedSourceBarClockV1::ScheduleBounded,
    )
}

fn declaring(
    mut value: UntrustedSourceBindingProposal,
    bars: Vec<UntrustedSourceBarTimeframeV1>,
) -> UntrustedSourceBindingProposal {
    value.bar_timeframes = bars;
    refresh_claims(&mut value);
    value
}

/// Only schema 2 declares bars, and only the three combinations a schedule can state, each label
/// once and in order. Every other declaration is refused by name.
#[rstest]
fn bars_are_declared_by_schema_two_in_the_combinations_a_schedule_states() {
    let owner = TestOnlyInMemorySourceBindingOwner::default();
    let under_schema_one = declaring(proposal(), vec![utc_day()]);
    assert!(matches!(
        owner.commit_initial(under_schema_one, decision([]), &commit_clock()),
        Err(SourceBindingError::InvalidVersionOrSequence(
            "schema_version"
        ))
    ));

    let unsupported = [
        vec![bar(
            "1M",
            fixed(0, UntrustedSourceBarUnitV1::Minute),
            UntrustedSourceBarAnchorV1::UnixEpoch,
            UntrustedSourceBarClockV1::Continuous,
        )],
        vec![bar(
            "1D",
            fixed(24, UntrustedSourceBarUnitV1::Hour),
            UntrustedSourceBarAnchorV1::UnixEpoch,
            UntrustedSourceBarClockV1::ScheduleBounded,
        )],
        vec![bar(
            "1M",
            fixed(1, UntrustedSourceBarUnitV1::Minute),
            UntrustedSourceBarAnchorV1::SessionOpen,
            UntrustedSourceBarClockV1::Continuous,
        )],
        vec![bar(
            "1D",
            UntrustedSourceBarCadenceV1::ExchangeSessionDay,
            UntrustedSourceBarAnchorV1::SessionOpen,
            UntrustedSourceBarClockV1::Continuous,
        )],
        vec![bar(
            "1D",
            UntrustedSourceBarCadenceV1::ExchangeSessionDay,
            UntrustedSourceBarAnchorV1::UnixEpoch,
            UntrustedSourceBarClockV1::ScheduleBounded,
        )],
        vec![UntrustedSourceBarTimeframeV1 {
            row_timeframe: "1d".to_owned(),
            ..utc_day()
        }],
        vec![UntrustedSourceBarTimeframeV1 {
            row_timeframe: "TICK".to_owned(),
            ..utc_day()
        }],
        vec![UntrustedSourceBarTimeframeV1 {
            row_timeframe: "01D".to_owned(),
            ..utc_day()
        }],
        vec![session_minute(), utc_day()],
        vec![utc_day(), utc_day()],
    ];

    for bars in unsupported {
        let refused = declaring(with_rule(proposal(), after_close(0, false)), bars.clone());
        assert!(
            matches!(
                owner.commit_initial(refused, decision([]), &commit_clock()),
                Err(SourceBindingError::UnsupportedBarTimeframe)
            ),
            "{bars:?} is refused by name"
        );
    }

    let admitted_bars = vec![
        utc_day(),
        bar(
            "1H",
            fixed(1, UntrustedSourceBarUnitV1::Hour),
            UntrustedSourceBarAnchorV1::SessionOpen,
            UntrustedSourceBarClockV1::ScheduleBounded,
        ),
        session_minute(),
    ];
    let admitted = owner
        .commit_initial(
            declaring(
                with_rule(proposal(), after_close(0, false)),
                admitted_bars.clone(),
            ),
            decision([]),
            &commit_clock(),
        )
        .unwrap();
    assert_eq!(admitted.fact().bar_timeframes(), admitted_bars.as_slice());
    let session_day = declaring(
        with_rule(proposal(), after_close(0, false)),
        vec![bar(
            "1D",
            UntrustedSourceBarCadenceV1::ExchangeSessionDay,
            UntrustedSourceBarAnchorV1::SessionOpen,
            UntrustedSourceBarClockV1::ScheduleBounded,
        )],
    );
    assert!(
        TestOnlyInMemorySourceBindingOwner::default()
            .commit_initial(session_day, decision([]), &commit_clock())
            .is_ok(),
        "an exchange session day is the third admitted combination"
    );
}

/// Every declared field is part of what the binding is: a binding that declares its bars
/// differently in any field, or declares none, is another binding.
#[rstest]
fn each_declared_field_enters_the_binding_identity() {
    let schema_two = with_rule(proposal(), after_close(0, false));
    let declarations = [
        vec![],
        vec![utc_day()],
        vec![UntrustedSourceBarTimeframeV1 {
            row_timeframe: "24H".to_owned(),
            ..utc_day()
        }],
        vec![UntrustedSourceBarTimeframeV1 {
            cadence: fixed(1440, UntrustedSourceBarUnitV1::Minute),
            ..utc_day()
        }],
        vec![UntrustedSourceBarTimeframeV1 {
            cadence: fixed(24, UntrustedSourceBarUnitV1::Second),
            ..utc_day()
        }],
        vec![UntrustedSourceBarTimeframeV1 {
            anchor: UntrustedSourceBarAnchorV1::SessionOpen,
            clock: UntrustedSourceBarClockV1::ScheduleBounded,
            ..utc_day()
        }],
        vec![UntrustedSourceBarTimeframeV1 {
            label: UntrustedSourceBarLabelV1::IntervalOpen,
            ..utc_day()
        }],
        vec![utc_day(), session_minute()],
    ];
    let identities: BTreeSet<_> = declarations
        .iter()
        .map(|bars| derive_binding_id(&declaring(schema_two.clone(), bars.clone())))
        .collect();
    assert_eq!(identities.len(), declarations.len());
}

/// Declarations are stored with the binding and read back as declared; a binding that declares
/// none carries no field, so every stored row decodes unchanged.
#[rstest]
fn declared_bars_round_trip_and_an_undeclared_binding_carries_no_field() {
    let undeclared = with_rule(proposal(), after_close(0, false));
    let json = serde_json::to_value(&undeclared).unwrap();
    assert!(json.get("bar_timeframes").is_none());

    let declared = declaring(undeclared, vec![utc_day(), session_minute()]);
    let round_trip: UntrustedSourceBindingProposal =
        serde_json::from_value(serde_json::to_value(&declared).unwrap()).unwrap();
    assert_eq!(round_trip, declared);
}

/// A coordinate the Owner's cut has not reached is early, not malformed: it is refused under its
/// own name, while the same coordinates out of order among themselves are malformed.
#[rstest]
#[case::retrieval_after_the_cut(
    |time: &mut UntrustedMarketDataAsOf| time.retrieval = 41,
    SourceBindingError::TimeEvidenceAfterDecisionCut
)]
#[case::provider_after_retrieval(
    |time: &mut UntrustedMarketDataAsOf| time.provider_available = 31,
    SourceBindingError::InvalidTimeEvidence
)]
#[case::correction_after_retrieval(
    |time: &mut UntrustedMarketDataAsOf| time.correction_publication = 31,
    SourceBindingError::InvalidTimeEvidence
)]
#[case::zero_event(
    |time: &mut UntrustedMarketDataAsOf| time.event_effective = 0,
    SourceBindingError::InvalidTimeEvidence
)]
fn time_evidence_the_cut_has_not_reached_is_named_apart_from_malformed_evidence(
    #[case] edit: fn(&mut UntrustedMarketDataAsOf),
    #[case] expected: SourceBindingError,
) {
    let owner = TestOnlyInMemorySourceBindingOwner::default();
    let mut refused = proposal();
    edit(&mut refused.time_evidence);
    refresh_claims(&mut refused);
    assert!(
        matches!(
            owner.commit_initial(refused, decision([]), &commit_clock()),
            Err(e) if e == expected
        ),
        "{expected:?}"
    );
    assert!(
        owner
            .commit_initial(proposal(), decision([]), &commit_clock())
            .is_ok(),
        "the unedited proposal is admitted at the same cut"
    );
}
