import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import { fileURLToPath } from "node:url"

const workbenchDir = fileURLToPath(new URL("../../..", import.meta.url))
const operationPath = "f/trade/product_edge/develop_composer_v2"
const read = (relativePath) => readFile(new URL(relativePath, `file://${workbenchDir}/`), "utf8")

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
  assert.match(metadata, /^  order:\n    - action\n    - request_identity\n    - request$/m)
  assert.match(metadata, /action: \{const: RESOLVE\}[\s\S]*request: \{type: "null"\}/)
  assert.match(source, /type Action = "RUN" \| "RESOLVE"/)
  assert.match(source, /\/v2\/develop-composer\/runs/)
  assert.match(source, /RESOLVE accepts only the same request identity/)
  assert.doesNotMatch(source, /console\.|DATABASE_URL|DATABENTO|DEEPSEEK|FIRECRAWL|SILICONFLOW/)
  assert.match(readme, /Develop Composer V2 Agent entry/)
  assert.match(lock, /^\{\n  "dependencies": \{\}\n\}\n\/\/bun\.lock\n<empty>\n$/)
})

test("metadata and TypeScript share the exact RUN and identity-only RESOLVE surface", async () => {
  const [source, metadata] = await Promise.all([
    readFile(new URL("./develop_composer_v2.ts", import.meta.url), "utf8"),
    readFile(new URL("./develop_composer_v2.script.yaml", import.meta.url), "utf8"),
  ])
  assert.match(source, /export async function main\(\n  action: Action,\n  request_identity: string,\n  request: DevelopComposerRunRequestV2 \| null,/)
  assert.match(metadata, /^  required:\n    - action\n    - request_identity\n    - request$/m)
  assert.match(metadata, /request_identity: \{type: string, minLength: 1, maxLength: 256\}/)
  for (const field of ["design", "binding_requests", "plugin_source_capsules"]) {
    assert.match(metadata, new RegExp(field))
  }
})
