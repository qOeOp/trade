use std::{
    collections::{BTreeMap, BTreeSet},
    error::Error,
    fmt::Display,
};

use crate::{
    Digest,
    authority::{OwnerAdmission, UnavailableOwnerAdmission},
    model::{
        AllowedIntentClass, ApplicationStatus, AuthorizationMode, AuthorizedGenerationDecision,
        CandidateId, DecisionFrontierId, EligibilityState, ExecutionMode, GenerationId,
        GovernanceDecisionView, LifecycleAction, LifecycleRequest, LifecycleRequestId,
        LifecycleRequestReceipt, RejectionReason, SemanticIdentity, TimeEvidence,
        UntrustedDecisionEvidence, UntrustedRuntimeApplicationReadback, VerifiedAdapterBinding,
        VerifiedArtifact, VerifiedAuthorizationLineage, VerifiedAutonomousPolicy,
        VerifiedCapacityView, VerifiedDecisionCuts, VerifiedEligibility,
        VerifiedRuntimeApplicationReceipt, ViewAvailability, ViewFreshness,
    },
};

pub(crate) trait GovernanceClock: Send + Sync {
    fn now(&self) -> Option<TimeEvidence>;
}

#[derive(Debug, Default)]
struct UnavailableGovernanceClock;

impl GovernanceClock for UnavailableGovernanceClock {
    fn now(&self) -> Option<TimeEvidence> {
        None
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum StoreError {
    EmptyFrontier,
    MixedFrontier,
    MixedGeneration,
    DuplicateRequestConflict(LifecycleRequestId),
    SemanticMutation(LifecycleRequestId),
    AliasRetry {
        original: LifecycleRequestId,
        attempted: LifecycleRequestId,
    },
    ReplaySetMismatch(DecisionFrontierId),
    OpenFrontierContainsTerminalRequest(LifecycleRequestId),
    ValidationStateConflict(LifecycleRequestId),
    TimeEvidenceUnavailable,
}

impl Display for StoreError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{self:?}")
    }
}

impl Error for StoreError {}

#[derive(Clone, Debug)]
struct ClosedFrontier {
    exact_set: Vec<(LifecycleRequestId, Digest)>,
    decision_evidence: Vec<(LifecycleRequestId, UntrustedDecisionEvidence)>,
}

#[derive(Clone, Debug)]
struct RejectedAttempt {
    exact_set: Vec<(LifecycleRequestId, Digest)>,
}

/// Static Governance core. Public construction deliberately installs an
/// unavailable sealed source-Owner admission seam; callers cannot inject a
/// verifier or trust their own readbacks.
pub struct GovernanceCore {
    admission: Box<dyn OwnerAdmission>,
    clock: Box<dyn GovernanceClock>,
    receipts: BTreeMap<LifecycleRequestId, LifecycleRequestReceipt>,
    accepted_aliases: BTreeMap<Digest, LifecycleRequestId>,
    accepted_candidate_actions: BTreeMap<(CandidateId, LifecycleAction), LifecycleRequestId>,
    accepted_generation_actions: BTreeMap<(GenerationId, LifecycleAction), LifecycleRequestId>,
    closed_frontiers: BTreeMap<DecisionFrontierId, ClosedFrontier>,
    rejected_attempts: BTreeMap<DecisionFrontierId, Vec<RejectedAttempt>>,
}

impl Default for GovernanceCore {
    fn default() -> Self {
        Self::new()
    }
}

impl GovernanceCore {
    #[must_use]
    pub fn new() -> Self {
        Self::with_dependencies(
            Box::<UnavailableOwnerAdmission>::default(),
            Box::<UnavailableGovernanceClock>::default(),
        )
    }

    pub(crate) fn with_dependencies(
        admission: Box<dyn OwnerAdmission>,
        clock: Box<dyn GovernanceClock>,
    ) -> Self {
        Self {
            admission,
            clock,
            receipts: BTreeMap::new(),
            accepted_aliases: BTreeMap::new(),
            accepted_candidate_actions: BTreeMap::new(),
            accepted_generation_actions: BTreeMap::new(),
            closed_frontiers: BTreeMap::new(),
            rejected_attempts: BTreeMap::new(),
        }
    }

