use super::{
    iteration_analysis_postgres_acceptance_tests::{
        bind_positive_result_to_owner_outcome, persist_backtest_outcome_custody,
    },
    *,
};
use crate::backtest_run_report_read_v1::{
    BacktestRunReportStateV1, REPORT_STATEMENT_TIMEOUT_MS_V1, begin_report_read_v1,
    read_report_in_transaction,
    report_test_support_v1::{
        assert_series_reads_back_every_counted_point, run_multi_day_round_trip_v1,
    },
    resolve_backtest_run_report_v1, resolve_backtest_run_result_v1,
};

/// Reads one real run's report back through the R&D role and checks every point against the bytes
/// Backtest custody actually holds.
///
/// The engine, the simulated venue and the portfolio run in this test over four constructed days;
/// nothing about the series is written down in advance. What this test does not exercise is the
/// production writer: the run reaches custody through this module's own writer rather than through
/// `run_exploratory_replay_v2`, because no ordered-chain entry can drive that writer today.
///
/// The run's request comes from the repair harness, whose program is a fixture and not one the
/// single-threshold family authors, so the whole report is refused for a named reason while its
/// result half still reads back. A run inside the family is not constructible in this chain
/// today: no entry composes a replay request from an authored Design, and the one that runs the
/// Composer on an authored Design stops at the Artifact. The positive case is proven below the
/// database instead, by authoring, freezing and reading back in
/// `single_threshold_authoring_v1`.
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
    // The result half, read the way the report reads it: in its `SERIALIZABLE, READ ONLY,
    // DEFERRABLE` transaction, where PostgreSQL refuses any row lock.
    let mut transaction = begin_report_read_v1(rd_pool, REPORT_STATEMENT_TIMEOUT_MS_V1)
        .await
        .expect("the report's read-only transaction");
    let read = resolve_backtest_run_result_v1(&mut transaction, locator)
        .await
        .expect("the committed run's result")
        .expect("a committed run behind the address");
    transaction.rollback().await.expect("R&D read rollback");
    let started = std::time::Instant::now();
    let refused = resolve_backtest_run_report_v1(rd_pool, locator)
        .await
        .expect_err("a run outside the family has no report");
    // The bound on the snapshot wait is set against this, so it is printed where a reader of the
    // chain log can compare the two.
    eprintln!(
        "backtest run report read took {} ms against a bound of {} ms",
        started.elapsed().as_millis(),
        REPORT_STATEMENT_TIMEOUT_MS_V1
    );
    let absent = resolve_backtest_run_report_v1(
        rd_pool,
        ExploratoryReplayResultLocatorV2 {
            result_identity: &format!("{result_identity}-absent"),
            request_identity: &request_identity,
            attempt_identity: &attempt_identity,
        },
    )
    .await
    .expect("an address with no run is an empty answer, not a refusal");
    assert_eq!(absent, None);
    assert_the_report_read_holds_only_what_it_names(rd_pool, locator).await;
    assert_the_snapshot_wait_is_bounded_and_named(rd_pool).await;
    assert_request_reads_without_a_lock_and_the_locking_read_still_holds_it(
        rd_pool,
        &request_identity,
        &request_digest,
    )
    .await;
    // This code is decided only after the replay request read back: a request that did not would
    // have been refused as `REPLAY_REQUEST_UNAVAILABLE` first.
    assert_eq!(refused.code(), "NO_STRATEGY_STATEMENT_FOR_FAMILY");

    // Count from what custody holds, read by the Backtest Owner, not from what the test handed it.
    let (committed, bound_digest): (Vec<u8>, String) = sqlx::query_as(
        "SELECT engine_canonical_result_bytes, (convert_from(canonical_bytes, 'UTF8')::jsonb #>> '{canonical_result,canonical_bytes_digest}') FROM backtest_native_replay_outcome_evidence_v1 WHERE result_identity=$1",
    )
    .bind(&result_identity)
    .fetch_one(backtest_pool)
    .await
    .expect("committed outcome evidence");
    assert_eq!(committed, engine_result_bytes);
    assert_series_reads_back_every_counted_point(&read.result.series, &committed);

    assert_eq!(read.result.state, BacktestRunReportStateV1::Available);
    assert_eq!(read.run.result_identity, result_identity);
    assert_eq!(read.run.request_identity, request_identity);
    assert_eq!(read.run.attempt_identity, attempt_identity);
    assert_eq!(read.run.engine_result_digest, bound_digest);
    let committed_fills = serde_json::from_slice::<serde_json::Value>(&committed)
        .expect("committed engine JSON")["fills"]
        .as_array()
        .expect("committed fills")
        .len();
    assert!(committed_fills > 0, "the real run must have traded");
    assert_eq!(read.result.fills.len(), committed_fills);
    assert_eq!(read.result.fill_count, committed_fills as u64);
}

