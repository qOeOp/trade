use std::{
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use rstest::rstest;
use sqlx::{PgPool, postgres::PgPoolOptions};
use vibe_operator_authorization::{
    OperationManifestBindingV1, OperatorAuthorizationIssuanceProposalV1,
    OperatorAuthorizationIssuerPostgresV1, OperatorAuthorizationLocatorV1,
    OperatorAuthorizationRevocationProposalV1, OperatorAuthorizationScopeV1,
};
use vibe_product_edge::{
    AgentOperationManifestProposalV1, DownstreamAdmissionModeV1, ProductEdgeAdmissionLocatorV1,
    ProductEdgeAdmissionRequestV1, ProductEdgeAuthorizationTrustV1, ProductEdgeBootstrapProposalV1,
    ProductEdgePostgresOwnerV1, ProductEdgeSuccessorProposalV1,
    resolve_admission_for_downstream_in_transaction,
};
use vibe_strategy_factory::{
    artifact_build::{
        ARTIFACT_BUILD_OPERATION_V1, ARTIFACT_BUILD_SCHEMA_V1, ArtifactBuildCandidateV1,
        ArtifactBuildDisposition, ArtifactBuildOwnerPort, ArtifactBuildRequestV1,
        ArtifactBuildResolution, GeneratedDirectionV1, GeneratedSignalV1, GeneratedStrategyLogicV1,
    },
    artifact_build_postgres::PostgresArtifactBuildOwnerV1,
    product_edge::{
        ProductEdgeChannel, ProductEdgeResearchGoalRequestV2, ProductEdgeResolution,
        RESEARCH_GOAL_OPERATION_V2, RESEARCH_GOAL_SCHEMA_V2, RESEARCH_OWNER_V1,
        ResearchGoalOwnerError, ResearchGoalOwnerPortV2, ResearchNextLegalAction,
        ResearchRequestDisposition, ResearchSourceV1, SourcedResearchGoalV2, TrialFamilyProposalV1,
    },
    product_edge_postgres::PostgresResearchGoalOwnerV1,
    trial_family::TrialFamilyDirectResultV1,
};
use vibe_testkit::postgres::{DedicatedPostgresTestDatabase, DedicatedPostgresTestMutation};

#[rstest]
fn direct_family_negative_results_preserve_the_transport_contract() {
    assert_eq!(
        serde_json::to_string(&TrialFamilyDirectResultV1::legacy_unavailable()).unwrap(),
        r#"{"schema_version":1,"resolution":"TRIAL_FAMILY_UNAVAILABLE_LEGACY","trial_family":null,"artifact_trial_family":null}"#
    );
    assert_eq!(
        serde_json::to_string(&TrialFamilyDirectResultV1::unavailable()).unwrap(),
        r#"{"schema_version":1,"resolution":"UNAVAILABLE","trial_family":null,"artifact_trial_family":null}"#
    );
}

#[tokio::test]
#[ignore = "requires admitted OA/PE/R&D test database URLs"]
async fn postgres_owner_persists_one_family_and_replays_without_partial_conflict_writes() {
    let test_database = test_database().await;
    let _mutation = test_database.mutation();
    let database_url = test_database.database_url().to_string();
    let owner = PostgresResearchGoalOwnerV1::connect(&database_url, &database_url)
        .await
        .unwrap();
    let pool = PgPoolOptions::new()
        .max_connections(2)
        .connect(&database_url)
        .await
        .unwrap();
    let suffix = unique_suffix();
    let edge = TestProductEdge::bootstrap(&database_url, &suffix).await;
    let request_identity = format!("research-request-v2-family-{suffix}");
    let submitted_request = edge.admit_v2(request(&request_identity)).await;
    let mut downstream_cut = pool.begin().await.unwrap();
    resolve_admission_for_downstream_in_transaction(
        &mut downstream_cut,
        &submitted_request.admission,
        DownstreamAdmissionModeV1::FirstMutation {
            read_cut_epoch_ms: current_epoch_ms(),
        },
    )
    .await
    .unwrap();
    downstream_cut.rollback().await.unwrap();

    let first = owner.submit_v2(submitted_request.clone()).await.unwrap();
    let replay = owner.submit_v2(submitted_request.clone()).await.unwrap();
    assert_eq!(first, replay);
    assert_eq!(first.resolution(), ProductEdgeResolution::Accepted);
    let receipt = first.owner_receipt().unwrap();
    let intent_identity = receipt
        .resulting_research_intent_identity
        .as_deref()
        .unwrap();
    let family_identity = first.trial_family().unwrap().root().trial_family_identity();
    assert_eq!(
        owner_counts(&pool, &request_identity, intent_identity, family_identity).await,
        [1, 1, 1, 1, 1]
    );
    let direct = owner
        .resolve_trial_family_by_intent(intent_identity)
        .await
        .unwrap();
    assert!(direct.resolution().is_available());
    assert_eq!(
        direct
            .trial_family()
            .unwrap()
            .root()
            .trial_family_identity(),
        family_identity
    );
    assert!(direct.artifact_trial_family().is_none());

    let mut changed = submitted_request;
    changed.goal.hypothesis.push_str(" changed");
    assert!(matches!(
        owner.submit_v2(changed).await,
        Err(ResearchGoalOwnerError::ConflictingReplay)
    ));
    assert_eq!(
        owner_counts(&pool, &request_identity, intent_identity, family_identity).await,
        [1, 1, 1, 1, 1]
    );

    let rejected_identity = format!("research-request-v2-rejected-{suffix}");
    let mut rejected = request(&rejected_identity);
    rejected.trial_family_proposal.trial_budget = 0;
    let rejected = edge.admit_v2(rejected).await;
    let rejected_result = owner.submit_v2(rejected).await.unwrap();
    assert_eq!(
        rejected_result.resolution(),
        ProductEdgeResolution::RejectedNoWrite
    );
    assert_eq!(
        rejected_result.owner_receipt().unwrap().disposition,
        ResearchRequestDisposition::RejectedNoWrite
    );
    assert_eq!(
        count(
            &pool,
            "SELECT COUNT(*) FROM rd_research_request_receipts_v1 WHERE request_identity = $1",
            &rejected_identity,
        )
        .await,
        1
    );

    cleanup_research(&_mutation, &request_identity, family_identity).await;
    sqlx::query("DELETE FROM rd_research_request_receipts_v1 WHERE request_identity = $1")
        .bind(rejected_identity)
        .execute(&pool)
        .await
        .unwrap();
    cleanup_prerequisites(
        &_mutation,
        &format!("research-request-v2-rejected-{suffix}"),
    )
    .await;
}

#[tokio::test]
#[ignore = "requires admitted OA/PE/R&D test database URLs"]
async fn every_v2_semantic_rejection_is_rejection_only_and_replays_exactly() {
    let test_database = test_database().await;
    let _mutation = test_database.mutation();
    let database_url = test_database.database_url().to_string();
    let owner = PostgresResearchGoalOwnerV1::connect(&database_url, &database_url)
        .await
        .unwrap();
    let pool = PgPoolOptions::new()
        .max_connections(2)
        .connect(&database_url)
        .await
        .unwrap();
    let suffix = unique_suffix();
    let edge = TestProductEdge::bootstrap(&database_url, &suffix).await;

    for (code, invalid) in invalid_v2_requests(&suffix) {
        let invalid = edge.admit_v2(invalid).await;
        let request_identity = invalid.request_identity.clone();
        let rd_heads_before = json_rows(
            &pool,
            "SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY principal_scope_key), '[]'::jsonb) FROM rd_independence_basis_heads_v1 t",
        )
        .await;
        let qualification_heads_before = json_rows(
            &pool,
            "SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY principal_scope_key), '[]'::jsonb) FROM qualification_protected_feedback_heads_v1 t",
        )
        .await;
        let first = owner.submit_v2(invalid.clone()).await.unwrap();
        assert_eq!(first.resolution(), ProductEdgeResolution::RejectedNoWrite);
        assert_eq!(
            first.owner_receipt().unwrap().rejection_code.as_deref(),
            Some(code)
        );
        assert!(first.independence_basis().is_none());
        assert!(first.protected_feedback().is_none());
        assert!(first.trial_family().is_none());
        assert_eq!(owner.submit_v2(invalid.clone()).await.unwrap(), first);
        assert_eq!(
            owner
                .resolve_v2(&request_identity, &invalid.admission)
                .await
                .unwrap(),
            first
        );
        assert_eq!(
            rejected_authority_counts(&pool, &request_identity).await,
            [1, 0, 0, 0]
        );
        assert_eq!(
            json_rows(
                &pool,
                "SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY principal_scope_key), '[]'::jsonb) FROM rd_independence_basis_heads_v1 t",
            )
            .await,
            rd_heads_before
        );
        assert_eq!(
            json_rows(
                &pool,
                "SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY principal_scope_key), '[]'::jsonb) FROM qualification_protected_feedback_heads_v1 t",
            )
            .await,
            qualification_heads_before
        );
        let mut changed = invalid;
        changed.goal.hypothesis.push_str(" changed meaning");
        assert!(matches!(
            owner.submit_v2(changed).await,
            Err(ResearchGoalOwnerError::ConflictingReplay)
        ));
        assert_eq!(
            rejected_authority_counts(&pool, &request_identity).await,
            [1, 0, 0, 0]
        );
        sqlx::query("DELETE FROM rd_research_request_receipts_v1 WHERE request_identity = $1")
            .bind(request_identity)
            .execute(&pool)
            .await
            .unwrap();
    }
}

#[tokio::test]
#[ignore = "requires admitted OA/PE/R&D test database URLs"]
async fn invalid_successor_cannot_poison_heads_and_verified_lineage_never_skips_corruption() {
    let test_database = test_database().await;
    let _mutation = test_database.mutation();
    let database_url = test_database.database_url().to_string();
    let owner = PostgresResearchGoalOwnerV1::connect(&database_url, &database_url)
        .await
        .unwrap();
    let pool = PgPoolOptions::new()
        .max_connections(2)
        .connect(&database_url)
        .await
        .unwrap();
    let suffix = unique_suffix();
    let edge = TestProductEdge::bootstrap(&database_url, &suffix).await;
    let a_request = format!("research-request-v2-lineage-a-{suffix}");
    let b_request = format!("research-request-v2-lineage-b-{suffix}");
    let c_request = format!("research-request-v2-lineage-c-{suffix}");
    let accepted_a = owner
        .submit_v2(edge.admit_v2(request(&a_request)).await)
        .await
        .unwrap();
    let a_intent = accepted_a
        .owner_receipt()
        .unwrap()
        .resulting_research_intent_identity
        .as_deref()
        .unwrap()
        .to_string();
    let a_family = accepted_a
        .trial_family()
        .unwrap()
        .root()
        .trial_family_identity()
        .to_string();
    let rd_head = json_rows(
        &pool,
        "SELECT to_jsonb(t) FROM rd_independence_basis_heads_v1 t WHERE principal = 'admin'",
    )
    .await;
    let qualification_head = json_rows(
        &pool,
        "SELECT to_jsonb(t) FROM qualification_protected_feedback_heads_v1 t WHERE principal = 'admin'",
    )
    .await;
    let mut invalid_b = request(&b_request);
    invalid_b.trial_family_proposal.trial_budget = 0;
    let invalid_b = edge.admit_v2(invalid_b).await;
    assert_eq!(
        owner.submit_v2(invalid_b).await.unwrap().resolution(),
        ProductEdgeResolution::RejectedNoWrite
    );
    assert_eq!(
        json_rows(
            &pool,
            "SELECT to_jsonb(t) FROM rd_independence_basis_heads_v1 t WHERE principal = 'admin'",
        )
        .await,
        rd_head
    );
    assert_eq!(
        json_rows(
            &pool,
            "SELECT to_jsonb(t) FROM qualification_protected_feedback_heads_v1 t WHERE principal = 'admin'",
        )
        .await,
        qualification_head
    );

    let original_request_json: serde_json::Value = sqlx::query_scalar(
        "SELECT request_json FROM rd_research_request_receipts_v1 WHERE request_identity = $1",
    )
    .bind(&a_request)
    .fetch_one(&pool)
    .await
    .unwrap();
    let original_receipt_json: serde_json::Value = sqlx::query_scalar(
        "SELECT receipt_json FROM rd_research_request_receipts_v1 WHERE request_identity = $1",
    )
    .bind(&a_request)
    .fetch_one(&pool)
    .await
    .unwrap();
    let original_intent_json: serde_json::Value = sqlx::query_scalar(
        "SELECT intent_json FROM rd_research_request_receipts_v1 WHERE request_identity = $1",
    )
    .bind(&a_request)
    .fetch_one(&pool)
    .await
    .unwrap();
    let original_view_json: serde_json::Value = sqlx::query_scalar(
        "SELECT view_json FROM rd_research_request_receipts_v1 WHERE request_identity = $1",
    )
    .bind(&a_request)
    .fetch_one(&pool)
    .await
    .unwrap();
    let original_digest: String = sqlx::query_scalar(
        "SELECT semantic_digest FROM rd_research_request_receipts_v1 WHERE request_identity = $1",
    )
    .bind(&a_request)
    .fetch_one(&pool)
    .await
    .unwrap();
    let original_time: i64 = sqlx::query_scalar(
        "SELECT committed_at_epoch_ms FROM rd_research_request_receipts_v1 WHERE request_identity = $1",
    )
    .bind(&a_request)
    .fetch_one(&pool)
    .await
    .unwrap();

    for (mutation, restore, original) in [
        (
            "UPDATE rd_research_request_receipts_v1 SET intent_json = jsonb_set(intent_json, '{schema_version}', '99'::jsonb) WHERE request_identity = $1",
            "UPDATE rd_research_request_receipts_v1 SET intent_json = $2 WHERE request_identity = $1",
            original_intent_json.clone(),
        ),
        (
            "UPDATE rd_research_request_receipts_v1 SET receipt_json = jsonb_set(receipt_json, '{disposition}', '\"REJECTED_NO_WRITE\"'::jsonb) WHERE request_identity = $1",
            "UPDATE rd_research_request_receipts_v1 SET receipt_json = $2 WHERE request_identity = $1",
            original_receipt_json.clone(),
        ),
        (
            "UPDATE rd_research_request_receipts_v1 SET view_json = jsonb_set(view_json, '{trusted_principal}', '\"forged-other-scope\"'::jsonb) WHERE request_identity = $1",
            "UPDATE rd_research_request_receipts_v1 SET view_json = $2 WHERE request_identity = $1",
            original_view_json.clone(),
        ),
        (
            "UPDATE rd_research_request_receipts_v1 SET view_json = jsonb_set(view_json, '{authorized_scope}', '[\"forged\"]'::jsonb) WHERE request_identity = $1",
            "UPDATE rd_research_request_receipts_v1 SET view_json = $2 WHERE request_identity = $1",
            original_view_json.clone(),
        ),
        (
            "UPDATE rd_research_request_receipts_v1 SET request_json = jsonb_set(request_json, '{request,admission,admission_identity}', '\"forged-admission\"'::jsonb) WHERE request_identity = $1",
            "UPDATE rd_research_request_receipts_v1 SET request_json = $2 WHERE request_identity = $1",
            original_request_json.clone(),
        ),
        (
            "UPDATE rd_research_request_receipts_v1 SET request_json = jsonb_set(request_json, '{request,admission,admission_digest}', '\"sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff\"'::jsonb) WHERE request_identity = $1",
            "UPDATE rd_research_request_receipts_v1 SET request_json = $2 WHERE request_identity = $1",
            original_request_json.clone(),
        ),
        (
            "UPDATE rd_research_request_receipts_v1 SET request_json = NULL WHERE request_identity = $1",
            "UPDATE rd_research_request_receipts_v1 SET request_json = $2 WHERE request_identity = $1",
            original_request_json.clone(),
        ),
    ] {
        sqlx::query(mutation)
            .bind(&a_request)
            .execute(&pool)
            .await
            .unwrap();
        assert_lineage_unavailable_without_writes(&owner, &edge, &pool, &c_request).await;
        sqlx::query(restore)
            .bind(&a_request)
            .bind(original)
            .execute(&pool)
            .await
            .unwrap();
    }

    sqlx::query("UPDATE rd_research_request_receipts_v1 SET semantic_digest = semantic_digest || '-corrupt' WHERE request_identity = $1")
        .bind(&a_request).execute(&pool).await.unwrap();
    assert_lineage_unavailable_without_writes(&owner, &edge, &pool, &c_request).await;
    sqlx::query("UPDATE rd_research_request_receipts_v1 SET semantic_digest = $2 WHERE request_identity = $1")
        .bind(&a_request).bind(&original_digest).execute(&pool).await.unwrap();
    sqlx::query("UPDATE rd_research_request_receipts_v1 SET committed_at_epoch_ms = committed_at_epoch_ms + 1 WHERE request_identity = $1")
        .bind(&a_request).execute(&pool).await.unwrap();
    assert_lineage_unavailable_without_writes(&owner, &edge, &pool, &c_request).await;
    sqlx::query("UPDATE rd_research_request_receipts_v1 SET committed_at_epoch_ms = $2 WHERE request_identity = $1")
        .bind(&a_request).bind(original_time).execute(&pool).await.unwrap();

    let accepted_c = owner
        .submit_v2(edge.admit_v2(request(&c_request)).await)
        .await
        .unwrap();
    assert_eq!(accepted_c.resolution(), ProductEdgeResolution::Accepted);
    assert_eq!(
        accepted_c
            .trial_family()
            .unwrap()
            .root()
            .policy()
            .semantic_predecessor_frontier,
        vec![a_intent]
    );
    let c_family = accepted_c
        .trial_family()
        .unwrap()
        .root()
        .trial_family_identity()
        .to_string();
    cleanup_research(&_mutation, &c_request, &c_family).await;
    sqlx::query("DELETE FROM rd_research_request_receipts_v1 WHERE request_identity = $1")
        .bind(&b_request)
        .execute(&pool)
        .await
        .unwrap();
    cleanup_research(&_mutation, &a_request, &a_family).await;
}

#[tokio::test]
#[ignore = "requires admitted OA/PE/R&D test database URLs"]
async fn qualification_basis_cannot_terminalize_after_authority_revocation() {
    let test_database = test_database().await;
    let _mutation = test_database.mutation();
    let database_url = test_database.database_url().to_string();
    let owner = PostgresResearchGoalOwnerV1::connect(&database_url, &database_url)
        .await
        .unwrap();
    let pool = PgPoolOptions::new()
        .max_connections(2)
        .connect(&database_url)
        .await
        .unwrap();
    let suffix = unique_suffix();
    let mut edge = TestProductEdge::bootstrap(&database_url, &suffix).await;
    let request_identity = format!("research-request-v2-qualification-recovery-{suffix}");
    let successor_identity = format!("research-request-v2-qualification-successor-{suffix}");
    let admitted_request = edge.admit_v2(request(&request_identity)).await;
    let admitted_successor = edge.admit_v2(request(&successor_identity)).await;
    sqlx::query("DROP TABLE qualification_owner_outbox_v1, qualification_protected_feedback_heads_v1, qualification_protected_feedback_projections_v1")
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        owner
            .submit_v2(admitted_request.clone())
            .await
            .unwrap()
            .resolution(),
        ProductEdgeResolution::SubmittedOrUnknown
    );
    assert_eq!(
        count(
            &pool,
            "SELECT COUNT(*) FROM rd_independence_bases_v1 WHERE request_identity = $1",
            &request_identity,
        )
        .await,
        1
    );
    assert_eq!(
        count(
            &pool,
            "SELECT COUNT(*) FROM rd_research_request_receipts_v1 WHERE request_identity = $1",
            &request_identity,
        )
        .await,
        0
    );
    let basis_identity: String = sqlx::query_scalar(
        "SELECT basis_identity FROM rd_independence_bases_v1 WHERE request_identity = $1",
    )
    .bind(&request_identity)
    .fetch_one(&pool)
    .await
    .unwrap();
    let basis_counts_before = [
        count(
            &pool,
            "SELECT COUNT(*) FROM rd_independence_bases_v1 WHERE request_identity = $1",
            &request_identity,
        )
        .await,
        count(
            &pool,
            "SELECT COUNT(*) FROM rd_independence_basis_admissions_v1 WHERE request_identity = $1",
            &request_identity,
        )
        .await,
        count(
            &pool,
            "SELECT COUNT(*) FROM rd_independence_basis_heads_v1 WHERE basis_identity = $1",
            &basis_identity,
        )
        .await,
        count(
            &pool,
            "SELECT COUNT(*) FROM rd_owner_outbox_v1 WHERE aggregate_identity = $1 AND event_kind = 'INDEPENDENCE_BASIS_PRECOMMITTED_V1'",
            &basis_identity,
        )
        .await,
    ];
    assert_eq!(basis_counts_before, [1, 1, 1, 1]);

    let mut changed = admitted_request.clone();
    changed.goal.hypothesis.push_str(" changed after basis");
    assert!(matches!(
        owner.submit_v2(changed).await,
        Err(ResearchGoalOwnerError::ConflictingReplay)
    ));
    let mut changed_admission = admitted_request.clone();
    changed_admission
        .admission
        .admission_digest
        .push_str("-changed");
    assert!(matches!(
        owner.submit_v2(changed_admission).await,
        Err(ResearchGoalOwnerError::ConflictingReplay)
    ));

    let custody_digest: String = sqlx::query_scalar(
        "SELECT custody_digest FROM rd_independence_basis_admissions_v1 WHERE request_identity = $1",
    )
    .bind(&request_identity)
    .fetch_one(&pool)
    .await
    .unwrap();
    sqlx::query("UPDATE rd_independence_basis_admissions_v1 SET custody_digest = custody_digest || '-tampered' WHERE request_identity = $1")
        .bind(&request_identity)
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        owner
            .submit_v2(admitted_request.clone())
            .await
            .unwrap()
            .resolution(),
        ProductEdgeResolution::SubmittedOrUnknown
    );
    sqlx::query("UPDATE rd_independence_basis_admissions_v1 SET custody_digest = $2 WHERE request_identity = $1")
        .bind(&request_identity)
        .bind(custody_digest)
        .execute(&pool)
        .await
        .unwrap();

    assert!(matches!(
        owner.submit_v2(admitted_successor).await,
        Err(ResearchGoalOwnerError::ConflictingReplay)
    ));
    assert_eq!(
        count(
            &pool,
            "SELECT COUNT(*) FROM rd_independence_bases_v1 WHERE request_identity = $1",
            &successor_identity,
        )
        .await,
        0
    );
    edge.activate_policy_equivalent_successor(&suffix).await;
    edge.activate_policy_equivalent_successor(&suffix).await;
    edge.revoke_authorization().await;

    let recovered_owner = PostgresResearchGoalOwnerV1::connect(&database_url, &database_url)
        .await
        .unwrap();
    let recovered = recovered_owner
        .resolve_v2(&request_identity, &admitted_request.admission)
        .await
        .unwrap();
    assert_eq!(
        recovered.resolution(),
        ProductEdgeResolution::SubmittedOrUnknown
    );
    assert!(recovered.owner_receipt().is_none());
    assert!(recovered.research_view().is_none());
    assert!(recovered.trial_family().is_none());
    assert_eq!(
        recovered.next_legal_action(),
        ResearchNextLegalAction::ResolveSameRequestIdentity
    );
    assert_eq!(
        [
            count(
                &pool,
                "SELECT COUNT(*) FROM rd_independence_bases_v1 WHERE request_identity = $1",
                &request_identity,
            )
            .await,
            count(
                &pool,
                "SELECT COUNT(*) FROM rd_independence_basis_admissions_v1 WHERE request_identity = $1",
                &request_identity,
            )
            .await,
            count(
                &pool,
                "SELECT COUNT(*) FROM rd_independence_basis_heads_v1 WHERE basis_identity = $1",
                &basis_identity,
            )
            .await,
            count(
                &pool,
                "SELECT COUNT(*) FROM rd_owner_outbox_v1 WHERE aggregate_identity = $1 AND event_kind = 'INDEPENDENCE_BASIS_PRECOMMITTED_V1'",
                &basis_identity,
            )
            .await,
        ],
        basis_counts_before
    );
    assert_eq!(
        count(
            &pool,
            "SELECT COUNT(*) FROM rd_research_request_receipts_v1 WHERE request_identity = $1",
            &request_identity,
        )
        .await,
        0
    );
    cleanup_prerequisites(&_mutation, &request_identity).await;
}