    /// Resolves one complete lifecycle conflict frontier.
    ///
    /// Every contender is validated before priority selection. Invalid
    /// contenders receive write-once `REJECTED_NO_WRITE` receipts, but do not
    /// close the frontier or consume accepted-request aliases.
    ///
    /// # Errors
    ///
    /// Returns a store error for malformed sets, semantic mutation, accepted
    /// alias retry, or a replay whose exact set differs from the closed set.
    #[allow(clippy::too_many_lines)]
    pub fn resolve_frontier(
        &mut self,
        submissions: &[(LifecycleRequest, UntrustedDecisionEvidence)],
    ) -> Result<Vec<LifecycleRequestReceipt>, StoreError> {
        if submissions.is_empty() {
            return Err(StoreError::EmptyFrontier);
        }
        let frontier = submissions[0].0.decision_frontier_id.clone();
        let generation = submissions[0].0.generation_id.clone();

        if submissions
            .iter()
            .any(|(request, _)| request.decision_frontier_id != frontier)
        {
            return Err(StoreError::MixedFrontier);
        }

        if submissions
            .iter()
            .any(|(request, _)| request.generation_id != generation)
        {
            return Err(StoreError::MixedGeneration);
        }

        let identities = submissions
            .iter()
            .map(|(request, _)| request.semantic_identity())
            .collect::<Vec<_>>();
        let exact_set = canonical_set(submissions, &identities)?;
        let decision_evidence = canonical_decision_evidence(submissions);

        for ((request, _), identity) in submissions.iter().zip(&identities) {
            if self
                .receipts
                .get(&request.request_id)
                .is_some_and(|receipt| receipt.semantic_digest() != identity.semantic_digest)
            {
                return Err(StoreError::SemanticMutation(request.request_id.clone()));
            }
        }

        if let Some(closed) = self.closed_frontiers.get(&frontier) {
            if closed.exact_set != exact_set || closed.decision_evidence != decision_evidence {
                return Err(StoreError::ReplaySetMismatch(frontier));
            }

            return Ok(submissions
                .iter()
                .filter_map(|(request, _)| self.receipts.get(&request.request_id).cloned())
                .collect());
        }

        if let Some(attempts) = self.rejected_attempts.get(&frontier) {
            if attempts
                .iter()
                .any(|attempt| attempt.exact_set == exact_set)
            {
                return Ok(submissions
                    .iter()
                    .filter_map(|(request, _)| self.receipts.get(&request.request_id).cloned())
                    .collect());
            }

            if attempts.iter().any(|attempt| {
                attempt.exact_set.iter().any(|(request_id, _)| {
                    exact_set
                        .iter()
                        .any(|(attempted_id, _)| attempted_id == request_id)
                })
            }) {
                return Err(StoreError::ReplaySetMismatch(frontier));
            }
        }

        for ((request, _), identity) in submissions.iter().zip(&identities) {
            if self.receipts.contains_key(&request.request_id) {
                return Err(StoreError::OpenFrontierContainsTerminalRequest(
                    request.request_id.clone(),
                ));
            }

            self.reject_accepted_alias(request, *identity)?;
        }
        let decision_time = self
            .clock
            .now()
            .filter(valid_decision_time)
            .ok_or(StoreError::TimeEvidenceUnavailable)?;
        let validations = submissions
            .iter()
            .zip(&identities)
            .map(|((request, evidence), identity)| {
                self.validate(request, evidence, *identity, &decision_time)
            })
            .collect::<Vec<_>>();
        let invalid = validations
            .iter()
            .enumerate()
            .filter_map(|(index, result)| {
                result.as_ref().err().copied().map(|reason| (index, reason))
            })
            .collect::<Vec<_>>();

        let no_write = if !invalid.is_empty() {
            let selected_action = submissions
                .iter()
                .zip(&validations)
                .filter_map(|((request, _), result)| result.is_ok().then_some(request.action))
                .max_by_key(|action| action.priority())
                .unwrap_or(LifecycleAction::InitialActivation);
            let invalid_reasons = invalid.into_iter().collect::<BTreeMap<_, _>>();
            let reasons = (0..submissions.len())
                .map(|index| {
                    invalid_reasons
                        .get(&index)
                        .copied()
                        .unwrap_or(RejectionReason::FrontierContainsInvalidContender)
                })
                .collect::<Vec<_>>();
            Some((selected_action, reasons))
        } else if has_duplicate_complete_comparator_key(submissions) {
            let selected_action = submissions
                .iter()
                .map(|(request, _)| request.action)
                .max_by_key(|action| action.priority())
                .unwrap_or(LifecycleAction::InitialActivation);
            Some((
                selected_action,
                vec![RejectionReason::InputIncompleteNoWrite; submissions.len()],
            ))
        } else {
            None
        };

        if let Some((selected_action, reasons)) = no_write {
            let mut receipts = Vec::with_capacity(submissions.len());

            for (index, reason) in reasons.into_iter().enumerate() {
                let request = &submissions[index].0;
                let receipt = LifecycleRequestReceipt::rejected(
                    request,
                    identities[index],
                    reason,
                    selected_action,
                    decision_time.clone(),
                );
                self.receipts
                    .insert(request.request_id.clone(), receipt.clone());
                receipts.push(receipt);
            }

            self.rejected_attempts
                .entry(frontier)
                .or_default()
                .push(RejectedAttempt { exact_set });

            return Ok(receipts);
        }

        let winner_index = submissions
            .iter()
            .enumerate()
            .max_by_key(|(_, (request, _))| request.action.priority())
            .map(|(index, _)| index)
            .ok_or(StoreError::EmptyFrontier)?;
        let selected_action = submissions[winner_index].0.action;
        let winner_cuts = match &validations[winner_index] {
            Ok(cuts) => cuts.clone(),
            Err(_) => {
                return Err(StoreError::ValidationStateConflict(
                    submissions[winner_index].0.request_id.clone(),
                ));
            }
        };
        let revalidate_after = winner_cuts.revalidate_after;
        let decision = AuthorizedGenerationDecision::issue(
            &submissions[winner_index].0,
            identities[winner_index].semantic_digest,
            decision_time.clone(),
            revalidate_after,
            winner_cuts.cuts,
        );
        let mut receipts = Vec::with_capacity(submissions.len());

        for (index, ((request, _), identity)) in submissions.iter().zip(&identities).enumerate() {
            let receipt = if index == winner_index {
                self.record_accepted_alias(request, *identity);
                LifecycleRequestReceipt::accepted(
                    request,
                    *identity,
                    decision.clone(),
                    decision_time.clone(),
                )
            } else {
                LifecycleRequestReceipt::rejected(
                    request,
                    *identity,
                    RejectionReason::ConflictLost,
                    selected_action,
                    decision_time.clone(),
                )
            };
            self.receipts
                .insert(request.request_id.clone(), receipt.clone());
            receipts.push(receipt);
        }
        self.closed_frontiers.insert(
            frontier,
            ClosedFrontier {
                exact_set,
                decision_evidence,
            },
        );
        Ok(receipts)
    }

