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
    fn find(&self, attempt_id: &AttemptId) -> Result<Option<ScannerReceipt>, ReceiptStoreError> {
        Ok(self.0.lock().unwrap().get(attempt_id).cloned())
    }

    fn commit_or_join(&self, receipt: ScannerReceipt) -> Result<CommitOutcome, ReceiptStoreError> {
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

impl crate::product_edge::sealed::ScannerOwnedTerminalReceiptStore for MemoryReceiptStore {}
impl ProductEdgeTerminalReceiptReadSource for MemoryReceiptStore {}

#[derive(Clone)]
enum ProductEdgeReadStore {
    Missing,
    Unavailable(OpaqueId),
    Returned(Box<ScannerReceipt>),
}

impl TerminalReceiptStore for ProductEdgeReadStore {
    fn find(&self, _: &AttemptId) -> Result<Option<ScannerReceipt>, ReceiptStoreError> {
        match self {
            Self::Missing => Ok(None),
            Self::Unavailable(evidence) => Err(ReceiptStoreError::Unavailable {
                evidence: evidence.clone(),
            }),
            Self::Returned(receipt) => Ok(Some(receipt.as_ref().clone())),
        }
    }

    fn commit_or_join(&self, _: ScannerReceipt) -> Result<CommitOutcome, ReceiptStoreError> {
        unreachable!("the Product Edge read capability cannot reach the store write path")
    }
}

impl crate::product_edge::sealed::ScannerOwnedTerminalReceiptStore for ProductEdgeReadStore {}
impl ProductEdgeTerminalReceiptReadSource for ProductEdgeReadStore {}

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

fn terminal_through_product_edge(
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
    let committed = terminal(
        scanner
            .scan(&schedule(), candidate(), Delivery::OnTime, clock(1))
            .unwrap(),
    )
    .receipt;
    let reader = scanner.product_edge_terminal_receipts();
    let first = reader.read(committed.attempt_id()).unwrap();
    let second = reader.read(committed.attempt_id()).unwrap();
    assert_eq!(first, committed);
    assert_eq!(second, committed);
    first
}

fn scan_with_snapshot(
    strategy: StrategyBinding,
    snapshot: UntrustedSnapshotReadback,
) -> (ScannerReceipt, Arc<Mutex<usize>>) {
    scan_with_snapshot_and_clock(strategy, snapshot, clock(1))
}

fn scan_with_snapshot_and_clock(
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

#[rstest]
fn duplicate_and_restart_delivery_join_one_terminal_receipt() {
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
            .unwrap(),
    );
    let restarted = terminal(
        make_scanner()
            .scan(&schedule(), candidate(), Delivery::OnTime, clock(8))
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
                terminal(
                    scanner
                        .scan(&schedule(), candidate(), Delivery::OnTime, clock(epoch + 1))
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

#[rstest]
fn same_attempt_with_changed_semantics_fails_closed() {
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
        .unwrap();
    let mut conflicting = schedule();
    conflicting.cadence = id("0 45 1 * * *");
    let error = scanner
        .scan(&conflicting, candidate(), Delivery::OnTime, clock(2))
        .unwrap_err();
    assert!(matches!(
        error,
        ScannerError::ReceiptStore(ReceiptStoreError::SemanticConflict { .. })
    ));
}

#[rstest]
fn same_attempt_with_changed_admission_policy_fails_closed() {
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
    .unwrap_err();
    assert!(matches!(
        error,
        ScannerError::ReceiptStore(ReceiptStoreError::SemanticConflict { .. })
    ));
}

#[rstest]
fn mixed_strategy_outcomes_preserve_negative_members_and_valid_match() {
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

#[rstest]
fn complete_resolved_membership_is_enforced() {
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

#[rstest]
fn condition_failure_is_local_but_independent_operational_failure_wins() {
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
        .unwrap(),
    )
    .receipt;
    assert_eq!(
        failed.status(),
        &ReceiptStatus::Failed(FailedReason::BatchOperational(operational))
    );
    assert!(failed.proposal().is_none());
}

#[rstest]
fn unresolved_membership_never_invents_expected_or_missing_members() {
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

#[rstest]
fn product_edge_reads_every_terminal_state_without_losing_owner_meaning() {
    let proposed = terminal_through_product_edge(
        LoaderResult::Resolved(frontier(&["matched", "negative", "insufficient"])),
        &[
            ("matched", Evaluation::Matched),
            ("negative", Evaluation::NoMatch),
            ("insufficient", Evaluation::Insufficient),
        ],
        None,
    );
    assert_eq!(proposed.status(), &ReceiptStatus::Proposed);
    assert_eq!(
        proposed.dispositions()[&id("negative")].outcome(),
        StrategyOutcome::NoMatch
    );
    assert_eq!(
        proposed.dispositions()[&id("insufficient")].outcome(),
        StrategyOutcome::InsufficientData
    );
    assert_eq!(
        proposed
            .proposal()
            .unwrap()
            .members()
            .keys()
            .cloned()
            .collect::<BTreeSet<_>>(),
        BTreeSet::from([id("matched")])
    );

    let no_match = terminal_through_product_edge(
        LoaderResult::Resolved(frontier(&["negative"])),
        &[("negative", Evaluation::NoMatch)],
        None,
    );
    let insufficient = terminal_through_product_edge(
        LoaderResult::Resolved(frontier(&["insufficient"])),
        &[("insufficient", Evaluation::Insufficient)],
        None,
    );
    let completed_no_proposal = terminal_through_product_edge(
        LoaderResult::Resolved(frontier(&["condition"])),
        &[("condition", Evaluation::ConditionFailed)],
        None,
    );

    for (receipt, status) in [
        (no_match, ReceiptStatus::NoMatch),
        (insufficient, ReceiptStatus::InsufficientData),
        (completed_no_proposal, ReceiptStatus::CompletedNoProposal),
    ] {
        assert_eq!(receipt.status(), &status);
        assert!(receipt.proposal().is_none());
        assert!(matches!(
            receipt.membership(),
            MembershipBranch::Resolved {
                expected,
                observed,
                missing,
            } if expected == observed && missing.is_empty()
        ));
    }

    let operational_failure = BatchOperationalFailure {
        category: BatchFailureCategory::ScannerServiceFailure,
        failure_identity: id("product-edge-operational-failure"),
        evidence_source_cut: id("product-edge-operational-cut"),
        time_evidence: id("product-edge-operational-time"),
    };
    let failed_known = terminal_through_product_edge(
        LoaderResult::Resolved(frontier(&["matched"])),
        &[("matched", Evaluation::Matched)],
        Some(operational_failure.clone()),
    );
    assert_eq!(
        failed_known.status(),
        &ReceiptStatus::Failed(FailedReason::BatchOperational(operational_failure))
    );
    assert!(matches!(
        failed_known.membership(),
        MembershipBranch::Resolved {
            expected,
            observed,
            missing,
        } if expected == observed && missing.is_empty()
    ));
    assert!(failed_known.proposal().is_none());

    let failed_unresolved = terminal_through_product_edge(
        LoaderResult::Unresolved(MembershipUnavailable {
            disposition: id("product-edge-membership-unresolved"),
            source_cut: id("product-edge-membership-cut"),
            terminal_reason: id("product-edge-membership-reason"),
            observed: vec![ObservedMemberFact::new(
                id("observed-member"),
                EvidenceSet::singleton(id("observed-member-evidence")),
            )],
        }),
        &[],
        None,
    );
    assert!(matches!(
        failed_unresolved.status(),
        ReceiptStatus::Failed(FailedReason::MembershipUnresolved { terminal_reason })
            if terminal_reason == &id("product-edge-membership-reason")
    ));
    assert!(matches!(
        failed_unresolved.membership(),
        MembershipBranch::Unresolved {
            observed,
            missing_members_unavailable: MissingMembersUnavailable,
            ..
        } if observed.keys().cloned().collect::<BTreeSet<_>>()
            == BTreeSet::from([id("observed-member")])
    ));
    assert!(failed_unresolved.proposal().is_none());
}

#[rstest]
fn product_edge_read_fails_closed_for_missing_unavailable_or_wrong_identity() {
    let requested = schedule()
        .resolve_due_slot(candidate(), Delivery::OnTime, clock(1))
        .unwrap()
        .unwrap()
        .attempt_id;

    let missing = ProductEdgeTerminalReceiptReader::new(&ProductEdgeReadStore::Missing)
        .read(&requested)
        .unwrap_err();
    assert_eq!(
        missing,
        ProductEdgeReceiptReadError::NotFound {
            attempt_id: requested.clone()
        }
    );

    let unavailable_evidence = id("product-edge-store-unavailable");
    let unavailable_store = ProductEdgeReadStore::Unavailable(unavailable_evidence.clone());
    let unavailable = ProductEdgeTerminalReceiptReader::new(&unavailable_store)
        .read(&requested)
        .unwrap_err();
    assert_eq!(
        unavailable,
        ProductEdgeReceiptReadError::Unavailable {
            evidence: unavailable_evidence
        }
    );

    let receipt = terminal_through_product_edge(
        LoaderResult::Resolved(frontier(&["foreign"])),
        &[("foreign", Evaluation::NoMatch)],
        None,
    );
    let mut foreign_identity = requested;
    foreign_identity.scan_scope.identity = id("foreign-scope");
    let wrong_store = ProductEdgeReadStore::Returned(Box::new(receipt.clone()));
    let conflict = ProductEdgeTerminalReceiptReader::new(&wrong_store)
        .read(&foreign_identity)
        .unwrap_err();
    assert_eq!(
        conflict,
        ProductEdgeReceiptReadError::IdentityConflict {
            requested: Box::new(foreign_identity),
            returned: Box::new(receipt.attempt_id().clone()),
        }
    );
}

#[rstest]
fn every_named_market_fact_is_required_before_scanner_admission() {
    let strategy = binding("authority");
    macro_rules! assert_missing {
        ($field:ident, $expected:expr) => {{
            let mut readback = snapshot_readback(&strategy);
            readback.market_fact_cut.$field = None;
            let (receipt, calls) = scan_with_snapshot(strategy.clone(), readback);
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

#[rstest]
fn every_named_capacity_fact_is_required_before_scanner_admission() {
    let strategy = binding_with_capacity("capacity");
    macro_rules! assert_missing {
        ($field:ident, $expected:expr) => {{
            let mut readback = snapshot_readback(&strategy);
            readback.capacity_view_cut.as_mut().unwrap().$field = None;
            let (receipt, calls) = scan_with_snapshot(strategy.clone(), readback);
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

#[rstest]
fn contract_and_capacity_mismatches_close_input_unavailable_before_matcher() {
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
        let (receipt, matcher_calls) = scan_with_snapshot(strategy.clone(), snapshot);
        assert_eq!(receipt.status(), &ReceiptStatus::InsufficientData);
        assert!(receipt.proposal().is_none());
        let disposition = &receipt.dispositions()[strategy.strategy()];
        assert_eq!(disposition.outcome(), StrategyOutcome::InputUnavailable);
        assert_eq!(disposition.input_mismatch(), Some(expected_mismatch));
        assert_eq!(*matcher_calls.lock().unwrap(), 0);
    }
}

#[rstest]
fn complete_matching_capacity_cut_is_preserved_in_proposal_and_receipt() {
    let strategy = binding_with_capacity("complete-capacity");
    let (receipt, matcher_calls) =
        scan_with_snapshot(strategy.clone(), snapshot_readback(&strategy));
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

#[rstest]
fn exclusive_validity_equality_expires_market_and_capacity_before_matcher() {
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
        let (receipt, matcher_calls) = scan_with_snapshot(strategy.clone(), readback);
        assert_eq!(receipt.status(), &ReceiptStatus::InsufficientData);
        assert_eq!(
            receipt.dispositions()[strategy.strategy()].input_mismatch(),
            Some(InputMismatch::Expired)
        );
        assert!(receipt.proposal().is_none());
        assert_eq!(*matcher_calls.lock().unwrap(), 0);
    }
}

#[rstest]
fn untrusted_source_time_frontier_and_cross_cuts_fail_before_matcher() {
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
        let (receipt, calls) = scan_with_snapshot(strategy.clone(), readback);
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
    let (receipt, calls) = scan_with_snapshot_and_clock(strategy.clone(), stale, stale_clock);
    assert_eq!(
        receipt.dispositions()[strategy.strategy()].input_mismatch(),
        Some(InputMismatch::Expired)
    );
    assert!(receipt.proposal().is_none());
    assert_eq!(*calls.lock().unwrap(), 0);
}

#[rstest]
fn public_scanner_rejects_before_any_terminal_receipt_without_owner_resolve() {
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
        make_scanner().scan(&schedule(), candidate(), Delivery::OnTime, clock(1)),
        Err(ScannerError::OwnerResolveUnavailable)
    );
    assert_eq!(*matcher_calls.lock().unwrap(), 0);
    assert_eq!(*builder_calls.lock().unwrap(), 0);
    assert_eq!(store.len(), 0);
}

#[rstest]
fn sealed_identical_time_and_membership_replay_joins_existing_terminal_receipt() {
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
            .expect("sealed first scan"),
    );
    let replay = terminal(
        make_scanner()
            .scan(&schedule(), candidate(), Delivery::OnTime, clock(1))
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

#[rstest]
fn scanner_surface_closes_with_receipt_without_runtime_or_effect_port() {
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
    .unwrap();
    let receipt = terminal(outcome).receipt;
    assert_eq!(receipt.status(), &ReceiptStatus::Proposed);
    assert_eq!(*matcher_calls.lock().unwrap(), 1);
    assert_eq!(*builder_calls.lock().unwrap(), 1);
}
