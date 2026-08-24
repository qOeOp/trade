use super::*;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct LockedPortfolioReadPolicyEnvelopeV1 {
    pub(super) operator_authorization: serde_json::Value,
    pub(super) product_edge: serde_json::Value,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct StoredManifestV1 {
    pub(super) schema_version: u32,
    pub(super) manifest_identity: String,
    pub(super) manifest_digest: String,
    pub(super) proposal: AgentOperationManifestProposalV1,
    pub(super) committed_at_epoch_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct StoredManifestReceiptV1 {
    pub(super) schema_version: u32,
    pub(super) receipt_identity: String,
    pub(super) manifest_identity: String,
    pub(super) manifest_digest: String,
    pub(super) committed_at_epoch_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct StoredBindingV1 {
    pub(super) schema_version: u32,
    pub(super) deployment_identity: String,
    pub(super) binding_identity: String,
    pub(super) generation: u64,
    pub(super) predecessor_binding_identity: Option<String>,
    pub(super) effective_principal: String,
    pub(super) authorized_scope: Vec<String>,
    pub(super) scope_policy_version: String,
    pub(super) capability_policy_version: String,
    pub(super) audit_policy_version: String,
    pub(super) valid_from_epoch_ms: u64,
    pub(super) valid_through_epoch_ms: u64,
    pub(super) authorization: OperatorAuthorizationLocatorV1,
    pub(super) authorization_frontier_identity: String,
    pub(super) manifest_identities: Vec<String>,
    pub(super) binding_digest: String,
    pub(super) committed_at_epoch_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct StoredBindingReceiptV1 {
    pub(super) schema_version: u32,
    pub(super) receipt_identity: String,
    pub(super) binding_identity: String,
    pub(super) binding_digest: String,
    pub(super) committed_at_epoch_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct StoredSupersessionV1 {
    pub(super) schema_version: u32,
    pub(super) binding_identity: String,
    pub(super) successor_binding_identity: String,
    pub(super) successor_proposal_digest: String,
    pub(super) supersession_digest: String,
    pub(super) committed_at_epoch_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct StoredAdmissionV1 {
    pub(super) schema_version: u32,
    pub(super) admission_identity: String,
    pub(super) admission_digest: String,
    pub(super) request_semantic_digest: String,
    pub(super) request: ProductEdgeAdmissionRequestV1,
    pub(super) deployment_identity: String,
    pub(super) binding_identity: String,
    pub(super) binding_generation: u64,
    pub(super) history_head_identity: String,
    pub(super) effective_principal: String,
    pub(super) authorized_scope: Vec<String>,
    pub(super) scope_policy_version: String,
    pub(super) capability_policy_version: String,
    pub(super) audit_policy_version: String,
    pub(super) authorization: OperatorAuthorizationLocatorV1,
    pub(super) authorization_frontier_identity: String,
    pub(super) manifest_identity: String,
    pub(super) manifest_digest: String,
    pub(super) read_cut_epoch_ms: u64,
    pub(super) committed_at_epoch_ms: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) current_research_custody: Option<StoredCurrentResearchCustodyV1>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct StoredCurrentResearchCustodyV1 {
    pub(super) evidence_digest: String,
    pub(super) evidence: StoredCurrentResearchEvidenceV1,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct StoredCurrentResearchEvidenceV1 {
    pub(super) schema_version: u32,
    pub(super) evidence_identity: String,
    pub(super) request_identity: String,
    pub(super) semantic_digest: String,
    pub(super) source_admission: ProductEdgeAdmissionLocatorV1,
    pub(super) effective_principal: String,
    pub(super) authorized_scope: Vec<String>,
    pub(super) receipt_identity: String,
    pub(super) intent_identity: String,
    pub(super) view_identity: String,
    pub(super) projection_at_epoch_ms: u64,
    pub(super) valid_through_epoch_ms: u64,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct ArtifactBuildAdmissionPayloadV1 {
    pub(super) build_request_identity: String,
    pub(super) attempt_identity: String,
    pub(super) intent_identity: String,
    pub(super) channel: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct PeekCurrentResearchEnvelopeV1 {
    pub(super) evidence_digest: String,
    pub(super) evidence: StoredCurrentResearchEvidenceV1,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct LockedCurrentResearchEnvelopeV1 {
    pub(super) owner_cut_epoch_ms: u64,
    pub(super) evidence_digest: String,
    pub(super) evidence: StoredCurrentResearchEvidenceV1,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct StoredAdmissionReceiptV1 {
    pub(super) schema_version: u32,
    pub(super) receipt_identity: String,
    pub(super) admission_identity: String,
    pub(super) admission_digest: String,
    pub(super) committed_at_epoch_ms: u64,
}

impl From<StoredAdmissionReceiptV1> for ProductEdgeAdmissionReceiptV1 {
    fn from(value: StoredAdmissionReceiptV1) -> Self {
        Self {
            schema_version: value.schema_version,
            receipt_identity: value.receipt_identity,
            admission_identity: value.admission_identity,
            admission_digest: value.admission_digest,
            committed_at_epoch_ms: value.committed_at_epoch_ms,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct StoredOutboxV1 {
    pub(super) schema_version: u32,
    pub(super) event_identity: String,
    pub(super) aggregate_identity: String,
    pub(super) event_kind: String,
    pub(super) payload_digest: String,
    pub(super) committed_at_epoch_ms: u64,
}
