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
        ComposerArtifactBuildReceiptSchemaV1, ComposerArtifactBuildReceiptsErrorV1,
        DevelopComposerSealedReadErrorV2, DevelopComposerSealedReadLocatorV2,
        DevelopComposerSealedReadPortV2, SealedDevelopComposerAcceptanceReadPortV2,
        resolve_artifact_build_receipts_v1_in_transaction,
    },
    develop_composer_sealed_acceptance_v2::SealedDevelopComposerAcceptanceV2,
};
use vibe_testkit::postgres::{CanonicalOwnerPostgresTestDatabaseV1, CanonicalOwnerTestRoleV1};

/// Every Composer Owner API routine runs as its owner, so each one searches `pg_catalog` and then
/// `pg_temp` last; a routine that leaves `pg_temp` out searches it first.
#[rstest]
fn composer_owner_api_routines_search_pg_temp_last() {
    let migration =
        include_str!("../../../product/rd-workbench/postgres-init/10-migrate-authority-custody.sh");
    let routines = migration
        .split("CREATE OR REPLACE FUNCTION composer_owner_api.")
        .skip(1)
        .map(|definition| {
            let name = definition.split('(').next().expect("routine name");
            let header = definition
                .split(" AS $")
                .next()
                .filter(|header| header.len() < definition.len())
                .unwrap_or_else(|| panic!("{name} has no dollar-quoted body"));
            assert!(
                header.contains("SECURITY DEFINER"),
                "{name} is not SECURITY DEFINER"
            );
            let search_path = header
                .split("SET search_path = ")
                .nth(1)
                .unwrap_or_else(|| panic!("{name} sets no search_path"))
                .trim();
            (name, search_path)
        })
        .collect::<Vec<_>>();

    // The two sealed reads are among them, so the split reached real definitions.
    assert!(
        routines
            .iter()
            .any(|(name, _)| *name == "lock_accepted_develop_composer_v2")
    );
    assert!(
        routines
            .iter()
            .any(|(name, _)| *name == "resolve_develop_composer_locator_for_replay_v2")
    );
    assert_eq!(
        routines
            .iter()
            .filter(|(_, search_path)| *search_path != "pg_catalog, pg_temp")
            .collect::<Vec<_>>(),
        Vec::<&(&str, &str)>::new()
    );
}

/// The lock clauses a PL/pgSQL body contains, read as tokens so spacing cannot hide one.
fn lock_clauses(body: &str) -> Vec<&'static str> {
    let tokens = body
        .split(|c: char| !(c.is_ascii_alphanumeric() || c == '_'))
        .filter(|token| !token.is_empty())
        .map(str::to_ascii_uppercase)
        .collect::<Vec<_>>();
    let row_lock = tokens.windows(2).any(|pair| {
        pair[0] == "FOR" && matches!(pair[1].as_str(), "SHARE" | "UPDATE" | "NO" | "KEY")
    });
    [
        ("row lock", row_lock),
        ("LOCK", tokens.iter().any(|token| token == "LOCK")),
        (
            "advisory",
            tokens.iter().any(|token| token.contains("ADVISORY")),
        ),
    ]
    .into_iter()
    .filter_map(|(clause, present)| present.then_some(clause))
    .collect()
}

fn function_body<'a>(migration: &'a str, tag: &str) -> &'a str {
    let delimiter = format!("${tag}$");
    let mut parts = migration.split(delimiter.as_str());
    let body = parts.nth(1).expect("dollar-quoted function body");
    assert!(parts.next().is_some(), "{tag} closes once");
    body
}

