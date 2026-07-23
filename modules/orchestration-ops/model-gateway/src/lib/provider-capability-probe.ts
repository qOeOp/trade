import type { ModelGatewayProfile } from "./model-gateway"

export const PROVIDER_CAPABILITY_PROBE_SCHEMA = "trade.provider-capability-probe.v1" as const

type CheckStatus = "passed" | "failed"
type CheckReason =
  | "passed"
  | "http_error"
  | "malformed_response"
  | "semantic_mismatch"
  | "unsupported_endpoint"

export interface ProviderCapabilityCheck {
  status: CheckStatus
  reason: CheckReason
  http_status: number
}

export interface ProviderCapabilityProbe {
  schema_version: typeof PROVIDER_CAPABILITY_PROBE_SCHEMA
  observed_at: string
  provider: string
  model: string
  checks: {
    chat_json: ProviderCapabilityCheck
    chat_stream: ProviderCapabilityCheck
    single_tool_call: ProviderCapabilityCheck
    multi_tool_call: ProviderCapabilityCheck
    tool_continuation: ProviderCapabilityCheck
    responses_wire: ProviderCapabilityCheck
  }
  chat_agent_wire_compatible: boolean
  responses_agent_wire_compatible: boolean
  raw_payload_persisted: false
}

const JSON_MARKER = "trade-provider-json-ok"
const STREAM_MARKER = "trade-provider-stream-ok"
const CONTINUATION_MARKER = "trade-provider-continuation-ok"

export async function runProviderCapabilityProbe(
  profile: ModelGatewayProfile,
  dependencies: {
    api_key?: string
    fetcher?: typeof fetch
    observed_at?: string
  } = {},
): Promise<ProviderCapabilityProbe> {
  const apiKey = dependencies.api_key ?? process.env[profile.api_key_env]
  if (!apiKey) throw new Error(`missing provider credential: ${profile.api_key_env}`)
  const fetcher = dependencies.fetcher ?? fetch
  const observedAt = dependencies.observed_at ?? new Date().toISOString()
  if (new Date(observedAt).toISOString() !== observedAt) throw new Error("observed_at must be canonical UTC")
  const chatUrl = `${profile.base_url}/chat/completions`
  const headers = { authorization: `Bearer ${apiKey}`, "content-type": "application/json" }
  const common = { model: profile.model, enable_thinking: false }

  const chatJson = await jsonCheck(fetcher, chatUrl, headers, {
    ...common,
    messages: [{ role: "user", content: `Return exactly this text: ${JSON_MARKER}` }],
    max_tokens: 64,
  }, (body) => assistantText(body) === JSON_MARKER)

  const chatStream = await streamCheck(fetcher, chatUrl, headers, {
    ...common,
    messages: [{ role: "user", content: `Return exactly this text: ${STREAM_MARKER}` }],
    max_tokens: 64,
    stream: true,
  })

  const tools = [
    tool("marker_one", "Return marker one."),
    tool("marker_two", "Return marker two."),
  ]
  const single = await toolCheck(fetcher, chatUrl, headers, {
    ...common,
    messages: [{ role: "user", content: "Call marker_one exactly once. Do not answer with prose." }],
    tools: [tools[0]],
    tool_choice: { type: "function", function: { name: "marker_one" } },
    max_tokens: 128,
  }, ["marker_one"])

  const multi = await toolCheck(fetcher, chatUrl, headers, {
    ...common,
    messages: [{ role: "user", content: "Call marker_one and marker_two exactly once each in this response. Do not answer with prose." }],
    tools,
    tool_choice: "auto",
    max_tokens: 256,
  }, ["marker_one", "marker_two"])

  const continuation = await continuationCheck(fetcher, chatUrl, headers, common, tools[0])
  const responses = await jsonCheck(fetcher, `${profile.base_url}/responses`, headers, {
    model: profile.model,
    input: "Return exactly OK.",
    max_output_tokens: 16,
  }, () => true, true)
  const checks = {
    chat_json: chatJson,
    chat_stream: chatStream,
    single_tool_call: single,
    multi_tool_call: multi,
    tool_continuation: continuation,
    responses_wire: responses,
  }
  return {
    schema_version: PROVIDER_CAPABILITY_PROBE_SCHEMA,
    observed_at: observedAt,
    provider: profile.provider,
    model: profile.model,
    checks,
    chat_agent_wire_compatible: [chatJson, chatStream, single, multi, continuation].every((check) => check.status === "passed"),
    responses_agent_wire_compatible: responses.status === "passed",
    raw_payload_persisted: false,
  }
}

async function continuationCheck(
  fetcher: typeof fetch,
  url: string,
  headers: Record<string, string>,
  common: Record<string, unknown>,
  markerTool: Record<string, unknown>,
): Promise<ProviderCapabilityCheck> {
  const firstResponse = await fetcher(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      ...common,
      messages: [{
        role: "user",
        content: `Call marker_one. After its result, reply exactly ${CONTINUATION_MARKER}.`,
      }],
      tools: [markerTool],
      tool_choice: { type: "function", function: { name: "marker_one" } },
      max_tokens: 128,
    }),
  })
  if (!firstResponse.ok) return httpFailure(firstResponse.status)
  const first = await safeJson(firstResponse)
  const calls = toolCalls(first)
  if (calls.length !== 1 || calls[0]!.function.name !== "marker_one") return failed("semantic_mismatch", firstResponse.status)
  const secondResponse = await fetcher(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      ...common,
      messages: [
        { role: "user", content: `Call marker_one. After its result, reply exactly ${CONTINUATION_MARKER}.` },
        { role: "assistant", content: null, tool_calls: calls },
        { role: "tool", tool_call_id: calls[0]!.id, content: "{\"ok\":true}" },
      ],
      tools: [markerTool],
      tool_choice: "none",
      max_tokens: 128,
    }),
  })
  if (!secondResponse.ok) return httpFailure(secondResponse.status)
  const second = await safeJson(secondResponse)
  if (second == null) return failed("malformed_response", secondResponse.status)
  return assistantText(second) === CONTINUATION_MARKER
    ? passed(secondResponse.status)
    : failed("semantic_mismatch", secondResponse.status)
}

