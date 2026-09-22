//! Sealed Product Edge deployment and request-admission facts.

mod invocation;
mod postgres;

use std::fmt::Display;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;
use vibe_operator_authorization::{
    ExpiredManifestRecoveryEpochV1, ManifestSemanticKeyV1, OperationManifestBindingV1,
    OperatorAuthorizationLocatorV1, OperatorAuthorizationReadbackV1,
    OperatorAuthorizationUnavailableV1, PortfolioResourceGrantLocatorV1, PortfolioResourceV1,
    ProductEdgeManifestBindingV1, UntrustedCanonicalAuthorizationEvidenceV1,
    UntrustedCanonicalPortfolioResourceGrantEvidenceV1,
};
use vibe_product_edge_claim_custody::ProductEdgeClaimCustodyUnavailableV1;

pub use invocation::{
    ProductEdgeInvocationClaimDispositionV1, ProductEdgeInvocationClaimReadbackV1,
    ProductEdgeInvocationNextLegalActionV1, ProductEdgeInvocationStartDispositionV1,
    ProductEdgeInvocationStartReadbackV1, ProductEdgeInvocationStateV1,
};
pub use postgres::{
    ProductEdgePostgresAdmissionPointReadPortV1, ProductEdgePostgresAdmissionReadPortV1,
    ProductEdgePostgresOwnerV1, resolve_admission_for_downstream_in_transaction,
    resolve_historical_admission_snapshot_for_downstream_in_transaction,
    resolve_portfolio_read_policy_in_transaction,
    resolve_source_invocation_claim_for_downstream_in_transaction,
    resolve_source_invocation_started_for_downstream_in_transaction,
};
pub use vibe_product_edge_contracts::{
    PRODUCT_EDGE_ADMISSION_EVENT_STREAM_V1, ProductEdgeAdmissionEventCursorV1,
    ProductEdgeAdmissionEventLocatorV1, ProductEdgeAdmissionLocatorV1,
};

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
pub const ARTIFACT_BUILD_OPERATION_V1: &str = "artifact_build.submit_or_resolve.v1";
pub const ARTIFACT_BUILD_OPERATION_SCHEMA_V1: &str = "rd-artifact-build-request-v1";
pub const SOURCE_INTAKE_OPERATION_V1: &str =
    "source_intake.openalex_work_by_doi.submit_or_resolve.v1";
pub const SOURCE_INTAKE_OPERATION_SCHEMA_V1: &str =
    "rd-source-intake-openalex-work-by-doi-request-v1";
pub const SOURCE_INTAKE_TARGET_OWNER_V1: &str = "R_AND_D";
pub const SOURCE_INTAKE_REQUIRED_EFFECTS_V1: [&str; 2] = [
    "R_AND_D_SOURCE_ACQUISITION_MUTATION_V1",
    "R_AND_D_SOURCE_PROVIDER_INVOCATION_V1",
];
pub const LIFECYCLE_REQUEST_OPERATION_V1: &str =
    "strategy_governance.lifecycle_request.submit_or_resolve.v1";
pub const LIFECYCLE_REQUEST_OPERATION_SCHEMA_V1: &str = "lifecycle-request-v1";
pub const LIFECYCLE_REQUEST_TARGET_OWNER_V1: &str = "STRATEGY_GOVERNANCE";

/// The seven canonical Strategy Governance lifecycle actions, in the order the
/// Operator Authorization Issuer spells them.
pub const LIFECYCLE_ACTIONS_V1: [&str; 7] = [
    "DE_RISK",
    "INITIAL_ACTIVATION",
    "PAUSE",
    "PROMOTION",
    "RECOVERY",
    "REDUCTION",
    "RETIREMENT",
];

/// Canonical identity of the one Product Edge admission gateway.
///
/// The gateway was first named after Windmill because Windmill was the only Product Edge surface
/// when it was sealed. It never denoted Windmill the tool: the first-party Dashboard shares the
/// same gateway and had to declare the old name to be admitted at all. This is the name that
/// describes what it is.
pub const PRODUCT_EDGE_GATEWAY_V1: &str = "TRADE_PRODUCT_EDGE";

/// The gateway identity every admission sealed before the rename carries.
///
/// Admissions are content addressed, so a stored payload keeps the bytes it was sealed with
/// forever. Both names are admitted, and nothing rewrites a sealed record.
pub const LEGACY_WINDMILL_GATEWAY_V1: &str = "WINDMILL_PRODUCT_EDGE";

