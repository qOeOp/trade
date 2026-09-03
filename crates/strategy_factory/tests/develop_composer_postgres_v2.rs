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
use vibe_testkit::postgres::{
    CanonicalOwnerPostgresTestDatabaseV1, CanonicalOwnerTestRoleV1, ProtectedOwnerTestRoleV1,
};

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
    assert!(migration.contains("REVOKE ALL ON ALL TABLES IN SCHEMA"));
    assert!(!source.contains("JSONB"));
    assert!(!source.contains("serde_json"));
    assert!(source.contains("current Owner evidence is unavailable for public durable RESOLVE"));
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
    assert!(source.contains("caller_oid IN (rd_owner_oid,fact_writer_oid)"));
    assert!(source.contains("acl.grantee NOT IN (proowner, rd_owner_oid, fact_writer_oid)"));
    assert!(source.contains("SESSION_USER='rd_fact_writer'"));
    assert!(source.contains("pg_catalog.has_table_privilege"));
    let writer_authority = source
        .split("async fn verify_composer_writer_authority_in_transaction")
        .nth(1)
        .expect("Composer writer authority gate")
        .split("fn exact_ordinal_array")
        .next()
        .expect("bounded Composer writer authority gate");
    assert!(writer_authority.contains("SELECT rolcanlogin AND rolinherit"));
    assert!(writer_authority.contains("AND NOT rolsuper"));
    assert!(writer_authority.contains("AND NOT rolcreatedb"));
    assert!(writer_authority.contains("AND NOT rolcreaterole"));
    assert!(writer_authority.contains("AND NOT rolreplication"));
    assert!(writer_authority.contains("AND NOT rolbypassrls"));
    assert!(writer_authority.contains("JOIN pg_catalog.pg_auth_members membership"));
    assert!(writer_authority.contains("membership.member=writer.oid"));
    assert!(writer_authority.contains("membership.roleid=writer.oid"));
    assert!(!writer_authority.contains("pg_catalog.pg_has_role(writer.oid"));
    assert!(writer_authority.contains("pg_catalog.has_table_privilege"));
    assert!(writer_authority.contains("pg_catalog.has_column_privilege"));
    assert!(writer_authority.contains("private_namespace.nspname='composer_private'"));
    assert!(writer_authority.contains("api_namespace.nspname='composer_owner_api'"));
    assert!(writer_authority.contains("'TEMPORARY'"));
    assert!(writer_authority.contains("Composer writer authority is unavailable"));
    assert_eq!(
        source
            .matches("verify_composer_writer_authority_in_transaction")
            .count(),
        3,
        "writer authority must be checked at startup and before every commit",
    );
    assert!(source.contains("database_fingerprint: ComposerDatabaseFingerprintV2"));
    assert!(source.contains("system_identifier: String"));
    assert!(source.contains("database_name: String"));
    assert!(source.contains("database_oid: i64"));
    assert!(source.contains("begin_read_transaction()"));
    assert!(source.contains("begin_mutation_transaction()"));
    let persist = source
        .split("async fn persist_record")
        .nth(1)
        .expect("Composer persistence boundary")
        .split("let committed: bool")
        .next()
        .expect("bounded pre-write gate");
    assert!(
        persist.find("verify_transaction_database")
            < persist.find("verify_composer_writer_authority_in_transaction")
    );
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
        "composer_private.rd_develop_designs_v2",
        "composer_private.rd_develop_plans_v2",
        "composer_private.rd_develop_artifacts_v2",
        "composer_private.rd_develop_artifact_modules_v2",
        "composer_private.rd_develop_build_receipts_v2",
        "composer_private.rd_develop_composer_receipts_v2",
        "composer_private.rd_develop_host_receipts_v2",
        "composer_private.rd_develop_operations_v2",
        "composer_private.rd_develop_outbox_v2",
    ] {
        assert!(source.contains(table));
    }
}

