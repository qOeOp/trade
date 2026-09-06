use rstest::rstest;
use sqlx::Row;
#[cfg(feature = "sealed-develop-composer-acceptance")]
use vibe_data::owner::source_binding::BindingDigest;
use vibe_strategy_factory::develop_composer_postgres_v2::PostgresDevelopComposerStoreV2;
#[cfg(feature = "sealed-source-intake-composer-acceptance")]
use vibe_strategy_factory::{
    develop_composer_operation_v2::DevelopComposerOperationDispositionV2,
    develop_composer_sealed_acceptance_v2::SEALED_DEVELOP_COMPOSER_REQUEST_IDENTITY_V2,
};
#[cfg(feature = "sealed-develop-composer-acceptance")]
use vibe_strategy_factory::{
    develop_composer_postgres_v2::{
        DevelopComposerSealedReadErrorV2, DevelopComposerSealedReadLocatorV2,
        DevelopComposerSealedReadPortV2, SealedDevelopComposerAcceptanceReadPortV2,
    },
    develop_composer_sealed_acceptance_v2::SealedDevelopComposerAcceptanceV2,
};
use vibe_testkit::postgres::{CanonicalOwnerPostgresTestDatabaseV1, CanonicalOwnerTestRoleV1};

#[rstest]
fn postgres_contract_uses_one_advisory_lock_private_bytea_and_no_json_authority() {
    let source = include_str!("../src/develop_composer_postgres_v2.rs");
    let migration =
        include_str!("../../../product/rd-workbench/postgres-init/10-migrate-authority-custody.sh");
    assert!(source.contains("pg_advisory_xact_lock"));
    assert!(source.contains("10:rd.develop.research.v2"));
    assert!(source.contains("20:rd.develop.intent.v2"));
    assert!(source.contains("30:rd.develop.design.v2"));
    assert!(source.contains("40:rd.develop.build-attempt.v2"));
    assert!(source.contains("50:rd.develop.capsule.v2"));
    assert!(source.contains("60:rd.develop.artifact.v2"));
    assert!(source.contains("is_unique_violation"));
    assert!(migration.contains("build_attempt_identity BYTEA NOT NULL UNIQUE"));
    assert!(migration.contains("capsule_identity BYTEA NOT NULL UNIQUE"));
    assert!(migration.contains("canonical_bytes BYTEA NOT NULL"));
    assert!(migration.contains("module_bytes BYTEA NOT NULL"));
    assert!(migration.contains("attestation_identity BYTEA NOT NULL UNIQUE"));
    assert!(migration.contains("native_join_digest BYTEA NOT NULL UNIQUE"));
    assert!(
        migration.contains("composer_owner_api.resolve_strategy_design_role_set_attestation_v1")
    );
    assert!(migration.contains("composer_owner_api.resolve_strategy_design_native_join_v1"));
    assert!(migration.contains(
        "GRANT USAGE ON SCHEMA composer_owner_api TO rd_owner, rd_fact_writer, market_data_reader"
    ));
    assert!(
        migration.contains(
            "REVOKE ALL ON ALL TABLES IN SCHEMA composer_private FROM market_data_reader"
        )
    );
    let runtime_write = source
        .split("async fn run_inner")
        .nth(1)
        .expect("bounded Composer runtime write path")
        .split("pub(crate) fn resolve_loaded_record_with_evidence")
        .next()
        .expect("bounded Composer runtime write body");
    assert!(!runtime_write.contains("CREATE TABLE IF NOT EXISTS"));
    assert!(migration.contains("REVOKE ALL ON ALL TABLES IN SCHEMA"));
    assert!(!source.contains("JSONB"));
    assert!(!source.contains("serde_json"));
    assert!(source.contains("current Owner evidence is unavailable for public durable RESOLVE"));
    assert!(source.contains("pub(crate) async fn run_with_native_join"));
    assert!(source.contains("pub(crate) async fn resolve_with_native_join"));
    assert!(source.contains("StrategyDesignNativeJoinReceiptV1::from_market_owner"));
    assert!(
        source.contains(
            "StrategyDesignNativeJoinReceiptV1::from_market_owner(&role_set, native_join)"
        )
    );
    assert!(source.contains(
        "FROM composer_owner_api.resolve_strategy_design_native_join_v1($1,$2,$3,$4,$5,$6,$7)"
    ));
    assert!(
        !source.contains("FROM composer_private.rd_develop_strategy_design_native_joins_v1 WHERE")
    );
    assert!(source.contains("pub trait DevelopComposerSealedReadPortV2"));
    let transactional_read = source
        .split("pub(crate) async fn read_accepted_in_transaction")
        .nth(1)
        .expect("Composer transaction-bound sealed read")
        .split("async fn load_record_via_sealed_routine_in_transaction")
        .next()
        .expect("bounded transaction-read body");
    assert!(transactional_read.contains("load_record_via_sealed_routine_in_transaction"));
    assert!(transactional_read.contains("resolve_positive_record_v2"));
    assert!(transactional_read.contains("seal_readback"));
    assert!(!transactional_read.contains(".begin()"));
    assert!(!transactional_read.contains(".commit()"));
    assert!(!transactional_read.contains("PgPool"));
    assert!(migration.contains("SECURITY DEFINER"));
    assert!(migration.contains("SET search_path = pg_catalog, pg_temp"));
    assert!(migration.contains(
        "REVOKE ALL ON FUNCTION composer_owner_api.lock_accepted_develop_composer_v2(text) FROM PUBLIC"
    ));
    assert!(migration.contains(
        "GRANT EXECUTE ON FUNCTION composer_owner_api.lock_accepted_develop_composer_v2(text) TO rd_owner"
    ));
    assert!(source.contains("pg_catalog.pg_has_role(caller_oid, proowner, 'MEMBER')"));
    assert!(source.contains("caller_oid=rd_owner_oid"));
    assert!(source.contains("acl.grantee NOT IN (proowner, rd_owner_oid)"));
    assert!(source.contains("SESSION_USER='rd_fact_writer'"));
    assert!(
        source.contains("NOT pg_catalog.has_function_privilege('rd_fact_writer',oid,'EXECUTE')")
    );
    assert!(
        migration
            .contains("GRANT EXECUTE ON FUNCTION composer_owner_api.commit_develop_composer_v2")
    );
    assert!(!migration.contains(
        "composer_owner_api.lock_accepted_develop_composer_v2(text), composer_owner_api.resolve_strategy_design_role_set_attestation_v1(text,integer,bytea,text,bytea,bytea,bytea), composer_owner_api.resolve_strategy_design_native_join_v1(text,integer,bytea,text,bytea,bytea,bytea) TO rd_fact_writer"
    ));
    assert!(migration.contains(
        "NOT pg_catalog.has_function_privilege('rd_fact_writer','composer_owner_api.lock_accepted_develop_composer_v2(text)','EXECUTE')"
    ));
    assert!(migration.contains(
        "NOT pg_catalog.has_function_privilege('rd_fact_writer','composer_owner_api.resolve_strategy_design_role_set_attestation_v1"
    ));
    assert!(source.contains("rd.develop.composer.commit.v2:"));
    assert!(source.contains("IF FOUND THEN"));
    assert!(source.contains("RETURN EXISTS ("));
    assert!(source.contains("pg_catalog.pg_is_in_recovery()"));
    assert!(source.contains("pg_catalog.pg_postmaster_start_time()"));
    assert!(source.contains("pg_catalog.pg_try_advisory_xact_lock($1)"));
    assert!(source.contains("do not share one lock manager"));
    assert!(source.contains("pg_catalog.has_table_privilege"));
    let pinned_source = source
        .split("const SEALED_READ_FUNCTION_SOURCE_V2: &str = \"")
        .nth(1)
        .expect("pinned Composer routine source")
        .split("\";")
        .next()
        .expect("bounded pinned Composer routine source");
    let installed_source = migration
        .split("AS $composer_read$")
        .nth(1)
        .expect("installed Composer routine source")
        .split("$composer_read$")
        .next()
        .expect("bounded installed Composer routine source");
    assert_eq!(installed_source, pinned_source);
    let pinned_commit_source = source
        .split("const COMMIT_FUNCTION_SOURCE_V2: &str = \"")
        .nth(1)
        .expect("pinned Composer commit routine source")
        .split("\";")
        .next()
        .expect("bounded pinned Composer commit source");
    let installed_commit_source = migration
        .split("AS $composer_commit$")
        .nth(1)
        .expect("installed Composer commit routine source")
        .split("$composer_commit$")
        .next()
        .expect("bounded installed Composer commit source");
    assert_eq!(installed_commit_source, pinned_commit_source);
    let pinned_commit_cut_source = source
        .split("const COMMIT_CUT_FUNCTION_SOURCE_V2: &str = \"")
        .nth(1)
        .expect("pinned Composer commit-cut routine source")
        .split("\";")
        .next()
        .expect("bounded pinned Composer commit-cut source");
    let installed_commit_cut_source = migration
        .split("AS $composer_commit_cut$")
        .nth(1)
        .expect("installed Composer commit-cut routine source")
        .split("$composer_commit_cut$")
        .next()
        .expect("bounded installed Composer commit-cut source");
    assert_eq!(installed_commit_cut_source, pinned_commit_cut_source);
    assert!(!pinned_commit_cut_source.contains("LOCK TABLE"));
    assert!(pinned_commit_cut_source.contains("FOR UPDATE"));
    assert!(pinned_commit_cut_source.contains("FOR SHARE OF"));
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
    assert!(
        runtime_write
            .find("StrategyDesignNativeJoinReceiptV1::from_market_owner")
            .expect("Market capability sealed into Composer identity")
            < runtime_write
                .find("native_join_receipt.as_ref()")
                .expect("native join persisted with the positive operation")
    );
    let native_retry = runtime_write
        .split("if let Some(existing) = existing")
        .nth(1)
        .expect("exact retry branch")
        .split("let mut transaction")
        .next()
        .expect("bounded exact retry branch");
    assert!(
        native_retry
            .find("StrategyDesignNativeJoinReceiptV1::from_market_owner(&role_set, native_join)")
            .expect("cross-Design rejection before retry acceptance")
            < native_retry
                .find("native_join_matches_owner_port")
                .expect("exact Owner API retry readback")
    );

    for table in [
        "composer_private.rd_develop_designs_v2",
        "composer_private.rd_develop_plans_v2",
        "composer_private.rd_develop_artifacts_v2",
        "composer_private.rd_develop_artifact_modules_v2",
        "composer_private.rd_develop_build_receipts_v2",
        "composer_private.rd_develop_artifact_build_receipt_uses_v2",
        "composer_private.rd_develop_composer_receipts_v2",
        "composer_private.rd_develop_host_receipts_v2",
        "composer_private.rd_develop_operations_v2",
        "composer_private.rd_develop_strategy_design_role_set_attestations_v1",
        "composer_private.rd_develop_strategy_design_native_joins_v1",
        "composer_private.rd_develop_outbox_v2",
    ] {
        assert!(source.contains(table));
    }
}

