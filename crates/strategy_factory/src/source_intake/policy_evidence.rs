//! Sealed Owner-policy evidence for Source Intake admission.
//!
//! The query contains only untrusted locators. A future production composer must
//! resolve the locked Product Edge admission, R&D-owned acquisition policies,
//! DNS observation, and sealed Shared Time custody before it can return the
//! positive variant. Environment values and caller DTOs cannot construct that
//! variant.

use std::net::IpAddr;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use vibe_data::owner::shared_time_evidence::{
    ClockHeadHandoff, ClockHeadSuccessorReadback, UntrustedClockHeadLocator,
};
use vibe_product_edge::{ProductEdgeAdmissionLocatorV1, ProductEdgeAdmissionReadbackV1};

use super::{ProductEdgeGatewayV1, SourceAcquisitionAdmissionV1};

/// Untrusted locators for one exact policy-evidence decision.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SourceIntakePolicyEvidenceQueryV1 {
    pub request_identity: String,
    pub gateway: ProductEdgeGatewayV1,
    pub admission: ProductEdgeAdmissionLocatorV1,
    pub operation_manifest_identity: String,
    pub operation_manifest_digest: String,
    pub connector_policy_locator: String,
    pub network_policy_locator: String,
    pub rights_policy_locator: String,
    pub retention_policy_locator: String,
    pub dns_observation_locator: String,
    pub shared_time_head: UntrustedClockHeadLocator,
    pub shared_time_successor: Option<UntrustedClockHeadLocator>,
}

