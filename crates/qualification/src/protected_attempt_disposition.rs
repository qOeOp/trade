use serde::Serialize;
use vibe_backtest_owner_contracts::{
    ProtectedReplayBindingFieldV1, ProtectedReplayRequestDtoV1, ProtectedReplayResultDtoV1,
    ReplayTerminalV2,
};

use crate::QualificationOwnerError;
use crate::postgres::{canonical_digest, identity};

const HOLDOUT_TREATMENT_RULE_V1: &str = "RESULT_BOUND_NEGATIVE_ATTEMPTS_CONSUME_RESERVED_HOLDOUT";

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct PreregisteredHoldoutTreatmentV1 {
    identity: String,
    digest: String,
    closure_disposition: HoldoutClosureDispositionV1,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ProtectedAttemptDispositionStatusV1 {
    ReplayRejected,
    ReplayInvalid,
    DiagnosticInvalid,
    DiagnosticUnresolved,
    AssessmentInvalid,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum HoldoutClosureDispositionV1 {
    Consumed,
    Released,
}

/// Qualification-owned sealed commit. Callers can serialize the verified
/// result, but cannot construct or deserialize a positive Owner readback.
///
/// ```compile_fail
/// use vibe_qualification::ProtectedAttemptDispositionCommitV1;
/// let _: ProtectedAttemptDispositionCommitV1 = serde_json::from_str("{}").unwrap();
/// ```
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ProtectedAttemptDispositionCommitV1 {
    disposition: ProtectedAttemptDispositionV1,
    receipt: ProtectedAttemptDispositionReceiptV1,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ProtectedAttemptDispositionV1 {
    schema_version: u16,
    disposition_identity: String,
    disposition_digest: String,
    status: ProtectedAttemptDispositionStatusV1,
    candidate_identity: String,
    intake_receipt_identity: String,
    request_identity: String,
    request_digest: String,
    result_identity: String,
    result_digest: String,
    attempt_identity: String,
    terminal: ReplayTerminalV2,
    diagnostic_category_set_digest: String,
    protected_decision_policy_identity: String,
    protected_decision_policy_version: u64,
    protected_plan_identity: String,
    protected_plan_digest: String,
    plan_cell_identity: String,
    plan_cell_digest: String,
    cumulative_attempt_basis_identity: String,
    cumulative_attempt_basis_digest: String,
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
pub(crate) struct ProtectedAttemptDispositionReceiptV1 {
    schema_version: u16,
    receipt_identity: String,
    receipt_digest: String,
    disposition_identity: String,
    disposition_digest: String,
    committed_at_epoch_ms: u64,
}

#[derive(Serialize)]
struct DispositionMeaningV1<'a> {
    schema_version: u16,
    status: ProtectedAttemptDispositionStatusV1,
    candidate_identity: &'a str,
    intake_receipt_identity: &'a str,
    request_identity: &'a str,
    request_digest: &'a str,
    result_identity: &'a str,
    result_digest: &'a str,
    attempt_identity: &'a str,
    terminal: ReplayTerminalV2,
    diagnostic_category_set_digest: &'a str,
    protected_decision_policy_identity: &'a str,
    protected_decision_policy_version: u64,
    protected_plan_identity: &'a str,
    protected_plan_digest: &'a str,
    plan_cell_identity: &'a str,
    plan_cell_digest: &'a str,
    cumulative_attempt_basis_identity: &'a str,
    cumulative_attempt_basis_digest: &'a str,
    holdout_reservation_identity: &'a str,
    holdout_closure_identity: &'a str,
    holdout_closure_digest: &'a str,
    holdout_closure_disposition: HoldoutClosureDispositionV1,
    holdout_treatment_policy_identity: &'a str,
    holdout_treatment_policy_digest: &'a str,
    committed_at_epoch_ms: u64,
}

pub(crate) fn form_negative_attempt_disposition_v1(
    request: &ProtectedReplayRequestDtoV1,
    result: &ProtectedReplayResultDtoV1,
    holdout_treatment: &PreregisteredHoldoutTreatmentV1,
    committed_at_epoch_ms: u64,
) -> Result<ProtectedAttemptDispositionCommitV1, QualificationOwnerError> {
    let status = match result.terminal {
        ReplayTerminalV2::RunRejected => ProtectedAttemptDispositionStatusV1::ReplayRejected,
        ReplayTerminalV2::InvalidReplayEvidence => {
            ProtectedAttemptDispositionStatusV1::ReplayInvalid
        }
        ReplayTerminalV2::InProgressOrUnknown | ReplayTerminalV2::TerminalResult => {
            return Err(unavailable(
                "protected result is not a negative replay closure",
            ));
        }
    };
    let attempt_basis = request
        .bindings
        .iter()
        .find(|binding| {
            binding.field == ProtectedReplayBindingFieldV1::FamilyMultiplicityCensusAttemptBasis
        })
        .ok_or_else(|| unavailable("cumulative attempt basis is unavailable"))?;
    let closure_disposition = holdout_treatment.closure_disposition;
    let closure_digest = canonical_digest(
        "qualification.holdout-closure.v1",
        &(
            &request.holdout_reservation_identity,
            &result.result_identity,
            &result.result_digest,
            &attempt_basis.identity,
            &attempt_basis.digest,
            closure_disposition,
            &holdout_treatment.identity,
            &holdout_treatment.digest,
            committed_at_epoch_ms,
        ),
    )?;
    let closure_identity = identity("qualification-holdout-closure-v1", &closure_digest);
    let mut disposition = ProtectedAttemptDispositionV1 {
        schema_version: 1,
        disposition_identity: String::new(),
        disposition_digest: String::new(),
        status,
        candidate_identity: request.candidate_identity.clone(),
        intake_receipt_identity: request.intake_receipt_identity.clone(),
        request_identity: request.request_identity.clone(),
        request_digest: request.request_digest.clone(),
        result_identity: result.result_identity.clone(),
        result_digest: result.result_digest.clone(),
        attempt_identity: result.attempt_identity.clone(),
        terminal: result.terminal,
        diagnostic_category_set_digest: result.diagnostic_category_set_digest.clone(),
        protected_decision_policy_identity: request.protected_decision_policy_identity.clone(),
        protected_decision_policy_version: request.protected_decision_policy_version,
        protected_plan_identity: request.protected_plan_identity.clone(),
        protected_plan_digest: request.protected_plan_digest.clone(),
        plan_cell_identity: request.plan_cell_identity.clone(),
        plan_cell_digest: request.plan_cell_digest.clone(),
        cumulative_attempt_basis_identity: attempt_basis.identity.clone(),
        cumulative_attempt_basis_digest: attempt_basis.digest.clone(),
        holdout_reservation_identity: request.holdout_reservation_identity.clone(),
        holdout_closure_identity: closure_identity,
        holdout_closure_digest: closure_digest,
        holdout_closure_disposition: closure_disposition,
        holdout_treatment_policy_identity: holdout_treatment.identity.clone(),
        holdout_treatment_policy_digest: holdout_treatment.digest.clone(),
        committed_at_epoch_ms,
    };
    let digest = disposition.compute_digest()?;
    disposition.disposition_identity =
        identity("qualification-protected-attempt-disposition-v1", &digest);
    disposition.disposition_digest = digest;
    let receipt_digest = canonical_digest(
        "qualification.protected-attempt-disposition-receipt.v1",
        &(
            &disposition.disposition_identity,
            &disposition.disposition_digest,
            committed_at_epoch_ms,
        ),
    )?;
    let receipt = ProtectedAttemptDispositionReceiptV1 {
        schema_version: 1,
        receipt_identity: identity(
            "qualification-protected-attempt-disposition-receipt-v1",
            &receipt_digest,
        ),
        receipt_digest,
        disposition_identity: disposition.disposition_identity.clone(),
        disposition_digest: disposition.disposition_digest.clone(),
        committed_at_epoch_ms,
    };
    Ok(ProtectedAttemptDispositionCommitV1 {
        disposition,
        receipt,
    })
}

pub(crate) fn preregistered_holdout_treatment_v1(
    protected_decision_policy_identity: &str,
    protected_decision_policy_version: u64,
) -> Result<PreregisteredHoldoutTreatmentV1, QualificationOwnerError> {
    let digest = canonical_digest(
        "qualification.holdout-treatment-policy.v1",
        &(
            protected_decision_policy_identity,
            protected_decision_policy_version,
            HOLDOUT_TREATMENT_RULE_V1,
        ),
    )?;
    Ok(PreregisteredHoldoutTreatmentV1 {
        identity: identity("qualification-holdout-treatment-policy-v1", &digest),
        digest,
        closure_disposition: HoldoutClosureDispositionV1::Consumed,
    })
}

impl PreregisteredHoldoutTreatmentV1 {
    pub(crate) fn identity(&self) -> &str {
        &self.identity
    }
    pub(crate) fn digest(&self) -> &str {
        &self.digest
    }
    pub(crate) fn closure_disposition(&self) -> HoldoutClosureDispositionV1 {
        self.closure_disposition
    }
}

impl ProtectedAttemptDispositionV1 {
    fn compute_digest(&self) -> Result<String, QualificationOwnerError> {
        canonical_digest(
            "qualification.protected-attempt-disposition.v1",
            &DispositionMeaningV1 {
                schema_version: self.schema_version,
                status: self.status,
                candidate_identity: &self.candidate_identity,
                intake_receipt_identity: &self.intake_receipt_identity,
                request_identity: &self.request_identity,
                request_digest: &self.request_digest,
                result_identity: &self.result_identity,
                result_digest: &self.result_digest,
                attempt_identity: &self.attempt_identity,
                terminal: self.terminal,
                diagnostic_category_set_digest: &self.diagnostic_category_set_digest,
                protected_decision_policy_identity: &self.protected_decision_policy_identity,
                protected_decision_policy_version: self.protected_decision_policy_version,
                protected_plan_identity: &self.protected_plan_identity,
                protected_plan_digest: &self.protected_plan_digest,
                plan_cell_identity: &self.plan_cell_identity,
                plan_cell_digest: &self.plan_cell_digest,
                cumulative_attempt_basis_identity: &self.cumulative_attempt_basis_identity,
                cumulative_attempt_basis_digest: &self.cumulative_attempt_basis_digest,
                holdout_reservation_identity: &self.holdout_reservation_identity,
                holdout_closure_identity: &self.holdout_closure_identity,
                holdout_closure_digest: &self.holdout_closure_digest,
                holdout_closure_disposition: self.holdout_closure_disposition,
                holdout_treatment_policy_identity: &self.holdout_treatment_policy_identity,
                holdout_treatment_policy_digest: &self.holdout_treatment_policy_digest,
                committed_at_epoch_ms: self.committed_at_epoch_ms,
            },
        )
    }

    pub(crate) fn as_json(&self) -> Result<serde_json::Value, QualificationOwnerError> {
        serde_json::to_value(self).map_err(|error| unavailable(&error.to_string()))
    }
    pub(crate) fn disposition_identity(&self) -> &str {
        &self.disposition_identity
    }
    pub(crate) fn disposition_digest(&self) -> &str {
        &self.disposition_digest
    }
    pub(crate) fn request_identity(&self) -> &str {
        &self.request_identity
    }
    pub(crate) fn result_identity(&self) -> &str {
        &self.result_identity
    }
    pub(crate) fn attempt_identity(&self) -> &str {
        &self.attempt_identity
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
    pub(crate) fn status(&self) -> ProtectedAttemptDispositionStatusV1 {
        self.status
    }
    pub(crate) fn closure_disposition(&self) -> HoldoutClosureDispositionV1 {
        self.holdout_closure_disposition
    }
    pub(crate) fn committed_at_epoch_ms(&self) -> u64 {
        self.committed_at_epoch_ms
    }
}

impl ProtectedAttemptDispositionCommitV1 {
    pub fn disposition_identity(&self) -> &str {
        &self.disposition.disposition_identity
    }
    pub fn status(&self) -> ProtectedAttemptDispositionStatusV1 {
        self.disposition.status
    }
    pub fn holdout_closure_disposition(&self) -> HoldoutClosureDispositionV1 {
        self.disposition.holdout_closure_disposition
    }
    pub(crate) fn disposition(&self) -> &ProtectedAttemptDispositionV1 {
        &self.disposition
    }
    pub(crate) fn receipt(&self) -> &ProtectedAttemptDispositionReceiptV1 {
        &self.receipt
    }
}

impl ProtectedAttemptDispositionReceiptV1 {
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

fn unavailable(message: &str) -> QualificationOwnerError {
    QualificationOwnerError::Unavailable(message.to_string())
}
