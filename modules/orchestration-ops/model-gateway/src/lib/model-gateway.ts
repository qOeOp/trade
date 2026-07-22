import { canonicalHash } from "../../../../contracts/runtime-core/src/canonical-json"
import {
  compileModelTaskRequest,
  type ModelTaskRequest,
  type ModelTaskResult,
} from "../../../../contracts/model-task-contract/src/model-task-contract"

export interface ModelGatewayProfile {
  schema_version: "trade.model-gateway-profile.v1"
  provider: "siliconflow"
  base_url: "https://api.siliconflow.com/v1"
  model: string
  capabilities: ["json_object"]
  api_key_env: "SILICONFLOW_API_KEY"
}

interface GatewayDependencies {
  fetch: Fetcher
  apiKey: string
}

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export async function runModelTask(
  requestValue: unknown,
  profileValue: unknown,
  dependencies: Partial<GatewayDependencies> = {},
): Promise<ModelTaskResult> {
  const request = compileModelTaskRequest(requestValue)
  const profile = compileProfile(profileValue)
  const apiKey = dependencies.apiKey ?? process.env[profile.api_key_env] ?? ""
  if (!apiKey) return failure(request, profile, 0, "credential_unavailable", false)
  const fetcher = dependencies.fetch ?? fetch
  let attempts = 0
  while (attempts < request.budget.max_attempts) {
    attempts += 1
    let response: Response
    try {
      response = await fetchWithTimeout(fetcher, `${profile.base_url}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: profile.model,
          messages: [
            { role: "system", content: request.prompt.system },
            { role: "user", content: request.prompt.user },
          ],
          stream: false,
          max_tokens: request.budget.max_output_tokens,
          response_format: { type: "json_object" },
        }),
      }, request.budget.timeout_ms)
    } catch {
      if (attempts < request.budget.max_attempts) continue
      return failure(request, profile, attempts, "provider_network_or_timeout", true)
    }
    if (!response.ok) {
      const retryable = [429, 503, 504].includes(response.status)
      if (retryable && attempts < request.budget.max_attempts) continue
      return failure(request, profile, attempts, `provider_http_${response.status}`, retryable)
    }
    let envelope: unknown
    try {
      envelope = await response.json()
    } catch {
      return failure(request, profile, attempts, "provider_envelope_invalid_json", false)
    }
    const decoded = decodeResponse(envelope)
    if (!decoded) return failure(request, profile, attempts, "provider_response_shape_invalid", false)
    if (decoded.finishReason === "length") return failure(request, profile, attempts, "provider_output_truncated", false)
    if (decoded.usage.total_tokens > request.budget.max_total_tokens) {
      return failure(request, profile, attempts, "total_token_budget_exceeded", false, decoded.usage)
    }
    let output: unknown
    try {
      output = JSON.parse(decoded.content)
    } catch {
      return failure(request, profile, attempts, "model_output_invalid_json", false, decoded.usage)
    }
    if (!output || typeof output !== "object" || Array.isArray(output)) {
      return failure(request, profile, attempts, "model_output_not_object", false, decoded.usage)
    }
    const parsedOutput = output as Record<string, unknown>
    const outputHash = canonicalHash(parsedOutput)
    return {
      schema_version: "trade.model-task-result.v1",
      task_id: request.task_id,
      trace_id: request.trace_id,
      request_hash: request.request_hash,
      status: "completed",
      attempts,
      provider: profile.provider,
      model: decoded.model || profile.model,
      usage: decoded.usage,
      output: parsedOutput,
      output_hash: outputHash,
      raw_response_ref: `model-response:${canonicalHash({ id: decoded.id, model: decoded.model, usage: decoded.usage, output_hash: outputHash })}`,
      execution_authority: "none",
    }
  }
  return failure(request, profile, attempts, "attempt_budget_exhausted", true)
}

export function compileProfile(value: unknown): ModelGatewayProfile {
  const input = record(value)
  exact(input, ["schema_version", "provider", "base_url", "model", "capabilities", "api_key_env"])
  if (input.schema_version !== "trade.model-gateway-profile.v1" || input.provider !== "siliconflow") throw new Error("model gateway profile is unsupported")
  if (input.base_url !== "https://api.siliconflow.com/v1") throw new Error("model gateway base_url is unsupported")
  if (input.api_key_env !== "SILICONFLOW_API_KEY") throw new Error("model gateway secret binding is unsupported")
  if (!Array.isArray(input.capabilities) || input.capabilities.length !== 1 || input.capabilities[0] !== "json_object") {
    throw new Error("model gateway capability registry is unsupported")
  }
  const model = text(input.model, "model")
  return {
    schema_version: "trade.model-gateway-profile.v1",
    provider: "siliconflow",
    base_url: "https://api.siliconflow.com/v1",
    model,
    capabilities: ["json_object"],
    api_key_env: "SILICONFLOW_API_KEY",
  }
}

async function fetchWithTimeout(fetcher: Fetcher, url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetcher(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

function decodeResponse(value: unknown): null | {
  id: string; model: string; content: string; finishReason: string
  usage: ModelTaskResult["usage"]
} {
  const input = recordOrEmpty(value)
  const choices = Array.isArray(input.choices) ? input.choices : []
  const choice = recordOrEmpty(choices[0])
  const message = recordOrEmpty(choice.message)
  const usage = recordOrEmpty(input.usage)
  const content = typeof message.content === "string" ? message.content : ""
  const promptTokens = nonNegative(usage.prompt_tokens)
  const completionTokens = nonNegative(usage.completion_tokens)
  const totalTokens = nonNegative(usage.total_tokens)
  if (!content || promptTokens < 0 || completionTokens < 0 || totalTokens < 0 || totalTokens < promptTokens + completionTokens) return null
  return {
    id: typeof input.id === "string" ? input.id : "",
    model: typeof input.model === "string" ? input.model : "",
    content,
    finishReason: typeof choice.finish_reason === "string" ? choice.finish_reason : "",
    usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: totalTokens },
  }
}

function failure(
  request: ModelTaskRequest,
  profile: ModelGatewayProfile,
  attempts: number,
  code: string,
  retryable: boolean,
  usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
): ModelTaskResult {
  return {
    schema_version: "trade.model-task-result.v1",
    task_id: request.task_id,
    trace_id: request.trace_id,
    request_hash: request.request_hash,
    status: retryable ? "retryable" : "blocked",
    attempts,
    provider: profile.provider,
    model: profile.model,
    usage,
    failure: { code, retryable },
    execution_authority: "none",
  }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("model gateway profile must be an object")
  return value as Record<string, unknown>
}
function recordOrEmpty(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {} }
function exact(value: Record<string, unknown>, keys: string[]): void {
  const allowed = new Set(keys)
  const unknown = Object.keys(value).filter((key) => !allowed.has(key))
  const missing = keys.filter((key) => !Object.hasOwn(value, key))
  if (unknown.length || missing.length) throw new Error(`model gateway profile shape is invalid: unknown=${unknown.join(",")} missing=${missing.join(",")}`)
}
function text(value: unknown, field: string): string {
  if (typeof value !== "string" || !value || value.trim() !== value || value.length > 256) throw new Error(`${field} is invalid`)
  return value
}
function nonNegative(value: unknown): number { return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : -1 }
