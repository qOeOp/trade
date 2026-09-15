//! R&D-owned durable work requests for post-Replay analytical interpretation.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;
use vibe_backtest_owner_contracts::{
    ContentIdentityV2, ReplayRequestDtoV2, ReplayResultDtoV2, ReplayWindowV2,
    outcome_evidence::BacktestOutcomeEvidenceDtoV1,
};

use crate::IterationCandidateEvaluationSetV1;
use crate::iteration_decision::{
    CandidateComparisonDecisionReadbackV1, IterationDecisionEvidenceCutV1,
    IterationDiagnosisDimensionV1, IterationInterpretationDiagnosticV1,
    is_valid_iteration_decision_locator_v1,
};

pub const ITERATION_ANALYSIS_REQUESTED_EVENT_V1: &str = "RD_ITERATION_ANALYSIS_REQUESTED_V1";
pub const ITERATION_ANALYSIS_COMPLETED_EVENT_V1: &str = "RD_ITERATION_ANALYSIS_COMPLETED_V1";

/// Caller-owned lookup only. It carries no Result, diagnosis, analysis, or Decision authority.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct IterationAnalysisRequestLocatorV1 {
    pub trial_family_identity: String,
    pub result_identity: String,
    pub request_identity: String,
    pub attempt_identity: String,
}

/// Read-only response-loss recovery locator. It can never create first custody.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct IterationAnalysisResolutionLocatorV1 {
    pub trial_family_identity: String,
    pub result_identity: String,
    pub request_identity: String,
    pub attempt_identity: String,
}

/// Domain-separated digests of canonical bytes already verified under their native Owner locks.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct IterationAnalysisOwnerCustodyDigestsV1 {
    pub replay_request: String,
    pub replay_receipt: String,
    pub replay_outbox: String,
    pub backtest_result: String,
    pub backtest_receipt: String,
    pub backtest_outbox: String,
    pub semantic_trace: String,
    pub outcome_evidence: String,
    pub outcome_receipt: String,
    pub outcome_outbox: String,
    pub engine_result: String,
    pub frozen_intent: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct IterationAnalysisReplayBindingV1 {
    pub request_identity: String,
    pub meaning_digest: String,
    pub receipt_identity: String,
    pub seal_digest: String,
    pub request: ReplayRequestDtoV2,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct IterationAnalysisIntentBindingV1 {
    pub intent_identity: String,
    pub intent_digest: String,
    pub canonical_intent_json: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct IterationAnalysisArtifactBindingV1 {
    pub artifact_identity: String,
    pub artifact_digest: String,
    pub build_request_identity: String,
    pub build_attempt_identity: String,
    pub build_receipt_identity: String,
    pub family_binding_identity: String,
    pub family_binding_digest: String,
}

/// Exact finite candidate frontier exposed to the server-side R&D execution agent.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct IterationAnalysisCandidateFrontierMemberV1 {
    pub experiment_identity: String,
    pub trial_family_identity: String,
    pub attempt_ordinal: u32,
    pub candidate_set_frontier_identity: String,
    pub candidate_set_frontier_digest: String,
    pub candidate_identity: String,
    pub candidate_digest: String,
    pub committed_at_epoch_ms: u64,
    pub receipt_identity: String,
    pub receipt_digest: String,
    pub experiment: crate::IterationExperimentModeV1,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct IterationAnalysisCandidateFrontierV1 {
    pub frontier_identity: String,
    pub frontier_digest: String,
    pub attempt_ordinal: u32,
    pub generation_rule_identity: String,
    pub generation_rule_digest: String,
    pub expected_cardinality: u32,
    pub candidates: Vec<IterationAnalysisCandidateFrontierMemberV1>,
}

/// Exact Backtest facts projected by the R&D Owner from locked canonical engine-result bytes.
///
/// Numeric statistics retain the engine's canonical string representation. No caller-authored
/// floating-point value participates in this projection.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct IterationAnalysisBacktestProjectionV1 {
    schema_version: u16,
    result_identity: String,
    request_identity: String,
    attempt_identity: String,
    pit_scope: ContentIdentityV2,
    pit_snapshot: ContentIdentityV2,
    universe_selection: ContentIdentityV2,
    requested_window: ReplayWindowV2,
    actual_backtest_start_ns: Option<String>,
    actual_backtest_end_ns: Option<String>,
    outcome: String,
    orders_count: u64,
    positions_count: u64,
    fills_count: u64,
    general_statistics: std::collections::BTreeMap<String, String>,
    pnl_statistics: std::collections::BTreeMap<String, std::collections::BTreeMap<String, String>>,
    return_statistics: std::collections::BTreeMap<String, String>,
    canonical_result_binding_digest: String,
    canonical_result_storage_digest: String,
}

/// Complete Owner-locked input handed to the server-side R&D execution agent.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct IterationAnalysisInputV1 {
    pub evidence_cut: IterationDecisionEvidenceCutV1,
    pub diagnostic: IterationInterpretationDiagnosticV1,
    pub required_dimensions: Vec<IterationDiagnosisDimensionV1>,
    pub replay: IterationAnalysisReplayBindingV1,
    pub intent: IterationAnalysisIntentBindingV1,
    pub artifact: IterationAnalysisArtifactBindingV1,
    pub candidate_frontier: IterationAnalysisCandidateFrontierV1,
    pub decision_policy: serde_json::Value,
    pub result: ReplayResultDtoV2,
    pub outcome_evidence: BacktestOutcomeEvidenceDtoV1,
    pub backtest_projection: IterationAnalysisBacktestProjectionV1,
    pub custody_digests: IterationAnalysisOwnerCustodyDigestsV1,
}