#[rstest]
fn artifact_build_receipts_read_takes_no_lock() {
    let migration =
        include_str!("../../../product/rd-workbench/postgres-init/10-migrate-authority-custody.sh");
    assert_eq!(
        lock_clauses(function_body(migration, "composer_artifact_build_receipts")),
        Vec::<&str>::new()
    );
    // The same reading finds each clause where the sealed reads take it.
    assert_eq!(
        lock_clauses(function_body(migration, "composer_read")),
        ["LOCK"]
    );
    assert_eq!(
        lock_clauses(function_body(migration, "composer_commit_cut")),
        ["row lock", "advisory"]
    );
}

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
    assert!(
        migration
            .contains("CREATE TABLE IF NOT EXISTS composer_private.rd_develop_build_receipts_v3")
    );
    assert!(migration.contains(
        "CREATE TABLE IF NOT EXISTS composer_private.rd_develop_artifact_build_receipt_uses_v3"
    ));
    assert!(migration.contains("composer_owner_api.commit_develop_composer_v3"));
    assert!(migration.contains("composer_owner_api.commit_develop_composer_acceptance_v3"));
    let acceptance_v3_signature = "composer_owner_api.commit_develop_composer_acceptance_v3(text,bytea,bytea,bytea,bytea,bytea,bytea,bytea,bytea,bytea,bytea[],bytea[],bytea[],bytea[],bytea[],bytea,bytea,bytea,bytea,bytea,integer,bytea,text,bytea,bytea,bytea,bytea,bytea,bytea,bytea,bytea,bytea,integer[])";
    assert!(migration.contains(&format!(
        "ALTER FUNCTION {acceptance_v3_signature} OWNER TO composer_owner"
    )));
    assert!(migration.contains(&format!(
        "REVOKE ALL ON FUNCTION {acceptance_v3_signature} FROM PUBLIC, rd_owner, rd_fact_writer"
    )));
    assert!(migration.contains(&format!(
        "GRANT EXECUTE ON FUNCTION {acceptance_v3_signature} TO rd_owner"
    )));
    assert!(migration.contains("EXISTS (SELECT 1 FROM unnest(p_receipt_tags) tag WHERE tag<>3)"));
    assert!(migration.contains("SELECT receipt_use.ordinal,2 AS receipt_tag"));
    assert!(migration.contains("SELECT receipt_use.ordinal,3 AS receipt_tag"));
    assert!(!migration.contains("ALTER TABLE composer_private.rd_develop_build_receipts_v2 ADD"));
    assert!(!migration.contains("UPDATE composer_private.rd_develop_build_receipts_v2"));
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

/// One stored column at a time, each tampered alone: the sealed read must refuse it and read the
/// exact custody again once it is restored. These are the Composer cases the stored-tamper probe
/// (`source_research_composer_stored_tamper_probe`) checked by hand and no chain entry did.
/// Each restore undoes its own tamper, so the rows stay independent.
/// A stored column, how to tamper it, how to undo that, and - when the store itself refuses the
/// tamper - the SQLSTATE and constraint that refuse it.
#[cfg(feature = "sealed-develop-composer-acceptance")]
type StoredColumnTamper = (
    &'static str,
    &'static str,
    &'static str,
    Option<(&'static str, &'static str)>,
);

