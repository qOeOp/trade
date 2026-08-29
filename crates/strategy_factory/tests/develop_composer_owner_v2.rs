#![cfg(feature = "sealed-develop-composer-acceptance")]

use sqlx::Row;
use vibe_strategy_factory::{
    develop_composer_operation_v2::DevelopComposerOperationDispositionV2,
    develop_composer_sealed_acceptance_v2::{
        SEALED_DEVELOP_COMPOSER_REQUEST_IDENTITY_V2, SealedDevelopComposerAcceptanceV2,
    },
};
use vibe_testkit::postgres::{CanonicalOwnerPostgresTestDatabaseV1, CanonicalOwnerTestRoleV1};

const OWNER_ROW_COUNTS: &[(&str, &str)] = &[
    (
        "rd_develop_designs_v2",
        "SELECT count(*) FROM rd_develop_designs_v2",
    ),
    (
        "rd_develop_plans_v2",
        "SELECT count(*) FROM rd_develop_plans_v2",
    ),
    (
        "rd_develop_artifacts_v2",
        "SELECT count(*) FROM rd_develop_artifacts_v2",
    ),
    (
        "rd_develop_artifact_modules_v2",
        "SELECT count(*) FROM rd_develop_artifact_modules_v2",
    ),
    (
        "rd_develop_build_receipts_v2",
        "SELECT count(*) FROM rd_develop_build_receipts_v2",
    ),
    (
        "rd_develop_composer_receipts_v2",
        "SELECT count(*) FROM rd_develop_composer_receipts_v2",
    ),
    (
        "rd_develop_host_receipts_v2",
        "SELECT count(*) FROM rd_develop_host_receipts_v2",
    ),
    (
        "rd_develop_operations_v2",
        "SELECT count(*) FROM rd_develop_operations_v2",
    ),
    (
        "rd_develop_outbox_v2",
        "SELECT count(*) FROM rd_develop_outbox_v2",
    ),
];

