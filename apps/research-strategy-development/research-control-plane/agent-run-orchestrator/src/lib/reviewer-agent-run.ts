import type { Database } from "bun:sqlite"
import {
  buildAgentRunRequest,
  validateAgentRunCompletion,
  type AgentRunEvent,
  type AgentRunRequest,
  type AgentRunResult,
} from "../../../../../contracts/agent-run-contract/src/agent-run-contract"
import { canonicalHash, canonicalJson } from "../../../../../contracts/runtime-core/src/canonical-json"
import type { JSONRecord } from "../../../../../contracts/runtime-core/src/json"
import type {
  EvaluationEvidenceClassification,
} from "../../../contracts/src/lib/evaluation-evidence-classification"
import {
  REVIEWER_AGENT_SUBMISSION_SCHEMA,
  assertReviewerAgentSubmission,
  type ReviewerAgentDecision,
  type ReviewerAgentSubmission,
} from "../../../contracts/src/lib/reviewer-agent-submission"
import { applyReviewerDecision } from "../../../state-store/src/lib/research-control-plane"
import { appendResearchLesson } from "../../../state-store/src/lib/research-control-plane-operations"
import type { AgentArtifactPort } from "./planner-agent-run"

export const REVIEWER_AGENT_CONTEXT_PACK_SCHEMA =
  "trade.rd-reviewer-agent-context-pack.v1" as const

interface ReviewerResultSnapshot {
  result_id: string
  experiment_id: string
  result_scope: string
  trial_id: string | null
  stage_id: string
  artifact_ref: string
  summary_hash: string
  summary_bytes: number
  summary: JSONRecord
  classification: EvaluationEvidenceClassification
}

export interface ReviewerAgentContextPack {
  schema_version: typeof REVIEWER_AGENT_CONTEXT_PACK_SCHEMA
  reviewer_run_id: string
  source_revision: string
  experiment_id: string
  lifecycle_state: string
  lifecycle_version: number
  stage_id: string
  allowed_decisions: ReviewerAgentDecision[]
  results: ReviewerResultSnapshot[]
  requested_at: string
  context_pack_hash: string
}

export interface PreparedReviewerAgentRun {
  context_pack: ReviewerAgentContextPack
  request: AgentRunRequest
}

const REVIEWER_INSTRUCTION = [
  "Act as the bounded R&D Reviewer.",
  "Evaluate only the frozen experiment state and classified Result evidence in the context pack.",
  "Call research_reviewer_submission_prepare exactly once with context-pack reviewer_run_id, experiment_id, lifecycle_version as expected_version, stage_id, and requested_at plus outer run.request_hash unchanged.",
  "Select only an allowed decision and cite only context-pack Result IDs; return the tool result submission field exactly without prose or edits.",
  "Agent-assisted historical evidence is exploratory and cannot authorize acceptance for draft or forward.",
  "Do not change code, write lifecycle state, execute Replay, materialize a strategy, promote, deploy, or trade.",
].join("\n")

const MAX_REVIEWER_RESULT_SUMMARY_BYTES = 24 * 1024
const OMITTED_EVIDENCE_KEYS = new Set([
  "candles",
  "events",
  "fills",
  "observations",
  "orders",
  "raw_events",
  "trades",
])

