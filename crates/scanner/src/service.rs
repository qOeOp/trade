use crate::{
    AttemptMeaning, ClockAdmission, CommitOutcome, ConditionFailure, Delivery, DomainError,
    DueSlotCandidate, EvidenceSet, MarketSnapshot, MatchEvaluation, MembershipMeaning,
    MembershipUnavailable, ProposalBuilder, ReceiptStoreError, ScannerReceipt, ScheduleDefinition,
    SlotResolutionError, SnapshotAdmissionPolicy, SnapshotEvidence, StrategyDisposition,
    StrategyLoader, StrategyMatcher, StrategyOutcome, TerminalReceiptStore,
};

#[derive(Clone, Debug, Eq, PartialEq)]
enum MembershipOwnerReadback {
    Resolved(crate::StrategyFrontier),
    Unresolved(MembershipUnavailable),
}

/// Exact Scanner Time + Governance membership readback admitted by their source Owners.
///
/// This capability is crate-private and has no production constructor in the static foundation.
/// Public `ClockAdmission`, `StrategyFrontier`, and `MembershipUnavailable` values remain
/// untrusted transport vocabulary.
struct ScannerOwnerResolvedAdmission {
    clock: ClockAdmission,
    membership: MembershipOwnerReadback,
}

impl ScannerOwnerResolvedAdmission {
    fn binds(&self, clock: &ClockAdmission, membership: &MembershipOwnerReadback) -> bool {
        self.clock == *clock && self.membership == *membership
    }

    #[cfg(test)]
    fn fixture_only(clock: &ClockAdmission, membership: &MembershipOwnerReadback) -> Self {
        Self {
            clock: clock.clone(),
            membership: membership.clone(),
        }
    }
}

/// Scanner service with an intentionally unavailable production F0 source-Owner resolve seam.
///
/// External callers cannot mint the sealed admission used by crate-internal contract tests:
///
/// ```compile_fail
/// let _admission = vibe_scanner::SourceOwnerResolvedAdmission::fixture_only();
/// ```
pub struct Scanner<L, S, M, P, R> {
    loader: L,
    snapshots: S,
    matcher: M,
    proposal_builder: P,
    receipts: R,
    admission_policy: SnapshotAdmissionPolicy,
    scanner_owner_admission:
        Option<fn(&ClockAdmission, &MembershipOwnerReadback) -> ScannerOwnerResolvedAdmission>,
    source_owner_admission: Option<
        fn(&crate::UntrustedSnapshotReadback) -> crate::authority::SourceOwnerResolvedAdmission,
    >,
}

