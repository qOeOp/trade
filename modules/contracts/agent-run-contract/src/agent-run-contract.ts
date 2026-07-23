import { canonicalHash } from "../../runtime-core/src/canonical-json"

export const AGENT_RUN_REQUEST_SCHEMA = "trade.agent-run-request.v1" as const
export const AGENT_RUN_EVENT_SCHEMA = "trade.agent-run-event.v1" as const
export const AGENT_RUN_RESULT_SCHEMA = "trade.agent-run-result.v1" as const

export type AgentTaskProfile = "planner" | "developer" | "reviewer" | "explanation"
export type AgentCapability =
  | "owner_read"
  | "research_read"
  | "workspace_read"
  | "workspace_patch"
  | "bounded_quality_check"
export type AgentRunFailureClass =
  | "budget_exhausted"
  | "cancelled"
  | "capability_denied"
  | "host_unavailable"
  | "malformed_host_event"
  | "provider_unavailable"
  | "sandbox_failed"
  | "tool_effect_uncertain"
  | "validation_failed"

export interface AgentArtifactRef {
  ref: string
  sha256: string
  media_type: "application/json" | "text/markdown" | "text/x-diff" | "text/plain"
  bytes: number
}

export interface AgentRunRequest {
  schema_version: typeof AGENT_RUN_REQUEST_SCHEMA
  run_id: string
  idempotency_key: string
  trace_id: string
  task_profile: AgentTaskProfile
  objective: string
  source_revision: string
  instruction_ref: AgentArtifactRef
  input_refs: AgentArtifactRef[]
  output_schema_version: string
  capabilities: AgentCapability[]
  budget: {
    deadline_at: string
    max_wall_time_ms: number
    max_turns: number
    max_tool_calls: number
    max_input_bytes: number
    max_output_bytes: number
  }
  data_classification: "public" | "project_internal"
  domain_authority: "none"
  request_hash: string
}

export type AgentRunEventKind =
  | "accepted"
  | "started"
  | "tool_started"
  | "tool_completed"
  | "awaiting_approval"
  | "progress"
  | "terminal"

export interface AgentRunEvent {
  schema_version: typeof AGENT_RUN_EVENT_SCHEMA
  run_id: string
  trace_id: string
  request_hash: string
  sequence: number
  occurred_at: string
  kind: AgentRunEventKind
  summary: string
  operation_ref?: string
  status?: "completed" | "blocked" | "cancelled" | "failed"
  failure_class?: AgentRunFailureClass
  event_hash: string
}

export interface AgentRunResult {
  schema_version: typeof AGENT_RUN_RESULT_SCHEMA
  run_id: string
  trace_id: string
  request_hash: string
  terminal_sequence: number
  finished_at: string
  status: "completed" | "blocked" | "cancelled" | "failed"
  output_refs: AgentArtifactRef[]
  usage: {
    wall_time_ms: number
    turns: number
    tool_calls: number
    input_bytes: number
    output_bytes: number
  }
  failure?: {
    class: AgentRunFailureClass
    retryable: boolean
    effect_status: "none" | "known" | "uncertain"
  }
  domain_authority: "none"
  result_hash: string
}

const CAPABILITIES_BY_PROFILE: Readonly<Record<AgentTaskProfile, readonly AgentCapability[]>> = {
  planner: ["owner_read", "research_read"],
  developer: ["owner_read", "research_read", "workspace_read", "workspace_patch", "bounded_quality_check"],
  reviewer: ["owner_read", "research_read", "workspace_read"],
  explanation: ["owner_read", "research_read"],
}

export function buildAgentRunRequest(
  value: Omit<AgentRunRequest, "schema_version" | "request_hash" | "domain_authority">,
): AgentRunRequest {
  const candidate = {
    schema_version: AGENT_RUN_REQUEST_SCHEMA,
    ...value,
    domain_authority: "none" as const,
  }
  return compileAgentRunRequest({ ...candidate, request_hash: canonicalHash(candidate) })
}

