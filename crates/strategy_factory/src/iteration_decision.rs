//! R&D-owned gate from one locked exploratory Result to an Iteration Decision.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;
use vibe_backtest_owner_contracts::{
    DiagnosticCategoryV2, ObservationComponentV2, ReconciliationStatusV2, ReplayNamespaceV2,
    ReplayResultDtoV2, ReplayTerminalV2,
};

use crate::{
    LockedExploratoryReplayResultV2, ReplayPolicyCatalogBindingV3,
    product_edge::FrozenResearchGoalIntent,
    rd_owner_postgres_custody::{LockedExploratoryReplayResultV3, VerifiedResearchCustodyV1},
    trial_family::{
        TrialFamilyAttemptTerminalDispositionV2, TrialFamilyCensusReadbackV2, TrialFamilyError,
    },
};

const ITERATION_DECISION_POLICY_ID_V1: &str = "rd.iteration-decision-policy.v1";
const ITERATION_DECISION_POLICY_VERSION_V1: u64 = 1;
const ITERATION_DECISION_POLICY_DESCRIPTOR_V1: &[u8] = concat!(
    "dimensions=EVIDENCE_INTEGRITY,MECHANISM_VALIDITY,ECONOMIC_VIABILITY,ROBUSTNESS,",
    "FAILURE_ATTRIBUTION,INFORMATION_VALUE\n",
    "result_gate=UNKNOWN_OR_NONTERMINAL:NO_DECISION;UNRESOLVED_FAILURE:NO_DECISION;",
    "REJECTED_OR_INVALID_WITHOUT_REPAIR:NO_DECISION\n",
    "repair_precedence=MARKET_DATA,ARTIFACT,RUNTIME_KERNEL,BACKTEST_OPERATIONAL,SIMULATOR,",
    "REPLAY_CONFIGURATION\n",
    "outcomes=REPAIR_INPUTS,SUCCESSOR_EXPERIMENT,READY_FOR_SELECTION,TERMINAL_STOP\n",
    "terminal_stops=FALSIFIER_SATISFIED,FROZEN_STOP_RULE_SATISFIED,TRIAL_BUDGET_EXHAUSTED,",
    "ECONOMIC_IMPOSSIBILITY,LOW_INFORMATION_VALUE,INPUT_UNAVAILABLE\n",
    "decision_precedence=REPAIR_INPUTS,HARD_STOP,READY_FOR_SELECTION,LOW_INFORMATION_STOP,",
    "ONE_CHANGE_SUCCESSOR\n",
    "selection=READY_FOR_SELECTION_ONLY\n",
)
.as_bytes();

/// Immutable R&D decision semantics fixed into a TrialFamily before any Result exists.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct IterationDecisionPolicyBindingV1 {
    schema_version: u16,
    policy_identity: String,
    policy_version: u64,
    policy_digest: [u8; 32],
    diagnostic_policy_identity: String,
    diagnostic_policy_version: String,
    replay_catalog_record_id: String,
    replay_catalog_version: u64,
    replay_catalog_record_digest: [u8; 32],
    binding_digest: [u8; 32],
}

impl IterationDecisionPolicyBindingV1 {
    pub(crate) fn seal(catalog: &ReplayPolicyCatalogBindingV3) -> Result<Self, TrialFamilyError> {
        catalog
            .verify()
            .map_err(|error| TrialFamilyError::Unavailable(error.to_string()))?;
        let replay_policy = catalog
            .replay_policy_v2()
            .verify()
            .map_err(|error| TrialFamilyError::Unavailable(error.to_string()))?;
        let policy_digest: [u8; 32] =
            Sha256::digest(ITERATION_DECISION_POLICY_DESCRIPTOR_V1).into();
        let replay_catalog = catalog.replay_policy_v2();
        let mut binding = Self {
            schema_version: 1,
            policy_identity: ITERATION_DECISION_POLICY_ID_V1.to_string(),
            policy_version: ITERATION_DECISION_POLICY_VERSION_V1,
            policy_digest,
            diagnostic_policy_identity: replay_policy
                .diagnostic_policy
                .identity
                .as_str()
                .to_string(),
            diagnostic_policy_version: replay_policy.diagnostic_policy.version.as_str().to_string(),
            replay_catalog_record_id: replay_catalog.catalog_record_id().to_string(),
            replay_catalog_version: replay_catalog.catalog_version(),
            replay_catalog_record_digest: *replay_catalog.catalog_record_digest(),
            binding_digest: [0; 32],
        };
        binding.binding_digest = binding.expected_binding_digest()?;
        Ok(binding)
    }

    pub(crate) fn verify_against(
        &self,
        catalog: &ReplayPolicyCatalogBindingV3,
    ) -> Result<(), TrialFamilyError> {
        let expected = Self::seal(catalog)?;
        if self != &expected {
            return Err(TrialFamilyError::Unavailable(
                "TrialFamily decision-policy seal mismatch".to_string(),
            ));
        }
        Ok(())
    }

    fn expected_binding_digest(&self) -> Result<[u8; 32], TrialFamilyError> {
        let mut digest = Sha256::new();
        digest.update(b"rd.iteration-decision-policy-binding.v1\0");
        digest.update(self.schema_version.to_le_bytes());
        update_len_prefixed(&mut digest, self.policy_identity.as_bytes())?;
        digest.update(self.policy_version.to_le_bytes());
        digest.update(self.policy_digest);
        update_len_prefixed(&mut digest, self.diagnostic_policy_identity.as_bytes())?;
        update_len_prefixed(&mut digest, self.diagnostic_policy_version.as_bytes())?;
        update_len_prefixed(&mut digest, self.replay_catalog_record_id.as_bytes())?;
        digest.update(self.replay_catalog_version.to_le_bytes());
        digest.update(self.replay_catalog_record_digest);
        Ok(digest.finalize().into())
    }

    pub fn policy_identity(&self) -> &str {
        &self.policy_identity
    }

    pub const fn policy_version(&self) -> u64 {
        self.policy_version
    }

    pub const fn policy_digest(&self) -> [u8; 32] {
        self.policy_digest
    }

    pub const fn binding_digest(&self) -> [u8; 32] {
        self.binding_digest
    }
}

fn update_len_prefixed(digest: &mut Sha256, value: &[u8]) -> Result<(), TrialFamilyError> {
    let length = u64::try_from(value.len())
        .map_err(|error| TrialFamilyError::Unavailable(error.to_string()))?;
    digest.update(length.to_le_bytes());
    digest.update(value);
    Ok(())
}

/// The six R&D-owned diagnosis dimensions required before policy interpretation.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum IterationDiagnosisDimensionV1 {
    EvidenceIntegrity,
    MechanismValidity,
    EconomicViability,
    Robustness,
    FailureAttribution,
    InformationValue,
}

/// Forgeable vocabulary for the four mutually exclusive Iteration Decision outcomes.
///
/// This type is never accepted by the composition request and carries no R&D authority by itself.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(tag = "outcome", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum IterationDecisionOutcomeV1 {
    RepairInputs {
        category: IterationRepairCategoryV1,
        target: IterationRepairTargetV1,
    },
    SuccessorExperiment {
        experiment_identity: String,
        experiment_digest: String,
    },
    ReadyForSelection {
        candidate_identity: String,
        candidate_digest: String,
    },
    TerminalStop {
        reason: IterationTerminalStopReasonV1,
    },
}

/// Typed R&D repair categories in their frozen total-precedence order.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum IterationRepairCategoryV1 {
    MarketData,
    Artifact,
    RuntimeKernel,
    BacktestOperational,
    Simulator,
    ReplayConfiguration,
}

/// Native boundary that owns the repaired input.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum IterationRepairTargetV1 {
    MarketData,
    ResearchDevelop,
    Runtime,
    BacktestRunnerService,
    SimExchange,
    ResearchReplayConfiguration,
}

/// Named terminal stop vocabulary. A stop never creates Selection.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum IterationTerminalStopReasonV1 {
    FalsifierSatisfied,
    FrozenStopRuleSatisfied,
    TrialBudgetExhausted,
    EconomicImpossibility,
    LowInformationValue,
    InputUnavailable,
}

/// Returns whether a caller-safe Iteration Decision locator has the exact Owner wire shape.
#[must_use]
pub fn is_valid_iteration_decision_locator_v1(value: &str) -> bool {
    (4..=256).contains(&value.len())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b':' | b'.'))
}

/// Exact Owner facts that every eventual Decision and Selection must repeat.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct IterationDecisionEvidenceCutV1 {
    pub decision_policy_identity: String,
    pub decision_policy_version: u64,
    pub decision_policy_digest: [u8; 32],
    pub decision_policy_binding_digest: [u8; 32],
    pub trial_family_identity: String,
    pub census_frontier_identity: String,
    pub census_frontier_digest: String,
    pub attempt_frontier_identity: String,
    pub attempt_frontier_digest: String,
    pub candidate_set_frontier_identity: String,
    pub candidate_set_frontier_digest: String,
    pub request_identity: String,
    pub request_digest: String,
    pub result_identity: String,
    pub result_digest: String,
    pub attempt_identity: String,
}

/// R&D-owned immutable `REPAIR_INPUTS` Decision.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct RepairInputIterationDecisionV1 {
    schema_version: u16,
    decision_identity: String,
    decision_digest: String,
    evidence_cut: IterationDecisionEvidenceCutV1,
    outcome: IterationDecisionOutcomeV1,
    supported_defects: Vec<IterationRepairCategoryV1>,
}

/// Commit receipt for one immutable R&D Decision.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct IterationDecisionReceiptV1 {
    schema_version: u16,
    receipt_identity: String,
    decision_identity: String,
    decision_digest: String,
    result_identity: String,
    committed_at_epoch_ms: u64,
}

/// Move-only positive Decision custody returned by the PostgreSQL Owner.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct RepairInputIterationDecisionReadbackV1 {
    decision: RepairInputIterationDecisionV1,
    receipt: IterationDecisionReceiptV1,
}

/// R&D-owned immutable budget-exhausted terminal Decision.
///
/// The embedded interpretation is derived from locked Owner facts and is intentionally not
/// caller-constructible. Unresolved interpretation dimensions remain visible evidence; they do not
/// override the independently frozen TrialFamily budget hard stop.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct TrialBudgetTerminalStopDecisionV1 {
    schema_version: u16,
    decision_identity: String,
    decision_digest: String,
    evidence_cut: IterationDecisionEvidenceCutV1,
    outcome: IterationDecisionOutcomeV1,
    consumed_trial_budget: u32,
    trial_budget: u32,
    interpretation: IterationInterpretationContextV1,
}

