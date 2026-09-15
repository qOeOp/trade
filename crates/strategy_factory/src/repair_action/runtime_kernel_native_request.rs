//! Effect-free R&D formation and admission for Runtime-kernel native repair requests.

pub mod postgres;

use std::fmt::Display;

use serde::Serialize;
use sha2::{Digest, Sha256};
use thiserror::Error;
use vibe_backtest_owner_contracts::{
    DiagnosticCategoryV2, DiagnosticEvidenceDtoV2, ObservationComponentV2, ReconciliationAtomDtoV2,
    ReconciliationStatusV2, ReplayRequestV2, ReplayResultDtoV2, ReplayTerminalV2,
};
use vibe_data::owner::{shared_time_evidence::ClockHeadHandoff, source_binding::BindingDigest};

use crate::iteration_decision::{
    IterationDecisionOutcomeV1, IterationRepairCategoryV1, IterationRepairTargetV1,
    RepairInputIterationDecisionReadbackV1,
};

use super::RepairActionRequestReadbackV1;

const POLICY_DESCRIPTOR_V1: &[u8] =
    b"rd.runtime-kernel-native-repair-policy.v1:exact-request-join:runtime-owner-only";

/// Content-addressed R&D policy for one Runtime-kernel repair attempt.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct RuntimeKernelRepairPolicyV1 {
    schema_version: u16,
    policy_identity: String,
    policy_version: u64,
    policy_digest: String,
}

/// Market Data Owner time evidence frozen into one native repair request.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct RuntimeKernelRepairTimeEvidenceV1 {
    clock_head_identity: BindingDigest,
    clock_head_digest: BindingDigest,
    clock_identity: String,
    clock_epoch: String,
    monotonic_sequence: u64,
    wall_observed_epoch_ms: u64,
    decision_cut_epoch_ms: u64,
    valid_through_epoch_ms: u64,
    restart_continuity_digest: BindingDigest,
}

/// Frozen, effect-free R&D request handed only to Runtime.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct RuntimeKernelNativeRepairRequestV1 {
    schema_version: u16,
    request_identity: String,
    request_digest: String,
    native_attempt_identity: String,
    correlation_identity: String,
    action_request_identity: String,
    action_request_digest: String,
    action_receipt_identity: String,
    action_receipt_digest: String,
    decision_identity: String,
    decision_digest: String,
    decision_receipt_identity: String,
    replay_request_identity: String,
    replay_request_digest: String,
    result_identity: String,
    result_digest: String,
    replay_attempt_identity: String,
    category: IterationRepairCategoryV1,
    target: IterationRepairTargetV1,
    original_proof_reference: String,
    original_proof_digest: String,
    old_kernel_identity: String,
    old_kernel_version: String,
    source_cut_locator: String,
    source_cut_digest: String,
    repair_policy: RuntimeKernelRepairPolicyV1,
    time_evidence: RuntimeKernelRepairTimeEvidenceV1,
}

/// Receipt proving deterministic R&D formation of one native repair request.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct RuntimeKernelNativeRepairRequestReceiptV1 {
    schema_version: u16,
    receipt_identity: String,
    receipt_digest: String,
    request_identity: String,
    request_digest: String,
    native_attempt_identity: String,
    correlation_identity: String,
    action_request_identity: String,
    decision_identity: String,
    committed_at_epoch_ms: u64,
}

/// Move-only positive R&D custody for one Runtime-kernel native repair request.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct RuntimeKernelNativeRepairRequestReadbackV1 {
    request: RuntimeKernelNativeRepairRequestV1,
    receipt: RuntimeKernelNativeRepairRequestReceiptV1,
}

#[derive(Debug, Error, Eq, PartialEq)]
pub enum RuntimeKernelNativeRepairRequestErrorV1 {
    #[error("repair action is not category-exact for the Runtime kernel")]
    WrongRepairTarget,
    #[error("repair action, Decision, Replay Request, and Result custody do not match")]
    CustodyMismatch,
    #[error("the locked Result is not one terminal replay result")]
    NonTerminalResult,
    #[error("the locked Result does not contain exactly one correlated RUNTIME_KERNEL diagnostic")]
    DefectProofUnavailable,
    #[error("the Result does not contain the exact Runtime-kernel reconciliation and source cut")]
    RuntimeKernelReconciliationUnavailable,
    #[error("fresh shared Time Evidence is unavailable")]
    TimeEvidenceUnavailable,
    #[error("runtime-kernel native repair request encoding is unavailable: {0}")]
    Encoding(String),
}