/// Whether a declared gateway identity names this Product Edge gateway.
///
/// Fail-closed on anything else: the gateway is one authority, not an open vocabulary.
#[must_use]
pub fn is_product_edge_gateway_v1(declared: &str) -> bool {
    declared == PRODUCT_EDGE_GATEWAY_V1 || declared == LEGACY_WINDMILL_GATEWAY_V1
}

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

    pub fn semantic_key(&self) -> ManifestSemanticKeyV1 {
        ManifestSemanticKeyV1 {
            operation: self.operation.clone(),
            operation_schema: self.operation_schema.clone(),
            target_owner: self.target_owner.clone(),
        }
    }

    pub fn binding(&self) -> Result<OperationManifestBindingV1, ProductEdgeError> {
        Ok(OperationManifestBindingV1 {
            manifest_identity: self.manifest_identity()?,
            manifest_digest: self.manifest_digest()?,
        })
    }
}

/// The manifests one deployment binding admits, in their canonical order.
///
/// A binding is content addressed over this set, and every stored copy and
/// Operator Authorization issuance orders it by `manifest_identity`. That
/// identity is a digest over the manifest, including its validity window, so
/// nobody can produce the order by hand. The constructor therefore owns it:
/// it validates every manifest, sorts by identity, and refuses an empty set,
/// a duplicate identity, or two manifests that name the same operation
/// semantic key (which no admission could ever select unambiguously). A set
/// deserialized from JSON goes through the same constructor, so operators
/// list manifests in any order and stored bytes stay canonical.
///
/// Serialization is transparent: the wire and storage shape is the plain
/// array it always was.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(transparent)]
pub struct AgentOperationManifestSetV1(Vec<AgentOperationManifestProposalV1>);

impl AgentOperationManifestSetV1 {
    pub fn new(manifests: Vec<AgentOperationManifestProposalV1>) -> Result<Self, ProductEdgeError> {
        if manifests.is_empty() {
            return Err(ProductEdgeError::InvalidProposal("manifest set"));
        }
        let mut keyed = manifests
            .into_iter()
            .map(|manifest| {
                manifest.validate()?;
                Ok((manifest.manifest_identity()?, manifest))
            })
            .collect::<Result<Vec<_>, ProductEdgeError>>()?;
        keyed.sort_by(|left, right| left.0.cmp(&right.0));

        if keyed.windows(2).any(|pair| pair[0].0 == pair[1].0) {
            return Err(ProductEdgeError::InvalidProposal("manifest ordering"));
        }
        let mut semantic_keys = keyed
            .iter()
            .map(|(_, manifest)| manifest.semantic_key())
            .collect::<Vec<_>>();
        semantic_keys.sort();
        if semantic_keys.windows(2).any(|pair| pair[0] == pair[1]) {
            return Err(ProductEdgeError::InvalidProposal(
                "manifest operation ambiguity",
            ));
        }
        Ok(Self(
            keyed.into_iter().map(|(_, manifest)| manifest).collect(),
        ))
    }

    pub fn iter(&self) -> std::slice::Iter<'_, AgentOperationManifestProposalV1> {
        self.0.iter()
    }

    pub fn as_slice(&self) -> &[AgentOperationManifestProposalV1] {
        &self.0
    }

    /// Canonically ordered identities, the shape a stored binding records.
    pub fn identities(&self) -> Result<Vec<String>, ProductEdgeError> {
        self.0
            .iter()
            .map(AgentOperationManifestProposalV1::manifest_identity)
            .collect()
    }

    /// Canonically ordered bindings, the shape an Operator Authorization
    /// issuance and a recovery epoch carry.
    pub fn bindings(&self) -> Result<Vec<OperationManifestBindingV1>, ProductEdgeError> {
        self.0
            .iter()
            .map(AgentOperationManifestProposalV1::binding)
            .collect()
    }
}

