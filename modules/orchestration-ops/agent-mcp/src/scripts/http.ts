#!/usr/bin/env bun

import { startTradeMcpHttpServer } from "../lib/http-server"
import type { TradeMcpProfile } from "../lib/server"

function main(): void {
  const input = parseArgs(process.argv.slice(2))
  const token = process.env[input.token_env]
  if (!token) throw new Error(`required MCP bearer token env is missing: ${input.token_env}`)
  const server = startTradeMcpHttpServer({
    hostname: input.host,
    port: input.port,
    bearer_token: token,
    profile: input.profile,
    allowed_hosts: input.allowed_hosts,
  })
  console.log(JSON.stringify({
    schema_version: "trade.agent-mcp-http-start.v1",
    status: "ready",
    host: input.host,
    port: server.port,
    profile: input.profile,
  }))
  const shutdown = () => {
    void server.stop().finally(() => process.exit(0))
  }
  process.on("SIGINT", shutdown)
  process.on("SIGTERM", shutdown)
}

function parseArgs(argv: string[]): {
  host: string
  port: number
  token_env: string
  profile: TradeMcpProfile
  allowed_hosts: string[]
} {
  const values = new Map<string, string>()
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index]
    const value = argv[index + 1]
    if (!flag?.startsWith("--") || value == null) throw new Error("MCP HTTP arguments must be --key value pairs")
    values.set(flag.slice(2), value)
  }
  const host = values.get("host") ?? "127.0.0.1"
  const port = Number(values.get("port") ?? 7312)
  const tokenEnv = values.get("token-env") ?? "TRADE_MCP_HTTP_TOKEN"
  const profile = values.get("profile") ?? "explanation"
  if (!["interactive", "planner", "developer", "reviewer", "explanation"].includes(profile)) {
    throw new Error("MCP HTTP profile is unsupported")
  }
  if (!/^[A-Z][A-Z0-9_]{2,127}$/.test(tokenEnv)) throw new Error("MCP HTTP token env name is invalid")
  const configuredHosts = values.get("allowed-hosts")
  const allowedHosts = configuredHosts
    ? configuredHosts.split(",").map((item) => item.trim()).filter(Boolean)
    : [`127.0.0.1:${port}`, `localhost:${port}`]
  if (host === "0.0.0.0" && !configuredHosts) {
    throw new Error("private-container wildcard requires explicit --allowed-hosts")
  }
  return { host, port, token_env: tokenEnv, profile: profile as TradeMcpProfile, allowed_hosts: allowedHosts }
}

if (import.meta.main) {
  try {
    main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