#[rstest]
fn composer_writer_startup_rejects_rd_custodian_membership() {
    let source = include_str!("../src/develop_composer_postgres_v2.rs");
    let membership_gate = source
        .split("AND NOT EXISTS (\n              SELECT 1\n                FROM writer")
        .nth(1)
        .expect("Composer writer membership gate")
        .split("AND (SELECT count(*)=9 FROM private_relations)")
        .next()
        .expect("bounded Composer writer membership gate");

    assert!(membership_gate.contains("JOIN pg_catalog.pg_auth_members membership"));
    assert!(membership_gate.contains("membership.member=writer.oid"));
    assert!(membership_gate.contains("membership.roleid=writer.oid"));
    assert!(
        !membership_gate.contains("pg_catalog.pg_has_role")
            && !membership_gate.contains("pg_catalog.pg_roles related_role"),
        "rd_custodian and every other direct membership edge must remain forbidden at startup",
    );
}

#[tokio::test]
#[ignore = "requires an admitted disposable RD_OWNER_TEST_DATABASE_URL"]
async fn composer_writer_startup_rejects_composer_owner_membership() {
    let database = CanonicalOwnerPostgresTestDatabaseV1::admit()
        .await
        .expect("canonical disposable Owner topology");
    let fault = database
        .acquire_protected_owner_test_authority(ProtectedOwnerTestRoleV1::ComposerOwner)
        .await
        .expect("acquire Composer membership fault authority")
        .inject_composer_writer_edge()
        .await
        .expect("inject Composer owner membership");
    let connection = PostgresDevelopComposerStoreV2::connect(
        database.database_url(CanonicalOwnerTestRoleV1::RdOwner),
        database.database_url(CanonicalOwnerTestRoleV1::RdFactWriter),
    )
    .await;
    fault
        .restore()
        .await
        .expect("restore Composer owner membership");

    match connection {
        Err(sqlx::Error::Protocol(message)) => {
            assert_eq!(message, "Composer writer authority is unavailable");
        }
        Err(e) => panic!("unexpected Composer startup error: {e}"),
        Ok(_) => panic!("Composer writer startup accepted inherited owner authority"),
    }
}

#[tokio::test]
#[ignore = "requires two admitted disposable PostgreSQL clusters with Unix-socket endpoints"]
async fn composer_startup_rejects_same_named_database_on_a_distinct_cluster() {
    let _admitted_database = CanonicalOwnerPostgresTestDatabaseV1::admit()
        .await
        .expect("canonical disposable Owner topology");
    let read_url = std::env::var("RD_OWNER_SOCKET_TEST_DATABASE_URL")
        .expect("primary rd_owner Unix-socket URL");
    let writer_url = std::env::var("RD_FACT_WRITER_SOCKET_TEST_DATABASE_URL")
        .expect("primary rd_fact_writer Unix-socket URL");
    let impersonator_url = std::env::var("RD_FACT_WRITER_IMPERSONATOR_TEST_DATABASE_URL")
        .expect("secondary rd_fact_writer Unix-socket URL");

    let primary_identity = owner_evidenced_database_identity(&read_url).await;
    let secondary_identity =
        fixture_admin_database_identity("VIBE_TEST_IMPERSONATOR_POSTGRES_ADMIN_DATABASE_URL").await;
    assert_eq!(primary_identity.1, secondary_identity.1);
    assert_ne!(primary_identity.0, secondary_identity.0);
    assert!(primary_identity.3 && secondary_identity.3);

    let _store = PostgresDevelopComposerStoreV2::connect(&read_url, &writer_url)
        .await
        .expect("same physical database over distinct Unix-socket roles");
    #[cfg(feature = "sealed-develop-composer-acceptance")]
    {
        let mut store = _store;
        store
            .reconnect_mutation_pool_for_acceptance(&writer_url)
            .await
            .expect("same physical database remains valid after writer reconnect");
    }

    match PostgresDevelopComposerStoreV2::connect(&read_url, &impersonator_url).await {
        Err(sqlx::Error::Protocol(message)) => assert_eq!(
            message,
            "Composer read and mutation connections target different databases"
        ),
        Err(e) => panic!("unexpected cross-cluster Composer error: {e}"),
        Ok(_) => panic!("Composer accepted split custody across PostgreSQL clusters"),
    }
}