impl std::ops::Deref for AgentOperationManifestSetV1 {
    type Target = [AgentOperationManifestProposalV1];

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl<'a> IntoIterator for &'a AgentOperationManifestSetV1 {
    type Item = &'a AgentOperationManifestProposalV1;
    type IntoIter = std::slice::Iter<'a, AgentOperationManifestProposalV1>;

    fn into_iter(self) -> Self::IntoIter {
        self.0.iter()
    }
}

impl<'de> Deserialize<'de> for AgentOperationManifestSetV1 {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let manifests = Vec::<AgentOperationManifestProposalV1>::deserialize(deserializer)?;
        Self::new(manifests).map_err(serde::de::Error::custom)
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
    pub manifests: AgentOperationManifestSetV1,
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
        {
            return Err(ProductEdgeError::InvalidProposal("deployment bootstrap"));
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
    pub manifests: AgentOperationManifestSetV1,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProductEdgeExpiredManifestRecoveryProposalV1 {
    pub recovery_epoch: ExpiredManifestRecoveryEpochV1,
    pub successor: ProductEdgeSuccessorProposalV1,
}

impl ProductEdgeExpiredManifestRecoveryProposalV1 {
    pub fn validate(&self) -> Result<(), ProductEdgeError> {
        self.recovery_epoch
            .validate()
            .map_err(|_| ProductEdgeError::InvalidProposal("expired manifest recovery epoch"))?;
        self.successor.validate()?;
        if self.successor.manifests.bindings()?
            != self.recovery_epoch.successor_operation_manifests()
        {
            return Err(ProductEdgeError::InvalidProposal(
                "expired manifest recovery delta",
            ));
        }
        Ok(())
    }

    pub fn semantic_digest(&self) -> Result<String, ProductEdgeError> {
        self.validate()?;
        canonical_digest("product-edge.expired-manifest-recovery-proposal.v1", self)
    }
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
        {
            return Err(ProductEdgeError::InvalidProposal("deployment successor"));
        }
        Ok(())
    }

    pub fn semantic_digest(&self) -> Result<String, ProductEdgeError> {
        canonical_digest("product-edge.successor-proposal.v1", self)
    }
}

/// Which admission entry a request must use.
///
/// Product Edge exposes one generic admission and two typed ones. The typed
/// entries exist because their operations carry a payload Product Edge must
/// read before it admits anything: an artifact build names the Research
/// Intent whose current custody the admission binds, and a Source Intake
/// request names the DOI and interpretation the sealed provider claim later
/// consumes. The generic entry never reads a payload, so letting it admit one
/// of those operations would seal an admission the typed contract never
/// checked. The route is derived from the operation name alone and every
/// entry refuses a request whose route is not its own.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProductEdgeAdmissionRouteV1 {
    /// `ProductEdgePostgresOwnerV1::admit_request`.
    Generic,
    /// `ProductEdgePostgresOwnerV1::admit_artifact_build_request`.
    ArtifactBuild,
    /// `ProductEdgePostgresOwnerV1::admit_source_intake_request`.
    SourceIntake,
    /// `ProductEdgePostgresOwnerV1::admit_lifecycle_request`.
    LifecycleRequest,
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

    /// The admission entry this request's operation belongs to.
    pub fn admission_route(&self) -> ProductEdgeAdmissionRouteV1 {
        if self.operation == ARTIFACT_BUILD_OPERATION_V1 {
            ProductEdgeAdmissionRouteV1::ArtifactBuild
        } else if self.operation == SOURCE_INTAKE_OPERATION_V1 {
            ProductEdgeAdmissionRouteV1::SourceIntake
        } else if self.operation == LIFECYCLE_REQUEST_OPERATION_V1 {
            ProductEdgeAdmissionRouteV1::LifecycleRequest
        } else {
            ProductEdgeAdmissionRouteV1::Generic
        }
    }

