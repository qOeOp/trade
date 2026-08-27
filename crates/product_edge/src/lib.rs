//! Sealed Product Edge deployment and request-admission facts.

mod invocation;
mod postgres;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;
use vibe_operator_authorization::{
    OperatorAuthorizationLocatorV1, OperatorAuthorizationReadbackV1,
    PortfolioResourceGrantLocatorV1, PortfolioResourceV1, ProductEdgeManifestBindingV1,
    UntrustedCanonicalAuthorizationEvidenceV1, UntrustedCanonicalPortfolioResourceGrantEvidenceV1,
};

pub use invocation::{
    ProductEdgeInvocationClaimDispositionV1, ProductEdgeInvocationClaimReadbackV1,
    ProductEdgeInvocationNextLegalActionV1, ProductEdgeInvocationStartDispositionV1,
    ProductEdgeInvocationStartReadbackV1, ProductEdgeInvocationStateV1,
};
pub use postgres::{
    ProductEdgePostgresOwnerV1, resolve_admission_for_downstream_in_transaction,
    resolve_portfolio_read_policy_in_transaction,
    resolve_source_invocation_claim_for_downstream_in_transaction,
    resolve_source_invocation_started_for_downstream_in_transaction,
};
pub use vibe_product_edge_contracts::ProductEdgeAdmissionLocatorV1;

pub const PRODUCT_EDGE_SCHEMA_V1: u32 = 1;
pub const PORTFOLIO_READ_POLICY_SCHEMA_V1: u32 = 1;
pub const PORTFOLIO_READ_POLICY_OPERATION_V1: &str = "portfolio.read-policy.resolve.v1";
pub const PORTFOLIO_READ_POLICY_OPERATION_SCHEMA_V1: &str = "product-edge-portfolio-read-policy-v1";
pub const PORTFOLIO_READ_POLICY_TARGET_OWNER_V1: &str = "PORTFOLIO";
pub const PORTFOLIO_READ_ONLY_EFFECT_POLICY_V1: &str = "READ_ONLY_NO_WRITES_NO_EFFECTS";
/// Canonical ordered effects requested by an R&D artifact-build admission.
///
/// This is vocabulary, not authority: Product Edge and every downstream
/// mutation boundary still verify the sealed admission independently.
pub const ARTIFACT_BUILD_REQUIRED_EFFECTS_V1: [&str; 2] = [
    "R_AND_D_ARTIFACT_BUILD_MUTATION_V1",
    "R_AND_D_PROVIDER_INVOCATION_V1",
];
pub const SOURCE_INTAKE_OPERATION_V1: &str =
    "source_intake.openalex_work_by_doi.submit_or_resolve.v1";
pub const SOURCE_INTAKE_OPERATION_SCHEMA_V1: &str =
    "rd-source-intake-openalex-work-by-doi-request-v1";
pub const SOURCE_INTAKE_TARGET_OWNER_V1: &str = "R_AND_D";
pub const SOURCE_INTAKE_REQUIRED_EFFECTS_V1: [&str; 2] = [
    "R_AND_D_SOURCE_ACQUISITION_MUTATION_V1",
    "R_AND_D_SOURCE_PROVIDER_INVOCATION_V1",
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
    manifest_proposal: AgentOperationManifestProposalV1,
    #[serde(skip)]
    original_current_authorization_evidence: Option<UntrustedCanonicalAuthorizationEvidenceV1>,
    #[serde(skip)]
    current_policy_evidence: Option<ProductEdgeCurrentPolicyEvidenceV1>,
}

