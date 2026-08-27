//! Phase-A R&D Source Intake contract.
//!
//! It models the owner-local state and evidence boundary without granting a
//! caller database, provenance, or raw-payload authority.

use std::{collections::BTreeSet, net::IpAddr};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;

#[cfg(feature = "sealed-source-intake-acceptance")]
mod acceptance;

mod openalex_executor;
mod openalex_http;
mod owner;
mod policy_evidence;
mod postgres;
mod research_handoff;

#[cfg(feature = "sealed-source-intake-acceptance")]
pub use acceptance::{SealedSourceIntakeAuditV1, SealedSourceIntakeEnvironmentV1};

#[cfg(test)]
mod openalex_executor_tests;

pub use openalex_executor::{OpenAlexExecutionV1, execute_openalex};
pub use owner::{
    SourceIntakeOperationRequestV1, SourceIntakeOwnerErrorV1, SourceIntakeOwnerV1,
    SourceIntakeTerminalAtomV1,
};
pub use policy_evidence::{
    SharedTimeEvidenceBindingV1, SourceIntakeInvocationPolicyEvidenceV1,
    SourceIntakePolicyEvidencePort, SourceIntakePolicyEvidenceQueryV1,
    SourceIntakePolicyEvidenceResultV1, SourceIntakePolicyEvidenceV1,
    SourceIntakePolicyUnavailableReasonV1, SourceIntakeRetrievalTimeEvidenceV1,
};
#[cfg(test)]
#[allow(
    unused_imports,
    reason = "standalone Source Intake harness has no Product Edge assembly consumer"
)]
pub(crate) use research_handoff::verified_research_ancestry_fixture;
pub use research_handoff::{
    SourceIntakeResearchAncestryProposalV1, VerifiedSourceIntakeResearchAncestryV1,
};
pub use vibe_product_edge::ProductEdgeAdmissionLocatorV1;

#[cfg(test)]
pub(crate) use openalex_http::MAX_RESPONSE_BYTES;
#[cfg(test)]
pub use openalex_http::binding_content_address_for_test;
pub(crate) use openalex_http::{OpenAlexResponseObservationV1, ResponseHeaderV1};
pub use postgres::{
    SOURCE_INTAKE_MIGRATION_SQL_V1, SourceIntakeFailureTerminalCommitV1,
    SourceIntakeSuccessTerminalCommitV1, SourceIntakeTermsBlockedCommitV1,
    commit_source_intake_failure_terminal_in_transaction,
    commit_source_intake_success_terminal_in_transaction,
    commit_source_intake_terms_blocked_in_transaction, prepare_source_invocation_in_transaction,
    read_source_intake_terminal_in_transaction, reserve_started_source_invocation_in_transaction,
};

#[cfg(test)]
pub const TERMINAL_FAILURE_TRANSACTION_SQL_V1: &str = postgres::TERMINAL_FAILURE_TRANSACTION_SQL_V1;
#[cfg(test)]
pub const TERMINAL_SUCCESS_TRANSACTION_SQL_V1: &str = postgres::TERMINAL_SUCCESS_TRANSACTION_SQL_V1;