#[tokio::test]
#[ignore = "requires an admitted disposable RD_OWNER_TEST_DATABASE_URL"]
async fn postgres_migration_materializes_only_private_binary_authority() {
    let database = CanonicalOwnerPostgresTestDatabaseV1::admit()
        .await
        .expect("canonical disposable Owner topology");
    let mutation = database.mutation();
    let rd_pool = mutation.pool(CanonicalOwnerTestRoleV1::RdOwner);
    let topology_admin_pool = database.owner_topology_admin_pool();
    PostgresDevelopComposerStoreV2::migrate(rd_pool)
        .await
        .expect("Composer migration");
    let rows = sqlx::query(
        "SELECT table_name, data_type
           FROM information_schema.columns
          WHERE table_schema='composer_private'
            AND table_name LIKE 'rd_develop_%_v2'
            AND column_name IN ('canonical_bytes','module_bytes','package_bytes','canonical_receipt_bytes','response_bytes')
          ORDER BY table_name, column_name",
    )
    .fetch_all(topology_admin_pool)
    .await
    .expect("migration readback");
    assert!(!rows.is_empty());
    assert!(
        rows.iter()
            .all(|row| row.get::<String, _>("data_type") == "bytea")
    );
    let (commit, sealed_read, role_set, native_join): (bool, bool, bool, bool) = sqlx::query_as(
        "SELECT
           pg_catalog.has_function_privilege('rd_fact_writer','composer_owner_api.commit_develop_composer_v2(text,bytea,bytea,bytea,bytea,bytea,bytea,bytea,bytea,bytea,bytea[],bytea[],bytea[],bytea[],bytea[],bytea,bytea,bytea,bytea,bytea,integer,bytea,text,bytea,bytea,bytea,bytea,bytea,bytea,bytea,bytea,bytea)','EXECUTE'),
           pg_catalog.has_function_privilege('rd_fact_writer','composer_owner_api.lock_accepted_develop_composer_v2(text)','EXECUTE'),
           pg_catalog.has_function_privilege('rd_fact_writer','composer_owner_api.resolve_strategy_design_role_set_attestation_v1(text,integer,bytea,text,bytea,bytea,bytea)','EXECUTE'),
           pg_catalog.has_function_privilege('rd_fact_writer','composer_owner_api.resolve_strategy_design_native_join_v1(text,integer,bytea,text,bytea,bytea,bytea)','EXECUTE')",
    )
    .fetch_one(topology_admin_pool)
    .await
    .expect("Composer writer authority readback");
    assert!(commit);
    assert!(!sealed_read);
    assert!(!role_set);
    assert!(!native_join);
}

