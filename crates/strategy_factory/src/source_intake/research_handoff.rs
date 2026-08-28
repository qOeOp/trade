//! Crate-local Source Intake-to-Research ancestry acceptance seam.
//!
//! Both the in-process Owner and the durable PostgreSQL adapter feed the same
//! validator. Only the durable adapter can construct the transaction-locked
//! capability used by the Source Intake-to-Research operation.

use serde::{Deserialize, Serialize};
use thiserror::Error;

#[cfg(feature = "sealed-source-intake-research-acceptance")]
use std::net::{IpAddr, Ipv4Addr};

use super::{
    AcquisitionTerminalV1, OpenAlexWorkByDoiRequestV1, ResearchSourceProvenanceV1,
    SharedTimeEvidenceBindingV1, SourceAcquisitionAdmissionV1, SourceAcquisitionBindingV1,
    SourceAcquisitionReceiptV1, SourceCandidateV1, SourceIntakeAttemptV1, SourceIntakeOutboxV1,
    SourceIntakePolicyEvidenceV1, SourceIntakeStateV1, domain_identity, interpretation_digest,
    openalex_http, source_acquisition_receipt_content_address_matches, validate_current_policy,
    validate_digest, validate_identity, validate_retrieval_time,
};

#[cfg(feature = "sealed-source-intake-research-acceptance")]
use super::{
    ProductEdgeGatewayV1, SourceIntakePolicyEvidencePort, SourceIntakePolicyEvidenceQueryV1,
    SourceIntakePolicyEvidenceResultV1,
};

#[cfg(feature = "sealed-source-intake-research-acceptance")]
#[allow(dead_code)]
const SEALED_CONNECTOR_POLICY_LOCATOR: &str = "sealed-source-intake-connector-policy-v1";
#[cfg(feature = "sealed-source-intake-research-acceptance")]
#[allow(dead_code)]
const SEALED_NETWORK_POLICY_LOCATOR: &str = "sealed-source-intake-network-policy-v1";
#[cfg(feature = "sealed-source-intake-research-acceptance")]
#[allow(dead_code)]
const SEALED_RIGHTS_POLICY_LOCATOR: &str = "sealed-source-intake-rights-policy-v1";
#[cfg(feature = "sealed-source-intake-research-acceptance")]
#[allow(dead_code)]
const SEALED_RETENTION_POLICY_LOCATOR: &str = "sealed-source-intake-retention-policy-v1";
#[cfg(feature = "sealed-source-intake-research-acceptance")]
#[allow(dead_code)]
const SEALED_DNS_OBSERVATION_LOCATOR: &str = "sealed-source-intake-dns-observation-v1";

/// Fixed, compile-time-only current-policy resolver for the disposable sealed
/// Source Intake-to-Research acceptance. It has no provider, DSN, environment,
/// or evidence injection surface.
#[cfg(feature = "sealed-source-intake-research-acceptance")]
#[derive(Debug, Default)]
#[allow(dead_code)]
pub(crate) struct SealedSourceIntakeResearchPolicyV1;

#[cfg(feature = "sealed-source-intake-research-acceptance")]
#[async_trait::async_trait]
impl SourceIntakePolicyEvidencePort for SealedSourceIntakeResearchPolicyV1 {
    async fn resolve_source_intake_policy_evidence(
        &self,
        query: &SourceIntakePolicyEvidenceQueryV1,
    ) -> SourceIntakePolicyEvidenceResultV1 {
        if query.gateway != ProductEdgeGatewayV1::WindmillProductEdge
            || query.request_identity != query.admission.request_identity
            || query.connector_policy_locator != SEALED_CONNECTOR_POLICY_LOCATOR
            || query.network_policy_locator != SEALED_NETWORK_POLICY_LOCATOR
            || query.rights_policy_locator != SEALED_RIGHTS_POLICY_LOCATOR
            || query.retention_policy_locator != SEALED_RETENTION_POLICY_LOCATOR
            || query.dns_observation_locator != SEALED_DNS_OBSERVATION_LOCATOR
            || query.shared_time_successor.is_some()
        {
            return SourceIntakePolicyEvidenceResultV1::Unavailable {
                reason: super::SourceIntakePolicyUnavailableReasonV1::EvidenceMismatch,
            };
        }
        let request = OpenAlexWorkByDoiRequestV1 {
            request_identity: query.request_identity.clone(),
            gateway: query.gateway,
            admission: query.admission.clone(),
            operation_manifest_identity: query.operation_manifest_identity.clone(),
            operation_manifest_digest: query.operation_manifest_digest.clone(),
            normalized_doi: "10.5555/sealed-success".into(),
        };
        let mut evidence = SourceIntakePolicyEvidenceV1::fixture(
            &request,
            vec![IpAddr::V4(Ipv4Addr::new(1, 1, 1, 1))],
            0,
            0,
            openalex_http::MAX_RESPONSE_BYTES,
            5_000,
            SourceAcquisitionAdmissionV1::Admitted,
        );
        evidence.shared_time.head_identity = format!("sha256:{}", "d".repeat(64));
        evidence.shared_time.head_digest = format!("sha256:{}", "e".repeat(64));
        evidence.shared_time.monotonic_sequence = 4;
        evidence.shared_time.wall_observed_epoch_ms = 1_800_000_000_003;
        evidence.shared_time.decision_cut_epoch_ms = 1_800_000_000_003;
        evidence.shared_time.valid_through_epoch_ms = 1_800_000_030_003;
        SourceIntakePolicyEvidenceResultV1::Sealed {
            evidence: Box::new(evidence),
        }
    }
}

const RETRIEVED_EVENT_KIND_V1: &str = "SOURCE_INTAKE_TERMINATED_V1";
const UNTRUSTED_SOURCE_CLASS_V1: &str = "UNTRUSTED_EXTERNAL_DATA";

/// An untrusted exact locator for one Source Intake terminal attempt.
///
/// It contains no receipt, provenance, source, policy, rights, or repair
/// fields. Those members must be locked and reread from Source Intake Owner
/// custody by the crate-private sealing seam.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SourceIntakeResearchAncestryProposalV1 {
    pub request_identity: String,
    pub attempt_identity: String,
    pub terminal_receipt_identity: String,
}

