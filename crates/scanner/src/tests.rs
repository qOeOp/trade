use std::collections::{BTreeMap, BTreeSet};
use std::sync::{Arc, Barrier, Mutex};
use std::thread;

use crate::*;
use rstest::rstest;

fn id(value: &str) -> OpaqueId {
    OpaqueId::new(value).unwrap()
}

fn version(value: u64) -> Version {
    Version::new(value).unwrap()
}

fn governed_artifact(name: &str) -> GovernedArtifactRef {
    GovernedArtifactRef::new(id(&format!("artifact-{name}")), version(4))
}

fn activation_condition(name: &str) -> ActivationConditionContract {
    ActivationConditionContract::new(id(&format!("condition-{name}")), version(2))
}

fn data_requirement(name: &str) -> DataRequirementContract {
    DataRequirementContract::new(id(&format!("data-{name}")), version(3))
}

fn lifecycle_constraints(name: &str) -> LifecycleConstraints {
    LifecycleConstraints::new(id(&format!("lifecycle-{name}")), version(5))
}

fn universe_requirement(name: &str) -> UniverseSelectionRequirement {
    UniverseSelectionRequirement::new(id(&format!("universe-{name}")), version(6))
}

fn capacity_requirement(name: &str) -> CapacityRequirement {
    CapacityRequirement::new(
        CapacityRequirementContract::new(id(&format!("capacity-contract-{name}")), version(7)),
        CandidateIndependentCapacityScope::new(id(&format!("capacity-scope-{name}"))),
    )
}

fn schedule() -> ScheduleDefinition {
    ScheduleDefinition {
        definition: VersionedIdentity {
            identity: id("daily-scan"),
            version: version(3),
        },
        scan_scope: VersionedIdentity {
            identity: id("global-scope"),
            version: version(7),
        },
        cadence: id("0 30 1 * * *"),
        calendar_time_zone: id("America/New_York"),
        fold_disposition: FoldDisposition::Both,
        gap_disposition: GapDisposition::ShiftForward,
        misfire_policy: MisfirePolicy::FireOnce,
        shared_clock: id("scheduler-clock"),
        effective_interval: id("2026-h2"),
    }
}

fn local(month: u8, day: u8, hour: u8, minute: u8) -> LocalDateTime {
    LocalDateTime::new(2026, month, day, hour, minute, 0).unwrap()
}

fn candidate() -> DueSlotCandidate {
    DueSlotCandidate::Normal {
        local: local(8, 20, 1, 30),
        utc_offset_seconds: -14_400,
    }
}

fn clock(epoch: u64) -> ClockAdmission {
    ClockAdmission::Admitted {
        epoch,
        evidence: id(&format!("clock-cut-{epoch}")),
        observed_at: UnixTimestamp::new(1_787_203_800),
    }
}

fn policy() -> SnapshotAdmissionPolicy {
    policy_version(1)
}

fn policy_version(policy_version: u64) -> SnapshotAdmissionPolicy {
    SnapshotAdmissionPolicy::new(
        VersionedIdentity {
            identity: id("scanner-admission-policy"),
            version: version(policy_version),
        },
        OwnerSource::new(
            SourceOwner::new(id("market-data-owner")),
            SourceNode::new(id("market-data-node")),
        ),
        OwnerSource::new(
            SourceOwner::new(id("portfolio-owner")),
            SourceNode::new(id("portfolio-node")),
        ),
        FrontierRequirement::new(FrontierLineage::new(id("market-frontier")), 10),
        FrontierRequirement::new(FrontierLineage::new(id("capacity-frontier")), 20),
        SemanticScope::new(id("global-market-scope")),
        CompatibilityCut::new(id("semantics-compatible-v1")),
    )
}

fn binding(name: &str) -> StrategyBinding {
    StrategyBinding::new(
        id(name),
        governed_artifact(name),
        activation_condition(name),
        data_requirement(name),
        lifecycle_constraints(name),
        universe_requirement(name),
        None,
    )
}

fn binding_with_capacity(name: &str) -> StrategyBinding {
    StrategyBinding::new(
        id(name),
        governed_artifact(name),
        activation_condition(name),
        data_requirement(name),
        lifecycle_constraints(name),
        universe_requirement(name),
        Some(capacity_requirement(name)),
    )
}

fn owner_fact(kind: &str, capacity: bool) -> UntrustedOwnerFactRefV1 {
    UntrustedOwnerFactRefV1 {
        source: if capacity {
            OwnerSource::new(
                SourceOwner::new(id("portfolio-owner")),
                SourceNode::new(id("portfolio-node")),
            )
        } else {
            OwnerSource::new(
                SourceOwner::new(id("market-data-owner")),
                SourceNode::new(id("market-data-node")),
            )
        },
        record_identity: RecordIdentity::new(id(&format!("record-{kind}"))),
        content_digest: ContentDigest::new(id(&format!("digest-{kind}"))),
        source_frontier: Some(SourceFrontier::new(
            FrontierLineage::new(id(if capacity {
                "capacity-frontier"
            } else {
                "market-frontier"
            })),
            if capacity { 20 } else { 10 },
        )),
        snapshot_cut: SnapshotCut::new(id(if capacity {
            "capacity-snapshot-cut"
        } else {
            "market-snapshot-cut"
        })),
        compatibility_cut: CompatibilityCut::new(id("semantics-compatible-v1")),
        semantic_scope: SemanticScope::new(id("global-market-scope")),
        observed_at: UnixTimestamp::new(1_787_203_800),
        valid_through: UnixTimestamp::new(1_787_207_400),
        clock_epoch: 1,
        time_evidence: id("clock-cut-1"),
    }
}

fn market_readback(strategy: &StrategyBinding) -> UntrustedMarketFactReadback {
    UntrustedMarketFactReadback {
        data_requirement: Some(strategy.data_requirement().clone()),
        universe_selection_requirement: Some(strategy.universe_selection().clone()),
        pit_snapshot: Some(owner_fact("pit-snapshot", false)),
        universe_selection_record: Some(owner_fact("universe-record", false)),
        instrument_master: Some(owner_fact("instrument-master", false)),
        calendar_session_time_zone: Some(owner_fact("calendar-cut", false)),
        corporate_action: Some(owner_fact("corporate-action-cut", false)),
        historical_membership: Some(owner_fact("membership-cut", false)),
        market_semantics_compatibility: Some(owner_fact("market-semantics", false)),
        auxiliary: BTreeSet::from([id("market-auxiliary")]),
    }
}

fn capacity_readback(strategy: &StrategyBinding) -> UntrustedCapacityViewReadback {
    let required = strategy.capacity_requirement().unwrap();
    UntrustedCapacityViewReadback {
        requirement_contract: Some(required.contract().clone()),
        candidate_independent_scope: Some(required.candidate_independent_scope().clone()),
        account_facts: Some(owner_fact("account-facts", true)),
        liquidity: Some(owner_fact("liquidity-cut", true)),
        capital_pool_method: Some(CapitalPoolMethod::new(id("capital-method"), version(8))),
        capital_pool_assumptions: Some(CapitalPoolAssumptions::new(
            id("capital-assumptions"),
            version(9),
        )),
        measurement_time: Some(UnixTimestamp::new(1_787_203_800)),
        valid_through: Some(UnixTimestamp::new(1_787_207_400)),
        compatible_market_snapshot_cut: Some(SnapshotCut::new(id("market-snapshot-cut"))),
        auxiliary: BTreeSet::from([id("capacity-auxiliary")]),
    }
}

fn snapshot_readback(strategy: &StrategyBinding) -> UntrustedSnapshotReadback {
    UntrustedSnapshotReadback {
        market_fact_cut: market_readback(strategy),
        capacity_view_cut: strategy
            .capacity_requirement()
            .map(|_| capacity_readback(strategy)),
        auxiliary: EvidenceSet::singleton(id("snapshot-readback")),
    }
}

#[derive(Clone)]
enum LoaderResult {
    Resolved(StrategyFrontier),
    Unresolved(MembershipUnavailable),
}

#[derive(Clone)]
struct FixtureLoader(LoaderResult);

impl StrategyLoader for FixtureLoader {
    fn load(&self, _: &DueSlot) -> Result<StrategyFrontier, MembershipUnavailable> {
        match &self.0 {
            LoaderResult::Resolved(frontier) => Ok(frontier.clone()),
            LoaderResult::Unresolved(unavailable) => Err(unavailable.clone()),
        }
    }
}

#[derive(Clone, Default)]
struct FixtureSnapshots {
    override_snapshot: Option<UntrustedSnapshotReadback>,
}