#[cfg(feature = "sealed-develop-composer-acceptance")]
#[tokio::test]
#[ignore = "requires two admitted disposable PostgreSQL clusters with same-named databases"]
async fn composer_post_start_writer_reconnection_to_distinct_cluster_fails_before_write() {
    let _admitted_database = CanonicalOwnerPostgresTestDatabaseV1::admit()
        .await
        .expect("canonical disposable Owner topology");
    let read_url = std::env::var("RD_OWNER_SOCKET_TEST_DATABASE_URL")
        .expect("primary rd_owner Unix-socket URL");
    let writer_url = std::env::var("RD_FACT_WRITER_SOCKET_TEST_DATABASE_URL")
        .expect("primary rd_fact_writer Unix-socket URL");
    let switched_writer_url = std::env::var("RD_FACT_WRITER_IMPERSONATOR_TEST_DATABASE_URL")
        .expect("secondary rd_fact_writer Unix-socket URL");
    let mut store = PostgresDevelopComposerStoreV2::connect(&read_url, &writer_url)
        .await
        .expect("Composer startup on primary physical database");
    let secondary_pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(1)
        .connect(&switched_writer_url)
        .await
        .expect("secondary cluster observation");
    let writes_before: i64 = sqlx::query_scalar(
        "SELECT COALESCE(sum(n_tup_ins), 0)::bigint FROM pg_catalog.pg_stat_all_tables WHERE schemaname='composer_private'",
    )
    .fetch_one(&secondary_pool)
    .await
    .expect("secondary write count before reconnect");

    match store
        .reconnect_mutation_pool_for_acceptance(&switched_writer_url)
        .await
    {
        Err(sqlx::Error::Protocol(message)) => assert_eq!(
            message,
            "Composer connection physical database changed after startup"
        ),
        Err(e) => panic!("unexpected post-start Composer reconnect error: {e}"),
        Ok(()) => panic!("Composer accepted a post-start switch to another physical database"),
    }

    let writes_after: i64 = sqlx::query_scalar(
        "SELECT COALESCE(sum(n_tup_ins), 0)::bigint FROM pg_catalog.pg_stat_all_tables WHERE schemaname='composer_private'",
    )
    .fetch_one(&secondary_pool)
    .await
    .expect("secondary write count after rejected reconnect");
    assert_eq!(writes_after, writes_before, "rejected reconnect wrote rows");
}

async fn owner_evidenced_database_identity(database_url: &str) -> (String, String, i64, bool) {
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(1)
        .connect(database_url)
        .await
        .expect("disposable R&D Owner evidence connection");
    sqlx::query_as(
        "SELECT identity.system_identifier, identity.database_name, identity.database_oid, pg_catalog.inet_server_addr() IS NULL AND pg_catalog.inet_server_port() IS NULL FROM rd_owner_api.resolve_develop_composer_database_identity_v2() AS identity",
    )
    .fetch_one(&pool)
    .await
    .expect("Owner-sealed physical database identity")
}

async fn fixture_admin_database_identity(url_env: &str) -> (String, String, i64, bool) {
    let database_url = std::env::var(url_env).expect("exact disposable fixture-admin URL");
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(1)
        .connect(&database_url)
        .await
        .expect("disposable fixture-admin identity connection");
    let (admin_is_exact, system_identifier, database_name, database_oid, unix_socket): (
        bool,
        String,
        String,
        i64,
        bool,
    ) = sqlx::query_as(
        "SELECT session_user='postgres', (pg_catalog.pg_control_system()).system_identifier::text, pg_catalog.current_database()::text, database.oid::bigint, pg_catalog.inet_server_addr() IS NULL AND pg_catalog.inet_server_port() IS NULL FROM pg_catalog.pg_database AS database WHERE database.datname=pg_catalog.current_database()",
    )
    .fetch_one(&pool)
    .await
    .expect("fixture-admin physical database identity");
    assert!(
        admin_is_exact,
        "database identity did not come from fixture admin"
    );
    (system_identifier, database_name, database_oid, unix_socket)
}

#[cfg(feature = "sealed-develop-composer-acceptance")]
async fn execute_with_composer_authority(
    database: &CanonicalOwnerPostgresTestDatabaseV1,
    statement: &'static str,
) {
    let authority = database
        .acquire_protected_owner_test_authority(ProtectedOwnerTestRoleV1::ComposerOwner)
        .await
        .expect("bounded Composer test authority");
    sqlx::query(statement)
        .execute(authority.pool())
        .await
        .expect("bounded Composer fixture mutation");
    authority
        .release()
        .await
        .expect("release bounded Composer test authority");
}

