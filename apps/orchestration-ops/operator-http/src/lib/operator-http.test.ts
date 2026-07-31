import assert from "node:assert/strict"
import test from "node:test"
import { handleOperatorHttp, OperatorRateLimiter, type OperatorHttpRequest } from "./operator-http"

const config = { api_token: "api-secret", approval_token: "approval-secret", read_limit_per_minute: 2, write_limit_per_minute: 1, max_body_bytes: 10_000 }

test("operator HTTP requires auth, exact routes, and bounded payloads", async () => {
  const run = harness()
  assert.equal((await run.handle(request("/v1/tools/search", {}, {}))).status, 401)
  assert.equal((await run.handle(request("/v1/unknown", {}, auth()))).status, 404)
  assert.equal((await run.handle({ ...request("/v1/tools/search", {}, auth()), body_bytes: 10_001 })).status, 413)
  assert.equal((await run.handle(request("/v1/tools/search", { query: "rd", shell: "rm" }, auth()))).status, 400)
  assert.deepEqual(run.owners, [])
})

test("read routes are rate-limited and audited without secret or body disclosure", async () => {
  const run = harness()
  assert.equal((await run.handle(request("/v1/tools/search", { query: "rd" }, auth()))).status, 200)
  assert.equal((await run.handle(request("/v1/tools/search", { query: "rd" }, auth()))).status, 200)
  assert.equal((await run.handle(request("/v1/tools/search", { query: "rd" }, auth()))).status, 429)
  assert.deepEqual(run.owners, ["tools_search", "tools_search"])
  assert.equal(JSON.stringify(run.audits).includes("api-secret"), false)
  assert.equal(JSON.stringify(run.audits).includes('"query":"rd"'), false)
})

test("controlled J04 wakeup needs independent approval and pre-audit", async () => {
  const body = { request_id: "wake-1", program_id: "rd-program", now: "2026-07-23T00:00:00.000Z", goal: { objective: "find edge", budget: {} } }
  const denied = harness()
  assert.equal((await denied.handle(request("/v1/rd/autonomy/wakeup", body, auth()))).status, 403)
  assert.deepEqual(denied.owners, [])
  const run = harness()
  const accepted = await run.handle(request("/v1/rd/autonomy/wakeup", body, { ...auth(), "x-trade-approval": "approval-secret" }))
  assert.equal(accepted.status, 200)
  assert.deepEqual(run.owners, ["rd_autonomy_wakeup"])
  assert.deepEqual(run.audits.map((item) => item.phase), ["accepted", "completed"])
  assert.equal((await run.handle(request("/v1/rd/autonomy/wakeup", { ...body, request_id: "wake-2" }, { ...auth(), "x-trade-approval": "approval-secret" }))).status, 429)
})

test("controlled owner is not called when durable pre-audit is unavailable", async () => {
  const run = harness({ auditFailure: true })
  const body = { request_id: "wake-1", program_id: "rd-program", now: "2026-07-23T00:00:00.000Z", goal: { objective: "find edge", budget: {} } }
  const result = await run.handle(request("/v1/rd/autonomy/wakeup", body, { ...auth(), "x-trade-approval": "approval-secret" }))
  assert.equal(result.status, 503)
  assert.deepEqual(run.owners, [])
})

function harness(options: { auditFailure?: boolean } = {}) {
  const owners: string[] = []; const audits: Record<string, unknown>[] = []
  const limiter = new OperatorRateLimiter()
  return {
    owners, audits,
    handle: (input: OperatorHttpRequest) => handleOperatorHttp(input, config, limiter, async (owner) => { owners.push(owner); return { owner, ok: true } }, async (event) => { if (options.auditFailure) throw new Error("down"); audits.push(event) }),
  }
}
function auth() { return { authorization: "Bearer api-secret" } }
function request(path: string, body: unknown, headers: Record<string, string> = {}): OperatorHttpRequest {
  return { method: "POST", path, headers, body, body_bytes: JSON.stringify(body).length, remote_address: "127.0.0.1", now: "2026-07-23T00:00:00.000Z" }
}
