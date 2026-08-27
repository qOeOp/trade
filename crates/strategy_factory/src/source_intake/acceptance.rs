//! Compile-time-only sealed Source Intake environment.

use std::{
    net::IpAddr,
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
};

use async_trait::async_trait;
use sqlx::PgPool;
use vibe_product_edge::{ProductEdgePostgresOwnerV1, ProductEdgeSourceInvocationClaimRequestV1};

use super::{
    CanonicalStartedCustodyV1, OpenAlexWorkByDoiRequestV1, ProductEdgeGatewayV1,
    SourceAcquisitionAdmissionV1, SourceAcquisitionAuthorityBindingV1,
    SourceAcquisitionAuthorityClassV1, SourceIntakeAttemptV1,
    SourceIntakeInvocationPolicyEvidenceV1, SourceIntakeOwnerErrorV1, SourceIntakePolicyEvidenceV1,
    SourceIntakeRetrievalTimeEvidenceV1, domain_identity, openalex_http,
    owner::{
        self, AdmissionCustodyV1, BindingCustodyV1, ClaimCustodyV1, ExecutionCustodyV1,
        PermitCustodyV1, PolicyCustodyV1, ReservationCustodyV1, RetrievalCustodyV1,
        SourceIntakeEnvironmentPort, SourceIntakeOperationRequestV1, SourceIntakeTerminalAtomV1,
        StartedCustodyV1,
    },
    postgres::{
        SourceIntakeFailureTerminalCommitV1, SourceIntakeSuccessTerminalCommitV1,
        SourceIntakeTermsBlockedCommitV1, commit_source_intake_failure_terminal_in_transaction,
        commit_source_intake_success_terminal_in_transaction,
        commit_source_intake_terms_blocked_in_transaction,
        prepare_source_invocation_in_transaction, reserve_started_source_invocation_in_transaction,
    },
};

const SEALED_ACCEPTANCE_ENVIRONMENT_IDENTITY: &str =
    "source-intake-sealed-acceptance-environment-v1";
const SEALED_ACCEPTANCE_PROVIDER_PROFILE_DIGEST: &str =
    "sha256:20e4901e7b97516edbaa744c0e866b0c509595386357c1b973e48beac1657f15";
const SEALED_ACCEPTANCE_FIXTURE_CORPUS_DIGEST: &str =
    "sha256:b8cf806629fbb7baa2e38707b4d246a17e44d9841509701530cbd97558ddad18";
const BINDING_COMMITTED_AT_EPOCH_MS: u64 = 1_800_000_000_001;
const RESERVED_AT_EPOCH_MS: u64 = 1_800_000_000_002;
const TERMINAL_COMMITTED_AT_EPOCH_MS: u64 = 1_800_000_000_003;
const FIXTURE_ADDRESS: IpAddr = IpAddr::V4(std::net::Ipv4Addr::new(1, 1, 1, 1));

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SealedCaseV1 {
    Retrieved,
    PolicyRejected,
    ResponseLostAfterCommit,
}

/// Exact isolated PE/Owner PostgreSQL dependencies for the feature-built
/// acceptance service. There is no runtime provider, URL, credential, DSN, or
/// corpus selector.
pub struct SealedSourceIntakeEnvironmentV1 {
    product_edge: Arc<ProductEdgePostgresOwnerV1>,
    owner_pool: PgPool,
    request_proof_digest: String,
    provider: SealedOpenAlexAdapterV1,
}

#[derive(Clone)]
pub struct SealedSourceIntakeAuditV1 {
    invocations: Arc<AtomicU64>,
}

impl SealedSourceIntakeAuditV1 {
    #[must_use]
    pub fn physical_provider_invocations(&self) -> u64 {
        self.invocations.load(Ordering::SeqCst)
    }
}

impl SealedSourceIntakeEnvironmentV1 {
    pub fn new(
        product_edge: Arc<ProductEdgePostgresOwnerV1>,
        owner_pool: PgPool,
        request_proof_digest: String,
    ) -> Result<Self, SourceIntakeOwnerErrorV1> {
        super::validate_digest("request_proof_digest", &request_proof_digest)
            .map_err(|_| SourceIntakeOwnerErrorV1::Invalid)?;
        Ok(Self {
            product_edge,
            owner_pool,
            request_proof_digest,
            provider: SealedOpenAlexAdapterV1::default(),
        })
    }

