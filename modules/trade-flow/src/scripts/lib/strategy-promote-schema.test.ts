import { readFileSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import assert from "node:assert/strict"
import test from "node:test"
import { promoteStrategy, PROMOTE_RESULT_STATUSES, STRATEGY_STATUSES } from "./strategy-iteration"

type JSONRecord = Record<string, unknown>

test("strategy promote result schema matches stable promotion result model", () => {
  const schema = readSchema()
  assert.equal(schema.$id, "trade-flow.strategy-promote-result.v1")
  assert.deepEqual(asArray(schema.required), ["status", "from_status", "to_status", "report"])
  assert.deepEqual(asArray(asRecord(asRecord(schema.properties).status).enum), [...PROMOTE_RESULT_STATUSES])
  assert.deepEqual(asArray(asRecord(asRecord(schema.properties).to_status).enum), [...STRATEGY_STATUSES])
  assert.equal(asRecord(asRecord(schema.properties).report).$ref, "strategy-review-report.schema.json")
  assert.equal(asRecord(schema).additionalProperties, false)

  const dir = mkdtempSync(join(tmpdir(), "strategy-promote-schema-"))
  const strategyPath = join(dir, "s-promote.md")
  const ledgerPath = join(dir, "strategy-evidence.jsonl")
  writeFileSync(strategyPath, "---\nstrategy_id: S-PROMOTE\nname: Promote Strategy\nstatus: draft\ntags: [schema]\n---\n\n# Promote Strategy\n")

  const result = promoteStrategy({ strategyPath, ledgerPath, toStatus: "draft" }) as unknown as JSONRecord
  for (const field of asArray(schema.required)) {
    assert.ok(String(field) in result, `missing required field ${String(field)}`)
  }
  assert.equal(result.status, "dry-run")
  assert.equal(result.from_status, "draft")
  assert.equal(result.to_status, "draft")
  assert.equal(typeof result.report, "object")
  assert.equal("updated_path" in result, false)
})

function readSchema(): JSONRecord {
  return JSON.parse(readFileSync(new URL("../../schemas/strategy-promote-result.schema.json", import.meta.url), "utf8")) as JSONRecord
}

function asRecord(value: unknown): JSONRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JSONRecord : {}
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}
