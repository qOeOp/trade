//! Backtest-only construction of Qualification-isolated protected results.

use std::collections::BTreeMap;

use serde::Serialize;
use thiserror::Error;
#[cfg(test)]
use vibe_backtest_owner_contracts::{CanonicalDigestV2, OpaqueIdentityV2};
use vibe_backtest_owner_contracts::{
    DiagnosticCategoryV2, PROTECTED_REPLAY_BINDING_COUNT_V1, ProtectedCellApplicabilityEvidenceV3,
    ProtectedCellApplicabilityObservationV3, ProtectedConsumedInputLocatorV1,
    ProtectedDiagnosticEvidenceV2, ProtectedEconomicMeasurementV1,
    ProtectedEvaluationComparisonRuleV1, ProtectedEvaluationEpochSuccessorProofV1,
    ProtectedEvaluationStageV1, ProtectedEvaluationTimeEvidenceV1, ProtectedReplayBindingFieldV1,
    ProtectedReplayReconciliationAtomV1, ProtectedReplayRequestDtoV1, ProtectedReplayRequestDtoV2,
    ProtectedReplayRequestSetSealDtoV1, ProtectedReplayResultDtoV1, ProtectedReplayResultDtoV2,
    ProtectedReplayResultDtoV3, ProtectedResultOutcomeLocatorV1, ReconciliationStatusV2,
    ReplayTerminalV2, protected_diagnostic_category_set_digest_v1,
    protected_evaluation_time_evidence_digest_v1,
};
use vibe_data::owner::shared_time_evidence::{ClockHeadComparisonRule, ClockHeadSuccessorReadback};

#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum ProtectedReplayOwnerErrorV1 {
    #[error("protected replay observation belongs to a different request or attempt")]
    ObservationBindingMismatch,
    #[error("protected replay observation field is duplicated")]
    DuplicateObservation,
    #[error("protected replay result is noncanonical")]
    InvalidResult,
}

/// Caller-supplied Backtest observation. It becomes Owner evidence only after exact reconciliation
/// with the locked Qualification request inside
/// [`PostgresReplayResultOwnerV2`](crate::postgres::PostgresReplayResultOwnerV2).
#[derive(Debug)]
pub struct ProtectedConsumedBindingObservationProposalV3 {
    pub field: ProtectedReplayBindingFieldV1,
    pub consumed_identity: String,
    pub consumed_digest: String,
    pub evidence: ProtectedConsumedInputLocatorV1,
}

/// Inputs to the single public Owner-controlled V3 production path.
///
/// This vocabulary records Backtest observations and locators only; it contains no Qualification
/// adjudication.
#[derive(Debug)]
pub struct ProtectedReplayResultProposalV3 {
    pub attempt_identity: String,
    pub observations: Vec<ProtectedConsumedBindingObservationProposalV3>,
    pub diagnostic_evidence: Vec<ProtectedDiagnosticEvidenceV2>,
    pub applicability_evidence: ProtectedCellApplicabilityEvidenceV3,
    pub protected_outcome: ProtectedResultOutcomeLocatorV1,
    pub protected_economic_measurement: Option<ProtectedEconomicMeasurementV1>,
    pub time_successor: ClockHeadSuccessorReadback,
}

#[derive(Debug)]
pub(crate) struct ProtectedConsumedBindingObservationV1 {
    pub(crate) request_identity: String,
    pub(crate) request_digest: String,
    pub(crate) attempt_identity: String,
    pub(crate) field: ProtectedReplayBindingFieldV1,
    pub(crate) consumed_identity: String,
    pub(crate) consumed_digest: String,
    pub(crate) evidence: ProtectedConsumedInputLocatorV1,
}

#[derive(Debug)]
pub(crate) struct ProtectedReplayResultDraftV1 {
    pub(crate) request_receipt_identity: String,
    pub(crate) request_seal_digest: String,
    pub(crate) attempt_identity: String,
    pub(crate) terminal: ReplayTerminalV2,
    pub(crate) observations: Vec<ProtectedConsumedBindingObservationV1>,
    pub(crate) diagnostic_category_set: Vec<DiagnosticCategoryV2>,
    pub(crate) protected_outcome: Option<ProtectedResultOutcomeLocatorV1>,
}