#[tokio::test]
#[ignore = "requires admitted OA/PE/R&D test database URLs"]
async fn qualification_basis_recovers_under_immediate_policy_equivalent_successor() {
    let test_database = test_database().await;
    let _mutation = test_database.mutation();
    let database_url = test_database.database_url().to_string();
    let owner = PostgresResearchGoalOwnerV1::connect(&database_url, &database_url)
        .await
        .unwrap();
    let pool = PgPoolOptions::new()
        .max_connections(2)
        .connect(&database_url)
        .await
        .unwrap();
    let suffix = unique_suffix();
    let mut edge = TestProductEdge::bootstrap(&database_url, &suffix).await;
    let request_identity = format!("research-request-v2-immediate-recovery-{suffix}");
    let admitted_request = edge.admit_v2(request(&request_identity)).await;
    sqlx::query("DROP TABLE qualification_owner_outbox_v1, qualification_protected_feedback_heads_v1, qualification_protected_feedback_projections_v1")
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        owner
            .submit_v2(admitted_request.clone())
            .await
            .unwrap()
            .resolution(),
        ProductEdgeResolution::SubmittedOrUnknown
    );
    edge.activate_policy_equivalent_successor(&suffix).await;

    let recovered_owner = PostgresResearchGoalOwnerV1::connect(&database_url, &database_url)
        .await
        .unwrap();
    let recovered = recovered_owner
        .resolve_v2(&request_identity, &admitted_request.admission)
        .await
        .unwrap();
    assert_eq!(recovered.resolution(), ProductEdgeResolution::Accepted);
    let family = recovered
        .trial_family()
        .unwrap()
        .root()
        .trial_family_identity()
        .to_string();
    cleanup_research(&_mutation, &request_identity, &family).await;
}

