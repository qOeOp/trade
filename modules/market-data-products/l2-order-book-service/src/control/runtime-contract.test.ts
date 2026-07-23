import assert from "node:assert/strict"
import test from "node:test"
import {
  assertMarketDataDbRef,
  assertOutputRef,
  assertRuntimeRef,
  parseLaunchConfigArgs,
  parseProcessResourceSample,
  processMatchesL2Service,
  processMatchesL2Supervisor,
  validateLaunchConfig,
  type LaunchConfig,
  type LaunchReceipt,
} from "./runtime-contract"

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
  restart_limit: 0,
  market_data_db: "data/market_data.db",
  admission_interval_ms: 30_000,
  disk_check_interval_ms: 5_000,
  disk_soft_min_bytes: 10 * 1024 ** 3,
  disk_hard_min_bytes: 5 * 1024 ** 3,
  resource_check_interval_ms: 30_000,
}

test("L2 control contract accepts indefinite supervised local service", () => {
  assert.doesNotThrow(() => validateLaunchConfig(config))
  assert.equal(assertOutputRef("/repo", "data/l2"), "/repo/data/l2")
  assert.equal(assertRuntimeRef("/repo", "tmp/l2-order-book-service/runtime/x"), "/repo/tmp/l2-order-book-service/runtime/x")
  assert.equal(assertMarketDataDbRef("/repo", "data/market_data.db"), "/repo/data/market_data.db")
})

test("L2 control contract rejects public listener and escaped paths", () => {
  assert.throws(() => validateLaunchConfig({ ...config, listen: "0.0.0.0:50061" }), /loopback/)
  assert.throws(() => assertOutputRef("/repo", "data/other"), /L2 output/)
  assert.throws(() => assertRuntimeRef("/repo", "../runtime"), /control files/)
  assert.throws(() => assertMarketDataDbRef("/repo", "outside.db"), /market data DB/)
  assert.throws(() => validateLaunchConfig({ ...config, disk_soft_min_bytes: 1, disk_hard_min_bytes: 2 }), /disk_soft_min_bytes/)
})

test("L2 control contract parses bounded child resource samples", () => {
  assert.deepEqual(parseProcessResourceSample(" 16704  2.5\n"), { rss_bytes: 17_104_896, cpu_percent: 2.5 })
  assert.throws(() => parseProcessResourceSample("unknown 2.5"), /invalid RSS\/CPU/)
})

test("L2 launch arguments are closed-world and integer exact", () => {
  assert.equal(parseLaunchConfigArgs(["--symbol", "ETHUSDT", "--restart-limit", "8"]).symbol, "ETHUSDT")
  assert.equal(parseLaunchConfigArgs(["--symbol", "ETHUSDT", "--restart-limit", "8"]).restart_limit, 8)
  assert.throws(() => parseLaunchConfigArgs(["--unknown", "value"]), /unknown argument/)
  assert.throws(() => parseLaunchConfigArgs(["--symbol", "BTCUSDT", "--symbol", "ETHUSDT"]), /duplicate argument/)
  assert.throws(() => parseLaunchConfigArgs(["--restart-limit", "1.5"]), /invalid integer/)
})

test("L2 process identity requires the exact role and receipt arguments, not only a live PID", async () => {
  const runtimeDirectory = "tmp/l2-order-book-service/runtime/identity-test"
  const receipt: LaunchReceipt = {
    schema_version: "trade.l2-service-launch-receipt.v1",
    launched_at: "2026-07-23T00:00:00.000Z",
    supervisor_pid: 2,
    runtime_directory: runtimeDirectory,
    runtime_state_path: `${runtimeDirectory}/runtime-state.json`,
    terminal_state_path: `${runtimeDirectory}/terminal-state.json`,
    log_path: `${runtimeDirectory}/supervisor.log`,
    service_binary: "modules/market-data-products/l2-order-book-service/target/release/l2-order-book-service",
    query_binary: "modules/market-data-products/l2-order-book-service/target/release/l2-order-book-query",
    config,
  }
  const supervisor = Bun.spawn({
    cmd: [
      process.execPath, "-e", "await Bun.sleep(10000)",
      "l2-order-book-service/src/scripts/runtime-supervisor.ts",
      "--runtime-dir", runtimeDirectory,
    ],
    stdout: "ignore",
    stderr: "ignore",
  })
  const service = Bun.spawn({
    cmd: [
      process.execPath, "-e", "await Bun.sleep(10000)",
      receipt.service_binary,
      "--yes-public-network",
      "--symbol", config.symbol,
      "--output-base", config.output_base,
      "--listen", config.listen,
    ],
    stdout: "ignore",
    stderr: "ignore",
  })
  try {
    await Bun.sleep(50)
    assert.equal(processMatchesL2Supervisor(supervisor.pid, runtimeDirectory), true)
    assert.equal(processMatchesL2Supervisor(supervisor.pid, `${runtimeDirectory}-other`), false)
    assert.equal(processMatchesL2Service(service.pid, receipt), true)
    assert.equal(processMatchesL2Service(service.pid, { ...receipt, config: { ...config, symbol: "ETHUSDT" } }), false)
    assert.equal(processMatchesL2Service(process.pid, receipt), false)
  } finally {
    supervisor.kill("SIGTERM")
    service.kill("SIGTERM")
    await Promise.all([supervisor.exited, service.exited])
  }
})