/// Opaque positive ancestry evidence. It is neither cloneable nor
/// serializable/deserializable and contains no raw source bytes.
pub struct VerifiedSourceIntakeResearchAncestryV1 {
    evidence_identity: String,
    attempt_identity: String,
    terminal_receipt_identity: String,
    candidate_identity: String,
    #[allow(
        dead_code,
        reason = "standalone Source Intake harness does not compile the Product Edge assembly owner"
    )]
    research_source: VerifiedResearchSourceProjectionV1,
}

#[allow(
    dead_code,
    reason = "standalone Source Intake harness does not compile the Product Edge assembly owner"
)]
pub(crate) struct VerifiedResearchSourceProjectionV1 {
    pub(crate) locator: String,
    pub(crate) content_digest: String,
    pub(crate) observed_at: String,
    pub(crate) source_cut: String,
    pub(crate) license_basis: String,
    pub(crate) interpretation: String,
}

impl VerifiedSourceIntakeResearchAncestryV1 {
    pub fn evidence_identity(&self) -> &str {
        &self.evidence_identity
    }

    pub fn attempt_identity(&self) -> &str {
        &self.attempt_identity
    }

    pub fn terminal_receipt_identity(&self) -> &str {
        &self.terminal_receipt_identity
    }

    pub fn candidate_identity(&self) -> &str {
        &self.candidate_identity
    }

    #[allow(
        dead_code,
        reason = "standalone Source Intake harness does not compile the Product Edge assembly owner"
    )]
    pub(crate) fn into_research_source_projection(self) -> VerifiedResearchSourceProjectionV1 {
        self.research_source
    }
}

#[cfg(test)]
#[allow(
    dead_code,
    reason = "standalone Source Intake harness has no Product Edge assembly consumer"
)]
pub(crate) fn verified_research_ancestry_fixture()
-> (VerifiedSourceIntakeResearchAncestryV1, String) {
    tests::verified_research_ancestry_fixture()
}

#[allow(
    dead_code,
    reason = "standalone Source Intake harness has no durable Research operation consumer"
)]
#[derive(Debug, Error, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SourceIntakeResearchHandoffErrorV1 {
    #[error("Source Intake ancestry reference is invalid")]
    InvalidReference,
    #[error("Source Intake ancestry member is missing or mismatched")]
    AncestryMismatch,
    #[error("Source Intake ancestry terminal is not RETRIEVED")]
    NotRetrieved,
    #[error("Source Intake ancestry is stale at the verified R&D time cut")]
    Stale,
    #[error("Source Intake ancestry serialization failed")]
    Serialization,
    #[error("Source Intake ancestry Owner custody is unavailable")]
    OwnerUnavailable,
}

/// Deterministic preparation evidence from a canonical Owner peek. It is a
/// copied projection and deliberately has no operation that can mint ancestry.
pub(crate) struct PeekedSourceIntakeResearchHandoffV1 {
    evidence_digest: String,
    research_source: VerifiedResearchSourceProjectionV1,
}

impl PeekedSourceIntakeResearchHandoffV1 {
    pub(crate) fn into_research_source_fields(
        self,
    ) -> (String, String, String, String, String, String, String) {
        (
            self.evidence_digest,
            self.research_source.locator,
            self.research_source.content_digest,
            self.research_source.observed_at,
            self.research_source.source_cut,
            self.research_source.license_basis,
            self.research_source.interpretation,
        )
    }
}

/// Move-only capability constructed only after the durable Owner rows have
/// been transaction-locked and revalidated.
pub(crate) struct LockedSourceIntakeResearchHandoffV1 {
    proposal: SourceIntakeResearchAncestryProposalV1,
    snapshot: DurableSourceIntakeResearchSnapshotV1,
    verification_policy: SourceIntakePolicyEvidenceV1,
    evidence_digest: String,
}

impl LockedSourceIntakeResearchHandoffV1 {
    pub(crate) fn mint(
        self,
    ) -> Result<VerifiedSourceIntakeResearchAncestryV1, SourceIntakeResearchHandoffErrorV1> {
        let verified = seal_source_intake_research_ancestry(
            &self.proposal,
            self.snapshot.reread(self.verification_policy),
        )?;

        if verified.evidence_identity != self.evidence_digest {
            return Err(SourceIntakeResearchHandoffErrorV1::AncestryMismatch);
        }
        Ok(verified)
    }
}

pub(super) struct DurableSourceIntakeResearchSnapshotV1 {
    pub(super) request: OpenAlexWorkByDoiRequestV1,
    pub(super) binding: SourceAcquisitionBindingV1,
    pub(super) receipt: SourceAcquisitionReceiptV1,
    pub(super) provenance: ResearchSourceProvenanceV1,
    pub(super) candidate: SourceCandidateV1,
    pub(super) transition: SourceIntakeOutboxV1,
}

impl DurableSourceIntakeResearchSnapshotV1 {
    fn reread(
        &self,
        verification_policy: SourceIntakePolicyEvidenceV1,
    ) -> SourceIntakeResearchOwnerRereadV1<'_> {
        SourceIntakeResearchOwnerRereadV1 {
            binding: &self.binding,
            receipt: &self.receipt,
            provenance: &self.provenance,
            candidate: &self.candidate,
            transition: &self.transition,
            verification_policy,
        }
    }
}

pub(super) fn peek_durable_source_intake_research_handoff_v1(
    proposal: &SourceIntakeResearchAncestryProposalV1,
    snapshot: &DurableSourceIntakeResearchSnapshotV1,
    verification_policy: SourceIntakePolicyEvidenceV1,
) -> Result<PeekedSourceIntakeResearchHandoffV1, SourceIntakeResearchHandoffErrorV1> {
    verify_current_owner_policy(
        &snapshot.request,
        &snapshot.binding,
        &snapshot.provenance,
        &snapshot.receipt,
        &verification_policy,
    )?;
    let (evidence_digest, research_source) =
        validated_ancestry_parts(proposal, snapshot.reread(verification_policy))?;
    Ok(PeekedSourceIntakeResearchHandoffV1 {
        evidence_digest,
        research_source,
    })
}

