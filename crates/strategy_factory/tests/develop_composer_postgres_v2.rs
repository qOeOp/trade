use rstest::rstest;
use sqlx::Row;
use vibe_strategy_factory::develop_composer_postgres_v2::PostgresDevelopComposerStoreV2;
#[cfg(feature = "sealed-develop-composer-acceptance")]
use vibe_strategy_factory::{
    develop_composer_operation_v2::DevelopComposerOperationDispositionV2,
    develop_composer_sealed_acceptance_v2::{
        SEALED_DEVELOP_COMPOSER_REQUEST_IDENTITY_V2, SealedDevelopComposerAcceptanceV2,
    },
};
use vibe_testkit::postgres::DedicatedPostgresTestDatabase;

#[rstest]
fn postgres_contract_uses_one_advisory_lock_private_bytea_and_no_json_authority() {
    let source = include_str!("../src/develop_composer_postgres_v2.rs");
    assert!(source.contains("pg_advisory_xact_lock"));
    assert!(source.contains("10:rd.develop.research.v2"));
    assert!(source.contains("20:rd.develop.intent.v2"));
    assert!(source.contains("30:rd.develop.design.v2"));
    assert!(source.contains("40:rd.develop.build-attempt.v2"));
    assert!(source.contains("50:rd.develop.capsule.v2"));
    assert!(source.contains("60:rd.develop.artifact.v2"));
    assert!(source.contains("is_unique_violation"));
    assert!(source.contains("build_attempt_identity BYTEA NOT NULL UNIQUE"));
    assert!(source.contains("capsule_identity BYTEA NOT NULL UNIQUE"));
    assert!(source.contains("canonical_bytes BYTEA NOT NULL"));
    assert!(source.contains("module_bytes BYTEA NOT NULL"));
    assert!(source.contains("REVOKE ALL ON TABLE"));
    assert!(!source.contains("JSONB"));
    assert!(!source.contains("serde_json"));
    assert!(source.contains("current Owner evidence is unavailable for public durable RESOLVE"));
    let durable_resolve = source
        .split("pub(crate) async fn resolve_with_evidence")
        .nth(1)
        .expect("Owner-internal durable RESOLVE");
    assert!(
        durable_resolve.find("load_record(").expect("stored read")
            < durable_resolve
                .find("resolve_loaded_record_with_evidence(")
                .expect("current-evidence readmission")
    );
    let loaded_resolve = source
        .split("pub(crate) fn resolve_loaded_record_with_evidence")
        .nth(1)
        .expect("loaded-record readmission");
    assert!(
        loaded_resolve
            .find("lock_and_reread_durable(")
            .expect("current Owner reread")
            < loaded_resolve
                .find("resolve_positive_record_v2(")
                .expect("durable readmission")
    );
    assert!(
        source
            .find("preflight_develop_composer_v2(evidence")
            .expect("preflight call")
            < source
                .find("build_positive_record_from_preflight_v2(")
                .expect("A0 call after preflight")
    );

    for table in [
        "rd_develop_designs_v2",
        "rd_develop_plans_v2",
        "rd_develop_artifacts_v2",
        "rd_develop_artifact_modules_v2",
        "rd_develop_build_receipts_v2",
        "rd_develop_composer_receipts_v2",
        "rd_develop_host_receipts_v2",
        "rd_develop_operations_v2",
        "rd_develop_outbox_v2",
    ] {
        assert!(source.contains(table));
    }
}

#[tokio::test]
#[ignore = "requires an admitted disposable RD_OWNER_TEST_DATABASE_URL"]
async fn postgres_migration_materializes_only_private_binary_authority() {
    let database = DedicatedPostgresTestDatabase::admit("RD_OWNER_TEST_DATABASE_URL")
        .await
        .expect("dedicated local PostgreSQL admission");
    let mutation = database.mutation();
    PostgresDevelopComposerStoreV2::migrate(mutation.pool())
        .await
        .expect("Composer migration");
    let rows = sqlx::query(
        "SELECT table_name, data_type
           FROM information_schema.columns
          WHERE table_schema='public'
            AND table_name LIKE 'rd_develop_%_v2'
            AND column_name IN ('canonical_bytes','module_bytes','package_bytes','canonical_receipt_bytes','response_bytes')
          ORDER BY table_name, column_name",
    )
    .fetch_all(mutation.pool())
    .await
    .expect("migration readback");
    assert!(!rows.is_empty());
    assert!(
        rows.iter()
            .all(|row| row.get::<String, _>("data_type") == "bytea")
    );
}

#[cfg(feature = "sealed-develop-composer-acceptance")]
#[tokio::test]
#[ignore = "requires an admitted disposable RD_OWNER_TEST_DATABASE_URL and local Rust toolchain"]
async fn sealed_run_and_restarted_resolve_return_the_same_public_receipt() {
    let database = DedicatedPostgresTestDatabase::admit("RD_OWNER_TEST_DATABASE_URL")
        .await
        .expect("dedicated local PostgreSQL admission");
    let first_owner = SealedDevelopComposerAcceptanceV2::connect(database.database_url())
        .await
        .expect("first sealed Composer owner");
    let run = first_owner.run().await.expect("sealed Composer RUN");
    assert_eq!(
        run.disposition,
        DevelopComposerOperationDispositionV2::Success
    );
    assert_eq!(
        run.request_identity,
        SEALED_DEVELOP_COMPOSER_REQUEST_IDENTITY_V2
    );
    assert!(run.receipt_identity.is_some());
    assert!(run.artifact.is_some());

    drop(first_owner);
    let restarted_owner = SealedDevelopComposerAcceptanceV2::connect(database.database_url())
        .await
        .expect("restarted sealed Composer owner");
    let resolved = restarted_owner
        .resolve(SEALED_DEVELOP_COMPOSER_REQUEST_IDENTITY_V2)
        .await
        .expect("restarted durable RESOLVE");
    assert_eq!(resolved, run);
}