#[derive(Debug)]
pub(crate) struct ProtectedReplayResultDraftV2 {
    pub(crate) request_receipt_identity: String,
    pub(crate) request_seal_digest: String,
    pub(crate) attempt_identity: String,
    pub(crate) observations: Vec<ProtectedConsumedBindingObservationV1>,
    pub(crate) diagnostic_evidence: Vec<ProtectedDiagnosticEvidenceV2>,
    pub(crate) protected_outcome: ProtectedResultOutcomeLocatorV1,
}

#[derive(Debug)]
pub(crate) struct ProtectedReplayResultDraftV3 {
    pub(crate) request_receipt_identity: String,
    pub(crate) request_seal_digest: String,
    pub(crate) attempt_identity: String,
    pub(crate) observations: Vec<ProtectedConsumedBindingObservationV1>,
    pub(crate) diagnostic_evidence: Vec<ProtectedDiagnosticEvidenceV2>,
    pub(crate) applicability_evidence: ProtectedCellApplicabilityEvidenceV3,
    pub(crate) protected_outcome: ProtectedResultOutcomeLocatorV1,
    pub(crate) protected_economic_measurement: Option<ProtectedEconomicMeasurementV1>,
    pub(crate) time_successor: ClockHeadSuccessorReadback,
}

/// Serialize-only Backtest Owner result. Callers cannot construct or deserialize this value.
#[derive(Debug, Serialize)]
#[serde(transparent)]
pub struct SealedProtectedReplayResultV1(ProtectedReplayResultDtoV1);

/// Serialize-only Backtest Owner protected result with decisive diagnostic evidence.
///
/// ```compile_fail
/// use vibe_backtest_owner::SealedProtectedReplayResultV2;
/// let _: SealedProtectedReplayResultV2 = serde_json::from_str("{}").unwrap();
/// ```
#[derive(Debug, Serialize)]
#[serde(transparent)]
pub struct SealedProtectedReplayResultV2(ProtectedReplayResultDtoV2);

/// Serialize-only Backtest Owner protected per-cell evidence with a sealed time successor.
#[derive(Debug, Serialize)]
#[serde(transparent)]
pub struct SealedProtectedReplayResultV3(ProtectedReplayResultDtoV3);

/// Backtest readback of a Qualification-locked complete request set.
#[derive(Debug, Serialize)]
#[serde(transparent)]
pub struct ResolvedProtectedReplayRequestSetV1(ProtectedReplayRequestSetSealDtoV1);

impl ResolvedProtectedReplayRequestSetV1 {
    pub fn request_set(&self) -> &ProtectedReplayRequestSetSealDtoV1 {
        &self.0
    }

    pub(crate) fn new(request_set: ProtectedReplayRequestSetSealDtoV1) -> Self {
        Self(request_set)
    }
}

impl SealedProtectedReplayResultV1 {
    pub fn result_identity(&self) -> &str {
        &self.0.result_identity
    }

    pub fn request_identity(&self) -> &str {
        &self.0.request_identity
    }

    pub fn attempt_identity(&self) -> &str {
        &self.0.attempt_identity
    }

    pub fn terminal(&self) -> ReplayTerminalV2 {
        self.0.terminal
    }

    pub fn to_canonical_bytes(&self) -> Result<Vec<u8>, ProtectedReplayOwnerErrorV1> {
        self.0
            .to_canonical_bytes()
            .map_err(|_| ProtectedReplayOwnerErrorV1::InvalidResult)
    }

    pub(crate) fn dto(&self) -> &ProtectedReplayResultDtoV1 {
        &self.0
    }
}

impl SealedProtectedReplayResultV2 {
    pub fn result_identity(&self) -> &str {
        &self.0.result_identity
    }

