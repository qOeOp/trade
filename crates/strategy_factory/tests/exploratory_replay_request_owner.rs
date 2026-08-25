use std::time::{SystemTime, UNIX_EPOCH};

use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::UnixListener,
};
use vibe_operator_authorization::{
    OperationManifestBindingV1, OperatorAuthorizationIssuanceProposalV1,
    OperatorAuthorizationIssuerPostgresV1, OperatorAuthorizationLocatorV1,
    OperatorAuthorizationRevocationProposalV1, OperatorAuthorizationScopeV1,
};
use vibe_product_edge::{
    AgentOperationManifestProposalV1, ProductEdgeAdmissionRequestV1,
    ProductEdgeAuthorizationTrustV1, ProductEdgeBootstrapProposalV1,
    ProductEdgeInvocationClaimRequestV1, ProductEdgePostgresOwnerV1,
};
use vibe_strategy_factory::{
    artifact_build::{
        ARTIFACT_BUILD_OPERATION_V1, ARTIFACT_BUILD_SCHEMA_V1, ArtifactBuildCandidateV1,
        ArtifactBuildOwnerPort, ArtifactBuildRequestV1, ArtifactBuildResolution,
        GeneratedDirectionV1, GeneratedSignalV1, GeneratedStrategyLogicV1,
    },
    artifact_build_postgres::PostgresArtifactBuildOwnerV1,
    exploratory_replay::{
        ExploratoryReplayAvailabilityV1, ExploratoryReplayOwnerError,
        ExploratoryReplayRequestLocatorV1, ExploratoryReplayRequestProposalV1, IdentityDigestV1,
        VersionedIdentityV1,
    },
    product_edge::{
        ProductEdgeChannel, ProductEdgeResearchGoalRequestV2, RESEARCH_GOAL_OPERATION_V2,
        RESEARCH_GOAL_SCHEMA_V2, RESEARCH_OWNER_V1, ResearchGoalOwnerPortV2, ResearchSourceV1,
        SourcedResearchGoalV2, TrialFamilyProposalV1,
    },
    product_edge_postgres::PostgresResearchGoalOwnerV1,
};
use vibe_testkit::postgres::{CanonicalOwnerPostgresTestDatabaseV1, CanonicalOwnerTestRoleV1};

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct TestFamilyFrozenOutboxV1 {
    schema_version: u32,
    research_receipt_identity: String,
    intent_identity: String,
    trial_family_identity: String,
    root_receipt_identity: String,
    membership_receipt_identity: String,
    census_frontier_identity: String,
    census_frontier_digest: String,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct TestArtifactBoundOutboxV1 {
    schema_version: u32,
    artifact_identity: String,
    build_receipt_identity: String,
    trial_family_identity: String,
    binding_identity: String,
    binding_receipt_identity: String,
}

#[tokio::test]
#[ignore = "requires the canonical disposable five-role PostgreSQL route"]
async fn frozen_exploratory_replay_request_is_sealed_for_canonical_backtest_owner() {
    let database = CanonicalOwnerPostgresTestDatabaseV1::admit()
        .await
        .expect("canonical disposable topology");
    let mutation = database.mutation();
    let rd_url = database
        .database_url(CanonicalOwnerTestRoleV1::RdOwner)
        .to_string();
    let qualification_url = database
        .database_url(CanonicalOwnerTestRoleV1::QualificationWriter)
        .to_string();
    let backtest_url = database
        .database_url(CanonicalOwnerTestRoleV1::BacktestOwner)
        .to_string();
    let edge_url = database
        .database_url(CanonicalOwnerTestRoleV1::ProductEdgeOwner)
        .to_string();
    let issuer_url = database
        .database_url(CanonicalOwnerTestRoleV1::OperatorAuthorizationWriter)
        .to_string();
    let suffix = unique_suffix();
    let edge = TestProductEdge::bootstrap(&issuer_url, &edge_url, &suffix).await;
    let owner = PostgresResearchGoalOwnerV1::connect_with_backtest(
        &rd_url,
        &qualification_url,
        &backtest_url,
    )
    .await
    .expect("R&D Owner");

    let research_identity = format!("research-exploratory-{suffix}");
    let research = edge
        .admit_research(research_request(&research_identity))
        .await;
    let accepted = owner.submit_v2(research).await.expect("frozen Research");
    let research_receipt = accepted.owner_receipt().expect("research receipt");
    let intent_identity = research_receipt
        .resulting_research_intent_identity
        .as_deref()
        .expect("intent")
        .to_string();
    let intent_digest = research_receipt.semantic_digest.clone();

    let build_request = edge
        .admit_artifact(ArtifactBuildRequestV1 {
            build_request_identity: format!("artifact-request-exploratory-{suffix}"),
            attempt_identity: format!("artifact-attempt-exploratory-{suffix}"),
            intent_identity: intent_identity.clone(),
            channel: ProductEdgeChannel::WindmillProductEdge,
            admission: placeholder_admission(&format!("artifact-request-exploratory-{suffix}")),
        })
        .await;
    let socket = format!("/tmp/rd-exploratory-sandbox-{suffix}.sock");
    let _ = std::fs::remove_file(&socket);
    let listener = UnixListener::bind(&socket).expect("sandbox listener");
    let sandbox = tokio::spawn(serve_one_verified_sandbox(listener, socket.clone()));
    let artifact_owner = PostgresArtifactBuildOwnerV1::connect(&rd_url, &socket, u64::MAX)
        .await
        .expect("artifact Owner");
    assert_eq!(
        artifact_owner
            .prepare(build_request.clone())
            .await
            .expect("prepared artifact request")
            .resolution(),
        ArtifactBuildResolution::Prepared
    );
    let invocation_claim = edge
        .owner
        .claim_provider_invocation(ProductEdgeInvocationClaimRequestV1 {
            admission: build_request.admission.clone(),
            attempt_identity: build_request.attempt_identity.clone(),
        })
        .await
        .expect("Product Edge invocation claim");
    let reserved_invocation = artifact_owner
        .reserve_provider_invocation_custody(
            &build_request.build_request_identity,
            &build_request.attempt_identity,
            invocation_claim,
        )
        .await
        .expect("R&D invocation reservation");
    let (start_reservation, _invocation_custody) = reserved_invocation.into_parts();
    edge.owner
        .start_provider_invocation(start_reservation)
        .await
        .expect("Product Edge invocation start");
    let started_claim = edge
        .owner
        .resolve_provider_invocation_claim(
            &build_request.admission,
            &build_request.attempt_identity,
        )
        .await
        .expect("Product Edge invocation resolution")
        .expect("started Product Edge invocation claim");
    let terminal = artifact_owner
        .submit_candidate(
            build_request.clone(),
            ArtifactBuildCandidateV1 {
                schema_version: 1,
                candidate_identity: format!("agent-program-candidate-v1-exploratory-{suffix}"),
                intent_identity: intent_identity.clone(),
                intent_semantic_digest: intent_digest,
                logic: GeneratedStrategyLogicV1 {
                    signal: GeneratedSignalV1::Momentum,
                    direction: GeneratedDirectionV1::LongOnly,
                    lookback_bars: 24,
                    entry_threshold_bps: 50,
                    exit_threshold_bps: 10,
                },
                structured_logic_summary: "bounded deterministic exploratory candidate".into(),
                agent_change_explanation: "test-only deterministic artifact generation".into(),
            },
            Some(&started_claim),
        )
        .await
        .expect("artifact terminal");
    sandbox
        .await
        .expect("sandbox task")
        .expect("sandbox response");
    let artifact_receipt = terminal.owner_receipt().expect("artifact receipt");
    let review = terminal.artifact_review().expect("artifact review");
    let artifact_family = terminal
        .artifact_trial_family()
        .expect("artifact family binding");
    let artifact_identity = artifact_receipt
        .artifact_identity
        .as_deref()
        .expect("artifact identity");
    let build_receipt_identity = artifact_receipt
        .build_receipt_identity
        .as_deref()
        .expect("build receipt");

    let proposal = ExploratoryReplayRequestProposalV1 {
        request_identity: format!("exploratory-replay-request-{suffix}"),
        build_request_identity: build_request.build_request_identity.clone(),
        attempt_identity: build_request.attempt_identity.clone(),
        intent_identity,
        trial_family_identity: artifact_family
            .trial_family()
            .root()
            .trial_family_identity()
            .to_string(),
        artifact_identity: artifact_identity.to_string(),
        build_receipt_identity: build_receipt_identity.to_string(),
        artifact_family_binding_identity: artifact_family.binding().binding_identity().to_string(),
        census_frontier_identity: artifact_family
            .trial_family()
            .census_frontier()
            .frontier_identity()
            .to_string(),
        requested_pit_scope: binding("pit-scope-v1", '1'),
        dataset: binding("dataset-v1", '2'),
        feature_set: binding("feature-set-v1", '3'),
        strategy_spec: binding("strategy-spec-v1", '4'),
        exact_code_bytes_digest: review.build_receipt.wasm_digest.clone(),
        replay_config: binding("replay-config-v1", '5'),
        runtime_kernel: versioned("runtime-kernel", "1.0.0"),
        simulator: versioned("simulator", "1.0.0"),
        backtest_engine: versioned("backtest-engine", "1.0.0"),
        cost_model_identity: "cost-model-v1".into(),
        slippage_model_identity: "slippage-model-v1".into(),
        capacity_model_identity: "capacity-model-v1".into(),
        deterministic_seed: 42,
        range_start_epoch_ms: 1_704_067_200_000,
        range_end_epoch_ms: 1_735_689_600_000,
        calendar_identity: "calendar-utc-continuous-v1".into(),
        time_zone_identity: "UTC".into(),
    };

    let first = owner
        .commit_exploratory_replay_request_v1(proposal.clone())
        .await
        .expect("frozen exploratory request");
    edge.revoke_authorization().await;
    let replay = owner
        .commit_exploratory_replay_request_v1(proposal.clone())
        .await
        .expect("response-loss retry after authority revocation");
    assert_eq!(
        serde_json::to_value(&first).unwrap(),
        serde_json::to_value(&replay).unwrap()
    );
    assert_eq!(
        request_counts(
            mutation.pool(CanonicalOwnerTestRoleV1::RdOwner),
            &proposal.request_identity
        )
        .await,
        [1, 1]
    );

    let mut changed = proposal.clone();
    changed.deterministic_seed += 1;
    assert!(matches!(
        owner.commit_exploratory_replay_request_v1(changed).await,
        Err(ExploratoryReplayOwnerError::ConflictingReplay)
    ));
    let mut fresh = proposal.clone();
    fresh.request_identity.push_str("-fresh-after-revoke");
    assert!(matches!(
        owner
            .commit_exploratory_replay_request_v1(fresh.clone())
            .await,
        Err(ExploratoryReplayOwnerError::Unavailable(_))
    ));
    assert_eq!(
        request_counts(
            mutation.pool(CanonicalOwnerTestRoleV1::RdOwner),
            &fresh.request_identity
        )
        .await,
        [0, 0]
    );
    let mut foreign = proposal.clone();
    foreign.request_identity.push_str("-foreign");
    foreign.intent_identity.push_str("-foreign");
    assert!(
        owner
            .commit_exploratory_replay_request_v1(foreign.clone())
            .await
            .is_err()
    );
    assert_eq!(
        request_counts(
            mutation.pool(CanonicalOwnerTestRoleV1::RdOwner),
            &foreign.request_identity
        )
        .await,
        [0, 0]
    );

    let locked = owner
        .lock_exploratory_replay_request_for_backtest_v1(first.locator())
        .await
        .expect("canonical Backtest read");
    assert_eq!(
        locked.projection().availability,
        ExploratoryReplayAvailabilityV1::Available
    );
    assert_eq!(
        locked.readback().unwrap().request_identity(),
        proposal.request_identity
    );
    let available_envelope: serde_json::Value =
        sqlx::query_scalar("SELECT rd_owner_api.lock_exploratory_replay_request_v1($1,$2,$3)")
            .bind(&first.locator().request_identity)
            .bind(&first.locator().request_digest)
            .bind(&first.locator().receipt_identity)
            .fetch_one(mutation.pool(CanonicalOwnerTestRoleV1::BacktestOwner))
            .await
            .expect("canonical raw envelope");
    let impersonator_url = std::env::var("BACKTEST_IMPERSONATOR_TEST_DATABASE_URL")
        .expect("fresh impersonator database URL");
    assert_impersonator_rejected(
        &rd_url,
        &qualification_url,
        &impersonator_url,
        first.locator(),
        &available_envelope,
    )
    .await;
    assert_impersonator_rejected(
        &rd_url,
        &qualification_url,
        &impersonator_url,
        first.locator(),
        &serde_json::json!({"schema_version":1,"availability":"STALE"}),
    )
    .await;
    assert!(
        sqlx::query("SELECT * FROM public.rd_exploratory_replay_requests_v1")
            .fetch_one(mutation.pool(CanonicalOwnerTestRoleV1::BacktestOwner))
            .await
            .is_err()
    );

    for role in [
        CanonicalOwnerTestRoleV1::ProductEdgeOwner,
        CanonicalOwnerTestRoleV1::QualificationWriter,
        CanonicalOwnerTestRoleV1::OperatorAuthorizationWriter,
    ] {
        assert!(
            sqlx::query_scalar::<_, Option<serde_json::Value>>(
                "SELECT rd_owner_api.lock_exploratory_replay_request_v1($1,$2,$3)",
            )
            .bind(&first.locator().request_identity)
            .bind(&first.locator().request_digest)
            .bind(&first.locator().receipt_identity)
            .fetch_one(mutation.pool(role))
            .await
            .is_err()
        );
    }

    let rd_pool = mutation.pool(CanonicalOwnerTestRoleV1::RdOwner);

    for (break_sql, restore_sql) in [
        (
            "UPDATE public.rd_exploratory_replay_requests_v1 SET request_digest=request_digest||'-tampered' WHERE request_identity=$1",
            "UPDATE public.rd_exploratory_replay_requests_v1 SET request_digest=frozen_json->>'request_digest' WHERE request_identity=$1",
        ),
        (
            "UPDATE public.rd_exploratory_replay_requests_v1 SET committed_at_epoch_ms=committed_at_epoch_ms+1 WHERE request_identity=$1",
            "UPDATE public.rd_exploratory_replay_requests_v1 SET committed_at_epoch_ms=(receipt_json->>'committed_at_epoch_ms')::bigint WHERE request_identity=$1",
        ),
    ] {
        sqlx::query(break_sql)
            .bind(&proposal.request_identity)
            .execute(rd_pool)
            .await
            .unwrap();
        assert_unavailable(&owner, first.locator()).await;
        sqlx::query(restore_sql)
            .bind(&proposal.request_identity)
            .execute(rd_pool)
            .await
            .unwrap();
    }
    sqlx::query("UPDATE public.rd_exploratory_replay_requests_v1 SET frozen_json=jsonb_set(frozen_json,'{proposal,dataset,digest}',to_jsonb('sha256:tampered'::text)) WHERE request_identity=$1")
        .bind(&proposal.request_identity).execute(rd_pool).await.unwrap();
    assert_unavailable(&owner, first.locator()).await;
    sqlx::query("UPDATE public.rd_exploratory_replay_requests_v1 SET frozen_json=jsonb_set(frozen_json,'{proposal,dataset,digest}',to_jsonb($2::text)) WHERE request_identity=$1")
        .bind(&proposal.request_identity).bind(&proposal.dataset.digest).execute(rd_pool).await.unwrap();
    sqlx::query("UPDATE public.rd_owner_outbox_v1 SET event_kind='MISSING_FOR_TEST' WHERE aggregate_identity=$1 AND event_kind='EXPLORATORY_REPLAY_REQUEST_FROZEN_V1'")
        .bind(&proposal.request_identity).execute(rd_pool).await.unwrap();
    assert_unavailable(&owner, first.locator()).await;
    sqlx::query("UPDATE public.rd_owner_outbox_v1 SET event_kind='EXPLORATORY_REPLAY_REQUEST_FROZEN_V1' WHERE aggregate_identity=$1 AND event_kind='MISSING_FOR_TEST'")
        .bind(&proposal.request_identity).execute(rd_pool).await.unwrap();

    sqlx::query("UPDATE public.rd_artifact_trial_family_bindings_v1 SET binding_digest=binding_digest||'-tampered' WHERE binding_identity=$1")
        .bind(&proposal.artifact_family_binding_identity).execute(rd_pool).await.unwrap();
    assert_unavailable(&owner, first.locator()).await;
    sqlx::query("UPDATE public.rd_artifact_trial_family_bindings_v1 SET binding_digest=binding_json->>'binding_digest' WHERE binding_identity=$1")
        .bind(&proposal.artifact_family_binding_identity).execute(rd_pool).await.unwrap();

    for (break_sql, restore_sql, aggregate_identity) in [
        (
            "UPDATE public.rd_owner_outbox_v1 SET event_identity=event_identity||'-tampered' WHERE aggregate_identity=$1 AND event_kind='TRIAL_FAMILY_FROZEN_V1'",
            "UPDATE public.rd_owner_outbox_v1 outbox SET event_identity=request.frozen_json->>'trial_family_outbox_event_identity' FROM public.rd_exploratory_replay_requests_v1 request WHERE outbox.aggregate_identity=$1 AND outbox.event_kind='TRIAL_FAMILY_FROZEN_V1' AND request.request_identity=$2",
            proposal.trial_family_identity.as_str(),
        ),
        (
            "UPDATE public.rd_owner_outbox_v1 SET payload_digest=payload_digest||'-tampered' WHERE aggregate_identity=$1 AND event_kind='TRIAL_FAMILY_FROZEN_V1'",
            "UPDATE public.rd_owner_outbox_v1 outbox SET payload_digest=request.frozen_json->>'trial_family_outbox_digest' FROM public.rd_exploratory_replay_requests_v1 request WHERE outbox.aggregate_identity=$1 AND outbox.event_kind='TRIAL_FAMILY_FROZEN_V1' AND request.request_identity=$2",
            proposal.trial_family_identity.as_str(),
        ),
        (
            "UPDATE public.rd_owner_outbox_v1 SET committed_at_epoch_ms=committed_at_epoch_ms+1 WHERE aggregate_identity=$1 AND event_kind='TRIAL_FAMILY_FROZEN_V1'",
            "UPDATE public.rd_owner_outbox_v1 outbox SET committed_at_epoch_ms=(request.frozen_json->>'trial_family_outbox_committed_at_epoch_ms')::bigint FROM public.rd_exploratory_replay_requests_v1 request WHERE outbox.aggregate_identity=$1 AND outbox.event_kind='TRIAL_FAMILY_FROZEN_V1' AND request.request_identity=$2",
            proposal.trial_family_identity.as_str(),
        ),
        (
            "UPDATE public.rd_owner_outbox_v1 SET event_identity=event_identity||'-tampered' WHERE aggregate_identity=$1 AND event_kind='ARTIFACT_TRIAL_FAMILY_BOUND_V1'",
            "UPDATE public.rd_owner_outbox_v1 outbox SET event_identity=request.frozen_json->>'artifact_family_outbox_event_identity' FROM public.rd_exploratory_replay_requests_v1 request WHERE outbox.aggregate_identity=$1 AND outbox.event_kind='ARTIFACT_TRIAL_FAMILY_BOUND_V1' AND request.request_identity=$2",
            proposal.artifact_identity.as_str(),
        ),
        (
            "UPDATE public.rd_owner_outbox_v1 SET payload_digest=payload_digest||'-tampered' WHERE aggregate_identity=$1 AND event_kind='ARTIFACT_TRIAL_FAMILY_BOUND_V1'",
            "UPDATE public.rd_owner_outbox_v1 outbox SET payload_digest=request.frozen_json->>'artifact_family_outbox_digest' FROM public.rd_exploratory_replay_requests_v1 request WHERE outbox.aggregate_identity=$1 AND outbox.event_kind='ARTIFACT_TRIAL_FAMILY_BOUND_V1' AND request.request_identity=$2",
            proposal.artifact_identity.as_str(),
        ),
        (
            "UPDATE public.rd_owner_outbox_v1 SET committed_at_epoch_ms=committed_at_epoch_ms+1 WHERE aggregate_identity=$1 AND event_kind='ARTIFACT_TRIAL_FAMILY_BOUND_V1'",
            "UPDATE public.rd_owner_outbox_v1 outbox SET committed_at_epoch_ms=(request.frozen_json->>'artifact_family_outbox_committed_at_epoch_ms')::bigint FROM public.rd_exploratory_replay_requests_v1 request WHERE outbox.aggregate_identity=$1 AND outbox.event_kind='ARTIFACT_TRIAL_FAMILY_BOUND_V1' AND request.request_identity=$2",
            proposal.artifact_identity.as_str(),
        ),
    ] {
        sqlx::query(break_sql)
            .bind(aggregate_identity)
            .execute(rd_pool)
            .await
            .unwrap();
        assert!(matches!(
            owner
                .commit_exploratory_replay_request_v1(proposal.clone())
                .await,
            Err(ExploratoryReplayOwnerError::Unavailable(_))
        ));
        assert_unavailable(&owner, first.locator()).await;
        assert_eq!(
            request_counts(rd_pool, &proposal.request_identity).await,
            [1, 1]
        );
        sqlx::query(restore_sql)
            .bind(aggregate_identity)
            .bind(&proposal.request_identity)
            .execute(rd_pool)
            .await
            .unwrap();
        let restored = owner
            .commit_exploratory_replay_request_v1(proposal.clone())
            .await
            .expect("restored dependency outbox retry");
        assert_eq!(
            serde_json::to_value(&restored).unwrap(),
            serde_json::to_value(&first).unwrap()
        );
    }

    for (break_sql, restore_sql, aggregate_identity, restored_value) in [
        (
            "UPDATE public.rd_owner_outbox_v1 SET payload_json=jsonb_set(payload_json,'{intent_identity}',to_jsonb('foreign-intent'::text)) WHERE aggregate_identity=$1 AND event_kind='TRIAL_FAMILY_FROZEN_V1'",
            "UPDATE public.rd_owner_outbox_v1 SET payload_json=jsonb_set(payload_json,'{intent_identity}',to_jsonb($2::text)) WHERE aggregate_identity=$1 AND event_kind='TRIAL_FAMILY_FROZEN_V1'",
            proposal.trial_family_identity.as_str(),
            proposal.intent_identity.as_str(),
        ),
        (
            "UPDATE public.rd_owner_outbox_v1 SET payload_json=jsonb_set(payload_json,'{binding_identity}',to_jsonb('foreign-binding'::text)) WHERE aggregate_identity=$1 AND event_kind='ARTIFACT_TRIAL_FAMILY_BOUND_V1'",
            "UPDATE public.rd_owner_outbox_v1 SET payload_json=jsonb_set(payload_json,'{binding_identity}',to_jsonb($2::text)) WHERE aggregate_identity=$1 AND event_kind='ARTIFACT_TRIAL_FAMILY_BOUND_V1'",
            proposal.artifact_identity.as_str(),
            proposal.artifact_family_binding_identity.as_str(),
        ),
    ] {
        sqlx::query(break_sql)
            .bind(aggregate_identity)
            .execute(rd_pool)
            .await
            .unwrap();
        assert!(matches!(
            owner
                .commit_exploratory_replay_request_v1(proposal.clone())
                .await,
            Err(ExploratoryReplayOwnerError::Unavailable(_))
        ));
        assert_unavailable(&owner, first.locator()).await;
        assert_raw_lock_not_available(
            mutation.pool(CanonicalOwnerTestRoleV1::BacktestOwner),
            first.locator(),
        )
        .await;
        assert_eq!(
            request_counts(rd_pool, &proposal.request_identity).await,
            [1, 1]
        );
        sqlx::query(restore_sql)
            .bind(aggregate_identity)
            .bind(restored_value)
            .execute(rd_pool)
            .await
            .unwrap();
        let restored = owner
            .commit_exploratory_replay_request_v1(proposal.clone())
            .await
            .expect("restored historical outbox retry");
        assert_eq!(
            serde_json::to_value(&restored).unwrap(),
            serde_json::to_value(&first).unwrap()
        );
    }

    let (family_payload, family_digest): (serde_json::Value, String) = sqlx::query_as(
        "SELECT payload_json,payload_digest FROM public.rd_owner_outbox_v1 WHERE aggregate_identity=$1 AND event_kind='TRIAL_FAMILY_FROZEN_V1'",
    )
    .bind(&proposal.trial_family_identity)
    .fetch_one(rd_pool)
    .await
    .unwrap();
    let mut tampered_family_payload = family_payload.clone();
    tampered_family_payload["intent_identity"] = serde_json::json!("foreign-intent");
    let tampered_family: TestFamilyFrozenOutboxV1 =
        serde_json::from_value(tampered_family_payload.clone()).unwrap();
    sqlx::query("UPDATE public.rd_owner_outbox_v1 SET payload_json=$2,payload_digest=$3 WHERE aggregate_identity=$1 AND event_kind='TRIAL_FAMILY_FROZEN_V1'")
        .bind(&proposal.trial_family_identity)
        .bind(tampered_family_payload)
        .bind(dependency_payload_digest(&tampered_family))
        .execute(rd_pool).await.unwrap();
    assert!(matches!(
        owner
            .commit_exploratory_replay_request_v1(proposal.clone())
            .await,
        Err(ExploratoryReplayOwnerError::Unavailable(_))
    ));
    assert_unavailable(&owner, first.locator()).await;
    assert_raw_lock_not_available(
        mutation.pool(CanonicalOwnerTestRoleV1::BacktestOwner),
        first.locator(),
    )
    .await;
    assert_eq!(
        request_counts(rd_pool, &proposal.request_identity).await,
        [1, 1]
    );
    sqlx::query("UPDATE public.rd_owner_outbox_v1 SET payload_json=$2,payload_digest=$3 WHERE aggregate_identity=$1 AND event_kind='TRIAL_FAMILY_FROZEN_V1'")
        .bind(&proposal.trial_family_identity).bind(family_payload).bind(family_digest)
        .execute(rd_pool).await.unwrap();

    let (artifact_payload, artifact_digest): (serde_json::Value, String) = sqlx::query_as(
        "SELECT payload_json,payload_digest FROM public.rd_owner_outbox_v1 WHERE aggregate_identity=$1 AND event_kind='ARTIFACT_TRIAL_FAMILY_BOUND_V1'",
    )
    .bind(&proposal.artifact_identity)
    .fetch_one(rd_pool)
    .await
    .unwrap();
    let mut tampered_artifact_payload = artifact_payload.clone();
    tampered_artifact_payload["binding_identity"] = serde_json::json!("foreign-binding");
    let tampered_artifact: TestArtifactBoundOutboxV1 =
        serde_json::from_value(tampered_artifact_payload.clone()).unwrap();
    sqlx::query("UPDATE public.rd_owner_outbox_v1 SET payload_json=$2,payload_digest=$3 WHERE aggregate_identity=$1 AND event_kind='ARTIFACT_TRIAL_FAMILY_BOUND_V1'")
        .bind(&proposal.artifact_identity)
        .bind(tampered_artifact_payload)
        .bind(dependency_payload_digest(&tampered_artifact))
        .execute(rd_pool).await.unwrap();
    assert!(matches!(
        owner
            .commit_exploratory_replay_request_v1(proposal.clone())
            .await,
        Err(ExploratoryReplayOwnerError::Unavailable(_))
    ));
    assert_unavailable(&owner, first.locator()).await;
    assert_raw_lock_not_available(
        mutation.pool(CanonicalOwnerTestRoleV1::BacktestOwner),
        first.locator(),
    )
    .await;
    assert_eq!(
        request_counts(rd_pool, &proposal.request_identity).await,
        [1, 1]
    );
    sqlx::query("UPDATE public.rd_owner_outbox_v1 SET payload_json=$2,payload_digest=$3 WHERE aggregate_identity=$1 AND event_kind='ARTIFACT_TRIAL_FAMILY_BOUND_V1'")
        .bind(&proposal.artifact_identity).bind(artifact_payload).bind(artifact_digest)
        .execute(rd_pool).await.unwrap();
    let restored = owner
        .commit_exploratory_replay_request_v1(proposal.clone())
        .await
        .expect("coordinated outbox tamper restored");
    assert_eq!(
        serde_json::to_value(&restored).unwrap(),
        serde_json::to_value(&first).unwrap()
    );

    let wasm_bytes: Vec<u8> = sqlx::query_scalar(
        "SELECT wasm_bytes FROM public.rd_strategy_artifacts_v1 WHERE artifact_digest=$1",
    )
    .bind(&proposal.artifact_identity)
    .fetch_one(rd_pool)
    .await
    .unwrap();
    sqlx::query("UPDATE public.rd_strategy_artifacts_v1 SET wasm_bytes=wasm_bytes||decode('00','hex') WHERE artifact_digest=$1")
        .bind(&proposal.artifact_identity).execute(rd_pool).await.unwrap();
    assert_unavailable(&owner, first.locator()).await;
    sqlx::query(
        "UPDATE public.rd_strategy_artifacts_v1 SET wasm_bytes=$2 WHERE artifact_digest=$1",
    )
    .bind(&proposal.artifact_identity)
    .bind(wasm_bytes)
    .execute(rd_pool)
    .await
    .unwrap();

    sqlx::query("UPDATE public.rd_exploratory_replay_requests_v1 SET lifecycle_state='REVOKED' WHERE request_identity=$1")
        .bind(&proposal.request_identity).execute(rd_pool).await.unwrap();
    let stale = owner
        .lock_exploratory_replay_request_for_backtest_v1(first.locator())
        .await
        .unwrap();
    assert_eq!(
        stale.projection().availability,
        ExploratoryReplayAvailabilityV1::Stale
    );
    assert!(stale.readback().is_none());
    sqlx::query("UPDATE public.rd_exploratory_replay_requests_v1 SET lifecycle_state='FROZEN' WHERE request_identity=$1")
        .bind(&proposal.request_identity).execute(rd_pool).await.unwrap();

    let restarted = PostgresResearchGoalOwnerV1::connect_with_backtest(
        &rd_url,
        &qualification_url,
        &backtest_url,
    )
    .await
    .unwrap();
    let recovered = restarted
        .lock_exploratory_replay_request_for_backtest_v1(first.locator())
        .await
        .unwrap();
    assert_eq!(
        recovered.readback().unwrap().request_digest(),
        first.locator().request_digest
    );
}

async fn assert_unavailable(
    owner: &PostgresResearchGoalOwnerV1,
    locator: &ExploratoryReplayRequestLocatorV1,
) {
    let result = owner
        .lock_exploratory_replay_request_for_backtest_v1(locator)
        .await
        .unwrap();
    assert_eq!(
        result.projection().availability,
        ExploratoryReplayAvailabilityV1::Unavailable
    );
    assert!(result.readback().is_none());
}

async fn assert_raw_lock_not_available(
    backtest_pool: &PgPool,
    locator: &ExploratoryReplayRequestLocatorV1,
) {
    let value: Option<serde_json::Value> =
        sqlx::query_scalar("SELECT rd_owner_api.lock_exploratory_replay_request_v1($1,$2,$3)")
            .bind(&locator.request_identity)
            .bind(&locator.request_digest)
            .bind(&locator.receipt_identity)
            .fetch_one(backtest_pool)
            .await
            .unwrap();
    assert_ne!(
        value
            .as_ref()
            .and_then(|envelope| envelope.get("availability"))
            .and_then(serde_json::Value::as_str),
        Some("AVAILABLE")
    );
}

fn dependency_payload_digest<T: Serialize>(payload: &T) -> String {
    #[derive(Serialize)]
    struct Envelope<'a, T> {
        domain: &'a str,
        value: &'a T,
    }
    let bytes = serde_json::to_vec(&Envelope {
        domain: "rd.owner-outbox.payload.v1",
        value: payload,
    })
    .unwrap();
    format!("sha256:{:x}", Sha256::digest(bytes))
}

