import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const workbenchDir = fileURLToPath(new URL("../../..", import.meta.url))
const operationPath = "f/trade/product_edge/develop_composer_v2"
const read = (relativePath) => readFile(new URL(relativePath, `file://${workbenchDir}/`), "utf8")

test("sealed deployment payload accepts actual helper metadata without a worker tag", async () => {
  const runner = await readFile(new URL("../../../../../scripts/ci/test-source-research-composer-sealed-acceptance.bash", import.meta.url), "utf8")
  const program = runner.match(/import json\nimport os\nimport sys\nsource, lock, metadata, output, path = sys.argv\[1:\][\s\S]*?(?=\nPY\n)/)?.[0]
  assert.ok(program, "execute the real deployment payload program")
  const directory = await mkdtemp(join(tmpdir(), "composer-script-payload-"))
  try {
    for (const name of ["consumer_projection_v1", "source_intake_v1", "source_intake_research_v1", "develop_composer_v2"]) {
      const path = `f/trade/product_edge/${name}`
      const source = join(workbenchDir, `${path}.ts`)
      const lock = join(workbenchDir, `${path}.script.lock`)
      const metadata = JSON.parse(execFileSync("yq", ["-o=json", join(workbenchDir, `${path}.script.yaml`)], { encoding: "utf8" }))
      const metadataPath = join(directory, `${name}.json`)
      const output = join(directory, `${name}.payload.json`)
      await writeFile(metadataPath, JSON.stringify(metadata))
      execFileSync("python3", ["-c", program, source, lock, metadataPath, output, path])
      const payload = JSON.parse(await readFile(output, "utf8"))
      assert.equal(payload.path, path)
      assert.equal(payload.content, await readFile(source, "utf8"))
      assert.equal(payload.lock, await readFile(lock, "utf8"))
      assert.deepEqual(payload.schema, metadata.schema)
      assert.equal(Object.hasOwn(payload, "tag"), Object.hasOwn(metadata, "tag"))
      assert.equal(payload.tag, metadata.tag)
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("deployed readback permits only Windmill empty-lock omission, never nonempty-lock drift", async () => {
  const runner = await readFile(new URL("../../../../../scripts/ci/test-source-research-composer-sealed-acceptance.bash", import.meta.url), "utf8")
  const program = runner.match(/import json\nimport sys\nsource_path, lock_path, create_path, readback_path, expected_path = sys.argv\[1:\][\s\S]*?(?=\nPY\n)/)?.[0]
  assert.ok(program)
  const directory = await mkdtemp(join(tmpdir(), "composer-script-readback-"))
  try {
    const path = "f/trade/product_edge/consumer_projection_v1"
    const source = join(workbenchDir, `${path}.ts`)
    const lock = join(directory, "lock")
    const created = join(directory, "created.json")
    const observed = join(directory, "readback.json")
    const body = { path, language: "bun", content: await readFile(source, "utf8"), hash: "abc123" }
    await writeFile(created, JSON.stringify("abc123"))
    for (const [expectedLock, actualLock, accepted] of [
      ["", undefined, true], ["", null, true], ["", "", true],
      ["locked", "locked", true], ["locked", undefined, false],
      ["locked", null, false], ["locked", "other", false], ["", "unexpected", false],
    ]) {
      await writeFile(lock, expectedLock)
      await writeFile(observed, JSON.stringify({ ...body, lock: actualLock }))
      const result = spawnSync("python3", ["-c", program, source, lock, created, observed, path], { encoding: "utf8" })
      assert.equal(result.status, accepted ? 0 : 1, result.stderr)
    }
    await writeFile(lock, "")
    for (const changed of [{ content: "different" }, { path: "other" }, { language: "python3" }, { hash: "different" }]) {
      await writeFile(observed, JSON.stringify({ ...body, ...changed }))
      const result = spawnSync("python3", ["-c", program, source, lock, created, observed, path], { encoding: "utf8" })
      assert.equal(result.status, 1, "empty lock cannot excuse another identity mismatch")
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("Develop Composer Agent entry is one bounded typed MCP operation", async () => {
  const [source, metadata, lock, profileText, readme] = await Promise.all([
    readFile(new URL("./develop_composer_v2.ts", import.meta.url), "utf8"),
    readFile(new URL("./develop_composer_v2.script.yaml", import.meta.url), "utf8"),
    readFile(new URL("./develop_composer_v2.script.lock", import.meta.url), "utf8"),
    read("mcp-profile.json"),
    read("README.md"),
  ])

  const profile = JSON.parse(profileText)
  assert.equal(profile.scopes.filter((scope) => scope === `mcp:scripts:${operationPath}`).length, 1)
  assert.equal(profile.scopes.at(-1), "mcp:endpoints:getJob,getJobLogs")
  assert.equal(profile.scopes.some((scope) => scope === "mcp:all" || scope.includes("*")), false)
  assert.match(metadata, new RegExp(`^lock: "!inline ${operationPath}\\.script\\.lock"$`, "m"))
  assert.match(metadata, /^kind: script$/m)
  assert.match(metadata, /^  additionalProperties: false$/m)
  assert.match(metadata, /^      enum:\n        - RUN\n        - RESOLVE$/m)
  assert.match(metadata, /^  order:\n    - action\n    - research_request_locator$/m)
  assert.match(source, /type Action = "RUN" \| "RESOLVE"/)
  assert.match(source, /\/v2\/develop-composer\/runs/)
  assert.match(source, /requestProjection\(token, research_request_locator\)/)
  assert.doesNotMatch(source, /console\.|DATABASE_URL|DATABENTO|DEEPSEEK|FIRECRAWL|SILICONFLOW/)
  assert.match(readme, /Develop Composer V2 Agent entry/)
  assert.match(lock, /^\{\n  "dependencies": \{\}\n\}\n\/\/bun\.lock\n<empty>\n$/)
})

test("metadata and TypeScript expose only the Owner-derived Research locator for RUN and RESOLVE", async () => {
  const [source, metadata] = await Promise.all([
    readFile(new URL("./develop_composer_v2.ts", import.meta.url), "utf8"),
    readFile(new URL("./develop_composer_v2.script.yaml", import.meta.url), "utf8"),
  ])
  assert.match(source, /export async function main\(\n  action: Action,\n  research_request_locator: string,\n\)/)
  assert.match(metadata, /^  required:\n    - action\n    - research_request_locator$/m)
  assert.match(metadata, /research_request_locator:\n      type: string\n      minLength: 1\n      maxLength: 256/)
  assert.match(source, /JSON\.stringify\(\{ research_request_locator \}\)/)
  for (const field of ["design", "binding_requests", "plugin_source_capsules"]) {
    assert.doesNotMatch(metadata, new RegExp(`^    ${field}:`, "m"))
  }
})