impl RuntimeKernelRepairPolicyV1 {
    /// Returns the only R&D policy admitted by this V1 contract.
    #[must_use]
    pub fn current() -> Self {
        let policy_digest = format!("sha256:{:x}", Sha256::digest(POLICY_DESCRIPTOR_V1));
        Self {
            schema_version: 1,
            policy_identity: identity("rd-runtime-kernel-repair-policy-v1", &policy_digest),
            policy_version: 1,
            policy_digest,
        }
    }

    pub fn policy_identity(&self) -> &str {
        &self.policy_identity
    }

    pub const fn policy_version(&self) -> u64 {
        self.policy_version
    }

    pub fn policy_digest(&self) -> &str {
        &self.policy_digest
    }
}

impl RuntimeKernelNativeRepairRequestV1 {
    pub fn request_identity(&self) -> &str {
        &self.request_identity
    }

    pub fn request_digest(&self) -> &str {
        &self.request_digest
    }

    pub fn native_attempt_identity(&self) -> &str {
        &self.native_attempt_identity
    }

    pub fn correlation_identity(&self) -> &str {
        &self.correlation_identity
    }

    pub fn action_request_identity(&self) -> &str {
        &self.action_request_identity
    }

    pub fn decision_identity(&self) -> &str {
        &self.decision_identity
    }

    pub fn result_identity(&self) -> &str {
        &self.result_identity
    }

    pub const fn category(&self) -> IterationRepairCategoryV1 {
        self.category
    }

    pub const fn target(&self) -> IterationRepairTargetV1 {
        self.target
    }

    pub fn old_kernel_identity(&self) -> &str {
        &self.old_kernel_identity
    }

    pub fn old_kernel_version(&self) -> &str {
        &self.old_kernel_version
    }

    pub fn source_cut_locator(&self) -> &str {
        &self.source_cut_locator
    }

    pub fn source_cut_digest(&self) -> &str {
        &self.source_cut_digest
    }

    pub const fn repair_policy(&self) -> &RuntimeKernelRepairPolicyV1 {
        &self.repair_policy
    }

    pub const fn time_evidence(&self) -> &RuntimeKernelRepairTimeEvidenceV1 {
        &self.time_evidence
    }

    pub fn to_canonical_bytes(&self) -> Result<Vec<u8>, RuntimeKernelNativeRepairRequestErrorV1> {
        serde_json::to_vec(self).map_err(encoding)
    }
}

impl RuntimeKernelNativeRepairRequestReceiptV1 {
    pub fn receipt_identity(&self) -> &str {
        &self.receipt_identity
    }

    pub fn receipt_digest(&self) -> &str {
        &self.receipt_digest
    }

    pub const fn committed_at_epoch_ms(&self) -> u64 {
        self.committed_at_epoch_ms
    }

    pub fn to_canonical_bytes(&self) -> Result<Vec<u8>, RuntimeKernelNativeRepairRequestErrorV1> {
        serde_json::to_vec(self).map_err(encoding)
    }
}

impl RuntimeKernelNativeRepairRequestReadbackV1 {
    pub const fn request(&self) -> &RuntimeKernelNativeRepairRequestV1 {
        &self.request
    }

    pub const fn receipt(&self) -> &RuntimeKernelNativeRepairRequestReceiptV1 {
        &self.receipt
    }
}