async fn assert_impersonator_rejected(
    rd_url: &str,
    qualification_url: &str,
    impersonator_url: &str,
    locator: &ExploratoryReplayRequestLocatorV1,
    envelope: &serde_json::Value,
) {
    let encoded = BASE64.encode(serde_json::to_vec(envelope).unwrap());
    let options = format!("-cvibe.fake_envelope_base64={encoded}");
    let database_url = format!(
        "{impersonator_url}?options={}",
        encode_query_value(&options)
    );
    let pool = PgPool::connect(&database_url)
        .await
        .expect("impersonating backtest_owner pool");
    let observed: serde_json::Value =
        sqlx::query_scalar("SELECT rd_owner_api.lock_exploratory_replay_request_v1($1,$2,$3)")
            .bind(&locator.request_identity)
            .bind(&locator.request_digest)
            .bind(&locator.receipt_identity)
            .fetch_one(&pool)
            .await
            .expect("impersonator function envelope");
    assert_eq!(observed, *envelope);
    assert!(
        PostgresResearchGoalOwnerV1::connect_with_backtest(
            rd_url,
            qualification_url,
            &database_url,
        )
        .await
        .is_err()
    );
}

fn encode_query_value(value: &str) -> String {
    let mut encoded = String::with_capacity(value.len());
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~') {
            encoded.push(char::from(byte));
        } else {
            encoded.push_str(&format!("%{byte:02X}"));
        }
    }
    encoded
}

