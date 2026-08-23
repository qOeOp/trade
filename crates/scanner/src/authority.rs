use crate::{DomainError, OpaqueId, StrategyOutcome, Version, VersionedIdentity};
use std::collections::{BTreeMap, BTreeSet};

macro_rules! versioned_authority {
    ($($name:ident),+ $(,)?) => {$(
        #[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
        pub struct $name(VersionedIdentity);

        impl $name {
            pub const fn new(identity: OpaqueId, version: Version) -> Self {
                Self(VersionedIdentity { identity, version })
            }

            pub const fn identity(&self) -> &OpaqueId {
                &self.0.identity
            }

            pub const fn version(&self) -> Version {
                self.0.version
            }
        }
    )+};
}

macro_rules! opaque_authority {
    ($($name:ident),+ $(,)?) => {$(
        #[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
        pub struct $name(OpaqueId);

        impl $name {
            pub const fn new(identity: OpaqueId) -> Self {
                Self(identity)
            }

            pub const fn identity(&self) -> &OpaqueId {
                &self.0
            }
        }
    )+};
}

versioned_authority!(
    GovernedArtifactRef,
    ActivationConditionContract,
    DataRequirementContract,
    LifecycleConstraints,
    UniverseSelectionRequirement,
    CapacityRequirementContract,
    CapitalPoolMethod,
    CapitalPoolAssumptions,
);

opaque_authority!(
    CandidateIndependentCapacityScope,
    SourceOwner,
    SourceNode,
    RecordIdentity,
    ContentDigest,
    SnapshotCut,
    CompatibilityCut,
    SemanticScope,
    FrontierLineage,
);

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SourceFrontier {
    lineage: FrontierLineage,
    sequence: u64,
}

impl SourceFrontier {
    pub const fn new(lineage: FrontierLineage, sequence: u64) -> Self {
        Self { lineage, sequence }
    }

    pub const fn lineage(&self) -> &FrontierLineage {
        &self.lineage
    }

