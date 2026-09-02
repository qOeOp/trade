#[path = "../src/source_intake/mod.rs"]
pub mod source_intake;

use std::net::{IpAddr, Ipv4Addr};

#[cfg(feature = "sealed-source-intake-research-acceptance")]
use std::sync::Arc;

use rstest::rstest;
#[cfg(feature = "sealed-source-intake-research-acceptance")]
use vibe_data::owner::{
    shared_time_evidence::UntrustedClockHeadLocator, source_binding::BindingDigest,
};
use vibe_operator_authorization::{
    OperationManifestBindingV1, OperatorAuthorizationIssuanceProposalV1,
    OperatorAuthorizationIssuerPostgresV1, OperatorAuthorizationScopeV1,
};
use vibe_product_edge::ProductEdgeAdmissionLocatorV1 as CanonicalProductEdgeAdmissionLocatorV1;
use vibe_product_edge::{
    AgentOperationManifestProposalV1, ProductEdgeAdmissionRequestV1,
    ProductEdgeAuthorizationTrustV1, ProductEdgeBootstrapProposalV1,
    ProductEdgeInvocationClaimDispositionV1, ProductEdgeInvocationStartDispositionV1,
    ProductEdgePostgresOwnerV1, ProductEdgeSourceInvocationClaimRequestV1,
    SOURCE_INTAKE_OPERATION_SCHEMA_V1, SOURCE_INTAKE_OPERATION_V1,
    SOURCE_INTAKE_REQUIRED_EFFECTS_V1, SOURCE_INTAKE_TARGET_OWNER_V1,
    resolve_source_invocation_started_for_downstream_in_transaction,
};
use vibe_rd_source_intake_invocation_custody::{
    SourceInvocationReservationMeaningV1, seal_source_invocation_reservation,
};
use vibe_testkit::postgres::{CanonicalOwnerPostgresTestDatabaseV1, CanonicalOwnerTestRoleV1};

#[cfg(feature = "sealed-source-intake-research-acceptance")]
use vibe_strategy_factory::{
    product_edge::{
        ProductEdgeChannel, ProductEdgeResolution, RESEARCH_GOAL_OPERATION_V2,
        RESEARCH_GOAL_SCHEMA_V2, RESEARCH_OWNER_V1, ResearchGoalOwnerError, TrialFamilyProposalV1,
        UnsourcedResearchGoalV1, UnsourcedResearchProposalV1,
    },
    product_edge_postgres::PostgresResearchGoalOwnerV1,
    source_intake::{
        ProductEdgeGatewayV1 as CanonicalProductEdgeGatewayV1, SourceIntakePolicyEvidenceQueryV1,
        SourceIntakeResearchAncestryProposalV1,
    },
};

use source_intake::{
    AcquisitionTerminalV1, InvocationPermitV1, MAX_RESPONSE_BYTES, OpenAlexResponseObservationV1,
    OpenAlexWorkByDoiRequestV1, ProductEdgeAdmissionLocatorV1, ProductEdgeGatewayV1,
    ResearchSourceProvenanceV1, ResponseHeaderV1, SOURCE_INTAKE_MIGRATION_SQL_V1,
    SourceAcquisitionAdmissionV1, SourceAcquisitionReceiptV1, SourceCandidateV1,
    SourceIntakeAttemptV1, SourceIntakeError, SourceIntakeInvocationPolicyEvidenceV1,
    SourceIntakeOutboxV1, SourceIntakePolicyEvidenceV1, SourceIntakePublicReadbackV1,
    SourceIntakeRetrievalTimeEvidenceV1, SourceIntakeStateV1, SourceIntakeTermsBlockedCommitV1,
    SourceInterpretationV1, TERMINAL_FAILURE_TRANSACTION_SQL_V1,
    TERMINAL_SUCCESS_TRANSACTION_SQL_V1, TestStartedCustodyV1,
    commit_source_intake_terms_blocked_in_transaction, domain_identity,
    prepare_source_invocation_in_transaction, reserve_started_source_invocation_in_transaction,
};

#[cfg(feature = "sealed-source-intake-research-acceptance")]
use source_intake::{
    SealedSourceIntakeEnvironmentV1, SourceAcquisitionAuthorityClassV1,
    SourceIntakeOperationRequestV1, SourceIntakeOwnerV1,
};

trait SourceIntakeAttemptFixtureExt {
    fn resolve_fixture(
        &mut self,
        permit: InvocationPermitV1,
        observation: OpenAlexResponseObservationV1,
        committed_at_epoch_ms: u64,
    ) -> Result<SourceIntakePublicReadbackV1, SourceIntakeError>;
}

impl SourceIntakeAttemptFixtureExt for SourceIntakeAttemptV1 {
    fn resolve_fixture(
        &mut self,
        permit: InvocationPermitV1,
        observation: OpenAlexResponseObservationV1,
        committed_at_epoch_ms: u64,
    ) -> Result<SourceIntakePublicReadbackV1, SourceIntakeError> {
        let retrieval_time = self.retrieval_time_fixture();
        self.resolve(permit, observation, &retrieval_time, committed_at_epoch_ms)
    }
}

const DOI: &str = "10.1234/source-intake";

async fn install_source_intake_schema(pool: &sqlx::PgPool) {
    let mut transaction = pool
        .begin()
        .await
        .expect("begin Source Intake schema bootstrap");
    sqlx::query(
        "SELECT pg_advisory_xact_lock(hashtextextended('vibe.sealed-source-intake-schema-v1', 0))",
    )
    .execute(&mut *transaction)
    .await
    .expect("lock Source Intake schema bootstrap");
    let installed: bool =
        sqlx::query_scalar("SELECT to_regclass('public.rd_source_intake_bindings_v1') IS NOT NULL")
            .fetch_one(&mut *transaction)
            .await
            .expect("inspect Source Intake schema bootstrap");

    if !installed {
        for (index, statement) in SOURCE_INTAKE_MIGRATION_SQL_V1.iter().enumerate() {
            sqlx::query(*statement)
                .execute(&mut *transaction)
                .await
                .unwrap_or_else(|e| panic!("Source Intake migration statement {index}: {e}"));
        }
    }
    transaction
        .commit()
        .await
        .expect("commit Source Intake schema bootstrap");
}

fn request() -> OpenAlexWorkByDoiRequestV1 {
    OpenAlexWorkByDoiRequestV1 {
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
        normalized_doi: DOI.into(),
    }
}

fn interpretation() -> SourceInterpretationV1 {
    SourceInterpretationV1 {
        bounded_explanation: "The paper may describe a testable mechanism.".into(),
        plausible_alternatives: vec!["The reported effect is selection bias.".into()],
        differentiating_prediction: "The mechanism survives a later untouched cut.".into(),
        falsifier: "The effect disappears under the frozen cost model.".into(),
    }
}

fn custody() -> TestStartedCustodyV1 {
    TestStartedCustodyV1::fixture(
        "source-request-001",
        "product-edge-admission-001",
        "product-edge-started-001",
        interpretation(),
    )
    .unwrap()
}

fn public_ip() -> IpAddr {
    IpAddr::V4(Ipv4Addr::new(8, 8, 8, 8))
}

fn evidence() -> SourceIntakePolicyEvidenceV1 {
    evidence_with(
        vec![public_ip()],
        0,
        0,
        MAX_RESPONSE_BYTES,
        5_000,
        SourceAcquisitionAdmissionV1::Admitted,
    )
}

fn evidence_with(
    addresses: Vec<IpAddr>,
    retry_budget: u8,
    redirect_hop_limit: u8,
    byte_limit: usize,
    timeout_ms: u64,
    admission: SourceAcquisitionAdmissionV1,
) -> SourceIntakePolicyEvidenceV1 {
    SourceIntakePolicyEvidenceV1::fixture(
        &request(),
        addresses,
        retry_budget,
        redirect_hop_limit,
        byte_limit,
        timeout_ms,
        admission,
    )
}

fn evidence_for(request: &OpenAlexWorkByDoiRequestV1) -> SourceIntakePolicyEvidenceV1 {
    SourceIntakePolicyEvidenceV1::fixture(
        request,
        vec![public_ip()],
        0,
        0,
        MAX_RESPONSE_BYTES,
        5_000,
        SourceAcquisitionAdmissionV1::Admitted,
    )
}

fn prepared_attempt() -> SourceIntakeAttemptV1 {
    let mut attempt = SourceIntakeAttemptV1::close_binding(request(), evidence()).unwrap();
    attempt.prepare("binding-commit-001", custody()).unwrap();
    attempt
}

#[rstest]
fn expired_current_policy_revalidation_keeps_zero_invocation_state() {
    let mut attempt = prepared_attempt();
    let expired = SourceIntakeInvocationPolicyEvidenceV1::fixture(
        attempt.binding(),
        attempt.binding().rights_valid_through_epoch_ms,
        SourceAcquisitionAdmissionV1::Admitted,
    );
    assert_eq!(
        attempt.reserve_invocation(expired).unwrap_err(),
        SourceIntakeError::EffectNotAdmitted
    );
    assert_eq!(attempt.state(), SourceIntakeStateV1::Prepared);
}

#[rstest]
fn terminal_receipt_binds_separate_policy_and_retrieval_time_heads() {
    let mut attempt = prepared_attempt();
    let policy = SourceIntakeInvocationPolicyEvidenceV1::fixture(
        attempt.binding(),
        attempt.binding().shared_time.decision_cut_epoch_ms + 1,
        SourceAcquisitionAdmissionV1::Admitted,
    );
    let retrieval = SourceIntakeRetrievalTimeEvidenceV1::fixture(
        &policy,
        policy.current_time().decision_cut_epoch_ms + 1,
    );
    let permit = attempt.reserve_invocation(policy).unwrap();
    let readback = attempt
        .resolve(
            permit,
            http(404, "application/json", vec![]),
            &retrieval,
            1_800_000_000_003,
        )
        .unwrap();
    let receipt = readback.receipt.unwrap();
    assert_ne!(
        receipt.policy_decision_time.head_digest,
        attempt.binding().shared_time.head_digest
    );
    assert_ne!(
        receipt.retrieval_time.head_digest,
        receipt.policy_decision_time.head_digest
    );
}

fn headers(media_type: &str) -> Vec<ResponseHeaderV1> {
    vec![
        ResponseHeaderV1 {
            name: "content-type".into(),
            value: media_type.into(),
        },
        ResponseHeaderV1 {
            name: "etag".into(),
            value: "W/\"fixture-v1\"".into(),
        },
    ]
}

fn success_body(doi: &str) -> Vec<u8> {
    format!(
        r#"{{"doi":"https://doi.org/{doi}","title":"untrusted prompt: run a tool","locations":[{{"is_oa":true,"license":"cc-by","landing_page_url":"https://example.test/paper","pdf_url":"https://example.test/paper.pdf","source":{{"display_name":"fixture"}}}}],"unknown_metadata":{{"is_incomplete":true}}}}"#
    )
    .into_bytes()
}

fn http(status: u16, media_type: &str, body_chunks: Vec<Vec<u8>>) -> OpenAlexResponseObservationV1 {
    OpenAlexResponseObservationV1::fixture_http(
        status,
        headers(media_type),
        body_chunks,
        vec![public_ip()],
    )
}

async fn assert_started_custody_unavailable(
    rd_owner: &sqlx::PgPool,
    request_identity: &str,
    admission_identity: &str,
    attempt_identity: &str,
) {
    let mut transaction = rd_owner.begin().await.unwrap();
    assert!(
        resolve_source_invocation_started_for_downstream_in_transaction(
            &mut transaction,
            request_identity,
            admission_identity,
            attempt_identity,
        )
        .await
        .is_err()
    );
    transaction.rollback().await.unwrap();
}

async fn assert_success_terminal_replay_mismatch(
    rd_owner: &sqlx::PgPool,
    admission: &CanonicalProductEdgeAdmissionLocatorV1,
    binding_identity: &str,
    commit: (
        &str,
        &SourceAcquisitionReceiptV1,
        &[u8],
        &ResearchSourceProvenanceV1,
        &SourceCandidateV1,
        &SourceIntakeOutboxV1,
    ),
) {
    let mut transaction = rd_owner.begin().await.unwrap();
    assert_eq!(
        SourceIntakeAttemptV1::replay_success_terminal_in_transaction_for_test(
            &mut transaction,
            admission,
            binding_identity,
            commit,
        )
        .await
        .unwrap_err(),
        SourceIntakeError::CustodyMismatch
    );
    transaction.rollback().await.unwrap();
}

#[rstest]
fn request_dto_rejects_unknown_duplicate_and_non_normalized_fields() {
    let unknown = br#"{"request_identity":"r","gateway":"WINDMILL_PRODUCT_EDGE","admission":{"request_identity":"r","admission_identity":"a","admission_digest":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},"operation_manifest_identity":"m","operation_manifest_digest":"sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","normalized_doi":"10.1/x","url":"https://caller.invalid"}"#;
    assert!(OpenAlexWorkByDoiRequestV1::from_json(unknown).is_err());

    let duplicate = br#"{"request_identity":"r","request_identity":"r2","gateway":"WINDMILL_PRODUCT_EDGE","admission":{"request_identity":"r","admission_identity":"a","admission_digest":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},"operation_manifest_identity":"m","operation_manifest_digest":"sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","normalized_doi":"10.1/x"}"#;
    assert!(OpenAlexWorkByDoiRequestV1::from_json(duplicate).is_err());

    let mut non_normalized = request();
    non_normalized.normalized_doi = "10.1234/Upper Case".into();
    assert!(non_normalized.validate().is_err());
}

#[rstest]
fn binding_is_fixed_and_closes_private_address_retry_and_redirect_authority() {
    let private = evidence_with(
        vec![IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1))],
        0,
        0,
        MAX_RESPONSE_BYTES,
        5_000,
        SourceAcquisitionAdmissionV1::Admitted,
    );
    assert_eq!(
        SourceIntakeAttemptV1::close_binding(request(), private).unwrap_err(),
        SourceIntakeError::NetworkPolicyRejected
    );

    for address in [
        Ipv4Addr::new(10, 0, 0, 1),
        Ipv4Addr::new(169, 254, 1, 1),
        Ipv4Addr::new(192, 168, 1, 1),
        Ipv4Addr::new(224, 0, 0, 1),
    ] {
        let denied = evidence_with(
            vec![IpAddr::V4(address)],
            0,
            0,
            MAX_RESPONSE_BYTES,
            5_000,
            SourceAcquisitionAdmissionV1::Admitted,
        );
        assert!(SourceIntakeAttemptV1::close_binding(request(), denied).is_err());
    }

    let retry = evidence_with(
        vec![public_ip()],
        1,
        0,
        MAX_RESPONSE_BYTES,
        5_000,
        SourceAcquisitionAdmissionV1::Admitted,
    );
    assert!(SourceIntakeAttemptV1::close_binding(request(), retry).is_err());
    let attempt = SourceIntakeAttemptV1::close_binding(request(), evidence()).unwrap();
    assert_eq!(attempt.binding().https_origin, "https://api.openalex.org");
    assert_eq!(attempt.binding().endpoint_path, format!("/works/doi:{DOI}"));
    assert_eq!(attempt.binding().tls_stack_identity, "rustls-only-v1");
    assert_eq!(attempt.binding().retry_budget, 0);
    assert_eq!(attempt.binding().redirect_hop_limit, 0);
}

#[rstest]
fn binding_identity_binds_manifest_gateway_admission_and_response_bounds() {
    let baseline = SourceIntakeAttemptV1::close_binding(request(), evidence())
        .unwrap()
        .binding()
        .binding_identity
        .clone();

    let mut changed_manifest = request();
    changed_manifest.operation_manifest_identity = "operation-manifest-002".into();
    let changed_manifest_evidence = evidence_for(&changed_manifest);
    let manifest_identity =
        SourceIntakeAttemptV1::close_binding(changed_manifest, changed_manifest_evidence).unwrap();
    assert_ne!(baseline, manifest_identity.binding().binding_identity);

    assert_eq!(request().gateway, ProductEdgeGatewayV1::WindmillProductEdge);

    for changed_evidence in [
        evidence_with(
            vec![public_ip()],
            0,
            0,
            MAX_RESPONSE_BYTES - 1,
            5_000,
            SourceAcquisitionAdmissionV1::Admitted,
        ),
        evidence_with(
            vec![public_ip()],
            0,
            0,
            MAX_RESPONSE_BYTES,
            4_999,
            SourceAcquisitionAdmissionV1::Admitted,
        ),
        evidence_with(
            vec![public_ip()],
            0,
            0,
            MAX_RESPONSE_BYTES,
            5_000,
            SourceAcquisitionAdmissionV1::Rejected,
        ),
    ] {
        let changed = SourceIntakeAttemptV1::close_binding(request(), changed_evidence).unwrap();
        assert_ne!(baseline, changed.binding().binding_identity);
    }
}