/// Forms the one request Runtime may accept from exact committed R&D custody.
pub fn issue_runtime_kernel_native_repair_request_v1(
    action: &RepairActionRequestReadbackV1,
    decision: &RepairInputIterationDecisionReadbackV1,
    replay: &ReplayRequestV2,
    result: &ReplayResultDtoV2,
    shared_time_evidence: &ClockHeadHandoff,
    committed_at_epoch_ms: u64,
) -> Result<RuntimeKernelNativeRepairRequestReadbackV1, RuntimeKernelNativeRepairRequestErrorV1> {
    validate_exact_custody(action, decision, replay, result)?;
    let defect = unique_runtime_kernel_defect(result)?;
    let runtime_kernel = exact_runtime_kernel_reconciliation(result)?;
    let time_evidence = RuntimeKernelRepairTimeEvidenceV1::from_handoff(
        shared_time_evidence,
        decision.receipt().committed_at_epoch_ms(),
        action.receipt.committed_at_epoch_ms,
        committed_at_epoch_ms,
    )?;
    let replay_dto = replay.as_dto();
    let inputs = ValidatedRuntimeKernelRepairInputsV1 {
        action_request_identity: action.request.action_request_identity.clone(),
        action_request_digest: action.request.action_request_digest.clone(),
        action_receipt_identity: action.receipt.receipt_identity.clone(),
        action_receipt_digest: action.receipt.receipt_digest.clone(),
        decision_identity: decision.decision().decision_identity().to_owned(),
        decision_digest: decision.decision().decision_digest().to_owned(),
        decision_receipt_identity: decision.receipt().receipt_identity().to_owned(),
        replay_request_identity: replay_dto.request_identity.as_str().to_owned(),
        replay_request_digest: replay
            .meaning_digest()
            .map_err(encoding)?
            .as_str()
            .to_owned(),
        result_identity: result.result_identity.as_str().to_owned(),
        result_digest: result.result_digest.as_str().to_owned(),
        replay_attempt_identity: result.attempt_identity.as_str().to_owned(),
        original_proof_reference: defect.decisive_evidence.reference.as_str().to_owned(),
        original_proof_digest: defect.decisive_evidence.digest.as_str().to_owned(),
        old_kernel_identity: replay_dto
            .models
            .runtime_kernel
            .identity
            .as_str()
            .to_owned(),
        old_kernel_version: replay_dto.models.runtime_kernel.version.as_str().to_owned(),
        source_cut_locator: runtime_kernel
            .observation_locator
            .as_ref()
            .ok_or(RuntimeKernelNativeRepairRequestErrorV1::RuntimeKernelReconciliationUnavailable)?
            .reference
            .as_str()
            .to_owned(),
        source_cut_digest: runtime_kernel
            .observation_locator
            .as_ref()
            .ok_or(RuntimeKernelNativeRepairRequestErrorV1::RuntimeKernelReconciliationUnavailable)?
            .digest
            .as_str()
            .to_owned(),
        repair_policy: RuntimeKernelRepairPolicyV1::current(),
        time_evidence,
    };
    form_request(inputs, committed_at_epoch_ms)
}

/// Admits only the exact canonical bytes recomputed from current Owner custody.
#[expect(
    clippy::too_many_arguments,
    reason = "canonical admission must re-resolve every independent Owner custody input"
)]
pub fn admit_stored_runtime_kernel_native_repair_request_v1(
    request_bytes: &[u8],
    receipt_bytes: &[u8],
    action: &RepairActionRequestReadbackV1,
    decision: &RepairInputIterationDecisionReadbackV1,
    replay: &ReplayRequestV2,
    result: &ReplayResultDtoV2,
    shared_time_evidence: &ClockHeadHandoff,
    committed_at_epoch_ms: u64,
) -> Result<RuntimeKernelNativeRepairRequestReadbackV1, RuntimeKernelNativeRepairRequestErrorV1> {
    let expected = issue_runtime_kernel_native_repair_request_v1(
        action,
        decision,
        replay,
        result,
        shared_time_evidence,
        committed_at_epoch_ms,
    )?;
    admit_expected_canonical_bytes(expected, request_bytes, receipt_bytes)
}

fn admit_expected_canonical_bytes(
    expected: RuntimeKernelNativeRepairRequestReadbackV1,
    request_bytes: &[u8],
    receipt_bytes: &[u8],
) -> Result<RuntimeKernelNativeRepairRequestReadbackV1, RuntimeKernelNativeRepairRequestErrorV1> {
    if expected.request().to_canonical_bytes()? == request_bytes
        && expected.receipt().to_canonical_bytes()? == receipt_bytes
    {
        Ok(expected)
    } else {
        Err(RuntimeKernelNativeRepairRequestErrorV1::CustodyMismatch)
    }
}