async fn request_counts(pool: &PgPool, identity: &str) -> [i64; 2] {
    [
        sqlx::query_scalar("SELECT COUNT(*) FROM public.rd_exploratory_replay_requests_v1 WHERE request_identity=$1")
            .bind(identity).fetch_one(pool).await.unwrap(),
        sqlx::query_scalar("SELECT COUNT(*) FROM public.rd_owner_outbox_v1 WHERE aggregate_identity=$1 AND event_kind='EXPLORATORY_REPLAY_REQUEST_FROZEN_V1'")
            .bind(identity).fetch_one(pool).await.unwrap(),
    ]
}

async fn serve_one_verified_sandbox(listener: UnixListener, socket: String) -> anyhow::Result<()> {
    let (mut stream, _) = listener.accept().await?;
    let length = stream.read_u32().await? as usize;
    let mut bytes = vec![0; length];
    stream.read_exact(&mut bytes).await?;
    let request: serde_json::Value = serde_json::from_slice(&bytes)?;
    let source = request["source"].as_str().expect("sandbox source");
    let response = serde_json::to_vec(&serde_json::json!({
        "protocol": "rd-build-sandbox-v1",
        "outcome": "SUCCESS",
        "failure_code": null,
        "source_capsule_base64": BASE64.encode(source_capsule(source.as_bytes())?),
        "build_recipe_base64": BASE64.encode(build_recipe()),
        "wasm_one_base64": BASE64.encode(include_bytes!("../assets/program_complex_v1/program.first.wasm")),
        "wasm_two_base64": BASE64.encode(include_bytes!("../assets/program_complex_v1/program.first.wasm")),
    }))?;
    stream.write_u32(response.len() as u32).await?;
    stream.write_all(&response).await?;
    stream.flush().await?;
    std::fs::remove_file(socket)?;
    Ok(())
}

