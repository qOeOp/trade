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
const acceptance = readFileSync(resolve(root, "deploy/server/container-acceptance.sh"), "utf8")
const adoptionWorker = readFileSync(
  resolve(root, "scripts/rd-developer-patch-adoption-worker.ts"),
  "utf8",
)
const forwardSourceWorker = readFileSync(
  resolve(root, "scripts/rd-forward-source-admission-worker.ts"),
  "utf8",
)
const forwardMarketDataWorker = readFileSync(
  resolve(root, "scripts/rd-forward-market-data-demand-worker.ts"),
  "utf8",
)
const forwardCandleSegmentWorker = readFileSync(
  resolve(root, "scripts/rd-forward-candle-segment-worker.ts"),
  "utf8",
)
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
  assert.match(dockerfile, /FROM runtime AS developer/)
  assert.match(dockerfile, /ARG TRADE_SOURCE_REVISION=container-local/)
  assert.match(dockerfile, /trade\.container-source-revision\.v1/)
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

test("Linux acceptance is no-live, isolated, checksummed, and preserves recovery evidence", () => {
  assert.match(acceptance, /sha256sum --check SHA256SUMS/)
  assert.match(acceptance, /--provenance=mode=max/)
  assert.match(acceptance, /--sbom=true/)
  assert.match(acceptance, /--target runtime/)
  assert.match(acceptance, /--project-name "\$project_name"/)
  assert.match(acceptance, /TRADE_ENVIRONMENT_ID="server:acceptance"/)
  assert.match(acceptance, /up --detach --no-build runtime/)
  assert.match(acceptance, /named_volume_canary_survived/)
  assert.match(acceptance, /compose down/)
  assert.doesNotMatch(acceptance, /down[^\n]*--volumes|BINANCE_API|allow_live_writes/)
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
  assert.match(serialized, /"id":"rd-developer-code"/)
  assert.match(serialized, /"allow":\["read","write","edit","apply_patch"\]/)
  assert.match(serialized, /"workspaceOnly":true/)
  assert.match(serialized, /"alsoAllow":\["trade-developer__\*"\]/)
  assert.match(agentCompose, /agent-mcp-planner:[\s\S]*--profile[\s\S]*planner-proposal/)
  assert.match(agentCompose, /agent-mcp-developer:[\s\S]*--profile[\s\S]*developer-contract/)
  assert.match(agentCompose, /agent-mcp-reviewer:[\s\S]*--profile[\s\S]*reviewer-decision/)
  assert.match(agentCompose, /agent-host:[\s\S]*--ops-db\s*\n\s*- data\/ops\/ops_runtime\.db/)
  assert.match(agentCompose, /agent-host-code:[\s\S]*openclaw-workspace-http\.ts/)
  assert.match(agentCompose, /reviewer-agent-worker:[\s\S]*reviewer-resident\.ts/)
  assert.match(agentCompose, /reviewer-agent-worker:[\s\S]*http:\/\/agent-host:7313/)
  assert.match(agentCompose, /reviewer-agent-worker:[\s\S]*trade-data:\/app\/data/)
  assert.match(agentCompose, /reviewer-agent-worker:[\s\S]*trading_authority/)
  assert.match(agentCompose, /strategy-registry-worker:[\s\S]*strategy-registry\/src\/scripts\/resident\.ts/)
  assert.match(agentCompose, /strategy-registry-worker:[\s\S]*network_mode: none/)
  assert.match(agentCompose, /strategy-registry-worker:[\s\S]*trade-release-candidates:\/app\/data\/release-candidates/)
  assert.match(agentCompose, /forward-source-admission-worker:[\s\S]*network_mode: none/)
  assert.match(agentCompose, /forward-source-admission-worker:[\s\S]*rd-forward-source-admission-worker\.ts/)
  assert.match(agentCompose, /forward-market-data-worker:[\s\S]*network_mode: none/)
  assert.match(agentCompose, /forward-market-data-worker:[\s\S]*rd-forward-market-data-demand-worker\.ts/)
  assert.match(agentCompose, /forward-candle-segment-worker:[\s\S]*network_mode: none/)
  assert.match(agentCompose, /forward-candle-segment-worker:[\s\S]*rd-forward-candle-segment-worker\.ts/)
  assert.match(agentCompose, /agent-workspace-checker:[\s\S]*network_mode: none/)
  assert.match(agentCompose, /agent-workspace-checker:[\s\S]*agent-workspace-checker\.ts/)
  assert.match(agentCompose, /agent-release-checker:[\s\S]*network_mode: none/)
  assert.match(agentCompose, /agent-release-checker:[\s\S]*release-checker\.sock/)
  assert.match(agentCompose, /agent-patch-adopter:[\s\S]*network_mode: none/)
  assert.match(agentCompose, /agent-patch-adopter:[\s\S]*rd-developer-patch-adoption-worker\.ts/)
  assert.match(agentCompose, /trade-release-candidates:\/app\/data\/release-candidates/)
  assert.match(agentCompose, /agent-code-workspace:\/app\/tmp\/agent-workspace-slots/)
  assert.match(agentCompose, /agent-code-workspace:\/workspace/)
  assert.match(agentCompose, /agent-code-control:\/app\/control/)
  assert.match(agentCompose, /TRADE_MCP_OPS_DB: data\/ops\/ops_runtime\.db/)
  assert.match(compose, /trade-ops:\/app\/data\/ops/)
  assert.match(agentCompose, /trade-agent-artifacts:\/app\/data\/artifacts\/agent-runs/)
  const semanticHostBlock = agentCompose
    .split("\n  agent-host:")[1]!
    .split("\n  agent-host-code:")[0]!
  assert.doesNotMatch(semanticHostBlock, /trade-data:\/app\/data/)
  const codeHostBlock = agentCompose
    .split("\n  agent-host-code:")[1]!
    .split("\n  reviewer-agent-worker:")[0]!
  assert.doesNotMatch(codeHostBlock, /trade-data:\/app\/data/)
  const adopterBlock = agentCompose
    .split("\n  agent-patch-adopter:")[1]!
    .split("\n  agent-host:")[0]!
  assert.doesNotMatch(
    adopterBlock,
    /trade-data:\/app\/data|rd_state\.db|data_catalog\.db|trade\.db|\/app\/strategies/,
  )
  assert.match(adoptionWorker, /discoverAndQueueStrategySourceCandidates/)
  assert.match(adoptionWorker, /runStrategySourceAdoption/)
  assert.match(forwardSourceWorker, /listCertifiedStrategySourceAdoptions/)
  assert.match(forwardSourceWorker, /admitCertifiedStrategyAdoptionToForward/)
  assert.match(
    forwardMarketDataWorker,
    /reconcileForwardObservationPrograms/,
  )
  assert.match(
    forwardMarketDataWorker,
    /recordForwardMarketDataDemandDelivery/,
  )
  assert.match(
    forwardCandleSegmentWorker,
    /admitForwardObservationCandleSegment/,
  )
  const forwardSourceBlock = agentCompose
    .split("\n  forward-source-admission-worker:")[1]!
    .split("\n  agent-mcp-planner:")[0]!
  assert.match(forwardSourceBlock, /trade-data:\/app\/data/)
  assert.match(forwardSourceBlock, /trade-ops:\/app\/data\/ops:ro/)
  assert.match(
    forwardSourceBlock,
    /trade-release-candidates:\/app\/data\/release-candidates:ro/,
  )
  assert.doesNotMatch(
    forwardSourceBlock,
    /\/app\/strategies|agent-control|TRADE_AGENT_HOST_HTTP_TOKEN/,
  )
  const forwardMarketDataBlock = agentCompose
    .split("\n  forward-market-data-worker:")[1]!
    .split("\n  forward-candle-segment-worker:")[0]!
  assert.match(forwardMarketDataBlock, /trade-data:\/app\/data/)
  assert.match(
    forwardMarketDataBlock,
    /forward_session_authority==="none"/,
  )
  assert.doesNotMatch(
    forwardMarketDataBlock,
    /agent-control|trade-ops|release-candidates|TRADE_AGENT_HOST_HTTP_TOKEN/,
  )
  const forwardCandleSegmentBlock = agentCompose
    .split("\n  forward-candle-segment-worker:")[1]!
    .split("\n  agent-mcp-planner:")[0]!
  assert.match(forwardCandleSegmentBlock, /trade-data:\/app\/data/)
  assert.match(
    forwardCandleSegmentBlock,
    /forward_replay_admission_authority==="none"/,
  )
  assert.doesNotMatch(
    forwardCandleSegmentBlock,
    /agent-control|trade-ops|release-candidates|TRADE_AGENT_HOST_HTTP_TOKEN/,
  )
  const registryBlock = agentCompose
    .split("\n  strategy-registry-worker:")[1]!
    .split("\n  agent-mcp-planner:")[0]!
  assert.doesNotMatch(
    registryBlock,
    /\/app\/strategies|agent-control|TRADE_AGENT_HOST_HTTP_TOKEN/,
  )
  assert.match(agentCompose, /TRADE_MCP_RD_STATE_DB: data\/rd_state\.db/)
  assert.match(agentCompose, /TRADE_MCP_CATALOG_DB: data\/data_catalog\.db/)
  assert.match(agentCompose, /TRADE_MCP_TRADE_DB: data\/trade\.db/)
  assert.match(compose, /TRADE_ENVIRONMENT_ID: \$\{TRADE_ENVIRONMENT_ID:-runtime:primary\}/)
  assert.equal(
    agentCompose.match(/TRADE_ENVIRONMENT_ID: \$\{TRADE_ENVIRONMENT_ID:-runtime:primary\}/g)?.length,
    6,
  )
  assert.match(operatorCompose, /TRADE_ENVIRONMENT_ID: \$\{TRADE_ENVIRONMENT_ID:-runtime:primary\}/)
  assert.doesNotMatch(serialized, /sk-[A-Za-z0-9_-]{12,}/)
  assert.match(serialized, /"deny":\[[^\]]*"exec"[^\]]*"process"[^\]]*"code_execution"/)
})