export function prepareReviewerAgentRun(input: {
  db: Database
  reviewer_run_id: string
  trace_id: string
  idempotency_key: string
  source_revision: string
  requested_at: string
  deadline_at: string
  experiment_id: string
  stage_id: string
  result_ids: string[]
  artifacts: AgentArtifactPort
  max_wall_time_ms?: number
}): PreparedReviewerAgentRun {
  const experiment = input.db.query(`
    SELECT experiment_id, lifecycle_state, lifecycle_version
    FROM rd_experiment_contract
    WHERE experiment_id=$experiment_id
  `).get({ $experiment_id: input.experiment_id }) as {
    experiment_id: string
    lifecycle_state: string
    lifecycle_version: number
  } | null
  if (!experiment) throw new Error("Reviewer Agent experiment does not exist")
  const resultIds = uniqueIdentifiers(input.result_ids, "result_ids")
  if (resultIds.length < 1 || resultIds.length > 32) {
    throw new Error("Reviewer Agent result_ids must be bounded and non-empty")
  }
  const results = resultIds.map((resultId) => readResult(input.db, experiment.experiment_id, resultId))
  if (results.some((result) => result.stage_id !== input.stage_id)) {
    throw new Error("Reviewer Agent Result stage drifted from requested stage")
  }
  const allowedDecisions = (input.db.query(`
    SELECT DISTINCT trigger_value
    FROM rd_lifecycle_transition_rule
    WHERE current_state=$current_state
      AND trigger_type='reviewer'
      AND trigger_value!='accept_for_forward'
      AND requires_result_stage_id=$stage_id
    ORDER BY trigger_value
  `).all({
    $current_state: experiment.lifecycle_state,
    $stage_id: input.stage_id,
  }) as Array<{ trigger_value: ReviewerAgentDecision }>).map((row) => row.trigger_value)
  if (allowedDecisions.length === 0) {
    throw new Error("Reviewer Agent has no allowed lifecycle decision for context")
  }
  const body = {
    schema_version: REVIEWER_AGENT_CONTEXT_PACK_SCHEMA,
    reviewer_run_id: identifier(input.reviewer_run_id, "reviewer_run_id"),
    source_revision: revision(input.source_revision),
    experiment_id: experiment.experiment_id,
    lifecycle_state: experiment.lifecycle_state,
    lifecycle_version: experiment.lifecycle_version,
    stage_id: identifier(input.stage_id, "stage_id"),
    allowed_decisions: allowedDecisions,
    results,
    requested_at: utc(input.requested_at, "requested_at"),
  }
  const contextPack: ReviewerAgentContextPack = {
    ...body,
    context_pack_hash: canonicalHash(body),
  }
  const instructionRef = input.artifacts.put(REVIEWER_INSTRUCTION, "text/markdown")
  const contextRef = input.artifacts.put(canonicalJson(contextPack), "application/json")
  const request = buildAgentRunRequest({
    run_id: input.reviewer_run_id,
    idempotency_key: input.idempotency_key,
    trace_id: input.trace_id,
    task_profile: "reviewer",
    objective: `Review experiment ${experiment.experiment_id} at ${input.stage_id}`,
    source_revision: body.source_revision,
    instruction_ref: instructionRef,
    input_refs: [contextRef],
    output_schema_version: REVIEWER_AGENT_SUBMISSION_SCHEMA,
    capabilities: ["owner_read", "research_read"],
    budget: {
      deadline_at: utc(input.deadline_at, "deadline_at"),
      max_wall_time_ms: boundedInteger(input.max_wall_time_ms ?? 900_000, 1_000, 3_600_000),
      max_turns: 4,
      max_tool_calls: 2,
      max_input_bytes: instructionRef.bytes + contextRef.bytes,
      max_output_bytes: 1024 * 1024,
    },
    data_classification: "project_internal",
  })
  return { context_pack: contextPack, request }
}

