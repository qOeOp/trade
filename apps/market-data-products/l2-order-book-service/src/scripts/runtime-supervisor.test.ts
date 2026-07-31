import assert from "node:assert/strict"
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"
import { repoRoot } from "../../../../contracts/runtime-core/src/paths"

test("runtime supervisor stays resident at the hard disk watermark and stops cleanly", async () => {
  const root = repoRoot()
  const token = `hard-pressure-${Date.now()}-${process.pid}`
  const runtimeRef = `tmp/l2-order-book-service/runtime/${token}`
  const outputRef = `tmp/l2-order-book-service/${token}/output`
  const runtimeDirectory = resolve(root, runtimeRef)
  mkdirSync(runtimeDirectory, { recursive: true })
  const config = {
    symbol: "BTCUSDT",
    output_base: outputRef,
    listen: "127.0.0.1:59999",
    epoch_seconds: 5,
    duration_seconds: 0,
    queue_capacity: 1,
    segment_frames: 1,
    sync_every_frames: 1,
    stale_after_ms: 100,
    restart_limit: 1,
    market_data_db: `tmp/l2-order-book-service/${token}/market-data.db`,
    admission_interval_ms: 0,
    disk_check_interval_ms: 1_000,
    disk_soft_min_bytes: Number.MAX_SAFE_INTEGER,
    disk_hard_min_bytes: Number.MAX_SAFE_INTEGER,
    resource_check_interval_ms: 1_000,
  }
  const supervisor = Bun.spawn({
    cmd: [
      process.execPath,
      resolve(import.meta.dir, "runtime-supervisor.ts"),
      "--runtime-dir", runtimeRef,
      "--service-binary", "/usr/bin/false",
      "--config", JSON.stringify(config),
    ],
    cwd: root,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })
  try {
    const statePath = resolve(runtimeDirectory, "runtime-state.json")
    await waitForFile(statePath, 3_000)
    const state = JSON.parse(readFileSync(statePath, "utf8")) as Record<string, unknown>
    assert.equal(state.status, "backoff")
    assert.equal(state.disk_status, "hard_limit")
    assert.equal(state.attempt, 0)
    assert.equal(supervisor.exitCode, null)

    supervisor.kill("SIGTERM")
    assert.equal(await supervisor.exited, 0)
    const terminal = JSON.parse(readFileSync(resolve(runtimeDirectory, "terminal-state.json"), "utf8")) as Record<string, unknown>
    assert.equal(terminal.status, "completed")
    assert.equal(terminal.reason, "SIGTERM")
    assert.equal(terminal.attempts, 0)
  } finally {
    if (supervisor.exitCode == null) {
      supervisor.kill("SIGKILL")
      await supervisor.exited
    }
    rmSync(runtimeDirectory, { recursive: true, force: true })
    rmSync(resolve(root, `tmp/l2-order-book-service/${token}`), { recursive: true, force: true })
  }
})

async function waitForFile(path: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!existsSync(path)) {
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${path}`)
    await Bun.sleep(25)
  }
}
