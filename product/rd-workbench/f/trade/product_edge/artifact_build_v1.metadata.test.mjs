import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import { fileURLToPath } from "node:url"

const workbenchDir = fileURLToPath(new URL("../../..", import.meta.url))
const artifactPath = "f/trade/product_edge/artifact_build_v1"

const read = (relativePath) => readFile(new URL(relativePath, `file://${workbenchDir}/`), "utf8")

test("default Windmill App and MCP artifact-build entry is one typed operation", async () => {
  const [metadata, source, researchMetadata, researchSource, appSource, appBackend, mcpProfile, readme] = await Promise.all([
    readFile(new URL("./artifact_build_v1.script.yaml", import.meta.url), "utf8"),
    readFile(new URL("./artifact_build_v1.ts", import.meta.url), "utf8"),
    readFile(new URL("./research_goal_v2.script.yaml", import.meta.url), "utf8"),
    readFile(new URL("./research_goal_v2.ts", import.meta.url), "utf8"),
    read("f/trade/rd_workbench.raw_app/App.tsx"),
    read("f/trade/rd_workbench.raw_app/backend/artifact_build.yaml"),
    read("mcp-profile.json"),
    read("README.md"),
  ])

  assert.equal(appBackend, `type: script\npath: ${artifactPath}\n`)
  assert.match(readme, /The `artifact_build\.submit_or_resolve\.v1` script is the one App\/MCP operation\./)

  const profile = JSON.parse(mcpProfile)
  assert.deepEqual(profile.scopes, [
    "mcp:scripts:f/trade/product_edge/research_goal_v2",
    `mcp:scripts:${artifactPath}`,
    "mcp:endpoints:getJob,getJobLogs",
  ])
  assert.equal(profile.scopes.filter((scope) => scope.startsWith("mcp:scripts:") && scope.includes("artifact_build")).length, 1)

  assert.equal(
    fileURLToPath(new URL("./artifact_build_v1.script.yaml", import.meta.url)).replace(".script.yaml", ".ts"),
    fileURLToPath(new URL("./artifact_build_v1.ts", import.meta.url)),
  )
  assert.match(metadata, new RegExp(`^lock: "!inline ${artifactPath}\\.script\\.lock"$`, "m"))
  assert.match(metadata, /^kind: script$/m)
  assert.match(metadata, /^    - action\n    - build_request_identity\n    - attempt_identity\n    - research_request_identity\n    - identity_mode$/m)
  assert.match(metadata, /^      enum:\n        - RUN\n        - RESOLVE$/m)
  assert.match(metadata, /^  required:\n    - action\n    - build_request_identity\n    - attempt_identity\n    - research_request_identity\n    - identity_mode$/m)
  assert.doesNotMatch(metadata, /^    channel:$/m)
  assert.match(
    source,
    /export async function main\(\n  action: Action,\n  build_request_identity: string,\n  attempt_identity: string,\n  research_request_identity: string,\n  identity_mode: IdentityMode,\n\)/,
  )
  assert.match(source, /const PRODUCT_EDGE_GATEWAY = "WINDMILL_PRODUCT_EDGE" as const/)
  assert.match(source, /type Action = "RUN" \| "RESOLVE"/)
  assert.match(source, /type IdentityMode = "GENERATE" \| "EXACT"/)
  assert.doesNotMatch(researchMetadata, /^    channel:$/m)
  assert.match(researchSource, /const PRODUCT_EDGE_GATEWAY = "WINDMILL_PRODUCT_EDGE" as const/)
  assert.doesNotMatch(researchSource, /channel: Channel/)
  assert.doesNotMatch(
    appSource,
    /return \{ \.\.\.current, research_view: view, next_legal_action: view\.next_legal_action \}/,
  )
})
