#!/usr/bin/env bun

import { Database } from "bun:sqlite"
import { mkdirSync, realpathSync } from "node:fs"
import { dirname, resolve, sep } from "node:path"
import { ensureAgentRunStoreSchema } from "../../../ops-runtime-store/src/lib/agent-run-store"
import {
  buildDatabaseIdentity,
  ensureDatabaseIdentity,
} from "../../../../contracts/runtime-core/src/database-identity"
import { startAgentHostHttpServer } from "../lib/agent-host-http-server"
import {
  materializeOpenClawAgentMessage,
  storeOpenClawAgentOutput,
  validateOpenClawAgentOutputArtifact,
} from "../lib/openclaw-artifact-materializer"
import { OpenClawAgentHost } from "../lib/openclaw-agent-run"
import { executeOpenClawGatewayHttp } from "../lib/openclaw-gateway-http-executor"

async function main(): Promise<void> {
  const input = parseArgs(process.argv.slice(2))
  const repositoryRoot = realpathSync(resolve(input.repository_root))
  const databasePath = resolve(repositoryRoot, input.ops_db)
  assertInside(resolve(repositoryRoot, "data"), databasePath)
  mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 })
  const hostToken = requiredEnvironment(input.host_token_env)
  const gatewayToken = requiredEnvironment(input.gateway_token_env)
  const db = new Database(databasePath, { create: true })
  db.exec("PRAGMA journal_mode=WAL")
  db.exec("PRAGMA busy_timeout=5000")
  db.exec("PRAGMA foreign_keys=ON")
  ensureDatabaseIdentity(
    db,
    buildDatabaseIdentity(input.environment_id, "ops_runtime_store"),
  )
  ensureAgentRunStoreSchema(db)
  const host = new OpenClawAgentHost({
    db,
    host_profile: "openclaw-gateway",
    allowed_task_profiles: ["planner", "developer", "reviewer", "explanation"],
    agent_ids: {
      planner: "rd-planner",
      developer: "rd-developer",
      reviewer: "rd-reviewer",
      explanation: "ops-explanation",
    },
    materialize: async (request) =>
      materializeOpenClawAgentMessage(repositoryRoot, request),
    store_output: async (request, text) =>
      storeOpenClawAgentOutput({
        repository_root: repositoryRoot,
        request,
        text,
        storage: "durable",
      }),
    validate_output_ref: async (request, artifact) =>
      validateOpenClawAgentOutputArtifact({
        repository_root: repositoryRoot,
        request,
        artifact,
      }),
    terminal_tool_outputs: {
      planner: {
        tool_name: "research_planner_proposal_prepare",
        output_schema_version: "trade.rd-planner-proposal-submission.v2",
      },
      developer: {
        tool_name: "research_developer_submission_prepare",
        output_schema_version: "trade.rd-developer-agent-submission.v1",
      },
      reviewer: {
        tool_name: "research_reviewer_submission_prepare",
        output_schema_version: "trade.rd-reviewer-agent-submission.v1",
      },
    },
    execute: async (request, signal) =>
      executeOpenClawGatewayHttp({
        gateway_url: input.gateway_url,
        gateway_token: gatewayToken,
        request,
        signal,
      }),
    report_error: (error) => {
      console.error(JSON.stringify({
        schema_version: "trade.agent-host-run-error.v1",
        ...error,
      }))
    },
  })
  const recovered = await host.recoverInterruptedRuns()
  const server = startAgentHostHttpServer({
    hostname: input.host,
    port: input.port,
    bearer_token: hostToken,
    allowed_hosts: input.allowed_hosts,
    host,
  })
  console.log(JSON.stringify({
    schema_version: "trade.agent-host-http-start.v1",
    status: "ready",
    host: input.host,
    port: server.port,
    profile: "openclaw-gateway",
    recovered_interrupted_runs: recovered,
  }))
  let closing = false
  const shutdown = () => {
    if (closing) return
    closing = true
    void (async () => {
      await server.stop()
      await host.close()
      db.close()
      process.exit(0)
    })()
  }
  process.on("SIGINT", shutdown)
  process.on("SIGTERM", shutdown)
}

function parseArgs(argv: string[]): {
  host: string
  port: number
  host_token_env: string
  gateway_token_env: string
  allowed_hosts: string[]
  repository_root: string
  ops_db: string
  gateway_url: string
  environment_id: string
} {
  const values = new Map<string, string>()
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index]
    const value = argv[index + 1]
    if (!flag?.startsWith("--") || value == null) {
      throw new Error("Agent Host HTTP arguments must be --key value pairs")
    }
    values.set(flag.slice(2), value)
  }
  const port = Number(values.get("port") ?? 7313)
  const host = values.get("host") ?? "127.0.0.1"
  const configuredHosts = values.get("allowed-hosts")
  const allowedHosts = configuredHosts
    ? configuredHosts.split(",").map((item) => item.trim()).filter(Boolean)
    : [`127.0.0.1:${port}`, `localhost:${port}`]
  if (host === "0.0.0.0" && !configuredHosts) {
    throw new Error("private-container wildcard requires explicit --allowed-hosts")
  }
  return {
    host,
    port,
    host_token_env: environmentName(
      values.get("host-token-env") ?? "TRADE_AGENT_HOST_HTTP_TOKEN",
    ),
    gateway_token_env: environmentName(
      values.get("gateway-token-env") ?? "OPENCLAW_GATEWAY_TOKEN",
    ),
    allowed_hosts: allowedHosts,
    repository_root: values.get("repository-root")
      ?? process.env.TRADE_REPO_ROOT
      ?? process.cwd(),
    ops_db: repoPath(values.get("ops-db") ?? "data/ops_runtime.db"),
    gateway_url: values.get("gateway-url") ?? "http://127.0.0.1:18789",
    environment_id: values.get("environment-id")
      ?? process.env.TRADE_ENVIRONMENT_ID
      ?? "local:local",
  }
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`required environment variable is missing: ${name}`)
  return value
}

function environmentName(value: string): string {
  if (!/^[A-Z][A-Z0-9_]{2,127}$/.test(value)) {
    throw new Error("Agent Host environment variable name is invalid")
  }
  return value
}

function repoPath(value: string): string {
  if (!value || value.startsWith("/") || value.split("/").includes("..")) {
    throw new Error("Agent Host database path must be repository-relative")
  }
  return value
}

function assertInside(root: string, path: string): void {
  if (path !== root && !path.startsWith(`${root}${sep}`)) {
    throw new Error("Agent Host database escaped data root")
  }
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