fn source_capsule(source: &[u8]) -> anyhow::Result<Vec<u8>> {
    const MANIFEST: &str = r#"[package]
name = "rd-generated-strategy"
version = "0.1.0"
edition = "2024"
rust-version = "1.97.1"
publish = false

[lib]
crate-type = ["cdylib"]
path = "src/lib.rs"

[workspace]

[profile.release]
panic = "abort"
opt-level = "z"
codegen-units = 1
lto = "fat"
strip = "symbols"
"#;
    const LOCK: &str = "# This file is automatically @generated by Cargo.\n# It is not intended for manual editing.\nversion = 4\n\n[[package]]\nname = \"rd-generated-strategy\"\nversion = \"0.1.0\"\n";
    let mut bytes = Vec::new();
    {
        let mut archive = tar::Builder::new(&mut bytes);

        for (path, content) in [
            ("Cargo.lock", LOCK.as_bytes()),
            ("Cargo.toml", MANIFEST.as_bytes()),
            ("src/lib.rs", source),
        ] {
            let mut header = tar::Header::new_gnu();
            header.set_size(content.len() as u64);
            header.set_mode(0o644);
            header.set_uid(0);
            header.set_gid(0);
            header.set_mtime(1);
            header.set_cksum();
            archive.append_data(&mut header, path, content)?;
        }
        archive.finish()?;
    }
    Ok(bytes)
}