#[cfg(feature = "sealed-source-intake-composer-acceptance")]
#[tokio::test]
#[ignore = "requires an admitted disposable RD_OWNER_TEST_DATABASE_URL and local Rust toolchain"]
async fn sealed_run_and_restarted_resolve_return_the_same_public_receipt() {
    let database = CanonicalOwnerPostgresTestDatabaseV1::admit()
        .await
        .expect("canonical disposable Owner topology");
    let first_owner = SealedDevelopComposerAcceptanceV2::connect(
        database.database_url(CanonicalOwnerTestRoleV1::RdFactWriter),
    )
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
    let restarted_owner = SealedDevelopComposerAcceptanceV2::connect(
        database.database_url(CanonicalOwnerTestRoleV1::RdFactWriter),
    )
    .await
    .expect("restarted sealed Composer owner");
    let resolved = restarted_owner
        .resolve(SEALED_DEVELOP_COMPOSER_REQUEST_IDENTITY_V2)
        .await
        .expect("restarted durable RESOLVE");
    assert_eq!(resolved, run);
}

#[cfg(feature = "sealed-source-intake-composer-acceptance")]
#[tokio::test]
#[ignore = "requires an admitted disposable RD_OWNER_TEST_DATABASE_URL and local Rust toolchain"]
async fn postgres_every_transaction_write_boundary_fault_leaves_zero_positive_rows() {
    let database = CanonicalOwnerPostgresTestDatabaseV1::admit()
        .await
        .expect("canonical disposable Owner topology");
    let topology_admin_pool = database.owner_topology_admin_pool();
    let research_before: i64 =
        sqlx::query_scalar("SELECT count(*) FROM rd_research_request_receipts_v1")
            .fetch_one(topology_admin_pool)
            .await
            .expect("Research custody count before fault");
    assert_eq!(custody_counts(topology_admin_pool).await, [0; 12]);

    // The Owner commit routine is one SQL write boundary containing the normalized 12-table
    // positive family and outbox. Injecting immediately before that boundary must roll back the
    // caller's transaction without touching canonical Research custody.
    for boundary in 0..1 {
        let owner = SealedDevelopComposerAcceptanceV2::connect(
            database.database_url(CanonicalOwnerTestRoleV1::RdFactWriter),
        )
        .await
        .expect("sealed Composer owner");
        assert!(owner.run_with_fault_for_test(boundary).await.is_err());
        assert_eq!(custody_counts(topology_admin_pool).await, [0; 12]);
        let research_after: i64 =
            sqlx::query_scalar("SELECT count(*) FROM rd_research_request_receipts_v1")
                .fetch_one(topology_admin_pool)
                .await
                .expect("Research custody count after fault");
        assert_eq!(research_after, research_before);
    }
}