/// One model-produced conclusion over evidence locators. It carries no Decision outcome authority.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum IterationAnalysisConclusionV1 {
    Established,
    Rejected,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct IterationAnalysisEvidenceLocatorV1 {
    pub identity: String,
    pub digest: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct IterationAnalysisFindingProposalV1 {
    pub conclusion: IterationAnalysisConclusionV1,
    pub evidence: Vec<IterationAnalysisEvidenceLocatorV1>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct IterationAnalysisCandidateEvaluationProposalV1 {
    pub candidate_identity: String,
    pub candidate_digest: String,
    pub admissibility: crate::IterationCandidateAdmissibilityV1,
    pub information_value: crate::IterationInformationValueEvidenceV1,
    pub uncertainty_reduction_rank: u32,
    pub tie_break_key: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct IterationAnalysisCandidateEvaluationSetProposalV1 {
    pub frontier_identity: String,
    pub frontier_digest: String,
    pub generation_rule_identity: String,
    pub generation_rule_digest: String,
    pub expected_cardinality: u32,
    pub threshold: crate::IterationEvidenceReferenceV1,
    pub candidates: Vec<IterationAnalysisCandidateEvaluationProposalV1>,
}

/// Caller-mintable completion proposal. It cannot choose a Decision outcome or next action.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct IterationAnalysisCompletionProposalV1 {
    pub analysis_request_identity: String,
    pub analysis_request_digest: String,
    pub result_identity: String,
    pub mechanism_validity: IterationAnalysisFindingProposalV1,
    pub economic_viability: IterationAnalysisFindingProposalV1,
    pub robustness: IterationAnalysisFindingProposalV1,
    pub information_value: IterationAnalysisFindingProposalV1,
    pub candidate_evaluations: IterationAnalysisCandidateEvaluationSetProposalV1,
}

/// Read-only response-loss recovery locator. It cannot create first custody.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct IterationAnalysisCompletionResolutionLocatorV1 {
    pub analysis_result_identity: String,
    pub analysis_request_identity: String,
    pub result_identity: String,
}

/// Immutable R&D analysis request. Positive authority comes only from Owner readback.
///
/// ```compile_fail
/// use vibe_strategy_factory::iteration_analysis::IterationAnalysisRequestV1;
/// let _: IterationAnalysisRequestV1 = serde_json::from_str("{}").unwrap();
/// ```
#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct IterationAnalysisRequestV1 {
    schema_version: u16,
    analysis_request_identity: String,
    analysis_request_digest: String,
    locator: IterationAnalysisRequestLocatorV1,
    input: IterationAnalysisInputV1,
    committed_at_epoch_ms: u64,
}

/// Owner receipt; caller JSON cannot manufacture this positive type.
///
/// ```compile_fail
/// use vibe_strategy_factory::iteration_analysis::IterationAnalysisRequestReceiptV1;
/// let _: IterationAnalysisRequestReceiptV1 = serde_json::from_str("{}").unwrap();
/// ```
#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct IterationAnalysisRequestReceiptV1 {
    schema_version: u16,
    receipt_identity: String,
    receipt_digest: String,
    analysis_request_identity: String,
    analysis_request_digest: String,
    result_identity: String,
    committed_at_epoch_ms: u64,
}

/// Move-only positive readback reconstructed only after complete storage verification.
///
/// ```compile_fail
/// use vibe_strategy_factory::iteration_analysis::IterationAnalysisRequestReadbackV1;
/// let _: IterationAnalysisRequestReadbackV1 = serde_json::from_str("{}").unwrap();
/// ```
#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct IterationAnalysisRequestReadbackV1 {
    request: IterationAnalysisRequestV1,
    receipt: IterationAnalysisRequestReceiptV1,
}

/// Owner-sealed completion of one exact analysis request.
///
/// ```compile_fail
/// use vibe_strategy_factory::iteration_analysis::IterationAnalysisResultV1;
/// let _: IterationAnalysisResultV1 = serde_json::from_str("{}").unwrap();
/// ```
#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct IterationAnalysisResultV1 {
    schema_version: u16,
    analysis_result_identity: String,
    analysis_result_digest: String,
    proposal: IterationAnalysisCompletionProposalV1,
    decision_identity: String,
    decision_digest: String,
    committed_at_epoch_ms: u64,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct IterationAnalysisResultReceiptV1 {
    schema_version: u16,
    receipt_identity: String,
    receipt_digest: String,
    analysis_result_identity: String,
    analysis_result_digest: String,
    analysis_request_identity: String,
    result_identity: String,
    committed_at_epoch_ms: u64,
}

/// Move-only positive completion readback issued only by the R&D Owner transaction.
///
/// ```compile_fail
/// use vibe_strategy_factory::iteration_analysis::IterationAnalysisResultReadbackV1;
/// let _: IterationAnalysisResultReadbackV1 = serde_json::from_str("{}").unwrap();
/// ```
#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct IterationAnalysisResultReadbackV1 {
    result: IterationAnalysisResultV1,
    receipt: IterationAnalysisResultReceiptV1,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct IterationAnalysisCompletionReadbackV1 {
    analysis: IterationAnalysisResultReadbackV1,
    decision: CandidateComparisonDecisionReadbackV1,
    next_action: crate::product_edge::ResearchIterationActionProjectionV1,
}