impl MarketSnapshot for FixtureSnapshots {
    fn snapshot(
        &self,
        due_slot: &DueSlot,
        strategy: &StrategyBinding,
    ) -> Result<UntrustedSnapshotReadback, InputUnavailable> {
        if let Some(snapshot) = &self.override_snapshot {
            return Ok(snapshot.clone());
        }
        let mut readback = UntrustedSnapshotReadback {
            market_fact_cut: market_readback(strategy),
            capacity_view_cut: strategy
                .capacity_requirement()
                .map(|_| capacity_readback(strategy)),
            auxiliary: EvidenceSet::singleton(id(&format!(
                "snapshot-{}",
                strategy.strategy().as_str()
            ))),
        };
        let market = &mut readback.market_fact_cut;
        for fact in [
            &mut market.pit_snapshot,
            &mut market.universe_selection_record,
            &mut market.instrument_master,
            &mut market.calendar_session_time_zone,
            &mut market.corporate_action,
            &mut market.historical_membership,
            &mut market.market_semantics_compatibility,
        ] {
            let fact = fact.as_mut().unwrap();
            fact.clock_epoch = due_slot.clock_epoch();
            fact.time_evidence = due_slot.time_evidence().clone();
        }

        if let Some(capacity) = &mut readback.capacity_view_cut {
            for fact in [&mut capacity.account_facts, &mut capacity.liquidity] {
                let fact = fact.as_mut().unwrap();
                fact.clock_epoch = due_slot.clock_epoch();
                fact.time_evidence = due_slot.time_evidence().clone();
            }
        }
        Ok(readback)
    }
}

#[derive(Clone, Copy)]
enum Evaluation {
    Matched,
    NoMatch,
    Insufficient,
    ConditionFailed,
}

#[derive(Clone)]
struct FixtureMatcher {
    evaluations: Arc<BTreeMap<String, Evaluation>>,
    calls: Arc<Mutex<usize>>,
    barrier: Option<Arc<Barrier>>,
}

impl StrategyMatcher for FixtureMatcher {
    #[allow(
        clippy::panic_in_result_fn,
        reason = "fixture assertions verify the Scanner supplied the sealed cuts before returning its configured result"
    )]
    fn evaluate(
        &self,
        strategy: &StrategyBinding,
        snapshot: &SnapshotEvidence,
    ) -> Result<MatchEvaluation, ConditionFailure> {
        assert_eq!(
            snapshot.market_fact_cut().data_requirement(),
            strategy.data_requirement()
        );

        if strategy.capacity_requirement().is_some() {
            assert!(snapshot.capacity_view_cut().is_some());
        }
        *self.calls.lock().unwrap() += 1;

        if let Some(barrier) = &self.barrier {
            barrier.wait();
        }
        let evidence =
            EvidenceSet::singleton(id(&format!("match-{}", strategy.strategy().as_str())));
        match self.evaluations[strategy.strategy().as_str()] {
            Evaluation::Matched => Ok(MatchEvaluation::Matched { evidence }),
            Evaluation::NoMatch => Ok(MatchEvaluation::NoMatch { evidence }),
            Evaluation::Insufficient => Ok(MatchEvaluation::InsufficientData { evidence }),
            Evaluation::ConditionFailed => Err(ConditionFailure { evidence }),
        }
    }
}

#[derive(Clone)]
struct FixtureProposalBuilder {
    failure: Option<BatchOperationalFailure>,
    calls: Arc<Mutex<usize>>,
}

impl ProposalBuilder for FixtureProposalBuilder {
    #[allow(
        clippy::panic_in_result_fn,
        reason = "fixture assertion guards the proposal-builder call contract"
    )]
    fn build(
        &self,
        matched: &[StrategyDisposition],
    ) -> Result<ProposalEvidence, BatchOperationalFailure> {
        assert!(!matched.is_empty());
        *self.calls.lock().unwrap() += 1;

        if let Some(failure) = &self.failure {
            return Err(failure.clone());
        }
        Ok(ProposalEvidence {
            proposal_identity: id("proposal-1"),
            evidence_cut: id("proposal-evidence-1"),
        })
    }
}

#[derive(Clone, Default)]
struct MemoryReceiptStore(Arc<Mutex<BTreeMap<AttemptId, ScannerReceipt>>>);

impl MemoryReceiptStore {
    fn len(&self) -> usize {
        self.0.lock().unwrap().len()
    }
}

impl TerminalReceiptStore for MemoryReceiptStore {
    async fn find(
        &self,
        attempt_id: &AttemptId,
    ) -> Result<Option<ScannerReceipt>, ReceiptStoreError> {
        Ok(self.0.lock().unwrap().get(attempt_id).cloned())
    }

    async fn commit_or_join(
        &self,
        receipt: ScannerReceipt,
    ) -> Result<CommitOutcome, ReceiptStoreError> {
        let mut receipts = self.0.lock().unwrap();
        if let Some(existing) = receipts.get(receipt.attempt_id()) {
            if existing.meaning() != receipt.meaning() {
                return Err(ReceiptStoreError::SemanticConflict {
                    attempt_id: receipt.attempt_id().clone(),
                });
            }
            return Ok(CommitOutcome {
                kind: CommitKind::Joined,
                receipt: existing.clone(),
            });
        }
        receipts.insert(receipt.attempt_id().clone(), receipt.clone());
        Ok(CommitOutcome {
            kind: CommitKind::Committed,
            receipt,
        })
    }
}

fn frontier(names: &[&str]) -> StrategyFrontier {
    StrategyFrontier::new(id("registry-v9"), names.iter().map(|name| binding(name))).unwrap()
}

fn frontier_with(strategies: impl IntoIterator<Item = StrategyBinding>) -> StrategyFrontier {
    StrategyFrontier::new(id("registry-v9"), strategies).unwrap()
}

fn matcher(
    evaluations: &[(&str, Evaluation)],
    barrier: Option<Arc<Barrier>>,
) -> (FixtureMatcher, Arc<Mutex<usize>>) {
    let calls = Arc::new(Mutex::new(0));
    (
        FixtureMatcher {
            evaluations: Arc::new(
                evaluations
                    .iter()
                    .map(|(name, evaluation)| ((*name).to_owned(), *evaluation))
                    .collect(),
            ),
            calls: Arc::clone(&calls),
            barrier,
        },
        calls,
    )
}

fn builder(
    failure: Option<BatchOperationalFailure>,
) -> (FixtureProposalBuilder, Arc<Mutex<usize>>) {
    let calls = Arc::new(Mutex::new(0));
    (
        FixtureProposalBuilder {
            failure,
            calls: Arc::clone(&calls),
        },
        calls,
    )
}

fn terminal(outcome: ScanOutcome) -> CommitOutcome {
    match outcome {
        ScanOutcome::Terminal(outcome) => *outcome,
        ScanOutcome::Skipped => panic!("expected terminal receipt"),
    }
}

async fn terminal_receipt(
    loader: LoaderResult,
    evaluations: &[(&str, Evaluation)],
    failure: Option<BatchOperationalFailure>,
) -> ScannerReceipt {
    let store = MemoryReceiptStore::default();
    let (matcher, _) = matcher(evaluations, None);
    let (proposal_builder, _) = builder(failure);
    let scanner = Scanner::new_with_source_owner_fixture(
        FixtureLoader(loader),
        FixtureSnapshots::default(),
        matcher,
        proposal_builder,
        store,
        policy(),
    );
    terminal(
        scanner
            .scan(&schedule(), candidate(), Delivery::OnTime, clock(1))
            .await
            .unwrap(),
    )
    .receipt
}

async fn scan_with_snapshot(
    strategy: StrategyBinding,
    snapshot: UntrustedSnapshotReadback,
) -> (ScannerReceipt, Arc<Mutex<usize>>) {
    scan_with_snapshot_and_clock(strategy, snapshot, clock(1)).await
}

async fn scan_with_snapshot_and_clock(
    strategy: StrategyBinding,
    snapshot: UntrustedSnapshotReadback,
    clock_admission: ClockAdmission,
) -> (ScannerReceipt, Arc<Mutex<usize>>) {
    let strategy_name = strategy.strategy().as_str().to_owned();
    let (matcher, calls) = matcher(&[(&strategy_name, Evaluation::Matched)], None);
    let (proposal_builder, _) = builder(None);
    let receipt = terminal(
        Scanner::new_with_source_owner_fixture(
            FixtureLoader(LoaderResult::Resolved(frontier_with([strategy]))),
            FixtureSnapshots {
                override_snapshot: Some(snapshot),
            },
            matcher,
            proposal_builder,
            MemoryReceiptStore::default(),
            policy(),
        )
        .scan(&schedule(), candidate(), Delivery::OnTime, clock_admission)
        .await
        .unwrap(),
    )
    .receipt;
    (receipt, calls)
}

