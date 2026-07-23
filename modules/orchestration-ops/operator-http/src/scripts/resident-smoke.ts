#!/usr/bin/env bun

import { randomBytes } from "node:crypto"
import { existsSync } from "node:fs"
import { resolve } from "node:path"
import { Database } from "bun:sqlite"

type JSONRecord = Record<string, unknown>

interface Args {
  releaseRoot: string
  bunPath: string
}

interface RunningOperator {
  child: Bun.Subprocess<"ignore", "ignore", "pipe">
  stderr: Promise<string>
}

const args = parseArgs(Bun.argv.slice(2))

try {
  const result = await runResidentSmoke(args)
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
} catch (error) {
  process.stdout.write(`${JSON.stringify({
    schema_version: "trade.operator-http-resident-smoke.v1",
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  }, null, 2)}\n`)
  process.exitCode = 1
}

export async function runResidentSmoke(args: Args): Promise<JSONRecord> {
  const entrypoint = resolve(args.releaseRoot, "modules/orchestration-ops/operator-http/src/scripts/main.ts")
  const databasePath = resolve(args.releaseRoot, "data/ops_runtime.db")
  if (!existsSync(entrypoint) || !existsSync(databasePath)) throw new Error("release operator entrypoint or ops database is unavailable")

  const firstApiToken = token()
  const firstApprovalToken = token()
  const secondApiToken = token()
  const secondApprovalToken = token()
  let first: RunningOperator | undefined
  let second: RunningOperator | undefined
  try {
    first = startOperator(args, entrypoint, firstApiToken, firstApprovalToken)
    await waitUntilReady(first)
    const unauthenticated = await request("/v1/tools/search", { query: "operator-smoke-one", limit: 2 })
    assertStatus(unauthenticated, 401, "unauthenticated request")
    const firstRead = await request("/v1/tools/search", { query: "operator-smoke-one", limit: 2 }, firstApiToken)
    assertStatus(firstRead, 200, "first authenticated read")
    const firstRequestId = await responseRequestId(firstRead)
    await stopOperator(first)
    first = undefined

    second = startOperator(args, entrypoint, secondApiToken, secondApprovalToken)
    await waitUntilReady(second)
    const revokedApi = await request("/v1/tools/search", { query: "operator-smoke-revoked", limit: 2 }, firstApiToken)
    assertStatus(revokedApi, 401, "revoked API token")
    const revokedApproval = await request("/v1/rd/autonomy/wakeup", {}, secondApiToken, firstApprovalToken)
    assertStatus(revokedApproval, 403, "revoked approval token")
    const currentApproval = await request("/v1/rd/autonomy/wakeup", {}, secondApiToken, secondApprovalToken)
    assertStatus(currentApproval, 400, "current approval token payload gate")
    const secondRead = await request("/v1/tools/search", { query: "operator-smoke-two", limit: 2 }, secondApiToken)
    assertStatus(secondRead, 200, "second authenticated read")
    const secondRequestId = await responseRequestId(secondRead)

    const audit = readAuditRoundtrip(databasePath, [firstRequestId, secondRequestId], [
      firstApiToken, firstApprovalToken, secondApiToken, secondApprovalToken,
    ])
    return {
      schema_version: "trade.operator-http-resident-smoke.v1",
      ok: true,
      observed_at: new Date().toISOString(),
      status: "passed",
      listener: { scope: "loopback", port: 8787, resident_smoke: true },
      authentication: {
        unauthenticated_status: unauthenticated.status,
        revoked_api_token_status: revokedApi.status,
        revoked_approval_token_status: revokedApproval.status,
        current_approval_reached_payload_gate: currentApproval.status === 400,
        rotation_passed: true,
      },
      audit: {
        roundtrip: true,
        expected_messages: 4,
        observed_messages: audit.messageCount,
        phases: audit.phases,
        secrets_exposed: false,
      },
      controlled_owner_invoked: false,
      live_writes_allowed: false,
      limitations: [
        "bounded_local_resident_smoke_only",
        "does_not_test_tls_reverse_proxy_or_distributed_rate_limit",
        "does_not_invoke_rd_autonomy_or_model_provider",
        "does_not_grant_exchange_write_or_process_lifecycle_authority",
      ],
    }
  } finally {
    if (first) await stopOperator(first).catch(() => undefined)
    if (second) await stopOperator(second).catch(() => undefined)
  }
}