/// Fail-closed result of resolving one policy-evidence query.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "status")]
pub enum SourceIntakePolicyEvidenceResultV1 {
    Sealed {
        evidence: Box<SourceIntakePolicyEvidenceV1>,
    },
    Unavailable {
        reason: SourceIntakePolicyUnavailableReasonV1,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SourceIntakePolicyUnavailableReasonV1 {
    ProductEdgeUnavailable,
    ConnectorPolicyUnavailable,
    NetworkPolicyUnavailable,
    RightsPolicyUnavailable,
    RetentionPolicyUnavailable,
    DnsObservationUnavailable,
    SharedTimeUnavailable,
    EvidenceMismatch,
}

/// Read-only Owner-policy resolution port.
#[async_trait]
pub trait SourceIntakePolicyEvidencePort: Send + Sync {
    async fn resolve_source_intake_policy_evidence(
        &self,
        query: &SourceIntakePolicyEvidenceQueryV1,
    ) -> SourceIntakePolicyEvidenceResultV1;
}

/// Complete positive policy evidence. Fields are private and the type is not
/// deserializable, so callers cannot manufacture an admission decision.
///
/// ```compile_fail
/// use vibe_strategy_factory::source_intake::SourceIntakePolicyEvidenceV1;
/// let _: SourceIntakePolicyEvidenceV1 = serde_json::from_str("{}").unwrap();
/// ```
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SourceIntakePolicyEvidenceV1 {
    pub(super) policy_evidence_identity: String,
    pub(super) policy_evidence_digest: String,
    pub(super) gateway: ProductEdgeGatewayV1,
    pub(super) admission: ProductEdgeAdmissionLocatorV1,
    pub(super) operation_manifest_identity: String,
    pub(super) operation_manifest_digest: String,
    pub(super) connector_policy_identity: String,
    pub(super) connector_policy_version: String,
    pub(super) network_policy_identity: String,
    pub(super) network_policy_version: String,
    pub(super) dns_policy_identity: String,
    pub(super) dns_policy_version: String,
    pub(super) dns_observation_identity: String,
    pub(super) dns_observation_digest: String,
    pub(super) resolved_addresses: Vec<IpAddr>,
    pub(super) tls_policy_identity: String,
    pub(super) tls_policy_version: String,
    pub(super) redirect_policy_identity: String,
    pub(super) redirect_policy_version: String,
    pub(super) credential_policy_identity: String,
    pub(super) credential_handle_identity: String,
    pub(super) credential_audience: String,
    pub(super) credential_scope: String,
    pub(super) egress_policy_identity: String,
    pub(super) egress_policy_version: String,
    pub(super) rights_basis_identity: String,
    pub(super) rights_policy_version: String,
    pub(super) rights_effective_at_epoch_ms: u64,
    pub(super) rights_valid_through_epoch_ms: u64,
    pub(super) acquisition_scope: String,
    pub(super) retention_policy_identity: String,
    pub(super) retention_policy_version: String,
    pub(super) retention_effective_at_epoch_ms: u64,
    pub(super) retention_valid_through_epoch_ms: u64,
    pub(super) retention_scope: String,
    pub(super) shared_time: SharedTimeEvidenceBindingV1,
    pub(super) retry_budget: u8,
    pub(super) redirect_hop_limit: u8,
    pub(super) response_media_type: String,
    pub(super) response_byte_limit: usize,
    pub(super) response_timeout_ms: u64,
    pub(super) response_header_count_limit: usize,
    pub(super) response_header_byte_limit: usize,
    pub(super) admission_decision: SourceAcquisitionAdmissionV1,
}

/// Persistable projection of sealed Shared Time custody.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SharedTimeEvidenceBindingV1 {
    pub head_identity: String,
    pub head_digest: String,
    pub clock_identity: String,
    pub clock_epoch: String,
    pub monotonic_sequence: u64,
    pub wall_observed_epoch_ms: u64,
    pub decision_cut_epoch_ms: u64,
    pub valid_through_epoch_ms: u64,
    pub restart_continuity_digest: String,
    pub uncertainty_bound_ms: u64,
    pub skew_bound_ms: u64,
    pub comparison_rule: String,
    pub predecessor_head_digest: Option<String>,
    pub epoch_successor_proof_identity: Option<String>,
    pub successor_proof_commit_cut_epoch_ms: Option<u64>,
}

impl SharedTimeEvidenceBindingV1 {
    pub(super) fn from_sealed(
        handoff: &ClockHeadHandoff,
        successor: Option<&ClockHeadSuccessorReadback>,
    ) -> Option<Self> {
        if successor.is_some_and(|value| value.handoff() != handoff) {
            return None;
        }
        let proof = successor.and_then(ClockHeadSuccessorReadback::epoch_successor_proof);
        Some(Self {
            head_identity: digest(handoff.head_identity().as_bytes()),
            head_digest: digest(handoff.head_digest().as_bytes()),
            clock_identity: handoff.clock_identity().to_string(),
            clock_epoch: handoff.clock_epoch().to_string(),
            monotonic_sequence: handoff.monotonic_sequence(),
            wall_observed_epoch_ms: handoff.wall_observed(),
            decision_cut_epoch_ms: handoff.decision_cut(),
            valid_through_epoch_ms: handoff.valid_through(),
            restart_continuity_digest: digest(handoff.restart_continuity_digest().as_bytes()),
            uncertainty_bound_ms: handoff.uncertainty_bound(),
            skew_bound_ms: handoff.skew_bound(),
            comparison_rule: "EXCLUSIVE_VALID_THROUGH".into(),
            predecessor_head_digest: proof
                .map(|value| digest(value.predecessor_head_digest().as_bytes())),
            epoch_successor_proof_identity: proof
                .map(|value| digest(value.proof_identity().as_bytes())),
            successor_proof_commit_cut_epoch_ms: proof.map(|value| value.commit_cut()),
        })
    }
}

/// Sealed current rights, retention, and Shared Time decision consumed exactly
/// once immediately before provider invocation. It is not deserializable and
/// has no public constructor.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SourceIntakeInvocationPolicyEvidenceV1 {
    pub(super) decision_identity: String,
    pub(super) decision_digest: String,
    pub(super) rights_basis_identity: String,
    pub(super) rights_policy_version: String,
    pub(super) rights_effective_at_epoch_ms: u64,
    pub(super) rights_valid_through_epoch_ms: u64,
    pub(super) retention_policy_identity: String,
    pub(super) retention_policy_version: String,
    pub(super) retention_effective_at_epoch_ms: u64,
    pub(super) retention_valid_through_epoch_ms: u64,
    pub(super) current_time: SharedTimeEvidenceBindingV1,
    pub(super) decision: SourceAcquisitionAdmissionV1,
}

/// Sealed Shared Time observation made after the provider attempt. Terminal
/// receipts and provenance bind this value instead of reusing binding time.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SourceIntakeRetrievalTimeEvidenceV1 {
    pub(super) evidence_identity: String,
    pub(super) evidence_digest: String,
    pub(super) current_time: SharedTimeEvidenceBindingV1,
}