fn validate_exact_custody(
    action: &RepairActionRequestReadbackV1,
    decision: &RepairInputIterationDecisionReadbackV1,
    replay: &ReplayRequestV2,
    result: &ReplayResultDtoV2,
) -> Result<(), RuntimeKernelNativeRepairRequestErrorV1> {
    if action.request.category != IterationRepairCategoryV1::RuntimeKernel
        || action.request.target != IterationRepairTargetV1::Runtime
        || !matches!(
            decision.decision().outcome(),
            IterationDecisionOutcomeV1::RepairInputs {
                category: IterationRepairCategoryV1::RuntimeKernel,
                target: IterationRepairTargetV1::Runtime,
            }
        )
    {
        return Err(RuntimeKernelNativeRepairRequestErrorV1::WrongRepairTarget);
    }

    if result.terminal != ReplayTerminalV2::TerminalResult {
        return Err(RuntimeKernelNativeRepairRequestErrorV1::NonTerminalResult);
    }
    result
        .validate_against_request(replay)
        .map_err(|_| RuntimeKernelNativeRepairRequestErrorV1::CustodyMismatch)?;
    let evidence_cut = decision.decision().evidence_cut();
    let replay_digest = replay.meaning_digest().map_err(encoding)?;

    if action.request.decision_identity != decision.decision().decision_identity()
        || action.request.decision_digest != decision.decision().decision_digest()
        || action.request.result_identity != result.result_identity.as_str()
        || action.receipt.action_request_identity != action.request.action_request_identity
        || action.receipt.action_request_digest != action.request.action_request_digest
        || action.receipt.decision_identity != action.request.decision_identity
        || decision.receipt().decision_identity() != decision.decision().decision_identity()
        || decision.receipt().decision_digest() != decision.decision().decision_digest()
        || decision.receipt().result_identity() != result.result_identity.as_str()
        || evidence_cut.request_identity != replay.request_identity().as_str()
        || evidence_cut.request_digest != replay_digest.as_str()
        || evidence_cut.result_identity != result.result_identity.as_str()
        || evidence_cut.result_digest != result.result_digest.as_str()
        || evidence_cut.attempt_identity != result.attempt_identity.as_str()
    {
        return Err(RuntimeKernelNativeRepairRequestErrorV1::CustodyMismatch);
    }
    Ok(())
}

fn unique_runtime_kernel_defect(
    result: &ReplayResultDtoV2,
) -> Result<&DiagnosticEvidenceDtoV2, RuntimeKernelNativeRepairRequestErrorV1> {
    let mut defects = result
        .diagnostic_census
        .iter()
        .filter(|diagnostic| diagnostic.category == DiagnosticCategoryV2::RuntimeKernel);
    let defect = defects
        .next()
        .ok_or(RuntimeKernelNativeRepairRequestErrorV1::DefectProofUnavailable)?;

    if defects.next().is_some()
        || defect.request_identity != result.request_identity
        || defect.request_meaning_digest != result.request_meaning_digest
        || defect.attempt_identity != result.attempt_identity
    {
        return Err(RuntimeKernelNativeRepairRequestErrorV1::DefectProofUnavailable);
    }
    Ok(defect)
}

fn exact_runtime_kernel_reconciliation(
    result: &ReplayResultDtoV2,
) -> Result<&ReconciliationAtomDtoV2, RuntimeKernelNativeRepairRequestErrorV1> {
    let mut atoms = result
        .reconciliation
        .iter()
        .filter(|atom| atom.component == ObservationComponentV2::RuntimeKernel);
    let atom = atoms
        .next()
        .ok_or(RuntimeKernelNativeRepairRequestErrorV1::RuntimeKernelReconciliationUnavailable)?;
    let Some(locator) = atom.observation_locator.as_ref() else {
        return Err(
            RuntimeKernelNativeRepairRequestErrorV1::RuntimeKernelReconciliationUnavailable,
        );
    };

    if atoms.next().is_some()
        || atom.status != ReconciliationStatusV2::Exact
        || atom.observed_meaning_identity.as_ref() != Some(&atom.requested_meaning_identity)
        || atom.observed_meaning_digest.as_ref() != Some(&atom.requested_meaning_digest)
        || locator.component != ObservationComponentV2::RuntimeKernel
    {
        return Err(
            RuntimeKernelNativeRepairRequestErrorV1::RuntimeKernelReconciliationUnavailable,
        );
    }
    Ok(atom)
}

impl RuntimeKernelRepairTimeEvidenceV1 {
    fn from_handoff(
        handoff: &ClockHeadHandoff,
        decision_committed_at_epoch_ms: u64,
        action_committed_at_epoch_ms: u64,
        request_committed_at_epoch_ms: u64,
    ) -> Result<Self, RuntimeKernelNativeRepairRequestErrorV1> {
        let evidence = Self {
            clock_head_identity: handoff.head_identity(),
            clock_head_digest: handoff.head_digest(),
            clock_identity: handoff.clock_identity().to_owned(),
            clock_epoch: handoff.clock_epoch().to_owned(),
            monotonic_sequence: handoff.monotonic_sequence(),
            wall_observed_epoch_ms: handoff.wall_observed(),
            decision_cut_epoch_ms: handoff.decision_cut(),
            valid_through_epoch_ms: handoff.valid_through(),
            restart_continuity_digest: handoff.restart_continuity_digest(),
        };
        evidence.validate_ordering(
            decision_committed_at_epoch_ms,
            action_committed_at_epoch_ms,
            request_committed_at_epoch_ms,
        )?;
        Ok(evidence)
    }

