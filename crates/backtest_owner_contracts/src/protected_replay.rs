//! Forgeable wire contracts for the Qualification-only protected replay boundary.
//!
//! Validation proves canonical shape and internal equality only. Backtest and Qualification Owner
//! custody must still be established through their sealed PostgreSQL read ports.

use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;

use crate::{
    CanonicalDigestV2, DiagnosticCategoryV2, OpaqueIdentityV2, PROTECTED_REPLAY_BINDING_COUNT_V1,
    ProtectedReplayBindingFieldV1, ProtectedReplayBindingV1, ReconciliationStatusV2,
    ReplayTerminalV2,
};

const REQUEST_SCHEMA_V1: u16 = 1;
const REQUEST_SCHEMA_V2: u16 = 2;
const RESULT_SCHEMA_V1: u16 = 1;
const RESULT_SCHEMA_V2: u16 = 2;
const RESULT_SCHEMA_V3: u16 = 3;
const REQUEST_DIGEST_DOMAIN: &str = "qualification.protected-replay-request.v1";
const REQUEST_DIGEST_DOMAIN_V2: &str = "qualification.protected-replay-request.v2";
const RESULT_DIGEST_DOMAIN: &str = "vibe.backtest.protected-replay-result.v1";
const RESULT_DIGEST_DOMAIN_V2: &str = "vibe.backtest.protected-replay-result.v2";
const RESULT_DIGEST_DOMAIN_V3: &str = "vibe.backtest.protected-replay-result.v3";
const TIME_EVIDENCE_DIGEST_DOMAIN: &str = "vibe.protected-evaluation.time-evidence.v1";
const DIAGNOSTIC_DIGEST_DOMAIN: &str = "vibe.backtest.protected-diagnostic-set.v1";
const RECEIPT_DIGEST_DOMAIN: &str = "vibe.backtest.protected-result-receipt.v1";
const OUTBOX_PAYLOAD_DIGEST_DOMAIN: &str = "vibe.backtest.protected-result-outbox-payload.v1";
const OUTBOX_EVENT_DIGEST_DOMAIN: &str = "vibe.backtest.protected-result-outbox-event.v1";
const EVENT_KIND: &str = "PROTECTED_BACKTEST_RESULT_COMMITTED_V1";

#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum ProtectedReplayContractErrorV1 {
    #[error("protected replay encoding is noncanonical or unavailable")]
    InvalidEncoding,
    #[error("protected replay request is invalid")]
    InvalidRequest,
    #[error("protected replay result is invalid")]
    InvalidResult,
    #[error("protected replay binding census is noncanonical")]
    InvalidBindingCensus,
    #[error("protected replay diagnostic census is noncanonical")]
    InvalidDiagnosticCensus,
    #[error("protected replay digest is invalid")]
    InvalidDigest,
}

/// Forgeable wire form of the Qualification-owned frozen request.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProtectedReplayRequestDtoV1 {
    pub schema_version: u16,
    pub request_identity: String,
    pub request_digest: String,
    pub candidate_identity: String,
    pub candidate_digest: String,
    pub review_request_identity: String,
    pub intake_receipt_identity: String,
    pub intake_receipt_digest: String,
    pub holdout_reservation_identity: String,
    pub protected_decision_policy_identity: String,
    pub protected_decision_policy_version: u64,
    pub trial_family_identity: String,
    pub trial_family_digest: String,
    pub protected_plan_identity: String,
    pub protected_plan_digest: String,
    pub plan_cell_set_identity: String,
    pub plan_cell_set_digest: String,
    pub plan_cell_identity: String,
    pub plan_cell_digest: String,
    pub bindings: [ProtectedReplayBindingV1; PROTECTED_REPLAY_BINDING_COUNT_V1],
    pub state: String,
}

/// Stage carried by one protected-evaluation clock cut.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ProtectedEvaluationStageV1 {
    Request,
    Result,
}

/// The only comparison rule admitted for protected evaluation evidence.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ProtectedEvaluationComparisonRuleV1 {
    ExclusiveValidThrough,
}

/// Direct proof carried only when a protected evaluation advances to a new clock epoch.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProtectedEvaluationEpochSuccessorProofV1 {
    pub proof_identity: [u8; 32],
    pub predecessor_head_digest: [u8; 32],
    pub successor_head_digest: [u8; 32],
    pub prior_clock_identity: String,
    pub prior_clock_epoch: String,
    pub successor_clock_identity: String,
    pub successor_clock_epoch: String,
    pub successor_continuity_digest: [u8; 32],
    pub commit_cut: u64,
    pub comparison_rule: ProtectedEvaluationComparisonRuleV1,
}

/// Dependency-neutral wire form of an Owner-verified Shared Time head.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProtectedEvaluationTimeEvidenceV1 {
    pub cut_kind: String,
    pub stage: ProtectedEvaluationStageV1,
    pub head_identity: [u8; 32],
    pub head_digest: [u8; 32],
    pub clock_identity: String,
    pub clock_epoch: String,
    pub monotonic_sequence: u64,
    pub wall_observed: u64,
    pub decision_cut: u64,
    pub valid_through: u64,
    pub restart_continuity_digest: [u8; 32],
    pub uncertainty_bound: u64,
    pub skew_bound: u64,
    pub comparison_rule: ProtectedEvaluationComparisonRuleV1,
    pub direct_predecessor_head_identity: Option<[u8; 32]>,
    pub direct_predecessor_head_digest: Option<[u8; 32]>,
    pub epoch_successor_proof: Option<ProtectedEvaluationEpochSuccessorProofV1>,
}

impl ProtectedEvaluationTimeEvidenceV1 {
    pub fn validate_request_root(&self) -> Result<(), ProtectedReplayContractErrorV1> {
        self.validate_common()?;
        if self.stage != ProtectedEvaluationStageV1::Request
            || self.direct_predecessor_head_identity.is_some()
            || self.direct_predecessor_head_digest.is_some()
            || self.epoch_successor_proof.is_some()
        {
            return Err(ProtectedReplayContractErrorV1::InvalidRequest);
        }
        Ok(())
    }

    pub fn validate_result_successor_of(
        &self,
        request: &Self,
    ) -> Result<(), ProtectedReplayContractErrorV1> {
        self.validate_common()?;
        request.validate_request_root()?;
        if self.stage != ProtectedEvaluationStageV1::Result
            || self.direct_predecessor_head_identity != Some(request.head_identity)
            || self.direct_predecessor_head_digest != Some(request.head_digest)
            || self.clock_identity != request.clock_identity
            || self.wall_observed <= request.wall_observed
            || self.decision_cut <= request.decision_cut
            || self.wall_observed >= request.valid_through
            || self.valid_through <= request.valid_through
        {
            return Err(ProtectedReplayContractErrorV1::InvalidResult);
        }
        if self.clock_epoch == request.clock_epoch {
            if self.monotonic_sequence != request.monotonic_sequence.saturating_add(1)
                || self.restart_continuity_digest != request.restart_continuity_digest
                || self.uncertainty_bound != request.uncertainty_bound
                || self.skew_bound != request.skew_bound
                || self.epoch_successor_proof.is_some()
            {
                return Err(ProtectedReplayContractErrorV1::InvalidResult);
            }
        } else {
            let proof = self
                .epoch_successor_proof
                .as_ref()
                .ok_or(ProtectedReplayContractErrorV1::InvalidResult)?;
            if proof.proof_identity.iter().all(|byte| *byte == 0)
                || proof.predecessor_head_digest != request.head_digest
                || proof.successor_head_digest != self.head_digest
                || proof.prior_clock_identity != request.clock_identity
                || proof.prior_clock_epoch != request.clock_epoch
                || proof.successor_clock_identity != self.clock_identity
                || proof.successor_clock_epoch != self.clock_epoch
                || proof.successor_continuity_digest != self.restart_continuity_digest
                || proof.commit_cut != self.decision_cut
                || proof.comparison_rule != self.comparison_rule
            {
                return Err(ProtectedReplayContractErrorV1::InvalidResult);
            }
        }
        Ok(())
    }