function startOperator(args: Args, entrypoint: string, apiToken: string, approvalToken: string): RunningOperator {
  const child = Bun.spawn({
    cmd: [args.bunPath, entrypoint, "--profile", "profile/operator-http.json"],
    cwd: args.releaseRoot,
    env: {
      PATH: process.env.PATH || "/usr/bin:/bin:/usr/sbin:/sbin",
      TRADE_REPO_ROOT: args.releaseRoot,
      TRADE_OPERATOR_API_TOKEN: apiToken,
      TRADE_OPERATOR_APPROVAL_TOKEN: approvalToken,
    },
    stdin: "ignore",
    stdout: "ignore",
    stderr: "pipe",
  })
  return { child, stderr: new Response(child.stderr).text() }
}

async function waitUntilReady(process: RunningOperator): Promise<void> {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    if (process.child.exitCode !== null) throw new Error("operator child exited before readiness")
    try {
      const response = await fetch("http://127.0.0.1:8787/healthz")
      if (response.status === 200) return
    } catch {
      // The bounded retry is readiness polling, not a business dependency sleep.
    }
    await Bun.sleep(50)
  }
  throw new Error("operator readiness timed out")
}

async function stopOperator(process: RunningOperator): Promise<void> {
  if (process.child.exitCode === null) process.child.kill("SIGTERM")
  const exit = Promise.race([
    process.child.exited,
    Bun.sleep(5_000).then(() => { throw new Error("operator shutdown timed out") }),
  ])
  try {
    await exit
  } catch (error) {
    if (process.child.exitCode === null) process.child.kill("SIGKILL")
    await process.child.exited
    throw error
  } finally {
    await process.stderr
  }
}

async function request(path: string, body: JSONRecord, apiToken?: string, approvalToken?: string): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json" }
  if (apiToken) headers.authorization = `Bearer ${apiToken}`
  if (approvalToken) headers["x-trade-approval"] = approvalToken
  return fetch(`http://127.0.0.1:8787${path}`, { method: "POST", headers, body: JSON.stringify(body) })
}

async function responseRequestId(response: Response): Promise<string> {
  const body = await response.json() as JSONRecord
  const requestId = typeof body.request_id === "string" ? body.request_id : ""
  if (!requestId) throw new Error("operator response omitted request identity")
  return requestId
}

function readAuditRoundtrip(databasePath: string, requestIds: string[], secrets: string[]): { messageCount: number; phases: string[] } {
  const db = new Database(databasePath, { readonly: true })
  try {
    const rows = db.query<{ message_id: string; envelope_json: string }, [string, string]>(`
      SELECT message_id, envelope_json
      FROM domain_message
      WHERE message_id LIKE ? OR message_id LIKE ?
      ORDER BY message_id
    `).all(`operator-${requestIds[0]}-%`, `operator-${requestIds[1]}-%`)
    if (rows.length !== 4) throw new Error("operator audit message count does not match")
    const serialized = JSON.stringify(rows)
    if (secrets.some((secret) => serialized.includes(secret))) throw new Error("operator audit exposed a credential")
    const phases = rows.map((row) => String((JSON.parse(row.envelope_json) as JSONRecord).phase)).sort()
    if (phases.join(",") !== "accepted,accepted,completed,completed") throw new Error("operator audit phases do not close")
    return { messageCount: rows.length, phases }
  } finally {
    db.close()
  }
}

function parseArgs(argv: string[]): Args {
  const values: Record<string, string> = {}
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index]
    const value = argv[index + 1]
    if (!name?.startsWith("--") || value == null) throw new Error("resident smoke arguments are incomplete")
    if (name !== "--release-root" && name !== "--bun-path") throw new Error(`unknown argument: ${name}`)
    if (values[name]) throw new Error(`duplicate argument: ${name}`)
    values[name] = value
  }
  if (!values["--release-root"] || !values["--bun-path"]) throw new Error("--release-root and --bun-path are required")
  return { releaseRoot: resolve(values["--release-root"]), bunPath: resolve(values["--bun-path"]) }
}

function assertStatus(response: Response, expected: number, label: string): void {
  if (response.status !== expected) throw new Error(`${label} returned unexpected status`)
}

function token(): string { return randomBytes(32).toString("base64url") }