#[tokio::test]
#[ignore = "requires admitted OA/PE/R&D test database URLs"]
async fn committed_basis_cannot_terminalize_after_original_authority_expires() {
    let test_database = test_database().await;
    let _mutation = test_database.mutation();
    let database_url = test_database.database_url().to_string();
    let owner = PostgresResearchGoalOwnerV1::connect(&database_url, &database_url)
        .await
        .unwrap();
    let pool = PgPoolOptions::new()
        .max_connections(2)
        .connect(&database_url)
        .await
        .unwrap();
    let suffix = unique_suffix();
    let edge = TestProductEdge::bootstrap_with_validity(&database_url, &suffix, 10_000).await;
    let request_identity = format!("research-request-v2-basis-expiry-{suffix}");
    let admitted_request = edge.admit_v2(request(&request_identity)).await;
    sqlx::query("DROP TABLE qualification_owner_outbox_v1, qualification_protected_feedback_heads_v1, qualification_protected_feedback_projections_v1")
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        owner
            .submit_v2(admitted_request.clone())
            .await
            .unwrap()
            .resolution(),
        ProductEdgeResolution::SubmittedOrUnknown
    );
    let wait_ms = edge
        .valid_through_epoch_ms
        .saturating_sub(current_epoch_ms())
        .saturating_add(1);
    tokio::time::sleep(Duration::from_millis(wait_ms)).await;
    let recovered_owner = PostgresResearchGoalOwnerV1::connect(&database_url, &database_url)
        .await
        .unwrap();
    let recovered = recovered_owner
        .resolve_v2(&request_identity, &admitted_request.admission)
        .await
        .unwrap();
    assert_eq!(
        recovered.resolution(),
        ProductEdgeResolution::SubmittedOrUnknown
    );
    assert!(recovered.owner_receipt().is_none());
    assert!(recovered.research_view().is_none());
    assert!(recovered.trial_family().is_none());
    assert_eq!(
        count(
            &pool,
            "SELECT COUNT(*) FROM rd_research_request_receipts_v1 WHERE request_identity = $1",
            &request_identity,
        )
        .await,
        0
    );
    cleanup_prerequisites(&_mutation, &request_identity).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "requires admitted OA/PE/R&D test database URLs"]
