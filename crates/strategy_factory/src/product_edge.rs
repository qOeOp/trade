use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;
use vibe_product_edge::{ProductEdgeAdmissionLocatorV1, ProductEdgeAdmissionReadbackV1};

use crate::trial_family::{
    TrialFamilyError, TrialFamilyIndependenceDispositionV1, TrialFamilyPolicyV1,
    TrialFamilyReadbackV1, TrialFamilyResolutionV1, form_initial_family,
};
use vibe_qualification::ProtectedFeedbackFrontierReadbackV1;

pub(crate) const RESEARCH_GOAL_OPERATION_V1: &str = "research_goal.submit_or_resolve.v1";
pub(crate) const RESEARCH_GOAL_SCHEMA_V1: &str = "sourced-research-goal-v1";
pub const RESEARCH_GOAL_OPERATION_V2: &str = "research_goal.submit_or_resolve.v2";
pub const RESEARCH_GOAL_SCHEMA_V2: &str = "sourced-research-goal-v2";
pub const RESEARCH_OWNER_V1: &str = "R_AND_D";
pub const RESEARCH_SCOPE_V1: &str = "research:submit";
pub const RESEARCH_VIEW_SCOPE_V1: &str = "research:view";
const RESEARCH_MUTATION_EFFECT_V1: &str = "R_AND_D_RESEARCH_MUTATION_V1";

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ProductEdgeResearchGoalRequestV1 {
    pub(crate) request_identity: String,
    pub(crate) channel: ProductEdgeChannel,
    pub(crate) admission: ProductEdgeAdmissionLocatorV1,
    pub(crate) goal: SourcedResearchGoalV1,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ProductEdgeResearchGoalRequestV2 {
    pub request_identity: String,
    pub channel: ProductEdgeChannel,
    pub admission: ProductEdgeAdmissionLocatorV1,
    pub goal: SourcedResearchGoalV2,
    pub trial_family_proposal: TrialFamilyProposalV1,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ProductEdgeChannel {
    WindmillProductEdge,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SourcedResearchGoalV1 {
    pub hypothesis: String,
    pub mechanism: String,
    pub falsification_question: String,
    pub expected_observation: String,
    pub required_data: Vec<String>,
    pub cost_assumption: String,
    pub capacity_assumption: String,
    pub protected_feedback_frontier: String,
    pub sources: Vec<ResearchSourceV1>,
}

/// V2 caller proposal. Protected-feedback authority is deliberately absent.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SourcedResearchGoalV2 {
    pub hypothesis: String,
    pub mechanism: String,
    pub falsification_question: String,
    pub expected_observation: String,
    pub required_data: Vec<String>,
    pub cost_assumption: String,
    pub capacity_assumption: String,
    pub sources: Vec<ResearchSourceV1>,
}

/// Caller-safe TrialFamily proposal. R&D resolves every lineage field itself.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct TrialFamilyProposalV1 {
    pub trial_budget: u32,
    pub stop_rule: String,
    pub pit_rule_identity: String,
    pub cost_model_identity: String,
    pub slippage_model_identity: String,
    pub capacity_model_identity: String,
    pub independence_rationale: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ResearchLineageResolutionV1 {
    GenesisEmpty,
    CompleteFrontier,
}

/// Sealed R&D pre-feedback independence fact.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct IndependenceBasisReadbackV1 {
    schema_version: u32,
    basis_identity: String,
    request_identity: String,
    principal: String,
    request_scope: Vec<String>,
    rationale_digest: String,
    independence_disposition: TrialFamilyIndependenceDispositionV1,
    lineage_resolution: ResearchLineageResolutionV1,
    semantic_predecessor_frontier: Vec<String>,
    lineage_digest: String,
    basis_digest: String,
    receipt: IndependenceBasisReceiptV1,
}

impl IndependenceBasisReadbackV1 {
    pub fn basis_identity(&self) -> &str {
        &self.basis_identity
    }
    pub fn basis_digest(&self) -> &str {
        &self.basis_digest
    }
    pub fn receipt(&self) -> &IndependenceBasisReceiptV1 {
        &self.receipt
    }

    pub(crate) fn stored(&self) -> StoredIndependenceBasisV1 {
        StoredIndependenceBasisV1 {
            schema_version: self.schema_version,
            basis_identity: self.basis_identity.clone(),
            request_identity: self.request_identity.clone(),
            principal: self.principal.clone(),
            request_scope: self.request_scope.clone(),
            rationale_digest: self.rationale_digest.clone(),
            independence_disposition: self.independence_disposition,
            lineage_resolution: self.lineage_resolution,
            semantic_predecessor_frontier: self.semantic_predecessor_frontier.clone(),
            lineage_digest: self.lineage_digest.clone(),
            basis_digest: self.basis_digest.clone(),
        }
    }

    pub(crate) fn locator(&self) -> vibe_qualification::RdIndependenceBasisLocatorV1 {
        vibe_qualification::RdIndependenceBasisLocatorV1 {
            basis_identity: self.basis_identity.clone(),
            basis_digest: self.basis_digest.clone(),
            request_identity: self.request_identity.clone(),
            principal: self.principal.clone(),
            request_scope: self.request_scope.clone(),
        }
    }

    pub(crate) fn from_stored(
        stored: StoredIndependenceBasisV1,
        receipt: IndependenceBasisReceiptV1,
    ) -> Self {
        Self {
            schema_version: stored.schema_version,
            basis_identity: stored.basis_identity,
            request_identity: stored.request_identity,
            principal: stored.principal,
            request_scope: stored.request_scope,
            rationale_digest: stored.rationale_digest,
            independence_disposition: stored.independence_disposition,
            lineage_resolution: stored.lineage_resolution,
            semantic_predecessor_frontier: stored.semantic_predecessor_frontier,
            lineage_digest: stored.lineage_digest,
            basis_digest: stored.basis_digest,
            receipt,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct IndependenceBasisReceiptV1 {
    schema_version: u32,
    receipt_identity: String,
    basis_identity: String,
    basis_digest: String,
    committed_at_epoch_ms: u64,
}

impl IndependenceBasisReceiptV1 {
    pub fn receipt_identity(&self) -> &str {
        &self.receipt_identity
    }
    pub fn committed_at_epoch_ms(&self) -> u64 {
        self.committed_at_epoch_ms
    }

    pub(crate) fn new(
        receipt_identity: String,
        basis_identity: String,
        basis_digest: String,
        committed_at_epoch_ms: u64,
    ) -> Self {
        Self {
            schema_version: 1,
            receipt_identity,
            basis_identity,
            basis_digest,
            committed_at_epoch_ms,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct StoredAdmittedResearchRequestV2 {
    pub(crate) schema_version: u32,
    pub(crate) request: ProductEdgeResearchGoalRequestV2,
    pub(crate) independence_basis: StoredIndependenceBasisV1,
    pub(crate) protected_feedback: StoredProtectedFeedbackProjectionV1,
    pub(crate) canonical_trial_family_policy: TrialFamilyPolicyV1,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct StoredRejectedResearchRequestV2 {
    pub(crate) schema_version: u32,
    pub(crate) request: ProductEdgeResearchGoalRequestV2,
    pub(crate) rejection_code: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct StoredIndependenceBasisV1 {
    pub(crate) schema_version: u32,
    pub(crate) basis_identity: String,
    pub(crate) request_identity: String,
    pub(crate) principal: String,
    pub(crate) request_scope: Vec<String>,
    pub(crate) rationale_digest: String,
    pub(crate) independence_disposition: TrialFamilyIndependenceDispositionV1,
    pub(crate) lineage_resolution: ResearchLineageResolutionV1,
    pub(crate) semantic_predecessor_frontier: Vec<String>,
    pub(crate) lineage_digest: String,
    pub(crate) basis_digest: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct StoredProtectedFeedbackProjectionV1 {
    pub(crate) projection_identity: String,
    pub(crate) projection_digest: String,
    pub(crate) source_cut: String,
    pub(crate) valid_through_epoch_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ResearchSourceV1 {
    pub locator: String,
    pub content_digest: String,
    pub observed_at: String,
    pub source_cut: String,
    pub license_basis: String,
    pub interpretation: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ResearchRequestReceiptV1 {
    pub schema_version: u32,
    pub receipt_identity: String,
    pub request_identity: String,
    pub semantic_digest: String,
    pub disposition: ResearchRequestDisposition,
    pub resulting_research_intent_identity: Option<String>,
    pub committed_at_epoch_ms: u64,
    pub rejection_code: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ResearchRequestDisposition {
    Accepted,
    RejectedNoWrite,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct FrozenResearchGoalIntentV1 {
    pub schema_version: u32,
    pub intent_identity: String,
    pub request_identity: String,
    pub semantic_digest: String,
    pub source_frontier: Vec<ResearchSourceV1>,
    pub goal: SourcedResearchGoalV1,
    pub frozen_at_epoch_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct FrozenResearchGoalIntentV2 {
    pub schema_version: u32,
    pub intent_identity: String,
    pub request_identity: String,
    pub semantic_digest: String,
    pub source_frontier: Vec<ResearchSourceV1>,
    pub goal: SourcedResearchGoalV2,
    pub independence_basis_identity: String,
    pub independence_basis_digest: String,
    pub protected_feedback_projection_identity: String,
    pub protected_feedback_projection_digest: String,
    pub trial_family_identity: String,
    pub trial_family_policy_digest: String,
    pub frozen_at_epoch_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(untagged)]
pub(crate) enum FrozenResearchGoalIntent {
    V2(FrozenResearchGoalIntentV2),
    V1(FrozenResearchGoalIntentV1),
}

impl FrozenResearchGoalIntent {
    pub(crate) fn intent_identity(&self) -> &str {
        match self {
            Self::V1(intent) => &intent.intent_identity,
            Self::V2(intent) => &intent.intent_identity,
        }
    }

    pub(crate) fn request_identity(&self) -> &str {
        match self {
            Self::V1(intent) => &intent.request_identity,
            Self::V2(intent) => &intent.request_identity,
        }
    }

    pub(crate) fn semantic_digest(&self) -> &str {
        match self {
            Self::V1(intent) => &intent.semantic_digest,
            Self::V2(intent) => &intent.semantic_digest,
        }
    }

    pub(crate) fn source_frontier(&self) -> &[ResearchSourceV1] {
        match self {
            Self::V1(intent) => &intent.source_frontier,
            Self::V2(intent) => &intent.source_frontier,
        }
    }

    pub(crate) fn is_v2(&self) -> bool {
        matches!(self, Self::V2(_))
    }

    pub(crate) fn schema_version(&self) -> u32 {
        match self {
            Self::V1(_) => 1,
            Self::V2(_) => 2,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ResearchViewV1 {
    pub schema_version: u32,
    pub projection_identity: String,
    pub request_identity: String,
    pub trusted_principal: String,
    pub authorized_scope: Vec<String>,
    pub authorization_policy_cut: String,
    pub source_owner: String,
    pub source_cut: String,
    pub observed_at_epoch_ms: u64,
    pub projection_at_epoch_ms: u64,
    pub valid_through_epoch_ms: u64,
    pub availability: ResearchViewAvailability,
    pub phase: ResearchViewPhase,
    pub intent_identity: String,
    pub source_frontier: Vec<ResearchSourceV1>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attempt_identity: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub artifact_identity: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub build_receipt_identity: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub artifact_review_identity: Option<String>,
    pub next_legal_action: ResearchNextLegalAction,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ResearchViewAvailability {
    Available,
    Stale,
    Unavailable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ResearchViewPhase {
    RequestUnresolved,
    IntentFrozen,
    ArtifactAvailable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ResearchNextLegalAction {
    ResolveSameRequestIdentity,
    WaitForRAndDExecution,
    CorrectInputAndCreateSuccessorRequest,
    ReviewArtifact,
}

pub use crate::exploratory_replay::{
    ExploratoryReplayAvailabilityV1, ExploratoryReplayNextLegalActionV1,
    ExploratoryReplayRequestProjectionV1,
};

/// Owner-assembled V1 result.
///
/// Positive results are serialize-only and cannot be reconstructed by a caller:
///
/// ```compile_fail
/// use vibe_strategy_factory::product_edge::ResearchGoalOwnerResultV1;
/// let _: ResearchGoalOwnerResultV1 = serde_json::from_str("{}").unwrap();
/// ```
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ResearchGoalOwnerResultV1 {
    pub(crate) schema_version: u32,
    pub(crate) resolution: ProductEdgeResolution,
    pub(crate) request_identity: String,
    pub(crate) owner_receipt: Option<ResearchRequestReceiptV1>,
    pub(crate) research_view: Option<ResearchViewV1>,
    pub(crate) next_legal_action: ResearchNextLegalAction,
}

impl ResearchGoalOwnerResultV1 {
    pub fn resolution(&self) -> ProductEdgeResolution {
        self.resolution
    }

    pub fn request_identity(&self) -> &str {
        &self.request_identity
    }

    pub fn owner_receipt(&self) -> Option<&ResearchRequestReceiptV1> {
        self.owner_receipt.as_ref()
    }

    pub fn research_view(&self) -> Option<&ResearchViewV1> {
        self.research_view.as_ref()
    }

    pub fn next_legal_action(&self) -> ResearchNextLegalAction {
        self.next_legal_action
    }
}

/// Owner-assembled V2 result.
///
/// Positive assembly is deliberately not part of the public Product Edge API:
///
/// ```compile_fail
/// use vibe_strategy_factory::product_edge::result_from_commit_v2;
/// ```
///
/// ```compile_fail
/// use vibe_strategy_factory::product_edge::ResearchGoalOwnerResultV2;
/// let _: ResearchGoalOwnerResultV2 = serde_json::from_str("{}").unwrap();
/// ```
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ResearchGoalOwnerResultV2 {
    pub(crate) schema_version: u32,
    pub(crate) resolution: ProductEdgeResolution,
    pub(crate) request_identity: String,
    pub(crate) owner_receipt: Option<ResearchRequestReceiptV1>,
    pub(crate) research_view: Option<ResearchViewV1>,
    pub(crate) independence_basis: Option<IndependenceBasisReadbackV1>,
    pub(crate) protected_feedback: Option<ProtectedFeedbackFrontierReadbackV1>,
    pub(crate) trial_family_resolution: TrialFamilyResolutionV1,
    pub(crate) trial_family: Option<TrialFamilyReadbackV1>,
    pub(crate) next_legal_action: ResearchNextLegalAction,
}

impl ResearchGoalOwnerResultV2 {
    pub fn resolution(&self) -> ProductEdgeResolution {
        self.resolution
    }

    pub fn request_identity(&self) -> &str {
        &self.request_identity
    }

    pub fn owner_receipt(&self) -> Option<&ResearchRequestReceiptV1> {
        self.owner_receipt.as_ref()
    }

    pub fn research_view(&self) -> Option<&ResearchViewV1> {
        self.research_view.as_ref()
    }

    pub fn independence_basis(&self) -> Option<&IndependenceBasisReadbackV1> {
        self.independence_basis.as_ref()
    }

    pub fn protected_feedback(&self) -> Option<&ProtectedFeedbackFrontierReadbackV1> {
        self.protected_feedback.as_ref()
    }

    pub fn trial_family_resolution(&self) -> TrialFamilyResolutionV1 {
        self.trial_family_resolution
    }

    pub fn trial_family(&self) -> Option<&TrialFamilyReadbackV1> {
        self.trial_family.as_ref()
    }

    pub fn next_legal_action(&self) -> ResearchNextLegalAction {
        self.next_legal_action
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ProductEdgeResolution {
    Accepted,
    RejectedNoWrite,
    SubmittedOrUnknown,
    IdentityConflict,
    LegacyTerminalQuarantined,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ResearchGoalCommitV1 {
    pub(crate) receipt: ResearchRequestReceiptV1,
    pub(crate) intent: Option<FrozenResearchGoalIntentV1>,
    pub(crate) view: Option<ResearchViewV1>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ResearchGoalCommitV2 {
    pub(crate) receipt: ResearchRequestReceiptV1,
    pub(crate) intent: Option<FrozenResearchGoalIntentV2>,
    pub(crate) view: Option<ResearchViewV1>,
    pub(crate) initial_family: Option<TrialFamilyReadbackV1>,
    pub(crate) independence_basis: Option<IndependenceBasisReadbackV1>,
    pub(crate) protected_feedback: Option<ProtectedFeedbackFrontierReadbackV1>,
}

pub(crate) struct ValidatedResearchGoalRequestV2 {
    request: ProductEdgeResearchGoalRequestV2,
}

pub(crate) struct RejectedResearchGoalRequestV2 {
    request: Box<ProductEdgeResearchGoalRequestV2>,
    rejection_code: &'static str,
}

impl ValidatedResearchGoalRequestV2 {
    pub(crate) fn request(&self) -> &ProductEdgeResearchGoalRequestV2 {
        &self.request
    }
}

impl RejectedResearchGoalRequestV2 {
    pub(crate) fn request(&self) -> &ProductEdgeResearchGoalRequestV2 {
        &self.request
    }

    pub(crate) fn into_parts(self) -> (ProductEdgeResearchGoalRequestV2, &'static str) {
        (*self.request, self.rejection_code)
    }
}

#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum ResearchGoalOwnerError {
    #[error("request identity was reused with conflicting semantics")]
    ConflictingReplay,
    #[error("Product Edge authorization lineage is not admitted: {0}")]
    Unauthorized(&'static str),
    #[error("Owner storage unavailable: {0}")]
    Storage(String),
}

#[async_trait]
pub trait ResearchGoalOwnerPortV2: Send + Sync {
    async fn submit_v2(
        &self,
        request: ProductEdgeResearchGoalRequestV2,
    ) -> Result<ResearchGoalOwnerResultV2, ResearchGoalOwnerError>;

    async fn resolve_v2(
        &self,
        request_identity: &str,
        admission: &ProductEdgeAdmissionLocatorV1,
    ) -> Result<ResearchGoalOwnerResultV2, ResearchGoalOwnerError>;
}

pub(crate) fn semantic_digest(
    request: &ProductEdgeResearchGoalRequestV1,
) -> Result<String, ResearchGoalOwnerError> {
    semantic_digest_v1_meaning(&request.request_identity, &request.admission, &request.goal)
}

fn semantic_digest_v1_meaning(
    request_identity: &str,
    admission: &ProductEdgeAdmissionLocatorV1,
    goal: &SourcedResearchGoalV1,
) -> Result<String, ResearchGoalOwnerError> {
    #[derive(Serialize)]
    struct Meaning<'a> {
        request_identity: &'a str,
        admission: &'a ProductEdgeAdmissionLocatorV1,
        goal: &'a SourcedResearchGoalV1,
    }
    let bytes = serde_json::to_vec(&Meaning {
        request_identity,
        admission,
        goal,
    })
    .map_err(|e| ResearchGoalOwnerError::Storage(e.to_string()))?;
    Ok(format!("sha256:{:x}", Sha256::digest(bytes)))
}

pub fn semantic_digest_v2(
    request: &ProductEdgeResearchGoalRequestV2,
) -> Result<String, ResearchGoalOwnerError> {
    #[derive(Serialize)]
    struct Meaning<'a> {
        request_identity: &'a str,
        admission: &'a ProductEdgeAdmissionLocatorV1,
        goal: &'a SourcedResearchGoalV2,
        trial_family_proposal: &'a TrialFamilyProposalV1,
    }
    let bytes = serde_json::to_vec(&Meaning {
        request_identity: &request.request_identity,
        admission: &request.admission,
        goal: &request.goal,
        trial_family_proposal: &request.trial_family_proposal,
    })
    .map_err(|e| ResearchGoalOwnerError::Storage(e.to_string()))?;
    Ok(format!("sha256:{:x}", Sha256::digest(bytes)))
}

pub(crate) fn verify_research_admission_v1(
    admission: &ProductEdgeAdmissionReadbackV1,
    request: &ProductEdgeResearchGoalRequestV1,
) -> Result<(), ResearchGoalOwnerError> {
    let payload = serde_json::json!({
        "request_identity": request.request_identity,
        "channel": request.channel,
        "goal": request.goal,
    });
    verify_research_admission(
        admission,
        &request.admission,
        &request.request_identity,
        RESEARCH_GOAL_OPERATION_V1,
        RESEARCH_GOAL_SCHEMA_V1,
        &payload,
    )
}

pub(crate) fn verify_research_admission_v2(
    admission: &ProductEdgeAdmissionReadbackV1,
    request: &ProductEdgeResearchGoalRequestV2,
) -> Result<(), ResearchGoalOwnerError> {
    let payload = serde_json::json!({
        "request_identity": request.request_identity,
        "channel": request.channel,
        "goal": request.goal,
        "trial_family_proposal": request.trial_family_proposal,
    });
    verify_research_admission(
        admission,
        &request.admission,
        &request.request_identity,
        RESEARCH_GOAL_OPERATION_V2,
        RESEARCH_GOAL_SCHEMA_V2,
        &payload,
    )?;

    if !has_research_submit_scope(admission.authorized_scope())
        || !has_exact_research_mutation_effect(admission.request().requested_effects.as_slice())
    {
        return Err(ResearchGoalOwnerError::Unauthorized(
            "canonical Product Edge research authority mismatch",
        ));
    }
    Ok(())
}

fn has_exact_research_mutation_effect(requested_effects: &[String]) -> bool {
    matches!(requested_effects, [effect] if effect == RESEARCH_MUTATION_EFFECT_V1)
}

fn has_research_submit_scope(authorized_scope: &[String]) -> bool {
    authorized_scope
        .iter()
        .any(|permission| permission == RESEARCH_SCOPE_V1)
}

fn verify_research_admission(
    admission: &ProductEdgeAdmissionReadbackV1,
    locator: &ProductEdgeAdmissionLocatorV1,
    request_identity: &str,
    operation: &str,
    operation_schema: &str,
    payload: &serde_json::Value,
) -> Result<(), ResearchGoalOwnerError> {
    let admitted = admission.request();
    if admission.locator() != locator
        || admitted.request_identity != request_identity
        || admitted.operation != operation
        || admitted.operation_schema != operation_schema
        || admitted.target_owner != RESEARCH_OWNER_V1
        || admitted.typed_payload != *payload
    {
        return Err(ResearchGoalOwnerError::Unauthorized(
            "canonical Product Edge admission mismatch",
        ));
    }
    Ok(())
}

pub(crate) fn decide_commit_v2(
    validated: ValidatedResearchGoalRequestV2,
    semantic_digest: String,
    canonical_trial_family_policy: TrialFamilyPolicyV1,
    independence_basis: IndependenceBasisReadbackV1,
    protected_feedback: ProtectedFeedbackFrontierReadbackV1,
    admission: &ProductEdgeAdmissionReadbackV1,
    now_epoch_ms: u64,
) -> Result<ResearchGoalCommitV2, ResearchGoalOwnerError> {
    let request = validated.request;
    let suffix = digest_text(&format!(
        "v2:{}:{semantic_digest}",
        request.request_identity
    ));
    let receipt_identity =
        canonical_research_receipt_identity(2, &request.request_identity, &semantic_digest);

    let intent_identity = canonical_v2_intent_identity(&request.request_identity, &semantic_digest);
    let initial_family = form_initial_family(
        &intent_identity,
        &semantic_digest,
        canonical_trial_family_policy,
        now_epoch_ms,
    )
    .map_err(|e| trial_family_storage(&e))?;
    let intent = FrozenResearchGoalIntentV2 {
        schema_version: 2,
        intent_identity: intent_identity.clone(),
        request_identity: request.request_identity.clone(),
        semantic_digest: semantic_digest.clone(),
        source_frontier: request.goal.sources.clone(),
        goal: request.goal,
        independence_basis_identity: independence_basis.basis_identity.clone(),
        independence_basis_digest: independence_basis.basis_digest.clone(),
        protected_feedback_projection_identity: protected_feedback
            .projection_identity()
            .to_string(),
        protected_feedback_projection_digest: protected_feedback.projection_digest().to_string(),
        trial_family_identity: initial_family.root.trial_family_identity().to_string(),
        trial_family_policy_digest: initial_family.root.policy_digest().to_string(),
        frozen_at_epoch_ms: now_epoch_ms,
    };
    let mut view = ResearchViewV1 {
        schema_version: 1,
        projection_identity: String::new(),
        request_identity: request.request_identity.clone(),
        trusted_principal: admission.effective_principal().to_string(),
        authorized_scope: admission.authorized_scope().to_vec(),
        authorization_policy_cut: admission
            .authorization()
            .frontier()
            .frontier_identity()
            .to_string(),
        source_owner: RESEARCH_OWNER_V1.to_string(),
        source_cut: format!("rd-source-cut-v2-{suffix}"),
        observed_at_epoch_ms: now_epoch_ms,
        projection_at_epoch_ms: now_epoch_ms,
        valid_through_epoch_ms: now_epoch_ms
            .saturating_add(600_000)
            .min(protected_feedback.valid_through_epoch_ms()),
        availability: ResearchViewAvailability::Available,
        phase: ResearchViewPhase::IntentFrozen,
        intent_identity: intent_identity.clone(),
        source_frontier: intent.source_frontier.clone(),
        attempt_identity: None,
        artifact_identity: None,
        build_receipt_identity: None,
        artifact_review_identity: None,
        next_legal_action: ResearchNextLegalAction::WaitForRAndDExecution,
    };
    view.projection_identity = canonical_research_view_identity_v2(&view);
    Ok(ResearchGoalCommitV2 {
        receipt: ResearchRequestReceiptV1 {
            schema_version: 1,
            receipt_identity,
            request_identity: request.request_identity,
            semantic_digest,
            disposition: ResearchRequestDisposition::Accepted,
            resulting_research_intent_identity: Some(intent_identity),
            committed_at_epoch_ms: now_epoch_ms,
            rejection_code: None,
        },
        intent: Some(intent),
        view: Some(view),
        initial_family: Some(initial_family),
        independence_basis: Some(independence_basis),
        protected_feedback: Some(protected_feedback),
    })
}

pub(crate) fn canonical_v2_intent_identity(
    request_identity: &str,
    semantic_digest: &str,
) -> String {
    format!(
        "rd-research-intent-v2-{}",
        digest_text(&format!("v2:{request_identity}:{semantic_digest}"))
    )
}

pub(crate) fn decide_rejected_commit_v2(
    request: ProductEdgeResearchGoalRequestV2,
    semantic_digest: String,
    rejection_code: &'static str,
    now_epoch_ms: u64,
) -> ResearchGoalCommitV2 {
    let request_identity = request.request_identity;
    ResearchGoalCommitV2 {
        receipt: ResearchRequestReceiptV1 {
            schema_version: 1,
            receipt_identity: canonical_research_receipt_identity(
                2,
                &request_identity,
                &semantic_digest,
            ),
            request_identity,
            semantic_digest,
            disposition: ResearchRequestDisposition::RejectedNoWrite,
            resulting_research_intent_identity: None,
            committed_at_epoch_ms: now_epoch_ms,
            rejection_code: Some(rejection_code.to_string()),
        },
        intent: None,
        view: None,
        initial_family: None,
        independence_basis: None,
        protected_feedback: None,
    }
}

pub(crate) fn canonical_research_receipt_identity(
    intent_schema_version: u32,
    request_identity: &str,
    semantic_digest: &str,
) -> String {
    let suffix = if intent_schema_version == 2 {
        digest_text(&format!("v2:{request_identity}:{semantic_digest}"))
    } else {
        digest_text(&format!("{request_identity}:{semantic_digest}"))
    };
    format!("rd-research-request-receipt-v{intent_schema_version}-{suffix}")
}

pub fn unresolved_result_v2(request_identity: &str) -> ResearchGoalOwnerResultV2 {
    ResearchGoalOwnerResultV2 {
        schema_version: 2,
        resolution: ProductEdgeResolution::SubmittedOrUnknown,
        request_identity: request_identity.to_string(),
        owner_receipt: None,
        research_view: None,
        independence_basis: None,
        protected_feedback: None,
        trial_family_resolution: TrialFamilyResolutionV1::unavailable(),
        trial_family: None,
        next_legal_action: ResearchNextLegalAction::ResolveSameRequestIdentity,
    }
}

pub fn identity_conflict_result_v2(request_identity: &str) -> ResearchGoalOwnerResultV2 {
    ResearchGoalOwnerResultV2 {
        schema_version: 2,
        resolution: ProductEdgeResolution::IdentityConflict,
        request_identity: request_identity.to_string(),
        owner_receipt: None,
        research_view: None,
        independence_basis: None,
        protected_feedback: None,
        trial_family_resolution: TrialFamilyResolutionV1::unavailable(),
        trial_family: None,
        next_legal_action: ResearchNextLegalAction::ResolveSameRequestIdentity,
    }
}

pub(crate) fn decide_commit(
    request: ProductEdgeResearchGoalRequestV1,
    semantic_digest: String,
    admission: &ProductEdgeAdmissionReadbackV1,
    now_epoch_ms: u64,
) -> ResearchGoalCommitV1 {
    let validation = validate_goal_request(&request);
    let suffix = digest_text(&format!("{}:{}", request.request_identity, semantic_digest));
    let receipt_identity = format!("rd-research-request-receipt-v1-{suffix}");

    if let Err(code) = validation {
        return ResearchGoalCommitV1 {
            receipt: ResearchRequestReceiptV1 {
                schema_version: 1,
                receipt_identity,
                request_identity: request.request_identity,
                semantic_digest,
                disposition: ResearchRequestDisposition::RejectedNoWrite,
                resulting_research_intent_identity: None,
                committed_at_epoch_ms: now_epoch_ms,
                rejection_code: Some(code.to_string()),
            },
            intent: None,
            view: None,
        };
    }

    let intent_identity = format!("rd-research-intent-v1-{suffix}");
    let source_cut = format!("rd-source-cut-v1-{suffix}");
    let projection_identity = format!("rd-research-view-v1-{suffix}");
    let intent = FrozenResearchGoalIntentV1 {
        schema_version: 1,
        intent_identity: intent_identity.clone(),
        request_identity: request.request_identity.clone(),
        semantic_digest: semantic_digest.clone(),
        source_frontier: request.goal.sources.clone(),
        goal: request.goal,
        frozen_at_epoch_ms: now_epoch_ms,
    };
    let view = ResearchViewV1 {
        schema_version: 1,
        projection_identity,
        request_identity: request.request_identity.clone(),
        trusted_principal: admission.effective_principal().to_string(),
        authorized_scope: admission.authorized_scope().to_vec(),
        authorization_policy_cut: admission
            .authorization()
            .frontier()
            .frontier_identity()
            .to_string(),
        source_owner: RESEARCH_OWNER_V1.to_string(),
        source_cut,
        observed_at_epoch_ms: now_epoch_ms,
        projection_at_epoch_ms: now_epoch_ms,
        valid_through_epoch_ms: now_epoch_ms.saturating_add(600_000),
        availability: ResearchViewAvailability::Available,
        phase: ResearchViewPhase::IntentFrozen,
        intent_identity: intent_identity.clone(),
        source_frontier: intent.source_frontier.clone(),
        attempt_identity: None,
        artifact_identity: None,
        build_receipt_identity: None,
        artifact_review_identity: None,
        next_legal_action: ResearchNextLegalAction::WaitForRAndDExecution,
    };
    ResearchGoalCommitV1 {
        receipt: ResearchRequestReceiptV1 {
            schema_version: 1,
            receipt_identity,
            request_identity: request.request_identity,
            semantic_digest,
            disposition: ResearchRequestDisposition::Accepted,
            resulting_research_intent_identity: Some(intent_identity),
            committed_at_epoch_ms: now_epoch_ms,
            rejection_code: None,
        },
        intent: Some(intent),
        view: Some(view),
    }
}

pub(crate) fn project_research_view_at(
    historical: &ResearchViewV1,
    read_cut_epoch_ms: u64,
) -> ResearchViewV1 {
    let mut projected = historical.clone();
    if read_cut_epoch_ms >= projected.valid_through_epoch_ms {
        projected.availability = ResearchViewAvailability::Stale;
        projected.projection_at_epoch_ms = read_cut_epoch_ms;
    }

    if projected.availability != ResearchViewAvailability::Available {
        projected.next_legal_action = ResearchNextLegalAction::ResolveSameRequestIdentity;
    }
    projected
}

pub(crate) fn project_research_view_stale_at(
    historical: &ResearchViewV1,
    read_cut_epoch_ms: u64,
) -> ResearchViewV1 {
    let mut projected = historical.clone();
    projected.availability = ResearchViewAvailability::Stale;
    projected.projection_at_epoch_ms = read_cut_epoch_ms;
    projected.next_legal_action = ResearchNextLegalAction::ResolveSameRequestIdentity;
    projected
}

pub fn unresolved_result(request_identity: &str) -> ResearchGoalOwnerResultV1 {
    ResearchGoalOwnerResultV1 {
        schema_version: 1,
        resolution: ProductEdgeResolution::SubmittedOrUnknown,
        request_identity: request_identity.to_string(),
        owner_receipt: None,
        research_view: None,
        next_legal_action: ResearchNextLegalAction::ResolveSameRequestIdentity,
    }
}

pub fn rejected_result(request_identity: &str) -> ResearchGoalOwnerResultV1 {
    ResearchGoalOwnerResultV1 {
        schema_version: 1,
        resolution: ProductEdgeResolution::RejectedNoWrite,
        request_identity: request_identity.to_string(),
        owner_receipt: None,
        research_view: None,
        next_legal_action: ResearchNextLegalAction::CorrectInputAndCreateSuccessorRequest,
    }
}

pub fn identity_conflict_result(request_identity: &str) -> ResearchGoalOwnerResultV1 {
    ResearchGoalOwnerResultV1 {
        schema_version: 1,
        resolution: ProductEdgeResolution::IdentityConflict,
        request_identity: request_identity.to_string(),
        owner_receipt: None,
        research_view: None,
        next_legal_action: ResearchNextLegalAction::ResolveSameRequestIdentity,
    }
}

fn validate_goal_request(request: &ProductEdgeResearchGoalRequestV1) -> Result<(), &'static str> {
    validate_goal_meaning(&request.request_identity, &request.goal)
}

pub(crate) fn validate_legacy_goal_meaning(
    request_identity: &str,
    goal: &SourcedResearchGoalV1,
) -> Result<(), &'static str> {
    validate_goal_meaning(request_identity, goal)
}

fn validate_goal_meaning(
    request_identity: &str,
    goal: &SourcedResearchGoalV1,
) -> Result<(), &'static str> {
    validate_request_identity(request_identity)?;
    validate_goal_fields(
        &goal.hypothesis,
        &goal.mechanism,
        &goal.falsification_question,
        &goal.expected_observation,
        &goal.required_data,
        &goal.cost_assumption,
        &goal.capacity_assumption,
        &goal.sources,
    )?;
    require_text(
        &goal.protected_feedback_frontier,
        4,
        512,
        "PROTECTED_FEEDBACK_FRONTIER_INVALID",
    )
}

#[allow(clippy::too_many_arguments)]
fn validate_goal_fields(
    hypothesis: &str,
    mechanism: &str,
    falsification_question: &str,
    expected_observation: &str,
    required_data: &[String],
    cost_assumption: &str,
    capacity_assumption: &str,
    sources: &[ResearchSourceV1],
) -> Result<(), &'static str> {
    require_text(hypothesis, 16, 2_000, "HYPOTHESIS_INVALID")?;
    require_text(mechanism, 16, 2_000, "MECHANISM_INVALID")?;
    require_text(
        falsification_question,
        16,
        2_000,
        "FALSIFICATION_QUESTION_INVALID",
    )?;
    require_text(
        expected_observation,
        8,
        2_000,
        "EXPECTED_OBSERVATION_INVALID",
    )?;
    require_text(cost_assumption, 4, 1_000, "COST_ASSUMPTION_INVALID")?;
    require_text(capacity_assumption, 4, 1_000, "CAPACITY_ASSUMPTION_INVALID")?;

    if required_data.is_empty()
        || required_data.len() > 16
        || required_data
            .iter()
            .any(|value| require_text(value, 2, 256, "REQUIRED_DATA_INVALID").is_err())
    {
        return Err("REQUIRED_DATA_INVALID");
    }

    if sources.is_empty() || sources.len() > 16 {
        return Err("SOURCE_SET_INVALID");
    }

    for source in sources {
        if !(source.locator.starts_with("https://") || source.locator.starts_with("urn:")) {
            return Err("SOURCE_LOCATOR_INVALID");
        }
        let digest = source.content_digest.strip_prefix("sha256:");
        if digest.is_none_or(|value| {
            value.len() != 64 || !value.bytes().all(|byte| byte.is_ascii_hexdigit())
        }) {
            return Err("SOURCE_DIGEST_INVALID");
        }
        require_text(&source.observed_at, 10, 64, "SOURCE_OBSERVED_AT_INVALID")?;
        require_text(&source.source_cut, 4, 256, "SOURCE_CUT_INVALID")?;
        require_text(&source.license_basis, 3, 512, "SOURCE_LICENSE_INVALID")?;
        require_text(
            &source.interpretation,
            8,
            2_000,
            "SOURCE_INTERPRETATION_INVALID",
        )?;
    }
    Ok(())
}

pub(crate) fn validate_goal_request_v2(
    request: ProductEdgeResearchGoalRequestV2,
) -> Result<ValidatedResearchGoalRequestV2, RejectedResearchGoalRequestV2> {
    match validate_goal_request_v2_fields(&request) {
        Ok(()) => Ok(ValidatedResearchGoalRequestV2 { request }),
        Err(rejection_code) => Err(RejectedResearchGoalRequestV2 {
            request: Box::new(request),
            rejection_code,
        }),
    }
}

fn validate_goal_request_v2_fields(
    request: &ProductEdgeResearchGoalRequestV2,
) -> Result<(), &'static str> {
    validate_request_identity(&request.request_identity)?;
    validate_goal_fields(
        &request.goal.hypothesis,
        &request.goal.mechanism,
        &request.goal.falsification_question,
        &request.goal.expected_observation,
        &request.goal.required_data,
        &request.goal.cost_assumption,
        &request.goal.capacity_assumption,
        &request.goal.sources,
    )?;
    let proposal = &request.trial_family_proposal;
    if !(1..=10_000).contains(&proposal.trial_budget) {
        return Err("TRIAL_BUDGET_INVALID");
    }
    require_text(&proposal.stop_rule, 8, 2_048, "STOP_RULE_INVALID")?;
    for (value, code) in [
        (&proposal.pit_rule_identity, "PIT_RULE_IDENTITY_INVALID"),
        (&proposal.cost_model_identity, "COST_MODEL_IDENTITY_INVALID"),
        (
            &proposal.slippage_model_identity,
            "SLIPPAGE_MODEL_IDENTITY_INVALID",
        ),
        (
            &proposal.capacity_model_identity,
            "CAPACITY_MODEL_IDENTITY_INVALID",
        ),
    ] {
        require_text(value, 4, 256, code)?;
    }
    require_text(
        &proposal.independence_rationale,
        8,
        2_000,
        "INDEPENDENCE_RATIONALE_INVALID",
    )
}

fn validate_request_identity(value: &str) -> Result<(), &'static str> {
    if (16..=128).contains(&value.len())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b':' | b'.'))
    {
        Ok(())
    } else {
        Err("REQUEST_IDENTITY_INVALID")
    }
}

fn require_text(
    value: &str,
    minimum: usize,
    maximum: usize,
    code: &'static str,
) -> Result<(), &'static str> {
    let trimmed = value.trim();
    if trimmed.len() < minimum || trimmed.len() > maximum {
        Err(code)
    } else {
        Ok(())
    }
}

fn digest_text(value: &str) -> String {
    format!("{:x}", Sha256::digest(value.as_bytes()))
}

pub(crate) fn terminal_research_view_identity(
    initial_projection_identity: &str,
    attempt_identity: &str,
    artifact_identity: &str,
    build_receipt_identity: &str,
    artifact_review_identity: &str,
) -> String {
    let meaning = format!(
        "rd.research-view.terminal.v1\0{initial_projection_identity}\0{attempt_identity}\0{artifact_identity}\0{build_receipt_identity}\0{artifact_review_identity}"
    );
    format!("rd-research-view-terminal-v1-{}", digest_text(&meaning))
}

#[derive(Serialize)]
struct ResearchViewIdentityEnvelopeV2<'a> {
    domain: &'static str,
    value: ResearchViewIdentityMeaningV2<'a>,
}

#[derive(Serialize)]
struct ResearchViewIdentityMeaningV2<'a> {
    schema_version: u32,
    request_identity: &'a str,
    trusted_principal: &'a str,
    authorized_scope: &'a [String],
    authorization_policy_cut: &'a str,
    source_owner: &'a str,
    source_cut: &'a str,
    phase: &'a ResearchViewPhase,
    intent_identity: &'a str,
    source_frontier: &'a [ResearchSourceV1],
    attempt_identity: Option<&'a str>,
    artifact_identity: Option<&'a str>,
    build_receipt_identity: Option<&'a str>,
    artifact_review_identity: Option<&'a str>,
}

pub(crate) fn canonical_research_view_identity_v2(view: &ResearchViewV1) -> String {
    let bytes = serde_json::to_vec(&ResearchViewIdentityEnvelopeV2 {
        domain: "rd.research-view.identity.v2",
        value: ResearchViewIdentityMeaningV2 {
            schema_version: view.schema_version,
            request_identity: &view.request_identity,
            trusted_principal: &view.trusted_principal,
            authorized_scope: &view.authorized_scope,
            authorization_policy_cut: &view.authorization_policy_cut,
            source_owner: &view.source_owner,
            source_cut: &view.source_cut,
            phase: &view.phase,
            intent_identity: &view.intent_identity,
            source_frontier: &view.source_frontier,
            attempt_identity: view.attempt_identity.as_deref(),
            artifact_identity: view.artifact_identity.as_deref(),
            build_receipt_identity: view.build_receipt_identity.as_deref(),
            artifact_review_identity: view.artifact_review_identity.as_deref(),
        },
    })
    .expect("Research View identity meaning is serializable");
    let prefix = if view.phase == ResearchViewPhase::ArtifactAvailable {
        "rd-research-view-terminal-v2"
    } else {
        "rd-research-view-v2"
    };
    format!("{prefix}-{:x}", Sha256::digest(bytes))
}

fn trial_family_storage(error: &TrialFamilyError) -> ResearchGoalOwnerError {
    ResearchGoalOwnerError::Storage(error.to_string())
}

#[cfg(test)]
mod v2_sealing_tests {
    use super::*;
    use rstest::rstest;

    #[rstest]
    #[case(vec![RESEARCH_MUTATION_EFFECT_V1.to_string()], true)]
    #[case(Vec::new(), false)]
    #[case(vec!["OTHER_EFFECT_V1".to_string()], false)]
    #[case(vec![RESEARCH_MUTATION_EFFECT_V1.to_string(), "OTHER_EFFECT_V1".to_string()], false)]
    fn research_mutation_effect_is_an_exact_singleton(
        #[case] requested_effects: Vec<String>,
        #[case] expected: bool,
    ) {
        assert_eq!(
            has_exact_research_mutation_effect(&requested_effects),
            expected
        );
    }

    #[rstest]
    #[case(vec![RESEARCH_SCOPE_V1.to_string()], true)]
    #[case(vec![RESEARCH_SCOPE_V1.to_string(), RESEARCH_VIEW_SCOPE_V1.to_string()], true)]
    #[case(vec![RESEARCH_VIEW_SCOPE_V1.to_string()], false)]
    #[case(Vec::new(), false)]
    fn research_submit_scope_must_be_present(
        #[case] authorized_scope: Vec<String>,
        #[case] expected: bool,
    ) {
        assert_eq!(has_research_submit_scope(&authorized_scope), expected);
    }

    #[rstest]
    fn v2_caller_wire_contains_proposal_but_no_owner_lineage_authority() {
        let value =
            serde_json::to_value(request_v2("research-request-v2-proposal-wire-0001")).unwrap();
        let encoded = serde_json::to_string(&value).unwrap();
        assert!(value.get("trial_family_proposal").is_some());

        for forbidden in [
            "semantic_predecessor_frontier",
            "protected_feedback_frontier",
            "independence_disposition",
            "independence_basis_identity",
            "frozen_falsifier_binding",
        ] {
            assert!(!encoded.contains(forbidden));
        }
    }

    #[rstest]
    fn owner_projection_becomes_stale_at_its_valid_through_cut() {
        let historical = research_view(1_000, 601_000);
        let cut = historical.valid_through_epoch_ms;
        let view = project_research_view_at(&historical, cut);
        assert_eq!(view.availability, ResearchViewAvailability::Stale);
        assert_eq!(view.observed_at_epoch_ms, 1_000);
        assert_eq!(view.projection_at_epoch_ms, cut);
        assert_eq!(
            view.next_legal_action,
            ResearchNextLegalAction::ResolveSameRequestIdentity
        );
    }

    #[rstest]
    fn owner_projection_becomes_stale_after_its_valid_through_cut() {
        let view = project_research_view_at(&research_view(1_000, 601_000), 601_001);
        assert_eq!(view.availability, ResearchViewAvailability::Stale);
        assert_eq!(view.observed_at_epoch_ms, 1_000);
        assert_eq!(view.projection_at_epoch_ms, 601_001);
        assert_eq!(
            view.next_legal_action,
            ResearchNextLegalAction::ResolveSameRequestIdentity
        );
    }

    #[rstest]
    fn current_artifact_projection_preserves_owner_review_action() {
        let mut view = research_view(1_000, 2_000);
        view.phase = ResearchViewPhase::ArtifactAvailable;
        view.next_legal_action = ResearchNextLegalAction::ReviewArtifact;
        view.valid_through_epoch_ms = 2_000;

        let projected = project_research_view_at(&view, 1_999);
        assert_eq!(projected.availability, ResearchViewAvailability::Available);
        assert_eq!(projected.projection_at_epoch_ms, 1_000);
        assert_eq!(
            projected.next_legal_action,
            ResearchNextLegalAction::ReviewArtifact
        );
    }

    #[rstest]
    fn research_view_identity_binds_authorization_cut_and_complete_source_frontier() {
        let mut view = research_view(1_000, 601_000);
        view.projection_identity = canonical_research_view_identity_v2(&view);
        let identity = view.projection_identity.clone();

        let stale = project_research_view_stale_at(&view, 601_001);
        assert_eq!(canonical_research_view_identity_v2(&stale), identity);

        let mut foreign_cut = view.clone();
        foreign_cut.authorization_policy_cut = "operator-frontier-foreign-v1".to_string();
        assert_ne!(canonical_research_view_identity_v2(&foreign_cut), identity);

        let mut foreign_source = view;
        foreign_source.source_frontier.push(ResearchSourceV1 {
            locator: "https://caller.invalid/forged".to_string(),
            content_digest: format!("sha256:{}", "f".repeat(64)),
            observed_at: "2026-08-23T00:00:00Z".to_string(),
            source_cut: "caller-source-cut-v1".to_string(),
            license_basis: "caller".to_string(),
            interpretation: "forged".to_string(),
        });
        assert_ne!(
            canonical_research_view_identity_v2(&foreign_source),
            identity
        );
    }

    fn request_v2(request_identity: &str) -> ProductEdgeResearchGoalRequestV2 {
        ProductEdgeResearchGoalRequestV2 {
            request_identity: request_identity.to_string(),
            channel: ProductEdgeChannel::WindmillProductEdge,
            admission: ProductEdgeAdmissionLocatorV1 {
                request_identity: request_identity.to_string(),
                admission_identity: "product-edge-admission-test-v1".to_string(),
                admission_digest: format!("sha256:{}", "b".repeat(64)),
            },
            goal: SourcedResearchGoalV2 {
                hypothesis: "A bounded point-in-time momentum effect persists after exact costs."
                    .to_string(),
                mechanism: "Slow information diffusion creates bounded continuation.".to_string(),
                falsification_question:
                    "Does the bounded effect disappear after exact modeled costs?".to_string(),
                expected_observation: "Net continuation remains positive.".to_string(),
                required_data: vec!["PIT adjusted bars".to_string()],
                cost_assumption: "Exact model identity below.".to_string(),
                capacity_assumption: "Capacity model identity below.".to_string(),
                sources: vec![ResearchSourceV1 {
                    locator: "https://example.com/research".to_string(),
                    content_digest: format!("sha256:{}", "a".repeat(64)),
                    observed_at: "2026-08-21T00:00:00Z".to_string(),
                    source_cut: "source-cut-v1".to_string(),
                    license_basis: "public research".to_string(),
                    interpretation: "Bounded source interpretation only.".to_string(),
                }],
            },
            trial_family_proposal: TrialFamilyProposalV1 {
                trial_budget: 8,
                stop_rule: "Stop on falsifier, exhausted budget, or unavailable PIT input."
                    .to_string(),
                pit_rule_identity: "pit-rule-v1".to_string(),
                cost_model_identity: "cost-model-v1".to_string(),
                slippage_model_identity: "slippage-model-v1".to_string(),
                capacity_model_identity: "capacity-model-v1".to_string(),
                independence_rationale: "No known local predecessor before Owner resolution."
                    .to_string(),
            },
        }
    }

    fn research_view(projection_at_epoch_ms: u64, valid_through_epoch_ms: u64) -> ResearchViewV1 {
        ResearchViewV1 {
            schema_version: 1,
            projection_identity: "rd-research-view-test-v1".to_string(),
            request_identity: "research-request-test-v1".to_string(),
            trusted_principal: "admin".to_string(),
            authorized_scope: vec![
                RESEARCH_SCOPE_V1.to_string(),
                RESEARCH_VIEW_SCOPE_V1.to_string(),
            ],
            authorization_policy_cut: "operator-frontier-test-v1".to_string(),
            source_owner: RESEARCH_OWNER_V1.to_string(),
            source_cut: "rd-source-cut-test-v1".to_string(),
            observed_at_epoch_ms: 1_000,
            projection_at_epoch_ms,
            valid_through_epoch_ms,
            availability: ResearchViewAvailability::Available,
            phase: ResearchViewPhase::IntentFrozen,
            intent_identity: "rd-research-intent-test-v1".to_string(),
            source_frontier: Vec::new(),
            attempt_identity: None,
            artifact_identity: None,
            build_receipt_identity: None,
            artifact_review_identity: None,
            next_legal_action: ResearchNextLegalAction::WaitForRAndDExecution,
        }
    }
}