#[cfg(feature = "sealed-develop-composer-acceptance")]
#[tokio::test]
#[ignore = "requires an admitted disposable RD_OWNER_TEST_DATABASE_URL and local Rust toolchain"]
async fn sealed_read_port_is_restart_exact_fail_closed_and_query_only() {
    let database = CanonicalOwnerPostgresTestDatabaseV1::admit()
        .await
        .expect("canonical disposable Owner topology");
    let topology_admin_pool = database.owner_topology_admin_pool();
    let reader = SealedDevelopComposerAcceptanceReadPortV2::connect(
        database.database_url(CanonicalOwnerTestRoleV1::RdFactWriter),
    )
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
    assert_eq!(custody_counts(topology_admin_pool).await, [0; 12]);

    let owner = SealedDevelopComposerAcceptanceV2::connect(
        database.database_url(CanonicalOwnerTestRoleV1::RdFactWriter),
    )
    .await
    .expect("sealed Composer owner");
    let run = owner.run().await.expect("sealed Composer RUN");
    let locator = DevelopComposerSealedReadLocatorV2::from_accepted_response(&run)
        .expect("positive response locator");
    let before_reads = custody_counts(topology_admin_pool).await;
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
    let restarted = SealedDevelopComposerAcceptanceReadPortV2::connect(
        database.database_url(CanonicalOwnerTestRoleV1::RdFactWriter),
    )
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
    assert_eq!(custody_counts(topology_admin_pool).await, before_reads);

    let mut in_flight_corruption = topology_admin_pool
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
        "UPDATE composer_private.rd_develop_plans_v2
            SET canonical_bytes=set_byte(canonical_bytes, 0, get_byte(canonical_bytes, 0) # 1)
          WHERE plan_digest=$1",
    )
    .bind(locator.canonical_plan_digest.as_bytes().as_slice())
    .execute(topology_admin_pool)
    .await
    .expect("corrupt dedicated Plan bytes");
    assert_eq!(
        restarted.read_accepted(&locator).await,
        Err(DevelopComposerSealedReadErrorV2::Unavailable)
    );
    assert_eq!(custody_counts(topology_admin_pool).await, before_reads);
}