    fn validate_common(&self) -> Result<(), ProtectedReplayContractErrorV1> {
        if self.cut_kind != "PROTECTED_EVALUATION"
            || !valid_identity(&self.clock_identity)
            || !valid_identity(&self.clock_epoch)
            || self.monotonic_sequence == 0
            || self.wall_observed == 0
            || self.decision_cut == 0
            || self.decision_cut > self.wall_observed
            || self.wall_observed >= self.valid_through
            || self.uncertainty_bound > self.skew_bound
            || self.skew_bound == 0
            || self.head_identity.iter().all(|byte| *byte == 0)
            || self.head_digest.iter().all(|byte| *byte == 0)
            || self.restart_continuity_digest.iter().all(|byte| *byte == 0)
        {
            return Err(ProtectedReplayContractErrorV1::InvalidResult);
        }
        Ok(())
    }
}

pub fn protected_evaluation_time_evidence_digest_v1(
    value: &ProtectedEvaluationTimeEvidenceV1,
) -> Result<String, ProtectedReplayContractErrorV1> {
    digest_json(TIME_EVIDENCE_DIGEST_DOMAIN, value)
}

/// Qualification request V2 adds a sealed request-stage time root without reinterpreting V1 bytes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProtectedReplayRequestDtoV2 {
    pub schema_version: u16,
    pub request_identity: String,
    pub request_digest: String,
    pub frozen_basis: ProtectedReplayRequestDtoV1,
    pub request_time_evidence: ProtectedEvaluationTimeEvidenceV1,
}

impl ProtectedReplayRequestDtoV2 {
    pub fn from_canonical_bytes(bytes: &[u8]) -> Result<Self, ProtectedReplayContractErrorV1> {
        let value: Self = serde_json::from_slice(bytes)
            .map_err(|_| ProtectedReplayContractErrorV1::InvalidEncoding)?;
        value.validate()?;
        if serde_json::to_vec(&value)
            .map_err(|_| ProtectedReplayContractErrorV1::InvalidEncoding)?
            != bytes
        {
            return Err(ProtectedReplayContractErrorV1::InvalidEncoding);
        }
        Ok(value)
    }

    pub fn validate(&self) -> Result<(), ProtectedReplayContractErrorV1> {
        self.frozen_basis.validate()?;
        self.request_time_evidence.validate_request_root()?;
        if self.schema_version != REQUEST_SCHEMA_V2
            || self.request_identity != self.frozen_basis.request_identity
            || !valid_digest(&self.request_digest)
            || self.request_digest != self.compute_request_digest()?
        {
            return Err(ProtectedReplayContractErrorV1::InvalidRequest);
        }
        Ok(())
    }

    pub fn compute_request_digest(&self) -> Result<String, ProtectedReplayContractErrorV1> {
        qualification_digest_json(
            REQUEST_DIGEST_DOMAIN_V2,
            &(
                self.schema_version,
                &self.request_identity,
                &self.frozen_basis,
                &self.request_time_evidence,
            ),
        )
    }

    pub fn to_canonical_bytes(&self) -> Result<Vec<u8>, ProtectedReplayContractErrorV1> {
        self.validate()?;
        serde_json::to_vec(self).map_err(|_| ProtectedReplayContractErrorV1::InvalidEncoding)
    }
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

impl ProtectedReplayRequestDtoV1 {
    pub fn from_canonical_bytes(bytes: &[u8]) -> Result<Self, ProtectedReplayContractErrorV1> {
        let value: Self = serde_json::from_slice(bytes)
            .map_err(|_| ProtectedReplayContractErrorV1::InvalidEncoding)?;
        value.validate()?;
        let canonical_value = serde_json::to_value(&value)
            .map_err(|_| ProtectedReplayContractErrorV1::InvalidEncoding)?;
        if serde_json::to_vec(&canonical_value)
            .map_err(|_| ProtectedReplayContractErrorV1::InvalidEncoding)?
            != bytes
        {
            return Err(ProtectedReplayContractErrorV1::InvalidEncoding);
        }
        Ok(value)
    }

    pub fn validate(&self) -> Result<(), ProtectedReplayContractErrorV1> {
        if self.schema_version != REQUEST_SCHEMA_V1
            || self.state != "FROZEN"
            || !valid_identity(&self.request_identity)
            || !valid_identity(&self.candidate_identity)
            || !valid_identity(&self.review_request_identity)
            || !valid_identity(&self.intake_receipt_identity)
            || !valid_identity(&self.holdout_reservation_identity)
            || !valid_identity(&self.protected_decision_policy_identity)
            || !valid_identity(&self.trial_family_identity)
            || !valid_identity(&self.protected_plan_identity)
            || !valid_identity(&self.plan_cell_set_identity)
            || !valid_identity(&self.plan_cell_identity)
        {
            return Err(ProtectedReplayContractErrorV1::InvalidRequest);
        }
        for digest in [
            &self.request_digest,
            &self.candidate_digest,
            &self.intake_receipt_digest,
            &self.trial_family_digest,
            &self.protected_plan_digest,
            &self.plan_cell_set_digest,
            &self.plan_cell_digest,
        ] {
            if !valid_digest(digest) {
                return Err(ProtectedReplayContractErrorV1::InvalidDigest);
            }
        }
        validate_bindings(&self.bindings)?;
        let expected = self.compute_request_digest()?;
        if self.request_digest != expected {
            return Err(ProtectedReplayContractErrorV1::InvalidDigest);
        }
        Ok(())
    }