pub(super) fn lock_durable_source_intake_research_handoff_v1(
    proposal: SourceIntakeResearchAncestryProposalV1,
    snapshot: DurableSourceIntakeResearchSnapshotV1,
    verification_policy: SourceIntakePolicyEvidenceV1,
    expected_evidence_digest: &str,
) -> Result<LockedSourceIntakeResearchHandoffV1, SourceIntakeResearchHandoffErrorV1> {
    verify_current_owner_policy(
        &snapshot.request,
        &snapshot.binding,
        &snapshot.provenance,
        &snapshot.receipt,
        &verification_policy,
    )?;
    let (evidence_digest, _) =
        validated_ancestry_parts(&proposal, snapshot.reread(verification_policy.clone()))?;

    if evidence_digest != expected_evidence_digest {
        return Err(SourceIntakeResearchHandoffErrorV1::AncestryMismatch);
    }
    Ok(LockedSourceIntakeResearchHandoffV1 {
        proposal,
        snapshot,
        verification_policy,
        evidence_digest,
    })
}

struct SourceIntakeResearchOwnerRereadV1<'a> {
    binding: &'a SourceAcquisitionBindingV1,
    receipt: &'a SourceAcquisitionReceiptV1,
    provenance: &'a ResearchSourceProvenanceV1,
    candidate: &'a SourceCandidateV1,
    transition: &'a SourceIntakeOutboxV1,
    verification_policy: SourceIntakePolicyEvidenceV1,
}

impl SourceIntakeAttemptV1 {
    /// Seal ancestry only from this terminal Owner's private committed state.
    /// No copied public member projection can construct the reread capability.
    #[allow(
        dead_code,
        reason = "PARTIAL Source Intake ancestry awaits a durable Owner reread adapter"
    )]
    pub(super) fn seal_research_ancestry(
        &self,
        proposal: &SourceIntakeResearchAncestryProposalV1,
        verification_policy: SourceIntakePolicyEvidenceV1,
    ) -> Result<VerifiedSourceIntakeResearchAncestryV1, SourceIntakeResearchHandoffErrorV1> {
        let reread = SourceIntakeResearchOwnerRereadV1::from_attempt(self, verification_policy)?;
        seal_source_intake_research_ancestry(proposal, reread)
    }
}

impl<'a> SourceIntakeResearchOwnerRereadV1<'a> {
    fn from_attempt(
        attempt: &'a SourceIntakeAttemptV1,
        verification_policy: SourceIntakePolicyEvidenceV1,
    ) -> Result<Self, SourceIntakeResearchHandoffErrorV1> {
        let commit = attempt
            .terminal_commit
            .as_ref()
            .ok_or(SourceIntakeResearchHandoffErrorV1::AncestryMismatch)?;
        let receipt = commit
            .public
            .receipt
            .as_ref()
            .ok_or(SourceIntakeResearchHandoffErrorV1::AncestryMismatch)?;
        let invocation_policy = attempt
            .current_policy
            .as_ref()
            .ok_or(SourceIntakeResearchHandoffErrorV1::AncestryMismatch)?;
        let provenance = commit
            .provenance
            .as_ref()
            .ok_or(SourceIntakeResearchHandoffErrorV1::AncestryMismatch)?;
        let candidate = commit
            .candidate
            .as_ref()
            .ok_or(SourceIntakeResearchHandoffErrorV1::AncestryMismatch)?;
        let transition = commit
            .outbox
            .as_ref()
            .ok_or(SourceIntakeResearchHandoffErrorV1::AncestryMismatch)?;

        if attempt.state != SourceIntakeStateV1::Terminal
            || receipt.policy_decision_identity != invocation_policy.decision_identity
            || receipt.policy_decision_digest != invocation_policy.decision_digest
            || receipt.policy_decision_time != invocation_policy.current_time
            || receipt.retrieval_time_evidence_identity
                != commit.retrieval_time_evidence.evidence_identity
            || receipt.retrieval_time_evidence_digest
                != commit.retrieval_time_evidence.evidence_digest
            || receipt.retrieval_time != commit.retrieval_time_evidence.current_time
        {
            return Err(SourceIntakeResearchHandoffErrorV1::AncestryMismatch);
        }
        validate_current_policy(&attempt.binding, invocation_policy)
            .map_err(|_| SourceIntakeResearchHandoffErrorV1::AncestryMismatch)?;
        validate_retrieval_time(invocation_policy, &commit.retrieval_time_evidence)
            .map_err(|_| SourceIntakeResearchHandoffErrorV1::AncestryMismatch)?;
        verify_current_owner_policy(
            &attempt.request,
            &attempt.binding,
            provenance,
            receipt,
            &verification_policy,
        )?;

        Ok(Self {
            binding: &attempt.binding,
            receipt,
            provenance,
            candidate,
            transition,
            verification_policy,
        })
    }
}

fn seal_source_intake_research_ancestry(
    proposal: &SourceIntakeResearchAncestryProposalV1,
    reread: SourceIntakeResearchOwnerRereadV1<'_>,
) -> Result<VerifiedSourceIntakeResearchAncestryV1, SourceIntakeResearchHandoffErrorV1> {
    let attempt_identity = proposal.attempt_identity.clone();
    let terminal_receipt_identity = proposal.terminal_receipt_identity.clone();
    let candidate_identity = reread.candidate.candidate_identity.clone();
    let (evidence_identity, research_source) = validated_ancestry_parts(proposal, reread)?;

    Ok(VerifiedSourceIntakeResearchAncestryV1 {
        evidence_identity,
        attempt_identity,
        terminal_receipt_identity,
        candidate_identity,
        research_source,
    })
}

