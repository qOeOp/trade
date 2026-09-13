use std::cmp::Ordering;
use std::collections::BTreeMap;

use serde::Serialize;
use vibe_backtest_owner_contracts::{
    DiagnosticCategoryV2, ProtectedCellApplicabilityObservationV3,
    ProtectedEvaluationComparisonRuleV1, ProtectedEvaluationEpochSuccessorProofV1,
    ProtectedEvaluationStageV1, ProtectedEvaluationTimeEvidenceV1,
    ProtectedReplayAttemptFrontierDtoV1, ProtectedReplayRequestDtoV2,
    ProtectedReplayRequestLocatorV1, ProtectedReplayRequestSetSealDtoV1,
    ProtectedReplayResultDtoV3, protected_evaluation_time_evidence_digest_v1,
};
use vibe_data::owner::shared_time_evidence::{ClockHeadComparisonRule, ClockHeadSuccessorReadback};

use crate::QualificationOwnerError;
use crate::candidate_intake::{InstrumentScopeV1, ProtectedReplayAuthoritySourceV1};
use crate::postgres::{canonical_digest, identity};
use crate::protected_attempt_disposition::{
    HoldoutClosureDispositionV1, PreregisteredHoldoutTreatmentV1,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ProtectedAssessmentStatusV1 {
    IncompleteInvalid,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ProtectedCellAssessmentV1 {
    NotApplicableAccepted,
    NotApplicableRejected,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
struct ProtectedCellTerminalResultV1 {
    result_identity: String,
    result_digest: String,
    attempt_identity: String,
    applicability_evidence_reference: String,
    applicability_evidence_digest: String,
    result_time_evidence_digest: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
struct ProtectedCellCensusEntryV1 {
    plan_cell_identity: String,
    plan_cell_digest: String,
    request_identity: String,
    request_digest: String,
    terminal_results: Vec<ProtectedCellTerminalResultV1>,
    assessment: ProtectedCellAssessmentV1,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
struct ProtectedCensusFinalizationProofV1 {
    schema_version: u16,
    proof_identity: String,
    proof_digest: String,
    request_set_identity: String,
    request_set_digest: String,
    attempt_frontier_identity: String,
    attempt_frontier_digest: String,
    plan_cell_set_identity: String,
    plan_cell_set_digest: String,
    missing_cell_policy_identity: String,
    missing_cell_policy_digest: String,
    stop_policy_identity: String,
    stop_policy_digest: String,
    requested_cell_count: u32,
    terminal_result_count: u32,
    census_digest: String,
    result_time_evidence_digests: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ProtectedRobustnessAssessmentV1 {
    schema_version: u16,
    assessment_identity: String,
    assessment_digest: String,
    status: ProtectedAssessmentStatusV1,
    candidate_identity: String,
    candidate_digest: String,
    intake_receipt_identity: String,
    intake_receipt_digest: String,
    holdout_reservation_identity: String,
    protected_decision_policy_identity: String,
    protected_decision_policy_version: u64,
    protected_plan_identity: String,
    protected_plan_digest: String,
    plan_cell_set_identity: String,
    plan_cell_set_digest: String,
    census: Vec<ProtectedCellCensusEntryV1>,
    census_finalization_proof: ProtectedCensusFinalizationProofV1,
    assessment_time_evidence: ProtectedEvaluationTimeEvidenceV1,
    committed_at_epoch_ms: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ProtectedAssessmentInvalidDispositionV2 {
    schema_version: u16,
    disposition_identity: String,
    disposition_digest: String,
    status: &'static str,
    assessment_identity: String,
    assessment_digest: String,
    holdout_reservation_identity: String,
    holdout_closure_identity: String,
    holdout_closure_digest: String,
    holdout_closure_disposition: HoldoutClosureDispositionV1,
    holdout_treatment_policy_identity: String,
    holdout_treatment_policy_digest: String,
    committed_at_epoch_ms: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ProtectedAssessmentInvalidDispositionReceiptV2 {
    schema_version: u16,
    receipt_identity: String,
    receipt_digest: String,
    disposition_identity: String,
    disposition_digest: String,
    committed_at_epoch_ms: u64,
}

/// Qualification-owned atomic readback for an invalid complete protected assessment.
/// Its fields are intentionally serialize-only outside this crate.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ProtectedAssessmentInvalidCommitV1 {
    assessment: ProtectedRobustnessAssessmentV1,
    disposition: ProtectedAssessmentInvalidDispositionV2,
    receipt: ProtectedAssessmentInvalidDispositionReceiptV2,
}

impl ProtectedAssessmentInvalidCommitV1 {
    pub fn assessment_identity(&self) -> &str {
        &self.assessment.assessment_identity
    }

    pub fn disposition_identity(&self) -> &str {
        &self.disposition.disposition_identity
    }

    pub fn status(&self) -> ProtectedAssessmentStatusV1 {
        self.assessment.status
    }

    pub fn holdout_closure_disposition(&self) -> HoldoutClosureDispositionV1 {
        self.disposition.holdout_closure_disposition
    }

    pub(crate) fn assessment(&self) -> &ProtectedRobustnessAssessmentV1 {
        &self.assessment
    }

    pub(crate) fn disposition(&self) -> &ProtectedAssessmentInvalidDispositionV2 {
        &self.disposition
    }

    pub(crate) fn receipt(&self) -> &ProtectedAssessmentInvalidDispositionReceiptV2 {
        &self.receipt
    }
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn form_all_not_applicable_assessment_v1(
    request_set: &ProtectedReplayRequestSetSealDtoV1,
    frontier: &ProtectedReplayAttemptFrontierDtoV1,
    requests: &[ProtectedReplayRequestDtoV2],
    results: &[ProtectedReplayResultDtoV3],
    source: &ProtectedReplayAuthoritySourceV1,
    assessment_successor: &ClockHeadSuccessorReadback,
    holdout_treatment: &PreregisteredHoldoutTreatmentV1,
    committed_at_epoch_ms: u64,
) -> Result<ProtectedAssessmentInvalidCommitV1, QualificationOwnerError> {
    request_set.validate().map_err(contract)?;
    frontier
        .validate_against_request_set(request_set)
        .map_err(contract)?;
    if request_set.candidate_identity != source.candidate_identity
        || request_set.candidate_digest != source.candidate_digest
        || request_set.protected_plan_identity != source.plan_identity
        || request_set.protected_plan_digest != source.plan_digest
        || request_set.plan_cell_set_identity != source.plan_cell_set_identity
        || request_set.plan_cell_set_digest != source.plan_cell_set_digest
        || request_set.missing_cell_policy_identity != source.missing_cell_policy_identity
        || request_set.missing_cell_policy_digest != source.missing_cell_policy_digest
        || request_set.stop_policy_identity != source.stop_policy_identity
        || request_set.stop_policy_digest != source.stop_policy_digest
    {
        return Err(unavailable(
            "protected request set changed its frozen authority",
        ));
    }
    if requests.len() != request_set.members.len() || results.len() != frontier.members.len() {
        return Err(unavailable(
            "protected assessment source census is incomplete",
        ));
    }

    let requests_by_identity = requests
        .iter()
        .map(|request| (request.request_identity.as_str(), request))
        .collect::<BTreeMap<_, _>>();
    let results_by_identity = results
        .iter()
        .map(|result| (result.result_identity.as_str(), result))
        .collect::<BTreeMap<_, _>>();
    if requests_by_identity.len() != requests.len() || results_by_identity.len() != results.len() {
        return Err(unavailable(
            "protected assessment census contains duplicate identity",
        ));
    }

    let mut census = Vec::with_capacity(request_set.members.len());
    let mut latest_result_time: Option<&ProtectedEvaluationTimeEvidenceV1> = None;
    for member in &request_set.members {
        let request = requests_by_identity
            .get(member.request_identity.as_str())
            .ok_or_else(|| unavailable("protected assessment request is missing"))?;
        let frontier_members = frontier
            .members
            .iter()
            .filter(|candidate| candidate.request_identity == member.request_identity)
            .collect::<Vec<_>>();
        if frontier_members.is_empty() {
            return Err(unavailable(
                "protected assessment frontier member is missing",
            ));
        }
        let locator = ProtectedReplayRequestLocatorV1 {
            request_identity: member.request_identity.clone(),
            request_digest: member.request_digest.clone(),
            receipt_identity: member.request_receipt_identity.clone(),
            seal_digest: member.request_seal_digest.clone(),
        };
        let mut terminal_results = Vec::with_capacity(frontier_members.len());
        let mut every_basis_accepted = true;
        for frontier_member in frontier_members {
            let result = results_by_identity
                .get(frontier_member.result.result_identity.as_str())
                .ok_or_else(|| unavailable("protected assessment result is missing"))?;
            result
                .validate_against_request(request, &locator)
                .map_err(contract)?;
            let result_time_digest =
                protected_evaluation_time_evidence_digest_v1(&result.result_time_evidence)
                    .map_err(contract)?;
            if frontier_member.result.result_digest != result.result_digest
                || frontier_member.result_time_evidence_digest != result_time_digest
                || result.diagnostic_category_set.as_slice()
                    != [DiagnosticCategoryV2::NoExecutionDefect]
                || result.applicability_evidence.observation
                    != ProtectedCellApplicabilityObservationV3::PreResultNonApplicabilityBasisObserved
            {
                return Err(unavailable(
                    "protected result is not an assessment-ready non-applicable cell",
                ));
            }
            let accepted_basis = source.instrument_scope == InstrumentScopeV1::SingleInstrument
                && source
                    .instrument_non_applicability_basis
                    .as_ref()
                    .is_some_and(|(identity, digest)| {
                        result
                            .applicability_evidence
                            .decisive_evidence
                            .reference
                            .as_str()
                            == identity
                            && result
                                .applicability_evidence
                                .decisive_evidence
                                .digest
                                .as_str()
                                == digest
                    });
            every_basis_accepted &= accepted_basis;
            if let Some(latest) = latest_result_time {
                if result
                    .result_time_evidence
                    .compare_result_cut_within_epoch(latest)
                    .map_err(contract)?
                    == Ordering::Greater
                {
                    latest_result_time = Some(&result.result_time_evidence);
                }
            } else {
                latest_result_time = Some(&result.result_time_evidence);
            }
            terminal_results.push(ProtectedCellTerminalResultV1 {
                result_identity: result.result_identity.clone(),
                result_digest: result.result_digest.clone(),
                attempt_identity: result.attempt_identity.clone(),
                applicability_evidence_reference: result
                    .applicability_evidence
                    .decisive_evidence
                    .reference
                    .as_str()
                    .to_string(),
                applicability_evidence_digest: result
                    .applicability_evidence
                    .decisive_evidence
                    .digest
                    .as_str()
                    .to_string(),
                result_time_evidence_digest: result_time_digest,
            });
        }
        census.push(ProtectedCellCensusEntryV1 {
            plan_cell_identity: member.plan_cell_identity.clone(),
            plan_cell_digest: member.plan_cell_digest.clone(),
            request_identity: member.request_identity.clone(),
            request_digest: member.request_digest.clone(),
            terminal_results,
            assessment: if every_basis_accepted {
                ProtectedCellAssessmentV1::NotApplicableAccepted
            } else {
                ProtectedCellAssessmentV1::NotApplicableRejected
            },
        });
    }
    census.sort_by(|left, right| left.plan_cell_identity.cmp(&right.plan_cell_identity));
    let result_time = latest_result_time
        .ok_or_else(|| unavailable("protected assessment result time evidence is unavailable"))?;
    let assessment_time_evidence = assessment_time_evidence(assessment_successor);
    assessment_time_evidence
        .validate_assessment_successor_of(result_time)
        .map_err(contract)?;
    if committed_at_epoch_ms >= assessment_time_evidence.valid_through {
        return Err(unavailable(
            "protected assessment time evidence expired before commit",
        ));
    }

    let census_digest = canonical_digest("qualification.protected-cell-census.v1", &census)?;
    let result_time_evidence_digests = census
        .iter()
        .flat_map(|entry| entry.terminal_results.iter())
        .map(|result| result.result_time_evidence_digest.clone())
        .collect::<Vec<_>>();
    let proof_digest = canonical_digest(
        "qualification.protected-census-finalization-proof.v1",
        &(
            &request_set.request_set_identity,
            &request_set.request_set_digest,
            &frontier.frontier_identity,
            &frontier.frontier_digest,
            &request_set.plan_cell_set_identity,
            &request_set.plan_cell_set_digest,
            &request_set.missing_cell_policy_identity,
            &request_set.missing_cell_policy_digest,
            &request_set.stop_policy_identity,
            &request_set.stop_policy_digest,
            request_set.members.len(),
            frontier.members.len(),
            &census_digest,
            &result_time_evidence_digests,
        ),
    )?;
    let proof = ProtectedCensusFinalizationProofV1 {
        schema_version: 1,
        proof_identity: identity(
            "qualification-protected-census-finalization-proof-v1",
            &proof_digest,
        ),
        proof_digest,
        request_set_identity: request_set.request_set_identity.clone(),
        request_set_digest: request_set.request_set_digest.clone(),
        attempt_frontier_identity: frontier.frontier_identity.clone(),
        attempt_frontier_digest: frontier.frontier_digest.clone(),
        plan_cell_set_identity: request_set.plan_cell_set_identity.clone(),
        plan_cell_set_digest: request_set.plan_cell_set_digest.clone(),
        missing_cell_policy_identity: request_set.missing_cell_policy_identity.clone(),
        missing_cell_policy_digest: request_set.missing_cell_policy_digest.clone(),
        stop_policy_identity: request_set.stop_policy_identity.clone(),
        stop_policy_digest: request_set.stop_policy_digest.clone(),
        requested_cell_count: u32::try_from(request_set.members.len())
            .map_err(|_| unavailable("protected request census is unbounded"))?,
        terminal_result_count: u32::try_from(frontier.members.len())
            .map_err(|_| unavailable("protected result census is unbounded"))?,
        census_digest,
        result_time_evidence_digests,
    };
    let assessment_digest = canonical_digest(
        "qualification.protected-robustness-assessment.v1",
        &(
            ProtectedAssessmentStatusV1::IncompleteInvalid,
            &request_set.candidate_identity,
            &request_set.candidate_digest,
            &request_set.intake_receipt_identity,
            &request_set.intake_receipt_digest,
            &request_set.holdout_reservation_identity,
            &request_set.protected_decision_policy_identity,
            request_set.protected_decision_policy_version,
            &request_set.protected_plan_identity,
            &request_set.protected_plan_digest,
            &request_set.plan_cell_set_identity,
            &request_set.plan_cell_set_digest,
            &census,
            &proof,
            &assessment_time_evidence,
            committed_at_epoch_ms,
        ),
    )?;
    let assessment = ProtectedRobustnessAssessmentV1 {
        schema_version: 1,
        assessment_identity: identity(
            "qualification-protected-robustness-assessment-v1",
            &assessment_digest,
        ),
        assessment_digest,
        status: ProtectedAssessmentStatusV1::IncompleteInvalid,
        candidate_identity: request_set.candidate_identity.clone(),
        candidate_digest: request_set.candidate_digest.clone(),
        intake_receipt_identity: request_set.intake_receipt_identity.clone(),
        intake_receipt_digest: request_set.intake_receipt_digest.clone(),
        holdout_reservation_identity: request_set.holdout_reservation_identity.clone(),
        protected_decision_policy_identity: request_set.protected_decision_policy_identity.clone(),
        protected_decision_policy_version: request_set.protected_decision_policy_version,
        protected_plan_identity: request_set.protected_plan_identity.clone(),
        protected_plan_digest: request_set.protected_plan_digest.clone(),
        plan_cell_set_identity: request_set.plan_cell_set_identity.clone(),
        plan_cell_set_digest: request_set.plan_cell_set_digest.clone(),
        census,
        census_finalization_proof: proof,
        assessment_time_evidence,
        committed_at_epoch_ms,
    };
    form_invalid_disposition(assessment, holdout_treatment, committed_at_epoch_ms)
}

fn form_invalid_disposition(
    assessment: ProtectedRobustnessAssessmentV1,
    treatment: &PreregisteredHoldoutTreatmentV1,
    committed_at_epoch_ms: u64,
) -> Result<ProtectedAssessmentInvalidCommitV1, QualificationOwnerError> {
    let closure_digest = canonical_digest(
        "qualification.holdout-closure.v2",
        &(
            &assessment.holdout_reservation_identity,
            &assessment.assessment_identity,
            &assessment.assessment_digest,
            treatment.closure_disposition(),
            treatment.identity(),
            treatment.digest(),
            committed_at_epoch_ms,
        ),
    )?;
    let mut disposition = ProtectedAssessmentInvalidDispositionV2 {
        schema_version: 2,
        disposition_identity: String::new(),
        disposition_digest: String::new(),
        status: "ASSESSMENT_INVALID",
        assessment_identity: assessment.assessment_identity.clone(),
        assessment_digest: assessment.assessment_digest.clone(),
        holdout_reservation_identity: assessment.holdout_reservation_identity.clone(),
        holdout_closure_identity: identity("qualification-holdout-closure-v2", &closure_digest),
        holdout_closure_digest: closure_digest,
        holdout_closure_disposition: treatment.closure_disposition(),
        holdout_treatment_policy_identity: treatment.identity().to_string(),
        holdout_treatment_policy_digest: treatment.digest().to_string(),
        committed_at_epoch_ms,
    };
    disposition.disposition_digest = canonical_digest(
        "qualification.protected-attempt-disposition.v2",
        &(
            disposition.schema_version,
            disposition.status,
            &disposition.assessment_identity,
            &disposition.assessment_digest,
            &disposition.holdout_reservation_identity,
            &disposition.holdout_closure_identity,
            &disposition.holdout_closure_digest,
            disposition.holdout_closure_disposition,
            &disposition.holdout_treatment_policy_identity,
            &disposition.holdout_treatment_policy_digest,
            disposition.committed_at_epoch_ms,
        ),
    )?;
    disposition.disposition_identity = identity(
        "qualification-protected-attempt-disposition-v2",
        &disposition.disposition_digest,
    );
    let receipt_digest = canonical_digest(
        "qualification.protected-attempt-disposition-receipt.v2",
        &(
            &disposition.disposition_identity,
            &disposition.disposition_digest,
            committed_at_epoch_ms,
        ),
    )?;
    let receipt = ProtectedAssessmentInvalidDispositionReceiptV2 {
        schema_version: 2,
        receipt_identity: identity(
            "qualification-protected-attempt-disposition-receipt-v2",
            &receipt_digest,
        ),
        receipt_digest,
        disposition_identity: disposition.disposition_identity.clone(),
        disposition_digest: disposition.disposition_digest.clone(),
        committed_at_epoch_ms,
    };
    Ok(ProtectedAssessmentInvalidCommitV1 {
        assessment,
        disposition,
        receipt,
    })
}

fn assessment_time_evidence(
    readback: &ClockHeadSuccessorReadback,
) -> ProtectedEvaluationTimeEvidenceV1 {
    let handoff = readback.handoff();
    ProtectedEvaluationTimeEvidenceV1 {
        cut_kind: "PROTECTED_EVALUATION".to_string(),
        stage: ProtectedEvaluationStageV1::Assessment,
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
                comparison_rule: ProtectedEvaluationComparisonRuleV1::ExclusiveValidThrough,
            }
        }),
    }
}

impl ProtectedRobustnessAssessmentV1 {
    pub(crate) fn as_json(&self) -> Result<serde_json::Value, QualificationOwnerError> {
        serde_json::to_value(self).map_err(|error| unavailable(&error.to_string()))
    }

    pub(crate) fn assessment_identity(&self) -> &str {
        &self.assessment_identity
    }

    pub(crate) fn assessment_digest(&self) -> &str {
        &self.assessment_digest
    }

    pub(crate) fn request_set_identity(&self) -> &str {
        &self.census_finalization_proof.request_set_identity
    }

    pub(crate) fn attempt_frontier_identity(&self) -> &str {
        &self.census_finalization_proof.attempt_frontier_identity
    }

    pub(crate) fn holdout_reservation_identity(&self) -> &str {
        &self.holdout_reservation_identity
    }

    pub(crate) fn plan_cell_set_identity(&self) -> &str {
        &self.plan_cell_set_identity
    }

    pub(crate) fn plan_cell_set_digest(&self) -> &str {
        &self.plan_cell_set_digest
    }

    pub(crate) fn committed_at_epoch_ms(&self) -> u64 {
        self.committed_at_epoch_ms
    }
}

impl ProtectedAssessmentInvalidDispositionV2 {
    pub(crate) fn as_json(&self) -> Result<serde_json::Value, QualificationOwnerError> {
        serde_json::to_value(self).map_err(|error| unavailable(&error.to_string()))
    }

    pub(crate) fn disposition_identity(&self) -> &str {
        &self.disposition_identity
    }

    pub(crate) fn disposition_digest(&self) -> &str {
        &self.disposition_digest
    }

    pub(crate) fn assessment_identity(&self) -> &str {
        &self.assessment_identity
    }

    pub(crate) fn holdout_reservation_identity(&self) -> &str {
        &self.holdout_reservation_identity
    }

    pub(crate) fn holdout_closure_identity(&self) -> &str {
        &self.holdout_closure_identity
    }

    pub(crate) fn holdout_closure_digest(&self) -> &str {
        &self.holdout_closure_digest
    }

    pub(crate) fn holdout_closure_disposition(&self) -> HoldoutClosureDispositionV1 {
        self.holdout_closure_disposition
    }
}

impl ProtectedAssessmentInvalidDispositionReceiptV2 {
    pub(crate) fn as_json(&self) -> Result<serde_json::Value, QualificationOwnerError> {
        serde_json::to_value(self).map_err(|error| unavailable(&error.to_string()))
    }

    pub(crate) fn receipt_identity(&self) -> &str {
        &self.receipt_identity
    }

    pub(crate) fn receipt_digest(&self) -> &str {
        &self.receipt_digest
    }
}

#[allow(
    clippy::needless_pass_by_value,
    reason = "this exact map_err adapter consumes the contract error at each boundary"
)]
fn contract(
    error: vibe_backtest_owner_contracts::ProtectedReplayContractErrorV1,
) -> QualificationOwnerError {
    unavailable(&error.to_string())
}

fn unavailable(message: &str) -> QualificationOwnerError {
    QualificationOwnerError::Unavailable(message.to_string())
}
