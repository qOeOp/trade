#!/usr/bin/env bun

import { resolve } from "node:path"
import { repoRoot } from "../../../../contracts/runtime-core/src/paths"
import { findUniqueActiveL2Runtime, type ActiveL2Runtime } from "../control/active-runtime"
import { buildL2OwnerHealth, buildUnavailableL2OwnerHealth } from "../control/owner-health"
import { processMatchesL2Service } from "../control/runtime-contract"

const root = repoRoot()
const symbol = parseSymbol(process.argv.slice(2))

try {
  const observedAt = new Date().toISOString()
  const active = findUniqueActiveL2Runtime(root, { symbol })
  const health = active == null ? buildUnavailableL2OwnerHealth(observedAt) : readActiveHealth(active, observedAt)
  process.stdout.write(`${JSON.stringify({ ok: true, action: "read_active_l2_service_health", health })}\n`)
} catch (error) {
  process.stdout.write(`${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })}\n`)
  process.exitCode = 1
}

export function parseSymbol(argv: string[]): string | undefined {
  if (argv.length === 0) return undefined
  if (argv.length !== 2 || argv[0] !== "--symbol" || !/^[A-Z0-9]{5,20}$/.test(argv[1] ?? "")) {
    throw new Error("owner health accepts only --symbol <VENUE_SYMBOL>")
  }
  return argv[1]
}

function readActiveHealth(
  active: ActiveL2Runtime,
  observedAt: string,
) {
  const serviceAlive = active.state.service_pid != null && processMatchesL2Service(active.state.service_pid, active.receipt)
  let sourceHealth: unknown = null
  let healthError = ""
  if (serviceAlive) {
    const queryBinary = resolve(root, "apps/market-data-products/l2-order-book-service/target/release/l2-order-book-query")
    const query = Bun.spawnSync({
      cmd: [queryBinary, "--endpoint", `http://${active.receipt.config.listen}`, "--action", "health", "--symbol", active.receipt.config.symbol],
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 3_000,
    })
    if (query.exitCode === 0) sourceHealth = JSON.parse(query.stdout.toString())
    else healthError = query.stderr.toString().trim() || `health query exit ${query.exitCode}`
  }
  return buildL2OwnerHealth({
    observed_at: observedAt,
    receipt: active.receipt,
    runtime_state: active.state,
    terminal_state: active.terminal,
    supervisor_alive: true,
    service_alive: serviceAlive,
    source_health: sourceHealth,
    health_error: healthError,
  })
}
