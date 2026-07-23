import assert from "node:assert/strict"
import test from "node:test"
import { planL2DiskPressure } from "./disk-pressure-policy"

test("L2 disk pressure keeps healthy and soft-limit service operation available", () => {
  assert.deepEqual(planL2DiskPressure("healthy", 5_000), {
    action: "run", reason: "disk_ready", recheck_delay_ms: 0,
  })
  assert.deepEqual(planL2DiskPressure("soft_limit", 5_000), {
    action: "run", reason: "disk_ready", recheck_delay_ms: 0,
  })
})

test("L2 disk pressure waits in-process at hard or unknown status", () => {
  assert.deepEqual(planL2DiskPressure("hard_limit", 2_000), {
    action: "wait", reason: "disk_hard_limit", recheck_delay_ms: 5_000,
  })
  assert.deepEqual(planL2DiskPressure("unknown", 30_000), {
    action: "wait", reason: "disk_status_unavailable", recheck_delay_ms: 30_000,
  })
  assert.throws(() => planL2DiskPressure("healthy", 999), /interval/)
})
