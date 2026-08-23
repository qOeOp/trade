#![allow(
    dead_code,
    reason = "crate-private Market Data authority is reached only by the private composition and durable-store tests"
)]

use std::{
    collections::{BTreeMap, BTreeSet},
    fmt::Debug,
    sync::Mutex,
};

use serde::{Deserialize, Serialize};

use super::{
    BindingDigest, MarketDataClockAdmission, MarketDataClockComparisonRule, MarketDataClockCutKind,
    SourceBindingBlocker, SourceBindingError, UntrustedCompleteFrontier,
    UntrustedCredentialAudienceClaim, UntrustedCredentialCapabilityClaim,
    UntrustedCredentialMaterialClaim, UntrustedMarketDataAsOf, UntrustedOpaqueCredentialHandle,
    UntrustedSourceBindingLocator, UntrustedSourceBindingLocatorFields,
    UntrustedSourceBindingProposal,
};

const IDENTITY_DOMAIN: &[u8] = b"vibe.market-data.source-binding.identity.v1";
const TIME_IDENTITY_DOMAIN: &[u8] = b"vibe.market-data.source-binding.time-evidence.v1";
const FACT_DOMAIN: &[u8] = b"vibe.market-data.source-binding.fact.v1";
const OUTBOX_DOMAIN: &[u8] = b"vibe.market-data.source-binding.outbox.v1";
const OWNER_ID: &str = "MARKET_DATA";

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(crate) enum SourceBindingDisposition {
    Admitted,
    Revoked,
    Unlicensed,
    Incompatible,
    Unavailable,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(crate) struct OwnerSourceBindingDecision {
    pub(crate) blockers: BTreeSet<SourceBindingBlocker>,
}

impl MarketDataClockAdmission {
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn seal_for_test(
        clock_identity: impl Into<String>,
        clock_epoch: impl Into<String>,
        monotonic_sequence: u64,
        wall_observed: u64,
        decision_cut: u64,
        valid_through: u64,
        restart_continuity_digest: BindingDigest,
        uncertainty_bound: u64,
        skew_bound: u64,
    ) -> Self {
        Self {
            cut_kind: MarketDataClockCutKind::MarketDataAsOf,
            clock_identity: clock_identity.into(),
            clock_epoch: clock_epoch.into(),
            monotonic_sequence,
            wall_observed,
            decision_cut,
            valid_through,
            restart_continuity_digest,
            uncertainty_bound,
            skew_bound,
            comparison_rule: MarketDataClockComparisonRule::ExclusiveValidThrough,
        }
    }
}

#[derive(Clone, Deserialize, Eq, PartialEq, Serialize)]
pub(crate) struct SourceBindingFact {
    proposal: UntrustedSourceBindingProposal,
    lineage_root: BindingDigest,
    lineage_version: u64,
    predecessor_binding_id: Option<BindingDigest>,
    predecessor_fact_digest: Option<BindingDigest>,
    binding_id: BindingDigest,
    blockers: BTreeSet<SourceBindingBlocker>,
    disposition: SourceBindingDisposition,
    primary_blocker: Option<SourceBindingBlocker>,
    digest: BindingDigest,
}

impl Debug for SourceBindingFact {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct(stringify!(SourceBindingFact))
            .field("lineage_root", &self.lineage_root)
            .field("lineage_version", &self.lineage_version)
            .field("binding_id", &self.binding_id)
            .field("blockers", &self.blockers)
            .field("disposition", &self.disposition)
            .field("primary_blocker", &self.primary_blocker)
            .field("digest", &self.digest)
            .finish_non_exhaustive()
    }
}

impl SourceBindingFact {
    pub(crate) const fn binding_id(&self) -> BindingDigest {
        self.binding_id
    }

    pub(crate) const fn lineage_root(&self) -> BindingDigest {
        self.lineage_root
    }

    pub(crate) const fn lineage_version(&self) -> u64 {
        self.lineage_version
    }

    pub(crate) const fn predecessor_binding_id(&self) -> Option<BindingDigest> {
        self.predecessor_binding_id
    }

    pub(crate) const fn predecessor_fact_digest(&self) -> Option<BindingDigest> {
        self.predecessor_fact_digest
    }

    pub(crate) const fn proposal(&self) -> &UntrustedSourceBindingProposal {
        &self.proposal
    }

    pub(super) const fn blockers(&self) -> &BTreeSet<SourceBindingBlocker> {
        &self.blockers
    }

    pub(crate) const fn disposition(&self) -> SourceBindingDisposition {
        self.disposition
    }

    pub(super) const fn primary_blocker(&self) -> Option<SourceBindingBlocker> {
        self.primary_blocker
    }

    pub(crate) const fn digest(&self) -> BindingDigest {
        self.digest
    }

    pub(crate) const fn source_frontier(&self) -> &UntrustedCompleteFrontier {
        &self.proposal.source_frontier
    }