impl SourceIntakePolicyEvidenceV1 {
    #[allow(clippy::too_many_arguments, dead_code)]
    fn from_verified_owners(
        product_edge: &ProductEdgeAdmissionReadbackV1,
        shared_time: &ClockHeadHandoff,
        shared_time_successor: Option<&ClockHeadSuccessorReadback>,
        owner: VerifiedRdPolicyEvidenceV1,
    ) -> Option<Self> {
        let shared_time =
            SharedTimeEvidenceBindingV1::from_sealed(shared_time, shared_time_successor)?;
        Some(Self {
            policy_evidence_identity: owner.policy_evidence_identity,
            policy_evidence_digest: owner.policy_evidence_digest,
            gateway: ProductEdgeGatewayV1::WindmillProductEdge,
            admission: product_edge.locator().clone(),
            operation_manifest_identity: product_edge.manifest_identity().to_string(),
            operation_manifest_digest: product_edge.manifest_digest().to_string(),
            connector_policy_identity: owner.connector_policy_identity,
            connector_policy_version: owner.connector_policy_version,
            network_policy_identity: owner.network_policy_identity,
            network_policy_version: owner.network_policy_version,
            dns_policy_identity: owner.dns_policy_identity,
            dns_policy_version: owner.dns_policy_version,
            dns_observation_identity: owner.dns_observation_identity,
            dns_observation_digest: owner.dns_observation_digest,
            resolved_addresses: owner.resolved_addresses,
            tls_policy_identity: owner.tls_policy_identity,
            tls_policy_version: owner.tls_policy_version,
            redirect_policy_identity: owner.redirect_policy_identity,
            redirect_policy_version: owner.redirect_policy_version,
            credential_policy_identity: owner.credential_policy_identity,
            credential_handle_identity: owner.credential_handle_identity,
            credential_audience: owner.credential_audience,
            credential_scope: owner.credential_scope,
            egress_policy_identity: owner.egress_policy_identity,
            egress_policy_version: owner.egress_policy_version,
            rights_basis_identity: owner.rights_basis_identity,
            rights_policy_version: owner.rights_policy_version,
            rights_effective_at_epoch_ms: owner.rights_effective_at_epoch_ms,
            rights_valid_through_epoch_ms: owner.rights_valid_through_epoch_ms,
            acquisition_scope: owner.acquisition_scope,
            retention_policy_identity: owner.retention_policy_identity,
            retention_policy_version: owner.retention_policy_version,
            retention_effective_at_epoch_ms: owner.retention_effective_at_epoch_ms,
            retention_valid_through_epoch_ms: owner.retention_valid_through_epoch_ms,
            retention_scope: owner.retention_scope,
            shared_time,
            retry_budget: owner.retry_budget,
            redirect_hop_limit: owner.redirect_hop_limit,
            response_media_type: owner.response_media_type,
            response_byte_limit: owner.response_byte_limit,
            response_timeout_ms: owner.response_timeout_ms,
            response_header_count_limit: owner.response_header_count_limit,
            response_header_byte_limit: owner.response_header_byte_limit,
            admission_decision: owner.admission_decision,
        })
    }

    pub(super) fn admission(&self) -> &ProductEdgeAdmissionLocatorV1 {
        &self.admission
    }

    pub(super) fn manifest_identity(&self) -> &str {
        &self.operation_manifest_identity
    }

    pub(super) fn manifest_digest(&self) -> &str {
        &self.operation_manifest_digest
    }
}

impl SourceIntakeInvocationPolicyEvidenceV1 {
    pub(super) fn admits_invocation(&self) -> bool {
        self.decision == SourceAcquisitionAdmissionV1::Admitted
    }

    #[cfg(test)]
    pub fn decision_identity(&self) -> &str {
        &self.decision_identity
    }

    #[cfg(test)]
    pub fn decision_digest(&self) -> &str {
        &self.decision_digest
    }

    #[cfg(test)]
    pub fn current_time(&self) -> &SharedTimeEvidenceBindingV1 {
        &self.current_time
    }
}

impl SourceIntakeRetrievalTimeEvidenceV1 {
    pub(crate) fn current_time(&self) -> &SharedTimeEvidenceBindingV1 {
        &self.current_time
    }

    #[cfg(test)]
    pub fn evidence_identity(&self) -> &str {
        &self.evidence_identity
    }

    #[cfg(test)]
    pub fn evidence_digest(&self) -> &str {
        &self.evidence_digest
    }
}

