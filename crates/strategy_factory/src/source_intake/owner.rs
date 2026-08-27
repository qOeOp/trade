//! The single Source Intake lifecycle orchestrator.

use std::sync::Arc;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use vibe_product_edge::{
    ProductEdgeAdmissionLocatorV1, ProductEdgeAdmissionRequestV1, ProductEdgeError,
    ProductEdgePostgresOwnerV1, ProductEdgeSourceInvocationStartRequestV1,
    SOURCE_INTAKE_OPERATION_SCHEMA_V1, SOURCE_INTAKE_OPERATION_V1,
    SOURCE_INTAKE_REQUIRED_EFFECTS_V1, SOURCE_INTAKE_TARGET_OWNER_V1,
};

use super::{
    AcquisitionTerminalV1, InvocationPermitV1, OpenAlexResponseObservationV1, ProductEdgeGatewayV1,
    SourceAcquisitionAuthorityBindingV1, SourceAcquisitionAuthorityClassV1,
    SourceAcquisitionReceiptV1, SourceIntakeAttemptV1, SourceIntakeInvocationPolicyEvidenceV1,
    SourceIntakePublicReadbackV1, SourceIntakeRetrievalTimeEvidenceV1, SourceIntakeStateV1,
    SourceInterpretationV1,
};

const MAX_IDENTITY_BYTES: usize = 192;
const MAX_DOI_BYTES: usize = 256;
const MAX_TEXT_BYTES: usize = 8_192;

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SourceIntakeOperationRequestV1 {
    pub request_identity: String,
    pub channel: ProductEdgeGatewayV1,
    pub normalized_doi: String,
    pub interpretation: SourceInterpretationV1,
}

impl SourceIntakeOperationRequestV1 {
    pub fn validate(&self) -> Result<(), SourceIntakeOwnerErrorV1> {
        validate_identity(&self.request_identity)?;

        if self.channel != ProductEdgeGatewayV1::WindmillProductEdge {
            return Err(SourceIntakeOwnerErrorV1::Invalid);
        }
        validate_doi(&self.normalized_doi)?;
        validate_text(&self.interpretation.bounded_explanation)?;
        validate_text(&self.interpretation.differentiating_prediction)?;
        validate_text(&self.interpretation.falsifier)?;
        let alternatives = &self.interpretation.plausible_alternatives;
        if !(1..=16).contains(&alternatives.len())
            || alternatives
                .iter()
                .any(|value| validate_text(value).is_err())
            || !alternatives.windows(2).all(|pair| pair[0] < pair[1])
        {
            return Err(SourceIntakeOwnerErrorV1::Invalid);
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SourceIntakeTerminalAtomV1 {
    pub request_identity: String,
    pub binding_identity: String,
    pub authority_class: SourceAcquisitionAuthorityClassV1,
    pub environment_identity: String,
    pub provider_profile_digest: String,
    pub fixture_corpus_digest: Option<String>,
    pub state: SourceIntakeStateV1,
    pub terminal: AcquisitionTerminalV1,
    pub receipt: SourceAcquisitionReceiptV1,
    pub content_locator: Option<String>,
    pub content_digest: Option<String>,
    pub provenance_identity: Option<String>,
    pub source_candidate_identity: Option<String>,
    pub outbox_event_identity: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SourceIntakeOwnerErrorV1 {
    Invalid,
    Conflict,
    PolicyUnavailable,
    ResponseLost,
    Unavailable,
}

pub struct SourceIntakeOwnerV1 {
    workflow: SourceIntakeWorkflowV1,
}

impl SourceIntakeOwnerV1 {
    pub fn production(
        product_edge: Arc<ProductEdgePostgresOwnerV1>,
        owner_pool: PgPool,
        request_proof_digest: String,
    ) -> Self {
        Self {
            workflow: SourceIntakeWorkflowV1::new(Arc::new(ProductionEnvironmentV1 {
                product_edge,
                owner_pool,
                request_proof_digest,
            })),
        }
    }

    #[cfg(feature = "sealed-source-intake-acceptance")]
    pub fn sealed_acceptance(
        environment: super::acceptance::SealedSourceIntakeEnvironmentV1,
    ) -> Self {
        Self {
            workflow: SourceIntakeWorkflowV1::new(Arc::new(environment)),
        }
    }

    pub async fn run(
        &self,
        request: SourceIntakeOperationRequestV1,
    ) -> Result<Option<SourceIntakeTerminalAtomV1>, SourceIntakeOwnerErrorV1> {
        request.validate()?;
        self.workflow.run(request).await
    }

    pub async fn resolve(
        &self,
        request_identity: &str,
    ) -> Result<Option<SourceIntakeTerminalAtomV1>, SourceIntakeOwnerErrorV1> {
        validate_identity(request_identity)?;
        self.workflow.resolve(request_identity).await
    }
}

#[cfg_attr(
    not(feature = "sealed-source-intake-acceptance"),
    expect(dead_code, reason = "production stops before sealed custody")
)]
pub(super) struct AdmissionCustodyV1 {
    pub(super) request: SourceIntakeOperationRequestV1,
    pub(super) locator: ProductEdgeAdmissionLocatorV1,
    pub(super) manifest_identity: String,
    pub(super) manifest_digest: String,
}

#[cfg_attr(
    not(feature = "sealed-source-intake-acceptance"),
    expect(dead_code, reason = "production has no positive policy authority")
)]
pub(super) struct PolicyCustodyV1 {
    pub(super) admission: AdmissionCustodyV1,
    pub(super) attempt: SourceIntakeAttemptV1,
    pub(super) invocation_evidence: SourceIntakeInvocationPolicyEvidenceV1,
    pub(super) retrieval_evidence: SourceIntakeRetrievalTimeEvidenceV1,
    pub(super) response_loss_after_commit: bool,
}