    pub fn compute_request_digest(&self) -> Result<String, ProtectedReplayContractErrorV1> {
        qualification_digest_json(
            REQUEST_DIGEST_DOMAIN,
            &RequestMeaningV1 {
                schema_version: self.schema_version,
                request_identity: &self.request_identity,
                candidate_identity: &self.candidate_identity,
                candidate_digest: &self.candidate_digest,
                review_request_identity: &self.review_request_identity,
                intake_receipt_identity: &self.intake_receipt_identity,
                intake_receipt_digest: &self.intake_receipt_digest,
                holdout_reservation_identity: &self.holdout_reservation_identity,
                protected_decision_policy_identity: &self.protected_decision_policy_identity,
                protected_decision_policy_version: self.protected_decision_policy_version,
                trial_family_identity: &self.trial_family_identity,
                trial_family_digest: &self.trial_family_digest,
                protected_plan_identity: &self.protected_plan_identity,
                protected_plan_digest: &self.protected_plan_digest,
                plan_cell_set_identity: &self.plan_cell_set_identity,
                plan_cell_set_digest: &self.plan_cell_set_digest,
                plan_cell_identity: &self.plan_cell_identity,
                plan_cell_digest: &self.plan_cell_digest,
                bindings: &self.bindings,
                state: &self.state,
            },
        )
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProtectedConsumedInputLocatorV1 {
    pub owner: OpaqueIdentityV2,
    pub reference: OpaqueIdentityV2,
    pub digest: CanonicalDigestV2,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProtectedReplayReconciliationAtomV1 {
    pub field: ProtectedReplayBindingFieldV1,
    pub requested_identity: String,
    pub requested_digest: String,
    pub consumed_identity: Option<String>,
    pub consumed_digest: Option<String>,
    pub evidence: Option<ProtectedConsumedInputLocatorV1>,
    pub status: ReconciliationStatusV2,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProtectedResultOutcomeLocatorV1 {
    pub reference: OpaqueIdentityV2,
    pub digest: CanonicalDigestV2,
}

/// One Backtest-owned protected diagnostic category and its decisive evidence cut.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProtectedDiagnosticEvidenceV2 {
    pub request_identity: String,
    pub request_digest: String,
    pub attempt_identity: String,
    pub category: DiagnosticCategoryV2,
    pub decisive_evidence: ProtectedConsumedInputLocatorV1,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProtectedReplayResultDtoV1 {
    pub schema_version: u16,
    pub result_identity: String,
    pub result_digest: String,
    pub request_identity: String,
    pub request_digest: String,
    pub request_receipt_identity: String,
    pub request_seal_digest: String,
    pub attempt_identity: String,
    pub terminal: ReplayTerminalV2,
    pub protected_decision_policy_identity: String,
    pub protected_decision_policy_version: u64,
    pub protected_plan_identity: String,
    pub protected_plan_digest: String,
    pub plan_cell_identity: String,
    pub plan_cell_digest: String,
    pub reconciliation: Vec<ProtectedReplayReconciliationAtomV1>,
    pub diagnostic_category_set: Vec<DiagnosticCategoryV2>,
    pub diagnostic_category_set_digest: String,
    pub protected_outcome: Option<ProtectedResultOutcomeLocatorV1>,
}

/// Protected result vocabulary that binds decisive evidence to every diagnostic category.
///
/// V1 remains decodable for the already committed negative terminal contract. Qualification only
/// admits diagnostic closure from this V2 result, so a historical V1 `TERMINAL_RESULT` cannot be
/// upgraded by inference.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProtectedReplayResultDtoV2 {
    pub schema_version: u16,
    pub result_identity: String,
    pub result_digest: String,
    pub request_identity: String,
    pub request_digest: String,
    pub request_receipt_identity: String,
    pub request_seal_digest: String,
    pub attempt_identity: String,
    pub terminal: ReplayTerminalV2,
    pub protected_decision_policy_identity: String,
    pub protected_decision_policy_version: u64,
    pub protected_plan_identity: String,
    pub protected_plan_digest: String,
    pub plan_cell_identity: String,
    pub plan_cell_digest: String,
    pub reconciliation: Vec<ProtectedReplayReconciliationAtomV1>,
    pub diagnostic_category_set: Vec<DiagnosticCategoryV2>,
    pub diagnostic_category_set_digest: String,
    pub diagnostic_evidence: Vec<ProtectedDiagnosticEvidenceV2>,
    pub protected_outcome: Option<ProtectedResultOutcomeLocatorV1>,
}

/// Backtest observation only; Qualification alone adjudicates non-applicability.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ProtectedCellApplicabilityObservationV3 {
    ApplicableInputsObserved,
    PreResultNonApplicabilityBasisObserved,
}

/// Sealed Backtest-owned evidence for the observed applicability of one requested cell.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProtectedCellApplicabilityEvidenceV3 {
    pub request_identity: String,
    pub request_digest: String,
    pub attempt_identity: String,
    pub plan_cell_identity: String,
    pub observation: ProtectedCellApplicabilityObservationV3,
    pub decisive_evidence: ProtectedConsumedInputLocatorV1,
}

/// Terminal protected-cell result with time and complete cell-set bindings.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProtectedReplayResultDtoV3 {
    pub schema_version: u16,
    pub result_identity: String,
    pub result_digest: String,
    pub request_identity: String,
    pub request_digest: String,
    pub request_receipt_identity: String,
    pub request_seal_digest: String,
    pub attempt_identity: String,
    pub terminal: ReplayTerminalV2,
    pub protected_decision_policy_identity: String,
    pub protected_decision_policy_version: u64,
    pub protected_plan_identity: String,
    pub protected_plan_digest: String,
    pub plan_cell_set_identity: String,
    pub plan_cell_set_digest: String,
    pub plan_cell_identity: String,
    pub plan_cell_digest: String,
    pub reconciliation: Vec<ProtectedReplayReconciliationAtomV1>,
    pub diagnostic_category_set: Vec<DiagnosticCategoryV2>,
    pub diagnostic_category_set_digest: String,
    pub diagnostic_evidence: Vec<ProtectedDiagnosticEvidenceV2>,
    pub applicability_evidence: ProtectedCellApplicabilityEvidenceV3,
    pub protected_outcome: ProtectedResultOutcomeLocatorV1,
    pub request_time_evidence_digest: String,
    pub result_time_evidence: ProtectedEvaluationTimeEvidenceV1,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProtectedResultReceiptDtoV1 {
    pub schema_version: u16,
    pub receipt_identity: String,
    pub receipt_digest: String,
    pub request_identity: String,
    pub request_digest: String,
    pub result_identity: String,
    pub result_digest: String,
    pub outbox_event_identity: String,
    pub committed_at_epoch_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProtectedResultOutboxPayloadDtoV1 {
    pub schema_version: u16,
    pub receipt_identity: String,
    pub receipt_digest: String,
    pub request_identity: String,
    pub request_digest: String,
    pub result_identity: String,
    pub result_digest: String,
    pub committed_at_epoch_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProtectedResultOutboxDtoV1 {
    pub schema_version: u16,
    pub event_identity: String,
    pub event_digest: String,
    pub aggregate_identity: String,
    pub event_kind: String,
    pub payload_digest: String,
    pub payload: ProtectedResultOutboxPayloadDtoV1,
    pub committed_at_epoch_ms: u64,
}

pub fn protected_result_custody_wires_v1(
    result: &ProtectedReplayResultDtoV1,
    committed_at_epoch_ms: u64,
) -> Result<
    (
        ProtectedResultReceiptDtoV1,
        Vec<u8>,
        ProtectedResultOutboxDtoV1,
        Vec<u8>,
    ),
    ProtectedReplayContractErrorV1,
> {
    result.validate()?;
    protected_result_custody_wires(
        &result.request_identity,
        &result.request_digest,
        &result.result_identity,
        &result.result_digest,
        committed_at_epoch_ms,
    )
}

pub fn protected_result_custody_wires_v2(
    result: &ProtectedReplayResultDtoV2,
    committed_at_epoch_ms: u64,
) -> Result<
    (
        ProtectedResultReceiptDtoV1,
        Vec<u8>,
        ProtectedResultOutboxDtoV1,
        Vec<u8>,
    ),
    ProtectedReplayContractErrorV1,
> {
    result.validate()?;
    protected_result_custody_wires(
        &result.request_identity,
        &result.request_digest,
        &result.result_identity,
        &result.result_digest,
        committed_at_epoch_ms,
    )
}

pub fn protected_result_custody_wires_v3(
    result: &ProtectedReplayResultDtoV3,
    committed_at_epoch_ms: u64,
) -> Result<
    (
        ProtectedResultReceiptDtoV1,
        Vec<u8>,
        ProtectedResultOutboxDtoV1,
        Vec<u8>,
    ),
    ProtectedReplayContractErrorV1,
> {
    result.validate()?;
    if committed_at_epoch_ms >= result.result_time_evidence.valid_through {
        return Err(ProtectedReplayContractErrorV1::InvalidResult);
    }
    protected_result_custody_wires(
        &result.request_identity,
        &result.request_digest,
        &result.result_identity,
        &result.result_digest,
        committed_at_epoch_ms,
    )
}

fn protected_result_custody_wires(
    request_identity: &str,
    request_digest: &str,
    result_identity: &str,
    result_digest: &str,
    committed_at_epoch_ms: u64,
) -> Result<
    (
        ProtectedResultReceiptDtoV1,
        Vec<u8>,
        ProtectedResultOutboxDtoV1,
        Vec<u8>,
    ),
    ProtectedReplayContractErrorV1,
> {
    let receipt_digest = digest_json(
        RECEIPT_DIGEST_DOMAIN,
        &(
            request_identity,
            request_digest,
            result_identity,
            result_digest,
            committed_at_epoch_ms,
        ),
    )?;
    let receipt_identity =
        derived_identity("backtest-protected-result-receipt-v1", &receipt_digest)?;
    let payload = ProtectedResultOutboxPayloadDtoV1 {
        schema_version: 1,
        receipt_identity: receipt_identity.clone(),
        receipt_digest: receipt_digest.clone(),
        request_identity: request_identity.to_string(),
        request_digest: request_digest.to_string(),
        result_identity: result_identity.to_string(),
        result_digest: result_digest.to_string(),
        committed_at_epoch_ms,
    };
    let payload_digest = digest_json(OUTBOX_PAYLOAD_DIGEST_DOMAIN, &payload)?;
    let event_identity = derived_identity("backtest-protected-result-event-v1", &payload_digest)?;
    let receipt = ProtectedResultReceiptDtoV1 {
        schema_version: 1,
        receipt_identity,
        receipt_digest,
        request_identity: request_identity.to_string(),
        request_digest: request_digest.to_string(),
        result_identity: result_identity.to_string(),
        result_digest: result_digest.to_string(),
        outbox_event_identity: event_identity.clone(),
        committed_at_epoch_ms,
    };
    let event_digest = digest_json(
        OUTBOX_EVENT_DIGEST_DOMAIN,
        &(
            1_u16,
            &event_identity,
            result_identity,
            EVENT_KIND,
            &payload_digest,
            &payload,
            committed_at_epoch_ms,
        ),
    )?;
    let outbox = ProtectedResultOutboxDtoV1 {
        schema_version: 1,
        event_identity,
        event_digest,
        aggregate_identity: result_identity.to_string(),
        event_kind: EVENT_KIND.to_string(),
        payload_digest,
        payload,
        committed_at_epoch_ms,
    };
    let receipt_bytes = serde_json::to_vec(&receipt)
        .map_err(|_| ProtectedReplayContractErrorV1::InvalidEncoding)?;
    let outbox_bytes =
        serde_json::to_vec(&outbox).map_err(|_| ProtectedReplayContractErrorV1::InvalidEncoding)?;
    Ok((receipt, receipt_bytes, outbox, outbox_bytes))
}

#[derive(Serialize)]
struct ResultMeaningV1<'a> {
    schema_version: u16,
    request_identity: &'a str,
    request_digest: &'a str,
    request_receipt_identity: &'a str,
    request_seal_digest: &'a str,
    attempt_identity: &'a str,
    terminal: ReplayTerminalV2,
    protected_decision_policy_identity: &'a str,
    protected_decision_policy_version: u64,
    protected_plan_identity: &'a str,
    protected_plan_digest: &'a str,
    plan_cell_identity: &'a str,
    plan_cell_digest: &'a str,
    reconciliation: &'a [ProtectedReplayReconciliationAtomV1],
    diagnostic_category_set: &'a [DiagnosticCategoryV2],
    diagnostic_category_set_digest: &'a str,
    protected_outcome: &'a Option<ProtectedResultOutcomeLocatorV1>,
}

#[derive(Serialize)]
struct ResultMeaningV2<'a> {
    schema_version: u16,
    request_identity: &'a str,
    request_digest: &'a str,
    request_receipt_identity: &'a str,
    request_seal_digest: &'a str,
    attempt_identity: &'a str,
    terminal: ReplayTerminalV2,
    protected_decision_policy_identity: &'a str,
    protected_decision_policy_version: u64,
    protected_plan_identity: &'a str,
    protected_plan_digest: &'a str,
    plan_cell_identity: &'a str,
    plan_cell_digest: &'a str,
    reconciliation: &'a [ProtectedReplayReconciliationAtomV1],
    diagnostic_category_set: &'a [DiagnosticCategoryV2],
    diagnostic_category_set_digest: &'a str,
    diagnostic_evidence: &'a [ProtectedDiagnosticEvidenceV2],
    protected_outcome: &'a Option<ProtectedResultOutcomeLocatorV1>,
}

#[derive(Serialize)]
struct ResultMeaningV3<'a> {
    schema_version: u16,
    request_identity: &'a str,
    request_digest: &'a str,
    request_receipt_identity: &'a str,
    request_seal_digest: &'a str,
    attempt_identity: &'a str,
    terminal: ReplayTerminalV2,
    protected_decision_policy_identity: &'a str,
    protected_decision_policy_version: u64,
    protected_plan_identity: &'a str,
    protected_plan_digest: &'a str,
    plan_cell_set_identity: &'a str,
    plan_cell_set_digest: &'a str,
    plan_cell_identity: &'a str,
    plan_cell_digest: &'a str,
    reconciliation: &'a [ProtectedReplayReconciliationAtomV1],
    diagnostic_category_set: &'a [DiagnosticCategoryV2],
    diagnostic_category_set_digest: &'a str,
    diagnostic_evidence: &'a [ProtectedDiagnosticEvidenceV2],
    applicability_evidence: &'a ProtectedCellApplicabilityEvidenceV3,
    protected_outcome: &'a ProtectedResultOutcomeLocatorV1,
    request_time_evidence_digest: &'a str,
    result_time_evidence: &'a ProtectedEvaluationTimeEvidenceV1,
}

impl ProtectedReplayResultDtoV1 {
    pub fn from_canonical_bytes(bytes: &[u8]) -> Result<Self, ProtectedReplayContractErrorV1> {
        let value: Self = serde_json::from_slice(bytes)
            .map_err(|_| ProtectedReplayContractErrorV1::InvalidEncoding)?;
        value.validate()?;
        if serde_json::to_vec(&value)
            .map_err(|_| ProtectedReplayContractErrorV1::InvalidEncoding)?
            != bytes
        {
            return Err(ProtectedReplayContractErrorV1::InvalidEncoding);
        }
        Ok(value)
    }

