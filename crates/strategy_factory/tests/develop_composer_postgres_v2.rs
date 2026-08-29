use rstest::rstest;
use sqlx::Row;
#[cfg(feature = "sealed-develop-composer-acceptance")]
use vibe_data::owner::source_binding::BindingDigest;
use vibe_strategy_factory::develop_composer_postgres_v2::PostgresDevelopComposerStoreV2;
#[cfg(feature = "sealed-develop-composer-acceptance")]
use vibe_strategy_factory::{
    develop_composer_operation_v2::DevelopComposerOperationDispositionV2,
    develop_composer_postgres_v2::{
        DevelopComposerSealedReadErrorV2, DevelopComposerSealedReadLocatorV2,
        DevelopComposerSealedReadPortV2, SealedDevelopComposerAcceptanceReadPortV2,
    },
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
    assert!(source.contains("pub trait DevelopComposerSealedReadPortV2"));
    assert!(source.contains("sealed_read_port::RdOwned"));
    assert!(source.contains("pub struct SealedDevelopComposerReadbackV2"));
    assert!(!source.contains("impl Serialize for SealedDevelopComposerReadbackV2"));
    assert!(!source.contains("impl<'de> Deserialize<'de> for SealedDevelopComposerReadbackV2"));
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

#[cfg(feature = "sealed-develop-composer-acceptance")]
#[tokio::test]
#[ignore = "requires an admitted disposable RD_OWNER_TEST_DATABASE_URL and local Rust toolchain"]
async fn sealed_read_port_is_restart_exact_fail_closed_and_query_only() {
    let database = DedicatedPostgresTestDatabase::admit("RD_OWNER_TEST_DATABASE_URL")
        .await
        .expect("dedicated local PostgreSQL admission");
    let mutation = database.mutation();
    let reader = SealedDevelopComposerAcceptanceReadPortV2::connect(database.database_url())
        .await
        .expect("sealed Composer read port");
    let unknown = DevelopComposerSealedReadLocatorV2 {
        schema_version: 2,
        request_identity: "unknown-composer-operation".to_owned(),
        operation_receipt_identity: BindingDigest::from_untrusted_bytes([0x11; 32]),
        artifact_locator: "unknown-artifact".to_owned(),
        artifact_identity: BindingDigest::from_untrusted_bytes([0x12; 32]),
        canonical_plan_digest: BindingDigest::from_untrusted_bytes([0x13; 32]),
        design_digest: BindingDigest::from_untrusted_bytes([0x14; 32]),
    };
    assert_eq!(
        reader.read_accepted(&unknown).await,
        Err(DevelopComposerSealedReadErrorV2::Unavailable)
    );
    assert_eq!(custody_counts(mutation.pool()).await, [0; 9]);

    let owner = SealedDevelopComposerAcceptanceV2::connect(database.database_url())
        .await
        .expect("sealed Composer owner");
    let run = owner.run().await.expect("sealed Composer RUN");
    let locator = DevelopComposerSealedReadLocatorV2::from_accepted_response(&run)
        .expect("positive response locator");
    let before_reads = custody_counts(mutation.pool()).await;
    let first = reader
        .read_accepted(&locator)
        .await
        .expect("positive sealed readback");
    assert!(!first.design_bytes().is_empty());
    assert!(!first.plan_bytes().is_empty());
    assert!(!first.artifact_package_bytes().is_empty());
    assert!(first.module_bytes().all(|bytes| !bytes.is_empty()));
    assert!(first.build_receipt_bytes().all(|bytes| !bytes.is_empty()));
    assert!(!first.composer_receipt_bytes().is_empty());
    assert!(!first.host_receipt_bytes().is_empty());

    drop(reader);
    let restarted = SealedDevelopComposerAcceptanceReadPortV2::connect(database.database_url())
        .await
        .expect("restarted sealed Composer read port");
    let restarted_read = restarted
        .read_accepted(&locator)
        .await
        .expect("restarted positive sealed readback");
    assert_eq!(restarted_read, first);

    let mut mismatched = locator.clone();
    mismatched.canonical_plan_digest = BindingDigest::from_untrusted_bytes([0xf1; 32]);
    assert_eq!(
        restarted.read_accepted(&mismatched).await,
        Err(DevelopComposerSealedReadErrorV2::Unavailable)
    );
    let mut cross_spliced = locator.clone();
    cross_spliced.operation_receipt_identity = BindingDigest::from_untrusted_bytes([0xf2; 32]);
    assert_eq!(
        restarted.read_accepted(&cross_spliced).await,
        Err(DevelopComposerSealedReadErrorV2::Unavailable)
    );
    assert_eq!(
        restarted.read_accepted(&unknown).await,
        Err(DevelopComposerSealedReadErrorV2::Unavailable)
    );

    let (read_a, read_b, read_c, read_d) = tokio::join!(
        restarted.read_accepted(&locator),
        restarted.read_accepted(&locator),
        restarted.read_accepted(&locator),
        restarted.read_accepted(&locator),
    );

    for read in [read_a, read_b, read_c, read_d] {
        assert_eq!(read.expect("concurrent sealed read"), first);
    }
    assert_eq!(custody_counts(mutation.pool()).await, before_reads);

    let mut in_flight_corruption = mutation
        .pool()
        .begin()
        .await
        .expect("in-flight corruption transaction");
    corrupt_plan_bytes(&mut in_flight_corruption, locator.canonical_plan_digest).await;
    assert!(
        tokio::time::timeout(
            std::time::Duration::from_millis(100),
            restarted.read_accepted(&locator),
        )
        .await
        .is_err(),
        "sealed read must wait rather than seal across in-flight corruption",
    );
    in_flight_corruption
        .rollback()
        .await
        .expect("rollback in-flight corruption");
    assert_eq!(
        restarted
            .read_accepted(&locator)
            .await
            .expect("read after corruption rollback"),
        first
    );

    sqlx::query(
        "UPDATE rd_develop_plans_v2
            SET canonical_bytes=set_byte(canonical_bytes, 0, get_byte(canonical_bytes, 0) # 1)
          WHERE plan_digest=$1",
    )
    .bind(locator.canonical_plan_digest.as_bytes().as_slice())
    .execute(mutation.pool())
    .await
    .expect("corrupt dedicated Plan bytes");
    assert_eq!(
        restarted.read_accepted(&locator).await,
        Err(DevelopComposerSealedReadErrorV2::Unavailable)
    );
    assert_eq!(custody_counts(mutation.pool()).await, before_reads);
}

#[cfg(feature = "sealed-develop-composer-acceptance")]
async fn corrupt_plan_bytes(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    plan_digest: BindingDigest,
) {
    sqlx::query(
        "UPDATE rd_develop_plans_v2
            SET canonical_bytes=set_byte(canonical_bytes, 0, get_byte(canonical_bytes, 0) # 1)
          WHERE plan_digest=$1",
    )
    .bind(plan_digest.as_bytes().as_slice())
    .execute(&mut **transaction)
    .await
    .expect("corrupt dedicated Plan bytes in transaction");
}

#[cfg(feature = "sealed-develop-composer-acceptance")]
async fn custody_counts(pool: &sqlx::PgPool) -> [i64; 9] {
    let row = sqlx::query(
        "SELECT
           (SELECT count(*) FROM rd_develop_designs_v2) AS designs,
           (SELECT count(*) FROM rd_develop_plans_v2) AS plans,
           (SELECT count(*) FROM rd_develop_artifacts_v2) AS artifacts,
           (SELECT count(*) FROM rd_develop_artifact_modules_v2) AS modules,
           (SELECT count(*) FROM rd_develop_build_receipts_v2) AS build_receipts,
           (SELECT count(*) FROM rd_develop_composer_receipts_v2) AS composer_receipts,
           (SELECT count(*) FROM rd_develop_host_receipts_v2) AS host_receipts,
           (SELECT count(*) FROM rd_develop_operations_v2) AS operations,
           (SELECT count(*) FROM rd_develop_outbox_v2) AS outbox",
    )
    .fetch_one(pool)
    .await
    .expect("Composer custody counts");
    [
        row.get("designs"),
        row.get("plans"),
        row.get("artifacts"),
        row.get("modules"),
        row.get("build_receipts"),
        row.get("composer_receipts"),
        row.get("host_receipts"),
        row.get("operations"),
        row.get("outbox"),
    ]
}