const MAX_IDENTITY_BYTES: usize = 192;
const MAX_DOI_BYTES: usize = 256;
const MAX_EXPLANATION_BYTES: usize = 8_192;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ProductEdgeGatewayV1 {
    WindmillProductEdge,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct OpenAlexWorkByDoiRequestV1 {
    pub request_identity: String,
    pub gateway: ProductEdgeGatewayV1,
    pub admission: ProductEdgeAdmissionLocatorV1,
    pub operation_manifest_identity: String,
    pub operation_manifest_digest: String,
    pub normalized_doi: String,
}

impl OpenAlexWorkByDoiRequestV1 {
    pub fn from_json(bytes: &[u8]) -> Result<Self, SourceIntakeError> {
        let request: Self = serde_json::from_slice(bytes)
            .map_err(|e| SourceIntakeError::InvalidRequest(e.to_string()))?;
        request.validate()?;
        Ok(request)
    }

    pub fn validate(&self) -> Result<(), SourceIntakeError> {
        validate_identity("request_identity", &self.request_identity)?;
        if self.admission.request_identity != self.request_identity {
            return Err(SourceIntakeError::InvalidRequest(
                "admission request identity does not match".into(),
            ));
        }
        validate_identity("admission_identity", &self.admission.admission_identity)?;
        validate_digest("admission_digest", &self.admission.admission_digest)?;
        validate_identity(
            "operation_manifest_identity",
            &self.operation_manifest_identity,
        )?;
        validate_digest("operation_manifest_digest", &self.operation_manifest_digest)?;
        validate_normalized_doi(&self.normalized_doi)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub(super) struct CanonicalStartedCustodyV1 {
    request_identity: String,
    admission_identity: String,
    started_state_digest: String,
    interpretation: SourceInterpretationV1,
}

#[cfg(test)]
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub(crate) struct TestStartedCustodyV1(CanonicalStartedCustodyV1);

#[cfg(test)]
impl TestStartedCustodyV1 {
    pub(crate) fn fixture(
        request_identity: impl Into<String>,
        admission_identity: impl Into<String>,
        started_state_digest: impl Into<String>,
        interpretation: SourceInterpretationV1,
    ) -> Result<Self, SourceIntakeError> {
        let custody = CanonicalStartedCustodyV1 {
            request_identity: request_identity.into(),
            admission_identity: admission_identity.into(),
            started_state_digest: started_state_digest.into(),
            interpretation,
        };
        validate_identity("request_identity", &custody.request_identity)?;
        validate_identity("admission_identity", &custody.admission_identity)?;
        validate_identity("started_state_digest", &custody.started_state_digest)?;
        custody.interpretation.validate()?;
        Ok(Self(custody))
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SourceInterpretationV1 {
    pub bounded_explanation: String,
    pub plausible_alternatives: Vec<String>,
    pub differentiating_prediction: String,
    pub falsifier: String,
}

impl SourceInterpretationV1 {
    fn validate(&self) -> Result<(), SourceIntakeError> {
        validate_bounded_text("bounded_explanation", &self.bounded_explanation)?;
        validate_bounded_text(
            "differentiating_prediction",
            &self.differentiating_prediction,
        )?;
        validate_bounded_text("falsifier", &self.falsifier)?;

        if self.plausible_alternatives.is_empty() || self.plausible_alternatives.len() > 16 {
            return Err(SourceIntakeError::InvalidRequest(
                "plausible_alternatives must contain 1..=16 values".into(),
            ));
        }
        let mut unique = BTreeSet::new();

        for alternative in &self.plausible_alternatives {
            validate_bounded_text("plausible_alternative", alternative)?;
            if !unique.insert(alternative) {
                return Err(SourceIntakeError::InvalidRequest(
                    "plausible_alternatives contains a duplicate".into(),
                ));
            }
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SourceAcquisitionAdmissionV1 {
    Admitted,
    Rejected,
    PolicyUnavailable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SourceAcquisitionAuthorityClassV1 {
    LiveExternal,
    SealedAcceptance,
}

impl SourceAcquisitionAuthorityClassV1 {
    const fn as_str(self) -> &'static str {
        match self {
            Self::LiveExternal => "LIVE_EXTERNAL",
            Self::SealedAcceptance => "SEALED_ACCEPTANCE",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SourceAcquisitionAuthorityBindingV1 {
    pub authority_class: SourceAcquisitionAuthorityClassV1,
    pub environment_identity: String,
    pub provider_profile_digest: String,
    pub fixture_corpus_digest: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SourceAcquisitionBindingV1 {
    pub schema_version: u32,
    pub binding_identity: String,
    pub binding_digest: String,
    pub authority: SourceAcquisitionAuthorityBindingV1,
    pub predecessor_binding_identity: Option<String>,
    pub request_identity: String,
    pub gateway: ProductEdgeGatewayV1,
    pub product_edge_admission: ProductEdgeAdmissionLocatorV1,
    pub operation_manifest_identity: String,
    pub operation_manifest_digest: String,
    pub policy_evidence_identity: String,
    pub policy_evidence_digest: String,
    pub normalized_doi: String,
    pub connector_identity: String,
    pub connector_version: String,
    pub connector_policy_identity: String,
    pub connector_policy_version: String,
    pub network_policy_identity: String,
    pub network_policy_version: String,
    pub scheme: String,
    pub host: String,
    pub tls_stack_identity: String,
    pub tls_policy_identity: String,
    pub tls_policy_version: String,
    pub method: String,
    pub https_origin: String,
    pub endpoint_path: String,
    pub endpoint_query: String,
    pub dns_policy_identity: String,
    pub dns_policy_version: String,
    pub dns_observation_identity: String,
    pub dns_observation_digest: String,
    pub resolved_addresses: Vec<IpAddr>,
    pub redirect_policy_identity: String,
    pub redirect_policy_version: String,
    pub redirect_predecessor_binding_identity: Option<String>,
    pub redirect_hop_index: u8,
    pub absent_body_digest: String,
    pub body_media_type: Option<String>,
    pub body_size_bytes: usize,
    pub allowed_header_digest: String,
    pub credential_policy_identity: String,
    pub credential_handle_identity: String,
    pub credential_audience: String,
    pub credential_scope: String,
    pub credential_placement: String,
    pub egress_policy_identity: String,
    pub egress_policy_version: String,
    pub media_type: String,
    pub byte_limit: usize,
    pub timeout_ms: u64,
    pub header_count_limit: usize,
    pub header_byte_limit: usize,
    pub retry_budget: u8,
    pub redirect_hop_limit: u8,
    pub rights_basis_identity: String,
    pub rights_policy_version: String,
    pub rights_effective_at_epoch_ms: u64,
    pub rights_valid_through_epoch_ms: u64,
    pub acquisition_scope: String,
    pub retention_policy_identity: String,
    pub retention_policy_version: String,
    pub retention_effective_at_epoch_ms: u64,
    pub retention_valid_through_epoch_ms: u64,
    pub retention_scope: String,
    pub shared_time: SharedTimeEvidenceBindingV1,
    pub admission: SourceAcquisitionAdmissionV1,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SourceIntakeStateV1 {
    BindingClosed,
    Prepared,
    InvocationReserved,
    Terminal,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AcquisitionTerminalV1 {
    Retrieved,
    NotFound,
    AuthRequired,
    AccessDenied,
    RateLimited,
    TermsOrLicenseBlocked,
    Malformed,
    Unavailable,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum LocationRightsPostureV1 {
    MutableMetadataNotReuseGrant,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct LocationRightsV1 {
    pub location_identity: String,
    pub is_open_access_metadata: Option<bool>,
    pub reported_license: Option<String>,
    pub landing_page_locator_digest: Option<String>,
    pub pdf_locator_digest: Option<String>,
    pub posture: LocationRightsPostureV1,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SourceAcquisitionReceiptV1 {
    pub schema_version: u32,
    pub receipt_identity: String,
    pub request_identity: String,
    pub binding_identity: String,
    pub attempt_identity: String,
    pub invocation_identity: Option<String>,
    pub terminal: AcquisitionTerminalV1,
    pub terminal_evidence_identity: String,
    pub terminal_evidence_digest: String,
    pub policy_decision_identity: String,
    pub policy_decision_digest: String,
    pub policy_decision_time: SharedTimeEvidenceBindingV1,
    pub response_status: Option<u16>,
    pub response_header_digest: Option<String>,
    pub connected_address: Option<IpAddr>,
    pub response_media_type: Option<String>,
    pub response_size_bytes: Option<usize>,
    pub content_digest: Option<String>,
    pub retrieval_time_evidence_identity: String,
    pub retrieval_time_evidence_digest: String,
    pub retrieval_time: SharedTimeEvidenceBindingV1,
    /// Storage commit metadata only; never Shared Time authority.
    pub committed_at_epoch_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ResearchSourceProvenanceV1 {
    pub schema_version: u32,
    pub provenance_identity: String,
    pub predecessor_provenance_identity: Option<String>,
    pub canonical_source_identity: String,
    pub canonical_source_origin: String,
    pub source_class: String,
    pub author_or_originating_system: String,
    pub publication_time_epoch_ms: Option<u64>,
    pub revision_identity: Option<String>,
    pub linked_reference_identities: Vec<String>,
    pub content_digest: String,
    pub raw_content_digest: String,
    pub connector_identity: String,
    pub connector_version: String,
    pub acquisition_receipt_identity: String,
    pub retrieval_time: SharedTimeEvidenceBindingV1,
    pub valid_through_epoch_ms: u64,
    pub rights_basis_identity: String,
    pub rights_policy_version: String,
    pub license_basis: String,
    pub attribution_basis: String,
    pub acquisition_scope: String,
    pub retention_policy_identity: String,
    pub retention_policy_version: String,
    pub retention_scope: String,
    /// Provider-response rights metadata is untrusted and non-authoritative.
    pub location_rights: Vec<LocationRightsV1>,
    pub bounded_interpretation_identity: String,
    pub bounded_interpretation_digest: String,
    pub interpretation: SourceInterpretationV1,
    pub interpretation_status: String,
    pub trust_class: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SourceCandidateV1 {
    pub candidate_identity: String,
    pub provenance_identity: String,
    pub interpretation_digest: String,
    pub trust_class: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SourceIntakeOutboxV1 {
    pub event_identity: String,
    pub aggregate_identity: String,
    pub event_kind: String,
    pub payload_digest: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SourceIntakePublicReadbackV1 {
    pub request_identity: String,
    pub binding_identity: String,
    pub authority: SourceAcquisitionAuthorityBindingV1,
    pub state: SourceIntakeStateV1,
    pub terminal: Option<AcquisitionTerminalV1>,
    pub receipt: Option<SourceAcquisitionReceiptV1>,
    pub content_locator: Option<String>,
    pub content_digest: Option<String>,
    pub provenance_identity: Option<String>,
    pub source_candidate_identity: Option<String>,
    pub outbox_event_identity: Option<String>,
}

#[derive(Debug)]
pub struct InvocationPermitV1 {
    invocation_identity: String,
    binding_identity: String,
    request_identity: String,
    method: &'static str,
    origin: &'static str,
    path: String,
    resolved_addresses: Vec<IpAddr>,
    timeout_ms: u64,
    byte_limit: usize,
    policy_decision_identity: String,
    policy_decision_digest: String,
    policy_time: SharedTimeEvidenceBindingV1,
}

impl InvocationPermitV1 {
    pub(crate) fn invocation_identity(&self) -> &str {
        &self.invocation_identity
    }

    fn openalex_request(&self) -> (&'static str, &'static str, &str, &[IpAddr], u64, usize) {
        (
            self.method,
            self.origin,
            &self.path,
            &self.resolved_addresses,
            self.timeout_ms,
            self.byte_limit,
        )
    }
}

#[derive(Debug, Clone)]
struct PrivateTerminalCommitV1 {
    retrieval_time_evidence: SourceIntakeRetrievalTimeEvidenceV1,
    raw_payload: Option<Vec<u8>>,
    public: SourceIntakePublicReadbackV1,
    provenance: Option<ResearchSourceProvenanceV1>,
    candidate: Option<SourceCandidateV1>,
    outbox: Option<SourceIntakeOutboxV1>,
}

#[derive(Debug)]
pub struct SourceIntakeAttemptV1 {
    request: OpenAlexWorkByDoiRequestV1,
    binding: SourceAcquisitionBindingV1,
    state: SourceIntakeStateV1,
    binding_commit_identity: Option<String>,
    started_custody: Option<CanonicalStartedCustodyV1>,
    invocation_identity: Option<String>,
    current_policy: Option<SourceIntakeInvocationPolicyEvidenceV1>,
    terminal_commit: Option<PrivateTerminalCommitV1>,
}

impl SourceIntakeAttemptV1 {
    pub fn close_binding(
        request: OpenAlexWorkByDoiRequestV1,
        evidence: SourceIntakePolicyEvidenceV1,
    ) -> Result<Self, SourceIntakeError> {
        request.validate()?;
        let binding = openalex_http::build_binding(&request, evidence)?;
        Ok(Self {
            request,
            binding,
            state: SourceIntakeStateV1::BindingClosed,
            binding_commit_identity: None,
            started_custody: None,
            invocation_identity: None,
            current_policy: None,
            terminal_commit: None,
        })
    }

    pub fn binding(&self) -> &SourceAcquisitionBindingV1 {
        &self.binding
    }

    #[cfg(feature = "sealed-source-intake-acceptance")]
    fn bind_sealed_acceptance_authority(
        &mut self,
        authority: SourceAcquisitionAuthorityBindingV1,
    ) -> Result<(), SourceIntakeError> {
        if self.state != SourceIntakeStateV1::BindingClosed
            || authority.authority_class != SourceAcquisitionAuthorityClassV1::SealedAcceptance
            || authority.fixture_corpus_digest.is_none()
        {
            return Err(SourceIntakeError::IdentityConflict);
        }
        self.binding.authority = authority;
        self.binding.scheme = "sealed-acceptance".into();
        self.binding.host = "openalex-fixture.source-intake.invalid".into();
        self.binding.https_origin =
            "sealed-acceptance://openalex-fixture.source-intake.invalid".into();
        self.binding.connector_identity = "rd.openalex-work-by-doi.sealed-acceptance".into();
        self.binding.credential_handle_identity = "NO_CREDENTIAL_CAPABILITY".into();
        self.binding.egress_policy_identity = "NO_EXTERNAL_NETWORK".into();
        let (digest, identity) = openalex_http::binding_content_address(&self.binding)?;
        self.binding.binding_digest = digest;
        self.binding.binding_identity = identity;
        Ok(())
    }

    #[cfg(test)]
    pub(crate) fn reserve_invocation_fixture(
        &mut self,
    ) -> Result<InvocationPermitV1, SourceIntakeError> {
        let evidence = SourceIntakeInvocationPolicyEvidenceV1::fixture(
            &self.binding,
            self.binding.shared_time.decision_cut_epoch_ms + 1,
            SourceAcquisitionAdmissionV1::Admitted,
        );
        self.reserve_invocation(evidence)
    }

    #[cfg(test)]
    pub(crate) fn retrieval_time_fixture(&self) -> SourceIntakeRetrievalTimeEvidenceV1 {
        let policy = self
            .current_policy
            .as_ref()
            .expect("policy fixture reserved");
        SourceIntakeRetrievalTimeEvidenceV1::fixture(
            policy,
            policy.current_time.decision_cut_epoch_ms + 1,
        )
    }

    pub fn state(&self) -> SourceIntakeStateV1 {
        self.state
    }

    #[cfg(test)]
    pub(crate) fn prepare(
        &mut self,
        binding_commit_identity: impl Into<String>,
        started_custody: TestStartedCustodyV1,
    ) -> Result<(), SourceIntakeError> {
        self.prepare_verified(binding_commit_identity.into(), started_custody.0)
    }

    #[cfg(any(test, feature = "sealed-source-intake-acceptance"))]
    pub(super) fn prepare_verified(
        &mut self,
        binding_commit_identity: String,
        started_custody: CanonicalStartedCustodyV1,
    ) -> Result<(), SourceIntakeError> {
        if self.state != SourceIntakeStateV1::BindingClosed {
            return Err(SourceIntakeError::InvalidTransition);
        }
        validate_identity("binding_commit_identity", &binding_commit_identity)?;

        if started_custody.request_identity != self.request.request_identity
            || started_custody.admission_identity != self.request.admission.admission_identity
        {
            return Err(SourceIntakeError::CustodyMismatch);
        }
        self.binding_commit_identity = Some(binding_commit_identity);
        self.started_custody = Some(started_custody);
        self.state = SourceIntakeStateV1::Prepared;
        Ok(())
    }

    pub fn reserve_invocation(
        &mut self,
        evidence: SourceIntakeInvocationPolicyEvidenceV1,
    ) -> Result<InvocationPermitV1, SourceIntakeError> {
        let invocation_identity = self.reserve_invocation_identity(&evidence)?;
        Ok(InvocationPermitV1 {
            invocation_identity,
            binding_identity: self.binding.binding_identity.clone(),
            request_identity: self.request.request_identity.clone(),
            method: openalex_http::METHOD,
            origin: openalex_http::ORIGIN,
            path: self.binding.endpoint_path.clone(),
            resolved_addresses: self.binding.resolved_addresses.clone(),
            timeout_ms: self.binding.timeout_ms,
            byte_limit: self.binding.byte_limit,
            policy_decision_identity: evidence.decision_identity,
            policy_decision_digest: evidence.decision_digest,
            policy_time: evidence.current_time,
        })
    }

    fn reserve_invocation_identity(
        &mut self,
        evidence: &SourceIntakeInvocationPolicyEvidenceV1,
    ) -> Result<String, SourceIntakeError> {
        if self.state != SourceIntakeStateV1::Prepared
            || self.binding.admission != SourceAcquisitionAdmissionV1::Admitted
            || self.binding_commit_identity.is_none()
            || self.started_custody.is_none()
            || !evidence.admits_invocation()
        {
            return Err(SourceIntakeError::EffectNotAdmitted);
        }
        validate_current_policy(&self.binding, evidence)?;
        let invocation_identity = domain_identity(
            "rd.source-intake.openalex.invocation.v1",
            &[
                &self.request.request_identity,
                &self.binding.binding_identity,
                self.binding_commit_identity.as_deref().unwrap_or_default(),
                self.started_custody
                    .as_ref()
                    .map_or("", |custody| &custody.started_state_digest),
                &evidence.decision_identity,
                &evidence.decision_digest,
                &evidence.current_time.head_digest,
                self.binding.authority.authority_class.as_str(),
                &self.binding.authority.environment_identity,
                &self.binding.authority.provider_profile_digest,
                self.binding
                    .authority
                    .fixture_corpus_digest
                    .as_deref()
                    .unwrap_or("ABSENT"),
            ],
        );
        self.current_policy = Some(evidence.clone());
        self.invocation_identity = Some(invocation_identity.clone());
        self.state = SourceIntakeStateV1::InvocationReserved;
        Ok(invocation_identity)
    }

    #[cfg(feature = "sealed-source-intake-acceptance")]
    pub(super) fn adopt_reserved_invocation(
        &mut self,
        evidence: &SourceIntakeInvocationPolicyEvidenceV1,
        invocation_identity: &str,
    ) -> Result<(), SourceIntakeError> {
        let derived_identity = self.reserve_invocation_identity(evidence)?;
        if derived_identity != invocation_identity {
            return Err(SourceIntakeError::IdentityConflict);
        }
        Ok(())
    }

    pub fn terminate_before_invocation(
        &mut self,
        evidence: SourceIntakeInvocationPolicyEvidenceV1,
        retrieval_time: &SourceIntakeRetrievalTimeEvidenceV1,
        committed_at_epoch_ms: u64,
    ) -> Result<SourceIntakePublicReadbackV1, SourceIntakeError> {
        if self.state != SourceIntakeStateV1::Prepared
            || evidence.decision != SourceAcquisitionAdmissionV1::Rejected
        {
            return Err(SourceIntakeError::InvalidTransition);
        }
        validate_current_policy(&self.binding, &evidence)?;
        validate_retrieval_time(&evidence, retrieval_time)?;
        self.current_policy = Some(evidence);
        self.finish(
            openalex_http::ResolvedResponseV1::without_payload(
                AcquisitionTerminalV1::TermsOrLicenseBlocked,
                None,
                None,
            ),
            retrieval_time,
            committed_at_epoch_ms,
        )
    }

    pub(crate) fn resolve(
        &mut self,
        permit: InvocationPermitV1,
        observation: OpenAlexResponseObservationV1,
        retrieval_time: &SourceIntakeRetrievalTimeEvidenceV1,
        committed_at_epoch_ms: u64,
    ) -> Result<SourceIntakePublicReadbackV1, SourceIntakeError> {
        self.verify_permit(&permit)?;
        drop(permit);
        let resolution = openalex_http::resolve_response(
            &self.request.normalized_doi,
            observation,
            self.binding.byte_limit,
            &self.binding.resolved_addresses,
        );
        self.finish(resolution, retrieval_time, committed_at_epoch_ms)
    }

    #[cfg(test)]
    pub fn terminate_before_invocation_fixture(
        &mut self,
        terminal: AcquisitionTerminalV1,
        committed_at_epoch_ms: u64,
    ) -> Result<SourceIntakePublicReadbackV1, SourceIntakeError> {
        if terminal != AcquisitionTerminalV1::TermsOrLicenseBlocked {
            return Err(SourceIntakeError::InvalidTransition);
        }
        let policy = SourceIntakeInvocationPolicyEvidenceV1::fixture(
            &self.binding,
            self.binding.shared_time.decision_cut_epoch_ms + 1,
            SourceAcquisitionAdmissionV1::Rejected,
        );
        let retrieval = SourceIntakeRetrievalTimeEvidenceV1::fixture(
            &policy,
            policy.current_time.decision_cut_epoch_ms + 1,
        );
        self.terminate_before_invocation(policy, &retrieval, committed_at_epoch_ms)
    }

    pub fn resolve_openalex_execution(
        &mut self,
        execution: OpenAlexExecutionV1,
        retrieval_time: &SourceIntakeRetrievalTimeEvidenceV1,
        committed_at_epoch_ms: u64,
    ) -> Result<SourceIntakePublicReadbackV1, SourceIntakeError> {
        let (permit, observation) = execution.into_parts();
        self.resolve(permit, observation, retrieval_time, committed_at_epoch_ms)
    }

    #[cfg(test)]
    pub(crate) fn resolve_openalex_execution_fixture(
        &mut self,
        execution: OpenAlexExecutionV1,
        committed_at_epoch_ms: u64,
    ) -> Result<SourceIntakePublicReadbackV1, SourceIntakeError> {
        let retrieval_time = self.retrieval_time_fixture();
        self.resolve_openalex_execution(execution, &retrieval_time, committed_at_epoch_ms)
    }

    pub fn resolve_reserved_response_loss(
        &mut self,
        invocation_identity: &str,
        retrieval_time: &SourceIntakeRetrievalTimeEvidenceV1,
        committed_at_epoch_ms: u64,
    ) -> Result<SourceIntakePublicReadbackV1, SourceIntakeError> {
        if self.state == SourceIntakeStateV1::Terminal {
            if self.invocation_identity.as_deref() == Some(invocation_identity) {
                return Ok(self.public_readback());
            }
            return Err(SourceIntakeError::IdentityConflict);
        }

        if self.state != SourceIntakeStateV1::InvocationReserved
            || self.invocation_identity.as_deref() != Some(invocation_identity)
        {
            return Err(SourceIntakeError::IdentityConflict);
        }
        self.finish(
            openalex_http::ResolvedResponseV1::without_payload(
                AcquisitionTerminalV1::Unavailable,
                None,
                None,
            ),
            retrieval_time,
            committed_at_epoch_ms,
        )
    }

    #[cfg(test)]
    pub fn resolve_reserved_response_loss_fixture(
        &mut self,
        invocation_identity: &str,
        committed_at_epoch_ms: u64,
    ) -> Result<SourceIntakePublicReadbackV1, SourceIntakeError> {
        let retrieval_time = self.retrieval_time_fixture();
        self.resolve_reserved_response_loss(
            invocation_identity,
            &retrieval_time,
            committed_at_epoch_ms,
        )
    }

    pub fn public_readback(&self) -> SourceIntakePublicReadbackV1 {
        self.terminal_commit.as_ref().map_or_else(
            || SourceIntakePublicReadbackV1 {
                request_identity: self.request.request_identity.clone(),
                binding_identity: self.binding.binding_identity.clone(),
                authority: self.binding.authority.clone(),
                state: self.state,
                terminal: None,
                receipt: None,
                content_locator: None,
                content_digest: None,
                provenance_identity: None,
                source_candidate_identity: None,
                outbox_event_identity: None,
            },
            |commit| {
                debug_assert_eq!(
                    self.raw_payload().is_some(),
                    self.committed_provenance().is_some()
                );
                debug_assert_eq!(
                    self.committed_provenance().is_some(),
                    self.committed_candidate().is_some()
                );
                debug_assert!(self.committed_outbox().is_some());
                commit.public.clone()
            },
        )
    }

    pub(crate) fn raw_payload(&self) -> Option<&[u8]> {
        self.terminal_commit
            .as_ref()
            .and_then(|commit| commit.raw_payload.as_deref())
    }

    pub(crate) fn committed_provenance(&self) -> Option<&ResearchSourceProvenanceV1> {
        self.terminal_commit
            .as_ref()
            .and_then(|commit| commit.provenance.as_ref())
    }

    pub(crate) fn committed_candidate(&self) -> Option<&SourceCandidateV1> {
        self.terminal_commit
            .as_ref()
            .and_then(|commit| commit.candidate.as_ref())
    }

    pub(crate) fn committed_outbox(&self) -> Option<&SourceIntakeOutboxV1> {
        self.terminal_commit
            .as_ref()
            .and_then(|commit| commit.outbox.as_ref())
    }

    pub fn committed_retrieval_time_evidence(
        &self,
    ) -> Option<&SourceIntakeRetrievalTimeEvidenceV1> {
        self.terminal_commit
            .as_ref()
            .map(|commit| &commit.retrieval_time_evidence)
    }

    fn verify_permit(&self, permit: &InvocationPermitV1) -> Result<(), SourceIntakeError> {
        let current_policy = self
            .current_policy
            .as_ref()
            .ok_or(SourceIntakeError::IdentityConflict)?;

        if self.state != SourceIntakeStateV1::InvocationReserved
            || self.invocation_identity.as_deref() != Some(&permit.invocation_identity)
            || permit.binding_identity != self.binding.binding_identity
            || permit.request_identity != self.request.request_identity
            || permit.method != openalex_http::METHOD
            || permit.origin != openalex_http::ORIGIN
            || permit.path != self.binding.endpoint_path
            || permit.policy_decision_identity != current_policy.decision_identity
            || permit.policy_decision_digest != current_policy.decision_digest
            || permit.policy_time != current_policy.current_time
        {
            return Err(SourceIntakeError::IdentityConflict);
        }
        Ok(())
    }

    fn finish(
        &mut self,
        resolution: openalex_http::ResolvedResponseV1,
        retrieval_time: &SourceIntakeRetrievalTimeEvidenceV1,
        committed_at_epoch_ms: u64,
    ) -> Result<SourceIntakePublicReadbackV1, SourceIntakeError> {
        if !matches!(
            self.state,
            SourceIntakeStateV1::Prepared | SourceIntakeStateV1::InvocationReserved
        ) || self.terminal_commit.is_some()
        {
            return Err(SourceIntakeError::InvalidTransition);
        }
        let invocation_identity = self.invocation_identity.as_deref();
        if resolution.terminal == AcquisitionTerminalV1::Retrieved && invocation_identity.is_none()
        {
            return Err(SourceIntakeError::InvalidTransition);
        }
        let current_policy = self
            .current_policy
            .as_ref()
            .ok_or(SourceIntakeError::EffectNotAdmitted)?;
        validate_retrieval_time(current_policy, retrieval_time)?;
        let terminal_path_identity = invocation_identity.map_or_else(
            || {
                domain_identity(
                    "rd.source-intake.pre-invocation.v1",
                    &[
                        &self.request.request_identity,
                        &self.binding.binding_identity,
                        self.binding_commit_identity.as_deref().unwrap_or_default(),
                        self.started_custody
                            .as_ref()
                            .map_or("", |custody| &custody.started_state_digest),
                    ],
                )
            },
            ToString::to_string,
        );
        let receipt_identity = domain_identity(
            "rd.source-intake.receipt.v1",
            &[
                &self.request.request_identity,
                &self.binding.binding_identity,
                &terminal_path_identity,
                resolution.terminal.as_str(),
                resolution.content_digest.as_deref().unwrap_or("ABSENT"),
                &resolution
                    .response_status
                    .map_or_else(|| "ABSENT".into(), |value| value.to_string()),
                resolution
                    .response_header_digest
                    .as_deref()
                    .unwrap_or("ABSENT"),
                resolution
                    .connected_address
                    .as_ref()
                    .map_or_else(|| "ABSENT".into(), ToString::to_string)
                    .as_str(),
                resolution
                    .response_media_type
                    .as_deref()
                    .unwrap_or("ABSENT"),
                &resolution
                    .response_size_bytes
                    .map_or_else(|| "ABSENT".into(), |value| value.to_string()),
                &current_policy.decision_identity,
                &current_policy.decision_digest,
                &retrieval_time.evidence_identity,
                &retrieval_time.evidence_digest,
                &retrieval_time.current_time.head_digest,
                &committed_at_epoch_ms.to_string(),
            ],
        );
        let terminal_evidence_digest = domain_identity(
            "rd.source-intake.terminal-evidence.v1",
            &[
                &self.binding.binding_identity,
                &terminal_path_identity,
                resolution.terminal.as_str(),
                resolution
                    .response_header_digest
                    .as_deref()
                    .unwrap_or("ABSENT"),
                resolution.content_digest.as_deref().unwrap_or("ABSENT"),
                &current_policy.decision_identity,
                &current_policy.decision_digest,
                &retrieval_time.evidence_identity,
                &retrieval_time.evidence_digest,
                &retrieval_time.current_time.head_digest,
            ],
        );
        let terminal_evidence_identity = domain_identity(
            "rd.source-intake.terminal-evidence-identity.v1",
            &[&terminal_evidence_digest],
        );
        let receipt = SourceAcquisitionReceiptV1 {
            schema_version: 1,
            receipt_identity: receipt_identity.clone(),
            request_identity: self.request.request_identity.clone(),
            binding_identity: self.binding.binding_identity.clone(),
            attempt_identity: self.binding.binding_identity.clone(),
            invocation_identity: invocation_identity.map(ToString::to_string),
            terminal: resolution.terminal,
            terminal_evidence_identity,
            terminal_evidence_digest,
            policy_decision_identity: current_policy.decision_identity.clone(),
            policy_decision_digest: current_policy.decision_digest.clone(),
            policy_decision_time: current_policy.current_time.clone(),
            response_status: resolution.response_status,
            response_header_digest: resolution.response_header_digest.clone(),
            connected_address: resolution.connected_address,
            response_media_type: resolution.response_media_type.clone(),
            response_size_bytes: resolution.response_size_bytes,
            content_digest: resolution.content_digest.clone(),
            retrieval_time_evidence_identity: retrieval_time.evidence_identity.clone(),
            retrieval_time_evidence_digest: retrieval_time.evidence_digest.clone(),
            retrieval_time: retrieval_time.current_time.clone(),
            committed_at_epoch_ms,
        };

        let (provenance, candidate, content_locator) =
            if resolution.terminal == AcquisitionTerminalV1::Retrieved {
                let content_digest = resolution
                    .content_digest
                    .as_deref()
                    .ok_or(SourceIntakeError::MalformedResponse)?;
                let interpretation = self
                    .started_custody
                    .as_ref()
                    .ok_or(SourceIntakeError::CustodyMismatch)?;
                let interpretation_digest = interpretation_digest(&interpretation.interpretation);
                let interpretation_identity =
                    domain_identity("rd.source-interpretation.v1", &[&interpretation_digest]);
                let provenance_identity = domain_identity(
                    "rd.research-source-provenance.v1",
                    &[
                        &self.request.normalized_doi,
                        content_digest,
                        &receipt_identity,
                        &retrieval_time.current_time.head_digest,
                        &interpretation_identity,
                        &interpretation_digest,
                    ],
                );
                let provenance = ResearchSourceProvenanceV1 {
                    schema_version: 1,
                    provenance_identity: provenance_identity.clone(),
                    predecessor_provenance_identity: None,
                    canonical_source_identity: format!("doi:{}", self.request.normalized_doi),
                    canonical_source_origin: self.binding.https_origin.clone(),
                    source_class: "ACADEMIC_IDENTITY_AND_CITATION_GRAPH".into(),
                    author_or_originating_system: "OPENALEX".into(),
                    publication_time_epoch_ms: None,
                    revision_identity: None,
                    linked_reference_identities: Vec::new(),
                    content_digest: content_digest.to_string(),
                    raw_content_digest: content_digest.to_string(),
                    connector_identity: self.binding.connector_identity.clone(),
                    connector_version: self.binding.connector_version.clone(),
                    acquisition_receipt_identity: receipt_identity.clone(),
                    retrieval_time: retrieval_time.current_time.clone(),
                    valid_through_epoch_ms: retrieval_time.current_time.valid_through_epoch_ms,
                    rights_basis_identity: self.binding.rights_basis_identity.clone(),
                    rights_policy_version: self.binding.rights_policy_version.clone(),
                    license_basis: self.binding.rights_basis_identity.clone(),
                    attribution_basis: "OPENALEX_METADATA_ATTRIBUTION".into(),
                    acquisition_scope: self.binding.acquisition_scope.clone(),
                    retention_policy_identity: self.binding.retention_policy_identity.clone(),
                    retention_policy_version: self.binding.retention_policy_version.clone(),
                    retention_scope: self.binding.retention_scope.clone(),
                    location_rights: resolution.location_rights,
                    bounded_interpretation_identity: interpretation_identity,
                    bounded_interpretation_digest: interpretation_digest.clone(),
                    interpretation: interpretation.interpretation.clone(),
                    interpretation_status: "BOUNDED_RESEARCH_INTERPRETATION".into(),
                    trust_class: "UNTRUSTED_EXTERNAL_DATA".into(),
                };
                let candidate_identity = domain_identity(
                    "rd.source-candidate.v1",
                    &[&provenance_identity, &interpretation_digest],
                );
                let candidate = SourceCandidateV1 {
                    candidate_identity,
                    provenance_identity,
                    interpretation_digest,
                    trust_class: "UNTRUSTED_EXTERNAL_DATA".into(),
                };
                let locator = format!("rd-owner://source-payload/sha256/{content_digest}");
                (Some(provenance), Some(candidate), Some(locator))
            } else {
                (None, None, None)
            };
        let event_identity = domain_identity(
            "rd.owner-outbox.source-intake-terminated.v1",
            &[&self.request.request_identity, &receipt_identity],
        );
        let payload_digest = domain_identity(
            "rd.owner-outbox.payload.v1",
            &[
                &self.request.request_identity,
                &receipt_identity,
                provenance
                    .as_ref()
                    .map_or("ABSENT", |value| &value.provenance_identity),
                candidate
                    .as_ref()
                    .map_or("ABSENT", |value| &value.candidate_identity),
            ],
        );
        let outbox = SourceIntakeOutboxV1 {
            event_identity,
            aggregate_identity: self.request.request_identity.clone(),
            event_kind: "SOURCE_INTAKE_TERMINATED_V1".into(),
            payload_digest,
        };

        let public = SourceIntakePublicReadbackV1 {
            request_identity: self.request.request_identity.clone(),
            binding_identity: self.binding.binding_identity.clone(),
            authority: self.binding.authority.clone(),
            state: SourceIntakeStateV1::Terminal,
            terminal: Some(resolution.terminal),
            receipt: Some(receipt),
            content_locator,
            content_digest: resolution.content_digest.clone(),
            provenance_identity: provenance
                .as_ref()
                .map(|value| value.provenance_identity.clone()),
            source_candidate_identity: candidate
                .as_ref()
                .map(|value| value.candidate_identity.clone()),
            outbox_event_identity: Some(outbox.event_identity.clone()),
        };
        self.state = SourceIntakeStateV1::Terminal;
        self.terminal_commit = Some(PrivateTerminalCommitV1 {
            retrieval_time_evidence: retrieval_time.clone(),
            raw_payload: resolution.raw_payload,
            public: public.clone(),
            provenance,
            candidate,
            outbox: Some(outbox),
        });
        Ok(public)
    }
}

pub(super) fn validate_current_policy(
    binding: &SourceAcquisitionBindingV1,
    evidence: &SourceIntakeInvocationPolicyEvidenceV1,
) -> Result<(), SourceIntakeError> {
    validate_identity("policy_decision_identity", &evidence.decision_identity)?;
    validate_digest("policy_decision_digest", &evidence.decision_digest)?;
    if evidence.rights_basis_identity != binding.rights_basis_identity
        || evidence.rights_policy_version != binding.rights_policy_version
        || evidence.retention_policy_identity != binding.retention_policy_identity
        || evidence.retention_policy_version != binding.retention_policy_version
        || evidence.rights_effective_at_epoch_ms != binding.rights_effective_at_epoch_ms
        || evidence.rights_valid_through_epoch_ms != binding.rights_valid_through_epoch_ms
        || evidence.retention_effective_at_epoch_ms != binding.retention_effective_at_epoch_ms
        || evidence.retention_valid_through_epoch_ms != binding.retention_valid_through_epoch_ms
        || evidence.current_time.clock_identity != binding.shared_time.clock_identity
        || evidence.current_time.clock_epoch != binding.shared_time.clock_epoch
        || evidence.current_time.monotonic_sequence <= binding.shared_time.monotonic_sequence
        || evidence.current_time.decision_cut_epoch_ms <= binding.shared_time.decision_cut_epoch_ms
        || evidence.current_time.head_digest == binding.shared_time.head_digest
        || evidence.current_time.decision_cut_epoch_ms
            >= evidence.current_time.valid_through_epoch_ms
        || evidence.current_time.decision_cut_epoch_ms < evidence.rights_effective_at_epoch_ms
        || evidence.current_time.decision_cut_epoch_ms >= evidence.rights_valid_through_epoch_ms
        || evidence.current_time.decision_cut_epoch_ms < evidence.retention_effective_at_epoch_ms
        || evidence.current_time.decision_cut_epoch_ms >= evidence.retention_valid_through_epoch_ms
    {
        return Err(SourceIntakeError::EffectNotAdmitted);
    }
    Ok(())
}

fn validate_retrieval_time(
    policy: &SourceIntakeInvocationPolicyEvidenceV1,
    retrieval: &SourceIntakeRetrievalTimeEvidenceV1,
) -> Result<(), SourceIntakeError> {
    validate_identity(
        "retrieval_time_evidence_identity",
        &retrieval.evidence_identity,
    )?;
    validate_digest("retrieval_time_evidence_digest", &retrieval.evidence_digest)?;
    let current = retrieval.current_time();
    if current.clock_identity != policy.current_time.clock_identity
        || current.clock_epoch != policy.current_time.clock_epoch
        || current.monotonic_sequence <= policy.current_time.monotonic_sequence
        || current.decision_cut_epoch_ms < policy.current_time.decision_cut_epoch_ms
        || current.decision_cut_epoch_ms >= current.valid_through_epoch_ms
        || current.head_digest == policy.current_time.head_digest
    {
        return Err(SourceIntakeError::CustodyMismatch);
    }
    Ok(())
}

impl AcquisitionTerminalV1 {
    fn as_str(self) -> &'static str {
        match self {
            Self::Retrieved => "RETRIEVED",
            Self::NotFound => "NOT_FOUND",
            Self::AuthRequired => "AUTH_REQUIRED",
            Self::AccessDenied => "ACCESS_DENIED",
            Self::RateLimited => "RATE_LIMITED",
            Self::TermsOrLicenseBlocked => "TERMS_OR_LICENSE_BLOCKED",
            Self::Malformed => "MALFORMED",
            Self::Unavailable => "UNAVAILABLE",
        }
    }
}

pub(super) fn source_acquisition_receipt_content_address_matches(
    receipt: &SourceAcquisitionReceiptV1,
) -> bool {
    let Some(terminal_path_identity) = receipt.invocation_identity.as_deref() else {
        return false;
    };
    let connected_address = receipt
        .connected_address
        .as_ref()
        .map_or_else(|| "ABSENT".into(), ToString::to_string);
    let response_status = receipt
        .response_status
        .map_or_else(|| "ABSENT".into(), |value| value.to_string());
    let response_size_bytes = receipt
        .response_size_bytes
        .map_or_else(|| "ABSENT".into(), |value| value.to_string());
    let expected_receipt_identity = domain_identity(
        "rd.source-intake.receipt.v1",
        &[
            &receipt.request_identity,
            &receipt.binding_identity,
            terminal_path_identity,
            receipt.terminal.as_str(),
            receipt.content_digest.as_deref().unwrap_or("ABSENT"),
            &response_status,
            receipt
                .response_header_digest
                .as_deref()
                .unwrap_or("ABSENT"),
            &connected_address,
            receipt.response_media_type.as_deref().unwrap_or("ABSENT"),
            &response_size_bytes,
            &receipt.policy_decision_identity,
            &receipt.policy_decision_digest,
            &receipt.retrieval_time_evidence_identity,
            &receipt.retrieval_time_evidence_digest,
            &receipt.retrieval_time.head_digest,
            &receipt.committed_at_epoch_ms.to_string(),
        ],
    );
    let expected_terminal_evidence_digest = domain_identity(
        "rd.source-intake.terminal-evidence.v1",
        &[
            &receipt.binding_identity,
            terminal_path_identity,
            receipt.terminal.as_str(),
            receipt
                .response_header_digest
                .as_deref()
                .unwrap_or("ABSENT"),
            receipt.content_digest.as_deref().unwrap_or("ABSENT"),
            &receipt.policy_decision_identity,
            &receipt.policy_decision_digest,
            &receipt.retrieval_time_evidence_identity,
            &receipt.retrieval_time_evidence_digest,
            &receipt.retrieval_time.head_digest,
        ],
    );
    let expected_terminal_evidence_identity = domain_identity(
        "rd.source-intake.terminal-evidence-identity.v1",
        &[&expected_terminal_evidence_digest],
    );
    receipt.receipt_identity == expected_receipt_identity
        && receipt.terminal_evidence_digest == expected_terminal_evidence_digest
        && receipt.terminal_evidence_identity == expected_terminal_evidence_identity
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum SourceIntakeError {
    #[error("invalid Source Intake request: {0}")]
    InvalidRequest(String),
    #[error("Source Intake state transition is invalid")]
    InvalidTransition,
    #[error("Product Edge started custody does not match the request")]
    CustodyMismatch,
    #[error("network effect is not admitted")]
    EffectNotAdmitted,
    #[error("Source Intake identity conflicts with committed custody")]
    IdentityConflict,
    #[error("OpenAlex response is malformed")]
    MalformedResponse,
    #[error("OpenAlex response exceeds its binding")]
    ResponseBoundExceeded,
    #[error("OpenAlex network policy rejected the target")]
    NetworkPolicyRejected,
    #[error("Source Intake serialization failed: {0}")]
    Serialization(String),
}

fn validate_identity(name: &str, value: &str) -> Result<(), SourceIntakeError> {
    if value.is_empty()
        || value.len() > MAX_IDENTITY_BYTES
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"-._:/".contains(&byte))
    {
        return Err(SourceIntakeError::InvalidRequest(format!(
            "{name} is not canonical"
        )));
    }
    Ok(())
}

fn validate_digest(name: &str, value: &str) -> Result<(), SourceIntakeError> {
    if value.len() != 71
        || !value.starts_with("sha256:")
        || !value[7..]
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(SourceIntakeError::InvalidRequest(format!(
            "{name} is not a canonical sha256 digest"
        )));
    }
    Ok(())
}

fn validate_normalized_doi(doi: &str) -> Result<(), SourceIntakeError> {
    if doi.is_empty()
        || doi.len() > MAX_DOI_BYTES
        || doi != doi.trim()
        || doi.bytes().any(|byte| byte.is_ascii_uppercase())
        || !doi.starts_with("10.")
        || !doi.contains('/')
        || doi.bytes().any(|byte| byte.is_ascii_whitespace())
        || !doi.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || b"./-_;():".contains(&byte)
        })
    {
        return Err(SourceIntakeError::InvalidRequest(
            "normalized_doi is not canonical".into(),
        ));
    }
    Ok(())
}

fn validate_bounded_text(name: &str, value: &str) -> Result<(), SourceIntakeError> {
    if value.trim().is_empty()
        || value.len() > MAX_EXPLANATION_BYTES
        || value.chars().any(char::is_control)
    {
        return Err(SourceIntakeError::InvalidRequest(format!(
            "{name} is outside its bounds"
        )));
    }
    Ok(())
}

pub(crate) fn domain_identity(domain: &str, parts: &[&str]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(domain.as_bytes());
    for part in parts {
        hasher.update([0x1f]);
        hasher.update(part.as_bytes());
    }
    format!("sha256:{}", hex::encode(hasher.finalize()))
}

fn interpretation_digest(interpretation: &SourceInterpretationV1) -> String {
    let alternatives = interpretation.plausible_alternatives.join("\u{1e}");
    domain_identity(
        "rd.source-intake.interpretation.v1",
        &[
            &interpretation.bounded_explanation,
            &alternatives,
            &interpretation.differentiating_prediction,
            &interpretation.falsifier,
        ],
    )
}

fn digest_bytes(domain: &str, bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(domain.len().to_be_bytes());
    hasher.update(domain.as_bytes());
    hasher.update(bytes.len().to_be_bytes());
    hasher.update(bytes);
    format!("sha256:{}", hex::encode(hasher.finalize()))
}

fn raw_content_digest(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("sha256:{}", hex::encode(hasher.finalize()))
}

mod hex {
    pub(super) fn encode(bytes: impl AsRef<[u8]>) -> String {
        const DIGITS: &[u8; 16] = b"0123456789abcdef";
        let bytes = bytes.as_ref();
        let mut encoded = String::with_capacity(bytes.len() * 2);
        for &byte in bytes {
            encoded.push(char::from(DIGITS[usize::from(byte >> 4)]));
            encoded.push(char::from(DIGITS[usize::from(byte & 0x0f)]));
        }
        encoded
    }
}