    pub(crate) const fn correction_frontier(&self) -> &UntrustedCompleteFrontier {
        &self.proposal.correction_frontier
    }

    pub(crate) const fn time_evidence(&self) -> &UntrustedMarketDataAsOf {
        &self.proposal.time_evidence
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(crate) struct SourceBindingReceipt {
    locator: UntrustedSourceBindingLocator,
    outbox_digest: BindingDigest,
}

impl SourceBindingReceipt {
    pub(crate) const fn locator(&self) -> &UntrustedSourceBindingLocator {
        &self.locator
    }

    pub(crate) const fn outbox_digest(&self) -> BindingDigest {
        self.outbox_digest
    }
}

#[derive(Clone, Deserialize, Eq, PartialEq, Serialize)]
pub(crate) struct SourceBindingOutboxRecord {
    payload: Box<[u8]>,
    digest: BindingDigest,
}

impl Debug for SourceBindingOutboxRecord {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct(stringify!(SourceBindingOutboxRecord))
            .field("payload_len", &self.payload.len())
            .field("digest", &self.digest)
            .finish_non_exhaustive()
    }
}

impl SourceBindingOutboxRecord {
    pub(crate) const fn digest(&self) -> BindingDigest {
        self.digest
    }

    pub(crate) const fn payload_len(&self) -> usize {
        self.payload.len()
    }