    /// Fails closed unless this request belongs to `route`.
    pub fn require_admission_route(
        &self,
        route: ProductEdgeAdmissionRouteV1,
    ) -> Result<(), ProductEdgeError> {
        if self.admission_route() != route {
            return Err(ProductEdgeError::InvalidProposal("admission entry"));
        }
        Ok(())
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
    canonical_storage_bytes: Vec<u8>,
    #[serde(skip)]
    canonical_storage_digest: String,
    #[serde(skip)]
    manifest_proposal: AgentOperationManifestProposalV1,
    #[serde(skip)]
    original_current_authorization_evidence: Option<UntrustedCanonicalAuthorizationEvidenceV1>,
    #[serde(skip)]
    current_policy_evidence: Option<ProductEdgeCurrentPolicyEvidenceV1>,
}

/// Sealed read-only observation of one committed admission event.
///
/// This value carries no request payload, principal, authorization, or
/// business-terminal disposition. Callers can serialize Owner output but
/// cannot deserialize a positive observation.
///
/// ```compile_fail
/// use vibe_product_edge::ProductEdgeAdmissionObservationV1;
/// let _: ProductEdgeAdmissionObservationV1 = serde_json::from_str("{}").unwrap();
/// ```
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ProductEdgeAdmissionObservationV1 {
    schema_version: u32,
    observation_identity: String,
    observation_digest: String,
    event: ProductEdgeAdmissionEventLocatorV1,
    receipt_identity: String,
    committed_at_epoch_ms: u64,
}

impl ProductEdgeAdmissionObservationV1 {
    pub fn observation_identity(&self) -> &str {
        &self.observation_identity
    }

    pub fn observation_digest(&self) -> &str {
        &self.observation_digest
    }

    pub fn event(&self) -> &ProductEdgeAdmissionEventLocatorV1 {
        &self.event
    }

    pub fn receipt_identity(&self) -> &str {
        &self.receipt_identity
    }

    pub fn committed_at_epoch_ms(&self) -> u64 {
        self.committed_at_epoch_ms
    }

    pub fn next_cursor(&self) -> ProductEdgeAdmissionEventCursorV1 {
        ProductEdgeAdmissionEventCursorV1::after_owner_observation(
            &self.event,
            self.observation_identity.clone(),
            self.observation_digest.clone(),
        )
    }

    pub(crate) fn from_owner_fact(
        observation_identity: String,
        observation_digest: String,
        event: ProductEdgeAdmissionEventLocatorV1,
        receipt_identity: String,
        committed_at_epoch_ms: u64,
    ) -> Self {
        Self {
            schema_version: PRODUCT_EDGE_SCHEMA_V1,
            observation_identity,
            observation_digest,
            event,
            receipt_identity,
            committed_at_epoch_ms,
        }
    }
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
    /// Exact canonical bytes retained by Product Edge when this admission was committed.
    pub fn canonical_storage_bytes(&self) -> &[u8] {
        &self.canonical_storage_bytes
    }

    /// Domain-separated digest over [`Self::canonical_storage_bytes`].
    pub fn canonical_storage_digest(&self) -> &str {
        &self.canonical_storage_digest
    }

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
    #[error("Product Edge authority unavailable: {0}")]
    Unavailable(ProductEdgeUnavailableV1),
    #[error("Product Edge storage unavailable: {0}")]
    Storage(String),
}

impl ProductEdgeError {
    /// An `Unavailable` refusal that names its reason but no particular identity.
    #[must_use]
    pub fn unavailable(reason: ProductEdgeUnavailableReasonV1) -> Self {
        Self::Unavailable(ProductEdgeUnavailableV1::new(reason))
    }

    /// An `Unavailable` refusal about one exact identity.
    #[must_use]
    pub fn unavailable_for(
        reason: ProductEdgeUnavailableReasonV1,
        kind: ProductEdgeSubjectKindV1,
        identity: impl Into<String>,
    ) -> Self {
        Self::Unavailable(ProductEdgeUnavailableV1::about(reason, kind, identity))
    }
}

/// Diagnostic detail behind [`ProductEdgeError::Unavailable`].
///
/// It records why Product Edge would not treat custody, authority, or a
/// request as current, and which identity the refusal is about. It is
/// evidence for the operator and the log, not a disposition: every
/// `Unavailable` still reports outward as `SUBMITTED_OR_UNKNOWN` with only
/// same-attempt resolution, exactly as before, and no reason grants a caller
/// a successor, a retry, or a rejection receipt it did not already have.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProductEdgeUnavailableV1 {
    reason: ProductEdgeUnavailableReasonV1,
    subject: Option<ProductEdgeSubjectV1>,
}

impl ProductEdgeUnavailableV1 {
    #[must_use]
    pub fn new(reason: ProductEdgeUnavailableReasonV1) -> Self {
        Self {
            reason,
            subject: None,
        }
    }

    #[must_use]
    pub fn about(
        reason: ProductEdgeUnavailableReasonV1,
        kind: ProductEdgeSubjectKindV1,
        identity: impl Into<String>,
    ) -> Self {
        Self {
            reason,
            subject: Some(ProductEdgeSubjectV1 {
                kind,
                identity: identity.into(),
            }),
        }
    }

