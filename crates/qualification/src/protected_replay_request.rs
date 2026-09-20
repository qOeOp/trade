use serde::{Deserialize, Serialize};
use vibe_backtest_owner_contracts::{
    CanonicalDigestV2, OpaqueIdentityV2, PROTECTED_REPLAY_BINDING_COUNT_V1,
    ProtectedEconomicPolicyBundleV1, ProtectedEvaluationComparisonRuleV1,
    ProtectedEvaluationStageV1, ProtectedEvaluationTimeEvidenceV1, ProtectedReplayRequestDtoV1,
    ProtectedReplayRequestDtoV2, ProtectedReplayRequestLocatorV1,
    ProtectedReplayRequestSetMemberV1, ProtectedReplayRequestSetSealDtoV1,
    protected_evaluation_time_evidence_digest_v1,
};
pub(crate) use vibe_backtest_owner_contracts::{
    ProtectedReplayBindingFieldV1, ProtectedReplayBindingV1,
};
use vibe_data::owner::shared_time_evidence::{ClockHeadComparisonRule, ClockHeadHandoff};

use crate::candidate_intake::ProtectedReplayAuthoritySourceV1;
use crate::postgres::{canonical_digest, identity};
use crate::{CandidateIntakeReceiptV1, QualificationOwnerError};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProtectedReplayRequestProposalV1 {
    request_identity: String,
    review_request_identity: String,
    intake_receipt_identity: String,
    intake_receipt_digest: String,
    plan_cell_ordinal: u32,
    bindings: [ProtectedReplayBindingV1; PROTECTED_REPLAY_BINDING_COUNT_V1],
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProtectedReplayRequestProposalV2 {
    frozen_basis: ProtectedReplayRequestProposalV1,
    request_time_handoff: ClockHeadHandoff,
}

impl ProtectedReplayRequestProposalV2 {
    pub fn new(
        frozen_basis: ProtectedReplayRequestProposalV1,
        request_time_handoff: ClockHeadHandoff,
    ) -> Self {
        Self {
            frozen_basis,
            request_time_handoff,
        }
    }

    pub(crate) fn request_identity(&self) -> &str {
        self.frozen_basis.request_identity()
    }
    pub(crate) fn review_request_identity(&self) -> &str {
        self.frozen_basis.review_request_identity()
    }
    pub(crate) fn intake_receipt_identity(&self) -> &str {
        self.frozen_basis.intake_receipt_identity()
    }
    pub(crate) fn intake_receipt_digest(&self) -> &str {
        self.frozen_basis.intake_receipt_digest()
    }
}

impl ProtectedReplayRequestProposalV1 {
    pub fn new(
        request_identity: String,
        review_request_identity: String,
        intake_receipt_identity: String,
        intake_receipt_digest: String,
        plan_cell_ordinal: u32,
        bindings: Vec<ProtectedReplayBindingV1>,
    ) -> Result<Self, QualificationOwnerError> {
        let bindings = bindings
            .try_into()
            .map_err(|_| unavailable("Protected Replay Request requires exactly 16 bindings"))?;
        let value = Self {
            request_identity,
            review_request_identity,
            intake_receipt_identity,
            intake_receipt_digest,
            plan_cell_ordinal,
            bindings,
        };
        value.validate()?;
        Ok(value)
    }

    pub(crate) fn request_identity(&self) -> &str {
        &self.request_identity
    }
    pub(crate) fn review_request_identity(&self) -> &str {
        &self.review_request_identity
    }
    pub(crate) fn intake_receipt_identity(&self) -> &str {
        &self.intake_receipt_identity
    }
    pub(crate) fn intake_receipt_digest(&self) -> &str {
        &self.intake_receipt_digest
    }

    fn validate(&self) -> Result<(), QualificationOwnerError> {
        for value in [
            &self.request_identity,
            &self.review_request_identity,
            &self.intake_receipt_identity,
        ] {
            if value.len() < 4
                || value.len() > 256
                || !value.bytes().all(|byte| byte.is_ascii_graphic())
            {
                return Err(unavailable("Protected Replay Request identity is invalid"));
            }
        }

        if !valid_digest(&self.intake_receipt_digest) {
            return Err(unavailable("Candidate Intake receipt digest is invalid"));
        }

        for (binding, expected) in self.bindings.iter().zip(ProtectedReplayBindingFieldV1::ALL) {
            if binding.field != expected
                || binding.identity.len() < 4
                || binding.identity.len() > 256
                || OpaqueIdentityV2::try_from(binding.identity.clone()).is_err()
                || !valid_digest(&binding.digest)
            {
                return Err(unavailable(
                    "Protected Replay Request bindings are noncanonical",
                ));
            }
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ProtectedReplayRequestV1 {
    schema_version: u16,
    request_identity: String,
    request_digest: String,
    candidate_identity: String,
    candidate_digest: String,
    review_request_identity: String,
    intake_receipt_identity: String,
    intake_receipt_digest: String,
    holdout_reservation_identity: String,
    protected_decision_policy_identity: String,
    protected_decision_policy_version: u64,
    trial_family_identity: String,
    trial_family_digest: String,
    protected_plan_identity: String,
    protected_plan_digest: String,
    plan_cell_set_identity: String,
    plan_cell_set_digest: String,
    plan_cell_identity: String,
    plan_cell_digest: String,
    bindings: [ProtectedReplayBindingV1; PROTECTED_REPLAY_BINDING_COUNT_V1],
    state: String,
}

#[derive(Serialize)]
struct RequestMeaningV1<'a> {
    schema_version: u16,
    request_identity: &'a str,
    candidate_identity: &'a str,
    candidate_digest: &'a str,
    review_request_identity: &'a str,
    intake_receipt_identity: &'a str,
    intake_receipt_digest: &'a str,
    holdout_reservation_identity: &'a str,
    protected_decision_policy_identity: &'a str,
    protected_decision_policy_version: u64,
    trial_family_identity: &'a str,
    trial_family_digest: &'a str,
    protected_plan_identity: &'a str,
    protected_plan_digest: &'a str,
    plan_cell_set_identity: &'a str,
    plan_cell_set_digest: &'a str,
    plan_cell_identity: &'a str,
    plan_cell_digest: &'a str,
    bindings: &'a [ProtectedReplayBindingV1; PROTECTED_REPLAY_BINDING_COUNT_V1],
    state: &'a str,
}

pub(crate) fn form_protected_replay_request_v1(
    proposal: &ProtectedReplayRequestProposalV1,
    intake: &CandidateIntakeReceiptV1,
    source: &ProtectedReplayAuthoritySourceV1,
) -> Result<ProtectedReplayRequestV1, QualificationOwnerError> {
    proposal.validate()?;
    let reservation = intake
        .holdout_reservation_identity()
        .ok_or_else(|| unavailable("ADMITTED holdout reservation is unavailable"))?;

    if intake.receipt_identity() != proposal.intake_receipt_identity
        || intake.receipt_digest() != proposal.intake_receipt_digest
        || intake.review_request_identity() != proposal.review_request_identity
    {
        return Err(unavailable("Candidate Intake locator is cross-spliced"));
    }
    let cell = source
        .plan_cells
        .get(proposal.plan_cell_ordinal as usize)
        .ok_or_else(|| unavailable("Protected Robustness Plan cell is unavailable"))?;
    assert_binding(
        &proposal.bindings[0],
        &source.plan_identity,
        &source.plan_digest,
    )?;
    assert_binding(
        &proposal.bindings[1],
        &source.artifact_identity,
        &source.artifact_digest,
    )?;
    assert_identity(&proposal.bindings[9], &source.cost_model_identity)?;
    assert_identity(&proposal.bindings[10], &source.slippage_model_identity)?;
    assert_identity(&proposal.bindings[11], &source.capacity_model_identity)?;
    assert_binding(
        &proposal.bindings[12],
        &source.purge_embargo_policy_identity,
        &source.purge_embargo_policy_digest,
    )?;
    assert_binding(
        &proposal.bindings[14],
        &source.multiplicity_basis_identity,
        &source.multiplicity_basis_digest,
    )?;
    assert_binding(
        &proposal.bindings[15],
        &source.alternatives_thresholds_identity,
        &source.alternatives_thresholds_digest,
    )?;
    let meaning = RequestMeaningV1 {
        schema_version: 1,
        request_identity: &proposal.request_identity,
        candidate_identity: &source.candidate_identity,
        candidate_digest: &source.candidate_digest,
        review_request_identity: &proposal.review_request_identity,
        intake_receipt_identity: &proposal.intake_receipt_identity,
        intake_receipt_digest: &proposal.intake_receipt_digest,
        holdout_reservation_identity: reservation,
        protected_decision_policy_identity: &source.protected_decision_policy_identity,
        protected_decision_policy_version: source.protected_decision_policy_version,
        trial_family_identity: &source.trial_family_identity,
        trial_family_digest: &source.trial_family_digest,
        protected_plan_identity: &source.plan_identity,
        protected_plan_digest: &source.plan_digest,
        plan_cell_set_identity: &source.plan_cell_set_identity,
        plan_cell_set_digest: &source.plan_cell_set_digest,
        plan_cell_identity: &cell.0,
        plan_cell_digest: &cell.1,
        bindings: &proposal.bindings,
        state: "FROZEN",
    };
    let request_digest = canonical_digest("qualification.protected-replay-request.v1", &meaning)?;
    Ok(ProtectedReplayRequestV1 {
        schema_version: 1,
        request_identity: proposal.request_identity.clone(),
        request_digest,
        candidate_identity: source.candidate_identity.clone(),
        candidate_digest: source.candidate_digest.clone(),
        review_request_identity: proposal.review_request_identity.clone(),
        intake_receipt_identity: proposal.intake_receipt_identity.clone(),
        intake_receipt_digest: proposal.intake_receipt_digest.clone(),
        holdout_reservation_identity: reservation.to_string(),
        protected_decision_policy_identity: source.protected_decision_policy_identity.clone(),
        protected_decision_policy_version: source.protected_decision_policy_version,
        trial_family_identity: source.trial_family_identity.clone(),
        trial_family_digest: source.trial_family_digest.clone(),
        protected_plan_identity: source.plan_identity.clone(),
        protected_plan_digest: source.plan_digest.clone(),
        plan_cell_set_identity: source.plan_cell_set_identity.clone(),
        plan_cell_set_digest: source.plan_cell_set_digest.clone(),
        plan_cell_identity: cell.0.clone(),
        plan_cell_digest: cell.1.clone(),
        bindings: proposal.bindings.clone(),
        state: "FROZEN".to_string(),
    })
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(transparent)]
pub(crate) struct ProtectedReplayRequestV2(ProtectedReplayRequestDtoV2);

pub(crate) fn form_protected_replay_request_v2(
    proposal: &ProtectedReplayRequestProposalV2,
    intake: &CandidateIntakeReceiptV1,
    source: &ProtectedReplayAuthoritySourceV1,
) -> Result<ProtectedReplayRequestV2, QualificationOwnerError> {
    let frozen_basis = form_protected_replay_request_v1(&proposal.frozen_basis, intake, source)?;
    let frozen_basis = frozen_basis.as_contract_dto();
    let request_time_evidence = request_time_evidence(&proposal.request_time_handoff);
    request_time_evidence
        .validate_request_root()
        .map_err(|e| unavailable(&e.to_string()))?;
    let mut dto = ProtectedReplayRequestDtoV2 {
        schema_version: 2,
        request_identity: frozen_basis.request_identity.clone(),
        request_digest: format!("sha256:{}", "0".repeat(64)),
        frozen_basis,
        request_time_evidence,
    };
    dto.request_digest = dto
        .compute_request_digest()
        .map_err(|e| unavailable(&e.to_string()))?;
    dto.validate().map_err(|e| unavailable(&e.to_string()))?;
    Ok(ProtectedReplayRequestV2(dto))
}

fn request_time_evidence(handoff: &ClockHeadHandoff) -> ProtectedEvaluationTimeEvidenceV1 {
    ProtectedEvaluationTimeEvidenceV1 {
        cut_kind: "PROTECTED_EVALUATION".to_string(),
        stage: ProtectedEvaluationStageV1::Request,
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
        direct_predecessor_head_identity: None,
        direct_predecessor_head_digest: None,
        epoch_successor_proof: None,
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ProtectedReplayRequestReceiptV1 {
    schema_version: u16,
    receipt_identity: String,
    receipt_digest: String,
    request_identity: String,
    request_digest: String,
    seal_digest: String,
    committed_at_epoch_ms: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ProtectedReplayRequestCommitV1 {
    locator: ProtectedReplayRequestLocatorV1,
    request: serde_json::Value,
    receipt: serde_json::Value,
}

/// Qualification-owned seal of every request required by one admitted protected plan.
/// Callers can relay this value but cannot construct or deserialize it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(transparent)]
pub struct ProtectedReplayRequestSetCommitV1(ProtectedReplayRequestSetSealDtoV1);

impl ProtectedReplayRequestSetCommitV1 {
    pub fn request_set_identity(&self) -> &str {
        &self.0.request_set_identity
    }

    pub fn request_set_digest(&self) -> &str {
        &self.0.request_set_digest
    }

    pub(crate) fn seal(&self) -> &ProtectedReplayRequestSetSealDtoV1 {
        &self.0
    }

    pub(crate) fn to_canonical_bytes(&self) -> Result<Vec<u8>, QualificationOwnerError> {
        self.0
            .to_canonical_bytes()
            .map_err(|e| unavailable(&e.to_string()))
    }

    pub(crate) fn as_json(&self) -> Result<serde_json::Value, QualificationOwnerError> {
        serde_json::to_value(&self.0).map_err(|e| unavailable(&e.to_string()))
    }
}

pub(crate) fn decode_protected_replay_request_set_v1(
    bytes: &[u8],
) -> Result<ProtectedReplayRequestSetCommitV1, QualificationOwnerError> {
    ProtectedReplayRequestSetSealDtoV1::from_canonical_bytes(bytes)
        .map(ProtectedReplayRequestSetCommitV1)
        .map_err(|e| unavailable(&e.to_string()))
}

pub(crate) fn form_protected_replay_request_set_v1(
    intake: &CandidateIntakeReceiptV1,
    source: &ProtectedReplayAuthoritySourceV1,
    requests: &[(ProtectedReplayRequestV2, ProtectedReplayRequestReceiptV1)],
    economic_policy: &ProtectedEconomicPolicyBundleV1,
) -> Result<ProtectedReplayRequestSetCommitV1, QualificationOwnerError> {
    let reservation_identity = intake
        .holdout_reservation_identity()
        .ok_or_else(|| unavailable("ADMITTED holdout reservation is unavailable"))?;
    if requests.len() != source.plan_cells.len() || requests.is_empty() {
        return Err(unavailable(
            "complete Protected Replay Request cell census is unavailable",
        ));
    }

    let mut members = Vec::with_capacity(requests.len());
    for (request, receipt) in requests {
        let dto = request.as_contract_dto();
        if dto.frozen_basis.candidate_identity != source.candidate_identity
            || dto.frozen_basis.candidate_digest != source.candidate_digest
            || dto.frozen_basis.review_request_identity != intake.review_request_identity()
            || dto.frozen_basis.intake_receipt_identity != intake.receipt_identity()
            || dto.frozen_basis.intake_receipt_digest != intake.receipt_digest()
            || dto.frozen_basis.holdout_reservation_identity != reservation_identity
            || dto.frozen_basis.protected_decision_policy_identity
                != source.protected_decision_policy_identity
            || dto.frozen_basis.protected_decision_policy_version
                != source.protected_decision_policy_version
            || dto.frozen_basis.protected_plan_identity != source.plan_identity
            || dto.frozen_basis.protected_plan_digest != source.plan_digest
            || dto.frozen_basis.plan_cell_set_identity != source.plan_cell_set_identity
            || dto.frozen_basis.plan_cell_set_digest != source.plan_cell_set_digest
            || receipt.request_digest() != dto.request_digest
        {
            return Err(unavailable("Protected Replay Request set is cross-spliced"));
        }
        members.push(ProtectedReplayRequestSetMemberV1 {
            request_identity: dto.request_identity.clone(),
            request_digest: dto.request_digest.clone(),
            request_receipt_identity: receipt.receipt_identity().to_string(),
            request_seal_digest: receipt.seal_digest().to_string(),
            plan_cell_identity: dto.frozen_basis.plan_cell_identity.clone(),
            plan_cell_digest: dto.frozen_basis.plan_cell_digest.clone(),
            request_time_evidence_digest: protected_evaluation_time_evidence_digest_v1(
                &dto.request_time_evidence,
            )
            .map_err(|e| unavailable(&e.to_string()))?,
        });
    }

    let observed_cells = members
        .iter()
        .map(|member| {
            (
                member.plan_cell_identity.clone(),
                member.plan_cell_digest.clone(),
            )
        })
        .collect::<std::collections::BTreeSet<_>>();
    let expected_cells = source
        .plan_cells
        .iter()
        .cloned()
        .collect::<std::collections::BTreeSet<_>>();

    if observed_cells != expected_cells {
        return Err(unavailable(
            "Protected Replay Request set does not match the frozen plan cell set",
        ));
    }

    let seal = ProtectedReplayRequestSetSealDtoV1 {
        schema_version: 2,
        request_set_identity: "pending-request-set-identity".to_string(),
        request_set_digest: format!("sha256:{}", "0".repeat(64)),
        candidate_identity: source.candidate_identity.clone(),
        candidate_digest: source.candidate_digest.clone(),
        intake_receipt_identity: intake.receipt_identity().to_string(),
        intake_receipt_digest: intake.receipt_digest().to_string(),
        holdout_reservation_identity: reservation_identity.to_string(),
        holdout_reservation_digest: source.holdout_reservation_digest.clone(),
        protected_decision_policy_identity: source.protected_decision_policy_identity.clone(),
        protected_decision_policy_version: source.protected_decision_policy_version,
        protected_plan_identity: source.plan_identity.clone(),
        protected_plan_digest: source.plan_digest.clone(),
        plan_cell_set_identity: source.plan_cell_set_identity.clone(),
        plan_cell_set_digest: source.plan_cell_set_digest.clone(),
        missing_cell_policy_identity: source.missing_cell_policy_identity.clone(),
        missing_cell_policy_digest: source.missing_cell_policy_digest.clone(),
        stop_policy_identity: source.stop_policy_identity.clone(),
        stop_policy_digest: source.stop_policy_digest.clone(),
        protected_economic_policy_bundle: economic_policy.clone(),
        members,
    }
    .seal()
    .map_err(|e| unavailable(&e.to_string()))?;
    Ok(ProtectedReplayRequestSetCommitV1(seal))
}

impl ProtectedReplayRequestCommitV1 {
    pub fn locator(&self) -> &ProtectedReplayRequestLocatorV1 {
        &self.locator
    }
}

pub(crate) fn form_request_receipt_v1(
    request: &ProtectedReplayRequestV1,
    committed_at_epoch_ms: u64,
) -> Result<ProtectedReplayRequestReceiptV1, QualificationOwnerError> {
    let request_bytes = serde_json::to_vec(request).map_err(|e| unavailable(&e.to_string()))?;
    let seal_digest = canonical_digest(
        "qualification.protected-replay-request-seal.v1",
        &request_bytes,
    )?;
    let receipt_digest = canonical_digest(
        "qualification.protected-replay-request-receipt.v1",
        &(
            &request.request_identity,
            &request.request_digest,
            &seal_digest,
            committed_at_epoch_ms,
        ),
    )?;
    Ok(ProtectedReplayRequestReceiptV1 {
        schema_version: 1,
        receipt_identity: identity(
            "qualification-protected-replay-request-receipt-v1",
            &receipt_digest,
        ),
        receipt_digest,
        request_identity: request.request_identity.clone(),
        request_digest: request.request_digest.clone(),
        seal_digest,
        committed_at_epoch_ms,
    })
}

pub(crate) fn form_request_receipt_v2(
    request: &ProtectedReplayRequestV2,
    committed_at_epoch_ms: u64,
) -> Result<ProtectedReplayRequestReceiptV1, QualificationOwnerError> {
    if committed_at_epoch_ms >= request.0.request_time_evidence.valid_through {
        return Err(unavailable(
            "Protected Replay Request time evidence expired before commit",
        ));
    }
    let request_bytes = serde_json::to_vec(request).map_err(|e| unavailable(&e.to_string()))?;
    let seal_digest = canonical_digest(
        "qualification.protected-replay-request-seal.v1",
        &request_bytes,
    )?;
    let receipt_digest = canonical_digest(
        "qualification.protected-replay-request-receipt.v1",
        &(
            request.request_identity(),
            request.request_digest(),
            &seal_digest,
            committed_at_epoch_ms,
        ),
    )?;
    Ok(ProtectedReplayRequestReceiptV1 {
        schema_version: 1,
        receipt_identity: identity(
            "qualification-protected-replay-request-receipt-v1",
            &receipt_digest,
        ),
        receipt_digest,
        request_identity: request.request_identity().to_string(),
        request_digest: request.request_digest().to_string(),
        seal_digest,
        committed_at_epoch_ms,
    })
}

impl ProtectedReplayRequestV1 {
    pub(crate) fn as_contract_dto(&self) -> ProtectedReplayRequestDtoV1 {
        ProtectedReplayRequestDtoV1 {
            schema_version: self.schema_version,
            request_identity: self.request_identity.clone(),
            request_digest: self.request_digest.clone(),
            candidate_identity: self.candidate_identity.clone(),
            candidate_digest: self.candidate_digest.clone(),
            review_request_identity: self.review_request_identity.clone(),
            intake_receipt_identity: self.intake_receipt_identity.clone(),
            intake_receipt_digest: self.intake_receipt_digest.clone(),
            holdout_reservation_identity: self.holdout_reservation_identity.clone(),
            protected_decision_policy_identity: self.protected_decision_policy_identity.clone(),
            protected_decision_policy_version: self.protected_decision_policy_version,
            trial_family_identity: self.trial_family_identity.clone(),
            trial_family_digest: self.trial_family_digest.clone(),
            protected_plan_identity: self.protected_plan_identity.clone(),
            protected_plan_digest: self.protected_plan_digest.clone(),
            plan_cell_set_identity: self.plan_cell_set_identity.clone(),
            plan_cell_set_digest: self.plan_cell_set_digest.clone(),
            plan_cell_identity: self.plan_cell_identity.clone(),
            plan_cell_digest: self.plan_cell_digest.clone(),
            bindings: self.bindings.clone(),
            state: self.state.clone(),
        }
    }
    pub(crate) fn request_identity(&self) -> &str {
        &self.request_identity
    }
    pub(crate) fn request_digest(&self) -> &str {
        &self.request_digest
    }
    pub(crate) fn review_request_identity(&self) -> &str {
        &self.review_request_identity
    }
    pub(crate) fn intake_receipt_identity(&self) -> &str {
        &self.intake_receipt_identity
    }
    pub(crate) fn holdout_reservation_identity(&self) -> &str {
        &self.holdout_reservation_identity
    }
    pub(crate) fn protected_plan_identity(&self) -> &str {
        &self.protected_plan_identity
    }
    pub(crate) fn protected_plan_digest(&self) -> &str {
        &self.protected_plan_digest
    }
    pub(crate) fn plan_cell_identity(&self) -> &str {
        &self.plan_cell_identity
    }
    pub(crate) fn plan_cell_digest(&self) -> &str {
        &self.plan_cell_digest
    }
    pub(crate) fn as_json(&self) -> Result<serde_json::Value, QualificationOwnerError> {
        serde_json::to_value(self).map_err(|e| unavailable(&e.to_string()))
    }
}

impl ProtectedReplayRequestV2 {
    pub(crate) fn as_contract_dto(&self) -> &ProtectedReplayRequestDtoV2 {
        &self.0
    }
    pub(crate) fn request_identity(&self) -> &str {
        &self.0.request_identity
    }
    pub(crate) fn request_digest(&self) -> &str {
        &self.0.request_digest
    }
    pub(crate) fn review_request_identity(&self) -> &str {
        &self.0.frozen_basis.review_request_identity
    }
    pub(crate) fn intake_receipt_identity(&self) -> &str {
        &self.0.frozen_basis.intake_receipt_identity
    }
    pub(crate) fn holdout_reservation_identity(&self) -> &str {
        &self.0.frozen_basis.holdout_reservation_identity
    }
    pub(crate) fn protected_plan_identity(&self) -> &str {
        &self.0.frozen_basis.protected_plan_identity
    }
    pub(crate) fn protected_plan_digest(&self) -> &str {
        &self.0.frozen_basis.protected_plan_digest
    }
    pub(crate) fn plan_cell_identity(&self) -> &str {
        &self.0.frozen_basis.plan_cell_identity
    }
    pub(crate) fn plan_cell_digest(&self) -> &str {
        &self.0.frozen_basis.plan_cell_digest
    }
    pub(crate) fn as_json(&self) -> Result<serde_json::Value, QualificationOwnerError> {
        serde_json::to_value(self).map_err(|e| unavailable(&e.to_string()))
    }
    pub(crate) fn to_canonical_bytes(&self) -> Result<Vec<u8>, QualificationOwnerError> {
        self.0
            .to_canonical_bytes()
            .map_err(|e| unavailable(&e.to_string()))
    }
}

pub(crate) fn decode_protected_replay_request_v1(
    bytes: &[u8],
) -> Result<ProtectedReplayRequestV1, QualificationOwnerError> {
    let request: ProtectedReplayRequestV1 =
        serde_json::from_slice(bytes).map_err(|e| unavailable(&e.to_string()))?;
    request
        .as_contract_dto()
        .validate()
        .map_err(|e| unavailable(&e.to_string()))?;
    if serde_json::to_vec(&request.as_json()?).map_err(|e| unavailable(&e.to_string()))? != bytes {
        return Err(unavailable("stored Protected Replay Request bytes changed"));
    }
    Ok(request)
}

pub(crate) fn decode_protected_replay_request_v2(
    bytes: &[u8],
) -> Result<ProtectedReplayRequestV2, QualificationOwnerError> {
    ProtectedReplayRequestDtoV2::from_canonical_bytes(bytes)
        .map(ProtectedReplayRequestV2)
        .map_err(|e| unavailable(&e.to_string()))
}

pub(crate) fn decode_request_receipt_v1(
    value: &serde_json::Value,
    request: &ProtectedReplayRequestV1,
) -> Result<ProtectedReplayRequestReceiptV1, QualificationOwnerError> {
    let receipt: ProtectedReplayRequestReceiptV1 =
        serde_json::from_value(value.clone()).map_err(|e| unavailable(&e.to_string()))?;
    if receipt != form_request_receipt_v1(request, receipt.committed_at_epoch_ms)?
        || receipt.as_json()? != *value
    {
        return Err(unavailable(
            "stored Protected Replay Request receipt changed",
        ));
    }
    Ok(receipt)
}

pub(crate) fn decode_request_receipt_v2(
    value: &serde_json::Value,
    request: &ProtectedReplayRequestV2,
) -> Result<ProtectedReplayRequestReceiptV1, QualificationOwnerError> {
    let receipt: ProtectedReplayRequestReceiptV1 =
        serde_json::from_value(value.clone()).map_err(|e| unavailable(&e.to_string()))?;
    if receipt != form_request_receipt_v2(request, receipt.committed_at_epoch_ms)?
        || receipt.as_json()? != *value
    {
        return Err(unavailable(
            "stored Protected Replay Request receipt changed",
        ));
    }
    Ok(receipt)
}

impl ProtectedReplayRequestReceiptV1 {
    pub(crate) fn receipt_identity(&self) -> &str {
        &self.receipt_identity
    }
    pub(crate) fn receipt_digest(&self) -> &str {
        &self.receipt_digest
    }
    pub(crate) fn request_digest(&self) -> &str {
        &self.request_digest
    }
    pub(crate) fn seal_digest(&self) -> &str {
        &self.seal_digest
    }
    pub(crate) fn committed_at_epoch_ms(&self) -> u64 {
        self.committed_at_epoch_ms
    }
    pub(crate) fn as_json(&self) -> Result<serde_json::Value, QualificationOwnerError> {
        serde_json::to_value(self).map_err(|e| unavailable(&e.to_string()))
    }
}

pub(crate) fn commit_projection(
    request: &ProtectedReplayRequestV1,
    receipt: &ProtectedReplayRequestReceiptV1,
) -> Result<ProtectedReplayRequestCommitV1, QualificationOwnerError> {
    Ok(ProtectedReplayRequestCommitV1 {
        locator: ProtectedReplayRequestLocatorV1 {
            request_identity: request.request_identity.clone(),
            request_digest: request.request_digest.clone(),
            receipt_identity: receipt.receipt_identity.clone(),
            seal_digest: receipt.seal_digest.clone(),
        },
        request: request.as_json()?,
        receipt: receipt.as_json()?,
    })
}

pub(crate) fn commit_projection_v2(
    request: &ProtectedReplayRequestV2,
    receipt: &ProtectedReplayRequestReceiptV1,
) -> Result<ProtectedReplayRequestCommitV1, QualificationOwnerError> {
    Ok(ProtectedReplayRequestCommitV1 {
        locator: ProtectedReplayRequestLocatorV1 {
            request_identity: request.request_identity().to_string(),
            request_digest: request.request_digest().to_string(),
            receipt_identity: receipt.receipt_identity.clone(),
            seal_digest: receipt.seal_digest.clone(),
        },
        request: request.as_json()?,
        receipt: receipt.as_json()?,
    })
}

fn assert_binding(
    binding: &ProtectedReplayBindingV1,
    identity: &str,
    digest: &str,
) -> Result<(), QualificationOwnerError> {
    if binding.identity == identity && binding.digest == digest {
        Ok(())
    } else {
        Err(unavailable(
            "Protected Replay Request changed an Owner binding",
        ))
    }
}

fn assert_identity(
    binding: &ProtectedReplayBindingV1,
    identity: &str,
) -> Result<(), QualificationOwnerError> {
    if binding.identity == identity {
        Ok(())
    } else {
        Err(unavailable(
            "Protected Replay Request changed an Owner model identity",
        ))
    }
}

fn valid_digest(value: &str) -> bool {
    CanonicalDigestV2::try_from(value.to_string()).is_ok()
}

fn unavailable(message: &str) -> QualificationOwnerError {
    QualificationOwnerError::Unavailable(message.to_string())
}
