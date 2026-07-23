import type {
  OpenClawExecutionRequest,
  OpenClawExecutionResult,
} from "./openclaw-agent-run"

const MAX_GATEWAY_RESPONSE_BYTES = 16 * 1024 * 1024

export type OpenClawGatewayFetch = (
  input: string,
  init: {
    method: "POST"
    headers: Record<string, string>
    body: string
    signal: AbortSignal
  },
) => Promise<Response>

export async function executeOpenClawGatewayHttp(input: {
  gateway_url: string
  gateway_token: string
  request: OpenClawExecutionRequest
  signal: AbortSignal
  fetch?: OpenClawGatewayFetch
}): Promise<OpenClawExecutionResult> {
  if (input.request.transport !== "gateway") {
    throw new Error("OpenClaw Gateway HTTP executor requires gateway transport")
  }
  const url = endpoint(input.gateway_url)
  const tokenBytes = Buffer.byteLength(input.gateway_token)
  if (tokenBytes < 32 || tokenBytes > 512) {
    throw new Error("OpenClaw Gateway token length is invalid")
  }
  try {
    const gatewayFetch: OpenClawGatewayFetch = input.fetch
      ?? ((target, init) => fetch(target, init))
    const response = await gatewayFetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${input.gateway_token}`,
        "content-type": "application/json",
        "x-openclaw-agent-id": input.request.agent_id,
        "x-openclaw-session-key": input.request.run_id,
      },
      body: JSON.stringify({
        model: `openclaw/${input.request.agent_id}`,
        input: input.request.message,
        stream: false,
      }),
      signal: input.signal,
    })
    const body = await readBounded(response)
    if (!response.ok) {
      return {
        exit_code: 1,
        stdout: "",
        stderr: `OpenClaw Gateway HTTP ${response.status}: ${errorType(body)}`,
        interrupted: input.signal.aborted,
      }
    }
    const parsed = JSON.parse(body) as Record<string, unknown>
    const text = visibleOutputText(parsed)
    return {
      exit_code: 0,
      stdout: JSON.stringify({
        runId: opaqueId(parsed.id) ?? input.request.run_id,
        status: "ok",
        result: {
          payloads: [{ text }],
          meta: {
            transport: "gateway",
            fallbackFrom: null,
          },
        },
      }),
      stderr: "",
      interrupted: false,
    }
  } catch (error) {
    if (input.signal.aborted) {
      return { exit_code: 143, stdout: "", stderr: "", interrupted: true }
    }
    return {
      exit_code: 1,
      stdout: "",
      stderr: error instanceof Error
        ? `OpenClaw Gateway request failed: ${error.name}`
        : "OpenClaw Gateway request failed",
      interrupted: false,
    }
  }
}

function endpoint(value: string): string {
  const url = new URL(value)
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("OpenClaw Gateway URL must use HTTP(S)")
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("OpenClaw Gateway URL must not contain credentials or query state")
  }
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/v1/responses`
  return url.toString()
}

async function readBounded(response: Response): Promise<string> {
  const declared = Number(response.headers.get("content-length") ?? 0)
  if (Number.isFinite(declared) && declared > MAX_GATEWAY_RESPONSE_BYTES) {
    throw new Error("OpenClaw Gateway response exceeded byte limit")
  }
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.byteLength > MAX_GATEWAY_RESPONSE_BYTES) {
    throw new Error("OpenClaw Gateway response exceeded byte limit")
  }
  return bytes.toString("utf8")
}

function visibleOutputText(value: Record<string, unknown>): string {
  if (typeof value.output_text === "string" && value.output_text.trim()) {
    return value.output_text
  }
  if (!Array.isArray(value.output)) {
    throw new Error("OpenClaw Gateway response omitted output")
  }
  const parts: string[] = []
  for (const item of value.output) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue
    const content = (item as Record<string, unknown>).content
    if (!Array.isArray(content)) continue
    for (const part of content) {
      if (!part || typeof part !== "object" || Array.isArray(part)) continue
      const record = part as Record<string, unknown>
      if ((record.type === "output_text" || record.type === "text")
        && typeof record.text === "string" && record.text.trim()) {
        parts.push(record.text)
      }
    }
  }
  if (parts.length !== 1) {
    throw new Error("OpenClaw Gateway response requires exactly one visible output")
  }
  return parts[0]!
}

function errorType(body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: { type?: unknown } }
    return typeof parsed.error?.type === "string"
      ? parsed.error.type.slice(0, 100)
      : "request_failed"
  } catch {
    return "request_failed"
  }
}

function opaqueId(value: unknown): string | null {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value)
    ? value
    : null
}
