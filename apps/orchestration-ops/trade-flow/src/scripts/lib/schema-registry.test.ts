import { readdirSync, readFileSync } from "node:fs"
import assert from "node:assert/strict"
import test from "node:test"

type JSONRecord = Record<string, unknown>

const EXPECTED_COMMAND_DATA = [
  "--init",
  "--track",
  "--automation-cycle",
  "--run-program-shadow",
  "--run-program-shadow-supervisor",
  "--append-order-fill",
  "--append-review",
  "--record-execution",
  "--run",
  "--load-runtime",
  "--build-observe",
  "--observe-from-tools",
  "--run-shadow-from-tools",
  "--run-live-small",
  "--recover-flow",
  "--reconcile-flow",
  "--reconcile-from-tools",
  "--apply-reconcile",
  "--cron-recover-from-tools",
]

test("schema registry covers schema files and command data outputs", () => {
  const registry = readRegistry()
  assert.equal(registry.schema_version, "trade-flow.schema-registry.v1")

  const schemaFiles = readdirSync(new URL("../../schemas", import.meta.url))
    .filter((name) => name.endsWith(".schema.json"))
    .sort()
  const schemas = asArray(registry.schemas).map(asRecord)
  const registeredFiles = schemas.map((item) => String(item.file)).sort()
  assert.deepEqual(registeredFiles, schemaFiles)

  for (const item of schemas) {
    const file = stringField(item.file)
    const id = stringField(item.id)
    assert.ok(file, "schema registry file is required")
    assert.ok(id, `schema id is required for ${file}`)
    assert.ok(stringField(item.owner), `schema owner is required for ${file}`)
    assert.ok(asArray(item.covers).length > 0, `schema covers is required for ${file}`)
    const schema = readSchemaFile(file)
    assert.equal(schema.$id, id, `${file} registry id must match schema $id`)
  }

  const availableFiles = new Set(schemaFiles)
  const commandData = asArray(registry.command_data).map(asRecord)
  assert.deepEqual(commandData.map((item) => stringField(item.command)).sort(), [...EXPECTED_COMMAND_DATA].sort())
  assert.deepEqual(commandData.filter((item) => item.status === "deferred").map((item) => item.command), [])
  for (const item of commandData) {
    const command = stringField(item.command)
    const status = stringField(item.status)
    assert.ok(command.startsWith("--"), `invalid command entry ${command}`)
    assert.ok(status === "covered" || status === "deferred", `${command} must be covered or deferred`)
    const schemasForCommand = asArray(item.schemas).map(String)
    assert.ok(schemasForCommand.includes("script-response.schema.json"), `${command} must include the response envelope`)
    for (const file of schemasForCommand) {
      assert.ok(availableFiles.has(file), `${command} references missing schema ${file}`)
    }
    if (status === "covered") {
      assert.ok(schemasForCommand.length > 1, `${command} needs a data schema beyond script-response`)
    } else {
      assert.ok(stringField(item.reason), `${command} deferred entry needs a reason`)
    }
  }

  for (const artifact of asArray(registry.jsonl_artifacts).map(asRecord)) {
    assert.ok(availableFiles.has(stringField(artifact.schema)), `jsonl artifact references missing schema ${artifact.schema}`)
  }
})

function readRegistry(): JSONRecord {
  return JSON.parse(readFileSync(new URL("../../schemas/registry.json", import.meta.url), "utf8")) as JSONRecord
}

function readSchemaFile(file: string): JSONRecord {
  return JSON.parse(readFileSync(new URL(`../../schemas/${file}`, import.meta.url), "utf8")) as JSONRecord
}

function asRecord(value: unknown): JSONRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JSONRecord : {}
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}
