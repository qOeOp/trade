import assert from "node:assert/strict"
import test from "node:test"
import {
  buildL2WatchConsumerForegroundPlan,
  buildL2WatchConsumerForegroundReceipt,
} from "./l2-book-watch-consumer-foreground"
import type { L2WatchConsumerConfig } from "./l2-book-watch-consumer-runtime"

const config: L2WatchConsumerConfig = {
  max_cycles: 120,
  session_ms: 300_000,
  max_events: 20,
  watch_ms: 1_000,
  depth: 20,
  max_freshness_ms: 1_000,
  duration_seconds: 0,
  restart_limit: 8,
}

test("foreground consumer plan owns one exact existing supervisor child", () => {
  const plan = buildL2WatchConsumerForegroundPlan({
    root: "/repo",
    module_root: "/repo/modules/orchestration-ops/l2-current-book-probe",
    bun_path: "/usr/bin/bun",
    token: "foreground-1",
    config,
  })
  assert.equal(plan.runtime_ref, "tmp/l2-book-watch-consumer/runtime/foreground-1")
  assert.deepEqual(plan.supervisor_command.slice(0, 2), [
    "/usr/bin/bun",
    "/repo/modules/orchestration-ops/l2-current-book-probe/src/scripts/consumer-supervisor.ts",
  ])
  const receipt = buildL2WatchConsumerForegroundReceipt("/repo", plan, 42, "2026-07-23T00:00:00Z")
  assert.equal(receipt.supervisor_pid, 42)
  assert.equal(receipt.runtime_directory, plan.runtime_ref)
  assert.equal(receipt.config.restart_limit, 8)
})

test("foreground consumer plan rejects unsafe identity and pid", () => {
  assert.throws(() => buildL2WatchConsumerForegroundPlan({
    root: "/repo",
    module_root: "/repo/modules/orchestration-ops/l2-current-book-probe",
    bun_path: "/usr/bin/bun",
    token: "../escape",
    config,
  }), /token/)
  const plan = buildL2WatchConsumerForegroundPlan({
    root: "/repo",
    module_root: "/repo/modules/orchestration-ops/l2-current-book-probe",
    bun_path: "/usr/bin/bun",
    token: "foreground-2",
    config,
  })
  assert.throws(() => buildL2WatchConsumerForegroundReceipt("/repo", plan, 0, "2026-07-23T00:00:00Z"), /pid/)
})