#[cfg_attr(
    not(feature = "sealed-source-intake-acceptance"),
    expect(dead_code, reason = "production has no positive policy authority")
)]
pub(super) struct BindingCustodyV1 {
    pub(super) admission: ProductEdgeAdmissionLocatorV1,
    pub(super) request: SourceIntakeOperationRequestV1,
    pub(super) attempt: SourceIntakeAttemptV1,
    pub(super) binding_commit_identity: String,
    pub(super) invocation_evidence: SourceIntakeInvocationPolicyEvidenceV1,
    pub(super) retrieval_evidence: SourceIntakeRetrievalTimeEvidenceV1,
    pub(super) response_loss_after_commit: bool,
}

#[cfg_attr(
    not(feature = "sealed-source-intake-acceptance"),
    expect(dead_code, reason = "production has no positive policy authority")
)]
pub(super) struct ClaimCustodyV1(pub(super) BindingCustodyV1);

#[cfg_attr(
    not(feature = "sealed-source-intake-acceptance"),
    expect(dead_code, reason = "production has no positive policy authority")
)]
pub(super) struct ReservationCustodyV1 {
    pub(super) binding: BindingCustodyV1,
    pub(super) start_request: ProductEdgeSourceInvocationStartRequestV1,
}

#[cfg_attr(
    not(feature = "sealed-source-intake-acceptance"),
    expect(dead_code, reason = "production has no positive policy authority")
)]
pub(super) struct StartedCustodyV1 {
    pub(super) binding: BindingCustodyV1,
    pub(super) started_state_digest: String,
}

#[cfg_attr(
    not(feature = "sealed-source-intake-acceptance"),
    expect(dead_code, reason = "production has no positive policy authority")
)]
pub(super) struct PermitCustodyV1 {
    pub(super) binding: BindingCustodyV1,
    pub(super) permit: InvocationPermitV1,
}

#[cfg_attr(
    not(feature = "sealed-source-intake-acceptance"),
    expect(dead_code, reason = "production has no positive policy authority")
)]
pub(super) struct ExecutionCustodyV1 {
    pub(super) binding: BindingCustodyV1,
    pub(super) permit: InvocationPermitV1,
    pub(super) observation: OpenAlexResponseObservationV1,
}

#[cfg_attr(
    not(feature = "sealed-source-intake-acceptance"),
    expect(dead_code, reason = "production has no positive policy authority")
)]
pub(super) struct RetrievalCustodyV1 {
    pub(super) binding: BindingCustodyV1,
    pub(super) readback: SourceIntakePublicReadbackV1,
}

