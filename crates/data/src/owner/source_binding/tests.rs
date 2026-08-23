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
    UntrustedMarketSemantics, UntrustedOpaqueCredentialHandle, UntrustedSourceBindingLocator,
    UntrustedSourceBindingProposal, UntrustedTrustPolicy,
    authority::{
        CommitFault, OwnerSourceBindingDecision, SourceBindingDisposition,
        TestOnlyInMemorySourceBindingOwner, derive_binding_id, derive_time_evidence_identity,
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
