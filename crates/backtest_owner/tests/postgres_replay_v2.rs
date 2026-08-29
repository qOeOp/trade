// This macro keeps the storage test inside the library crate. Its private result fixture exercises
// only durable-storage semantics; it is not evidence of a Market -> runner -> U2 composition path.
#[macro_export]
macro_rules! postgres_replay_v2_tests {
    () => {
        #[cfg(test)]
        mod durable_postgres_replay_v2 {
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