/// Placeholder for a future R&D-owned locked-policy resolver. It is private and
/// has no constructor, keeping production composition unavailable today.
#[allow(dead_code)]
struct VerifiedRdPolicyEvidenceV1 {
    policy_evidence_identity: String,
    policy_evidence_digest: String,
    connector_policy_identity: String,
    connector_policy_version: String,
    network_policy_identity: String,
    network_policy_version: String,
    dns_policy_identity: String,
    dns_policy_version: String,
    dns_observation_identity: String,
    dns_observation_digest: String,
    resolved_addresses: Vec<IpAddr>,
    tls_policy_identity: String,
    tls_policy_version: String,
    redirect_policy_identity: String,
    redirect_policy_version: String,
    credential_policy_identity: String,
    credential_handle_identity: String,
    credential_audience: String,
    credential_scope: String,
    egress_policy_identity: String,
    egress_policy_version: String,
    rights_basis_identity: String,
    rights_policy_version: String,
    rights_effective_at_epoch_ms: u64,
    rights_valid_through_epoch_ms: u64,
    acquisition_scope: String,
    retention_policy_identity: String,
    retention_policy_version: String,
    retention_effective_at_epoch_ms: u64,
    retention_valid_through_epoch_ms: u64,
    retention_scope: String,
    retry_budget: u8,
    redirect_hop_limit: u8,
    response_media_type: String,
    response_byte_limit: usize,
    response_timeout_ms: u64,
    response_header_count_limit: usize,
    response_header_byte_limit: usize,
    admission_decision: SourceAcquisitionAdmissionV1,
}

fn digest(bytes: &[u8; 32]) -> String {
    format!("sha256:{}", super::hex::encode(bytes))
}

#[cfg(any(test, feature = "sealed-source-intake-acceptance"))]
fn advance_fixture_time(
    mut current_time: SharedTimeEvidenceBindingV1,
    head_identity: &str,
    head_digest: &str,
    decision_cut_epoch_ms: u64,
) -> SharedTimeEvidenceBindingV1 {
    current_time.head_identity = head_identity.into();
    current_time.head_digest = head_digest.into();
    current_time.monotonic_sequence += 1;
    current_time.wall_observed_epoch_ms = decision_cut_epoch_ms;
    current_time.decision_cut_epoch_ms = decision_cut_epoch_ms;
    current_time.valid_through_epoch_ms = decision_cut_epoch_ms + 30_000;
    current_time
}

#[cfg(any(test, feature = "sealed-source-intake-acceptance"))]
impl SourceIntakePolicyEvidenceV1 {
    pub(crate) fn fixture(
        request: &super::OpenAlexWorkByDoiRequestV1,
        resolved_addresses: Vec<IpAddr>,
        retry_budget: u8,
        redirect_hop_limit: u8,
        response_byte_limit: usize,
        response_timeout_ms: u64,
        admission_decision: SourceAcquisitionAdmissionV1,
    ) -> Self {
        Self {
            policy_evidence_identity: "source-policy-evidence-001".into(),
            policy_evidence_digest:
                "sha256:1111111111111111111111111111111111111111111111111111111111111111".into(),
            gateway: ProductEdgeGatewayV1::WindmillProductEdge,
            admission: request.admission.clone(),
            operation_manifest_identity: request.operation_manifest_identity.clone(),
            operation_manifest_digest: request.operation_manifest_digest.clone(),
            connector_policy_identity: "openalex-connector-policy-001".into(),
            connector_policy_version: "v1".into(),
            network_policy_identity: "source-network-policy-001".into(),
            network_policy_version: "v1".into(),
            dns_policy_identity: "source-dns-policy-001".into(),
            dns_policy_version: "v1".into(),
            dns_observation_identity: "source-dns-observation-001".into(),
            dns_observation_digest:
                "sha256:3333333333333333333333333333333333333333333333333333333333333333".into(),
            resolved_addresses,
            tls_policy_identity: "rustls-only-policy-001".into(),
            tls_policy_version: "v1".into(),
            redirect_policy_identity: "no-redirect-policy-001".into(),
            redirect_policy_version: "v1".into(),
            credential_policy_identity: "public-metadata-credential-policy-001".into(),
            credential_handle_identity: "NO_CREDENTIAL".into(),
            credential_audience: "OPENALEX_PUBLIC_METADATA".into(),
            credential_scope: "PUBLIC_METADATA_READ_ONLY".into(),
            egress_policy_identity: "source-egress-policy-001".into(),
            egress_policy_version: "v1".into(),
            rights_basis_identity: "rights-metadata-retention-001".into(),
            rights_policy_version: "v1".into(),
            rights_effective_at_epoch_ms: 1_800_000_000_000,
            rights_valid_through_epoch_ms: 1_800_000_060_000,
            acquisition_scope: "OPENALEX_METADATA".into(),
            retention_policy_identity: "retention-policy-001".into(),
            retention_policy_version: "v1".into(),
            retention_effective_at_epoch_ms: 1_800_000_000_000,
            retention_valid_through_epoch_ms: 1_900_000_000_000,
            retention_scope: "R_AND_D_SOURCE_METADATA".into(),
            shared_time: SharedTimeEvidenceBindingV1 {
                head_identity:
                    "sha256:4444444444444444444444444444444444444444444444444444444444444444".into(),
                head_digest:
                    "sha256:5555555555555555555555555555555555555555555555555555555555555555".into(),
                clock_identity: "market-data-shared-time".into(),
                clock_epoch: "epoch-001".into(),
                monotonic_sequence: 1,
                wall_observed_epoch_ms: 1_800_000_000_000,
                decision_cut_epoch_ms: 1_800_000_000_000,
                valid_through_epoch_ms: 1_800_000_060_000,
                restart_continuity_digest:
                    "sha256:6666666666666666666666666666666666666666666666666666666666666666".into(),
                uncertainty_bound_ms: 100,
                skew_bound_ms: 100,
                comparison_rule: "EXCLUSIVE_VALID_THROUGH".into(),
                predecessor_head_digest: None,
                epoch_successor_proof_identity: None,
                successor_proof_commit_cut_epoch_ms: None,
            },
            retry_budget,
            redirect_hop_limit,
            response_media_type: "application/json".into(),
            response_byte_limit,
            response_timeout_ms,
            response_header_count_limit: super::openalex_http::MAX_HEADER_COUNT,
            response_header_byte_limit: super::openalex_http::MAX_HEADER_BYTES,
            admission_decision,
        }
    }
}