    #[must_use]
    pub fn audit(&self) -> SealedSourceIntakeAuditV1 {
        SealedSourceIntakeAuditV1 {
            invocations: self.provider.invocations.clone(),
        }
    }
}

struct SealedOpenAlexAdapterV1 {
    invocations: Arc<AtomicU64>,
}

impl Default for SealedOpenAlexAdapterV1 {
    fn default() -> Self {
        Self {
            invocations: Arc::new(AtomicU64::new(0)),
        }
    }
}

impl SealedOpenAlexAdapterV1 {
    fn execute(
        &self,
        doi: &str,
    ) -> Result<openalex_http::OpenAlexResponseObservationV1, SourceIntakeOwnerErrorV1> {
        if case_for_doi(doi)? == SealedCaseV1::PolicyRejected {
            return Err(SourceIntakeOwnerErrorV1::Conflict);
        }
        self.invocations
            .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |value| {
                Some(value.saturating_add(1))
            })
            .map_err(|_| SourceIntakeOwnerErrorV1::Unavailable)?;
        Ok(openalex_http::OpenAlexResponseObservationV1::fixture_http(
            200,
            vec![openalex_http::ResponseHeaderV1 {
                name: "content-type".into(),
                value: "application/json".into(),
            }],
            vec![fixture_body(doi)],
            vec![FIXTURE_ADDRESS],
        ))
    }
}

#[async_trait]
impl SourceIntakeEnvironmentPort for SealedSourceIntakeEnvironmentV1 {
    async fn terminal_preflight(
        &self,
        request: &SourceIntakeOperationRequestV1,
    ) -> Result<Option<SourceIntakeTerminalAtomV1>, SourceIntakeOwnerErrorV1> {
        case_for_doi(&request.normalized_doi)?;
        owner::terminal_preflight(
            &self.product_edge,
            &self.owner_pool,
            request,
            &self.request_proof_digest,
            &authority(),
        )
        .await
    }

    async fn admit(
        &self,
        request: SourceIntakeOperationRequestV1,
    ) -> Result<AdmissionCustodyV1, SourceIntakeOwnerErrorV1> {
        case_for_doi(&request.normalized_doi)?;
        owner::admit(&self.product_edge, request, &self.request_proof_digest).await
    }

    async fn resolve_policy(
        &self,
        admission: AdmissionCustodyV1,
    ) -> Result<Option<PolicyCustodyV1>, SourceIntakeOwnerErrorV1> {
        let case = case_for_doi(&admission.request.normalized_doi)?;
        let owner_request = OpenAlexWorkByDoiRequestV1 {
            request_identity: admission.request.request_identity.clone(),
            gateway: ProductEdgeGatewayV1::WindmillProductEdge,
            admission: admission.locator.clone(),
            operation_manifest_identity: admission.manifest_identity.clone(),
            operation_manifest_digest: admission.manifest_digest.clone(),
            normalized_doi: admission.request.normalized_doi.clone(),
        };
        let evidence = SourceIntakePolicyEvidenceV1::fixture(
            &owner_request,
            vec![FIXTURE_ADDRESS],
            0,
            0,
            openalex_http::MAX_RESPONSE_BYTES,
            5_000,
            SourceAcquisitionAdmissionV1::Admitted,
        );
        let mut attempt = SourceIntakeAttemptV1::close_binding(owner_request, evidence)
            .map_err(|_| SourceIntakeOwnerErrorV1::Invalid)?;
        attempt
            .bind_sealed_acceptance_authority(authority())
            .map_err(|_| SourceIntakeOwnerErrorV1::Conflict)?;
        let invocation_evidence = SourceIntakeInvocationPolicyEvidenceV1::fixture(
            attempt.binding(),
            attempt.binding().shared_time.decision_cut_epoch_ms + 1,
            if case == SealedCaseV1::PolicyRejected {
                SourceAcquisitionAdmissionV1::Rejected
            } else {
                SourceAcquisitionAdmissionV1::Admitted
            },
        );
        let retrieval_evidence = SourceIntakeRetrievalTimeEvidenceV1::fixture(
            &invocation_evidence,
            invocation_evidence.current_time.decision_cut_epoch_ms + 1,
        );
        Ok(Some(PolicyCustodyV1 {
            admission,
            attempt,
            invocation_evidence,
            retrieval_evidence,
            response_loss_after_commit: case == SealedCaseV1::ResponseLostAfterCommit,
        }))
    }

