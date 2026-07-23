import assert from "node:assert/strict"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import test from "node:test"
import { indicatorProviderCommand, parseArgs } from "./foreground"

test("indicator demand worker arguments are fixed-path and bounded", () => {
  const defaults = parseArgs([])
  assert.equal(defaults.marketDataDb, "data/market_data.db")
  assert.equal(defaults.ohlcvDb, "data/ohlcv.db")
  assert.equal(defaults.maxJobsPerCycle, 2)
  assert.throws(() => parseArgs(["--ohlcv-db", "/tmp/other.db"]), /fixed/)
  assert.throws(() => parseArgs(["--provider-command", "arbitrary"]), /unknown/)
  assert.throws(() => parseArgs(["--max-bars", "50001"]), /between/)
})

test("indicator provider always receives the source catalog in source and compiled modes", () => {
  const root = join(process.cwd(), "tmp", `indicator-provider-command-${process.pid}`)
  const providerRoot = join(root, "modules/market-data-products/tech-indicators")
  const compiledPath = join(providerRoot, "target/release/tech-indicators")
  const expectedCatalog = join(providerRoot, "src/scripts/indicator_catalog.json")
  rmSync(root, { recursive: true, force: true })
  mkdirSync(providerRoot, { recursive: true })
  try {
    const source = indicatorProviderCommand(root, "/data/slice/manifest.json", ["--feature-series"])
    assert.deepEqual(source.command, [
      "go", "run", "./src/scripts",
      "--manifest", "/data/slice/manifest.json",
      "--catalog", expectedCatalog,
      "--feature-series",
    ])
    mkdirSync(join(providerRoot, "target/release"), { recursive: true })
    writeFileSync(compiledPath, "")
    const compiled = indicatorProviderCommand(root, "/data/slice/manifest.json", ["--indicators", "rsi"])
    assert.deepEqual(compiled.command, [
      compiledPath,
      "--manifest", "/data/slice/manifest.json",
      "--catalog", expectedCatalog,
      "--indicators", "rsi",
    ])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