    pub fn validate(&self) -> Result<(), ProtectedReplayContractErrorV1> {
        if self.schema_version != RESULT_SCHEMA_V1
            || self.terminal == ReplayTerminalV2::InProgressOrUnknown
            || !valid_identity(&self.result_identity)
            || !valid_identity(&self.request_identity)
            || !valid_identity(&self.request_receipt_identity)
            || !valid_identity(&self.attempt_identity)
            || !valid_identity(&self.protected_decision_policy_identity)
            || !valid_identity(&self.protected_plan_identity)
            || !valid_identity(&self.plan_cell_identity)
        {
            return Err(ProtectedReplayContractErrorV1::InvalidResult);
        }
        for digest in [
            &self.result_digest,
            &self.request_digest,
            &self.request_seal_digest,
            &self.protected_plan_digest,
            &self.plan_cell_digest,
            &self.diagnostic_category_set_digest,
        ] {
            if !valid_digest(digest) {
                return Err(ProtectedReplayContractErrorV1::InvalidDigest);
            }
        }
        validate_reconciliation(&self.reconciliation)?;
        validate_diagnostics(
            &self.diagnostic_category_set,
            &self.diagnostic_category_set_digest,
        )?;
        let all_exact = self
            .reconciliation
            .iter()
            .all(|atom| atom.status == ReconciliationStatusV2::Exact);
        if match self.terminal {
            ReplayTerminalV2::TerminalResult => !all_exact || self.protected_outcome.is_none(),
            ReplayTerminalV2::InvalidReplayEvidence => {
                all_exact || self.protected_outcome.is_some()
            }
            ReplayTerminalV2::RunRejected => self.protected_outcome.is_some(),
            ReplayTerminalV2::InProgressOrUnknown => true,
        } {
            return Err(ProtectedReplayContractErrorV1::InvalidResult);
        }
        let expected = self.compute_result_digest()?;
        if self.result_digest != expected
            || self.result_identity
                != format!(
                    "backtest-protected-replay-result-v1-{}",
                    expected
                        .strip_prefix("blake3:")
                        .ok_or(ProtectedReplayContractErrorV1::InvalidDigest)?
                )
        {
            return Err(ProtectedReplayContractErrorV1::InvalidDigest);
        }
        Ok(())
    }