    pub fn request_identity(&self) -> &str {
        &self.0.request_identity
    }

    pub fn attempt_identity(&self) -> &str {
        &self.0.attempt_identity
    }

    pub fn to_canonical_bytes(&self) -> Result<Vec<u8>, ProtectedReplayOwnerErrorV1> {
        self.0
            .to_canonical_bytes()
            .map_err(|_| ProtectedReplayOwnerErrorV1::InvalidResult)
    }

    pub(crate) fn dto(&self) -> &ProtectedReplayResultDtoV2 {
        &self.0
    }
}

impl SealedProtectedReplayResultV3 {
    pub fn result_identity(&self) -> &str {
        &self.0.result_identity
    }
    pub fn request_identity(&self) -> &str {
        &self.0.request_identity
    }
    pub fn attempt_identity(&self) -> &str {
        &self.0.attempt_identity
    }
    pub fn to_canonical_bytes(&self) -> Result<Vec<u8>, ProtectedReplayOwnerErrorV1> {
        self.0
            .to_canonical_bytes()
            .map_err(|_| ProtectedReplayOwnerErrorV1::InvalidResult)
    }
    pub(crate) fn dto(&self) -> &ProtectedReplayResultDtoV3 {
        &self.0
    }
}

pub(crate) fn commit_protected_owner_result_v1(
    request: &ProtectedReplayRequestDtoV1,
    draft: ProtectedReplayResultDraftV1,
) -> Result<SealedProtectedReplayResultV1, ProtectedReplayOwnerErrorV1> {
    request
        .validate()
        .map_err(|_| ProtectedReplayOwnerErrorV1::InvalidResult)?;
    let mut observed = BTreeMap::new();
    for observation in draft.observations {
        if observation.request_identity != request.request_identity
            || observation.request_digest != request.request_digest
            || observation.attempt_identity != draft.attempt_identity
        {
            return Err(ProtectedReplayOwnerErrorV1::ObservationBindingMismatch);
        }
        if observed.insert(observation.field, observation).is_some() {
            return Err(ProtectedReplayOwnerErrorV1::DuplicateObservation);
        }
    }

    let reconciliation = request
        .bindings
        .iter()
        .map(|binding| {
            if let Some(observation) = observed.remove(&binding.field) {
                let status = if observation.consumed_identity == binding.identity
                    && observation.consumed_digest == binding.digest
                {
                    ReconciliationStatusV2::Exact
                } else {
                    ReconciliationStatusV2::Mismatched
                };
                ProtectedReplayReconciliationAtomV1 {
                    field: binding.field,
                    requested_identity: binding.identity.clone(),
                    requested_digest: binding.digest.clone(),
                    consumed_identity: Some(observation.consumed_identity),
                    consumed_digest: Some(observation.consumed_digest),
                    evidence: Some(observation.evidence),
                    status,
                }
            } else {
                ProtectedReplayReconciliationAtomV1 {
                    field: binding.field,
                    requested_identity: binding.identity.clone(),
                    requested_digest: binding.digest.clone(),
                    consumed_identity: None,
                    consumed_digest: None,
                    evidence: None,
                    status: ReconciliationStatusV2::Missing,
                }
            }
        })
        .collect::<Vec<_>>();
    if !observed.is_empty() || reconciliation.len() != PROTECTED_REPLAY_BINDING_COUNT_V1 {
        return Err(ProtectedReplayOwnerErrorV1::InvalidResult);
    }

    let diagnostic_category_set_digest =
        protected_diagnostic_category_set_digest_v1(&draft.diagnostic_category_set)
            .map_err(|_| ProtectedReplayOwnerErrorV1::InvalidResult)?;
    let mut dto = ProtectedReplayResultDtoV1 {
        schema_version: 1,
        result_identity: "pending-result-identity".to_string(),
        result_digest: format!("blake3:{}", "0".repeat(64)),
        request_identity: request.request_identity.clone(),
        request_digest: request.request_digest.clone(),
        request_receipt_identity: draft.request_receipt_identity,
        request_seal_digest: draft.request_seal_digest,
        attempt_identity: draft.attempt_identity,
        terminal: draft.terminal,
        protected_decision_policy_identity: request.protected_decision_policy_identity.clone(),
        protected_decision_policy_version: request.protected_decision_policy_version,
        protected_plan_identity: request.protected_plan_identity.clone(),
        protected_plan_digest: request.protected_plan_digest.clone(),
        plan_cell_identity: request.plan_cell_identity.clone(),
        plan_cell_digest: request.plan_cell_digest.clone(),
        reconciliation,
        diagnostic_category_set: draft.diagnostic_category_set,
        diagnostic_category_set_digest,
        protected_outcome: draft.protected_outcome,
    };
    dto.result_digest = dto
        .compute_result_digest()
        .map_err(|_| ProtectedReplayOwnerErrorV1::InvalidResult)?;
    dto.result_identity = format!(
        "backtest-protected-replay-result-v1-{}",
        dto.result_digest
            .strip_prefix("blake3:")
            .ok_or(ProtectedReplayOwnerErrorV1::InvalidResult)?
    );
    dto.validate()
        .map_err(|_| ProtectedReplayOwnerErrorV1::InvalidResult)?;
    Ok(SealedProtectedReplayResultV1(dto))
}

