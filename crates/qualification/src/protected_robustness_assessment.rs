use std::cmp::Ordering;
use std::collections::BTreeMap;

use serde::Serialize;
use vibe_backtest_owner_contracts::{
    DiagnosticCategoryV2, ProtectedCellApplicabilityObservationV3, ProtectedEconomicAggregationV1,
    ProtectedEconomicComparisonV1, ProtectedEconomicMeasurementV1, ProtectedEconomicPolicyBundleV1,
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
    CompleteFail,
    CompletePass,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ProtectedCellAssessmentV1 {
    Pass,
    Fail,
    NotApplicableAccepted,
    NotApplicableRejected,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ProtectedEligibilityStatusV1 {
    Ineligible,
    Qualified,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum ProtectedAssessmentModeV1 {
    AllNotApplicable,
    EconomicFailure,
    EconomicPass,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    economic_measurement_identity: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    economic_measurement_digest: Option<String>,
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
    economic_policy_bundle_identity: String,
    economic_policy_bundle_digest: String,
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
    economic_policy_bundle_identity: String,
    economic_policy_bundle_digest: String,
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

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ProtectedEligibilityFactV1 {
    schema_version: u16,
    eligibility_identity: String,
    eligibility_digest: String,
    status: ProtectedEligibilityStatusV1,
    candidate_identity: String,
    candidate_digest: String,
    intake_receipt_identity: String,
    intake_receipt_digest: String,
    assessment_identity: String,
    assessment_digest: String,
    request_set_identity: String,
    request_set_digest: String,
    attempt_frontier_identity: String,
    attempt_frontier_digest: String,
    protected_decision_policy_identity: String,
    protected_decision_policy_version: u64,
    protected_plan_identity: String,
    protected_plan_digest: String,
    plan_cell_set_identity: String,
    plan_cell_set_digest: String,
    census_digest: String,
    alternatives_thresholds_identity: String,
    alternatives_thresholds_digest: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    qualified_capacity_ceiling: Option<u64>,
    cost_model_identity: String,
    slippage_model_identity: String,
    capacity_model_identity: String,
    holdout_reservation_identity: String,
    holdout_reservation_digest: String,
    holdout_closure_identity: String,
    holdout_closure_digest: String,
    holdout_closure_disposition: HoldoutClosureDispositionV1,
    holdout_treatment_policy_identity: String,
    holdout_treatment_policy_digest: String,
    committed_at_epoch_ms: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ProtectedEligibilityFactReceiptV1 {
    schema_version: u16,
    receipt_identity: String,
    receipt_digest: String,
    eligibility_identity: String,
    eligibility_digest: String,
    committed_at_epoch_ms: u64,
}

/// Qualification-owned atomic readback for a complete failed protected assessment.
/// Its fields are serialize-only; callers cannot author an `INELIGIBLE` fact.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ProtectedIneligibleCommitV1 {
    assessment: ProtectedRobustnessAssessmentV1,
    eligibility: ProtectedEligibilityFactV1,
    receipt: ProtectedEligibilityFactReceiptV1,
}

/// Qualification-owned atomic readback for a complete passing protected assessment.
/// Its fields are serialize-only; callers cannot author a `QUALIFIED` fact.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ProtectedQualifiedCommitV1 {
    assessment: ProtectedRobustnessAssessmentV1,
    eligibility: ProtectedEligibilityFactV1,
    receipt: ProtectedEligibilityFactReceiptV1,
}

impl ProtectedIneligibleCommitV1 {
    pub fn assessment_identity(&self) -> &str {
        &self.assessment.assessment_identity
    }

    pub fn eligibility_identity(&self) -> &str {
        &self.eligibility.eligibility_identity
    }

    pub const fn status(&self) -> ProtectedEligibilityStatusV1 {
        self.eligibility.status
    }

    pub const fn assessment_status(&self) -> ProtectedAssessmentStatusV1 {
        self.assessment.status
    }

    pub(crate) fn assessment(&self) -> &ProtectedRobustnessAssessmentV1 {
        &self.assessment
    }

    pub(crate) fn eligibility(&self) -> &ProtectedEligibilityFactV1 {
        &self.eligibility
    }

    pub(crate) fn receipt(&self) -> &ProtectedEligibilityFactReceiptV1 {
        &self.receipt
    }
}

impl ProtectedQualifiedCommitV1 {
    pub fn assessment_identity(&self) -> &str {
        &self.assessment.assessment_identity
    }

    pub fn eligibility_identity(&self) -> &str {
        &self.eligibility.eligibility_identity
    }

    pub const fn status(&self) -> ProtectedEligibilityStatusV1 {
        self.eligibility.status
    }

    pub const fn assessment_status(&self) -> ProtectedAssessmentStatusV1 {
        self.assessment.status
    }

    pub const fn qualified_capacity_ceiling(&self) -> Option<u64> {
        self.eligibility.qualified_capacity_ceiling
    }

    pub(crate) fn assessment(&self) -> &ProtectedRobustnessAssessmentV1 {
        &self.assessment
    }

    pub(crate) fn eligibility(&self) -> &ProtectedEligibilityFactV1 {
        &self.eligibility
    }

    pub(crate) fn receipt(&self) -> &ProtectedEligibilityFactReceiptV1 {
        &self.receipt
    }
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
    economic_policy: &ProtectedEconomicPolicyBundleV1,
    assessment_successor: &ClockHeadSuccessorReadback,
    holdout_treatment: &PreregisteredHoldoutTreatmentV1,
    committed_at_epoch_ms: u64,
) -> Result<ProtectedAssessmentInvalidCommitV1, QualificationOwnerError> {
    let assessment = form_assessment_v1(
        request_set,
        frontier,
        requests,
        results,
        source,
        economic_policy,
        assessment_successor,
        committed_at_epoch_ms,
        ProtectedAssessmentModeV1::AllNotApplicable,
    )?;
    form_invalid_disposition(assessment, holdout_treatment, committed_at_epoch_ms)
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn form_economic_failure_assessment_v1(
    request_set: &ProtectedReplayRequestSetSealDtoV1,
    frontier: &ProtectedReplayAttemptFrontierDtoV1,
    requests: &[ProtectedReplayRequestDtoV2],
    results: &[ProtectedReplayResultDtoV3],
    source: &ProtectedReplayAuthoritySourceV1,
    economic_policy: &ProtectedEconomicPolicyBundleV1,
    assessment_successor: &ClockHeadSuccessorReadback,
    holdout_treatment: &PreregisteredHoldoutTreatmentV1,
    committed_at_epoch_ms: u64,
) -> Result<ProtectedIneligibleCommitV1, QualificationOwnerError> {
    let assessment = form_assessment_v1(
        request_set,
        frontier,
        requests,
        results,
        source,
        economic_policy,
        assessment_successor,
        committed_at_epoch_ms,
        ProtectedAssessmentModeV1::EconomicFailure,
    )?;
    form_ineligible_fact(
        assessment,
        request_set,
        frontier,
        source,
        holdout_treatment,
        committed_at_epoch_ms,
    )
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn form_economic_pass_assessment_v1(
    request_set: &ProtectedReplayRequestSetSealDtoV1,
    frontier: &ProtectedReplayAttemptFrontierDtoV1,
    requests: &[ProtectedReplayRequestDtoV2],
    results: &[ProtectedReplayResultDtoV3],
    source: &ProtectedReplayAuthoritySourceV1,
    economic_policy: &ProtectedEconomicPolicyBundleV1,
    assessment_successor: &ClockHeadSuccessorReadback,
    holdout_treatment: &PreregisteredHoldoutTreatmentV1,
    committed_at_epoch_ms: u64,
) -> Result<ProtectedQualifiedCommitV1, QualificationOwnerError> {
    let assessment = form_assessment_v1(
        request_set,
        frontier,
        requests,
        results,
        source,
        economic_policy,
        assessment_successor,
        committed_at_epoch_ms,
        ProtectedAssessmentModeV1::EconomicPass,
    )?;
    form_qualified_fact(
        assessment,
        request_set,
        frontier,
        source,
        holdout_treatment,
        committed_at_epoch_ms,
    )
}

#[allow(clippy::too_many_arguments)]
fn form_assessment_v1(
    request_set: &ProtectedReplayRequestSetSealDtoV1,
    frontier: &ProtectedReplayAttemptFrontierDtoV1,
    requests: &[ProtectedReplayRequestDtoV2],
    results: &[ProtectedReplayResultDtoV3],
    source: &ProtectedReplayAuthoritySourceV1,
    economic_policy: &ProtectedEconomicPolicyBundleV1,
    assessment_successor: &ClockHeadSuccessorReadback,
    committed_at_epoch_ms: u64,
    mode: ProtectedAssessmentModeV1,
) -> Result<ProtectedRobustnessAssessmentV1, QualificationOwnerError> {
    request_set.validate().map_err(contract)?;
    validate_economic_policy_bundle(economic_policy, request_set, source)?;
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
    let mut result_times = Vec::with_capacity(results.len());
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
        if !valid_terminal_result_count(mode, frontier_members.len()) {
            return Err(unavailable(
                "protected economic assessment contains duplicate cell attempts",
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
        let mut cell_has_applicable = false;
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
            let economic_pass = if mode == ProtectedAssessmentModeV1::EconomicPass
                && result.applicability_evidence.observation
                    == ProtectedCellApplicabilityObservationV3::ApplicableInputsObserved
            {
                Some(economic_measurement_pass(
                    economic_policy,
                    result
                        .protected_economic_measurement
                        .as_ref()
                        .ok_or_else(|| unavailable("protected economic measurement is missing"))?,
                )?)
            } else {
                None
            };
            let assessment_ready = assessment_ready_cell(
                mode,
                &result.diagnostic_category_set,
                result.applicability_evidence.observation,
                economic_pass,
            );
            if frontier_member.result.result_digest != result.result_digest
                || frontier_member.result_time_evidence_digest != result_time_digest
                || !assessment_ready
            {
                return Err(unavailable(
                    "protected result is not ready for the requested assessment",
                ));
            }
            let accepted_basis = matches!(mode, ProtectedAssessmentModeV1::EconomicFailure)
                || (matches!(mode, ProtectedAssessmentModeV1::EconomicPass)
                    && result.applicability_evidence.observation
                        == ProtectedCellApplicabilityObservationV3::ApplicableInputsObserved)
                || (source.instrument_scope == InstrumentScopeV1::SingleInstrument
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
                        }));
            cell_has_applicable |= result.applicability_evidence.observation
                == ProtectedCellApplicabilityObservationV3::ApplicableInputsObserved;
            every_basis_accepted &= accepted_basis;
            result_times.push(&result.result_time_evidence);
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
                economic_measurement_identity: result
                    .protected_economic_measurement
                    .as_ref()
                    .map(|measurement| measurement.measurement_identity.clone()),
                economic_measurement_digest: result
                    .protected_economic_measurement
                    .as_ref()
                    .map(|measurement| measurement.measurement_digest.clone()),
            });
        }
        census.push(ProtectedCellCensusEntryV1 {
            plan_cell_identity: member.plan_cell_identity.clone(),
            plan_cell_digest: member.plan_cell_digest.clone(),
            request_identity: member.request_identity.clone(),
            request_digest: member.request_digest.clone(),
            terminal_results,
            assessment: match mode {
                ProtectedAssessmentModeV1::EconomicFailure => ProtectedCellAssessmentV1::Fail,
                ProtectedAssessmentModeV1::EconomicPass if cell_has_applicable => {
                    ProtectedCellAssessmentV1::Pass
                }
                ProtectedAssessmentModeV1::EconomicPass if every_basis_accepted => {
                    ProtectedCellAssessmentV1::NotApplicableAccepted
                }
                ProtectedAssessmentModeV1::EconomicPass => {
                    ProtectedCellAssessmentV1::NotApplicableRejected
                }
                ProtectedAssessmentModeV1::AllNotApplicable if every_basis_accepted => {
                    ProtectedCellAssessmentV1::NotApplicableAccepted
                }
                ProtectedAssessmentModeV1::AllNotApplicable => {
                    ProtectedCellAssessmentV1::NotApplicableRejected
                }
            },
        });
    }
    census.sort_by(|left, right| left.plan_cell_identity.cmp(&right.plan_cell_identity));
    if matches!(mode, ProtectedAssessmentModeV1::EconomicPass)
        && (!census
            .iter()
            .any(|entry| entry.assessment == ProtectedCellAssessmentV1::Pass)
            || census
                .iter()
                .any(|entry| entry.assessment == ProtectedCellAssessmentV1::NotApplicableRejected))
    {
        return Err(unavailable(
            "protected assessment is not a complete passing census",
        ));
    }
    let result_time = latest_fresh_comparable_result_time(&result_times, committed_at_epoch_ms)?;
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
            &economic_policy.bundle_identity,
            &economic_policy.bundle_digest,
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
        economic_policy_bundle_identity: economic_policy.bundle_identity.clone(),
        economic_policy_bundle_digest: economic_policy.bundle_digest.clone(),
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
    let status = match mode {
        ProtectedAssessmentModeV1::AllNotApplicable => {
            ProtectedAssessmentStatusV1::IncompleteInvalid
        }
        ProtectedAssessmentModeV1::EconomicFailure => ProtectedAssessmentStatusV1::CompleteFail,
        ProtectedAssessmentModeV1::EconomicPass => ProtectedAssessmentStatusV1::CompletePass,
    };
    let assessment_digest = canonical_digest(
        "qualification.protected-robustness-assessment.v1",
        &(
            status,
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
        status,
        candidate_identity: request_set.candidate_identity.clone(),
        candidate_digest: request_set.candidate_digest.clone(),
        intake_receipt_identity: request_set.intake_receipt_identity.clone(),
        intake_receipt_digest: request_set.intake_receipt_digest.clone(),
        holdout_reservation_identity: request_set.holdout_reservation_identity.clone(),
        protected_decision_policy_identity: request_set.protected_decision_policy_identity.clone(),
        protected_decision_policy_version: request_set.protected_decision_policy_version,
        economic_policy_bundle_identity: economic_policy.bundle_identity.clone(),
        economic_policy_bundle_digest: economic_policy.bundle_digest.clone(),
        protected_plan_identity: request_set.protected_plan_identity.clone(),
        protected_plan_digest: request_set.protected_plan_digest.clone(),
        plan_cell_set_identity: request_set.plan_cell_set_identity.clone(),
        plan_cell_set_digest: request_set.plan_cell_set_digest.clone(),
        census,
        census_finalization_proof: proof,
        assessment_time_evidence,
        committed_at_epoch_ms,
    };
    Ok(assessment)
}

fn valid_terminal_result_count(mode: ProtectedAssessmentModeV1, count: usize) -> bool {
    count > 0
        && (!matches!(
            mode,
            ProtectedAssessmentModeV1::EconomicFailure | ProtectedAssessmentModeV1::EconomicPass
        ) || count == 1)
}

fn assessment_ready_cell(
    mode: ProtectedAssessmentModeV1,
    diagnostic_categories: &[DiagnosticCategoryV2],
    applicability: ProtectedCellApplicabilityObservationV3,
    economic_pass: Option<bool>,
) -> bool {
    match mode {
        ProtectedAssessmentModeV1::AllNotApplicable => diagnostic_categories
            == [DiagnosticCategoryV2::NoExecutionDefect]
            && applicability
                == ProtectedCellApplicabilityObservationV3::PreResultNonApplicabilityBasisObserved,
        ProtectedAssessmentModeV1::EconomicFailure => {
            diagnostic_categories == [DiagnosticCategoryV2::ValidEconomicFailure]
                && applicability
                    == ProtectedCellApplicabilityObservationV3::ApplicableInputsObserved
        }
        ProtectedAssessmentModeV1::EconomicPass => diagnostic_categories
            == [DiagnosticCategoryV2::NoExecutionDefect]
            && (applicability
                == ProtectedCellApplicabilityObservationV3::PreResultNonApplicabilityBasisObserved
                || (applicability
                    == ProtectedCellApplicabilityObservationV3::ApplicableInputsObserved
                    && economic_pass == Some(true))),
    }
}

pub(crate) fn validate_economic_policy_bundle(
    policy: &ProtectedEconomicPolicyBundleV1,
    request_set: &ProtectedReplayRequestSetSealDtoV1,
    source: &ProtectedReplayAuthoritySourceV1,
) -> Result<(), QualificationOwnerError> {
    policy.validate().map_err(contract)?;
    if policy.protected_decision_policy_identity != request_set.protected_decision_policy_identity
        || policy.protected_decision_policy_version != request_set.protected_decision_policy_version
        || policy.protected_decision_policy_identity != source.protected_decision_policy_identity
        || policy.protected_decision_policy_version != source.protected_decision_policy_version
        || policy.metric.identity != source.metric_policy_identity
        || policy.metric.digest != source.metric_policy_digest
        || policy.coverage_policy.identity != source.coverage_policy_identity
        || policy.coverage_policy.digest != source.coverage_policy_digest
        || policy.tolerance_policy.identity != source.tolerance_policy_identity
        || policy.tolerance_policy.digest != source.tolerance_policy_digest
        || policy.threshold_policy.identity != source.threshold_policy_identity
        || policy.threshold_policy.digest != source.threshold_policy_digest
        || policy.aggregation_policy.identity != source.aggregation_policy_identity
        || policy.aggregation_policy.digest != source.aggregation_policy_digest
    {
        return Err(unavailable(
            "protected economic policy changed its frozen authority",
        ));
    }
    Ok(())
}

fn economic_measurement_pass(
    policy: &ProtectedEconomicPolicyBundleV1,
    measurement: &ProtectedEconomicMeasurementV1,
) -> Result<bool, QualificationOwnerError> {
    policy.validate().map_err(contract)?;
    measurement.validate().map_err(contract)?;
    if policy.aggregation != ProtectedEconomicAggregationV1::EveryApplicableCell
        || measurement.metric_identity != policy.metric.identity
        || measurement.metric_digest != policy.metric.digest
        || measurement.unit != policy.unit
        || measurement.decimal_scale != policy.decimal_scale
    {
        return Err(unavailable(
            "protected economic measurement changed the frozen policy",
        ));
    }
    if measurement.observed_coverage_bps < policy.minimum_coverage_bps {
        return Ok(false);
    }
    let observed = i128::from(measurement.observed_raw);
    let threshold = i128::from(policy.threshold_raw);
    let tolerance = i128::from(policy.tolerance_raw);
    Ok(match policy.comparison {
        ProtectedEconomicComparisonV1::GreaterThanOrEqual => observed + tolerance >= threshold,
        ProtectedEconomicComparisonV1::LessThanOrEqual => observed - tolerance <= threshold,
    })
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

fn form_ineligible_fact(
    assessment: ProtectedRobustnessAssessmentV1,
    request_set: &ProtectedReplayRequestSetSealDtoV1,
    frontier: &ProtectedReplayAttemptFrontierDtoV1,
    source: &ProtectedReplayAuthoritySourceV1,
    treatment: &PreregisteredHoldoutTreatmentV1,
    committed_at_epoch_ms: u64,
) -> Result<ProtectedIneligibleCommitV1, QualificationOwnerError> {
    let closure_digest = canonical_digest(
        "qualification.eligibility-holdout-closure.v1",
        &(
            &assessment.holdout_reservation_identity,
            &assessment.assessment_identity,
            &assessment.assessment_digest,
            ProtectedEligibilityStatusV1::Ineligible,
            treatment.closure_disposition(),
            treatment.identity(),
            treatment.digest(),
            committed_at_epoch_ms,
        ),
    )?;
    let holdout_closure_identity = identity(
        "qualification-eligibility-holdout-closure-v1",
        &closure_digest,
    );
    let mut eligibility = ProtectedEligibilityFactV1 {
        schema_version: 1,
        eligibility_identity: String::new(),
        eligibility_digest: String::new(),
        status: ProtectedEligibilityStatusV1::Ineligible,
        candidate_identity: assessment.candidate_identity.clone(),
        candidate_digest: assessment.candidate_digest.clone(),
        intake_receipt_identity: assessment.intake_receipt_identity.clone(),
        intake_receipt_digest: assessment.intake_receipt_digest.clone(),
        assessment_identity: assessment.assessment_identity.clone(),
        assessment_digest: assessment.assessment_digest.clone(),
        request_set_identity: request_set.request_set_identity.clone(),
        request_set_digest: request_set.request_set_digest.clone(),
        attempt_frontier_identity: frontier.frontier_identity.clone(),
        attempt_frontier_digest: frontier.frontier_digest.clone(),
        protected_decision_policy_identity: assessment.protected_decision_policy_identity.clone(),
        protected_decision_policy_version: assessment.protected_decision_policy_version,
        protected_plan_identity: assessment.protected_plan_identity.clone(),
        protected_plan_digest: assessment.protected_plan_digest.clone(),
        plan_cell_set_identity: assessment.plan_cell_set_identity.clone(),
        plan_cell_set_digest: assessment.plan_cell_set_digest.clone(),
        census_digest: assessment.census_finalization_proof.census_digest.clone(),
        alternatives_thresholds_identity: source.alternatives_thresholds_identity.clone(),
        alternatives_thresholds_digest: source.alternatives_thresholds_digest.clone(),
        qualified_capacity_ceiling: None,
        cost_model_identity: source.cost_model_identity.clone(),
        slippage_model_identity: source.slippage_model_identity.clone(),
        capacity_model_identity: source.capacity_model_identity.clone(),
        holdout_reservation_identity: assessment.holdout_reservation_identity.clone(),
        holdout_reservation_digest: source.holdout_reservation_digest.clone(),
        holdout_closure_identity,
        holdout_closure_digest: closure_digest,
        holdout_closure_disposition: treatment.closure_disposition(),
        holdout_treatment_policy_identity: treatment.identity().to_string(),
        holdout_treatment_policy_digest: treatment.digest().to_string(),
        committed_at_epoch_ms,
    };
    eligibility.eligibility_digest = canonical_digest(
        "qualification.protected-eligibility-fact.v1",
        &(
            (eligibility.schema_version, eligibility.status),
            (
                &eligibility.candidate_identity,
                &eligibility.candidate_digest,
                &eligibility.intake_receipt_identity,
                &eligibility.intake_receipt_digest,
            ),
            (
                &eligibility.assessment_identity,
                &eligibility.assessment_digest,
                &eligibility.request_set_identity,
                &eligibility.request_set_digest,
                &eligibility.attempt_frontier_identity,
                &eligibility.attempt_frontier_digest,
            ),
            (
                &eligibility.protected_decision_policy_identity,
                eligibility.protected_decision_policy_version,
                &eligibility.protected_plan_identity,
                &eligibility.protected_plan_digest,
                &eligibility.plan_cell_set_identity,
                &eligibility.plan_cell_set_digest,
                &eligibility.census_digest,
            ),
            (
                &eligibility.alternatives_thresholds_identity,
                &eligibility.alternatives_thresholds_digest,
                &eligibility.cost_model_identity,
                &eligibility.slippage_model_identity,
                &eligibility.capacity_model_identity,
            ),
            (
                &eligibility.holdout_reservation_identity,
                &eligibility.holdout_reservation_digest,
                &eligibility.holdout_closure_identity,
                &eligibility.holdout_closure_digest,
                eligibility.holdout_closure_disposition,
                &eligibility.holdout_treatment_policy_identity,
                &eligibility.holdout_treatment_policy_digest,
            ),
            eligibility.committed_at_epoch_ms,
        ),
    )?;
    eligibility.eligibility_identity = identity(
        "qualification-protected-eligibility-fact-v1",
        &eligibility.eligibility_digest,
    );
    let receipt_digest = canonical_digest(
        "qualification.protected-eligibility-fact-receipt.v1",
        &(
            &eligibility.eligibility_identity,
            &eligibility.eligibility_digest,
            committed_at_epoch_ms,
        ),
    )?;
    let receipt = ProtectedEligibilityFactReceiptV1 {
        schema_version: 1,
        receipt_identity: identity(
            "qualification-protected-eligibility-fact-receipt-v1",
            &receipt_digest,
        ),
        receipt_digest,
        eligibility_identity: eligibility.eligibility_identity.clone(),
        eligibility_digest: eligibility.eligibility_digest.clone(),
        committed_at_epoch_ms,
    };
    Ok(ProtectedIneligibleCommitV1 {
        assessment,
        eligibility,
        receipt,
    })
}

fn form_qualified_fact(
    assessment: ProtectedRobustnessAssessmentV1,
    request_set: &ProtectedReplayRequestSetSealDtoV1,
    frontier: &ProtectedReplayAttemptFrontierDtoV1,
    source: &ProtectedReplayAuthoritySourceV1,
    treatment: &PreregisteredHoldoutTreatmentV1,
    committed_at_epoch_ms: u64,
) -> Result<ProtectedQualifiedCommitV1, QualificationOwnerError> {
    let closure_digest = canonical_digest(
        "qualification.eligibility-holdout-closure.v1",
        &(
            &assessment.holdout_reservation_identity,
            &assessment.assessment_identity,
            &assessment.assessment_digest,
            ProtectedEligibilityStatusV1::Qualified,
            treatment.closure_disposition(),
            treatment.identity(),
            treatment.digest(),
            committed_at_epoch_ms,
        ),
    )?;
    let holdout_closure_identity = identity(
        "qualification-eligibility-holdout-closure-v1",
        &closure_digest,
    );
    let mut eligibility = ProtectedEligibilityFactV1 {
        schema_version: 1,
        eligibility_identity: String::new(),
        eligibility_digest: String::new(),
        status: ProtectedEligibilityStatusV1::Qualified,
        candidate_identity: assessment.candidate_identity.clone(),
        candidate_digest: assessment.candidate_digest.clone(),
        intake_receipt_identity: assessment.intake_receipt_identity.clone(),
        intake_receipt_digest: assessment.intake_receipt_digest.clone(),
        assessment_identity: assessment.assessment_identity.clone(),
        assessment_digest: assessment.assessment_digest.clone(),
        request_set_identity: request_set.request_set_identity.clone(),
        request_set_digest: request_set.request_set_digest.clone(),
        attempt_frontier_identity: frontier.frontier_identity.clone(),
        attempt_frontier_digest: frontier.frontier_digest.clone(),
        protected_decision_policy_identity: assessment.protected_decision_policy_identity.clone(),
        protected_decision_policy_version: assessment.protected_decision_policy_version,
        protected_plan_identity: assessment.protected_plan_identity.clone(),
        protected_plan_digest: assessment.protected_plan_digest.clone(),
        plan_cell_set_identity: assessment.plan_cell_set_identity.clone(),
        plan_cell_set_digest: assessment.plan_cell_set_digest.clone(),
        census_digest: assessment.census_finalization_proof.census_digest.clone(),
        alternatives_thresholds_identity: source.alternatives_thresholds_identity.clone(),
        alternatives_thresholds_digest: source.alternatives_thresholds_digest.clone(),
        qualified_capacity_ceiling: Some(source.preregistered_capacity_ceiling),
        cost_model_identity: source.cost_model_identity.clone(),
        slippage_model_identity: source.slippage_model_identity.clone(),
        capacity_model_identity: source.capacity_model_identity.clone(),
        holdout_reservation_identity: assessment.holdout_reservation_identity.clone(),
        holdout_reservation_digest: source.holdout_reservation_digest.clone(),
        holdout_closure_identity,
        holdout_closure_digest: closure_digest,
        holdout_closure_disposition: treatment.closure_disposition(),
        holdout_treatment_policy_identity: treatment.identity().to_string(),
        holdout_treatment_policy_digest: treatment.digest().to_string(),
        committed_at_epoch_ms,
    };
    eligibility.eligibility_digest = canonical_digest(
        "qualification.protected-eligibility-fact.v1",
        &(
            (eligibility.schema_version, eligibility.status),
            (
                &eligibility.candidate_identity,
                &eligibility.candidate_digest,
                &eligibility.intake_receipt_identity,
                &eligibility.intake_receipt_digest,
            ),
            (
                &eligibility.assessment_identity,
                &eligibility.assessment_digest,
                &eligibility.request_set_identity,
                &eligibility.request_set_digest,
                &eligibility.attempt_frontier_identity,
                &eligibility.attempt_frontier_digest,
            ),
            (
                &eligibility.protected_decision_policy_identity,
                eligibility.protected_decision_policy_version,
                &eligibility.protected_plan_identity,
                &eligibility.protected_plan_digest,
                &eligibility.plan_cell_set_identity,
                &eligibility.plan_cell_set_digest,
                &eligibility.census_digest,
            ),
            (
                &eligibility.alternatives_thresholds_identity,
                &eligibility.alternatives_thresholds_digest,
                eligibility.qualified_capacity_ceiling,
                &eligibility.cost_model_identity,
                &eligibility.slippage_model_identity,
                &eligibility.capacity_model_identity,
            ),
            (
                &eligibility.holdout_reservation_identity,
                &eligibility.holdout_reservation_digest,
                &eligibility.holdout_closure_identity,
                &eligibility.holdout_closure_digest,
                eligibility.holdout_closure_disposition,
                &eligibility.holdout_treatment_policy_identity,
                &eligibility.holdout_treatment_policy_digest,
            ),
            eligibility.committed_at_epoch_ms,
        ),
    )?;
    eligibility.eligibility_identity = identity(
        "qualification-protected-eligibility-fact-v1",
        &eligibility.eligibility_digest,
    );
    let receipt_digest = canonical_digest(
        "qualification.protected-eligibility-fact-receipt.v1",
        &(
            &eligibility.eligibility_identity,
            &eligibility.eligibility_digest,
            committed_at_epoch_ms,
        ),
    )?;
    let receipt = ProtectedEligibilityFactReceiptV1 {
        schema_version: 1,
        receipt_identity: identity(
            "qualification-protected-eligibility-fact-receipt-v1",
            &receipt_digest,
        ),
        receipt_digest,
        eligibility_identity: eligibility.eligibility_identity.clone(),
        eligibility_digest: eligibility.eligibility_digest.clone(),
        committed_at_epoch_ms,
    };
    Ok(ProtectedQualifiedCommitV1 {
        assessment,
        eligibility,
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

fn latest_fresh_comparable_result_time<'a>(
    result_times: &[&'a ProtectedEvaluationTimeEvidenceV1],
    committed_at_epoch_ms: u64,
) -> Result<&'a ProtectedEvaluationTimeEvidenceV1, QualificationOwnerError> {
    let mut by_sequence = BTreeMap::new();
    for result_time in result_times {
        if committed_at_epoch_ms >= result_time.valid_through {
            return Err(unavailable(
                "protected result time evidence expired before assessment commit",
            ));
        }
        if let Some(existing) = by_sequence.insert(result_time.monotonic_sequence, *result_time)
            && existing != *result_time
        {
            return Err(unavailable(
                "protected result time evidence conflicts at one clock sequence",
            ));
        }
    }

    let mut ordered = by_sequence.values();
    let mut latest = *ordered
        .next()
        .ok_or_else(|| unavailable("protected assessment result time evidence is unavailable"))?;
    for current in ordered {
        if current
            .compare_result_cut_within_epoch(latest)
            .map_err(contract)?
            != Ordering::Greater
        {
            return Err(unavailable(
                "protected result time evidence is not one ordered assessment epoch",
            ));
        }
        latest = current;
    }
    Ok(latest)
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

    pub(crate) fn candidate_identity(&self) -> &str {
        &self.candidate_identity
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

impl ProtectedEligibilityFactV1 {
    pub(crate) fn as_json(&self) -> Result<serde_json::Value, QualificationOwnerError> {
        serde_json::to_value(self).map_err(|error| unavailable(&error.to_string()))
    }

    pub(crate) fn eligibility_identity(&self) -> &str {
        &self.eligibility_identity
    }

    pub(crate) fn eligibility_digest(&self) -> &str {
        &self.eligibility_digest
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

    pub(crate) const fn holdout_closure_disposition(&self) -> HoldoutClosureDispositionV1 {
        self.holdout_closure_disposition
    }

    pub(crate) const fn committed_at_epoch_ms(&self) -> u64 {
        self.committed_at_epoch_ms
    }
}

impl ProtectedEligibilityFactReceiptV1 {
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

#[cfg(test)]
mod tests {
    use super::*;
    use vibe_backtest_owner_contracts::{
        CanonicalDigestV2, OpaqueIdentityV2, ProtectedConsumedInputLocatorV1,
        ProtectedEconomicPolicyReferenceV1,
    };

    fn result_time(
        sequence: u64,
        observed: u64,
        valid_through: u64,
        head: u8,
    ) -> ProtectedEvaluationTimeEvidenceV1 {
        ProtectedEvaluationTimeEvidenceV1 {
            cut_kind: "PROTECTED_EVALUATION".into(),
            stage: ProtectedEvaluationStageV1::Result,
            head_identity: [head; 32],
            head_digest: [head.saturating_add(1); 32],
            clock_identity: "clock-identity".into(),
            clock_epoch: "clock-epoch".into(),
            monotonic_sequence: sequence,
            wall_observed: observed,
            decision_cut: observed,
            valid_through,
            restart_continuity_digest: [3; 32],
            uncertainty_bound: 1,
            skew_bound: 2,
            comparison_rule: ProtectedEvaluationComparisonRuleV1::ExclusiveValidThrough,
            direct_predecessor_head_identity: Some([head.saturating_sub(2); 32]),
            direct_predecessor_head_digest: Some([head.saturating_sub(1); 32]),
            epoch_successor_proof: None,
        }
    }

    #[test]
    fn complete_result_time_census_rejects_expiry_and_hidden_sequence_conflict() {
        let first = result_time(2, 1_010, 1_110, 2);
        let latest = result_time(4, 1_100, 1_200, 6);
        assert!(latest_fresh_comparable_result_time(&[&first, &latest], 1_120).is_err());

        let conflicting = result_time(2, 1_020, 1_130, 4);
        assert!(
            latest_fresh_comparable_result_time(&[&first, &latest, &conflicting], 1_105).is_err()
        );

        let middle = result_time(3, 1_050, 1_150, 4);
        assert_eq!(
            latest_fresh_comparable_result_time(&[&latest, &first, &middle], 1_105)
                .unwrap()
                .head_identity,
            latest.head_identity
        );
    }

    fn economic_policy() -> ProtectedEconomicPolicyBundleV1 {
        let reference = |name: &str, byte: char| ProtectedEconomicPolicyReferenceV1 {
            identity: name.into(),
            digest: format!("sha256:{}", byte.to_string().repeat(64)),
        };
        let mut policy = ProtectedEconomicPolicyBundleV1 {
            schema_version: 1,
            bundle_identity: "pending-policy".into(),
            bundle_digest: format!("blake3:{}", "0".repeat(64)),
            protected_decision_policy_identity: "protected-policy".into(),
            protected_decision_policy_version: 1,
            metric: reference("net-return", '1'),
            coverage_policy: reference("coverage", '2'),
            tolerance_policy: reference("tolerance", '3'),
            threshold_policy: reference("threshold", '4'),
            aggregation_policy: reference("aggregation", '5'),
            unit: "basis-points".into(),
            decimal_scale: 4,
            comparison: ProtectedEconomicComparisonV1::GreaterThanOrEqual,
            threshold_raw: 250,
            tolerance_raw: 5,
            minimum_coverage_bps: 9_500,
            aggregation: ProtectedEconomicAggregationV1::EveryApplicableCell,
        };
        policy.bundle_digest = policy.compute_digest().unwrap();
        policy.bundle_identity = format!(
            "qualification-protected-economic-policy-v1-{}",
            policy.bundle_digest.strip_prefix("blake3:").unwrap()
        );
        policy
    }

    fn economic_measurement(
        policy: &ProtectedEconomicPolicyBundleV1,
    ) -> ProtectedEconomicMeasurementV1 {
        let mut measurement = ProtectedEconomicMeasurementV1 {
            schema_version: 1,
            measurement_identity: "pending-measurement".into(),
            measurement_digest: format!("blake3:{}", "0".repeat(64)),
            request_identity: "request".into(),
            request_digest: format!("sha256:{}", "6".repeat(64)),
            attempt_identity: "attempt".into(),
            protected_plan_identity: "plan".into(),
            protected_plan_digest: format!("sha256:{}", "7".repeat(64)),
            plan_cell_set_identity: "cell-set".into(),
            plan_cell_set_digest: format!("sha256:{}", "8".repeat(64)),
            plan_cell_identity: "cell".into(),
            plan_cell_digest: format!("sha256:{}", "9".repeat(64)),
            metric_identity: policy.metric.identity.clone(),
            metric_digest: policy.metric.digest.clone(),
            unit: policy.unit.clone(),
            decimal_scale: policy.decimal_scale,
            observed_raw: 245,
            observed_coverage_bps: 9_500,
            decisive_evidence: ProtectedConsumedInputLocatorV1 {
                owner: OpaqueIdentityV2::try_from("backtest-owner".to_string()).unwrap(),
                reference: OpaqueIdentityV2::try_from("measurement-evidence".to_string()).unwrap(),
                digest: CanonicalDigestV2::try_from(format!("sha256:{}", "a".repeat(64))).unwrap(),
            },
            result_time_evidence_digest: format!("sha256:{}", "b".repeat(64)),
        };
        measurement.measurement_digest = measurement.compute_digest().unwrap();
        measurement.measurement_identity = format!(
            "backtest-protected-economic-measurement-v1-{}",
            measurement
                .measurement_digest
                .strip_prefix("blake3:")
                .unwrap()
        );
        measurement
    }

    #[test]
    fn economic_measurement_uses_frozen_tolerance_coverage_and_metric() {
        let policy = economic_policy();
        let mut measurement = economic_measurement(&policy);
        assert!(economic_measurement_pass(&policy, &measurement).unwrap());

        measurement.observed_raw = 244;
        measurement.measurement_digest = measurement.compute_digest().unwrap();
        measurement.measurement_identity = format!(
            "backtest-protected-economic-measurement-v1-{}",
            measurement
                .measurement_digest
                .strip_prefix("blake3:")
                .unwrap()
        );
        assert!(!economic_measurement_pass(&policy, &measurement).unwrap());

        measurement.observed_raw = 250;
        measurement.observed_coverage_bps = 9_499;
        measurement.measurement_digest = measurement.compute_digest().unwrap();
        measurement.measurement_identity = format!(
            "backtest-protected-economic-measurement-v1-{}",
            measurement
                .measurement_digest
                .strip_prefix("blake3:")
                .unwrap()
        );
        assert!(!economic_measurement_pass(&policy, &measurement).unwrap());

        measurement.metric_identity = "post-result-substitute".into();
        measurement.measurement_digest = measurement.compute_digest().unwrap();
        measurement.measurement_identity = format!(
            "backtest-protected-economic-measurement-v1-{}",
            measurement
                .measurement_digest
                .strip_prefix("blake3:")
                .unwrap()
        );
        assert!(economic_measurement_pass(&policy, &measurement).is_err());
    }

    #[test]
    fn passing_cell_requires_one_no_defect_terminal_and_accepts_preregistered_nonapp() {
        assert!(valid_terminal_result_count(
            ProtectedAssessmentModeV1::EconomicPass,
            1
        ));
        assert!(!valid_terminal_result_count(
            ProtectedAssessmentModeV1::EconomicPass,
            2
        ));
        assert!(assessment_ready_cell(
            ProtectedAssessmentModeV1::EconomicPass,
            &[DiagnosticCategoryV2::NoExecutionDefect],
            ProtectedCellApplicabilityObservationV3::ApplicableInputsObserved,
            Some(true),
        ));
        assert!(!assessment_ready_cell(
            ProtectedAssessmentModeV1::EconomicPass,
            &[DiagnosticCategoryV2::NoExecutionDefect],
            ProtectedCellApplicabilityObservationV3::ApplicableInputsObserved,
            None,
        ));
        assert!(assessment_ready_cell(
            ProtectedAssessmentModeV1::EconomicPass,
            &[DiagnosticCategoryV2::NoExecutionDefect],
            ProtectedCellApplicabilityObservationV3::PreResultNonApplicabilityBasisObserved,
            None,
        ));
        assert!(!assessment_ready_cell(
            ProtectedAssessmentModeV1::EconomicPass,
            &[DiagnosticCategoryV2::ValidEconomicFailure],
            ProtectedCellApplicabilityObservationV3::ApplicableInputsObserved,
            Some(true),
        ));
    }
}