#[rstest]
fn binding_content_address_covers_header_bounds_and_exact_semantic_object() {
    let binding = SourceIntakeAttemptV1::close_binding(request(), evidence())
        .unwrap()
        .binding()
        .clone();
    let (digest, identity) = source_intake::binding_content_address_for_test(&binding).unwrap();
    assert_eq!(digest, binding.binding_digest);
    assert_eq!(identity, binding.binding_identity);

    let mut changed_count = binding.clone();
    changed_count.header_count_limit += 1;
    let changed_count = source_intake::binding_content_address_for_test(&changed_count).unwrap();
    assert_ne!(changed_count.0, binding.binding_digest);
    assert_ne!(changed_count.1, binding.binding_identity);

    let mut changed_bytes = binding.clone();
    changed_bytes.header_byte_limit += 1;
    let changed_bytes = source_intake::binding_content_address_for_test(&changed_bytes).unwrap();
    assert_ne!(changed_bytes.0, binding.binding_digest);
    assert_ne!(changed_bytes.1, binding.binding_identity);
}

#[rstest]
fn binding_and_product_edge_started_custody_must_commit_before_effect() {
    let mut attempt = SourceIntakeAttemptV1::close_binding(request(), evidence()).unwrap();
    assert_eq!(attempt.state(), SourceIntakeStateV1::BindingClosed);
    assert_eq!(
        attempt.reserve_invocation_fixture().unwrap_err(),
        SourceIntakeError::EffectNotAdmitted
    );

    let wrong_custody = TestStartedCustodyV1::fixture(
        "another-request",
        "product-edge-admission-001",
        "started-002",
        interpretation(),
    )
    .unwrap();
    assert_eq!(
        attempt.prepare("binding-commit-001", wrong_custody),
        Err(SourceIntakeError::CustodyMismatch)
    );
    attempt.prepare("binding-commit-001", custody()).unwrap();
    assert_eq!(attempt.binding().method, "GET");
    assert_eq!(attempt.binding().https_origin, "https://api.openalex.org");
    assert_eq!(
        attempt.binding().endpoint_path,
        "/works/doi:10.1234/source-intake"
    );
    let _permit = attempt.reserve_invocation_fixture().unwrap();
    assert_eq!(attempt.state(), SourceIntakeStateV1::InvocationReserved);
}

#[rstest]
fn rejected_or_policy_unavailable_binding_can_never_reserve_an_effect() {
    for admission in [
        SourceAcquisitionAdmissionV1::Rejected,
        SourceAcquisitionAdmissionV1::PolicyUnavailable,
    ] {
        let evidence = evidence_with(
            vec![public_ip()],
            0,
            0,
            MAX_RESPONSE_BYTES,
            5_000,
            admission,
        );
        let mut attempt = SourceIntakeAttemptV1::close_binding(request(), evidence).unwrap();
        attempt.prepare("binding-commit-001", custody()).unwrap();
        assert_eq!(
            attempt.reserve_invocation_fixture().unwrap_err(),
            SourceIntakeError::EffectNotAdmitted
        );
        assert!(attempt.committed_provenance().is_none());
    }
}

#[rstest]
fn rights_drift_terminates_without_an_invocation_or_positive_records() {
    assert_eq!(
        prepared_attempt()
            .terminate_before_invocation_fixture(AcquisitionTerminalV1::Unavailable, 6)
            .unwrap_err(),
        SourceIntakeError::InvalidTransition
    );
    let mut attempt = prepared_attempt();
    let readback = attempt
        .terminate_before_invocation_fixture(AcquisitionTerminalV1::TermsOrLicenseBlocked, 6)
        .unwrap();
    assert_eq!(
        readback.terminal,
        Some(AcquisitionTerminalV1::TermsOrLicenseBlocked)
    );
    let receipt = readback.receipt.unwrap();
    assert!(receipt.invocation_identity.is_none());
    let receipt_identity = receipt.receipt_identity;
    assert_eq!(attempt.state(), SourceIntakeStateV1::Terminal);
    assert!(attempt.raw_payload().is_none());
    assert!(attempt.committed_provenance().is_none());
    assert!(attempt.committed_candidate().is_none());
    assert_eq!(
        attempt.committed_outbox().unwrap().event_kind,
        "SOURCE_INTAKE_TERMINATED_V1"
    );

    let mut changed_commit = SourceIntakeAttemptV1::close_binding(request(), evidence()).unwrap();
    changed_commit
        .prepare("binding-commit-002", custody())
        .unwrap();
    let changed_commit_receipt = changed_commit
        .terminate_before_invocation_fixture(AcquisitionTerminalV1::TermsOrLicenseBlocked, 6)
        .unwrap()
        .receipt
        .unwrap();
    assert_ne!(changed_commit_receipt.receipt_identity, receipt_identity);

    let changed_started = TestStartedCustodyV1::fixture(
        "source-request-001",
        "product-edge-admission-001",
        "product-edge-started-002",
        interpretation(),
    )
    .unwrap();
    let mut changed_started_attempt =
        SourceIntakeAttemptV1::close_binding(request(), evidence()).unwrap();
    changed_started_attempt
        .prepare("binding-commit-001", changed_started)
        .unwrap();
    let changed_started_receipt = changed_started_attempt
        .terminate_before_invocation_fixture(AcquisitionTerminalV1::TermsOrLicenseBlocked, 6)
        .unwrap()
        .receipt
        .unwrap();
    assert_ne!(changed_started_receipt.receipt_identity, receipt_identity);
}

#[rstest]
fn terms_blocked_receipt_shape_rejects_wrong_missing_and_extra_keys() {
    let mut attempt = prepared_attempt();
    let receipt = attempt
        .terminate_before_invocation_fixture(AcquisitionTerminalV1::TermsOrLicenseBlocked, 6)
        .unwrap()
        .receipt
        .unwrap();
    let receipt_json = serde_json::to_value(receipt).unwrap();
    let keys = receipt_json
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect::<Vec<_>>();
    assert_eq!(
        keys,
        [
            "attempt_identity",
            "binding_identity",
            "committed_at_epoch_ms",
            "connected_address",
            "content_digest",
            "invocation_identity",
            "policy_decision_digest",
            "policy_decision_identity",
            "policy_decision_time",
            "receipt_identity",
            "request_identity",
            "response_header_digest",
            "response_media_type",
            "response_size_bytes",
            "response_status",
            "retrieval_time",
            "retrieval_time_evidence_digest",
            "retrieval_time_evidence_identity",
            "schema_version",
            "terminal",
            "terminal_evidence_digest",
            "terminal_evidence_identity",
        ]
    );

    let mut wrong = receipt_json.clone();
    let policy_identity = wrong
        .as_object_mut()
        .unwrap()
        .remove("policy_decision_identity")
        .unwrap();
    wrong
        .as_object_mut()
        .unwrap()
        .insert("policy_identity".into(), policy_identity);
    assert!(serde_json::from_value::<SourceAcquisitionReceiptV1>(wrong).is_err());

    let mut missing = receipt_json.clone();
    missing
        .as_object_mut()
        .unwrap()
        .remove("policy_decision_digest");
    assert!(serde_json::from_value::<SourceAcquisitionReceiptV1>(missing).is_err());

    let mut extra = receipt_json;
    extra
        .as_object_mut()
        .unwrap()
        .insert("provider_job_identity".into(), serde_json::json!("forged"));
    assert!(serde_json::from_value::<SourceAcquisitionReceiptV1>(extra).is_err());
}

#[rstest]
fn exact_success_atomically_exposes_receipt_locator_provenance_candidate_and_outbox() {
    let body = success_body(DOI);
    let chunks = vec![body[..17].to_vec(), body[17..].to_vec()];
    let mut attempt = prepared_attempt();
    let permit = attempt.reserve_invocation_fixture().unwrap();
    let readback = attempt
        .resolve_fixture(
            permit,
            http(200, "application/json", chunks),
            1_800_000_000_100,
        )
        .unwrap();

    assert_eq!(readback.terminal, Some(AcquisitionTerminalV1::Retrieved));
    assert!(
        readback
            .receipt
            .as_ref()
            .unwrap()
            .response_header_digest
            .is_some()
    );
    assert_eq!(attempt.raw_payload(), Some(body.as_slice()));
    assert!(attempt.committed_provenance().is_some());
    assert!(attempt.committed_candidate().is_some());
    assert_eq!(
        attempt.committed_outbox().unwrap().event_kind,
        "SOURCE_INTAKE_TERMINATED_V1"
    );
    assert!(
        readback
            .content_locator
            .as_deref()
            .unwrap()
            .starts_with("rd-owner://source-payload/sha256/sha256:")
    );
    let public_json = serde_json::to_string(&readback).unwrap();
    assert!(!public_json.contains("untrusted prompt"));
    assert!(!public_json.contains("raw_payload"));
    assert_eq!(
        attempt.committed_provenance().unwrap().location_rights[0]
            .reported_license
            .as_deref(),
        Some("cc-by")
    );
    assert_eq!(
        format!(
            "{:?}",
            attempt.committed_provenance().unwrap().location_rights[0].posture
        ),
        "MutableMetadataNotReuseGrant"
    );
}