pub(crate) fn commit_protected_owner_result_v2(
    request: &ProtectedReplayRequestDtoV1,
    mut draft: ProtectedReplayResultDraftV2,
) -> Result<SealedProtectedReplayResultV2, ProtectedReplayOwnerErrorV1> {
    request
        .validate()
        .map_err(|_| ProtectedReplayOwnerErrorV1::InvalidResult)?;
    let mut observed = BTreeMap::new();
    for observation in draft.observations {
        if observation.request_identity != request.request_identity
            || observation.request_digest != request.request_digest
            || observation.attempt_identity != draft.attempt_identity
        {
            return Err(ProtectedReplayOwnerErrorV1::ObservationBindingMismatch);
        }
        if observed.insert(observation.field, observation).is_some() {
            return Err(ProtectedReplayOwnerErrorV1::DuplicateObservation);
        }
    }
    let reconciliation = request
        .bindings
        .iter()
        .map(|binding| {
            if let Some(observation) = observed.remove(&binding.field) {
                let status = if observation.consumed_identity == binding.identity
                    && observation.consumed_digest == binding.digest
                {
                    ReconciliationStatusV2::Exact
                } else {
                    ReconciliationStatusV2::Mismatched
                };
                ProtectedReplayReconciliationAtomV1 {
                    field: binding.field,
                    requested_identity: binding.identity.clone(),
                    requested_digest: binding.digest.clone(),
                    consumed_identity: Some(observation.consumed_identity),
                    consumed_digest: Some(observation.consumed_digest),
                    evidence: Some(observation.evidence),
                    status,
                }
            } else {
                ProtectedReplayReconciliationAtomV1 {
                    field: binding.field,
                    requested_identity: binding.identity.clone(),
                    requested_digest: binding.digest.clone(),
                    consumed_identity: None,
                    consumed_digest: None,
                    evidence: None,
                    status: ReconciliationStatusV2::Missing,
                }
            }
        })
        .collect::<Vec<_>>();
    if !observed.is_empty()
        || reconciliation.len() != PROTECTED_REPLAY_BINDING_COUNT_V1
        || reconciliation
            .iter()
            .any(|atom| atom.status != ReconciliationStatusV2::Exact)
    {
        return Err(ProtectedReplayOwnerErrorV1::InvalidResult);
    }

    draft
        .diagnostic_evidence
        .sort_by_key(|value| value.category);
    if draft.diagnostic_evidence.is_empty()
        || draft
            .diagnostic_evidence
            .windows(2)
            .any(|pair| pair[0].category == pair[1].category)
        || draft.diagnostic_evidence.iter().any(|evidence| {
            evidence.request_identity != request.request_identity
                || evidence.request_digest != request.request_digest
                || evidence.attempt_identity != draft.attempt_identity
        })
    {
        return Err(ProtectedReplayOwnerErrorV1::InvalidResult);
    }
    let diagnostic_category_set = draft
        .diagnostic_evidence
        .iter()
        .map(|value| value.category)
        .collect::<Vec<_>>();
    let diagnostic_category_set_digest =
        protected_diagnostic_category_set_digest_v1(&diagnostic_category_set)
            .map_err(|_| ProtectedReplayOwnerErrorV1::InvalidResult)?;
    let mut dto = ProtectedReplayResultDtoV2 {
        schema_version: 2,
        result_identity: "pending-result-identity".to_string(),
        result_digest: format!("blake3:{}", "0".repeat(64)),
        request_identity: request.request_identity.clone(),
        request_digest: request.request_digest.clone(),
        request_receipt_identity: draft.request_receipt_identity,
        request_seal_digest: draft.request_seal_digest,
        attempt_identity: draft.attempt_identity,
        terminal: ReplayTerminalV2::TerminalResult,
        protected_decision_policy_identity: request.protected_decision_policy_identity.clone(),
        protected_decision_policy_version: request.protected_decision_policy_version,
        protected_plan_identity: request.protected_plan_identity.clone(),
        protected_plan_digest: request.protected_plan_digest.clone(),
        plan_cell_identity: request.plan_cell_identity.clone(),
        plan_cell_digest: request.plan_cell_digest.clone(),
        reconciliation,
        diagnostic_category_set,
        diagnostic_category_set_digest,
        diagnostic_evidence: draft.diagnostic_evidence,
        protected_outcome: Some(draft.protected_outcome),
    };
    dto.result_digest = dto
        .compute_result_digest()
        .map_err(|_| ProtectedReplayOwnerErrorV1::InvalidResult)?;
    dto.result_identity = format!(
        "backtest-protected-replay-result-v2-{}",
        dto.result_digest
            .strip_prefix("blake3:")
            .ok_or(ProtectedReplayOwnerErrorV1::InvalidResult)?
    );
    dto.validate()
        .map_err(|_| ProtectedReplayOwnerErrorV1::InvalidResult)?;
    Ok(SealedProtectedReplayResultV2(dto))
}

