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

const AUDITED_PREPARATION_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const

const REQUEST_ID = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/)
const PROGRAM_ID = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/)
const HYPOTHESIS_CONTRACT = z.record(z.string(), z.unknown()).refine(
  (value) => JSON.stringify(value).length <= 200_000,
  "hypothesis contract exceeds 200 KB",
)
const PLANNER_PROPOSAL_PREPARE = z.object({
  planner_run_id: z.string().trim().min(1).max(160),
  request_hash: z.string().regex(/^[a-f0-9]{64}$/),
  proposal_id: z.string().trim().min(1).max(160),
  hypothesis_id: z.string().trim().min(1).max(160),
  universe_node_id: z.string().trim().min(1).max(160),
  objective: z.string().trim().min(1).max(2_000),
  dataset_requirements: z.array(z.string().trim().min(1).max(160)).min(1).max(32),
  candidate_space: z.record(z.string(), z.unknown()).refine(
    (value) => Object.keys(value).length > 0 && JSON.stringify(value).length <= 200_000,
    "candidate_space must be non-empty and at most 200 KB",
  ),
  trial_budget: z.number().int().min(1).max(10_000),
  evaluation_protocol_ref: z.string().trim().min(1).max(500),
  requested_at: z.string().datetime({ offset: false }),
}).strict()
const DEVELOPER_SUBMISSION_PREPARE_BASE = z.object({
  developer_run_id: z.string().trim().min(1).max(160),
  request_hash: z.string().regex(/^[a-f0-9]{64}$/),
  brief_id: z.string().trim().min(1).max(160),
  source_revision: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/),
  draft_revision: z.number().int().min(1).max(1_000_000),
  predecessor_run_id: z.string().trim().min(1).max(160).nullable(),
  reason_code: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/),
  required_capabilities: z.array(z.string().trim().min(1).max(200)).max(64),
  requested_at: z.string().datetime({ offset: false }),
})
const DEVELOPER_DRAFT_JSON = z.union([
  z.record(z.string(), z.unknown()).refine(
    (value) => Object.keys(value).length > 0 && JSON.stringify(value).length <= 500_000,
    "draft_json must be non-empty and at most 500 KB",
  ),
  z.string().min(2).max(500_000),
])
const DEVELOPER_SUBMISSION_PREPARE = z.discriminatedUnion("implementation_mode", [
  DEVELOPER_SUBMISSION_PREPARE_BASE.extend({
    implementation_mode: z.enum(["existing_implementation", "contract_only"]),
    requested_trial_budget: z.number().int().min(1).max(10_000),
    draft_json: DEVELOPER_DRAFT_JSON,
  }).strict(),
  DEVELOPER_SUBMISSION_PREPARE_BASE.extend({
    implementation_mode: z.enum(["data_blocked", "tool_blocked"]),
    requested_trial_budget: z.number().int().min(1).max(10_000).optional(),
    draft_json: DEVELOPER_DRAFT_JSON.optional(),
  }).strict(),
])
const REVIEWER_SUBMISSION_PREPARE = z.object({
  reviewer_run_id: z.string().trim().min(1).max(160),
  request_hash: z.string().regex(/^[a-f0-9]{64}$/),
  experiment_id: z.string().trim().min(1).max(160),
  expected_version: z.number().int().min(1).max(1_000_000),
  stage_id: z.string().trim().min(1).max(160),
  decision: z.enum([
    "reject",
    "modify",
    "accept_for_draft",
    "accept_for_forward",
    "accept_for_shadow_candidate",
  ]),
  evidence: z.array(z.object({
    result_id: z.string().trim().min(1).max(160),
    evidence_role: z.enum([
      "primary",
      "supporting",
      "negative_control",
      "cost",
      "stability",
      "holdout",
    ]),
  }).strict()).min(1).max(32),
  selected_trial_id: z.string().trim().min(1).max(160).nullable(),
  rationale: z.string().trim().min(1).max(8_000),
  requested_at: z.string().datetime({ offset: false }),
}).strict()

export type TradeMcpProfile =
  | "interactive"
  | "planner"
  | "planner-proposal"
  | "developer"
  | "developer-contract"
  | "reviewer-decision"
  | "reviewer"
  | "explanation"

