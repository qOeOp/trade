import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import { fileURLToPath } from "node:url"

const workbenchDir = fileURLToPath(new URL("../../..", import.meta.url))
const scriptPath = "f/trade/product_edge/source_intake_v1"
const read = (relativePath) => readFile(new URL(relativePath, `file://${workbenchDir}/`), "utf8")

test("Source Intake exposes one narrow Windmill script without widening MCP", async () => {
  const [metadata, source, profileText, readme] = await Promise.all([
    readFile(new URL("./source_intake_v1.script.yaml", import.meta.url), "utf8"),
    readFile(new URL("./source_intake_v1.ts", import.meta.url), "utf8"),
    read("mcp-profile.json"),
    read("README.md"),
  ])
  assert.match(metadata, new RegExp(`^lock: "!inline ${scriptPath}\\.script\\.lock"$`, "m"))
  assert.match(metadata, /^kind: script$/m)
  assert.match(metadata, /^  additionalProperties: false$/m)
  assert.match(metadata, /^    - action\n    - request_identity\n    - normalized_doi\n    - interpretation$/m)
  assert.match(metadata, /^      enum:\n        - RUN\n        - RESOLVE$/m)
  assert.match(metadata, /^  required:\n    - action\n    - request_identity$/m)
  for (const forbidden of [
    "url", "origin", "headers", "credentials", "admission", "claim", "reservation",
    "digest", "status", "boolean",
  ]) assert.doesNotMatch(metadata, new RegExp(`^    ${forbidden}:$`, "m"))

  assert.match(source, /const OWNER_URL = "http:\/\/rd-owner-api:8080"/)
  assert.match(source, /const PRODUCT_EDGE_CHANNEL = "WINDMILL_PRODUCT_EDGE" as const/)
  assert.match(source, /AbortSignal\.timeout\(8_000\)/)
  assert.match(source, /type Action = "RUN" \| "RESOLVE"/)
  assert.match(source, /next_legal_action: "RESOLVE_SAME_REQUEST"/)
  assert.doesNotMatch(source, /openalex\.org|api\.openalex|PROVIDER_URL|DEEPSEEK_API_KEY/)
  assert.doesNotMatch(source, /process\.env\.(?!RD_OWNER_API_TOKEN)/)

  const profile = JSON.parse(profileText)
  assert.deepEqual(profile.scopes, [
    "mcp:scripts:f/trade/product_edge/research_goal_v2",
    "mcp:scripts:f/trade/product_edge/artifact_build_v1",
    "mcp:scripts:f/trade/product_edge/exploratory_replay_v2",
    "mcp:scripts:f/trade/product_edge/develop_composer_v2",
    "mcp:endpoints:getJob,getJobLogs",
  ])
  assert.match(readme, /`source_intake\.openalex_work_by_doi\.submit_or_resolve\.v1`/)
  assert.doesNotMatch(readme, /Source Intake.*Raw App/i)
})