#[rstest]
fn clock_epoch_and_misfire_delivery_do_not_change_attempt_identity() {
    let schedule = schedule();
    let on_time = schedule
        .resolve_due_slot(candidate(), Delivery::OnTime, clock(1))
        .unwrap()
        .unwrap();
    let restarted = schedule
        .resolve_due_slot(
            candidate(),
            Delivery::Misfired {
                observed_at_unix_seconds: 1_800_000_000,
            },
            clock(99),
        )
        .unwrap()
        .unwrap();
    assert_eq!(on_time.attempt_id, restarted.attempt_id);
    assert_ne!(on_time.clock_admission, restarted.clock_admission);
    assert_eq!(on_time.due_at(), UnixTimestamp::new(1_787_203_800));

    let mut skip = schedule.clone();
    skip.misfire_policy = MisfirePolicy::Skip;
    assert!(
        skip.resolve_due_slot(
            candidate(),
            Delivery::Misfired {
                observed_at_unix_seconds: 1_800_000_000
            },
            clock(2)
        )
        .unwrap()
        .is_none()
    );

    let mut backfill = schedule;
    backfill.misfire_policy = MisfirePolicy::Backfill;
    let backfilled = backfill
        .resolve_due_slot(
            candidate(),
            Delivery::Misfired {
                observed_at_unix_seconds: 1_900_000_000,
            },
            clock(3),
        )
        .unwrap()
        .unwrap();
    assert_eq!(on_time.attempt_id, backfilled.attempt_id);
}

#[rstest]
fn dst_fold_and_gap_rules_are_canonical_and_fail_closed() {
    let schedule = schedule();
    let fold_local = local(11, 1, 1, 30);
    let first = schedule
        .resolve_due_slot(
            DueSlotCandidate::Fold {
                local: fold_local,
                occurrence: FoldOccurrence::First,
                utc_offset_seconds: -14_400,
            },
            Delivery::OnTime,
            clock(1),
        )
        .unwrap()
        .unwrap();
    let second = schedule
        .resolve_due_slot(
            DueSlotCandidate::Fold {
                local: fold_local,
                occurrence: FoldOccurrence::Second,
                utc_offset_seconds: -18_000,
            },
            Delivery::OnTime,
            clock(1),
        )
        .unwrap()
        .unwrap();
    assert_ne!(first.attempt_id, second.attempt_id);
    assert_eq!(second.due_at().seconds() - first.due_at().seconds(), 3_600);

    let mut first_only = schedule.clone();
    first_only.fold_disposition = FoldDisposition::First;
    assert!(
        first_only
            .resolve_due_slot(
                DueSlotCandidate::Fold {
                    local: fold_local,
                    occurrence: FoldOccurrence::Second,
                    utc_offset_seconds: -18_000,
                },
                Delivery::OnTime,
                clock(1)
            )
            .unwrap()
            .is_none()
    );

    let gap = DueSlotCandidate::Gap {
        intended: local(3, 8, 2, 30),
        shifted_to: local(3, 8, 3, 30),
        utc_offset_seconds: -14_400,
    };
    let shifted = schedule
        .resolve_due_slot(gap.clone(), Delivery::OnTime, clock(1))
        .unwrap()
        .unwrap();
    assert!(matches!(
        shifted.attempt_id.boundary,
        DueSlotBoundary::GapShifted { .. }
    ));
    assert_eq!(shifted.due_at(), UnixTimestamp::new(1_772_955_000));
    let mut gap_skip = schedule;
    gap_skip.gap_disposition = GapDisposition::Skip;
    assert!(
        gap_skip
            .resolve_due_slot(gap, Delivery::OnTime, clock(1))
            .unwrap()
            .is_none()
    );
}

#[tokio::test]
async fn duplicate_and_restart_delivery_join_one_terminal_receipt() {
    let store = MemoryReceiptStore::default();
    let (matcher, matcher_calls) = matcher(&[("a", Evaluation::Matched)], None);
    let (builder, builder_calls) = builder(None);
    let make_scanner = || {
        Scanner::new_with_source_owner_fixture(
            FixtureLoader(LoaderResult::Resolved(frontier(&["a"]))),
            FixtureSnapshots::default(),
            matcher.clone(),
            builder.clone(),
            store.clone(),
            policy(),
        )
    };
    let first = terminal(
        make_scanner()
            .scan(&schedule(), candidate(), Delivery::OnTime, clock(1))
            .await
            .unwrap(),
    );
    let restarted = terminal(
        make_scanner()
            .scan(&schedule(), candidate(), Delivery::OnTime, clock(8))
            .await
            .unwrap(),
    );
    assert_eq!(first.kind, CommitKind::Committed);
    assert_eq!(restarted.kind, CommitKind::Joined);
    assert_eq!(first.receipt, restarted.receipt);
    assert_eq!(store.len(), 1);
    assert_eq!(*matcher_calls.lock().unwrap(), 1);
    assert_eq!(*builder_calls.lock().unwrap(), 1);
}

#[rstest]
fn concurrent_delivery_atomically_commits_once_and_joins_once() {
    let store = MemoryReceiptStore::default();
    let barrier = Arc::new(Barrier::new(2));
    let (matcher, _) = matcher(&[("a", Evaluation::Matched)], Some(barrier));
    let (proposal_builder, _) = builder(None);
    let scanner = Arc::new(Scanner::new_with_source_owner_fixture(
        FixtureLoader(LoaderResult::Resolved(frontier(&["a"]))),
        FixtureSnapshots::default(),
        matcher,
        proposal_builder,
        store.clone(),
        policy(),
    ));
    #[allow(
        clippy::needless_collect,
        reason = "all workers must be spawned before any join to exercise concurrent delivery"
    )]
    let handles = (0..2)
        .map(|epoch| {
            let scanner = Arc::clone(&scanner);

            thread::spawn(move || {
                // Two OS threads and one blocking `Barrier`, unchanged: the barrier sits in the
                // matcher, so both scans are provably in flight before either reaches the store.
                // Driving the async scan from a per-thread runtime keeps that structure exactly;
                // spawning two tasks on one runtime would let the scheduler put both on one worker
                // and deadlock the barrier, and a barrier that only one writer reaches proves
                // nothing about a race.
                let runtime = tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                    .expect("a current-thread runtime is available to each worker");
                terminal(
                    runtime
                        .block_on(scanner.scan(
                            &schedule(),
                            candidate(),
                            Delivery::OnTime,
                            clock(epoch + 1),
                        ))
                        .unwrap(),
                )
            })
        })
        .collect::<Vec<_>>();
    let outcomes = handles
        .into_iter()
        .map(|handle| handle.join().unwrap())
        .collect::<Vec<_>>();
    assert_eq!(
        outcomes
            .iter()
            .filter(|outcome| outcome.kind == CommitKind::Committed)
            .count(),
        1
    );
    assert_eq!(
        outcomes
            .iter()
            .filter(|outcome| outcome.kind == CommitKind::Joined)
            .count(),
        1
    );
    assert_eq!(outcomes[0].receipt, outcomes[1].receipt);
    assert_eq!(store.len(), 1);
}

#[tokio::test]
async fn same_attempt_with_changed_semantics_fails_closed() {
    let store = MemoryReceiptStore::default();
    let (matcher, _) = matcher(&[("a", Evaluation::NoMatch)], None);
    let (proposal_builder, _) = builder(None);
    let scanner = Scanner::new_with_source_owner_fixture(
        FixtureLoader(LoaderResult::Resolved(frontier(&["a"]))),
        FixtureSnapshots::default(),
        matcher,
        proposal_builder,
        store,
        policy(),
    );
    scanner
        .scan(&schedule(), candidate(), Delivery::OnTime, clock(1))
        .await
        .unwrap();
    let mut conflicting = schedule();
    conflicting.cadence = id("0 45 1 * * *");
    let error = scanner
        .scan(&conflicting, candidate(), Delivery::OnTime, clock(2))
        .await
        .unwrap_err();
    assert!(matches!(
        error,
        ScannerError::ReceiptStore(ReceiptStoreError::SemanticConflict { .. })
    ));
}

#[tokio::test]
async fn same_attempt_with_changed_admission_policy_fails_closed() {
    let store = MemoryReceiptStore::default();
    let (first_matcher, _) = matcher(&[("a", Evaluation::NoMatch)], None);
    let (first_builder, _) = builder(None);
    Scanner::new_with_source_owner_fixture(
        FixtureLoader(LoaderResult::Resolved(frontier(&["a"]))),
        FixtureSnapshots::default(),
        first_matcher,
        first_builder,
        store.clone(),
        policy_version(1),
    )
    .scan(&schedule(), candidate(), Delivery::OnTime, clock(1))
    .await
    .unwrap();

    let (second_matcher, _) = matcher(&[("a", Evaluation::NoMatch)], None);
    let (second_builder, _) = builder(None);
    let error = Scanner::new_with_source_owner_fixture(
        FixtureLoader(LoaderResult::Resolved(frontier(&["a"]))),
        FixtureSnapshots::default(),
        second_matcher,
        second_builder,
        store,
        policy_version(2),
    )
    .scan(&schedule(), candidate(), Delivery::OnTime, clock(1))
    .await
    .unwrap_err();
    assert!(matches!(
        error,
        ScannerError::ReceiptStore(ReceiptStoreError::SemanticConflict { .. })
    ));
}