/// Move-only positive custody for a budget-exhausted terminal Decision.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct TrialBudgetTerminalStopDecisionReadbackV1 {
    decision: TrialBudgetTerminalStopDecisionV1,
    receipt: IterationDecisionReceiptV1,
}

impl RepairInputIterationDecisionV1 {
    pub fn decision_identity(&self) -> &str {
        &self.decision_identity
    }

    pub fn decision_digest(&self) -> &str {
        &self.decision_digest
    }

    pub fn evidence_cut(&self) -> &IterationDecisionEvidenceCutV1 {
        &self.evidence_cut
    }

    pub fn outcome(&self) -> &IterationDecisionOutcomeV1 {
        &self.outcome
    }

    pub fn supported_defects(&self) -> &[IterationRepairCategoryV1] {
        &self.supported_defects
    }
}

impl IterationDecisionReceiptV1 {
    pub fn receipt_identity(&self) -> &str {
        &self.receipt_identity
    }

    pub fn decision_identity(&self) -> &str {
        &self.decision_identity
    }

    pub fn decision_digest(&self) -> &str {
        &self.decision_digest
    }

    pub fn result_identity(&self) -> &str {
        &self.result_identity
    }

    pub const fn committed_at_epoch_ms(&self) -> u64 {
        self.committed_at_epoch_ms
    }
}

impl RepairInputIterationDecisionReadbackV1 {
    pub fn decision(&self) -> &RepairInputIterationDecisionV1 {
        &self.decision
    }

    pub fn receipt(&self) -> &IterationDecisionReceiptV1 {
        &self.receipt
    }
}

impl TrialBudgetTerminalStopDecisionV1 {
    pub fn decision_identity(&self) -> &str {
        &self.decision_identity
    }

    pub fn decision_digest(&self) -> &str {
        &self.decision_digest
    }

    pub fn evidence_cut(&self) -> &IterationDecisionEvidenceCutV1 {
        &self.evidence_cut
    }

    pub fn outcome(&self) -> &IterationDecisionOutcomeV1 {
        &self.outcome
    }

    pub const fn consumed_trial_budget(&self) -> u32 {
        self.consumed_trial_budget
    }

    pub const fn trial_budget(&self) -> u32 {
        self.trial_budget
    }
}

impl TrialBudgetTerminalStopDecisionReadbackV1 {
    pub fn decision(&self) -> &TrialBudgetTerminalStopDecisionV1 {
        &self.decision
    }

    pub fn receipt(&self) -> &IterationDecisionReceiptV1 {
        &self.receipt
    }
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct StoredRepairInputIterationDecisionV1 {
    schema_version: u16,
    decision_identity: String,
    decision_digest: String,
    evidence_cut: IterationDecisionEvidenceCutV1,
    outcome: IterationDecisionOutcomeV1,
    supported_defects: Vec<IterationRepairCategoryV1>,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct StoredTrialBudgetTerminalStopDecisionV1 {
    schema_version: u16,
    decision_identity: String,
    decision_digest: String,
    evidence_cut: IterationDecisionEvidenceCutV1,
    outcome: IterationDecisionOutcomeV1,
    consumed_trial_budget: u32,
    trial_budget: u32,
    interpretation: IterationInterpretationContextV1,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct StoredIterationDecisionReceiptV1 {
    schema_version: u16,
    receipt_identity: String,
    decision_identity: String,
    decision_digest: String,
    result_identity: String,
    committed_at_epoch_ms: u64,
}

/// Result of the mandatory Backtest diagnosis gate.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "gate", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum IterationDecisionGateV1 {
    RepairInputs {
        evidence_cut: IterationDecisionEvidenceCutV1,
        supported_defects: Vec<IterationRepairCategoryV1>,
        selected_category: IterationRepairCategoryV1,
        target: IterationRepairTargetV1,
    },
    InterpretationRequired {
        evidence_cut: IterationDecisionEvidenceCutV1,
        diagnostic: IterationInterpretationDiagnosticV1,
        required_dimensions: Vec<IterationDiagnosisDimensionV1>,
    },
    NoDecision {
        reason: IterationNoDecisionReasonV1,
    },
}

/// One exact requested-to-consumed Replay binding admitted for R&D interpretation.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct IterationInterpretationOwnerBindingV1 {
    component: ObservationComponentV2,
    meaning_identity: String,
    meaning_digest: String,
    evidence_identity: String,
    evidence_digest: String,
}

/// Exact canonical aggregate bytes that established Backtest Owner custody for interpretation.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct IterationInterpretationResultCustodyV1 {
    result_storage_digest: String,
    receipt_storage_digest: String,
    outbox_storage_digest: String,
    semantic_trace_storage_digest: String,
}

/// Backtest-owned native outcome bytes admitted for R&D interpretation.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct IterationInterpretationOutcomeEvidenceV1 {
    evidence_identity: String,
    evidence_digest: String,
    frozen_research_intent: IterationDiagnosisEvidenceReferenceV1,
    trial_family_census_frontier: IterationDiagnosisEvidenceReferenceV1,
    canonical_result_schema_identity: String,
    canonical_result_binding_digest: String,
    canonical_result_bytes_length: u64,
    evidence_storage_digest: String,
    canonical_result_storage_digest: String,
    receipt_storage_digest: String,
    outbox_storage_digest: String,
}

/// Owner-sealed decisive diagnostic evidence carried by the locked Result aggregate.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct IterationInterpretationDiagnosticEvidenceV1 {
    component: ObservationComponentV2,
    evidence_identity: String,
    evidence_digest: String,
}

/// One exact canonical fact referenced by a derived diagnosis dimension.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct IterationDiagnosisEvidenceReferenceV1 {
    identity: String,
    digest: String,
}

/// Finite result of interpreting one required R&D diagnosis dimension.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub(crate) enum IterationDiagnosisDispositionV1 {
    EvidenceEstablished,
    NoExecutionDefect,
    ValidEconomicFailure,
    Unresolved,
}

/// One R&D-owned dimension derived from the exact frozen evidence cut.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct IterationDiagnosisFindingV1 {
    dimension: IterationDiagnosisDimensionV1,
    disposition: IterationDiagnosisDispositionV1,
    evidence: Vec<IterationDiagnosisEvidenceReferenceV1>,
}

/// Complete Owner-locked input boundary for the six R&D interpretation dimensions.
///
/// It is serialize-only and has no caller-facing constructor. The later Decision composer may
/// consume it only while retaining the transaction that produced `locked_result`.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct IterationInterpretationContextV1 {
    evidence_cut: IterationDecisionEvidenceCutV1,
    diagnostic: IterationInterpretationDiagnosticV1,
    required_dimensions: Vec<IterationDiagnosisDimensionV1>,
    result_custody: IterationInterpretationResultCustodyV1,
    outcome_evidence: IterationInterpretationOutcomeEvidenceV1,
    owner_bindings: Vec<IterationInterpretationOwnerBindingV1>,
    diagnostic_evidence: IterationInterpretationDiagnosticEvidenceV1,
    diagnosis_findings: Vec<IterationDiagnosisFindingV1>,
}