fn build_recipe() -> Vec<u8> {
    let dockerfile = include_str!("../../../product/rd-workbench/Dockerfile.sandbox");
    let mut bytes = serde_json::to_vec(&serde_json::json!({
        "build_platform":"linux/arm64",
        "dependency_policy":"locked_no_external_dependencies",
        "dockerfile_sha256":format!("sha256:{:x}", Sha256::digest(dockerfile.as_bytes())),
        "frontend":"docker/dockerfile:1.20@sha256:26147acbda4f14c5add9946e2fd2ed543fc402884fd75146bd342a7f6271dc1d",
        "manifest":"Cargo.toml",
        "network_policy":"container_network_none_cargo_offline",
        "rust_image":"public.ecr.aws/docker/library/rust:1.97.1-slim-bookworm@sha256:99e09cb2284e2ddbb73a995deee3e91783fd04d177602ccf6eab326d778ee777",
        "rustc_commit":"8bab26f4f68e0e26f0bb7960be334d5b520ea452",
        "rustc_release":"1.97.1",
        "sandbox_policy":"rd-development-sandbox-container-v1",
        "schema_version":2,
        "target":"wasm32v1-none",
        "wasm_target":"rd_generated_strategy"
    })).unwrap();
    bytes.push(b'\n');
    bytes
}