#[tokio::test]
async fn mixed_strategy_outcomes_preserve_negative_members_and_valid_match() {
    let store = MemoryReceiptStore::default();
    let (matcher, _) = matcher(
        &[
            ("match", Evaluation::Matched),
            ("condition", Evaluation::ConditionFailed),
            ("insufficient", Evaluation::Insufficient),
        ],
        None,
    );
    let (proposal_builder, _) = builder(None);
    let receipt = terminal(
        Scanner::new_with_source_owner_fixture(
            FixtureLoader(LoaderResult::Resolved(frontier(&[
                "match",
                "condition",
                "insufficient",
            ]))),
            FixtureSnapshots::default(),
            matcher,
            proposal_builder,
            store,
            policy(),
        )
        .scan(&schedule(), candidate(), Delivery::OnTime, clock(1))
        .await
        .unwrap(),
    )
    .receipt;
    assert_eq!(receipt.status(), &ReceiptStatus::Proposed);
    assert_eq!(receipt.dispositions().len(), 3);
    assert_eq!(
        receipt.dispositions()[&id("condition")].outcome(),
        StrategyOutcome::ConditionFailed
    );
    assert_eq!(
        receipt.dispositions()[&id("insufficient")].outcome(),
        StrategyOutcome::InsufficientData
    );
    assert_eq!(
        receipt
            .proposal()
            .unwrap()
            .members()
            .keys()
            .cloned()
            .collect::<BTreeSet<_>>(),
        BTreeSet::from([id("match")]),
    );
}

#[tokio::test]
async fn complete_resolved_membership_is_enforced() {
    let (no_match, _) = matcher(
        &[("a", Evaluation::NoMatch), ("b", Evaluation::NoMatch)],
        None,
    );
    let (proposal_builder, _) = builder(None);
    let complete = terminal(
        Scanner::new_with_source_owner_fixture(
            FixtureLoader(LoaderResult::Resolved(frontier(&["a", "b"]))),
            FixtureSnapshots::default(),
            no_match,
            proposal_builder,
            MemoryReceiptStore::default(),
            policy(),
        )
        .scan(&schedule(), candidate(), Delivery::OnTime, clock(1))
        .await
        .unwrap(),
    )
    .receipt;
    assert!(matches!(
        complete.membership(),
        MembershipBranch::Resolved {
            expected,
            observed,
            missing,
        } if expected == observed && missing.is_empty() && expected.len() == 2
    ));
}

#[tokio::test]
async fn condition_failure_is_local_but_independent_operational_failure_wins() {
    let (condition_matcher, _) = matcher(
        &[
            ("a", Evaluation::ConditionFailed),
            ("b", Evaluation::NoMatch),
        ],
        None,
    );
    let (proposal_builder, _) = builder(None);
    let completed = terminal(
        Scanner::new_with_source_owner_fixture(
            FixtureLoader(LoaderResult::Resolved(frontier(&["a", "b"]))),
            FixtureSnapshots::default(),
            condition_matcher,
            proposal_builder,
            MemoryReceiptStore::default(),
            policy(),
        )
        .scan(&schedule(), candidate(), Delivery::OnTime, clock(1))
        .await
        .unwrap(),
    )
    .receipt;
    assert_eq!(completed.status(), &ReceiptStatus::CompletedNoProposal);

    let operational = BatchOperationalFailure {
        category: BatchFailureCategory::ScannerServiceFailure,
        failure_identity: id("proposal-builder-failure"),
        evidence_source_cut: id("service-log-cut"),
        time_evidence: id("time-cut"),
    };
    let (matched, _) = matcher(&[("a", Evaluation::Matched)], None);
    let (failing_builder, _) = builder(Some(operational.clone()));
    let failed = terminal(
        Scanner::new_with_source_owner_fixture(
            FixtureLoader(LoaderResult::Resolved(frontier(&["a"]))),
            FixtureSnapshots::default(),
            matched,
            failing_builder,
            MemoryReceiptStore::default(),
            policy(),
        )
        .scan(&schedule(), candidate(), Delivery::OnTime, clock(1))
        .await
        .unwrap(),
    )
    .receipt;
    assert_eq!(
        failed.status(),
        &ReceiptStatus::Failed(FailedReason::BatchOperational(operational))
    );
    assert!(failed.proposal().is_none());
}

#[tokio::test]
async fn unresolved_membership_never_invents_expected_or_missing_members() {
    let unavailable = MembershipUnavailable {
        disposition: id("registry-frontier-unresolved"),
        source_cut: id("governance-cut"),
        terminal_reason: id("membership-source-unavailable"),
        observed: vec![ObservedMemberFact::new(
            id("observed-a"),
            EvidenceSet::singleton(id("observed-fact")),
        )],
    };
    let (matcher, calls) = matcher(&[], None);
    let (builder, builder_calls) = builder(None);
    let receipt = terminal(
        Scanner::new_with_source_owner_fixture(
            FixtureLoader(LoaderResult::Unresolved(unavailable)),
            FixtureSnapshots::default(),
            matcher,
            builder,
            MemoryReceiptStore::default(),
            policy(),
        )
        .scan(&schedule(), candidate(), Delivery::OnTime, clock(1))
        .await
        .unwrap(),
    )
    .receipt;
    assert!(matches!(
        receipt.status(),
        ReceiptStatus::Failed(FailedReason::MembershipUnresolved { .. })
    ));
    assert!(matches!(
        receipt.membership(),
        MembershipBranch::Unresolved {
            observed,
            missing_members_unavailable: MissingMembersUnavailable,
            ..
        } if observed.keys().cloned().collect::<BTreeSet<_>>() == BTreeSet::from([id("observed-a")])
    ));
    assert!(receipt.proposal().is_none());
    assert_eq!(*calls.lock().unwrap(), 0);
    assert_eq!(*builder_calls.lock().unwrap(), 0);
}

#[tokio::test]
async fn every_named_market_fact_is_required_before_scanner_admission() {
    let strategy = binding("authority");
    macro_rules! assert_missing {
        ($field:ident, $expected:expr) => {{
            let mut readback = snapshot_readback(&strategy);
            readback.market_fact_cut.$field = None;
            let (receipt, calls) = scan_with_snapshot(strategy.clone(), readback).await;
            let disposition = &receipt.dispositions()[strategy.strategy()];
            assert_eq!(
                disposition.input_mismatch(),
                Some(InputMismatch::MissingMarketFact($expected))
            );
            assert!(receipt.proposal().is_none());
            assert_eq!(*calls.lock().unwrap(), 0);
        }};
    }
    assert_missing!(data_requirement, MarketFactField::DataRequirement);
    assert_missing!(
        universe_selection_requirement,
        MarketFactField::UniverseSelectionRequirement
    );
    assert_missing!(pit_snapshot, MarketFactField::PitSnapshot);
    assert_missing!(
        universe_selection_record,
        MarketFactField::UniverseSelectionRecord
    );
    assert_missing!(instrument_master, MarketFactField::InstrumentMaster);
    assert_missing!(
        calendar_session_time_zone,
        MarketFactField::CalendarSessionTimeZone
    );
    assert_missing!(corporate_action, MarketFactField::CorporateAction);
    assert_missing!(historical_membership, MarketFactField::HistoricalMembership);
    assert_missing!(
        market_semantics_compatibility,
        MarketFactField::MarketSemanticsCompatibility
    );
}

#[tokio::test]
async fn every_named_capacity_fact_is_required_before_scanner_admission() {
    let strategy = binding_with_capacity("capacity");
    macro_rules! assert_missing {
        ($field:ident, $expected:expr) => {{
            let mut readback = snapshot_readback(&strategy);
            readback.capacity_view_cut.as_mut().unwrap().$field = None;
            let (receipt, calls) = scan_with_snapshot(strategy.clone(), readback).await;
            let disposition = &receipt.dispositions()[strategy.strategy()];
            assert_eq!(
                disposition.input_mismatch(),
                Some(InputMismatch::MissingCapacityViewFact($expected))
            );
            assert!(receipt.proposal().is_none());
            assert_eq!(*calls.lock().unwrap(), 0);
        }};
    }
    assert_missing!(requirement_contract, CapacityViewField::RequirementContract);
    assert_missing!(
        candidate_independent_scope,
        CapacityViewField::CandidateIndependentScope
    );
    assert_missing!(account_facts, CapacityViewField::AccountFacts);
    assert_missing!(liquidity, CapacityViewField::Liquidity);
    assert_missing!(capital_pool_method, CapacityViewField::CapitalPoolMethod);
    assert_missing!(
        capital_pool_assumptions,
        CapacityViewField::CapitalPoolAssumptions
    );
    assert_missing!(measurement_time, CapacityViewField::MeasurementTime);
    assert_missing!(valid_through, CapacityViewField::ValidThrough);
    assert_missing!(
        compatible_market_snapshot_cut,
        CapacityViewField::CompatibleMarketSnapshotCut
    );
}

