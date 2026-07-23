#!/usr/bin/env bun

import { startAgentHostHttpServer } from "../modules/orchestration-ops/agent-host-openclaw/src/lib/agent-host-http-server"
import {
  installAgentHostShutdown,
  openAgentHostHttpRuntime,
  parseAgentHostHttpRuntimeArgs,
} from "../modules/orchestration-ops/agent-host-openclaw/src/lib/agent-host-http-runtime"
import { executeOpenClawGatewayHttp } from "../modules/orchestration-ops/agent-host-openclaw/src/lib/openclaw-gateway-http-executor"
import { createResidentOpenClawWorkspaceHost } from "./lib/rd-openclaw-workspace-host"

async function main(): Promise<void> {
  const input = parseAgentHostHttpRuntimeArgs(Bun.argv.slice(2), {
    port: 7314,
    host_token_env: "TRADE_AGENT_CODE_HOST_HTTP_TOKEN",
    argument_label: "Workspace Agent Host",
  })
  const runtime = openAgentHostHttpRuntime(input)
  const { db } = runtime
  const host = createResidentOpenClawWorkspaceHost({
    db,
    repository_root: runtime.repository_root,
    execute: async (request, signal) =>
      executeOpenClawGatewayHttp({
        gateway_url: input.gateway_url,
        gateway_token: runtime.gateway_token,
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
    bearer_token: runtime.host_token,
    allowed_hosts: input.allowed_hosts,
    host,
  })
  console.log(JSON.stringify({
    schema_version: "trade.agent-host-http-start.v1",
    status: "ready",
    host: input.host,
    port: server.port,
    profile: "openclaw-workspace-gateway",
    workspace_slot: "active",
    recovered_interrupted_runs: recovered,
  }))
  installAgentHostShutdown({
    stop_server: () => server.stop(),
    close_host: () => host.close(),
    close_database: () => db.close(),
  })
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