struct TestProductEdge {
    owner: ProductEdgePostgresOwnerV1,
    issuer: OperatorAuthorizationIssuerPostgresV1,
    authorization: OperatorAuthorizationLocatorV1,
    authorization_frontier_identity: String,
    proof: String,
}

impl TestProductEdge {
    async fn bootstrap(issuer_url: &str, edge_url: &str, suffix: &str) -> Self {
        let now = now();
        let valid_through = now + 3_600_000;
        let mut manifests = vec![
            manifest(
                RESEARCH_GOAL_OPERATION_V2,
                RESEARCH_GOAL_SCHEMA_V2,
                vec!["R_AND_D_RESEARCH_MUTATION_V1".into()],
                now,
                valid_through,
            ),
            manifest(
                ARTIFACT_BUILD_OPERATION_V1,
                ARTIFACT_BUILD_SCHEMA_V1,
                vec![
                    "R_AND_D_ARTIFACT_BUILD_MUTATION_V1".into(),
                    "R_AND_D_PROVIDER_INVOCATION_V1".into(),
                ],
                now,
                valid_through,
            ),
        ];
        manifests.sort_by_key(|manifest| manifest.manifest_identity().unwrap());
        let proof = format!("sha256:{}", "a".repeat(64));
        let issuer = OperatorAuthorizationIssuerPostgresV1::connect(issuer_url)
            .await
            .unwrap();
        let authorization = issuer
            .issue_genesis(OperatorAuthorizationIssuanceProposalV1 {
                authorization_identity: format!("oa-exploratory-{suffix}"),
                issuer_identity: "oa-exploratory-test-v1".into(),
                issuer_key_version: "key-v1".into(),
                scope: OperatorAuthorizationScopeV1 {
                    principal: format!("principal-{suffix}"),
                    audience: format!("R_AND_D:{suffix}"),
                    permissions: vec![
                        "research:artifact-build".into(),
                        "research:submit".into(),
                        "research:view".into(),
                    ],
                },
                request_proof_digest: proof.clone(),
                operation_manifests: manifests
                    .iter()
                    .map(|item| OperationManifestBindingV1 {
                        manifest_identity: item.manifest_identity().unwrap(),
                        manifest_digest: item.manifest_digest().unwrap(),
                    })
                    .collect(),
                not_before_epoch_ms: now - 1_000,
                valid_through_epoch_ms: valid_through,
                expected_revocation_head: "EMPTY".into(),
            })
            .await
            .unwrap();
        let deployment = format!("pe-exploratory-{suffix}");
        let owner = ProductEdgePostgresOwnerV1::connect(
            edge_url,
            &deployment,
            ProductEdgeAuthorizationTrustV1 {
                issuer_identity: "oa-exploratory-test-v1".into(),
                issuer_key_version: "key-v1".into(),
                audience: format!("R_AND_D:{suffix}"),
            },
        )
        .await
        .unwrap();
        owner
            .bootstrap_genesis(ProductEdgeBootstrapProposalV1 {
                deployment_identity: deployment,
                binding_identity: format!("pe-binding-exploratory-{suffix}"),
                expected_history_head: "EMPTY".into(),
                generation: 1,
                effective_principal: format!("principal-{suffix}"),
                scope_policy_version: "scope-v1".into(),
                capability_policy_version: "capability-v1".into(),
                audit_policy_version: "audit-v1".into(),
                valid_from_epoch_ms: now - 1_000,
                valid_through_epoch_ms: valid_through,
                authorization: authorization.locator(),
                manifests,
            })
            .await
            .unwrap();
        Self {
            owner,
            issuer,
            authorization: authorization.locator(),
            authorization_frontier_identity: authorization
                .frontier()
                .frontier_identity()
                .to_string(),
            proof,
        }
    }

