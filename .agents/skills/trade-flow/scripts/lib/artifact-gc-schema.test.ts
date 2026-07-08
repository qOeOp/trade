import { readFileSync, mkdirSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import assert from "node:assert/strict"
import test from "node:test"
import { runArtifactGc } from "./artifact-hygiene"

type JSONRecord = Record<string, unknown>

test("artifact gc result schema matches stable outer result contract", () => {
  const schema = readSchema()
  assert.equal(schema.$id, "trade-flow.artifact-gc-result.v1")
  assert.deepEqual(asArray(schema.required), [
    "root",
    "retention_hours",
    "ephemeral_retention_hours",
    "mode",
    "candidates",
    "deleted",
    "kept",
  ])
  assert.deepEqual(asArray(asRecord(asRecord(schema.properties).mode).enum), ["dry-run", "delete"])
  assert.deepEqual(asArray(asRecord(asRecord(schema.$defs).artifact_file).required), ["path", "age_hours", "reason"])
  assert.equal(asRecord(schema).additionalProperties, false)

  const root = makeRoot()
  writeArtifact(root, "tmp/stale.json", "2026-01-01T00:00:00.000Z")
  const result = runArtifactGc({
    root,
    now: "2026-01-08T01:00:00.000Z",
    retentionHours: 24,
    ephemeralRetentionHours: 12,
  }) as unknown as JSONRecord

  for (const field of asArray(schema.required)) {
    assert.ok(String(field) in result, `missing required field ${String(field)}`)
  }
  assert.equal(result.root, root)
  assert.equal(result.retention_hours, 24)
  assert.equal(result.ephemeral_retention_hours, 12)
  assert.equal(result.mode, "dry-run")
  assert.equal(Array.isArray(result.candidates), true)
  assert.equal(Array.isArray(result.deleted), true)
  assert.equal(Array.isArray(result.kept), true)
  const firstCandidate = asRecord(asArray(result.candidates)[0])
  assert.equal(typeof firstCandidate.path, "string")
  assert.equal(typeof firstCandidate.age_hours, "number")
  assert.equal(typeof firstCandidate.reason, "string")
})

function readSchema(): JSONRecord {
  return JSON.parse(readFileSync(new URL("../../schemas/artifact-gc-result.schema.json", import.meta.url), "utf8")) as JSONRecord
}

function makeRoot(): string {
  return join(tmpdir(), `artifact-gc-schema-${crypto.randomUUID()}`)
}

function writeArtifact(root: string, relativePath: string, mtimeIso: string): string {
  const path = join(root, relativePath)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, "{}")
  const date = new Date(mtimeIso)
  utimesSync(path, date, date)
  return path
}

function asRecord(value: unknown): JSONRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JSONRecord : {}
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}