export function compileAgentRunRequest(value: unknown): AgentRunRequest {
  const input = record(value, "agent_run")
  exact(input, [
    "schema_version", "run_id", "idempotency_key", "trace_id", "task_profile", "objective",
    "source_revision", "instruction_ref", "input_refs", "output_schema_version", "capabilities",
    "budget", "data_classification", "domain_authority", "request_hash",
  ], "agent_run")
  if (input.schema_version !== AGENT_RUN_REQUEST_SCHEMA) throw new Error("agent run request schema is unsupported")
  const taskProfile = oneOf(input.task_profile, ["planner", "developer", "reviewer", "explanation"] as const, "task_profile")
  if (input.domain_authority !== "none") throw new Error("agent run must not grant domain authority")
  const objective = boundedText(input.objective, 1, 2_000, "objective")
  rejectSensitiveText(objective, "objective")
  const instructionRef = artifactRef(input.instruction_ref, "instruction_ref")
  const inputRefs = artifactRefs(input.input_refs, "input_refs", 64)
  const capabilities = capabilityList(input.capabilities, taskProfile)
  const budgetInput = record(input.budget, "budget")
  exact(budgetInput, [
    "deadline_at", "max_wall_time_ms", "max_turns", "max_tool_calls",
    "max_input_bytes", "max_output_bytes",
  ], "budget")
  const totalInputBytes = instructionRef.bytes + inputRefs.reduce((total, ref) => total + ref.bytes, 0)
  const withoutHash = {
    schema_version: AGENT_RUN_REQUEST_SCHEMA,
    run_id: identifier(input.run_id, "run_id"),
    idempotency_key: identifier(input.idempotency_key, "idempotency_key"),
    trace_id: identifier(input.trace_id, "trace_id"),
    task_profile: taskProfile,
    objective,
    source_revision: revision(input.source_revision),
    instruction_ref: instructionRef,
    input_refs: inputRefs,
    output_schema_version: identifier(input.output_schema_version, "output_schema_version"),
    capabilities,
    budget: {
      deadline_at: canonicalTime(budgetInput.deadline_at, "budget.deadline_at"),
      max_wall_time_ms: integer(budgetInput.max_wall_time_ms, 1_000, 7_200_000, "budget.max_wall_time_ms"),
      max_turns: integer(budgetInput.max_turns, 1, 256, "budget.max_turns"),
      max_tool_calls: integer(budgetInput.max_tool_calls, 0, 1_024, "budget.max_tool_calls"),
      max_input_bytes: integer(budgetInput.max_input_bytes, 1, 64 * 1024 * 1024, "budget.max_input_bytes"),
      max_output_bytes: integer(budgetInput.max_output_bytes, 1, 16 * 1024 * 1024, "budget.max_output_bytes"),
    },
    data_classification: oneOf(input.data_classification, ["public", "project_internal"] as const, "data_classification"),
    domain_authority: "none" as const,
  }
  if (totalInputBytes > withoutHash.budget.max_input_bytes) throw new Error("agent run input byte budget exceeded")
  const requestHash = sha256(input.request_hash, "request_hash")
  if (canonicalHash(withoutHash) !== requestHash) throw new Error("agent run request_hash mismatch")
  return { ...withoutHash, request_hash: requestHash }
}

export function buildAgentRunEvent(
  value: Omit<AgentRunEvent, "schema_version" | "event_hash">,
): AgentRunEvent {
  const candidate = { schema_version: AGENT_RUN_EVENT_SCHEMA, ...value }
  return compileAgentRunEvent({ ...candidate, event_hash: canonicalHash(candidate) })
}