pub(crate) fn commit_protected_owner_result_v3(
    request: &ProtectedReplayRequestDtoV2,
    mut draft: ProtectedReplayResultDraftV3,
) -> Result<SealedProtectedReplayResultV3, ProtectedReplayOwnerErrorV1> {
    request
        .validate()
        .map_err(|_| ProtectedReplayOwnerErrorV1::InvalidResult)?;
    let basis = &request.frozen_basis;
    let mut observed = BTreeMap::new();
    for observation in draft.observations {
        if observation.request_identity != request.request_identity
            || observation.request_digest != request.request_digest
            || observation.attempt_identity != draft.attempt_identity
        {
            return Err(ProtectedReplayOwnerErrorV1::ObservationBindingMismatch);
        }
        if observed.insert(observation.field, observation).is_some() {
            return Err(ProtectedReplayOwnerErrorV1::DuplicateObservation);
        }
    }
    let reconciliation = basis
        .bindings
        .iter()
        .map(|binding| {
            if let Some(observation) = observed.remove(&binding.field) {
                let status = if observation.consumed_identity == binding.identity
                    && observation.consumed_digest == binding.digest
                {
                    ReconciliationStatusV2::Exact
                } else {
                    ReconciliationStatusV2::Mismatched
                };
                ProtectedReplayReconciliationAtomV1 {
                    field: binding.field,
                    requested_identity: binding.identity.clone(),
                    requested_digest: binding.digest.clone(),
                    consumed_identity: Some(observation.consumed_identity),
                    consumed_digest: Some(observation.consumed_digest),
                    evidence: Some(observation.evidence),
                    status,
                }
            } else {
                ProtectedReplayReconciliationAtomV1 {
                    field: binding.field,
                    requested_identity: binding.identity.clone(),
                    requested_digest: binding.digest.clone(),
                    consumed_identity: None,
                    consumed_digest: None,
                    evidence: None,
                    status: ReconciliationStatusV2::Missing,
                }
            }
        })
        .collect::<Vec<_>>();
    if !observed.is_empty()
        || reconciliation.len() != PROTECTED_REPLAY_BINDING_COUNT_V1
        || reconciliation
            .iter()
            .any(|atom| atom.status != ReconciliationStatusV2::Exact)
    {
        return Err(ProtectedReplayOwnerErrorV1::InvalidResult);
    }

    draft
        .diagnostic_evidence
        .sort_by_key(|value| value.category);
    if draft.diagnostic_evidence.is_empty()
        || draft
            .diagnostic_evidence
            .windows(2)
            .any(|pair| pair[0].category == pair[1].category)
        || draft.diagnostic_evidence.iter().any(|evidence| {
            evidence.request_identity != request.request_identity
                || evidence.request_digest != request.request_digest
                || evidence.attempt_identity != draft.attempt_identity
        })
        || draft.applicability_evidence.request_identity != request.request_identity
        || draft.applicability_evidence.request_digest != request.request_digest
        || draft.applicability_evidence.attempt_identity != draft.attempt_identity
        || draft.applicability_evidence.plan_cell_identity != basis.plan_cell_identity
    {
        return Err(ProtectedReplayOwnerErrorV1::InvalidResult);
    }
    let diagnostic_category_set = draft
        .diagnostic_evidence
        .iter()
        .map(|value| value.category)
        .collect::<Vec<_>>();
    let diagnostic_category_set_digest =
        protected_diagnostic_category_set_digest_v1(&diagnostic_category_set)
            .map_err(|_| ProtectedReplayOwnerErrorV1::InvalidResult)?;
    let result_time_evidence = result_time_evidence(&draft.time_successor);
    if draft.time_successor.predecessor_head_identity().as_bytes()
        != &request.request_time_evidence.head_identity
        || draft.time_successor.predecessor_head_digest().as_bytes()
            != &request.request_time_evidence.head_digest
    {
        return Err(ProtectedReplayOwnerErrorV1::InvalidResult);
    }
    result_time_evidence
        .validate_result_successor_of(&request.request_time_evidence)
        .map_err(|_| ProtectedReplayOwnerErrorV1::InvalidResult)?;
    let request_time_evidence_digest =
        protected_evaluation_time_evidence_digest_v1(&request.request_time_evidence)
            .map_err(|_| ProtectedReplayOwnerErrorV1::InvalidResult)?;
    let applicable_without_defect = draft.applicability_evidence.observation
        == ProtectedCellApplicabilityObservationV3::ApplicableInputsObserved
        && diagnostic_category_set == [DiagnosticCategoryV2::NoExecutionDefect];
    if applicable_without_defect != draft.protected_economic_measurement.is_some() {
        return Err(ProtectedReplayOwnerErrorV1::InvalidResult);
    }
    if let Some(measurement) = &draft.protected_economic_measurement {
        measurement
            .validate()
            .map_err(|_| ProtectedReplayOwnerErrorV1::InvalidResult)?;
        if measurement.measurement_identity != draft.protected_outcome.reference.as_str()
            || measurement.measurement_digest != draft.protected_outcome.digest.as_str()
            || measurement.request_identity != request.request_identity
            || measurement.request_digest != request.request_digest
            || measurement.attempt_identity != draft.attempt_identity
            || measurement.protected_plan_identity != basis.protected_plan_identity
            || measurement.protected_plan_digest != basis.protected_plan_digest
            || measurement.plan_cell_set_identity != basis.plan_cell_set_identity
            || measurement.plan_cell_set_digest != basis.plan_cell_set_digest
            || measurement.plan_cell_identity != basis.plan_cell_identity
            || measurement.plan_cell_digest != basis.plan_cell_digest
            || measurement.result_time_evidence_digest
                != protected_evaluation_time_evidence_digest_v1(&result_time_evidence)
                    .map_err(|_| ProtectedReplayOwnerErrorV1::InvalidResult)?
        {
            return Err(ProtectedReplayOwnerErrorV1::InvalidResult);
        }
    }
    let mut dto = ProtectedReplayResultDtoV3 {
        schema_version: 3,
        result_identity: "pending-result-identity".to_string(),
        result_digest: format!("blake3:{}", "0".repeat(64)),
        request_identity: request.request_identity.clone(),
        request_digest: request.request_digest.clone(),
        request_receipt_identity: draft.request_receipt_identity,
        request_seal_digest: draft.request_seal_digest,
        attempt_identity: draft.attempt_identity,
        terminal: ReplayTerminalV2::TerminalResult,
        protected_decision_policy_identity: basis.protected_decision_policy_identity.clone(),
        protected_decision_policy_version: basis.protected_decision_policy_version,
        protected_plan_identity: basis.protected_plan_identity.clone(),
        protected_plan_digest: basis.protected_plan_digest.clone(),
        plan_cell_set_identity: basis.plan_cell_set_identity.clone(),
        plan_cell_set_digest: basis.plan_cell_set_digest.clone(),
        plan_cell_identity: basis.plan_cell_identity.clone(),
        plan_cell_digest: basis.plan_cell_digest.clone(),
        reconciliation,
        diagnostic_category_set,
        diagnostic_category_set_digest,
        diagnostic_evidence: draft.diagnostic_evidence,
        applicability_evidence: draft.applicability_evidence,
        protected_outcome: draft.protected_outcome,
        protected_economic_measurement: draft.protected_economic_measurement,
        request_time_evidence_digest,
        result_time_evidence,
    };
    dto.result_digest = dto
        .compute_result_digest()
        .map_err(|_| ProtectedReplayOwnerErrorV1::InvalidResult)?;
    dto.result_identity = format!(
        "backtest-protected-replay-result-v3-{}",
        dto.result_digest
            .strip_prefix("blake3:")
            .ok_or(ProtectedReplayOwnerErrorV1::InvalidResult)?
    );
    dto.validate_against_request(
        request,
        &vibe_backtest_owner_contracts::ProtectedReplayRequestLocatorV1 {
            request_identity: request.request_identity.clone(),
            request_digest: request.request_digest.clone(),
            receipt_identity: dto.request_receipt_identity.clone(),
            seal_digest: dto.request_seal_digest.clone(),
        },
    )
    .map_err(|_| ProtectedReplayOwnerErrorV1::InvalidResult)?;
    Ok(SealedProtectedReplayResultV3(dto))
}