    pub fn reason(&self) -> &ProductEdgeUnavailableReasonV1 {
        &self.reason
    }

    pub fn subject(&self) -> Option<&ProductEdgeSubjectV1> {
        self.subject.as_ref()
    }
}

impl Display for ProductEdgeUnavailableV1 {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match &self.subject {
            Some(subject) => write!(f, "{} for {subject}", self.reason),
            None => write!(f, "{}", self.reason),
        }
    }
}

/// The exact identity an `Unavailable` refusal is about.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProductEdgeSubjectV1 {
    kind: ProductEdgeSubjectKindV1,
    identity: String,
}

impl ProductEdgeSubjectV1 {
    pub fn kind(&self) -> ProductEdgeSubjectKindV1 {
        self.kind
    }

    pub fn identity(&self) -> &str {
        &self.identity
    }
}

impl Display for ProductEdgeSubjectV1 {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{} {}", self.kind, self.identity)
    }
}

/// Which Product Edge identity a refusal names.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProductEdgeSubjectKindV1 {
    /// A deployment history, by `deployment_identity`.
    Deployment,
    /// A deployment binding, by `binding_identity`.
    Binding,
    /// A stored operation manifest, by `manifest_identity`.
    Manifest,
    /// An operation, by its `operation` name.
    Operation,
    /// A request admission, by `admission_identity`.
    Admission,
    /// A request, by `request_identity`.
    Request,
    /// An Operator Authorization issuance, by `authorization_identity`.
    Authorization,
    /// An Operator Authorization revocation frontier, by `frontier_identity`.
    Frontier,
    /// A provider-invocation claim, by `claim_identity`.
    Claim,
    /// A deployment supersession fence, by the superseded `binding_identity`.
    Supersession,
    /// An expired-manifest recovery epoch, by `recovery_epoch_identity`.
    RecoveryEpoch,
    /// An outbox aggregate, by `aggregate_identity`.
    Outbox,
    /// The admission event stream, by `stream_identity`.
    EventStream,
    /// An admission event, by `event_identity`.
    Event,
    /// An admission event position, by `owner_sequence`.
    OwnerSequence,
    /// R&D current-research custody, by `intent_identity`.
    ResearchIntent,
}

impl ProductEdgeSubjectKindV1 {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Deployment => "deployment",
            Self::Binding => "binding",
            Self::Manifest => "manifest",
            Self::Operation => "operation",
            Self::Admission => "admission",
            Self::Request => "request",
            Self::Authorization => "authorization",
            Self::Frontier => "frontier",
            Self::Claim => "claim",
            Self::Supersession => "supersession of binding",
            Self::RecoveryEpoch => "recovery epoch",
            Self::Outbox => "outbox aggregate",
            Self::EventStream => "event stream",
            Self::Event => "event",
            Self::OwnerSequence => "owner sequence",
            Self::ResearchIntent => "research intent",
        }
    }
}