/// The two request reads, each against the property it exists for.
///
/// Under `READ ONLY`, the lock-free read answers and the locking one is refused with 25006, which
/// is the refusal that makes a lock on the report path fail on its first call: without the
/// negative half, a read-only transaction that accepted everything would pass the positive half
/// too. Outside it, the locking read still holds the row until its transaction ends, which is
/// what the caller that writes afterwards relies on: another session's `FOR UPDATE NOWAIT` fails
/// while it holds and succeeds once it ends.
async fn assert_request_reads_without_a_lock_and_the_locking_read_still_holds_it(
    rd_pool: &PgPool,
    request_identity: &str,
    meaning_digest: &str,
) {
    let mut read_only = begin_report_read_v1(rd_pool, REPORT_STATEMENT_TIMEOUT_MS_V1)
        .await
        .expect("a read-only transaction");
    let lock_free: Option<serde_json::Value> =
        sqlx::query_scalar("SELECT rd_owner_api.read_exploratory_replay_request_v2($1,$2)")
            .bind(request_identity)
            .bind(meaning_digest)
            .fetch_one(&mut *read_only)
            .await
            .expect("the lock-free read runs in a read-only transaction");
    assert!(lock_free.is_some(), "the lock-free read finds the request");
    let locking = sqlx::query_scalar::<_, Option<serde_json::Value>>(
        "SELECT rd_owner_api.resolve_exploratory_replay_request_v2($1,$2)",
    )
    .bind(request_identity)
    .bind(meaning_digest)
    .fetch_one(&mut *read_only)
    .await
    .expect_err("a read-only transaction refuses the locking read");
    assert_eq!(
        locking
            .as_database_error()
            .and_then(|e| e.code())
            .as_deref(),
        Some("25006"),
        "refused as a read-only transaction, not for another reason: {locking}"
    );
    read_only.rollback().await.expect("read-only rollback");

    let mut holder = rd_pool.begin().await.expect("a locking transaction");
    let held: Option<serde_json::Value> =
        sqlx::query_scalar("SELECT rd_owner_api.resolve_exploratory_replay_request_v2($1,$2)")
            .bind(request_identity)
            .bind(meaning_digest)
            .fetch_one(&mut *holder)
            .await
            .expect("the locking read answers");
    assert_eq!(
        without_owner_cut(held),
        without_owner_cut(lock_free),
        "both reads answer the same request"
    );
    let try_update = |pool: PgPool| async move {
        let mut other = pool.begin().await.expect("another session");
        let outcome = sqlx::query(
            "SELECT 1 FROM public.rd_sealed_exploratory_replay_requests_v1 \
             WHERE request_identity=$1 FOR UPDATE NOWAIT",
        )
        .bind(request_identity.to_owned())
        .execute(&mut *other)
        .await;
        other.rollback().await.expect("other session rollback");
        outcome
    };
    let blocked = try_update(rd_pool.clone())
        .await
        .expect_err("the row is held while the locking read's transaction is open");
    assert_eq!(
        blocked
            .as_database_error()
            .and_then(|e| e.code())
            .as_deref(),
        Some("55P03"),
        "blocked by the held lock, not for another reason: {blocked}"
    );
    holder.rollback().await.expect("locking rollback");
    try_update(rd_pool.clone())
        .await
        .expect("the row is free once the locking read's transaction ends");
}

/// Drops the owner cut from one read of the request, after requiring it.
///
/// The cut is the instant the storage function answered (`clock_timestamp()`), so two reads a
/// few milliseconds apart carry different cuts by design. Everything else they return is the
/// sealed request and must be equal.
fn without_owner_cut(read: Option<serde_json::Value>) -> serde_json::Value {
    let mut read = read.expect("the request is found");
    let cut = read
        .as_object_mut()
        .and_then(|fields| fields.remove("owner_cut_epoch_ms"));
    assert!(
        cut.as_ref().is_some_and(serde_json::Value::is_u64),
        "every read names the instant it answered: {cut:?}"
    );
    read
}

