import {
  compileAgentRunEvent,
  compileAgentRunResult,
  type AgentRunRequest,
} from "../../../../../contracts/agent-run-contract/src/agent-run-contract"
import {
  validateAgentRunAcceptance,
  validateAgentRunStatus,
  type AgentHostPort,
  type AgentRunApproval,
  type AgentRunSteer,
} from "../../../../../contracts/agent-run-contract/src/agent-host-port"

export type AgentHostFetch = (
  input: string,
  init: {
    method?: "GET" | "POST"
    headers: Record<string, string>
    body?: string
    signal: AbortSignal
  },
) => Promise<Response>

export class AgentHostHttpClient implements AgentHostPort {
  private readonly baseUrl: string
  private readonly token: string
  private readonly timeoutMs: number
  private readonly fetch: AgentHostFetch

  constructor(input: {
    base_url: string
    bearer_token: string
    timeout_ms?: number
    fetch?: AgentHostFetch
  }) {
    const url = new URL(input.base_url)
    if (!["http:", "https:"].includes(url.protocol)
      || url.username || url.password || url.search || url.hash) {
      throw new Error("Agent Host URL is invalid")
    }
    this.baseUrl = url.toString().replace(/\/+$/, "")
    const tokenBytes = Buffer.byteLength(input.bearer_token)
    if (tokenBytes < 32 || tokenBytes > 512) {
      throw new Error("Agent Host bearer token is invalid")
    }
    this.token = input.bearer_token
    this.timeoutMs = input.timeout_ms ?? 10_000
    if (!Number.isSafeInteger(this.timeoutMs)
      || this.timeoutMs < 100
      || this.timeoutMs > 120_000) {
      throw new Error("Agent Host client timeout is invalid")
    }
    this.fetch = input.fetch ?? ((target, init) => fetch(target, init))
  }

  async submit(request: AgentRunRequest) {
    return validateAgentRunAcceptance(
      request,
      await this.call("/v1/agent-runs", {
        method: "POST",
        body: JSON.stringify(request),
      }) as Awaited<ReturnType<AgentHostPort["submit"]>>,
    )
  }

  async events(runId: string, afterSequence: number, limit: number) {
    const id = identifier(runId)
    const response = await this.call(
      `/v1/agent-runs/${id}/events?after_sequence=${afterSequence}&limit=${limit}`,
    ) as { events?: unknown }
    if (!Array.isArray(response.events)) throw new Error("Agent Host events response is invalid")
    return response.events.map(compileAgentRunEvent)
  }

  async status(runId: string) {
    return validateAgentRunStatus(await this.call(
      `/v1/agent-runs/${identifier(runId)}/status`,
    ) as Awaited<ReturnType<AgentHostPort["status"]>>)
  }

  async steer(_input: AgentRunSteer): Promise<void> {
    throw new Error("Agent Host HTTP client does not expose steering")
  }

  async approve(_input: AgentRunApproval): Promise<void> {
    throw new Error("Agent Host HTTP client does not expose approvals")
  }

  async cancel(runId: string, requestHash: string): Promise<void> {
    await this.call(`/v1/agent-runs/${identifier(runId)}/cancel`, {
      method: "POST",
      body: JSON.stringify({ request_hash: requestHash }),
    })
  }

  async result(runId: string) {
    try {
      return compileAgentRunResult(await this.call(
        `/v1/agent-runs/${identifier(runId)}/result`,
      ))
    } catch (error) {
      if (error instanceof AgentHostHttpError
        && error.status === 404
        && error.code === "result_not_ready") {
        return null
      }
      throw error
    }
  }

  private async call(
    path: string,
    input: { method?: "GET" | "POST"; body?: string } = {},
  ): Promise<unknown> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const response = await this.fetch(`${this.baseUrl}${path}`, {
        method: input.method ?? "GET",
        headers: {
          authorization: `Bearer ${this.token}`,
          ...(input.body == null ? {} : { "content-type": "application/json" }),
        },
        ...(input.body == null ? {} : { body: input.body }),
        signal: controller.signal,
      })
      const body = await boundedJson(response)
      if (!response.ok) {
        const code = errorCode(body)
        throw new AgentHostHttpError(response.status, code)
      }
      return body
    } catch (error) {
      if (controller.signal.aborted) {
        throw new AgentHostHttpError(504, "host_timeout")
      }
      throw error
    } finally {
      clearTimeout(timer)
    }
  }
}

class AgentHostHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`Agent Host HTTP ${status}: ${code}`)
  }
}

async function boundedJson(response: Response): Promise<unknown> {
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.byteLength > 16 * 1024 * 1024) {
    throw new Error("Agent Host response exceeded byte limit")
  }
  return JSON.parse(bytes.toString("utf8"))
}

function errorCode(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "request_failed"
  const error = (value as Record<string, unknown>).error
  if (!error || typeof error !== "object" || Array.isArray(error)) return "request_failed"
  const code = (error as Record<string, unknown>).code
  return typeof code === "string" && /^[a-z][a-z0-9_]{0,99}$/.test(code)
    ? code
    : "request_failed"
}

function identifier(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value)) {
    throw new Error("Agent Run id is invalid")
  }
  return encodeURIComponent(value)
}