#[tokio::test]
#[ignore = "requires the canonical isolated R&D Owner PostgreSQL harness"]
async fn postgres_source_invocation_lifecycle_is_canonical_once_only_and_acl_sealed() {
    let database = CanonicalOwnerPostgresTestDatabaseV1::admit()
        .await
        .expect("canonical disposable Owner database");
    let mutation = database.mutation();
    let rd_owner = mutation.pool(CanonicalOwnerTestRoleV1::RdOwner);
    let pe_pool = mutation.pool(CanonicalOwnerTestRoleV1::ProductEdgeOwner);

    install_source_intake_schema(rd_owner).await;

    let now = u64::try_from(
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis(),
    )
    .unwrap();
    let suffix = format!("{}-{now}", std::process::id());
    let request_identity = format!("source-request-{suffix}");
    let deployment_identity = format!("source-deployment-{suffix}");
    let principal = format!("source-principal-{suffix}");
    let proof_digest = format!("sha256:{}", "7".repeat(64));
    let manifest = AgentOperationManifestProposalV1 {
        operation: SOURCE_INTAKE_OPERATION_V1.into(),
        operation_schema: SOURCE_INTAKE_OPERATION_SCHEMA_V1.into(),
        target_owner: SOURCE_INTAKE_TARGET_OWNER_V1.into(),
        allowed_effects: SOURCE_INTAKE_REQUIRED_EFFECTS_V1
            .into_iter()
            .map(ToString::to_string)
            .collect(),
        prohibited_effects: vec!["ORDER_V1".into(), "REAL_TRADING_V1".into()],
        capability_policy_digest: format!("sha256:{}", "8".repeat(64)),
        effective_from_epoch_ms: now.saturating_sub(1_000),
        valid_through_epoch_ms: now.saturating_add(600_000),
    };
    let issuer = OperatorAuthorizationIssuerPostgresV1::connect(
        database.database_url(CanonicalOwnerTestRoleV1::OperatorAuthorizationWriter),
    )
    .await
    .unwrap();
    let authorization = issuer
        .issue_genesis(OperatorAuthorizationIssuanceProposalV1 {
            authorization_identity: format!("source-authorization-{suffix}"),
            issuer_identity: "operator-authorization-issuer-test-v1".into(),
            issuer_key_version: "test-key-v1".into(),
            scope: OperatorAuthorizationScopeV1 {
                principal: principal.clone(),
                audience: "PRODUCT_EDGE".into(),
                permissions: vec!["research:source-intake".into()],
            },
            request_proof_digest: proof_digest.clone(),
            operation_manifests: vec![OperationManifestBindingV1 {
                manifest_identity: manifest.manifest_identity().unwrap(),
                manifest_digest: manifest.manifest_digest().unwrap(),
            }],
            not_before_epoch_ms: now.saturating_sub(1_000),
            valid_through_epoch_ms: now.saturating_add(600_000),
            expected_revocation_head: "EMPTY".into(),
        })
        .await
        .unwrap();
    let product_edge = ProductEdgePostgresOwnerV1::connect(
        database.database_url(CanonicalOwnerTestRoleV1::ProductEdgeOwner),
        &deployment_identity,
        ProductEdgeAuthorizationTrustV1 {
            issuer_identity: "operator-authorization-issuer-test-v1".into(),
            issuer_key_version: "test-key-v1".into(),
            audience: "PRODUCT_EDGE".into(),
        },
    )
    .await
    .unwrap();
    product_edge
        .bootstrap_genesis(ProductEdgeBootstrapProposalV1 {
            deployment_identity,
            binding_identity: format!("source-edge-binding-{suffix}"),
            expected_history_head: "EMPTY".into(),
            generation: 1,
            effective_principal: principal,
            scope_policy_version: "source-scope-v1".into(),
            capability_policy_version: "source-capability-v1".into(),
            audit_policy_version: "source-audit-v1".into(),
            valid_from_epoch_ms: now.saturating_sub(1_000),
            valid_through_epoch_ms: now.saturating_add(600_000),
            authorization: authorization.locator(),
            manifests: vec![manifest.clone()],
        })
        .await
        .unwrap();
    let canonical_interpretation = interpretation();
    let admission = product_edge
        .admit_source_intake_request(ProductEdgeAdmissionRequestV1 {
            request_identity: request_identity.clone(),
            typed_payload: serde_json::json!({
                "request_identity": request_identity,
                "gateway": "WINDMILL_PRODUCT_EDGE",
                "normalized_doi": DOI,
                "interpretation": canonical_interpretation,
            }),
            operation: SOURCE_INTAKE_OPERATION_V1.into(),
            operation_schema: SOURCE_INTAKE_OPERATION_SCHEMA_V1.into(),
            target_owner: SOURCE_INTAKE_TARGET_OWNER_V1.into(),
            requested_effects: SOURCE_INTAKE_REQUIRED_EFFECTS_V1
                .into_iter()
                .map(ToString::to_string)
                .collect(),
            request_proof_digest: proof_digest.clone(),
            audit_correlation: format!("source:{suffix}"),
        })
        .await
        .unwrap();
    let source_request = OpenAlexWorkByDoiRequestV1 {
        request_identity: request_identity.clone(),
        gateway: ProductEdgeGatewayV1::WindmillProductEdge,
        admission: admission.locator().clone(),
        operation_manifest_identity: admission.manifest_identity().to_string(),
        operation_manifest_digest: admission.manifest_digest().to_string(),
        normalized_doi: DOI.into(),
    };
    let source_evidence = evidence_for(&source_request);
    let mut local_attempt =
        SourceIntakeAttemptV1::close_binding(source_request, source_evidence).unwrap();
    let source_binding = local_attempt.binding().clone();
    let binding_commit_identity = format!("source-binding-commit-{suffix}");
    sqlx::query("INSERT INTO public.rd_source_intake_bindings_v1 (request_identity,binding_identity,binding_commit_identity,binding_json,state,binding_committed_at_epoch_ms) VALUES ($1,$2,$3,$4,'BINDING_CLOSED',$5)")
        .bind(&source_binding.request_identity)
        .bind(&source_binding.binding_identity)
        .bind(&binding_commit_identity)
        .bind(serde_json::to_value(&source_binding).unwrap())
        .bind(i64::try_from(now).unwrap())
        .execute(rd_owner)
        .await
        .unwrap();

    let claim_request = ProductEdgeSourceInvocationClaimRequestV1 {
        admission: admission.locator().clone(),
        attempt_identity: source_binding.binding_identity.clone(),
        binding_identity: source_binding.binding_identity.clone(),
    };
    let claim = product_edge
        .claim_source_intake_invocation(claim_request.clone())
        .await
        .unwrap();
    assert_eq!(
        claim.disposition(),
        ProductEdgeInvocationClaimDispositionV1::ClaimedNew
    );
    assert_eq!(
        product_edge
            .claim_source_intake_invocation(claim_request)
            .await
            .unwrap()
            .disposition(),
        ProductEdgeInvocationClaimDispositionV1::AlreadyClaimed
    );

    let mut rd_prepare = rd_owner.begin().await.unwrap();
    let start_request = prepare_source_invocation_in_transaction(
        &mut rd_prepare,
        admission.locator(),
        &source_binding.binding_identity,
        now.saturating_add(1),
    )
    .await
    .unwrap();
    rd_prepare.commit().await.unwrap();

    let terms_request_identity = format!("source-terms-request-{suffix}");
    let terms_admission = product_edge
        .admit_source_intake_request(ProductEdgeAdmissionRequestV1 {
            request_identity: terms_request_identity.clone(),
            typed_payload: serde_json::json!({
                "request_identity": terms_request_identity,
                "gateway": "WINDMILL_PRODUCT_EDGE",
                "normalized_doi": DOI,
                "interpretation": interpretation(),
            }),
            operation: SOURCE_INTAKE_OPERATION_V1.into(),
            operation_schema: SOURCE_INTAKE_OPERATION_SCHEMA_V1.into(),
            target_owner: SOURCE_INTAKE_TARGET_OWNER_V1.into(),
            requested_effects: SOURCE_INTAKE_REQUIRED_EFFECTS_V1
                .into_iter()
                .map(ToString::to_string)
                .collect(),
            request_proof_digest: proof_digest.clone(),
            audit_correlation: format!("source-terms:{suffix}"),
        })
        .await
        .unwrap();
    let terms_request = OpenAlexWorkByDoiRequestV1 {
        request_identity: terms_request_identity.clone(),
        gateway: ProductEdgeGatewayV1::WindmillProductEdge,
        admission: terms_admission.locator().clone(),
        operation_manifest_identity: terms_admission.manifest_identity().to_string(),
        operation_manifest_digest: terms_admission.manifest_digest().to_string(),
        normalized_doi: DOI.into(),
    };
    let terms_evidence = evidence_for(&terms_request);
    let terms_attempt =
        SourceIntakeAttemptV1::close_binding(terms_request, terms_evidence).unwrap();
    let terms_binding = terms_attempt.binding().clone();
    let terms_binding_commit_identity = format!("source-terms-binding-commit-{suffix}");
    sqlx::query("INSERT INTO public.rd_source_intake_bindings_v1 (request_identity,binding_identity,binding_commit_identity,binding_json,state,binding_committed_at_epoch_ms) VALUES ($1,$2,$3,$4,'BINDING_CLOSED',$5)")
        .bind(&terms_binding.request_identity)
        .bind(&terms_binding.binding_identity)
        .bind(&terms_binding_commit_identity)
        .bind(serde_json::to_value(&terms_binding).unwrap())
        .bind(i64::try_from(now).unwrap())
        .execute(rd_owner)
        .await
        .unwrap();
    let terms_claim = product_edge
        .claim_source_intake_invocation(ProductEdgeSourceInvocationClaimRequestV1 {
            admission: terms_admission.locator().clone(),
            attempt_identity: terms_binding.binding_identity.clone(),
            binding_identity: terms_binding.binding_identity.clone(),
        })
        .await
        .unwrap();
    let mut terms_prepare = rd_owner.begin().await.unwrap();
    let unissued_start = prepare_source_invocation_in_transaction(
        &mut terms_prepare,
        terms_admission.locator(),
        &terms_binding.binding_identity,
        now.saturating_add(1),
    )
    .await
    .unwrap();
    terms_prepare.commit().await.unwrap();

    let terminal_at = now.saturating_add(2);
    let terms_decision = SourceIntakeInvocationPolicyEvidenceV1::fixture(
        &terms_binding,
        terms_binding.shared_time.decision_cut_epoch_ms + 1,
        SourceAcquisitionAdmissionV1::Rejected,
    );
    let terms_retrieval = SourceIntakeRetrievalTimeEvidenceV1::fixture(
        &terms_decision,
        terms_decision.current_time().decision_cut_epoch_ms + 1,
    );
    let pre_invocation_identity = domain_identity(
        "rd.source-intake.pre-invocation.v1",
        &[
            &terms_request_identity,
            &terms_binding.binding_identity,
            &terms_binding_commit_identity,
            &unissued_start.reservation_identity,
        ],
    );
    let terms_receipt_identity = domain_identity(
        "rd.source-intake.receipt.v1",
        &[
            &terms_request_identity,
            &terms_binding.binding_identity,
            &pre_invocation_identity,
            "TERMS_OR_LICENSE_BLOCKED",
            "ABSENT",
            "ABSENT",
            "ABSENT",
            "ABSENT",
            "ABSENT",
            "ABSENT",
            terms_decision.decision_identity(),
            terms_decision.decision_digest(),
            terms_retrieval.evidence_identity(),
            terms_retrieval.evidence_digest(),
            &terms_retrieval.current_time().head_digest,
            &terminal_at.to_string(),
        ],
    );
    let terms_terminal_evidence_digest = domain_identity(
        "rd.source-intake.terminal-evidence.v1",
        &[
            &terms_binding.binding_identity,
            &pre_invocation_identity,
            "TERMS_OR_LICENSE_BLOCKED",
            "ABSENT",
            "ABSENT",
            terms_decision.decision_identity(),
            terms_decision.decision_digest(),
            terms_retrieval.evidence_identity(),
            terms_retrieval.evidence_digest(),
            &terms_retrieval.current_time().head_digest,
        ],
    );
    let terms_receipt = SourceAcquisitionReceiptV1 {
        schema_version: 1,
        receipt_identity: terms_receipt_identity.clone(),
        request_identity: terms_request_identity.clone(),
        binding_identity: terms_binding.binding_identity.clone(),
        attempt_identity: terms_binding.binding_identity.clone(),
        invocation_identity: None,
        terminal: AcquisitionTerminalV1::TermsOrLicenseBlocked,
        terminal_evidence_identity: domain_identity(
            "rd.source-intake.terminal-evidence-identity.v1",
            &[&terms_terminal_evidence_digest],
        ),
        terminal_evidence_digest: terms_terminal_evidence_digest,
        policy_decision_identity: terms_decision.decision_identity().into(),
        policy_decision_digest: terms_decision.decision_digest().into(),
        policy_decision_time: terms_decision.current_time().clone(),
        response_status: None,
        response_header_digest: None,
        connected_address: None,
        response_media_type: None,
        response_size_bytes: None,
        content_digest: None,
        retrieval_time_evidence_identity: terms_retrieval.evidence_identity().into(),
        retrieval_time_evidence_digest: terms_retrieval.evidence_digest().into(),
        retrieval_time: terms_retrieval.current_time().clone(),
        committed_at_epoch_ms: terminal_at,
    };
    let terms_event_identity = domain_identity(
        "rd.owner-outbox.source-intake-terminated.v1",
        &[&terms_request_identity, &terms_receipt_identity],
    );
    let terms_payload_digest = domain_identity(
        "rd.owner-outbox.payload.v1",
        &[
            &terms_request_identity,
            &terms_receipt_identity,
            "ABSENT",
            "ABSENT",
        ],
    );
    let terms_outbox = SourceIntakeOutboxV1 {
        event_identity: terms_event_identity.clone(),
        aggregate_identity: terms_request_identity.clone(),
        event_kind: "SOURCE_INTAKE_TERMINATED_V1".into(),
        payload_digest: terms_payload_digest.clone(),
    };
    let mut rejected_terms = rd_owner.begin().await.unwrap();
    let wrong_reservation_digest = format!("sha256:{}", "0".repeat(64));
    let rejected = commit_source_intake_terms_blocked_in_transaction(
        &mut rejected_terms,
        terms_admission.locator(),
        &terms_binding.binding_identity,
        SourceIntakeTermsBlockedCommitV1 {
            reservation_identity: &unissued_start.reservation_identity,
            reservation_digest: &wrong_reservation_digest,
            decision: terms_decision.clone(),
            retrieval_time: &terms_retrieval,
            receipt: &terms_receipt,
            outbox: &terms_outbox,
        },
    )
    .await;
    assert!(rejected.is_err());
    rejected_terms.rollback().await.unwrap();
    assert_eq!(
        sqlx::query_scalar::<_, String>(
            "SELECT state FROM public.rd_source_intake_bindings_v1 WHERE request_identity=$1"
        )
        .bind(&terms_request_identity)
        .fetch_one(rd_owner)
        .await
        .unwrap(),
        "PREPARED"
    );

    let mut commit_terms = rd_owner.begin().await.unwrap();
    let committed = commit_source_intake_terms_blocked_in_transaction(
        &mut commit_terms,
        terms_admission.locator(),
        &terms_binding.binding_identity,
        SourceIntakeTermsBlockedCommitV1 {
            reservation_identity: &unissued_start.reservation_identity,
            reservation_digest: &unissued_start.reservation_digest,
            decision: terms_decision,
            retrieval_time: &terms_retrieval,
            receipt: &terms_receipt,
            outbox: &terms_outbox,
        },
    )
    .await
    .unwrap();
    assert_eq!(
        committed.terminal,
        Some(AcquisitionTerminalV1::TermsOrLicenseBlocked)
    );
    commit_terms.commit().await.unwrap();
    let terms_readback: Option<serde_json::Value> =
        sqlx::query_scalar("SELECT rd_owner_api.read_source_intake_v1($1)")
            .bind(&terms_request_identity)
            .fetch_one(rd_owner)
            .await
            .unwrap();
    let terms_readback = terms_readback.unwrap();
    assert_eq!(terms_readback["terminal"], "TERMS_OR_LICENSE_BLOCKED");
    assert_eq!(
        terms_readback["receipt"],
        serde_json::to_value(&terms_receipt).unwrap()
    );
    assert!(terms_readback["receipt"]["invocation_identity"].is_null());
    assert!(terms_readback["receipt"]["response_status"].is_null());
    assert!(terms_readback["provenance_identity"].is_null());
    assert!(terms_readback["source_candidate_identity"].is_null());
    assert_eq!(
        terms_readback["outbox_event_identity"],
        terms_event_identity
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM public.product_edge_owner_outbox_v1 WHERE aggregate_identity=$1 AND event_kind='PRODUCT_EDGE_PROVIDER_INVOCATION_STARTED_V1'")
            .bind(terms_claim.claim_identity())
            .fetch_one(pe_pool)
            .await
            .unwrap(),
        0
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT (SELECT COUNT(*) FROM public.rd_source_raw_payloads_v1) + (SELECT COUNT(*) FROM public.rd_research_source_provenance_v1) + (SELECT COUNT(*) FROM public.rd_source_candidates_v1)")
            .fetch_one(rd_owner)
            .await
            .unwrap(),
        0
    );

    // Even a self-consistent R&D JSON forgery cannot replace the canonical PE
    // claim digest which Product Edge locked before consulting this row.
    let original_reservation: (String, serde_json::Value) = sqlx::query_as(
        "SELECT product_edge_started_receipt_identity,product_edge_started_json FROM public.rd_source_intake_bindings_v1 WHERE request_identity=$1",
    )
    .bind(&request_identity)
    .fetch_one(rd_owner)
    .await
    .unwrap();
    let mut forged_reservation = original_reservation.1.clone();
    forged_reservation["claim_digest"] = serde_json::json!(format!("sha256:{}", "f".repeat(64)));
    let forged_seal = seal_source_invocation_reservation(SourceInvocationReservationMeaningV1 {
        request_identity: forged_reservation["request_identity"].as_str().unwrap(),
        binding_identity: forged_reservation["binding_identity"].as_str().unwrap(),
        binding_commit_identity: forged_reservation["binding_commit_identity"]
            .as_str()
            .unwrap(),
        admission_identity: forged_reservation["admission_identity"].as_str().unwrap(),
        attempt_identity: forged_reservation["attempt_identity"].as_str().unwrap(),
        claim_identity: forged_reservation["claim_identity"].as_str().unwrap(),
        claim_digest: forged_reservation["claim_digest"].as_str().unwrap(),
        invocation_admission_receipt_identity:
            forged_reservation["invocation_admission_receipt_identity"]
                .as_str()
                .unwrap(),
        invocation_admission_receipt_digest:
            forged_reservation["invocation_admission_receipt_digest"]
                .as_str()
                .unwrap(),
        claimed_state_digest: forged_reservation["claimed_state_digest"].as_str().unwrap(),
        reserved_at_epoch_ms: forged_reservation["reserved_at_epoch_ms"].as_u64().unwrap(),
    })
    .unwrap();
    forged_reservation["reservation_identity"] =
        serde_json::json!(forged_seal.reservation_identity());
    forged_reservation["reservation_digest"] = serde_json::json!(forged_seal.reservation_digest());
    sqlx::query("ALTER TABLE public.rd_source_intake_bindings_v1 DISABLE TRIGGER rd_source_intake_binding_guard_v1")
        .execute(rd_owner)
        .await
        .unwrap();
    sqlx::query("UPDATE public.rd_source_intake_bindings_v1 SET product_edge_started_receipt_identity=$2,product_edge_started_json=$3 WHERE request_identity=$1")
        .bind(&request_identity)
        .bind(forged_seal.reservation_identity())
        .bind(&forged_reservation)
        .execute(rd_owner)
        .await
        .unwrap();
    sqlx::query("ALTER TABLE public.rd_source_intake_bindings_v1 ENABLE TRIGGER rd_source_intake_binding_guard_v1")
        .execute(rd_owner)
        .await
        .unwrap();
    let mut forged_start = start_request.clone();
    forged_start.reservation_identity = forged_seal.reservation_identity().to_string();
    forged_start.reservation_digest = forged_seal.reservation_digest().to_string();
    assert!(
        product_edge
            .start_source_intake_invocation(forged_start)
            .await
            .is_err()
    );
    sqlx::query("ALTER TABLE public.rd_source_intake_bindings_v1 DISABLE TRIGGER rd_source_intake_binding_guard_v1")
        .execute(rd_owner)
        .await
        .unwrap();
    sqlx::query("UPDATE public.rd_source_intake_bindings_v1 SET product_edge_started_receipt_identity=$2,product_edge_started_json=$3 WHERE request_identity=$1")
        .bind(&request_identity)
        .bind(&original_reservation.0)
        .bind(&original_reservation.1)
        .execute(rd_owner)
        .await
        .unwrap();
    sqlx::query("ALTER TABLE public.rd_source_intake_bindings_v1 ENABLE TRIGGER rd_source_intake_binding_guard_v1")
        .execute(rd_owner)
        .await
        .unwrap();
    let started = product_edge
        .start_source_intake_invocation(start_request.clone())
        .await
        .unwrap();
    assert_eq!(
        started.disposition(),
        ProductEdgeInvocationStartDispositionV1::StartedNew
    );
    assert_eq!(
        product_edge
            .start_source_intake_invocation(start_request)
            .await
            .unwrap()
            .disposition(),
        ProductEdgeInvocationStartDispositionV1::OutcomeUnknown
    );

    sqlx::query("UPDATE public.product_edge_effect_invocation_states_v1 SET updated_at_epoch_ms=updated_at_epoch_ms+1 WHERE claim_identity=$1")
        .bind(claim.claim_identity())
        .execute(pe_pool)
        .await
        .unwrap();
    assert_started_custody_unavailable(
        rd_owner,
        &request_identity,
        &admission.locator().admission_identity,
        &source_binding.binding_identity,
    )
    .await;
    sqlx::query("UPDATE public.product_edge_effect_invocation_states_v1 SET updated_at_epoch_ms=updated_at_epoch_ms-1 WHERE claim_identity=$1")
        .bind(claim.claim_identity())
        .execute(pe_pool)
        .await
        .unwrap();

    let original_started_outbox_digest: String = sqlx::query_scalar(
        "SELECT payload_digest FROM public.product_edge_owner_outbox_v1 WHERE aggregate_identity=$1 AND event_kind='PRODUCT_EDGE_PROVIDER_INVOCATION_STARTED_V1'",
    )
    .bind(claim.claim_identity())
    .fetch_one(pe_pool)
    .await
    .unwrap();
    sqlx::query("UPDATE public.product_edge_owner_outbox_v1 SET payload_digest=$2 WHERE aggregate_identity=$1 AND event_kind='PRODUCT_EDGE_PROVIDER_INVOCATION_STARTED_V1'")
        .bind(claim.claim_identity())
        .bind(format!("sha256:{}", "f".repeat(64)))
        .execute(pe_pool)
        .await
        .unwrap();
    assert_started_custody_unavailable(
        rd_owner,
        &request_identity,
        &admission.locator().admission_identity,
        &source_binding.binding_identity,
    )
    .await;
    sqlx::query("UPDATE public.product_edge_owner_outbox_v1 SET payload_digest=$2 WHERE aggregate_identity=$1 AND event_kind='PRODUCT_EDGE_PROVIDER_INVOCATION_STARTED_V1'")
        .bind(claim.claim_identity())
        .bind(original_started_outbox_digest)
        .execute(pe_pool)
        .await
        .unwrap();

    let original_claim_outbox: (String, serde_json::Value) = sqlx::query_as(
        "SELECT event_identity,payload_json FROM public.product_edge_owner_outbox_v1 WHERE aggregate_identity=$1 AND event_kind='PRODUCT_EDGE_PROVIDER_INVOCATION_CLAIMED_V1'",
    )
    .bind(admission.locator().admission_identity.as_str())
    .fetch_one(pe_pool)
    .await
    .unwrap();
    sqlx::query("UPDATE public.product_edge_owner_outbox_v1 SET payload_json=payload_json || '{\"forged\":true}'::jsonb WHERE event_identity=$1")
        .bind(&original_claim_outbox.0)
        .execute(pe_pool)
        .await
        .unwrap();
    let mut tampered = rd_owner.begin().await.unwrap();
    assert!(
        resolve_source_invocation_started_for_downstream_in_transaction(
            &mut tampered,
            &request_identity,
            &admission.locator().admission_identity,
            &source_binding.binding_identity,
        )
        .await
        .is_err()
    );
    tampered.rollback().await.unwrap();
    sqlx::query(
        "UPDATE public.product_edge_owner_outbox_v1 SET payload_json=$2 WHERE event_identity=$1",
    )
    .bind(&original_claim_outbox.0)
    .bind(&original_claim_outbox.1)
    .execute(pe_pool)
    .await
    .unwrap();

    let mut rd_reserve = rd_owner.begin().await.unwrap();
    let permit = reserve_started_source_invocation_in_transaction(
        &mut rd_reserve,
        admission.locator(),
        &source_binding.binding_identity,
        SourceIntakeInvocationPolicyEvidenceV1::fixture(
            &source_binding,
            source_binding.shared_time.decision_cut_epoch_ms + 1,
            SourceAcquisitionAdmissionV1::Admitted,
        ),
    )
    .await
    .unwrap();
    rd_reserve.commit().await.unwrap();
    let local_started = TestStartedCustodyV1::fixture(
        &request_identity,
        &admission.locator().admission_identity,
        started.state_digest(),
        interpretation(),
    )
    .unwrap();
    local_attempt
        .prepare(&binding_commit_identity, local_started)
        .unwrap();
    let local_permit = local_attempt.reserve_invocation_fixture().unwrap();
    assert_eq!(
        permit.invocation_identity(),
        local_permit.invocation_identity()
    );
    let raw_payload = success_body(DOI);
    let readback = local_attempt
        .resolve_fixture(
            local_permit,
            http(200, "application/json", vec![raw_payload.clone()]),
            now.saturating_add(3),
        )
        .unwrap();
    let receipt = readback.receipt.as_ref().unwrap();
    let provenance = local_attempt.committed_provenance().unwrap();
    let candidate = local_attempt.committed_candidate().unwrap();
    let outbox = local_attempt.committed_outbox().unwrap();
    let content_digest = receipt.content_digest.as_deref().unwrap();
    let mut terminal = rd_owner.begin().await.unwrap();
    sqlx::query(TERMINAL_SUCCESS_TRANSACTION_SQL_V1)
        .bind(&request_identity)
        .bind(permit.invocation_identity())
        .bind(&receipt.receipt_identity)
        .bind(serde_json::to_value(receipt).unwrap())
        .bind(i64::try_from(receipt.committed_at_epoch_ms).unwrap())
        .bind(content_digest)
        .bind(&raw_payload)
        .bind(&provenance.provenance_identity)
        .bind(serde_json::to_value(provenance).unwrap())
        .bind(&candidate.candidate_identity)
        .bind(serde_json::to_value(candidate).unwrap())
        .bind(&outbox.event_identity)
        .bind(&outbox.payload_digest)
        .bind(serde_json::to_value(outbox).unwrap())
        .execute(&mut *terminal)
        .await
        .unwrap();
    terminal.commit().await.unwrap();

    let mut exact_replay = rd_owner.begin().await.unwrap();
    let replayed = SourceIntakeAttemptV1::replay_success_terminal_in_transaction_for_test(
        &mut exact_replay,
        admission.locator(),
        &source_binding.binding_identity,
        (
            permit.invocation_identity(),
            receipt,
            &raw_payload,
            provenance,
            candidate,
            outbox,
        ),
    )
    .await
    .unwrap();
    assert_eq!(replayed.receipt.as_ref(), Some(receipt));
    exact_replay.rollback().await.unwrap();

    let mut changed_raw_payload = raw_payload.clone();
    changed_raw_payload[0] ^= 1;
    let mut changed_replay = rd_owner.begin().await.unwrap();
    assert_eq!(
        SourceIntakeAttemptV1::replay_success_terminal_in_transaction_for_test(
            &mut changed_replay,
            admission.locator(),
            &source_binding.binding_identity,
            (
                permit.invocation_identity(),
                receipt,
                &changed_raw_payload,
                provenance,
                candidate,
                outbox,
            ),
        )
        .await
        .unwrap_err(),
        SourceIntakeError::CustodyMismatch
    );
    changed_replay.rollback().await.unwrap();

    let mut changed_receipt = receipt.clone();
    changed_receipt.response_header_digest = Some(format!("sha256:{}", "c".repeat(64)));
    assert_success_terminal_replay_mismatch(
        rd_owner,
        admission.locator(),
        &source_binding.binding_identity,
        (
            permit.invocation_identity(),
            &changed_receipt,
            &raw_payload,
            provenance,
            candidate,
            outbox,
        ),
    )
    .await;

    let mut changed_provenance = provenance.clone();
    changed_provenance.trust_class = "CHANGED".into();
    assert_success_terminal_replay_mismatch(
        rd_owner,
        admission.locator(),
        &source_binding.binding_identity,
        (
            permit.invocation_identity(),
            receipt,
            &raw_payload,
            &changed_provenance,
            candidate,
            outbox,
        ),
    )
    .await;

    let mut changed_candidate = candidate.clone();
    changed_candidate.trust_class = "CHANGED".into();
    assert_success_terminal_replay_mismatch(
        rd_owner,
        admission.locator(),
        &source_binding.binding_identity,
        (
            permit.invocation_identity(),
            receipt,
            &raw_payload,
            provenance,
            &changed_candidate,
            outbox,
        ),
    )
    .await;

    let failure_request_identity = format!("source-failure-request-{suffix}");
    let failure_admission = product_edge
        .admit_source_intake_request(ProductEdgeAdmissionRequestV1 {
            request_identity: failure_request_identity.clone(),
            typed_payload: serde_json::json!({
                "request_identity": failure_request_identity,
                "gateway": "WINDMILL_PRODUCT_EDGE",
                "normalized_doi": DOI,
                "interpretation": interpretation(),
            }),
            operation: SOURCE_INTAKE_OPERATION_V1.into(),
            operation_schema: SOURCE_INTAKE_OPERATION_SCHEMA_V1.into(),
            target_owner: SOURCE_INTAKE_TARGET_OWNER_V1.into(),
            requested_effects: SOURCE_INTAKE_REQUIRED_EFFECTS_V1
                .into_iter()
                .map(ToString::to_string)
                .collect(),
            request_proof_digest: proof_digest,
            audit_correlation: format!("source-failure:{suffix}"),
        })
        .await
        .unwrap();
    let failure_request = OpenAlexWorkByDoiRequestV1 {
        request_identity: failure_request_identity.clone(),
        gateway: ProductEdgeGatewayV1::WindmillProductEdge,
        admission: failure_admission.locator().clone(),
        operation_manifest_identity: failure_admission.manifest_identity().to_string(),
        operation_manifest_digest: failure_admission.manifest_digest().to_string(),
        normalized_doi: DOI.into(),
    };
    let failure_evidence = evidence_for(&failure_request);
    let mut failure_attempt =
        SourceIntakeAttemptV1::close_binding(failure_request, failure_evidence).unwrap();
    let failure_binding = failure_attempt.binding().clone();
    let failure_binding_commit_identity = format!("source-failure-binding-commit-{suffix}");
    sqlx::query("INSERT INTO public.rd_source_intake_bindings_v1 (request_identity,binding_identity,binding_commit_identity,binding_json,state,binding_committed_at_epoch_ms) VALUES ($1,$2,$3,$4,'BINDING_CLOSED',$5)")
        .bind(&failure_binding.request_identity)
        .bind(&failure_binding.binding_identity)
        .bind(&failure_binding_commit_identity)
        .bind(serde_json::to_value(&failure_binding).unwrap())
        .bind(i64::try_from(now).unwrap())
        .execute(rd_owner)
        .await
        .unwrap();
    let failure_claim = product_edge
        .claim_source_intake_invocation(ProductEdgeSourceInvocationClaimRequestV1 {
            admission: failure_admission.locator().clone(),
            attempt_identity: failure_binding.binding_identity.clone(),
            binding_identity: failure_binding.binding_identity.clone(),
        })
        .await
        .unwrap();
    let mut failure_prepare = rd_owner.begin().await.unwrap();
    let failure_start_request = prepare_source_invocation_in_transaction(
        &mut failure_prepare,
        failure_admission.locator(),
        &failure_binding.binding_identity,
        now.saturating_add(4),
    )
    .await
    .unwrap();
    failure_prepare.commit().await.unwrap();
    let failure_started = product_edge
        .start_source_intake_invocation(failure_start_request)
        .await
        .unwrap();
    let mut failure_reserve = rd_owner.begin().await.unwrap();
    let failure_permit = reserve_started_source_invocation_in_transaction(
        &mut failure_reserve,
        failure_admission.locator(),
        &failure_binding.binding_identity,
        SourceIntakeInvocationPolicyEvidenceV1::fixture(
            &failure_binding,
            failure_binding.shared_time.decision_cut_epoch_ms + 1,
            SourceAcquisitionAdmissionV1::Admitted,
        ),
    )
    .await
    .unwrap();
    failure_reserve.commit().await.unwrap();
    failure_attempt
        .prepare(
            &failure_binding_commit_identity,
            TestStartedCustodyV1::fixture(
                &failure_request_identity,
                &failure_admission.locator().admission_identity,
                failure_started.state_digest(),
                interpretation(),
            )
            .unwrap(),
        )
        .unwrap();
    let local_failure_permit = failure_attempt.reserve_invocation_fixture().unwrap();
    assert_eq!(
        failure_permit.invocation_identity(),
        local_failure_permit.invocation_identity()
    );
    let failure_readback = failure_attempt
        .resolve_fixture(
            local_failure_permit,
            http(404, "application/json", Vec::new()),
            now.saturating_add(5),
        )
        .unwrap();
    let failure_receipt = failure_readback.receipt.as_ref().unwrap();
    let failure_outbox = failure_attempt.committed_outbox().unwrap();
    let mut failure_commit = rd_owner.begin().await.unwrap();
    SourceIntakeAttemptV1::replay_failure_terminal_in_transaction_for_test(
        &mut failure_commit,
        failure_admission.locator(),
        &failure_binding.binding_identity,
        failure_permit.invocation_identity(),
        failure_receipt,
        failure_outbox,
    )
    .await
    .unwrap();
    failure_commit.commit().await.unwrap();

    let mut failure_exact_replay = rd_owner.begin().await.unwrap();
    SourceIntakeAttemptV1::replay_failure_terminal_in_transaction_for_test(
        &mut failure_exact_replay,
        failure_admission.locator(),
        &failure_binding.binding_identity,
        failure_permit.invocation_identity(),
        failure_receipt,
        failure_outbox,
    )
    .await
    .unwrap();
    failure_exact_replay.rollback().await.unwrap();

    let mut changed_failure_outbox = failure_outbox.clone();
    changed_failure_outbox.payload_digest = format!("sha256:{}", "d".repeat(64));
    let mut failure_changed_replay = rd_owner.begin().await.unwrap();
    assert_eq!(
        SourceIntakeAttemptV1::replay_failure_terminal_in_transaction_for_test(
            &mut failure_changed_replay,
            failure_admission.locator(),
            &failure_binding.binding_identity,
            failure_permit.invocation_identity(),
            failure_receipt,
            &changed_failure_outbox,
        )
        .await
        .unwrap_err(),
        SourceIntakeError::CustodyMismatch
    );
    failure_changed_replay.rollback().await.unwrap();

    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM public.rd_research_source_provenance_v1 WHERE receipt_identity=$1"
        )
        .bind(&failure_receipt.receipt_identity)
        .fetch_one(rd_owner)
        .await
        .unwrap(),
        0
    );
    assert!(!failure_claim.claim_identity().is_empty());

    let mut changed_outbox = outbox.clone();
    changed_outbox.payload_digest = format!("sha256:{}", "e".repeat(64));
    let mut changed_replay = rd_owner.begin().await.unwrap();
    assert_eq!(
        SourceIntakeAttemptV1::replay_success_terminal_in_transaction_for_test(
            &mut changed_replay,
            admission.locator(),
            &source_binding.binding_identity,
            (
                permit.invocation_identity(),
                receipt,
                &raw_payload,
                provenance,
                candidate,
                &changed_outbox,
            ),
        )
        .await
        .unwrap_err(),
        SourceIntakeError::CustodyMismatch
    );
    changed_replay.rollback().await.unwrap();
    let canonical_readback: Option<serde_json::Value> =
        sqlx::query_scalar("SELECT rd_owner_api.read_source_intake_v1($1)")
            .bind(&request_identity)
            .fetch_one(rd_owner)
            .await
            .unwrap();
    assert_eq!(
        canonical_readback.unwrap()["receipt"]["receipt_identity"],
        receipt.receipt_identity
    );
    assert_eq!(
        sqlx::query_scalar::<_, String>("SELECT product_edge_started_receipt_identity FROM public.rd_source_intake_bindings_v1 WHERE request_identity=$1")
            .bind(&request_identity)
            .fetch_one(rd_owner)
            .await
            .unwrap(),
        started.state_digest()
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM public.product_edge_owner_outbox_v1 WHERE aggregate_identity=$1 AND event_kind='PRODUCT_EDGE_PROVIDER_INVOCATION_STARTED_V1'")
            .bind(claim.claim_identity())
            .fetch_one(pe_pool)
            .await
            .unwrap(),
        1
    );
    let acl: (bool, bool, bool, bool, bool) = sqlx::query_as(
        "SELECT has_table_privilege('rd_owner','public.product_edge_effect_invocation_claims_v1','SELECT'),has_function_privilege('rd_owner','product_edge_api.lock_source_invocation_claim_v1(text,text,text)','EXECUTE'),has_table_privilege('product_edge_owner','public.rd_source_intake_bindings_v1','SELECT'),has_function_privilege('product_edge_owner','rd_owner_api.lock_source_acquisition_binding_v1(text,text)','EXECUTE'),has_function_privilege('product_edge_owner','rd_owner_api.read_source_intake_v1(text)','EXECUTE')",
    )
    .fetch_one(rd_owner)
    .await
    .unwrap();
    assert_eq!(acl, (false, true, false, true, false));
}