impl Display for ProductEdgeSubjectKindV1 {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Why Product Edge refused to treat custody, authority, or a request as
/// current.
///
/// The vocabulary is closed and coarse on purpose: it distinguishes the
/// operator-visible failure classes without projecting protected detail, and
/// it never distinguishes causes the contract says Product Edge may not
/// distinguish.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProductEdgeUnavailableReasonV1 {
    /// A required row, envelope, hint, or chain member is absent.
    Missing,
    /// More than one row exists where exactly one is canonical.
    Ambiguous,
    /// Stored bytes do not decode as the canonical shape.
    Malformed,
    /// Stored custody disagrees with its own canonical recomputation: a
    /// digest, receipt, column mirror, outbox record, or schema version does
    /// not match, or a post-write readback differs from what was written.
    CustodyDrift,
    /// The pre-lock hint differs from the row read under lock: a concurrent
    /// writer changed the custody between the two reads.
    HintMismatch,
    /// The binding, supersession, or admission chain is not one well-formed
    /// lineage: generation, predecessor, head, or admitted-binding links are
    /// broken.
    LineageBroken,
    /// The current binding is fenced by a pending supersession; the
    /// zero-`ACTIVE` cutover interval admits no mutation.
    SupersessionPending,
    /// The deployment head disagrees with the current binding.
    HeadMismatch,
    /// The cut falls outside a binding, manifest, or evidence half-open
    /// validity window.
    WindowNotCurrent,
    /// The Operator Authorization is not current at the cut.
    AuthorizationNotCurrent,
    /// The Operator Authorization's principal, scope, request proof, or
    /// manifest set disagrees with the binding or admission that cites it.
    AuthorizationMismatch,
    /// The Operator Authorization's issuer, key version, or audience is not
    /// the one this Product Edge trusts.
    TrustMismatch,
    /// No unique admitted manifest matches the operation, or the manifest's
    /// digest, operation triple, or effects disagree with the request.
    ManifestMismatch,
    /// A successor or recovery proposal is not policy-equivalent to, or not
    /// bounded by, its predecessor.
    PolicyMismatch,
    /// The admission's current policy evidence does not authorize a first
    /// mutation at the cut.
    PolicyNotCurrent,
    /// The request's proof, operation, payload, effects, or locator disagree
    /// with the admission it names.
    RequestMismatch,
    /// Custody held by a downstream Owner (R&D research evidence, a source
    /// acquisition binding, or a start reservation) disagrees with Product
    /// Edge's admission.
    DownstreamCustodyMismatch,
    /// An event-stream cursor or locator does not match the stream.
    CursorMismatch,
    /// A compare-and-swap on a head or state row affected no row.
    CompareAndSwapLost,
    /// The connected role or schema topology is not the admitted one.
    TopologyNotAdmitted,
    /// The transaction is not at the isolation the locking function requires.
    ///
    /// The `SECURITY DEFINER` locks refuse outright rather than read at an isolation
    /// whose guarantees they were not written for.
    IsolationNotReadCommitted,
    /// The Operator Authorization Issuer refused for this reason.
    OperatorAuthorization(OperatorAuthorizationUnavailableV1),
    /// Operator Authorization custody failed its own proposal validation.
    OperatorAuthorizationProposal(&'static str),
    /// Provider-invocation claim custody refused for this reason.
    ClaimCustody(ProductEdgeClaimCustodyUnavailableV1),
    /// R&D Source Intake invocation custody refused.
    SourceInvocationCustody,
    /// R&D artifact invocation reservation custody refused.
    ArtifactInvocationCustody,
}

impl ProductEdgeUnavailableReasonV1 {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Missing => "MISSING",
            Self::Ambiguous => "AMBIGUOUS",
            Self::Malformed => "MALFORMED",
            Self::CustodyDrift => "CUSTODY_DRIFT",
            Self::HintMismatch => "HINT_MISMATCH",
            Self::LineageBroken => "LINEAGE_BROKEN",
            Self::SupersessionPending => "SUPERSESSION_PENDING",
            Self::HeadMismatch => "HEAD_MISMATCH",
            Self::WindowNotCurrent => "WINDOW_NOT_CURRENT",
            Self::AuthorizationNotCurrent => "AUTHORIZATION_NOT_CURRENT",
            Self::AuthorizationMismatch => "AUTHORIZATION_MISMATCH",
            Self::TrustMismatch => "TRUST_MISMATCH",
            Self::ManifestMismatch => "MANIFEST_MISMATCH",
            Self::PolicyMismatch => "POLICY_MISMATCH",
            Self::PolicyNotCurrent => "POLICY_NOT_CURRENT",
            Self::RequestMismatch => "REQUEST_MISMATCH",
            Self::DownstreamCustodyMismatch => "DOWNSTREAM_CUSTODY_MISMATCH",
            Self::CursorMismatch => "CURSOR_MISMATCH",
            Self::CompareAndSwapLost => "COMPARE_AND_SWAP_LOST",
            Self::TopologyNotAdmitted => "TOPOLOGY_NOT_ADMITTED",
            Self::IsolationNotReadCommitted => "ISOLATION_NOT_READ_COMMITTED",
            Self::OperatorAuthorization(_) => "OPERATOR_AUTHORIZATION",
            Self::OperatorAuthorizationProposal(_) => "OPERATOR_AUTHORIZATION_PROPOSAL",
            Self::ClaimCustody(_) => "CLAIM_CUSTODY",
            Self::SourceInvocationCustody => "SOURCE_INVOCATION_CUSTODY",
            Self::ArtifactInvocationCustody => "ARTIFACT_INVOCATION_CUSTODY",
        }
    }
}