#[derive(Debug, Error)]
pub enum IterationAnalysisRequestErrorV1 {
    #[error("iteration analysis locator is invalid")]
    InvalidLocator,
    #[error("iteration analysis is not applicable to the locked Result")]
    NotApplicable,
    #[error("iteration analysis completion conflicts with existing custody")]
    Conflict,
    #[error("iteration analysis Owner custody is unavailable: {0}")]
    Unavailable(String),
    #[error("iteration analysis storage is unavailable: {0}")]
    Storage(String),
}

#[derive(Serialize)]
struct AnalysisResultMeaningV1<'a> {
    schema_version: u16,
    proposal: &'a IterationAnalysisCompletionProposalV1,
    decision_identity: &'a str,
    decision_digest: &'a str,
    committed_at_epoch_ms: u64,
}

#[derive(Serialize)]
struct AnalysisResultReceiptMeaningV1<'a> {
    schema_version: u16,
    analysis_result_identity: &'a str,
    analysis_result_digest: &'a str,
    analysis_request_identity: &'a str,
    result_identity: &'a str,
    committed_at_epoch_ms: u64,
}

pub(crate) fn issue_iteration_analysis_result_v1(
    proposal: IterationAnalysisCompletionProposalV1,
    decision_identity: &str,
    decision_digest: &str,
    committed_at_epoch_ms: u64,
) -> Result<IterationAnalysisResultReadbackV1, IterationAnalysisRequestErrorV1> {
    validate_completion_proposal(&proposal)?;
    let digest = canonical_digest(
        "rd.iteration-analysis-result.v1",
        &AnalysisResultMeaningV1 {
            schema_version: 1,
            proposal: &proposal,
            decision_identity,
            decision_digest,
            committed_at_epoch_ms,
        },
    )?;
    let result_identity = identity("rd-iteration-analysis-result-v1", &digest);
    let receipt_digest = canonical_digest(
        "rd.iteration-analysis-result-receipt.v1",
        &AnalysisResultReceiptMeaningV1 {
            schema_version: 1,
            analysis_result_identity: &result_identity,
            analysis_result_digest: &digest,
            analysis_request_identity: &proposal.analysis_request_identity,
            result_identity: &proposal.result_identity,
            committed_at_epoch_ms,
        },
    )?;
    Ok(IterationAnalysisResultReadbackV1 {
        result: IterationAnalysisResultV1 {
            schema_version: 1,
            analysis_result_identity: result_identity.clone(),
            analysis_result_digest: digest.clone(),
            proposal: proposal.clone(),
            decision_identity: decision_identity.to_string(),
            decision_digest: decision_digest.to_string(),
            committed_at_epoch_ms,
        },
        receipt: IterationAnalysisResultReceiptV1 {
            schema_version: 1,
            receipt_identity: identity("rd-iteration-analysis-result-receipt-v1", &receipt_digest),
            receipt_digest,
            analysis_result_identity: result_identity,
            analysis_result_digest: digest,
            analysis_request_identity: proposal.analysis_request_identity,
            result_identity: proposal.result_identity,
            committed_at_epoch_ms,
        },
    })
}

#[derive(Serialize)]
struct RequestMeaningV1<'a> {
    schema_version: u16,
    locator: &'a IterationAnalysisRequestLocatorV1,
    input: &'a IterationAnalysisInputV1,
    committed_at_epoch_ms: u64,
}

#[derive(Serialize)]
struct ReceiptMeaningV1<'a> {
    schema_version: u16,
    analysis_request_identity: &'a str,
    analysis_request_digest: &'a str,
    result_identity: &'a str,
    committed_at_epoch_ms: u64,
}

pub(crate) fn issue_iteration_analysis_request_v1(
    locator: IterationAnalysisRequestLocatorV1,
    input: IterationAnalysisInputV1,
    committed_at_epoch_ms: u64,
) -> Result<IterationAnalysisRequestReadbackV1, IterationAnalysisRequestErrorV1> {
    validate_locator(&locator)?;
    validate_input(&locator, &input)?;
    let meaning = RequestMeaningV1 {
        schema_version: 1,
        locator: &locator,
        input: &input,
        committed_at_epoch_ms,
    };
    let analysis_request_digest = canonical_digest("rd.iteration-analysis-request.v1", &meaning)?;
    let analysis_request_identity =
        identity("rd-iteration-analysis-request-v1", &analysis_request_digest);
    let receipt_digest = canonical_digest(
        "rd.iteration-analysis-request-receipt.v1",
        &ReceiptMeaningV1 {
            schema_version: 1,
            analysis_request_identity: &analysis_request_identity,
            analysis_request_digest: &analysis_request_digest,
            result_identity: &locator.result_identity,
            committed_at_epoch_ms,
        },
    )?;
    let receipt_identity = identity("rd-iteration-analysis-request-receipt-v1", &receipt_digest);
    Ok(IterationAnalysisRequestReadbackV1 {
        request: IterationAnalysisRequestV1 {
            schema_version: 1,
            analysis_request_identity: analysis_request_identity.clone(),
            analysis_request_digest: analysis_request_digest.clone(),
            locator: locator.clone(),
            input,
            committed_at_epoch_ms,
        },
        receipt: IterationAnalysisRequestReceiptV1 {
            schema_version: 1,
            receipt_identity,
            receipt_digest,
            analysis_request_identity,
            analysis_request_digest,
            result_identity: locator.result_identity,
            committed_at_epoch_ms,
        },
    })
}

pub(crate) fn owner_storage_digest(domain: &str, bytes: &[u8]) -> String {
    let mut hasher = blake3::Hasher::new();
    hasher.update(domain.as_bytes());
    hasher.update(&[0]);
    hasher.update(bytes);
    format!("blake3:{}", hasher.finalize().to_hex())
}