export function admitReviewerAgentResult(input: {
  db: Database
  prepared: PreparedReviewerAgentRun
  events: AgentRunEvent[]
  result: AgentRunResult
  artifacts: AgentArtifactPort
  recorded_at: string
}): ReviewerAgentSubmission {
  validateAgentRunCompletion(input.prepared.request, input.events, input.result)
  if (input.result.status !== "completed" || input.result.output_refs.length !== 1) {
    throw new Error("Reviewer Agent Run must complete with exactly one output artifact")
  }
  const submissionRef = input.result.output_refs[0]!
  if (submissionRef.media_type !== "application/json") {
    throw new Error("Reviewer Agent submission must be JSON")
  }
  const submission = JSON.parse(input.artifacts.read(submissionRef)) as ReviewerAgentSubmission
  assertReviewerAgentSubmission(submission)
  validateBindings(submission, input.prepared)
  const recordedAt = utc(input.recorded_at, "recorded_at")
  if (Date.parse(input.result.finished_at) > Date.parse(recordedAt)) {
    throw new Error("Reviewer admission must be recorded after Agent completion")
  }
  const effectKey = canonicalHash({
    schema_version: "trade.rd-reviewer-agent-effect-key.v1",
    reviewer_run_id: submission.reviewer_run_id,
    submission_hash: submission.submission_hash,
  })
  applyReviewerDecision(input.db, {
    decision_id: `agent-review:${effectKey}`,
    experiment_id: submission.experiment_id,
    reviewer_run_id: submission.reviewer_run_id,
    idempotency_key: `agent-review-decision:${effectKey}`,
    expected_version: submission.expected_version,
    stage_id: submission.stage_id,
    decision: submission.decision,
    rationale_ref: submissionRef.ref,
    evidence: submission.evidence,
    lifecycle_event_id: `agent-review-event:${effectKey}`,
    lifecycle_idempotency_key: `agent-review-lifecycle:${effectKey}`,
    selected_trial_id: submission.selected_trial_id ?? undefined,
    created_at: recordedAt,
  })
  const experiment = input.db.query(`
    SELECT hypothesis_id
    FROM rd_experiment_contract
    WHERE experiment_id=$experiment_id
  `).get({ $experiment_id: submission.experiment_id }) as {
    hypothesis_id: string
  } | null
  if (!experiment) throw new Error("Reviewer feedback experiment disappeared")
  appendResearchLesson(input.db, reviewerFeedbackLesson({
    submission,
    submission_ref: submissionRef.ref,
    hypothesis_id: experiment.hypothesis_id,
    recorded_at: recordedAt,
  }))
  return submission
}

export function reviewerFeedbackLesson(input: {
  submission: ReviewerAgentSubmission
  submission_ref: string
  hypothesis_id: string
  recorded_at: string
}) {
  const submission = input.submission
  const lessonId = `reviewer-feedback:${submission.submission_hash.slice(0, 24)}`
  return {
    lesson_id: lessonId,
    experiment_id: submission.experiment_id,
    hypothesis_id: input.hypothesis_id,
    conclusion: (
      submission.decision === "reject" || submission.decision === "modify"
        ? "blocks"
        : "supports"
    ) as "blocks" | "supports",
    lesson_ref: input.submission_ref,
    metadata_json: {
      schema_version: "trade.rd-reviewer-feedback-lesson.v1",
      reviewer_run_id: submission.reviewer_run_id,
      decision: submission.decision,
      stage_id: submission.stage_id,
      rationale: submission.rationale,
      result_ids: submission.evidence.map((item) => item.result_id).sort(),
      selected_trial_id: submission.selected_trial_id,
    },
    idempotency_key: `reviewer-feedback-lesson:${submission.submission_hash}`,
    created_at: input.recorded_at,
  }
}

function readResult(
  db: Database,
  experimentId: string,
  resultId: string,
): ReviewerResultSnapshot {
  const row = db.query(`
    SELECT result.result_id, result.experiment_id, result.result_scope,
           result.trial_id, result.stage_id, result.artifact_ref,
           result.summary_json, classification.classification_json
    FROM rd_experiment_result AS result
    LEFT JOIN rd_evaluation_evidence_classification AS classification
      ON classification.result_id=result.result_id
    WHERE result.result_id=$result_id
  `).get({ $result_id: resultId }) as {
    result_id: string
    experiment_id: string
    result_scope: string
    trial_id: string | null
    stage_id: string
    artifact_ref: string
    summary_json: string
    classification_json: string | null
  } | null
  if (!row || row.experiment_id !== experimentId) {
    throw new Error("Reviewer Agent Result does not belong to experiment")
  }
  if (!row.classification_json) {
    throw new Error("Reviewer Agent Result lacks authoritative evidence classification")
  }
  const fullSummary = JSON.parse(row.summary_json) as JSONRecord
  return {
    result_id: row.result_id,
    experiment_id: row.experiment_id,
    result_scope: row.result_scope,
    trial_id: row.trial_id,
    stage_id: row.stage_id,
    artifact_ref: row.artifact_ref,
    summary_hash: canonicalHash(fullSummary),
    summary_bytes: Buffer.byteLength(canonicalJson(fullSummary)),
    summary: reviewerResultSummary(fullSummary),
    classification: JSON.parse(row.classification_json) as EvaluationEvidenceClassification,
  }
}

