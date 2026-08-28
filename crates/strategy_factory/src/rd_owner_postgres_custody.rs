use std::{collections::BTreeMap, fmt::Display};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{PgPool, Row, postgres::PgRow};
use vibe_product_edge::{
    DownstreamAdmissionModeV1, ProductEdgeAdmissionReadbackV1,
    resolve_admission_for_downstream_in_transaction,
};
use vibe_qualification::{
    ProtectedFeedbackFrontierReadbackV1, admit_historical_projection_in_transaction,
};

use crate::{
    product_edge::{
        FrozenResearchGoalIntent, FrozenResearchGoalIntentV1, FrozenResearchGoalIntentV2,
        IndependenceBasisReadbackV1, IndependenceBasisReceiptV1, ProductEdgeResearchGoalRequestV1,
        ProductEdgeResolution, RESEARCH_OWNER_V1, RESEARCH_SCOPE_V1, RESEARCH_VIEW_SCOPE_V1,
        ResearchGoalCommitV1, ResearchGoalCommitV2, ResearchGoalOwnerError,
        ResearchGoalOwnerResultV1, ResearchGoalOwnerResultV2, ResearchNextLegalAction,
        ResearchRequestDisposition, ResearchRequestReceiptV1, ResearchViewV1,
        SourcedResearchGoalV2, StoredAdmittedResearchRequestV2, StoredIndependenceBasisV1,
        StoredProtectedFeedbackProjectionV1, StoredRejectedResearchRequestV2,
        TrialFamilyProposalV1, canonical_research_view_identity_v2, canonical_v2_intent_identity,
        decide_commit, decide_commit_v2, decide_rejected_commit_v2, semantic_digest,
        semantic_digest_v2, terminal_research_view_identity, validate_goal_request_v2,
        validate_legacy_goal_meaning, verify_research_admission_v1, verify_research_admission_v2,
        verify_source_bound_research_admission_v2,
    },
    trial_family::{
        TrialFamilyPolicyV1, TrialFamilyReadbackV1, TrialFamilyResolutionV1, form_initial_family,
    },
    trial_family_postgres::load_trial_family_in_transaction,
};

pub(crate) async fn require_rd_owner_api_schema(pool: &PgPool) -> Result<(), sqlx::Error> {
    let owner: Option<String> = sqlx::query_scalar(
        "SELECT pg_catalog.pg_get_userbyid(namespace.nspowner)
           FROM pg_catalog.pg_namespace namespace
          WHERE namespace.nspname = 'rd_owner_api'",
    )
    .fetch_optional(pool)
    .await?;

    if owner.as_deref() != Some("rd_owner") {
        return Err(sqlx::Error::Protocol(
            "canonical rd_owner_api schema unavailable".to_string(),
        ));
    }

    Ok(())
}