#[cfg(feature = "sealed-source-intake-research-acceptance")]
#[tokio::test]
#[ignore = "requires the canonical isolated R&D Owner PostgreSQL harness"]
async fn postgres_sealed_success_atomically_reads_back_distinct_time_heads_and_rejects_mismatches()
{
    for (role, environment) in [
        (
            "operator authorization",
            "OPERATOR_AUTHORIZATION_TEST_DATABASE_URL",
        ),
        ("Product Edge", "PRODUCT_EDGE_TEST_DATABASE_URL"),
        ("R&D", "RD_OWNER_TEST_DATABASE_URL"),
        ("Qualification", "QUALIFICATION_TEST_DATABASE_URL"),
        ("Backtest", "BACKTEST_TEST_DATABASE_URL"),
    ] {
        let url = std::env::var(environment).expect("canonical role URL");
        let pool = sqlx::PgPool::connect(&url)
            .await
            .unwrap_or_else(|e| panic!("{role} disposable role is unreachable: {e}"));
        pool.close().await;
    }
    let database = CanonicalOwnerPostgresTestDatabaseV1::admit()
        .await
        .expect("canonical disposable Owner database");
    let mutation = database.mutation();
    let rd_owner = mutation.pool(CanonicalOwnerTestRoleV1::RdOwner);

    install_source_intake_schema(rd_owner).await;

    let now = u64::try_from(
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis(),
    )
    .unwrap();
    let suffix = format!("{}-{now}", std::process::id());
    let request_identity = format!("sealed-source-request-{suffix}");
    let deployment_identity = format!("sealed-source-deployment-{suffix}");
    let principal = format!("sealed-source-principal-{suffix}");
    let proof_digest = format!("sha256:{}", "7".repeat(64));
    let manifest = AgentOperationManifestProposalV1 {
        operation: SOURCE_INTAKE_OPERATION_V1.into(),
        operation_schema: SOURCE_INTAKE_OPERATION_SCHEMA_V1.into(),
        target_owner: SOURCE_INTAKE_TARGET_OWNER_V1.into(),
        allowed_effects: SOURCE_INTAKE_REQUIRED_EFFECTS_V1
            .into_iter()
            .map(ToString::to_string)
            .collect(),
        prohibited_effects: vec!["ORDER_V1".into(), "REAL_TRADING_V1".into()],
        capability_policy_digest: format!("sha256:{}", "8".repeat(64)),
        effective_from_epoch_ms: now.saturating_sub(1_000),
        valid_through_epoch_ms: now.saturating_add(600_000),
    };
    let research_manifest = AgentOperationManifestProposalV1 {
        operation: RESEARCH_GOAL_OPERATION_V2.into(),
        operation_schema: RESEARCH_GOAL_SCHEMA_V2.into(),
        target_owner: RESEARCH_OWNER_V1.into(),
        allowed_effects: vec!["R_AND_D_RESEARCH_MUTATION_V1".into()],
        prohibited_effects: vec!["ORDER_V1".into(), "REAL_TRADING_V1".into()],
        capability_policy_digest: format!("sha256:{}", "9".repeat(64)),
        effective_from_epoch_ms: now.saturating_sub(1_000),
        valid_through_epoch_ms: now.saturating_add(600_000),
    };
    let issuer = OperatorAuthorizationIssuerPostgresV1::connect(
        database.database_url(CanonicalOwnerTestRoleV1::OperatorAuthorizationWriter),
    )
    .await
    .unwrap();
    let authorization = issuer
        .issue_genesis(OperatorAuthorizationIssuanceProposalV1 {
            authorization_identity: format!("sealed-source-authorization-{suffix}"),
            issuer_identity: "operator-authorization-issuer-test-v1".into(),
            issuer_key_version: "test-key-v1".into(),
            scope: OperatorAuthorizationScopeV1 {
                principal: principal.clone(),
                audience: "PRODUCT_EDGE".into(),
                permissions: vec![
                    "research:source-intake".into(),
                    "research:submit".into(),
                    "research:view".into(),
                ],
            },
            request_proof_digest: proof_digest.clone(),
            operation_manifests: vec![
                OperationManifestBindingV1 {
                    manifest_identity: manifest.manifest_identity().unwrap(),
                    manifest_digest: manifest.manifest_digest().unwrap(),
                },
                OperationManifestBindingV1 {
                    manifest_identity: research_manifest.manifest_identity().unwrap(),
                    manifest_digest: research_manifest.manifest_digest().unwrap(),
                },
            ],
            not_before_epoch_ms: now.saturating_sub(1_000),
            valid_through_epoch_ms: now.saturating_add(600_000),
            expected_revocation_head: "EMPTY".into(),
        })
        .await
        .unwrap();
    let product_edge = Arc::new(
        ProductEdgePostgresOwnerV1::connect(
            database.database_url(CanonicalOwnerTestRoleV1::ProductEdgeOwner),
            &deployment_identity,
            ProductEdgeAuthorizationTrustV1 {
                issuer_identity: "operator-authorization-issuer-test-v1".into(),
                issuer_key_version: "test-key-v1".into(),
                audience: "PRODUCT_EDGE".into(),
            },
        )
        .await
        .unwrap(),
    );
    product_edge
        .bootstrap_genesis(ProductEdgeBootstrapProposalV1 {
            deployment_identity,
            binding_identity: format!("sealed-source-edge-binding-{suffix}"),
            expected_history_head: "EMPTY".into(),
            generation: 1,
            effective_principal: principal,
            scope_policy_version: "sealed-source-scope-v1".into(),
            capability_policy_version: "sealed-source-capability-v1".into(),
            audit_policy_version: "sealed-source-audit-v1".into(),
            valid_from_epoch_ms: now.saturating_sub(1_000),
            valid_through_epoch_ms: now.saturating_add(600_000),
            authorization: authorization.locator(),
            manifests: vec![manifest, research_manifest.clone()],
        })
        .await
        .unwrap();

    let environment = SealedSourceIntakeEnvironmentV1::new(
        product_edge.clone(),
        rd_owner.clone(),
        proof_digest.clone(),
    )
    .unwrap();
    let audit = environment.audit();
    let owner = SourceIntakeOwnerV1::sealed_acceptance(environment);
    let terminal = owner
        .run(SourceIntakeOperationRequestV1 {
            request_identity: request_identity.clone(),
            channel: ProductEdgeGatewayV1::WindmillProductEdge,
            normalized_doi: "10.5555/sealed-success".into(),
            interpretation: interpretation(),
        })
        .await
        .unwrap()
        .expect("sealed RETRIEVED terminal");

    assert_eq!(terminal.terminal, AcquisitionTerminalV1::Retrieved);
    assert_eq!(
        terminal.authority_class,
        SourceAcquisitionAuthorityClassV1::SealedAcceptance
    );
    assert_eq!(audit.physical_provider_invocations(), 1);
    let stored: (
        serde_json::Value,
        serde_json::Value,
        serde_json::Value,
        serde_json::Value,
        Vec<u8>,
    ) = sqlx::query_as(
        "SELECT binding.binding_json, provenance.provenance_json, candidate.candidate_json, outbox.payload_json, raw.raw_payload
         FROM public.rd_source_intake_bindings_v1 binding
         JOIN public.rd_source_intake_receipts_v1 receipt ON receipt.request_identity=binding.request_identity
         JOIN public.rd_research_source_provenance_v1 provenance ON provenance.receipt_identity=receipt.receipt_identity
         JOIN public.rd_source_candidates_v1 candidate ON candidate.provenance_identity=provenance.provenance_identity
         JOIN public.rd_owner_outbox_v1 outbox ON outbox.aggregate_identity=binding.request_identity AND outbox.event_kind='SOURCE_INTAKE_TERMINATED_V1'
         JOIN public.rd_source_raw_receipt_links_v1 raw_link ON raw_link.receipt_identity=receipt.receipt_identity
         JOIN public.rd_source_raw_payloads_v1 raw ON raw.content_digest=raw_link.content_digest
         WHERE binding.request_identity=$1 AND binding.state='TERMINAL'",
    )
    .bind(&request_identity)
    .fetch_one(rd_owner)
    .await
    .unwrap();
    assert_eq!(
        stored.0["connector_identity"],
        "rd.openalex-work-by-doi.sealed-acceptance"
    );
    assert_eq!(
        stored.1["connector_identity"],
        stored.0["connector_identity"]
    );
    assert_ne!(
        stored.0["shared_time"]["head_digest"],
        terminal.receipt.retrieval_time.head_digest
    );
    assert_eq!(
        stored.1["retrieval_time"],
        serde_json::to_value(&terminal.receipt.retrieval_time).unwrap()
    );
    assert_eq!(
        stored.1["valid_through_epoch_ms"],
        terminal.receipt.retrieval_time.valid_through_epoch_ms
    );
    let counts: (i64, i64, i64, i64, i64) = sqlx::query_as(
        "SELECT
           (SELECT COUNT(*) FROM public.rd_source_intake_receipts_v1 WHERE request_identity=$1),
           (SELECT COUNT(*) FROM public.rd_research_source_provenance_v1 WHERE receipt_identity=$2),
           (SELECT COUNT(*) FROM public.rd_source_candidates_v1 WHERE provenance_identity=$3),
           (SELECT COUNT(*) FROM public.rd_owner_outbox_v1 WHERE aggregate_identity=$1 AND event_kind='SOURCE_INTAKE_TERMINATED_V1'),
           (SELECT COUNT(*) FROM public.rd_source_raw_receipt_links_v1 WHERE receipt_identity=$2)",
    )
    .bind(&request_identity)
    .bind(&terminal.receipt.receipt_identity)
    .bind(terminal.provenance_identity.as_deref().unwrap())
    .fetch_one(rd_owner)
    .await
    .unwrap();
    assert_eq!(counts, (1, 1, 1, 1, 1));
    assert_eq!(
        owner.resolve(&request_identity).await.unwrap(),
        Some(terminal.clone())
    );
    assert_eq!(audit.physical_provider_invocations(), 1);

    let source_admission: CanonicalProductEdgeAdmissionLocatorV1 =
        serde_json::from_value(stored.0["product_edge_admission"].clone()).unwrap();
    let research_request_identity = format!("sealed-source-research-{suffix}");
    let research_typed_payload = serde_json::json!({
        "request_identity": research_request_identity,
        "channel": "WINDMILL_PRODUCT_EDGE",
        "goal": {
            "hypothesis": "The sealed source supports one bounded hypothesis.",
            "mechanism": "The reported mechanism survives the fixed control.",
            "falsification_question": "Does the fixed control erase the effect?",
            "expected_observation": "The effect remains directionally stable.",
            "required_data": ["sealed-source-v1"],
            "cost_assumption": "Fixed sealed cost model.",
            "capacity_assumption": "Fixed sealed capacity model."
        },
        "trial_family_proposal": {
            "trial_budget": 1,
            "stop_rule": "Stop after the fixed sealed trial.",
            "pit_rule_identity": "sealed-pit-rule-v1",
            "cost_model_identity": "sealed-cost-model-v1",
            "slippage_model_identity": "sealed-slippage-model-v1",
            "capacity_model_identity": "sealed-capacity-model-v1",
            "independence_rationale": "Genesis has no semantic predecessor."
        }
    });
    let research_admission = product_edge
        .admit_request(ProductEdgeAdmissionRequestV1 {
            request_identity: research_request_identity.clone(),
            typed_payload: research_typed_payload,
            operation: RESEARCH_GOAL_OPERATION_V2.into(),
            operation_schema: RESEARCH_GOAL_SCHEMA_V2.into(),
            target_owner: RESEARCH_OWNER_V1.into(),
            requested_effects: vec!["R_AND_D_RESEARCH_MUTATION_V1".into()],
            request_proof_digest: proof_digest.clone(),
            audit_correlation: format!("source-research:{suffix}"),
        })
        .await
        .unwrap();
    let ancestry = SourceIntakeResearchAncestryProposalV1 {
        request_identity: request_identity.clone(),
        attempt_identity: terminal.binding_identity.clone(),
        terminal_receipt_identity: terminal.receipt.receipt_identity.clone(),
    };
    let policy_query = SourceIntakePolicyEvidenceQueryV1 {
        request_identity: request_identity.clone(),
        gateway: CanonicalProductEdgeGatewayV1::WindmillProductEdge,
        admission: source_admission,
        operation_manifest_identity: stored.0["operation_manifest_identity"]
            .as_str()
            .unwrap()
            .into(),
        operation_manifest_digest: stored.0["operation_manifest_digest"]
            .as_str()
            .unwrap()
            .into(),
        connector_policy_locator: "sealed-source-intake-connector-policy-v1".into(),
        network_policy_locator: "sealed-source-intake-network-policy-v1".into(),
        rights_policy_locator: "sealed-source-intake-rights-policy-v1".into(),
        retention_policy_locator: "sealed-source-intake-retention-policy-v1".into(),
        dns_observation_locator: "sealed-source-intake-dns-observation-v1".into(),
        shared_time_head: UntrustedClockHeadLocator::from_untrusted(
            BindingDigest::from_untrusted_bytes([1; 32]),
            BindingDigest::from_untrusted_bytes([2; 32]),
        ),
        shared_time_successor: None,
    };
    let proposal = UnsourcedResearchProposalV1 {
        request_identity: research_request_identity.clone(),
        channel: ProductEdgeChannel::WindmillProductEdge,
        admission: research_admission.locator().clone(),
        goal: UnsourcedResearchGoalV1 {
            hypothesis: "The sealed source supports one bounded hypothesis.".into(),
            mechanism: "The reported mechanism survives the fixed control.".into(),
            falsification_question: "Does the fixed control erase the effect?".into(),
            expected_observation: "The effect remains directionally stable.".into(),
            required_data: vec!["sealed-source-v1".into()],
            cost_assumption: "Fixed sealed cost model.".into(),
            capacity_assumption: "Fixed sealed capacity model.".into(),
        },
        trial_family_proposal: TrialFamilyProposalV1 {
            trial_budget: 1,
            stop_rule: "Stop after the fixed sealed trial.".into(),
            pit_rule_identity: "sealed-pit-rule-v1".into(),
            cost_model_identity: "sealed-cost-model-v1".into(),
            slippage_model_identity: "sealed-slippage-model-v1".into(),
            capacity_model_identity: "sealed-capacity-model-v1".into(),
            independence_rationale: "Genesis has no semantic predecessor.".into(),
        },
    };
    let research_owner = PostgresResearchGoalOwnerV1::connect(
        database.database_url(CanonicalOwnerTestRoleV1::RdOwner),
        database.database_url(CanonicalOwnerTestRoleV1::QualificationWriter),
    )
    .await
    .unwrap()
    .bind_sealed_source_intake_research_policy();

    let mut wrong_ancestry = ancestry.clone();
    wrong_ancestry
        .terminal_receipt_identity
        .push_str("-mutated");
    assert!(
        research_owner
            .submit_source_intake_research_v1(
                proposal.clone(),
                wrong_ancestry,
                policy_query.clone(),
            )
            .await
            .is_err()
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM public.rd_research_request_receipts_v1 WHERE request_identity=$1",
        )
        .bind(&research_request_identity)
        .fetch_one(rd_owner)
        .await
        .unwrap(),
        0
    );

    let canonical_receipt_json: serde_json::Value = sqlx::query_scalar(
        "SELECT receipt_json FROM public.rd_source_intake_receipts_v1 WHERE request_identity=$1",
    )
    .bind(&request_identity)
    .fetch_one(rd_owner)
    .await
    .unwrap();
    sqlx::query(
        "UPDATE public.rd_source_intake_receipts_v1 SET receipt_json=jsonb_set(receipt_json,'{terminal}','\"NOT_FOUND\"'::jsonb) WHERE request_identity=$1",
    )
    .bind(&request_identity)
    .execute(rd_owner)
    .await
    .unwrap();
    assert!(
        research_owner
            .submit_source_intake_research_v1(
                proposal.clone(),
                ancestry.clone(),
                policy_query.clone(),
            )
            .await
            .is_err()
    );
    sqlx::query(
        "UPDATE public.rd_source_intake_receipts_v1 SET receipt_json=$2 WHERE request_identity=$1",
    )
    .bind(&request_identity)
    .bind(canonical_receipt_json)
    .execute(rd_owner)
    .await
    .unwrap();

    let canonical_provenance_json = stored.1.clone();
    sqlx::query(
        "UPDATE public.rd_research_source_provenance_v1 SET provenance_json=jsonb_set(provenance_json,'{valid_through_epoch_ms}','1800000000002'::jsonb) WHERE receipt_identity=$1",
    )
    .bind(&terminal.receipt.receipt_identity)
    .execute(rd_owner)
    .await
    .unwrap();
    assert!(
        research_owner
            .submit_source_intake_research_v1(
                proposal.clone(),
                ancestry.clone(),
                policy_query.clone(),
            )
            .await
            .is_err()
    );
    sqlx::query(
        "UPDATE public.rd_research_source_provenance_v1 SET provenance_json=$2 WHERE receipt_identity=$1",
    )
    .bind(&terminal.receipt.receipt_identity)
    .bind(canonical_provenance_json)
    .execute(rd_owner)
    .await
    .unwrap();
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM public.rd_research_request_receipts_v1 WHERE request_identity=$1",
        )
        .bind(&research_request_identity)
        .fetch_one(rd_owner)
        .await
        .unwrap(),
        0
    );

    let accepted = research_owner
        .submit_source_intake_research_v1(proposal.clone(), ancestry.clone(), policy_query.clone())
        .await
        .unwrap();
    assert_eq!(accepted.resolution(), ProductEdgeResolution::Accepted);
    assert_eq!(accepted.request_identity(), research_request_identity);
    assert!(accepted.owner_receipt().is_some());
    assert!(accepted.research_view().is_some());
    drop(research_owner);
    let restarted_research_owner = PostgresResearchGoalOwnerV1::connect(
        database.database_url(CanonicalOwnerTestRoleV1::RdOwner),
        database.database_url(CanonicalOwnerTestRoleV1::QualificationWriter),
    )
    .await
    .unwrap()
    .bind_sealed_source_intake_research_policy();
    let replay = restarted_research_owner
        .submit_source_intake_research_v1(proposal.clone(), ancestry.clone(), policy_query.clone())
        .await
        .unwrap();
    assert_eq!(replay.owner_receipt(), accepted.owner_receipt());
    let mut changed = proposal;
    changed.goal.hypothesis.push_str(" changed meaning");
    assert!(matches!(
        restarted_research_owner
            .submit_source_intake_research_v1(changed, ancestry, policy_query)
            .await,
        Err(ResearchGoalOwnerError::ConflictingReplay)
    ));

    let admission: CanonicalProductEdgeAdmissionLocatorV1 =
        serde_json::from_value(stored.0["product_edge_admission"].clone()).unwrap();
    let provenance: ResearchSourceProvenanceV1 = serde_json::from_value(stored.1).unwrap();
    let candidate: SourceCandidateV1 = serde_json::from_value(stored.2).unwrap();
    let outbox: SourceIntakeOutboxV1 = serde_json::from_value(stored.3).unwrap();
    let invocation_identity = terminal.receipt.invocation_identity.as_deref().unwrap();

    let mut wrong_connector = provenance.clone();
    wrong_connector.connector_identity = "rd.openalex-work-by-doi".into();
    assert_success_terminal_replay_mismatch(
        rd_owner,
        &admission,
        &terminal.binding_identity,
        (
            invocation_identity,
            &terminal.receipt,
            &stored.4,
            &wrong_connector,
            &candidate,
            &outbox,
        ),
    )
    .await;

    let mut wrong_retrieval_digest = terminal.receipt.clone();
    wrong_retrieval_digest.retrieval_time_evidence_digest = format!("sha256:{}", "f".repeat(64));
    assert_success_terminal_replay_mismatch(
        rd_owner,
        &admission,
        &terminal.binding_identity,
        (
            invocation_identity,
            &wrong_retrieval_digest,
            &stored.4,
            &provenance,
            &candidate,
            &outbox,
        ),
    )
    .await;
}

