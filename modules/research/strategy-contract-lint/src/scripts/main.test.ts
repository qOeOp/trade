import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { run } from "./main"

type JSONRecord = Record<string, unknown>

test("strategy contract lint requires strategy path", () => {
  const result = run([])
  assert.equal(result.ok, false)
  assert.match(String(result.error), /requires --strategy/)
})

test("strategy contract lint emits lint result", () => {
  const dir = mkdtempSync(join(tmpdir(), "strategy-contract-lint-"))
  try {
    const path = join(dir, "s-test.md")
    writeFileSync(path, strategyMarkdown())

    const result = run(["--strategy", path])

    assert.equal(result.ok, true)
    assert.equal(result.schema_version, "strategy-contract-lint.script-response.v1")
    const data = asRecord(result.data)
    assert.equal(data.strategy_id, "S-TEST")
    assert.equal(data.valid, true)
    const contract = asRecord(data.contract)
    assert.equal(contract.engine, "manual_policy_v1")
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
\`\`\`
`
}

function asRecord(value: unknown): JSONRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JSONRecord : {}
}
