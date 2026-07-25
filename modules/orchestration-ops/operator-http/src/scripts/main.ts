#!/usr/bin/env bun

import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { canonicalHash } from "../../../../contracts/runtime-core/src/canonical-json"
import { assertProjectRuntimePath, repoRoot } from "../../../../contracts/runtime-core/src/paths"
import {
  handleOperatorHttp,
  OperatorRateLimiter,
  type OperatorAuditor,
  type OperatorHttpConfig,
  type OperatorInvoker,
} from "../lib/operator-http"

type JSONRecord = Record<string, unknown>
interface Profile extends OperatorHttpConfig {
  host: "127.0.0.1"
  port: number
  api_token_env: "TRADE_OPERATOR_API_TOKEN"
  approval_token_env: "TRADE_OPERATOR_APPROVAL_TOKEN"
  ops_runtime_db: string
  rd_state_db: string
  catalog_db: string
  model_profile: "profile/model-gateway.json"
}

const profilePath = profileArg(Bun.argv.slice(2))
const profile = compileProfile(JSON.parse(readFileSync(resolve(repoRoot(), profilePath), "utf8")))
const apiToken = process.env[profile.api_token_env] || ""
const approvalToken = process.env[profile.approval_token_env] || ""
if (!apiToken || !approvalToken) throw new Error("operator HTTP credentials are unavailable")
const limiter = new OperatorRateLimiter()
const invoke = ownerInvoker(profile)
const audit = auditor(profile)

const server = Bun.serve({
  hostname: profile.host,
  port: profile.port,
  async fetch(request, server) {
    const url = new URL(request.url)
    if (request.method === "GET" && url.pathname === "/healthz") {
      return json(200, { ok: true, schema_version: "trade.operator-http-health.v1", status: "alive", authority: "none" })
    }
    const contentLength = Number(request.headers.get("content-length") || 0)
    if (Number.isFinite(contentLength) && contentLength > profile.max_body_bytes) return json(413, { ok: false, error: { code: "request_body_too_large" } })
    let raw: string
    try { raw = await request.text() } catch { return json(400, { ok: false, error: { code: "request_body_unreadable" } }) }
    const bodyBytes = new TextEncoder().encode(raw).byteLength
    let body: unknown
    try { body = raw ? JSON.parse(raw) : {} } catch { return json(400, { ok: false, error: { code: "request_json_invalid" } }) }
    const headers: Record<string, string | undefined> = {
      authorization: request.headers.get("authorization") || undefined,
      "x-trade-approval": request.headers.get("x-trade-approval") || undefined,
    }
    const result = await handleOperatorHttp({
      method: request.method,
      path: url.pathname,
      headers,
      body,
      body_bytes: bodyBytes,
      remote_address: server.requestIP(request)?.address || "unknown",
      now: new Date().toISOString(),
    }, {
      api_token: apiToken,
      approval_token: approvalToken,
      read_limit_per_minute: profile.read_limit_per_minute,
      write_limit_per_minute: profile.write_limit_per_minute,
      max_body_bytes: profile.max_body_bytes,
    }, limiter, invoke, audit)
    return json(result.status, result.body)
  },
})

console.error(JSON.stringify({ event: "operator_http_ready", host: server.hostname, port: server.port, authority: "northbound_adapter_only" }))

function ownerInvoker(profile: Profile): OperatorInvoker {
  return async (owner, payload) => {
    if (owner === "tools_search") return searchTools(payload)
    const programId = text(payload.program_id)
    if (owner === "rd_program_read") {
      return ownerData(await execute([
        "modules/research-strategy-development/research-control-plane/program-control/src/scripts/main.ts",
        "--db", profile.rd_state_db, "--program-id", programId, "--json", JSON.stringify({ action: "read" }),
      ], 15_000))
    }
    return ownerData(await execute([
      "modules/research-strategy-development/research-control-plane/autonomy-cycle/src/scripts/main.ts",
      "--db", profile.rd_state_db, "--catalog-db", profile.catalog_db, "--program-id", programId,
      "--profile", profile.model_profile, "--json", JSON.stringify({ cycle_id: `operator-${text(payload.request_id)}`, now: payload.now, goal: payload.goal }),
    ], 45_000))
  }
}

function auditor(profile: Profile): OperatorAuditor {
  return async (event) => {
    const eventHash = canonicalHash(event)
    await execute([
      "modules/orchestration-ops/ops-runtime-store/src/scripts/main.ts",
      "--db", profile.ops_runtime_db, "--action", "record_message", "--json", JSON.stringify({
        message_id: `operator-${text(event.request_id)}-${text(event.phase)}`,
        direction: "inbox", source_domain: "operator", target_domain: "orchestration-ops",
        rail: "operator-http", payload_ref: `operator-audit:${eventHash}`,
        idempotency_key: `${text(event.request_id)}:${text(event.phase)}`, status: "processed",
        envelope_json: event, created_at: event.created_at,
      }),
    ], 10_000)
  }
}

