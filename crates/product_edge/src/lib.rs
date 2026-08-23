//! Sealed Product Edge deployment and request-admission facts.

mod invocation;
mod postgres;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;
use vibe_operator_authorization::{
    OperatorAuthorizationLocatorV1, OperatorAuthorizationReadbackV1,
    UntrustedCanonicalAuthorizationEvidenceV1,
};

pub use invocation::{
    ProductEdgeInvocationClaimDispositionV1, ProductEdgeInvocationClaimReadbackV1,
    ProductEdgeInvocationNextLegalActionV1, ProductEdgeInvocationStartDispositionV1,
    ProductEdgeInvocationStartReadbackV1, ProductEdgeInvocationStateV1,
};
pub use postgres::{ProductEdgePostgresOwnerV1, resolve_admission_for_downstream_in_transaction};

pub const PRODUCT_EDGE_SCHEMA_V1: u32 = 1;
/// Canonical ordered effects requested by an R&D artifact-build admission.
///
/// This is vocabulary, not authority: Product Edge and every downstream
/// mutation boundary still verify the sealed admission independently.
pub const ARTIFACT_BUILD_REQUIRED_EFFECTS_V1: [&str; 2] = [
    "R_AND_D_ARTIFACT_BUILD_MUTATION_V1",
    "R_AND_D_PROVIDER_INVOCATION_V1",
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProductEdgeAuthorizationTrustV1 {
    pub issuer_identity: String,
    pub issuer_key_version: String,
    pub audience: String,
}

impl ProductEdgeAuthorizationTrustV1 {
    pub fn validate(&self) -> Result<(), ProductEdgeError> {
        if self.issuer_identity.trim().is_empty()
            || self.issuer_key_version.trim().is_empty()
            || self.audience.trim().is_empty()
        {
            return Err(ProductEdgeError::InvalidProposal(
                "operator authorization trust",
            ));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AgentOperationManifestProposalV1 {
    pub operation: String,
    pub operation_schema: String,
    pub target_owner: String,
    pub allowed_effects: Vec<String>,
    pub prohibited_effects: Vec<String>,
    pub capability_policy_digest: String,
    pub effective_from_epoch_ms: u64,
    pub valid_through_epoch_ms: u64,
}

impl AgentOperationManifestProposalV1 {
    pub fn validate(&self) -> Result<(), ProductEdgeError> {
        if self.operation.trim().is_empty()
            || self.operation_schema.trim().is_empty()
            || self.target_owner.trim().is_empty()
            || self.capability_policy_digest.trim().is_empty()
            || self.allowed_effects.is_empty()
            || !sorted_unique(&self.allowed_effects)
            || !sorted_unique(&self.prohibited_effects)
            || self.effective_from_epoch_ms >= self.valid_through_epoch_ms
        {
            return Err(ProductEdgeError::InvalidProposal("operation manifest"));
        }
        Ok(())
    }

    pub fn manifest_digest(&self) -> Result<String, ProductEdgeError> {
        canonical_digest("product-edge.operation-manifest.v1", self)
    }

    pub fn manifest_identity(&self) -> Result<String, ProductEdgeError> {
        Ok(identity(
            "product-edge-operation-manifest-v1",
            &[&self.manifest_digest()?],
        ))
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProductEdgeBootstrapProposalV1 {
    pub deployment_identity: String,
    pub binding_identity: String,
    pub expected_history_head: String,
    pub generation: u64,
    pub effective_principal: String,
    pub scope_policy_version: String,
    pub capability_policy_version: String,
    pub audit_policy_version: String,
    pub valid_from_epoch_ms: u64,
    pub valid_through_epoch_ms: u64,
    pub authorization: OperatorAuthorizationLocatorV1,
    pub manifests: Vec<AgentOperationManifestProposalV1>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ProductEdgeBootstrapReadbackV1 {
    deployment_identity: String,
    binding_identity: String,
    generation: u64,
    history_head_identity: String,
    manifest_identities: Vec<String>,
    authorization: OperatorAuthorizationReadbackV1,
    committed_at_epoch_ms: u64,
}

impl ProductEdgeBootstrapReadbackV1 {
    pub fn deployment_identity(&self) -> &str {
        &self.deployment_identity
    }
    pub fn binding_identity(&self) -> &str {
        &self.binding_identity
    }
    pub fn generation(&self) -> u64 {
        self.generation
    }
    pub fn history_head_identity(&self) -> &str {
        &self.history_head_identity
    }
    pub fn manifest_identities(&self) -> &[String] {
        &self.manifest_identities
    }
    pub fn authorization(&self) -> &OperatorAuthorizationReadbackV1 {
        &self.authorization
    }

    pub fn committed_at_epoch_ms(&self) -> u64 {
        self.committed_at_epoch_ms
    }
}

impl ProductEdgeBootstrapProposalV1 {
    pub fn validate(&self) -> Result<(), ProductEdgeError> {
        if self.deployment_identity.trim().is_empty()
            || self.binding_identity.trim().is_empty()
            || self.expected_history_head != "EMPTY"
            || self.generation != 1
            || self.effective_principal.trim().is_empty()
            || self.scope_policy_version.trim().is_empty()
            || self.capability_policy_version.trim().is_empty()
            || self.audit_policy_version.trim().is_empty()
            || self.valid_from_epoch_ms >= self.valid_through_epoch_ms
            || self.manifests.is_empty()
        {
            return Err(ProductEdgeError::InvalidProposal("deployment bootstrap"));
        }

        for manifest in &self.manifests {
            manifest.validate()?;
        }
        let identities = self
            .manifests
            .iter()
            .map(AgentOperationManifestProposalV1::manifest_identity)
            .collect::<Result<Vec<_>, _>>()?;

        if !sorted_unique(&identities) {
            return Err(ProductEdgeError::InvalidProposal("manifest ordering"));
        }
        Ok(())
    }

    pub fn semantic_digest(&self) -> Result<String, ProductEdgeError> {
        canonical_digest("product-edge.bootstrap-proposal.v1", self)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProductEdgeSuccessorProposalV1 {
    pub deployment_identity: String,
    pub binding_identity: String,
    pub predecessor_binding_identity: String,
    pub expected_history_head: String,
    pub generation: u64,
    pub effective_principal: String,
    pub scope_policy_version: String,
    pub capability_policy_version: String,
    pub audit_policy_version: String,
    pub valid_from_epoch_ms: u64,
    pub valid_through_epoch_ms: u64,
    pub authorization: OperatorAuthorizationLocatorV1,
    pub manifests: Vec<AgentOperationManifestProposalV1>,
}

impl ProductEdgeSuccessorProposalV1 {
    pub fn validate(&self) -> Result<(), ProductEdgeError> {
        if self.deployment_identity.trim().is_empty()
            || self.binding_identity.trim().is_empty()
            || self.predecessor_binding_identity.trim().is_empty()
            || self.expected_history_head != self.predecessor_binding_identity
            || self.generation < 2
            || self.effective_principal.trim().is_empty()
            || self.scope_policy_version.trim().is_empty()
            || self.capability_policy_version.trim().is_empty()
            || self.audit_policy_version.trim().is_empty()
            || self.valid_from_epoch_ms >= self.valid_through_epoch_ms
            || self.manifests.is_empty()
        {
            return Err(ProductEdgeError::InvalidProposal("deployment successor"));
        }

        for manifest in &self.manifests {
            manifest.validate()?;
        }
        let identities = self
            .manifests
            .iter()
            .map(AgentOperationManifestProposalV1::manifest_identity)
            .collect::<Result<Vec<_>, _>>()?;

        if !sorted_unique(&identities) {
            return Err(ProductEdgeError::InvalidProposal("manifest ordering"));
        }
        Ok(())
    }

    pub fn semantic_digest(&self) -> Result<String, ProductEdgeError> {
        canonical_digest("product-edge.successor-proposal.v1", self)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProductEdgeAdmissionRequestV1 {
    pub request_identity: String,
    pub typed_payload: serde_json::Value,
    pub operation: String,
    pub operation_schema: String,
    pub target_owner: String,
    pub requested_effects: Vec<String>,
    pub request_proof_digest: String,
    pub audit_correlation: String,
}

impl ProductEdgeAdmissionRequestV1 {
    pub fn validate(&self) -> Result<(), ProductEdgeError> {
        if self.request_identity.trim().is_empty()
            || self.operation.trim().is_empty()
            || self.operation_schema.trim().is_empty()
            || self.target_owner.trim().is_empty()
            || self.request_proof_digest.trim().is_empty()
            || self.audit_correlation.trim().is_empty()
            || !sorted_unique(&self.requested_effects)
        {
            return Err(ProductEdgeError::InvalidProposal("request admission"));
        }
        Ok(())
    }

    pub fn semantic_digest(&self) -> Result<String, ProductEdgeError> {
        canonical_digest("product-edge.admission-request.v1", self)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProductEdgeAdmissionLocatorV1 {
    pub request_identity: String,
    pub admission_identity: String,
    pub admission_digest: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ProductEdgeAdmissionReceiptV1 {
    schema_version: u32,
    receipt_identity: String,
    admission_identity: String,
    admission_digest: String,
    committed_at_epoch_ms: u64,
}

impl ProductEdgeAdmissionReceiptV1 {
    pub fn receipt_identity(&self) -> &str {
        &self.receipt_identity
    }
    pub fn committed_at_epoch_ms(&self) -> u64 {
        self.committed_at_epoch_ms
    }
}

/// Sealed Product Edge admission; callers cannot deserialize positive custody.
///
/// ```compile_fail
/// use vibe_product_edge::ProductEdgeAdmissionReadbackV1;
/// let _: ProductEdgeAdmissionReadbackV1 = serde_json::from_str("{}").unwrap();
/// ```
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ProductEdgeAdmissionReadbackV1 {
    locator: ProductEdgeAdmissionLocatorV1,
    receipt: ProductEdgeAdmissionReceiptV1,
    request: ProductEdgeAdmissionRequestV1,
    deployment_identity: String,
    binding_identity: String,
    binding_generation: u64,
    history_head_identity: String,
    effective_principal: String,
    authorized_scope: Vec<String>,
    scope_policy_version: String,
    capability_policy_version: String,
    audit_policy_version: String,
    authorization: UntrustedCanonicalAuthorizationEvidenceV1,
    manifest_identity: String,
    manifest_digest: String,
    read_cut_epoch_ms: u64,
    #[serde(skip)]
    original_current_authorization_evidence: Option<UntrustedCanonicalAuthorizationEvidenceV1>,
    #[serde(skip)]
    current_policy_evidence: Option<ProductEdgeCurrentPolicyEvidenceV1>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ProductEdgeCurrentPolicyEvidenceV1 {
    binding_identity: String,
    binding_generation: u64,
    authorization: UntrustedCanonicalAuthorizationEvidenceV1,
    manifest_identity: String,
    manifest_digest: String,
    binding_valid_from_epoch_ms: u64,
    binding_valid_through_epoch_ms: u64,
    manifest_effective_from_epoch_ms: u64,
    manifest_valid_through_epoch_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProductEdgeInvocationClaimRequestV1 {
    pub admission: ProductEdgeAdmissionLocatorV1,
    pub attempt_identity: String,
}

impl ProductEdgeAdmissionReadbackV1 {
    pub fn locator(&self) -> &ProductEdgeAdmissionLocatorV1 {
        &self.locator
    }
    pub fn receipt(&self) -> &ProductEdgeAdmissionReceiptV1 {
        &self.receipt
    }
    pub fn request(&self) -> &ProductEdgeAdmissionRequestV1 {
        &self.request
    }
    pub fn deployment_identity(&self) -> &str {
        &self.deployment_identity
    }
    pub fn binding_identity(&self) -> &str {
        &self.binding_identity
    }
    pub fn binding_generation(&self) -> u64 {
        self.binding_generation
    }
    pub fn history_head_identity(&self) -> &str {
        &self.history_head_identity
    }
    pub fn effective_principal(&self) -> &str {
        &self.effective_principal
    }
    pub fn authorized_scope(&self) -> &[String] {
        &self.authorized_scope
    }
    pub fn scope_policy_version(&self) -> &str {
        &self.scope_policy_version
    }
    pub fn capability_policy_version(&self) -> &str {
        &self.capability_policy_version
    }
    pub fn audit_policy_version(&self) -> &str {
        &self.audit_policy_version
    }
    pub fn authorization(&self) -> &UntrustedCanonicalAuthorizationEvidenceV1 {
        &self.authorization
    }
    pub fn has_same_admission_lineage(&self, other: &Self) -> bool {
        self.locator == other.locator
            && self.receipt == other.receipt
            && self.request == other.request
            && self.deployment_identity == other.deployment_identity
            && self.binding_identity == other.binding_identity
            && self.binding_generation == other.binding_generation
            && self.history_head_identity == other.history_head_identity
            && self.effective_principal == other.effective_principal
            && self.authorized_scope == other.authorized_scope
            && self.scope_policy_version == other.scope_policy_version
            && self.capability_policy_version == other.capability_policy_version
            && self.audit_policy_version == other.audit_policy_version
            && self.authorization == other.authorization
            && self.manifest_identity == other.manifest_identity
            && self.manifest_digest == other.manifest_digest
            && self.read_cut_epoch_ms == other.read_cut_epoch_ms
    }
    /// Revalidates both the admission's original authorization and the
    /// directly resolved current policy evidence held by the Product Edge
    /// custody cut. Historical mode deliberately leaves both absent.
    pub fn authorizes_first_mutation_at(&self, read_cut_epoch_ms: u64) -> bool {
        let (Some(original), Some(policy)) = (
            &self.original_current_authorization_evidence,
            &self.current_policy_evidence,
        ) else {
            return false;
        };
        original.is_current_at(read_cut_epoch_ms)
            && original.scope() == policy.authorization.scope()
            && original.request_proof_digest() == policy.authorization.request_proof_digest()
            && original.operation_manifests() == policy.authorization.operation_manifests()
            && !policy.binding_identity.is_empty()
            && policy.binding_generation >= self.binding_generation
            && policy.manifest_identity == self.manifest_identity
            && policy.manifest_digest == self.manifest_digest
            && policy.authorization.is_current_at(read_cut_epoch_ms)
            && read_cut_epoch_ms >= policy.binding_valid_from_epoch_ms
            && read_cut_epoch_ms < policy.binding_valid_through_epoch_ms
            && read_cut_epoch_ms >= policy.manifest_effective_from_epoch_ms
            && read_cut_epoch_ms < policy.manifest_valid_through_epoch_ms
    }
    pub fn manifest_identity(&self) -> &str {
        &self.manifest_identity
    }
    pub fn manifest_digest(&self) -> &str {
        &self.manifest_digest
    }
    pub fn read_cut_epoch_ms(&self) -> u64 {
        self.read_cut_epoch_ms
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DownstreamAdmissionModeV1 {
    FirstMutation { read_cut_epoch_ms: u64 },
    Historical,
}

#[derive(Debug, Error)]
pub enum ProductEdgeError {
    #[error("invalid Product Edge proposal: {0}")]
    InvalidProposal(&'static str),
    #[error("Product Edge identity conflicts with committed meaning")]
    ConflictingReplay,
    #[error("Product Edge authority unavailable")]
    Unavailable,
    #[error("Product Edge storage unavailable: {0}")]
    Storage(String),
}

pub(crate) fn canonical_digest<T: Serialize>(
    domain: &str,
    value: &T,
) -> Result<String, ProductEdgeError> {
    let bytes = serde_json::to_vec(value).map_err(|e| ProductEdgeError::Storage(e.to_string()))?;
    let mut hash = Sha256::new();
    hash.update((domain.len() as u64).to_be_bytes());
    hash.update(domain.as_bytes());
    hash.update((bytes.len() as u64).to_be_bytes());
    hash.update(bytes);
    Ok(format!("sha256:{:x}", hash.finalize()))
}

pub(crate) fn identity(domain: &str, parts: &[&str]) -> String {
    let mut hash = Sha256::new();
    hash.update((domain.len() as u64).to_be_bytes());
    hash.update(domain.as_bytes());
    for part in parts {
        hash.update((part.len() as u64).to_be_bytes());
        hash.update(part.as_bytes());
    }
    format!("{}-{:x}", domain.replace('.', "-"), hash.finalize())
}

fn sorted_unique(values: &[String]) -> bool {
    values.windows(2).all(|pair| pair[0] < pair[1])
}
