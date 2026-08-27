use rstest::rstest;
use vibe_deployment_store_admission::{
    AdmittedMarketDataSnapshotPort, MarketDataPitTerminalStorageEvidence, PostgresCredentialLease,
    PostgresDirectMeasurer, PostgresMeasurementSpec,
};
use vibe_testkit::postgres::{CanonicalOwnerPostgresTestDatabaseV1, CanonicalOwnerTestRoleV1};

#[rstest]
fn pit_terminal_port_and_raw_evidence_are_thread_safe_without_business_decoding() {
    fn assert_send_sync<T: Send + Sync>() {}

    assert_send_sync::<AdmittedMarketDataSnapshotPort>();
    assert_send_sync::<MarketDataPitTerminalStorageEvidence>();
}

#[tokio::test]
#[ignore = "requires the pinned disposable canonical PostgreSQL topology"]
async fn directly_remeasures_pinned_disposable_postgres_without_secret_disclosure() {
    let database = CanonicalOwnerPostgresTestDatabaseV1::admit().await.unwrap();
    let lease = PostgresCredentialLease::from_resolved_secret(
        "deployment-store-test-handle",
        "STRATEGY_FACTORY_RD_OWNER_API_V1",
        "test-v1",
        u64::MAX,
        database
            .database_url(CanonicalOwnerTestRoleV1::RdOwner)
            .to_string(),
    )
    .unwrap();
    let spec = PostgresMeasurementSpec::new(
        "deployment_store_test",
        "deployment_store_test.schema_migrations_v1",
        vec!["deployment_store_test.resolve_v1()".to_string()],
        vec!["deployment_store_test.schema_migrations_v1".to_string()],
    )
    .unwrap();
    let measurer = PostgresDirectMeasurer;

    let first = measurer.measure(&lease, &spec).await.unwrap();
    let after_cache_loss = measurer.measure(&lease, &spec).await.unwrap();

    assert_eq!(first, after_cache_loss);
    assert!(
        first
            .endpoint_identity()
            .starts_with("postgresql-requested://127.0.0.1:")
    );
    assert!(first.server_identity().contains(":server:160004@"));
    assert!(
        first
            .database_identity()
            .starts_with("postgres-database:vibe_test_")
    );
    assert!(!first.role_identity().is_empty());
    let serialized = serde_json::to_string(&first).unwrap();
    assert!(!serialized.contains("password"));
    assert!(!serialized.contains("secret"));
    assert!(!format!("{lease:?}").contains("password"));

    let mutation = database.mutation();
    sqlx::query(
        "INSERT INTO deployment_store_test.schema_migrations_v1(version, checksum) VALUES ($1, $2)",
    )
    .bind("review-drift-v1")
    .bind("sha256:test-only")
    .execute(mutation.pool(CanonicalOwnerTestRoleV1::RdOwner))
    .await
    .unwrap();
    let after_migration_row = measurer.measure(&lease, &spec).await.unwrap();
    assert_ne!(after_cache_loss, after_migration_row);
    assert_eq!(
        after_migration_row,
        measurer.measure(&lease, &spec).await.unwrap()
    );

    sqlx::query("ALTER TABLE deployment_store_test.schema_migrations_v1 ENABLE ROW LEVEL SECURITY")
        .execute(mutation.pool(CanonicalOwnerTestRoleV1::RdOwner))
        .await
        .unwrap();
    let after_rls_change = measurer.measure(&lease, &spec).await.unwrap();
    assert_ne!(after_migration_row, after_rls_change);
}