    pub fn to_canonical_bytes(&self) -> Result<Vec<u8>, ProtectedReplayContractErrorV1> {
        self.validate()?;
        serde_json::to_vec(self).map_err(|_| ProtectedReplayContractErrorV1::InvalidEncoding)
    }

    pub fn validate_against_request(
        &self,
        request: &ProtectedReplayRequestDtoV1,
        locator: &crate::ProtectedReplayRequestLocatorV1,
    ) -> Result<(), ProtectedReplayContractErrorV1> {
        self.validate()?;
        request.validate()?;
        if self.request_identity != request.request_identity
            || self.request_digest != request.request_digest
            || self.request_identity != locator.request_identity
            || self.request_digest != locator.request_digest
            || self.request_receipt_identity != locator.receipt_identity
            || self.request_seal_digest != locator.seal_digest
            || self.protected_decision_policy_identity != request.protected_decision_policy_identity
            || self.protected_decision_policy_version != request.protected_decision_policy_version
            || self.protected_plan_identity != request.protected_plan_identity
            || self.protected_plan_digest != request.protected_plan_digest
            || self.plan_cell_identity != request.plan_cell_identity
            || self.plan_cell_digest != request.plan_cell_digest
        {
            return Err(ProtectedReplayContractErrorV1::InvalidResult);
        }
        for (atom, binding) in self.reconciliation.iter().zip(request.bindings.iter()) {
            if atom.field != binding.field
                || atom.requested_identity != binding.identity
                || atom.requested_digest != binding.digest
            {
                return Err(ProtectedReplayContractErrorV1::InvalidBindingCensus);
            }
        }
        Ok(())
    }

    pub fn compute_result_digest(&self) -> Result<String, ProtectedReplayContractErrorV1> {
        digest_json(
            RESULT_DIGEST_DOMAIN,
            &ResultMeaningV1 {
                schema_version: self.schema_version,
                request_identity: &self.request_identity,
                request_digest: &self.request_digest,
                request_receipt_identity: &self.request_receipt_identity,
                request_seal_digest: &self.request_seal_digest,
                attempt_identity: &self.attempt_identity,
                terminal: self.terminal,
                protected_decision_policy_identity: &self.protected_decision_policy_identity,
                protected_decision_policy_version: self.protected_decision_policy_version,
                protected_plan_identity: &self.protected_plan_identity,
                protected_plan_digest: &self.protected_plan_digest,
                plan_cell_identity: &self.plan_cell_identity,
                plan_cell_digest: &self.plan_cell_digest,
                reconciliation: &self.reconciliation,
                diagnostic_category_set: &self.diagnostic_category_set,
                diagnostic_category_set_digest: &self.diagnostic_category_set_digest,
                protected_outcome: &self.protected_outcome,
            },
        )
    }
}

impl ProtectedReplayResultDtoV2 {
    pub fn from_canonical_bytes(bytes: &[u8]) -> Result<Self, ProtectedReplayContractErrorV1> {
        let value: Self = serde_json::from_slice(bytes)
            .map_err(|_| ProtectedReplayContractErrorV1::InvalidEncoding)?;
        value.validate()?;
        if serde_json::to_vec(&value)
            .map_err(|_| ProtectedReplayContractErrorV1::InvalidEncoding)?
            != bytes
        {
            return Err(ProtectedReplayContractErrorV1::InvalidEncoding);
        }
        Ok(value)
    }

    pub fn validate(&self) -> Result<(), ProtectedReplayContractErrorV1> {
        if self.schema_version != RESULT_SCHEMA_V2
            || self.terminal != ReplayTerminalV2::TerminalResult
            || !valid_identity(&self.result_identity)
            || !valid_identity(&self.request_identity)
            || !valid_identity(&self.request_receipt_identity)
            || !valid_identity(&self.attempt_identity)
            || !valid_identity(&self.protected_decision_policy_identity)
            || !valid_identity(&self.protected_plan_identity)
            || !valid_identity(&self.plan_cell_identity)
            || self.protected_outcome.is_none()
        {
            return Err(ProtectedReplayContractErrorV1::InvalidResult);
        }
        for digest in [
            &self.result_digest,
            &self.request_digest,
            &self.request_seal_digest,
            &self.protected_plan_digest,
            &self.plan_cell_digest,
            &self.diagnostic_category_set_digest,
        ] {
            if !valid_digest(digest) {
                return Err(ProtectedReplayContractErrorV1::InvalidDigest);
            }
        }
        validate_reconciliation(&self.reconciliation)?;
        validate_diagnostics(
            &self.diagnostic_category_set,
            &self.diagnostic_category_set_digest,
        )?;
        if !self
            .reconciliation
            .iter()
            .all(|atom| atom.status == ReconciliationStatusV2::Exact)
            || self.diagnostic_evidence.len() != self.diagnostic_category_set.len()
        {
            return Err(ProtectedReplayContractErrorV1::InvalidResult);
        }
        for (evidence, category) in self
            .diagnostic_evidence
            .iter()
            .zip(self.diagnostic_category_set.iter())
        {
            if evidence.request_identity != self.request_identity
                || evidence.request_digest != self.request_digest
                || evidence.attempt_identity != self.attempt_identity
                || evidence.category != *category
            {
                return Err(ProtectedReplayContractErrorV1::InvalidDiagnosticCensus);
            }
        }
        let expected = self.compute_result_digest()?;
        if self.result_digest != expected
            || self.result_identity
                != format!(
                    "backtest-protected-replay-result-v2-{}",
                    expected
                        .strip_prefix("blake3:")
                        .ok_or(ProtectedReplayContractErrorV1::InvalidDigest)?
                )
        {
            return Err(ProtectedReplayContractErrorV1::InvalidDigest);
        }
        Ok(())
    }

    pub fn to_canonical_bytes(&self) -> Result<Vec<u8>, ProtectedReplayContractErrorV1> {
        self.validate()?;
        serde_json::to_vec(self).map_err(|_| ProtectedReplayContractErrorV1::InvalidEncoding)
    }

    pub fn validate_against_request(
        &self,
        request: &ProtectedReplayRequestDtoV1,
        locator: &crate::ProtectedReplayRequestLocatorV1,
    ) -> Result<(), ProtectedReplayContractErrorV1> {
        self.validate()?;
        request.validate()?;
        if self.request_identity != request.request_identity
            || self.request_digest != request.request_digest
            || self.request_identity != locator.request_identity
            || self.request_digest != locator.request_digest
            || self.request_receipt_identity != locator.receipt_identity
            || self.request_seal_digest != locator.seal_digest
            || self.protected_decision_policy_identity != request.protected_decision_policy_identity
            || self.protected_decision_policy_version != request.protected_decision_policy_version
            || self.protected_plan_identity != request.protected_plan_identity
            || self.protected_plan_digest != request.protected_plan_digest
            || self.plan_cell_identity != request.plan_cell_identity
            || self.plan_cell_digest != request.plan_cell_digest
        {
            return Err(ProtectedReplayContractErrorV1::InvalidResult);
        }
        for (atom, binding) in self.reconciliation.iter().zip(request.bindings.iter()) {
            if atom.field != binding.field
                || atom.requested_identity != binding.identity
                || atom.requested_digest != binding.digest
            {
                return Err(ProtectedReplayContractErrorV1::InvalidBindingCensus);
            }
        }
        Ok(())
    }

