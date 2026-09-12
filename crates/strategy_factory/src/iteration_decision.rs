//! R&D-owned gate from one locked exploratory Result to an Iteration Decision.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;
use vibe_backtest_owner_contracts::{
    DiagnosticCategoryV2, ReplayNamespaceV2, ReplayResultDtoV2, ReplayTerminalV2,
};

use crate::{
    LockedExploratoryReplayResultV2, ReplayPolicyCatalogBindingV3,
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
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
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
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
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
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
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
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
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
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum IterationTerminalStopReasonV1 {
    FalsifierSatisfied,
    FrozenStopRuleSatisfied,
    TrialBudgetExhausted,
    EconomicImpossibility,
    LowInformationValue,
    InputUnavailable,
}

/// Exact Owner facts that every eventual Decision and Selection must repeat.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
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
        CanonicalDigestV2, ComponentObservationLocatorV2, DiagnosticEvidenceDtoV2,
        ObservationComponentV2, OpaqueIdentityV2, ReplayAuthorityClaimV2,
    };

    use super::*;
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
        let family = form_initial_family(
            "intent-v2",
            &format!("sha256:{}", "1".repeat(64)),
            policy(),
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
                consumed_trial_budget: 1,
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