#[async_trait]
pub(super) trait SourceIntakeEnvironmentPort: Send + Sync {
    async fn terminal_preflight(
        &self,
        request: &SourceIntakeOperationRequestV1,
    ) -> Result<Option<SourceIntakeTerminalAtomV1>, SourceIntakeOwnerErrorV1>;
    async fn admit(
        &self,
        request: SourceIntakeOperationRequestV1,
    ) -> Result<AdmissionCustodyV1, SourceIntakeOwnerErrorV1>;
    async fn resolve_policy(
        &self,
        admission: AdmissionCustodyV1,
    ) -> Result<Option<PolicyCustodyV1>, SourceIntakeOwnerErrorV1>;
    async fn commit_binding(
        &self,
        policy: PolicyCustodyV1,
    ) -> Result<BindingCustodyV1, SourceIntakeOwnerErrorV1>;
    async fn claim_invocation(
        &self,
        binding: BindingCustodyV1,
    ) -> Result<ClaimCustodyV1, SourceIntakeOwnerErrorV1>;
    async fn reserve_start(
        &self,
        claim: ClaimCustodyV1,
    ) -> Result<ReservationCustodyV1, SourceIntakeOwnerErrorV1>;
    async fn commit_rejection(
        &self,
        reservation: ReservationCustodyV1,
    ) -> Result<SourceIntakeTerminalAtomV1, SourceIntakeOwnerErrorV1>;
    async fn mark_started(
        &self,
        reservation: ReservationCustodyV1,
    ) -> Result<StartedCustodyV1, SourceIntakeOwnerErrorV1>;
    async fn reserve_permit(
        &self,
        started: StartedCustodyV1,
    ) -> Result<PermitCustodyV1, SourceIntakeOwnerErrorV1>;
    async fn execute_provider(
        &self,
        permit: PermitCustodyV1,
    ) -> Result<ExecutionCustodyV1, SourceIntakeOwnerErrorV1>;
    async fn resolve_retrieval(
        &self,
        execution: ExecutionCustodyV1,
    ) -> Result<RetrievalCustodyV1, SourceIntakeOwnerErrorV1>;
    async fn commit_terminal(
        &self,
        retrieval: RetrievalCustodyV1,
    ) -> Result<SourceIntakeTerminalAtomV1, SourceIntakeOwnerErrorV1>;
    async fn resolve_terminal(
        &self,
        request_identity: &str,
    ) -> Result<Option<SourceIntakeTerminalAtomV1>, SourceIntakeOwnerErrorV1>;
}

struct SourceIntakeWorkflowV1 {
    environment: Arc<dyn SourceIntakeEnvironmentPort>,
}

impl SourceIntakeWorkflowV1 {
    fn new(environment: Arc<dyn SourceIntakeEnvironmentPort>) -> Self {
        Self { environment }
    }

    async fn run(
        &self,
        request: SourceIntakeOperationRequestV1,
    ) -> Result<Option<SourceIntakeTerminalAtomV1>, SourceIntakeOwnerErrorV1> {
        if let Some(terminal) = self.environment.terminal_preflight(&request).await? {
            return Ok(Some(terminal));
        }
        let admission = self.environment.admit(request).await?;
        let policy = self
            .environment
            .resolve_policy(admission)
            .await?
            .ok_or(SourceIntakeOwnerErrorV1::PolicyUnavailable)?;
        let binding = self.environment.commit_binding(policy).await?;
        let rejected = !binding.invocation_evidence.admits_invocation();
        let claim = self.environment.claim_invocation(binding).await?;
        let reservation = self.environment.reserve_start(claim).await?;

        if rejected {
            return self
                .environment
                .commit_rejection(reservation)
                .await
                .map(Some);
        }
        let started = self.environment.mark_started(reservation).await?;
        let permit = self.environment.reserve_permit(started).await?;
        let execution = self
            .environment
            .execute_provider(permit)
            .await
            .map_err(post_start_error)?;
        let retrieval = self
            .environment
            .resolve_retrieval(execution)
            .await
            .map_err(post_start_error)?;
        self.environment.commit_terminal(retrieval).await.map(Some)
    }

    async fn resolve(
        &self,
        request_identity: &str,
    ) -> Result<Option<SourceIntakeTerminalAtomV1>, SourceIntakeOwnerErrorV1> {
        self.environment.resolve_terminal(request_identity).await
    }
}

fn post_start_error(error: SourceIntakeOwnerErrorV1) -> SourceIntakeOwnerErrorV1 {
    match error {
        SourceIntakeOwnerErrorV1::Invalid | SourceIntakeOwnerErrorV1::Conflict => error,
        _ => SourceIntakeOwnerErrorV1::ResponseLost,
    }
}

struct ProductionEnvironmentV1 {
    product_edge: Arc<ProductEdgePostgresOwnerV1>,
    owner_pool: PgPool,
    request_proof_digest: String,
}