pub(crate) fn commit_protected_owner_result_proposal_v3(
    request: &ProtectedReplayRequestDtoV2,
    locator: &vibe_backtest_owner_contracts::ProtectedReplayRequestLocatorV1,
    proposal: ProtectedReplayResultProposalV3,
) -> Result<SealedProtectedReplayResultV3, ProtectedReplayOwnerErrorV1> {
    let observations = proposal
        .observations
        .into_iter()
        .map(|observation| ProtectedConsumedBindingObservationV1 {
            request_identity: request.request_identity.clone(),
            request_digest: request.request_digest.clone(),
            attempt_identity: proposal.attempt_identity.clone(),
            field: observation.field,
            consumed_identity: observation.consumed_identity,
            consumed_digest: observation.consumed_digest,
            evidence: observation.evidence,
        })
        .collect();
    commit_protected_owner_result_v3(
        request,
        ProtectedReplayResultDraftV3 {
            request_receipt_identity: locator.receipt_identity.clone(),
            request_seal_digest: locator.seal_digest.clone(),
            attempt_identity: proposal.attempt_identity,
            observations,
            diagnostic_evidence: proposal.diagnostic_evidence,
            applicability_evidence: proposal.applicability_evidence,
            protected_outcome: proposal.protected_outcome,
            protected_economic_measurement: proposal.protected_economic_measurement,
            time_successor: proposal.time_successor,
        },
    )
}