#[cfg(feature = "sealed-develop-composer-acceptance")]
#[tokio::test]
#[ignore = "requires an admitted disposable RD_OWNER_TEST_DATABASE_URL and local Rust toolchain"]
async fn transaction_bound_read_uses_the_borrowed_backend_locks_and_writes_nothing() {
    let database = CanonicalOwnerPostgresTestDatabaseV1::admit()
        .await
        .expect("canonical disposable Owner topology");
    let mutation = database.mutation();
    let rd_pool = mutation.pool(CanonicalOwnerTestRoleV1::RdOwner);
    let topology_admin_pool = database.owner_topology_admin_pool();
    let owner = SealedDevelopComposerAcceptanceV2::connect(
        database.database_url(CanonicalOwnerTestRoleV1::RdFactWriter),
    )
    .await
    .expect("sealed Composer owner");

    let mut transaction = rd_pool.begin().await.expect("caller transaction");
    let backend_before: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
        .fetch_one(&mut *transaction)
        .await
        .expect("caller backend before missing read");
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
        owner
            .read_accepted_in_transaction(&mut transaction, &unknown)
            .await,
        Err(DevelopComposerSealedReadErrorV2::Unavailable)
    );
    let backend_after: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
        .fetch_one(&mut *transaction)
        .await
        .expect("caller backend after missing read");
    assert_eq!(backend_after, backend_before);
    transaction.rollback().await.expect("missing-read rollback");
    assert_eq!(custody_counts(topology_admin_pool).await, [0; 12]);

    let run = owner.run().await.expect("sealed Composer RUN");
    let locator = DevelopComposerSealedReadLocatorV2::from_accepted_response(&run)
        .expect("positive response locator");
    let before = custody_counts(topology_admin_pool).await;
    let mut transaction = rd_pool.begin().await.expect("caller transaction");
    let backend_before: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
        .fetch_one(&mut *transaction)
        .await
        .expect("caller backend before positive read");
    let readback = owner
        .read_accepted_in_transaction(&mut transaction, &locator)
        .await
        .expect("transaction-bound positive read");
    assert!(!readback.design_bytes().is_empty());
    assert!(!readback.plan_bytes().is_empty());
    assert!(!readback.artifact_package_bytes().is_empty());
    let (backend_after, has_table_lock, wrote_rows): (i32, bool, bool) = sqlx::query_as(
        "SELECT pg_backend_pid(), EXISTS (
           SELECT 1
             FROM pg_catalog.pg_locks
            WHERE pid=pg_backend_pid()
              AND relation='composer_private.rd_develop_operations_v2'::regclass
              AND mode='ShareLock'
              AND granted
         ), EXISTS (
           SELECT 1
             FROM pg_catalog.pg_stat_xact_user_tables
            WHERE n_tup_ins<>0 OR n_tup_upd<>0 OR n_tup_del<>0
         )",
    )
    .fetch_one(&mut *transaction)
    .await
    .expect("borrowed backend lock readback");
    assert_eq!(backend_after, backend_before);
    assert!(has_table_lock);
    assert!(!wrote_rows);
    assert_eq!(custody_counts(topology_admin_pool).await, before);
    transaction
        .rollback()
        .await
        .expect("positive-read rollback");
    assert_eq!(custody_counts(topology_admin_pool).await, before);
}

