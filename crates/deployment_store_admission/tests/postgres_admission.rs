use vibe_deployment_store_admission::{
    PostgresCredentialLease, PostgresDirectMeasurer, PostgresMeasurementSpec,
};
use vibe_testkit::postgres::{CanonicalOwnerPostgresTestDatabaseV1, CanonicalOwnerTestRoleV1};

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
        "vibe_test_admin",
        "vibe_test_admin.dedicated_postgres_test_instance_v1",
        vec!["pg_catalog.current_database()".to_string()],
        vec!["vibe_test_admin.dedicated_postgres_test_instance_v1".to_string()],
    )
    .unwrap();
    let measurer = PostgresDirectMeasurer;

    let first = measurer.measure(&lease, &spec).await.unwrap();
    let after_cache_loss = measurer.measure(&lease, &spec).await.unwrap();

    assert_eq!(first, after_cache_loss);
    assert!(first.endpoint_identity().starts_with("postgresql://"));
    assert!(
        first
            .server_identity()
            .starts_with("postgres-server:160004@")
    );
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
}