    pub fn compute_result_digest(&self) -> Result<String, ProtectedReplayContractErrorV1> {
        digest_json(
            RESULT_DIGEST_DOMAIN_V2,
            &ResultMeaningV2 {
                schema_version: self.schema_version,
                request_identity: &self.request_identity,
                request_digest: &self.request_digest,
                request_receipt_identity: &self.request_receipt_identity,
                request_seal_digest: &self.request_seal_digest,
                attempt_identity: &self.attempt_identity,
                terminal: self.terminal,
                protected_decision_policy_identity: &self.protected_decision_policy_identity,
                protected_decision_policy_version: self.protected_decision_policy_version,
                protected_plan_identity: &self.protected_plan_identity,
                protected_plan_digest: &self.protected_plan_digest,
                plan_cell_identity: &self.plan_cell_identity,
                plan_cell_digest: &self.plan_cell_digest,
                reconciliation: &self.reconciliation,
                diagnostic_category_set: &self.diagnostic_category_set,
                diagnostic_category_set_digest: &self.diagnostic_category_set_digest,
                diagnostic_evidence: &self.diagnostic_evidence,
                protected_outcome: &self.protected_outcome,
            },
        )
    }
}

impl ProtectedReplayResultDtoV3 {
    pub fn from_canonical_bytes(bytes: &[u8]) -> Result<Self, ProtectedReplayContractErrorV1> {
        let value: Self = serde_json::from_slice(bytes)
            .map_err(|_| ProtectedReplayContractErrorV1::InvalidEncoding)?;
        value.validate()?;
        if serde_json::to_vec(&value)
            .map_err(|_| ProtectedReplayContractErrorV1::InvalidEncoding)?
            != bytes
        {
            return Err(ProtectedReplayContractErrorV1::InvalidEncoding);
        }
        Ok(value)
    }

    pub fn validate(&self) -> Result<(), ProtectedReplayContractErrorV1> {
        if self.schema_version != RESULT_SCHEMA_V3
            || self.terminal != ReplayTerminalV2::TerminalResult
            || !valid_identity(&self.result_identity)
            || !valid_identity(&self.request_identity)
            || !valid_identity(&self.request_receipt_identity)
            || !valid_identity(&self.attempt_identity)
            || !valid_identity(&self.protected_decision_policy_identity)
            || !valid_identity(&self.protected_plan_identity)
            || !valid_identity(&self.plan_cell_set_identity)
            || !valid_identity(&self.plan_cell_identity)
            || !valid_digest(&self.result_digest)
            || !valid_digest(&self.request_digest)
            || !valid_digest(&self.request_seal_digest)
            || !valid_digest(&self.protected_plan_digest)
            || !valid_digest(&self.plan_cell_set_digest)
            || !valid_digest(&self.plan_cell_digest)
            || !valid_digest(&self.diagnostic_category_set_digest)
            || !valid_digest(&self.request_time_evidence_digest)
        {
            return Err(ProtectedReplayContractErrorV1::InvalidResult);
        }
        validate_reconciliation(&self.reconciliation)?;
        validate_diagnostics(
            &self.diagnostic_category_set,
            &self.diagnostic_category_set_digest,
        )?;
        if !self
            .reconciliation
            .iter()
            .all(|atom| atom.status == ReconciliationStatusV2::Exact)
            || self.diagnostic_evidence.len() != self.diagnostic_category_set.len()
        {
            return Err(ProtectedReplayContractErrorV1::InvalidResult);
        }
        for (evidence, category) in self
            .diagnostic_evidence
            .iter()
            .zip(self.diagnostic_category_set.iter())
        {
            if evidence.request_identity != self.request_identity
                || evidence.request_digest != self.request_digest
                || evidence.attempt_identity != self.attempt_identity
                || evidence.category != *category
            {
                return Err(ProtectedReplayContractErrorV1::InvalidDiagnosticCensus);
            }
        }
        let applicability = &self.applicability_evidence;
        if applicability.request_identity != self.request_identity
            || applicability.request_digest != self.request_digest
            || applicability.attempt_identity != self.attempt_identity
            || applicability.plan_cell_identity != self.plan_cell_identity
        {
            return Err(ProtectedReplayContractErrorV1::InvalidResult);
        }
        let expected = self.compute_result_digest()?;
        if self.result_digest != expected
            || self.result_identity
                != format!(
                    "backtest-protected-replay-result-v3-{}",
                    expected
                        .strip_prefix("blake3:")
                        .ok_or(ProtectedReplayContractErrorV1::InvalidDigest)?
                )
        {
            return Err(ProtectedReplayContractErrorV1::InvalidDigest);
        }
        Ok(())
    }

    pub fn validate_against_request(
        &self,
        request: &ProtectedReplayRequestDtoV2,
        locator: &crate::ProtectedReplayRequestLocatorV1,
    ) -> Result<(), ProtectedReplayContractErrorV1> {
        self.validate()?;
        request.validate()?;
        let basis = &request.frozen_basis;
        if self.request_identity != request.request_identity
            || self.request_digest != request.request_digest
            || self.request_identity != locator.request_identity
            || self.request_digest != locator.request_digest
            || self.request_receipt_identity != locator.receipt_identity
            || self.request_seal_digest != locator.seal_digest
            || self.protected_decision_policy_identity != basis.protected_decision_policy_identity
            || self.protected_decision_policy_version != basis.protected_decision_policy_version
            || self.protected_plan_identity != basis.protected_plan_identity
            || self.protected_plan_digest != basis.protected_plan_digest
            || self.plan_cell_set_identity != basis.plan_cell_set_identity
            || self.plan_cell_set_digest != basis.plan_cell_set_digest
            || self.plan_cell_identity != basis.plan_cell_identity
            || self.plan_cell_digest != basis.plan_cell_digest
            || self.request_time_evidence_digest
                != protected_evaluation_time_evidence_digest_v1(&request.request_time_evidence)?
        {
            return Err(ProtectedReplayContractErrorV1::InvalidResult);
        }
        self.result_time_evidence
            .validate_result_successor_of(&request.request_time_evidence)?;
        for (atom, binding) in self.reconciliation.iter().zip(basis.bindings.iter()) {
            if atom.field != binding.field
                || atom.requested_identity != binding.identity
                || atom.requested_digest != binding.digest
            {
                return Err(ProtectedReplayContractErrorV1::InvalidBindingCensus);
            }
        }
        Ok(())
    }

    pub fn compute_result_digest(&self) -> Result<String, ProtectedReplayContractErrorV1> {
        digest_json(
            RESULT_DIGEST_DOMAIN_V3,
            &ResultMeaningV3 {
                schema_version: self.schema_version,
                request_identity: &self.request_identity,
                request_digest: &self.request_digest,
                request_receipt_identity: &self.request_receipt_identity,
                request_seal_digest: &self.request_seal_digest,
                attempt_identity: &self.attempt_identity,
                terminal: self.terminal,
                protected_decision_policy_identity: &self.protected_decision_policy_identity,
                protected_decision_policy_version: self.protected_decision_policy_version,
                protected_plan_identity: &self.protected_plan_identity,
                protected_plan_digest: &self.protected_plan_digest,
                plan_cell_set_identity: &self.plan_cell_set_identity,
                plan_cell_set_digest: &self.plan_cell_set_digest,
                plan_cell_identity: &self.plan_cell_identity,
                plan_cell_digest: &self.plan_cell_digest,
                reconciliation: &self.reconciliation,
                diagnostic_category_set: &self.diagnostic_category_set,
                diagnostic_category_set_digest: &self.diagnostic_category_set_digest,
                diagnostic_evidence: &self.diagnostic_evidence,
                applicability_evidence: &self.applicability_evidence,
                protected_outcome: &self.protected_outcome,
                request_time_evidence_digest: &self.request_time_evidence_digest,
                result_time_evidence: &self.result_time_evidence,
            },
        )
    }