#[cfg(feature = "sealed-develop-composer-acceptance")]
const STORED_COLUMN_TAMPERS: &[StoredColumnTamper] = &[
    (
        "rd_develop_artifacts_v2.package_bytes",
        "UPDATE composer_private.rd_develop_artifacts_v2 SET package_bytes=package_bytes||'\\x00'::bytea WHERE artifact_identity=$2::bytea",
        "UPDATE composer_private.rd_develop_artifacts_v2 SET package_bytes=substring(package_bytes FROM 1 FOR length(package_bytes)-1) WHERE artifact_identity=$2::bytea",
        None,
    ),
    (
        "rd_develop_artifact_modules_v2.module_bytes",
        "UPDATE composer_private.rd_develop_artifact_modules_v2 SET module_bytes=module_bytes||'\\x00'::bytea WHERE artifact_identity=$2::bytea AND ordinal=0",
        "UPDATE composer_private.rd_develop_artifact_modules_v2 SET module_bytes=substring(module_bytes FROM 1 FOR length(module_bytes)-1) WHERE artifact_identity=$2::bytea AND ordinal=0",
        None,
    ),
    (
        "rd_develop_artifact_build_receipt_uses_v2.receipt_identity",
        "UPDATE composer_private.rd_develop_artifact_build_receipt_uses_v2 SET receipt_identity=set_byte(receipt_identity,0,(get_byte(receipt_identity,0)+1)%256) WHERE artifact_identity=$2::bytea AND ordinal=0",
        "UPDATE composer_private.rd_develop_artifact_build_receipt_uses_v2 SET receipt_identity=set_byte(receipt_identity,0,(get_byte(receipt_identity,0)+255)%256) WHERE artifact_identity=$2::bytea AND ordinal=0",
        Some((
            "23503",
            "rd_develop_artifact_build_receipt_uses_v2_receipt_identity_fkey",
        )),
    ),
    (
        "rd_develop_artifact_build_receipt_uses_v2.artifact_identity",
        "UPDATE composer_private.rd_develop_artifact_build_receipt_uses_v2 SET artifact_identity=set_byte(artifact_identity,0,(get_byte(artifact_identity,0)+1)%256) WHERE artifact_identity=$2::bytea AND ordinal=0",
        "UPDATE composer_private.rd_develop_artifact_build_receipt_uses_v2 SET artifact_identity=$2::bytea WHERE artifact_identity=set_byte($2::bytea,0,(get_byte($2::bytea,0)+1)%256) AND ordinal=0",
        Some((
            "23503",
            "rd_develop_artifact_build_receipt_uses_v_artifact_identity_fkey",
        )),
    ),
    (
        "rd_develop_artifact_build_receipt_uses_v2.ordinal",
        "UPDATE composer_private.rd_develop_artifact_build_receipt_uses_v2 SET ordinal=ordinal+1 WHERE artifact_identity=$2::bytea AND ordinal=0",
        "UPDATE composer_private.rd_develop_artifact_build_receipt_uses_v2 SET ordinal=0 WHERE artifact_identity=$2::bytea AND ordinal=1 AND NOT EXISTS (SELECT 1 FROM composer_private.rd_develop_artifact_build_receipt_uses_v2 u WHERE u.artifact_identity=$2::bytea AND u.ordinal=0)",
        None,
    ),
    (
        "rd_develop_composer_receipts_v2.canonical_bytes",
        "UPDATE composer_private.rd_develop_composer_receipts_v2 SET canonical_bytes=canonical_bytes||'\\x00'::bytea WHERE artifact_identity=$2::bytea",
        "UPDATE composer_private.rd_develop_composer_receipts_v2 SET canonical_bytes=substring(canonical_bytes FROM 1 FOR length(canonical_bytes)-1) WHERE artifact_identity=$2::bytea",
        None,
    ),
    (
        "rd_develop_host_receipts_v2.canonical_bytes",
        "UPDATE composer_private.rd_develop_host_receipts_v2 SET canonical_bytes=canonical_bytes||'\\x00'::bytea WHERE artifact_identity=$2::bytea",
        "UPDATE composer_private.rd_develop_host_receipts_v2 SET canonical_bytes=substring(canonical_bytes FROM 1 FOR length(canonical_bytes)-1) WHERE artifact_identity=$2::bytea",
        None,
    ),
    (
        "rd_develop_operations_v2.canonical_receipt_bytes",
        "UPDATE composer_private.rd_develop_operations_v2 SET canonical_receipt_bytes=canonical_receipt_bytes||'\\x00'::bytea WHERE request_identity=$1::text",
        "UPDATE composer_private.rd_develop_operations_v2 SET canonical_receipt_bytes=substring(canonical_receipt_bytes FROM 1 FOR length(canonical_receipt_bytes)-1) WHERE request_identity=$1::text",
        None,
    ),
    (
        "rd_develop_operations_v2.response_bytes",
        "UPDATE composer_private.rd_develop_operations_v2 SET response_bytes=response_bytes||'\\x00'::bytea WHERE request_identity=$1::text",
        "UPDATE composer_private.rd_develop_operations_v2 SET response_bytes=substring(response_bytes FROM 1 FOR length(response_bytes)-1) WHERE request_identity=$1::text",
        None,
    ),
    (
        "rd_develop_strategy_design_role_set_attestations_v1.canonical_bytes",
        "UPDATE composer_private.rd_develop_strategy_design_role_set_attestations_v1 SET canonical_bytes=canonical_bytes||'\\x00'::bytea WHERE request_identity=$1::text",
        "UPDATE composer_private.rd_develop_strategy_design_role_set_attestations_v1 SET canonical_bytes=substring(canonical_bytes FROM 1 FOR length(canonical_bytes)-1) WHERE request_identity=$1::text",
        None,
    ),
    (
        "rd_develop_strategy_design_role_set_attestations_v1.attestation_digest",
        "UPDATE composer_private.rd_develop_strategy_design_role_set_attestations_v1 SET attestation_digest=set_byte(attestation_digest,0,(get_byte(attestation_digest,0)+1)%256) WHERE request_identity=$1::text",
        "UPDATE composer_private.rd_develop_strategy_design_role_set_attestations_v1 SET attestation_digest=set_byte(attestation_digest,0,(get_byte(attestation_digest,0)+255)%256) WHERE request_identity=$1::text",
        None,
    ),
    (
        "rd_develop_outbox_v2.canonical_bytes",
        "UPDATE composer_private.rd_develop_outbox_v2 SET canonical_bytes=canonical_bytes||'\\x00'::bytea WHERE request_identity=$1::text",
        "UPDATE composer_private.rd_develop_outbox_v2 SET canonical_bytes=substring(canonical_bytes FROM 1 FOR length(canonical_bytes)-1) WHERE request_identity=$1::text",
        None,
    ),
];

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

    for (column, tamper, restore, store_refusal) in STORED_COLUMN_TAMPERS {
        let tampered = sqlx::query(*tamper)
            .bind(&locator.request_identity)
            .bind(locator.artifact_identity.as_bytes().as_slice())
            .execute(topology_admin_pool)
            .await;

        if let Some((code, constraint)) = store_refusal {
            // The store itself refuses this change, so there is nothing for the read to see. The
            // exact constraint is pinned: a refusal for any other reason would not be this one.
            assert!(
                matches!(
                    &tampered,
                    Err(sqlx::Error::Database(e))
                        if e.code().as_deref() == Some(*code) && e.constraint() == Some(*constraint)
                ),
                "tamper {column} was not refused by {constraint} ({code}): {tampered:?}",
            );
            assert_eq!(
                restarted
                    .read_accepted(&locator)
                    .await
                    .unwrap_or_else(|e| panic!("read after refused {column}: {e:?}")),
                first,
                "a refused tamper of {column} changed the readback",
            );
            continue;
        }
        let changed = tampered
            .unwrap_or_else(|e| panic!("tamper {column}: {e}"))
            .rows_affected();
        assert_eq!(
            changed, 1,
            "tamper {column} must change exactly one stored row"
        );
        assert_eq!(
            restarted.read_accepted(&locator).await,
            Err(DevelopComposerSealedReadErrorV2::Unavailable),
            "sealed read accepted tampered {column}",
        );
        let restored = sqlx::query(*restore)
            .bind(&locator.request_identity)
            .bind(locator.artifact_identity.as_bytes().as_slice())
            .execute(topology_admin_pool)
            .await
            .unwrap_or_else(|e| panic!("restore {column}: {e}"))
            .rows_affected();
        assert_eq!(
            restored, 1,
            "restore {column} must change exactly one stored row"
        );
        assert_eq!(
            restarted
                .read_accepted(&locator)
                .await
                .unwrap_or_else(|e| panic!("read after restoring {column}: {e:?}")),
            first,
            "restoring {column} did not restore the exact readback",
        );
    }

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

    // The store is shared with the ordered entries before this one; a read that writes
    // nothing leaves every custody count as it found it, whatever it found.
    let before_missing = custody_counts(topology_admin_pool).await;
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
    assert_eq!(custody_counts(topology_admin_pool).await, before_missing);

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
    let sealed_receipt_identities = readback.build_receipt_identities().to_vec();
    let sealed_receipt_bytes = readback
        .build_receipt_bytes()
        .map(<[u8]>::to_vec)
        .collect::<Vec<_>>();
    assert!(readback.build_receipt_tags().iter().all(|tag| *tag == 2));
    // The positive control for the lock census the build-receipt read is held to below: the
    // sealed read takes SHARE on Composer relations, and the census sees it.
    let sealed_locks = composer_locks_held(&mut transaction).await;
    assert!(sealed_locks.stronger_than_access_share > 0);
    // The readback must run on the borrowed backend, inside its transaction: the pid and the
    // transaction-scoped write statistics mean nothing elsewhere. The caller is rd_owner, which
    // past the cutover holds no USAGE on composer_private, so the relation is resolved through
    // the catalog rather than a regclass cast that needs it.
    let (backend_after, has_table_lock, wrote_rows): (i32, bool, bool) = sqlx::query_as(
        "SELECT pg_backend_pid(), EXISTS (
           SELECT 1
             FROM pg_catalog.pg_locks
            WHERE pid=pg_backend_pid()
              AND relation=(
                SELECT class.oid
                  FROM pg_catalog.pg_class class
                  JOIN pg_catalog.pg_namespace namespace ON namespace.oid=class.relnamespace
                 WHERE namespace.nspname='composer_private'
                   AND class.relname='rd_develop_operations_v2'
              )
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

    // The artifact's build receipts are read without a lock of any kind, in a READ ONLY
    // transaction, and they are the receipts the sealed read returns.
    let mut transaction = read_only_transaction(rd_pool).await;
    let receipts = resolve_artifact_build_receipts_v1_in_transaction(
        &mut transaction,
        locator.artifact_identity,
    )
    .await
    .expect("lock-free build receipt read");
    assert_eq!(
        receipts
            .iter()
            .map(|receipt| receipt.receipt_identity())
            .collect::<Vec<_>>(),
        sealed_receipt_identities
    );
    assert_eq!(
        receipts
            .iter()
            .map(|receipt| receipt.canonical_bytes().to_vec())
            .collect::<Vec<_>>(),
        sealed_receipt_bytes
    );
    assert!(receipts.iter().enumerate().all(|(ordinal, receipt)| {
        usize::try_from(receipt.ordinal()).ok() == Some(ordinal)
            && receipt.schema() == ComposerArtifactBuildReceiptSchemaV1::PluginBuildV2
    }));
    let receipt_locks = composer_locks_held(&mut transaction).await;
    assert!(receipt_locks.access_share > 0);
    assert_eq!(receipt_locks.stronger_than_access_share, 0);
    assert_eq!(receipt_locks.advisory, 0);
    assert_eq!(
        resolve_artifact_build_receipts_v1_in_transaction(
            &mut transaction,
            BindingDigest::from_untrusted_bytes([0x12; 32]),
        )
        .await,
        Err(ComposerArtifactBuildReceiptsErrorV1::ArtifactAbsent)
    );
    transaction
        .rollback()
        .await
        .expect("build receipt read rollback");

    // READ ONLY is not what keeps the read lock-free: it lets LOCK TABLE and advisory locks
    // through, and refuses only row locks. The commit cut takes row locks, so it is refused here.
    let mut transaction = read_only_transaction(rd_pool).await;
    let commit_cut = sqlx::query(
        "SELECT request_digest FROM composer_owner_api.lock_develop_composer_commit_cut_v2($1)",
    )
    .bind(&locator.request_identity)
    .fetch_optional(&mut *transaction)
    .await
    .expect_err("row locks are refused in a READ ONLY transaction");
    assert_eq!(sqlstate(&commit_cut).as_deref(), Some("25006"));
    transaction.rollback().await.expect("commit cut rollback");

    // A Composer writer holding the receipts table: the build-receipt read passes it, and the
    // sealed read, which needs SHARE on that table, waits until its lock timeout.
    let mut writer = topology_admin_pool
        .begin()
        .await
        .expect("writer transaction");
    sqlx::query("SET LOCAL ROLE composer_owner")
        .execute(&mut *writer)
        .await
        .expect("writer role");
    sqlx::query("LOCK TABLE composer_private.rd_develop_build_receipts_v3 IN ROW EXCLUSIVE MODE")
        .execute(&mut *writer)
        .await
        .expect("writer table lock");
    let mut reader = lock_timeout_transaction(rd_pool).await;
    assert_eq!(
        resolve_artifact_build_receipts_v1_in_transaction(&mut reader, locator.artifact_identity)
            .await,
        Ok(receipts)
    );
    reader.rollback().await.expect("unblocked reader rollback");
    let mut reader = lock_timeout_transaction(rd_pool).await;
    let sealed_wait =
        sqlx::query("SELECT composer_owner_api.lock_accepted_develop_composer_v2($1)")
            .bind(&locator.request_identity)
            .execute(&mut *reader)
            .await
            .expect_err("the sealed read waits behind the writer");
    assert_eq!(sqlstate(&sealed_wait).as_deref(), Some("55P03"));
    reader.rollback().await.expect("blocked reader rollback");
    writer.rollback().await.expect("writer rollback");

    // Only rd_owner executes the routine. Each refused role holds USAGE on the Composer API
    // schema, so the refusal names the function and not the schema.
    for role in [
        CanonicalOwnerTestRoleV1::RdFactWriter,
        CanonicalOwnerTestRoleV1::MarketDataReader,
        CanonicalOwnerTestRoleV1::MarketDataOwner,
    ] {
        let refused = sqlx::query(
            "SELECT ordinal FROM composer_owner_api.resolve_artifact_build_receipts_v1($1)",
        )
        .bind(locator.artifact_identity.as_bytes().as_slice())
        .fetch_all(mutation.pool(role))
        .await
        .expect_err("only rd_owner executes the build receipt read");
        assert_eq!(sqlstate(&refused).as_deref(), Some("42501"), "{role:?}");
        assert!(
            refused
                .to_string()
                .contains("permission denied for function resolve_artifact_build_receipts_v1"),
            "{role:?}: {refused}"
        );
    }
    assert_eq!(custody_counts(topology_admin_pool).await, before);
}