#[cfg(any(test, feature = "sealed-source-intake-acceptance"))]
impl SourceIntakeInvocationPolicyEvidenceV1 {
    pub(crate) fn fixture(
        binding: &super::SourceAcquisitionBindingV1,
        decision_cut_epoch_ms: u64,
        decision: SourceAcquisitionAdmissionV1,
    ) -> Self {
        let current_time = advance_fixture_time(
            binding.shared_time.clone(),
            "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            "sha256:7777777777777777777777777777777777777777777777777777777777777777",
            decision_cut_epoch_ms,
        );
        Self {
            decision_identity: "source-invocation-policy-decision-001".into(),
            decision_digest:
                "sha256:8888888888888888888888888888888888888888888888888888888888888888".into(),
            rights_basis_identity: binding.rights_basis_identity.clone(),
            rights_policy_version: binding.rights_policy_version.clone(),
            rights_effective_at_epoch_ms: binding.rights_effective_at_epoch_ms,
            rights_valid_through_epoch_ms: binding.rights_valid_through_epoch_ms,
            retention_policy_identity: binding.retention_policy_identity.clone(),
            retention_policy_version: binding.retention_policy_version.clone(),
            retention_effective_at_epoch_ms: binding.retention_effective_at_epoch_ms,
            retention_valid_through_epoch_ms: binding.retention_valid_through_epoch_ms,
            current_time,
            decision,
        }
    }
}

#[cfg(any(test, feature = "sealed-source-intake-acceptance"))]
impl SourceIntakeRetrievalTimeEvidenceV1 {
    #[cfg(test)]
    pub(crate) fn from_receipt_fixture(receipt: &super::SourceAcquisitionReceiptV1) -> Self {
        Self {
            evidence_identity: receipt.retrieval_time_evidence_identity.clone(),
            evidence_digest: receipt.retrieval_time_evidence_digest.clone(),
            current_time: receipt.retrieval_time.clone(),
        }
    }

    pub(crate) fn fixture(
        revalidation: &SourceIntakeInvocationPolicyEvidenceV1,
        decision_cut_epoch_ms: u64,
    ) -> Self {
        let current_time = advance_fixture_time(
            revalidation.current_time.clone(),
            "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
            "sha256:9999999999999999999999999999999999999999999999999999999999999999",
            decision_cut_epoch_ms,
        );
        Self {
            evidence_identity: "source-retrieval-time-evidence-001".into(),
            evidence_digest:
                "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".into(),
            current_time,
        }
    }
}

#[cfg(test)]
mod tests {
    use std::net::{IpAddr, Ipv4Addr};

    use rstest::rstest;

    use super::*;
    use crate::source_intake::{
        AcquisitionTerminalV1, MAX_RESPONSE_BYTES, OpenAlexWorkByDoiRequestV1,
        ProductEdgeAdmissionLocatorV1, SourceAcquisitionReceiptV1, SourceIntakeAttemptV1,
    };