pub(crate) fn canonical_digest(
    domain: &str,
    value: &impl Serialize,
) -> Result<String, IterationAnalysisRequestErrorV1> {
    let bytes = serde_json::to_vec(value)
        .map_err(|error| IterationAnalysisRequestErrorV1::Storage(error.to_string()))?;
    let mut hasher = Sha256::new();
    hasher.update(domain.as_bytes());
    hasher.update([0]);
    hasher.update(bytes);
    Ok(format!("sha256:{:x}", hasher.finalize()))
}

pub(crate) fn identity(prefix: &str, digest: &str) -> String {
    format!("{prefix}-{}", digest.trim_start_matches("sha256:"))
}

pub(crate) fn validate_locator(
    locator: &IterationAnalysisRequestLocatorV1,
) -> Result<(), IterationAnalysisRequestErrorV1> {
    if [
        locator.trial_family_identity.as_str(),
        locator.result_identity.as_str(),
        locator.request_identity.as_str(),
        locator.attempt_identity.as_str(),
    ]
    .into_iter()
    .any(|value| !is_valid_iteration_decision_locator_v1(value))
    {
        return Err(IterationAnalysisRequestErrorV1::InvalidLocator);
    }
    Ok(())
}

pub(crate) fn validate_completion_proposal(
    proposal: &IterationAnalysisCompletionProposalV1,
) -> Result<(), IterationAnalysisRequestErrorV1> {
    let valid_finding = |finding: &IterationAnalysisFindingProposalV1| {
        !finding.evidence.is_empty()
            && finding.evidence.len() <= 4_096
            && finding.evidence.iter().all(|evidence| {
                is_valid_iteration_decision_locator_v1(&evidence.identity)
                    && is_sha256_digest(&evidence.digest)
            })
    };
    if !is_valid_iteration_decision_locator_v1(&proposal.analysis_request_identity)
        || !is_sha256_digest(&proposal.analysis_request_digest)
        || !is_valid_iteration_decision_locator_v1(&proposal.result_identity)
        || !valid_finding(&proposal.mechanism_validity)
        || !valid_finding(&proposal.economic_viability)
        || !valid_finding(&proposal.robustness)
        || !valid_finding(&proposal.information_value)
    {
        return Err(IterationAnalysisRequestErrorV1::InvalidLocator);
    }
    Ok(())
}

fn is_sha256_digest(value: &str) -> bool {
    value
        .strip_prefix("sha256:")
        .is_some_and(|hex| hex.len() == 64 && hex.bytes().all(|byte| byte.is_ascii_hexdigit()))
}

pub(crate) fn bind_candidate_experiments_to_owner_frontier_v1(
    frontier: &IterationAnalysisCandidateFrontierV1,
    evaluations: &IterationAnalysisCandidateEvaluationSetProposalV1,
) -> Result<IterationCandidateEvaluationSetV1, IterationAnalysisRequestErrorV1> {
    if evaluations.frontier_identity != frontier.frontier_identity
        || evaluations.frontier_digest != frontier.frontier_digest
        || evaluations.generation_rule_identity != frontier.generation_rule_identity
        || evaluations.generation_rule_digest != frontier.generation_rule_digest
        || evaluations.expected_cardinality != frontier.expected_cardinality
        || evaluations.candidates.len() != frontier.candidates.len()
    {
        return Err(IterationAnalysisRequestErrorV1::Conflict);
    }
    if frontier.candidates.iter().any(|candidate| {
        candidate.attempt_ordinal != frontier.attempt_ordinal
            || candidate.candidate_set_frontier_identity != frontier.frontier_identity
            || candidate.candidate_set_frontier_digest != frontier.frontier_digest
            || !is_valid_iteration_decision_locator_v1(&candidate.experiment_identity)
            || !is_valid_iteration_decision_locator_v1(&candidate.receipt_identity)
            || crate::trial_family::candidate_experiment_digest_v1(
                &candidate.candidate_identity,
                &candidate.experiment,
            )
            .map_or(true, |digest| digest != candidate.candidate_digest)
    }) {
        return Err(IterationAnalysisRequestErrorV1::Conflict);
    }
    let owner_members = frontier
        .candidates
        .iter()
        .map(|candidate| {
            (
                candidate.candidate_identity.as_str(),
                candidate.candidate_digest.as_str(),
            )
        })
        .collect::<std::collections::BTreeSet<_>>();
    let mut admitted_members = std::collections::BTreeSet::new();
    for candidate in &evaluations.candidates {
        if !owner_members.contains(&(
            candidate.candidate_identity.as_str(),
            candidate.candidate_digest.as_str(),
        )) || !admitted_members.insert((
            candidate.candidate_identity.as_str(),
            candidate.candidate_digest.as_str(),
        )) {
            return Err(IterationAnalysisRequestErrorV1::Conflict);
        }
    }
    if admitted_members != owner_members {
        return Err(IterationAnalysisRequestErrorV1::Conflict);
    }
    Ok(IterationCandidateEvaluationSetV1 {
        frontier_identity: evaluations.frontier_identity.clone(),
        frontier_digest: evaluations.frontier_digest.clone(),
        generation_rule_identity: evaluations.generation_rule_identity.clone(),
        generation_rule_digest: evaluations.generation_rule_digest.clone(),
        expected_cardinality: evaluations.expected_cardinality,
        threshold: evaluations.threshold.clone(),
        candidates: evaluations
            .candidates
            .iter()
            .map(|candidate| {
                let owner = frontier
                    .candidates
                    .iter()
                    .find(|owner| {
                        owner.candidate_identity == candidate.candidate_identity
                            && owner.candidate_digest == candidate.candidate_digest
                    })
                    .ok_or(IterationAnalysisRequestErrorV1::Conflict)?;
                Ok(crate::IterationCandidateEvaluationV1 {
                    candidate_identity: candidate.candidate_identity.clone(),
                    candidate_digest: candidate.candidate_digest.clone(),
                    admissibility: candidate.admissibility.clone(),
                    information_value: candidate.information_value.clone(),
                    uncertainty_reduction_rank: candidate.uncertainty_reduction_rank,
                    tie_break_key: candidate.tie_break_key.clone(),
                    experiment: owner.experiment.clone(),
                })
            })
            .collect::<Result<Vec<_>, IterationAnalysisRequestErrorV1>>()?,
    })
}

