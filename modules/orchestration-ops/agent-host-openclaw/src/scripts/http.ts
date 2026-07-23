#!/usr/bin/env bun

import { startAgentHostHttpServer } from "../lib/agent-host-http-server"
import {
  installAgentHostShutdown,
  openAgentHostHttpRuntime,
  parseAgentHostHttpRuntimeArgs,
} from "../lib/agent-host-http-runtime"
import {
  materializeOpenClawAgentMessage,
  storeOpenClawAgentOutput,
  validateOpenClawAgentOutputArtifact,
} from "../lib/openclaw-artifact-materializer"
import { OpenClawAgentHost } from "../lib/openclaw-agent-run"
import { executeOpenClawGatewayHttp } from "../lib/openclaw-gateway-http-executor"

async function main(): Promise<void> {
  const input = parseAgentHostHttpRuntimeArgs(process.argv.slice(2), {
    port: 7313,
    host_token_env: "TRADE_AGENT_HOST_HTTP_TOKEN",
    argument_label: "Agent Host HTTP",
  })
  const runtime = openAgentHostHttpRuntime(input)
  const { db } = runtime
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
      materializeOpenClawAgentMessage(runtime.repository_root, request),
    store_output: async (request, text) =>
      storeOpenClawAgentOutput({
        repository_root: runtime.repository_root,
        request,
        text,
        storage: "durable",
      }),
    validate_output_ref: async (request, artifact) =>
      validateOpenClawAgentOutputArtifact({
        repository_root: runtime.repository_root,
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
    profile: "openclaw-gateway",
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