#[cfg(feature = "sealed-develop-composer-acceptance")]
#[tokio::test]
#[ignore = "requires an admitted disposable superuser RD_OWNER_TEST_DATABASE_URL and local Rust toolchain"]
async fn transaction_bound_read_rejects_wrong_owner_acl_and_stale_custody() {
    let database = CanonicalOwnerPostgresTestDatabaseV1::admit()
        .await
        .expect("canonical disposable Owner topology");
    let mutation = database.mutation();
    let rd_pool = mutation.pool(CanonicalOwnerTestRoleV1::RdOwner);
    let topology_admin_pool = database.owner_topology_admin_pool();
    let owner = SealedDevelopComposerAcceptanceV2::connect(
        database.database_url(CanonicalOwnerTestRoleV1::RdFactWriter),
    )
    .await
    .expect("sealed Composer owner");
    let run = owner.run().await.expect("sealed Composer RUN");
    let locator = DevelopComposerSealedReadLocatorV2::from_accepted_response(&run)
        .expect("positive response locator");
    let before = custody_counts(topology_admin_pool).await;

    sqlx::query("GRANT SELECT ON composer_private.rd_develop_operations_v2 TO PUBLIC")
        .execute(topology_admin_pool)
        .await
        .expect("inject public ACL");
    assert_transactional_read_unavailable(&owner, rd_pool, &locator).await;
    sqlx::query("REVOKE SELECT ON composer_private.rd_develop_operations_v2 FROM PUBLIC")
        .execute(topology_admin_pool)
        .await
        .expect("restore public ACL");

    sqlx::query(
        "GRANT EXECUTE ON FUNCTION composer_owner_api.lock_accepted_develop_composer_v2(text) TO PUBLIC",
    )
    .execute(topology_admin_pool)
    .await
    .expect("inject public routine ACL");
    assert_transactional_read_unavailable(&owner, rd_pool, &locator).await;
    sqlx::query(
        "REVOKE EXECUTE ON FUNCTION composer_owner_api.lock_accepted_develop_composer_v2(text) FROM PUBLIC",
    )
    .execute(topology_admin_pool)
    .await
    .expect("restore routine ACL");

    sqlx::query(
        "ALTER FUNCTION composer_owner_api.lock_accepted_develop_composer_v2(text) SET search_path=public",
    )
    .execute(topology_admin_pool)
    .await
    .expect("inject unsafe routine metadata");
    assert_transactional_read_unavailable(&owner, rd_pool, &locator).await;
    sqlx::query(
        "ALTER FUNCTION composer_owner_api.lock_accepted_develop_composer_v2(text) SET search_path=pg_catalog, pg_temp",
    )
    .execute(topology_admin_pool)
    .await
    .expect("restore routine metadata");

    sqlx::query("ALTER TABLE composer_private.rd_develop_operations_v2 OWNER TO replay_policy_catalog_owner")
        .execute(topology_admin_pool)
        .await
        .expect("inject wrong Composer owner");
    assert_transactional_read_unavailable(&owner, rd_pool, &locator).await;
    sqlx::query("ALTER TABLE composer_private.rd_develop_operations_v2 OWNER TO composer_owner")
        .execute(topology_admin_pool)
        .await
        .expect("restore Composer table owner");

    sqlx::query(
        "UPDATE composer_private.rd_develop_operations_v2
            SET research_request_identity=$1
          WHERE request_identity=$2",
    )
    .bind(
        BindingDigest::from_untrusted_bytes([0xe1; 32])
            .as_bytes()
            .as_slice(),
    )
    .bind(&locator.request_identity)
    .execute(topology_admin_pool)
    .await
    .expect("inject stale Research binding");
    assert_transactional_read_unavailable(&owner, rd_pool, &locator).await;
    assert_eq!(custody_counts(topology_admin_pool).await, before);
}

