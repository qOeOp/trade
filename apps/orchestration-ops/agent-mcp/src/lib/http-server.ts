import { timingSafeEqual } from "node:crypto"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { createTradeMcpServer, type TradeMcpProfile } from "./server"

export interface TradeMcpHttpServerOptions {
  hostname: string
  port: number
  bearer_token: string
  profile: TradeMcpProfile
  allowed_hosts: string[]
  allowed_origins?: string[]
  max_body_bytes?: number
  requests_per_minute?: number
}

export interface RunningTradeMcpHttpServer {
  hostname: string
  port: number
  url: string
  stop(): Promise<void>
}

export function startTradeMcpHttpServer(options: TradeMcpHttpServerOptions): RunningTradeMcpHttpServer {
  validateOptions(options)
  const bodyLimit = options.max_body_bytes ?? 512 * 1024
  const limiter = new FixedWindowLimiter(options.requests_per_minute ?? 120)
  const server = Bun.serve({
    hostname: options.hostname,
    port: options.port,
    maxRequestBodySize: bodyLimit,
    fetch: async (request) => {
      const url = new URL(request.url)
      if (url.pathname === "/health" && request.method === "GET") {
        return Response.json({
          schema_version: "trade.agent-mcp-http-health.v1",
          status: "ok",
          profile: options.profile,
        })
      }
      if (url.pathname !== "/mcp") return jsonRpcError(404, -32004, "Not found")
      if (request.method !== "POST") return jsonRpcError(405, -32005, "Method not allowed")
      if (!allowedHeader(request.headers.get("host"), options.allowed_hosts)) {
        return jsonRpcError(421, -32021, "Host not allowed")
      }
      const origin = request.headers.get("origin")
      if (origin && !allowedHeader(origin, options.allowed_origins ?? [])) {
        return jsonRpcError(403, -32003, "Origin not allowed")
      }
      if (!authorized(request.headers.get("authorization"), options.bearer_token)) {
        return jsonRpcError(401, -32001, "Unauthorized")
      }
      if (!limiter.take(Date.now())) return jsonRpcError(429, -32029, "Rate limit exceeded")
      const length = Number(request.headers.get("content-length") ?? 0)
      if (!Number.isFinite(length) || length < 0 || length > bodyLimit) {
        return jsonRpcError(413, -32013, "Request body too large")
      }
      const mcp = createTradeMcpServer(undefined, undefined, options.profile)
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      })
      try {
        await mcp.connect(transport)
        return await transport.handleRequest(request)
      } catch {
        return jsonRpcError(500, -32603, "Internal MCP error")
      } finally {
        await Promise.allSettled([transport.close(), mcp.close()])
      }
    },
  })
  const boundPort = server.port
  if (!Number.isSafeInteger(boundPort) || !boundPort) {
    server.stop(true)
    throw new Error("MCP HTTP server did not expose a bound port")
  }
  return {
    hostname: options.hostname,
    port: boundPort,
    url: `http://${displayHost(options.hostname)}:${boundPort}/mcp`,
    stop: async () => {
      await server.stop(true)
    },
  }
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

function validateOptions(options: TradeMcpHttpServerOptions): void {
  if (!["127.0.0.1", "0.0.0.0", "::1"].includes(options.hostname)) {
    throw new Error("MCP HTTP hostname must be loopback or explicit private-container wildcard")
  }
  if (!Number.isSafeInteger(options.port) || options.port < 0 || options.port > 65_535) {
    throw new Error("MCP HTTP port is invalid")
  }
  if (Buffer.byteLength(options.bearer_token) < 32 || Buffer.byteLength(options.bearer_token) > 512) {
    throw new Error("MCP HTTP bearer token must contain 32 to 512 bytes")
  }
  if (options.allowed_hosts.length < 1 || options.allowed_hosts.length > 16) {
    throw new Error("MCP HTTP allowed_hosts must be bounded and non-empty")
  }
  const bodyLimit = options.max_body_bytes ?? 512 * 1024
  if (!Number.isSafeInteger(bodyLimit) || bodyLimit < 1_024 || bodyLimit > 2 * 1024 * 1024) {
    throw new Error("MCP HTTP max body is invalid")
  }
  const rate = options.requests_per_minute ?? 120
  if (!Number.isSafeInteger(rate) || rate < 1 || rate > 10_000) throw new Error("MCP HTTP rate limit is invalid")
}

function authorized(header: string | null, expected: string): boolean {
  if (!header?.startsWith("Bearer ")) return false
  const actual = Buffer.from(header.slice(7))
  const wanted = Buffer.from(expected)
  return actual.byteLength === wanted.byteLength && timingSafeEqual(actual, wanted)
}

function allowedHeader(value: string | null, allowed: string[]): boolean {
  if (!value) return false
  let normalized = value.toLowerCase()
  try {
    if (normalized.includes("://")) normalized = new URL(normalized).host.toLowerCase()
  } catch {
    return false
  }
  return allowed.some((candidate) => {
    const expected = candidate.toLowerCase()
    if (expected === normalized) return true
    if (expected.includes(":")) return false
    try {
      return new URL(`http://${normalized}`).hostname.toLowerCase() === expected
    } catch {
      return false
    }
  })
}

function jsonRpcError(status: number, code: number, message: string): Response {
  return Response.json({ jsonrpc: "2.0", error: { code, message }, id: null }, { status })
}

function displayHost(hostname: string): string {
  if (hostname === "0.0.0.0") return "127.0.0.1"
  return hostname === "::1" ? "[::1]" : hostname
}
