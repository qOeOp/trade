//! Effect-free R&D repair action requests derived from exact Iteration Decision custody.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;

use crate::iteration_decision::{
    IterationDecisionOutcomeV1, IterationRepairCategoryV1, IterationRepairTargetV1,
    RepairInputIterationDecisionReadbackV1,
};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct RepairActionRequestV1 {
    schema_version: u16,
    action_request_identity: String,
    action_request_digest: String,
    decision_identity: String,
    decision_digest: String,
    result_identity: String,
    category: IterationRepairCategoryV1,
    target: IterationRepairTargetV1,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct RepairActionRequestReceiptV1 {
    schema_version: u16,
    receipt_identity: String,
    receipt_digest: String,
    action_request_identity: String,
    action_request_digest: String,
    decision_identity: String,
    committed_at_epoch_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct RepairActionRequestReadbackV1 {
    request: RepairActionRequestV1,
    receipt: RepairActionRequestReceiptV1,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct StoredRepairActionRequestV1 {
    schema_version: u16,
    action_request_identity: String,
    action_request_digest: String,
    decision_identity: String,
    decision_digest: String,
    result_identity: String,
    category: IterationRepairCategoryV1,
    target: IterationRepairTargetV1,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct StoredRepairActionRequestReceiptV1 {
    schema_version: u16,
    receipt_identity: String,
    receipt_digest: String,
    action_request_identity: String,
    action_request_digest: String,
    decision_identity: String,
    committed_at_epoch_ms: u64,
}

#[derive(Debug, Error)]
pub enum RepairActionErrorV1 {
    #[error("Iteration Decision does not contain a repair action")]
    NonRepairDecision,
    #[error("repair action encoding is unavailable: {0}")]
    Encoding(String),
    #[error("stored repair action custody is unavailable")]
    Unavailable,
}

impl RepairActionRequestV1 {
    pub fn action_request_identity(&self) -> &str {
        &self.action_request_identity
    }
    pub fn action_request_digest(&self) -> &str {
        &self.action_request_digest
    }
    pub fn decision_identity(&self) -> &str {
        &self.decision_identity
    }
    pub fn decision_digest(&self) -> &str {
        &self.decision_digest
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
}

impl RepairActionRequestReceiptV1 {
    pub fn receipt_identity(&self) -> &str {
        &self.receipt_identity
    }
    pub fn receipt_digest(&self) -> &str {
        &self.receipt_digest
    }
    pub const fn committed_at_epoch_ms(&self) -> u64 {
        self.committed_at_epoch_ms
    }
}

impl RepairActionRequestReadbackV1 {
    pub fn request(&self) -> &RepairActionRequestV1 {
        &self.request
    }
    pub fn receipt(&self) -> &RepairActionRequestReceiptV1 {
        &self.receipt
    }
}

pub(crate) fn issue_repair_action_request_v1(
    decision: &RepairInputIterationDecisionReadbackV1,
    committed_at_epoch_ms: u64,
) -> Result<RepairActionRequestReadbackV1, RepairActionErrorV1> {
    let IterationDecisionOutcomeV1::RepairInputs { category, target } =
        decision.decision().outcome()
    else {
        return Err(RepairActionErrorV1::NonRepairDecision);
    };
    let meaning = RepairActionMeaningV1 {
        schema_version: 1,
        decision_identity: decision.decision().decision_identity(),
        decision_digest: decision.decision().decision_digest(),
        result_identity: decision.receipt().result_identity(),
        category: *category,
        target: *target,
    };
    let action_request_digest = digest("rd.repair-action-request.v1", &meaning)?;
    let action_request_identity = identity("rd-repair-action-request-v1", &action_request_digest);
    let request = RepairActionRequestV1 {
        schema_version: 1,
        action_request_identity: action_request_identity.clone(),
        action_request_digest: action_request_digest.clone(),
        decision_identity: meaning.decision_identity.to_string(),
        decision_digest: meaning.decision_digest.to_string(),
        result_identity: meaning.result_identity.to_string(),
        category: meaning.category,
        target: meaning.target,
    };
    let receipt_meaning = RepairActionReceiptMeaningV1 {
        schema_version: 1,
        action_request_identity: &action_request_identity,
        action_request_digest: &action_request_digest,
        decision_identity: meaning.decision_identity,
        committed_at_epoch_ms,
    };
    let receipt_digest = digest("rd.repair-action-request-receipt.v1", &receipt_meaning)?;
    Ok(RepairActionRequestReadbackV1 {
        request,
        receipt: RepairActionRequestReceiptV1 {
            schema_version: 1,
            receipt_identity: identity("rd-repair-action-request-receipt-v1", &receipt_digest),
            receipt_digest,
            action_request_identity,
            action_request_digest,
            decision_identity: meaning.decision_identity.to_string(),
            committed_at_epoch_ms,
        },
    })
}

pub(crate) fn admit_stored_repair_action_request_v1(
    request_bytes: &[u8],
    receipt_bytes: &[u8],
    decision: &RepairInputIterationDecisionReadbackV1,
) -> Result<RepairActionRequestReadbackV1, RepairActionErrorV1> {
    let request: StoredRepairActionRequestV1 = decode_canonical(request_bytes)?;
    let receipt: StoredRepairActionRequestReceiptV1 = decode_canonical(receipt_bytes)?;
    let expected = issue_repair_action_request_v1(decision, receipt.committed_at_epoch_ms)?;
    if serde_json::to_value(request).map_err(encoding)?
        != serde_json::to_value(expected.request()).map_err(encoding)?
        || serde_json::to_value(receipt).map_err(encoding)?
            != serde_json::to_value(expected.receipt()).map_err(encoding)?
    {
        return Err(RepairActionErrorV1::Unavailable);
    }
    Ok(expected)
}

#[derive(Serialize)]
struct RepairActionMeaningV1<'a> {
    schema_version: u16,
    decision_identity: &'a str,
    decision_digest: &'a str,
    result_identity: &'a str,
    category: IterationRepairCategoryV1,
    target: IterationRepairTargetV1,
}

#[derive(Serialize)]
struct RepairActionReceiptMeaningV1<'a> {
    schema_version: u16,
    action_request_identity: &'a str,
    action_request_digest: &'a str,
    decision_identity: &'a str,
    committed_at_epoch_ms: u64,
}

fn decode_canonical<T>(bytes: &[u8]) -> Result<T, RepairActionErrorV1>
where
    T: for<'de> Deserialize<'de> + Serialize,
{
    let value = serde_json::from_slice(bytes).map_err(encoding)?;
    if serde_json::to_vec(&value).map_err(encoding)? != bytes {
        return Err(RepairActionErrorV1::Unavailable);
    }
    Ok(value)
}

fn digest(domain: &str, value: &impl Serialize) -> Result<String, RepairActionErrorV1> {
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

fn encoding(error: impl std::fmt::Display) -> RepairActionErrorV1 {
    RepairActionErrorV1::Encoding(error.to_string())
}
