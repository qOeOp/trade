import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import assert from "node:assert/strict"
import test from "node:test"
import { findUniqueActiveL2Runtime } from "./active-runtime"
import type { LaunchConfig, LaunchReceipt, RuntimeState } from "./runtime-contract"

test("active runtime ignores a live but PID-reused process whose command does not match receipt", () => {
  const root = join(tmpdir(), `l2-active-runtime-${crypto.randomUUID()}`)
  writeRuntime(root, "old", 101)
  writeRuntime(root, "current", 202)
  const matched: Array<[number, string]> = []
  const active = findUniqueActiveL2Runtime(root, {
    process_matches_supervisor: (pid, runtimeDirectory) => {
      matched.push([pid, runtimeDirectory])
      return pid === 202 && runtimeDirectory.endsWith("/current")
    },
  })
  assert.equal(active?.receipt.supervisor_pid, 202)
  assert.deepEqual(matched, [
    [202, "tmp/l2-order-book-service/runtime/current"],
    [101, "tmp/l2-order-book-service/runtime/old"],
  ])
})

test("active runtime still fails closed when two exact supervisor identities match", () => {
  const root = join(tmpdir(), `l2-active-runtime-${crypto.randomUUID()}`)
  writeRuntime(root, "one", 101)
  writeRuntime(root, "two", 202)
  assert.throws(() => findUniqueActiveL2Runtime(root, {
    process_matches_supervisor: () => true,
  }), /multiple active/)
})

test("active runtime may select one exact supervisor per symbol without weakening global ambiguity", () => {
  const root = join(tmpdir(), `l2-active-runtime-${crypto.randomUUID()}`)
  writeRuntime(root, "btc", 101)
  writeRuntime(root, "eth", 202, "ETHUSDT")
  const options = { process_matches_supervisor: () => true }
  assert.equal(findUniqueActiveL2Runtime(root, { ...options, symbol: "BTCUSDT" })?.receipt.config.symbol, "BTCUSDT")
  assert.equal(findUniqueActiveL2Runtime(root, { ...options, symbol: "ETHUSDT" })?.receipt.config.symbol, "ETHUSDT")
  assert.throws(() => findUniqueActiveL2Runtime(root, options), /multiple active/)
})

function writeRuntime(root: string, token: string, pid: number, symbol = "BTCUSDT"): void {
  const runtimeRef = `tmp/l2-order-book-service/runtime/${token}`
  const runtimeDirectory = join(root, runtimeRef)
  mkdirSync(runtimeDirectory, { recursive: true })
  const config: LaunchConfig = {
    symbol,
    output_base: "data/l2",
    listen: "127.0.0.1:51061",
    epoch_seconds: 86_100,
    duration_seconds: 0,
    queue_capacity: 256,
    segment_frames: 1_000,
    sync_every_frames: 100,
    stale_after_ms: 2_000,
    restart_limit: 8,
    market_data_db: "data/market_data.db",
    admission_interval_ms: 30_000,
    disk_check_interval_ms: 5_000,
    disk_soft_min_bytes: 10 * 1024 ** 3,
    disk_hard_min_bytes: 5 * 1024 ** 3,
    resource_check_interval_ms: 30_000,
  }
  const receipt: LaunchReceipt = {
    schema_version: "trade.l2-service-launch-receipt.v1",
    launched_at: "2026-07-23T08:00:00.000Z",
    supervisor_pid: pid,
    runtime_directory: runtimeRef,
    runtime_state_path: `${runtimeRef}/runtime-state.json`,
    terminal_state_path: `${runtimeRef}/terminal-state.json`,
    log_path: `${runtimeRef}/supervisor.log`,
    service_binary: "apps/market-data-products/l2-order-book-service/target/release/l2-order-book-service",
    query_binary: "apps/market-data-products/l2-order-book-service/target/release/l2-order-book-query",
    config,
  }
  const state: RuntimeState = {
    schema_version: "trade.l2-service-runtime-state.v1",
    updated_at: "2026-07-23T08:00:01.000Z",
    status: "running",
    supervisor_pid: pid,
    service_pid: pid + 1,
    attempt: 1,
    consecutive_failures: 0,
    last_exit_code: null,
    next_restart_at: null,
    disk_status: "healthy",
    disk_available_bytes: 20 * 1024 ** 3,
    disk_last_error: "",
    admission_status: "ready",
    admission_last_checked_at: "2026-07-23T08:00:01.000Z",
    admission_last_error: "",
    admission_created_total: 0,
    admission_rejected_incomplete_total: 0,
    admission_rejected_invalid_total: 0,
    resource_last_checked_at: "2026-07-23T08:00:01.000Z",
    resource_last_error: "",
    service_rss_bytes: 1_000,
    service_rss_max_bytes: 1_000,
    service_cpu_percent: 1,
    service_cpu_max_percent: 1,
  }
  writeFileSync(join(runtimeDirectory, "launch-receipt.json"), JSON.stringify(receipt))
  writeFileSync(join(runtimeDirectory, "runtime-state.json"), JSON.stringify(state))
}
