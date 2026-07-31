import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import assert from "node:assert/strict"
import test from "node:test"

import { loadStrategies, loadStrategyFile, parseSimpleYaml } from "./strategy-policy"

test("parseSimpleYaml handles scalar and array values", () => {
  assert.deepEqual(parseSimpleYaml("strategy_id: S-1\nstatus: live-small\ntags: [trend, swing]"), {
    strategy_id: "S-1",
    status: "live-small",
    tags: ["trend", "swing"],
  })
})

test("loadStrategyFile reads frontmatter and body", () => {
  const dir = mkdtempSync(join(tmpdir(), "strategy-loader-"))
  const path = join(dir, "s-test.md")
  try {
    writeFileSync(path, "---\nstrategy_id: S-TEST\nname: Test Strategy\nstatus: shadow\ntags: [trend, usdm]\n---\n\n# Body\n")
    const strategy = loadStrategyFile(path)

    assert.equal(strategy.strategy_id, "S-TEST")
    assert.equal(strategy.status, "shadow")
    assert.deepEqual(strategy.tags, ["trend", "usdm"])
    assert.match(strategy.body, /# Body/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("loadStrategies reads markdown strategies from directory", () => {
  const dir = mkdtempSync(join(tmpdir(), "strategies-"))
  try {
    writeFileSync(join(dir, "s-one.md"), "---\nstrategy_id: S-ONE\n---\none")
    writeFileSync(join(dir, "ignore.txt"), "nope")

    const strategies = loadStrategies(dir)

    assert.equal(strategies.length, 1)
    assert.equal(strategies[0].strategy_id, "S-ONE")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("loadStrategies does not fall back outside the requested project strategies directory", () => {
  const dir = mkdtempSync(join(tmpdir(), "strategies-fallback-"))
  try {
    const toolDir = join(dir, "apps/orchestration-ops/trade-flow/strategies")
    mkdirSync(toolDir, { recursive: true })
    writeFileSync(join(toolDir, "s-tool.md"), "---\nstrategy_id: S-TOOL\n---\ntool")

    const strategies = loadStrategies(join(dir, "strategies"))

    assert.equal(strategies.length, 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
