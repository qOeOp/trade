use crate::{
    AttemptId, BatchOperationalFailure, CapacityViewCut, DueSlot, EvidenceSet, MarketFactCut,
    MembershipUnavailable, OpaqueId, ProposalEvidence, ScannerReceipt, StrategyBinding,
    StrategyDisposition, StrategyFrontier, UntrustedSnapshotReadback,
};

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SnapshotEvidence {
    market_fact_cut: MarketFactCut,
    capacity_view_cut: Option<CapacityViewCut>,
    auxiliary: EvidenceSet,
}

impl SnapshotEvidence {
    pub(crate) const fn admitted(
        market_fact_cut: MarketFactCut,
        capacity_view_cut: Option<CapacityViewCut>,
        auxiliary: EvidenceSet,
    ) -> Self {
        Self {
            market_fact_cut,
            capacity_view_cut,
            auxiliary,
        }
    }

    pub const fn market_fact_cut(&self) -> &MarketFactCut {
        &self.market_fact_cut
    }

    pub const fn capacity_view_cut(&self) -> Option<&CapacityViewCut> {
        self.capacity_view_cut.as_ref()
    }

    pub const fn auxiliary(&self) -> &EvidenceSet {
        &self.auxiliary
    }

    pub(crate) fn into_parts(self) -> (MarketFactCut, Option<CapacityViewCut>, EvidenceSet) {
        (self.market_fact_cut, self.capacity_view_cut, self.auxiliary)
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct InputUnavailable {
    evidence: EvidenceSet,
}

impl InputUnavailable {
    pub const fn new(evidence: EvidenceSet) -> Self {
        Self { evidence }
    }

    pub const fn evidence(&self) -> &EvidenceSet {
        &self.evidence
    }

    pub(crate) fn into_evidence(self) -> EvidenceSet {
        self.evidence
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum MatchEvaluation {
    Matched { evidence: EvidenceSet },
    NoMatch { evidence: EvidenceSet },
    InsufficientData { evidence: EvidenceSet },
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ConditionFailure {
    pub evidence: EvidenceSet,
}

pub trait StrategyLoader {
    fn load(&self, due_slot: &DueSlot) -> Result<StrategyFrontier, MembershipUnavailable>;
}

pub trait MarketSnapshot {
    fn snapshot(
        &self,
        due_slot: &DueSlot,
        strategy: &StrategyBinding,
    ) -> Result<UntrustedSnapshotReadback, InputUnavailable>;
}

pub trait StrategyMatcher {
    fn evaluate(
        &self,
        strategy: &StrategyBinding,
        snapshot: &SnapshotEvidence,
    ) -> Result<MatchEvaluation, ConditionFailure>;
}

pub trait ProposalBuilder {
    fn build(
        &self,
        matched: &[StrategyDisposition],
    ) -> Result<ProposalEvidence, BatchOperationalFailure>;
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CommitKind {
    Committed,
    Joined,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CommitOutcome {
    pub kind: CommitKind,
    pub receipt: ScannerReceipt,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ReceiptStoreError {
    SemanticConflict { attempt_id: AttemptId },
    Unavailable { evidence: OpaqueId },
}

pub trait TerminalReceiptStore {
    fn find(&self, attempt_id: &AttemptId) -> Result<Option<ScannerReceipt>, ReceiptStoreError>;

    /// Atomically commits the first receipt, joins an equal-meaning receipt, and rejects conflicts.
    fn commit_or_join(&self, receipt: ScannerReceipt) -> Result<CommitOutcome, ReceiptStoreError>;
}