export function compileAgentRunEvent(value: unknown): AgentRunEvent {
  const input = record(value, "agent_run_event")
  const required = [
    "schema_version", "run_id", "trace_id", "request_hash", "sequence", "occurred_at",
    "kind", "summary", "event_hash",
  ]
  allowedAndRequired(input, [...required, "operation_ref", "status", "failure_class"], required, "agent_run_event")
  if (input.schema_version !== AGENT_RUN_EVENT_SCHEMA) throw new Error("agent run event schema is unsupported")
  const kind = oneOf(input.kind, [
    "accepted", "started", "tool_started", "tool_completed", "awaiting_approval", "progress", "terminal",
  ] as const, "kind")
  const summary = boundedText(input.summary, 1, 1_000, "summary")
  rejectSensitiveText(summary, "summary")
  const status = optionalOneOf(input.status, ["completed", "blocked", "cancelled", "failed"] as const, "status")
  const failureClass = optionalFailureClass(input.failure_class)
  if (kind === "terminal" && status == null) throw new Error("terminal event requires status")
  if (kind !== "terminal" && (status != null || failureClass != null)) throw new Error("only terminal event may carry status or failure_class")
  if (status === "completed" && failureClass != null) throw new Error("completed terminal event must not carry failure_class")
  if (status != null && status !== "completed" && failureClass == null) throw new Error("non-completed terminal event requires failure_class")
  const withoutHash = {
    schema_version: AGENT_RUN_EVENT_SCHEMA,
    run_id: identifier(input.run_id, "run_id"),
    trace_id: identifier(input.trace_id, "trace_id"),
    request_hash: sha256(input.request_hash, "request_hash"),
    sequence: integer(input.sequence, 1, Number.MAX_SAFE_INTEGER, "sequence"),
    occurred_at: canonicalTime(input.occurred_at, "occurred_at"),
    kind,
    summary,
    ...(input.operation_ref == null ? {} : { operation_ref: safeRef(input.operation_ref, "operation_ref") }),
    ...(status == null ? {} : { status }),
    ...(failureClass == null ? {} : { failure_class: failureClass }),
  }
  const eventHash = sha256(input.event_hash, "event_hash")
  if (canonicalHash(withoutHash) !== eventHash) throw new Error("agent run event_hash mismatch")
  return { ...withoutHash, event_hash: eventHash }
}

export function validateAgentRunEventStream(request: AgentRunRequest, values: unknown[]): AgentRunEvent[] {
  if (values.length === 0) throw new Error("agent run event stream is empty")
  const events = values.map(compileAgentRunEvent)
  let terminalSeen = false
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]!
    if (event.run_id !== request.run_id || event.trace_id !== request.trace_id || event.request_hash !== request.request_hash) {
      throw new Error("agent run event identity drifted")
    }
    if (event.sequence !== index + 1) throw new Error("agent run event sequence is not contiguous")
    if (terminalSeen) throw new Error("agent run event appears after terminal")
    terminalSeen = event.kind === "terminal"
  }
  if (events[0]!.kind !== "accepted") throw new Error("agent run event stream must start with accepted")
  if (!terminalSeen) throw new Error("agent run event stream has no terminal event")
  return events
}

export function buildAgentRunResult(
  value: Omit<AgentRunResult, "schema_version" | "result_hash" | "domain_authority">,
): AgentRunResult {
  const candidate = {
    schema_version: AGENT_RUN_RESULT_SCHEMA,
    ...value,
    domain_authority: "none" as const,
  }
  return compileAgentRunResult({ ...candidate, result_hash: canonicalHash(candidate) })
}

export function compileAgentRunResult(value: unknown): AgentRunResult {
  const input = record(value, "agent_run_result")
  const required = [
    "schema_version", "run_id", "trace_id", "request_hash", "terminal_sequence",
    "finished_at", "status", "output_refs", "usage", "domain_authority", "result_hash",
  ]
  allowedAndRequired(input, [...required, "failure"], required, "agent_run_result")
  if (input.schema_version !== AGENT_RUN_RESULT_SCHEMA) throw new Error("agent run result schema is unsupported")
  if (input.domain_authority !== "none") throw new Error("agent run result must not grant domain authority")
  const status = oneOf(input.status, ["completed", "blocked", "cancelled", "failed"] as const, "status")
  const outputRefs = artifactRefs(input.output_refs, "output_refs", 32)
  const usageInput = record(input.usage, "usage")
  exact(usageInput, ["wall_time_ms", "turns", "tool_calls", "input_bytes", "output_bytes"], "usage")
  const failure = input.failure == null ? undefined : compileFailure(input.failure)
  if (status === "completed" && failure != null) throw new Error("completed agent run result must not carry failure")
  if (status !== "completed" && failure == null) throw new Error("non-completed agent run result requires failure")
  if (status !== "completed" && outputRefs.length > 0) throw new Error("non-completed agent run result must not carry output refs")
  const outputBytes = outputRefs.reduce((total, ref) => total + ref.bytes, 0)
  const withoutHash = {
    schema_version: AGENT_RUN_RESULT_SCHEMA,
    run_id: identifier(input.run_id, "run_id"),
    trace_id: identifier(input.trace_id, "trace_id"),
    request_hash: sha256(input.request_hash, "request_hash"),
    terminal_sequence: integer(input.terminal_sequence, 1, Number.MAX_SAFE_INTEGER, "terminal_sequence"),
    finished_at: canonicalTime(input.finished_at, "finished_at"),
    status,
    output_refs: outputRefs,
    usage: {
      wall_time_ms: integer(usageInput.wall_time_ms, 0, 7_200_000, "usage.wall_time_ms"),
      turns: integer(usageInput.turns, 0, 256, "usage.turns"),
      tool_calls: integer(usageInput.tool_calls, 0, 1_024, "usage.tool_calls"),
      input_bytes: integer(usageInput.input_bytes, 0, 64 * 1024 * 1024, "usage.input_bytes"),
      output_bytes: integer(usageInput.output_bytes, 0, 16 * 1024 * 1024, "usage.output_bytes"),
    },
    ...(failure == null ? {} : { failure }),
    domain_authority: "none" as const,
  }
  if (withoutHash.usage.output_bytes !== outputBytes) throw new Error("agent run result output byte accounting drifted")
  const resultHash = sha256(input.result_hash, "result_hash")
  if (canonicalHash(withoutHash) !== resultHash) throw new Error("agent run result_hash mismatch")
  return { ...withoutHash, result_hash: resultHash }
}

