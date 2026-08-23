use std::{collections::VecDeque, sync::Mutex};

use rstest::rstest;

use crate::{
    AccountId, ActivationCondition, AdapterBindingId, AllowedIntentClass, ApplicationStatus,
    ArtifactId, AuthorizationMode, CandidateId, CapacityScopeId, DecisionFrontierId, Digest,
    EconomicConditionsVersion, EligibilityState, ExecutionMode, ExecutionScope, FactRef,
    GenerationId, GovernanceCore, LifecycleAction, LifecycleRequest, LifecycleRequestId,
    ManifestId, PrincipalId, QualificationSourceFrontier, ReceiptStatus, RejectionReason,
    RequestScopeId, RuntimeApplicationDisposition, RuntimeReceiptId, ShellBindingId, StoreError,
    TimeEvidence, TimeSourceFrontierId, UntrustedAdapterBindingReadback, UntrustedArtifactReadback,
    UntrustedAuthorizationLineageReadback, UntrustedAutonomousPolicyReadback,
    UntrustedCapacityViewReadback, UntrustedDecisionEvidence, UntrustedEligibilityReadback,
    UntrustedRuntimeApplicationReadback, ViewAvailability, ViewFreshness,
    authority::{OwnerAdmission, qualification_frontiers_match},
    store::GovernanceClock,
};