#[cfg(feature = "sealed-develop-composer-acceptance")]
struct ComposerLocksHeld {
    access_share: i64,
    stronger_than_access_share: i64,
    advisory: i64,
}

/// Counts the locks this backend holds on Composer private relations, and its advisory locks.
///
/// The caller is rd_owner, which holds no USAGE on composer_private, so relations are named
/// through the catalog.
#[cfg(feature = "sealed-develop-composer-acceptance")]
async fn composer_locks_held(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
) -> ComposerLocksHeld {
    let (access_share, stronger_than_access_share, advisory): (i64, i64, i64) = sqlx::query_as(
        "SELECT count(*) FILTER (WHERE held.locktype='relation' AND namespace.nspname='composer_private' AND held.mode='AccessShareLock'),
                count(*) FILTER (WHERE held.locktype='relation' AND namespace.nspname='composer_private' AND held.mode<>'AccessShareLock'),
                count(*) FILTER (WHERE held.locktype='advisory')
           FROM pg_catalog.pg_locks held
           LEFT JOIN pg_catalog.pg_class class ON class.oid=held.relation
           LEFT JOIN pg_catalog.pg_namespace namespace ON namespace.oid=class.relnamespace
          WHERE held.pid=pg_catalog.pg_backend_pid()",
    )
    .fetch_one(&mut **transaction)
    .await
    .expect("lock census");
    ComposerLocksHeld {
        access_share,
        stronger_than_access_share,
        advisory,
    }
}