export function validateAgentRunCompletion(
  request: AgentRunRequest,
  events: AgentRunEvent[],
  result: AgentRunResult,
): void {
  const validated = validateAgentRunEventStream(request, events)
  const terminal = validated.at(-1)!
  if (result.run_id !== request.run_id || result.trace_id !== request.trace_id || result.request_hash !== request.request_hash) {
    throw new Error("agent run result identity drifted")
  }
  if (result.terminal_sequence !== terminal.sequence || result.status !== terminal.status) {
    throw new Error("agent run result does not match terminal event")
  }
  if (result.usage.wall_time_ms > request.budget.max_wall_time_ms
    || result.usage.turns > request.budget.max_turns
    || result.usage.tool_calls > request.budget.max_tool_calls
    || result.usage.input_bytes > request.budget.max_input_bytes
    || result.usage.output_bytes > request.budget.max_output_bytes) {
    throw new Error("agent run result exceeded request budget")
  }
}

function artifactRefs(value: unknown, field: string, maximum: number): AgentArtifactRef[] {
  if (!Array.isArray(value) || value.length > maximum) throw new Error(`${field} must be an array with at most ${maximum} items`)
  const refs = value.map((entry, index) => artifactRef(entry, `${field}[${index}]`))
  const keys = refs.map((entry) => `${entry.ref}:${entry.sha256}`)
  if (new Set(keys).size !== keys.length) throw new Error(`${field} contains duplicate refs`)
  return refs
}

function artifactRef(value: unknown, field: string): AgentArtifactRef {
  const input = record(value, field)
  exact(input, ["ref", "sha256", "media_type", "bytes"], field)
  return {
    ref: safeRef(input.ref, `${field}.ref`),
    sha256: sha256(input.sha256, `${field}.sha256`),
    media_type: oneOf(input.media_type, [
      "application/json", "text/markdown", "text/x-diff", "text/plain",
    ] as const, `${field}.media_type`),
    bytes: integer(input.bytes, 0, 16 * 1024 * 1024, `${field}.bytes`),
  }
}

function capabilityList(value: unknown, profile: AgentTaskProfile): AgentCapability[] {
  if (!Array.isArray(value) || value.length > 8) throw new Error("capabilities must be a bounded array")
  const capabilities = value.map((entry) => oneOf(entry, [
    "owner_read", "research_read", "workspace_read", "workspace_patch", "bounded_quality_check",
  ] as const, "capability"))
  if (new Set(capabilities).size !== capabilities.length) throw new Error("capabilities contain duplicates")
  const allowed = new Set(CAPABILITIES_BY_PROFILE[profile])
  if (capabilities.some((capability) => !allowed.has(capability))) {
    throw new Error(`task profile ${profile} does not allow requested capability`)
  }
  return capabilities
}

