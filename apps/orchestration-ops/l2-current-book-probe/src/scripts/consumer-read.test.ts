import assert from "node:assert/strict"
import test from "node:test"
import { resolve } from "node:path"

test("resident consumer owner read has one fixed no-input surface", () => {
  const invocation = Bun.spawnSync({
    cmd: [process.execPath, resolve(import.meta.dir, "consumer-read.ts")],
    cwd: resolve(import.meta.dir, "../../../../.."),
    stdout: "pipe",
    stderr: "pipe",
    timeout: 5_000,
  })
  assert.equal(invocation.exitCode, 0, invocation.stderr.toString())
  const response = JSON.parse(invocation.stdout.toString()) as Record<string, unknown>
  assert.equal(response.ok, true)
  assert.equal(response.action, "read_active_l2_book_watch_consumer")
  assert.equal((response.consumer as Record<string, unknown>).schema_version, "trade.ops-l2-watch-consumer-owner-read.v1")
})