#[cfg(feature = "sealed-develop-composer-acceptance")]
async fn read_only_transaction(pool: &sqlx::PgPool) -> sqlx::Transaction<'static, sqlx::Postgres> {
    let mut transaction = pool.begin().await.expect("read-only transaction");
    sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
        .execute(&mut *transaction)
        .await
        .expect("read-only isolation");
    transaction
}

#[cfg(feature = "sealed-develop-composer-acceptance")]
async fn lock_timeout_transaction(
    pool: &sqlx::PgPool,
) -> sqlx::Transaction<'static, sqlx::Postgres> {
    let mut transaction = pool.begin().await.expect("reader transaction");
    sqlx::query("SET LOCAL lock_timeout='200ms'")
        .execute(&mut *transaction)
        .await
        .expect("reader lock timeout");
    transaction
}

#[cfg(feature = "sealed-develop-composer-acceptance")]
fn sqlstate(error: &sqlx::Error) -> Option<String> {
    error
        .as_database_error()
        .and_then(sqlx::error::DatabaseError::code)
        .map(std::borrow::Cow::into_owned)
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

    let mut transaction = rd_pool.begin().await.expect("begin restored-ACL read");
    owner
        .read_accepted_in_transaction(&mut transaction, &locator)
        .await
        .expect("positive read after the public ACL is restored");
    transaction
        .rollback()
        .await
        .expect("rollback restored-ACL read");

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

    // Past the cutover no foreign role holds CREATE on composer_private, and PostgreSQL gives a
    // relation only to a role that does: the wrong owner cannot be injected at all. The read
    // never sees a wrong owner because the store refuses to make one.
    let refused = sqlx::query(
        "ALTER TABLE composer_private.rd_develop_operations_v2 OWNER TO replay_policy_catalog_owner",
    )
    .execute(topology_admin_pool)
    .await;
    assert!(matches!(
        refused,
        Err(sqlx::Error::Database(e)) if e.code().as_deref() == Some("42501")
    ));
    let table_owner: String = sqlx::query_scalar(
        "SELECT pg_catalog.pg_get_userbyid(relowner) FROM pg_catalog.pg_class class JOIN pg_catalog.pg_namespace namespace ON namespace.oid=class.relnamespace WHERE namespace.nspname='composer_private' AND class.relname='rd_develop_operations_v2'",
    )
    .fetch_one(topology_admin_pool)
    .await
    .expect("Composer table owner");
    assert_eq!(table_owner, "composer_owner");
    let mut transaction = rd_pool.begin().await.expect("caller transaction");
    owner
        .read_accepted_in_transaction(&mut transaction, &locator)
        .await
        .expect("read stays positive under the owner the store keeps");
    transaction
        .rollback()
        .await
        .expect("positive read rollback");

    let original_research_request_identity: Vec<u8> = sqlx::query_scalar(
        "SELECT research_request_identity FROM composer_private.rd_develop_operations_v2 WHERE request_identity=$1",
    )
    .bind(&locator.request_identity)
    .fetch_one(topology_admin_pool)
    .await
    .expect("stored Research binding");
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

    // The store is shared with every later sealed read; the binding goes back exactly, and the
    // read that was refused is positive again.
    sqlx::query(
        "UPDATE composer_private.rd_develop_operations_v2 SET research_request_identity=$1 WHERE request_identity=$2",
    )
    .bind(&original_research_request_identity)
    .bind(&locator.request_identity)
    .execute(topology_admin_pool)
    .await
    .expect("restore Research binding");
    let mut transaction = rd_pool.begin().await.expect("caller transaction");
    owner
        .read_accepted_in_transaction(&mut transaction, &locator)
        .await
        .expect("restored binding reads back positive");
    transaction
        .rollback()
        .await
        .expect("restored read rollback");
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