    async fn commit_binding(
        &self,
        policy: PolicyCustodyV1,
    ) -> Result<BindingCustodyV1, SourceIntakeOwnerErrorV1> {
        let binding_commit_identity = domain_identity(
            "rd.source-intake.binding-commit.v1",
            &[
                &policy.attempt.binding().binding_identity,
                SEALED_ACCEPTANCE_ENVIRONMENT_IDENTITY,
            ],
        );
        let mut transaction = self
            .owner_pool
            .begin()
            .await
            .map_err(|_| SourceIntakeOwnerErrorV1::Unavailable)?;
        let inserted = sqlx::query("INSERT INTO public.rd_source_intake_bindings_v1 (request_identity,binding_identity,binding_commit_identity,binding_json,state,binding_committed_at_epoch_ms) VALUES ($1,$2,$3,$4,'BINDING_CLOSED',$5)")
            .bind(&policy.admission.request.request_identity)
            .bind(&policy.attempt.binding().binding_identity)
            .bind(&binding_commit_identity)
            .bind(serde_json::to_value(policy.attempt.binding()).map_err(|_| SourceIntakeOwnerErrorV1::Unavailable)?)
            .bind(i64::try_from(BINDING_COMMITTED_AT_EPOCH_MS).map_err(|_| SourceIntakeOwnerErrorV1::Unavailable)?)
            .execute(&mut *transaction).await.map_err(|_| SourceIntakeOwnerErrorV1::Conflict)?;
        if inserted.rows_affected() != 1 {
            return Err(SourceIntakeOwnerErrorV1::Unavailable);
        }
        transaction
            .commit()
            .await
            .map_err(|_| SourceIntakeOwnerErrorV1::Unavailable)?;
        Ok(BindingCustodyV1 {
            admission: policy.admission.locator,
            request: policy.admission.request,
            attempt: policy.attempt,
            binding_commit_identity,
            invocation_evidence: policy.invocation_evidence,
            retrieval_evidence: policy.retrieval_evidence,
            response_loss_after_commit: policy.response_loss_after_commit,
        })
    }

    async fn claim_invocation(
        &self,
        binding: BindingCustodyV1,
    ) -> Result<ClaimCustodyV1, SourceIntakeOwnerErrorV1> {
        let readback = self
            .product_edge
            .claim_source_intake_invocation(ProductEdgeSourceInvocationClaimRequestV1 {
                admission: binding.admission.clone(),
                attempt_identity: binding.attempt.binding().binding_identity.clone(),
                binding_identity: binding.attempt.binding().binding_identity.clone(),
            })
            .await
            .map_err(|e| owner::product_edge_error(&e))?;
        if readback.request_identity() != binding.request.request_identity
            || readback.attempt_identity() != binding.attempt.binding().binding_identity
        {
            return Err(SourceIntakeOwnerErrorV1::Conflict);
        }
        Ok(ClaimCustodyV1(binding))
    }

    async fn reserve_start(
        &self,
        claim: ClaimCustodyV1,
    ) -> Result<ReservationCustodyV1, SourceIntakeOwnerErrorV1> {
        let binding = claim.0;
        let mut transaction = self
            .owner_pool
            .begin()
            .await
            .map_err(|_| SourceIntakeOwnerErrorV1::Unavailable)?;
        let start_request = prepare_source_invocation_in_transaction(
            &mut transaction,
            &binding.admission,
            &binding.attempt.binding().binding_identity,
            RESERVED_AT_EPOCH_MS,
        )
        .await
        .map_err(|_| SourceIntakeOwnerErrorV1::Unavailable)?;
        transaction
            .commit()
            .await
            .map_err(|_| SourceIntakeOwnerErrorV1::Unavailable)?;
        Ok(ReservationCustodyV1 {
            binding,
            start_request,
        })
    }