fn result_time_evidence(
    readback: &ClockHeadSuccessorReadback,
) -> ProtectedEvaluationTimeEvidenceV1 {
    let handoff = readback.handoff();
    ProtectedEvaluationTimeEvidenceV1 {
        cut_kind: "PROTECTED_EVALUATION".to_string(),
        stage: ProtectedEvaluationStageV1::Result,
        head_identity: *handoff.head_identity().as_bytes(),
        head_digest: *handoff.head_digest().as_bytes(),
        clock_identity: handoff.clock_identity().to_string(),
        clock_epoch: handoff.clock_epoch().to_string(),
        monotonic_sequence: handoff.monotonic_sequence(),
        wall_observed: handoff.wall_observed(),
        decision_cut: handoff.decision_cut(),
        valid_through: handoff.valid_through(),
        restart_continuity_digest: *handoff.restart_continuity_digest().as_bytes(),
        uncertainty_bound: handoff.uncertainty_bound(),
        skew_bound: handoff.skew_bound(),
        comparison_rule: match handoff.comparison_rule() {
            ClockHeadComparisonRule::ExclusiveValidThrough => {
                ProtectedEvaluationComparisonRuleV1::ExclusiveValidThrough
            }
        },
        direct_predecessor_head_identity: Some(*readback.predecessor_head_identity().as_bytes()),
        direct_predecessor_head_digest: Some(*readback.predecessor_head_digest().as_bytes()),
        epoch_successor_proof: readback.epoch_successor_proof().map(|proof| {
            ProtectedEvaluationEpochSuccessorProofV1 {
                proof_identity: *proof.proof_identity().as_bytes(),
                predecessor_head_digest: *proof.predecessor_head_digest().as_bytes(),
                successor_head_digest: *proof.successor_head_digest().as_bytes(),
                prior_clock_identity: proof.prior_clock_identity().to_string(),
                prior_clock_epoch: proof.prior_clock_epoch().to_string(),
                successor_clock_identity: proof.successor_clock_identity().to_string(),
                successor_clock_epoch: proof.successor_clock_epoch().to_string(),
                successor_continuity_digest: *proof.successor_continuity_digest().as_bytes(),
                commit_cut: proof.commit_cut(),
                comparison_rule: match proof.comparison_rule() {
                    ClockHeadComparisonRule::ExclusiveValidThrough => {
                        ProtectedEvaluationComparisonRuleV1::ExclusiveValidThrough
                    }
                },
            }
        }),
    }
}

#[cfg(test)]
pub(crate) fn test_observation(
    request: &ProtectedReplayRequestDtoV1,
    attempt_identity: &str,
    field: ProtectedReplayBindingFieldV1,
    exact: bool,
) -> ProtectedConsumedBindingObservationV1 {
    let binding = request
        .bindings
        .iter()
        .find(|binding| binding.field == field)
        .expect("fixture binding");
    ProtectedConsumedBindingObservationV1 {
        request_identity: request.request_identity.clone(),
        request_digest: request.request_digest.clone(),
        attempt_identity: attempt_identity.to_string(),
        field,
        consumed_identity: if exact {
            binding.identity.clone()
        } else {
            format!("{}-changed", binding.identity)
        },
        consumed_digest: if exact {
            binding.digest.clone()
        } else {
            format!("blake3:{}", "f".repeat(64))
        },
        evidence: ProtectedConsumedInputLocatorV1 {
            owner: OpaqueIdentityV2::try_from("backtest-owner".to_string()).expect("identity"),
            reference: OpaqueIdentityV2::try_from(format!("protected-observation-{field:?}"))
                .expect("reference"),
            digest: CanonicalDigestV2::try_from(format!("blake3:{}", "e".repeat(64)))
                .expect("digest"),
        },
    }
}
