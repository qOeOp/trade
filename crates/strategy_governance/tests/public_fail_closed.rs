use rstest::rstest;
use vibe_strategy_governance::{
    AccountId, ActivationCondition, AdapterBindingId, AllowedIntentClass, ArtifactId,
    AuthorizationMode, CandidateId, CapacityScopeId, DecisionFrontierId, Digest,
    EconomicConditionsVersion, EligibilityState, ExecutionMode, ExecutionScope, FactRef,
    GenerationId, GovernanceCore, LifecycleAction, LifecycleRequest, LifecycleRequestId,
    ManifestId, PrincipalId, QualificationSourceFrontier, RequestScopeId, ShellBindingId,
    StoreError, TimeEvidence, TimeSourceFrontierId, UntrustedAdapterBindingReadback,
    UntrustedArtifactReadback, UntrustedAuthorizationLineageReadback,
    UntrustedAutonomousPolicyReadback, UntrustedCapacityViewReadback, UntrustedDecisionEvidence,
    UntrustedEligibilityReadback,
};

fn id<T>(value: &str, constructor: impl FnOnce(String) -> Result<T, &'static str>) -> T {
    constructor(value.to_owned()).expect("valid test identifier")
}

fn digest(value: &str) -> Digest {
    Digest::of_fields(&[value])
}

fn fact(value: &str) -> FactRef {
    FactRef {
        id: value.to_owned(),
        digest: digest(value),
    }
}

fn current_forever() -> TimeEvidence {
    TimeEvidence {
        clock_epoch: "caller-clock".to_owned(),
        monotonic_sequence: 1,
        observed_at: 1,
        valid_through: u64::MAX,
        source_frontier: id("caller-time-frontier", TimeSourceFrontierId::new),
    }
}

