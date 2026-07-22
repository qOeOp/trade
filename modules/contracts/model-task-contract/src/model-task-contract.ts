import { canonicalHash } from "../../runtime-core/src/canonical-json"

export const MODEL_TASK_REQUEST_SCHEMA = "trade.model-task-request.v1" as const
export const MODEL_TASK_RESULT_SCHEMA = "trade.model-task-result.v1" as const

export interface ModelTaskRequest {
  schema_version: typeof MODEL_TASK_REQUEST_SCHEMA
  task_id: string
  task_type: "research_hypothesis"
  idempotency_key: string
  trace_id: string
  input_refs: string[]
  prompt_version: string
  output_schema_version: string
  prompt: { system: string; user: string }
  provider_policy: { capability: "json_object" }
  budget: {
    timeout_ms: number
    max_attempts: number
    max_input_chars: number
    max_output_tokens: number
    max_total_tokens: number
  }
  data_classification: "public" | "project_internal"
  request_hash: string
}

export interface ModelTaskResult {
  schema_version: typeof MODEL_TASK_RESULT_SCHEMA
  task_id: string
  trace_id: string
  request_hash: string
  status: "completed" | "blocked" | "retryable"
  attempts: number
  provider: string
  model: string
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
  output?: Record<string, unknown>
  output_hash?: string
  raw_response_ref?: string
  failure?: { code: string; retryable: boolean }
  execution_authority: "none"
}

export function compileModelTaskRequest(value: unknown): ModelTaskRequest {
  const input = record(value, "model_task")
  exact(input, [
    "schema_version", "task_id", "task_type", "idempotency_key", "trace_id", "input_refs",
    "prompt_version", "output_schema_version", "prompt", "provider_policy", "budget",
    "data_classification", "request_hash",
  ], "model_task")
  if (input.schema_version !== MODEL_TASK_REQUEST_SCHEMA) throw new Error("model task schema is unsupported")
  if (input.task_type !== "research_hypothesis") throw new Error("model task type is unsupported")
  if (input.data_classification !== "public" && input.data_classification !== "project_internal") {
    throw new Error("model task data classification is unsupported")
  }
  const promptInput = record(input.prompt, "prompt")
  exact(promptInput, ["system", "user"], "prompt")
  const prompt = {
    system: boundedText(promptInput.system, 1, 8_000, "prompt.system"),
    user: boundedText(promptInput.user, 1, 80_000, "prompt.user"),
  }
  rejectSecretLikeText(`${prompt.system}\n${prompt.user}`)
  const policyInput = record(input.provider_policy, "provider_policy")
  exact(policyInput, ["capability"], "provider_policy")
  if (policyInput.capability !== "json_object") throw new Error("provider capability must be json_object")
  const budgetInput = record(input.budget, "budget")
  exact(budgetInput, ["timeout_ms", "max_attempts", "max_input_chars", "max_output_tokens", "max_total_tokens"], "budget")
  const inputChars = prompt.system.length + prompt.user.length
  const withoutHash = {
    schema_version: MODEL_TASK_REQUEST_SCHEMA,
    task_id: identifier(input.task_id, "task_id"),
    task_type: "research_hypothesis" as const,
    idempotency_key: identifier(input.idempotency_key, "idempotency_key"),
    trace_id: identifier(input.trace_id, "trace_id"),
    input_refs: stringArray(input.input_refs, "input_refs"),
    prompt_version: identifier(input.prompt_version, "prompt_version"),
    output_schema_version: identifier(input.output_schema_version, "output_schema_version"),
    prompt,
    provider_policy: { capability: "json_object" as const },
    budget: {
      timeout_ms: integer(budgetInput.timeout_ms, 1_000, 120_000, "budget.timeout_ms"),
      max_attempts: integer(budgetInput.max_attempts, 1, 3, "budget.max_attempts"),
      max_input_chars: integer(budgetInput.max_input_chars, 1, 100_000, "budget.max_input_chars"),
      max_output_tokens: integer(budgetInput.max_output_tokens, 64, 16_384, "budget.max_output_tokens"),
      max_total_tokens: integer(budgetInput.max_total_tokens, 128, 200_000, "budget.max_total_tokens"),
    },
    data_classification: input.data_classification as ModelTaskRequest["data_classification"],
  }
  if (inputChars > withoutHash.budget.max_input_chars) throw new Error("model task input character budget exceeded")
  const expectedHash = canonicalHash(withoutHash)
  if (text(input.request_hash, "request_hash") !== expectedHash) throw new Error("model task request_hash mismatch")
  return { ...withoutHash, request_hash: expectedHash }
}

export function buildModelTaskRequest(value: Omit<ModelTaskRequest, "schema_version" | "request_hash">): ModelTaskRequest {
  const candidate = { schema_version: MODEL_TASK_REQUEST_SCHEMA, ...value }
  return compileModelTaskRequest({ ...candidate, request_hash: canonicalHash(candidate) })
}