#[tokio::test]
#[ignore = "requires the canonical isolated R&D Owner PostgreSQL harness"]
async fn postgres_readback_rejects_tampered_raw_payload() {
    let database = CanonicalOwnerPostgresTestDatabaseV1::admit()
        .await
        .expect("canonical disposable Owner database");
    let mutation = database.mutation();
    let rd_owner = mutation.pool(CanonicalOwnerTestRoleV1::RdOwner);

    install_source_intake_schema(rd_owner).await;

    let now = u64::try_from(
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis(),
    )
    .unwrap();
    let suffix = format!("{}-{now}", std::process::id());
    let request_identity = format!("source-tamper-request-{suffix}");
    let deployment_identity = format!("source-tamper-deployment-{suffix}");
    let principal = format!("source-tamper-principal-{suffix}");
    let proof_digest = format!("sha256:{}", "7".repeat(64));
    let manifest = AgentOperationManifestProposalV1 {
        operation: SOURCE_INTAKE_OPERATION_V1.into(),
        operation_schema: SOURCE_INTAKE_OPERATION_SCHEMA_V1.into(),
        target_owner: SOURCE_INTAKE_TARGET_OWNER_V1.into(),
        allowed_effects: SOURCE_INTAKE_REQUIRED_EFFECTS_V1
            .into_iter()
            .map(ToString::to_string)
            .collect(),
        prohibited_effects: vec!["ORDER_V1".into(), "REAL_TRADING_V1".into()],
        capability_policy_digest: format!("sha256:{}", "8".repeat(64)),
        effective_from_epoch_ms: now.saturating_sub(1_000),
        valid_through_epoch_ms: now.saturating_add(600_000),
    };
    let issuer = OperatorAuthorizationIssuerPostgresV1::connect(
        database.database_url(CanonicalOwnerTestRoleV1::OperatorAuthorizationWriter),
    )
    .await
    .unwrap();
    let authorization = issuer
        .issue_genesis(OperatorAuthorizationIssuanceProposalV1 {
            authorization_identity: format!("source-tamper-authorization-{suffix}"),
            issuer_identity: "operator-authorization-issuer-test-v1".into(),
            issuer_key_version: "test-key-v1".into(),
            scope: OperatorAuthorizationScopeV1 {
                principal: principal.clone(),
                audience: "PRODUCT_EDGE".into(),
                permissions: vec!["research:source-intake".into()],
            },
            request_proof_digest: proof_digest.clone(),
            operation_manifests: vec![OperationManifestBindingV1 {
                manifest_identity: manifest.manifest_identity().unwrap(),
                manifest_digest: manifest.manifest_digest().unwrap(),
            }],
            not_before_epoch_ms: now.saturating_sub(1_000),
            valid_through_epoch_ms: now.saturating_add(600_000),
            expected_revocation_head: "EMPTY".into(),
        })
        .await
        .unwrap();
    let product_edge = ProductEdgePostgresOwnerV1::connect(
        database.database_url(CanonicalOwnerTestRoleV1::ProductEdgeOwner),
        &deployment_identity,
        ProductEdgeAuthorizationTrustV1 {
            issuer_identity: "operator-authorization-issuer-test-v1".into(),
            issuer_key_version: "test-key-v1".into(),
            audience: "PRODUCT_EDGE".into(),
        },
    )
    .await
    .unwrap();
    product_edge
        .bootstrap_genesis(ProductEdgeBootstrapProposalV1 {
            deployment_identity,
            binding_identity: format!("source-tamper-edge-binding-{suffix}"),
            expected_history_head: "EMPTY".into(),
            generation: 1,
            effective_principal: principal,
            scope_policy_version: "source-tamper-scope-v1".into(),
            capability_policy_version: "source-tamper-capability-v1".into(),
            audit_policy_version: "source-tamper-audit-v1".into(),
            valid_from_epoch_ms: now.saturating_sub(1_000),
            valid_through_epoch_ms: now.saturating_add(600_000),
            authorization: authorization.locator(),
            manifests: vec![manifest],
        })
        .await
        .unwrap();
    let admission = product_edge
        .admit_source_intake_request(ProductEdgeAdmissionRequestV1 {
            request_identity: request_identity.clone(),
            typed_payload: serde_json::json!({
                "request_identity": request_identity,
                "gateway": "WINDMILL_PRODUCT_EDGE",
                "normalized_doi": DOI,
                "interpretation": interpretation(),
            }),
            operation: SOURCE_INTAKE_OPERATION_V1.into(),
            operation_schema: SOURCE_INTAKE_OPERATION_SCHEMA_V1.into(),
            target_owner: SOURCE_INTAKE_TARGET_OWNER_V1.into(),
            requested_effects: SOURCE_INTAKE_REQUIRED_EFFECTS_V1
                .into_iter()
                .map(ToString::to_string)
                .collect(),
            request_proof_digest: proof_digest,
            audit_correlation: format!("source-tamper:{suffix}"),
        })
        .await
        .unwrap();
    let source_request = OpenAlexWorkByDoiRequestV1 {
        request_identity: request_identity.clone(),
        gateway: ProductEdgeGatewayV1::WindmillProductEdge,
        admission: admission.locator().clone(),
        operation_manifest_identity: admission.manifest_identity().to_string(),
        operation_manifest_digest: admission.manifest_digest().to_string(),
        normalized_doi: DOI.into(),
    };
    let source_evidence = evidence_for(&source_request);
    let mut attempt =
        SourceIntakeAttemptV1::close_binding(source_request, source_evidence).unwrap();
    let binding = attempt.binding().clone();
    let binding_commit_identity = format!("source-tamper-binding-commit-{suffix}");

    let mut transaction = rd_owner.begin().await.unwrap();
    sqlx::query("INSERT INTO public.rd_source_intake_bindings_v1 (request_identity,binding_identity,binding_commit_identity,binding_json,state,binding_committed_at_epoch_ms) VALUES ($1,$2,$3,$4,'BINDING_CLOSED',$5)")
        .bind(&binding.request_identity)
        .bind(&binding.binding_identity)
        .bind(&binding_commit_identity)
        .bind(serde_json::to_value(&binding).unwrap())
        .bind(i64::try_from(now).unwrap())
        .execute(&mut *transaction)
        .await
        .unwrap();
    transaction.commit().await.unwrap();

    product_edge
        .claim_source_intake_invocation(ProductEdgeSourceInvocationClaimRequestV1 {
            admission: admission.locator().clone(),
            attempt_identity: binding.binding_identity.clone(),
            binding_identity: binding.binding_identity.clone(),
        })
        .await
        .unwrap();
    let mut prepare = rd_owner.begin().await.unwrap();
    let start_request = prepare_source_invocation_in_transaction(
        &mut prepare,
        admission.locator(),
        &binding.binding_identity,
        now.saturating_add(1),
    )
    .await
    .unwrap();
    prepare.commit().await.unwrap();
    let started = product_edge
        .start_source_intake_invocation(start_request)
        .await
        .unwrap();
    let mut reserve = rd_owner.begin().await.unwrap();
    let owner_permit = reserve_started_source_invocation_in_transaction(
        &mut reserve,
        admission.locator(),
        &binding.binding_identity,
        SourceIntakeInvocationPolicyEvidenceV1::fixture(
            &binding,
            binding.shared_time.decision_cut_epoch_ms + 1,
            SourceAcquisitionAdmissionV1::Admitted,
        ),
    )
    .await
    .unwrap();
    reserve.commit().await.unwrap();
    attempt
        .prepare(
            &binding_commit_identity,
            TestStartedCustodyV1::fixture(
                &request_identity,
                &admission.locator().admission_identity,
                started.state_digest(),
                interpretation(),
            )
            .unwrap(),
        )
        .unwrap();
    let local_permit = attempt.reserve_invocation_fixture().unwrap();
    assert_eq!(
        owner_permit.invocation_identity(),
        local_permit.invocation_identity()
    );
    let raw_payload = success_body(DOI);
    let readback = attempt
        .resolve_fixture(
            local_permit,
            http(200, "application/json", vec![raw_payload.clone()]),
            now.saturating_add(3),
        )
        .unwrap();
    let receipt = readback.receipt.as_ref().unwrap();
    let provenance = attempt.committed_provenance().unwrap();
    let candidate = attempt.committed_candidate().unwrap();
    let outbox = attempt.committed_outbox().unwrap();
    let content_digest = receipt.content_digest.as_deref().unwrap();

    let mut transaction = rd_owner.begin().await.unwrap();
    let raw_acl: (String, String, bool, bool) = sqlx::query_as(
        "SELECT current_user::text, pg_catalog.pg_get_userbyid(class.relowner)::text, pg_catalog.has_table_privilege(current_user, class.oid, 'SELECT'), pg_catalog.has_table_privilege(current_user, class.oid, 'REFERENCES') FROM pg_catalog.pg_class AS class WHERE class.oid='public.rd_source_raw_payloads_v1'::regclass",
    )
    .fetch_one(&mut *transaction)
    .await
    .unwrap();
    assert_eq!(raw_acl, ("rd_owner".into(), "rd_owner".into(), true, true));
    let committed = SourceIntakeAttemptV1::replay_success_terminal_in_transaction_for_test(
        &mut transaction,
        admission.locator(),
        &binding.binding_identity,
        (
            owner_permit.invocation_identity(),
            receipt,
            &raw_payload,
            provenance,
            candidate,
            outbox,
        ),
    )
    .await
    .unwrap();
    assert_eq!(committed.content_digest.as_deref(), Some(content_digest));
    transaction.commit().await.unwrap();

    let sealed: Option<serde_json::Value> =
        sqlx::query_scalar("SELECT rd_owner_api.read_source_intake_v1($1)")
            .bind(&binding.request_identity)
            .fetch_one(rd_owner)
            .await
            .unwrap();
    assert_eq!(
        sealed
            .as_ref()
            .and_then(|value| value["content_digest"].as_str()),
        Some(content_digest)
    );

    let canonical_started: (String, serde_json::Value) = sqlx::query_as(
        "SELECT product_edge_started_receipt_identity,product_edge_started_json FROM public.rd_source_intake_bindings_v1 WHERE request_identity=$1",
    )
    .bind(&binding.request_identity)
    .fetch_one(rd_owner)
    .await
    .unwrap();
    assert_eq!(canonical_started.0, started.state_digest());

    sqlx::query(
        "ALTER TABLE public.rd_source_intake_bindings_v1 DISABLE TRIGGER rd_source_intake_binding_guard_v1",
    )
    .execute(rd_owner)
    .await
    .unwrap();
    sqlx::query(
        "UPDATE public.rd_source_intake_bindings_v1 SET product_edge_started_receipt_identity=$2,product_edge_started_json=pg_catalog.jsonb_set(product_edge_started_json,'{started_receipt_identity}',pg_catalog.to_jsonb($2::text)) WHERE request_identity=$1",
    )
    .bind(&binding.request_identity)
    .bind("forged-product-edge-started-receipt")
    .execute(rd_owner)
    .await
    .unwrap();
    sqlx::query(
        "ALTER TABLE public.rd_source_intake_bindings_v1 ENABLE TRIGGER rd_source_intake_binding_guard_v1",
    )
    .execute(rd_owner)
    .await
    .unwrap();
    let rejected: Option<serde_json::Value> =
        sqlx::query_scalar("SELECT rd_owner_api.read_source_intake_v1($1)")
            .bind(&binding.request_identity)
            .fetch_one(rd_owner)
            .await
            .unwrap();
    assert!(rejected.is_none());

    sqlx::query(
        "ALTER TABLE public.rd_source_intake_bindings_v1 DISABLE TRIGGER rd_source_intake_binding_guard_v1",
    )
    .execute(rd_owner)
    .await
    .unwrap();
    sqlx::query(
        "UPDATE public.rd_source_intake_bindings_v1 SET product_edge_started_receipt_identity=$2,product_edge_started_json=$3 WHERE request_identity=$1",
    )
    .bind(&binding.request_identity)
    .bind(&canonical_started.0)
    .bind(&canonical_started.1)
    .execute(rd_owner)
    .await
    .unwrap();
    sqlx::query(
        "ALTER TABLE public.rd_source_intake_bindings_v1 ENABLE TRIGGER rd_source_intake_binding_guard_v1",
    )
    .execute(rd_owner)
    .await
    .unwrap();
    let restored: Option<serde_json::Value> =
        sqlx::query_scalar("SELECT rd_owner_api.read_source_intake_v1($1)")
            .bind(&binding.request_identity)
            .fetch_one(rd_owner)
            .await
            .unwrap();
    assert_eq!(
        restored
            .as_ref()
            .and_then(|value| value["content_digest"].as_str()),
        Some(content_digest)
    );

    sqlx::query(
        "ALTER TABLE public.rd_research_source_provenance_v1 DISABLE TRIGGER rd_research_source_provenance_immutable_v1",
    )
    .execute(rd_owner)
    .await
    .unwrap();
    sqlx::query(
        "UPDATE public.rd_research_source_provenance_v1 SET provenance_json=pg_catalog.jsonb_set(provenance_json,'{location_rights,0,reported_license}','\"proprietary\"'::jsonb) WHERE provenance_identity=$1",
    )
    .bind(&provenance.provenance_identity)
    .execute(rd_owner)
    .await
    .unwrap();
    sqlx::query(
        "ALTER TABLE public.rd_research_source_provenance_v1 ENABLE TRIGGER rd_research_source_provenance_immutable_v1",
    )
    .execute(rd_owner)
    .await
    .unwrap();
    let rejected: Option<serde_json::Value> =
        sqlx::query_scalar("SELECT rd_owner_api.read_source_intake_v1($1)")
            .bind(&binding.request_identity)
            .fetch_one(rd_owner)
            .await
            .unwrap();
    assert!(rejected.is_none());

    sqlx::query(
        "ALTER TABLE public.rd_research_source_provenance_v1 DISABLE TRIGGER rd_research_source_provenance_immutable_v1",
    )
    .execute(rd_owner)
    .await
    .unwrap();
    sqlx::query(
        "UPDATE public.rd_research_source_provenance_v1 SET provenance_json=$2 WHERE provenance_identity=$1",
    )
    .bind(&provenance.provenance_identity)
    .bind(serde_json::to_value(provenance).unwrap())
    .execute(rd_owner)
    .await
    .unwrap();
    sqlx::query(
        "ALTER TABLE public.rd_research_source_provenance_v1 ENABLE TRIGGER rd_research_source_provenance_immutable_v1",
    )
    .execute(rd_owner)
    .await
    .unwrap();
    let restored: Option<serde_json::Value> =
        sqlx::query_scalar("SELECT rd_owner_api.read_source_intake_v1($1)")
            .bind(&binding.request_identity)
            .fetch_one(rd_owner)
            .await
            .unwrap();
    assert_eq!(
        restored
            .as_ref()
            .and_then(|value| value["content_digest"].as_str()),
        Some(content_digest)
    );

    sqlx::query(
        "UPDATE public.rd_owner_outbox_v1 SET payload_json=payload_json || '{\"unexpected\":true}'::jsonb WHERE event_identity=$1",
    )
    .bind(&outbox.event_identity)
    .execute(rd_owner)
    .await
    .unwrap();
    let rejected: Option<serde_json::Value> =
        sqlx::query_scalar("SELECT rd_owner_api.read_source_intake_v1($1)")
            .bind(&binding.request_identity)
            .fetch_one(rd_owner)
            .await
            .unwrap();
    assert!(rejected.is_none());

    sqlx::query("UPDATE public.rd_owner_outbox_v1 SET payload_json=$2 WHERE event_identity=$1")
        .bind(&outbox.event_identity)
        .bind(serde_json::to_value(outbox).unwrap())
        .execute(rd_owner)
        .await
        .unwrap();
    let restored: Option<serde_json::Value> =
        sqlx::query_scalar("SELECT rd_owner_api.read_source_intake_v1($1)")
            .bind(&binding.request_identity)
            .fetch_one(rd_owner)
            .await
            .unwrap();
    assert_eq!(
        restored
            .as_ref()
            .and_then(|value| value["content_digest"].as_str()),
        Some(content_digest)
    );

    sqlx::query(
        "UPDATE public.rd_owner_outbox_v1 SET committed_at_epoch_ms=committed_at_epoch_ms+1 WHERE event_identity=$1",
    )
    .bind(&outbox.event_identity)
    .execute(rd_owner)
    .await
    .unwrap();
    let rejected: Option<serde_json::Value> =
        sqlx::query_scalar("SELECT rd_owner_api.read_source_intake_v1($1)")
            .bind(&binding.request_identity)
            .fetch_one(rd_owner)
            .await
            .unwrap();
    assert!(rejected.is_none());

    sqlx::query(
        "UPDATE public.rd_owner_outbox_v1 SET committed_at_epoch_ms=$2 WHERE event_identity=$1",
    )
    .bind(&outbox.event_identity)
    .bind(i64::try_from(receipt.committed_at_epoch_ms).unwrap())
    .execute(rd_owner)
    .await
    .unwrap();
    let restored: Option<serde_json::Value> =
        sqlx::query_scalar("SELECT rd_owner_api.read_source_intake_v1($1)")
            .bind(&binding.request_identity)
            .fetch_one(rd_owner)
            .await
            .unwrap();
    assert_eq!(
        restored
            .as_ref()
            .and_then(|value| value["content_digest"].as_str()),
        Some(content_digest)
    );

    sqlx::query(
        "ALTER TABLE public.rd_source_intake_receipts_v1 DISABLE TRIGGER rd_source_intake_receipt_immutable_v1",
    )
    .execute(rd_owner)
    .await
    .unwrap();
    sqlx::query(
        "UPDATE public.rd_source_intake_receipts_v1 SET receipt_json=receipt_json || '{\"unexpected\":true}'::jsonb WHERE receipt_identity=$1",
    )
    .bind(&receipt.receipt_identity)
    .execute(rd_owner)
    .await
    .unwrap();
    sqlx::query(
        "ALTER TABLE public.rd_source_intake_receipts_v1 ENABLE TRIGGER rd_source_intake_receipt_immutable_v1",
    )
    .execute(rd_owner)
    .await
    .unwrap();
    let rejected: Option<serde_json::Value> =
        sqlx::query_scalar("SELECT rd_owner_api.read_source_intake_v1($1)")
            .bind(&binding.request_identity)
            .fetch_one(rd_owner)
            .await
            .unwrap();
    assert!(rejected.is_none());

    sqlx::query(
        "ALTER TABLE public.rd_source_intake_receipts_v1 DISABLE TRIGGER rd_source_intake_receipt_immutable_v1",
    )
    .execute(rd_owner)
    .await
    .unwrap();
    sqlx::query(
        "UPDATE public.rd_source_intake_receipts_v1 SET receipt_json=$2 WHERE receipt_identity=$1",
    )
    .bind(&receipt.receipt_identity)
    .bind(serde_json::to_value(receipt).unwrap())
    .execute(rd_owner)
    .await
    .unwrap();
    sqlx::query(
        "ALTER TABLE public.rd_source_intake_receipts_v1 ENABLE TRIGGER rd_source_intake_receipt_immutable_v1",
    )
    .execute(rd_owner)
    .await
    .unwrap();
    let restored: Option<serde_json::Value> =
        sqlx::query_scalar("SELECT rd_owner_api.read_source_intake_v1($1)")
            .bind(&binding.request_identity)
            .fetch_one(rd_owner)
            .await
            .unwrap();
    assert_eq!(
        restored
            .as_ref()
            .and_then(|value| value["content_digest"].as_str()),
        Some(content_digest)
    );

    sqlx::query(
        "ALTER TABLE public.rd_source_raw_payloads_v1 DISABLE TRIGGER rd_source_raw_payload_immutable_v1",
    )
    .execute(rd_owner)
    .await
    .unwrap();
    sqlx::query(
        "UPDATE public.rd_source_raw_payloads_v1 SET raw_payload=$2 WHERE content_digest=$1",
    )
    .bind(content_digest)
    .bind(b"{}" as &[u8])
    .execute(rd_owner)
    .await
    .unwrap();
    sqlx::query(
        "ALTER TABLE public.rd_source_raw_payloads_v1 ENABLE TRIGGER rd_source_raw_payload_immutable_v1",
    )
    .execute(rd_owner)
    .await
    .unwrap();
    let rejected: Option<serde_json::Value> =
        sqlx::query_scalar("SELECT rd_owner_api.read_source_intake_v1($1)")
            .bind(&binding.request_identity)
            .fetch_one(rd_owner)
            .await
            .unwrap();
    assert!(rejected.is_none());
}