fn validated_ancestry_parts(
    proposal: &SourceIntakeResearchAncestryProposalV1,
    reread: SourceIntakeResearchOwnerRereadV1<'_>,
) -> Result<(String, VerifiedResearchSourceProjectionV1), SourceIntakeResearchHandoffErrorV1> {
    let SourceIntakeResearchOwnerRereadV1 {
        binding,
        receipt,
        provenance,
        candidate,
        transition,
        verification_policy,
    } = reread;
    verify_reference(proposal)?;
    verify_binding_and_receipt(proposal, binding, receipt)?;
    verify_time_lineage(
        binding,
        receipt,
        provenance,
        &verification_policy.shared_time,
    )?;
    verify_provenance(binding, receipt, provenance)?;
    verify_candidate(provenance, candidate)?;
    verify_transition(receipt, provenance, candidate, transition)?;

    let evidence_identity = ancestry_evidence_identity(
        proposal,
        binding,
        receipt,
        provenance,
        candidate,
        transition,
        &verification_policy,
    )?;
    let doi = provenance
        .canonical_source_identity
        .strip_prefix("doi:")
        .ok_or(SourceIntakeResearchHandoffErrorV1::AncestryMismatch)?;
    let research_source = VerifiedResearchSourceProjectionV1 {
        locator: format!("urn:doi:{doi}"),
        content_digest: provenance.content_digest.clone(),
        observed_at: format!(
            "epoch-ms:{}",
            provenance.retrieval_time.decision_cut_epoch_ms
        ),
        source_cut: evidence_identity.clone(),
        license_basis: provenance.license_basis.clone(),
        interpretation: provenance.interpretation.bounded_explanation.clone(),
    };

    Ok((evidence_identity, research_source))
}

fn verify_current_owner_policy(
    request: &OpenAlexWorkByDoiRequestV1,
    binding: &SourceAcquisitionBindingV1,
    provenance: &ResearchSourceProvenanceV1,
    receipt: &SourceAcquisitionReceiptV1,
    verification_policy: &SourceIntakePolicyEvidenceV1,
) -> Result<(), SourceIntakeResearchHandoffErrorV1> {
    validate_identity(
        "verification_policy_identity",
        &verification_policy.policy_evidence_identity,
    )
    .map_err(|_| SourceIntakeResearchHandoffErrorV1::AncestryMismatch)?;
    validate_digest(
        "verification_policy_digest",
        &verification_policy.policy_evidence_digest,
    )
    .map_err(|_| SourceIntakeResearchHandoffErrorV1::AncestryMismatch)?;
    let cut = verification_policy.shared_time.decision_cut_epoch_ms;
    if cut >= verification_policy.rights_valid_through_epoch_ms
        || cut >= verification_policy.retention_valid_through_epoch_ms
    {
        return Err(SourceIntakeResearchHandoffErrorV1::Stale);
    }
    let current = openalex_http::build_binding(request, verification_policy.clone())
        .map_err(|_| SourceIntakeResearchHandoffErrorV1::AncestryMismatch)?;
    #[cfg(feature = "sealed-source-intake-research-acceptance")]
    let current = {
        let mut current = current;

        if binding.authority.authority_class
            == super::SourceAcquisitionAuthorityClassV1::SealedAcceptance
        {
            bind_sealed_acceptance_current_policy(&mut current);
        }
        current
    };

    if current.admission != SourceAcquisitionAdmissionV1::Admitted
        || current.authority != binding.authority
        || current.gateway != binding.gateway
        || current.product_edge_admission != binding.product_edge_admission
        || current.operation_manifest_identity != binding.operation_manifest_identity
        || current.operation_manifest_digest != binding.operation_manifest_digest
        || current.connector_identity != binding.connector_identity
        || current.connector_version != binding.connector_version
        || current.rights_basis_identity != binding.rights_basis_identity
        || current.rights_policy_version != binding.rights_policy_version
        || current.acquisition_scope != binding.acquisition_scope
        || current.retention_policy_identity != binding.retention_policy_identity
        || current.retention_policy_version != binding.retention_policy_version
        || current.retention_scope != binding.retention_scope
        || current.rights_basis_identity != provenance.rights_basis_identity
        || current.rights_policy_version != provenance.rights_policy_version
        || current.acquisition_scope != provenance.acquisition_scope
        || current.retention_policy_identity != provenance.retention_policy_identity
        || current.retention_policy_version != provenance.retention_policy_version
        || current.retention_scope != provenance.retention_scope
        || current.rights_basis_identity != provenance.license_basis
        || !same_epoch_successor(&receipt.retrieval_time, &current.shared_time, true)
    {
        return Err(SourceIntakeResearchHandoffErrorV1::AncestryMismatch);
    }
    Ok(())
}

#[cfg(feature = "sealed-source-intake-research-acceptance")]
fn bind_sealed_acceptance_current_policy(current: &mut SourceAcquisitionBindingV1) {
    current.authority = super::SourceAcquisitionAuthorityBindingV1 {
        authority_class: super::SourceAcquisitionAuthorityClassV1::SealedAcceptance,
        environment_identity: "source-intake-sealed-acceptance-environment-v1".into(),
        provider_profile_digest:
            "sha256:20e4901e7b97516edbaa744c0e866b0c509595386357c1b973e48beac1657f15".into(),
        fixture_corpus_digest: Some(
            "sha256:b8cf806629fbb7baa2e38707b4d246a17e44d9841509701530cbd97558ddad18".into(),
        ),
    };
    current.connector_identity = "rd.openalex-work-by-doi.sealed-acceptance".into();
}

fn verify_reference(
    proposal: &SourceIntakeResearchAncestryProposalV1,
) -> Result<(), SourceIntakeResearchHandoffErrorV1> {
    for value in [
        &proposal.request_identity,
        &proposal.attempt_identity,
        &proposal.terminal_receipt_identity,
    ] {
        if value.is_empty() || value.len() > 192 || value.chars().any(char::is_control) {
            return Err(SourceIntakeResearchHandoffErrorV1::InvalidReference);
        }
    }
    Ok(())
}

fn verify_binding_and_receipt(
    proposal: &SourceIntakeResearchAncestryProposalV1,
    binding: &SourceAcquisitionBindingV1,
    receipt: &SourceAcquisitionReceiptV1,
) -> Result<(), SourceIntakeResearchHandoffErrorV1> {
    let (binding_digest, binding_identity) = openalex_http::binding_content_address(binding)
        .map_err(|_| SourceIntakeResearchHandoffErrorV1::AncestryMismatch)?;

    if binding.schema_version != 1
        || binding.admission != SourceAcquisitionAdmissionV1::Admitted
        || binding.binding_digest != binding_digest
        || binding.binding_identity != binding_identity
        || proposal.request_identity != binding.request_identity
        || proposal.attempt_identity != binding.binding_identity
        || receipt.schema_version != 1
        || receipt.request_identity != proposal.request_identity
        || receipt.binding_identity != proposal.attempt_identity
        || receipt.attempt_identity != proposal.attempt_identity
        || receipt.receipt_identity != proposal.terminal_receipt_identity
        || !source_acquisition_receipt_content_address_matches(receipt)
        || receipt
            .invocation_identity
            .as_deref()
            .is_none_or(str::is_empty)
        || receipt.response_status != Some(200)
        || receipt.content_digest.as_deref().is_none_or(str::is_empty)
    {
        return Err(SourceIntakeResearchHandoffErrorV1::AncestryMismatch);
    }

    if receipt.terminal != AcquisitionTerminalV1::Retrieved {
        return Err(SourceIntakeResearchHandoffErrorV1::NotRetrieved);
    }
    Ok(())
}