pub(crate) fn ensure_same_completion_proposal_v1(
    stored: &IterationAnalysisResultReadbackV1,
    proposed: &IterationAnalysisCompletionProposalV1,
) -> Result<(), IterationAnalysisRequestErrorV1> {
    if stored.result().proposal() != proposed {
        return Err(IterationAnalysisRequestErrorV1::Conflict);
    }
    Ok(())
}

struct BacktestProjectionAuthorityV1<'a> {
    locator: &'a IterationAnalysisRequestLocatorV1,
    pit_scope: &'a ContentIdentityV2,
    pit_snapshot: &'a ContentIdentityV2,
    universe_selection: &'a ContentIdentityV2,
    requested_window: &'a ReplayWindowV2,
    canonical_result_binding_digest: &'a str,
    canonical_result_storage_digest: &'a str,
}

fn backtest_projection_matches_authority_v1(
    projection: &IterationAnalysisBacktestProjectionV1,
    authority: BacktestProjectionAuthorityV1<'_>,
) -> bool {
    projection.schema_version == 1
        && projection.result_identity == authority.locator.result_identity
        && projection.request_identity == authority.locator.request_identity
        && projection.attempt_identity == authority.locator.attempt_identity
        && &projection.pit_scope == authority.pit_scope
        && &projection.pit_snapshot == authority.pit_snapshot
        && &projection.universe_selection == authority.universe_selection
        && &projection.requested_window == authority.requested_window
        && projection.canonical_result_binding_digest == authority.canonical_result_binding_digest
        && projection.canonical_result_storage_digest == authority.canonical_result_storage_digest
}

fn validate_input(
    locator: &IterationAnalysisRequestLocatorV1,
    input: &IterationAnalysisInputV1,
) -> Result<(), IterationAnalysisRequestErrorV1> {
    let canonical_dimensions = [
        IterationDiagnosisDimensionV1::EvidenceIntegrity,
        IterationDiagnosisDimensionV1::MechanismValidity,
        IterationDiagnosisDimensionV1::EconomicViability,
        IterationDiagnosisDimensionV1::Robustness,
        IterationDiagnosisDimensionV1::FailureAttribution,
        IterationDiagnosisDimensionV1::InformationValue,
    ];
    let candidate_projection_invalid =
        input.candidate_frontier.candidates.iter().any(|candidate| {
            candidate.trial_family_identity != locator.trial_family_identity
                || candidate.attempt_ordinal != input.candidate_frontier.attempt_ordinal
                || candidate.candidate_set_frontier_identity
                    != input.candidate_frontier.frontier_identity
                || candidate.candidate_set_frontier_digest
                    != input.candidate_frontier.frontier_digest
                || !is_valid_iteration_decision_locator_v1(&candidate.experiment_identity)
                || !is_valid_iteration_decision_locator_v1(&candidate.receipt_identity)
                || !is_sha256_digest(&candidate.candidate_digest)
                || !is_sha256_digest(&candidate.receipt_digest)
                || crate::trial_family::candidate_experiment_digest_v1(
                    &candidate.candidate_identity,
                    &candidate.experiment,
                )
                .map_or(true, |digest| digest != candidate.candidate_digest)
        });
    if input.required_dimensions != canonical_dimensions
        || candidate_projection_invalid
        || input.evidence_cut.trial_family_identity != locator.trial_family_identity
        || input.evidence_cut.result_identity != locator.result_identity
        || input.evidence_cut.request_identity != locator.request_identity
        || input.evidence_cut.attempt_identity != locator.attempt_identity
        || input.replay.request_identity != locator.request_identity
        || input.replay.request.request_identity.as_str() != locator.request_identity
        || input.result.result_identity.as_str() != locator.result_identity
        || input.result.request_identity.as_str() != locator.request_identity
        || input.result.attempt_identity.as_str() != locator.attempt_identity
        || input
            .replay
            .request
            .frozen_research_intent
            .identity
            .as_str()
            != input.intent.intent_identity
        || input.replay.request.frozen_research_intent.digest.as_str() != input.intent.intent_digest
        || input.replay.request.artifact.identity.as_str() != input.artifact.artifact_identity
        || input.replay.request.artifact.digest.as_str() != input.artifact.artifact_digest
        || input.candidate_frontier.frontier_identity
            != input.evidence_cut.candidate_set_frontier_identity
        || input.candidate_frontier.frontier_digest
            != input.evidence_cut.candidate_set_frontier_digest
        || !backtest_projection_matches_authority_v1(
            &input.backtest_projection,
            BacktestProjectionAuthorityV1 {
                locator,
                pit_scope: &input.replay.request.pit_scope,
                pit_snapshot: &input.replay.request.pit_snapshot,
                universe_selection: &input.replay.request.universe_selection,
                requested_window: &input.replay.request.window,
                canonical_result_binding_digest: input
                    .outcome_evidence
                    .canonical_result
                    .canonical_bytes_digest
                    .as_str(),
                canonical_result_storage_digest: &input.custody_digests.engine_result,
            },
        )
    {
        return Err(IterationAnalysisRequestErrorV1::Unavailable(
            "analysis input is cross-spliced".to_string(),
        ));
    }
    Ok(())
}

