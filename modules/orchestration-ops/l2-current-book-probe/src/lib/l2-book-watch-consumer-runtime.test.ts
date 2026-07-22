import assert from "node:assert/strict"
import test from "node:test"
import {
  L2_WATCH_CONSUMER_OBSERVATION_SCHEMA,
  L2_WATCH_CONSUMER_RECEIPT_SCHEMA,
  L2_WATCH_CONSUMER_RUNTIME_SCHEMA,
  assertL2WatchConsumerRuntimeRef,
  buildL2WatchConsumerOwnerRead,
  carryForwardL2WatchConsumerMetrics,
  parseL2WatchConsumerLaunchArgs,
  type ActiveL2WatchConsumer,
  type L2WatchConsumerConfig,
} from "./l2-book-watch-consumer-runtime"

test("consumer launch controls are bounded and infrastructure-closed", () => {
  assert.deepEqual(parseL2WatchConsumerLaunchArgs([]), config())
  assert.equal(parseL2WatchConsumerLaunchArgs(["--watch-ms", "500", "--duration-seconds", "10"]).watch_ms, 500)
  assert.throws(() => parseL2WatchConsumerLaunchArgs(["--endpoint", "remote"]), /unknown argument/)
  assert.throws(() => parseL2WatchConsumerLaunchArgs(["--watch-ms", "500", "--watch-ms", "600"]), /duplicate argument/)
  assert.throws(() => parseL2WatchConsumerLaunchArgs(["--watch-ms", "5.5"]), /unsigned integers/)
  assert.throws(() => parseL2WatchConsumerLaunchArgs(["--session-ms", "4000", "--watch-ms", "2000"]), /must cover/)
})

test("consumer runtime refs cannot escape their private control root", () => {
  const root = "/project"
  assert.equal(assertL2WatchConsumerRuntimeRef(root, "tmp/l2-book-watch-consumer/runtime/test"), "/project/tmp/l2-book-watch-consumer/runtime/test")
  assert.throws(() => assertL2WatchConsumerRuntimeRef(root, "tmp/other"), /must stay under/)
  assert.throws(() => assertL2WatchConsumerRuntimeRef(root, "../escape"), /must stay under/)
})

test("owner read exposes fresh baseline and aggregate metrics without process internals", () => {
  const result = buildL2WatchConsumerOwnerRead({ observed_at: "2026-07-22T00:00:05.000Z", active: active() })
  assert.equal(result.status, "healthy")
  assert.equal((result.readiness as Record<string, unknown>).overall_ready, true)
  assert.equal((result.latest_baseline as Record<string, unknown>).stream_epoch, "epoch-1")
  assert.equal((result.metrics as Record<string, unknown>).watch_cycle_total, 5)
  assert.equal(result.consumer_authority, "non_economic_observation_only")
  assert.equal(result.lifecycle_authority, "none")
  assert.deepEqual(result.writes, [])
  const text = JSON.stringify(result)
  assert.equal(text.includes("runtime_directory"), false)
  assert.equal(text.includes("consumer_pid"), false)
  assert.equal(text.includes("supervisor_pid"), false)
})

test("owner read degrades stale state and fails closed on observation identity drift", () => {
  const stale = buildL2WatchConsumerOwnerRead({ observed_at: "2026-07-22T00:01:00.000Z", active: active() })
  assert.equal(stale.status, "degraded")
  assert.equal((stale.readiness as Record<string, unknown>).overall_ready, false)
  assert.throws(() => buildL2WatchConsumerOwnerRead({
    observed_at: "2026-07-22T00:00:05.000Z",
    active: { ...active(), observation: { ...active().observation!, consumer_pid: process.pid + 1 } },
  }), /observation pid drifted/)
})

test("owner read represents no active resident consumer without inventing readiness", () => {
  const result = buildL2WatchConsumerOwnerRead({ observed_at: "2026-07-22T00:00:05.000Z", active: null })
  assert.equal(result.status, "unavailable")
  assert.equal(result.latest_baseline, null)
  assert.equal((result.readiness as Record<string, unknown>).overall_ready, false)
})

test("worker restart carries supervisor-lifetime counters and advances start count", () => {
  const previous = active().observation!
  const metrics = carryForwardL2WatchConsumerMetrics(previous, 2)
  assert.equal(metrics.worker_start_total, 2)
  assert.equal(metrics.watch_cycle_total, 5)
  assert.equal(metrics.observed_event_total, 30)
  assert.throws(() => carryForwardL2WatchConsumerMetrics({ ...previous, metrics: { ...previous.metrics, watch_cycle_total: -1 } }, 2), /previous.metrics.watch_cycle_total/)
})

function config(): L2WatchConsumerConfig {
  return {
    max_cycles: 120,
    session_ms: 300_000,
    max_events: 20,
    watch_ms: 1_000,
    depth: 20,
    max_freshness_ms: 1_000,
    duration_seconds: 0,
    restart_limit: 0,
  }
}

function active(): ActiveL2WatchConsumer {
  return {
    receipt: {
      schema_version: L2_WATCH_CONSUMER_RECEIPT_SCHEMA,
      launched_at: "2026-07-22T00:00:00.000Z",
      supervisor_pid: process.pid,
      runtime_directory: "tmp/l2-book-watch-consumer/runtime/test",
      runtime_state_path: "tmp/l2-book-watch-consumer/runtime/test/runtime-state.json",
      observation_state_path: "tmp/l2-book-watch-consumer/runtime/test/observation-state.json",
      terminal_state_path: "tmp/l2-book-watch-consumer/runtime/test/terminal-state.json",
      log_path: "tmp/l2-book-watch-consumer/runtime/test/supervisor.log",
      config: config(),
    },
    runtime: {
      schema_version: L2_WATCH_CONSUMER_RUNTIME_SCHEMA,
      updated_at: "2026-07-22T00:00:04.000Z",
      status: "running",
      supervisor_pid: process.pid,
      consumer_pid: process.pid,
      attempt: 1,
      consecutive_failures: 0,
      last_exit_code: null,
      next_restart_at: null,
    },
    observation: {
      schema_version: L2_WATCH_CONSUMER_OBSERVATION_SCHEMA,
      updated_at: "2026-07-22T00:00:04.500Z",
      started_at: "2026-07-22T00:00:00.100Z",
      status: "live",
      ready: true,
      consumer_pid: process.pid,
      baseline_snapshot_at: "2026-07-22T00:00:00.500Z",
      stream_epoch: "epoch-1",
      book_hash: "a".repeat(64),
      snapshot_freshness_ms: 10,
      last_watch_at: "2026-07-22T00:00:04.500Z",
      last_watch_event_count: 6,
      last_error_class: "",
      metrics: {
        worker_start_total: 1,
        watch_cycle_total: 5,
        snapshot_total: 1,
        resnapshot_total: 0,
        retry_total: 0,
        watch_failure_total: 0,
        snapshot_failure_total: 0,
        reconnect_total: 0,
        resync_signal_total: 0,
        epoch_change_total: 0,
        observed_event_total: 30,
      },
    },
    terminal: null,
  }
}