    fn validate_ordering(
        &self,
        decision_committed_at_epoch_ms: u64,
        action_committed_at_epoch_ms: u64,
        request_committed_at_epoch_ms: u64,
    ) -> Result<(), RuntimeKernelNativeRepairRequestErrorV1> {
        if self.clock_identity.is_empty()
            || self.clock_epoch.is_empty()
            || self.monotonic_sequence == 0
            || decision_committed_at_epoch_ms > action_committed_at_epoch_ms
            || action_committed_at_epoch_ms > self.decision_cut_epoch_ms
            || self.wall_observed_epoch_ms > self.decision_cut_epoch_ms
            || self.decision_cut_epoch_ms > request_committed_at_epoch_ms
            || request_committed_at_epoch_ms >= self.valid_through_epoch_ms
        {
            return Err(RuntimeKernelNativeRepairRequestErrorV1::TimeEvidenceUnavailable);
        }
        Ok(())
    }
}

#[derive(Serialize)]
struct ValidatedRuntimeKernelRepairInputsV1 {
    action_request_identity: String,
    action_request_digest: String,
    action_receipt_identity: String,
    action_receipt_digest: String,
    decision_identity: String,
    decision_digest: String,
    decision_receipt_identity: String,
    replay_request_identity: String,
    replay_request_digest: String,
    result_identity: String,
    result_digest: String,
    replay_attempt_identity: String,
    original_proof_reference: String,
    original_proof_digest: String,
    old_kernel_identity: String,
    old_kernel_version: String,
    source_cut_locator: String,
    source_cut_digest: String,
    repair_policy: RuntimeKernelRepairPolicyV1,
    time_evidence: RuntimeKernelRepairTimeEvidenceV1,
}

#[derive(Serialize)]
struct CorrelationMeaningV1<'a> {
    schema_version: u16,
    decision_identity: &'a str,
    result_identity: &'a str,
    replay_attempt_identity: &'a str,
    original_proof_digest: &'a str,
    old_kernel_identity: &'a str,
    old_kernel_version: &'a str,
}

#[derive(Serialize)]
struct RequestMeaningV1<'a> {
    schema_version: u16,
    correlation_identity: &'a str,
    inputs: &'a ValidatedRuntimeKernelRepairInputsV1,
}

#[derive(Serialize)]
struct ReceiptMeaningV1<'a> {
    schema_version: u16,
    request_identity: &'a str,
    request_digest: &'a str,
    native_attempt_identity: &'a str,
    correlation_identity: &'a str,
    action_request_identity: &'a str,
    decision_identity: &'a str,
    committed_at_epoch_ms: u64,
}