    #[must_use]
    pub fn receipt(&self, request_id: &LifecycleRequestId) -> Option<&LifecycleRequestReceipt> {
        self.receipts.get(request_id)
    }

    #[must_use]
    pub const fn source_owner_revalidate_after(&self) -> crate::RevalidationBoundary {
        crate::RevalidationBoundary::F0RepositoryNativeOwnerAdmissionContract
    }

    #[must_use]
    pub fn view(
        &self,
        receipt: &LifecycleRequestReceipt,
        runtime_readback: Option<&UntrustedRuntimeApplicationReadback>,
    ) -> GovernanceDecisionView {
        self.project_runtime(receipt, runtime_readback)
    }

    fn project_runtime(
        &self,
        receipt: &LifecycleRequestReceipt,
        runtime_readback: Option<&UntrustedRuntimeApplicationReadback>,
    ) -> GovernanceDecisionView {
        let projection_time = self.clock.now().filter(valid_decision_time);
        let decision = receipt.decision();
        let verified_runtime = decision.and_then(|decision| {
            projection_time.as_ref().and_then(|projection_time| {
                runtime_readback.and_then(|readback| {
                    self.verify_runtime_readback(decision, readback, projection_time)
                })
            })
        });
        let application_status =
            verified_runtime
                .as_ref()
                .map_or(
                    ApplicationStatus::ApplicationUnknown,
                    |verified| match verified.readback().disposition {
                        crate::RuntimeApplicationDisposition::Applied => ApplicationStatus::Applied,
                        crate::RuntimeApplicationDisposition::RejectedNoInstance => {
                            ApplicationStatus::RejectedNoInstance
                        }
                        crate::RuntimeApplicationDisposition::ApplicationUnknown => {
                            ApplicationStatus::ApplicationUnknown
                        }
                    },
                );
        let revalidate_after = decision.map(AuthorizedGenerationDecision::revalidate_after);
        GovernanceDecisionView::project(
            receipt,
            decision.map(AuthorizedGenerationDecision::decision_digest),
            application_status,
            verified_runtime.map(|verified| verified.readback().receipt_ref.clone()),
            projection_time.as_ref().map_or(0, |time| time.observed_at),
            ViewFreshness::Unavailable,
            ViewAvailability::Unavailable,
            revalidate_after,
        )
    }

