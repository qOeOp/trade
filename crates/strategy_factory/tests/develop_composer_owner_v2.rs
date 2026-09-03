#![cfg(feature = "sealed-develop-composer-acceptance")]

use sqlx::Row;
use vibe_strategy_factory::{
    develop_composer_operation_v2::DevelopComposerOperationDispositionV2,
    develop_composer_sealed_acceptance_v2::{
        SEALED_DEVELOP_COMPOSER_REQUEST_IDENTITY_V2, SealedDevelopComposerAcceptanceV2,
    },
};
use vibe_testkit::postgres::{
    CanonicalOwnerPostgresTestDatabaseV1, CanonicalOwnerTestRoleV1, ProtectedOwnerTestAuthorityV1,
    ProtectedOwnerTestRoleV1,
};

const ACCEPTANCE_COMMIT_FAULT_OPTION: &str =
    "-cvibe.develop_composer_acceptance_commit_fault=post_write_disconnect";

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
    let authority = composer_authority(&database).await;
    truncate_owner_custody(authority.pool()).await;

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
    .execute(authority.pool())
    .await
    .expect("install disposable deferred failure");
    sqlx::query(
        "CREATE CONSTRAINT TRIGGER rd_develop_reject_commit_v2
         AFTER INSERT ON composer_private.rd_develop_outbox_v2
         DEFERRABLE INITIALLY DEFERRED
         FOR EACH ROW EXECUTE FUNCTION composer_private.rd_develop_reject_commit_v2()",
    )
    .execute(authority.pool())
    .await
    .expect("arm deferred commit failure");
    authority
        .release()
        .await
        .expect("release Composer fault setup authority");

    let failed_commit = owner.run().await.expect("topology drift is typed");
    assert_eq!(
        failed_commit.disposition,
        DevelopComposerOperationDispositionV2::Unavailable
    );
    assert!(failed_commit.receipt_identity.is_none());
    assert!(failed_commit.artifact.is_none());
    assert_owner_row_counts(&database, 0).await;

    let authority = composer_authority(&database).await;
    sqlx::query(
        "DROP TRIGGER rd_develop_reject_commit_v2 ON composer_private.rd_develop_outbox_v2",
    )
    .execute(authority.pool())
    .await
    .expect("disarm deferred commit failure");
    sqlx::query("DROP FUNCTION composer_private.rd_develop_reject_commit_v2()")
        .execute(authority.pool())
        .await
        .expect("remove deferred failure function");
    authority
        .release()
        .await
        .expect("release Composer fault cleanup authority");
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
    assert_owner_row_counts(&database, 1).await;

    let authority = composer_authority(&database).await;
    let stored_response = sqlx::query_scalar::<_, Vec<u8>>(
        "SELECT response_bytes
           FROM composer_private.rd_develop_operations_v2
          WHERE request_identity=$1",
    )
    .bind(SEALED_DEVELOP_COMPOSER_REQUEST_IDENTITY_V2)
    .fetch_one(authority.pool())
    .await
    .expect("stored canonical response bytes");
    authority
        .release()
        .await
        .expect("release Composer response readback authority");
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
    assert_owner_row_counts(&database, 1).await;

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

    let authority = composer_authority(&database).await;
    let outbox_bytes = sqlx::query_scalar::<_, Vec<u8>>(
        "SELECT canonical_bytes
           FROM composer_private.rd_develop_outbox_v2
          WHERE request_identity=$1",
    )
    .bind(SEALED_DEVELOP_COMPOSER_REQUEST_IDENTITY_V2)
    .fetch_one(authority.pool())
    .await
    .expect("stored outbox bytes");
    sqlx::query("DELETE FROM composer_private.rd_develop_outbox_v2 WHERE request_identity=$1")
        .bind(SEALED_DEVELOP_COMPOSER_REQUEST_IDENTITY_V2)
        .execute(authority.pool())
        .await
        .expect("remove only disposable outbox custody");
    authority
        .release()
        .await
        .expect("release Composer incomplete-custody authority");
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
    let authority = composer_authority(&database).await;
    sqlx::query(
        "INSERT INTO composer_private.rd_develop_outbox_v2 (request_identity, canonical_bytes)
         VALUES ($1,$2)",
    )
    .bind(SEALED_DEVELOP_COMPOSER_REQUEST_IDENTITY_V2)
    .bind(&outbox_bytes)
    .execute(authority.pool())
    .await
    .expect("restore disposable outbox custody");
    authority
        .release()
        .await
        .expect("release Composer outbox restore authority");
    let restored = restarted_owner
        .resolve(SEALED_DEVELOP_COMPOSER_REQUEST_IDENTITY_V2)
        .await
        .expect("restored custody RESOLVE");
    assert_eq!(restored.canonical_bytes(), stored_response);
    assert_owner_row_counts(&database, 1).await;

    let authority = composer_authority(&database).await;
    let design = sqlx::query(
        "SELECT design_identity, canonical_bytes
           FROM composer_private.rd_develop_designs_v2",
    )
    .fetch_one(authority.pool())
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
    .execute(authority.pool())
    .await
    .expect("corrupt only disposable Design bytes");
    authority
        .release()
        .await
        .expect("release Composer corruption authority");
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
    let authority = composer_authority(&database).await;
    sqlx::query(
        "UPDATE composer_private.rd_develop_designs_v2
            SET canonical_bytes=$1
          WHERE design_identity=$2",
    )
    .bind(&original_design_bytes)
    .bind(&design_identity)
    .execute(authority.pool())
    .await
    .expect("restore disposable Design bytes");

    sqlx::query(
        "UPDATE composer_private.rd_develop_operations_v2
            SET request_digest=decode(repeat('ff', 32), 'hex')
          WHERE request_identity=$1",
    )
    .bind(SEALED_DEVELOP_COMPOSER_REQUEST_IDENTITY_V2)
    .execute(authority.pool())
    .await
    .expect("bind disposable request identity to conflicting meaning");
    authority
        .release()
        .await
        .expect("release Composer restore authority");
    let conflict = restarted_owner.run().await.expect("conflict is typed");
    assert_eq!(
        conflict.disposition,
        DevelopComposerOperationDispositionV2::Conflict
    );
    assert!(conflict.receipt_identity.is_none());
    assert!(conflict.artifact.is_none());
    assert_owner_row_counts(&database, 1).await;
}

