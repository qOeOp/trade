import type { Database } from "bun:sqlite"
import { createHash } from "node:crypto"
import {
  buildAgentRunRequest,
  validateAgentRunCompletion,
  type AgentArtifactRef,
  type AgentRunEvent,
  type AgentRunRequest,
  type AgentRunResult,
} from "../../../../../contracts/agent-run-contract/src/agent-run-contract"
import { canonicalJson } from "../../../../../contracts/runtime-core/src/canonical-json"
import {
  assertPlannerControlPlaneContextSnapshot,
  type PlannerControlPlaneContextSnapshot,
} from "../../../contracts/src/lib/planner-control-plane-context"
import {
  PLANNER_PROPOSAL_INTAKE_REQUEST_SCHEMA_VERSION,
  PLANNER_PROPOSAL_SUBMISSION_SCHEMA_VERSION,
  assertPlannerProposalSubmission,
  type PlannerProposalAdmission,
  type PlannerProposalSubmission,
} from "../../../contracts/src/lib/planner-proposal-submission"
import { buildPlannerProposal } from "../../../../agent-roles/planner/src/lib/planner-role"
import { admitPlannerProposal } from "../../../state-store/src/lib/planner-proposal-intake"

export const PLANNER_AGENT_CONTEXT_PACK_SCHEMA =
  "trade.rd-planner-agent-context-pack.v1" as const

export interface AgentArtifactPort {
  put(text: string, mediaType: AgentArtifactRef["media_type"]): AgentArtifactRef
  read(artifact: AgentArtifactRef): string
}

export interface PlannerAgentContextPackBody {
  schema_version: typeof PLANNER_AGENT_CONTEXT_PACK_SCHEMA
  planner_run_id: string
  objective: string
  control_plane_context: PlannerControlPlaneContextSnapshot
  requested_at: string
}

export interface PlannerAgentContextPack extends PlannerAgentContextPackBody {
  context_pack_hash: string
}

export interface PreparedPlannerAgentRun {
  context_pack: PlannerAgentContextPack
  request: AgentRunRequest
}

const PLANNER_INSTRUCTION = [
  "Act as the bounded R&D Planner.",
  "Read only the supplied Control Plane context.",
  "Return one canonical trade.rd-planner-proposal-submission.v2 JSON object.",
  "Call research_planner_proposal_prepare with your selected bounded proposal body, then return its proposal field exactly; do not calculate or alter hashes yourself.",
  "Select one active canonical and only ready linked data surfaces.",
  "Do not create Trial, Result, strategy files, lifecycle decisions, or domain effects.",
].join("\n")

export function createPlannerAgentContextPack(
  input: PlannerAgentContextPackBody,
): PlannerAgentContextPack {
  if (input.schema_version !== PLANNER_AGENT_CONTEXT_PACK_SCHEMA) {
    throw new Error("Planner Agent context pack schema is unsupported")
  }
  assertPlannerControlPlaneContextSnapshot(input.control_plane_context)
  const body: PlannerAgentContextPackBody = {
    schema_version: PLANNER_AGENT_CONTEXT_PACK_SCHEMA,
    planner_run_id: identifier(input.planner_run_id, "planner_run_id"),
    objective: boundedText(input.objective, 1, 2_000, "objective"),
    control_plane_context: structuredClone(input.control_plane_context),
    requested_at: utc(input.requested_at, "requested_at"),
  }
  return { ...body, context_pack_hash: digestText(canonicalJson(body)) }
}

export function preparePlannerAgentRun(input: {
  planner_run_id: string
  trace_id: string
  idempotency_key: string
  objective: string
  source_revision: string
  requested_at: string
  deadline_at: string
  control_plane_context: PlannerControlPlaneContextSnapshot
  artifacts: AgentArtifactPort
  max_wall_time_ms?: number
}): PreparedPlannerAgentRun {
  const contextPack = createPlannerAgentContextPack({
    schema_version: PLANNER_AGENT_CONTEXT_PACK_SCHEMA,
    planner_run_id: input.planner_run_id,
    objective: input.objective,
    control_plane_context: input.control_plane_context,
    requested_at: input.requested_at,
  })
  const instructionRef = putVerified(input.artifacts, PLANNER_INSTRUCTION, "text/markdown")
  const contextText = canonicalJson(contextPack)
  const contextRef = putVerified(input.artifacts, contextText, "application/json")
  const request = buildAgentRunRequest({
    run_id: input.planner_run_id,
    idempotency_key: input.idempotency_key,
    trace_id: input.trace_id,
    task_profile: "planner",
    objective: contextPack.objective,
    source_revision: input.source_revision,
    instruction_ref: instructionRef,
    input_refs: [contextRef],
    output_schema_version: PLANNER_PROPOSAL_SUBMISSION_SCHEMA_VERSION,
    capabilities: ["owner_read", "research_read"],
    budget: {
      deadline_at: utc(input.deadline_at, "deadline_at"),
      max_wall_time_ms: boundedInteger(input.max_wall_time_ms ?? 600_000, 1_000, 7_200_000, "max_wall_time_ms"),
      max_turns: 32,
      max_tool_calls: 64,
      max_input_bytes: instructionRef.bytes + contextRef.bytes,
      max_output_bytes: 256 * 1024,
    },
    data_classification: "project_internal",
  })
  return { context_pack: contextPack, request }
}