export function compileModelTaskResult(value: unknown): ModelTaskResult {
  const input = record(value, "model_task_result")
  const required = [
    "schema_version", "task_id", "trace_id", "request_hash", "status", "attempts",
    "provider", "model", "usage", "execution_authority",
  ]
  allowedAndRequired(input, [...required, "output", "output_hash", "raw_response_ref", "failure"], required, "model_task_result")
  if (input.schema_version !== MODEL_TASK_RESULT_SCHEMA) throw new Error("model task result schema is unsupported")
  if (input.status !== "completed" && input.status !== "blocked" && input.status !== "retryable") {
    throw new Error("model task result status is unsupported")
  }
  if (input.execution_authority !== "none") throw new Error("model task result must not grant execution authority")
  const usageInput = record(input.usage, "usage")
  exact(usageInput, ["prompt_tokens", "completion_tokens", "total_tokens"], "usage")
  const usage = {
    prompt_tokens: integer(usageInput.prompt_tokens, 0, 200_000, "usage.prompt_tokens"),
    completion_tokens: integer(usageInput.completion_tokens, 0, 200_000, "usage.completion_tokens"),
    total_tokens: integer(usageInput.total_tokens, 0, 200_000, "usage.total_tokens"),
  }
  if (usage.total_tokens < usage.prompt_tokens + usage.completion_tokens) throw new Error("model task result usage is inconsistent")
  const common = {
    schema_version: MODEL_TASK_RESULT_SCHEMA,
    task_id: identifier(input.task_id, "task_id"),
    trace_id: identifier(input.trace_id, "trace_id"),
    request_hash: sha256(input.request_hash, "request_hash"),
    status: input.status as ModelTaskResult["status"],
    attempts: integer(input.attempts, 0, 3, "attempts"),
    provider: boundedText(input.provider, 1, 128, "provider"),
    model: boundedText(input.model, 1, 256, "model"),
    usage,
    execution_authority: "none" as const,
  }
  if (common.status === "completed") {
    if (!Object.hasOwn(input, "output") || !Object.hasOwn(input, "output_hash")) throw new Error("completed model task result requires output and output_hash")
    if (Object.hasOwn(input, "failure")) throw new Error("completed model task result must not carry failure")
    const output = record(input.output, "output")
    const outputHash = sha256(input.output_hash, "output_hash")
    if (canonicalHash(output) !== outputHash) throw new Error("model task result output_hash mismatch")
    return {
      ...common,
      output,
      output_hash: outputHash,
      ...(Object.hasOwn(input, "raw_response_ref") ? { raw_response_ref: boundedText(input.raw_response_ref, 1, 512, "raw_response_ref") } : {}),
    }
  }
  if (Object.hasOwn(input, "output") || Object.hasOwn(input, "output_hash") || Object.hasOwn(input, "raw_response_ref")) {
    throw new Error("failed model task result must not carry output")
  }
  if (!Object.hasOwn(input, "failure")) throw new Error("failed model task result requires failure")
  const failureInput = record(input.failure, "failure")
  exact(failureInput, ["code", "retryable"], "failure")
  const retryable = failureInput.retryable
  if (typeof retryable !== "boolean" || retryable !== (common.status === "retryable")) throw new Error("model task failure retryability is inconsistent")
  return { ...common, failure: { code: identifier(failureInput.code, "failure.code"), retryable } }
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${field} must be an object`)
  return value as Record<string, unknown>
}

function exact(value: Record<string, unknown>, keys: string[], field: string): void {
  const allowed = new Set(keys)
  const unknown = Object.keys(value).filter((key) => !allowed.has(key))
  const missing = keys.filter((key) => !Object.hasOwn(value, key))
  if (unknown.length) throw new Error(`${field} does not allow: ${unknown.sort().join(", ")}`)
  if (missing.length) throw new Error(`${field} is missing: ${missing.join(", ")}`)
}

function allowedAndRequired(value: Record<string, unknown>, allowedKeys: string[], requiredKeys: string[], field: string): void {
  const allowed = new Set(allowedKeys)
  const unknown = Object.keys(value).filter((key) => !allowed.has(key))
  const missing = requiredKeys.filter((key) => !Object.hasOwn(value, key))
  if (unknown.length) throw new Error(`${field} does not allow: ${unknown.sort().join(", ")}`)
  if (missing.length) throw new Error(`${field} is missing: ${missing.join(", ")}`)
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || !value || value.trim() !== value || /[\0]/.test(value)) throw new Error(`${field} must be a non-empty trimmed string`)
  return value
}

function boundedText(value: unknown, min: number, max: number, field: string): string {
  const result = text(value, field)
  if (result.length < min || result.length > max) throw new Error(`${field} length is out of bounds`)
  return result
}

function identifier(value: unknown, field: string): string {
  const result = text(value, field)
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(result)) throw new Error(`${field} is invalid`)
  return result
}

function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 32) throw new Error(`${field} must be a bounded non-empty array`)
  const result = value.map((item) => boundedText(item, 1, 512, field))
  if (new Set(result).size !== result.length) throw new Error(`${field} must not contain duplicates`)
  return result
}

function integer(value: unknown, min: number, max: number, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max) throw new Error(`${field} must be an integer from ${min} to ${max}`)
  return Number(value)
}

function sha256(value: unknown, field: string): string {
  const result = text(value, field)
  if (!/^[a-f0-9]{64}$/.test(result)) throw new Error(`${field} must be a SHA-256 hex digest`)
  return result
}

function rejectSecretLikeText(value: string): void {
  const patterns = [/authorization\s*:\s*bearer/i, /SILICONFLOW_API_KEY\s*=/i, /sk-[A-Za-z0-9_-]{12,}/]
  if (patterns.some((pattern) => pattern.test(value))) throw new Error("model task prompt contains secret-like material")
}