/// Immutable authority lineage shared by historical and current admission
/// observations. The observation cut and current evidence remain outside this
/// identity and must be checked separately at the consuming effect boundary.
#[derive(Debug, PartialEq, Eq, Serialize)]
pub struct ProductEdgeAdmissionLineageV1<'a> {
    locator: &'a ProductEdgeAdmissionLocatorV1,
    receipt: &'a ProductEdgeAdmissionReceiptV1,
    request: &'a ProductEdgeAdmissionRequestV1,
    deployment_identity: &'a str,
    binding_identity: &'a str,
    binding_generation: u64,
    history_head_identity: &'a str,
    effective_principal: &'a str,
    authorized_scope: &'a [String],
    scope_policy_version: &'a str,
    capability_policy_version: &'a str,
    audit_policy_version: &'a str,
    authorization: &'a UntrustedCanonicalAuthorizationEvidenceV1,
    manifest_identity: &'a str,
    manifest_digest: &'a str,
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProductEdgeSourceInvocationClaimRequestV1 {
    pub admission: ProductEdgeAdmissionLocatorV1,
    pub attempt_identity: String,
    pub binding_identity: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProductEdgeSourceInvocationStartRequestV1 {
    pub request_identity: String,
    pub admission_identity: String,
    pub attempt_identity: String,
    pub claim_identity: String,
    pub reservation_identity: String,
    pub reservation_digest: String,
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
    pub fn immutable_lineage(&self) -> ProductEdgeAdmissionLineageV1<'_> {
        ProductEdgeAdmissionLineageV1 {
            locator: &self.locator,
            receipt: &self.receipt,
            request: &self.request,
            deployment_identity: &self.deployment_identity,
            binding_identity: &self.binding_identity,
            binding_generation: self.binding_generation,
            history_head_identity: &self.history_head_identity,
            effective_principal: &self.effective_principal,
            authorized_scope: &self.authorized_scope,
            scope_policy_version: &self.scope_policy_version,
            capability_policy_version: &self.capability_policy_version,
            audit_policy_version: &self.audit_policy_version,
            authorization: &self.authorization,
            manifest_identity: &self.manifest_identity,
            manifest_digest: &self.manifest_digest,
        }
    }
    pub fn has_same_admission_lineage(&self, other: &Self) -> bool {
        self.immutable_lineage() == other.immutable_lineage()
    }
    /// Revalidates both the admission's original authorization and the
    /// directly resolved current policy evidence held by the Product Edge
    /// custody cut. Historical mode deliberately leaves both absent.
    pub fn authorizes_first_mutation_at(&self, read_cut_epoch_ms: u64) -> bool {
        self.has_current_policy_at(read_cut_epoch_ms)
    }

    fn has_current_policy_at(&self, read_cut_epoch_ms: u64) -> bool {
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

    fn has_exact_portfolio_read_manifest(&self) -> bool {
        self.manifest_proposal.operation == PORTFOLIO_READ_POLICY_OPERATION_V1
            && self.manifest_proposal.operation_schema == PORTFOLIO_READ_POLICY_OPERATION_SCHEMA_V1
            && self.manifest_proposal.target_owner == PORTFOLIO_READ_POLICY_TARGET_OWNER_V1
            && self.manifest_proposal.allowed_effects
                == [PORTFOLIO_READ_ONLY_EFFECT_POLICY_V1.to_string()]
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PortfolioReadObjectClassV1 {
    Account,
    Exposure,
    GrossCapacityView,
    Performance,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PortfolioReadEffectPolicyV1 {
    ReadOnlyNoWritesNoEffects,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PortfolioReadPolicyPayloadV1 {
    pub schema_version: u32,
    pub resource: PortfolioResourceV1,
    pub grant: PortfolioResourceGrantLocatorV1,
    pub manifest: ProductEdgeManifestBindingV1,
    pub allowed_object_classes: Vec<PortfolioReadObjectClassV1>,
    pub effect_policy: PortfolioReadEffectPolicyV1,
}

impl PortfolioReadPolicyPayloadV1 {
    pub fn validate(&self) -> Result<(), ProductEdgeError> {
        if self.schema_version != PORTFOLIO_READ_POLICY_SCHEMA_V1
            || self.resource.validate().is_err()
            || self.grant.grant_identity.trim().is_empty()
            || self.grant.issuance_receipt_identity.trim().is_empty()
            || self.manifest.manifest_locator.trim().is_empty()
            || !is_sha256_digest(&self.manifest.manifest_digest)
            || self.allowed_object_classes.is_empty()
            || !sorted_unique(&self.allowed_object_classes)
        {
            return Err(ProductEdgeError::InvalidProposal(
                "portfolio read policy payload",
            ));
        }
        Ok(())
    }

    pub fn policy_digest(&self) -> Result<String, ProductEdgeError> {
        self.validate()?;
        canonical_digest("product-edge.portfolio-read-policy.v1", self)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PortfolioReadPolicyRequestV1 {
    pub admission: ProductEdgeAdmissionLocatorV1,
    pub grant: PortfolioResourceGrantLocatorV1,
    pub expected_request_semantic_digest: String,
    pub expected_policy_digest: String,
}

impl PortfolioReadPolicyRequestV1 {
    pub fn validate(&self) -> Result<(), ProductEdgeError> {
        if self.admission.request_identity.trim().is_empty()
            || self.admission.admission_identity.trim().is_empty()
            || self.admission.admission_digest.trim().is_empty()
            || self.grant.grant_identity.trim().is_empty()
            || self.grant.issuance_receipt_identity.trim().is_empty()
            || !is_sha256_digest(&self.expected_request_semantic_digest)
            || !is_sha256_digest(&self.expected_policy_digest)
        {
            return Err(ProductEdgeError::InvalidProposal(
                "portfolio read policy request",
            ));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PortfolioSourceOwnerResolveResultV1 {
    SourceOwnerResolveUnavailable,
}

/// Product Edge-sealed Portfolio read-policy custody.
///
/// It proves only the policy and OA cut used by a later Portfolio Owner
/// resolve. It never contains Portfolio facts or an AVAILABLE view.
///
/// ```compile_fail
/// use vibe_product_edge::PortfolioReadPolicyCustodyV1;
/// let _: PortfolioReadPolicyCustodyV1 = serde_json::from_str("{}").unwrap();
/// ```
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PortfolioReadPolicyCustodyV1 {
    custody_identity: String,
    custody_digest: String,
    admission: ProductEdgeAdmissionLocatorV1,
    request_semantic_digest: String,
    policy_digest: String,
    resource: PortfolioResourceV1,
    grant: PortfolioResourceGrantLocatorV1,
    manifest: ProductEdgeManifestBindingV1,
    allowed_object_classes: Vec<PortfolioReadObjectClassV1>,
    effect_policy: PortfolioReadEffectPolicyV1,
    authorization_policy_cut: String,
    final_cut_epoch_ms: u64,
    source_owner_result: PortfolioSourceOwnerResolveResultV1,
    #[serde(skip)]
    admission_evidence: ProductEdgeAdmissionReadbackV1,
    #[serde(skip)]
    grant_evidence: UntrustedCanonicalPortfolioResourceGrantEvidenceV1,
}

impl PortfolioReadPolicyCustodyV1 {
    pub fn custody_identity(&self) -> &str {
        &self.custody_identity
    }
    pub fn custody_digest(&self) -> &str {
        &self.custody_digest
    }
    pub fn admission(&self) -> &ProductEdgeAdmissionLocatorV1 {
        &self.admission
    }
    pub fn request_semantic_digest(&self) -> &str {
        &self.request_semantic_digest
    }
    pub fn policy_digest(&self) -> &str {
        &self.policy_digest
    }
    pub fn resource(&self) -> &PortfolioResourceV1 {
        &self.resource
    }
    pub fn grant(&self) -> &PortfolioResourceGrantLocatorV1 {
        &self.grant
    }
    pub fn manifest(&self) -> &ProductEdgeManifestBindingV1 {
        &self.manifest
    }
    pub fn allowed_object_classes(&self) -> &[PortfolioReadObjectClassV1] {
        &self.allowed_object_classes
    }
    pub fn effect_policy(&self) -> PortfolioReadEffectPolicyV1 {
        self.effect_policy
    }
    pub fn authorization_policy_cut(&self) -> &str {
        &self.authorization_policy_cut
    }
    pub fn final_cut_epoch_ms(&self) -> u64 {
        self.final_cut_epoch_ms
    }
    pub fn source_owner_result(&self) -> PortfolioSourceOwnerResolveResultV1 {
        self.source_owner_result
    }
    pub fn is_current_at(&self, final_cut_epoch_ms: u64) -> bool {
        self.final_cut_epoch_ms == final_cut_epoch_ms
            && self
                .admission_evidence
                .has_current_policy_at(final_cut_epoch_ms)
            && self.grant_evidence.is_current_at(final_cut_epoch_ms)
            && self.grant_evidence.frontier_identity() == self.authorization_policy_cut
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PortfolioReadPolicyUnavailableReasonV1 {
    InvalidRequest,
    OwnerUnavailable,
    ProductEdgeCustodyMismatch,
    OperatorAuthorizationMismatch,
    PolicyNotCurrent,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "state", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PortfolioReadPolicyResolutionV1 {
    Sealed {
        custody: Box<PortfolioReadPolicyCustodyV1>,
    },
    Unavailable {
        reason: PortfolioReadPolicyUnavailableReasonV1,
    },
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

fn sorted_unique<T: Ord>(values: &[T]) -> bool {
    values.windows(2).all(|pair| pair[0] < pair[1])
}

fn is_sha256_digest(value: &str) -> bool {
    value
        .strip_prefix("sha256:")
        .is_some_and(|hex| hex.len() == 64 && hex.bytes().all(|byte| byte.is_ascii_hexdigit()))
}

#[cfg(test)]
mod portfolio_read_policy_tests {
    use super::*;
    use rstest::rstest;
    use vibe_operator_authorization::{PORTFOLIO_OWNER_AUDIENCE_V1, PORTFOLIO_VIEW_PERMISSION_V1};

    fn payload() -> PortfolioReadPolicyPayloadV1 {
        PortfolioReadPolicyPayloadV1 {
            schema_version: PORTFOLIO_READ_POLICY_SCHEMA_V1,
            resource: PortfolioResourceV1 {
                principal: "principal-1".into(),
                audience: PORTFOLIO_OWNER_AUDIENCE_V1.into(),
                permission: PORTFOLIO_VIEW_PERMISSION_V1.into(),
                account_identity: "account-1".into(),
                execution_scope_identity: "execution-scope-1".into(),
                mode: vibe_operator_authorization::PortfolioResourceModeV1::Paper,
            },
            grant: PortfolioResourceGrantLocatorV1 {
                grant_identity: "grant-1".into(),
                issuance_receipt_identity: "grant-receipt-1".into(),
            },
            manifest: ProductEdgeManifestBindingV1 {
                manifest_locator: "manifest-1".into(),
                manifest_digest: format!("sha256:{}", "a".repeat(64)),
            },
            allowed_object_classes: vec![
                PortfolioReadObjectClassV1::Account,
                PortfolioReadObjectClassV1::Exposure,
                PortfolioReadObjectClassV1::GrossCapacityView,
                PortfolioReadObjectClassV1::Performance,
            ],
            effect_policy: PortfolioReadEffectPolicyV1::ReadOnlyNoWritesNoEffects,
        }
    }

    #[rstest]
    fn portfolio_read_policy_digest_is_canonical_and_binds_every_coordinate() {
        type PayloadMutation = Box<dyn Fn(&mut PortfolioReadPolicyPayloadV1)>;

        let original = payload();
        let digest = original.policy_digest().unwrap();
        assert_eq!(original.policy_digest().unwrap(), digest);

        let mutations: Vec<PayloadMutation> = vec![
            Box::new(|value| value.resource.principal.push_str("-other")),
            Box::new(|value| value.resource.audience.push_str("-other")),
            Box::new(|value| value.resource.permission.push_str("-other")),
            Box::new(|value| value.resource.account_identity.push_str("-other")),
            Box::new(|value| value.resource.execution_scope_identity.push_str("-other")),
            Box::new(|value| {
                value.resource.mode = vibe_operator_authorization::PortfolioResourceModeV1::Live;
            }),
            Box::new(|value| value.grant.grant_identity.push_str("-other")),
            Box::new(|value| value.grant.issuance_receipt_identity.push_str("-other")),
            Box::new(|value| value.manifest.manifest_locator.push_str("-other")),
            Box::new(|value| value.manifest.manifest_digest.replace_range(7..8, "b")),
            Box::new(|value| {
                value.allowed_object_classes.remove(0);
            }),
        ];

        for mutate in mutations {
            let mut changed = original.clone();
            mutate(&mut changed);

            match changed.policy_digest() {
                Ok(changed_digest) => assert_ne!(changed_digest, digest),
                Err(_) => assert!(changed.validate().is_err()),
            }
        }
    }

    #[rstest]
    fn portfolio_read_policy_is_closed_sorted_and_has_no_effect_variant() {
        let mut invalid = payload();
        invalid.allowed_object_classes.swap(0, 1);
        assert!(invalid.validate().is_err());

        let mut duplicate = payload();
        duplicate
            .allowed_object_classes
            .insert(1, PortfolioReadObjectClassV1::Account);
        assert!(duplicate.validate().is_err());
        assert!(serde_json::from_str::<PortfolioReadEffectPolicyV1>("\"READ_WRITE\"").is_err());
        assert_eq!(
            serde_json::to_string(&PortfolioReadEffectPolicyV1::ReadOnlyNoWritesNoEffects).unwrap(),
            "\"READ_ONLY_NO_WRITES_NO_EFFECTS\""
        );
    }

    #[rstest]
    fn portfolio_read_request_rejects_missing_owner_locators() {
        let request = PortfolioReadPolicyRequestV1 {
            admission: ProductEdgeAdmissionLocatorV1 {
                request_identity: "request-1".into(),
                admission_identity: "admission-1".into(),
                admission_digest: format!("sha256:{}", "b".repeat(64)),
            },
            grant: payload().grant,
            expected_request_semantic_digest: format!("sha256:{}", "c".repeat(64)),
            expected_policy_digest: format!("sha256:{}", "d".repeat(64)),
        };
        assert!(request.validate().is_ok());
        for field in 0..7 {
            let mut changed = request.clone();
            match field {
                0 => changed.admission.request_identity.clear(),
                1 => changed.admission.admission_identity.clear(),
                2 => changed.admission.admission_digest.clear(),
                3 => changed.grant.grant_identity.clear(),
                4 => changed.grant.issuance_receipt_identity.clear(),
                5 => changed.expected_request_semantic_digest.clear(),
                6 => changed.expected_policy_digest.clear(),
                _ => unreachable!(),
            }
            assert!(changed.validate().is_err());
        }
    }
}