export function admitPlannerAgentResult(input: {
  db: Database
  prepared: PreparedPlannerAgentRun
  events: AgentRunEvent[]
  result: AgentRunResult
  artifacts: AgentArtifactPort
  recorded_at: string
  proposal_revision?: number
}): PlannerProposalAdmission {
  validateAgentRunCompletion(input.prepared.request, input.events, input.result)
  if (input.result.status !== "completed" || input.result.output_refs.length !== 1) {
    throw new Error("Planner Agent Run must complete with exactly one output artifact")
  }
  const outputRef = input.result.output_refs[0]!
  if (outputRef.media_type !== "application/json") throw new Error("Planner Agent output must be JSON")
  const outputText = input.artifacts.read(outputRef)
  assertRefMatchesText(outputRef, outputText)
  const proposal = JSON.parse(outputText) as PlannerProposalSubmission
  assertPlannerProposalSubmission(proposal)
  validateProposalAgainstPack(proposal, input.prepared.context_pack)
  const proposalRevision = boundedInteger(input.proposal_revision ?? 1, 1, 1_000_000, "proposal_revision")
  const recordedAt = utc(input.recorded_at, "recorded_at")
  if (Date.parse(input.result.finished_at) > Date.parse(recordedAt)) {
    throw new Error("Planner admission must be recorded after Agent completion")
  }
  return admitPlannerProposal(input.db, {
    schema_version: PLANNER_PROPOSAL_INTAKE_REQUEST_SCHEMA_VERSION,
    planner_run_id: input.prepared.request.run_id,
    proposal_revision: proposalRevision,
    idempotency_key: `agent-planner-intake:${input.prepared.request.run_id}:${proposalRevision}`,
    submitted_at: input.result.finished_at,
    recorded_at: recordedAt,
    proposal,
  })
}

function validateProposalAgainstPack(
  proposal: PlannerProposalSubmission,
  pack: PlannerAgentContextPack,
): void {
  if (proposal.control_plane_context_hash !== pack.control_plane_context.context_hash) {
    throw new Error("Planner proposal context hash drifted")
  }
  if (proposal.objective !== pack.objective) throw new Error("Planner proposal objective drifted")
  if (Date.parse(proposal.created_at) < Date.parse(pack.requested_at)) {
    throw new Error("Planner proposal predates its context pack")
  }
  const rebuilt = buildPlannerProposal({
    proposal_id: proposal.proposal_id,
    hypothesis_id: proposal.hypothesis_id,
    universe_node_id: proposal.universe_node_id,
    objective: proposal.objective,
    dataset_requirements: proposal.dataset_requirements,
    candidate_space: proposal.candidate_space,
    trial_budget: proposal.trial_budget,
    evaluation_protocol_ref: proposal.evaluation_protocol_ref,
    control_plane_context: pack.control_plane_context,
    created_at: proposal.created_at,
  })
  if (canonicalJson(rebuilt) !== canonicalJson(proposal)) {
    throw new Error("Planner proposal is not valid for the frozen context")
  }
}

function putVerified(
  artifacts: AgentArtifactPort,
  text: string,
  mediaType: AgentArtifactRef["media_type"],
): AgentArtifactRef {
  const ref = artifacts.put(text, mediaType)
  assertRefMatchesText(ref, text)
  if (ref.media_type !== mediaType) throw new Error("Agent artifact media type drifted")
  return ref
}

function assertRefMatchesText(ref: AgentArtifactRef, text: string): void {
  const bytes = Buffer.from(text, "utf8")
  if (bytes.byteLength !== ref.bytes || digestText(text) !== ref.sha256) {
    throw new Error("Agent artifact bytes or hash drifted")
  }
}

function digestText(text: string): string {
  return createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex")
}

function identifier(value: string, field: string): string {
  const normalized = boundedText(value, 1, 160, field)
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(normalized)) throw new Error(`${field} is invalid`)
  return normalized
}

function boundedText(value: string, minimum: number, maximum: number, field: string): string {
  if (typeof value !== "string" || value.trim() !== value
    || value.length < minimum || value.length > maximum || /[\0\r]/.test(value)) {
    throw new Error(`${field} is invalid`)
  }
  return value
}

function boundedInteger(value: number, minimum: number, maximum: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${field} is invalid`)
  }
  return value
}

function utc(value: string, field: string): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) throw new Error(`${field} must be canonical UTC`)
  return value
}
