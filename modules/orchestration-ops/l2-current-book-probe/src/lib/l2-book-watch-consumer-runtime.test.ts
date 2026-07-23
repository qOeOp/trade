import { mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import assert from "node:assert/strict"
import test from "node:test"
import {
  L2_WATCH_CONSUMER_OBSERVATION_SCHEMA,
  L2_WATCH_CONSUMER_RECEIPT_SCHEMA,
  L2_WATCH_CONSUMER_RUNTIME_SCHEMA,
  assertL2WatchConsumerRuntimeRef,
  buildL2WatchConsumerOwnerRead,
  carryForwardL2WatchConsumerMetrics,
  findUniqueActiveL2WatchConsumer,
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
  const result = buildL2WatchConsumerOwnerRead(
    { observed_at: "2026-07-22T00:00:05.000Z", active: active() },
    matchingProcesses(),
  )
  assert.equal(result.status, "healthy")
  assert.equal((result.readiness as Record<string, unknown>).overall_ready, true)
  assert.equal((result.latest_baseline as Record<string, unknown>).stream_epoch, "epoch-1")
  assert.equal((result.metrics as Record<string, unknown>).watch_cycle_total, 5)
  assert.equal((result.last_failure as Record<string, unknown>).error_class, "owner_health_unavailable")
  assert.equal(result.consumer_authority, "non_economic_observation_only")
  assert.equal(result.lifecycle_authority, "none")
  assert.deepEqual(result.writes, [])
  const text = JSON.stringify(result)
  assert.equal(text.includes("runtime_directory"), false)
  assert.equal(text.includes("consumer_pid"), false)
  assert.equal(text.includes("supervisor_pid"), false)
})

test("owner read degrades stale state and fails closed on observation identity drift", () => {
  const stale = buildL2WatchConsumerOwnerRead(
    { observed_at: "2026-07-22T00:01:00.000Z", active: active() },
    matchingProcesses(),
  )
  assert.equal(stale.status, "degraded")
  assert.equal((stale.readiness as Record<string, unknown>).overall_ready, false)
  assert.throws(() => buildL2WatchConsumerOwnerRead(
    {
      observed_at: "2026-07-22T00:00:05.000Z",
      active: { ...active(), observation: { ...active().observation!, consumer_pid: process.pid + 1 } },
    },
    matchingProcesses(),
  ), /observation pid drifted/)
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

test("active consumer ignores a live but PID-reused process and preserves exact-match fail-closed behavior", () => {
  const root = join(tmpdir(), `l2-watch-consumer-active-${crypto.randomUUID()}`)
  writeActive(root, "old", 101)
  writeActive(root, "current", 202)
  const matched: Array<[number, string]> = []
  const selected = findUniqueActiveL2WatchConsumer(root, {
    process_matches_supervisor: (pid, runtimeDirectory) => {
      matched.push([pid, runtimeDirectory])
      return pid === 202 && runtimeDirectory.endsWith("/current")
    },
  })
  assert.equal(selected?.receipt.supervisor_pid, 202)
  assert.deepEqual(matched, [
    [202, "tmp/l2-book-watch-consumer/runtime/current"],
    [101, "tmp/l2-book-watch-consumer/runtime/old"],
  ])
  assert.throws(() => findUniqueActiveL2WatchConsumer(root, {
    process_matches_supervisor: () => true,
  }), /multiple active/)
})

function config(): L2WatchConsumerConfig {
  return {
    symbol: "BTCUSDT",
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
      last_failure: {
        observed_at: "2026-07-22T00:00:03.000Z",
        operation: "snapshot",
        error_class: "owner_health_unavailable",
        attempt: 1,
      },
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

function matchingProcesses() {
  return {
    process_matches_supervisor: () => true,
    process_matches_worker: () => true,
  }
}

function writeActive(root: string, token: string, pid: number): void {
  const value = active()
  value.receipt.supervisor_pid = pid
  value.receipt.runtime_directory = `tmp/l2-book-watch-consumer/runtime/${token}`
  value.receipt.runtime_state_path = `${value.receipt.runtime_directory}/runtime-state.json`
  value.receipt.observation_state_path = `${value.receipt.runtime_directory}/observation-state.json`
  value.receipt.terminal_state_path = `${value.receipt.runtime_directory}/terminal-state.json`
  value.receipt.log_path = `${value.receipt.runtime_directory}/supervisor.log`
  value.runtime.supervisor_pid = pid
  value.runtime.consumer_pid = pid + 1
  value.observation!.consumer_pid = pid + 1
  const directory = join(root, value.receipt.runtime_directory)
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, "launch-receipt.json"), JSON.stringify(value.receipt))
  writeFileSync(join(directory, "runtime-state.json"), JSON.stringify(value.runtime))
  writeFileSync(join(directory, "observation-state.json"), JSON.stringify(value.observation))
}