async fn concurrent_invalid_and_valid_same_scope_serialize_without_invalid_authority() {
    let test_database = test_database().await;
    let _mutation = test_database.mutation();
    let database_url = test_database.database_url().to_string();
    let owner = Arc::new(
        PostgresResearchGoalOwnerV1::connect(&database_url, &database_url)
            .await
            .unwrap(),
    );
    let pool = PgPoolOptions::new()
        .max_connections(2)
        .connect(&database_url)
        .await
        .unwrap();
    let suffix = unique_suffix();
    let edge = TestProductEdge::bootstrap(&database_url, &suffix).await;
    let invalid_identity = format!("research-request-v2-concurrent-invalid-{suffix}");
    let valid_identity = format!("research-request-v2-concurrent-valid-{suffix}");
    let mut invalid = request(&invalid_identity);
    invalid.trial_family_proposal.trial_budget = 0;
    let invalid = edge.admit_v2(invalid).await;
    let valid = edge.admit_v2(request(&valid_identity)).await;
    let barrier = Arc::new(tokio::sync::Barrier::new(3));
    let invalid_task = {
        let owner = Arc::clone(&owner);
        let barrier = Arc::clone(&barrier);
        tokio::spawn(async move {
            barrier.wait().await;
            owner.submit_v2(invalid).await
        })
    };
    let valid_task = {
        let owner = Arc::clone(&owner);
        let barrier = Arc::clone(&barrier);
        tokio::spawn(async move {
            barrier.wait().await;
            owner.submit_v2(valid).await
        })
    };
    barrier.wait().await;
    let invalid_result = invalid_task.await.unwrap().unwrap();
    let valid_result = valid_task.await.unwrap().unwrap();
    assert_eq!(
        invalid_result.resolution(),
        ProductEdgeResolution::RejectedNoWrite
    );
    assert_eq!(valid_result.resolution(), ProductEdgeResolution::Accepted);
    assert_eq!(
        rejected_authority_counts(&pool, &invalid_identity).await,
        [1, 0, 0, 0]
    );
    let family = valid_result
        .trial_family()
        .unwrap()
        .root()
        .trial_family_identity()
        .to_string();
    cleanup_research(&_mutation, &valid_identity, &family).await;
    sqlx::query("DELETE FROM rd_research_request_receipts_v1 WHERE request_identity = $1")
        .bind(invalid_identity)
        .execute(&pool)
        .await
        .unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "requires admitted OA/PE/R&D test database URLs"]
async fn exhaustive_lineage_waits_for_row_mutation_and_recovers_after_restore() {
    let test_database = test_database().await;
    let _mutation = test_database.mutation();
    let database_url = test_database.database_url().to_string();
    let owner = Arc::new(
        PostgresResearchGoalOwnerV1::connect(&database_url, &database_url)
            .await
            .unwrap(),
    );
    let pool = PgPoolOptions::new()
        .max_connections(4)
        .connect(&database_url)
        .await
        .unwrap();
    let suffix = unique_suffix();
    let edge = TestProductEdge::bootstrap(&database_url, &suffix).await;
    let a_request = format!("research-request-v2-row-lock-a-{suffix}");
    let c_request = format!("research-request-v2-row-lock-c-{suffix}");
    let accepted_a = owner
        .submit_v2(edge.admit_v2(request(&a_request)).await)
        .await
        .unwrap();
    let admitted_c = edge.admit_v2(request(&c_request)).await;
    let a_family = accepted_a
        .trial_family()
        .unwrap()
        .root()
        .trial_family_identity()
        .to_string();
    let original_digest: String = sqlx::query_scalar(
        "SELECT semantic_digest FROM rd_research_request_receipts_v1 WHERE request_identity = $1",
    )
    .bind(&a_request)
    .fetch_one(&pool)
    .await
    .unwrap();
    let mut mutation = pool.begin().await.unwrap();
    sqlx::query("UPDATE rd_research_request_receipts_v1 SET semantic_digest = semantic_digest || '-committed-corruption' WHERE request_identity = $1")
        .bind(&a_request)
        .execute(&mut *mutation)
        .await
        .unwrap();
    let mut submit = {
        let owner = Arc::clone(&owner);
        let admitted_c = admitted_c.clone();
        tokio::spawn(async move { owner.submit_v2(admitted_c).await })
    };
    assert!(
        tokio::time::timeout(Duration::from_millis(150), &mut submit)
            .await
            .is_err()
    );
    assert_eq!(
        rejected_authority_counts(&pool, &c_request).await,
        [0, 0, 0, 0]
    );
    mutation.commit().await.unwrap();
    assert_eq!(
        tokio::time::timeout(Duration::from_secs(5), submit)
            .await
            .unwrap()
            .unwrap()
            .unwrap()
            .resolution(),
        ProductEdgeResolution::SubmittedOrUnknown
    );
    assert_eq!(
        rejected_authority_counts(&pool, &c_request).await,
        [0, 0, 0, 0]
    );
    sqlx::query("UPDATE rd_research_request_receipts_v1 SET semantic_digest = $2 WHERE request_identity = $1")
        .bind(&a_request)
        .bind(original_digest)
        .execute(&pool)
        .await
        .unwrap();
    let accepted_c = owner.submit_v2(admitted_c).await.unwrap();
    assert_eq!(accepted_c.resolution(), ProductEdgeResolution::Accepted);
    let c_family = accepted_c
        .trial_family()
        .unwrap()
        .root()
        .trial_family_identity()
        .to_string();
    cleanup_research(&_mutation, &c_request, &c_family).await;
    cleanup_research(&_mutation, &a_request, &a_family).await;
}

#[tokio::test]
#[ignore = "requires admitted OA/PE/R&D test database URLs"]
async fn stored_request_meaning_corruption_is_unavailable_until_exact_restoration() {
    let test_database = test_database().await;
    let _mutation = test_database.mutation();
    let database_url = test_database.database_url().to_string();
    let owner = PostgresResearchGoalOwnerV1::connect(&database_url, &database_url)
        .await
        .unwrap();
    let pool = PgPoolOptions::new()
        .max_connections(2)
        .connect(&database_url)
        .await
        .unwrap();
    let suffix = unique_suffix();
    let edge = TestProductEdge::bootstrap(&database_url, &suffix).await;
    let request_identity = format!("research-request-v2-meaning-{suffix}");
    let admitted_request = edge.admit_v2(request(&request_identity)).await;
    let accepted = owner.submit_v2(admitted_request.clone()).await.unwrap();
    let intent_identity = accepted
        .owner_receipt()
        .unwrap()
        .resulting_research_intent_identity
        .as_deref()
        .unwrap()
        .to_string();
    let family_identity = accepted
        .trial_family()
        .unwrap()
        .root()
        .trial_family_identity()
        .to_string();
    let basis_identity = accepted
        .independence_basis()
        .unwrap()
        .basis_identity()
        .to_string();
    let projection_identity = accepted
        .protected_feedback()
        .unwrap()
        .projection_identity()
        .to_string();
    let original: serde_json::Value = sqlx::query_scalar(
        "SELECT request_json FROM rd_research_request_receipts_v1 WHERE request_identity = $1",
    )
    .bind(&request_identity)
    .fetch_one(&pool)
    .await
    .unwrap();
    let before = owner_counts(&pool, &request_identity, &intent_identity, &family_identity).await;

    sqlx::query("UPDATE rd_research_request_receipts_v1 SET request_json = jsonb_set(request_json, '{request,goal,hypothesis}', to_jsonb($2::text)) WHERE request_identity = $1")
        .bind(&request_identity)
        .bind("mutated immutable goal meaning")
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        owner
            .resolve_v2(&request_identity, &admitted_request.admission)
            .await
            .unwrap()
            .resolution(),
        ProductEdgeResolution::SubmittedOrUnknown
    );
    assert_eq!(
        owner_counts(&pool, &request_identity, &intent_identity, &family_identity,).await,
        before
    );

    sqlx::query(
        "UPDATE rd_research_request_receipts_v1 SET request_json = $2 WHERE request_identity = $1",
    )
    .bind(&request_identity)
    .bind(original)
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(
        owner
            .resolve_v2(&request_identity, &admitted_request.admission)
            .await
            .unwrap(),
        accepted
    );

    let original_principal: String = sqlx::query_scalar(
        "SELECT principal FROM rd_independence_bases_v1 WHERE basis_identity = $1",
    )
    .bind(&basis_identity)
    .fetch_one(&pool)
    .await
    .unwrap();
    sqlx::query("UPDATE rd_independence_bases_v1 SET principal = principal || '-corrupt' WHERE basis_identity = $1")
        .bind(&basis_identity).execute(&pool).await.unwrap();
    assert_eq!(
        owner
            .resolve_v2(&request_identity, &admitted_request.admission)
            .await
            .unwrap()
            .resolution(),
        ProductEdgeResolution::SubmittedOrUnknown
    );
    let artifact_owner = PostgresArtifactBuildOwnerV1::connect(
        &database_url,
        "/tmp/unused-rd-sandbox.sock",
        u64::MAX,
    )
    .await
    .unwrap();
    let artifact_suffix = unique_suffix();
    let artifact_request = edge
        .admit_artifact(artifact_request(
            &artifact_suffix,
            &intent_identity,
            "authority-corrupt",
        ))
        .await;
    assert_eq!(
        artifact_owner
            .prepare(artifact_request.clone())
            .await
            .unwrap()
            .resolution(),
        ArtifactBuildResolution::SubmittedOrUnknown
    );
    assert_eq!(
        count(
            &pool,
            "SELECT COUNT(*) FROM rd_artifact_build_attempts_v1 WHERE build_request_identity = $1",
            &artifact_request.build_request_identity
        )
        .await,
        0
    );
    sqlx::query("UPDATE rd_independence_bases_v1 SET principal = $2 WHERE basis_identity = $1")
        .bind(&basis_identity)
        .bind(original_principal)
        .execute(&pool)
        .await
        .unwrap();

    let original_qualification_outbox_digest: String = sqlx::query_scalar(
        "SELECT payload_digest FROM qualification_owner_outbox_v1 WHERE aggregate_identity = $1",
    )
    .bind(&projection_identity)
    .fetch_one(&pool)
    .await
    .unwrap();
    sqlx::query("UPDATE qualification_owner_outbox_v1 SET payload_digest = 'sha256:corrupt' WHERE aggregate_identity = $1")
        .bind(&projection_identity).execute(&pool).await.unwrap();
    assert_eq!(
        owner
            .resolve_v2(&request_identity, &admitted_request.admission)
            .await
            .unwrap()
            .resolution(),
        ProductEdgeResolution::SubmittedOrUnknown
    );
    assert_eq!(
        artifact_owner
            .prepare(artifact_request.clone())
            .await
            .unwrap()
            .resolution(),
        ArtifactBuildResolution::SubmittedOrUnknown
    );
    assert_eq!(
        count(
            &pool,
            "SELECT COUNT(*) FROM rd_artifact_build_attempts_v1 WHERE build_request_identity = $1",
            &artifact_request.build_request_identity
        )
        .await,
        0
    );
    sqlx::query("UPDATE qualification_owner_outbox_v1 SET payload_digest = $2 WHERE aggregate_identity = $1")
        .bind(&projection_identity).bind(original_qualification_outbox_digest).execute(&pool).await.unwrap();
    assert_eq!(
        owner
            .resolve_v2(&request_identity, &admitted_request.admission)
            .await
            .unwrap(),
        accepted
    );
    cleanup_research(&_mutation, &request_identity, &family_identity).await;
}