#[rstest]
fn changed_bounded_interpretation_creates_successor_provenance() {
    let acquire = |started_receipt: &str, bounded_explanation: &str| {
        let mut interpretation = interpretation();
        interpretation.bounded_explanation = bounded_explanation.into();
        let started = TestStartedCustodyV1::fixture(
            "source-request-001",
            "product-edge-admission-001",
            started_receipt,
            interpretation,
        )
        .unwrap();
        let mut attempt = SourceIntakeAttemptV1::close_binding(request(), evidence()).unwrap();
        attempt.prepare("binding-commit-001", started).unwrap();
        let permit = attempt.reserve_invocation_fixture().unwrap();
        attempt
            .resolve_fixture(
                permit,
                http(200, "application/json", vec![success_body(DOI)]),
                1_800_000_000_100,
            )
            .unwrap();
        let provenance = attempt.committed_provenance().unwrap();
        (
            provenance.provenance_identity.clone(),
            provenance.bounded_interpretation_identity.clone(),
            provenance.bounded_interpretation_digest.clone(),
        )
    };

    let first = acquire("started-interpretation-001", "mechanism explanation");
    let successor = acquire(
        "started-interpretation-002",
        "successor mechanism explanation",
    );
    assert_ne!(first.0, successor.0);
    assert_ne!(first.1, successor.1);
    assert_ne!(first.2, successor.2);
}

