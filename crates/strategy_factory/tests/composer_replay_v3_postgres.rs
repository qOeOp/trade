#![cfg(feature = "sealed-source-intake-composer-acceptance")]

use std::time::{SystemTime, UNIX_EPOCH};

use sqlx::PgPool;
use vibe_data::owner::{
    replay_market_facts_v2::ReplayCompositionBindingLocatorV1, source_binding::BindingDigest,
};
use vibe_product_edge::ProductEdgeAdmissionLocatorV1;
use vibe_strategy_factory::{
    develop_composer_postgres_v2::DevelopComposerSealedReadLocatorV2,
    exploratory_replay::{ComposerBackedExploratoryReplayProposalV3, ExploratoryReplayOwnerError},
    product_edge_postgres::PostgresResearchGoalOwnerV1,
};
use vibe_testkit::postgres::{CanonicalOwnerPostgresTestDatabaseV1, CanonicalOwnerTestRoleV1};

fn unique_request_identity() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock after epoch")
        .as_nanos();
    format!(
        "composer-v3-forged-admission-{nanos}-{}",
        std::process::id()
    )
}

fn forged_proposal(request_identity: String) -> ComposerBackedExploratoryReplayProposalV3 {
    let untrusted = BindingDigest::from_untrusted_bytes([0; 32]);
    ComposerBackedExploratoryReplayProposalV3 {
        admission: ProductEdgeAdmissionLocatorV1 {
            request_identity: request_identity.clone(),
            admission_identity: format!("forged-{request_identity}"),
            admission_digest: format!("sha256:{}", "0".repeat(64)),
        },
        request_identity,
        trial_family_identity: "missing-trial-family".into(),
        artifact_identity: "missing-composer-artifact".into(),
        composer_locator: DevelopComposerSealedReadLocatorV2 {
            schema_version: 2,
            request_identity: "missing-composer-operation".into(),
            operation_receipt_identity: untrusted,
            artifact_locator: "missing-composer-artifact-locator".into(),
            artifact_identity: untrusted,
            canonical_plan_digest: untrusted,
            design_digest: untrusted,
        },
        market_data_locator: ReplayCompositionBindingLocatorV1::from_untrusted(
            untrusted, untrusted,
        ),
        market_data_scope_digest: untrusted,
    }
}

async fn request_rows(pool: &PgPool, request_identity: &str) -> (i64, i64, i64) {
    let replay: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM public.rd_sealed_exploratory_replay_requests_v1 WHERE request_identity=$1",
    )
    .bind(request_identity)
    .fetch_one(pool)
    .await
    .expect("Replay custody row count");
    let transition: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM public.rd_research_view_transitions_v3 WHERE replay_request_identity=$1",
    )
    .bind(request_identity)
    .fetch_one(pool)
    .await
    .expect("Research View transition row count");
    let outbox: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM public.rd_owner_outbox_v1 WHERE aggregate_identity=$1",
    )
    .bind(request_identity)
    .fetch_one(pool)
    .await
    .expect("R&D outbox row count");
    (replay, transition, outbox)
}

#[tokio::test]
#[ignore = "requires the canonical disposable Owner PostgreSQL topology"]
async fn forged_v3_admission_fails_without_replay_transition_or_outbox_write() {
    let database = CanonicalOwnerPostgresTestDatabaseV1::admit()
        .await
        .expect("canonical disposable Owner topology");
    let mutation = database.mutation();
    let rd_pool = mutation.pool(CanonicalOwnerTestRoleV1::RdOwner);
    let owner = PostgresResearchGoalOwnerV1::connect_with_backtest(
        database.database_url(CanonicalOwnerTestRoleV1::RdOwner),
        database.database_url(CanonicalOwnerTestRoleV1::QualificationWriter),
        database.database_url(CanonicalOwnerTestRoleV1::BacktestOwner),
    )
    .await
    .expect("canonical R&D Owner");
    let proposal = forged_proposal(unique_request_identity());
    let before = request_rows(rd_pool, &proposal.request_identity).await;
    assert_eq!(before, (0, 0, 0));

    let result = owner
        .commit_composer_backed_exploratory_replay_request_v3(proposal.clone())
        .await;
    assert!(
        matches!(result, Err(ExploratoryReplayOwnerError::Unavailable(_))),
        "an unissued Product Edge admission must fail closed: {result:?}"
    );
    assert_eq!(
        request_rows(rd_pool, &proposal.request_identity).await,
        before
    );
}
