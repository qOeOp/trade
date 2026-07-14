import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import assert from "node:assert/strict"
import test from "node:test"
import { candidateFromStrategyContract, compileStrategyContract, lintStrategyContract, parseYamlSubset } from "../../../../../../contracts/strategy-contract/src/strategy-contract"

test("parseYamlSubset reads nested maps and lists", () => {
  assert.deepEqual(parseYamlSubset([
    "setup_id: s-one",
    "engine: rnd_family_v1",
    "candidate:",
    "  side: short",
    "  lookback_bars: 120",
    "refs:",
    "  - a.json",
    "  - b.json",
  ].join("\n")), {
    setup_id: "s-one",
    engine: "rnd_family_v1",
    candidate: {
      side: "short",
      lookback_bars: 120,
    },
    refs: ["a.json", "b.json"],
  })
})

test("compileStrategyContract maps rnd family contract to candidate params", () => {
  const dir = mkdtempSync(join(tmpdir(), "trade-flow-strategy-contract-"))
  try {
    const path = join(dir, "s-test.md")
    writeFileSync(path, strategyMarkdown("rnd_family_v1", `
setup_id: alt-relative-short
engine: rnd_family_v1
hypothesis: relative winner short
timeframe: 4h
family: relative_weakness_momentum_v1
candidate:
  side: short
  signal_mode: reversion
  benchmark_timeframe: 4h
  lookback_bars: 120
  relative_threshold_atr: 1
risk:
  stop_atr: 1
  max_risk_atr: 2.5
  reward_risk: 2
  max_hold_bars: 12
cost_model:
  fee_bps: 2
  slippage_bps: 1
  adverse_funding_bps_per_8h: 1
universe:
  include: liquid alts
execution:
  entry_rule: closed candle only
proof:
  live_permission: draft_only
`))

    const compiled = compileStrategyContract(path, { benchmark_manifest_path: "tmp/panels/btc/manifest.json" })
    assert.equal(compiled.strategy_id, "S-TEST")
    assert.equal(compiled.engine, "rnd_family_v1")
    assert.equal(compiled.setup_id, "alt-relative-short")
    assert.equal(compiled.candidate?.family, "relative_weakness_momentum_v1")
    assert.deepEqual(compiled.candidate?.params, {
      side: "short",
      signal_mode: "reversion",
      benchmark_timeframe: "4h",
      lookback_bars: 120,
      relative_threshold_atr: 1,
      stop_atr: 1,
      max_risk_atr: 2.5,
      reward_risk: 2,
      benchmark_manifest_path: "tmp/panels/btc/manifest.json",
    })
    assert.equal(compiled.replay_defaults.max_hold_bars, 12)
    assert.equal(compiled.replay_defaults.fee_bps, 2)
    assert.equal(compiled.lifecycle.source, "generated_rnd_family_v1")
    assert.equal(compiled.lifecycle.promotion_eligible, true)
    assert.match(String(compiled.lifecycle.signal_rule), /relative_weakness_momentum_v1/)
    assert.match(compiled.contract_hash, /^[0-9a-f]{64}$/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("lintStrategyContract rejects manual policies without lifecycle", () => {
  const dir = mkdtempSync(join(tmpdir(), "trade-flow-strategy-lint-"))
  try {
    const manualPath = join(dir, "s-manual.md")
    writeFileSync(manualPath, strategyMarkdown("manual_policy_v1", `
setup_id: btc-manual
engine: manual_policy_v1
hypothesis: manual policy
timeframe: 4h
risk:
  reward_risk: 2
cost_model:
  fee_bps: 2
universe:
  include: [BTCUSDT]
execution:
  entry_rule: discretionary pullback
proof:
  live_permission: draft_only
`))
    const manual = lintStrategyContract(manualPath)
    assert.equal(manual.valid, false)
    assert.equal(manual.contract, undefined)
    assert.match(manual.errors.join("\n"), /contract.lifecycle is required/)

    const brokenPath = join(dir, "s-broken.md")
    writeFileSync(brokenPath, "---\nstrategy_id: S-BROKEN\nname: Broken\nstatus: draft\n---\n\n# Broken\n")
    const broken = lintStrategyContract(brokenPath)
    assert.equal(broken.valid, false)
    assert.match(broken.errors.join("\n"), /Trade Contract/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("lintStrategyContract validates declared lifecycle completeness", () => {
  const dir = mkdtempSync(join(tmpdir(), "trade-flow-strategy-lifecycle-"))
  try {
    const path = join(dir, "s-lifecycle.md")
    writeFileSync(path, strategyMarkdown("manual_policy_v1", `
setup_id: btc-manual
engine: manual_policy_v1
hypothesis: declared lifecycle
timeframe: 4h
lifecycle:
  signal_rule: closed candle setup
  entry_builder: semantic entry_at
  protection_builder: stop and target ladder
  position_update_rule: update after fills
  exit_rule: protective or invalidation
  review_attribution: setup id and r multiple
proof:
  live_permission: draft_only
`))
    const lint = lintStrategyContract(path)
    assert.equal(lint.valid, true)
    assert.equal(lint.contract?.lifecycle.source, "declared_lifecycle_v1")
    assert.equal(lint.contract?.lifecycle.promotion_eligible, true)

    const brokenPath = join(dir, "s-lifecycle-broken.md")
    writeFileSync(brokenPath, strategyMarkdown("manual_policy_v1", `
setup_id: btc-manual
engine: manual_policy_v1
hypothesis: broken lifecycle
timeframe: 4h
lifecycle:
  signal_rule: closed candle setup
proof:
  live_permission: draft_only
`))
    const broken = lintStrategyContract(brokenPath)
    assert.equal(broken.valid, false)
    assert.match(broken.errors.join("\n"), /contract.lifecycle.entry_builder/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("candidateFromStrategyContract rejects manual policies", () => {
  const dir = mkdtempSync(join(tmpdir(), "trade-flow-manual-candidate-"))
  try {
    const path = join(dir, "s-manual.md")
    writeFileSync(path, strategyMarkdown("manual_policy_v1", `
setup_id: btc-manual
engine: manual_policy_v1
hypothesis: manual policy
timeframe: 4h
lifecycle:
  signal_rule: closed candle setup
  entry_builder: semantic entry_at
  protection_builder: stop and target ladder
  position_update_rule: update after fills
  exit_rule: protective or invalidation
  review_attribution: setup id and r multiple
proof:
  live_permission: draft_only
`))
    assert.throws(() => candidateFromStrategyContract(path), /requires a rnd_family_v1/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

function strategyMarkdown(_engine: string, contract: string): string {
  return `---
strategy_id: S-TEST
contract_schema_version: 1
name: Test Strategy
status: draft
tags: [test]
---

# Test Strategy

## Trade Contract

\`\`\`yaml
${contract.trim()}
\`\`\`
`
}