    fn verify_runtime_readback(
        &self,
        decision: &AuthorizedGenerationDecision,
        readback: &UntrustedRuntimeApplicationReadback,
        projection_time: &TimeEvidence,
    ) -> Option<VerifiedRuntimeApplicationReceipt> {
        let decision_time = decision.decision_time();
        let causal_sequence = readback.time.clock_epoch == decision_time.clock_epoch
            && readback.time.monotonic_sequence > decision_time.monotonic_sequence;
        let causal_time = decision_time.observed_at <= readback.time.observed_at
            && readback.time.observed_at <= projection_time.observed_at;
        let bound = readback.decision_digest == decision.decision_digest()
            && readback.decision_frontier_id == *decision.decision_frontier_id()
            && readback.generation_id == *decision.generation_id()
            && readback.execution_scope_digest == decision.execution_scope().semantic_digest()
            && readback.principal_id == *decision.principal_id()
            && readback.request_scope_id == *decision.request_scope_id()
            && readback.authorization_lineage_ref == *decision.authorization_lineage_ref()
            && readback.autonomous_policy_ref == *decision.autonomous_policy_ref()
            && readback.autonomous_policy_revocation_frontier
                == decision.autonomous_policy().readback().revocation_frontier;

        ((self.admission.available() && self.admission.runtime_application(readback))
            && causal_time
            && causal_sequence
            && readback.time.is_current_at(projection_time.observed_at)
            && bound)
            .then(|| VerifiedRuntimeApplicationReceipt::verified(readback.clone()))
    }

    fn reject_accepted_alias(
        &self,
        request: &LifecycleRequest,
        identity: SemanticIdentity,
    ) -> Result<(), StoreError> {
        let candidates = [
            self.accepted_aliases.get(&identity.alias_digest),
            self.accepted_candidate_actions
                .get(&(request.candidate_id.clone(), request.action)),
            self.accepted_generation_actions
                .get(&(request.generation_id.clone(), request.action)),
        ];

        for original in candidates.into_iter().flatten() {
            if original != &request.request_id {
                return Err(StoreError::AliasRetry {
                    original: original.clone(),
                    attempted: request.request_id.clone(),
                });
            }
        }
        Ok(())
    }

    fn record_accepted_alias(&mut self, request: &LifecycleRequest, identity: SemanticIdentity) {
        self.accepted_aliases
            .insert(identity.alias_digest, request.request_id.clone());
        self.accepted_candidate_actions.insert(
            (request.candidate_id.clone(), request.action),
            request.request_id.clone(),
        );
        self.accepted_generation_actions.insert(
            (request.generation_id.clone(), request.action),
            request.request_id.clone(),
        );
    }