#[async_trait]
impl SourceIntakeEnvironmentPort for ProductionEnvironmentV1 {
    async fn terminal_preflight(
        &self,
        request: &SourceIntakeOperationRequestV1,
    ) -> Result<Option<SourceIntakeTerminalAtomV1>, SourceIntakeOwnerErrorV1> {
        terminal_preflight(
            &self.product_edge,
            &self.owner_pool,
            request,
            &self.request_proof_digest,
            &live_external_authority(),
        )
        .await
    }
    async fn admit(
        &self,
        request: SourceIntakeOperationRequestV1,
    ) -> Result<AdmissionCustodyV1, SourceIntakeOwnerErrorV1> {
        admit(&self.product_edge, request, &self.request_proof_digest).await
    }
    async fn resolve_policy(
        &self,
        _admission: AdmissionCustodyV1,
    ) -> Result<Option<PolicyCustodyV1>, SourceIntakeOwnerErrorV1> {
        Ok(None)
    }
    async fn commit_binding(
        &self,
        _policy: PolicyCustodyV1,
    ) -> Result<BindingCustodyV1, SourceIntakeOwnerErrorV1> {
        Err(SourceIntakeOwnerErrorV1::Unavailable)
    }
    async fn claim_invocation(
        &self,
        _binding: BindingCustodyV1,
    ) -> Result<ClaimCustodyV1, SourceIntakeOwnerErrorV1> {
        Err(SourceIntakeOwnerErrorV1::Unavailable)
    }
    async fn reserve_start(
        &self,
        _claim: ClaimCustodyV1,
    ) -> Result<ReservationCustodyV1, SourceIntakeOwnerErrorV1> {
        Err(SourceIntakeOwnerErrorV1::Unavailable)
    }
    async fn commit_rejection(
        &self,
        _reservation: ReservationCustodyV1,
    ) -> Result<SourceIntakeTerminalAtomV1, SourceIntakeOwnerErrorV1> {
        Err(SourceIntakeOwnerErrorV1::Unavailable)
    }
    async fn mark_started(
        &self,
        _reservation: ReservationCustodyV1,
    ) -> Result<StartedCustodyV1, SourceIntakeOwnerErrorV1> {
        Err(SourceIntakeOwnerErrorV1::Unavailable)
    }
    async fn reserve_permit(
        &self,
        _started: StartedCustodyV1,
    ) -> Result<PermitCustodyV1, SourceIntakeOwnerErrorV1> {
        Err(SourceIntakeOwnerErrorV1::Unavailable)
    }
    async fn execute_provider(
        &self,
        _permit: PermitCustodyV1,
    ) -> Result<ExecutionCustodyV1, SourceIntakeOwnerErrorV1> {
        Err(SourceIntakeOwnerErrorV1::Unavailable)
    }
    async fn resolve_retrieval(
        &self,
        _execution: ExecutionCustodyV1,
    ) -> Result<RetrievalCustodyV1, SourceIntakeOwnerErrorV1> {
        Err(SourceIntakeOwnerErrorV1::Unavailable)
    }
    async fn commit_terminal(
        &self,
        _retrieval: RetrievalCustodyV1,
    ) -> Result<SourceIntakeTerminalAtomV1, SourceIntakeOwnerErrorV1> {
        Err(SourceIntakeOwnerErrorV1::Unavailable)
    }
    async fn resolve_terminal(
        &self,
        request_identity: &str,
    ) -> Result<Option<SourceIntakeTerminalAtomV1>, SourceIntakeOwnerErrorV1> {
        resolve_terminal(
            &self.product_edge,
            &self.owner_pool,
            request_identity,
            &self.request_proof_digest,
            &live_external_authority(),
        )
        .await
    }
}

pub(super) async fn terminal_preflight(
    product_edge: &ProductEdgePostgresOwnerV1,
    owner_pool: &PgPool,
    request: &SourceIntakeOperationRequestV1,
    request_proof_digest: &str,
    authority: &SourceAcquisitionAuthorityBindingV1,
) -> Result<Option<SourceIntakeTerminalAtomV1>, SourceIntakeOwnerErrorV1> {
    let expected = canonical_admission_request(request, request_proof_digest);
    match product_edge
        .resolve_admission(&request.request_identity, request_proof_digest)
        .await
        .map_err(|e| product_edge_error(&e))?
    {
        Some(existing) if existing.request() != &expected => {
            Err(SourceIntakeOwnerErrorV1::Conflict)
        }
        Some(_) => read_terminal(owner_pool, &request.request_identity, authority).await,
        None => {
            if read_terminal(owner_pool, &request.request_identity, authority)
                .await?
                .is_some()
            {
                return Err(SourceIntakeOwnerErrorV1::Unavailable);
            }
            Ok(None)
        }
    }
}

