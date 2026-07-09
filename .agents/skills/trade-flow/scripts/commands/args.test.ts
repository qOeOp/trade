import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import assert from "node:assert/strict"
import test from "node:test"
import { parseArgs } from "./args"

test("parseArgs keeps core execution and evidence flags stable", () => {
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
    "--strategy-promote",
    "--trading-config",
    "profile/trading-config.json",
    "--strategy-cycle",
    "--strategy",
    "strategy.md",
    "--ledger",
    "ledger.jsonl",
    "--to",
    "live-small",
    "--artifact-root",
    "/tmp/artifacts",
    "--catalog-init",
    "--catalog-scan",
    "--catalog-query",
    "--catalog-stale",
    "--catalog-gc",
    "--catalog-db",
    "/tmp/data_catalog.db",
    "--catalog-root",
    "/tmp/data",
    "--catalog-root",
    "/tmp/tmp",
    "--retention-hours",
    "168",
    "--ephemeral-retention-hours",
    "12",
    "--anti-overfit-stage",
    "locked_holdout",
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
  assert.equal(config.strategyPromote, true)
  assert.equal(config.tradingConfigPath, "profile/trading-config.json")
  assert.equal(config.strategyCycle, true)
  assert.equal(config.strategyPath, "strategy.md")
  assert.equal(config.ledgerPath, "ledger.jsonl")
  assert.equal(config.promoteTo, "live-small")
  assert.equal(config.promoteToExplicit, true)
  assert.equal(config.artifactRoot, "/tmp/artifacts")
  assert.equal(config.catalogInit, true)
  assert.equal(config.catalogScan, true)
  assert.equal(config.catalogQuery, true)
  assert.equal(config.catalogStale, true)
  assert.equal(config.catalogGc, true)
  assert.equal(config.catalogDbPath, "/tmp/data_catalog.db")
  assert.deepEqual(config.catalogRoots, ["/tmp/data", "/tmp/tmp"])
  assert.equal(config.retentionHours, 168)
  assert.equal(config.ephemeralRetentionHours, 12)
  assert.equal(config.antiOverfitStage, "locked_holdout")
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
  assert.throws(() => parseArgs(["--to", "production"]), /--to must be/)
  assert.throws(() => parseArgs(["--anti-overfit-stage", "peek"]), /--anti-overfit-stage must be/)
  assert.throws(() => parseArgs(["--db"]), /--db requires a value/)
})