    #[allow(clippy::too_many_lines)]
    fn validate(
        &self,
        request: &LifecycleRequest,
        evidence: &UntrustedDecisionEvidence,
        _identity: SemanticIdentity,
        decision_time: &TimeEvidence,
    ) -> Result<ValidatedDecisionCuts, RejectionReason> {
        if request.execution_scope.mode != ExecutionMode::Paper {
            return Err(RejectionReason::LiveNotAdmitted);
        }

        if request.authorization_mode != AuthorizationMode::UnattendedRequestWithPolicy {
            return Err(RejectionReason::AttendedNotAdmitted);
        }

        if !matches!(
            request.activation_condition,
            crate::ActivationCondition::Unconditional
        ) {
            return Err(RejectionReason::ConditionalScannerNotAdmitted);
        }

        if request.contender_generation_ids.as_slice() != [request.generation_id.clone()] {
            return Err(RejectionReason::ContenderSetNotSingle);
        }

        if request.target_owner != "STRATEGY_GOVERNANCE"
            || request.allowed_intent_class != AllowedIntentClass::PaperAddRisk
        {
            return Err(RejectionReason::AuthorizationBindingMismatch);
        }

        if !causal_order(&request.submitted_time, decision_time) {
            return Err(RejectionReason::CausalOrderViolation);
        }

        if !request
            .submitted_time
            .is_current_at(decision_time.observed_at)
        {
            return Err(RejectionReason::EvidenceExpiredOrRevoked);
        }

        let artifact = evidence
            .artifact
            .as_ref()
            .ok_or(RejectionReason::MissingArtifact)?;
        let eligibility = evidence
            .eligibility
            .as_ref()
            .ok_or(RejectionReason::MissingEligibility)?;
        let capacity = evidence
            .capacity
            .as_ref()
            .ok_or(RejectionReason::MissingCapacity)?;
        let adapter = evidence
            .adapter_binding
            .as_ref()
            .ok_or(RejectionReason::MissingAdapterBinding)?;
        let lineage = evidence
            .authorization_lineage
            .as_ref()
            .ok_or(RejectionReason::MissingAuthorizationLineage)?;
        let policy = evidence
            .autonomous_policy
            .as_ref()
            .ok_or(RejectionReason::MissingAutonomousPolicy)?;

        if !artifact.complete {
            return Err(RejectionReason::ArtifactNotComplete);
        }

        if artifact.artifact_id != request.artifact_id
            || artifact.candidate_id != request.candidate_id
            || artifact.generation_id != request.generation_id
        {
            return Err(RejectionReason::CrossScopeMismatch);
        }

        if eligibility.state != EligibilityState::Qualified {
            return Err(RejectionReason::EvidenceExpiredOrRevoked);
        }

        if eligibility.artifact_id != request.artifact_id
            || eligibility.candidate_id != request.candidate_id
            || eligibility.economic_conditions_version != request.economic_conditions_version
        {
            return Err(RejectionReason::CrossScopeMismatch);
        }

        if !(eligibility.effective_from <= decision_time.observed_at
            && decision_time.observed_at < eligibility.effective_through)
        {
            return Err(RejectionReason::EvidenceExpiredOrRevoked);
        }

        if request.requested_capital > eligibility.capacity_ceiling {
            return Err(RejectionReason::CapitalExceedsEligibility);
        }

        if !capacity.bound {
            return Err(RejectionReason::CapacityNotBound);
        }

        if !capacity.candidate_neutral {
            return Err(RejectionReason::CapacityNotCandidateNeutral);
        }

        if capacity.capacity_scope_id != request.execution_scope.capacity_scope_id
            || capacity.account_id != request.execution_scope.account_id
            || capacity.execution_mode != request.execution_scope.mode
        {
            return Err(RejectionReason::CrossScopeMismatch);
        }

        if request.requested_capital > capacity.gross_ceiling {
            return Err(RejectionReason::CapitalExceedsCapacity);
        }

        if !adapter.admitted || adapter.execution_scope != request.execution_scope {
            return Err(RejectionReason::CrossScopeMismatch);
        }

        if lineage.revoked {
            return Err(RejectionReason::EvidenceExpiredOrRevoked);
        }

        if lineage.principal_id != request.principal_id
            || lineage.request_scope_id != request.request_scope_id
            || lineage.shell_binding_id != request.shell_binding_id
            || lineage.history_head_authorization != request.history_head_authorization
            || lineage.operation_manifest_id != request.operation_manifest_id
            || lineage.authorization_mode != request.authorization_mode
            || lineage.issuer != request.operator_issuer
            || lineage.audience != request.operator_audience
            || lineage.target_owner != request.target_owner
            || lineage.operation_schema != request.operation_schema
            || lineage.revocation_frontier != request.operator_revocation_frontier
            || lineage.request_proof_digest != request.request_proof_digest
        {
            return Err(RejectionReason::AuthorizationBindingMismatch);
        }

        if policy.revoked {
            return Err(RejectionReason::EvidenceExpiredOrRevoked);
        }

        if policy.principal_id != request.principal_id
            || policy.request_scope_id != request.request_scope_id
            || policy.account_id != request.execution_scope.account_id
            || policy.execution_mode != request.execution_scope.mode
            || policy.generation_id != request.generation_id
            || policy.execution_scope_digest != request.execution_scope.semantic_digest()
            || policy.allowed_action != request.action
            || policy.allowed_intent_class != request.allowed_intent_class
            || policy.capital_policy_ref != request.capital_policy_ref
            || policy.operation_manifest_id != request.operation_manifest_id
            || policy.issuer != request.autonomous_policy_issuer
            || policy.audience != request.autonomous_policy_audience
            || policy.target_owner != request.target_owner
            || policy.revocation_frontier != request.autonomous_policy_revocation_frontier
        {
            return Err(RejectionReason::AuthorizationBindingMismatch);
        }

        for time in [
            &eligibility.time,
            &capacity.time,
            &adapter.time,
            &lineage.time,
            &policy.time,
        ] {
            if !causal_order(time, decision_time) {
                return Err(RejectionReason::CausalOrderViolation);
            }

            if !time.is_current_at(decision_time.observed_at) {
                return Err(RejectionReason::EvidenceExpiredOrRevoked);
            }
        }

        if !self.admission.available() {
            return Err(RejectionReason::SourceOwnerAdmissionUnavailable);
        }

        if !self.admission.artifact(artifact)
            || !self.admission.eligibility(eligibility)
            || !self.admission.capacity(capacity)
            || !self.admission.adapter_binding(adapter)
            || !self.admission.authorization_lineage(lineage)
            || !self.admission.autonomous_policy(policy)
        {
            return Err(RejectionReason::EvidenceNotTrusted);
        }

        if request.action != LifecycleAction::InitialActivation {
            return Err(RejectionReason::ActionNotAdmittedInStaticSlice);
        }

        let revalidate_after = [
            request.submitted_time.valid_through,
            eligibility.time.valid_through,
            eligibility.effective_through,
            capacity.time.valid_through,
            adapter.time.valid_through,
            lineage.time.valid_through,
            policy.time.valid_through,
        ]
        .into_iter()
        .min()
        .ok_or(RejectionReason::EvidenceExpiredOrRevoked)?;
        Ok(ValidatedDecisionCuts {
            revalidate_after,
            cuts: VerifiedDecisionCuts {
                artifact: VerifiedArtifact::verified(artifact.clone()),
                eligibility: VerifiedEligibility::verified(eligibility.clone()),
                capacity: VerifiedCapacityView::verified(capacity.clone()),
                adapter_binding: VerifiedAdapterBinding::verified(adapter.clone()),
                authorization_lineage: VerifiedAuthorizationLineage::verified(lineage.clone()),
                autonomous_policy: VerifiedAutonomousPolicy::verified(policy.clone()),
            },
        })
    }
}

