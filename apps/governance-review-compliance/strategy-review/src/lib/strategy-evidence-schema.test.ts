import { readFileSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import assert from "node:assert/strict"
import test from "node:test"
import { appendStrategyEvidence, EVIDENCE_KINDS } from "./strategy-iteration"

type JSONRecord = Record<string, unknown>

test("strategy evidence record schema matches stable ledger record contract", () => {
  const schema = readSchema()
  assert.equal(schema.$id, "strategy-review.strategy-evidence-record.v1")
  assert.deepEqual(asArray(schema.required), [
    "evidence_id",
    "created_at",
    "strategy_id",
    "setup_id",
    "kind",
    "policy_hash",
    "source_ref",
    "stats",
  ])
  assert.deepEqual(asArray(asRecord(asRecord(schema.properties).kind).enum), [...EVIDENCE_KINDS])
  assert.deepEqual(asArray(asRecord(asRecord(schema.$defs).evidence_stats).required), ["sample_count", "avg_r", "total_r"])
  assert.equal(asRecord(schema).additionalProperties, false)

  const dir = mkdtempSync(join(tmpdir(), "strategy-evidence-schema-"))
  const strategyPath = join(dir, "s-schema.md")
  const ledgerPath = join(dir, "strategy-evidence.jsonl")
  writeFileSync(strategyPath, "---\nstrategy_id: S-SCHEMA\nname: Schema Strategy\nstatus: draft\ntags: [schema]\n---\n\n# Schema Strategy\n")

  const record = appendStrategyEvidence({
    strategyPath,
    ledgerPath,
    kind: "shadow",
    sourceRef: "shadow-run-1",
    now: "2026-07-08T12:00:00Z",
    stats: {
      sample_count: 20,
      win_rate: 0.55,
      avg_r: 0.1,
      total_r: 2,
      profit_factor: 1.2,
    },
  }) as unknown as JSONRecord

  for (const field of asArray(schema.required)) {
    assert.ok(String(field) in record, `missing required field ${String(field)}`)
  }
  assert.equal(record.strategy_id, "S-SCHEMA")
  assert.equal(record.setup_id, "default")
  assert.equal(record.kind, "shadow")
  assert.equal(record.source_ref, "shadow-run-1")
  assert.equal(asRecord(record.stats).sample_count, 20)
  assert.equal(asRecord(record.stats).avg_r, 0.1)
  assert.equal(asRecord(record.stats).total_r, 2)
})

function readSchema(): JSONRecord {
  return JSON.parse(readFileSync(new URL("../schemas/strategy-evidence-record.schema.json", import.meta.url), "utf8")) as JSONRecord
}

function asRecord(value: unknown): JSONRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JSONRecord : {}
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}