function compileFailure(value: unknown): NonNullable<AgentRunResult["failure"]> {
  const input = record(value, "failure")
  exact(input, ["class", "retryable", "effect_status"], "failure")
  const failureClass = requiredFailureClass(input.class)
  if (typeof input.retryable !== "boolean") throw new Error("failure.retryable must be boolean")
  const effectStatus = oneOf(input.effect_status, ["none", "known", "uncertain"] as const, "failure.effect_status")
  if (failureClass === "tool_effect_uncertain" && effectStatus !== "uncertain") {
    throw new Error("tool_effect_uncertain requires uncertain effect status")
  }
  if (effectStatus === "uncertain" && input.retryable) throw new Error("uncertain tool effect must not be retried automatically")
  return { class: failureClass, retryable: input.retryable, effect_status: effectStatus }
}

function optionalFailureClass(value: unknown): AgentRunFailureClass | undefined {
  return value == null ? undefined : requiredFailureClass(value)
}

function requiredFailureClass(value: unknown): AgentRunFailureClass {
  return oneOf(value, [
    "budget_exhausted", "cancelled", "capability_denied", "host_unavailable",
    "malformed_host_event", "provider_unavailable", "sandbox_failed",
    "tool_effect_uncertain", "validation_failed",
  ] as const, "failure_class")
}

function rejectSensitiveText(value: string, field: string): void {
  if (/(?:sk|pk|rk)[-_][A-Za-z0-9_-]{12,}/i.test(value)
    || /authorization\s*:\s*(?:bearer|basic)\s+\S+/i.test(value)
    || /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(value)
    || /\b(?:password|api[_-]?key|secret|token)\s*[:=]\s*\S+/i.test(value)) {
    throw new Error(`${field} contains secret-like material`)
  }
}

function safeRef(value: unknown, field: string): string {
  const result = boundedText(value, 1, 512, field).replaceAll("\\", "/")
  rejectSensitiveText(result, field)
  if (result.startsWith("/") || result.startsWith("file:") || result.split("/").includes("..")) {
    throw new Error(`${field} must be an opaque or repository-relative ref`)
  }
  return result
}

function revision(value: unknown): string {
  const result = boundedText(value, 1, 128, "source_revision")
  if (!/^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(result)) throw new Error("source_revision is invalid")
  return result
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${field} must be an object`)
  return value as Record<string, unknown>
}

function exact(value: Record<string, unknown>, allowed: string[], field: string): void {
  allowedAndRequired(value, allowed, allowed, field)
}

function allowedAndRequired(value: Record<string, unknown>, allowed: string[], required: string[], field: string): void {
  const keys = new Set(allowed)
  const unknown = Object.keys(value).filter((key) => !keys.has(key))
  const missing = required.filter((key) => !Object.hasOwn(value, key))
  if (unknown.length > 0) throw new Error(`${field} does not allow: ${unknown.sort().join(", ")}`)
  if (missing.length > 0) throw new Error(`${field} is missing: ${missing.join(", ")}`)
}

function boundedText(value: unknown, minimum: number, maximum: number, field: string): string {
  if (typeof value !== "string" || value.trim() !== value || value.length < minimum || value.length > maximum) {
    throw new Error(`${field} must be trimmed text from ${minimum} to ${maximum} characters`)
  }
  if (/[\0\r]/.test(value)) throw new Error(`${field} contains forbidden control characters`)
  return value
}

function identifier(value: unknown, field: string): string {
  const result = boundedText(value, 1, 160, field)
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(result)) throw new Error(`${field} is invalid`)
  return result
}

function sha256(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw new Error(`${field} must be lowercase SHA-256`)
  return value
}

function integer(value: unknown, minimum: number, maximum: number, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new Error(`${field} must be an integer from ${minimum} to ${maximum}`)
  }
  return Number(value)
}

function canonicalTime(value: unknown, field: string): string {
  const result = boundedText(value, 20, 32, field)
  const date = new Date(result)
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== result) throw new Error(`${field} must be canonical UTC`)
  return result
}

function oneOf<const T extends readonly string[]>(value: unknown, allowed: T, field: string): T[number] {
  if (typeof value !== "string" || !allowed.includes(value)) throw new Error(`${field} is unsupported`)
  return value as T[number]
}

function optionalOneOf<const T extends readonly string[]>(value: unknown, allowed: T, field: string): T[number] | undefined {
  return value == null ? undefined : oneOf(value, allowed, field)
}