#[rstest]
fn every_non_success_http_terminal_has_zero_positive_records() {
    for (status, expected) in [
        (201, AcquisitionTerminalV1::Malformed),
        (302, AcquisitionTerminalV1::Malformed),
        (400, AcquisitionTerminalV1::Malformed),
        (401, AcquisitionTerminalV1::AuthRequired),
        (403, AcquisitionTerminalV1::AccessDenied),
        (404, AcquisitionTerminalV1::NotFound),
        (418, AcquisitionTerminalV1::Malformed),
        (429, AcquisitionTerminalV1::RateLimited),
        (500, AcquisitionTerminalV1::Unavailable),
        (503, AcquisitionTerminalV1::Unavailable),
        (600, AcquisitionTerminalV1::Malformed),
    ] {
        let mut attempt = prepared_attempt();
        let permit = attempt.reserve_invocation_fixture().unwrap();
        let readback = attempt
            .resolve_fixture(
                permit,
                http(status, "application/json", vec![b"{}".to_vec()]),
                7,
            )
            .unwrap();
        assert_eq!(readback.terminal, Some(expected), "status {status}");
        assert!(attempt.raw_payload().is_none());
        assert!(attempt.committed_provenance().is_none());
        assert!(attempt.committed_candidate().is_none());
        assert_eq!(
            attempt.committed_outbox().unwrap().event_kind,
            "SOURCE_INTAKE_TERMINATED_V1"
        );
    }
}

#[rstest]
fn malformed_headers_preempt_recognized_http_status_terminals() {
    for status in [200, 401, 403, 404, 429, 500, 503] {
        for headers in [
            vec![
                ResponseHeaderV1 {
                    name: "content-type".into(),
                    value: "application/json".into(),
                },
                ResponseHeaderV1 {
                    name: "content-type".into(),
                    value: "application/json".into(),
                },
            ],
            vec![
                ResponseHeaderV1 {
                    name: "content-type".into(),
                    value: "application/json".into(),
                },
                ResponseHeaderV1 {
                    name: "etag".into(),
                    value: "invalid\u{1}control".into(),
                },
            ],
            vec![
                ResponseHeaderV1 {
                    name: "content-type".into(),
                    value: "application/json".into(),
                },
                ResponseHeaderV1 {
                    name: "etag".into(),
                    value: "invalid\tcontrol".into(),
                },
            ],
            vec![
                ResponseHeaderV1 {
                    name: "content-type".into(),
                    value: "application/json".into(),
                },
                ResponseHeaderV1 {
                    name: "etag".into(),
                    value: "invalid\u{7f}control".into(),
                },
            ],
        ] {
            let mut attempt = prepared_attempt();
            let permit = attempt.reserve_invocation_fixture().unwrap();
            let observation = OpenAlexResponseObservationV1::fixture_http(
                status,
                headers,
                vec![b"{}".to_vec()],
                vec![public_ip()],
            );
            let readback = attempt.resolve_fixture(permit, observation, 8).unwrap();
            assert_eq!(
                readback.terminal,
                Some(AcquisitionTerminalV1::Malformed),
                "status {status}"
            );
            assert!(attempt.raw_payload().is_none());
            assert!(attempt.committed_provenance().is_none());
            assert!(attempt.committed_candidate().is_none());
            assert!(attempt.committed_outbox().is_some());
        }
    }
}

#[rstest]
fn receipt_identity_binds_status_headers_and_commit_time() {
    let resolve = |status, etag: &str, committed_at| {
        let mut attempt = prepared_attempt();
        let permit = attempt.reserve_invocation_fixture().unwrap();
        let observation = OpenAlexResponseObservationV1::fixture_http(
            status,
            vec![
                ResponseHeaderV1 {
                    name: "content-type".into(),
                    value: "application/json".into(),
                },
                ResponseHeaderV1 {
                    name: "etag".into(),
                    value: etag.into(),
                },
            ],
            vec![b"{}".to_vec()],
            vec![public_ip()],
        );
        attempt
            .resolve_fixture(permit, observation, committed_at)
            .unwrap()
            .receipt
            .unwrap()
            .receipt_identity
    };

    let baseline = resolve(400, "fixture-a", 20);
    assert_ne!(baseline, resolve(418, "fixture-a", 20));
    assert_ne!(baseline, resolve(400, "fixture-b", 20));
    assert_ne!(baseline, resolve(400, "fixture-a", 21));
}

#[rstest]
fn redirect_timeout_and_response_loss_are_once_only_unavailable() {
    for observation in [
        OpenAlexResponseObservationV1::fixture_redirect(),
        OpenAlexResponseObservationV1::fixture_timeout(),
        OpenAlexResponseObservationV1::fixture_transport_unavailable(),
        OpenAlexResponseObservationV1::fixture_response_lost(),
    ] {
        let mut attempt = prepared_attempt();
        let permit = attempt.reserve_invocation_fixture().unwrap();
        let readback = attempt.resolve_fixture(permit, observation, 11).unwrap();
        assert_eq!(readback.terminal, Some(AcquisitionTerminalV1::Unavailable));
        assert_eq!(attempt.state(), SourceIntakeStateV1::Terminal);
        assert_eq!(
            attempt.reserve_invocation_fixture().unwrap_err(),
            SourceIntakeError::EffectNotAdmitted
        );
        assert!(attempt.committed_provenance().is_none());
    }
}

#[rstest]
fn reserved_recovery_resolves_same_identity_without_a_second_get() {
    let mut attempt = prepared_attempt();
    let permit = attempt.reserve_invocation_fixture().unwrap();
    let invocation_identity = permit.invocation_identity().to_string();
    drop(permit);

    let first = attempt
        .resolve_reserved_response_loss_fixture(&invocation_identity, 12)
        .unwrap();
    let replay = attempt
        .resolve_reserved_response_loss_fixture(&invocation_identity, 13)
        .unwrap();
    assert_eq!(first, replay);
    assert_eq!(
        attempt
            .resolve_reserved_response_loss_fixture("sha256:different", 14)
            .unwrap_err(),
        SourceIntakeError::IdentityConflict
    );
}

#[rstest]
fn dns_rebind_media_size_chunk_and_doi_mismatch_fail_closed() {
    let mut rebind = prepared_attempt();
    let permit = rebind.reserve_invocation_fixture().unwrap();
    let observation = OpenAlexResponseObservationV1::fixture_http(
        200,
        headers("application/json"),
        vec![success_body(DOI)],
        vec![IpAddr::V4(Ipv4Addr::new(1, 1, 1, 1))],
    );
    assert_eq!(
        rebind
            .resolve_fixture(permit, observation, 1)
            .unwrap()
            .terminal,
        Some(AcquisitionTerminalV1::Unavailable)
    );
    assert_eq!(rebind.state(), SourceIntakeStateV1::Terminal);

    let mut media = prepared_attempt();
    let permit = media.reserve_invocation_fixture().unwrap();
    assert_eq!(
        media
            .resolve_fixture(permit, http(200, "text/html", vec![success_body(DOI)]), 2)
            .unwrap()
            .terminal,
        Some(AcquisitionTerminalV1::Malformed)
    );

    let oversized_evidence = evidence_with(
        vec![public_ip()],
        0,
        0,
        32,
        5_000,
        SourceAcquisitionAdmissionV1::Admitted,
    );
    let mut oversized =
        SourceIntakeAttemptV1::close_binding(request(), oversized_evidence).unwrap();
    oversized.prepare("binding-commit-001", custody()).unwrap();
    let permit = oversized.reserve_invocation_fixture().unwrap();
    assert_eq!(
        oversized
            .resolve_fixture(
                permit,
                http(200, "application/json", vec![vec![b'x'; 33]]),
                3
            )
            .unwrap()
            .terminal,
        Some(AcquisitionTerminalV1::Malformed)
    );

    let mut mismatch = prepared_attempt();
    let permit = mismatch.reserve_invocation_fixture().unwrap();
    let readback = mismatch
        .resolve_fixture(
            permit,
            http(200, "application/json", vec![success_body("10.1234/other")]),
            4,
        )
        .unwrap();
    assert_eq!(readback.terminal, Some(AcquisitionTerminalV1::Malformed));
    assert!(mismatch.committed_provenance().is_none());
}

#[rstest]
fn duplicate_authoritative_provider_fields_are_malformed() {
    let body = format!(
        r#"{{"doi":"https://doi.org/{DOI}","doi":"https://doi.org/{DOI}","locations":[]}}"#
    )
    .into_bytes();
    let mut attempt = prepared_attempt();
    let permit = attempt.reserve_invocation_fixture().unwrap();
    assert_eq!(
        attempt
            .resolve_fixture(permit, http(200, "application/json", vec![body]), 5)
            .unwrap()
            .terminal,
        Some(AcquisitionTerminalV1::Malformed)
    );
}