    fn public_digest(value: &str) -> bool {
        value.strip_prefix("sha256:").is_some_and(|hex| {
            hex.len() == 64
                && hex
                    .bytes()
                    .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        })
    }

    #[rstest]
    fn sealed_receipt_time_head_identities_follow_public_digest_grammar() {
        let request = OpenAlexWorkByDoiRequestV1 {
            request_identity: "source-request-001".into(),
            gateway: ProductEdgeGatewayV1::WindmillProductEdge,
            admission: ProductEdgeAdmissionLocatorV1 {
                request_identity: "source-request-001".into(),
                admission_identity: "product-edge-admission-001".into(),
                admission_digest:
                    "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".into(),
            },
            operation_manifest_identity: "operation-manifest-001".into(),
            operation_manifest_digest:
                "sha256:2222222222222222222222222222222222222222222222222222222222222222".into(),
            normalized_doi: "10.1234/source-intake".into(),
        };
        let evidence = SourceIntakePolicyEvidenceV1::fixture(
            &request,
            vec![IpAddr::V4(Ipv4Addr::new(8, 8, 8, 8))],
            0,
            0,
            MAX_RESPONSE_BYTES,
            5_000,
            SourceAcquisitionAdmissionV1::Admitted,
        );
        let attempt = SourceIntakeAttemptV1::close_binding(request, evidence)
            .expect("sealed fixture binding closes");
        let binding_time = attempt.binding().shared_time.clone();
        let policy = SourceIntakeInvocationPolicyEvidenceV1::fixture(
            attempt.binding(),
            binding_time.decision_cut_epoch_ms + 1,
            SourceAcquisitionAdmissionV1::Admitted,
        );
        let retrieval = SourceIntakeRetrievalTimeEvidenceV1::fixture(
            &policy,
            policy.current_time.decision_cut_epoch_ms + 1,
        );
        let policy_time = policy.current_time;
        let retrieval_time = retrieval.current_time;
        let receipt = SourceAcquisitionReceiptV1 {
            schema_version: 1,
            receipt_identity: "receipt-001".into(),
            request_identity: "request-001".into(),
            binding_identity: "binding-001".into(),
            attempt_identity: "attempt-001".into(),
            invocation_identity: Some("invocation-001".into()),
            terminal: AcquisitionTerminalV1::Retrieved,
            terminal_evidence_identity: "terminal-evidence-001".into(),
            terminal_evidence_digest:
                "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".into(),
            policy_decision_identity: "policy-decision-001".into(),
            policy_decision_digest:
                "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd".into(),
            policy_decision_time: policy_time.clone(),
            response_status: Some(200),
            response_header_digest: None,
            connected_address: None,
            response_media_type: Some("application/json".into()),
            response_size_bytes: Some(1),
            content_digest: Some(
                "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee".into(),
            ),
            retrieval_time_evidence_identity: "retrieval-time-evidence-001".into(),
            retrieval_time_evidence_digest:
                "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff".into(),
            retrieval_time: retrieval_time.clone(),
            committed_at_epoch_ms: retrieval_time.decision_cut_epoch_ms,
        };

        let serialized = serde_json::to_value(receipt).expect("receipt serializes");
        let policy_identity = serialized["policy_decision_time"]["head_identity"]
            .as_str()
            .expect("policy time head identity is serialized");
        let retrieval_identity = serialized["retrieval_time"]["head_identity"]
            .as_str()
            .expect("retrieval time head identity is serialized");

        assert!(public_digest(policy_identity));
        assert!(public_digest(retrieval_identity));
        assert_ne!(binding_time.head_identity, policy_identity);
        assert_ne!(policy_identity, retrieval_identity);
        assert_ne!(binding_time.head_digest, policy_time.head_digest);
        assert_ne!(policy_time.head_digest, retrieval_time.head_digest);
        assert_ne!(policy_time.head_identity, policy_time.head_digest);
        assert_ne!(retrieval_time.head_identity, retrieval_time.head_digest);
        assert!(binding_time.monotonic_sequence < policy_time.monotonic_sequence);
        assert!(policy_time.monotonic_sequence < retrieval_time.monotonic_sequence);
        assert!(binding_time.decision_cut_epoch_ms < policy_time.decision_cut_epoch_ms);
        assert!(policy_time.decision_cut_epoch_ms < retrieval_time.decision_cut_epoch_ms);
    }
}
