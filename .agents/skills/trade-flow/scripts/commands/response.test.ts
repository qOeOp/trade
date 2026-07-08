import { readFileSync } from "node:fs"
import assert from "node:assert/strict"
import test from "node:test"
import { errorResponse, SCRIPT_RESPONSE_SCHEMA_VERSION, successResponse } from "./response"

type JSONRecord = Record<string, unknown>

const EXPECTED_ERROR_CODES = [
  "INVALID_ARGUMENT",
  "PRECONDITION_FAILED",
  "EXTERNAL_FAILURE",
  "INTERNAL_ERROR",
]

test("script response schema matches response builders", () => {
  const schema = readSchema()
  const branches = asArray(schema["oneOf"])
  assert.equal(schema.$id, SCRIPT_RESPONSE_SCHEMA_VERSION)
  assert.equal(branches.length, 2)
  assert.deepEqual(readFailureCodeEnum(schema), EXPECTED_ERROR_CODES)

  assertMatchesScriptResponseSchema(schema, successResponse({ command: "init" }))
  assertMatchesScriptResponseSchema(schema, errorResponse(new Error("requires --yes")))
})

function readSchema(): JSONRecord {
  return JSON.parse(readFileSync(new URL("../../schemas/script-response.schema.json", import.meta.url), "utf8")) as JSONRecord
}

function readFailureCodeEnum(schema: JSONRecord): unknown[] {
  const failure = readBranch(schema, false)
  return asArray(asRecord(asRecord(failure.properties).code).enum)
}

function assertMatchesScriptResponseSchema(schema: JSONRecord, value: JSONRecord): void {
  const branch = readBranch(schema, value.ok === true)
  for (const field of asArray(branch.required)) {
    assert.ok(String(field) in value, `missing required field ${String(field)}`)
  }
  const properties = asRecord(branch.properties)
  assert.equal(value.ok, asRecord(properties.ok).const)
  assert.equal(value.schema_version, asRecord(properties.schema_version).const)
  if (value.ok === false) {
    assert.equal(typeof value.error, "string")
    assert.equal(typeof value.retriable, "boolean")
    assert.ok(asArray(asRecord(properties.code).enum).includes(value.code))
  }
}

function readBranch(schema: JSONRecord, ok: boolean): JSONRecord {
  const branch = asArray(schema["oneOf"])
    .map(asRecord)
    .find((item) => asRecord(asRecord(item.properties).ok).const === ok)
  assert.ok(branch, `missing ${ok ? "success" : "failure"} schema branch`)
  return branch
}

function asRecord(value: unknown): JSONRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JSONRecord : {}
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}
