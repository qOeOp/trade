import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import { fileURLToPath } from "node:url"

const workbenchDir = fileURLToPath(new URL("../../..", import.meta.url))
const operationPath = "f/trade/product_edge/exploratory_replay_v2"
const read = (relativePath) => readFile(new URL(relativePath, `file://${workbenchDir}/`), "utf8")

test("Raw App and MCP expose one typed Replay V2 custody operation", async () => {
  const [metadata, source, appSource, appBackend, profileText] = await Promise.all([
    readFile(new URL("./exploratory_replay_v2.script.yaml", import.meta.url), "utf8"),
    readFile(new URL("./exploratory_replay_v2.ts", import.meta.url), "utf8"),
    read("f/trade/rd_workbench.raw_app/App.tsx"),
    read("f/trade/rd_workbench.raw_app/backend/exploratory_replay.yaml"),
    read("mcp-profile.json"),
  ])

  assert.equal(appBackend, `type: script\npath: ${operationPath}\n`)
  const profile = JSON.parse(profileText)
  assert.equal(profile.scopes.filter((scope) => scope === `mcp:scripts:${operationPath}`).length, 1)
  assert.match(metadata, new RegExp(`^lock: "!inline ${operationPath}\\.script\\.lock"$`, "m"))
  assert.match(metadata, /^      enum:\n        - RUN\n        - RESOLVE$/m)
  assert.match(metadata, /^    proposal:\n      type: object\n      additionalProperties: false$/m)
  for (const field of ["strategy_design", "strategy_plan", "pit_snapshot", "models",
    "runner_operational_profile", "diagnostic_policy"]) assert.match(metadata, new RegExp(field))
  assert.match(source, /"\/v2\/exploratory-replay-requests\/identify"/)
  assert.match(source, /await resolveOwner\(token, selector\.request_identity, selector\.meaning_digest\)/)
  assert.match(source, /if \(!unavailableReplayOwnerReadV2\(existing, selector\.request_identity\)\) return unknown/)
  assert.doesNotMatch(source, /backtest|market-data|qualification|trade/i)
  assert.match(appSource, /Exploratory Replay Request/)
  assert.match(appSource, /RESOLVE_SAME_REQUEST_IDENTITY/)
})

test("script signature and metadata share the bounded operation surface", async () => {
  const [metadata, source] = await Promise.all([
    readFile(new URL("./exploratory_replay_v2.script.yaml", import.meta.url), "utf8"),
    readFile(new URL("./exploratory_replay_v2.ts", import.meta.url), "utf8"),
  ])
  assert.match(source, /export async function main\(\n  action: Action,\n  request_identity: string,\n  meaning_digest: string,\n  proposal: unknown,\n\)/)
  assert.match(metadata, /^  order:\n    - action\n    - request_identity\n    - meaning_digest\n    - proposal$/m)
  assert.match(metadata, /^  required:\n    - action\n    - proposal$/m)
  assert.match(metadata, /const: RESOLVE[\s\S]*required:\n          - action\n          - request_identity\n          - meaning_digest\n          - proposal/)
})
