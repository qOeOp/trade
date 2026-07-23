import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import assert from "node:assert/strict"
import test from "node:test"
import { archiveInactiveL2Runtimes, planInactiveL2RuntimeArchive } from "./runtime-gc"

test("runtime GC archives only old non-matching supervisor receipts", () => {
  const root = join(tmpdir(), `l2-runtime-gc-${crypto.randomUUID()}`)
  writeReceipt(root, "active", 101)
  writeReceipt(root, "reused", 202)
  writeReceipt(root, "young", 303)
  const dependencies = {
    process_matches_supervisor: (pid: number) => pid === 101,
    directory_mtime_ms: (path: string) => path.endsWith("/young")
      ? Date.parse("2026-07-23T00:09:30.000Z")
      : Date.parse("2026-07-23T00:00:00.000Z"),
  }
  const moves = planInactiveL2RuntimeArchive(
    root,
    "2026-07-23T00:10:00.000Z",
    60_000,
    dependencies,
  )
  assert.equal(moves.length, 1)
  assert.equal(moves[0]?.reason, "inactive_supervisor")
  assert.equal(moves[0]?.runtime_directory.endsWith("/reused"), true)
  archiveInactiveL2Runtimes(root, "2026-07-23T00:10:00.000Z", 60_000, dependencies)
  assert.equal(existsSync(join(root, "tmp/l2-order-book-service/runtime/active")), true)
  assert.equal(existsSync(join(root, "tmp/l2-order-book-service/runtime/young")), true)
  assert.equal(existsSync(join(root, "tmp/l2-order-book-service/runtime/reused")), false)
  assert.equal(existsSync(join(root, "tmp/l2-order-book-service/archive/reused")), true)
})

test("runtime GC fails closed on receipt identity drift and archive collisions", () => {
  const root = join(tmpdir(), `l2-runtime-gc-${crypto.randomUUID()}`)
  writeReceipt(root, "drifted", 101, "other")
  assert.throws(() => planInactiveL2RuntimeArchive(
    root,
    "2026-07-23T00:10:00.000Z",
    60_000,
    { directory_mtime_ms: () => 0, process_matches_supervisor: () => false },
  ), /identity drifted/)
})

function writeReceipt(root: string, token: string, pid: number, receiptToken = token): void {
  const directory = join(root, "tmp/l2-order-book-service/runtime", token)
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, "launch-receipt.json"), JSON.stringify({
    schema_version: "trade.l2-service-launch-receipt.v1",
    launched_at: "2026-07-23T00:00:00.000Z",
    supervisor_pid: pid,
    runtime_directory: `tmp/l2-order-book-service/runtime/${receiptToken}`,
    runtime_state_path: `tmp/l2-order-book-service/runtime/${receiptToken}/runtime-state.json`,
    terminal_state_path: `tmp/l2-order-book-service/runtime/${receiptToken}/terminal-state.json`,
    log_path: `tmp/l2-order-book-service/runtime/${receiptToken}/supervisor.log`,
    service_binary: "modules/market-data-products/l2-order-book-service/target/release/l2-order-book-service",
    query_binary: "modules/market-data-products/l2-order-book-service/target/release/l2-order-book-query",
    config: {
      symbol: "BTCUSDT",
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
    },
  }))
}
