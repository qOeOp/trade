//! Backtest-only construction of Qualification-isolated protected results.

use std::collections::BTreeMap;

use serde::Serialize;
use thiserror::Error;
#[cfg(test)]
use vibe_backtest_owner_contracts::{CanonicalDigestV2, OpaqueIdentityV2};
use vibe_backtest_owner_contracts::{
    DiagnosticCategoryV2, PROTECTED_REPLAY_BINDING_COUNT_V1, ProtectedConsumedInputLocatorV1,
    ProtectedReplayBindingFieldV1, ProtectedReplayReconciliationAtomV1,
    ProtectedReplayRequestDtoV1, ProtectedReplayResultDtoV1, ProtectedResultOutcomeLocatorV1,
    ReconciliationStatusV2, ReplayTerminalV2, protected_diagnostic_category_set_digest_v1,
};

#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum ProtectedReplayOwnerErrorV1 {
    #[error("protected replay observation belongs to a different request or attempt")]
    ObservationBindingMismatch,
    #[error("protected replay observation field is duplicated")]
    DuplicateObservation,
    #[error("protected replay result is noncanonical")]
    InvalidResult,
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

/// Serialize-only Backtest Owner result. Callers cannot construct or deserialize this value.
#[derive(Debug, Serialize)]
#[serde(transparent)]
pub struct SealedProtectedReplayResultV1(ProtectedReplayResultDtoV1);

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