#[tokio::test]
#[ignore = "requires the admitted disposable R&D Owner PostgreSQL topology and local Rust toolchain"]
async fn durable_owner_is_atomic_restart_exact_and_fail_closed() {
    let database = CanonicalOwnerPostgresTestDatabaseV1::admit()
        .await
        .expect("canonical disposable Owner topology");
    let database_url = database.database_url(CanonicalOwnerTestRoleV1::RdOwner);
    let mutation = database.mutation();
    let pool = mutation.pool(CanonicalOwnerTestRoleV1::RdOwner);

    let owner = SealedDevelopComposerAcceptanceV2::connect(database_url)
        .await
        .expect("sealed Composer owner");
    sqlx::query(
        "TRUNCATE TABLE
           rd_develop_outbox_v2,
           rd_develop_operations_v2,
           rd_develop_host_receipts_v2,
           rd_develop_composer_receipts_v2,
           rd_develop_build_receipts_v2,
           rd_develop_artifact_modules_v2,
           rd_develop_artifacts_v2,
           rd_develop_plans_v2,
           rd_develop_designs_v2",
    )
    .execute(pool)
    .await
    .expect("clear only disposable Composer custody");

    sqlx::query(
        "CREATE OR REPLACE FUNCTION rd_develop_reject_commit_v2()
         RETURNS trigger
         LANGUAGE plpgsql
         AS $function$
         BEGIN
           RAISE EXCEPTION 'injected deferred Composer commit failure';
         END
         $function$",
    )
    .execute(pool)
    .await
    .expect("install disposable deferred failure");
    sqlx::query(
        "CREATE CONSTRAINT TRIGGER rd_develop_reject_commit_v2
         AFTER INSERT ON rd_develop_outbox_v2
         DEFERRABLE INITIALLY DEFERRED
         FOR EACH ROW EXECUTE FUNCTION rd_develop_reject_commit_v2()",
    )
    .execute(pool)
    .await
    .expect("arm deferred commit failure");

    let failed_commit = owner.run().await.expect("commit ambiguity is typed");
    assert_eq!(
        failed_commit.disposition,
        DevelopComposerOperationDispositionV2::SubmittedOrUnknown
    );
    assert!(failed_commit.receipt_identity.is_none());
    assert!(failed_commit.artifact.is_none());
    assert_owner_row_counts(pool, 0).await;

    sqlx::query("DROP TRIGGER rd_develop_reject_commit_v2 ON rd_develop_outbox_v2")
        .execute(pool)
        .await
        .expect("disarm deferred commit failure");
    sqlx::query("DROP FUNCTION rd_develop_reject_commit_v2()")
        .execute(pool)
        .await
        .expect("remove deferred failure function");
    drop(owner);

    let first_owner = SealedDevelopComposerAcceptanceV2::connect(database_url)
        .await
        .expect("first durable Composer owner");
    let committed = first_owner.run().await.expect("durable Composer RUN");
    assert_eq!(
        committed.disposition,
        DevelopComposerOperationDispositionV2::Success
    );
    assert!(committed.receipt_identity.is_some());
    assert!(committed.artifact.is_some());
    assert_owner_row_counts(pool, 1).await;

    let stored_response = sqlx::query_scalar::<_, Vec<u8>>(
        "SELECT response_bytes
           FROM rd_develop_operations_v2
          WHERE request_identity=$1",
    )
    .bind(SEALED_DEVELOP_COMPOSER_REQUEST_IDENTITY_V2)
    .fetch_one(pool)
    .await
    .expect("stored canonical response bytes");
    assert_eq!(stored_response, committed.canonical_bytes());

    drop(first_owner);
    let restarted_owner = SealedDevelopComposerAcceptanceV2::connect(database_url)
        .await
        .expect("restarted durable Composer owner");
    let resolved = restarted_owner
        .resolve(SEALED_DEVELOP_COMPOSER_REQUEST_IDENTITY_V2)
        .await
        .expect("restart RESOLVE");
    let joined = restarted_owner
        .run()
        .await
        .expect("same-identity restart RUN");
    assert_eq!(resolved.canonical_bytes(), stored_response);
    assert_eq!(joined.canonical_bytes(), stored_response);
    assert_owner_row_counts(pool, 1).await;

    let unavailable = restarted_owner
        .resolve("missing-develop-composer-request-v2")
        .await
        .expect("missing RESOLVE is typed");
    assert_eq!(
        unavailable.disposition,
        DevelopComposerOperationDispositionV2::Unavailable
    );
    assert!(unavailable.receipt_identity.is_none());
    assert!(unavailable.artifact.is_none());

    let outbox_bytes = sqlx::query_scalar::<_, Vec<u8>>(
        "SELECT canonical_bytes
           FROM rd_develop_outbox_v2
          WHERE request_identity=$1",
    )
    .bind(SEALED_DEVELOP_COMPOSER_REQUEST_IDENTITY_V2)
    .fetch_one(pool)
    .await
    .expect("stored outbox bytes");
    sqlx::query("DELETE FROM rd_develop_outbox_v2 WHERE request_identity=$1")
        .bind(SEALED_DEVELOP_COMPOSER_REQUEST_IDENTITY_V2)
        .execute(pool)
        .await
        .expect("remove only disposable outbox custody");
    drop(restarted_owner);
    let restarted_owner = SealedDevelopComposerAcceptanceV2::connect(database_url)
        .await
        .expect("restarted owner with incomplete custody");
    let incomplete = restarted_owner
        .resolve(SEALED_DEVELOP_COMPOSER_REQUEST_IDENTITY_V2)
        .await
        .expect("incomplete custody is typed");
    assert_eq!(
        incomplete.disposition,
        DevelopComposerOperationDispositionV2::Unavailable
    );
    assert!(incomplete.receipt_identity.is_none());
    assert!(incomplete.artifact.is_none());
    sqlx::query(
        "INSERT INTO rd_develop_outbox_v2 (request_identity, canonical_bytes)
         VALUES ($1,$2)",
    )
    .bind(SEALED_DEVELOP_COMPOSER_REQUEST_IDENTITY_V2)
    .bind(&outbox_bytes)
    .execute(pool)
    .await
    .expect("restore disposable outbox custody");
    let restored = restarted_owner
        .resolve(SEALED_DEVELOP_COMPOSER_REQUEST_IDENTITY_V2)
        .await
        .expect("restored custody RESOLVE");
    assert_eq!(restored.canonical_bytes(), stored_response);
    assert_owner_row_counts(pool, 1).await;

    let design = sqlx::query(
        "SELECT design_identity, canonical_bytes
           FROM rd_develop_designs_v2",
    )
    .fetch_one(pool)
    .await
    .expect("stored Design bytes");
    let design_identity: Vec<u8> = design.get("design_identity");
    let original_design_bytes: Vec<u8> = design.get("canonical_bytes");
    let mut corrupt_design_bytes = original_design_bytes.clone();
    corrupt_design_bytes[0] ^= 1;
    sqlx::query(
        "UPDATE rd_develop_designs_v2
            SET canonical_bytes=$1
          WHERE design_identity=$2",
    )
    .bind(&corrupt_design_bytes)
    .bind(&design_identity)
    .execute(pool)
    .await
    .expect("corrupt only disposable Design bytes");
    let corrupt = restarted_owner
        .resolve(SEALED_DEVELOP_COMPOSER_REQUEST_IDENTITY_V2)
        .await
        .expect("corrupt RESOLVE is typed");
    assert_eq!(
        corrupt.disposition,
        DevelopComposerOperationDispositionV2::Unavailable
    );
    assert!(corrupt.receipt_identity.is_none());
    assert!(corrupt.artifact.is_none());
    sqlx::query(
        "UPDATE rd_develop_designs_v2
            SET canonical_bytes=$1
          WHERE design_identity=$2",
    )
    .bind(&original_design_bytes)
    .bind(&design_identity)
    .execute(pool)
    .await
    .expect("restore disposable Design bytes");

    sqlx::query(
        "UPDATE rd_develop_operations_v2
            SET request_digest=decode(repeat('ff', 32), 'hex')
          WHERE request_identity=$1",
    )
    .bind(SEALED_DEVELOP_COMPOSER_REQUEST_IDENTITY_V2)
    .execute(pool)
    .await
    .expect("bind disposable request identity to conflicting meaning");
    let conflict = restarted_owner.run().await.expect("conflict is typed");
    assert_eq!(
        conflict.disposition,
        DevelopComposerOperationDispositionV2::Conflict
    );
    assert!(conflict.receipt_identity.is_none());
    assert!(conflict.artifact.is_none());
    assert_owner_row_counts(pool, 1).await;
}

async fn assert_owner_row_counts(pool: &sqlx::PgPool, expected: i64) {
    for &(table, statement) in OWNER_ROW_COUNTS {
        let count = sqlx::query_scalar::<_, i64>(statement)
            .fetch_one(pool)
            .await
            .expect("Composer custody row count");
        assert_eq!(count, expected, "unexpected row count in {table}");
    }
}