#[tokio::test]
#[ignore = "requires an admitted disposable RD_OWNER_TEST_DATABASE_URL"]
async fn postgres_migration_materializes_only_private_binary_authority() {
    let database = CanonicalOwnerPostgresTestDatabaseV1::admit()
        .await
        .expect("canonical disposable Owner topology");
    let mutation = database.mutation();
    let rd_pool = mutation.pool(CanonicalOwnerTestRoleV1::RdOwner);
    PostgresDevelopComposerStoreV2::migrate(rd_pool)
        .await
        .expect("Composer migration");
    let authority = database
        .acquire_protected_owner_test_authority(ProtectedOwnerTestRoleV1::ComposerOwner)
        .await
        .expect("Composer migration readback authority");
    let rows = sqlx::query(
        "SELECT table_name, data_type
           FROM information_schema.columns
          WHERE table_schema='composer_private'
            AND table_name LIKE 'rd_develop_%_v2'
            AND column_name IN ('canonical_bytes','module_bytes','package_bytes','canonical_receipt_bytes','response_bytes')
          ORDER BY table_name, column_name",
    )
    .fetch_all(authority.pool())
    .await
    .expect("migration readback");
    assert!(!rows.is_empty());
    assert!(
        rows.iter()
            .all(|row| row.get::<String, _>("data_type") == "bytea")
    );
    authority
        .release()
        .await
        .expect("release Composer migration readback authority");
}

#[cfg(feature = "sealed-develop-composer-acceptance")]
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