export function createTradeMcpServer(
  service = new ReadToolService(),
  researchJobs = new ResearchJobService(),
  profile: TradeMcpProfile = "interactive",
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
  const originalRegister = server.registerTool.bind(server)
  const registerTool = ((name: string, ...args: unknown[]) => {
    const registered = (originalRegister as (...values: unknown[]) => { disable(): void })(name, ...args)
    if (!allowedTools(profile).has(name)) registered.disable()
    return registered
  }) as McpServer["registerTool"]

  registerTool("trade_tool_search", {
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

  registerTool("trade_tool_read", {
    title: "Read one local trade capability",
    description: "Read one exact toolset entry by ID. This is descriptive and does not execute its command.",
    inputSchema: z.object({ tool_id: z.string().min(1).max(200) }),
    annotations: READ_ONLY_ANNOTATIONS,
  }, async ({ tool_id }) => result(service.readTool(tool_id)))

  registerTool("artifact_catalog_query", {
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

  registerTool("artifact_read", {
    title: "Read one cataloged artifact",
    description: "Read hash-verified text content by exact artifact ID. Paths outside project data/tmp and stale hashes are rejected.",
    inputSchema: z.object({
      artifact_id: z.string().min(1).max(200),
      max_bytes: z.number().int().min(1).max(1_000_000).default(200 * 1024),
    }),
    annotations: READ_ONLY_ANNOTATIONS,
  }, async ({ artifact_id, max_bytes }) => result(await service.readArtifact(artifact_id, max_bytes)))

  registerTool("l2_retention_reference_audit", {
    title: "Audit one L2 retention reference closure",
    description: "Read one Market Data owner audit by exact epoch ID. It verifies registered referrer bindings and never grants deletion or GC authority.",
    inputSchema: z.object({
      epoch_id: z.string().trim().min(1).max(300),
    }).strict(),
    annotations: READ_ONLY_ANNOTATIONS,
  }, async ({ epoch_id }) => result(await service.auditL2RetentionReference(epoch_id)))

  registerTool("l2_retention_reference_audit_page", {
    title: "List bounded L2 retention reference audits",
    description: "Read one deterministic Market Data owner page ordered by epoch ID. Counts cover only the page and no deletion candidates are produced.",
    inputSchema: z.object({
      after_epoch_id: z.string().trim().min(1).max(300).optional(),
      limit: z.number().int().min(1).max(50).default(20),
    }).strict(),
    annotations: READ_ONLY_ANNOTATIONS,
  }, async (input) => result(await service.listL2RetentionReferenceAudits(input)))

  registerTool("l2_service_health", {
    title: "Read active L2 service health",
    description: "Read the unique active supervisor and loopback Rust health through the L2 owner. Returns no process IDs, paths, or lifecycle control.",
    inputSchema: z.object({}).strict(),
    annotations: READ_ONLY_ANNOTATIONS,
  }, async () => result(await service.readL2ServiceHealth()))

  registerTool("l2_book_watch_consumer_health", {
    title: "Read resident L2 book-watch consumer health",
    description: "Read the unique resident consumer readiness, latest baseline identity, and aggregate reliability counters through its fixed owner. Returns no process IDs, paths, lifecycle control, depth stream, or economic authority.",
    inputSchema: z.object({}).strict(),
    annotations: READ_ONLY_ANNOTATIONS,
  }, async () => result(await service.readL2BookWatchConsumerHealth()))

  registerTool("rd_program_read", {
    title: "Read R&D program state",
    description: "Read durable R&D program state through the research owner CLI without planning or mutation.",
    inputSchema: z.object({
      program_id: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/).default("rd-program"),
    }),
    annotations: READ_ONLY_ANNOTATIONS,
  }, async ({ program_id }) => result(await service.readRdProgram(program_id)))

  registerTool("ops_cycle_summary", {
    title: "Read operations cycle summary",
    description: "Read one automation cycle, its jobs, health, messages, incidents, and aggregate attention summary.",
    inputSchema: z.object({
      cycle_id: z.string().min(1).max(200),
    }),
    annotations: READ_ONLY_ANNOTATIONS,
  }, async ({ cycle_id }) => result(await service.readOpsCycleSummary(cycle_id)))

  registerTool("runtime_parity_status", {
    title: "Read Agent/program runtime parity status",
    description: "Read compact immutable parity counts, the latest semantic projection hashes, and the fenced supervisor lease state. Returns no holder, process, path, lifecycle control, or cutover verdict.",
    inputSchema: z.object({}).strict(),
    annotations: READ_ONLY_ANNOTATIONS,
  }, async () => result(await service.readRuntimeParityStatus()))

  registerTool("research_hypothesis_prepare", {
    title: "Validate and project a research hypothesis",
    description: "Validate one structured strategy hypothesis contract through the owner designer and deterministically project its J04 queue item without writing state.",
    inputSchema: z.object({ hypothesis_contract: HYPOTHESIS_CONTRACT }).strict(),
    annotations: READ_ONLY_ANNOTATIONS,
  }, async ({ hypothesis_contract }) => result(await researchJobs.prepareHypothesis(hypothesis_contract)))

  registerTool("research_planner_proposal_prepare", {
    title: "Build a canonical Control Plane Planner Proposal",
    description: "Validate one proposal body against the current authoritative Planner context, append immutable Agent Run tool-use evidence, and return the canonical self-hashed submission without writing R&D domain state.",
    inputSchema: PLANNER_PROPOSAL_PREPARE,
    annotations: AUDITED_PREPARATION_ANNOTATIONS,
  }, async (input) => result(await researchJobs.preparePlannerProposal(input)))

  registerTool("research_developer_submission_prepare", {
    title: "Build a canonical Developer submission",
    description: "Bind one contract-only, existing-implementation, or blocked Developer assessment to the authoritative Brief, append immutable Agent Run tool-use evidence, and return a canonical self-hashed submission without applying code, reserving a Trial, or writing R&D domain state.",
    inputSchema: DEVELOPER_SUBMISSION_PREPARE,
    annotations: AUDITED_PREPARATION_ANNOTATIONS,
  }, async (input) => result(await researchJobs.prepareDeveloperSubmission(input)))

  registerTool("research_reviewer_submission_prepare", {
    title: "Build a canonical Reviewer submission",
    description: "Bind one evidence-grounded Reviewer decision to the supplied experiment lifecycle identity, append immutable Agent Run tool-use evidence, and return a canonical self-hashed submission without writing R&D lifecycle state.",
    inputSchema: REVIEWER_SUBMISSION_PREPARE,
    annotations: AUDITED_PREPARATION_ANNOTATIONS,
  }, async (input) => result(await researchJobs.prepareReviewerSubmission(input)))

  registerTool("research_hypothesis_brief", {
    title: "Build an R&D hypothesis design brief",
    description: "Read one durable RD program and its Control Plane planning context, then render the owner designer context and prompt without generating a hypothesis or writing state.",
    inputSchema: z.object({ program_id: PROGRAM_ID.default("rd-program") }).strict(),
    annotations: READ_ONLY_ANNOTATIONS,
  }, async ({ program_id }) => result(await researchJobs.hypothesisBrief(program_id)))

  registerTool("research_job_submit", {
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

  registerTool("research_job_status", {
    title: "Read asynchronous R&D job status",
    description: "Read the durable ops cycle and J04 status for a previously submitted request ID.",
    inputSchema: z.object({ request_id: REQUEST_ID }).strict(),
    annotations: READ_ONLY_ANNOTATIONS,
  }, async ({ request_id }) => result(await researchJobs.status(request_id)))

  registerTool("research_job_result", {
    title: "Read asynchronous R&D job result",
    description: "Read the terminal ops summary and result reference for a completed, failed, or blocked R&D request.",
    inputSchema: z.object({ request_id: REQUEST_ID }).strict(),
    annotations: READ_ONLY_ANNOTATIONS,
  }, async ({ request_id }) => result(await researchJobs.result(request_id)))

  return server
}

const READ_TOOLS = [
  "trade_tool_search",
  "trade_tool_read",
  "artifact_catalog_query",
  "artifact_read",
  "l2_retention_reference_audit",
  "l2_retention_reference_audit_page",
  "l2_service_health",
  "l2_book_watch_consumer_health",
  "rd_program_read",
  "ops_cycle_summary",
  "runtime_parity_status",
] as const

function allowedTools(profile: TradeMcpProfile): ReadonlySet<string> {
  if (profile === "interactive") {
    return new Set([
      ...READ_TOOLS,
      "research_hypothesis_prepare",
      "research_hypothesis_brief",
      "research_job_submit",
      "research_job_status",
      "research_job_result",
    ])
  }
  if (profile === "planner") {
    return new Set([
      ...READ_TOOLS,
      "research_hypothesis_prepare",
      "research_hypothesis_brief",
      "research_planner_proposal_prepare",
    ])
  }
  if (profile === "planner-proposal") {
    return new Set(["research_planner_proposal_prepare"])
  }
  if (profile === "developer") {
    return new Set([
      ...READ_TOOLS,
      "research_hypothesis_prepare",
      "research_developer_submission_prepare",
      "research_job_submit",
      "research_job_status",
      "research_job_result",
    ])
  }
  if (profile === "developer-contract") {
    return new Set(["research_developer_submission_prepare"])
  }
  if (profile === "reviewer-decision") {
    return new Set(["research_reviewer_submission_prepare"])
  }
  if (profile === "reviewer") return new Set([...READ_TOOLS, "research_job_status", "research_job_result"])
  return new Set(READ_TOOLS)
}

function result(payload: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
  }
}
