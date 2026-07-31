import assert from "node:assert/strict"
import test from "node:test"
import { buildL2ForegroundReceipt, buildL2ForegroundRuntimePlan } from "./foreground-runtime"
import type { LaunchConfig } from "./runtime-contract"

const config: LaunchConfig = {
  symbol: "BTCUSDT",
  output_base: "data/l2",
  listen: "127.0.0.1:50061",
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

test("foreground L2 plan keeps one exact supervisor child and repository refs", () => {
  const plan = buildL2ForegroundRuntimePlan({
    root: "/repo",
    module_root: "/repo/apps/market-data-products/l2-order-book-service",
    bun_path: "/usr/bin/bun",
    token: "foreground-1",
    config,
  })
  assert.equal(plan.runtime_ref, "tmp/l2-order-book-service/runtime/foreground-1")
  assert.deepEqual(plan.supervisor_command.slice(0, 2), [
    "/usr/bin/bun",
    "/repo/apps/market-data-products/l2-order-book-service/src/scripts/runtime-supervisor.ts",
  ])
  assert.equal(plan.supervisor_command.includes("--yes-public-network"), false)
  const receipt = buildL2ForegroundReceipt("/repo", plan, 42, "2026-07-23T00:00:00Z")
  assert.equal(receipt.supervisor_pid, 42)
  assert.equal(receipt.runtime_directory, plan.runtime_ref)
  assert.equal(receipt.service_binary, "apps/market-data-products/l2-order-book-service/target/release/l2-order-book-service")
})

test("foreground L2 plan rejects unsafe identity and path inputs", () => {
  assert.throws(() => buildL2ForegroundRuntimePlan({
    root: "/repo",
    module_root: "/outside/l2",
    bun_path: "/usr/bin/bun",
    token: "../escape",
    config,
  }), /token/)
  const plan = buildL2ForegroundRuntimePlan({
    root: "/repo",
    module_root: "/repo/apps/market-data-products/l2-order-book-service",
    bun_path: "/usr/bin/bun",
    token: "foreground-2",
    config,
  })
  assert.throws(() => buildL2ForegroundReceipt("/repo", plan, 1, "2026-07-23T00:00:00Z"), /pid/)
})