impl<L, S, M, P, R> Scanner<L, S, M, P, R>
where
    L: StrategyLoader,
    S: MarketSnapshot,
    M: StrategyMatcher,
    P: ProposalBuilder,
    R: TerminalReceiptStore,
{
    pub const fn new(
        loader: L,
        snapshots: S,
        matcher: M,
        proposal_builder: P,
        receipts: R,
        admission_policy: SnapshotAdmissionPolicy,
    ) -> Self {
        Self {
            loader,
            snapshots,
            matcher,
            proposal_builder,
            receipts,
            admission_policy,
            scanner_owner_admission: None,
            source_owner_admission: None,
        }
    }

    #[cfg(test)]
    pub(crate) const fn new_with_source_owner_fixture(
        loader: L,
        snapshots: S,
        matcher: M,
        proposal_builder: P,
        receipts: R,
        admission_policy: SnapshotAdmissionPolicy,
    ) -> Self {
        Self {
            loader,
            snapshots,
            matcher,
            proposal_builder,
            receipts,
            admission_policy,
            scanner_owner_admission: Some(ScannerOwnerResolvedAdmission::fixture_only),
            source_owner_admission: Some(
                crate::authority::SourceOwnerResolvedAdmission::fixture_only,
            ),
        }
    }

    pub fn scan(
        &self,
        schedule: &ScheduleDefinition,
        candidate: DueSlotCandidate,
        delivery: Delivery,
        clock_admission: ClockAdmission,
    ) -> Result<ScanOutcome, ScannerError> {
        let Some(admit_scanner_owner_readback) = self.scanner_owner_admission else {
            return Err(ScannerError::OwnerResolveUnavailable);
        };
        let submitted_clock = clock_admission.clone();
        let Some(due_slot) = schedule.resolve_due_slot(candidate, delivery, clock_admission)?
        else {
            return Ok(ScanOutcome::Skipped);
        };

        let membership_readback = match self.loader.load(&due_slot) {
            Ok(frontier) => MembershipOwnerReadback::Resolved(frontier),
            Err(unavailable) => MembershipOwnerReadback::Unresolved(unavailable),
        };
        let scanner_owner_admission =
            admit_scanner_owner_readback(&submitted_clock, &membership_readback);
        if !scanner_owner_admission.binds(&submitted_clock, &membership_readback) {
            return Err(ScannerError::OwnerResolveBindingMismatch);
        }

        let frontier = match membership_readback {
            MembershipOwnerReadback::Resolved(frontier) => frontier,
            MembershipOwnerReadback::Unresolved(unavailable) => {
                let observed = unavailable
                    .observed
                    .iter()
                    .map(|item| (item.strategy().clone(), item.evidence().clone()))
                    .collect();
                let meaning = AttemptMeaning {
                    schedule: schedule.clone(),
                    admission_policy: self.admission_policy.clone(),
                    membership: MembershipMeaning::Unresolved {
                        disposition: unavailable.disposition.clone(),
                        source_cut: unavailable.source_cut.clone(),
                        terminal_reason: unavailable.terminal_reason.clone(),
                        observed,
                    },
                };

                if let Some(receipt) = self.join_existing(&due_slot.attempt_id, &meaning)? {
                    return Ok(ScanOutcome::Terminal(Box::new(receipt)));
                }
                let receipt = ScannerReceipt::membership_unresolved(
                    due_slot.attempt_id,
                    meaning,
                    unavailable,
                )?;
                return Ok(ScanOutcome::Terminal(Box::new(
                    self.receipts.commit_or_join(receipt)?,
                )));
            }
        };

        let (registry_frontier, strategies) = frontier.into_parts();
        let meaning = AttemptMeaning {
            schedule: schedule.clone(),
            admission_policy: self.admission_policy.clone(),
            membership: MembershipMeaning::Resolved {
                registry_frontier,
                expected: strategies.clone(),
            },
        };

        if let Some(receipt) = self.join_existing(&due_slot.attempt_id, &meaning)? {
            return Ok(ScanOutcome::Terminal(Box::new(receipt)));
        }

        let mut dispositions = Vec::with_capacity(strategies.len());
        for strategy in strategies.into_values() {
            let disposition = match self.snapshots.snapshot(&due_slot, &strategy) {
                Ok(readback) => {
                    let rejection_evidence = readback.auxiliary.clone();
                    let Some(admit_source_owner_readback) = self.source_owner_admission else {
                        dispositions.push(StrategyDisposition::input_unavailable(
                            strategy,
                            None,
                            None,
                            rejection_evidence,
                            Some(crate::InputMismatch::SourceOwnerResolveUnavailable),
                        ));
                        continue;
                    };
                    let source_owner_admission = admit_source_owner_readback(&readback);

                    match self.admission_policy.admit(
                        &source_owner_admission,
                        &due_slot,
                        &strategy,
                        readback,
                    ) {
                        Ok(snapshot) => self.evaluate(strategy, snapshot)?,
                        Err(mismatch) => StrategyDisposition::input_unavailable(
                            strategy,
                            None,
                            None,
                            rejection_evidence,
                            Some(mismatch),
                        ),
                    }
                }
                Err(unavailable) => StrategyDisposition::input_unavailable(
                    strategy,
                    None,
                    None,
                    unavailable.into_evidence(),
                    None,
                ),
            };
            dispositions.push(disposition);
        }

        let matched = dispositions
            .iter()
            .filter(|item| item.outcome() == StrategyOutcome::Matched)
            .cloned()
            .collect::<Vec<_>>();
        let (proposal, operational_failure) = if matched.is_empty() {
            (None, None)
        } else {
            match self.proposal_builder.build(&matched) {
                Ok(proposal) => (Some(proposal), None),
                Err(failure) => (None, Some(failure)),
            }
        };
        let receipt = ScannerReceipt::complete(
            due_slot.attempt_id,
            meaning,
            dispositions,
            proposal,
            operational_failure,
        )?;
        Ok(ScanOutcome::Terminal(Box::new(
            self.receipts.commit_or_join(receipt)?,
        )))
    }

    fn join_existing(
        &self,
        attempt_id: &crate::AttemptId,
        meaning: &AttemptMeaning,
    ) -> Result<Option<CommitOutcome>, ScannerError> {
        let Some(receipt) = self.receipts.find(attempt_id)? else {
            return Ok(None);
        };

        if receipt.meaning() != meaning {
            return Err(ReceiptStoreError::SemanticConflict {
                attempt_id: attempt_id.clone(),
            }
            .into());
        }
        Ok(Some(CommitOutcome {
            kind: crate::CommitKind::Joined,
            receipt,
        }))
    }

    fn evaluate(
        &self,
        strategy: crate::StrategyBinding,
        snapshot: SnapshotEvidence,
    ) -> Result<StrategyDisposition, ScannerError> {
        let (outcome, evidence) = match self.matcher.evaluate(&strategy, &snapshot) {
            Ok(MatchEvaluation::Matched { evidence }) => (StrategyOutcome::Matched, evidence),
            Ok(MatchEvaluation::NoMatch { evidence }) => (StrategyOutcome::NoMatch, evidence),
            Ok(MatchEvaluation::InsufficientData { evidence }) => {
                (StrategyOutcome::InsufficientData, evidence)
            }
            Err(ConditionFailure { evidence }) => (StrategyOutcome::ConditionFailed, evidence),
        };
        let (market, capacity, auxiliary) = snapshot.into_parts();
        let mut combined = auxiliary.into_inner();
        combined.extend(evidence.into_inner());
        Ok(StrategyDisposition::evaluated(
            strategy,
            outcome,
            market,
            capacity,
            EvidenceSet::new(combined)?,
        ))
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ScanOutcome {
    Skipped,
    Terminal(Box<CommitOutcome>),
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ScannerError {
    OwnerResolveUnavailable,
    OwnerResolveBindingMismatch,
    Slot(SlotResolutionError),
    Domain(DomainError),
    ReceiptStore(ReceiptStoreError),
}

impl From<SlotResolutionError> for ScannerError {
    fn from(error: SlotResolutionError) -> Self {
        Self::Slot(error)
    }
}

impl From<DomainError> for ScannerError {
    fn from(error: DomainError) -> Self {
        Self::Domain(error)
    }
}

impl From<ReceiptStoreError> for ScannerError {
    fn from(error: ReceiptStoreError) -> Self {
        Self::ReceiptStore(error)
    }
}
