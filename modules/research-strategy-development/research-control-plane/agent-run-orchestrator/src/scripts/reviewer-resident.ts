#!/usr/bin/env bun

import { readFileSync } from "node:fs"
import {
  parseBoundedInteger,
} from "../../../../../contracts/runtime-core/src/resident-worker"
import { resolveRepoPath } from "../../../../../contracts/runtime-core/src/paths"
import { createAgentArtifactCliPort } from "../lib/agent-artifact-cli-port"
import { AgentHostHttpClient } from "../lib/agent-host-http-client"
import {
  runReviewerAgentResidentForeground,
  type ReviewerAgentResidentForegroundConfig,
} from "../lib/reviewer-agent-resident-foreground"

async function main(argv: string[]): Promise<void> {
  const parsed = parseArgs(argv)
  const token = process.env[parsed.host_token_env]
  if (!token) {
    throw new Error(`required environment variable is missing: ${parsed.host_token_env}`)
  }
  const controller = new AbortController()
  const stop = () => controller.abort()
  process.once("SIGINT", stop)
  process.once("SIGTERM", stop)
  await runReviewerAgentResidentForeground({
    config: parsed.config,
    host: new AgentHostHttpClient({
      base_url: parsed.host_url,
      bearer_token: token,
    }),
    artifacts: createAgentArtifactCliPort(process.cwd(), "durable"),
    signal: controller.signal,
  })
}

export function parseArgs(argv: string[]): {
  config: ReviewerAgentResidentForegroundConfig
  host_url: string
  host_token_env: string
} {
  const config: ReviewerAgentResidentForegroundConfig = {
    db_path: "data/rd_state.db",
    state_path: "tmp/runtime/reviewer-agent-worker/state.json",
    environment_id: process.env.TRADE_ENVIRONMENT_ID || "local:local",
    worker_id: process.env.TRADE_REVIEWER_AGENT_WORKER_ID
      || "reviewer-agent-resident-1",
    source_revision: sourceRevision(),
    lease_duration_ms: 1_200_000,
    run_duration_ms: 900_000,
    max_attempts: 3,
    poll_interval_ms: 1_000,
    interval_ms: 5_000,
    max_cycles: 0,
  }
  let hostUrl = "http://agent-host:7313"
  let hostTokenEnv = "TRADE_AGENT_HOST_HTTP_TOKEN"
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    const value = argv[index + 1]
    if (!value) throw new Error(`${flag} requires a value`)
    index += 1
    switch (flag) {
      case "--db": config.db_path = value; break
      case "--state-path": config.state_path = value; break
      case "--environment-id": config.environment_id = value; break
      case "--worker-id": config.worker_id = value; break
      case "--source-revision": config.source_revision = value; break
      case "--host-url": hostUrl = httpUrl(value); break
      case "--host-token-env": hostTokenEnv = environmentName(value); break
      case "--lease-duration-ms":
        config.lease_duration_ms = parseBoundedInteger(value, 60_001, 86_400_000, "lease_duration_ms")
        break
      case "--run-duration-ms":
        config.run_duration_ms = parseBoundedInteger(value, 60_000, 3_600_000, "run_duration_ms")
        break
      case "--max-attempts":
        config.max_attempts = parseBoundedInteger(value, 1, 100, "max_attempts")
        break
      case "--poll-interval-ms":
        config.poll_interval_ms = parseBoundedInteger(value, 10, 30_000, "poll_interval_ms")
        break
      case "--interval-ms":
        config.interval_ms = parseBoundedInteger(value, 100, 300_000, "interval_ms")
        break
      case "--max-cycles":
        config.max_cycles = parseBoundedInteger(value, 0, 1_000_000, "max_cycles")
        break
      default: throw new Error(`unknown flag: ${flag}`)
    }
  }
  if (config.lease_duration_ms <= config.run_duration_ms) {
    throw new Error("lease_duration_ms must exceed run_duration_ms")
  }
  return { config, host_url: hostUrl, host_token_env: hostTokenEnv }
}

function sourceRevision(): string {
  try {
    const value = JSON.parse(
      readFileSync(resolveRepoPath(".trade-source-revision.json"), "utf8"),
    ) as Record<string, unknown>
    if (value.schema_version === "trade.container-source-revision.v1"
        && typeof value.source_revision === "string") {
      return value.source_revision
    }
  } catch {
    // Local development explicitly falls back to the checked-out revision name.
  }
  return "HEAD"
}

function httpUrl(value: string): string {
  const url = new URL(value)
  if (!["http:", "https:"].includes(url.protocol)
      || url.username || url.password || url.search || url.hash) {
    throw new Error("host_url is invalid")
  }
  return url.toString().replace(/\/$/, "")
}

function environmentName(value: string): string {
  if (!/^[A-Z][A-Z0-9_]{2,127}$/.test(value)) {
    throw new Error("host_token_env is invalid")
  }
  return value
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