#[rstest]
fn postgres_design_reuses_owner_lock_acl_outbox_and_keeps_raw_private() {
    let migration = SOURCE_INTAKE_MIGRATION_SQL_V1.join("\n");
    let terminal_reader = migration
        .split_once("CREATE OR REPLACE FUNCTION rd_owner_api.canonical_source_intake_custody_v1")
        .unwrap()
        .1
        .split_once("ALTER FUNCTION rd_owner_api.canonical_source_intake_custody_v1")
        .unwrap()
        .0;
    let postgres_source = include_str!("../src/source_intake/postgres.rs");
    let terms_sql = postgres_source
        .split_once("const PRE_INVOCATION_TERMS_BLOCKED_TRANSACTION_SQL_V1")
        .unwrap()
        .1
        .split_once("#[cfg(test)]")
        .unwrap()
        .0;
    let terms_method = postgres_source
        .split_once("pub async fn commit_source_intake_terms_blocked_in_transaction")
        .unwrap()
        .1
        .split_once("#[derive(Debug, Deserialize)]")
        .unwrap()
        .0;
    assert!(!postgres_source.contains("pub const PRE_INVOCATION_TERMS_BLOCKED_TRANSACTION_SQL_V1"));
    assert!(postgres_source.contains("commit_source_intake_terms_blocked_in_transaction"));
    assert!(migration.contains("OWNER TO rd_owner"));
    assert!(!migration.contains(
        "ALTER TABLE public.rd_source_intake_bindings_v1, public.rd_source_intake_receipts_v1"
    ));
    assert!(migration.contains("rd_owner_api.read_source_intake_v1"));
    assert!(migration.contains("'terminal', binding.terminal"));
    assert!(
        migration
            .contains("ALTER FUNCTION rd_owner_api.read_source_intake_v1(text) OWNER TO rd_owner")
    );
    assert!(migration.contains("REVOKE ALL ON FUNCTION rd_owner_api.read_source_intake_v1(text) FROM PUBLIC, product_edge_owner"));
    assert!(!migration.contains(
        "GRANT EXECUTE ON FUNCTION rd_owner_api.read_source_intake_v1(text) TO product_edge_owner"
    ));
    assert!(migration.contains("derive_source_acquisition_binding_identity_v1"));
    assert!(migration.contains("derive_source_acquisition_binding_digest_v1"));
    assert!(migration.contains("canonical_source_intake_json_v1"));
    assert!(migration.contains("binding - 'binding_identity' - 'binding_digest'"));
    assert!(migration.contains("'header_byte_limit','header_count_limit'"));
    assert!(migration.contains("valid_source_intake_receipt_v1"));
    assert!(migration.contains("count(*) FROM public.rd_source_intake_receipts_v1 singleton"));
    assert!(migration.contains("count(*) FROM public.rd_owner_outbox_v1 singleton"));
    assert!(migration.contains("pg_catalog.sha256(raw.raw_payload)"));
    assert!(
        terminal_reader
            .contains("binding.binding_json->>'request_identity' = binding.request_identity")
    );
    assert!(
        terminal_reader
            .contains("binding.binding_json->>'binding_identity' = binding.binding_identity")
    );
    assert!(
        terminal_reader.contains("outbox.committed_at_epoch_ms = receipt.committed_at_epoch_ms")
    );
    assert!(
        terminal_reader.contains("provenance.provenance_json = pg_catalog.jsonb_build_object(")
    );
    assert!(terminal_reader.contains("candidate.candidate_json = pg_catalog.jsonb_build_object("));
    assert!(terminal_reader.contains("receipt.receipt_json#>>'{retrieval_time,head_digest}'"));
    assert!(
        terms_method.find("validate_retrieval_time").unwrap()
            < terms_method
                .find("sqlx::query(PRE_INVOCATION_TERMS_BLOCKED_TRANSACTION_SQL_V1)")
                .unwrap()
    );
    assert!(migration.contains("WINDMILL_PRODUCT_EDGE"));
    assert!(!migration.contains("WORKBENCH_WEB"));
    assert!(!migration.contains("WORKBENCH_MCP"));

    for required in [
        "product_edge_admission",
        "admission_digest",
        "operation_manifest_digest",
        "policy_evidence_digest",
        "connector_policy_identity",
        "network_policy_identity",
        "dns_observation_digest",
        "redirect_policy_identity",
        "credential_handle_identity",
        "egress_policy_identity",
        "rights_valid_through_epoch_ms",
        "retention_valid_through_epoch_ms",
        "shared_time",
        "terminal_evidence_digest",
        "connected_address",
        "response_media_type",
        "response_size_bytes",
        "raw_content_digest",
        "source_class",
        "interpretation_status",
    ] {
        assert!(migration.contains(required), "missing {required}");
    }
    assert!(migration.contains("derive_openalex_location_rights_v1"));
    assert!(migration.contains("rd_owner_outbox_v1"));
    assert!(migration.contains("rd_source_raw_receipt_links_v1"));
    assert!(!migration.contains("content_digest text NOT NULL UNIQUE"));
    assert!(migration.contains(
        "GRANT SELECT, INSERT, UPDATE ON public.rd_source_intake_bindings_v1 TO rd_owner"
    ));
    assert!(migration.contains("reject_source_intake_terminal_mutation_v1"));
    assert!(
        migration
            .contains("rd_source_raw_payload_immutable_v1 BEFORE UPDATE OR DELETE OR TRUNCATE")
    );
    assert!(migration.contains("GRANT SELECT, INSERT, UPDATE, REFERENCES ON public.rd_source_intake_receipts_v1, public.rd_source_raw_payloads_v1"));
    assert!(!migration.contains(
        "GRANT SELECT, INSERT, UPDATE ON public.rd_source_intake_bindings_v1, public.rd_source_intake_receipts_v1"
    ));
    assert!(migration.contains("pg_catalog.sha256(raw.raw_payload)"));
    assert!(migration.contains("binding.raw_content_digest = binding.observed_content_digest"));
    assert!(migration.contains("binding.raw_link_receipt_identity = binding.receipt_identity"));
    assert!(
        migration.contains(
            "binding.provenance_identity = rd_owner_api.derive_source_intake_identity_v1("
        )
    );
    assert!(
        migration.contains(
            "binding.candidate_identity = rd_owner_api.derive_source_intake_identity_v1("
        )
    );
    assert!(
        migration
            .contains("binding.event_identity = rd_owner_api.derive_source_intake_identity_v1(")
    );
    assert!(
        migration
            .contains("binding.payload_digest = rd_owner_api.derive_source_intake_identity_v1(")
    );
    assert!(
        migration.contains(
            "REVOKE ALL ON public.rd_source_raw_payloads_v1, public.rd_source_raw_receipt_links_v1 FROM product_edge_owner"
        )
    );
    assert!(!migration.contains("CREATE ROLE"));
    assert!(!migration.contains("CREATE DATABASE"));
    assert!(TERMINAL_SUCCESS_TRANSACTION_SQL_V1.contains("FOR UPDATE"));
    assert!(TERMINAL_SUCCESS_TRANSACTION_SQL_V1.contains("SOURCE_INTAKE_TERMINATED_V1"));
    assert!(TERMINAL_SUCCESS_TRANSACTION_SQL_V1.contains("rd_source_raw_payloads_v1"));
    assert!(TERMINAL_SUCCESS_TRANSACTION_SQL_V1.contains("rd_source_raw_receipt_links_v1"));
    assert!(
        TERMINAL_SUCCESS_TRANSACTION_SQL_V1.contains("ON CONFLICT (content_digest) DO NOTHING")
    );
    assert!(
        TERMINAL_SUCCESS_TRANSACTION_SQL_V1
            .contains("CASE WHEN stored.raw_payload = $7 THEN stored.content_digest ELSE NULL END")
    );
    assert!(TERMINAL_SUCCESS_TRANSACTION_SQL_V1.contains("rd_research_source_provenance_v1"));
    assert!(TERMINAL_SUCCESS_TRANSACTION_SQL_V1.contains("pg_catalog.sha256($7)"));
    assert!(TERMINAL_SUCCESS_TRANSACTION_SQL_V1.contains("$4->>'receipt_identity' = $3"));
    assert!(TERMINAL_SUCCESS_TRANSACTION_SQL_V1.contains("$9->>'content_digest' = $6"));
    assert!(TERMINAL_SUCCESS_TRANSACTION_SQL_V1.contains("$4->>'response_status' = '200'"));
    assert!(TERMINAL_SUCCESS_TRANSACTION_SQL_V1.contains("octet_length($7) BETWEEN 1"));
    assert!(TERMINAL_SUCCESS_TRANSACTION_SQL_V1.contains("body.value->>'doi'"));
    assert!(TERMINAL_SUCCESS_TRANSACTION_SQL_V1.contains("json_object_keys(body.raw_value)"));
    assert!(TERMINAL_SUCCESS_TRANSACTION_SQL_V1.contains("count(DISTINCT key)"));
    assert!(TERMINAL_SUCCESS_TRANSACTION_SQL_V1.contains("'rd.source-intake.receipt.v1'"));
    assert!(TERMINAL_SUCCESS_TRANSACTION_SQL_V1.contains("'rd.source-candidate.v1'"));
    assert!(TERMINAL_SUCCESS_TRANSACTION_SQL_V1.contains("jsonb_object_keys($14)"));
    assert!(TERMINAL_SUCCESS_TRANSACTION_SQL_V1.contains("$9->'interpretation'"));
    assert!(
        TERMINAL_SUCCESS_TRANSACTION_SQL_V1
            .contains("$9->>'connector_identity' = binding_json->>'connector_identity'")
    );
    assert!(
        TERMINAL_SUCCESS_TRANSACTION_SQL_V1
            .contains("$9->>'connector_version' = binding_json->>'connector_version'")
    );
    assert!(
        TERMINAL_SUCCESS_TRANSACTION_SQL_V1.contains("$9->'retrieval_time' = $4->'retrieval_time'")
    );
    assert!(TERMINAL_SUCCESS_TRANSACTION_SQL_V1.contains(
        "$9->>'valid_through_epoch_ms' = $4#>>'{retrieval_time,valid_through_epoch_ms}'"
    ));
    assert!(
        !TERMINAL_SUCCESS_TRANSACTION_SQL_V1
            .contains("$9->>'connector_identity' = 'rd.openalex-work-by-doi'")
    );
    assert!(
        !TERMINAL_SUCCESS_TRANSACTION_SQL_V1
            .contains("$9->'retrieval_time' = binding_json->'shared_time'")
    );
    assert!(!TERMINAL_SUCCESS_TRANSACTION_SQL_V1.contains(
        "$9->>'valid_through_epoch_ms' = binding_json#>>'{shared_time,valid_through_epoch_ms}'"
    ));
    assert!(TERMINAL_FAILURE_TRANSACTION_SQL_V1.contains("state = 'INVOCATION_RESERVED'"));
    assert!(!TERMINAL_FAILURE_TRANSACTION_SQL_V1.contains("state = 'PREPARED'"));
    assert!(TERMINAL_FAILURE_TRANSACTION_SQL_V1.contains("'ABSENT', 'ABSENT'"));
    assert!(TERMINAL_FAILURE_TRANSACTION_SQL_V1.contains("NOT IN (401, 403, 404, 429)"));
    assert!(
        TERMINAL_FAILURE_TRANSACTION_SQL_V1
            .contains("$3->'response_header_digest' = 'null'::jsonb")
    );
    assert!(
        TERMINAL_FAILURE_TRANSACTION_SQL_V1
            .contains("jsonb_typeof($3->'response_status') IN ('number','null')")
    );
    assert!(!TERMINAL_FAILURE_TRANSACTION_SQL_V1.contains("rd_source_raw_payloads_v1"));
    assert!(!TERMINAL_FAILURE_TRANSACTION_SQL_V1.contains("rd_research_source_provenance_v1"));
    assert!(terms_sql.contains("state = 'PREPARED'"));
    assert!(terms_sql.contains("product_edge_started_json->>'reservation_digest' = $3"));
    assert!(terms_sql.contains("product_edge_started_json->>'started_state_digest' IS NULL"));
    assert!(terms_sql.contains("$5->>'terminal' = 'TERMS_OR_LICENSE_BLOCKED'"));
    assert!(terms_sql.contains("$5->'invocation_identity' = 'null'::jsonb"));
    assert!(terms_sql.contains("$5->>'policy_decision_identity' = $10"));
    assert!(terms_sql.contains("$5->>'policy_decision_digest' = $11"));
    assert!(terms_sql.contains("$5->'policy_decision_time' = $12"));
    assert!(terms_sql.contains(
        "'content_digest','invocation_identity','policy_decision_digest','policy_decision_identity',
      'policy_decision_time','receipt_identity','request_identity',"
    ));
    assert!(!terms_sql.contains(
        "'content_digest','invocation_identity','receipt_identity','request_identity',
      'policy_decision_digest','policy_decision_identity','policy_decision_time',"
    ));
    assert!(!terms_sql.contains("rd_source_raw_payloads_v1"));
    assert!(!terms_sql.contains("rd_research_source_provenance_v1"));
    assert!(!terms_sql.contains("rd_source_candidates_v1"));
    assert!(migration.contains("'receipt', receipt.receipt_json"));
    assert!(migration.contains("terminal = 'RETRIEVED' AND response_status = 200"));
    assert!(migration.contains("FOREIGN KEY (receipt_identity, terminal)"));
    assert!(migration.contains("FOREIGN KEY (terminal_receipt_identity)"));
    assert!(!migration.contains("RENAME TO canonical_source_intake_custody_v1"));
    assert!(
        migration
            .contains("SELECT rd_owner_api.canonical_source_intake_custody_v1(p_request_identity)")
    );
    let canonical = migration
        .find(
            "CREATE OR REPLACE FUNCTION rd_owner_api.canonical_source_intake_custody_v1(p_request_identity text)",
        )
        .unwrap();
    assert_eq!(
        migration
            .matches("CREATE OR REPLACE FUNCTION rd_owner_api.canonical_source_intake_custody_v1(",)
            .count(),
        1
    );
    let canonical_acl = migration
        .find("REVOKE ALL ON FUNCTION rd_owner_api.canonical_source_intake_custody_v1(text)")
        .unwrap();
    let wrapper = migration
        .rfind(
            "CREATE OR REPLACE FUNCTION rd_owner_api.read_source_intake_v1(p_request_identity text)",
        )
        .unwrap();
    let wrapper_acl = migration
        .rfind("REVOKE ALL ON FUNCTION rd_owner_api.read_source_intake_v1(text)")
        .unwrap();
    assert!(canonical < canonical_acl);
    assert!(canonical_acl < wrapper);
    assert!(wrapper < wrapper_acl);
    assert!(migration.contains(
        "CREATE OR REPLACE FUNCTION rd_owner_api.peek_source_intake_research_handoff_v1("
    ));
    assert!(migration.contains(
        "CREATE OR REPLACE FUNCTION rd_owner_api.lock_source_intake_research_handoff_v1("
    ));
    assert!(
        migration.contains(
            "FOR SHARE OF binding, receipt, raw_link, raw, provenance, candidate, outbox"
        )
    );
    assert!(migration.contains(
        "REVOKE ALL ON FUNCTION rd_owner_api.peek_source_intake_research_handoff_v1(text,text,text) FROM PUBLIC, product_edge_owner"
    ));
    assert!(migration.contains(
        "REVOKE ALL ON FUNCTION rd_owner_api.lock_source_intake_research_handoff_v1(text,text,text) FROM PUBLIC, product_edge_owner"
    ));
    let handoff_projection = migration
        .split("CREATE OR REPLACE FUNCTION rd_owner_api.peek_source_intake_research_handoff_v1(")
        .nth(1)
        .unwrap()
        .split("ALTER FUNCTION rd_owner_api.peek_source_intake_research_handoff_v1")
        .next()
        .unwrap();
    assert!(!handoff_projection.contains("'raw_payload'"));
}

#[rstest]
fn existing_source_intake_topology_validator_is_exact_and_read_only() {
    let source = include_str!("../src/source_intake/postgres.rs");
    let validator = source
        .split_once("pub async fn validate_existing_source_intake_topology")
        .expect("Source Intake topology validator")
        .1
        .split_once("#[derive(Debug)]")
        .expect("validator boundary")
        .0;

    assert!(validator.contains("session_user='rd_owner'"));
    assert!(validator.contains("pg_catalog.pg_get_userbyid(relation.relowner)<>'rd_custodian'"));
    assert!(validator.contains("pg_catalog.pg_get_userbyid(routine.proowner)<>'rd_custodian'"));
    assert!(validator.contains("vibe-closed-relation-v2:"));
    assert!(validator.contains("vibe-source-md5:"));
    assert!(validator.contains("required_triggers"));
    assert!(validator.contains("'rd_owner:DELETE:false'"));
    assert!(!validator.contains("product_edge_owner:SELECT"));
    assert!(!validator.contains("SOURCE_INTAKE_MIGRATION_SQL_V1"));
    assert!(!validator.contains("sqlx::query("));
    assert!(!validator.contains(".execute("));
    assert!(!validator.contains("CREATE TABLE"));
    assert!(!validator.contains("ALTER TABLE"));
    assert!(!validator.contains("DROP "));
}
