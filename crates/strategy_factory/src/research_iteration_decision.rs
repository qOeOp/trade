//! R&D-owned diagnosis, iteration-decision, and selected-only disposition contracts.
//!
//! This module is an Owner foundation only. No production Backtest read-port implementation or
//! canonical R&D composition currently exists. Positive cases use a `#[cfg(test)]` issuer and do
//! not establish Backtest-to-R&D, Candidate, or Qualification reachability. Public callers can
//! retain locators and serialize committed facts, but cannot construct positive custody.

use std::{collections::BTreeSet, fmt::Display};

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;
use vibe_backtest_owner_contracts::{DiagnosticCategoryV2, ReplayNamespaceV2, ReplayTerminalV2};

mod postgres;

#[cfg(test)]
mod tests;

pub const DECISION_EVENT_V1: &str = "RESEARCH_ITERATION_DECIDED_V1";
pub const SELECTION_EVENT_V1: &str = "SELECTED_FOR_QUALIFICATION_V1";
pub const DECISION_OPERATION_V1: &str = "research_iteration_decision.submit_or_resolve.v1";
pub const SELECTION_OPERATION_V1: &str = "research_selection.submit_or_resolve.v1";

mod sealed {
    pub(crate) trait BacktestTerminalResultReadPortSealed {}
}