    pub(crate) fn payload(&self) -> &[u8] {
        &self.payload
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(crate) struct SourceBindingCommit {
    fact: SourceBindingFact,
    receipt: SourceBindingReceipt,
}

impl SourceBindingCommit {
    pub(crate) const fn fact(&self) -> &SourceBindingFact {
        &self.fact
    }

    pub(crate) const fn receipt(&self) -> &SourceBindingReceipt {
        &self.receipt
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(crate) struct SourceBindingStoredAggregate {
    commit: SourceBindingCommit,
    outbox: SourceBindingOutboxRecord,
}

impl SourceBindingStoredAggregate {
    pub(crate) const fn commit(&self) -> &SourceBindingCommit {
        &self.commit
    }

    pub(crate) const fn outbox(&self) -> &SourceBindingOutboxRecord {
        &self.outbox
    }
}

#[derive(Debug, Default)]
struct InMemoryState {
    commits: BTreeMap<BindingDigest, SourceBindingStoredAggregate>,
    lineage_heads: BTreeMap<BindingDigest, BindingDigest>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum CommitFault {
    None,
    BeforeCommit,
    ResponseLoss,
}

#[derive(Debug, Default)]
pub(crate) struct TestOnlyInMemorySourceBindingOwner {
    state: Mutex<InMemoryState>,
}

impl TestOnlyInMemorySourceBindingOwner {
    pub(crate) fn commit_initial(
        &self,
        proposal: UntrustedSourceBindingProposal,
        decision: OwnerSourceBindingDecision,
        clock: &MarketDataClockAdmission,
    ) -> Result<SourceBindingCommit, SourceBindingError> {
        self.commit_initial_with_fault(proposal, decision, clock, CommitFault::None)
    }

    pub(crate) fn commit_successor(
        &self,
        predecessor: &UntrustedSourceBindingLocator,
        proposal: UntrustedSourceBindingProposal,
        decision: OwnerSourceBindingDecision,
        clock: &MarketDataClockAdmission,
    ) -> Result<SourceBindingCommit, SourceBindingError> {
        self.commit_successor_with_fault(predecessor, proposal, decision, clock, CommitFault::None)
    }

    pub(crate) fn resolve(
        &self,
        locator: &UntrustedSourceBindingLocator,
        clock: &MarketDataClockAdmission,
    ) -> Result<SourceBindingFact, SourceBindingError> {
        validate_clock_for_readback(&locator.time_evidence, clock)?;
        let state = self
            .state
            .lock()
            .map_err(|_| SourceBindingError::StoreUnavailable)?;
        let stored = state
            .commits
            .get(&locator.binding_id)
            .ok_or(SourceBindingError::LocatorMismatch)?;

        if &stored.commit.receipt.locator != locator {
            return Err(SourceBindingError::LocatorMismatch);
        }
        Ok(stored.commit.fact.clone())
    }

    pub(crate) fn resolve_at_consumer_cut(
        &self,
        locator: &UntrustedSourceBindingLocator,
        clock: &MarketDataClockAdmission,
    ) -> Result<SourceBindingFact, SourceBindingError> {
        validate_clock_for_consumer_cut(&locator.time_evidence, clock)?;
        let state = self
            .state
            .lock()
            .map_err(|_| SourceBindingError::StoreUnavailable)?;
        let stored = state
            .commits
            .get(&locator.binding_id)
            .ok_or(SourceBindingError::LocatorMismatch)?;

        if &stored.commit.receipt.locator != locator {
            return Err(SourceBindingError::LocatorMismatch);
        }
        Ok(stored.commit.fact.clone())
    }

    pub(super) fn resolve_outbox(
        &self,
        locator: &UntrustedSourceBindingLocator,
        clock: &MarketDataClockAdmission,
    ) -> Result<SourceBindingOutboxRecord, SourceBindingError> {
        validate_clock_for_readback(&locator.time_evidence, clock)?;
        let state = self
            .state
            .lock()
            .map_err(|_| SourceBindingError::StoreUnavailable)?;
        let stored = state
            .commits
            .get(&locator.binding_id)
            .ok_or(SourceBindingError::LocatorMismatch)?;

        if &stored.commit.receipt.locator != locator {
            return Err(SourceBindingError::LocatorMismatch);
        }
        Ok(stored.outbox.clone())
    }

    pub(super) fn commit_initial_with_fault(
        &self,
        proposal: UntrustedSourceBindingProposal,
        decision: OwnerSourceBindingDecision,
        clock: &MarketDataClockAdmission,
        fault: CommitFault,
    ) -> Result<SourceBindingCommit, SourceBindingError> {
        validate_proposal(&proposal, clock)?;
        let binding_id = derive_binding_id(&proposal);
        let lineage = OwnerLineage {
            root: binding_id,
            version: 1,
            predecessor_binding_id: None,
            predecessor_fact_digest: None,
        };
        let mut state = self
            .state
            .lock()
            .map_err(|_| SourceBindingError::StoreUnavailable)?;
        self.commit_locked(&mut state, proposal, decision, lineage, fault)
    }

    pub(super) fn commit_successor_with_fault(
        &self,
        predecessor: &UntrustedSourceBindingLocator,
        proposal: UntrustedSourceBindingProposal,
        decision: OwnerSourceBindingDecision,
        clock: &MarketDataClockAdmission,
        fault: CommitFault,
    ) -> Result<SourceBindingCommit, SourceBindingError> {
        validate_proposal(&proposal, clock)?;
        let binding_id = derive_binding_id(&proposal);
        let mut state = self
            .state
            .lock()
            .map_err(|_| SourceBindingError::StoreUnavailable)?;
        let predecessor_stored = state
            .commits
            .get(&predecessor.binding_id)
            .ok_or(SourceBindingError::LineageHeadMismatch)?;

        if &predecessor_stored.commit.receipt.locator != predecessor {
            return Err(SourceBindingError::LineageHeadMismatch);
        }
        let predecessor_fact = &predecessor_stored.commit.fact;
        let lineage = OwnerLineage {
            root: predecessor_fact.lineage_root,
            version: predecessor_fact.lineage_version.checked_add(1).ok_or(
                SourceBindingError::InvalidVersionOrSequence("lineage_version"),
            )?,
            predecessor_binding_id: Some(predecessor_fact.binding_id),
            predecessor_fact_digest: Some(predecessor_fact.digest),
        };

        if let Some(stored) = state.commits.get(&binding_id) {
            let expected_digest = digest(&canonical_fact_bytes(
                &proposal, &decision, binding_id, &lineage,
            ));

            return if stored.commit.fact.digest == expected_digest {
                Ok(stored.commit.clone())
            } else {
                Err(SourceBindingError::ReplayConflict)
            };
        }

        if state.lineage_heads.get(&lineage.root) != Some(&predecessor_fact.binding_id) {
            return Err(SourceBindingError::LineageHeadMismatch);
        }
        validate_successor_advances(predecessor_fact, &proposal)?;
        self.commit_locked(&mut state, proposal, decision, lineage, fault)
    }

    fn commit_locked(
        &self,
        state: &mut InMemoryState,
        proposal: UntrustedSourceBindingProposal,
        decision: OwnerSourceBindingDecision,
        lineage: OwnerLineage,
        fault: CommitFault,
    ) -> Result<SourceBindingCommit, SourceBindingError> {
        let binding_id = derive_binding_id(&proposal);
        let aggregate = build_stored_aggregate(proposal, decision, lineage);
        let fact_digest = aggregate.commit.fact.digest;

        if let Some(stored) = state.commits.get(&binding_id) {
            return if stored.commit.fact.digest == fact_digest {
                Ok(stored.commit.clone())
            } else {
                Err(SourceBindingError::ReplayConflict)
            };
        }

        if fault == CommitFault::BeforeCommit {
            return Err(SourceBindingError::CommitInterrupted);
        }

        let commit = aggregate.commit.clone();
        state.commits.insert(binding_id, aggregate);
        state.lineage_heads.insert(lineage.root, binding_id);

        if fault == CommitFault::ResponseLoss {
            Err(SourceBindingError::ResponseLost)
        } else {
            Ok(commit)
        }
    }

    pub(super) fn commit_count(&self) -> usize {
        self.state.lock().expect("test lock").commits.len()
    }

    pub(super) fn outbox_count(&self) -> usize {
        self.state.lock().expect("test lock").commits.len()
    }
}

pub(crate) fn validate_successor_advances(
    predecessor: &SourceBindingFact,
    successor: &UntrustedSourceBindingProposal,
) -> Result<(), SourceBindingError> {
    let previous = &predecessor.proposal;
    let source_advances =
        frontier_is_nondecreasing(&previous.source_frontier, &successor.source_frontier);
    let correction_advances = frontier_is_nondecreasing(
        &previous.correction_frontier,
        &successor.correction_frontier,
    );
    let previous_time = &previous.time_evidence;
    let next_time = &successor.time_evidence;
    let clock_continues = next_time.clock_identity == previous_time.clock_identity
        && next_time.clock_epoch == previous_time.clock_epoch
        && next_time.restart_continuity_digest == previous_time.restart_continuity_digest
        && next_time.uncertainty_bound == previous_time.uncertainty_bound
        && next_time.skew_bound == previous_time.skew_bound;
    let time_advances = next_time.monotonic_sequence > previous_time.monotonic_sequence
        && next_time.event_effective >= previous_time.event_effective
        && next_time.provider_available >= previous_time.provider_available
        && next_time.retrieval >= previous_time.retrieval
        && next_time.correction_publication >= previous_time.correction_publication
        && next_time.observed_at > previous_time.observed_at
        && next_time.effective_at > previous_time.effective_at
        && next_time.valid_through > next_time.effective_at;

    if source_advances && correction_advances && clock_continues && time_advances {
        Ok(())
    } else {
        Err(SourceBindingError::SuccessorDoesNotAdvance)
    }
}

fn frontier_is_nondecreasing(
    previous: &UntrustedCompleteFrontier,
    next: &UntrustedCompleteFrontier,
) -> bool {
    let cut_is_valid = if next.sequence == previous.sequence {
        next == previous
    } else {
        next.sequence > previous.sequence
            && next.cut_identity != previous.cut_identity
            && next.digest != previous.digest
    };

    next.stream_identity == previous.stream_identity && cut_is_valid
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct OwnerLineage {
    pub(crate) root: BindingDigest,
    pub(crate) version: u64,
    pub(crate) predecessor_binding_id: Option<BindingDigest>,
    pub(crate) predecessor_fact_digest: Option<BindingDigest>,
}

pub(crate) fn build_stored_aggregate(
    proposal: UntrustedSourceBindingProposal,
    decision: OwnerSourceBindingDecision,
    lineage: OwnerLineage,
) -> SourceBindingStoredAggregate {
    let binding_id = derive_binding_id(&proposal);
    let canonical = canonical_fact_bytes(&proposal, &decision, binding_id, &lineage);
    let fact_digest = digest(&canonical);
    let primary_blocker = primary_blocker(&decision.blockers);
    let fact = SourceBindingFact {
        proposal,
        lineage_root: lineage.root,
        lineage_version: lineage.version,
        predecessor_binding_id: lineage.predecessor_binding_id,
        predecessor_fact_digest: lineage.predecessor_fact_digest,
        binding_id,
        blockers: decision.blockers,
        disposition: disposition(primary_blocker),
        primary_blocker,
        digest: fact_digest,
    };
    let outbox_payload = canonical_outbox_bytes(&fact);
    let outbox_digest = digest(&outbox_payload);
    let locator = locator_for(&fact);
    SourceBindingStoredAggregate {
        commit: SourceBindingCommit {
            fact,
            receipt: SourceBindingReceipt {
                locator,
                outbox_digest,
            },
        },
        outbox: SourceBindingOutboxRecord {
            payload: outbox_payload.into_boxed_slice(),
            digest: outbox_digest,
        },
    }
}

pub(crate) fn verify_stored_aggregate(value: &SourceBindingStoredAggregate) -> bool {
    let fact = &value.commit.fact;
    let expected = build_stored_aggregate(
        fact.proposal.clone(),
        OwnerSourceBindingDecision {
            blockers: fact.blockers.clone(),
        },
        OwnerLineage {
            root: fact.lineage_root,
            version: fact.lineage_version,
            predecessor_binding_id: fact.predecessor_binding_id,
            predecessor_fact_digest: fact.predecessor_fact_digest,
        },
    );
    &expected == value
}

pub(crate) fn derive_binding_id(proposal: &UntrustedSourceBindingProposal) -> BindingDigest {
    digest(&canonical_semantic_bytes(proposal))
}

pub(crate) fn derive_time_evidence_identity(time: &UntrustedMarketDataAsOf) -> BindingDigest {
    let mut encoder = Encoder::new(TIME_IDENTITY_DOMAIN);
    encode_time_without_claim(&mut encoder, time);
    digest(&encoder.finish())
}

pub(crate) fn validate_proposal(
    proposal: &UntrustedSourceBindingProposal,
    clock: &MarketDataClockAdmission,
) -> Result<(), SourceBindingError> {
    if proposal.schema_version != 1 {
        return Err(SourceBindingError::InvalidVersionOrSequence(
            "schema_version",
        ));
    }
    validate_credential_handle(&proposal.credential_handle)?;

    if proposal.claimed_binding_id != derive_binding_id(proposal) {
        return Err(SourceBindingError::BindingIdentityMismatch);
    }
    nonzero_digest(
        proposal.adapter.implementation_digest,
        "implementation_digest",
    )?;
    nonzero_digest(
        proposal.adapter.configuration_digest,
        "configuration_digest",
    )?;
    nonempty(
        &proposal.adapter.authenticated_endpoint_identity,
        "authenticated_endpoint_identity",
    )?;
    nonempty(&proposal.adapter.dataset_mapping, "dataset_mapping")?;
    nonempty(&proposal.adapter.account_mapping, "account_mapping")?;
    nonempty(&proposal.trust_policy.identity, "trust_policy.identity")?;
    if proposal.trust_policy.version == 0 {
        return Err(SourceBindingError::InvalidVersionOrSequence(
            "trust_policy.version",
        ));
    }

    for (value, name) in [
        (&proposal.semantics.normalization, "semantics.normalization"),
        (&proposal.semantics.adjustment, "semantics.adjustment"),
        (&proposal.semantics.price_meaning, "semantics.price_meaning"),
        (
            &proposal.semantics.calendar_rules,
            "semantics.calendar_rules",
        ),
        (&proposal.semantics.session_rules, "semantics.session_rules"),
        (
            &proposal.semantics.timezone_rules,
            "semantics.timezone_rules",
        ),
        (
            &proposal.semantics.instrument_lifecycle_rules,
            "semantics.instrument_lifecycle_rules",
        ),
        (
            &proposal.semantics.corporate_action_rules,
            "semantics.corporate_action_rules",
        ),
        (
            &proposal.semantics.membership_rules,
            "semantics.membership_rules",
        ),
        (
            &proposal.semantics.universe_rules,
            "semantics.universe_rules",
        ),
        (
            &proposal.semantics.correction_policy,
            "semantics.correction_policy",
        ),
        (&proposal.license.use_scope, "license.use_scope"),
        (
            &proposal.license.redistribution_scope,
            "license.redistribution_scope",
        ),
        (
            &proposal.license.retention_policy,
            "license.retention_policy",
        ),
        (
            &proposal.license.redaction_policy,
            "license.redaction_policy",
        ),
    ] {
        nonempty(value, name)?;
    }
    validate_frontier(&proposal.source_frontier, "source_frontier")?;
    validate_frontier(&proposal.correction_frontier, "correction_frontier")?;
    validate_time_for_commit(&proposal.time_evidence, clock)
}

fn validate_credential_handle(
    credential: &UntrustedOpaqueCredentialHandle,
) -> Result<(), SourceBindingError> {
    let UntrustedCredentialMaterialClaim::HandleIdentity(identity) = credential.material else {
        return Err(SourceBindingError::RawCredentialMaterial);
    };
    nonzero_digest(identity, "credential_handle.identity")?;

    if credential.audience != UntrustedCredentialAudienceClaim::MarketData {
        return Err(SourceBindingError::InvalidCredentialAudience);
    }

    if credential.capabilities.is_empty()
        || credential
            .capabilities
            .iter()
            .any(|capability| !is_read_only_market_data_capability(*capability))
    {
        return Err(SourceBindingError::ForbiddenCredentialCapability);
    }
    Ok(())
}

const fn is_read_only_market_data_capability(
    capability: UntrustedCredentialCapabilityClaim,
) -> bool {
    matches!(
        capability,
        UntrustedCredentialCapabilityClaim::MarketDataRead
            | UntrustedCredentialCapabilityClaim::ReferenceDataRead
            | UntrustedCredentialCapabilityClaim::MetadataRead
    )
}

fn validate_time_for_commit(
    time: &UntrustedMarketDataAsOf,
    clock: &MarketDataClockAdmission,
) -> Result<(), SourceBindingError> {
    if time.claimed_evidence_identity != derive_time_evidence_identity(time) {
        return Err(SourceBindingError::TimeEvidenceIdentityMismatch);
    }
    validate_clock_admission(clock)?;
    validate_clock_compatibility(time, clock, true)?;
    let all_nonzero = [
        time.monotonic_sequence,
        time.skew_bound,
        time.event_effective,
        time.provider_available,
        time.retrieval,
        time.correction_publication,
        time.observed_at,
        time.effective_at,
        time.valid_through,
    ]
    .into_iter()
    .all(|value| value != 0);
    let exact_cut = time.observed_at == time.effective_at
        && time.effective_at == clock.decision_cut
        && time.monotonic_sequence == clock.monotonic_sequence
        && clock.wall_observed == clock.decision_cut;
    let available_at_cut = time.event_effective <= time.provider_available
        && time.provider_available <= time.retrieval
        && time.correction_publication <= time.retrieval
        && time.provider_available <= time.effective_at
        && time.retrieval <= time.effective_at
        && time.correction_publication <= time.effective_at
        && time.effective_at < time.valid_through;

    if !all_nonzero || !exact_cut || !available_at_cut {
        Err(SourceBindingError::InvalidTimeEvidence)
    } else {
        Ok(())
    }
}

pub(crate) fn validate_clock_for_readback(
    time: &UntrustedMarketDataAsOf,
    clock: &MarketDataClockAdmission,
) -> Result<(), SourceBindingError> {
    if time.claimed_evidence_identity != derive_time_evidence_identity(time) {
        return Err(SourceBindingError::TimeEvidenceIdentityMismatch);
    }
    validate_clock_admission(clock)?;
    validate_clock_compatibility(time, clock, true)?;
    if clock.decision_cut != time.effective_at {
        return Err(SourceBindingError::TrustedClockMismatch);
    }

    if clock.monotonic_sequence < time.monotonic_sequence
        || clock.wall_observed < time.effective_at
        || clock.wall_observed >= time.valid_through
    {
        return Err(SourceBindingError::InvalidTimeEvidence);
    }
    Ok(())
}

pub(crate) fn validate_clock_for_consumer_cut(
    time: &UntrustedMarketDataAsOf,
    clock: &MarketDataClockAdmission,
) -> Result<(), SourceBindingError> {
    if time.claimed_evidence_identity != derive_time_evidence_identity(time) {
        return Err(SourceBindingError::TimeEvidenceIdentityMismatch);
    }
    validate_clock_admission(clock)?;
    validate_clock_compatibility(time, clock, false)?;
    if clock.decision_cut != clock.wall_observed
        || clock.monotonic_sequence < time.monotonic_sequence
        || clock.decision_cut < time.effective_at
        || clock.decision_cut >= time.valid_through
    {
        return Err(SourceBindingError::InvalidTimeEvidence);
    }
    Ok(())
}

fn validate_clock_compatibility(
    time: &UntrustedMarketDataAsOf,
    clock: &MarketDataClockAdmission,
    exact_valid_through: bool,
) -> Result<(), SourceBindingError> {
    let exact = time.clock_identity == clock.clock_identity
        && time.clock_epoch == clock.clock_epoch
        && time.restart_continuity_digest == clock.restart_continuity_digest
        && time.uncertainty_bound == clock.uncertainty_bound
        && time.skew_bound == clock.skew_bound
        && (!exact_valid_through || time.valid_through == clock.valid_through);

    if exact {
        Ok(())
    } else {
        Err(SourceBindingError::TrustedClockMismatch)
    }
}

fn validate_clock_admission(clock: &MarketDataClockAdmission) -> Result<(), SourceBindingError> {
    if clock.is_complete() {
        Ok(())
    } else {
        Err(SourceBindingError::TrustedClockMismatch)
    }
}

fn nonempty(value: &str, name: &'static str) -> Result<(), SourceBindingError> {
    if value.trim().is_empty() {
        Err(SourceBindingError::MissingField(name))
    } else {
        Ok(())
    }
}

fn nonzero_digest(value: BindingDigest, name: &'static str) -> Result<(), SourceBindingError> {
    if value.as_bytes() == &[0; 32] {
        Err(SourceBindingError::ZeroDigest(name))
    } else {
        Ok(())
    }
}

fn validate_frontier(
    frontier: &UntrustedCompleteFrontier,
    name: &'static str,
) -> Result<(), SourceBindingError> {
    nonempty(&frontier.stream_identity, name)?;
    nonempty(&frontier.cut_identity, name)?;
    if frontier.sequence == 0 {
        return Err(SourceBindingError::InvalidVersionOrSequence(name));
    }
    nonzero_digest(frontier.digest, name)
}

fn primary_blocker(blockers: &BTreeSet<SourceBindingBlocker>) -> Option<SourceBindingBlocker> {
    blockers
        .iter()
        .copied()
        .min_by_key(|value| blocker_precedence(*value))
}

const fn blocker_precedence(blocker: SourceBindingBlocker) -> u8 {
    match blocker {
        SourceBindingBlocker::RightsRevoked => 0,
        SourceBindingBlocker::RightsDeniedOrUnlicensed => 1,
        SourceBindingBlocker::RightsEvidenceUnresolved => 2,
        SourceBindingBlocker::SourceIdentityOrConfigMismatch => 3,
        SourceBindingBlocker::SemanticsIncompatible => 4,
        SourceBindingBlocker::SourceUnavailable => 5,
        SourceBindingBlocker::EvidenceStaleOrIncomplete => 6,
    }
}

const fn disposition(primary: Option<SourceBindingBlocker>) -> SourceBindingDisposition {
    match primary {
        None => SourceBindingDisposition::Admitted,
        Some(SourceBindingBlocker::RightsRevoked) => SourceBindingDisposition::Revoked,
        Some(SourceBindingBlocker::RightsDeniedOrUnlicensed) => {
            SourceBindingDisposition::Unlicensed
        }
        Some(
            SourceBindingBlocker::SourceIdentityOrConfigMismatch
            | SourceBindingBlocker::SemanticsIncompatible,
        ) => SourceBindingDisposition::Incompatible,
        Some(
            SourceBindingBlocker::RightsEvidenceUnresolved
            | SourceBindingBlocker::SourceUnavailable
            | SourceBindingBlocker::EvidenceStaleOrIncomplete,
        ) => SourceBindingDisposition::Unavailable,
    }
}

fn locator_for(fact: &SourceBindingFact) -> UntrustedSourceBindingLocator {
    let UntrustedCredentialMaterialClaim::HandleIdentity(credential_handle_identity) =
        fact.proposal.credential_handle.material
    else {
        unreachable!("only a validated handle identity can enter an Owner fact")
    };

    UntrustedSourceBindingLocator::from_untrusted(UntrustedSourceBindingLocatorFields {
        owner: OWNER_ID.to_owned(),
        lineage_root: fact.lineage_root,
        lineage_version: fact.lineage_version,
        predecessor_binding_id: fact.predecessor_binding_id,
        predecessor_fact_digest: fact.predecessor_fact_digest,
        binding_id: fact.binding_id,
        fact_digest: fact.digest,
        credential_handle_identity,
        credential_audience: fact.proposal.credential_handle.audience,
        credential_capabilities: fact.proposal.credential_handle.capabilities.clone(),
        source_frontier: fact.proposal.source_frontier.clone(),
        correction_frontier: fact.proposal.correction_frontier.clone(),
        time_evidence: fact.proposal.time_evidence.clone(),
    })
}

fn digest(bytes: &[u8]) -> BindingDigest {
    BindingDigest::from_untrusted_bytes(*blake3::hash(bytes).as_bytes())
}

fn canonical_semantic_bytes(proposal: &UntrustedSourceBindingProposal) -> Vec<u8> {
    let mut encoder = Encoder::new(IDENTITY_DOMAIN);
    encoder.u16(proposal.schema_version);
    encode_semantic_tuple(&mut encoder, proposal);
    encoder.finish()
}

fn canonical_fact_bytes(
    proposal: &UntrustedSourceBindingProposal,
    decision: &OwnerSourceBindingDecision,
    binding_id: BindingDigest,
    lineage: &OwnerLineage,
) -> Vec<u8> {
    let mut encoder = Encoder::new(FACT_DOMAIN);
    encoder.digest(binding_id);
    encoder.digest(lineage.root);
    encoder.u64(lineage.version);
    encoder.optional_digest(lineage.predecessor_binding_id);
    encoder.optional_digest(lineage.predecessor_fact_digest);
    encoder.u16(proposal.schema_version);
    encode_semantic_tuple(&mut encoder, proposal);
    encoder.u64(decision.blockers.len() as u64);

    for blocker in &decision.blockers {
        encoder.u8(blocker_precedence(*blocker));
    }
    encoder.finish()
}

fn encode_semantic_tuple(encoder: &mut Encoder, proposal: &UntrustedSourceBindingProposal) {
    encoder.digest(proposal.adapter.implementation_digest);
    encoder.digest(proposal.adapter.configuration_digest);
    encoder.string(&proposal.adapter.authenticated_endpoint_identity);
    encoder.string(&proposal.adapter.dataset_mapping);
    encoder.string(&proposal.adapter.account_mapping);
    encode_credential_handle(encoder, &proposal.credential_handle);
    encoder.string(&proposal.trust_policy.identity);
    encoder.u64(proposal.trust_policy.version);

    for value in [
        &proposal.semantics.normalization,
        &proposal.semantics.adjustment,
        &proposal.semantics.price_meaning,
        &proposal.semantics.calendar_rules,
        &proposal.semantics.session_rules,
        &proposal.semantics.timezone_rules,
        &proposal.semantics.instrument_lifecycle_rules,
        &proposal.semantics.corporate_action_rules,
        &proposal.semantics.membership_rules,
        &proposal.semantics.universe_rules,
        &proposal.semantics.correction_policy,
        &proposal.license.use_scope,
        &proposal.license.redistribution_scope,
        &proposal.license.retention_policy,
        &proposal.license.redaction_policy,
    ] {
        encoder.string(value);
    }
    encoder.frontier(&proposal.source_frontier);
    encoder.frontier(&proposal.correction_frontier);
    encoder.digest(proposal.time_evidence.claimed_evidence_identity);
    encode_time_without_claim(encoder, &proposal.time_evidence);
}

fn encode_credential_handle(encoder: &mut Encoder, credential: &UntrustedOpaqueCredentialHandle) {
    match credential.material {
        UntrustedCredentialMaterialClaim::HandleIdentity(identity) => {
            encoder.u8(0);
            encoder.digest(identity);
        }
        UntrustedCredentialMaterialClaim::RawMaterialSupplied => encoder.u8(1),
    }
    encoder.u8(credential_audience_code(credential.audience));
    encoder.u64(credential.capabilities.len() as u64);

    for capability in &credential.capabilities {
        encoder.u8(credential_capability_code(*capability));
    }
}

const fn credential_audience_code(audience: UntrustedCredentialAudienceClaim) -> u8 {
    match audience {
        UntrustedCredentialAudienceClaim::MarketData => 0,
        UntrustedCredentialAudienceClaim::Execution => 1,
        UntrustedCredentialAudienceClaim::Paper => 2,
        UntrustedCredentialAudienceClaim::Account => 3,
        UntrustedCredentialAudienceClaim::Order => 4,
        UntrustedCredentialAudienceClaim::Trading => 5,
        UntrustedCredentialAudienceClaim::PrivateEffect => 6,
    }
}

const fn credential_capability_code(capability: UntrustedCredentialCapabilityClaim) -> u8 {
    match capability {
        UntrustedCredentialCapabilityClaim::MarketDataRead => 0,
        UntrustedCredentialCapabilityClaim::ReferenceDataRead => 1,
        UntrustedCredentialCapabilityClaim::MetadataRead => 2,
        UntrustedCredentialCapabilityClaim::AccountRead => 3,
        UntrustedCredentialCapabilityClaim::OrderReadOrWrite => 4,
        UntrustedCredentialCapabilityClaim::Trading => 5,
        UntrustedCredentialCapabilityClaim::PrivateEffect => 6,
    }
}

fn encode_time_without_claim(encoder: &mut Encoder, time: &UntrustedMarketDataAsOf) {
    encoder.string(&time.clock_identity);
    encoder.string(&time.clock_epoch);
    encoder.u64(time.monotonic_sequence);
    encoder.digest(time.restart_continuity_digest);
    encoder.u64(time.skew_bound);
    encoder.u64(time.uncertainty_bound);
    encoder.u64(time.event_effective);
    encoder.u64(time.provider_available);
    encoder.u64(time.retrieval);
    encoder.u64(time.correction_publication);
    encoder.u64(time.observed_at);
    encoder.u64(time.effective_at);
    encoder.u64(time.valid_through);
}

fn canonical_outbox_bytes(fact: &SourceBindingFact) -> Vec<u8> {
    let mut encoder = Encoder::new(OUTBOX_DOMAIN);
    encoder.string(OWNER_ID);
    encoder.digest(fact.lineage_root);
    encoder.u64(fact.lineage_version);
    encoder.optional_digest(fact.predecessor_binding_id);
    encoder.optional_digest(fact.predecessor_fact_digest);
    encoder.digest(fact.binding_id);
    encoder.digest(fact.digest);
    encoder.u8(match fact.disposition {
        SourceBindingDisposition::Admitted => 0,
        SourceBindingDisposition::Revoked => 1,
        SourceBindingDisposition::Unlicensed => 2,
        SourceBindingDisposition::Incompatible => 3,
        SourceBindingDisposition::Unavailable => 4,
    });
    encoder.optional_u8(fact.primary_blocker.map(blocker_precedence));
    encoder.u64(fact.blockers.len() as u64);

    for blocker in &fact.blockers {
        encoder.u8(blocker_precedence(*blocker));
    }
    encode_credential_handle(&mut encoder, &fact.proposal.credential_handle);
    encoder.frontier(&fact.proposal.source_frontier);
    encoder.frontier(&fact.proposal.correction_frontier);
    encoder.digest(fact.proposal.time_evidence.claimed_evidence_identity);
    encode_time_without_claim(&mut encoder, &fact.proposal.time_evidence);
    encoder.finish()
}

struct Encoder(Vec<u8>);

impl Encoder {
    fn new(domain: &[u8]) -> Self {
        let mut encoder = Self(Vec::new());
        encoder.bytes(domain);
        encoder
    }

    fn finish(self) -> Vec<u8> {
        self.0
    }

    fn bytes(&mut self, value: &[u8]) {
        self.u64(value.len() as u64);
        self.0.extend_from_slice(value);
    }

    fn string(&mut self, value: &str) {
        self.bytes(value.as_bytes());
    }

    fn u8(&mut self, value: u8) {
        self.0.push(value);
    }

    fn u16(&mut self, value: u16) {
        self.0.extend_from_slice(&value.to_be_bytes());
    }

    fn u64(&mut self, value: u64) {
        self.0.extend_from_slice(&value.to_be_bytes());
    }

    fn digest(&mut self, value: BindingDigest) {
        self.bytes(value.as_bytes());
    }

    fn optional_digest(&mut self, value: Option<BindingDigest>) {
        match value {
            Some(value) => {
                self.u8(1);
                self.digest(value);
            }
            None => self.u8(0),
        }
    }

    fn optional_u8(&mut self, value: Option<u8>) {
        match value {
            Some(value) => {
                self.u8(1);
                self.u8(value);
            }
            None => self.u8(0),
        }
    }

    fn frontier(&mut self, frontier: &UntrustedCompleteFrontier) {
        self.string(&frontier.stream_identity);
        self.string(&frontier.cut_identity);
        self.u64(frontier.sequence);
        self.digest(frontier.digest);
    }
}
