import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import { ReadToolService } from "./read-tools"
import { ResearchJobService } from "./research-jobs"

const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const

const CONTROLLED_WRITE_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const

const REQUEST_ID = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/)
const PROGRAM_ID = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/)
const HYPOTHESIS_CONTRACT = z.record(z.string(), z.unknown()).refine(
  (value) => JSON.stringify(value).length <= 200_000,
  "hypothesis contract exceeds 200 KB",
)

export function createTradeMcpServer(
  service = new ReadToolService(),
  researchJobs = new ResearchJobService(),
): McpServer {
  const server = new McpServer(
    { name: "trade-agent-mcp", version: "0.1.0" },
    {
      instructions: [
        "This server exposes a small allowlist over the local trading workspace.",
        "Tool discovery does not authorize direct CLI execution.",
        "Research submission is asynchronous and routes only through the existing J04 supervisor.",
        "No exchange write, direct strategy mutation, or arbitrary command execution is available.",
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

  server.registerTool("artifact_read", {
    title: "Read one cataloged artifact",
    description: "Read hash-verified text content by exact artifact ID. Paths outside project data/tmp and stale hashes are rejected.",
    inputSchema: z.object({
      artifact_id: z.string().min(1).max(200),
      max_bytes: z.number().int().min(1).max(1_000_000).default(200 * 1024),
    }),
    annotations: READ_ONLY_ANNOTATIONS,
  }, async ({ artifact_id, max_bytes }) => result(await service.readArtifact(artifact_id, max_bytes)))

  server.registerTool("l2_retention_reference_audit", {
    title: "Audit one L2 retention reference closure",
    description: "Read one Market Data owner audit by exact epoch ID. It verifies registered referrer bindings and never grants deletion or GC authority.",
    inputSchema: z.object({
      epoch_id: z.string().trim().min(1).max(300),
    }).strict(),
    annotations: READ_ONLY_ANNOTATIONS,
  }, async ({ epoch_id }) => result(await service.auditL2RetentionReference(epoch_id)))

  server.registerTool("l2_retention_reference_audit_page", {
    title: "List bounded L2 retention reference audits",
    description: "Read one deterministic Market Data owner page ordered by epoch ID. Counts cover only the page and no deletion candidates are produced.",
    inputSchema: z.object({
      after_epoch_id: z.string().trim().min(1).max(300).optional(),
      limit: z.number().int().min(1).max(50).default(20),
    }).strict(),
    annotations: READ_ONLY_ANNOTATIONS,
  }, async (input) => result(await service.listL2RetentionReferenceAudits(input)))

  server.registerTool("l2_service_health", {
    title: "Read active L2 service health",
    description: "Read the unique active supervisor and loopback Rust health through the L2 owner. Returns no process IDs, paths, or lifecycle control.",
    inputSchema: z.object({}).strict(),
    annotations: READ_ONLY_ANNOTATIONS,
  }, async () => result(await service.readL2ServiceHealth()))

  server.registerTool("l2_book_watch_consumer_health", {
    title: "Read resident L2 book-watch consumer health",
    description: "Read the unique resident consumer readiness, latest baseline identity, and aggregate reliability counters through its fixed owner. Returns no process IDs, paths, lifecycle control, depth stream, or economic authority.",
    inputSchema: z.object({}).strict(),
    annotations: READ_ONLY_ANNOTATIONS,
  }, async () => result(await service.readL2BookWatchConsumerHealth()))

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

  server.registerTool("runtime_parity_status", {
    title: "Read Agent/program runtime parity status",
    description: "Read compact immutable parity counts, the latest semantic projection hashes, and the fenced supervisor lease state. Returns no holder, process, path, lifecycle control, or cutover verdict.",
    inputSchema: z.object({}).strict(),
    annotations: READ_ONLY_ANNOTATIONS,
  }, async () => result(await service.readRuntimeParityStatus()))

  server.registerTool("research_hypothesis_prepare", {
    title: "Validate and project a research hypothesis",
    description: "Validate one structured strategy hypothesis contract through the owner designer and deterministically project its J04 queue item without writing state.",
    inputSchema: z.object({ hypothesis_contract: HYPOTHESIS_CONTRACT }).strict(),
    annotations: READ_ONLY_ANNOTATIONS,
  }, async ({ hypothesis_contract }) => result(await researchJobs.prepareHypothesis(hypothesis_contract)))

  server.registerTool("research_hypothesis_brief", {
    title: "Build an R&D hypothesis design brief",
    description: "Read one durable RD program and its Control Plane planning context, then render the owner designer context and prompt without generating a hypothesis or writing state.",
    inputSchema: z.object({ program_id: PROGRAM_ID.default("rd-program") }).strict(),
    annotations: READ_ONLY_ANNOTATIONS,
  }, async ({ program_id }) => result(await researchJobs.hypothesisBrief(program_id)))

  server.registerTool("research_job_submit", {
    title: "Submit an asynchronous R&D job",
    description: "Idempotently submit one bounded J04 run. A supplied hypothesis contract must validate and project ready; it seeds a new program or is appended through the existing program owner.",
    inputSchema: z.object({
      request_id: REQUEST_ID,
      program_id: PROGRAM_ID.default("rd-program"),
      objective: z.string().trim().min(1).max(2_000),
      budget: z.object({
        max_hypotheses: z.number().int().min(1).max(20).optional(),
        max_trials_total: z.number().int().min(1).max(80).optional(),
        max_locked_holdout_uses: z.number().int().min(0).max(1).optional(),
      }).strict().optional(),
      hypothesis_contract: HYPOTHESIS_CONTRACT.optional(),
    }).strict(),
    annotations: CONTROLLED_WRITE_ANNOTATIONS,
  }, async (input) => result(await researchJobs.submit(input)))

  server.registerTool("research_job_status", {
    title: "Read asynchronous R&D job status",
    description: "Read the durable ops cycle and J04 status for a previously submitted request ID.",
    inputSchema: z.object({ request_id: REQUEST_ID }).strict(),
    annotations: READ_ONLY_ANNOTATIONS,
  }, async ({ request_id }) => result(await researchJobs.status(request_id)))

  server.registerTool("research_job_result", {
    title: "Read asynchronous R&D job result",
    description: "Read the terminal ops summary and result reference for a completed, failed, or blocked R&D request.",
    inputSchema: z.object({ request_id: REQUEST_ID }).strict(),
    annotations: READ_ONLY_ANNOTATIONS,
  }, async ({ request_id }) => result(await researchJobs.result(request_id)))

  return server
}

function result(payload: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
  }
}