fn id<T>(value: &str, constructor: impl FnOnce(String) -> Result<T, &'static str>) -> T {
    constructor(value.to_owned()).expect("valid fixture identifier")
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

fn time(observed_at: u64, monotonic_sequence: u64) -> TimeEvidence {
    TimeEvidence {
        clock_epoch: "test-clock-v1".to_owned(),
        monotonic_sequence,
        observed_at,
        valid_through: 2_000,
        source_frontier: id(
            &format!("time-frontier-{monotonic_sequence}"),
            TimeSourceFrontierId::new,
        ),
    }
}

#[rstest]
fn time_evidence_digest_binds_object_domain_and_raw_frontier() {
    let evidence = time(900, 10);
    let expected = Digest::of_domain_fields(
        "governance-time-evidence-v1",
        &["test-clock-v1", "10", "900", "2000", "time-frontier-10"],
    );
    assert_eq!(evidence.semantic_digest(), expected);
    assert_ne!(
        evidence.semantic_digest(),
        Digest::of_domain_fields(
            "governance-not-time-evidence-v1",
            &["test-clock-v1", "10", "900", "2000", "time-frontier-10",]
        )
    );

    let mut changed = evidence.clone();
    changed.source_frontier =
        TimeSourceFrontierId::new("time-frontier-10/raw-change").expect("valid raw frontier");
    assert_ne!(evidence.semantic_digest(), changed.semantic_digest());
}

#[rstest]
fn identical_payloads_do_not_alias_across_object_domains() {
    let fields = ["same", "payload", "vector"];
    let domains = [
        "governance-time-evidence-v1",
        "governance-execution-scope-v1",
        "governance-contender-set-v1",
        "governance-lifecycle-request-alias-v1",
        "governance-lifecycle-request-semantic-v1",
        "governance-authorized-generation-decision-v1",
    ];
    let digests = domains
        .map(|domain| Digest::of_domain_fields(domain, &fields))
        .into_iter()
        .collect::<std::collections::BTreeSet<_>>();

    assert_eq!(digests.len(), domains.len());
}

#[derive(Clone)]
struct Fixture {
    request: LifecycleRequest,
    evidence: UntrustedDecisionEvidence,
}

impl Fixture {
    #[allow(clippy::too_many_lines)]
    fn new() -> Self {
        let account_id = id("paper-account", AccountId::new);
        let capacity_scope_id = id("portfolio-paper", CapacityScopeId::new);
        let adapter_binding_id = id("paper-adapter", AdapterBindingId::new);
        let execution_scope = ExecutionScope {
            mode: ExecutionMode::Paper,
            account_id: account_id.clone(),
            effect_namespace: "paper-orders".to_owned(),
            capacity_scope_id: capacity_scope_id.clone(),
            adapter_binding_id,
            endpoint_id: "paper-endpoint".to_owned(),
            capability_digest: digest("paper-capability"),
            trust_policy_digest: digest("adapter-trust"),
            reduce_only_policy_digest: digest("reduce-only"),
            credential_handle_ref: "paper-credential-handle".to_owned(),
        };
        let generation_id = id("generation/A", GenerationId::new);
        let request = LifecycleRequest {
            request_id: id("request-1", LifecycleRequestId::new),
            decision_frontier_id: id("frontier-1", DecisionFrontierId::new),
            principal_id: id("principal-1", PrincipalId::new),
            request_scope_id: id("request-scope-1", RequestScopeId::new),
            shell_binding_id: id("shell-1", ShellBindingId::new),
            history_head_authorization: fact("history-head-1"),
            operation_manifest_id: id("manifest-1", ManifestId::new),
            operation_schema: "lifecycle-request-v1".to_owned(),
            target_owner: "STRATEGY_GOVERNANCE".to_owned(),
            operator_issuer: "product-edge-auth".to_owned(),
            operator_audience: "strategy-governance".to_owned(),
            operator_revocation_frontier: digest("operator-revocation-frontier"),
            request_proof_digest: digest("request-proof"),
            autonomous_policy_issuer: "governance-policy-owner".to_owned(),
            autonomous_policy_audience: "strategy-governance".to_owned(),
            autonomous_policy_revocation_frontier: digest("policy-revocation-frontier"),
            authorization_mode: AuthorizationMode::UnattendedRequestWithPolicy,
            action: LifecycleAction::InitialActivation,
            candidate_id: id("candidate-1", CandidateId::new),
            generation_id: generation_id.clone(),
            artifact_id: id("artifact-1", ArtifactId::new),
            economic_conditions_version: id("conditions-1", EconomicConditionsVersion::new),
            execution_scope: execution_scope.clone(),
            activation_condition: ActivationCondition::Unconditional,
            requested_capital: 40,
            capital_policy_ref: fact("capital-policy-1"),
            allowed_intent_class: AllowedIntentClass::PaperAddRisk,
            contender_generation_ids: vec![generation_id],
            submitted_time: time(900, 10),
        };
        let evidence = UntrustedDecisionEvidence {
            artifact: Some(UntrustedArtifactReadback {
                artifact_ref: fact("artifact-fact-1"),
                artifact_id: request.artifact_id.clone(),
                candidate_id: request.candidate_id.clone(),
                generation_id: request.generation_id.clone(),
                runtime_abi_digest: digest("runtime-abi/v1"),
                compatibility_digest: digest("artifact-runtime-compatibility/v1"),
                complete: true,
            }),
            eligibility: Some(UntrustedEligibilityReadback {
                eligibility_ref: fact("eligibility-fact-1"),
                state: EligibilityState::Qualified,
                artifact_id: request.artifact_id.clone(),
                candidate_id: request.candidate_id.clone(),
                economic_conditions_version: request.economic_conditions_version.clone(),
                evaluated_capacity_model: "capacity-model/v1".to_owned(),
                capacity_ceiling: 50,
                effective_from: 800,
                effective_through: 1_800,
                qualification_frontier: QualificationSourceFrontier::new("qualification-frontier")
                    .expect("valid Qualification frontier"),
                revocation_frontier: digest("eligibility-revocation-frontier"),
                time_evidence_ref: fact("qualification-time-evidence"),
                time: time(910, 11),
            }),
            capacity: Some(UntrustedCapacityViewReadback {
                capacity_ref: fact("capacity-fact-1"),
                capacity_scope_id,
                account_id,
                execution_mode: ExecutionMode::Paper,
                gross_ceiling: 60,
                candidate_neutral: true,
                bound: true,
                time: time(920, 12),
            }),
            adapter_binding: Some(UntrustedAdapterBindingReadback {
                binding_ref: fact("adapter-binding-fact-1"),
                execution_scope,
                admitted: true,
                time: time(930, 13),
            }),
            authorization_lineage: Some(UntrustedAuthorizationLineageReadback {
                lineage_ref: fact("lineage-fact-1"),
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
                time: time(940, 14),
                revoked: false,
            }),
            autonomous_policy: Some(UntrustedAutonomousPolicyReadback {
                policy_ref: fact("autonomous-policy-fact-1"),
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
                time: time(950, 15),
                revoked: false,
            }),
        };
        Self { request, evidence }
    }

    fn core(&self, clock_values: Vec<TimeEvidence>, runtime_available: bool) -> GovernanceCore {
        GovernanceCore::with_dependencies(
            Box::new(FixtureAdmission {
                evidence: self.evidence.clone(),
                runtime_available,
            }),
            Box::new(FixedClock::new(clock_values)),
        )
    }

    fn resolve(&self) -> crate::LifecycleRequestReceipt {
        self.core(vec![time(1_000, 20)], false)
            .resolve_frontier(&[(self.request.clone(), self.evidence.clone())])
            .expect("fixture resolves to a receipt")
            .remove(0)
    }
}

#[rstest]
fn qualification_owner_frontiers_require_byte_exact_typed_readback() {
    let fixture = Fixture::new();
    let authentic = fixture
        .evidence
        .eligibility
        .as_ref()
        .expect("fixture has Qualification readback");
    let owner_qualification_frontier = authentic.qualification_frontier.clone();
    let owner_time_frontier =
        QualificationSourceFrontier::new(authentic.time.source_frontier.as_str())
            .expect("valid Qualification time frontier");

    assert!(qualification_frontiers_match(
        &owner_qualification_frontier,
        &owner_time_frontier,
        authentic,
    ));

    let mut qualification_mutation = authentic.clone();
    qualification_mutation.qualification_frontier =
        QualificationSourceFrontier::new("qualification-frontier/mutated")
            .expect("valid mutated Qualification frontier");
    assert!(!qualification_frontiers_match(
        &owner_qualification_frontier,
        &owner_time_frontier,
        &qualification_mutation,
    ));

    let mut time_mutation = authentic.clone();
    time_mutation.time.source_frontier =
        TimeSourceFrontierId::new("time-frontier-11/mutated").expect("valid mutated time frontier");
    assert!(!qualification_frontiers_match(
        &owner_qualification_frontier,
        &owner_time_frontier,
        &time_mutation,
    ));
}

struct FixtureAdmission {
    evidence: UntrustedDecisionEvidence,
    runtime_available: bool,
}

impl OwnerAdmission for FixtureAdmission {
    fn available(&self) -> bool {
        true
    }

    fn artifact(&self, readback: &UntrustedArtifactReadback) -> bool {
        self.evidence.artifact.as_ref() == Some(readback)
    }

    fn eligibility(&self, readback: &UntrustedEligibilityReadback) -> bool {
        self.evidence.eligibility.as_ref() == Some(readback)
    }

    fn capacity(&self, readback: &UntrustedCapacityViewReadback) -> bool {
        self.evidence.capacity.as_ref() == Some(readback)
    }

    fn adapter_binding(&self, readback: &UntrustedAdapterBindingReadback) -> bool {
        self.evidence.adapter_binding.as_ref() == Some(readback)
    }

    fn authorization_lineage(&self, readback: &UntrustedAuthorizationLineageReadback) -> bool {
        self.evidence.authorization_lineage.as_ref() == Some(readback)
    }

    fn autonomous_policy(&self, readback: &UntrustedAutonomousPolicyReadback) -> bool {
        self.evidence.autonomous_policy.as_ref() == Some(readback)
    }

    fn runtime_application(&self, _readback: &UntrustedRuntimeApplicationReadback) -> bool {
        self.runtime_available
    }
}

struct FixedClock {
    values: Mutex<VecDeque<TimeEvidence>>,
}

impl FixedClock {
    fn new(values: Vec<TimeEvidence>) -> Self {
        Self {
            values: Mutex::new(values.into()),
        }
    }
}

impl GovernanceClock for FixedClock {
    fn now(&self) -> Option<TimeEvidence> {
        Some(
            self.values
                .lock()
                .expect("test clock lock")
                .pop_front()
                .expect("test clock value"),
        )
    }
}

#[rstest]
fn invalid_decision_time_is_unavailable_before_any_receipt_write() {
    let invalid_times = [
        TimeEvidence {
            clock_epoch: String::new(),
            ..time(1_000, 20)
        },
        TimeEvidence {
            monotonic_sequence: 0,
            ..time(1_000, 20)
        },
        TimeEvidence {
            valid_through: 1_000,
            ..time(1_000, 20)
        },
    ];

    let mut rejected = 0;

    for invalid_time in invalid_times {
        let fixture = Fixture::new();
        let request_id = fixture.request.request_id.clone();
        let mut core = fixture.core(vec![invalid_time], false);
        assert_eq!(
            core.resolve_frontier(&[(fixture.request, fixture.evidence)]),
            Err(StoreError::TimeEvidenceUnavailable)
        );
        assert!(core.receipt(&request_id).is_none());
        rejected += 1;
    }
    assert_eq!(rejected, 3);
}

#[rstest]
fn sealed_complete_chain_authorizes_paper_but_runtime_stays_unknown() {
    let fixture = Fixture::new();
    let mut core = fixture.core(vec![time(1_000, 20), time(1_050, 30)], false);
    let receipt = core
        .resolve_frontier(&[(fixture.request, fixture.evidence)])
        .expect("sealed admission resolves")
        .remove(0);
    assert_eq!(receipt.status(), ReceiptStatus::Accepted);
    let decision = receipt.decision().expect("accepted decision");
    assert_eq!(decision.revalidate_after(), 1_800);
    assert_eq!(decision.principal_id().as_str(), "principal-1");
    assert_eq!(decision.request_scope_id().as_str(), "request-scope-1");

    let view = core.view(&receipt, None);
    assert_eq!(
        view.application_status(),
        ApplicationStatus::ApplicationUnknown
    );
    assert_eq!(view.freshness(), ViewFreshness::Unavailable);
    assert_eq!(view.availability(), ViewAvailability::Unavailable);
    assert_eq!(view.source_frontier(), None);
    assert_eq!(view.projected_at(), 1_050);
    let json: serde_json::Value =
        serde_json::from_str(&view.to_json().expect("consumer JSON")).expect("valid JSON");
    assert_eq!(json["principal_id"], "principal-1");
    assert_eq!(json["request_scope_id"], "request-scope-1");
    assert_eq!(json["decision_frontier_id"], "frontier-1");
    assert_eq!(json["projected_at"], 1_050);
    assert_eq!(json["freshness"], "UNAVAILABLE");
    assert_eq!(json["availability"], "UNAVAILABLE");
    assert!(json["source_frontier"].is_null());
    assert!(json.get("projection_source_frontier").is_none());
}

#[rstest]
fn exact_replay_joins_while_mutation_and_duplicate_cardinality_fail() {
    let fixture = Fixture::new();
    let mut core = fixture.core(vec![time(1_000, 20), time(1_010, 21)], false);
    let submission = [(fixture.request.clone(), fixture.evidence.clone())];
    let first = core
        .resolve_frontier(&submission)
        .expect("first receipt")
        .remove(0);
    let replay = core
        .resolve_frontier(&submission)
        .expect("exact replay")
        .remove(0);
    assert_eq!(first, replay);

    let mut mutated = fixture.request.clone();
    mutated.requested_capital += 1;
    assert_eq!(
        core.resolve_frontier(&[(mutated, fixture.evidence.clone())]),
        Err(StoreError::SemanticMutation(
            fixture.request.request_id.clone()
        ))
    );
    assert!(matches!(
        core.resolve_frontier(&[
            (fixture.request.clone(), fixture.evidence.clone()),
            (fixture.request, fixture.evidence),
        ]),
        Err(StoreError::DuplicateRequestConflict(_))
    ));
}

#[rstest]
fn accepted_replay_binds_complete_current_eligibility_evidence_without_writes() {
    let fixture = Fixture::new();
    let request_id = fixture.request.request_id.clone();
    let submission = (fixture.request.clone(), fixture.evidence.clone());
    let mut core = fixture.core(
        vec![
            time(1_000, 20),
            time(1_010, 21),
            time(1_020, 22),
            time(1_030, 23),
            time(1_040, 24),
            time(1_050, 25),
            time(1_060, 26),
            time(1_070, 27),
        ],
        false,
    );
    let first = core
        .resolve_frontier(std::slice::from_ref(&submission))
        .expect("initial accepted frontier")
        .remove(0);
    assert_eq!(first.status(), ReceiptStatus::Accepted);
    assert_eq!(
        core.resolve_frontier(std::slice::from_ref(&submission))
            .expect("exact complete replay joins")
            .remove(0),
        first
    );

    let mut missing = fixture.evidence.clone();
    missing.eligibility = None;
    let mut stale = fixture.evidence.clone();
    stale
        .eligibility
        .as_mut()
        .expect("eligibility")
        .time
        .valid_through = 999;
    let mut replaced = fixture.evidence.clone();
    replaced
        .eligibility
        .as_mut()
        .expect("eligibility")
        .eligibility_ref = fact("replacement-eligibility");
    let cases = [
        (missing, RejectionReason::MissingEligibility),
        (stale, RejectionReason::EvidenceExpiredOrRevoked),
        (replaced, RejectionReason::EvidenceNotTrusted),
    ];
    let mut rejected = 0;

    for (evidence, reason) in cases {
        assert_eq!(
            core.resolve_frontier(&[(fixture.request.clone(), evidence)]),
            Err(StoreError::DecisionEvidenceUnavailable {
                request_id: request_id.clone(),
                reason,
            })
        );
        assert_eq!(core.receipt(&request_id), Some(&first));
        assert_eq!(
            core.resolve_frontier(std::slice::from_ref(&submission))
                .expect("rejected evidence mutation cannot disturb exact replay")
                .remove(0),
            first
        );
        rejected += 1;
    }

    assert_eq!(rejected, 3);
}

#[rstest]
fn accepted_replay_revalidates_complete_current_decision_evidence() {
    let mutations: [fn(&mut Fixture); 5] = [
        |fixture| fixture.request.submitted_time.valid_through = 1_050,
        |fixture| {
            fixture
                .evidence
                .capacity
                .as_mut()
                .expect("capacity")
                .time
                .valid_through = 1_050;
        },
        |fixture| {
            fixture
                .evidence
                .adapter_binding
                .as_mut()
                .expect("adapter binding")
                .time
                .valid_through = 1_050;
        },
        |fixture| {
            fixture
                .evidence
                .authorization_lineage
                .as_mut()
                .expect("authorization lineage")
                .time
                .valid_through = 1_050;
        },
        |fixture| {
            fixture
                .evidence
                .autonomous_policy
                .as_mut()
                .expect("autonomous policy")
                .time
                .valid_through = 1_050;
        },
    ];
    let mut rejected = 0;

    for mutate in mutations {
        let mut fixture = Fixture::new();
        mutate(&mut fixture);
        let request_id = fixture.request.request_id.clone();
        let submission = (fixture.request.clone(), fixture.evidence.clone());
        let mut core = fixture.core(vec![time(1_000, 20), time(1_100, 21)], false);
        let first = core
            .resolve_frontier(std::slice::from_ref(&submission))
            .expect("initial complete current evidence is accepted")
            .remove(0);
        assert_eq!(first.status(), ReceiptStatus::Accepted);

        assert_eq!(
            core.resolve_frontier(std::slice::from_ref(&submission)),
            Err(StoreError::DecisionEvidenceUnavailable {
                request_id: request_id.clone(),
                reason: RejectionReason::EvidenceExpiredOrRevoked,
            })
        );
        assert_eq!(core.receipt(&request_id), Some(&first));
        rejected += 1;
    }

    assert_eq!(rejected, 5);
}

#[rstest]
fn rejected_attempt_requires_exact_set_and_invalid_high_priority_does_not_close() {
    let fixture = Fixture::new();
    let mut high = fixture.request.clone();
    high.request_id = id("request-high", LifecycleRequestId::new);
    high.action = LifecycleAction::Recovery;
    let mut high_evidence = fixture.evidence.clone();
    high_evidence.artifact = None;
    let low = (fixture.request.clone(), fixture.evidence.clone());
    let batch = [(high, high_evidence), low.clone()];
    let mut core = fixture.core(
        vec![
            time(1_000, 20),
            time(1_010, 21),
            time(1_020, 22),
            time(1_030, 23),
        ],
        false,
    );
    let receipts = core.resolve_frontier(&batch).expect("rejected attempt");
    assert_eq!(receipts.len(), 2);
    assert_eq!(
        receipts[0].rejection_reason(),
        Some(RejectionReason::MissingArtifact)
    );
    assert_eq!(
        receipts[1].rejection_reason(),
        Some(RejectionReason::FrontierContainsInvalidContender)
    );
    assert!(
        receipts
            .iter()
            .all(|receipt| receipt.selected_action() == LifecycleAction::InitialActivation)
    );
    assert_eq!(
        core.resolve_frontier(&[low]),
        Err(StoreError::ReplaySetMismatch(
            fixture.request.decision_frontier_id.clone()
        ))
    );

    let replay = core
        .resolve_frontier(&batch)
        .expect("exact rejected replay");
    assert_eq!(replay, receipts);

    let mut corrected = fixture.request.clone();
    corrected.request_id = id("request-corrected", LifecycleRequestId::new);
    let corrected_receipt = core
        .resolve_frontier(&[(corrected, fixture.evidence)])
        .expect("new lawful set on still-open frontier")
        .remove(0);
    assert_eq!(corrected_receipt.status(), ReceiptStatus::Accepted);
}

#[rstest]
fn rejected_attempt_replay_requires_exact_decision_evidence() {
    let fixture = Fixture::new();
    let request_id = fixture.request.request_id.clone();
    let mut rejected_evidence = fixture.evidence.clone();
    rejected_evidence.capacity = None;
    let submission = (fixture.request.clone(), rejected_evidence.clone());
    let mut core = fixture.core(
        vec![
            time(1_000, 20),
            time(1_010, 21),
            time(1_020, 22),
            time(1_030, 23),
            time(1_040, 24),
        ],
        false,
    );
    let first = core
        .resolve_frontier(std::slice::from_ref(&submission))
        .expect("valid owner evidence with a missing capacity cut writes one rejection")
        .remove(0);
    assert_eq!(
        first.rejection_reason(),
        Some(RejectionReason::MissingCapacity)
    );

    let mut missing = rejected_evidence.clone();
    missing.eligibility = None;
    let mut stale = rejected_evidence.clone();
    stale
        .eligibility
        .as_mut()
        .expect("eligibility")
        .time
        .valid_through = 1_020;
    let mut replaced = rejected_evidence;
    replaced
        .eligibility
        .as_mut()
        .expect("eligibility")
        .eligibility_ref = fact("replaced-eligibility");
    let cases = [
        (missing, RejectionReason::MissingEligibility),
        (stale, RejectionReason::EvidenceExpiredOrRevoked),
        (replaced, RejectionReason::EvidenceNotTrusted),
    ];

    for (evidence, reason) in cases {
        assert_eq!(
            core.resolve_frontier(&[(fixture.request.clone(), evidence)]),
            Err(StoreError::DecisionEvidenceUnavailable {
                request_id: request_id.clone(),
                reason,
            })
        );
        assert_eq!(core.receipt(&request_id), Some(&first));
    }

    assert_eq!(
        core.resolve_frontier(std::slice::from_ref(&submission))
            .expect("exact rejected replay remains joinable")
            .remove(0),
        first
    );
}

#[rstest]
fn rejected_no_write_does_not_consume_candidate_or_generation_alias() {
    let fixture = Fixture::new();
    let mut missing = fixture.evidence.clone();
    missing.capacity = None;
    let mut core = fixture.core(vec![time(1_000, 20), time(1_010, 21)], false);
    let rejected = core
        .resolve_frontier(&[(fixture.request.clone(), missing)])
        .expect("missing cut receipt")
        .remove(0);
    assert_eq!(rejected.status(), ReceiptStatus::RejectedNoWrite);

    let mut corrected = fixture.request.clone();
    corrected.request_id = id("request-corrected", LifecycleRequestId::new);
    let accepted = core
        .resolve_frontier(&[(corrected, fixture.evidence)])
        .expect("rejected alias remains free")
        .remove(0);
    assert_eq!(accepted.status(), ReceiptStatus::Accepted);
}

#[rstest]
fn unavailable_or_changed_eligibility_is_error_no_write_and_does_not_reserve_request() {
    type Mutate = fn(&mut UntrustedDecisionEvidence);
    let cases: [(Mutate, RejectionReason); 3] = [
        (
            |evidence| evidence.eligibility = None,
            RejectionReason::MissingEligibility,
        ),
        (
            |evidence| {
                evidence
                    .eligibility
                    .as_mut()
                    .expect("eligibility")
                    .time
                    .valid_through = 1_000;
            },
            RejectionReason::EvidenceExpiredOrRevoked,
        ),
        (
            |evidence| {
                evidence
                    .eligibility
                    .as_mut()
                    .expect("eligibility")
                    .eligibility_ref = fact("replaced-eligibility");
            },
            RejectionReason::EvidenceNotTrusted,
        ),
    ];
    let mut rejected = 0;

    for (mutate, reason) in cases {
        let fixture = Fixture::new();
        let request_id = fixture.request.request_id.clone();
        let mut invalid = fixture.evidence.clone();
        mutate(&mut invalid);
        let mut core = fixture.core(vec![time(1_000, 20), time(1_010, 21)], false);

        assert_eq!(
            core.resolve_frontier(&[(fixture.request.clone(), invalid)]),
            Err(StoreError::DecisionEvidenceUnavailable {
                request_id: request_id.clone(),
                reason,
            })
        );
        assert!(core.receipt(&request_id).is_none());

        let accepted = core
            .resolve_frontier(&[(fixture.request.clone(), fixture.evidence.clone())])
            .expect("authority failure must not reserve the request")
            .remove(0);
        assert_eq!(accepted.status(), ReceiptStatus::Accepted);
        rejected += 1;
    }

    assert_eq!(rejected, 3);
}

#[rstest]
fn authorization_shape_rejects_cross_generation_frontier_and_audience() {
    let mut cases = Vec::new();
    let mut generation = Fixture::new();
    generation
        .evidence
        .autonomous_policy
        .as_mut()
        .expect("policy")
        .generation_id = id("other-generation", GenerationId::new);
    cases.push(generation);

    let mut frontier = Fixture::new();
    frontier
        .evidence
        .autonomous_policy
        .as_mut()
        .expect("policy")
        .revocation_frontier = digest("other-policy-frontier");
    cases.push(frontier);

    let mut audience = Fixture::new();
    audience
        .evidence
        .authorization_lineage
        .as_mut()
        .expect("lineage")
        .audience = "other-audience".to_owned();
    cases.push(audience);

    let mut action = Fixture::new();
    action
        .evidence
        .autonomous_policy
        .as_mut()
        .expect("policy")
        .allowed_action = LifecycleAction::Promotion;
    cases.push(action);

    for fixture in cases {
        assert_eq!(
            fixture.resolve().rejection_reason(),
            Some(RejectionReason::AuthorizationBindingMismatch)
        );
    }
}

#[rstest]
fn causal_order_rejects_future_observation_and_stale_sequence() {
    let mut future = Fixture::new();
    future
        .evidence
        .eligibility
        .as_mut()
        .expect("eligibility")
        .time = time(1_001, 19);
    let request_id = future.request.request_id.clone();
    let mut core = future.core(vec![time(1_000, 20)], false);
    assert_eq!(
        core.resolve_frontier(&[(future.request, future.evidence)]),
        Err(StoreError::DecisionEvidenceUnavailable {
            request_id: request_id.clone(),
            reason: RejectionReason::CausalOrderViolation,
        })
    );
    assert!(core.receipt(&request_id).is_none());

    let mut stale_sequence = Fixture::new();
    stale_sequence
        .evidence
        .capacity
        .as_mut()
        .expect("capacity")
        .time = time(999, 21);
    assert_eq!(
        stale_sequence.resolve().rejection_reason(),
        Some(RejectionReason::CausalOrderViolation)
    );
}

#[rstest]
fn omissions_capacity_live_attended_and_scanner_fail_without_decision() {
    type Omit = fn(&mut UntrustedDecisionEvidence);
    let omissions: [(Omit, RejectionReason); 6] = [
        (
            |evidence| evidence.artifact = None,
            RejectionReason::MissingArtifact,
        ),
        (
            |evidence| evidence.eligibility = None,
            RejectionReason::MissingEligibility,
        ),
        (
            |evidence| evidence.capacity = None,
            RejectionReason::MissingCapacity,
        ),
        (
            |evidence| evidence.adapter_binding = None,
            RejectionReason::MissingAdapterBinding,
        ),
        (
            |evidence| evidence.authorization_lineage = None,
            RejectionReason::MissingAuthorizationLineage,
        ),
        (
            |evidence| evidence.autonomous_policy = None,
            RejectionReason::MissingAutonomousPolicy,
        ),
    ];

    for (omit, expected) in omissions {
        let mut fixture = Fixture::new();
        omit(&mut fixture.evidence);
        if expected == RejectionReason::MissingEligibility {
            let request_id = fixture.request.request_id.clone();
            let mut core = fixture.core(vec![time(1_000, 20)], false);
            assert_eq!(
                core.resolve_frontier(&[(fixture.request, fixture.evidence)]),
                Err(StoreError::DecisionEvidenceUnavailable {
                    request_id: request_id.clone(),
                    reason: expected,
                })
            );
            assert!(core.receipt(&request_id).is_none());
        } else {
            let receipt = fixture.resolve();
            assert_eq!(receipt.rejection_reason(), Some(expected));
            assert!(receipt.decision().is_none());
        }
    }

    let mut rejected_modes: Vec<(Fixture, RejectionReason)> = Vec::new();
    let mut too_large = Fixture::new();
    too_large.request.requested_capital = 51;
    rejected_modes.push((too_large, RejectionReason::CapitalExceedsEligibility));
    let mut live = Fixture::new();
    live.request.execution_scope.mode = ExecutionMode::Live;
    rejected_modes.push((live, RejectionReason::LiveNotAdmitted));
    let mut attended = Fixture::new();
    attended.request.authorization_mode = AuthorizationMode::AttendedRequest;
    rejected_modes.push((attended, RejectionReason::AttendedNotAdmitted));
    let mut scanner = Fixture::new();
    scanner.request.activation_condition = ActivationCondition::ScannerConditional {
        condition_version: "scanner-v1".to_owned(),
    };
    rejected_modes.push((scanner, RejectionReason::ConditionalScannerNotAdmitted));

    for (fixture, expected) in rejected_modes {
        let receipt = fixture.resolve();
        assert_eq!(receipt.rejection_reason(), Some(expected));
        assert!(receipt.decision().is_none());
    }
}

#[rstest]
fn stale_revoked_cross_scope_and_capacity_cuts_fail_closed() {
    let mut authority_cases = Vec::new();

    let mut stale = Fixture::new();
    stale
        .evidence
        .eligibility
        .as_mut()
        .expect("eligibility")
        .time
        .valid_through = 999;
    authority_cases.push((stale, RejectionReason::EvidenceExpiredOrRevoked));

    let mut equal_exclusive_boundary = Fixture::new();
    let eligibility = equal_exclusive_boundary
        .evidence
        .eligibility
        .as_mut()
        .expect("eligibility");
    eligibility.time.valid_through = eligibility.time.observed_at;
    authority_cases.push((
        equal_exclusive_boundary,
        RejectionReason::CausalOrderViolation,
    ));

    for (fixture, reason) in authority_cases {
        let request_id = fixture.request.request_id.clone();
        let mut core = fixture.core(vec![time(1_000, 20)], false);
        assert_eq!(
            core.resolve_frontier(&[(fixture.request, fixture.evidence)]),
            Err(StoreError::DecisionEvidenceUnavailable {
                request_id: request_id.clone(),
                reason,
            })
        );
        assert!(core.receipt(&request_id).is_none());
    }

    let mut cases = Vec::new();

    let mut revoked = Fixture::new();
    revoked
        .evidence
        .authorization_lineage
        .as_mut()
        .expect("lineage")
        .revoked = true;
    cases.push((revoked, RejectionReason::EvidenceExpiredOrRevoked));

    let mut cross_scope = Fixture::new();
    cross_scope
        .evidence
        .capacity
        .as_mut()
        .expect("capacity")
        .account_id = id("other-account", AccountId::new);
    cases.push((cross_scope, RejectionReason::CrossScopeMismatch));

    let mut non_neutral = Fixture::new();
    non_neutral
        .evidence
        .capacity
        .as_mut()
        .expect("capacity")
        .candidate_neutral = false;
    cases.push((non_neutral, RejectionReason::CapacityNotCandidateNeutral));

    let mut gross_bound = Fixture::new();
    gross_bound.request.requested_capital = 61;
    gross_bound
        .evidence
        .eligibility
        .as_mut()
        .expect("eligibility")
        .capacity_ceiling = 70;
    cases.push((gross_bound, RejectionReason::CapitalExceedsCapacity));

    for (fixture, expected) in cases {
        let receipt = fixture.resolve();
        assert_eq!(receipt.status(), ReceiptStatus::RejectedNoWrite);
        assert_eq!(receipt.rejection_reason(), Some(expected));
        assert!(receipt.decision().is_none());
    }
}

#[rstest]
fn accepted_candidate_or_generation_alias_retry_is_rejected() {
    let fixture = Fixture::new();
    let mut core = fixture.core(vec![time(1_000, 20), time(1_010, 21)], false);
    core.resolve_frontier(&[(fixture.request.clone(), fixture.evidence.clone())])
        .expect("first accepted request");

    let mut retry = fixture.request.clone();
    retry.request_id = id("request-alias", LifecycleRequestId::new);
    retry.decision_frontier_id = id("frontier-alias", DecisionFrontierId::new);
    assert!(matches!(
        core.resolve_frontier(&[(retry, fixture.evidence)]),
        Err(StoreError::AliasRetry { .. })
    ));
}

#[rstest]
fn runtime_readback_requires_private_owner_admission_before_application_projection() {
    let fixture = Fixture::new();
    let unavailable_runtime_admission = fixture.core(vec![time(1_070, 32)], false);
    let mut core = fixture.core(
        vec![
            time(1_000, 20),
            time(1_050, 30),
            time(1_060, 31),
            time(1_070, 32),
            time(1_080, 33),
        ],
        true,
    );
    let receipt = core
        .resolve_frontier(&[(fixture.request, fixture.evidence)])
        .expect("accepted")
        .remove(0);
    let decision = receipt.decision().expect("decision");
    let runtime = UntrustedRuntimeApplicationReadback {
        receipt_id: id("runtime-1", RuntimeReceiptId::new),
        receipt_ref: fact("runtime-fact-1"),
        decision_digest: decision.decision_digest(),
        decision_frontier_id: decision.decision_frontier_id().clone(),
        generation_id: decision.generation_id().clone(),
        execution_scope_digest: decision.execution_scope().semantic_digest(),
        principal_id: decision.principal_id().clone(),
        request_scope_id: decision.request_scope_id().clone(),
        authorization_lineage_ref: decision.authorization_lineage_ref().clone(),
        autonomous_policy_ref: decision.autonomous_policy_ref().clone(),
        autonomous_policy_revocation_frontier: decision
            .autonomous_policy()
            .readback()
            .revocation_frontier,
        disposition: RuntimeApplicationDisposition::Applied,
        time: time(1_010, 21),
    };
    let untrusted = unavailable_runtime_admission.view(&receipt, Some(&runtime));
    assert_eq!(
        untrusted.application_status(),
        ApplicationStatus::ApplicationUnknown
    );
    let applied = core.view(&receipt, Some(&runtime));
    assert_eq!(applied.application_status(), ApplicationStatus::Applied);
    assert_eq!(applied.freshness(), ViewFreshness::Unavailable);
    assert_eq!(applied.availability(), ViewAvailability::Unavailable);
    assert_eq!(applied.source_frontier(), None);

    let mut before_decision = runtime.clone();
    before_decision.time = time(999, 21);
    assert_eq!(
        core.view(&receipt, Some(&before_decision))
            .application_status(),
        ApplicationStatus::ApplicationUnknown
    );

    let mut cross_frontier = runtime;
    cross_frontier.decision_frontier_id = id("other-frontier", DecisionFrontierId::new);
    assert_eq!(
        core.view(&receipt, Some(&cross_frontier))
            .application_status(),
        ApplicationStatus::ApplicationUnknown
    );
}

#[rstest]
fn duplicate_complete_comparator_key_is_terminal_no_write_for_every_permutation_and_replay() {
    let fixture = Fixture::new();
    let mut request_a = fixture.request.clone();
    request_a.request_id = id("request-a", LifecycleRequestId::new);
    let mut request_b = fixture.request.clone();
    request_b.request_id = id("request-b", LifecycleRequestId::new);
    let forward = [
        (request_a.clone(), fixture.evidence.clone()),
        (request_b.clone(), fixture.evidence.clone()),
    ];
    let reverse = [
        (request_b, fixture.evidence.clone()),
        (request_a, fixture.evidence.clone()),
    ];

    let mut forward_core = fixture.core(
        vec![time(1_000, 20), time(1_010, 21), time(1_020, 22)],
        false,
    );
    let forward_receipts = forward_core
        .resolve_frontier(&forward)
        .expect("same-rank frontier resolves");
    let forward_a = forward_receipts
        .iter()
        .find(|receipt| receipt.request_id().as_str() == "request-a")
        .expect("request-a receipt")
        .clone();
    let forward_b = forward_receipts
        .iter()
        .find(|receipt| receipt.request_id().as_str() == "request-b")
        .expect("request-b receipt")
        .clone();
    assert!(
        forward_receipts
            .iter()
            .all(|receipt| receipt.status() == ReceiptStatus::RejectedNoWrite)
    );
    assert!(forward_receipts.iter().all(|receipt| {
        receipt.rejection_reason() == Some(RejectionReason::InputIncompleteNoWrite)
    }));
    assert!(
        forward_receipts
            .iter()
            .all(|receipt| receipt.decision().is_none())
    );
    assert_eq!(
        forward_a.rejection_reason(),
        Some(RejectionReason::InputIncompleteNoWrite)
    );
    assert_eq!(
        forward_b.rejection_reason(),
        Some(RejectionReason::InputIncompleteNoWrite)
    );

    let mut reverse_core = fixture.core(vec![time(1_000, 20)], false);
    let reverse_receipts = reverse_core
        .resolve_frontier(&reverse)
        .expect("permuted same-rank frontier resolves");
    let reverse_a = reverse_receipts
        .iter()
        .find(|receipt| receipt.request_id().as_str() == "request-a")
        .expect("request-a receipt");
    let reverse_b = reverse_receipts
        .iter()
        .find(|receipt| receipt.request_id().as_str() == "request-b")
        .expect("request-b receipt");
    assert_eq!(reverse_a, &forward_a);
    assert_eq!(reverse_b, &forward_b);
    assert!(
        reverse_receipts
            .iter()
            .all(|receipt| receipt.status() == ReceiptStatus::RejectedNoWrite)
    );
    assert!(
        reverse_receipts
            .iter()
            .all(|receipt| receipt.decision().is_none())
    );

    let replay = forward_core
        .resolve_frontier(&reverse)
        .expect("exact set replay accepts a permutation");
    assert_eq!(replay, vec![forward_b, forward_a]);
    assert!(
        replay
            .iter()
            .all(|receipt| receipt.status() == ReceiptStatus::RejectedNoWrite)
    );
    assert!(replay.iter().all(|receipt| receipt.decision().is_none()));

    assert_eq!(
        forward_core.resolve_frontier(&[forward[0].clone()]),
        Err(StoreError::ReplaySetMismatch(
            fixture.request.decision_frontier_id
        ))
    );
}

#[rstest]
fn conflict_priority_is_stable() {
    assert!(LifecycleAction::Recovery.priority() > LifecycleAction::Retirement.priority());
    assert!(LifecycleAction::Retirement.priority() > LifecycleAction::Pause.priority());
    assert!(LifecycleAction::Pause.priority() > LifecycleAction::DeRisk.priority());
    assert!(LifecycleAction::DeRisk.priority() > LifecycleAction::Reduction.priority());
    assert!(LifecycleAction::Reduction.priority() > LifecycleAction::Promotion.priority());
    assert!(LifecycleAction::Promotion.priority() > LifecycleAction::InitialActivation.priority());
}
