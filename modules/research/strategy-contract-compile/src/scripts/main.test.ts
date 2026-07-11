import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { run } from "./main"

type JSONRecord = Record<string, unknown>

test("strategy contract compile requires strategy path", () => {
  const result = run([])
  assert.equal(result.ok, false)
  assert.match(String(result.error), /requires --strategy/)
})

test("strategy contract compile emits compiled contract", () => {
  const dir = mkdtempSync(join(tmpdir(), "strategy-contract-compile-"))
  try {
    const path = join(dir, "s-test.md")
    writeFileSync(path, strategyMarkdown())

    const result = run([
      "--strategy",
      path,
      "--json",
      JSON.stringify({ candidate_param_overrides: { benchmark_manifest_path: "tmp/panels/btc/manifest.json" } }),
    ])

    assert.equal(result.ok, true)
    assert.equal(result.schema_version, "strategy-contract-compile.script-response.v1")
    const data = asRecord(result.data)
    assert.equal(data.strategy_id, "S-TEST")
    assert.equal(data.engine, "rnd_family_v1")
    const candidate = asRecord(data.candidate)
    assert.equal(candidate.family, "relative_weakness_momentum_v1")
    const params = asRecord(candidate.params)
    assert.equal(params.benchmark_manifest_path, "tmp/panels/btc/manifest.json")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

function strategyMarkdown(): string {
  return `---
strategy_id: S-TEST
contract_schema_version: 1
name: Test Strategy
status: draft
---

# Test Strategy

## Trade Contract

\`\`\`yaml
setup_id: alt-relative-short
engine: rnd_family_v1
hypothesis: relative winner short
timeframe: 4h
family: relative_weakness_momentum_v1
candidate:
  side: short
  signal_mode: reversion
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
proof:
  live_permission: draft_only
\`\`\`
`
}

function asRecord(value: unknown): JSONRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JSONRecord : {}
}