/// Reads the locks this backend holds after the report's reads, before its transaction ends.
///
/// `READ ONLY` refuses row locks and nothing else: a table lock and an advisory lock are both
/// accepted in a read-only transaction. So the report's lock-free claim is checked here against
/// what PostgreSQL says the backend holds, not against what the transaction mode refuses. Every
/// relation lock must be `AccessShareLock`, the lock a plain read takes and one no writer waits
/// on, and anything that is not a relation lock or the transaction's own identity is listed.
///
/// Two advisory locks are named exceptions, each by the exact key it takes, so any other advisory
/// lock still fails here:
/// - the Backtest result topology fence, `vibe.backtest.result-topology.v2`, shared against the
///   exclusive fence the side that changes that topology holds;
/// - the request fence, keyed by the request identity, shared against the exclusive fence the
///   Replay commit holds. This is the fence the request storage function's isolation rule assumes.
///
/// And one table-level lock is a named exception, by relation: `ShareLock` on `pg_authid` and
/// `pg_auth_members`, which the Backtest readback's `lock_authority_catalogs_v1` takes so the role
/// topology it validates cannot change before it reads. It blocks role changes, not writes to any
/// business table, and it is taken in the migration's order: topology fence first, then these
/// catalogs, then everything else. `the_report_takes_its_fences_before_any_business_read` pins
/// that order in source, because `pg_locks` does not record it.
async fn assert_the_report_read_holds_only_what_it_names(
    rd_pool: &PgPool,
    locator: ExploratoryReplayResultLocatorV2<'_>,
) {
    let mut transaction = begin_report_read_v1(rd_pool, REPORT_STATEMENT_TIMEOUT_MS_V1)
        .await
        .expect("the report's read-only transaction");
    let refusal = read_report_in_transaction(&mut transaction, locator)
        .await
        .expect_err("the run is outside the family");
    assert_eq!(refusal.code(), "NO_STRATEGY_STATEMENT_FOR_FAMILY");
    let held: Vec<(String, String, Option<String>, Option<i64>)> = sqlx::query_as(
        "SELECT locktype, mode, relation::pg_catalog.regclass::text,
                CASE WHEN locktype = 'advisory' AND objsubid = 1
                     THEN (classid::bigint << 32) | objid::bigint END
           FROM pg_catalog.pg_locks
          WHERE pid = pg_catalog.pg_backend_pid()
          ORDER BY locktype, mode, relation::pg_catalog.regclass::text",
    )
    .fetch_all(&mut *transaction)
    .await
    .expect("this backend's locks");
    let fences: (i64, i64) = sqlx::query_as(
        "SELECT pg_catalog.hashtextextended('vibe.backtest.result-topology.v2', 0),
                pg_catalog.hashtextextended($1, 0)",
    )
    .bind(locator.request_identity)
    .fetch_one(&mut *transaction)
    .await
    .expect("the two fence keys");
    transaction.rollback().await.expect("read-only rollback");

    let relation_locks = held
        .iter()
        .filter(|(locktype, _, _, _)| locktype == "relation")
        .count();
    assert!(
        relation_locks > 0,
        "the probe sees the reads' own locks: {held:?}"
    );
    let unexpected = held
        .iter()
        .filter(|(locktype, mode, relation, key)| {
            let named_fence = locktype == "advisory"
                && mode == "ShareLock"
                && (*key == Some(fences.0) || *key == Some(fences.1));
            let role_catalog = locktype == "relation"
                && mode == "ShareLock"
                && matches!(relation.as_deref(), Some("pg_authid" | "pg_auth_members"));
            !named_fence
                && !role_catalog
                && !matches!(
                    (locktype.as_str(), mode.as_str()),
                    ("relation", "AccessShareLock")
                        | ("virtualxid" | "transactionid", "ExclusiveLock")
                )
        })
        .collect::<Vec<_>>();
    assert!(
        unexpected.is_empty(),
        "the report read holds locks beyond plain reads: {unexpected:?}"
    );
}

/// A report that cannot get a safe snapshot in time is refused under its own name, and gets one
/// as soon as nothing stands in the way.
///
/// `DEFERRABLE` waits while a serializable transaction that may write is open, so one is held open
/// here, having taken its snapshot and written nothing. The control is the same call after it ends:
/// without it, a report that always timed out would pass the first half.
async fn assert_the_snapshot_wait_is_bounded_and_named(rd_pool: &PgPool) {
    let bound_ms = 500;
    let mut writer = rd_pool.begin().await.expect("a serializable writer");
    sqlx::query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE")
        .execute(&mut *writer)
        .await
        .expect("serializable isolation");
    sqlx::query("SELECT 1")
        .execute(&mut *writer)
        .await
        .expect("the writer takes its snapshot");

    let started = std::time::Instant::now();
    let refusal = begin_report_read_v1(rd_pool, bound_ms)
        .await
        .expect_err("no safe snapshot while a serializable writer is open");
    let waited = started.elapsed().as_millis();
    assert_eq!(refusal.code(), "REPORT_SNAPSHOT_UNAVAILABLE", "{refusal}");
    assert!(
        waited >= u128::from(bound_ms),
        "refused after {waited} ms, before its {bound_ms} ms bound"
    );

    writer.rollback().await.expect("the writer ends");
    begin_report_read_v1(rd_pool, bound_ms)
        .await
        .expect("a safe snapshot once no serializable writer is open")
        .rollback()
        .await
        .expect("read-only rollback");
}