    pub fn to_canonical_bytes(&self) -> Result<Vec<u8>, ProtectedReplayContractErrorV1> {
        self.validate()?;
        serde_json::to_vec(self).map_err(|_| ProtectedReplayContractErrorV1::InvalidEncoding)
    }
}

pub fn protected_diagnostic_category_set_digest_v1(
    categories: &[DiagnosticCategoryV2],
) -> Result<String, ProtectedReplayContractErrorV1> {
    digest_json(DIAGNOSTIC_DIGEST_DOMAIN, &categories)
}

fn validate_bindings(
    bindings: &[ProtectedReplayBindingV1; PROTECTED_REPLAY_BINDING_COUNT_V1],
) -> Result<(), ProtectedReplayContractErrorV1> {
    for (binding, expected) in bindings.iter().zip(ProtectedReplayBindingFieldV1::ALL) {
        if binding.field != expected
            || !valid_identity(&binding.identity)
            || !valid_digest(&binding.digest)
        {
            return Err(ProtectedReplayContractErrorV1::InvalidBindingCensus);
        }
    }
    Ok(())
}

fn validate_reconciliation(
    atoms: &[ProtectedReplayReconciliationAtomV1],
) -> Result<(), ProtectedReplayContractErrorV1> {
    if atoms.len() != PROTECTED_REPLAY_BINDING_COUNT_V1 {
        return Err(ProtectedReplayContractErrorV1::InvalidBindingCensus);
    }
    for (atom, expected) in atoms.iter().zip(ProtectedReplayBindingFieldV1::ALL) {
        if atom.field != expected
            || !valid_identity(&atom.requested_identity)
            || !valid_digest(&atom.requested_digest)
        {
            return Err(ProtectedReplayContractErrorV1::InvalidBindingCensus);
        }
        let exact_shape = atom
            .consumed_identity
            .as_deref()
            .is_some_and(valid_identity)
            && atom.consumed_digest.as_deref().is_some_and(valid_digest)
            && atom.evidence.is_some();
        match atom.status {
            ReconciliationStatusV2::Exact | ReconciliationStatusV2::Mismatched if !exact_shape => {
                return Err(ProtectedReplayContractErrorV1::InvalidBindingCensus);
            }
            ReconciliationStatusV2::Exact
                if atom.consumed_identity.as_deref() != Some(&atom.requested_identity)
                    || atom.consumed_digest.as_deref() != Some(&atom.requested_digest) =>
            {
                return Err(ProtectedReplayContractErrorV1::InvalidBindingCensus);
            }
            ReconciliationStatusV2::Missing
                if atom.consumed_identity.is_some()
                    || atom.consumed_digest.is_some()
                    || atom.evidence.is_some() =>
            {
                return Err(ProtectedReplayContractErrorV1::InvalidBindingCensus);
            }
            _ => {}
        }
    }
    Ok(())
}

fn validate_diagnostics(
    categories: &[DiagnosticCategoryV2],
    digest: &str,
) -> Result<(), ProtectedReplayContractErrorV1> {
    if categories.is_empty()
        || categories.windows(2).any(|pair| pair[0] >= pair[1])
        || categories.iter().copied().collect::<BTreeSet<_>>().len() != categories.len()
        || (categories.contains(&DiagnosticCategoryV2::NoExecutionDefect) && categories.len() != 1)
        || (categories.contains(&DiagnosticCategoryV2::UnresolvedFailure) && categories.len() != 1)
        || protected_diagnostic_category_set_digest_v1(categories)? != digest
    {
        return Err(ProtectedReplayContractErrorV1::InvalidDiagnosticCensus);
    }
    Ok(())
}

fn valid_identity(value: &str) -> bool {
    OpaqueIdentityV2::try_from(value.to_string()).is_ok()
}

fn valid_digest(value: &str) -> bool {
    CanonicalDigestV2::try_from(value.to_string()).is_ok()
}

fn derived_identity(prefix: &str, digest: &str) -> Result<String, ProtectedReplayContractErrorV1> {
    digest
        .strip_prefix("blake3:")
        .map(|suffix| format!("{prefix}-{suffix}"))
        .ok_or(ProtectedReplayContractErrorV1::InvalidDigest)
}

fn digest_json<T: Serialize + ?Sized>(
    domain: &str,
    value: &T,
) -> Result<String, ProtectedReplayContractErrorV1> {
    let bytes =
        serde_json::to_vec(value).map_err(|_| ProtectedReplayContractErrorV1::InvalidEncoding)?;
    let mut hasher = blake3::Hasher::new();
    hasher.update(domain.as_bytes());
    hasher.update(&[0]);
    hasher.update(&bytes);
    Ok(format!("blake3:{}", hasher.finalize().to_hex()))
}

fn qualification_digest_json<T: Serialize + ?Sized>(
    domain: &str,
    value: &T,
) -> Result<String, ProtectedReplayContractErrorV1> {
    #[derive(Serialize)]
    struct Envelope<'a, T: ?Sized> {
        domain: &'a str,
        value: &'a T,
    }

    let bytes = serde_json::to_vec(&Envelope { domain, value })
        .map_err(|_| ProtectedReplayContractErrorV1::InvalidEncoding)?;
    Ok(format!("sha256:{:x}", Sha256::digest(bytes)))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn identity(value: &str) -> OpaqueIdentityV2 {
        OpaqueIdentityV2::try_from(value.to_string()).unwrap()
    }

    fn canonical_digest(byte: char) -> CanonicalDigestV2 {
        CanonicalDigestV2::try_from(format!("sha256:{}", byte.to_string().repeat(64))).unwrap()
    }

    fn request_v1() -> ProtectedReplayRequestDtoV1 {
        let bindings = ProtectedReplayBindingFieldV1::ALL.map(|field| ProtectedReplayBindingV1 {
            field,
            identity: format!("binding-{field:?}"),
            digest: format!("sha256:{}", "a".repeat(64)),
        });
        let mut request = ProtectedReplayRequestDtoV1 {
            schema_version: 1,
            request_identity: "protected-request".into(),
            request_digest: format!("sha256:{}", "0".repeat(64)),
            candidate_identity: "candidate".into(),
            candidate_digest: format!("sha256:{}", "1".repeat(64)),
            review_request_identity: "review-request".into(),
            intake_receipt_identity: "intake-receipt".into(),
            intake_receipt_digest: format!("sha256:{}", "2".repeat(64)),
            holdout_reservation_identity: "holdout-reservation".into(),
            protected_decision_policy_identity: "protected-policy".into(),
            protected_decision_policy_version: 1,
            trial_family_identity: "trial-family".into(),
            trial_family_digest: format!("sha256:{}", "3".repeat(64)),
            protected_plan_identity: "protected-plan".into(),
            protected_plan_digest: format!("sha256:{}", "4".repeat(64)),
            plan_cell_set_identity: "plan-cell-set".into(),
            plan_cell_set_digest: format!("sha256:{}", "5".repeat(64)),
            plan_cell_identity: "plan-cell".into(),
            plan_cell_digest: format!("sha256:{}", "6".repeat(64)),
            bindings,
            state: "FROZEN".into(),
        };
        request.request_digest = request.compute_request_digest().unwrap();
        request
    }