fn verify_time_lineage(
    binding: &SourceAcquisitionBindingV1,
    receipt: &SourceAcquisitionReceiptV1,
    provenance: &ResearchSourceProvenanceV1,
    verification_time: &SharedTimeEvidenceBindingV1,
) -> Result<(), SourceIntakeResearchHandoffErrorV1> {
    let policy = &receipt.policy_decision_time;
    let retrieval = &receipt.retrieval_time;
    if !same_epoch_successor(&binding.shared_time, policy, true)
        || !same_epoch_successor(policy, retrieval, false)
        || !same_epoch_successor(retrieval, verification_time, true)
        || verification_time.decision_cut_epoch_ms >= provenance.valid_through_epoch_ms
        || provenance.retrieval_time != *retrieval
        || provenance.valid_through_epoch_ms != retrieval.valid_through_epoch_ms
    {
        return Err(SourceIntakeResearchHandoffErrorV1::Stale);
    }
    Ok(())
}

fn same_epoch_successor(
    previous: &SharedTimeEvidenceBindingV1,
    current: &SharedTimeEvidenceBindingV1,
    decision_cut_must_advance: bool,
) -> bool {
    let decision_cut_ordered = if decision_cut_must_advance {
        previous.decision_cut_epoch_ms < current.decision_cut_epoch_ms
    } else {
        previous.decision_cut_epoch_ms <= current.decision_cut_epoch_ms
    };
    time_binding_is_well_formed(previous)
        && time_binding_is_well_formed(current)
        && previous.clock_identity == current.clock_identity
        && previous.clock_epoch == current.clock_epoch
        && previous.restart_continuity_digest == current.restart_continuity_digest
        && previous.comparison_rule == current.comparison_rule
        && previous.predecessor_head_digest == current.predecessor_head_digest
        && previous.epoch_successor_proof_identity == current.epoch_successor_proof_identity
        && previous.successor_proof_commit_cut_epoch_ms
            == current.successor_proof_commit_cut_epoch_ms
        && previous.monotonic_sequence < current.monotonic_sequence
        && previous.wall_observed_epoch_ms <= current.wall_observed_epoch_ms
        && decision_cut_ordered
        && previous.head_identity != current.head_identity
        && previous.head_digest != current.head_digest
}

fn time_binding_is_well_formed(time: &SharedTimeEvidenceBindingV1) -> bool {
    if validate_digest("time_head_identity", &time.head_identity).is_err()
        || validate_digest("time_head_digest", &time.head_digest).is_err()
        || validate_digest(
            "time_restart_continuity_digest",
            &time.restart_continuity_digest,
        )
        .is_err()
        || time.comparison_rule != "EXCLUSIVE_VALID_THROUGH"
        || time.decision_cut_epoch_ms >= time.valid_through_epoch_ms
    {
        return false;
    }

    match (
        time.predecessor_head_digest.as_deref(),
        time.epoch_successor_proof_identity.as_deref(),
        time.successor_proof_commit_cut_epoch_ms,
    ) {
        (None, None, None) => true,
        (Some(predecessor), Some(proof), Some(commit_cut)) => {
            validate_digest("time_predecessor_head_digest", predecessor).is_ok()
                && validate_digest("time_epoch_successor_proof_identity", proof).is_ok()
                && predecessor != time.head_digest
                && commit_cut <= time.decision_cut_epoch_ms
        }
        _ => false,
    }
}

fn verify_provenance(
    binding: &SourceAcquisitionBindingV1,
    receipt: &SourceAcquisitionReceiptV1,
    provenance: &ResearchSourceProvenanceV1,
) -> Result<(), SourceIntakeResearchHandoffErrorV1> {
    let content_digest = receipt
        .content_digest
        .as_deref()
        .ok_or(SourceIntakeResearchHandoffErrorV1::AncestryMismatch)?;
    let expected_interpretation_digest = interpretation_digest(&provenance.interpretation);
    let expected_interpretation_identity = domain_identity(
        "rd.source-interpretation.v1",
        &[&expected_interpretation_digest],
    );
    let expected_provenance_identity = domain_identity(
        "rd.research-source-provenance.v1",
        &[
            &binding.normalized_doi,
            content_digest,
            &receipt.receipt_identity,
            &receipt.retrieval_time.head_digest,
            &expected_interpretation_identity,
            &expected_interpretation_digest,
        ],
    );

    if provenance.schema_version != 1
        || provenance.predecessor_provenance_identity.is_some()
        || provenance.provenance_identity != expected_provenance_identity
        || provenance.canonical_source_identity != format!("doi:{}", binding.normalized_doi)
        || provenance.canonical_source_origin != binding.https_origin
        || provenance.source_class != "ACADEMIC_IDENTITY_AND_CITATION_GRAPH"
        || provenance.author_or_originating_system != "OPENALEX"
        || provenance.publication_time_epoch_ms.is_some()
        || provenance.revision_identity.is_some()
        || !provenance.linked_reference_identities.is_empty()
        || provenance.content_digest != content_digest
        || provenance.raw_content_digest != content_digest
        || provenance.connector_identity != binding.connector_identity
        || provenance.connector_version != binding.connector_version
        || provenance.acquisition_receipt_identity != receipt.receipt_identity
        || provenance.rights_basis_identity != binding.rights_basis_identity
        || provenance.rights_policy_version != binding.rights_policy_version
        || provenance.license_basis != binding.rights_basis_identity
        || provenance.acquisition_scope != binding.acquisition_scope
        || provenance.retention_policy_identity != binding.retention_policy_identity
        || provenance.retention_policy_version != binding.retention_policy_version
        || provenance.retention_scope != binding.retention_scope
        || provenance.attribution_basis != "OPENALEX_METADATA_ATTRIBUTION"
        || !location_rights_are_canonical(&binding.normalized_doi, provenance)
        || provenance.bounded_interpretation_identity != expected_interpretation_identity
        || provenance.bounded_interpretation_digest != expected_interpretation_digest
        || provenance.interpretation_status != "BOUNDED_RESEARCH_INTERPRETATION"
        || provenance.trust_class != UNTRUSTED_SOURCE_CLASS_V1
    {
        return Err(SourceIntakeResearchHandoffErrorV1::AncestryMismatch);
    }
    Ok(())
}

