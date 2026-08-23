use crate::{Proposal, ProposalEvidence, StrategyBinding, StrategyDisposition};
use std::collections::{BTreeMap, BTreeSet};
use std::fmt::Display;

#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct OpaqueId(String);

impl OpaqueId {
    pub fn new(value: impl Into<String>) -> Result<Self, DomainError> {
        let value = value.into();
        if value.trim().is_empty() {
            return Err(DomainError::EmptyIdentity);
        }
        Ok(Self(value))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl Display for OpaqueId {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.0.fmt(formatter)
    }
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct Version(u64);

impl Version {
    pub fn new(value: u64) -> Result<Self, DomainError> {
        if value == 0 {
            return Err(DomainError::ZeroVersion);
        }
        Ok(Self(value))
    }

    pub const fn get(self) -> u64 {
        self.0
    }
}

#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct VersionedIdentity {
    pub identity: OpaqueId,
    pub version: Version,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum FoldDisposition {
    First,
    Second,
    Both,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum GapDisposition {
    Skip,
    ShiftForward,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MisfirePolicy {
    Skip,
    FireOnce,
    Backfill,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ScheduleDefinition {
    pub definition: VersionedIdentity,
    pub scan_scope: VersionedIdentity,
    pub cadence: OpaqueId,
    pub calendar_time_zone: OpaqueId,
    pub fold_disposition: FoldDisposition,
    pub gap_disposition: GapDisposition,
    pub misfire_policy: MisfirePolicy,
    pub shared_clock: OpaqueId,
    pub effective_interval: OpaqueId,
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct LocalDateTime {
    pub year: i32,
    pub month: u8,
    pub day: u8,
    pub hour: u8,
    pub minute: u8,
    pub second: u8,
}

impl LocalDateTime {
    pub fn new(
        year: i32,
        month: u8,
        day: u8,
        hour: u8,
        minute: u8,
        second: u8,
    ) -> Result<Self, DomainError> {
        let max_day = days_in_month(year, month).ok_or(DomainError::InvalidLocalDateTime)?;
        if day == 0 || day > max_day || hour > 23 || minute > 59 || second > 59 {
            return Err(DomainError::InvalidLocalDateTime);
        }
        Ok(Self {
            year,
            month,
            day,
            hour,
            minute,
            second,
        })
    }
}

const fn days_in_month(year: i32, month: u8) -> Option<u8> {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => Some(31),
        4 | 6 | 9 | 11 => Some(30),
        2 if year % 400 == 0 || (year % 4 == 0 && year % 100 != 0) => Some(29),
        2 => Some(28),
        _ => None,
    }
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub enum FoldOccurrence {
    First,
    Second,
}

#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub enum DueSlotBoundary {
    Normal {
        local: LocalDateTime,
        utc_offset_seconds: i32,
    },
    Fold {
        local: LocalDateTime,
        occurrence: FoldOccurrence,
        utc_offset_seconds: i32,
    },
    GapShifted {
        intended: LocalDateTime,
        shifted_to: LocalDateTime,
        utc_offset_seconds: i32,
    },
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DueSlotCandidate {
    Normal {
        local: LocalDateTime,
        utc_offset_seconds: i32,
    },
    Fold {
        local: LocalDateTime,
        occurrence: FoldOccurrence,
        utc_offset_seconds: i32,
    },
    Gap {
        intended: LocalDateTime,
        shifted_to: LocalDateTime,
        utc_offset_seconds: i32,
    },
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Delivery {
    OnTime,
    Misfired { observed_at_unix_seconds: i64 },
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct UnixTimestamp(i64);

impl UnixTimestamp {
    pub const fn new(seconds: i64) -> Self {
        Self(seconds)
    }

    pub const fn seconds(self) -> i64 {
        self.0
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ClockAdmission {
    Admitted {
        epoch: u64,
        evidence: OpaqueId,
        observed_at: UnixTimestamp,
    },
    Unavailable,
}

#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct AttemptId {
    pub definition: VersionedIdentity,
    pub scan_scope: VersionedIdentity,
    pub boundary: DueSlotBoundary,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DueSlot {
    pub attempt_id: AttemptId,
    pub clock_admission: ClockAdmission,
}

impl DueSlot {
    pub fn due_at(&self) -> UnixTimestamp {
        let (local, offset) = match &self.attempt_id.boundary {
            DueSlotBoundary::Normal {
                local,
                utc_offset_seconds,
            }
            | DueSlotBoundary::Fold {
                local,
                utc_offset_seconds,
                ..
            } => (*local, *utc_offset_seconds),
            DueSlotBoundary::GapShifted {
                shifted_to,
                utc_offset_seconds,
                ..
            } => (*shifted_to, *utc_offset_seconds),
        };
        UnixTimestamp::new(
            days_from_civil(local.year, local.month, local.day) * 86_400
                + i64::from(local.hour) * 3_600
                + i64::from(local.minute) * 60
                + i64::from(local.second)
                - i64::from(offset),
        )
    }

    pub const fn clock_epoch(&self) -> u64 {
        match self.clock_admission {
            ClockAdmission::Admitted { epoch, .. } => epoch,
            ClockAdmission::Unavailable => unreachable!(),
        }
    }

    pub const fn time_evidence(&self) -> &OpaqueId {
        match &self.clock_admission {
            ClockAdmission::Admitted { evidence, .. } => evidence,
            ClockAdmission::Unavailable => unreachable!(),
        }
    }

    pub const fn observed_at(&self) -> UnixTimestamp {
        match self.clock_admission {
            ClockAdmission::Admitted { observed_at, .. } => observed_at,
            ClockAdmission::Unavailable => unreachable!(),
        }
    }
}

fn days_from_civil(year: i32, month: u8, day: u8) -> i64 {
    let year = i64::from(year) - i64::from(month <= 2);
    let era = if year >= 0 { year } else { year - 399 } / 400;
    let year_of_era = year - era * 400;
    let month = i64::from(month);
    let day_of_year = (153 * (month + if month > 2 { -3 } else { 9 }) + 2) / 5 + i64::from(day) - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era - 719_468
}

impl ScheduleDefinition {
    #[allow(
        clippy::needless_pass_by_value,
        reason = "a due-slot candidate is a consumed scheduling command, not shared state"
    )]
    pub fn resolve_due_slot(
        &self,
        candidate: DueSlotCandidate,
        delivery: Delivery,
        clock_admission: ClockAdmission,
    ) -> Result<Option<DueSlot>, SlotResolutionError> {
        if matches!(clock_admission, ClockAdmission::Unavailable) {
            return Err(SlotResolutionError::ClockEvidenceUnavailable);
        }

        if matches!(delivery, Delivery::Misfired { .. })
            && self.misfire_policy == MisfirePolicy::Skip
        {
            return Ok(None);
        }

        let boundary = match candidate {
            DueSlotCandidate::Normal {
                local,
                utc_offset_seconds,
            } => DueSlotBoundary::Normal {
                local,
                utc_offset_seconds: checked_offset(utc_offset_seconds)?,
            },
            DueSlotCandidate::Fold {
                local,
                occurrence,
                utc_offset_seconds,
            } => {
                let admitted = matches!(
                    (self.fold_disposition, occurrence),
                    (
                        FoldDisposition::First | FoldDisposition::Both,
                        FoldOccurrence::First
                    ) | (
                        FoldDisposition::Second | FoldDisposition::Both,
                        FoldOccurrence::Second
                    )
                );

                if !admitted {
                    return Ok(None);
                }
                DueSlotBoundary::Fold {
                    local,
                    occurrence,
                    utc_offset_seconds: checked_offset(utc_offset_seconds)?,
                }
            }
            DueSlotCandidate::Gap {
                intended,
                shifted_to,
                utc_offset_seconds,
            } => {
                if self.gap_disposition == GapDisposition::Skip {
                    return Ok(None);
                }

                if shifted_to <= intended {
                    return Err(SlotResolutionError::InvalidGapShift);
                }
                DueSlotBoundary::GapShifted {
                    intended,
                    shifted_to,
                    utc_offset_seconds: checked_offset(utc_offset_seconds)?,
                }
            }
        };

        Ok(Some(DueSlot {
            attempt_id: AttemptId {
                definition: self.definition.clone(),
                scan_scope: self.scan_scope.clone(),
                boundary,
            },
            clock_admission,
        }))
    }
}

fn checked_offset(offset: i32) -> Result<i32, SlotResolutionError> {
    if (-86_399..=86_399).contains(&offset) {
        Ok(offset)
    } else {
        Err(SlotResolutionError::InvalidUtcOffset)
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ObservedMemberFact {
    strategy: OpaqueId,
    evidence: EvidenceSet,
}

impl ObservedMemberFact {
    pub const fn new(strategy: OpaqueId, evidence: EvidenceSet) -> Self {
        Self { strategy, evidence }
    }

    pub const fn strategy(&self) -> &OpaqueId {
        &self.strategy
    }

    pub const fn evidence(&self) -> &EvidenceSet {
        &self.evidence
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MembershipUnavailable {
    pub disposition: OpaqueId,
    pub source_cut: OpaqueId,
    pub terminal_reason: OpaqueId,
    pub observed: Vec<ObservedMemberFact>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum MembershipMeaning {
    Resolved {
        registry_frontier: OpaqueId,
        expected: BTreeMap<OpaqueId, StrategyBinding>,
    },
    Unresolved {
        disposition: OpaqueId,
        source_cut: OpaqueId,
        terminal_reason: OpaqueId,
        observed: BTreeMap<OpaqueId, EvidenceSet>,
    },
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AttemptMeaning {
    pub schedule: ScheduleDefinition,
    pub admission_policy: crate::SnapshotAdmissionPolicy,
    pub membership: MembershipMeaning,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum StrategyOutcome {
    Matched,
    NoMatch,
    InsufficientData,
    InputUnavailable,
    ConditionFailed,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EvidenceSet(BTreeSet<OpaqueId>);

impl EvidenceSet {
    pub fn new(values: impl IntoIterator<Item = OpaqueId>) -> Result<Self, DomainError> {
        let values = values.into_iter().collect::<BTreeSet<_>>();
        if values.is_empty() {
            return Err(DomainError::MissingEvidence);
        }
        Ok(Self(values))
    }

    pub fn singleton(value: OpaqueId) -> Self {
        Self(BTreeSet::from([value]))
    }

    pub fn contains(&self, value: &OpaqueId) -> bool {
        self.0.contains(value)
    }

    pub fn into_inner(self) -> BTreeSet<OpaqueId> {
        self.0
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum BatchFailureCategory {
    SchedulerOrchestrationFailure,
    ScannerServiceFailure,
    SharedDependencyOperationalFailure,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BatchOperationalFailure {
    pub category: BatchFailureCategory,
    pub failure_identity: OpaqueId,
    pub evidence_source_cut: OpaqueId,
    pub time_evidence: OpaqueId,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum FailedReason {
    IncompleteKnown { terminal_reason: OpaqueId },
    MembershipUnresolved { terminal_reason: OpaqueId },
    BatchOperational(BatchOperationalFailure),
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ReceiptStatus {
    Proposed,
    CompletedNoProposal,
    InsufficientData,
    NoMatch,
    Failed(FailedReason),
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct MissingMembersUnavailable;

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum MembershipBranch {
    Resolved {
        expected: BTreeSet<OpaqueId>,
        observed: BTreeSet<OpaqueId>,
        missing: BTreeSet<OpaqueId>,
    },
    Unresolved {
        disposition: OpaqueId,
        source_cut: OpaqueId,
        observed: BTreeMap<OpaqueId, EvidenceSet>,
        missing_members_unavailable: MissingMembersUnavailable,
    },
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ScannerReceipt {
    attempt_id: AttemptId,
    meaning: AttemptMeaning,
    status: ReceiptStatus,
    membership: MembershipBranch,
    dispositions: BTreeMap<OpaqueId, StrategyDisposition>,
    proposal: Option<Proposal>,
}

impl ScannerReceipt {
    pub const fn attempt_id(&self) -> &AttemptId {
        &self.attempt_id
    }

    pub const fn meaning(&self) -> &AttemptMeaning {
        &self.meaning
    }

    pub const fn status(&self) -> &ReceiptStatus {
        &self.status
    }

    pub const fn membership(&self) -> &MembershipBranch {
        &self.membership
    }

    pub const fn dispositions(&self) -> &BTreeMap<OpaqueId, StrategyDisposition> {
        &self.dispositions
    }

    pub const fn proposal(&self) -> Option<&Proposal> {
        self.proposal.as_ref()
    }

    pub(crate) fn complete(
        attempt_id: AttemptId,
        meaning: AttemptMeaning,
        dispositions: impl IntoIterator<Item = StrategyDisposition>,
        proposal_evidence: Option<ProposalEvidence>,
        operational_failure: Option<BatchOperationalFailure>,
    ) -> Result<Self, DomainError> {
        validate_attempt_meaning(&attempt_id, &meaning)?;
        let expected = resolved_expected(&meaning)?;
        let dispositions = index_dispositions(dispositions)?;
        validate_expected_bindings(expected, &dispositions)?;
        let expected_ids = expected.keys().cloned().collect::<BTreeSet<_>>();
        let observed = dispositions.keys().cloned().collect::<BTreeSet<_>>();
        if expected_ids != observed {
            return Err(DomainError::IncompleteCompleteReceipt);
        }

        let matched = dispositions
            .values()
            .filter(|item| item.outcome() == StrategyOutcome::Matched)
            .collect::<Vec<_>>();

        let (status, proposal) = if let Some(failure) = operational_failure {
            if proposal_evidence.is_some() {
                return Err(DomainError::UnexpectedProposal);
            }
            (
                ReceiptStatus::Failed(FailedReason::BatchOperational(failure)),
                None,
            )
        } else if !matched.is_empty() {
            let evidence = proposal_evidence.ok_or(DomainError::MissingProposal)?;
            (
                ReceiptStatus::Proposed,
                Some(Proposal::from_matched(evidence, matched)?),
            )
        } else {
            if proposal_evidence.is_some() {
                return Err(DomainError::UnexpectedProposal);
            }
            let status = aggregate_without_match(dispositions.values());
            (status, None)
        };

        Ok(Self {
            attempt_id,
            meaning,
            status,
            membership: MembershipBranch::Resolved {
                expected: expected_ids,
                observed,
                missing: BTreeSet::new(),
            },
            dispositions,
            proposal,
        })
    }

    pub fn incomplete_known(
        attempt_id: AttemptId,
        meaning: AttemptMeaning,
        observed: impl IntoIterator<Item = StrategyDisposition>,
        terminal_reason: OpaqueId,
    ) -> Result<Self, DomainError> {
        validate_attempt_meaning(&attempt_id, &meaning)?;
        let expected = resolved_expected(&meaning)?;
        let dispositions = index_dispositions(observed)?;
        validate_observed_bindings(expected, &dispositions)?;
        let expected_ids = expected.keys().cloned().collect::<BTreeSet<_>>();
        let observed_ids = dispositions.keys().cloned().collect::<BTreeSet<_>>();
        let missing = expected_ids
            .difference(&observed_ids)
            .cloned()
            .collect::<BTreeSet<_>>();

        if missing.is_empty() {
            return Err(DomainError::CompleteSetCannotBeIncomplete);
        }
        Ok(Self {
            attempt_id,
            meaning,
            status: ReceiptStatus::Failed(FailedReason::IncompleteKnown { terminal_reason }),
            membership: MembershipBranch::Resolved {
                expected: expected_ids,
                observed: observed_ids,
                missing,
            },
            dispositions,
            proposal: None,
        })
    }

    pub(crate) fn membership_unresolved(
        attempt_id: AttemptId,
        meaning: AttemptMeaning,
        unavailable: MembershipUnavailable,
    ) -> Result<Self, DomainError> {
        validate_attempt_meaning(&attempt_id, &meaning)?;
        let MembershipMeaning::Unresolved {
            disposition,
            source_cut,
            terminal_reason,
            observed,
        } = &meaning.membership
        else {
            return Err(DomainError::ExpectedUnresolvedMembership);
        };
        let mut observed_facts = BTreeMap::new();

        for fact in unavailable.observed {
            let identity = fact.strategy().clone();
            if observed_facts
                .insert(identity.clone(), fact.evidence)
                .is_some()
            {
                return Err(DomainError::DuplicateDisposition(identity));
            }
        }

        if unavailable.disposition != *disposition
            || unavailable.source_cut != *source_cut
            || unavailable.terminal_reason != *terminal_reason
            || observed_facts != *observed
        {
            return Err(DomainError::MembershipMeaningConflict);
        }
        Ok(Self {
            attempt_id,
            meaning,
            status: ReceiptStatus::Failed(FailedReason::MembershipUnresolved {
                terminal_reason: unavailable.terminal_reason,
            }),
            membership: MembershipBranch::Unresolved {
                disposition: unavailable.disposition,
                source_cut: unavailable.source_cut,
                observed: observed_facts,
                missing_members_unavailable: MissingMembersUnavailable,
            },
            dispositions: BTreeMap::new(),
            proposal: None,
        })
    }
}

fn resolved_expected(
    meaning: &AttemptMeaning,
) -> Result<&BTreeMap<OpaqueId, StrategyBinding>, DomainError> {
    match &meaning.membership {
        MembershipMeaning::Resolved { expected, .. } => {
            if expected
                .iter()
                .any(|(identity, binding)| identity != binding.strategy())
            {
                return Err(DomainError::MembershipMeaningConflict);
            }
            Ok(expected)
        }
        MembershipMeaning::Unresolved { .. } => Err(DomainError::ExpectedResolvedMembership),
    }
}

fn validate_attempt_meaning(
    attempt_id: &AttemptId,
    meaning: &AttemptMeaning,
) -> Result<(), DomainError> {
    if attempt_id.definition != meaning.schedule.definition
        || attempt_id.scan_scope != meaning.schedule.scan_scope
    {
        return Err(DomainError::AttemptMeaningConflict);
    }
    Ok(())
}

fn index_dispositions(
    dispositions: impl IntoIterator<Item = StrategyDisposition>,
) -> Result<BTreeMap<OpaqueId, StrategyDisposition>, DomainError> {
    let mut indexed = BTreeMap::new();

    for disposition in dispositions {
        let identity = disposition.binding().strategy().clone();
        if indexed.insert(identity.clone(), disposition).is_some() {
            return Err(DomainError::DuplicateDisposition(identity));
        }
    }
    Ok(indexed)
}

fn validate_expected_bindings(
    expected: &BTreeMap<OpaqueId, StrategyBinding>,
    observed: &BTreeMap<OpaqueId, StrategyDisposition>,
) -> Result<(), DomainError> {
    validate_observed_bindings(expected, observed)?;
    if expected.len() != observed.len() {
        return Err(DomainError::IncompleteCompleteReceipt);
    }
    Ok(())
}

fn validate_observed_bindings(
    expected: &BTreeMap<OpaqueId, StrategyBinding>,
    observed: &BTreeMap<OpaqueId, StrategyDisposition>,
) -> Result<(), DomainError> {
    for (identity, disposition) in observed {
        if expected.get(identity) != Some(disposition.binding()) {
            return Err(DomainError::UnexpectedStrategy(identity.clone()));
        }
    }
    Ok(())
}

fn aggregate_without_match<'a>(
    dispositions: impl IntoIterator<Item = &'a StrategyDisposition>,
) -> ReceiptStatus {
    let mut has_condition_failure = false;
    let mut has_insufficient_data = false;

    for disposition in dispositions {
        match disposition.outcome() {
            StrategyOutcome::Matched => unreachable!("matched outcomes are handled first"),
            StrategyOutcome::ConditionFailed => has_condition_failure = true,
            StrategyOutcome::InsufficientData | StrategyOutcome::InputUnavailable => {
                has_insufficient_data = true;
            }
            StrategyOutcome::NoMatch => {}
        }
    }

    if has_condition_failure {
        ReceiptStatus::CompletedNoProposal
    } else if has_insufficient_data {
        ReceiptStatus::InsufficientData
    } else {
        ReceiptStatus::NoMatch
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DomainError {
    EmptyIdentity,
    ZeroVersion,
    InvalidLocalDateTime,
    DuplicateStrategy(OpaqueId),
    DuplicateDisposition(OpaqueId),
    MissingEvidence,
    ExpectedResolvedMembership,
    ExpectedUnresolvedMembership,
    UnexpectedStrategy(OpaqueId),
    IncompleteCompleteReceipt,
    CompleteSetCannotBeIncomplete,
    MissingProposal,
    UnexpectedProposal,
    MembershipMeaningConflict,
    AttemptMeaningConflict,
    IncompleteProposalEvidence(OpaqueId),
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SlotResolutionError {
    ClockEvidenceUnavailable,
    InvalidGapShift,
    InvalidUtcOffset,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        ActivationConditionContract, DataRequirementContract, GovernedArtifactRef,
        LifecycleConstraints, UniverseSelectionRequirement,
    };
    use rstest::rstest;

    fn id(value: &str) -> OpaqueId {
        OpaqueId::new(value).unwrap()
    }

    fn version() -> Version {
        Version::new(1).unwrap()
    }

    #[rstest]
    fn complete_receipt_rejects_a_partial_expected_set() {
        let strategy = StrategyBinding::new(
            id("strategy"),
            GovernedArtifactRef::new(id("artifact"), version()),
            ActivationConditionContract::new(id("condition"), version()),
            DataRequirementContract::new(id("data"), version()),
            LifecycleConstraints::new(id("lifecycle"), version()),
            UniverseSelectionRequirement::new(id("universe"), version()),
            None,
        );
        let expected = BTreeMap::from([(strategy.strategy().clone(), strategy)]);
        assert_eq!(
            validate_expected_bindings(&expected, &BTreeMap::new()),
            Err(DomainError::IncompleteCompleteReceipt)
        );
    }
}