fn form_request(
    inputs: ValidatedRuntimeKernelRepairInputsV1,
    committed_at_epoch_ms: u64,
) -> Result<RuntimeKernelNativeRepairRequestReadbackV1, RuntimeKernelNativeRepairRequestErrorV1> {
    let correlation_digest = digest(
        "rd.runtime-kernel-native-repair-correlation.v1",
        &CorrelationMeaningV1 {
            schema_version: 1,
            decision_identity: &inputs.decision_identity,
            result_identity: &inputs.result_identity,
            replay_attempt_identity: &inputs.replay_attempt_identity,
            original_proof_digest: &inputs.original_proof_digest,
            old_kernel_identity: &inputs.old_kernel_identity,
            old_kernel_version: &inputs.old_kernel_version,
        },
    )?;
    let correlation_identity = identity(
        "rd-runtime-kernel-repair-correlation-v1",
        &correlation_digest,
    );
    let request_digest = digest(
        "rd.runtime-kernel-native-repair-request.v1",
        &RequestMeaningV1 {
            schema_version: 1,
            correlation_identity: &correlation_identity,
            inputs: &inputs,
        },
    )?;
    let request_identity = identity(
        "rd-runtime-kernel-native-repair-request-v1",
        &request_digest,
    );
    let native_attempt_identity = identity("runtime-kernel-repair-attempt-v1", &request_digest);
    let request = RuntimeKernelNativeRepairRequestV1 {
        schema_version: 1,
        request_identity,
        request_digest,
        native_attempt_identity,
        correlation_identity,
        action_request_identity: inputs.action_request_identity,
        action_request_digest: inputs.action_request_digest,
        action_receipt_identity: inputs.action_receipt_identity,
        action_receipt_digest: inputs.action_receipt_digest,
        decision_identity: inputs.decision_identity,
        decision_digest: inputs.decision_digest,
        decision_receipt_identity: inputs.decision_receipt_identity,
        replay_request_identity: inputs.replay_request_identity,
        replay_request_digest: inputs.replay_request_digest,
        result_identity: inputs.result_identity,
        result_digest: inputs.result_digest,
        replay_attempt_identity: inputs.replay_attempt_identity,
        category: IterationRepairCategoryV1::RuntimeKernel,
        target: IterationRepairTargetV1::Runtime,
        original_proof_reference: inputs.original_proof_reference,
        original_proof_digest: inputs.original_proof_digest,
        old_kernel_identity: inputs.old_kernel_identity,
        old_kernel_version: inputs.old_kernel_version,
        source_cut_locator: inputs.source_cut_locator,
        source_cut_digest: inputs.source_cut_digest,
        repair_policy: inputs.repair_policy,
        time_evidence: inputs.time_evidence,
    };
    let receipt_digest = digest(
        "rd.runtime-kernel-native-repair-request-receipt.v1",
        &ReceiptMeaningV1 {
            schema_version: 1,
            request_identity: &request.request_identity,
            request_digest: &request.request_digest,
            native_attempt_identity: &request.native_attempt_identity,
            correlation_identity: &request.correlation_identity,
            action_request_identity: &request.action_request_identity,
            decision_identity: &request.decision_identity,
            committed_at_epoch_ms,
        },
    )?;
    Ok(RuntimeKernelNativeRepairRequestReadbackV1 {
        receipt: RuntimeKernelNativeRepairRequestReceiptV1 {
            schema_version: 1,
            receipt_identity: identity(
                "rd-runtime-kernel-native-repair-request-receipt-v1",
                &receipt_digest,
            ),
            receipt_digest,
            request_identity: request.request_identity.clone(),
            request_digest: request.request_digest.clone(),
            native_attempt_identity: request.native_attempt_identity.clone(),
            correlation_identity: request.correlation_identity.clone(),
            action_request_identity: request.action_request_identity.clone(),
            decision_identity: request.decision_identity.clone(),
            committed_at_epoch_ms,
        },
        request,
    })
}

fn digest(
    domain: &str,
    value: &impl Serialize,
) -> Result<String, RuntimeKernelNativeRepairRequestErrorV1> {
    #[derive(Serialize)]
    struct Envelope<'a, T> {
        domain: &'a str,
        value: &'a T,
    }
    serde_json::to_vec(&Envelope { domain, value })
        .map(|bytes| format!("sha256:{:x}", Sha256::digest(bytes)))
        .map_err(encoding)
}

fn identity(prefix: &str, digest: &str) -> String {
    format!("{prefix}-{}", digest.trim_start_matches("sha256:"))
}

fn encoding(error: impl Display) -> RuntimeKernelNativeRepairRequestErrorV1 {
    RuntimeKernelNativeRepairRequestErrorV1::Encoding(error.to_string())
}

#[cfg(test)]
mod tests {
    use rstest::rstest;
    use serde_json::json;
    use vibe_backtest_owner_contracts::{
        CanonicalDigestV2, ComponentObservationLocatorV2, OpaqueIdentityV2, ReplayAuthorityClaimV2,
        ReplayNamespaceV2,
    };

    use super::*;

    fn opaque(value: &str) -> OpaqueIdentityV2 {
        value.to_owned().try_into().unwrap()
    }

    fn canonical(byte: char) -> CanonicalDigestV2 {
        format!("sha256:{}", byte.to_string().repeat(64))
            .try_into()
            .unwrap()
    }

    fn time_evidence() -> RuntimeKernelRepairTimeEvidenceV1 {
        RuntimeKernelRepairTimeEvidenceV1 {
            clock_head_identity: BindingDigest::from_untrusted_bytes([1; 32]),
            clock_head_digest: BindingDigest::from_untrusted_bytes([2; 32]),
            clock_identity: "market-data-clock".to_owned(),
            clock_epoch: "epoch-1".to_owned(),
            monotonic_sequence: 7,
            wall_observed_epoch_ms: 120,
            decision_cut_epoch_ms: 130,
            valid_through_epoch_ms: 200,
            restart_continuity_digest: BindingDigest::from_untrusted_bytes([3; 32]),
        }
    }

