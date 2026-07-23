import type { Database } from "bun:sqlite"
import {
  buildAgentRunRequest,
  validateAgentRunCompletion,
  type AgentArtifactRef,
  type AgentRunEvent,
  type AgentRunRequest,
  type AgentRunResult,
} from "../../../../../contracts/agent-run-contract/src/agent-run-contract"
import { canonicalHash, canonicalJson } from "../../../../../contracts/runtime-core/src/canonical-json"
import {
  DEVELOPER_AGENT_SUBMISSION_SCHEMA,
  assertDeveloperAgentSubmission,
  type DeveloperAgentSubmission,
} from "../../../contracts/src/lib/developer-agent-submission"
import {
  DEVELOPER_CONTRACT_DRAFT_INTAKE_REQUEST_SCHEMA_VERSION,
  DEVELOPER_DEVELOPMENT_BRIEF_ISSUE_REQUEST_SCHEMA_VERSION,
  type DeveloperContractDraftReceipt,
  type DeveloperDevelopmentBrief,
} from "../../../contracts/src/lib/developer-contract-draft"
import {
  issueDeveloperDevelopmentBrief,
  readDeveloperDevelopmentBrief,
  receiveDeveloperContractDraft,
} from "../../../state-store/src/lib/developer-contract-draft-intake"
import type { AgentArtifactPort } from "./planner-agent-run"
import {
  createDeveloperCapabilityAssessment,
  type DeveloperCapabilityAssessment,
  type DeveloperDataSnapshotBinding,
} from "./developer-capability-assessment"

export const DEVELOPER_AGENT_CONTEXT_PACK_SCHEMA =
  "trade.rd-developer-agent-context-pack.v1" as const

export interface DeveloperAgentContextPack {
  schema_version: typeof DEVELOPER_AGENT_CONTEXT_PACK_SCHEMA
  developer_run_id: string
  source_revision: string
  brief: DeveloperDevelopmentBrief
  capability_assessment: DeveloperCapabilityAssessment
  next_draft_revision: number
  predecessor_run_id: string | null
  replay_result_refs: AgentArtifactRef[]
  requested_at: string
  context_pack_hash: string
}

export interface PreparedDeveloperAgentRun {
  context_pack: DeveloperAgentContextPack
  request: AgentRunRequest
  execution_route: "semantic_host" | "workspace_host"
}

export interface DeveloperAgentAdmission {
  schema_version: "trade.rd-developer-agent-admission.v1"
  status: "draft_received" | "blocked"
  implementation_mode: DeveloperAgentSubmission["capability_assessment"]["implementation_mode"]
  submission_hash: string
  receipt: DeveloperContractDraftReceipt | null
  patch_ref: string | null
}

const DEVELOPER_SEMANTIC_INSTRUCTION = [
  "Act as the bounded R&D Developer in the isolated workspace.",
  "The context-pack capability_assessment is deterministic and authoritative; never claim stronger family, Replay, or data coverage.",
  "Call research_developer_submission_prepare exactly once with only context-pack developer_run_id and the outer run.request_hash unchanged, plus semantic_contract and an optional bounded requested_trial_budget when the assessment is ready.",
  "For data_blocked or tool_blocked, omit semantic_contract and requested_trial_budget; the owner loads the exact active Agent Run context and returns a blocked submission.",
  "For a ready assessment, write only trade.rd-developer-semantic-contract.v3 with exactly: hypothesis {proposed_market_mechanism, falsifiable_prediction, null_hypothesis}, economic_rationale {proposed_edge_source, persistence_rationale, failure_modes}, and evaluation_question.",
  "Phrase every mechanism, prediction, edge source, and persistence rationale as explicitly provisional using may, might, could, would, hypothesis, or test whether; evaluation_question must end with a question mark. Never write an established finding.",
  "Do not include digits, percentages, currency, statistically significant, optimal, proven, guaranteed, or claims that a control protects capital, locks gains, or creates positive expectancy.",
  "Do not restate implementation mechanics or parameter names. The owner copies exact feature, signal, position, risk, and execution semantics from the source-bound family capability and owns all evaluation gates and rejection criteria.",
  "Do not calculate hashes, candidate assignments, Trial Group identity, versions, source refs, dataset refs, assumptions refs, replay requirement hashes, fees, slippage, capacity, margin, holding-period estimates, or unsupported controls.",
  "The tool result is already the final trade.rd-developer-agent-submission.v1 object. Return that exact top-level object without wrapping it in submission, structuredContent, prose, or markdown.",
  "Returning NO_REPLY, an empty response, or a summary is forbidden because the Agent Host must persist the exact canonical object as the run output artifact.",
  "Do not apply a patch, reserve a Trial, execute Replay, materialize a strategy, promote, deploy, or trade.",
].join("\n")