pub(super) async fn admit(
    product_edge: &ProductEdgePostgresOwnerV1,
    request: SourceIntakeOperationRequestV1,
    request_proof_digest: &str,
) -> Result<AdmissionCustodyV1, SourceIntakeOwnerErrorV1> {
    let expected = canonical_admission_request(&request, request_proof_digest);
    let admission = product_edge
        .admit_source_intake_request(expected.clone())
        .await
        .map_err(|e| product_edge_error(&e))?;
    if admission.request() != &expected {
        return Err(SourceIntakeOwnerErrorV1::Unavailable);
    }
    Ok(AdmissionCustodyV1 {
        request,
        locator: admission.locator().clone(),
        manifest_identity: admission.manifest_identity().to_string(),
        manifest_digest: admission.manifest_digest().to_string(),
    })
}

pub(super) async fn resolve_terminal(
    product_edge: &ProductEdgePostgresOwnerV1,
    owner_pool: &PgPool,
    request_identity: &str,
    request_proof_digest: &str,
    authority: &SourceAcquisitionAuthorityBindingV1,
) -> Result<Option<SourceIntakeTerminalAtomV1>, SourceIntakeOwnerErrorV1> {
    if product_edge
        .resolve_admission(request_identity, request_proof_digest)
        .await
        .map_err(|e| product_edge_error(&e))?
        .is_none()
    {
        return Ok(None);
    }
    read_terminal(owner_pool, request_identity, authority).await
}

pub(super) async fn read_terminal(
    owner_pool: &PgPool,
    request_identity: &str,
    authority: &SourceAcquisitionAuthorityBindingV1,
) -> Result<Option<SourceIntakeTerminalAtomV1>, SourceIntakeOwnerErrorV1> {
    let value: Option<serde_json::Value> =
        sqlx::query_scalar("SELECT rd_owner_api.read_source_intake_v1($1)")
            .bind(request_identity)
            .fetch_one(owner_pool)
            .await
            .map_err(|_| SourceIntakeOwnerErrorV1::Unavailable)?;
    value
        .map(|value| {
            serde_json::from_value(value)
                .map_err(|_| SourceIntakeOwnerErrorV1::Unavailable)
                .and_then(|readback| project_terminal(readback, request_identity, authority))
        })
        .transpose()
}

pub(super) fn canonical_admission_request(
    request: &SourceIntakeOperationRequestV1,
    request_proof_digest: &str,
) -> ProductEdgeAdmissionRequestV1 {
    ProductEdgeAdmissionRequestV1 {
        request_identity: request.request_identity.clone(),
        typed_payload: serde_json::json!({ "request_identity": request.request_identity, "gateway": request.channel, "normalized_doi": request.normalized_doi, "interpretation": request.interpretation }),
        operation: SOURCE_INTAKE_OPERATION_V1.to_string(),
        operation_schema: SOURCE_INTAKE_OPERATION_SCHEMA_V1.to_string(),
        target_owner: SOURCE_INTAKE_TARGET_OWNER_V1.to_string(),
        requested_effects: SOURCE_INTAKE_REQUIRED_EFFECTS_V1
            .iter()
            .map(ToString::to_string)
            .collect(),
        request_proof_digest: request_proof_digest.to_string(),
        audit_correlation: format!("rd-workbench:{}", request.request_identity),
    }
}