#[tokio::test]
async fn contract_and_capacity_mismatches_close_input_unavailable_before_matcher() {
    let strategy = binding_with_capacity("guarded");
    let mut wrong_data = snapshot_readback(&strategy);
    wrong_data.market_fact_cut.data_requirement =
        Some(DataRequirementContract::new(id("wrong-data"), version(1)));
    let mut wrong_universe = snapshot_readback(&strategy);
    wrong_universe
        .market_fact_cut
        .universe_selection_requirement = Some(UniverseSelectionRequirement::new(
        id("wrong-universe"),
        version(1),
    ));
    let mut wrong_capacity_contract = snapshot_readback(&strategy);
    wrong_capacity_contract
        .capacity_view_cut
        .as_mut()
        .unwrap()
        .requirement_contract = Some(CapacityRequirementContract::new(
        id("wrong-capacity-contract"),
        version(1),
    ));
    let mut wrong_capacity_scope = snapshot_readback(&strategy);
    wrong_capacity_scope
        .capacity_view_cut
        .as_mut()
        .unwrap()
        .candidate_independent_scope = Some(CandidateIndependentCapacityScope::new(id(
        "wrong-capacity-scope",
    )));

    let cases = [
        (InputMismatch::DataRequirement, wrong_data),
        (InputMismatch::UniverseSelectionRequirement, wrong_universe),
        (
            InputMismatch::CapacityMissing,
            UntrustedSnapshotReadback {
                capacity_view_cut: None,
                ..snapshot_readback(&strategy)
            },
        ),
        (
            InputMismatch::CapacityRequirementContract,
            wrong_capacity_contract,
        ),
        (InputMismatch::CapacityScope, wrong_capacity_scope),
    ];

    for (expected_mismatch, snapshot) in cases {
        let (receipt, matcher_calls) = scan_with_snapshot(strategy.clone(), snapshot).await;
        assert_eq!(receipt.status(), &ReceiptStatus::InsufficientData);
        assert!(receipt.proposal().is_none());
        let disposition = &receipt.dispositions()[strategy.strategy()];
        assert_eq!(disposition.outcome(), StrategyOutcome::InputUnavailable);
        assert_eq!(disposition.input_mismatch(), Some(expected_mismatch));
        assert_eq!(*matcher_calls.lock().unwrap(), 0);
    }
}

#[tokio::test]
async fn complete_matching_capacity_cut_is_preserved_in_proposal_and_receipt() {
    let strategy = binding_with_capacity("complete-capacity");
    let (receipt, matcher_calls) =
        scan_with_snapshot(strategy.clone(), snapshot_readback(&strategy)).await;
    assert_eq!(receipt.status(), &ReceiptStatus::Proposed);
    assert_eq!(*matcher_calls.lock().unwrap(), 1);
    let disposition = &receipt.dispositions()[strategy.strategy()];
    assert_eq!(disposition.outcome(), StrategyOutcome::Matched);
    let market = disposition.market_fact_cut().unwrap();
    let capacity = disposition.capacity_view_cut().unwrap();
    assert_eq!(
        market.pit_snapshot().source().owner(),
        &SourceOwner::new(id("market-data-owner"))
    );
    assert_eq!(capacity.admitted_at(), UnixTimestamp::new(1_787_203_800));
    let member = &receipt.proposal().unwrap().members()[strategy.strategy()];
    assert_eq!(member.binding(), &strategy);
    assert_eq!(member.market_fact_cut(), market);
    assert_eq!(member.capacity_view_cut(), Some(capacity));
}

#[tokio::test]
async fn exclusive_validity_equality_expires_market_and_capacity_before_matcher() {
    let strategy = binding_with_capacity("exclusive-validity");
    let now = UnixTimestamp::new(1_787_203_800);

    let mut market_at_boundary = snapshot_readback(&strategy);
    market_at_boundary
        .market_fact_cut
        .pit_snapshot
        .as_mut()
        .expect("fixture has PIT fact")
        .valid_through = now;

    let mut capacity_at_boundary = snapshot_readback(&strategy);
    capacity_at_boundary
        .capacity_view_cut
        .as_mut()
        .expect("fixture has capacity view")
        .valid_through = Some(now);

    for readback in [market_at_boundary, capacity_at_boundary] {
        let (receipt, matcher_calls) = scan_with_snapshot(strategy.clone(), readback).await;
        assert_eq!(receipt.status(), &ReceiptStatus::InsufficientData);
        assert_eq!(
            receipt.dispositions()[strategy.strategy()].input_mismatch(),
            Some(InputMismatch::Expired)
        );
        assert!(receipt.proposal().is_none());
        assert_eq!(*matcher_calls.lock().unwrap(), 0);
    }
}

#[tokio::test]
async fn untrusted_source_time_frontier_and_cross_cuts_fail_before_matcher() {
    let strategy = binding_with_capacity("guarded-authority");
    let mut expired = snapshot_readback(&strategy);
    expired
        .market_fact_cut
        .pit_snapshot
        .as_mut()
        .unwrap()
        .valid_through = UnixTimestamp::new(1_787_203_799);
    let mut foreign_owner = snapshot_readback(&strategy);
    foreign_owner
        .market_fact_cut
        .pit_snapshot
        .as_mut()
        .unwrap()
        .source = OwnerSource::new(
        SourceOwner::new(id("foreign-owner")),
        SourceNode::new(id("market-data-node")),
    );
    let mut foreign_node = snapshot_readback(&strategy);
    foreign_node
        .market_fact_cut
        .pit_snapshot
        .as_mut()
        .unwrap()
        .source = OwnerSource::new(
        SourceOwner::new(id("market-data-owner")),
        SourceNode::new(id("foreign-node")),
    );
    let mut clock_mismatch = snapshot_readback(&strategy);
    clock_mismatch
        .market_fact_cut
        .pit_snapshot
        .as_mut()
        .unwrap()
        .clock_epoch = 2;
    let mut time_evidence_mismatch = snapshot_readback(&strategy);
    time_evidence_mismatch
        .market_fact_cut
        .pit_snapshot
        .as_mut()
        .unwrap()
        .time_evidence = id("foreign-time-evidence");
    let mut future = snapshot_readback(&strategy);
    future
        .market_fact_cut
        .pit_snapshot
        .as_mut()
        .unwrap()
        .observed_at = UnixTimestamp::new(1_787_203_801);
    let mut missing_frontier = snapshot_readback(&strategy);
    missing_frontier
        .market_fact_cut
        .pit_snapshot
        .as_mut()
        .unwrap()
        .source_frontier = None;
    let mut regressed = snapshot_readback(&strategy);
    regressed
        .market_fact_cut
        .pit_snapshot
        .as_mut()
        .unwrap()
        .source_frontier = Some(SourceFrontier::new(
        FrontierLineage::new(id("market-frontier")),
        9,
    ));
    let mut market_cross_cut = snapshot_readback(&strategy);
    market_cross_cut
        .market_fact_cut
        .instrument_master
        .as_mut()
        .unwrap()
        .snapshot_cut = SnapshotCut::new(id("other-market-cut"));
    let mut capacity_cross_cut = snapshot_readback(&strategy);
    capacity_cross_cut
        .capacity_view_cut
        .as_mut()
        .unwrap()
        .compatible_market_snapshot_cut = Some(SnapshotCut::new(id("other-market-cut")));
    let mut capacity_internal_cross_cut = snapshot_readback(&strategy);
    capacity_internal_cross_cut
        .capacity_view_cut
        .as_mut()
        .unwrap()
        .liquidity
        .as_mut()
        .unwrap()
        .snapshot_cut = SnapshotCut::new(id("other-capacity-cut"));
    let mut semantic_scope = snapshot_readback(&strategy);
    semantic_scope
        .market_fact_cut
        .pit_snapshot
        .as_mut()
        .unwrap()
        .semantic_scope = SemanticScope::new(id("foreign-scope"));
    let mut compatibility = snapshot_readback(&strategy);
    compatibility
        .market_fact_cut
        .pit_snapshot
        .as_mut()
        .unwrap()
        .compatibility_cut = CompatibilityCut::new(id("foreign-semantics"));
    let mut measurement = snapshot_readback(&strategy);
    measurement
        .capacity_view_cut
        .as_mut()
        .unwrap()
        .measurement_time = Some(UnixTimestamp::new(1_787_203_799));
    let mut validity = snapshot_readback(&strategy);
    validity.capacity_view_cut.as_mut().unwrap().valid_through =
        Some(UnixTimestamp::new(1_787_207_399));

    for (expected, readback) in vec![
        (InputMismatch::Expired, expired),
        (InputMismatch::SourceOwner, foreign_owner),
        (InputMismatch::SourceNode, foreign_node),
        (InputMismatch::ClockEpoch, clock_mismatch),
        (InputMismatch::TimeEvidence, time_evidence_mismatch),
        (InputMismatch::FutureObservation, future),
        (InputMismatch::FrontierMissing, missing_frontier),
        (InputMismatch::FrontierRegressed, regressed),
        (InputMismatch::MarketCrossCut, market_cross_cut),
        (InputMismatch::CapacityMarketCrossCut, capacity_cross_cut),
        (InputMismatch::CapacityCrossCut, capacity_internal_cross_cut),
        (InputMismatch::SemanticScope, semantic_scope),
        (InputMismatch::CompatibilityCut, compatibility),
        (InputMismatch::CapacityMeasurementTime, measurement),
        (InputMismatch::CapacityValidityCut, validity),
    ] {
        let (receipt, calls) = scan_with_snapshot(strategy.clone(), readback).await;
        assert_eq!(receipt.status(), &ReceiptStatus::InsufficientData);
        assert_eq!(
            receipt.dispositions()[strategy.strategy()].input_mismatch(),
            Some(expected)
        );
        assert!(receipt.proposal().is_none());
        assert_eq!(*calls.lock().unwrap(), 0);
    }

    let mut stale = snapshot_readback(&strategy);
    stale
        .market_fact_cut
        .pit_snapshot
        .as_mut()
        .unwrap()
        .valid_through = UnixTimestamp::new(1_787_203_850);
    let stale_clock = ClockAdmission::Admitted {
        epoch: 1,
        evidence: id("clock-cut-1"),
        observed_at: UnixTimestamp::new(1_787_203_900),
    };
    let (receipt, calls) = scan_with_snapshot_and_clock(strategy.clone(), stale, stale_clock).await;
    assert_eq!(
        receipt.dispositions()[strategy.strategy()].input_mismatch(),
        Some(InputMismatch::Expired)
    );
    assert!(receipt.proposal().is_none());
    assert_eq!(*calls.lock().unwrap(), 0);
}

