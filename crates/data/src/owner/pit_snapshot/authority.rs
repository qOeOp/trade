#![allow(
    dead_code,
    reason = "crate-private Market Data authority is reached only by the private composition and durable-store tests"
)]

use std::collections::{BTreeMap, BTreeSet};

use super::{
    BindingDigest, PitSnapshotBlocker, PitSnapshotCommitAggregate, PitSnapshotDisposition,
    PitSnapshotError, PitSnapshotFact, PitSnapshotOutboxRecord, PitSnapshotPersistencePort,
    PitSnapshotPersistenceResult, PitSnapshotReceipt, UntrustedCorrectionPublicationTime,
    UntrustedEventEffectiveTime, UntrustedPitObservationBatchProposal, UntrustedPitSnapshotLocator,
    UntrustedPitSnapshotLocatorFields, UntrustedPitSnapshotProposal, UntrustedPitSnapshotRequest,
    UntrustedPitSnapshotTimeEvidence, UntrustedProviderAvailableTime, UntrustedRetrievalTime,
    UntrustedSnapshotDecisionCut, VerifiedPitObservation, VerifiedPitObservationBatch,
};
use crate::owner::source_binding::{
    MarketDataClockAdmission, MarketDataClockComparisonRule, MarketDataClockCutKind,
    UntrustedCompleteFrontier, UntrustedCredentialAudienceClaim,
    UntrustedCredentialCapabilityClaim, UntrustedMarketDataAsOf, UntrustedSourceBindingLocator,
    authority::{SourceBindingDisposition, TestOnlyInMemorySourceBindingOwner},
};

