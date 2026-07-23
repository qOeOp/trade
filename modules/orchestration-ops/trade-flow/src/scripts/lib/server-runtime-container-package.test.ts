import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"
import { repoRoot } from "../../../../../contracts/runtime-core/src/paths"

const root = repoRoot()
const dockerfile = readFileSync(resolve(root, "deploy/server/Dockerfile"), "utf8")
const compose = readFileSync(resolve(root, "deploy/server/compose.yaml"), "utf8")
const operatorCompose = readFileSync(resolve(root, "deploy/server/compose.operator.yaml"), "utf8")
const agentCompose = readFileSync(resolve(root, "deploy/server/compose.agent.yaml"), "utf8")
const openClawConfig = JSON.parse(
  readFileSync(resolve(root, "deploy/server/openclaw.json"), "utf8"),
) as Record<string, unknown>
const openClawLock = JSON.parse(
  readFileSync(resolve(root, "deploy/server/openclaw-dependency.json"), "utf8"),
) as Record<string, unknown>
const ignore = readFileSync(resolve(root, ".dockerignore"), "utf8")

test("server image locks toolchains, builds native providers, and drops root", () => {
  assert.match(dockerfile, /ARG RUST_VERSION=1\.97\.1/)
  assert.match(dockerfile, /ARG BUN_VERSION=1\.3\.13/)
  assert.match(dockerfile, /ARG GO_VERSION=1\.25/)
  assert.match(dockerfile, /cargo build[\s\S]*--locked[\s\S]*--release/)
  assert.match(dockerfile, /CGO_ENABLED=0 go build[\s\S]*target\/release\/tech-indicators/)
  assert.match(dockerfile, /COPY --from=indicator-builder[\s\S]*target\/release\/tech-indicators/)
  assert.match(dockerfile, /bun install --frozen-lockfile --production/)
  assert.match(dockerfile, /USER 10001:10001/)
  assert.match(dockerfile, /ENTRYPOINT \["\/usr\/bin\/tini", "--"\]/)
  assert.match(dockerfile, /profile\/server-runtime-container\.json/)
  assert.doesNotMatch(dockerfile, /API_KEY|API_SECRET|sk-[a-z0-9]/i)
})

test("server Compose keeps one no-live runtime namespace and an opt-in hardened operator", () => {
  assert.match(dockerfile, /server-runtime-container-foreground\.ts/)
  assert.match(compose, /restart: always/)
  assert.match(compose, /read_only: true/)
  assert.match(compose, /cap_drop:\s*\n\s*- ALL/)
  assert.match(compose, /no-new-privileges:true/)
  assert.match(compose, /server-runtime-container-status\.ts/)
  assert.match(operatorCompose, /profiles:\s*\n\s*- operator/)
  assert.match(operatorCompose, /TRADE_OPERATOR_SECRET_ENV_FILE/)
  assert.match(operatorCompose, /network_mode: host/)
  assert.doesNotMatch(`${compose}\n${operatorCompose}`, /privileged:|docker\.sock|BINANCE_API|SILICONFLOW_API_KEY|TRADE_OPERATOR_API_TOKEN/)
})

test("server build context excludes runtime state, credentials, dependencies, and build caches", () => {
  for (const entry of [".git", ".secrets", "data", "tmp", "node_modules", "**/target"]) {
    assert.equal(ignore.split(/\r?\n/).includes(entry), true, `missing dockerignore entry ${entry}`)
  }
})

test("OpenClaw overlay is digest-pinned, private, secret-ref only, and bounds Developer", () => {
  assert.equal(openClawLock.version, "2026.7.1")
  assert.equal(
    openClawLock.image_index_digest,
    "sha256:6a31d44b2944e7adcd2b582bf6fb463111264ebca97a0201795b799135bd102c",
  )
  assert.match(agentCompose, /openclaw@sha256:6a31d44b2944e7adcd2b582bf6fb463111264ebca97a0201795b799135bd102c/)
  assert.match(agentCompose, /agent-control:\s*\n\s*internal: true/)
  assert.match(agentCompose, /TRADE_SILICONFLOW_SECRET_ENV_FILE/)
  assert.match(agentCompose, /TRADE_AGENT_HOST_HTTP_SECRET_ENV_FILE/)
  assert.match(agentCompose, /TRADE_OPENCLAW_GATEWAY_SECRET_ENV_FILE/)
  assert.match(agentCompose, /TRADE_MCP_HTTP_SECRET_ENV_FILE/)
  const runtimeBlock = agentCompose.split("\n  openclaw:")[0]!
  assert.doesNotMatch(runtimeBlock, /TRADE_OPENCLAW_GATEWAY_SECRET_ENV_FILE|TRADE_MCP_HTTP_SECRET_ENV_FILE/)
  assert.match(agentCompose, /\/health"\)/)
  assert.doesNotMatch(agentCompose, /\bports:|privileged:|docker\.sock|SILICONFLOW_API_KEY\s*:/)
  const serialized = JSON.stringify(openClawConfig)
  assert.match(serialized, /"id":"SILICONFLOW_API_KEY"/)
  assert.match(serialized, /"id":"OPENCLAW_GATEWAY_TOKEN"/)
  assert.match(serialized, /"Authorization":"Bearer \$\{TRADE_MCP_HTTP_TOKEN\}"/)
  assert.match(serialized, /"plugins":\{"enabled":false,"slots":\{"memory":"none"\}\}/)
  assert.match(serialized, /"skipBootstrap":true/)
  assert.match(serialized, /"id":"rd-developer"/)
  assert.match(serialized, /"alsoAllow":\["trade-developer__\*"\]/)
  assert.match(agentCompose, /agent-mcp-planner:[\s\S]*--profile[\s\S]*planner-proposal/)
  assert.match(agentCompose, /agent-mcp-developer:[\s\S]*--profile[\s\S]*developer-contract/)
  assert.match(agentCompose, /agent-mcp-reviewer:[\s\S]*--profile[\s\S]*reviewer-decision/)
  assert.match(agentCompose, /agent-host:[\s\S]*--ops-db\s*\n\s*- data\/ops_runtime\.db/)
  assert.match(agentCompose, /TRADE_MCP_OPS_DB: data\/ops_runtime\.db/)
  assert.match(agentCompose, /TRADE_MCP_RD_STATE_DB: data\/rd_state\.db/)
  assert.match(agentCompose, /TRADE_MCP_CATALOG_DB: data\/data_catalog\.db/)
  assert.match(agentCompose, /TRADE_MCP_TRADE_DB: data\/trade\.db/)
  assert.match(compose, /TRADE_ENVIRONMENT_ID: \$\{TRADE_ENVIRONMENT_ID:-server:primary\}/)
  assert.equal(
    agentCompose.match(/TRADE_ENVIRONMENT_ID: \$\{TRADE_ENVIRONMENT_ID:-server:primary\}/g)?.length,
    3,
  )
  assert.match(operatorCompose, /TRADE_ENVIRONMENT_ID: \$\{TRADE_ENVIRONMENT_ID:-server:primary\}/)
  assert.doesNotMatch(serialized, /sk-[A-Za-z0-9_-]{12,}/)
  assert.match(serialized, /"deny":\[[^\]]*"exec"[^\]]*"process"[^\]]*"code_execution"/)
})