#[async_trait]
pub(crate) trait BacktestTerminalResultReadPortV1:
    sealed::BacktestTerminalResultReadPortSealed + Send + Sync
{
    async fn read_terminal_result(
        &self,
        locator: &BacktestResultLocatorV1,
    ) -> Result<BacktestResultReadV1, ResearchDecisionError>;
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct IdentityDigestV1 {
    pub identity: String,
    pub digest: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct VersionedIdentityV1 {
    pub identity: String,
    pub version: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct BacktestResultLocatorV1 {
    pub request_identity: String,
    pub request_meaning_digest: String,
    pub result_identity: String,
    pub result_digest: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ReplayEvidenceBindingsV1 {
    pub intent: IdentityDigestV1,
    pub trial_family: IdentityDigestV1,
    pub trial_family_census_frontier: IdentityDigestV1,
    pub replay_authority: IdentityDigestV1,
    pub strategy_design: IdentityDigestV1,
    pub strategy_plan: IdentityDigestV1,
    pub artifact: IdentityDigestV1,
    pub resolved_owner_inputs: IdentityDigestV1,
    pub replay_request: IdentityDigestV1,
    pub requested_pit_scope: IdentityDigestV1,
    pub pit_snapshot: IdentityDigestV1,
    pub universe_selection: IdentityDigestV1,
    pub instrument_master_facts: Vec<IdentityDigestV1>,
    pub instrument_master_cut: IdentityDigestV1,
    pub correction_rule: IdentityDigestV1,
    pub market_semantics: IdentityDigestV1,
    pub replay_configuration: IdentityDigestV1,
    pub runtime_kernel: IdentityDigestV1,
    pub simulator: IdentityDigestV1,
    pub cost_model: IdentityDigestV1,
    pub slippage_model: IdentityDigestV1,
    pub capacity_model: IdentityDigestV1,
    pub runner_operational_profile: IdentityDigestV1,
    pub diagnostic_policy: IdentityDigestV1,
    pub deterministic_seed: IdentityDigestV1,
    pub replay_window: IdentityDigestV1,
    pub calendar: IdentityDigestV1,
    pub session: IdentityDigestV1,
    pub time_zone: IdentityDigestV1,
    pub corporate_action_cut: IdentityDigestV1,
    pub historical_membership_cut: IdentityDigestV1,
    pub semantic_trace: IdentityDigestV1,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct DiagnosticEvidenceV1 {
    pub category: DiagnosticCategoryV2,
    pub evidence: IdentityDigestV1,
}

/// Crate-private positive carrier. Only the `#[cfg(test)]` issuer exists in this foundation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct SealedBacktestTerminalResultV1 {
    schema_version: u16,
    locator: BacktestResultLocatorV1,
    attempt_identity: String,
    namespace: ReplayNamespaceV2,
    terminal: ReplayTerminalV2,
    bindings: ReplayEvidenceBindingsV1,
    diagnostics: Vec<DiagnosticEvidenceV1>,
}

impl SealedBacktestTerminalResultV1 {
    fn canonical_bytes(&self) -> Result<Vec<u8>, ResearchDecisionError> {
        serde_json::to_vec(self).map_err(encoding)
    }
}

#[derive(Debug)]
pub(crate) enum BacktestResultReadV1 {
    Unavailable,
    Nonterminal,
    Terminal(Box<SealedBacktestTerminalResultV1>),
}

#[cfg(test)]
pub(crate) fn seal_backtest_terminal_result_v1(
    locator: BacktestResultLocatorV1,
    attempt_identity: String,
    namespace: ReplayNamespaceV2,
    terminal: ReplayTerminalV2,
    bindings: ReplayEvidenceBindingsV1,
    diagnostics: Vec<DiagnosticEvidenceV1>,
) -> Result<SealedBacktestTerminalResultV1, ResearchDecisionError> {
    validate_locator(&locator)?;
    validate_text(&attempt_identity, "attempt_identity")?;
    validate_bindings(&bindings)?;
    validate_diagnostics(terminal, &diagnostics)?;
    if namespace != ReplayNamespaceV2::Exploratory || terminal != ReplayTerminalV2::TerminalResult {
        return Err(ResearchDecisionError::InvalidInput(
            "only exploratory TERMINAL_RESULT may be sealed for R&D diagnosis",
        ));
    }
    Ok(SealedBacktestTerminalResultV1 {
        schema_version: 1,
        locator,
        attempt_identity,
        namespace,
        terminal,
        bindings,
        diagnostics,
    })
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum DimensionDispositionV1 {
    Supported,
    Falsified,
    EconomicallyImpossible,
    Robust,
    Fragile,
    InputUnavailable,
    NoFinding,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct DiagnosisFindingV1 {
    pub disposition: DimensionDispositionV1,
    pub evidence: IdentityDigestV1,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct DiagnosisV1 {
    pub evidence_integrity: DiagnosisFindingV1,
    pub mechanism_validity: DiagnosisFindingV1,
    pub economic_viability: DiagnosisFindingV1,
    pub robustness: DiagnosisFindingV1,
    pub failure_attribution: DiagnosisFindingV1,
    pub information_value: DiagnosisFindingV1,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Deserialize, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum HypothesisDimensionV1 {
    ReturnMechanism,
    MarketRegime,
    InstrumentScope,
    FeatureSignal,
    EntryRule,
    ExitRule,
    PositionAndHolding,
    FrequencyAndCost,
    CapacityAndPortfolioRole,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct PreregisteredFiniteJointV1 {
    pub changed_dimensions: Vec<HypothesisDimensionV1>,
    pub bounded_combinations: Vec<IdentityDigestV1>,
    pub attribution_rule: IdentityDigestV1,
    pub budget: IdentityDigestV1,
    pub falsifier: IdentityDigestV1,
    pub stop_rule: IdentityDigestV1,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(tag = "mode", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ExperimentModeV1 {
    SingleDimension {
        changed_dimension: HypothesisDimensionV1,
    },
    PreregisteredFiniteJoint {
        contract: Box<PreregisteredFiniteJointV1>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CandidateInadmissibilityV1 {
    BudgetExceeded,
    MissingBinding,
    NotPreregistered,
    AttributionUnavailable,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(
    tag = "status",
    content = "reason",
    rename_all = "SCREAMING_SNAKE_CASE"
)]
pub enum CandidateAdmissibilityV1 {
    AdmissibleAboveThreshold,
    AdmissibleBelowThreshold,
    Inadmissible(CandidateInadmissibilityV1),
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct InformationValueEvidenceV1 {
    pub decision_uncertainty: IdentityDigestV1,
    pub distinguishing_observation_or_falsifier: IdentityDigestV1,
    pub result_to_action_map: IdentityDigestV1,
    pub bounded_acquisition_cost: IdentityDigestV1,
    pub remaining_family_budget_effect: IdentityDigestV1,
    pub competing_alternatives: Vec<IdentityDigestV1>,
    pub ordinal_rationale: IdentityDigestV1,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SuccessorCandidateV1 {
    pub candidate: IdentityDigestV1,
    pub admissibility: CandidateAdmissibilityV1,
    pub information_value: InformationValueEvidenceV1,
    pub uncertainty_reduction_rank: u32,
    pub tie_break_key: String,
    pub experiment: ExperimentModeV1,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct CandidateSetV1 {
    pub generation_rule: IdentityDigestV1,
    pub frontier: IdentityDigestV1,
    pub expected_cardinality: u32,
    pub candidates: Vec<SuccessorCandidateV1>,
    pub threshold: IdentityDigestV1,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum TerminalStopV1 {
    InputUnavailable,
    FalsifierTriggered,
    StopRuleTriggered,
    BudgetExhausted,
    EconomicImpossibility,
    LowInformationValue,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct HardStopV1 {
    pub reason: TerminalStopV1,
    pub evidence: IdentityDigestV1,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct DecisionPolicyV1 {
    pub policy: VersionedIdentityV1,
    pub evidence_cut: IdentityDigestV1,
    pub falsifier: IdentityDigestV1,
    pub stop_rule: IdentityDigestV1,
    pub applicable_hard_stop: Option<HardStopV1>,
    pub ready_for_selection: Option<ReadyForSelectionEvidenceV1>,
    pub candidate_set: Option<CandidateSetV1>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ReadyForSelectionEvidenceV1 {
    pub exploratory_frontier: IdentityDigestV1,
    pub consumed_family_budget: IdentityDigestV1,
    pub completeness_proof: IdentityDigestV1,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct DecisionCommitRequestV1 {
    pub decision_request_identity: String,
    pub expected_result: BacktestResultLocatorV1,
    pub expected_bindings: ReplayEvidenceBindingsV1,
    pub diagnosis: DiagnosisV1,
    pub policy: DecisionPolicyV1,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RepairTargetV1 {
    MarketData,
    Artifact,
    RuntimeKernel,
    BacktestOperational,
    Simulator,
    ReplayConfiguration,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum IterationOutcomeV1 {
    RepairInputs {
        supported_diagnostics: Vec<DiagnosticEvidenceV1>,
        selected_target: RepairTargetV1,
    },
    SuccessorExperiment {
        winner: Box<SuccessorCandidateV1>,
        candidate_set_frontier: IdentityDigestV1,
    },
    ReadyForSelection,
    TerminalStop {
        reason: TerminalStopV1,
        stop_evidence: IdentityDigestV1,
        candidate_set_frontier: Option<IdentityDigestV1>,
    },
}

/// Serialize-only R&D decision fact; callers cannot deserialize or construct positive custody.
///
/// ```compile_fail
/// use vibe_strategy_factory::research_iteration_decision::ResearchIterationDecisionV1;
/// let _: ResearchIterationDecisionV1 = serde_json::from_str("{}").unwrap();
/// ```
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ResearchIterationDecisionV1 {
    schema_version: u16,
    decision_identity: String,
    decision_request_identity: String,
    meaning_digest: String,
    result: BacktestResultLocatorV1,
    attempt_identity: String,
    bindings: ReplayEvidenceBindingsV1,
    diagnostics: Vec<DiagnosticEvidenceV1>,
    diagnosis: DiagnosisV1,
    policy: DecisionPolicyV1,
    outcome: IterationOutcomeV1,
    committed_at_epoch_ms: u64,
}

impl ResearchIterationDecisionV1 {
    pub fn decision_identity(&self) -> &str {
        &self.decision_identity
    }

    pub const fn outcome(&self) -> &IterationOutcomeV1 {
        &self.outcome
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct DecisionLocatorV1 {
    pub decision_request_identity: String,
    pub meaning_digest: String,
    pub decision_identity: String,
    pub receipt_identity: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct OwnerReceiptV1 {
    schema_version: u16,
    receipt_identity: String,
    aggregate_identity: String,
    meaning_digest: String,
    committed_at_epoch_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct OwnerOutboxV1 {
    schema_version: u16,
    event_identity: String,
    aggregate_identity: String,
    event_kind: String,
    payload_digest: String,
    committed_at_epoch_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct DecisionCommitResultV1 {
    decision: ResearchIterationDecisionV1,
    receipt: OwnerReceiptV1,
    outbox: OwnerOutboxV1,
    locator: DecisionLocatorV1,
}

impl DecisionCommitResultV1 {
    pub const fn decision(&self) -> &ResearchIterationDecisionV1 {
        &self.decision
    }

    pub const fn locator(&self) -> &DecisionLocatorV1 {
        &self.locator
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum DecisionAvailabilityV1 {
    Committed,
    SubmittedOrUnknown,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct DecisionProjectionV1 {
    pub decision_request_identity: String,
    pub availability: DecisionAvailabilityV1,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum DecisionOwnerResponseV1 {
    SubmittedOrUnknown { projection: DecisionProjectionV1 },
    Committed { result: Box<DecisionCommitResultV1> },
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SelectionRationaleV1 {
    MechanismSupported,
    EconomicCaseSupported,
    RobustnessSupported,
    InformationFrontierComplete,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct SelectionCommitRequestV1 {
    pub selection_request_identity: String,
    pub decision: DecisionLocatorV1,
    pub result: BacktestResultLocatorV1,
    pub trial_family: IdentityDigestV1,
    pub census_frontier: IdentityDigestV1,
    pub artifact: IdentityDigestV1,
    pub cost_model: IdentityDigestV1,
    pub slippage_model: IdentityDigestV1,
    pub capacity_model: IdentityDigestV1,
    pub falsifier: IdentityDigestV1,
    pub stop_rule: IdentityDigestV1,
    pub evidence_cut: IdentityDigestV1,
    pub policy: VersionedIdentityV1,
    pub rationale: SelectionRationaleV1,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
/// Serialize-only selected disposition; this foundation does not submit a Candidate.
///
/// ```compile_fail
/// use vibe_strategy_factory::research_iteration_decision::ResearchSelectionDispositionV1;
/// let _: ResearchSelectionDispositionV1 = serde_json::from_str("{}").unwrap();
/// ```
pub struct ResearchSelectionDispositionV1 {
    schema_version: u16,
    selection_identity: String,
    selection_request_identity: String,
    meaning_digest: String,
    decision_identity: String,
    result: BacktestResultLocatorV1,
    trial_family: IdentityDigestV1,
    census_frontier: IdentityDigestV1,
    artifact: IdentityDigestV1,
    cost_model: IdentityDigestV1,
    slippage_model: IdentityDigestV1,
    capacity_model: IdentityDigestV1,
    falsifier: IdentityDigestV1,
    stop_rule: IdentityDigestV1,
    evidence_cut: IdentityDigestV1,
    policy: VersionedIdentityV1,
    rationale: SelectionRationaleV1,
    disposition: String,
    committed_at_epoch_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SelectionLocatorV1 {
    pub selection_request_identity: String,
    pub meaning_digest: String,
    pub selection_identity: String,
    pub receipt_identity: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SelectionCommitResultV1 {
    selection: ResearchSelectionDispositionV1,
    receipt: OwnerReceiptV1,
    outbox: OwnerOutboxV1,
    locator: SelectionLocatorV1,
}

impl SelectionCommitResultV1 {
    pub const fn selection(&self) -> &ResearchSelectionDispositionV1 {
        &self.selection
    }

    pub const fn locator(&self) -> &SelectionLocatorV1 {
        &self.locator
    }
}

#[derive(Debug, Error)]
pub enum ResearchDecisionError {
    #[error("R&D decision input is invalid: {0}")]
    InvalidInput(&'static str),
    #[error("R&D decision request identity was reused with changed meaning")]
    DecisionConflict,
    #[error("R&D selection request identity was reused with changed meaning")]
    SelectionConflict,
    #[error("R&D Owner custody unavailable: {0}")]
    Unavailable(String),
}

pub(crate) fn derive_decision(
    request: &DecisionCommitRequestV1,
    result: &SealedBacktestTerminalResultV1,
    committed_at_epoch_ms: u64,
) -> Result<Option<DecisionCommitResultV1>, ResearchDecisionError> {
    validate_decision_request(request)?;

    if result.namespace != ReplayNamespaceV2::Exploratory
        || result.terminal != ReplayTerminalV2::TerminalResult
        || result.locator != request.expected_result
        || result.bindings != request.expected_bindings
    {
        return Ok(None);
    }
    validate_diagnostics(result.terminal, &result.diagnostics)?;
    if result
        .diagnostics
        .iter()
        .any(|value| value.category == DiagnosticCategoryV2::UnresolvedFailure)
    {
        return Ok(None);
    }

    let outcome = if let Some(target) = repair_target(&result.diagnostics) {
        IterationOutcomeV1::RepairInputs {
            supported_diagnostics: result.diagnostics.clone(),
            selected_target: target,
        }
    } else if let Some(stop) = request.policy.applicable_hard_stop.as_ref() {
        IterationOutcomeV1::TerminalStop {
            reason: stop.reason,
            stop_evidence: stop.evidence.clone(),
            candidate_set_frontier: None,
        }
    } else if request.policy.ready_for_selection.is_some()
        && diagnosis_is_ready_for_selection(&request.diagnosis)
    {
        IterationOutcomeV1::ReadyForSelection
    } else if diagnosis_requires_terminal_stop(&request.diagnosis) {
        return Ok(None);
    } else {
        let Some(candidate_set) = request.policy.candidate_set.as_ref() else {
            return Ok(None);
        };

        match select_candidate(candidate_set)? {
            CandidateSelectionV1::Winner(winner) => IterationOutcomeV1::SuccessorExperiment {
                winner,
                candidate_set_frontier: candidate_set.frontier.clone(),
            },
            CandidateSelectionV1::AllBelowThreshold => IterationOutcomeV1::TerminalStop {
                reason: TerminalStopV1::LowInformationValue,
                stop_evidence: candidate_set.threshold.clone(),
                candidate_set_frontier: Some(candidate_set.frontier.clone()),
            },
            CandidateSelectionV1::NoDecision => return Ok(None),
        }
    };

    let meaning_digest = owner_digest(
        "rd.research-iteration-decision.meaning.v1",
        &(request, result.canonical_bytes()?, &outcome),
    )?;
    let decision_identity = owner_identity("rd-research-iteration-decision-v1", &meaning_digest);
    let decision = ResearchIterationDecisionV1 {
        schema_version: 1,
        decision_identity,
        decision_request_identity: request.decision_request_identity.clone(),
        meaning_digest,
        result: result.locator.clone(),
        attempt_identity: result.attempt_identity.clone(),
        bindings: result.bindings.clone(),
        diagnostics: result.diagnostics.clone(),
        diagnosis: request.diagnosis.clone(),
        policy: request.policy.clone(),
        outcome,
        committed_at_epoch_ms,
    };
    Ok(Some(decision_result(decision)?))
}

pub(crate) fn derive_selection(
    request: &SelectionCommitRequestV1,
    decision: &DecisionCommitResultV1,
    committed_at_epoch_ms: u64,
) -> Result<SelectionCommitResultV1, ResearchDecisionError> {
    validate_selection_request(request)?;

    if !matches!(
        decision.decision.outcome,
        IterationOutcomeV1::ReadyForSelection
    ) || decision.locator != request.decision
        || decision.decision.result != request.result
        || decision.decision.bindings.trial_family != request.trial_family
        || decision.decision.bindings.trial_family_census_frontier != request.census_frontier
        || decision.decision.bindings.artifact != request.artifact
        || decision.decision.bindings.cost_model != request.cost_model
        || decision.decision.bindings.slippage_model != request.slippage_model
        || decision.decision.bindings.capacity_model != request.capacity_model
        || decision.decision.policy.falsifier != request.falsifier
        || decision.decision.policy.stop_rule != request.stop_rule
        || decision.decision.policy.evidence_cut != request.evidence_cut
        || decision.decision.policy.policy != request.policy
    {
        return Err(ResearchDecisionError::InvalidInput(
            "selection does not exactly bind one committed READY_FOR_SELECTION decision",
        ));
    }
    let meaning_digest = owner_digest(
        "rd.research-selection.meaning.v1",
        &(request, &decision.decision.decision_identity),
    )?;
    let selection_identity = owner_identity("rd-research-selection-v1", &meaning_digest);
    let selection = ResearchSelectionDispositionV1 {
        schema_version: 1,
        selection_identity,
        selection_request_identity: request.selection_request_identity.clone(),
        meaning_digest,
        decision_identity: decision.decision.decision_identity.clone(),
        result: request.result.clone(),
        trial_family: request.trial_family.clone(),
        census_frontier: request.census_frontier.clone(),
        artifact: request.artifact.clone(),
        cost_model: request.cost_model.clone(),
        slippage_model: request.slippage_model.clone(),
        capacity_model: request.capacity_model.clone(),
        falsifier: request.falsifier.clone(),
        stop_rule: request.stop_rule.clone(),
        evidence_cut: request.evidence_cut.clone(),
        policy: request.policy.clone(),
        rationale: request.rationale.clone(),
        disposition: "SELECTED_FOR_QUALIFICATION".to_string(),
        committed_at_epoch_ms,
    };
    selection_result(selection)
}

fn decision_result(
    decision: ResearchIterationDecisionV1,
) -> Result<DecisionCommitResultV1, ResearchDecisionError> {
    let receipt = receipt(
        &decision.decision_identity,
        &decision.meaning_digest,
        decision.committed_at_epoch_ms,
    )?;
    let outbox = outbox(
        &decision.decision_identity,
        DECISION_EVENT_V1,
        &decision,
        decision.committed_at_epoch_ms,
    )?;
    let locator = DecisionLocatorV1 {
        decision_request_identity: decision.decision_request_identity.clone(),
        meaning_digest: decision.meaning_digest.clone(),
        decision_identity: decision.decision_identity.clone(),
        receipt_identity: receipt.receipt_identity.clone(),
    };
    Ok(DecisionCommitResultV1 {
        decision,
        receipt,
        outbox,
        locator,
    })
}

fn selection_result(
    selection: ResearchSelectionDispositionV1,
) -> Result<SelectionCommitResultV1, ResearchDecisionError> {
    let receipt = receipt(
        &selection.selection_identity,
        &selection.meaning_digest,
        selection.committed_at_epoch_ms,
    )?;
    let outbox = outbox(
        &selection.selection_identity,
        SELECTION_EVENT_V1,
        &selection,
        selection.committed_at_epoch_ms,
    )?;
    let locator = SelectionLocatorV1 {
        selection_request_identity: selection.selection_request_identity.clone(),
        meaning_digest: selection.meaning_digest.clone(),
        selection_identity: selection.selection_identity.clone(),
        receipt_identity: receipt.receipt_identity.clone(),
    };
    Ok(SelectionCommitResultV1 {
        selection,
        receipt,
        outbox,
        locator,
    })
}

fn receipt(
    aggregate_identity: &str,
    meaning_digest: &str,
    committed_at_epoch_ms: u64,
) -> Result<OwnerReceiptV1, ResearchDecisionError> {
    let digest = owner_digest(
        "rd.owner-receipt.v1",
        &(aggregate_identity, meaning_digest, committed_at_epoch_ms),
    )?;
    Ok(OwnerReceiptV1 {
        schema_version: 1,
        receipt_identity: owner_identity("rd-owner-receipt-v1", &digest),
        aggregate_identity: aggregate_identity.to_string(),
        meaning_digest: meaning_digest.to_string(),
        committed_at_epoch_ms,
    })
}

fn outbox<T: Serialize>(
    aggregate_identity: &str,
    event_kind: &str,
    payload: &T,
    committed_at_epoch_ms: u64,
) -> Result<OwnerOutboxV1, ResearchDecisionError> {
    let payload_digest = owner_digest("rd.owner-outbox.payload.v1", payload)?;
    let event_digest = owner_digest(
        "rd.owner-outbox.event.v1",
        &(aggregate_identity, event_kind, &payload_digest),
    )?;
    Ok(OwnerOutboxV1 {
        schema_version: 1,
        event_identity: owner_identity("rd-owner-outbox-event-v1", &event_digest),
        aggregate_identity: aggregate_identity.to_string(),
        event_kind: event_kind.to_string(),
        payload_digest,
        committed_at_epoch_ms,
    })
}

enum CandidateSelectionV1 {
    Winner(Box<SuccessorCandidateV1>),
    AllBelowThreshold,
    NoDecision,
}

fn select_candidate(set: &CandidateSetV1) -> Result<CandidateSelectionV1, ResearchDecisionError> {
    validate_identity_digest(&set.generation_rule, "candidate generation rule")?;
    validate_identity_digest(&set.frontier, "candidate frontier")?;
    validate_identity_digest(&set.threshold, "candidate threshold")?;
    if set.expected_cardinality == 0
        || usize::try_from(set.expected_cardinality).ok() != Some(set.candidates.len())
    {
        return Ok(CandidateSelectionV1::NoDecision);
    }
    let mut identities = BTreeSet::new();
    let mut digests = BTreeSet::new();

    for candidate in &set.candidates {
        validate_identity_digest(&candidate.candidate, "successor candidate")?;
        validate_information_value(&candidate.information_value)?;
        validate_text(&candidate.tie_break_key, "tie_break_key")?;
        validate_experiment(&candidate.experiment)?;
        if !identities.insert(candidate.candidate.identity.clone())
            || !digests.insert(candidate.candidate.digest.clone())
            || candidate.admissibility == CandidateAdmissibilityV1::Unknown
        {
            return Ok(CandidateSelectionV1::NoDecision);
        }
    }
    let mut above: Vec<_> = set
        .candidates
        .iter()
        .filter(|candidate| {
            candidate.admissibility == CandidateAdmissibilityV1::AdmissibleAboveThreshold
        })
        .cloned()
        .collect();
    above.sort_by(|left, right| {
        (
            left.uncertainty_reduction_rank,
            &left.tie_break_key,
            &left.candidate.identity,
            &left.candidate.digest,
        )
            .cmp(&(
                right.uncertainty_reduction_rank,
                &right.tie_break_key,
                &right.candidate.identity,
                &right.candidate.digest,
            ))
    });

    if let Some(winner) = above.into_iter().next() {
        return Ok(CandidateSelectionV1::Winner(Box::new(winner)));
    }

    if set.candidates.iter().all(|candidate| {
        candidate.admissibility == CandidateAdmissibilityV1::AdmissibleBelowThreshold
    }) {
        return Ok(CandidateSelectionV1::AllBelowThreshold);
    }
    Ok(CandidateSelectionV1::NoDecision)
}

fn repair_target(diagnostics: &[DiagnosticEvidenceV1]) -> Option<RepairTargetV1> {
    [
        (DiagnosticCategoryV2::MarketData, RepairTargetV1::MarketData),
        (DiagnosticCategoryV2::Artifact, RepairTargetV1::Artifact),
        (
            DiagnosticCategoryV2::RuntimeKernel,
            RepairTargetV1::RuntimeKernel,
        ),
        (
            DiagnosticCategoryV2::BacktestOperational,
            RepairTargetV1::BacktestOperational,
        ),
        (DiagnosticCategoryV2::Simulator, RepairTargetV1::Simulator),
        (
            DiagnosticCategoryV2::ReplayConfiguration,
            RepairTargetV1::ReplayConfiguration,
        ),
    ]
    .into_iter()
    .find_map(|(category, target)| {
        diagnostics
            .iter()
            .any(|diagnostic| diagnostic.category == category)
            .then_some(target)
    })
}

fn validate_decision_request(
    request: &DecisionCommitRequestV1,
) -> Result<(), ResearchDecisionError> {
    validate_text(
        &request.decision_request_identity,
        "decision_request_identity",
    )?;
    validate_locator(&request.expected_result)?;
    validate_bindings(&request.expected_bindings)?;
    validate_replay_request_binding(&request.expected_result, &request.expected_bindings)?;
    for finding in [
        &request.diagnosis.evidence_integrity,
        &request.diagnosis.mechanism_validity,
        &request.diagnosis.economic_viability,
        &request.diagnosis.robustness,
        &request.diagnosis.failure_attribution,
        &request.diagnosis.information_value,
    ] {
        validate_identity_digest(&finding.evidence, "diagnosis evidence")?;
    }
    validate_version(&request.policy.policy, "decision policy")?;
    validate_identity_digest(&request.policy.evidence_cut, "decision evidence cut")?;
    validate_identity_digest(&request.policy.falsifier, "falsifier")?;
    validate_identity_digest(&request.policy.stop_rule, "stop rule")?;
    if let Some(stop) = request.policy.applicable_hard_stop.as_ref() {
        validate_identity_digest(&stop.evidence, "hard stop evidence")?;
        if stop.reason == TerminalStopV1::LowInformationValue {
            return Err(ResearchDecisionError::InvalidInput(
                "low-information stop must be derived from the candidate census",
            ));
        }

        if !hard_stop_matches_diagnosis(stop.reason, &request.diagnosis) {
            return Err(ResearchDecisionError::InvalidInput(
                "hard stop is inconsistent with the typed diagnosis",
            ));
        }
    }

    if let Some(readiness) = request.policy.ready_for_selection.as_ref() {
        validate_identity_digest(&readiness.exploratory_frontier, "exploratory frontier")?;
        validate_identity_digest(&readiness.consumed_family_budget, "consumed family budget")?;
        validate_identity_digest(
            &readiness.completeness_proof,
            "selection completeness proof",
        )?;
    }
    Ok(())
}

fn diagnosis_is_ready_for_selection(diagnosis: &DiagnosisV1) -> bool {
    diagnosis.evidence_integrity.disposition == DimensionDispositionV1::Supported
        && diagnosis.mechanism_validity.disposition == DimensionDispositionV1::Supported
        && diagnosis.economic_viability.disposition == DimensionDispositionV1::Supported
        && matches!(
            diagnosis.robustness.disposition,
            DimensionDispositionV1::Supported | DimensionDispositionV1::Robust
        )
        && matches!(
            diagnosis.failure_attribution.disposition,
            DimensionDispositionV1::Supported | DimensionDispositionV1::NoFinding
        )
        && diagnosis.information_value.disposition == DimensionDispositionV1::Supported
}

fn diagnosis_requires_terminal_stop(diagnosis: &DiagnosisV1) -> bool {
    [
        &diagnosis.evidence_integrity,
        &diagnosis.mechanism_validity,
        &diagnosis.economic_viability,
        &diagnosis.robustness,
        &diagnosis.failure_attribution,
        &diagnosis.information_value,
    ]
    .into_iter()
    .any(|finding| {
        matches!(
            finding.disposition,
            DimensionDispositionV1::Falsified
                | DimensionDispositionV1::EconomicallyImpossible
                | DimensionDispositionV1::InputUnavailable
        )
    })
}

fn highest_priority_diagnosis_stop(diagnosis: &DiagnosisV1) -> Option<TerminalStopV1> {
    if [
        &diagnosis.evidence_integrity,
        &diagnosis.mechanism_validity,
        &diagnosis.economic_viability,
        &diagnosis.robustness,
        &diagnosis.failure_attribution,
        &diagnosis.information_value,
    ]
    .into_iter()
    .any(|finding| finding.disposition == DimensionDispositionV1::InputUnavailable)
    {
        Some(TerminalStopV1::InputUnavailable)
    } else if diagnosis.mechanism_validity.disposition == DimensionDispositionV1::Falsified {
        Some(TerminalStopV1::FalsifierTriggered)
    } else if diagnosis.economic_viability.disposition
        == DimensionDispositionV1::EconomicallyImpossible
    {
        Some(TerminalStopV1::EconomicImpossibility)
    } else {
        None
    }
}

fn hard_stop_matches_diagnosis(reason: TerminalStopV1, diagnosis: &DiagnosisV1) -> bool {
    match highest_priority_diagnosis_stop(diagnosis) {
        Some(required) => reason == required,
        None => matches!(
            reason,
            TerminalStopV1::StopRuleTriggered | TerminalStopV1::BudgetExhausted
        ),
    }
}

fn validate_selection_request(
    request: &SelectionCommitRequestV1,
) -> Result<(), ResearchDecisionError> {
    validate_text(
        &request.selection_request_identity,
        "selection_request_identity",
    )?;
    validate_text(
        &request.decision.decision_request_identity,
        "decision_request_identity",
    )?;
    validate_digest(&request.decision.meaning_digest)?;
    validate_text(&request.decision.decision_identity, "decision_identity")?;
    validate_text(&request.decision.receipt_identity, "receipt_identity")?;
    validate_locator(&request.result)?;
    validate_identity_digest(&request.trial_family, "trial family")?;
    validate_identity_digest(&request.census_frontier, "census frontier")?;
    validate_identity_digest(&request.artifact, "artifact")?;
    validate_identity_digest(&request.cost_model, "cost model")?;
    validate_identity_digest(&request.slippage_model, "slippage model")?;
    validate_identity_digest(&request.capacity_model, "capacity model")?;
    validate_identity_digest(&request.falsifier, "falsifier")?;
    validate_identity_digest(&request.stop_rule, "stop rule")?;
    validate_identity_digest(&request.evidence_cut, "evidence cut")?;
    validate_version(&request.policy, "selection policy")
}

fn validate_information_value(
    value: &InformationValueEvidenceV1,
) -> Result<(), ResearchDecisionError> {
    for (binding, field) in [
        (&value.decision_uncertainty, "decision uncertainty"),
        (
            &value.distinguishing_observation_or_falsifier,
            "distinguishing observation or falsifier",
        ),
        (&value.result_to_action_map, "result-to-action map"),
        (&value.bounded_acquisition_cost, "bounded acquisition cost"),
        (
            &value.remaining_family_budget_effect,
            "remaining family budget effect",
        ),
        (&value.ordinal_rationale, "ordinal rationale"),
    ] {
        validate_identity_digest(binding, field)?;
    }

    if value.competing_alternatives.is_empty() {
        return Err(ResearchDecisionError::InvalidInput(
            "information-value competing alternatives are absent",
        ));
    }
    let mut identities = BTreeSet::new();
    let mut digests = BTreeSet::new();

    for alternative in &value.competing_alternatives {
        validate_identity_digest(alternative, "competing alternative")?;
        if !identities.insert(&alternative.identity) || !digests.insert(&alternative.digest) {
            return Err(ResearchDecisionError::InvalidInput(
                "information-value competing alternatives are duplicated",
            ));
        }
    }
    Ok(())
}

fn validate_diagnostics(
    terminal: ReplayTerminalV2,
    diagnostics: &[DiagnosticEvidenceV1],
) -> Result<(), ResearchDecisionError> {
    if terminal != ReplayTerminalV2::TerminalResult || diagnostics.is_empty() {
        return Err(ResearchDecisionError::InvalidInput(
            "terminal diagnostic census is absent or nonterminal",
        ));
    }
    let mut categories = BTreeSet::new();

    for diagnostic in diagnostics {
        validate_identity_digest(&diagnostic.evidence, "diagnostic evidence")?;
        if !categories.insert(diagnostic.category) {
            return Err(ResearchDecisionError::InvalidInput(
                "diagnostic category is duplicated",
            ));
        }
    }
    let unresolved = categories.contains(&DiagnosticCategoryV2::UnresolvedFailure);
    if unresolved && categories.len() != 1 {
        return Err(ResearchDecisionError::InvalidInput(
            "UNRESOLVED_FAILURE cannot be combined with another diagnostic",
        ));
    }
    let has_defect = categories
        .iter()
        .any(|category| category.is_execution_defect());
    let has_interpretable = categories.contains(&DiagnosticCategoryV2::NoExecutionDefect)
        || categories.contains(&DiagnosticCategoryV2::ValidEconomicFailure);
    if !unresolved && !has_defect && !has_interpretable {
        return Err(ResearchDecisionError::InvalidInput(
            "diagnostic census has no complete disposition",
        ));
    }
    Ok(())
}

fn validate_experiment(experiment: &ExperimentModeV1) -> Result<(), ResearchDecisionError> {
    if let ExperimentModeV1::PreregisteredFiniteJoint { contract } = experiment {
        let unique: BTreeSet<_> = contract.changed_dimensions.iter().collect();
        if contract.changed_dimensions.len() < 2
            || unique.len() != contract.changed_dimensions.len()
            || contract.bounded_combinations.is_empty()
        {
            return Err(ResearchDecisionError::InvalidInput(
                "finite joint experiment is not bounded and attributable",
            ));
        }

        for combination in &contract.bounded_combinations {
            validate_identity_digest(combination, "bounded combination")?;
        }
        validate_identity_digest(&contract.attribution_rule, "attribution rule")?;
        validate_identity_digest(&contract.budget, "experiment budget")?;
        validate_identity_digest(&contract.falsifier, "experiment falsifier")?;
        validate_identity_digest(&contract.stop_rule, "experiment stop rule")?;
    }
    Ok(())
}

fn validate_bindings(bindings: &ReplayEvidenceBindingsV1) -> Result<(), ResearchDecisionError> {
    for (value, field) in [
        (&bindings.intent, "intent"),
        (&bindings.trial_family, "trial family"),
        (
            &bindings.trial_family_census_frontier,
            "trial family census frontier",
        ),
        (&bindings.replay_authority, "replay authority"),
        (&bindings.strategy_design, "strategy design"),
        (&bindings.strategy_plan, "strategy plan"),
        (&bindings.artifact, "artifact"),
        (&bindings.resolved_owner_inputs, "resolved owner inputs"),
        (&bindings.replay_request, "replay request"),
        (&bindings.requested_pit_scope, "requested PIT scope"),
        (&bindings.pit_snapshot, "PIT snapshot"),
        (&bindings.universe_selection, "universe selection"),
        (&bindings.instrument_master_cut, "instrument master cut"),
        (&bindings.correction_rule, "correction rule"),
        (&bindings.market_semantics, "market semantics"),
        (&bindings.replay_configuration, "replay configuration"),
    ] {
        validate_identity_digest(value, field)?;
    }

    if bindings.instrument_master_facts.is_empty() {
        return Err(ResearchDecisionError::InvalidInput(
            "instrument master fact membership is absent",
        ));
    }
    let mut instrument_identities = BTreeSet::new();
    let mut instrument_digests = BTreeSet::new();

    for fact in &bindings.instrument_master_facts {
        validate_identity_digest(fact, "instrument master fact")?;
        if !instrument_identities.insert(&fact.identity) || !instrument_digests.insert(&fact.digest)
        {
            return Err(ResearchDecisionError::InvalidInput(
                "instrument master fact membership is duplicated",
            ));
        }
    }

    for (value, field) in [
        (&bindings.runtime_kernel, "runtime kernel"),
        (&bindings.simulator, "simulator"),
        (&bindings.cost_model, "cost model"),
        (&bindings.slippage_model, "slippage model"),
        (&bindings.capacity_model, "capacity model"),
        (
            &bindings.runner_operational_profile,
            "runner operational profile",
        ),
        (&bindings.diagnostic_policy, "diagnostic policy"),
        (&bindings.deterministic_seed, "deterministic seed"),
        (&bindings.replay_window, "replay window"),
        (&bindings.calendar, "calendar"),
        (&bindings.session, "session"),
        (&bindings.time_zone, "time zone"),
        (&bindings.corporate_action_cut, "corporate action cut"),
        (
            &bindings.historical_membership_cut,
            "historical membership cut",
        ),
        (&bindings.semantic_trace, "semantic trace"),
    ] {
        validate_identity_digest(value, field)?;
    }
    Ok(())
}

fn validate_replay_request_binding(
    locator: &BacktestResultLocatorV1,
    bindings: &ReplayEvidenceBindingsV1,
) -> Result<(), ResearchDecisionError> {
    if bindings.replay_request.identity != locator.request_identity
        || bindings.replay_request.digest != locator.request_meaning_digest
    {
        return Err(ResearchDecisionError::InvalidInput(
            "replay request binding does not equal the Backtest result request",
        ));
    }
    Ok(())
}

fn validate_locator(locator: &BacktestResultLocatorV1) -> Result<(), ResearchDecisionError> {
    validate_text(&locator.request_identity, "request_identity")?;
    validate_digest(&locator.request_meaning_digest)?;
    validate_text(&locator.result_identity, "result_identity")?;
    validate_digest(&locator.result_digest)
}

fn validate_identity_digest(
    value: &IdentityDigestV1,
    field: &'static str,
) -> Result<(), ResearchDecisionError> {
    validate_text(&value.identity, field)?;
    validate_digest(&value.digest)
}

fn validate_version(
    value: &VersionedIdentityV1,
    field: &'static str,
) -> Result<(), ResearchDecisionError> {
    validate_text(&value.identity, field)?;
    validate_text(&value.version, field)
}

fn validate_text(value: &str, field: &'static str) -> Result<(), ResearchDecisionError> {
    if value.is_empty() || value.len() > 512 || value.trim() != value {
        return Err(ResearchDecisionError::InvalidInput(field));
    }
    Ok(())
}

fn validate_digest(value: &str) -> Result<(), ResearchDecisionError> {
    let Some((algorithm, hex)) = value.split_once(':') else {
        return Err(ResearchDecisionError::InvalidInput("canonical digest"));
    };

    if !matches!(algorithm, "sha256" | "blake3")
        || hex.len() != 64
        || !hex
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(ResearchDecisionError::InvalidInput("canonical digest"));
    }
    Ok(())
}

fn owner_digest<T: Serialize>(domain: &str, value: &T) -> Result<String, ResearchDecisionError> {
    let bytes = serde_json::to_vec(value).map_err(encoding)?;
    let mut hasher = Sha256::new();
    hasher.update(domain.as_bytes());
    hasher.update([0]);
    hasher.update(bytes);
    Ok(format!("sha256:{:x}", hasher.finalize()))
}

fn owner_identity(prefix: &str, digest: &str) -> String {
    format!("{prefix}-{}", digest.trim_start_matches("sha256:"))
}

fn encoding(error: impl Display) -> ResearchDecisionError {
    ResearchDecisionError::Unavailable(format!("canonical encoding unavailable: {error}"))
}