#[tokio::test]
#[ignore = "requires the admitted disposable R&D Owner PostgreSQL topology and local Rust toolchain"]
async fn durable_owner_post_write_commit_fault_is_submitted_or_unknown_and_recoverable() {
    let database = CanonicalOwnerPostgresTestDatabaseV1::admit()
        .await
        .expect("canonical disposable Owner topology");
    let rd_owner_database_url = database.database_url(CanonicalOwnerTestRoleV1::RdOwner);
    let writer_database_url = database.database_url(CanonicalOwnerTestRoleV1::RdFactWriter);
    let mutation = database.mutation();
    let rd_pool = mutation.pool(CanonicalOwnerTestRoleV1::RdOwner);
    let fingerprint_before = composer_database_fingerprint(rd_pool).await;

    let authority = composer_authority(&database).await;
    truncate_owner_custody(authority.pool()).await;
    authority
        .release()
        .await
        .expect("release Composer initial cleanup authority");
    let fault_database_url =
        database_url_with_options(writer_database_url, ACCEPTANCE_COMMIT_FAULT_OPTION);
    let probe = sqlx::postgres::PgPoolOptions::new()
        .max_connections(1)
        .connect(&fault_database_url)
        .await
        .expect("fault-selector probe connection");
    let (selector, timeout_setting): (Option<String>, Option<String>) = sqlx::query_as(
        "SELECT pg_catalog.current_setting(
                   'vibe.develop_composer_acceptance_commit_fault', true
                ),
                pg_catalog.current_setting('idle_in_transaction_session_timeout', true)",
    )
    .fetch_one(&probe)
    .await
    .expect("PostgreSQL commit-fault settings");
    probe.close().await;

    let faulting_owner = SealedDevelopComposerAcceptanceV2::connect_with_writer(
        rd_owner_database_url,
        &fault_database_url,
    )
    .await
    .expect("fault-selected sealed Composer owner");
    let failed_commit = faulting_owner.run().await.expect("commit failure is typed");
    let fault_row_counts = owner_row_counts(&database).await;
    drop(faulting_owner);

    let recovering_owner = SealedDevelopComposerAcceptanceV2::connect_with_writer(
        rd_owner_database_url,
        writer_database_url,
    )
    .await
    .expect("recovering sealed Composer owner");
    let unresolved_after_fault = recovering_owner
        .resolve(SEALED_DEVELOP_COMPOSER_REQUEST_IDENTITY_V2)
        .await
        .expect("same-identity recovery RESOLVE after commit fault");
    let recovered = recovering_owner
        .run()
        .await
        .expect("same-identity recovery RUN");
    let resolved = recovering_owner
        .resolve(SEALED_DEVELOP_COMPOSER_REQUEST_IDENTITY_V2)
        .await
        .expect("same-identity committed RESOLVE");
    let recovered_row_counts = owner_row_counts(&database).await;
    drop(recovering_owner);

    let authority = composer_authority(&database).await;
    truncate_owner_custody(authority.pool()).await;
    let cleanup_row_counts = owner_row_counts_with_pool(authority.pool()).await;
    authority
        .release()
        .await
        .expect("release Composer final cleanup authority");
    let fingerprint_after_cleanup = composer_database_fingerprint(rd_pool).await;

    assert_eq!(selector.as_deref(), Some("post_write_disconnect"));
    assert!(timeout_setting.is_some());
    assert_eq!(
        failed_commit.disposition,
        DevelopComposerOperationDispositionV2::SubmittedOrUnknown
    );
    assert!(failed_commit.receipt_identity.is_none());
    assert!(failed_commit.artifact.is_none());
    assert_eq!(failed_commit.coordinate.as_deref(), Some("storage.commit"));
    assert_eq!(fault_row_counts, vec![0; OWNER_ROW_COUNTS.len()]);
    assert_eq!(
        unresolved_after_fault.disposition,
        DevelopComposerOperationDispositionV2::Unavailable
    );
    assert!(unresolved_after_fault.receipt_identity.is_none());
    assert!(unresolved_after_fault.artifact.is_none());
    assert_eq!(
        recovered.disposition,
        DevelopComposerOperationDispositionV2::Success
    );
    assert_eq!(resolved.canonical_bytes(), recovered.canonical_bytes());
    assert_eq!(recovered_row_counts, vec![1; OWNER_ROW_COUNTS.len()]);
    assert_eq!(cleanup_row_counts, vec![0; OWNER_ROW_COUNTS.len()]);
    assert_eq!(fingerprint_after_cleanup, fingerprint_before);
}