    pub const fn sequence(&self) -> u64 {
        self.sequence
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OwnerSource {
    owner: SourceOwner,
    node: SourceNode,
}

impl OwnerSource {
    pub const fn new(owner: SourceOwner, node: SourceNode) -> Self {
        Self { owner, node }
    }

    pub const fn owner(&self) -> &SourceOwner {
        &self.owner
    }

    pub const fn node(&self) -> &SourceNode {
        &self.node
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FrontierRequirement {
    lineage: FrontierLineage,
    minimum_sequence: u64,
}

impl FrontierRequirement {
    pub const fn new(lineage: FrontierLineage, minimum_sequence: u64) -> Self {
        Self {
            lineage,
            minimum_sequence,
        }
    }

    pub const fn lineage(&self) -> &FrontierLineage {
        &self.lineage
    }

    pub const fn minimum_sequence(&self) -> u64 {
        self.minimum_sequence
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SnapshotAdmissionPolicy {
    identity: VersionedIdentity,
    market_source: OwnerSource,
    capacity_source: OwnerSource,
    market_frontier: FrontierRequirement,
    capacity_frontier: FrontierRequirement,
    semantic_scope: SemanticScope,
    compatibility_cut: CompatibilityCut,
}

/// Sealed handoff point for the repository-native F0 direct source-Owner resolve contract.
///
/// Production code cannot construct this admission. Future Market Data/Portfolio integration may
/// create it only after directly resolving the actual Owner fact store/outbox, re-reading canonical
/// bytes, and authenticating every field consumed by `admit`.
pub(crate) struct SourceOwnerResolvedAdmission {
    bound_readback: UntrustedSnapshotReadback,
}

#[cfg(test)]
impl SourceOwnerResolvedAdmission {
    pub(crate) fn fixture_only(readback: &UntrustedSnapshotReadback) -> Self {
        Self {
            bound_readback: readback.clone(),
        }
    }
}

impl SourceOwnerResolvedAdmission {
    fn binds(&self, readback: &UntrustedSnapshotReadback) -> bool {
        self.bound_readback == *readback
    }
}

impl SnapshotAdmissionPolicy {
    pub const fn new(
        identity: VersionedIdentity,
        market_source: OwnerSource,
        capacity_source: OwnerSource,
        market_frontier: FrontierRequirement,
        capacity_frontier: FrontierRequirement,
        semantic_scope: SemanticScope,
        compatibility_cut: CompatibilityCut,
    ) -> Self {
        Self {
            identity,
            market_source,
            capacity_source,
            market_frontier,
            capacity_frontier,
            semantic_scope,
            compatibility_cut,
        }
    }

    pub const fn identity(&self) -> &VersionedIdentity {
        &self.identity
    }

    pub const fn market_source(&self) -> &OwnerSource {
        &self.market_source
    }

    pub const fn capacity_source(&self) -> &OwnerSource {
        &self.capacity_source
    }

    pub const fn market_frontier(&self) -> &FrontierRequirement {
        &self.market_frontier
    }

    pub const fn capacity_frontier(&self) -> &FrontierRequirement {
        &self.capacity_frontier
    }

    pub const fn semantic_scope(&self) -> &SemanticScope {
        &self.semantic_scope
    }

    pub const fn compatibility_cut(&self) -> &CompatibilityCut {
        &self.compatibility_cut
    }

    pub(crate) fn admit(
        &self,
        source_owner_admission: &SourceOwnerResolvedAdmission,
        due_slot: &crate::DueSlot,
        binding: &StrategyBinding,
        readback: UntrustedSnapshotReadback,
    ) -> Result<crate::SnapshotEvidence, InputMismatch> {
        if !source_owner_admission.binds(&readback) {
            return Err(InputMismatch::SourceOwnerResolveBindingMismatch);
        }

        let market = MarketFactCut::admit(self, due_slot, binding, readback.market_fact_cut)?;
        let capacity = match (binding.capacity_requirement(), readback.capacity_view_cut) {
            (Some(required), Some(readback)) => Some(CapacityViewCut::admit(
                self, due_slot, required, &market, readback,
            )?),
            (Some(_), None) => return Err(InputMismatch::CapacityMissing),
            (None, _) => None,
        };
        Ok(crate::SnapshotEvidence::admitted(
            market,
            capacity,
            readback.auxiliary,
        ))
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UntrustedOwnerFactRefV1 {
    pub source: OwnerSource,
    pub record_identity: RecordIdentity,
    pub content_digest: ContentDigest,
    pub source_frontier: Option<SourceFrontier>,
    pub snapshot_cut: SnapshotCut,
    pub compatibility_cut: CompatibilityCut,
    pub semantic_scope: SemanticScope,
    pub observed_at: crate::UnixTimestamp,
    pub valid_through: crate::UnixTimestamp,
    pub clock_epoch: u64,
    pub time_evidence: OpaqueId,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CommittedOwnerFact {
    source: OwnerSource,
    record_identity: RecordIdentity,
    content_digest: ContentDigest,
    source_frontier: SourceFrontier,
    snapshot_cut: SnapshotCut,
    compatibility_cut: CompatibilityCut,
    semantic_scope: SemanticScope,
    observed_at: crate::UnixTimestamp,
    valid_through: crate::UnixTimestamp,
    clock_epoch: u64,
    time_evidence: OpaqueId,
}

impl CommittedOwnerFact {
    pub const fn source(&self) -> &OwnerSource {
        &self.source
    }
    pub const fn record_identity(&self) -> &RecordIdentity {
        &self.record_identity
    }
    pub const fn content_digest(&self) -> &ContentDigest {
        &self.content_digest
    }
    pub const fn source_frontier(&self) -> &SourceFrontier {
        &self.source_frontier
    }
    pub const fn snapshot_cut(&self) -> &SnapshotCut {
        &self.snapshot_cut
    }
    pub const fn compatibility_cut(&self) -> &CompatibilityCut {
        &self.compatibility_cut
    }
    pub const fn semantic_scope(&self) -> &SemanticScope {
        &self.semantic_scope
    }
    pub const fn observed_at(&self) -> crate::UnixTimestamp {
        self.observed_at
    }
    pub const fn valid_through(&self) -> crate::UnixTimestamp {
        self.valid_through
    }
    pub const fn clock_epoch(&self) -> u64 {
        self.clock_epoch
    }
    pub const fn time_evidence(&self) -> &OpaqueId {
        &self.time_evidence
    }
}

fn admit_fact(
    policy: &SnapshotAdmissionPolicy,
    due_slot: &crate::DueSlot,
    expected_source: &OwnerSource,
    frontier_requirement: &FrontierRequirement,
    fact: UntrustedOwnerFactRefV1,
) -> Result<CommittedOwnerFact, InputMismatch> {
    if fact.source.owner != expected_source.owner {
        return Err(InputMismatch::SourceOwner);
    }

    if fact.source.node != expected_source.node {
        return Err(InputMismatch::SourceNode);
    }

    let frontier = fact.source_frontier.ok_or(InputMismatch::FrontierMissing)?;

    if frontier.lineage != frontier_requirement.lineage {
        return Err(InputMismatch::FrontierLineage);
    }

    if frontier.sequence < frontier_requirement.minimum_sequence {
        return Err(InputMismatch::FrontierRegressed);
    }

    if fact.semantic_scope != policy.semantic_scope {
        return Err(InputMismatch::SemanticScope);
    }

    if fact.compatibility_cut != policy.compatibility_cut {
        return Err(InputMismatch::CompatibilityCut);
    }

    if fact.clock_epoch != due_slot.clock_epoch() {
        return Err(InputMismatch::ClockEpoch);
    }

    if fact.time_evidence != *due_slot.time_evidence() {
        return Err(InputMismatch::TimeEvidence);
    }

    let due = due_slot.due_at();
    let now = due_slot.observed_at();

    if fact.observed_at > now {
        return Err(InputMismatch::FutureObservation);
    }

    if fact.valid_through <= due || fact.valid_through <= now {
        return Err(InputMismatch::Expired);
    }

    Ok(CommittedOwnerFact {
        source: fact.source,
        record_identity: fact.record_identity,
        content_digest: fact.content_digest,
        source_frontier: frontier,
        snapshot_cut: fact.snapshot_cut,
        compatibility_cut: fact.compatibility_cut,
        semantic_scope: fact.semantic_scope,
        observed_at: fact.observed_at,
        valid_through: fact.valid_through,
        clock_epoch: fact.clock_epoch,
        time_evidence: fact.time_evidence,
    })
}

#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct CapacityRequirement {
    contract: CapacityRequirementContract,
    candidate_independent_scope: CandidateIndependentCapacityScope,
}

impl CapacityRequirement {
    pub const fn new(
        contract: CapacityRequirementContract,
        candidate_independent_scope: CandidateIndependentCapacityScope,
    ) -> Self {
        Self {
            contract,
            candidate_independent_scope,
        }
    }

    pub const fn contract(&self) -> &CapacityRequirementContract {
        &self.contract
    }

    pub const fn candidate_independent_scope(&self) -> &CandidateIndependentCapacityScope {
        &self.candidate_independent_scope
    }
}

#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct StrategyBinding {
    strategy: OpaqueId,
    artifact_ref: GovernedArtifactRef,
    activation_condition: ActivationConditionContract,
    data_requirement: DataRequirementContract,
    lifecycle_constraints: LifecycleConstraints,
    universe_selection: UniverseSelectionRequirement,
    capacity_requirement: Option<CapacityRequirement>,
}

impl StrategyBinding {
    pub const fn new(
        strategy: OpaqueId,
        artifact_ref: GovernedArtifactRef,
        activation_condition: ActivationConditionContract,
        data_requirement: DataRequirementContract,
        lifecycle_constraints: LifecycleConstraints,
        universe_selection: UniverseSelectionRequirement,
        capacity_requirement: Option<CapacityRequirement>,
    ) -> Self {
        Self {
            strategy,
            artifact_ref,
            activation_condition,
            data_requirement,
            lifecycle_constraints,
            universe_selection,
            capacity_requirement,
        }
    }

    pub const fn strategy(&self) -> &OpaqueId {
        &self.strategy
    }

    pub const fn artifact_ref(&self) -> &GovernedArtifactRef {
        &self.artifact_ref
    }

    pub const fn activation_condition(&self) -> &ActivationConditionContract {
        &self.activation_condition
    }

    pub const fn data_requirement(&self) -> &DataRequirementContract {
        &self.data_requirement
    }

    pub const fn lifecycle_constraints(&self) -> &LifecycleConstraints {
        &self.lifecycle_constraints
    }

    pub const fn universe_selection(&self) -> &UniverseSelectionRequirement {
        &self.universe_selection
    }

    pub const fn capacity_requirement(&self) -> Option<&CapacityRequirement> {
        self.capacity_requirement.as_ref()
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StrategyFrontier {
    registry_frontier: OpaqueId,
    strategies: BTreeMap<OpaqueId, StrategyBinding>,
}

impl StrategyFrontier {
    pub fn new(
        registry_frontier: OpaqueId,
        strategies: impl IntoIterator<Item = StrategyBinding>,
    ) -> Result<Self, DomainError> {
        let mut indexed = BTreeMap::new();

        for strategy in strategies {
            let identity = strategy.strategy().clone();
            if indexed.insert(identity.clone(), strategy).is_some() {
                return Err(DomainError::DuplicateStrategy(identity));
            }
        }
        Ok(Self {
            registry_frontier,
            strategies: indexed,
        })
    }

    pub const fn registry_frontier(&self) -> &OpaqueId {
        &self.registry_frontier
    }

    pub const fn strategies(&self) -> &BTreeMap<OpaqueId, StrategyBinding> {
        &self.strategies
    }

    pub(crate) fn into_parts(self) -> (OpaqueId, BTreeMap<OpaqueId, StrategyBinding>) {
        (self.registry_frontier, self.strategies)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MarketFactField {
    DataRequirement,
    UniverseSelectionRequirement,
    PitSnapshot,
    UniverseSelectionRecord,
    InstrumentMaster,
    CalendarSessionTimeZone,
    CorporateAction,
    HistoricalMembership,
    MarketSemanticsCompatibility,
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct UntrustedMarketFactReadback {
    pub data_requirement: Option<DataRequirementContract>,
    pub universe_selection_requirement: Option<UniverseSelectionRequirement>,
    pub pit_snapshot: Option<UntrustedOwnerFactRefV1>,
    pub universe_selection_record: Option<UntrustedOwnerFactRefV1>,
    pub instrument_master: Option<UntrustedOwnerFactRefV1>,
    pub calendar_session_time_zone: Option<UntrustedOwnerFactRefV1>,
    pub corporate_action: Option<UntrustedOwnerFactRefV1>,
    pub historical_membership: Option<UntrustedOwnerFactRefV1>,
    pub market_semantics_compatibility: Option<UntrustedOwnerFactRefV1>,
    pub auxiliary: BTreeSet<OpaqueId>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MarketFactCut {
    data_requirement: DataRequirementContract,
    universe_selection_requirement: UniverseSelectionRequirement,
    pit_snapshot: CommittedOwnerFact,
    universe_selection_record: CommittedOwnerFact,
    instrument_master: CommittedOwnerFact,
    calendar_session_time_zone: CommittedOwnerFact,
    corporate_action: CommittedOwnerFact,
    historical_membership: CommittedOwnerFact,
    market_semantics_compatibility: CommittedOwnerFact,
    auxiliary: BTreeSet<OpaqueId>,
}

impl MarketFactCut {
    fn admit(
        policy: &SnapshotAdmissionPolicy,
        due_slot: &crate::DueSlot,
        binding: &StrategyBinding,
        readback: UntrustedMarketFactReadback,
    ) -> Result<Self, InputMismatch> {
        let data_requirement =
            required(readback.data_requirement, MarketFactField::DataRequirement)?;

        if &data_requirement != binding.data_requirement() {
            return Err(InputMismatch::DataRequirement);
        }
        let universe_selection_requirement = required(
            readback.universe_selection_requirement,
            MarketFactField::UniverseSelectionRequirement,
        )?;

        if &universe_selection_requirement != binding.universe_selection() {
            return Err(InputMismatch::UniverseSelectionRequirement);
        }
        let admit = |fact| {
            admit_fact(
                policy,
                due_slot,
                &policy.market_source,
                &policy.market_frontier,
                fact,
            )
        };
        let pit_snapshot = admit(required(
            readback.pit_snapshot,
            MarketFactField::PitSnapshot,
        )?)?;
        let canonical_cut = pit_snapshot.snapshot_cut.clone();
        let check = |fact: CommittedOwnerFact| {
            if fact.snapshot_cut == canonical_cut {
                Ok(fact)
            } else {
                Err(InputMismatch::MarketCrossCut)
            }
        };
        Ok(Self {
            data_requirement,
            universe_selection_requirement,
            pit_snapshot,
            universe_selection_record: check(admit(required(
                readback.universe_selection_record,
                MarketFactField::UniverseSelectionRecord,
            )?)?)?,
            instrument_master: check(admit(required(
                readback.instrument_master,
                MarketFactField::InstrumentMaster,
            )?)?)?,
            calendar_session_time_zone: check(admit(required(
                readback.calendar_session_time_zone,
                MarketFactField::CalendarSessionTimeZone,
            )?)?)?,
            corporate_action: check(admit(required(
                readback.corporate_action,
                MarketFactField::CorporateAction,
            )?)?)?,
            historical_membership: check(admit(required(
                readback.historical_membership,
                MarketFactField::HistoricalMembership,
            )?)?)?,
            market_semantics_compatibility: check(admit(required(
                readback.market_semantics_compatibility,
                MarketFactField::MarketSemanticsCompatibility,
            )?)?)?,
            auxiliary: readback.auxiliary,
        })
    }
    pub const fn data_requirement(&self) -> &DataRequirementContract {
        &self.data_requirement
    }

    pub const fn universe_selection_requirement(&self) -> &UniverseSelectionRequirement {
        &self.universe_selection_requirement
    }

    pub const fn pit_snapshot(&self) -> &CommittedOwnerFact {
        &self.pit_snapshot
    }

    pub const fn universe_selection_record(&self) -> &CommittedOwnerFact {
        &self.universe_selection_record
    }

    pub const fn instrument_master(&self) -> &CommittedOwnerFact {
        &self.instrument_master
    }

    pub const fn calendar_session_time_zone(&self) -> &CommittedOwnerFact {
        &self.calendar_session_time_zone
    }

    pub const fn corporate_action(&self) -> &CommittedOwnerFact {
        &self.corporate_action
    }

    pub const fn historical_membership(&self) -> &CommittedOwnerFact {
        &self.historical_membership
    }

    pub const fn market_semantics_compatibility(&self) -> &CommittedOwnerFact {
        &self.market_semantics_compatibility
    }

    pub const fn auxiliary(&self) -> &BTreeSet<OpaqueId> {
        &self.auxiliary
    }

    pub(crate) fn matches(&self, binding: &StrategyBinding) -> Result<(), InputMismatch> {
        if &self.data_requirement != binding.data_requirement() {
            return Err(InputMismatch::DataRequirement);
        }

        if &self.universe_selection_requirement != binding.universe_selection() {
            return Err(InputMismatch::UniverseSelectionRequirement);
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CapacityViewField {
    RequirementContract,
    CandidateIndependentScope,
    AccountFacts,
    Liquidity,
    CapitalPoolMethod,
    CapitalPoolAssumptions,
    MeasurementTime,
    ValidThrough,
    CompatibleMarketSnapshotCut,
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct UntrustedCapacityViewReadback {
    pub requirement_contract: Option<CapacityRequirementContract>,
    pub candidate_independent_scope: Option<CandidateIndependentCapacityScope>,
    pub account_facts: Option<UntrustedOwnerFactRefV1>,
    pub liquidity: Option<UntrustedOwnerFactRefV1>,
    pub capital_pool_method: Option<CapitalPoolMethod>,
    pub capital_pool_assumptions: Option<CapitalPoolAssumptions>,
    pub measurement_time: Option<crate::UnixTimestamp>,
    pub valid_through: Option<crate::UnixTimestamp>,
    pub compatible_market_snapshot_cut: Option<SnapshotCut>,
    pub auxiliary: BTreeSet<OpaqueId>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CapacityViewCut {
    requirement_contract: CapacityRequirementContract,
    candidate_independent_scope: CandidateIndependentCapacityScope,
    account_facts: CommittedOwnerFact,
    liquidity: CommittedOwnerFact,
    capital_pool_method: CapitalPoolMethod,
    capital_pool_assumptions: CapitalPoolAssumptions,
    measurement_time: crate::UnixTimestamp,
    valid_through: crate::UnixTimestamp,
    admitted_at: crate::UnixTimestamp,
    auxiliary: BTreeSet<OpaqueId>,
}

impl CapacityViewCut {
    fn admit(
        policy: &SnapshotAdmissionPolicy,
        due_slot: &crate::DueSlot,
        required: &CapacityRequirement,
        market: &MarketFactCut,
        readback: UntrustedCapacityViewReadback,
    ) -> Result<Self, InputMismatch> {
        let requirement_contract = capacity_required(
            readback.requirement_contract,
            CapacityViewField::RequirementContract,
        )?;

        if &requirement_contract != required.contract() {
            return Err(InputMismatch::CapacityRequirementContract);
        }
        let candidate_independent_scope = capacity_required(
            readback.candidate_independent_scope,
            CapacityViewField::CandidateIndependentScope,
        )?;

        if &candidate_independent_scope != required.candidate_independent_scope() {
            return Err(InputMismatch::CapacityScope);
        }
        let compatible_market_snapshot_cut = capacity_required(
            readback.compatible_market_snapshot_cut,
            CapacityViewField::CompatibleMarketSnapshotCut,
        )?;

        if &compatible_market_snapshot_cut != market.pit_snapshot().snapshot_cut() {
            return Err(InputMismatch::CapacityMarketCrossCut);
        }
        let measurement_time = capacity_required(
            readback.measurement_time,
            CapacityViewField::MeasurementTime,
        )?;
        let valid_through =
            capacity_required(readback.valid_through, CapacityViewField::ValidThrough)?;
        let now = due_slot.observed_at();
        if measurement_time > now {
            return Err(InputMismatch::FutureObservation);
        }

        if valid_through <= due_slot.due_at() || valid_through <= now {
            return Err(InputMismatch::Expired);
        }
        let admit = |fact| {
            admit_fact(
                policy,
                due_slot,
                &policy.capacity_source,
                &policy.capacity_frontier,
                fact,
            )
        };
        let account_facts = admit(capacity_required(
            readback.account_facts,
            CapacityViewField::AccountFacts,
        )?)?;
        let liquidity = admit(capacity_required(
            readback.liquidity,
            CapacityViewField::Liquidity,
        )?)?;

        if account_facts.snapshot_cut != liquidity.snapshot_cut {
            return Err(InputMismatch::CapacityCrossCut);
        }

        if account_facts.observed_at != measurement_time
            || liquidity.observed_at != measurement_time
        {
            return Err(InputMismatch::CapacityMeasurementTime);
        }

        if account_facts.valid_through != valid_through || liquidity.valid_through != valid_through
        {
            return Err(InputMismatch::CapacityValidityCut);
        }
        Ok(Self {
            requirement_contract,
            candidate_independent_scope,
            account_facts,
            liquidity,
            capital_pool_method: capacity_required(
                readback.capital_pool_method,
                CapacityViewField::CapitalPoolMethod,
            )?,
            capital_pool_assumptions: capacity_required(
                readback.capital_pool_assumptions,
                CapacityViewField::CapitalPoolAssumptions,
            )?,
            measurement_time,
            valid_through,
            admitted_at: now,
            auxiliary: readback.auxiliary,
        })
    }
    pub const fn requirement_contract(&self) -> &CapacityRequirementContract {
        &self.requirement_contract
    }

    pub const fn candidate_independent_scope(&self) -> &CandidateIndependentCapacityScope {
        &self.candidate_independent_scope
    }

    pub const fn account_facts(&self) -> &CommittedOwnerFact {
        &self.account_facts
    }

    pub const fn liquidity(&self) -> &CommittedOwnerFact {
        &self.liquidity
    }

    pub const fn capital_pool_method(&self) -> &CapitalPoolMethod {
        &self.capital_pool_method
    }

    pub const fn capital_pool_assumptions(&self) -> &CapitalPoolAssumptions {
        &self.capital_pool_assumptions
    }

    pub const fn measurement_time(&self) -> crate::UnixTimestamp {
        self.measurement_time
    }

    pub const fn valid_through(&self) -> crate::UnixTimestamp {
        self.valid_through
    }

    pub const fn admitted_at(&self) -> crate::UnixTimestamp {
        self.admitted_at
    }

    pub const fn auxiliary(&self) -> &BTreeSet<OpaqueId> {
        &self.auxiliary
    }

    pub(crate) fn matches(&self, required: &CapacityRequirement) -> Result<(), InputMismatch> {
        if &self.requirement_contract != required.contract() {
            return Err(InputMismatch::CapacityRequirementContract);
        }

        if &self.candidate_independent_scope != required.candidate_independent_scope() {
            return Err(InputMismatch::CapacityScope);
        }
        Ok(())
    }
}

fn required<T>(value: Option<T>, field: MarketFactField) -> Result<T, InputMismatch> {
    value.ok_or(InputMismatch::MissingMarketFact(field))
}

fn capacity_required<T>(value: Option<T>, field: CapacityViewField) -> Result<T, InputMismatch> {
    value.ok_or(InputMismatch::MissingCapacityViewFact(field))
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum InputMismatch {
    SourceOwnerResolveUnavailable,
    SourceOwnerResolveBindingMismatch,
    MissingMarketFact(MarketFactField),
    MissingCapacityViewFact(CapacityViewField),
    DataRequirement,
    UniverseSelectionRequirement,
    CapacityMissing,
    CapacityRequirementContract,
    CapacityScope,
    SourceOwner,
    SourceNode,
    FrontierMissing,
    FrontierLineage,
    FrontierRegressed,
    SemanticScope,
    CompatibilityCut,
    ClockEpoch,
    TimeEvidence,
    FutureObservation,
    Expired,
    MarketCrossCut,
    CapacityCrossCut,
    CapacityMarketCrossCut,
    CapacityMeasurementTime,
    CapacityValidityCut,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UntrustedSnapshotReadback {
    pub market_fact_cut: UntrustedMarketFactReadback,
    pub capacity_view_cut: Option<UntrustedCapacityViewReadback>,
    pub auxiliary: crate::EvidenceSet,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StrategyDisposition {
    binding: StrategyBinding,
    outcome: StrategyOutcome,
    market_fact_cut: Option<MarketFactCut>,
    capacity_view_cut: Option<CapacityViewCut>,
    auxiliary: crate::EvidenceSet,
    input_mismatch: Option<InputMismatch>,
}

impl StrategyDisposition {
    pub(crate) const fn evaluated(
        binding: StrategyBinding,
        outcome: StrategyOutcome,
        market_fact_cut: MarketFactCut,
        capacity_view_cut: Option<CapacityViewCut>,
        auxiliary: crate::EvidenceSet,
    ) -> Self {
        Self {
            binding,
            outcome,
            market_fact_cut: Some(market_fact_cut),
            capacity_view_cut,
            auxiliary,
            input_mismatch: None,
        }
    }

    pub(crate) const fn input_unavailable(
        binding: StrategyBinding,
        market_fact_cut: Option<MarketFactCut>,
        capacity_view_cut: Option<CapacityViewCut>,
        auxiliary: crate::EvidenceSet,
        input_mismatch: Option<InputMismatch>,
    ) -> Self {
        Self {
            binding,
            outcome: StrategyOutcome::InputUnavailable,
            market_fact_cut,
            capacity_view_cut,
            auxiliary,
            input_mismatch,
        }
    }

    pub const fn binding(&self) -> &StrategyBinding {
        &self.binding
    }

    pub const fn outcome(&self) -> StrategyOutcome {
        self.outcome
    }

    pub const fn market_fact_cut(&self) -> Option<&MarketFactCut> {
        self.market_fact_cut.as_ref()
    }

    pub const fn capacity_view_cut(&self) -> Option<&CapacityViewCut> {
        self.capacity_view_cut.as_ref()
    }

    pub const fn auxiliary(&self) -> &crate::EvidenceSet {
        &self.auxiliary
    }

    pub const fn input_mismatch(&self) -> Option<InputMismatch> {
        self.input_mismatch
    }

    pub(crate) fn is_proposal_ready(&self) -> bool {
        if self.outcome != StrategyOutcome::Matched {
            return false;
        }
        let Some(market) = &self.market_fact_cut else {
            return false;
        };

        if market.matches(&self.binding).is_err() {
            return false;
        }

        match self.binding.capacity_requirement() {
            Some(required) => self
                .capacity_view_cut
                .as_ref()
                .is_some_and(|capacity| capacity.matches(required).is_ok()),
            None => true,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProposalEvidence {
    pub proposal_identity: OpaqueId,
    pub evidence_cut: OpaqueId,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProposalMember {
    binding: StrategyBinding,
    market_fact_cut: MarketFactCut,
    capacity_view_cut: Option<CapacityViewCut>,
}

impl ProposalMember {
    pub const fn binding(&self) -> &StrategyBinding {
        &self.binding
    }

    pub const fn market_fact_cut(&self) -> &MarketFactCut {
        &self.market_fact_cut
    }

    pub const fn capacity_view_cut(&self) -> Option<&CapacityViewCut> {
        self.capacity_view_cut.as_ref()
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Proposal {
    evidence: ProposalEvidence,
    members: BTreeMap<OpaqueId, ProposalMember>,
}

impl Proposal {
    pub(crate) fn from_matched<'a>(
        evidence: ProposalEvidence,
        matched: impl IntoIterator<Item = &'a StrategyDisposition>,
    ) -> Result<Self, DomainError> {
        let mut members = BTreeMap::new();

        for disposition in matched {
            if !disposition.is_proposal_ready() {
                return Err(DomainError::IncompleteProposalEvidence(
                    disposition.binding().strategy().clone(),
                ));
            }
            let member = ProposalMember {
                binding: disposition.binding.clone(),
                market_fact_cut: disposition.market_fact_cut.clone().ok_or_else(|| {
                    DomainError::IncompleteProposalEvidence(
                        disposition.binding().strategy().clone(),
                    )
                })?,
                capacity_view_cut: disposition.capacity_view_cut.clone(),
            };
            let identity = member.binding.strategy().clone();
            if members.insert(identity.clone(), member).is_some() {
                return Err(DomainError::DuplicateDisposition(identity));
            }
        }
        Ok(Self { evidence, members })
    }

    pub const fn evidence(&self) -> &ProposalEvidence {
        &self.evidence
    }

    pub const fn members(&self) -> &BTreeMap<OpaqueId, ProposalMember> {
        &self.members
    }
}