#[derive(Clone, Copy)]
pub(crate) enum ResearchCustodyLookupV1<'a> {
    RequestAny(&'a str),
    RequestV1(&'a str),
    RequestV2(&'a str),
    Intent(&'a str),
}

pub(crate) struct VerifiedResearchCustodyV1 {
    request_json: Option<serde_json::Value>,
    receipt: ResearchRequestReceiptV1,
    intent: Option<FrozenResearchGoalIntent>,
    view: Option<ResearchViewV1>,
    family: Option<TrialFamilyReadbackV1>,
    expected_family: Option<TrialFamilyReadbackV1>,
    independence_basis: Option<IndependenceBasisReadbackV1>,
    protected_feedback: Option<ProtectedFeedbackFrontierReadbackV1>,
    authority: VerifiedResearchAuthorityV1,
    effective_principal: String,
    authorized_scope: Vec<String>,
    request_schema_version: u32,
    terminal_attempt_admission: Option<Box<ProductEdgeAdmissionReadbackV1>>,
}

enum VerifiedResearchAuthorityV1 {
    Current(Box<ProductEdgeAdmissionReadbackV1>),
    LegacyQuarantined,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct LegacyResearchViewV1 {
    schema_version: u32,
    projection_identity: String,
    request_identity: String,
    trusted_principal: String,
    authorized_scope: Vec<String>,
    authorization_policy_cut: String,
    source_owner: String,
    source_cut: String,
    observed_at_epoch_ms: u64,
    projection_at_epoch_ms: u64,
    valid_through_epoch_ms: u64,
    availability: String,
    phase: String,
    intent_identity: String,
    source_frontier: Vec<crate::product_edge::ResearchSourceV1>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    attempt_identity: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    artifact_identity: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    build_receipt_identity: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    artifact_review_identity: Option<String>,
    next_legal_action: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    exploratory_frontier: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    exploratory_replay_request_identity: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    exploratory_result_digest: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    exploratory_result_ref: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    exploratory_run_attempt_identity: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    exploratory_summary: Option<serde_json::Value>,
}

struct VerifiedLegacyResearchCommitV1 {
    intent: Option<FrozenResearchGoalIntentV1>,
    effective_principal: String,
    authorized_scope: Vec<String>,
    request_schema_version: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct LegacySelfAuthorizedContextV2 {
    effective_principal: String,
    permissioned_as: String,
    authorized_scope: Vec<String>,
    shell_binding_identity: String,
    shell_history_head: String,
    shell_binding_generation: u64,
    shell_binding_state: String,
    authorization_identity: String,
    authorization_policy_version: String,
    manifest_identity: String,
    manifest_version: String,
    capability_policy_version: String,
    audit_policy_version: String,
    target_owner: String,
    target_operation: String,
    operation_schema: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct LegacySelfAuthorizedGoalV2 {
    hypothesis: String,
    mechanism: String,
    falsification_question: String,
    expected_observation: String,
    required_data: Vec<String>,
    cost_assumption: String,
    capacity_assumption: String,
    protected_feedback_frontier: String,
    sources: Vec<crate::product_edge::ResearchSourceV1>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct LegacySelfAuthorizedTrialFamilyPolicyV1 {
    trial_budget: u32,
    stop_rule: String,
    pit_rule_identity: String,
    cost_model_identity: String,
    slippage_model_identity: String,
    capacity_model_identity: String,
    semantic_predecessor_frontier: Vec<String>,
    protected_feedback_frontier: String,
    independence_disposition: String,
    independence_basis_identity: String,
    frozen_falsifier_binding: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct LegacySelfAuthorizedResearchRequestV2 {
    request_identity: String,
    channel: crate::product_edge::ProductEdgeChannel,
    context: LegacySelfAuthorizedContextV2,
    goal: LegacySelfAuthorizedGoalV2,
    trial_family_policy: LegacySelfAuthorizedTrialFamilyPolicyV1,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct LegacySelfAuthorizedIntentV2 {
    schema_version: u32,
    intent_identity: String,
    request_identity: String,
    semantic_digest: String,
    source_frontier: Vec<crate::product_edge::ResearchSourceV1>,
    goal: LegacySelfAuthorizedGoalV2,
    trial_family_identity: String,
    trial_family_policy_digest: String,
    frozen_at_epoch_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct LegacyCandidateResearchRequestV2 {
    request_identity: String,
    channel: crate::product_edge::ProductEdgeChannel,
    context: LegacySelfAuthorizedContextV2,
    goal: SourcedResearchGoalV2,
    trial_family_proposal: TrialFamilyProposalV1,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct LegacyCandidateStoredAdmittedResearchRequestV2 {
    schema_version: u32,
    request: LegacyCandidateResearchRequestV2,
    independence_basis: StoredIndependenceBasisV1,
    protected_feedback: StoredProtectedFeedbackProjectionV1,
    canonical_trial_family_policy: TrialFamilyPolicyV1,
}

enum PreadmittedResearchAuthorityV1 {
    Current {
        research: Box<ProductEdgeAdmissionReadbackV1>,
        terminal_attempt: Option<Box<ProductEdgeAdmissionReadbackV1>>,
    },
    LegacyQuarantined,
}

enum ExpectedResearchCommitV1 {
    V1(Box<ResearchGoalCommitV1>),
    V2Accepted(Box<ResearchGoalCommitV2>),
    V2Rejected(Box<ResearchGoalCommitV2>),
}

impl ExpectedResearchCommitV1 {
    fn receipt(&self) -> &ResearchRequestReceiptV1 {
        match self {
            Self::V1(v) => &v.receipt,
            Self::V2Accepted(v) | Self::V2Rejected(v) => &v.receipt,
        }
    }
    fn intent(&self) -> Option<FrozenResearchGoalIntent> {
        match self {
            Self::V1(v) => v.intent.clone().map(FrozenResearchGoalIntent::V1),
            Self::V2Accepted(v) => v.intent.clone().map(FrozenResearchGoalIntent::V2),
            Self::V2Rejected(_) => None,
        }
    }
    fn view(&self) -> Option<&ResearchViewV1> {
        match self {
            Self::V1(v) => v.view.as_ref(),
            Self::V2Accepted(v) => v.view.as_ref(),
            Self::V2Rejected(_) => None,
        }
    }
    fn family(&self) -> Option<&TrialFamilyReadbackV1> {
        match self {
            Self::V1(_) => None,
            Self::V2Accepted(v) => v.initial_family.as_ref(),
            Self::V2Rejected(_) => None,
        }
    }
}

fn verify_legacy_quarantined_commit(
    receipt: &ResearchRequestReceiptV1,
    intent_json: Option<&serde_json::Value>,
    view_json: Option<&serde_json::Value>,
) -> Result<VerifiedLegacyResearchCommitV1, ResearchGoalOwnerError> {
    if receipt.schema_version != 1
        || receipt.request_identity.trim().is_empty()
        || !is_sha256_digest(&receipt.semantic_digest)
    {
        return Err(ResearchGoalOwnerError::Storage(
            "legacy research receipt is not canonical".into(),
        ));
    }
    let suffix = format!(
        "{:x}",
        Sha256::digest(
            format!("{}:{}", receipt.request_identity, receipt.semantic_digest).as_bytes()
        )
    );

    if receipt.receipt_identity != format!("rd-research-request-receipt-v1-{suffix}") {
        return Err(ResearchGoalOwnerError::Storage(
            "legacy research receipt identity mismatch".into(),
        ));
    }

    match receipt.disposition {
        ResearchRequestDisposition::RejectedNoWrite => {
            if receipt.resulting_research_intent_identity.is_some()
                || receipt.rejection_code.as_deref().is_none_or(str::is_empty)
                || intent_json.is_some()
                || view_json.is_some()
            {
                return Err(ResearchGoalOwnerError::Storage(
                    "legacy rejected custody mismatch".into(),
                ));
            }
            Ok(VerifiedLegacyResearchCommitV1 {
                intent: None,
                effective_principal: String::new(),
                authorized_scope: Vec::new(),
                request_schema_version: 1,
            })
        }
        ResearchRequestDisposition::Accepted => {
            if receipt.rejection_code.is_some() {
                return Err(ResearchGoalOwnerError::Storage(
                    "legacy accepted receipt has rejection".into(),
                ));
            }
            let intent: FrozenResearchGoalIntentV1 =
                decode_exact(intent_json.ok_or_else(|| {
                    ResearchGoalOwnerError::Storage("legacy intent missing".into())
                })?)?;
            let expected_intent_identity = format!("rd-research-intent-v1-{suffix}");
            if intent.schema_version != 1
                || intent.intent_identity != expected_intent_identity
                || receipt.resulting_research_intent_identity.as_deref()
                    != Some(expected_intent_identity.as_str())
                || intent.request_identity != receipt.request_identity
                || intent.semantic_digest != receipt.semantic_digest
                || intent.frozen_at_epoch_ms != receipt.committed_at_epoch_ms
                || intent.source_frontier != intent.goal.sources
                || validate_legacy_goal_meaning(&intent.request_identity, &intent.goal).is_err()
            {
                return Err(ResearchGoalOwnerError::Storage(
                    "legacy intent custody mismatch".into(),
                ));
            }
            let view_json = view_json.ok_or_else(|| {
                ResearchGoalOwnerError::Storage("legacy research view missing".into())
            })?;
            let view = verify_legacy_research_view(
                receipt,
                &suffix,
                &intent.intent_identity,
                &intent.source_frontier,
                "v1",
                view_json,
            )?;
            Ok(VerifiedLegacyResearchCommitV1 {
                intent: Some(intent),
                effective_principal: view.trusted_principal,
                authorized_scope: view.authorized_scope,
                request_schema_version: 1,
            })
        }
    }
}

async fn verify_legacy_missing_request_v2(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    receipt: &ResearchRequestReceiptV1,
    intent_json: Option<&serde_json::Value>,
    view_json: Option<&serde_json::Value>,
) -> Result<VerifiedLegacyResearchCommitV1, ResearchGoalOwnerError> {
    let suffix = format!(
        "{:x}",
        Sha256::digest(
            format!(
                "v2:{}:{}",
                receipt.request_identity, receipt.semantic_digest
            )
            .as_bytes()
        )
    );

    if receipt.schema_version != 1
        || receipt.request_identity.trim().is_empty()
        || !is_sha256_digest(&receipt.semantic_digest)
        || receipt.receipt_identity != format!("rd-research-request-receipt-v2-{suffix}")
    {
        return Err(ResearchGoalOwnerError::Storage(
            "legacy V2 receipt identity mismatch".into(),
        ));
    }

    match receipt.disposition {
        ResearchRequestDisposition::RejectedNoWrite => {
            if receipt.resulting_research_intent_identity.is_some()
                || receipt.rejection_code.as_deref().is_none_or(str::is_empty)
                || intent_json.is_some()
                || view_json.is_some()
            {
                return Err(ResearchGoalOwnerError::Storage(
                    "legacy V2 rejected custody mismatch".into(),
                ));
            }
            Ok(VerifiedLegacyResearchCommitV1 {
                intent: None,
                effective_principal: String::new(),
                authorized_scope: Vec::new(),
                request_schema_version: 2,
            })
        }
        ResearchRequestDisposition::Accepted => {
            if receipt.rejection_code.is_some() {
                return Err(ResearchGoalOwnerError::Storage(
                    "legacy V2 accepted receipt has rejection".into(),
                ));
            }
            let intent: LegacySelfAuthorizedIntentV2 =
                decode_exact(intent_json.ok_or_else(|| {
                    ResearchGoalOwnerError::Storage("legacy V2 intent missing".into())
                })?)?;
            let intent_identity = format!("rd-research-intent-v2-{suffix}");
            let legacy_goal = crate::product_edge::SourcedResearchGoalV1 {
                hypothesis: intent.goal.hypothesis.clone(),
                mechanism: intent.goal.mechanism.clone(),
                falsification_question: intent.goal.falsification_question.clone(),
                expected_observation: intent.goal.expected_observation.clone(),
                required_data: intent.goal.required_data.clone(),
                cost_assumption: intent.goal.cost_assumption.clone(),
                capacity_assumption: intent.goal.capacity_assumption.clone(),
                protected_feedback_frontier: intent.goal.protected_feedback_frontier.clone(),
                sources: intent.goal.sources.clone(),
            };

            if intent.schema_version != 2
                || intent.intent_identity != intent_identity
                || receipt.resulting_research_intent_identity.as_deref()
                    != Some(intent_identity.as_str())
                || intent.request_identity != receipt.request_identity
                || intent.semantic_digest != receipt.semantic_digest
                || intent.source_frontier != intent.goal.sources
                || intent.frozen_at_epoch_ms != receipt.committed_at_epoch_ms
                || intent.trial_family_identity.trim().is_empty()
                || !is_sha256_digest(&intent.trial_family_policy_digest)
                || validate_legacy_goal_meaning(&intent.request_identity, &legacy_goal).is_err()
            {
                return Err(ResearchGoalOwnerError::Storage(
                    "legacy V2 intent custody mismatch".into(),
                ));
            }
            let family = load_trial_family_in_transaction(
                transaction,
                &intent.intent_identity,
                &receipt.receipt_identity,
            )
            .await
            .map_err(|e| ResearchGoalOwnerError::Storage(e.to_string()))?;
            if family.root.trial_family_identity() != intent.trial_family_identity
                || family.root.policy_digest() != intent.trial_family_policy_digest
            {
                return Err(ResearchGoalOwnerError::Storage(
                    "legacy V2 family custody mismatch".into(),
                ));
            }
            let view = verify_legacy_research_view(
                receipt,
                &suffix,
                &intent.intent_identity,
                &intent.source_frontier,
                "v2",
                view_json.ok_or_else(|| {
                    ResearchGoalOwnerError::Storage("legacy V2 research view missing".into())
                })?,
            )?;
            Ok(VerifiedLegacyResearchCommitV1 {
                intent: None,
                effective_principal: view.trusted_principal,
                authorized_scope: view.authorized_scope,
                request_schema_version: 2,
            })
        }
    }
}

async fn verify_legacy_self_authorized_v2(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    receipt: &ResearchRequestReceiptV1,
    request: &LegacySelfAuthorizedResearchRequestV2,
    intent_json: Option<&serde_json::Value>,
    view_json: Option<&serde_json::Value>,
) -> Result<VerifiedLegacyResearchCommitV1, ResearchGoalOwnerError> {
    #[derive(Serialize)]
    struct Meaning<'a> {
        request_identity: &'a str,
        context: &'a LegacySelfAuthorizedContextV2,
        goal: &'a LegacySelfAuthorizedGoalV2,
        trial_family_policy: &'a LegacySelfAuthorizedTrialFamilyPolicyV1,
    }
    let semantic_digest = format!(
        "sha256:{:x}",
        Sha256::digest(
            serde_json::to_vec(&Meaning {
                request_identity: &request.request_identity,
                context: &request.context,
                goal: &request.goal,
                trial_family_policy: &request.trial_family_policy,
            })
            .map_err(json_storage)?
        )
    );
    let suffix = format!(
        "{:x}",
        Sha256::digest(format!("v2:{}:{semantic_digest}", request.request_identity).as_bytes())
    );

    if receipt.schema_version != 1
        || request.request_identity != receipt.request_identity
        || semantic_digest != receipt.semantic_digest
        || receipt.receipt_identity != format!("rd-research-request-receipt-v2-{suffix}")
    {
        return Err(ResearchGoalOwnerError::Storage(
            "legacy self-authorized request receipt mismatch".into(),
        ));
    }

    match receipt.disposition {
        ResearchRequestDisposition::RejectedNoWrite => {
            if receipt.resulting_research_intent_identity.is_some()
                || receipt.rejection_code.as_deref().is_none_or(str::is_empty)
                || intent_json.is_some()
                || view_json.is_some()
            {
                return Err(ResearchGoalOwnerError::Storage(
                    "legacy self-authorized rejection mismatch".into(),
                ));
            }
            Ok(VerifiedLegacyResearchCommitV1 {
                intent: None,
                effective_principal: String::new(),
                authorized_scope: Vec::new(),
                request_schema_version: 2,
            })
        }
        ResearchRequestDisposition::Accepted => {
            if receipt.rejection_code.is_some() {
                return Err(ResearchGoalOwnerError::Storage(
                    "legacy self-authorized accepted receipt mismatch".into(),
                ));
            }
            let intent: LegacySelfAuthorizedIntentV2 =
                decode_exact(intent_json.ok_or_else(|| {
                    ResearchGoalOwnerError::Storage("legacy self-authorized intent missing".into())
                })?)?;
            let expected_intent_identity = format!("rd-research-intent-v2-{suffix}");
            if intent.schema_version != 2
                || intent.intent_identity != expected_intent_identity
                || receipt.resulting_research_intent_identity.as_deref()
                    != Some(expected_intent_identity.as_str())
                || intent.request_identity != request.request_identity
                || intent.semantic_digest != semantic_digest
                || intent.source_frontier != request.goal.sources
                || intent.goal != request.goal
                || intent.frozen_at_epoch_ms != receipt.committed_at_epoch_ms
                || intent.trial_family_identity.trim().is_empty()
                || !is_sha256_digest(&intent.trial_family_policy_digest)
            {
                return Err(ResearchGoalOwnerError::Storage(
                    "legacy self-authorized intent mismatch".into(),
                ));
            }
            let family = load_trial_family_in_transaction(
                transaction,
                &intent.intent_identity,
                &receipt.receipt_identity,
            )
            .await
            .map_err(|e| ResearchGoalOwnerError::Storage(e.to_string()))?;
            if family.root.trial_family_identity() != intent.trial_family_identity
                || family.root.policy_digest() != intent.trial_family_policy_digest
            {
                return Err(ResearchGoalOwnerError::Storage(
                    "legacy self-authorized family mismatch".into(),
                ));
            }
            let view = verify_legacy_research_view(
                receipt,
                &suffix,
                &intent.intent_identity,
                &intent.source_frontier,
                "v2",
                view_json.ok_or_else(|| {
                    ResearchGoalOwnerError::Storage("legacy self-authorized view missing".into())
                })?,
            )?;

            if view.trusted_principal != request.context.effective_principal
                || view.authorized_scope != request.context.authorized_scope
            {
                return Err(ResearchGoalOwnerError::Storage(
                    "legacy self-authorized view context mismatch".into(),
                ));
            }
            Ok(VerifiedLegacyResearchCommitV1 {
                intent: None,
                effective_principal: view.trusted_principal,
                authorized_scope: view.authorized_scope,
                request_schema_version: 2,
            })
        }
    }
}

async fn verify_legacy_candidate_admitted_v2(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    receipt: &ResearchRequestReceiptV1,
    stored: &LegacyCandidateStoredAdmittedResearchRequestV2,
    intent_json: Option<&serde_json::Value>,
    view_json: Option<&serde_json::Value>,
) -> Result<VerifiedLegacyResearchCommitV1, ResearchGoalOwnerError> {
    #[derive(Serialize)]
    struct Meaning<'a> {
        request_identity: &'a str,
        context: &'a LegacySelfAuthorizedContextV2,
        goal: &'a SourcedResearchGoalV2,
        trial_family_proposal: &'a TrialFamilyProposalV1,
    }
    let request = &stored.request;
    let semantic_digest = format!(
        "sha256:{:x}",
        Sha256::digest(
            serde_json::to_vec(&Meaning {
                request_identity: &request.request_identity,
                context: &request.context,
                goal: &request.goal,
                trial_family_proposal: &request.trial_family_proposal,
            })
            .map_err(json_storage)?
        )
    );
    let suffix = format!(
        "{:x}",
        Sha256::digest(format!("v2:{}:{semantic_digest}", request.request_identity).as_bytes())
    );
    let intent_identity = format!("rd-research-intent-v2-{suffix}");

    if stored.schema_version != 1
        || receipt.schema_version != 1
        || receipt.disposition != ResearchRequestDisposition::Accepted
        || receipt.rejection_code.is_some()
        || request.request_identity != receipt.request_identity
        || semantic_digest != receipt.semantic_digest
        || receipt.receipt_identity != format!("rd-research-request-receipt-v2-{suffix}")
        || receipt.resulting_research_intent_identity.as_deref() != Some(intent_identity.as_str())
    {
        return Err(ResearchGoalOwnerError::Storage(
            "legacy candidate request receipt mismatch".into(),
        ));
    }

    let basis_snapshot = &stored.independence_basis;
    let basis_digest = owner_digest(
        "rd.independence-basis.v1",
        &BasisMeaningV1 {
            schema_version: basis_snapshot.schema_version,
            request_identity: &basis_snapshot.request_identity,
            principal: &basis_snapshot.principal,
            request_scope: &basis_snapshot.request_scope,
            rationale_digest: &basis_snapshot.rationale_digest,
            independence_disposition: &basis_snapshot.independence_disposition,
            lineage_resolution: &basis_snapshot.lineage_resolution,
            semantic_predecessor_frontier: &basis_snapshot.semantic_predecessor_frontier,
            lineage_digest: &basis_snapshot.lineage_digest,
        },
    )?;
    let protected_snapshot = &stored.protected_feedback;

    if basis_snapshot.schema_version != 1
        || basis_snapshot.request_identity != request.request_identity
        || basis_snapshot.principal != request.context.effective_principal
        || basis_snapshot.request_scope != request.context.authorized_scope
        || basis_snapshot.basis_digest != basis_digest
        || basis_snapshot.basis_identity
            != owner_identity("rd-independence-basis-v1", &basis_digest)
        || protected_snapshot.projection_identity
            != owner_identity(
                "qualification-protected-feedback-frontier-v1",
                &protected_snapshot.projection_digest,
            )
        || !is_sha256_digest(&protected_snapshot.projection_digest)
        || protected_snapshot.source_cut.trim().is_empty()
        || protected_snapshot.valid_through_epoch_ms <= receipt.committed_at_epoch_ms
        || stored
            .canonical_trial_family_policy
            .semantic_predecessor_frontier
            != basis_snapshot.semantic_predecessor_frontier
        || stored
            .canonical_trial_family_policy
            .independence_disposition
            != basis_snapshot.independence_disposition
        || stored
            .canonical_trial_family_policy
            .independence_basis_identity
            != basis_snapshot.basis_identity
        || stored
            .canonical_trial_family_policy
            .protected_feedback_frontier
            != protected_snapshot.projection_identity
    {
        return Err(ResearchGoalOwnerError::Storage(
            "legacy candidate archived authority snapshot mismatch".into(),
        ));
    }

    let intent: FrozenResearchGoalIntentV2 = decode_exact(intent_json.ok_or_else(|| {
        ResearchGoalOwnerError::Storage("legacy candidate intent missing".into())
    })?)?;
    let expected_family = form_initial_family(
        &intent_identity,
        &semantic_digest,
        stored.canonical_trial_family_policy.clone(),
        receipt.committed_at_epoch_ms,
    )
    .map_err(|e| ResearchGoalOwnerError::Storage(e.to_string()))?;
    let family =
        load_trial_family_in_transaction(transaction, &intent_identity, &receipt.receipt_identity)
            .await
            .map_err(|e| ResearchGoalOwnerError::Storage(e.to_string()))?;
    if family != expected_family
        || intent.schema_version != 2
        || intent.intent_identity != intent_identity
        || intent.request_identity != request.request_identity
        || intent.semantic_digest != semantic_digest
        || intent.source_frontier != request.goal.sources
        || intent.goal != request.goal
        || intent.independence_basis_identity != basis_snapshot.basis_identity
        || intent.independence_basis_digest != basis_snapshot.basis_digest
        || intent.protected_feedback_projection_identity != protected_snapshot.projection_identity
        || intent.protected_feedback_projection_digest != protected_snapshot.projection_digest
        || intent.trial_family_identity != family.root.trial_family_identity()
        || intent.trial_family_policy_digest != family.root.policy_digest()
        || intent.frozen_at_epoch_ms != receipt.committed_at_epoch_ms
    {
        return Err(ResearchGoalOwnerError::Storage(
            "legacy candidate intent or family mismatch".into(),
        ));
    }
    let view = verify_legacy_research_view(
        receipt,
        &suffix,
        &intent.intent_identity,
        &intent.source_frontier,
        "v2",
        view_json.ok_or_else(|| {
            ResearchGoalOwnerError::Storage("legacy candidate view missing".into())
        })?,
    )?;

    if view.trusted_principal != request.context.effective_principal
        || view.authorized_scope != request.context.authorized_scope
        || view.authorization_policy_cut != request.context.authorization_policy_version
    {
        return Err(ResearchGoalOwnerError::Storage(
            "legacy candidate view context mismatch".into(),
        ));
    }
    Ok(VerifiedLegacyResearchCommitV1 {
        intent: None,
        effective_principal: view.trusted_principal,
        authorized_scope: view.authorized_scope,
        request_schema_version: 2,
    })
}

fn verify_legacy_research_view(
    receipt: &ResearchRequestReceiptV1,
    suffix: &str,
    intent_identity: &str,
    source_frontier: &[crate::product_edge::ResearchSourceV1],
    initial_source_version: &str,
    view_json: &serde_json::Value,
) -> Result<LegacyResearchViewV1, ResearchGoalOwnerError> {
    let view: LegacyResearchViewV1 = decode_exact(view_json)?;
    if view.schema_version != 1
        || view.request_identity != receipt.request_identity
        || view.trusted_principal.trim().is_empty()
        || view.authorized_scope
            != [
                RESEARCH_SCOPE_V1.to_string(),
                RESEARCH_VIEW_SCOPE_V1.to_string(),
            ]
        || view.authorization_policy_cut.trim().is_empty()
        || view.source_owner != RESEARCH_OWNER_V1
        || view.intent_identity != intent_identity
        || view.source_frontier != source_frontier
        || view.availability != "AVAILABLE"
        || view.observed_at_epoch_ms != view.projection_at_epoch_ms
        || view.valid_through_epoch_ms != view.projection_at_epoch_ms.saturating_add(600_000)
        || serde_json::to_value(&view).map_err(json_storage)? != *view_json
    {
        return Err(ResearchGoalOwnerError::Storage(
            "legacy research view custody mismatch".into(),
        ));
    }
    let phase_valid = match view.phase.as_str() {
        "INTENT_FROZEN" => {
            view.projection_identity
                == format!("rd-research-view-{initial_source_version}-{suffix}")
                && view.observed_at_epoch_ms == receipt.committed_at_epoch_ms
                && view.source_cut == format!("rd-source-cut-{initial_source_version}-{suffix}")
                && view.attempt_identity.is_none()
                && view.artifact_identity.is_none()
                && view.build_receipt_identity.is_none()
                && view.artifact_review_identity.is_none()
                && view.next_legal_action == "WAIT_FOR_R_AND_D_EXECUTION"
                && legacy_exploration_fields_absent(&view)
        }
        "ARTIFACT_AVAILABLE" => {
            let initial_projection = format!("rd-research-view-{initial_source_version}-{suffix}");
            let Some(artifact) = view.artifact_identity.as_deref() else {
                return Err(ResearchGoalOwnerError::Storage(
                    "legacy artifact view artifact identity missing".into(),
                ));
            };
            let Some(build_receipt) = view.build_receipt_identity.as_deref() else {
                return Err(ResearchGoalOwnerError::Storage(
                    "legacy artifact view build receipt missing".into(),
                ));
            };
            let Some(review) = view.artifact_review_identity.as_deref() else {
                return Err(ResearchGoalOwnerError::Storage(
                    "legacy artifact view review missing".into(),
                ));
            };
            let projection_valid = view.attempt_identity.as_deref().map_or_else(
                || view.projection_identity == initial_projection,
                |attempt| {
                    view.projection_identity
                        == terminal_research_view_identity(
                            &initial_projection,
                            attempt,
                            artifact,
                            build_receipt,
                            review,
                        )
                },
            );
            projection_valid
                && view.source_cut == format!("rd-artifact-cut-v1-{artifact}")
                && view.next_legal_action == "REVIEW_ARTIFACT"
                && legacy_exploration_fields_absent(&view)
        }
        "EXPLORATION_ACTIVE" => {
            view.source_cut.starts_with("rd-exploration-cut-v1-")
                && view.projection_identity
                    == format!(
                        "rd-research-view-v1-{:x}",
                        Sha256::digest(view.source_cut.as_bytes())
                    )
                && view.next_legal_action == "VIEW_EXPLORATORY_RUN"
                && view.exploratory_frontier.is_some()
                && view.exploratory_replay_request_identity.is_some()
                && view.exploratory_result_digest.is_some()
                && view.exploratory_result_ref.is_some()
                && view.exploratory_run_attempt_identity.is_some()
                && view.exploratory_summary.is_some()
        }
        _ => false,
    };

    if !phase_valid {
        return Err(ResearchGoalOwnerError::Storage(format!(
            "legacy research view phase mismatch for {} at {}",
            receipt.request_identity, view.phase
        )));
    }
    Ok(view)
}

fn legacy_exploration_fields_absent(view: &LegacyResearchViewV1) -> bool {
    view.exploratory_frontier.is_none()
        && view.exploratory_replay_request_identity.is_none()
        && view.exploratory_result_digest.is_none()
        && view.exploratory_result_ref.is_none()
        && view.exploratory_run_attempt_identity.is_none()
        && view.exploratory_summary.is_none()
}

fn is_sha256_digest(value: &str) -> bool {
    value
        .strip_prefix("sha256:")
        .is_some_and(|hex| hex.len() == 64 && hex.bytes().all(|byte| byte.is_ascii_hexdigit()))
}

fn validate_source_ancestry_custody_v1(
    request: &crate::product_edge::ProductEdgeResearchGoalRequestV2,
    locator_json: Option<&serde_json::Value>,
    evidence_digest: Option<&str>,
) -> Result<(), ResearchGoalOwnerError> {
    match (locator_json, evidence_digest) {
        (None, None) => Ok(()),
        (Some(locator_json), Some(evidence_digest)) => {
            let locator: crate::source_intake::SourceIntakeResearchAncestryProposalV1 =
                decode_exact(locator_json)?;

            if !is_sha256_digest(evidence_digest)
                || locator.request_identity.trim().is_empty()
                || locator.attempt_identity.trim().is_empty()
                || locator.terminal_receipt_identity.trim().is_empty()
                || request.goal.sources.len() != 1
                || request.goal.sources[0].source_cut != evidence_digest
            {
                return Err(ResearchGoalOwnerError::Storage(
                    "stored Source Intake ancestry custody mismatch".into(),
                ));
            }
            Ok(())
        }
        _ => Err(ResearchGoalOwnerError::Storage(
            "stored Source Intake ancestry custody is incomplete".into(),
        )),
    }
}

impl VerifiedResearchCustodyV1 {
    pub(crate) fn request_json(&self) -> Option<&serde_json::Value> {
        self.request_json.as_ref()
    }
    pub(crate) fn receipt(&self) -> &ResearchRequestReceiptV1 {
        &self.receipt
    }

    pub(crate) fn intent(&self) -> Option<&FrozenResearchGoalIntent> {
        self.intent.as_ref()
    }

    pub(crate) fn view(&self) -> Option<&ResearchViewV1> {
        self.view.as_ref()
    }

    pub(crate) fn family(&self) -> Option<&TrialFamilyReadbackV1> {
        self.family.as_ref()
    }

    pub(crate) fn product_edge_admission(&self) -> Option<&ProductEdgeAdmissionReadbackV1> {
        match &self.authority {
            VerifiedResearchAuthorityV1::Current(admission) => Some(admission.as_ref()),
            VerifiedResearchAuthorityV1::LegacyQuarantined => None,
        }
    }

    pub(crate) fn effective_principal(&self) -> &str {
        &self.effective_principal
    }

    pub(crate) fn authorized_scope(&self) -> &[String] {
        &self.authorized_scope
    }

    pub(crate) fn request_schema_version(&self) -> u32 {
        self.request_schema_version
    }

    pub(crate) fn authority_available_at(&self, read_cut_epoch_ms: u64) -> bool {
        if matches!(
            self.authority,
            VerifiedResearchAuthorityV1::LegacyQuarantined
        ) {
            return false;
        }
        let research_available = if self.receipt.disposition
            == ResearchRequestDisposition::RejectedNoWrite
        {
            self.view.is_none()
        } else {
            self.view
                .as_ref()
                .map(|view| crate::product_edge::project_research_view_at(view, read_cut_epoch_ms))
                .is_some_and(|view| {
                    view.availability == crate::product_edge::ResearchViewAvailability::Available
                })
        };
        research_available
            && self.protected_feedback.as_ref().is_none_or(|projection| {
                read_cut_epoch_ms >= projection.projection_at_epoch_ms()
                    && read_cut_epoch_ms < projection.valid_through_epoch_ms()
            })
    }

    pub(crate) fn into_v1_result(
        self,
        read_cut_epoch_ms: u64,
    ) -> Result<ResearchGoalOwnerResultV1, ResearchGoalOwnerError> {
        if self
            .intent
            .as_ref()
            .is_some_and(|intent| intent.schema_version() != 1)
        {
            return Err(ResearchGoalOwnerError::Storage(
                "V1 custody schema mismatch".to_string(),
            ));
        }
        let accepted = self.receipt.disposition == ResearchRequestDisposition::Accepted;
        let research_view = self
            .view
            .as_ref()
            .map(|view| crate::product_edge::project_research_view_at(view, read_cut_epoch_ms));
        let next_legal_action = if accepted {
            research_view
                .as_ref()
                .ok_or_else(|| {
                    ResearchGoalOwnerError::Storage(
                        "accepted V1 custody research view missing".to_string(),
                    )
                })?
                .next_legal_action
        } else {
            ResearchNextLegalAction::CorrectInputAndCreateSuccessorRequest
        };
        Ok(ResearchGoalOwnerResultV1 {
            schema_version: 1,
            resolution: if accepted {
                ProductEdgeResolution::Accepted
            } else {
                ProductEdgeResolution::RejectedNoWrite
            },
            request_identity: self.receipt.request_identity.clone(),
            owner_receipt: Some(self.receipt),
            research_view,
            next_legal_action,
        })
    }

    pub(crate) fn into_legacy_quarantined_v1_result(
        self,
    ) -> Result<ResearchGoalOwnerResultV1, ResearchGoalOwnerError> {
        if !matches!(
            self.authority,
            VerifiedResearchAuthorityV1::LegacyQuarantined
        ) || self.request_schema_version != 1
        {
            return Err(ResearchGoalOwnerError::Storage(
                "research custody is not legacy quarantined".into(),
            ));
        }
        Ok(ResearchGoalOwnerResultV1 {
            schema_version: 1,
            resolution: ProductEdgeResolution::LegacyTerminalQuarantined,
            request_identity: self.receipt.request_identity.clone(),
            owner_receipt: Some(self.receipt),
            research_view: None,
            next_legal_action: ResearchNextLegalAction::ResolveSameRequestIdentity,
        })
    }

    pub(crate) fn into_v2_result(
        self,
        read_cut_epoch_ms: u64,
    ) -> Result<ResearchGoalOwnerResultV2, ResearchGoalOwnerError> {
        let request_identity = self.receipt.request_identity.clone();
        match self.receipt.disposition {
            ResearchRequestDisposition::RejectedNoWrite => Ok(ResearchGoalOwnerResultV2 {
                schema_version: 2,
                resolution: ProductEdgeResolution::RejectedNoWrite,
                request_identity,
                owner_receipt: Some(self.receipt),
                research_view: None,
                trial_family_resolution: TrialFamilyResolutionV1::unavailable(),
                trial_family: None,
                independence_basis: self.independence_basis,
                protected_feedback: self.protected_feedback,
                next_legal_action: ResearchNextLegalAction::CorrectInputAndCreateSuccessorRequest,
            }),
            ResearchRequestDisposition::Accepted => {
                let Some(FrozenResearchGoalIntent::V2(_)) = self.intent else {
                    return Err(ResearchGoalOwnerError::Storage(
                        "S1 V2 custody intent schema mismatch".to_string(),
                    ));
                };
                let family = self.family.ok_or_else(|| {
                    ResearchGoalOwnerError::Storage("S1 V2 family custody missing".to_string())
                })?;
                let research_view = self
                    .view
                    .as_ref()
                    .map(|view| {
                        crate::product_edge::project_research_view_at(view, read_cut_epoch_ms)
                    })
                    .ok_or_else(|| {
                        ResearchGoalOwnerError::Storage(
                            "accepted S1 V2 custody research view missing".to_string(),
                        )
                    })?;
                let next_legal_action = research_view.next_legal_action;
                Ok(ResearchGoalOwnerResultV2 {
                    schema_version: 2,
                    resolution: ProductEdgeResolution::Accepted,
                    request_identity,
                    owner_receipt: Some(self.receipt),
                    research_view: Some(research_view),
                    trial_family_resolution: TrialFamilyResolutionV1::available(),
                    trial_family: Some(family),
                    independence_basis: self.independence_basis,
                    protected_feedback: self.protected_feedback,
                    next_legal_action,
                })
            }
        }
    }

    pub(crate) fn into_v2_result_with_policy_current(
        self,
        read_cut_epoch_ms: u64,
        policy_current: bool,
    ) -> Result<ResearchGoalOwnerResultV2, ResearchGoalOwnerError> {
        let mut result = self.into_v2_result(read_cut_epoch_ms)?;

        if result.resolution == ProductEdgeResolution::Accepted && !policy_current {
            let historical = result.research_view.as_ref().ok_or_else(|| {
                ResearchGoalOwnerError::Storage(
                    "accepted S1 V2 custody research view missing".to_string(),
                )
            })?;
            result.research_view = Some(crate::product_edge::project_research_view_stale_at(
                historical,
                read_cut_epoch_ms,
            ));
            result.next_legal_action = ResearchNextLegalAction::ResolveSameRequestIdentity;
        }
        Ok(result)
    }
}
pub(crate) async fn admit_research_custody_in_transaction(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    lookup: ResearchCustodyLookupV1<'_>,
) -> Result<Option<VerifiedResearchCustodyV1>, ResearchGoalOwnerError> {
    let Some(custody) = admit_research_row_in_transaction(transaction, lookup).await? else {
        return Ok(None);
    };
    Box::pin(complete_research_custody_in_transaction(
        transaction,
        custody,
    ))
    .await
    .map(Some)
}

pub(crate) async fn admit_all_research_custodies_in_transaction(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
) -> Result<Vec<VerifiedResearchCustodyV1>, ResearchGoalOwnerError> {
    let hint_rows = sqlx::query("SELECT request_identity, semantic_digest, request_json, receipt_json, intent_json, view_json, source_ancestry_locator_json, source_ancestry_evidence_digest, committed_at_epoch_ms FROM rd_research_request_receipts_v1 ORDER BY request_identity")
        .fetch_all(&mut **transaction)
        .await
        .map_err(|e| storage(&e))?;
    let admissions = resolve_research_admission_hints(transaction, &hint_rows).await?;
    let rows = sqlx::query("SELECT request_identity, semantic_digest, request_json, receipt_json, intent_json, view_json, source_ancestry_locator_json, source_ancestry_evidence_digest, committed_at_epoch_ms FROM rd_research_request_receipts_v1 ORDER BY request_identity FOR SHARE")
        .fetch_all(&mut **transaction)
        .await
        .map_err(|e| storage(&e))?;
    let mut custodies = Vec::with_capacity(rows.len());
    for row in &rows {
        let request_identity: String = row.try_get("request_identity").map_err(|e| storage(&e))?;
        let admission = admissions.get(&request_identity).ok_or_else(|| {
            ResearchGoalOwnerError::Storage("research custody changed across authority cut".into())
        })?;
        let custody = admit_preloaded_research_row_in_transaction(transaction, row, admission)
            .await
            .map_err(|e| {
                ResearchGoalOwnerError::Storage(format!("research custody {request_identity}: {e}"))
            })?;
        custodies.push(
            Box::pin(complete_research_custody_in_transaction(
                transaction,
                custody,
            ))
            .await
            .map_err(|e| {
                ResearchGoalOwnerError::Storage(format!("research custody {request_identity}: {e}"))
            })?,
        );
    }
    Ok(custodies)
}

async fn admit_research_row_in_transaction(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    lookup: ResearchCustodyLookupV1<'_>,
) -> Result<Option<VerifiedResearchCustodyV1>, ResearchGoalOwnerError> {
    let hint_rows = match lookup {
        ResearchCustodyLookupV1::RequestAny(request_identity) | ResearchCustodyLookupV1::RequestV1(request_identity) | ResearchCustodyLookupV1::RequestV2(request_identity) => {
            sqlx::query("SELECT request_identity, semantic_digest, request_json, receipt_json, intent_json, view_json, source_ancestry_locator_json, source_ancestry_evidence_digest, committed_at_epoch_ms FROM rd_research_request_receipts_v1 WHERE request_identity = $1")
                .bind(request_identity).fetch_all(&mut **transaction).await.map_err(|e| storage(&e))?
        }
        ResearchCustodyLookupV1::Intent(_) => {
            sqlx::query("SELECT request_identity, semantic_digest, request_json, receipt_json, intent_json, view_json, source_ancestry_locator_json, source_ancestry_evidence_digest, committed_at_epoch_ms FROM rd_research_request_receipts_v1 ORDER BY request_identity")
                .fetch_all(&mut **transaction).await.map_err(|e| storage(&e))?
        }
    };
    let admissions = resolve_research_admission_hints(transaction, &hint_rows).await?;
    let rows = match lookup {
        ResearchCustodyLookupV1::RequestAny(request_identity) | ResearchCustodyLookupV1::RequestV1(request_identity) | ResearchCustodyLookupV1::RequestV2(request_identity) => {
            sqlx::query("SELECT request_identity, semantic_digest, request_json, receipt_json, intent_json, view_json, source_ancestry_locator_json, source_ancestry_evidence_digest, committed_at_epoch_ms FROM rd_research_request_receipts_v1 WHERE request_identity = $1 FOR UPDATE")
                .bind(request_identity)
                .fetch_all(&mut **transaction)
                .await
                .map_err(|e| storage(&e))?
        }
        ResearchCustodyLookupV1::Intent(_) => {
            sqlx::query("SELECT request_identity, semantic_digest, request_json, receipt_json, intent_json, view_json, source_ancestry_locator_json, source_ancestry_evidence_digest, committed_at_epoch_ms FROM rd_research_request_receipts_v1 ORDER BY request_identity FOR UPDATE")
                .fetch_all(&mut **transaction)
                .await
                .map_err(|e| storage(&e))?
        }
    };
    let mut matching = Vec::new();

    for row in &rows {
        let request_identity: String = row.try_get("request_identity").map_err(|e| storage(&e))?;
        let admission = admissions.get(&request_identity).ok_or_else(|| {
            ResearchGoalOwnerError::Storage("research custody changed across authority cut".into())
        })?;
        let custody =
            admit_preloaded_research_row_in_transaction(transaction, row, admission).await?;
        let is_match = match lookup {
            ResearchCustodyLookupV1::RequestAny(request_identity) => {
                custody.receipt.request_identity == request_identity
            }
            ResearchCustodyLookupV1::RequestV1(request_identity) => {
                custody.receipt.request_identity == request_identity
                    && custody.request_schema_version == 1
            }
            ResearchCustodyLookupV1::RequestV2(request_identity) => {
                custody.receipt.request_identity == request_identity
                    && custody.request_schema_version == 2
            }
            ResearchCustodyLookupV1::Intent(intent_identity) => custody
                .intent()
                .is_some_and(|intent| intent.intent_identity() == intent_identity),
        };

        if is_match {
            matching.push(custody);
        }
    }

    if matching.len() > 1 {
        return Err(ResearchGoalOwnerError::Storage(
            "research custody lookup is ambiguous".to_string(),
        ));
    }

    if !rows.is_empty()
        && matching.is_empty()
        && matches!(
            lookup,
            ResearchCustodyLookupV1::RequestAny(_)
                | ResearchCustodyLookupV1::RequestV1(_)
                | ResearchCustodyLookupV1::RequestV2(_)
        )
    {
        return Err(ResearchGoalOwnerError::Storage(
            "research custody request schema mismatch".to_string(),
        ));
    }
    Ok(matching.pop())
}

async fn admit_preloaded_research_row_in_transaction(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    row: &PgRow,
    preadmitted_authority: &PreadmittedResearchAuthorityV1,
) -> Result<VerifiedResearchCustodyV1, ResearchGoalOwnerError> {
    let row_request_identity: String = row.try_get("request_identity").map_err(|e| storage(&e))?;
    let row_semantic_digest: String = row.try_get("semantic_digest").map_err(|e| storage(&e))?;
    let row_committed_at: i64 = row
        .try_get("committed_at_epoch_ms")
        .map_err(|e| storage(&e))?;
    let receipt_json: serde_json::Value = row.try_get("receipt_json").map_err(|e| storage(&e))?;
    let receipt: ResearchRequestReceiptV1 = decode_exact(&receipt_json)?;
    let request_json = row
        .try_get::<Option<serde_json::Value>, _>("request_json")
        .map_err(|e| storage(&e))?;
    let intent_json: Option<serde_json::Value> =
        row.try_get("intent_json").map_err(|e| storage(&e))?;
    let view_json: Option<serde_json::Value> = row.try_get("view_json").map_err(|e| storage(&e))?;
    let source_ancestry_locator_json: Option<serde_json::Value> = row
        .try_get("source_ancestry_locator_json")
        .map_err(|e| storage(&e))?;
    let source_ancestry_evidence_digest: Option<String> = row
        .try_get("source_ancestry_evidence_digest")
        .map_err(|e| storage(&e))?;

    if receipt.request_identity != row_request_identity
        || receipt.semantic_digest != row_semantic_digest
        || i64::try_from(receipt.committed_at_epoch_ms).map_err(json_storage)? != row_committed_at
    {
        return Err(ResearchGoalOwnerError::Storage(
            "research custody row mismatch".to_string(),
        ));
    }

    if request_json.is_none() {
        if source_ancestry_locator_json.is_some() || source_ancestry_evidence_digest.is_some() {
            return Err(ResearchGoalOwnerError::Storage(
                "legacy research custody carries source ancestry".into(),
            ));
        }

        if !matches!(
            preadmitted_authority,
            PreadmittedResearchAuthorityV1::LegacyQuarantined
        ) {
            return Err(ResearchGoalOwnerError::Storage(
                "legacy research authority classification mismatch".into(),
            ));
        }
        let legacy_v1_result =
            verify_legacy_quarantined_commit(&receipt, intent_json.as_ref(), view_json.as_ref());
        let legacy_v2_result = verify_legacy_missing_request_v2(
            transaction,
            &receipt,
            intent_json.as_ref(),
            view_json.as_ref(),
        )
        .await;

        if usize::from(legacy_v1_result.is_ok()) + usize::from(legacy_v2_result.is_ok()) != 1 {
            return Err(ResearchGoalOwnerError::Storage(format!(
                "legacy missing-request custody {} has no unique supported representation: V1={}; V2={}",
                receipt.request_identity,
                legacy_v1_result
                    .as_ref()
                    .err()
                    .map_or("matched".to_string(), ToString::to_string),
                legacy_v2_result
                    .as_ref()
                    .err()
                    .map_or("matched".to_string(), ToString::to_string),
            )));
        }
        let commit = legacy_v1_result
            .ok()
            .or_else(|| legacy_v2_result.ok())
            .expect("unique legacy missing-request representation");
        let intent = commit.intent.clone().map(FrozenResearchGoalIntent::V1);
        let request_schema_version = commit.request_schema_version;
        return Ok(VerifiedResearchCustodyV1 {
            request_json: None,
            receipt,
            intent,
            view: None,
            family: None,
            expected_family: None,
            independence_basis: None,
            protected_feedback: None,
            authority: VerifiedResearchAuthorityV1::LegacyQuarantined,
            effective_principal: commit.effective_principal,
            authorized_scope: commit.authorized_scope,
            request_schema_version,
            terminal_attempt_admission: None,
        });
    }
    let request_json = request_json.expect("checked present");

    if matches!(
        preadmitted_authority,
        PreadmittedResearchAuthorityV1::LegacyQuarantined
    ) {
        if source_ancestry_locator_json.is_some() || source_ancestry_evidence_digest.is_some() {
            return Err(ResearchGoalOwnerError::Storage(
                "legacy research custody carries source ancestry".into(),
            ));
        }
        let self_authorized =
            decode_exact::<LegacySelfAuthorizedResearchRequestV2>(&request_json).ok();
        let candidate_wrapped =
            decode_exact::<LegacyCandidateStoredAdmittedResearchRequestV2>(&request_json).ok();

        if usize::from(self_authorized.is_some()) + usize::from(candidate_wrapped.is_some()) != 1 {
            return Err(ResearchGoalOwnerError::Storage(
                "legacy V2 request has no unique supported representation".into(),
            ));
        }
        let commit = if let Some(request) = self_authorized {
            verify_legacy_self_authorized_v2(
                transaction,
                &receipt,
                &request,
                intent_json.as_ref(),
                view_json.as_ref(),
            )
            .await?
        } else {
            verify_legacy_candidate_admitted_v2(
                transaction,
                &receipt,
                &candidate_wrapped.expect("unique legacy candidate representation"),
                intent_json.as_ref(),
                view_json.as_ref(),
            )
            .await?
        };
        return Ok(VerifiedResearchCustodyV1 {
            request_json: Some(request_json.clone()),
            receipt,
            intent: None,
            view: None,
            family: None,
            expected_family: None,
            independence_basis: None,
            protected_feedback: None,
            authority: VerifiedResearchAuthorityV1::LegacyQuarantined,
            effective_principal: commit.effective_principal,
            authorized_scope: commit.authorized_scope,
            request_schema_version: 2,
            terminal_attempt_admission: None,
        });
    }
    let product_edge_admission = match preadmitted_authority {
        PreadmittedResearchAuthorityV1::Current { research, .. } => research.as_ref().clone(),
        PreadmittedResearchAuthorityV1::LegacyQuarantined => {
            return Err(ResearchGoalOwnerError::Storage(
                "current research authority classification mismatch".into(),
            ));
        }
    };
    let v1 = decode_exact::<ProductEdgeResearchGoalRequestV1>(&request_json).ok();
    let accepted_v2 = decode_exact::<StoredAdmittedResearchRequestV2>(&request_json).ok();
    let rejected_v2 = decode_exact::<StoredRejectedResearchRequestV2>(&request_json).ok();

    if usize::from(v1.is_some())
        + usize::from(accepted_v2.is_some())
        + usize::from(rejected_v2.is_some())
        != 1
    {
        return Err(ResearchGoalOwnerError::Storage(
            "stored request meaning has no unique supported representation".to_string(),
        ));
    }

    let (
        expected,
        authority,
        effective_principal,
        authorized_scope,
        independence_basis,
        protected_feedback,
        request_schema_version,
    ) = if let Some(request) = v1 {
        if source_ancestry_locator_json.is_some() || source_ancestry_evidence_digest.is_some() {
            return Err(ResearchGoalOwnerError::Storage(
                "V1 research custody carries source ancestry".into(),
            ));
        }
        let digest = semantic_digest(&request)?;
        if request.request_identity != row_request_identity || digest != row_semantic_digest {
            return Err(ResearchGoalOwnerError::Storage(
                "stored V1 request meaning mismatch".to_string(),
            ));
        }
        verify_research_admission_v1(&product_edge_admission, &request)?;
        let effective_principal = product_edge_admission.effective_principal().to_string();
        let authorized_scope = product_edge_admission.authorized_scope().to_vec();
        (
            ExpectedResearchCommitV1::V1(Box::new(decide_commit(
                request,
                digest,
                &product_edge_admission,
                receipt.committed_at_epoch_ms,
            ))),
            VerifiedResearchAuthorityV1::Current(Box::new(product_edge_admission)),
            effective_principal,
            authorized_scope,
            None,
            None,
            1,
        )
    } else if let Some(stored) = accepted_v2 {
        if stored.schema_version != 1 {
            return Err(ResearchGoalOwnerError::Storage(
                "stored admitted V2 request schema mismatch".to_string(),
            ));
        }
        let request = stored.request.clone();
        validate_source_ancestry_custody_v1(
            &request,
            source_ancestry_locator_json.as_ref(),
            source_ancestry_evidence_digest.as_deref(),
        )?;

        if source_ancestry_locator_json.is_some() {
            verify_source_bound_research_admission_v2(&product_edge_admission, &request)?;
        } else {
            verify_research_admission_v2(&product_edge_admission, &request)?;
        }
        let effective_principal = product_edge_admission.effective_principal().to_string();
        let authorized_scope = product_edge_admission.authorized_scope().to_vec();
        let digest = semantic_digest_v2(&request)?;
        if request.request_identity != row_request_identity || digest != row_semantic_digest {
            return Err(ResearchGoalOwnerError::Storage(
                "stored V2 request meaning mismatch".to_string(),
            ));
        }
        let validated = validate_goal_request_v2(request).map_err(|_| {
            ResearchGoalOwnerError::Storage(
                "stored admitted V2 request is semantically invalid".to_string(),
            )
        })?;
        let basis =
            admit_basis_snapshot_in_transaction(transaction, &stored.independence_basis).await?;
        let protected_feedback = admit_historical_projection_in_transaction(
            transaction,
            &basis.locator(),
            &stored.protected_feedback.projection_identity,
            &stored.protected_feedback.projection_digest,
        )
        .await
        .map_err(|e| ResearchGoalOwnerError::Storage(e.to_string()))?
        .ok_or_else(|| {
            ResearchGoalOwnerError::Storage(
                "Qualification protected-feedback custody missing".to_string(),
            )
        })?;

        if protected_feedback.projection_identity() != stored.protected_feedback.projection_identity
            || protected_feedback.projection_digest() != stored.protected_feedback.projection_digest
            || protected_feedback.source_cut() != stored.protected_feedback.source_cut
            || protected_feedback.valid_through_epoch_ms()
                != stored.protected_feedback.valid_through_epoch_ms
            || stored
                .canonical_trial_family_policy
                .semantic_predecessor_frontier
                != stored.independence_basis.semantic_predecessor_frontier
            || stored
                .canonical_trial_family_policy
                .independence_disposition
                != stored.independence_basis.independence_disposition
            || stored
                .canonical_trial_family_policy
                .independence_basis_identity
                != stored.independence_basis.basis_identity
            || stored
                .canonical_trial_family_policy
                .protected_feedback_frontier
                != protected_feedback.projection_identity()
        {
            return Err(ResearchGoalOwnerError::Storage(
                "stored V2 Owner authority binding mismatch".to_string(),
            ));
        }
        (
            ExpectedResearchCommitV1::V2Accepted(Box::new(decide_commit_v2(
                validated,
                digest,
                stored.canonical_trial_family_policy,
                basis.clone(),
                protected_feedback.clone(),
                &product_edge_admission,
                receipt.committed_at_epoch_ms,
            )?)),
            VerifiedResearchAuthorityV1::Current(Box::new(product_edge_admission)),
            effective_principal,
            authorized_scope,
            Some(basis),
            Some(protected_feedback),
            2,
        )
    } else {
        if source_ancestry_locator_json.is_some() || source_ancestry_evidence_digest.is_some() {
            return Err(ResearchGoalOwnerError::Storage(
                "rejected V2 custody carries source ancestry".into(),
            ));
        }
        let stored = rejected_v2.expect("unique rejected V2 representation");
        if stored.schema_version != 1 {
            return Err(ResearchGoalOwnerError::Storage(
                "stored rejected V2 request schema mismatch".to_string(),
            ));
        }
        let request = stored.request;
        verify_research_admission_v2(&product_edge_admission, &request)?;
        let effective_principal = product_edge_admission.effective_principal().to_string();
        let authorized_scope = product_edge_admission.authorized_scope().to_vec();
        let digest = semantic_digest_v2(&request)?;
        if request.request_identity != row_request_identity || digest != row_semantic_digest {
            return Err(ResearchGoalOwnerError::Storage(
                "stored rejected V2 request meaning mismatch".to_string(),
            ));
        }
        let (request, rejection_code) = validate_goal_request_v2(request)
            .err()
            .ok_or_else(|| {
                ResearchGoalOwnerError::Storage(
                    "stored rejected V2 request is semantically valid".to_string(),
                )
            })?
            .into_parts();

        if stored.rejection_code != rejection_code {
            return Err(ResearchGoalOwnerError::Storage(
                "stored rejected V2 failure code mismatch".to_string(),
            ));
        }
        let positive_prerequisites: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM rd_independence_bases_v1 WHERE request_identity = $1",
        )
        .bind(&row_request_identity)
        .fetch_one(&mut **transaction)
        .await
        .map_err(|e| storage(&e))?;
        let would_be_intent =
            canonical_v2_intent_identity(&row_request_identity, &row_semantic_digest);
        let family_rows: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM rd_trial_families_v1 WHERE intent_identity = $1",
        )
        .bind(would_be_intent)
        .fetch_one(&mut **transaction)
        .await
        .map_err(|e| storage(&e))?;
        if positive_prerequisites != 0 || family_rows != 0 {
            return Err(ResearchGoalOwnerError::Storage(
                "rejected V2 request has positive authority prerequisites".to_string(),
            ));
        }
        (
            ExpectedResearchCommitV1::V2Rejected(Box::new(decide_rejected_commit_v2(
                request,
                digest,
                rejection_code,
                receipt.committed_at_epoch_ms,
            ))),
            VerifiedResearchAuthorityV1::Current(Box::new(product_edge_admission)),
            effective_principal,
            authorized_scope,
            None,
            None,
            2,
        )
    };

    if &receipt != expected.receipt() {
        return Err(ResearchGoalOwnerError::Storage(
            "research receipt meaning mismatch".to_string(),
        ));
    }

    match receipt.disposition {
        ResearchRequestDisposition::RejectedNoWrite => {
            if receipt.schema_version != 1
                || receipt.resulting_research_intent_identity.is_some()
                || receipt.rejection_code.is_none()
                || intent_json.is_some()
                || view_json.is_some()
            {
                return Err(ResearchGoalOwnerError::Storage(
                    "rejected research custody mismatch".to_string(),
                ));
            }
            Ok(VerifiedResearchCustodyV1 {
                request_json: Some(request_json.clone()),
                receipt,
                intent: None,
                view: None,
                family: None,
                expected_family: None,
                independence_basis,
                protected_feedback,
                authority,
                effective_principal,
                authorized_scope,
                request_schema_version,
                terminal_attempt_admission: match preadmitted_authority {
                    PreadmittedResearchAuthorityV1::Current {
                        terminal_attempt, ..
                    } => terminal_attempt.clone(),
                    PreadmittedResearchAuthorityV1::LegacyQuarantined => None,
                },
            })
        }
        ResearchRequestDisposition::Accepted => {
            let intent: FrozenResearchGoalIntent =
                decode_exact(&intent_json.ok_or_else(|| {
                    ResearchGoalOwnerError::Storage("accepted research intent missing".to_string())
                })?)?;

            if Some(intent.clone()) != expected.intent() {
                return Err(ResearchGoalOwnerError::Storage(
                    "research intent meaning mismatch".to_string(),
                ));
            }
            let expected_family = expected.family().cloned();
            let view = match &intent {
                FrozenResearchGoalIntent::V2(_) | FrozenResearchGoalIntent::V1(_) => {
                    let view: ResearchViewV1 = decode_exact(&view_json.ok_or_else(|| {
                        ResearchGoalOwnerError::Storage(
                            "accepted V2 research view missing".to_string(),
                        )
                    })?)?;
                    validate_historical_view(
                        &view,
                        expected.view().ok_or_else(|| {
                            ResearchGoalOwnerError::Storage("expected view missing".to_string())
                        })?,
                    )?;
                    Some(view)
                }
            };
            Ok(VerifiedResearchCustodyV1 {
                request_json: Some(request_json.clone()),
                receipt,
                intent: Some(intent),
                view,
                family: None,
                expected_family,
                independence_basis,
                protected_feedback,
                authority,
                effective_principal,
                authorized_scope,
                request_schema_version,
                terminal_attempt_admission: match preadmitted_authority {
                    PreadmittedResearchAuthorityV1::Current {
                        terminal_attempt, ..
                    } => terminal_attempt.clone(),
                    PreadmittedResearchAuthorityV1::LegacyQuarantined => None,
                },
            })
        }
    }
}

async fn resolve_research_admission_hints(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    rows: &[PgRow],
) -> Result<BTreeMap<String, PreadmittedResearchAuthorityV1>, ResearchGoalOwnerError> {
    let mut locators = Vec::with_capacity(rows.len());
    let mut admissions = BTreeMap::new();

    for row in rows {
        let request_identity: String = row.try_get("request_identity").map_err(|e| storage(&e))?;
        let request_json = row
            .try_get::<Option<serde_json::Value>, _>("request_json")
            .map_err(|e| storage(&e))?;
        let Some(request_json) = request_json else {
            if admissions
                .insert(
                    request_identity,
                    PreadmittedResearchAuthorityV1::LegacyQuarantined,
                )
                .is_some()
            {
                return Err(ResearchGoalOwnerError::Storage(
                    "duplicate legacy research request hint".into(),
                ));
            }
            continue;
        };
        let v1 = decode_exact::<ProductEdgeResearchGoalRequestV1>(&request_json).ok();
        let accepted_v2 = decode_exact::<StoredAdmittedResearchRequestV2>(&request_json).ok();
        let rejected_v2 = decode_exact::<StoredRejectedResearchRequestV2>(&request_json).ok();
        let legacy_self_authorized_v2 =
            decode_exact::<LegacySelfAuthorizedResearchRequestV2>(&request_json).ok();
        let legacy_candidate_v2 =
            decode_exact::<LegacyCandidateStoredAdmittedResearchRequestV2>(&request_json).ok();
        let representation_count = usize::from(v1.is_some())
            + usize::from(accepted_v2.is_some())
            + usize::from(rejected_v2.is_some())
            + usize::from(legacy_self_authorized_v2.is_some())
            + usize::from(legacy_candidate_v2.is_some());

        if representation_count != 1 {
            return Err(ResearchGoalOwnerError::Storage(
                "stored request meaning has no unique supported representation".into(),
            ));
        }

        if legacy_self_authorized_v2.is_some() || legacy_candidate_v2.is_some() {
            if admissions
                .insert(
                    request_identity,
                    PreadmittedResearchAuthorityV1::LegacyQuarantined,
                )
                .is_some()
            {
                return Err(ResearchGoalOwnerError::Storage(
                    "duplicate legacy self-authorized request hint".into(),
                ));
            }
            continue;
        }
        let locator = if let Some(request) = v1 {
            request.admission
        } else if let Some(stored) = accepted_v2 {
            stored.request.admission
        } else {
            rejected_v2
                .expect("unique rejected representation")
                .request
                .admission
        };

        if locator.request_identity != request_identity {
            return Err(ResearchGoalOwnerError::Storage(
                "Product Edge admission locator request mismatch".into(),
            ));
        }
        locators.push((request_identity.clone(), locator, false));
        let view_json = row
            .try_get::<Option<serde_json::Value>, _>("view_json")
            .map_err(|e| storage(&e))?;
        if let Some(view_json) = view_json {
            let view: ResearchViewV1 = decode_exact(&view_json)?;
            if view.phase == crate::product_edge::ResearchViewPhase::ArtifactAvailable {
                let attempt_identity = view.attempt_identity.as_deref().ok_or_else(|| {
                    ResearchGoalOwnerError::Storage(
                        "terminal research view attempt identity missing".into(),
                    )
                })?;
                let attempt_rows = sqlx::query("SELECT build_request_identity, attempt_identity, semantic_digest, attempt_json, prepared_at_epoch_ms FROM rd_artifact_build_attempts_v1 WHERE attempt_identity=$1")
                    .bind(attempt_identity)
                    .fetch_all(&mut **transaction)
                    .await
                    .map_err(|e| storage(&e))?;
                if attempt_rows.len() != 1 {
                    return Err(ResearchGoalOwnerError::Storage(
                        "terminal research attempt hint unavailable".into(),
                    ));
                }
                let build_request_identity: String = attempt_rows[0]
                    .try_get("build_request_identity")
                    .map_err(|e| storage(&e))?;
                let attempt =
                    attempt::decode_attempt_row(&attempt_rows[0], &build_request_identity)
                        .map_err(|e| ResearchGoalOwnerError::Storage(e.to_string()))?;
                locators.push((request_identity, attempt.request.admission, true));
            }
        }
    }
    locators.sort_by(|left, right| {
        (&left.1.request_identity, &left.1.admission_identity, left.2).cmp(&(
            &right.1.request_identity,
            &right.1.admission_identity,
            right.2,
        ))
    });

    let mut resolved_research = BTreeMap::new();
    let mut resolved_terminal = BTreeMap::new();

    for (request_identity, locator, terminal) in locators {
        let admission = resolve_admission_for_downstream_in_transaction(
            transaction,
            &locator,
            DownstreamAdmissionModeV1::Historical,
        )
        .await
        .map_err(|e| ResearchGoalOwnerError::Storage(e.to_string()))?;
        let target = if terminal {
            &mut resolved_terminal
        } else {
            &mut resolved_research
        };

        if target.insert(request_identity, admission).is_some() {
            return Err(ResearchGoalOwnerError::Storage(
                "duplicate research request authority hint".into(),
            ));
        }
    }

    for (request_identity, research) in resolved_research {
        if admissions
            .insert(
                request_identity.clone(),
                PreadmittedResearchAuthorityV1::Current {
                    research: Box::new(research),
                    terminal_attempt: resolved_terminal.remove(&request_identity).map(Box::new),
                },
            )
            .is_some()
        {
            return Err(ResearchGoalOwnerError::Storage(
                "duplicate research request authority hint".into(),
            ));
        }
    }

    if !resolved_terminal.is_empty() {
        return Err(ResearchGoalOwnerError::Storage(
            "orphan terminal attempt authority hint".into(),
        ));
    }
    Ok(admissions)
}

async fn complete_research_custody_in_transaction(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    mut custody: VerifiedResearchCustodyV1,
) -> Result<VerifiedResearchCustodyV1, ResearchGoalOwnerError> {
    if custody
        .view()
        .is_some_and(|view| view.phase == crate::product_edge::ResearchViewPhase::ArtifactAvailable)
    {
        let product_edge_admission =
            custody.terminal_attempt_admission.take().ok_or_else(|| {
                ResearchGoalOwnerError::Storage(
                    "terminal attempt Product Edge authority was not preadmitted".into(),
                )
            })?;
        return Box::pin(attempt::admit_terminal_attempt_for_research_view(
            transaction,
            custody,
            *product_edge_admission,
        ))
        .await
        .map(|verified| verified.research)
        .map_err(|e| ResearchGoalOwnerError::Storage(e.to_string()));
    }
    load_research_family_in_transaction(transaction, &mut custody).await?;
    Ok(custody)
}

async fn load_research_family_in_transaction(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    custody: &mut VerifiedResearchCustodyV1,
) -> Result<(), ResearchGoalOwnerError> {
    match custody.intent() {
        Some(FrozenResearchGoalIntent::V2(intent)) => {
            let family = load_trial_family_in_transaction(
                transaction,
                intent.intent_identity.as_str(),
                &custody.receipt.receipt_identity,
            )
            .await
            .map_err(|e| trial_family_storage(&e))?;
            if custody.expected_family.as_ref() != Some(&family) {
                return Err(ResearchGoalOwnerError::Storage(
                    "research family meaning mismatch".to_string(),
                ));
            }
            custody.family = Some(family);
        }
        Some(FrozenResearchGoalIntent::V1(_)) | None => {
            if custody.expected_family.is_some() || custody.family.is_some() {
                return Err(ResearchGoalOwnerError::Storage(
                    "legacy research family mismatch".to_string(),
                ));
            }
        }
    }
    Ok(())
}

fn validate_historical_view(
    view: &ResearchViewV1,
    initial: &ResearchViewV1,
) -> Result<(), ResearchGoalOwnerError> {
    let fixed = view.schema_version == initial.schema_version
        && view.request_identity == initial.request_identity
        && view.trusted_principal == initial.trusted_principal
        && view.authorized_scope == initial.authorized_scope
        && view.authorization_policy_cut == initial.authorization_policy_cut
        && view.source_owner == initial.source_owner
        && view.intent_identity == initial.intent_identity
        && view.source_frontier == initial.source_frontier;
    let phase = match view.phase {
        crate::product_edge::ResearchViewPhase::IntentFrozen => view == initial,
        crate::product_edge::ResearchViewPhase::ArtifactAvailable => {
            if view.attempt_identity.is_none() {
                return Err(ResearchGoalOwnerError::Storage(
                    "terminal research attempt identity missing".to_string(),
                ));
            }
            let Some(artifact_identity) = view.artifact_identity.as_deref() else {
                return Err(ResearchGoalOwnerError::Storage(
                    "terminal research artifact identity missing".to_string(),
                ));
            };

            if view.build_receipt_identity.is_none() {
                return Err(ResearchGoalOwnerError::Storage(
                    "terminal research build receipt identity missing".to_string(),
                ));
            }

            if view.artifact_review_identity.is_none() {
                return Err(ResearchGoalOwnerError::Storage(
                    "terminal research review identity missing".to_string(),
                ));
            }
            view.availability == crate::product_edge::ResearchViewAvailability::Available
                && view.projection_identity == canonical_research_view_identity_v2(view)
                && view.next_legal_action == ResearchNextLegalAction::ReviewArtifact
                && view.source_cut == format!("rd-artifact-cut-v1-{artifact_identity}")
                && view.observed_at_epoch_ms == view.projection_at_epoch_ms
                && view.valid_through_epoch_ms
                    == view.projection_at_epoch_ms.saturating_add(600_000)
        }
        crate::product_edge::ResearchViewPhase::RequestUnresolved => false,
    };

    if fixed && phase {
        Ok(())
    } else {
        Err(ResearchGoalOwnerError::Storage(
            "research view historical meaning mismatch".to_string(),
        ))
    }
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct StoredBasisReceiptV1 {
    schema_version: u32,
    receipt_identity: String,
    basis_identity: String,
    basis_digest: String,
    committed_at_epoch_ms: u64,
}

#[derive(Serialize)]
struct BasisMeaningV1<'a> {
    schema_version: u32,
    request_identity: &'a str,
    principal: &'a str,
    request_scope: &'a [String],
    rationale_digest: &'a str,
    independence_disposition: &'a crate::trial_family::TrialFamilyIndependenceDispositionV1,
    lineage_resolution: &'a crate::product_edge::ResearchLineageResolutionV1,
    semantic_predecessor_frontier: &'a [String],
    lineage_digest: &'a str,
}

#[derive(Serialize)]
struct BasisReceiptMeaningV1<'a> {
    schema_version: u32,
    basis_identity: &'a str,
    basis_digest: &'a str,
    committed_at_epoch_ms: u64,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct BasisOutboxPayloadV1 {
    schema_version: u32,
    basis_identity: String,
    basis_digest: String,
    receipt_identity: String,
    principal: String,
    request_scope: Vec<String>,
    lineage_digest: String,
}

pub(crate) async fn admit_independence_basis_by_identity_in_transaction(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    basis_identity: &str,
) -> Result<IndependenceBasisReadbackV1, ResearchGoalOwnerError> {
    let row = sqlx::query(
        "SELECT basis_json FROM rd_independence_bases_v1 WHERE basis_identity = $1 FOR SHARE",
    )
    .bind(basis_identity)
    .fetch_one(&mut **transaction)
    .await
    .map_err(|e| storage(&e))?;
    let stored: StoredIndependenceBasisV1 = decode_exact(
        &row.try_get::<serde_json::Value, _>("basis_json")
            .map_err(|e| storage(&e))?,
    )?;
    admit_basis_snapshot_in_transaction(transaction, &stored).await
}

async fn admit_basis_snapshot_in_transaction(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    snapshot: &StoredIndependenceBasisV1,
) -> Result<IndependenceBasisReadbackV1, ResearchGoalOwnerError> {
    let row = sqlx::query("SELECT basis_identity, request_identity, principal, request_scope_json, lineage_digest, basis_digest, basis_json, receipt_json, committed_at_epoch_ms FROM rd_independence_bases_v1 WHERE basis_identity = $1 FOR SHARE")
        .bind(&snapshot.basis_identity)
        .fetch_one(&mut **transaction)
        .await
        .map_err(|e| storage(&e))?;
    let stored: StoredIndependenceBasisV1 = decode_exact(
        &row.try_get::<serde_json::Value, _>("basis_json")
            .map_err(|e| storage(&e))?,
    )?;
    let receipt: StoredBasisReceiptV1 = decode_exact(
        &row.try_get::<serde_json::Value, _>("receipt_json")
            .map_err(|e| storage(&e))?,
    )?;
    let digest = owner_digest(
        "rd.independence-basis.v1",
        &BasisMeaningV1 {
            schema_version: stored.schema_version,
            request_identity: &stored.request_identity,
            principal: &stored.principal,
            request_scope: &stored.request_scope,
            rationale_digest: &stored.rationale_digest,
            independence_disposition: &stored.independence_disposition,
            lineage_resolution: &stored.lineage_resolution,
            semantic_predecessor_frontier: &stored.semantic_predecessor_frontier,
            lineage_digest: &stored.lineage_digest,
        },
    )?;
    let receipt_digest = owner_digest(
        "rd.independence-basis-receipt.v1",
        &BasisReceiptMeaningV1 {
            schema_version: receipt.schema_version,
            basis_identity: &receipt.basis_identity,
            basis_digest: &receipt.basis_digest,
            committed_at_epoch_ms: receipt.committed_at_epoch_ms,
        },
    )?;
    let scope: Vec<String> = decode_exact(
        &row.try_get::<serde_json::Value, _>("request_scope_json")
            .map_err(|e| storage(&e))?,
    )?;
    let committed_at: i64 = row
        .try_get("committed_at_epoch_ms")
        .map_err(|e| storage(&e))?;
    if &stored != snapshot
        || stored.schema_version != 1
        || stored.basis_digest != digest
        || stored.basis_identity != owner_identity("rd-independence-basis-v1", &digest)
        || receipt.schema_version != 1
        || receipt.basis_identity != stored.basis_identity
        || receipt.basis_digest != stored.basis_digest
        || receipt.receipt_identity
            != owner_identity("rd-independence-basis-receipt-v1", &receipt_digest)
        || row
            .try_get::<String, _>("basis_identity")
            .map_err(|e| storage(&e))?
            != stored.basis_identity
        || row
            .try_get::<String, _>("request_identity")
            .map_err(|e| storage(&e))?
            != stored.request_identity
        || row
            .try_get::<String, _>("principal")
            .map_err(|e| storage(&e))?
            != stored.principal
        || scope != stored.request_scope
        || row
            .try_get::<String, _>("lineage_digest")
            .map_err(|e| storage(&e))?
            != stored.lineage_digest
        || row
            .try_get::<String, _>("basis_digest")
            .map_err(|e| storage(&e))?
            != stored.basis_digest
        || u64::try_from(committed_at).map_err(json_storage)? != receipt.committed_at_epoch_ms
    {
        return Err(ResearchGoalOwnerError::Storage(
            "R&D basis canonical custody mismatch".into(),
        ));
    }
    let outbox = sqlx::query("SELECT event_identity, aggregate_identity, event_kind, payload_digest, payload_json, committed_at_epoch_ms FROM rd_owner_outbox_v1 WHERE aggregate_identity = $1 AND event_kind = 'INDEPENDENCE_BASIS_PRECOMMITTED_V1' FOR SHARE")
        .bind(&stored.basis_identity)
        .fetch_all(&mut **transaction)
        .await
        .map_err(|e| storage(&e))?;
    if outbox.len() != 1 {
        return Err(ResearchGoalOwnerError::Storage(
            "R&D basis outbox unavailable".into(),
        ));
    }
    let outbox = &outbox[0];
    let payload: BasisOutboxPayloadV1 = decode_exact(
        &outbox
            .try_get::<serde_json::Value, _>("payload_json")
            .map_err(|e| storage(&e))?,
    )?;
    let payload_digest = owner_digest("rd.owner-outbox.payload.v1", &payload)?;
    let outbox_time: i64 = outbox
        .try_get("committed_at_epoch_ms")
        .map_err(|e| storage(&e))?;
    if payload.schema_version != 1
        || payload.basis_identity != snapshot.basis_identity
        || payload.basis_digest != snapshot.basis_digest
        || payload.receipt_identity != receipt.receipt_identity
        || payload.principal != snapshot.principal
        || payload.request_scope != snapshot.request_scope
        || payload.lineage_digest != snapshot.lineage_digest
        || outbox
            .try_get::<String, _>("event_identity")
            .map_err(|e| storage(&e))?
            != owner_identity("rd-owner-event-v1", &payload_digest)
        || outbox
            .try_get::<String, _>("aggregate_identity")
            .map_err(|e| storage(&e))?
            != snapshot.basis_identity
        || outbox
            .try_get::<String, _>("event_kind")
            .map_err(|e| storage(&e))?
            != "INDEPENDENCE_BASIS_PRECOMMITTED_V1"
        || outbox
            .try_get::<String, _>("payload_digest")
            .map_err(|e| storage(&e))?
            != payload_digest
        || u64::try_from(outbox_time).map_err(json_storage)? != receipt.committed_at_epoch_ms
    {
        return Err(ResearchGoalOwnerError::Storage(
            "R&D basis outbox mismatch".into(),
        ));
    }
    Ok(IndependenceBasisReadbackV1::from_stored(
        stored,
        IndependenceBasisReceiptV1::new(
            receipt.receipt_identity,
            receipt.basis_identity,
            receipt.basis_digest,
            receipt.committed_at_epoch_ms,
        ),
    ))
}

fn owner_digest(domain: &str, value: &impl Serialize) -> Result<String, ResearchGoalOwnerError> {
    #[derive(Serialize)]
    struct Envelope<'a, T> {
        domain: &'a str,
        value: &'a T,
    }
    let bytes = serde_json::to_vec(&Envelope { domain, value }).map_err(json_storage)?;
    Ok(format!("sha256:{:x}", Sha256::digest(bytes)))
}

fn owner_identity(prefix: &str, digest: &str) -> String {
    format!("{prefix}-{}", digest.trim_start_matches("sha256:"))
}

fn storage(error: &sqlx::Error) -> ResearchGoalOwnerError {
    ResearchGoalOwnerError::Storage(error.to_string())
}
fn json_storage(error: impl Display) -> ResearchGoalOwnerError {
    ResearchGoalOwnerError::Storage(error.to_string())
}
fn trial_family_storage(error: &crate::trial_family::TrialFamilyError) -> ResearchGoalOwnerError {
    ResearchGoalOwnerError::Storage(error.to_string())
}

fn decode_exact<T>(value: &serde_json::Value) -> Result<T, ResearchGoalOwnerError>
where
    T: serde::de::DeserializeOwned + serde::Serialize,
{
    let decoded: T = serde_json::from_value(value.clone()).map_err(json_storage)?;
    if serde_json::to_value(&decoded).map_err(json_storage)? != *value {
        return Err(ResearchGoalOwnerError::Storage(
            "stored JSON is not canonical for its schema".to_string(),
        ));
    }
    Ok(decoded)
}

mod attempt;
pub(crate) use attempt::{
    AttemptState, StoredAttemptV1, StoredInvocationClaimBindingV1, VerifiedAttemptCustodyV1,
    admit_attempt_custody_for_request_in_transaction, admit_attempt_custody_in_transaction,
    admit_attempt_custody_with_admission_mode_in_transaction,
    admit_attempt_reservation_header_in_transaction, admit_attempt_with_research_in_transaction,
    no_artifact_receipt, resolve_verified_artifact_family,
};
