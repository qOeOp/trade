use std::{collections::BTreeMap, sync::Mutex};

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;

pub const RESEARCH_GOAL_OPERATION_V1: &str = "research_goal.submit_or_resolve.v1";
pub const RESEARCH_GOAL_SCHEMA_V1: &str = "sourced-research-goal-v1";
pub const RESEARCH_OWNER_V1: &str = "R_AND_D";
pub const RESEARCH_SCOPE_V1: &str = "research:submit";
pub const RESEARCH_VIEW_SCOPE_V1: &str = "research:view";

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ProductEdgeResearchGoalRequestV1 {
    pub request_identity: String,
    pub channel: ProductEdgeChannel,
    pub context: TrustedProductEdgeContextV1,
    pub goal: SourcedResearchGoalV1,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ProductEdgeChannel {
    App,
    Mcp,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct TrustedProductEdgeContextV1 {
    pub effective_principal: String,
    pub permissioned_as: String,
    pub authorized_scope: Vec<String>,
    pub shell_binding_identity: String,
    pub shell_history_head: String,
    pub shell_binding_generation: u64,
    pub shell_binding_state: String,
    pub authorization_identity: String,
    pub authorization_policy_version: String,
    pub manifest_identity: String,
    pub manifest_version: String,
    pub capability_policy_version: String,
    pub audit_policy_version: String,
    pub target_owner: String,
    pub target_operation: String,
    pub operation_schema: String,
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

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ResearchGoalOwnerResultV1 {
    pub schema_version: u32,
    pub resolution: ProductEdgeResolution,
    pub request_identity: String,
    pub owner_receipt: Option<ResearchRequestReceiptV1>,
    pub research_view: Option<ResearchViewV1>,
    pub next_legal_action: ResearchNextLegalAction,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ProductEdgeResolution {
    Accepted,
    RejectedNoWrite,
    SubmittedOrUnknown,
    IdentityConflict,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResearchGoalCommitV1 {
    pub receipt: ResearchRequestReceiptV1,
    pub intent: Option<FrozenResearchGoalIntentV1>,
    pub view: Option<ResearchViewV1>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProductEdgeAdmissionPolicyV1 {
    pub effective_principal: String,
    pub permissioned_as: String,
    pub shell_binding_identity: String,
    pub shell_history_head: String,
    pub authorization_identity: String,
    pub authorization_policy_version: String,
    pub manifest_identity: String,
    pub manifest_version: String,
    pub capability_policy_version: String,
    pub audit_policy_version: String,
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
pub trait ResearchGoalOwnerPort: Send + Sync {
    async fn submit(
        &self,
        request: ProductEdgeResearchGoalRequestV1,
    ) -> Result<ResearchGoalOwnerResultV1, ResearchGoalOwnerError>;

    async fn resolve(
        &self,
        request_identity: &str,
        context: &TrustedProductEdgeContextV1,
    ) -> Result<ResearchGoalOwnerResultV1, ResearchGoalOwnerError>;
}

#[derive(Debug)]
pub struct InMemoryResearchGoalOwnerV1 {
    policy: ProductEdgeAdmissionPolicyV1,
    commits: Mutex<BTreeMap<String, ResearchGoalCommitV1>>,
}

impl InMemoryResearchGoalOwnerV1 {
    pub fn new(policy: ProductEdgeAdmissionPolicyV1) -> Self {
        Self {
            policy,
            commits: Mutex::new(BTreeMap::new()),
        }
    }
}

#[async_trait]
impl ResearchGoalOwnerPort for InMemoryResearchGoalOwnerV1 {
    async fn submit(
        &self,
        request: ProductEdgeResearchGoalRequestV1,
    ) -> Result<ResearchGoalOwnerResultV1, ResearchGoalOwnerError> {
        validate_context(&request.context, &self.policy)?;
        let semantic_digest = semantic_digest(&request)?;
        let mut commits = self
            .commits
            .lock()
            .map_err(|_| ResearchGoalOwnerError::Storage("in-memory lock poisoned".to_string()))?;

        if let Some(existing) = commits.get(&request.request_identity) {
            if existing.receipt.semantic_digest != semantic_digest {
                return Err(ResearchGoalOwnerError::ConflictingReplay);
            }
            return Ok(result_from_commit(existing.clone()));
        }
        let commit = decide_commit(request, semantic_digest, current_epoch_ms()?);
        let result = result_from_commit(commit.clone());
        commits.insert(commit.receipt.request_identity.clone(), commit);
        Ok(result)
    }

    async fn resolve(
        &self,
        request_identity: &str,
        context: &TrustedProductEdgeContextV1,
    ) -> Result<ResearchGoalOwnerResultV1, ResearchGoalOwnerError> {
        validate_context(context, &self.policy)?;
        validate_request_identity(request_identity).map_err(|_| {
            ResearchGoalOwnerError::Unauthorized("malformed request identity for lookup")
        })?;
        let commits = self
            .commits
            .lock()
            .map_err(|_| ResearchGoalOwnerError::Storage("in-memory lock poisoned".to_string()))?;
        Ok(match commits.get(request_identity) {
            Some(commit) => result_from_commit(commit.clone()),
            None => unresolved_result(request_identity),
        })
    }
}

pub fn validate_context(
    context: &TrustedProductEdgeContextV1,
    policy: &ProductEdgeAdmissionPolicyV1,
) -> Result<(), ResearchGoalOwnerError> {
    let exact_scope = [
        RESEARCH_SCOPE_V1.to_string(),
        RESEARCH_VIEW_SCOPE_V1.to_string(),
    ];

    if context.effective_principal != policy.effective_principal {
        return Err(ResearchGoalOwnerError::Unauthorized("effective principal"));
    }

    if context.permissioned_as != policy.permissioned_as {
        return Err(ResearchGoalOwnerError::Unauthorized("permissioned_as"));
    }

    if context.authorized_scope != exact_scope {
        return Err(ResearchGoalOwnerError::Unauthorized("scope"));
    }

    if context.shell_binding_identity != policy.shell_binding_identity
        || context.shell_history_head != policy.shell_history_head
        || context.shell_binding_generation != 1
        || context.shell_binding_state != "ACTIVE"
    {
        return Err(ResearchGoalOwnerError::Unauthorized(
            "shell binding/history head",
        ));
    }

    if context.authorization_identity != policy.authorization_identity
        || context.authorization_policy_version != policy.authorization_policy_version
    {
        return Err(ResearchGoalOwnerError::Unauthorized(
            "operator authorization",
        ));
    }

    if context.manifest_identity != policy.manifest_identity
        || context.manifest_version != policy.manifest_version
        || context.capability_policy_version != policy.capability_policy_version
        || context.audit_policy_version != policy.audit_policy_version
    {
        return Err(ResearchGoalOwnerError::Unauthorized(
            "operation manifest/policy",
        ));
    }

    if context.target_owner != RESEARCH_OWNER_V1
        || context.target_operation != RESEARCH_GOAL_OPERATION_V1
        || context.operation_schema != RESEARCH_GOAL_SCHEMA_V1
    {
        return Err(ResearchGoalOwnerError::Unauthorized("target operation"));
    }
    Ok(())
}

pub fn semantic_digest(
    request: &ProductEdgeResearchGoalRequestV1,
) -> Result<String, ResearchGoalOwnerError> {
    #[derive(Serialize)]
    struct Meaning<'a> {
        request_identity: &'a str,
        context: &'a TrustedProductEdgeContextV1,
        goal: &'a SourcedResearchGoalV1,
    }
    let bytes = serde_json::to_vec(&Meaning {
        request_identity: &request.request_identity,
        context: &request.context,
        goal: &request.goal,
    })
    .map_err(|e| ResearchGoalOwnerError::Storage(e.to_string()))?;
    Ok(format!("sha256:{:x}", Sha256::digest(bytes)))
}

pub fn decide_commit(
    request: ProductEdgeResearchGoalRequestV1,
    semantic_digest: String,
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
        trusted_principal: request.context.effective_principal,
        authorized_scope: request.context.authorized_scope,
        authorization_policy_cut: request.context.authorization_policy_version,
        source_owner: RESEARCH_OWNER_V1.to_string(),
        source_cut,
        observed_at_epoch_ms: now_epoch_ms,
        projection_at_epoch_ms: now_epoch_ms,
        valid_through_epoch_ms: now_epoch_ms.saturating_add(600_000),
        availability: ResearchViewAvailability::Available,
        phase: ResearchViewPhase::IntentFrozen,
        intent_identity: intent_identity.clone(),
        source_frontier: intent.source_frontier.clone(),
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

pub fn result_from_commit(commit: ResearchGoalCommitV1) -> ResearchGoalOwnerResultV1 {
    let now_epoch_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .ok()
        .and_then(|duration| u64::try_from(duration.as_millis()).ok())
        .unwrap_or(u64::MAX);
    result_from_commit_at(commit, now_epoch_ms)
}

pub fn result_from_commit_at(
    mut commit: ResearchGoalCommitV1,
    now_epoch_ms: u64,
) -> ResearchGoalOwnerResultV1 {
    if let Some(view) = commit.view.as_mut()
        && now_epoch_ms > view.valid_through_epoch_ms
    {
        view.availability = ResearchViewAvailability::Stale;
        view.projection_at_epoch_ms = now_epoch_ms;
    }
    let (resolution, next_legal_action) = match commit.receipt.disposition {
        ResearchRequestDisposition::Accepted => (
            ProductEdgeResolution::Accepted,
            commit
                .view
                .as_ref()
                .map_or(ResearchNextLegalAction::WaitForRAndDExecution, |view| {
                    view.next_legal_action
                }),
        ),
        ResearchRequestDisposition::RejectedNoWrite => (
            ProductEdgeResolution::RejectedNoWrite,
            ResearchNextLegalAction::CorrectInputAndCreateSuccessorRequest,
        ),
    };
    ResearchGoalOwnerResultV1 {
        schema_version: 1,
        resolution,
        request_identity: commit.receipt.request_identity.clone(),
        owner_receipt: Some(commit.receipt),
        research_view: commit.view,
        next_legal_action,
    }
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
    validate_request_identity(&request.request_identity)?;
    require_text(&request.goal.hypothesis, 16, 2_000, "HYPOTHESIS_INVALID")?;
    require_text(&request.goal.mechanism, 16, 2_000, "MECHANISM_INVALID")?;
    require_text(
        &request.goal.falsification_question,
        16,
        2_000,
        "FALSIFICATION_QUESTION_INVALID",
    )?;
    require_text(
        &request.goal.expected_observation,
        8,
        2_000,
        "EXPECTED_OBSERVATION_INVALID",
    )?;
    require_text(
        &request.goal.cost_assumption,
        4,
        1_000,
        "COST_ASSUMPTION_INVALID",
    )?;
    require_text(
        &request.goal.capacity_assumption,
        4,
        1_000,
        "CAPACITY_ASSUMPTION_INVALID",
    )?;
    require_text(
        &request.goal.protected_feedback_frontier,
        4,
        512,
        "PROTECTED_FEEDBACK_FRONTIER_INVALID",
    )?;

    if request.goal.required_data.is_empty()
        || request.goal.required_data.len() > 16
        || request
            .goal
            .required_data
            .iter()
            .any(|value| require_text(value, 2, 256, "REQUIRED_DATA_INVALID").is_err())
    {
        return Err("REQUIRED_DATA_INVALID");
    }

    if request.goal.sources.is_empty() || request.goal.sources.len() > 16 {
        return Err("SOURCE_SET_INVALID");
    }

    for source in &request.goal.sources {
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

fn current_epoch_ms() -> Result<u64, ResearchGoalOwnerError> {
    let duration = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| ResearchGoalOwnerError::Storage(e.to_string()))?;
    u64::try_from(duration.as_millis()).map_err(|e| ResearchGoalOwnerError::Storage(e.to_string()))
}