#[tokio::test]
#[ignore = "requires admitted OA/PE/R&D test database URLs"]
async fn missing_research_custody_prepares_no_attempt() {
    let test_database = test_database().await;
    let _mutation = test_database.mutation();
    let database_url = test_database.database_url().to_string();
    let artifact_owner = PostgresArtifactBuildOwnerV1::connect(
        &database_url,
        "/tmp/unused-rd-sandbox.sock",
        u64::MAX,
    )
    .await
    .unwrap();
    let pool = PgPoolOptions::new()
        .max_connections(2)
        .connect(&database_url)
        .await
        .unwrap();
    let suffix = unique_suffix();
    let edge = TestProductEdge::bootstrap(&database_url, &suffix).await;
    let request = edge
        .admit_artifact(ArtifactBuildRequestV1 {
            build_request_identity: format!("artifact-build-request-missing-{suffix}"),
            attempt_identity: format!("artifact-attempt-missing-{suffix}"),
            intent_identity: format!("research-intent-missing-{suffix}"),
            channel: ProductEdgeChannel::WindmillProductEdge,
            admission: admission_locator(&format!("artifact-build-request-missing-{suffix}")),
        })
        .await;
    let result = artifact_owner.prepare(request.clone()).await.unwrap();
    assert_eq!(
        result.resolution(),
        ArtifactBuildResolution::SubmittedOrUnknown
    );
    assert_eq!(
        count(
            &pool,
            "SELECT COUNT(*) FROM rd_artifact_build_attempts_v1 WHERE build_request_identity = $1",
            &request.build_request_identity,
        )
        .await,
        0
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "requires admitted OA/PE/R&D test database URLs"]
async fn research_and_attempt_resolve_share_one_deadlock_free_lock_order() {
    let test_database = test_database().await;
    let _mutation = test_database.mutation();
    let database_url = test_database.database_url().to_string();
    let research_owner = Arc::new(
        PostgresResearchGoalOwnerV1::connect(&database_url, &database_url)
            .await
            .unwrap(),
    );
    let artifact_owner = Arc::new(
        PostgresArtifactBuildOwnerV1::connect(
            &database_url,
            "/tmp/unused-rd-sandbox.sock",
            u64::MAX,
        )
        .await
        .unwrap(),
    );
    let pool = PgPoolOptions::new()
        .max_connections(2)
        .connect(&database_url)
        .await
        .unwrap();
    let suffix = unique_suffix();
    let edge = TestProductEdge::bootstrap(&database_url, &suffix).await;
    let request_identity = format!("research-request-v2-lock-order-{suffix}");
    let admitted_research = edge.admit_v2(request(&request_identity)).await;
    let accepted = research_owner
        .submit_v2(admitted_research.clone())
        .await
        .unwrap();
    let intent_identity = accepted
        .owner_receipt()
        .unwrap()
        .resulting_research_intent_identity
        .as_deref()
        .unwrap()
        .to_string();
    let family_identity = accepted
        .trial_family()
        .unwrap()
        .root()
        .trial_family_identity()
        .to_string();
    let build_request = edge
        .admit_artifact(ArtifactBuildRequestV1 {
            build_request_identity: format!("artifact-build-request-lock-order-{suffix}"),
            attempt_identity: format!("artifact-attempt-lock-order-{suffix}"),
            intent_identity: intent_identity.clone(),
            channel: ProductEdgeChannel::WindmillProductEdge,
            admission: admission_locator(&format!("artifact-build-request-lock-order-{suffix}")),
        })
        .await;
    assert_eq!(
        artifact_owner
            .prepare(build_request.clone())
            .await
            .unwrap()
            .resolution(),
        ArtifactBuildResolution::Prepared
    );

    let run = async {
        let mut tasks = Vec::new();

        for _ in 0..12 {
            let owner = Arc::clone(&research_owner);
            let request_identity = request_identity.clone();
            let admission = admitted_research.admission.clone();

            tasks.push(tokio::spawn(async move {
                owner
                    .resolve_v2(&request_identity, &admission)
                    .await
                    .map(|_| ())
                    .map_err(|e| e.to_string())
            }));
            let owner = Arc::clone(&artifact_owner);
            let build_request = build_request.clone();

            tasks.push(tokio::spawn(async move {
                owner
                    .resolve(
                        &build_request.build_request_identity,
                        &build_request.attempt_identity,
                        &build_request.admission,
                    )
                    .await
                    .map(|_| ())
                    .map_err(|e| e.to_string())
            }));
        }

        for task in tasks {
            task.await.unwrap().unwrap();
        }
    };
    tokio::time::timeout(Duration::from_secs(10), run)
        .await
        .expect("resolve directions deadlocked");

    sqlx::query("DELETE FROM rd_artifact_build_attempts_v1 WHERE build_request_identity = $1")
        .bind(&build_request.build_request_identity)
        .execute(&pool)
        .await
        .unwrap();
    cleanup_research(&_mutation, &request_identity, &family_identity).await;
}

#[tokio::test]
#[ignore = "requires admitted OA/PE/R&D test database URLs"]
async fn no_artifact_receipt_mutation_fails_closed_and_exact_restore_replays() {
    let test_database = test_database().await;
    let _mutation = test_database.mutation();
    let database_url = test_database.database_url().to_string();
    let research_owner = PostgresResearchGoalOwnerV1::connect(&database_url, &database_url)
        .await
        .unwrap();
    let artifact_owner = PostgresArtifactBuildOwnerV1::connect(
        &database_url,
        "/tmp/unused-rd-sandbox.sock",
        u64::MAX,
    )
    .await
    .unwrap();
    let pool = PgPoolOptions::new()
        .max_connections(2)
        .connect(&database_url)
        .await
        .unwrap();
    let suffix = unique_suffix();
    let edge = TestProductEdge::bootstrap(&database_url, &suffix).await;
    let request_identity = format!("research-request-v2-no-artifact-{suffix}");
    let accepted = research_owner
        .submit_v2(edge.admit_v2(request(&request_identity)).await)
        .await
        .unwrap();
    let intent_identity = accepted
        .owner_receipt()
        .unwrap()
        .resulting_research_intent_identity
        .as_deref()
        .unwrap()
        .to_string();
    let family_identity = accepted
        .trial_family()
        .unwrap()
        .root()
        .trial_family_identity()
        .to_string();
    let build_request = edge
        .admit_artifact(artifact_request(&suffix, &intent_identity, "no-artifact"))
        .await;
    let terminal = artifact_owner
        .fail_no_artifact(build_request.clone(), "PROVIDER_ERROR", None)
        .await
        .unwrap();
    assert_eq!(
        terminal.owner_receipt().unwrap().disposition,
        ArtifactBuildDisposition::FailedNoArtifact
    );
    assert_eq!(
        artifact_owner
            .fail_no_artifact(build_request.clone(), "PROVIDER_ERROR", None)
            .await
            .unwrap(),
        terminal
    );
    let original: serde_json::Value = sqlx::query_scalar(
        "SELECT attempt_json FROM rd_artifact_build_attempts_v1 WHERE build_request_identity = $1",
    )
    .bind(&build_request.build_request_identity)
    .fetch_one(&pool)
    .await
    .unwrap();
    let before = artifact_counts(&pool, &build_request).await;

    sqlx::query("UPDATE rd_artifact_build_attempts_v1 SET attempt_json = jsonb_set(attempt_json, '{receipt,disposition}', to_jsonb('OUTCOME_UNKNOWN'::text)) WHERE build_request_identity = $1")
        .bind(&build_request.build_request_identity)
        .execute(&pool)
        .await
        .unwrap();
    assert!(
        artifact_owner
            .resolve(
                &build_request.build_request_identity,
                &build_request.attempt_identity,
                &build_request.admission,
            )
            .await
            .is_err()
    );
    assert_eq!(artifact_counts(&pool, &build_request).await, before);

    sqlx::query("UPDATE rd_artifact_build_attempts_v1 SET attempt_json = $2 WHERE build_request_identity = $1")
        .bind(&build_request.build_request_identity)
        .bind(&original)
        .execute(&pool)
        .await
        .unwrap();
    let original_time = terminal.owner_receipt().unwrap().committed_at_epoch_ms;
    sqlx::query("UPDATE rd_artifact_build_attempts_v1 SET attempt_json = jsonb_set(attempt_json, '{receipt,committed_at_epoch_ms}', to_jsonb($2::bigint)) WHERE build_request_identity = $1")
        .bind(&build_request.build_request_identity)
        .bind(i64::try_from(original_time.saturating_add(1)).unwrap())
        .execute(&pool)
        .await
        .unwrap();
    assert!(
        artifact_owner
            .fail_no_artifact(build_request.clone(), "PROVIDER_ERROR", None)
            .await
            .is_err()
    );
    assert!(
        artifact_owner
            .submit_candidate(
                build_request.clone(),
                dummy_candidate(&intent_identity),
                None
            )
            .await
            .is_err()
    );
    assert_eq!(artifact_counts(&pool, &build_request).await, before);

    sqlx::query("UPDATE rd_artifact_build_attempts_v1 SET attempt_json = $2 WHERE build_request_identity = $1")
        .bind(&build_request.build_request_identity)
        .bind(original)
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        artifact_owner
            .resolve(
                &build_request.build_request_identity,
                &build_request.attempt_identity,
                &build_request.admission,
            )
            .await
            .unwrap(),
        terminal
    );

    sqlx::query("DELETE FROM rd_artifact_build_attempts_v1 WHERE build_request_identity = $1")
        .bind(&build_request.build_request_identity)
        .execute(&pool)
        .await
        .unwrap();
    cleanup_research(&_mutation, &request_identity, &family_identity).await;
}