#[derive(Clone)]
struct ValidatedDecisionCuts {
    revalidate_after: u64,
    cuts: VerifiedDecisionCuts,
}

fn causal_order(evidence: &TimeEvidence, decision_time: &TimeEvidence) -> bool {
    evidence.is_observed_before_or_at(decision_time)
        && evidence.observed_at < evidence.valid_through
        && evidence.clock_epoch == decision_time.clock_epoch
        && evidence.monotonic_sequence <= decision_time.monotonic_sequence
}

fn valid_decision_time(evidence: &TimeEvidence) -> bool {
    !evidence.clock_epoch.is_empty()
        && evidence.monotonic_sequence != 0
        && evidence.observed_at < evidence.valid_through
}

fn has_duplicate_complete_comparator_key(
    submissions: &[(LifecycleRequest, UntrustedDecisionEvidence)],
) -> bool {
    let mut seen = BTreeSet::new();

    submissions
        .iter()
        .any(|(request, _)| !seen.insert((request.generation_id.clone(), request.action)))
}

fn canonical_set(
    submissions: &[(LifecycleRequest, UntrustedDecisionEvidence)],
    identities: &[SemanticIdentity],
) -> Result<Vec<(LifecycleRequestId, Digest)>, StoreError> {
    let mut seen = BTreeMap::<LifecycleRequestId, Digest>::new();

    for ((request, _), identity) in submissions.iter().zip(identities) {
        if seen
            .insert(request.request_id.clone(), identity.semantic_digest)
            .is_some()
        {
            return Err(StoreError::DuplicateRequestConflict(
                request.request_id.clone(),
            ));
        }
    }
    Ok(seen.into_iter().collect())
}

fn canonical_decision_evidence(
    submissions: &[(LifecycleRequest, UntrustedDecisionEvidence)],
) -> Vec<(LifecycleRequestId, UntrustedDecisionEvidence)> {
    submissions
        .iter()
        .map(|(request, evidence)| (request.request_id.clone(), evidence.clone()))
        .collect::<BTreeMap<_, _>>()
        .into_iter()
        .collect()
}