    async fn revoke_authorization(&self) {
        self.issuer
            .revoke(OperatorAuthorizationRevocationProposalV1 {
                authorization: self.authorization.clone(),
                expected_frontier_identity: self.authorization_frontier_identity.clone(),
                reason_code: "RESPONSE_LOSS_RETRY_TEST".into(),
            })
            .await
            .expect("revoke original Product Edge authorization");
    }

    async fn admit_research(
        &self,
        mut request: ProductEdgeResearchGoalRequestV2,
    ) -> ProductEdgeResearchGoalRequestV2 {
        request.admission = self.admit(&request.request_identity, serde_json::json!({"request_identity":request.request_identity,"channel":request.channel,"goal":request.goal,"trial_family_proposal":request.trial_family_proposal}), RESEARCH_GOAL_OPERATION_V2, RESEARCH_GOAL_SCHEMA_V2, vec!["R_AND_D_RESEARCH_MUTATION_V1".into()]).await;
        request
    }

    async fn admit_artifact(&self, mut request: ArtifactBuildRequestV1) -> ArtifactBuildRequestV1 {
        request.admission = self
            .owner
            .admit_artifact_build_request(ProductEdgeAdmissionRequestV1 {
                request_identity: request.build_request_identity.clone(),
                typed_payload: serde_json::json!({
                    "build_request_identity": request.build_request_identity,
                    "attempt_identity": request.attempt_identity,
                    "intent_identity": request.intent_identity,
                    "channel": request.channel,
                }),
                operation: ARTIFACT_BUILD_OPERATION_V1.into(),
                operation_schema: ARTIFACT_BUILD_SCHEMA_V1.into(),
                target_owner: RESEARCH_OWNER_V1.into(),
                requested_effects: vec![
                    "R_AND_D_ARTIFACT_BUILD_MUTATION_V1".into(),
                    "R_AND_D_PROVIDER_INVOCATION_V1".into(),
                ],
                request_proof_digest: self.proof.clone(),
                audit_correlation: format!("test:{}", request.build_request_identity),
            })
            .await
            .unwrap()
            .locator()
            .clone();
        request
    }

