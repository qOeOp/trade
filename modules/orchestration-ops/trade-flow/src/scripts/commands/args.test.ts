import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import assert from "node:assert/strict"
import test from "node:test"
import { parseArgs } from "./args"

test("parseArgs keeps core runtime and execution flags stable", () => {
  const config = parseArgs([
    "--db",
    "/tmp/trade.db",
    "--append-review",
    "--run-live-small",
    "--yes",
    "--track",
    "slow",
    "--chain-id",
    "flow-1",
    "--mode",
    "shadow",
    "--automation-cycle",
    "--run-job-graph",
    "--trading-config",
    "profile/trading-config.json",
    "--json",
    JSON.stringify({ symbol: "BTCUSDT" }),
  ])

  assert.equal(config.dbPath, "/tmp/trade.db")
  assert.equal(config.appendReview, true)
  assert.equal(config.runLiveSmall, true)
  assert.equal(config.yes, true)
  assert.equal(config.track, "slow")
  assert.equal(config.chainId, "flow-1")
  assert.equal(config.mode, "shadow")
  assert.equal(config.automationCycle, true)
  assert.equal(config.runJobGraph, true)
  assert.equal(config.tradingConfigPath, "profile/trading-config.json")
  assert.equal(config.strategiesDir, "./strategies")
  assert.deepEqual(config.input, { symbol: "BTCUSDT" })
})

test("parseArgs reads JSON input files", () => {
  const dir = mkdtempSync(join(tmpdir(), "trade-flow-args-"))
  try {
    const inputPath = join(dir, "input.json")
    writeFileSync(inputPath, JSON.stringify({ chain_id: "flow-file" }))
    const config = parseArgs(["--append-order-fill", "--input", inputPath])
    assert.equal(config.appendOrderFill, true)
    assert.deepEqual(config.input, { chain_id: "flow-file" })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("parseArgs rejects unknown flags and invalid enum values", () => {
  assert.throws(() => parseArgs(["--missing"]), /unknown flag/)
  assert.throws(() => parseArgs(["--mode", "live"]), /unsupported --mode/)
  assert.throws(() => parseArgs(["--track", "medium"]), /--track must be/)
  assert.throws(() => parseArgs(["--strategy-rnd-loop"]), /unknown flag/)
  assert.throws(() => parseArgs(["--catalog-scan"]), /unknown flag/)
  assert.throws(() => parseArgs(["--strategy-review"]), /unknown flag/)
  assert.throws(() => parseArgs(["--db"]), /--db requires a value/)
})