#[cfg(feature = "sealed-develop-composer-acceptance")]
async fn assert_transactional_read_unavailable(
    owner: &SealedDevelopComposerAcceptanceV2,
    pool: &sqlx::PgPool,
    locator: &DevelopComposerSealedReadLocatorV2,
) {
    let mut transaction = pool.begin().await.expect("caller transaction");
    assert_eq!(
        owner
            .read_accepted_in_transaction(&mut transaction, locator)
            .await,
        Err(DevelopComposerSealedReadErrorV2::Unavailable)
    );
    transaction
        .rollback()
        .await
        .expect("unavailable read rollback");
}

#[cfg(feature = "sealed-develop-composer-acceptance")]
async fn corrupt_plan_bytes(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    plan_digest: BindingDigest,
) {
    sqlx::query(
        "UPDATE composer_private.rd_develop_plans_v2
            SET canonical_bytes=set_byte(canonical_bytes, 0, get_byte(canonical_bytes, 0) # 1)
          WHERE plan_digest=$1",
    )
    .bind(plan_digest.as_bytes().as_slice())
    .execute(&mut **transaction)
    .await
    .expect("corrupt dedicated Plan bytes in transaction");
}

#[cfg(feature = "sealed-develop-composer-acceptance")]
async fn custody_counts(pool: &sqlx::PgPool) -> [i64; 12] {
    let row = sqlx::query(
        "SELECT
           (SELECT count(*) FROM composer_private.rd_develop_designs_v2) AS designs,
           (SELECT count(*) FROM composer_private.rd_develop_plans_v2) AS plans,
           (SELECT count(*) FROM composer_private.rd_develop_artifacts_v2) AS artifacts,
           (SELECT count(*) FROM composer_private.rd_develop_artifact_modules_v2) AS modules,
           (SELECT count(*) FROM composer_private.rd_develop_build_receipts_v2) AS build_receipts,
           (SELECT count(*) FROM composer_private.rd_develop_artifact_build_receipt_uses_v2) AS build_receipt_uses,
           (SELECT count(*) FROM composer_private.rd_develop_composer_receipts_v2) AS composer_receipts,
           (SELECT count(*) FROM composer_private.rd_develop_host_receipts_v2) AS host_receipts,
           (SELECT count(*) FROM composer_private.rd_develop_operations_v2) AS operations,
           (SELECT count(*) FROM composer_private.rd_develop_strategy_design_role_set_attestations_v1) AS role_set_attestations,
           (SELECT count(*) FROM composer_private.rd_develop_strategy_design_native_joins_v1) AS native_joins,
           (SELECT count(*) FROM composer_private.rd_develop_outbox_v2) AS outbox",
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
        row.get("build_receipt_uses"),
        row.get("composer_receipts"),
        row.get("host_receipts"),
        row.get("operations"),
        row.get("role_set_attestations"),
        row.get("native_joins"),
        row.get("outbox"),
    ]
}