#[tokio::test]
async fn public_scanner_rejects_before_any_terminal_receipt_without_owner_resolve() {
    let strategy = binding_with_capacity("malicious-adapter");
    let (matcher, matcher_calls) = matcher(&[("malicious-adapter", Evaluation::Matched)], None);
    let (builder, builder_calls) = builder(None);
    let store = MemoryReceiptStore::default();
    let make_scanner = || {
        Scanner::new(
            FixtureLoader(LoaderResult::Resolved(frontier_with([strategy.clone()]))),
            FixtureSnapshots::default(),
            matcher.clone(),
            builder.clone(),
            store.clone(),
            policy(),
        )
    };
    assert_eq!(
        make_scanner()
            .scan(&schedule(), candidate(), Delivery::OnTime, clock(1))
            .await,
        Err(ScannerError::OwnerResolveUnavailable)
    );
    assert_eq!(*matcher_calls.lock().unwrap(), 0);
    assert_eq!(*builder_calls.lock().unwrap(), 0);
    assert_eq!(store.len(), 0);
}

#[tokio::test]
async fn sealed_identical_time_and_membership_replay_joins_existing_terminal_receipt() {
    let store = MemoryReceiptStore::default();
    let (matcher, matcher_calls) = matcher(&[("a", Evaluation::Matched)], None);
    let (builder, builder_calls) = builder(None);
    let make_scanner = || {
        Scanner::new_with_source_owner_fixture(
            FixtureLoader(LoaderResult::Resolved(frontier(&["a"]))),
            FixtureSnapshots::default(),
            matcher.clone(),
            builder.clone(),
            store.clone(),
            policy(),
        )
    };
    let first = terminal(
        make_scanner()
            .scan(&schedule(), candidate(), Delivery::OnTime, clock(1))
            .await
            .expect("sealed first scan"),
    );
    let replay = terminal(
        make_scanner()
            .scan(&schedule(), candidate(), Delivery::OnTime, clock(1))
            .await
            .expect("sealed exact replay"),
    );

    assert_eq!(first.kind, CommitKind::Committed);
    assert_eq!(replay.kind, CommitKind::Joined);
    assert_eq!(replay.receipt, first.receipt);
    assert_eq!(store.len(), 1);
    assert_eq!(*matcher_calls.lock().unwrap(), 1);
    assert_eq!(*builder_calls.lock().unwrap(), 1);
}

#[rstest]
fn sealed_source_owner_admission_is_bound_to_one_exact_readback() {
    let strategy = binding("source-owner-binding");
    let original = snapshot_readback(&strategy);
    let admission = crate::authority::SourceOwnerResolvedAdmission::fixture_only(&original);
    let mut substituted = original;
    substituted
        .market_fact_cut
        .pit_snapshot
        .as_mut()
        .unwrap()
        .record_identity = RecordIdentity::new(id("substituted-record"));
    let due_slot = schedule()
        .resolve_due_slot(candidate(), Delivery::OnTime, clock(1))
        .unwrap()
        .unwrap();

    assert_eq!(
        policy().admit(&admission, &due_slot, &strategy, substituted),
        Err(InputMismatch::SourceOwnerResolveBindingMismatch)
    );
}

#[tokio::test]
async fn scanner_surface_closes_with_receipt_without_runtime_or_effect_port() {
    let (matcher, matcher_calls) = matcher(&[("a", Evaluation::Matched)], None);
    let (builder, builder_calls) = builder(None);
    let outcome = Scanner::new_with_source_owner_fixture(
        FixtureLoader(LoaderResult::Resolved(frontier(&["a"]))),
        FixtureSnapshots::default(),
        matcher,
        builder,
        MemoryReceiptStore::default(),
        policy(),
    )
    .scan(&schedule(), candidate(), Delivery::OnTime, clock(1))
    .await
    .unwrap();
    let receipt = terminal(outcome).receipt;
    assert_eq!(receipt.status(), &ReceiptStatus::Proposed);
    assert_eq!(*matcher_calls.lock().unwrap(), 1);
    assert_eq!(*builder_calls.lock().unwrap(), 1);
}

// ---------------------------------------------------------------------------
// Canonical terminal-receipt custody
// ---------------------------------------------------------------------------

/// The richest receipt one strategy can produce: proposed, with a capacity cut.
///
/// Byte surgery below counts occurrences, so a single-strategy receipt keeps each landmark
/// unambiguous while still carrying every kind of field the codec writes.
async fn custody_receipt() -> ScannerReceipt {
    let strategy = binding_with_capacity("solo");
    let snapshot = snapshot_readback(&strategy);
    scan_with_snapshot(strategy, snapshot).await.0
}

async fn custody_bytes() -> Vec<u8> {
    encode_terminal_receipt_v1(&custody_receipt().await).unwrap()
}

fn text(value: &str) -> Vec<u8> {
    let mut encoded = u32::try_from(value.len()).unwrap().to_be_bytes().to_vec();
    encoded.extend_from_slice(value.as_bytes());
    encoded
}

fn occurrences(bytes: &[u8], needle: &[u8]) -> Vec<usize> {
    (0..=bytes.len().saturating_sub(needle.len()))
        .filter(|start| &bytes[*start..*start + needle.len()] == needle)
        .collect()
}

/// Locates the nth landmark, asserting the count so a missed landmark fails loudly.
///
/// A corruption test that silently edited the wrong bytes would still see a refusal and still
/// pass, which is the shape where a broken measurement reads as evidence.
fn landmark(bytes: &[u8], needle: &[u8], nth: usize, expected: usize) -> usize {
    let found = occurrences(bytes, needle);
    assert_eq!(
        found.len(),
        expected,
        "landmark {needle:?} appeared {} times, not {expected}",
        found.len()
    );
    found[nth]
}

fn replace_nth(
    bytes: &[u8],
    needle: &[u8],
    replacement: &[u8],
    nth: usize,
    expected: usize,
) -> Vec<u8> {
    assert_eq!(
        needle.len(),
        replacement.len(),
        "a replacement that changes length would move every later field"
    );
    let at = landmark(bytes, needle, nth, expected);
    let mut damaged = bytes.to_vec();
    damaged[at..at + needle.len()].copy_from_slice(replacement);
    damaged
}

fn overwrite(bytes: &[u8], at: usize, value: u8) -> Vec<u8> {
    let mut damaged = bytes.to_vec();
    damaged[at] = value;
    damaged
}