fn database_url_with_options(database_url: &str, options: &str) -> String {
    let separator = if database_url.contains('?') { '&' } else { '?' };
    format!("{database_url}{separator}options={options}")
}

async fn truncate_owner_custody(pool: &sqlx::PgPool) {
    sqlx::query(
        "TRUNCATE TABLE
           composer_private.rd_develop_outbox_v2,
           composer_private.rd_develop_operations_v2,
           composer_private.rd_develop_host_receipts_v2,
           composer_private.rd_develop_composer_receipts_v2,
           composer_private.rd_develop_build_receipts_v2,
           composer_private.rd_develop_artifact_modules_v2,
           composer_private.rd_develop_artifacts_v2,
           composer_private.rd_develop_plans_v2,
           composer_private.rd_develop_designs_v2",
    )
    .execute(pool)
    .await
    .expect("clear only disposable Composer custody");
}

async fn composer_authority(
    database: &CanonicalOwnerPostgresTestDatabaseV1,
) -> ProtectedOwnerTestAuthorityV1 {
    database
        .acquire_protected_owner_test_authority(ProtectedOwnerTestRoleV1::ComposerOwner)
        .await
        .expect("bounded Composer test authority")
}

async fn owner_row_counts(database: &CanonicalOwnerPostgresTestDatabaseV1) -> Vec<i64> {
    let authority = composer_authority(database).await;
    let counts = owner_row_counts_with_pool(authority.pool()).await;
    authority
        .release()
        .await
        .expect("release Composer row-count authority");
    counts
}

async fn owner_row_counts_with_pool(pool: &sqlx::PgPool) -> Vec<i64> {
    let mut counts = Vec::with_capacity(OWNER_ROW_COUNTS.len());
    for &(_, statement) in OWNER_ROW_COUNTS {
        counts.push(
            sqlx::query_scalar::<_, i64>(statement)
                .fetch_one(pool)
                .await
                .expect("Composer custody row count"),
        );
    }
    counts
}

async fn composer_database_fingerprint(pool: &sqlx::PgPool) -> (String, String, i64) {
    sqlx::query_as(
        "SELECT system_identifier, database_name, database_oid
           FROM rd_owner_api.resolve_develop_composer_database_identity_v2()",
    )
    .fetch_one(pool)
    .await
    .expect("Composer database fingerprint")
}

async fn assert_owner_row_counts(database: &CanonicalOwnerPostgresTestDatabaseV1, expected: i64) {
    let authority = composer_authority(database).await;

    for &(table, statement) in OWNER_ROW_COUNTS {
        let count = sqlx::query_scalar::<_, i64>(statement)
            .fetch_one(authority.pool())
            .await
            .expect("Composer custody row count");
        assert_eq!(count, expected, "unexpected row count in {table}");
    }
    authority
        .release()
        .await
        .expect("release Composer count assertion authority");
}