const REQUEST_DIGEST_DOMAIN: &[u8] = b"vibe.market-data.pit-snapshot.request-content.v1";
const REQUEST_IDENTITY_DOMAIN: &[u8] = b"vibe.market-data.pit-snapshot.request-identity.v1";
const SNAPSHOT_IDENTITY_DOMAIN: &[u8] = b"vibe.market-data.pit-snapshot.identity.v1";
const FACT_DOMAIN: &[u8] = b"vibe.market-data.pit-snapshot.fact.v1";
const OUTBOX_DOMAIN: &[u8] = b"vibe.market-data.pit-snapshot.outbox.v1";
const OWNER_ID: &str = "MARKET_DATA";

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct OwnerResolvedCanonicalBasis {
    request: UntrustedPitSnapshotRequest,
    evidence: super::UntrustedPitSnapshotEvidence,
    clock_admission: MarketDataClockAdmission,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct TestOnlyCanonicalBasisResolver {
    basis: OwnerResolvedCanonicalBasis,
}

impl TestOnlyCanonicalBasisResolver {
    pub(crate) fn seal_for_test(
        request: UntrustedPitSnapshotRequest,
        evidence: super::UntrustedPitSnapshotEvidence,
        clock_admission: MarketDataClockAdmission,
    ) -> Self {
        Self {
            basis: OwnerResolvedCanonicalBasis {
                request,
                evidence,
                clock_admission,
            },
        }
    }

    pub(crate) fn resolve(
        &self,
        request: &UntrustedPitSnapshotRequest,
        evidence: &super::UntrustedPitSnapshotEvidence,
        clock_admission: &MarketDataClockAdmission,
    ) -> Result<&OwnerResolvedCanonicalBasis, PitSnapshotError> {
        if &self.basis.request == request
            && &self.basis.evidence == evidence
            && &self.basis.clock_admission == clock_admission
        {
            Ok(&self.basis)
        } else {
            Err(PitSnapshotError::CanonicalBasisMismatch)
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum CommitFault {
    None,
    BeforeCommit,
    ResponseLoss,
}

#[derive(Debug, Default)]
pub(crate) struct TestOnlyInMemoryPitSnapshotStore {
    by_snapshot: BTreeMap<BindingDigest, PitSnapshotCommitAggregate>,
    request_cuts: BTreeMap<(BindingDigest, String, u64), BindingDigest>,
    lineage_heads: BTreeMap<BindingDigest, BindingDigest>,
}

impl PitSnapshotPersistencePort for TestOnlyInMemoryPitSnapshotStore {
    fn commit_fact_and_outbox_atomically(
        &mut self,
        aggregate: PitSnapshotCommitAggregate,
    ) -> Result<PitSnapshotPersistenceResult, PitSnapshotError> {
        let fact = aggregate.fact();
        let snapshot_identity = fact.snapshot_identity;

        if let Some(stored) = self.by_snapshot.get(&snapshot_identity) {
            return if stored == &aggregate {
                Ok(PitSnapshotPersistenceResult::ExactReplay(stored.clone()))
            } else {
                Err(PitSnapshotError::ReplayConflict)
            };
        }

        let cut_key = (
            fact.request.claimed_request_identity,
            fact.evidence.correction_frontier.stream_identity.clone(),
            fact.evidence.correction_frontier.sequence,
        );

        if self.request_cuts.contains_key(&cut_key) {
            return Err(PitSnapshotError::ReplayConflict);
        }

        match (
            fact.lineage_version,
            fact.predecessor_snapshot_identity,
            fact.predecessor_fact_digest,
        ) {
            (1, None, None) => {
                if self.lineage_heads.contains_key(&fact.lineage_root) {
                    return Err(PitSnapshotError::ReplayConflict);
                }
            }
            (_, Some(predecessor_identity), Some(_)) => {
                if self.lineage_heads.get(&fact.lineage_root) != Some(&predecessor_identity) {
                    return Err(PitSnapshotError::CorrectionHeadMismatch);
                }
            }
            _ => return Err(PitSnapshotError::CorrectionHeadMismatch),
        }

        self.request_cuts.insert(cut_key, snapshot_identity);
        self.lineage_heads
            .insert(fact.lineage_root, snapshot_identity);
        self.by_snapshot
            .insert(snapshot_identity, aggregate.clone());
        Ok(PitSnapshotPersistenceResult::Inserted(aggregate))
    }

    fn resolve_exact(
        &self,
        locator: &UntrustedPitSnapshotLocator,
    ) -> Result<PitSnapshotCommitAggregate, PitSnapshotError> {
        let stored = self
            .by_snapshot
            .get(&locator.snapshot_identity)
            .ok_or(PitSnapshotError::LocatorMismatch)?;

        if stored.receipt().locator() == locator {
            Ok(stored.clone())
        } else {
            Err(PitSnapshotError::LocatorMismatch)
        }
    }
}

impl TestOnlyInMemoryPitSnapshotStore {
    pub(crate) fn commit_count(&self) -> usize {
        self.by_snapshot.len()
    }

    pub(crate) fn outbox_count(&self) -> usize {
        self.by_snapshot.len()
    }
}

#[derive(Debug, Default)]
pub(crate) struct TestOnlyPitSnapshotOwner {
    store: TestOnlyInMemoryPitSnapshotStore,
}

impl TestOnlyPitSnapshotOwner {
    pub(crate) fn commit_initial(
        &mut self,
        proposal: UntrustedPitSnapshotProposal,
        canonical_basis: &TestOnlyCanonicalBasisResolver,
        source_owner: &TestOnlyInMemorySourceBindingOwner,
        clock: &MarketDataClockAdmission,
    ) -> Result<PitSnapshotCommitAggregate, PitSnapshotError> {
        self.commit_initial_with_fault(
            proposal,
            canonical_basis,
            source_owner,
            clock,
            CommitFault::None,
        )
    }

    pub(crate) fn commit_initial_with_fault(
        &mut self,
        proposal: UntrustedPitSnapshotProposal,
        canonical_basis: &TestOnlyCanonicalBasisResolver,
        source_owner: &TestOnlyInMemorySourceBindingOwner,
        clock: &MarketDataClockAdmission,
        fault: CommitFault,
    ) -> Result<PitSnapshotCommitAggregate, PitSnapshotError> {
        let (source_fact, basis) =
            validate_and_resolve(&proposal, canonical_basis, source_owner, clock)?;
        let blockers = derive_blockers(&proposal.request.time_evidence, &source_fact, basis);
        let snapshot_identity =
            derive_snapshot_identity(&proposal, source_fact.binding_id(), &blockers);
        let lineage = OwnerLineage {
            root: snapshot_identity,
            version: 1,
            predecessor_snapshot_identity: None,
            predecessor_fact_digest: None,
        };
        self.commit(
            proposal,
            ResolvedSourceBinding::from_fact(&source_fact),
            clock.clone(),
            blockers,
            lineage,
            fault,
        )
    }

    pub(crate) fn commit_correction(
        &mut self,
        predecessor: &UntrustedPitSnapshotLocator,
        proposal: UntrustedPitSnapshotProposal,
        canonical_basis: &TestOnlyCanonicalBasisResolver,
        source_owner: &TestOnlyInMemorySourceBindingOwner,
        clock: &MarketDataClockAdmission,
    ) -> Result<PitSnapshotCommitAggregate, PitSnapshotError> {
        let prior = self.store.resolve_exact(predecessor)?;
        let prior_fact = prior.fact();
        validate_correction_request(prior_fact, &proposal)?;
        validate_correction_advances(prior_fact, &proposal)?;

        let (source_fact, basis) =
            validate_and_resolve(&proposal, canonical_basis, source_owner, clock)?;
        validate_source_binding_successor(prior_fact, &source_fact)?;
        let blockers = derive_blockers(&proposal.request.time_evidence, &source_fact, basis);
        let lineage = OwnerLineage {
            root: prior_fact.lineage_root,
            version: prior_fact
                .lineage_version
                .checked_add(1)
                .ok_or(PitSnapshotError::InvalidCorrectionSequence)?,
            predecessor_snapshot_identity: Some(prior_fact.snapshot_identity),
            predecessor_fact_digest: Some(prior_fact.digest),
        };
        self.commit(
            proposal,
            ResolvedSourceBinding::from_fact(&source_fact),
            clock.clone(),
            blockers,
            lineage,
            CommitFault::None,
        )
    }

    fn commit(
        &mut self,
        proposal: UntrustedPitSnapshotProposal,
        source_binding: ResolvedSourceBinding,
        clock_admission: MarketDataClockAdmission,
        blockers: BTreeSet<PitSnapshotBlocker>,
        lineage: OwnerLineage,
        fault: CommitFault,
    ) -> Result<PitSnapshotCommitAggregate, PitSnapshotError> {
        let aggregate =
            build_aggregate(proposal, source_binding, clock_admission, blockers, lineage);

        if fault == CommitFault::BeforeCommit {
            return Err(PitSnapshotError::CommitInterrupted);
        }

        let persisted = self.store.commit_fact_and_outbox_atomically(aggregate)?;

        if fault == CommitFault::ResponseLoss {
            return Err(PitSnapshotError::ResponseLost);
        }

        match persisted {
            PitSnapshotPersistenceResult::Inserted(value)
            | PitSnapshotPersistenceResult::ExactReplay(value) => Ok(value),
        }
    }

    pub(crate) fn resolve(
        &self,
        locator: &UntrustedPitSnapshotLocator,
        clock: &MarketDataClockAdmission,
    ) -> Result<PitSnapshotCommitAggregate, PitSnapshotError> {
        validate_read_clock(&locator.time_evidence, clock)?;
        self.store.resolve_exact(locator)
    }

    pub(crate) fn commit_count(&self) -> usize {
        self.store.commit_count()
    }

    pub(crate) fn outbox_count(&self) -> usize {
        self.store.outbox_count()
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct OwnerLineage {
    pub(crate) root: BindingDigest,
    pub(crate) version: u64,
    pub(crate) predecessor_snapshot_identity: Option<BindingDigest>,
    pub(crate) predecessor_fact_digest: Option<BindingDigest>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct ResolvedSourceBinding {
    pub(crate) identity: BindingDigest,
    pub(crate) lineage_root: BindingDigest,
    pub(crate) lineage_version: u64,
}

impl ResolvedSourceBinding {
    pub(crate) fn from_fact(
        fact: &crate::owner::source_binding::authority::SourceBindingFact,
    ) -> Self {
        Self {
            identity: fact.binding_id(),
            lineage_root: fact.lineage_root(),
            lineage_version: fact.lineage_version(),
        }
    }
}

pub(crate) fn build_aggregate(
    proposal: UntrustedPitSnapshotProposal,
    source_binding: ResolvedSourceBinding,
    clock_admission: MarketDataClockAdmission,
    blockers: BTreeSet<PitSnapshotBlocker>,
    lineage: OwnerLineage,
) -> PitSnapshotCommitAggregate {
    let primary_blocker = primary_blocker(&blockers);
    let disposition = disposition(primary_blocker);
    let snapshot_identity = derive_snapshot_identity(&proposal, source_binding.identity, &blockers);
    let fact_bytes = canonical_fact_bytes(
        &proposal,
        &clock_admission,
        &source_binding,
        snapshot_identity,
        &blockers,
        &lineage,
    );
    let fact_digest = digest(&fact_bytes);
    let fact = PitSnapshotFact {
        request: proposal.request,
        evidence: proposal.evidence,
        clock_admission,
        source_binding_identity: source_binding.identity,
        source_binding_lineage_root: source_binding.lineage_root,
        source_binding_lineage_version: source_binding.lineage_version,
        snapshot_identity,
        lineage_root: lineage.root,
        lineage_version: lineage.version,
        predecessor_snapshot_identity: lineage.predecessor_snapshot_identity,
        predecessor_fact_digest: lineage.predecessor_fact_digest,
        blockers,
        disposition,
        primary_blocker,
        digest: fact_digest,
    };
    let payload = canonical_outbox_bytes(&fact);
    let outbox_digest = digest(&payload);
    let locator = locator_for(&fact);
    PitSnapshotCommitAggregate {
        fact,
        outbox: PitSnapshotOutboxRecord {
            payload: payload.into_boxed_slice(),
            digest: outbox_digest,
        },
        receipt: PitSnapshotReceipt {
            locator,
            outbox_digest,
        },
    }
}

pub(crate) fn verify_aggregate(value: &PitSnapshotCommitAggregate) -> bool {
    let fact = &value.fact;
    let expected = build_aggregate(
        UntrustedPitSnapshotProposal {
            request: fact.request.clone(),
            evidence: fact.evidence.clone(),
        },
        ResolvedSourceBinding {
            identity: fact.source_binding_identity,
            lineage_root: fact.source_binding_lineage_root,
            lineage_version: fact.source_binding_lineage_version,
        },
        fact.clock_admission.clone(),
        fact.blockers.clone(),
        OwnerLineage {
            root: fact.lineage_root,
            version: fact.lineage_version,
            predecessor_snapshot_identity: fact.predecessor_snapshot_identity,
            predecessor_fact_digest: fact.predecessor_fact_digest,
        },
    );
    &expected == value
}

pub(crate) fn verify_terminal_basis(
    aggregate: &PitSnapshotCommitAggregate,
    source: &crate::owner::source_binding::authority::SourceBindingFact,
) -> bool {
    let fact = aggregate.fact();
    if validate_request(fact.request()).is_err()
        || validate_evidence(fact.evidence()).is_err()
        || validate_commit_clock(&fact.request().time_evidence, fact.clock_admission()).is_err()
        || source.binding_id() != fact.source_binding_identity()
        || source.lineage_root() != fact.source_binding_lineage_root()
        || source.lineage_version() != fact.source_binding_lineage_version()
        || source.source_frontier() != &fact.evidence().source_frontier
        || source.correction_frontier() != &fact.evidence().correction_frontier
    {
        return false;
    }
    let basis = OwnerResolvedCanonicalBasis {
        request: fact.request().clone(),
        evidence: fact.evidence().clone(),
        clock_admission: fact.clock_admission().clone(),
    };
    let blockers = derive_blockers(&fact.request().time_evidence, source, &basis);
    blockers == *fact.blockers()
        && primary_blocker(&blockers) == fact.primary_blocker()
        && disposition(primary_blocker(&blockers)) == fact.disposition()
}

fn validate_and_resolve<'a>(
    proposal: &UntrustedPitSnapshotProposal,
    canonical_basis: &'a TestOnlyCanonicalBasisResolver,
    source_owner: &TestOnlyInMemorySourceBindingOwner,
    clock: &MarketDataClockAdmission,
) -> Result<
    (
        crate::owner::source_binding::authority::SourceBindingFact,
        &'a OwnerResolvedCanonicalBasis,
    ),
    PitSnapshotError,
> {
    validate_request(&proposal.request)?;
    validate_evidence(&proposal.evidence)?;
    let basis = canonical_basis.resolve(&proposal.request, &proposal.evidence, clock)?;
    validate_commit_clock(&proposal.request.time_evidence, clock)?;
    let source_fact = source_owner
        .resolve_at_consumer_cut(&proposal.request.source_binding, clock)
        .map_err(|_| PitSnapshotError::SourceBindingUnavailable)?;

    if source_fact.source_frontier() != &proposal.evidence.source_frontier
        || source_fact.correction_frontier() != &proposal.evidence.correction_frontier
    {
        return Err(PitSnapshotError::CanonicalBasisMismatch);
    }
    Ok((source_fact, basis))
}

pub(crate) fn prepare_initial_aggregate(
    proposal: UntrustedPitSnapshotProposal,
    canonical_basis: &TestOnlyCanonicalBasisResolver,
    source_fact: &crate::owner::source_binding::authority::SourceBindingFact,
    clock: &MarketDataClockAdmission,
) -> Result<PitSnapshotCommitAggregate, PitSnapshotError> {
    let basis = validate_and_resolve_fact(&proposal, canonical_basis, source_fact, clock)?;
    let blockers = derive_blockers(&proposal.request.time_evidence, source_fact, basis);
    let snapshot_identity =
        derive_snapshot_identity(&proposal, source_fact.binding_id(), &blockers);
    Ok(build_aggregate(
        proposal,
        ResolvedSourceBinding::from_fact(source_fact),
        clock.clone(),
        blockers,
        OwnerLineage {
            root: snapshot_identity,
            version: 1,
            predecessor_snapshot_identity: None,
            predecessor_fact_digest: None,
        },
    ))
}

pub(crate) fn prepare_correction_aggregate(
    predecessor: &PitSnapshotFact,
    proposal: UntrustedPitSnapshotProposal,
    canonical_basis: &TestOnlyCanonicalBasisResolver,
    source_fact: &crate::owner::source_binding::authority::SourceBindingFact,
    clock: &MarketDataClockAdmission,
) -> Result<PitSnapshotCommitAggregate, PitSnapshotError> {
    validate_correction_request(predecessor, &proposal)?;
    validate_correction_advances(predecessor, &proposal)?;
    let basis = validate_and_resolve_fact(&proposal, canonical_basis, source_fact, clock)?;
    validate_source_binding_successor(predecessor, source_fact)?;
    let blockers = derive_blockers(&proposal.request.time_evidence, source_fact, basis);
    let lineage_version = predecessor
        .lineage_version
        .checked_add(1)
        .ok_or(PitSnapshotError::InvalidCorrectionSequence)?;
    Ok(build_aggregate(
        proposal,
        ResolvedSourceBinding::from_fact(source_fact),
        clock.clone(),
        blockers,
        OwnerLineage {
            root: predecessor.lineage_root,
            version: lineage_version,
            predecessor_snapshot_identity: Some(predecessor.snapshot_identity),
            predecessor_fact_digest: Some(predecessor.digest),
        },
    ))
}

fn validate_and_resolve_fact<'a>(
    proposal: &UntrustedPitSnapshotProposal,
    canonical_basis: &'a TestOnlyCanonicalBasisResolver,
    source_fact: &crate::owner::source_binding::authority::SourceBindingFact,
    clock: &MarketDataClockAdmission,
) -> Result<&'a OwnerResolvedCanonicalBasis, PitSnapshotError> {
    validate_request(&proposal.request)?;
    validate_evidence(&proposal.evidence)?;
    let basis = canonical_basis.resolve(&proposal.request, &proposal.evidence, clock)?;
    validate_commit_clock(&proposal.request.time_evidence, clock)?;
    crate::owner::source_binding::authority::validate_clock_for_consumer_cut(
        source_fact.time_evidence(),
        clock,
    )
    .map_err(|_| PitSnapshotError::SourceBindingUnavailable)?;

    if source_fact.source_frontier() != &proposal.evidence.source_frontier
        || source_fact.correction_frontier() != &proposal.evidence.correction_frontier
    {
        return Err(PitSnapshotError::CanonicalBasisMismatch);
    }
    Ok(basis)
}

pub(crate) fn validate_request(
    request: &UntrustedPitSnapshotRequest,
) -> Result<(), PitSnapshotError> {
    for (digest, name) in [
        (request.correlation_identity, "correlation_identity"),
        (request.requester_identity, "requester_identity"),
        (request.scope_digest, "scope_digest"),
        (request.instrument_master_digest, "instrument_master_digest"),
        (
            request.universe_selection_digest,
            "universe_selection_digest",
        ),
        (
            request.market_semantics_identity,
            "market_semantics_identity",
        ),
    ] {
        nonzero_digest(digest, name)?;
    }

    if request.claimed_request_digest != derive_request_digest(request) {
        return Err(PitSnapshotError::RequestDigestMismatch);
    }

    if request.claimed_request_identity != derive_request_identity(request) {
        return Err(PitSnapshotError::RequestIdentityMismatch);
    }
    Ok(())
}

pub(crate) fn validate_evidence(
    evidence: &super::UntrustedPitSnapshotEvidence,
) -> Result<(), PitSnapshotError> {
    nonzero_digest(
        evidence.normalized_records_digest,
        "normalized_records_digest",
    )?;
    validate_frontier(&evidence.source_frontier, "source_frontier")?;
    validate_frontier(&evidence.correction_frontier, "correction_frontier")
}

fn validate_frontier(
    frontier: &UntrustedCompleteFrontier,
    name: &'static str,
) -> Result<(), PitSnapshotError> {
    if frontier.stream_identity.trim().is_empty() || frontier.cut_identity.trim().is_empty() {
        return Err(PitSnapshotError::MissingField(name));
    }

    if frontier.sequence == 0 {
        return Err(PitSnapshotError::MissingField(name));
    }
    nonzero_digest(frontier.digest, name)
}

fn nonzero_digest(digest: BindingDigest, name: &'static str) -> Result<(), PitSnapshotError> {
    if digest.as_bytes() == &[0; 32] {
        Err(PitSnapshotError::ZeroDigest(name))
    } else {
        Ok(())
    }
}

pub(crate) fn validate_commit_clock(
    time: &UntrustedPitSnapshotTimeEvidence,
    clock: &MarketDataClockAdmission,
) -> Result<(), PitSnapshotError> {
    let exact = time.decision_cut.clock_identity == clock.clock_identity
        && time.decision_cut.clock_epoch == clock.clock_epoch
        && time.decision_cut.value == clock.decision_cut
        && time.monotonic_sequence == clock.monotonic_sequence
        && time.restart_continuity_digest == clock.restart_continuity_digest
        && time.uncertainty_bound == clock.uncertainty_bound
        && time.skew_bound == clock.skew_bound
        && time.observed_at == clock.wall_observed
        && time.valid_through == clock.valid_through
        && clock.wall_observed == clock.decision_cut;

    if clock.is_complete() && exact {
        Ok(())
    } else {
        Err(PitSnapshotError::TrustedClockMismatch)
    }
}

pub(crate) fn validate_read_clock(
    time: &UntrustedPitSnapshotTimeEvidence,
    clock: &MarketDataClockAdmission,
) -> Result<(), PitSnapshotError> {
    let exact_cut = clock.clock_identity == time.decision_cut.clock_identity
        && clock.clock_epoch == time.decision_cut.clock_epoch
        && clock.decision_cut == time.decision_cut.value
        && clock.restart_continuity_digest == time.restart_continuity_digest
        && clock.uncertainty_bound == time.uncertainty_bound
        && clock.skew_bound == time.skew_bound
        && clock.valid_through == time.valid_through;

    if !clock.is_complete() || !exact_cut || clock.monotonic_sequence < time.monotonic_sequence {
        return Err(PitSnapshotError::TrustedClockMismatch);
    }

    if clock.wall_observed < time.decision_cut.value || clock.wall_observed >= time.valid_through {
        return Err(PitSnapshotError::TrustedClockMismatch);
    }
    Ok(())
}

pub(crate) fn validate_correction_request(
    predecessor: &PitSnapshotFact,
    proposal: &UntrustedPitSnapshotProposal,
) -> Result<(), PitSnapshotError> {
    if proposal.request.correlation_identity != predecessor.request.correlation_identity
        || proposal.request.requester_identity != predecessor.request.requester_identity
        || proposal.request.scope_digest != predecessor.request.scope_digest
        || proposal.request.instrument_master_digest != predecessor.request.instrument_master_digest
        || proposal.request.universe_selection_digest
            != predecessor.request.universe_selection_digest
        || proposal.request.market_semantics_identity
            != predecessor.request.market_semantics_identity
        || proposal.request.claimed_request_identity == predecessor.request.claimed_request_identity
        || proposal.request.claimed_request_digest == predecessor.request.claimed_request_digest
    {
        return Err(PitSnapshotError::CorrectionHeadMismatch);
    }
    Ok(())
}

pub(crate) fn validate_correction_advances(
    predecessor: &PitSnapshotFact,
    proposal: &UntrustedPitSnapshotProposal,
) -> Result<(), PitSnapshotError> {
    let source_advances = frontier_is_nondecreasing(
        &predecessor.evidence.source_frontier,
        &proposal.evidence.source_frontier,
    );
    let correction_advances = correction_frontier_is_exact_successor(
        &predecessor.evidence.correction_frontier,
        &proposal.evidence.correction_frontier,
    );
    let previous = &predecessor.request.time_evidence;
    let next = &proposal.request.time_evidence;
    let (Some(previous_correction), Some(next_correction)) = (
        previous.correction_publication.as_ref(),
        next.correction_publication.as_ref(),
    ) else {
        return Err(PitSnapshotError::InvalidCorrectionSequence);
    };
    let clock_continues = next.decision_cut.clock_identity == previous.decision_cut.clock_identity
        && next.decision_cut.clock_epoch == previous.decision_cut.clock_epoch
        && next.restart_continuity_digest == previous.restart_continuity_digest
        && next.uncertainty_bound == previous.uncertainty_bound
        && next.skew_bound == previous.skew_bound;
    let time_advances = next.event_effective.value >= previous.event_effective.value
        && next.provider_available.value >= previous.provider_available.value
        && next.retrieval.value >= previous.retrieval.value
        && next_correction.value > previous_correction.value
        && next.decision_cut.value > previous.decision_cut.value
        && next.observed_at > previous.observed_at
        && next.monotonic_sequence > previous.monotonic_sequence
        && next.decision_cut.value < next.valid_through;

    if source_advances && correction_advances && clock_continues && time_advances {
        Ok(())
    } else {
        Err(PitSnapshotError::InvalidCorrectionSequence)
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

fn correction_frontier_is_exact_successor(
    previous: &UntrustedCompleteFrontier,
    next: &UntrustedCompleteFrontier,
) -> bool {
    next.stream_identity == previous.stream_identity
        && previous.sequence.checked_add(1) == Some(next.sequence)
        && next.cut_identity != previous.cut_identity
        && next.digest != previous.digest
}

pub(crate) fn validate_source_binding_successor(
    predecessor: &PitSnapshotFact,
    source_fact: &crate::owner::source_binding::authority::SourceBindingFact,
) -> Result<(), PitSnapshotError> {
    let expected_version = predecessor
        .source_binding_lineage_version
        .checked_add(1)
        .ok_or(PitSnapshotError::CorrectionHeadMismatch)?;
    let exact_successor = source_fact.lineage_root() == predecessor.source_binding_lineage_root
        && source_fact.lineage_version() == expected_version
        && source_fact.predecessor_binding_id() == Some(predecessor.source_binding_identity);

    if exact_successor {
        Ok(())
    } else {
        Err(PitSnapshotError::CorrectionHeadMismatch)
    }
}

fn derive_blockers(
    time: &UntrustedPitSnapshotTimeEvidence,
    source_fact: &crate::owner::source_binding::authority::SourceBindingFact,
    basis: &OwnerResolvedCanonicalBasis,
) -> BTreeSet<PitSnapshotBlocker> {
    let mut blockers = BTreeSet::new();

    match source_fact.disposition() {
        SourceBindingDisposition::Admitted => {}
        SourceBindingDisposition::Revoked | SourceBindingDisposition::Unlicensed => {
            blockers.insert(PitSnapshotBlocker::RightsUnlicensed);
        }
        SourceBindingDisposition::Incompatible => {
            blockers.insert(PitSnapshotBlocker::IdentitySemanticsOrTimeAmbiguous);
        }
        SourceBindingDisposition::Unavailable => {
            blockers.insert(PitSnapshotBlocker::SourceUnavailable);
        }
    }

    if time_is_ambiguous(time)
        || source_fact.time_evidence().clock_identity != time.decision_cut.clock_identity
        || source_fact.time_evidence().clock_epoch != time.decision_cut.clock_epoch
        || !basis.evidence.semantics_compatible
    {
        blockers.insert(PitSnapshotBlocker::IdentitySemanticsOrTimeAmbiguous);
    }

    if time.decision_cut.value >= time.valid_through {
        blockers.insert(PitSnapshotBlocker::EvidenceStale);
    }

    if !basis.evidence.coverage_complete {
        blockers.insert(PitSnapshotBlocker::CoverageInsufficient);
    }

    if !basis.evidence.source_available {
        blockers.insert(PitSnapshotBlocker::SourceUnavailable);
    }
    blockers
}

fn time_is_ambiguous(time: &UntrustedPitSnapshotTimeEvidence) -> bool {
    let Some(correction) = &time.correction_publication else {
        return true;
    };
    let clock_identity = &time.decision_cut.clock_identity;
    let clock_epoch = &time.decision_cut.clock_epoch;
    let coordinates = [
        (
            time.event_effective.value,
            &time.event_effective.clock_identity,
            &time.event_effective.clock_epoch,
        ),
        (
            time.provider_available.value,
            &time.provider_available.clock_identity,
            &time.provider_available.clock_epoch,
        ),
        (
            time.retrieval.value,
            &time.retrieval.clock_identity,
            &time.retrieval.clock_epoch,
        ),
        (
            correction.value,
            &correction.clock_identity,
            &correction.clock_epoch,
        ),
    ];
    let mixed_or_missing = clock_identity.trim().is_empty()
        || clock_epoch.trim().is_empty()
        || coordinates.iter().any(|(value, identity, epoch)| {
            *value == 0 || *identity != clock_identity || *epoch != clock_epoch
        });
    let ordered = time.event_effective.value <= time.provider_available.value
        && time.provider_available.value <= time.retrieval.value
        && correction.value <= time.retrieval.value
        && time.provider_available.value <= time.decision_cut.value
        && time.retrieval.value <= time.decision_cut.value
        && correction.value <= time.decision_cut.value;
    mixed_or_missing
        || !ordered
        || time.decision_cut.value == 0
        || time.observed_at != time.decision_cut.value
        || time.valid_through == 0
}

fn primary_blocker(blockers: &BTreeSet<PitSnapshotBlocker>) -> Option<PitSnapshotBlocker> {
    blockers
        .iter()
        .copied()
        .min_by_key(|blocker| blocker_precedence(*blocker))
}

const fn blocker_precedence(blocker: PitSnapshotBlocker) -> u8 {
    match blocker {
        PitSnapshotBlocker::RightsUnlicensed => 0,
        PitSnapshotBlocker::IdentitySemanticsOrTimeAmbiguous => 1,
        PitSnapshotBlocker::EvidenceStale => 2,
        PitSnapshotBlocker::CoverageInsufficient => 3,
        PitSnapshotBlocker::SourceUnavailable => 4,
    }
}

const fn disposition(primary: Option<PitSnapshotBlocker>) -> PitSnapshotDisposition {
    match primary {
        None => PitSnapshotDisposition::Available,
        Some(PitSnapshotBlocker::RightsUnlicensed) => PitSnapshotDisposition::Unlicensed,
        Some(PitSnapshotBlocker::IdentitySemanticsOrTimeAmbiguous) => {
            PitSnapshotDisposition::Ambiguous
        }
        Some(PitSnapshotBlocker::EvidenceStale) => PitSnapshotDisposition::Stale,
        Some(PitSnapshotBlocker::CoverageInsufficient) => PitSnapshotDisposition::Insufficient,
        Some(PitSnapshotBlocker::SourceUnavailable) => PitSnapshotDisposition::Unavailable,
    }
}

pub(crate) fn derive_request_digest(request: &UntrustedPitSnapshotRequest) -> BindingDigest {
    let mut encoder = Encoder::new(REQUEST_DIGEST_DOMAIN);
    encode_source_locator(&mut encoder, &request.source_binding);
    encoder.digest(request.scope_digest);
    encoder.digest(request.requester_identity);
    encoder.digest(request.instrument_master_digest);
    encoder.digest(request.universe_selection_digest);
    encoder.digest(request.market_semantics_identity);
    encode_time(&mut encoder, &request.time_evidence);
    digest(&encoder.finish())
}

pub(crate) fn derive_request_identity(request: &UntrustedPitSnapshotRequest) -> BindingDigest {
    let mut encoder = Encoder::new(REQUEST_IDENTITY_DOMAIN);
    encoder.digest(derive_request_digest(request));
    encoder.digest(request.correlation_identity);
    digest(&encoder.finish())
}

pub(crate) fn refresh_request_claims(request: &mut UntrustedPitSnapshotRequest) {
    request.claimed_request_digest = derive_request_digest(request);
    request.claimed_request_identity = derive_request_identity(request);
}

fn derive_snapshot_identity(
    proposal: &UntrustedPitSnapshotProposal,
    source_binding_identity: BindingDigest,
    blockers: &BTreeSet<PitSnapshotBlocker>,
) -> BindingDigest {
    let mut encoder = Encoder::new(SNAPSHOT_IDENTITY_DOMAIN);
    encoder.digest(proposal.request.claimed_request_identity);
    encoder.digest(source_binding_identity);
    encode_evidence(&mut encoder, &proposal.evidence);
    encode_blockers(&mut encoder, blockers);
    digest(&encoder.finish())
}

fn canonical_fact_bytes(
    proposal: &UntrustedPitSnapshotProposal,
    clock_admission: &MarketDataClockAdmission,
    source_binding: &ResolvedSourceBinding,
    snapshot_identity: BindingDigest,
    blockers: &BTreeSet<PitSnapshotBlocker>,
    lineage: &OwnerLineage,
) -> Vec<u8> {
    let mut encoder = Encoder::new(FACT_DOMAIN);
    encoder.digest(snapshot_identity);
    encoder.digest(proposal.request.claimed_request_identity);
    encoder.digest(proposal.request.claimed_request_digest);
    encoder.digest(proposal.request.correlation_identity);
    encoder.digest(proposal.request.requester_identity);
    encoder.digest(proposal.request.scope_digest);
    encoder.digest(source_binding.identity);
    encoder.digest(source_binding.lineage_root);
    encoder.u64(source_binding.lineage_version);
    encoder.digest(lineage.root);
    encoder.u64(lineage.version);
    encoder.optional_digest(lineage.predecessor_snapshot_identity);
    encoder.optional_digest(lineage.predecessor_fact_digest);
    encode_evidence(&mut encoder, &proposal.evidence);
    encode_time(&mut encoder, &proposal.request.time_evidence);
    encode_clock_admission(&mut encoder, clock_admission);
    encode_blockers(&mut encoder, blockers);
    encoder.finish()
}

fn canonical_outbox_bytes(fact: &PitSnapshotFact) -> Vec<u8> {
    let mut encoder = Encoder::new(OUTBOX_DOMAIN);
    encoder.string(OWNER_ID);
    encoder.digest(fact.request.claimed_request_identity);
    encoder.digest(fact.request.claimed_request_digest);
    encoder.digest(fact.request.correlation_identity);
    encoder.digest(fact.request.requester_identity);
    encoder.digest(fact.request.scope_digest);
    encoder.digest(fact.source_binding_identity);
    encoder.digest(fact.source_binding_lineage_root);
    encoder.u64(fact.source_binding_lineage_version);
    encoder.digest(fact.snapshot_identity);
    encoder.digest(fact.digest);
    encoder.digest(fact.lineage_root);
    encoder.u64(fact.lineage_version);
    encoder.optional_digest(fact.predecessor_snapshot_identity);
    encoder.optional_digest(fact.predecessor_fact_digest);
    encoder.u8(disposition_code(fact.disposition));
    encoder.optional_u8(fact.primary_blocker.map(blocker_precedence));
    encode_blockers(&mut encoder, &fact.blockers);
    encoder.frontier(&fact.evidence.source_frontier);
    encoder.frontier(&fact.evidence.correction_frontier);
    encode_time(&mut encoder, &fact.request.time_evidence);
    encode_clock_admission(&mut encoder, &fact.clock_admission);
    encoder.finish()
}

fn locator_for(fact: &PitSnapshotFact) -> UntrustedPitSnapshotLocator {
    UntrustedPitSnapshotLocator::from_untrusted(UntrustedPitSnapshotLocatorFields {
        owner: OWNER_ID.to_owned(),
        request_identity: fact.request.claimed_request_identity,
        request_digest: fact.request.claimed_request_digest,
        correlation_identity: fact.request.correlation_identity,
        requester_identity: fact.request.requester_identity,
        scope_digest: fact.request.scope_digest,
        snapshot_identity: fact.snapshot_identity,
        fact_digest: fact.digest,
        source_binding_identity: fact.source_binding_identity,
        source_binding_lineage_root: fact.source_binding_lineage_root,
        source_binding_lineage_version: fact.source_binding_lineage_version,
        lineage_root: fact.lineage_root,
        lineage_version: fact.lineage_version,
        predecessor_snapshot_identity: fact.predecessor_snapshot_identity,
        predecessor_fact_digest: fact.predecessor_fact_digest,
        source_frontier: fact.evidence.source_frontier.clone(),
        correction_frontier: fact.evidence.correction_frontier.clone(),
        time_evidence: fact.request.time_evidence.clone(),
    })
}

fn encode_blockers(encoder: &mut Encoder, blockers: &BTreeSet<PitSnapshotBlocker>) {
    encoder.u64(blockers.len() as u64);

    for blocker in blockers {
        encoder.u8(blocker_precedence(*blocker));
    }
}

fn encode_evidence(encoder: &mut Encoder, evidence: &super::UntrustedPitSnapshotEvidence) {
    encoder.digest(evidence.normalized_records_digest);
    encoder.frontier(&evidence.source_frontier);
    encoder.frontier(&evidence.correction_frontier);
    encoder.u8(u8::from(evidence.coverage_complete));
    encoder.u8(u8::from(evidence.semantics_compatible));
    encoder.u8(u8::from(evidence.source_available));
}

fn encode_time(encoder: &mut Encoder, time: &UntrustedPitSnapshotTimeEvidence) {
    encode_event_time(encoder, &time.event_effective);
    encode_provider_time(encoder, &time.provider_available);
    encode_retrieval_time(encoder, &time.retrieval);

    match &time.correction_publication {
        Some(value) => {
            encoder.u8(1);
            encode_correction_time(encoder, value);
        }
        None => encoder.u8(0),
    }
    encode_decision_cut(encoder, &time.decision_cut);
    encoder.u64(time.monotonic_sequence);
    encoder.digest(time.restart_continuity_digest);
    encoder.u64(time.skew_bound);
    encoder.u64(time.uncertainty_bound);
    encoder.u64(time.observed_at);
    encoder.u64(time.valid_through);
}

fn encode_clock_admission(encoder: &mut Encoder, clock: &MarketDataClockAdmission) {
    encoder.u8(match clock.cut_kind {
        MarketDataClockCutKind::MarketDataAsOf => 1,
    });
    encoder.string(&clock.clock_identity);
    encoder.string(&clock.clock_epoch);
    encoder.u64(clock.monotonic_sequence);
    encoder.u64(clock.wall_observed);
    encoder.u64(clock.decision_cut);
    encoder.u64(clock.valid_through);
    encoder.digest(clock.restart_continuity_digest);
    encoder.u64(clock.uncertainty_bound);
    encoder.u64(clock.skew_bound);
    encoder.u8(match clock.comparison_rule {
        MarketDataClockComparisonRule::ExclusiveValidThrough => 1,
    });
}

fn encode_event_time(encoder: &mut Encoder, time: &UntrustedEventEffectiveTime) {
    encoder.u64(time.value);
    encoder.string(&time.clock_identity);
    encoder.string(&time.clock_epoch);
}

fn encode_provider_time(encoder: &mut Encoder, time: &UntrustedProviderAvailableTime) {
    encoder.u64(time.value);
    encoder.string(&time.clock_identity);
    encoder.string(&time.clock_epoch);
}

fn encode_retrieval_time(encoder: &mut Encoder, time: &UntrustedRetrievalTime) {
    encoder.u64(time.value);
    encoder.string(&time.clock_identity);
    encoder.string(&time.clock_epoch);
}

fn encode_correction_time(encoder: &mut Encoder, time: &UntrustedCorrectionPublicationTime) {
    encoder.u64(time.value);
    encoder.string(&time.clock_identity);
    encoder.string(&time.clock_epoch);
}

fn encode_decision_cut(encoder: &mut Encoder, time: &UntrustedSnapshotDecisionCut) {
    encoder.u64(time.value);
    encoder.string(&time.clock_identity);
    encoder.string(&time.clock_epoch);
}

fn encode_source_locator(encoder: &mut Encoder, locator: &UntrustedSourceBindingLocator) {
    encoder.string(&locator.owner);
    encoder.digest(locator.lineage_root);
    encoder.u64(locator.lineage_version);
    encoder.optional_digest(locator.predecessor_binding_id);
    encoder.optional_digest(locator.predecessor_fact_digest);
    encoder.digest(locator.binding_id);
    encoder.digest(locator.fact_digest);
    encoder.digest(locator.credential_handle_identity);
    encoder.u8(credential_audience_code(locator.credential_audience));
    encoder.u64(locator.credential_capabilities.len() as u64);

    for capability in &locator.credential_capabilities {
        encoder.u8(credential_capability_code(*capability));
    }
    encoder.frontier(&locator.source_frontier);
    encoder.frontier(&locator.correction_frontier);
    encode_source_time(encoder, &locator.time_evidence);
}

fn encode_source_time(encoder: &mut Encoder, time: &UntrustedMarketDataAsOf) {
    encoder.digest(time.claimed_evidence_identity);
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

const fn disposition_code(disposition: PitSnapshotDisposition) -> u8 {
    match disposition {
        PitSnapshotDisposition::Available => 0,
        PitSnapshotDisposition::Unlicensed => 1,
        PitSnapshotDisposition::Ambiguous => 2,
        PitSnapshotDisposition::Stale => 3,
        PitSnapshotDisposition::Insufficient => 4,
        PitSnapshotDisposition::Unavailable => 5,
    }
}

const OBSERVATION_BATCH_DOMAIN: &[u8] = b"VIBE_PIT_OBSERVATION_BATCH_V1";
const OBSERVATION_ROW_DOMAIN: &[u8] = b"VIBE_PIT_OBSERVATION_ROW_V1";
const OBSERVATION_CHANNELS: &[&str] = &["MARKET", "REFERENCE", "ECONOMIC"];
const OBSERVATION_DATA_KINDS: &[&str] = &["BAR", "QUOTE", "TRADE", "SCALAR"];
const MAX_OBSERVATIONS: usize = 10_000;
const MAX_CANONICAL_COMPONENT: usize = 128;
const MAX_CANONICAL_BYTES: usize = 64 * 1024 * 1024;

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct PreparedPitObservationBatch {
    digest: BindingDigest,
    bytes: Vec<u8>,
    row_bytes: Vec<Vec<u8>>,
    rows: Vec<VerifiedPitObservation>,
}

impl PreparedPitObservationBatch {
    pub(crate) const fn digest(&self) -> BindingDigest {
        self.digest
    }

    pub(crate) fn bytes(&self) -> &[u8] {
        &self.bytes
    }

    pub(crate) fn row_bytes(&self) -> &[Vec<u8>] {
        &self.row_bytes
    }

    pub(crate) fn rows(&self) -> &[VerifiedPitObservation] {
        &self.rows
    }

    pub(crate) fn native_rows(
        &self,
    ) -> Result<Vec<ObservedPitObservationNativeRow>, PitSnapshotError> {
        self.rows
            .iter()
            .zip(&self.row_bytes)
            .enumerate()
            .map(|(offset, (row, row_bytes))| {
                Ok(ObservedPitObservationNativeRow {
                    ordinal: u64::try_from(offset)
                        .ok()
                        .and_then(|value| value.checked_add(1))
                        .ok_or(PitSnapshotError::InvalidObservationBatch)?,
                    symbolic_key: row.symbolic_key.clone(),
                    member_key: row.member_key.clone(),
                    row_bytes: row_bytes.clone(),
                })
            })
            .collect()
    }
}

pub(crate) fn prepare_observation_batch(
    snapshot: &UntrustedPitSnapshotProposal,
    proposal: &UntrustedPitObservationBatchProposal,
) -> Result<PreparedPitObservationBatch, PitSnapshotError> {
    let prepared = prepare_canonical_observation_rows(proposal)?;
    for row in &prepared.rows {
        validate_observation_against_claims(
            row,
            &snapshot.request,
            &snapshot.evidence,
            snapshot.request.source_binding.binding_id,
        )?;
    }

    if prepared.digest != snapshot.evidence.normalized_records_digest {
        return Err(PitSnapshotError::ReplayConflict);
    }
    Ok(prepared)
}

pub(crate) fn derive_observation_batch_digest(
    proposal: &UntrustedPitObservationBatchProposal,
) -> Result<BindingDigest, PitSnapshotError> {
    prepare_canonical_observation_rows(proposal).map(|prepared| prepared.digest)
}

fn prepare_canonical_observation_rows(
    proposal: &UntrustedPitObservationBatchProposal,
) -> Result<PreparedPitObservationBatch, PitSnapshotError> {
    let rows = proposal
        .rows
        .iter()
        .map(|row| VerifiedPitObservation {
            symbolic_key: row.symbolic_key.clone(),
            member_key: row.member_key.clone(),
            instrument: row.instrument.clone(),
            channel: row.channel.clone(),
            data_kind: row.data_kind.clone(),
            timeframe: row.timeframe.clone(),
            field: row.field.clone(),
            value_mantissa: row.value_mantissa,
            value_scale: row.value_scale,
            event_effective: row.event_effective,
            provider_available: row.provider_available,
            retrieval: row.retrieval,
            correction_publication: row.correction_publication,
            source_binding_identity: row.source_binding_identity,
            source_frontier_digest: row.source_frontier_digest,
            instrument_master_digest: row.instrument_master_digest,
            universe_selection_digest: row.universe_selection_digest,
            market_semantics_identity: row.market_semantics_identity,
            correction_stream_identity: row.correction_stream_identity.clone(),
            correction_sequence: row.correction_sequence,
            correction_frontier_digest: row.correction_frontier_digest,
        })
        .collect::<Vec<_>>();
    let row_bytes = rows
        .iter()
        .map(canonical_observation_bytes)
        .collect::<Vec<_>>();
    let bytes = canonical_batch_bytes(&rows);
    let decoded = decode_canonical_observation_batch(&bytes, &row_bytes)?;
    if decoded != rows {
        return Err(PitSnapshotError::InvalidObservationBatch);
    }
    let digest = digest(&bytes);
    Ok(PreparedPitObservationBatch {
        digest,
        bytes,
        row_bytes,
        rows,
    })
}

pub(crate) fn verify_observation_batch(
    aggregate: &PitSnapshotCommitAggregate,
    observed_source_binding_identity: BindingDigest,
    observed_source_binding_lineage_root: BindingDigest,
    observed_source_binding_lineage_version: u64,
    observed_digest: BindingDigest,
    batch_bytes: &[u8],
    stored_rows: &[ObservedPitObservationNativeRow],
) -> Result<VerifiedPitObservationBatch, PitSnapshotError> {
    if !verify_aggregate(aggregate)
        || aggregate.fact().disposition() != PitSnapshotDisposition::Available
        || batch_bytes.is_empty()
        || batch_bytes.len() > MAX_CANONICAL_BYTES
        || stored_rows.is_empty()
        || stored_rows.len() > MAX_OBSERVATIONS
        || observed_source_binding_identity != aggregate.fact().source_binding_identity()
        || observed_source_binding_lineage_root != aggregate.fact().source_binding_lineage_root()
        || observed_source_binding_lineage_version
            != aggregate.fact().source_binding_lineage_version()
    {
        return Err(PitSnapshotError::ObservationBatchUnavailable);
    }
    let canonical_digest = digest(batch_bytes);
    if canonical_digest != observed_digest
        || canonical_digest != aggregate.fact().evidence().normalized_records_digest
    {
        return Err(PitSnapshotError::ObservationBatchUnavailable);
    }

    let row_bytes = stored_rows
        .iter()
        .map(|row| row.row_bytes.clone())
        .collect::<Vec<_>>();
    let observations = decode_canonical_observation_batch(batch_bytes, &row_bytes)?;
    for (offset, (native, observation)) in stored_rows.iter().zip(&observations).enumerate() {
        let expected_ordinal = u64::try_from(offset)
            .ok()
            .and_then(|value| value.checked_add(1))
            .ok_or(PitSnapshotError::ObservationBatchUnavailable)?;

        if native.ordinal != expected_ordinal
            || native.symbolic_key != observation.symbolic_key
            || native.member_key != observation.member_key
        {
            return Err(PitSnapshotError::ObservationBatchUnavailable);
        }
    }

    for observation in &observations {
        validate_observation_against_fact(observation, aggregate.fact())?;
    }
    let fact = aggregate.fact();
    Ok(VerifiedPitObservationBatch {
        request_identity: fact.request_identity(),
        request_digest: fact.request_digest(),
        snapshot_identity: fact.snapshot_identity(),
        fact_digest: fact.digest(),
        source_binding_identity: fact.source_binding_identity(),
        source_binding_lineage_root: fact.source_binding_lineage_root(),
        source_binding_lineage_version: fact.source_binding_lineage_version(),
        source_frontier_digest: fact.evidence().source_frontier.digest,
        correction_frontier_digest: fact.evidence().correction_frontier.digest,
        instrument_master_digest: fact.request().instrument_master_digest,
        universe_selection_digest: fact.request().universe_selection_digest,
        market_semantics_identity: fact.request().market_semantics_identity,
        time_evidence: fact.request().time_evidence.clone(),
        digest: canonical_digest,
        observations: observations.into_boxed_slice(),
    })
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ObservedPitObservationNativeRow {
    pub(crate) ordinal: u64,
    pub(crate) symbolic_key: String,
    pub(crate) member_key: String,
    pub(crate) row_bytes: Vec<u8>,
}

pub(crate) fn decode_canonical_observation_batch(
    batch_bytes: &[u8],
    stored_rows: &[Vec<u8>],
) -> Result<Vec<VerifiedPitObservation>, PitSnapshotError> {
    let mut decoder = Decoder::new(batch_bytes);
    decoder.expect_bytes(OBSERVATION_BATCH_DOMAIN)?;
    let count = decoder.usize()?;
    if count == 0 || count > MAX_OBSERVATIONS || count != stored_rows.len() {
        return Err(PitSnapshotError::InvalidObservationBatch);
    }
    let mut observations = Vec::with_capacity(count);
    let mut prior_key: Option<(String, String)> = None;

    for stored_row in stored_rows {
        let embedded = decoder.bytes()?;
        if embedded != stored_row.as_slice() {
            return Err(PitSnapshotError::InvalidObservationBatch);
        }
        let observation = decode_observation(stored_row)?;
        let key = (
            observation.symbolic_key.clone(),
            observation.member_key.clone(),
        );

        if prior_key.as_ref().is_some_and(|prior| prior >= &key) {
            return Err(PitSnapshotError::InvalidObservationBatch);
        }
        prior_key = Some(key);
        observations.push(observation);
    }
    decoder.finish()?;

    if canonical_batch_bytes(&observations) != batch_bytes {
        return Err(PitSnapshotError::InvalidObservationBatch);
    }
    Ok(observations)
}

fn validate_observation_against_fact(
    row: &VerifiedPitObservation,
    fact: &PitSnapshotFact,
) -> Result<(), PitSnapshotError> {
    validate_observation_against_claims(
        row,
        fact.request(),
        fact.evidence(),
        fact.source_binding_identity(),
    )
}

fn validate_observation_against_claims(
    row: &VerifiedPitObservation,
    request: &UntrustedPitSnapshotRequest,
    evidence: &super::UntrustedPitSnapshotEvidence,
    source_binding_identity: BindingDigest,
) -> Result<(), PitSnapshotError> {
    let time = &request.time_evidence;
    let correction_publication = time
        .correction_publication
        .as_ref()
        .ok_or(PitSnapshotError::InvalidObservationBatch)?;
    let common_clock = time.event_effective.clock_identity == time.decision_cut.clock_identity
        && time.event_effective.clock_epoch == time.decision_cut.clock_epoch
        && time.provider_available.clock_identity == time.decision_cut.clock_identity
        && time.provider_available.clock_epoch == time.decision_cut.clock_epoch
        && time.retrieval.clock_identity == time.decision_cut.clock_identity
        && time.retrieval.clock_epoch == time.decision_cut.clock_epoch
        && correction_publication.clock_identity == time.decision_cut.clock_identity
        && correction_publication.clock_epoch == time.decision_cut.clock_epoch;
    let ordered_times = row.event_effective <= row.provider_available
        && row.provider_available <= row.correction_publication
        && row.correction_publication <= row.retrieval
        && row.retrieval <= time.decision_cut.value
        && time.decision_cut.value < time.valid_through;
    let exact = row.source_binding_identity == source_binding_identity
        && row.source_frontier_digest == evidence.source_frontier.digest
        && row.instrument_master_digest == request.instrument_master_digest
        && row.universe_selection_digest == request.universe_selection_digest
        && row.market_semantics_identity == request.market_semantics_identity
        && row.correction_stream_identity == evidence.correction_frontier.stream_identity
        && row.correction_sequence == evidence.correction_frontier.sequence
        && row.correction_frontier_digest == evidence.correction_frontier.digest
        && row.event_effective == time.event_effective.value
        && row.provider_available == time.provider_available.value
        && row.retrieval == time.retrieval.value
        && row.correction_publication == correction_publication.value;

    if common_clock && ordered_times && exact {
        Ok(())
    } else {
        Err(PitSnapshotError::InvalidObservationBatch)
    }
}

fn decode_observation(bytes: &[u8]) -> Result<VerifiedPitObservation, PitSnapshotError> {
    let mut decoder = Decoder::new(bytes);
    decoder.expect_bytes(OBSERVATION_ROW_DOMAIN)?;
    let row = VerifiedPitObservation {
        symbolic_key: decoder.canonical_key()?,
        member_key: decoder.canonical_key()?,
        instrument: decoder.canonical_instrument()?,
        channel: decoder.known(OBSERVATION_CHANNELS)?,
        data_kind: decoder.known(OBSERVATION_DATA_KINDS)?,
        timeframe: decoder.canonical_timeframe()?,
        field: decoder.known(&[
            "OPEN",
            "HIGH",
            "LOW",
            "CLOSE",
            "VOLUME",
            "BID_PRICE",
            "ASK_PRICE",
            "BID_SIZE",
            "ASK_SIZE",
            "LAST_PRICE",
            "LAST_SIZE",
            "VALUE",
        ])?,
        value_mantissa: decoder.i128()?,
        value_scale: decoder.u8()?,
        event_effective: decoder.u64()?,
        provider_available: decoder.u64()?,
        retrieval: decoder.u64()?,
        correction_publication: decoder.u64()?,
        source_binding_identity: decoder.digest()?,
        source_frontier_digest: decoder.digest()?,
        instrument_master_digest: decoder.digest()?,
        universe_selection_digest: decoder.digest()?,
        market_semantics_identity: decoder.digest()?,
        correction_stream_identity: decoder.canonical_key()?,
        correction_sequence: decoder.u64()?,
        correction_frontier_digest: decoder.digest()?,
    };
    decoder.finish()?;

    if row.value_scale > 18
        || (row.value_scale > 0 && row.value_mantissa % 10 == 0)
        || row.event_effective == 0
        || row.provider_available == 0
        || row.retrieval == 0
        || row.correction_publication == 0
        || row.event_effective > row.provider_available
        || row.provider_available > row.correction_publication
        || row.correction_publication > row.retrieval
        || row.correction_sequence == 0
        || canonical_observation_bytes(&row) != bytes
    {
        return Err(PitSnapshotError::InvalidObservationBatch);
    }
    Ok(row)
}

pub(crate) fn canonical_batch_bytes(rows: &[VerifiedPitObservation]) -> Vec<u8> {
    let mut encoder = Encoder::new(OBSERVATION_BATCH_DOMAIN);
    encoder.u64(rows.len() as u64);
    for row in rows {
        encoder.bytes(&canonical_observation_bytes(row));
    }
    encoder.finish()
}

pub(crate) fn canonical_observation_bytes(row: &VerifiedPitObservation) -> Vec<u8> {
    let mut encoder = Encoder::new(OBSERVATION_ROW_DOMAIN);
    encoder.string(&row.symbolic_key);
    encoder.string(&row.member_key);
    encoder.string(&row.instrument);
    encoder.string(&row.channel);
    encoder.string(&row.data_kind);
    encoder.string(&row.timeframe);
    encoder.string(&row.field);
    encoder.i128(row.value_mantissa);
    encoder.u8(row.value_scale);
    encoder.u64(row.event_effective);
    encoder.u64(row.provider_available);
    encoder.u64(row.retrieval);
    encoder.u64(row.correction_publication);
    encoder.digest(row.source_binding_identity);
    encoder.digest(row.source_frontier_digest);
    encoder.digest(row.instrument_master_digest);
    encoder.digest(row.universe_selection_digest);
    encoder.digest(row.market_semantics_identity);
    encoder.string(&row.correction_stream_identity);
    encoder.u64(row.correction_sequence);
    encoder.digest(row.correction_frontier_digest);
    encoder.finish()
}

struct Decoder<'a> {
    remaining: &'a [u8],
}

impl<'a> Decoder<'a> {
    const fn new(bytes: &'a [u8]) -> Self {
        Self { remaining: bytes }
    }

    fn take(&mut self, len: usize) -> Result<&'a [u8], PitSnapshotError> {
        if len > self.remaining.len() {
            return Err(PitSnapshotError::InvalidObservationBatch);
        }
        let (value, remaining) = self.remaining.split_at(len);
        self.remaining = remaining;
        Ok(value)
    }

    fn u8(&mut self) -> Result<u8, PitSnapshotError> {
        Ok(*self
            .take(1)?
            .first()
            .ok_or(PitSnapshotError::InvalidObservationBatch)?)
    }

    fn u64(&mut self) -> Result<u64, PitSnapshotError> {
        let bytes: [u8; 8] = self
            .take(8)?
            .try_into()
            .map_err(|_| PitSnapshotError::InvalidObservationBatch)?;
        Ok(u64::from_be_bytes(bytes))
    }

    fn usize(&mut self) -> Result<usize, PitSnapshotError> {
        usize::try_from(self.u64()?).map_err(|_| PitSnapshotError::InvalidObservationBatch)
    }

    fn i128(&mut self) -> Result<i128, PitSnapshotError> {
        let bytes: [u8; 16] = self
            .take(16)?
            .try_into()
            .map_err(|_| PitSnapshotError::InvalidObservationBatch)?;
        Ok(i128::from_be_bytes(bytes))
    }

    fn bytes(&mut self) -> Result<&'a [u8], PitSnapshotError> {
        let len = self.usize()?;
        if len > MAX_CANONICAL_BYTES {
            return Err(PitSnapshotError::InvalidObservationBatch);
        }
        self.take(len)
    }

    fn expect_bytes(&mut self, expected: &[u8]) -> Result<(), PitSnapshotError> {
        if self.bytes()? == expected {
            Ok(())
        } else {
            Err(PitSnapshotError::InvalidObservationBatch)
        }
    }

    fn string(&mut self) -> Result<String, PitSnapshotError> {
        let bytes = self.bytes()?;
        if bytes.is_empty() || bytes.len() > MAX_CANONICAL_COMPONENT {
            return Err(PitSnapshotError::InvalidObservationBatch);
        }
        std::str::from_utf8(bytes)
            .map(str::to_owned)
            .map_err(|_| PitSnapshotError::InvalidObservationBatch)
    }

    fn canonical_key(&mut self) -> Result<String, PitSnapshotError> {
        let value = self.string()?;
        if value.bytes().all(|byte| {
            byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b':' | b'-' | b'/')
        }) {
            Ok(value)
        } else {
            Err(PitSnapshotError::InvalidObservationBatch)
        }
    }

    fn canonical_instrument(&mut self) -> Result<String, PitSnapshotError> {
        let value = self.canonical_key()?;
        if value.bytes().any(|byte| byte.is_ascii_lowercase()) {
            Err(PitSnapshotError::InvalidObservationBatch)
        } else {
            Ok(value)
        }
    }

    fn known(&mut self, known: &[&str]) -> Result<String, PitSnapshotError> {
        let value = self.string()?;
        if known.contains(&value.as_str()) {
            Ok(value)
        } else {
            Err(PitSnapshotError::InvalidObservationBatch)
        }
    }

    fn canonical_timeframe(&mut self) -> Result<String, PitSnapshotError> {
        let value = self.string()?;
        if value == "TICK" {
            return Ok(value);
        }
        let digit_count = value.bytes().take_while(u8::is_ascii_digit).count();
        let (count, unit) = value.split_at(digit_count);
        let valid_count = !count.is_empty()
            && !count.starts_with('0')
            && count.parse::<u64>().is_ok_and(|count| count > 0);
        if valid_count && matches!(unit, "NS" | "US" | "MS" | "S" | "M" | "H" | "D") {
            Ok(value)
        } else {
            Err(PitSnapshotError::InvalidObservationBatch)
        }
    }

    fn digest(&mut self) -> Result<BindingDigest, PitSnapshotError> {
        let bytes: [u8; 32] = self
            .bytes()?
            .try_into()
            .map_err(|_| PitSnapshotError::InvalidObservationBatch)?;
        if bytes == [0; 32] {
            Err(PitSnapshotError::InvalidObservationBatch)
        } else {
            Ok(BindingDigest::from_untrusted_bytes(bytes))
        }
    }

    fn finish(self) -> Result<(), PitSnapshotError> {
        if self.remaining.is_empty() {
            Ok(())
        } else {
            Err(PitSnapshotError::InvalidObservationBatch)
        }
    }
}

fn digest(bytes: &[u8]) -> BindingDigest {
    BindingDigest::from_untrusted_bytes(*blake3::hash(bytes).as_bytes())
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

    fn u64(&mut self, value: u64) {
        self.0.extend_from_slice(&value.to_be_bytes());
    }

    fn i128(&mut self, value: i128) {
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