export function reviewerResultSummary(summary: JSONRecord): JSONRecord {
  const compatibility = compatibilityResultSummary(summary)
  if (compatibility && encodedBytes(compatibility) <= MAX_REVIEWER_RESULT_SUMMARY_BYTES) {
    return compatibility
  }
  const bounded = boundedEvidenceRecord(summary, 0)
  if (encodedBytes(bounded) <= MAX_REVIEWER_RESULT_SUMMARY_BYTES) return bounded
  return {
    schema_version: "trade.rd-reviewer-result-summary.digest-only.v1",
    summary_hash: canonicalHash(summary),
    summary_bytes: Buffer.byteLength(canonicalJson(summary)),
    top_level_scalars: scalarFields(summary),
    truncation_reason: "summary_exceeded_reviewer_context_limit",
  }
}

function compatibilityResultSummary(summary: JSONRecord): JSONRecord | null {
  const batch = jsonRecord(summary.batch)
  if (!batch || !Array.isArray(batch.candidates)) return null
  return {
    schema_version: "trade.rd-reviewer-result-summary.compatibility.v1",
    run_id: text(summary.run_id),
    created_at: text(summary.created_at),
    artifact_ref: text(summary.artifact_ref),
    stop_reason: text(summary.stop_reason),
    batch: {
      batch_id: text(batch.batch_id),
      hypothesis: text(batch.hypothesis),
      trial_count: integerOrNull(batch.trial_count),
      accepted_count: integerOrNull(batch.accepted_count),
      candidate_source: text(batch.candidate_source),
      outcome: text(batch.outcome),
      winner: boundedEvidenceValue(batch.winner, 1),
      candidates: batch.candidates.slice(0, 32).map((value) => compatibilityCandidateSummary(value)),
      guardrails: boundedEvidenceValue(batch.guardrails, 1),
      selection_audit: boundedEvidenceValue(batch.selection_audit, 1),
      statistical_report: boundedEvidenceValue(batch.statistical_report, 1),
      failure_summary: boundedEvidenceValue(batch.failure_summary, 1),
      reliability_gate: boundedEvidenceValue(batch.reliability_gate, 1),
      next_action: text(batch.next_action),
    },
    omitted_detail: {
      fields: ["batch.candidates[].replay.trades"],
      full_summary_hash: canonicalHash(summary),
      full_summary_bytes: Buffer.byteLength(canonicalJson(summary)),
    },
  }
}

function compatibilityCandidateSummary(value: unknown): JSONRecord {
  const candidate = jsonRecord(value) ?? {}
  const replay = jsonRecord(candidate.replay) ?? {}
  const diagnostics = jsonRecord(replay.diagnostics) ?? {}
  const assumptions = jsonRecord(diagnostics.assumptions) ?? {}
  const robustness = jsonRecord(assumptions.robustness) ?? {}
  return {
    candidate_id: text(candidate.candidate_id),
    family: text(candidate.family),
    params: boundedEvidenceValue(candidate.params, 1),
    replay: {
      sample_count: integerOrNull(replay.sample_count),
      win_rate: numberOrNull(replay.win_rate),
      avg_r: numberOrNull(replay.avg_r),
      total_r: numberOrNull(replay.total_r),
      max_drawdown_r: numberOrNull(replay.max_drawdown_r),
      profit_factor: numberOrNull(replay.profit_factor),
      expectancy_r: numberOrNull(replay.expectancy_r),
      gate: boundedEvidenceValue(replay.gate, 1),
      anti_overfit: boundedEvidenceValue(assumptions.anti_overfit, 1),
      robustness: {
        regime_slices: boundedEvidenceValue(robustness.regime_slices, 2),
        cost_stress: boundedEvidenceValue(robustness.cost_stress, 2),
        parameter_stability: boundedEvidenceValue(robustness.parameter_stability, 2),
      },
      negative_controls: boundedEvidenceValue(diagnostics.negative_controls, 1),
      evaluation_gate: boundedEvidenceValue(diagnostics.gate, 1),
    },
  }
}

