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
        "composer_private.rd_develop_designs_v2",
        "SELECT count(*) FROM composer_private.rd_develop_designs_v2",
    ),
    (
        "composer_private.rd_develop_plans_v2",
        "SELECT count(*) FROM composer_private.rd_develop_plans_v2",
    ),
    (
        "composer_private.rd_develop_artifacts_v2",
        "SELECT count(*) FROM composer_private.rd_develop_artifacts_v2",
    ),
    (
        "composer_private.rd_develop_artifact_modules_v2",
        "SELECT count(*) FROM composer_private.rd_develop_artifact_modules_v2",
    ),
    (
        "composer_private.rd_develop_build_receipts_v2",
        "SELECT count(*) FROM composer_private.rd_develop_build_receipts_v2",
    ),
    (
        "composer_private.rd_develop_artifact_build_receipt_uses_v2",
        "SELECT count(*) FROM composer_private.rd_develop_artifact_build_receipt_uses_v2",
    ),
    (
        "composer_private.rd_develop_composer_receipts_v2",
        "SELECT count(*) FROM composer_private.rd_develop_composer_receipts_v2",
    ),
    (
        "composer_private.rd_develop_host_receipts_v2",
        "SELECT count(*) FROM composer_private.rd_develop_host_receipts_v2",
    ),
    (
        "composer_private.rd_develop_operations_v2",
        "SELECT count(*) FROM composer_private.rd_develop_operations_v2",
    ),
    (
        "composer_private.rd_develop_outbox_v2",
        "SELECT count(*) FROM composer_private.rd_develop_outbox_v2",
    ),
];