impl IterationAnalysisBacktestProjectionV1 {
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn new(
        result_identity: String,
        request_identity: String,
        attempt_identity: String,
        pit_scope: ContentIdentityV2,
        pit_snapshot: ContentIdentityV2,
        universe_selection: ContentIdentityV2,
        requested_window: ReplayWindowV2,
        actual_backtest_start_ns: Option<String>,
        actual_backtest_end_ns: Option<String>,
        outcome: String,
        orders_count: u64,
        positions_count: u64,
        fills_count: u64,
        general_statistics: std::collections::BTreeMap<String, String>,
        pnl_statistics: std::collections::BTreeMap<
            String,
            std::collections::BTreeMap<String, String>,
        >,
        return_statistics: std::collections::BTreeMap<String, String>,
        canonical_result_binding_digest: String,
        canonical_result_storage_digest: String,
    ) -> Self {
        Self {
            schema_version: 1,
            result_identity,
            request_identity,
            attempt_identity,
            pit_scope,
            pit_snapshot,
            universe_selection,
            requested_window,
            actual_backtest_start_ns,
            actual_backtest_end_ns,
            outcome,
            orders_count,
            positions_count,
            fills_count,
            general_statistics,
            pnl_statistics,
            return_statistics,
            canonical_result_binding_digest,
            canonical_result_storage_digest,
        }
    }
}

impl IterationAnalysisRequestV1 {
    pub fn analysis_request_identity(&self) -> &str {
        &self.analysis_request_identity
    }

    pub fn analysis_request_digest(&self) -> &str {
        &self.analysis_request_digest
    }

    pub fn locator(&self) -> &IterationAnalysisRequestLocatorV1 {
        &self.locator
    }

    pub fn input(&self) -> &IterationAnalysisInputV1 {
        &self.input
    }

    pub const fn committed_at_epoch_ms(&self) -> u64 {
        self.committed_at_epoch_ms
    }
}

impl IterationAnalysisRequestReceiptV1 {
    pub fn receipt_identity(&self) -> &str {
        &self.receipt_identity
    }

    pub fn receipt_digest(&self) -> &str {
        &self.receipt_digest
    }
}

impl IterationAnalysisRequestReadbackV1 {
    pub const fn request(&self) -> &IterationAnalysisRequestV1 {
        &self.request
    }

    pub const fn receipt(&self) -> &IterationAnalysisRequestReceiptV1 {
        &self.receipt
    }
}

impl IterationAnalysisResultV1 {
    pub fn analysis_result_identity(&self) -> &str {
        &self.analysis_result_identity
    }

    pub fn analysis_result_digest(&self) -> &str {
        &self.analysis_result_digest
    }

    pub fn proposal(&self) -> &IterationAnalysisCompletionProposalV1 {
        &self.proposal
    }

    pub fn decision_identity(&self) -> &str {
        &self.decision_identity
    }

    pub fn decision_digest(&self) -> &str {
        &self.decision_digest
    }

    pub const fn committed_at_epoch_ms(&self) -> u64 {
        self.committed_at_epoch_ms
    }
}

impl IterationAnalysisResultReceiptV1 {
    pub fn receipt_identity(&self) -> &str {
        &self.receipt_identity
    }
}

impl IterationAnalysisResultReadbackV1 {
    pub const fn result(&self) -> &IterationAnalysisResultV1 {
        &self.result
    }

    pub const fn receipt(&self) -> &IterationAnalysisResultReceiptV1 {
        &self.receipt
    }
}

impl IterationAnalysisCompletionReadbackV1 {
    pub(crate) const fn new(
        analysis: IterationAnalysisResultReadbackV1,
        decision: CandidateComparisonDecisionReadbackV1,
        next_action: crate::product_edge::ResearchIterationActionProjectionV1,
    ) -> Self {
        Self {
            analysis,
            decision,
            next_action,
        }
    }

    pub const fn analysis(&self) -> &IterationAnalysisResultReadbackV1 {
        &self.analysis
    }

    pub const fn decision(&self) -> &CandidateComparisonDecisionReadbackV1 {
        &self.decision
    }