impl Display for ProductEdgeUnavailableReasonV1 {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::OperatorAuthorization(inner) => write!(f, "{}: {inner}", self.as_str()),
            Self::OperatorAuthorizationProposal(what) => write!(f, "{}: {what}", self.as_str()),
            Self::ClaimCustody(inner) => write!(f, "{}: {inner}", self.as_str()),
            _ => f.write_str(self.as_str()),
        }
    }
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
    use vibe_operator_authorization::{
        ExpiredManifestRecoveryTransitionV1, PORTFOLIO_OWNER_AUDIENCE_V1,
        PORTFOLIO_VIEW_PERMISSION_V1,
    };

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

    #[rstest]
    fn expired_manifest_recovery_requires_exact_content_bound_successor_delta() {
        let old_manifest = AgentOperationManifestProposalV1 {
            operation: "research.submit.v1".into(),
            operation_schema: "research-submit-v1".into(),
            target_owner: "R_AND_D".into(),
            allowed_effects: vec!["R_AND_D_MUTATION_V1".into()],
            prohibited_effects: vec!["REAL_TRADING".into()],
            capability_policy_digest: "sha256:policy".into(),
            effective_from_epoch_ms: 10,
            valid_through_epoch_ms: 20,
        };
        let mut new_manifest = old_manifest.clone();
        new_manifest.effective_from_epoch_ms = 20;
        new_manifest.valid_through_epoch_ms = 30;
        let epoch = ExpiredManifestRecoveryEpochV1::new(vec![
            ExpiredManifestRecoveryTransitionV1::Retained {
                semantic_key: old_manifest.semantic_key(),
                predecessor_manifest: OperationManifestBindingV1 {
                    manifest_identity: old_manifest.manifest_identity().unwrap(),
                    manifest_digest: old_manifest.manifest_digest().unwrap(),
                },
                successor_manifest: OperationManifestBindingV1 {
                    manifest_identity: new_manifest.manifest_identity().unwrap(),
                    manifest_digest: new_manifest.manifest_digest().unwrap(),
                },
            },
        ])
        .unwrap();
        let proposal = ProductEdgeExpiredManifestRecoveryProposalV1 {
            recovery_epoch: epoch,
            successor: ProductEdgeSuccessorProposalV1 {
                deployment_identity: "deployment-1".into(),
                binding_identity: "binding-2".into(),
                predecessor_binding_identity: "binding-1".into(),
                expected_history_head: "binding-1".into(),
                generation: 2,
                effective_principal: "principal-1".into(),
                scope_policy_version: "scope-v1".into(),
                capability_policy_version: "capability-v1".into(),
                audit_policy_version: "audit-v1".into(),
                valid_from_epoch_ms: 20,
                valid_through_epoch_ms: 30,
                authorization: OperatorAuthorizationLocatorV1 {
                    authorization_identity: "authorization-2".into(),
                    issuance_receipt_identity: "receipt-2".into(),
                },
                manifests: AgentOperationManifestSetV1::new(vec![new_manifest.clone()]).unwrap(),
            },
        };
        assert!(proposal.validate().is_ok());
        let mut changed = proposal;
        let mut drifted = new_manifest;
        drifted.valid_through_epoch_ms = 31;
        changed.successor.manifests = AgentOperationManifestSetV1::new(vec![drifted]).unwrap();
        assert!(changed.validate().is_err());
    }

    fn manifest(operation: &str, from: u64, through: u64) -> AgentOperationManifestProposalV1 {
        AgentOperationManifestProposalV1 {
            operation: operation.into(),
            operation_schema: format!("{operation}.schema.v1"),
            target_owner: "R_AND_D".into(),
            allowed_effects: vec!["R_AND_D_MUTATION_V1".into()],
            prohibited_effects: vec!["REAL_TRADING".into()],
            capability_policy_digest: "sha256:policy".into(),
            effective_from_epoch_ms: from,
            valid_through_epoch_ms: through,
        }
    }

    #[rstest]
    fn manifest_set_owns_its_canonical_order() {
        let first = manifest("research.submit.v1", 10, 20);
        let second = manifest("artifact_build.submit_or_resolve.v1", 10, 20);
        let forward =
            AgentOperationManifestSetV1::new(vec![first.clone(), second.clone()]).unwrap();
        let reversed =
            AgentOperationManifestSetV1::new(vec![second.clone(), first.clone()]).unwrap();
        assert_eq!(forward, reversed);
        let identities = forward.identities().unwrap();
        assert!(identities.windows(2).all(|pair| pair[0] < pair[1]));
        assert_eq!(
            forward.bindings().unwrap(),
            forward
                .iter()
                .map(|manifest| manifest.binding().unwrap())
                .collect::<Vec<_>>()
        );

        let json = serde_json::to_string(&reversed).unwrap();
        assert_eq!(json, serde_json::to_string(forward.as_slice()).unwrap());
        let parsed: AgentOperationManifestSetV1 =
            serde_json::from_str(&serde_json::to_string(&[second, first.clone()]).unwrap())
                .unwrap();
        assert_eq!(parsed, forward);

        assert!(AgentOperationManifestSetV1::new(Vec::new()).is_err());
        assert!(AgentOperationManifestSetV1::new(vec![first.clone(), first.clone()]).is_err());
        let mut same_operation = first.clone();
        same_operation.valid_through_epoch_ms = 30;
        assert!(AgentOperationManifestSetV1::new(vec![first.clone(), same_operation]).is_err());
        let mut invalid = first;
        invalid.allowed_effects.clear();
        assert!(AgentOperationManifestSetV1::new(vec![invalid]).is_err());
        assert!(serde_json::from_str::<AgentOperationManifestSetV1>("[]").is_err());
    }

    #[rstest]
    fn admission_route_follows_the_operation_alone() {
        let mut request = ProductEdgeAdmissionRequestV1 {
            request_identity: "request-1".into(),
            typed_payload: serde_json::json!({}),
            operation: "research_goal.submit_or_resolve.v2".into(),
            operation_schema: "sourced-research-goal-v2".into(),
            target_owner: "R_AND_D".into(),
            requested_effects: vec![],
            request_proof_digest: "sha256:proof".into(),
            audit_correlation: "test".into(),
        };
        assert_eq!(
            request.admission_route(),
            ProductEdgeAdmissionRouteV1::Generic
        );
        request.operation = ARTIFACT_BUILD_OPERATION_V1.into();
        assert_eq!(
            request.admission_route(),
            ProductEdgeAdmissionRouteV1::ArtifactBuild
        );
        assert!(matches!(
            request.require_admission_route(ProductEdgeAdmissionRouteV1::Generic),
            Err(ProductEdgeError::InvalidProposal("admission entry"))
        ));
        request.operation = SOURCE_INTAKE_OPERATION_V1.into();
        assert_eq!(
            request.admission_route(),
            ProductEdgeAdmissionRouteV1::SourceIntake
        );
        assert!(
            request
                .require_admission_route(ProductEdgeAdmissionRouteV1::SourceIntake)
                .is_ok()
        );
        request.operation = LIFECYCLE_REQUEST_OPERATION_V1.into();
        assert_eq!(
            request.admission_route(),
            ProductEdgeAdmissionRouteV1::LifecycleRequest
        );
        assert!(
            request
                .require_admission_route(ProductEdgeAdmissionRouteV1::LifecycleRequest)
                .is_ok()
        );
        assert!(matches!(
            request.require_admission_route(ProductEdgeAdmissionRouteV1::Generic),
            Err(ProductEdgeError::InvalidProposal("admission entry"))
        ));
    }

    #[rstest]
    fn unavailable_names_its_reason_and_identity() {
        let error = ProductEdgeError::unavailable_for(
            ProductEdgeUnavailableReasonV1::HintMismatch,
            ProductEdgeSubjectKindV1::Binding,
            "binding-1",
        );
        assert_eq!(
            error.to_string(),
            "Product Edge authority unavailable: HINT_MISMATCH for binding binding-1"
        );
        let ProductEdgeError::Unavailable(detail) = error else {
            panic!("expected Unavailable");
        };
        assert_eq!(
            detail.reason(),
            &ProductEdgeUnavailableReasonV1::HintMismatch
        );
        assert_eq!(
            detail.subject().map(ProductEdgeSubjectV1::identity),
            Some("binding-1")
        );
        assert_eq!(
            ProductEdgeError::unavailable(ProductEdgeUnavailableReasonV1::Missing).to_string(),
            "Product Edge authority unavailable: MISSING"
        );
    }
}
