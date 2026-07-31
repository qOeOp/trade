import { timingSafeEqual } from "node:crypto"
import type { AgentRunRequest } from "../../../../contracts/agent-run-contract/src/agent-run-contract"
import type { AgentHostPort } from "../../../../contracts/agent-run-contract/src/agent-host-port"

export interface AgentHostHttpServerOptions {
  hostname: string
  port: number
  bearer_token: string
  allowed_hosts: string[]
  host: AgentHostPort
  max_body_bytes?: number
  requests_per_minute?: number
}

export interface RunningAgentHostHttpServer {
  hostname: string
  port: number
  url: string
  stop(): Promise<void>
}

export function startAgentHostHttpServer(
  options: AgentHostHttpServerOptions,
): RunningAgentHostHttpServer {
  validateOptions(options)
  const bodyLimit = options.max_body_bytes ?? 2 * 1024 * 1024
  const limiter = new FixedWindowLimiter(options.requests_per_minute ?? 240)
  const server = Bun.serve({
    hostname: options.hostname,
    port: options.port,
    maxRequestBodySize: bodyLimit,
    fetch: async (request) => {
      const url = new URL(request.url)
      if (url.pathname === "/health" && request.method === "GET") {
        return Response.json({
          schema_version: "trade.agent-host-http-health.v1",
          status: "ok",
        })
      }
      if (!allowedHeader(request.headers.get("host"), options.allowed_hosts)) {
        return errorResponse(421, "host_not_allowed")
      }
      if (!authorized(request.headers.get("authorization"), options.bearer_token)) {
        return errorResponse(401, "unauthorized")
      }
      if (!limiter.take(Date.now())) return errorResponse(429, "rate_limited")
      try {
        if (url.pathname === "/v1/agent-runs" && request.method === "POST") {
          const body = await readJson(request, bodyLimit)
          return Response.json(await options.host.submit(body as AgentRunRequest), {
            status: 202,
          })
        }
        const route = runRoute(url.pathname)
        if (!route) return errorResponse(404, "not_found")
        if (route.action === "status" && request.method === "GET") {
          return Response.json(await options.host.status(route.run_id))
        }
        if (route.action === "events" && request.method === "GET") {
          const after = integerQuery(url, "after_sequence", 0, 0, Number.MAX_SAFE_INTEGER)
          const limit = integerQuery(url, "limit", 100, 1, 1_000)
          return Response.json({
            run_id: route.run_id,
            events: await options.host.events(route.run_id, after, limit),
          })
        }
        if (route.action === "result" && request.method === "GET") {
          const result = await options.host.result(route.run_id)
          return result
            ? Response.json(result)
            : errorResponse(404, "result_not_ready")
        }
        if (route.action === "cancel" && request.method === "POST") {
          const body = await readJson(request, bodyLimit)
          const requestHash = recordString(body, "request_hash")
          await options.host.cancel(route.run_id, requestHash)
          return Response.json({ run_id: route.run_id, status: "cancelling" }, {
            status: 202,
          })
        }
        return errorResponse(405, "method_not_allowed")
      } catch (error) {
        return errorResponse(
          String(error).includes("not found") || String(error).includes("not ready")
            ? 404
            : 400,
          "invalid_request",
        )
      }
    },
  })
  const port = server.port
  if (!Number.isSafeInteger(port) || !port) {
    server.stop(true)
    throw new Error("Agent Host HTTP server did not expose a bound port")
  }
  return {
    hostname: options.hostname,
    port,
    url: `http://${displayHost(options.hostname)}:${port}`,
    stop: async () => {
      await server.stop(true)
      const close = options.host as AgentHostPort & { close?: () => Promise<void> }
      await close.close?.()
    },
  }
}

function runRoute(pathname: string): {
  run_id: string
  action: "status" | "events" | "result" | "cancel"
} | null {
  const match = /^\/v1\/agent-runs\/([^/]+)\/(status|events|result|cancel)$/.exec(pathname)
  if (!match) return null
  const runId = decodeURIComponent(match[1]!)
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(runId)) {
    throw new Error("Agent Run id is invalid")
  }
  return {
    run_id: runId,
    action: match[2] as "status" | "events" | "result" | "cancel",
  }
}

async function readJson(request: Request, maximum: number): Promise<unknown> {
  const length = Number(request.headers.get("content-length") ?? 0)
  if (!Number.isFinite(length) || length < 0 || length > maximum) {
    throw new Error("Agent Host request body is too large")
  }
  const bytes = Buffer.from(await request.arrayBuffer())
  if (bytes.byteLength > maximum) throw new Error("Agent Host request body is too large")
  return JSON.parse(bytes.toString("utf8"))
}

function integerQuery(
  url: URL,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = url.searchParams.get(name)
  const value = raw == null ? fallback : Number(raw)
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} is invalid`)
  }
  return value
}

function recordString(value: unknown, field: string): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("request body must be an object")
  }
  const result = (value as Record<string, unknown>)[field]
  if (typeof result !== "string") throw new Error(`${field} is required`)
  return result
}

function validateOptions(options: AgentHostHttpServerOptions): void {
  if (!["127.0.0.1", "0.0.0.0", "::1"].includes(options.hostname)) {
    throw new Error("Agent Host hostname is unsupported")
  }
  if (!Number.isSafeInteger(options.port) || options.port < 0 || options.port > 65_535) {
    throw new Error("Agent Host port is invalid")
  }
  const tokenBytes = Buffer.byteLength(options.bearer_token)
  if (tokenBytes < 32 || tokenBytes > 512) throw new Error("Agent Host bearer token is invalid")
  if (options.allowed_hosts.length < 1 || options.allowed_hosts.length > 16) {
    throw new Error("Agent Host allowed_hosts must be bounded and non-empty")
  }
}

function authorized(header: string | null, expected: string): boolean {
  if (!header?.startsWith("Bearer ")) return false
  const actual = Buffer.from(header.slice(7))
  const wanted = Buffer.from(expected)
  return actual.byteLength === wanted.byteLength && timingSafeEqual(actual, wanted)
}

function allowedHeader(value: string | null, allowed: string[]): boolean {
  if (!value) return false
  const normalized = value.toLowerCase()
  return allowed.some((candidate) => candidate.toLowerCase() === normalized)
}

function errorResponse(status: number, code: string): Response {
  return Response.json({
    error: {
      schema_version: "trade.agent-host-http-error.v1",
      code,
    },
  }, { status })
}

function displayHost(hostname: string): string {
  if (hostname === "0.0.0.0") return "127.0.0.1"
  return hostname === "::1" ? "[::1]" : hostname
}

class FixedWindowLimiter {
  private windowStart = 0
  private count = 0

  constructor(private readonly limit: number) {}

  take(now: number): boolean {
    if (now - this.windowStart >= 60_000) {
      this.windowStart = now
      this.count = 0
    }
    this.count += 1
    return this.count <= this.limit
  }
}