impl IterationInterpretationContextV1 {
    pub(crate) fn has_unresolved_diagnosis(&self) -> bool {
        self.diagnosis_findings
            .iter()
            .any(|finding| finding.disposition == IterationDiagnosisDispositionV1::Unresolved)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum IterationInterpretationDiagnosticV1 {
    NoExecutionDefect,
    ValidEconomicFailure,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum IterationNoDecisionReasonV1 {
    UnknownOrNonterminalResult,
    UnresolvedFailure,
    RejectedOrInvalidWithoutRepairDiagnosis,
}

#[derive(Debug, Error)]
pub enum IterationDecisionErrorV1 {
    #[error("R&D TrialFamily Census unavailable: {0}")]
    Census(#[from] TrialFamilyError),
    #[error("TrialFamily decision-policy seal is unavailable")]
    DecisionPolicyUnavailable,
    #[error("locked exploratory Result does not match the latest TrialFamily attempt")]
    ResultBindingMismatch,
    #[error("locked Result is not exploratory")]
    ProtectedResultForbidden,
    #[error("locked Result diagnostic census has no admissible R&D interpretation")]
    InvalidDiagnosticCensus,
    #[error("locked Result did not produce an interpretation-required gate")]
    InterpretationGateRequired,
    #[error("locked Result interpretation evidence is unavailable: {0}")]
    InterpretationEvidenceUnavailable(&'static str),
    #[error("stored R&D Iteration Decision is invalid: {0}")]
    InvalidStoredDecision(&'static str),
    #[error("R&D Iteration Decision encoding is unavailable: {0}")]
    Encoding(String),
}

pub(crate) fn issue_interpretation_context_v1(
    census: &TrialFamilyCensusReadbackV2,
    research_custody: &VerifiedResearchCustodyV1,
    locked_outcome: &LockedExploratoryReplayResultV3,
) -> Result<IterationInterpretationContextV1, IterationDecisionErrorV1> {
    let intent = research_custody.intent().ok_or(
        IterationDecisionErrorV1::InterpretationEvidenceUnavailable(
            "frozen Research Intent custody is missing",
        ),
    )?;
    let locked_result = locked_outcome.replay();
    let gate = gate_locked_exploratory_result_v1(census, locked_result)?;
    let semantic_trace_bytes = locked_result.semantic_trace_canonical_bytes().ok_or(
        IterationDecisionErrorV1::InterpretationEvidenceUnavailable(
            "canonical semantic trace is missing",
        ),
    )?;
    let result_custody = interpretation_result_custody_v1(
        locked_result.result_canonical_bytes(),
        locked_result.receipt_canonical_bytes(),
        locked_result.outbox_canonical_bytes(),
        semantic_trace_bytes,
    );
    let outcome_evidence = interpretation_outcome_evidence_v1(locked_outcome)?;
    issue_interpretation_context_from_result_v1(
        census,
        intent,
        gate,
        locked_result.result(),
        result_custody,
        outcome_evidence,
    )
}

fn issue_interpretation_context_from_result_v1(
    census: &TrialFamilyCensusReadbackV2,
    intent: &FrozenResearchGoalIntent,
    gate: IterationDecisionGateV1,
    result: &ReplayResultDtoV2,
    result_custody: IterationInterpretationResultCustodyV1,
    outcome_evidence: IterationInterpretationOutcomeEvidenceV1,
) -> Result<IterationInterpretationContextV1, IterationDecisionErrorV1> {
    let IterationDecisionGateV1::InterpretationRequired {
        evidence_cut,
        diagnostic,
        required_dimensions,
    } = gate
    else {
        return Err(IterationDecisionErrorV1::InterpretationGateRequired);
    };
    let canonical_dimensions = vec![
        IterationDiagnosisDimensionV1::EvidenceIntegrity,
        IterationDiagnosisDimensionV1::MechanismValidity,
        IterationDiagnosisDimensionV1::EconomicViability,
        IterationDiagnosisDimensionV1::Robustness,
        IterationDiagnosisDimensionV1::FailureAttribution,
        IterationDiagnosisDimensionV1::InformationValue,
    ];
    if required_dimensions != canonical_dimensions
        || result.namespace != ReplayNamespaceV2::Exploratory
        || result.terminal != ReplayTerminalV2::TerminalResult
        || result.request_identity.as_str() != evidence_cut.request_identity
        || result.request_meaning_digest.as_str() != evidence_cut.request_digest
        || result.result_identity.as_str() != evidence_cut.result_identity
        || result.result_digest.as_str() != evidence_cut.result_digest
        || result.attempt_identity.as_str() != evidence_cut.attempt_identity
    {
        return Err(IterationDecisionErrorV1::InterpretationEvidenceUnavailable(
            "gate and Result do not share one exact evidence cut",
        ));
    }
    let expected_diagnostic = match diagnostic {
        IterationInterpretationDiagnosticV1::NoExecutionDefect => {
            DiagnosticCategoryV2::NoExecutionDefect
        }
        IterationInterpretationDiagnosticV1::ValidEconomicFailure => {
            DiagnosticCategoryV2::ValidEconomicFailure
        }
    };
    let [diagnostic_fact] = result.diagnostic_census.as_slice() else {
        return Err(IterationDecisionErrorV1::InterpretationEvidenceUnavailable(
            "diagnostic census is not the exact singleton selected by the gate",
        ));
    };
    if diagnostic_fact.category != expected_diagnostic
        || diagnostic_fact.request_identity != result.request_identity
        || diagnostic_fact.request_meaning_digest != result.request_meaning_digest
        || diagnostic_fact.attempt_identity != result.attempt_identity
    {
        return Err(IterationDecisionErrorV1::InterpretationEvidenceUnavailable(
            "diagnostic evidence is cross-spliced",
        ));
    }

    if result.reconciliation.len() != ObservationComponentV2::REQUESTED_MEANING.len() {
        return Err(IterationDecisionErrorV1::InterpretationEvidenceUnavailable(
            "requested-to-consumed component census is incomplete",
        ));
    }
    let mut owner_bindings =
        Vec::with_capacity(ObservationComponentV2::REQUESTED_MEANING.len() + 1);
    for component in ObservationComponentV2::REQUESTED_MEANING {
        let mut matching = result
            .reconciliation
            .iter()
            .filter(|atom| atom.component == component);
        let atom =
            matching
                .next()
                .ok_or(IterationDecisionErrorV1::InterpretationEvidenceUnavailable(
                    "requested Replay component is missing",
                ))?;
        if matching.next().is_some()
            || atom.status != ReconciliationStatusV2::Exact
            || atom.observed_meaning_identity.as_ref() != Some(&atom.requested_meaning_identity)
            || atom.observed_meaning_digest.as_ref() != Some(&atom.requested_meaning_digest)
        {
            return Err(IterationDecisionErrorV1::InterpretationEvidenceUnavailable(
                "requested Replay component did not reconcile exactly once",
            ));
        }
        let locator = atom.observation_locator.as_ref().ok_or(
            IterationDecisionErrorV1::InterpretationEvidenceUnavailable(
                "requested Replay component evidence is missing",
            ),
        )?;
        if locator.component != component {
            return Err(IterationDecisionErrorV1::InterpretationEvidenceUnavailable(
                "requested Replay component evidence is cross-spliced",
            ));
        }
        owner_bindings.push(IterationInterpretationOwnerBindingV1 {
            component,
            meaning_identity: atom.requested_meaning_identity.as_str().to_string(),
            meaning_digest: atom.requested_meaning_digest.as_str().to_string(),
            evidence_identity: locator.reference.as_str().to_string(),
            evidence_digest: locator.digest.as_str().to_string(),
        });
    }

    let semantic_trace_observation = result.semantic_trace.as_ref().ok_or(
        IterationDecisionErrorV1::InterpretationEvidenceUnavailable("semantic trace is missing"),
    )?;
    if semantic_trace_observation.component != ObservationComponentV2::SemanticTrace
        || semantic_trace_observation.locator.component != ObservationComponentV2::SemanticTrace
        || semantic_trace_observation.request_identity != result.request_identity
        || semantic_trace_observation.request_meaning_digest != result.request_meaning_digest
        || semantic_trace_observation.attempt_identity != result.attempt_identity
    {
        return Err(IterationDecisionErrorV1::InterpretationEvidenceUnavailable(
            "semantic trace is cross-spliced",
        ));
    }
    owner_bindings.push(IterationInterpretationOwnerBindingV1 {
        component: ObservationComponentV2::SemanticTrace,
        meaning_identity: semantic_trace_observation
            .observed_meaning_identity
            .as_str()
            .to_string(),
        meaning_digest: semantic_trace_observation
            .observed_meaning_digest
            .as_str()
            .to_string(),
        evidence_identity: semantic_trace_observation
            .locator
            .reference
            .as_str()
            .to_string(),
        evidence_digest: semantic_trace_observation
            .locator
            .digest
            .as_str()
            .to_string(),
    });
    let diagnostic_locator = &diagnostic_fact.decisive_evidence;
    let diagnostic_evidence = IterationInterpretationDiagnosticEvidenceV1 {
        component: diagnostic_locator.component,
        evidence_identity: diagnostic_locator.reference.as_str().to_string(),
        evidence_digest: diagnostic_locator.digest.as_str().to_string(),
    };
    validate_outcome_evidence_cut_v1(intent, &owner_bindings, &outcome_evidence)?;
    let diagnosis_findings = derive_six_dimension_diagnosis_v1(
        census,
        intent,
        diagnostic,
        &evidence_cut,
        &owner_bindings,
        &diagnostic_evidence,
        &outcome_evidence,
    )?;
    Ok(IterationInterpretationContextV1 {
        evidence_cut,
        diagnostic,
        required_dimensions,
        result_custody,
        outcome_evidence,
        owner_bindings,
        diagnostic_evidence,
        diagnosis_findings,
    })
}

fn derive_six_dimension_diagnosis_v1(
    census: &TrialFamilyCensusReadbackV2,
    intent: &FrozenResearchGoalIntent,
    diagnostic: IterationInterpretationDiagnosticV1,
    evidence_cut: &IterationDecisionEvidenceCutV1,
    owner_bindings: &[IterationInterpretationOwnerBindingV1],
    diagnostic_evidence: &IterationInterpretationDiagnosticEvidenceV1,
    outcome_evidence: &IterationInterpretationOutcomeEvidenceV1,
) -> Result<Vec<IterationDiagnosisFindingV1>, IterationDecisionErrorV1> {
    let FrozenResearchGoalIntent::V2(intent) = intent else {
        return Err(IterationDecisionErrorV1::InterpretationEvidenceUnavailable(
            "frozen Research Intent V2 is missing",
        ));
    };
    let initial_intent = census.legacy_family.initial_intent_member();
    if intent.intent_identity != initial_intent.fact_identity()
        || intent.semantic_digest != initial_intent.fact_digest()
        || intent.trial_family_identity != evidence_cut.trial_family_identity
    {
        return Err(IterationDecisionErrorV1::InterpretationEvidenceUnavailable(
            "frozen Research Intent is cross-spliced",
        ));
    }
    let intent_reference = IterationDiagnosisEvidenceReferenceV1 {
        identity: intent.intent_identity.clone(),
        digest: intent.semantic_digest.clone(),
    };
    let census_reference = IterationDiagnosisEvidenceReferenceV1 {
        identity: evidence_cut.census_frontier_identity.clone(),
        digest: evidence_cut.census_frontier_digest.clone(),
    };
    let candidate_reference = IterationDiagnosisEvidenceReferenceV1 {
        identity: evidence_cut.candidate_set_frontier_identity.clone(),
        digest: evidence_cut.candidate_set_frontier_digest.clone(),
    };
    let result_reference = IterationDiagnosisEvidenceReferenceV1 {
        identity: evidence_cut.result_identity.clone(),
        digest: evidence_cut.result_digest.clone(),
    };
    let trace_reference =
        owner_binding_reference_v1(owner_bindings, ObservationComponentV2::SemanticTrace)?;
    let cost_reference =
        owner_binding_reference_v1(owner_bindings, ObservationComponentV2::CostModel)?;
    let slippage_reference =
        owner_binding_reference_v1(owner_bindings, ObservationComponentV2::SlippageModel)?;
    let capacity_reference =
        owner_binding_reference_v1(owner_bindings, ObservationComponentV2::CapacityModel)?;
    let failure_reference = IterationDiagnosisEvidenceReferenceV1 {
        identity: diagnostic_evidence.evidence_identity.clone(),
        digest: diagnostic_evidence.evidence_digest.clone(),
    };
    let outcome_reference = IterationDiagnosisEvidenceReferenceV1 {
        identity: outcome_evidence.evidence_identity.clone(),
        digest: outcome_evidence.evidence_digest.clone(),
    };
    let failure_disposition = match diagnostic {
        IterationInterpretationDiagnosticV1::NoExecutionDefect => {
            IterationDiagnosisDispositionV1::NoExecutionDefect
        }
        IterationInterpretationDiagnosticV1::ValidEconomicFailure => {
            IterationDiagnosisDispositionV1::ValidEconomicFailure
        }
    };
    Ok(vec![
        diagnosis_finding_v1(
            IterationDiagnosisDimensionV1::EvidenceIntegrity,
            IterationDiagnosisDispositionV1::EvidenceEstablished,
            vec![
                result_reference,
                census_reference.clone(),
                trace_reference.clone(),
                outcome_reference.clone(),
            ],
        ),
        diagnosis_finding_v1(
            IterationDiagnosisDimensionV1::MechanismValidity,
            IterationDiagnosisDispositionV1::Unresolved,
            vec![
                intent_reference.clone(),
                trace_reference.clone(),
                outcome_reference.clone(),
            ],
        ),
        diagnosis_finding_v1(
            IterationDiagnosisDimensionV1::EconomicViability,
            IterationDiagnosisDispositionV1::Unresolved,
            vec![
                intent_reference,
                cost_reference,
                slippage_reference,
                capacity_reference,
                trace_reference.clone(),
                outcome_reference.clone(),
            ],
        ),
        diagnosis_finding_v1(
            IterationDiagnosisDimensionV1::Robustness,
            IterationDiagnosisDispositionV1::Unresolved,
            vec![
                census_reference.clone(),
                trace_reference,
                outcome_reference.clone(),
            ],
        ),
        diagnosis_finding_v1(
            IterationDiagnosisDimensionV1::FailureAttribution,
            failure_disposition,
            vec![failure_reference, outcome_reference.clone()],
        ),
        diagnosis_finding_v1(
            IterationDiagnosisDimensionV1::InformationValue,
            IterationDiagnosisDispositionV1::Unresolved,
            vec![candidate_reference, census_reference, outcome_reference],
        ),
    ])
}

fn validate_outcome_evidence_cut_v1(
    intent: &FrozenResearchGoalIntent,
    owner_bindings: &[IterationInterpretationOwnerBindingV1],
    outcome: &IterationInterpretationOutcomeEvidenceV1,
) -> Result<(), IterationDecisionErrorV1> {
    let FrozenResearchGoalIntent::V2(intent) = intent else {
        return Err(IterationDecisionErrorV1::InterpretationEvidenceUnavailable(
            "frozen Research Intent V2 is missing",
        ));
    };
    let intent_binding =
        owner_binding_reference_v1(owner_bindings, ObservationComponentV2::FrozenResearchIntent)?;
    let census_binding = owner_binding_reference_v1(
        owner_bindings,
        ObservationComponentV2::TrialFamilyCensusFrontier,
    )?;
    if outcome.frozen_research_intent.identity != intent.intent_identity
        || outcome.frozen_research_intent.digest != intent.semantic_digest
        || outcome.frozen_research_intent != intent_binding
        || outcome.trial_family_census_frontier != census_binding
        || outcome.canonical_result_schema_identity != "vibe-backtest-result/v1"
        || outcome.canonical_result_bytes_length == 0
    {
        return Err(IterationDecisionErrorV1::InterpretationEvidenceUnavailable(
            "Backtest outcome evidence does not share the R&D interpretation cut",
        ));
    }
    Ok(())
}

fn interpretation_outcome_evidence_v1(
    locked: &LockedExploratoryReplayResultV3,
) -> Result<IterationInterpretationOutcomeEvidenceV1, IterationDecisionErrorV1> {
    vibe_backtest::result::CanonicalBacktestResult::from_slice(
        locked.engine_canonical_result_bytes(),
    )
    .map_err(|_| {
        IterationDecisionErrorV1::InterpretationEvidenceUnavailable(
            "canonical Backtest result bytes are invalid",
        )
    })?;
    let evidence = locked.outcome_evidence();
    Ok(IterationInterpretationOutcomeEvidenceV1 {
        evidence_identity: evidence.evidence_identity.as_str().to_string(),
        evidence_digest: evidence.evidence_digest.as_str().to_string(),
        frozen_research_intent: IterationDiagnosisEvidenceReferenceV1 {
            identity: evidence
                .frozen_research_intent
                .identity
                .as_str()
                .to_string(),
            digest: evidence.frozen_research_intent.digest.as_str().to_string(),
        },
        trial_family_census_frontier: IterationDiagnosisEvidenceReferenceV1 {
            identity: evidence
                .trial_family_census_frontier
                .identity
                .as_str()
                .to_string(),
            digest: evidence
                .trial_family_census_frontier
                .digest
                .as_str()
                .to_string(),
        },
        canonical_result_schema_identity: evidence
            .canonical_result
            .schema_identity
            .as_str()
            .to_string(),
        canonical_result_binding_digest: evidence
            .canonical_result
            .canonical_bytes_digest
            .as_str()
            .to_string(),
        canonical_result_bytes_length: evidence.canonical_result.canonical_bytes_length,
        evidence_storage_digest: interpretation_storage_digest_v1(
            "vibe.rd.iteration-interpretation.outcome-evidence-storage.v1",
            locked.outcome_evidence_canonical_bytes(),
        ),
        canonical_result_storage_digest: interpretation_storage_digest_v1(
            "vibe.rd.iteration-interpretation.canonical-result-storage.v1",
            locked.engine_canonical_result_bytes(),
        ),
        receipt_storage_digest: interpretation_storage_digest_v1(
            "vibe.rd.iteration-interpretation.outcome-evidence-receipt-storage.v1",
            locked.outcome_evidence_receipt_canonical_bytes(),
        ),
        outbox_storage_digest: interpretation_storage_digest_v1(
            "vibe.rd.iteration-interpretation.outcome-evidence-outbox-storage.v1",
            locked.outcome_evidence_outbox_canonical_bytes(),
        ),
    })
}

fn owner_binding_reference_v1(
    owner_bindings: &[IterationInterpretationOwnerBindingV1],
    component: ObservationComponentV2,
) -> Result<IterationDiagnosisEvidenceReferenceV1, IterationDecisionErrorV1> {
    let binding = owner_bindings
        .iter()
        .find(|binding| binding.component == component)
        .ok_or(IterationDecisionErrorV1::InterpretationEvidenceUnavailable(
            "required diagnosis Owner binding is missing",
        ))?;
    Ok(IterationDiagnosisEvidenceReferenceV1 {
        identity: binding.meaning_identity.clone(),
        digest: binding.meaning_digest.clone(),
    })
}

fn diagnosis_finding_v1(
    dimension: IterationDiagnosisDimensionV1,
    disposition: IterationDiagnosisDispositionV1,
    evidence: Vec<IterationDiagnosisEvidenceReferenceV1>,
) -> IterationDiagnosisFindingV1 {
    IterationDiagnosisFindingV1 {
        dimension,
        disposition,
        evidence,
    }
}

fn interpretation_result_custody_v1(
    result_bytes: &[u8],
    receipt_bytes: &[u8],
    outbox_bytes: &[u8],
    semantic_trace_bytes: &[u8],
) -> IterationInterpretationResultCustodyV1 {
    IterationInterpretationResultCustodyV1 {
        result_storage_digest: interpretation_storage_digest_v1(
            "vibe.rd.iteration-interpretation.result-storage.v1",
            result_bytes,
        ),
        receipt_storage_digest: interpretation_storage_digest_v1(
            "vibe.rd.iteration-interpretation.result-receipt-storage.v1",
            receipt_bytes,
        ),
        outbox_storage_digest: interpretation_storage_digest_v1(
            "vibe.rd.iteration-interpretation.result-outbox-storage.v1",
            outbox_bytes,
        ),
        semantic_trace_storage_digest: interpretation_storage_digest_v1(
            "vibe.rd.iteration-interpretation.semantic-trace-storage.v1",
            semantic_trace_bytes,
        ),
    }
}

fn interpretation_storage_digest_v1(domain: &str, bytes: &[u8]) -> String {
    let mut digest = Sha256::new();
    digest.update(domain.as_bytes());
    digest.update([0]);
    digest.update(bytes.len().to_string().as_bytes());
    digest.update([0]);
    digest.update(bytes);
    format!("sha256:{:x}", digest.finalize())
}

pub(crate) fn issue_repair_input_decision_v1(
    evidence_cut: IterationDecisionEvidenceCutV1,
    supported_defects: Vec<IterationRepairCategoryV1>,
    selected_category: IterationRepairCategoryV1,
    target: IterationRepairTargetV1,
    committed_at_epoch_ms: u64,
) -> Result<RepairInputIterationDecisionReadbackV1, IterationDecisionErrorV1> {
    if supported_defects.first().copied() != Some(selected_category)
        || repair_target(selected_category) != target
    {
        return Err(IterationDecisionErrorV1::InvalidStoredDecision(
            "repair precedence mismatch",
        ));
    }
    let expected_supported = repair_categories(
        &supported_defects
            .iter()
            .copied()
            .map(repair_diagnostic_category)
            .collect::<Vec<_>>(),
    );
    if supported_defects.is_empty() || supported_defects != expected_supported {
        return Err(IterationDecisionErrorV1::InvalidStoredDecision(
            "repair category set mismatch",
        ));
    }
    let outcome = IterationDecisionOutcomeV1::RepairInputs {
        category: selected_category,
        target,
    };
    let decision_digest = canonical_digest(
        "rd.iteration-decision.repair-inputs.v1",
        &RepairDecisionMeaningV1 {
            schema_version: 1,
            evidence_cut: &evidence_cut,
            outcome: &outcome,
            supported_defects: &supported_defects,
        },
    )?;
    let decision_identity = format!(
        "rd-iteration-decision-v1-{}",
        decision_digest.trim_start_matches("sha256:")
    );
    let decision = RepairInputIterationDecisionV1 {
        schema_version: 1,
        decision_identity: decision_identity.clone(),
        decision_digest: decision_digest.clone(),
        evidence_cut,
        outcome,
        supported_defects,
    };
    let receipt_digest = canonical_digest(
        "rd.iteration-decision-receipt.v1",
        &DecisionReceiptMeaningV1 {
            schema_version: 1,
            decision_identity: &decision_identity,
            decision_digest: &decision_digest,
            result_identity: &decision.evidence_cut.result_identity,
            committed_at_epoch_ms,
        },
    )?;
    let receipt = IterationDecisionReceiptV1 {
        schema_version: 1,
        receipt_identity: format!(
            "rd-iteration-decision-receipt-v1-{}",
            receipt_digest.trim_start_matches("sha256:")
        ),
        decision_identity,
        decision_digest,
        result_identity: decision.evidence_cut.result_identity.clone(),
        committed_at_epoch_ms,
    };
    Ok(RepairInputIterationDecisionReadbackV1 { decision, receipt })
}

pub(crate) fn admit_stored_repair_input_decision_v1(
    decision_bytes: &[u8],
    receipt_bytes: &[u8],
) -> Result<RepairInputIterationDecisionReadbackV1, IterationDecisionErrorV1> {
    let stored_decision: StoredRepairInputIterationDecisionV1 =
        serde_json::from_slice(decision_bytes)
            .map_err(|error| IterationDecisionErrorV1::Encoding(error.to_string()))?;
    let stored_receipt: StoredIterationDecisionReceiptV1 = serde_json::from_slice(receipt_bytes)
        .map_err(|error| IterationDecisionErrorV1::Encoding(error.to_string()))?;
    let IterationDecisionOutcomeV1::RepairInputs { category, target } = stored_decision.outcome
    else {
        return Err(IterationDecisionErrorV1::InvalidStoredDecision(
            "stored outcome is not REPAIR_INPUTS",
        ));
    };
    let expected = issue_repair_input_decision_v1(
        stored_decision.evidence_cut,
        stored_decision.supported_defects,
        category,
        target,
        stored_receipt.committed_at_epoch_ms,
    )?;
    let canonical_decision = serde_json::to_vec(expected.decision())
        .map_err(|error| IterationDecisionErrorV1::Encoding(error.to_string()))?;
    let canonical_receipt = serde_json::to_vec(expected.receipt())
        .map_err(|error| IterationDecisionErrorV1::Encoding(error.to_string()))?;
    if canonical_decision != decision_bytes || canonical_receipt != receipt_bytes {
        return Err(IterationDecisionErrorV1::InvalidStoredDecision(
            "stored canonical bytes or digest mismatch",
        ));
    }
    Ok(expected)
}

pub(crate) fn issue_trial_budget_terminal_stop_decision_v1(
    census: &TrialFamilyCensusReadbackV2,
    interpretation: IterationInterpretationContextV1,
    committed_at_epoch_ms: u64,
) -> Result<TrialBudgetTerminalStopDecisionReadbackV1, IterationDecisionErrorV1> {
    let policy = census.legacy_family.root().policy();
    let consumed_trial_budget = census.consumed_trial_budget();
    if consumed_trial_budget != policy.trial_budget {
        return Err(IterationDecisionErrorV1::InvalidStoredDecision(
            "TrialFamily budget is not exhausted",
        ));
    }
    validate_interpretation_cut_against_census_v1(census, &interpretation)?;
    issue_trial_budget_terminal_stop_from_parts_v1(
        interpretation,
        consumed_trial_budget,
        policy.trial_budget,
        committed_at_epoch_ms,
    )
}

pub(crate) fn admit_stored_trial_budget_terminal_stop_decision_v1(
    decision_bytes: &[u8],
    receipt_bytes: &[u8],
) -> Result<TrialBudgetTerminalStopDecisionReadbackV1, IterationDecisionErrorV1> {
    let stored_decision: StoredTrialBudgetTerminalStopDecisionV1 =
        serde_json::from_slice(decision_bytes)
            .map_err(|error| IterationDecisionErrorV1::Encoding(error.to_string()))?;
    let stored_receipt: StoredIterationDecisionReceiptV1 = serde_json::from_slice(receipt_bytes)
        .map_err(|error| IterationDecisionErrorV1::Encoding(error.to_string()))?;
    let expected = issue_trial_budget_terminal_stop_from_parts_v1(
        stored_decision.interpretation,
        stored_decision.consumed_trial_budget,
        stored_decision.trial_budget,
        stored_receipt.committed_at_epoch_ms,
    )?;
    let canonical_decision = serde_json::to_vec(expected.decision())
        .map_err(|error| IterationDecisionErrorV1::Encoding(error.to_string()))?;
    let canonical_receipt = serde_json::to_vec(expected.receipt())
        .map_err(|error| IterationDecisionErrorV1::Encoding(error.to_string()))?;
    if canonical_decision != decision_bytes || canonical_receipt != receipt_bytes {
        return Err(IterationDecisionErrorV1::InvalidStoredDecision(
            "stored canonical bytes or digest mismatch",
        ));
    }
    Ok(expected)
}

fn issue_trial_budget_terminal_stop_from_parts_v1(
    interpretation: IterationInterpretationContextV1,
    consumed_trial_budget: u32,
    trial_budget: u32,
    committed_at_epoch_ms: u64,
) -> Result<TrialBudgetTerminalStopDecisionReadbackV1, IterationDecisionErrorV1> {
    if trial_budget == 0 || consumed_trial_budget != trial_budget {
        return Err(IterationDecisionErrorV1::InvalidStoredDecision(
            "TrialFamily budget is not exhausted",
        ));
    }
    validate_complete_interpretation_v1(&interpretation)?;
    let evidence_cut = interpretation.evidence_cut.clone();
    let outcome = IterationDecisionOutcomeV1::TerminalStop {
        reason: IterationTerminalStopReasonV1::TrialBudgetExhausted,
    };
    let decision_digest = canonical_digest(
        "rd.iteration-decision.trial-budget-terminal-stop.v1",
        &TrialBudgetTerminalStopDecisionMeaningV1 {
            schema_version: 1,
            evidence_cut: &evidence_cut,
            outcome: &outcome,
            consumed_trial_budget,
            trial_budget,
            interpretation: &interpretation,
        },
    )?;
    let decision_identity = format!(
        "rd-iteration-decision-v1-{}",
        decision_digest.trim_start_matches("sha256:")
    );
    let decision = TrialBudgetTerminalStopDecisionV1 {
        schema_version: 1,
        decision_identity: decision_identity.clone(),
        decision_digest: decision_digest.clone(),
        evidence_cut,
        outcome,
        consumed_trial_budget,
        trial_budget,
        interpretation,
    };
    let receipt_digest = canonical_digest(
        "rd.iteration-decision-receipt.v1",
        &DecisionReceiptMeaningV1 {
            schema_version: 1,
            decision_identity: &decision_identity,
            decision_digest: &decision_digest,
            result_identity: &decision.evidence_cut.result_identity,
            committed_at_epoch_ms,
        },
    )?;
    let receipt = IterationDecisionReceiptV1 {
        schema_version: 1,
        receipt_identity: format!(
            "rd-iteration-decision-receipt-v1-{}",
            receipt_digest.trim_start_matches("sha256:")
        ),
        decision_identity,
        decision_digest,
        result_identity: decision.evidence_cut.result_identity.clone(),
        committed_at_epoch_ms,
    };
    Ok(TrialBudgetTerminalStopDecisionReadbackV1 { decision, receipt })
}

fn validate_complete_interpretation_v1(
    interpretation: &IterationInterpretationContextV1,
) -> Result<(), IterationDecisionErrorV1> {
    let dimensions = [
        IterationDiagnosisDimensionV1::EvidenceIntegrity,
        IterationDiagnosisDimensionV1::MechanismValidity,
        IterationDiagnosisDimensionV1::EconomicViability,
        IterationDiagnosisDimensionV1::Robustness,
        IterationDiagnosisDimensionV1::FailureAttribution,
        IterationDiagnosisDimensionV1::InformationValue,
    ];
    if interpretation.required_dimensions.as_slice() != dimensions
        || interpretation.diagnosis_findings.len() != dimensions.len()
        || interpretation
            .diagnosis_findings
            .iter()
            .zip(dimensions.iter())
            .any(|(finding, dimension)| {
                &finding.dimension != dimension || finding.evidence.is_empty()
            })
    {
        return Err(IterationDecisionErrorV1::InvalidStoredDecision(
            "complete six-dimension interpretation is missing",
        ));
    }
    Ok(())
}

fn validate_interpretation_cut_against_census_v1(
    census: &TrialFamilyCensusReadbackV2,
    interpretation: &IterationInterpretationContextV1,
) -> Result<(), IterationDecisionErrorV1> {
    let evidence = &interpretation.evidence_cut;
    if evidence.trial_family_identity != census.census_frontier.trial_family_identity()
        || evidence.census_frontier_identity != census.census_frontier.frontier_identity()
        || evidence.census_frontier_digest != census.census_frontier.frontier_digest()
        || evidence.attempt_frontier_identity != census.attempt_frontier.frontier_identity()
        || evidence.attempt_frontier_digest != census.attempt_frontier.frontier_digest()
        || evidence.candidate_set_frontier_identity
            != census.candidate_set_frontier.frontier_identity()
        || evidence.candidate_set_frontier_digest != census.candidate_set_frontier.frontier_digest()
    {
        return Err(IterationDecisionErrorV1::ResultBindingMismatch);
    }
    let decision_policy = census
        .decision_policy_v1()
        .ok_or(IterationDecisionErrorV1::DecisionPolicyUnavailable)?;
    if evidence.decision_policy_identity != decision_policy.policy_identity()
        || evidence.decision_policy_version != decision_policy.policy_version()
        || evidence.decision_policy_digest != decision_policy.policy_digest()
        || evidence.decision_policy_binding_digest != decision_policy.binding_digest()
    {
        return Err(IterationDecisionErrorV1::ResultBindingMismatch);
    }
    Ok(())
}

#[derive(Serialize)]
struct RepairDecisionMeaningV1<'a> {
    schema_version: u16,
    evidence_cut: &'a IterationDecisionEvidenceCutV1,
    outcome: &'a IterationDecisionOutcomeV1,
    supported_defects: &'a [IterationRepairCategoryV1],
}

#[derive(Serialize)]
struct TrialBudgetTerminalStopDecisionMeaningV1<'a> {
    schema_version: u16,
    evidence_cut: &'a IterationDecisionEvidenceCutV1,
    outcome: &'a IterationDecisionOutcomeV1,
    consumed_trial_budget: u32,
    trial_budget: u32,
    interpretation: &'a IterationInterpretationContextV1,
}

#[derive(Serialize)]
struct DecisionReceiptMeaningV1<'a> {
    schema_version: u16,
    decision_identity: &'a str,
    decision_digest: &'a str,
    result_identity: &'a str,
    committed_at_epoch_ms: u64,
}

fn canonical_digest(
    domain: &str,
    value: &impl Serialize,
) -> Result<String, IterationDecisionErrorV1> {
    #[derive(Serialize)]
    struct Envelope<'a, T> {
        domain: &'a str,
        value: &'a T,
    }
    serde_json::to_vec(&Envelope { domain, value })
        .map(|bytes| format!("sha256:{:x}", Sha256::digest(bytes)))
        .map_err(|error| IterationDecisionErrorV1::Encoding(error.to_string()))
}

/// Applies R&D's mandatory diagnosis precedence to one Owner-locked exploratory Result.
///
/// This function does not commit a Decision. `InterpretationRequired` still needs the frozen
/// falsifier, stop, candidate comparison, and decision-policy cut. `NoDecision` must remain
/// census-only.
pub fn gate_locked_exploratory_result_v1(
    census: &TrialFamilyCensusReadbackV2,
    locked_result: &LockedExploratoryReplayResultV2,
) -> Result<IterationDecisionGateV1, IterationDecisionErrorV1> {
    let decision_policy = census
        .decision_policy_v1()
        .ok_or(IterationDecisionErrorV1::DecisionPolicyUnavailable)?;
    let catalog = census
        .replay_policy_catalog_v3()
        .ok_or(IterationDecisionErrorV1::DecisionPolicyUnavailable)?;
    decision_policy.verify_against(catalog)?;
    gate_result(census, locked_result.result(), decision_policy)
}

fn gate_result(
    census: &TrialFamilyCensusReadbackV2,
    result: &ReplayResultDtoV2,
    decision_policy: &IterationDecisionPolicyBindingV1,
) -> Result<IterationDecisionGateV1, IterationDecisionErrorV1> {
    if result.namespace != ReplayNamespaceV2::Exploratory {
        return Err(IterationDecisionErrorV1::ProtectedResultForbidden);
    }
    let latest = census.latest_attempt_binding()?;
    let expected_terminal = match latest.terminal_disposition {
        TrialFamilyAttemptTerminalDispositionV2::TerminalResult => ReplayTerminalV2::TerminalResult,
        TrialFamilyAttemptTerminalDispositionV2::Rejected => ReplayTerminalV2::RunRejected,
        TrialFamilyAttemptTerminalDispositionV2::Invalid => ReplayTerminalV2::InvalidReplayEvidence,
        TrialFamilyAttemptTerminalDispositionV2::Unknown => ReplayTerminalV2::InProgressOrUnknown,
    };
    if latest.request_identity != result.request_identity.as_str()
        || latest.request_digest != result.request_meaning_digest.as_str()
        || latest.result_identity != result.result_identity.as_str()
        || latest.result_digest != result.result_digest.as_str()
        || expected_terminal != result.terminal
    {
        return Err(IterationDecisionErrorV1::ResultBindingMismatch);
    }
    if result.terminal == ReplayTerminalV2::InProgressOrUnknown {
        return Ok(IterationDecisionGateV1::NoDecision {
            reason: IterationNoDecisionReasonV1::UnknownOrNonterminalResult,
        });
    }
    let categories = result
        .diagnostic_census
        .iter()
        .map(|diagnostic| diagnostic.category)
        .collect::<Vec<_>>();
    if categories.contains(&DiagnosticCategoryV2::UnresolvedFailure) {
        return Ok(IterationDecisionGateV1::NoDecision {
            reason: IterationNoDecisionReasonV1::UnresolvedFailure,
        });
    }
    let evidence_cut = evidence_cut(census, result, &latest, decision_policy);
    let supported_defects = repair_categories(&categories);
    if let Some(selected_category) = supported_defects.first().copied() {
        return Ok(IterationDecisionGateV1::RepairInputs {
            evidence_cut,
            supported_defects,
            selected_category,
            target: repair_target(selected_category),
        });
    }
    if result.terminal != ReplayTerminalV2::TerminalResult {
        return Ok(IterationDecisionGateV1::NoDecision {
            reason: IterationNoDecisionReasonV1::RejectedOrInvalidWithoutRepairDiagnosis,
        });
    }
    let diagnostic = if categories == [DiagnosticCategoryV2::NoExecutionDefect] {
        IterationInterpretationDiagnosticV1::NoExecutionDefect
    } else if categories == [DiagnosticCategoryV2::ValidEconomicFailure] {
        IterationInterpretationDiagnosticV1::ValidEconomicFailure
    } else {
        return Err(IterationDecisionErrorV1::InvalidDiagnosticCensus);
    };
    Ok(IterationDecisionGateV1::InterpretationRequired {
        evidence_cut,
        diagnostic,
        required_dimensions: vec![
            IterationDiagnosisDimensionV1::EvidenceIntegrity,
            IterationDiagnosisDimensionV1::MechanismValidity,
            IterationDiagnosisDimensionV1::EconomicViability,
            IterationDiagnosisDimensionV1::Robustness,
            IterationDiagnosisDimensionV1::FailureAttribution,
            IterationDiagnosisDimensionV1::InformationValue,
        ],
    })
}

fn evidence_cut(
    census: &TrialFamilyCensusReadbackV2,
    result: &ReplayResultDtoV2,
    latest: &crate::trial_family::TrialFamilyLatestAttemptBindingV2<'_>,
    decision_policy: &IterationDecisionPolicyBindingV1,
) -> IterationDecisionEvidenceCutV1 {
    IterationDecisionEvidenceCutV1 {
        decision_policy_identity: decision_policy.policy_identity().to_string(),
        decision_policy_version: decision_policy.policy_version(),
        decision_policy_digest: decision_policy.policy_digest(),
        decision_policy_binding_digest: decision_policy.binding_digest(),
        trial_family_identity: census.census_frontier.trial_family_identity().to_string(),
        census_frontier_identity: census.census_frontier.frontier_identity().to_string(),
        census_frontier_digest: census.census_frontier.frontier_digest().to_string(),
        attempt_frontier_identity: census.attempt_frontier.frontier_identity().to_string(),
        attempt_frontier_digest: census.attempt_frontier.frontier_digest().to_string(),
        candidate_set_frontier_identity: census
            .candidate_set_frontier
            .frontier_identity()
            .to_string(),
        candidate_set_frontier_digest: census.candidate_set_frontier.frontier_digest().to_string(),
        request_identity: latest.request_identity.to_string(),
        request_digest: latest.request_digest.to_string(),
        result_identity: latest.result_identity.to_string(),
        result_digest: latest.result_digest.to_string(),
        attempt_identity: result.attempt_identity.as_str().to_string(),
    }
}

fn repair_categories(categories: &[DiagnosticCategoryV2]) -> Vec<IterationRepairCategoryV1> {
    [
        (
            DiagnosticCategoryV2::MarketData,
            IterationRepairCategoryV1::MarketData,
        ),
        (
            DiagnosticCategoryV2::Artifact,
            IterationRepairCategoryV1::Artifact,
        ),
        (
            DiagnosticCategoryV2::RuntimeKernel,
            IterationRepairCategoryV1::RuntimeKernel,
        ),
        (
            DiagnosticCategoryV2::BacktestOperational,
            IterationRepairCategoryV1::BacktestOperational,
        ),
        (
            DiagnosticCategoryV2::Simulator,
            IterationRepairCategoryV1::Simulator,
        ),
        (
            DiagnosticCategoryV2::ReplayConfiguration,
            IterationRepairCategoryV1::ReplayConfiguration,
        ),
    ]
    .into_iter()
    .filter_map(|(diagnostic, repair)| categories.contains(&diagnostic).then_some(repair))
    .collect()
}

fn repair_diagnostic_category(category: IterationRepairCategoryV1) -> DiagnosticCategoryV2 {
    match category {
        IterationRepairCategoryV1::MarketData => DiagnosticCategoryV2::MarketData,
        IterationRepairCategoryV1::Artifact => DiagnosticCategoryV2::Artifact,
        IterationRepairCategoryV1::RuntimeKernel => DiagnosticCategoryV2::RuntimeKernel,
        IterationRepairCategoryV1::BacktestOperational => DiagnosticCategoryV2::BacktestOperational,
        IterationRepairCategoryV1::Simulator => DiagnosticCategoryV2::Simulator,
        IterationRepairCategoryV1::ReplayConfiguration => DiagnosticCategoryV2::ReplayConfiguration,
    }
}

const fn repair_target(category: IterationRepairCategoryV1) -> IterationRepairTargetV1 {
    match category {
        IterationRepairCategoryV1::MarketData => IterationRepairTargetV1::MarketData,
        IterationRepairCategoryV1::Artifact => IterationRepairTargetV1::ResearchDevelop,
        IterationRepairCategoryV1::RuntimeKernel => IterationRepairTargetV1::Runtime,
        IterationRepairCategoryV1::BacktestOperational => {
            IterationRepairTargetV1::BacktestRunnerService
        }
        IterationRepairCategoryV1::Simulator => IterationRepairTargetV1::SimExchange,
        IterationRepairCategoryV1::ReplayConfiguration => {
            IterationRepairTargetV1::ResearchReplayConfiguration
        }
    }
}

#[cfg(test)]
mod tests {
    use vibe_backtest_owner_contracts::{
        CanonicalDigestV2, ComponentObservationLocatorV2, ConsumedComponentObservationDtoV2,
        DiagnosticEvidenceDtoV2, ObservationComponentV2, OpaqueIdentityV2, ReconciliationAtomDtoV2,
        ReconciliationStatusV2, ReplayAuthorityClaimV2,
    };

    use super::*;
    use crate::product_edge::{FrozenResearchGoalIntentV2, SourcedResearchGoalV2};
    use crate::trial_family::{
        TrialFamilyAttemptAppendV2, TrialFamilyCandidateSetProposalV2,
        TrialFamilyIndependenceDispositionV1, TrialFamilyPolicyV1, append_attempt_to_census_v2,
        form_initial_family,
    };

    fn identity(value: &str) -> OpaqueIdentityV2 {
        value.to_string().try_into().expect("valid identity")
    }

    fn digest(algorithm: &str, byte: char) -> CanonicalDigestV2 {
        format!("{algorithm}:{}", byte.to_string().repeat(64))
            .try_into()
            .expect("valid digest")
    }

    fn policy() -> TrialFamilyPolicyV1 {
        TrialFamilyPolicyV1 {
            trial_budget: 2,
            stop_rule: "bounded-stop-v1".to_string(),
            pit_rule_identity: "pit-rule-v1".to_string(),
            cost_model_identity: "cost-v1".to_string(),
            slippage_model_identity: "slippage-v1".to_string(),
            capacity_model_identity: "capacity-v1".to_string(),
            semantic_predecessor_frontier: Vec::new(),
            protected_feedback_frontier: "qualification-frontier-v1".to_string(),
            independence_disposition: TrialFamilyIndependenceDispositionV1::Independent,
            independence_basis_identity: "basis-v1".to_string(),
            frozen_falsifier_binding: TrialFamilyPolicyV1::expected_falsifier_binding(
                "Does the signal survive exact costs?",
            )
            .expect("valid falsifier"),
            replay_execution_policy_v2: None,
            replay_policy_catalog_v3: None,
            decision_policy_v1: None,
        }
    }

    fn decision_policy() -> IterationDecisionPolicyBindingV1 {
        IterationDecisionPolicyBindingV1 {
            schema_version: 1,
            policy_identity: ITERATION_DECISION_POLICY_ID_V1.to_string(),
            policy_version: ITERATION_DECISION_POLICY_VERSION_V1,
            policy_digest: Sha256::digest(ITERATION_DECISION_POLICY_DESCRIPTOR_V1).into(),
            diagnostic_policy_identity: "diagnostic-policy-v1".to_string(),
            diagnostic_policy_version: "v1".to_string(),
            replay_catalog_record_id: "catalog-v3".to_string(),
            replay_catalog_version: 1,
            replay_catalog_record_digest: [6; 32],
            binding_digest: [7; 32],
        }
    }

    fn census(disposition: TrialFamilyAttemptTerminalDispositionV2) -> TrialFamilyCensusReadbackV2 {
        census_with_budget(disposition, 2, 1)
    }

    fn census_with_budget(
        disposition: TrialFamilyAttemptTerminalDispositionV2,
        trial_budget: u32,
        consumed_trial_budget: u32,
    ) -> TrialFamilyCensusReadbackV2 {
        let mut family_policy = policy();
        family_policy.trial_budget = trial_budget;
        let family = form_initial_family(
            "intent-v2",
            &format!("sha256:{}", "1".repeat(64)),
            family_policy,
            1,
        )
        .expect("valid family");
        append_attempt_to_census_v2(
            family.clone(),
            None,
            TrialFamilyAttemptAppendV2 {
                intent_identity: family.initial_intent_member.fact_identity().to_string(),
                intent_digest: family.initial_intent_member.fact_digest().to_string(),
                request_identity: "request-v2".to_string(),
                request_digest: format!("blake3:{}", "2".repeat(64)),
                result_identity: "result-v2".to_string(),
                result_digest: format!("blake3:{}", "3".repeat(64)),
                terminal_disposition: disposition,
                consumed_trial_budget,
                candidate_set: TrialFamilyCandidateSetProposalV2 {
                    generation_rule_identity: "candidate-rule-v1".to_string(),
                    generation_rule_digest: format!("sha256:{}", "4".repeat(64)),
                    expected_cardinality: 0,
                    candidates: Vec::new(),
                },
            },
            2,
        )
        .expect("valid census")
    }

    fn diagnostic(category: DiagnosticCategoryV2) -> DiagnosticEvidenceDtoV2 {
        DiagnosticEvidenceDtoV2 {
            request_identity: identity("request-v2"),
            request_meaning_digest: digest("blake3", '2'),
            attempt_identity: identity("attempt-v2"),
            category,
            decisive_evidence: ComponentObservationLocatorV2 {
                component: ObservationComponentV2::SemanticTrace,
                reference: identity("evidence-v2"),
                digest: digest("blake3", '5'),
            },
        }
    }

    fn result(
        terminal: ReplayTerminalV2,
        categories: &[DiagnosticCategoryV2],
    ) -> ReplayResultDtoV2 {
        ReplayResultDtoV2 {
            schema_version: 2,
            result_identity: identity("result-v2"),
            result_digest: digest("blake3", '3'),
            request_identity: identity("request-v2"),
            request_meaning_digest: digest("blake3", '2'),
            namespace: ReplayNamespaceV2::Exploratory,
            replay_authority: ReplayAuthorityClaimV2::Exploratory,
            attempt_identity: identity("attempt-v2"),
            terminal,
            reconciliation: Vec::new(),
            semantic_trace: None,
            diagnostic_census: categories.iter().copied().map(diagnostic).collect(),
        }
    }

    fn interpretation_result(category: DiagnosticCategoryV2) -> ReplayResultDtoV2 {
        let mut result = result(ReplayTerminalV2::TerminalResult, &[category]);
        result.reconciliation = ObservationComponentV2::REQUESTED_MEANING
            .into_iter()
            .enumerate()
            .map(|(index, component)| {
                let meaning_identity = identity(&format!("meaning-{index}"));
                let meaning_digest = digest("blake3", '6');
                ReconciliationAtomDtoV2 {
                    component,
                    requested_meaning_identity: meaning_identity.clone(),
                    requested_meaning_digest: meaning_digest.clone(),
                    observed_meaning_identity: Some(meaning_identity),
                    observed_meaning_digest: Some(meaning_digest),
                    observation_locator: Some(ComponentObservationLocatorV2 {
                        component,
                        reference: identity(&format!("evidence-{index}")),
                        digest: digest("blake3", '7'),
                    }),
                    status: ReconciliationStatusV2::Exact,
                }
            })
            .collect();
        result.semantic_trace = Some(ConsumedComponentObservationDtoV2 {
            request_identity: result.request_identity.clone(),
            request_meaning_digest: result.request_meaning_digest.clone(),
            attempt_identity: result.attempt_identity.clone(),
            component: ObservationComponentV2::SemanticTrace,
            locator: ComponentObservationLocatorV2 {
                component: ObservationComponentV2::SemanticTrace,
                reference: identity("semantic-trace-evidence"),
                digest: digest("blake3", '8'),
            },
            observed_meaning_identity: identity("semantic-trace-meaning"),
            observed_meaning_digest: digest("blake3", '9'),
        });
        result
    }

    fn interpretation_context(
        census: &TrialFamilyCensusReadbackV2,
        gate: IterationDecisionGateV1,
        result: &ReplayResultDtoV2,
    ) -> Result<IterationInterpretationContextV1, IterationDecisionErrorV1> {
        interpretation_context_with_outcome(census, gate, result, |_| {})
    }

    fn interpretation_context_with_outcome(
        census: &TrialFamilyCensusReadbackV2,
        gate: IterationDecisionGateV1,
        result: &ReplayResultDtoV2,
        mutate_outcome: impl FnOnce(&mut IterationInterpretationOutcomeEvidenceV1),
    ) -> Result<IterationInterpretationContextV1, IterationDecisionErrorV1> {
        let intent = FrozenResearchGoalIntent::V2(FrozenResearchGoalIntentV2 {
            schema_version: 2,
            intent_identity: census
                .legacy_family
                .initial_intent_member()
                .fact_identity()
                .to_string(),
            request_identity: "research-request-v2".to_string(),
            semantic_digest: census
                .legacy_family
                .initial_intent_member()
                .fact_digest()
                .to_string(),
            source_frontier: Vec::new(),
            goal: SourcedResearchGoalV2 {
                hypothesis: "trend continuation".to_string(),
                mechanism: "persistent order flow".to_string(),
                falsification_question: "does the signal survive exact costs?".to_string(),
                expected_observation: "positive next return".to_string(),
                required_data: vec!["bars".to_string()],
                cost_assumption: "catalog cost model".to_string(),
                capacity_assumption: "catalog capacity model".to_string(),
                sources: Vec::new(),
            },
            independence_basis_identity: "basis-v1".to_string(),
            independence_basis_digest: format!("sha256:{}", "a".repeat(64)),
            protected_feedback_projection_identity: "protected-feedback-v1".to_string(),
            protected_feedback_projection_digest: format!("sha256:{}", "b".repeat(64)),
            trial_family_identity: census.census_frontier.trial_family_identity().to_string(),
            trial_family_policy_digest: format!("sha256:{}", "c".repeat(64)),
            frozen_at_epoch_ms: 1,
        });
        let FrozenResearchGoalIntent::V2(intent_v2) = &intent else {
            unreachable!("fixture uses V2 intent")
        };
        let mut result = result.clone();
        bind_interpretation_component(
            &mut result,
            ObservationComponentV2::FrozenResearchIntent,
            &intent_v2.intent_identity,
            &intent_v2.semantic_digest,
        );
        let replay_census_binding = result
            .reconciliation
            .iter()
            .find(|atom| atom.component == ObservationComponentV2::TrialFamilyCensusFrontier)
            .expect("Replay census binding");
        let result_bytes = serde_json::to_vec(&result).expect("result bytes");
        let semantic_trace_bytes = b"canonical-backtest-semantic-trace-envelope";
        let mut outcome = IterationInterpretationOutcomeEvidenceV1 {
            evidence_identity: "backtest-outcome-evidence-v1-fixture".to_string(),
            evidence_digest: format!("blake3:{}", "d".repeat(64)),
            frozen_research_intent: IterationDiagnosisEvidenceReferenceV1 {
                identity: intent_v2.intent_identity.clone(),
                digest: intent_v2.semantic_digest.clone(),
            },
            trial_family_census_frontier: IterationDiagnosisEvidenceReferenceV1 {
                identity: replay_census_binding
                    .requested_meaning_identity
                    .as_str()
                    .to_string(),
                digest: replay_census_binding
                    .requested_meaning_digest
                    .as_str()
                    .to_string(),
            },
            canonical_result_schema_identity: "vibe-backtest-result/v1".to_string(),
            canonical_result_binding_digest: format!("blake3:{}", "e".repeat(64)),
            canonical_result_bytes_length: 1,
            evidence_storage_digest: format!("sha256:{}", "1".repeat(64)),
            canonical_result_storage_digest: format!("sha256:{}", "2".repeat(64)),
            receipt_storage_digest: format!("sha256:{}", "3".repeat(64)),
            outbox_storage_digest: format!("sha256:{}", "4".repeat(64)),
        };
        mutate_outcome(&mut outcome);
        issue_interpretation_context_from_result_v1(
            census,
            &intent,
            gate,
            &result,
            interpretation_result_custody_v1(
                &result_bytes,
                b"receipt-bytes",
                b"outbox-bytes",
                semantic_trace_bytes,
            ),
            outcome,
        )
    }

    fn bind_interpretation_component(
        result: &mut ReplayResultDtoV2,
        component: ObservationComponentV2,
        identity: &str,
        digest: &str,
    ) {
        if let Some(atom) = result
            .reconciliation
            .iter_mut()
            .find(|atom| atom.component == component)
        {
            atom.requested_meaning_identity = self::identity(identity);
            atom.requested_meaning_digest =
                CanonicalDigestV2::try_from(digest.to_string()).expect("fixture digest");
            atom.observed_meaning_identity = Some(atom.requested_meaning_identity.clone());
            atom.observed_meaning_digest = Some(atom.requested_meaning_digest.clone());
        }
    }

    #[test]
    fn defect_diagnosis_preserves_all_categories_and_applies_frozen_precedence() {
        let census = census(TrialFamilyAttemptTerminalDispositionV2::TerminalResult);
        let result = result(
            ReplayTerminalV2::TerminalResult,
            &[
                DiagnosticCategoryV2::MarketData,
                DiagnosticCategoryV2::BacktestOperational,
                DiagnosticCategoryV2::Simulator,
            ],
        );

        let gate = gate_result(&census, &result, &decision_policy()).expect("repair gate");
        let IterationDecisionGateV1::RepairInputs {
            supported_defects,
            selected_category,
            target,
            ..
        } = gate
        else {
            panic!("expected repair gate");
        };
        assert_eq!(
            supported_defects,
            vec![
                IterationRepairCategoryV1::MarketData,
                IterationRepairCategoryV1::BacktestOperational,
                IterationRepairCategoryV1::Simulator,
            ]
        );
        assert_eq!(selected_category, IterationRepairCategoryV1::MarketData);
        assert_eq!(target, IterationRepairTargetV1::MarketData);
    }

    #[test]
    fn valid_economic_result_requires_all_six_rd_diagnosis_dimensions() {
        let census = census(TrialFamilyAttemptTerminalDispositionV2::TerminalResult);
        let result = result(
            ReplayTerminalV2::TerminalResult,
            &[DiagnosticCategoryV2::ValidEconomicFailure],
        );

        let gate = gate_result(&census, &result, &decision_policy()).expect("interpretation gate");
        let IterationDecisionGateV1::InterpretationRequired {
            diagnostic,
            required_dimensions,
            ..
        } = gate
        else {
            panic!("expected interpretation gate");
        };
        assert_eq!(
            diagnostic,
            IterationInterpretationDiagnosticV1::ValidEconomicFailure
        );
        assert_eq!(required_dimensions.len(), 6);
    }

    #[test]
    fn interpretation_context_binds_complete_custody_with_distinct_diagnostic_evidence() {
        let census = census(TrialFamilyAttemptTerminalDispositionV2::TerminalResult);
        let result = interpretation_result(DiagnosticCategoryV2::NoExecutionDefect);
        let gate = gate_result(&census, &result, &decision_policy()).expect("interpretation gate");

        let context = interpretation_context(&census, gate, &result).expect("complete context");

        assert_eq!(context.required_dimensions.len(), 6);
        assert_eq!(
            context.owner_bindings.len(),
            ObservationComponentV2::REQUESTED_MEANING.len() + 1
        );
        assert_eq!(
            context
                .owner_bindings
                .last()
                .map(|binding| binding.component),
            Some(ObservationComponentV2::SemanticTrace)
        );
        assert_eq!(
            context.diagnostic_evidence.component,
            ObservationComponentV2::SemanticTrace
        );
        assert_ne!(
            context.diagnostic_evidence.evidence_identity,
            context
                .owner_bindings
                .last()
                .expect("semantic trace binding")
                .evidence_identity
        );
        assert!(
            context
                .result_custody
                .result_storage_digest
                .starts_with("sha256:")
        );
        assert_ne!(
            context
                .outcome_evidence
                .trial_family_census_frontier
                .identity,
            context.evidence_cut.census_frontier_identity,
            "Replay-time and post-Result Decision frontiers are distinct lineage cuts"
        );
        assert_eq!(context.diagnosis_findings.len(), 6);
        assert_eq!(
            context.diagnosis_findings[0].disposition,
            IterationDiagnosisDispositionV1::EvidenceEstablished
        );
        assert_eq!(
            context.diagnosis_findings[4].disposition,
            IterationDiagnosisDispositionV1::NoExecutionDefect
        );
        assert_eq!(
            context
                .diagnosis_findings
                .iter()
                .filter(|finding| {
                    finding.disposition == IterationDiagnosisDispositionV1::Unresolved
                })
                .count(),
            4
        );
        assert!(context.has_unresolved_diagnosis());
        assert!(
            context
                .result_custody
                .semantic_trace_storage_digest
                .starts_with("sha256:")
        );
        assert_eq!(
            context.outcome_evidence.canonical_result_schema_identity,
            "vibe-backtest-result/v1"
        );
        assert!(
            context
                .outcome_evidence
                .canonical_result_storage_digest
                .starts_with("sha256:")
        );
    }

    #[test]
    fn exhausted_budget_issues_canonical_terminal_stop_with_complete_diagnosis() {
        let census = census_with_budget(
            TrialFamilyAttemptTerminalDispositionV2::TerminalResult,
            1,
            1,
        );
        let result = interpretation_result(DiagnosticCategoryV2::NoExecutionDefect);
        let gate = gate_result(&census, &result, &decision_policy()).expect("interpretation gate");
        let context = interpretation_context(&census, gate, &result).expect("complete context");

        let readback = issue_trial_budget_terminal_stop_from_parts_v1(context, 1, 1, 3)
            .expect("budget terminal Decision");

        assert_eq!(
            readback.decision().outcome(),
            &IterationDecisionOutcomeV1::TerminalStop {
                reason: IterationTerminalStopReasonV1::TrialBudgetExhausted,
            }
        );
        assert_eq!(readback.decision().consumed_trial_budget(), 1);
        assert_eq!(readback.decision().trial_budget(), 1);
        assert_eq!(
            readback
                .decision()
                .interpretation
                .diagnosis_findings
                .iter()
                .filter(|finding| {
                    finding.disposition == IterationDiagnosisDispositionV1::Unresolved
                })
                .count(),
            4
        );

        let decision_bytes = serde_json::to_vec(readback.decision()).expect("decision bytes");
        let receipt_bytes = serde_json::to_vec(readback.receipt()).expect("receipt bytes");
        let admitted =
            admit_stored_trial_budget_terminal_stop_decision_v1(&decision_bytes, &receipt_bytes)
                .expect("stored terminal Decision");
        assert_eq!(admitted, readback);
    }

    #[test]
    fn remaining_budget_creates_no_terminal_stop() {
        let census = census(TrialFamilyAttemptTerminalDispositionV2::TerminalResult);
        let result = interpretation_result(DiagnosticCategoryV2::ValidEconomicFailure);
        let gate = gate_result(&census, &result, &decision_policy()).expect("interpretation gate");
        let context = interpretation_context(&census, gate, &result).expect("complete context");

        assert!(matches!(
            issue_trial_budget_terminal_stop_decision_v1(&census, context, 3),
            Err(IterationDecisionErrorV1::InvalidStoredDecision(
                "TrialFamily budget is not exhausted"
            ))
        ));
    }

    #[test]
    fn cross_spliced_interpretation_cut_creates_no_terminal_stop() {
        let census = census_with_budget(
            TrialFamilyAttemptTerminalDispositionV2::TerminalResult,
            1,
            1,
        );
        let result = interpretation_result(DiagnosticCategoryV2::NoExecutionDefect);
        let gate = gate_result(&census, &result, &decision_policy()).expect("interpretation gate");
        let mut context = interpretation_context(&census, gate, &result).expect("complete context");
        context.evidence_cut.census_frontier_identity = "other-frontier".to_string();

        assert!(matches!(
            issue_trial_budget_terminal_stop_decision_v1(&census, context, 3),
            Err(IterationDecisionErrorV1::ResultBindingMismatch)
        ));
    }

    #[test]
    fn cross_spliced_outcome_evidence_creates_no_interpretation_context() {
        let census = census(TrialFamilyAttemptTerminalDispositionV2::TerminalResult);
        let result = interpretation_result(DiagnosticCategoryV2::NoExecutionDefect);
        let gate = gate_result(&census, &result, &decision_policy()).expect("interpretation gate");

        assert!(matches!(
            interpretation_context_with_outcome(&census, gate, &result, |outcome| {
                outcome.trial_family_census_frontier.identity = "other-frontier".to_string();
            }),
            Err(IterationDecisionErrorV1::InterpretationEvidenceUnavailable(
                "Backtest outcome evidence does not share the R&D interpretation cut"
            ))
        ));
    }

    #[test]
    fn duplicate_or_missing_replay_component_creates_no_interpretation_context() {
        let census = census(TrialFamilyAttemptTerminalDispositionV2::TerminalResult);
        let mut result = interpretation_result(DiagnosticCategoryV2::ValidEconomicFailure);
        let gate = gate_result(&census, &result, &decision_policy()).expect("interpretation gate");
        result.reconciliation[1].component = result.reconciliation[0].component;

        assert!(matches!(
            interpretation_context(&census, gate, &result),
            Err(IterationDecisionErrorV1::InterpretationEvidenceUnavailable(
                _
            ))
        ));
    }

    #[test]
    fn cross_spliced_semantic_trace_creates_no_interpretation_context() {
        let census = census(TrialFamilyAttemptTerminalDispositionV2::TerminalResult);
        let mut result = interpretation_result(DiagnosticCategoryV2::NoExecutionDefect);
        let gate = gate_result(&census, &result, &decision_policy()).expect("interpretation gate");
        result
            .semantic_trace
            .as_mut()
            .expect("semantic trace")
            .request_identity = identity("another-request");

        assert!(matches!(
            interpretation_context(&census, gate, &result),
            Err(IterationDecisionErrorV1::InterpretationEvidenceUnavailable(
                _
            ))
        ));
    }

    #[test]
    fn changed_diagnostic_evidence_changes_the_bound_result_custody() {
        let census = census(TrialFamilyAttemptTerminalDispositionV2::TerminalResult);
        let mut result = interpretation_result(DiagnosticCategoryV2::NoExecutionDefect);
        let first_gate =
            gate_result(&census, &result, &decision_policy()).expect("interpretation gate");
        let first = interpretation_context(&census, first_gate, &result).expect("first context");
        result.diagnostic_census[0].decisive_evidence.reference =
            identity("different-owner-diagnostic-evidence");
        let changed_gate =
            gate_result(&census, &result, &decision_policy()).expect("changed interpretation gate");
        let changed =
            interpretation_context(&census, changed_gate, &result).expect("changed context");

        assert_ne!(
            first.result_custody.result_storage_digest,
            changed.result_custody.result_storage_digest
        );
    }

    #[test]
    fn unknown_result_remains_census_only() {
        let census = census(TrialFamilyAttemptTerminalDispositionV2::Unknown);
        let result = result(ReplayTerminalV2::InProgressOrUnknown, &[]);

        assert_eq!(
            gate_result(&census, &result, &decision_policy()).expect("no-decision gate"),
            IterationDecisionGateV1::NoDecision {
                reason: IterationNoDecisionReasonV1::UnknownOrNonterminalResult,
            }
        );
    }

    #[test]
    fn cross_spliced_result_is_rejected_before_diagnosis() {
        let census = census(TrialFamilyAttemptTerminalDispositionV2::TerminalResult);
        let mut result = result(
            ReplayTerminalV2::TerminalResult,
            &[DiagnosticCategoryV2::NoExecutionDefect],
        );
        result.request_identity = identity("another-request-v2");

        assert!(matches!(
            gate_result(&census, &result, &decision_policy()),
            Err(IterationDecisionErrorV1::ResultBindingMismatch)
        ));
    }
}
