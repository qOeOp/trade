import { createHash, timingSafeEqual } from "node:crypto"
import { canonicalHash } from "../../../../contracts/runtime-core/src/canonical-json"

type JSONRecord = Record<string, unknown>

export type OperatorOwner = "tools_search" | "rd_program_read" | "rd_autonomy_wakeup"
export type OperatorInvoker = (owner: OperatorOwner, payload: JSONRecord) => Promise<JSONRecord>
export type OperatorAuditor = (event: JSONRecord) => Promise<void>

export interface OperatorHttpConfig {
  api_token: string
  approval_token: string
  read_limit_per_minute: number
  write_limit_per_minute: number
  max_body_bytes: number
}

export interface OperatorHttpRequest {
  method: string
  path: string
  headers: Record<string, string | undefined>
  body: unknown
  body_bytes: number
  remote_address: string
  now: string
}

export interface OperatorHttpResponse { status: number; body: JSONRecord }

interface Bucket { window: number; count: number }

export class OperatorRateLimiter {
  private readonly buckets = new Map<string, Bucket>()

  take(key: string, limit: number, now: string): boolean {
    const instant = Date.parse(now)
    if (!Number.isFinite(instant)) throw new Error("operator request time is invalid")
    const window = Math.floor(instant / 60_000)
    const current = this.buckets.get(key)
    if (!current || current.window !== window) {
      this.buckets.set(key, { window, count: 1 })
      return true
    }
    if (current.count >= limit) return false
    current.count += 1
    return true
  }
}

export async function handleOperatorHttp(
  request: OperatorHttpRequest,
  config: OperatorHttpConfig,
  limiter: OperatorRateLimiter,
  invoke: OperatorInvoker,
  audit: OperatorAuditor,
): Promise<OperatorHttpResponse> {
  const route = routeFor(request.method, request.path)
  if (!route) return response(404, "route_not_found")
  if (request.body_bytes > config.max_body_bytes) return response(413, "request_body_too_large")
  const bearer = bearerToken(request.headers.authorization)
  if (!bearer || !secretEqual(bearer, config.api_token)) return response(401, "authentication_required")
  const clientRef = createHash("sha256").update(bearer).digest("hex").slice(0, 16)
  const limit = route.controlled ? config.write_limit_per_minute : config.read_limit_per_minute
  if (!limiter.take(`${clientRef}:${route.path}`, limit, request.now)) return response(429, "rate_limit_exceeded")
  if (route.controlled) {
    const approval = request.headers["x-trade-approval"]
    if (!approval || !secretEqual(approval, config.approval_token)) return response(403, "approval_required")
  }
  let payload: JSONRecord
  try { payload = compilePayload(route.owner, request.body) } catch (error) {
    return response(400, "request_invalid", error instanceof Error ? error.message : String(error))
  }
  const requestId = stringField(payload.request_id) || canonicalHash({ owner: route.owner, payload }).slice(0, 24)
  const auditBase = {
    schema_version: "trade.operator-http-audit.v1",
    request_id: requestId,
    route: route.path,
    owner: route.owner,
    controlled: route.controlled,
    client_ref: clientRef,
    request_hash: canonicalHash(payload),
    remote_scope: request.remote_address === "127.0.0.1" || request.remote_address === "::1" ? "loopback" : "non_loopback",
    created_at: request.now,
  }
  try {
    await audit({ ...auditBase, phase: "accepted", status: "accepted" })
  } catch {
    return response(503, "audit_unavailable")
  }
  try {
    const result = await invoke(route.owner, payload)
    await audit({ ...auditBase, phase: "completed", status: "completed", result_hash: canonicalHash(result) })
    return { status: 200, body: { ok: true, schema_version: "trade.operator-http-response.v1", request_id: requestId, result } }
  } catch (error) {
    const failureClass = route.controlled ? "controlled_owner_failed" : "read_owner_failed"
    await audit({ ...auditBase, phase: "completed", status: "failed", failure_class: failureClass }).catch(() => undefined)
    return response(502, failureClass, error instanceof Error ? error.message : String(error), requestId)
  }
}

function routeFor(method: string, path: string): null | { path: string; owner: OperatorOwner; controlled: boolean } {
  if (method === "POST" && path === "/v1/tools/search") return { path, owner: "tools_search", controlled: false }
  if (method === "POST" && path === "/v1/rd/program/read") return { path, owner: "rd_program_read", controlled: false }
  if (method === "POST" && path === "/v1/rd/autonomy/wakeup") return { path, owner: "rd_autonomy_wakeup", controlled: true }
  return null
}

function compilePayload(owner: OperatorOwner, value: unknown): JSONRecord {
  const input = record(value)
  if (owner === "tools_search") {
    exact(input, ["query", "domain", "limit"])
    return { query: optionalText(input.query, 200), domain: optionalText(input.domain, 100), limit: integer(input.limit, 1, 50, 20) }
  }
  if (owner === "rd_program_read") {
    exact(input, ["program_id"])
    return { program_id: identifier(input.program_id, "program_id") }
  }
  exact(input, ["request_id", "program_id", "now", "goal"])
  const goal = record(input.goal)
  exact(goal, ["objective", "budget"])
  const budget = record(goal.budget)
  exact(budget, ["max_hypotheses", "max_trials_total", "max_locked_holdout_uses"])
  return {
    request_id: identifier(input.request_id, "request_id"),
    program_id: identifier(input.program_id, "program_id"),
    now: canonicalTime(input.now),
    goal: {
      objective: requiredText(goal.objective, "goal.objective", 500),
      budget: {
        max_hypotheses: integer(budget.max_hypotheses, 1, 100, 20),
        max_trials_total: integer(budget.max_trials_total, 1, 1_000, 80),
        max_locked_holdout_uses: integer(budget.max_locked_holdout_uses, 0, 10, 1),
      },
    },
  }
}

function response(status: number, code: string, message = code, requestId?: string): OperatorHttpResponse {
  return { status, body: { ok: false, schema_version: "trade.operator-http-response.v1", ...(requestId ? { request_id: requestId } : {}), error: { code, message } } }
}
function bearerToken(value: string | undefined): string { const match = /^Bearer ([^\s]+)$/.exec(value || ""); return match?.[1] || "" }
function secretEqual(left: string, right: string): boolean { const a = Buffer.from(left); const b = Buffer.from(right); return a.length === b.length && timingSafeEqual(a, b) }
function record(value: unknown): JSONRecord { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("body must be an object"); return value as JSONRecord }
function exact(value: JSONRecord, keys: string[]): void { const allowed = new Set(keys); const unknown = Object.keys(value).filter((key) => !allowed.has(key)); if (unknown.length) throw new Error(`unknown fields: ${unknown.sort().join(", ")}`) }
function stringField(value: unknown): string { return typeof value === "string" ? value.trim() : "" }
function optionalText(value: unknown, max: number): string { const text = stringField(value); if (text.length > max) throw new Error("text field is too long"); return text }
function requiredText(value: unknown, field: string, max: number): string { const text = optionalText(value, max); if (!text) throw new Error(`${field} is required`); return text }
function identifier(value: unknown, field: string): string { const text = requiredText(value, field, 128); if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(text)) throw new Error(`${field} is invalid`); return text }
function integer(value: unknown, min: number, max: number, fallback: number): number { if (value === undefined) return fallback; if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max) throw new Error("integer field is out of bounds"); return Number(value) }
function canonicalTime(value: unknown): string { const text = requiredText(value, "now", 64); const date = new Date(text); if (!Number.isFinite(date.getTime()) || date.toISOString() !== text) throw new Error("now must be canonical UTC"); return text }