    async fn commit_rejection(
        &self,
        reservation: ReservationCustodyV1,
    ) -> Result<SourceIntakeTerminalAtomV1, SourceIntakeOwnerErrorV1> {
        let mut binding = reservation.binding;
        binding
            .attempt
            .prepare_verified(
                binding.binding_commit_identity.clone(),
                CanonicalStartedCustodyV1 {
                    request_identity: binding.request.request_identity.clone(),
                    admission_identity: binding.admission.admission_identity.clone(),
                    started_state_digest: reservation.start_request.reservation_identity.clone(),
                    interpretation: binding.request.interpretation.clone(),
                },
            )
            .map_err(|_| SourceIntakeOwnerErrorV1::Conflict)?;
        let local = binding
            .attempt
            .terminate_before_invocation(
                binding.invocation_evidence.clone(),
                &binding.retrieval_evidence,
                TERMINAL_COMMITTED_AT_EPOCH_MS,
            )
            .map_err(|_| SourceIntakeOwnerErrorV1::Conflict)?;
        let receipt = local
            .receipt
            .as_ref()
            .ok_or(SourceIntakeOwnerErrorV1::Unavailable)?;
        let outbox = binding
            .attempt
            .committed_outbox()
            .ok_or(SourceIntakeOwnerErrorV1::Unavailable)?;
        let mut transaction = self
            .owner_pool
            .begin()
            .await
            .map_err(|_| SourceIntakeOwnerErrorV1::Unavailable)?;
        let readback = commit_source_intake_terms_blocked_in_transaction(
            &mut transaction,
            &binding.admission,
            &binding.attempt.binding().binding_identity,
            SourceIntakeTermsBlockedCommitV1 {
                reservation_identity: &reservation.start_request.reservation_identity,
                reservation_digest: &reservation.start_request.reservation_digest,
                decision: binding.invocation_evidence,
                retrieval_time: &binding.retrieval_evidence,
                receipt,
                outbox,
            },
        )
        .await
        .map_err(|_| SourceIntakeOwnerErrorV1::Unavailable)?;
        transaction
            .commit()
            .await
            .map_err(|_| SourceIntakeOwnerErrorV1::Unavailable)?;
        owner::project_terminal(readback, &binding.request.request_identity, &authority())
    }

    async fn mark_started(
        &self,
        reservation: ReservationCustodyV1,
    ) -> Result<StartedCustodyV1, SourceIntakeOwnerErrorV1> {
        let started = self
            .product_edge
            .start_source_intake_invocation(reservation.start_request)
            .await
            .map_err(|e| owner::product_edge_error(&e))?;
        Ok(StartedCustodyV1 {
            binding: reservation.binding,
            started_state_digest: started.state_digest().to_string(),
        })
    }

    async fn reserve_permit(
        &self,
        started: StartedCustodyV1,
    ) -> Result<PermitCustodyV1, SourceIntakeOwnerErrorV1> {
        let mut binding = started.binding;
        binding
            .attempt
            .prepare_verified(
                binding.binding_commit_identity.clone(),
                CanonicalStartedCustodyV1 {
                    request_identity: binding.request.request_identity.clone(),
                    admission_identity: binding.admission.admission_identity.clone(),
                    started_state_digest: started.started_state_digest,
                    interpretation: binding.request.interpretation.clone(),
                },
            )
            .map_err(|_| SourceIntakeOwnerErrorV1::Conflict)?;
        let mut transaction = self
            .owner_pool
            .begin()
            .await
            .map_err(|_| SourceIntakeOwnerErrorV1::Unavailable)?;
        let permit = reserve_started_source_invocation_in_transaction(
            &mut transaction,
            &binding.admission,
            &binding.attempt.binding().binding_identity,
            binding.invocation_evidence.clone(),
        )
        .await
        .map_err(|_| SourceIntakeOwnerErrorV1::Unavailable)?;
        transaction
            .commit()
            .await
            .map_err(|_| SourceIntakeOwnerErrorV1::Unavailable)?;
        binding
            .attempt
            .adopt_reserved_invocation(&binding.invocation_evidence, permit.invocation_identity())
            .map_err(|_| SourceIntakeOwnerErrorV1::Conflict)?;
        Ok(PermitCustodyV1 { binding, permit })
    }

    async fn execute_provider(
        &self,
        permit: PermitCustodyV1,
    ) -> Result<ExecutionCustodyV1, SourceIntakeOwnerErrorV1> {
        if permit.binding.attempt.binding().authority != authority() {
            return Err(SourceIntakeOwnerErrorV1::Conflict);
        }
        let observation = self
            .provider
            .execute(&permit.binding.request.normalized_doi)?;
        Ok(ExecutionCustodyV1 {
            binding: permit.binding,
            permit: permit.permit,
            observation,
        })
    }