#[tokio::test]
async fn every_terminal_receipt_state_survives_canonical_custody_round_trip() {
    let operational_failure = BatchOperationalFailure {
        category: BatchFailureCategory::SharedDependencyOperationalFailure,
        failure_identity: id("custody-operational-failure"),
        evidence_source_cut: id("custody-operational-cut"),
        time_evidence: id("custody-operational-time"),
    };
    let mut missing_fact = snapshot_readback(&binding("absent"));
    missing_fact.market_fact_cut.corporate_action = None;

    let receipts = [
        (
            "proposed with negatives",
            terminal_receipt(
                LoaderResult::Resolved(frontier(&["matched", "negative", "insufficient"])),
                &[
                    ("matched", Evaluation::Matched),
                    ("negative", Evaluation::NoMatch),
                    ("insufficient", Evaluation::Insufficient),
                ],
                None,
            )
            .await,
        ),
        (
            "no match",
            terminal_receipt(
                LoaderResult::Resolved(frontier(&["negative"])),
                &[("negative", Evaluation::NoMatch)],
                None,
            )
            .await,
        ),
        (
            "insufficient data",
            terminal_receipt(
                LoaderResult::Resolved(frontier(&["insufficient"])),
                &[("insufficient", Evaluation::Insufficient)],
                None,
            )
            .await,
        ),
        (
            "completed without proposal",
            terminal_receipt(
                LoaderResult::Resolved(frontier(&["condition"])),
                &[("condition", Evaluation::ConditionFailed)],
                None,
            )
            .await,
        ),
        (
            "failed on batch operation",
            terminal_receipt(
                LoaderResult::Resolved(frontier(&["matched"])),
                &[("matched", Evaluation::Matched)],
                Some(operational_failure),
            )
            .await,
        ),
        (
            "failed on unresolved membership",
            terminal_receipt(
                LoaderResult::Unresolved(MembershipUnavailable {
                    disposition: id("custody-membership-unresolved"),
                    source_cut: id("custody-membership-cut"),
                    terminal_reason: id("custody-membership-reason"),
                    observed: vec![ObservedMemberFact::new(
                        id("observed-member"),
                        EvidenceSet::singleton(id("observed-member-evidence")),
                    )],
                }),
                &[],
                None,
            )
            .await,
        ),
        ("proposed with a capacity cut", custody_receipt().await),
        (
            "input unavailable with a named mismatch",
            scan_with_snapshot(binding("absent"), missing_fact).await.0,
        ),
    ];

    for (state, receipt) in receipts {
        let bytes = encode_terminal_receipt_v1(&receipt)
            .unwrap_or_else(|e| panic!("{state} did not encode: {e:?}"));
        let reconstructed = parse_untrusted_terminal_receipt_v1(&bytes)
            .unwrap_or_else(|e| panic!("{state} did not reconstruct: {e:?}"));
        assert_eq!(reconstructed, receipt, "{state} lost meaning in custody");
        assert_eq!(
            encode_terminal_receipt_v1(&reconstructed).unwrap(),
            bytes,
            "{state} re-encoded to different bytes, so one value has two encodings"
        );
    }
}

#[tokio::test]
async fn the_attempt_key_separates_boundaries_that_share_a_local_time() {
    let resolve = |candidate| {
        schedule()
            .resolve_due_slot(candidate, Delivery::OnTime, clock(1))
            .unwrap()
            .unwrap()
            .attempt_id
    };
    let normal = resolve(DueSlotCandidate::Normal {
        local: local(11, 1, 1, 30),
        utc_offset_seconds: -14_400,
    });
    let fold = resolve(DueSlotCandidate::Fold {
        local: local(11, 1, 1, 30),
        occurrence: FoldOccurrence::Second,
        utc_offset_seconds: -14_400,
    });
    let gap = resolve(DueSlotCandidate::Gap {
        intended: local(11, 1, 1, 30),
        shifted_to: local(11, 1, 2, 30),
        utc_offset_seconds: -14_400,
    });
    let keys = [&normal, &fold, &gap]
        .map(|attempt| encode_attempt_id_v1(attempt).unwrap())
        .to_vec();
    assert_eq!(
        keys.iter().collect::<BTreeSet<_>>().len(),
        3,
        "two different attempts share one custody key"
    );
    assert_eq!(
        encode_attempt_id_v1(&normal).unwrap(),
        encode_attempt_id_v1(&normal.clone()).unwrap()
    );
    assert_ne!(
        keys[0],
        encode_terminal_receipt_v1(&custody_receipt().await).unwrap(),
        "the key and the receipt must not share a domain tag"
    );
}

#[tokio::test]
async fn framing_damage_refuses_by_name_and_never_as_absence() {
    let bytes = custody_bytes().await;
    let domain = text("VIBE_SCANNER_TERMINAL_RECEIPT_V1");

    assert_eq!(
        parse_untrusted_terminal_receipt_v1(&replace_nth(
            &bytes,
            &domain,
            &text("VIBE_SCANNER_TERMINAL_RECEIPT_V2"),
            0,
            1,
        )),
        Err(TerminalReceiptDecodeError::ForeignDomain)
    );
    assert_eq!(
        parse_untrusted_terminal_receipt_v1(
            &encode_attempt_id_v1(custody_receipt().await.attempt_id()).unwrap()
        ),
        Err(TerminalReceiptDecodeError::ForeignDomain),
        "the attempt key must not parse as a receipt"
    );
    assert_eq!(
        parse_untrusted_terminal_receipt_v1(&[]),
        Err(TerminalReceiptDecodeError::ForeignDomain)
    );
    let version_at = landmark(&bytes, &domain, 0, 1) + domain.len();
    assert_eq!(
        parse_untrusted_terminal_receipt_v1(&overwrite(&bytes, version_at + 1, 2)),
        Err(TerminalReceiptDecodeError::UnsupportedVersion { found: 2 })
    );
    assert!(matches!(
        parse_untrusted_terminal_receipt_v1(&bytes[..bytes.len() - 1]),
        Err(TerminalReceiptDecodeError::Truncated { .. })
    ));
    let mut extended = bytes;
    extended.push(0);
    assert_eq!(
        parse_untrusted_terminal_receipt_v1(&extended),
        Err(TerminalReceiptDecodeError::TrailingBytes { unconsumed: 1 }),
        "a writer that wrote more than this version defines is not a truncation"
    );
}

#[tokio::test]
async fn damaged_text_and_broken_bounds_refuse_by_name() {
    let bytes = custody_bytes().await;
    let zone = text("America/New_York");
    let mut invalid_utf8 = zone.clone();
    invalid_utf8[4] = 0xFF;
    assert_eq!(
        parse_untrusted_terminal_receipt_v1(&replace_nth(&bytes, &zone, &invalid_utf8, 0, 1)),
        Err(TerminalReceiptDecodeError::MalformedText {
            field: "calendar_time_zone"
        })
    );
    let mut oversized = zone.clone();
    oversized[..4].copy_from_slice(&0x00FF_FFFF_u32.to_be_bytes());
    assert_eq!(
        parse_untrusted_terminal_receipt_v1(&replace_nth(&bytes, &zone, &oversized, 0, 1)),
        Err(TerminalReceiptDecodeError::CapacityExceeded {
            field: "calendar_time_zone"
        })
    );
}

#[tokio::test]
async fn unknown_tags_refuse_instead_of_falling_back_to_a_default() {
    let bytes = custody_bytes().await;
    let zone = text("America/New_York");
    let fold_disposition_at = landmark(&bytes, &zone, 0, 1) + zone.len();
    assert_eq!(
        parse_untrusted_terminal_receipt_v1(&overwrite(&bytes, fold_disposition_at, 9)),
        Err(TerminalReceiptDecodeError::UnknownDiscriminant {
            field: "fold_disposition",
            code: 9,
        })
    );
    assert_eq!(
        parse_untrusted_terminal_receipt_v1(&overwrite(&bytes, fold_disposition_at + 1, 7)),
        Err(TerminalReceiptDecodeError::UnknownDiscriminant {
            field: "gap_disposition",
            code: 7,
        })
    );
    assert_eq!(
        parse_untrusted_terminal_receipt_v1(&overwrite(&bytes, fold_disposition_at + 2, 4)),
        Err(TerminalReceiptDecodeError::UnknownDiscriminant {
            field: "misfire_policy",
            code: 4,
        })
    );
}

#[tokio::test]
async fn a_value_with_two_encodings_is_refused_under_the_one_that_is_not_canonical() {
    let mut multiple_auxiliary = snapshot_readback(&binding("aux"));
    multiple_auxiliary.market_fact_cut.auxiliary =
        BTreeSet::from([id("aux-alpha"), id("aux-bravo")]);
    let receipt = scan_with_snapshot(binding("aux"), multiple_auxiliary)
        .await
        .0;
    let bytes = encode_terminal_receipt_v1(&receipt).unwrap();
    let alpha = landmark(&bytes, &text("aux-alpha"), 0, 1);
    let bravo = landmark(&bytes, &text("aux-bravo"), 0, 1);
    assert_eq!(
        bravo,
        alpha + text("aux-alpha").len(),
        "the set is contiguous"
    );
    let mut swapped = bytes.clone();
    swapped[alpha..bravo].copy_from_slice(&text("aux-bravo"));
    swapped[bravo..bravo + text("aux-alpha").len()].copy_from_slice(&text("aux-alpha"));
    assert_eq!(
        parse_untrusted_terminal_receipt_v1(&swapped),
        Err(TerminalReceiptDecodeError::NotAscending {
            field: "market_auxiliary"
        }),
        "descending entries decode to the same set, so accepting them gives one value two encodings"
    );
    let mut repeated = bytes;
    repeated[bravo..bravo + text("aux-alpha").len()].copy_from_slice(&text("aux-alpha"));
    assert_eq!(
        parse_untrusted_terminal_receipt_v1(&repeated),
        Err(TerminalReceiptDecodeError::NotAscending {
            field: "market_auxiliary"
        }),
        "a repeat would collapse into the set rather than be noticed"
    );
}