function boundedEvidenceRecord(value: JSONRecord, depth: number): JSONRecord {
  const output: JSONRecord = {}
  const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
  for (const [key, item] of entries.slice(0, 48)) {
    if (OMITTED_EVIDENCE_KEYS.has(key)) {
      output[`${key}_omitted`] = omittedCollection(item)
      continue
    }
    output[key] = boundedEvidenceValue(item, depth + 1)
  }
  if (entries.length > 48) output.omitted_field_count = entries.length - 48
  return output
}

function boundedEvidenceValue(value: unknown, depth: number): unknown {
  if (value == null || typeof value === "boolean" || typeof value === "number") return value
  if (typeof value === "string") {
    return value.length <= 1_024 ? value : `${value.slice(0, 1_024)}…`
  }
  if (depth >= 6) return { omitted: true, reason: "maximum_summary_depth" }
  if (Array.isArray(value)) {
    const items = value.slice(0, 16).map((item) => boundedEvidenceValue(item, depth + 1))
    if (value.length > 16) {
      items.push({ omitted_count: value.length - 16 })
    }
    return items
  }
  const record = jsonRecord(value)
  return record ? boundedEvidenceRecord(record, depth) : String(value)
}

function omittedCollection(value: unknown): JSONRecord {
  return {
    omitted: true,
    count: Array.isArray(value) ? value.length : null,
  }
}

function scalarFields(value: JSONRecord): JSONRecord {
  const output: JSONRecord = {}
  for (const [key, item] of Object.entries(value).sort(([left], [right]) => left.localeCompare(right))) {
    if (item == null || typeof item === "boolean" || typeof item === "number") {
      output[key] = item
    } else if (typeof item === "string") {
      output[key] = item.length <= 1_024 ? item : `${item.slice(0, 1_024)}…`
    }
  }
  return output
}

function jsonRecord(value: unknown): JSONRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JSONRecord
    : null
}

function encodedBytes(value: JSONRecord): number {
  return Buffer.byteLength(canonicalJson(value))
}

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function integerOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null
}

function validateBindings(
  submission: ReviewerAgentSubmission,
  prepared: PreparedReviewerAgentRun,
): void {
  const pack = prepared.context_pack
  if (submission.reviewer_run_id !== prepared.request.run_id
    || submission.experiment_id !== pack.experiment_id
    || submission.expected_version !== pack.lifecycle_version
    || submission.stage_id !== pack.stage_id
    || !pack.allowed_decisions.includes(submission.decision)) {
    throw new Error("Reviewer Agent submission drifted from its context pack")
  }
  const contextResultIds = new Set(pack.results.map((result) => result.result_id))
  if (submission.evidence.some((item) => !contextResultIds.has(item.result_id))) {
    throw new Error("Reviewer Agent cited evidence outside its context pack")
  }
  const primaryId = submission.evidence.find((item) => item.evidence_role === "primary")?.result_id
  const primary = pack.results.find((result) => result.result_id === primaryId)
  if ((submission.decision === "accept_for_draft" || submission.decision === "accept_for_forward")
    && primary?.classification.evidence_kind !== "mechanical_replay") {
    throw new Error(`${submission.decision} requires mechanical_replay primary evidence`)
  }
  if (submission.decision === "accept_for_shadow_candidate"
    && primary?.classification.evidence_kind !== "forward_observation") {
    throw new Error("accept_for_shadow_candidate requires forward_observation primary evidence")
  }
}

function uniqueIdentifiers(values: string[], field: string): string[] {
  if (!Array.isArray(values)) throw new Error(`${field} must be an array`)
  const normalized = values.map((value) => identifier(value, field)).sort()
  if (new Set(normalized).size !== normalized.length) throw new Error(`${field} must be unique`)
  return normalized
}

function identifier(value: string, field: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value)) throw new Error(`${field} is invalid`)
  return value
}

function revision(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/.test(value)) throw new Error("source_revision is invalid")
  return value
}

function boundedInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error("max_wall_time_ms is invalid")
  }
  return value
}

function utc(value: string, field: string): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) {
    throw new Error(`${field} must be canonical UTC`)
  }
  return value
}
