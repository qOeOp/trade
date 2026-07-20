import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import { ReadToolService } from "./read-tools"

const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const

export function createTradeMcpServer(service = new ReadToolService()): McpServer {
  const server = new McpServer(
    { name: "trade-agent-mcp", version: "0.1.0" },
    {
      instructions: [
        "This server exposes a small, read-only view of the local trading workspace.",
        "Tool discovery does not authorize direct CLI execution.",
        "No exchange write, strategy mutation, RD state mutation, or arbitrary command execution is available.",
      ].join(" "),
    },
  )

  server.registerTool("trade_tool_search", {
    title: "Search local trade capabilities",
    description: "Search the local toolset registry. Returns compact metadata only and never executes a discovered tool.",
    inputSchema: z.object({
      query: z.string().max(200).optional(),
      domain: z.string().max(100).optional(),
      capability: z.enum(["R", "A", "E", "V", "T", "C"]).optional(),
      limit: z.number().int().min(1).max(50).default(20),
    }),
    annotations: READ_ONLY_ANNOTATIONS,
  }, async (input) => result(service.searchTools(input)))

  server.registerTool("trade_tool_read", {
    title: "Read one local trade capability",
    description: "Read one exact toolset entry by ID. This is descriptive and does not execute its command.",
    inputSchema: z.object({ tool_id: z.string().min(1).max(200) }),
    annotations: READ_ONLY_ANNOTATIONS,
  }, async ({ tool_id }) => result(service.readTool(tool_id)))

  server.registerTool("artifact_catalog_query", {
    title: "Query artifact catalog",
    description: "Query indexed artifacts, datasets, reports, panels, refs, and strategy evidence through the artifact owner CLI.",
    inputSchema: z.object({
      path: z.string().max(500).optional(),
      artifact_id: z.string().max(200).optional(),
      symbol: z.string().max(50).optional(),
      strategy_id: z.string().max(200).optional(),
      report_kind: z.string().max(100).optional(),
      limit: z.number().int().min(1).max(100).default(20),
    }),
    annotations: READ_ONLY_ANNOTATIONS,
  }, async (input) => result(await service.queryArtifactCatalog(input)))

  server.registerTool("rd_program_read", {
    title: "Read R&D program state",
    description: "Read durable R&D program state through the research owner CLI without planning or mutation.",
    inputSchema: z.object({
      program_id: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/).default("rd-program"),
    }),
    annotations: READ_ONLY_ANNOTATIONS,
  }, async ({ program_id }) => result(await service.readRdProgram(program_id)))

  server.registerTool("ops_cycle_summary", {
    title: "Read operations cycle summary",
    description: "Read one automation cycle, its jobs, health, messages, incidents, and aggregate attention summary.",
    inputSchema: z.object({
      cycle_id: z.string().min(1).max(200),
    }),
    annotations: READ_ONLY_ANNOTATIONS,
  }, async ({ cycle_id }) => result(await service.readOpsCycleSummary(cycle_id)))

  return server
}

function result(payload: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
  }
}