    async fn resolve_retrieval(
        &self,
        execution: ExecutionCustodyV1,
    ) -> Result<RetrievalCustodyV1, SourceIntakeOwnerErrorV1> {
        let mut binding = execution.binding;
        let readback = binding
            .attempt
            .resolve(
                execution.permit,
                execution.observation,
                &binding.retrieval_evidence,
                TERMINAL_COMMITTED_AT_EPOCH_MS,
            )
            .map_err(|_| SourceIntakeOwnerErrorV1::Unavailable)?;
        Ok(RetrievalCustodyV1 { binding, readback })
    }

    async fn commit_terminal(
        &self,
        retrieval: RetrievalCustodyV1,
    ) -> Result<SourceIntakeTerminalAtomV1, SourceIntakeOwnerErrorV1> {
        let binding = retrieval.binding;
        let receipt = retrieval
            .readback
            .receipt
            .as_ref()
            .ok_or(SourceIntakeOwnerErrorV1::Unavailable)?;
        let outbox = binding
            .attempt
            .committed_outbox()
            .ok_or(SourceIntakeOwnerErrorV1::Unavailable)?;
        let invocation_identity = receipt
            .invocation_identity
            .as_deref()
            .ok_or(SourceIntakeOwnerErrorV1::Unavailable)?;
        let mut transaction = self
            .owner_pool
            .begin()
            .await
            .map_err(|_| SourceIntakeOwnerErrorV1::Unavailable)?;
        let readback =
            if retrieval.readback.terminal == Some(super::AcquisitionTerminalV1::Retrieved) {
                commit_source_intake_success_terminal_in_transaction(
                    &mut transaction,
                    &binding.admission,
                    &binding.attempt.binding().binding_identity,
                    SourceIntakeSuccessTerminalCommitV1 {
                        invocation_identity,
                        receipt,
                        retrieval_time: &binding.retrieval_evidence,
                        raw_payload: binding
                            .attempt
                            .raw_payload()
                            .ok_or(SourceIntakeOwnerErrorV1::Unavailable)?,
                        provenance: binding
                            .attempt
                            .committed_provenance()
                            .ok_or(SourceIntakeOwnerErrorV1::Unavailable)?,
                        candidate: binding
                            .attempt
                            .committed_candidate()
                            .ok_or(SourceIntakeOwnerErrorV1::Unavailable)?,
                        outbox,
                    },
                )
                .await
            } else {
                commit_source_intake_failure_terminal_in_transaction(
                    &mut transaction,
                    &binding.admission,
                    &binding.attempt.binding().binding_identity,
                    SourceIntakeFailureTerminalCommitV1 {
                        invocation_identity,
                        receipt,
                        retrieval_time: &binding.retrieval_evidence,
                        outbox,
                    },
                )
                .await
            }
            .map_err(|_| SourceIntakeOwnerErrorV1::Unavailable)?;
        transaction
            .commit()
            .await
            .map_err(|_| SourceIntakeOwnerErrorV1::Unavailable)?;
        if binding.response_loss_after_commit {
            return Err(SourceIntakeOwnerErrorV1::ResponseLost);
        }
        owner::project_terminal(readback, &binding.request.request_identity, &authority())
    }

    async fn resolve_terminal(
        &self,
        request_identity: &str,
    ) -> Result<Option<SourceIntakeTerminalAtomV1>, SourceIntakeOwnerErrorV1> {
        owner::resolve_terminal(
            &self.product_edge,
            &self.owner_pool,
            request_identity,
            &self.request_proof_digest,
            &authority(),
        )
        .await
    }
}

fn authority() -> SourceAcquisitionAuthorityBindingV1 {
    SourceAcquisitionAuthorityBindingV1 {
        authority_class: SourceAcquisitionAuthorityClassV1::SealedAcceptance,
        environment_identity: SEALED_ACCEPTANCE_ENVIRONMENT_IDENTITY.into(),
        provider_profile_digest: SEALED_ACCEPTANCE_PROVIDER_PROFILE_DIGEST.into(),
        fixture_corpus_digest: Some(SEALED_ACCEPTANCE_FIXTURE_CORPUS_DIGEST.into()),
    }
}

fn case_for_doi(doi: &str) -> Result<SealedCaseV1, SourceIntakeOwnerErrorV1> {
    match doi {
        "10.5555/sealed-success" => Ok(SealedCaseV1::Retrieved),
        "10.5555/sealed-rejected" => Ok(SealedCaseV1::PolicyRejected),
        "10.5555/sealed-response-loss" => Ok(SealedCaseV1::ResponseLostAfterCommit),
        _ => Err(SourceIntakeOwnerErrorV1::Conflict),
    }
}