    fn inputs() -> ValidatedRuntimeKernelRepairInputsV1 {
        ValidatedRuntimeKernelRepairInputsV1 {
            action_request_identity: "repair-action".to_owned(),
            action_request_digest: format!("sha256:{}", "a".repeat(64)),
            action_receipt_identity: "repair-action-receipt".to_owned(),
            action_receipt_digest: format!("sha256:{}", "b".repeat(64)),
            decision_identity: "iteration-decision".to_owned(),
            decision_digest: format!("sha256:{}", "c".repeat(64)),
            decision_receipt_identity: "iteration-decision-receipt".to_owned(),
            replay_request_identity: "replay-request".to_owned(),
            replay_request_digest: format!("blake3:{}", "d".repeat(64)),
            result_identity: "replay-result".to_owned(),
            result_digest: format!("blake3:{}", "e".repeat(64)),
            replay_attempt_identity: "replay-attempt".to_owned(),
            original_proof_reference: "runtime-proof".to_owned(),
            original_proof_digest: format!("sha256:{}", "f".repeat(64)),
            old_kernel_identity: "shared-runtime-kernel".to_owned(),
            old_kernel_version: "kernel-v7".to_owned(),
            source_cut_locator: "runtime-kernel-source-cut".to_owned(),
            source_cut_digest: format!("sha256:{}", "1".repeat(64)),
            repair_policy: RuntimeKernelRepairPolicyV1::current(),
            time_evidence: time_evidence(),
        }
    }

    fn empty_result() -> ReplayResultDtoV2 {
        ReplayResultDtoV2 {
            schema_version: 2,
            result_identity: opaque("result"),
            result_digest: canonical('1'),
            request_identity: opaque("request"),
            request_meaning_digest: canonical('2'),
            namespace: ReplayNamespaceV2::Exploratory,
            replay_authority: ReplayAuthorityClaimV2::Exploratory,
            attempt_identity: opaque("attempt"),
            terminal: ReplayTerminalV2::TerminalResult,
            reconciliation: Vec::new(),
            semantic_trace: None,
            diagnostic_census: Vec::new(),
        }
    }

    fn runtime_diagnostic(result: &ReplayResultDtoV2) -> DiagnosticEvidenceDtoV2 {
        DiagnosticEvidenceDtoV2 {
            request_identity: result.request_identity.clone(),
            request_meaning_digest: result.request_meaning_digest.clone(),
            attempt_identity: result.attempt_identity.clone(),
            category: DiagnosticCategoryV2::RuntimeKernel,
            decisive_evidence: ComponentObservationLocatorV2 {
                component: ObservationComponentV2::RuntimeKernel,
                reference: opaque("runtime-proof"),
                digest: canonical('3'),
            },
        }
    }

    fn runtime_reconciliation() -> ReconciliationAtomDtoV2 {
        ReconciliationAtomDtoV2 {
            component: ObservationComponentV2::RuntimeKernel,
            requested_meaning_identity: opaque("kernel-v7"),
            requested_meaning_digest: canonical('4'),
            observed_meaning_identity: Some(opaque("kernel-v7")),
            observed_meaning_digest: Some(canonical('4')),
            observation_locator: Some(ComponentObservationLocatorV2 {
                component: ObservationComponentV2::RuntimeKernel,
                reference: opaque("kernel-source-cut"),
                digest: canonical('5'),
            }),
            status: ReconciliationStatusV2::Exact,
        }
    }

    #[rstest]
    fn same_inputs_form_same_request_attempt_and_canonical_bytes() {
        let first = form_request(inputs(), 150).unwrap();
        let second = form_request(inputs(), 150).unwrap();
        assert_eq!(first, second);
        assert_eq!(
            first.request().to_canonical_bytes().unwrap(),
            second.request().to_canonical_bytes().unwrap()
        );
        assert_eq!(
            first.request().native_attempt_identity(),
            second.request().native_attempt_identity()
        );

        let mut changed = inputs();
        changed.source_cut_locator.push_str("-changed");
        let changed = form_request(changed, 150).unwrap();
        assert_ne!(
            first.request().request_digest(),
            changed.request().request_digest()
        );
        assert_ne!(
            first.request().native_attempt_identity(),
            changed.request().native_attempt_identity()
        );
    }

