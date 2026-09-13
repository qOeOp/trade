use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};

use crate::QualificationOwnerError;
use crate::postgres::{canonical_digest, identity};

const ROBUSTNESS_ADEQUACY_POLICY_IDENTITY_V1: &str = "qualification-robustness-adequacy-policy-v1";
const ROBUSTNESS_ADEQUACY_POLICY_VERSION_V1: u64 = 1;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CandidateIntakeRequestV1 {
    review_request_identity: String,
    review_request_digest: String,
    decision_identity: String,
    result_identity: String,
    expected_candidate_identity: String,
    expected_selection_identity: String,
    protected_decision_policy_identity: String,
    protected_decision_policy_version: u64,
}

impl CandidateIntakeRequestV1 {
    pub fn new(
        review_request_identity: String,
        decision_identity: String,
        result_identity: String,
        expected_candidate_identity: String,
        expected_selection_identity: String,
        protected_decision_policy_identity: String,
        protected_decision_policy_version: u64,
    ) -> Result<Self, QualificationOwnerError> {
        let review_request_digest = canonical_digest(
            "qualification.candidate-intake-request.v1",
            &CandidateIntakeRequestMeaningV1 {
                schema_version: 1,
                review_request_identity: &review_request_identity,
                decision_identity: &decision_identity,
                result_identity: &result_identity,
                expected_candidate_identity: &expected_candidate_identity,
                expected_selection_identity: &expected_selection_identity,
                protected_decision_policy_identity: &protected_decision_policy_identity,
                protected_decision_policy_version,
            },
        )?;
        let request = Self {
            review_request_identity,
            review_request_digest,
            decision_identity,
            result_identity,
            expected_candidate_identity,
            expected_selection_identity,
            protected_decision_policy_identity,
            protected_decision_policy_version,
        };
        validate_request(&request)?;
        Ok(request)
    }

    pub fn review_request_identity(&self) -> &str {
        &self.review_request_identity
    }

    pub(crate) fn review_request_digest(&self) -> &str {
        &self.review_request_digest
    }
    pub(crate) fn decision_identity(&self) -> &str {
        &self.decision_identity
    }

    pub(crate) fn result_identity(&self) -> &str {
        &self.result_identity
    }
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CandidateIntakeStatusV1 {
    NotAdmitted,
    Admitted,
}

/// Qualification-owned write-once response. Positive fields remain
/// serialize-only outside this crate.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct CandidateIntakeReceiptV1 {
    schema_version: u16,
    receipt_identity: String,
    receipt_digest: String,
    review_request_identity: String,
    review_request_digest: String,
    candidate_identity: String,
    candidate_digest: String,
    selection_identity: String,
    selection_digest: String,
    decision_identity: String,
    result_identity: String,
    protected_plan_identity: String,
    protected_plan_version: u64,
    protected_plan_digest: String,
    protected_decision_policy_identity: String,
    protected_decision_policy_version: u64,
    adequacy_policy_identity: String,
    adequacy_policy_version: u64,
    status: CandidateIntakeStatusV1,
    holdout_reservation_identity: Option<String>,
    committed_at_epoch_ms: u64,
}