async function jsonCheck(
  fetcher: typeof fetch,
  url: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
  validate: (body: unknown) => boolean,
  unsupported404 = false,
): Promise<ProviderCapabilityCheck> {
  const response = await fetcher(url, { method: "POST", headers, body: JSON.stringify(body) })
  if (!response.ok) {
    if (unsupported404 && response.status === 404) return failed("unsupported_endpoint", response.status)
    return httpFailure(response.status)
  }
  const parsed = await safeJson(response)
  if (parsed == null) return failed("malformed_response", response.status)
  return validate(parsed) ? passed(response.status) : failed("semantic_mismatch", response.status)
}

async function streamCheck(
  fetcher: typeof fetch,
  url: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
): Promise<ProviderCapabilityCheck> {
  const response = await fetcher(url, { method: "POST", headers, body: JSON.stringify(body) })
  if (!response.ok) return httpFailure(response.status)
  const wire = await response.text()
  let content = ""
  let done = false
  try {
    for (const line of wire.split(/\r?\n/)) {
      if (!line.startsWith("data:")) continue
      const data = line.slice(5).trim()
      if (data === "[DONE]") {
        done = true
        continue
      }
      const chunk = JSON.parse(data) as Record<string, unknown>
      const choices = Array.isArray(chunk.choices) ? chunk.choices : []
      const delta = choices[0] && typeof choices[0] === "object"
        ? (choices[0] as Record<string, unknown>).delta : null
      if (delta && typeof delta === "object" && typeof (delta as Record<string, unknown>).content === "string") {
        content += String((delta as Record<string, unknown>).content)
      }
    }
  } catch {
    return failed("malformed_response", response.status)
  }
  return done && content === STREAM_MARKER ? passed(response.status) : failed("semantic_mismatch", response.status)
}

async function toolCheck(
  fetcher: typeof fetch,
  url: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
  expectedNames: string[],
): Promise<ProviderCapabilityCheck> {
  const response = await fetcher(url, { method: "POST", headers, body: JSON.stringify(body) })
  if (!response.ok) return httpFailure(response.status)
  const parsed = await safeJson(response)
  if (parsed == null) return failed("malformed_response", response.status)
  const calls = toolCalls(parsed)
  const names = calls.map((call) => call.function.name).sort()
  const expected = [...expectedNames].sort()
  if (JSON.stringify(names) !== JSON.stringify(expected)) return failed("semantic_mismatch", response.status)
  try {
    for (const call of calls) JSON.parse(call.function.arguments)
  } catch {
    return failed("malformed_response", response.status)
  }
  return passed(response.status)
}

function tool(name: string, description: string): Record<string, unknown> {
  return {
    type: "function",
    function: {
      name,
      description,
      parameters: {
        type: "object",
        properties: { marker: { type: "string" } },
        required: ["marker"],
        additionalProperties: false,
      },
    },
  }
}

function assistantText(value: unknown): string {
  const message = firstMessage(value)
  return typeof message?.content === "string" ? message.content.trim() : ""
}

function toolCalls(value: unknown): Array<{ id: string; type: "function"; function: { name: string; arguments: string } }> {
  const message = firstMessage(value)
  if (!message || !Array.isArray(message.tool_calls)) return []
  const result: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }> = []
  for (const entry of message.tool_calls) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return []
    const call = entry as Record<string, unknown>
    const fn = call.function
    if (typeof call.id !== "string" || call.type !== "function" || !fn || typeof fn !== "object" || Array.isArray(fn)) return []
    const functionCall = fn as Record<string, unknown>
    if (typeof functionCall.name !== "string" || typeof functionCall.arguments !== "string") return []
    result.push({ id: call.id, type: "function", function: { name: functionCall.name, arguments: functionCall.arguments } })
  }
  return result
}

function firstMessage(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const choices = (value as Record<string, unknown>).choices
  if (!Array.isArray(choices) || !choices[0] || typeof choices[0] !== "object" || Array.isArray(choices[0])) return null
  const message = (choices[0] as Record<string, unknown>).message
  return message && typeof message === "object" && !Array.isArray(message) ? message as Record<string, unknown> : null
}

async function safeJson(response: Response): Promise<unknown | null> {
  try {
    return await response.json()
  } catch {
    return null
  }
}

function passed(httpStatus: number): ProviderCapabilityCheck {
  return { status: "passed", reason: "passed", http_status: httpStatus }
}

function failed(reason: CheckReason, httpStatus: number): ProviderCapabilityCheck {
  return { status: "failed", reason, http_status: httpStatus }
}

function httpFailure(httpStatus: number): ProviderCapabilityCheck {
  return failed("http_error", httpStatus)
}