    #[rstest]
    fn canonical_admission_rejects_tamper_unknown_fields_and_noncanonical_encoding() {
        let expected = form_request(inputs(), 150).unwrap();
        let request_bytes = expected.request().to_canonical_bytes().unwrap();
        let receipt_bytes = expected.receipt().to_canonical_bytes().unwrap();
        assert_eq!(
            admit_expected_canonical_bytes(expected.clone(), &request_bytes, &receipt_bytes)
                .unwrap(),
            expected
        );

        let mut tampered = request_bytes.clone();
        tampered[20] ^= 1;
        assert_eq!(
            admit_expected_canonical_bytes(expected.clone(), &tampered, &receipt_bytes)
                .unwrap_err(),
            RuntimeKernelNativeRepairRequestErrorV1::CustodyMismatch
        );

        let mut unknown: serde_json::Value = serde_json::from_slice(&request_bytes).unwrap();
        unknown["unknown"] = json!(true);
        assert_eq!(
            admit_expected_canonical_bytes(
                expected.clone(),
                &serde_json::to_vec(&unknown).unwrap(),
                &receipt_bytes,
            )
            .unwrap_err(),
            RuntimeKernelNativeRepairRequestErrorV1::CustodyMismatch
        );

        let mut noncanonical = request_bytes;
        noncanonical.push(b'\n');
        assert_eq!(
            admit_expected_canonical_bytes(expected, &noncanonical, &receipt_bytes).unwrap_err(),
            RuntimeKernelNativeRepairRequestErrorV1::CustodyMismatch
        );
    }

    #[rstest]
    fn unique_runtime_diagnostic_is_required_and_cross_splice_is_rejected() {
        let mut result = empty_result();
        assert_eq!(
            unique_runtime_kernel_defect(&result).unwrap_err(),
            RuntimeKernelNativeRepairRequestErrorV1::DefectProofUnavailable
        );
        result.diagnostic_census.push(runtime_diagnostic(&result));
        assert_eq!(
            unique_runtime_kernel_defect(&result)
                .unwrap()
                .decisive_evidence
                .reference
                .as_str(),
            "runtime-proof"
        );
        result.diagnostic_census.push(runtime_diagnostic(&result));
        assert_eq!(
            unique_runtime_kernel_defect(&result).unwrap_err(),
            RuntimeKernelNativeRepairRequestErrorV1::DefectProofUnavailable
        );
        result.diagnostic_census.pop();
        result.diagnostic_census[0].attempt_identity = opaque("other-attempt");
        assert_eq!(
            unique_runtime_kernel_defect(&result).unwrap_err(),
            RuntimeKernelNativeRepairRequestErrorV1::DefectProofUnavailable
        );
    }

    #[rstest]
    fn runtime_reconciliation_must_be_unique_exact_and_source_bound() {
        let mut result = empty_result();
        result.reconciliation.push(runtime_reconciliation());
        assert_eq!(
            exact_runtime_kernel_reconciliation(&result)
                .unwrap()
                .observation_locator
                .as_ref()
                .unwrap()
                .reference
                .as_str(),
            "kernel-source-cut"
        );
        result.reconciliation[0].status = ReconciliationStatusV2::Mismatched;
        assert_eq!(
            exact_runtime_kernel_reconciliation(&result).unwrap_err(),
            RuntimeKernelNativeRepairRequestErrorV1::RuntimeKernelReconciliationUnavailable
        );
        result.reconciliation[0] = runtime_reconciliation();
        result.reconciliation.push(runtime_reconciliation());
        assert_eq!(
            exact_runtime_kernel_reconciliation(&result).unwrap_err(),
            RuntimeKernelNativeRepairRequestErrorV1::RuntimeKernelReconciliationUnavailable
        );
    }

    #[rstest]
    fn time_evidence_rejects_future_or_expired_requests() {
        let evidence = time_evidence();
        assert!(evidence.validate_ordering(100, 110, 150).is_ok());

        for ordering in [
            (111, 110, 150),
            (100, 131, 150),
            (100, 110, 129),
            (100, 110, 200),
        ] {
            assert_eq!(
                evidence
                    .validate_ordering(ordering.0, ordering.1, ordering.2)
                    .unwrap_err(),
                RuntimeKernelNativeRepairRequestErrorV1::TimeEvidenceUnavailable
            );
        }
    }

    #[rstest]
    fn repair_policy_is_content_addressed_and_stable() {
        let policy = RuntimeKernelRepairPolicyV1::current();
        assert_eq!(policy, RuntimeKernelRepairPolicyV1::current());
        assert_eq!(policy.policy_version(), 1);
        assert_eq!(
            policy.policy_identity(),
            identity("rd-runtime-kernel-repair-policy-v1", policy.policy_digest())
        );
    }
}
