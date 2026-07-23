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
  receiveDeveloperContractDraft,
} from "../../../state-store/src/lib/developer-contract-draft-intake"
import type { AgentArtifactPort } from "./planner-agent-run"

export const DEVELOPER_AGENT_CONTEXT_PACK_SCHEMA =
  "trade.rd-developer-agent-context-pack.v1" as const

export interface DeveloperAgentContextPack {
  schema_version: typeof DEVELOPER_AGENT_CONTEXT_PACK_SCHEMA
  developer_run_id: string
  source_revision: string
  brief: DeveloperDevelopmentBrief
  predecessor_run_id: string | null
  replay_result_refs: AgentArtifactRef[]
  requested_at: string
  context_pack_hash: string
}

export interface PreparedDeveloperAgentRun {
  context_pack: DeveloperAgentContextPack
  request: AgentRunRequest
}

export interface DeveloperAgentAdmission {
  schema_version: "trade.rd-developer-agent-admission.v1"
  status: "draft_received" | "blocked"
  implementation_mode: DeveloperAgentSubmission["capability_assessment"]["implementation_mode"]
  submission_hash: string
  receipt: DeveloperContractDraftReceipt | null
  patch_ref: string | null
}

const DEVELOPER_INSTRUCTION = [
  "Act as the bounded R&D Developer in the isolated workspace.",
  "Assess whether the admitted mechanism uses an existing implementation, needs only a contract, needs code changes, or is blocked by data/tool coverage.",
  "For this contract-design capability, call research_developer_submission_prepare exactly once with the context-pack developer_run_id, brief_id, source_revision, and predecessor_run_id unchanged.",
  "Choose only existing_implementation, contract_only, data_blocked, or tool_blocked; code_change_required is not available through this read-only capability and evidence for it must never be fabricated.",
  "For a non-blocked submission, design draft_json within the Brief candidate space, set draft_json.schema_version to trade.rd-experiment-contract-draft-payload.v1, and keep requested_trial_budget at or below the Brief maximum.",
  "Use draft_revision 1 when there is no predecessor. Set created_at no earlier than requested_at.",
  "Return only the submission object returned by the tool, exactly and without prose or edits.",
  "A code change must bind a reviewable patch and successful bounded quality-check artifacts.",
  "Do not apply a patch, reserve a Trial, execute Replay, materialize a strategy, promote, deploy, or trade.",
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
  max_wall_time_ms?: number
}): PreparedDeveloperAgentRun {
  const brief = issueDeveloperDevelopmentBrief(input.db, {
    schema_version: DEVELOPER_DEVELOPMENT_BRIEF_ISSUE_REQUEST_SCHEMA_VERSION,
    brief_id: input.brief_id,
    proposal_id: input.proposal_id,
    proposal_revision: input.proposal_revision,
    idempotency_key: `agent-developer-brief:${input.developer_run_id}`,
    issued_at: utc(input.requested_at, "requested_at"),
  })
  const body = {
    schema_version: DEVELOPER_AGENT_CONTEXT_PACK_SCHEMA,
    developer_run_id: identifier(input.developer_run_id, "developer_run_id"),
    source_revision: revision(input.source_revision),
    brief,
    predecessor_run_id: input.predecessor_run_id == null
      ? null
      : identifier(input.predecessor_run_id, "predecessor_run_id"),
    replay_result_refs: artifactRefs(input.replay_result_refs ?? []),
    requested_at: utc(input.requested_at, "requested_at"),
  }
  const contextPack: DeveloperAgentContextPack = {
    ...body,
    context_pack_hash: canonicalHash(body),
  }
  const instructionRef = putVerified(input.artifacts, DEVELOPER_INSTRUCTION, "text/markdown")
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
    capabilities: ["owner_read", "research_read", "workspace_read", "workspace_patch", "bounded_quality_check"],
    budget: {
      deadline_at: utc(input.deadline_at, "deadline_at"),
      max_wall_time_ms: boundedInteger(input.max_wall_time_ms ?? 1_800_000, 1_000, 7_200_000, "max_wall_time_ms"),
      max_turns: 128,
      max_tool_calls: 512,
      max_input_bytes: instructionRef.bytes + contextRef.bytes
        + body.replay_result_refs.reduce((sum, ref) => sum + ref.bytes, 0),
      max_output_bytes: 4 * 1024 * 1024,
    },
    data_classification: "project_internal",
  })
  return { context_pack: contextPack, request }
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
