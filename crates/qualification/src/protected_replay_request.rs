use serde::Serialize;
use vibe_backtest_owner_contracts::{
    CanonicalDigestV2, OpaqueIdentityV2, PROTECTED_REPLAY_BINDING_COUNT_V1,
    ProtectedReplayRequestLocatorV1,
};
pub(crate) use vibe_backtest_owner_contracts::{
    ProtectedReplayBindingFieldV1, ProtectedReplayBindingV1,
};

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

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
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
    state: &'static str,
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
    state: &'static str,
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
        state: "FROZEN",
    })
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
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

impl ProtectedReplayRequestCommitV1 {
    pub fn locator(&self) -> &ProtectedReplayRequestLocatorV1 {
        &self.locator
    }
}

pub(crate) fn form_request_receipt_v1(
    request: &ProtectedReplayRequestV1,
    committed_at_epoch_ms: u64,
) -> Result<ProtectedReplayRequestReceiptV1, QualificationOwnerError> {
    let request_bytes =
        serde_json::to_vec(request).map_err(|error| unavailable(&error.to_string()))?;
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

impl ProtectedReplayRequestV1 {
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
        serde_json::to_value(self).map_err(|error| unavailable(&error.to_string()))
    }
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
        serde_json::to_value(self).map_err(|error| unavailable(&error.to_string()))
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