#[cfg(feature = "sealed-develop-composer-acceptance")]
#[tokio::test]
#[ignore = "requires an admitted disposable RD_OWNER_TEST_DATABASE_URL and local Rust toolchain"]
async fn sealed_read_port_is_restart_exact_fail_closed_and_query_only() {
    let database = CanonicalOwnerPostgresTestDatabaseV1::admit()
        .await
        .expect("canonical disposable Owner topology");
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
    assert_eq!(custody_counts(&database).await, [0; 9]);

    let owner = SealedDevelopComposerAcceptanceV2::connect(
        database.database_url(CanonicalOwnerTestRoleV1::RdFactWriter),
    )
    .await
    .expect("sealed Composer owner");
    let run = owner.run().await.expect("sealed Composer RUN");
    let locator = DevelopComposerSealedReadLocatorV2::from_accepted_response(&run)
        .expect("positive response locator");
    let before_reads = custody_counts(&database).await;
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
    assert_eq!(custody_counts(&database).await, before_reads);

    let authority = database
        .acquire_protected_owner_test_authority(ProtectedOwnerTestRoleV1::ComposerOwner)
        .await
        .expect("in-flight Composer corruption authority");
    let authority_pool = authority.pool().clone();
    let mut in_flight_corruption = authority_pool
        .begin()
        .await
        .expect("in-flight corruption transaction");
    corrupt_plan_bytes(&mut in_flight_corruption, locator.canonical_plan_digest).await;
    authority
        .release()
        .await
        .expect("release in-flight Composer corruption authority");
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

    let authority = database
        .acquire_protected_owner_test_authority(ProtectedOwnerTestRoleV1::ComposerOwner)
        .await
        .expect("Composer corruption authority");
    sqlx::query(
        "UPDATE composer_private.rd_develop_plans_v2
            SET canonical_bytes=set_byte(canonical_bytes, 0, get_byte(canonical_bytes, 0) # 1)
          WHERE plan_digest=$1",
    )
    .bind(locator.canonical_plan_digest.as_bytes().as_slice())
    .execute(authority.pool())
    .await
    .expect("corrupt dedicated Plan bytes");
    authority
        .release()
        .await
        .expect("release Composer corruption authority");
    assert_eq!(
        restarted.read_accepted(&locator).await,
        Err(DevelopComposerSealedReadErrorV2::Unavailable)
    );
    assert_eq!(custody_counts(&database).await, before_reads);
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
    assert_eq!(custody_counts(&database).await, [0; 9]);

    let run = owner.run().await.expect("sealed Composer RUN");
    let locator = DevelopComposerSealedReadLocatorV2::from_accepted_response(&run)
        .expect("positive response locator");
    let before = custody_counts(&database).await;
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
    assert_eq!(custody_counts(&database).await, before);
    transaction
        .rollback()
        .await
        .expect("positive-read rollback");
    assert_eq!(custody_counts(&database).await, before);
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
    let owner = SealedDevelopComposerAcceptanceV2::connect(
        database.database_url(CanonicalOwnerTestRoleV1::RdFactWriter),
    )
    .await
    .expect("sealed Composer owner");
    let run = owner.run().await.expect("sealed Composer RUN");
    let locator = DevelopComposerSealedReadLocatorV2::from_accepted_response(&run)
        .expect("positive response locator");
    let before = custody_counts(&database).await;

    execute_with_composer_authority(
        &database,
        "GRANT SELECT ON composer_private.rd_develop_operations_v2 TO PUBLIC",
    )
    .await;
    assert_transactional_read_unavailable(&owner, rd_pool, &locator).await;
    execute_with_composer_authority(
        &database,
        "REVOKE SELECT ON composer_private.rd_develop_operations_v2 FROM PUBLIC",
    )
    .await;

    execute_with_composer_authority(
        &database,
        "GRANT EXECUTE ON FUNCTION composer_owner_api.lock_accepted_develop_composer_v2(text) TO PUBLIC",
    )
    .await;
    assert_transactional_read_unavailable(&owner, rd_pool, &locator).await;
    execute_with_composer_authority(
        &database,
        "REVOKE EXECUTE ON FUNCTION composer_owner_api.lock_accepted_develop_composer_v2(text) FROM PUBLIC",
    )
    .await;

    execute_with_composer_authority(
        &database,
        "ALTER FUNCTION composer_owner_api.lock_accepted_develop_composer_v2(text) SET search_path=public",
    )
    .await;
    assert_transactional_read_unavailable(&owner, rd_pool, &locator).await;
    execute_with_composer_authority(
        &database,
        "ALTER FUNCTION composer_owner_api.lock_accepted_develop_composer_v2(text) SET search_path=pg_catalog, pg_temp",
    )
    .await;

    execute_with_composer_authority(
        &database,
        "ALTER TABLE composer_private.rd_develop_operations_v2 OWNER TO vibe_test_owner_topology_admin",
    )
    .await;
    assert_transactional_read_unavailable(&owner, rd_pool, &locator).await;
    execute_with_composer_authority(
        &database,
        "ALTER TABLE composer_private.rd_develop_operations_v2 OWNER TO composer_owner",
    )
    .await;

    let authority = database
        .acquire_protected_owner_test_authority(ProtectedOwnerTestRoleV1::ComposerOwner)
        .await
        .expect("stale Composer binding authority");
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
    .execute(authority.pool())
    .await
    .expect("inject stale Research binding");
    authority
        .release()
        .await
        .expect("release stale Composer binding authority");
    assert_transactional_read_unavailable(&owner, rd_pool, &locator).await;
    assert_eq!(custody_counts(&database).await, before);
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
async fn custody_counts(database: &CanonicalOwnerPostgresTestDatabaseV1) -> [i64; 9] {
    let authority = database
        .acquire_protected_owner_test_authority(ProtectedOwnerTestRoleV1::ComposerOwner)
        .await
        .expect("Composer custody readback authority");
    let row = sqlx::query(
        "SELECT
           (SELECT count(*) FROM composer_private.rd_develop_designs_v2) AS designs,
           (SELECT count(*) FROM composer_private.rd_develop_plans_v2) AS plans,
           (SELECT count(*) FROM composer_private.rd_develop_artifacts_v2) AS artifacts,
           (SELECT count(*) FROM composer_private.rd_develop_artifact_modules_v2) AS modules,
           (SELECT count(*) FROM composer_private.rd_develop_build_receipts_v2) AS build_receipts,
           (SELECT count(*) FROM composer_private.rd_develop_composer_receipts_v2) AS composer_receipts,
           (SELECT count(*) FROM composer_private.rd_develop_host_receipts_v2) AS host_receipts,
           (SELECT count(*) FROM composer_private.rd_develop_operations_v2) AS operations,
           (SELECT count(*) FROM composer_private.rd_develop_outbox_v2) AS outbox",
    )
    .fetch_one(authority.pool())
    .await
    .expect("Composer custody counts");
    let counts = [
        row.get("designs"),
        row.get("plans"),
        row.get("artifacts"),
        row.get("modules"),
        row.get("build_receipts"),
        row.get("composer_receipts"),
        row.get("host_receipts"),
        row.get("operations"),
        row.get("outbox"),
    ];
    authority
        .release()
        .await
        .expect("release Composer custody readback authority");
    counts
}