    async fn admit(
        &self,
        identity: &str,
        payload: serde_json::Value,
        operation: &str,
        schema: &str,
        effects: Vec<String>,
    ) -> vibe_product_edge::ProductEdgeAdmissionLocatorV1 {
        self.owner
            .admit_request(ProductEdgeAdmissionRequestV1 {
                request_identity: identity.into(),
                typed_payload: payload,
                operation: operation.into(),
                operation_schema: schema.into(),
                target_owner: RESEARCH_OWNER_V1.into(),
                requested_effects: effects,
                request_proof_digest: self.proof.clone(),
                audit_correlation: format!("test:{identity}"),
            })
            .await
            .unwrap()
            .locator()
            .clone()
    }
}

fn manifest(
    operation: &str,
    schema: &str,
    effects: Vec<String>,
    now: u64,
    valid_through: u64,
) -> AgentOperationManifestProposalV1 {
    AgentOperationManifestProposalV1 {
        operation: operation.into(),
        operation_schema: schema.into(),
        target_owner: RESEARCH_OWNER_V1.into(),
        allowed_effects: effects,
        prohibited_effects: vec!["REAL_TRADING_V1".into()],
        capability_policy_digest: format!("sha256:{}", "b".repeat(64)),
        effective_from_epoch_ms: now - 1_000,
        valid_through_epoch_ms: valid_through,
    }
}

fn research_request(identity: &str) -> ProductEdgeResearchGoalRequestV2 {
    ProductEdgeResearchGoalRequestV2 {
        request_identity: identity.into(),
        channel: ProductEdgeChannel::WindmillProductEdge,
        admission: placeholder_admission(identity),
        goal: SourcedResearchGoalV2 {
            hypothesis: "PIT momentum survives exact costs".into(),
            mechanism: "bounded information diffusion".into(),
            falsification_question: "does exact cost remove the effect".into(),
            expected_observation: "net continuation remains positive".into(),
            required_data: vec!["PIT bars".into()],
            cost_assumption: "frozen cost model".into(),
            capacity_assumption: "frozen capacity model".into(),
            sources: vec![ResearchSourceV1 {
                locator: "https://example.com/research".into(),
                content_digest: format!("sha256:{}", "c".repeat(64)),
                observed_at: "2026-08-24T00:00:00Z".into(),
                source_cut: "source-cut-v1".into(),
                license_basis: "public research".into(),
                interpretation: "bounded interpretation".into(),
            }],
        },
        trial_family_proposal: TrialFamilyProposalV1 {
            trial_budget: 8,
            stop_rule: "stop on falsifier or budget".into(),
            pit_rule_identity: "pit-rule-v1".into(),
            cost_model_identity: "cost-model-v1".into(),
            slippage_model_identity: "slippage-model-v1".into(),
            capacity_model_identity: "capacity-model-v1".into(),
            independence_rationale: "Owner-resolved predecessor census".into(),
        },
    }
}

fn placeholder_admission(identity: &str) -> vibe_product_edge::ProductEdgeAdmissionLocatorV1 {
    vibe_product_edge::ProductEdgeAdmissionLocatorV1 {
        request_identity: identity.into(),
        admission_identity: format!("placeholder-{identity}"),
        admission_digest: format!("sha256:{}", "d".repeat(64)),
    }
}

fn binding(identity: &str, digit: char) -> IdentityDigestV1 {
    IdentityDigestV1 {
        identity: identity.into(),
        digest: format!("sha256:{}", digit.to_string().repeat(64)),
    }
}
fn versioned(identity: &str, version: &str) -> VersionedIdentityV1 {
    VersionedIdentityV1 {
        identity: identity.into(),
        version: version.into(),
    }
}
fn unique_suffix() -> String {
    format!("{}-{}", std::process::id(), now())
}
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}
