import { readFileSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import assert from "node:assert/strict"
import test from "node:test"
import { reviewStrategy } from "./strategy-iteration"

type JSONRecord = Record<string, unknown>

test("strategy review report schema matches stable promotion read model", () => {
  const schema = readSchema()
  assert.equal(schema.$id, "trade-flow.strategy-review-report.v1")
  assert.deepEqual(asArray(schema.required), [
    "strategy_id",
    "strategy_path",
    "status",
    "policy_hash",
    "evidence",
    "latest",
    "db_review_stats",
    "diagnostics",
    "gate",
  ])
  assert.deepEqual(asArray(asRecord(asRecord(schema.properties).evidence).required), ["fresh", "stale", "stale_reasons"])
  assert.deepEqual(asArray(asRecord(asRecord(schema.properties).latest).required), ["replay", "shadow", "live_small", "review_batch"])
  assert.deepEqual(asArray(asRecord(asRecord(schema.properties).gate).required), ["shadow_candidate", "live_small_candidate", "blocked_by"])
  assert.equal(asRecord(schema).additionalProperties, false)

  const dir = mkdtempSync(join(tmpdir(), "strategy-review-schema-"))
  const strategyPath = join(dir, "s-review.md")
  const ledgerPath = join(dir, "strategy-evidence.jsonl")
  writeFileSync(strategyPath, "---\nstrategy_id: S-REVIEW\nname: Review Strategy\nstatus: draft\ntags: [schema]\n---\n\n# Review Strategy\n")

  const report = reviewStrategy({ strategyPath, ledgerPath }) as unknown as JSONRecord
  for (const field of asArray(schema.required)) {
    assert.ok(String(field) in report, `missing required field ${String(field)}`)
  }
  assert.equal(report.strategy_id, "S-REVIEW")
  assert.equal(report.strategy_path, strategyPath)
  assert.equal(report.status, "draft")
  assert.equal(Array.isArray(asRecord(report.evidence).fresh), true)
  assert.equal(asRecord(report.latest).replay, null)
  assert.equal(typeof asRecord(report.gate).shadow_candidate, "boolean")
  assert.equal(typeof asRecord(report.gate).live_small_candidate, "boolean")
  assert.equal(Array.isArray(asRecord(report.gate).blocked_by), true)
})

function readSchema(): JSONRecord {
  return JSON.parse(readFileSync(new URL("../../schemas/strategy-review-report.schema.json", import.meta.url), "utf8")) as JSONRecord
}

function asRecord(value: unknown): JSONRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JSONRecord : {}
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}