#[allow(clippy::too_many_lines)]
fn self_signed_chain() -> (LifecycleRequest, UntrustedDecisionEvidence) {
    let account_id = id("paper-account", AccountId::new);
    let capacity_scope_id = id("paper-capacity", CapacityScopeId::new);
    let execution_scope = ExecutionScope {
        mode: ExecutionMode::Paper,
        account_id: account_id.clone(),
        effect_namespace: "paper".to_owned(),
        capacity_scope_id: capacity_scope_id.clone(),
        adapter_binding_id: id("paper-adapter", AdapterBindingId::new),
        endpoint_id: "paper-endpoint".to_owned(),
        capability_digest: digest("capability"),
        trust_policy_digest: digest("trust-policy"),
        reduce_only_policy_digest: digest("reduce-only"),
        credential_handle_ref: "paper-handle".to_owned(),
    };
    let request = LifecycleRequest {
        request_id: id("request", LifecycleRequestId::new),
        decision_frontier_id: id("frontier", DecisionFrontierId::new),
        principal_id: id("principal", PrincipalId::new),
        request_scope_id: id("scope", RequestScopeId::new),
        shell_binding_id: id("shell", ShellBindingId::new),
        history_head_authorization: fact("history"),
        operation_manifest_id: id("manifest", ManifestId::new),
        operation_schema: "lifecycle-request-v1".to_owned(),
        target_owner: "STRATEGY_GOVERNANCE".to_owned(),
        operator_issuer: "caller-operator".to_owned(),
        operator_audience: "strategy-governance".to_owned(),
        operator_revocation_frontier: digest("operator-frontier"),
        request_proof_digest: digest("request-proof"),
        autonomous_policy_issuer: "caller-policy".to_owned(),
        autonomous_policy_audience: "strategy-governance".to_owned(),
        autonomous_policy_revocation_frontier: digest("policy-frontier"),
        authorization_mode: AuthorizationMode::UnattendedRequestWithPolicy,
        action: LifecycleAction::InitialActivation,
        candidate_id: id("candidate", CandidateId::new),
        generation_id: id("generation", GenerationId::new),
        artifact_id: id("artifact", ArtifactId::new),
        economic_conditions_version: id("economics", EconomicConditionsVersion::new),
        execution_scope: execution_scope.clone(),
        activation_condition: ActivationCondition::Unconditional,
        requested_capital: 1,
        capital_policy_ref: fact("capital-policy"),
        allowed_intent_class: AllowedIntentClass::PaperAddRisk,
        contender_generation_ids: vec![id("generation", GenerationId::new)],
        submitted_time: current_forever(),
    };
    let evidence = UntrustedDecisionEvidence {
        artifact: Some(UntrustedArtifactReadback {
            artifact_ref: fact("artifact-fact"),
            artifact_id: request.artifact_id.clone(),
            candidate_id: request.candidate_id.clone(),
            generation_id: request.generation_id.clone(),
            runtime_abi_digest: digest("runtime-abi"),
            compatibility_digest: digest("artifact-runtime-compatibility"),
            complete: true,
        }),
        eligibility: Some(UntrustedEligibilityReadback {
            eligibility_ref: fact("eligibility-fact"),
            state: EligibilityState::Qualified,
            artifact_id: request.artifact_id.clone(),
            candidate_id: request.candidate_id.clone(),
            economic_conditions_version: request.economic_conditions_version.clone(),
            evaluated_capacity_model: "capacity-model".to_owned(),
            capacity_ceiling: 1,
            effective_from: 1,
            effective_through: u64::MAX,
            qualification_frontier: QualificationSourceFrontier::new("qualification-frontier")
                .expect("valid Qualification frontier"),
            revocation_frontier: digest("eligibility-frontier"),
            time_evidence_ref: fact("qualification-time"),
            time: current_forever(),
        }),
        capacity: Some(UntrustedCapacityViewReadback {
            capacity_ref: fact("capacity-fact"),
            capacity_scope_id,
            account_id,
            execution_mode: ExecutionMode::Paper,
            gross_ceiling: 1,
            candidate_neutral: true,
            bound: true,
            time: current_forever(),
        }),
        adapter_binding: Some(UntrustedAdapterBindingReadback {
            binding_ref: fact("binding-fact"),
            execution_scope,
            admitted: true,
            time: current_forever(),
        }),
        authorization_lineage: Some(UntrustedAuthorizationLineageReadback {
            lineage_ref: fact("lineage-fact"),
            principal_id: request.principal_id.clone(),
            request_scope_id: request.request_scope_id.clone(),
            shell_binding_id: request.shell_binding_id.clone(),
            history_head_authorization: request.history_head_authorization.clone(),
            operation_manifest_id: request.operation_manifest_id.clone(),
            authorization_mode: request.authorization_mode,
            issuer: request.operator_issuer.clone(),
            audience: request.operator_audience.clone(),
            target_owner: request.target_owner.clone(),
            operation_schema: request.operation_schema.clone(),
            revocation_frontier: request.operator_revocation_frontier,
            request_proof_digest: request.request_proof_digest,
            time: current_forever(),
            revoked: false,
        }),
        autonomous_policy: Some(UntrustedAutonomousPolicyReadback {
            policy_ref: fact("policy-fact"),
            principal_id: request.principal_id.clone(),
            request_scope_id: request.request_scope_id.clone(),
            account_id: request.execution_scope.account_id.clone(),
            execution_mode: request.execution_scope.mode,
            generation_id: request.generation_id.clone(),
            execution_scope_digest: request.execution_scope.semantic_digest(),
            allowed_action: request.action,
            allowed_intent_class: request.allowed_intent_class,
            capital_policy_ref: request.capital_policy_ref.clone(),
            operation_manifest_id: request.operation_manifest_id.clone(),
            issuer: request.autonomous_policy_issuer.clone(),
            audience: request.autonomous_policy_audience.clone(),
            target_owner: request.target_owner.clone(),
            revocation_frontier: request.autonomous_policy_revocation_frontier,
            time: current_forever(),
            revoked: false,
        }),
    };
    (request, evidence)
}

#[rstest]
fn public_default_core_requires_time_owner_before_any_write() {
    let (request, evidence) = self_signed_chain();
    let mut core = GovernanceCore::new();
    assert_eq!(
        core.resolve_frontier(&[(request.clone(), evidence.clone())]),
        Err(StoreError::TimeEvidenceUnavailable)
    );
    assert!(core.receipt(&request.request_id).is_none());

    let mut restarted = GovernanceCore::new();
    assert_eq!(
        restarted.resolve_frontier(&[(request.clone(), evidence)]),
        Err(StoreError::TimeEvidenceUnavailable)
    );
    assert!(restarted.receipt(&request.request_id).is_none());
}

#[rstest]
fn public_forged_missing_stale_and_replaced_eligibility_are_no_write() {
    let (request, evidence) = self_signed_chain();
    let mut missing = evidence.clone();
    missing.eligibility = None;
    let mut stale = evidence.clone();
    stale
        .eligibility
        .as_mut()
        .expect("fixture eligibility")
        .time
        .valid_through = 1;
    let mut replaced = evidence.clone();
    replaced
        .eligibility
        .as_mut()
        .expect("fixture eligibility")
        .eligibility_ref = fact("replacement-eligibility");
    let cases = [evidence, missing, stale, replaced];
    let mut rejected = 0;

    for candidate in cases {
        let mut core = GovernanceCore::new();
        assert_eq!(
            core.resolve_frontier(&[(request.clone(), candidate)]),
            Err(StoreError::TimeEvidenceUnavailable)
        );
        assert!(core.receipt(&request.request_id).is_none());
        rejected += 1;
    }

    assert_eq!(rejected, 4);
}
