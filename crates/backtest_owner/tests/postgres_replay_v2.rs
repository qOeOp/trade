// This macro keeps the storage test inside the library crate. Its private result fixture exercises
// only durable-storage semantics; it is not evidence of a Market -> runner -> U2 composition path.
#[macro_export]
macro_rules! postgres_replay_v2_tests {
    () => {
        #[cfg(test)]
        mod durable_postgres_replay_v2 {
            use std::time::{Duration, Instant};

            use sqlx::{PgPool, Row};
            use vibe_backtest_owner_contracts::{
                ComponentObservationLocatorV2, DiagnosticCategoryV2, ObservationComponentV2,
                VersionedIdentityV2,
            };
            use vibe_backtest_result_custody::{
                ExploratoryResultCustodyQueryV1, ExploratoryResultLocatorV1,
                lock_exploratory_result_v1_in_transaction,
            };
            use vibe_strategy_factory::{
                exploratory_replay::ExploratoryReplayRequestLocatorV2,
                product_edge_postgres::PostgresResearchGoalOwnerV1,
            };
            use vibe_testkit::postgres::{
                CanonicalOwnerPostgresTestDatabaseV1, CanonicalOwnerTestRoleV1,
            };

            use super::*;
            use $crate::{
                ConsumedComponentObservationV2, DiagnosticEvidenceV2, OwnerResultDraftV2,
                ReplayOwnerErrorV2, commit_owner_result, requested_component_meanings,
            };

            #[test]
            fn writer_shape_oracles_freeze_collation_index_and_dependency_identity() {
                for shape in [STORAGE_SHAPE_V2, AUXILIARY_STORAGE_SHAPE_V1] {
                    assert!(shape.contains("attribute.attcollation"));
                    assert!(shape.contains("pg_catalog.\"C\""));
                    assert!(shape.contains("operator_class.opcname<>'text_ops'"));
                    assert!(shape.contains("index_entry.indcollation[key_position]"));
                    assert!(shape.contains("index_entry.indoption[key_position]"));
                    assert!(shape.contains("dependency_entry.deptype IN ('e','x')"));
                    assert!(shape.contains("reltoastrelid"));
                }
            }

            #[tokio::test]
            #[ignore = "requires explicit disposable bootstrap DDL authority"]
            async fn canonical_backtest_role_materializes_owned_storage_once() {
                let database = CanonicalOwnerPostgresTestDatabaseV1::admit()
                    .await
                    .expect("canonical disposable topology");
                let backtest_url = database
                    .database_url(CanonicalOwnerTestRoleV1::BacktestOwner)
                    .to_string();
                PostgresReplayResultOwnerV2::bootstrap_storage(&backtest_url)
                    .await
                    .expect("explicit bootstrap authority materializes Backtest storage");
            }

            #[tokio::test]
            #[ignore = "requires a disposable malformed existing Backtest schema"]
            async fn bootstrap_rejects_malformed_existing_storage_schema() {
                let database = CanonicalOwnerPostgresTestDatabaseV1::admit()
                    .await
                    .expect("canonical disposable topology");
                let backtest_url = database
                    .database_url(CanonicalOwnerTestRoleV1::BacktestOwner)
                    .to_string();
                assert_eq!(
                    PostgresReplayResultOwnerV2::bootstrap_storage(&backtest_url)
                        .await
                        .expect_err("bootstrap must not adopt malformed existing storage"),
                    PostgresReplayOwnerErrorV2::StorageUnavailable
                );
            }

            #[tokio::test]
            #[ignore = "requires canonical Backtest storage with dropped receipt uniqueness"]
            async fn bootstrap_rejects_auxiliary_dropped_uniqueness() {
                let database = CanonicalOwnerPostgresTestDatabaseV1::admit()
                    .await
                    .expect("canonical disposable topology");
                let backtest_url = database
                    .database_url(CanonicalOwnerTestRoleV1::BacktestOwner)
                    .to_string();
                assert_eq!(
                    PostgresReplayResultOwnerV2::bootstrap_storage(&backtest_url)
                        .await
                        .expect_err("bootstrap must not adopt an auxiliary table without exact uniqueness"),
                    PostgresReplayOwnerErrorV2::StorageUnavailable
                );
                assert_eq!(total_counts(&backtest_url).await, [0, 0, 0, 0]);
            }

            #[tokio::test]
            #[ignore = "requires canonical Backtest storage with a preexisting external inbound FK"]
            async fn bootstrap_rejects_preexisting_external_inbound_fk() {
                let database = CanonicalOwnerPostgresTestDatabaseV1::admit()
                    .await
                    .expect("canonical disposable topology");
                let backtest_url = database
                    .database_url(CanonicalOwnerTestRoleV1::BacktestOwner)
                    .to_string();
                assert_eq!(
                    PostgresReplayResultOwnerV2::bootstrap_storage(&backtest_url)
                        .await
                        .expect_err("bootstrap must reject an external inbound FK"),
                    PostgresReplayOwnerErrorV2::StorageUnavailable
                );
            }

            #[tokio::test]
            #[ignore = "requires canonical Backtest storage with a preexisting external view"]
            async fn runtime_connect_rejects_preexisting_external_view() {
                let database = CanonicalOwnerPostgresTestDatabaseV1::admit()
                    .await
                    .expect("canonical disposable topology");
                let backtest_url = database
                    .database_url(CanonicalOwnerTestRoleV1::BacktestOwner)
                    .to_string();
                let mutation = database.mutation();
                let rd_pool = mutation.pool(CanonicalOwnerTestRoleV1::RdOwner);
                let view_privileges: (bool, bool) = sqlx::query_as(
                    "SELECT pg_catalog.has_table_privilege(current_user,'public.backtest_external_runs_v2','SELECT'),pg_catalog.has_table_privilege(current_user,'public.backtest_external_runs_v2','DELETE')",
                )
                .fetch_one(rd_pool)
                .await
                .expect("external-view grant readback");
                assert_eq!(
                    view_privileges,
                    (true, true),
                    "fixture must expose the rejected SELECT/DELETE escape"
                );

                assert_eq!(
                    PostgresReplayResultOwnerV2::connect(&backtest_url)
                        .await
                        .expect_err("runtime connect must reject an external storage view"),
                    PostgresReplayOwnerErrorV2::CustodyUnavailable
                );
            }

            #[tokio::test]
            #[ignore = "requires canonical Backtest storage with a preexisting external view"]
            async fn bootstrap_rejects_preexisting_external_view() {
                let database = CanonicalOwnerPostgresTestDatabaseV1::admit()
                    .await
                    .expect("canonical disposable topology");
                let backtest_url = database
                    .database_url(CanonicalOwnerTestRoleV1::BacktestOwner)
                    .to_string();

                assert_eq!(
                    PostgresReplayResultOwnerV2::bootstrap_storage(&backtest_url)
                        .await
                        .expect_err("bootstrap must reject an external storage view"),
                    PostgresReplayOwnerErrorV2::StorageUnavailable
                );
            }

            #[tokio::test]
            #[ignore = "requires a disposable topology with a controlled pre-persist revocation function"]
            async fn revocation_between_validation_and_insert_writes_nothing() {
                let (backtest_url, _, request_owner, locator, result) =
                    seeded_storage_context('a').await;
                let owner = PostgresReplayResultOwnerV2::connect(&backtest_url)
                    .await
                    .expect("Backtest result Owner");

                let commit = owner
                    .commit_with_pre_persist_revocation_for_test(
                        &request_owner,
                        &locator,
                        &result,
                    )
                    .await;

                assert_eq!(
                    total_counts(&backtest_url).await,
                    [0, 0, 0, 0],
                    "revocation immediately before the run insert must win"
                );
                assert_eq!(
                    commit.expect_err("revoked request must not commit"),
                    PostgresReplayOwnerErrorV2::RequestUnavailable
                );
            }

            #[tokio::test]
            #[ignore = "requires a seeded Replay V2 request and replaceable R&D internal helper"]
            async fn existing_handle_rejects_forged_internal_v1_helper_before_rows() {
                assert_forged_internal_helper_fails_closed(
                    "rd_owner_api.verify_exploratory_replay_request_internal_v1(text,text,text)",
                    r#"
CREATE OR REPLACE FUNCTION rd_owner_api.verify_exploratory_replay_request_internal_v1(
  requested_request_identity text,
  requested_request_digest text,
  requested_receipt_identity text
) RETURNS jsonb LANGUAGE plpgsql STRICT VOLATILE PARALLEL UNSAFE SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
BEGIN
  RETURN pg_catalog.jsonb_build_object(
    'schema_version', 1,
    'availability', 'AVAILABLE',
    'forged_helper_source', 'FORGED_INTERNAL_V1'
  );
END
$function$
"#,
                    "FORGED_INTERNAL_V1",
                    'e',
                )
                .await;
            }

            #[tokio::test]
            #[ignore = "requires a seeded Replay V2 request and replaceable R&D internal helper"]
            async fn existing_handle_rejects_forged_internal_v2_helper_before_rows() {
                assert_forged_internal_helper_fails_closed(
                    "rd_owner_api.verify_exploratory_replay_request_internal_v2(text,text,text,text)",
                    r#"
CREATE OR REPLACE FUNCTION rd_owner_api.verify_exploratory_replay_request_internal_v2(
  requested_request_identity text,
  requested_meaning_digest text,
  requested_receipt_identity text,
  requested_seal_digest text
) RETURNS jsonb LANGUAGE plpgsql STRICT VOLATILE PARALLEL UNSAFE SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
BEGIN
  RETURN pg_catalog.jsonb_build_object(
    'schema_version', 2,
    'availability', 'AVAILABLE',
    'forged_helper_source', 'FORGED_INTERNAL_V2'
  );
END
$function$
"#,
                    "FORGED_INTERNAL_V2",
                    'f',
                )
                .await;
            }

            #[tokio::test]
            #[ignore = "requires a seeded Replay V2 request and replaceable R&D lock facade"]
            async fn existing_handle_rejects_forged_lock_facade_before_rows() {
                let (backtest_url, rd_url, request_owner, locator, result) =
                    seeded_storage_context('8').await;
                let owner = PostgresReplayResultOwnerV2::connect(&backtest_url)
                    .await
                    .expect("clean Backtest runtime handle before R&D facade drift");
                let backtest_pool = PgPool::connect(&backtest_url)
                    .await
                    .expect("Backtest facade verification pool");
                let rd_pool = PgPool::connect(&rd_url)
                    .await
                    .expect("R&D facade replacement pool");
                let facade_regprocedure =
                    "rd_owner_api.lock_exploratory_replay_request_v2(text,text,text,text)";
                let canonical_definition: String = sqlx::query_scalar(
                    "SELECT pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure($1))",
                )
                .bind(facade_regprocedure)
                .fetch_one(&rd_pool)
                .await
                .expect("capture canonical lock facade definition");
                let canonical_acl: String = sqlx::query_scalar(
                    "SELECT facade.proacl::text FROM pg_catalog.pg_proc facade WHERE facade.oid=pg_catalog.to_regprocedure($1)",
                )
                .bind(facade_regprocedure)
                .fetch_one(&rd_pool)
                .await
                .expect("capture canonical lock facade ACL");
                let canonical_available: serde_json::Value = sqlx::query_scalar(
                    "SELECT rd_owner_api.lock_exploratory_replay_request_v2($1,$2,$3,$4)",
                )
                .bind(&locator.request_identity)
                .bind(&locator.meaning_digest)
                .bind(&locator.receipt_identity)
                .bind(&locator.seal_digest)
                .fetch_one(&backtest_pool)
                .await
                .expect("capture exact canonical AVAILABLE envelope before revocation");
                assert_eq!(canonical_available["availability"], "AVAILABLE");

                sqlx::query(
                    "GRANT EXECUTE ON FUNCTION rd_owner_api.lock_exploratory_replay_request_v2(text,text,text,text) TO rd_owner",
                )
                .execute(&rd_pool)
                .await
                .expect("temporarily allow R&D Owner to replace its lock facade");
                let forged_source = format!(
                    r#"
CREATE OR REPLACE FUNCTION rd_owner_api.lock_exploratory_replay_request_v2(
  requested_request_identity text,
  requested_meaning_digest text,
  requested_receipt_identity text,
  requested_seal_digest text
) RETURNS jsonb LANGUAGE plpgsql STRICT VOLATILE PARALLEL UNSAFE SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  IF false THEN
    RETURN rd_owner_api.verify_exploratory_replay_request_internal_v2(
      requested_request_identity,
      requested_meaning_digest,
      requested_receipt_identity,
      requested_seal_digest
    );
  END IF;
  RETURN $canonical${}$canonical$::pg_catalog.jsonb;
END
$function$
"#,
                    canonical_available
                );
                sqlx::query(sqlx::AssertSqlSafe(forged_source.as_str()))
                .execute(&rd_pool)
                .await
                .expect("current non-superuser R&D Owner installs a canonical-envelope non-locking facade");
                sqlx::query(
                    "REVOKE EXECUTE ON FUNCTION rd_owner_api.lock_exploratory_replay_request_v2(text,text,text,text) FROM rd_owner",
                )
                .execute(&rd_pool)
                .await
                .expect("restore canonical lock facade ACL before Backtest readback");
                let forged_catalog_is_equivalent: bool = sqlx::query_scalar(
                    "SELECT owner.rolname='rd_owner'
                         AND facade.prosecdef
                         AND facade.provolatile='v'
                         AND facade.proparallel='u'
                         AND facade.proisstrict
                         AND facade.proconfig=ARRAY['search_path=pg_catalog']::text[]
                         AND facade.prorettype='pg_catalog.jsonb'::pg_catalog.regtype
                         AND facade.proargtypes='25 25 25 25'::pg_catalog.oidvector
                         AND pg_catalog.md5(facade.prosrc)<>'298960419b17ff770dbd13ac2765f93a'
                         AND facade.proacl::text=$2
                         AND pg_catalog.has_function_privilege('backtest_owner',facade.oid,'EXECUTE')
                         AND EXISTS (
                           SELECT 1 FROM pg_catalog.aclexplode(facade.proacl) acl
                            JOIN pg_catalog.pg_roles backtest ON backtest.oid=acl.grantee
                           WHERE backtest.rolname='backtest_owner'
                             AND acl.grantor=owner.oid
                             AND acl.privilege_type='EXECUTE'
                             AND NOT acl.is_grantable
                         )
                       FROM pg_catalog.pg_proc facade
                       JOIN pg_catalog.pg_roles owner ON owner.oid=facade.proowner
                      WHERE facade.oid=pg_catalog.to_regprocedure($1)",
                )
                .bind(facade_regprocedure)
                .bind(&canonical_acl)
                .fetch_one(&rd_pool)
                .await
                .expect("forged facade catalog readback");
                assert!(
                    forged_catalog_is_equivalent,
                    "fixture must preserve facade metadata and explicit Backtest ACL"
                );
                let mut forged_transaction = backtest_pool
                    .begin()
                    .await
                    .expect("hold the non-locking facade transaction open");
                let forged: serde_json::Value = sqlx::query_scalar(
                    "SELECT rd_owner_api.lock_exploratory_replay_request_v2($1,$2,$3,$4)",
                )
                .bind(&locator.request_identity)
                .bind(&locator.meaning_digest)
                .bind(&locator.receipt_identity)
                .bind(&locator.seal_digest)
                .fetch_one(&mut *forged_transaction)
                .await
                .expect("non-locking facade returns the pre-revocation canonical envelope");
                assert_eq!(forged, canonical_available);
                let revoked = sqlx::query(
                    "UPDATE public.rd_sealed_exploratory_replay_requests_v1 SET lifecycle_state='REVOKED' WHERE request_identity=$1 AND request_schema_version=2 AND lifecycle_state='FROZEN'",
                )
                .bind(&locator.request_identity)
                .execute(&rd_pool)
                .await
                .expect("revocation must complete while the forged facade transaction remains open");
                assert_eq!(revoked.rows_affected(), 1);

                let commit = owner
                    .commit_exploratory_replay_result_v2(&request_owner, &locator, &result)
                    .await;
                forged_transaction
                    .rollback()
                    .await
                    .expect("release forged facade transaction");

                sqlx::query(
                    "GRANT EXECUTE ON FUNCTION rd_owner_api.lock_exploratory_replay_request_v2(text,text,text,text) TO rd_owner",
                )
                .execute(&rd_pool)
                .await
                .expect("temporarily allow R&D Owner to restore its lock facade");
                sqlx::query(sqlx::AssertSqlSafe(canonical_definition.as_str()))
                    .execute(&rd_pool)
                    .await
                    .expect("restore canonical lock facade definition");
                sqlx::query(
                    "REVOKE EXECUTE ON FUNCTION rd_owner_api.lock_exploratory_replay_request_v2(text,text,text,text) FROM rd_owner",
                )
                .execute(&rd_pool)
                .await
                .expect("restore canonical lock facade ACL after source cleanup");
                let restored_facade_is_canonical: bool = sqlx::query_scalar(
                    "SELECT pg_catalog.pg_get_functiondef(facade.oid)=$2
                         AND facade.proacl::text=$3
                       FROM pg_catalog.pg_proc facade
                      WHERE facade.oid=pg_catalog.to_regprocedure($1)",
                )
                .bind(facade_regprocedure)
                .bind(&canonical_definition)
                .bind(&canonical_acl)
                .fetch_one(&rd_pool)
                .await
                .expect("canonical lock facade source and ACL cleanup readback");
                assert!(
                    restored_facade_is_canonical,
                    "fixture cleanup must restore canonical facade source and ACL"
                );
                let restored = sqlx::query(
                    "UPDATE public.rd_sealed_exploratory_replay_requests_v1 SET lifecycle_state='FROZEN' WHERE request_identity=$1 AND request_schema_version=2 AND lifecycle_state='REVOKED'",
                )
                .bind(&locator.request_identity)
                .execute(&rd_pool)
                .await
                .expect("restore exact seeded request lifecycle");
                assert_eq!(restored.rows_affected(), 1);

                assert_eq!(
                    commit.expect_err("forged lock facade must reject before persistence"),
                    PostgresReplayOwnerErrorV2::RequestUnavailable
                );
                assert_eq!(total_counts(&backtest_url).await, [0, 0, 0, 0]);
            }

            #[tokio::test]
            #[ignore = "requires a disposable topology with a committed Replay V2 result"]
            async fn tampered_request_seal_digest_fails_closed_after_restart() {
                assert_binding_tamper_fails_closed(
                    "UPDATE public.backtest_replay_runs_v2 SET request_seal_digest=request_seal_digest || '-tampered' WHERE result_identity=$1",
                    'b',
                )
                .await;
            }

            #[tokio::test]
            #[ignore = "requires a disposable topology with a committed Replay V2 result"]
            async fn tampered_rd_receipt_identity_fails_closed_after_restart() {
                assert_binding_tamper_fails_closed(
                    "UPDATE public.backtest_replay_runs_v2 SET rd_receipt_identity='tampered-rd-receipt-v2' WHERE result_identity=$1",
                    'c',
                )
                .await;
            }

            #[tokio::test]
            #[ignore = "requires bootstrap to clear a poisoned named-role ACL"]
            async fn bootstrap_clears_poisoned_named_role_acl() {
                let database = CanonicalOwnerPostgresTestDatabaseV1::admit()
                    .await
                    .expect("canonical disposable topology");
                let backtest_url = database
                    .database_url(CanonicalOwnerTestRoleV1::BacktestOwner)
                    .to_string();
                let mutation = database.mutation();
                let rd_pool = mutation.pool(CanonicalOwnerTestRoleV1::RdOwner);

                PostgresReplayResultOwnerV2::connect(&backtest_url)
                    .await
                    .expect("runtime connect after bootstrap ACL cleanup");
                let retained_poison: bool = sqlx::query_scalar(
                    "SELECT pg_catalog.has_table_privilege(current_user,'public.backtest_replay_runs_v2','SELECT') OR pg_catalog.has_table_privilege(current_user,'public.backtest_replay_results_v2','SELECT')",
                )
                .fetch_one(rd_pool)
                .await
                .expect("named-role ACL readback");
                assert!(!retained_poison, "bootstrap must clear named-role ACLs");
            }

            #[tokio::test]
            #[ignore = "requires a disposable topology with a post-bootstrap named-role regrant"]
            async fn runtime_connect_rejects_post_bootstrap_named_role_acl() {
                let database = CanonicalOwnerPostgresTestDatabaseV1::admit()
                    .await
                    .expect("canonical disposable topology");
                let backtest_url = database
                    .database_url(CanonicalOwnerTestRoleV1::BacktestOwner)
                    .to_string();

                PostgresReplayResultOwnerV2::connect(&backtest_url)
                    .await
                    .expect_err("runtime connect must reject a named-role ACL regrant");
            }

            #[tokio::test]
            #[ignore = "requires a disposable topology with a clean runtime followed by ACL drift"]
            async fn existing_handle_rejects_post_connect_named_role_acl() {
                let database = CanonicalOwnerPostgresTestDatabaseV1::admit()
                    .await
                    .expect("canonical disposable topology");
                let backtest_url = database
                    .database_url(CanonicalOwnerTestRoleV1::BacktestOwner)
                    .to_string();
                let owner = PostgresReplayResultOwnerV2::connect(&backtest_url)
                    .await
                    .expect("clean Backtest runtime handle");
                let mutation = database.mutation();
                let backtest_pool = mutation.pool(CanonicalOwnerTestRoleV1::BacktestOwner);

                sqlx::query("GRANT SELECT ON public.backtest_replay_runs_v2 TO rd_owner")
                    .execute(backtest_pool)
                    .await
                    .expect("inject post-connect ACL drift");
                let result = owner.read_result_v2(&identity("absent-result-v2")).await;
                sqlx::query("REVOKE ALL ON public.backtest_replay_runs_v2 FROM rd_owner")
                    .execute(backtest_pool)
                    .await
                    .expect("clear post-connect ACL drift");

                assert_eq!(
                    result.expect_err("existing handle must revalidate ACL before read"),
                    PostgresReplayOwnerErrorV2::CustodyUnavailable
                );
            }

            #[tokio::test]
            #[ignore = "requires a disposable topology with a post-connect undeclared trigger"]
            async fn existing_handle_rejects_post_connect_storage_trigger() {
                let database = CanonicalOwnerPostgresTestDatabaseV1::admit()
                    .await
                    .expect("canonical disposable topology");
                let backtest_url = database
                    .database_url(CanonicalOwnerTestRoleV1::BacktestOwner)
                    .to_string();
                let owner = PostgresReplayResultOwnerV2::connect(&backtest_url)
                    .await
                    .expect("clean Backtest runtime handle");
                let mutation = database.mutation();
                let backtest_pool = mutation.pool(CanonicalOwnerTestRoleV1::BacktestOwner);

                sqlx::query(
                    "CREATE TRIGGER aaa_test_undeclared_backtest_trigger BEFORE INSERT ON public.backtest_replay_runs_v2 FOR EACH STATEMENT EXECUTE FUNCTION vibe_test_admin.noop_backtest_trigger_v2()",
                )
                .execute(backtest_pool)
                .await
                .expect("inject post-connect storage trigger");
                let result = owner.read_result_v2(&identity("absent-result-v2")).await;
                sqlx::query(
                    "DROP TRIGGER aaa_test_undeclared_backtest_trigger ON public.backtest_replay_runs_v2",
                )
                .execute(backtest_pool)
                .await
                .expect("clear post-connect storage trigger");

                assert_eq!(
                    result.expect_err("existing handle must reject undeclared storage trigger"),
                    PostgresReplayOwnerErrorV2::CustodyUnavailable
                );
            }

            #[tokio::test]
            #[ignore = "requires a seeded Replay V2 request and a conflicting table lock"]
            async fn runtime_lock_conflict_fails_closed_near_one_second() {
                let (backtest_url, _, request_owner, locator, sealed_result) =
                    seeded_storage_context('b').await;
                let owner = PostgresReplayResultOwnerV2::connect(&backtest_url)
                    .await
                    .expect("clean Backtest runtime handle");
                let backtest_pool = PgPool::connect(&backtest_url)
                    .await
                    .expect("Backtest lock blocker pool");
                let mut blocker = backtest_pool.begin().await.expect("lock blocker transaction");
                sqlx::query("LOCK TABLE public.backtest_replay_runs_v2 IN SHARE MODE")
                    .execute(&mut *blocker)
                    .await
                    .expect("conflicting table lock");

                let started = Instant::now();
                let result = owner
                    .commit_exploratory_replay_result_v2(
                        &request_owner,
                        &locator,
                        &sealed_result,
                    )
                    .await;
                let elapsed = started.elapsed();
                blocker.rollback().await.expect("release conflicting lock");

                assert_eq!(
                    result.expect_err("runtime write lock wait must fail closed"),
                    PostgresReplayOwnerErrorV2::CustodyUnavailable
                );
                assert!(
                    elapsed >= Duration::from_millis(850)
                        && elapsed < Duration::from_secs(4),
                    "lock wait must remain bounded near one second: {elapsed:?}"
                );
                assert_eq!(total_counts(&backtest_url).await, [0, 0, 0, 0]);
            }

            #[tokio::test]
            #[ignore = "requires a disposable topology with a concurrent ACCESS SHARE reader"]
            async fn runtime_allows_concurrent_access_share_reader() {
                let database = CanonicalOwnerPostgresTestDatabaseV1::admit()
                    .await
                    .expect("canonical disposable topology");
                let backtest_url = database
                    .database_url(CanonicalOwnerTestRoleV1::BacktestOwner)
                    .to_string();
                let owner = PostgresReplayResultOwnerV2::connect(&backtest_url)
                    .await
                    .expect("clean Backtest runtime handle");
                let mutation = database.mutation();
                let backtest_pool = mutation.pool(CanonicalOwnerTestRoleV1::BacktestOwner);
                let mut reader = backtest_pool.begin().await.expect("reader transaction");
                sqlx::query("LOCK TABLE public.backtest_replay_runs_v2 IN ACCESS SHARE MODE")
                    .execute(&mut *reader)
                    .await
                    .expect("concurrent ACCESS SHARE lock");

                assert!(
                    owner
                        .read_result_v2(&identity("absent-result-v2"))
                        .await
                        .expect("legal concurrent read must remain admitted")
                        .is_none()
                );
                reader.rollback().await.expect("release reader lock");
                assert_eq!(total_counts(&backtest_url).await, [0, 0, 0, 0]);
            }

            #[tokio::test]
            #[ignore = "requires a disposable topology with a SET-only Backtest role member"]
            async fn runtime_rejects_set_only_role_impersonation() {
                let database = CanonicalOwnerPostgresTestDatabaseV1::admit()
                    .await
                    .expect("canonical disposable topology");
                let backtest_url = database
                    .database_url(CanonicalOwnerTestRoleV1::BacktestOwner)
                    .to_string();
                let product_edge_url = database
                    .database_url(CanonicalOwnerTestRoleV1::ProductEdgeOwner)
                    .to_string();
                let impersonator_url =
                    format!("{product_edge_url}?options=-c%20role%3Dbacktest_owner");

                PostgresReplayResultOwnerV2::connect(&backtest_url)
                    .await
                    .expect_err("runtime must reject any SET-only Backtest membership path");
                PostgresReplayResultOwnerV2::connect(&impersonator_url)
                    .await
                    .expect_err("session user must not impersonate the Backtest owner via SET ROLE");
            }

            #[tokio::test]
            #[ignore = "requires post-bootstrap Backtest SET membership into R&D Owner"]
            async fn runtime_rejects_backtest_set_membership_into_rd_owner() {
                let database = CanonicalOwnerPostgresTestDatabaseV1::admit()
                    .await
                    .expect("canonical disposable topology");
                let backtest_url = database
                    .database_url(CanonicalOwnerTestRoleV1::BacktestOwner)
                    .to_string();
                PostgresReplayResultOwnerV2::connect(&backtest_url)
                    .await
                    .expect_err("Backtest must not inherit or SET ROLE into R&D Owner");
            }

            #[tokio::test]
            #[ignore = "requires an unknown capability-bearing role granted to Backtest and R&D"]
            async fn writer_and_reader_reject_unknown_capability_role_membership() {
                let database = CanonicalOwnerPostgresTestDatabaseV1::admit()
                    .await
                    .expect("canonical disposable topology");
                let backtest_url = database
                    .database_url(CanonicalOwnerTestRoleV1::BacktestOwner)
                    .to_string();
                let rd_url = database
                    .database_url(CanonicalOwnerTestRoleV1::RdOwner)
                    .to_string();
                PostgresReplayResultOwnerV2::connect(&backtest_url)
                    .await
                    .expect_err("writer must reject an unknown capability role membership");
                let rd_pool = PgPool::connect(&rd_url).await.expect("R&D custody-reader pool");
                let mut transaction = rd_pool.begin().await.expect("R&D caller transaction");
                let read = lock_exploratory_result_v1_in_transaction(
                    &mut transaction,
                    &absent_result_custody_query(),
                )
                .await;
                transaction
                    .rollback()
                    .await
                    .expect("rollback rejected custody read");
                assert!(
                    read.is_err(),
                    "reader must reject an unknown capability role membership"
                );
            }

            #[tokio::test]
            #[ignore = "requires post-connect Backtest membership into Product Edge Owner"]
            async fn existing_handle_rejects_product_edge_owner_membership() {
                let database = CanonicalOwnerPostgresTestDatabaseV1::admit()
                    .await
                    .expect("canonical disposable topology");
                let backtest_url = database
                    .database_url(CanonicalOwnerTestRoleV1::BacktestOwner)
                    .to_string();
                let owner = PostgresReplayResultOwnerV2::connect(&backtest_url)
                    .await
                    .expect("clean Backtest runtime handle");
                let mutation = database.mutation();
                let mutation_pool = mutation.pool(CanonicalOwnerTestRoleV1::BacktestOwner);
                sqlx::query("SELECT vibe_test_admin.set_replay_owner_membership_v1('backtest_owner','product_edge_owner',true)")
                    .execute(mutation_pool)
                    .await
                    .expect("inject Product Edge Owner membership after connect");
                let read = owner.read_result_v2(&identity("absent-result-v2")).await;
                sqlx::query("SELECT vibe_test_admin.set_replay_owner_membership_v1('backtest_owner','product_edge_owner',false)")
                    .execute(mutation_pool)
                    .await
                    .expect("clear Product Edge Owner membership");
                assert_eq!(
                    read.expect_err("existing handle must reject Product Edge Owner membership"),
                    PostgresReplayOwnerErrorV2::CustodyUnavailable
                );
                assert_eq!(total_counts(&backtest_url).await, [0, 0, 0, 0]);
            }

            #[tokio::test]
            #[ignore = "requires post-connect R&D membership into Qualification Owner"]
            async fn result_reader_rejects_qualification_owner_membership() {
                let database = CanonicalOwnerPostgresTestDatabaseV1::admit()
                    .await
                    .expect("canonical disposable topology");
                let rd_url = database
                    .database_url(CanonicalOwnerTestRoleV1::RdOwner)
                    .to_string();
                let mutation = database.mutation();
                let backtest_pool = mutation.pool(CanonicalOwnerTestRoleV1::BacktestOwner);
                let rd_pool = PgPool::connect(&rd_url)
                    .await
                    .expect("clean R&D custody-reader pool");
                let mut transaction = rd_pool.begin().await.expect("R&D caller transaction");
                sqlx::query("SELECT vibe_test_admin.set_replay_owner_membership_v1('rd_owner','qualification_owner',true)")
                    .execute(backtest_pool)
                    .await
                    .expect("inject Qualification Owner membership after transaction start");
                let read = lock_exploratory_result_v1_in_transaction(
                    &mut transaction,
                    &absent_result_custody_query(),
                )
                .await;
                transaction.rollback().await.expect("rollback rejected custody read");
                sqlx::query("SELECT vibe_test_admin.set_replay_owner_membership_v1('rd_owner','qualification_owner',false)")
                    .execute(backtest_pool)
                    .await
                    .expect("clear Qualification Owner membership");
                assert!(read.is_err(), "reader must reject Qualification Owner membership");
            }

            #[tokio::test]
            #[ignore = "requires post-connect Backtest membership into Qualification Writer"]
            async fn writer_and_request_lock_reject_qualification_writer_membership() {
                let (backtest_url, _, request_owner, locator, result) =
                    seeded_storage_context('7').await;
                let owner = PostgresReplayResultOwnerV2::connect(&backtest_url)
                    .await
                    .expect("clean Backtest runtime handle");
                let mutation_pool = PgPool::connect(&backtest_url)
                    .await
                    .expect("Backtest role-graph mutation pool");
                sqlx::query("SELECT vibe_test_admin.set_replay_owner_membership_v1('backtest_owner','qualification_writer',true)")
                    .execute(&mutation_pool)
                    .await
                    .expect("inject Qualification Writer membership after connect");

                let read = owner.read_result_v2(result.result_identity()).await;
                let mut transaction = mutation_pool
                    .begin()
                    .await
                    .expect("Backtest caller transaction");
                let request_read = request_owner
                    .lock_exploratory_replay_request_for_backtest_v2_in_transaction(
                        &mut transaction,
                        &locator,
                    )
                    .await;
                transaction
                    .rollback()
                    .await
                    .expect("rollback rejected request read");
                sqlx::query("SELECT vibe_test_admin.set_replay_owner_membership_v1('backtest_owner','qualification_writer',false)")
                    .execute(&mutation_pool)
                    .await
                    .expect("clear Qualification Writer membership");

                assert_eq!(
                    read.expect_err("writer must reject Qualification Writer membership"),
                    PostgresReplayOwnerErrorV2::CustodyUnavailable
                );
                assert!(
                    request_read.is_err(),
                    "request lock must reject Qualification Writer membership"
                );
                assert_eq!(total_counts(&backtest_url).await, [0, 0, 0, 0]);
            }

            #[tokio::test]
            #[ignore = "requires post-connect R&D membership into Operator Authorization Writer"]
            async fn result_reader_rejects_operator_authorization_writer_membership() {
                let database = CanonicalOwnerPostgresTestDatabaseV1::admit()
                    .await
                    .expect("canonical disposable topology");
                let rd_url = database
                    .database_url(CanonicalOwnerTestRoleV1::RdOwner)
                    .to_string();
                let mutation = database.mutation();
                let backtest_pool = mutation.pool(CanonicalOwnerTestRoleV1::BacktestOwner);
                let rd_pool = PgPool::connect(&rd_url).await.expect("R&D custody-reader pool");
                let mut transaction = rd_pool.begin().await.expect("R&D caller transaction");
                sqlx::query("SELECT vibe_test_admin.set_replay_owner_membership_v1('rd_owner','operator_authorization_writer',true)")
                    .execute(backtest_pool)
                    .await
                    .expect("inject Operator Authorization Writer membership");
                let read = lock_exploratory_result_v1_in_transaction(
                    &mut transaction,
                    &absent_result_custody_query(),
                )
                .await;
                transaction
                    .rollback()
                    .await
                    .expect("rollback rejected custody read");
                sqlx::query("SELECT vibe_test_admin.set_replay_owner_membership_v1('rd_owner','operator_authorization_writer',false)")
                    .execute(backtest_pool)
                    .await
                    .expect("clear Operator Authorization Writer membership");
                assert!(
                    read.is_err(),
                    "reader must reject Operator Authorization Writer membership"
                );
            }

            #[tokio::test]
            #[ignore = "requires a disposable topology seeded by the real sealed R&D V2 test"]
            async fn v2_storage_adapter_is_atomic_restart_stable_and_fail_closed() {
                let database = CanonicalOwnerPostgresTestDatabaseV1::admit()
                    .await
                    .expect("canonical disposable topology");
                let rd_url = database
                    .database_url(CanonicalOwnerTestRoleV1::RdOwner)
                    .to_string();
                let qualification_url = database
                    .database_url(CanonicalOwnerTestRoleV1::QualificationWriter)
                    .to_string();
                let backtest_url = database
                    .database_url(CanonicalOwnerTestRoleV1::BacktestOwner)
                    .to_string();
                let rd_pool = database
                    .mutation()
                    .pool(CanonicalOwnerTestRoleV1::RdOwner)
                    .clone();
                let seeded = sqlx::query(
                    "SELECT request_identity,v2_meaning_digest,v2_seal_digest,v2_receipt_json->>'receipt_identity' AS receipt_identity FROM public.rd_exploratory_replay_requests_v1 WHERE request_schema_version=2 AND lifecycle_state='FROZEN' ORDER BY committed_at_epoch_ms DESC,request_identity DESC LIMIT 1",
                )
                .fetch_one(&rd_pool)
                .await
                .expect("script must seed one real Owner-sealed Replay V2 request");
                let locator = ExploratoryReplayRequestLocatorV2 {
                    request_identity: seeded.get("request_identity"),
                    meaning_digest: seeded.get("v2_meaning_digest"),
                    receipt_identity: seeded.get("receipt_identity"),
                    seal_digest: seeded.get("v2_seal_digest"),
                };
                let request_owner = PostgresResearchGoalOwnerV1::connect_with_backtest(
                    &rd_url,
                    &qualification_url,
                    &backtest_url,
                )
                .await
                .expect("R&D Owner bound to the sealed V2 reader");
                let locked = request_owner
                    .lock_exploratory_replay_request_for_backtest_v2(&locator)
                    .await
                    .expect("real U1 V2 readback");
                let request = locked
                    .readback()
                    .expect("seeded V2 request must be available")
                    .request()
                    .clone();
                let request_bytes = locked
                    .readback()
                    .expect("seeded V2 request must be available")
                    .canonical_request_bytes()
                    .to_vec();
                let result = storage_result_fixture(&request, 'd')
                    .expect("complete storage-only U2 fixture");
                let result_bytes = result.to_canonical_bytes().expect("canonical result bytes");
                let owner = PostgresReplayResultOwnerV2::connect(&backtest_url)
                    .await
                    .expect("Backtest result Owner");

                let mut wrong = locator.clone();
                wrong.seal_digest.push_str("-wrong");
                assert_eq!(
                    owner
                        .commit_exploratory_replay_result_v2(&request_owner, &wrong, &result)
                        .await
                        .expect_err("wrong V2 locator must write nothing"),
                    PostgresReplayOwnerErrorV2::RequestUnavailable
                );
                assert_eq!(total_counts(&backtest_url).await, [0, 0, 0, 0]);

                let absent = ExploratoryReplayRequestLocatorV2 {
                    request_identity: "absent-replay-v2".into(),
                    meaning_digest: digest('a').as_str().into(),
                    receipt_identity: "absent-receipt-v2".into(),
                    seal_digest: digest('b').as_str().into(),
                };
                assert_eq!(
                    owner
                        .commit_exploratory_replay_result_v2(&request_owner, &absent, &result)
                        .await
                        .expect_err("absent V2 locator must write nothing"),
                    PostgresReplayOwnerErrorV2::RequestUnavailable
                );
                assert_eq!(total_counts(&backtest_url).await, [0, 0, 0, 0]);

                let cross_spliced = ExploratoryReplayRequestLocatorV2 {
                    request_identity: locator.request_identity.clone(),
                    meaning_digest: locator.meaning_digest.clone(),
                    receipt_identity: absent.receipt_identity.clone(),
                    seal_digest: absent.seal_digest.clone(),
                };
                assert_eq!(
                    owner
                        .commit_exploratory_replay_result_v2(
                            &request_owner,
                            &cross_spliced,
                            &result,
                        )
                        .await
                        .expect_err("cross-spliced V2 locator must write nothing"),
                    PostgresReplayOwnerErrorV2::RequestUnavailable
                );
                assert_eq!(total_counts(&backtest_url).await, [0, 0, 0, 0]);

                sqlx::query("UPDATE public.rd_exploratory_replay_requests_v1 SET lifecycle_state='REVOKED' WHERE request_identity=$1")
                    .bind(&locator.request_identity)
                    .execute(&rd_pool)
                    .await
                    .expect("make locator stale");
                assert_eq!(
                    owner
                        .commit_exploratory_replay_result_v2(&request_owner, &locator, &result)
                        .await
                        .expect_err("stale V2 locator must write nothing"),
                    PostgresReplayOwnerErrorV2::RequestUnavailable
                );
                assert_eq!(total_counts(&backtest_url).await, [0, 0, 0, 0]);
                sqlx::query("UPDATE public.rd_exploratory_replay_requests_v1 SET lifecycle_state='FROZEN' WHERE request_identity=$1")
                    .bind(&locator.request_identity)
                    .execute(&rd_pool)
                    .await
                    .expect("restore seeded request");

                let mut mismatched_dto = request.as_dto().clone();
                mismatched_dto.diagnostic_policy = VersionedIdentityV2 {
                    identity: identity("mismatched-diagnostic-policy"),
                    version: identity("v3"),
                };
                let mismatched_request = ReplayRequestV2::try_from(mismatched_dto)
                    .expect("valid mismatched request fixture");
                let mismatched_result = storage_result_fixture(&mismatched_request, 'e')
                    .expect("valid mismatched result fixture");
                assert_eq!(
                    owner
                        .commit_exploratory_replay_result_v2(
                            &request_owner,
                            &locator,
                            &mismatched_result,
                        )
                        .await
                        .expect_err("request/result meaning mismatch must write nothing"),
                    PostgresReplayOwnerErrorV2::RequestBindingMismatch
                );
                assert_eq!(total_counts(&backtest_url).await, [0, 0, 0, 0]);

                assert_eq!(
                    mismatched_consumption_fixture(&request)
                        .expect_err("U2 must reject invented actual-consumption meaning"),
                    ReplayOwnerErrorV2::ConsumptionMismatch(
                        ObservationComponentV2::ReplayConfiguration
                    )
                );
                assert_eq!(total_counts(&backtest_url).await, [0, 0, 0, 0]);

                let committed = owner
                    .commit_exploratory_replay_result_v2(&request_owner, &locator, &result)
                    .await
                    .expect("exact U1 request and already sealed U2 result commit atomically");
                assert_eq!(total_counts(&backtest_url).await, [1, 1, 1, 1]);
                assert_eq!(committed.request_canonical_bytes(), request_bytes);
                assert_eq!(committed.result_canonical_bytes(), result_bytes);
                assert_result_census(committed.result_canonical_bytes());

                drop(owner);
                let restarted = PostgresReplayResultOwnerV2::connect(&backtest_url)
                    .await
                    .expect("restarted Backtest result Owner");
                let replayed = restarted
                    .commit_exploratory_replay_result_v2(&request_owner, &locator, &result)
                    .await
                    .expect("response-loss retry joins the same attempt");
                let reread = restarted
                    .read_result_v2(result.result_identity())
                    .await
                    .expect("direct durable read")
                    .expect("durable result exists");
                assert_eq!(committed, replayed);
                assert_eq!(committed, reread);
                assert_eq!(total_counts(&backtest_url).await, [1, 1, 1, 1]);
                assert_eq!(committed.receipt_canonical_bytes(), replayed.receipt_canonical_bytes());
                assert_eq!(committed.outbox_canonical_bytes(), replayed.outbox_canonical_bytes());

                let query = ExploratoryResultCustodyQueryV1 {
                    schema_version: 1,
                    locator: ExploratoryResultLocatorV1 {
                        request_identity: result.request_identity().clone(),
                        request_meaning_digest: result.request_meaning_digest().clone(),
                        result_identity: result.result_identity().clone(),
                        result_digest: result.result_digest().clone(),
                    },
                };
                let mut rd_transaction = rd_pool.begin().await.expect("caller-held R&D transaction");
                let sealed = lock_exploratory_result_v1_in_transaction(&mut rd_transaction, &query)
                    .await
                    .expect("fixed Backtest facade")
                    .expect("pre-existing exact result custody");
                assert_eq!(sealed.canonical_result_bytes(), committed.result_canonical_bytes());
                assert_eq!(sealed.canonical_receipt_bytes(), committed.receipt_canonical_bytes());
                assert_eq!(sealed.canonical_outbox_bytes(), committed.outbox_canonical_bytes());
                let mut blocked = PgPool::connect(&backtest_url)
                    .await
                    .expect("lock probe pool")
                    .begin()
                    .await
                    .expect("lock probe transaction");
                sqlx::query("SET LOCAL lock_timeout='100ms'")
                    .execute(&mut *blocked)
                    .await
                    .expect("bounded lock probe");
                assert!(
                    sqlx::query("UPDATE public.backtest_replay_results_v2 SET result_digest=result_digest WHERE result_identity=$1")
                        .bind(result.result_identity().as_str())
                        .execute(&mut *blocked)
                        .await
                        .is_err(),
                    "facade row locks must remain held until the caller commits"
                );
                blocked.rollback().await.expect("rollback timed-out lock probe");
                rd_transaction.commit().await.expect("caller commits its own transaction");

                let pool = PgPool::connect(&backtest_url)
                    .await
                    .expect("Backtest corruption-test pool");
                sqlx::query("UPDATE public.backtest_replay_results_v2 SET canonical_bytes=canonical_bytes || decode('20','hex') WHERE result_identity=$1")
                    .bind(result.result_identity().as_str())
                    .execute(&pool)
                    .await
                    .expect("corrupt result bytes");
                assert_eq!(
                    restarted
                        .read_result_v2(result.result_identity())
                        .await
                        .expect_err("corrupt result bytes must fail closed"),
                    PostgresReplayOwnerErrorV2::CorruptReadback
                );
                sqlx::query("UPDATE public.backtest_replay_results_v2 SET canonical_bytes=$2 WHERE result_identity=$1")
                    .bind(result.result_identity().as_str())
                    .bind(&result_bytes)
                    .execute(&pool)
                    .await
                    .expect("restore result bytes");
                let semantically_corrupt_result = String::from_utf8(result_bytes.clone())
                    .expect("result fixture is UTF-8 JSON")
                    .replace("NO_EXECUTION_DEFECT", "UNRESOLVED_FAILURE")
                    .into_bytes();
                assert_ne!(semantically_corrupt_result, result_bytes);
                let matching_storage_hash = canonical_bytes_digest(
                    RESULT_STORAGE_DOMAIN,
                    &semantically_corrupt_result,
                );
                sqlx::query("UPDATE public.backtest_replay_results_v2 SET canonical_bytes=$2,canonical_bytes_blake3=$3 WHERE result_identity=$1")
                    .bind(result.result_identity().as_str())
                    .bind(&semantically_corrupt_result)
                    .bind(&matching_storage_hash)
                    .execute(&pool)
                    .await
                    .expect("corrupt result meaning with a matching storage hash");
                assert_eq!(
                    restarted
                        .read_result_v2(result.result_identity())
                        .await
                        .expect_err("U2 digest mismatch must fail even when storage hash matches"),
                    PostgresReplayOwnerErrorV2::CorruptReadback
                );
                sqlx::query("UPDATE public.backtest_replay_results_v2 SET canonical_bytes=$2,canonical_bytes_blake3=$3 WHERE result_identity=$1")
                    .bind(result.result_identity().as_str())
                    .bind(&result_bytes)
                    .bind(canonical_bytes_digest(RESULT_STORAGE_DOMAIN, &result_bytes))
                    .execute(&pool)
                    .await
                    .expect("restore exact result bytes and hash");
                sqlx::query("UPDATE public.backtest_replay_runs_v2 SET request_canonical_bytes=request_canonical_bytes || decode('20','hex') WHERE result_identity=$1")
                    .bind(result.result_identity().as_str())
                    .execute(&pool)
                    .await
                    .expect("corrupt request bytes");
                assert_eq!(
                    restarted
                        .read_result_v2(result.result_identity())
                        .await
                        .expect_err("corrupt request bytes must fail closed"),
                    PostgresReplayOwnerErrorV2::CorruptReadback
                );
                sqlx::query("UPDATE public.backtest_replay_runs_v2 SET request_canonical_bytes=$2 WHERE result_identity=$1")
                    .bind(result.result_identity().as_str())
                    .bind(&request_bytes)
                    .execute(&pool)
                    .await
                    .expect("restore request bytes");

                let conflicting = storage_result_fixture(&request, 'f')
                    .expect("different same-attempt storage fixture");
                assert_eq!(
                    restarted
                        .commit_exploratory_replay_result_v2(
                            &request_owner,
                            &locator,
                            &conflicting,
                        )
                        .await
                        .expect_err("one request attempt cannot bind a second result"),
                    PostgresReplayOwnerErrorV2::ConflictingReplay
                );
                assert_eq!(total_counts(&backtest_url).await, [1, 1, 1, 1]);
                assert_eq!(counts_by_result(&backtest_url, conflicting.result_identity()).await, [0, 0]);
            }

            #[tokio::test]
            #[ignore = "requires disposable fixed-facade owner/source/ACL drift controls"]
            async fn result_custody_facade_drift_never_produces_positive_readback() {
                let (backtest_url, rd_url, request_owner, locator, result) =
                    seeded_storage_context('9').await;
                let owner = PostgresReplayResultOwnerV2::connect(&backtest_url)
                    .await
                    .expect("Backtest result Owner");
                owner
                    .commit_exploratory_replay_result_v2(&request_owner, &locator, &result)
                    .await
                    .expect("seed exact Backtest custody");
                let query = ExploratoryResultCustodyQueryV1 {
                    schema_version: 1,
                    locator: ExploratoryResultLocatorV1 {
                        request_identity: result.request_identity().clone(),
                        request_meaning_digest: result.request_meaning_digest().clone(),
                        result_identity: result.result_identity().clone(),
                        result_digest: result.result_digest().clone(),
                    },
                };
                let rd_pool = PgPool::connect(&rd_url).await.expect("R&D drift-control pool");

                sqlx::query("SELECT vibe_test_admin.forge_backtest_result_facade_source_v1()")
                    .execute(&rd_pool)
                    .await
                    .expect("forge fixed facade source");
                assert_result_custody_rejected(&rd_pool, &query).await;
                assert_eq!(total_counts(&backtest_url).await, [1, 1, 1, 1]);
                PostgresReplayResultOwnerV2::bootstrap_storage(&backtest_url)
                    .await
                    .expect("restore canonical facade source");

                sqlx::query("SELECT vibe_test_admin.set_backtest_result_facade_owner_drift_v1(true)")
                    .execute(&rd_pool)
                    .await
                    .expect("drift facade owner");
                assert_result_custody_rejected(&rd_pool, &query).await;
                assert_eq!(total_counts(&backtest_url).await, [1, 1, 1, 1]);
                sqlx::query("SELECT vibe_test_admin.set_backtest_result_facade_owner_drift_v1(false)")
                    .execute(&rd_pool)
                    .await
                    .expect("restore facade owner");
                PostgresReplayResultOwnerV2::bootstrap_storage(&backtest_url)
                    .await
                    .expect("restore canonical facade ACL after owner drift");

                sqlx::query("SELECT vibe_test_admin.set_backtest_result_facade_acl_drift_v1(true)")
                    .execute(&rd_pool)
                    .await
                    .expect("drift facade ACL");
                assert_result_custody_rejected(&rd_pool, &query).await;
                assert_eq!(total_counts(&backtest_url).await, [1, 1, 1, 1]);
                sqlx::query("SELECT vibe_test_admin.set_backtest_result_facade_acl_drift_v1(false)")
                    .execute(&rd_pool)
                    .await
                    .expect("restore facade ACL");
                remove_exact_result_fixture(&backtest_url, result.result_identity()).await;
            }

            #[tokio::test]
            #[ignore = "requires disposable post-connect role-membership controls"]
            async fn all_public_seams_reject_capability_free_inbound_rd_owner_membership() {
                let (backtest_url, rd_url, request_owner, locator, result) =
                    seeded_storage_context('3').await;
                let owner = PostgresReplayResultOwnerV2::connect(&backtest_url)
                    .await
                    .expect("clean Backtest result Owner handle");
                let backtest_pool = PgPool::connect(&backtest_url)
                    .await
                    .expect("Backtest role-drift control pool");
                let rd_pool = PgPool::connect(&rd_url).await.expect("R&D reader pool");
                let query = ExploratoryResultCustodyQueryV1 {
                    schema_version: 1,
                    locator: ExploratoryResultLocatorV1 {
                        request_identity: result.request_identity().clone(),
                        request_meaning_digest: result.request_meaning_digest().clone(),
                        result_identity: result.result_identity().clone(),
                        result_digest: result.result_digest().clone(),
                    },
                };

                sqlx::query("SELECT vibe_test_admin.set_rogue_rd_inbound_membership_v1(true)")
                    .execute(&backtest_pool)
                    .await
                    .expect("grant rd_owner to a capability-free rogue role after connect");
                assert!(
                    request_owner
                        .lock_exploratory_replay_request_for_backtest_v2(&locator)
                        .await
                        .is_err(),
                    "request-lock seam must reject inbound rd_owner reachability"
                );
                assert_eq!(
                    owner
                        .read_result_v2(&query.locator.result_identity)
                        .await
                        .expect_err("writer/readback seam must reject inbound rd_owner reachability"),
                    PostgresReplayOwnerErrorV2::CustodyUnavailable
                );
                assert_result_custody_rejected(&rd_pool, &query).await;
                assert_eq!(
                    owner
                        .commit_exploratory_replay_result_v2(&request_owner, &locator, &result)
                        .await
                        .expect_err("writer seam must reject before first custody"),
                    PostgresReplayOwnerErrorV2::CustodyUnavailable
                );
                assert_eq!(total_counts(&backtest_url).await, [0, 0, 0, 0]);

                sqlx::query("SELECT vibe_test_admin.set_rogue_rd_inbound_membership_v1(false)")
                    .execute(&backtest_pool)
                    .await
                    .expect("restore closed role topology");
                assert!(
                    request_owner
                        .lock_exploratory_replay_request_for_backtest_v2(&locator)
                        .await
                        .expect("restored request-lock seam")
                        .readback()
                        .is_some()
                );
                assert!(
                    owner
                        .read_result_v2(&query.locator.result_identity)
                        .await
                        .expect("restored writer/readback seam")
                        .is_none()
                );
                let mut transaction = rd_pool.begin().await.expect("restored R&D transaction");
                assert!(
                    lock_exploratory_result_v1_in_transaction(&mut transaction, &query)
                        .await
                        .expect("restored result-reader seam")
                        .is_none()
                );
                transaction.rollback().await.expect("rollback absent read");
            }

            #[tokio::test]
            #[ignore = "requires disposable post-connect inbound Backtest role controls"]
            async fn all_public_seams_reject_capability_free_inbound_backtest_owner_membership() {
                let (backtest_url, rd_url, request_owner, locator, result) =
                    seeded_storage_context('2').await;
                let owner = PostgresReplayResultOwnerV2::connect(&backtest_url)
                    .await
                    .expect("clean Backtest result Owner handle");
                let backtest_pool = PgPool::connect(&backtest_url)
                    .await
                    .expect("Backtest role-drift control pool");
                let rd_pool = PgPool::connect(&rd_url).await.expect("R&D reader pool");
                let query = ExploratoryResultCustodyQueryV1 {
                    schema_version: 1,
                    locator: ExploratoryResultLocatorV1 {
                        request_identity: result.request_identity().clone(),
                        request_meaning_digest: result.request_meaning_digest().clone(),
                        result_identity: result.result_identity().clone(),
                        result_digest: result.result_digest().clone(),
                    },
                };

                sqlx::query(
                    "SELECT vibe_test_admin.set_rogue_backtest_inbound_membership_v1(true)",
                )
                .execute(&backtest_pool)
                .await
                .expect("grant backtest_owner SET reachability to a capability-free rogue role");
                assert!(
                    request_owner
                        .lock_exploratory_replay_request_for_backtest_v2(&locator)
                        .await
                        .is_err(),
                    "non-transaction request seam must reject inbound Backtest reachability"
                );
                assert_eq!(
                    owner
                        .read_result_v2(&query.locator.result_identity)
                        .await
                        .expect_err("writer/readback seam must reject inbound Backtest reachability"),
                    PostgresReplayOwnerErrorV2::CustodyUnavailable
                );
                assert_result_custody_rejected(&rd_pool, &query).await;
                assert_eq!(
                    owner
                        .commit_exploratory_replay_result_v2(&request_owner, &locator, &result)
                        .await
                        .expect_err("writer seam must reject before first custody"),
                    PostgresReplayOwnerErrorV2::CustodyUnavailable
                );
                assert_eq!(total_counts(&backtest_url).await, [0, 0, 0, 0]);

                sqlx::query(
                    "SELECT vibe_test_admin.set_rogue_backtest_inbound_membership_v1(false)",
                )
                .execute(&backtest_pool)
                .await
                .expect("restore closed Backtest role topology");
                assert!(
                    request_owner
                        .lock_exploratory_replay_request_for_backtest_v2(&locator)
                        .await
                        .expect("restored request seam")
                        .readback()
                        .is_some()
                );
                assert!(
                    owner
                        .read_result_v2(&query.locator.result_identity)
                        .await
                        .expect("restored writer/readback seam")
                        .is_none()
                );
                let mut transaction = rd_pool.begin().await.expect("restored R&D transaction");
                assert!(
                    lock_exploratory_result_v1_in_transaction(&mut transaction, &query)
                        .await
                        .expect("restored result-reader seam")
                        .is_none()
                );
                transaction.rollback().await.expect("rollback absent read");
            }

            #[tokio::test]
            #[ignore = "requires disposable same-source facade declaration controls"]
            async fn result_reader_rejects_same_source_out_declaration_drift() {
                let (backtest_url, rd_url, request_owner, locator, result) =
                    seeded_storage_context('4').await;
                let owner = PostgresReplayResultOwnerV2::connect(&backtest_url)
                    .await
                    .expect("Backtest result Owner");
                owner
                    .commit_exploratory_replay_result_v2(&request_owner, &locator, &result)
                    .await
                    .expect("seed exact result custody");
                let query = ExploratoryResultCustodyQueryV1 {
                    schema_version: 1,
                    locator: ExploratoryResultLocatorV1 {
                        request_identity: result.request_identity().clone(),
                        request_meaning_digest: result.request_meaning_digest().clone(),
                        result_identity: result.result_identity().clone(),
                        result_digest: result.result_digest().clone(),
                    },
                };
                let rd_pool = PgPool::connect(&rd_url)
                    .await
                    .expect("R&D declaration-drift pool");

                sqlx::query(
                    "SELECT vibe_test_admin.set_backtest_result_facade_out_name_drift_v1(true)",
                )
                .execute(&rd_pool)
                .await
                .expect("replace only the facade OUT declaration");
                let same_source_with_drifted_out_name: bool = sqlx::query_scalar(
                    "SELECT procedure.prosrc=$1 AND procedure.proargnames[5]='run_request_identity_drift' FROM pg_catalog.pg_proc procedure WHERE procedure.oid='backtest_owner_api.lock_exploratory_result_v1(text,text,text,text)'::pg_catalog.regprocedure",
                )
                .bind(LOCK_RESULT_SOURCE_V1)
                .fetch_one(&rd_pool)
                .await
                .expect("same-source declaration drift readback");
                assert!(same_source_with_drifted_out_name);
                assert_result_custody_rejected(&rd_pool, &query).await;

                sqlx::query(
                    "SELECT vibe_test_admin.set_backtest_result_facade_out_name_drift_v1(false)",
                )
                .execute(&rd_pool)
                .await
                .expect("restore exact facade OUT declaration");
                let mut transaction = rd_pool.begin().await.expect("restored R&D transaction");
                assert!(
                    lock_exploratory_result_v1_in_transaction(&mut transaction, &query)
                        .await
                        .expect("exact declaration must remain accepted")
                        .is_some()
                );
                transaction.rollback().await.expect("rollback accepted read");
                remove_exact_result_fixture(&backtest_url, result.result_identity()).await;
            }

            #[tokio::test]
            #[ignore = "requires canonical disposable Backtest/R&D PostgreSQL roles"]
            async fn scalar_mirror_tamper_and_cross_splice_fail_closed_at_both_public_seams() {
                let (backtest_url, rd_url, request_owner, locator, result) =
                    seeded_storage_context('5').await;
                let owner = PostgresReplayResultOwnerV2::connect(&backtest_url)
                    .await
                    .expect("Backtest result Owner");
                let committed = owner
                    .commit_exploratory_replay_result_v2(&request_owner, &locator, &result)
                    .await
                    .expect("seed exact four-table custody");
                let receipt: BacktestResultReceiptV1 =
                    serde_json::from_slice(committed.receipt_canonical_bytes())
                        .expect("canonical receipt fixture");
                let outbox: BacktestResultOutboxV1 =
                    serde_json::from_slice(committed.outbox_canonical_bytes())
                        .expect("canonical outbox fixture");
                let request_bytes = committed.request_canonical_bytes().to_vec();
                let request_storage_digest =
                    canonical_bytes_digest(REQUEST_STORAGE_DOMAIN, &request_bytes);
                let request_binding = request_binding_digest(
                    &request_bytes,
                    &locator.seal_digest,
                    &locator.receipt_identity,
                );
                let query = ExploratoryResultCustodyQueryV1 {
                    schema_version: 1,
                    locator: ExploratoryResultLocatorV1 {
                        request_identity: result.request_identity().clone(),
                        request_meaning_digest: result.request_meaning_digest().clone(),
                        result_identity: result.result_identity().clone(),
                        result_digest: result.result_digest().clone(),
                    },
                };
                let rd_pool = PgPool::connect(&rd_url).await.expect("R&D reader pool");
                let mutation_pool = PgPool::connect(&backtest_url)
                    .await
                    .expect("Backtest scalar mutation pool");

                sqlx::query("UPDATE public.backtest_replay_result_receipts_v1 SET receipt_digest='sha256:' || repeat('f',64) WHERE result_identity=$1")
                    .bind(result.result_identity().as_str())
                    .execute(&mutation_pool)
                    .await
                    .expect("tamper only the receipt digest mirror");
                assert_scalar_mirrors_rejected(&owner, &rd_pool, &query).await;
                sqlx::query("UPDATE public.backtest_replay_result_receipts_v1 SET receipt_digest=$2 WHERE result_identity=$1")
                    .bind(result.result_identity().as_str())
                    .bind(receipt.receipt_digest.as_str())
                    .execute(&mutation_pool)
                    .await
                    .expect("restore receipt digest mirror");

                sqlx::query("UPDATE public.backtest_replay_result_outbox_v1 SET event_identity=$2,event_digest=$3,payload_digest=$4 WHERE result_identity=$1")
                    .bind(result.result_identity().as_str())
                    .bind(receipt.receipt_identity.as_str())
                    .bind(receipt.receipt_digest.as_str())
                    .bind(result.result_digest().as_str())
                    .execute(&mutation_pool)
                    .await
                    .expect("cross-splice valid scalars into outbox mirrors");
                assert_scalar_mirrors_rejected(&owner, &rd_pool, &query).await;
                sqlx::query("UPDATE public.backtest_replay_result_outbox_v1 SET event_identity=$2,event_digest=$3,payload_digest=$4 WHERE result_identity=$1")
                    .bind(result.result_identity().as_str())
                    .bind(outbox.event_identity.as_str())
                    .bind(outbox.event_digest.as_str())
                    .bind(outbox.payload_digest.as_str())
                    .execute(&mutation_pool)
                    .await
                    .expect("restore outbox scalar mirrors");

                sqlx::query("UPDATE public.backtest_replay_runs_v2 SET request_binding_blake3='blake3:' || repeat('0',64) WHERE result_identity=$1")
                    .bind(result.result_identity().as_str())
                    .execute(&mutation_pool)
                    .await
                    .expect("tamper only the retained request binding mirror");
                assert_scalar_mirrors_rejected(&owner, &rd_pool, &query).await;
                sqlx::query("UPDATE public.backtest_replay_runs_v2 SET request_binding_blake3=$2 WHERE result_identity=$1")
                    .bind(result.result_identity().as_str())
                    .bind(&request_binding)
                    .execute(&mutation_pool)
                    .await
                    .expect("restore request binding mirror");

                let spliced_request_bytes = committed.result_canonical_bytes();
                let spliced_storage_digest =
                    canonical_bytes_digest(REQUEST_STORAGE_DOMAIN, spliced_request_bytes);
                let spliced_binding = request_binding_digest(
                    spliced_request_bytes,
                    &locator.seal_digest,
                    &locator.receipt_identity,
                );
                sqlx::query("UPDATE public.backtest_replay_runs_v2 SET request_canonical_bytes=$2,request_canonical_bytes_blake3=$3,request_binding_blake3=$4 WHERE result_identity=$1")
                    .bind(result.result_identity().as_str())
                    .bind(spliced_request_bytes)
                    .bind(spliced_storage_digest)
                    .bind(spliced_binding)
                    .execute(&mutation_pool)
                    .await
                    .expect("cross-splice canonical bytes with matching storage and binding hashes");
                assert_scalar_mirrors_rejected(&owner, &rd_pool, &query).await;
                sqlx::query("UPDATE public.backtest_replay_runs_v2 SET request_canonical_bytes=$2,request_canonical_bytes_blake3=$3,request_binding_blake3=$4 WHERE result_identity=$1")
                    .bind(result.result_identity().as_str())
                    .bind(&request_bytes)
                    .bind(request_storage_digest)
                    .bind(request_binding)
                    .execute(&mutation_pool)
                    .await
                    .expect("restore retained request representation");

                assert!(owner.read_result_v2(result.result_identity()).await.expect("valid writer read").is_some());
                let mut transaction = rd_pool.begin().await.expect("valid R&D transaction");
                assert!(lock_exploratory_result_v1_in_transaction(&mut transaction, &query)
                    .await
                    .expect("valid reader read")
                    .is_some());
                transaction.rollback().await.expect("rollback valid read");
                mutation_pool.close().await;
                rd_pool.close().await;
                remove_exact_result_fixture(&backtest_url, result.result_identity()).await;
            }

            #[tokio::test]
            #[ignore = "requires a committed result and direct R&D facade access"]
            async fn result_custody_sql_facade_excludes_protected_namespaces() {
                let (backtest_url, rd_url, request_owner, locator, result) =
                    seeded_storage_context('7').await;
                let owner = PostgresReplayResultOwnerV2::connect(&backtest_url)
                    .await
                    .expect("Backtest result Owner");
                owner
                    .commit_exploratory_replay_result_v2(&request_owner, &locator, &result)
                    .await
                    .expect("seed exact Backtest custody");
                let backtest_pool = PgPool::connect(&backtest_url)
                    .await
                    .expect("Backtest namespace mutation pool");
                sqlx::query("UPDATE public.backtest_replay_result_receipts_v1 SET namespace='PROTECTED' WHERE result_identity=$1")
                    .bind(result.result_identity().as_str())
                    .execute(&backtest_pool)
                    .await
                    .expect("mark receipt as protected custody");
                sqlx::query("UPDATE public.backtest_replay_result_outbox_v1 SET namespace='PROTECTED' WHERE result_identity=$1")
                    .bind(result.result_identity().as_str())
                    .execute(&backtest_pool)
                    .await
                    .expect("mark outbox as protected custody");

                let rd_pool = PgPool::connect(&rd_url).await.expect("R&D direct facade pool");
                let disclosed: i64 = sqlx::query_scalar(
                    "SELECT count(*) FROM backtest_owner_api.lock_exploratory_result_v1($1,$2,$3,$4)",
                )
                .bind(result.request_identity().as_str())
                .bind(result.request_meaning_digest().as_str())
                .bind(result.result_identity().as_str())
                .bind(result.result_digest().as_str())
                .fetch_one(&rd_pool)
                .await
                .expect("direct fixed-facade protected namespace probe");
                assert_eq!(disclosed, 0, "SQL facade must disclose zero protected custody rows");
                assert_eq!(total_counts(&backtest_url).await, [1, 1, 1, 1]);

                sqlx::query("UPDATE public.backtest_replay_result_receipts_v1 SET namespace='EXPLORATORY' WHERE result_identity=$1")
                    .bind(result.result_identity().as_str())
                    .execute(&backtest_pool)
                    .await
                    .expect("restore receipt namespace");
                sqlx::query("UPDATE public.backtest_replay_result_outbox_v1 SET namespace='EXPLORATORY' WHERE result_identity=$1")
                    .bind(result.result_identity().as_str())
                    .execute(&backtest_pool)
                    .await
                    .expect("restore outbox namespace");
                remove_exact_result_fixture(&backtest_url, result.result_identity()).await;
            }

            #[tokio::test]
            #[ignore = "requires canonical Backtest storage and post-connect auxiliary DDL drift"]
            async fn existing_handle_rejects_auxiliary_dropped_uniqueness() {
                let database = CanonicalOwnerPostgresTestDatabaseV1::admit()
                    .await
                    .expect("canonical disposable topology");
                let backtest_url = database
                    .database_url(CanonicalOwnerTestRoleV1::BacktestOwner)
                    .to_string();
                let owner = PostgresReplayResultOwnerV2::connect(&backtest_url)
                    .await
                    .expect("clean Backtest runtime handle");
                let mutation_pool = PgPool::connect(&backtest_url)
                    .await
                    .expect("Backtest auxiliary-shape mutation pool");
                sqlx::query("ALTER TABLE public.backtest_replay_result_receipts_v1 DROP CONSTRAINT backtest_replay_result_receipts_v1_receipt_identity_key")
                    .execute(&mutation_pool)
                    .await
                    .expect("drop declared receipt uniqueness after connect");

                let read = owner.read_result_v2(&identity("absent-result-v2")).await;

                sqlx::query("ALTER TABLE public.backtest_replay_result_receipts_v1 ADD CONSTRAINT backtest_replay_result_receipts_v1_receipt_identity_key UNIQUE(receipt_identity)")
                    .execute(&mutation_pool)
                    .await
                    .expect("restore declared receipt uniqueness");
                assert_eq!(
                    read.expect_err("next read must reject auxiliary shape drift"),
                    PostgresReplayOwnerErrorV2::CustodyUnavailable
                );
                assert_eq!(total_counts(&backtest_url).await, [0, 0, 0, 0]);
            }

            #[tokio::test]
            #[ignore = "requires committed custody and controlled collation/opclass drift"]
            async fn writer_and_reader_reject_collation_and_index_opclass_drift_without_byte_changes()
            {
                let (backtest_url, rd_url, request_owner, locator, result) =
                    seeded_storage_context('8').await;
                let owner = PostgresReplayResultOwnerV2::connect(&backtest_url)
                    .await
                    .expect("clean Backtest runtime handle");
                owner
                    .commit_exploratory_replay_result_v2(&request_owner, &locator, &result)
                    .await
                    .expect("seed exact Backtest custody");
                let mutation_pool = PgPool::connect(&backtest_url)
                    .await
                    .expect("Backtest shape-drift pool");
                let rd_pool = PgPool::connect(&rd_url).await.expect("R&D custody-reader pool");
                let before = exact_canonical_storage_bytes(
                    &mutation_pool,
                    result.result_identity().as_str(),
                )
                .await;

                for drift_kind in ["collation", "opclass"] {
                    sqlx::query("SELECT vibe_test_admin.set_backtest_scalar_shape_drift_v1($1,true)")
                        .bind(drift_kind)
                        .execute(&mutation_pool)
                        .await
                        .expect("inject scalar/index shape drift");
                    let writer_read = owner.read_result_v2(result.result_identity()).await;
                    let mut transaction = rd_pool.begin().await.expect("R&D caller transaction");
                    let reader_read = lock_exploratory_result_v1_in_transaction(
                        &mut transaction,
                        &ExploratoryResultCustodyQueryV1 {
                            schema_version: 1,
                            locator: ExploratoryResultLocatorV1 {
                                request_identity: result.request_identity().clone(),
                                request_meaning_digest: result.request_meaning_digest().clone(),
                                result_identity: result.result_identity().clone(),
                                result_digest: result.result_digest().clone(),
                            },
                        },
                    )
                    .await;
                    transaction
                        .rollback()
                        .await
                        .expect("rollback rejected custody read");
                    sqlx::query("SELECT vibe_test_admin.set_backtest_scalar_shape_drift_v1($1,false)")
                        .bind(drift_kind)
                        .execute(&mutation_pool)
                        .await
                        .expect("restore canonical scalar/index shape");

                    assert_eq!(
                        writer_read.expect_err("writer must reject scalar/index shape drift"),
                        PostgresReplayOwnerErrorV2::CustodyUnavailable
                    );
                    assert!(
                        reader_read.is_err(),
                        "independent reader must reject scalar/index shape drift"
                    );
                    assert_eq!(
                        exact_canonical_storage_bytes(
                            &mutation_pool,
                            result.result_identity().as_str(),
                        )
                        .await,
                        before,
                        "shape drift must not alter any canonical custody bytes"
                    );
                }
                remove_exact_result_fixture(&backtest_url, result.result_identity()).await;
            }

            #[tokio::test]
            #[ignore = "requires committed custody and controlled extension-membership drift"]
            async fn writer_and_reader_reject_extension_membership_dependency_without_byte_changes()
            {
                let (backtest_url, rd_url, request_owner, locator, result) =
                    seeded_storage_context('9').await;
                let owner = PostgresReplayResultOwnerV2::connect(&backtest_url)
                    .await
                    .expect("clean Backtest runtime handle");
                owner
                    .commit_exploratory_replay_result_v2(&request_owner, &locator, &result)
                    .await
                    .expect("seed exact Backtest custody");
                let mutation_pool = PgPool::connect(&backtest_url)
                    .await
                    .expect("Backtest dependency-drift pool");
                let rd_pool = PgPool::connect(&rd_url).await.expect("R&D custody-reader pool");
                let before = exact_canonical_storage_bytes(
                    &mutation_pool,
                    result.result_identity().as_str(),
                )
                .await;
                sqlx::query("SELECT vibe_test_admin.set_backtest_extension_membership_v1(true)")
                    .execute(&mutation_pool)
                    .await
                    .expect("attach Backtest table to an external extension");

                let writer_read = owner.read_result_v2(result.result_identity()).await;
                let mut transaction = rd_pool.begin().await.expect("R&D caller transaction");
                let reader_read = lock_exploratory_result_v1_in_transaction(
                    &mut transaction,
                    &ExploratoryResultCustodyQueryV1 {
                        schema_version: 1,
                        locator: ExploratoryResultLocatorV1 {
                            request_identity: result.request_identity().clone(),
                            request_meaning_digest: result.request_meaning_digest().clone(),
                            result_identity: result.result_identity().clone(),
                            result_digest: result.result_digest().clone(),
                        },
                    },
                )
                .await;
                transaction
                    .rollback()
                    .await
                    .expect("rollback rejected custody read");
                sqlx::query("SELECT vibe_test_admin.set_backtest_extension_membership_v1(false)")
                    .execute(&mutation_pool)
                    .await
                    .expect("detach Backtest table from external extension");

                assert_eq!(
                    writer_read.expect_err("writer must reject extension-owned custody"),
                    PostgresReplayOwnerErrorV2::CustodyUnavailable
                );
                assert!(
                    reader_read.is_err(),
                    "independent reader must reject extension-owned custody"
                );
                assert_eq!(
                    exact_canonical_storage_bytes(
                        &mutation_pool,
                        result.result_identity().as_str(),
                    )
                    .await,
                    before,
                    "dependency drift must not alter canonical custody bytes"
                );
                remove_exact_result_fixture(&backtest_url, result.result_identity()).await;
            }

            #[tokio::test]
            #[ignore = "requires post-connect read-side constraint drift"]
            async fn result_reader_rejects_dropped_receipt_uniqueness() {
                let database = CanonicalOwnerPostgresTestDatabaseV1::admit()
                    .await
                    .expect("canonical disposable topology");
                let rd_url = database
                    .database_url(CanonicalOwnerTestRoleV1::RdOwner)
                    .to_string();
                let mutation = database.mutation();
                let backtest_pool = mutation.pool(CanonicalOwnerTestRoleV1::BacktestOwner);
                let rd_pool = PgPool::connect(&rd_url).await.expect("R&D custody-reader pool");
                let mut transaction = rd_pool.begin().await.expect("R&D caller transaction");
                sqlx::query("ALTER TABLE public.backtest_replay_result_receipts_v1 DROP CONSTRAINT backtest_replay_result_receipts_v1_receipt_identity_key")
                    .execute(backtest_pool)
                    .await
                    .expect("drop receipt uniqueness after reader connect");
                let read = lock_exploratory_result_v1_in_transaction(
                    &mut transaction,
                    &absent_result_custody_query(),
                )
                .await;
                transaction.rollback().await.expect("rollback rejected custody read");
                sqlx::query("ALTER TABLE public.backtest_replay_result_receipts_v1 ADD CONSTRAINT backtest_replay_result_receipts_v1_receipt_identity_key UNIQUE(receipt_identity)")
                    .execute(backtest_pool)
                    .await
                    .expect("restore receipt uniqueness");
                assert!(read.is_err(), "reader must reject a dropped declared constraint");
            }

            #[tokio::test]
            #[ignore = "requires post-connect read-side undeclared constraint drift"]
            async fn result_reader_rejects_undeclared_constraint() {
                let database = CanonicalOwnerPostgresTestDatabaseV1::admit()
                    .await
                    .expect("canonical disposable topology");
                let rd_url = database
                    .database_url(CanonicalOwnerTestRoleV1::RdOwner)
                    .to_string();
                let mutation = database.mutation();
                let backtest_pool = mutation.pool(CanonicalOwnerTestRoleV1::BacktestOwner);
                let rd_pool = PgPool::connect(&rd_url).await.expect("R&D custody-reader pool");
                let mut transaction = rd_pool.begin().await.expect("R&D caller transaction");
                sqlx::query("ALTER TABLE public.backtest_replay_result_outbox_v1 ADD CONSTRAINT aaa_undeclared_result_outbox_check CHECK (namespace IS NOT NULL)")
                    .execute(backtest_pool)
                    .await
                    .expect("add undeclared constraint after reader connect");
                let read = lock_exploratory_result_v1_in_transaction(
                    &mut transaction,
                    &absent_result_custody_query(),
                )
                .await;
                transaction.rollback().await.expect("rollback rejected custody read");
                sqlx::query("ALTER TABLE public.backtest_replay_result_outbox_v1 DROP CONSTRAINT aaa_undeclared_result_outbox_check")
                    .execute(backtest_pool)
                    .await
                    .expect("remove undeclared constraint");
                assert!(read.is_err(), "reader must reject an undeclared constraint");
            }

            #[tokio::test]
            #[ignore = "requires committed custody and post-connect duplicate drift"]
            async fn result_reader_rejects_duplicate_outbox_rows() {
                let (backtest_url, rd_url, request_owner, locator, result) =
                    seeded_storage_context('6').await;
                let owner = PostgresReplayResultOwnerV2::connect(&backtest_url)
                    .await
                    .expect("Backtest result Owner");
                owner
                    .commit_exploratory_replay_result_v2(&request_owner, &locator, &result)
                    .await
                    .expect("seed exact custody before duplicate drift");
                let rd_pool = PgPool::connect(&rd_url).await.expect("R&D custody-reader pool");
                let mut transaction = rd_pool.begin().await.expect("R&D caller transaction");
                let backtest_pool = PgPool::connect(&backtest_url)
                    .await
                    .expect("Backtest duplicate-drift pool");
                sqlx::query("ALTER TABLE public.backtest_replay_result_outbox_v1 DROP CONSTRAINT backtest_replay_result_outbox_v1_pkey")
                    .execute(&backtest_pool)
                    .await
                    .expect("drop outbox primary key after reader connect");
                sqlx::query("ALTER TABLE public.backtest_replay_result_outbox_v1 DROP CONSTRAINT backtest_replay_result_outbox_v1_receipt_identity_key")
                    .execute(&backtest_pool)
                    .await
                    .expect("drop outbox receipt uniqueness after reader connect");
                sqlx::query("INSERT INTO public.backtest_replay_result_outbox_v1(result_identity,event_identity,event_digest,receipt_identity,request_identity,request_meaning_digest,result_digest,namespace,payload_digest,committed_at_epoch_ms,canonical_bytes,canonical_bytes_blake3) SELECT result_identity,event_identity || '-duplicate',event_digest,receipt_identity,request_identity,request_meaning_digest,result_digest,namespace,payload_digest,committed_at_epoch_ms,canonical_bytes,canonical_bytes_blake3 FROM public.backtest_replay_result_outbox_v1 WHERE result_identity=$1")
                    .bind(result.result_identity().as_str())
                    .execute(&backtest_pool)
                    .await
                    .expect("duplicate the exact outbox row");
                let read = lock_exploratory_result_v1_in_transaction(
                    &mut transaction,
                    &ExploratoryResultCustodyQueryV1 {
                        schema_version: 1,
                        locator: ExploratoryResultLocatorV1 {
                            request_identity: result.request_identity().clone(),
                            request_meaning_digest: result.request_meaning_digest().clone(),
                            result_identity: result.result_identity().clone(),
                            result_digest: result.result_digest().clone(),
                        },
                    },
                )
                .await;
                transaction.rollback().await.expect("rollback rejected custody read");
                remove_exact_result_fixture(&backtest_url, result.result_identity()).await;
                sqlx::query("ALTER TABLE public.backtest_replay_result_outbox_v1 ADD CONSTRAINT backtest_replay_result_outbox_v1_pkey PRIMARY KEY(result_identity)")
                    .execute(&backtest_pool)
                    .await
                    .expect("restore outbox primary key");
                sqlx::query("ALTER TABLE public.backtest_replay_result_outbox_v1 ADD CONSTRAINT backtest_replay_result_outbox_v1_receipt_identity_key UNIQUE(receipt_identity)")
                    .execute(&backtest_pool)
                    .await
                    .expect("restore outbox receipt uniqueness");
                assert!(read.is_err(), "reader must reject duplicate custody rows");
                assert_eq!(total_counts(&backtest_url).await, [0, 0, 0, 0]);
            }

            #[tokio::test]
            #[ignore = "requires a seeded Replay V2 request and controlled external-FK injection"]
            async fn existing_handle_rejects_post_connect_external_inbound_fk() {
                let (backtest_url, _, request_owner, locator, result) =
                    seeded_storage_context('c').await;
                let owner = PostgresReplayResultOwnerV2::connect(&backtest_url)
                    .await
                    .expect("clean Backtest runtime handle");
                let mutation_pool = PgPool::connect(&backtest_url)
                    .await
                    .expect("Backtest external-FK injection pool");
                sqlx::query("SELECT vibe_test_admin.set_backtest_external_inbound_fk_v2(true)")
                    .execute(&mutation_pool)
                    .await
                    .expect("inject external inbound FK after connect");

                let read = owner.read_result_v2(result.result_identity()).await;
                let write = owner
                    .commit_exploratory_replay_result_v2(&request_owner, &locator, &result)
                    .await;
                sqlx::query("SELECT vibe_test_admin.set_backtest_external_inbound_fk_v2(false)")
                    .execute(&mutation_pool)
                    .await
                    .expect("clear external inbound FK");

                assert_eq!(
                    read.expect_err("next read must reject external inbound FK"),
                    PostgresReplayOwnerErrorV2::CustodyUnavailable
                );
                assert_eq!(
                    write.expect_err("next write must reject external inbound FK"),
                    PostgresReplayOwnerErrorV2::CustodyUnavailable
                );
                assert_eq!(total_counts(&backtest_url).await, [0, 0, 0, 0]);
            }

            #[tokio::test]
            #[ignore = "requires a seeded Replay V2 request and controlled external-view injection"]
            async fn existing_handle_rejects_post_connect_external_view() {
                let (backtest_url, rd_url, request_owner, locator, result) =
                    seeded_storage_context('d').await;
                let owner = PostgresReplayResultOwnerV2::connect(&backtest_url)
                    .await
                    .expect("clean Backtest runtime handle");
                let mutation_pool = PgPool::connect(&backtest_url)
                    .await
                    .expect("Backtest external-view injection pool");
                sqlx::query("SELECT vibe_test_admin.set_backtest_external_view_v2(true)")
                    .execute(&mutation_pool)
                    .await
                    .expect("inject external view after connect");

                let read = owner.read_result_v2(result.result_identity()).await;
                let write = owner
                    .commit_exploratory_replay_result_v2(&request_owner, &locator, &result)
                    .await;
                sqlx::query("SELECT vibe_test_admin.set_backtest_external_view_v2(false)")
                    .execute(&mutation_pool)
                    .await
                    .expect("clear external view");

                assert_eq!(
                    read.expect_err("next read must reject external storage view"),
                    PostgresReplayOwnerErrorV2::CustodyUnavailable
                );
                assert_eq!(
                    write.expect_err("next write must reject external storage view"),
                    PostgresReplayOwnerErrorV2::CustodyUnavailable
                );
                assert_eq!(total_counts(&backtest_url).await, [0, 0, 0, 0]);

                let rd_pool = PgPool::connect(&rd_url)
                    .await
                    .expect("same-topology R&D Owner verification pool");
                assert!(
                    sqlx::query("DELETE FROM public.backtest_external_runs_v2")
                        .execute(&rd_pool)
                        .await
                        .is_err(),
                    "R&D Owner must not retain a deletable external view"
                );
                assert!(
                    sqlx::query("SELECT 1 FROM public.backtest_external_runs_v2 LIMIT 1")
                        .fetch_optional(&rd_pool)
                        .await
                        .is_err(),
                    "R&D Owner must not retain a readable external view"
                );
            }

            fn assert_result_census(bytes: &[u8]) {
                let encoded: serde_json::Value =
                    serde_json::from_slice(bytes).expect("canonical result JSON");
                assert_eq!(encoded["reconciliation"].as_array().map(Vec::len), Some(28));
                assert!(encoded["semantic_trace"].is_object());
                assert_eq!(encoded["diagnostic_census"].as_array().map(Vec::len), Some(1));
                assert_eq!(encoded["terminal"], "TERMINAL_RESULT");
            }

            async fn total_counts(database_url: &str) -> [i64; 4] {
                let pool = PgPool::connect(database_url).await.expect("Backtest count pool");
                [
                    sqlx::query_scalar("SELECT COUNT(*) FROM public.backtest_replay_runs_v2")
                        .fetch_one(&pool).await.expect("run count"),
                    sqlx::query_scalar("SELECT COUNT(*) FROM public.backtest_replay_results_v2")
                        .fetch_one(&pool).await.expect("result count"),
                    sqlx::query_scalar("SELECT COUNT(*) FROM public.backtest_replay_result_receipts_v1")
                        .fetch_one(&pool).await.expect("receipt count"),
                    sqlx::query_scalar("SELECT COUNT(*) FROM public.backtest_replay_result_outbox_v1")
                        .fetch_one(&pool).await.expect("outbox count"),
                ]
            }

            async fn exact_canonical_storage_bytes(
                pool: &PgPool,
                result_identity: &str,
            ) -> Vec<Vec<u8>> {
                sqlx::query_scalar(
                    "SELECT canonical_bytes FROM (
                       SELECT request_canonical_bytes AS canonical_bytes,1 AS ordinal FROM public.backtest_replay_runs_v2 WHERE result_identity=$1
                       UNION ALL SELECT canonical_bytes,2 FROM public.backtest_replay_results_v2 WHERE result_identity=$1
                       UNION ALL SELECT canonical_bytes,3 FROM public.backtest_replay_result_receipts_v1 WHERE result_identity=$1
                       UNION ALL SELECT canonical_bytes,4 FROM public.backtest_replay_result_outbox_v1 WHERE result_identity=$1
                     ) custody_bytes ORDER BY ordinal",
                )
                .bind(result_identity)
                .fetch_all(pool)
                .await
                .expect("exact canonical storage byte snapshot")
            }

            async fn assert_result_custody_rejected(
                rd_pool: &PgPool,
                query: &ExploratoryResultCustodyQueryV1,
            ) {
                let mut transaction = rd_pool.begin().await.expect("R&D caller transaction");
                assert!(
                    lock_exploratory_result_v1_in_transaction(&mut transaction, query)
                        .await
                        .is_err(),
                    "drifted facade must produce zero positive custody"
                );
                transaction.rollback().await.expect("rollback rejected read");
            }

            async fn assert_scalar_mirrors_rejected(
                owner: &PostgresReplayResultOwnerV2,
                rd_pool: &PgPool,
                query: &ExploratoryResultCustodyQueryV1,
            ) {
                assert_eq!(
                    owner
                        .read_result_v2(&query.locator.result_identity)
                        .await
                        .expect_err("writer must reject drifted scalar mirrors"),
                    PostgresReplayOwnerErrorV2::CorruptReadback
                );
                assert_result_custody_rejected(rd_pool, query).await;
            }

            fn absent_result_custody_query() -> ExploratoryResultCustodyQueryV1 {
                ExploratoryResultCustodyQueryV1 {
                    schema_version: 1,
                    locator: ExploratoryResultLocatorV1 {
                        request_identity: identity("absent-request-v2"),
                        request_meaning_digest: digest('1'),
                        result_identity: identity("absent-result-v2"),
                        result_digest: digest('2'),
                    },
                }
            }

            async fn counts_by_result(
                database_url: &str,
                result_identity: &OpaqueIdentityV2,
            ) -> [i64; 2] {
                let pool = PgPool::connect(database_url).await.expect("Backtest count pool");
                [
                    sqlx::query_scalar("SELECT COUNT(*) FROM public.backtest_replay_runs_v2 WHERE result_identity=$1")
                        .bind(result_identity.as_str()).fetch_one(&pool).await.expect("run count"),
                    sqlx::query_scalar("SELECT COUNT(*) FROM public.backtest_replay_results_v2 WHERE result_identity=$1")
                        .bind(result_identity.as_str()).fetch_one(&pool).await.expect("result count"),
                ]
            }

            async fn seeded_storage_context(
                trace_byte: char,
            ) -> (
                String,
                String,
                PostgresResearchGoalOwnerV1,
                ExploratoryReplayRequestLocatorV2,
                SealedReplayResultV2,
            ) {
                let database = CanonicalOwnerPostgresTestDatabaseV1::admit()
                    .await
                    .expect("canonical disposable topology");
                let rd_url = database
                    .database_url(CanonicalOwnerTestRoleV1::RdOwner)
                    .to_string();
                let qualification_url = database
                    .database_url(CanonicalOwnerTestRoleV1::QualificationWriter)
                    .to_string();
                let backtest_url = database
                    .database_url(CanonicalOwnerTestRoleV1::BacktestOwner)
                    .to_string();
                let mutation = database.mutation();
                let rd_pool = mutation.pool(CanonicalOwnerTestRoleV1::RdOwner);
                let seeded = sqlx::query(
                    "SELECT request_identity,v2_meaning_digest,v2_seal_digest,v2_receipt_json->>'receipt_identity' AS receipt_identity FROM public.rd_exploratory_replay_requests_v1 WHERE request_schema_version=2 AND lifecycle_state='FROZEN' ORDER BY committed_at_epoch_ms DESC,request_identity DESC LIMIT 1",
                )
                .fetch_one(rd_pool)
                .await
                .expect("script must seed one real Owner-sealed Replay V2 request");
                let locator = ExploratoryReplayRequestLocatorV2 {
                    request_identity: seeded.get("request_identity"),
                    meaning_digest: seeded.get("v2_meaning_digest"),
                    receipt_identity: seeded.get("receipt_identity"),
                    seal_digest: seeded.get("v2_seal_digest"),
                };
                let request_owner = PostgresResearchGoalOwnerV1::connect_with_backtest(
                    &rd_url,
                    &qualification_url,
                    &backtest_url,
                )
                .await
                .expect("R&D Owner bound to the sealed V2 reader");
                let locked = request_owner
                    .lock_exploratory_replay_request_for_backtest_v2(&locator)
                    .await
                    .expect("real U1 V2 readback");
                let request = locked
                    .readback()
                    .expect("seeded V2 request must be available")
                    .request();
                let result = storage_result_fixture(request, trace_byte)
                    .expect("complete storage-only U2 fixture");
                (backtest_url, rd_url, request_owner, locator, result)
            }

            async fn assert_binding_tamper_fails_closed(query: &'static str, trace_byte: char) {
                let (backtest_url, _, request_owner, locator, result) =
                    seeded_storage_context(trace_byte).await;
                let owner = PostgresReplayResultOwnerV2::connect(&backtest_url)
                    .await
                    .expect("Backtest result Owner");
                owner
                    .commit_exploratory_replay_result_v2(&request_owner, &locator, &result)
                    .await
                    .expect("exact U1 request and sealed U2 result commit atomically");
                drop(owner);

                let tamper_pool = PgPool::connect(&backtest_url)
                    .await
                    .expect("Backtest tamper pool");
                sqlx::query(query)
                    .bind(result.result_identity().as_str())
                    .execute(&tamper_pool)
                    .await
                    .expect("mutate one durable request binding");
                tamper_pool.close().await;

                let restarted = PostgresReplayResultOwnerV2::connect(&backtest_url)
                    .await
                    .expect("restarted Backtest result Owner");
                assert_eq!(
                    restarted
                        .read_result_v2(result.result_identity())
                        .await
                        .expect_err("tampered request binding must fail closed after restart"),
                    PostgresReplayOwnerErrorV2::CorruptReadback
                );
            }

            async fn assert_forged_internal_helper_fails_closed(
                helper_regprocedure: &str,
                forged_definition: &'static str,
                forged_marker: &str,
                trace_byte: char,
            ) {
                let (backtest_url, rd_url, request_owner, locator, result) =
                    seeded_storage_context(trace_byte).await;
                let owner = PostgresReplayResultOwnerV2::connect(&backtest_url)
                    .await
                    .expect("clean Backtest runtime handle before R&D helper drift");
                assert_eq!(
                    counts_by_result(&backtest_url, result.result_identity()).await,
                    [0, 0],
                    "canonical positive-control identity must start vacant"
                );
                owner
                    .commit_exploratory_replay_result_v2(&request_owner, &locator, &result)
                    .await
                    .expect("canonical helpers must admit the same transaction-bound commit path");
                assert_eq!(
                    counts_by_result(&backtest_url, result.result_identity()).await,
                    [1, 1],
                    "canonical positive control must reach durable Backtest custody"
                );
                remove_exact_result_fixture(&backtest_url, result.result_identity()).await;
                assert_eq!(
                    counts_by_result(&backtest_url, result.result_identity()).await,
                    [0, 0],
                    "canonical positive control must leave the shared fixture vacant"
                );
                let rd_pool = PgPool::connect(&rd_url)
                    .await
                    .expect("R&D helper replacement pool");
                let rd_role: (String, bool) = sqlx::query_as(
                    "SELECT role.rolname,role.rolsuper FROM pg_catalog.pg_roles role WHERE role.rolname=current_user",
                )
                .fetch_one(&rd_pool)
                .await
                .expect("R&D replacement role readback");
                assert_eq!(rd_role, ("rd_owner".into(), false));
                let canonical_definition: String = sqlx::query_scalar(
                    "SELECT pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure($1))",
                )
                .bind(helper_regprocedure)
                .fetch_one(&rd_pool)
                .await
                .expect("capture canonical internal helper definition");

                sqlx::query(forged_definition)
                    .execute(&rd_pool)
                    .await
                    .expect("current non-superuser R&D Owner replaces its internal helper");
                let observed_forged_source = sqlx::query_scalar::<_, String>(
                    "SELECT procedure.prosrc FROM pg_catalog.pg_proc procedure WHERE procedure.oid=pg_catalog.to_regprocedure($1)",
                )
                .bind(helper_regprocedure)
                .fetch_one(&rd_pool)
                .await;
                let commit = owner
                    .commit_exploratory_replay_result_v2(&request_owner, &locator, &result)
                    .await;

                sqlx::query(sqlx::AssertSqlSafe(canonical_definition.as_str()))
                    .execute(&rd_pool)
                    .await
                    .expect("restore canonical internal helper definition");
                let observed_forged_source = observed_forged_source
                    .expect("forged internal helper source readback before restoration");
                remove_exact_result_fixture(&backtest_url, result.result_identity()).await;
                assert!(
                    observed_forged_source.contains(forged_marker),
                    "fixture must replace the selected helper body"
                );
                assert_eq!(
                    commit.expect_err("forged internal helper must reject before persistence"),
                    PostgresReplayOwnerErrorV2::RequestUnavailable
                );
                assert_eq!(total_counts(&backtest_url).await, [0, 0, 0, 0]);
            }

            async fn remove_exact_result_fixture(
                database_url: &str,
                result_identity: &OpaqueIdentityV2,
            ) {
                let pool = PgPool::connect(database_url)
                    .await
                    .expect("Backtest positive-control cleanup pool");
                let mut transaction = pool
                    .begin()
                    .await
                    .expect("Backtest positive-control cleanup transaction");
                sqlx::query(
                    "DELETE FROM public.backtest_replay_result_outbox_v1 WHERE result_identity=$1",
                )
                .bind(result_identity.as_str())
                .execute(&mut *transaction)
                .await
                .expect("remove exact positive-control outbox");
                sqlx::query(
                    "DELETE FROM public.backtest_replay_result_receipts_v1 WHERE result_identity=$1",
                )
                .bind(result_identity.as_str())
                .execute(&mut *transaction)
                .await
                .expect("remove exact positive-control receipt");
                sqlx::query(
                    "DELETE FROM public.backtest_replay_results_v2 WHERE result_identity=$1",
                )
                .bind(result_identity.as_str())
                .execute(&mut *transaction)
                .await
                .expect("remove exact positive-control result");
                sqlx::query(
                    "DELETE FROM public.backtest_replay_runs_v2 WHERE result_identity=$1",
                )
                .bind(result_identity.as_str())
                .execute(&mut *transaction)
                .await
                .expect("remove exact positive-control run");
                transaction
                    .commit()
                    .await
                    .expect("commit exact positive-control cleanup");
                pool.close().await;
            }

            // Storage fixture only: it deliberately uses U2's private constructor so the adapter
            // can be verified before the real Market -> parameterized runner predecessor exists.
            fn storage_result_fixture(
                request: &ReplayRequestV2,
                trace_byte: char,
            ) -> Result<SealedReplayResultV2, ReplayOwnerErrorV2> {
                let request_meaning_digest = request.meaning_digest().expect("request meaning");
                let attempt_identity = identity("storage-attempt-v2");
                let mut observations: Vec<_> = requested_component_meanings(request)?
                    .into_iter()
                    .map(|(component, meaning)| ConsumedComponentObservationV2 {
                        request_identity: request.request_identity().clone(),
                        request_meaning_digest: request_meaning_digest.clone(),
                        attempt_identity: attempt_identity.clone(),
                        component,
                        locator: observation_locator(component, 'c'),
                        observed_meaning_identity: meaning.identity,
                        observed_meaning_digest: meaning.digest,
                    })
                    .collect();
                observations.push(ConsumedComponentObservationV2 {
                    request_identity: request.request_identity().clone(),
                    request_meaning_digest: request_meaning_digest.clone(),
                    attempt_identity: attempt_identity.clone(),
                    component: ObservationComponentV2::SemanticTrace,
                    locator: observation_locator(ObservationComponentV2::SemanticTrace, trace_byte),
                    observed_meaning_identity: identity("storage-semantic-trace-v2"),
                    observed_meaning_digest: digest(trace_byte),
                });
                commit_owner_result(
                    request,
                    OwnerResultDraftV2 {
                        attempt_identity: attempt_identity.clone(),
                        terminal: ReplayTerminalV2::TerminalResult,
                        observations,
                        diagnostics: vec![DiagnosticEvidenceV2 {
                            request_identity: request.request_identity().clone(),
                            request_meaning_digest,
                            attempt_identity,
                            category: DiagnosticCategoryV2::NoExecutionDefect,
                            decisive_evidence: observation_locator(
                                ObservationComponentV2::SemanticTrace,
                                trace_byte,
                            ),
                        }],
                    },
                )
            }

            fn mismatched_consumption_fixture(
                request: &ReplayRequestV2,
            ) -> Result<SealedReplayResultV2, ReplayOwnerErrorV2> {
                let request_meaning_digest = request.meaning_digest().expect("request meaning");
                let attempt_identity = identity("storage-attempt-v2");
                let mut observations: Vec<_> = requested_component_meanings(request)?
                    .into_iter()
                    .map(|(component, meaning)| ConsumedComponentObservationV2 {
                        request_identity: request.request_identity().clone(),
                        request_meaning_digest: request_meaning_digest.clone(),
                        attempt_identity: attempt_identity.clone(),
                        component,
                        locator: observation_locator(component, 'c'),
                        observed_meaning_identity: meaning.identity,
                        observed_meaning_digest: if component == ObservationComponentV2::ReplayConfiguration {
                            digest('f')
                        } else {
                            meaning.digest
                        },
                    })
                    .collect();
                observations.push(ConsumedComponentObservationV2 {
                    request_identity: request.request_identity().clone(),
                    request_meaning_digest: request_meaning_digest.clone(),
                    attempt_identity: attempt_identity.clone(),
                    component: ObservationComponentV2::SemanticTrace,
                    locator: observation_locator(ObservationComponentV2::SemanticTrace, 'c'),
                    observed_meaning_identity: identity("storage-semantic-trace-v2"),
                    observed_meaning_digest: digest('c'),
                });
                commit_owner_result(
                    request,
                    OwnerResultDraftV2 {
                        attempt_identity: attempt_identity.clone(),
                        terminal: ReplayTerminalV2::TerminalResult,
                        observations,
                        diagnostics: vec![DiagnosticEvidenceV2 {
                            request_identity: request.request_identity().clone(),
                            request_meaning_digest,
                            attempt_identity,
                            category: DiagnosticCategoryV2::NoExecutionDefect,
                            decisive_evidence: observation_locator(
                                ObservationComponentV2::SemanticTrace,
                                'c',
                            ),
                        }],
                    },
                )
            }

            fn observation_locator(
                component: ObservationComponentV2,
                byte: char,
            ) -> ComponentObservationLocatorV2 {
                ComponentObservationLocatorV2 {
                    component,
                    reference: identity(&format!("storage-observation-{component:?}")),
                    digest: digest(byte),
                }
            }

            fn identity(value: &str) -> OpaqueIdentityV2 {
                OpaqueIdentityV2::try_from(value.to_string()).expect("valid identity")
            }

            fn digest(byte: char) -> CanonicalDigestV2 {
                CanonicalDigestV2::try_from(format!("sha256:{}", byte.to_string().repeat(64)))
                    .expect("valid digest")
            }
        }
    };
}
