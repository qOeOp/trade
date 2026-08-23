use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};

use rstest::rstest;
use vibe_scanner::{
    BatchOperationalFailure, ClockAdmission, CommitOutcome, CompatibilityCut, ConditionFailure,
    Delivery, DueSlot, DueSlotCandidate, FoldDisposition, FrontierLineage, FrontierRequirement,
    GapDisposition, InputUnavailable, LocalDateTime, MarketSnapshot, MatchEvaluation,
    MembershipUnavailable, MisfirePolicy, OpaqueId, OwnerSource, ProposalBuilder, ProposalEvidence,
    ReceiptStoreError, Scanner, ScannerReceipt, ScheduleDefinition, SemanticScope,
    SnapshotAdmissionPolicy, SnapshotEvidence, SourceNode, SourceOwner, StrategyBinding,
    StrategyDisposition, StrategyFrontier, StrategyLoader, StrategyMatcher, TerminalReceiptStore,
    UnixTimestamp, Version, VersionedIdentity,
};

fn id(value: &str) -> OpaqueId {
    OpaqueId::new(value).expect("bounded fixture identity")
}

fn version(value: u64) -> Version {
    Version::new(value).expect("nonzero fixture version")
}

fn schedule() -> ScheduleDefinition {
    ScheduleDefinition {
        definition: VersionedIdentity {
            identity: id("public-daily-scan"),
            version: version(1),
        },
        scan_scope: VersionedIdentity {
            identity: id("public-global-scope"),
            version: version(1),
        },
        cadence: id("0 30 1 * * *"),
        calendar_time_zone: id("UTC"),
        fold_disposition: FoldDisposition::Both,
        gap_disposition: GapDisposition::ShiftForward,
        misfire_policy: MisfirePolicy::FireOnce,
        shared_clock: id("caller-clock"),
        effective_interval: id("public-interval"),
    }
}

fn candidate() -> DueSlotCandidate {
    DueSlotCandidate::Normal {
        local: LocalDateTime::new(2026, 8, 20, 1, 30, 0).expect("valid fixture time"),
        utc_offset_seconds: 0,
    }
}

fn self_signed_clock() -> ClockAdmission {
    ClockAdmission::Admitted {
        epoch: 1,
        evidence: id("caller-time-evidence"),
        observed_at: UnixTimestamp::new(1_787_189_400),
    }
}

fn policy() -> SnapshotAdmissionPolicy {
    SnapshotAdmissionPolicy::new(
        VersionedIdentity {
            identity: id("public-scanner-policy"),
            version: version(1),
        },
        OwnerSource::new(
            SourceOwner::new(id("market-data-owner")),
            SourceNode::new(id("market-data-node")),
        ),
        OwnerSource::new(
            SourceOwner::new(id("portfolio-owner")),
            SourceNode::new(id("portfolio-node")),
        ),
        FrontierRequirement::new(FrontierLineage::new(id("market-frontier")), 1),
        FrontierRequirement::new(FrontierLineage::new(id("capacity-frontier")), 1),
        SemanticScope::new(id("public-market-scope")),
        CompatibilityCut::new(id("public-compatibility-cut")),
    )
}

#[derive(Clone)]
enum LoaderReadback {
    Resolved,
    Unresolved,
}

#[derive(Clone)]
struct CountingLoader {
    calls: Arc<AtomicUsize>,
    readback: LoaderReadback,
}

impl StrategyLoader for CountingLoader {
    fn load(&self, _due_slot: &DueSlot) -> Result<StrategyFrontier, MembershipUnavailable> {
        self.calls.fetch_add(1, Ordering::SeqCst);

        match self.readback {
            LoaderReadback::Resolved => Ok(StrategyFrontier::new(
                id("caller-membership-frontier"),
                std::iter::empty::<StrategyBinding>(),
            )
            .expect("valid caller-created membership frontier")),
            LoaderReadback::Unresolved => Err(MembershipUnavailable {
                disposition: id("caller-membership-unavailable"),
                source_cut: id("caller-membership-cut"),
                terminal_reason: id("caller-membership-reason"),
                observed: Vec::new(),
            }),
        }
    }
}

struct NeverSnapshot;

impl MarketSnapshot for NeverSnapshot {
    #[allow(clippy::panic_in_result_fn)]
    fn snapshot(
        &self,
        _due_slot: &DueSlot,
        _strategy: &StrategyBinding,
    ) -> Result<vibe_scanner::UntrustedSnapshotReadback, InputUnavailable> {
        panic!("unadmitted membership must not reach snapshot loading")
    }
}

struct NeverMatcher;

impl StrategyMatcher for NeverMatcher {
    #[allow(clippy::panic_in_result_fn)]
    fn evaluate(
        &self,
        _strategy: &StrategyBinding,
        _snapshot: &SnapshotEvidence,
    ) -> Result<MatchEvaluation, ConditionFailure> {
        panic!("unadmitted membership must not reach matching")
    }
}

struct NeverProposal;

impl ProposalBuilder for NeverProposal {
    #[allow(clippy::panic_in_result_fn)]
    fn build(
        &self,
        _matched: &[StrategyDisposition],
    ) -> Result<ProposalEvidence, BatchOperationalFailure> {
        panic!("unadmitted membership must not reach proposal construction")
    }
}

#[derive(Clone)]
struct CountingStore {
    find_calls: Arc<AtomicUsize>,
    commit_calls: Arc<AtomicUsize>,
}

impl TerminalReceiptStore for CountingStore {
    fn find(
        &self,
        _attempt_id: &vibe_scanner::AttemptId,
    ) -> Result<Option<ScannerReceipt>, ReceiptStoreError> {
        self.find_calls.fetch_add(1, Ordering::SeqCst);
        Ok(None)
    }

    fn commit_or_join(&self, _receipt: ScannerReceipt) -> Result<CommitOutcome, ReceiptStoreError> {
        self.commit_calls.fetch_add(1, Ordering::SeqCst);
        Err(ReceiptStoreError::Unavailable {
            evidence: id("unexpected-public-commit"),
        })
    }
}

#[rstest]
fn public_time_and_membership_dtos_cannot_reach_loader_store_or_commit() {
    let cases = [
        (
            "resolved membership",
            LoaderReadback::Resolved,
            self_signed_clock(),
        ),
        (
            "unresolved membership",
            LoaderReadback::Unresolved,
            self_signed_clock(),
        ),
        (
            "unavailable time",
            LoaderReadback::Resolved,
            ClockAdmission::Unavailable,
        ),
    ];
    let mut rejected = 0;

    for (case, readback, clock) in cases {
        let loader_calls = Arc::new(AtomicUsize::new(0));
        let find_calls = Arc::new(AtomicUsize::new(0));
        let commit_calls = Arc::new(AtomicUsize::new(0));
        let scanner = Scanner::new(
            CountingLoader {
                calls: Arc::clone(&loader_calls),
                readback,
            },
            NeverSnapshot,
            NeverMatcher,
            NeverProposal,
            CountingStore {
                find_calls: Arc::clone(&find_calls),
                commit_calls: Arc::clone(&commit_calls),
            },
            policy(),
        );

        assert!(
            scanner
                .scan(&schedule(), candidate(), Delivery::OnTime, clock)
                .is_err(),
            "{case} was accepted"
        );
        assert_eq!(loader_calls.load(Ordering::SeqCst), 0, "{case}");
        assert_eq!(find_calls.load(Ordering::SeqCst), 0, "{case}");
        assert_eq!(commit_calls.load(Ordering::SeqCst), 0, "{case}");
        rejected += 1;
    }

    assert_eq!(rejected, 3);
}
