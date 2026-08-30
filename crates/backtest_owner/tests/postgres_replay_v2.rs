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
            #[ignore = "requires a disposable topology with a controlled pre-persist revocation function"]
            async fn revocation_between_validation_and_insert_writes_nothing() {
                let (backtest_url, request_owner, locator, result) =
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
                    [0, 0],
                    "revocation immediately before the run insert must win"
                );
                assert_eq!(
                    commit.expect_err("revoked request must not commit"),
                    PostgresReplayOwnerErrorV2::RequestUnavailable
                );
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
                let (backtest_url, request_owner, locator, sealed_result) =
                    seeded_storage_context('h').await;
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
                assert_eq!(total_counts(&backtest_url).await, [0, 0]);
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
                assert_eq!(total_counts(&backtest_url).await, [0, 0]);
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
                assert_eq!(total_counts(&backtest_url).await, [0, 0]);

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
                assert_eq!(total_counts(&backtest_url).await, [0, 0]);

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
                assert_eq!(total_counts(&backtest_url).await, [0, 0]);

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
                assert_eq!(total_counts(&backtest_url).await, [0, 0]);
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
                assert_eq!(total_counts(&backtest_url).await, [0, 0]);

                assert_eq!(
                    mismatched_consumption_fixture(&request)
                        .expect_err("U2 must reject invented actual-consumption meaning"),
                    ReplayOwnerErrorV2::ConsumptionMismatch(
                        ObservationComponentV2::ReplayConfiguration
                    )
                );
                assert_eq!(total_counts(&backtest_url).await, [0, 0]);

                let committed = owner
                    .commit_exploratory_replay_result_v2(&request_owner, &locator, &result)
                    .await
                    .expect("exact U1 request and already sealed U2 result commit atomically");
                assert_eq!(total_counts(&backtest_url).await, [1, 1]);
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
                assert_eq!(total_counts(&backtest_url).await, [1, 1]);
                assert_eq!(counts_by_result(&backtest_url, conflicting.result_identity()).await, [0, 0]);
            }

            #[tokio::test]
            #[ignore = "requires a seeded Replay V2 request and controlled external-FK injection"]
            async fn existing_handle_rejects_post_connect_external_inbound_fk() {
                let (backtest_url, request_owner, locator, result) =
                    seeded_storage_context('g').await;
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
                assert_eq!(total_counts(&backtest_url).await, [0, 0]);
            }

            fn assert_result_census(bytes: &[u8]) {
                let encoded: serde_json::Value =
                    serde_json::from_slice(bytes).expect("canonical result JSON");
                assert_eq!(encoded["reconciliation"].as_array().map(Vec::len), Some(28));
                assert!(encoded["semantic_trace"].is_object());
                assert_eq!(encoded["diagnostic_census"].as_array().map(Vec::len), Some(1));
                assert_eq!(encoded["terminal"], "TERMINAL_RESULT");
            }

            async fn total_counts(database_url: &str) -> [i64; 2] {
                let pool = PgPool::connect(database_url).await.expect("Backtest count pool");
                [
                    sqlx::query_scalar("SELECT COUNT(*) FROM public.backtest_replay_runs_v2")
                        .fetch_one(&pool).await.expect("run count"),
                    sqlx::query_scalar("SELECT COUNT(*) FROM public.backtest_replay_results_v2")
                        .fetch_one(&pool).await.expect("result count"),
                ]
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
                (backtest_url, request_owner, locator, result)
            }

            async fn assert_binding_tamper_fails_closed(query: &'static str, trace_byte: char) {
                let (backtest_url, request_owner, locator, result) =
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