const DEVELOPER_WORKSPACE_INSTRUCTION = [
  "Act as the bounded R&D Developer for one code-change phase in an isolated frozen worktree.",
  "The context-pack capability_assessment is deterministic and authoritative; change only the missing capability it identifies.",
  "Do not call research_developer_submission_prepare: the current owner implementation is not ready, so the semantic Contract Draft phase cannot run yet.",
  "Read only the supplied context and isolated worktree. Do not access secrets, owner databases, the production checkout, Docker, external network, or another workspace.",
  "Modify implementation and tests only inside the externally issued write scope. Run only the allowlisted bounded package check.",
  "Do not calculate or mint Control Plane identities, freeze a Contract, reserve a Trial, execute Replay, merge, promote, deploy, or trade.",
  "Finish with a concise description of changed files and test outcome. The Host—not the model—must capture the patch and quality artifacts and construct the typed submission.",
].join("\n")

export function prepareDeveloperAgentRun(input: {
  db: Database
  developer_run_id: string
  trace_id: string
  idempotency_key: string
  source_revision: string
  requested_at: string
  deadline_at: string
  proposal_id: string
  proposal_revision: number
  brief_id: string
  artifacts: AgentArtifactPort
  predecessor_run_id?: string
  replay_result_refs?: AgentArtifactRef[]
  data_snapshot_binding?: DeveloperDataSnapshotBinding | null
  max_wall_time_ms?: number
}): PreparedDeveloperAgentRun {
  const requestedAt = utc(input.requested_at, "requested_at")
  const brief = readOrIssueBrief(input.db, {
    brief_id: input.brief_id,
    proposal_id: input.proposal_id,
    proposal_revision: input.proposal_revision,
    developer_run_id: input.developer_run_id,
    requested_at: requestedAt,
  })
  const nextDraftRevision = readNextDraftRevision(input.db, brief.brief_id)
  const sourceRevision = revision(input.source_revision)
  const capabilityAssessment = createDeveloperCapabilityAssessment({
    brief,
    source_revision: sourceRevision,
    data_snapshot_binding: input.data_snapshot_binding,
  })
  const body = {
    schema_version: DEVELOPER_AGENT_CONTEXT_PACK_SCHEMA,
    developer_run_id: identifier(input.developer_run_id, "developer_run_id"),
    source_revision: sourceRevision,
    brief,
    capability_assessment: capabilityAssessment,
    next_draft_revision: nextDraftRevision,
    predecessor_run_id: input.predecessor_run_id == null
      ? null
      : identifier(input.predecessor_run_id, "predecessor_run_id"),
    replay_result_refs: artifactRefs(input.replay_result_refs ?? []),
    requested_at: requestedAt,
  }
  const contextPack: DeveloperAgentContextPack = {
    ...body,
    context_pack_hash: canonicalHash(body),
  }
  const workspaceRequired = capabilityAssessment.required_mode === "code_change_required"
  const instructionRef = putVerified(
    input.artifacts,
    workspaceRequired
      ? DEVELOPER_WORKSPACE_INSTRUCTION
      : DEVELOPER_SEMANTIC_INSTRUCTION,
    "text/markdown",
  )
  const contextRef = putVerified(input.artifacts, canonicalJson(contextPack), "application/json")
  const request = buildAgentRunRequest({
    run_id: input.developer_run_id,
    idempotency_key: input.idempotency_key,
    trace_id: input.trace_id,
    task_profile: "developer",
    objective: brief.objective,
    source_revision: body.source_revision,
    instruction_ref: instructionRef,
    input_refs: [contextRef, ...body.replay_result_refs],
    output_schema_version: DEVELOPER_AGENT_SUBMISSION_SCHEMA,
    capabilities: workspaceRequired
      ? [
          "owner_read",
          "research_read",
          "workspace_read",
          "workspace_patch",
          "bounded_quality_check",
        ]
      : ["owner_read", "research_read"],
    budget: {
      deadline_at: utc(input.deadline_at, "deadline_at"),
      max_wall_time_ms: boundedInteger(input.max_wall_time_ms ?? 1_800_000, 1_000, 7_200_000, "max_wall_time_ms"),
      max_turns: 4,
      max_tool_calls: 2,
      max_input_bytes: instructionRef.bytes + contextRef.bytes
        + body.replay_result_refs.reduce((sum, ref) => sum + ref.bytes, 0),
      max_output_bytes: 4 * 1024 * 1024,
    },
    data_classification: "project_internal",
  })
  return {
    context_pack: contextPack,
    request,
    execution_route: workspaceRequired ? "workspace_host" : "semantic_host",
  }
}