fn location_rights_are_canonical(
    normalized_doi: &str,
    provenance: &ResearchSourceProvenanceV1,
) -> bool {
    provenance
        .location_rights
        .iter()
        .enumerate()
        .all(|(index, rights)| {
            let reported_license = rights.reported_license.as_deref().unwrap_or("UNREPORTED");
            rights.location_identity
                == domain_identity(
                    "rd.source-intake.location-rights.v1",
                    &[
                        normalized_doi,
                        &index.to_string(),
                        rights
                            .landing_page_locator_digest
                            .as_deref()
                            .unwrap_or("ABSENT"),
                        rights.pdf_locator_digest.as_deref().unwrap_or("ABSENT"),
                        reported_license,
                    ],
                )
                && rights.posture == super::LocationRightsPostureV1::MutableMetadataNotReuseGrant
        })
}

fn verify_candidate(
    provenance: &ResearchSourceProvenanceV1,
    candidate: &SourceCandidateV1,
) -> Result<(), SourceIntakeResearchHandoffErrorV1> {
    let expected_identity = domain_identity(
        "rd.source-candidate.v1",
        &[
            &provenance.provenance_identity,
            &provenance.bounded_interpretation_digest,
        ],
    );

    if candidate.candidate_identity != expected_identity
        || candidate.provenance_identity != provenance.provenance_identity
        || candidate.interpretation_digest != provenance.bounded_interpretation_digest
        || candidate.trust_class != provenance.trust_class
        || candidate.trust_class != UNTRUSTED_SOURCE_CLASS_V1
    {
        return Err(SourceIntakeResearchHandoffErrorV1::AncestryMismatch);
    }
    Ok(())
}

fn verify_transition(
    receipt: &SourceAcquisitionReceiptV1,
    provenance: &ResearchSourceProvenanceV1,
    candidate: &SourceCandidateV1,
    transition: &SourceIntakeOutboxV1,
) -> Result<(), SourceIntakeResearchHandoffErrorV1> {
    let expected_event_identity = domain_identity(
        "rd.owner-outbox.source-intake-terminated.v1",
        &[&receipt.request_identity, &receipt.receipt_identity],
    );
    let expected_payload_digest = domain_identity(
        "rd.owner-outbox.payload.v1",
        &[
            &receipt.request_identity,
            &receipt.receipt_identity,
            &provenance.provenance_identity,
            &candidate.candidate_identity,
        ],
    );

    if transition.event_identity != expected_event_identity
        || transition.aggregate_identity != receipt.request_identity
        || transition.event_kind != RETRIEVED_EVENT_KIND_V1
        || transition.payload_digest != expected_payload_digest
    {
        return Err(SourceIntakeResearchHandoffErrorV1::AncestryMismatch);
    }
    Ok(())
}

fn ancestry_evidence_identity(
    proposal: &SourceIntakeResearchAncestryProposalV1,
    binding: &SourceAcquisitionBindingV1,
    receipt: &SourceAcquisitionReceiptV1,
    provenance: &ResearchSourceProvenanceV1,
    candidate: &SourceCandidateV1,
    transition: &SourceIntakeOutboxV1,
    verification_policy: &SourceIntakePolicyEvidenceV1,
) -> Result<String, SourceIntakeResearchHandoffErrorV1> {
    #[derive(Serialize)]
    struct Meaning<'a> {
        proposal: &'a SourceIntakeResearchAncestryProposalV1,
        binding: &'a SourceAcquisitionBindingV1,
        receipt: &'a SourceAcquisitionReceiptV1,
        provenance: &'a ResearchSourceProvenanceV1,
        candidate: &'a SourceCandidateV1,
        transition: &'a SourceIntakeOutboxV1,
        verification_policy: &'a SourceIntakePolicyEvidenceV1,
    }
    let bytes = serde_json::to_vec(&Meaning {
        proposal,
        binding,
        receipt,
        provenance,
        candidate,
        transition,
        verification_policy,
    })
    .map_err(|_| SourceIntakeResearchHandoffErrorV1::Serialization)?;
    Ok(domain_identity(
        "rd.source-intake.research-ancestry-evidence.v1",
        &[std::str::from_utf8(&bytes)
            .map_err(|_| SourceIntakeResearchHandoffErrorV1::Serialization)?],
    ))
}

#[cfg(test)]
mod tests {
    use std::net::{IpAddr, Ipv4Addr};

    use rstest::rstest;

    use super::*;
    use crate::source_intake::{
        OpenAlexResponseObservationV1, OpenAlexWorkByDoiRequestV1, ProductEdgeAdmissionLocatorV1,
        ProductEdgeGatewayV1, ResponseHeaderV1, SourceAcquisitionAdmissionV1,
        SourceIntakeAttemptV1, SourceIntakePolicyEvidenceV1, SourceInterpretationV1,
        TestStartedCustodyV1,
    };

    const REQUEST_ID: &str = "source-request-ancestry-001";
    const DOI: &str = "10.1234/ancestry";

    struct Fixture {
        proposal: SourceIntakeResearchAncestryProposalV1,
        attempt: SourceIntakeAttemptV1,
        verification_policy: SourceIntakePolicyEvidenceV1,
    }

