use std::fmt::Display;

use crate::Digest;

macro_rules! identifier {
    ($name:ident) => {
        #[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
        pub struct $name(String);

        impl $name {
            /// Creates a bounded, whitespace-free opaque identity.
            ///
            /// # Errors
            ///
            /// Returns an error for empty, overlong, or whitespace-containing input.
            pub fn new(value: impl Into<String>) -> Result<Self, &'static str> {
                let value = value.into();
                if value.is_empty() || value.len() > 200 || value.chars().any(char::is_whitespace) {
                    return Err("identity must be 1..=200 non-whitespace characters");
                }
                Ok(Self(value))
            }

            #[must_use]
            pub fn as_str(&self) -> &str {
                &self.0
            }
        }

        impl Display for $name {
            fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str(&self.0)
            }
        }
    };
}

identifier!(LifecycleRequestId);
identifier!(CandidateId);
identifier!(GenerationId);
identifier!(ArtifactId);
identifier!(PrincipalId);
identifier!(RequestScopeId);
identifier!(ShellBindingId);
identifier!(ManifestId);
identifier!(AccountId);
identifier!(CapacityScopeId);
identifier!(AdapterBindingId);
identifier!(DecisionFrontierId);
identifier!(RuntimeReceiptId);
identifier!(EconomicConditionsVersion);
identifier!(TimeSourceFrontierId);
identifier!(QualificationSourceFrontier);

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FactRef {
    pub id: String,
    pub digest: Digest,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TimeEvidence {
    pub clock_epoch: String,
    pub monotonic_sequence: u64,
    pub observed_at: u64,
    pub valid_through: u64,
    pub source_frontier: TimeSourceFrontierId,
}

impl TimeEvidence {
    #[must_use]
    pub const fn is_current_at(&self, now: u64) -> bool {
        self.observed_at <= now && now < self.valid_through
    }

    #[must_use]
    pub fn semantic_digest(&self) -> Digest {
        Digest::of_domain_fields(
            "governance-time-evidence-v1",
            &[
                &self.clock_epoch,
                &self.monotonic_sequence.to_string(),
                &self.observed_at.to_string(),
                &self.valid_through.to_string(),
                self.source_frontier.as_str(),
            ],
        )
    }

    #[must_use]
    pub const fn is_observed_before_or_at(&self, later: &Self) -> bool {
        self.observed_at <= later.observed_at
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum LifecycleAction {
    InitialActivation,
    Promotion,
    Reduction,
    Pause,
    Retirement,
    DeRisk,
    Recovery,
}

impl LifecycleAction {
    #[must_use]
    pub const fn priority(self) -> u8 {
        match self {
            Self::InitialActivation => 0,
            Self::Promotion => 1,
            Self::Reduction => 2,
            Self::DeRisk => 3,
            Self::Pause => 4,
            Self::Retirement => 5,
            Self::Recovery => 6,
        }
    }

    pub(crate) const fn tag(self) -> &'static str {
        match self {
            Self::InitialActivation => "INITIAL_ACTIVATION",
            Self::Promotion => "PROMOTION",
            Self::Reduction => "REDUCTION",
            Self::Pause => "PAUSE",
            Self::Retirement => "RETIREMENT",
            Self::DeRisk => "DE_RISK",
            Self::Recovery => "RECOVERY",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ExecutionMode {
    Paper,
    Live,
}

impl ExecutionMode {
    pub(crate) const fn tag(self) -> &'static str {
        match self {
            Self::Paper => "PAPER",
            Self::Live => "LIVE",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AuthorizationMode {
    AttendedRequest,
    UnattendedRequestWithPolicy,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AllowedIntentClass {
    PaperAddRisk,
    DecreaseOnly,
}

impl AllowedIntentClass {
    pub(crate) const fn tag(self) -> &'static str {
        match self {
            Self::PaperAddRisk => "PAPER_ADD_RISK",
            Self::DecreaseOnly => "DECREASE_ONLY",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RevalidationBoundary {
    F0RepositoryNativeOwnerAdmissionContract,
}

impl RevalidationBoundary {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::F0RepositoryNativeOwnerAdmissionContract => {
                "F0_REPOSITORY_NATIVE_OWNER_ADMISSION_CONTRACT"
            }
        }
    }
}

impl AuthorizationMode {
    pub(crate) const fn tag(self) -> &'static str {
        match self {
            Self::AttendedRequest => "ATTENDED_REQUEST",
            Self::UnattendedRequestWithPolicy => "UNATTENDED_REQUEST_WITH_POLICY",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ActivationCondition {
    Unconditional,
    ScannerConditional { condition_version: String },
}

impl ActivationCondition {
    pub(crate) fn semantic_value(&self) -> String {
        match self {
            Self::Unconditional => "UNCONDITIONAL".to_owned(),
            Self::ScannerConditional { condition_version } => {
                format!("SCANNER_CONDITIONAL:{condition_version}")
            }
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ExecutionScope {
    pub mode: ExecutionMode,
    pub account_id: AccountId,
    pub effect_namespace: String,
    pub capacity_scope_id: CapacityScopeId,
    pub adapter_binding_id: AdapterBindingId,
    pub endpoint_id: String,
    pub capability_digest: Digest,
    pub trust_policy_digest: Digest,
    pub reduce_only_policy_digest: Digest,
    pub credential_handle_ref: String,
}

impl ExecutionScope {
    /// Canonical semantic digest retained by decisions and Runtime receipts.
    #[must_use]
    pub fn semantic_digest(&self) -> Digest {
        Digest::of_domain_fields(
            "governance-execution-scope-v1",
            &[
                self.mode.tag(),
                self.account_id.as_str(),
                &self.effect_namespace,
                self.capacity_scope_id.as_str(),
                self.adapter_binding_id.as_str(),
                &self.endpoint_id,
                &self.capability_digest.to_hex(),
                &self.trust_policy_digest.to_hex(),
                &self.reduce_only_policy_digest.to_hex(),
                &self.credential_handle_ref,
            ],
        )
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LifecycleRequest {
    pub request_id: LifecycleRequestId,
    pub decision_frontier_id: DecisionFrontierId,
    pub principal_id: PrincipalId,
    pub request_scope_id: RequestScopeId,
    pub shell_binding_id: ShellBindingId,
    pub history_head_authorization: FactRef,
    pub operation_manifest_id: ManifestId,
    pub operation_schema: String,
    pub target_owner: String,
    pub operator_issuer: String,
    pub operator_audience: String,
    pub operator_revocation_frontier: Digest,
    pub request_proof_digest: Digest,
    pub autonomous_policy_issuer: String,
    pub autonomous_policy_audience: String,
    pub autonomous_policy_revocation_frontier: Digest,
    pub authorization_mode: AuthorizationMode,
    pub action: LifecycleAction,
    pub candidate_id: CandidateId,
    pub generation_id: GenerationId,
    pub artifact_id: ArtifactId,
    pub economic_conditions_version: EconomicConditionsVersion,
    pub execution_scope: ExecutionScope,
    pub activation_condition: ActivationCondition,
    pub requested_capital: u64,
    pub capital_policy_ref: FactRef,
    pub allowed_intent_class: AllowedIntentClass,
    pub contender_generation_ids: Vec<GenerationId>,
    pub submitted_time: TimeEvidence,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SemanticIdentity {
    pub semantic_digest: Digest,
    pub alias_digest: Digest,
}

impl LifecycleRequest {
    #[must_use]
    pub fn semantic_identity(&self) -> SemanticIdentity {
        let requested_capital = self.requested_capital.to_string();
        let contender_fields = self
            .contender_generation_ids
            .iter()
            .map(GenerationId::as_str)
            .collect::<Vec<_>>();
        let contenders =
            Digest::of_domain_fields("governance-contender-set-v1", &contender_fields).to_hex();
        let activation_condition = self.activation_condition.semantic_value();
        let sequence = self.submitted_time.monotonic_sequence.to_string();
        let observed_at = self.submitted_time.observed_at.to_string();
        let valid_through = self.submitted_time.valid_through.to_string();
        let scope_digest = self.execution_scope.semantic_digest().to_hex();
        let history_digest = self.history_head_authorization.digest.to_hex();
        let capital_policy_digest = self.capital_policy_ref.digest.to_hex();
        let source_frontier = self.submitted_time.source_frontier.as_str();
        let common = [
            self.principal_id.as_str(),
            self.request_scope_id.as_str(),
            self.shell_binding_id.as_str(),
            &self.history_head_authorization.id,
            &history_digest,
            self.operation_manifest_id.as_str(),
            &self.operation_schema,
            &self.target_owner,
            &self.operator_issuer,
            &self.operator_audience,
            &self.operator_revocation_frontier.to_hex(),
            &self.request_proof_digest.to_hex(),
            &self.autonomous_policy_issuer,
            &self.autonomous_policy_audience,
            &self.autonomous_policy_revocation_frontier.to_hex(),
            self.authorization_mode.tag(),
            self.action.tag(),
            self.candidate_id.as_str(),
            self.generation_id.as_str(),
            self.artifact_id.as_str(),
            self.economic_conditions_version.as_str(),
            &scope_digest,
            &activation_condition,
            &requested_capital,
            &self.capital_policy_ref.id,
            &capital_policy_digest,
            self.allowed_intent_class.tag(),
            &contenders,
            &self.submitted_time.clock_epoch,
            &sequence,
            &observed_at,
            &valid_through,
            source_frontier,
        ];
        let alias_digest =
            Digest::of_domain_fields("governance-lifecycle-request-alias-v1", &common);
        let semantic_digest = Digest::of_domain_fields(
            "governance-lifecycle-request-semantic-v1",
            &[
                self.request_id.as_str(),
                self.decision_frontier_id.as_str(),
                &alias_digest.to_hex(),
            ],
        );
        SemanticIdentity {
            semantic_digest,
            alias_digest,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct UntrustedAuthorizationLineageReadback {
    pub lineage_ref: FactRef,
    pub principal_id: PrincipalId,
    pub request_scope_id: RequestScopeId,
    pub shell_binding_id: ShellBindingId,
    pub history_head_authorization: FactRef,
    pub operation_manifest_id: ManifestId,
    pub authorization_mode: AuthorizationMode,
    pub issuer: String,
    pub audience: String,
    pub target_owner: String,
    pub operation_schema: String,
    pub revocation_frontier: Digest,
    pub request_proof_digest: Digest,
    pub time: TimeEvidence,
    pub revoked: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct UntrustedAutonomousPolicyReadback {
    pub policy_ref: FactRef,
    pub principal_id: PrincipalId,
    pub request_scope_id: RequestScopeId,
    pub account_id: AccountId,
    pub execution_mode: ExecutionMode,
    pub generation_id: GenerationId,
    pub execution_scope_digest: Digest,
    pub allowed_action: LifecycleAction,
    pub allowed_intent_class: AllowedIntentClass,
    pub capital_policy_ref: FactRef,
    pub operation_manifest_id: ManifestId,
    pub issuer: String,
    pub audience: String,
    pub target_owner: String,
    pub revocation_frontier: Digest,
    pub time: TimeEvidence,
    pub revoked: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct UntrustedArtifactReadback {
    pub artifact_ref: FactRef,
    pub artifact_id: ArtifactId,
    pub candidate_id: CandidateId,
    pub generation_id: GenerationId,
    pub runtime_abi_digest: Digest,
    pub compatibility_digest: Digest,
    pub complete: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EligibilityState {
    Qualified,
    Ineligible,
    Expired,
    Revoked,
    Unknown,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct UntrustedEligibilityReadback {
    pub eligibility_ref: FactRef,
    pub state: EligibilityState,
    pub artifact_id: ArtifactId,
    pub candidate_id: CandidateId,
    pub economic_conditions_version: EconomicConditionsVersion,
    pub evaluated_capacity_model: String,
    pub capacity_ceiling: u64,
    pub effective_from: u64,
    pub effective_through: u64,
    pub qualification_frontier: QualificationSourceFrontier,
    pub revocation_frontier: Digest,
    pub time_evidence_ref: FactRef,
    pub time: TimeEvidence,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct UntrustedCapacityViewReadback {
    pub capacity_ref: FactRef,
    pub capacity_scope_id: CapacityScopeId,
    pub account_id: AccountId,
    pub execution_mode: ExecutionMode,
    pub gross_ceiling: u64,
    pub candidate_neutral: bool,
    pub bound: bool,
    pub time: TimeEvidence,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct UntrustedAdapterBindingReadback {
    pub binding_ref: FactRef,
    pub execution_scope: ExecutionScope,
    pub admitted: bool,
    pub time: TimeEvidence,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct UntrustedDecisionEvidence {
    pub artifact: Option<UntrustedArtifactReadback>,
    pub eligibility: Option<UntrustedEligibilityReadback>,
    pub capacity: Option<UntrustedCapacityViewReadback>,
    pub adapter_binding: Option<UntrustedAdapterBindingReadback>,
    pub authorization_lineage: Option<UntrustedAuthorizationLineageReadback>,
    pub autonomous_policy: Option<UntrustedAutonomousPolicyReadback>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RuntimeApplicationDisposition {
    Applied,
    RejectedNoInstance,
    ApplicationUnknown,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct UntrustedRuntimeApplicationReadback {
    pub receipt_id: RuntimeReceiptId,
    pub receipt_ref: FactRef,
    pub decision_digest: Digest,
    pub decision_frontier_id: DecisionFrontierId,
    pub generation_id: GenerationId,
    pub execution_scope_digest: Digest,
    pub principal_id: PrincipalId,
    pub request_scope_id: RequestScopeId,
    pub authorization_lineage_ref: FactRef,
    pub autonomous_policy_ref: FactRef,
    pub autonomous_policy_revocation_frontier: Digest,
    pub disposition: RuntimeApplicationDisposition,
    pub time: TimeEvidence,
}

macro_rules! verified_cut {
    ($name:ident, $payload:ty) => {
        /// Governance-verified wrapper. Only the validator can construct it.
        #[derive(Clone, Debug, PartialEq, Eq)]
        pub struct $name($payload);

        impl $name {
            pub(crate) fn verified(payload: $payload) -> Self {
                Self(payload)
            }

            #[must_use]
            pub fn readback(&self) -> &$payload {
                &self.0
            }
        }
    };
}

verified_cut!(VerifiedArtifact, UntrustedArtifactReadback);
verified_cut!(VerifiedEligibility, UntrustedEligibilityReadback);
verified_cut!(VerifiedCapacityView, UntrustedCapacityViewReadback);
verified_cut!(VerifiedAdapterBinding, UntrustedAdapterBindingReadback);
verified_cut!(
    VerifiedAuthorizationLineage,
    UntrustedAuthorizationLineageReadback
);
verified_cut!(VerifiedAutonomousPolicy, UntrustedAutonomousPolicyReadback);
verified_cut!(
    VerifiedRuntimeApplicationReceipt,
    UntrustedRuntimeApplicationReadback
);

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct VerifiedDecisionCuts {
    pub(crate) artifact: VerifiedArtifact,
    pub(crate) eligibility: VerifiedEligibility,
    pub(crate) capacity: VerifiedCapacityView,
    pub(crate) adapter_binding: VerifiedAdapterBinding,
    pub(crate) authorization_lineage: VerifiedAuthorizationLineage,
    pub(crate) autonomous_policy: VerifiedAutonomousPolicy,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AuthorizedGenerationDecision {
    request_id: LifecycleRequestId,
    semantic_digest: Digest,
    decision_digest: Digest,
    action: LifecycleAction,
    candidate_id: CandidateId,
    generation_id: GenerationId,
    execution_scope: ExecutionScope,
    requested_capital: u64,
    activation_condition: ActivationCondition,
    contender_generation_ids: Vec<GenerationId>,
    economic_conditions_version: EconomicConditionsVersion,
    decision_frontier_id: DecisionFrontierId,
    principal_id: PrincipalId,
    request_scope_id: RequestScopeId,
    decision_time: TimeEvidence,
    revalidate_after: u64,
    request_time: TimeEvidence,
    cuts: VerifiedDecisionCuts,
}

impl AuthorizedGenerationDecision {
    pub(crate) fn issue(
        request: &LifecycleRequest,
        semantic_digest: Digest,
        decision_time: TimeEvidence,
        revalidate_after: u64,
        cuts: VerifiedDecisionCuts,
    ) -> Self {
        let requested_capital = request.requested_capital.to_string();
        let decided_at_text = decision_time.observed_at.to_string();
        let revalidate_after_text = revalidate_after.to_string();
        let decision_digest = Digest::of_domain_fields(
            "governance-authorized-generation-decision-v1",
            &[
                request.request_id.as_str(),
                &semantic_digest.to_hex(),
                request.action.tag(),
                request.generation_id.as_str(),
                &request.execution_scope.semantic_digest().to_hex(),
                &requested_capital,
                request.decision_frontier_id.as_str(),
                &decided_at_text,
                &decision_time.semantic_digest().to_hex(),
                &revalidate_after_text,
                &cuts.artifact.0.artifact_ref.id,
                &cuts.artifact.0.artifact_ref.digest.to_hex(),
                &cuts.eligibility.0.eligibility_ref.id,
                &cuts.eligibility.0.eligibility_ref.digest.to_hex(),
                &cuts.eligibility.0.revocation_frontier.to_hex(),
                &cuts.eligibility.0.time.semantic_digest().to_hex(),
                &cuts.capacity.0.capacity_ref.id,
                &cuts.capacity.0.capacity_ref.digest.to_hex(),
                &cuts.capacity.0.time.semantic_digest().to_hex(),
                &cuts.adapter_binding.0.binding_ref.id,
                &cuts.adapter_binding.0.binding_ref.digest.to_hex(),
                &cuts.adapter_binding.0.time.semantic_digest().to_hex(),
                &cuts.authorization_lineage.0.lineage_ref.id,
                &cuts.authorization_lineage.0.lineage_ref.digest.to_hex(),
                &cuts.authorization_lineage.0.revocation_frontier.to_hex(),
                &cuts.authorization_lineage.0.time.semantic_digest().to_hex(),
                &cuts.autonomous_policy.0.policy_ref.id,
                &cuts.autonomous_policy.0.policy_ref.digest.to_hex(),
                &cuts.autonomous_policy.0.revocation_frontier.to_hex(),
                &cuts.autonomous_policy.0.time.semantic_digest().to_hex(),
            ],
        );
        Self {
            request_id: request.request_id.clone(),
            semantic_digest,
            decision_digest,
            action: request.action,
            candidate_id: request.candidate_id.clone(),
            generation_id: request.generation_id.clone(),
            execution_scope: request.execution_scope.clone(),
            requested_capital: request.requested_capital,
            activation_condition: request.activation_condition.clone(),
            contender_generation_ids: request.contender_generation_ids.clone(),
            economic_conditions_version: request.economic_conditions_version.clone(),
            decision_frontier_id: request.decision_frontier_id.clone(),
            principal_id: request.principal_id.clone(),
            request_scope_id: request.request_scope_id.clone(),
            decision_time,
            revalidate_after,
            request_time: request.submitted_time.clone(),
            cuts,
        }
    }

    #[must_use]
    pub fn request_id(&self) -> &LifecycleRequestId {
        &self.request_id
    }
    #[must_use]
    pub const fn semantic_digest(&self) -> Digest {
        self.semantic_digest
    }
    #[must_use]
    pub const fn decision_digest(&self) -> Digest {
        self.decision_digest
    }
    #[must_use]
    pub const fn action(&self) -> LifecycleAction {
        self.action
    }
    #[must_use]
    pub fn candidate_id(&self) -> &CandidateId {
        &self.candidate_id
    }
    #[must_use]
    pub fn generation_id(&self) -> &GenerationId {
        &self.generation_id
    }
    #[must_use]
    pub fn execution_scope(&self) -> &ExecutionScope {
        &self.execution_scope
    }
    #[must_use]
    pub const fn requested_capital(&self) -> u64 {
        self.requested_capital
    }
    #[must_use]
    pub fn activation_condition(&self) -> &ActivationCondition {
        &self.activation_condition
    }
    #[must_use]
    pub fn contender_generation_ids(&self) -> &[GenerationId] {
        &self.contender_generation_ids
    }
    #[must_use]
    pub fn contender_membership_digest(&self) -> Digest {
        let members = self
            .contender_generation_ids
            .iter()
            .map(GenerationId::as_str)
            .collect::<Vec<_>>();
        Digest::of_domain_fields("governance-contender-set-v1", &members)
    }
    #[must_use]
    pub fn economic_conditions_version(&self) -> &EconomicConditionsVersion {
        &self.economic_conditions_version
    }
    #[must_use]
    pub fn decision_frontier_id(&self) -> &DecisionFrontierId {
        &self.decision_frontier_id
    }
    #[must_use]
    pub fn principal_id(&self) -> &PrincipalId {
        &self.principal_id
    }
    #[must_use]
    pub fn request_scope_id(&self) -> &RequestScopeId {
        &self.request_scope_id
    }
    #[must_use]
    pub fn decision_time(&self) -> &TimeEvidence {
        &self.decision_time
    }
    #[must_use]
    pub const fn revalidate_after(&self) -> u64 {
        self.revalidate_after
    }
    #[must_use]
    pub fn request_time(&self) -> &TimeEvidence {
        &self.request_time
    }
    #[must_use]
    pub fn artifact_ref(&self) -> &FactRef {
        &self.cuts.artifact.0.artifact_ref
    }
    #[must_use]
    pub fn eligibility_ref(&self) -> &FactRef {
        &self.cuts.eligibility.0.eligibility_ref
    }
    #[must_use]
    pub fn capacity_ref(&self) -> &FactRef {
        &self.cuts.capacity.0.capacity_ref
    }
    #[must_use]
    pub fn adapter_binding_ref(&self) -> &FactRef {
        &self.cuts.adapter_binding.0.binding_ref
    }
    #[must_use]
    pub fn authorization_lineage_ref(&self) -> &FactRef {
        &self.cuts.authorization_lineage.0.lineage_ref
    }
    #[must_use]
    pub fn autonomous_policy_ref(&self) -> &FactRef {
        &self.cuts.autonomous_policy.0.policy_ref
    }
    #[must_use]
    pub fn artifact(&self) -> &VerifiedArtifact {
        &self.cuts.artifact
    }
    #[must_use]
    pub fn eligibility(&self) -> &VerifiedEligibility {
        &self.cuts.eligibility
    }
    #[must_use]
    pub fn capacity(&self) -> &VerifiedCapacityView {
        &self.cuts.capacity
    }
    #[must_use]
    pub fn adapter_binding(&self) -> &VerifiedAdapterBinding {
        &self.cuts.adapter_binding
    }
    #[must_use]
    pub fn authorization_lineage(&self) -> &VerifiedAuthorizationLineage {
        &self.cuts.authorization_lineage
    }
    #[must_use]
    pub fn autonomous_policy(&self) -> &VerifiedAutonomousPolicy {
        &self.cuts.autonomous_policy
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ReceiptStatus {
    Accepted,
    RejectedNoWrite,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RejectionReason {
    ConflictLost,
    ActionNotAdmittedInStaticSlice,
    LiveNotAdmitted,
    AttendedNotAdmitted,
    ConditionalScannerNotAdmitted,
    ContenderSetNotSingle,
    MissingArtifact,
    MissingEligibility,
    MissingCapacity,
    MissingAdapterBinding,
    MissingAuthorizationLineage,
    MissingAutonomousPolicy,
    ArtifactNotComplete,
    EvidenceNotTrusted,
    EvidenceExpiredOrRevoked,
    CrossScopeMismatch,
    CapacityNotCandidateNeutral,
    CapacityNotBound,
    CapitalExceedsEligibility,
    CapitalExceedsCapacity,
    SourceOwnerAdmissionUnavailable,
    FrontierContainsInvalidContender,
    InputIncompleteNoWrite,
    AuthorizationBindingMismatch,
    CausalOrderViolation,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LifecycleRequestReceipt {
    request_id: LifecycleRequestId,
    semantic_digest: Digest,
    status: ReceiptStatus,
    rejection_reason: Option<RejectionReason>,
    selected_action: LifecycleAction,
    decision_frontier_id: DecisionFrontierId,
    principal_id: PrincipalId,
    request_scope_id: RequestScopeId,
    receipt_time: TimeEvidence,
    decision: Option<AuthorizedGenerationDecision>,
}

impl LifecycleRequestReceipt {
    pub(crate) fn accepted(
        request: &LifecycleRequest,
        identity: SemanticIdentity,
        decision: AuthorizedGenerationDecision,
        receipt_time: TimeEvidence,
    ) -> Self {
        Self {
            request_id: request.request_id.clone(),
            semantic_digest: identity.semantic_digest,
            status: ReceiptStatus::Accepted,
            rejection_reason: None,
            selected_action: request.action,
            decision_frontier_id: request.decision_frontier_id.clone(),
            principal_id: request.principal_id.clone(),
            request_scope_id: request.request_scope_id.clone(),
            receipt_time,
            decision: Some(decision),
        }
    }

    pub(crate) fn rejected(
        request: &LifecycleRequest,
        identity: SemanticIdentity,
        reason: RejectionReason,
        selected_action: LifecycleAction,
        receipt_time: TimeEvidence,
    ) -> Self {
        Self {
            request_id: request.request_id.clone(),
            semantic_digest: identity.semantic_digest,
            status: ReceiptStatus::RejectedNoWrite,
            rejection_reason: Some(reason),
            selected_action,
            decision_frontier_id: request.decision_frontier_id.clone(),
            principal_id: request.principal_id.clone(),
            request_scope_id: request.request_scope_id.clone(),
            receipt_time,
            decision: None,
        }
    }

    #[must_use]
    pub fn request_id(&self) -> &LifecycleRequestId {
        &self.request_id
    }
    #[must_use]
    pub const fn semantic_digest(&self) -> Digest {
        self.semantic_digest
    }
    #[must_use]
    pub const fn status(&self) -> ReceiptStatus {
        self.status
    }
    #[must_use]
    pub const fn rejection_reason(&self) -> Option<RejectionReason> {
        self.rejection_reason
    }
    #[must_use]
    pub const fn selected_action(&self) -> LifecycleAction {
        self.selected_action
    }
    #[must_use]
    pub fn decision_frontier_id(&self) -> &DecisionFrontierId {
        &self.decision_frontier_id
    }
    #[must_use]
    pub fn principal_id(&self) -> &PrincipalId {
        &self.principal_id
    }
    #[must_use]
    pub fn request_scope_id(&self) -> &RequestScopeId {
        &self.request_scope_id
    }
    #[must_use]
    pub fn receipt_time(&self) -> &TimeEvidence {
        &self.receipt_time
    }
    #[must_use]
    pub fn decision(&self) -> Option<&AuthorizedGenerationDecision> {
        self.decision.as_ref()
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ApplicationStatus {
    Applied,
    RejectedNoInstance,
    ApplicationUnknown,
}

impl ApplicationStatus {
    const fn tag(self) -> &'static str {
        match self {
            Self::Applied => "APPLIED",
            Self::RejectedNoInstance => "REJECTED_NO_INSTANCE",
            Self::ApplicationUnknown => "APPLICATION_UNKNOWN",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ViewAvailability {
    Available,
    Stale,
    Unavailable,
}

impl ViewAvailability {
    const fn tag(self) -> &'static str {
        match self {
            Self::Available => "AVAILABLE",
            Self::Stale => "STALE",
            Self::Unavailable => "UNAVAILABLE",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ViewFreshness {
    Current,
    Stale,
    Unavailable,
}

impl ViewFreshness {
    const fn tag(self) -> &'static str {
        match self {
            Self::Current => "CURRENT",
            Self::Stale => "STALE",
            Self::Unavailable => "UNAVAILABLE",
        }
    }
}

/// Bounded Governance projection. Its fields and constructor are deliberately
/// private; callers can only receive it from [`crate::GovernanceCore`]. Until
/// repository-native F0 source-Owner reread is integrated, freshness,
/// availability, and the source frontier remain explicitly unavailable.
///
/// ```compile_fail
/// use vibe_strategy_governance::{ApplicationStatus, GovernanceDecisionView};
/// let _forged = GovernanceDecisionView {
///     application_status: ApplicationStatus::Applied,
/// };
/// ```
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GovernanceDecisionView {
    receipt_status: ReceiptStatus,
    request_id: LifecycleRequestId,
    principal_id: PrincipalId,
    request_scope_id: RequestScopeId,
    decision_frontier_id: DecisionFrontierId,
    authorized_decision_digest: Option<Digest>,
    application_status: ApplicationStatus,
    runtime_receipt_ref: Option<FactRef>,
    projected_at: u64,
    source_frontier: Option<Digest>,
    freshness: ViewFreshness,
    availability: ViewAvailability,
    revalidate_after: Option<u64>,
    revalidation_boundary: RevalidationBoundary,
}

impl GovernanceDecisionView {
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn project(
        receipt: &LifecycleRequestReceipt,
        authorized_decision_digest: Option<Digest>,
        application_status: ApplicationStatus,
        runtime_receipt_ref: Option<FactRef>,
        projected_at: u64,
        freshness: ViewFreshness,
        availability: ViewAvailability,
        revalidate_after: Option<u64>,
    ) -> Self {
        Self {
            receipt_status: receipt.status,
            request_id: receipt.request_id.clone(),
            principal_id: receipt.principal_id.clone(),
            request_scope_id: receipt.request_scope_id.clone(),
            decision_frontier_id: receipt.decision_frontier_id.clone(),
            authorized_decision_digest,
            application_status,
            runtime_receipt_ref,
            source_frontier: None,
            projected_at,
            freshness,
            availability,
            revalidate_after,
            revalidation_boundary: RevalidationBoundary::F0RepositoryNativeOwnerAdmissionContract,
        }
    }

    #[must_use]
    pub const fn receipt_status(&self) -> ReceiptStatus {
        self.receipt_status
    }
    #[must_use]
    pub fn request_id(&self) -> &LifecycleRequestId {
        &self.request_id
    }
    #[must_use]
    pub fn principal_id(&self) -> &PrincipalId {
        &self.principal_id
    }
    #[must_use]
    pub fn request_scope_id(&self) -> &RequestScopeId {
        &self.request_scope_id
    }
    #[must_use]
    pub fn decision_frontier_id(&self) -> &DecisionFrontierId {
        &self.decision_frontier_id
    }
    #[must_use]
    pub const fn authorized_decision_digest(&self) -> Option<Digest> {
        self.authorized_decision_digest
    }
    #[must_use]
    pub const fn application_status(&self) -> ApplicationStatus {
        self.application_status
    }
    #[must_use]
    pub fn runtime_receipt_ref(&self) -> Option<&FactRef> {
        self.runtime_receipt_ref.as_ref()
    }
    #[must_use]
    pub const fn projected_at(&self) -> u64 {
        self.projected_at
    }
    #[must_use]
    pub const fn source_frontier(&self) -> Option<Digest> {
        self.source_frontier
    }
    #[must_use]
    pub const fn freshness(&self) -> ViewFreshness {
        self.freshness
    }
    #[must_use]
    pub const fn availability(&self) -> ViewAvailability {
        self.availability
    }
    #[must_use]
    pub const fn revalidate_after(&self) -> Option<u64> {
        self.revalidate_after
    }
    #[must_use]
    pub const fn revalidation_boundary(&self) -> RevalidationBoundary {
        self.revalidation_boundary
    }

    /// Serializes the bounded Product Edge consumer projection.
    ///
    /// # Errors
    ///
    /// Returns a JSON error if serialization fails.
    pub fn to_json(&self) -> Result<String, serde_json::Error> {
        serde_json::to_string(&serde_json::json!({
            "application_status": self.application_status.tag(),
            "availability": self.availability.tag(),
            "authorized_decision_digest": self.authorized_decision_digest.map(Digest::to_hex),
            "decision_frontier_id": self.decision_frontier_id.as_str(),
            "freshness": self.freshness.tag(),
            "principal_id": self.principal_id.as_str(),
            "projected_at": self.projected_at,
            "request_id": self.request_id.as_str(),
            "request_scope_id": self.request_scope_id.as_str(),
            "revalidate_after": self.revalidate_after,
            "revalidation_boundary": self.revalidation_boundary.as_str(),
            "runtime_receipt_ref": self.runtime_receipt_ref.as_ref().map(|value| serde_json::json!({
                "digest": value.digest.to_hex(),
                "id": value.id.as_str(),
            })),
            "source_frontier": self.source_frontier.map(Digest::to_hex),
        }))
    }
}