function readOrIssueBrief(
  db: Database,
  input: {
    brief_id: string
    proposal_id: string
    proposal_revision: number
    developer_run_id: string
    requested_at: string
  },
): DeveloperDevelopmentBrief {
  try {
    const existing = readDeveloperDevelopmentBrief(db, input.brief_id)
    if (existing.proposal_id !== input.proposal_id
      || existing.proposal_revision !== input.proposal_revision) {
      throw new Error("existing Developer Brief drifted from requested Proposal")
    }
    return existing
  } catch (error) {
    if (!(error instanceof Error)
      || error.message !== "Developer Development Brief is missing") {
      throw error
    }
  }
  return issueDeveloperDevelopmentBrief(db, {
    schema_version: DEVELOPER_DEVELOPMENT_BRIEF_ISSUE_REQUEST_SCHEMA_VERSION,
    brief_id: input.brief_id,
    proposal_id: input.proposal_id,
    proposal_revision: input.proposal_revision,
    idempotency_key: `agent-developer-brief:${input.developer_run_id}`,
    issued_at: input.requested_at,
  })
}

function readNextDraftRevision(db: Database, briefId: string): number {
  const row = db.query(`
    SELECT COALESCE(MAX(draft_revision), 0) + 1 AS next_revision
    FROM rd_developer_contract_draft
    WHERE brief_id=$brief_id
  `).get({ $brief_id: briefId }) as { next_revision: number }
  return boundedInteger(row.next_revision, 1, 1_000_000, "next_draft_revision")
}

export function admitDeveloperAgentResult(input: {
  db: Database
  prepared: PreparedDeveloperAgentRun
  events: AgentRunEvent[]
  result: AgentRunResult
  artifacts: AgentArtifactPort
  recorded_at: string
}): DeveloperAgentAdmission {
  validateAgentRunCompletion(input.prepared.request, input.events, input.result)
  if (input.result.status !== "completed" || input.result.output_refs.length < 1) {
    throw new Error("Developer Agent Run must complete with output artifacts")
  }
  const submissionRef = input.result.output_refs[0]!
  if (submissionRef.media_type !== "application/json") throw new Error("Developer Agent submission must be JSON")
  const text = input.artifacts.read(submissionRef)
  assertArtifactText(submissionRef, text)
  const submission = JSON.parse(text) as DeveloperAgentSubmission
  assertDeveloperAgentSubmission(submission)
  validateSubmissionBindings(submission, input.prepared, input.result.output_refs)
  const blocked = submission.capability_assessment.implementation_mode === "data_blocked"
    || submission.capability_assessment.implementation_mode === "tool_blocked"
  if (blocked) {
    return {
      schema_version: "trade.rd-developer-agent-admission.v1",
      status: "blocked",
      implementation_mode: submission.capability_assessment.implementation_mode,
      submission_hash: submission.submission_hash,
      receipt: null,
      patch_ref: null,
    }
  }
  if (!submission.contract_draft) throw new Error("Developer submission omitted contract draft")
  const recordedAt = utc(input.recorded_at, "recorded_at")
  if (Date.parse(input.result.finished_at) > Date.parse(recordedAt)) {
    throw new Error("Developer admission must be recorded after Agent completion")
  }
  const receipt = receiveDeveloperContractDraft(input.db, {
    schema_version: DEVELOPER_CONTRACT_DRAFT_INTAKE_REQUEST_SCHEMA_VERSION,
    idempotency_key: `agent-developer-draft:${input.prepared.request.run_id}:${submission.draft_revision}`,
    recorded_at: recordedAt,
    submission: submission.contract_draft,
  })
  return {
    schema_version: "trade.rd-developer-agent-admission.v1",
    status: "draft_received",
    implementation_mode: submission.capability_assessment.implementation_mode,
    submission_hash: submission.submission_hash,
    receipt,
    patch_ref: submission.workspace_patch?.ref ?? null,
  }
}