impl CandidateIntakeReceiptV1 {
    pub fn receipt_identity(&self) -> &str {
        &self.receipt_identity
    }
    pub fn receipt_digest(&self) -> &str {
        &self.receipt_digest
    }
    pub fn review_request_identity(&self) -> &str {
        &self.review_request_identity
    }
    pub(crate) fn review_request_digest(&self) -> &str {
        &self.review_request_digest
    }
    pub(crate) fn decision_identity(&self) -> &str {
        &self.decision_identity
    }
    pub(crate) fn result_identity(&self) -> &str {
        &self.result_identity
    }
    pub fn candidate_identity(&self) -> &str {
        &self.candidate_identity
    }
    pub const fn status(&self) -> CandidateIntakeStatusV1 {
        self.status
    }
    pub fn holdout_reservation_identity(&self) -> Option<&str> {
        self.holdout_reservation_identity.as_deref()
    }
    pub(crate) const fn committed_at_epoch_ms(&self) -> u64 {
        self.committed_at_epoch_ms
    }
    pub(crate) fn matches_request(&self, request: &CandidateIntakeRequestV1) -> bool {
        self.review_request_identity == request.review_request_identity
            && self.review_request_digest == request.review_request_digest
            && self.decision_identity == request.decision_identity
            && self.result_identity == request.result_identity
            && self.candidate_identity == request.expected_candidate_identity
            && self.selection_identity == request.expected_selection_identity
            && self.protected_decision_policy_identity == request.protected_decision_policy_identity
            && self.protected_decision_policy_version == request.protected_decision_policy_version
    }
    pub(crate) fn as_json(&self) -> Result<serde_json::Value, QualificationOwnerError> {
        serde_json::to_value(self).map_err(|e| unavailable(&e.to_string()))
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct StoredCandidateIntakeReceiptV1 {
    schema_version: u16,
    receipt_identity: String,
    receipt_digest: String,
    review_request_identity: String,
    review_request_digest: String,
    candidate_identity: String,
    candidate_digest: String,
    selection_identity: String,
    selection_digest: String,
    decision_identity: String,
    result_identity: String,
    protected_plan_identity: String,
    protected_plan_version: u64,
    protected_plan_digest: String,
    protected_decision_policy_identity: String,
    protected_decision_policy_version: u64,
    adequacy_policy_identity: String,
    adequacy_policy_version: u64,
    status: CandidateIntakeStatusV1,
    holdout_reservation_identity: Option<String>,
    committed_at_epoch_ms: u64,
}

pub(crate) fn decode_intake_receipt_v1(
    value: &serde_json::Value,
) -> Result<CandidateIntakeReceiptV1, QualificationOwnerError> {
    let stored: StoredCandidateIntakeReceiptV1 =
        serde_json::from_value(value.clone()).map_err(|e| unavailable(&e.to_string()))?;
    let receipt = CandidateIntakeReceiptV1 {
        schema_version: stored.schema_version,
        receipt_identity: stored.receipt_identity,
        receipt_digest: stored.receipt_digest,
        review_request_identity: stored.review_request_identity,
        review_request_digest: stored.review_request_digest,
        candidate_identity: stored.candidate_identity,
        candidate_digest: stored.candidate_digest,
        selection_identity: stored.selection_identity,
        selection_digest: stored.selection_digest,
        decision_identity: stored.decision_identity,
        result_identity: stored.result_identity,
        protected_plan_identity: stored.protected_plan_identity,
        protected_plan_version: stored.protected_plan_version,
        protected_plan_digest: stored.protected_plan_digest,
        protected_decision_policy_identity: stored.protected_decision_policy_identity,
        protected_decision_policy_version: stored.protected_decision_policy_version,
        adequacy_policy_identity: stored.adequacy_policy_identity,
        adequacy_policy_version: stored.adequacy_policy_version,
        status: stored.status,
        holdout_reservation_identity: stored.holdout_reservation_identity,
        committed_at_epoch_ms: stored.committed_at_epoch_ms,
    };
    let expected = canonical_digest(
        "qualification.candidate-intake-receipt.v1",
        &IntakeMeaningV1 {
            schema_version: receipt.schema_version,
            review_request_identity: &receipt.review_request_identity,
            review_request_digest: &receipt.review_request_digest,
            candidate_identity: &receipt.candidate_identity,
            candidate_digest: &receipt.candidate_digest,
            selection_identity: &receipt.selection_identity,
            selection_digest: &receipt.selection_digest,
            decision_identity: &receipt.decision_identity,
            result_identity: &receipt.result_identity,
            protected_plan_identity: &receipt.protected_plan_identity,
            protected_plan_version: receipt.protected_plan_version,
            protected_plan_digest: &receipt.protected_plan_digest,
            protected_decision_policy_identity: &receipt.protected_decision_policy_identity,
            protected_decision_policy_version: receipt.protected_decision_policy_version,
            adequacy_policy_identity: &receipt.adequacy_policy_identity,
            adequacy_policy_version: receipt.adequacy_policy_version,
            status: receipt.status,
            holdout_reservation_identity: receipt.holdout_reservation_identity.as_deref(),
            committed_at_epoch_ms: receipt.committed_at_epoch_ms,
        },
    )?;
    if expected != receipt.receipt_digest
        || identity("qualification-candidate-intake-receipt-v1", &expected)
            != receipt.receipt_identity
        || receipt.as_json()? != *value
    {
        return Err(unavailable("stored Candidate Intake receipt changed"));
    }
    Ok(receipt)
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ResolvedRdSelectionEnvelopeV1 {
    pub schema_version: u16,
    pub candidate: StoredCandidateV1,
    pub selection: StoredSelectionV1,
    pub selection_receipt: StoredSelectionReceiptV1,
}

pub(crate) struct ResolvedRdSelectionStorageV1 {
    pub candidate_json: serde_json::Value,
    pub candidate_bytes: Vec<u8>,
    pub candidate_storage_digest: String,
    pub selection_json: serde_json::Value,
    pub selection_bytes: Vec<u8>,
    pub selection_storage_digest: String,
    pub selection_receipt_json: serde_json::Value,
    pub selection_receipt_bytes: Vec<u8>,
    pub selection_receipt_storage_digest: String,
    pub candidate_outbox_count: i64,
    pub selection_outbox_count: i64,
    pub selection_outbox_json: serde_json::Value,
    pub selection_outbox_digest: String,
    pub selection_outbox_committed_at_epoch_ms: i64,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct StoredCandidateV1 {
    schema_version: u16,
    candidate_identity: String,
    candidate_digest: String,
    evidence_cut: EvidenceCutV1,
    artifact: EvidenceReferenceV1,
    protected_robustness_plan: ProtectedPlanV1,
    trial_family_policy_digest: String,
    consumed_trial_budget: u32,
    frozen_falsifier_binding: String,
    stop_rule: String,
    cost_model_identity: String,
    slippage_model_identity: String,
    capacity_model_identity: String,
    semantic_predecessor_frontier: Vec<String>,
    protected_feedback_frontier: String,
    independence_disposition: String,
    independence_basis_identity: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct StoredSelectionV1 {
    schema_version: u16,
    selection_identity: String,
    selection_digest: String,
    disposition: String,
    rationale: String,
    candidate_identity: String,
    candidate_digest: String,
    assessment_identity: String,
    assessment_digest: String,
    decision_identity: String,
    decision_digest: String,
    evidence_cut: EvidenceCutV1,
    cost_model_identity: String,
    slippage_model_identity: String,
    capacity_model_identity: String,
    protected_decision_policy_identity: String,
    protected_decision_policy_version: u64,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct StoredSelectionReceiptV1 {
    schema_version: u16,
    receipt_identity: String,
    selection_identity: String,
    selection_digest: String,
    candidate_identity: String,
    candidate_digest: String,
    decision_identity: String,
    result_identity: String,
    committed_at_epoch_ms: u64,
}

#[derive(Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
struct StoredSelectionCommittedOutboxV1 {
    schema_version: u16,
    selection_identity: String,
    selection_digest: String,
    selection_receipt_identity: String,
    candidate_identity: String,
    candidate_digest: String,
    assessment_identity: String,
    decision_identity: String,
    trial_family_identity: String,
    result_identity: String,
    protected_plan_identity: String,
    protected_plan_version: u64,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
struct EvidenceCutV1 {
    decision_policy_identity: String,
    decision_policy_version: u64,
    decision_policy_digest: [u8; 32],
    decision_policy_binding_digest: [u8; 32],
    trial_family_identity: String,
    census_frontier_identity: String,
    census_frontier_digest: String,
    attempt_frontier_identity: String,
    attempt_frontier_digest: String,
    candidate_set_frontier_identity: String,
    candidate_set_frontier_digest: String,
    request_identity: String,
    request_digest: String,
    result_identity: String,
    result_digest: String,
    attempt_identity: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
struct EvidenceReferenceV1 {
    identity: String,
    digest: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
struct ProtectedPlanV1 {
    schema_version: u16,
    plan_identity: String,
    plan_version: u64,
    plan_digest: String,
    trial_family_identity: String,
    trial_family_digest: String,
    census_frontier_identity: String,
    census_frontier_digest: String,
    attempt_frontier_identity: String,
    attempt_frontier_digest: String,
    artifact: EvidenceReferenceV1,
    pit_rule_identity: String,
    cost_model_identity: String,
    slippage_model_identity: String,
    capacity_model_identity: String,
    decision_policy_identity: String,
    decision_policy_version: u64,
    proposal: ProtectedPlanProposalV1,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
struct ProtectedPlanProposalV1 {
    required_time_windows: Vec<TimeWindowV1>,
    required_regimes: Vec<MarketRegimeV1>,
    required_instrument_slices: Vec<EvidenceReferenceV1>,
    instrument_scope: InstrumentScopeV1,
    instrument_non_applicability_basis: Option<EvidenceReferenceV1>,
    required_perturbations: Vec<InputPerturbationV1>,
    required_parameter_neighborhoods: Vec<ParameterNeighborhoodV1>,
    no_tunable_parameters_basis: Option<EvidenceReferenceV1>,
    preregistered_capacity_ceiling: u64,
    metric: EvidenceReferenceV1,
    coverage_policy: EvidenceReferenceV1,
    tolerance_policy: EvidenceReferenceV1,
    threshold_policy: EvidenceReferenceV1,
    aggregation_policy: EvidenceReferenceV1,
    missing_cell_policy: EvidenceReferenceV1,
    stop_policy: EvidenceReferenceV1,
    purge_policy: EvidenceReferenceV1,
    embargo_policy: EvidenceReferenceV1,
    multiplicity_policy: EvidenceReferenceV1,
    protected_decision_policy: ProtectedPolicyV1,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
struct TimeWindowV1 {
    evidence: EvidenceReferenceV1,
    start_epoch_ms: u64,
    end_epoch_ms: u64,
}
#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
struct MarketRegimeV1 {
    evidence: EvidenceReferenceV1,
    adverse: bool,
}
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
enum InstrumentScopeV1 {
    SingleInstrument,
    MultipleInstruments,
}
#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
struct InputPerturbationV1 {
    input_class: EvidenceReferenceV1,
    perturbation: EvidenceReferenceV1,
}
#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
struct ParameterNeighborhoodV1 {
    parameter: EvidenceReferenceV1,
    lower: i64,
    center: i64,
    upper: i64,
}
#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
struct ProtectedPolicyV1 {
    identity: String,
    version: u64,
    digest: String,
}

#[derive(Serialize)]
struct CandidateIntakeRequestMeaningV1<'a> {
    schema_version: u16,
    review_request_identity: &'a str,
    decision_identity: &'a str,
    result_identity: &'a str,
    expected_candidate_identity: &'a str,
    expected_selection_identity: &'a str,
    protected_decision_policy_identity: &'a str,
    protected_decision_policy_version: u64,
}

#[derive(Serialize)]
struct IntakeMeaningV1<'a> {
    schema_version: u16,
    review_request_identity: &'a str,
    review_request_digest: &'a str,
    candidate_identity: &'a str,
    candidate_digest: &'a str,
    selection_identity: &'a str,
    selection_digest: &'a str,
    decision_identity: &'a str,
    result_identity: &'a str,
    protected_plan_identity: &'a str,
    protected_plan_version: u64,
    protected_plan_digest: &'a str,
    protected_decision_policy_identity: &'a str,
    protected_decision_policy_version: u64,
    adequacy_policy_identity: &'a str,
    adequacy_policy_version: u64,
    status: CandidateIntakeStatusV1,
    holdout_reservation_identity: Option<&'a str>,
    committed_at_epoch_ms: u64,
}

pub(crate) fn form_candidate_intake_receipt_v1(
    request: &CandidateIntakeRequestV1,
    envelope: &ResolvedRdSelectionEnvelopeV1,
    committed_at_epoch_ms: u64,
) -> Result<CandidateIntakeReceiptV1, QualificationOwnerError> {
    validate_request(request)?;
    validate_handoff(request, envelope)?;
    let plan = &envelope.candidate.protected_robustness_plan;
    let status = if adequate(plan, request) {
        CandidateIntakeStatusV1::Admitted
    } else {
        CandidateIntakeStatusV1::NotAdmitted
    };
    let reservation_digest = canonical_digest(
        "qualification.holdout-reservation.v1",
        &(
            request.review_request_identity.as_str(),
            envelope.candidate.candidate_identity.as_str(),
            envelope
                .candidate
                .evidence_cut
                .trial_family_identity
                .as_str(),
            envelope
                .candidate
                .evidence_cut
                .census_frontier_identity
                .as_str(),
            envelope
                .candidate
                .evidence_cut
                .attempt_frontier_identity
                .as_str(),
            plan.plan_identity.as_str(),
            plan.plan_digest.as_str(),
            request.protected_decision_policy_identity.as_str(),
            request.protected_decision_policy_version,
        ),
    )?;
    let reservation = (status == CandidateIntakeStatusV1::Admitted)
        .then(|| identity("qualification-holdout-reservation-v1", &reservation_digest));
    let meaning = IntakeMeaningV1 {
        schema_version: 1,
        review_request_identity: &request.review_request_identity,
        review_request_digest: &request.review_request_digest,
        candidate_identity: &envelope.candidate.candidate_identity,
        candidate_digest: &envelope.candidate.candidate_digest,
        selection_identity: &envelope.selection.selection_identity,
        selection_digest: &envelope.selection.selection_digest,
        decision_identity: &request.decision_identity,
        result_identity: &request.result_identity,
        protected_plan_identity: &plan.plan_identity,
        protected_plan_version: plan.plan_version,
        protected_plan_digest: &plan.plan_digest,
        protected_decision_policy_identity: &request.protected_decision_policy_identity,
        protected_decision_policy_version: request.protected_decision_policy_version,
        adequacy_policy_identity: ROBUSTNESS_ADEQUACY_POLICY_IDENTITY_V1,
        adequacy_policy_version: ROBUSTNESS_ADEQUACY_POLICY_VERSION_V1,
        status,
        holdout_reservation_identity: reservation.as_deref(),
        committed_at_epoch_ms,
    };
    let receipt_digest = canonical_digest("qualification.candidate-intake-receipt.v1", &meaning)?;
    Ok(CandidateIntakeReceiptV1 {
        schema_version: 1,
        receipt_identity: identity("qualification-candidate-intake-receipt-v1", &receipt_digest),
        receipt_digest,
        review_request_identity: request.review_request_identity.clone(),
        review_request_digest: request.review_request_digest.clone(),
        candidate_identity: envelope.candidate.candidate_identity.clone(),
        candidate_digest: envelope.candidate.candidate_digest.clone(),
        selection_identity: envelope.selection.selection_identity.clone(),
        selection_digest: envelope.selection.selection_digest.clone(),
        decision_identity: request.decision_identity.clone(),
        result_identity: request.result_identity.clone(),
        protected_plan_identity: plan.plan_identity.clone(),
        protected_plan_version: plan.plan_version,
        protected_plan_digest: plan.plan_digest.clone(),
        protected_decision_policy_identity: request.protected_decision_policy_identity.clone(),
        protected_decision_policy_version: request.protected_decision_policy_version,
        adequacy_policy_identity: ROBUSTNESS_ADEQUACY_POLICY_IDENTITY_V1.to_string(),
        adequacy_policy_version: ROBUSTNESS_ADEQUACY_POLICY_VERSION_V1,
        status,
        holdout_reservation_identity: reservation,
        committed_at_epoch_ms,
    })
}

fn validate_request(request: &CandidateIntakeRequestV1) -> Result<(), QualificationOwnerError> {
    let identities = [
        &request.review_request_identity,
        &request.decision_identity,
        &request.result_identity,
        &request.expected_candidate_identity,
        &request.expected_selection_identity,
        &request.protected_decision_policy_identity,
    ];
    let expected_digest = canonical_digest(
        "qualification.candidate-intake-request.v1",
        &CandidateIntakeRequestMeaningV1 {
            schema_version: 1,
            review_request_identity: &request.review_request_identity,
            decision_identity: &request.decision_identity,
            result_identity: &request.result_identity,
            expected_candidate_identity: &request.expected_candidate_identity,
            expected_selection_identity: &request.expected_selection_identity,
            protected_decision_policy_identity: &request.protected_decision_policy_identity,
            protected_decision_policy_version: request.protected_decision_policy_version,
        },
    )?;
    if identities.iter().any(|value| value.is_empty())
        || request.review_request_digest != expected_digest
        || request.protected_decision_policy_version == 0
    {
        return Err(unavailable("Candidate Intake locator is invalid"));
    }
    Ok(())
}

fn validate_handoff(
    request: &CandidateIntakeRequestV1,
    envelope: &ResolvedRdSelectionEnvelopeV1,
) -> Result<(), QualificationOwnerError> {
    let candidate = &envelope.candidate;
    let selection = &envelope.selection;
    let receipt = &envelope.selection_receipt;
    if envelope.schema_version != 1
        || candidate.schema_version != 1
        || selection.schema_version != 1
        || receipt.schema_version != 1
        || candidate.candidate_identity != request.expected_candidate_identity
        || selection.selection_identity != request.expected_selection_identity
        || selection.disposition != "SELECTED_FOR_QUALIFICATION"
        || selection.rationale != "POSITIVE_ASSESSMENT_SATISFIED"
        || selection.candidate_identity != candidate.candidate_identity
        || selection.candidate_digest != candidate.candidate_digest
        || selection.decision_identity != request.decision_identity
        || selection.evidence_cut != candidate.evidence_cut
        || selection.evidence_cut.result_identity != request.result_identity
        || receipt.selection_identity != selection.selection_identity
        || receipt.selection_digest != selection.selection_digest
        || receipt.candidate_identity != candidate.candidate_identity
        || receipt.candidate_digest != candidate.candidate_digest
        || receipt.decision_identity != request.decision_identity
        || receipt.result_identity != request.result_identity
        || candidate.artifact != candidate.protected_robustness_plan.artifact
        || candidate.evidence_cut.trial_family_identity
            != candidate.protected_robustness_plan.trial_family_identity
        || candidate.evidence_cut.census_frontier_identity
            != candidate.protected_robustness_plan.census_frontier_identity
        || candidate.evidence_cut.census_frontier_digest
            != candidate.protected_robustness_plan.census_frontier_digest
        || candidate.evidence_cut.attempt_frontier_identity
            != candidate
                .protected_robustness_plan
                .attempt_frontier_identity
        || candidate.evidence_cut.attempt_frontier_digest
            != candidate.protected_robustness_plan.attempt_frontier_digest
        || candidate.cost_model_identity != candidate.protected_robustness_plan.cost_model_identity
        || candidate.slippage_model_identity
            != candidate.protected_robustness_plan.slippage_model_identity
        || candidate.capacity_model_identity
            != candidate.protected_robustness_plan.capacity_model_identity
        || selection.cost_model_identity != candidate.cost_model_identity
        || selection.slippage_model_identity != candidate.slippage_model_identity
        || selection.capacity_model_identity != candidate.capacity_model_identity
        || selection.protected_decision_policy_identity
            != request.protected_decision_policy_identity
        || selection.protected_decision_policy_version != request.protected_decision_policy_version
    {
        return Err(unavailable(
            "R&D Candidate and Selection custody is cross-spliced",
        ));
    }
    Ok(())
}

fn adequate(plan: &ProtectedPlanV1, request: &CandidateIntakeRequestV1) -> bool {
    let proposal = &plan.proposal;
    plan.schema_version == 1
        && plan.plan_version > 0
        && valid_digest(&plan.plan_digest)
        && proposal.protected_decision_policy.identity == request.protected_decision_policy_identity
        && proposal.protected_decision_policy.version == request.protected_decision_policy_version
        && valid_reference(&proposal.metric)
        && valid_reference(&proposal.coverage_policy)
        && valid_reference(&proposal.tolerance_policy)
        && valid_reference(&proposal.threshold_policy)
        && valid_reference(&proposal.aggregation_policy)
        && valid_reference(&proposal.missing_cell_policy)
        && valid_reference(&proposal.stop_policy)
        && valid_reference(&proposal.purge_policy)
        && valid_reference(&proposal.embargo_policy)
        && valid_reference(&proposal.multiplicity_policy)
        && valid_windows(&proposal.required_time_windows)
        && valid_regimes(&proposal.required_regimes)
        && valid_instruments(proposal)
        && valid_perturbations(&proposal.required_perturbations)
        && valid_parameters(proposal)
        && proposal.preregistered_capacity_ceiling > 0
        && validate_plan_identity(plan).is_ok()
        && derive_plan_cells(plan).is_ok()
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ProtectedReplayAuthoritySourceV1 {
    pub candidate_identity: String,
    pub candidate_digest: String,
    pub trial_family_identity: String,
    pub trial_family_digest: String,
    pub plan_identity: String,
    pub plan_digest: String,
    pub plan_cell_set_identity: String,
    pub plan_cell_set_digest: String,
    pub plan_cells: Vec<(String, String)>,
    pub artifact_identity: String,
    pub artifact_digest: String,
    pub cost_model_identity: String,
    pub slippage_model_identity: String,
    pub capacity_model_identity: String,
    pub purge_embargo_policy_identity: String,
    pub purge_embargo_policy_digest: String,
    pub multiplicity_basis_identity: String,
    pub multiplicity_basis_digest: String,
    pub alternatives_thresholds_identity: String,
    pub alternatives_thresholds_digest: String,
    pub protected_decision_policy_identity: String,
    pub protected_decision_policy_version: u64,
}

pub(crate) fn protected_replay_authority_source_v1(
    receipt: &CandidateIntakeReceiptV1,
    envelope: &ResolvedRdSelectionEnvelopeV1,
) -> Result<ProtectedReplayAuthoritySourceV1, QualificationOwnerError> {
    if receipt.status != CandidateIntakeStatusV1::Admitted
        || receipt.candidate_identity != envelope.candidate.candidate_identity
        || receipt.candidate_digest != envelope.candidate.candidate_digest
        || receipt.selection_identity != envelope.selection.selection_identity
        || receipt.selection_digest != envelope.selection.selection_digest
        || receipt.decision_identity != envelope.selection.decision_identity
        || receipt.result_identity != envelope.selection.evidence_cut.result_identity
    {
        return Err(unavailable(
            "Candidate Intake and R&D handoff are cross-spliced",
        ));
    }
    let candidate = &envelope.candidate;
    let plan = &candidate.protected_robustness_plan;
    validate_plan_identity(plan)?;
    if receipt.protected_plan_identity != plan.plan_identity
        || receipt.protected_plan_version != plan.plan_version
        || receipt.protected_plan_digest != plan.plan_digest
        || receipt.protected_decision_policy_identity
            != plan.proposal.protected_decision_policy.identity
        || receipt.protected_decision_policy_version
            != plan.proposal.protected_decision_policy.version
    {
        return Err(unavailable("Candidate Intake protected plan changed"));
    }
    let (plan_cell_set_identity, plan_cell_set_digest, plan_cells) = derive_plan_cells(plan)?;
    let purge_embargo_policy_digest = canonical_digest(
        "qualification.protected-replay.purge-embargo-policy.v1",
        &(&plan.proposal.purge_policy, &plan.proposal.embargo_policy),
    )?;
    let multiplicity_basis_digest = canonical_digest(
        "qualification.protected-replay.multiplicity-basis.v1",
        &(
            &plan.proposal.multiplicity_policy,
            &plan.census_frontier_identity,
            &plan.census_frontier_digest,
            &plan.attempt_frontier_identity,
            &plan.attempt_frontier_digest,
        ),
    )?;
    let alternatives_thresholds_digest = canonical_digest(
        "qualification.protected-replay.alternatives-thresholds.v1",
        &(
            &plan.proposal.required_time_windows,
            &plan.proposal.required_regimes,
            &plan.proposal.required_instrument_slices,
            plan.proposal.instrument_scope,
            &plan.proposal.instrument_non_applicability_basis,
            &plan.proposal.required_perturbations,
            &plan.proposal.required_parameter_neighborhoods,
            &plan.proposal.no_tunable_parameters_basis,
            &plan.proposal.metric,
            &plan.proposal.coverage_policy,
            &plan.proposal.tolerance_policy,
            &plan.proposal.threshold_policy,
            &plan.proposal.aggregation_policy,
            &plan.proposal.missing_cell_policy,
            &plan.proposal.stop_policy,
        ),
    )?;
    Ok(ProtectedReplayAuthoritySourceV1 {
        candidate_identity: candidate.candidate_identity.clone(),
        candidate_digest: candidate.candidate_digest.clone(),
        trial_family_identity: plan.trial_family_identity.clone(),
        trial_family_digest: plan.trial_family_digest.clone(),
        plan_identity: plan.plan_identity.clone(),
        plan_digest: plan.plan_digest.clone(),
        plan_cell_set_identity,
        plan_cell_set_digest,
        plan_cells,
        artifact_identity: plan.artifact.identity.clone(),
        artifact_digest: plan.artifact.digest.clone(),
        cost_model_identity: plan.cost_model_identity.clone(),
        slippage_model_identity: plan.slippage_model_identity.clone(),
        capacity_model_identity: plan.capacity_model_identity.clone(),
        purge_embargo_policy_identity: identity(
            "qualification-purge-embargo-policy-v1",
            &purge_embargo_policy_digest,
        ),
        purge_embargo_policy_digest,
        multiplicity_basis_identity: identity(
            "qualification-multiplicity-basis-v1",
            &multiplicity_basis_digest,
        ),
        multiplicity_basis_digest,
        alternatives_thresholds_identity: identity(
            "qualification-alternatives-thresholds-v1",
            &alternatives_thresholds_digest,
        ),
        alternatives_thresholds_digest,
        protected_decision_policy_identity: plan
            .proposal
            .protected_decision_policy
            .identity
            .clone(),
        protected_decision_policy_version: plan.proposal.protected_decision_policy.version,
    })
}

#[derive(Serialize)]
struct ProtectedPlanMeaningV1<'a> {
    schema_version: u16,
    plan_version: u64,
    trial_family_identity: &'a str,
    trial_family_digest: &'a str,
    census_frontier_identity: &'a str,
    census_frontier_digest: &'a str,
    attempt_frontier_identity: &'a str,
    attempt_frontier_digest: &'a str,
    artifact: &'a EvidenceReferenceV1,
    pit_rule_identity: &'a str,
    cost_model_identity: &'a str,
    slippage_model_identity: &'a str,
    capacity_model_identity: &'a str,
    decision_policy_identity: &'a str,
    decision_policy_version: u64,
    proposal: &'a ProtectedPlanProposalV1,
}

fn validate_plan_identity(plan: &ProtectedPlanV1) -> Result<(), QualificationOwnerError> {
    let digest = canonical_digest(
        "rd.protected-robustness-plan.v1",
        &ProtectedPlanMeaningV1 {
            schema_version: plan.schema_version,
            plan_version: plan.plan_version,
            trial_family_identity: &plan.trial_family_identity,
            trial_family_digest: &plan.trial_family_digest,
            census_frontier_identity: &plan.census_frontier_identity,
            census_frontier_digest: &plan.census_frontier_digest,
            attempt_frontier_identity: &plan.attempt_frontier_identity,
            attempt_frontier_digest: &plan.attempt_frontier_digest,
            artifact: &plan.artifact,
            pit_rule_identity: &plan.pit_rule_identity,
            cost_model_identity: &plan.cost_model_identity,
            slippage_model_identity: &plan.slippage_model_identity,
            capacity_model_identity: &plan.capacity_model_identity,
            decision_policy_identity: &plan.decision_policy_identity,
            decision_policy_version: plan.decision_policy_version,
            proposal: &plan.proposal,
        },
    )?;
    if digest != plan.plan_digest
        || identity("rd-protected-robustness-plan-v1", &digest) != plan.plan_identity
    {
        return Err(unavailable(
            "R&D Protected Robustness Plan identity changed",
        ));
    }
    Ok(())
}

#[derive(Serialize)]
struct PlanCellMeaningV1<'a> {
    time_window: &'a EvidenceReferenceV1,
    market_regime: &'a EvidenceReferenceV1,
    instrument: &'a EvidenceReferenceV1,
    input_perturbation: &'a EvidenceReferenceV1,
    parameter_neighborhood: &'a EvidenceReferenceV1,
}

fn derive_plan_cells(
    plan: &ProtectedPlanV1,
) -> Result<(String, String, Vec<(String, String)>), QualificationOwnerError> {
    let proposal = &plan.proposal;
    let mut windows = proposal
        .required_time_windows
        .iter()
        .map(|value| &value.evidence)
        .collect::<Vec<_>>();
    let mut regimes = proposal
        .required_regimes
        .iter()
        .map(|value| &value.evidence)
        .collect::<Vec<_>>();
    let mut instruments = if proposal.required_instrument_slices.is_empty() {
        proposal
            .instrument_non_applicability_basis
            .iter()
            .collect::<Vec<_>>()
    } else {
        proposal
            .required_instrument_slices
            .iter()
            .collect::<Vec<_>>()
    };
    let mut perturbations = proposal
        .required_perturbations
        .iter()
        .map(|value| &value.perturbation)
        .collect::<Vec<_>>();
    let mut parameters = if proposal.required_parameter_neighborhoods.is_empty() {
        proposal
            .no_tunable_parameters_basis
            .iter()
            .collect::<Vec<_>>()
    } else {
        proposal
            .required_parameter_neighborhoods
            .iter()
            .map(|value| &value.parameter)
            .collect::<Vec<_>>()
    };
    for dimension in [
        &mut windows,
        &mut regimes,
        &mut instruments,
        &mut perturbations,
        &mut parameters,
    ] {
        dimension.sort_by(|a, b| (&a.identity, &a.digest).cmp(&(&b.identity, &b.digest)));
        if dimension.is_empty() || dimension.len() > 16 {
            return Err(unavailable(
                "Protected Robustness Plan cell dimension is empty or unbounded",
            ));
        }
    }
    let count = [
        windows.len(),
        regimes.len(),
        instruments.len(),
        perturbations.len(),
        parameters.len(),
    ]
    .into_iter()
    .try_fold(1usize, |count, value| count.checked_mul(value))
    .filter(|count| *count <= 4_096)
    .ok_or_else(|| unavailable("Protected Robustness Plan cell census is unbounded"))?;
    let mut cells = Vec::with_capacity(count);
    for window in windows {
        for regime in &regimes {
            for instrument in &instruments {
                for perturbation in &perturbations {
                    for parameter in &parameters {
                        let digest = canonical_digest(
                            "qualification.protected-plan-cell.v1",
                            &PlanCellMeaningV1 {
                                time_window: window,
                                market_regime: regime,
                                instrument,
                                input_perturbation: perturbation,
                                parameter_neighborhood: parameter,
                            },
                        )?;
                        cells.push((
                            identity("qualification-protected-plan-cell-v1", &digest),
                            digest,
                        ));
                    }
                }
            }
        }
    }
    let set_digest = canonical_digest("qualification.protected-plan-cell-set.v1", &cells)?;
    Ok((
        identity("qualification-protected-plan-cell-set-v1", &set_digest),
        set_digest,
        cells,
    ))
}

fn valid_windows(values: &[TimeWindowV1]) -> bool {
    if values.len() < 2
        || values
            .iter()
            .any(|v| v.start_epoch_ms >= v.end_epoch_ms || !valid_reference(&v.evidence))
    {
        return false;
    }
    let mut ordered = values.to_vec();
    ordered.sort_by_key(|v| (v.start_epoch_ms, v.end_epoch_ms));
    unique_refs(ordered.iter().map(|v| &v.evidence))
        && ordered
            .windows(2)
            .all(|pair| pair[0].end_epoch_ms <= pair[1].start_epoch_ms)
}

fn valid_regimes(values: &[MarketRegimeV1]) -> bool {
    values.len() >= 2
        && values.iter().any(|v| v.adverse)
        && unique_refs(values.iter().map(|v| &v.evidence))
}

fn valid_instruments(plan: &ProtectedPlanProposalV1) -> bool {
    unique_refs(plan.required_instrument_slices.iter())
        && !(plan.instrument_scope == InstrumentScopeV1::MultipleInstruments
            && plan.instrument_non_applicability_basis.is_some())
        && plan
            .instrument_non_applicability_basis
            .as_ref()
            .is_none_or(valid_reference)
}

fn valid_perturbations(values: &[InputPerturbationV1]) -> bool {
    !values.is_empty()
        && unique_refs(values.iter().map(|v| &v.input_class))
        && unique_refs(values.iter().map(|v| &v.perturbation))
}

fn valid_parameters(plan: &ProtectedPlanProposalV1) -> bool {
    match (
        &plan.required_parameter_neighborhoods[..],
        &plan.no_tunable_parameters_basis,
    ) {
        ([], Some(basis)) => valid_reference(basis),
        ([], None) | ([..], Some(_)) => false,
        (values, None) => {
            values
                .iter()
                .all(|v| valid_reference(&v.parameter) && v.lower < v.center && v.center < v.upper)
                && unique_refs(values.iter().map(|v| &v.parameter))
        }
    }
}

fn unique_refs<'a>(values: impl Iterator<Item = &'a EvidenceReferenceV1>) -> bool {
    let mut seen = BTreeSet::new();
    let mut count = 0;
    for value in values {
        count += 1;
        if !valid_reference(value) || !seen.insert((&value.identity, &value.digest)) {
            return false;
        }
    }
    count > 0
}

fn valid_reference(value: &EvidenceReferenceV1) -> bool {
    !value.identity.is_empty() && valid_digest(&value.digest)
}

fn valid_digest(value: &str) -> bool {
    value
        .strip_prefix("sha256:")
        .is_some_and(|hex| hex.len() == 64 && hex.bytes().all(|b| b.is_ascii_hexdigit()))
        || value
            .strip_prefix("blake3:")
            .is_some_and(|hex| hex.len() == 64 && hex.bytes().all(|b| b.is_ascii_hexdigit()))
}

fn unavailable(message: &str) -> QualificationOwnerError {
    QualificationOwnerError::Unavailable(message.to_string())
}

pub(crate) fn decode_resolved_handoff_v1(
    storage: &ResolvedRdSelectionStorageV1,
) -> Result<ResolvedRdSelectionEnvelopeV1, QualificationOwnerError> {
    if storage.candidate_outbox_count != 0 || storage.selection_outbox_count != 1 {
        return Err(unavailable("R&D Selection outbox custody is incomplete"));
    }
    verify_storage(
        "rd.qualification-candidate.storage.v1",
        &storage.candidate_bytes,
        &storage.candidate_storage_digest,
    )?;
    verify_storage(
        "rd.research-selection.storage.v1",
        &storage.selection_bytes,
        &storage.selection_storage_digest,
    )?;
    verify_storage(
        "rd.research-selection-receipt.storage.v1",
        &storage.selection_receipt_bytes,
        &storage.selection_receipt_storage_digest,
    )?;
    let candidate: StoredCandidateV1 = serde_json::from_value(storage.candidate_json.clone())
        .map_err(|e| unavailable(&e.to_string()))?;
    let selection: StoredSelectionV1 = serde_json::from_value(storage.selection_json.clone())
        .map_err(|e| unavailable(&e.to_string()))?;
    let selection_receipt: StoredSelectionReceiptV1 =
        serde_json::from_value(storage.selection_receipt_json.clone())
            .map_err(|e| unavailable(&e.to_string()))?;
    if serde_json::to_value(&candidate).map_err(|e| unavailable(&e.to_string()))?
        != storage.candidate_json
        || serde_json::to_vec(&candidate).map_err(|e| unavailable(&e.to_string()))?
            != storage.candidate_bytes
        || serde_json::to_value(&selection).map_err(|e| unavailable(&e.to_string()))?
            != storage.selection_json
        || serde_json::to_vec(&selection).map_err(|e| unavailable(&e.to_string()))?
            != storage.selection_bytes
        || serde_json::to_value(&selection_receipt).map_err(|e| unavailable(&e.to_string()))?
            != storage.selection_receipt_json
        || serde_json::to_vec(&selection_receipt).map_err(|e| unavailable(&e.to_string()))?
            != storage.selection_receipt_bytes
    {
        return Err(unavailable("R&D Selection canonical storage bytes changed"));
    }
    let handoff = ResolvedRdSelectionEnvelopeV1 {
        schema_version: 1,
        candidate,
        selection,
        selection_receipt,
    };
    verify_rd_meaning_and_outbox_v1(
        &handoff,
        &storage.selection_outbox_json,
        &storage.selection_outbox_digest,
        storage.selection_outbox_committed_at_epoch_ms,
    )?;
    Ok(handoff)
}

fn verify_rd_meaning_and_outbox_v1(
    handoff: &ResolvedRdSelectionEnvelopeV1,
    selection_outbox_json: &serde_json::Value,
    selection_outbox_digest: &str,
    selection_outbox_committed_at_epoch_ms: i64,
) -> Result<(), QualificationOwnerError> {
    let candidate = &handoff.candidate;
    let selection = &handoff.selection;
    let receipt = &handoff.selection_receipt;
    let candidate_digest = canonical_digest(
        "rd.qualification-candidate-cut.v1",
        &QualificationCandidateCutMeaningV1 {
            schema_version: candidate.schema_version,
            evidence_cut: &candidate.evidence_cut,
            artifact: &candidate.artifact,
            protected_robustness_plan: &candidate.protected_robustness_plan,
            trial_family_policy_digest: &candidate.trial_family_policy_digest,
            consumed_trial_budget: candidate.consumed_trial_budget,
            frozen_falsifier_binding: &candidate.frozen_falsifier_binding,
            stop_rule: &candidate.stop_rule,
            cost_model_identity: &candidate.cost_model_identity,
            slippage_model_identity: &candidate.slippage_model_identity,
            capacity_model_identity: &candidate.capacity_model_identity,
            semantic_predecessor_frontier: &candidate.semantic_predecessor_frontier,
            protected_feedback_frontier: &candidate.protected_feedback_frontier,
            independence_disposition: &candidate.independence_disposition,
            independence_basis_identity: &candidate.independence_basis_identity,
        },
    )?;
    let selection_digest = canonical_digest(
        "rd.research-selection.v1",
        &ResearchSelectionMeaningV1 {
            schema_version: selection.schema_version,
            disposition: &selection.disposition,
            rationale: &selection.rationale,
            candidate_identity: &selection.candidate_identity,
            candidate_digest: &selection.candidate_digest,
            assessment_identity: &selection.assessment_identity,
            assessment_digest: &selection.assessment_digest,
            decision_identity: &selection.decision_identity,
            decision_digest: &selection.decision_digest,
            evidence_cut: &selection.evidence_cut,
            cost_model_identity: &selection.cost_model_identity,
            slippage_model_identity: &selection.slippage_model_identity,
            capacity_model_identity: &selection.capacity_model_identity,
            protected_decision_policy_identity: &selection.protected_decision_policy_identity,
            protected_decision_policy_version: selection.protected_decision_policy_version,
        },
    )?;
    let receipt_digest = canonical_digest(
        "rd.research-selection-receipt.v1",
        &ResearchSelectionReceiptMeaningV1 {
            schema_version: receipt.schema_version,
            selection_identity: &receipt.selection_identity,
            selection_digest: &receipt.selection_digest,
            candidate_identity: &receipt.candidate_identity,
            candidate_digest: &receipt.candidate_digest,
            decision_identity: &receipt.decision_identity,
            result_identity: &receipt.result_identity,
            committed_at_epoch_ms: receipt.committed_at_epoch_ms,
        },
    )?;
    let expected_outbox = StoredSelectionCommittedOutboxV1 {
        schema_version: 1,
        selection_identity: selection.selection_identity.clone(),
        selection_digest: selection.selection_digest.clone(),
        selection_receipt_identity: receipt.receipt_identity.clone(),
        candidate_identity: candidate.candidate_identity.clone(),
        candidate_digest: candidate.candidate_digest.clone(),
        assessment_identity: selection.assessment_identity.clone(),
        decision_identity: selection.decision_identity.clone(),
        trial_family_identity: selection.evidence_cut.trial_family_identity.clone(),
        result_identity: selection.evidence_cut.result_identity.clone(),
        protected_plan_identity: candidate.protected_robustness_plan.plan_identity.clone(),
        protected_plan_version: candidate.protected_robustness_plan.plan_version,
    };
    if candidate_digest != candidate.candidate_digest
        || identity("rd-qualification-candidate-v1", &candidate_digest)
            != candidate.candidate_identity
        || selection_digest != selection.selection_digest
        || identity("rd-research-selection-v1", &selection_digest) != selection.selection_identity
        || identity("rd-research-selection-receipt-v1", &receipt_digest) != receipt.receipt_identity
        || selection_outbox_json
            != &serde_json::to_value(&expected_outbox).map_err(|e| unavailable(&e.to_string()))?
        || canonical_digest("rd.owner-outbox.research-selection.v1", &expected_outbox)?
            != selection_outbox_digest
        || i64::try_from(receipt.committed_at_epoch_ms).map_err(|e| unavailable(&e.to_string()))?
            != selection_outbox_committed_at_epoch_ms
    {
        return Err(unavailable(
            "R&D Candidate/Selection Owner readback changed",
        ));
    }
    Ok(())
}

#[derive(Serialize)]
struct QualificationCandidateCutMeaningV1<'a> {
    schema_version: u16,
    evidence_cut: &'a EvidenceCutV1,
    artifact: &'a EvidenceReferenceV1,
    protected_robustness_plan: &'a ProtectedPlanV1,
    trial_family_policy_digest: &'a str,
    consumed_trial_budget: u32,
    frozen_falsifier_binding: &'a str,
    stop_rule: &'a str,
    cost_model_identity: &'a str,
    slippage_model_identity: &'a str,
    capacity_model_identity: &'a str,
    semantic_predecessor_frontier: &'a [String],
    protected_feedback_frontier: &'a str,
    independence_disposition: &'a str,
    independence_basis_identity: &'a str,
}

#[derive(Serialize)]
struct ResearchSelectionMeaningV1<'a> {
    schema_version: u16,
    disposition: &'a str,
    rationale: &'a str,
    candidate_identity: &'a str,
    candidate_digest: &'a str,
    assessment_identity: &'a str,
    assessment_digest: &'a str,
    decision_identity: &'a str,
    decision_digest: &'a str,
    evidence_cut: &'a EvidenceCutV1,
    cost_model_identity: &'a str,
    slippage_model_identity: &'a str,
    capacity_model_identity: &'a str,
    protected_decision_policy_identity: &'a str,
    protected_decision_policy_version: u64,
}

#[derive(Serialize)]
struct ResearchSelectionReceiptMeaningV1<'a> {
    schema_version: u16,
    selection_identity: &'a str,
    selection_digest: &'a str,
    candidate_identity: &'a str,
    candidate_digest: &'a str,
    decision_identity: &'a str,
    result_identity: &'a str,
    committed_at_epoch_ms: u64,
}

fn verify_storage(
    domain: &str,
    bytes: &[u8],
    expected: &str,
) -> Result<(), QualificationOwnerError> {
    let mut hasher = blake3::Hasher::new();
    hasher.update(domain.as_bytes());
    hasher.update(&[0]);
    hasher.update(bytes);
    let actual = format!("blake3:{}", hasher.finalize().to_hex());
    if actual != expected {
        return Err(unavailable("R&D Selection storage digest mismatch"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn digest(byte: char) -> String {
        format!("sha256:{}", byte.to_string().repeat(64))
    }
    fn reference(identity: &str, byte: char) -> EvidenceReferenceV1 {
        EvidenceReferenceV1 {
            identity: identity.into(),
            digest: digest(byte),
        }
    }

    fn fixture() -> (CandidateIntakeRequestV1, ResolvedRdSelectionEnvelopeV1) {
        let evidence_cut = EvidenceCutV1 {
            decision_policy_identity: "rd-decision-policy".into(),
            decision_policy_version: 1,
            decision_policy_digest: [1; 32],
            decision_policy_binding_digest: [2; 32],
            trial_family_identity: "trial-family".into(),
            census_frontier_identity: "census".into(),
            census_frontier_digest: digest('1'),
            attempt_frontier_identity: "attempt-frontier".into(),
            attempt_frontier_digest: digest('2'),
            candidate_set_frontier_identity: "candidate-set".into(),
            candidate_set_frontier_digest: digest('3'),
            request_identity: "replay-request".into(),
            request_digest: digest('4'),
            result_identity: "replay-result".into(),
            result_digest: digest('5'),
            attempt_identity: "attempt".into(),
        };
        let artifact = reference("artifact", '6');
        let proposal = ProtectedPlanProposalV1 {
            required_time_windows: vec![
                TimeWindowV1 {
                    evidence: reference("window-a", '7'),
                    start_epoch_ms: 1,
                    end_epoch_ms: 2,
                },
                TimeWindowV1 {
                    evidence: reference("window-b", '8'),
                    start_epoch_ms: 3,
                    end_epoch_ms: 4,
                },
            ],
            required_regimes: vec![
                MarketRegimeV1 {
                    evidence: reference("regime-normal", '9'),
                    adverse: false,
                },
                MarketRegimeV1 {
                    evidence: reference("regime-adverse", 'a'),
                    adverse: true,
                },
            ],
            required_instrument_slices: vec![reference("instrument", 'b')],
            instrument_scope: InstrumentScopeV1::SingleInstrument,
            instrument_non_applicability_basis: None,
            required_perturbations: vec![InputPerturbationV1 {
                input_class: reference("prices", 'c'),
                perturbation: reference("price-jitter", 'd'),
            }],
            required_parameter_neighborhoods: vec![ParameterNeighborhoodV1 {
                parameter: reference("lookback", 'e'),
                lower: 9,
                center: 10,
                upper: 11,
            }],
            no_tunable_parameters_basis: None,
            preregistered_capacity_ceiling: 100,
            metric: reference("metric", 'f'),
            coverage_policy: reference("coverage", '1'),
            tolerance_policy: reference("tolerance", '2'),
            threshold_policy: reference("threshold", '3'),
            aggregation_policy: reference("aggregation", '4'),
            missing_cell_policy: reference("missing", '5'),
            stop_policy: reference("stop", '6'),
            purge_policy: reference("purge", '7'),
            embargo_policy: reference("embargo", '8'),
            multiplicity_policy: reference("multiplicity", '9'),
            protected_decision_policy: ProtectedPolicyV1 {
                identity: "protected-policy".into(),
                version: 1,
                digest: digest('a'),
            },
        };
        let mut plan = ProtectedPlanV1 {
            schema_version: 1,
            plan_identity: "protected-plan".into(),
            plan_version: 1,
            plan_digest: digest('b'),
            trial_family_identity: "trial-family".into(),
            trial_family_digest: digest('c'),
            census_frontier_identity: "census".into(),
            census_frontier_digest: digest('1'),
            attempt_frontier_identity: "attempt-frontier".into(),
            attempt_frontier_digest: digest('2'),
            artifact: artifact.clone(),
            pit_rule_identity: "pit-rule".into(),
            cost_model_identity: "cost".into(),
            slippage_model_identity: "slippage".into(),
            capacity_model_identity: "capacity".into(),
            decision_policy_identity: "rd-decision-policy".into(),
            decision_policy_version: 1,
            proposal,
        };
        let plan_digest = canonical_digest(
            "rd.protected-robustness-plan.v1",
            &ProtectedPlanMeaningV1 {
                schema_version: plan.schema_version,
                plan_version: plan.plan_version,
                trial_family_identity: &plan.trial_family_identity,
                trial_family_digest: &plan.trial_family_digest,
                census_frontier_identity: &plan.census_frontier_identity,
                census_frontier_digest: &plan.census_frontier_digest,
                attempt_frontier_identity: &plan.attempt_frontier_identity,
                attempt_frontier_digest: &plan.attempt_frontier_digest,
                artifact: &plan.artifact,
                pit_rule_identity: &plan.pit_rule_identity,
                cost_model_identity: &plan.cost_model_identity,
                slippage_model_identity: &plan.slippage_model_identity,
                capacity_model_identity: &plan.capacity_model_identity,
                decision_policy_identity: &plan.decision_policy_identity,
                decision_policy_version: plan.decision_policy_version,
                proposal: &plan.proposal,
            },
        )
        .unwrap();
        plan.plan_identity = identity("rd-protected-robustness-plan-v1", &plan_digest);
        plan.plan_digest = plan_digest;
        let candidate = StoredCandidateV1 {
            schema_version: 1,
            candidate_identity: "candidate".into(),
            candidate_digest: digest('d'),
            evidence_cut: evidence_cut.clone(),
            artifact,
            protected_robustness_plan: plan,
            trial_family_policy_digest: digest('e'),
            consumed_trial_budget: 1,
            frozen_falsifier_binding: "falsifier".into(),
            stop_rule: "stop-rule".into(),
            cost_model_identity: "cost".into(),
            slippage_model_identity: "slippage".into(),
            capacity_model_identity: "capacity".into(),
            semantic_predecessor_frontier: vec![],
            protected_feedback_frontier: "feedback".into(),
            independence_disposition: "INDEPENDENT".into(),
            independence_basis_identity: "basis".into(),
        };
        let selection = StoredSelectionV1 {
            schema_version: 1,
            selection_identity: "selection".into(),
            selection_digest: digest('f'),
            disposition: "SELECTED_FOR_QUALIFICATION".into(),
            rationale: "POSITIVE_ASSESSMENT_SATISFIED".into(),
            candidate_identity: "candidate".into(),
            candidate_digest: digest('d'),
            assessment_identity: "assessment".into(),
            assessment_digest: digest('e'),
            decision_identity: "decision".into(),
            decision_digest: digest('f'),
            evidence_cut,
            cost_model_identity: "cost".into(),
            slippage_model_identity: "slippage".into(),
            capacity_model_identity: "capacity".into(),
            protected_decision_policy_identity: "protected-policy".into(),
            protected_decision_policy_version: 1,
        };
        let selection_receipt = StoredSelectionReceiptV1 {
            schema_version: 1,
            receipt_identity: "selection-receipt".into(),
            selection_identity: "selection".into(),
            selection_digest: digest('f'),
            candidate_identity: "candidate".into(),
            candidate_digest: digest('d'),
            decision_identity: "decision".into(),
            result_identity: "replay-result".into(),
            committed_at_epoch_ms: 10,
        };
        (
            CandidateIntakeRequestV1::new(
                "review".into(),
                "decision".into(),
                "replay-result".into(),
                "candidate".into(),
                "selection".into(),
                "protected-policy".into(),
                1,
            )
            .unwrap(),
            ResolvedRdSelectionEnvelopeV1 {
                schema_version: 1,
                candidate,
                selection,
                selection_receipt,
            },
        )
    }

    #[test]
    fn adequate_plan_admits_once_with_holdout_reservation() {
        let (request, envelope) = fixture();
        let receipt = form_candidate_intake_receipt_v1(&request, &envelope, 20).unwrap();
        assert_eq!(receipt.status(), CandidateIntakeStatusV1::Admitted);
        assert!(receipt.holdout_reservation_identity().is_some());
        assert_eq!(
            decode_intake_receipt_v1(&receipt.as_json().unwrap()).unwrap(),
            receipt
        );
    }

    #[test]
    fn protected_request_freezes_one_canonical_cell_and_all_sixteen_bindings() {
        use crate::protected_replay_request::{
            ProtectedReplayBindingFieldV1, ProtectedReplayBindingV1,
            ProtectedReplayRequestProposalV1, form_protected_replay_request_v1,
        };

        let (intake_request, envelope) = fixture();
        let receipt = form_candidate_intake_receipt_v1(&intake_request, &envelope, 20).unwrap();
        let source = protected_replay_authority_source_v1(&receipt, &envelope).unwrap();
        assert_eq!(source.plan_cells.len(), 4);
        let mut bindings = ProtectedReplayBindingFieldV1::ALL
            .into_iter()
            .enumerate()
            .map(|(index, field)| ProtectedReplayBindingV1 {
                field,
                identity: format!("requested-binding-{index}"),
                digest: digest(char::from_digit((index % 10) as u32, 10).unwrap()),
            })
            .collect::<Vec<_>>();
        for (index, identity_value, digest_value) in [
            (0, &source.plan_identity, &source.plan_digest),
            (1, &source.artifact_identity, &source.artifact_digest),
            (
                12,
                &source.purge_embargo_policy_identity,
                &source.purge_embargo_policy_digest,
            ),
            (
                14,
                &source.multiplicity_basis_identity,
                &source.multiplicity_basis_digest,
            ),
            (
                15,
                &source.alternatives_thresholds_identity,
                &source.alternatives_thresholds_digest,
            ),
        ] {
            bindings[index].identity = identity_value.clone();
            bindings[index].digest = digest_value.clone();
        }
        for (index, identity_value) in [
            (9, &source.cost_model_identity),
            (10, &source.slippage_model_identity),
            (11, &source.capacity_model_identity),
        ] {
            bindings[index].identity = identity_value.clone();
        }
        let proposal = ProtectedReplayRequestProposalV1::new(
            "protected-request-1".into(),
            receipt.review_request_identity().into(),
            receipt.receipt_identity().into(),
            receipt.receipt_digest().into(),
            2,
            bindings.clone(),
        )
        .unwrap();
        let request = form_protected_replay_request_v1(&proposal, &receipt, &source).unwrap();
        let request_json = request.as_json().unwrap();
        assert_eq!(request_json["bindings"].as_array().unwrap().len(), 16);
        assert_eq!(
            request_json["plan_cell_identity"],
            serde_json::Value::String(source.plan_cells[2].0.clone())
        );

        bindings.swap(2, 3);
        assert!(
            ProtectedReplayRequestProposalV1::new(
                "protected-request-2".into(),
                receipt.review_request_identity().into(),
                receipt.receipt_identity().into(),
                receipt.receipt_digest().into(),
                0,
                bindings,
            )
            .is_err()
        );
    }

    #[test]
    fn inadequate_plan_closes_without_holdout_and_cross_splice_is_unavailable() {
        let (request, mut envelope) = fixture();
        envelope
            .candidate
            .protected_robustness_plan
            .proposal
            .required_time_windows
            .pop();
        let receipt = form_candidate_intake_receipt_v1(&request, &envelope, 20).unwrap();
        assert_eq!(receipt.status(), CandidateIntakeStatusV1::NotAdmitted);
        assert!(receipt.holdout_reservation_identity().is_none());
        envelope.selection.candidate_identity = "other-candidate".into();
        assert!(form_candidate_intake_receipt_v1(&request, &envelope, 20).is_err());
    }
}