fn fixture_body(doi: &str) -> Vec<u8> {
    format!(r#"{{"doi":"https://doi.org/{doi}","locations":[],"publication_year":2024}}"#)
        .into_bytes()
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::*;

    #[rstest]
    fn fixed_provider_has_no_rejection_effect_and_no_configuration_surface() {
        let provider = SealedOpenAlexAdapterV1::default();
        let audit = SealedSourceIntakeAuditV1 {
            invocations: provider.invocations.clone(),
        };
        assert_eq!(
            provider.execute("10.5555/sealed-rejected"),
            Err(SourceIntakeOwnerErrorV1::Conflict)
        );
        assert_eq!(audit.physical_provider_invocations(), 0);
        let _observation = provider
            .execute("10.5555/sealed-response-loss")
            .expect("fixed observation");
        assert_eq!(audit.physical_provider_invocations(), 1);
        assert_eq!(audit.physical_provider_invocations(), 1);
    }

    #[rstest]
    fn both_compositions_use_one_workflow_and_sealed_has_no_local_custody_store() {
        let owner_source = include_str!("owner.rs");
        let sealed_source = include_str!("acceptance.rs")
            .split("#[cfg(test)]")
            .next()
            .expect("production source");
        assert!(owner_source.contains("workflow: SourceIntakeWorkflowV1::new"));
        assert!(owner_source.contains("SourceIntakeEnvironmentPort"));
        assert!(sealed_source.contains("ProductEdgePostgresOwnerV1"));
        assert!(sealed_source.contains("prepare_source_invocation_in_transaction"));
        assert!(sealed_source.contains("reserve_started_source_invocation_in_transaction"));
        assert!(!sealed_source.contains("BTreeMap"));
        assert!(!sealed_source.contains("Mutex"));
        let workflow = owner_source
            .split("impl SourceIntakeWorkflowV1")
            .nth(1)
            .expect("workflow");
        let stages = [
            "terminal_preflight",
            ".admit(",
            "resolve_policy",
            "commit_binding",
            "claim_invocation",
            "reserve_start",
            "commit_rejection",
            "mark_started",
            "reserve_permit",
            "execute_provider",
            "resolve_retrieval",
            "commit_terminal",
        ];
        let positions = stages.map(|stage| workflow.find(stage).expect("workflow stage"));
        assert!(positions.windows(2).all(|pair| pair[0] < pair[1]));
        assert_eq!(
            owner_source
                .matches("workflow: SourceIntakeWorkflowV1::new")
                .count(),
            2
        );
        assert!(owner_source.contains("validate_readback_authority"));
        let terminal_atom = owner_source
            .split("pub struct SourceIntakeTerminalAtomV1")
            .nth(1)
            .expect("terminal atom")
            .split("pub enum SourceIntakeOwnerErrorV1")
            .next()
            .expect("terminal boundary");
        assert!(!terminal_atom.contains("raw_payload"));
        assert!(!terminal_atom.contains("credential"));
    }

    #[rstest]
    fn authority_mutations_are_identity_conflicts() {
        let expected = authority();
        let mut mutated = expected.clone();
        mutated.authority_class = SourceAcquisitionAuthorityClassV1::LiveExternal;
        assert_eq!(
            owner::validate_readback_authority(&mutated, &expected),
            Err(SourceIntakeOwnerErrorV1::Conflict)
        );
        mutated = expected.clone();
        mutated.environment_identity = "mutated".into();
        assert_eq!(
            owner::validate_readback_authority(&mutated, &expected),
            Err(SourceIntakeOwnerErrorV1::Conflict)
        );
        mutated = expected.clone();
        mutated.provider_profile_digest = "sha256:mutated".into();
        assert_eq!(
            owner::validate_readback_authority(&mutated, &expected),
            Err(SourceIntakeOwnerErrorV1::Conflict)
        );
        mutated = expected.clone();
        mutated.fixture_corpus_digest = Some("sha256:mutated".into());
        assert_eq!(
            owner::validate_readback_authority(&mutated, &expected),
            Err(SourceIntakeOwnerErrorV1::Conflict)
        );
    }
}