function validateSubmissionBindings(
  submission: DeveloperAgentSubmission,
  prepared: PreparedDeveloperAgentRun,
  outputRefs: AgentArtifactRef[],
): void {
  const pack = prepared.context_pack
  if (submission.developer_run_id !== prepared.request.run_id
    || submission.brief_id !== pack.brief.brief_id
    || submission.brief_hash !== pack.brief.brief_hash
    || submission.source_revision !== prepared.request.source_revision
    || submission.predecessor_run_id !== pack.predecessor_run_id) {
    throw new Error("Developer Agent submission identity drifted")
  }
  if (submission.capability_assessment.implementation_mode
      !== pack.capability_assessment.required_mode
    || submission.capability_assessment.reason_code
      !== pack.capability_assessment.reason_code
    || canonicalJson(submission.capability_assessment.required_capabilities)
      !== canonicalJson(pack.capability_assessment.required_capabilities)) {
    throw new Error("Developer Agent capability assessment drifted from deterministic evidence")
  }
  if (Date.parse(submission.created_at) < Date.parse(pack.requested_at)) {
    throw new Error("Developer Agent submission predates its context pack")
  }
  const resultKeys = new Set(outputRefs.map((ref) => `${ref.ref}:${ref.sha256}`))
  for (const ref of [
    ...(submission.workspace_patch ? [submission.workspace_patch] : []),
    ...submission.quality_check_refs,
    ...submission.replay_diagnosis_refs,
  ]) {
    if (!resultKeys.has(`${ref.ref}:${ref.sha256}`)) {
      throw new Error("Developer evidence ref is absent from Agent Run output")
    }
  }
}

function artifactRefs(values: AgentArtifactRef[]): AgentArtifactRef[] {
  if (!Array.isArray(values) || values.length > 32) throw new Error("replay_result_refs must be bounded")
  return [...values].sort((left, right) => left.ref.localeCompare(right.ref))
}

function putVerified(
  artifacts: AgentArtifactPort,
  text: string,
  mediaType: AgentArtifactRef["media_type"],
): AgentArtifactRef {
  const ref = artifacts.put(text, mediaType)
  assertArtifactText(ref, text)
  if (ref.media_type !== mediaType) throw new Error("Agent artifact media type drifted")
  return ref
}

function assertArtifactText(ref: AgentArtifactRef, text: string): void {
  const bytes = Buffer.from(text)
  if (bytes.byteLength !== ref.bytes || new Bun.CryptoHasher("sha256").update(bytes).digest("hex") !== ref.sha256) {
    throw new Error("Agent artifact bytes or hash drifted")
  }
}

function identifier(value: string, field: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value)) throw new Error(`${field} is invalid`)
  return value
}

function revision(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/.test(value)) throw new Error("source_revision is invalid")
  return value
}

function boundedInteger(value: number, minimum: number, maximum: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(`${field} is invalid`)
  return value
}

function utc(value: string, field: string): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) throw new Error(`${field} must be canonical UTC`)
  return value
}