#[tokio::test]
#[ignore = "requires admitted OA/PE/R&D test database URLs"]
async fn expired_attempt_receipt_is_independently_outcome_unknown() {
    let test_database = test_database().await;
    let _mutation = test_database.mutation();
    let database_url = test_database.database_url().to_string();
    let research_owner = PostgresResearchGoalOwnerV1::connect(&database_url, &database_url)
        .await
        .unwrap();
    let artifact_owner =
        PostgresArtifactBuildOwnerV1::connect(&database_url, "/tmp/unused-rd-sandbox.sock", 0)
            .await
            .unwrap();
    let pool = PgPoolOptions::new()
        .max_connections(2)
        .connect(&database_url)
        .await
        .unwrap();
    let suffix = unique_suffix();
    let edge = TestProductEdge::bootstrap(&database_url, &suffix).await;
    let request_identity = format!("research-request-v2-expiry-{suffix}");
    let accepted = research_owner
        .submit_v2(edge.admit_v2(request(&request_identity)).await)
        .await
        .unwrap();
    let intent_identity = accepted
        .owner_receipt()
        .unwrap()
        .resulting_research_intent_identity
        .as_deref()
        .unwrap()
        .to_string();
    let family_identity = accepted
        .trial_family()
        .unwrap()
        .root()
        .trial_family_identity()
        .to_string();
    let build_request = edge
        .admit_artifact(artifact_request(&suffix, &intent_identity, "expiry"))
        .await;
    artifact_owner.prepare(build_request.clone()).await.unwrap();
    tokio::time::sleep(Duration::from_millis(2)).await;
    let expired = artifact_owner
        .resolve(
            &build_request.build_request_identity,
            &build_request.attempt_identity,
            &build_request.admission,
        )
        .await
        .unwrap();
    let receipt = expired.owner_receipt().unwrap();
    assert_eq!(
        receipt.disposition,
        ArtifactBuildDisposition::OutcomeUnknown
    );
    assert_eq!(
        receipt.failure_code.as_deref(),
        Some("ATTEMPT_CUSTODY_EXPIRED")
    );

    sqlx::query("DELETE FROM rd_artifact_build_attempts_v1 WHERE build_request_identity = $1")
        .bind(&build_request.build_request_identity)
        .execute(&pool)
        .await
        .unwrap();
    cleanup_research(&_mutation, &request_identity, &family_identity).await;
}

async fn test_database() -> DedicatedPostgresTestDatabase {
    DedicatedPostgresTestDatabase::admit_cross_owner(&[
        "OPERATOR_AUTHORIZATION_TEST_DATABASE_URL",
        "PRODUCT_EDGE_TEST_DATABASE_URL",
        "RD_OWNER_TEST_DATABASE_URL",
    ])
    .await
    .unwrap()
}