    fn time_evidence(stage: ProtectedEvaluationStageV1) -> ProtectedEvaluationTimeEvidenceV1 {
        let result = stage == ProtectedEvaluationStageV1::Result;
        ProtectedEvaluationTimeEvidenceV1 {
            cut_kind: "PROTECTED_EVALUATION".into(),
            stage,
            head_identity: [if result { 4 } else { 1 }; 32],
            head_digest: [if result { 5 } else { 2 }; 32],
            clock_identity: "clock-identity".into(),
            clock_epoch: "clock-epoch".into(),
            monotonic_sequence: if result { 2 } else { 1 },
            wall_observed: if result { 110 } else { 100 },
            decision_cut: if result { 110 } else { 100 },
            valid_through: if result { 180 } else { 160 },
            restart_continuity_digest: [3; 32],
            uncertainty_bound: 1,
            skew_bound: 2,
            comparison_rule: ProtectedEvaluationComparisonRuleV1::ExclusiveValidThrough,
            direct_predecessor_head_identity: result.then_some([1; 32]),
            direct_predecessor_head_digest: result.then_some([2; 32]),
            epoch_successor_proof: None,
        }
    }

    fn request_v2() -> ProtectedReplayRequestDtoV2 {
        let mut request = ProtectedReplayRequestDtoV2 {
            schema_version: 2,
            request_identity: "protected-request".into(),
            request_digest: format!("sha256:{}", "0".repeat(64)),
            frozen_basis: request_v1(),
            request_time_evidence: time_evidence(ProtectedEvaluationStageV1::Request),
        };
        request.request_digest = request.compute_request_digest().unwrap();
        request
    }

    fn result_v3(request: &ProtectedReplayRequestDtoV2) -> ProtectedReplayResultDtoV3 {
        let attempt = "backtest-attempt";
        let reconciliation = request
            .frozen_basis
            .bindings
            .iter()
            .map(|binding| ProtectedReplayReconciliationAtomV1 {
                field: binding.field,
                requested_identity: binding.identity.clone(),
                requested_digest: binding.digest.clone(),
                consumed_identity: Some(binding.identity.clone()),
                consumed_digest: Some(binding.digest.clone()),
                evidence: Some(ProtectedConsumedInputLocatorV1 {
                    owner: identity("backtest-owner"),
                    reference: identity(&format!("evidence-{:?}", binding.field)),
                    digest: canonical_digest('7'),
                }),
                status: ReconciliationStatusV2::Exact,
            })
            .collect();
        let categories = vec![DiagnosticCategoryV2::NoExecutionDefect];
        let mut result = ProtectedReplayResultDtoV3 {
            schema_version: 3,
            result_identity: "pending-result".into(),
            result_digest: format!("blake3:{}", "0".repeat(64)),
            request_identity: request.request_identity.clone(),
            request_digest: request.request_digest.clone(),
            request_receipt_identity: "request-receipt".into(),
            request_seal_digest: format!("sha256:{}", "8".repeat(64)),
            attempt_identity: attempt.into(),
            terminal: ReplayTerminalV2::TerminalResult,
            protected_decision_policy_identity: request
                .frozen_basis
                .protected_decision_policy_identity
                .clone(),
            protected_decision_policy_version: 1,
            protected_plan_identity: request.frozen_basis.protected_plan_identity.clone(),
            protected_plan_digest: request.frozen_basis.protected_plan_digest.clone(),
            plan_cell_set_identity: request.frozen_basis.plan_cell_set_identity.clone(),
            plan_cell_set_digest: request.frozen_basis.plan_cell_set_digest.clone(),
            plan_cell_identity: request.frozen_basis.plan_cell_identity.clone(),
            plan_cell_digest: request.frozen_basis.plan_cell_digest.clone(),
            reconciliation,
            diagnostic_category_set_digest: protected_diagnostic_category_set_digest_v1(
                &categories,
            )
            .unwrap(),
            diagnostic_category_set: categories.clone(),
            diagnostic_evidence: vec![ProtectedDiagnosticEvidenceV2 {
                request_identity: request.request_identity.clone(),
                request_digest: request.request_digest.clone(),
                attempt_identity: attempt.into(),
                category: categories[0],
                decisive_evidence: ProtectedConsumedInputLocatorV1 {
                    owner: identity("backtest-owner"),
                    reference: identity("diagnostic-evidence"),
                    digest: canonical_digest('9'),
                },
            }],
            applicability_evidence: ProtectedCellApplicabilityEvidenceV3 {
                request_identity: request.request_identity.clone(),
                request_digest: request.request_digest.clone(),
                attempt_identity: attempt.into(),
                plan_cell_identity: request.frozen_basis.plan_cell_identity.clone(),
                observation: ProtectedCellApplicabilityObservationV3::ApplicableInputsObserved,
                decisive_evidence: ProtectedConsumedInputLocatorV1 {
                    owner: identity("backtest-owner"),
                    reference: identity("applicability-evidence"),
                    digest: canonical_digest('a'),
                },
            },
            protected_outcome: ProtectedResultOutcomeLocatorV1 {
                reference: identity("protected-outcome"),
                digest: canonical_digest('b'),
            },
            request_time_evidence_digest: protected_evaluation_time_evidence_digest_v1(
                &request.request_time_evidence,
            )
            .unwrap(),
            result_time_evidence: time_evidence(ProtectedEvaluationStageV1::Result),
        };
        result.result_digest = result.compute_result_digest().unwrap();
        result.result_identity = format!(
            "backtest-protected-replay-result-v3-{}",
            result.result_digest.strip_prefix("blake3:").unwrap()
        );
        result
    }

    #[test]
    fn v3_binds_complete_cell_set_and_direct_result_time_successor() {
        let request = request_v2();
        let result = result_v3(&request);
        let locator = crate::ProtectedReplayRequestLocatorV1 {
            request_identity: request.request_identity.clone(),
            request_digest: request.request_digest.clone(),
            receipt_identity: result.request_receipt_identity.clone(),
            seal_digest: result.request_seal_digest.clone(),
        };
        result.validate_against_request(&request, &locator).unwrap();
        assert_eq!(
            ProtectedReplayResultDtoV3::from_canonical_bytes(&result.to_canonical_bytes().unwrap())
                .unwrap(),
            result
        );
    }

    #[test]
    fn v3_rejects_cross_cell_set_and_nonadvancing_time() {
        let request = request_v2();
        let mut result = result_v3(&request);
        let locator = crate::ProtectedReplayRequestLocatorV1 {
            request_identity: request.request_identity.clone(),
            request_digest: request.request_digest.clone(),
            receipt_identity: result.request_receipt_identity.clone(),
            seal_digest: result.request_seal_digest.clone(),
        };
        result.plan_cell_set_digest = format!("sha256:{}", "c".repeat(64));
        result.result_digest = result.compute_result_digest().unwrap();
        result.result_identity = format!(
            "backtest-protected-replay-result-v3-{}",
            result.result_digest.strip_prefix("blake3:").unwrap()
        );
        assert!(result.validate_against_request(&request, &locator).is_err());

        let mut result = result_v3(&request);
        result.result_time_evidence.monotonic_sequence = 1;
        result.result_digest = result.compute_result_digest().unwrap();
        result.result_identity = format!(
            "backtest-protected-replay-result-v3-{}",
            result.result_digest.strip_prefix("blake3:").unwrap()
        );
        assert!(result.validate_against_request(&request, &locator).is_err());
    }

    #[test]
    fn v1_request_bytes_never_decode_as_v2() {
        let bytes = serde_json::to_vec(&request_v1()).unwrap();
        assert!(ProtectedReplayRequestDtoV2::from_canonical_bytes(&bytes).is_err());
    }

    #[test]
    fn v3_custody_rejects_commit_at_or_after_result_expiry() {
        let result = result_v3(&request_v2());
        assert!(
            protected_result_custody_wires_v3(
                &result,
                result.result_time_evidence.valid_through - 1,
            )
            .is_ok()
        );
        assert!(
            protected_result_custody_wires_v3(&result, result.result_time_evidence.valid_through,)
                .is_err()
        );
    }
}