function searchTools(payload: JSONRecord): JSONRecord {
  const manifest = JSON.parse(readFileSync(resolve(repoRoot(), "toolset.json"), "utf8")) as { tools?: JSONRecord[] }
  const query = text(payload.query).toLowerCase(); const domain = text(payload.domain); const limit = Number(payload.limit) || 20
  const tools = (manifest.tools || []).filter((tool) => {
    if (domain && text(tool.domain) !== domain) return false
    if (!query) return true
    return [tool.id, tool.domain, tool.purpose, ...(Array.isArray(tool.intent) ? tool.intent : [])].map(text).join(" ").toLowerCase().includes(query)
  }).slice(0, limit).map((tool) => ({ id: tool.id, domain: tool.domain, intent: tool.intent, purpose: tool.purpose, capability_class: tool.capability_class }))
  return { schema_version: "trade.operator-tool-search.v1", tools }
}

async function execute(command: string[], timeoutMs: number): Promise<JSONRecord> {
  const child = Bun.spawn({ cmd: [process.execPath, resolve(repoRoot(), command[0]), ...command.slice(1)], cwd: repoRoot(), env: process.env, stdout: "pipe", stderr: "pipe" })
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; child.kill() }, timeoutMs)
  try {
    const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
    if (timedOut) throw new Error("operator owner timed out")
    if (new TextEncoder().encode(stdout).byteLength > 1_000_000) throw new Error("operator owner output exceeded limit")
    if (exitCode !== 0) throw new Error(stderr.trim().slice(0, 2_000) || `operator owner exited ${exitCode}`)
    const result = JSON.parse(stdout.trim()) as unknown
    if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("operator owner returned non-object JSON")
    const record = result as JSONRecord
    if (record.ok === false) throw new Error(text(asRecord(record.error).message) || "operator owner reported failure")
    return record
  } finally { clearTimeout(timer) }
}

function compileProfile(value: unknown): Profile {
  const input = asRecord(value)
  const required = ["schema_version", "host", "port", "api_token_env", "approval_token_env", "ops_runtime_db", "rd_state_db", "catalog_db", "model_profile", "read_limit_per_minute", "write_limit_per_minute", "max_body_bytes"]
  if (Object.keys(input).some((key) => !required.includes(key)) || required.some((key) => !Object.hasOwn(input, key))) throw new Error("operator HTTP profile shape is invalid")
  if (input.schema_version !== "trade.operator-http-profile.v1" || input.host !== "127.0.0.1") throw new Error("operator HTTP profile identity is unsupported")
  if (input.api_token_env !== "TRADE_OPERATOR_API_TOKEN" || input.approval_token_env !== "TRADE_OPERATOR_APPROVAL_TOKEN") throw new Error("operator HTTP credential binding is unsupported")
  if (input.model_profile !== "profile/model-gateway.json") throw new Error("operator HTTP model profile is unsupported")
  const port = boundedInteger(input.port, 1_024, 65_535, "port")
  const readLimit = boundedInteger(input.read_limit_per_minute, 1, 600, "read_limit_per_minute")
  const writeLimit = boundedInteger(input.write_limit_per_minute, 1, 60, "write_limit_per_minute")
  const maxBody = boundedInteger(input.max_body_bytes, 1_024, 1_000_000, "max_body_bytes")
  const ops = text(input.ops_runtime_db); const rd = text(input.rd_state_db); const catalog = text(input.catalog_db)
  assertProjectRuntimePath(ops); assertProjectRuntimePath(rd); assertProjectRuntimePath(catalog)
  return { host: "127.0.0.1", port, api_token_env: "TRADE_OPERATOR_API_TOKEN", approval_token_env: "TRADE_OPERATOR_APPROVAL_TOKEN", ops_runtime_db: ops, rd_state_db: rd, catalog_db: catalog, model_profile: "profile/model-gateway.json", api_token: "", approval_token: "", read_limit_per_minute: readLimit, write_limit_per_minute: writeLimit, max_body_bytes: maxBody }
}

function profileArg(argv: string[]): string { const index = argv.indexOf("--profile"); const value = index >= 0 ? argv[index + 1] : "profile/operator-http.json"; if (value !== "profile/operator-http.json") throw new Error("--profile must be profile/operator-http.json"); return value }
function boundedInteger(value: unknown, min: number, max: number, field: string): number { if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max) throw new Error(`${field} is invalid`); return Number(value) }
function ownerData(value: JSONRecord): JSONRecord { return asRecord(value.data) }
function asRecord(value: unknown): JSONRecord { return value && typeof value === "object" && !Array.isArray(value) ? value as JSONRecord : {} }
function text(value: unknown): string { return typeof value === "string" ? value.trim() : "" }
function json(status: number, value: unknown): Response { return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } }) }
