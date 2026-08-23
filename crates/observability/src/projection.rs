use std::collections::{BTreeMap, BTreeSet};

use crate::envelope::{EnvelopePolicy, EnvelopeViolation, OpaqueReference, OwnerEventEnvelope};

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub struct SourceKey {
    owner: String,
    node: String,
}

impl SourceKey {
    pub fn new(owner: impl Into<String>, node: impl Into<String>) -> Result<Self, SourceKeyError> {
        let owner = owner.into();
        let node = node.into();

        if !valid_source_component(&owner) || !valid_source_component(&node) {
            return Err(SourceKeyError);
        }
        Ok(Self { owner, node })
    }

    pub fn owner(&self) -> &str {
        &self.owner
    }

    pub fn node(&self) -> &str {
        &self.node
    }

    fn from_validated(owner: String, node: String) -> Self {
        Self { owner, node }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SourceKeyError;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SourcePosition {
    sequence: u64,
    source_cut: OpaqueReference,
}

impl SourcePosition {
    pub const fn sequence(&self) -> u64 {
        self.sequence
    }

    pub fn source_cut(&self) -> &OpaqueReference {
        &self.source_cut
    }
}

pub type SourceFrontier = BTreeMap<SourceKey, SourcePosition>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Completeness {
    Complete,
    Partial,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProjectionVisibility {
    Available,
    Stale,
    Partial,
    Rebuilding,
    Unavailable,
}

impl ProjectionVisibility {
    const fn severity(self) -> u8 {
        match self {
            Self::Available => 0,
            Self::Stale => 1,
            Self::Partial => 2,
            Self::Rebuilding => 3,
            Self::Unavailable => 4,
        }
    }

    fn worst(self, other: Self) -> Self {
        if self.severity() >= other.severity() {
            self
        } else {
            other
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SourceRebuildState {
    Stable,
    Rebuilding,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TelemetryVisibility {
    Unavailable,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SourceProjectionState {
    frontier: Option<SourcePosition>,
    observed_at_epoch_ms: Option<u64>,
    valid_through_epoch_ms: Option<u64>,
    completeness: Completeness,
}

impl SourceProjectionState {
    pub fn frontier(&self) -> Option<&SourcePosition> {
        self.frontier.as_ref()
    }

    pub const fn observed_at_epoch_ms(&self) -> Option<u64> {
        self.observed_at_epoch_ms
    }

    pub const fn valid_through_epoch_ms(&self) -> Option<u64> {
        self.valid_through_epoch_ms
    }

    pub const fn completeness(&self) -> Completeness {
        self.completeness
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OwnerProjectionState {
    source_frontier: SourceFrontier,
    sources: BTreeMap<SourceKey, SourceProjectionState>,
    owner_event_count: usize,
}

impl OwnerProjectionState {
    pub fn source_frontier(&self) -> &SourceFrontier {
        &self.source_frontier
    }

    pub fn sources(&self) -> &BTreeMap<SourceKey, SourceProjectionState> {
        &self.sources
    }

    pub const fn owner_event_count(&self) -> usize {
        self.owner_event_count
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SourceStatusDetail {
    frontier: Option<SourcePosition>,
    observed_at_epoch_ms: Option<u64>,
    valid_through_epoch_ms: Option<u64>,
    completeness: Completeness,
    lag_ms: Option<u64>,
    rebuild_state: SourceRebuildState,
    visibility: ProjectionVisibility,
}

impl SourceStatusDetail {
    pub fn frontier(&self) -> Option<&SourcePosition> {
        self.frontier.as_ref()
    }

    pub const fn observed_at_epoch_ms(&self) -> Option<u64> {
        self.observed_at_epoch_ms
    }

    pub const fn valid_through_epoch_ms(&self) -> Option<u64> {
        self.valid_through_epoch_ms
    }

    pub const fn completeness(&self) -> Completeness {
        self.completeness
    }

    pub const fn lag_ms(&self) -> Option<u64> {
        self.lag_ms
    }

    pub const fn rebuild_state(&self) -> SourceRebuildState {
        self.rebuild_state
    }

    pub const fn visibility(&self) -> ProjectionVisibility {
        self.visibility
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GlobalStatusView {
    visibility: ProjectionVisibility,
    source_frontier: SourceFrontier,
    sources: BTreeMap<SourceKey, SourceStatusDetail>,
    completeness: Completeness,
    max_lag_ms: Option<u64>,
    owner_event_count: usize,
    quarantine_count: usize,
    rebuild_target_frontier: Option<SourceFrontier>,
    telemetry_visibility: TelemetryVisibility,
}

impl GlobalStatusView {
    pub const fn visibility(&self) -> ProjectionVisibility {
        self.visibility
    }

    pub fn source_frontier(&self) -> &SourceFrontier {
        &self.source_frontier
    }

    pub fn sources(&self) -> &BTreeMap<SourceKey, SourceStatusDetail> {
        &self.sources
    }

    pub const fn completeness(&self) -> Completeness {
        self.completeness
    }

    pub const fn max_lag_ms(&self) -> Option<u64> {
        self.max_lag_ms
    }

    pub const fn owner_event_count(&self) -> usize {
        self.owner_event_count
    }

    pub const fn quarantine_count(&self) -> usize {
        self.quarantine_count
    }

    pub fn rebuild_target_frontier(&self) -> Option<&SourceFrontier> {
        self.rebuild_target_frontier.as_ref()
    }

    pub const fn telemetry_visibility(&self) -> TelemetryVisibility {
        self.telemetry_visibility
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ProjectionPolicy {
    pub envelope: EnvelopePolicy,
    pub max_event_identities: usize,
    pub max_owner_nodes: usize,
    pub max_quarantine_records: usize,
}

impl Default for ProjectionPolicy {
    fn default() -> Self {
        Self {
            envelope: EnvelopePolicy::default(),
            max_event_identities: 10_000,
            max_owner_nodes: 128,
            max_quarantine_records: 256,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum QuarantineReason {
    InvalidEnvelope(EnvelopeViolation),
    IdentityContentConflict,
    SequenceIdentityConflict,
    HighCardinality,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QuarantineRecord {
    pub record_identity: String,
    pub reason: QuarantineReason,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ApplyOutcome {
    Applied,
    Duplicate,
    Quarantined(QuarantineReason),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProjectionError {
    RebuildAlreadyInProgress,
    RebuildNotInProgress,
    RebuildInProgress,
    SourceLimitReached,
    RebuildFrontierMismatch {
        expected: SourceFrontier,
        actual: SourceFrontier,
    },
    RebuildCheckpointMismatch,
}

/// Seals Owner ingestion until a crate-owned typed adapter is integrated.
pub struct OwnerIngestCapability {
    _private: (),
}

impl OwnerIngestCapability {
    #[cfg(test)]
    pub(crate) const fn for_test() -> Self {
        Self { _private: () }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct CanonicalEventFingerprint {
    // Equality over this private clone covers every validated envelope and
    // Owner projection field; the caller-provided digest is only one field.
    canonical_event: OwnerEventEnvelope,
}

impl CanonicalEventFingerprint {
    fn from_event(event: &OwnerEventEnvelope) -> Self {
        Self {
            canonical_event: event.clone(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
struct SourceSnapshot {
    sequences: BTreeSet<u64>,
    frontier: Option<SourcePosition>,
    observed_at_epoch_ms: Option<u64>,
    valid_through_epoch_ms: Option<u64>,
}

impl SourceSnapshot {
    fn completeness(&self) -> Completeness {
        let Some(last) = self.sequences.last() else {
            return Completeness::Partial;
        };

        if self.sequences.first() == Some(&1) && self.sequences.len() as u64 == *last {
            Completeness::Complete
        } else {
            Completeness::Partial
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
struct Snapshot {
    events: BTreeMap<String, CanonicalEventFingerprint>,
    sequence_identities: BTreeSet<(SourceKey, u64)>,
    sources: BTreeMap<SourceKey, SourceSnapshot>,
}

impl Snapshot {
    fn source_frontier(&self) -> SourceFrontier {
        self.sources
            .iter()
            .filter_map(|(key, source)| {
                source
                    .frontier
                    .as_ref()
                    .map(|frontier| (key.clone(), frontier.clone()))
            })
            .collect()
    }

    fn empty_source_bookkeeping_from(target: &Self) -> Self {
        let sources = target
            .sources
            .iter()
            .filter(|(_, source)| source.frontier.is_none())
            .map(|(key, source)| (key.clone(), source.clone()))
            .collect();

        Self {
            sources,
            ..Self::default()
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct RebuildState {
    target: Snapshot,
    target_unavailable_sources: BTreeSet<SourceKey>,
    working: Snapshot,
}

/// Opaque, Observability-owned restart checkpoint.
///
/// Callers may persist or clone this value, but cannot construct or modify its
/// projection contents. Restoring it never writes to an Owner or authorizes an
/// Owner action.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProjectionCheckpoint {
    published: Snapshot,
    rebuild: Option<RebuildState>,
    quarantine: Vec<QuarantineRecord>,
    unavailable_sources: BTreeSet<SourceKey>,
}

#[derive(Debug)]
pub struct StatusProjection {
    policy: ProjectionPolicy,
    published: Snapshot,
    rebuild: Option<RebuildState>,
    quarantine: Vec<QuarantineRecord>,
    unavailable_sources: BTreeSet<SourceKey>,
}

impl StatusProjection {
    pub fn new(policy: ProjectionPolicy) -> Self {
        Self {
            policy,
            published: Snapshot::default(),
            rebuild: None,
            quarantine: Vec::new(),
            unavailable_sources: BTreeSet::new(),
        }
    }

    pub fn restore(policy: ProjectionPolicy, checkpoint: ProjectionCheckpoint) -> Self {
        Self {
            policy,
            published: checkpoint.published,
            rebuild: checkpoint.rebuild,
            quarantine: checkpoint.quarantine,
            unavailable_sources: checkpoint.unavailable_sources,
        }
    }

    pub fn checkpoint(&self) -> ProjectionCheckpoint {
        ProjectionCheckpoint {
            published: self.published.clone(),
            rebuild: self.rebuild.clone(),
            quarantine: self.quarantine.clone(),
            unavailable_sources: self.unavailable_sources.clone(),
        }
    }

    pub fn apply_owner_event(
        &mut self,
        _capability: &OwnerIngestCapability,
        event: &OwnerEventEnvelope,
    ) -> Result<ApplyOutcome, ProjectionError> {
        if self.rebuild.is_some() {
            return Err(ProjectionError::RebuildInProgress);
        }
        let outcome = Self::apply_to_snapshot(&self.policy, &mut self.published, event);
        Ok(self.record_outcome(&event.canonical.record_identity, outcome))
    }

    pub fn set_source_unavailable(
        &mut self,
        _capability: &OwnerIngestCapability,
        source: SourceKey,
        unavailable: bool,
    ) -> Result<(), ProjectionError> {
        if self.rebuild.is_some() {
            return Err(ProjectionError::RebuildInProgress);
        }

        if !self.published.sources.contains_key(&source)
            && self.published.sources.len() >= self.policy.max_owner_nodes
        {
            return Err(ProjectionError::SourceLimitReached);
        }
        self.published.sources.entry(source.clone()).or_default();

        if unavailable {
            self.unavailable_sources.insert(source);
        } else {
            self.unavailable_sources.remove(&source);
        }
        Ok(())
    }

    pub fn begin_rebuild(
        &mut self,
        _capability: &OwnerIngestCapability,
    ) -> Result<SourceFrontier, ProjectionError> {
        if self.rebuild.is_some() {
            return Err(ProjectionError::RebuildAlreadyInProgress);
        }
        let target = self.published.clone();
        let target_frontier = target.source_frontier();
        let working = Snapshot::empty_source_bookkeeping_from(&target);
        self.rebuild = Some(RebuildState {
            target,
            target_unavailable_sources: self.unavailable_sources.clone(),
            working,
        });
        Ok(target_frontier)
    }

    pub fn apply_rebuild_event(
        &mut self,
        _capability: &OwnerIngestCapability,
        event: &OwnerEventEnvelope,
    ) -> Result<ApplyOutcome, ProjectionError> {
        let Some(rebuild) = self.rebuild.as_mut() else {
            return Err(ProjectionError::RebuildNotInProgress);
        };
        let outcome = Self::apply_to_snapshot(&self.policy, &mut rebuild.working, event);
        Ok(self.record_outcome(&event.canonical.record_identity, outcome))
    }

    pub fn finish_rebuild(
        &mut self,
        _capability: &OwnerIngestCapability,
    ) -> Result<(), ProjectionError> {
        let Some(rebuild) = self.rebuild.as_ref() else {
            return Err(ProjectionError::RebuildNotInProgress);
        };

        let actual_frontier = rebuild.working.source_frontier();
        let expected_frontier = rebuild.target.source_frontier();

        if actual_frontier != expected_frontier {
            return Err(ProjectionError::RebuildFrontierMismatch {
                expected: expected_frontier,
                actual: actual_frontier,
            });
        }

        if rebuild.working != rebuild.target
            || self.unavailable_sources != rebuild.target_unavailable_sources
        {
            self.rebuild = None;
            return Err(ProjectionError::RebuildCheckpointMismatch);
        }
        let rebuild = self.rebuild.take().expect("rebuild checked above");
        self.published = rebuild.working;
        Ok(())
    }

    pub fn owner_state(&self) -> OwnerProjectionState {
        let sources = self
            .published
            .sources
            .iter()
            .map(|(key, source)| {
                (
                    key.clone(),
                    SourceProjectionState {
                        frontier: source.frontier.clone(),
                        observed_at_epoch_ms: source.observed_at_epoch_ms,
                        valid_through_epoch_ms: source.valid_through_epoch_ms,
                        completeness: source.completeness(),
                    },
                )
            })
            .collect();

        OwnerProjectionState {
            source_frontier: self.published.source_frontier(),
            sources,
            owner_event_count: self.published.events.len(),
        }
    }

    pub fn global_status(&self, now_epoch_ms: u64) -> GlobalStatusView {
        let owner = self.owner_state();
        let rebuild_target_frontier = self
            .rebuild
            .as_ref()
            .map(|rebuild| rebuild.target.source_frontier());
        let sources: BTreeMap<_, _> = owner
            .sources
            .iter()
            .map(|(key, source)| {
                let rebuild_state = if rebuild_target_frontier
                    .as_ref()
                    .is_some_and(|frontier| frontier.contains_key(key))
                {
                    SourceRebuildState::Rebuilding
                } else {
                    SourceRebuildState::Stable
                };
                let visibility = if self.unavailable_sources.contains(key)
                    || source.observed_at_epoch_ms.is_none()
                    || source.frontier.is_none()
                {
                    ProjectionVisibility::Unavailable
                } else if rebuild_state == SourceRebuildState::Rebuilding {
                    ProjectionVisibility::Rebuilding
                } else if source.completeness == Completeness::Partial {
                    ProjectionVisibility::Partial
                } else if source
                    .valid_through_epoch_ms
                    .is_none_or(|valid_through| now_epoch_ms > valid_through)
                {
                    ProjectionVisibility::Stale
                } else {
                    ProjectionVisibility::Available
                };
                (
                    key.clone(),
                    SourceStatusDetail {
                        frontier: source.frontier.clone(),
                        observed_at_epoch_ms: source.observed_at_epoch_ms,
                        valid_through_epoch_ms: source.valid_through_epoch_ms,
                        completeness: source.completeness,
                        lag_ms: source
                            .observed_at_epoch_ms
                            .map(|observed| now_epoch_ms.saturating_sub(observed)),
                        rebuild_state,
                        visibility,
                    },
                )
            })
            .collect();
        let visibility = if sources.is_empty() {
            ProjectionVisibility::Unavailable
        } else {
            sources
                .values()
                .fold(ProjectionVisibility::Available, |worst, source| {
                    worst.worst(source.visibility)
                })
        };
        let completeness = if !sources.is_empty()
            && sources
                .values()
                .all(|source| source.completeness == Completeness::Complete)
        {
            Completeness::Complete
        } else {
            Completeness::Partial
        };
        let max_lag_ms = sources.values().filter_map(|source| source.lag_ms).max();

        GlobalStatusView {
            visibility,
            source_frontier: owner.source_frontier,
            sources,
            completeness,
            max_lag_ms,
            owner_event_count: owner.owner_event_count,
            quarantine_count: self.quarantine.len(),
            rebuild_target_frontier,
            telemetry_visibility: TelemetryVisibility::Unavailable,
        }
    }

    pub fn quarantine(&self) -> &[QuarantineRecord] {
        &self.quarantine
    }

    fn apply_to_snapshot(
        policy: &ProjectionPolicy,
        snapshot: &mut Snapshot,
        event: &OwnerEventEnvelope,
    ) -> ApplyOutcome {
        if let Err(violation) = event.validate(policy.envelope) {
            return ApplyOutcome::Quarantined(QuarantineReason::InvalidEnvelope(violation));
        }

        if let Some(accepted) = snapshot.events.get(&event.canonical.record_identity) {
            let fingerprint = CanonicalEventFingerprint::from_event(event);
            return if accepted == &fingerprint {
                ApplyOutcome::Duplicate
            } else {
                ApplyOutcome::Quarantined(QuarantineReason::IdentityContentConflict)
            };
        }
        let source_key = SourceKey::from_validated(
            event.canonical.source_owner.clone(),
            event.canonical.source_node.clone(),
        );
        let sequence_key = (source_key.clone(), event.owner_sequence);

        if snapshot.sequence_identities.contains(&sequence_key) {
            return ApplyOutcome::Quarantined(QuarantineReason::SequenceIdentityConflict);
        }

        if snapshot.events.len() >= policy.max_event_identities
            || (!snapshot.sources.contains_key(&source_key)
                && snapshot.sources.len() >= policy.max_owner_nodes)
        {
            return ApplyOutcome::Quarantined(QuarantineReason::HighCardinality);
        }
        snapshot.sequence_identities.insert(sequence_key);
        let source = snapshot.sources.entry(source_key).or_default();
        source.sequences.insert(event.owner_sequence);

        if source
            .frontier
            .as_ref()
            .is_none_or(|frontier| event.owner_sequence > frontier.sequence)
        {
            source.frontier = Some(SourcePosition {
                sequence: event.owner_sequence,
                source_cut: event.source_cut.clone(),
            });
            source.observed_at_epoch_ms = Some(event.canonical.times.observed_at_epoch_ms);
            source.valid_through_epoch_ms = Some(event.projection_valid_through_epoch_ms);
        }
        snapshot.events.insert(
            event.canonical.record_identity.clone(),
            CanonicalEventFingerprint::from_event(event),
        );
        ApplyOutcome::Applied
    }

    fn record_outcome(&mut self, identity: &str, outcome: ApplyOutcome) -> ApplyOutcome {
        if let ApplyOutcome::Quarantined(reason) = &outcome
            && self.quarantine.len() < self.policy.max_quarantine_records
        {
            self.quarantine.push(QuarantineRecord {
                record_identity: identity.to_string(),
                reason: reason.clone(),
            });
        }
        outcome
    }
}

fn valid_source_component(value: &str) -> bool {
    !value.is_empty() && value.len() <= 160 && !value.chars().any(char::is_control)
}