    fn fixture() -> Fixture {
        let request = OpenAlexWorkByDoiRequestV1 {
            request_identity: REQUEST_ID.into(),
            gateway: ProductEdgeGatewayV1::WindmillProductEdge,
            admission: ProductEdgeAdmissionLocatorV1 {
                request_identity: REQUEST_ID.into(),
                admission_identity: "product-edge-admission-ancestry-001".into(),
                admission_digest: digest('a'),
            },
            operation_manifest_identity: "operation-manifest-ancestry-001".into(),
            operation_manifest_digest: digest('b'),
            normalized_doi: DOI.into(),
        };
        let binding_evidence = SourceIntakePolicyEvidenceV1::fixture(
            &request,
            vec![IpAddr::V4(Ipv4Addr::new(8, 8, 8, 8))],
            0,
            0,
            1_048_576,
            5_000,
            SourceAcquisitionAdmissionV1::Admitted,
        );
        let mut verification_policy = SourceIntakePolicyEvidenceV1::fixture(
            &request,
            vec![IpAddr::V4(Ipv4Addr::new(8, 8, 8, 8))],
            0,
            0,
            1_048_576,
            5_000,
            SourceAcquisitionAdmissionV1::Admitted,
        );
        let mut attempt = SourceIntakeAttemptV1::close_binding(request, binding_evidence).unwrap();
        attempt
            .prepare(
                "binding-commit-ancestry-001",
                TestStartedCustodyV1::fixture(
                    REQUEST_ID,
                    "product-edge-admission-ancestry-001",
                    "started-state-ancestry-001",
                    interpretation(),
                )
                .unwrap(),
            )
            .unwrap();
        let permit = attempt.reserve_invocation_fixture().unwrap();
        let retrieval_time = attempt.retrieval_time_fixture();
        attempt
            .resolve(
                permit,
                OpenAlexResponseObservationV1::fixture_http(
                    200,
                    vec![ResponseHeaderV1 {
                        name: "content-type".into(),
                        value: "application/json".into(),
                    }],
                    vec![
                        format!(r#"{{"doi":"https://doi.org/{DOI}","locations":[]}}"#).into_bytes(),
                    ],
                    vec![IpAddr::V4(Ipv4Addr::new(8, 8, 8, 8))],
                ),
                &retrieval_time,
                1_800_000_000_000,
            )
            .unwrap();
        let receipt = attempt
            .terminal_commit
            .as_ref()
            .and_then(|commit| commit.public.receipt.as_ref())
            .unwrap();
        verification_policy.shared_time = receipt.retrieval_time.clone();
        verification_policy.shared_time.monotonic_sequence += 1;
        verification_policy.shared_time.decision_cut_epoch_ms += 1;
        verification_policy.shared_time.wall_observed_epoch_ms += 1;
        verification_policy.shared_time.head_identity = digest('e');
        verification_policy.shared_time.head_digest = digest('f');
        let proposal = SourceIntakeResearchAncestryProposalV1 {
            request_identity: receipt.request_identity.clone(),
            attempt_identity: receipt.attempt_identity.clone(),
            terminal_receipt_identity: receipt.receipt_identity.clone(),
        };
        Fixture {
            proposal,
            attempt,
            verification_policy,
        }
    }

    fn interpretation() -> SourceInterpretationV1 {
        SourceInterpretationV1 {
            bounded_explanation: "A bounded source interpretation for Research admission.".into(),
            plausible_alternatives: vec!["The reported relationship is selection bias.".into()],
            differentiating_prediction: "The mechanism survives a later untouched cut.".into(),
            falsifier: "The effect disappears under the frozen cost model.".into(),
        }
    }

    fn digest(fill: char) -> String {
        format!("sha256:{}", fill.to_string().repeat(64))
    }

    fn seal(
        fixture: &Fixture,
    ) -> Result<VerifiedSourceIntakeResearchAncestryV1, SourceIntakeResearchHandoffErrorV1> {
        fixture
            .attempt
            .seal_research_ancestry(&fixture.proposal, fixture.verification_policy.clone())
    }

    fn durable_snapshot(fixture: &Fixture) -> DurableSourceIntakeResearchSnapshotV1 {
        let commit = fixture.attempt.terminal_commit.as_ref().unwrap();
        DurableSourceIntakeResearchSnapshotV1 {
            request: fixture.attempt.request.clone(),
            binding: fixture.attempt.binding.clone(),
            receipt: commit.public.receipt.clone().unwrap(),
            provenance: commit.provenance.clone().unwrap(),
            candidate: commit.candidate.clone().unwrap(),
            transition: commit.outbox.clone().unwrap(),
        }
    }

    #[rstest]
    fn durable_peek_cannot_mint_and_locked_capability_binds_expected_digest() {
        let fixture = fixture();
        let peeked = peek_durable_source_intake_research_handoff_v1(
            &fixture.proposal,
            &durable_snapshot(&fixture),
            fixture.verification_policy.clone(),
        )
        .unwrap();
        let (expected_digest, ..) = peeked.into_research_source_fields();
        assert!(
            lock_durable_source_intake_research_handoff_v1(
                fixture.proposal.clone(),
                durable_snapshot(&fixture),
                fixture.verification_policy.clone(),
                &digest('0'),
            )
            .is_err()
        );
        let locked = lock_durable_source_intake_research_handoff_v1(
            fixture.proposal.clone(),
            durable_snapshot(&fixture),
            fixture.verification_policy.clone(),
            &expected_digest,
        )
        .unwrap();
        assert_eq!(locked.mint().unwrap().evidence_identity(), expected_digest);
    }

    #[allow(
        dead_code,
        reason = "standalone Source Intake harness has no Product Edge assembly consumer"
    )]
    pub(super) fn verified_research_ancestry_fixture()
    -> (VerifiedSourceIntakeResearchAncestryV1, String) {
        let fixture = fixture();
        let content_digest = fixture
            .attempt
            .committed_provenance()
            .unwrap()
            .content_digest
            .clone();
        (seal(&fixture).unwrap(), content_digest)
    }

    #[rstest]
    fn exact_owner_reread_seals_opaque_deterministic_ancestry() {
        let fixture = fixture();
        let first = seal(&fixture).unwrap();
        let second = seal(&fixture).unwrap();
        assert_eq!(first.evidence_identity(), second.evidence_identity());
        assert_eq!(first.attempt_identity(), fixture.proposal.attempt_identity);
        assert_eq!(
            first.terminal_receipt_identity(),
            fixture.proposal.terminal_receipt_identity
        );
        assert_eq!(
            first.candidate_identity(),
            fixture
                .attempt
                .committed_candidate()
                .unwrap()
                .candidate_identity
        );
        let VerifiedSourceIntakeResearchAncestryV1 {
            evidence_identity: _,
            attempt_identity: _,
            terminal_receipt_identity: _,
            candidate_identity: _,
            research_source,
        } = first;
        let VerifiedResearchSourceProjectionV1 {
            locator: _,
            content_digest: _,
            observed_at: _,
            source_cut: _,
            license_basis: _,
            interpretation: _,
        } = research_source;
    }

    #[rstest]
    fn every_required_lineage_mutation_fails_closed() {
        let cases: Vec<fn(&mut Fixture)> = vec![
            |value| receipt_mut(value).request_identity.push_str("-changed"),
            |value| receipt_mut(value).response_header_digest = Some(digest('1')),
            |value| receipt_mut(value).committed_at_epoch_ms += 1,
            |value| receipt_mut(value).terminal_evidence_digest = digest('2'),
            |value| receipt_mut(value).terminal = AcquisitionTerminalV1::NotFound,
            |value| {
                provenance_mut(value)
                    .acquisition_receipt_identity
                    .push_str("-changed");
            },
            |value| {
                candidate_mut(value)
                    .provenance_identity
                    .push_str("-changed");
            },
            |value| transition_mut(value).payload_digest = digest('9'),
            |value| provenance_mut(value).content_digest = digest('8'),
            |value| provenance_mut(value).license_basis.push_str("-changed"),
            |value| {
                provenance_mut(value)
                    .interpretation
                    .bounded_explanation
                    .push_str(" changed");
            },
            |value| {
                receipt_mut(value)
                    .policy_decision_time
                    .clock_epoch
                    .push_str("-changed");
            },
            |value| {
                receipt_mut(value)
                    .policy_decision_time
                    .wall_observed_epoch_ms += 1;
            },
            |value| {
                receipt_mut(value).retrieval_time.predecessor_head_digest = Some(digest('3'));
            },
            |value| {
                receipt_mut(value).retrieval_time.head_identity = digest('4');
            },
            |value| {
                value.verification_policy.shared_time.decision_cut_epoch_ms = value
                    .attempt
                    .committed_provenance()
                    .unwrap()
                    .valid_through_epoch_ms;
            },
            |value| {
                value.verification_policy.shared_time.valid_through_epoch_ms =
                    value.verification_policy.shared_time.decision_cut_epoch_ms;
            },
            |value| {
                value.verification_policy.rights_valid_through_epoch_ms =
                    value.verification_policy.shared_time.decision_cut_epoch_ms;
            },
            |value| {
                value.verification_policy.retention_valid_through_epoch_ms =
                    value.verification_policy.shared_time.decision_cut_epoch_ms;
            },
            |value| {
                value
                    .verification_policy
                    .rights_basis_identity
                    .push_str("-changed");
            },
            |value| {
                value
                    .verification_policy
                    .rights_policy_version
                    .push_str("-changed");
            },
            |value| {
                value
                    .verification_policy
                    .acquisition_scope
                    .push_str("-changed");
            },
            |value| {
                value
                    .verification_policy
                    .retention_policy_identity
                    .push_str("-changed");
            },
            |value| {
                value
                    .verification_policy
                    .retention_policy_version
                    .push_str("-changed");
            },
            |value| {
                value
                    .verification_policy
                    .retention_scope
                    .push_str("-changed");
            },
        ];

        for mutate in cases {
            let mut changed = fixture();
            mutate(&mut changed);
            assert!(seal(&changed).is_err());
        }
    }

    #[rstest]
    fn every_receipt_shared_time_field_is_locked_to_owner_evidence() {
        let mutations: Vec<fn(&mut SharedTimeEvidenceBindingV1)> = vec![
            |time| time.head_identity = digest('1'),
            |time| time.head_digest = digest('2'),
            |time| time.clock_identity.push_str("-changed"),
            |time| time.clock_epoch.push_str("-changed"),
            |time| time.monotonic_sequence += 1,
            |time| time.wall_observed_epoch_ms += 1,
            |time| time.decision_cut_epoch_ms += 1,
            |time| time.valid_through_epoch_ms += 1,
            |time| time.restart_continuity_digest = digest('3'),
            |time| time.uncertainty_bound_ms += 1,
            |time| time.skew_bound_ms += 1,
            |time| time.comparison_rule.push_str("-changed"),
            |time| time.predecessor_head_digest = Some(digest('4')),
            |time| time.epoch_successor_proof_identity = Some(digest('5')),
            |time| time.successor_proof_commit_cut_epoch_ms = Some(1),
        ];

        for mutate in mutations {
            let mut policy_changed = fixture();
            mutate(&mut receipt_mut(&mut policy_changed).policy_decision_time);
            assert!(seal(&policy_changed).is_err());

            let mut retrieval_changed = fixture();
            mutate(&mut receipt_mut(&mut retrieval_changed).retrieval_time);
            assert!(seal(&retrieval_changed).is_err());
        }
    }

    fn receipt_mut(fixture: &mut Fixture) -> &mut SourceAcquisitionReceiptV1 {
        fixture
            .attempt
            .terminal_commit
            .as_mut()
            .and_then(|commit| commit.public.receipt.as_mut())
            .unwrap()
    }

    fn provenance_mut(fixture: &mut Fixture) -> &mut ResearchSourceProvenanceV1 {
        fixture
            .attempt
            .terminal_commit
            .as_mut()
            .and_then(|commit| commit.provenance.as_mut())
            .unwrap()
    }

    fn candidate_mut(fixture: &mut Fixture) -> &mut SourceCandidateV1 {
        fixture
            .attempt
            .terminal_commit
            .as_mut()
            .and_then(|commit| commit.candidate.as_mut())
            .unwrap()
    }

    fn transition_mut(fixture: &mut Fixture) -> &mut SourceIntakeOutboxV1 {
        fixture
            .attempt
            .terminal_commit
            .as_mut()
            .and_then(|commit| commit.outbox.as_mut())
            .unwrap()
    }
}