pub(super) fn project_terminal(
    readback: SourceIntakePublicReadbackV1,
    request_identity: &str,
    authority: &SourceAcquisitionAuthorityBindingV1,
) -> Result<SourceIntakeTerminalAtomV1, SourceIntakeOwnerErrorV1> {
    validate_readback_authority(&readback.authority, authority)?;
    let terminal = readback
        .terminal
        .ok_or(SourceIntakeOwnerErrorV1::Unavailable)?;
    let receipt = readback
        .receipt
        .ok_or(SourceIntakeOwnerErrorV1::Unavailable)?;

    if readback.request_identity != request_identity
        || readback.state != SourceIntakeStateV1::Terminal
        || receipt.request_identity != request_identity
        || receipt.binding_identity != readback.binding_identity
        || receipt.terminal != terminal
        || readback
            .outbox_event_identity
            .as_deref()
            .is_none_or(str::is_empty)
    {
        return Err(SourceIntakeOwnerErrorV1::Unavailable);
    }
    let retrieved = terminal == AcquisitionTerminalV1::Retrieved;
    if retrieved
        && (receipt.invocation_identity.is_none()
            || receipt.content_digest.is_none()
            || readback.content_digest != receipt.content_digest
            || readback.content_locator
                != receipt
                    .content_digest
                    .as_ref()
                    .map(|digest| format!("rd-owner://source-payload/sha256/{digest}"))
            || readback.provenance_identity.is_none()
            || readback.source_candidate_identity.is_none())
    {
        return Err(SourceIntakeOwnerErrorV1::Unavailable);
    }

    if !retrieved
        && (receipt.content_digest.is_some()
            || readback.content_locator.is_some()
            || readback.content_digest.is_some()
            || readback.provenance_identity.is_some()
            || readback.source_candidate_identity.is_some())
    {
        return Err(SourceIntakeOwnerErrorV1::Unavailable);
    }
    Ok(SourceIntakeTerminalAtomV1 {
        request_identity: readback.request_identity,
        binding_identity: readback.binding_identity,
        authority_class: readback.authority.authority_class,
        environment_identity: readback.authority.environment_identity,
        provider_profile_digest: readback.authority.provider_profile_digest,
        fixture_corpus_digest: readback.authority.fixture_corpus_digest,
        state: SourceIntakeStateV1::Terminal,
        terminal,
        receipt,
        content_locator: readback.content_locator,
        content_digest: readback.content_digest,
        provenance_identity: readback.provenance_identity,
        source_candidate_identity: readback.source_candidate_identity,
        outbox_event_identity: readback.outbox_event_identity.unwrap_or_default(),
    })
}

pub(super) fn validate_readback_authority(
    actual: &SourceAcquisitionAuthorityBindingV1,
    expected: &SourceAcquisitionAuthorityBindingV1,
) -> Result<(), SourceIntakeOwnerErrorV1> {
    if actual != expected {
        return Err(SourceIntakeOwnerErrorV1::Conflict);
    }
    Ok(())
}

pub(super) fn live_external_authority() -> SourceAcquisitionAuthorityBindingV1 {
    SourceAcquisitionAuthorityBindingV1 {
        authority_class: SourceAcquisitionAuthorityClassV1::LiveExternal,
        environment_identity: "PRODUCTION_LIVE_EXTERNAL".into(),
        provider_profile_digest:
            "sha256:18e4411c991be0a92514bc8ff238ef0429f379d7aa0fd17c1169c7a4c0f45c6b".into(),
        fixture_corpus_digest: None,
    }
}

pub(super) fn product_edge_error(error: &ProductEdgeError) -> SourceIntakeOwnerErrorV1 {
    match error {
        ProductEdgeError::ConflictingReplay => SourceIntakeOwnerErrorV1::Conflict,
        ProductEdgeError::InvalidProposal(_) => SourceIntakeOwnerErrorV1::Invalid,
        ProductEdgeError::Unavailable | ProductEdgeError::Storage(_) => {
            SourceIntakeOwnerErrorV1::Unavailable
        }
    }
}

fn validate_identity(value: &str) -> Result<(), SourceIntakeOwnerErrorV1> {
    if value.is_empty()
        || value.len() > MAX_IDENTITY_BYTES
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"-._:/".contains(&byte))
    {
        return Err(SourceIntakeOwnerErrorV1::Invalid);
    }
    Ok(())
}

fn validate_doi(value: &str) -> Result<(), SourceIntakeOwnerErrorV1> {
    if value.is_empty()
        || value.len() > MAX_DOI_BYTES
        || value != value.trim()
        || !value.starts_with("10.")
        || !value.contains('/')
        || !value.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || b"./-_;():".contains(&byte)
        })
    {
        return Err(SourceIntakeOwnerErrorV1::Invalid);
    }
    Ok(())
}

fn validate_text(value: &str) -> Result<(), SourceIntakeOwnerErrorV1> {
    if value.trim().is_empty()
        || value.len() > MAX_TEXT_BYTES
        || value.chars().any(char::is_control)
    {
        return Err(SourceIntakeOwnerErrorV1::Invalid);
    }
    Ok(())
}