#[tokio::test]
#[ignore = "requires the admitted disposable R&D Owner PostgreSQL topology and local Rust toolchain"]
async fn durable_owner_is_atomic_restart_exact_and_fail_closed() {
    let database = CanonicalOwnerPostgresTestDatabaseV1::admit()
        .await
        .expect("canonical disposable Owner topology");
    let database_url = database.database_url(CanonicalOwnerTestRoleV1::RdFactWriter);
    let mutation = database.mutation();
    let rd_pool = mutation.pool(CanonicalOwnerTestRoleV1::RdOwner);
    let reader_pool = mutation.pool(CanonicalOwnerTestRoleV1::MarketDataReader);
    let market_pool = mutation.pool(CanonicalOwnerTestRoleV1::MarketDataOwner);
    let writer_pool = mutation.pool(CanonicalOwnerTestRoleV1::RdFactWriter);
    let pool = database.owner_topology_admin_pool();

    let mut reader_cut = reader_pool.begin().await.expect("reader transaction");
    let reader_backend: i64 =
        sqlx::query_scalar("SELECT composer_owner_api.lock_replay_composition_cut_v1($1)")
            .bind(SEALED_DEVELOP_COMPOSER_REQUEST_IDENTITY_V2)
            .fetch_one(&mut *reader_cut)
            .await
            .expect("reader shared Composer cut");
    let mut market_cut = market_pool.begin().await.expect("Market owner transaction");
    let market_backend: i64 =
        sqlx::query_scalar("SELECT composer_owner_api.lock_replay_composition_cut_v1($1)")
            .bind(SEALED_DEVELOP_COMPOSER_REQUEST_IDENTITY_V2)
            .fetch_one(&mut *market_cut)
            .await
            .expect("Market owner shared Composer cut handoff");
    assert_ne!(reader_backend, market_backend);
    let mut writer_cut = writer_pool.begin().await.expect("writer probe transaction");
    let writer_key_available: bool = sqlx::query_scalar(
        "SELECT pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('rd.develop.composer.commit.v2:'||$1,0))",
    )
    .bind(SEALED_DEVELOP_COMPOSER_REQUEST_IDENTITY_V2)
    .fetch_one(&mut *writer_cut)
    .await
    .expect("writer-key probe");
    assert!(!writer_key_available);
    reader_cut
        .rollback()
        .await
        .expect("forced reader disconnect");
    let writer_key_available_after_reader: bool = sqlx::query_scalar(
        "SELECT pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('rd.develop.composer.commit.v2:'||$1,0))",
    )
    .bind(SEALED_DEVELOP_COMPOSER_REQUEST_IDENTITY_V2)
    .fetch_one(&mut *writer_cut)
    .await
    .expect("writer-key probe after reader terminal");
    assert!(!writer_key_available_after_reader);
    market_cut.rollback().await.expect("Market terminal");
    let writer_key_available_after_market: bool = sqlx::query_scalar(
        "SELECT pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('rd.develop.composer.commit.v2:'||$1,0))",
    )
    .bind(SEALED_DEVELOP_COMPOSER_REQUEST_IDENTITY_V2)
    .fetch_one(&mut *writer_cut)
    .await
    .expect("writer-key probe after Market terminal");
    assert!(writer_key_available_after_market);
    writer_cut.rollback().await.expect("release writer probe");

    let owner = SealedDevelopComposerAcceptanceV2::connect(database_url)
        .await
        .expect("sealed Composer owner");
    let raw_error = sqlx::query("SELECT 1 FROM composer_private.rd_develop_operations_v2")
        .execute(rd_pool)
        .await
        .expect_err("rd_owner must not read private Composer tables");
    assert_eq!(
        raw_error.as_database_error().and_then(|e| e.code()),
        Some(std::borrow::Cow::Borrowed("42501"))
    );
    sqlx::query(
        "TRUNCATE TABLE
           composer_private.rd_develop_outbox_v2,
           composer_private.rd_develop_operations_v2,
           composer_private.rd_develop_host_receipts_v2,
           composer_private.rd_develop_composer_receipts_v2,
           composer_private.rd_develop_artifact_build_receipt_uses_v2,
           composer_private.rd_develop_build_receipts_v2,
           composer_private.rd_develop_artifact_modules_v2,
           composer_private.rd_develop_artifacts_v2,
           composer_private.rd_develop_plans_v2,
           composer_private.rd_develop_designs_v2",
    )
    .execute(pool)
    .await
    .expect("clear only disposable Composer custody");

    sqlx::query(
        "CREATE OR REPLACE FUNCTION composer_private.rd_develop_reject_commit_v2()
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
         AFTER INSERT ON composer_private.rd_develop_outbox_v2
         DEFERRABLE INITIALLY DEFERRED
         FOR EACH ROW EXECUTE FUNCTION composer_private.rd_develop_reject_commit_v2()",
    )
    .execute(pool)
    .await
    .expect("arm deferred commit failure");

    let failed_commit = owner.run().await.expect("topology drift is typed");
    assert_eq!(
        failed_commit.disposition,
        DevelopComposerOperationDispositionV2::Unavailable
    );
    assert!(failed_commit.receipt_identity.is_none());
    assert!(failed_commit.artifact.is_none());
    assert_owner_row_counts(pool, 0).await;

    sqlx::query(
        "DROP TRIGGER rd_develop_reject_commit_v2 ON composer_private.rd_develop_outbox_v2",
    )
    .execute(pool)
    .await
    .expect("disarm deferred commit failure");
    sqlx::query("DROP FUNCTION composer_private.rd_develop_reject_commit_v2()")
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
           FROM composer_private.rd_develop_operations_v2
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
           FROM composer_private.rd_develop_outbox_v2
          WHERE request_identity=$1",
    )
    .bind(SEALED_DEVELOP_COMPOSER_REQUEST_IDENTITY_V2)
    .fetch_one(pool)
    .await
    .expect("stored outbox bytes");
    sqlx::query("DELETE FROM composer_private.rd_develop_outbox_v2 WHERE request_identity=$1")
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
        "INSERT INTO composer_private.rd_develop_outbox_v2 (request_identity, canonical_bytes)
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
           FROM composer_private.rd_develop_designs_v2",
    )
    .fetch_one(pool)
    .await
    .expect("stored Design bytes");
    let design_identity: Vec<u8> = design.get("design_identity");
    let original_design_bytes: Vec<u8> = design.get("canonical_bytes");
    let mut corrupt_design_bytes = original_design_bytes.clone();
    corrupt_design_bytes[0] ^= 1;
    sqlx::query(
        "UPDATE composer_private.rd_develop_designs_v2
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
        "UPDATE composer_private.rd_develop_designs_v2
            SET canonical_bytes=$1
          WHERE design_identity=$2",
    )
    .bind(&original_design_bytes)
    .bind(&design_identity)
    .execute(pool)
    .await
    .expect("restore disposable Design bytes");

    sqlx::query(
        "UPDATE composer_private.rd_develop_operations_v2
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