    pub const fn next_action(&self) -> &crate::product_edge::ResearchIterationActionProjectionV1 {
        &self.next_action
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn content(identity: &str, marker: char) -> ContentIdentityV2 {
        serde_json::from_value(serde_json::json!({
            "identity": identity,
            "digest": format!("blake3:{}", marker.to_string().repeat(64)),
        }))
        .expect("content identity")
    }

    fn backtest_projection() -> IterationAnalysisBacktestProjectionV1 {
        IterationAnalysisBacktestProjectionV1::new(
            "result-1".to_string(),
            "request-1".to_string(),
            "attempt-1".to_string(),
            content("pit-scope-1", '1'),
            content("pit-snapshot-1", '2'),
            content("universe-1", '3'),
            ReplayWindowV2 {
                start_event_ns: 10,
                end_event_ns_exclusive: 20,
            },
            Some("11".to_string()),
            Some("19".to_string()),
            "completed".to_string(),
            2,
            1,
            3,
            std::collections::BTreeMap::from([(
                "Max Drawdown".to_string(),
                "bfc0000000000000".to_string(),
            )]),
            std::collections::BTreeMap::new(),
            std::collections::BTreeMap::from([(
                "Sharpe Ratio (252 days)".to_string(),
                "3ff0000000000000".to_string(),
            )]),
            format!("blake3:{}", "4".repeat(64)),
            format!("blake3:{}", "5".repeat(64)),
        )
    }

    fn projection_authority<'a>(
        locator: &'a IterationAnalysisRequestLocatorV1,
        projection: &'a IterationAnalysisBacktestProjectionV1,
    ) -> BacktestProjectionAuthorityV1<'a> {
        BacktestProjectionAuthorityV1 {
            locator,
            pit_scope: &projection.pit_scope,
            pit_snapshot: &projection.pit_snapshot,
            universe_selection: &projection.universe_selection,
            requested_window: &projection.requested_window,
            canonical_result_binding_digest: &projection.canonical_result_binding_digest,
            canonical_result_storage_digest: &projection.canonical_result_storage_digest,
        }
    }

    fn completion_proposal() -> IterationAnalysisCompletionProposalV1 {
        let digest = format!("sha256:{}", "a".repeat(64));
        let finding = IterationAnalysisFindingProposalV1 {
            conclusion: IterationAnalysisConclusionV1::Established,
            evidence: vec![IterationAnalysisEvidenceLocatorV1 {
                identity: "evidence-1".to_string(),
                digest: digest.clone(),
            }],
        };
        IterationAnalysisCompletionProposalV1 {
            analysis_request_identity: "analysis-request-1".to_string(),
            analysis_request_digest: digest.clone(),
            result_identity: "result-1".to_string(),
            mechanism_validity: finding.clone(),
            economic_viability: finding.clone(),
            robustness: finding.clone(),
            information_value: finding,
            candidate_evaluations: IterationAnalysisCandidateEvaluationSetProposalV1 {
                frontier_identity: "frontier-1".to_string(),
                frontier_digest: digest.clone(),
                generation_rule_identity: "generation-rule-1".to_string(),
                generation_rule_digest: digest.clone(),
                expected_cardinality: 0,
                threshold: crate::IterationEvidenceReferenceV1 {
                    identity: "threshold-1".to_string(),
                    digest,
                },
                candidates: Vec::new(),
            },
        }
    }

    #[test]
    fn locator_rejects_derived_or_missing_authority() {
        let locator = IterationAnalysisRequestLocatorV1 {
            trial_family_identity: "family-1".to_string(),
            result_identity: "result-1".to_string(),
            request_identity: String::new(),
            attempt_identity: "attempt-1".to_string(),
        };
        assert!(matches!(
            validate_locator(&locator),
            Err(IterationAnalysisRequestErrorV1::InvalidLocator)
        ));
    }

    #[test]
    fn backtest_projection_rejects_locator_pit_window_and_digest_splices() {
        let locator = IterationAnalysisRequestLocatorV1 {
            trial_family_identity: "family-1".to_string(),
            result_identity: "result-1".to_string(),
            request_identity: "request-1".to_string(),
            attempt_identity: "attempt-1".to_string(),
        };
        let expected = backtest_projection();
        assert!(backtest_projection_matches_authority_v1(
            &expected,
            projection_authority(&locator, &expected),
        ));

        let mut tampered = expected.clone();
        tampered.result_identity = "result-2".to_string();
        assert!(!backtest_projection_matches_authority_v1(
            &tampered,
            projection_authority(&locator, &expected),
        ));
        tampered = expected.clone();
        tampered.request_identity = "request-2".to_string();
        assert!(!backtest_projection_matches_authority_v1(
            &tampered,
            projection_authority(&locator, &expected),
        ));
        tampered = expected.clone();
        tampered.attempt_identity = "attempt-2".to_string();
        assert!(!backtest_projection_matches_authority_v1(
            &tampered,
            projection_authority(&locator, &expected),
        ));
        tampered = expected.clone();
        tampered.pit_scope = content("pit-scope-2", '9');
        assert!(!backtest_projection_matches_authority_v1(
            &tampered,
            projection_authority(&locator, &expected),
        ));
        tampered = expected.clone();
        tampered.pit_snapshot = content("pit-snapshot-2", '6');
        assert!(!backtest_projection_matches_authority_v1(
            &tampered,
            projection_authority(&locator, &expected),
        ));
        tampered = expected.clone();
        tampered.universe_selection = content("universe-2", '7');
        assert!(!backtest_projection_matches_authority_v1(
            &tampered,
            projection_authority(&locator, &expected),
        ));
        tampered = expected.clone();
        tampered.requested_window.end_event_ns_exclusive = 21;
        assert!(!backtest_projection_matches_authority_v1(
            &tampered,
            projection_authority(&locator, &expected),
        ));
        tampered = expected.clone();
        tampered.canonical_result_binding_digest = format!("blake3:{}", "8".repeat(64));
        assert!(!backtest_projection_matches_authority_v1(
            &tampered,
            projection_authority(&locator, &expected),
        ));
        tampered = expected.clone();
        tampered.canonical_result_storage_digest = format!("blake3:{}", "a".repeat(64));
        assert!(!backtest_projection_matches_authority_v1(
            &tampered,
            projection_authority(&locator, &expected),
        ));
    }

    #[test]
    fn completion_requires_all_four_evidence_sets_and_rejects_outcome_injection() {
        let proposal = completion_proposal();
        validate_completion_proposal(&proposal).expect("complete analytical proposal");

        let mut incomplete = proposal.clone();
        incomplete.robustness.evidence.clear();
        assert!(matches!(
            validate_completion_proposal(&incomplete),
            Err(IterationAnalysisRequestErrorV1::InvalidLocator)
        ));

        let mut injected = serde_json::to_value(proposal).expect("proposal JSON");
        injected["outcome"] = serde_json::json!({"next_action": "CREATE_SUCCESSOR_INTENT"});
        assert!(serde_json::from_value::<IterationAnalysisCompletionProposalV1>(injected).is_err());
    }

    #[test]
    fn candidate_experiment_must_match_owner_custodied_digest() {
        let candidate_identity = "candidate-1".to_string();
        let experiment = crate::IterationExperimentModeV1::SingleDimension {
            changed_dimension: crate::IterationHypothesisDimensionV1::ReturnMechanism,
        };
        let candidate_digest =
            crate::trial_family::candidate_experiment_digest_v1(&candidate_identity, &experiment)
                .expect("canonical experiment digest");
        let frontier = IterationAnalysisCandidateFrontierV1 {
            frontier_identity: "frontier-1".to_string(),
            frontier_digest: format!("sha256:{}", "1".repeat(64)),
            attempt_ordinal: 0,
            generation_rule_identity: "generation-rule-1".to_string(),
            generation_rule_digest: format!("sha256:{}", "2".repeat(64)),
            expected_cardinality: 1,
            candidates: vec![IterationAnalysisCandidateFrontierMemberV1 {
                experiment_identity: "experiment-1".to_string(),
                trial_family_identity: "family-1".to_string(),
                attempt_ordinal: 0,
                candidate_set_frontier_identity: "frontier-1".to_string(),
                candidate_set_frontier_digest: format!("sha256:{}", "1".repeat(64)),
                candidate_identity: candidate_identity.clone(),
                candidate_digest: candidate_digest.clone(),
                committed_at_epoch_ms: 42,
                receipt_identity: "experiment-receipt-1".to_string(),
                receipt_digest: format!("sha256:{}", "5".repeat(64)),
                experiment: experiment.clone(),
            }],
        };
        let reference = crate::IterationEvidenceReferenceV1 {
            identity: "evidence-1".to_string(),
            digest: format!("sha256:{}", "3".repeat(64)),
        };
        let mut evaluations = IterationAnalysisCandidateEvaluationSetProposalV1 {
            frontier_identity: frontier.frontier_identity.clone(),
            frontier_digest: frontier.frontier_digest.clone(),
            generation_rule_identity: frontier.generation_rule_identity.clone(),
            generation_rule_digest: frontier.generation_rule_digest.clone(),
            expected_cardinality: 1,
            threshold: reference.clone(),
            candidates: vec![IterationAnalysisCandidateEvaluationProposalV1 {
                candidate_identity,
                candidate_digest,
                admissibility: crate::IterationCandidateAdmissibilityV1::AdmissibleAboveThreshold,
                information_value: crate::IterationInformationValueEvidenceV1 {
                    decision_uncertainty: reference.clone(),
                    distinguishing_observation_or_falsifier: reference.clone(),
                    result_to_action_map: reference.clone(),
                    bounded_acquisition_cost: reference.clone(),
                    remaining_family_budget_effect: reference.clone(),
                    competing_alternatives: vec![reference.clone()],
                    ordinal_rationale: reference,
                },
                uncertainty_reduction_rank: 1,
                tie_break_key: "candidate-1".to_string(),
            }],
        };
        let bound = bind_candidate_experiments_to_owner_frontier_v1(&frontier, &evaluations)
            .expect("Owner-bound experiment");
        assert_eq!(bound.candidates[0].experiment, experiment);

        let mut wrong_projection = frontier.clone();
        wrong_projection.candidates[0].attempt_ordinal = 1;
        assert!(matches!(
            bind_candidate_experiments_to_owner_frontier_v1(&wrong_projection, &evaluations),
            Err(IterationAnalysisRequestErrorV1::Conflict)
        ));

        let mut injected = serde_json::to_value(&evaluations).expect("evaluation proposal");
        injected["candidates"][0]["experiment"] = serde_json::json!({
            "mode": "SINGLE_DIMENSION", "changed_dimension": "MARKET_REGIME"
        });
        assert!(
            serde_json::from_value::<IterationAnalysisCandidateEvaluationSetProposalV1>(injected)
                .is_err()
        );
        evaluations.candidates[0].candidate_digest = format!("sha256:{}", "4".repeat(64));
        assert!(matches!(
            bind_candidate_experiments_to_owner_frontier_v1(&frontier, &evaluations),
            Err(IterationAnalysisRequestErrorV1::Conflict)
        ));
    }

    #[test]
    fn identical_completion_retry_requires_the_exact_frozen_proposal() {
        let proposal = completion_proposal();
        let stored = issue_iteration_analysis_result_v1(
            proposal.clone(),
            "decision-1",
            &format!("sha256:{}", "5".repeat(64)),
            42,
        )
        .expect("stored completion");
        ensure_same_completion_proposal_v1(&stored, &proposal).expect("identical retry");

        let mut conflicting = proposal;
        conflicting.information_value.conclusion = IterationAnalysisConclusionV1::Rejected;
        assert!(matches!(
            ensure_same_completion_proposal_v1(&stored, &conflicting),
            Err(IterationAnalysisRequestErrorV1::Conflict)
        ));
    }
}