fn unique_suffix() -> String {
    format!(
        "{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    )
}

async fn owner_counts(pool: &PgPool, request: &str, intent: &str, family: &str) -> [i64; 5] {
    [
        count(
            pool,
            "SELECT COUNT(*) FROM rd_research_request_receipts_v1 WHERE request_identity = $1",
            request,
        )
        .await,
        count(
            pool,
            "SELECT COUNT(*) FROM rd_trial_families_v1 WHERE intent_identity = $1",
            intent,
        )
        .await,
        count(
            pool,
            "SELECT COUNT(*) FROM rd_trial_family_members_v1 WHERE trial_family_identity = $1",
            family,
        )
        .await,
        count(
            pool,
            "SELECT COUNT(*) FROM rd_trial_family_heads_v1 WHERE trial_family_identity = $1",
            family,
        )
        .await,
        count(
            pool,
            "SELECT COUNT(*) FROM rd_owner_outbox_v1 WHERE aggregate_identity = $1",
            family,
        )
        .await,
    ]
}

async fn count(pool: &PgPool, statement: &'static str, identity: &str) -> i64 {
    sqlx::query_scalar(statement)
        .bind(identity)
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn artifact_counts(pool: &PgPool, request: &ArtifactBuildRequestV1) -> [i64; 2] {
    [
        count(
            pool,
            "SELECT COUNT(*) FROM rd_artifact_build_attempts_v1 WHERE build_request_identity = $1",
            &request.build_request_identity,
        )
        .await,
        count(
            pool,
            "SELECT COUNT(*) FROM rd_strategy_artifacts_v1 WHERE attempt_identity = $1",
            &request.attempt_identity,
        )
        .await,
    ]
}

fn artifact_request(suffix: &str, intent_identity: &str, label: &str) -> ArtifactBuildRequestV1 {
    ArtifactBuildRequestV1 {
        build_request_identity: format!("artifact-build-request-{label}-{suffix}"),
        attempt_identity: format!("artifact-attempt-{label}-{suffix}"),
        intent_identity: intent_identity.to_string(),
        channel: ProductEdgeChannel::WindmillProductEdge,
        admission: admission_locator(&format!("artifact-build-request-{label}-{suffix}")),
    }
}

fn dummy_candidate(intent_identity: &str) -> ArtifactBuildCandidateV1 {
    ArtifactBuildCandidateV1 {
        schema_version: 1,
        candidate_identity: "unused-terminal-replay-candidate".to_string(),
        intent_identity: intent_identity.to_string(),
        intent_semantic_digest: "unused-terminal-replay-digest".to_string(),
        logic: GeneratedStrategyLogicV1 {
            signal: GeneratedSignalV1::Momentum,
            direction: GeneratedDirectionV1::LongOnly,
            lookback_bars: 24,
            entry_threshold_bps: 50,
            exit_threshold_bps: 10,
        },
        structured_logic_summary: "unused after terminal custody replay".to_string(),
        agent_change_explanation: "unused after terminal custody replay".to_string(),
    }
}

async fn cleanup_research(
    mutation: &DedicatedPostgresTestMutation<'_>,
    request: &str,
    family: &str,
) {
    let pool = mutation.pool();
    sqlx::query("DELETE FROM rd_owner_outbox_v1 WHERE aggregate_identity = $1")
        .bind(family)
        .execute(pool)
        .await
        .unwrap();
    sqlx::query("DELETE FROM rd_trial_family_heads_v1 WHERE trial_family_identity = $1")
        .bind(family)
        .execute(pool)
        .await
        .unwrap();
    sqlx::query("DELETE FROM rd_trial_family_members_v1 WHERE trial_family_identity = $1")
        .bind(family)
        .execute(pool)
        .await
        .unwrap();
    sqlx::query("DELETE FROM rd_trial_families_v1 WHERE trial_family_identity = $1")
        .bind(family)
        .execute(pool)
        .await
        .unwrap();
    sqlx::query("DELETE FROM rd_research_request_receipts_v1 WHERE request_identity = $1")
        .bind(request)
        .execute(pool)
        .await
        .unwrap();
    cleanup_prerequisites(mutation, request).await;
}

async fn cleanup_prerequisites(mutation: &DedicatedPostgresTestMutation<'_>, request: &str) {
    let pool = mutation.pool();
    let basis_identity = sqlx::query_scalar::<_, String>(
        "SELECT basis_identity FROM rd_independence_bases_v1 WHERE request_identity = $1",
    )
    .bind(request)
    .fetch_optional(pool)
    .await
    .unwrap();
    let projection_identity = if let Some(basis_identity) = basis_identity.as_deref() {
        sqlx::query_scalar::<_, String>("SELECT projection_identity FROM qualification_protected_feedback_projections_v1 WHERE basis_identity = $1")
            .bind(basis_identity).fetch_optional(pool).await.unwrap()
    } else {
        None
    };

    if let Some(projection_identity) = projection_identity {
        sqlx::query(
            "DELETE FROM qualification_protected_feedback_heads_v1 WHERE frontier_identity = $1",
        )
        .bind(&projection_identity)
        .execute(pool)
        .await
        .unwrap();
        sqlx::query("DELETE FROM qualification_owner_outbox_v1 WHERE aggregate_identity = $1")
            .bind(&projection_identity)
            .execute(pool)
            .await
            .unwrap();
        sqlx::query("DELETE FROM qualification_protected_feedback_projections_v1 WHERE projection_identity = $1").bind(&projection_identity).execute(pool).await.unwrap();
    }

    if let Some(basis_identity) = basis_identity {
        sqlx::query("DELETE FROM rd_independence_basis_heads_v1 WHERE basis_identity = $1")
            .bind(&basis_identity)
            .execute(pool)
            .await
            .unwrap();
        sqlx::query("DELETE FROM rd_owner_outbox_v1 WHERE aggregate_identity = $1")
            .bind(&basis_identity)
            .execute(pool)
            .await
            .unwrap();
        sqlx::query("DELETE FROM rd_independence_bases_v1 WHERE basis_identity = $1")
            .bind(&basis_identity)
            .execute(pool)
            .await
            .unwrap();
    }
}

struct TestProductEdge {
    owner: ProductEdgePostgresOwnerV1,
    database_url: String,
    deployment_identity: String,
    binding_identity: String,
    binding_generation: u64,
    effective_principal: String,
    authorization: OperatorAuthorizationLocatorV1,
    authorization_frontier_identity: String,
    manifests: Vec<AgentOperationManifestProposalV1>,
    valid_from_epoch_ms: u64,
    valid_through_epoch_ms: u64,
    request_proof_digest: String,
}

impl TestProductEdge {
    async fn bootstrap(database_url: &str, suffix: &str) -> Self {
        Self::bootstrap_with_validity(database_url, suffix, 3_600_000).await
    }

    async fn bootstrap_with_validity(database_url: &str, suffix: &str, validity_ms: u64) -> Self {
        let now = current_epoch_ms();
        let valid_from_epoch_ms = now.saturating_sub(1_000);
        let valid_through_epoch_ms = now.saturating_add(validity_ms);
        let request_proof_digest = "sha256:test-proof".to_string();
        let mut manifests = vec![
            test_manifest(
                RESEARCH_GOAL_OPERATION_V2,
                RESEARCH_GOAL_SCHEMA_V2,
                vec!["R_AND_D_RESEARCH_MUTATION_V1".to_string()],
                now,
                valid_through_epoch_ms,
            ),
            test_manifest(
                ARTIFACT_BUILD_OPERATION_V1,
                ARTIFACT_BUILD_SCHEMA_V1,
                vec![
                    "R_AND_D_ARTIFACT_BUILD_MUTATION_V1".to_string(),
                    "R_AND_D_PROVIDER_INVOCATION_V1".to_string(),
                ],
                now,
                valid_through_epoch_ms,
            ),
        ];
        manifests.sort_by_key(|manifest| manifest.manifest_identity().unwrap());
        let issuer = OperatorAuthorizationIssuerPostgresV1::connect(database_url)
            .await
            .unwrap();
        let authorization = issuer
            .issue_genesis(OperatorAuthorizationIssuanceProposalV1 {
                authorization_identity: format!("operator-authorization-trial-family-{suffix}"),
                issuer_identity: "operator-authorization-issuer-test-v1".to_string(),
                issuer_key_version: "test-key-v1".to_string(),
                scope: OperatorAuthorizationScopeV1 {
                    principal: format!("admin-{suffix}"),
                    audience: format!("R_AND_D:{suffix}"),
                    permissions: vec![
                        "research:artifact-build".to_string(),
                        "research:submit".to_string(),
                        "research:view".to_string(),
                    ],
                },
                request_proof_digest: request_proof_digest.clone(),
                operation_manifests: manifests
                    .iter()
                    .map(|manifest| OperationManifestBindingV1 {
                        manifest_identity: manifest.manifest_identity().unwrap(),
                        manifest_digest: manifest.manifest_digest().unwrap(),
                    })
                    .collect(),
                not_before_epoch_ms: valid_from_epoch_ms,
                valid_through_epoch_ms,
                expected_revocation_head: "EMPTY".to_string(),
            })
            .await
            .unwrap();
        let authorization_locator = authorization.locator();
        let authorization_frontier_identity =
            authorization.frontier().frontier_identity().to_string();
        let deployment_identity = format!("product-edge-trial-family-{suffix}");
        let binding_identity = format!("product-edge-binding-trial-family-{suffix}");
        let effective_principal = format!("admin-{suffix}");
        let owner = ProductEdgePostgresOwnerV1::connect(
            database_url,
            &deployment_identity,
            ProductEdgeAuthorizationTrustV1 {
                issuer_identity: "operator-authorization-issuer-test-v1".to_string(),
                issuer_key_version: "test-key-v1".to_string(),
                audience: format!("R_AND_D:{suffix}"),
            },
        )
        .await
        .unwrap();
        owner
            .bootstrap_genesis(ProductEdgeBootstrapProposalV1 {
                deployment_identity: deployment_identity.clone(),
                binding_identity: binding_identity.clone(),
                expected_history_head: "EMPTY".to_string(),
                generation: 1,
                effective_principal: effective_principal.clone(),
                scope_policy_version: "scope-v1".to_string(),
                capability_policy_version: "capability-v1".to_string(),
                audit_policy_version: "audit-v1".to_string(),
                valid_from_epoch_ms,
                valid_through_epoch_ms,
                authorization: authorization_locator.clone(),
                manifests: manifests.clone(),
            })
            .await
            .unwrap();
        Self {
            owner,
            database_url: database_url.to_string(),
            deployment_identity,
            binding_identity,
            binding_generation: 1,
            effective_principal,
            authorization: authorization_locator,
            authorization_frontier_identity,
            manifests,
            valid_from_epoch_ms,
            valid_through_epoch_ms,
            request_proof_digest,
        }
    }

    async fn activate_policy_equivalent_successor(&mut self, suffix: &str) {
        let generation = self.binding_generation + 1;
        let binding_identity = format!("product-edge-binding-{generation}-{suffix}");
        self.owner
            .activate_successor(ProductEdgeSuccessorProposalV1 {
                deployment_identity: self.deployment_identity.clone(),
                binding_identity: binding_identity.clone(),
                predecessor_binding_identity: self.binding_identity.clone(),
                expected_history_head: self.binding_identity.clone(),
                generation,
                effective_principal: self.effective_principal.clone(),
                scope_policy_version: "scope-v1".to_string(),
                capability_policy_version: "capability-v1".to_string(),
                audit_policy_version: "audit-v1".to_string(),
                valid_from_epoch_ms: self.valid_from_epoch_ms,
                valid_through_epoch_ms: self.valid_through_epoch_ms,
                authorization: self.authorization.clone(),
                manifests: self.manifests.clone(),
            })
            .await
            .unwrap();
        self.binding_identity = binding_identity;
        self.binding_generation = generation;
    }

    async fn revoke_authorization(&self) {
        OperatorAuthorizationIssuerPostgresV1::connect(&self.database_url)
            .await
            .unwrap()
            .revoke(OperatorAuthorizationRevocationProposalV1 {
                authorization: self.authorization.clone(),
                expected_frontier_identity: self.authorization_frontier_identity.clone(),
                reason_code: "TEST_BASIS_RECOVERY".to_string(),
            })
            .await
            .unwrap();
    }

    async fn admit_v2(
        &self,
        mut request: ProductEdgeResearchGoalRequestV2,
    ) -> ProductEdgeResearchGoalRequestV2 {
        let typed_payload = serde_json::json!({
            "request_identity": request.request_identity,
            "channel": request.channel,
            "goal": request.goal,
            "trial_family_proposal": request.trial_family_proposal,
        });
        request.admission = self
            .admit(
                &request.request_identity,
                typed_payload,
                RESEARCH_GOAL_OPERATION_V2,
                RESEARCH_GOAL_SCHEMA_V2,
                vec!["R_AND_D_RESEARCH_MUTATION_V1".to_string()],
            )
            .await;
        request
    }

    async fn admit_artifact(&self, mut request: ArtifactBuildRequestV1) -> ArtifactBuildRequestV1 {
        let typed_payload = serde_json::json!({
            "build_request_identity": request.build_request_identity,
            "attempt_identity": request.attempt_identity,
            "intent_identity": request.intent_identity,
            "channel": request.channel,
        });
        request.admission = self
            .admit(
                &request.build_request_identity,
                typed_payload,
                ARTIFACT_BUILD_OPERATION_V1,
                ARTIFACT_BUILD_SCHEMA_V1,
                vec![
                    "R_AND_D_ARTIFACT_BUILD_MUTATION_V1".to_string(),
                    "R_AND_D_PROVIDER_INVOCATION_V1".to_string(),
                ],
            )
            .await;
        request
    }

    async fn admit(
        &self,
        request_identity: &str,
        typed_payload: serde_json::Value,
        operation: &str,
        operation_schema: &str,
        requested_effects: Vec<String>,
    ) -> ProductEdgeAdmissionLocatorV1 {
        self.owner
            .admit_request(ProductEdgeAdmissionRequestV1 {
                request_identity: request_identity.to_string(),
                typed_payload,
                operation: operation.to_string(),
                operation_schema: operation_schema.to_string(),
                target_owner: RESEARCH_OWNER_V1.to_string(),
                requested_effects,
                request_proof_digest: self.request_proof_digest.clone(),
                audit_correlation: format!("test:{request_identity}"),
            })
            .await
            .unwrap()
            .locator()
            .clone()
    }
}

fn test_manifest(
    operation: &str,
    operation_schema: &str,
    allowed_effects: Vec<String>,
    now: u64,
    valid_through_epoch_ms: u64,
) -> AgentOperationManifestProposalV1 {
    AgentOperationManifestProposalV1 {
        operation: operation.to_string(),
        operation_schema: operation_schema.to_string(),
        target_owner: RESEARCH_OWNER_V1.to_string(),
        allowed_effects,
        prohibited_effects: vec!["REAL_TRADING_V1".to_string()],
        capability_policy_digest: format!("sha256:{}", "a".repeat(64)),
        effective_from_epoch_ms: now.saturating_sub(1_000),
        valid_through_epoch_ms,
    }
}

fn current_epoch_ms() -> u64 {
    u64::try_from(
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis(),
    )
    .unwrap()
}

fn admission_locator(request_identity: &str) -> ProductEdgeAdmissionLocatorV1 {
    ProductEdgeAdmissionLocatorV1 {
        request_identity: request_identity.to_string(),
        admission_identity: format!("product-edge-admission-test-{request_identity}"),
        admission_digest: format!("sha256:{}", "e".repeat(64)),
    }
}

fn request(request_identity: &str) -> ProductEdgeResearchGoalRequestV2 {
    ProductEdgeResearchGoalRequestV2 {
        request_identity: request_identity.to_string(),
        channel: ProductEdgeChannel::WindmillProductEdge,
        admission: admission_locator(request_identity),
        goal: SourcedResearchGoalV2 {
            hypothesis: "A bounded point-in-time momentum effect persists after exact costs."
                .to_string(),
            mechanism: "Slow information diffusion creates bounded continuation.".to_string(),
            falsification_question: "Does the effect disappear after exact modeled costs?"
                .to_string(),
            expected_observation: "Net continuation remains positive.".to_string(),
            required_data: vec!["PIT adjusted bars".to_string()],
            cost_assumption: "Exact model identity below.".to_string(),
            capacity_assumption: "Capacity model identity below.".to_string(),
            sources: vec![ResearchSourceV1 {
                locator: "https://example.com/research".to_string(),
                content_digest: format!("sha256:{}", "a".repeat(64)),
                observed_at: "2026-08-21T00:00:00Z".to_string(),
                source_cut: "source-cut-v1".to_string(),
                license_basis: "public research".to_string(),
                interpretation: "Bounded source interpretation only.".to_string(),
            }],
        },
        trial_family_proposal: TrialFamilyProposalV1 {
            trial_budget: 8,
            stop_rule: "Stop on falsifier, exhausted budget, or unavailable PIT input.".to_string(),
            pit_rule_identity: "pit-rule-v1".to_string(),
            cost_model_identity: "cost-model-v1".to_string(),
            slippage_model_identity: "slippage-model-v1".to_string(),
            capacity_model_identity: "capacity-model-v1".to_string(),
            independence_rationale: "No known local predecessor before Owner resolution."
                .to_string(),
        },
    }
}

fn invalid_v2_requests(suffix: &str) -> Vec<(&'static str, ProductEdgeResearchGoalRequestV2)> {
    let mut cases = Vec::new();
    macro_rules! invalid {
        ($code:literal, $field:expr) => {{
            let mut request = request(&format!(
                "research-request-v2-invalid-{}-{suffix}",
                cases.len()
            ));
            $field(&mut request);
            cases.push(($code, request));
        }};
    }
    invalid!(
        "REQUEST_IDENTITY_INVALID",
        |request: &mut ProductEdgeResearchGoalRequestV2| {
            request.request_identity = format!("invalid/request-{suffix}");
        }
    );
    invalid!(
        "HYPOTHESIS_INVALID",
        |request: &mut ProductEdgeResearchGoalRequestV2| {
            request.goal.hypothesis.clear();
        }
    );
    invalid!(
        "MECHANISM_INVALID",
        |request: &mut ProductEdgeResearchGoalRequestV2| {
            request.goal.mechanism.clear();
        }
    );
    invalid!(
        "FALSIFICATION_QUESTION_INVALID",
        |request: &mut ProductEdgeResearchGoalRequestV2| {
            request.goal.falsification_question.clear();
        }
    );
    invalid!(
        "EXPECTED_OBSERVATION_INVALID",
        |request: &mut ProductEdgeResearchGoalRequestV2| {
            request.goal.expected_observation.clear();
        }
    );
    invalid!(
        "COST_ASSUMPTION_INVALID",
        |request: &mut ProductEdgeResearchGoalRequestV2| {
            request.goal.cost_assumption.clear();
        }
    );
    invalid!(
        "CAPACITY_ASSUMPTION_INVALID",
        |request: &mut ProductEdgeResearchGoalRequestV2| {
            request.goal.capacity_assumption.clear();
        }
    );
    invalid!(
        "REQUIRED_DATA_INVALID",
        |request: &mut ProductEdgeResearchGoalRequestV2| {
            request.goal.required_data.clear();
        }
    );
    invalid!(
        "SOURCE_SET_INVALID",
        |request: &mut ProductEdgeResearchGoalRequestV2| {
            request.goal.sources.clear();
        }
    );
    invalid!(
        "SOURCE_LOCATOR_INVALID",
        |request: &mut ProductEdgeResearchGoalRequestV2| {
            request.goal.sources[0].locator = "caller-path".to_string();
        }
    );
    invalid!(
        "SOURCE_DIGEST_INVALID",
        |request: &mut ProductEdgeResearchGoalRequestV2| {
            request.goal.sources[0].content_digest = "sha256:bad".to_string();
        }
    );
    invalid!(
        "SOURCE_OBSERVED_AT_INVALID",
        |request: &mut ProductEdgeResearchGoalRequestV2| {
            request.goal.sources[0].observed_at.clear();
        }
    );
    invalid!(
        "SOURCE_CUT_INVALID",
        |request: &mut ProductEdgeResearchGoalRequestV2| {
            request.goal.sources[0].source_cut.clear();
        }
    );
    invalid!(
        "SOURCE_LICENSE_INVALID",
        |request: &mut ProductEdgeResearchGoalRequestV2| {
            request.goal.sources[0].license_basis.clear();
        }
    );
    invalid!(
        "SOURCE_INTERPRETATION_INVALID",
        |request: &mut ProductEdgeResearchGoalRequestV2| {
            request.goal.sources[0].interpretation.clear();
        }
    );
    invalid!(
        "TRIAL_BUDGET_INVALID",
        |request: &mut ProductEdgeResearchGoalRequestV2| {
            request.trial_family_proposal.trial_budget = 0;
        }
    );
    invalid!(
        "STOP_RULE_INVALID",
        |request: &mut ProductEdgeResearchGoalRequestV2| {
            request.trial_family_proposal.stop_rule.clear();
        }
    );
    invalid!(
        "PIT_RULE_IDENTITY_INVALID",
        |request: &mut ProductEdgeResearchGoalRequestV2| {
            request.trial_family_proposal.pit_rule_identity.clear();
        }
    );
    invalid!(
        "COST_MODEL_IDENTITY_INVALID",
        |request: &mut ProductEdgeResearchGoalRequestV2| {
            request.trial_family_proposal.cost_model_identity.clear();
        }
    );
    invalid!(
        "SLIPPAGE_MODEL_IDENTITY_INVALID",
        |request: &mut ProductEdgeResearchGoalRequestV2| {
            request
                .trial_family_proposal
                .slippage_model_identity
                .clear();
        }
    );
    invalid!(
        "CAPACITY_MODEL_IDENTITY_INVALID",
        |request: &mut ProductEdgeResearchGoalRequestV2| {
            request
                .trial_family_proposal
                .capacity_model_identity
                .clear();
        }
    );
    invalid!(
        "INDEPENDENCE_RATIONALE_INVALID",
        |request: &mut ProductEdgeResearchGoalRequestV2| {
            request.trial_family_proposal.independence_rationale.clear();
        }
    );
    cases
}

async fn rejected_authority_counts(pool: &PgPool, request_identity: &str) -> [i64; 4] {
    [
        count(
            pool,
            "SELECT COUNT(*) FROM rd_research_request_receipts_v1 WHERE request_identity = $1",
            request_identity,
        )
        .await,
        count(
            pool,
            "SELECT COUNT(*) FROM rd_independence_bases_v1 WHERE request_identity = $1",
            request_identity,
        )
        .await,
        count(
            pool,
            "SELECT COUNT(*) FROM qualification_protected_feedback_projections_v1 q JOIN rd_independence_bases_v1 b ON b.basis_identity = q.basis_identity WHERE b.request_identity = $1",
            request_identity,
        )
        .await,
        count(
            pool,
            "SELECT COUNT(*) FROM rd_owner_outbox_v1 o JOIN rd_independence_bases_v1 b ON b.basis_identity = o.aggregate_identity WHERE b.request_identity = $1",
            request_identity,
        )
        .await,
    ]
}

async fn json_rows(pool: &PgPool, statement: &'static str) -> serde_json::Value {
    sqlx::query_scalar(statement).fetch_one(pool).await.unwrap()
}

async fn assert_lineage_unavailable_without_writes(
    owner: &PostgresResearchGoalOwnerV1,
    edge: &TestProductEdge,
    pool: &PgPool,
    request_identity: &str,
) {
    let before = rejected_authority_counts(pool, request_identity).await;
    assert_eq!(before, [0, 0, 0, 0]);
    assert_eq!(
        owner
            .submit_v2(edge.admit_v2(request(request_identity)).await)
            .await
            .unwrap()
            .resolution(),
        ProductEdgeResolution::SubmittedOrUnknown
    );
    assert_eq!(
        rejected_authority_counts(pool, request_identity).await,
        before
    );
}