#[tokio::test]
async fn bytes_the_scanner_domain_refuses_do_not_reconstruct_a_receipt() {
    let bytes = custody_bytes().await;
    let zone = text("America/New_York");
    let mut blank = zone.clone();
    blank[4..].fill(b' ');
    assert_eq!(
        parse_untrusted_terminal_receipt_v1(&replace_nth(&bytes, &zone, &blank, 0, 1)),
        Err(TerminalReceiptDecodeError::NotReconstructible(
            DomainError::EmptyIdentity
        ))
    );
    let mut definition = text("daily-scan");
    definition.extend_from_slice(&3_u64.to_be_bytes());
    let mut zero_version = text("daily-scan");
    zero_version.extend_from_slice(&0_u64.to_be_bytes());
    assert_eq!(
        parse_untrusted_terminal_receipt_v1(&replace_nth(&bytes, &definition, &zero_version, 0, 2)),
        Err(TerminalReceiptDecodeError::NotReconstructible(
            DomainError::ZeroVersion
        ))
    );
    assert_eq!(
        parse_untrusted_terminal_receipt_v1(&replace_nth(&bytes, &definition, &zero_version, 1, 2)),
        Err(TerminalReceiptDecodeError::NotReconstructible(
            DomainError::ZeroVersion
        )),
        "the attempt identity and the schedule carry the same definition and both are checked"
    );
}

#[tokio::test]
async fn an_input_check_the_receipt_still_witnesses_refuses_with_the_domain_reason() {
    let bytes = custody_bytes().await;
    let cut = text("market-snapshot-cut");
    assert_eq!(
        parse_untrusted_terminal_receipt_v1(&replace_nth(
            &bytes,
            &cut,
            &text("market-snapshot-CUT"),
            1,
            7,
        )),
        Err(TerminalReceiptDecodeError::AdmissionNotWitnessed(
            InputMismatch::MarketCrossCut
        )),
        "the six cross-cut equalities are both-sides-retained, so custody still checks them"
    );
    assert_eq!(
        parse_untrusted_terminal_receipt_v1(&replace_nth(
            &bytes,
            &text("market-data-owner"),
            &text("market-data-OWNER"),
            1,
            8,
        )),
        Err(TerminalReceiptDecodeError::AdmissionNotWitnessed(
            InputMismatch::SourceOwner
        )),
        "the policy is retained, so every source check is still recomputable"
    );
    let mut regressed = text("market-frontier");
    regressed.extend_from_slice(&10_u64.to_be_bytes());
    let mut behind = text("market-frontier");
    behind.extend_from_slice(&9_u64.to_be_bytes());
    assert_eq!(
        parse_untrusted_terminal_receipt_v1(&replace_nth(&bytes, &regressed, &behind, 1, 8)),
        Err(TerminalReceiptDecodeError::AdmissionNotWitnessed(
            InputMismatch::FrontierRegressed
        ))
    );
}

#[tokio::test]
async fn facts_that_disagree_about_the_one_clock_admission_are_refused() {
    let bytes = custody_bytes().await;
    assert_eq!(
        parse_untrusted_terminal_receipt_v1(&replace_nth(
            &bytes,
            &text("clock-cut-1"),
            &text("clock-cut-2"),
            3,
            9,
        )),
        Err(TerminalReceiptDecodeError::ClockAdmissionNotSingular {
            field: "time_evidence"
        }),
        "one attempt observed one clock admission, and no single fact check can see that"
    );
}

#[tokio::test]
async fn custody_re_runs_the_due_instant_and_says_what_it_cannot_witness() {
    let bytes = custody_bytes().await;
    let receipt = custody_receipt().await;
    let due_at = receipt.attempt_id().due_at();

    // The due instant is a pure function of the retained boundary, so `Expired` survives custody.
    // Nine facts and the capacity cut carry this instant; the first is the pit snapshot's.
    let expired_at = landmark(&bytes, &1_787_207_400_i64.to_be_bytes(), 0, 10);
    let mut expired = bytes.clone();
    expired[expired_at..expired_at + 8].copy_from_slice(&(due_at.seconds() - 1).to_be_bytes());
    assert_eq!(
        parse_untrusted_terminal_receipt_v1(&expired),
        Err(TerminalReceiptDecodeError::AdmissionNotWitnessed(
            InputMismatch::Expired
        )),
        "a fact that expired before its own attempt was due is refusable without a clock"
    );
    // `observed_at` is compared against the slot's `observed_at`, which the receipt does not
    // retain. Custody therefore accepts bytes that admission would have refused, and this pins
    // that boundary: re-deriving a "now" here would refuse every receipt whose facts have since
    // aged, turning a terminal record into one that expires on read.
    // Nine facts, the capacity cut's measurement time, and its admitted-at instant.
    let observed_at = landmark(&bytes, &1_787_203_800_i64.to_be_bytes(), 0, 11);
    let mut future = bytes;
    future[observed_at..observed_at + 8].copy_from_slice(&i64::MAX.to_be_bytes());
    let reconstructed = parse_untrusted_terminal_receipt_v1(&future)
        .expect("custody cannot witness a predicate whose other side it does not retain");
    assert_ne!(reconstructed, receipt);
    assert_eq!(reconstructed.attempt_id(), receipt.attempt_id());
}

#[tokio::test]
async fn a_capacity_cut_is_never_quietly_dropped_or_quietly_kept() {
    let bytes = custody_bytes().await;
    // The contract is written three times: in the membership's binding, in the disposition's
    // binding, and as the capacity cut's own requirement. Only the last is preceded by a presence
    // byte.
    let present_at = landmark(&bytes, &text("capacity-contract-solo"), 2, 3) - 1;
    assert_eq!(
        bytes[present_at], 1,
        "the capacity presence byte precedes its contract"
    );
    assert_eq!(
        parse_untrusted_terminal_receipt_v1(&overwrite(&bytes, present_at, 0)),
        Err(TerminalReceiptDecodeError::AdmissionNotWitnessed(
            InputMismatch::CapacityMissing
        )),
        "a binding that requires capacity must not read back as one that never had it"
    );
    assert_eq!(
        parse_untrusted_terminal_receipt_v1(&overwrite(&bytes, present_at, 2)),
        Err(TerminalReceiptDecodeError::UnknownDiscriminant {
            field: "capacity_view_cut",
            code: 2,
        })
    );
}

#[tokio::test]
async fn a_disposition_neither_constructor_can_produce_is_refused_by_the_encoder() {
    let receipt = custody_receipt().await;
    let disposition = &receipt.dispositions()[&id("solo")];
    let orphaned = StrategyDisposition::input_unavailable(
        disposition.binding().clone(),
        None,
        disposition.capacity_view_cut().cloned(),
        disposition.auxiliary().clone(),
        None,
    );
    let receipt = ScannerReceipt::complete(
        receipt.attempt_id().clone(),
        receipt.meaning().clone(),
        [orphaned],
        None,
        None,
    )
    .unwrap();
    assert_eq!(
        encode_terminal_receipt_v1(&receipt),
        Err(TerminalReceiptEncodeError::UnreachableDisposition {
            strategy: id("solo")
        }),
        "a capacity cut without the market cut it was admitted against describes no admission"
    );
}

/// Makes the custody bound's capacity a measured number rather than a comment.
///
/// Lowering `MAX_RECEIPT_BYTES` is not the inverse of raising it: bytes already committed under a
/// wider bound stay in custody, so a narrower reader starts refusing receipts that are intact. A
/// comment asks the next person to remember that; this fails the moment the bound stops holding
/// the strategy count it is stated to hold.
#[tokio::test]
async fn the_custody_bound_states_how_many_strategies_one_receipt_holds() {
    const SAMPLE: usize = 64;
    const STATED_STRATEGIES: usize = 1_000;

    let names = (0..SAMPLE)
        .map(|index| format!("capacity-strategy-{index:04}"))
        .collect::<Vec<_>>();
    let evaluations = names
        .iter()
        .map(|name| (name.as_str(), Evaluation::NoMatch))
        .collect::<Vec<_>>();
    let receipt = terminal_receipt(
        LoaderResult::Resolved(frontier_with(
            names.iter().map(|name| binding_with_capacity(name)),
        )),
        &evaluations,
        None,
    )
    .await;
    assert_eq!(receipt.dispositions().len(), SAMPLE);
    let bytes = encode_terminal_receipt_v1(&receipt).unwrap();
    let per_strategy = bytes.len() / SAMPLE;
    let holds = crate::codec::MAX_RECEIPT_BYTES / per_strategy;
    assert!(
        holds >= STATED_STRATEGIES,
        "the custody bound holds {holds} capacity-bearing strategies at {per_strategy} bytes each, \
         under the {STATED_STRATEGIES} it is stated to carry; a bound that stops holding a lawful \
         receipt retires receipts that are already committed"
    );
    assert_eq!(
        parse_untrusted_terminal_receipt_v1(&bytes).unwrap(),
        receipt,
        "a receipt at this width must still reconstruct"
    );
}
