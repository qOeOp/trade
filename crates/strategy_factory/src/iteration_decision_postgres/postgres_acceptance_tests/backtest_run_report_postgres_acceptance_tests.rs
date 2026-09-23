use super::{
    iteration_analysis_postgres_acceptance_tests::{
        bind_positive_result_to_owner_outcome, persist_backtest_outcome_custody,
    },
    *,
};
use crate::backtest_run_report_read_v1::{
    BacktestRunReportStateV1,
    report_test_support_v1::{
        independently_counted_points, instant_of, run_multi_day_round_trip_v1,
    },
    resolve_backtest_run_report_v1,
};

/// Reads one real run's report back through the R&D role and checks every point against the bytes
/// Backtest custody actually holds.
///
/// The engine, the simulated venue and the portfolio run in this test over four constructed days;
/// nothing about the series is written down in advance. What this test does not exercise is the
/// production writer: the run reaches custody through this module's own writer rather than through
/// `run_exploratory_replay_v2`, because no ordered-chain entry can drive that writer today.
#[tokio::test]
#[ignore = "requires the canonical disposable R&D and Backtest Owner PostgreSQL topology"]
async fn backtest_run_report_reads_back_every_point_a_real_run_committed() {
    let database = CanonicalOwnerPostgresTestDatabaseV1::admit()
        .await
        .expect("canonical disposable topology");
    let mutation = database.mutation();
    let rd_pool = mutation.pool(CanonicalOwnerTestRoleV1::RdOwner);
    let backtest_pool = mutation.pool(CanonicalOwnerTestRoleV1::BacktestOwner);
    let suffix = unique_suffix();
    let committed_at = current_epoch_ms().expect("test clock");
    let market_data_evidence =
        issue_market_data_repair_evidence_v1().expect("sealed Market Data evidence");
    let harness = Box::pin(persist_repair_replay_predecessor(
        &database,
        &market_data_evidence,
        &suffix,
    ))
    .await;
    let replay = harness.predecessor.request().as_dto();
    let request_identity = harness.predecessor.request_identity().to_string();
    let request_digest = harness.predecessor.meaning_digest().to_string();
    let attempt_identity = format!("backtest-attempt-run-report-{suffix}");
    let semantic_trace_bytes = format!("canonical-run-report-semantic-trace-{suffix}").into_bytes();
    let mut result = positive_result(
        &request_identity,
        &request_digest,
        &attempt_identity,
        &harness.intent_identity,
        &harness.intent_digest,
        &suffix,
    );
    bind_positive_result_to_owner_outcome(&mut result, replay, &semantic_trace_bytes);
    let result_bytes = result
        .to_canonical_bytes()
        .expect("canonical Replay Result");
    let result_identity = result.result_identity.as_str().to_string();
    let engine_result_bytes = run_multi_day_round_trip_v1()
        .to_bytes()
        .expect("the real run's canonical result");
    persist_backtest_result(backtest_pool, &result, &result_bytes, committed_at).await;
    persist_backtest_outcome_custody(
        backtest_pool,
        &result,
        &semantic_trace_bytes,
        &engine_result_bytes,
        committed_at,
    )
    .await;

    let locator = ExploratoryReplayResultLocatorV2 {
        result_identity: &result_identity,
        request_identity: &request_identity,
        attempt_identity: &attempt_identity,
    };
    let mut transaction = rd_pool.begin().await.expect("R&D read transaction");
    let report = resolve_backtest_run_report_v1(&mut transaction, locator)
        .await
        .expect("the committed run's report")
        .expect("a committed run behind the address");
    let absent = resolve_backtest_run_report_v1(
        &mut transaction,
        ExploratoryReplayResultLocatorV2 {
            result_identity: &format!("{result_identity}-absent"),
            request_identity: &request_identity,
            attempt_identity: &attempt_identity,
        },
    )
    .await
    .expect("an address with no run is an empty answer, not a refusal");
    transaction.rollback().await.expect("R&D read rollback");
    assert_eq!(absent, None);

    // Count from what custody holds, read by the Backtest Owner, not from what the test handed it.
    let (committed, bound_digest): (Vec<u8>, String) = sqlx::query_as(
        "SELECT engine_canonical_result_bytes, (convert_from(canonical_bytes, 'UTF8')::jsonb #>> '{canonical_result,canonical_bytes_digest}') FROM backtest_native_replay_outcome_evidence_v1 WHERE result_identity=$1",
    )
    .bind(&result_identity)
    .fetch_one(backtest_pool)
    .await
    .expect("committed outcome evidence");
    assert_eq!(committed, engine_result_bytes);
    let expected = independently_counted_points(&committed);
    assert!(
        expected.len() >= 2,
        "a dropped point is only visible when the run recorded at least two, it recorded {}",
        expected.len()
    );
    let read_back = report
        .series
        .iter()
        .map(|point| (instant_of(&point.at), point.value))
        .collect::<Vec<_>>();
    assert_eq!(read_back, expected);

    assert_eq!(report.state, BacktestRunReportStateV1::Available);
    assert_eq!(report.run.result_identity, result_identity);
    assert_eq!(report.run.request_identity, request_identity);
    assert_eq!(report.run.attempt_identity, attempt_identity);
    assert_eq!(report.run.engine_result_digest, bound_digest);
    let committed_fills = serde_json::from_slice::<serde_json::Value>(&committed)
        .expect("committed engine JSON")["fills"]
        .as_array()
        .expect("committed fills")
        .len();
    assert!(committed_fills > 0, "the real run must have traded");
    assert_eq!(report.fills.len(), committed_fills);
    assert_eq!(report.fill_count, committed_fills as u64);
}
